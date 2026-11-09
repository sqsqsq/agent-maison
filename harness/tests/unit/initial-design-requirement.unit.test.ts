import '../utils/transpile-only-env';
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { createHash } from 'crypto';
import { clearFrameworkConfigCache } from '../../config';
import { prepareGoalModeRun, runGoalModeSessionStep as runGoalModeSessionStepUnchecked } from '../../scripts/goal-mode-entry';
import { buildInitialDesignGoalManifest, isInitialDesignManifest } from '../../scripts/utils/goal-manifest';
import { createGoalRun } from '../../scripts/utils/goal-run-creation';
import { currentOriginalDelivery, readOriginalDeliveryActivity } from '../../scripts/utils/delivery-origin';
import { enumerateCanonicalChangeUnits, asChangeUnitArtifact } from '../../scripts/utils/change-unit-path';
import { loadCanonicalBlueprint } from '../../scripts/utils/component-blueprint-path';
import { blueprintIdentityPointers, currentBlueprintIdentity } from '../../scripts/utils/change-unit-blueprint-identity';
import { acceptChangeUnitDecomposition } from '../../scripts/utils/change-unit-design-preparation';
import { readInitialDesignDelivery } from '../../scripts/utils/initial-design-delivery';
import { prepareBlueprintSourceItems } from '../../scripts/utils/blueprint-discovery';
import { BLUEPRINT_ID, withFreshCuHost } from './lifecycle-evolution.unit.test';
import { matchesUnitCase, selectedUnitCases, startCaseTiming, type UnitExecutionTiming } from '../utils/unit-case-selection';
import type { UnitCaseResult } from '../run-unit';
import { reportFixtureQuestioning, seedLedgerQuestioningInput } from '../utils/initial-questioning-fixture';
import { withRuntimeTest, type RuntimeTestControl } from '../utils/runtime-test-control';
const runGoalModeSessionStep = (options: Parameters<typeof runGoalModeSessionStepUnchecked>[0], testControl: RuntimeTestControl = {}) =>
  withRuntimeTest({ root: options.projectRoot, ...testControl }, () => runGoalModeSessionStepUnchecked(options));


type Json = Record<string, any>;
type Scenario = 'completed' | 'unfinished' | 'source' | 'pre-decomposition';
const authorization = { mode: 'goal_mode' as const, autonomyAuthorized: true };
const originalRequirement = '交付账目刷新与恢复。';
const increment = '新增要求：本地账目金额格式必须保持两位小数，并有对应验收。';

async function scenario(mode: Scenario): Promise<void> {
  await withFreshCuHost(async host => {
    seedLedgerQuestioningInput(host.root);
    const initialUnits = enumerateCanonicalChangeUnits(host.root, BLUEPRINT_ID);
    const proposals = initialUnits.map(unit => ({ providerId: String(unit.changeUnit.provenance && (unit.changeUnit.provenance as Json).extraction_method),
      artifact: structuredClone(asChangeUnitArtifact(unit.changeUnit)) }));
    if (mode === 'pre-decomposition') for (const unit of initialUnits) fs.unlinkSync(unit.canonicalPath);
    const configFile = path.join(host.root, 'framework.config.json');
    const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    config.project_profile.name = 'hmos-app';
    fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
    clearFrameworkConfigCache();
    const source = path.join(host.root, 'doc/requirement.md');
    fs.writeFileSync(source, originalRequirement);
    const old = buildInitialDesignGoalManifest({ feature: BLUEPRINT_ID, run_id: 'original-request', adapter: 'claude', requirement: originalRequirement,
      ...(mode === 'source' ? { requirement_source_files: ['doc/requirement.md'] } : {}),
      budget: { max_total_turns: 20, wall_clock_minutes: 120 }, unattended: { write_mode: 'full-access', approval_mode: 'never', timeout_seconds: 900 },
      initial_design: { completion_target: 'feature', requested_results: [originalRequirement], requested_phases: ['plan', 'coding', 'review', 'ut'] } }, { projectRoot: host.root });
    const created = createGoalRun({ projectRoot: host.root, manifest: old, chain: [] });
    // This fixture supplies prior control history, not a claimed product/P3 acceptance.
    // The assertion is that no previous completion can cover this new request.
    const at = new Date(Date.now() - 600_000).toISOString();
    for (const event of [{ type: 'run_start', session_started_at: at },
      { type: 'agent_invoke_start', phase: 'initial-design-author', invoke_id: 'prior-author' },
      { type: 'agent_invoke_end', phase: 'initial-design-author', invoke_id: 'prior-author', exit_code: 0 },
      { type: 'run_end', status: mode === 'completed' ? 'COMPLETED' : 'HALTED', halt_reason: 'execution_scope_unresolved' }]) {
      fs.appendFileSync(created.eventsPath, JSON.stringify({ ...event, ts: at, run_id: old.run_id }) + '\n');
    }
    const oldManifest = fs.readFileSync(created.manifestPath);
    const oldEvents = fs.readFileSync(created.eventsPath);
    const oldUnits = enumerateCanonicalChangeUnits(host.root, BLUEPRINT_ID).map(unit => ({ path: unit.canonicalPath, bytes: fs.readFileSync(unit.canonicalPath) }));
    if (mode === 'source') fs.writeFileSync(source, `${originalRequirement}\n${increment}`);
    const requirement = mode === 'source' ? fs.readFileSync(source, 'utf8') : increment;
    const prepared = prepareGoalModeRun({ projectRoot: host.root, frameworkRoot: host.frameworkRoot, feature: BLUEPRINT_ID, runId: `request-${mode}`,
      adapter: 'claude', requirement, ...(mode === 'source' ? { requirementSourceFiles: ['doc/requirement.md'] } : {}),
      budget: { max_total_turns: 20, wall_clock_minutes: 120 } });
    assert(isInitialDesignManifest(prepared.manifest));
    assert.notEqual(prepared.manifest.run_id, old.run_id);
    assert.equal(prepared.manifest.successor_of, old.run_id);
    assert(prepared.manifest.requirement!.includes(originalRequirement));
    assert(prepared.manifest.requirement!.includes(increment));
    const rows: Json[] = fs.readFileSync(path.join(prepared.runDir, 'events.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    const audit = rows.find(row => row.type === 'supersede');
    assert(audit && audit.target_run_id === old.run_id);
    assert.equal(audit.delivery_cycle_boundary, mode === 'completed' ? old.run_id : undefined);
    assert.equal(readOriginalDeliveryActivity(host.root, prepared.manifest)!.calls, mode === 'completed' ? 0 : 1);
    const options = { projectRoot: host.root, frameworkRoot: host.frameworkRoot, feature: BLUEPRINT_ID,
      runId: prepared.manifest.run_id, adapter: 'claude', runMode: 'attended', authorization };
    let next = await runGoalModeSessionStep(options) as Json, questions = 0;
    if (next.phase === 'design-repair-questioning') {
      const first = JSON.parse(fs.readFileSync(next.request.path, 'utf8'));
      assert(first.context.instruction.includes(increment), 'the independent role must receive the full new substantive request');
      next = await reportFixtureQuestioning(options, next, prepared.runDir, path.join(prepared.runDir, 'design-repair/component-blueprint.yaml'), questioning => {
        Object.assign((questioning.items as Json[])[0], { disposition: 'blocker', question: '新增金额格式要求是否有对应设计及验收？', answer: `原设计尚未覆盖本次完整增量：${increment}` });
      }) as Json;
      questions++;
    }
    assert.equal(next.type, 'phase_execute_request', JSON.stringify(next));
    assert.equal(next.phase, 'design-repair-author', 'a real current independent denial must reach the original design author');
    const request: Json = JSON.parse(fs.readFileSync(next.request.path, 'utf8'));
    assert(request.context.instruction.includes(increment));
    if (questions) assert(request.context.instruction.includes('原设计尚未覆盖本次完整增量'), 'the actual denial must remain in author feedback');
    assert(request.context.instruction.includes(originalRequirement), 'the author must retain the original request as well as the complete increment');
    if (mode === 'source') {
      assert.deepEqual(prepared.manifest.requirement_source_files, ['doc/requirement.md']);
      const actualSource = request.pre_snapshot.entries.find((entry: Json) => entry.path === 'doc/requirement.md');
      assert.equal(actualSource?.sha256, createHash('sha256').update(fs.readFileSync(source)).digest('hex'), 'the actual request must bind the changed source bytes, rather than old coverage');
    }
    const cuDraft = path.join(prepared.runDir, 'design-repair/change-unit.yaml');
    assert(!fs.existsSync(cuDraft), `a blueprint-level request must not invent a CU target: ${JSON.stringify({ phase: next.phase,
      candidate: fs.existsSync(cuDraft) ? fs.readFileSync(cuDraft, 'utf8') : undefined,
      repairs: fs.readFileSync(path.join(prepared.runDir, 'events.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line)).filter(row => row.type === 'design_authority_repair') })}`);
    assert(!('execution_scope' in prepared.manifest));
    if (mode === 'pre-decomposition') {
      const draft = path.join(prepared.runDir, 'design-repair/component-blueprint.yaml');
      const blueprint = YAML.parse(fs.readFileSync(draft, 'utf8')) as Json;
      const view = blueprint.design_views.find((row: Json) => row.nodes?.some((node: Json) => node.acceptance?.criteria?.length));
      const anchor = view.nodes.find((node: Json) => node.acceptance?.criteria?.length);
      anchor.acceptance.criteria.push({ ...structuredClone(anchor.acceptance.criteria[0]), id: 'AC-INCREMENT',
        description: '金额格式保持两位小数', expected_result: '金额12显示12.00', verification_steps: ['输入金额12', '检查金额字符串为12.00'] });
      const sourceRef = path.relative(host.root, path.join(prepared.runDir, 'manifest.json')).replace(/\\/g, '/') + '#requirement';
      const additions = prepareBlueprintSourceItems(host.root, [sourceRef], new Date().toISOString());
      for (const item of additions) if (!blueprint.discovery.inputs.current_scope_items.some((row: Json) => row.item_id === item.item_id)) {
        blueprint.discovery.inputs.current_scope_items.push(item);
        blueprint.discovery.requirement_traceability.push({ item_id: item.item_id, blueprint_refs: [`view:${view.view_id}/node:${anchor.node_id}`] });
      }
      fs.writeFileSync(draft, YAML.stringify(blueprint));
      const question = await runGoalModeSessionStep({ ...options, requestPath: next.request.path,
        report: { status: 'passed', phase: next.phase, details: '新增要求已进入当前设计与验收，尚未拆分CU。' } }) as Json;
      assert.equal(question.phase, 'design-repair-questioning', 'zero-CU repair must reach independent review');
      await reportFixtureQuestioning(options, question, prepared.runDir, draft, (reply, current) => {
        assert(JSON.stringify(current).includes('AC-INCREMENT'), 'Q reads the actual new acceptance');
        for (const item of reply.items as Json[]) { item.disposition = 'answered_with_evidence'; item.answer = '已读取当前草稿的AC-INCREMENT、两位小数要求及其需求追溯，覆盖本次原请求增量。'; }
      });
      const after = fs.readFileSync(path.join(prepared.runDir, 'events.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
      assert(after.some(row => row.type === 'design_authority_repair' && row.stage === 'published'), 'the repair must publish before the first decomposition');
      assert.equal(enumerateCanonicalChangeUnits(host.root, BLUEPRINT_ID).length, 0);
      const observed = readInitialDesignDelivery({ projectRoot: host.root, frameworkRoot: host.frameworkRoot, manifest: prepared.manifest,
        providerState: 'available', questioningCurrent: true });
      assert.equal(observed.kind, 'decompose', JSON.stringify(observed.issues));
      const identity = currentBlueprintIdentity(loadCanonicalBlueprint(host.root, BLUEPRINT_ID));
      for (const candidate of proposals) for (const ref of blueprintIdentityPointers(candidate.artifact as unknown as Json)) Object.assign(ref!, identity);
      const roots = proposals.map(candidate => ({ ...candidate, artifact: { ...candidate.artifact,
        design_refs: candidate.artifact.design_refs.filter(ref => !['relation', 'decision', 'contract'].includes(ref.target.kind)) } }));
      assert.throws(() => acceptChangeUnitDecomposition(host.root, BLUEPRINT_ID, roots), /change_unit_design_closure_incomplete/);
      assert.equal(enumerateCanonicalChangeUnits(host.root, BLUEPRINT_ID).length, 0);
      assert.equal(acceptChangeUnitDecomposition(host.root, BLUEPRINT_ID, proposals).accepted.length, proposals.length);
      assert.deepEqual(fs.readFileSync(created.manifestPath), oldManifest); assert.deepEqual(fs.readFileSync(created.eventsPath), oldEvents);
      return;
    }
    const expectedTurns = (mode === 'completed' ? 1 : 2) + questions;
    assert.equal(readOriginalDeliveryActivity(host.root, prepared.manifest)!.calls, expectedTurns);
    assert.equal(currentOriginalDelivery(host.root, old).run_id, mode === 'completed' ? old.run_id : prepared.manifest.run_id);
    const repeated = prepareGoalModeRun({ projectRoot: host.root, frameworkRoot: host.frameworkRoot, feature: BLUEPRINT_ID,
      adapter: 'claude', requirement, ...(mode === 'source' ? { requirementSourceFiles: ['doc/requirement.md'] } : {}) });
    assert.equal(repeated.manifest.run_id, prepared.manifest.run_id);
    if (mode === 'unfinished') {
      const pendingBytes = fs.readFileSync(next.request.path);
      const runEvents = fs.readFileSync(path.join(prepared.runDir, 'events.jsonl'));
      assert.throws(() => prepareGoalModeRun({ projectRoot: host.root, frameworkRoot: host.frameworkRoot, feature: BLUEPRINT_ID,
        adapter: 'claude', requirement: '用户再次替换目标：先处理金额格式并保留原有恢复义务。' }), /尚未报告的签发窗口[\s\S]*--report-result/);
      assert.deepEqual(fs.readFileSync(next.request.path), pendingBytes);
      assert.deepEqual(fs.readFileSync(path.join(prepared.runDir, 'events.jsonl')), runEvents);
      assert.equal(readOriginalDeliveryActivity(host.root, prepared.manifest)!.calls, expectedTurns);
    }
    assert.deepEqual(fs.readFileSync(created.manifestPath), oldManifest);
    assert.deepEqual(fs.readFileSync(created.eventsPath), oldEvents);
    for (const unit of oldUnits) assert.deepEqual(fs.readFileSync(unit.path), unit.bytes);
  });
}

const cases = [
  { name: 'design ownership: zero-CU successor publishes requirement repair before decomposition enforces explicit ownership', mode: 'pre-decomposition' },
  { name: 'f3b8e6a1 requirement: completed original starts a new cycle and dispatches real blueprint design for inline work', mode: 'completed' },
  { name: 'f3b8e6a1 requirement: unfinished original correction preserves its calls and uses the union request path', mode: 'unfinished' },
  { name: 'f3b8e6a1 requirement: same source path with changed bytes still dispatches design rather than borrowing old coverage', mode: 'source' },
] as const;
export function getCases() { return cases.map(test => ({ name: test.name, run: () => scenario(test.mode) })); }
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
export const runAll = async () => (await runSelectedCases()).results;
