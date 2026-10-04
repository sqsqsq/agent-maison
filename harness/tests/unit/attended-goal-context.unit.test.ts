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
      // plan 6279fcd7 修法一：attended 执行者自检不是正式 gate——绑定只清残留、不置标。
      assert(!Object.keys(env).some((key) => key.toUpperCase() === 'MAISON_GOAL_GATE_HARNESS'),
        'attended binding must not grant formal gate authority');
      assert(!Object.prototype.hasOwnProperty.call(env, 'maison_goal_run_id'), 'mixed-case stale key retained');
      assert(!Object.prototype.hasOwnProperty.call(env, 'maison_goal_gate_harness'), 'mixed-case gate key retained');
    }),
  },
  {
    name: 'attended binding is orchestration and agent-side (executor self-check, like detached)',
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
        assert(isAgentSideGoalHarness(), 'attended executor self-check must be agent-side (journal writer)');
      } finally {
        for (const key of keys) {
          const value = before.get(key);
          if (value === undefined) delete process.env[key]; else process.env[key] = value;
        }
      }
    }),
  },
  {
    name: 'attended self-check and old gate flag both produce proposals without formal writes',
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
        const write = () => writeDeviceTestEvidenceIfEligible(
          {
            projectRoot: root, frameworkRoot: path.resolve(__dirname, '..', '..', '..'),
            feature: 'demo', phase: 'testing',
          } as any,
          {
            hapPath: path.join(root, 'demo.hap'), installPassed: true,
            installExecuted: true, installOk: true, hapSha256Full: 'a'.repeat(64),
            installExternallyBlocked: false, buildReused: false,
            hylyreTracePath: path.join(root, 'trace.json'), deviceTestRunExecuted: true,
          },
          () => ({ ok: true, doc: { cases: [], goal_run_id: runId } }),
        );
        const selfCheck = write();
        assert(selfCheck.length === 1 && selfCheck[0].status === 'PASS', `attended self-check must produce proposal: ${JSON.stringify(selfCheck)}`);
        assert(!fs.existsSync(path.join(reportsDir, 'device-test-evidence.json')),
          'attended self-check wrote device evidence');
        process.env.MAISON_GOAL_GATE_HARNESS = '1';
        const results = write();
        assert(results.length === 1 && results[0].status === 'PASS',
          `old flag must not change proposal production: ${JSON.stringify(results)}`);
        assert(!fs.existsSync(path.join(reportsDir, 'device-test-evidence.json')),
          'old flag granted formal device write');
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
  {
    // plan e7a2c4f1 §3.7（G29）：身份判据不动，只把"模式误用"从租约话术里分出来。
    name: 'P3-T16 attended arguments in detached mode report a mode mismatch, not an expired lease',
    run: () => withRun(({ root, runId, runDir, token }) => {
      releaseRunOwner(runDir, token);
      // detached run：持柄者是 process，而不是 session
      const detached = casAcquireRunOwner(runDir, runId, token.epoch, {
        kind: 'process', owner_id: 'detached-runner-1', lease_ms: 60_000,
      });
      assert(detached.ok, 'detached owner acquisition failed');
      if (!detached.ok) throw new Error('detached owner acquisition failed');
      let message = '';
      try {
        validateAttendedGoalContext({
          projectRoot: root, feature: 'demo', runId, phase: 'spec', attemptId: 'session-e1-round-1',
          ownerId: detached.token.owner_id, ownerEpoch: detached.token.epoch,
        });
      } catch (error) { message = (error as Error).message; }
      assert(message.includes('模式不匹配'), `detached 下传 attended 参数须报模式不匹配：${message}`);
      assert(message.includes('detached'), `须点名当前模式：${message}`);
      assert(!/lease 已过期|租约.{0,4}过期|有效 lease/.test(message),
        `不得再把模式误用说成时效问题：${message}`);
      assert(message.includes('等待租约不会改变结果'),
        `须显式否掉"等一会儿租约就好了"这条误读：${message}`);
      for (const flag of ['--goal-attempt-id', '--goal-owner-id', '--goal-owner-epoch']) {
        assert(message.includes(flag), `须点名不该传的 attended 专用参数 ${flag}：${message}`);
      }
      // 判据本身没被放宽：仍然拒绝，绝不返回上下文
      let refused = false;
      try {
        validateAttendedGoalContext({
          projectRoot: root, feature: 'demo', runId, phase: 'spec', attemptId: 'session-e1-round-1',
          ownerId: detached.token.owner_id, ownerEpoch: detached.token.epoch,
        });
      } catch { refused = true; }
      assert(refused, 'detached 越权接管仍必须 fail-closed');
    }),
  },
  {
    name: 'P3-T16 反例：真正的 session 租约过期仍报租约，不被模式话术吞掉',
    run: () => withRun(({ root, runId, runDir, token }) => {
      const filePath = path.join(runDir, 'run-control.json');
      const control = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, any>;
      control.owner.lease_expires_at = new Date(Date.now() - 1).toISOString();
      fs.writeFileSync(filePath, JSON.stringify(control, null, 2) + '\n', 'utf-8');
      let message = '';
      try {
        validateAttendedGoalContext({
          projectRoot: root, feature: 'demo', runId, phase: 'spec', attemptId: 'session-e1-round-1',
          ownerId: token.owner_id, ownerEpoch: token.epoch,
        });
      } catch (error) { message = (error as Error).message; }
      assert(/lease 已过期或非法/.test(message), `session 租约过期须保留原判据与原文案：${message}`);
      assert(!message.includes('模式不匹配'), `session 模式不得被说成模式误用：${message}`);
    }),
  },
];

export function runAll(): UnitCaseResult[] {
  return cases.map((testCase) => {
    try { testCase.run(); return { name: testCase.name, ok: true }; }
    catch (error) { return { name: testCase.name, ok: false, error: (error as Error).message }; }
  });
}
