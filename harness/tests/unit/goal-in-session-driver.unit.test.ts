import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { clearFrameworkConfigCache, featurePhaseReportsDir } from '../../config';
import {
  buildPhaseExecuteRequest,
  defaultGoalModeFrameworkRoot,
  deriveInSessionFingerprint,
  prepareGoalModeRun,
  runGoalModeHostBridge,
  runGoalModeInSession,
} from '../../scripts/goal-mode-entry';
import type { InSessionRoundResult } from '../../scripts/utils/goal-in-session-driver';
import { resolveWorkflowSpec } from '../../workflow-loader';
import type { GoalManifest } from '../../scripts/utils/goal-manifest';
import {
  formatGoalRoundStatus,
  handoffSessionToDetached,
  recommendationAuthorized,
  resolveGoalRunModeIntent,
  runInSessionRound,
} from '../../scripts/utils/goal-in-session-driver';
import {
  casAcquireRunOwner,
  ensureRunControl,
  readRunControl,
} from '../../scripts/utils/goal-run-control';
import { consumeHandoffAtBoundary, readHandoffRequest, writeHandoffRequest } from '../../scripts/utils/goal-handoff';
import { deriveChangeUnitFeatureId } from '../../scripts/utils/change-unit-path';
import { featureRelativePath } from '../../scripts/utils/feature-identity';
import { humanVisualAcceptancePaths } from '../../scripts/goal-runner';
import { goalFeatureSelfReferencePrefix } from '../../scripts/utils/goal-preflight';
import { dereferenceRequirementDocs } from '../../scripts/utils/fidelity-shared';

const FRAMEWORK_ROOT = path.resolve(__dirname, '..', '..', '..');

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function mkProject(): { root: string; manifest: GoalManifest; runDir: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-in-session-'));
  fs.writeFileSync(path.join(root, 'framework.config.json'), JSON.stringify({
    schema_version: '1.1',
    project_name: 'in-session-test',
    active_workflow: 'spec-driven',
    project_profile: { name: 'generic' },
    agent_adapter: 'codex',
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
  }), 'utf8');
  fs.mkdirSync(path.join(root, 'doc', 'features', 'demo'), { recursive: true });
  const reportDir = 'doc/features/demo/goal-runs/r1';
  const manifest: GoalManifest = {
    schema_version: '1.0',
    start_phase: 'spec',
    end_phase: 'spec',
    feature: 'demo',
    adapter: 'codex',
    budget: {
      max_retries_per_phase: 2,
      max_total_turns: 30,
      wall_clock_minutes: 60,
      max_transient_api_retries: 3,
    },
    dependency_policy: {
      deferrable_blocking_classes: ['externalBlocked'],
      deferrable_failure_kinds: ['device_blocked'],
      propagate_to_downstream: true,
    },
    unattended: { write_mode: 'workspace-write', approval_mode: 'never' },
    run_id: 'r1',
    report_dir: reportDir,
    created_at: new Date().toISOString(),
  };
  return { root, manifest, runDir: path.join(root, reportDir) };
}

async function withSession<T>(
  run: (env: ReturnType<typeof mkProject> & { token: { run_id: string; owner_id: string; epoch: number } }) => Promise<T> | T,
): Promise<T> {
  const env = mkProject();
  ensureRunControl(env.runDir, 'r1');
  const acquired = casAcquireRunOwner(env.runDir, 'r1', 0, {
    kind: 'session',
    owner_id: 'session-1',
    lease_ms: 60_000,
  });
  if (!acquired.ok) throw new Error('session acquire failed');
  try {
    return await run({ ...env, token: acquired.token });
  } finally {
    fs.rmSync(env.root, { recursive: true, force: true });
  }
}

interface TestCase { name: string; run: () => Promise<void> | void }
const cases: TestCase[] = [
  {
    name: 'goal-mode CLI default framework root contains workflows',
    run: () => {
      const resolved = defaultGoalModeFrameworkRoot(path.join(FRAMEWORK_ROOT, 'harness', 'scripts'));
      assert(resolved === FRAMEWORK_ROOT, `默认 framework root 错误：${resolved}`);
      assert(fs.existsSync(path.join(resolved, 'workflows')), '默认 framework root 下必须存在 workflows/');
    },
  },
  {
    name: 'phase executor protocol carries run, attempt, and owner fence',
    run: () => {
      const request = buildPhaseExecuteRequest({
        runId: 'r-authoritative', phase: 'spec', attemptId: 'session-e4-round-2',
        ownerId: 'owner-4', ownerEpoch: 4,
      }, { action: 'run_phase' });
      assert(request.type === 'phase_execute_request', 'request type');
      assert(request.run_id === 'r-authoritative', 'run_id missing from protocol');
      assert(request.phase === 'spec', 'phase mismatch');
      assert(request.attempt_id === 'session-e4-round-2', 'attempt missing');
      assert(request.owner_id === 'owner-4' && request.owner_epoch === 4, 'owner fence missing');
    },
  },
  {
    name: 'run-mode intent: explicit phrases bypass prompt; ambiguous remains null',
    run: () => {
      assert(resolveGoalRunModeIntent('我离开一会，继续跑') === 'unattended', 'unattended');
      assert(resolveGoalRunModeIntent('遇到问题停下来问我') === 'attended', 'attended');
      assert(resolveGoalRunModeIntent('帮我完成这个目标') === null, 'ambiguous');
      assert(resolveGoalRunModeIntent('', true) === 'unattended', 'detach');
      assert(!/in-session|headless|tier|batch/.test(formatGoalRoundStatus({
        feature: 'demo', phase: 'spec', round: 1, mode: 'attended',
      })), 'internal terms must not leak');
    },
  },
  {
    name: 'in-session fuse fingerprint excludes attempt identifiers',
    run: () => {
      const make = (attempt: string): InSessionRoundResult => ({
        status: 'executed',
        assessment: {
          observed_fingerprint: attempt,
          gaps: [],
          recommendation: {
            action: 'run_phase', phase: 'spec', reason: 'missing',
            requires_driver_authorization: true,
          },
          stop: { fused: false, reason: null },
          run_status_candidate: null,
        } as never,
        outcome: { status: 'passed', phase: 'spec' },
        status_line: 'stable',
      });
      assert(deriveInSessionFingerprint(make('attempt-a')) === deriveInSessionFingerprint(make('attempt-b')),
        'attempt id must not change content fingerprint');
    },
  },
  {
    name: 'batch through review waits when assess recommends ut',
    run: () => {
      const recommendation = {
        action: 'run_phase' as const,
        phase: 'ut',
        reason: 'missing',
        requires_driver_authorization: true as const,
      };
      assert(!recommendationAuthorized(
        recommendation,
        { mode: 'batch_authorized', through_phase: 'review' },
        ['spec', 'plan', 'coding', 'review', 'ut', 'testing'],
      ), 'ut must be outside through=review');
      assert(!recommendationAuthorized(
        { ...recommendation, phase: 'unknown-phase' },
        { mode: 'batch_authorized', through_phase: 'review' },
        ['spec', 'plan', 'coding', 'review', 'ut', 'testing'],
      ), 'unknown target must fail closed');
    },
  },  {
    name: 'batch authorization gate reaches real in-session waiting behavior',
    run: () => withSession(async (env) => {
      fs.writeFileSync(path.join(env.root, 'doc', 'features', 'demo', 'feature.yaml'), 'track: lite\n', 'utf8');
      const manifest = { ...env.manifest, start_phase: 'change' as const, end_phase: 'exit' as const };
      for (const phase of ['change', 'coding']) {
        const dir = featurePhaseReportsDir(env.root, 'demo', phase, FRAMEWORK_ROOT);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({
          schema_version: '1.2', verdict: 'PASS', closure_status: 'open',
          assurance: 'full', blockers: [],
        }), 'utf8');
        fs.writeFileSync(path.join(dir, 'script-report.json'), JSON.stringify({ summary: { verdict: 'PASS' } }), 'utf8');
      }
      let called = false;
      const result = await runInSessionRound({
        projectRoot: env.root, frameworkRoot: FRAMEWORK_ROOT, runDir: env.runDir,
        token: env.token, manifest,
        workflow: resolveWorkflowSpec(env.root, { frameworkRoot: FRAMEWORK_ROOT }),
        adapter: 'codex', mode: 'attended', round: 1,
        authorization: { mode: 'batch_authorized', through_phase: 'coding' },
        reconcile: { schema_version: '1.0', state: 'active', phase_outcome: { phase: 'coding', verdict: 'PASS', legacy_action: 'advance' } },
        executePhase: async (phase) => { called = true; return { status: 'passed', phase }; },
      });
      assert(result.status === 'waiting', `status=${result.status}`);
      assert(result.assessment?.recommendation.phase === 'exit', JSON.stringify(result.assessment?.recommendation));
      assert(!called, 'exit outside through=coding must not execute');
    }),
  },  {
    name: 'in-session happy path executes one recommended phase in isolated callback',
    run: () => withSession(async (env) => {
      let invoked = '';
      const result = await runInSessionRound({
        projectRoot: env.root,
        frameworkRoot: FRAMEWORK_ROOT,
        runDir: env.runDir,
        token: env.token,
        manifest: env.manifest,
        workflow: resolveWorkflowSpec(env.root, { frameworkRoot: FRAMEWORK_ROOT }),
        adapter: 'codex',
        mode: 'attended',
        round: 1,
        authorization: { mode: 'goal_mode' },
        executePhase: async (phase) => {
          invoked = phase;
          return { status: 'passed', phase };
        },
      });
      assert(result.status === 'executed', `status=${result.status}`);
      assert(invoked === 'spec', `phase=${invoked}`);
      assert(fs.existsSync(path.join(env.runDir, 'events.jsonl')), 'canonical events');
      assert(fs.existsSync(path.join(env.runDir, 'progress.json')), 'canonical progress');
      assert(fs.existsSync(path.join(env.runDir, 'manifest.json')), 'canonical manifest');
    }),
  },
  {
    name: 'prepare-run creates a fresh attended manifest and run-control skeleton',
    run: () => {
      const env = mkProject();
      try {
        const prepared = prepareGoalModeRun({
          projectRoot: env.root,
          frameworkRoot: FRAMEWORK_ROOT,
          feature: 'demo',
          runId: 'fresh-1',
          adapter: 'codex',
          adapterSource: 'local_config',
          requirement: 'prepare an attended goal run',
          endPhase: 'spec',
        });
        assert(prepared.manifest.run_id === 'fresh-1', 'run id');
        assert(prepared.manifest.adapter_provenance === 'local_config', 'truthful adapter provenance');
        assert(fs.existsSync(prepared.manifestPath), 'manifest must be persisted');
        assert(readRunControl(prepared.runDir, 'fresh-1')?.owner === null, 'run-control must start unowned');
        let duplicate = false;
        try {
          prepareGoalModeRun({
            projectRoot: env.root,
            frameworkRoot: FRAMEWORK_ROOT,
            feature: 'demo',
            runId: 'fresh-1',
            adapter: 'codex',
            requirement: 'duplicate',
            endPhase: 'spec',
          });
        } catch (error) {
          duplicate = String(error).includes('already exists');
        }
        assert(duplicate, 'prepare-run must not overwrite an existing manifest');
      } finally {
        fs.rmSync(env.root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'goal path matrix: default/custom features_dir × legacy/CU covers prepare, attach, human recovery, self exclusion',
    run: async () => {
      const matrix = [
        { featuresDir: 'doc/features', feature: 'demo', physical: 'demo' },
        { featuresDir: 'requirements/features', feature: 'demo', physical: 'demo' },
        {
          featuresDir: 'doc/features',
          feature: deriveChangeUnitFeatureId('bp-demo', 'unit-a'),
          physical: 'bp-demo/unit-a',
        },
        {
          featuresDir: 'requirements/features',
          feature: deriveChangeUnitFeatureId('bp-demo', 'unit-a'),
          physical: 'bp-demo/unit-a',
        },
      ];
      for (const row of matrix) {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-path-matrix-'));
        try {
          fs.writeFileSync(path.join(root, 'framework.config.json'), JSON.stringify({
            schema_version: '1.1', project_name: 'goal-path-matrix', active_workflow: 'spec-driven',
            project_profile: { name: 'generic' }, agent_adapter: 'codex',
            architecture: {
              outer_layers: [{ id: 'app', can_depend_on: [], intra_layer_deps: 'forbid' }],
              module_inner_layers: ['content'], inner_dependency_direction: 'upward',
              cross_module_exports_file: 'index.ts',
            },
            paths: {
              features_dir: row.featuresDir,
              reports_dir_pattern: `${row.featuresDir}/<feature>/<phase>/reports`,
            },
          }), 'utf8');
          fs.mkdirSync(path.join(root, ...row.featuresDir.split('/'), ...row.physical.split('/')), { recursive: true });
          clearFrameworkConfigCache();
          const prepared = prepareGoalModeRun({
            projectRoot: root, frameworkRoot: FRAMEWORK_ROOT, feature: row.feature,
            runId: 'matrix-run', adapter: 'codex', requirement: 'matrix requirement',
            startPhase: 'spec', endPhase: 'spec',
          });
          const expectedRunSuffix = `${row.featuresDir}/${row.physical}/goal-runs/matrix-run`;
          assert(
            prepared.runDir.replace(/\\/g, '/').endsWith(expectedRunSuffix),
            `prepare 落点错误：${prepared.runDir} expected ${expectedRunSuffix}`,
          );
          assert(featureRelativePath(row.feature) === row.physical, `feature SSOT 错误：${row.feature}`);

          let invoked = false;
          await runGoalModeHostBridge({
            projectRoot: root, frameworkRoot: FRAMEWORK_ROOT, feature: row.feature,
            runId: 'matrix-run', adapter: 'codex', runMode: 'attended', maxRounds: 1,
            executePhase: async (phase) => {
              invoked = true;
              return { status: 'passed', phase };
            },
          });
          assert(invoked, `attach 未执行：${row.featuresDir}/${row.physical}`);

          const recovery = humanVisualAcceptancePaths(root, row.feature);
          assert(
            recovery.receiptPath.replace(/\\/g, '/').endsWith(
              `${row.featuresDir}/${row.physical}/device-testing/visual-acceptance.receipt.json`,
            ),
            `人工恢复落点错误：${recovery.receiptPath}`,
          );

          const selfRel = `${row.featuresDir}/${row.physical}/self.md`;
          fs.writeFileSync(path.join(root, ...selfRel.split('/')), 'SHOULD_NOT_DEREFERENCE', 'utf8');
          const deref = dereferenceRequirementDocs(root, `see ${selfRel}`, {
            featuresDirRel: row.featuresDir,
            excludePrefixes: [goalFeatureSelfReferencePrefix(row.featuresDir, row.feature)],
          });
          assert(deref.resolvedPaths.length === 0 && !deref.combined.includes('SHOULD_NOT_DEREFERENCE'),
            `自引用排除失败：${row.featuresDir}/${row.physical}`);
        } finally {
          clearFrameworkConfigCache();
          fs.rmSync(root, { recursive: true, force: true });
        }
      }
    },
  },
  {
    name: 'production goal-mode entry invokes runInSessionRound through the skill bridge',
    run: () => withSession(async (env) => {
      let invoked = 0;
      const result = await runGoalModeInSession({
        projectRoot: env.root,
        frameworkRoot: FRAMEWORK_ROOT,
        runDir: env.runDir,
        token: env.token,
        manifest: env.manifest,
        workflow: resolveWorkflowSpec(env.root, { frameworkRoot: FRAMEWORK_ROOT }),
        adapter: 'codex',
        mode: 'attended',
        authorization: { mode: 'goal_mode' },
        maxRounds: 1,
        executePhase: async (phase) => {
          invoked += 1;
          return { status: 'passed', phase };
        },
      });
      assert(invoked === 1, `invoked=${invoked}`);
      assert(result.status === 'fused', `status=${result.status}`);
    }),
  },
  {
    name: 'attended attach rejects missing or unattended run-mode before owner CAS',
    run: async () => {
      const env = mkProject();
      try {
        fs.mkdirSync(env.runDir, { recursive: true });
        ensureRunControl(env.runDir, 'r1');
        for (const runMode of [undefined, 'unattended']) {
          let rejected = false;
          try {
            await runGoalModeHostBridge({
              projectRoot: env.root,
              frameworkRoot: FRAMEWORK_ROOT,
              feature: 'demo',
              runId: 'r1',
              adapter: 'codex',
              runMode,
              executePhase: async (phase) => ({ status: 'passed', phase }),
            });
          } catch (error) {
            rejected = String(error).includes('--run-mode attended');
          }
          assert(rejected, `runMode=${runMode ?? '<missing>'} must fail`);
          const control = readRunControl(env.runDir, 'r1');
          assert(control?.current_epoch === 0 && control.owner === null, 'run-mode failure mutated owner');
          assert(!fs.existsSync(path.join(env.runDir, 'events.jsonl')), 'run-mode failure wrote event');
        }
      } finally {
        fs.rmSync(env.root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'attended attach rejects adapter drift before owner CAS',
    run: async () => {
      const env = mkProject();
      try {
        fs.mkdirSync(env.runDir, { recursive: true });
        fs.writeFileSync(path.join(env.runDir, 'manifest.json'), `${JSON.stringify(env.manifest, null, 2)}\n`, 'utf8');
        ensureRunControl(env.runDir, 'r1');
        let rejected = false;
        try {
          await runGoalModeHostBridge({
            projectRoot: env.root,
            frameworkRoot: FRAMEWORK_ROOT,
            feature: 'demo',
            runId: 'r1',
            adapter: 'chrys',
            runMode: 'attended',
            executePhase: async (phase) => ({ status: 'passed', phase }),
          });
        } catch (error) {
          rejected = String(error).includes('attach adapter mismatch');
        }
        assert(rejected, 'wrong adapter must fail before ownership');
        const control = readRunControl(env.runDir, 'r1');
        assert(control?.current_epoch === 0 && control.owner === null, 'adapter mismatch mutated owner');
        assert(!fs.existsSync(path.join(env.runDir, 'events.jsonl')), 'adapter mismatch wrote event');
      } finally {
        fs.rmSync(env.root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'host bridge loads persisted run, owns session epoch, and invokes canonical loop',
    run: async () => {
      const env = mkProject();
      try {
        fs.mkdirSync(env.runDir, { recursive: true });
        fs.writeFileSync(path.join(env.runDir, 'manifest.json'), `${JSON.stringify(env.manifest, null, 2)}\n`, 'utf8');
        let invoked = 0;
        const result = await runGoalModeHostBridge({
          projectRoot: env.root,
          frameworkRoot: FRAMEWORK_ROOT,
          feature: 'demo',
          runId: 'r1',
          adapter: 'codex',
          runMode: 'attended',
          maxRounds: 1,
          executePhase: async (phase) => {
            invoked += 1;
            return { status: 'passed', phase };
          },
        });
        assert(invoked === 1, `invoked=${invoked}`);
        assert(result.status === 'fused', `status=${result.status}`);
        assert(readRunControl(env.runDir, 'r1')?.owner?.state === 'released', 'terminal bridge must release owner');
      } finally {
        fs.rmSync(env.root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'host bridge quarantines a malformed mailbox and reaches its terminal round',
    run: async () => {
      const env = mkProject();
      try {
        fs.mkdirSync(env.runDir, { recursive: true });
        fs.writeFileSync(path.join(env.runDir, 'manifest.json'), `${JSON.stringify(env.manifest, null, 2)}\n`, 'utf8');
        const mailbox = path.join(env.runDir, 'handoff-request.json');
        fs.writeFileSync(mailbox, '{"schema":"broken"}', 'utf8');
        const result = await runGoalModeHostBridge({
          projectRoot: env.root,
          frameworkRoot: FRAMEWORK_ROOT,
          feature: 'demo',
          runId: 'r1',
          adapter: 'codex',
          runMode: 'attended',
          maxRounds: 1,
          executePhase: async (phase) => ({ status: 'passed', phase }),
        });
        assert(result.status === 'fused', `terminal status=${result.status}`);
        assert(readRunControl(env.runDir, 'r1')?.owner?.state === 'released', 'terminal bridge must release owner');
        assert(!fs.existsSync(mailbox), 'malformed mailbox must be renamed');
        assert(fs.readdirSync(env.runDir).some(name => /^handoff-request\.invalid-.*\.json$/.test(name)),
          'quarantine file must preserve malformed bytes');
        assert(fs.readFileSync(path.join(env.runDir, 'events.jsonl'), 'utf8').includes('handoff_mailbox_quarantined'),
          'quarantine must be observable in the authoritative event log');
      } finally {
        fs.rmSync(env.root, { recursive: true, force: true });
      }
    },
  },  {
    name: 'host bridge wires expired-session orphan sweep and explicit takeover',
    run: async () => {
      const env = mkProject();
      try {
        fs.mkdirSync(env.runDir, { recursive: true });
        fs.writeFileSync(path.join(env.runDir, 'manifest.json'), `${JSON.stringify(env.manifest, null, 2)}
`, 'utf8');
        ensureRunControl(env.runDir, 'r1');
        const acquired = casAcquireRunOwner(env.runDir, 'r1', 0, { kind: 'session', owner_id: 'crashed', lease_ms: 1 });
        if (!acquired.ok) throw new Error('expired owner acquire failed');
        await new Promise((resolve) => setTimeout(resolve, 10));
        let rejected = false;
        try {
          await runGoalModeHostBridge({
            projectRoot: env.root, frameworkRoot: FRAMEWORK_ROOT, feature: 'demo', runId: 'r1', adapter: 'codex',
            runMode: 'attended',
            maxRounds: 1, executePhase: async (phase) => ({ status: 'passed', phase }),
          });
        } catch (error) {
          rejected = String(error).includes('busy/orphaned');
        }
        assert(rejected, 'expired owner must require explicit takeover');
        const taken = await runGoalModeHostBridge({
          projectRoot: env.root, frameworkRoot: FRAMEWORK_ROOT, feature: 'demo', runId: 'r1', adapter: 'codex',
          runMode: 'attended',
          forceTakeover: true, maxRounds: 1, executePhase: async (phase) => ({ status: 'passed', phase }),
        });
        assert(taken.status === 'fused' || taken.status === 'reconciled', `takeover=${taken.status}`);
      } finally {
        fs.rmSync(env.root, { recursive: true, force: true });
      }
    },
  },  {
    name: 'host bridge keeps orphan sweep before explicit takeover gate',
    run: () => {
      const source = fs.readFileSync(path.resolve(__dirname, '../../scripts/goal-mode-entry.ts'), 'utf8');
      const orphan = source.indexOf('control = markExpiredSessionOrphaned');
      const takeover = source.lastIndexOf('forceTakeoverRunOwner');
      assert(orphan >= 0 && takeover > orphan, 'orphan sweep must precede explicit takeover');
    },
  },  {
    name: 'host bridge rejects minimum-assurance phases outside the active workflow',
    run: async () => {
      const env = mkProject();
      try {
        env.manifest.minimum_assurance = { 'device-testing': 'full' };
        fs.mkdirSync(env.runDir, { recursive: true });
        fs.writeFileSync(path.join(env.runDir, 'manifest.json'), `${JSON.stringify(env.manifest, null, 2)}\n`, 'utf8');
        let rejected = false;
        try {
          await runGoalModeHostBridge({
            projectRoot: env.root, frameworkRoot: FRAMEWORK_ROOT, feature: 'demo', runId: 'r1', adapter: 'codex',
            runMode: 'attended',
            maxRounds: 1, executePhase: async (phase) => ({ status: 'passed', phase }),
          });
        } catch (error) {
          rejected = String(error).includes('active workflow');
        }
        assert(rejected, 'host bridge must fail closed on invalid minimum-depth phase');
      } finally {
        fs.rmSync(env.root, { recursive: true, force: true });
      }
    },
  },  {
    name: 'human-only deferred recommendation yields waiting item without phase execution',
    run: () => withSession(async (env) => {
      const reports = featurePhaseReportsDir(env.root, 'demo', 'spec', FRAMEWORK_ROOT);
      fs.mkdirSync(reports, { recursive: true });
      fs.writeFileSync(path.join(reports, 'summary.json'), JSON.stringify({
        schema_version: '1.2',
        verdict: 'INCOMPLETE',
        closure_status: 'open',
        assurance: 'full',
        blockers: [{ id: 'device_missing', blocking_class: 'externalBlocked' }],
      }), 'utf8');
      let called = false;
      const result = await runInSessionRound({
        projectRoot: env.root,
        frameworkRoot: FRAMEWORK_ROOT,
        runDir: env.runDir,
        token: env.token,
        manifest: env.manifest,
        workflow: resolveWorkflowSpec(env.root, { frameworkRoot: FRAMEWORK_ROOT }),
        adapter: 'codex',
        mode: 'attended',
        round: 2,
        authorization: { mode: 'goal_mode' },
        executePhase: async (phase) => {
          called = true;
          return { status: 'passed', phase };
        },
      });
      assert(result.status === 'waiting' && !!result.waiting_item, 'waiting');
      assert(!called, 'human-only item must not execute');
    }),
  },
  {
    name: 'in-session reconcile observation reaches both assess passes',
    run: () => withSession(async (env) => {
      let called = false;
      const result = await runInSessionRound({
        projectRoot: env.root, frameworkRoot: FRAMEWORK_ROOT, runDir: env.runDir,
        token: env.token, manifest: env.manifest,
        workflow: resolveWorkflowSpec(env.root, { frameworkRoot: FRAMEWORK_ROOT }),
        adapter: 'codex', mode: 'attended', round: 1,
        authorization: { mode: 'goal_mode' },
        reconcile: { schema_version: '1.0', state: 'fused', reason: 'persisted fuse', residual_fingerprints: [] },
        executePhase: async (phase) => { called = true; return { status: 'passed', phase }; },
      });
      assert(result.status === 'fused', `status=${result.status}`);
      assert(!called, 'fused reconcile must stop before executor');
    }),
  },  {
    name: 'failed phase reassess consumes current outcome instead of stale input',
    run: () => withSession(async (env) => {
      const result = await runInSessionRound({
        projectRoot: env.root, frameworkRoot: FRAMEWORK_ROOT, runDir: env.runDir,
        token: env.token, manifest: env.manifest,
        workflow: resolveWorkflowSpec(env.root, { frameworkRoot: FRAMEWORK_ROOT }),
        adapter: 'codex', mode: 'attended', round: 1,
        authorization: { mode: 'goal_mode' },
        executePhase: async (phase) => ({ status: 'failed', phase, details: 'phase failed' }),
      });
      assert(result.status === 'executed', 'status=' + result.status);
      assert(result.assessment?.recommendation.action === 'rerun_phase',
        JSON.stringify(result.assessment?.recommendation));
      assert(result.assessment?.recommendation.runner_action === 'retry',
        JSON.stringify(result.assessment?.recommendation));
      assert(result.assessment?.run_status_candidate === null, 'failed phase cannot complete');
    }),
  },  {
    name: 'consumed handoff without valid acceptance stays quiescent before phase invoke',
    run: () => withSession(async (env) => {
      writeHandoffRequest(env.runDir, {
        request_id: 'session-precondition',
        run_id: env.token.run_id,
        from_epoch: env.token.epoch,
        target_owner_kind: 'process',
      });
      const consumed = consumeHandoffAtBoundary(env.runDir, env.token);
      assert(consumed.kind === 'consumed', 'mailbox must be consumed');
      const manifestPath = path.join(env.root, env.manifest.report_dir, 'manifest.json');
      fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
      const originalManifest = Buffer.from('{"sentinel":"keep"}\n', 'utf8');
      fs.writeFileSync(manifestPath, originalManifest);
      let called = false;
      const result = await runInSessionRound({
        projectRoot: env.root, frameworkRoot: FRAMEWORK_ROOT, runDir: env.runDir,
        token: env.token, manifest: env.manifest,
        workflow: resolveWorkflowSpec(env.root, { frameworkRoot: FRAMEWORK_ROOT }),
        adapter: 'codex', mode: 'attended', round: 1,
        authorization: { mode: 'goal_mode' },
        executePhase: async (phase) => {
          called = true;
          return { status: 'passed', phase };
        },
      });
      assert(result.status === 'waiting', 'status=' + result.status);
      assert(result.waiting_item?.includes('handoff'), String(result.waiting_item));
      assert(!called, 'phase must not execute before handoff acceptance');
      assert(fs.readFileSync(manifestPath).equals(originalManifest),
        'manifest must remain byte-identical before handoff acceptance');
    }),
  },  {
    name: 'phase executor exception emits halt, returns waiting, and releases owner',
    run: () => withSession(async (env) => {
      const result = await runInSessionRound({
        projectRoot: env.root, frameworkRoot: FRAMEWORK_ROOT, runDir: env.runDir,
        token: env.token, manifest: env.manifest,
        workflow: resolveWorkflowSpec(env.root, { frameworkRoot: FRAMEWORK_ROOT }),
        adapter: 'codex', mode: 'attended', round: 1,
        authorization: { mode: 'goal_mode' },
        executePhase: async () => { throw new Error('executor exploded'); },
      });
      assert(result.status === 'waiting', `status=${result.status}`);
      assert(result.waiting_item?.includes('executor exploded'), 'error detail');
      assert(readRunControl(env.runDir, 'r1')?.owner?.state === 'released', 'owner released');
      assert(fs.readFileSync(path.join(env.runDir, 'events.jsonl'), 'utf8')
        .includes('in_session_phase_exception'), 'halt event');
    }),
  },
  {
    name: 'in-session lease heartbeat keeps ownership alive during a long phase',
    run: () => withSession(async (env) => {
      const result = await runInSessionRound({
        projectRoot: env.root, frameworkRoot: FRAMEWORK_ROOT, runDir: env.runDir,
        token: env.token, manifest: env.manifest,
        workflow: resolveWorkflowSpec(env.root, { frameworkRoot: FRAMEWORK_ROOT }),
        adapter: 'codex', mode: 'attended', round: 1, leaseMs: 900,
        authorization: { mode: 'goal_mode' },
        executePhase: async (phase) => {
          await new Promise((resolve) => setTimeout(resolve, 1100));
          const lease = readRunControl(env.runDir, 'r1')?.owner?.lease_expires_at;
          assert(!!lease && new Date(lease).getTime() > Date.now(), 'heartbeat must renew before executor returns');
          return { status: 'failed', phase };
        },
      });
      assert(result.status === 'executed', `status=${result.status}`);
      const expires = readRunControl(env.runDir, 'r1')?.owner?.lease_expires_at;
      assert(!!expires && new Date(expires).getTime() > Date.now(), 'lease renewed during execute');
    }),
  },
  {
    name: 'in-session retry budget fuses deterministic failure before maxRounds',
    run: () => withSession(async (env) => {
      let invoked = 0;
      const result = await runGoalModeInSession({
        projectRoot: env.root, frameworkRoot: FRAMEWORK_ROOT, runDir: env.runDir,
        token: env.token, manifest: env.manifest,
        workflow: resolveWorkflowSpec(env.root, { frameworkRoot: FRAMEWORK_ROOT }),
        adapter: 'codex', mode: 'attended', authorization: { mode: 'goal_mode' },
        maxRounds: 20,
        executePhase: async (phase) => {
          invoked += 1;
          return { status: 'failed', phase, details: 'deterministic failure' };
        },
      });
      assert(result.status === 'fused', `status=${result.status}`);
      assert(invoked === env.manifest.budget.max_retries_per_phase, `invoked=${invoked}`);
      assert(readRunControl(env.runDir, 'r1')?.owner?.state === 'released', 'owner released');
    }),
  },  {
    name: 'in-session budget state survives a fresh bridge invocation',
    run: async () => {
      const env = mkProject();
      try {
        ensureRunControl(env.runDir, 'r1');
        const first = casAcquireRunOwner(env.runDir, 'r1', 0, { kind: 'session', owner_id: 'first', lease_ms: 60_000 });
        if (!first.ok) throw new Error('first acquire failed');
        let invoked = 0;
        const common = {
          projectRoot: env.root, frameworkRoot: FRAMEWORK_ROOT, runDir: env.runDir,
          manifest: env.manifest, workflow: resolveWorkflowSpec(env.root, { frameworkRoot: FRAMEWORK_ROOT }),
          adapter: 'codex' as const, mode: 'attended' as const,
          authorization: { mode: 'goal_mode' as const }, maxRounds: 1,
          executePhase: async (phase: string) => { invoked += 1; return { status: 'failed' as const, phase }; },
        };
        const firstResult = await runGoalModeInSession({ ...common, token: first.token });
        assert(firstResult.status === 'fused', `first=${firstResult.status}`);
        assert(JSON.parse(fs.readFileSync(path.join(env.runDir, 'session-loop-state.json'), 'utf8')).total_rounds === 1, 'round not persisted');
        const control = readRunControl(env.runDir, 'r1');
        if (!control) throw new Error('control missing');
        const second = casAcquireRunOwner(env.runDir, 'r1', control.current_epoch, { kind: 'session', owner_id: 'second', lease_ms: 60_000 });
        if (!second.ok) throw new Error('second acquire failed');
        const secondResult = await runGoalModeInSession({ ...common, token: second.token });
        assert(secondResult.status === 'fused', `second=${secondResult.status}`);
        assert(invoked === 1, `budget reset invoked=${invoked}`);
      } finally {
        fs.rmSync(env.root, { recursive: true, force: true });
      }
    },
  },  {
    name: 'in-session wall-clock excludes offline bridge gaps',
    run: () => withSession(async (env) => {
      const manifest = {
        ...env.manifest,
        budget: { ...env.manifest.budget, wall_clock_minutes: 1 },
      };
      fs.writeFileSync(path.join(env.runDir, 'session-loop-state.json'), JSON.stringify({
        schema_version: '1.0',
        started_at_ms: Date.now() - 6 * 60 * 60 * 1000,
        active_elapsed_ms: 0,
        total_rounds: 0,
        retries_by_phase: {},
        last_fingerprint: null,
        repeated_count: 0,
        last_phase: null,
        last_status: null,
        last_details: null,
        fuse_reason: null,
        reconcile: null,
      }), 'utf8');
      let invoked = 0;
      const result = await runGoalModeInSession({
        projectRoot: env.root, frameworkRoot: FRAMEWORK_ROOT, runDir: env.runDir,
        token: env.token, manifest,
        workflow: resolveWorkflowSpec(env.root, { frameworkRoot: FRAMEWORK_ROOT }),
        adapter: 'codex', mode: 'attended', authorization: { mode: 'goal_mode' },
        maxRounds: 1,
        executePhase: async (phase) => {
          invoked += 1;
          return { status: 'passed', phase };
        },
      });
      assert(invoked === 1, 'offline gap must not consume active budget');
      assert(result.status === 'fused', 'maxRounds terminal fuse expected');
      const state = JSON.parse(fs.readFileSync(path.join(env.runDir, 'session-loop-state.json'), 'utf8')) as { active_elapsed_ms?: number };
      assert((state.active_elapsed_ms ?? 0) < 60_000, 'active segment should be short');
    }),
  },  {
    name: 'adapter without isolation falls back to manual harness+assess',
    run: () => withSession(async (env) => {
      const result = await runInSessionRound({
        projectRoot: env.root,
        frameworkRoot: FRAMEWORK_ROOT,
        runDir: env.runDir,
        token: env.token,
        manifest: env.manifest,
        workflow: resolveWorkflowSpec(env.root, { frameworkRoot: FRAMEWORK_ROOT }),
        adapter: 'generic',
        mode: 'attended',
        round: 1,
        authorization: { mode: 'goal_mode' },
        executePhase: async (phase) => ({ status: 'passed', phase }),
      });
      assert(result.status === 'manual_fallback', 'manual fallback');
    }),
  },
  {
    name: 'session can quiesce same run for detached handoff without ledger conversion',
    run: () => withSession((env) => {
      const requestId = handoffSessionToDetached({
        projectRoot: env.root,
        frameworkRoot: FRAMEWORK_ROOT,
        runDir: env.runDir,
        token: env.token,
        manifest: env.manifest,
        workflow: resolveWorkflowSpec(env.root, { frameworkRoot: FRAMEWORK_ROOT }),
        adapter: 'codex',
        mode: 'attended',
        authorization: { mode: 'goal_mode' },
      });
      assert(readHandoffRequest(env.runDir)?.request_id === requestId, 'mailbox');
      assert(readRunControl(env.runDir, 'r1')?.owner?.state === 'released', 'released');
      assert(fs.readFileSync(path.join(env.runDir, 'events.jsonl'), 'utf8').includes('handoff_requested'), 'event');
    }),
  },
];

export async function runAll(): Promise<Array<{ name: string; ok: boolean; error?: string }>> {
  const results: Array<{ name: string; ok: boolean; error?: string }> = [];
  for (const testCase of cases) {
    try {
      await testCase.run();
      results.push({ name: testCase.name, ok: true });
    } catch (error) {
      results.push({ name: testCase.name, ok: false, error: (error as Error).message });
    }
  }
  return results;
}
