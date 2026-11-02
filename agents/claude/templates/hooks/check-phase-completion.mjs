#!/usr/bin/env node
// Stop observes the public completion reader; execution stays in the original GoalPhaseRuntime.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

export const HOOK_DEFAULT_GRACE_MS = 5 * 60 * 1000;
export const HOOK_DEFAULT_TTL_MS = 12 * 60 * 60 * 1000;
const HOOK_GRACE_MIN_MS = 1;
const HOOK_GRACE_MAX_MS = 60 * 60 * 1000;
const HOOK_TTL_MIN_MS = 60 * 60 * 1000;
const HOOK_TTL_MAX_MS = 168 * 60 * 60 * 1000;

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

const PROJECT_ROOT_MARKERS = [
  ['framework', 'agents', 'shared', 'guard-framework-write-core.mjs'],
  ['framework', 'harness', 'scripts', 'check-receipt.ts'],
];

function hasProjectRootMarker(root) {
  try {
    return PROJECT_ROOT_MARKERS.some((parts) => fs.existsSync(path.join(root, ...parts)));
  } catch {
    return false;
  }
}

function normalizeCandidate(value) {
  return typeof value === 'string' && value.trim() ? path.resolve(value.trim()) : null;
}

function resolveProjectRoot(payload) {
  let selfAnchor = null;
  try {
    selfAnchor = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  } catch {
    selfAnchor = null;
  }
  const envClaude = normalizeCandidate(process.env.CLAUDE_PROJECT_DIR);
  const envCodeagent = normalizeCandidate(process.env.CODEAGENT3_PROJECT_DIR);
  const payloadCwd = normalizeCandidate(payload && typeof payload.cwd === 'string' ? payload.cwd : null);
  const anchored = [envClaude, envCodeagent, selfAnchor, payloadCwd, process.cwd()].filter(Boolean);
  for (const cand of anchored) {
    if (hasProjectRootMarker(cand)) return cand;
  }
  return envClaude ?? envCodeagent ?? payloadCwd ?? process.cwd();
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

export function readStateMachineFromConfig(projectRoot) {
  const fallback = {
    gracePeriodMs: HOOK_DEFAULT_GRACE_MS,
    ttlMs: HOOK_DEFAULT_TTL_MS,
  };
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


/** Read-only CLI projection; the hook neither reconstructs evidence nor signs a conclusion. */
export function readCurrentCompletion(projectRoot, state) {
  const feature = typeof state?.feature === 'string' ? state.feature.trim() : '';
  if (!feature || feature === '_global') return null;
  const harnessRoot = path.join(projectRoot, 'framework', 'harness');
  try {
    const loader = createRequire(path.join(harnessRoot, 'package.json')).resolve('ts-node/register/transpile-only');
    const args = ['-r', loader, path.join(harnessRoot, 'scripts', 'assess.ts'), '--project-root', projectRoot,
      '--framework-root', path.dirname(harnessRoot), '--feature', feature,
      ...(typeof state.run_id === 'string' && state.run_id ? ['--run-id', state.run_id] : [])];
    const result = spawnSync(process.execPath, args, { cwd: harnessRoot, encoding: 'utf8', windowsHide: true,
      timeout: 30_000, env: { ...process.env, NODE_OPTIONS: '', TS_NODE_PROJECT: path.join(harnessRoot, 'tsconfig.json') } });
    if (result.error || result.status !== 0) return { error: result.error?.message ?? result.stderr ?? 'completion reader unavailable' };
    return JSON.parse(result.stdout);
  } catch (error) { return { error: error?.message ?? String(error) }; }
}

/** Only the existing public endpoint owns completion and current action labels. */
export function evaluateCompletion(view) {
  const current = view?.current_disposition ?? view?.feature_assessment?.current_disposition;
  const complete = view?.complete === true || view?.feature_assessment?.complete === true;
  if (current?.completionEligible === true && complete) return { allow: true, reason: 'completed', details: current.reasons ?? [] };
  const problems = current?.completionBlocking;
  if (Array.isArray(problems) && problems.length > 0 && problems.every(problem => problem.action === 'wait')) {
    return { allow: true, reason: 'waiting', details: current.reasons ?? [] };
  }
  return { allow: false, reason: 'unfinished', details: current?.reasons?.length ? current.reasons
    : [view?.error ?? '缺原请求的当前完成事实；保留未完成状态，由原协调器核实。'] };
}

function continuationCommand(projectRoot, state) {
  if (typeof state.run_id !== 'string' || !state.run_id || typeof state.adapter !== 'string' || !state.adapter)
    return '沿原请求实际返回的 next_command / execute_command / observe_command 交回同一 GoalPhaseRuntime；尚无绑定 run 时，用原用户请求接入 goal-mode-entry。';
  return ['node', '-r', path.join(projectRoot, 'framework/harness/node_modules/ts-node/register/transpile-only'),
    path.join(projectRoot, 'framework/harness/scripts/goal-mode-entry.ts'), '--project-root', projectRoot,
    '--framework-root', path.join(projectRoot, 'framework'), '--feature', state.feature, '--run-id', state.run_id,
    '--adapter', state.adapter, '--run-mode', 'attended', '--next']
    .map(value => JSON.stringify(value.replace(/\\/g, '/'))).join(' ');
}

async function main() {
  const payload = await readStdin();
  // A dedicated native invocation returns to the same outer coordinator on actual exit.
  if (process.env.MAISON_GOAL_HEADLESS === '1') return;
  const projectRoot = resolveProjectRoot(payload);
  const state = readJSONSafe(path.resolve(projectRoot, readStateFileRelFromConfig(projectRoot) ?? 'framework/harness/state/.current-phase.json'));
  if (!state || typeof state.feature !== 'string' || state.feature === '_global') return;
  const sid = typeof payload?.session_id === 'string' ? payload.session_id.trim() : null;
  const { gracePeriodMs, ttlMs } = readStateMachineFromConfig(projectRoot);
  const stale = evaluateSessionStaleness(state, sid, gracePeriodMs, ttlMs, Date.now());
  if (stale.isStale) {
    process.stderr.write(`[Stop Hook] 历史会话记录只读保留；本次没有承接该原请求：${stale.reasonHuman}\n`);
    return;
  }
  const view = readCurrentCompletion(projectRoot, state);
  if (!view) return;
  const result = evaluateCompletion(view);
  if (result.reason === 'completed') return;
  const reason = `[Stop Hook] 原请求${result.reason === 'waiting' ? '正在等待真实条件，仍未完成' : '仍有当前工作或核验未完成'}。\n`
    + result.details.join('\n') + '\n原协调器续接：' + continuationCommand(projectRoot, state);
  process.stderr.write(reason + '\n');
  if (!result.allow) {
    process.stdout.write(JSON.stringify({ decision: 'block', reason }));
    process.exitCode = 2;
  }
}

const invokedAsCli = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedAsCli) main().catch(error => {
  process.stderr.write(`[Stop Hook] 当前完成事实读取失败，原请求保留未完成：${error?.message ?? error}\n`);
  process.exitCode = 2;
});
