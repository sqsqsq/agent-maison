// ============================================================================
// record-verifier-report-hook.unit.test.ts — SubagentStop hook goalHeadless 旁路
// ============================================================================
// 端到端驱动 agents/claude/templates/hooks/record-verifier-report.mjs（spawnSync）。
// 覆盖 Fix D：goal 无头链下不读旧 state 定位、不写回 state、兜底内容不伪装旧 feature。
//
// check-receipt 闭环中立性（Fix D 复核结论）：
//   goal-runner 当轮裁决读 fresh summary.verdict（goal-runner-phase.ts）；
//   check-receipt 对 verifier_subagent.report_path 做 BLOCKER，但 goal 无头链下
//   Fix B 已抑制 state 写入，Fix D 前 hook 在旧 X state 残留时会误写 X 目录，
//   Fix D 后统一落兜底——对 Y 的标准 verifier.report.md 路径两种情形均不存在，
//   故 Fix D closure-neutral，不新增 check-receipt 回归。
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync, type SpawnSyncReturns } from 'child_process';

import { detectRepoLayout, frameworkAbs } from '../../repo-layout';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

const LAYOUT = detectRepoLayout(__dirname);
const HOOK_PATH = frameworkAbs(
  LAYOUT,
  'agents/claude/templates/hooks/record-verifier-report.mjs',
);

interface FixtureOptions {
  feature?: string;
  phase?: string;
  writeState?: boolean;
}

function makeFixture(opts: FixtureOptions = {}): { dir: string; transcriptPath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rvr-hook-'));
  const feature = opts.feature ?? 'X';
  const phase = opts.phase ?? 'coding';

  fs.writeFileSync(
    path.join(dir, 'framework.config.json'),
    JSON.stringify(
      {
        schema_version: '1.0',
        project_name: 'unit-test',
        project_type: 'app',
        agent_adapter: 'claude',
        paths: {
          features_dir: 'doc/features',
          state_file: 'framework/harness/state/.current-phase.json',
          reports_dir_pattern: 'doc/features/<feature>/<phase>/reports',
        },
      },
      null,
      2,
    ),
    'utf-8',
  );

  if (opts.writeState !== false) {
    const stateAbs = path.join(dir, 'framework', 'harness', 'state', '.current-phase.json');
    fs.mkdirSync(path.dirname(stateAbs), { recursive: true });
    fs.writeFileSync(
      stateAbs,
      JSON.stringify(
        {
          schema_version: '1.1',
          feature,
          phase,
          status: 'running',
          updated_at: new Date().toISOString(),
        },
        null,
        2,
      ) + '\n',
      'utf-8',
    );
  }

  const transcriptDir = path.join(dir, 'transcripts');
  fs.mkdirSync(transcriptDir, { recursive: true });
  const transcriptPath = path.join(transcriptDir, 'verifier.jsonl');
  fs.writeFileSync(
    transcriptPath,
    JSON.stringify({
      role: 'assistant',
      content: 'Semantic review complete.\n\nverdict: PASS',
    }) + '\n',
    'utf-8',
  );

  return { dir, transcriptPath };
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

function runVerifierHook(
  payload: Record<string, unknown>,
  projectDir: string,
  extraEnv?: NodeJS.ProcessEnv,
): HookOutcome {
  const env: NodeJS.ProcessEnv = { ...process.env, CLAUDE_PROJECT_DIR: projectDir };
  delete env.MAISON_GOAL_HEADLESS;
  delete env.MAISON_GOAL_RUNNER;
  if (extraEnv) Object.assign(env, extraEnv);
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

function assertEq<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(
      `${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`,
    );
  }
}

function testA_goalHeadlessBypassesStaleState(): void {
  const { dir, transcriptPath } = makeFixture({ feature: 'X', phase: 'coding' });
  try {
    const out = runVerifierHook(
      { session_id: 'sid-goal-Y', transcript_path: transcriptPath },
      dir,
      { MAISON_GOAL_HEADLESS: '1' },
    );
    assertEq(out.status, 0, 'A exit 0');

    const featureReportMd = path.join(
      dir,
      'doc',
      'features',
      'X',
      'coding',
      'reports',
      'verifier.report.md',
    );
    if (fs.existsSync(featureReportMd)) {
      throw new Error(`A 不应写 X/coding verifier.report.md：${featureReportMd}`);
    }

    const fallbackMd = path.join(dir, 'framework', 'harness', 'state', 'last-verifier-report.md');
    const fallbackJson = path.join(dir, 'framework', 'harness', 'state', 'last-verifier-report.json');
    if (!fs.existsSync(fallbackMd) || !fs.existsSync(fallbackJson)) {
      throw new Error('A 应写 last-verifier-report.{md,json} 兜底');
    }

    const mdText = fs.readFileSync(fallbackMd, 'utf-8');
    const json = JSON.parse(fs.readFileSync(fallbackJson, 'utf-8')) as Record<string, unknown>;

    if (mdText.includes('feature: X') || mdText.includes('phase: coding')) {
      throw new Error('A fallback MD 不应含旧 X/coding 元数据');
    }
    if (!mdText.includes('goal_headless: true')) {
      throw new Error('A fallback MD 应含 goal_headless: true');
    }

    assertEq(json.feature, 'unknown', 'A JSON feature=unknown');
    assertEq(json.phase, 'unknown', 'A JSON phase=unknown');
    assertEq(json.goal_headless, true, 'A JSON goal_headless=true');
    assertEq(json.verdict, 'PASS', 'A JSON 保留 verdict');
    assertEq(json.session_id, 'sid-goal-Y', 'A JSON 保留 session_id');
    if (!json.transcript_path || !String(json.transcript_path).includes('verifier.jsonl')) {
      throw new Error('A JSON 应保留 transcript_path');
    }

    const state = readState(dir);
    if (!state) throw new Error('A state 文件应仍存在');
    if (state.last_verifier_report) {
      throw new Error('A 不应回写 last_verifier_report');
    }
    if (state.last_seen_session_id === 'sid-goal-Y') {
      throw new Error('A 不应刷新 last_seen_session_id');
    }
  } finally {
    rmDir(dir);
  }
}

function testB_interactiveUsesStateDirAndWriteback(): void {
  const { dir, transcriptPath } = makeFixture({ feature: 'X', phase: 'coding' });
  try {
    const out = runVerifierHook(
      { session_id: 'sid-main', transcript_path: transcriptPath },
      dir,
    );
    assertEq(out.status, 0, 'B exit 0');

    const featureReportMd = path.join(
      dir,
      'doc',
      'features',
      'X',
      'coding',
      'reports',
      'verifier.report.md',
    );
    const featureReportJson = path.join(
      dir,
      'doc',
      'features',
      'X',
      'coding',
      'reports',
      'verifier.report.json',
    );
    if (!fs.existsSync(featureReportMd) || !fs.existsSync(featureReportJson)) {
      throw new Error('B 应写 X/coding verifier.report.{md,json}');
    }

    const json = JSON.parse(fs.readFileSync(featureReportJson, 'utf-8')) as Record<string, unknown>;
    assertEq(json.feature, 'X', 'B JSON feature=X');
    assertEq(json.phase, 'coding', 'B JSON phase=coding');
    if (json.goal_headless === true) {
      throw new Error('B 交互式路径不应标 goal_headless');
    }

    const state = readState(dir);
    if (!state?.last_verifier_report) {
      throw new Error('B 应回写 last_verifier_report');
    }
    const lvr = state.last_verifier_report as Record<string, unknown>;
    assertEq(lvr.verdict, 'PASS', 'B state last_verifier_report.verdict');
    assertEq(state.last_seen_session_id, 'sid-main', 'B 应刷新 last_seen_session_id');
  } finally {
    rmDir(dir);
  }
}

const CASES: Array<{ name: string; fn: () => void }> = [
  {
    name: 'A MAISON_GOAL_HEADLESS=1 旁路：兜底落盘、内容不伪装 X、不回写 state',
    fn: testA_goalHeadlessBypassesStaleState,
  },
  {
    name: 'B 无 env 回归：按 state 写 feature 目录并回写 state',
    fn: testB_interactiveUsesStateDirAndWriteback,
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
