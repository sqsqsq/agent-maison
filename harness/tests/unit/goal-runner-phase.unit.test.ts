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
  responsibilityRerunPending,
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
  // ==========================================================================
  // 环 B（plan f3a8c6d2 t2）：responsibilityRerunPending 从既有事件重建。
  // 零新增事件/字段/持久状态——只消费 phase_halt(pass_snapshot_unavailable) 与
  // agent_invoke_end{skipped}，故跨 --resume（新进程读同一 events.jsonl）同样成立。
  // ==========================================================================
  {
    name: '环B：三处真实 phaseIdx-- 出口都发 pass_snapshot_unavailable（生产源码结构）',
    run: () => {
      // 上一版这里用三组只差 `detail` 的手工事件——而 detail **不参与判定**，
      // 等于同一个用例跑三遍（codex 抓出的假覆盖）。判据只认 halt_reason，故真正要
      // 钉的是「每一处重跑出口都确实发出该 halt_reason」这条**生产接线**契约：
      // 任一 phaseIdx-- 分支漏发/改名，pending 就永远不会置位，死锁原样复发。
      const runner = fs.readFileSync(
        path.resolve(__dirname, '../../scripts/goal-runner.ts'),
        'utf8',
      );
      // 匹配语句形态（带分号）——注释里的 `phaseIdx--` 引用不算出口
      const exits = [...runner.matchAll(/phaseIdx--;/g)];
      assert(
        exits.length === 3,
        `已知重跑出口为 3 处（pre-invoke / post-agent drift / plan-freeze）；实得 ${exits.length} 处——` +
          '新增出口必须同步纳入 responsibilityRerunPending 的置位面并更新本断言',
      );
      for (const m of exits) {
        const before = runner.slice(Math.max(0, (m.index ?? 0) - 2000), m.index ?? 0);
        assert(
          /halt_reason:\s*'pass_snapshot_unavailable'/.test(before),
          `phaseIdx-- 出口（源码偏移 ${m.index}）之前未发 halt_reason='pass_snapshot_unavailable'——` +
            '该出口的重跑不会置 pending，agent 会被继续 skip',
        );
      }
    },
  },
  {
    name: '环B：goal-runner 接线在位——pending 派生自 events 且传入 skip 决策',
    run: () => {
      // 纯函数再正确，调用方断线一样死锁。这两条钉的就是 codex 点名的两种回归：
      // ① 删掉 responsibilityRerunPending(...) 的派生；② 不再把它传给 decideSkipAgentInvoke。
      const runner = fs.readFileSync(
        path.resolve(__dirname, '../../scripts/goal-runner.ts'),
        'utf8',
      );
      assert(
        /responsibilityRerunPending\(\s*phaseStartEvents\s*,/.test(runner),
        'pending 必须自 phaseStartEvents（phase 循环体开头读盘、跨 resume 成立）派生',
      );
      assert(
        /decideSkipAgentInvoke\(\{[\s\S]{0,400}responsibilityRerunPending:/.test(runner),
        'pending 必须传入 decideSkipAgentInvoke——否则判据拿不到它，等于没修',
      );
      assert(
        /runSyncClosureDetailed\([\s\S]{0,600}goalIdentity:/.test(runner),
        '环C：closure 提交侧必须透传 goalIdentity，否则 attempt 等值校验在提交环节静默跳过',
      );
    },
  },
  {
    name: '环B：被 skip 的一轮不算消费——真实 invoke 结束后才清除 pending',
    run: () => {
      const halt = { type: 'phase_halt', phase: 'plan', halt_reason: 'pass_snapshot_unavailable' };
      // 事故实锤序列（bc-openCard i5）：runner 先发 start，再判 skip，end 带 skipped=true。
      // 只看 start 会把这一轮误记为已消费，于是下一轮继续 skip → 死锁不解。
      const skipped = [
        halt,
        { type: 'agent_invoke_start', phase: 'plan', invoke_id: 'plan-i6' },
        // 真实事件另带 action='skip_agent_invoke'，判据不消费该字段故夹具从简
        { type: 'completion_evidence_pre_existing', phase: 'plan', invoke_id: 'plan-i6' },
        { type: 'agent_invoke_end', phase: 'plan', invoke_id: 'plan-i6', skipped: true },
      ];
      assert(responsibilityRerunPending(skipped, 'plan') === true, 'skip 轮不得清除 pending');

      // 真跑一轮（end 无 skipped）→ 消费
      const real = [
        ...skipped,
        { type: 'agent_invoke_start', phase: 'plan', invoke_id: 'plan-i7' },
        { type: 'agent_invoke_end', phase: 'plan', invoke_id: 'plan-i7', exit_code: 0 },
      ];
      assert(responsibilityRerunPending(real, 'plan') === false, '真实 invoke 后应消费 pending');

      // 消费后又一次漂移 → 重新 pending（每次缓存失效都要求真跑）
      const again = [...real, halt];
      assert(responsibilityRerunPending(again, 'plan') === true, '再次漂移应重新置 pending');
    },
  },
  {
    name: '环B：pending 跨 resume 从 events 重建，且按 phase 隔离、无 halt 时恒 false',
    run: () => {
      // 跨 resume：新进程内存归零，但 events.jsonl 仍在——判据只读事件即可重建。
      const persisted = [
        { type: 'phase_halt', phase: 'plan', halt_reason: 'pass_snapshot_unavailable' },
        { type: 'run_end', status: 'HALTED' },
        // ↓ resume 后的新进程从这里继续
        { type: 'phase_start', phase: 'plan' },
      ];
      assert(responsibilityRerunPending(persisted, 'plan') === true, 'resume 后应重建 pending');

      // phase 隔离：plan 的漂移不得影响 spec
      assert(responsibilityRerunPending(persisted, 'spec') === false, 'pending 不得跨 phase 泄漏');

      // 其它 halt 原因不置位（只认缓存失效类）
      const otherHalt = [
        { type: 'phase_halt', phase: 'plan', halt_reason: 'closure_wall_repeated' },
      ];
      assert(responsibilityRerunPending(otherHalt, 'plan') === false, '非缓存失效 halt 不得置 pending');
      assert(responsibilityRerunPending([], 'plan') === false, '无事件恒 false');
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
