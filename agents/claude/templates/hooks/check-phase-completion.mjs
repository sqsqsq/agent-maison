#!/usr/bin/env node
// ============================================================================
// Stop hook：阶段闭环物理拦截 + 跨会话隔离（v2.4）
// ============================================================================
// 触发时机：Claude Code CLI 在主 agent 即将结束消息时调用 Stop 事件。本 hook
// 注册在 Stop 事件上（matcher="*"）。
//
// 协议（Claude Code Hooks 官方约定）：
//   - 输入：stdin 收到 JSON，含 session_id / transcript_path / cwd /
//     hook_event_name / stop_hook_active 等字段。
//   - 输出：
//     * 写 JSON 到 stdout：{"decision":"block","reason":"..."} 表示阻断；
//     * exit 2 + stderr 内容：阻止 stop 并把 stderr 内容注入下一轮 prompt；
//     * exit 0：放行（即便 stderr 有内容也只是 advisory，不阻断）。
//   - stop_hook_active=true 表示本次 stop 已经被某个 hook 拦过一次；为避免
//     无限循环，本 hook 必须直接放行。
//
// v2.4 新增：会话边界判定
//   v2.3 之前 hook 只看 .current-phase.json 是否"未闭环"，会出现一个严重问题：
//     上一次会话写下未闭环 state → 重启 cli → 用户问无关问题 → hook 仍然拦截。
//   v2.8 起：
//     1) hook 入口拿 payload.session_id；
//     2) 与 state.session_id 比对，区分"当前会话遗留"vs"跨会话陈旧"；
//     3) 跨会话 / 老 state / 超 TTL 一律 advisory + exit 0；
//     4) 当前会话未闭环才阻断 + exit 2，且文案中性化（继续 / 放弃二选一）。
//
//   时间常量来自 framework.config.json 的 state_machine 段：
//     - grace_period_minutes：runner 写 state 到 hook 第一次盖章的容忍窗口
//     - ttl_hours：payload 没 session_id 时的兜底过期阈值
//   解析失败 / 字段缺失时回退到 HOOK_DEFAULT_*，详见 readStateMachineFromConfig。
//
// 闭环判据（CLAUDE.md §5.1 同步）：
//   仅在"当前会话遗留" state 上评估，必须四项齐全：
//     - status='harness_finished'
//     - verdict='PASS'
//     - blocker_count===0
//     - receipt.status='passed'
//
// 跨平台：纯 Node.js + path/url，不依赖任何 shell。
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

// --------------------------------------------------------------------------
// HOOK 端默认时间常量
// --------------------------------------------------------------------------
//
// **重要**：必须与 [framework/harness/config.ts] DEFAULT_STATE_MACHINE 同步。
// 测试 [framework/harness/test/hook-stale-state.spec.ts] T11 用例校验一致性。

export const HOOK_DEFAULT_GRACE_MS = 5 * 60 * 1000; // 5 分钟
export const HOOK_DEFAULT_TTL_MS = 12 * 60 * 60 * 1000; // 12 小时

// 范围限制（与 STATE_MACHINE_RANGES 同步；hook 端碰到非法值就 fallback 到默认）
const HOOK_GRACE_MIN_MS = 1; // 严格 > 0
const HOOK_GRACE_MAX_MS = 60 * 60 * 1000; // 60 分钟
const HOOK_TTL_MIN_MS = 1 * 60 * 60 * 1000; // 1 小时
const HOOK_TTL_MAX_MS = 168 * 60 * 60 * 1000; // 7 天

// --------------------------------------------------------------------------
// 1. 读 stdin
// --------------------------------------------------------------------------

async function readStdin() {
  return new Promise((resolve) => {
    let raw = '';
    if (process.stdin.isTTY) {
      // 调试场景下手动跑，没人喂 stdin → 直接放行
      resolve(null);
      return;
    }
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => (raw += chunk));
    process.stdin.on('end', () => {
      if (!raw.trim()) {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(null);
      }
    });
    process.stdin.on('error', () => resolve(null));
  });
}

// --------------------------------------------------------------------------
// 2. 项目根 / 状态文件路径解析
// --------------------------------------------------------------------------

function resolveProjectRoot(payload) {
  // 优先级：env > payload.cwd > process.cwd()
  const fromEnv = process.env.CLAUDE_PROJECT_DIR;
  if (fromEnv && fromEnv.trim()) return path.resolve(fromEnv.trim());
  if (payload && typeof payload.cwd === 'string' && payload.cwd.trim()) {
    return path.resolve(payload.cwd.trim());
  }
  return process.cwd();
}

function readJSONSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// --------------------------------------------------------------------------
// 3. 轻量 framework.config.json 解析（避免 hook 引入 ts-node）
// --------------------------------------------------------------------------

/**
 * 解析 paths.state_file（v2.0 起即支持）。
 */
function readStateFileRelFromConfig(projectRoot) {
  try {
    const cfgPath = path.resolve(projectRoot, 'framework.config.json');
    if (!fs.existsSync(cfgPath)) return null;
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
    const rel = cfg?.paths?.state_file;
    if (typeof rel === 'string' && rel.trim()) return rel.trim();
    return null;
  } catch {
    return null;
  }
}

/**
 * 解析 state_machine.grace_period_minutes / ttl_hours 为毫秒。
 * 任何非法值（缺字段、超范围、非数字）都安静回退到 HOOK_DEFAULT_*——
 * hook 不能因为配置错误而崩溃 / 拒绝放行（用户体验比"严格校验"更重要）。
 * 严格校验由 framework/harness/config.ts 的 validateStateMachine 在 runner
 * 端兜底，不重复在 hook 端 fail-loud。
 */
export function readStateMachineFromConfig(projectRoot) {
  const fallback = { gracePeriodMs: HOOK_DEFAULT_GRACE_MS, ttlMs: HOOK_DEFAULT_TTL_MS };
  try {
    const cfgPath = path.resolve(projectRoot, 'framework.config.json');
    if (!fs.existsSync(cfgPath)) return fallback;
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
    const sm = cfg?.state_machine;
    if (!sm || typeof sm !== 'object') return fallback;

    let gracePeriodMs = fallback.gracePeriodMs;
    if (typeof sm.grace_period_minutes === 'number' && Number.isFinite(sm.grace_period_minutes)) {
      const ms = sm.grace_period_minutes * 60 * 1000;
      if (ms >= HOOK_GRACE_MIN_MS && ms <= HOOK_GRACE_MAX_MS) gracePeriodMs = ms;
    }

    let ttlMs = fallback.ttlMs;
    if (typeof sm.ttl_hours === 'number' && Number.isFinite(sm.ttl_hours)) {
      const ms = sm.ttl_hours * 3600 * 1000;
      if (ms >= HOOK_TTL_MIN_MS && ms <= HOOK_TTL_MAX_MS) ttlMs = ms;
    }

    return { gracePeriodMs, ttlMs };
  } catch {
    return fallback;
  }
}

// --------------------------------------------------------------------------
// 4. 会话边界判定
// --------------------------------------------------------------------------

/**
 * 评估当前 state 与本次 cli 会话的关系。
 *
 * 返回 { kind, isStale, sameSession, shouldStamp, reasonHuman }：
 *   - kind:
 *       'fresh-current'        当前会话遗留，state.session_id 与 sid 一致或同会话内不需盖章
 *       'fresh-unstamped'      当前会话遗留，state 还没盖章但在 grace 窗口内 → 应盖章
 *       'stale-cross-session'  跨会话遗留：state.session_id 与 sid 不一致
 *       'stale-legacy-no-sid'  老 state（无 session_id）+ 超过 grace_period_minutes
 *       'stale-ttl-expired'    payload 没 session_id + 超过 ttl
 *   - isStale: true 表示陈旧，hook 应放行 + advisory
 *   - sameSession: 用于决定是否更新 last_seen_*
 *   - shouldStamp: 仅 fresh-unstamped 为 true，hook 应回写 state.session_id
 *   - reasonHuman: advisory 文案中"原因"行
 *
 * 判定矩阵（state.session_id × payload.session_id）：
 *
 *                  | sid 存在 sx        | sid 存在 sy(!=sx)        | sid 缺失
 *   --------------+--------------------+--------------------------+-------------------------
 *   state.sid=sx  | fresh-current      | stale-cross-session      | inside-ttl→fresh-current
 *                 |                    |                          | else→stale-ttl-expired
 *   state.sid=null| inside-grace→fresh | inside-grace→fresh-unstmp| inside-ttl→fresh-current
 *                 |  -unstamped(stamp) |  (stamp with sy)         | else→stale-ttl-expired
 *                 | else→stale-legacy  | else→stale-legacy        |
 */
export function evaluateSessionStaleness(state, currentSid, gracePeriodMs, ttlMs, now) {
  const updatedAtMs = parseTimestampMs(state?.updated_at);
  const ageMs = updatedAtMs == null ? Number.POSITIVE_INFINITY : Math.max(0, now - updatedAtMs);
  const stateSid =
    typeof state?.session_id === 'string' && state.session_id.trim() ? state.session_id.trim() : null;

  // 分支 1：state 已盖章
  if (stateSid) {
    if (currentSid && currentSid === stateSid) {
      return {
        kind: 'fresh-current',
        isStale: false,
        sameSession: true,
        shouldStamp: false,
        reasonHuman: '',
      };
    }
    if (currentSid && currentSid !== stateSid) {
      return {
        kind: 'stale-cross-session',
        isStale: true,
        sameSession: false,
        shouldStamp: false,
        reasonHuman: `state 由另一个会话（session_id=${truncateSid(stateSid)}）记录，本次会话 session_id=${truncateSid(currentSid)}`,
      };
    }
    // currentSid 缺失（hook 协议异常或未来 cli adapter 不传）→ 用 ttl 兜底
    if (ageMs <= ttlMs) {
      return {
        kind: 'fresh-current',
        isStale: false,
        sameSession: true, // 保守视作同会话；没法精确判断
        shouldStamp: false,
        reasonHuman: '',
      };
    }
    return {
      kind: 'stale-ttl-expired',
      isStale: true,
      sameSession: false,
      shouldStamp: false,
      reasonHuman: `payload 未携带 session_id，且 state.updated_at 距今超过 ttl（${formatDuration(ttlMs)}）`,
    };
  }

  // 分支 2：state 未盖章（runner 刚写完，hook 还没第一次回填 session_id）
  if (currentSid) {
    if (ageMs <= gracePeriodMs) {
      // 视作"runner 刚写完 state，本次 stop 是同会话第一次触发 hook"——盖章
      return {
        kind: 'fresh-unstamped',
        isStale: false,
        sameSession: true,
        shouldStamp: true,
        reasonHuman: '',
      };
    }
    // 超 grace：state 写得太久，又没盖章过，更可能是上一会话残留
    return {
      kind: 'stale-legacy-no-sid',
      isStale: true,
      sameSession: false,
      shouldStamp: false,
      reasonHuman: `state 未携带 session_id，且距今超过 grace_period（${formatDuration(gracePeriodMs)}），视为前一次会话遗留`,
    };
  }

  // currentSid 也缺失：双双没 session_id → 用 ttl 兜底
  if (ageMs <= ttlMs) {
    return {
      kind: 'fresh-current',
      isStale: false,
      sameSession: true,
      shouldStamp: false,
      reasonHuman: '',
    };
  }
  return {
    kind: 'stale-ttl-expired',
    isStale: true,
    sameSession: false,
    shouldStamp: false,
    reasonHuman: `state 与 hook payload 均未携带 session_id，state.updated_at 距今超过 ttl（${formatDuration(ttlMs)}）`,
  };
}

function parseTimestampMs(s) {
  if (typeof s !== 'string' || !s.trim()) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

function truncateSid(sid) {
  if (!sid) return '(unknown)';
  return sid.length > 12 ? `${sid.slice(0, 8)}…${sid.slice(-3)}` : sid;
}

function formatDuration(ms) {
  if (ms < 60 * 1000) return `${Math.round(ms / 1000)} 秒`;
  if (ms < 60 * 60 * 1000) return `${(ms / (60 * 1000)).toFixed(1)} 分钟`;
  return `${(ms / (60 * 60 * 1000)).toFixed(1)} 小时`;
}

// --------------------------------------------------------------------------
// 5. 闭环判定（仅对 sameSession 生效）
// --------------------------------------------------------------------------

// 全局阶段（与 workflow scope=global 对齐：extensions / init / catalog / glossary / docs）
// 不参与"feature 维度阶段闭环判定"。它们没有完成回执模板，全局入口 §5.1 判据也只覆盖
// PRD / design / coding / review / UT / device-testing 六个 feature 维度阶段。
// runner 端（v2.8.1 起）已经对全局阶段不写 state，本兜底保护针对历史残留：
// 若 state file 已存在且 phase 是全局阶段，hook 一律放行，不要去找 receipt。
const GLOBAL_PHASES = new Set(['extensions', 'init', 'catalog', 'glossary', 'docs']);

export function evaluateState(state) {
  // 返回 { allow: boolean, reason: string, missing: string[] }
  if (!state || typeof state !== 'object') {
    return { allow: true, reason: 'no-state-file', missing: [] };
  }

  if (typeof state.phase === 'string' && GLOBAL_PHASES.has(state.phase)) {
    return { allow: true, reason: 'global-phase-not-tracked', missing: [] };
  }

  const missing = [];

  if (state.status !== 'harness_finished') {
    missing.push(
      `status="${state.status ?? 'unknown'}"，必须为 "harness_finished"（即主 agent 已自跑 harness-runner.ts）`,
    );
  }

  const verdict = state.verdict;
  if (verdict !== 'PASS') {
    missing.push(
      `harness verdict="${verdict ?? 'null'}"，必须为 "PASS"（脚本 harness 退出码 0、零 BLOCKER）`,
    );
  }

  if (typeof state.blocker_count === 'number' && state.blocker_count > 0) {
    missing.push(`harness blocker_count=${state.blocker_count}，必须为 0`);
  }

  const receipt = state.receipt ?? null;
  if (!receipt) {
    missing.push(
      'state.receipt=null，未跑 check-receipt.ts；阶段完成回执必须填写并通过校验',
    );
  } else if (receipt.status !== 'passed') {
    missing.push(
      `receipt.status="${receipt.status}"（路径：${receipt.receipt_path}）`,
    );
    if (receipt.message) {
      missing.push(`  ↳ ${receipt.message.split(/\r?\n/).slice(0, 3).join(' / ')}`);
    }
  }

  if (missing.length === 0) {
    return { allow: true, reason: 'phase-closed', missing: [] };
  }
  return {
    allow: false,
    reason: 'phase-not-closed',
    missing,
  };
}

// --------------------------------------------------------------------------
// 6. state 写回（盖章 + last_seen 更新；best-effort，写失败不影响判定）
// --------------------------------------------------------------------------

function maybeUpdateState(stateAbs, state, sid, stamp) {
  try {
    if (!sid) return;
    const nowIso = new Date().toISOString();
    const next = { ...state };
    if (stamp) {
      next.session_id = sid;
      next.session_id_recorded_at = nowIso;
    }
    next.last_seen_session_id = sid;
    next.last_seen_at = nowIso;
    fs.writeFileSync(stateAbs, JSON.stringify(next, null, 2) + '\n', 'utf-8');
  } catch {
    // best-effort：写失败也不影响 hook 判定结果
  }
}

// --------------------------------------------------------------------------
// 7. 文案构建
// --------------------------------------------------------------------------

/** 对齐 harness/featurePhaseReportsDir —— Hook 不落 TS，纯 Node 复刻占位符语义 */
function resolveFeaturePhaseReportDir(projectRoot, feature, phase) {
  if (!feature || !phase || feature === 'unknown' || phase === 'unknown') return null;
  try {
    if (feature === '_global') {
      return path.resolve(projectRoot, 'framework/harness/reports/_global', phase);
    }
    let pattern = null;
    try {
      const cfgPath = path.resolve(projectRoot, 'framework.config.json');
      if (fs.existsSync(cfgPath)) {
        const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
        const p = cfg?.paths?.reports_dir_pattern;
        if (typeof p === 'string' && p.trim()) pattern = p.trim();
      }
    } catch {
      pattern = null;
    }
    if (pattern) {
      const rel = pattern.replace(/<feature>/g, feature).replace(/<phase>/g, phase);
      return path.resolve(projectRoot, rel);
    }
    return path.resolve(projectRoot, 'framework/harness/reports', feature, phase);
  } catch {
    return path.resolve(projectRoot, 'framework/harness/reports', feature, phase);
  }
}

function readSummaryHint(projectRoot, state) {
  try {
    const phase = typeof state?.phase === 'string' ? state.phase : '';
    const feature = typeof state?.feature === 'string' ? state.feature : '';
    if (!phase || !feature) return null;
    const reportsRoot = resolveFeaturePhaseReportDir(projectRoot, feature, phase);
    if (!reportsRoot) return null;
    const summaryPath = path.join(reportsRoot, 'summary.json');
    const summary = readJSONSafe(summaryPath);
    if (!summary || typeof summary !== 'object') return null;
    const nextAction = typeof summary.next_action === 'string' ? summary.next_action : '';
    if (!nextAction) return null;
    return {
      path: path.relative(projectRoot, summaryPath).replace(/\\/g, '/'),
      nextAction,
    };
  } catch {
    return null;
  }
}

function buildBlockReason(state, missingItems, summaryHint = null) {
  const phase = state.phase ?? 'unknown';
  const feature = state.feature ?? 'unknown';
  const lines = [
    `[Stop Hook 提示] 当前会话存在未闭环阶段：`,
    `  feature = "${feature}"`,
    `  phase   = "${phase}"`,
    `  state file = framework/harness/state/.current-phase.json`,
    '',
    '未满足的闭环条件（CLAUDE.md §5.1）：',
    ...missingItems.map((m) => `  - ${m}`),
    '',
    ...(summaryHint ? [
      '最近一次 harness summary 建议：',
      `  summary = ${summaryHint.path}`,
      `  next_action = ${summaryHint.nextAction}`,
      '',
    ] : []),
    '如果你打算【继续这个阶段】，按下面顺序补齐：',
    `  1. 主 agent 自跑 harness：`,
    `       cd framework/harness && npx ts-node harness-runner.ts \\`,
    `         --phase ${phase} --feature ${feature}`,
    `  2. 通过 Task 工具调用 verifier 子 agent（subagent_type=verifier），`,
    `     传入 feature/phase/报告路径。`,
    `  3. 填写阶段完成回执：`,
    `       模板：framework/harness/templates/phase-completion-receipt.md`,
    `       目标：doc/features/${feature}/${phase}/phase-completion-receipt.md`,
    `  4. 重跑 harness-runner.ts，使其回填 receipt.status=passed 后再尝试 stop。`,
    '',
    '如果你想【放弃这个阶段，转去做别的事】，先执行：',
    `       cd framework/harness && npx ts-node harness-runner.ts --clear-state`,
    `  这会删除 state file。下一次结束消息时本 hook 不会再拦你；`,
    `  历史 verdict / 报告 / 回执仍保留在 reports 与 doc/features 下。`,
    '',
    'CLAUDE.md §5.1 把"四份物理凭证齐全"作为闭环判据；本提示是物理拦截层在',
    '提醒你做出选择，不是要求"必须立刻完成"。继续 / 放弃二选一即可。',
  ];
  return lines.join('\n');
}

function buildAdvisory(state, stale) {
  const phase = state.phase ?? 'unknown';
  const feature = state.feature ?? 'unknown';
  const lines = [
    `[Stop Hook 提示] 检测到一个旧的阶段状态文件，但与当前会话无关：`,
    `  feature = "${feature}"`,
    `  phase   = "${phase}"`,
    `  原因    = ${stale.reasonHuman}`,
    `  state file = framework/harness/state/.current-phase.json`,
    '',
    '本次 stop 已放行；上面这条状态不会拦截你。',
    '如果不再需要这份遗留状态，可执行：',
    `  cd framework/harness && npx ts-node harness-runner.ts --clear-state`,
  ];
  return lines.join('\n');
}

// --------------------------------------------------------------------------
// 8. 主流程
// --------------------------------------------------------------------------

async function main() {
  const payload = await readStdin();

  // stop_hook_active=true → 本次 stop 已经被拦过一次，避免无限循环
  if (payload && payload.stop_hook_active === true) {
    process.exit(0);
    return;
  }

  // goal-runner 拉起的无头进程：闭环裁决由 goal-runner 外部管理，hook 不干预
  // env 名 SSOT：framework/harness/scripts/utils/phase-state.ts → MAISON_GOAL_HEADLESS_ENV
  if (process.env.MAISON_GOAL_HEADLESS === '1') {
    process.exit(0);
    return;
  }

  const projectRoot = resolveProjectRoot(payload);

  // 默认状态文件路径；若 framework.config.json 自定义了 paths.state_file，hook 也读那个
  const stateRel =
    readStateFileRelFromConfig(projectRoot) ?? 'framework/harness/state/.current-phase.json';
  const stateAbs = path.resolve(projectRoot, stateRel);

  const state = readJSONSafe(stateAbs);

  // 没有 state file → 不在阶段流程内，放行
  if (!state) {
    process.exit(0);
    return;
  }

  // 拿当前会话 id
  const sid =
    typeof payload?.session_id === 'string' && payload.session_id.trim()
      ? payload.session_id.trim()
      : null;

  // 拿 grace / ttl 时间常量（从 framework.config.json）
  const { gracePeriodMs, ttlMs } = readStateMachineFromConfig(projectRoot);

  // 算 staleness
  const stale = evaluateSessionStaleness(state, sid, gracePeriodMs, ttlMs, Date.now());

  // 陈旧 → advisory + exit 0
  if (stale.isStale) {
    process.stderr.write(buildAdvisory(state, stale) + '\n');
    process.exit(0);
    return;
  }

  // 当前会话遗留：盖章（如需要） + 更新 last_seen
  if (sid) {
    maybeUpdateState(stateAbs, state, sid, stale.shouldStamp);
  }

  // 走闭环判定
  const result = evaluateState(state);
  if (result.allow) {
    process.exit(0);
    return;
  }

  // 未闭环 → 中性文案 + exit 2
  const reason = buildBlockReason(state, result.missing, readSummaryHint(projectRoot, state));
  const decision = {
    decision: 'block',
    reason,
  };
  process.stdout.write(JSON.stringify(decision));
  process.stderr.write(reason + '\n');
  process.exit(2);
}

// 仅当作为 CLI 入口时执行 main；通过 import 引入做单元测试时跳过。
const invokedAsCli = (() => {
  try {
    const argv1 = process.argv[1];
    if (!argv1) return false;
    return path.resolve(argv1) === path.resolve(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (invokedAsCli) {
  main().catch((err) => {
    // 即使 hook 自己出错，也只 warn 给用户，不阻止 stop（避免把仓库变成"出门也要敲三下"）
    process.stderr.write(`[check-phase-completion hook] internal error: ${err?.message ?? err}\n`);
    process.exit(0);
  });
}
