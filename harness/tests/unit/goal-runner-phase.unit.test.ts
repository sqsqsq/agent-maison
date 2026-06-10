// goal-runner-phase.unit.test.ts — summary freshness, resume, structured invoke

import * as path from 'path';
import {
  classifyPhaseVerdict,
  resolveAutoChain,
  validateFeatureChainDag,
  DEFAULT_DEPENDENCY_POLICY,
} from '../../scripts/utils/phase-transition-policy';
import { loadWorkflowSpec } from '../../workflow-loader';
import {
  normalizeHeadlessTemplate,
  defaultHeadlessInvokePlan,
  resolveHeadlessInvokePlan,
  tokenizeInvokeCommand,
  injectPromptIntoArgv,
  PROMPT_ARGV_SENTINEL,
} from '../../scripts/utils/agent-invoke';
import {
  checkRunBudget,
  isSummaryFresh,
  resolvePhaseHarnessVerdict,
  resolveResumeState,
  resolveResumeFromEvents,
  rebuildOutcomesFromEvents,
  parseCompletedPhasesFromEvents,
} from '../../scripts/utils/goal-runner-phase';
import { resolveGoalRunStatus } from '../../scripts/utils/phase-transition-policy';
import type { GoalPhaseOutcome } from '../../scripts/utils/goal-report-generator';
import { loadGoalCapability } from '../../scripts/utils/goal-adapter-capability';
import type { UnitCaseResult } from '../run-unit';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const FRAMEWORK_ROOT = REPO_ROOT;
const workflow = loadWorkflowSpec(FRAMEWORK_ROOT, 'spec-driven');

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'isSummaryFresh: new file after null before',
    run: () => {
      assert(isSummaryFresh(null, 1000), 'new summary');
      assert(!isSummaryFresh(1000, 1000), 'same mtime stale');
      assert(isSummaryFresh(1000, 1001), 'advanced mtime');
    },
  },
  {
    name: 'resolvePhaseHarnessVerdict: stale summary → FAIL',
    run: () => {
      const r = resolvePhaseHarnessVerdict({
        dryRun: false,
        agentExitCode: 1,
        harnessExitCode: 0,
        summaryBeforeMtime: 2000,
        summaryAfterMtime: 2000,
        summaryVerdict: 'PASS',
      });
      assert(r.verdict === 'FAIL', r.verdict);
      assert(r.stale_summary, 'stale');
      assert(r.agent_failed, 'agent failed');
    },
  },
  {
    name: 'resolvePhaseHarnessVerdict: fresh PASS advances',
    run: () => {
      const r = resolvePhaseHarnessVerdict({
        dryRun: false,
        agentExitCode: 0,
        harnessExitCode: 0,
        summaryBeforeMtime: 1000,
        summaryAfterMtime: 2000,
        summaryVerdict: 'PASS',
      });
      assert(r.verdict === 'PASS', r.verdict);
      assert(!r.stale_summary, 'fresh');
    },
  },
  {
    name: 'resolvePhaseHarnessVerdict: fresh PASS + agent timeout exit still PASS',
    run: () => {
      const r = resolvePhaseHarnessVerdict({
        dryRun: false,
        agentExitCode: 1,
        harnessExitCode: 0,
        summaryBeforeMtime: 1000,
        summaryAfterMtime: 2000,
        summaryVerdict: 'PASS',
      });
      assert(r.verdict === 'PASS', r.verdict);
      assert(r.agent_failed, 'observability');
    },
  },
  {
    name: 'resolvePhaseHarnessVerdict: agent fail without summary → FAIL',
    run: () => {
      const r = resolvePhaseHarnessVerdict({
        dryRun: false,
        agentExitCode: 1,
        harnessExitCode: 1,
        summaryBeforeMtime: null,
        summaryAfterMtime: null,
      });
      assert(r.verdict === 'FAIL', r.verdict);
      assert(r.agent_failed, 'agent failed');
    },
  },
  {
    name: 'classifyPhaseVerdict: propagate_to_downstream false → defer halt',
    run: () => {
      const action = classifyPhaseVerdict({
        verdict: 'INCOMPLETE',
        failure_kind: 'device_blocked',
        dependency_policy: { ...DEFAULT_DEPENDENCY_POLICY, propagate_to_downstream: false },
      });
      assert(action === 'defer_external_and_halt', action);
    },
  },
  {
    name: 'validateFeatureChainDag: prd→testing skip coding throws',
    run: () => {
      let threw = false;
      try {
        validateFeatureChainDag(workflow, ['prd', 'testing'], 'prd');
      } catch (e) {
        threw = true;
        assert((e as Error).message.includes('ut'), (e as Error).message);
      }
      assert(threw, 'expected throw');
    },
  },
  {
    name: 'resolveAutoChain: invalid override prd→testing throws',
    run: () => {
      let threw = false;
      try {
        resolveAutoChain(workflow, 'prd', 'testing', ['prd', 'testing']);
      } catch {
        threw = true;
      }
      assert(threw, 'override skip coding');
    },
  },
  {
    name: 'resolveResumeState: skip completed phases',
    run: () => {
      const chain = ['prd', 'design', 'coding'] as const;
      const r = resolveResumeState([...chain], [
        { phase: 'prd', verdict: 'PASS' },
        { phase: 'design', verdict: 'PASS' },
      ]);
      assert(r.startIndex === 2, `index ${r.startIndex}`);
      assert(r.priorOutcomes.length === 2, 'prior');
    },
  },
  {
    name: 'resolveResumeState: halted retries same phase',
    run: () => {
      const chain = ['prd', 'design', 'coding'] as const;
      const r = resolveResumeState([...chain], [
        { phase: 'prd', verdict: 'PASS' },
        { phase: 'design', verdict: 'FAIL', halted: true },
      ]);
      assert(r.startIndex === 1, `index ${r.startIndex}`);
      assert(r.priorOutcomes.length === 1, 'drop halted from prior');
    },
  },
  {
    name: 'parseCompletedPhasesFromEvents: advance + defer',
    run: () => {
      const done = parseCompletedPhasesFromEvents([
        { type: 'phase_verdict', phase: 'prd', action: 'advance' },
        { type: 'phase_verdict', phase: 'ut', action: 'defer_external_and_continue_if_allowed' },
      ]);
      assert(done.has('prd'), 'prd');
      assert(done.has('ut'), 'ut');
    },
  },
  {
    name: 'normalizeHeadlessTemplate: legacy cat → PROMPT',
    run: () => {
      const t = normalizeHeadlessTemplate('claude -p "$(cat {{PROMPT_FILE}})"');
      assert(t.includes('{{PROMPT}}'), t);
      assert(!t.includes('$(cat'), t);
    },
  },
  {
    name: 'defaultHeadlessInvokePlan: claude argv no shell',
    run: () => {
      const plan = defaultHeadlessInvokePlan(
        'claude',
        { write_mode: 'workspace-write', approval_mode: 'never' },
        'hello',
      );
      assert(
        plan.argv[0] === 'claude' || /claude(\.exe|\.cmd)?$/i.test(plan.argv[0]),
        plan.argv.join(' '),
      );
      assert(plan.argv.includes('hello'), plan.argv.join(' '));
      assert(plan.argv.includes('-p'), plan.argv.join(' '));
      assert(!plan.argv.some((a) => a.includes('$(cat')), plan.argv.join(' '));
      assert(!plan.useStdin, 'claude uses argv prompt');
    },
  },
  {
    name: 'resolveHeadlessInvokePlan: claude uses structured argv despite adapter template',
    run: () => {
      const gc = loadGoalCapability(FRAMEWORK_ROOT, 'claude');
      const multiline = '# Goal phase\nline2\nrequirement: say "hello"';
      const plan = resolveHeadlessInvokePlan(
        'claude',
        gc.capability!,
        { write_mode: 'workspace-write', approval_mode: 'never' },
        multiline,
        {
          PROMPT: multiline,
          PROMPT_FILE: '/tmp/p.md',
          SKILL_PATH: '/tmp/s',
          PROJECT_ROOT: '/proj',
          FRAMEWORK_ROOT: '/fw',
          FEATURE: 'demo',
          PHASE: 'prd',
        },
      );
      const pIdx = plan.argv.indexOf('-p');
      assert(pIdx >= 0, plan.argv.join(' '));
      assert(plan.argv[pIdx + 1] === multiline, 'prompt must be single argv after -p');
    },
  },
  {
    name: 'injectPromptIntoArgv: multiline prompt with quotes stays one element',
    run: () => {
      const prompt = 'line1\nline2 "quoted"';
      const argv = injectPromptIntoArgv(
        ['custom-cli', '-p', PROMPT_ARGV_SENTINEL, '--flag'],
        prompt,
      );
      assert(argv[2] === prompt, argv.join('|'));
      assert(argv.length === 4, String(argv.length));
    },
  },
  {
    name: 'tokenizeInvokeCommand: simple args',
    run: () => {
      const args = tokenizeInvokeCommand('cmd --flag value');
      assert(args[0] === 'cmd' && args[1] === '--flag', args.join('|'));
    },
  },
  {
    name: 'rebuildOutcomesFromEvents: prd+design advance restores prior outcomes',
    run: () => {
      const chain = resolveAutoChain(workflow, 'prd', 'testing');
      const events = [
        { type: 'phase_verdict', phase: 'prd', action: 'advance' as const, verdict: 'PASS' },
        { type: 'phase_verdict', phase: 'design', action: 'advance' as const, verdict: 'PASS' },
      ];
      const prior = rebuildOutcomesFromEvents(events, chain);
      assert(prior.length === 2, String(prior.length));
      assert(prior[0].phase === 'prd' && prior[1].phase === 'design', 'order');
      const resume = resolveResumeFromEvents(chain, events);
      assert(resume.startIndex === 2, `start ${resume.startIndex}`);
      assert(resume.priorOutcomes.length === 2, 'prior count');
    },
  },
  {
    name: 'resolveResumeFromEvents: merged outcomes allow COMPLETED after resume',
    run: () => {
      const chain = resolveAutoChain(workflow, 'prd', 'testing');
      const events = [
        { type: 'phase_verdict', phase: 'prd', action: 'advance' as const, verdict: 'PASS' },
        { type: 'phase_verdict', phase: 'design', action: 'advance' as const, verdict: 'PASS' },
      ];
      const resume = resolveResumeFromEvents(chain, events);
      const newOutcomes: GoalPhaseOutcome[] = chain.slice(resume.startIndex).map((phase) => ({
        phase,
        verdict: 'PASS',
      }));
      const merged: GoalPhaseOutcome[] = [...resume.priorOutcomes, ...newOutcomes];
      const reachedEnd =
        merged.length === chain.length && merged[merged.length - 1]?.phase === chain[chain.length - 1];
      const status = resolveGoalRunStatus(
        merged.map((o) => ({ phase: o.phase, deferred: o.deferred, halted: o.halted })),
        reachedEnd,
      );
      assert(status === 'COMPLETED', status);
    },
  },
  {
    name: 'checkRunBudget: blocks second attempt when max_total_turns=1',
    run: () => {
      assert(checkRunBudget(0, 1, 0, 60000) === 'ok', 'first ok');
      assert(checkRunBudget(1, 1, 0, 60000) === 'turns', 'second blocked');
    },
  },
  {
    name: 'checkRunBudget: ignores retry when turns already at cap',
    run: () => {
      assert(checkRunBudget(1, 1, 100, 60000) === 'turns', 'at cap before retry');
    },
  },
  {
    name: 'resolveGoalRunStatus: budget halt outcome → HALTED not PARTIAL',
    run: () => {
      const chain = resolveAutoChain(workflow, 'prd', 'testing');
      const prior: GoalPhaseOutcome[] = [{ phase: 'prd', verdict: 'PASS' }];
      const budgetHalt: GoalPhaseOutcome = {
        phase: 'design',
        verdict: 'FAIL',
        halted: true,
        retries: 1,
      };
      const outcomes = [...prior, budgetHalt];
      const reachedEnd = false;
      const status = resolveGoalRunStatus(
        outcomes.map((o) => ({ phase: o.phase, deferred: o.deferred, halted: o.halted })),
        reachedEnd,
      );
      assert(status === 'HALTED', status);
      assert(outcomes.length < chain.length, 'stopped before end');
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
