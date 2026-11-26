import { beginUnitCase } from '../utils/unit-cases';
// verifier-material.unit.test.ts — plan 07a41ec6 T7：审前材料视图（subject 寻址材料）与差异登记

import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as YAML from 'yaml';
import { createHash } from 'crypto';
import { execFileSync } from 'child_process';

import { clearFrameworkConfigCache, featurePhaseReportsDir, relFeaturesDir, resolveFeatureArtifact, loadFrameworkConfig } from '../../config';
import {
  buildVerifierMaterialView,
  collectCurrentAcceptanceEvidence,
  currentAcceptanceExecutionKeyMatcher,
  diffVerifierMaterial,
  readVerifierMaterialOrNull,
  verifierMaterialFilename,
  writeVerifierMaterial,
  independentVerificationContext,
  collectTestStrengthContext,
  computeMaterialSha256,
  verifierMaterialsEquivalent,
  verifierMaterialFileMatchesCurrent,
  verifierMaterialFileHash,
  verifierUsesImplementationChanges,
  verifierInputBindingsSha256,
  VerifierPreimagesUnavailable,
} from '../../scripts/utils/verifier-material';
import { readImplementationReviewChanges } from '../../scripts/utils/diff-scope';
import { buildVerifierRequest } from '../../scripts/utils/verifier-request';
import { stableStringify } from '../../scripts/utils/phase-evidence-manifest';
import type { ContextFileEntry } from '../../scripts/utils/types';
import type { UnitCaseResult } from '../run-unit';
import { SpecLoader } from '../../scripts/utils/spec-loader';
import { assembleVerifierPhasePrompt, collectContextFiles, refreshVerifierRequestContext, writeRunSummaryBase } from '../../harness-runner';
import { assembleAIPrompt, buildScriptReport, failScriptReportWithFatalError, generateScriptReport, loadVerifierPromptTemplate, readVerifierItemReviewPrompt,
  rebuildVerifierItemReviewPrompt } from '../../scripts/utils/report-generator';
import { classifyFailureKind } from '../../scripts/utils/goal-failure-classifier';
import { factsPhaseFingerprint, type FactsInvocationContext } from '../../scripts/utils/context-facts';
import { publishFixtureVerifierEvidence } from '../utils/verifier-evidence-fixture';
import { hasChangedVerifierMaterialInputs } from '../../scripts/utils/verify-feature-completion';
import { resolveCapabilityResolutionEntryInput } from '../../scripts/utils/capability-resolution-entry-input';
import { resolveCapabilityInputs } from '../../scripts/utils/capability-resolution';
import type { ResolvedPhaseInputs } from '../../scripts/utils/capability-resolution';
import { designScopeRevisionChecks } from '../../scripts/utils/blueprint-skill-projection';
import type { CheckContext } from '../../scripts/utils/types';
import { computeGateFingerprint } from '../../scripts/utils/gate-fingerprint';
import { createIndependentQuestioningResult, describeQuestioningChanges, requiredQuestioningScopes, selectQuestioningScopes } from '../../scripts/utils/blueprint-questioning';
import { setupRunlessProject } from './execution-scope.unit.test';
import { ensureFeatureExecutionScopeFrozen } from '../../scripts/utils/feature-execution-scope';
import { loadResolvedProfile } from '../../profile-loader';
import { fixture as codingFixture } from './standalone-coding-review.unit.test';
import { buildGoalManifestFromInput, computeManifestIdentityFields, diffManifestIdentityFields } from '../../scripts/utils/goal-manifest';
import { createGoalRun } from '../../scripts/utils/goal-run-creation';

const FEATURE = 'vm-fixture';

function mkProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-verifier-material-'));
  clearFrameworkConfigCache();
  return root;
}

function put(root: string, rel: string, content: string): string {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
  return abs;
}

function reviewRepo(root: string) {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  put(root, 'framework.config.json', JSON.stringify({ schema_version: '1.1', project_profile: { name: 'hmos-app', sub_variant: 'app' },
    architecture: { outer_layers: [{ id: '02-Feature', can_depend_on: [], intra_layer_deps: 'dag' }] } }));
  git('init', '-q');
  git('config', 'core.autocrlf', 'false');
  git('config', 'user.name', 'Verifier Test');
  git('config', 'user.email', 'test@example.test');
  git('config', 'commit.gpgsign', 'false');
  return git;
}

const CHECKS = [
  { id: 'a', status: 'PASS', severity: 'MAJOR' },
  { id: 'b', status: 'WARN', severity: 'MINOR' },
];

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'phase verifier ignores unbound implementation changes outside Coding and Review but keeps real acceptance sources',
    run: () => {
      const featurePhases = ['spec', 'plan', 'coding', 'review', 'ut', 'testing'];
      assert.deepStrictEqual(featurePhases.filter(verifierUsesImplementationChanges), ['coding', 'review']);
      const root = mkProject(), frameworkRoot = path.resolve(__dirname, '../../..'), feature = FEATURE;
      const priorBase = process.env.HARNESS_DIFF_BASE_REF;
      const prefix = '02-Feature/Value/';
      const source = prefix + 'src/main/ets/Value.ets', test = prefix + 'src/ohosTest/ets/test/Value.test.ets';
      const modified = prefix + 'Unrelated.ets';
      try {
        const git = reviewRepo(root);
        put(root, source, 'export function value() { return 42; }\n');
        put(root, test, "it('uses the production value', 0, () => { expect(value()).assertEqual(42); });\n");
        put(root, modified, 'export const unrelated = 1;\n');
        put(root, `doc/features/${feature}/contracts.yaml`, YAML.stringify({ feature, files: [source, test],
          modules: [{ name: 'Value', package_path: '02-Feature/Value' }] }));
        put(root, `doc/features/${feature}/acceptance.yaml`, YAML.stringify({ feature, criteria: [{ id: 'AC-1', description: 'value is observable', ut_layer: 'unit' }] }));
        git('add', '-A'); git('commit', '-qm', 'before unrelated work');
        process.env.HARNESS_DIFF_BASE_REF = git('rev-parse', 'HEAD');
        const loader = new SpecLoader(root, undefined, undefined, frameworkRoot);
        const resolvedProfile = loadResolvedProfile(root, loadFrameworkConfig(root), frameworkRoot);
        const common = { projectRoot: root, frameworkRoot, feature };
        const featureSpec = loader.loadFeatureSpec(feature);
        const prepare = (phase: 'spec' | 'review') => {
          const context = { phase, feature, phaseRule: loader.loadPhaseRule(phase), featureSpec };
          const report = buildScriptReport(phase, feature, root, []);
          return () => assembleVerifierPhasePrompt(path.join(frameworkRoot, 'harness'),
            { kind: 'standalone', ...common, frameworkRel: '' }, loader, context, report,
            { phaseIssues: null, goalBrief: null, resolvedProfile });
        };
        const assembleSpec = prepare('spec');
        const before = assembleSpec().material;
        put(root, modified, 'export const unrelated = 2;\n');
        const spec = assembleSpec();
        assert.equal(spec.material.material_sha256, before.material_sha256);
        assert(!spec.prompt.includes(modified) && !spec.material.files.some(file => file.path === modified));
        assert(spec.material.files.some(file => file.path === test) && spec.material.files.some(file => file.path === source));

        const review = prepare('review')();
        assert(review.prompt.includes(`M: ${modified}`) && review.prompt.includes('unrelated = 2'));
        assert(review.material.files.some(file => file.path === modified));
      } finally {
        if (priorBase === undefined) delete process.env.HARNESS_DIFF_BASE_REF; else process.env.HARNESS_DIFF_BASE_REF = priorBase;
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'production verifier prompt reopens only an affected item and preserves the original WARN row',
    run: () => {
      const root = mkProject(), frameworkRoot = path.resolve(__dirname, '../../..'), feature = FEATURE, phase = 'review';
      const marker = '# Unchanged own review output';
      const featureDir = `doc/features/${feature}`, touched = '02-Feature/Demo/changed.ets', unchanged = '02-Feature/Demo/stable.ets';
      try {
        const git = reviewRepo(root);
        put(root, touched, 'export const changed = "first material";\n');
        put(root, unchanged, 'export const stable = "separate review";\n');
        put(root, featureDir + '/contracts.yaml', YAML.stringify({ feature, files: [touched, unchanged], modules: [] }));
        const currentProduct = featureDir + '/review-report.md';
        put(root, currentProduct, marker + '\n');
        git('add', '-A'); git('commit', '-qm', 'source baseline');
        const specLoader = new SpecLoader(root, undefined, undefined, frameworkRoot);
        const harnessRoot = path.join(frameworkRoot, 'harness');
        const reportsDir = featurePhaseReportsDir(root, feature, phase, frameworkRoot);
        const resolvedProfile = loadResolvedProfile(root, loadFrameworkConfig(root), frameworkRoot);
        const report = buildScriptReport(phase, feature, root, [
          { id: 'fixture_structure', category: 'structure', description: 'Review product is readable', severity: 'BLOCKER', status: 'PASS', details: 'Fixture review product exists.' },
        ]);
        const verifierPromptRel = 'prompts/verify-review.md';
        const produce = () => assembleVerifierPhasePrompt(harnessRoot, { kind: 'standalone', projectRoot: root, frameworkRoot, frameworkRel: '' },
          specLoader, { phase, feature, phaseRule: specLoader.loadPhaseRule(phase), featureSpec: specLoader.loadFeatureSpec(feature) },
          report, { phaseIssues: null, goalBrief: null, verifierPromptRel, resolvedProfile });
        const sign = (material: ReturnType<typeof buildVerifierMaterialView>) => writeRunSummaryBase(root, report, frameworkRoot,
          { verifierMaterial: material, verifierPlan: { mode: 'enabled', reason: 'policy_required', verifier_prompt: verifierPromptRel, message: 'fixture' } });
        const first = produce();
        assert.equal(first.itemReview.scope.mode, 'full');
        const subject = sign(first.material).verifier_subject_id!;
        assert(subject);
        const initialOriginal = publishFixtureVerifierEvidence({ projectRoot: root, reportsDir, feature, phase, subjectId: subject,
          reportText: ['| id | status | severity | 证据 |', '|---|---|---|---|',
            `| fix_recommendation_actionable | PASS | MAJOR | \`${touched}:1\` existing fix target |`,
            `| coding_rules_referenced | WARN | MINOR | \`${unchanged}:1\` retained | `.trimEnd(),
            '', '\`\`\`yaml', YAML.stringify({ verification_result: { phase, feature, checks: [
              { id: 'coding_rules_referenced', status: 'WARN', severity: 'MINOR', details: 'original warning', repair_owner: 'review' },
            ] } }).trimEnd(), '\`\`\`'].join('\n'), skipSummaryPatch: true });
        put(root, touched, 'export const changed = "second material";\n');
        const second = produce();
        assert.deepEqual(diffVerifierMaterial(first.material, second.material), [touched]);
        assert.deepEqual(second.itemReview.scope.reviewIds, ['fix_recommendation_actionable']);
        const focus = readVerifierItemReviewPrompt(second.prompt);
        assert.deepEqual(focus?.reviewIds, ['fix_recommendation_actionable']);
        assert.equal(focus?.reusedRows[0].status, 'WARN');
        assert(focus?.reusedRows[0].evidence.includes(path.basename(initialOriginal.mdPath) + '#L4'));
        assert(!second.prompt.includes('original warning'), 'an independently readable original avoids repeating old YAML details');
        const originalDetails = fs.readFileSync(initialOriginal.mdPath, 'utf8');
        assert(originalDetails.includes('repair_owner: review') && originalDetails.includes('original warning'));
        assert(second.prompt.includes('### 检查 3:') && !second.prompt.includes('### 检查 6:'));
        assert(second.prompt.includes('second material') && !second.prompt.includes(marker) && second.prompt.includes(currentProduct));

        const restored = rebuildVerifierItemReviewPrompt(root, second.prompt,
          loadVerifierPromptTemplate(harnessRoot, phase, resolvedProfile, verifierPromptRel),
          { scope: { mode: 'full', requiredIds: [], reviewIds: [], reusedRows: [] }, previousReport: null });
        assert(restored.includes('### 检查 6:') && !readVerifierItemReviewPrompt(restored), 'late evidence can restore full review from the bound template');
        put(root, '02-Feature/Demo/unknown-dependency.ets', 'export const newInput = 1;\n');
        assert.equal(produce().itemReview.scope.mode, 'full', 'an unassignable actual path requires full review');
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    },
  },
  {
    name: 'Git deletion and rename preimages bind the subject across signing, empty context recompute and Goal baseline',
    run: () => {
      const root = mkProject(), frameworkRoot = path.resolve(__dirname, '../../..'), phase = 'review', feature = FEATURE;
      const priorBase = process.env.HARNESS_DIFF_BASE_REF;
      const oldPath = '02-Feature/Demo/archive.ets', newPath = '02-Feature/Demo/current.ets', deleted = '02-Feature/Demo/retired.bin';
      const before = Array.from({ length: 40 }, (_, i) => `export const item${i} = ${i};`).join('\n') + '\n';
      const priorBytes = Buffer.from([0, 0x80, 0xab, 0xff]);
      try {
        const git = reviewRepo(root);
        put(root, oldPath, before + '// old declaration A\n');
        fs.writeFileSync(path.join(root, deleted), priorBytes);
        git('add', '-A'); git('commit', '-qm', 'first before state');
        const a = git('rev-parse', 'HEAD');
        put(root, oldPath, before + '// old declaration B\n');
        git('commit', '-qam', 'changed rename preimage');
        const b = git('rev-parse', 'HEAD');
        fs.writeFileSync(path.join(root, deleted), Buffer.from([0, 0x81, 0xab, 0xff]));
        git('commit', '-qam', 'changed deletion preimage');
        const c = git('rev-parse', 'HEAD');
        put(root, 'unrelated.txt', 'neutral file\n');
        git('add', '-A'); git('commit', '-qm', 'unchanged reviewed preimages');
        const d = git('rev-parse', 'HEAD');
        const manifest = buildGoalManifestFromInput({ feature, run_id: 'verifier-preimage-goal', requirement: 'Use the reviewed transaction',
          start_phase: 'coding', end_phase: 'review', unattended: { write_mode: 'full-access', approval_mode: 'never' } }, { projectRoot: root });
        createGoalRun({ projectRoot: root, manifest, chain: ['coding', 'review'] });
        assert.equal(manifest.run_base_sha, d, 'Goal pins its real creation base');
        git('mv', oldPath, newPath);
        git('rm', '-q', deleted);
        const resolved: ResolvedPhaseInputs = { phase, values: {}, artifacts: {},
          context: { schema_version: '1.1', subject: { feature }, obligations: {}, required_outputs: [] } };
        const common = { projectRoot: root, frameworkRoot, feature, phase };
        const readPreimages = (baseRef: string, includePrompt = false) => {
          process.env.HARNESS_DIFF_BASE_REF = baseRef;
          const observed = readImplementationReviewChanges(root, feature, { frameworkRoot, preimagesOnly: !includePrompt });
          assert(observed && observed.preimages.length === 2, 'expected the real deletion and rename originals');
          return observed;
        };
        const renameA = readPreimages(a);
        const renameB = readPreimages(b);
        const promptC = readPreimages(c, true);
        const fingerprint = (reviewChanges: typeof renameA, resolvedInputs?: ResolvedPhaseInputs) =>
          verifierInputBindingsSha256({ ...common, reviewChanges, resolvedInputs });
        const legacyA = fingerprint(renameA), legacyB = fingerprint(renameB), legacyC = fingerprint(promptC);
        assert(legacyA && legacyB && legacyC);
        assert.notEqual(legacyA, legacyB, 'changing only the rename preimage changes the binding');
        assert.notEqual(legacyB, legacyC, 'changing only the delete preimage changes the binding');
        assert.deepEqual(renameA.preimages.filter(entry => entry.status === 'D'), renameB.preimages.filter(entry => entry.status === 'D'));
        assert.deepEqual(renameB.preimages.filter(entry => entry.status === 'R'), promptC.preimages.filter(entry => entry.status === 'R'));
        assert(promptC.preimages.some(entry => entry.status === 'R' && entry.path === oldPath && entry.target === newPath));
        assert(promptC.preimages.some(entry => entry.status === 'D' && entry.path === deleted
          && entry.sha256 === createHash('sha256').update(Buffer.from([0, 0x81, 0xab, 0xff])).digest('hex')));
        assert.notEqual(fingerprint(renameA, resolved), fingerprint(promptC, resolved), 'resolved inputs also bind the original Git bytes');

        const harnessRoot = path.join(frameworkRoot, 'harness');
        const gateFingerprint = computeGateFingerprint(frameworkRoot, phase);
        const report = generateScriptReport(harnessRoot, phase, feature, root, [
          { id: 'fixture_structure', category: 'structure', description: 'Review product is readable', severity: 'BLOCKER', status: 'PASS', details: 'Fixture review product exists.' },
        ], frameworkRoot);
        const build = (reviewChanges?: typeof renameA, runId?: string) => buildVerifierMaterialView({ ...common, gateFingerprint, runId,
          phaseRuleText: 'rule', templateText: 'template', checks: report.checks, contextFiles: [], reviewChanges });
        process.env.HARNESS_DIFF_BASE_REF = a;
        const materialA = build(renameA), materialB = build(renameB), material = build(undefined, manifest.run_id);
        assert.equal(materialA.input_bindings_sha256, legacyA);
        assert.equal(materialB.input_bindings_sha256, legacyB);
        assert.equal(material.input_bindings_sha256, legacyC, 'empty-context Goal signing uses D rather than the external A override and matches the neutral C packet');
        assert(!material.files.some(file => file.path === oldPath || file.path === deleted));
        const subject = (view: typeof material) => buildVerifierRequest({
          feature, phase, gate_fingerprint: gateFingerprint, source_commit_sha: null, worktree_digest: null, prompt_path: 'p.md',
          prompt_sha256: 'f'.repeat(64), material_sha256: view.material_sha256,
        }).subject_id;
        for (const [left, right] of [[materialA, materialB], [materialB, material]]) {
          assert.deepEqual(diffVerifierMaterial(left, right), ['input_bindings']);
          assert.notEqual(subject(left), subject(right));
          assert(!verifierMaterialsEquivalent(left, right, root));
        }
        const reportsDir = featurePhaseReportsDir(root, feature, phase, frameworkRoot);
        put(root, path.relative(root, path.join(reportsDir, 'ai-prompt.md')), 'Review the fixed Goal Git baseline.\n');
        const signed = writeRunSummaryBase(root, report, frameworkRoot,
          { verifierMaterial: material, verifierPlan: { mode: 'enabled', reason: 'policy_required', verifier_prompt: 'prompts/verify-review.md', message: 'fixture' } });
        assert(signed.verifier_subject_id);
        const label = 'refusal-counterevidence.md', content = 'Retain the complete contrary argument after the original review.';
        put(root, label, content);
        const renewed = refreshVerifierRequestContext({ projectRoot: root, frameworkRoot, feature, phase, runId: manifest.run_id,
          additionalContextFiles: [{ label, content }] });
        assert(renewed?.verifier_subject_id && renewed.verifier_subject_id !== signed.verifier_subject_id);
        const updated = readVerifierMaterialOrNull(reportsDir, renewed.verifier_subject_id);
        assert.equal(updated?.input_bindings_sha256, material.input_bindings_sha256, 'appending new arguments carries the bound Git originals');
        assert.deepEqual(diffVerifierMaterial(material, updated), ['+' + label]);
        assert(fs.readFileSync(path.resolve(root, renewed.ai_prompt!), 'utf8').includes(content));
      } finally {
        if (priorBase === undefined) delete process.env.HARNESS_DIFF_BASE_REF; else process.env.HARNESS_DIFF_BASE_REF = priorBase;
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'Missing Git preimage cannot mint reusable material and restored blob recovers the same identity',
    run: () => {
      const root = mkProject(), frameworkRoot = path.resolve(__dirname, '../../..'), feature = FEATURE, phase = 'review';
      const priorBase = process.env.HARNESS_DIFF_BASE_REF;
      try {
        const git = reviewRepo(root);
        const removed = '02-Feature/Demo/withdrawn.ets';
        put(root, removed, 'export const old = "retained original";\n');
        git('add', '-A'); git('commit', '-qm', 'before delete');
        process.env.HARNESS_DIFF_BASE_REF = git('rev-parse', 'HEAD');
        const oid = git('rev-parse', 'HEAD:' + removed);
        const blob = path.join(root, '.git', 'objects', oid.slice(0, 2), oid.slice(2));
        const bytes = fs.readFileSync(blob);
        git('rm', '-q', removed);
        const build = () => buildVerifierMaterialView({ projectRoot: root, frameworkRoot, feature, phase, gateFingerprint: null,
          phaseRuleText: 'rule', templateText: 'template', checks: CHECKS, contextFiles: [] });
        const current = build();
        const report = buildScriptReport(phase, feature, root, [
          { id: 'fixture_structure', category: 'structure', description: 'Review product is readable', severity: 'BLOCKER', status: 'PASS', details: 'Fixture review product exists.' },
        ]);
        const reportsDir = featurePhaseReportsDir(root, feature, phase, frameworkRoot);
        const prompt = path.join(reportsDir, 'ai-prompt.md');
        const sign = (result: typeof report, material?: ReturnType<typeof buildVerifierMaterialView>) => writeRunSummaryBase(root, result, frameworkRoot, {
          verifierMaterial: material,
          verifierPlan: { mode: 'enabled', reason: 'policy_required', verifier_prompt: 'prompts/verify-review.md', message: 'fixture' },
        });
        put(root, path.relative(root, prompt), 'Current published verifier prompt\n');
        const issued = sign(report, current);
        assert(issued.verifier_request);
        fs.unlinkSync(blob);
        const observed = readImplementationReviewChanges(root, feature, { frameworkRoot });
        assert(observed && observed.preimages.some(entry => entry.path === removed && entry.sha256 === null), 'a real D entry remains after the loose object is missing');
        assert(observed.contextFiles.some(file => file.content.includes('证据缺口')));
        const recheck = (summary: unknown) => hasChangedVerifierMaterialInputs({ projectRoot: root, frameworkRoot, feature, phase, summary });
        assert(recheck(issued), 'the normal entry must not return a cached summary holding a stale independent request');
        let lastGapSummary: unknown;
        assert.throws(() => verifierInputBindingsSha256({ projectRoot: root, feature, phase, frameworkRoot, reviewChanges: observed }), (error: unknown) => {
          if (!(error instanceof VerifierPreimagesUnavailable)) return false;
          assert(error.message.includes(removed));
          const failure = failScriptReportWithFatalError(report, 'assemble_ai_prompt', error, frameworkRoot, 'verification_evidence_gap');
          const summary = sign(failure);
          assert.equal(summary.verifier_request, undefined);
          assert(!fs.existsSync(prompt));
          assert.equal(classifyFailureKind(summary), 'verification_evidence_gap');
          assert.equal(failure.checks.find(check => check.id === 'runner_assemble_ai_prompt_failed')?.actionability, 'agent_fixable');
          lastGapSummary = summary;
          return true;
        });
        fs.writeFileSync(blob, bytes);
        assert(recheck(lastGapSummary), 'restored real evidence bypasses the previously cached gap');
        const restored = build();
        assert.equal(restored.material_sha256, current.material_sha256);
        const crash = failScriptReportWithFatalError(report, 'assemble_ai_prompt', new TypeError('actual assembly bug'), frameworkRoot);
        assert.equal(crash.checks.at(-1)?.failure_kind, 'framework_bug');
        assert.equal(crash.checks.at(-1)?.actionability, 'human_only');
      } finally {
        if (priorBase === undefined) delete process.env.HARNESS_DIFF_BASE_REF; else process.env.HARNESS_DIFF_BASE_REF = priorBase;
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'S1 publication reads a Review original once and keeps purpose, facts delta and historical bytes',
    run: () => {
      const root = mkProject(), frameworkRoot = path.resolve(__dirname, '../../..'), phase = 'review';
      const snapshot = path.join(frameworkRoot, 'harness/tests/fixtures/host-recovery-history/20261024-fe4512-s1');
      const review = fs.readFileSync(path.join(snapshot, 'doc/features/bc-openCard-2/bank-card-opening-flow/review/review-report.md'), 'utf8');
      const feature = FEATURE, featureDir = `doc/features/${feature}`;
      const reportPath = featureDir + '/review-report.md';
      const factsPath = featureDir + '/context/facts.md';
      const facts = '---\nschema_version: "1.0"\n---\n\nShared original\n\n## phase_delta: coding\nEarlier investigation\n\n## phase_delta: review\nCurrent review facts\n';
      try {
        put(root, reportPath, review);
        put(root, factsPath, facts);
        const loader = new SpecLoader(root, undefined, undefined, frameworkRoot);
        const layout = { kind: 'standalone' as const, projectRoot: root, frameworkRoot, frameworkRel: '' };
        const resolvedInputs: ResolvedPhaseInputs = { phase, values: {}, artifacts: {},
          context: { schema_version: '1.1', subject: { feature }, obligations: {}, required_outputs: ['review-report.md'] } };
        const factsContext: FactsInvocationContext = { subject: { feature }, first_phase: 'spec', source_paths: [], required_input_snippets: [] };
        for (const modern of [false, true]) {
          const opts = modern ? { resolvedInputs, factsContext } : {};
          const files = collectContextFiles(loader, layout, phase, feature, loader.loadFeatureSpec(feature, opts.resolvedInputs), opts);
          assert.equal(files.filter(file => file.label === reportPath).length, 1);
          const supplemental: ContextFileEntry[] = [
            { label: reportPath, kind: 'path', content: '独立复核的当前 Review 原件' },
            { label: reportPath, content: review },
            { label: `(before genuine-prior) ${reportPath}`, content: 'Older baseline bytes' },
          ];
          const prompt = assembleAIPrompt(path.join(frameworkRoot, 'harness'), root, phase, feature, [...files, ...supplemental],
            '{}', 'rule', undefined, undefined, frameworkRoot);
          assert.equal(prompt.split('### ' + reportPath + '\n').length - 1, 1);
          assert.equal(prompt.split('CR-001 已修复：').length - 1, 1, 'S1 report bytes must appear once even when also selected as a required output');
          assert(prompt.includes('CR-002 已修复：') && prompt.includes('CR-003 已修复：'));
          assert(prompt.includes('独立复核的当前 Review 原件') && prompt.includes('Older baseline bytes'));
          if (modern) {
            assert(prompt.includes('Shared original') && prompt.includes('Current review facts') && !prompt.includes('Earlier investigation'));
            assert(prompt.includes(factsPath), 'the full facts original remains locatable');
            const build = (): ReturnType<typeof buildVerifierMaterialView> => buildVerifierMaterialView({ ...opts, projectRoot: root, frameworkRoot,
              feature, phase, gateFingerprint: null, phaseRuleText: 'rule', templateText: 'template', checks: CHECKS, contextFiles: files });
            const initial = build();
            assert.equal(initial.files.find(file => file.path === factsPath)?.sha256, factsPhaseFingerprint(facts, phase));
            put(root, factsPath, facts + '\n## phase_delta: ut\nLater investigation\n');
            assert.equal(build().material_sha256, initial.material_sha256);
            put(root, factsPath, facts.replace('Current review facts', 'Changed current review facts'));
            assert.deepEqual(diffVerifierMaterial(initial, build()), [factsPath]);
          }
        }
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    },
  },
  {
    name: 'Coding tool-read lists only images copied from this resolved spec',
    run: () => {
      const root = mkProject(), frameworkRoot = path.resolve(__dirname, '../../..'), phase = 'coding';
      const feature = FEATURE, featureDir = `doc/features/${feature}`;
      const loader = new SpecLoader(root, undefined, undefined, frameworkRoot);
      const render = (name: string) => {
        const image = `${featureDir}/ux-reference/${name}.png`;
        fs.mkdirSync(path.dirname(path.join(root, image)), { recursive: true });
        fs.writeFileSync(path.join(root, image), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
        const spec = ['```yaml', 'ui_change: new_or_changed', 'visual_handoff:', '  kind: screenshot_pack',
          '  authoritative_refs:', '    - id: current', `      path: ${image}`, '```'].join('\n');
        const resolvedInputs: ResolvedPhaseInputs = { phase, values: {}, artifacts: { 'spec@1': spec },
          context: { schema_version: '1.1', subject: { feature }, obligations: {}, required_outputs: [] } };
        const files = collectContextFiles(loader, { kind: 'standalone', projectRoot: root, frameworkRoot, frameworkRel: '' }, phase,
          feature, loader.loadFeatureSpec(feature, resolvedInputs), { resolvedInputs, adapterImageInput: 'tool_read' });
        return assembleAIPrompt(path.join(frameworkRoot, 'harness'), root, phase, feature, files,
          '{}', 'rule', undefined, undefined, frameworkRoot, { imageInput: 'tool_read' });
      };
      try {
        assert(render('old-round').includes('- file: 00-old-round.png'));
        const second = render('current-round');
        const sidecars = path.join(featurePhaseReportsDir(root, feature, phase, frameworkRoot), 'context-images');
        assert(fs.existsSync(path.join(sidecars, '00-old-round.png')), 'keep the historical image on disk');
        assert(second.includes('- file: 00-current-round.png') && !second.includes('00-old-round.png'));
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    },
  },
  {
    name: 'P2 actual run control manifest budget is material-neutral; requirement, write authority and non-control files remain binding',
    run: () => {
      const f = codingFixture(false, true), file = path.join(f.root, f.manifest.report_dir, 'manifest.json');
      const relative = path.relative(f.root, file).replace(/\\/g, '/'), original = fs.readFileSync(file, 'utf8');
      const manifest = JSON.parse(original), identity = computeManifestIdentityFields(manifest);
      const hash = (target = relative) => verifierMaterialFileHash({ projectRoot: f.root, feature: 'demo', phase: 'coding', file: target });
      const build = () => buildVerifierMaterialView({ projectRoot: f.root, frameworkRoot: path.resolve(__dirname, '../../..'), feature: 'demo', phase: 'coding',
        runId: f.manifest.run_id, gateFingerprint: null, phaseRuleText: 'rule', templateText: 'template', checks: CHECKS,
        contextFiles: [{ label: relative, kind: 'path', content: 'Read the actual original control file.' }] });
      try {
        const before = hash(), material = build();
        manifest.budget = { max_total_turns: 17 };
        manifest.created_at = '2026-10-30T00:00:00.000Z';
        fs.writeFileSync(file, JSON.stringify(manifest));
        assert.equal(hash(), before, 'one public control budget must not purchase another verifier');
        assert.equal(build().material_sha256, material.material_sha256, 'producer and consumer share the single projection');
        assert(verifierMaterialFileMatchesCurrent({ projectRoot: f.root, feature: 'demo', material, file: relative }));
        assert(!diffManifestIdentityFields(identity, computeManifestIdentityFields(manifest)).includes('budget'), 'retired control declarations do not grant current authority');
        manifest.requirement += ' plus a real new business result'; fs.writeFileSync(file, JSON.stringify(manifest));
        assert.notEqual(hash(), before);
        assert(!verifierMaterialFileMatchesCurrent({ projectRoot: f.root, feature: 'demo', material, file: relative }));
        Object.assign(manifest, JSON.parse(original));
        manifest.unattended = { ...manifest.unattended, write_mode: 'workspace-write', approval_mode: 'always', allowed_tools: ['Read'] };
        fs.writeFileSync(file, JSON.stringify(manifest)); assert.notEqual(hash(), before, 'real write/approval/tool authority remains visible');
        fs.writeFileSync(file, original);
        const copy = put(f.root, 'business/manifest.json', original), copiedHash = hash(copy);
        const copied = JSON.parse(original); copied.budget = { max_total_turns: 1 }; fs.writeFileSync(copy, JSON.stringify(copied));
        assert.notEqual(hash(copy), copiedHash, 'a matching filename or copied shape is not the original run control');
        const born = path.join(path.dirname(file), 'events.jsonl'), events = fs.readFileSync(born);
        fs.writeFileSync(born, ''); const unproven = hash();
        fs.writeFileSync(file, JSON.stringify(copied)); assert.notEqual(hash(), unproven, 'no real birth/start evidence means no special projection');
        fs.writeFileSync(born, events);
      } finally { clearFrameworkConfigCache(); fs.rmSync(f.root, { recursive: true, force: true }); }
    },
  },
  {
    name: '77105c47 Q reopens acceptance and method consumers without pulling in unrelated view members',
    run: () => {
      const methodRef = 'interface:view:development/node:otp/LedgerOtp#canSubmit';
      const sameNamedMethod = 'interface:view:development/node:home/LedgerOtp#canSubmit';
      const blueprint = {
        blueprint_id: 'ledger', design_views: [
          { view_id: 'development', applicability: 'applicable', evolution_impact: 'changed', nodes: [
            { node_id: 'otp', acceptance: { criteria: [{ id: 'AC-4', description: '验证码满六位允许提交' }],
              boundaries: [{ id: 'BD-4', expected_result: '错误后仍可重发' }],
              performance: [{ id: 'NFR-SUBMIT', threshold: 250 }] },
              contracts: { interfaces: [{ class: 'LedgerOtp', methods: [{ name: 'canSubmit', return: 'boolean' }] }] } },
            { node_id: 'home', description: 'Shows existing cards', provenance: { source_kind: 'requirement', source_ref: 'request.md' },
              contracts: { interfaces: [{ class: 'LedgerOtp', methods: [{ name: 'canSubmit', return: 'boolean' }] }] } },
          ] },
          { view_id: 'runtime', applicability: 'applicable', evolution_impact: 'changed', runtime_data_flows: [
            { flow_id: 'otp-entry', ordered_steps: [methodRef], verification_refs: ['AC-4', 'BD-4', 'NFR-SUBMIT'] },
            { flow_id: 'home-read', ordered_steps: [sameNamedMethod], design_refs: ['view:development/node:home'],
              provenance: { source_kind: 'requirement', source_ref: 'request.md' } },
          ] },
          { view_id: 'scenarios', applicability: 'applicable', evolution_impact: 'changed', nodes: [
            { node_id: 'submit-case', use_cases: { use_cases: [{ data_boundaries: [{ methods: [methodRef] }] }] } },
          ] },
        ], relations: [], review_summary: { authored_by: 'author' },
      };
      const items = [...requiredQuestioningScopes(blueprint)].map(([ref, kind]) => ({ question: 'Is this scope sufficiently justified?', owner: 'design', scope_kind: kind,
        scope_ref: ref, disposition: 'not_applicable', verification_refs: ['request:original'], provenance: { source_kind: 'requirement', source_ref: 'request.md', observed_at: '2026-10-29', evidence_strength: 'authoritative', extraction_method: 'read' } }));
      const previous = createIndependentQuestioningResult({ providerId: 'independent', authoredBy: 'author', items });
      const changed = structuredClone(blueprint);
      const node = changed.design_views[0].nodes![0];
      assert('acceptance' in node && node.acceptance && 'contracts' in node && node.contracts);
      node.acceptance.criteria[0].description += '。 ';
      assert.deepEqual(selectQuestioningScopes(blueprint, changed, previous), []);
      node.acceptance.criteria[0].description = '验证码满五位允许提交';
      const expected = ['view:development', 'view:runtime', 'flow:otp-entry'];
      assert.deepEqual(selectQuestioningScopes(blueprint, changed, previous), expected);
      node.acceptance.criteria[0].description = '验证码满六位允许提交';
      node.acceptance.boundaries[0].expected_result = '错误后需重开半模态';
      assert.deepEqual(selectQuestioningScopes(blueprint, changed, previous), expected);
      node.acceptance.boundaries[0].expected_result = '错误后仍可重发';
      node.acceptance.performance[0].threshold = 500;
      assert.deepEqual(selectQuestioningScopes(blueprint, changed, previous), expected);
      node.acceptance.performance[0].threshold = 250;
      node.contracts.interfaces[0].methods[0].return = 'number';
      assert.deepEqual(selectQuestioningScopes(blueprint, changed, previous), [...expected, 'view:scenarios']);
      node.acceptance.criteria[0].description = '一万字说明'.repeat(2_000);
      const diff = describeQuestioningChanges(blueprint, changed, 'before.yaml', 'current.yaml');
      assert(Buffer.byteLength(diff, 'utf8') < 1_000);
      assert(diff.includes('/design_views/0/nodes/0/acceptance/criteria/0/description') && diff.includes('view:development/node:otp'));
      assert(diff.includes('before.yaml') && diff.includes('current.yaml'));
    },
  },
  {
    name: 'P2 C test strength materials follow applicable unit acceptance across check families instead of requiring a prior design failure',
    run: () => {
      const root = mkProject();
      try {
        put(root, 'framework.config.json', JSON.stringify({ schema_version: '1.1', project_name: 'strength', project_profile: { name: 'hmos-app' },
          architecture: { outer_layers: [{ id: '02-Feature', can_depend_on: [], intra_layer_deps: 'dag' }], module_inner_layers: ['shared'], inner_dependency_direction: 'upward', cross_module_exports_file: 'index.ets' },
          paths: { features_dir: 'doc/features', docs_committed: false } })); clearFrameworkConfigCache();
        const source = '02-Feature/Value/src/main/ets/Value.ets', test = '02-Feature/Value/src/ohosTest/ets/test/Value.test.ets';
        put(root, source, 'export function value() { return 42; }');
        put(root, test, "it('failure path', 0, () => { expect(value()).assertEqual(42); });");
        put(root, `doc/features/${FEATURE}/contracts.yaml`, YAML.stringify({ feature: FEATURE, files: [source, test], modules: [{ name: 'Value', package_path: '02-Feature/Value' }] }));
        put(root, `doc/features/${FEATURE}/acceptance.yaml`, YAML.stringify({ feature: FEATURE, criteria: [{ id: 'AC-1', description: 'value is observable', ut_layer: 'unit' }] }));
        put(root, `doc/features/${FEATURE}/ut/reports/coverage-evidence.json`, JSON.stringify({ schema_version: '1.0', feature: FEATURE,
          mappings: [{ scope_id: 'AC-1', scope_kind: 'acceptance_criterion', evidence_source: 'ut_tags', evidence_ref: test },
            { scope_id: 'AC-1', scope_kind: 'acceptance_criterion', evidence_source: 'ut_tags', evidence_ref: '../../outside/src/ohosTest/private.ets' }] }));
        for (const phase of ['coding', 'review', 'ut', 'testing']) {
          const entries = collectTestStrengthContext({ projectRoot: root, frameworkRoot: path.resolve(__dirname, '../../..'), feature: FEATURE, phase });
          assert(entries.some(entry => entry.label === test), `${phase}: actual assertions were not delivered`);
          assert(entries.some(entry => entry.label === source), `${phase}: actual product call chain was not delivered`);
          assert(entries.some(entry => entry.label.includes('existing assertion evidence')) && entries.some(entry => entry.content.includes('AC-1')),
            'machine weakening evidence and applicable acceptance must remain visible without self-signing sufficiency');
          assert(entries.some(entry => entry.label === '(test source reference gap)') && !entries.some(entry => entry.label.startsWith('../')),
            'a bad reference is diagnosed without reading it or dropping valid material');
        }
      } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
    },
  },
  {
    name: '5ea729d4 only Testing receives device retest verdict requests while Spec keeps the bound originals',
    run: () => {
      const root = mkProject();
      const frameworkRoot = path.resolve(__dirname, '../../..');
      const retest = require('../../scripts/utils/testing-trace-gates') as typeof import('../../scripts/utils/testing-trace-gates');
      const readPending = retest.readPendingTestingRetests;
      try {
        const trace = put(root, 'device/original-trace.json', 'recorded device failure');
        const plan = put(root, 'device/original-plan.md', 'steps and expected result');
        const candidate = put(root, 'device/retest-trace.json', 'recorded retest counterevidence');
        retest.readPendingTestingRetests = () => [{
          route: { caseId: 'TC-001', stepIndex: 4 } as ReturnType<typeof readPending>[number]['route'],
          tracePath: trace, derivedPlanPath: plan, behavior: 'the original behavior still needs independent evidence',
          acceptance: [], candidateEvidence: [candidate], reviewCandidates: [],
        }];
        for (const phase of ['spec', 'testing'] as const) {
          const input = { projectRoot: root, frameworkRoot, feature: FEATURE, phase, runId: 'existing-run' };
          const files = collectCurrentAcceptanceEvidence(input);
          const prompt = assembleAIPrompt(path.join(frameworkRoot, 'harness'), root, phase, FEATURE, files, '{}', '',
            undefined, undefined, frameworkRoot, { templateText: '{context_files}' });
          const material = buildVerifierMaterialView({ ...input, gateFingerprint: null, phaseRuleText: '', templateText: '', checks: [], contextFiles: files });
          for (const file of [trace, plan, candidate]) {
            const relative = path.relative(root, file).replace(/\\/g, '/');
            assert(prompt.includes(relative) && material.files.some(entry => entry.path === relative),
              `${phase}: the existing trace, plan and retest counterevidence must remain navigable and bound`);
          }
          assert.equal(prompt.includes('testing_failure_routing_TC-001_s4'), phase === 'testing');
          assert.equal(prompt.includes('在原issue-verification逐条给refuted/confirmed/unclear'), phase === 'testing');
          assert.equal(prompt.includes('the original behavior still needs independent evidence'), phase === 'testing');
        }
      } finally { retest.readPendingTestingRetests = readPending; fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
    },
  },
  {
    name: 'P2 C incremental verification receives public originals, open findings and actual dependency changes without author-private state',
    run: () => {
      const root = mkProject();
      try {
        put(root, 'src/a.ets', 'old');
        const build = () => buildVerifierMaterialView({ projectRoot: root, feature: FEATURE, phase: 'review', gateFingerprint: null,
          phaseRuleText: 'rule', templateText: 'template', checks: CHECKS, contextFiles: [{ label: 'src/a.ets', kind: 'path', content: '' }] });
        const before = build(); put(root, 'src/a.ets', 'current'); const current = build();
        const context = independentVerificationContext({ previousReport: { feature: FEATURE, phase: 'review', subject_id: 'a'.repeat(64), verdict: 'FAIL', blocker_count: 1,
          report_text: 'public denial', md_path_abs: path.join(root, 'public-original.md'), md_path_rel: 'public-original.md' }, previousMaterial: before, currentMaterial: current,
          actualDiff: [{ label: '(actual diff)', content: '-old\n+current' }], openFindings: { phase: 'review', reportPath: 'public-original.md', reportText: 'public denial', rows: [
            { id: 'CR-1', classification: 'implementation', severity: 'BLOCKER', state: 'open', files: ['src/a.ets'], summary: 'failure recovery is absent' }], evidenceFiles: [], diagnostics: ['one old reference unavailable'] },
          affectedDependencies: [{ path: 'src/a.ets', exists: true, sha256: 'b'.repeat(64), role: 'derive' }],
          currentEvidence: [{ label: '(actual execution)', content: 'real execution still fails' }], declineContext: [{ label: '(refusal original)', content: 'declined: full original reason\n\nsecond paragraph' }] });
        const text = context.map(entry => entry.label + '\n' + entry.content).join('\n');
        for (const expected of ['public-original.md', 'CR-1', '-old\n+current', 'src/a.ets', 'one old reference unavailable', 'real execution still fails', 'second paragraph']) assert(text.includes(expected), expected);
        assert(text.includes('增量复核') && text.includes('confirmed/refuted/unclear'));
        const unknown = independentVerificationContext({ previousReport: null, previousMaterial: before, currentMaterial: current, actualDiff: null });
        assert(unknown[0].content.includes('完整核验') && unknown[0].content.includes('HEAD'));
      } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
    },
  },
  {
    name: 'P2 C blueprint review material ignores schema machine metadata while preserving independent denial and business provenance',
    run: () => {
      const root = mkProject();
      try {
        const blueprint: Record<string, any> = { artifact: 'component-blueprint@1', blueprint_id: 'review-unit', revision: 1,
          provenance: { source_kind: 'requirement', source_ref: 'request.md', observed_at: 'before', evidence_strength: 'authoritative', extraction_method: 'read' },
          review_summary: { admission: { status: 'blocker' }, questioning: { provider_id: 'old-provider', isolated_context: true, status: 'complete', writes_ssot: false,
            items: [{ question_id: 'old-id', question: 'Does recovery work?', owner: 'author', scope_kind: 'view', scope_ref: 'view:runtime', disposition: 'blocker', answer: 'Missing compensation.' }] } } };
        const write = () => put(root, 'blueprint.yaml', YAML.stringify(blueprint));
        const resolved = (): ResolvedPhaseInputs => ({ phase: 'review', context: { schema_version: '1.1', subject: { feature: FEATURE }, obligations: {}, required_outputs: [] },
          artifacts: {}, values: { contracts: { state: 'resolved', value: { modules: [], files: [] }, binding: { input_id: 'contracts',
            source: { kind: 'derive', provider_id: 'derive.blueprint-contracts' }, source_refs: ['blueprint.yaml'],
            content_fingerprint: 'a'.repeat(64), dependencies: [{ path: path.join(root, 'blueprint.yaml'), exists: true, role: 'artifact',
              sha256: createHash('sha256').update(fs.readFileSync(path.join(root, 'blueprint.yaml'))).digest('hex') }] } } } });
        const build = () => buildVerifierMaterialView({ projectRoot: root, feature: FEATURE, phase: 'review', gateFingerprint: null,
          phaseRuleText: 'rule', templateText: 'template', checks: CHECKS, resolvedInputs: resolved(), contextFiles: [{ label: 'blueprint.yaml', kind: 'path', content: '' }] });
        write(); const before = build();
        const inputs = resolved();
        const oldBindingHash = createHash('sha256').update(stableStringify(Object.entries(inputs.values)
          .map(([id, value]) => [id, value.state === 'resolved' ? value.binding : value]))).digest('hex');
        const legacy = { ...before, schema: 'maison-verifier-material@1', input_bindings_sha256: oldBindingHash,
          files: before.files.map(file => file.path === 'blueprint.yaml' ? { ...file, sha256: createHash('sha256').update(fs.readFileSync(path.join(root, file.path))).digest('hex') } : file) };
        legacy.material_sha256 = computeMaterialSha256(legacy);
        assert(verifierMaterialFileMatchesCurrent({ projectRoot: root, feature: FEATURE, material: before, file: 'blueprint.yaml' }), 'the current consumer uses the same versioned projection as the producer');
        assert(verifierMaterialFileMatchesCurrent({ projectRoot: root, feature: FEATURE, material: legacy, file: 'blueprint.yaml' }), 'legacy raw originals keep their original schema recipe');
        assert(!verifierMaterialFileMatchesCurrent({ projectRoot: root, feature: FEATURE, material: { ...legacy, schema: before.schema }, file: 'blueprint.yaml' }), 'a current-schema record cannot silently choose a raw or unrelated digest');
        assert(verifierMaterialsEquivalent(legacy, before, root, inputs), 'original bound bytes and inputs prove a pure historical representation migration');
        assert(!verifierMaterialsEquivalent(legacy, before, root), 'a missing original input basis cannot be guessed from HEAD or author claims');
        blueprint.revision++; blueprint.provenance.observed_at = 'later'; blueprint.review_summary.admission.status = 'pass';
        blueprint.review_summary.questioning.provider_id = 'new-provider'; blueprint.review_summary.questioning.items[0].question_id = 'new-id'; write();
        const metadataOnly = build();
        assert.equal(metadataOnly.material_sha256, before.material_sha256, 'machine envelopes cannot purchase another Q');
        assert(verifierMaterialFileMatchesCurrent({ projectRoot: root, feature: FEATURE, material: before, file: 'blueprint.yaml' }));
        assert(verifierMaterialsEquivalent(before, metadataOnly, root), 'already-normalized current evidence remains reusable across machine metadata writes');
        blueprint.review_summary.summary = 'The author now claims a different recovery guarantee.'; write();
        assert.notEqual(build().material_sha256, before.material_sha256, 'an actual author statement is independent review material even when it is not proof of progress');
        assert(!verifierMaterialFileMatchesCurrent({ projectRoot: root, feature: FEATURE, material: before, file: 'blueprint.yaml' }));
        delete blueprint.review_summary.summary;
        blueprint.review_summary.questioning.summary = 'The public Q business conclusion changed.'; write();
        assert.notEqual(build().material_sha256, before.material_sha256, 'public substantive Q summary cannot be dropped as a progress-only field');
        delete blueprint.review_summary.questioning.summary;
        blueprint.review_summary.questioning.items[0].answer = 'An independent new counterexample proves compensation is wrong.'; write();
        assert.notEqual(build().material_sha256, before.material_sha256, 'Q business denial cannot be stripped with its envelope');
        blueprint.review_summary.questioning.items[0].answer = 'Missing compensation.'; blueprint.provenance.source_ref = 'different-request.md'; write();
        assert.notEqual(build().material_sha256, before.material_sha256, 'business provenance remains review material');
      } finally { fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
    },
  },
  {
    name: 'current acceptance anchors use the profile filename and preserve original or unavailable profile semantics',
    run: () => {
      const root = mkProject(), frameworkRoot = path.resolve(__dirname, '../../..');
      const native = require('../../../profiles/hmos-app/harness/execution-key') as { EXECUTION_KEY_FILE: string | undefined };
      const original = native.EXECUTION_KEY_FILE;
      const originalPath = `doc/features/${FEATURE}/ut/reports/run/ut/${original}`;
      try {
        put(root, originalPath, '{}');
        const options = { projectRoot: root, frameworkRoot };
        const build = (label: string, selectedFrameworkRoot = frameworkRoot) => buildVerifierMaterialView({ ...options, frameworkRoot: selectedFrameworkRoot,
          feature: FEATURE, phase: 'plan', gateFingerprint: null, phaseRuleText: 'rule', templateText: 'template', checks: [],
          contextFiles: [{ label, content: 'native proof' }] });
        assert(currentAcceptanceExecutionKeyMatcher(options)(originalPath));
        native.EXECUTION_KEY_FILE = 'native-ut-key.json';
        const matches = currentAcceptanceExecutionKeyMatcher(options);
        const variantPath = `doc/features/${FEATURE}/ut/reports/run/ut/native-ut-key.json`;
        put(root, variantPath, '{}');
        assert(matches(variantPath));
        assert(!matches(originalPath));
        assert(!matches(variantPath.replace('/ut/native-ut-key.json', '/other/native-ut-key.json')));
        const repair = require('../../scripts/utils/repair-candidates') as typeof import('../../scripts/utils/repair-candidates');
        const readIssues = repair.readPhaseRepairIssues;
        let collections = 0;
        repair.readPhaseRepairIssues = () => { collections += 1; return null; };
        try {
          build(variantPath);
          assert.equal(collections, 0, 'the material producer recognizes a profile-named anchor already in context');
        } finally { repair.readPhaseRepairIssues = readIssues; }
        native.EXECUTION_KEY_FILE = undefined;
        assert(!currentAcceptanceExecutionKeyMatcher(options)(variantPath));
        native.EXECUTION_KEY_FILE = original;
        assert(currentAcceptanceExecutionKeyMatcher(options)(originalPath), 'original material naming remains compatible');
        assert(build(originalPath).files.some(file => file.path === originalPath));
        put(root, 'framework.config.json', JSON.stringify({ project_profile: { name: 'minimal' } }));
        put(root, 'framework/profiles/minimal/profile.yaml', 'name: minimal\n');
        clearFrameworkConfigCache();
        assert(!currentAcceptanceExecutionKeyMatcher({ projectRoot: root, frameworkRoot: path.join(root, 'framework') })(originalPath));
        assert(build(originalPath, path.join(root, 'framework')).files.some(file => file.path === originalPath), 'missing native support does not erase supplied material');
      } finally { native.EXECUTION_KEY_FILE = original; fs.rmSync(root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
    },
  },
  {
    name: 'a same-path semantic contract change still reaches the original design-scope producer',
    run: () => {
      const f = setupRunlessProject({ chain: ['plan', 'coding', 'review', 'ut'] });
      try {
        assert.equal(ensureFeatureExecutionScopeFrozen({ projectRoot: f.root, frameworkRoot: f.frameworkRoot, feature: f.feature }).status, 'frozen');
        const options = { projectRoot: f.root, frameworkRoot: f.frameworkRoot, feature: f.feature, phase: 'plan', track: 'full' as const };
        const entry = resolveCapabilityResolutionEntryInput({ ...options, featuresDir: relFeaturesDir(f.root) });
        const inputs = resolveCapabilityInputs({ ...options, ...entry }).inputs!;
        const loader = new SpecLoader(f.root, undefined, undefined, f.frameworkRoot);
        const ctx: CheckContext = { ...options, phase: 'plan', resolvedInputs: inputs, featureSpec: loader.loadFeatureSpec(f.feature, inputs), factsContext: entry.factsContext,
          phaseRule: loader.loadPhaseRule('plan'), resolvedProfile: loadResolvedProfile(f.root, loadFrameworkConfig(f.root), f.frameworkRoot),
          harnessRoot: path.join(f.frameworkRoot, 'harness'), frameworkRel: 'framework' };
        assert.deepEqual(designScopeRevisionChecks(ctx, []), []);
        const contracts = resolveFeatureArtifact(f.root, f.feature, 'contracts.yaml').actualPath;
        const updated = YAML.parse(fs.readFileSync(contracts, 'utf8'));
        updated.interfaces = [{ class: 'DemoPort', file: 'src/demo/value.ts', methods: [{ name: 'readValue', params: [], return: 'number' }] }];
        fs.writeFileSync(contracts, YAML.stringify(updated));
        const produced = resolveCapabilityInputs({ ...options,
          inputContext: { schema_version: '1.1', subject: { feature: f.feature }, obligations: {}, required_outputs: [] } }).inputs!;
        assert(produced.values.contracts.state === 'resolved');
        assert(designScopeRevisionChecks({ ...ctx, resolvedInputs: produced, featureSpec: loader.loadFeatureSpec(f.feature, produced) }, [])
          .some(check => check.scope_revision_input), 'path rebasing must not hide a real new interface contract');
      } finally { fs.rmSync(f.root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
    },
  },
  {
    name: '材料视图：同材料两次构建同指纹；上下文文件内容/脚本 check 状态/规则/模板变了才换；reports 运行期产物不入材料',
    run: () => {
      const root = mkProject();
      try {
        put(root, 'src/a.ets', 'a v1');
        put(root, `doc/features/${FEATURE}/review/reports/20260903-000001/hylyre/trace.json`, '{"cases":[]}');
        const ctx: ContextFileEntry[] = [
          { label: 'src/a.ets', kind: 'path', content: '4 字节' },
          // verifier 必读的运行期证据由 runner 以路径条目显式送入 → 入材料（codex review）
          { label: `doc/features/${FEATURE}/review/reports/20260903-000001/hylyre/trace.json`, kind: 'path', content: '' },
          { label: '(truncated)', content: '...' },
        ];
        const base = {
          projectRoot: root, feature: FEATURE, phase: 'review', gateFingerprint: '3.0.0:abcdef012345',
          phaseRuleText: 'rule: 1', templateText: '# template', checks: CHECKS, contextFiles: ctx,
        };
        const v1 = buildVerifierMaterialView(base);
        const v2 = buildVerifierMaterialView(base);
        assert.strictEqual(v1.material_sha256, v2.material_sha256, '同材料必须同指纹');
        assert.ok(v1.files.some(f => f.path === 'src/a.ets'), '上下文源码按路径入材料');
        assert.ok(v1.files.some(f => f.path.endsWith('hylyre/trace.json')), '显式送入的最新 run trace 须入材料');
        assert.ok(!v1.files.some(f => f.path.endsWith('summary.json')), 'manifest 侧的 reports 运行期产物（summary 等）不入材料');
        assert.deepStrictEqual(v1.script_checks, ['a=PASS/MAJOR', 'b=WARN/MINOR']);

        put(root, 'src/a.ets', 'a v2');
        assert.notStrictEqual(buildVerifierMaterialView(base).material_sha256, v1.material_sha256, '源码内容变 → 换指纹');
        put(root, 'src/a.ets', 'a v1');
        assert.notStrictEqual(
          buildVerifierMaterialView({ ...base, checks: [{ id: 'a', status: 'FAIL', severity: 'MAJOR' }, CHECKS[1]] }).material_sha256,
          v1.material_sha256, 'check 状态变 → 换指纹',
        );
        assert.notStrictEqual(buildVerifierMaterialView({ ...base, phaseRuleText: 'rule: 2' }).material_sha256, v1.material_sha256, '规则变 → 换指纹');
        assert.notStrictEqual(buildVerifierMaterialView({ ...base, templateText: '# template v2' }).material_sha256, v1.material_sha256, '模板变 → 换指纹');
        assert.strictEqual(buildVerifierMaterialView({ ...base, contextFiles: [...ctx, { label: '(multimodal-degraded)', content: 'x' }] }).material_sha256, v1.material_sha256, '伪标签条目不入材料');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: '差异登记：文件改/增/删与规则/模板/check 投影逐项列出；上一份缺失时如实标 unavailable',
    run: () => {
      const root = mkProject();
      try {
        put(root, 'src/a.ets', 'a');
        put(root, 'src/b.ets', 'b');
        const mk = (files: ContextFileEntry[], extra?: { phaseRuleText?: string; checks?: typeof CHECKS }) =>
          buildVerifierMaterialView({
            projectRoot: root, feature: FEATURE, phase: 'review', gateFingerprint: null,
            phaseRuleText: extra?.phaseRuleText ?? 'r', templateText: 't', checks: extra?.checks ?? CHECKS, contextFiles: files,
          });
        const prev = mk([{ label: 'src/a.ets', kind: 'path', content: '' }, { label: 'src/b.ets', kind: 'path', content: '' }]);
        put(root, 'src/a.ets', 'a2');
        put(root, 'src/c.ets', 'c');
        const curr = mk(
          [{ label: 'src/a.ets', kind: 'path', content: '' }, { label: 'src/c.ets', kind: 'path', content: '' }],
          { phaseRuleText: 'r2', checks: [{ id: 'a', status: 'FAIL', severity: 'MAJOR' }] },
        );
        const diff = diffVerifierMaterial(prev, curr);
        assert.deepStrictEqual(diff, ['phase_rules', 'script_report_checks', 'src/a.ets', '+src/c.ets', '-src/b.ets'], JSON.stringify(diff));
        assert.deepStrictEqual(diffVerifierMaterial(null, curr), ['(prior material manifest unavailable)']);
        assert.deepStrictEqual(diffVerifierMaterial(prev, prev), []);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: '落盘：按 subject 分区读写往返；非法 subject 拒绝造文件名',
    run: () => {
      const root = mkProject();
      try {
        const subject = 'c'.repeat(64);
        const view = buildVerifierMaterialView({
          projectRoot: root, feature: FEATURE, phase: 'plan', gateFingerprint: null,
          phaseRuleText: 'r', templateText: 't', checks: [], contextFiles: [],
        });
        writeVerifierMaterial(root, subject, view);
        assert.deepStrictEqual(readVerifierMaterialOrNull(root, subject), view);
        assert.strictEqual(readVerifierMaterialOrNull(root, 'd'.repeat(64)), null);
        assert.throws(() => verifierMaterialFilename('short'));
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: '扩展输入入材料（cp c7e2a9f4 §2.6）：只改 extensionInstructions → 指纹变且 diff 标 extension_instructions；knowledge（audience 命中 / 仅 binding 引入）以 path 条目入材料，改正文即点名路径',
    run: () => {
      const root = mkProject();
      try {
        put(root, 'src/a.ets', 'a');
        put(root, 'doc/extensions/knowledge/spec-author.md', '# spec v1');
        put(root, 'doc/extensions/knowledge/plan-only.md', '# plan v1');
        const knowledge = (): ContextFileEntry[] => [
          { label: 'src/a.ets', kind: 'path', content: '' },
          // audience 命中的 knowledge 与仅由 phase_bindings 引入的 knowledge 同样按 path 条目送入（harness-runner 接线）
          { label: 'doc/extensions/knowledge/spec-author.md', kind: 'path', content: 'spec 作者要求' },
          { label: 'doc/extensions/knowledge/plan-only.md', kind: 'path', content: 'plan 惯例' },
        ];
        const mk = (extensionInstructions?: string) => buildVerifierMaterialView({
          projectRoot: root, feature: FEATURE, phase: 'spec', gateFingerprint: null,
          phaseRuleText: 'r', templateText: 't', checks: CHECKS, contextFiles: knowledge(), extensionInstructions,
        });
        const base = mk('## Instance extension inputs\n\n### Knowledge index\n\n- `doc/extensions/knowledge/spec-author.md`');
        assert.strictEqual(base.extension_sha256.length, 64, '有扩展输入时 extension_sha256 须为 sha256');
        assert.strictEqual(mk().extension_sha256, '', '无扩展输入时为空串');
        const instrChanged = mk('## Instance extension inputs\n\n### before_phase_work\n\n- mcp `fetch` → tool `host.fetch`; usage v2');
        assert.notStrictEqual(instrChanged.material_sha256, base.material_sha256, '只改扩展指令也必须换材料指纹');
        assert.deepStrictEqual(diffVerifierMaterial(base, instrChanged), ['extension_instructions']);
        // 旧材料文件没有 extension_sha256 字段：按空串对账，不视为不可用
        const legacy = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
        delete legacy.extension_sha256;
        assert.deepStrictEqual(diffVerifierMaterial(legacy as never, mk()), []);
        assert.deepStrictEqual(diffVerifierMaterial(legacy as never, base), ['extension_instructions']);
        // audience 命中的 knowledge 改正文 → 点名路径
        put(root, 'doc/extensions/knowledge/spec-author.md', '# spec v2');
        const specChanged = mk(base.extension_sha256 && '## Instance extension inputs\n\n### Knowledge index\n\n- `doc/extensions/knowledge/spec-author.md`');
        assert.deepStrictEqual(diffVerifierMaterial(base, specChanged), ['doc/extensions/knowledge/spec-author.md']);
        // 仅由 binding 引入（audience 属别的阶段）的 knowledge 改正文 → 同样点名路径
        put(root, 'doc/extensions/knowledge/plan-only.md', '# plan v2');
        const boundChanged = mk(base.extension_sha256 && '## Instance extension inputs\n\n### Knowledge index\n\n- `doc/extensions/knowledge/spec-author.md`');
        assert.deepStrictEqual(diffVerifierMaterial(specChanged, boundChanged), ['doc/extensions/knowledge/plan-only.md']);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    // 金值 = 引入目标简报分量之前的 computeMaterialSha256 对同一输入的产出（改动前实跑取得）。
    name: '目标简报分量（plan 33784ed1 §3.4）：简报为空 → material_sha256 与改动前逐字节相同；有简报 → 换指纹且 diff 只标 goal_brief',
    run: () => {
      const root = mkProject();
      try {
        const GOLDEN_WITHOUT_BRIEF = '4c01c04e4e085143e62744c7293b577ecbe897a5e2fa7a959ecc83337820e54c';
        const mk = (goalBriefText?: string) => buildVerifierMaterialView({
          projectRoot: root, feature: FEATURE, phase: 'plan', gateFingerprint: '3.0.0:abcdef012345',
          phaseRuleText: 'rule: 1', templateText: '# template', checks: CHECKS, contextFiles: [],
          ...(goalBriefText === undefined ? {} : { goalBriefText }),
        } as Parameters<typeof buildVerifierMaterialView>[0]);
        const none = mk();
        const oldView = { ...none, schema: 'maison-verifier-material@1' };
        assert.strictEqual(computeMaterialSha256(oldView), GOLDEN_WITHOUT_BRIEF, 'old schema business material retains its original known fingerprint');
        assert(verifierMaterialsEquivalent({ ...oldView, material_sha256: GOLDEN_WITHOUT_BRIEF }, none, root), 'a pure representation migration retains valid historical review');
        assert.strictEqual(mk('').material_sha256, none.material_sha256, 'empty brief does not change the current material');
        const withBrief = mk('## 目标简报（goal brief）\n\n### 判定办法\n\n按目标裁决。');
        const briefSha = (withBrief as unknown as { goal_brief_sha256?: string }).goal_brief_sha256 ?? '';
        assert.strictEqual(briefSha.length, 64, '有简报时分量为 sha256');
        assert.notStrictEqual(withBrief.material_sha256, none.material_sha256, '简报进入材料指纹');
        assert.deepStrictEqual(diffVerifierMaterial(none, withBrief), ['goal_brief']);
        assert.notStrictEqual(mk('## 目标简报（goal brief）\n\n### 判定办法\n\n按目标裁决。\n- 新排除项').material_sha256,
          withBrief.material_sha256, '简报内容变 → 换指纹');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
];

export function runAll() {
  const results: UnitCaseResult[] = [];
  for (const c of cases) {
    const endUnitCase = beginUnitCase(c.name);
    if (!endUnitCase) continue;
    try {
      c.run();
      results.push({ name: c.name, ok: true });
    } catch (err) {
      results.push({ name: c.name, ok: false, error: (err as Error).stack ?? (err as Error).message });
    } finally {  endUnitCase(); }
  }
  return results;
}
