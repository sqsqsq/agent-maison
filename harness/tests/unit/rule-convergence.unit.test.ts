import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as YAML from 'yaml';
import { execFileSync } from 'child_process';
import { gunzipSync } from 'zlib';
import { clearFrameworkConfigCache } from '../../config';
import { provisionFrameworkUnder } from '../utils/real-chain-host';
import { validateEvolutionDecisions } from '../../scripts/utils/blueprint-evolution-decisions';
import { loadCanonicalBlueprint } from '../../scripts/utils/component-blueprint-path';
import { loadCanonicalChangeUnit, asChangeUnitArtifact } from '../../scripts/utils/change-unit-path';
import { SpecLoader } from '../../scripts/utils/spec-loader';
import { projectComponentSelections, componentProjectionErrors, componentReviewContext, checkComponentSelections } from '../../scripts/utils/component-selection-check';
import { partitionConstructionFiles } from '../../scripts/utils/phase-write-boundary';
import { recomputePhaseEvidenceStaleness, resolvePhaseEvidenceManifest, recomputeManifestAggregate } from '../../scripts/utils/phase-evidence-manifest';
import { checkHostEntryReachability } from '../../scripts/check-coding';
import planChecker from '../../scripts/check-plan';
import { refreshComponentIndex } from '../../scripts/utils/component-assets';
import { collectPhaseRepairCandidates } from '../../scripts/utils/repair-candidates';
import { checkAuthoritativeContentAligned } from '../../scripts/utils/blueprint-skill-projection';
import { designRepairNeedsContinuation } from '../../scripts/goal-phase-runtime';
import { designRepairInputFingerprint } from '../../scripts/utils/design-repair-unattended';
import { publishArchitectureRevision } from '../../scripts/utils/init-task-executor';
import type { GoalRunEvent } from '../../scripts/utils/goal-runner-phase';
import type { CheckContext } from '../../scripts/utils/types';
import type { UnitCaseResult } from '../run-unit';
import { matchesUnitCase, selectedUnitCases, type SelectedUnitCases } from '../utils/unit-case-selection';

const history = path.resolve(__dirname, '../fixtures/host-recovery-history/20261019');
const feature = 'cu-YmMtb3BlbkNhcmQtMgBvcGVuLWNhcmQtZmxvdw';
const featureRel = 'doc/features/bc-openCard-2/open-card-flow';
const runId = '20261019T033030Z-1b91ba';
type Project = { root: string; frameworkRoot: string; context: CheckContext };
export async function withProject(run: (project: Project) => void | Promise<void>): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-rules-'));
  try {
    fs.cpSync(path.join(history, 'project'), root, { recursive: true });
    const sources = JSON.parse(fs.readFileSync(path.join(history, '../sources.json'), 'utf8'));
    for (const source of sources.files.filter((item: { file: string; transformation?: string }) => item.file.startsWith('20261019/project/') && item.transformation === 'CRLF to LF')) {
      const file = path.join(root, source.file.slice('20261019/project/'.length));
      // Rehydrate the documented source bytes in the disposable project; stored text stays LF.
      fs.writeFileSync(file, gunzipSync(fs.readFileSync(path.join(history, '..', source.raw_file))));
    }
    const { frameworkRoot } = provisionFrameworkUnder(root);
    for (const id of ['20261019T024808Z-4131b6', runId]) fs.cpSync(path.join(history, id), path.join(root, featureRel, 'goal-runs', id), { recursive: true });
    clearFrameworkConfigCache();
    const context = { projectRoot: root, frameworkRoot, feature, phase: 'coding', phaseRule: {},
      resolvedProfile: { name: 'hmos-app', profileDir: path.join(frameworkRoot, 'profiles/hmos-app') },
      featureSpec: new SpecLoader(root, undefined, undefined, frameworkRoot).loadFeatureSpec(feature),
    } as CheckContext;
    await run({ root, frameworkRoot, context });
  } finally {
    clearFrameworkConfigCache();
    if (process.env.REAL_CHAIN_DEBUG === '1') console.log(`[rule-convergence] kept root ${root}`);
    else fs.rmSync(root, { recursive: true, force: true });
  }
}

const cases: Array<{ name: string; run(): Promise<void> }> = [
  { name: 'design repair retry uses changed content, not its own renewed audit identity', run: () => withProject(({ root }) => {
    const loaded = loadCanonicalChangeUnit(root, 'bc-openCard-2', 'open-card-flow');
    const before = designRepairInputFingerprint(root, feature);
    assert(before);
    const cu = structuredClone(loaded.changeUnit);
    cu.revision = Number(cu.revision) + 1;
    cu.provenance = { ...(cu.provenance as Record<string, unknown>), source_revision: 'revision-new', observed_at: new Date().toISOString(), extraction_method: 'component-design;design-repair' };
    fs.writeFileSync(loaded.canonicalPath, YAML.stringify(cu));
    assert.equal(designRepairInputFingerprint(root, feature), before, 'publisher audit metadata must not refresh the same repair opportunity');
    cu.purpose = String(cu.purpose) + '；新的有效设计内容';
    fs.writeFileSync(loaded.canonicalPath, YAML.stringify(cu));
    assert.notEqual(designRepairInputFingerprint(root, feature), before, 'changed source content remains a new input');
  }) },
  { name: 'design continuation uses current causal halt, never a historical halt or a later unrelated stage', run: async () => {
    // Controlled observations exercise production dispatch, not rewritten historical logs.
    const repair = { type: 'design_authority_repair', phase: 'plan', stage: 'published', outcome: 'recovered' };
    const halt = { type: 'phase_halt', phase: 'plan', halt_reason: 'execution_scope_unresolved' };
    const end = { type: 'run_end', status: 'HALTED', halt_reason: 'execution_scope_unresolved' };
    const probe = (events: unknown[]) => designRepairNeedsContinuation(events as GoalRunEvent[], ['spec', 'plan', 'coding']);
    assert(probe([{ type: 'run_start' }, repair, halt, end]));
    assert(!probe([{ type: 'run_start' }, halt, end, { type: 'run_start' }, repair, { type: 'run_end', status: 'COMPLETED' }]));
    assert(!probe([{ type: 'run_start' }, repair, { ...halt, phase: 'coding' }, end]));
    assert(!probe([{ type: 'run_start' }, repair, { type: 'agent_invoke_start', phase: 'plan' }, halt, end]));
  } },
  { name: 'architecture publication writes its actual target and retains unrelated project configuration', run: () => withProject(({ root }) => {
    const file = path.join(root, 'framework.config.json');
    const before = JSON.parse(fs.readFileSync(file, 'utf8'));
    const target = structuredClone(before.architecture);
    target.outer_layers.push({ id: '06-Support', can_depend_on: [], intra_layer_deps: 'forbid' });
    publishArchitectureRevision(root, target);
    const after = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(after.architecture, target);
    for (const key of Object.keys(before).filter(key => key !== 'architecture')) assert.deepEqual(after[key], before[key], key);
    const published = fs.readFileSync(file);
    target.outer_layers[0].can_depend_on.push('not-a-layer');
    assert.throws(() => publishArchitectureRevision(root, target));
    assert(fs.readFileSync(file).equals(published), 'invalid candidate must not be written');
  }) },
  { name: '4131b6 original rev4: selection-specific field exposes wrong kind and nested UI coverage at design', run: () => withProject(({ root }) => {
    const original = YAML.parse(fs.readFileSync(path.join(history, '4131b6-blueprint-rev4.yaml'), 'utf8'));
    const issues = validateEvolutionDecisions(original, root);
    assert(issues.some(i => i.id === 'blueprint_asset_selection_invalid' && i.message.includes('asset_resolution')));
    assert(issues.some(i => i.id === 'blueprint_asset_selection_missing' && i.message.includes('CardTypeSheet')));
    original.decisions_and_gaps.decisions.push({ kind: 'component_selection_notes', decision_id: 'ordinary', status: 'answered_with_evidence' });
    assert(!validateEvolutionDecisions(original, root).some(i => i.message.includes('ordinary')), 'ordinary decisions are not a closed enum');
  }) },
  { name: 'canonical selection derives missing copies and mappings while preserving real conflicts', run: () => withProject(({ root, context }) => {
    const cu = asChangeUnitArtifact(loadCanonicalChangeUnit(root, 'bc-openCard-2', 'open-card-flow').changeUnit);
    const contracts = structuredClone(context.featureSpec.contracts!);
    delete contracts.components[0].asset_selection;
    contracts.change_unit!.design_ref_mappings = contracts.change_unit!.design_ref_mappings.filter(row => row.design_ref.target.kind !== 'decision');
    const projected = projectComponentSelections(root, contracts, cu);
    assert.equal(projected.components[0].asset_selection?.resolution, 'custom');
    assert.deepEqual(componentProjectionErrors(root, projected, cu), []);
    assert.equal(contracts.components[0].asset_selection, undefined, 'projection does not rewrite an author artifact');
    const alignment = checkAuthoritativeContentAligned({ ...context, phase: 'plan', featureSpec: { ...context.featureSpec, contracts } }, 'contracts');
    assert(!alignment.some(check => check.status === 'FAIL'), 'alignment must consume the same derived values, not ask plan to copy them: ' + JSON.stringify(alignment));
    projected.components[0].asset_selection!.resolution = 'reuse';
    assert(componentProjectionErrors(root, projected, cu).some(message => message.includes('不一致')));
  }) },
  { name: '1b91ba gate and status share authorized source writes without rolling spec/plan back', run: () => withProject(({ root, frameworkRoot }) => {
    // Adapt only the copied environment to today's checker; historical input hashes and events remain intact.
    for (const phase of ['spec', 'plan'] as const) {
      const file = path.join(root, featureRel, phase, 'reports/phase-evidence-manifest.json');
      const old = JSON.parse(fs.readFileSync(file, 'utf8'));
      const current = resolvePhaseEvidenceManifest({ projectRoot: root, feature, phase, frameworkRoot, requirementSha: old.environment.requirement_sha256 });
      old.environment = current.environment;
      old.aggregate_sha256 = recomputeManifestAggregate(old);
      fs.writeFileSync(file, JSON.stringify(old));
    }
    const options = { frameworkRoot, runId };
    const gate = recomputePhaseEvidenceStaleness(root, feature, ['spec', 'plan'], { ...options, pendingOwnerPhase: 'coding' });
    const status = recomputePhaseEvidenceStaleness(root, feature, ['spec', 'plan'], options);
    assert.deepEqual(status, gate, 'assess/recovery cannot use a different ownership fact');
    assert(status.every(item => item.verdict === 'fresh'), JSON.stringify(status));
    const resource = '02-Feature/WalletMain/src/main/resources/base/element/string.json';
    fs.appendFileSync(path.join(root, resource), '\n ');
    const changed = recomputePhaseEvidenceStaleness(root, feature, ['spec', 'plan'], options);
    assert(changed.some(item => item.changed_paths.includes(resource)), 'an unobserved write is not an authorized transition');
  }) },
  { name: '1b91ba planned UT files belong to UT, not coding', run: () => withProject(({ root, context }) => {
    const files = partitionConstructionFiles(root, context.resolvedProfile.profileDir, context.featureSpec.contracts!);
    assert(files.tests.some(file => file.endsWith('bank_open_card_2_ut.test.ets')));
    assert(files.implementation.includes('02-Feature/WalletMain/src/main/resources/base/profile/route_map.json'));
    assert(!files.implementation.some(file => file.includes('/ohosTest/')));
  }) },
  { name: '1b91ba typed plan checks the actual zero-modification definition; coding routes old missing definitions back', run: () => withProject(async ({ context }) => {
    const plan = { ...context, phase: 'plan', resolvedInputs: { phase: 'plan', context: { required_outputs: ['contracts.yaml'] }, values: {}, artifacts: {} } } as unknown as CheckContext;
    const checks = await planChecker.check(plan);
    assert(checks.some(check => check.id === 'integration_scope_consistency' && check.status === 'FAIL' && check.details?.includes('entry_symbol')));
    const coding = checkHostEntryReachability(context);
    assert(coding.every(check => check.repair_owner === 'plan' && !check.details?.includes('页面孤岛')));
    const candidates = collectPhaseRepairCandidates({ phase: 'coding', checks: coding, reviewReportText: null, verifierReportText: null, reportValidity: 'PASS' });
    assert(candidates.some(candidate => candidate.category === 'plan' && candidate.files.some(file => file.endsWith('contracts.yaml'))));
    const completed = structuredClone(context.featureSpec.contracts!);
    for (const point of completed.integration_points ?? []) point.entry_symbol = point.consumer_module === 'Phone'
      ? 'buildBankCardSelectionPage' : point.provider_module === 'AccountManager' ? 'AccountService' : 'BankRepository';
    const repaired = { ...plan, featureSpec: { ...plan.featureSpec, contracts: completed } };
    const after = await planChecker.check(repaired);
    assert(after.some(check => check.id === 'integration_scope_consistency' && check.status === 'PASS'), JSON.stringify(after));
    assert(!checkAuthoritativeContentAligned(repaired, 'contracts').some(check => check.status === 'FAIL'), '补上真实入口不能与权威字段对齐形成相反规则');
    completed.integration_points![0].requires_modification = true;
    assert(checkAuthoritativeContentAligned(repaired, 'contracts').some(check => check.status === 'FAIL'), '改变权威已声明字段仍然失败');
  }) },
  { name: 'real route wrappers remain unknown, enter review context and retain actual negative probes', run: () => withProject(({ root, context }) => {
    const entry = path.join(root, '02-Feature/WalletMain/src/main/ets/index.ets');
    const original = fs.readFileSync(entry, 'utf8');
    fs.writeFileSync(entry, original.split('\n').filter(line => !/buildAddCardResultPage|buildBankCardSelectionPage/.test(line)).join('\n'));
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
    git('init'); git('add', '02-Feature', '04-BusinessBase', '01-Product'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'controlled export baseline');
    fs.writeFileSync(entry, original);
    refreshComponentIndex(root);
    const checks = checkComponentSelections(context);
    assert(checks.some(check => check.id === 'component_new_static_checks' && check.status === 'WARN' && check.details?.includes('buildAddCardResultPage')));
    assert(!checks.some(check => check.id === 'component_new_static_checks' && check.status === 'FAIL'), JSON.stringify(checks));
    assert(componentReviewContext(root).some(item => item.label.includes('未确认') && item.content.includes('buildAddCardResultPage')));
    const file = path.join(root, '02-Feature/WalletMain/src/main/ets/presentation/pages/AddCardResultPage.ets');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('AddCardResultPage();', "Button('bad').fontSize('16vp').width(20).height(20);"));
    refreshComponentIndex(root);
    assert(checkComponentSelections(context).some(check => check.id === 'component_new_static_checks' && check.status === 'FAIL' && check.details?.includes('buildAddCardResultPage')));
  }) },
];

export async function runSelectedCases(selector?: string): Promise<SelectedUnitCases> {
  const results: UnitCaseResult[] = [];
  for (const test of cases) {
    if (!matchesUnitCase(test.name, selector)) continue;
    try { await test.run(); results.push({ name: test.name, ok: true }); }
    catch (error) { results.push({ name: test.name, ok: false, error: (error as Error).stack }); }
  }
  return selectedUnitCases(results, selector, []);
}

export const runAll = async (): Promise<UnitCaseResult[]> => (await runSelectedCases()).results;
