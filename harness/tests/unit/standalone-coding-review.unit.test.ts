import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as YAML from 'yaml';
import { execFileSync, spawnSync } from 'child_process';
import { clearFrameworkConfigCache, resolveFeatureArtifact, featurePhaseReportsDir, resolveReceiptFilePath } from '../../config';
import { resolveCapabilityInputs, readRunBoundContracts } from '../../scripts/utils/capability-resolution';
import { resolveCapabilityResolutionEntryInput } from '../../scripts/utils/capability-resolution-entry-input';
import { resolveExecutionScope, executionScopeFingerprint, type ExecutionScope, type ExecutionScopeInput } from '../../scripts/utils/execution-scope';
import { designScopeRevisionChecks } from '../../scripts/utils/blueprint-skill-projection';
import { buildSummaryRepairCandidates, checkOwnedCandidate, scopeRevisionInputFromRepairCandidates } from '../../scripts/utils/repair-candidates';
import { collectResolvedScopeFacts, readScopeAcceptance, prepareFeatureScopeCandidate, featureScopePhaseHealth, resolveFeatureExecutionScope, featureTrackDeclPath, recomputeDefinitionFacts } from '../../scripts/utils/feature-track';
import { buildGoalManifestFromInput } from '../../scripts/utils/goal-manifest';
import { createGoalRun, loadEffectiveExecutionScope } from '../../scripts/utils/goal-run-creation';
import { resolvePhaseWriteBoundary } from '../../scripts/utils/phase-write-boundary';
import { runSyncClosureDetailed } from '../../scripts/utils/phase-state';
import { SpecLoader } from '../../scripts/utils/spec-loader';
import { prepareGoalModeRun } from '../../scripts/goal-mode-entry';
import { runCorrectionInit } from '../../scripts/utils/correction-commands';
import { assessFeature } from '../../scripts/utils/assess';
import { formatAssessNextStep } from '../../scripts/utils/assess-renderer';
import { checkFactsArtifact } from '../../scripts/utils/context-facts';
import { checkUpstreamVerdictGate } from '../../scripts/utils/upstream-verdict-gate';
import { executionScopeEvidenceIssues } from '../../scripts/utils/verify-feature-completion';
import coding from '../../scripts/check-coding';
import { generateScriptReport } from '../../scripts/utils/report-generator';
import { finalizePhaseClosure } from '../../scripts/utils/phase-closure-finalizer';
import { publishFixtureVerifierEvidence } from '../utils/verifier-evidence-fixture';
import { writeRunSummaryBase } from '../../harness-runner';
import { resolveFeatureCorrectionRouting } from '../../scripts/utils/correction-commands';
import review from '../../scripts/check-review';
import type { CheckContext } from '../../scripts/utils/types';
import { resolveWorkflowSpec, type WorkflowSpec } from '../../workflow-loader';
import type { UnitCaseResult } from '../run-unit';

const frameworkRoot = path.resolve(__dirname, '../../..');
const workflow: WorkflowSpec = { schema_version: '1.2', name: 'p4', auto_chain: ['spec', 'plan', 'coding', 'review', 'ut', 'testing'], artifacts: ['spec', 'plan', 'coding', 'review', 'ut', 'testing'].map(id => ({ id, scope: 'feature', requires: [], obligation_provider_id: `obligations.${id}` })) };
function fixture(newFile = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p4-coding-review-'));
  const write = (file: string, value: string) => { const abs = path.join(root, file); fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, value); };
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  write('framework.config.json', JSON.stringify({ schema_version: '1.1', project_name: 'P4', project_profile: { name: 'generic' }, paths: { features_dir: 'doc/features' }, architecture: { outer_layers: [{ id: 'src', can_depend_on: [] }], module_inner_layers: ['shared', 'data', 'domain', 'presentation'] } }));
  write('src/demo/value.ts', 'export const value: number = 1;\n');
  const contracts = { feature: 'demo', source: 'approved design', version: '1', modules: [{ name: 'demo', layer: 'src', package_path: 'src/demo' }], files: ['src/demo/value.ts'], module_dependencies: {}, data_models: [], interfaces: [], components: [], prd_to_code_traceability: [{ prd_id: 'AC-1', key_files: ['src/demo/value.ts'] }] };
  if (newFile) contracts.files.push('src/demo/new.ts');
  write('doc/features/demo/contracts.yaml', YAML.stringify(contracts));
  write('doc/features/demo/acceptance.yaml', YAML.stringify({ feature: 'demo', source: 'approved behavior', version: '1', criteria: [{ id: 'AC-1', description: 'value is 42', priority: 'P1', testable: true, verification_steps: ['read value'], expected_result: '42', ut_layer: 'unit', ut_focus: ['value is 42'] }], boundaries: [] }));
  git('init', '-q'); git('add', 'src/demo/value.ts'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'baseline');
  const options = { projectRoot: root, frameworkRoot, feature: 'demo', phase: 'coding', track: 'full' as const, requirement: 'make value 42', testTargets: ['src/demo/value.ts'], inputContext: { schema_version: '1.1' as const, subject: { feature: 'demo' }, obligations: { implementation: 'required' as const, 'visual-evidence': 'not_applicable' as const }, required_outputs: [] } };
  const initial = resolveCapabilityInputs(options);
  assert.notEqual(initial.report.assurance, 'blocked', JSON.stringify(initial.report));
  const bound = (id: string) => { const value = initial.inputs!.values[id]; assert(value.state === 'resolved', id); return value.binding; };
  // D0.1: a Feature-target candidate needs a sourced impact judgement before device verification
  // can be pruned, and `resolved` facts so visual derives from the fidelity SSOT rather than
  // defaulting to unknown. Both come from the production reading layer.
  const scopeInput: ExecutionScopeInput = { request: { completion_target: 'feature', requested_results: ['delivery'], requested_phases: ['coding'],
    impact: { user_visible_behavior_change: false, reason: 'fixture: unit verification only', basis: [bound('codebase')] } }, facts: [
    { id: 'implementation', kind: 'implementation', applicability: 'required', reason: 'authorized change', basis: [bound('codebase')] },
    { id: 'design', kind: 'design-context', applicability: 'required', reason: 'approved contract', basis: [bound('contracts')], satisfied_by: [bound('contracts')] },
    { id: 'acceptance', kind: 'acceptance-context', applicability: 'required', reason: 'approved behavior', basis: [bound('acceptance')], satisfied_by: [bound('acceptance')] },
    { id: 'visual', kind: 'visual-evidence', applicability: 'not_applicable', reason: 'no UI change', basis: [bound('acceptance')] },
  ], contract_fingerprints: [] };
  const scope = resolveExecutionScope(scopeInput, workflow, { value: initial.inputs!.artifacts['acceptance@1'] as any, binding: bound('acceptance') },
    collectResolvedScopeFacts(scopeInput, { projectRoot: root, feature: 'demo', frameworkRoot, requirement: options.requirement }));
  const manifest = buildGoalManifestFromInput({ feature: 'demo', run_id: 'p4-coding', requirement: options.requirement, execution_scope: scope, chain_override: scope.phase_chain, unattended: { write_mode: 'full-access', approval_mode: 'never' } }, { projectRoot: root });
  createGoalRun({ projectRoot: root, manifest, chain: scope.phase_chain });
  const profileDir = path.join(root, 'test-profile');
  write('test-profile/harness/coding-host-rules.js', `const cp=require('child_process'); exports.profileCodingHost={sourceFileSuffixes:['.ts'],runStructureChecks:()=>[],runTraceabilityChecks:()=>[],checkCodingCompile:ctx=>{let details='TypeScript compilation completed',status='PASS';try{cp.execFileSync(process.execPath,[${JSON.stringify(require.resolve('typescript/bin/tsc'))},'--noEmit','--skipLibCheck','--target','ES2022',...ctx.featureSpec.contracts.files],{cwd:ctx.projectRoot,stdio:'pipe'});}catch(e){status='FAIL';details=String(e.stdout||e);}return [{id:'coding_compile',category:'structure',severity:'BLOCKER',status,description:'native TypeScript compile',details}];}};`);
  const context = (phase: 'coding' | 'review'): CheckContext => {
    const bridge = resolveCapabilityResolutionEntryInput({ projectRoot: root, frameworkRoot, feature: 'demo', phase, featuresDir: 'doc/features', goalRunId: manifest.run_id });
    const resolved = resolveCapabilityInputs({ ...options, ...bridge, phase });
    assert.notEqual(resolved.report.assurance, 'blocked', JSON.stringify(resolved.report));
    const loader = new SpecLoader(root, undefined, undefined, frameworkRoot);
    const phaseRule = loader.loadPhaseRule(phase);
    // The tiny test profile researches one source; use the existing profile rule override.
    phaseRule.exploration_thresholds = { min_source_code_paths: 1, min_files_inspected: 1, min_code_facts: 1, min_searches: 1 };
    phaseRule.exploration_strategy = { ...phaseRule.exploration_strategy!, sequential_multiplier: 1, sequential_min_files_inspected_add: 0 };
    return { subject: 'feature', projectRoot: root, frameworkRoot, frameworkRel: '', harnessRoot: path.join(frameworkRoot, 'harness'), feature: 'demo', phase, phaseRule, featureSpec: loader.loadFeatureSpec('demo', resolved.inputs), resolvedInputs: resolved.inputs, factsContext: bridge.factsContext, resolvedProfile: { name: 'p4-test', profileDir, yaml: {} as any, phasesDisabled: new Set(), capabilities: {}, personalPrerequisites: {} } };
  };
  const facts = () => write('doc/features/demo/context/facts.md', '---\n' + YAML.stringify({ schema_version: '1.1', feature: 'demo', run_id: manifest.run_id, established_by: 'coding', ready_to_produce: true, has_blocker_coverage_risk: false, source_code_paths: ['src/demo/value.ts'], key_inputs_read: ['src/demo/value.ts'], files_inspected_count: 6, searches_performed_estimate: 4, decisions_unlocked: ['value is 42'], exploration_mode: 'sequential' }) + '---\n## Code Facts\n| 路径 | 事实 | 影响 |\n|---|---|---|\n| src/demo/value.ts | value has number type | preserve type |\n| src/demo/value.ts | value is exported | preserve API |\n| src/demo/value.ts | value is initialized | change to 42 |\n');
  return { root, write, git, contracts, manifest, context, facts, profileDir };
}

const cases: Array<{ name: string; newFile?: boolean; run(f: ReturnType<typeof fixture>): Promise<void> | void }> = [
  { name: 'combined review shares new authorized implementation targets across inputs facts and report coverage', newFile: true, async run(f) {
    f.write('src/demo/new.ts', 'export const created = 42;');
    f.git('add', 'src/demo/new.ts'); f.git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'new implementation');
    const ctx = f.context('review');
    const code = ctx.resolvedInputs!.values.code; assert(code.state === 'resolved');
    assert.deepStrictEqual((code.value as Array<{path: string}>).map(file => file.path), ctx.factsContext!.source_paths);
    assert(ctx.factsContext!.source_paths.includes('src/demo/new.ts'));
    const report = '# Review\n## 审查范围\n文件 src/demo/value.ts\n## 审查方法\n对照契约\n## 问题清单\n无问题\n## 问题统计\nBLOCKER: 0\nMAJOR: 0\nMINOR: 0\n## 修复建议\n无\n## 结论\n**审查结论**: 通过\n';
    f.write('doc/features/demo/review/review-report.md', report);
    assert.equal((await review.check(ctx)).find(check => check.id === 'review_scope_to_design')?.status, 'FAIL');
    f.write('doc/features/demo/review/review-report.md', report.replace('文件 src/demo/value.ts', '文件 src/demo/value.ts、src/demo/new.ts'));
    assert.equal((await review.check(ctx)).find(check => check.id === 'review_scope_to_design')?.status, 'PASS');
  } },
  { name: 'birth to coding uses real bound design without plan and preserves compilation and write scope', async run(f) {
    let ctx = f.context('coding');
    assert(checkFactsArtifact(f.root, 'demo', 'coding', { factsContext: ctx.factsContext, resolvedInputs: ctx.resolvedInputs, frameworkRoot }).some(check => check.status === 'FAIL'));
    f.facts(); f.write('src/demo/value.ts', 'export const value: number = 42;\n'); ctx = f.context('coding');
    const checks = await coding.check(ctx);
    assert(!checks.some(check => check.severity === 'BLOCKER' && check.status === 'FAIL'), JSON.stringify(checks.filter(check => check.status === 'FAIL')));
    for (const id of ['diff_within_scope', 'coding_compile', 'file_completeness', 'layer_compliance', 'inter_module_dependency', 'plan_to_code', 'ui_diff_within_declared_files']) assert.equal(checks.find(check => check.id === id)?.status, 'PASS', JSON.stringify(checks.filter(check => check.id === id)));
    assert(!resolveFeatureArtifact(f.root, 'demo', 'plan.md').exists);
    const boundary = resolvePhaseWriteBoundary({ projectRoot: f.root, frameworkRoot, feature: 'demo', runId: f.manifest.run_id, phaseOrder: ['coding'], track: 'full', profileDir: f.profileDir, productLayerDirs: ['src'] });
    assert(!boundary.unresolvedSourcePhases.includes('coding'));
    f.write('src/demo/resources/base/media/unapproved.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');
    assert.equal((await coding.check(f.context('coding'))).find(check => check.id === 'ui_diff_within_declared_files')?.status, 'FAIL');
    f.write('src/demo/unapproved.ts', 'export const extra = 1;'); f.git('add', 'src'); f.git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'changed source');
    assert.equal((await coding.check(f.context('coding'))).find(check => check.id === 'diff_within_scope')?.status, 'FAIL');
    f.write('src/demo/value.ts', 'export const value: number = "wrong";');
    assert.equal((await coding.check(f.context('coding'))).find(check => check.id === 'coding_compile')?.status, 'FAIL');
  } },
  { name: 'bound contracts cannot expand after birth and independent scope ignores unrelated old design verdicts', run(f) {
    f.write('doc/features/demo/plan/reports/summary.json', JSON.stringify({ verdict: 'FAIL', blockers: [{ id: 'old-plan' }] }));
    assert.deepStrictEqual(checkUpstreamVerdictGate({ projectRoot: f.root, feature: 'demo', phase: 'coding', runId: f.manifest.run_id }), []);
    assert.deepStrictEqual(readRunBoundContracts(f.root, frameworkRoot, 'demo', f.manifest.run_id).files, ['src/demo/value.ts']);
    f.write('doc/features/demo/contracts.yaml', YAML.stringify({ ...f.contracts, files: [...f.contracts.files, 'src/demo/new.ts'] }));
    assert.throws(() => readRunBoundContracts(f.root, frameworkRoot, 'demo', f.manifest.run_id), /stale/);
    assert.throws(() => f.context('coding'));
  } },
  { name: 'D0.1 review-only and ut-only requests keep their code targets while revision triggers stay out', run(f) {
    // §5.1.1a R-target collection, with its regression guard (§4.4): the historical file that
    // TRIGGERED a revision must not re-enter the phase's current targets, while the real review /
    // UT code targets must still resolve — if the filter over-reaches, `code` (input_role base,
    // on_missing fail for both skills) goes absent and the capability assurance turns `blocked`.
    f.write('src/demo/trigger.ts', 'export const triggered = 1;\n');
    const bound = (id: string, targets: string[]) => {
      const resolved = resolveCapabilityInputs({ projectRoot: f.root, frameworkRoot, feature: 'demo', phase: 'plan', track: 'full', testTargets: targets,
        inputContext: { schema_version: '1.1', subject: { feature: 'demo' }, obligations: {}, required_outputs: [] } });
      const value = resolved.inputs!.values[id];
      assert(value.state === 'resolved', id + ': ' + JSON.stringify(value));
      return value.binding;
    };
    const codeTarget = bound('codebase', ['src/demo/value.ts']);
    const triggerSource = bound('codebase', ['src/demo/trigger.ts']);
    const scopeInput: ExecutionScopeInput = { request: { completion_target: 'feature', requested_results: ['delivery'], requested_phases: ['review'],
      impact: { user_visible_behavior_change: false, reason: 'fixture: unit verification only', basis: [codeTarget] } }, facts: [
      { id: 'design', kind: 'design-context', applicability: 'required', reason: 'approved contract', basis: [bound('contracts', ['src/demo/value.ts'])], satisfied_by: [bound('contracts', ['src/demo/value.ts'])] },
      { id: 'acceptance', kind: 'acceptance-context', applicability: 'required', reason: 'approved behavior', basis: [bound('acceptance', ['src/demo/value.ts'])], satisfied_by: [bound('acceptance', ['src/demo/value.ts'])] },
      { id: 'code-review:target', kind: 'code-review', applicability: 'required', reason: 'review the delivered change', basis: [codeTarget] },
      { id: 'unit-evidence:target', kind: 'unit-evidence', applicability: 'required', reason: 'unit layer acceptance', basis: [codeTarget] },
      // The revision trigger: spec/plan observed this file when it asked for the revision. It is
      // evidence for WHY the scope changed, never a current target of review or UT.
      // (No `satisfied_by`: a `derive.codebase` binding has no parsed value, and §4.1.4 keeps the
      // strict re-resolve for proofs — a code observation is a basis, never a proof of completion.)
      { id: 'design-decision:trigger', kind: 'design-decision', applicability: 'required', reason: 'new interface decision', basis: [triggerSource] },
    ], contract_fingerprints: [] };
    const scope = resolveExecutionScope(scopeInput, workflow, undefined,
      collectResolvedScopeFacts(scopeInput, { projectRoot: f.root, feature: 'demo', frameworkRoot, requirement: 'make value 42' }));
    const manifest = buildGoalManifestFromInput({ feature: 'demo', run_id: 'p4-review-only', requirement: 'make value 42', execution_scope: scope, chain_override: scope.phase_chain, unattended: { write_mode: 'full-access', approval_mode: 'never' } }, { projectRoot: f.root });
    createGoalRun({ projectRoot: f.root, manifest, chain: scope.phase_chain });
    for (const phase of ['review', 'ut'] as const) {
      const bridge = resolveCapabilityResolutionEntryInput({ projectRoot: f.root, frameworkRoot, feature: 'demo', phase, featuresDir: 'doc/features', goalRunId: manifest.run_id });
      assert(bridge.testTargets!.includes('src/demo/value.ts'), phase + ' lost its real code target');
      assert(!bridge.testTargets!.includes('src/demo/trigger.ts'), phase + ' collected the revision trigger as a current target');
      assert(!bridge.factsContext!.source_paths.includes('src/demo/trigger.ts'), phase + ' put the revision trigger into the phase evidence');
      const resolved = resolveCapabilityInputs({ projectRoot: f.root, frameworkRoot, feature: 'demo', phase, track: 'full', requirement: 'make value 42', ...bridge });
      const code = resolved.inputs!.values.code;
      assert(code.state === 'resolved', phase + ' code unresolved: ' + JSON.stringify(code));
      assert(code.binding.dependencies.some(dep => dep.path.replace(/\\/g, '/').endsWith('src/demo/value.ts')), phase + ' code binding lost the expected target');
      assert.notEqual(resolved.report.assurance, 'blocked', phase + ' assurance blocked: ' + JSON.stringify(resolved.report));
    }
  } },
  { name: 'D0.3 real check-coding plan-owned gap triggers an in-run revision', async run(f) {
    // 经**真实**归属链：check-coding 产出 ui_diff_within_declared_files(ui_scope_violation)
    // → buildSummaryRepairCandidates 按既有注册表归 plan → 生成器产出设计事实。
    // 不手拼候选对象：触发者是候选本身，断言的是**生成结果**。
    f.facts();
    f.write('src/demo/value.ts', 'export const value: number = 42;\n');
    f.write('src/demo/resources/base/media/unapproved.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');
    const checks = await coding.check(f.context('coding'));
    const violation = checks.find(check => check.id === 'ui_diff_within_declared_files');
    assert.equal(violation?.status, 'FAIL', JSON.stringify(violation));
    assert.equal(violation?.failure_kind, 'ui_scope_violation');
    const candidates = buildSummaryRepairCandidates({ phase: 'coding', checks, reportValidity: 'PASS', reviewReportText: null, verifierReportText: null });
    const owned = candidates.filter(candidate => candidate.category === 'plan');
    assert.equal(owned.length, 1, JSON.stringify(candidates));
    assert.equal(owned[0].source_phase, 'coding');
    const produced = scopeRevisionInputFromRepairCandidates(candidates, { projectRoot: f.root, frameworkRoot, feature: 'demo', runId: f.manifest.run_id });
    assert(produced, 'a plan-owned candidate produced no revision input');
    const fact = produced!.input.facts.find(item => item.id === `design-decision:${owned[0].id}`);
    assert(fact, JSON.stringify(produced!.input.facts.map(item => item.id)));
    assert.equal(fact!.applicability, 'required');
    // basis 逐条对应候选 files（经生产解析器的绑定，不是手拼）
    assert.deepStrictEqual(
      fact!.basis.flatMap(binding => binding.dependencies.map(dep => path.relative(f.root, dep.path).replace(/\\/g, '/'))).sort(),
      [...owned[0].files].sort());
    // reason 语义 = 「需要 plan 裁决」，取自候选 summary，不预设裁决结论
    assert.equal(fact!.reason, `需要 plan 裁决：${owned[0].summary}`, 'reason 必须自己说清需要责任阶段裁决，而不是只转述候选摘要');
    assert(produced!.input.request.requested_phases.includes('plan'));
    // 同一 run 内修订后的链：plan 回到链上，coding/review/ut 仍待执行
    const revised = resolveExecutionScope(produced!.input, workflow,
      readScopeAcceptance(f.root, produced!.input, { feature: 'demo', frameworkRoot }),
      collectResolvedScopeFacts(produced!.input, { projectRoot: f.root, feature: 'demo', frameworkRoot, currentRunId: f.manifest.run_id, requirement: 'make value 42', impactInherited: true }));
    assert.deepStrictEqual(revised.phase_chain, ['plan', 'coding', 'review', 'ut']);
  } },
  { name: 'D0.3 named write-set violations stay in coding', async run(f) {
    // 需求点名的写集越界：diff_within_scope / 未授权契约引用。它们**未注册**进
    // CHECK_ID_OWNER_REGISTRY，结构上产不出 spec/plan 候选，因此也产不出修订输入。
    f.facts();
    f.write('src/demo/value.ts', 'export const value: number = 42;\n');
    f.write('src/demo/unapproved.ts', 'export const extra = 1;');
    f.git('add', 'src'); f.git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'changed source');
    const checks = await coding.check(f.context('coding'));
    assert.equal(checks.find(check => check.id === 'diff_within_scope')?.status, 'FAIL');
    const candidates = buildSummaryRepairCandidates({ phase: 'coding', checks, reportValidity: 'PASS', reviewReportText: null, verifierReportText: null });
    assert.deepStrictEqual(candidates.filter(candidate => candidate.category === 'spec' || candidate.category === 'plan'), [],
      'a named write-set violation produced a spec/plan candidate');
    assert.equal(scopeRevisionInputFromRepairCandidates(candidates, { projectRoot: f.root, frameworkRoot, feature: 'demo', runId: f.manifest.run_id }), null);
    // 归属层的那把锁：未注册 id → null（assess 的回退路由只读 repair_candidates，
    // 没有 plan 候选就路由不到 plan，更不会有修订事件）。
    assert.equal(checkOwnedCandidate({ checkId: 'diff_within_scope', sourcePhase: 'coding', detail: 'x', affectedFiles: ['src/demo/unapproved.ts'] }), null);
    // 断言真的跑到 **assess 的输出**（§5.4 那一行的要点）：推荐既不是回到 plan，
    // 也不是 `backtrack_target_absent`——写集越界留在 coding 自己修。
    const assessed = assessFeature({ projectRoot: f.root, frameworkRoot, feature: 'demo', runId: f.manifest.run_id,
      authorization: { mode: 'goal_mode' }, writeProjection: false });
    assert.notEqual(assessed.recommendation.phase, 'plan', JSON.stringify(assessed.recommendation));
    assert.notEqual(assessed.recommendation.action, 'backtrack_target_absent', JSON.stringify(assessed.recommendation));
    assert(!fs.existsSync(path.join(f.root, 'doc/features/demo/goal-runs', f.manifest.run_id, 'events.jsonl'))
      || !fs.readFileSync(path.join(f.root, 'doc/features/demo/goal-runs', f.manifest.run_id, 'events.jsonl'), 'utf8').includes('scope_revised'),
      '写集越界产出了范围修订事件');
  } },
  { name: 'D0.3 failing round writes the revision input and rerun does not duplicate it', async run(f) {
    // §5.1.2 ①：writer 在本轮 subject 锚定之后被**无条件**调用，因此 FAIL 轮也到得了。
    // 载体必须是磁盘 script-report.json——runtime 只从那里读修订输入。
    f.facts();
    f.write('src/demo/value.ts', 'export const value: number = 42;\n');
    f.write('src/demo/resources/base/media/unapproved.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');
    const checks = await coding.check(f.context('coding'));
    assert.equal(checks.find(check => check.id === 'ui_diff_within_declared_files')?.status, 'FAIL');
    const report = generateScriptReport(path.join(frameworkRoot, 'harness'), 'coding', 'demo', f.root, checks, frameworkRoot);
    assert.equal(report.summary.verdict, 'FAIL', '前提：这是一轮 FAIL');
    const reportPath = path.join(featurePhaseReportsDir(f.root, 'demo', 'coding', frameworkRoot), 'script-report.json');
    writeRunSummaryBase(f.root, report, frameworkRoot);
    const carriers = (JSON.parse(fs.readFileSync(reportPath, 'utf8')).checks as Array<Record<string, unknown>>)
      .filter(check => check.scope_revision_input);
    assert.equal(carriers.length, 1, '磁盘 script-report 上应恰好一条修订输入');
    const bytes = fs.readFileSync(reportPath, 'utf8');
    // 重跑指引再次进 writer：同一输入不重复追加、字节不变（与 runtime 的指纹去重同向）。
    writeRunSummaryBase(f.root, report, frameworkRoot);
    const after = JSON.parse(fs.readFileSync(reportPath, 'utf8')).checks as Array<Record<string, unknown>>;
    assert.equal(after.filter(check => check.scope_revision_input).length, 1, '重跑把修订输入写成了两条');
    assert.equal(fs.readFileSync(reportPath, 'utf8'), bytes, '重跑改写了 script-report 字节');
  } },
  { name: 'D0.3 correction to an out-of-scope phase explains instead of proposing', run(f) {
    // 调度者裁决（批次 2）：修正命令不产出修订输入（它没有新来源事实，runtime 的
    // 「修订必须由新事实驱动」判据会拒绝）。只如实说清范围外 + 两条合法入口。
    const scope = loadEffectiveExecutionScope(f.root, 'demo', f.manifest.run_id)!;
    assert(!scope.phase_chain.includes('spec') && !scope.reused_phases.some(reuse => reuse.phase === 'spec'), '前提：spec 不在有效范围内');
    const routing = resolveFeatureCorrectionRouting(f.root, 'demo',
      { requirement_changed: true, contract_changed: false, code_change_needed: false }, frameworkRoot, f.manifest.run_id);
    assert.equal(routing.root_layer, 'spec');
    assert.equal(routing.in_scope, false, '范围外的责任阶段被判成范围内');
    assert.equal((routing as { scope_revision_input?: unknown }).scope_revision_input, undefined, '修正命令产出了会被拒绝的提议');
    // 范围指纹不变、无修订事件（本命令根本不碰 events）
    assert.equal(executionScopeFingerprint(loadEffectiveExecutionScope(f.root, 'demo', f.manifest.run_id)!), executionScopeFingerprint(scope));
  } },
  { name: 'D0.3 spec-owned trigger stops blocking once fixed, and only that kind is exempt', run(f) {
    // §5.1.1a 的豁免是**按 kind** 的：修订触发依据（design-decision / acceptance-definition）
    // 的历史摘要不再阻断完成，真实设计输入一行不放宽。这里用同一条绑定换 kind 做对照。
    const bound = (id: string, targets: string[]) => {
      const resolved = resolveCapabilityInputs({ projectRoot: f.root, frameworkRoot, feature: 'demo', phase: 'plan', track: 'full', testTargets: targets,
        inputContext: { schema_version: '1.1', subject: { feature: 'demo' }, obligations: {}, required_outputs: [] } });
      const value = resolved.inputs!.values[id];
      assert(value.state === 'resolved', id + ': ' + JSON.stringify(value));
      return value.binding;
    };
    const trigger = bound('codebase', ['src/demo/value.ts']);
    const contracts = bound('contracts', ['src/demo/value.ts']);
    const scopeOf = (kind: string) => ({
      schema_version: '1.0' as const, completion_target: 'feature' as const, requested_results: ['delivery'],
      phase_chain: ['spec'], reused_phases: [], unresolved: [], policy_fingerprint: '0'.repeat(64),
      obligations: [{ id: `${kind}:trigger`, kind, owner_phase: 'spec', applicability: 'required' as const, reason: '触发修订的历史观察', basis: [trigger] }],
    });
    // 触发文件在责任阶段修复后字节必然与绑定不同——豁免的那一路不得再阻断完成。
    fs.writeFileSync(path.join(f.root, 'src/demo/value.ts'), 'export const value: number = 42;\n');
    assert.deepStrictEqual(executionScopeEvidenceIssues(f.root, 'demo', scopeOf('acceptance-definition')), []);
    assert.deepStrictEqual(executionScopeEvidenceIssues(f.root, 'demo', scopeOf('design-decision')), []);
    // 反例①：同一条绑定挂在**非**触发 kind 上，字节变化照旧判 stale（豁免不是整体关闭）。
    const context = executionScopeEvidenceIssues(f.root, 'demo', scopeOf('design-context'));
    assert(context.some(issue => issue.includes('input binding stale')), JSON.stringify(context));
    // 反例②：真实设计输入（artifact 绑定）变化仍判 stale——闭环后改契约不能蒙混完成。
    const design = { ...scopeOf('acceptance-definition'),
      obligations: [{ id: 'design:cu', kind: 'design-context', owner_phase: 'plan', applicability: 'required' as const, reason: 'approved contract', basis: [contracts], satisfied_by: [contracts] }] };
    assert.deepStrictEqual(executionScopeEvidenceIssues(f.root, 'demo', design), []);
    f.write('doc/features/demo/contracts.yaml', YAML.stringify({ ...f.contracts, version: '2' }));
    assert(executionScopeEvidenceIssues(f.root, 'demo', design).some(issue => issue.includes('input binding stale')), '真实设计输入变化被放行了');
  } },
  { name: 'D0.3 late verifier-confirmed candidate still writes the revision input to script-report', run(f) {
    // §5.1.2 ②：首次 writer 跑时 verifier 还没有产物，review 候选只有到**闭环重算**才成立。
    // `--sync-closure` 出口（harness-runner.ts 的 sync 分支）调用的就是同一个
    // finalizePhaseClosure → recomputeClosureRepairCandidates，因此这条断言同时覆盖它。
    const reportsDir = featurePhaseReportsDir(f.root, 'demo', 'review', frameworkRoot);
    fs.mkdirSync(reportsDir, { recursive: true });
    const row = { id: 'CR-001', files: 'doc/features/demo/acceptance.yaml', fix: '验收缺少 42 的边界条件，需 spec 补定义' };
    f.write('doc/features/demo/review/review-report.md', [
      '# Review 报告', '', '## 问题清单', '',
      '| ID | 严重程度 | 分类 | 涉及文件 | 修复建议 | 状态 |', '|---|---|---|---|---|---|',
      `| ${row.id} | MAJOR | 逻辑错误 | ${row.files} | ${row.fix} | 未关闭 |`, '',
      '## 结论', '', '结论：不通过', '',
    ].join('\n'));
    // 首次 writer：checks 全 PASS、verifier 尚无产物 → 此刻产不出候选，script-report 上没有修订输入。
    // 报告合法性 check 至少要跑过一条，否则 report_validity=UNVERIFIED 会按「报告不可信」
    // 整体抑制 review 候选（`repair-candidates.ts:574`）——那是既有信任闸，不是本条要测的东西。
    const passChecks = [
      { id: 'review_scope_to_design', category: 'traceability' as const, description: '审查范围覆盖设计', severity: 'BLOCKER' as const, status: 'PASS' as const, details: 'ok' },
      { id: 'issue_table_format', category: 'structure' as const, description: '问题清单表格式', severity: 'BLOCKER' as const, status: 'PASS' as const, details: 'ok' },
      { id: 'conclusion_with_verdict', category: 'structure' as const, description: '结论含裁决', severity: 'BLOCKER' as const, status: 'PASS' as const, details: 'ok' },
    ];
    const report = generateScriptReport(path.join(frameworkRoot, 'harness'), 'review', 'demo', f.root, passChecks, frameworkRoot);
    writeRunSummaryBase(f.root, report, frameworkRoot);
    const scriptReportPath = path.join(reportsDir, 'script-report.json');
    assert(!(JSON.parse(fs.readFileSync(scriptReportPath, 'utf8')).checks as Array<Record<string, unknown>>).some(check => check.scope_revision_input),
      '前提：verifier 未出产物时不该有修订输入');
    // 晚到的 verifier 逐条确认
    publishFixtureVerifierEvidence({
      projectRoot: f.root, reportsDir, feature: 'demo', phase: 'review', verdict: 'PASS',
      reportText: ['# Verifier 报告', '', '```issue-verification', `- issue: ${row.id}`, '  verdict: confirmed', `  evidence: ${row.files} ${row.fix}`, '```', ''].join('\n'),
    });
    const receipt = resolveReceiptFilePath(f.root, 'demo', 'review').path;
    fs.mkdirSync(path.dirname(receipt), { recursive: true });
    fs.writeFileSync(receipt, '# receipt\n\nclaimed: true\n', 'utf-8');
    // `--sync-closure` 的真实形态：**独立进程**——既没有 MAISON_GOAL_RUN_ID，调用方也不传
    // goalRunId（那个字段还管 requirement 血缘严格性，不能借）。run 身份只能来自本阶段
    // summary 自己记下的 run_id。这里就按那个形态跑。
    const priorRunEnv = process.env.MAISON_GOAL_RUN_ID;
    delete process.env.MAISON_GOAL_RUN_ID;
    try {
      assert.equal(JSON.parse(fs.readFileSync(path.join(reportsDir, 'summary.json'), 'utf8')).run_id, f.manifest.run_id, '前提：阶段 summary 记着本 run 身份');
      finalizePhaseClosure({
        projectRoot: f.root, frameworkRoot, feature: 'demo', phase: 'review',
        persistPhaseState: () => undefined,
        prepareEvidence: () => ({ extraInputs: [], extraOutputs: [], requirementSha: null }),
      });
    } finally {
      if (priorRunEnv === undefined) delete process.env.MAISON_GOAL_RUN_ID; else process.env.MAISON_GOAL_RUN_ID = priorRunEnv;
    }
    const carriers = (JSON.parse(fs.readFileSync(scriptReportPath, 'utf8')).checks as Array<Record<string, unknown>>)
      .filter(check => check.scope_revision_input);
    assert.equal(carriers.length, 1, '闭环重算没有把晚到候选的修订输入写进 script-report');
    // 归属由**真实**路径域判定得出（review 侧只有 spec.md / acceptance.yaml / spec/ 下的文件归 spec，
    // 且全部文件同域才产候选）；本例的 finding 指向真实验收文件，所以它才是 spec 归属。
    const closed = JSON.parse(fs.readFileSync(path.join(reportsDir, 'summary.json'), 'utf8')) as { repair_candidates?: Array<{ id: string; category: string; source_phase: string }> };
    assert.deepStrictEqual(closed.repair_candidates?.map(candidate => [candidate.id, candidate.category, candidate.source_phase]), [[row.id, 'spec', 'review']], JSON.stringify(closed.repair_candidates));
    const facts = (carriers[0].scope_revision_input as { facts: Array<{ id: string; reason: string; basis: Array<{ dependencies: Array<{ path: string }> }> }> }).facts;
    const fact = facts.find(item => item.id === `acceptance-definition:${row.id}`);
    assert(fact, JSON.stringify(facts.map(item => item.id)));
    // spec 归属产的是**验收定义**缺口，reason 自己说清需要 spec 裁决，basis 是候选自己的文件。
    assert.equal(fact!.reason, `需要 spec 裁决：${row.fix}`);
    assert.deepStrictEqual(fact!.basis.flatMap(binding => binding.dependencies.map(dep => path.relative(f.root, dep.path).replace(/\\/g, '/'))), [row.files]);
    const requested = (carriers[0].scope_revision_input as { request: { requested_phases: string[] } }).request.requested_phases;
    assert(requested.includes('spec'), JSON.stringify(requested));
  } },
  { name: 'D0.3 the real --sync-closure entry writes the revision input too', run(f) {
    // 第九轮必修：`--sync-closure` 出口此前只由 finalizer 直调覆盖。这里走**真实入口**
    // `runSyncClosureDetailed`（phase-state.ts 的 sync 分支）：独立进程形态——不设
    // `MAISON_GOAL_RUN_ID`、不传 goalIdentity，run 身份只能来自本阶段 summary 自己记的 run_id。
    // closure attestation 只把「含 src/main 的模块目录」当产品源码根（`addRoot`），空清单即
    // fail-closed。必须在生成 summary **之前**写好——summary 记的是当时的 worktree digest，
    // 之后再动产品源码会被 `slim_summary_worktree_stale` 正确判为「summary 属旧状态」。
    f.write('src/demo/src/main/value.ts', 'export const value: number = 42;' + String.fromCharCode(10));
    const reportsDir = featurePhaseReportsDir(f.root, 'demo', 'review', frameworkRoot);
    fs.mkdirSync(reportsDir, { recursive: true });
    const row = { id: 'CR-SYNC-001', files: 'doc/features/demo/acceptance.yaml', fix: '验收缺少同步闭环下的边界，需 spec 补' };
    f.write('doc/features/demo/review/review-report.md', [
      '# Review 报告', '', '## 问题清单', '',
      '| ID | 严重程度 | 分类 | 涉及文件 | 修复建议 | 状态 |', '|---|---|---|---|---|---|',
      `| ${row.id} | MAJOR | 逻辑错误 | ${row.files} | ${row.fix} | 未关闭 |`, '',
      '## 结论', '', '结论：不通过', '',
    ].join(String.fromCharCode(10)));
    const passChecks = [
      { id: 'review_scope_to_design', category: 'traceability' as const, description: '审查范围覆盖设计', severity: 'BLOCKER' as const, status: 'PASS' as const, details: 'ok' },
      { id: 'issue_table_format', category: 'structure' as const, description: '问题清单表格式', severity: 'BLOCKER' as const, status: 'PASS' as const, details: 'ok' },
      { id: 'conclusion_with_verdict', category: 'structure' as const, description: '结论含裁决', severity: 'BLOCKER' as const, status: 'PASS' as const, details: 'ok' },
    ];
    const report = generateScriptReport(path.join(frameworkRoot, 'harness'), 'review', 'demo', f.root, passChecks, frameworkRoot);
    writeRunSummaryBase(f.root, report, frameworkRoot);
    publishFixtureVerifierEvidence({
      projectRoot: f.root, reportsDir, feature: 'demo', phase: 'review', verdict: 'PASS',
      reportText: ['# Verifier 报告', '', '```issue-verification', `- issue: ${row.id}`, '  verdict: confirmed', `  evidence: ${row.files} ${row.fix}`, '```', ''].join(String.fromCharCode(10)),
    });
    // check-receipt 的既有判据要求阶段遥测凭证在 canonical 路径（trace_json_file_not_found）。
    fs.writeFileSync(path.join(reportsDir, 'trace.json'), JSON.stringify({ schema_version: '1.0.0', feature: 'demo', phase: 'review' }));
    // check-receipt 以**子进程**形态跑：它的 frameworkRoot 由**自身 `__dirname`** 解析
    // （`check-receipt.ts:241`），命令行不传；而它随后的 workflow 解析是从 projectRoot 起找
    // framework tree 的，所以夹具要在 `<projectRoot>/framework/workflows/` 备一份。
    fs.mkdirSync(path.join(f.root, 'framework', 'workflows'), { recursive: true });
    fs.mkdirSync(path.join(f.root, 'framework', 'harness', 'state'), { recursive: true });
    fs.cpSync(path.join(frameworkRoot, 'workflows'), path.join(f.root, 'framework', 'workflows'), { recursive: true });
    const priorRunEnv = process.env.MAISON_GOAL_RUN_ID;
    delete process.env.MAISON_GOAL_RUN_ID;
    let result: { exitCode: number; finalizationError?: string };
    try {
      result = runSyncClosureDetailed(path.join(frameworkRoot, 'harness'), f.root, 'demo', 'review', frameworkRoot);
    } finally {
      if (priorRunEnv === undefined) delete process.env.MAISON_GOAL_RUN_ID; else process.env.MAISON_GOAL_RUN_ID = priorRunEnv;
    }
    assert.equal(result.exitCode, 0, 'sync-closure 未闭环：' + (result.finalizationError ?? ''));
    const carriers = (JSON.parse(fs.readFileSync(path.join(reportsDir, 'script-report.json'), 'utf8')).checks as Array<Record<string, unknown>>)
      .filter(check => check.scope_revision_input);
    assert.equal(carriers.length, 1, '真实 --sync-closure 出口没有把修订输入写进 script-report');
    const facts = (carriers[0].scope_revision_input as { facts: Array<{ id: string }> }).facts;
    assert(facts.some(fact => fact.id === `acceptance-definition:${row.id}`), JSON.stringify(facts.map(fact => fact.id)));
  } },
  { name: 'D0.2 generated candidate is directly usable by prepare-run and is byte-identical on regeneration', run(f) {
    // 主 Agent 只给四项输入；绑定 / 指纹 / 派生全由机器完成。
    const args = {
      projectRoot: f.root, frameworkRoot, feature: 'demo',
      completionTarget: 'feature' as const,
      requestedResults: ['value is 42'],
      requestedPhases: ['coding'],
      impact: { userVisibleBehaviorChange: false, reason: '仅内部取值变化', basisPaths: ['src/demo/value.ts'] },
    };
    const first = prepareFeatureScopeCandidate(args);
    assert.equal(first.state, 'created');
    assert(first.written);
    // 生成的绑定与生产解析器同源：候选里的 contracts 绑定必须与 resolveCapabilityInputs 逐字相同
    const live = resolveCapabilityInputs({ projectRoot: f.root, frameworkRoot, feature: 'demo', phase: 'plan', track: 'full',
      inputContext: { schema_version: '1.1', subject: { feature: 'demo' }, obligations: {}, required_outputs: [] } }).inputs!.values.contracts;
    assert(live.state === 'resolved');
    const design = first.candidate.facts.find(fact => fact.kind === 'design-context')!;
    assert.deepStrictEqual(design.basis[0], live.binding, '候选绑定与生产解析器不同源');
    // 请求动作含 coding → 必须有 implementation 义务（**不由 completion_target 决定**）
    assert(first.candidate.facts.some(fact => fact.kind === 'implementation'), JSON.stringify(first.candidate.facts.map(fact => fact.kind)));
    assert(first.scope.phase_chain.includes('coding'));
    // 候选可直接被 prepare-run 冻结（同一 resolveFeatureExecutionScope 读取面）
    const prepared = prepareGoalModeRun({ projectRoot: f.root, frameworkRoot, feature: 'demo', adapter: 'codex', runId: 'p4-from-candidate', requirement: 'value is 42' });
    assert.deepStrictEqual(prepared.manifest.execution_scope!.phase_chain, first.scope.phase_chain);
    // 同输入重跑：字节不变、不重写
    const bytes = fs.readFileSync(first.path);
    const again = prepareFeatureScopeCandidate(args);
    assert.equal(again.state, 'unchanged');
    assert.equal(again.written, false);
    assert(fs.readFileSync(first.path).equals(bytes), '重跑改写了候选字节');
    // 手改后重跑：报差异、不覆盖；显式 --overwrite 才写
    const edited = YAML.parse(fs.readFileSync(first.path, 'utf8'));
    edited.execution_scope.request.requested_results = ['hand edited'];
    fs.writeFileSync(first.path, YAML.stringify(edited));
    const conflicted = prepareFeatureScopeCandidate(args);
    assert.equal(conflicted.state, 'differs');
    assert.equal(conflicted.written, false);
    assert.deepStrictEqual(YAML.parse(fs.readFileSync(first.path, 'utf8')).execution_scope.request.requested_results, ['hand edited'], '手改被静默覆盖了');
    assert.equal(prepareFeatureScopeCandidate({ ...args, overwrite: true }).state, 'created');
  } },
  { name: 'D0.2 verification-only request yields no implementation obligation', run(f) {
    // 已有有效实现、只缺 review / UT 的请求：链为 [review, ut]，候选不含 implementation。
    const prepared = prepareFeatureScopeCandidate({
      projectRoot: f.root, frameworkRoot, feature: 'demo',
      completionTarget: 'feature',
      requestedResults: ['verify the existing implementation'],
      requestedPhases: ['review', 'ut'],
      impact: { userVisibleBehaviorChange: false, reason: '只补验证', basisPaths: ['src/demo/value.ts'] },
    });
    assert(!prepared.candidate.facts.some(fact => fact.kind === 'implementation'), '只验证的请求生成了 implementation 义务');
    assert.deepStrictEqual(prepared.scope.phase_chain, ['review', 'ut']);
    assert(prepared.explanation.includes('review → ut'), prepared.explanation);
  } },
  { name: 'D0.2 machine refuses to guess the request action', run(f) {
    // 动作不明确一律要求显式 --requested-phases（不引入任何动作分类器）；
    // 机器只呈现既有阶段证据检查的事实，判断权留给显式请求。
    assert.throws(() => prepareFeatureScopeCandidate({
      projectRoot: f.root, frameworkRoot, feature: 'demo', completionTarget: 'feature',
      requestedResults: ['value is 42'], requestedPhases: [],
    }), /requested-phases/);
    const health = featureScopePhaseHealth(f.root, frameworkRoot, 'demo');
    assert(health.length > 0 && health.every(entry => typeof entry.phase === 'string' && 'evidence_ok' in entry && 'freshness' in entry), JSON.stringify(health));
  } },
  { name: 'D0.2 NEXT_STEP projects only in-scope obligations', run(f) {
    // 用户可见说明复用**既有** assess → NEXT_STEP 渲染（不重造 renderer）：assess 读有效范围，
    // 因此 gaps 与推荐阶段都不得越出该范围。
    const scope = loadEffectiveExecutionScope(f.root, 'demo', f.manifest.run_id)!;
    const inScope = new Set([...scope.phase_chain, ...scope.reused_phases.map(reuse => reuse.phase)]);
    const result = assessFeature({
      projectRoot: f.root, frameworkRoot, feature: 'demo', runId: f.manifest.run_id,
      authorization: { mode: 'goal_mode' }, writeProjection: false,
    });
    for (const gap of result.gaps) {
      assert(inScope.has(gap.phase), `NEXT_STEP 会呈现范围外义务：${gap.phase}（范围=${[...inScope].join(',')}）`);
    }
    if (result.recommendation.phase) assert(inScope.has(result.recommendation.phase), `推荐了范围外阶段：${result.recommendation.phase}`);
    const rendered = formatAssessNextStep(result, { phase: 'coding', mode: 'goal_mode', status: 'in_progress' });
    assert(rendered.startsWith('NEXT_STEP') && rendered.includes('END_NEXT_STEP'), rendered);
    assert(rendered.includes(`recommendation=${result.recommendation.phase ? `${result.recommendation.action}:${result.recommendation.phase}` : result.recommendation.action}`), rendered);
  } },
  { name: 'D0.3 correction-init prints the two legal routes and no revalidate path for an out-of-scope phase', run(f) {
    // 走**真实命令**（runCorrectionInit），捕获 stdout：只说范围外 + 两条入口，
    // 不打印指向范围外阶段的通用 --revalidate，也不产出提议 / 修订事件。
    const before = executionScopeFingerprint(loadEffectiveExecutionScope(f.root, 'demo', f.manifest.run_id)!);
    const lines: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
    let exitCode: number;
    try {
      exitCode = runCorrectionInit(f.root, {
        requestedFeature: 'demo', frameworkRoot,
        answers: { requirement_changed: true, contract_changed: false, code_change_needed: false },
        requestText: '验收漏了 42 的边界',
      });
    } finally { console.log = original; }
    const out = lines.join('\n');
    assert.equal(exitCode, 0, out);
    assert(out.includes('不在本 run 的有效范围内'), out);
    assert(out.includes('(a)') && out.includes('(b)'), out);
    assert(!out.includes('--revalidate'), '范围外仍打印了通用 revalidate 指引：\n' + out);
    assert(!out.includes('backtrack_target_absent'), out);
    assert.equal(executionScopeFingerprint(loadEffectiveExecutionScope(f.root, 'demo', f.manifest.run_id)!), before, '修正命令改动了有效范围');
  } },
  { name: 'D0.2 the CLI accepts --prepare-scope without a run mode and rejects half inputs', run(f) {
    // 经**真实 CLI 子进程**：--prepare-scope 不创建 run、也不 attach，因此不该被 attended 门拦；
    // 影响判断是完整一项输入，半份必须拒绝。
    const cli = (args: string[]): { status: number | null; out: string } => {
      const result = spawnSync(process.execPath, ['-r', require.resolve('ts-node/register/transpile-only'),
        path.join(frameworkRoot, 'harness/scripts/goal-mode-entry.ts'), ...args],
        { cwd: f.root, encoding: 'utf8', timeout: 120000, env: { ...process.env, TS_NODE_PROJECT: path.join(frameworkRoot, 'harness/tsconfig.json'), MAISON_GOAL_RUN_ID: '' } });
      return { status: result.status, out: `${result.stdout ?? ''}${result.stderr ?? ''}` };
    };
    const base = ['--prepare-scope', '--project-root', f.root, '--framework-root', frameworkRoot, '--feature', 'demo',
      '--completion-target', 'feature', '--requested-results', 'value is 42'];
    const ok = cli([...base, '--requested-phases', 'review,ut', '--overwrite']);
    assert.equal(ok.status, 0, ok.out);
    assert(ok.out.includes('scope_candidate_prepared'), ok.out);
    assert(ok.out.includes('"phase_chain"'), ok.out);
    // 动作缺席：拒绝 + 打印既有阶段证据体检（不猜动作）
    const guessing = cli(base);
    assert.notEqual(guessing.status, 0, guessing.out);
    assert(guessing.out.includes('phase_evidence_health'), guessing.out);
    // 半份影响判断：拒绝（裸传 --impact-behavior-change 也算「传了但没给值」，同样拒绝）
    const halfImpact = cli([...base, '--requested-phases', 'review,ut', '--impact-basis', 'src/demo/value.ts']);
    assert.notEqual(halfImpact.status, 0, halfImpact.out);
    assert(halfImpact.out.includes('--impact-behavior-change'), halfImpact.out);
    const bareFlag = cli([...base, '--requested-phases', 'review,ut', '--impact-behavior-change']);
    assert.notEqual(bareFlag.status, 0, bareFlag.out);
    assert(bareFlag.out.includes('必须是 true 或 false'), bareFlag.out);
    // 两个旗标互斥：同时给出立即拒绝，且**不得**创建任何 run manifest
    const both = cli([...base, '--requested-phases', 'review,ut', '--prepare-run', '--run-mode', 'attended',
      '--adapter', 'codex', '--run-id', 'p4-mutex', '--requirement', 'value is 42']);
    assert.notEqual(both.status, 0, both.out);
    assert(both.out.includes('互斥'), both.out);
    assert(!fs.existsSync(path.join(f.root, 'doc/features/demo/goal-runs/p4-mutex')), '互斥拒绝后仍创建了 run');
  } },
  { name: 'D0.2 missing acceptance becomes an unknown duty, and a code change without a write set is refused', run(f) {
    // 缺验收 → acceptance-context unknown 并进 unresolved（owner=spec），不静默省略、不造蓝图。
    fs.rmSync(path.join(f.root, 'doc/features/demo/acceptance.yaml'), { force: true });
    const prepared = prepareFeatureScopeCandidate({
      projectRoot: f.root, frameworkRoot, feature: 'demo', completionTarget: 'feature',
      requestedResults: ['value is 42'], requestedPhases: ['review'],
    });
    const pending = prepared.candidate.facts.find(fact => fact.kind === 'acceptance-context');
    assert(pending && pending.applicability === 'unknown', JSON.stringify(prepared.candidate.facts.map(fact => [fact.id, fact.applicability])));
    assert(prepared.scope.unresolved.some(gap => gap.obligation_id === pending!.id && gap.owner === 'spec'), JSON.stringify(prepared.scope.unresolved));
    // 请求含实现阶段但契约没有可核验写集 → 生成阶段就 fail-closed，不把问题推到 coding。
    f.write('doc/features/demo/contracts.yaml', YAML.stringify({ ...f.contracts, files: [] }));
    assert.throws(() => prepareFeatureScopeCandidate({
      projectRoot: f.root, frameworkRoot, feature: 'demo', completionTarget: 'feature',
      requestedResults: ['value is 42'], requestedPhases: ['coding'],
    }), /可核验的写集|无法解析为项目内绑定/);
  } },
  { name: 'D0.3 the responsible phase comes from the run scope, not from the current active workflow', async run(f) {
    // workflow 漂移（本 run 出生后 active_workflow 被改）时，责任阶段仍必须由**本 run 的范围**
    // 决定——范围里的 owner_phase 就是这一轮解析出来的责任映射。读当前 workflow 会选错或选不到。
    f.facts();
    f.write('src/demo/value.ts', 'export const value: number = 42;\n');
    f.write('src/demo/resources/base/media/unapproved.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');
    const checks = await coding.check(f.context('coding'));
    const candidates = buildSummaryRepairCandidates({ phase: 'coding', checks, reportValidity: 'PASS', reviewReportText: null, verifierReportText: null });
    assert(candidates.some(candidate => candidate.category === 'plan'), JSON.stringify(candidates));
    const configPath = path.join(f.root, 'framework.config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    fs.writeFileSync(configPath, JSON.stringify({ ...config, active_workflow: 'a-workflow-that-does-not-exist' }));
    clearFrameworkConfigCache();
    try {
      const produced = scopeRevisionInputFromRepairCandidates(candidates, { projectRoot: f.root, frameworkRoot, feature: 'demo', runId: f.manifest.run_id });
      assert(produced, 'workflow 漂移后产不出修订输入了——责任阶段不该依赖当前 workflow');
      assert(produced!.input.request.requested_phases.includes('plan'), JSON.stringify(produced!.input.request.requested_phases));
    } finally {
      fs.writeFileSync(configPath, JSON.stringify(config));
      clearFrameworkConfigCache();
    }
  } },
  { name: 'D0.3 an unwritable carrier keeps the closure open instead of committing a half state', run(f) {
    // 回写失败 = runtime 看不到修订输入。若还提交 closed summary，就留下「候选在 summary、
    // 修订永不发生」的半截状态——必须 fail-closed。
    const reportsDir = featurePhaseReportsDir(f.root, 'demo', 'review', frameworkRoot);
    fs.mkdirSync(reportsDir, { recursive: true });
    const row = { id: 'CR-009', files: 'doc/features/demo/acceptance.yaml', fix: '验收缺边界，需 spec 补定义' };
    const checks = [
      { id: 'review_scope_to_design', category: 'traceability' as const, description: '审查范围覆盖设计', severity: 'BLOCKER' as const, status: 'PASS' as const, details: 'ok' },
      { id: 'issue_table_format', category: 'structure' as const, description: '问题清单表格式', severity: 'BLOCKER' as const, status: 'PASS' as const, details: 'ok' },
      { id: 'conclusion_with_verdict', category: 'structure' as const, description: '结论含裁决', severity: 'BLOCKER' as const, status: 'PASS' as const, details: 'ok' },
    ];
    const report = generateScriptReport(path.join(frameworkRoot, 'harness'), 'review', 'demo', f.root, checks, frameworkRoot);
    writeRunSummaryBase(f.root, report, frameworkRoot);
    // base summary 已带上一轮确认过的候选；本轮 script-report 坏了（读不出 checks）。
    const summaryPath = path.join(reportsDir, 'summary.json');
    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
    summary.repair_candidates = [{ id: row.id, category: 'spec', files: [row.files], summary: row.fix, item_fingerprint: 'a'.repeat(64), source_phase: 'review' }];
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
    fs.writeFileSync(path.join(reportsDir, 'script-report.json'), '{ not json');
    const receipt = resolveReceiptFilePath(f.root, 'demo', 'review').path;
    fs.mkdirSync(path.dirname(receipt), { recursive: true });
    fs.writeFileSync(receipt, '# receipt\n\nclaimed: true\n', 'utf-8');
    assert.throws(() => finalizePhaseClosure({
      projectRoot: f.root, frameworkRoot, feature: 'demo', phase: 'review',
      persistPhaseState: () => undefined,
      prepareEvidence: () => ({ extraInputs: [], extraOutputs: [], requirementSha: null }),
    }), /script-report/);
    assert.equal(JSON.parse(fs.readFileSync(summaryPath, 'utf8')).closure_status, 'open', '载体写不成却把阶段提交成 closed 了');
  } },
  { name: 'D0.2 a feature with only a requirement still gets a candidate that freezes into [spec, plan]', run(f) {
    // 无蓝图合法入口（非 CU feature）：没有 contracts.yaml / acceptance.yaml，只有需求。
    // 来源用既有 resolver 的 `derive.requirement`（不自造 provider、不伪造蓝图）；
    // 设计与验收各落一条 unknown，由既有 definition-gap 通路把 coding 挂进 needed_by。
    fs.rmSync(path.join(f.root, 'doc/features/demo/contracts.yaml'), { force: true });
    fs.rmSync(path.join(f.root, 'doc/features/demo/acceptance.yaml'), { force: true });
    const requirement = '把 value 改成 42 并交付';
    const prepared = prepareFeatureScopeCandidate({
      projectRoot: f.root, frameworkRoot, feature: 'demo', completionTarget: 'feature',
      requestedResults: ['value is 42'], requestedPhases: ['spec', 'plan', 'coding', 'review', 'ut'],
      requirement, overwrite: true,
    });
    const kinds = prepared.candidate.facts.map(fact => [fact.kind, fact.applicability]);
    assert.deepStrictEqual(kinds, [['design-context', 'unknown'], ['acceptance-context', 'unknown']], JSON.stringify(kinds));
    // 缺口的来源是**需求绑定**（经生产 resolver 解析，不是手拼）
    const gapBasis = prepared.candidate.facts[0].basis[0];
    assert(gapBasis && gapBasis.source.kind === 'derive' && gapBasis.source.provider_id === 'derive.requirement', JSON.stringify(gapBasis));
    assert(/^[0-9a-f]{64}$/.test(gapBasis.content_fingerprint));
    // 出生链只剩调查阶段；下游义务挂在缺口的 needed_by 里，等设计产出后同 run 修订补链
    assert.deepStrictEqual(prepared.scope.phase_chain, ['spec', 'plan']);
    const owners = prepared.scope.unresolved.map(gap => [gap.obligation_id, gap.owner]);
    assert(owners.some(([id, owner]) => String(id).startsWith('acceptance-context') && owner === 'spec'), JSON.stringify(owners));
    assert(owners.some(([id, owner]) => String(id).startsWith('design-context') && owner === 'plan'), JSON.stringify(owners));
    assert(prepared.scope.unresolved.some(gap => gap.needed_by.includes('coding')), JSON.stringify(prepared.scope.unresolved));
    // 候选可直接被 --prepare-run 冻结（需求文本同源，否则绑定重解析即 stale）
    const run = prepareGoalModeRun({ projectRoot: f.root, frameworkRoot, feature: 'demo', adapter: 'codex', runId: 'p4-no-blueprint', requirement });
    assert.deepStrictEqual(run.manifest.execution_scope!.phase_chain, ['spec', 'plan']);
    // 边界反例：同一 feature 跳过设计阶段直接 coding、又没有契约写集 → 拒绝（必修 2 的适用面）
    assert.throws(() => prepareFeatureScopeCandidate({
      projectRoot: f.root, frameworkRoot, feature: 'demo', completionTarget: 'feature',
      requestedResults: ['value is 42'], requestedPhases: ['coding'], requirement, overwrite: true,
    }), /跳过设计阶段/);
  } },
  { name: 'D0.2 the candidate proves which requirement it was computed for, and a fork or a deleted binding is refused', run(f) {
    // provenance 不是「缺产物时才有」：**任何**候选都带需求绑定，冻结时与本次 --requirement
    // 重解析比对。有 contracts / acceptance 的正常 feature 同样适用。
    const requirement = '把 value 改成 42 并交付';
    const prepared = prepareFeatureScopeCandidate({
      projectRoot: f.root, frameworkRoot, feature: 'demo', completionTarget: 'feature',
      requestedResults: ['value is 42'], requestedPhases: ['coding'], requirement, overwrite: true,
      impact: { userVisibleBehaviorChange: false, reason: '仅内部取值变化', basisPaths: ['src/demo/value.ts'] },
    });
    const provenance = prepared.candidate.request.requirement_basis;
    assert(provenance && provenance.source.kind === 'derive' && provenance.source.provider_id === 'derive.requirement', JSON.stringify(provenance));
    assert(prepared.candidate.facts.some(fact => fact.kind === 'design-context' && fact.applicability === 'required'), '前提：本 feature 有设计与验收产物');
    const workflow12 = resolveWorkflowSpec(f.root, { frameworkRoot });
    // 同一句需求 → 冻结通过
    assert(resolveFeatureExecutionScope(f.root, 'demo', workflow12, frameworkRoot, requirement));
    // 换一句需求 → 需求绑定重解析失败，stale 拒绝（不静默换需求继续）
    assert.throws(() => resolveFeatureExecutionScope(f.root, 'demo', workflow12, frameworkRoot, '改成 43'), /stale/, '换需求后仍然冻结通过了');
    // 删掉绑定 → fail-closed（手写候选不予放行）
    const declPath = featureTrackDeclPath(f.root, 'demo');
    const doc = YAML.parse(fs.readFileSync(declPath, 'utf8'));
    delete doc.execution_scope.request.requirement_basis;
    fs.writeFileSync(declPath, YAML.stringify(doc));
    assert.throws(() => resolveFeatureExecutionScope(f.root, 'demo', workflow12, frameworkRoot, requirement), /requirement_basis/, '删掉 provenance 绑定后仍然冻结通过了');
    // 换成一条自己捏的绑定 → 同样走既有 verifyBasisBinding 判 stale
    doc.execution_scope.request.requirement_basis = { ...provenance, content_fingerprint: '0'.repeat(64) };
    fs.writeFileSync(declPath, YAML.stringify(doc));
    assert.throws(() => resolveFeatureExecutionScope(f.root, 'demo', workflow12, frameworkRoot, requirement), /stale/, '替换 provenance 绑定后仍然冻结通过了');
    // 换成**同一 feature 的另一条合法绑定**（contracts@1）——它自己能重解析成功，所以只核
    // 「绑定还成立吗」会放行，等于 provenance 被绕过。必须按形态先判掉。
    const design = prepared.candidate.facts.find(fact => fact.kind === 'design-context')!.basis[0];
    assert(design && design.input_id === 'contracts', JSON.stringify(design));
    doc.execution_scope.request.requirement_basis = design;
    fs.writeFileSync(declPath, YAML.stringify(doc));
    assert.throws(() => resolveFeatureExecutionScope(f.root, 'demo', workflow12, frameworkRoot, requirement),
      /derive\.requirement/, '用合法的 contracts 绑定冒充需求 provenance 后仍然冻结通过了');
    // 同一条替换在**换需求**时也照样拒（不是靠内容比对偶然挡住的）
    assert.throws(() => resolveFeatureExecutionScope(f.root, 'demo', workflow12, frameworkRoot, '改成 43'), /derive\.requirement/);
  } },
  { name: 'D0.2 declared design without a verifiable write set becomes a plan gap, not an empty implementation duty', run(f) {
    // 必修 1：contracts 存在但 `files: []`（schema 允许），请求 [plan, coding]。
    // 旧行为：design-context 记成 required（无缺口）→ resolver 自动补一条 basis 为空的
    // implementation 请求标记 → coding 照样进链。现在应与「压根没有契约」同路：plan 的缺口。
    const contractsPath = path.join(f.root, 'doc/features/demo/contracts.yaml');
    const contracts = YAML.parse(fs.readFileSync(contractsPath, 'utf8'));
    contracts.files = [];
    fs.writeFileSync(contractsPath, YAML.stringify(contracts));
    const prepared = prepareFeatureScopeCandidate({
      projectRoot: f.root, frameworkRoot, feature: 'demo', completionTarget: 'feature',
      requestedResults: ['value is 42'], requestedPhases: ['plan', 'coding'],
      requirement: '把 value 改成 42', overwrite: true,
    });
    const design = prepared.candidate.facts.find(fact => fact.kind === 'design-context')!;
    assert.equal(design.applicability, 'unknown', JSON.stringify(design));
    assert(!prepared.candidate.facts.some(fact => fact.kind === 'implementation'), '仍然产出了实现义务');
    // resolver 仍会为「用户点名的阶段」留一条 basis 为空的请求标记——那是既有机制（无蓝图那条
    // 合法路径也有同一条）。判据是**缺口有没有挡住它**：coding 不进链、挂在 needed_by 上。
    assert(!prepared.scope.phase_chain.includes('coding'), JSON.stringify(prepared.scope.phase_chain));
    assert(prepared.scope.unresolved.some(gap => gap.needed_by.includes('coding')), JSON.stringify(prepared.scope.unresolved));
    // 同一场景**带完整 impact**：impact 目标相关性无从核验（写集还没有），但这不该变成
    // 「范围声明有错」当场失败——definition-gap 先判，coding 照样挡在 needed_by 上。
    const withImpact = prepareFeatureScopeCandidate({
      projectRoot: f.root, frameworkRoot, feature: 'demo', completionTarget: 'feature',
      requestedResults: ['value is 42'], requestedPhases: ['plan', 'coding'],
      requirement: '把 value 改成 42', overwrite: true,
      impact: { userVisibleBehaviorChange: false, reason: '仅内部取值变化', basisPaths: ['src/demo/value.ts'] },
    });
    const impactDesign = withImpact.candidate.facts.find(fact => fact.kind === 'design-context')!;
    assert.equal(impactDesign.applicability, 'unknown', JSON.stringify(impactDesign));
    assert(!withImpact.scope.phase_chain.includes('coding'), JSON.stringify(withImpact.scope.phase_chain));
    assert(withImpact.scope.unresolved.some(gap => gap.needed_by.includes('coding')), JSON.stringify(withImpact.scope.unresolved));
    // 影响判断此时不得被采信去裁剪设备验证：device 落 unknown，testing 不被裁掉。
    const device = withImpact.scope.obligations.find(o => o.kind === 'device-evidence')!;
    assert.equal(device.applicability, 'unknown', JSON.stringify(device));
    assert(/无可核验范围/.test(device.reason), device.reason);
    // 跳过设计阶段的那条请求仍然当场拒（收紧不得越界成「全都拒」）
    assert.throws(() => prepareFeatureScopeCandidate({
      projectRoot: f.root, frameworkRoot, feature: 'demo', completionTarget: 'feature',
      requestedResults: ['value is 42'], requestedPhases: ['coding'], requirement: '把 value 改成 42', overwrite: true,
    }), /跳过设计阶段/);
  } },
  { name: 'D0.2 a hand-written definition gap is recomputed from its sources, not believed', run(f) {
    // 第六轮阻断：手写一条 `acceptance-context: unknown` 就能伪造缺口，把 §4.1.3 子情形 (a)
    // 的 fail-closed 顶掉。D0.1「不采信自报」扩到两个定义类 kind——冻结时按来源重算。
    const requirement = '把 value 改成 42 并交付';
    const contractsPath = path.join(f.root, 'doc/features/demo/contracts.yaml');
    const contracts = YAML.parse(fs.readFileSync(contractsPath, 'utf8'));
    contracts.files = [];
    fs.writeFileSync(contractsPath, YAML.stringify(contracts));
    // 先按机器口径生成一份合法候选（请求跳过设计阶段会被生成期拒，所以带上 plan）
    prepareFeatureScopeCandidate({
      projectRoot: f.root, frameworkRoot, feature: 'demo', completionTarget: 'feature',
      requestedResults: ['value is 42'], requestedPhases: ['plan', 'coding'], requirement, overwrite: true,
    });
    const declPath = featureTrackDeclPath(f.root, 'demo');
    const doc = YAML.parse(fs.readFileSync(declPath, 'utf8'));
    const workflow12 = resolveWorkflowSpec(f.root, { frameworkRoot });
    // 前提：本 feature 的 acceptance.yaml **确实存在且合法**
    assert(fs.existsSync(path.join(f.root, 'doc/features/demo/acceptance.yaml')), '前提：验收产物在场');
    const accepted = doc.execution_scope.facts.find((fact: { kind: string }) => fact.kind === 'acceptance-context');
    assert.equal(accepted.applicability, 'required', JSON.stringify(accepted));
    // 手改：把它篡改成 unknown（伪造一条 spec 的定义缺口），并补一份完整 impact + 只请求 coding
    accepted.applicability = 'unknown';
    accepted.reason = '手写的假缺口';
    delete accepted.satisfied_by;
    doc.execution_scope.facts = doc.execution_scope.facts.filter((fact: { kind: string }) => fact.kind !== 'design-context');
    doc.execution_scope.request.requested_phases = ['coding'];
    doc.execution_scope.request.impact = { user_visible_behavior_change: false, reason: '仅内部取值变化',
      basis: [accepted.basis[0]] };
    fs.writeFileSync(declPath, YAML.stringify(doc));
    // 重算把它打回 required → 没有缺口 → (a) 照常触发
    assert.throws(() => resolveFeatureExecutionScope(f.root, 'demo', workflow12, frameworkRoot, requirement),
      /范围未声明可核验的写集/, '手写的假缺口顶掉了 (a) 的 fail-closed');
    // 反向边界：验收**确实不存在**时，重算结果与「写着 unknown」一致，照常进 definition-gap
    // （重算只改 applicability，不会把真缺口也抹平）。
    fs.rmSync(path.join(f.root, 'doc/features/demo/acceptance.yaml'), { force: true });
    const regenerated = prepareFeatureScopeCandidate({
      projectRoot: f.root, frameworkRoot, feature: 'demo', completionTarget: 'feature',
      requestedResults: ['value is 42'], requestedPhases: ['plan', 'coding'], requirement, overwrite: true,
    });
    assert.equal(regenerated.candidate.facts.find(fact => fact.kind === 'acceptance-context')!.applicability, 'unknown');
    const scope = resolveFeatureExecutionScope(f.root, 'demo', workflow12, frameworkRoot, requirement)!;
    const gap = scope.obligations.find(o => o.kind === 'acceptance-context')!;
    assert.equal(gap.applicability, 'unknown', JSON.stringify(gap));
    assert(scope.unresolved.some(item => item.obligation_id === gap.id), JSON.stringify(scope.unresolved));
  } },
  { name: 'D0.2 the R3 design-fact proposal recomputes its definition duties too', run(f) {
    // 第七轮阻断 2 的另一半：R3（设计事实提案）同样在**提案副本**上按来源重算，
    // 否则冻结范围里那条 unknown 会被原样搬进提案，继续伪装成缺口。
    const workflow = resolveWorkflowSpec(f.root, { frameworkRoot });
    const options = { projectRoot: f.root, frameworkRoot, feature: 'demo', phase: 'coding', track: 'full' as const,
      requirement: 'make value 42', testTargets: ['src/demo/value.ts'],
      inputContext: { schema_version: '1.1' as const, subject: { feature: 'demo' }, obligations: {}, required_outputs: [] } };
    const initial = resolveCapabilityInputs(options);
    const bound = (id: string) => { const value = initial.inputs!.values[id]; assert(value.state === 'resolved', id); return value.binding; };
    // 冻结一个**带 unknown 验收责任**的范围（验收产物其实在场且合法）
    const scopeInput: ExecutionScopeInput = { request: { completion_target: 'feature', requested_results: ['delivery'], requested_phases: ['coding'],
      impact: { user_visible_behavior_change: false, reason: 'fixture: unit verification only', basis: [bound('codebase')] } }, facts: [
      { id: 'implementation', kind: 'implementation', applicability: 'required', reason: 'authorized change', basis: [bound('codebase')] },
      { id: 'acceptance', kind: 'acceptance-context', applicability: 'unknown', reason: '手写的假缺口', basis: [bound('acceptance')] },
    ], contract_fingerprints: [] };
    const frozen = resolveExecutionScope(scopeInput, workflow, readScopeAcceptance(f.root, scopeInput, { feature: 'demo', frameworkRoot }),
      collectResolvedScopeFacts(scopeInput, { projectRoot: f.root, feature: 'demo', frameworkRoot, requirement: options.requirement }));
    assert(frozen.unresolved.some(gap => gap.obligation_id === 'acceptance'), JSON.stringify(frozen.unresolved));
    const manifest = buildGoalManifestFromInput({ feature: 'demo', run_id: 'p4-r3', requirement: options.requirement, execution_scope: frozen,
      chain_override: frozen.phase_chain, unattended: { write_mode: 'full-access', approval_mode: 'never' } }, { projectRoot: f.root });
    createGoalRun({ projectRoot: f.root, manifest, chain: frozen.phase_chain });
    // 出生范围里**没有**设计绑定（plan 本轮才产出设计内容）——这正是 R3 会发起提案的形态。
    // R3 的承载阶段是**产出设计**的阶段（plan）：coding 的 contracts 是 run-bound 快照，
    // 改动后直接判 stale，根本走不到提案这一步。
    const bridge = resolveCapabilityResolutionEntryInput({ projectRoot: f.root, frameworkRoot, feature: 'demo', phase: 'plan', featuresDir: 'doc/features', goalRunId: 'p4-r3' });
    const resolved = resolveCapabilityInputs({ ...options, ...bridge, phase: 'plan' });
    const loader = new SpecLoader(f.root, undefined, undefined, frameworkRoot);
    const ctx = { subject: 'feature', projectRoot: f.root, frameworkRoot, frameworkRel: '', harnessRoot: path.join(frameworkRoot, 'harness'),
      feature: 'demo', phase: 'plan', phaseRule: loader.loadPhaseRule('plan'), featureSpec: loader.loadFeatureSpec('demo', resolved.inputs),
      resolvedInputs: resolved.inputs, factsContext: bridge.factsContext,
      resolvedProfile: { name: 'p4-test', profileDir: f.profileDir, yaml: {} as never, phasesDisabled: new Set(), capabilities: {}, personalPrerequisites: {} } } as unknown as CheckContext;
    const results = designScopeRevisionChecks(ctx, []);
    assert.equal(results.length, 1, JSON.stringify(results));
    const proposal = results[0].scope_revision_input as ExecutionScopeInput;
    const acceptance = proposal.facts.find(fact => fact.kind === 'acceptance-context')!;
    assert.equal(acceptance.applicability, 'required', JSON.stringify(acceptance));
    // basis 被换成机器解析出来的验收绑定（结论的来源必须是机器算的那一条）
    assert.equal(acceptance.basis.length, 1);
    assert.equal(acceptance.basis[0].input_id, 'acceptance');
    assert.equal(acceptance.basis[0].source.kind, 'artifact');
  } },
  { name: 'D0.2 both definition kinds are recomputed, and a foreign binding does not survive as their source', run(f) {
    // 必修 2：第六轮用例只覆盖了 acceptance-context。design-context 的分支、以及
    // 「把 basis 换成另一条合法绑定」都必须各自有断言。
    const requirement = '把 value 改成 42 并交付';
    prepareFeatureScopeCandidate({
      projectRoot: f.root, frameworkRoot, feature: 'demo', completionTarget: 'feature',
      requestedResults: ['value is 42'], requestedPhases: ['plan', 'coding'], requirement, overwrite: true,
    });
    const declPath = featureTrackDeclPath(f.root, 'demo');
    const doc = YAML.parse(fs.readFileSync(declPath, 'utf8'));
    const design = doc.execution_scope.facts.find((fact: { kind: string }) => fact.kind === 'design-context');
    const acceptance = doc.execution_scope.facts.find((fact: { kind: string }) => fact.kind === 'acceptance-context');
    assert(design && acceptance, JSON.stringify(doc.execution_scope.facts));
    // 两条都手改成 unknown，并把 basis 换成**对方**那条合法绑定（绑定本身能重解析成功）
    const acceptanceBinding = acceptance.basis[0];
    const contractsBinding = design.basis[0];
    for (const [fact, foreign] of [[design, acceptanceBinding], [acceptance, contractsBinding]] as const) {
      fact.applicability = 'unknown';
      fact.reason = '手写的假缺口';
      fact.basis = [foreign];
      fact.satisfied_by = [foreign];
    }
    fs.writeFileSync(declPath, YAML.stringify(doc));
    const workflow12 = resolveWorkflowSpec(f.root, { frameworkRoot });
    const scope = resolveFeatureExecutionScope(f.root, 'demo', workflow12, frameworkRoot, requirement)!;
    for (const [kind, inputId] of [['design-context', 'contracts'], ['acceptance-context', 'acceptance']] as const) {
      const obligation = scope.obligations.find(o => o.kind === kind)!;
      assert.equal(obligation.applicability, 'required', kind + ': ' + JSON.stringify(obligation));
      assert.equal(obligation.basis.length, 1, kind);
      assert.equal(obligation.basis[0].input_id, inputId, kind + ' 的来源没有被换回机器绑定：' + JSON.stringify(obligation.basis[0]));
      assert(!scope.unresolved.some(gap => gap.obligation_id === obligation.id), kind + ' 仍被当成缺口');
    }
  } },
  { name: 'D0.2 an unavailable definition source always drops its satisfaction proof', run(f) {
    // 必修 1：候选**已经**写成 unknown 却还留着 satisfied_by 时，那份「证明」同样是自报，
    // 必须无条件清掉——否则下游会读成「缺口已被满足」。
    const requirement = '把 value 改成 42 并交付';
    prepareFeatureScopeCandidate({
      projectRoot: f.root, frameworkRoot, feature: 'demo', completionTarget: 'feature',
      requestedResults: ['value is 42'], requestedPhases: ['plan', 'coding'], requirement, overwrite: true,
    });
    const declPath = featureTrackDeclPath(f.root, 'demo');
    const doc = YAML.parse(fs.readFileSync(declPath, 'utf8'));
    const acceptance = doc.execution_scope.facts.find((fact: { kind: string }) => fact.kind === 'acceptance-context');
    const proof = acceptance.basis[0];
    fs.rmSync(path.join(f.root, 'doc/features/demo/acceptance.yaml'), { force: true });
    // 来源确实没了，但候选自己写着 unknown + 一份满足证明
    acceptance.applicability = 'unknown';
    acceptance.basis = [doc.execution_scope.request.requirement_basis];
    acceptance.satisfied_by = [proof];
    fs.writeFileSync(declPath, YAML.stringify(doc));
    const workflow12 = resolveWorkflowSpec(f.root, { frameworkRoot });
    const scope = resolveFeatureExecutionScope(f.root, 'demo', workflow12, frameworkRoot, requirement)!;
    const obligation = scope.obligations.find(o => o.kind === 'acceptance-context')!;
    assert.equal(obligation.applicability, 'unknown', JSON.stringify(obligation));
    assert(!obligation.satisfied_by?.length, '残留的满足证明没有被清掉：' + JSON.stringify(obligation.satisfied_by));
    assert(scope.unresolved.some(gap => gap.obligation_id === obligation.id), JSON.stringify(scope.unresolved));
  } },
  { name: 'D0.2 on a revision proposal an unavailable source drops the proof but never invents a gap', run(f) {
    // 第八轮阻断 1 的回归：修订路径（onlyTighten）上**来源不可用**时——
    // ① `satisfied_by` 必须被清掉（留着会让下游读成「责任已兑现」而跳过责任阶段）；
    // ② `applicability` 保持 `required`、**不降级**（降级是出生路径的事，见第七轮）；
    // ③ 于是责任阶段回到链上。
    const workflow = resolveWorkflowSpec(f.root, { frameworkRoot });
    const options = { projectRoot: f.root, frameworkRoot, feature: 'demo', phase: 'coding', track: 'full' as const,
      requirement: 'make value 42', testTargets: ['src/demo/value.ts'],
      inputContext: { schema_version: '1.1' as const, subject: { feature: 'demo' }, obligations: {}, required_outputs: [] } };
    const initial = resolveCapabilityInputs(options);
    const bound = (id: string) => { const value = initial.inputs!.values[id]; assert(value.state === 'resolved', id); return value.binding; };
    const proposal: ExecutionScopeInput = { request: { completion_target: 'feature', requested_results: ['delivery'], requested_phases: ['coding'],
      impact: { user_visible_behavior_change: false, reason: 'fixture: unit verification only', basis: [bound('codebase')] } }, facts: [
      { id: 'implementation', kind: 'implementation', applicability: 'required', reason: 'authorized change', basis: [bound('codebase')] },
      { id: 'design', kind: 'design-context', applicability: 'required', reason: 'approved contract', basis: [bound('contracts')], satisfied_by: [bound('contracts')] },
      { id: 'acceptance', kind: 'acceptance-context', applicability: 'required', reason: 'approved behavior', basis: [bound('acceptance')], satisfied_by: [bound('acceptance')] },
    ], contract_fingerprints: [] };
    // 让验收来源真的不可用
    fs.rmSync(path.join(f.root, 'doc/features/demo/acceptance.yaml'), { force: true });
    recomputeDefinitionFacts(proposal, { projectRoot: f.root, frameworkRoot, feature: 'demo' }, workflow, true);
    const acceptance = proposal.facts.find(fact => fact.kind === 'acceptance-context')!;
    assert.equal(acceptance.applicability, 'required', '修订路径不得按独立探针降级：' + JSON.stringify(acceptance));
    assert(!acceptance.satisfied_by?.length, '来源不可用却留着满足证明：' + JSON.stringify(acceptance.satisfied_by));
    // 设计来源仍在 → 保持 required，且它的满足证明不受影响
    const design = proposal.facts.find(fact => fact.kind === 'design-context')!;
    assert.equal(design.applicability, 'required');
    assert.equal(design.satisfied_by?.length, 1, JSON.stringify(design.satisfied_by));
    // ③ 的后果由 resolver 的既有规则承担：`required` 且无满足证明的义务必须由 owner 执行。
    // 这里不再往下跑一次 `resolveExecutionScope`——删掉产物本身会让那条 artifact 绑定按
    // 「依据存在性变化」正确判 stale（那是另一条护栏），会盖掉本用例要锁的判据。
    assert.equal(acceptance.kind, 'acceptance-context');
  } },
  { name: 'D0.2 a design-bearing request without design or acceptance still lands on the investigating phases', run(f) {
    // 建议 1 的精确边界：requested_phases 只有 [plan, coding]（连 spec 都没点名），
    // 且 contracts / acceptance 都不存在 → 仍然落在调查阶段，coding 挂 needed_by。
    fs.rmSync(path.join(f.root, 'doc/features/demo/contracts.yaml'), { force: true });
    fs.rmSync(path.join(f.root, 'doc/features/demo/acceptance.yaml'), { force: true });
    const prepared = prepareFeatureScopeCandidate({
      projectRoot: f.root, frameworkRoot, feature: 'demo', completionTarget: 'feature',
      requestedResults: ['value is 42'], requestedPhases: ['plan', 'coding'],
      requirement: '把 value 改成 42', overwrite: true,
    });
    assert.deepStrictEqual(prepared.scope.phase_chain, ['spec', 'plan']);
    assert(prepared.scope.unresolved.some(gap => gap.needed_by.includes('coding')), JSON.stringify(prepared.scope.unresolved));
  } },
  { name: 'combined review reads typed design and rejects missing required comparisons', async run(f) {
    const bridge = resolveCapabilityResolutionEntryInput({ projectRoot: f.root, frameworkRoot, feature: 'demo', phase: 'review', featuresDir: 'doc/features', goalRunId: f.manifest.run_id });
    const ctx = f.context('review');
    // Existing first-phase facts are exercised above; this check isolates the review consumer.
    ctx.factsContext = { ...bridge.factsContext!, first_phase: 'review' };
    f.write('doc/features/demo/review/review-report.md', '# Review\n## 审查范围\n模块 demo，文件 src/demo/value.ts\n## 审查方法\n对照绑定契约与验收\n## 问题清单\n无问题\n## 问题统计\nBLOCKER: 0\nMAJOR: 0\nMINOR: 0\n## 修复建议\n无\n## 结论\n**审查结论**: 通过\n');
    const checks = await review.check(ctx);
    assert.equal(checks.find(check => check.id === 'review_scope_to_design')?.status, 'PASS');
    const incomplete = { ...ctx, resolvedInputs: { ...ctx.resolvedInputs!, values: { ...ctx.resolvedInputs!.values, contracts: { state: 'absent' as const, attempts: [], detail: 'missing required contract' } } } };
    assert((await review.check(incomplete)).some(check => check.id === 'review_required_design' && check.status === 'FAIL'));
  } },
];

export async function runAll(): Promise<UnitCaseResult[]> {
  const results: UnitCaseResult[] = [];
  const prior = process.env.MAISON_GOAL_RUN_ID;
  for (const test of cases) {
    let f: ReturnType<typeof fixture> | undefined;
    try { f = fixture(test.newFile); process.env.MAISON_GOAL_RUN_ID = f.manifest.run_id; await test.run(f); results.push({ name: test.name, ok: true }); }
    catch (error) { results.push({ name: test.name, ok: false, error: String(error) }); }
    finally { if (prior === undefined) delete process.env.MAISON_GOAL_RUN_ID; else process.env.MAISON_GOAL_RUN_ID = prior; clearFrameworkConfigCache(); if (f) fs.rmSync(f.root, { recursive: true, force: true }); }
  }
  return results;
}
