// goal-runner-policy.unit.test.ts — resolveAutoChain, classifyPhaseVerdict, goal manifest, adapter preflight

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
      const chain = resolveAutoChain(workflow, 'prd', 'testing');
      assert(chain[0] === 'prd', 'starts prd');
      assert(chain[chain.length - 1] === 'testing', 'ends testing');
      assert(chain.includes('ut'), 'includes ut');
    },
  },
  {
    name: 'resolveAutoChain: design→ut mid-range',
    run: () => {
      const chain = resolveAutoChain(workflow, 'design', 'ut');
      assert(!chain.includes('prd'), 'excludes prd');
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
        [{ phase: 'prd' }, { phase: 'design' }],
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
        PHASE: 'prd',
      });
      assert(cmd.includes('demo'), cmd);
      assert(cmd.includes('prd'), cmd);
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
        { projectRoot: REPO_ROOT },
      );
      assert(m.feature === 'demo', 'feature');
      assert(m.start_phase === 'prd', 'start');
      assert(m.unattended.write_mode === 'workspace-write', 'unattended');
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
