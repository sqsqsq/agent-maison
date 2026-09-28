// successor-exit.unit.test.ts — plan b2d7f4e9 §3.2 / t3：完成后修正 = `--supersede <完成 run>` 起 successor
//
// 夹具只用上一版宿主快照（host-snapshot-3.1.0，换目录加载）+ 生产 writer（蓝图升版调和、投影物化、
// feature 冻结记录的冻结 / 转交登记），经 goal-runner 公开入口（进程内 goalMain，假 agent）起后继。
// 不注入 verdict；期望的重跑阶段集合由评估入口 `assessFeature` 在出生前独立给出，再与后继出生链比对。

import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';

import { clearFrameworkConfigCache, featureFilePath } from '../../config';
import { assessFeature, type FeatureAssessment } from '../../scripts/utils/feature-assessment';
import { resolveChangeUnitExpectedExecution } from '../../scripts/utils/change-unit-completion';
import { executionScopeEvidenceIssues } from '../../scripts/utils/verify-feature-completion';
import { executionScopeFingerprint, validateExecutionScope, type ExecutionScope } from '../../scripts/utils/execution-scope';
import { loadFrozenExecutionScope } from '../../scripts/utils/goal-run-creation';
import {
  featureFrozenScopePath, freezeFeatureExecutionScope, readFeatureFrozenScope, registerFeatureScopeTransfer, resolveSuccessorExecutionScope,
} from '../../scripts/utils/feature-execution-scope';
import { featureScopeCandidateFingerprint } from '../../scripts/utils/feature-track';
import { loadPhaseEvidenceManifest } from '../../scripts/utils/phase-evidence-manifest';
import { reconcileChangeUnitBlueprintRefs } from '../../scripts/utils/change-unit-design-preparation';
import { resolveWorkflowSpec } from '../../workflow-loader';
import { mergeSuccessorRequirement } from '../../scripts/utils/goal-manifest';
import { computeRequirementShaFromText, computeRunRequirementSha } from '../../scripts/utils/fidelity-shared';
import { componentBlueprintPath } from '../../scripts/utils/component-blueprint-path';
import { loadHostSnapshot, SNAPSHOT_CU_FEATURE, SNAPSHOT_FLAT_FEATURE } from '../fixtures/host-snapshot-3.1.0/generate';
import { runGoalRuntimeChain } from './goal-runner-testing-integrity.unit.test';
import { handWriteProjections } from './component-design-handoff.unit.test';
import type { UnitCaseResult } from '../run-unit';

type Snapshot = ReturnType<typeof loadHostSnapshot>;
const WORKFLOW_ORDER = ['spec', 'plan', 'coding', 'review', 'ut', 'testing'];
const BLUEPRINT_ID = 'ledger-app-blueprint';

async function withSnapshot(run: (s: Snapshot) => Promise<void>): Promise<void> {
  const snapshot = loadHostSnapshot();
  try {
    clearFrameworkConfigCache();
    await run(snapshot);
  } finally {
    clearFrameworkConfigCache();
    fs.rmSync(snapshot.root, { recursive: true, force: true });
  }
}

export const runIds = (root: string, feature: string): string[] => {
  const dir = featureFilePath(root, feature, 'goal-runs');
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter(name => !name.startsWith('.')) : [];
};
export const runFile = (root: string, feature: string, runId: string, file: string): string =>
  featureFilePath(root, feature, path.join('goal-runs', runId, file));
export const readJson = <T>(file: string): T => JSON.parse(fs.readFileSync(file, 'utf8')) as T;
const hasManifest = (root: string, feature: string, runId: string): boolean => fs.existsSync(runFile(root, feature, runId, 'manifest.json'));

function assess(s: Snapshot, feature: string): FeatureAssessment {
  clearFrameworkConfigCache();
  return assessFeature(s.root, feature, { ...resolveChangeUnitExpectedExecution(s.root, feature), frameworkRoot: s.frameworkRoot });
}

/** 评估入口判 uncovered 的 required 义务的责任阶段（按 workflow 顺序）；合成的阶段结果行不是义务、不排阶段。 */
export function uncoveredOwnerPhases(a: FeatureAssessment): string[] {
  const owners = new Set(a.obligations
    .filter(o => o.status === 'uncovered' && o.applicability === 'required' && o.kind !== 'phase-result')
    .map(o => o.owner_phase));
  return WORKFLOW_ORDER.filter(phase => owners.has(phase));
}

/** 用生产 writer 造「冻结后出生并已转交给源 run」的 feature 记录（快照宿主只走过 goal run，本无记录）。 */
export function freezeAndTransfer(s: Snapshot, feature: string, runId: string): void {
  const birth = loadFrozenExecutionScope(s.root, feature, runId)!;
  freezeFeatureExecutionScope({ projectRoot: s.root, feature, scope: birth, candidateFingerprint: featureScopeCandidateFingerprint(s.root, feature) });
  registerFeatureScopeTransfer({ projectRoot: s.root, feature, runId, transferredScopeFingerprint: executionScopeFingerprint(birth) });
}

/**
 * 公开入口 goal-runner `--supersede <源 run>`（进程内 goalMain；假 agent 一律失败，出生后即停，不跑真实阶段）。
 * `chain` 只用来给出 `--start/--end`：goal-runner 要求它们与重解析出的出生链首尾逐字相等（否则拒绝出生）。
 */
export async function supersede(
  s: Snapshot, feature: string, sourceRunId: string, chain?: string[], extra: Partial<Parameters<typeof runGoalRuntimeChain>[1]> = {},
): Promise<{ successor?: string; error?: string }> {
  const before = new Set(runIds(s.root, feature));
  const requirement = readJson<{ requirement: string }>(runFile(s.root, feature, sourceRunId, 'manifest.json')).requirement;
  // 进程内 goalMain 的 profile 回落 hmos-app、preflight 要 DevEco（real-chain-host「已知上限」1）：
  // 快照不含假工具链目录，这里按 real-chain 同款补一个空 hvigor 入口并把 installPath 指过去。
  const deveco = path.join(s.root, 'fake-deveco');
  const hvigorBin = path.join(deveco, 'tools', 'hvigor', 'bin', process.platform === 'win32' ? 'hvigorw.bat' : 'hvigorw');
  fs.mkdirSync(path.dirname(hvigorBin), { recursive: true });
  fs.writeFileSync(hvigorBin, '');
  const localFile = path.join(s.root, 'framework.local.json');
  const local = readJson<{ toolchain: { devEcoStudio: { installPath: string } } }>(localFile);
  local.toolchain.devEcoStudio.installPath = deveco.split(path.sep).join('/');
  fs.writeFileSync(localFile, JSON.stringify(local, null, 2));
  let error: string | undefined;
  try {
    const probe = await runGoalRuntimeChain(s.root, {
      frameworkRoot: s.frameworkRoot, featureId: feature, adapter: 'codex', freshRequirement: requirement,
      supersede: [sourceRunId],
      freshStartPhase: (chain?.[0] ?? 'spec') as 'spec', freshEndPhase: chain?.at(-1) ?? 'testing',
      failExecutorFor: () => true,
      ...extra,
    });
    if (probe.exitCode !== 0) error = `exit=${probe.exitCode}`;
  } catch (e) { error = (e as Error).message; }
  clearFrameworkConfigCache();
  const successor = runIds(s.root, feature).find(id => !before.has(id) && hasManifest(s.root, feature, id));
  return { ...(successor ? { successor } : {}), ...(error ? { error } : {}) };
}

export function successorScope(s: Snapshot, feature: string, runId: string): ExecutionScope & { successor_of?: string } {
  const manifest = readJson<{ execution_scope: unknown; successor_of?: string }>(runFile(s.root, feature, runId, 'manifest.json'));
  return Object.assign(validateExecutionScope(manifest.execution_scope), { successor_of: manifest.successor_of });
}

export function auditedBy(s: Snapshot, feature: string, runId: string, target: string): boolean {
  return fs.readFileSync(runFile(s.root, feature, runId, 'events.jsonl'), 'utf8').split('\n').filter(Boolean)
    .map(line => JSON.parse(line) as { type?: string; target_run_id?: string; superseding_run_id?: string })
    .some(event => event.type === 'supersede' && event.target_run_id === target && event.superseding_run_id === runId);
}

export function completionOriginal(s: Snapshot, feature: string): string {
  return path.join(s.root, readJson<{ original_path: string }>(featureFilePath(s.root, feature, 'feature-completion.json')).original_path);
}

/** ledger-refresh 的 design_ref 目标 node `ledger-domain` 自带的验收内容——`deriveBlueprintSkillInput` 原样拷进 acceptance 投影。 */
export const NEW_EXPECTED_RESULT = 'consumer refreshed and balance survives restart';
export function changeProjectedAcceptance(bp: Record<string, unknown>): void {
  const visit = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(visit);
    if (!value || typeof value !== 'object') return false;
    const record = value as { node_id?: string; acceptance?: { criteria?: Array<{ expected_result?: string }> } };
    if (record.node_id === 'ledger-domain' && record.acceptance?.criteria?.[0]) {
      record.acceptance.criteria[0].expected_result = NEW_EXPECTED_RESULT;
      return true;
    }
    return Object.values(value).some(visit);
  };
  assert(visit(bp), '快照蓝图缺 ledger-domain 的验收内容');
}

/**
 * ★2：蓝图升一个 admitted revision → consumer writer 原位升版全部 CU 指针并同批刷新派生投影（t2a/t2c）→ 直接 `--supersede`。
 * `mutate` 给出时同时改动会进投影的蓝图内容（宿主事故的真实形状：升版不只换身份）。
 */
async function star2(s: Snapshot, mutate?: (bp: Record<string, unknown>) => void): Promise<void> {
    const feature = SNAPSHOT_CU_FEATURE;
    const [source] = runIds(s.root, feature);
    const bpFile = componentBlueprintPath(s.root, BLUEPRINT_ID);
    const bp = YAML.parse(fs.readFileSync(bpFile, 'utf8'));
    bp.revision = Number(bp.revision) + 1;
    for (const result of bp.derived_results ?? []) result.input_revision = bp.revision;
    mutate?.(bp);
    fs.writeFileSync(bpFile, YAML.stringify(bp));
    const reconcile = reconcileChangeUnitBlueprintRefs(s.root, BLUEPRINT_ID);
    assert(reconcile.bumped.some(item => item.change_unit_id === 'ledger-refresh') && !reconcile.skipped.length, JSON.stringify(reconcile));
    if (mutate) {
      const acceptance = YAML.parse(fs.readFileSync(featureFilePath(s.root, feature, 'acceptance.yaml'), 'utf8'));
      assert.strictEqual(acceptance.criteria[0].expected_result, NEW_EXPECTED_RESULT, '派生 acceptance 未刷新为新蓝图内容');
    }
    // t2c：调和 writer 已同批刷新派生投影，无需任何手工补救，直接 --supersede。
    freezeAndTransfer(s, feature, source);
    const originalFile = completionOriginal(s, feature);
    const originalBytes = fs.readFileSync(originalFile);
    const cuDirs = fs.readdirSync(path.dirname(featureFilePath(s.root, feature, 'change-unit.yaml')) + '/..').sort();

    // §3.1：覆盖判定针对「本次合法范围」——successor 出生是按当前输入重生成的候选（生产函数，纯内存、不写盘）。
    const requirement = readJson<{ requirement: string }>(runFile(s.root, feature, source, 'manifest.json')).requirement;
    clearFrameworkConfigCache();
    const born = resolveSuccessorExecutionScope(s.root, feature, resolveWorkflowSpec(s.root, { frameworkRoot: s.frameworkRoot }), s.frameworkRoot, requirement, source)!;
    const a = assessFeature(s.root, feature, { ...resolveChangeUnitExpectedExecution(s.root, feature), frameworkRoot: s.frameworkRoot, scope: born });
    assert.strictEqual(a.record.state, 'ok', JSON.stringify(a.record));
    const expected = uncoveredOwnerPhases(a);
    assert(expected.length > 0, '前提：蓝图升版后应有 uncovered 义务');
    // spec/plan 义务由刷新后的派生投影绑定覆盖，不是执行阶段
    assert(!expected.includes('spec') && !expected.includes('plan'), `spec/plan 不应 uncovered：${JSON.stringify(a.obligations.filter(o => o.status === 'uncovered'))}`);
    for (const kind of ['acceptance-context', 'design-context']) {
      const duty = born.obligations.find(o => o.kind === kind && o.applicability === 'required');
      assert(duty?.satisfied_by?.some(ref => 'input_id' in ref), `${kind} 应由当前派生投影绑定满足：${JSON.stringify(duty)}`);
    }

    const { successor, error } = await supersede(s, feature, source, expected);
    assert(successor, `后继未出生：${error}`);
    const scope = successorScope(s, feature, successor!);
    assert.strictEqual(scope.successor_of, source);
    assert.deepStrictEqual(scope.phase_chain, expected, `出生链应只含 uncovered 责任阶段：${JSON.stringify(scope.phase_chain)} vs ${JSON.stringify(expected)}`);
    assert.strictEqual(executionScopeFingerprint({ ...scope, successor_of: undefined }), executionScopeFingerprint(born), '出生范围应等于同一生产函数的预判');
    const reused = scope.reused_phases.map(item => item.phase);
    // 复用 = 未进链、且 required 义务不全由输入绑定满足（即确有阶段证据引用）的阶段
    assert.deepStrictEqual(reused, WORKFLOW_ORDER.filter(phase => !expected.includes(phase)
      && scope.obligations.some(o => o.owner_phase === phase && o.applicability === 'required' && o.satisfied_by?.some(ref => 'evidence_manifest_aggregate' in ref))));
    assert(auditedBy(s, feature, successor!, source), '后继缺 supersede 审计事件：' + fs.readFileSync(runFile(s.root, feature, successor!, 'events.jsonl'), 'utf8').slice(0, 3000) + ' | error=' + error);
    assert.deepStrictEqual(readFeatureFrozenScope(s.root, feature)!.transfers?.map(item => item.run_id), [source, successor], '转交记录应追加、旧转交保留');
    assert(fs.readFileSync(originalFile).equals(originalBytes), '旧 completion 原件被改写');
    assert.deepStrictEqual(fs.readdirSync(path.dirname(featureFilePath(s.root, feature, 'change-unit.yaml')) + '/..').sort(), cuDirs, '出现了新 CU 目录（应原位升版）');
    console.log(`[successor-exit] ★2${mutate ? '（投影内容变化）' : ''} actual phase_chain=${JSON.stringify(scope.phase_chain)} reused=${JSON.stringify(reused)}`);
}

const cases: Array<{ name: string; run: () => Promise<void> }> = [
  { name: '★2 蓝图升版 → CU 指针原位升版 → --supersede 完成 run：出生链 = 评估入口 uncovered 的责任阶段，转交追加式、旧 completion 字节不变', run: () => withSnapshot(s => star2(s)) },
  { name: '★2 变体 蓝图升版同时改了进投影的内容（ledger-domain 验收 expected_result）→ 投影刷新为新内容，successor 同样出生、不含 spec/plan', run: () => withSnapshot(s => star2(s, changeProjectedAcceptance)) },
  { name: '#9 证据损坏（删 ut evidence manifest）→ 后继只跑 ut；其余阶段复用源 run 证据，引用经同一核验', run: () => withSnapshot(async s => {
    const feature = SNAPSHOT_FLAT_FEATURE;
    const [source] = runIds(s.root, feature);
    fs.rmSync(featureFilePath(s.root, feature, 'ut/reports/phase-evidence-manifest.json'));
    const a = assess(s, feature);
    assert.strictEqual(a.record.state, 'ok', JSON.stringify(a.record));
    assert.deepStrictEqual(uncoveredOwnerPhases(a), ['ut'], JSON.stringify(a.obligations.filter(o => o.status === 'uncovered')));

    const { successor, error } = await supersede(s, feature, source, ['ut']);
    assert(successor, `后继未出生：${error}`);
    const scope = successorScope(s, feature, successor!);
    assert.deepStrictEqual(scope.phase_chain, ['ut']);
    // t2c：候选按当前输入重生成，spec/plan 的定义义务由当前 acceptance/contracts 绑定满足（不进链、也不算阶段复用）
    assert.deepStrictEqual(scope.reused_phases.map(item => item.phase), ['coding', 'review', 'testing']);
    for (const phase of ['spec', 'plan']) {
      const duties = scope.obligations.filter(o => o.owner_phase === phase && o.applicability === 'required');
      assert(duties.length && duties.every(o => o.satisfied_by?.every(ref => 'input_id' in ref)), `${phase} 义务应由当前输入绑定满足：${JSON.stringify(duties)}`);
    }
    for (const reuse of scope.reused_phases) {
      for (const ref of reuse.evidence_refs) {
        assert.strictEqual(ref.run_id, source, `${reuse.phase} 复用引用不是源 run`);
        assert.strictEqual(ref.evidence_manifest_aggregate, loadPhaseEvidenceManifest(s.root, feature, reuse.phase)!.manifest.aggregate_sha256);
      }
    }
    const reusedIds = new Set(scope.reused_phases.flatMap(item => item.obligation_ids));
    assert.deepStrictEqual(executionScopeEvidenceIssues(s.root, feature, scope, reusedIds), [], '复用证据复核不过');
    // 快照宿主没有 feature 冻结记录：后继出生不建记录（登记是 no-op）
    assert.strictEqual(readFeatureFrozenScope(s.root, feature), null);
  }) },
  { name: '#8 改验收（新增一条设备层断言）→ 该义务按当前输入重派生且 uncovered，责任阶段 testing 进出生链', run: () => withSnapshot(async s => {
    const feature = SNAPSHOT_FLAT_FEATURE;
    const [source] = runIds(s.root, feature);
    const file = featureFilePath(s.root, feature, 'acceptance.yaml');
    const doc = YAML.parse(fs.readFileSync(file, 'utf8'));
    doc.criteria.push({ ...doc.criteria[1], id: 'AC-9', description: '完成后补一条设备断言', ut_layer: 'device', ut_focus: undefined, device_focus: '真机核对列表条目数' });
    fs.writeFileSync(file, YAML.stringify(doc));
    const expected = uncoveredOwnerPhases(assess(s, feature));

    const { successor, error } = await supersede(s, feature, source, expected);
    assert(successor, `后继未出生：${error}`);
    const scope = successorScope(s, feature, successor!);
    const device = scope.obligations.find(o => o.kind === 'device-evidence');
    assert(device && device.applicability === 'required' && !device.satisfied_by?.length && device.reason.includes('AC-9'), JSON.stringify(device));
    assert(scope.phase_chain.includes('testing'), JSON.stringify(scope.phase_chain));
    assert.deepStrictEqual(scope.phase_chain, expected);
    console.log(`[successor-exit] #8 actual phase_chain=${JSON.stringify(scope.phase_chain)}`);
  }) },
  { name: '需求增量（codex r1 P1-3）只改显式需求、不预改产物 → 后继出生链非空，且等于评估入口按最终需求判 uncovered 的责任阶段', run: () => withSnapshot(async s => {
    const feature = SNAPSHOT_FLAT_FEATURE;
    const [source] = runIds(s.root, feature);
    const sourceRequirement = readJson<{ requirement: string }>(runFile(s.root, feature, source, 'manifest.json')).requirement;
    const increment = '查询超时由 3s 改为 5s（非视觉行为调整）';
    const finalRequirement = mergeSuccessorRequirement(sourceRequirement, increment);
    clearFrameworkConfigCache();
    const born = resolveSuccessorExecutionScope(s.root, feature, resolveWorkflowSpec(s.root, { frameworkRoot: s.frameworkRoot }), s.frameworkRoot, finalRequirement, source)!;
    assert(born.phase_chain.length > 0, `需求变了仍按旧需求全量复用：phase_chain=${JSON.stringify(born.phase_chain)} reused=${JSON.stringify(born.reused_phases.map(item => item.phase))}`);
    // 覆盖按本次最终需求判；record 仍按历史 run 核验
    const expectedExecution = resolveChangeUnitExpectedExecution(s.root, feature);
    const a = assessFeature(s.root, feature, { ...expectedExecution, frameworkRoot: s.frameworkRoot, scope: born, requirementSha: computeRequirementShaFromText(s.root, feature, finalRequirement) });
    assert.strictEqual(a.record.state, 'ok', JSON.stringify(a.record));
    assert.deepStrictEqual(born.phase_chain, uncoveredOwnerPhases(a), '出生链应等于按最终需求判 uncovered 的责任阶段');
    // 正例：需求未变 → 同口径哈希与源 run 相同，完成判定与复用不受影响（#9 另证 successor 只跑 ut）
    const sameSha = computeRequirementShaFromText(s.root, feature, sourceRequirement);
    assert.strictEqual(sameSha, computeRunRequirementSha(s.root, feature, source));
    assert(assessFeature(s.root, feature, { ...expectedExecution, frameworkRoot: s.frameworkRoot, requirementSha: sameSha }).complete, '需求未变却判未完成');

    const { successor, error } = await supersede(s, feature, source, born.phase_chain, { freshRequirement: increment });
    assert(successor, `后继未出生：${error}`);
    const scope = successorScope(s, feature, successor!);
    assert.strictEqual(readJson<{ requirement: string }>(runFile(s.root, feature, successor!, 'manifest.json')).requirement, finalRequirement, '前提：后继任务真源 = 合并后的最终需求');
    assert.deepStrictEqual(scope.phase_chain, born.phase_chain);
    console.log(`[successor-exit] 需求增量 actual phase_chain=${JSON.stringify(scope.phase_chain)} reused=${JSON.stringify(scope.reused_phases.map(item => item.phase))}`);
  }) },
  { name: 'A1-7 手写派生文件 + 蓝图投影自身坏（验收写成文本）→ authority_projection_invalid：--supersede 照常出生，spec/plan 入链、不拒绝', run: () => withSnapshot(async s => {
    const feature = SNAPSHOT_CU_FEATURE;
    const [source] = runIds(s.root, feature);
    handWriteProjections(s.root);
    const bpFile = componentBlueprintPath(s.root, BLUEPRINT_ID);
    const bp = YAML.parse(fs.readFileSync(bpFile, 'utf8'));
    bp.revision = Number(bp.revision) + 1;
    for (const result of bp.derived_results ?? []) result.input_revision = bp.revision;
    const visit = (value: unknown): boolean => {
      if (Array.isArray(value)) return value.some(visit);
      if (!value || typeof value !== 'object') return false;
      if ((value as { node_id?: string }).node_id === 'ledger-domain') { (value as { acceptance?: unknown }).acceptance = '验收写成了一段文本'; return true; }
      return Object.values(value).some(visit);
    };
    assert(visit(bp), '快照蓝图缺 ledger-domain');
    fs.writeFileSync(bpFile, YAML.stringify(bp));
    const reconcile = reconcileChangeUnitBlueprintRefs(s.root, BLUEPRINT_ID);
    assert(reconcile.bumped.some(item => item.change_unit_id === 'ledger-refresh') && !reconcile.skipped.length, JSON.stringify(reconcile));
    const requirement = readJson<{ requirement: string }>(runFile(s.root, feature, source, 'manifest.json')).requirement;
    clearFrameworkConfigCache();
    const born = resolveSuccessorExecutionScope(s.root, feature, resolveWorkflowSpec(s.root, { frameworkRoot: s.frameworkRoot }), s.frameworkRoot, requirement, source)!;
    const expected = uncoveredOwnerPhases(assessFeature(s.root, feature, { ...resolveChangeUnitExpectedExecution(s.root, feature), frameworkRoot: s.frameworkRoot, scope: born }));
    const { successor, error } = await supersede(s, feature, source, expected);
    assert(successor, `投影 invalid 不得拒绝出生：${error}`);
    const scope = successorScope(s, feature, successor!);
    assert(scope.phase_chain.includes('spec') && scope.phase_chain.includes('plan'), `spec/plan 应入链对齐：${JSON.stringify(scope.phase_chain)}`);
    for (const kind of ['acceptance-context', 'design-context']) {
      const d = scope.obligations.find(o => o.kind === kind && o.applicability === 'required');
      assert(d && !d.satisfied_by?.length && d.reason.includes('authority_projection_invalid'), `${kind}：${JSON.stringify(d)}`);
    }
    assert.deepStrictEqual(scope.phase_chain, expected);
  }) },
  { name: '#16a 源 run 出生记录 creation_incomplete → 出生拒绝：不建 run、不写审计、转交记录不变', run: () => withSnapshot(async s => {
    const feature = SNAPSHOT_FLAT_FEATURE;
    const [source] = runIds(s.root, feature);
    freezeAndTransfer(s, feature, source);
    const recordBytes = fs.readFileSync(featureFrozenScopePath(s.root, feature));
    const events = runFile(s.root, feature, source, 'events.jsonl');
    const created = fs.readFileSync(events, 'utf8').split('\n').find(line => line.includes('"run_created"'))!;
    fs.appendFileSync(events, created + '\n');
    const eventsBytes = fs.readFileSync(events);
    const { successor, error } = await supersede(s, feature, source);
    assert(!successor, '源 run 出生不完整仍建了后继');
    assert(error && /CREATION_INCOMPLETE|run_created/.test(error), String(error));
    assert(fs.readFileSync(featureFrozenScopePath(s.root, feature)).equals(recordBytes), '转交记录被改');
    assert(fs.readFileSync(events).equals(eventsBytes), '源 run events 被追加');
  }) },
  { name: '#16b feature 转交对象 ≠ 本次 supersede 源 → 出生拒绝：不建 run、不写审计、转交记录不变', run: () => withSnapshot(async s => {
    const feature = SNAPSHOT_FLAT_FEATURE;
    const [source] = runIds(s.root, feature);
    const birth = loadFrozenExecutionScope(s.root, feature, source)!;
    freezeFeatureExecutionScope({ projectRoot: s.root, feature, scope: birth, candidateFingerprint: featureScopeCandidateFingerprint(s.root, feature) });
    registerFeatureScopeTransfer({ projectRoot: s.root, feature, runId: '20260101T000000Z-0ther0', transferredScopeFingerprint: executionScopeFingerprint(birth) });
    const recordBytes = fs.readFileSync(featureFrozenScopePath(s.root, feature));
    const sourceEvents = fs.readFileSync(runFile(s.root, feature, source, 'events.jsonl'));
    const { successor, error } = await supersede(s, feature, source);
    assert(!successor, '血缘不符仍建了后继');
    assert(error && error.includes('当前转交给 run 20260101T000000Z-0ther0'), String(error));
    assert(fs.readFileSync(featureFrozenScopePath(s.root, feature)).equals(recordBytes), '转交记录被改');
    assert(fs.readFileSync(runFile(s.root, feature, source, 'events.jsonl')).equals(sourceEvents), '源 run events 被追加');
  }) },
];

export async function runAll(): Promise<UnitCaseResult[]> {
  const results: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      await c.run();
      results.push({ name: `successor-exit: ${c.name}`, ok: true });
    } catch (err) {
      results.push({ name: `successor-exit: ${c.name}`, ok: false, error: (err as Error).stack ?? (err as Error).message });
    }
  }
  return results;
}
