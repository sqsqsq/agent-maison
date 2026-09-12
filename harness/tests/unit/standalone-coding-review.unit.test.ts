import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as YAML from 'yaml';
import { execFileSync } from 'child_process';
import { clearFrameworkConfigCache, resolveFeatureArtifact } from '../../config';
import { resolveCapabilityInputs, readRunBoundContracts } from '../../scripts/utils/capability-resolution';
import { resolveCapabilityResolutionEntryInput } from '../../scripts/utils/capability-resolution-entry-input';
import { resolveExecutionScope } from '../../scripts/utils/execution-scope';
import { buildGoalManifestFromInput } from '../../scripts/utils/goal-manifest';
import { createGoalRun } from '../../scripts/utils/goal-run-creation';
import { resolvePhaseWriteBoundary } from '../../scripts/utils/phase-write-boundary';
import { SpecLoader } from '../../scripts/utils/spec-loader';
import { checkFactsArtifact } from '../../scripts/utils/context-facts';
import { checkUpstreamVerdictGate } from '../../scripts/utils/upstream-verdict-gate';
import coding from '../../scripts/check-coding';
import review from '../../scripts/check-review';
import type { CheckContext } from '../../scripts/utils/types';
import type { WorkflowSpec } from '../../workflow-loader';
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
  const scope = resolveExecutionScope({ request: { completion_target: 'feature', requested_results: ['delivery'], requested_phases: ['coding'] }, facts: [
    { id: 'implementation', kind: 'implementation', applicability: 'required', reason: 'authorized change', basis: [bound('codebase')] },
    { id: 'design', kind: 'design-context', applicability: 'required', reason: 'approved contract', basis: [bound('contracts')], satisfied_by: [bound('contracts')] },
    { id: 'acceptance', kind: 'acceptance-context', applicability: 'required', reason: 'approved behavior', basis: [bound('acceptance')], satisfied_by: [bound('acceptance')] },
    { id: 'visual', kind: 'visual-evidence', applicability: 'not_applicable', reason: 'no UI change', basis: [bound('acceptance')] },
  ], contract_fingerprints: [] }, workflow, { value: initial.inputs!.artifacts['acceptance@1'] as any, binding: bound('acceptance') });
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
