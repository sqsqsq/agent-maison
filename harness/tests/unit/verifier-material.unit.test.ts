// verifier-material.unit.test.ts — plan 07a41ec6 T7：审前材料视图（subject 寻址材料）与差异登记

import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as YAML from 'yaml';
import { createHash } from 'crypto';

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
} from '../../scripts/utils/verifier-material';
import { stableStringify } from '../../scripts/utils/phase-evidence-manifest';
import type { ContextFileEntry } from '../../scripts/utils/types';
import type { UnitCaseResult } from '../run-unit';
import { copyC6HostReplay } from '../utils/c6-host-replay';
import { SpecLoader } from '../../scripts/utils/spec-loader';
import { collectContextFiles, writeRunSummaryBase } from '../../harness-runner';
import { publishFixtureVerifierEvidence } from '../utils/verifier-evidence-fixture';
import { readCurrentDispositionInput } from '../../scripts/utils/verify-feature-completion';
import { resolveCurrentDisposition } from '../../scripts/utils/check-disposition';
import { resolveCapabilityResolutionEntryInput } from '../../scripts/utils/capability-resolution-entry-input';
import { resolveCapabilityInputs } from '../../scripts/utils/capability-resolution';
import type { ResolvedPhaseInputs } from '../../scripts/utils/capability-resolution';
import { designScopeRevisionChecks } from '../../scripts/utils/blueprint-skill-projection';
import type { CheckContext } from '../../scripts/utils/types';
import { readPhaseRepairIssues, verifierSemanticChecks } from '../../scripts/utils/repair-candidates';
import { finalizePhaseClosure } from '../../scripts/utils/phase-closure-finalizer';
import { computeGateFingerprint } from '../../scripts/utils/gate-fingerprint';
import { phaseCompletionProblems } from '../../scripts/utils/check-disposition';
import { createIndependentQuestioningResult, requiredQuestioningScopes, validateBlueprintQuestioning, independentQuestioningBlockers } from '../../scripts/utils/blueprint-questioning';
import { setupRunlessProject } from './execution-scope.unit.test';
import { ensureFeatureExecutionScopeFrozen } from '../../scripts/utils/feature-execution-scope';
import { loadResolvedProfile } from '../../profile-loader';
import { fixture as codingFixture } from './standalone-coding-review.unit.test';
import { computeManifestIdentityFields, diffManifestIdentityFields } from '../../scripts/utils/goal-manifest';
import { matchesUnitCase, selectedUnitCases, startCaseTiming, type UnitExecutionTiming } from '../utils/unit-case-selection';

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

const CHECKS = [
  { id: 'a', status: 'PASS', severity: 'MAJOR' },
  { id: 'b', status: 'WARN', severity: 'MINOR' },
];

function countAcceptanceCollections<T>(run: () => T): { result: T; count: number } {
  const material = require('../../scripts/utils/verifier-material') as typeof import('../../scripts/utils/verifier-material');
  const original = material.collectCurrentAcceptanceEvidence;
  let count = 0;
  material.collectCurrentAcceptanceEvidence = input => { count += 1; return original(input); };
  try { return { result: run(), count }; }
  finally { material.collectCurrentAcceptanceEvidence = original; }
}

const cases: Array<{ name: string; run: () => void }> = [
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
    name: 'P2 C Q uses the single machine envelope and stable IDs without frontier quota or loss of substantive denial',
    run: () => {
      const blueprint = { design_views: [], relations: [], review_summary: { authored_by: 'author' } } as Record<string, any>;
      const items = [...requiredQuestioningScopes(blueprint)].map(([ref, kind]) => ({ question: 'Is this scope sufficiently justified?', owner: 'design', scope_kind: kind,
        scope_ref: ref, disposition: 'not_applicable', verification_refs: ['request:original'], provenance: { source_kind: 'requirement', source_ref: 'request.md', observed_at: '2026-10-29', evidence_strength: 'authoritative', extraction_method: 'read' } }));
      const result = createIndependentQuestioningResult({ providerId: 'independent', authoredBy: 'author', items });
      blueprint.review_summary.questioning = result;
      assert.deepEqual(validateBlueprintQuestioning(blueprint), [], 'a legal independent answer remains valid');
      assert(!('frontier_budget' in result) && !('repeated_frontier_count' in result));
      assert.deepEqual((result.items as Record<string, unknown>[]).map(item => item.question_id),
        (createIndependentQuestioningResult({ providerId: 'independent', authoredBy: 'author', items }).items as Record<string, unknown>[]).map(item => item.question_id));
      assert.deepEqual((result.items as Record<string, unknown>[]).map(item => item.question_id),
        (createIndependentQuestioningResult({ providerId: 'independent', authoredBy: 'author', items: items.map(item => ({ ...item, question_id: 'self-selected-new-id' })) }).items as Record<string, unknown>[]).map(item => item.question_id));
      const previous = { ...result, items: (result.items as Record<string, unknown>[]).map((item, i) => ({ ...item, question_id: `legacy-${i}` })) };
      assert.equal((createIndependentQuestioningResult({ providerId: 'independent', authoredBy: 'author', items, previous }).items as Record<string, unknown>[])[0].question_id, 'legacy-0', 'known historical IDs remain stable');
      (result.items as Record<string, unknown>[])[0].disposition = 'blocker';
      (result.items as Record<string, unknown>[])[0].answer = 'Original acceptance is contradicted by the actual recovery path.';
      blueprint.review_summary.questioning = { ...result, frontier_budget: 0, repeated_frontier_count: 1000 };
      assert(!validateBlueprintQuestioning(blueprint).some(item => item.id === 'blueprint_questioning_frontier_budget_exceeded'));
      assert.equal(independentQuestioningBlockers(blueprint).length, 1, 'retiring execution counters cannot erase Q business denial');
      assert(validateBlueprintQuestioning(blueprint).some(item => item.id === 'blueprint_admission_false_pass'
        && item.path === '$.review_summary.questioning.items[0].disposition' && item.message.includes('actual recovery path')),
      'the sole Q validator must preserve the concrete negative answer for every canonical consumer');
      const { loadHostSnapshot } = require('../fixtures/host-snapshot-3.1.0/generate') as typeof import('../fixtures/host-snapshot-3.1.0/generate');
      const { loadCanonicalBlueprint } = require('../../scripts/utils/component-blueprint-path') as typeof import('../../scripts/utils/component-blueprint-path');
      const { checkCanonicalComponentBlueprint } = require('../../scripts/check-component-blueprint') as typeof import('../../scripts/check-component-blueprint');
      const { writeBackAdmission } = require('../../scripts/utils/design-repair-unattended') as typeof import('../../scripts/utils/design-repair-unattended');
      const host = loadHostSnapshot();
      try {
        const configFile = path.join(host.root, 'framework.config.json');
        const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
        config.project_profile = { name: 'hmos-app', sub_variant: 'app' };
        fs.writeFileSync(configFile, JSON.stringify(config)); clearFrameworkConfigCache();
        const canonical = loadCanonicalBlueprint(host.root, 'ledger-app-blueprint');
        const entry = (canonical.blueprint.review_summary as any).questioning.items.find((item: any) => item.scope_ref === 'view:logical');
        assert(entry, 'the real snapshot must carry the logical Q result');
        assert(!checkCanonicalComponentBlueprint(host.root, 'ledger-app-blueprint').issues.some(item => item.severity === 'BLOCKER'), 'the original legal canonical blueprint passes');
        entry.disposition = 'blocker'; entry.answer = 'The actual recovery path contradicts the original acceptance.';
        const admission = writeBackAdmission(canonical.blueprint, { projectRoot: host.root, canonicalPath: canonical.canonicalPath });
        assert.notEqual(admission.status, 'pass', 'machine admission cannot override a real independent denial');
        fs.writeFileSync(canonical.canonicalPath, YAML.stringify(canonical.blueprint));
        const denied = checkCanonicalComponentBlueprint(host.root, 'ledger-app-blueprint').issues;
        assert(denied.some(item => item.id === 'blueprint_admission_false_pass' && item.message.includes(entry.answer)), 'the public canonical checker receives the same actual Q denial');
      } finally { clearFrameworkConfigCache(); fs.rmSync(host.root, { recursive: true, force: true }); }
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
        assert.equal(build().material_sha256, before.material_sha256, 'machine envelopes cannot purchase another Q');
        assert(verifierMaterialFileMatchesCurrent({ projectRoot: root, feature: FEATURE, material: before, file: 'blueprint.yaml' }));
        assert(verifierMaterialsEquivalent(before, build(), root), 'already-normalized current evidence remains reusable across machine metadata writes');
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
    name: 'S2 shared entry and producer select current assertions and frozen proof, retain them after refutation and refresh real changes',
    run: () => {
      const f = copyC6HostReplay();
      const frameworkRoot = path.resolve(__dirname, '../../..');
      const reports = featurePhaseReportsDir(f.root, f.feature, 'plan', frameworkRoot);
      const options = { projectRoot: f.root, feature: f.feature, phase: 'plan', frameworkRoot };
      const current = () => resolveCurrentDisposition(readCurrentDispositionInput({ ...options, chain: ['plan'], runId: f.runId }));
      try {
        const beforeFiles = fs.readdirSync(reports).sort();
        const originalIssues = readPhaseRepairIssues(f.root, f.feature, 'plan', { frameworkRoot })!;
        assert(originalIssues.rows.some(row => row.id === 'acceptance_to_interface'));
        const evidence = collectCurrentAcceptanceEvidence(options);
        assert(evidence.some(file => file.label.endsWith('bank_open_card_ut.test.ets') && file.content.includes('expect(')), 'real assertions, beyond a test label');
        assert(evidence.some(file => file.label.endsWith('OtpService.ets') && file.content.includes('OtpVerificationState')));
        assert(evidence.some(file => file.label.endsWith('BankCardOpeningService.ets') && file.content.includes('tickOtp')));
        assert(evidence.some(file => file.label.endsWith('frozen.ut-result.WalletMain.json')));
        const nativeHost = require('../../../profiles/hmos-app/harness/ut-host-impl') as typeof import('../../../profiles/hmos-app/harness/ut-host-impl');
        const nativeFacts = nativeHost.currentUtExecutionInputs;
        try {
          nativeHost.currentUtExecutionInputs = undefined as unknown as typeof nativeFacts;
          const withoutNative = collectCurrentAcceptanceEvidence(options);
          assert(withoutNative.some(file => file.label.endsWith('bank_open_card_ut.test.ets'))
            && !withoutNative.some(file => file.label.endsWith('frozen.ut-result.WalletMain.json')),
            'without native qualification the verifier still reads assertions, but receives no validated frozen execution proof');
        } finally { nativeHost.currentUtExecutionInputs = nativeFacts; }
        assert(!evidence.some(file => /\/(?:summary|script-report|ac-coverage)\.json$/.test(file.label)), 'mutable latest reports are not plan materials');
        const countedEntry = countAcceptanceCollections(current);
        assert(countedEntry.result.completionBlocking.some(problem => problem.id === 'open_finding:acceptance_to_interface' && problem.action === 'verify'));
        assert.equal(countedEntry.count, 1, 'one read-only entry assembles current counterevidence once');
        assert.deepEqual(fs.readdirSync(reports).sort(), beforeFiles, 'read-only entry cannot issue requests');
        const loader = new SpecLoader(f.root, undefined, undefined, frameworkRoot);
        const entry = resolveCapabilityResolutionEntryInput({ ...options, featuresDir: relFeaturesDir(f.root), goalRunId: f.runId, goalAttemptId: 'i28' });
        const resolvedInputs = resolveCapabilityInputs({ ...options, track: 'full', ...entry }).inputs;
        assert(resolvedInputs, 'use the real CU/run-resolved producer input');
        const scopeContext = { ...options, featureSpec: loader.loadFeatureSpec(f.feature, resolvedInputs), resolvedInputs, factsContext: entry.factsContext } as CheckContext;
        const eventsFile = path.join(f.root, f.featureDir, 'goal-runs', f.runId, 'events.jsonl'), eventsBytes = fs.readFileSync(eventsFile);
        assert.deepEqual(designScopeRevisionChecks(scopeContext, []), [], 'moving an unchanged contracts binding cannot publish a new design fact or refresh birth code observations');
        const contractsFile = resolveFeatureArtifact(f.root, f.feature, 'contracts.yaml').actualPath, contractsBytes = fs.readFileSync(contractsFile);
        fs.appendFileSync(contractsFile, '\n# explanatory text only\n');
        const commentInputs = resolveCapabilityInputs({ ...options, track: 'full', ...entry }).inputs!;
        assert.deepEqual(designScopeRevisionChecks({ ...scopeContext, resolvedInputs: commentInputs,
          featureSpec: loader.loadFeatureSpec(f.feature, commentInputs) }, []), [], 'a comment cannot manufacture an empty design revision after valid descendant proofs are retained');
        fs.writeFileSync(contractsFile, contractsBytes);
        assert(fs.readFileSync(eventsFile).equals(eventsBytes), 'design-fact comparison cannot rewrite historical scope or events');
        const context = () => collectContextFiles(loader, { kind: 'consumer', projectRoot: f.root, frameworkRoot, frameworkRel: 'framework' }, 'plan', f.feature, loader.loadFeatureSpec(f.feature, resolvedInputs), { resolvedInputs, factsContext: entry.factsContext });
        const contexts = context();
        for (const file of evidence) assert(contexts.some(entry => entry.label === file.label), `real producer omitted ${file.label}`);
        const script = JSON.parse(fs.readFileSync(path.join(reports, 'script-report.json'), 'utf8'));
        const build = () => buildVerifierMaterialView({ ...options, resolvedInputs, factsContext: entry.factsContext, gateFingerprint: computeGateFingerprint(frameworkRoot, 'plan'), phaseRuleText: 'c6 material binding', templateText: 'current producer', checks: script.checks, contextFiles: context() });
        const view = build();
        const issued = writeRunSummaryBase(f.root, script, frameworkRoot, { verifierMaterial: view,
          verifierPlan: { mode: 'enabled', reason: 'policy_required', verifier_prompt: 'prompts/verify-plan.md', message: 'production material test' } });
        assert(issued.verifier_subject_id);
        publishFixtureVerifierEvidence({ projectRoot: f.root, reportsDir: reports, feature: f.feature, phase: 'plan', subjectId: issued.verifier_subject_id,
          reportText: '```issue-verification\n- issue: acceptance_to_interface\n  verdict: refuted\n  evidence: Current AC-3/BD-2 assertions drive OtpVerificationState through the production service.\n```', skipSummaryPatch: true });
        const countedWriter = countAcceptanceCollections(() => writeRunSummaryBase(f.root, script, frameworkRoot, { verifierMaterial: view,
          verifierPlan: { mode: 'enabled', reason: 'policy_required', verifier_prompt: 'prompts/verify-plan.md', message: 'production material test' } }));
        const reviewed = countedWriter.result;
        assert.equal(countedWriter.count, 1, 'subject validation and disposition reuse one read view when no revision is written');
        assert(!reviewed.repair_candidates?.length, 'the real producer consumes the independent refutation');
        assert.equal(build().material_sha256, view.material_sha256, 'closing the finding cannot remove its counterevidence');
        assert(!current().completionBlocking.some(problem => problem.id === 'open_finding:acceptance_to_interface'), 'current semantic/facts inputs cannot reopen an already reviewed counterevidence claim');
        const native = evidence.find(file => file.label.endsWith('/ut/execution-key.json'))!;
        const latest = path.join(path.dirname(path.dirname(path.dirname(path.join(f.root, native.label)))), '20991026T000000Z-000', 'ut');
        fs.mkdirSync(path.dirname(latest), { recursive: true }); fs.cpSync(path.dirname(path.join(f.root, native.label)), latest, { recursive: true });
        const keyFile = path.join(latest, 'execution-key.json');
        const key = JSON.parse(fs.readFileSync(keyFile, 'utf8')); key.run_started_at = '2099-10-26T00:00:00Z'; fs.writeFileSync(keyFile, JSON.stringify(key));
        assert.equal(build().material_sha256, view.material_sha256, 'routine same-key UT runs keep the original frozen anchor');
        for (const label of ['02-Feature/WalletMain/src/main/ets/domain/service/OtpService.ets', '02-Feature/WalletMain/src/ohosTest/ets/test/bank_open_card_ut.test.ets']) {
          const file = path.join(f.root, label), bytes = fs.readFileSync(file);
          fs.appendFileSync(file, '\n// changed executable input\n');
          try { assert.notEqual(build().material_sha256, view.material_sha256, label); }
          catch (error) { assert.match((error as Error).message, /input binding stale:/, 'changed bound inputs must refresh or fail their existing binding'); }
          assert(current().completionBlocking.some(problem => problem.id === 'open_finding:acceptance_to_interface' && problem.action === 'verify'), 'a refuted finding still requires fresh proof after real input changes');
          fs.writeFileSync(file, bytes);
        }
        const config = path.join(f.root, 'hvigor/hvigor-config.json5'), configBytes = fs.readFileSync(config);
        fs.appendFileSync(config, '\n// tool configuration changed\n');
        assert(collectCurrentAcceptanceEvidence(options).some(file => file.label.startsWith('(') && file.content.includes('配置')));
        const changedView = build();
        assert.notEqual(changedView.material_sha256, view.material_sha256);
        assert.equal(require('../../scripts/utils/repair-candidates').phaseIssuesForVerifierSubject(f.root, f.feature, 'plan', issued.verifier_subject_id, frameworkRoot), null, 'the old subject cannot certify changed execution conditions');
        const changed = writeRunSummaryBase(f.root, script, frameworkRoot, { verifierMaterial: changedView,
          verifierPlan: { mode: 'enabled', reason: 'policy_required', verifier_prompt: 'prompts/verify-plan.md', message: 'production changed inputs' } });
        assert.notEqual(changed.verifier_subject_id, issued.verifier_subject_id, 'invalidated evidence must issue a new real request');
        assert.equal(build().material_sha256, changedView.material_sha256, 'a pending request retains the historical anchor and current gap');
        assert(current().completionBlocking.some(problem => problem.id === 'open_finding:acceptance_to_interface' && problem.action === 'verify'), 'the changed-subject producer cannot erase the pending original verification');
        assert.equal(require('../../scripts/utils/repair-candidates').phaseIssuesForVerifierSubject(f.root, f.feature, 'plan', changed.verifier_subject_id, frameworkRoot), null);
        const refutedBody = '```issue-verification\n- issue: acceptance_to_interface\n  verdict: refuted\n  evidence: Original verifier assessed the current configuration gap and all bound materials; the old plan concern is not a remaining acceptance obligation.\n```';
        publishFixtureVerifierEvidence({ projectRoot: f.root, reportsDir: reports, feature: f.feature, phase: 'plan', subjectId: changed.verifier_subject_id,
          reportText: refutedBody, skipSummaryPatch: true });
        const close = () => finalizePhaseClosure({ ...options, phase: 'plan', resolvedInputs, factsContext: entry.factsContext,
          goalRunId: f.runId, persistPhaseState: () => undefined });
        assert.equal(close().summary.closure_status, 'closed', 'a real reply on the changed subject must close the original verification lifecycle');
        assert(!current().completionBlocking.some(problem => problem.id === 'open_finding:acceptance_to_interface'));
        fs.appendFileSync(config, '// another current configuration change\n');
        assert(current().completionBlocking.some(problem => problem.id === 'open_finding:acceptance_to_interface' && problem.action === 'verify'));
        const confirmedView = build();
        const confirmedRequest = writeRunSummaryBase(f.root, script, frameworkRoot, { verifierMaterial: confirmedView,
          verifierPlan: { mode: 'enabled', reason: 'policy_required', verifier_prompt: 'prompts/verify-plan.md', message: 'second changed configuration' } });
        const issueRow = originalIssues.rows.find(row => row.id === 'acceptance_to_interface')!;
        const finding = verifierSemanticChecks(originalIssues.reportText, 'plan', f.feature).find(row => row.id === issueRow.id)!;
        const confirmedBody = '```yaml\n' + YAML.stringify({ verification_result: { feature: f.feature, phase: 'plan', checks: [finding],
          summary: { pass: 0, fail: 1, blockers: 0, verdict: 'PASS' } } }) + '```\n```issue-verification\n- issue: ' + issueRow.id
          + '\n  verdict: confirmed\n  repair_owner: plan\n' + YAML.stringify({ evidence: 'plan.md contracts.yaml | ' + issueRow.summary }).split('\n').filter(Boolean).map(line => '  ' + line).join('\n') + '\n```';
        publishFixtureVerifierEvidence({ projectRoot: f.root, reportsDir: reports, feature: f.feature, phase: 'plan', subjectId: confirmedRequest.verifier_subject_id,
          reportText: confirmedBody, skipSummaryPatch: true });
        const confirmed = writeRunSummaryBase(f.root, script, frameworkRoot, { verifierMaterial: confirmedView,
          verifierPlan: { mode: 'enabled', reason: 'policy_required', verifier_prompt: 'prompts/verify-plan.md', message: 'current independent confirmation' } });
        assert(confirmed.repair_candidates?.some(candidate => candidate.id === issueRow.id));
        const ownerTasks = phaseCompletionProblems(current(), ['plan']);
        assert(ownerTasks.some(problem => problem.id === 'open_finding:' + issueRow.id && problem.action === 'repair' && problem.owner === 'plan'), 'persisted author dispatch must see the original verifier confirmation as owner repair');
        assert(!ownerTasks.every(problem => problem.action === 'verify'), 'the real runtime verifier-only predicate must yield to the current owner task');
        assert.equal(confirmed.next_action, 'fix_verifier_findings_then_rerun_harness');
        assert.throws(close, /open_finding:acceptance_to_interface/, 'confirmed required work cannot close before its author repairs it');
        // A bounded native-execution substitute publishes the existing frozen result under the actual new configuration key.
        const nativeApi = require('../../../profiles/hmos-app/harness/execution-key') as typeof import('../../../profiles/hmos-app/harness/execution-key');
        const newRun = path.join(path.dirname(path.dirname(latest)), '20991027T000000Z-000', 'ut');
        fs.mkdirSync(path.dirname(newRun), { recursive: true }); fs.cpSync(latest, newRun, { recursive: true });
        const newRecord = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
        const modules = newRecord.frozen_files.flatMap((name: string) => /^frozen\.ut-result\.(.+)\.json$/.exec(name)?.[1] ?? []);
        newRecord.inputs.tool_config_sha256 = nativeApi.sha256Text(modules.sort().map((module: string) => `${module}=${nativeHost.utBuildCollectorKey(f.root, module, 'default')}`).join('\n'));
        newRecord.execution_key = nativeApi.computeExecutionKey(newRecord.inputs); newRecord.run_started_at = '2099-10-27T00:00:00Z';
        nativeApi.writeExecutionKeyRecord(newRun, newRecord);
        const refreshed = collectCurrentAcceptanceEvidence(options);
        assert(refreshed.some(file => file.label === path.relative(f.root, path.join(newRun, 'execution-key.json')).replace(/\\/g, '/')), 'unusable prior anchors cannot hide a newly valid frozen execution');
        assert(!refreshed.some(file => file.label === native.label), 'the current selected native anchor must actually refresh');
        const refreshedView = build();
        const refreshedRequest = writeRunSummaryBase(f.root, script, frameworkRoot, { verifierMaterial: refreshedView,
          verifierPlan: { mode: 'enabled', reason: 'policy_required', verifier_prompt: 'prompts/verify-plan.md', message: 'current native evidence refresh' } });
        publishFixtureVerifierEvidence({ projectRoot: f.root, reportsDir: reports, feature: f.feature, phase: 'plan', subjectId: refreshedRequest.verifier_subject_id,
          reportText: refutedBody, skipSummaryPatch: true });
        assert.equal(close().summary.closure_status, 'closed');
        assert.equal(build().material_sha256, refreshedView.material_sha256, 'the refreshed anchor stays stable after the original verifier reply');
        assert(!current().completionBlocking.some(problem => problem.id === 'open_finding:acceptance_to_interface'));
        fs.writeFileSync(config, configBytes);
        writeRunSummaryBase(f.root, script, frameworkRoot, { verifierMaterial: view,
          verifierPlan: { mode: 'enabled', reason: 'policy_required', verifier_prompt: 'prompts/verify-plan.md', message: 'restore original test configuration' } });
        const frozen = path.join(f.root, evidence.find(file => file.label.endsWith('frozen.ut-result.WalletMain.json'))!.label);
        fs.appendFileSync(frozen, '\n');
        assert(collectCurrentAcceptanceEvidence(options).some(file => file.label.startsWith('(') && file.content.includes('字节变化')));
        assert(current().completionBlocking.some(problem => problem.action === 'verify'));
        const frozenView = build();
        const frozenRequest = writeRunSummaryBase(f.root, script, frameworkRoot, { verifierMaterial: frozenView,
          verifierPlan: { mode: 'enabled', reason: 'policy_required', verifier_prompt: 'prompts/verify-plan.md', message: 'changed frozen native bytes' } });
        assert.equal(build().material_sha256, frozenView.material_sha256, 'issuing a request cannot discard the configuration inputs selected for its frozen-evidence diagnosis');
        publishFixtureVerifierEvidence({ projectRoot: f.root, reportsDir: reports, feature: f.feature, phase: 'plan', subjectId: frozenRequest.verifier_subject_id,
          reportText: refutedBody, skipSummaryPatch: true });
        assert.equal(close().summary.closure_status, 'closed');
        assert(!current().completionBlocking.some(problem => problem.id === 'open_finding:acceptance_to_interface'));
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

export function runSelectedCases(filter?: string) {
  const results: UnitCaseResult[] = [];
  const timings: UnitExecutionTiming[] = [];
  for (const c of cases.filter(test => matchesUnitCase(test.name, filter))) {
    const finish = startCaseTiming([c.name], timings);
    try {
      c.run();
      results.push({ name: c.name, ok: true });
    } catch (err) {
      results.push({ name: c.name, ok: false, error: (err as Error).stack ?? (err as Error).message });
    } finally { finish(); }
  }
  return selectedUnitCases(results, filter, timings);
}

export function runAll(): UnitCaseResult[] { return runSelectedCases().results; }
