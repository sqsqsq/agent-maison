import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { provisionRealChainProject, scaffoldRealChainHost, git } from '../utils/real-chain-host';
import { seedCuBoundHost, CU_REQUIREMENT, writeCuPlanMaterials, writeCuSpecMaterials, writeCuCodingMaterials, writeCuReviewMaterials, writeCuUtMaterials, writeCuFacts, publishVerifier } from './real-chain.unit.test';
import { runGoalRuntimeChain, requestVia } from './goal-runner-testing-integrity.unit.test';
import { featureFilePath } from '../../config';
import { loadCanonicalChangeUnit, createChangeUnitRef, asChangeUnitArtifact } from '../../scripts/utils/change-unit-path';
import { reviseChangeUnitContent } from '../../scripts/utils/change-unit-design-preparation';
import { decideRunContinuation, loadEffectiveExecutionScope } from '../../scripts/utils/goal-run-creation';
import { assessFeature } from '../../scripts/utils/feature-assessment';
import { observeChangeUnitCompletion, resolveChangeUnitExpectedExecution } from '../../scripts/utils/change-unit-completion';
import { countAgentInvokeStarts, loadAuthoritativeEvents, foldBudgetLineage } from '../../scripts/utils/goal-runner-phase';
import type { UnitCaseResult } from '../run-unit';
import { freezeAndTransfer } from './successor-exit.unit.test';

export async function runAll(): Promise<UnitCaseResult[]> {
  const project = provisionRealChainProject();
  const name = 'real stopped CU revision reaches the existing plan recovery and completes with history and cumulative budget retained';
  try {
    scaffoldRealChainHost(project);
    const { cu, birthChain } = seedCuBoundHost(project);
    git(project.root, ['add', '-A']); git(project.root, ['commit', '-qm', 'seed revision recovery fixture']);
    const writers = { spec: writeCuSpecMaterials, plan: writeCuPlanMaterials, coding: writeCuCodingMaterials, review: writeCuReviewMaterials, ut: writeCuUtMaterials };
    const hook = (phase: keyof typeof writers) => (ctx: { runId: string; attempt: number }) => { cu.runId = ctx.runId; writers[phase](cu); if (ctx.attempt > 1) publishVerifier(cu, phase); };
    const common = { frameworkRoot: cu.frameworkRoot, featureId: cu.feature, realHarness: true, adapter: 'codex', noAutoForce: true,
      freshStartPhase: birthChain[0] as 'plan', freshEndPhase: birthChain.at(-1), freshRequirement: CU_REQUIREMENT,
      onSpec: hook('spec'), onPlan: hook('plan'), onCoding: hook('coding'), onReview: hook('review'), onUt: hook('ut') };
    const first = await runGoalRuntimeChain(cu.root, { ...common, freshBudget: { max_total_turns: 30 },
      onCoding: ctx => { cu.runId = ctx.runId; writeCuFacts(cu, 'coding'); }, failExecutorFor: phase => phase === 'coding' });
    const runsDir = featureFilePath(cu.root, cu.feature, 'goal-runs');
    const firstId = fs.readdirSync(runsDir).filter(id => !id.startsWith('.') && fs.existsSync(path.join(runsDir, id, 'manifest.json')))[0];
    assert(firstId, `first run missing: ${first.exitCode}`);
    const manifestFile = path.join(runsDir, firstId, 'manifest.json'); const manifestBytes = fs.readFileSync(manifestFile);
    const eventsFile = path.join(runsDir, firstId, 'events.jsonl'); const eventBytes = fs.readFileSync(eventsFile);
    const priorEvents = loadAuthoritativeEvents(eventsFile); const usedTurns = countAgentInvokeStarts(priorEvents);
    assert(priorEvents.some(event => event.type === 'run_end' && event.status === 'HALTED'), JSON.stringify(priorEvents.slice(-4)));
    assert(!priorEvents.some(event => event.type === 'phase_verdict' && event.phase === 'plan' && event.action === 'halt'), 'normal plan output must close before the deliberately failed coding executor');
    assert(priorEvents.some(event => event.type === 'agent_invoke_end' && event.phase === 'coding' && event.exit_code === 1), 'the original stop must contain the deliberate coding executor failure');
    assert(usedTurns > 0);
    const loaded = loadCanonicalChangeUnit(cu.root, 'ledger-app-blueprint', 'ledger-refresh');
    assert.equal(observeChangeUnitCompletion(cu.root, asChangeUnitArtifact(loaded.changeUnit)).state, 'ABSENT');
    const candidate = structuredClone(asChangeUnitArtifact(loaded.changeUnit)); candidate.purpose += ' 同一未完成切片补齐计划说明。';
    const businessFiles = ['contracts.yaml', 'use-cases.yaml'].map(name => featureFilePath(cu.root, cu.feature, name));
    const business = businessFiles.map(file => fs.readFileSync(file));
    const revised = reviseChangeUnitContent(cu.root, 'ledger-app-blueprint', [{ expectedRef: createChangeUnitRef(loaded), candidate: { providerId: candidate.provenance.extraction_method, artifact: candidate } }]);
    assert.equal(revised.revised.length, 1);
    businessFiles.forEach((file, index) => assert(fs.readFileSync(file).equals(business[index])));
    assert(fs.readFileSync(manifestFile).equals(manifestBytes));
    const scope = loadEffectiveExecutionScope(cu.root, cu.feature, firstId)!;
    const assessment = assessFeature(cu.root, cu.feature, { expectedTrack: 'full', expectedChain: scope.phase_chain, frameworkRoot: cu.frameworkRoot, scope });
    assert(assessment.obligations.some(row => row.status === 'uncovered' && row.class === 'binding' && (row.owner_phase === 'plan' || row.id === 'cu:feature-binding')), JSON.stringify(assessment));
    const decision = decideRunContinuation({ projectRoot: cu.root, feature: cu.feature, call: { requirement: CU_REQUIREMENT, attended: true } });
    assert.equal(decision.kind, 'successor', JSON.stringify(decision));
    const continued = await requestVia('foreground', cu.root, common);
    const runIds = fs.readdirSync(runsDir).filter(id => !id.startsWith('.') && fs.existsSync(path.join(runsDir, id, 'manifest.json')));
    const successor = runIds.find(id => id !== firstId)!; assert(successor, `successor absent: ${continued.exitCode}`);
    const nextManifest = JSON.parse(fs.readFileSync(path.join(runsDir, successor, 'manifest.json'), 'utf8'));
    assert.equal(nextManifest.successor_of, firstId);
    assert.deepStrictEqual(nextManifest.budget, JSON.parse(manifestBytes.toString('utf8')).budget);
    assert(continued.invokedPhases.includes('plan'), JSON.stringify(continued.invokedPhases));
    assert(fs.readFileSync(manifestFile).equals(manifestBytes));
    assert(fs.readFileSync(eventsFile).subarray(0, eventBytes.length).equals(eventBytes));
    const nextEvents = loadAuthoritativeEvents(path.join(runsDir, successor, 'events.jsonl'));
    assert(nextEvents.some(event => event.type === 'supersede' && (event as { target_run_id?: string }).target_run_id === firstId));
    const expected = resolveChangeUnitExpectedExecution(cu.root, cu.feature, false, cu.frameworkRoot);
    const final = assessFeature(cu.root, cu.feature, { ...expected, frameworkRoot: cu.frameworkRoot });
    assert(final.complete, `exit=${continued.exitCode}; ${JSON.stringify(final)}`);
    assert.equal(loadCanonicalChangeUnit(cu.root, 'ledger-app-blueprint', 'ledger-refresh').changeUnit.revision, 2);
    assert.equal(fs.readdirSync(path.dirname(loaded.canonicalPath)).filter(name => name.startsWith('change-unit')).length, 1);
    const folded = foldBudgetLineage({ projectRoot: cu.root, featuresDir: 'doc/features', feature: cu.feature, currentEvents: nextEvents });
    assert(countAgentInvokeStarts(folded.ancestorEvents) >= usedTurns, 'the existing budget lineage must retain prior consumed turns');
    assert(countAgentInvokeStarts(folded.budgetFoldEvents) >= usedTurns + countAgentInvokeStarts(nextEvents));
    freezeAndTransfer(cu, cu.feature, successor);
    const currentContracts = fs.readFileSync(businessFiles[0]);
    const badMapping = YAML.parse(currentContracts.toString('utf8'));
    badMapping.change_unit.predicate_mappings.pop(); fs.writeFileSync(businessFiles[0], YAML.stringify(badMapping));
    const completeHolder = decideRunContinuation({ projectRoot: cu.root, feature: cu.feature, call: { requirement: CU_REQUIREMENT, attended: true } });
    assert.equal(completeHolder.kind, 'hold', `a completed holder with an ordinary mapping gap and no new CU content is not new work: ${JSON.stringify(completeHolder)}`);
    fs.writeFileSync(businessFiles[0], currentContracts);
    console.log('RECOVERY_EVIDENCE ' + JSON.stringify({ original: firstId, successor, phases: continued.invokedPhases,
      record: final.record.state, complete: final.complete, revision: 2, originalTurns: usedTurns,
      ancestorTurns: countAgentInvokeStarts(folded.ancestorEvents), successorTurns: countAgentInvokeStarts(nextEvents),
      cumulativeTurns: countAgentInvokeStarts(folded.budgetFoldEvents), maxTotalTurns: nextManifest.budget.max_total_turns,
      completedHolderDecision: completeHolder.kind }));
    return [{ name, ok: true }];
  } catch (error) { return [{ name, ok: false, error: (error as Error).stack }]; }
  finally { fs.rmSync(project.root, { recursive: true, force: true }); }
}
