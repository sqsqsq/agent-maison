// goal-runner-phase.unit.test.ts — summary freshness, resume, structured invoke

import * as fs from 'fs';
import * as os from 'os';
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
  detectHalfCompletedPhaseRecovery,
  buildHalfPhaseRecoveryEvents,
  findUnclosedAgentInvokeStart,
  isReceiptFreshForInvokeStart,
} from '../../scripts/utils/goal-runner-phase';
import { resolveGoalRunStatus } from '../../scripts/utils/phase-transition-policy';
import type { GoalPhaseOutcome } from '../../scripts/utils/goal-report-generator';
import { loadGoalCapability } from '../../scripts/utils/goal-adapter-capability';
import {
  buildPhasePrompt,
  extractPriorFailureContext,
  type SummaryJson,
} from '../../scripts/goal-runner';
import type { GoalManifest } from '../../scripts/utils/goal-manifest';
import type { UnitCaseResult } from '../run-unit';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const FRAMEWORK_ROOT = REPO_ROOT;
const workflow = loadWorkflowSpec(FRAMEWORK_ROOT, 'spec-driven');

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function mkProjectWithReportsPattern(root: string): void {
  const frameworkRoot = path.resolve(__dirname, '..', '..', '..');
  fs.mkdirSync(path.join(root, 'framework', 'harness', 'state'), { recursive: true });
  fs.mkdirSync(path.join(root, 'framework', 'workflows'), { recursive: true });
  fs.copyFileSync(
    path.join(frameworkRoot, 'workflows', 'spec-driven.workflow.yaml'),
    path.join(root, 'framework', 'workflows', 'spec-driven.workflow.yaml'),
  );
  fs.writeFileSync(
    path.join(root, 'framework.config.json'),
    JSON.stringify({
      schema_version: '1.1',
      project_name: 'half-phase-test',
      project_profile: { name: 'generic' },
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
      active_workflow: 'spec-driven',
    }),
    'utf-8',
  );
}

function writeFreshReceipt(
  root: string,
  feature: string,
  phase: string,
  startMs: number,
  claimedAtIso: string,
): string {
  const receiptDir = path.join(root, 'doc', 'features', feature, phase);
  fs.mkdirSync(receiptDir, { recursive: true });
  const receiptPath = path.join(receiptDir, 'phase-completion-receipt.md');
  fs.writeFileSync(
    receiptPath,
    `---\nfeature: ${feature}\nphase: ${phase}\nclaimed_completion_at: "${claimedAtIso}"\n---\n`,
    'utf-8',
  );
  fs.utimesSync(receiptPath, new Date(startMs + 60_000), new Date(startMs + 60_000));
  return receiptPath;
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
        validateFeatureChainDag(workflow, ['spec', 'testing'], 'spec');
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
        resolveAutoChain(workflow, 'spec', 'testing', ['spec', 'testing']);
      } catch {
        threw = true;
      }
      assert(threw, 'override skip coding');
    },
  },
  {
    name: 'resolveResumeState: skip completed phases',
    run: () => {
      const chain = ['spec', 'plan', 'coding'] as const;
      const r = resolveResumeState([...chain], [
        { phase: 'spec', verdict: 'PASS' },
        { phase: 'plan', verdict: 'PASS' },
      ]);
      assert(r.startIndex === 2, `index ${r.startIndex}`);
      assert(r.priorOutcomes.length === 2, 'prior');
    },
  },
  {
    name: 'resolveResumeState: halted retries same phase',
    run: () => {
      const chain = ['spec', 'plan', 'coding'] as const;
      const r = resolveResumeState([...chain], [
        { phase: 'spec', verdict: 'PASS' },
        { phase: 'plan', verdict: 'FAIL', halted: true },
      ]);
      assert(r.startIndex === 1, `index ${r.startIndex}`);
      assert(r.priorOutcomes.length === 1, 'drop halted from prior');
    },
  },
  {
    name: 'findUnclosedAgentInvokeStart: invoke_id pairs end to correct start on retry',
    run: () => {
      const open = findUnclosedAgentInvokeStart([
        { type: 'agent_invoke_start', phase: 'coding', ts: '2026-01-01T00:00:00Z', invoke_id: 'a1' },
        { type: 'agent_invoke_end', phase: 'coding', ts: '2026-01-01T00:01:00Z', invoke_id: 'a1' },
        { type: 'agent_invoke_start', phase: 'coding', ts: '2026-01-01T00:02:00Z', invoke_id: 'a2' },
      ]);
      assert(open?.invoke_id === 'a2', open?.invoke_id ?? 'none');
    },
  },
  {
    name: 'findUnclosedAgentInvokeStart: coding without end',
    run: () => {
      const open = findUnclosedAgentInvokeStart([
        { type: 'agent_invoke_start', phase: 'coding', ts: '2026-01-01T00:00:00Z' },
      ]);
      assert(open?.phase === 'coding', open?.phase ?? 'none');
    },
  },
  {
    name: 'detectHalfCompletedPhaseRecovery: fresh PASS summary after unclosed start',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'half-phase-'));
      mkProjectWithReportsPattern(root);
      const feature = 'demo';
      const phaseDir = path.join(root, 'doc', 'features', feature, 'coding', 'reports');
      fs.mkdirSync(phaseDir, { recursive: true });
      const summaryPath = path.join(phaseDir, 'summary.json');
      fs.writeFileSync(
        summaryPath,
        JSON.stringify({
          verdict: 'PASS',
          receipt_status: 'passed',
          closure_status: 'closed',
        }),
        'utf-8',
      );
      const startTs = '2026-01-01T00:00:00.000Z';
      const startMs = new Date(startTs).getTime();
      fs.utimesSync(summaryPath, new Date(startMs + 60_000), new Date(startMs + 60_000));
      writeFreshReceipt(root, feature, 'coding', startMs, '2026-01-01T01:00:00.000Z');

      const detected = detectHalfCompletedPhaseRecovery(
        [{ type: 'agent_invoke_start', phase: 'coding', ts: startTs }],
        root,
        feature,
      );
      assert(detected?.phase === 'coding', detected?.phase ?? 'none');

      const events = buildHalfPhaseRecoveryEvents(detected!);
      assert(events.length === 2, String(events.length));
      assert(events[1].recovered === true, 'recovered verdict');

      const resume = resolveResumeFromEvents(
        ['spec', 'plan', 'coding', 'review', 'ut', 'testing'],
        [
          { type: 'phase_verdict', phase: 'spec', action: 'advance', verdict: 'PASS' },
          { type: 'phase_verdict', phase: 'plan', action: 'advance', verdict: 'PASS' },
          { type: 'agent_invoke_start', phase: 'coding', ts: startTs },
          ...(events as Parameters<typeof resolveResumeFromEvents>[1]),
        ],
      );
      assert(resume.startIndex === 3, `startIndex ${resume.startIndex} (review)`);
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: 'detectHalfCompletedPhaseRecovery: fresh summary but stale receipt → null',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'half-phase-stale-rcpt-'));
      mkProjectWithReportsPattern(root);
      const feature = 'demo';
      const phaseDir = path.join(root, 'doc', 'features', feature, 'coding', 'reports');
      fs.mkdirSync(phaseDir, { recursive: true });
      const summaryPath = path.join(phaseDir, 'summary.json');
      const startTs = '2026-06-01T00:00:00.000Z';
      const startMs = new Date(startTs).getTime();
      fs.writeFileSync(
        summaryPath,
        JSON.stringify({
          verdict: 'PASS',
          receipt_status: 'passed',
          closure_status: 'closed',
        }),
        'utf-8',
      );
      fs.utimesSync(summaryPath, new Date(startMs + 60_000), new Date(startMs + 60_000));
      const receiptPath = writeFreshReceipt(root, feature, 'coding', startMs, '2026-01-01T01:00:00.000Z');
      const oldMs = new Date('2020-01-01').getTime();
      fs.utimesSync(receiptPath, new Date(oldMs), new Date(oldMs));

      const detected = detectHalfCompletedPhaseRecovery(
        [{ type: 'agent_invoke_start', phase: 'coding', ts: startTs }],
        root,
        feature,
      );
      assert(detected === null, 'stale receipt rejected');
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: 'isReceiptFreshForInvokeStart: claimed_completion_at before invoke start → false',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'half-phase-old-claim-'));
      mkProjectWithReportsPattern(root);
      const feature = 'demo';
      const startMs = new Date('2026-06-01T00:00:00.000Z').getTime();
      writeFreshReceipt(root, feature, 'coding', startMs, '2026-01-01T00:00:00.000Z');
      assert(
        !isReceiptFreshForInvokeStart(root, feature, 'coding', startMs),
        'old claimed_completion_at rejected',
      );
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: 'detectHalfCompletedPhaseRecovery: stale summary before invoke start → null',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'half-phase-stale-'));
      mkProjectWithReportsPattern(root);
      const feature = 'demo';
      const phaseDir = path.join(root, 'doc', 'features', feature, 'coding', 'reports');
      fs.mkdirSync(phaseDir, { recursive: true });
      const summaryPath = path.join(phaseDir, 'summary.json');
      fs.writeFileSync(
        summaryPath,
        JSON.stringify({
          verdict: 'PASS',
          receipt_status: 'passed',
          closure_status: 'closed',
        }),
        'utf-8',
      );
      const oldMs = new Date('2020-01-01').getTime();
      fs.utimesSync(summaryPath, new Date(oldMs), new Date(oldMs));

      const detected = detectHalfCompletedPhaseRecovery(
        [{ type: 'agent_invoke_start', phase: 'coding', ts: '2026-06-01T00:00:00.000Z' }],
        root,
        feature,
      );
      assert(detected === null, 'stale summary rejected');
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: 'parseCompletedPhasesFromEvents: advance + defer',
    run: () => {
      const done = parseCompletedPhasesFromEvents([
        { type: 'phase_verdict', phase: 'spec', action: 'advance' },
        { type: 'phase_verdict', phase: 'ut', action: 'defer_external_and_continue_if_allowed' },
      ]);
      assert(done.has('spec'), 'prd');
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
      assert(plan.stdin === 'hello', 'prompt via stdin, never argv (Windows .cmd safe)');
      assert(!plan.argv.includes('hello'), plan.argv.join(' '));
      assert(plan.argv.includes('-p'), plan.argv.join(' '));
      assert(!plan.argv.some((a) => a.includes('$(cat')), plan.argv.join(' '));
      assert(plan.useStdin === true, 'claude uses stdin prompt');
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
          PHASE: 'spec',
        },
      );
      const pIdx = plan.argv.indexOf('-p');
      assert(pIdx >= 0, plan.argv.join(' '));
      assert(plan.stdin === multiline, 'multiline prompt via stdin, not argv');
      assert(plan.useStdin === true, 'claude uses stdin');
      assert(!plan.argv.some((a) => a.includes('\n')), 'no argv element may contain a newline');
    },
  },
  {
    // Regression guard for the Windows .cmd truncation bug: a multi-line prompt passed as an
    // argv element is silently truncated at the first newline by cmd.exe (claude/cursor are
    // .cmd shims). All structured adapters must therefore deliver the prompt via stdin.
    name: 'headless stdin: claude/codex/cursor pass multiline prompt via stdin, never argv',
    run: () => {
      const multiline = '# Goal phase: spec\nFeature: demo\nrequirement: say "hi" & do X\nFINAL line';
      for (const adapter of ['claude', 'codex', 'cursor']) {
        const plan = defaultHeadlessInvokePlan(
          adapter,
          { write_mode: 'workspace-write', approval_mode: 'never' },
          multiline,
        );
        assert(plan.useStdin === true, `${adapter} must use stdin`);
        assert(plan.stdin === multiline, `${adapter} stdin must be the full prompt`);
        assert(!plan.argv.includes(multiline), `${adapter} prompt must not be an argv element`);
        assert(
          !plan.argv.some((a) => a.includes('\n')),
          `${adapter} no argv element may contain a newline (cmd.exe truncates)`,
        );
      }
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
      const chain = resolveAutoChain(workflow, 'spec', 'testing');
      const events = [
        { type: 'phase_verdict', phase: 'spec', action: 'advance' as const, verdict: 'PASS' },
        { type: 'phase_verdict', phase: 'plan', action: 'advance' as const, verdict: 'PASS' },
      ];
      const prior = rebuildOutcomesFromEvents(events, chain);
      assert(prior.length === 2, String(prior.length));
      assert(prior[0].phase === 'spec' && prior[1].phase === 'plan', 'order');
      const resume = resolveResumeFromEvents(chain, events);
      assert(resume.startIndex === 2, `start ${resume.startIndex}`);
      assert(resume.priorOutcomes.length === 2, 'prior count');
    },
  },
  {
    name: 'resolveResumeFromEvents: merged outcomes allow COMPLETED after resume',
    run: () => {
      const chain = resolveAutoChain(workflow, 'spec', 'testing');
      const events = [
        { type: 'phase_verdict', phase: 'spec', action: 'advance' as const, verdict: 'PASS' },
        { type: 'phase_verdict', phase: 'plan', action: 'advance' as const, verdict: 'PASS' },
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
      assert(status === 'CHAIN_SLICE_COMPLETED', status);
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
      const chain = resolveAutoChain(workflow, 'spec', 'testing');
      const prior: GoalPhaseOutcome[] = [{ phase: 'spec', verdict: 'PASS' }];
      const budgetHalt: GoalPhaseOutcome = {
        phase: 'plan',
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

const PRIOR_FAILURE_SUMMARY: SummaryJson = {
  verdict: 'FAIL',
  blockers: [
    {
      id: 'ut_hvigor_build',
      classification: 'build_config_invalid',
      details_excerpt: "Schema validate failed: property name 'applyToProducts' is invalid",
      affected_files: ['01-Product/Phone/build-profile.json5'],
      suggestion: '定位 build-profile.json5 的非法字段并修正；优先回退到起始提交版本。',
    },
    {
      id: 'ut_no_src_mutation',
      classification: 'unauthorized_src_mutation',
      affected_files: ['01-Product/Phone/build-profile.json5'],
    },
  ],
};

const MINIMAL_MANIFEST = {
  feature: 'bc-openCard',
  requirement: '开卡流程',
} as unknown as GoalManifest;

cases.push(
  {
    name: 'extractPriorFailureContext: 含 check id / 分类 / affected_files / suggestion',
    run: () => {
      const ctx = extractPriorFailureContext(PRIOR_FAILURE_SUMMARY);
      assert(ctx.includes('Verdict: FAIL'), 'verdict');
      assert(ctx.includes('ut_hvigor_build [build_config_invalid]'), 'check id + 分类');
      assert(ctx.includes('build-profile.json5'), 'affected_files 透传');
      assert(ctx.includes('优先回退'), 'suggestion 透传');
    },
  },
  {
    name: 'buildPhasePrompt: 带 priorFailure (code_regression) 时注入回退指令',
    run: () => {
      const prior = extractPriorFailureContext(PRIOR_FAILURE_SUMMARY);
      const prompt = buildPhasePrompt(
        MINIMAL_MANIFEST,
        FRAMEWORK_ROOT,
        'ut',
        FRAMEWORK_ROOT,
        [],
        prior,
        'code_regression',
      );
      assert(prompt.includes('Prior attempt failure'), '注入失败小节');
      assert(prompt.includes('build-profile.json5'), '携带上轮证据');
      assert(prompt.includes('revert that change first'), '回退指令');
    },
  },
  {
    name: 'buildPhasePrompt: 无 priorFailure（首跑）不注入失败小节',
    run: () => {
      const prompt = buildPhasePrompt(MINIMAL_MANIFEST, FRAMEWORK_ROOT, 'ut', FRAMEWORK_ROOT, []);
      assert(!prompt.includes('Prior attempt failure'), '首跑不回喂');
    },
  },
);

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
