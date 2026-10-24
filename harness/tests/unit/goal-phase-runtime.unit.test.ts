import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { loadWorkflowSpec } from '../../workflow-loader';
import { resolveFeatureArtifact } from '../../config';
import {
  AttendedGoalPhaseExecutor,
  createPhaseExecutionContext,
  DetachedGoalPhaseExecutor,
  PHASE_EXECUTION_CONTEXT_FORBIDDEN_FIELDS,
  type PhaseExecutionContext,
} from '../../scripts/utils/goal-phase-executor';
import { GoalPhaseRuntime } from '../../scripts/utils/goal-phase-runtime';
import { extractPriorFailureContext } from '../../scripts/goal-runner';
import { projectCanonicalLifecycle } from '../../scripts/utils/goal-canonical-lifecycle';
import type { HeadlessInvokePlan } from '../../scripts/utils/agent-invoke';
import {
  casAcquireRunOwner,
  ensureRunControl,
  readRunControl,
  releaseRunOwner,
} from '../../scripts/utils/goal-run-control';
import {
  runGoalRuntimeChain,
  setupGoalRuntimeHost,
  type RunProbe,
} from './goal-runner-testing-integrity.unit.test';
import {
  buildGoalManifestFromInput,
  loadGoalManifestFromRun,
  writeGoalManifest,
} from '../../scripts/utils/goal-manifest';
import { resolveGoalRunBaseline } from '../../scripts/utils/goal-run-baseline';
import { resolveGoalRunHeadSha } from '../../scripts/utils/goal-run-creation';
import { writeHandoffRequest } from '../../scripts/utils/goal-handoff';
import { runGoalModeSessionStep } from '../../scripts/goal-mode-entry';
import { readSessionExecution, acceptedSessionReport } from '../../scripts/utils/session-execution-handoff';

export interface UnitCaseResult { name: string; ok: boolean; error?: string }
interface Case { name: string; run: () => void | Promise<void> }

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function context(overrides: Partial<PhaseExecutionContext> = {}): PhaseExecutionContext {
  return createPhaseExecutionContext({
    runId: 'run-1',
    feature: 'demo',
    workflowId: 'spec-driven',
    track: 'full',
    chain: ['spec', 'plan', 'coding'],
    phase: 'coding',
    attemptId: 'i1',
    owner: { run_id: 'run-1', owner_id: 'owner-1', epoch: 1, kind: 'process' },
    projectRoot: '/project',
    frameworkRoot: '/project/framework',
    runDir: '/project/doc/features/demo/goal/runs/run-1',
    reportDir: 'doc/features/demo/goal/runs/run-1',
    adapter: 'codex',
    adapterModel: 'gpt-test',
    runtimeFacts: {
      runBaseSha: 'a'.repeat(40),
      receiptRequired: true,
      resume: false,
      successor: false,
    },
    childEnv: { MAISON_GOAL_RUN_ID: 'run-1' },
    ...overrides,
  });
}

function cloneHost(source: string, label: string): string {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), `goal-runtime-${label}-`));
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(source, target, { recursive: true });
  return target;
}

function canonicalOf(probe: RunProbe): ReturnType<typeof projectCanonicalLifecycle> {
  return projectCanonicalLifecycle(probe.events);
}

function seedUtFailureSummary(root: string, blockers: Array<Record<string, unknown>>): void {
  const reports = path.join(root, 'doc/features/bc-openCard/ut/reports');
  fs.mkdirSync(reports, { recursive: true });
  fs.writeFileSync(path.join(reports, 'summary.json'), JSON.stringify({
    schema_version: '1.2', assurance: 'full', verdict: 'FAIL', blocker_count: blockers.length,
    receipt_status: 'missing', closure_status: 'open', next_action: 'fix_blockers',
    report_validity: 'PASS', release_readiness: 'BLOCKED', completion_status: 'complete',
    capability_resolutions: [], capability_resolution_contract_fingerprint: null,
    blockers, checks: [],
  }, null, 2));
}

const cases: Case[] = [{
  name: '1804 partial receipt takeover keeps epoch archives separate and expires without accepting old reports or resetting a two-turn budget',
  run: async () => {
    const nodeFs = require('fs') as typeof fs;
    const manifests = require('../../scripts/utils/goal-manifest') as typeof import('../../scripts/utils/goal-manifest');
    const build = manifests.buildGoalManifestFromInput;
    for (const mode of ['resign', 'expired_takeover', 'expired_same_fence'] as const) {
      const expired = mode !== 'resign', takeover = mode !== 'expired_same_fence';
      const root = setupGoalRuntimeHost('codex').root, runId = `receipt-${mode}`;
      const append = nodeFs.appendFileSync;
      let injected = false;
      try {
        if (expired) manifests.buildGoalManifestFromInput = (input, options) => build({ ...input,
          budget: { max_total_turns: 2, max_retries_per_phase: 1, wall_clock_minutes: 5 },
          unattended: { write_mode: 'full-access', approval_mode: 'never', max_turns: 20, timeout_seconds: 0.01 },
        }, options);
        try {
          await runGoalRuntimeChain(root, { adapter: 'codex', runId, freshEndPhase: 'spec', viaSessionStep: true,
            onSpec: () => {
              if (expired) execFileSync(process.execPath, ['-e', 'setTimeout(() => {}, 25)']);
              nodeFs.appendFileSync = ((...args: Parameters<typeof fs.appendFileSync>) => {
                if (!injected && path.basename(String(args[0])) === 'events.jsonl' && String(args[1]).includes('"type":"agent_invoke_end"')) {
                  injected = true; throw new Error('injected takeover receipt interruption');
                }
                return append(...args);
              }) as typeof fs.appendFileSync;
            },
          });
        } catch (error) { assert(String(error).includes('injected takeover receipt'), String(error)); }
        finally { nodeFs.appendFileSync = append; manifests.buildGoalManifestFromInput = build; }
        assert(injected, 'must interrupt after writing the real original archive');
        const manifest = loadGoalManifestFromRun(root, runId, { feature: 'bc-openCard' });
        const runDir = path.resolve(root, manifest.report_dir), original = readSessionExecution(runDir)!;
        const oldRequestPath = path.join(runDir, original.reference.path), oldRequestBytes = fs.readFileSync(oldRequestPath);
        const originalReport = path.join(path.dirname(oldRequestPath), fs.readdirSync(path.dirname(oldRequestPath)).find(file => file.startsWith('execution-report'))!);
        const originalReportBytes = fs.readFileSync(originalReport);
        if (takeover) releaseRunOwner(runDir, original.request.context.owner);
        const options = { projectRoot: root, frameworkRoot: path.resolve(__dirname, '../../..'), feature: 'bc-openCard', runId, adapter: 'codex', runMode: 'attended' };
        const next = await runGoalModeSessionStep({ ...options, ...(takeover ? { forceTakeover: true } : {}) });
        assert(next.type === 'phase_execute_request', JSON.stringify(next));
        const issued = readSessionExecution(runDir)!;
        if (!expired) {
          assert(issued.request.invoke_id === original.request.invoke_id && issued.request.context.owner.epoch === original.request.context.owner.epoch + 1, 'cooperative takeover re-signs the same attempt');
          assert(issued.request.issued_at === original.request.issued_at && issued.request.deadline === original.request.deadline, 're-sign cannot renew start or deadline');
          assert(JSON.stringify(issued.request.pre_snapshot) === JSON.stringify(original.request.pre_snapshot), 'takeover keeps the original write baseline');
        } else {
          const events = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
          const end = events.find(event => event.type === 'agent_invoke_end' && event.invoke_id === original.request.invoke_id);
          assert(end?.timed_out === true && end.kill_reason === 'agent_timeout' && end.duration_ms >= 10, JSON.stringify(end));
          assert(issued.request.invoke_id !== original.request.invoke_id && issued.request.context.owner.epoch > original.request.context.owner.epoch, 'an expired takeover closes first and then issues a new attempt');
          assert(events.filter(event => event.type === 'agent_invoke_start').length === 2, 'the original failed receipt remains part of the hard budget');
          if (!takeover) assert(end.status === 'passed' && end.handoff_report.request_sha256 === original.reference.sha256,
            'same-fence deadline closure retains the real saved report while marking it timed out, never as quality PASS');
        }
        const beforeEvents = fs.readFileSync(path.join(runDir, 'events.jsonl')), beforeControl = fs.readFileSync(path.join(runDir, 'run-control.json'));
        let rejected = false, oldResponse: Record<string, unknown> | undefined;
        try { oldResponse = await runGoalModeSessionStep({ ...options, requestPath: oldRequestPath, report: { status: 'passed', phase: 'spec' } }); }
        catch { rejected = true; }
        assert((takeover ? rejected : !rejected && oldResponse?.duplicate === true)
          && fs.readFileSync(path.join(runDir, 'events.jsonl')).equals(beforeEvents) && fs.readFileSync(path.join(runDir, 'run-control.json')).equals(beforeControl),
          'old unconsumed fences reject; an already-committed identical timeout report is only a read-only duplicate');
        assert(fs.readFileSync(oldRequestPath).equals(oldRequestBytes) && fs.readFileSync(originalReport).equals(originalReportBytes), 'old request and partial report remain immutable evidence');
        if (expired) {
          execFileSync(process.execPath, ['-e', 'setTimeout(() => {}, 25)']);
          const result = await runGoalModeSessionStep(options);
          assert(result.type === 'goal_session_result' && (result.result as { status: string }).status !== 'reconciled', 'timeouts cannot claim quality completion');
          const events = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
          assert(events.filter(event => event.type === 'agent_invoke_start').length === 2, 'expiry and takeover cannot reset or bypass the two-turn ceiling');
          assert(events.filter(event => event.type === 'agent_invoke_end').every(event => event.timed_out), 'only real timeout outcomes may close these windows');
          assert(!events.some(event => event.type === 'agent_process_settled'), 'timeout is not a process-settlement claim');
        } else {
          const resumed = await runGoalRuntimeChain(root, { adapter: 'codex', resume: runId, viaSessionStep: true, skipLegacySeal: true });
          const accepted = acceptedSessionReport(runDir, issued)!;
          assert(resumed.exitCode === 0 && accepted, JSON.stringify(resumed.events.filter(event => event.type === 'phase_halt' || event.type === 'run_end')));
          assert(path.join(runDir, accepted.event.handoff_report!.path) !== originalReport, 'the new epoch must not collide with the old partial archive');
          assert(resumed.events.filter(event => event.type === 'agent_invoke_start').length === 1 && resumed.events.filter(event => event.type === 'agent_invoke_end').length === 1, 're-sign and receipt retries count the original attempt exactly once');
        }
      } finally { nodeFs.appendFileSync = append; manifests.buildGoalManifestFromInput = build; fs.rmSync(root, { recursive: true, force: true }); }
    }
  },
}, {
  name: '1804 receipt replay preserves its original post-snapshot but still detects a later write across the original phase boundary',
  run: async () => {
    const root = setupGoalRuntimeHost('codex').root, runId = 'receipt-upstream-change';
    const nodeFs = require('fs') as typeof fs, append = nodeFs.appendFileSync;
    let injected = false;
    const acceptanceFile = resolveFeatureArtifact(root, 'bc-openCard', 'acceptance.yaml').actualPath;
    const originalAcceptance = fs.readFileSync(acceptanceFile);
    try {
      try {
        await runGoalRuntimeChain(root, { adapter: 'codex', runId, freshEndPhase: 'plan', viaSessionStep: true,
          onPlan: () => {
            fs.appendFileSync(resolveFeatureArtifact(root, 'bc-openCard', 'contracts.yaml').actualPath, '\n# original plan output\n');
            nodeFs.appendFileSync = ((...args: Parameters<typeof fs.appendFileSync>) => {
              if (!injected && path.basename(String(args[0])) === 'events.jsonl' && String(args[1]).includes('"type":"phase_write_observed"')
                && String(args[1]).includes('"phase":"plan"')) { append(...args); injected = true; throw new Error('injected plan receipt interruption'); }
              return append(...args);
            }) as typeof fs.appendFileSync;
          },
        });
      } catch (error) { assert(String(error).includes('injected plan receipt'), String(error)); }
      finally { nodeFs.appendFileSync = append; }
      assert(injected, 'must interrupt the real plan report after its archive write');
      const manifest = loadGoalManifestFromRun(root, runId, { feature: 'bc-openCard' });
      const runDir = path.resolve(root, manifest.report_dir), issued = readSessionExecution(runDir)!;
      const archiveDir = path.join(runDir, path.dirname(issued.reference.path));
      const archiveName = fs.readdirSync(archiveDir).find(file => file.startsWith('execution-report'));
      assert(archiveName, 'the immutable post/report must be saved before the observation is committed');
      const archiveFile = path.join(archiveDir, archiveName);
      const archiveBytes = fs.readFileSync(archiveFile);
      const changedAcceptance = Buffer.from('feature: bc-openCard\ncriteria:\n  - unapproved-change-after-receipt-archive\n');
      fs.writeFileSync(acceptanceFile, changedAcceptance);
      let ownerSawChange = false;
      const resumed = await runGoalRuntimeChain(root, { adapter: 'codex', resume: runId, viaSessionStep: true, skipLegacySeal: true,
        onSpec: () => { ownerSawChange = fs.readFileSync(acceptanceFile).equals(changedAcceptance); fs.writeFileSync(acceptanceFile, originalAcceptance); },
      });
      assert(fs.readFileSync(archiveFile).equals(archiveBytes), 'post-receipt collaboration cannot replace the original archived post');
      const violations = resumed.events.filter(event => event.type === 'phase_write_violation' && event.invoke_id === issued.request.invoke_id);
      assert(violations.some(event => JSON.stringify(event.violations).includes('acceptance.yaml')), JSON.stringify(resumed.events.filter(event => event.type === 'phase_halt' || event.type === 'phase_write_violation' || event.type === 'run_end')));
      assert(resumed.events.some(event => event.type === 'phase_backtrack_requested' && event.reason === 'phase_write_violation' && event.to_phase === 'spec'), 'the later write must return to the original spec owner');
      assert(resumed.invokedPhases.includes('spec'), 'an old report cannot bless the later upstream change');
      assert(ownerSawChange, 'the runtime must preserve the later change for its real owner, without silently rolling it back');
      assert(resumed.exitCode === 0, 'the responsible owner and normal gates must be able to recover');
      assert(resumed.events.filter(event => event.type === 'agent_invoke_end' && event.invoke_id === issued.request.invoke_id).length === 1, 'partial report replay commits once');
      assert(!resumed.events.some(event => event.type === 'agent_process_settled'), 'no process settlement may be fabricated');
    } finally { nodeFs.appendFileSync = append; fs.rmSync(root, { recursive: true, force: true }); }
  },
}, {
  name: '1804 production receipt I/O interruption preserves the pending owner and reuses an immutable report after artifacts change',
  run: async () => {
    const nodeFs = require('fs') as typeof fs;
    for (const cut of ['agent_invoke_end', 'archive_rename'] as const) {
      const root = setupGoalRuntimeHost('codex').root;
      const runId = `receipt-io-${cut}`;
      const append = nodeFs.appendFileSync, rename = nodeFs.renameSync;
      let injected = false, failure: unknown;
      try {
        try {
          await runGoalRuntimeChain(root, { adapter: 'codex', runId, freshEndPhase: 'spec', viaSessionStep: true,
            onSpec: () => {
              nodeFs.appendFileSync(path.join(root, 'doc/features/bc-openCard/spec/spec.md'), '\nOriginal executor output before report.\n');
              nodeFs.appendFileSync = ((...args: Parameters<typeof fs.appendFileSync>) => {
                if (cut === 'agent_invoke_end' && !injected && path.basename(String(args[0])) === 'events.jsonl'
                  && String(args[1]).includes('"type":"agent_invoke_end"')) {
                  injected = true; throw new Error('injected receipt event commit interruption');
                }
                return append(...args);
              }) as typeof fs.appendFileSync;
              nodeFs.renameSync = ((from: fs.PathLike, to: fs.PathLike) => {
                if (cut === 'archive_rename' && !injected && path.basename(String(to)).startsWith('execution-report')) {
                  injected = true; throw Object.assign(new Error('injected receipt rename EPERM'), { code: 'EPERM' });
                }
                return rename(from, to);
              }) as typeof fs.renameSync;
            },
          });
        } catch (error) { failure = error; }
        finally { nodeFs.appendFileSync = append; nodeFs.renameSync = rename; }
        assert(injected && String(failure).includes('injected receipt'), `the production report path must hit ${cut}: ${failure}`);
        const manifest = loadGoalManifestFromRun(root, runId, { feature: 'bc-openCard' });
        const runDir = path.resolve(root, manifest.report_dir), issued = readSessionExecution(runDir)!;
        const requestPath = path.join(runDir, issued.reference.path), requestBytes = fs.readFileSync(requestPath);
        assert(!acceptedSessionReport(runDir, issued), 'a failed event commit cannot count as an accepted report');
        const control = readRunControl(runDir, runId)!;
        assert(control.owner?.state === 'active' && control.current_epoch === issued.request.context.owner.epoch,
          `${cut}: an unaccepted current request must keep its original owner: ${JSON.stringify(control)}`);
        const reportDir = path.dirname(requestPath);
        assert(!fs.readdirSync(reportDir).some(file => file.endsWith('.tmp')), 'failed rename must clean only its own temporary material');
        const archiveName = fs.readdirSync(reportDir).find(file => file.startsWith('execution-report'));
        const originalArchive = archiveName ? fs.readFileSync(path.join(reportDir, archiveName)) : null;
        fs.appendFileSync(path.join(root, 'doc/features/bc-openCard/spec/spec.md'), '\nCollaboration changed the artifact after the interrupted report.\n');
        const resumed = await runGoalRuntimeChain(root, { adapter: 'codex', resume: runId, viaSessionStep: true, skipLegacySeal: true });
        const accepted = acceptedSessionReport(runDir, issued)!;
        assert(accepted && resumed.exitCode === 0, JSON.stringify(resumed.events.filter(event => event.type === 'phase_halt' || event.type === 'run_end')));
        assert(fs.readFileSync(requestPath).equals(requestBytes), 'report recovery cannot reissue or replace the original request');
        if (originalArchive) assert(fs.readFileSync(path.join(runDir, accepted.event.handoff_report!.path)).equals(originalArchive), 'receipt retry must retain the first archived post-snapshot and report bytes');
        assert(resumed.events.filter(event => event.type === 'agent_invoke_start').length === 1, 'I/O retry cannot reset or recount the original invocation');
        assert(resumed.events.filter(event => event.type === 'agent_invoke_end').length === 1, 'the report commits once');
        assert(resumed.harnessPhases.join(',') === 'spec', 'only the accepted report may enter one formal gate');
        assert(!resumed.events.some(event => event.type === 'agent_process_settled'), 'receipt recovery cannot invent process settlement');
      } finally { nodeFs.appendFileSync = append; nodeFs.renameSync = rename; fs.rmSync(root, { recursive: true, force: true }); }
    }
  },
}, {
  name: '1804 detached empty process output still uses the CLI no-output failure policy',
  run: async () => {
    const root = setupGoalRuntimeHost('codex').root;
    try {
      const probe = await runGoalRuntimeChain(root, { adapter: 'codex', runId: 'detached-empty-failure', freshEndPhase: 'spec',
        invokeResultFor: () => ({ exitCode: 1, duration_ms: 10000, stdout: '', stderr: '' }),
        onHarnessSummary: () => ({ checks: [{ id: 'acceptance_content_complete', category: 'structure', severity: 'BLOCKER', status: 'FAIL',
          description: 'the formal checker rejects incomplete output', details: 'The acceptance definition remains incomplete.', failure_kind: 'code_regression' }] }),
      });
      const verdict = probe.events.find(event => event.type === 'phase_verdict' && event.phase === 'spec');
      assert(verdict?.failure_kind_classified === 'agent_no_output', JSON.stringify(verdict));
      assert(probe.exitCode !== 0 && probe.invokedPhases.length === 1, 'a genuinely empty failed CLI process must retain its stop policy');
      assert(!probe.events.some(event => event.handoff_report), 'this control uses the detached process transport');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  },
}, {
  name: '1804 an elapsed session failed report without details follows the formal regression and retries without CLI no-output classification',
  run: async () => {
    const root = setupGoalRuntimeHost('codex').root;
    try {
      const probe = await runGoalRuntimeChain(root, { adapter: 'codex', runId: 'stepwise-elapsed-failure', freshEndPhase: 'spec', viaSessionStep: true,
        failExecutorFor: (phase, attempt) => phase === 'spec' && attempt === 1,
        onSpec: ctx => { if (ctx.attempt === 1) execFileSync(process.execPath, ['-e', 'setTimeout(() => {}, 10000)']); },
        onHarnessSummary: ({ phase, attempt }) => phase === 'spec' && attempt === 1 ? { checks: [{
          id: 'acceptance_content_complete', category: 'structure', severity: 'BLOCKER', status: 'FAIL',
          description: 'the first model output has an incomplete acceptance definition', failure_kind: 'code_regression',
          details: 'The formal checker rejects the incomplete acceptance definition.',
        }] } : null,
      });
      const end = probe.events.find(event => event.type === 'agent_invoke_end' && event.phase === 'spec');
      assert(end?.status === 'failed' && end.exit_code === 1 && Number(end.duration_ms) >= 10000 && Number(end.duration_ms) < 30000, JSON.stringify(end));
      const archived = JSON.parse(fs.readFileSync(path.join(probe.reportDir, (end!.handoff_report as { path: string }).path), 'utf8'));
      assert(archived.report.details === undefined, 'a failed report does not require prose details to prove execution');
      const processLog = path.join(probe.reportDir, 'phases/spec/agent-output.log');
      assert(!fs.existsSync(processLog) || fs.statSync(processLog).size === 0, 'the session has no native CLI output');
      const verdict = probe.events.find(event => event.type === 'phase_verdict' && event.phase === 'spec');
      assert(verdict?.verdict === 'FAIL' && verdict.failure_kind_classified === 'code_regression', JSON.stringify({ verdict, terminal: probe.events.slice(-12), log: fs.readFileSync(path.join(probe.reportDir, 'session-control.log'), 'utf8').slice(-3000) }));
      assert(!probe.events.some(event => event.failure_kind_classified === 'agent_no_output' || event.halt_reason === 'agent_no_output'), 'session reports must not inherit a native CLI empty-output heuristic');
      assert(probe.invokedPhases.filter(phase => phase === 'spec').length === 2, 'the formal failure must return to the actual executor');
      assert(probe.harnessPhases.filter(phase => phase === 'spec').length === 2 && probe.exitCode === 0, 'the retry must pass the real runtime gate/finalizer');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  },
}, {
  name: '1804 executor failure remains an execution fact while the formal gate independently judges quality',
  run: async () => {
    const root = setupGoalRuntimeHost('codex').root;
    try {
      const probe = await runGoalRuntimeChain(root, { adapter: 'codex', runId: 'stepwise-failed-report', freshEndPhase: 'ut', viaSessionStep: true,
        failExecutorFor: (phase, attempt) => phase === 'spec' && attempt === 1 });
      const first = probe.events.find(event => event.type === 'phase_verdict' && event.phase === 'spec');
      assert(first?.agent_failed === true, JSON.stringify(first));
      assert(probe.events.some(event => event.type === 'agent_invoke_end' && event.phase === 'spec' && event.status === 'failed'), 'the original failed report must remain archived');
      assert(probe.harnessPhases.includes('spec'), 'a report cannot substitute for the formal quality gate');
      assert(probe.exitCode === 0, JSON.stringify(probe.events.filter(event => event.type === 'run_end')));
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  },
}, {
  name: '1804 nonresident requests share runtime gate, ownership and finalizer',
  run: async () => {
    const root = setupGoalRuntimeHost('codex').root;
    try {
      const probe = await runGoalRuntimeChain(root, { adapter: 'codex', runId: 'stepwise-parity', freshEndPhase: 'ut', viaSessionStep: true });
      assert(probe.exitCode === 0, JSON.stringify(probe.events.filter(e => e.type === 'phase_halt' || e.type === 'run_end')));
      const starts = probe.events.filter(e => e.type === 'agent_invoke_start');
      const reports = probe.events.filter(e => e.type === 'agent_invoke_end' && e.handoff_report);
      assert(starts.length === reports.length && starts.length > 0, JSON.stringify({starts, reports}));
      assert(!probe.events.some(e => e.type === 'agent_process_settled'), 'session must not manufacture process settled');
      assert(probe.harnessPhases.length >= reports.length, JSON.stringify(probe.harnessPhases));
      assert(readRunControl(probe.reportDir)?.owner?.state === 'released', 'terminal session owner releases');
    } finally { fs.rmSync(root, {recursive:true,force:true}); }
  },
}, {
    // V7（plan 3a7f9c12 D2.5）：goal 失败回喂必须把"写完报告即回传"讲清楚——
    // 少了这段，agent 只看到一串 blocker 就去改产品（这些失败恰恰要先由 verifier
    // 逐条确认），或为了拿候选自己再跑一次 harness（外层马上还要跑一次，纯重复）。
    name: 'D1 repair diagnosis feedback: deliver request, write report, return without re-running harness',
    run: () => {
      const feed = extractPriorFailureContext({
        verdict: 'FAIL',
        next_action: 'run_verifier_for_repair',
        verifier_request: 'doc/features/f1/review/reports/verifier.request.abc.json',
        verifier_report: 'doc/features/f1/review/reports/verifier.report.abc.md',
        blockers: [{ id: 'negative_verdict_closure', details_excerpt: '审查结论=「不通过」' }],
      });
      assert(feed.includes('run_verifier_for_repair'), feed);
      assert(feed.includes('verifier.request.abc.json'), `must name the request path: ${feed}`);
      assert(feed.includes('verifier.report.abc.md'), `must name the report path: ${feed}`);
      assert(/Do NOT edit product code yet/.test(feed), `must hold off on product edits: ${feed}`);
      assert(/Do NOT re-run the harness yourself/.test(feed), `must not ask the agent to re-run: ${feed}`);
      assert(
        feed.replace(/\s+/g, ' ').includes('do NOT wait for candidates or closure before returning'),
        `must not require candidates/closure before returning: ${feed}`,
      );
      // 常规 FAIL 一字不变（没有 next_action 就不该冒出诊断段落）
      const plain = extractPriorFailureContext({
        verdict: 'FAIL',
        next_action: 'fix_blockers_then_rerun',
        blockers: [{ id: 'demo_fail', details_excerpt: 'x' }],
      });
      assert(!plain.includes('run_verifier_for_repair'), plain);
    },
  },
  {
    name: 'P2-T1 fresh facts-baseline early summary uses deterministic guidance, never code-regression revert',
    run: async () => {
      const root = setupGoalRuntimeHost('codex').root;
      try {
        const probe = await runGoalRuntimeChain(root, {
          adapter: 'codex', runId: 'fresh-facts-baseline-ut', freshEndPhase: 'ut',
          onHarnessSummary: ({ phase }) => phase === 'ut'
            ? { checks: [{
                id: 'capability_resolution_contract', category: 'structure' as const,
                description: 'feature capability contract resolves before checker execution',
                severity: 'BLOCKER' as const, status: 'FAIL' as const,
                details: 'facts baseline stale: return to plan before UT',
                suggestion: 'return to the establishing phase and rebuild current facts',
              }] }
            : null,
        });
        const verdict = probe.events.find(event => event.type === 'phase_verdict' && event.phase === 'ut');
        assert(verdict?.stale_summary === false, JSON.stringify(verdict));
        assert(verdict?.failure_kind_classified === 'deterministic_gate_or_artifact_missing', JSON.stringify(verdict));
        assert(verdict?.blocker_signature === 'capability_resolution_contract', JSON.stringify(verdict));
        assert(probe.utPrompts.length >= 2, `expected retry prompt: ${probe.utPrompts.length}`);
        assert(probe.utPrompts[1].includes('facts baseline stale'), probe.utPrompts[1]);
        assert(!probe.utPrompts[1].includes('revert that change first'), probe.utPrompts[1]);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'P2-T2 first nonzero harness exit without any summary is current execution failure, not timeout',
    run: async () => {
      const root = setupGoalRuntimeHost('codex').root;
      try {
        const probe = await runGoalRuntimeChain(root, {
          adapter: 'codex', runId: 'absent-summary-ut', freshEndPhase: 'ut',
          onHarnessFailureWithoutSummary: ({ phase, attempt }) => phase === 'ut'
            ? `${'progress before fatal '.repeat(30)}\nCURRENT_NO_SUMMARY_${attempt}: writer failed`
            : null,
        });
        const verdict = probe.events.find(event => event.type === 'phase_verdict' && event.phase === 'ut');
        assert(verdict?.stale_summary === false, JSON.stringify(verdict));
        assert(verdict?.failure_kind_classified === 'deterministic_gate_or_artifact_missing', JSON.stringify(verdict));
        assert(verdict?.blocker_signature !== 'agent_timeout@ut', JSON.stringify(verdict));
        assert(String(verdict?.harness_error_excerpt).includes('CURRENT_NO_SUMMARY_1'), JSON.stringify(verdict));
        assert(!String(verdict?.harness_error_excerpt).includes('\n'), 'event diagnostic must remain one line');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'P2-T1/T4 stale content report never drives three current UT preflight failures',
    run: async () => {
      const root = setupGoalRuntimeHost('codex').root;
      try {
        seedUtFailureSummary(root, [{
          id: 'ut_hvigor_build', severity: 'BLOCKER', status: 'FAIL',
          classification: 'code_regression', details_excerpt: 'OLD_COMPILE_ERROR',
        }]);
        const probe = await runGoalRuntimeChain(root, {
          adapter: 'codex', runId: 'stale-ut-three', freshEndPhase: 'ut',
          onHarnessFailureWithoutSummary: ({ phase, attempt }) =>
            phase === 'ut' ? `CURRENT_PREFLIGHT_${attempt}: facts baseline stale` : null,
        });
        const verdicts = probe.events.filter(event => event.type === 'phase_verdict' && event.phase === 'ut');
        assert(verdicts.length === 3, `expected three stale UT attempts: ${JSON.stringify(verdicts)}`);
        for (const [index, event] of verdicts.entries()) {
          assert(event.stale_summary === true, `attempt ${index + 1} not stale`);
          assert(event.failure_kind_classified === 'deterministic_gate_or_artifact_missing', JSON.stringify(event));
          assert(!event.blocker_signature, `old signature leaked: ${JSON.stringify(event)}`);
          assert(String(event.harness_error_excerpt).includes(`CURRENT_PREFLIGHT_${index + 1}`), JSON.stringify(event));
          assert(!JSON.stringify(event).includes('ut_hvigor_build'), `old blocker leaked: ${JSON.stringify(event)}`);
        }
        for (const prompt of probe.utPrompts.slice(1)) {
          assert(prompt.includes('CURRENT_PREFLIGHT_'), `current failure missing from retry prompt: ${prompt}`);
          assert(!prompt.includes('OLD_COMPILE_ERROR') && !prompt.includes('ut_hvigor_build'), `old summary drove retry: ${prompt}`);
        }
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'P2-T2/T4 fresh UT failure stays actionable while two later stale failures use current diagnostics',
    run: async () => {
      const root = setupGoalRuntimeHost('codex').root;
      try {
        const oldIds = ['boundaries_all_stubbed', 'ut_hvigor_build', 'ut_hvigor_test'];
        const probe = await runGoalRuntimeChain(root, {
          adapter: 'codex', runId: 'fresh-then-stale-ut', freshEndPhase: 'ut',
          onHarnessSummary: ({ phase, attempt }) => phase === 'ut' && attempt === 1
            ? { blockers: oldIds.map(id => ({
                id, severity: 'BLOCKER', status: 'FAIL', classification: 'code_regression',
                details_excerpt: `FRESH_COMPILE_${id}`,
              })) }
            : null,
          onHarnessFailureWithoutSummary: ({ phase, attempt }) =>
            phase === 'ut' && attempt > 1 ? `CURRENT_BINDING_${attempt}: input binding stale` : null,
        });
        const verdicts = probe.events.filter(event => event.type === 'phase_verdict' && event.phase === 'ut');
        assert(verdicts.length === 3, `expected fresh + two stale attempts: ${JSON.stringify(verdicts)}`);
        assert(verdicts[0].stale_summary === false, JSON.stringify(verdicts[0]));
        assert(verdicts[0].failure_kind_classified === 'code_regression', JSON.stringify(verdicts[0]));
        assert(oldIds.every(id => String(verdicts[0].blocker_signature).includes(id)), JSON.stringify(verdicts[0]));
        for (const [offset, event] of verdicts.slice(1).entries()) {
          assert(event.stale_summary === true, JSON.stringify(event));
          assert(event.failure_kind_classified === 'deterministic_gate_or_artifact_missing', JSON.stringify(event));
          assert(!event.blocker_signature, `fresh signature leaked into stale attempt: ${JSON.stringify(event)}`);
          assert(String(event.harness_error_excerpt).includes(`CURRENT_BINDING_${offset + 2}`), JSON.stringify(event));
        }
        assert(probe.utPrompts[1].includes('FRESH_COMPILE_'), 'first retry must consume the fresh failure');
        assert(probe.utPrompts[2].includes('CURRENT_BINDING_2'), 'second retry must consume the current stale-attempt diagnostic');
        assert(!oldIds.some(id => probe.utPrompts[2].includes(id)), `old signature drove later retry: ${probe.utPrompts[2]}`);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'M2 structural zero: thin shells and executors contain no private lifecycle or gate path',
    run: () => {
      const scripts = path.resolve(__dirname, '../../scripts');
      const runnerShell = fs.readFileSync(path.join(scripts, 'goal-runner.ts'), 'utf-8');
      const driverShell = fs.readFileSync(path.join(scripts, 'utils/goal-in-session-driver.ts'), 'utf-8');
      const hostEntry = fs.readFileSync(path.join(scripts, 'goal-mode-entry.ts'), 'utf-8');
      const executor = fs.readFileSync(path.join(scripts, 'utils/goal-phase-executor.ts'), 'utf-8');
      const processRuntime = fs.readFileSync(path.join(scripts, 'goal-phase-runtime.ts'), 'utf-8');
      const supervisor = fs.readFileSync(path.join(scripts, 'goal-supervise.ts'), 'utf-8');
      assert(!/while\s*\(|for\s*\([^)]*phase/.test(runnerShell), 'goal-runner shell retained a phase loop');
      assert(!/assessFeature|runHarnessPhase|phase_verdict/.test(runnerShell), 'goal-runner shell retained lifecycle ownership');
      assert(!/assessFeature|runHarnessPhase|phase_verdict|for\s*\(|while\s*\(/.test(driverShell),
        'compatibility driver retained private progression');
      assert(!/for\s*\(let round|runInSessionRound|assessFeature/.test(hostEntry),
        'attended host entry retained independent progression');
      assert(!/runHarnessPhase|assessFeature|phase_verdict|writeReceiptScaffold/.test(executor),
        'executor owns a gate or lifecycle transition');
      assert((processRuntime.match(/while\s*\(!phaseDone\)/g) ?? []).length === 1,
        'detached runtime must contain exactly one canonical phase-attempt loop');
      assert(processRuntime.includes('GoalPhaseRuntime') && processRuntime.includes('DetachedGoalPhaseExecutor'),
        'detached runtime is not wired through the shared runtime/executor boundary');
      assert(!executor.includes('--rebaseline-to') && !supervisor.includes('--rebaseline-to'),
        'executor or supervisor can construct management rebaseline');
    },
  },
  {
    name: 'M2 production parity: attended/detached fresh and retry run the same birth/runtime/gate/projection chain',
    run: async () => {
      const base = setupGoalRuntimeHost('codex').root;
      const roots: string[] = [base];
      try {
        for (const lifecycle of ['fresh', 'retry'] as const) {
          const detachedRoot = cloneHost(base, `${lifecycle}-detached`);
          const attendedRoot = cloneHost(base, `${lifecycle}-attended`);
          roots.push(detachedRoot, attendedRoot);
          const retrySummary = lifecycle === 'retry'
            ? ({ phase, attempt }: { phase: string; attempt: number }) =>
                phase === 'coding' && attempt === 1
                  ? { blockers: [{
                      id: 'file_completeness',
                      severity: 'BLOCKER',
                      status: 'FAIL',
                      classification: 'code_regression',
                      details_excerpt: '契约声明文件缺失',
                      actionability: 'agent_fixable',
                    }] }
                  : null
            : undefined;
          const detached = await runGoalRuntimeChain(detachedRoot, {
            adapter: 'codex', runId: `matrix-${lifecycle}`,
            executorMode: 'detached', onHarnessSummary: retrySummary,
          });
          const attended = await runGoalRuntimeChain(attendedRoot, {
            adapter: 'codex', runId: `matrix-${lifecycle}`,
            executorMode: 'attended', onHarnessSummary: retrySummary,
          });
          assert(detached.exitCode === 0 && attended.exitCode === 0,
            `${lifecycle} did not close: detached=${detached.exitCode} attended=${attended.exitCode}`);
          assert(JSON.stringify(canonicalOf(detached)) === JSON.stringify(canonicalOf(attended)),
            `${lifecycle} canonical projection drift`);
          assert(JSON.stringify(detached.harnessPhases) === JSON.stringify(attended.harnessPhases),
            `${lifecycle} gate sequence drift`);
          if (lifecycle === 'retry') {
            assert(detached.invokedPhases.filter(phase => phase === 'coding').length === 2,
              `retry did not reinvoke coding: ${detached.invokedPhases.join('→')}`);
          }
          assert(canonicalOf(attended)[0]?.type === 'run_created', `${lifecycle} lost birth`);
        }
      } finally {
        for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'M2 executor contract: PhaseExecutionContext is deeply immutable and provider-private fields are absent',
    run: () => {
      const ctx = context();
      assert(Object.isFrozen(ctx), 'context must be frozen');
      assert(Object.isFrozen(ctx.chain), 'chain must be frozen');
      assert(Object.isFrozen(ctx.owner), 'owner must be frozen');
      assert(Object.isFrozen(ctx.runtimeFacts), 'runtime facts must be frozen');
      assert(Object.isFrozen(ctx.childEnv), 'child env must be frozen');
      const serialized = JSON.stringify(ctx).toLowerCase();
      for (const field of PHASE_EXECUTION_CONTEXT_FORBIDDEN_FIELDS) {
        assert(!serialized.includes(field), `provider-private field leaked: ${field}`);
      }
      const scrubbed = context({ childEnv: { HARNESS_DIFF_BASE_REF: 'attacker', KEEP: 'yes' } });
      assert(!('HARNESS_DIFF_BASE_REF' in scrubbed.childEnv), 'goal baseline env override was not scrubbed');
      assert(scrubbed.childEnv.KEEP === 'yes', 'unrelated child env changed');
    },
  },
  {
    name: 'M1 production resume keeps the birth phase chain after workflow auto_chain changes',
    run: async () => {
      const root = setupGoalRuntimeHost('codex').root;
      try {
        const blocker = {
          id: 'file_completeness',
          severity: 'BLOCKER',
          status: 'FAIL',
          classification: 'code_regression',
          details_excerpt: 'freeze chain fixture',
          actionability: 'agent_fixable',
        };
        const halted = await runGoalRuntimeChain(root, {
          adapter: 'codex',
          runId: 'frozen-chain-resume',
          onHarnessSummary: ({ phase }) => phase === 'plan' ? { blockers: [blocker] } : null,
        });
        assert(halted.exitCode === 1, `fixture did not halt: ${halted.exitCode}`);
        const manifestBefore = loadGoalManifestFromRun(root, 'frozen-chain-resume', { feature: 'bc-openCard' });
        assert(manifestBefore.phase_chain?.join(',') === 'spec,plan,coding,review,ut,testing',
          `birth chain=${manifestBefore.phase_chain?.join(',')}`);

        const eventsPath = path.join(halted.reportDir, 'events.jsonl');
        fs.writeFileSync(eventsPath, fs.readFileSync(eventsPath, 'utf8').split('\n').map((line) => {
          if (!line.trim()) return line;
          const event = JSON.parse(line) as { type?: string; ts?: string };
          if (event.type === 'run_end' && event.ts) {
            event.ts = new Date(Date.parse(event.ts) - 10 * 60_000).toISOString();
          }
          return JSON.stringify(event);
        }).join('\n'), 'utf8');
        const resumed = await runGoalRuntimeChain(root, {
          resume: 'frozen-chain-resume', forceResume: true, adapter: 'codex',
          workflowTransform: workflow => ({
            ...workflow,
            auto_chain: ['spec', 'plan', 'coding', 'ut', 'review', 'testing'],
          }),
        });
        assert(resumed.exitCode === 0, `resume exit=${resumed.exitCode}`);
        assert(resumed.invokedPhases.indexOf('review') >= 0 &&
          resumed.invokedPhases.indexOf('review') < resumed.invokedPhases.indexOf('ut'),
        `workflow drift replaced/reordered birth chain: ${resumed.invokedPhases.join('→')}`);
        const manifestAfter = loadGoalManifestFromRun(root, 'frozen-chain-resume', { feature: 'bc-openCard' });
        assert(JSON.stringify(manifestAfter.phase_chain) === JSON.stringify(manifestBefore.phase_chain),
          'resume rewrote frozen phase chain');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'M2 production parity: attended/detached resume and automatic successor preserve lifecycle and lineage baseline',
    run: async () => {
      const base = setupGoalRuntimeHost('codex').root;
      const roots: string[] = [base];
      const blocker = {
        id: 'file_completeness',
        severity: 'BLOCKER',
        status: 'FAIL',
        classification: 'code_regression',
        details_excerpt: '契约声明文件缺失',
        actionability: 'agent_fixable',
      };
      try {
        const halted = await runGoalRuntimeChain(base, {
          adapter: 'codex', runId: 'matrix-resume', executorMode: 'detached',
          onHarnessSummary: ({ phase }) => phase === 'coding' ? { blockers: [blocker] } : null,
        });
        assert(halted.exitCode === 1, `resume fixture did not halt: ${halted.exitCode}`);
        const eventsPath = path.join(halted.reportDir, 'events.jsonl');
        const aged = fs.readFileSync(eventsPath, 'utf8').split('\n').map((line) => {
          if (!line.trim()) return line;
          const event = JSON.parse(line) as { type?: string; ts?: string };
          if (event.type === 'run_end' && event.ts) {
            event.ts = new Date(Date.parse(event.ts) - 10 * 60_000).toISOString();
          }
          return JSON.stringify(event);
        }).join('\n');
        fs.writeFileSync(eventsPath, aged, 'utf8');
        const sourceManifest = loadGoalManifestFromRun(base, 'matrix-resume', { feature: 'bc-openCard' });

        const detachedResumeRoot = cloneHost(base, 'resume-detached');
        const attendedResumeRoot = cloneHost(base, 'resume-attended');
        roots.push(detachedResumeRoot, attendedResumeRoot);
        const detachedResume = await runGoalRuntimeChain(detachedResumeRoot, {
          resume: 'matrix-resume', forceResume: true, adapter: 'codex', executorMode: 'detached',
        });
        const attendedResume = await runGoalRuntimeChain(attendedResumeRoot, {
          resume: 'matrix-resume', forceResume: true, adapter: 'codex', executorMode: 'attended',
        });
        assert(detachedResume.exitCode === 0 && attendedResume.exitCode === 0,
          `resume did not close: detached=${detachedResume.exitCode} attended=${attendedResume.exitCode}`);
        assert(JSON.stringify(canonicalOf(detachedResume)) === JSON.stringify(canonicalOf(attendedResume)),
          'resume canonical projection drift');
        assert(JSON.stringify(detachedResume.harnessPhases) === JSON.stringify(attendedResume.harnessPhases),
          'resume gate sequence drift');
        assert(
          loadGoalManifestFromRun(detachedResumeRoot, 'matrix-resume', { feature: 'bc-openCard' }).run_base_sha ===
            sourceManifest.run_base_sha &&
          loadGoalManifestFromRun(attendedResumeRoot, 'matrix-resume', { feature: 'bc-openCard' }).run_base_sha ===
            sourceManifest.run_base_sha,
          'resume changed immutable birth baseline',
        );

        const detachedSuccessorRoot = cloneHost(base, 'successor-detached');
        const attendedSuccessorRoot = cloneHost(base, 'successor-attended');
        roots.push(detachedSuccessorRoot, attendedSuccessorRoot);
        const detachedSuccessor = await runGoalRuntimeChain(detachedSuccessorRoot, {
          adapter: 'codex', runId: 'matrix-successor', executorMode: 'detached',
          supersede: ['matrix-resume'],
        });
        const attendedSuccessor = await runGoalRuntimeChain(attendedSuccessorRoot, {
          adapter: 'codex', runId: 'matrix-successor', executorMode: 'attended',
          supersede: ['matrix-resume'],
        });
        assert(detachedSuccessor.exitCode === 0 && attendedSuccessor.exitCode === 0,
          `successor did not close: detached=${detachedSuccessor.exitCode} attended=${attendedSuccessor.exitCode}`);
        assert(JSON.stringify(canonicalOf(detachedSuccessor)) === JSON.stringify(canonicalOf(attendedSuccessor)),
          'successor canonical projection drift');
        assert(JSON.stringify(detachedSuccessor.harnessPhases) === JSON.stringify(attendedSuccessor.harnessPhases),
          'successor gate sequence drift');
        const detachedSuccessorManifest = loadGoalManifestFromRun(
          detachedSuccessorRoot, 'matrix-successor', { feature: 'bc-openCard' },
        );
        const attendedSuccessorManifest = loadGoalManifestFromRun(
          attendedSuccessorRoot, 'matrix-successor', { feature: 'bc-openCard' },
        );
        assert(detachedSuccessorManifest.successor_of === 'matrix-resume' &&
          attendedSuccessorManifest.successor_of === 'matrix-resume', 'successor lineage missing');
        assert(detachedSuccessorManifest.run_base_sha === sourceManifest.run_base_sha &&
          attendedSuccessorManifest.run_base_sha === sourceManifest.run_base_sha,
        'successor washed out ancestor baseline');
      } finally {
        for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'M2 runtime precondition: missing immutable baseline stops before executor without agent retry',
    run: async () => {
      let invoked = false;
      const executor = new AttendedGoalPhaseExecutor(async (ctx) => {
        invoked = true;
        return { status: 'passed', phase: ctx.phase };
      });
      let error = '';
      try {
        await new GoalPhaseRuntime().executeExecutor(context({
          owner: { run_id: 'run-1', owner_id: 'dry-run', epoch: 0, kind: 'session' },
          runtimeFacts: { receiptRequired: true, resume: false, successor: false },
        }), executor);
      } catch (caught) {
        error = (caught as Error).message;
      }
      assert(error.includes('framework_corruption') && error.includes('run_base_sha'), error);
      assert(!invoked, 'runtime-owned fact failure must not be fed back to the agent');
    },
  },
  {
    name: 'M2 attended protocol has one host entry and runtime rejects missing injected executor',
    run: async () => {
      const code = await new GoalPhaseRuntime({
        args: [
          '--runtime-executor', 'attended',
          '--runtime-owner', 'session',
        ],
        ownerKind: 'session',
      }).run();
      assert(code === 1, `runtime accepted implicit attended stdio executor: ${code}`);
    },
  },
  {
    name: 'M2 production handoff parity: session→process and process→session resume through the same fenced runtime',
    run: async () => {
      const base = setupGoalRuntimeHost('codex').root;
      const sessionToProcessRoot = cloneHost(base, 'handoff-session-process');
      const processToSessionRoot = cloneHost(base, 'handoff-process-session');
      const roots = [base, sessionToProcessRoot, processToSessionRoot];
      try {
        const executeTransfer = async (
          root: string,
          runId: string,
          from: 'session' | 'process',
          to: 'session' | 'process',
        ): Promise<{ first: RunProbe; resumed: RunProbe }> => {
          let requestId = '';
          const first = await runGoalRuntimeChain(root, {
            adapter: 'codex',
            runId,
            executorMode: from === 'session' ? 'attended' : 'detached',
            viaHostBridge: from === 'session',
            afterHarnessPass: ({ phase, runId: activeRunId }) => {
              if (phase !== 'spec' || requestId) return;
              const manifest = loadGoalManifestFromRun(root, activeRunId, { feature: 'bc-openCard' });
              const runDir = path.resolve(root, manifest.report_dir);
              const control = readRunControl(runDir, activeRunId);
              assert(control?.owner?.kind === from && control.owner.state === 'active',
                `production ${from} owner missing at boundary`);
              requestId = writeHandoffRequest(runDir, {
                run_id: activeRunId,
                from_epoch: control.current_epoch,
                target_owner_kind: to,
              }).request_id;
            },
          });
          assert(first.exitCode === 0 && requestId, `${from} source did not publish/consume handoff`);
          assert(first.events.some(event =>
            event.type === 'handoff_requested' && event.request_id === requestId),
          `${from} source runtime did not emit handoff_requested`);
          const resumed = await runGoalRuntimeChain(root, {
            resume: runId,
            adapter: 'codex',
            executorMode: to === 'session' ? 'attended' : 'detached',
            viaHostBridge: to === 'session',
          });
          return { first, resumed };
        };

        const sessionToProcess = await executeTransfer(
          sessionToProcessRoot, 'matrix-handoff', 'session', 'process',
        );
        const processToSession = await executeTransfer(
          processToSessionRoot, 'matrix-handoff', 'process', 'session',
        );
        const toProcess = sessionToProcess.resumed;
        const toSession = processToSession.resumed;
        assert(toProcess.exitCode === 0 && toSession.exitCode === 0,
          `handoff targets did not close: process=${toProcess.exitCode} session=${toSession.exitCode}`);
        const processProjection = canonicalOf(toProcess);
        const sessionProjection = canonicalOf(toSession);
        assert(JSON.stringify(processProjection).includes('"from":"session","to":"process","outcome":"success"'),
          'session→process canonical handoff missing');
        assert(JSON.stringify(sessionProjection).includes('"from":"process","to":"session","outcome":"success"'),
          'process→session canonical handoff missing');
        assert(processProjection.filter(event => event.type === 'owner_handoff').length === 1 &&
          sessionProjection.filter(event => event.type === 'owner_handoff').length === 1,
        'handoff projected more than once');
        assert(JSON.stringify(processProjection.filter(event => event.type !== 'owner_handoff')) ===
          JSON.stringify(sessionProjection.filter(event => event.type !== 'owner_handoff')),
        `handoff modes drifted outside direction\nprocess=${JSON.stringify(processProjection)}\n` +
          `session=${JSON.stringify(sessionProjection)}`);
        const processGates = [...sessionToProcess.first.harnessPhases, ...toProcess.harnessPhases];
        const sessionGates = [...processToSession.first.harnessPhases, ...toSession.harnessPhases];
        assert(JSON.stringify(processGates) === JSON.stringify(sessionGates),
          'handoff gate sequence drift');
      } finally {
        for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'M5 incident closure: legacy HALTED acafa0 can start an audited rebaseline successor in both modes',
    run: async () => {
      const base = setupGoalRuntimeHost('codex').root;
      const roots: string[] = [base];
      try {
        const legacy = buildGoalManifestFromInput({
          feature: 'bc-openCard',
          run_id: 'acafa0',
          requirement: '历史 attended 事故占位者',
          start_phase: 'spec',
          end_phase: 'testing',
          adapter: 'codex',
          unattended: { write_mode: 'full-access', approval_mode: 'never' },
        }, { projectRoot: base });
        const legacyManifestPath = writeGoalManifest(legacy, base);
        const legacyEventsPath = path.join(path.dirname(legacyManifestPath), 'events.jsonl');
        fs.writeFileSync(legacyEventsPath, [
          JSON.stringify({
            type: 'run_start',
            ts: '2026-08-27T00:00:00.000Z',
            manifest_identity_fields: { feature: 'bc-openCard' },
          }),
          JSON.stringify({
            type: 'run_end',
            ts: '2026-08-27T00:01:00.000Z',
            status: 'HALTED',
            halt_reason: 'ui_scope_base_missing',
          }),
        ].join('\n') + '\n', 'utf8');
        const unresolved = resolveGoalRunBaseline(base, 'bc-openCard', 'acafa0');
        assert(!unresolved.available, 'incident source unexpectedly has a trusted legacy baseline');
        const head = resolveGoalRunHeadSha(base);

        const detachedRoot = cloneHost(base, 'incident-rebaseline-detached');
        const attendedRoot = cloneHost(base, 'incident-rebaseline-attended');
        roots.push(detachedRoot, attendedRoot);
        const detachedSourceBytes = fs.readFileSync(
          path.join(detachedRoot, legacy.report_dir, 'events.jsonl'), 'utf8');
        const attendedSourceBytes = fs.readFileSync(
          path.join(attendedRoot, legacy.report_dir, 'events.jsonl'), 'utf8');

        const detached = await runGoalRuntimeChain(detachedRoot, {
          adapter: 'codex',
          executorMode: 'detached',
          runId: 'incident-rebaseline',
          supersede: ['acafa0'],
          rebaselineTo: head,
          freshRequirement: '按当前 HEAD 重建问责边界并继续',
        });
        const attended = await runGoalRuntimeChain(attendedRoot, {
          adapter: 'codex',
          executorMode: 'attended',
          runId: 'incident-rebaseline',
          supersede: ['acafa0'],
          rebaselineTo: head,
          freshRequirement: '按当前 HEAD 重建问责边界并继续',
        });

        assert(detached.exitCode === 0 && attended.exitCode === 0,
          `rebaseline successor did not start/close: detached=${detached.exitCode} attended=${attended.exitCode}`);
        assert(JSON.stringify(canonicalOf(detached)) === JSON.stringify(canonicalOf(attended)),
          'incident canonical projection drift');
        assert(JSON.stringify(detached.harnessPhases) === JSON.stringify(attended.harnessPhases),
          'incident gate sequence drift');
        for (const [root, probe] of [[detachedRoot, detached], [attendedRoot, attended]] as const) {
          const manifest = loadGoalManifestFromRun(root, 'incident-rebaseline', { feature: 'bc-openCard' });
          assert(manifest.successor_of === 'acafa0', 'incident successor lineage missing');
          assert(manifest.run_base_sha === head, 'operator-supplied exact HEAD was not frozen');
          const created = probe.events.find(event => event.type === 'run_created');
          const supersede = probe.events.find(event => event.type === 'supersede');
          assert(created?.rebaseline_from_run_id === 'acafa0', 'run_created lacks rebaseline source audit');
          assert(supersede?.target_run_id === 'acafa0' && supersede?.rebaseline_to === head,
            `supersede audit incomplete: ${JSON.stringify(supersede)}`);
        }
        assert(fs.readFileSync(path.join(detachedRoot, legacy.report_dir, 'events.jsonl'), 'utf8') === detachedSourceBytes,
          'detached management command rewrote the source run');
        assert(fs.readFileSync(path.join(attendedRoot, legacy.report_dir, 'events.jsonl'), 'utf8') === attendedSourceBytes,
          'attended management command rewrote the source run');
      } finally {
        for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'M2 owner fence: stale executor result cannot cross the runtime post-invoke boundary',
    run: async () => {
      const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-runtime-fence-'));
      try {
        const control = ensureRunControl(runDir, 'run-1');
        const acquired = casAcquireRunOwner(runDir, 'run-1', control.current_epoch, {
          kind: 'process', owner_id: 'owner-1', pid: process.pid,
        });
        assert(acquired.ok, 'initial owner acquisition failed');
        const ctx = context({ runDir, owner: { ...acquired.token, kind: 'process' } });
        const executor = new AttendedGoalPhaseExecutor(async (actual) => {
          releaseRunOwner(runDir, actual.owner);
          const next = ensureRunControl(runDir, 'run-1');
          const replacement = casAcquireRunOwner(runDir, 'run-1', next.current_epoch, {
            kind: 'session', owner_id: 'owner-2',
          });
          assert(replacement.ok, 'replacement owner acquisition failed');
          return { status: 'passed', phase: actual.phase };
        });
        let rejected = false;
        try { await new GoalPhaseRuntime().executeExecutor(ctx, executor); }
        catch { rejected = true; }
        assert(rejected, 'stale executor result crossed the post-invoke fence');
      } finally {
        fs.rmSync(runDir, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'M2 attended executor: callback transport returns normalized output and cannot own a gate',
    run: async () => {
      let receivedPhase = '';
      const executor = new AttendedGoalPhaseExecutor(async (ctx) => {
        receivedPhase = ctx.phase;
        return { status: 'passed', phase: ctx.phase, details: 'host callback done' };
      });
      const result = await executor.execute(context({ owner: {
        run_id: 'run-1', owner_id: 'session-1', epoch: 2, kind: 'session',
      } }));
      assert(receivedPhase === 'coding', 'callback did not receive immutable context');
      assert(result.status === 'passed' && result.exitCode === 0, JSON.stringify(result));
      assert(result.command === 'phase_execute_request', JSON.stringify(result));
    },
  },
  {
    name: 'M2 detached executor: existing spawn/timeout/output result is behavior-equivalent after extraction',
    run: async () => {
      const plan = { argv: ['codex'], label: 'codex exec', env: {}, adapterName: 'codex' } as HeadlessInvokePlan;
      let called = 0;
      const executor = new DetachedGoalPhaseExecutor(
        (ctx) => ({ plan, cwd: ctx.projectRoot, options: { timeoutMs: 1234, extraEnv: { ...ctx.childEnv } } }),
        async (actualPlan, cwd, options) => {
          called += 1;
          assert(actualPlan === plan && cwd === '/project', 'invocation plan/cwd drift');
          assert(options?.timeoutMs === 1234, 'timeout drift');
          return {
            exitCode: 7,
            stdout: 'stdout',
            stderr: 'stderr',
            command: actualPlan.label,
            timed_out: true,
            duration_ms: 55,
            kill_attempted: true,
          };
        },
      );
      const result = await executor.execute(context());
      assert(called === 1, `called=${called}`);
      assert(result.status === 'failed', JSON.stringify(result));
      assert(result.exitCode === 7 && result.timed_out === true && result.duration_ms === 55, JSON.stringify(result));
      assert(result.stdout === 'stdout' && result.stderr === 'stderr', JSON.stringify(result));
    },
  },
  {
    name: 'M2 canonical projection: attended/detached lifecycle is equal while executor telemetry and volatile identity differ',
    run: () => {
      const birth = { type: 'run_created', ts: 'A', manifest_identity_hash: 'hash', run_base_sha_digest: 'base' };
      const detached = [
        birth,
        { type: 'adapter_probe', pid: 10 },
        { type: 'phase_start', phase: 'coding', ts: 'A', pid: 10, epoch: 1, attempt: 1 },
        { type: 'agent_invoke_start', phase: 'coding', invoke_id: 'detached-i1' },
        { type: 'agent_invoke_end', phase: 'coding', invoke_id: 'detached-i1', exit_code: 0 },
        { type: 'phase_verdict', phase: 'coding', verdict: 'PASS', action: 'advance', ts: 'A' },
        { type: 'run_end', status: 'CHAIN_SLICE_COMPLETED', ts: 'A', pid: 10 },
      ];
      const attended = [
        { ...birth, ts: 'B' },
        { type: 'phase_start', phase: 'coding', ts: 'B', owner_id: 'session', epoch: 99, round: 3 },
        { type: 'stdio_request', phase: 'coding', request_id: 'stdio-1' },
        { type: 'phase_verdict', phase: 'coding', verdict: 'PASS', action: 'advance', ts: 'B' },
        { type: 'run_end', status: 'CHAIN_SLICE_COMPLETED', ts: 'B', pid: 99 },
      ];
      const a = projectCanonicalLifecycle(detached);
      const b = projectCanonicalLifecycle(attended);
      assert(JSON.stringify(a) === JSON.stringify(b), `detached=${JSON.stringify(a)}\nattended=${JSON.stringify(b)}`);
      assert(a.map(event => event.type).join(',') === 'run_created,phase_start,phase_verdict,run_end', JSON.stringify(a));
    },
  },
  {
    name: 'M2 canonical projection: bidirectional handoff direction/outcome is preserved exactly once',
    run: () => {
      const projected = projectCanonicalLifecycle([
        { type: 'handoff_requested', request_id: 'a', target_owner_kind: 'process', from_epoch: 1 },
        { type: 'lease_poll', request_id: 'a' },
        { type: 'handoff_accepted', request_id: 'a', owner_kind: 'process', epoch: 2 },
        { type: 'handoff_requested', request_id: 'b', target_owner_kind: 'session', from_epoch: 2 },
        { type: 'handoff_accepted', request_id: 'b', owner_kind: 'session', epoch: 3 },
      ]);
      assert(JSON.stringify(projected) === JSON.stringify([
        { type: 'owner_handoff', from: 'session', to: 'process', outcome: 'success' },
        { type: 'owner_handoff', from: 'process', to: 'session', outcome: 'success' },
      ]), JSON.stringify(projected));
    },
  },
  {
    name: 'M2 production rejected handoff retains target direction in canonical lifecycle',
    run: async () => {
      const root = setupGoalRuntimeHost('codex').root;
      try {
        let requestId = '';
        const probe = await runGoalRuntimeChain(root, {
          adapter: 'codex',
          runId: 'production-handoff-rejected',
          onSpec: ({ runId }) => {
            const manifest = loadGoalManifestFromRun(root, runId, { feature: 'bc-openCard' });
            const runDir = path.resolve(root, manifest.report_dir);
            const control = readRunControl(runDir, runId);
            assert(control?.owner?.kind === 'process', 'production process owner missing');
            const request = writeHandoffRequest(runDir, {
              run_id: runId,
              from_epoch: control.current_epoch + 1,
              target_owner_kind: 'session',
            });
            requestId = request.request_id;
          },
        });
        assert(probe.exitCode === 0, `rejected handoff run exit=${probe.exitCode}`);
        const rejected = probe.events.find(event =>
          event.type === 'handoff_rejected' && event.request_id === requestId);
        assert(rejected?.target_owner_kind === 'session',
          `production rejection lost target: ${JSON.stringify(rejected)}`);
        const handoffs = canonicalOf(probe).filter(event => event.type === 'owner_handoff');
        assert(JSON.stringify(handoffs) === JSON.stringify([
          { type: 'owner_handoff', from: 'process', to: 'session', outcome: 'failed' },
        ]), `canonical rejection=${JSON.stringify(handoffs)}`);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'M2 canonical projection: halt/backtrack semantics are retained without volatile fields',
    run: () => {
      const projected = projectCanonicalLifecycle([
        { type: 'phase_halt', phase: 'review', halt_reason: 'source_drift', ts: 'x', owner_id: 'p' },
        { type: 'phase_backtrack_requested', phase: 'review', from_phase: 'review', to_phase: 'coding', invalidated_phases: ['review', 'ut'], epoch: 4 },
      ]);
      assert(JSON.stringify(projected) === JSON.stringify([
        { type: 'phase_halt', phase: 'review', halt_reason: 'source_drift' },
        { type: 'phase_backtrack_requested', phase: 'review', from_phase: 'review', to_phase: 'coding', invalidated_phases: ['review', 'ut'] },
      ]), JSON.stringify(projected));
    },
  },
];

export async function runSelectedCases(selector?: string): Promise<import('../utils/unit-case-selection').SelectedUnitCases> {
  const results: UnitCaseResult[] = [];
  for (const testCase of cases.filter(item => selector === undefined || item.name.includes(selector))) {
    try { await testCase.run(); results.push({ name: testCase.name, ok: true }); }
    catch (error) { results.push({ name: testCase.name, ok: false, error: (error as Error).stack ?? String(error) }); }
  }
  return { results, matchedCaseCount: results.length, executionTimings: [] };
}

export async function runAll(): Promise<UnitCaseResult[]> {
  const results: UnitCaseResult[] = [];
  for (const testCase of cases) {
    try {
      await testCase.run();
      results.push({ name: testCase.name, ok: true });
    } catch (error) {
      results.push({ name: testCase.name, ok: false, error: (error as Error).stack ?? String(error) });
    }
  }
  return results;
}
