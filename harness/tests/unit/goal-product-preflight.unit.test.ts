// ============================================================================
// goal-product-preflight.unit.test.ts — goal 启动前置检查的真实 runner 行为（review P1）
// ============================================================================
// 用 goal-run-driver **子进程**跑真实 goal run（signal-handler 污染隔离——
// goalMain() 的进程级动作会污染 run-unit 进程，见 goal-run-driver.ts 头注；
// 本轮 P1 曾退回进程内 goalMain → 全量跑 exit 130，已改回子进程）：
//   - 父测试进程**不得 import/调用 goalMain**（只 spawn driver）；
//   - env 注入经 driver 的 `KEY=VALUE` extra 传给**子进程**（父进程零残留）。
// 断言多候选且未确认的 goal run：
//   - 在**首个 phase agent invocation 之前** halt（phase_halt + run_end{HALTED}）；
//   - 非零退出；**零 phase invocation**（phaseStartsThisCall 空、agentCalls 0）；
//   - `HARNESS_DEVICE_TEST_PRODUCT` 不能绕过 coding 起点的完整链路
//     （purpose 按首个需 product 的 phase 解析，env 只解除 testing-only 链路）。
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { RESULT_MARK, type GoalRunOutcome } from '../helpers/goal-run-driver';
import type { UnitCaseResult } from '../run-unit';

const FEATURE = 'pc-preflight';
const DRIVER = path.resolve(__dirname, '..', 'helpers', 'goal-run-driver.ts');
const TS_NODE = path.resolve(__dirname, '..', '..', 'node_modules', 'ts-node', 'dist', 'bin.js');

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function git(root: string, args: string[]): void {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
}
function writeFile(root: string, rel: string, content: string): void {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf-8');
}

/** 最小可跑宿主：hmos-app + **多候选** build-profile + 未确认（无 local 确认记录）。 */
function setupMultiCandidateHost(): { root: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gr-ps-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  writeFile(root, 'framework.config.json', JSON.stringify({
    schema_version: '1.1',
    project_name: 'PSInt',
    project_profile: { name: 'hmos-app', sub_variant: 'app' },
    architecture: {
      outer_layers: [{ id: '02-Feature', can_depend_on: [], intra_layer_deps: 'dag' }],
      module_inner_layers: ['shared'],
      inner_dependency_direction: 'upward',
      cross_module_exports_file: 'index.ets',
    },
    paths: { features_dir: 'doc/features', docs_committed: false, reports_dir_pattern: 'doc/features/<feature>/<phase>/reports' },
    materialized_adapters: ['cursor'],
  }, null, 2));
  writeFile(root, 'AGENTS.md', '# AGENTS\n');
  // 多候选 build-profile：product + mirror——无任何确认 → unresolved
  writeFile(root, 'build-profile.json5', JSON.stringify({
    app: { products: [{ name: 'product' }, { name: 'mirror' }] },
    modules: [{ name: 'FinancialCard', srcPath: './02-Feature/FinancialCard' }],
  }, null, 2));
  writeFile(root, '02-Feature/FinancialCard/src/main/ets/AllBanksPage.ets',
    'struct AllBanksPage { build() { Text("x") } }');
  // DevEco 工具链前置（runGoalPreflight 要求 personal setup 通过；与 goal-run-driver
  // provisionHmosGoalFixture 同口径：hvigorBin + 假可执行文件）
  writeFile(root, 'fake-tools/hvigor.js', '// fake hvigor for product-selection scenarios\n');
  writeFile(root, 'framework.local.json', JSON.stringify({
    schema_version: '1.0',
    agent_adapter: 'cursor',
    toolchain: { devEcoStudio: { hvigorBin: path.join(root, 'fake-tools', 'hvigor.js') } },
    vision: {
      canary: {
        adapter: 'cursor', verdict: 'tool_read', probed_at: new Date().toISOString(),
        probed_via: 'interactive', probe_version: 2,
      },
    },
  }, null, 2));
  // 02-Feature 目录已由 PRODUCT_FILE 创建（declared_product_layer_missing 检查的层在场）
  writeFile(root, `doc/features/${FEATURE}/spec/spec.md`, '# spec\n');
  writeFile(root, `doc/features/${FEATURE}/acceptance.yaml`, `feature: ${FEATURE}\ncriteria: []\n`);
  writeFile(root, `doc/features/${FEATURE}/plan/plan.md`, '# plan\n');
  writeFile(root, `doc/features/${FEATURE}/contracts.yaml`,
    `feature: ${FEATURE}\nfiles:\n  - 02-Feature/FinancialCard/src/main/ets/AllBanksPage.ets\n`);
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'init']);
  return { root };
}

/** spawn 子进程 driver（真实 goalMain 只在子进程内跑；父进程零 import/调用 goalMain）。 */
function runDriver(projectRoot: string, envSpec?: string): GoalRunOutcome {
  const r = spawnSync(
    process.execPath,
    [
      TS_NODE, '--transpile-only', DRIVER,
      'product_selection_halt', FEATURE, '-', projectRoot,
      ...(envSpec ? [envSpec] : []),
    ],
    { encoding: 'utf-8', timeout: 300_000, cwd: path.resolve(__dirname, '..', '..') },
  );
  const at = (r.stdout ?? '').lastIndexOf(RESULT_MARK);
  if (at < 0) {
    throw new Error(
      `driver 未返回结果（exit ${r.status}）：\n${(r.stdout ?? '').slice(-800)}\n${(r.stderr ?? '').slice(-800)}`,
    );
  }
  return JSON.parse((r.stdout ?? '').slice(at + RESULT_MARK.length)) as GoalRunOutcome;
}

function assertHaltedUnresolved(out: GoalRunOutcome, label: string): void {
  const detail = JSON.stringify({ ...out, eventTypes: undefined });
  assert(out.error === null, `${label}: driver 不得抛异常：${detail}`);
  assert(out.exitCode === 1, `${label}: 必须非零退出（实际 ${out.exitCode}）：${detail}`);
  assert(
    out.phaseHalts.some(h => h.halt_reason === 'product_selection_unresolved'),
    `${label}: 缺 phase_halt{product_selection_unresolved}：${detail}`,
  );
  assert(out.runEndStatus === 'HALTED', `${label}: run_end 须 HALTED（实际 ${out.runEndStatus}）：${detail}`);
  assert(out.phaseStartsThisCall.length === 0, `${label}: 必须零 phase 预算消耗：${detail}`);
  assert(out.agentCalls === 0, `${label}: 必须零 agent invocation：${detail}`);
}

const cases: Array<{ name: string; run: () => void }> = [];

{
  const name = 'goal 启动前置：多候选未确认 → phase_halt(product_selection_unresolved) + run_end{HALTED} + 非零退出 + 零 phase invocation（子进程 driver）';
  cases.push({
    name,
    run: () => {
      const { root } = setupMultiCandidateHost();
      try {
        const out = runDriver(root);
        assertHaltedUnresolved(out, name);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  });
}

{
  const name = 'goal 启动前置：HARNESS_DEVICE_TEST_PRODUCT 不能绕过 coding 起点的完整链路（env 只解除 testing-only）';
  cases.push({
    name,
    run: () => {
      const { root } = setupMultiCandidateHost();
      try {
        const out = runDriver(root, 'HARNESS_DEVICE_TEST_PRODUCT=mirror');
        assertHaltedUnresolved(out, name);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  });
}

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      c.run();
      results.push({ name: c.name, ok: true });
    } catch (e) {
      results.push({ name: c.name, ok: false, error: (e as Error).stack ?? (e as Error).message });
    }
  }
  return results;
}