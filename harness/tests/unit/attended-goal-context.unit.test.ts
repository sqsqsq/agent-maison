import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { clearFrameworkConfigCache } from '../../config';
import { validateAttendedGoalContext } from '../../scripts/utils/attended-goal-context';
import { buildGoalManifestFromInput, writeGoalManifest } from '../../scripts/utils/goal-manifest';
import { casAcquireRunOwner, ensureRunControl, releaseRunOwner } from '../../scripts/utils/goal-run-control';
import { appendGoalEventFenced } from '../../scripts/utils/goal-in-session-evidence';
import { bindAttendedGoalContext } from '../../harness-runner';
import { isAgentSideGoalHarness, isGoalOrchestrationEnv } from '../../scripts/utils/phase-state';
import { writeDeviceTestEvidenceIfEligible } from '../../scripts/check-testing';
import type { UnitCaseResult } from '../run-unit';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function withRun(run: (env: {
  root: string; runId: string; runDir: string;
  token: { run_id: string; owner_id: string; epoch: number };
  issuePhase: (phase: string, attemptId?: string) => void;
}) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'attended-context-'));
  const runId = '20260824T120000Z-test';
  try {
    fs.writeFileSync(path.join(root, 'framework.config.json'), JSON.stringify({
      schema_version: '1.1', project_name: 'attended-context',
      paths: { features_dir: 'doc/features' },
    }, null, 2) + '\n', 'utf-8');
    clearFrameworkConfigCache();
    const manifest = buildGoalManifestFromInput({
      feature: 'demo', run_id: runId, requirement: 'manifest requirement', adapter: 'codex',
      requirement_source_files: ['doc/features/demo/原始需求.md'],
      unattended: { write_mode: 'full-access', approval_mode: 'never' },
    }, { projectRoot: root, runId });
    writeGoalManifest(manifest, root);
    const runDir = path.resolve(root, ...manifest.report_dir.split('/'));
    const control = ensureRunControl(runDir, runId);
    const acquired = casAcquireRunOwner(runDir, runId, control.current_epoch, {
      kind: 'session', owner_id: 'session-test', lease_ms: 60_000,
    });
    assert(acquired.ok, 'session owner acquisition failed');
    if (!acquired.ok) throw new Error('session owner acquisition failed');
    const issuePhase = (phase: string, attemptId = 'session-e1-round-1'): void => {
      appendGoalEventFenced(root, manifest, runDir, acquired.token, {
        type: 'phase_start', phase, attempt_id: attemptId,
        owner_id: acquired.token.owner_id, owner_epoch: acquired.token.epoch,
        driver: 'session', round: 1,
      });
    };
    issuePhase('spec');
    run({ root, runId, runDir, token: acquired.token, issuePhase });
  } finally {
    clearFrameworkConfigCache();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'exact run + feature + active session lease validates',
    run: () => withRun(({ root, runId, token }) => {
      const context = validateAttendedGoalContext({
        projectRoot: root, feature: 'demo', runId, phase: 'spec', attemptId: 'session-e1-round-1',
        ownerId: token.owner_id, ownerEpoch: token.epoch,
      });
      assert(context.manifest.requirement === 'manifest requirement', 'manifest not returned');
      assert(context.control.owner?.kind === 'session', 'session owner not returned');
    }),
  },
  {
    name: 'feature mismatch fails closed',
    run: () => withRun(({ root, runId, token }) => {
      let threw = false;
      try { validateAttendedGoalContext({
        projectRoot: root, feature: 'other', runId, phase: 'spec', attemptId: 'session-e1-round-1',
        ownerId: token.owner_id, ownerEpoch: token.epoch,
      }); }
      catch { threw = true; }
      assert(threw, 'feature mismatch must throw');
    }),
  },
  {
    name: 'expired lease fails closed',
    run: () => withRun(({ root, runId, runDir, token }) => {
      const filePath = path.join(runDir, 'run-control.json');
      const control = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, any>;
      control.owner.lease_expires_at = new Date(Date.now() - 1).toISOString();
      fs.writeFileSync(filePath, JSON.stringify(control, null, 2) + '\n', 'utf-8');
      let threw = false;
      try { validateAttendedGoalContext({
        projectRoot: root, feature: 'demo', runId, phase: 'spec', attemptId: 'session-e1-round-1',
        ownerId: token.owner_id, ownerEpoch: token.epoch,
      }); }
      catch { threw = true; }
      assert(threw, 'expired lease must throw');
    }),
  },
  {
    name: 'wrong phase cannot borrow a valid owner fence',
    run: () => withRun(({ root, runId, token }) => {
      let message = '';
      try {
        validateAttendedGoalContext({
          projectRoot: root, feature: 'demo', runId, phase: 'testing',
          attemptId: 'session-e1-round-1', ownerId: token.owner_id, ownerEpoch: token.epoch,
        });
      } catch (error) { message = (error as Error).message; }
      assert(/phase\/attempt 未与当前签发记录精确匹配/.test(message), `wrong phase 未拒绝：${message}`);
    }),
  },
  {
    name: 'wrong attempt cannot borrow a valid issued phase',
    run: () => withRun(({ root, runId, token }) => {
      let message = '';
      try {
        validateAttendedGoalContext({
          projectRoot: root, feature: 'demo', runId, phase: 'spec',
          attemptId: 'forged-attempt', ownerId: token.owner_id, ownerEpoch: token.epoch,
        });
      } catch (error) { message = (error as Error).message; }
      assert(/phase\/attempt 未与当前签发记录精确匹配/.test(message), `wrong attempt 未拒绝：${message}`);
    }),
  },
  {
    name: 'harness explicit binding injects existing goal env only after validation',
    run: () => withRun(({ root, runId, token, issuePhase }) => {
      const env: NodeJS.ProcessEnv = {
        maison_goal_run_id: 'stale', MAISON_GOAL_RUNNER: '0', maison_goal_gate_harness: '0',
      };
      const result = bindAttendedGoalContext({
        projectRoot: root,
        feature: 'demo',
        phase: 'spec',
        goalRunId: runId,
        goalAttemptId: 'session-e1-round-1',
        goalOwnerId: token.owner_id,
        goalOwnerEpoch: token.epoch,
        env,
      });
      assert(result.bound, 'explicit run should bind');
      assert(env.MAISON_GOAL_RUN_ID === runId, 'run id env not injected');
      assert(env.MAISON_GOAL_RUNNER === '1', 'runner env not injected');
      assert(env.MAISON_GOAL_ATTEMPT === 'session-e1-round-1', 'attempt env not injected');
      assert(env.MAISON_GOAL_ATTEMPT_PHASE === 'spec', 'attempt phase env not injected');
      assert(env.MAISON_GOAL_GATE_HARNESS === '1', 'formal gate authority not injected');
      assert(!Object.prototype.hasOwnProperty.call(env, 'maison_goal_run_id'), 'mixed-case stale key retained');
      assert(!Object.prototype.hasOwnProperty.call(env, 'maison_goal_gate_harness'), 'mixed-case gate key retained');
    }),
  },
  {
    name: 'formal attended binding is orchestration but not agent-side harness',
    run: () => withRun(({ root, runId, token }) => {
      const keys = [
        'MAISON_GOAL_RUN_ID', 'MAISON_GOAL_RUNNER', 'MAISON_GOAL_ATTEMPT',
        'MAISON_GOAL_ATTEMPT_PHASE', 'MAISON_GOAL_GATE_HARNESS',
      ] as const;
      const before = new Map(keys.map((key) => [key, process.env[key]]));
      try {
        bindAttendedGoalContext({
          projectRoot: root, feature: 'demo', phase: 'spec', goalRunId: runId,
          goalAttemptId: 'session-e1-round-1', goalOwnerId: token.owner_id,
          goalOwnerEpoch: token.epoch, env: process.env,
        });
        assert(isGoalOrchestrationEnv(), 'attended harness must be goal orchestration');
        assert(!isAgentSideGoalHarness(), 'formal attended gate must not be agent-side');
      } finally {
        for (const key of keys) {
          const value = before.get(key);
          if (value === undefined) delete process.env[key]; else process.env[key] = value;
        }
      }
    }),
  },
  {
    name: 'formal attended binding reaches the canonical device evidence writer',
    run: () => withRun(({ root, runId, token, issuePhase }) => {
      const keys = [
        'MAISON_GOAL_RUN_ID', 'MAISON_GOAL_RUNNER', 'MAISON_GOAL_ATTEMPT',
        'MAISON_GOAL_ATTEMPT_PHASE', 'MAISON_GOAL_GATE_HARNESS',
      ] as const;
      const before = new Map(keys.map((key) => [key, process.env[key]]));
      try {
        issuePhase('testing');
        bindAttendedGoalContext({
          projectRoot: root, feature: 'demo', phase: 'testing', goalRunId: runId,
          goalAttemptId: 'session-e1-round-1', goalOwnerId: token.owner_id,
          goalOwnerEpoch: token.epoch, env: process.env,
        });
        const reportsDir = path.join(root, 'doc', 'features', 'demo', 'testing', 'reports');
        const results = writeDeviceTestEvidenceIfEligible(
          {
            projectRoot: root, frameworkRoot: path.resolve(__dirname, '..', '..', '..'),
            feature: 'demo', phase: 'testing',
          } as any,
          {
            hapPath: path.join(root, 'demo.hap'), installPassed: true,
            installExternallyBlocked: false, buildReused: false,
            hylyreTracePath: path.join(root, 'trace.json'), deviceTestRunExecuted: true,
            installExecuted: true, installOk: true, hapSha256Full: 'a'.repeat(64),
          },
          () => ({ ok: true, doc: { cases: [], goal_run_id: runId } }),
        );
        assert(results.length === 1 && results[0].status === 'PASS',
          `formal device writer did not run: ${JSON.stringify(results)}`);
        assert(fs.existsSync(path.join(reportsDir, 'device-test-evidence.json')),
          'formal device evidence was not written');
      } finally {
        for (const key of keys) {
          const value = before.get(key);
          if (value === undefined) delete process.env[key]; else process.env[key] = value;
        }
      }
    }),
  },
  {
    name: 'old epoch context cannot borrow a reattached owner',
    run: () => withRun(({ root, runId, runDir, token }) => {
      releaseRunOwner(runDir, token);
      const next = casAcquireRunOwner(runDir, runId, token.epoch, {
        kind: 'session', owner_id: 'session-next', lease_ms: 60_000,
      });
      assert(next.ok, 'reattach failed');
      let threw = false;
      try {
        validateAttendedGoalContext({
          projectRoot: root, feature: 'demo', runId, phase: 'spec', attemptId: 'session-e1-round-1',
          ownerId: token.owner_id, ownerEpoch: token.epoch,
        });
      } catch { threw = true; }
      assert(threw, 'old epoch must fail after reattach');
    }),
  },
  {
    name: 'manual harness remains unbound even when an active run exists',
    run: () => withRun(({ root }) => {
      const env: NodeJS.ProcessEnv = {};
      const result = bindAttendedGoalContext({ projectRoot: root, feature: 'demo', env });
      assert(!result.bound, 'manual call must not scan and bind an active run');
      assert(env.MAISON_GOAL_RUN_ID === undefined, 'manual call injected run id');
      assert(env.MAISON_GOAL_RUNNER === undefined, 'manual call injected goal runner marker');
    }),
  },
];

export function runAll(): UnitCaseResult[] {
  return cases.map((testCase) => {
    try { testCase.run(); return { name: testCase.name, ok: true }; }
    catch (error) { return { name: testCase.name, ok: false, error: (error as Error).message }; }
  });
}
