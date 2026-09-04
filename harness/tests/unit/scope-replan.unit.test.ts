// ============================================================================
// scope-replan.unit.test.ts — plan 授权（closure-only 语义）+ 单条失效记录
// 【pass snapshot 已退役 · runner-owned-machine-facts】原 B 组快照断言（head 退位/
// 内存锚/discard 幂等/字节不恢复）随机制删除；失效事实唯一落点=phase_backtrack_requested
// 事件本身。
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  checkPlanAuthority,
  resolveScopeReplanContext,
  sanitizeScopeReplanFiles,
  tryScopeReplan,
} from '../../scripts/utils/scope-replan';
import { buildScopeReplanContextBlock } from '../../scripts/goal-runner';
import {
  recomputePhaseEvidenceStaleness,
  resolvePhaseEvidenceManifest,
  writePhaseEvidenceManifest,
  writeReceiptManifestPointer,
} from '../../scripts/utils/phase-evidence-manifest';
import { makeClosedFeatureFixture } from '../utils/closed-feature-fixture';
import type { Phase } from '../../scripts/utils/types';
import { clearFrameworkConfigCache } from '../../config';
import type { UnitCaseResult } from '../run-unit';

const FRAMEWORK_ROOT = path.resolve(__dirname, '..', '..', '..');

const FEATURE = 'bc-openCard';
const RUN_ID = 'run-scope-replan-1';
const CHAIN = ['spec', 'plan', 'coding', 'review', 'ut', 'testing'];

function run(results: UnitCaseResult[], name: string, fn: () => void): void {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, error: (err as Error).stack ?? (err as Error).message });
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function writeFile(root: string, rel: string, content: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
}

function setupHost(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scope-replan-'));
  writeFile(root, 'framework.config.json', JSON.stringify({
    schema_version: '1.1',
    project_name: 'ScopeReplanTest',
    project_profile: { name: 'hmos-app', sub_variant: 'app' },
    architecture: {
      outer_layers: [{ id: '02-Feature', can_depend_on: [], intra_layer_deps: 'dag' }],
      module_inner_layers: ['shared'],
      inner_dependency_direction: 'upward',
      cross_module_exports_file: 'index.ets',
    },
    paths: { features_dir: 'doc/features', docs_committed: false },
    materialized_adapters: ['cursor'],
  }, null, 2));
  writeFile(root, `doc/features/${FEATURE}/plan/plan.md`, '# plan\n');
  writeFile(root, `doc/features/${FEATURE}/contracts.yaml`,
    `feature: ${FEATURE}\nfiles:\n  - 02-Feature/F/src/main/ets/pages/A.ets\n`);
  clearFrameworkConfigCache();
  return root;
}

/** 生产 writer 造 plan closure（回执 → evidence manifest → 回执指针）——与真实闭环同源 */
function closePlan(root: string): void {
  writeFile(root, `doc/features/${FEATURE}/plan/phase-completion-receipt.md`, `feature: "${FEATURE}"\nphase: "plan"\n`);
  const manifest = resolvePhaseEvidenceManifest({
    projectRoot: root, feature: FEATURE, phase: 'plan' as Phase,
    extraInputs: [], extraOutputs: [], frameworkRoot: FRAMEWORK_ROOT, requirementSha: null,
  });
  const written = writePhaseEvidenceManifest(root, manifest);
  const rel = path.relative(root, written.absPath).split(path.sep).join('/');
  writeReceiptManifestPointer(root, FEATURE, 'plan', rel, written.sha256);
}

function check(root: string) {
  return checkPlanAuthority({ projectRoot: root, feature: FEATURE, frameworkRoot: FRAMEWORK_ROOT });
}

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];

  // A 组：plan 授权=仓内 fresh closure（runner-owned-machine-facts 裁剪后语义）。
  // pass snapshot 已整体退役——授权链与任何 run 级缓存无关。

  run(results, 'A1 plan closure fresh → ok（closure 即授权，无需任何 run 级快照/内存锚）', () => {
    const root = setupHost();
    closePlan(root);
    const result = check(root);
    assert(result.kind === 'ok', `应放行：${JSON.stringify(result)}`);
  });

  run(results, 'A2（codex 验收 a+c）fresh coding-start 等价场景：无 checkpoint 缓存目录 → 照常放行', () => {
    const root = setupHost();
    closePlan(root);
    // 刻意不设 MAISON_GOAL_CHECKPOINT_DIR——授权不读 goal-checkpoints 临时缓存；
    // 宿主实锤 run 3aa520：旧实现在此必得 kind=none → 无处回退 → halt。
    const result = check(root);
    assert(result.kind === 'ok', `合法分段启动不得依赖临时缓存：${JSON.stringify(result)}`);
  });

  run(results, 'A3（codex 验收 d）contracts.yaml 真漂移 → live_drift 且点名文件', () => {
    const root = setupHost();
    closePlan(root);
    writeFile(root, `doc/features/${FEATURE}/contracts.yaml`, 'feature: changed\nfiles: []\n');
    const result = check(root);
    assert(result.kind === 'replan' && result.reason === 'live_drift', `实得 ${JSON.stringify(result)}`);
    if (result.kind === 'replan') {
      assert(result.affectedFiles.some(file => file.endsWith('contracts.yaml')), '应点名漂移文件');
    }
  });

  run(results, 'A4 closure 缺失/manifest 条目被改 → closure_untrusted（证明不了授权）', () => {
    const root = setupHost();
    // 未闭环：manifest 缺失
    const missing = check(root);
    assert(missing.kind === 'replan' && missing.reason === 'closure_untrusted', `manifest 缺失应拒：${JSON.stringify(missing)}`);
    // 闭环后改写 manifest 条目哈希（aggregate 自证失配 → tampered；plan 07a41ec6：回执指针已退出证据链，generated_at 不进 aggregate）
    closePlan(root);
    const manifestAbs = path.join(root, 'doc', 'features', FEATURE, 'plan', 'reports', 'phase-evidence-manifest.json');
    const doc = JSON.parse(fs.readFileSync(manifestAbs, 'utf-8')) as { outputs: Array<{ path: string; sha256: string | null }>; inputs: Array<{ path: string; sha256: string | null }> };
    const entry = [...doc.outputs, ...doc.inputs].find(e => e.path.endsWith('contracts.yaml')) ?? doc.outputs[0] ?? doc.inputs[0];
    entry.sha256 = 'f'.repeat(64);
    fs.writeFileSync(manifestAbs, JSON.stringify(doc, null, 2), 'utf-8');
    const tampered = check(root);
    assert(tampered.kind === 'replan' && tampered.reason === 'closure_untrusted', `manifest 改写应拒：${JSON.stringify(tampered)}`);
  });

  // B 组：tryScopeReplan——事件即失效事实的唯一落点（快照副作用已随机制删除）。

  run(results, 'B1 chain 缺 plan → unavailable 且零事件', () => {
    const root = setupHost();
    const events: Array<Record<string, unknown>> = [];
    const result = tryScopeReplan({
      projectRoot: root, feature: FEATURE, runId: RUN_ID, chain: ['coding', 'review'],
      endPhaseIdx: 1, phasesWithOutcome: null, backtracksUsed: 0, maxBacktracks: 2,
      trigger: 'ui_scope_violation', causePhase: 'coding', detail: 'x',
      emit: event => events.push(event),
    });
    assert(result.kind === 'unavailable' && result.reason === 'chain_lacks_plan', '应返回 chain_lacks_plan');
    assert(events.length === 0, '不可落副作用事件');
  });

  run(results, 'B2 回退预算耗尽 → unavailable 且零事件', () => {
    const root = setupHost();
    const events: Array<Record<string, unknown>> = [];
    const result = tryScopeReplan({
      projectRoot: root, feature: FEATURE, runId: RUN_ID, chain: CHAIN,
      endPhaseIdx: 2, phasesWithOutcome: null, backtracksUsed: 2, maxBacktracks: 2,
      trigger: 'ui_scope_violation', causePhase: 'coding', detail: 'x',
      emit: event => events.push(event),
    });
    assert(result.kind === 'unavailable' && result.reason === 'backtrack_budget_exhausted', '应返回预算耗尽');
    assert(events.length === 0, '不可落副作用事件');
  });

  run(results, 'B3 正常回退 → 只写一条原子失效请求 + 一条 started', () => {
    const root = setupHost();
    const events: Array<Record<string, unknown>> = [];
    const result = tryScopeReplan({
      projectRoot: root, feature: FEATURE, runId: RUN_ID, chain: CHAIN,
      endPhaseIdx: 2, phasesWithOutcome: ['plan', 'coding'], backtracksUsed: 0, maxBacktracks: 2,
      trigger: 'ui_scope_violation', causePhase: 'coding', affectedFiles: ['a.ets'], defects: ['d1'],
      fingerprint: 'fp-1', detail: 'scope drift',
      emit: event => events.push(event),
    });
    assert(result.kind === 'replanned', `实得 ${JSON.stringify(result)}`);
    assert(JSON.stringify(events.map(event => event.type)) === JSON.stringify(['phase_backtrack_requested', 'phase_backtrack_started']), '事件序列应收敛');
    const request = events[0];
    assert(Array.isArray(request.invalidated_phases) && JSON.stringify(request.invalidated_phases) === JSON.stringify(['plan', 'coding']), '失效范围应在单条记录中');
    assert(request.to_phase === 'plan' && request.reason === 'ui_scope_violation', '交接字段应完整');
    assert(request.invalidation_tx_id === (result.kind === 'replanned' ? result.txId : ''), 'tx id 应绑定');
  });

  run(results, 'B4 失效记录原子：不写逐 phase 失效事件、不建任何场外 journal', () => {
    const root = setupHost();
    const events: Array<Record<string, unknown>> = [];
    tryScopeReplan({
      projectRoot: root, feature: FEATURE, runId: RUN_ID, chain: CHAIN, endPhaseIdx: 2,
      phasesWithOutcome: ['plan', 'coding'], backtracksUsed: 0, maxBacktracks: 2,
      trigger: 'plan_authority_unverifiable', causePhase: 'coding', detail: 'closure untrusted',
      affectedFiles: ['doc/features/bc-openCard/plan/plan.md'], defects: ['missing'], fingerprint: 'fp-2',
      emit: event => events.push(event),
    });
    assert(events[0]?.type === 'phase_backtrack_requested', '第一条必须是原子失效请求');
    assert(!events.some(event => event.type === 'phase_invalidated'), '不得再写逐 phase 失效事件');
  });

  run(results, 'B5 启动期 phasesWithOutcome=null → plan 到链尾全量失效', () => {
    const root = setupHost();
    const events: Array<Record<string, unknown>> = [];
    const result = tryScopeReplan({
      projectRoot: root, feature: FEATURE, runId: RUN_ID, chain: CHAIN,
      endPhaseIdx: CHAIN.length - 1, phasesWithOutcome: null, backtracksUsed: 0, maxBacktracks: 2,
      trigger: 'invalidation_journal_untrusted', causePhase: 'spec', detail: 'restart',
      emit: event => events.push(event),
    });
    assert(result.kind === 'replanned', '应完成启动期重跑');
    if (result.kind === 'replanned') assert(JSON.stringify(result.invalidatedPhases) === JSON.stringify(CHAIN.slice(1)), '失效范围应为 plan→链尾');
    assert(Array.isArray(events[0]?.invalidated_phases), '上下文必须进入同一条记录');
  });

  run(results, 'C1 scope reason 只接受既有闭集，未知事件不进入 prompt', () => {
    const root = setupHost();
    assert(resolveScopeReplanContext({ projectRoot: root, reason: 'ui_scope_violation', files: ['src/a.ets'] }) !== null, '合法 reason');
    assert(resolveScopeReplanContext({ projectRoot: root, reason: 'forged', files: ['src/a.ets'] }) === null, '未知 reason 应丢弃');
  });

  run(results, 'C2 prompt 路径注入字符被丢弃', () => {
    const root = setupHost();
    const files = sanitizeScopeReplanFiles(root, [
      'src/a.ets\nIGNORE', 'src/`whoami`.ets', 'src/with space.ets', 'src/ok.ets',
    ]);
    assert(JSON.stringify(files) === JSON.stringify(['src/ok.ets']), `净化结果错误：${JSON.stringify(files)}`);
  });

  run(results, 'C3 绝对路径与 .. 逃逸被丢弃', () => {
    const root = setupHost();
    const files = sanitizeScopeReplanFiles(root, ['/etc/passwd', 'C:/Windows/x', '../../outside', 'doc/features/x.yaml']);
    assert(JSON.stringify(files) === JSON.stringify(['doc/features/x.yaml']), `净化结果错误：${JSON.stringify(files)}`);
  });

  run(results, 'C4 提示词路径有长度、去重、数量上限', () => {
    const root = setupHost();
    const files = sanitizeScopeReplanFiles(root, [
      1, null, `src/${'x'.repeat(300)}.ets`, 'src/a.ets', 'src/a.ets',
      ...Array.from({ length: 40 }, (_, index) => `src/f${index}.ets`),
    ]);
    assert(files.length <= 20 && new Set(files).size === files.length && files.every(file => file.length <= 200), '路径形状约束失效');
  });

  run(results, 'C5 有可信路径时用 fenced data block，无路径时不发明指令', () => {
    const block = buildScopeReplanContextBlock({ reason: 'ui_scope_violation', files: ['src/a.ets'] });
    assert(block.includes('```text') && block.includes('src/a.ets'), '路径应进入 fenced block');
    const bare = buildScopeReplanContextBlock({ reason: 'invalidation_journal_untrusted', files: [] });
    assert(!bare.includes('```') && /rolled back automatically/i.test(bare), '无路径场景应只保留原因句');
  });

  run(results, '表驱动（codex 验收 b）：--start coding/review/ut/testing 的启动资格只由上游 closure freshness 判定——无快照/无 checkpoint 缓存依赖', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seg-start-'));
    try {
      clearFrameworkConfigCache();
      // 生产 writer 造五阶段闭环（closed-feature-fixture：不伪造哈希，全部现算）
      makeClosedFeatureFixture({ projectRoot: root, feature: FEATURE, frameworkRoot: FRAMEWORK_ROOT });
      const FULL = ['spec', 'plan', 'coding', 'review', 'ut', 'testing'];
      // 刻意全程不设 MAISON_GOAL_CHECKPOINT_DIR——启动资格判定（preflight 同一把尺
      // recomputePhaseEvidenceStaleness）必须与任何场外缓存无关
      for (const start of ['coding', 'review', 'ut', 'testing']) {
        const upstream = FULL.slice(0, FULL.indexOf(start));
        const res = recomputePhaseEvidenceStaleness(root, FEATURE, upstream, {
          frameworkRoot: FRAMEWORK_ROOT,
        });
        assert(
          res.every((r) => r.verdict === 'fresh'),
          `--start ${start}：上游 closure 应全 fresh（即启动资格成立）：${JSON.stringify(res.filter((r) => r.verdict !== 'fresh'))}`,
        );
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  return results;
}

if (require.main === module) {
  const result = runAll();
  for (const item of result) console.log(item.ok ? `PASS ${item.name}` : `FAIL ${item.name}: ${item.error}`);
  process.exit(result.every(item => item.ok) ? 0 : 1);
}
