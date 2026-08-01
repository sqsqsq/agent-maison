import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
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

export function runAll(): Array<{ name: string; ok: boolean; error?: string }> {
  return cases.map((testCase) => { try { testCase.run(); return { name: testCase.name, ok: true }; } catch (error) { return { name: testCase.name, ok: false, error: (error as Error).message }; } });
}
