import '../utils/transpile-only-env';
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as YAML from 'yaml';
import { featureFilePath, clearFrameworkConfigCache } from '../../config';
import { buildGoalManifestFromInput, buildInitialDesignGoalManifest, type GoalRunManifest } from '../../scripts/utils/goal-manifest';
import { assertGoalRunAttachable, createGoalRun } from '../../scripts/utils/goal-run-creation';
import { ensureRunControl } from '../../scripts/utils/goal-run-control';
import { FEATURE_LOCK_NAME, releaseLock, tryAcquireLock } from '../../scripts/utils/goal-run-lock';
import { loadCanonicalBlueprint } from '../../scripts/utils/component-blueprint-path';
import { validateComponentBlueprint } from '../../scripts/utils/component-blueprint-validator';
import { deriveChangeUnitFeatureId, enumerateCanonicalChangeUnits, loadCanonicalChangeUnit } from '../../scripts/utils/change-unit-path';
import { deriveDesignPreparationReadiness } from '../../scripts/utils/change-unit-design-preparation';
import { designRepairTarget, designRepairInvokeLabel, designRepairSignature, runUnattendedDesignRepair, replayDesignRepairInvocation, recordDesignRepairInvocation, type DesignRepairBriefLike, type DesignRepairInvokeOutcome } from '../../scripts/utils/design-repair-unattended';
import { capturePhaseInvocationSnapshot } from '../../scripts/utils/phase-write-boundary';
import { headlessLedgerPath } from '../../scripts/utils/headless-assumptions';
import { resolveBlueprintTarget } from '../../scripts/utils/blueprint-addressing';
import { materializeBlueprintSkillInputs } from '../../scripts/utils/blueprint-skill-projection';
import { repairAdapter } from './design-authority-repair.unit.test';
import { BLUEPRINT_ID, withFreshCuHost } from './lifecycle-evolution.unit.test';
import { fixture } from './blueprint-skill-projection.unit.test';
import { DISPOSITIONS } from '../../scripts/utils/component-blueprint-model';
import { renderQuestioningResultInstructions, validateBlueprintQuestioning } from '../../scripts/utils/blueprint-questioning';
import { validateChangeUnit } from '../../scripts/utils/change-unit-validator';
import { validateChangeUnitDesign } from '../../scripts/utils/change-unit-design-gate';
import { diagnoseBlueprintSkillAuthority } from '../../scripts/utils/blueprint-skill-projection';
import { blueprintIdentityPointers } from '../../scripts/utils/change-unit-blueprint-identity';
import { inspectGeneratedBlueprintGraphs } from '../../scripts/utils/blueprint-graph-generator';
import { runGoalModeSessionStep } from '../../scripts/goal-mode-entry';
import { readSessionExecution } from '../../scripts/utils/session-execution-handoff';
import { readOriginalDeliveryBudget } from '../../scripts/utils/delivery-origin';
import { deriveChangeUnitReadySet } from '../../scripts/utils/change-unit-ready-set';
import { matchesUnitCase, selectedUnitCases, startCaseTiming, type UnitExecutionTiming } from '../utils/unit-case-selection';
import type { UnitCaseResult } from '../run-unit';

type Host = Parameters<Parameters<typeof withFreshCuHost>[0]>[0];
type Document = Record<string, any>;
type Scenario = 'root' | 'outside-write' | 'readiness-blocked' | 'normal' | 'retry' | 'exhausted' | 'self-signed-retry' | 'session-retry' | 'session-budget' | 'design-owner' | 'design-owner-external' | 'design-owner-budget' | 'design-owner-retain' | 'session-progress-recovery' | 'session-architecture-recovery';
const CU = deriveChangeUnitFeatureId(BLUEPRINT_ID, 'ledger-refresh');
const requirement = '在已准入账目蓝图的原目标内补齐CU设计引用，再继续账目刷新与恢复的完整交付；不得降低验收或修改框架。';
const read = (file: string): Document => YAML.parse(fs.readFileSync(file, 'utf8'));
const write = (file: string, value: unknown): void => fs.writeFileSync(file, YAML.stringify(value));

function assertNoChildRun(host: Host): void {
  for (const unit of enumerateCanonicalChangeUnits(host.root, BLUEPRINT_ID)) {
    const feature = deriveChangeUnitFeatureId(BLUEPRINT_ID, String(unit.changeUnit.change_unit_id));
    const directory = featureFilePath(host.root, feature, 'goal-runs');
    assert(!fs.existsSync(directory) || fs.readdirSync(directory).every(name => name.startsWith('.')), 'a design repair must not invent a construction child');
    assert(!fs.existsSync(featureFilePath(host.root, feature, 'execution-scope.json')), 'repair must not freeze a construction scope');
  }
}

async function scenario(host: Host, mode: Scenario): Promise<void> {
  const recovery = mode === 'session-progress-recovery' || mode === 'session-architecture-recovery';
  const workspace = featureFilePath(host.root, BLUEPRINT_ID, '');
  for (const unit of enumerateCanonicalChangeUnits(host.root, BLUEPRINT_ID)) {
    if (unit.changeUnit.change_unit_id === 'ledger-refresh') continue;
    const directory = path.resolve(path.dirname(unit.canonicalPath));
    assert(directory.startsWith(path.resolve(workspace) + path.sep));
    fs.rmSync(directory, { recursive: true, force: true });
  }
  const canonical = loadCanonicalBlueprint(host.root, BLUEPRINT_ID);
  assert(!validateComponentBlueprint(canonical.blueprint, { projectRoot: host.root, canonicalPath: canonical.canonicalPath }).some(issue => issue.severity === 'BLOCKER'));
  assert(deriveDesignPreparationReadiness(host.root, BLUEPRINT_ID).ready, 'the unchanged design fixture must initially be ready');
  if (mode === 'normal') materializeBlueprintSkillInputs(host.root, CU, host.frameworkRoot);
  const unit = loadCanonicalChangeUnit(host.root, BLUEPRINT_ID, 'ledger-refresh');
  const approvedCu = read(unit.canonicalPath);
  const defective = structuredClone(approvedCu);
  const ownerCase = mode.startsWith('design-owner');
  if (ownerCase) {
    const declared: Document = { blocker_id: 'retained-design-declaration', gate: 'design', owner: 'component-design', observation: 'machine',
      reason: '候选保留了已经满足的设计归属声明', unlock_condition: '由设计owner对当前已发布设计有据核实并经原consumer发布',
      source_refs: [path.relative(host.root, canonical.canonicalPath).replace(/\\/g, '/')],
      probe: { kind: 'contract', ref: 'current-design', expected: 'current design is already represented' } };
    if (mode === 'design-owner-retain') { declared.reason = '当前设计条件尚未真实解除'; declared.unlock_condition = '依据后续真实设计事实解除'; }
    defective.blockers = mode === 'design-owner-external' ? [
      { ...declared, blocker_id: 'already-cleared-design', probe: { kind: 'file_exists', ref: path.relative(host.root, canonical.canonicalPath).replace(/\\/g, '/'), expected: 'present' } },
      { ...declared, blocker_id: 'human-condition', observation: 'human', authority_ref: 'user-authority', source_revision: 'revision-1', probe: undefined },
      { ...declared, blocker_id: 'device-execution-condition', gate: 'execution', owner: 'testing' },
      { ...declared, blocker_id: 'other-design-owner', owner: 'external-owner' },
    ] : [declared];
  } else defective.design_refs = defective.design_refs.filter((ref: Document) => ref.target.view_id !== 'development');
  write(unit.canonicalPath, defective);
  const before = deriveDesignPreparationReadiness(host.root, BLUEPRINT_ID);
  if (ownerCase) {
    assert(before.ready, 'all current authority/design projections must already be valid');
    assert.equal(diagnoseBlueprintSkillAuthority(host.root, host.frameworkRoot, CU).findings.length, 0);
    assert(!deriveChangeUnitReadySet(host.root, BLUEPRINT_ID).units[0].ready, 'the retained declaration still blocks the real ready-set');
  } else assert(!before.ready && before.perUnit.some(row => row.changeUnitId === 'ledger-refresh' && row.verdict !== 'constructable'), 'the missing real development reference must block CU readiness');
  const issues = before.perUnit.find(row => row.changeUnitId === 'ledger-refresh')!;
  const brief: DesignRepairBriefLike = { class: 'B2', items: [{ check: 'plan:cu:design-basis', class: 'B2', codes: issues.issueIds,
    artifacts: [path.relative(host.root, unit.canonicalPath).split(path.sep).join('/')], basis: issues.issues.map(issue => issue.message).join('；'),
    needs: ['按已准入蓝图补回被遗漏的development设计引用，保留原CU身份和其它权威设计。'] }] };
  const normal = mode === 'normal';
  const feature = normal ? CU : BLUEPRINT_ID;
  const runId = normal ? 'normal-repair-run' : 'initial-repair-run';
  const common = { feature, run_id: runId, adapter: 'claude', requirement,
    budget: { max_total_turns: mode === 'session-retry' ? 4 : mode === 'session-budget' ? 3 : mode === 'design-owner' ? 2 : mode === 'design-owner-budget' ? 1 : 30, wall_clock_minutes: 120 },
    unattended: { write_mode: 'full-access', approval_mode: 'never', timeout_seconds: 900 } };
  const manifest: GoalRunManifest = normal
    ? buildGoalManifestFromInput({ ...common, start_phase: 'plan', end_phase: 'plan' }, { projectRoot: host.root })
    : buildInitialDesignGoalManifest({ ...common, start_phase: 'plan', end_phase: 'ut', initial_design: { completion_target: 'feature', requested_results: ['账目刷新与恢复完整交付'], requested_phases: ['plan', 'coding', 'review', 'ut'] } }, { projectRoot: host.root });
  createGoalRun({ projectRoot: host.root, manifest, chain: normal ? ['plan'] : [] });
  assertGoalRunAttachable(host.root, manifest);
  const runDir = path.join(host.root, manifest.report_dir);
  ensureRunControl(runDir, runId);
  const eventFile = path.join(runDir, 'events.jsonl');
  let recording: Array<{ file: string; line: string }> | undefined;
  const emit = (value: Record<string, unknown>) => {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...value }) + '\n';
    fs.appendFileSync(eventFile, line);
    recording?.push({ file: eventFile, line });
  };
  emit({ type: 'run_start', ...(normal ? { chain: ['plan'] } : {}) });
  if (!normal) {
    assertNoChildRun(host);
    assert.equal(manifest.start_phase, 'plan', 'the original request domain is input, not a construction phase');
    assert.equal(manifest.end_phase, 'ut');
    assert.deepEqual((manifest as unknown as Document).initial_design.requested_phases, ['plan', 'coding', 'review', 'ut']);
    for (const key of ['execution_scope', 'run_base_sha', 'phase_chain', 'chain_override']) assert.equal((manifest as unknown as Document)[key], undefined);
  }
  const phase = normal ? 'plan' : 'initial-design-author';
  const lockPath = featureFilePath(host.root, feature, path.join('goal-runs', FEATURE_LOCK_NAME));
  const lock = tryAcquireLock(lockPath, {});
  assert(lock);
  const savedNode = structuredClone(resolveBlueprintTarget(canonical.blueprint, { kind: 'node', view_id: 'logical', id: 'ledger-domain' })) as Document;
  const originalBytes = fs.readFileSync(canonical.canonicalPath);
  const purposes: string[] = [];
  let readinessCalls = 0;
  let lateFault = false;
  let authorCalls = 0, questioningCalls = 0;
  const preparation = require('../../scripts/utils/change-unit-design-preparation') as typeof import('../../scripts/utils/change-unit-design-preparation');
  const realReconcile = preparation.reconcileHeldBlueprintRefs;
  if (mode === 'readiness-blocked') preparation.reconcileHeldBlueprintRefs = (...args) => {
    const result = realReconcile(...args);
    if (!lateFault) {
      lateFault = true;
      const current = loadCanonicalChangeUnit(host.root, BLUEPRINT_ID, 'ledger-refresh');
      const changed = read(current.canonicalPath);
      changed.design_refs = changed.design_refs.filter((ref: Document) => ref.target.view_id !== 'development');
      write(current.canonicalPath, changed);
    }
    return result;
  };
  const adapter = repairAdapter(host, () => savedNode, { author: (doc, draft) => {
    authorCalls++;
    if (authorCalls > 1) {
      assert.equal(doc.review_summary.questioning, undefined, 'next author input is the actual prior Q output with questioning removed');
      if (!recovery && (mode !== 'exhausted' || authorCalls <= 4)) doc.review_summary.summary = String(doc.review_summary.summary ?? '') + ' 第二轮已补原范围失败恢复说明';
      if (mode === 'self-signed-retry') doc.review_summary.questioning = { status: 'complete', provider_id: 'author', items: [] };
    }
    if (mode === 'session-architecture-recovery' && authorCalls === 1) {
      const file = path.join(path.dirname(draft), 'architecture.json');
      const architecture = JSON.parse(fs.readFileSync(file, 'utf8'));
      architecture.outer_layers.push({ id: '05-Recovery', can_depend_on: [], intra_layer_deps: 'forbid' });
      fs.writeFileSync(file, JSON.stringify(architecture));
      doc.decisions_and_gaps.decisions.push({ decision_id: 'add-recovery-module', kind: 'architecture_impact', change: 'add_module',
        module: 'recovery-helper', layer: '05-Recovery', status: 'decided_with_authority', rationale: '原恢复设计职责的真实模块归属',
        owner: 'design-owner', verification_refs: ['view:development'], provenance: structuredClone(doc.provenance) });
    }
    if (mode === 'session-progress-recovery' && authorCalls === 2) {
      // Exercise the post-Q pause: author changes machine fingerprints, then runtime restores them.
      doc.source_fingerprint = doc.discovery.source_fingerprint = 'regenerated-by-runtime';
    }
    write(path.join(path.dirname(draft), 'change-unit.yaml'), mode === 'design-owner-retain' ? defective : approvedCu);
    if (mode === 'outside-write') fs.appendFileSync(path.join(host.root, 'src/ledger/LedgerFeature.ets'), '\n// unauthorized product edit\n');
  }, questioning: doc => {
    questioningCalls++;
    const evidenceRound = mode === 'session-progress-recovery' ? 1 : questioningCalls;
    if (recovery || mode === 'exhausted' || (['retry', 'self-signed-retry', 'session-retry', 'session-budget'].includes(mode) && questioningCalls === 1)) {
      Object.assign(doc.review_summary.questioning.items[0], { disposition: 'blocker', question: '当前范围失败恢复验收是否完整？', answer: `真实内容差额-${evidenceRound}\n\n当前独立核实的第二段证据-${evidenceRound}` });
    } else if (mode === 'retry') assert(String(doc.review_summary.summary).includes('第二轮已补'));
  } });
  try {
    if (ownerCase) {
      const options = { projectRoot: host.root, frameworkRoot: host.frameworkRoot, feature, runId, adapter: 'claude', runMode: 'attended',
        authorization: { mode: 'goal_mode' as const, autonomyAuthorized: true } };
      const originalCuBytes = fs.readFileSync(unit.canonicalPath);
      if (mode === 'design-owner') {
        // Another CU may have published the same local blocker ID; it cannot own this CU's declaration.
        emit({ type: 'design_authority_repair', stage: 'published', new_revision: canonical.blueprint.revision,
          checks: [{ check: 'plan:cu:design-basis', codes: [`${deriveChangeUnitFeatureId(BLUEPRINT_ID, 'other-cu')}:retained-design-declaration`] }] });
      }
      if (mode === 'design-owner-budget') {
        emit({ type: 'agent_invoke_start', phase: 'prior-budget-use', invoke_id: 'prior-use' });
        emit({ type: 'agent_invoke_end', phase: 'prior-budget-use', invoke_id: 'prior-use', status: 'passed', exit_code: 0 });
      }
      let next = await runGoalModeSessionStep(options);
      if (mode !== 'design-owner' && mode !== 'design-owner-retain') {
        assert.notEqual(next.type, 'phase_execute_request', 'cleared/human/execution/foreign owner conditions and exhausted budget must not dispatch design');
        assert.deepEqual(fs.readFileSync(unit.canonicalPath), originalCuBytes);
        const rows = fs.readFileSync(eventFile, 'utf8').trim().split('\n').map(line => JSON.parse(line) as Document);
        assert.equal(rows.filter(row => row.type === 'agent_invoke_start' && String(row.phase).startsWith('design-repair-')).length, 0);
        if (mode === 'design-owner-budget') assert(rows.some(row => row.halt_reason === 'budget_turns'));
        return;
      }
      for (const phase of ['design-repair-author', 'design-repair-questioning']) {
        assert.equal(next.type, 'phase_execute_request', JSON.stringify(next)); assert.equal(next.phase, phase);
        const requestPath = (next.request as { path: string }).path;
        const request = readSessionExecution(runDir, requestPath)!;
        if (phase === 'design-repair-author') {
          assert(request.request.context.instruction!.includes('plan:cu:design-basis') && request.request.context.instruction!.includes('retained-design-declaration'));
          assert(request.request.context.instruction!.includes(`${CU}:retained-design-declaration`), 'the repair code is scoped to canonical CU identity');
          assert(request.request.context.instruction!.includes('当前authority诊断') && request.request.context.instruction!.includes('"findings":[]'));
          assert(request.request.context.instruction!.includes('当前CU候选身份：') && request.request.context.instruction!.includes('probe 未执行或不支持'));
        }
        assert.deepEqual(fs.readFileSync(canonical.canonicalPath), originalBytes);
        assert.deepEqual(fs.readFileSync(unit.canonicalPath), originalCuBytes, 'only the owner candidate may change before Q/consumer publication');
        const actual = await adapter.onOutOfChain({ phase, prompt: request.request.context.instruction!, attempt: 1, runId });
        next = await runGoalModeSessionStep({ ...options, requestPath, report: { status: 'passed', phase,
          details: typeof actual?.details === 'string' ? actual.details : 'current owner verified the design declaration against published facts' } });
      }
      if (mode === 'design-owner-retain') {
        assert.equal(next.type, 'goal_session_result');
        assert.equal((next.result as Document).status, 'waiting');
        const revision = loadCanonicalBlueprint(host.root, BLUEPRINT_ID).blueprint.revision;
        assert(JSON.stringify(next).includes(`设计方已在rev${String(revision)}核实并保留此声明`));
        const repeated = await runGoalModeSessionStep(options);
        assert.equal(repeated.type, 'goal_session_result');
        assert(JSON.stringify(repeated).includes(`设计方已在rev${String(revision)}核实并保留此声明`));
        assert.equal(readOriginalDeliveryBudget(host.root, manifest)!.totalTurns, 2, 'retained declaration may not consume another author/questioner on reentry');
        const rows = fs.readFileSync(eventFile, 'utf8').trim().split('\n').map(line => JSON.parse(line) as Document);
        assert.equal(rows.filter(row => row.type === 'agent_invoke_start').length, 2);
        assert.equal(read(unit.canonicalPath).blockers.length, 1);
        return;
      }
      assert.equal(read(unit.canonicalPath).blockers.length, 0, 'the actual consumer publishes the owner correction');
      assert(deriveChangeUnitReadySet(host.root, BLUEPRINT_ID).units[0].ready, 'only real publication and readiness allow progression');
      assert.equal(readOriginalDeliveryBudget(host.root, manifest)!.totalTurns, 2);
      const rows = fs.readFileSync(eventFile, 'utf8').trim().split('\n').map(line => JSON.parse(line) as Document);
      assert.equal(rows.filter(row => row.type === 'design_authority_repair' && row.stage === 'published'
        && row.checks?.some((check: Document) => check.codes?.includes(`${CU}:retained-design-declaration`))).length, 1);
      return;
    }
    if (mode === 'session-retry' || mode === 'session-budget') {
      const options = { projectRoot: host.root, frameworkRoot: host.frameworkRoot, feature, runId, adapter: 'claude', runMode: 'attended',
        authorization: { mode: 'goal_mode' as const, autonomyAuthorized: true } };
      let next = await runGoalModeSessionStep(options);
      let previousQuestioning: { requestPath: string; report: { status: 'passed'; phase: string; details: string } } | undefined;
      const count = mode === 'session-retry' ? 4 : 3;
      for (let index = 0; index < count; index++) {
        assert.equal(next.type, 'phase_execute_request', JSON.stringify(next));
        assert.equal(next.phase, index % 2 ? 'design-repair-questioning' : 'design-repair-author');
        const requestPath = (next.request as { path: string }).path;
        const request = readSessionExecution(runDir, requestPath)!;
        if (index === 2) {
          assert(request.request.context.instruction!.includes('真实内容差额-1'));
          const candidate = path.join(runDir, 'design-repair/component-blueprint.yaml');
          assert.equal(read(candidate).review_summary.questioning, undefined);
          fs.appendFileSync(candidate, '\n# executor is preserving real in-progress partial work\n');
          const partial = fs.readFileSync(candidate);
          const repeated = await runGoalModeSessionStep(options);
          assert.deepEqual(repeated.request, next.request); assert.equal(repeated.deadline, next.deadline);
          assert.deepEqual(fs.readFileSync(candidate), partial, 'pending next must never replay old output over partial candidate work');
          const duplicate = await runGoalModeSessionStep({ ...options, ...previousQuestioning! });
          assert.equal(duplicate.type, 'goal_session_report_received'); assert.equal(duplicate.duplicate, true);
          assert.deepEqual(fs.readFileSync(candidate), partial, 'historical report replay must preserve the pending author candidate');
          const afterDuplicate = await runGoalModeSessionStep(options);
          assert.deepEqual(afterDuplicate.request, next.request); assert.equal(afterDuplicate.deadline, next.deadline);
          assert.deepEqual(fs.readFileSync(candidate), partial);
          assert.deepEqual(fs.readFileSync(canonical.canonicalPath), originalBytes);
        }
        const actual = await adapter.onOutOfChain({ phase: request.request.context.phase, prompt: request.request.context.instruction!, attempt: index + 1, runId });
        const report = { status: 'passed' as const, phase: request.request.context.phase,
          details: typeof actual?.details === 'string' ? actual.details : `bounded role ${index + 1} completed` };
        if (index === 1) previousQuestioning = { requestPath, report };
        next = await runGoalModeSessionStep({ ...options, requestPath, report });
      }
      const rows = fs.readFileSync(eventFile, 'utf8').trim().split('\n').map(line => JSON.parse(line) as Document);
      assert.equal(rows.filter(row => row.type === 'agent_invoke_start' && String(row.phase).startsWith('design-repair-')).length, count);
      assert.equal(readOriginalDeliveryBudget(host.root, manifest)!.totalTurns, count);
      assert.equal(rows.filter(row => row.type === 'design_authority_repair' && row.stage === 'attempted').length, 1);
      assert.equal(rows.filter(row => row.type === 'design_authority_repair' && row.stage === 'published').length, mode === 'session-retry' ? 1 : 0);
      assert(rows.some(row => row.halt_reason === 'budget_turns'), 'the original hard budget stops any new caller after the bounded evidence');
      if (mode === 'session-retry') assert(deriveDesignPreparationReadiness(host.root, BLUEPRINT_ID).ready);
      else assert.deepEqual(fs.readFileSync(canonical.canonicalPath), originalBytes);
      return;
    }
    if (recovery) {
      const options = { projectRoot: host.root, frameworkRoot: host.frameworkRoot, feature, runId, adapter: 'claude', runMode: 'attended',
        authorization: { mode: 'goal_mode' as const, autonomyAuthorized: true } };
      const reportRole = async (next: Record<string, any>): Promise<Record<string, any>> => {
        assert.equal(next.type, 'phase_execute_request', JSON.stringify(next));
        const requestPath = (next.request as { path: string }).path;
        const request = readSessionExecution(runDir, requestPath)!;
        const actual = await adapter.onOutOfChain({ phase: request.request.context.phase, prompt: request.request.context.instruction!, attempt: 1, runId });
        return runGoalModeSessionStep({ ...options, requestPath, report: { status: 'passed', phase: request.request.context.phase,
          details: typeof actual?.details === 'string' ? actual.details : 'actual role output persisted' } });
      };
      let next = await runGoalModeSessionStep(options);
      for (const label of ['design-repair-author', 'design-repair-questioning', 'design-repair-author']) {
        assert.equal(next.phase, label); next = await reportRole(next);
      }
      if (mode === 'session-progress-recovery') {
        assert.equal(next.phase, 'design-repair-questioning', 'runtime normalization makes the unchanged candidate comparable after Q');
        next = await reportRole(next);
      }
      assert.equal(next.type, 'goal_session_result');
      assert.equal(authorCalls, 2); assert.equal(questioningCalls, mode === 'session-progress-recovery' ? 2 : 1, 'both pre-Q and post-Q pauses must retain their actual role history');
      const events = () => fs.readFileSync(eventFile, 'utf8').trim().split('\n').map(line => JSON.parse(line) as Document);
      const paused = events().filter(event => event.type === 'design_authority_repair' && event.failed_step === 'no_progress_guard').at(-1)!;
      assert(paused && paused.reason.includes('第二段证据-1'));
      const [guidance, ...issueLines] = String(paused.reason).split('\n');
      assert(guidance.includes('--force-resume') && guidance.includes('--force-takeover') && guidance.includes('原预算与历史保留'));
      assert(issueLines.some(line => line.includes('第二段证据-1')) && issueLines.every(line => !line.includes('--force-resume') && !line.includes('--force-takeover')), 'full Q answers remain intact and continuation operations never enter the issue list');
      const draftFile = path.join(runDir, 'design-repair/component-blueprint.yaml');
      const retained = fs.readFileSync(draftFile);
      assert.equal(read(draftFile).review_summary.questioning.status, 'complete', 'pause restores the last actual questioning output');
      assert(events().some(event => event.halt_reason === 'no_progress_guard' && event.run_disposition === 'WAITING'));
      if (mode === 'session-progress-recovery') {
        const legacyHeader = '当前全部机器问题与独立质询否定仍相同，实际未发布设计候选无变化；暂停等待明确继续或真实条件变化，原预算保留。';
        assert.notEqual(guidance, legacyHeader);
        fs.writeFileSync(eventFile, fs.readFileSync(eventFile, 'utf8').split(guidance).join(legacyHeader));
        assert.equal(String(events().filter(event => event.type === 'design_authority_repair' && event.failed_step === 'no_progress_guard').at(-1)!.reason).split('\n')[0], legacyHeader);
      }
      const starts = events().filter(event => event.type === 'agent_invoke_start').length;
      assert.equal((await runGoalModeSessionStep(options)).type, 'goal_session_result');
      assert.equal(events().filter(event => event.type === 'agent_invoke_start').length, starts, 'ordinary public next cannot resume unchanged work');
      assert.deepEqual(fs.readFileSync(draftFile), retained);
      const repeatedPause = events().filter(event => event.type === 'design_authority_repair' && event.failed_step === 'no_progress_guard').at(-1)!;
      assert.deepEqual(String(repeatedPause.reason).split('\n').slice(1), issueLines, 'a historical guidance change cannot become a new author issue or wake unchanged work');
      paused.reason = repeatedPause.reason;
      if (mode === 'session-architecture-recovery') {
        const architecture = JSON.parse(fs.readFileSync(path.join(runDir, 'design-repair/architecture.json'), 'utf8'));
        assert(architecture.outer_layers.some((layer: Document) => layer.id === '05-Recovery'));
        assert(!JSON.parse(fs.readFileSync(path.join(host.root, 'framework.config.json'), 'utf8')).architecture.outer_layers.some((layer: Document) => layer.id === '05-Recovery'), 'the architecture is still an unpublished candidate');
        const changed = read(draftFile); changed.review_summary.summary += ' 当前实际候选增加了真实恢复说明'; write(draftFile, changed);
        next = await runGoalModeSessionStep(options);
      } else next = await runGoalModeSessionStep({ ...options, forceTakeover: true });
      assert.equal(next.type, 'phase_execute_request', JSON.stringify(next)); assert.equal(next.phase, 'design-repair-author');
      const resumed = readSessionExecution(runDir, (next.request as { path: string }).path)!;
      assert(String(resumed.request.context.instruction).includes(paused.reason), 'first resumed author receives every original machine issue and Q answer, including blank lines');
      const repeated = await runGoalModeSessionStep(options);
      assert.deepEqual(repeated.request, next.request, 'pending continuation reuses the same real author request');
      next = await reportRole(next);
      if (mode === 'session-architecture-recovery') {
        assert.equal(next.phase, 'design-repair-questioning', `real candidate progress warrants one fresh Q: ${JSON.stringify(next)}`);
        next = await reportRole(next);
        assert.equal(next.phase, 'design-repair-author');
        next = await reportRole(next);
        assert.equal(authorCalls, 4); assert.equal(questioningCalls, 2);
      } else { assert.equal(authorCalls, 3); assert.equal(questioningCalls, 2, 'explicit continue after a post-Q pause must issue a fresh author but no extra Q without design progress'); }
      assert.equal(next.type, 'goal_session_result');
      if (mode === 'session-progress-recovery') {
        const lastPause = events().filter(event => event.type === 'design_authority_repair' && event.failed_step === 'no_progress_guard').at(-1)!;
        assert.deepEqual(String(lastPause.reason).split('\n').slice(1), issueLines, 'continuation instructions stay outside the original complete problem body after recovery');
      }
      assert.deepEqual(fs.readFileSync(canonical.canonicalPath), originalBytes, 'no defective design may publish');
      assert.equal(readOriginalDeliveryBudget(host.root, manifest)!.totalTurns, authorCalls + questioningCalls, 'all actual calls remain charged to the original request');
      return;
    }
    const result = await runUnattendedDesignRepair({ projectRoot: host.root, frameworkRoot: host.frameworkRoot, feature,
      ...(!normal ? { designTarget: designRepairTarget(host.root, CU) } : {}), phase, runId, reportDir: manifest.report_dir, requirement, brief,
      signature: designRepairSignature(feature, phase, brief.items), heldFeatureLock: { path: lockPath, ownerId: lock.ownerId }, runtimeWrites: [path.relative(host.root, lockPath)], emit,
      registerLockRelease: () => {}, recordEventLines: () => {
        const lines: Array<{ file: string; line: string }> = []; recording = lines;
        return () => { recording = undefined; return lines; };
      },
      ...(!normal ? { recheckReadiness: () => {
        readinessCalls++;
        const current = deriveDesignPreparationReadiness(host.root, BLUEPRINT_ID);
        return { ready: current.ready, reason: current.ready ? '原P1/P2 readiness已通过' : JSON.stringify(current.perUnit.map(row => ({ id: row.changeUnitId, verdict: row.verdict, issues: row.issueIds }))) };
      } } : {}),
      invoke: async (purpose, prompt, guard) => {
        const replay = replayDesignRepairInvocation(runDir, purpose, undefined, undefined, guard?.afterInvokeId);
        if (replay) return replay;
        purposes.push(purpose);
        if (purpose === 'author' && authorCalls > 0) {
          assert(prompt.includes('当前范围失败恢复验收是否完整？') && prompt.includes('真实内容差额-'));
          assert(prompt.includes('view:') && prompt.includes('design-repair-questioning'));
          assert.deepEqual(fs.readFileSync(canonical.canonicalPath), originalBytes, 'no publication before final independent pass');
        }
        assert(prompt.includes(requirement), 'the real original request must reach both responsibilities');
        assert(prompt.includes(`本事务真实基线：blueprint_id=${BLUEPRINT_ID}；revision=${String(canonical.blueprint.revision)}`));
        assert(prompt.includes('待质询通过并发布最终蓝图字节后') && prompt.includes('未来hash'));
        if (purpose === 'questioning') {
          assert(prompt.includes(`当前待发布蓝图草稿revision=${Number(canonical.blueprint.revision) + 1}`));
          assert(prompt.includes('architectureChanged=false'));
          const preparedCu = read(path.join(runDir, 'design-repair/change-unit.yaml'));
          assert(prompt.includes(JSON.stringify(blueprintIdentityPointers(preparedCu), null, 2)));
          for (const ref of blueprintIdentityPointers(preparedCu)) assert.equal(ref?.revision, canonical.blueprint.revision, 'questioning must still see baseline bindings until publication');
          const preparedBlueprint = read(path.join(runDir, 'design-repair/component-blueprint.yaml'));
          const stale = (preparedBlueprint.derived_results ?? []).filter((item: Document) => item.status === 'stale');
          assert.equal(prompt.includes('框架本次派生后的stale结果'), stale.length > 0);
          if (stale.length) assert(prompt.includes(JSON.stringify(stale.map((item: Document) => ({ result_id: item.result_id, kind: item.kind, input_revision: item.input_revision, status: item.status, superseded_by_revision: item.superseded_by_revision })), null, 2)));
        }
        const label = designRepairInvokeLabel(purpose);
        const invokeId = `${label}-${purposes.length}`;
        fs.mkdirSync(path.join(runDir, 'phases', label, invokeId), { recursive: true });
        emit({ type: 'agent_invoke_start', phase: label, invoke_id: invokeId, command: 'bounded-design-adapter' });
        const draft = path.join(runDir, 'design-repair/component-blueprint.yaml');
        const beforeQuestioning = purpose === 'questioning' ? fs.readFileSync(draft) : undefined;
        const actual = await adapter.onOutOfChain({ phase: label, prompt, attempt: 1, runId });
        if (beforeQuestioning) assert(fs.readFileSync(draft).equals(beforeQuestioning), 'the independent Q returns its original JSON without editing product design');
        emit({ type: 'agent_invoke_end', phase: label, invoke_id: invokeId, exit_code: 0 });
        const outcome: DesignRepairInvokeOutcome = { started: true, ok: true, detail: 'bounded author/questioning completed its requested draft work',
          ...(purpose === 'questioning' && typeof actual?.stdout === 'string' ? { output: actual.stdout } : {}),
          preSnapshot: guard?.pre, postSnapshot: guard ? capturePhaseInvocationSnapshot(guard.resolution, guard.options) : undefined };
        recordDesignRepairInvocation(runDir, purpose, invokeId, outcome);
        return outcome;
      } });
    const rows = fs.readFileSync(eventFile, 'utf8').trim().split('\n').map(line => JSON.parse(line) as Document);
    if (mode === 'outside-write') {
      assert.equal(result.outcome, 'violation', JSON.stringify(result));
      assert.deepEqual(fs.readFileSync(canonical.canonicalPath), originalBytes);
      assert.deepEqual(purposes, ['author']);
      assert.equal(readinessCalls, 0);
      assert(result.outcome === 'violation' && result.changes.some(change => change.path === 'src/ledger/LedgerFeature.ets'));
    } else if (mode === 'exhausted' || mode === 'self-signed-retry') {
      assert.equal(result.outcome, 'failed', JSON.stringify(result));
      assert.deepEqual(fs.readFileSync(canonical.canonicalPath), originalBytes);
      assert.equal(rows.filter(row => row.type === 'design_authority_repair' && row.stage === 'attempted').length, 1);
      assert(!rows.some(row => row.type === 'design_authority_repair' && row.stage === 'published'));
      if (mode === 'exhausted') {
        assert.equal(authorCalls, 5);
        assert(result.outcome === 'failed' && result.step === 'no_progress_guard');
        assert.equal(questioningCalls, authorCalls - 1);
        assert(result.reason.includes(`真实内容差额-${questioningCalls}\n\n当前独立核实的第二段证据-${questioningCalls}`));
      } else { assert.equal(authorCalls, 2); assert.equal(questioningCalls, 1); assert(result.reason.includes('自报')); }
    } else {
      assert.equal(result.outcome, 'published', JSON.stringify(result));
      assert(result.outcome === 'published');
      assert.equal(result.recovered, mode !== 'readiness-blocked', JSON.stringify(result));
      assert.deepEqual(purposes, mode === 'retry' ? ['author', 'questioning', 'author', 'questioning'] : ['author', 'questioning']);
      assert.equal(rows.filter(row => row.type === 'design_authority_repair' && row.stage === 'attempted').length, 1);
      assert.equal(rows.filter(row => row.type === 'design_authority_repair' && row.stage === 'published').length, 1);
      assert.equal(readinessCalls, normal ? 0 : 1);
      assert.equal(result.revision, Number(canonical.blueprint.revision) + 1);
      const published = loadCanonicalBlueprint(host.root, BLUEPRINT_ID);
      const rebound = loadCanonicalChangeUnit(host.root, BLUEPRINT_ID, 'ledger-refresh');
      assert.equal((rebound.changeUnit.component_blueprint_ref as Document).artifact_sha256, published.artifactSha256);
      assert(rows.some(row => row.type === 'design_authority_repair' && row.stage === 'published' && row.outcome === (mode === 'readiness-blocked' ? 'unrecovered' : 'recovered')));
      if (mode === 'readiness-blocked') assert.equal(result.step, 'probe');
      else assert(deriveDesignPreparationReadiness(host.root, BLUEPRINT_ID).ready);
      assert(fs.existsSync(headlessLedgerPath(host.root, feature, phase)), 'audit must stay on the real run carrier');
    }
    assert(adapter.log.lockedDuringAuthor?.attemptedBeforeInvoke);
    if (!normal) {
      assertNoChildRun(host);
      const actual = JSON.parse(fs.readFileSync(path.join(runDir, 'manifest.json'), 'utf8'));
      assert(actual.initial_design && !actual.execution_scope && !actual.run_base_sha);
    }
  } finally {
    preparation.reconcileHeldBlueprintRefs = realReconcile;
    releaseLock(lockPath, lock.ownerId);
  }
}

const cases = [
  { name: 'f3b8e6a1 initial repair: real root repairs an admitted blueprint CU and reaches real readiness without a construction child', mode: 'root' },
  { name: 'f3b8e6a1 initial repair: root author writes outside its draft and the existing publication guard rejects it', mode: 'outside-write' },
  { name: 'f3b8e6a1 initial repair: actual readiness failure after publication remains unrecovered for an initial-design phase', mode: 'readiness-blocked' },
  { name: 'f3b8e6a1 initial repair: normal canonical run retains its default design subject and original recovery probe', mode: 'normal' },
  { name: '9f6c2e41 bounded process repair sends full denial to A2 and publishes once after four calls', mode: 'retry' },
  { name: 'd18f6c42 progressing drafts continue beyond three calls then identical full issues and content pause', mode: 'exhausted' },
  { name: 'd18f6c42 M2 M4 public post-Q pause blocks next and forced continuation delivers complete feedback to a fresh author', mode: 'session-progress-recovery' },
  { name: 'd18f6c42 M3 M4 unpublished new architecture layer stays paused until real candidate progress and retains full feedback', mode: 'session-architecture-recovery' },
  { name: '9f6c2e41 bounded second author cannot self-sign questioning against its real input', mode: 'self-signed-retry' },
  { name: '9f6c2e41 bounded session replay preserves pending partial work and never reuses A1 or Q1', mode: 'session-retry' },
  { name: '9f6c2e41 bounded session total budget stops before a new questioning call', mode: 'session-budget' },
  { name: '9f6c2e41 design owner receives active declaration even when authority findings are empty', mode: 'design-owner' },
  { name: '9f6c2e41 design owner does not receive cleared human device or other-owner conditions', mode: 'design-owner-external' },
  { name: '9f6c2e41 design owner cannot dispatch after the original total budget is exhausted', mode: 'design-owner-budget' },
  { name: '9f6c2e41 retained design declaration waits at its published revision without another call', mode: 'design-owner-retain' },
] as const;

async function candidateWriteContract(): Promise<void> {
  for (const mode of ['cu', 'blueprint', 'legacy', 'canonical', 'other-cu', 'product'] as const) {
    const host = fixture();
    let release: (() => void) | null = null;
    try {
      fs.writeFileSync(path.join(host.root, 'framework.config.json'), JSON.stringify({ schema_version: '1.0', project_name: 'CandidateContract',
        project_profile: { name: 'hmos-app' }, active_workflow: 'obligation-driven', features_dir: 'doc/features', architecture: {} }));
      clearFrameworkConfigCache();
      const blueprint = loadCanonicalBlueprint(host.root, 'ledger-app-blueprint');
      const current = loadCanonicalChangeUnit(host.root, 'ledger-app-blueprint', 'ledger-refresh');
      const hasCu = !['blueprint', 'legacy'].includes(mode);
      if (hasCu) {
        const changed: Document = YAML.parse(fs.readFileSync(current.canonicalPath, 'utf8'));
        changed.blockers = [{ blocker_id: 'missing-module-owner-nodes', gate: 'design', owner: 'component-design', observation: 'machine',
          reason: '设计候选缺少当前模块归属', unlock_condition: '由原设计owner补齐并重签', source_refs: ['doc/requirement.md'],
          probe: { kind: 'contract', ref: 'doc/requirement.md', expected: '当前设计归属已闭合' } }];
        changed.blockers.push({ ...changed.blockers[0], blocker_id: 'execution-only-item', gate: 'execution' },
          { ...changed.blockers[0], blocker_id: 'different-owner-item', owner: 'external-design' });
        fs.writeFileSync(current.canonicalPath, YAML.stringify(changed));
      }
      const product = path.join(host.root, 'guarded-product.ts');
      fs.writeFileSync(product, 'export const preserved = true;\n');
      const targetFeature = hasCu ? deriveChangeUnitFeatureId('ledger-app-blueprint', 'ledger-refresh') : 'ledger-app-blueprint';
      const manifest = buildInitialDesignGoalManifest({ feature: 'ledger-app-blueprint', run_id: `candidate-${mode}`, adapter: 'claude', requirement,
        initial_design: { completion_target: 'feature', requested_results: [requirement], requested_phases: [] },
        budget: { max_total_turns: 30, wall_clock_minutes: 120 }, unattended: { write_mode: 'full-access', approval_mode: 'never', timeout_seconds: 900 } }, { projectRoot: host.root });
      const born = createGoalRun({ projectRoot: host.root, manifest, chain: [] });
      const runDir = path.dirname(born.manifestPath);
      const blueprintBytes = fs.readFileSync(blueprint.canonicalPath);
      const cuBytes = fs.readFileSync(current.canonicalPath);
      if (mode === 'cu') {
        const wrongBlueprint: Document = YAML.parse(cuBytes.toString('utf8'));
        wrongBlueprint.blueprint_id = 'wrong-blueprint';
        assert(validateChangeUnit(wrongBlueprint, { projectRoot: host.root, canonicalPath: current.canonicalPath }).some(issue => issue.severity === 'BLOCKER'));
        const wrongTarget: Document = YAML.parse(cuBytes.toString('utf8'));
        wrongTarget.design_refs[0].target.id = 'missing-real-target';
        assert(validateChangeUnitDesign(host.root, wrongTarget).issues.some(issue => issue.severity === 'BLOCKER'));
        const badContent: Document = YAML.parse(cuBytes.toString('utf8'));
        badContent.target_predicates[0].verification_refs = ['acceptance:AC-999999'];
        fs.writeFileSync(current.canonicalPath, YAML.stringify(badContent));
        assert(diagnoseBlueprintSkillAuthority(host.root, path.resolve(__dirname, '../../..'), targetFeature).findings.some(item => item.codes.includes('authority_predicate_acceptance_unmapped')));
        fs.writeFileSync(current.canonicalPath, cuBytes);
        const badGraph: Document = structuredClone(blueprint.blueprint);
        badGraph.generated_graphs = [{ graph_id: 'bad-relation-graph', format: 'mermaid', source_view_id: 'logical', content: 'flowchart LR\n missing --> absent',
          node_refs: ['view:logical/node:missing'], relation_refs: ['relation:missing'] }];
        assert(inspectGeneratedBlueprintGraphs(badGraph).issues.some(issue => issue.severity === 'BLOCKER'), 'real declared relation-graph errors stay blocking');
      }
      const brief: DesignRepairBriefLike = { class: 'B2', items: [] };
      let recording: Array<{ file: string; line: string }> | undefined;
      const emit = (event: Record<string, unknown>) => {
        const line = JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n';
        fs.appendFileSync(born.eventsPath, line); recording?.push({ file: born.eventsPath, line });
      };
      const result = await runUnattendedDesignRepair({ projectRoot: host.root, frameworkRoot: path.resolve(__dirname, '../../..'),
        feature: manifest.feature, designTarget: designRepairTarget(host.root, targetFeature), phase: 'initial-design', runId: manifest.run_id,
        reportDir: manifest.report_dir, ...(mode === 'legacy' ? {} : { requirement }), brief,
        signature: designRepairSignature(targetFeature, 'initial-design', brief.items), heldFeatureLock: null, runtimeWrites: [manifest.report_dir], emit,
        registerLockRelease: value => { release = value; }, recordEventLines: () => { const lines: Array<{ file: string; line: string }> = []; recording = lines; return () => { recording = undefined; return lines; }; },
        invoke: async (_purpose, prompt) => {
          const draftDir = path.join(runDir, 'design-repair');
          const expected = [path.join(draftDir, 'component-blueprint.yaml'), ...(hasCu ? [path.join(draftDir, 'change-unit.yaml')] : []),
            ...(mode === 'legacy' ? [] : [path.join(draftDir, 'architecture.json')])];
          const list = prompt.split('本次唯一可写候选集合')[1].split('canonical 蓝图')[0];
          assert.deepEqual(list.split('\n').filter(line => line.startsWith('- ')).map(line => line.slice(2)), expected);
          for (const file of expected) assert(fs.existsSync(file), 'every advertised candidate must be prepared by the transaction');
          assert(prompt.includes('canonical Change Unit') && prompt.includes('机器运行记录均只读'));
          assert(prompt.includes(`本事务真实基线：blueprint_id=ledger-app-blueprint；revision=${String(blueprint.blueprint.revision)}`));
          assert(prompt.includes(blueprint.artifactSha256) && prompt.includes('不豁免错蓝图、错目标') && prompt.includes('实际内容缺陷'));
          assert.equal(prompt.includes('待质询通过并发布最终蓝图字节后'), hasCu);
          assert(!prompt.includes('除草稿文件外') && !prompt.includes('同时可修改同目录'));
          if (hasCu) {
            assert(prompt.includes('当前CU候选身份：ledger-app-blueprint/ledger-refresh') && prompt.includes('missing-module-owner-nodes'));
            assert(prompt.includes('probe 未执行或不支持；fail-closed 保持 active') && prompt.includes('"active": true'));
            assert(!prompt.includes('execution-only-item') && !prompt.includes('different-owner-item'));
            assert(prompt.includes('可在当前候选中有据修正或移除过时设计阻断') && prompt.includes('不能伪造探针成功、添加active/resolved字段冒充机器结果'));
          }
          assert.deepEqual(fs.readFileSync(blueprint.canonicalPath), blueprintBytes);
          assert.deepEqual(fs.readFileSync(current.canonicalPath), cuBytes);
          if (mode === 'canonical') fs.appendFileSync(current.canonicalPath, '\n# unauthorized canonical CU write\n');
          if (mode === 'other-cu') {
            const other = path.join(path.dirname(path.dirname(current.canonicalPath)), 'foreign-cu/change-unit.yaml');
            fs.mkdirSync(path.dirname(other), { recursive: true }); fs.writeFileSync(other, 'unauthorized: true\n');
          }
          if (mode === 'product') fs.appendFileSync(product, '// unauthorized product write\n');
          return { started: true, ok: false, status: 'waiting', detail: 'Bounded contract observation; no model or publication.' };
        },
      });
      assert.equal(result.outcome, ['canonical', 'other-cu', 'product'].includes(mode) ? 'violation' : 'waiting', JSON.stringify(result));
      const instructions = renderQuestioningResultInstructions(blueprint.blueprint, 'independent');
      assert(instructions.some(line => line.includes(DISPOSITIONS.join(' / '))));
      const questionDoc: Document = structuredClone(blueprint.blueprint);
      const items = questionDoc.review_summary.questioning.items;
      for (const disposition of [...DISPOSITIONS, 'open']) {
        items[0].disposition = disposition;
        const errors = validateBlueprintQuestioning(questionDoc).filter(issue => issue.id === 'blueprint_questioning_disposition_invalid' && issue.path === '$.review_summary.questioning.items[0].disposition');
        assert.equal(errors.length > 0, disposition === 'open');
      }
    } finally {
      if (release) (release as () => void)();
      clearFrameworkConfigCache();
      const directory = fs.realpathSync(host.root);
      assert(directory.startsWith(fs.realpathSync(os.tmpdir()) + path.sep));
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
}

function roleCacheWindows(): void {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'repair-role-window-')));
  const draftDir = path.join(directory, 'design-repair');
  const eventsFile = path.join(directory, 'events.jsonl');
  fs.mkdirSync(draftDir);
  fs.writeFileSync(eventsFile, JSON.stringify({ type: 'design_authority_repair', stage: 'attempted' }) + '\n');
  const add = (purpose: 'author' | 'questioning', id: string, waiting = false) => {
    const phase = designRepairInvokeLabel(purpose);
    const append = (value: Document) => fs.appendFileSync(eventsFile, JSON.stringify(value) + '\n');
    append({ type: 'agent_invoke_start', phase, invoke_id: id });
    fs.mkdirSync(path.join(directory, 'phases', phase, id), { recursive: true });
    write(path.join(draftDir, 'component-blueprint.yaml'), { transport_marker: id });
    append({ type: 'agent_invoke_end', phase, invoke_id: id, exit_code: 0, status: waiting ? 'waiting' : 'passed' });
    recordDesignRepairInvocation(directory, purpose, id, { started: true, ok: !waiting, status: waiting ? 'waiting' : 'passed', detail: id });
  };
  try {
    add('author', 'A1'); add('questioning', 'Q1'); add('author', 'A2-waiting', true); add('author', 'A2-prime'); add('questioning', 'Q2');
    for (const [purpose, after, expected] of [['author', null, 'A1'], ['questioning', 'A1', 'Q1'], ['author', 'Q1', 'A2-prime'], ['questioning', 'A2-prime', 'Q2']] as const) {
      assert.equal(replayDesignRepairInvocation(directory, purpose, undefined, undefined, after)?.detail, expected);
      assert.equal(read(path.join(draftDir, 'component-blueprint.yaml')).transport_marker, expected);
    }
    assert.equal(fs.readFileSync(eventsFile, 'utf8').trim().split('\n').map(line => JSON.parse(line)).filter(row => row.type === 'agent_invoke_start').length, 5);
  } finally {
    assert(directory.startsWith(fs.realpathSync(os.tmpdir()) + path.sep));
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function actualWorkComparison(): void {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'design-work-')));
  try {
    const files = ['blueprint.yaml', 'cu.yaml', 'architecture.json', 'absent.yaml'].map(name => path.join(directory, name));
    const blueprint: Document = { artifact: 'component-blueprint@1', revision: 1, provenance: { observed_at: 'old' },
      review_summary: { admission: { status: 'blocker' }, questioning: { status: 'complete' } },
      design_views: [{ view_id: 'runtime', nodes: [{ id: 'business', revision: 1, provenance: { observed_at: 'business' } }] }] };
    const cu: Document = { artifact: 'change-unit@1', revision: 1, provenance: { observed_at: 'old' }, component_blueprint_ref: { blueprint_id: 'bp', revision: 1 }, design_refs: [], touches: [], goal: 'first' };
    write(files[0], blueprint); write(files[1], cu); write(files[2], { modules: ['one'] });
    const { designWorkSnapshot, designWorkHasNoProgress } = require('../../scripts/utils/design-repair-unattended') as typeof import('../../scripts/utils/design-repair-unattended');
    const before = designWorkSnapshot(files);
    blueprint.revision++; blueprint.provenance.observed_at = 'new'; blueprint.review_summary.admission.status = 'pass'; blueprint.review_summary.questioning.status = 'incomplete';
    cu.revision++; cu.provenance.observed_at = 'new'; cu.component_blueprint_ref.revision++;
    write(files[0], blueprint); write(files[1], cu);
    assert(designWorkHasNoProgress(['machine', 'denial'], ['denial', 'machine'], before, designWorkSnapshot(files)), 'metadata alone cannot become business progress');
    cu.goal = 'second'; write(files[1], cu);
    assert(!designWorkHasNoProgress(['same'], ['same'], before, designWorkSnapshot(files)), 'CU-only unpublished progress is real');
    const questioningBefore = designWorkSnapshot(files, {}, true);
    blueprint.review_summary.questioning.items = [{ question_id: 'one', answer: 'real new evidence' }]; write(files[0], blueprint);
    assert(!designWorkHasNoProgress(['same'], ['same'], questioningBefore, designWorkSnapshot(files, {}, true)), 'questioning compares its actual result rather than requiring design edits');
    const cuChanged = designWorkSnapshot(files);
    blueprint.design_views[0].nodes[0].revision++; write(files[0], blueprint);
    assert(!designWorkHasNoProgress(['same'], ['same'], cuChanged, designWorkSnapshot(files)), 'nested business keys are retained');
    assert(!designWorkHasNoProgress(['old'], ['new'], before, before), 'all current problems participate in the signature');
    assert(!designWorkHasNoProgress(['same'], ['same'], undefined, before), 'no baseline is unknown');
    assert.equal(before[files[3]].exists, false, 'a missing file is a known absence');
    const unreadable = designWorkSnapshot([...files, directory]);
    assert(!designWorkHasNoProgress(['same'], ['same'], unreadable, unreadable), 'failed reads must not prove no progress');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

function machineAdmissionCompatibility(): void {
  const { currentBlueprintSliceId, deriveBlueprintAdmission } = require('../../scripts/utils/blueprint-admission') as typeof import('../../scripts/utils/blueprint-admission');
  const { writeBackAdmission } = require('../../scripts/utils/design-repair-unattended') as typeof import('../../scripts/utils/design-repair-unattended');
  const base: Document = { artifact: 'component-blueprint@1', blueprint_id: 'legacy', contracts: [{}], decisions_and_gaps: { gaps: [] }, review_summary: { questioning: { status: 'complete' } } };
  assert.equal(currentBlueprintSliceId(base), 'legacy:current');
  const withGap = structuredClone(base);
  withGap.decisions_and_gaps.gaps = [{ gap_id: 'real-gap', status: 'blocker', needed_by: 'old-current', owner: 'design', unlock_condition: 'resolve the real dependency' }];
  const declaredGap = structuredClone(withGap.decisions_and_gaps.gaps[0]);
  writeBackAdmission(withGap, { projectRoot: os.tmpdir(), canonicalPath: path.join(os.tmpdir(), 'not-canonical.yaml') });
  assert.equal(withGap.review_summary.admission.current_slice.slice_id, 'legacy:current');
  assert.equal(withGap.decisions_and_gaps.gaps[0].needed_by, 'old-current');
  assert.equal(withGap.review_summary.questioning, undefined, 'legacy gap association requires fresh independent questioning');
  assert.equal(withGap.review_summary.admission.root_questions_complete, false, 'the old result cannot authorize the new association');
  assert.deepEqual(withGap.decisions_and_gaps.gaps[0], declaredGap, 'migration does not wash the declared blocker');
  withGap.review_summary.admission.current_slice.slice_id = 'original-number';
  assert.equal(currentBlueprintSliceId(withGap), 'original-number', 'existing associations keep their original ID');
  assert.equal(deriveBlueprintAdmission(withGap).status, 'pass', 'an explicitly future non-asset gap on an existing ID retains the old admission semantics');
}

export function getCases() { return [...cases.map(test => ({ name: test.name, run: () => withFreshCuHost(host => scenario(host, test.mode)) })),
  { name: '9f6c2e41 repair candidate sets use actual transaction authority and reject canonical foreign CU and product writes', run: candidateWriteContract },
  { name: 'd18f6c42 machine admission preserves old IDs and real gaps while requiring fresh questioning', run: machineAdmissionCompatibility },
  { name: 'd18f6c42 actual candidate comparison covers metadata CU-only nested business fields and unknown baselines', run: actualWorkComparison },
  { name: '9f6c2e41 role cache has both bounds and selects the latest start after waiting', run: roleCacheWindows }]; }
export async function runSelectedCases(filter?: string) {
  const results: UnitCaseResult[] = [], timings: UnitExecutionTiming[] = [];
  for (const test of getCases()) {
    if (!matchesUnitCase(test.name, filter)) continue;
    const finish = startCaseTiming([test.name], timings);
    try { await test.run(); results.push({ name: test.name, ok: true }); }
    catch (error) { results.push({ name: test.name, ok: false, error: (error as Error).stack ?? String(error) }); }
    finally { finish(); }
  }
  return selectedUnitCases(results, filter, timings);
}
export async function runAll() { return (await runSelectedCases()).results; }
