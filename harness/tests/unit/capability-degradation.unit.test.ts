import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as YAML from 'yaml';
import { resolveCapabilityInputs, type PhaseInputContext } from '../../scripts/utils/capability-resolution';
import { collectContextFiles } from '../../harness-runner';
import { buildVerifierMaterialView } from '../../scripts/utils/verifier-material';
import { SpecLoader } from '../../scripts/utils/spec-loader';
import { checkConventionsCoverage } from '../../scripts/check-review';
import { loadFeatureContracts, loadArtifactInventory } from '../../scripts/utils/skill-contract';
import { validateContractConsistency } from '../../scripts/check-contract-consistency';
import { loadWorkflowSpec } from '../../workflow-loader';
import { resolvePhaseEvidenceManifest, phaseEvidenceManifestCandidatePaths, stableStringify } from '../../scripts/utils/phase-evidence-manifest';
import {
  assertCapabilityConsumption,
  capabilityResolutionChecks,
  resolveCapabilityReport,
  type CapabilityResolutionReport,
} from '../../scripts/utils/capability-resolution';
import { clearFrameworkConfigCache, loadFrameworkConfig } from '../../config';
import { loadResolvedProfile } from '../../profile-loader';
import { __testing_checkDeviceTestRunGateBeforeInstall } from '../../scripts/check-testing';
import type { CheckContext, CheckResult } from '../../scripts/utils/types';
import { buildGoalManifestFromInput, writeGoalManifest } from '../../scripts/utils/goal-manifest';
import { resolveCapabilityResolutionEntryInput } from '../../scripts/utils/capability-resolution-entry-input';
import { applyCapabilityResolutionProjection, deriveSummaryVerdictLattice } from '../../scripts/utils/quality-axes';
import { normalizeDeviceTestCases } from '../../scripts/utils/device-test-case-kernel';

const FRAMEWORK_ROOT = path.resolve(__dirname, '..', '..', '..');
function assert(condition: unknown, message: string): void { if (!condition) throw new Error(message); }
function expectThrow(fn: () => void, text: string): void { let actual = ''; try { fn(); } catch (error) { actual = (error as Error).message; } assert(actual.includes(text), `expected ${text}, got ${actual}`); }
function write(root: string, rel: string, text = 'fixture\n'): void { const file = path.join(root, rel); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text, 'utf8'); }
function project(run: (root: string) => void): void { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capability-degradation-')); try { fs.mkdirSync(path.join(root, 'doc', 'features'), { recursive: true }); run(root); } finally { fs.rmSync(root, { recursive: true, force: true }); } }
interface TestCase { name: string; run: () => void }

const fallbackAndInvalidCases: TestCase[] = [
  {
    name: 'ordered derive fallback retains absent artifact attempt and normalizes adhoc cases with the shared kernel',
    run: () => project((root) => {
      const adhocCases = 'open home -> tap login';
      const report = resolveCapabilityReport({ frameworkRoot: FRAMEWORK_ROOT, projectRoot: root, feature: 'demo', phase: 'testing', track: 'full', adhocCases });
      const cases = report.capabilities.find((capability) => capability.id === 'capability_testing_cases')!;
      const input = cases.inputs.find((candidate) => candidate.id === 'cases')!;
      const normalized = normalizeDeviceTestCases({ mode: 'adhoc', natural_language: adhocCases });
      const fingerprint = crypto.createHash('sha256').update(JSON.stringify(normalized.cases), 'utf8').digest('hex').slice(0, 16);
      assert(cases.state === 'resolved', cases.state);
      assert(input.selected_source === 'derive.adhoc-cases', input.selected_source ?? 'null');
      assert(input.attempts.length === 2 && input.attempts[0].state === 'absent' && input.attempts[1].state === 'resolved', JSON.stringify(input.attempts));
      assert(input.attempts[1].detail === `adhoc_cases:${fingerprint}`, JSON.stringify(input.attempts[1]));
    }),
  },
  {
    name: 'degenerate explicit adhoc input remains absent and cannot lift a core capability',
    run: () => project((root) => {
      for (const adhocCases of ['give the card page a bank filter', '->;→']) {
        const report = resolveCapabilityReport({
          frameworkRoot: FRAMEWORK_ROOT,
          projectRoot: root,
          feature: 'demo',
          phase: 'testing',
          track: 'full',
          adhocCases,
        });
        const casesCapability = report.capabilities.find((capability) => capability.id === 'capability_testing_cases')!;
        const casesInput = casesCapability.inputs.find((input) => input.id === 'cases')!;
        assert(casesInput.state === 'absent', JSON.stringify(casesInput));
        assert(casesInput.attempts[1]?.state === 'absent', JSON.stringify(casesInput.attempts));
        assert(casesCapability.state === 'blocked' && report.assurance === 'blocked', JSON.stringify(report));
      }
    }),
  },
  {
    name: 'invalid authoritative artifact terminates resolution and blocks capability without fallback',
    run: () => project((root) => {
      fs.mkdirSync(path.join(root, 'doc', 'features', 'demo', 'acceptance.yaml'), { recursive: true });
      const report = resolveCapabilityReport({ frameworkRoot: FRAMEWORK_ROOT, projectRoot: root, feature: 'demo', phase: 'ut', track: 'full' });
      const core = report.capabilities.find((capability) => capability.id === 'capability_ut_core_context')!;
      const acceptance = core.inputs.find((input) => input.id === 'acceptance')!;
      assert(core.state === 'blocked', core.state);
      assert(acceptance.state === 'invalid' && acceptance.attempts.length === 1, JSON.stringify(acceptance));
    }),
  },
];
const cases: TestCase[] = [...fallbackAndInvalidCases,
  {
    name: 'missing core artifact blocks, records absent high-priority attempt, and cannot satisfy a floor',
    run: () => project((root) => {
      const report = resolveCapabilityReport({ frameworkRoot: FRAMEWORK_ROOT, projectRoot: root, feature: 'demo', phase: 'ut', track: 'full' });
      assert(report.assurance === 'blocked', `assurance=${report.assurance}`);
      const core = report.capabilities.find((capability) => capability.id === 'capability_ut_core_context')!;
      assert(core.state === 'blocked', core.state);
      const acceptance = core.inputs.find((input) => input.id === 'acceptance')!;
      assert(acceptance.state === 'absent', acceptance.state);
      assert(acceptance.attempts[0].dependencies.some((entry) => !entry.exists), 'missing artifact path must be fingerprinted');
      assert(acceptance.attempts[0].upstream_producer === 'spec', JSON.stringify(acceptance.attempts[0]));
    }),
  },
  {
    name: 'all resolved capability inputs mechanically project full and obey strict consumption bijection',
    run: () => project((root) => {
      write(root, 'doc/features/demo/acceptance.yaml');
      write(root, 'doc/features/demo/plan/plan.md');
      write(root, 'doc/features/demo/contracts.yaml');
      write(root, 'doc/features/demo/use-cases.yaml');
      write(root, 'doc/module-catalog.yaml');
      const report = resolveCapabilityReport({ frameworkRoot: FRAMEWORK_ROOT, projectRoot: root, feature: 'demo', phase: 'ut', track: 'full' });
      assert(report.assurance === 'full', `assurance=${report.assurance}`);
      const checks = capabilityResolutionChecks(report);
      assertCapabilityConsumption(report, checks);
      expectThrow(() => assertCapabilityConsumption(report, checks.slice(1)), 'expected CheckResult=1');
      expectThrow(() => assertCapabilityConsumption(report, [...checks, checks[0]]), 'actual=2');      const nonResolved: CapabilityResolutionReport = {
        ...report,
        capabilities: [{ ...report.capabilities[0], state: 'pruned', on_missing: 'prune' }],
        assurance: 'degraded',
      };
      assert(capabilityResolutionChecks(nonResolved).length === 0, 'pruned capability must not emit CheckResult');
      expectThrow(() => assertCapabilityConsumption(nonResolved, [{ ...checks[0], id: nonResolved.capabilities[0].id }]), 'expected CheckResult=0');
    }),
  },
  {
    name: 'goal requirement derives without binding the change.md fallback candidate',
    run: () => project((root) => {
      const report = resolveCapabilityReport({
        frameworkRoot: FRAMEWORK_ROOT,
        projectRoot: root,
        feature: 'demo',
        phase: 'spec',
        track: 'full',
        requirement: 'design an account page',
      });
      const requirement = report.capabilities
        .find((capability) => capability.id === 'capability_spec_requirement')
        ?.inputs.find((input) => input.id === 'requirement');
      assert(requirement?.selected_source === 'derive.requirement', JSON.stringify(requirement));
      assert(requirement?.attempts[0]?.dependencies.length === 0, JSON.stringify(requirement));
    }),
  },  {
    name: 'goal manifest requirement reaches derive requirement without becoming testing adhoc input',
    run: () => project((root) => {
      const manifest = buildGoalManifestFromInput({
        feature: 'demo',
        requirement: 'open home -> tap login',
        unattended: { write_mode: 'workspace-write', approval_mode: 'never' },
      }, { projectRoot: root, runId: 'run-capability-input' });
      writeGoalManifest(manifest, root);
      const input = resolveCapabilityResolutionEntryInput({
        projectRoot: root,
        feature: 'demo',
        phase: 'testing',
        featuresDir: 'doc/features',
        goalRunId: manifest.run_id,
      });
      assert(input.requirement === manifest.requirement, JSON.stringify(input));
      assert(input.adhocCases === undefined, JSON.stringify(input));
      const report = resolveCapabilityReport({
        frameworkRoot: FRAMEWORK_ROOT,
        projectRoot: root,
        feature: 'demo',
        phase: 'testing',
        track: 'full',
        requirement: input.requirement,
      });
      const testingCases = report.capabilities.find((capability) => capability.id === 'capability_testing_cases')!;
      assert(testingCases.state === 'blocked' && report.assurance === 'blocked', JSON.stringify(report));
    }),
  },  {
    name: 'testing static derived-plan failure is not hidden by install SKIP',
    run: () => project((root) => {
      write(root, 'framework.config.json', JSON.stringify({
        schema_version: '1.1',
        project_name: 'capability-test',
        project_profile: { name: 'hmos-app', sub_variant: 'app' },
        agent_adapter: 'generic',
        architecture: {
          outer_layers: [{ id: 'app', can_depend_on: [], intra_layer_deps: 'forbid' }],
          module_inner_layers: ['content'],
          inner_dependency_direction: 'upward',
          cross_module_exports_file: 'index.ts',
        },
        paths: {
          features_dir: 'doc/features',
          reports_dir_pattern: 'doc/features/<feature>/<phase>/reports',
        },
      }),
      );
      clearFrameworkConfigCache();
      const config = loadFrameworkConfig(root);
      const ctx = {
        phase: 'testing',
        feature: 'demo',
        projectRoot: root,
        frameworkRoot: FRAMEWORK_ROOT,
        frameworkRel: '',
        harnessRoot: path.join(FRAMEWORK_ROOT, 'harness'),
        layoutKind: 'standalone',
        phaseRule: { phase: 'testing', structure_checks: {}, semantic_checks: {}, traceability_checks: {} },
        featureSpec: {},
        resolvedProfile: loadResolvedProfile(root, config),
      } as CheckContext;
      const checks = __testing_checkDeviceTestRunGateBeforeInstall(ctx);
      assert(
        checks[0]?.status === 'FAIL' && checks[0]?.details?.includes('Hylyre'),
        JSON.stringify(checks),
      );
    }),
  },  {
    name: 'explicit non-UI applicability skips all visual inputs before source resolution',
    run: () => project((root) => {
      write(root, 'doc/features/demo/spec/spec.md', 'ui_change: false\n');
      const report = resolveCapabilityReport({ frameworkRoot: FRAMEWORK_ROOT, projectRoot: root, feature: 'demo', phase: 'plan', track: 'full' });
      const visual = report.capabilities.find((capability) => capability.id === 'capability_plan_visual_context')!;
      assert(visual.state === 'not_applicable' && visual.inputs.length === 0, JSON.stringify(visual));
    }),
  },
  {
    name: 'pruned leaves quality axes and completion projections unchanged while blocked remains non-closable',
    run: () => project((root) => {
      const base = resolveCapabilityReport({ frameworkRoot: FRAMEWORK_ROOT, projectRoot: root, feature: 'demo', phase: 'ut', track: 'full' });
      const checks: CheckResult[] = [{ id: 'ut_dag_exists', category: 'structure', description: 'd', severity: 'BLOCKER', status: 'PASS', details: '' }];
      const opts = { phase: 'ut', visualApplicable: false, assetApplicable: false } as const;
      const direct = deriveSummaryVerdictLattice(checks, opts);
      for (const axis of ['functional', 'evidence', 'visual', 'asset'] as const) {
        const pruned: CapabilityResolutionReport = {
          ...base,
          capabilities: [{ ...base.capabilities[0], id: `capability_pruned_${axis}`, axis, active: true, state: 'pruned', on_missing: 'prune', inputs: [] }],
          assurance: 'degraded',
        };
        const lattice = deriveSummaryVerdictLattice(checks, opts, pruned);
        assert(lattice.projected_verdict === direct.projected_verdict, `${axis}: projected=${lattice.projected_verdict}`);
        assert(lattice.release_readiness === direct.release_readiness, `${axis}: release=${lattice.release_readiness}`);
        assert(lattice.completion_status === direct.completion_status, `${axis}: completion=${lattice.completion_status}`);
        assert(JSON.stringify(lattice.quality_axes) === JSON.stringify(direct.quality_axes), `${axis}: axes changed`);
      }
      const blocked: CapabilityResolutionReport = {
        ...base,
        capabilities: [{ ...base.capabilities[0], id: 'capability_blocked_visual', axis: 'visual', active: true, state: 'blocked', on_missing: 'fail', inputs: [] }],
        assurance: 'blocked',
      };
      const lattice = deriveSummaryVerdictLattice(checks, opts, blocked);
      assert(lattice.projected_verdict === 'INCOMPLETE', lattice.projected_verdict);
      assert(lattice.release_readiness === 'BLOCKED', lattice.release_readiness);
      const directAxes = deriveSummaryVerdictLattice(checks, opts);
      applyCapabilityResolutionProjection(directAxes.quality_axes, blocked, 'ut');
      assert(directAxes.quality_axes.visual.resolution?.owner === 'agent', 'blocked must route agent');
    }),
  },
];


function modernFixture(root: string, artifact = 'contracts@1', policy = 'fail'): { framework: string; context: PhaseInputContext; resolve: (context?: PhaseInputContext) => ReturnType<typeof resolveCapabilityInputs> } {
  const framework = path.join(root, 'maison');
  for (const relative of ['skills/feature', 'workflows', 'specs/artifact-schemas']) {
    fs.cpSync(path.join(FRAMEWORK_ROOT, relative), path.join(framework, relative), { recursive: true });
  }
  write(root, 'framework.config.json', JSON.stringify({ paths: { features_dir: 'doc/features' }, project_profile: { name: 'generic' } }));
  write(framework, 'skills/feature/code-review/contract.yaml', YAML.stringify({
    schema_version: '1.1', skill: 'code-review', skill_doc: 'SKILL.md', phases: { review: {
      inputs: [{ id: 'payload', sources: [{ kind: 'artifact', artifact }] }],
      capabilities: [{ id: 'capability_review_payload', axis: 'functional', inputs: ['payload'], obligation_kinds: ['review-context'], on_missing: policy }],
      produces: [{ artifact: 'review-report@1' }], verifies: { check: 'check-review.ts' },
    } },
  }));
  const context: PhaseInputContext = { schema_version: '1.1', subject: { feature: 'demo' }, obligations: { 'review-context': 'required' }, required_outputs: [] };
  return { framework, context, resolve: (inputContext = context) => resolveCapabilityInputs({ frameworkRoot: framework, projectRoot: root, feature: 'demo', phase: 'review', track: 'full', inputContext }) };
}

cases.push(
  {
    name: 'composable inputs: registered alternate artifact content reaches existing checker without a second read',
    run: () => project(root => {
      const fixture = modernFixture(root);
      const inventoryFile = path.join(fixture.framework, 'specs/artifact-schemas/inventory.yaml');
      const inventory = YAML.parse(fs.readFileSync(inventoryFile, 'utf8'));
      inventory.artifacts.find((a: { id: string }) => a.id === 'contracts@1').paths = ['missing-contracts.yaml', 'supplied-contracts.yaml', 'unused-contracts.yaml'];
      fs.writeFileSync(inventoryFile, YAML.stringify(inventory));
      write(root, 'doc/features/demo/supplied-contracts.yaml', YAML.stringify({ files: ['src/a.ets'], conventions_applied: [{ id: 'must-review', planned_locations: ['src/a.ets'] }] }));
      const resolution = fixture.resolve();
      assert(resolution.report.assurance === 'full', JSON.stringify(resolution.report));
      const value = resolution.inputs!.values.payload;
      assert(value.state === 'resolved', 'payload unresolved');
      if (value.state !== 'resolved') return;
      assert(value.binding.dependencies.some(dep => dep.path.endsWith('missing-contracts.yaml') && !dep.exists), 'missing preferred source not bound');
      assert(!value.binding.dependencies.some(dep => dep.path.endsWith('unused-contracts.yaml')), 'unused source was read');
      assert(value.binding.content_fingerprint === crypto.createHash('sha256').update(stableStringify(value.value)).digest('hex'), 'content binding mismatch');
      const loader = new SpecLoader(root, undefined, undefined, FRAMEWORK_ROOT);
      const featureSpec = loader.loadFeatureSpec('demo', resolution.inputs);
      const ctx = { projectRoot: root, feature: 'demo', phaseRule: {}, featureSpec } as CheckContext;
      const checks = checkConventionsCoverage(ctx, '');
      assert(checks.some(c => c.status === 'FAIL' && c.details?.includes('conventions_applied 非空')), JSON.stringify(checks));
      write(root, 'doc/features/demo/missing-contracts.yaml', 'files: []');
      assert(fixture.resolve({ ...fixture.context, expected_bindings: [value.binding] }).report.assurance === 'blocked', 'new preferred source did not invalidate binding');
      fs.unlinkSync(path.join(root, 'doc/features/demo/supplied-contracts.yaml'));
      assert(loader.loadFeatureSpec('demo', resolution.inputs).contracts?.conventions_applied?.length === 1, 'checker input reopened physical file');
      const prompt = collectContextFiles(loader, { kind: 'standalone', projectRoot: root, frameworkRoot: FRAMEWORK_ROOT, frameworkRel: '' }, 'review', 'demo', featureSpec, { resolvedInputs: resolution.inputs });
      assert(prompt.some(entry => entry.content.includes('must-review')), 'verifier did not consume resolved content');
      assert(loader.inspectFeatureArtifacts('demo', 'coding', resolution.inputs).missingRequiredFiles.length === 0, 'legacy fixed files still required');
      assert(!fs.existsSync(path.join(root, 'doc/features/demo/spec')), 'invented spec stage');
    }),
  },
  {
    name: 'composable inputs: invalid content stops fallback and required obligation cannot prune',
    run: () => project(root => {
      const fixture = modernFixture(root, 'acceptance@1', 'prune');
      assert(fixture.resolve().report.assurance === 'blocked', 'required missing input was pruned');
      write(root, 'doc/features/demo/acceptance.yaml', 'criteria: not-an-array');
      const result = fixture.resolve();
      assert(result.inputs!.values.payload.state === 'invalid', JSON.stringify(result));
      assert(result.report.assurance === 'blocked', 'invalid was pruned');
      const inactive = fixture.resolve({ ...fixture.context, obligations: { 'review-context': 'not_applicable' } });
      assert(inactive.report.capabilities[0].inputs.length === 0, 'N/A read sources');
      const unknown = fixture.resolve({ ...fixture.context, obligations: {} });
      assert(unknown.report.assurance === 'blocked', 'unknown became N/A');
    }),
  },
  {
    name: 'composable inputs: explicit invalidation and stale scope binding reject older valid content',
    run: () => project(root => {
      const fixture = modernFixture(root, 'acceptance@1');
      write(root, 'doc/features/demo/acceptance.yaml', 'criteria: []');
      const first = fixture.resolve();
      const binding = first.report.capabilities[0].inputs[0].binding!;
      const stale = fixture.resolve({ ...fixture.context, expected_bindings: [{ ...binding, content_fingerprint: '0'.repeat(64) }] });
      assert(stale.report.assurance === 'blocked', 'stale binding accepted');
      const invalidated = fixture.resolve({ ...fixture.context, invalidated_sources: { 'acceptance@1': 'new authorized behavior supersedes old acceptance' } });
      assert(invalidated.report.assurance === 'blocked', 'new decision ignored');
      assert(Object.isFrozen(first.report.capabilities[0].inputs), 'report not immutable');
      assert(!JSON.stringify(first.report).includes('"value"'), 'report duplicated content');
    }),
  },
  {
    name: 'composable inputs: static producer registration is separate from ancestry and every fallback is typed',
    run: () => project(root => {
      const fixture = modernFixture(root);
      const contracts = loadFeatureContracts(fixture.framework);
      const workflow = loadWorkflowSpec(fixture.framework, 'spec-driven');
      workflow.artifacts.find(a => a.id === 'review')!.requires = [];
      const ids = new Set(loadArtifactInventory(fixture.framework).artifacts.map(a => a.id));
      let issues = validateContractConsistency(fixture.framework, workflow, contracts, ids);
      assert(!issues.some(i => i.message.startsWith('review')), JSON.stringify(issues));
      contracts.find(c => c.skill === 'code-review')!.phases.review.inputs[0].sources.push({ kind: 'derive', provider_id: 'derive.requirement' });
      issues = validateContractConsistency(fixture.framework, workflow, contracts, ids);
      assert(issues.some(i => i.message.includes('source content types differ')), 'incompatible fallback passed');
    }),
  },
  {
    name: 'composable inputs: evidence and candidate surface use actual attempted inputs and detect drift',
    run: () => project(root => {
      const fixture = modernFixture(root, 'acceptance@1');
      write(root, 'doc/features/demo/acceptance.yaml', 'criteria: []');
      const { inputs } = fixture.resolve();
      const opts = { projectRoot: root, frameworkRoot: fixture.framework, feature: 'demo', phase: 'review' as const, resolvedInputs: inputs };
      const manifest = resolvePhaseEvidenceManifest(opts);
      const material = buildVerifierMaterialView({ ...opts, gateFingerprint: null, phaseRuleText: '', templateText: '', checks: [], contextFiles: [] });
      assert(!!material.input_bindings_sha256, 'verifier material omitted content bindings');
      assert(manifest.inputs.some(e => e.path.endsWith('acceptance.yaml')), 'input not bound');
      assert(!manifest.inputs.some(e => e.path.endsWith('plan.md')), 'legacy input invented');
      assert(!phaseEvidenceManifestCandidatePaths(opts).has('doc/features/demo/plan/plan.md'), 'legacy candidate invented');
      write(root, 'doc/features/demo/acceptance.yaml', 'criteria: [{id: AC-1}]');
      expectThrow(() => resolvePhaseEvidenceManifest(opts), 'input binding stale');
    }),
  },
);


cases.push({
  name: 'composable inputs: request target derivation is bounded and never touches a Feature path',
  run: () => project(root => {
    const fixture = modernFixture(root);
    const file = path.join(fixture.framework, 'skills/feature/code-review/contract.yaml');
    const contract = YAML.parse(fs.readFileSync(file, 'utf8'));
    contract.phases.review.inputs[0].sources = [{ kind: 'derive', provider_id: 'derive.test-targets' }];
    fs.writeFileSync(file, YAML.stringify(contract));
    write(root, 'src/target.ts', 'export const expected = 1;');
    const context: PhaseInputContext = { ...fixture.context, subject: { request_sha256: 'a'.repeat(64) } };
    expectThrow(() => resolveCapabilityResolutionEntryInput({ projectRoot: root, feature: '', phase: 'review', featuresDir: 'doc/features', invocation: { inputContext: context, factsContext: { subject: { request_sha256: 'a'.repeat(64), report_dir: 'reports/request' }, first_phase: 'review', source_paths: [], required_input_snippets: [] }, testTargets: ['src/target.ts'] } }), 'facts do not cover explicit request targets');
    const options = { frameworkRoot: fixture.framework, projectRoot: root, feature: '', phase: 'review', track: 'full' as const, inputContext: context, testTargets: ['src/target.ts'] };
    const resolution = resolveCapabilityInputs(options);
    assert(resolution.report.assurance === 'full', JSON.stringify(resolution.report));
    const value = resolution.inputs!.values.payload;
    assert(value.state === 'resolved' && JSON.stringify(value.value).includes('expected = 1'), 'target content absent');
    assert(resolveCapabilityInputs({ ...options, testTargets: ['../outside'] }).report.assurance === 'blocked', 'target escaped project');
    assert(resolveCapabilityInputs({ ...options, testTargets: ['missing.ts'] }).report.assurance === 'blocked', 'missing target broadened to repository');
    assert(resolveCapabilityInputs({ ...options, testTargets: ['missing.ts', '../outside'] }).inputs!.values.payload.state === 'invalid', 'absent target masked invalid later target');
    expectThrow(() => resolvePhaseEvidenceManifest({ projectRoot: root, frameworkRoot: fixture.framework, feature: '', phase: 'review', resolvedInputs: resolution.inputs }), 'Feature evidence requires');
  }),
});

export function runAll(): Array<{ name: string; ok: boolean; error?: string }> {
  return cases.map((testCase) => { try { testCase.run(); return { name: testCase.name, ok: true }; } catch (error) { return { name: testCase.name, ok: false, error: (error as Error).message }; } });
}
