// ============================================================================
// hook-stale-state.unit.test.ts — Stop hook 跨会话隔离 + 闭环判定 端到端回归
// ============================================================================
//
// 为什么写这层（而不是纯函数 import 测）：
//   实例根 Stop hook（ESM）与 framework/harness 单测通过 child_process 对接。
//   tsconfig.module=commonjs；在 commonjs 入口同步 import ESM 不友好。
//   改用 child_process.spawnSync 直接驱动 hook 进程：
//     - 测的是真实端到端行为（exit code + stdout/stderr + state 文件回写）；
//     - 与 hook 内部实现解耦：未来重构成 lib 抽包也不影响这层；
//     - 同时挂上"配置一致性"检查（T11）防 HOOK_DEFAULT_* 与 DEFAULT_STATE_MACHINE 漂移。
//
// 覆盖矩阵（13+ case，对齐 Stop hook 跨会话隔离设计说明）：
//   T1  同会话 + 闭环达成        → exit 0
//   T2  同会话 + 未闭环          → exit 2 + 中性文案（包含"继续 / 放弃二选一"）
//   T3  跨会话遗留               → exit 0 + advisory（"与当前会话无关"）
//   T4  老 state 无 sid + 在 grace 内 + 闭环 → exit 0 + state 被盖章
//   T5  老 state 无 sid + 超 grace             → exit 0 + advisory（legacy）
//   T6  payload 无 sid + 已盖章 + 在 ttl 内 + 闭环 → exit 0
//   T7  payload 无 sid + 已盖章 + 超 ttl       → exit 0 + advisory（ttl-expired）
//   T8  stop_hook_active=true                  → exit 0（无条件放行）
//   T9  自定义 grace_period_minutes=1（缩短）  → 2 分钟未盖章 state 即视为遗留
//   T10 自定义 ttl_hours=1（缩短）             → 2 小时无 sid + 已盖章 state 即视为陈旧
//   T11 配置一致性：HOOK_DEFAULT_* 与 DEFAULT_STATE_MACHINE 数值匹配
//   T12 非法配置（grace 超范围 / ttl 字符串）  → hook 端回退默认值，不崩
//
// 退出码：runAll() 返回每用例 ok/fail；run-unit.ts 汇总后 exit。
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync, type SpawnSyncReturns } from 'child_process';

import { DEFAULT_STATE_MACHINE } from '../../config';
import { detectRepoLayout, frameworkAbs } from '../../repo-layout';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

// --------------------------------------------------------------------------
// 路径定位
// --------------------------------------------------------------------------

const LAYOUT = detectRepoLayout(__dirname);
const HOOK_PATH = frameworkAbs(LAYOUT, 'agents/claude/templates/hooks/check-phase-completion.mjs');

// --------------------------------------------------------------------------
// fixture 工具
// --------------------------------------------------------------------------

interface FixtureOptions {
  /**
   * 已闭环 state（status=harness_finished + verdict=PASS + blocker_count=0 + receipt.status=passed）
   * vs 未闭环。默认未闭环（更接近 hook 默认拦截路径）。
   */
  closed?: boolean;
  /** state.session_id；undefined 表示该字段不写入；null 表示显式写 null（"未盖章"语义） */
  stateSessionId?: string | null | undefined;
  /** state.updated_at 相对当前时间偏移（毫秒，负值=过去） */
  updatedAtOffsetMs?: number;
  /** state file 是否写出（默认 true） */
  writeStateFile?: boolean;
  /** framework.config.json 的 state_machine 段；不传则不写本字段（走 hook 默认值） */
  stateMachine?: { grace_period_minutes?: unknown; ttl_hours?: unknown } | null;
  /** state.phase；默认 'coding'。全局阶段（extensions / init / catalog / glossary / docs）触发 hook 兜底放行路径。 */
  phaseOverride?: string;
  /** 可选写入 reports/<feature>/<phase>/summary.json，供 hook 阻断文案读取 next_action。 */
  summaryNextAction?: string;
}

function makeFixture(opts: FixtureOptions): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-stale-'));
  // 永远写一份最小可用的 framework.config.json，保证 hook 走 paths.state_file 默认路径解析
  const cfg: Record<string, unknown> = {
    schema_version: '1.0',
    project_name: 'unit-test',
    project_type: 'app',
    agent_adapter: 'claude',
    architecture: {
      outer_layers: [],
      module_inner_layers: ['shared', 'data', 'domain', 'presentation'],
      inner_dependency_direction: 'upward',
      cross_module_exports_file: 'index.ets',
    },
    paths: {
      features_dir: 'doc/features',
      module_catalog: 'doc/module-catalog.yaml',
      glossary: 'doc/glossary.yaml',
      glossary_seed: 'doc/glossary-seed.txt',
      architecture_md: 'doc/architecture.md',
      state_file: 'framework/harness/state/.current-phase.json',
      receipt_dir_pattern: 'doc/features/<feature>/<phase>',
      reports_dir_pattern: 'doc/features/<feature>/<phase>/reports',
    },
  };
  if (opts.stateMachine !== undefined && opts.stateMachine !== null) {
    cfg.state_machine = opts.stateMachine;
  }
  fs.writeFileSync(path.join(dir, 'framework.config.json'), JSON.stringify(cfg, null, 2), 'utf-8');

  const writeState = opts.writeStateFile !== false;
  if (writeState) {
    const stateAbs = path.join(dir, 'framework', 'harness', 'state', '.current-phase.json');
    fs.mkdirSync(path.dirname(stateAbs), { recursive: true });

    const updatedAt = new Date(Date.now() + (opts.updatedAtOffsetMs ?? 0)).toISOString();
    const state: Record<string, unknown> = {
      schema_version: '1.1',
      phase: opts.phaseOverride ?? 'coding',
      feature: 'demo-feature',
      status: opts.closed ? 'harness_finished' : 'running',
      updated_at: updatedAt,
    };
    if (opts.closed) {
      state.verdict = 'PASS';
      state.blocker_count = 0;
      state.receipt = {
        status: 'passed',
        receipt_path: 'doc/features/demo-feature/coding/phase-completion-receipt.md',
      };
    }
    if (opts.stateSessionId !== undefined) {
      state.session_id = opts.stateSessionId;
    }
    fs.writeFileSync(stateAbs, JSON.stringify(state, null, 2) + '\n', 'utf-8');
  }
  if (opts.summaryNextAction) {
    const phase = opts.phaseOverride ?? 'coding';
    const summaryAbs = path.join(dir, 'doc', 'features', 'demo-feature', phase, 'reports', 'summary.json');
    fs.mkdirSync(path.dirname(summaryAbs), { recursive: true });
    fs.writeFileSync(summaryAbs, JSON.stringify({
      schema_version: '1.0',
      phase,
      feature: 'demo-feature',
      verdict: 'FAIL',
      blocker_count: 1,
      fail_count: 1,
      warn_count: 0,
      script_report: `doc/features/demo-feature/${phase}/reports/script-report.json`,
      merged_report: `doc/features/demo-feature/${phase}/reports/merged-report.md`,
      ai_prompt: `doc/features/demo-feature/${phase}/reports/ai-prompt.md`,
      summary_json: `doc/features/demo-feature/${phase}/reports/summary.json`,
      run_statuses: [],
      readiness_signals: [],
      blocking_warnings: [],
      blocking_skips: [],
      blockers: [],
      next_action: opts.summaryNextAction,
    }, null, 2), 'utf-8');
  }
  return dir;
}

function readState(dir: string): Record<string, unknown> | null {
  const p = path.join(dir, 'framework', 'harness', 'state', '.current-phase.json');
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function rmDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

interface HookOutcome {
  status: number;
  stdout: string;
  stderr: string;
}

function runHook(
  payload: Record<string, unknown>,
  projectDir: string,
  extraEnv?: NodeJS.ProcessEnv,
): HookOutcome {
  const env: NodeJS.ProcessEnv = { ...process.env, CLAUDE_PROJECT_DIR: projectDir, ...extraEnv };
  const inputJson = JSON.stringify({ ...payload, cwd: projectDir });
  const r: SpawnSyncReturns<string> = spawnSync('node', [HOOK_PATH], {
    input: inputJson,
    env,
    encoding: 'utf-8',
    timeout: 15_000,
  });
  return {
    status: typeof r.status === 'number' ? r.status : -1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  };
}

// --------------------------------------------------------------------------
// 断言工具
// --------------------------------------------------------------------------

function assertEq<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`);
  }
}

function assertStderrContains(out: HookOutcome, snippet: string, label: string): void {
  if (!out.stderr.includes(snippet)) {
    throw new Error(`${label}\n    stderr does not contain: ${snippet}\n    full stderr: ${out.stderr}`);
  }
}

function assertStderrNotContains(out: HookOutcome, snippet: string, label: string): void {
  if (out.stderr.includes(snippet)) {
    throw new Error(`${label}\n    stderr unexpectedly contains: ${snippet}`);
  }
}

// --------------------------------------------------------------------------
// 用例
// --------------------------------------------------------------------------

function testT1_sameSessionClosed(): void {
  const dir = makeFixture({
    closed: true,
    stateSessionId: 'sid-A',
    updatedAtOffsetMs: -1000,
  });
  try {
    const out = runHook({ session_id: 'sid-A' }, dir);
    assertEq(out.status, 0, 'T1 同会话 + 闭环 → exit 0');
    assertStderrNotContains(out, '未闭环阶段', 'T1 不应给出阻断文案');
  } finally {
    rmDir(dir);
  }
}

function testT2_sameSessionUnclosed(): void {
  const dir = makeFixture({
    closed: false,
    stateSessionId: 'sid-A',
    updatedAtOffsetMs: -1000,
  });
  try {
    const out = runHook({ session_id: 'sid-A' }, dir);
    assertEq(out.status, 2, 'T2 同会话 + 未闭环 → exit 2');
    assertStderrContains(out, '未闭环阶段', 'T2 stderr 应包含中性提示开头');
    assertStderrContains(out, '继续这个阶段', 'T2 stderr 应给出继续路径');
    assertStderrContains(out, '--clear-state', 'T2 stderr 应给出放弃路径');
    assertStderrNotContains(out, '假完成', 'T2 不应再用旧版"假完成"措辞');
  } finally {
    rmDir(dir);
  }
}

function testT3_crossSession(): void {
  // 跨会话遗留：state 写有 sid-old，本会话 sid-new；即便 state 未闭环也应放行
  const dir = makeFixture({
    closed: false,
    stateSessionId: 'sid-old',
    updatedAtOffsetMs: -60 * 1000,
  });
  try {
    const out = runHook({ session_id: 'sid-new' }, dir);
    assertEq(out.status, 0, 'T3 跨会话 → exit 0');
    assertStderrContains(out, '与当前会话无关', 'T3 stderr 应是 advisory 文案');
    assertStderrContains(out, 'session_id=', 'T3 stderr 应附带 session_id 比较信息');
  } finally {
    rmDir(dir);
  }
}

function testT4_unstampedInGraceStamps(): void {
  // state.session_id=null + updated_at=now-1min（默认 grace=5min）→ 视为同会话刚跑完，盖章
  const dir = makeFixture({
    closed: true,
    stateSessionId: null,
    updatedAtOffsetMs: -60 * 1000,
  });
  try {
    const out = runHook({ session_id: 'sid-A' }, dir);
    assertEq(out.status, 0, 'T4 未盖章 + 在 grace 内 + 闭环 → exit 0');
    const stateAfter = readState(dir);
    assertEq(stateAfter?.session_id, 'sid-A', 'T4 hook 应回写 session_id');
    if (typeof stateAfter?.session_id_recorded_at !== 'string') {
      throw new Error('T4 应同时写入 session_id_recorded_at');
    }
    assertEq(stateAfter?.last_seen_session_id, 'sid-A', 'T4 应同步刷新 last_seen_session_id');
  } finally {
    rmDir(dir);
  }
}

function testT5_unstampedExceedsGrace(): void {
  // updated_at=now-10min，超过默认 5min grace → stale-legacy-no-sid
  const dir = makeFixture({
    closed: false,
    stateSessionId: null,
    updatedAtOffsetMs: -10 * 60 * 1000,
  });
  try {
    const out = runHook({ session_id: 'sid-A' }, dir);
    assertEq(out.status, 0, 'T5 超 grace 视为 legacy → exit 0');
    assertStderrContains(out, '前一次会话遗留', 'T5 stderr 应说明 legacy 原因');
    const stateAfter = readState(dir);
    assertEq(stateAfter?.session_id ?? null, null, 'T5 不应给老 state 盖章');
  } finally {
    rmDir(dir);
  }
}

function testT6_payloadNoSidStateStampedInTtl(): void {
  // payload 没 sid + state 已盖章 + 1 小时前更新（默认 ttl=12h）+ 闭环 → exit 0
  const dir = makeFixture({
    closed: true,
    stateSessionId: 'sid-X',
    updatedAtOffsetMs: -60 * 60 * 1000,
  });
  try {
    const out = runHook({}, dir);
    assertEq(out.status, 0, 'T6 payload 无 sid + 已盖章 + 在 ttl 内 + 闭环 → exit 0');
    assertStderrNotContains(out, '与当前会话无关', 'T6 不应给 advisory（被视作同会话）');
  } finally {
    rmDir(dir);
  }
}

function testT7_payloadNoSidStateStampedExceedsTtl(): void {
  // updated_at=now-13h，超过默认 12h ttl
  const dir = makeFixture({
    closed: false,
    stateSessionId: 'sid-X',
    updatedAtOffsetMs: -13 * 60 * 60 * 1000,
  });
  try {
    const out = runHook({}, dir);
    assertEq(out.status, 0, 'T7 超 ttl → exit 0');
    assertStderrContains(out, 'ttl', 'T7 stderr 应提到 ttl');
  } finally {
    rmDir(dir);
  }
}

function testT8_stopHookActive(): void {
  // stop_hook_active=true 即便 state 未闭环也应直接放行（避免无限循环）
  const dir = makeFixture({
    closed: false,
    stateSessionId: 'sid-A',
    updatedAtOffsetMs: -1000,
  });
  try {
    const out = runHook({ session_id: 'sid-A', stop_hook_active: true }, dir);
    assertEq(out.status, 0, 'T8 stop_hook_active=true → exit 0');
    assertStderrNotContains(out, '未闭环阶段', 'T8 不应给阻断文案');
  } finally {
    rmDir(dir);
  }
}

function testT9_customGracePeriodShortened(): void {
  // grace=1min；state.session_id=null updated_at=now-2min → 超 grace → legacy
  const dir = makeFixture({
    closed: true,
    stateSessionId: null,
    updatedAtOffsetMs: -2 * 60 * 1000,
    stateMachine: { grace_period_minutes: 1, ttl_hours: 12 },
  });
  try {
    const out = runHook({ session_id: 'sid-A' }, dir);
    assertEq(out.status, 0, 'T9 自定义 grace 1min + 2min 未盖章 → 视为 legacy → exit 0');
    assertStderrContains(out, '前一次会话遗留', 'T9 应被识别为 legacy');
  } finally {
    rmDir(dir);
  }
}

function testT10_customTtlShortened(): void {
  // ttl=1h；payload 无 sid + state 已盖章 updated_at=now-2h → 超 ttl
  const dir = makeFixture({
    closed: false,
    stateSessionId: 'sid-X',
    updatedAtOffsetMs: -2 * 60 * 60 * 1000,
    stateMachine: { grace_period_minutes: 5, ttl_hours: 1 },
  });
  try {
    const out = runHook({}, dir);
    assertEq(out.status, 0, 'T10 自定义 ttl 1h + 2h 已盖章 → 视为陈旧 → exit 0');
    assertStderrContains(out, 'ttl', 'T10 应提到 ttl 兜底');
  } finally {
    rmDir(dir);
  }
}

function testT11_configConsistency(): void {
  // 直接读 hook 文件，正则提取 HOOK_DEFAULT_GRACE_MS / HOOK_DEFAULT_TTL_MS；
  // 与 config.ts 的 DEFAULT_STATE_MACHINE 比对——防止两边漂移。
  const hookSrc = fs.readFileSync(HOOK_PATH, 'utf-8');

  const graceMatch = /HOOK_DEFAULT_GRACE_MS\s*=\s*(\d+)\s*\*\s*60\s*\*\s*1000/.exec(hookSrc);
  const ttlMatch = /HOOK_DEFAULT_TTL_MS\s*=\s*(\d+)\s*\*\s*60\s*\*\s*60\s*\*\s*1000/.exec(hookSrc);

  if (!graceMatch || !ttlMatch) {
    throw new Error(
      'T11 无法在 hook 文件提取 HOOK_DEFAULT_GRACE_MS / HOOK_DEFAULT_TTL_MS 字面量；' +
        '若实现已重构，请同步调整本测试或抽出共享常量。',
    );
  }
  const hookGraceMin = Number(graceMatch[1]);
  const hookTtlHour = Number(ttlMatch[1]);

  assertEq(
    hookGraceMin,
    DEFAULT_STATE_MACHINE.grace_period_minutes,
    'T11 hook HOOK_DEFAULT_GRACE_MS 与 DEFAULT_STATE_MACHINE.grace_period_minutes 不一致',
  );
  assertEq(
    hookTtlHour,
    DEFAULT_STATE_MACHINE.ttl_hours,
    'T11 hook HOOK_DEFAULT_TTL_MS 与 DEFAULT_STATE_MACHINE.ttl_hours 不一致',
  );
}

function testT12_invalidConfigFallsBack(): void {
  // grace_period_minutes=999（超 60 上限） + ttl_hours='abc'（非数字）
  // hook 端应安静回退默认值（grace=5min、ttl=12h），按原逻辑判定。
  // 用 updated_at=now-2min（2 分钟）→ 默认 grace=5 内 → 同会话刚跑完 → 盖章 + 闭环 → exit 0
  const dir = makeFixture({
    closed: true,
    stateSessionId: null,
    updatedAtOffsetMs: -2 * 60 * 1000,
    stateMachine: { grace_period_minutes: 999, ttl_hours: 'abc' },
  });
  try {
    const out = runHook({ session_id: 'sid-A' }, dir);
    assertEq(out.status, 0, 'T12 非法 config + 默认 grace 内 + 闭环 → exit 0（hook 未崩）');
    const stateAfter = readState(dir);
    assertEq(stateAfter?.session_id, 'sid-A', 'T12 应按默认 grace 盖章');
  } finally {
    rmDir(dir);
  }
}

// --------------------------------------------------------------------------
// 全局阶段豁免（v2.8.1+）：extensions / init / catalog / glossary / docs 不参与
// 全局入口 §5.1 闭环判据：hook 看到 state.phase ∈ GLOBAL_PHASES 一律 allow。
// --------------------------------------------------------------------------

function testT13_globalPhaseInitBypassesClosure(): void {
  // 模拟 v2.8.0 时存在的污染 state（runner 当时给 init 也写了 state file），
  // 即使 receipt=null / verdict=null / status=running，hook 也必须放行。
  // 否则就会复现 /framework-init 跑到 Step 3 时 hook 拦截 + 自问自答事故。
  const dir = makeFixture({
    closed: false,
    phaseOverride: 'init',
    stateSessionId: 'sid-A',
    updatedAtOffsetMs: -1 * 60 * 1000,
  });
  try {
    const out = runHook({ session_id: 'sid-A' }, dir);
    assertEq(out.status, 0, 'T13 phase=init + 同会话 + receipt=null → 仍 exit 0（全局阶段豁免）');
    if (/receipt|未闭环|阶段完成回执/.test(out.stderr)) {
      throw new Error(
        `T13 hook 不应针对全局阶段输出闭环未达成提示，但 stderr 含拦截文案：${out.stderr.slice(0, 200)}`,
      );
    }
  } finally {
    rmDir(dir);
  }
}

function testT14_globalPhaseCatalogBypassesClosure(): void {
  // 同 T13，覆盖 catalog 全局阶段。glossary / docs 等同源，不再逐个枚举。
  const dir = makeFixture({
    closed: false,
    phaseOverride: 'catalog',
    stateSessionId: 'sid-A',
    updatedAtOffsetMs: -1 * 60 * 1000,
  });
  try {
    const out = runHook({ session_id: 'sid-A' }, dir);
    assertEq(out.status, 0, 'T14 phase=catalog + 同会话 + receipt=null → 仍 exit 0（全局阶段豁免）');
  } finally {
    rmDir(dir);
  }
}

function testT14b_globalPhaseExtensionsBypassesClosure(): void {
  // spec-driven workflow 将 extensions 列为 scope=global；须与 runner 不写 state + hook 兜底一致。
  const dir = makeFixture({
    closed: false,
    phaseOverride: 'extensions',
    stateSessionId: 'sid-A',
    updatedAtOffsetMs: -1 * 60 * 1000,
  });
  try {
    const out = runHook({ session_id: 'sid-A' }, dir);
    assertEq(
      out.status,
      0,
      'T14b phase=extensions + 同会话 + receipt=null → 仍 exit 0（全局阶段豁免）',
    );
  } finally {
    rmDir(dir);
  }
}

function testT16_goalHeadlessEnvBypassesStopHook(): void {
  // goal-runner 无头子进程树携带 MAISON_GOAL_HEADLESS=1 → 即使同会话未闭环也 exit 0
  const dir = makeFixture({
    closed: false,
    stateSessionId: 'sid-A',
    updatedAtOffsetMs: -1000,
  });
  try {
    const out = runHook({ session_id: 'sid-A' }, dir, { MAISON_GOAL_HEADLESS: '1' });
    assertEq(out.status, 0, 'T16 MAISON_GOAL_HEADLESS=1 + 未闭环 → exit 0（旁路）');
    if (/未闭环|阶段完成回执|Stop Hook 提示/.test(out.stderr)) {
      throw new Error(`T16 旁路时不应输出阻断文案：${out.stderr.slice(0, 200)}`);
    }
  } finally {
    rmDir(dir);
  }
}

function testT15_blockReasonIncludesSummaryNextAction(): void {
  const dir = makeFixture({
    closed: false,
    stateSessionId: 'sid-A',
    updatedAtOffsetMs: -1000,
    summaryNextAction: 'fix_run_status_blockers_then_rerun',
  });
  try {
    const out = runHook({ session_id: 'sid-A' }, dir);
    assertEq(out.status, 2, 'T15 同会话未闭环 + summary.json → exit 2');
    assertStderrContains(out, '最近一次 harness summary 建议', 'T15 应展示 summary 建议标题');
    assertStderrContains(out, 'next_action = fix_run_status_blockers_then_rerun', 'T15 应展示 next_action');
  } finally {
    rmDir(dir);
  }
}

// --------------------------------------------------------------------------
// 注册
// --------------------------------------------------------------------------

const CASES: Array<{ name: string; fn: () => void }> = [
  { name: 'T1 同会话 + 闭环 → exit 0', fn: testT1_sameSessionClosed },
  { name: 'T2 同会话 + 未闭环 → exit 2 + 中性文案', fn: testT2_sameSessionUnclosed },
  { name: 'T3 跨会话遗留 → exit 0 + advisory', fn: testT3_crossSession },
  { name: 'T4 未盖章 + 在 grace 内 + 闭环 → 自动盖章 → exit 0', fn: testT4_unstampedInGraceStamps },
  { name: 'T5 未盖章 + 超 grace → legacy advisory → exit 0', fn: testT5_unstampedExceedsGrace },
  { name: 'T6 payload 无 sid + 已盖章 + 在 ttl 内 + 闭环 → exit 0', fn: testT6_payloadNoSidStateStampedInTtl },
  { name: 'T7 payload 无 sid + 已盖章 + 超 ttl → ttl-expired advisory → exit 0', fn: testT7_payloadNoSidStateStampedExceedsTtl },
  { name: 'T8 stop_hook_active=true → exit 0', fn: testT8_stopHookActive },
  { name: 'T9 自定义 grace 缩短到 1min', fn: testT9_customGracePeriodShortened },
  { name: 'T10 自定义 ttl 缩短到 1h', fn: testT10_customTtlShortened },
  { name: 'T11 hook 默认值与 config DEFAULT_STATE_MACHINE 一致', fn: testT11_configConsistency },
  { name: 'T12 非法 config → hook 端回退默认值不崩', fn: testT12_invalidConfigFallsBack },
  { name: 'T13 phase=init 全局阶段 → 即使 receipt=null 也 exit 0', fn: testT13_globalPhaseInitBypassesClosure },
  { name: 'T14 phase=catalog 全局阶段 → 即使 receipt=null 也 exit 0', fn: testT14_globalPhaseCatalogBypassesClosure },
  {
    name: 'T14b phase=extensions 全局阶段 → 即使 receipt=null 也 exit 0',
    fn: testT14b_globalPhaseExtensionsBypassesClosure,
  },
  { name: 'T15 未闭环阻断文案包含 summary.next_action', fn: testT15_blockReasonIncludesSummaryNextAction },
  {
    name: 'T16 MAISON_GOAL_HEADLESS=1 旁路 Stop hook（未闭环仍 exit 0）',
    fn: testT16_goalHeadlessEnvBypassesStopHook,
  },
];

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];
  for (const c of CASES) {
    try {
      c.fn();
      results.push({ name: c.name, ok: true });
    } catch (err) {
      results.push({ name: c.name, ok: false, error: (err as Error).message });
    }
  }
  return results;
}
