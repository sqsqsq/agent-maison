// successor-exit.unit.test.ts — plan b2d7f4e9 §3.2 / t3：完成后修正 = `--supersede <完成 run>` 起 successor
//
// 夹具只用上一版宿主快照（host-snapshot-3.1.0，换目录加载）+ 生产 writer（蓝图升版调和、投影物化、
// feature 冻结记录的冻结 / 转交登记），经 goal-runner 公开入口（进程内 goalMain，假 agent）起后继。
// 不注入 verdict；期望的重跑阶段集合由评估入口 `assessFeature` 在出生前独立给出，再与后继出生链比对。

import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';

import { clearFrameworkConfigCache, featureFilePath, featurePhaseReportsDir } from '../../config';
import { assessFeature, type FeatureAssessment } from '../../scripts/utils/feature-assessment';
import { resolveChangeUnitExpectedExecution } from '../../scripts/utils/change-unit-completion';
import { executionScopeEvidenceIssues } from '../../scripts/utils/verify-feature-completion';
import { executionScopeFingerprint, validateExecutionScope, type ExecutionScope } from '../../scripts/utils/execution-scope';
import { createGoalRun, decideRunContinuation, loadFrozenExecutionScope } from '../../scripts/utils/goal-run-creation';
import { withRunDisposition } from '../../scripts/utils/adjudication';
import {
  featureFrozenScopePath, freezeFeatureExecutionScope, readFeatureFrozenScope, registerFeatureScopeTransfer, resolveSuccessorExecutionScope,
} from '../../scripts/utils/feature-execution-scope';
import { featureScopeCandidateFingerprint } from '../../scripts/utils/feature-track';
import { loadPhaseEvidenceManifest } from '../../scripts/utils/phase-evidence-manifest';
import { reconcileChangeUnitBlueprintRefs } from '../../scripts/utils/change-unit-design-preparation';
import { resolveWorkflowSpec } from '../../workflow-loader';
import { buildGoalManifestFromInput, mergeSuccessorRequirement, SUCCESSOR_REQUIREMENT_INCREMENT_MARKER } from '../../scripts/utils/goal-manifest';
import { computeRequirementShaFromText, computeRunRequirementSha } from '../../scripts/utils/fidelity-shared';
import { componentBlueprintPath } from '../../scripts/utils/component-blueprint-path';
import { loadHostSnapshot, SNAPSHOT_CU_FEATURE, SNAPSHOT_FLAT_FEATURE } from '../fixtures/host-snapshot-3.1.0/generate';
import { goalRunEvents, requestVia, runGoalRuntimeChain } from './goal-runner-testing-integrity.unit.test';
import { sealLegacyInvokes } from './goal-park-resume.unit.test';
import { handWriteProjections } from './component-design-handoff.unit.test';
import type { UnitCaseResult } from '../run-unit';
import { SpecLoader } from '../../scripts/utils/spec-loader';
import { checkAuthoritativeContentAligned } from '../../scripts/utils/blueprint-skill-projection';
import type { CheckContext, CheckResult } from '../../scripts/utils/types';

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
  ensureFakeDeveco(s);
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

/** 进程内 goalMain 的 profile 回落 hmos-app、preflight 要 DevEco（real-chain-host「已知上限」1）：快照不含假工具链目录，按 real-chain 同款补一个空 hvigor 入口并把 installPath 指过去。 */
export function ensureFakeDeveco(s: Snapshot): void {
  const deveco = path.join(s.root, 'fake-deveco');
  const hvigorBin = path.join(deveco, 'tools', 'hvigor', 'bin', process.platform === 'win32' ? 'hvigorw.bat' : 'hvigorw');
  fs.mkdirSync(path.dirname(hvigorBin), { recursive: true });
  fs.writeFileSync(hvigorBin, '');
  const localFile = path.join(s.root, 'framework.local.json');
  const local = readJson<{ toolchain: { devEcoStudio: { installPath: string } } }>(localFile);
  local.toolchain.devEcoStudio.installPath = deveco.split(path.sep).join('/');
  fs.writeFileSync(localFile, JSON.stringify(local, null, 2));
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

// plan 4e6fb3b6 §7.4 / A15：起后继的合同来源（纯函数；快照里的完成 run + 生产 createGoalRun 出生的失败 run，停机事件经生产写盘层投影）
function bornFailedRun(s: Snapshot, feature: string, suffix: string, successorOf?: string): string {
  const manifest = buildGoalManifestFromInput({
    feature, run_id: `20260929T01000${suffix}Z-a15${suffix}0`, start_phase: 'plan', end_phase: 'plan',
    requirement: readJson<{ requirement: string }>(runFile(s.root, feature, runIds(s.root, feature)[0], 'manifest.json')).requirement,
    unattended: { write_mode: 'full-access', approval_mode: 'never' },
  }, { projectRoot: s.root });
  if (successorOf) manifest.successor_of = successorOf;
  const created = createGoalRun({ projectRoot: s.root, manifest, chain: ['plan'], forceFresh: true });
  const ts = '2026-09-29T01:00:00.000Z';
  // 启动即失败（金丝雀 400 形状，run_start 之前退出）：与宿主 be091c 同一现场
  for (const event of [
    { ts, type: 'phase_halt', phase: 'plan', halt_reason: 'canary_cli_hard_failure', verdict: 'FAIL', halt_guidance: 'canary 400' },
    { ts, type: 'run_end', status: 'HALTED', halt_reason: 'canary_cli_hard_failure', session_started_at: ts },
  ]) fs.appendFileSync(created.eventsPath, `${JSON.stringify(withRunDisposition(event))}\n`, 'utf8');
  return manifest.run_id;
}

cases.push(
  { name: 'P3 t5 A15 合同来源：没有 feature 转交记录 → 取上一次完成的 run，不取未终局列表的第一项；承接目标含启动即失败的 run', run: () => withSnapshot(async s => {
    const feature = SNAPSHOT_CU_FEATURE;
    const [completed] = runIds(s.root, feature);
    assert(!readFeatureFrozenScope(s.root, feature), '夹具：快照没有 feature 冻结记录');
    const failed = bornFailedRun(s, feature, '1');
    const d = decideRunContinuation({ projectRoot: s.root, feature, call: { model: 'gpt-5.5' } });
    assert(d.kind === 'successor', JSON.stringify(d));
    assert.strictEqual(d.source, completed, `合同来源须是上一次完成的 run：${JSON.stringify(d)}`);
    assert.deepStrictEqual(d.targets, [completed, failed]);
  }) },
  { name: 'P3 t5 A15 合同来源：持有者已完成而最新失败的 run（其后继、启动即失败）尚未接管范围 → 仍以持有者为来源', run: () => withSnapshot(async s => {
    const feature = SNAPSHOT_CU_FEATURE;
    const [holder] = runIds(s.root, feature);
    freezeAndTransfer(s, feature, holder);
    const failed = bornFailedRun(s, feature, '2', holder);
    const d = decideRunContinuation({ projectRoot: s.root, feature, call: { model: 'gpt-5.5' } });
    assert(d.kind === 'successor', JSON.stringify(d));
    assert.strictEqual(d.source, holder, `合同来源须是当前持有范围转交的 run：${JSON.stringify(d)}`);
    assert.deepStrictEqual(d.targets, [holder, failed]);
  }) },
);

// plan 4e6fb3b6 §7.3 / A13：已有范围转交——持有者是一个中断的后继；重发同一请求（三个公开入口，不带技术旗标）即重新接入它，
// 不再被出生范围解析以"范围已转交"拒绝。
for (const entry of ['foreground', 'detach', 'attended'] as const) {
  cases.push({ name: `P3 t5 A13 ${entry}：已有范围转交（持有者中断）→ 重发同一请求即重新接入持有者并完成，不需要技术旗标`, run: () => withSnapshot(async s => {
    const feature = SNAPSHOT_FLAT_FEATURE;
    const [source] = runIds(s.root, feature);
    freezeAndTransfer(s, feature, source);
    fs.rmSync(featureFilePath(s.root, feature, 'ut/reports/phase-evidence-manifest.json'));
    const requirement = readJson<{ requirement: string }>(runFile(s.root, feature, source, 'manifest.json')).requirement;
    const { successor: holder, error } = await supersede(s, feature, source, ['ut'], {
      failExecutorFor: () => false, onUt: () => { throw new Error('injected crash inside ut'); },
    });
    assert(holder, `夹具：显式后继须出生：${error}`);
    assert.strictEqual(readFeatureFrozenScope(s.root, feature)?.transfers?.at(-1)?.run_id, holder, '夹具：范围已转交给中断的后继');
    // 测试桩代际补丁（与 runGoalRuntimeChain 的 resume 路径、goal-park-resume 同一个）：假 agent 不落 Job 绑定事件，
    // 中断留下的未闭合调用会被 Windows 接管对账当成旧版 run 拒绝续跑——补一对闭合的绑定事件，模拟当前版本的干净收尾。
    sealLegacyInvokes(s.root, feature, holder!);
    const before = runIds(s.root, feature).length;
    const done = await requestVia(entry, s.root, {
      frameworkRoot: s.frameworkRoot, featureId: feature, freshRequirement: requirement, freshStartPhase: 'ut', freshEndPhase: 'ut',
    });
    clearFrameworkConfigCache();
    assert.strictEqual(runIds(s.root, feature).length, before, '重新接入持有者，不新建 run');
    assert(done.invokedPhases.includes('ut'), `重新接入后须执行 ut：${done.invokedPhases.join(',')}`);
    const status = String([...goalRunEvents(s.root, holder!, feature)].reverse().find(e => e.type === 'run_end')?.status ?? '');
    assert(/COMPLETED/.test(status), `持有者须完成：${status}`);
  }) });
}

// plan 4e6fb3b6 §7.2 之外的补充（调度方 2026-09-29 裁定加入）：功能已完成之后再提需求——没有未终局 run、范围由已完成 run 持有，
// 带需求增量重发（不带任何技术旗标）即从这个已完成 run 起后继；原样重发保持停止。
const INCREMENT_AFTER_COMPLETION = '查询超时由 3s 改为 5s（非视觉行为调整）';
for (const entry of ['foreground', 'detach'] as const) {
  cases.push({ name: `P3 t5 补充 ${entry}：已完成功能 + 需求增量重发（无旗标）→ 从已完成的持有者起后继并开始执行`, run: () => withSnapshot(async s => {
    const feature = SNAPSHOT_FLAT_FEATURE;
    const [completed] = runIds(s.root, feature);
    freezeAndTransfer(s, feature, completed);
    ensureFakeDeveco(s);
    const before = new Set(runIds(s.root, feature));
    const done = await requestVia(entry, s.root, {
      frameworkRoot: s.frameworkRoot, featureId: feature, freshRequirement: INCREMENT_AFTER_COMPLETION, failExecutorFor: () => true,
      freshStartPhase: 'spec', freshEndPhase: 'plan', // 原样重放原请求的起止（快照完成 run 的出生范围 spec→plan）
    });
    clearFrameworkConfigCache();
    const successor = runIds(s.root, feature).find(id => !before.has(id) && fs.existsSync(runFile(s.root, feature, id, 'manifest.json')));
    assert(successor, `须起后继：${runIds(s.root, feature).join(',')}`);
    const manifest = readJson<{ successor_of?: string; requirement: string }>(runFile(s.root, feature, successor!, 'manifest.json'));
    assert.strictEqual(manifest.successor_of, completed, '合同来源须是已完成的持有者');
    assert(manifest.requirement.includes(INCREMENT_AFTER_COMPLETION), '后继需求须合并本次增量');
    assert(auditedBy(s, feature, successor!, completed), '承接须写审计事件');
    assert.strictEqual(readFeatureFrozenScope(s.root, feature)?.transfers?.at(-1)?.run_id, successor, '范围转交须登记到后继');
    assert(done.invokedPhases.length > 0, `后继须开始执行：${done.invokedPhases.join(',')}`);
  }) });
}
cases.push({ name: 'P3 R4 有人在场：已完成功能 + 需求增量重发 → prepare-run 出生后继，附着补完承接审计与范围转交，在有人在场执行者之下真正执行', run: () => withSnapshot(async s => {
  const feature = SNAPSHOT_FLAT_FEATURE;
  const [completed] = runIds(s.root, feature);
  freezeAndTransfer(s, feature, completed);
  ensureFakeDeveco(s);
  const done = await requestVia('attended', s.root, {
    frameworkRoot: s.frameworkRoot, featureId: feature, freshRequirement: INCREMENT_AFTER_COMPLETION, failExecutorFor: () => true,
  });
  clearFrameworkConfigCache();
  const successor = runIds(s.root, feature).find(id => id !== completed);
  assert(successor, `须起后继：${runIds(s.root, feature).join(',')}`);
  const manifest = readJson<{ successor_of?: string; requirement: string }>(runFile(s.root, feature, successor!, 'manifest.json'));
  assert.strictEqual(manifest.successor_of, completed);
  assert(manifest.requirement.includes(INCREMENT_AFTER_COMPLETION), '后继需求须合并本次增量');
  assert(auditedBy(s, feature, successor!, completed), '附着须补写承接审计');
  assert.strictEqual(readFeatureFrozenScope(s.root, feature)?.transfers?.at(-1)?.run_id, successor, '范围转交须登记到后继');
  assert(done.invokedPhases.length > 0, `后继须在有人在场执行者之下执行：${done.invokedPhases.join(',')}`);
}) });

cases.push({ name: 'P3 R3/R4 二轮 有人在场起后继：起止与来源相同 → 后继出生；带 --end spec（与来源不同）→ 拒绝、不新建 run', run: () => withSnapshot(async s => {
  const feature = SNAPSHOT_FLAT_FEATURE;
  const [completed] = runIds(s.root, feature);
  freezeAndTransfer(s, feature, completed);
  ensureFakeDeveco(s);
  const base = { frameworkRoot: s.frameworkRoot, featureId: feature, freshRequirement: INCREMENT_AFTER_COMPLETION, failExecutorFor: () => true, freshStartPhase: 'spec' as const };
  let refused = '';
  try { await requestVia('attended', s.root, { ...base, freshEndPhase: 'spec' }); } catch (e) { refused = (e as Error).message; }
  clearFrameworkConfigCache();
  assert(/与原请求不同的起止/.test(refused) && /--end spec/.test(refused), `须明确拒绝并说明：${refused}`);
  assert.deepStrictEqual(runIds(s.root, feature), [completed], '拒绝时不得新建 run');
  await requestVia('attended', s.root, { ...base, freshEndPhase: 'plan' });
  clearFrameworkConfigCache();
  const successor = runIds(s.root, feature).find(id => id !== completed);
  assert(successor && readJson<{ successor_of?: string }>(runFile(s.root, feature, successor, 'manifest.json')).successor_of === completed, '起止与来源相同 → 后继出生');
}) });

cases.push({ name: 'P3 R2 后继出生后在 run_start 之前停下（产品层目录缺失）→ 修好 → 重发同一请求附着 → 补写承接审计、范围转交登记到后继', run: () => withSnapshot(async s => {
  const feature = SNAPSHOT_FLAT_FEATURE;
  const [completed] = runIds(s.root, feature);
  freezeAndTransfer(s, feature, completed);
  ensureFakeDeveco(s);
  const layer = path.join(s.root, '02-Feature');
  fs.renameSync(layer, `${layer}.away`);
  const req = { frameworkRoot: s.frameworkRoot, featureId: feature, freshRequirement: INCREMENT_AFTER_COMPLETION, failExecutorFor: () => true, freshStartPhase: 'spec' as const, freshEndPhase: 'plan' };
  try {
    await requestVia('foreground', s.root, req);
  } finally {
    fs.renameSync(`${layer}.away`, layer);
  }
  clearFrameworkConfigCache();
  const successor = runIds(s.root, feature).find(id => id !== completed)!;
  const ev = (): Array<{ type?: string; target_run_id?: string; halt_reason?: string }> => fs.readFileSync(runFile(s.root, feature, successor, 'events.jsonl'), 'utf8')
    .split('\n').filter(Boolean).map(l => JSON.parse(l));
  assert(successor && ev().some(e => e.halt_reason === 'declared_product_layer_missing') && !ev().some(e => e.type === 'run_start'),
    '夹具：后继已出生、在 run_start 之前停在产品层目录缺失');
  assert.strictEqual(readFeatureFrozenScope(s.root, feature)?.transfers?.at(-1)?.run_id, completed, '夹具：范围仍归完成 run');
  const done = await requestVia('foreground', s.root, req);
  clearFrameworkConfigCache();
  assert.strictEqual(runIds(s.root, feature).length, 2, '附着同一后继，不新建');
  assert.strictEqual(ev().filter(e => e.type === 'supersede' && e.target_run_id === completed).length, 1, '须补写一次承接审计');
  assert.strictEqual(readFeatureFrozenScope(s.root, feature)?.transfers?.at(-1)?.run_id, successor, '范围转交须登记到后继');
  assert(done.invokedPhases.length > 0, `后继须开始执行：${done.invokedPhases.join(',')}`);
}) });

cases.push({ name: 'P3 R3 自动起的后继：本次给了与原请求不同的终点（--end spec）→ 明确拒绝、不新建 run；原样重放原请求起止则照常出生（见补充用例）', run: () => withSnapshot(async s => {
  const feature = SNAPSHOT_FLAT_FEATURE;
  const [completed] = runIds(s.root, feature);
  freezeAndTransfer(s, feature, completed);
  ensureFakeDeveco(s);
  let error = '';
  try {
    await requestVia('foreground', s.root, {
      frameworkRoot: s.frameworkRoot, featureId: feature, freshRequirement: INCREMENT_AFTER_COMPLETION, failExecutorFor: () => true,
      freshStartPhase: 'spec', freshEndPhase: 'spec',
    });
  } catch (e) { error = (e as Error).message; }
  clearFrameworkConfigCache();
  assert(/与原请求不同的起止/.test(error) && /--end spec/.test(error), `须明确拒绝并说明原因：${error}`);
  assert.deepStrictEqual(runIds(s.root, feature), [completed], '拒绝时不得新建 run');
}) });

// plan 4e6fb3b6 最终评审返修：宿主把"旧需求 + 框架标准增量段 + 新增要求"整段当作本次需求发来——两个入口共用同一个函数得出后继需求，
// 格式标记不是丢弃内容的依据。第二步再发同样的内容（换行不同）：去掉已有内容后什么都不剩 → 按重复处理，不再起后继。
for (const entry of ['attended', 'foreground'] as const) {
  cases.push({ name: `P3 最终评审返修 ${entry}：本次需求已是合并格式（旧需求 + 标准增量段 + 新增要求）→ 起后继、新增要求进 manifest、标记只一个、出生范围非空；再发同内容 → 按重复处理，不再起后继`, run: () => withSnapshot(async s => {
    const feature = SNAPSHOT_FLAT_FEATURE;
    const [completed] = runIds(s.root, feature);
    freezeAndTransfer(s, feature, completed);
    ensureFakeDeveco(s);
    const sourceRequirement = readJson<{ requirement: string }>(runFile(s.root, feature, completed, 'manifest.json')).requirement;
    assert(!sourceRequirement.includes(SUCCESSOR_REQUIREMENT_INCREMENT_MARKER), '夹具：快照完成 run 的需求没有历史增量');
    const marked = mergeSuccessorRequirement(sourceRequirement, INCREMENT_AFTER_COMPLETION);
    // 原样重放原请求的起止（快照完成 run 的出生范围 spec→plan）
    const base = { frameworkRoot: s.frameworkRoot, featureId: feature, failExecutorFor: () => true, freshStartPhase: 'spec' as const, freshEndPhase: 'plan' };
    let error = '';
    try { await requestVia(entry, s.root, { ...base, freshRequirement: marked }); } catch (e) { error = (e as Error).message; }
    clearFrameworkConfigCache();
    const successor = runIds(s.root, feature).find(id => id !== completed && fs.existsSync(runFile(s.root, feature, id, 'manifest.json')));
    assert(successor, `须起后继：${error || runIds(s.root, feature).join(',')}`);
    const manifest = readJson<{ successor_of?: string; requirement: string; execution_scope?: { phase_chain?: string[] } }>(runFile(s.root, feature, successor!, 'manifest.json'));
    assert.strictEqual(manifest.successor_of, completed, '合同来源须是已完成的持有者');
    assert(manifest.requirement.includes(INCREMENT_AFTER_COMPLETION), `新增要求须进 manifest：${manifest.requirement}`);
    assert.strictEqual(manifest.requirement.split(SUCCESSOR_REQUIREMENT_INCREMENT_MARKER).length - 1, 1, `标记只出现一次：${manifest.requirement}`);
    assert.strictEqual(manifest.requirement, marked, '结果 = 源需求全文 + 新增段');
    assert((manifest.execution_scope?.phase_chain ?? []).length > 0, `出生范围不得为空：${JSON.stringify(manifest.execution_scope?.phase_chain)}`);
    // 再发同内容：原请求段与源相同、标记之后与后继的历史增量块逐字相同，只是换行不同
    const reformatted = `${sourceRequirement}\n\n${SUCCESSOR_REQUIREMENT_INCREMENT_MARKER}\n\n${INCREMENT_AFTER_COMPLETION}`;
    assert.notStrictEqual(reformatted, marked, '夹具：两次文本字面不同');
    const before = runIds(s.root, feature).length;
    try { await requestVia(entry, s.root, { ...base, freshRequirement: reformatted }); } catch { /* 保持停止或重新接入都可以；只断言不起新的后继 */ }
    clearFrameworkConfigCache();
    assert.strictEqual(runIds(s.root, feature).length, before, `按重复处理，不得再起后继：${runIds(s.root, feature).join(',')}`);
  }) });
}

// plan 4e6fb3b6 最终评审返修 R1：相关修复的依据必须来自生产链。spec 由（假 agent 驱动的）真实 runtime 执行：agent 写 acceptance.yaml，
// 真实 checkAuthoritativeContentAligned 判 FAIL（affected_files 为绝对路径）、经真实 summary 写入器落盘到阶段报告目录（no_progress_guard 停机时 runtime 不归档进 run 目录），runtime 发出写入事件。
// 然后只修该文件、重发 → related_repair_changed。反例：未改不算；根外绝对路径被拒；本轮没写过该文件（没有生产基线）时修了也不冒充已修复。
async function runSpecFailingOnAuthority(s: Snapshot, agentWritesDrift: boolean): Promise<{ feature: string; runId: string; increment: string; acceptanceFile: string; authorityBytes: string }> {
  const feature = SNAPSHOT_CU_FEATURE;
  const [source] = runIds(s.root, feature);
  handWriteProjections(s.root);
  const acceptanceFile = featureFilePath(s.root, feature, 'acceptance.yaml');
  const authorityBytes = fs.readFileSync(acceptanceFile, 'utf8');
  const drift = (value: string): void => {
    const doc = YAML.parse(fs.readFileSync(acceptanceFile, 'utf8'));
    doc.criteria[0].expected_result = value;
    fs.writeFileSync(acceptanceFile, YAML.stringify(doc));
    clearFrameworkConfigCache();
  };
  // 运行前就与设计权威不一致（让 spec 入链）；agentWritesDrift 时 spec 的 agent 再改写一次（本阶段写自己的正式产物）
  drift('hand drift one');
  const sourceRequirement = readJson<{ requirement: string }>(runFile(s.root, feature, source, 'manifest.json')).requirement;
  const increment = '查询超时由 3s 改为 5s（非视觉行为调整）';
  clearFrameworkConfigCache();
  const born = resolveSuccessorExecutionScope(s.root, feature, resolveWorkflowSpec(s.root, { frameworkRoot: s.frameworkRoot }), s.frameworkRoot,
    mergeSuccessorRequirement(sourceRequirement, increment), source)!;
  assert.strictEqual(born.phase_chain[0], 'spec', `夹具：需求增量须让 spec 入链：${JSON.stringify(born.phase_chain)}`);
  const gate = (): CheckResult[] => {
    clearFrameworkConfigCache();
    const ctx = { projectRoot: s.root, frameworkRoot: s.frameworkRoot, feature, phaseRule: {}, featureSpec: new SpecLoader(s.root, undefined, undefined, s.frameworkRoot).loadFeatureSpec(feature) } as unknown as CheckContext;
    return checkAuthoritativeContentAligned(ctx, 'acceptance');
  };
  const { successor, error } = await supersede(s, feature, source, born.phase_chain, {
    freshRequirement: increment, failExecutorFor: () => false,
    ...(agentWritesDrift ? { onSpec: () => drift('agent drift two') } : {}),
    onHarnessSummary: ({ phase }) => (phase === 'spec' ? { checks: gate() } : null),
  });
  assert(successor, `夹具：后继须出生：${error}`);
  clearFrameworkConfigCache();
  const summary = readJson<{ verdict?: string; blockers?: Array<{ id?: string; affected_files?: string[] }> }>(path.join(featurePhaseReportsDir(s.root, feature, 'spec', s.frameworkRoot), 'summary.json'));
  const affected = (summary.blockers ?? []).filter(b => b.id === 'authoritative_content_aligned').flatMap(b => b.affected_files ?? []);
  assert(summary.verdict === 'FAIL' && affected.length === 1 && path.isAbsolute(affected[0]), `夹具：spec 失败且生产者给的是绝对路径：${JSON.stringify(summary.blockers)}`);
  return { feature, runId: successor!, increment, acceptanceFile, authorityBytes };
}

const runEnd = (s: Snapshot, feature: string, runId: string): string => {
  const end = [...goalRunEvents(s.root, runId, feature)].reverse().find(e => e.type === 'run_end') as { status?: string; halt_reason?: string } | undefined;
  return `${end?.status ?? '-'}/${end?.halt_reason ?? '-'}`;
};

cases.push({ name: 'P3 最终评审返修 R1：spec 由真实 runtime 写 acceptance.yaml、真实检查判 FAIL 后以无进展守卫停下；只修该文件重发 → related_repair_changed（基线来自生产事件）越过冷却重新接入；未改保持停止、根外绝对路径被拒', run: () => withSnapshot(async s => {
  const r = await runSpecFailingOnAuthority(s, true);
  const owned = goalRunEvents(s.root, r.runId, r.feature)
    .filter(e => e.type === 'phase_write_observed' && e.phase === 'spec')
    .flatMap(e => ((e as { owned?: Array<{ path?: string }> }).owned ?? []).map(row => row.path));
  assert(owned.includes(path.relative(s.root, r.acceptanceFile).replace(/\\/g, '/')), `runtime 须把 spec 写自己正式产物的写后哈希记进 owned：${JSON.stringify(owned)}`);
  // no_progress_guard 不是结构终局：有变化 → 重新接入（恢复）；无人值守、刚停下（冷却期内）且没有变化 → 保持停止。相关修复成立正是让它越过冷却。
  assert.strictEqual(runEnd(s, r.feature, r.runId), 'HALTED/no_progress_guard', '夹具：真实 runtime 以无进展守卫停下');
  const decide = () => decideRunContinuation({ projectRoot: s.root, feature: r.feature, call: { requirement: r.increment } });
  const before = decide();
  assert(before.kind === 'hold' && !/related_repair_changed/.test(before.reason), `文件未改不得算修复（冷却期内保持停止）：${JSON.stringify(before)}`);
  // 只修该文件（恢复为设计权威的内容）
  fs.writeFileSync(r.acceptanceFile, r.authorityBytes);
  clearFrameworkConfigCache();
  const after = decide();
  assert(after.kind === 'rejoin' && after.runId === r.runId && /related_repair_changed/.test(after.reason), `修了该文件须拿到修复依据、重新接入该 run：${JSON.stringify(after)}`);
  // 根外绝对路径：同一份 summary 的受影响文件换成工程根外的路径（该文件存在）→ 拿不到依据
  const summaryFile = path.join(featurePhaseReportsDir(s.root, r.feature, 'spec', s.frameworkRoot), 'summary.json');
  const original = fs.readFileSync(summaryFile, 'utf8');
  const outside = path.join(path.dirname(s.root), `outside-${path.basename(s.root)}.yaml`);
  fs.writeFileSync(outside, 'changed');
  try {
    const doc = JSON.parse(original) as { blockers?: Array<{ affected_files?: string[] }> };
    for (const b of doc.blockers ?? []) if (b.affected_files) b.affected_files = [outside];
    fs.writeFileSync(summaryFile, JSON.stringify(doc));
    const outsideDecision = decide();
    assert(outsideDecision.kind === 'hold' && !/related_repair_changed/.test(outsideDecision.reason), `工程根外的绝对路径须被拒绝：${JSON.stringify(outsideDecision)}`);
  } finally { fs.writeFileSync(summaryFile, original); fs.rmSync(outside, { force: true }); }
}) });

cases.push({ name: 'P3 最终评审返修 R1 反例：本轮 spec 没写过 acceptance.yaml（差异是运行前就有的）→ 没有生产基线，之后修了也不冒充已修复', run: () => withSnapshot(async s => {
  const r = await runSpecFailingOnAuthority(s, false);
  const owned = goalRunEvents(s.root, r.runId, r.feature)
    .filter(e => e.type === 'phase_write_observed')
    .flatMap(e => ((e as { owned?: Array<{ path?: string }> }).owned ?? []).map(row => row.path));
  assert(!owned.includes(path.relative(s.root, r.acceptanceFile).replace(/\\/g, '/')), `夹具：本轮没写过该文件：${JSON.stringify(owned)}`);
  fs.writeFileSync(r.acceptanceFile, r.authorityBytes);
  clearFrameworkConfigCache();
  const d = decideRunContinuation({ projectRoot: s.root, feature: r.feature, call: { requirement: r.increment } });
  assert(d.kind === 'hold' && !/related_repair_changed/.test(d.reason), `没有基线不得冒充已修复（冷却期内保持停止）：${JSON.stringify(d)}`);
}) });

cases.push({ name: 'P3 t5 补充：已完成功能 + 原样重发同一需求 → 保持停止，run 数与事件数不变，说明写明在请求里写新增或变更的需求', run: () => withSnapshot(async s => {
  const feature = SNAPSHOT_FLAT_FEATURE;
  const [completed] = runIds(s.root, feature);
  freezeAndTransfer(s, feature, completed);
  const requirement = readJson<{ requirement: string }>(runFile(s.root, feature, completed, 'manifest.json')).requirement;
  const d = decideRunContinuation({ projectRoot: s.root, feature, call: { requirement } });
  assert(d.kind === 'hold' && /已经完成/.test(d.guidance) && /新增或变更的需求/.test(d.guidance), JSON.stringify(d));
  ensureFakeDeveco(s);
  const eventsBefore = fs.readFileSync(runFile(s.root, feature, completed, 'events.jsonl'), 'utf8');
  const out = await requestVia('foreground', s.root, { frameworkRoot: s.frameworkRoot, featureId: feature, freshRequirement: requirement });
  clearFrameworkConfigCache();
  assert.strictEqual(out.exitCode, 1, '须保持停止');
  assert.deepStrictEqual(runIds(s.root, feature), [completed], '不得新建 run');
  assert.strictEqual(fs.readFileSync(runFile(s.root, feature, completed, 'events.jsonl'), 'utf8'), eventsBefore, '不得写事件');
}) });

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
