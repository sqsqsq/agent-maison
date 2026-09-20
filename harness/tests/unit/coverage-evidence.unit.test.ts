import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import * as YAML from 'yaml';
import {
  highestEvidenceSource,
  listUnitBothScopeItems,
  mappingCoversScope,
  mappingBackedByResolvableEvidence,
  dagsAllCharacterization,
  dagLinksScopeId,
  scopeHasResolvableEvidence,
  writeCoverageEvidence,
  loadCoverageEvidence,
  readCoverageEvidence,
} from '../../scripts/utils/coverage-evidence';
import {
  checkUtCoverageEvidencePresent,
  inspectCoverageEvidence,
} from '../../scripts/check-ut';
import { buildAcCoverageReport, writeAcCoverageReport } from '../../scripts/utils/ac-coverage-report';
import { buildVerifierMaterialView } from '../../scripts/utils/verifier-material';
import { buildVerifierRequest } from '../../scripts/utils/verifier-request';
import { loadVerifierEvidenceForSubject } from '../../scripts/utils/verifier-evidence';
import { publishFixtureVerifierEvidence } from '../utils/verifier-evidence-fixture';
import { validateCoverageEvidenceContent } from '../../scripts/utils/ut-artifact-validate';
import type { UnitCaseResult } from './ut-artifact-validate.unit.test';
import type { CheckContext } from '../../scripts/utils/types';
import { prepareFeatureScopeCandidate } from '../../scripts/utils/feature-track';
import { ensureFeatureExecutionScopeFrozen, featureEffectiveScope, readFeatureFrozenScope } from '../../scripts/utils/feature-execution-scope';
import { executionScopeFingerprint } from '../../scripts/utils/execution-scope';
import { clearFrameworkConfigCache, featurePhaseReportsDir } from '../../config';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function testPriority(): void {
  const available = new Set(['ut_tags', 'dag_ephemeral', 'dag_archived'] as const);
  assert(highestEvidenceSource(available) === 'dag_archived', 'archived wins');
}

function testUnitBothScope(): void {
  const items = listUnitBothScopeItems({
    criteria: [{ id: 'AC-1', ut_layer: 'device' }, { id: 'AC-2', ut_layer: 'unit' }],
    boundaries: [],
  });
  assert(items.length === 1 && items[0].id === 'AC-2', 'only unit/both');
}

function testDagsAllCharacterizationMixed(): void {
  assert(!dagsAllCharacterization([
    { dag: { flow_type: 'characterization' } },
    { dag: { flow_type: 'usecase_driven' } },
  ]), 'mixed must not skip spec gates');
  assert(dagsAllCharacterization([
    { dag: { flow_type: 'characterization' } },
    { dag: { flow_type: 'characterization' } },
  ]), 'all char should skip');
}

function testMappingNotTrustedWithoutBacking(): void {
  const dags = [{ source: 'ephemeral' as const, dag: { linked_acceptance: ['AC-2'] } }];
  const row = {
    scope_id: 'AC-1',
    scope_kind: 'acceptance_criterion' as const,
    evidence_source: 'dag_ephemeral' as const,
  };
  const root = '/tmp/unused';
  const feat = 'f';
  assert(!mappingBackedByResolvableEvidence(row, dags, false, root, feat), 'dag mapping without dag link');
  assert(!mappingBackedByResolvableEvidence(row, dags, true, root, feat), 'dag source ignores ut tag alone');
  assert(mappingBackedByResolvableEvidence(
    { ...row, scope_id: 'AC-2' },
    dags,
    false,
    root,
    feat,
  ), 'dag link backs dag_ephemeral mapping');
  assert(mappingBackedByResolvableEvidence(
    { scope_id: 'AC-1', scope_kind: 'acceptance_criterion', evidence_source: 'ut_tags' },
    dags,
    true,
    root,
    feat,
  ), 'ut_tags source requires tag');
  assert(dagLinksScopeId(dags[0].dag, 'AC-2'), 'dag link helper');
}

function testDagMappingRequiresDeclaredSourceKind(): void {
  const archived = [{ source: 'archived' as const, dag: { linked_acceptance: ['AC-1'] } }];
  const base = {
    scope_id: 'AC-1',
    scope_kind: 'acceptance_criterion' as const,
  };
  assert(mappingBackedByResolvableEvidence(
    { ...base, evidence_source: 'dag_archived' },
    archived,
    false,
    '/tmp/unused',
    'f',
  ), 'archived declaration resolves from archived DAG');
  assert(!mappingBackedByResolvableEvidence(
    { ...base, evidence_source: 'dag_ephemeral' },
    archived,
    false,
    '/tmp/unused',
    'f',
  ), 'ephemeral declaration must not resolve from archived DAG');
}

function testAcAndBdPrefixesDoNotCrossCover(): void {
  const report = buildAcCoverageReport('demo', {
    criteria: [{ id: 'AC-01', priority: 'P0', ut_layer: 'unit' }],
    boundaries: [{ id: 'BD-01', priority: 'P0', ut_layer: 'unit' }],
  } as never, ['[AC-01] criterion only']);
  assert(report.criteria[0].ut_covered, 'AC-01 should be covered');
  assert(!report.boundaries[0].ut_covered, 'BD-01 must not be covered by AC-01');
}

function testAcCoverageWriteIsSemanticIdempotent(): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-cov-idempotent-'));
  const feature = 'feat-stable';
  try {
    const acceptance = { criteria: [{ id: 'AC-01', priority: 'P0', ut_layer: 'unit' }], boundaries: [] } as never;
    const first = buildAcCoverageReport(feature, acceptance, ['[AC-01] covered'], () => new Date('2026-01-01T00:00:00Z'));
    const out = writeAcCoverageReport(dir, feature, first);
    const bytes = fs.readFileSync(out, 'utf8');
    const second = buildAcCoverageReport(feature, acceptance, ['[AC-01] covered'], () => new Date('2026-01-02T00:00:00Z'));
    writeAcCoverageReport(dir, feature, second);
    assert(fs.readFileSync(out, 'utf8') === bytes, 'same coverage must preserve bytes');
    assert(second.generated_at === first.generated_at, 'in-memory report must match preserved disk timestamp');
    const changed = buildAcCoverageReport(feature, acceptance, [], () => new Date('2026-01-03T00:00:00Z'));
    writeAcCoverageReport(dir, feature, changed);
    assert(fs.readFileSync(out, 'utf8') !== bytes, 'real coverage change must rewrite report');
    assert(changed.generated_at === '2026-01-03T00:00:00.000Z', 'changed coverage keeps current run time');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function testStableCoveragePreservesVerifierSubject(): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-cov-subject-'));
  const feature = 'feat-subject';
  try {
    const acceptance = { criteria: [{ id: 'AC-01', priority: 'P0', ut_layer: 'unit' }], boundaries: [] } as never;
    const code = path.join(dir, 'src', 'value.ts');
    fs.mkdirSync(path.dirname(code), { recursive: true });
    fs.writeFileSync(code, 'export const value = 1;\n');
    const report = buildAcCoverageReport(feature, acceptance, ['[AC-01] covered'], () => new Date('2026-01-01T00:00:00Z'));
    const coveragePath = writeAcCoverageReport(dir, feature, report);
    const material = () => buildVerifierMaterialView({
      projectRoot: dir, feature, phase: 'ut', gateFingerprint: null, phaseRuleText: 'ut: true', templateText: 'review ut', checks: [],
      contextFiles: [coveragePath, code].map(abs => ({ label: path.relative(dir, abs).replace(/\\/g, '/'), content: '', kind: 'path' as const })),
    });
    const subject = () => buildVerifierRequest({ feature, phase: 'ut', prompt_path: 'prompt.md', prompt_sha256: 'a'.repeat(64), material_sha256: material().material_sha256, gate_fingerprint: null, source_commit_sha: null, worktree_digest: null }).subject_id;
    const firstSubject = subject();
    const reportsDir = path.dirname(coveragePath);
    publishFixtureVerifierEvidence({ projectRoot: dir, reportsDir, feature, phase: 'ut', subjectId: firstSubject, skipSummaryPatch: true });
    writeAcCoverageReport(dir, feature, buildAcCoverageReport(feature, acceptance, ['[AC-01] covered'], () => new Date('2026-01-02T00:00:00Z')));
    assert(subject() === firstSubject, 'identical rerun must preserve verifier subject');
    assert(loadVerifierEvidenceForSubject(dir, feature, 'ut', firstSubject).ok, 'matching verifier report must remain reusable');
    writeAcCoverageReport(dir, feature, buildAcCoverageReport(feature, acceptance, [], () => new Date('2026-01-03T00:00:00Z')));
    assert(subject() !== firstSubject, 'real coverage change must advance verifier subject');
    const coverageSubject = subject();
    fs.writeFileSync(code, 'export const value = 2;\n');
    assert(subject() !== coverageSubject, 'reviewed source change must advance verifier subject');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function testTwoRealUtHarnessRunsPreserveSubject(): void {
  const repo = path.resolve(__dirname, '../../..');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ut-harness-subject-'));
  const frameworkRoot = path.join(root, 'framework');
  const feature = 'demo';
  const write = (rel: string, body: string): void => { const abs = path.join(root, rel); fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, body); };
  try {
    fs.mkdirSync(frameworkRoot, { recursive: true });
    for (const dir of ['harness', 'skills', 'specs', 'workflows', 'agents', 'templates', 'docs']) fs.symlinkSync(path.join(repo, dir), path.join(frameworkRoot, dir), process.platform === 'win32' ? 'junction' : 'dir');
    fs.mkdirSync(path.join(frameworkRoot, 'profiles', 'test-ut', 'harness'), { recursive: true });
    fs.symlinkSync(path.join(repo, 'profiles/hmos-app/skills'), path.join(frameworkRoot, 'profiles/test-ut/skills'), process.platform === 'win32' ? 'junction' : 'dir');
    fs.writeFileSync(path.join(frameworkRoot, 'profiles/test-ut/profile.yaml'), YAML.stringify({
      name: 'test-ut', display_name: 'UT integration seam', catalog_allowed_module_formats: ['application'], detect: { signature_files: [] }, phases_disabled: [],
      capabilities: { 'coding.compile': { provider: 'none', severity: 'SKIP' }, 'coding.deps_install': { provider: 'none', severity: 'SKIP' }, 'coding.lint': { provider: 'none', severity: 'SKIP' }, 'ut.compile': { provider: 'hvigor_ohostest', severity: 'BLOCKER' }, 'ut.run': { provider: 'hvigor_hypium', severity: 'BLOCKER' }, 'device_test.run': { provider: 'none', severity: 'SKIP' }, 'device_test.build': { provider: 'none', severity: 'SKIP' }, 'device_test.install': { provider: 'none', severity: 'SKIP' }, 'spec.visual_handoff': { provider: 'none', severity: 'SKIP' }, 'spec.ui_spec': { provider: 'none', severity: 'SKIP' }, 'spec.asset_acquisition': { provider: 'none', severity: 'SKIP' }, 'plan.visual_parity': { provider: 'none', severity: 'SKIP' }, 'coding.visual_parity': { provider: 'none', severity: 'SKIP' }, 'device_test.visual_diff': { provider: 'none', severity: 'SKIP' } }, personal_prerequisites: {},
    }));
    fs.writeFileSync(path.join(frameworkRoot, 'profiles/test-ut/harness/profile-path-conventions.js'), "exports.resolveUtSourceRoots=(root,modules)=>modules.map(m=>require('path').join(root,m.package_path,'src','ohosTest')); exports.diffExcludeTestPathRegexes=[/\\/src\\/ohosTest\\//];\n");
    fs.writeFileSync(path.join(frameworkRoot, 'profiles/test-ut/harness/ut-host-impl.js'), [
      "const fs=require('fs'),path=require('path');",
      "const pass=id=>[{id,category:'structure',severity:'BLOCKER',status:'PASS',description:id,details:'integration seam'}];",
      "const walk=d=>fs.existsSync(d)?fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):/\\.test\\.ets$/.test(e.name)?[path.join(d,e.name)]:[]):[];",
      "exports.utHostImpl={loadUtFiles:c=>c.featureSpec.contracts.modules.flatMap(m=>walk(path.join(c.projectRoot,m.package_path,'src','ohosTest','ets','test')).map(p=>({path:path.relative(c.projectRoot,p).replace(/\\\\/g,'/'),content:fs.readFileSync(p,'utf8')}))),partitionUtFiles:(c,a)=>({all:a,scoped:a,scopeSources:['production-test-profile']}),checkUtFileNaming:()=>pass('ut_file_naming'),checkUtFrameworkImport:()=>pass('ut_framework_import'),checkUtTscCompiles:()=>pass('ut_tsc_compiles'),checkUtHvigorBuild:()=>pass('ut_hvigor_build'),checkUtHvigorTest:()=>pass('ut_hvigor_test'),checkTestRegistration:()=>pass('test_registration'),isSuiteEntryShim:()=>false};",
    ].join('\n'));
    write('framework.config.json', JSON.stringify({ schema_version: '1.1', project_name: 'UT subject', materialized_adapters: ['codex'], project_profile: { name: 'test-ut' }, active_workflow: 'obligation-driven', evidence_profile: 'strict', paths: { features_dir: 'doc/features' }, architecture: { outer_layers: [{ id: 'src', can_depend_on: [] }], module_inner_layers: ['main'] } }));
    write('framework.local.json', JSON.stringify({ schema_version: '1.0', agent_adapter: 'codex' }));
    write('AGENTS.md', '# fixture\n');
    const sourceRel = 'src/demo/value.ts'; const testRel = 'src/demo/src/ohosTest/ets/test/value.test.ets';
    write(sourceRel, 'export const value = 1;\n'); write('src/demo/helper.ts', 'export const helper = 1;\n'); write('src/demo/model.ts', 'export type Model = number;\n');
    write(`doc/features/${feature}/contracts.yaml`, YAML.stringify({ feature, source: 'approved', version: '1', modules: [{ name: 'demo', layer: 'src', package_path: 'src/demo' }], files: [sourceRel, testRel], module_dependencies: {}, data_models: [], interfaces: [], components: [], prd_to_code_traceability: [{ prd_id: 'AC-1', key_files: [sourceRel] }] }));
    write(`doc/features/${feature}/acceptance.yaml`, YAML.stringify({ feature, source: 'approved', version: '1', criteria: [{ id: 'AC-1', description: 'value', priority: 'P1', testable: true, verification_steps: ['read'], expected_result: '1', ut_layer: 'unit', ut_focus: 'value' }], boundaries: [] }));
    write(`doc/features/${feature}/spec/spec.md`, '# spec\n'); write(`doc/features/${feature}/plan/plan.md`, '# plan\n');
    write('src/demo/test/dag/value.dag.yaml', YAML.stringify({ flow_id: 'value', flow_name: 'value', module: 'demo', entry_point: { module: 'demo', file: sourceRel, function: 'value' }, linked_acceptance: ['AC-1'], nodes: [{ id: 'assert', type: 'assertion', description: 'value', source: { file: sourceRel, function: 'value' }, linked_acceptance: ['AC-1'], assertions: [{ type: 'state_check', target: 'value', expected: '1' }], next: [] }] }));
    write(`doc/features/${feature}/ut/testability-audit.md`, '```yaml\nrecords:\n  - acceptance_id: AC-1\n    entry_point: {file: src/demo/value.ts, symbol: value}\n    testability_level: L1\n    dependencies:\n      - {name: Math, kind: pure}\n    verdict: testable\n```\n');
    write(`doc/features/${feature}/ut/reports/coverage-evidence.json`, JSON.stringify({ schema_version: '1.0', feature, primary_evidence_source: 'ut_tags', sources: { ut_tags: [testRel] }, mappings: [{ scope_id: 'AC-1', scope_kind: 'acceptance_criterion', evidence_source: 'ut_tags' }] }));
    // `framework/` is a junction onto the whole repo: letting `git add -A` walk it floods stderr with
    // CRLF warnings on autocrlf hosts, spawnSync dies on ENOBUFS, the index.lock stays and the baseline
    // commit silently never happens (every src file then reads as "untracked mutation").
    write('.gitignore', 'framework/\n');
    spawnSync('git', ['init', '-q'], { cwd: root }); spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root }); spawnSync('git', ['config', 'user.name', 'Test'], { cwd: root }); spawnSync('git', ['add', '-A'], { cwd: root }); spawnSync('git', ['commit', '-qm', 'baseline'], { cwd: root });
    clearFrameworkConfigCache();
    prepareFeatureScopeCandidate({ projectRoot: root, frameworkRoot, feature, completionTarget: 'request', requestedResults: ['unit evidence'], requestedPhases: ['ut'], requirement: 'verify value', overwrite: true, impact: { userVisibleBehaviorChange: false, reason: 'unit only', basisPaths: [sourceRel] } });
    ensureFeatureExecutionScopeFrozen({ projectRoot: root, frameworkRoot, feature });
    const fingerprint = executionScopeFingerprint(featureEffectiveScope(readFeatureFrozenScope(root, feature)!));
    write(`doc/features/${feature}/context/facts.md`, '---\n' + YAML.stringify({ schema_version: '1.1', feature, frozen_scope_fingerprint: fingerprint, established_by: 'ut', ready_to_produce: true, has_blocker_coverage_risk: false, source_code_paths: [sourceRel, 'src/demo/helper.ts', 'src/demo/model.ts', testRel], key_inputs_read: [sourceRel, 'src/demo/helper.ts', 'src/demo/model.ts', testRel], files_inspected_count: 5, searches_performed_estimate: 4, decisions_unlocked: ['verify value'], exploration_mode: 'sequential' }) + '---\n## Code Facts\n| 路径 | 事实 | 影响 |\n|---|---|---|\n| src/demo/value.ts | value exported | verify |\n| src/demo/helper.ts | helper exists | verify dependency |\n| src/demo/model.ts | model exists | verify type |\n| ' + testRel + ' | test target | verify |\n');
    write(testRel, "import { describe, it, expect } from '@ohos/hypium';\ndescribe('Value',()=>{it('[AC-1] reads value',0,()=>{expect(1).assertEqual(1);});});\n");
    const run = (clock: string) => spawnSync(process.execPath, [require.resolve('ts-node/dist/bin.js'), path.join(repo, 'harness/harness-runner.ts'), '--phase', 'ut', '--feature', feature, '--project-root', root, '--framework-root', frameworkRoot], { cwd: path.join(repo, 'harness'), encoding: 'utf8', timeout: 120000, env: { ...process.env, NODE_ENV: 'test', TS_NODE_PROJECT: path.join(repo, 'harness/tsconfig.json'), MAISON_TEST_AC_COVERAGE_NOW: clock } });
    const first = run('2026-01-01T00:00:00.000Z');
    const reports = featurePhaseReportsDir(root, feature, 'ut', frameworkRoot); const summaryPath = path.join(reports, 'summary.json');
    assert(fs.existsSync(summaryPath), String(first.stderr ?? '') + String(first.stdout ?? '') + String(first.error ?? ''));
    const firstSummary = JSON.parse(fs.readFileSync(summaryPath, 'utf8')) as { verifier_subject_id?: string; verdict?: string; blockers?: unknown[] };
    assert(typeof firstSummary.verifier_subject_id === 'string', JSON.stringify(firstSummary));
    const firstSubject = firstSummary.verifier_subject_id!;
    const firstCoverage = fs.readFileSync(path.join(reports, 'ac-coverage.json'), 'utf8');
    publishFixtureVerifierEvidence({ projectRoot: root, reportsDir: reports, feature, phase: 'ut', subjectId: firstSubject });
    const second = run('2026-01-02T00:00:00.000Z'); assert(fs.existsSync(summaryPath), second.stderr + second.stdout);
    const secondSummary = JSON.parse(fs.readFileSync(summaryPath, 'utf8')) as { verifier_subject_id?: string };
    assert(secondSummary.verifier_subject_id === firstSubject, second.stderr + second.stdout);
    assert(fs.readFileSync(path.join(reports, 'ac-coverage.json'), 'utf8') === firstCoverage, 'identical harness rerun changed coverage bytes');
    assert(loadVerifierEvidenceForSubject(root, feature, 'ut', firstSubject).ok, 'same-subject verifier report must remain reusable');
    write(testRel, "import { describe, it, expect } from '@ohos/hypium';\ndescribe('Value',()=>{it('[AC-1] reads value',0,()=>{expect(1).assertEqual(1);});it('[AC-1] second path',0,()=>{expect(1).assertEqual(1);});});\n");
    run('2026-01-03T00:00:00.000Z'); const coverageChanged = JSON.parse(fs.readFileSync(summaryPath, 'utf8')) as { verifier_subject_id?: string };
    assert(typeof coverageChanged.verifier_subject_id === 'string' && coverageChanged.verifier_subject_id !== firstSubject, 'real coverage change must advance subject');
    const beforeSource = coverageChanged.verifier_subject_id; write(testRel, "import { describe, it, expect } from '@ohos/hypium';\ndescribe('Value',()=>{it('[AC-1] reads value',0,()=>{expect(2).assertEqual(2);});it('[AC-1] second path',0,()=>{expect(1).assertEqual(1);});});\n"); const sourceRun = run('2026-01-04T00:00:00.000Z');
    const sourceChanged = JSON.parse(fs.readFileSync(summaryPath, 'utf8')) as { verifier_subject_id?: string };
    assert(typeof sourceChanged.verifier_subject_id === 'string' && sourceChanged.verifier_subject_id !== beforeSource, 'reviewed source change must advance subject: ' + JSON.stringify(sourceChanged) + String(sourceRun.stderr ?? '') + String(sourceRun.stdout ?? ''));
  } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
}

function testDagNodeLevelLinkedAcceptance(): void {
  const dag = {
    nodes: [{ type: 'assertion', linked_acceptance: ['AC-9'] }],
  };
  assert(dagLinksScopeId(dag, 'AC-9'), 'node-level linked_acceptance counts');
  assert(!dagLinksScopeId(dag, 'AC-1'), 'unlinked ac');
}

function testAcCoverageResolvable(): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-cov-'));
  const feature = 'feat-ac';
  writeAcCoverageReport(dir, feature, {
    schema_version: '1.0',
    feature,
    generated_at: new Date().toISOString(),
    harness_phase: 'ut',
    criteria: [{
      id: 'AC-1',
      kind: 'criterion',
      ut_covered: true,
      it_tags: ['[AC-1] ok'],
    }],
    boundaries: [],
    summary: { unit_scope_total: 1, unit_covered: 1, device_delegated: 0 },
  });
  const report = {
    schema_version: '1.0' as const,
    feature,
    generated_at: new Date().toISOString(),
    harness_phase: 'ut' as const,
    criteria: [{
      id: 'AC-1',
      kind: 'criterion' as const,
      ut_covered: true,
      it_tags: ['[AC-1] ok'],
    }],
    boundaries: [],
    summary: { unit_scope_total: 1, unit_covered: 1, device_delegated: 0 },
  };
  assert(scopeHasResolvableEvidence({
    projectRoot: dir,
    feature,
    scopeId: 'AC-1',
    dags: [],
    hasUtTag: false,
    mapping: {
      scope_id: 'AC-1',
      scope_kind: 'acceptance_criterion',
      evidence_source: 'ac_coverage',
    },
    acReport: report,
  }), 'ac_coverage mapping uses in-memory report');
  fs.rmSync(dir, { recursive: true, force: true });
}

function testValidateAndRoundtrip(): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cov-ev-'));
  const projectRoot = dir;
  const feature = 'feat-a';
  const doc = {
    schema_version: '1.0',
    feature,
    primary_evidence_source: 'dag_ephemeral' as const,
    sources: { dag_ephemeral: ['doc/features/feat-a/ut/reports/flow-dag/x.dag.yaml'] },
    mappings: [{
      scope_id: 'AC-1',
      scope_kind: 'acceptance_criterion' as const,
      evidence_source: 'ut_tags' as const,
    }],
  };
  writeCoverageEvidence(projectRoot, feature, doc);
  const loaded = loadCoverageEvidence(projectRoot, feature);
  assert(!!loaded && loaded.feature === feature, 'roundtrip');
  const v = validateCoverageEvidenceContent(JSON.stringify(doc));
  assert(v.ok, JSON.stringify(v.errors));
  assert(mappingCoversScope(doc.mappings, 'AC-1'), 'mapping covers');
  fs.rmSync(dir, { recursive: true, force: true });
}

function testMappingsCompleteRequiresRows(): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cov-map-'));
  const feature = 'feat-map';
  writeCoverageEvidence(dir, feature, {
    schema_version: '1.0',
    feature,
    primary_evidence_source: 'ut_tags',
    mappings: [],
  });
  const ev = loadCoverageEvidence(dir, feature);
  assert(ev !== null && (ev.mappings?.length ?? 0) === 0, 'empty mappings');
  fs.rmSync(dir, { recursive: true, force: true });
}

function makeCtx(projectRoot: string, feature: string): CheckContext {
  return {
    projectRoot,
    frameworkRoot: projectRoot,
    feature,
    phaseRule: {
      traceability_checks: {
        ut_coverage_evidence_present: { description: 'coverage evidence present' },
      },
    } as unknown as CheckContext['phaseRule'],
    featureSpec: {
      acceptance: {
        criteria: [{ id: 'AC-01', priority: 'P0', ut_layer: 'unit' }],
        boundaries: [],
      },
    } as unknown as CheckContext['featureSpec'],
    resolvedProfile: { name: 'hmos-app', profileDir: '', personalPrerequisites: {} },
  } as CheckContext;
}

function testReadObservationDistinguishesStates(): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cov-observe-'));
  const feature = 'feat-observe';
  try {
    const missing = readCoverageEvidence(dir, feature);
    assert(missing.status === 'missing', missing.status);
    const abs = missing.absPath;
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, '{ broken', 'utf-8');
    const invalidJson = readCoverageEvidence(dir, feature);
    assert(invalidJson.status === 'invalid', invalidJson.status);
    fs.writeFileSync(abs, '[]\n', 'utf-8');
    const invalidRoot = readCoverageEvidence(dir, feature);
    assert(invalidRoot.status === 'invalid', invalidRoot.status);
    assert(invalidRoot.status === 'invalid' && invalidRoot.error.includes('JSON object'), JSON.stringify(invalidRoot));
    fs.writeFileSync(abs, JSON.stringify({ schema_version: '1.0', feature, mappings: [] }), 'utf-8');
    const loaded = readCoverageEvidence(dir, feature);
    assert(loaded.status === 'loaded', loaded.status);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function testPresentGateReportsInvalidCanonicalPath(): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cov-invalid-gate-'));
  const feature = 'feat-invalid';
  try {
    const first = readCoverageEvidence(dir, feature);
    fs.mkdirSync(path.dirname(first.absPath), { recursive: true });
    fs.writeFileSync(first.absPath, '{ broken', 'utf-8');
    const ctx = makeCtx(dir, feature);
    const observed = inspectCoverageEvidence(ctx);
    assert(observed.status === 'invalid', observed.status);
    const result = checkUtCoverageEvidencePresent(ctx, observed)[0];
    assert(result.status === 'FAIL', result.status);
    assert(result.details.includes(first.absPath), result.details);
    assert(result.details.includes('已存在但无效'), result.details);
    assert(!result.details.includes('缺少 canonical'), result.details);
    assert(result.suggestion?.includes('不需要 git add') === true, result.suggestion ?? '');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function testInspectRejectsWrongFeatureAndMissingFields(): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cov-shape-gate-'));
  const feature = 'feat-shape';
  try {
    const first = readCoverageEvidence(dir, feature);
    fs.mkdirSync(path.dirname(first.absPath), { recursive: true });
    fs.writeFileSync(first.absPath, JSON.stringify({ feature: 'other', mappings: [] }), 'utf-8');
    const observed = inspectCoverageEvidence(makeCtx(dir, feature));
    assert(observed.status === 'invalid', observed.status);
    assert(
      observed.status === 'invalid' && observed.errors.some(e => e.includes('schema_version')),
      JSON.stringify(observed),
    );
    assert(
      observed.status === 'invalid' && observed.errors.some(e => e.includes('当前 feature')),
      JSON.stringify(observed),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function runAll(): UnitCaseResult[] {
  const cases = [
    { name: 'evidence priority', fn: testPriority },
    { name: 'unit/both scope', fn: testUnitBothScope },
    { name: 'all-characterization only when every dag', fn: testDagsAllCharacterizationMixed },
    { name: 'mapping requires backing', fn: testMappingNotTrustedWithoutBacking },
    { name: 'DAG mapping requires declared source kind', fn: testDagMappingRequiresDeclaredSourceKind },
    { name: 'AC and BD prefixes do not cross-cover', fn: testAcAndBdPrefixesDoNotCrossCover },
    { name: 'ac coverage writer is semantic-idempotent', fn: testAcCoverageWriteIsSemanticIdempotent },
    { name: 'stable coverage preserves verifier subject', fn: testStableCoveragePreservesVerifierSubject },
    { name: 'two real UT harness runs preserve verifier subject', fn: testTwoRealUtHarnessRunsPreserveSubject },
    { name: 'dag node linked_acceptance', fn: testDagNodeLevelLinkedAcceptance },
    { name: 'ac_coverage resolvable', fn: testAcCoverageResolvable },
    { name: 'mappings array may be empty file', fn: testMappingsCompleteRequiresRows },
    { name: 'validate roundtrip', fn: testValidateAndRoundtrip },
    { name: 'read observation distinguishes missing invalid loaded', fn: testReadObservationDistinguishesStates },
    { name: 'present gate reports invalid canonical path', fn: testPresentGateReportsInvalidCanonicalPath },
    { name: 'inspect rejects wrong feature and missing fields', fn: testInspectRejectsWrongFeatureAndMissingFields },
  ];
  return cases.map(({ name, fn }) => {
    try {
      fn();
      return { name, ok: true };
    } catch (e) {
      return { name, ok: false, error: e instanceof Error ? e.stack ?? e.message : String(e) };
    }
  });
}
