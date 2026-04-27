#!/usr/bin/env node
// ============================================================================
// Stop hook：阶段闭环物理拦截（Layer 3 兜底）
// ============================================================================
// 触发时机：Claude Code CLI 在主 agent / 子 agent 即将结束消息时调用 Stop /
// SubagentStop 事件。本 hook 注册在 Stop 事件上。
//
// 协议（Claude Code Hooks 官方约定）：
//   - 输入：stdin 收到 JSON，含 session_id / transcript_path / cwd /
//     hook_event_name / stop_hook_active 等字段。
//   - 输出：
//     * 写 JSON 到 stdout：{"decision":"block","reason":"..."} 或 {"decision":"approve"}。
//     * 或者用 exit code：
//         exit 0  → 静默放行
//         exit 2  → 阻止 stop 并把 stderr 内容注入下一轮 prompt
//         其它    → 仅打印 stderr 给用户，不阻止
//   - stop_hook_active=true 表示本次 stop 已经被某个 hook 拦过一次；为避免
//     无限循环，本 hook 必须直接放行。
//
// 闭环判据（与 CLAUDE.md §5.1 / framework/harness/harness-runner.ts 对齐）：
//   读取 framework/harness/state/.current-phase.json：
//     - 文件不存在            → 放行（不在阶段流程中）
//     - status='running'      → 阻止（harness 还没跑完就想 stop = 假完成）
//     - status='harness_finished' 且：
//         verdict='PASS'         AND
//         blocker_count===0      AND
//         receipt.status='passed' → 放行
//       否则 → 阻止，并把缺失项原文注入下一轮 prompt。
//
// 跨平台：纯 Node.js + path/url，不依赖任何 shell 或 PowerShell 特性。
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

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
// 3. 闭环判定
// --------------------------------------------------------------------------

function evaluateState(state) {
  // 返回 { allow: boolean, reason: string, missing: string[] }
  if (!state || typeof state !== 'object') {
    return { allow: true, reason: 'no-state-file', missing: [] };
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
// 4. 主流程
// --------------------------------------------------------------------------

async function main() {
  const payload = await readStdin();

  // stop_hook_active=true → 本次 stop 已经被拦过一次，避免无限循环
  if (payload && payload.stop_hook_active === true) {
    process.exit(0);
    return;
  }

  const projectRoot = resolveProjectRoot(payload);

  // 默认状态文件路径；与 framework/harness/config.ts 的 DEFAULT_PATHS.state_file 保持一致
  // 若 framework.config.json 自定义了 paths.state_file，hook 也读那个；这里走轻量
  // 解析（避免 hook 引入 ts-node / typescript 依赖）。
  const stateRel = readStateFileRelFromConfig(projectRoot)
    ?? 'framework/harness/state/.current-phase.json';
  const stateAbs = path.resolve(projectRoot, stateRel);

  const state = readJSONSafe(stateAbs);

  // 没有 state file → 不在阶段流程内，放行
  if (!state) {
    process.exit(0);
    return;
  }

  const result = evaluateState(state);
  if (result.allow) {
    process.exit(0);
    return;
  }

  // 阻止 stop 并把缺失项注入下一轮 prompt
  const phase = state.phase ?? 'unknown';
  const feature = state.feature ?? 'unknown';
  const reasonLines = [
    `[Stop Hook 阻止] 当前阶段 phase="${phase}", feature="${feature}" 未闭环（CLAUDE.md §5.1 四条件未满足）：`,
    '',
    ...result.missing.map((m) => `  - ${m}`),
    '',
    '请立即执行剩余步骤，**不要再次声称完成**。本次结束属于"假完成"，违反 CLAUDE.md §6.5 反假设条款。',
    '',
    '修复指引（按缺哪一项做哪一项）：',
    '  1. 主 agent 自跑：cd framework/harness && npx ts-node harness-runner.ts \\',
    `      --phase ${phase} --feature ${feature}`,
    '  2. 通过 Task 工具调用 verifier 子 agent（subagent_type=verifier），并把 feature/phase/报告路径完整传入。',
    '  3. 填写阶段完成回执：',
    `       模板：framework/harness/templates/phase-completion-receipt.md`,
    `       目标：doc/features/${feature}/${phase}/phase-completion-receipt.md`,
    '  4. 重跑 harness-runner.ts，使其回填 receipt.status=passed 后再尝试 stop。',
    '',
    '严禁以"我假设 / 通常这样 / 为安全起见"为由跳过任意一步——CLAUDE.md §6.5 已明确这就是任务失败。',
  ];
  const reason = reasonLines.join('\n');

  // 优先用 JSON 协议（Claude Code Hooks 推荐做法）
  const decision = {
    decision: 'block',
    reason,
  };
  process.stdout.write(JSON.stringify(decision));
  process.stderr.write(reason + '\n');
  process.exit(2);
}

// --------------------------------------------------------------------------
// 5. 轻量 framework.config.json 解析（避免 hook 引入 ts-node）
// --------------------------------------------------------------------------

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

main().catch((err) => {
  // 即使 hook 自己出错，也只 warn 给用户，不阻止 stop（避免把仓库变成"出门也要敲三下"）
  process.stderr.write(`[check-phase-completion hook] internal error: ${err?.message ?? err}\n`);
  process.exit(0);
});
