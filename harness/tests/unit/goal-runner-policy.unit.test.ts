// goal-runner-policy.unit.test.ts — resolveAutoChain, classifyPhaseVerdict, goal manifest, adapter preflight

import * as fs from 'fs';
import * as path from 'path';
import {
  classifyPhaseVerdict,
  resolveAutoChain,
  resolveGoalRunStatus,
  formatDeferredUpstreamNotice,
  DEFAULT_DEPENDENCY_POLICY,
} from '../../scripts/utils/phase-transition-policy';
import { loadWorkflowSpec } from '../../workflow-loader';
import {
  buildGoalManifestFromInput,
  loadGoalManifestFile,
  loadGoalManifestFromRun,
  resolveGoalReportDir,
  validateUnattendedContract,
} from '../../scripts/utils/goal-manifest';
import {
  generateGoalReportJson,
  generateGoalReportMarkdown,
} from '../../scripts/utils/goal-report-generator';
import {
  loadGoalCapability,
  validateGoalCapabilityForRunner,
} from '../../scripts/utils/goal-adapter-capability';
import {
  renderInvokeTemplate,
  defaultHeadlessInvoke,
  defaultHeadlessInvokePlan,
} from '../../scripts/utils/agent-invoke';
import type { UnitCaseResult } from '../run-unit';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const FRAMEWORK_ROOT = REPO_ROOT;

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const workflow = loadWorkflowSpec(FRAMEWORK_ROOT, 'spec-driven');

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'resolveAutoChain: prd→testing default',
    run: () => {
      const chain = resolveAutoChain(workflow, 'spec', 'testing');
      assert(chain[0] === 'spec', 'starts prd');
      assert(chain[chain.length - 1] === 'testing', 'ends testing');
      assert(chain.includes('ut'), 'includes ut');
    },
  },
  {
    name: 'resolveAutoChain: design→ut mid-range',
    run: () => {
      const chain = resolveAutoChain(workflow, 'plan', 'ut');
      assert(!chain.includes('spec'), 'excludes prd');
      assert(chain.includes('coding'), 'includes coding');
      assert(chain[chain.length - 1] === 'ut', 'ends ut');
    },
  },
  {
    name: 'classifyPhaseVerdict: PASS → advance',
    run: () => {
      assert(classifyPhaseVerdict({ verdict: 'PASS' }) === 'advance', 'advance');
    },
  },
  {
    name: 'classifyPhaseVerdict: INCOMPLETE device_blocked → defer',
    run: () => {
      const a = classifyPhaseVerdict({
        verdict: 'INCOMPLETE',
        failure_kind: 'device_blocked',
        dependency_policy: DEFAULT_DEPENDENCY_POLICY,
      });
      assert(a === 'defer_external_and_continue_if_allowed', a);
    },
  },
  {
    name: 'classifyPhaseVerdict: FAIL retries → retry then halt',
    run: () => {
      assert(classifyPhaseVerdict({ verdict: 'FAIL', retries_used: 0 }) === 'retry', 'retry');
      assert(classifyPhaseVerdict({ verdict: 'FAIL', retries_used: 2, max_retries_per_phase: 2 }) === 'halt', 'halt');
    },
  },
  {
    name: 'resolveGoalRunStatus: DEFERRED forbids COMPLETED',
    run: () => {
      const s = resolveGoalRunStatus(
        [{ phase: 'ut', deferred: true }, { phase: 'testing', deferred: false }],
        true,
      );
      assert(s === 'DEFERRED', s);
    },
  },
  {
    name: 'resolveGoalRunStatus: all pass → COMPLETED',
    run: () => {
      const s = resolveGoalRunStatus(
        [{ phase: 'spec' }, { phase: 'plan' }],
        true,
      );
      assert(s === 'COMPLETED', s);
    },
  },
  {
    name: 'formatDeferredUpstreamNotice: non-empty',
    run: () => {
      const t = formatDeferredUpstreamNotice([{ phase: 'ut', reason: 'device_blocked' }]);
      assert(t.includes('DEFERRED'), t);
      assert(t.includes('ut'), t);
    },
  },
  {
    name: 'validateUnattendedContract: rejects missing',
    run: () => {
      const issues = validateUnattendedContract(undefined);
      assert(issues.length > 0, 'issues');
    },
  },
  {
    name: 'loadGoalCapability: claude present',
    run: () => {
      const gc = loadGoalCapability(FRAMEWORK_ROOT, 'claude');
      assert(gc.present, 'present');
      assert(gc.valid, gc.issues.join(';'));
      assert(gc.capability?.mode === 'native_goal', 'native_goal');
    },
  },
  {
    name: 'validateGoalCapabilityForRunner: claude ok',
    run: () => {
      const v = validateGoalCapabilityForRunner(FRAMEWORK_ROOT, 'claude', {
        write_mode: 'workspace-write',
        approval_mode: 'never',
      });
      assert(v.ok, v.issues.join(';'));
    },
  },
  {
    name: 'validateGoalCapabilityForRunner: missing adapter fails',
    run: () => {
      const v = validateGoalCapabilityForRunner(FRAMEWORK_ROOT, 'nonexistent-adapter-xyz');
      assert(!v.ok, 'should fail');
    },
  },
  {
    name: 'agent-invoke: render template vars',
    run: () => {
      const cmd = renderInvokeTemplate('echo {{FEATURE}} {{PHASE}}', {
        PROMPT_FILE: '/tmp/p',
        PROMPT: 'prompt body',
        SKILL_PATH: '/tmp/s',
        PROJECT_ROOT: '/proj',
        FRAMEWORK_ROOT: '/fw',
        FEATURE: 'demo',
        PHASE: 'spec',
      });
      assert(cmd.includes('demo'), cmd);
      assert(cmd.includes('spec'), cmd);
    },
  },
  {
    name: 'defaultHeadlessInvoke: codex uses workspace-write',
    run: () => {
      const plan = defaultHeadlessInvokePlan('codex', {
        write_mode: 'workspace-write',
        approval_mode: 'never',
      }, 'p');
      assert(plan.argv.includes('workspace-write'), plan.argv.join(' '));
      assert(!plan.argv.some((a) => a.includes('--yolo')), 'no yolo');
      const cmd = defaultHeadlessInvoke('codex', {
        write_mode: 'workspace-write',
        approval_mode: 'never',
      });
      assert(cmd.includes('codex'), cmd);
    },
  },
  {
    name: 'goal-report: DEFERRED status in markdown',
    run: () => {
      const report = generateGoalReportJson('run1', 'demo', 'DEFERRED', [
        { phase: 'ut', verdict: 'INCOMPLETE', deferred: true, deferred_reason: 'device_blocked' },
      ]);
      const md = generateGoalReportMarkdown(report);
      assert(md.includes('DEFERRED'), md);
      assert(md.includes('未完成'), md);
    },
  },
  {
    name: 'buildGoalManifestFromInput: basic fields',
    run: () => {
      const m = buildGoalManifestFromInput(
        {
          feature: 'demo',
          requirement: 'test req',
          adapter: 'claude',
          unattended: { write_mode: 'workspace-write', approval_mode: 'never' },
        },
        { projectRoot: REPO_ROOT, featuresDir: 'doc/features' },
      );
      assert(m.feature === 'demo', 'feature');
      assert(m.start_phase === 'spec', 'start');
      assert(m.unattended.write_mode === 'workspace-write', 'unattended');
      assert(
        m.report_dir.startsWith('doc/features/demo/goal-runs/'),
        `report_dir=${m.report_dir}`,
      );
    },
  },
  {
    name: 'buildGoalManifestFromInput: missing feature throws',
    run: () => {
      let threw = false;
      try {
        buildGoalManifestFromInput(
          {
            adapter: 'claude',
            unattended: { write_mode: 'workspace-write', approval_mode: 'never' },
          },
          { projectRoot: REPO_ROOT, featuresDir: 'doc/features' },
        );
      } catch (e) {
        threw = true;
        assert((e as Error).message.includes('feature 必填'), (e as Error).message);
      }
      assert(threw, 'expected throw');
    },
  },
  {
    name: 'buildGoalManifestFromInput: legacy report_dir rejected',
    run: () => {
      let threw = false;
      try {
        buildGoalManifestFromInput(
          {
            feature: 'demo',
            run_id: 'legacy-run',
            report_dir: 'goal-runs/legacy-run',
            adapter: 'claude',
            unattended: { write_mode: 'workspace-write', approval_mode: 'never' },
          },
          { projectRoot: REPO_ROOT, featuresDir: 'doc/features' },
        );
      } catch (e) {
        threw = true;
        assert((e as Error).message.includes('report_dir 必须为'), (e as Error).message);
        assert((e as Error).message.includes('goal-runs/legacy-run'), (e as Error).message);
      }
      assert(threw, 'expected throw');
    },
  },
  {
    name: 'buildGoalManifestFromInput: canonical report_dir accepted',
    run: () => {
      const m = buildGoalManifestFromInput(
        {
          feature: 'demo',
          run_id: 'run-canonical',
          report_dir: 'doc/features/demo/goal-runs/run-canonical',
          adapter: 'claude',
          unattended: { write_mode: 'workspace-write', approval_mode: 'never' },
        },
        { projectRoot: REPO_ROOT, featuresDir: 'doc/features' },
      );
      assert(m.report_dir === 'doc/features/demo/goal-runs/run-canonical', m.report_dir);
    },
  },
  {
    name: 'loadGoalManifestFile: uses custom featuresDir for default report_dir',
    run: () => {
      const tmp = path.join(REPO_ROOT, 'harness', 'tests', 'tmp-goal-manifest-file');
      const manifestPath = path.join(tmp, 'goal-manifest.yaml');
      fs.mkdirSync(tmp, { recursive: true });
      fs.writeFileSync(
        manifestPath,
        [
          'feature: demo',
          'adapter: claude',
          'unattended:',
          '  write_mode: workspace-write',
          '  approval_mode: never',
        ].join('\n'),
        'utf-8',
      );
      try {
        const m = loadGoalManifestFile(manifestPath, tmp, { featuresDir: 'custom/features' });
        assert(m.report_dir.startsWith('custom/features/demo/goal-runs/'), m.report_dir);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'resolveGoalReportDir: feature-bound path',
    run: () => {
      const dir = resolveGoalReportDir({
        featuresDir: 'doc/features',
        feature: 'home-page',
        runId: '20260608T120000Z',
      });
      assert(dir === 'doc/features/home-page/goal-runs/20260608T120000Z', dir);
    },
  },
  {
    name: 'loadGoalManifestFromRun: missing feature throws',
    run: () => {
      let threw = false;
      try {
        loadGoalManifestFromRun(REPO_ROOT, 'run1', { feature: '' });
      } catch (e) {
        threw = true;
        assert((e as Error).message.includes('--resume'), (e as Error).message);
      }
      assert(threw, 'expected throw');
    },
  },
  {
    name: 'loadGoalManifestFromRun: specified feature loads manifest',
    run: () => {
      const tmp = path.join(REPO_ROOT, 'harness', 'tests', 'tmp-goal-manifest-resume');
      const runId = 'test-run-goal-mode';
      const manifestDir = path.join(tmp, 'doc', 'features', 'demo', 'goal-runs', runId);
      fs.mkdirSync(manifestDir, { recursive: true });
      const body = {
        schema_version: '1.0',
        start_phase: 'spec',
        end_phase: 'testing',
        feature: 'demo',
        adapter: 'claude',
        budget: { max_retries_per_phase: 2, max_total_turns: 30, wall_clock_minutes: 480 },
        dependency_policy: {
          deferrable_blocking_classes: ['externalBlocked'],
          deferrable_failure_kinds: ['device_blocked'],
          propagate_to_downstream: true,
        },
        unattended: { write_mode: 'workspace-write', approval_mode: 'never' },
        run_id: runId,
        report_dir: 'doc/features/demo/goal-runs/test-run-goal-mode',
        created_at: new Date().toISOString(),
      };
      fs.writeFileSync(path.join(manifestDir, 'manifest.json'), JSON.stringify(body), 'utf-8');
      try {
        const loaded = loadGoalManifestFromRun(tmp, runId, {
          feature: 'demo',
          featuresDir: 'doc/features',
        });
        assert(loaded.feature === 'demo', 'feature');
        assert(loaded.run_id === runId, 'run_id');
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'loadGoalManifestFromRun: legacy report_dir in file rejected',
    run: () => {
      const tmp = path.join(REPO_ROOT, 'harness', 'tests', 'tmp-goal-manifest-resume-legacy');
      const runId = 'legacy-run-id';
      const manifestDir = path.join(tmp, 'doc', 'features', 'demo', 'goal-runs', runId);
      fs.mkdirSync(manifestDir, { recursive: true });
      const body = {
        schema_version: '1.0',
        start_phase: 'spec',
        end_phase: 'testing',
        feature: 'demo',
        adapter: 'claude',
        budget: { max_retries_per_phase: 2, max_total_turns: 30, wall_clock_minutes: 480 },
        dependency_policy: {
          deferrable_blocking_classes: ['externalBlocked'],
          deferrable_failure_kinds: ['device_blocked'],
          propagate_to_downstream: true,
        },
        unattended: { write_mode: 'workspace-write', approval_mode: 'never' },
        run_id: runId,
        report_dir: 'goal-runs/legacy-run-id',
        created_at: new Date().toISOString(),
      };
      fs.writeFileSync(path.join(manifestDir, 'manifest.json'), JSON.stringify(body), 'utf-8');
      let threw = false;
      try {
        try {
          loadGoalManifestFromRun(tmp, runId, { feature: 'demo', featuresDir: 'doc/features' });
        } catch (e) {
          threw = true;
          assert((e as Error).message.includes('report_dir 必须为'), (e as Error).message);
        }
        assert(threw, 'expected throw');
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    },
  },
];

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      c.run();
      results.push({ name: c.name, ok: true });
    } catch (e) {
      results.push({ name: c.name, ok: false, error: (e as Error).message });
    }
  }
  return results;
}

if (require.main === module) {
  const results = runAll();
  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    console.log(r.ok ? `PASS ${r.name}` : `FAIL ${r.name}: ${r.error}`);
  }
  process.exit(failed.length > 0 ? 1 : 0);
}
