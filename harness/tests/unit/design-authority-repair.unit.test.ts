import { unitCaseGroups } from '../utils/unit-case-selection';
// Current design publication, source protection and real writer/authority recovery boundaries.
// Lifecycle integration stays in L1b, R5 and the S16 main flow; retired phase-gate drivers are not replayed.

import assert from 'assert';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as YAML from 'yaml';

import { clearFrameworkConfigCache, featureFilePath, featurePhaseReportsDir, relFeaturesDir } from '../../config';
import { resolveWorkflowSpec } from '../../workflow-loader';
import { projectGoalProgress } from '../../scripts/utils/goal-progress';
import { runGoalModeSessionStep as runGoalModeSessionStepUnchecked } from '../../scripts/goal-mode-entry';
import { designRepairAttempted, runUnattendedDesignRepair } from '../../scripts/utils/design-repair-unattended';
import { readSupersededAncestorRuns, loadAuthoritativeEvents, readExecutionActivity } from '../../scripts/utils/goal-runner-phase';
import { readBoundInput } from '../../scripts/utils/capability-resolution';
import {
  BLUEPRINT_RECONCILE_LOCK_NAME, RECONCILE_BUSY_HINT, deriveDesignPreparationReadiness, reconcileChangeUnitBlueprintRefs,
} from '../../scripts/utils/change-unit-design-preparation';
import { deriveChangeUnitFeatureId, enumerateCanonicalChangeUnits, loadCanonicalChangeUnit, pointerStaleCandidate } from '../../scripts/utils/change-unit-path';
import { checkChangeUnitFeatureProjection } from '../../scripts/utils/change-unit-feature-projection';
import { checkAuthoritativeContentAligned, classifyDesignAuthorityCodes, compareAuthoritativeContent, deriveBlueprintSkillInput, materializeBlueprintSkillInputs, diagnoseBlueprintSkillAuthority } from '../../scripts/utils/blueprint-skill-projection';
import { parseVerifierRequest } from '../../scripts/utils/verifier-request';
import { requiredQuestioningScopes } from '../../scripts/utils/blueprint-questioning';
import { publishFixtureVerifierEvidence } from '../utils/verifier-evidence-fixture';
import { loadCanonicalBlueprint } from '../../scripts/utils/component-blueprint-path';
import { blueprintReviewPath, inspectBlueprintReview } from '../../scripts/utils/blueprint-review-materialization';
import { blockerIssues, validateComponentBlueprint, validateComponentBlueprintUpstream } from '../../scripts/utils/component-blueprint-validator';
import { deriveBlueprintAdmission } from '../../scripts/utils/blueprint-admission';
import { featureScopeCandidateFingerprint, prepareFeatureScopeCandidate } from '../../scripts/utils/feature-track';
import { createGoalRun, decideRunContinuation, loadEffectiveExecutionScope, staleFrozenBindings } from '../../scripts/utils/goal-run-creation';
import { freezeFeatureExecutionScope, readFeatureFrozenScope } from '../../scripts/utils/feature-execution-scope';
import { buildGoalManifestFromInput } from '../../scripts/utils/goal-manifest';
import { runConditionProbe } from '../../scripts/utils/condition-wait';
import * as supervise from '../../scripts/goal-supervise';
import { __testing_setLockHeartbeatMs, lockHeartbeatIntervalMs } from '../../scripts/goal-phase-runtime';
import { __testing_setPidProbeExecutor } from '../../scripts/utils/goal-containment-reconcile';
import { livenessBeaconPath, writeLivenessBeacon } from '../../scripts/utils/liveness-beacon';
import { readHandoffMaterial } from '../../scripts/utils/session-execution-handoff';
import { requestVia, runGoalRuntimeChain } from './goal-runner-testing-integrity.unit.test';
import { publishRequestedVerifier, codingTestStrengthReply, writeCuFacts, writeCuSpecDraft, writeCuSpecMaterials, writeCuPlanMaterials, writeCuCodingMaterials, writeCuReviewMaterials, writeCuUtMaterials } from './real-chain.unit.test';
import { FEATURE_LOCK_NAME, releaseLock, touchLock, tryAcquireLock } from '../../scripts/utils/goal-run-lock';
import { SpecLoader } from '../../scripts/utils/spec-loader';
import type { CheckContext, CheckResult } from '../../scripts/utils/types';
import { invocationCompleted } from '../../scripts/utils/invocation-completion';
import { SNAPSHOT_CU_FEATURE } from '../fixtures/host-snapshot-3.1.0/generate';
import { researchSnapshotFacts } from '../fixtures/host-snapshot-3.1.0/migrate';
import { authorCurrentCuPlan, handWriteProjections } from './component-design-handoff.unit.test';
import {
  BLUEPRINT_ID, assess, authorHooks, brief, bumpBlueprint, cachedPrefix, commit, handWrittenCompletion, prepareFreshCuRequest, project, specFirstCuHooks, successorChain, withFreshCuHost, withHost, withSnapshot,
} from './lifecycle-evolution.unit.test';
import { NEW_EXPECTED_RESULT, changeProjectedAcceptance, readJson, runFile, runIds, supersede } from './successor-exit.unit.test';
import type { UnitCaseResult } from '../run-unit';
import { matchesUnitCase, selectedUnitCases, startCaseTiming, SelectedUnitCases, UnitExecutionTiming } from '../utils/unit-case-selection';
import { withRuntimeTest, type RuntimeTestControl } from '../utils/runtime-test-control';
const runGoalModeSessionStep = (options: Parameters<typeof runGoalModeSessionStepUnchecked>[0], testControl: RuntimeTestControl = {}) =>
  withRuntimeTest({ root: options.projectRoot, ...testControl }, () => runGoalModeSessionStepUnchecked(options));


type Snapshot = Parameters<Parameters<typeof withHost>[0]>[0];
type Ev = Record<string, any>;
const CU = 'ledger-refresh';
const SIBLING = 'ledger-summary';

/** run 有效范围里全部输入绑定逐条经生产 readBoundInput 复读：ids = 绑定的 input_id，stale = 读不回来的。 */
export function boundInputs(s: Snapshot, feature: string, runId: string): { ids: string[]; stale: string[] } {
  clearFrameworkConfigCache();
  const scope = loadEffectiveExecutionScope(s.root, feature, runId);
  assert(scope, `run ${runId} 没有有效范围`);
  const bindings = scope!.obligations.flatMap(o => [...o.basis, ...(o.satisfied_by ?? [])])
    .filter((ref): ref is Parameters<typeof readBoundInput>[1] => 'input_id' in ref);
  const stale = bindings.flatMap(binding => {
    try {
      readBoundInput({ projectRoot: s.root, frameworkRoot: s.frameworkRoot, feature, phase: 'coding', track: 'full' }, binding);
      return [];
    } catch (error) { return [`${binding.input_id}: ${(error as Error).message}`]; }
  });
  return { ids: [...new Set(bindings.map(b => b.input_id))].sort(), stale: [...new Set(stale)].sort() };
}

const blueprintFile = (s: Snapshot): string => path.join(featureFilePath(s.root, BLUEPRINT_ID, ''), 'blueprint', 'component-blueprint.yaml');
const eventsOf = (s: Snapshot, feature: string, runId: string): Ev[] =>
  fs.readFileSync(runFile(s.root, feature, runId, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as Ev);
const featureLockPath = (s: Snapshot, changeUnitId: string): string =>
  featureFilePath(s.root, deriveChangeUnitFeatureId(BLUEPRINT_ID, changeUnitId), path.join('goal-runs', FEATURE_LOCK_NAME));
const cuBytes = (s: Snapshot): Record<string, string> => Object.fromEntries(enumerateCanonicalChangeUnits(s.root, BLUEPRINT_ID)
  .map(u => [String(u.changeUnit.change_unit_id), u.artifactSha256]));
const pointsAtCurrentBlueprint = (s: Snapshot, changeUnitId: string): boolean => {
  const ref = loadCanonicalChangeUnit(s.root, BLUEPRINT_ID, changeUnitId).changeUnit.component_blueprint_ref as { revision?: number; artifact_sha256?: string };
  const current = loadCanonicalBlueprint(s.root, BLUEPRINT_ID);
  return ref.revision === Number(current.blueprint.revision) && ref.artifact_sha256 === current.artifactSha256;
};
const checkCtx = (s: Snapshot, feature: string): CheckContext => {
  clearFrameworkConfigCache();
  return { projectRoot: s.root, frameworkRoot: s.frameworkRoot, feature, phaseRule: {}, featureSpec: new SpecLoader(s.root, undefined, undefined, s.frameworkRoot).loadFeatureSpec(feature) } as unknown as CheckContext;
};

/** 宿主里已存在、CU 事实已覆盖、但原施工契约未授权的文件：蓝图升版把它加进授权写集（plan 责任方据此对齐 contracts）。 */
const NEW_CONTRACT_FILE = 'src/ledger/LedgerSourceSeam.ts';
function ledgerDomain(bp: Record<string, unknown>): Ev {
  let hit: Ev | undefined;
  const visit = (v: unknown): void => {
    if (hit || !v || typeof v !== 'object') return;
    if (Array.isArray(v)) { v.forEach(visit); return; }
    if ((v as { node_id?: string }).node_id === 'ledger-domain') { hit = v as Ev; return; }
    Object.values(v).forEach(visit);
  };
  visit(bp);
  assert(hit, '快照蓝图缺 ledger-domain');
  return hit!;
}


// ---- S15：B 类停机 → 修好 → 自动续跑 -------------------------------------------------------------
//
// 两种宿主形状：
//  · 全手写（宿主原始形状）：acceptance / contracts / use-cases 都是手写无戳文件，绑定是 artifact——蓝图内容变化后
//    由 spec / plan 在链内改写、经范围修订重签，所以修好后重新接入同一 run。
//  · 派生施工契约：acceptance 手写、contracts / use-cases 不落盘，施工契约绑定来自 `derive.blueprint-contracts`——
//    没有责任阶段能重签；修复改了它依赖的蓝图内容时同一 run 续不下去，要自动起后继。

const TEXT_ACCEPTANCE = '验收写成了一段文本';
/** 施工契约写成了文字，原文写明授权写集在原有文件之外还包括 NEW_CONTRACT_FILE（绑定失效支的原文依据）。 */
const reportDirOf = (s: Snapshot, feature: string, runId: string): string => path.relative(s.root, path.dirname(runFile(s.root, feature, runId, 'events.jsonl'))).replace(/\\/g, '/');
const haltOf = (events: Ev[]): Ev | undefined => events.filter(e => e.type === 'phase_halt').at(-1);
const endOf = (events: Ev[]): Ev | undefined => events.filter(e => e.type === 'run_end').at(-1);
const verdictsOf = (events: Ev[]): string[] => events.filter(e => e.type === 'phase_verdict').map(e => `${e.phase}:${e.verdict}:${e.action ?? ''}`);
const sha = (file: string): string => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const restoreNode = (node: Ev, saved: Ev): void => { for (const key of Object.keys(node)) delete node[key]; Object.assign(node, structuredClone(saved)); };

/** 场景侧（reliability-scenarios）如实记下的人为动作：设计修复 / 有权者裁决 / 重新发起同一请求。 */
export interface RepairIntervention { kind: 'manual_file_edit' | 'product_decision' | 'rescue_command'; content: string; necessary: boolean; related_events?: Array<{ run_id: string; event_index: number }> }
export interface RepairFlow {
  feature: string;
  /** 本任务的全部 run（出生顺序）：停机的 run，以及框架自动起的后继。 */
  runs: string[];
  halted?: string;
  /** 停机事件在停机 run 事件流里的下标（扰动点）。 */
  haltIndex?: number;
  haltClass: string;
  interventions: RepairIntervention[];
  evidence: string;
}

/** 以生产 supervisor CLI 真跑一轮（真实探针）；spawn 注入只记录它发出的 runner 参数。beacon 删掉 = 停放 run 的进程已不在。 */
export async function superviseOnce(s: Snapshot, feature: string, runId: string): Promise<{ code: number; spawned: string[][] }> {
  const spawned: string[][] = [];
  const prevArgv = process.argv;
  const prevCwd = process.cwd();
  fs.rmSync(livenessBeaconPath(s.root, reportDirOf(s, feature, runId)), { force: true });
  try {
    supervise.__testing_setSpawnImpl((_file, args) => { spawned.push(args.slice(2)); return { pid: 4242, unref: () => undefined } as never; });
    process.argv = ['node', 'goal-supervise.ts', '--feature', feature, '--run-id', runId, '--project-root', s.root];
    process.chdir(s.root);
    clearFrameworkConfigCache();
    return { code: await supervise.__testing_main(), spawned };
  } finally {
    supervise.__testing_setSpawnImpl(null);
    process.argv = prevArgv;
    try { process.chdir(prevCwd); } catch { /* ignore */ }
  }
}

function assertCompletedBy(s: Snapshot, feature: string, runId: string, label: string): void {
  const events = eventsOf(s, feature, runId);
  const final = assess(s, feature);
  assert(endOf(events)?.status === 'CHAIN_SLICE_COMPLETED' && final.complete && final.record.state !== 'absent' && final.record.run_id === runId,
    `${label}：任务应由 run ${runId} 正确完成：${JSON.stringify(verdictsOf(events))} halt=${JSON.stringify(haltOf(events)?.reason)} end=${JSON.stringify(endOf(events))}\n${brief(final)}`);
  const onDisk = YAML.parse(fs.readFileSync(featureFilePath(s.root, feature, 'acceptance.yaml'), 'utf8')) as { criteria: Array<{ id: string; expected_result: string }> };
  const authoritative = deriveBlueprintSkillInput(s.root, feature, s.frameworkRoot, 'acceptance');
  assert.strictEqual(authoritative.state, 'resolved', `${label}：当前验收权威必须可用：${authoritative.detail}`);
  const expected = (authoritative.value as Ev).criteria.find((c: Ev) => c.id === 'AC-1')?.expected_result;
  assert.strictEqual(typeof expected, 'string', `${label}：当前权威须声明 AC-1 的 expected_result`);
  assert.strictEqual(onDisk.criteria.find(c => c.id === 'AC-1')?.expected_result, expected, `${label}：最终验收应是当前设计权威的文本`);
}

// ---- S16：无人值守 B1 由框架派设计修复自动接手 ---------------------------------------------------------
//
// 只有 adapter 的两次链外调用由测试替身（driver 的 onOutOfChain）扮演：编写方在草稿里改、质询方在草稿里写质询结果。
// 锁、草稿、写归因核对、准入派生与写回、真实校验、发布、调和、探针、恢复判断全部是生产路径。

const LOCAL_FILE = (s: Snapshot): string => path.join(s.root, 'framework.local.json');
/** 用户在个人配置里写下预授权（宿主动作，属前提，不计入故障后的操作者动作）。 */
function preauthorize(s: Snapshot, value: unknown = true): void {
  const local = readJson<Record<string, unknown>>(LOCAL_FILE(s));
  local.design_repair = { unattended_b1: value };
  fs.writeFileSync(LOCAL_FILE(s), JSON.stringify(local, null, 2));
}
const draftPathOf = (prompt: string): string => {
  const hit = /草稿文件[^：\n]*：(.+)$/m.exec(prompt);
  assert(hit, `链外调用的提示词须写明草稿文件：${prompt.slice(0, 300)}`);
  return hit![1].trim();
};
const readDoc = (file: string): Ev => YAML.parse(fs.readFileSync(file, 'utf8')) as Ev;
const writeDoc = (file: string, doc: Ev): void => fs.writeFileSync(file, YAML.stringify(doc));

type OutOfChainCtx = { phase: string; prompt: string; attempt: number; runId: string };
interface RepairAdapterLog { prompts: Record<string, string[]>; lockedDuringAuthor?: { blueprint: boolean; features: Record<string, boolean>; attemptedBeforeInvoke: boolean } }
/**
 * 假 adapter（两次链外调用的产出替身）：
 *  · 编写方：默认把被写坏的节点按原意改回机器结构（`h.saved`），可由 `author` 改写行为（越界写入、自报准入……）；
 *  · 质询方：默认按必答范围产出完整质询结果——内容取 canonical 里原有的质询项、换成质询方标识；`questioning` 可改写（不可用、无结果……）。
 * 编写调用进行中顺带记下：两层锁是否都在、attempted 是否已落盘（"落盘成功后才派发"的直接证据）。
 */
export function repairAdapter(s: Snapshot, saved: () => Ev | undefined, opts: {
  author?: (doc: Ev, draft: string) => Record<string, unknown> | void | Promise<Record<string, unknown> | void>;
  questioning?: (doc: Ev, draft: string) => Record<string, unknown> | void | Promise<Record<string, unknown> | void>;
  /** 编写方对被写坏节点的改法；缺省仅还原原值，不顺带改变设计事实。 */
  fix?: (node: Ev, saved: Ev) => void;
} = {}): { log: RepairAdapterLog; onOutOfChain: (ctx: OutOfChainCtx) => Promise<Record<string, unknown> | void> } {
  const log: RepairAdapterLog = { prompts: {} };
  return {
    log,
    onOutOfChain: async ctx => {
      (log.prompts[ctx.phase] ??= []).push(ctx.prompt);
      if (ctx.phase.endsWith('-verifier-format-repair')) {
        const delivered = ctx.prompt.slice(ctx.prompt.lastIndexOf('\n{') + 1);
        const request = parseVerifierRequest(delivered.slice(0, delivered.indexOf('\n}') + 2));
        assert(request, `补核实必须携带现成的当前 request；actual_phase=${ctx.phase}`);
        assert.equal(ctx.phase, request.phase + '-verifier-format-repair', '运输 phase 必须与真实 request 一致');
        const reportsDir = featurePhaseReportsDir(s.root, request.feature, request.phase, s.frameworkRoot);
        const summary = readJson<Ev>(path.join(reportsDir, 'summary.json'));
        assert.equal(summary.verifier_subject_id, request.subject_id, '模型回复不得签旧 subject');
        const promptPath = path.resolve(s.root, request.prompt_path);
        assert(promptPath.startsWith(path.resolve(s.root) + path.sep), '只读当前工程的实际核实材料');
        fs.readFileSync(promptPath, 'utf8');
        const kind = request.phase === 'spec' ? 'acceptance' : 'contracts';
        const projected = deriveBlueprintSkillInput(s.root, request.feature, s.frameworkRoot, kind);
        const actual = readDoc(featureFilePath(s.root, request.feature, kind + '.yaml'));
        const drift = projected.state === 'resolved' ? compareAuthoritativeContent(projected.value, actual) : null;
        const aligned = drift?.state === 'aligned';
        if (['coding', 'review', 'ut', 'testing'].includes(request.phase) && aligned) {
          const code = (actual.files ?? []).filter((file: unknown): file is string => typeof file === 'string' && /\.(?:ets|ts)$/.test(file));
          assert(code.length > 0, '独立模型不能批准没有当前源码的实现材料');
          for (const file of code) {
            const absolute = path.resolve(s.root, file);
            assert(absolute.startsWith(path.resolve(s.root) + path.sep), '只读请求内的实际源码');
            assert(fs.readFileSync(absolute).length > 0, '独立模型不能批准尚未实现的空源码');
          }
        }
        const detail = aligned ? '独立模型替身已读取当前 request 与真实作者文件；内容与当前已发布蓝图投影一致。'
          : `当前权威/作者材料尚不一致：${projected.detail ?? JSON.stringify(drift)}`;
        const acceptance = kind === 'acceptance' ? actual : readDoc(featureFilePath(s.root, request.feature, 'acceptance.yaml'));
        const body = '```yaml\n' + YAML.stringify({ verification_result: { phase: request.phase, feature: request.feature,
          checks: [{ id: 'authoritative_content_aligned', status: aligned ? 'PASS' : 'FAIL', severity: 'BLOCKER', details: detail,
            ...(!aligned ? { acceptance_ids: Array.isArray(acceptance.criteria) ? acceptance.criteria.map((row: Ev) => row.id) : [], affected_files: [path.relative(s.root, blueprintFile(s)).replace(/\\/g, '/')] } : {}) }],
          summary: { pass: aligned ? 1 : 0, fail: aligned ? 0 : 1, blockers: aligned ? 0 : 1, verdict: aligned ? 'PASS' : 'FAIL' } } }) + '```\n'
          + (aligned ? '' : '```issue-verification\n' + YAML.stringify([{ issue: 'authoritative_content_aligned', verdict: 'confirmed', repair_owner: 'external', evidence: detail }]) + '```\n')
          + (aligned && request.phase === 'coding' ? codingTestStrengthReply({ ...project(s, request.feature), runId: ctx.runId }, 'coding') : '');
        publishFixtureVerifierEvidence({ projectRoot: s.root, reportsDir, feature: request.feature, phase: request.phase,
          subjectId: request.subject_id, skipSummaryPatch: true, verdict: aligned ? 'PASS' : 'FAIL', blockerCount: aligned ? 0 : 1, reportText: body });
        return;
      }
      const draft = draftPathOf(ctx.prompt);
      const doc = readDoc(draft);
      if (ctx.phase === 'design-repair-author') {
        const reportDir = path.dirname(path.dirname(draft));
        log.lockedDuringAuthor = {
          blueprint: fs.existsSync(path.join(featureFilePath(s.root, BLUEPRINT_ID, ''), BLUEPRINT_RECONCILE_LOCK_NAME)),
          features: Object.fromEntries(enumerateCanonicalChangeUnits(s.root, BLUEPRINT_ID).map(u => [String(u.changeUnit.change_unit_id), fs.existsSync(featureLockPath(s, String(u.changeUnit.change_unit_id)))])),
          attemptedBeforeInvoke: fs.readFileSync(path.join(reportDir, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as Ev)
            .some(e => e.type === 'design_authority_repair' && e.stage === 'attempted'),
        };
        const node = ledgerDomain(doc);
        (opts.fix ?? restoreNode)(node, saved()!);
        const override = await opts.author?.(doc, draft);
        writeDoc(draft, doc);
        return override ?? undefined;
      }
      const canonicalQuestioning = readDoc(blueprintFile(s)).review_summary.questioning;
      doc.review_summary.questioning = { ...structuredClone(canonicalQuestioning), provider_id: 'design-repair-questioning' };
      const override = await opts.questioning?.(doc, draft);
      const output = JSON.stringify(doc.review_summary.questioning ?? null);
      return { stdout: output, details: output, ...override };
    },
  };
}

interface S16Born { feature: string; completed?: string; runId: string; events: Ev[]; requirement: string; request: { start: string; end: string }; saved: Ev; baseRevision: number; chain: string[]; error?: string; parentArgs?: string[]; childArgs?: string[] }
/**
 * S16 从 fresh CU 的坏设计请求入场；祖先事件场景先真实停在 B1/HALTED，再公开起后继。
 * spec 首轮从同需求 fixture 新建作者验收草稿与事实，内容修复后的重试按当前 provider 写正式阶段产物。
 */
export async function s16Born(s: Snapshot, opts: {
  entry?: 'detach';
  /** false = 不写预授权；其它值原样写进 design_repair.unattended_b1（缺省布尔 true）。 */
  preauth?: unknown; corrupt?: (node: Ev) => void; adapter?: Parameters<typeof repairAdapter>[2]; extra?: Record<string, unknown>;
  /** 真实 B1/HALTED 首 run 为事件与累计预算祖先，不伪称完成。 */
  ancestor?: boolean;
  allowSuccessors?: boolean;
  requestOnly?: boolean;
  /** 写坏蓝图之前的宿主准备（如兄弟 CU 的运行范围）；随写坏一起提交。 */
  beforeCorrupt?: () => void;
  /** 提交之后、本 run 出生之前（如另一个 run 已在跑）。 */
  beforeBirth?: (saved: Ev) => Promise<void>;
} = {}): Promise<S16Born & { log: RepairAdapterLog }> {
  const feature = SNAPSHOT_CU_FEATURE;
  if (opts.preauth !== false && !opts.ancestor) preauthorize(s, opts.preauth ?? true);
  opts.beforeCorrupt?.();
  let saved: Ev | undefined;
  bumpBlueprint(s, bp => { const node = ledgerDomain(bp); saved = structuredClone(node); (opts.corrupt ?? (n => { n.acceptance = TEXT_ACCEPTANCE; }))(node); });
  const r = reconcileChangeUnitBlueprintRefs(s.root, BLUEPRINT_ID);
  assert(r.bumped.some(b => b.change_unit_id === CU) && !r.skipped.length, JSON.stringify(r));
  commit(s, 'blueprint: acceptance written as prose by mistake');
  const baseRevision = Number(loadCanonicalBlueprint(s.root, BLUEPRINT_ID).blueprint.revision);
  const freshRequest = prepareFreshCuRequest(s, opts.requestOnly ? 'request' : 'feature');
  let chain = freshRequest.chain;
  assert(chain[0] === 'spec' && chain.includes('plan'), `前提：出生链含 spec 与 plan：${JSON.stringify(chain)}`);
  const p = project(s, feature);
  const aligned = specFirstCuHooks(p, true);
  const initialDraft = (ctx: Parameters<typeof aligned.onAuthor>[0], context: Parameters<typeof aligned.onAuthor>[1]): void => {
    const admitted = context.factsContext;
    assert(admitted && context.runId === ctx.runId, 'initial draft must consume the actual signed unit context');
    const factsFile = featureFilePath(s.root, feature, 'context/facts.md');
    const baseline = admitted.baseline && fs.existsSync(factsFile) ? fs.readFileSync(factsFile) : undefined;
    p.runId = ctx.runId; writeCuSpecDraft(p);
    if (baseline) fs.writeFileSync(factsFile, baseline);
    researchSnapshotFacts(s.root, factsFile, admitted.first_phase, admitted);
  };
  let ancestor: string | undefined;
  if (opts.ancestor) {
    preauthorize(s, false);
    commit(s, 'ancestor request has no unattended repair authorization');
    const parent = await runGoalRuntimeChain(s.root, {
      frameworkRoot: s.frameworkRoot, featureId: feature, adapter: 'codex', realHarness: true, noAutoForce: true, viaHostBridge: true,
      freshRequirement: freshRequest.requirement, freshStartPhase: chain[0], freshEndPhase: chain[chain.length - 1],
      onAuthor: initialDraft,
    });
    [ancestor] = runIds(s.root, feature);
    assert(ancestor, `真实祖先未出生：exit=${parent.exitCode}`);
    const events = eventsOf(s, feature, ancestor);
    assertNotDispatched({ events }, '真实 HALTED 祖先');
    assert.strictEqual(haltOf(events)?.design_authority?.class, 'B1', '祖先实际门命中 B1');
    assert.strictEqual(endOf(events)?.status, 'HALTED', '祖先没有完成事实');
    preauthorize(s, opts.preauth === false ? false : opts.preauth ?? true);
    commit(s, 'child request keeps the real halted ancestor');
    chain = successorChain(s, feature, ancestor);
    assert(chain[0] === 'spec' && chain.includes('plan'), `真实祖先后的出生链：${JSON.stringify(chain)}`);
  }
  await opts.beforeBirth?.(saved!);
  const adapter = repairAdapter(s, () => saved, opts.adapter);
  const before = new Set(runIds(s.root, feature));
  const hooks = {
    ...aligned, noAutoForce: true,
    onAuthor: (ctx: Parameters<typeof aligned.onAuthor>[0], context: Parameters<typeof aligned.onAuthor>[1]): void => {
      if (ctx.attempt === 1) initialDraft(ctx, context);
      else aligned.onAuthor(ctx, context);
    },
    onOutOfChain: adapter.onOutOfChain,
    ...opts.extra,
  };
  let error: string | undefined;
  let transportArgs: { parentArgs?: string[]; childArgs?: string[] } = {};
  let expectedRunId: string | undefined;
  if (ancestor) {
    const next = await supersede(s, feature, ancestor, chain, hooks);
    assert(next.successor, `后继未出生：${next.error}`);
    expectedRunId = next.successor;
    error = next.error;
  } else {
    const run = await (opts.entry ? requestVia.bind(null, opts.entry) : runGoalRuntimeChain)(s.root, {
      frameworkRoot: s.frameworkRoot, featureId: feature, adapter: 'codex',
      freshRequirement: freshRequest.requirement, freshStartPhase: chain[0], freshEndPhase: chain[chain.length - 1], ...hooks,
    });
    if ('parentArgs' in run && Array.isArray(run.parentArgs)) transportArgs.parentArgs = run.parentArgs;
    if ('childArgs' in run && Array.isArray(run.childArgs)) transportArgs.childArgs = run.childArgs;
    if (run.exitCode !== 0) error = `runner exit ${run.exitCode}`;
  }
  const born = runIds(s.root, feature).filter(id => !before.has(id));
  if (expectedRunId) assert.deepStrictEqual(born, [expectedRunId], `只应出生一个 run：${JSON.stringify(born)}`);
  else if (!opts.allowSuccessors) assert.strictEqual(born.length, 1, `fresh 请求只应出生一个 run：exit=${error ?? 0} ${JSON.stringify(born)}`);
  const current = born[born.length - 1];
  return { feature, runId: current, events: born.flatMap(id => eventsOf(s, feature, id)), requirement: freshRequest.requirement,
    request: { start: chain[0], end: chain[chain.length - 1] }, saved: saved!, baseRevision, chain, log: adapter.log,
    ...(transportArgs.parentArgs ? { parentArgs: transportArgs.parentArgs } : {}), ...(transportArgs.childArgs ? { childArgs: transportArgs.childArgs } : {}), ...(error ? { error } : {}) };
}

/** Only transport/model output is substituted; the original design transaction and next/report run unchanged. */
export async function designRepairCompletionTransport(mode: 'detached' | 'session', waiting = false): Promise<Ev> {
  let business: Ev | undefined;
  await withFreshCuHost(async s => {
    const result = () => waiting ? { status: 'waiting', exitCode: 0 }
      : mode === 'detached' ? { exitCode: 1, completion_observed: true, kill_attempted: true, duration_ms: 1000 }
      : { status: 'passed' };
    const b = await s16Born(s, { adapter: { author: result, questioning: result }, extra: {
      ...(waiting ? { onSpec: (ctx: { runId: string; attempt: number }): void => {
        assert.equal(ctx.attempt, 1, 'waiting设计调用不得无故重派业务作者');
        const p = project(s, SNAPSHOT_CU_FEATURE); p.runId = ctx.runId; writeCuSpecDraft(p);
      } } : {}),
      ...(mode === 'session' ? { viaSessionStep: true,
        hostAuthorization: { mode: 'goal_mode', autonomyAuthorized: true } } : {}),
    } });
    const starts = outOfChainStarts(b.events);
    const ends = b.events.filter(e => e.type === 'agent_invoke_end' && String(e.phase).startsWith('design-repair-'));
    const published = contentRepairs(b.events).find(e => e.stage === 'published');
    const bp = readDoc(blueprintFile(s));
    const transport = ends.map(e => ({ phase: e.phase, exit_code: e.exit_code, status: e.status,
      completion_observed: e.completion_observed, kill_attempted: e.kill_attempted, handoff_report: e.handoff_report }));
    assert(ends.length > 0, `${mode}: actual transport must reach its end: ${describeS16(b)}`);
    if (mode === 'session') {
      assert(ends.every(e => e.handoff_report), 'session facts must come from accepted next/report materials');
      assert(!b.events.some(e => e.type === 'agent_process_settled' && e.process_role !== 'harness'), 'no detached settlement may supply session completion');
      for (const end of ends) {
        const accepted = readJson<Ev>(path.resolve(s.root, reportDirOf(s, b.feature, b.runId), end.handoff_report.path));
        assert.equal(accepted.report.status, waiting ? 'waiting' : 'passed');
      }
    } else if (!waiting) {
      assert(ends.every(e => e.exit_code === 1 && e.completion_observed === true && e.kill_attempted === true), 'raw completed exit1 facts must survive runtime emission');
    }
    if (waiting) {
      assert.deepStrictEqual(starts.map(e => e.phase), ['design-repair-author'], `${mode}: waiting/exit0 must not enter independent questioning; ends=${JSON.stringify(transport)}`);
      assert(!published && bp.revision === b.baseRevision, `${mode}: waiting must not publish: ${describeS16(b)}`);
      const manifest = readJson<import('../../scripts/utils/goal-manifest').GoalManifest>(runFile(s.root, b.feature, b.runId, 'manifest.json'));
      const progress = projectGoalProgress({ projectRoot: s.root, manifest, events: b.events as Parameters<typeof projectGoalProgress>[0]['events'],
        workflow: resolveWorkflowSpec(s.root, { frameworkRoot: s.frameworkRoot }), featuresDir: relFeaturesDir(s.root) });
      business = { published: false, questioning: false, revisionChanged: false,
        status: progress.status, disposition: progress.run_disposition, waitKind: progress.run_wait_kind,
        next: progress.next_action, haltReason: haltOf(b.events)?.halt_reason,
        phaseAuthors: b.events.filter(e => e.type === 'agent_invoke_start' && e.phase === 'spec').length,
        turns: b.events.filter(event => event.type === 'agent_invoke_start').length };
      console.log(`[a7b615ff-design-parity] ${JSON.stringify({ mode, waiting, business, transport })}`);
      return;
    }
    assert.deepStrictEqual(starts.map(e => e.phase), ['design-repair-author', 'design-repair-questioning']);
    assert(published?.outcome === 'recovered' && published.admission_after_questioning === 'pass', `${mode}: original checks must approve publication: ${describeS16(b)}`);
    assert.equal(bp.revision, b.baseRevision + 1, 'formal runtime publication owns the single revision');
    assert(pointsAtCurrentBlueprint(s, CU), 'formal CU rebinding must use the new publication');
    assert.equal(bp.review_summary.admission.status, 'pass');
    assert.equal(bp.review_summary.questioning.provider_id, 'design-repair-questioning');
    assert.equal(endOf(b.events)?.status, 'CHAIN_SLICE_COMPLETED', `original request must automatically continue: ${describeS16(b)}`);
    assertCompletedBy(s, b.feature, b.runId, `${mode}: completed cleanup transport`);
    assert(!b.events.some(e => e.type === 'phase_halt'), 'transport cleanup cannot manufacture an owner halt');
    assertAttemptCleanedUp(s);
    business = { published: published.outcome, admission: bp.review_summary.admission.status,
      questioningProvider: bp.review_summary.questioning.provider_id, revisionDelta: bp.revision - b.baseRevision,
      rebound: pointsAtCurrentBlueprint(s, CU), finalStatus: endOf(b.events)?.status,
      verdicts: b.events.filter(e => e.type === 'phase_verdict').map(e => [e.phase, e.verdict, e.action]),
      turns: readExecutionActivity(loadAuthoritativeEvents(runFile(s.root, b.feature, b.runId, 'events.jsonl'))).calls };
    console.log(`[a7b615ff-design-parity] ${JSON.stringify({ mode, waiting, business, transport })}`);
  });
  return business!;
}
/** Child-only physical crash: canonical rename succeeds, no published event can be written. */
export async function __nonresidentDesignPublicationFaultWorker(metadataFile: string): Promise<void> {
  await (await import('./initial-design-repair.unit.test')).cutPhysicalDesignPublication(metadataFile);
}

const contentRepairs = (events: Ev[]): Ev[] => events.filter(e => e.type === 'design_authority_repair' && e.action === 'content_repair');
const outOfChainStarts = (events: Ev[]): Ev[] => events.filter(e => e.type === 'agent_invoke_start' && String(e.phase).startsWith('design-repair-'));
const describeS16 = (b: { events: Ev[]; error?: string }): string => JSON.stringify({
  error: b.error, repairs: contentRepairs(b.events), halt: haltOf(b.events), end: endOf(b.events), verdicts: verdictsOf(b.events),
  invokes: outOfChainStarts(b.events).map(e => e.invoke_id),
}).slice(0, 4000);
/** 停机前提共同断言：没有派发（没有 content_repair 事件、没有链外调用），停在设计 owner 出口。 */
function assertNotDispatched(b: { events: Ev[]; error?: string }, label: string): void {
  assert(!contentRepairs(b.events).length && !outOfChainStarts(b.events).length, `${label}：不得派发：${describeS16(b)}`);
  assert.strictEqual(haltOf(b.events)?.halt_reason, 'execution_scope_unresolved', `${label}：应停在设计 owner 出口：${describeS16(b)}`);
}
/** 锁与草稿收尾：尝试结束后不留蓝图锁、兄弟 CU 的 feature 锁与空目录。 */
function assertAttemptCleanedUp(s: Snapshot): void {
  assert(!fs.existsSync(path.join(featureFilePath(s.root, BLUEPRINT_ID, ''), BLUEPRINT_RECONCILE_LOCK_NAME)), '尝试结束后不得留下蓝图锁');
  for (const u of enumerateCanonicalChangeUnits(s.root, BLUEPRINT_ID)) {
    const id = String(u.changeUnit.change_unit_id);
    const dir = path.dirname(featureLockPath(s, id));
    assert(!fs.existsSync(featureLockPath(s, id)), `${id} 不得留下 feature 锁`);
    assert(!fs.existsSync(dir) || fs.readdirSync(dir).length > 0, `${id} 不得留下只为取锁而建的空 goal-runs 目录`);
  }
}

/** S16 主线（绑定仍有效）：同一 run 内修好并续跑完成，操作者动作 0。返回给 reliability-scenarios 用的流程摘要。 */
export async function s16MainFlow(s: Snapshot): Promise<RepairFlow> {
  const privateAuthorMarker = 'author-private-reasoning-not-an-independent-Q-input';
  let privateAuthorReturned = false;
  let businessProvenance: Ev | undefined;
  const b = await s16Born(s, { beforeBirth: async () => {
    businessProvenance = structuredClone(readDoc(blueprintFile(s)).provenance);
  }, adapter: { author: () => {
    privateAuthorReturned = true;
    return { stdout: privateAuthorMarker, details: privateAuthorMarker };
  } } });
  console.log(`[design-authority-repair] S16 ${describeS16(b)}`);
  const [attempted, published, ...rest] = contentRepairs(b.events);
  assert(attempted?.stage === 'attempted' && published?.stage === 'published' && published.outcome === 'recovered' && !rest.length, `事件应为 attempted → published：${describeS16(b)}`);
  assert.strictEqual(published.new_revision, b.baseRevision + 1, '新 revision 由运行时登记');
  // D1：草稿旧质询整份作废后机器派生的准入未过；独立质询重新生成后机器派生为 pass（canonical 原本就是 pass，历史保留）。
  assert(published.admission_after_invalidation === 'blocker' && published.admission_after_questioning === 'pass', describeS16(b));
  // D3：两次真实的、相互独立的调用——不同 invoke、不同用途标识；质询提示词不含编写方的修复简报；各自只改允许的字段（运行时已核，否则不会发布）。
  const starts = outOfChainStarts(b.events);
  assert.deepStrictEqual(starts.map(e => e.phase), ['design-repair-author', 'design-repair-questioning'], describeS16(b));
  assert(new Set(starts.map(e => e.invoke_id)).size === 2 && starts[0].purpose === 'author'
    && starts[1].purpose === 'questioning' && attempted.phase === 'spec', describeS16(b));
  const [authorPrompt] = b.log.prompts['design-repair-author'];
  const [questioningPrompt] = b.log.prompts['design-repair-questioning'];
  assert(/修复简报/.test(authorPrompt) && /authority_content_not_machine_structure/.test(authorPrompt) && /不(?:得)?写 ?`?review_summary.admission/.test(authorPrompt), '编写提示词须带简报与子契约');
  assert(privateAuthorReturned && !questioningPrompt.includes(privateAuthorMarker) && !questioningPrompt.includes('## 修复简报'),
    '独立Q不得继承本轮作者真实返回的私有思路或编写指令');
  assert(questioningPrompt.includes('原消费者的完整发现') && questioningPrompt.includes('authority_content_not_machine_structure')
    && questioningPrompt.includes('必答范围'), '独立Q须收到当前公共发现与全部必答范围，不能把公开原因码误当私有思路裁掉');
  // 整个尝试在两层锁内（编写调用进行中蓝图锁与全部 CU 的 feature 锁都在）；attempted 在调用前已落盘。
  assert(b.log.lockedDuringAuthor?.blueprint && Object.values(b.log.lockedDuringAuthor.features).every(Boolean) && b.log.lockedDuringAuthor.attemptedBeforeInvoke, JSON.stringify(b.log.lockedDuringAuthor));
  assertAttemptCleanedUp(s);
  // 业务provenance保留真实来源；机器修订审计由原事务/调用证据承载，不覆盖成框架名字。
  const bp = readDoc(blueprintFile(s));
  assert(bp.revision === b.baseRevision + 1, '本次真实发布只升原设计一个revision');
  assert.deepStrictEqual(bp.provenance, businessProvenance, '已批准P2/b84区分业务来源与机器观测，保留原真实业务依据');
  const requirementSource = path.relative(s.root, runFile(s.root, b.feature, b.runId, 'manifest.json')).replace(/\\/g, '/') + '#requirement';
  assert(attempted.preauthorization === requirementSource && starts.every(event => event.invoke_id),
    '修订须绑定原请求事务和真实作者/独核调用，不能靠根provenance自报发布');
  assert((bp.derived_results ?? []).every((r: Ev) => r.status === 'stale' && r.superseded_by_revision === bp.revision && r.input_revision !== bp.revision), `旧派生结论须标 stale、不得改输入版本：${JSON.stringify(bp.derived_results)}`);
  assert(bp.review_summary.admission.status === 'pass' && bp.review_summary.questioning.provider_id === 'design-repair-questioning' && bp.review_summary.questioning.provider_id !== bp.review_summary.authored_by, JSON.stringify(bp.review_summary.admission));
  assert(pointsAtCurrentBlueprint(s, CU), 'CU 指针已在同一锁内调和到新 revision');
  // 同一 run 续跑：spec 首轮 FAIL → 修复 → 原地重评 PASS；没有停机、没有新 run；任务由这个 run 正确完成。
  assert(!b.events.some(e => e.type === 'phase_halt'), `不得停机：${describeS16(b)}`);
  assert.strictEqual(b.events.filter(e => e.type === 'run_start').length, 1, '同一 run 内完成');
  assertCompletedBy(s, b.feature, b.runId, 'S16 主线');
  const report = fs.readFileSync(runFile(s.root, b.feature, b.runId, 'goal-report.md'), 'utf8');
  assert(/content_repair（蓝图 [^；]+；published rev \d+ recovered/.test(report), 'goal 报告应渲染无人值守修复');
  return { feature: b.feature, runs: [b.runId], haltClass: 'B1', interventions: [], evidence: `attempted→published rev ${published.new_revision}（recovered），同一 run 完成；verdicts=${JSON.stringify(verdictsOf(b.events))}` };
}

// ---- S16 反例六：两个真实 run 竞争同一蓝图的修复 ------------------------------------------------------
// 兄弟 CU（ledger-summary）的 run 跑在同一进程的另一个线程里：goal 运行时与测试缝都是模块级状态，线程之间互相隔离；
// 两层锁是同一套文件锁（持有者 pid 相同且存活 = 别人持有），所以这是两个真实 run 之间的真实竞争，不是手工占锁。

const SIBLING_FEATURE = deriveChangeUnitFeatureId(BLUEPRINT_ID, SIBLING);
const SIBLING_REQUIREMENT = '账本汇总卡片';
/** 用户经生产入口（goal-mode-entry --prepare-scope 同一函数）为兄弟 CU 准备运行范围。 */
function prepareSiblingScope(s: Snapshot): Array<'spec' | 'plan'> {
  clearFrameworkConfigCache();
  const prepared = prepareFeatureScopeCandidate({ projectRoot: s.root, frameworkRoot: s.frameworkRoot, feature: SIBLING_FEATURE, completionTarget: 'feature',
    requestedResults: [SIBLING_REQUIREMENT], requestedPhases: ['spec'], requirement: SIBLING_REQUIREMENT, overwrite: true });
  assert.deepStrictEqual(prepared.scope.phase_chain, ['spec', 'plan'], '前提：兄弟 CU 的出生链');
  freezeFeatureExecutionScope({ projectRoot: s.root, feature: SIBLING_FEATURE, scope: prepared.scope,
    candidateFingerprint: featureScopeCandidateFingerprint(s.root, SIBLING_FEATURE) });
  return prepared.scope.phase_chain as Array<'spec' | 'plan'>;
}

/** 兄弟 CU 首轮新建作者草稿，不读取或换戳主 CU 的阶段文件。 */
function writeSiblingSpecDraft(s: Snapshot, runId: string): void {
  writeCuSpecDraft({ ...project(s, SNAPSHOT_CU_FEATURE), feature: SIBLING_FEATURE, runId });
}

/**
 * 兄弟 CU 的 fresh run（需要出生期参数时用：后继的预算继承源 run、按交付周期累计，host bridge 上本 CU 的后继出生受快照里
 * 历史绝对路径的影响依据所限）：（预授权）→ 坏设计输入、调和 → 准备并冻结兄弟 CU 的运行范围 →
 * 公开入口 fresh 出生 → spec 的真实门报 B1。
 */
async function siblingFreshRun(s: Snapshot, extra: Record<string, unknown> = {}): Promise<{ b: S16Born; adapter: ReturnType<typeof repairAdapter>; exitCode: number }> {
  preauthorize(s);
  let saved: Ev | undefined;
  bumpBlueprint(s, bp => { const node = ledgerDomain(bp); saved = structuredClone(node); node.acceptance = TEXT_ACCEPTANCE; });
  const r = reconcileChangeUnitBlueprintRefs(s.root, BLUEPRINT_ID);
  assert(!r.skipped.length, JSON.stringify(r));
  const chain = prepareSiblingScope(s);
  commit(s, 'blueprint: acceptance written as prose by mistake');
  const baseRevision = Number(loadCanonicalBlueprint(s.root, BLUEPRINT_ID).blueprint.revision);
  const adapter = repairAdapter(s, () => saved);
  const probe = await runGoalRuntimeChain(s.root, {
    frameworkRoot: s.frameworkRoot, featureId: SIBLING_FEATURE, adapter: 'codex', freshRequirement: SIBLING_REQUIREMENT, freshStartPhase: chain[0], freshEndPhase: chain[chain.length - 1],
    realHarness: true, noAutoForce: true, onOutOfChain: adapter.onOutOfChain, onSpec: (ctx: { runId: string }) => writeSiblingSpecDraft(s, ctx.runId), ...extra,
  });
  const [runId] = runIds(s.root, SIBLING_FEATURE);
  assert(runId, `兄弟 run 未出生：exit=${probe.exitCode}`);
  return { b: { feature: SIBLING_FEATURE, runId, events: eventsOf(s, SIBLING_FEATURE, runId), baseRevision, saved: saved!, chain,
    requirement: SIBLING_REQUIREMENT, request: { start: chain[0], end: chain[chain.length - 1] } }, adapter, exitCode: probe.exitCode };
}

/** Supersede audit remains readable after dispatch windows and quota folds retire. */
function replayedHistory(s: Snapshot, b: S16Born): Record<'resume' | 'successor', { attempted: boolean }> {
  const signature = String(contentRepairs(b.events)[0]?.signature);
  const current = loadAuthoritativeEvents(runFile(s.root, b.feature, b.runId, 'events.jsonl'));
  const options = { projectRoot: s.root, featuresDir: relFeaturesDir(s.root), feature: b.feature };
  const resume = readSupersededAncestorRuns({ ...options, currentEvents: current });
  const successor = readSupersededAncestorRuns({ ...options, seedTargets: [b.runId] });
  return {
    resume: { attempted: designRepairAttempted([...resume.flatMap(run => run.events), ...current], signature) },
    successor: { attempted: designRepairAttempted(successor.flatMap(run => run.events), signature) },
  };
}

/** S16 授权反例：局部请求没有完整交付授权，不自动扩大到设计修订。 */
/** 未发布的失败保留原事务草稿与恢复原件；canonical、独核结论和锁收尾仍严格核对。 */
function assertNotPublished(s: Snapshot, b: S16Born, step: string, label: string, waiting = false): Ev {
  const repairs_ = contentRepairs(b.events);
  const failed = repairs_.find(e => e.stage === 'failed');
  assert(repairs_[0]?.stage === 'attempted' && (waiting ? haltOf(b.events)?.halt_reason === 'executor_waiting' : failed?.failed_step === step)
    && !repairs_.some(e => e.stage === 'published'), `${label}：应在 ${step} 保留未发布候选：${describeS16(b)}`);
  const bp = readDoc(blueprintFile(s));
  assert(bp.revision === b.baseRevision && bp.review_summary.questioning.provider_id !== 'design-repair-questioning', `${label}：canonical 不得变（不伪造质询报告）：rev=${bp.revision}`);
  const runDir = path.dirname(runFile(s.root, b.feature, b.runId, 'events.jsonl'));
  const draft = path.join(runDir, 'design-repair/component-blueprint.yaml');
  assert(fs.existsSync(draft) && typeof readDoc(draft) === 'object', `${label}：未发布草稿应保留可读`);
  const attempted = repairs_[0];
  assert(attempted.handoff_context, `${label}：原事务恢复引用不能缺失`);
  const original = readHandoffMaterial<{ baseline: string; brief: { class: string; items: unknown[] } }>(runDir, attempted.handoff_context);
  assert(typeof original.baseline === 'string' && original.baseline.length > 0 && original.brief?.class,
    `${label}：原始蓝图与实质发现须由原绑定引用可恢复`);
  const originalBlueprint = YAML.parse(Buffer.from(original.baseline, 'base64').toString('utf8')) as Ev;
  assert(originalBlueprint.revision === b.baseRevision && originalBlueprint.review_summary.questioning.provider_id !== 'design-repair-questioning',
    `${label}：恢复原件须保留本事务发布前的版本与独核历史`);
  assertAttemptCleanedUp(s);
  return failed!;
}

// ---- 真实心跳的测试缝（plan b0e0621c §3.2）---------------------------------------------------
// 心跳：运行时 __testing_setLockHeartbeatMs 只缩短真实心跳定时器的间隔（回调不变），由目标调用之前安装，
//       驱动层 finally 的 __testing_resetGoalRunnerSeams 复位（前缀真跑的复位清不到它：它装在前缀之后）。

/** 用例里起的空转子进程：结束后等它真正退出再离开用例，不漏到下一例（plan b0e0621c §3.1 状态核对表）。 */
const childExited = (child: import('child_process').ChildProcess): Promise<void> =>
  child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : new Promise(resolve => child.once('exit', () => resolve()));

const TEST_LOCK_HEARTBEAT_MS = 1_000;
/** goal-phase-runtime.ts 的 LOCK_HEARTBEAT_MS（生产缺省，未导出）。 */
const PRODUCTION_LOCK_HEARTBEAT_MS = 60_000;

const cases: Array<{ name: string; run: () => Promise<void> }> = [
  ...(['current', 'own-gap', 'sibling-gap'] as const).map(mode => ({
    name: `S14 current writer ${mode}: reconcile only eligible CUs with the original feature lock`,
    run: () => withFreshCuHost(async s => {
      bumpBlueprint(s, bp => { if (mode === 'own-gap') ledgerDomain(bp).knowledge_state = 'unknown'; });
      if (mode === 'sibling-gap') {
        const sibling = loadCanonicalChangeUnit(s.root, BLUEPRINT_ID, SIBLING);
        const changed = readDoc(sibling.canonicalPath); changed.touches[0].design_ref.revision += 40; writeDoc(sibling.canonicalPath, changed);
      }
      const ownBefore = loadCanonicalChangeUnit(s.root, BLUEPRINT_ID, CU).artifactSha256;
      const siblingBefore = loadCanonicalChangeUnit(s.root, BLUEPRINT_ID, SIBLING).artifactSha256;
      const lock = tryAcquireLock(featureLockPath(s, CU), { run_id: 'current-writer' }); assert(lock);
      try {
        const result = reconcileChangeUnitBlueprintRefs(s.root, BLUEPRINT_ID, { heldFeatureLocks: [{ path: featureLockPath(s, CU), ownerId: lock.ownerId }] });
        assert(!result.busy, JSON.stringify(result));
        if (mode === 'own-gap') {
          assert(result.skipped.some(row => row.change_unit_id === CU && row.reasons.some(reason => reason.includes('ledger-domain'))), JSON.stringify(result));
          assert.equal(loadCanonicalChangeUnit(s.root, BLUEPRINT_ID, CU).artifactSha256, ownBefore, 'unresolved current design cannot rewrite the CU');
        } else {
          assert(result.bumped.some(row => row.change_unit_id === CU) && pointsAtCurrentBlueprint(s, CU), JSON.stringify(result));
          if (mode === 'sibling-gap') {
            assert(result.skipped.some(row => row.change_unit_id === SIBLING && row.reasons.some(reason => reason.includes('blueprint_ref_identity_inconsistent'))), JSON.stringify(result));
            assert.equal(loadCanonicalChangeUnit(s.root, BLUEPRINT_ID, SIBLING).artifactSha256, siblingBefore);
          }
        }
        assert(fs.existsSync(featureLockPath(s, CU)), 'the writer must retain the borrowed lock');
      } finally { releaseLock(featureLockPath(s, CU), lock.ownerId); }
    }),
  })),
  ...(['shape', 'unresolved'] as const).map(mode => ({
    name: `S15 current design ${mode}: unchanged input stays blocked and actual owner correction restores readiness`,
    run: () => withFreshCuHost(async s => {
      materializeBlueprintSkillInputs(s.root, SNAPSHOT_CU_FEATURE, s.frameworkRoot);
      const saved = structuredClone(ledgerDomain(loadCanonicalBlueprint(s.root, BLUEPRINT_ID).blueprint));
      bumpBlueprint(s, bp => { const node = ledgerDomain(bp); if (mode === 'shape') node.acceptance = TEXT_ACCEPTANCE; else node.knowledge_state = 'unknown'; });
      const watched = [blueprintFile(s), loadCanonicalChangeUnit(s.root, BLUEPRINT_ID, CU).canonicalPath];
      const before = watched.map(sha);
      const probe = () => { clearFrameworkConfigCache(); const current = diagnoseBlueprintSkillAuthority(s.root, s.frameworkRoot, SNAPSHOT_CU_FEATURE);
        return { ready: !current.unevaluable && !current.findings.length, reason: current.unevaluable ?? current.findings.map(row => row.codes.join(',')).join(';') }; };
      const first = probe(), repeated = probe();
      assert(!first.ready && !repeated.ready, JSON.stringify({ first, repeated }));
      assert.deepEqual(watched.map(sha), before, 'probing unchanged design must be read-only');
      bumpBlueprint(s, bp => restoreNode(ledgerDomain(bp), saved));
      const ready = deriveDesignPreparationReadiness(s.root, BLUEPRINT_ID);
      assert(!ready.blueprintRefs.busy && ready.perUnit.find(row => row.changeUnitId === CU)?.verdict === 'constructable', JSON.stringify(ready));
      assert(probe().ready, JSON.stringify(probe()));
    }),
  })),


  {
    name: 'A3 探针：真 harness 写出的 run 冻结的输入绑定，在蓝图纯身份升版并经调和器原位升版 CU 指针之后仍全部可复读（不放宽绑定校验）',
    run: () => withHost(async s => {
      const feature = SNAPSHOT_CU_FEATURE;
      const { completed } = await handWrittenCompletion(s);
      const before = boundInputs(s, feature, completed);
      console.log(`[design-authority-repair] A3 before=${JSON.stringify(before)}`);
      // 设计类绑定（验收 / 施工契约）升版前有效；codebase 等源码观察类绑定随 run 自己写码而变，不属本断言。
      for (const id of ['acceptance', 'contracts']) assert(before.ids.includes(id) && !before.stale.some(x => x.startsWith(id + ':')), `前提：${id} 绑定在场且有效：${JSON.stringify(before)}`);
      bumpBlueprint(s);
      // 反向：只升蓝图、不调和——手写 contracts 的身份指针指向旧 CU / 旧蓝图，施工契约绑定读不回来（探针对失效敏感）。
      const unreconciled = boundInputs(s, feature, completed);
      console.log(`[design-authority-repair] A3 unreconciled=${JSON.stringify(unreconciled)}`);
      assert(unreconciled.stale.some(x => x.startsWith('contracts:')), `未调和时 contracts 绑定应读不回来：${JSON.stringify(unreconciled)}`);
      const r = reconcileChangeUnitBlueprintRefs(s.root, BLUEPRINT_ID);
      assert(r.bumped.some(b => b.change_unit_id === CU) && !r.skipped.length, JSON.stringify(r));
      const after = boundInputs(s, feature, completed);
      console.log(`[design-authority-repair] A3 after=${JSON.stringify(after)}`);
      assert.deepStrictEqual(after, before, '指针升版不得让任何冻结绑定由有效变 stale');
    }),
  },
  {
    name: 'A1 原因区分：指针过期 → 投影 invalid 带 reason=blueprint_ref_stale；plan 门的 CU 投影走 reconcile_blueprint、带 external 与同一 structured；内容坏 → reason=other；判别函数只在 BLOCKER 仅为指针过期时为真',
    run: () => withSnapshot(s => {
      const feature = SNAPSHOT_CU_FEATURE;
      handWriteProjections(s.root);
      const semanticDetails = (check: CheckResult | undefined) => {
        const { source_attempt_dependencies: _readInputs, ...semantic } = check!.structured as Ev;
        return semantic;
      };
      assert.strictEqual(pointerStaleCandidate(s.root, feature), false, '未升版时不是调和候选');
      bumpBlueprint(s);
      clearFrameworkConfigCache();
      const projected = deriveBlueprintSkillInput(s.root, feature, s.frameworkRoot, 'acceptance');
      assert(projected.state === 'invalid' && projected.reason === 'blueprint_ref_stale', JSON.stringify({ state: projected.state, reason: projected.reason, detail: projected.detail }));
      assert.strictEqual(pointerStaleCandidate(s.root, feature), true);
      const gate = checkAuthoritativeContentAligned(checkCtx(s, feature), 'acceptance').find(c => c.id === 'authoritative_content_aligned');
      assert(gate?.status === 'FAIL' && gate.repair_owner === 'external', JSON.stringify(gate));
      assert.deepStrictEqual(semanticDetails(gate), { kind: 'design_authority', reason: 'blueprint_ref_stale',
        codes: ['change_unit_blueprint_ref_stale', 'component_blueprint_identity_mismatch'] });
      // plan 阶段：手写 contracts 的 change_unit_ref 解析到 canonical CU，CU 的 BLOCKER 只有指针过期 → 路线取验证器 issue 的 route。
      const plan = checkChangeUnitFeatureProjection(checkCtx(s, feature), 'plan');
      const invalid = plan.find(c => c.id === 'change_unit_invalid');
      assert(invalid?.status === 'FAIL' && invalid.repair_owner === 'external' && /P1 调和/.test(invalid.suggestion ?? ''), JSON.stringify(plan.map(c => [c.id, c.status, c.repair_owner, c.details.slice(0, 160)])));
      assert.deepStrictEqual(semanticDetails(invalid), { kind: 'design_authority', reason: 'blueprint_ref_stale', codes: ['change_unit_blueprint_ref_stale'] });
      // 反例：调和后把蓝图内容写坏（验收写成文本）→ 仍是 invalid，但原因不是指针过期，也不是调和候选。
      const r = reconcileChangeUnitBlueprintRefs(s.root, BLUEPRINT_ID);
      assert(r.bumped.some(b => b.change_unit_id === CU), JSON.stringify(r));
      bumpBlueprint(s, bp => {
        const visit = (v: unknown): boolean => {
          if (Array.isArray(v)) return v.some(visit);
          if (!v || typeof v !== 'object') return false;
          if ((v as { node_id?: string }).node_id === 'ledger-domain') { (v as { acceptance?: unknown }).acceptance = '验收写成了一段文本'; return true; }
          return Object.values(v).some(visit);
        };
        assert(visit(bp), '快照蓝图缺 ledger-domain');
      });
      const again = reconcileChangeUnitBlueprintRefs(s.root, BLUEPRINT_ID);
      assert(again.bumped.some(b => b.change_unit_id === CU), JSON.stringify(again));
      clearFrameworkConfigCache();
      const broken = deriveBlueprintSkillInput(s.root, feature, s.frameworkRoot, 'acceptance');
      assert(broken.state === 'invalid' && broken.reason === 'other', JSON.stringify({ state: broken.state, reason: broken.reason, detail: broken.detail }));
      assert.strictEqual(pointerStaleCandidate(s.root, feature), false, '内容坏不是调和候选');
      const gate2 = checkAuthoritativeContentAligned(checkCtx(s, feature), 'acceptance').find(c => c.id === 'authoritative_content_aligned');
      // codex t6 第五轮：同一 structured 通道带出 B1 的位置（哪个目标的哪个字段）。
      assert.deepStrictEqual(semanticDetails(gate2), { kind: 'design_authority', reason: 'other', codes: ['authority_content_not_machine_structure'],
        locations: [{ blueprint_id: BLUEPRINT_ID, target: { kind: 'node', view_id: 'logical', id: 'ledger-domain' }, field: 'acceptance' }] });
      // 反例：指针过期同时三处指针身份不一致（契约变化）→ 验证器另有阻断项，不是调和候选（不会交给调和器）。
      bumpBlueprint(s);
      const own = loadCanonicalChangeUnit(s.root, BLUEPRINT_ID, CU);
      const doc = YAML.parse(own.bytes.toString('utf8'));
      doc.touches[0].design_ref.revision = Number(doc.touches[0].design_ref.revision) + 40;
      fs.writeFileSync(own.canonicalPath, YAML.stringify(doc));
      clearFrameworkConfigCache();
      assert.strictEqual(pointerStaleCandidate(s.root, feature), false, '指针身份不一致不是调和候选');
    }),
  },
  {
    name: 'A4 写入所有权（函数级，真实锁原语）：蓝图锁被占 / 待写 feature 的锁被另一执行者持有 → 调和竞争退出、一个字节不写、readiness 报忙；借出的锁可进行；不留锁文件与空目录',
    run: () => withSnapshot(s => {
      for (const name of ['acceptance.yaml', 'contracts.yaml', 'use-cases.yaml']) fs.rmSync(featureFilePath(s.root, SNAPSHOT_CU_FEATURE, name), { force: true });
      bumpBlueprint(s);
      const before = cuBytes(s);
      const workspace = featureFilePath(s.root, BLUEPRINT_ID, '');
      const listing = () => fs.readdirSync(workspace).sort();
      const dirs = listing();
      // ① 另一次调和正持有蓝图锁
      const blueprintLock = path.join(workspace, BLUEPRINT_RECONCILE_LOCK_NAME);
      const other = tryAcquireLock(blueprintLock, {})!;
      const busy1 = reconcileChangeUnitBlueprintRefs(s.root, BLUEPRINT_ID);
      assert(busy1.busy?.includes(RECONCILE_BUSY_HINT) && !busy1.bumped.length && !busy1.skipped.length, JSON.stringify(busy1));
      assert.deepStrictEqual(cuBytes(s), before, '蓝图锁被占时不得写');
      releaseLock(blueprintLock, other.ownerId);
      // ② 兄弟 feature 的锁被另一 run 持有
      const siblingLock = tryAcquireLock(featureLockPath(s, SIBLING), { run_id: 'another-run' })!;
      const busy2 = reconcileChangeUnitBlueprintRefs(s.root, BLUEPRINT_ID);
      assert(busy2.busy?.includes(SIBLING) && !busy2.bumped.length, JSON.stringify(busy2));
      assert.deepStrictEqual(cuBytes(s), before, '兄弟 feature 持锁时不得写（含本 CU）');
      const readiness = deriveDesignPreparationReadiness(s.root, BLUEPRINT_ID);
      assert(readiness.ready === false && readiness.blueprintRefs.busy && readiness.perUnit.length === 0, JSON.stringify(readiness));
      // ③ 同一把锁由调用方借出（owner 复用）→ 可进行；借出的锁不被调和器释放
      const lent = reconcileChangeUnitBlueprintRefs(s.root, BLUEPRINT_ID, { heldFeatureLocks: [{ path: featureLockPath(s, SIBLING), ownerId: siblingLock.ownerId }] });
      assert(!lent.busy && lent.bumped.length === Object.keys(before).length && !lent.skipped.length, JSON.stringify(lent));
      assert(fs.existsSync(featureLockPath(s, SIBLING)), '借出的锁不得被调和器释放');
      // 反向：ownerId 不符的"借出"不算持有
      bumpBlueprint(s);
      const wrong = reconcileChangeUnitBlueprintRefs(s.root, BLUEPRINT_ID, { heldFeatureLocks: [{ path: featureLockPath(s, SIBLING), ownerId: 'not-the-owner' }] });
      assert(wrong.busy, JSON.stringify(wrong));
      releaseLock(featureLockPath(s, SIBLING), siblingLock.ownerId);
      fs.rmSync(path.dirname(featureLockPath(s, SIBLING)), { recursive: true, force: true });
      const done = reconcileChangeUnitBlueprintRefs(s.root, BLUEPRINT_ID);
      assert(!done.busy && done.bumped.length === Object.keys(before).length, JSON.stringify(done));
      assert.deepStrictEqual(listing(), dirs, '调和后工作区不得多出锁文件');
      for (const id of Object.keys(before).filter(id => id !== CU)) assert(!fs.existsSync(path.dirname(featureLockPath(s, id))), `${id} 不得留下空 goal-runs 目录`);
    }),
  },
  {
    name: 'A4 两次读取之间蓝图升版（codex 批一 P1）：取锁时本 CU 指针未过期、plan 正持其 feature 锁；取锁之后蓝图升版 → 调和器重定写集时发现本 CU 不在已持锁范围 → 竞争退出，CU 与 plan 写出的 contracts 一个字节不动',
    run: () => withSnapshot(s => {
      const feature = SNAPSHOT_CU_FEATURE;
      handWriteProjections(s.root);
      // 兄弟 CU 的 owner 指针不等于当前蓝图身份 → 第一次读取时只有它进取锁范围；本 CU 指针此刻是当前身份。
      const sibling = loadCanonicalChangeUnit(s.root, BLUEPRINT_ID, SIBLING);
      const doc = YAML.parse(sibling.bytes.toString('utf8'));
      doc.component_blueprint_ref.revision = Number(doc.component_blueprint_ref.revision) + 40;
      fs.writeFileSync(sibling.canonicalPath, YAML.stringify(doc));
      const planLock = tryAcquireLock(featureLockPath(s, CU), { run_id: 'plan-in-flight' })!;
      const contractsFile = featureFilePath(s.root, feature, 'contracts.yaml');
      const before = cuBytes(s);
      // 交错点：调和器为兄弟 feature 落锁文件的那一刻（第一次读取之后、重定写集之前），另一设计会话把蓝图升版，
      // 同时 plan 写出新版 contracts。只拦这一次文件创建，不改任何生产行为。
      const siblingLock = path.resolve(featureLockPath(s, SIBLING));
      // import * 的命名空间对象只读；补丁打在真实 fs 模块上（生产代码经 live binding 读到）。
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const realFs = require('fs') as { openSync: unknown };
      const openSync = fs.openSync;
      let interleaved = false;
      let planBytes: Buffer | undefined;
      realFs.openSync = (file: fs.PathLike, ...rest: unknown[]) => {
        if (!interleaved && path.resolve(String(file)) === siblingLock) {
          interleaved = true;
          bumpBlueprint(s);
          const contracts = YAML.parse(fs.readFileSync(contractsFile, 'utf8'));
          contracts.files.push('src/ledger/PlanAddedDuringReconcile.ets');
          fs.writeFileSync(contractsFile, YAML.stringify(contracts));
          planBytes = fs.readFileSync(contractsFile);
        }
        return (openSync as (...args: unknown[]) => number)(file, ...rest);
      };
      let result: ReturnType<typeof reconcileChangeUnitBlueprintRefs>;
      try { result = reconcileChangeUnitBlueprintRefs(s.root, BLUEPRINT_ID); } finally { realFs.openSync = openSync; }
      assert(interleaved && planBytes, '前提：交错已发生');
      assert(result.busy?.includes(RECONCILE_BUSY_HINT) && result.busy.includes(CU) && !result.bumped.length, JSON.stringify(result));
      assert.deepStrictEqual(cuBytes(s), before, '未持锁的 CU 不得被写');
      assert(fs.readFileSync(contractsFile).equals(planBytes!), 'plan 的新写入不得被覆盖');
      assert(fs.existsSync(featureLockPath(s, CU)), 'plan 的锁仍在');
      assert(!fs.existsSync(siblingLock), '调和器自己取的锁已释放');
      // plan 结束放锁后重试：照常升版，plan 的新增内容保留（调和器只动身份行）。
      releaseLock(featureLockPath(s, CU), planLock.ownerId);
      const retry = reconcileChangeUnitBlueprintRefs(s.root, BLUEPRINT_ID);
      assert(!retry.busy && retry.bumped.some(b => b.change_unit_id === CU), JSON.stringify(retry));
      assert(YAML.parse(fs.readFileSync(contractsFile, 'utf8')).files.includes('src/ledger/PlanAddedDuringReconcile.ets'), '重试后 plan 的新增内容仍在');
    }),
  },
  {
    name: 'B4-table 分类表：机器内容文字归 B1；需要裁决、缺事实、扩大范围与混合原因码归 B2；空集、未登记及已退役映射码一律 B2',
    run: async () => {
      assert.strictEqual(classifyDesignAuthorityCodes(['authority_content_not_machine_structure']).class, 'B1');
      for (const code of ['a_code_added_later', 'authority_cu_mapping_stale', 'authority_cu_mapping_conflict']) {
        const unlisted = classifyDesignAuthorityCodes([code]);
        assert(unlisted.class === 'B2' && /未登记/.test(unlisted.needs.join()), `未列入的原因码默认 B2：${JSON.stringify(unlisted)}`);
      }
      assert.strictEqual(classifyDesignAuthorityCodes([]).class, 'B2', '没有原因码不得当成 B1');
      for (const code of [
        'change_unit_current_design_unresolved', 'change_unit_contract_not_admitted', 'cu_architecture_impact_not_effective', 'cu_scope_matches_blueprint',
        'change_unit_schema_invalid', 'change_unit_design_ref_unresolvable', 'change_unit_blueprint_unresolvable', 'authority_contract_files_missing',
        'authority_content_conflict', 'authority_target_provenance_missing', 'change_unit_blueprint_ref_stale', 'component_blueprint_invalid', 'change_unit_missing',
        'authority_content_missing', 'authority_projection_shape_invalid',
      ]) {
        const verdict = classifyDesignAuthorityCodes([code]);
        assert(verdict.class === 'B2' && verdict.needs.length === 1 && !/未登记/.test(verdict.needs[0]), `${code} 应登记为 B2 并写清缺什么：${JSON.stringify(verdict)}`);
      }
      const mixed = classifyDesignAuthorityCodes(['authority_content_not_machine_structure', 'change_unit_current_design_unresolved']);
      assert(mixed.class === 'B2' && mixed.needs.length === 2, `B1 与 B2 混合按 B2：${JSON.stringify(mixed)}`);
    },
  },
  {
    name: 'B4-codes 原因码由真实投影生产者给出：整段内容写成文字 → B1；内容为 null / 数字或缺路径且无替代 → 不得判 B1',
    run: () => withSnapshot(s => {
      const feature = SNAPSHOT_CU_FEATURE;
      // Pure design has no stage outputs to refresh; stamped-file supplementation has its own tests.
      for (const name of ['acceptance.yaml', 'contracts.yaml', 'use-cases.yaml']) fs.rmSync(featureFilePath(s.root, feature, name), { force: true });
      let base: Ev | undefined;
      /** 设计 owner 升一个 revision 并改 ledger-domain（其余保持原样），调和指针后取真实投影的原因码与分类。 */
      const project_ = (kind: 'acceptance' | 'contracts', mutate: (node: Ev) => void): { codes: string[]; cls: string; detail: string; locations: unknown } => {
        bumpBlueprint(s, bp => { const node = ledgerDomain(bp); base ??= structuredClone(node); restoreNode(node, base); mutate(node); });
        const r = reconcileChangeUnitBlueprintRefs(s.root, BLUEPRINT_ID);
        assert(r.bumped.some(b => b.change_unit_id === CU) && !r.skipped.some(x => x.change_unit_id === CU), JSON.stringify(r));
        clearFrameworkConfigCache();
        const projected = deriveBlueprintSkillInput(s.root, feature, s.frameworkRoot, kind);
        assert.strictEqual(projected.state, 'invalid', `前提：投影无效：${JSON.stringify({ state: projected.state, detail: projected.detail })}`);
        return { codes: projected.codes ?? [], cls: classifyDesignAuthorityCodes(projected.codes ?? []).class, detail: String(projected.detail), locations: projected.locations };
      };
      // 正例：完整内容写成了一段文字 → 有原文可依。
      const prose = project_('acceptance', node => { node.acceptance = TEXT_ACCEPTANCE; });
      assert(prose.cls === 'B1' && prose.codes.join() === 'authority_content_not_machine_structure', JSON.stringify(prose));
      // codex t6 第五轮：B1 发现项带位置（哪个 design_ref 目标的哪个字段），无人值守修复只许改这里。
      const ledgerTarget = (cu: Ev): Ev => (cu.design_refs as Ev[]).find(ref => ref.target.id === 'ledger-domain')!.target;
      const target = ledgerTarget(loadCanonicalChangeUnit(s.root, BLUEPRINT_ID, CU).changeUnit as Ev);
      assert.deepStrictEqual(prose.locations, [{ blueprint_id: BLUEPRINT_ID, target, field: 'acceptance' }], `文字位置：${JSON.stringify(prose.locations)}`);
      // 反例：内容是 null / 数字 / 空串——没有可恢复的内容。
      for (const empty of [null, 3, '  ']) {
        const missing = project_('acceptance', node => { node.acceptance = empty; });
        assert(missing.cls === 'B2' && missing.codes.join() === 'authority_content_missing', `${JSON.stringify(empty)} 不得判 B1：${JSON.stringify(missing)}`);
      }
      // 反例：施工契约缺必填路径（modules[].package_path），没有确定的替代值。
      const noPath = project_('contracts', node => { delete node.contracts.modules[0].package_path; });
      assert(noPath.cls === 'B2' && noPath.codes.length > 0, `缺路径且无替代不得判 B1：${JSON.stringify(noPath)}`);
      console.log(`[design-authority-repair] B4-codes 缺路径=${JSON.stringify(noPath)}`);
    }),
  },
  {
    name: 'R3 legacy 蓝图映射不再触发 B1（真实快照 + 真实调和）：旧 revision 或其它 CU 的映射不进入设计投影，也不删改 canonical 旧材料',
    run: () => withSnapshot(s => {
      const feature = SNAPSHOT_CU_FEATURE;
      for (const name of ['acceptance.yaml', 'contracts.yaml', 'use-cases.yaml']) fs.rmSync(featureFilePath(s.root, feature, name), { force: true });
      const currentCuRef = (): Ev => {
        const loaded = loadCanonicalChangeUnit(s.root, BLUEPRINT_ID, CU);
        const cu = loaded.changeUnit as Ev;
        return { artifact: cu.artifact, component_id: cu.component_id, blueprint_id: cu.blueprint_id, change_unit_id: cu.change_unit_id, revision: cu.revision, artifact_sha256: loaded.artifactSha256 };
      };
      const oldRef = currentCuRef();
      for (const ref of [oldRef, { ...oldRef, change_unit_id: SIBLING }]) {
        bumpBlueprint(s, bp => { ledgerDomain(bp).contracts.change_unit.change_unit_ref = ref; });
        const r = reconcileChangeUnitBlueprintRefs(s.root, BLUEPRINT_ID);
        assert(r.bumped.some(b => b.change_unit_id === CU) && !r.skipped.some(x => x.change_unit_id === CU), JSON.stringify(r));
        clearFrameworkConfigCache();
        const before = fs.readFileSync(blueprintFile(s));
        const projected = deriveBlueprintSkillInput(s.root, feature, s.frameworkRoot, 'contracts');
        assert.strictEqual(projected.state, 'resolved', projected.detail);
        assert.strictEqual((projected.value as Ev).change_unit, undefined, '专属映射不再来自蓝图');
        assert(!projected.codes?.some(code => code.startsWith('authority_cu_mapping')), JSON.stringify(projected.codes));
        assert(!projected.locations?.length, '合法设计不产生蓝图映射修复位置');
        assert(fs.readFileSync(blueprintFile(s)).equals(before), '设计投影不得删改 canonical 旧映射');
        assert.deepStrictEqual(ledgerDomain(loadCanonicalBlueprint(s.root, BLUEPRINT_ID).blueprint).contracts.change_unit.change_unit_ref, ref);
      }
    }),
  },
  {
    name: 'B1-mixed 机器内容形状与真实DSL冲突：两条原因都解除才就绪，续跑或后继仍由既有绑定判断',
    run: () => withFreshCuHost(async s => {
      const feature = SNAPSHOT_CU_FEATURE;
      materializeBlueprintSkillInputs(s.root, feature, s.frameworkRoot);
      const saved = structuredClone(ledgerDomain(loadCanonicalBlueprint(s.root, BLUEPRINT_ID).blueprint));
      const configBytes = fs.readFileSync(path.join(s.root, 'framework.config.json'));
      bumpBlueprint(s, bp => {
        ledgerDomain(bp).acceptance = TEXT_ACCEPTANCE;
        (bp.decisions_and_gaps as Ev).decisions.push({ decision_id: 'mixed-remove-edge', kind: 'architecture_impact', change: 'dependency_edge',
          from: 'ledger', to: 'FinancialCard', direction: 'remove', status: 'decided_with_authority', owner: 'design-owner',
          rationale: '领域不依赖页面', verification_refs: ['view:development'], provenance: structuredClone(bp.provenance) });
      });
      reconcileChangeUnitBlueprintRefs(s.root, BLUEPRINT_ID);
      const probe = () => { clearFrameworkConfigCache(); const current = diagnoseBlueprintSkillAuthority(s.root, s.frameworkRoot, feature);
        return { ready: !current.unevaluable && !current.findings.length, reason: current.unevaluable ?? current.findings.map(row => row.codes.join(',')).join(';') }; };
      const both = probe();
      assert(!both.ready && /authority_content_not_machine_structure/.test(String(both.reason)) && /cu_architecture_impact_not_effective/.test(String(both.reason)), JSON.stringify(both));
      bumpBlueprint(s, bp => restoreNode(ledgerDomain(bp), saved));
      reconcileChangeUnitBlueprintRefs(s.root, BLUEPRINT_ID);
      const one = probe();
      assert(!one.ready && /cu_architecture_impact_not_effective/.test(String(one.reason)) && !/authority_content_not_machine_structure/.test(String(one.reason)), JSON.stringify(one));
      bumpBlueprint(s, bp => { const decisions = bp.decisions_and_gaps as Ev; decisions.decisions = decisions.decisions.filter((row: Ev) => row.decision_id !== 'mixed-remove-edge'); });
      const ready = deriveDesignPreparationReadiness(s.root, BLUEPRINT_ID);
      assert(ready.perUnit.find(row => row.changeUnitId === CU)?.verdict === 'constructable', JSON.stringify(ready));
      assert(probe().ready, JSON.stringify(probe()));
      assert.deepEqual(fs.readFileSync(path.join(s.root, 'framework.config.json')), configBytes, 'the test must correct its original decision rather than change the DSL');
    }),
  },
  // S16 main integration stays in reliability-scenarios; current S14/S15 boundaries are short cases above.
  {
    name: 'S16-c1804p physical exit after publication before event resumes original transaction without a second revision',
    run: async () => {
      const { spawn } = require('child_process') as typeof import('child_process');
      const metadataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'design-publication-cut-'));
      const metadataFile = path.join(metadataDir, 'cut.json');
      const reportDir = path.resolve(__dirname, '../../reports/1804ac3b');
      fs.mkdirSync(reportDir, { recursive: true });
      let restored: Snapshot | undefined;
      try {
        const child = spawn(process.execPath, [require.resolve('ts-node/dist/bin.js'), '--project', path.resolve(__dirname, '../../tsconfig.json'), path.resolve(__dirname, '../utils/design-publication-fault-worker.ts'), metadataFile],
          { cwd: path.resolve(__dirname, '../..'), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
        let output = ''; child.stdout?.on('data', chunk => { output = (output + chunk).slice(-8000); }); child.stderr?.on('data', chunk => { output = (output + chunk).slice(-8000); });
        const timer = setTimeout(() => child.kill('SIGKILL'), 120000);
        const code = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
        clearTimeout(timer);
        assert.strictEqual(code, 77, `must cut the actual process at canonical rename: ${output}`);
        const metadata = readJson<Snapshot & { feature: string; runId: string; cutRevision: number }>(metadataFile); restored = metadata;
        const feature = metadata.feature;
        const runId = metadata.runId;
        const before = eventsOf(metadata, feature, runId);
        assert(contentRepairs(before).some(event => event.stage === 'attempted') && !contentRepairs(before).some(event => event.stage === 'published'), 'publication event must actually be absent at the physical crash');
        const starts = outOfChainStarts(before);
        assert(starts.length > 0 && starts.every(start => before.some(event => event.type === 'agent_invoke_end' && event.invoke_id === start.invoke_id)),
          'the physical cut must retain every actually completed role and its original report');
        const publishedQuestioning = readDoc(blueprintFile(metadata)).review_summary.questioning;
        assert(publishedQuestioning.status === 'complete' && publishedQuestioning.items.length > 0, 'the published design retains complete public Q evidence');
        await (await import('./initial-design-repair.unit.test')).resumePhysicalDesignPublication(metadata, runId);
        const all = eventsOf(metadata, feature, runId);
        assert.strictEqual(Number(loadCanonicalBlueprint(metadata.root, BLUEPRINT_ID).blueprint.revision), metadata.cutRevision, 'publication recovery must not bump canonical twice');
        assert.deepEqual(outOfChainStarts(all), starts, 'publication recovery must consume its original reports without another design invocation');
        assert.deepEqual(readDoc(blueprintFile(metadata)).review_summary.questioning, publishedQuestioning, 'recovery preserves the actual independently accepted Q');
        assert.strictEqual(contentRepairs(all).filter(event => event.stage === 'attempted').length, 1);
        assert.strictEqual(contentRepairs(all).filter(event => event.stage === 'published').length, 1);
        assert(contentRepairs(all).some(event => event.stage === 'published' && event.outcome === 'recovered'), describeS16({ events: all }));
        fs.writeFileSync(path.join(reportDir, 'design-publication-fault.json'), JSON.stringify({ physical_exit: code,
          cut_revision: metadata.cutRevision, final_revision: Number(loadCanonicalBlueprint(metadata.root, BLUEPRINT_ID).blueprint.revision),
          design_invokes: outOfChainStarts(all).length, design_roles: starts.map(event => event.phase), attempted: 1, published: 1,
          boundary: 'deterministic author/Q outputs; real physical exit, original reports, filesystem publication, CU reconciliation and transaction finalizer; construction continuation is covered by the main flows' }, null, 2) + '\n');
      } catch (error) {
        const diagnostic = restored ? { root: restored.root, runs: runIds(restored.root, SNAPSHOT_CU_FEATURE).map(id => ({ run_id: id, events: eventsOf(restored!, SNAPSHOT_CU_FEATURE, id) })) } : {};
        fs.writeFileSync(path.join(reportDir, 'design-publication-fault-diagnostic.json'), JSON.stringify({ error: String((error as Error).stack ?? error), ...diagnostic }, null, 2) + '\n');
        throw error;
      } finally {
        clearFrameworkConfigCache();
        if (restored) fs.rmSync(restored.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
        fs.rmSync(metadataDir, { recursive: true, force: true });
      }
    },
  },
  ...(['host bridge', 'next/report'] as const).map(transport => ({
    name: `S16-c1c 有人在场（会话 owner，${transport}）+ 预授权 + B1 → 不派发，交会话里的设计 owner`,
    run: () => withFreshCuHost(async s => {
      // 用兄弟 CU 的 fresh run：会话 owner 经 host bridge 出生（本 CU 的后继出生在 host bridge 上受快照里历史绝对路径的影响依据所限）。
      const { b } = await siblingFreshRun(s, transport === 'host bridge' ? { viaHostBridge: true }
        : { viaSessionStep: true, sessionSelfCheck: true });
      console.log(`[design-authority-repair] S16-c1c ${describeS16(b)}`);
      assert(!contentRepairs(b.events).length && !outOfChainStarts(b.events).length, `有人在场不得派发：${describeS16(b)}`);
      const halt = haltOf(b.events);
      assert(halt?.halt_reason === 'execution_scope_unresolved' && halt.design_authority?.class === 'B1', `应停在设计 owner 出口：${describeS16(b)}`);
    }),
  })),

  {
    name: 'S16-c5bdd 原需求内架构和CU内容借锁修订、正式发布并自动接续施工',
    run: () => withFreshCuHost(async s => {
      const b = await s16Born(s, { preauth: false, allowSuccessors: true,
        adapter: { author: (doc, draft) => {
          const architectureFile = path.join(path.dirname(draft), 'architecture.json');
          const architecture = readJson<Ev>(architectureFile);
          const layer = architecture.outer_layers.find((row: Ev) => row.id === '02-Feature');
          layer.intra_layer_deps = 'sublayer';
          layer.sublayers = [
            { id: 'ledger-domain', members_pattern_or_list: ['ledger'], can_depend_on_sublayers: [] },
            { id: 'card-view', members_pattern_or_list: ['FinancialCard'], can_depend_on_sublayers: ['ledger-domain'] },
          ];
          fs.writeFileSync(architectureFile, JSON.stringify(architecture));
          const decision = { decision_id: 'ledger-dependency', kind: 'architecture_impact', change: 'dependency_edge', from: 'ledger', to: 'FinancialCard', direction: 'remove',
            status: 'decided_with_authority', rationale: '原账务需求中领域不依赖页面，实现既有领域职责', owner: 'design-owner', verification_refs: ['view:development'], provenance: structuredClone(doc.provenance) };
          doc.decisions_and_gaps.decisions.push(decision);
          doc.decisions_and_gaps.decisions.push({ ...decision, decision_id: 'ledger-responsibility', change: 'responsibility_rewrite',
            module: 'ledger', rationale: '账务领域只维护稳定账目投影，展示和导航职责仍归页面模块' });
          ledgerDomain(doc).target_state = 'Stable ledger domain projection; presentation and navigation remain in FinancialCard';
          (ledgerDomain(doc).design_basis_refs ??= []).push('decision:ledger-dependency', 'decision:ledger-responsibility');
        } },
      });
      assert(contentRepairs(b.events).some(event => event.stage === 'published' && event.outcome === 'recovered' && event.architecture_changed === true), describeS16(b));
      const cu = loadCanonicalChangeUnit(s.root, BLUEPRINT_ID, CU).changeUnit;
      assert((cu.design_refs as Ev[]).some(ref => ref.target.id === 'ledger-dependency'), 'content revision must run through the real CU consumer while borrowing feature locks');
      assert((cu.design_refs as Ev[]).some(ref => ref.target.id === 'ledger-responsibility'), 'module responsibility revision must use the same closure and content consumer');
      const config = readJson<Ev>(path.join(s.root, 'framework.config.json'));
      assert.equal(config.architecture.outer_layers.find((row: Ev) => row.id === '02-Feature').intra_layer_deps, 'sublayer');
      const publishedAt = b.events.findIndex(event => event.type === 'design_authority_repair' && event.stage === 'published');
      assert(b.events.slice(publishedAt + 1).some(event => event.type === 'agent_invoke_start' && event.phase === 'work-unit-author'),
        '发布后由当前工作单元作者继续施工');
      assertCompletedBy(s, b.feature, b.runId, '架构/CU修订后自动继续');
      assertAttemptCleanedUp(s);
    }),
  },
  {
    name: 'S16-c2 草稿外改动：编写调用改了需求、契约与个人配置 → 不发布，走既有违规处置（phase_write_violation + 违规停机出口，不降为设计等待），事件披露路径与前后哈希；被改文件不还原',
    run: () => withFreshCuHost(async s => {
      const touched = ['requirements/ledger.md', 'contracts/ledger-api.yaml', 'framework.local.json', 'context/ledger-api.yaml'];
      const b = await s16Born(s, {
        ancestor: true,
        // 工作区外、位于通常排除目录（context/）里的实际引用输入：蓝图的契约来源指向它（内容与原契约文件相同，校验照常通过）。
        beforeCorrupt: () => {
          fs.mkdirSync(path.join(s.root, 'context'), { recursive: true });
          fs.copyFileSync(path.join(s.root, 'contracts', 'ledger-api.yaml'), path.join(s.root, 'context', 'ledger-api.yaml'));
          const text = fs.readFileSync(blueprintFile(s), 'utf8').split('source_ref: contracts/ledger-api.yaml#').join('source_ref: context/ledger-api.yaml#');
          fs.writeFileSync(blueprintFile(s), text);
          const blockers = blockerIssues(validateComponentBlueprint(YAML.parse(text), { projectRoot: s.root }));
          assert(!blockers.length, `前提：改指 context/ 下的契约来源后蓝图仍合法：${blockers.map(i => i.id).join(',')}`);
        },
        adapter: { author: (_doc, draft) => {
        for (const rel of touched.slice(0, 2)) fs.appendFileSync(path.join(s.root, rel), '\n# 修复调用顺手改的\n');
        // 只改注释：契约语义校验仍会通过，必须靠核对范围检出。
        fs.appendFileSync(path.join(s.root, 'context', 'ledger-api.yaml'), '\n# 修复调用顺手改的注释\n');
        const local = readJson<Record<string, unknown>>(LOCAL_FILE(s));
        (local.vision as Ev).canary.probed_at = '2026-10-01T00:00:00.000Z';
        fs.writeFileSync(LOCAL_FILE(s), JSON.stringify(local, null, 2));
        // 本任务在 goal-runs 下的实际输入：本 run 的 manifest、祖先 run 的事件（判重与预算回放读它们）。
        const runDir = path.dirname(path.dirname(draft));
        const ancestor = fs.readdirSync(path.dirname(runDir)).map(id => path.join(path.dirname(runDir), id))
          .find(dir => dir !== runDir && fs.existsSync(path.join(dir, 'events.jsonl')))!;
        for (const file of [path.join(runDir, 'manifest.json'), path.join(ancestor, 'events.jsonl')]) {
          fs.appendFileSync(file, '\n');
          touched.push(path.relative(s.root, file).replace(/\\/g, '/'));
        }
        // 本 run 的事件只许运行时追加自己的事件：调用追加一条伪造的阶段结论也算越界。
        const ownEvents = path.join(runDir, 'events.jsonl');
        fs.appendFileSync(ownEvents, `${JSON.stringify({ ts: new Date().toISOString(), type: 'phase_verdict', phase: 'spec', verdict: 'PASS' })}\n`);
        touched.push(path.relative(s.root, ownEvents).replace(/\\/g, '/'));
      } } });
      console.log(`[design-authority-repair] S16-c2 ${describeS16(b)}`);
      const failed = assertNotPublished(s, b, 'author', '越界写入');
      assert.deepStrictEqual((failed.files as Ev[]).map(f => f.path).sort(), [...touched].sort(), `事件须披露被改路径：${JSON.stringify(failed.files)}`);
      assert((failed.files as Ev[]).every(f => /^[0-9a-f]{64}$/.test(f.pre_sha256) && /^[0-9a-f]{64}$/.test(f.post_sha256) && f.pre_sha256 !== f.post_sha256), '事件须带前后哈希');
      const halt = haltOf(b.events);
      assert(halt?.halt_reason === 'unauthorized_source_mutation' && !halt.probe && /草稿之外/.test(String(halt.halt_guidance)), `应走现行违规停机出口、不挂探针：${JSON.stringify(halt)}`);
      assert(endOf(b.events)?.status !== 'CHAIN_SLICE_COMPLETED', '不得完成');
      // "不发布"与"未发生越界改写"是两个断言：canonical 没变，但被改的文件仍是改后的样子（只检测、不还原）。
      assert(/修复调用顺手改的/.test(fs.readFileSync(path.join(s.root, touched[0]), 'utf8')) && readJson<Ev>(LOCAL_FILE(s)).vision.canary.probed_at === '2026-10-01T00:00:00.000Z', '框架不替操作者还原');
    }),
  },
  {
    name: 'S16-c2b 必需快照不可验证：编写调用之后草稿外某个文件读不出来 → 不当作干净继续，不发布，同样走违规停机出口',
    run: () => withFreshCuHost(async s => {
      const target = path.resolve(s.root, 'requirements', 'ledger.md');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const realFs = require('fs') as { readFileSync: unknown };
      const readFileSync = fs.readFileSync;
      const b = await s16Born(s, { adapter: { author: () => {
        // 只让调用之后的第一次读取失败（权限 / 占用的替身），随即恢复——不改任何生产行为。
        realFs.readFileSync = (file: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
          if (typeof file === 'string' && path.resolve(file) === target) {
            realFs.readFileSync = readFileSync;
            throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });
          }
          return (readFileSync as (...a: unknown[]) => unknown)(file, ...rest);
        };
      } } }).finally(() => { realFs.readFileSync = readFileSync; });
      console.log(`[design-authority-repair] S16-c2b ${describeS16(b)}`);
      const failed = assertNotPublished(s, b, 'author', '快照不可验证');
      assert(/不可核实/.test(String(failed.reason)) && !failed.files, JSON.stringify(failed));
      const halt = haltOf(b.events);
      assert(halt?.halt_reason === 'unauthorized_source_mutation' && /不可核实/.test(String(halt.halt_guidance)), `不可验证也不得降为设计等待：${JSON.stringify(halt)}`);
    }),
  },
  {
    name: 'S16-c3a current questioning provider failure preserves the candidate without publishing or forging a result',
    run: () => withFreshCuHost(async s => {
      const b = await s16Born(s, { adapter: { questioning: doc => { delete doc.review_summary.questioning; return { status: 'failed', details: 'questioning provider unavailable', exitCode: 1, stdout: '', stderr: 'questioning provider unavailable' }; } } });
      assertNotPublished(s, b, 'questioning', 'current provider failure');
      const halt = haltOf(b.events);
      assert(halt?.halt_reason === 'executor_waiting' && /questioning provider unavailable/.test(String(halt.halt_guidance)), JSON.stringify(halt));
      assert(b.log.prompts['design-repair-questioning']?.length === 1, 'one actual failed current questioning request');
    }),
  },
  {
    name: 'S16-c3b 质询无合法对象先补格式，相同坏交回暂停且不沿用旧报告或发布',
    run: () => withFreshCuHost(async s => {
      const b = await s16Born(s, { adapter: { questioning: doc => { delete doc.review_summary.questioning; } } });
      console.log(`[design-authority-repair] S16-c3b ${describeS16(b)}`);
      assertNotPublished(s, b, 'questioning', '质询无结果', true);
      const prompts = b.log.prompts['design-repair-questioning'];
      assert.equal(prompts?.length, 2, '首次坏交回必须给原质询一次补格式机会，相同坏交回不能买到第三次调用');
      assert(!prompts[0].includes('上次质询未交回可用对象，请按既有格式返回。'));
      assert(prompts[1].includes('上次质询未交回可用对象，请按既有格式返回。'));
      const halt = haltOf(b.events);
      assert(halt && ['executor_waiting', 'no_progress_guard'].includes(String(halt.halt_reason)), JSON.stringify(halt));
    }),
  },
  {
    name: 'S16-c3c 编写调用误填机器准入字段：自报不能决定结果，机器重算与真实独立质询决定准入',
    run: () => withFreshCuHost(async s => {
      const b = await s16Born(s, { adapter: { author: doc => { doc.review_summary.admission.status = 'pass';
        doc.review_summary.admission.current_slice.controlled_fakes = ['self-asserted-pass'];
        return { exitCode: 1, completion_observed: true, kill_attempted: true }; } } });
      console.log(`[design-authority-repair] S16-c3c ${describeS16(b)}`);
      const publication = contentRepairs(b.events).find(event => event.stage === 'published');
      assert(publication?.outcome === 'recovered' && publication.admission_after_invalidation === 'blocker'
        && publication.admission_after_questioning === 'pass', '作者自填pass在旧Q作废后不能维持准入，只有当前独核后机器重算才可通过：' + describeS16(b));
      const current = loadCanonicalBlueprint(s.root, BLUEPRINT_ID).blueprint as Ev;
      const upstream = validateComponentBlueprintUpstream(current, { projectRoot: s.root });
      assert(deriveBlueprintAdmission(current, upstream).status === 'pass' && blockerIssues(validateComponentBlueprint(current, { projectRoot: s.root })).length === 0,
        '真实当前设计、独核与完整机器校验必须成立');
      assert(outOfChainStarts(b.events).some(event => event.phase === 'design-repair-questioning')
        && current.review_summary.questioning.provider_id === 'design-repair-questioning', '作者自报不能代替实际独立质询');
      assert(readJson<Ev>(runFile(s.root, b.feature, b.runId, 'manifest.json')).requirement === b.requirement
        && current.blueprint_id === BLUEPRINT_ID, '不得改原需求或设计身份来取得准入');
      assertCompletedBy(s, b.feature, b.runId, '机器字段重算后真实完成');
      assertAttemptCleanedUp(s);
    }),
  },
  {
    name: 'S16-c3d 作者已有效只欠必答质询：保持未知与未发布候选，只补Q、不重买有效作者',
    run: () => withFreshCuHost(async s => {
      // codex t6 第五轮之后，编写调用改指纹等定位之外的内容在授权边界就被拒（见 S16-r7）；准入派生不过改由质询结果触发。
      let canonicalBefore: Buffer | undefined;
      let questioningCalls = 0;
      const b = await s16Born(s, { beforeBirth: async () => { canonicalBefore = fs.readFileSync(blueprintFile(s)); }, adapter: { questioning: doc => { questioningCalls++; doc.review_summary.questioning.items = []; doc.review_summary.questioning.summary = `本次独立质询措辞-${questioningCalls}`;
        return { exitCode: 1, completion_observed: true, kill_attempted: true }; } } });
      console.log(`[design-authority-repair] S16-c3d ${describeS16(b)}`);
      const failed = assertNotPublished(s, b, 'questioning', '缺少必答质询');
      assert.equal(failed.admission_after_questioning, 'blocker', '缺少必答范围仍不能准入');
      assert.deepEqual(fs.readFileSync(blueprintFile(s)), canonicalBefore, 'canonical 蓝图与原质询历史不得被未通过的草稿覆盖');
      const authorPrompts = b.log.prompts['design-repair-author'];
      assert.equal(authorPrompts.length, 1, '有效作者已经交回，缺Q不得重派无关作者');
      assert(questioningCalls >= 1 && b.log.prompts['design-repair-questioning']?.length === questioningCalls, '必须真实调用原独核职责');
      assert(String(failed.reason).includes('blueprint_questioning_items_missing'), '待核原因须保留实际缺项，不能伪造产品FAIL或完成');
      for (const event of [haltOf(b.events), endOf(b.events)]) {
        assert(event?.run_disposition === 'WAITING', '缺真实Q必须沿原等待出口保留未知：' + JSON.stringify(event));
      }
      const candidate = readDoc(path.join(path.dirname(runFile(s.root, b.feature, b.runId, 'events.jsonl')), 'design-repair/component-blueprint.yaml'));
      assert(deriveBlueprintAdmission(candidate, validateComponentBlueprintUpstream(candidate, { projectRoot: s.root })).status === 'blocker',
        '只有后续合法Q满足真实必答范围后才可能准入，保留草稿本身不能通过');
      assertAttemptCleanedUp(s);
    }),
  },
  {
    name: 'S16-c3f 已完成质询对当前必需scope给合法blocker：保留完整材料，拒绝降低验收的草稿且不发布',
    run: () => withFreshCuHost(async s => {
      let approved: string | undefined;
      let questioningCalls = 0;
      let canonicalBefore: Buffer | undefined;
      const completed = { exitCode: 1, completion_observed: true, kill_attempted: true };
      const b = await s16Born(s, { beforeBirth: async saved => { approved = saved.acceptance.criteria[0].expected_result; canonicalBefore = fs.readFileSync(blueprintFile(s)); },
        adapter: { author: doc => {
          ledgerDomain(doc).acceptance.criteria[0].expected_result = '刷新请求不改变任何账目，也不要求恢复结果。';
          return completed;
        }, questioning: doc => {
          questioningCalls++;
          assert(requiredQuestioningScopes(doc).has('view:logical'), '否定必须指向本次必需质询范围');
          const item = doc.review_summary.questioning.items.find((q: Ev) => q.scope_ref === 'view:logical');
          const current = loadCanonicalChangeUnit(s.root, BLUEPRINT_ID, CU);
          assert((current.changeUnit.design_refs as Ev[]).some(ref => ref.target.view_id === 'logical' && ref.target.id === 'ledger-domain'), '当前CU实际依赖被否定的scope');
          assert(item?.verification_refs?.length > 0, '保留完整合法质询材料，不能靠缺字段制造否定');
          item.disposition = 'blocker';
          item.answer = `本次独立质询措辞-${questioningCalls}：当前ledger-refresh切片依赖的ledger-domain验收被降为无需刷新/恢复，与原批准结果「${approved}」矛盾；当前必需映射未获独立认可，不能发布。`;
          item.verification_refs.push(path.relative(s.root, current.canonicalPath).replace(/\\/g, '/'));
          assert.equal(doc.review_summary.questioning.status, 'complete');
          return completed;
        } } });
      const repairs_ = contentRepairs(b.events);
      const failed = repairs_.find(e => e.stage === 'failed');
      assert(repairs_[0]?.stage === 'attempted' && failed?.failed_step === 'questioning' && !repairs_.some(e => e.stage === 'published'), describeS16(b));
      assert.deepEqual(fs.readFileSync(blueprintFile(s)), canonicalBefore, '被否定的降标草稿不得覆盖 canonical 原验收与质询历史');
      assert.deepEqual(outOfChainStarts(b.events).map(e => e.phase), ['design-repair-author', 'design-repair-questioning', 'design-repair-author', 'design-repair-questioning'], describeS16(b));
      const feedback = b.log.prompts['design-repair-author'] ?? [];
      assert.equal(feedback.length, 2, '当前否定须由共同内核送回原设计作者，再按真实验收收敛');
      assert(feedback[1].includes(`原批准结果「${approved}」`) && feedback[1].includes('本次独立质询措辞-1'), '真实完整否定必须实际送达原作者');
      assert.equal(b.log.prompts['design-repair-questioning']?.length, 2);
      assert.equal(questioningCalls, 2, '共同内核在同scope否定无改善后暂停，不靠新措辞继续派发');
      assert(String(failed.reason).includes(`原批准结果「${approved}」`), '否定仍以真实原验收为依据');
      assert(String(failed.reason).includes('view:logical') && String(failed.reason).includes('本次独立质询措辞-1'), '交回完整当前scope和独立否定');
      for (const event of [haltOf(b.events), endOf(b.events)]) {
        assert(['executor_waiting', 'no_progress_guard'].includes(event?.halt_reason) && event?.run_disposition === 'WAITING' && event.run_wait_kind === 'external', JSON.stringify(event));
      }
      const candidate = readDoc(path.join(path.dirname(runFile(s.root, b.feature, b.runId, 'events.jsonl')), 'design-repair/component-blueprint.yaml'));
      assert.equal(candidate.review_summary.questioning.status, 'complete');
      assert(candidate.review_summary.questioning.items.some((item: Ev) => item.scope_ref === 'view:logical' && item.disposition === 'blocker' && String(item.answer).includes(`原批准结果「${approved}」`)), '暂停保留完整合法质询否定，不降低验收');
      assertAttemptCleanedUp(s);
      assert(b.events.some(e => e.type === 'agent_invoke_end' && e.phase === 'design-repair-questioning'
        && e.exit_code === 1 && e.completion_observed === true), '调用完成与质询业务否定必须同时被真实runtime观察');
    }),
  },
  {
    name: 'S16-c4 B2 原需求内缺口由设计责任方修订并继续',
    run: () => withFreshCuHost(async s => {
      const b = await s16Born(s, { corrupt: node => { node.acceptance = null; } });
      assert(contentRepairs(b.events).some(event => event.stage === 'published' && event.outcome === 'recovered'), describeS16(b));
      assertCompletedBy(s, b.feature, b.runId, 'B2 原需求内修订');
    }),
  },
  {
    name: 'S16-c7b 蓝图已发布、CU内容提交失败 → 不回滚发布，如实记未恢复并停机',
    run: () => withFreshCuHost(async s => {
      // 内容 consumer 先于指针调和；在真正提交 CU 的入口注入失败，不能只拦后面的重复升指针。
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const preparation = require('../../scripts/utils/change-unit-design-preparation') as { reviseChangeUnitContent: (...args: unknown[]) => unknown };
      const real = preparation.reviseChangeUnitContent;
      let b: Awaited<ReturnType<typeof s16Born>>;
      try {
        b = await s16Born(s, { adapter: { author: (_doc, draft) => {
          const candidateFile = path.join(path.dirname(draft), 'change-unit.yaml');
          const candidate = readDoc(candidateFile);
          candidate.purpose += '；保留原账目刷新和恢复义务。';
          writeDoc(candidateFile, candidate);
        }, questioning: () => {
          preparation.reviseChangeUnitContent = () => { preparation.reviseChangeUnitContent = real; throw new Error('injected: CU content commit failed'); };
        } } });
      } finally {
        preparation.reviseChangeUnitContent = real;
      }
      console.log(`[design-authority-repair] S16-c7b ${describeS16(b)}`);
      const repairs_ = contentRepairs(b.events);
      const published = repairs_.find(e => e.stage === 'published');
      assert(published?.outcome === 'unrecovered' && published.failed_step === 'reconcile' && !repairs_.some(e => e.stage === 'failed'), describeS16(b));
      assert(readDoc(blueprintFile(s)).revision === b.baseRevision + 1 && !pointsAtCurrentBlueprint(s, CU), '蓝图已发布、CU 仍指旧 revision（不回滚）');
      assert(/已发布 rev \d+、调和未完成/.test(String(haltOf(b.events)?.halt_guidance)), JSON.stringify(haltOf(b.events)));
      assertAttemptCleanedUp(s);
    }),
  },
  {
    name: 'D5 草稿对象校验与发布后一致：同一合法蓝图内容在 canonical 位置与草稿对象上（真实宿主根作 context）校验结果相同；反例：把草稿目录当 projectRoot 会误报',
    run: () => withSnapshot(s => {
      const loaded = loadCanonicalBlueprint(s.root, BLUEPRINT_ID);
      const context = { projectRoot: s.root, canonicalPath: loaded.canonicalPath };
      const atCanonical = validateComponentBlueprint(loaded.blueprint, context).map(i => `${i.severity}:${i.id}@${i.path}`).sort();
      const draftDir = fs.mkdtempSync(path.join(s.root, 'draft-'));
      fs.copyFileSync(loaded.canonicalPath, path.join(draftDir, 'component-blueprint.yaml'));
      const draft = YAML.parse(fs.readFileSync(path.join(draftDir, 'component-blueprint.yaml'), 'utf8'));
      const asDraft = validateComponentBlueprint(draft, context).map(i => `${i.severity}:${i.id}@${i.path}`).sort();
      assert.deepStrictEqual(asDraft, atCanonical, '草稿对象 + 真实宿主根与 canonical 校验结果一致');
      assert(!atCanonical.some(x => x.startsWith('BLOCKER:')), `前提：夹具蓝图合法：${JSON.stringify(atCanonical)}`);
      const wrongRoot = blockerIssues(validateComponentBlueprint(draft, { projectRoot: draftDir }));
      console.log(`[design-authority-repair] D5 草稿目录当根的 BLOCKER=${wrongRoot.length}`);
      assert(wrongRoot.length > 0, '反例：以草稿目录为根会因找不到宿主里的需求 / 合同而误报');
      // 准入写回同源：派生函数对合法蓝图给出的值与盘上准入一致。
      const derived = deriveBlueprintAdmission(loaded.blueprint, validateComponentBlueprintUpstream(loaded.blueprint, context));
      const admission = (loaded.blueprint.review_summary as Ev).admission;
      assert(derived.status === admission.status && derived.root_questions_complete === admission.root_questions_complete
        && derived.contracts_ready === admission.current_slice.contracts_ready && derived.design_refs_ready === admission.current_slice.design_refs_ready, JSON.stringify({ derived, admission }));
    }),
  },
  {
    name: 'S16-r1a 本次调用删掉自己的起始事件（codex t6 确认轮 A）：编写调用只删本次写出的 agent_invoke_start → 按整文件期望值检出越界并写回；恢复与后继的预算回放不少算、attempted 判重仍在',
    run: () => withFreshCuHost(async s => {
      const b = await s16Born(s, { adapter: { author: (_doc, draft) => {
        const events = path.join(path.dirname(path.dirname(draft)), 'events.jsonl');
        const kept = fs.readFileSync(events, 'utf8').split('\n').filter(Boolean)
          .filter(line => { const e = JSON.parse(line) as Ev; return !(e.type === 'agent_invoke_start' && e.phase === 'design-repair-author'); });
        fs.writeFileSync(events, `${kept.join('\n')}\n`);
      } } });
      console.log(`[design-authority-repair] S16-r1a ${describeS16(b)}`);
      const failed = assertNotPublished(s, b, 'author', '删本次起始');
      const eventsFile = runFile(s.root, b.feature, b.runId, 'events.jsonl');
      assert.deepStrictEqual((failed.files as Ev[] | undefined)?.map(f => f.path), [path.relative(s.root, eventsFile).replace(/\\/g, '/')], `只应检出事件文件：${JSON.stringify(failed)}`);
      assert.strictEqual(haltOf(b.events)?.halt_reason, 'unauthorized_source_mutation', '真实越界走当前违规停机出口');
      const history = replayedHistory(s, b);
      assert(history.resume.attempted && history.successor.attempted, `原修订历史：${JSON.stringify(history)}`);
    }),
  },
  {
    name: 'S16-r1 本 run 与祖先 run 的事件被调用删改（codex t6 首轮 1 / 确认轮 B）：质询调用删掉 run_start、attempted、编写与本次调用的起始，并删掉祖先 run 的一条调用起始、且不给结果 → 检出越界走违规停机；各事件文件整文件写回期望值（会话分段不变）→ resume 与后继审计仍保留原真实修订记录',
    run: () => withFreshCuHost(async s => {
      const captured: { own?: Buffer; ancestor?: Buffer; ancestorFile?: string } = {};
      const b = await s16Born(s, { ancestor: true, adapter: { questioning: (doc, draft) => {
        delete doc.review_summary.questioning;
        const runDir = path.dirname(path.dirname(draft));
        const events = path.join(runDir, 'events.jsonl');
        captured.own = fs.readFileSync(events);
        const kept = captured.own.toString('utf8').split('\n').filter(Boolean).filter(line => {
          const e = JSON.parse(line) as Ev;
          return e.type !== 'run_start' && !(e.type === 'design_authority_repair' && e.stage === 'attempted') && !(e.type === 'agent_invoke_start' && String(e.phase).startsWith('design-repair-'));
        });
        fs.writeFileSync(events, `${kept.join('\n')}\n`);
        captured.ancestorFile = fs.readdirSync(path.dirname(runDir)).map(id => path.join(path.dirname(runDir), id, 'events.jsonl'))
          .find(file => file !== events && fs.existsSync(file) && /"agent_invoke_start"/.test(fs.readFileSync(file, 'utf8')))!;
        captured.ancestor = fs.readFileSync(captured.ancestorFile);
        const lines = captured.ancestor.toString('utf8').split('\n').filter(Boolean);
        lines.splice(lines.findIndex(line => (JSON.parse(line) as Ev).type === 'agent_invoke_start'), 1);
        fs.writeFileSync(captured.ancestorFile, `${lines.join('\n')}\n`);
      } } });
      console.log(`[design-authority-repair] S16-r1 ${describeS16(b)}`);
      const failed = assertNotPublished(s, b, 'questioning', '删改事件');
      const eventsFile = runFile(s.root, b.feature, b.runId, 'events.jsonl');
      const rel = (file: string): string => path.relative(s.root, file).replace(/\\/g, '/');
      assert.deepStrictEqual((failed.files as Ev[] | undefined)?.map(f => f.path).sort(), [rel(eventsFile), rel(captured.ancestorFile!)].sort(), `两份事件文件都须检出：${JSON.stringify(failed)}`);
      assert.strictEqual(haltOf(b.events)?.halt_reason, 'unauthorized_source_mutation', '真实越界走当前违规停机出口');
      // 整文件写回：祖先 run 与删改前逐字节相同；本 run 以删改前的字节为前缀（之后只有运行时自己写的行）。
      assert(fs.readFileSync(captured.ancestorFile!).equals(captured.ancestor!), '祖先 run 的事件应写回调用前的字节');
      assert(fs.readFileSync(eventsFile).subarray(0, captured.own!.length).equals(captured.own!), '本 run 的事件应写回期望值（顺序与会话分段不变）');
      const history = replayedHistory(s, b);
      assert(history.resume.attempted && history.successor.attempted, `原修订历史：${JSON.stringify(history)}`);

    }),
  },
  {
    name: 'S16-r5 编写调用新引用了通常排除目录里的文件（codex t6 确认轮 C）：调用前它不在核对范围、调用期间是否被改无从核实 → 不当作干净继续，走违规停机、不发布',
    run: () => withFreshCuHost(async s => {
      const b = await s16Born(s, {
        beforeCorrupt: () => {
          fs.mkdirSync(path.join(s.root, 'context'), { recursive: true });
          fs.writeFileSync(path.join(s.root, 'context', 'ledger-notes.md'), '# 账本领域说明\n');
        },
        adapter: { author: doc => {
          const node = ledgerDomain(doc);
          node.provenance = { ...node.provenance, source_ref: 'context/ledger-notes.md' };
          fs.appendFileSync(path.join(s.root, 'context', 'ledger-notes.md'), '补一句\n');
        } },
      });
      console.log(`[design-authority-repair] S16-r5 ${describeS16(b)}`);
      const failed = assertNotPublished(s, b, 'author', '新引用无从核实');
      assert(/新引用了调用前未核对的输入文件/.test(String(failed.reason)) && /context\/ledger-notes\.md/.test(String(failed.reason)), JSON.stringify(failed));
      assert.strictEqual(haltOf(b.events)?.halt_reason, 'unauthorized_source_mutation', '无法核实的源写入不能按干净完成');
    }),
  },
  {
    name: 'S16-r3 正常心跳不算越界（codex t6 首轮 1、3）：编写调用进行中本 run 的真实心跳（事件追加、beacon、进度、锁）与另一 feature 的 run 的运行时输出都照常写 → 修复照常发布并完成',
    run: () => withFreshCuHost(async s => {
      // 独立生产 run 载体只提供运行时输入，不声明业务 PASS 或完成。
      const otherFeature = 'heartbeat-side-task';
      const otherRunId = '20261011T000001Z-b0beef';
      const manifest = buildGoalManifestFromInput({ feature: otherFeature, run_id: otherRunId, requirement: '独立运行时心跳',
        start_phase: 'testing', end_phase: 'testing', unattended: { write_mode: 'full-access', approval_mode: 'never' } }, { projectRoot: s.root });
      const otherRun = createGoalRun({ projectRoot: s.root, manifest, chain: ['testing'] });
      const otherRunDir = path.dirname(otherRun.eventsPath);
      writeLivenessBeacon({ projectRoot: s.root, reportDir: path.relative(s.root, otherRunDir).replace(/\\/g, '/'), runId: otherRunId });
      const otherLock = path.join(featureFilePath(s.root, otherFeature, ''), 'goal-runs', FEATURE_LOCK_NAME);
      const before = { events: sha(path.join(otherRunDir, 'events.jsonl')), beacon: sha(path.join(otherRunDir, 'liveness.json')) };
      let heartbeatsDuringAuthor = 0;
      let ownUpdated: Record<string, boolean> = {};
      try {
        const b = await s16Born(s, {
          // plan b0e0621c §3.2：本 run 出生前缩短真实心跳定时器的间隔（回调不变）；驱动层 finally 复位，用例 finally 兜底。
          beforeBirth: async () => { __testing_setLockHeartbeatMs(TEST_LOCK_HEARTBEAT_MS); },
          adapter: { author: async (_doc, draft) => {
            // 另一 feature 的 run 正常运行：取它自己的 feature 锁并刷新、追加心跳事件、写 beacon 与进度、刷新阶段状态。
            const lock = tryAcquireLock(otherLock, { run_id: otherRunId });
            assert(lock, '前提：另一 feature 的锁可取');
            const runDir = path.dirname(path.dirname(draft));
            const ownEvents = path.join(runDir, 'events.jsonl');
            const ownBefore = fs.readFileSync(ownEvents, 'utf8').split('\n').filter(Boolean).length;
            // 等本 run 的真实心跳定时器实际走过：心跳事件、本 feature 锁、beacon、progress.json 都已更新（进度快照有 4 秒节流）。
            const watched: Record<string, string> = {
              lock: featureLockPath(s, CU), beacon: livenessBeaconPath(s.root, path.relative(s.root, runDir).replace(/\\/g, '/')), progress: path.join(runDir, 'progress.json'),
            };
            const digest = (file: string): string => (fs.existsSync(file) ? sha(file) : '');
            const start = Object.fromEntries(Object.entries(watched).map(([k, file]) => [k, digest(file)]));
            const heartbeats = (): number => fs.readFileSync(ownEvents, 'utf8').split('\n').filter(Boolean).slice(ownBefore).map(line => JSON.parse(line) as Ev).filter(e => e.type === 'heartbeat').length;
            for (const deadline = Date.now() + 30_000; ;) {
              ownUpdated = { heartbeat: heartbeats() > 0, ...Object.fromEntries(Object.entries(watched).map(([k, file]) => [k, digest(file) !== start[k]])) };
              if (Object.values(ownUpdated).every(Boolean) || Date.now() > deadline) break;
              await new Promise(resolve => setTimeout(resolve, 200));
            }
            touchLock(otherLock, lock!.ownerId);
            fs.appendFileSync(path.join(otherRunDir, 'events.jsonl'), `${JSON.stringify({ ts: new Date().toISOString(), type: 'heartbeat', phase: 'testing' })}\n`);
            writeLivenessBeacon({ projectRoot: s.root, reportDir: path.relative(s.root, otherRunDir).replace(/\\/g, '/'), runId: otherRunId });
            fs.writeFileSync(path.join(otherRunDir, 'progress.json'), `${JSON.stringify({ heartbeat: Date.now() })}\n`);
            fs.writeFileSync(featureFilePath(s.root, otherFeature, 'next.json'), `${JSON.stringify({ phase: 'testing', at: Date.now() })}\n`);
            releaseLock(otherLock, lock!.ownerId);
            heartbeatsDuringAuthor = heartbeats();
          } },
        });
        console.log(`[design-authority-repair] S16-r3 heartbeats=${heartbeatsDuringAuthor} updated=${JSON.stringify(ownUpdated)} ${describeS16(b)}`);
        assert(heartbeatsDuringAuthor >= 1 && Object.values(ownUpdated).every(Boolean), `前提：编写调用进行中本 run 的真实心跳更新了心跳事件、锁、beacon、progress.json：${JSON.stringify(ownUpdated)}`);
        assert(sha(path.join(otherRunDir, 'events.jsonl')) !== before.events && sha(path.join(otherRunDir, 'liveness.json')) !== before.beacon, '前提：另一 run 的运行时输出确实变了');
        const published = contentRepairs(b.events).find(e => e.stage === 'published');
        assert(published?.outcome === 'recovered' && !b.events.some(e => e.type === 'phase_write_violation'), `正常心跳不得判越界：${describeS16(b)}`);
        assertCompletedBy(s, b.feature, b.runId, 'S16-r3');
        assert.strictEqual(lockHeartbeatIntervalMs(), PRODUCTION_LOCK_HEARTBEAT_MS, '目标调用结束后心跳间隔已复位为生产缺省值');
      } finally {
        __testing_setLockHeartbeatMs(null);
      }
    }),
  },
  {
    name: 'S16-r7 原需求内补施工文件，经独立质询和CU内容修订，不再按旧B1单字段拒绝',
    run: () => withFreshCuHost(async s => {
      const b = await s16Born(s, {
        allowSuccessors: true,
        adapter: { fix: (node, original) => { restoreNode(node, original); node.contracts.files.push(NEW_CONTRACT_FILE); } },
      });
      console.log(`[design-authority-repair] S16-r7 ${describeS16(b)}`);
      assert(contentRepairs(b.events).some(event => event.stage === 'published' && event.outcome === 'recovered'), describeS16(b));
      assert(ledgerDomain(readDoc(blueprintFile(s))).contracts.files.includes(NEW_CONTRACT_FILE));
      assert(b.log.prompts['design-repair-questioning']?.length === 1, '扩大施工范围仍经独立质询');
      assertCompletedBy(s, b.feature, b.runId, '施工范围修订后接续');
    }),
  },
  {
    name: 'S16-r2 编写调用的子进程收容绑定失败（codex t6 首轮 2）：未证明消失 → 走既有 agent_containment_unresolved 停机，不发布、不启动质询、不挂设计探针；已证明消失 → 按普通尝试失败收口（设计 owner 停机）',
    run: () => withFreshCuHost(async s => {
      if (process.platform !== 'win32') { console.log('[design-authority-repair] S16-r2 跳过：收容只在 Windows 上启用'); return; }
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const cp = require('child_process') as typeof import('child_process') & { spawnSync: unknown };
      const dummy = cp.spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });
      const spawnSync = cp.spawnSync;
      try {
        const b = await s16Born(s, { adapter: { author: () => {
          // 只让对这个 pid 的 taskkill 失败（结束不了的替身）；身份探测与存活探测照常走真实系统调用。
          cp.spawnSync = ((file: string, args: readonly string[] = [], ...rest: unknown[]) =>
            /taskkill/i.test(String(file)) && args.includes(String(dummy.pid))
              ? { status: 1, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), pid: 0, output: [], signal: null }
              : (spawnSync as (...a: unknown[]) => unknown)(file, args, ...rest)) as never;
          return { activeChildPid: dummy.pid };
        } } });
        cp.spawnSync = spawnSync;
        console.log(`[design-authority-repair] S16-r2 未证明消失 ${describeS16(b)}`);
        const halt = haltOf(b.events);
        assert(halt?.halt_reason === 'agent_containment_unresolved' && !halt.probe, `应走既有收容停机、不挂设计探针：${JSON.stringify(halt)}`);
        assertNotPublished(s, b, 'author', '收容未证明消失');
        assert(!b.log.prompts['design-repair-questioning'] && outOfChainStarts(b.events).length === 1, '不得启动质询调用');
        assert(!b.events.some(e => e.type === 'agent_invoke_end' && e.phase === 'design-repair-author'), '未证明消失时不落 invoke_end（留给恢复对账）');
      } finally {
        cp.spawnSync = spawnSync;
        try { dummy.kill(); } catch { /* 已不在 */ }
        await childExited(dummy);
      }
    }),
  },
  {
    name: 'S16-r2b 收容绑定失败且已证明子进程消失：当前调用失败停放，不发布',
    run: () => withFreshCuHost(async s => {
      if (process.platform !== 'win32') { console.log('[design-authority-repair] S16-r2b 跳过：收容只在 Windows 上启用'); return; }
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const cp = require('child_process') as typeof import('child_process');
      const dummy = cp.spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });
      try {
        const b = await s16Born(s, { adapter: { author: () => ({ activeChildPid: dummy.pid }) } });
        console.log(`[design-authority-repair] S16-r2b 已证明消失 ${describeS16(b)}`);
        const halt = haltOf(b.events);
        assert(halt?.halt_reason === 'executor_waiting' && !halt.probe, `已证明消失按当前调用失败停放：${JSON.stringify(halt)}`);
        const failed = assertNotPublished(s, b, 'author', '收容失败但已消失');
        assert(/guardian/.test(String(failed.reason)) && !b.log.prompts['design-repair-questioning'], JSON.stringify(failed));
        assert(dummy.exitCode !== null || dummy.signalCode !== null || !(() => { try { process.kill(dummy.pid!, 0); return true; } catch { return false; } })(), '子进程已被结束');
      } finally {
        try { dummy.kill(); } catch { /* 已不在 */ }
        await childExited(dummy);
      }
    }),
  },
  ...(['absent', 'query-failure'] as const).map(existence => ({
    name: `S16-r2c 终止命令失败但独立存在探针 ${existence}：${existence === 'absent' ? '已证明消失按调用失败收口' : '查询失败仍阻断续跑'}，不发布、不派质询`,
    run: () => withFreshCuHost(async s => {
      if (process.platform !== 'win32') { console.log('[design-authority-repair] S16-r2c 跳过：收容只在 Windows 上启用'); return; }
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const cp = require('child_process') as typeof import('child_process');
      const dummy = cp.spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });
      const spawnSync = cp.spawnSync;
      let terminateCalls = 0;
      let existenceQueries = 0;
      try {
        const b = await s16Born(s, { adapter: { author: async () => {
          // ABSENT 用真实已退出子进程；查询失败用仍活子进程与既有 OS 探针注入缝。
          if (existence === 'absent') { dummy.kill(); await childExited(dummy); }
          else __testing_setPidProbeExecutor(() => { existenceQueries++; return { status: 1, stdout: '' }; });
          cp.spawnSync = ((file: string, args: readonly string[] = [], ...rest: unknown[]) => {
            if (/taskkill/i.test(String(file)) && args.includes(String(dummy.pid))) {
              terminateCalls++;
              return { status: 1, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), pid: 0, output: [], signal: null };
            }
            return (spawnSync as (...a: unknown[]) => unknown)(file, args, ...rest);
          }) as never;
          return { activeChildPid: dummy.pid };
        } } });
        assert(terminateCalls > 0, '实际生产绑定路径仍须尝试终止');
        const halt = haltOf(b.events);
        if (existence === 'absent') {
          assert(halt?.halt_reason === 'executor_waiting' && !halt.probe, `已证明消失不得标为收容未解决：${describeS16(b)}`);
          assert(b.events.some(e => e.type === 'agent_invoke_end' && e.phase === 'design-repair-author'), '绑定失败仍按普通调用失败收口');
        } else {
          assert(existenceQueries > 0 && halt?.halt_reason === 'agent_containment_unresolved' && !halt.probe, `查询失败不得作为消失证明：${describeS16(b)}`);
          assert(!b.events.some(e => e.type === 'agent_invoke_end' && e.phase === 'design-repair-author'), '未证明消失时不落 invoke_end');
        }
        assertNotPublished(s, b, 'author', `收容 ${existence}`);
        assert(!b.log.prompts['design-repair-questioning'] && outOfChainStarts(b.events).length === 1, '绑定失败不得继续质询调用');
      } finally {
        cp.spawnSync = spawnSync;
        __testing_setPidProbeExecutor(null);
        try { dummy.kill(); } catch { /* 已不在 */ }
        await childExited(dummy);
      }
    }),
  })),

  {
    name: 'S16-c8 发布前 canonical 被别处改动（非阻断建议）：质询调用之后、发布之前另一写入者改了 canonical 蓝图 → 基线复核不等，不发布',
    run: () => withFreshCuHost(async s => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const validator = require('../../scripts/utils/component-blueprint-validator') as { validateComponentBlueprint: typeof validateComponentBlueprint };
      const original = validator.validateComponentBlueprint;
      let touchedAt: string | undefined;
      try {
        const b = await s16Born(s, { adapter: { author: () => touchedAt ? { status: 'waiting', exitCode: 0,
          details: '本用例只核对一次并发写入的发布拒绝；后续作者尚未交回新候选。' } : undefined, questioning: () => {
          assert(!touchedAt, 'inject only the original concurrent write, not an endlessly changing canonical input');
          // 下一次校验（运行时对草稿的发布前校验）之前，另一会话手工改了 canonical 蓝图。
          validator.validateComponentBlueprint = ((value: unknown, context: Parameters<typeof validateComponentBlueprint>[1]) => {
            validator.validateComponentBlueprint = original;
            fs.appendFileSync(blueprintFile(s), '\n# 另一会话手工改动\n');
            touchedAt = sha(blueprintFile(s));
            return original(value, context);
          }) as typeof validateComponentBlueprint;
        } } });
        console.log(`[design-authority-repair] S16-c8 ${describeS16(b)}`);
        const repairs_ = contentRepairs(b.events);
        const failed = repairs_.find(e => e.stage === 'failed');
        assert(failed?.failed_step === 'questioning' && /authority_projection_invalid[\s\S]*artifact_sha256/.test(String(failed.reason))
          && !repairs_.some(e => e.stage === 'published'), `当前绑定校验应先于发布拒绝外部变化：${describeS16(b)}`);
        assert(touchedAt && sha(blueprintFile(s)) === touchedAt, 'canonical 保持别处写入的字节，不被草稿覆盖');
      } finally {
        validator.validateComponentBlueprint = original;
      }
    }),
  },
  {
    name: 'T2-heartbeat 心跳测试缝（plan b0e0621c §3.2 / V5）：不安装时取生产缺省 60 秒；安装后目标调用异常退出，驱动层复位回缺省值',
    run: async () => {
      assert.strictEqual(lockHeartbeatIntervalMs(), PRODUCTION_LOCK_HEARTBEAT_MS, '未安装：生产缺省值');
      __testing_setLockHeartbeatMs(TEST_LOCK_HEARTBEAT_MS);
      try {
        assert.strictEqual(lockHeartbeatIntervalMs(), TEST_LOCK_HEARTBEAT_MS, '安装后生效');
        await assert.rejects(runGoalRuntimeChain(path.join(os.tmpdir(), `maison-absent-host-${process.pid}`), {}), '目标调用应异常退出（宿主根不存在）');
        assert.strictEqual(lockHeartbeatIntervalMs(), PRODUCTION_LOCK_HEARTBEAT_MS, '目标调用异常退出后已复位为生产缺省值');
      } finally {
        __testing_setLockHeartbeatMs(null);
      }
    },
  },
];

for (const finalFailure of [false, true]) cases.push({
  name: `review-delivery B1 ${finalFailure ? '最后补生成失败仍保留内部实际写入路径且 recovered 不变' : '内部持锁刷新后外层同字节不重写，最终仍记已刷新与实际 files'}`,
  run: () => withFreshCuHost(async s => {
    const materialization = require('../../scripts/utils/blueprint-review-materialization') as typeof import('../../scripts/utils/blueprint-review-materialization');
    const real = materialization.materializeBlueprintReview;
    const preparation = require('../../scripts/utils/change-unit-design-preparation') as typeof import('../../scripts/utils/change-unit-design-preparation');
    const reconcile = preparation.reconcileHeldBlueprintRefs;
    const nodeFs = require('fs') as typeof fs; const rename = nodeFs.renameSync;
    const reviewPath = blueprintReviewPath(s.root, BLUEPRINT_ID);
    let calls = 0; let writes = 0; let held = false;
    let reconciled = false; let stableReads = 0;
    try {
      const b = await s16Born(s, { beforeBirth: async () => {
        preparation.reconcileHeldBlueprintRefs = (...args) => { const result = reconcile(...args); reconciled = true; return result; };
        nodeFs.renameSync = ((from: fs.PathLike, to: fs.PathLike) => {
          if (String(to) === reviewPath) {
            writes++;
            held = fs.existsSync(path.join(featureFilePath(s.root, BLUEPRINT_ID, ''), BLUEPRINT_RECONCILE_LOCK_NAME)) && fs.existsSync(featureLockPath(s, CU));
          }
          return rename(from, to);
        }) as typeof fs.renameSync;
        materialization.materializeBlueprintReview = (root, id) => {
          calls++;
          if (finalFailure && reconciled) return { path: reviewPath, status: 'failed', writtenPaths: [], sourceGaps: [], reason: 'injected final materialization failure', rebuildCommand: 'check:component-blueprint --write-review' };
          const before = fs.existsSync(reviewPath) ? sha(reviewPath) : undefined;
          const result = real(root, id);
          if (before && before === sha(reviewPath)) { stableReads++; assert.equal(result.writtenPaths.length, 0, '同字节渲染不得重写'); }
          return result;
        };
      } });
      const published = contentRepairs(b.events).find(e => e.stage === 'published');
      assert(published?.outcome === 'recovered' && published.review_document?.status === (finalFailure ? 'failed' : 'refreshed'), describeS16(b));
      assert(calls >= 2 && writes >= 1 && held && (finalFailure || stableReads > 0), `内容修订/指针调和可改变文档，外层同字节必须不重写：${JSON.stringify({calls,writes,held,stableReads})}`);
      assert(published.files.includes(path.relative(s.root, reviewPath).split(path.sep).join('/')) && published.review_document.writtenPaths.includes(reviewPath), JSON.stringify(published));
      assert(published.review_projection_stale === finalFailure, '最终状态被外层是否写入或内层成功掩盖');
      assert(pointsAtCurrentBlueprint(s, CU) && inspectBlueprintReview(s.root, BLUEPRINT_ID).status === 'current', '原调和或真实文档被破坏');
      assertAttemptCleanedUp(s);
      assertCompletedBy(s, b.feature, b.runId, 'B1 文档不参与 recovered');
    } finally { materialization.materializeBlueprintReview = real; preparation.reconcileHeldBlueprintRefs = reconcile; nodeFs.renameSync = rename; }
  }),
});

type DesignRepairGroup = 'content' | 'continuation' | 'runtime' | 'other';
export function getCases(group?: DesignRepairGroup): Array<{ name: string; run: () => Promise<void> }> {
  return cases.filter(c => !group || group === (c.name.startsWith('S16-c') ? 'content'
    : c.name.startsWith('S15-') ? 'continuation' : c.name.startsWith('S16-r') ? 'runtime' : 'other'))
    .map(c => ({ ...c, name: `design-authority-repair: ${c.name}` }));
}

export async function runSelectedCases(selector?: string, group?: DesignRepairGroup): Promise<SelectedUnitCases> {
  const results: UnitCaseResult[] = [];
  const timings: UnitExecutionTiming[] = [];
  for (const c of getCases(group)) {
    const name = c.name;
    if (!matchesUnitCase(name, selector)) continue;
    const endTiming = startCaseTiming([name], timings);
    const started = Date.now();
    try {
      await c.run();
      results.push({ name, ok: true });
    } catch (err) {
      results.push({ name, ok: false, error: (err as Error).stack ?? (err as Error).message });
    } finally { endTiming(); }
    console.log(`[${c.name.split('：')[0]}] ${((Date.now() - started) / 1000).toFixed(1)}s`);
  }
  return selectedUnitCases(results, selector, timings);
}

export async function runAll(group?: 'content' | 'continuation' | 'runtime' | 'other'): Promise<UnitCaseResult[]> {
  return (await runSelectedCases(undefined, group)).results;
}

export const listCaseGroups = (group?: DesignRepairGroup) => unitCaseGroups(getCases(group).map(c => c.name));
