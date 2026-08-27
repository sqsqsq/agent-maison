import * as fs from 'fs';
import * as path from 'path';
import { clearFrameworkConfigCache } from '../../config';
import {
  assertAttendedRunMode,
  buildPhaseExecuteRequest,
  defaultGoalModeFrameworkRoot,
  deriveInSessionFingerprint,
  prepareGoalModeRun,
  runGoalModeHostBridge,
} from '../../scripts/goal-mode-entry';
import {
  formatGoalRoundStatus,
  handoffSessionToDetached,
  recommendationAuthorized,
  resolveGoalRunModeIntent,
  type InSessionRoundResult,
} from '../../scripts/utils/goal-in-session-driver';
import { loadGoalManifestFromRun } from '../../scripts/utils/goal-manifest';
import {
  casAcquireRunOwner,
  ensureRunControl,
  readRunControl,
} from '../../scripts/utils/goal-run-control';
import { projectCanonicalLifecycle } from '../../scripts/utils/goal-canonical-lifecycle';
import { resolveWorkflowSpec } from '../../workflow-loader';
import {
  runGoalRuntimeChain,
  setupGoalRuntimeHost,
} from './goal-runner-testing-integrity.unit.test';

// M5A：CU Feature 路径 SSOT 与 goal 自引用排除（主干 3.1.0 矩阵用例）
import { deriveChangeUnitFeatureId } from '../../scripts/utils/change-unit-path';
import { featureRelativePath } from '../../scripts/utils/feature-identity';
import { goalFeatureSelfReferencePrefix } from '../../scripts/utils/goal-preflight';
import { dereferenceRequirementDocs } from '../../scripts/utils/fidelity-shared';

const FRAMEWORK_ROOT = path.resolve(__dirname, '../../..');

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
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
    name: 'phase executor protocol carries run, attempt, owner fence and recommendation',
    run: () => {
      const request = buildPhaseExecuteRequest({
        runId: 'run-1', phase: 'spec', attemptId: 'attempt-2', ownerId: 'owner-4', ownerEpoch: 4,
      }, { action: 'run_phase' });
      assert(request.type === 'phase_execute_request', 'request type');
      assert(request.run_id === 'run-1' && request.phase === 'spec', 'run/phase identity');
      assert(request.attempt_id === 'attempt-2', 'attempt identity');
      assert(request.owner_id === 'owner-4' && request.owner_epoch === 4, 'owner fence');
      assert((request.recommendation as { action?: string }).action === 'run_phase', 'recommendation');
    },
  },
  {
    name: 'run-mode intent and user-facing status keep transport terms private',
    run: () => {
      assert(resolveGoalRunModeIntent('我离开一会，继续跑') === 'unattended', 'unattended intent');
      assert(resolveGoalRunModeIntent('遇到问题停下来问我') === 'attended', 'attended intent');
      assert(resolveGoalRunModeIntent('帮我完成目标') === null, 'ambiguous intent');
      const line = formatGoalRoundStatus({ feature: 'demo', phase: 'spec', round: 1, mode: 'attended' });
      assert(!/in-session|headless|tier|batch/.test(line), `internal terms leaked: ${line}`);
      assertAttendedRunMode('attended');
      let rejected = false;
      try { assertAttendedRunMode('unattended'); } catch { rejected = true; }
      assert(rejected, 'unattended attach declaration was accepted');
    },
  },
  {
    name: 'batch authorization remains a pure compatibility policy helper',
    run: () => {
      const chain = ['spec', 'plan', 'coding', 'review', 'ut', 'testing'];
      const recommendation = {
        action: 'run_phase', phase: 'coding', runner_action: 'backtrack_to_phase', reason: 'repair',
      } as never;
      assert(recommendationAuthorized(
        recommendation, { mode: 'batch_authorized', through_phase: 'testing' }, chain,
        { startPhase: 'coding' },
      ), 'authorized coding backtrack rejected');
      assert(!recommendationAuthorized(
        {
          action: 'run_phase', phase: 'plan', runner_action: 'backtrack_to_phase', reason: 'repair',
        } as never,
        { mode: 'batch_authorized', through_phase: 'testing' }, chain,
        { startPhase: 'coding' },
      ), 'batch escaped below explicit start');
    },
  },
  {
    name: 'compatibility fingerprint excludes volatile attempt identifiers',
    run: () => {
      const make = (details: string): InSessionRoundResult => ({
        status: 'executed', assessment: null,
        outcome: { status: 'failed', phase: 'coding', details }, status_line: details,
      });
      assert(deriveInSessionFingerprint(make('same')) === deriveInSessionFingerprint(make('same')),
        'stable outcome fingerprint drift');
      assert(deriveInSessionFingerprint(make('same')) !== deriveInSessionFingerprint(make('changed')),
        'semantic outcome change was ignored');
    },
  },
  {
    name: 'prepare-run uses production createGoalRun and refuses duplicate birth',
    run: () => {
      const root = setupGoalRuntimeHost('codex').root;
      try {
        const prepared = prepareGoalModeRun({
          projectRoot: root, frameworkRoot: FRAMEWORK_ROOT,
          feature: 'bc-openCard', runId: 'attended-birth', adapter: 'codex',
          requirement: 'attended birth', endPhase: 'spec',
        });
        const events = fs.readFileSync(path.join(prepared.runDir, 'events.jsonl'), 'utf8')
          .trim().split(/\r?\n/).map(line => JSON.parse(line) as { type?: string });
        assert(events.length === 1 && events[0].type === 'run_created', 'birth is not exactly once');
        assert(readRunControl(prepared.runDir, prepared.manifest.run_id)?.owner === null,
          'prepared run started owned');
        let duplicate = false;
        try {
          prepareGoalModeRun({
            projectRoot: root, frameworkRoot: FRAMEWORK_ROOT,
            feature: 'bc-openCard', runId: 'attended-birth', adapter: 'codex',
            requirement: 'duplicate', endPhase: 'spec',
          });
        } catch { duplicate = true; }
        assert(duplicate, 'duplicate birth overwrote existing run');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'production host bridge executes the canonical runtime and real gate sequence',
    run: async () => {
      const root = setupGoalRuntimeHost('codex').root;
      try {
        const probe = await runGoalRuntimeChain(root, {
          viaHostBridge: true, adapter: 'codex', runId: 'host-bridge-runtime',
        });
        assert(probe.exitCode === 0, `host bridge exit=${probe.exitCode}`);
        assert(probe.invokedPhases.join(',') === 'spec,plan,coding,review,ut,testing',
          `host bridge phase sequence=${probe.invokedPhases.join(',')}`);
        assert(JSON.stringify(probe.invokedPhases) === JSON.stringify(probe.harnessPhases),
          'host bridge bypassed or reordered canonical gates');
        const projection = projectCanonicalLifecycle(probe.events);
        assert(projection[0]?.type === 'run_created', 'host bridge lost birth');
        assert(projection.at(-1)?.type === 'run_end', 'host bridge lost close');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'host bridge rejects run-mode and adapter drift before owner CAS or event append',
    run: async () => {
      const root = setupGoalRuntimeHost('codex').root;
      try {
        const prepared = prepareGoalModeRun({
          projectRoot: root, frameworkRoot: FRAMEWORK_ROOT,
          feature: 'bc-openCard', runId: 'attach-guard', adapter: 'codex',
          requirement: 'attach guard', endPhase: 'spec',
        });
        const eventsBefore = fs.readFileSync(path.join(prepared.runDir, 'events.jsonl'));
        for (const variant of [
          { runMode: 'unattended', adapter: 'codex' },
          { runMode: 'attended', adapter: 'claude' },
        ]) {
          let rejected = false;
          try {
            await runGoalModeHostBridge({
              projectRoot: root, frameworkRoot: FRAMEWORK_ROOT,
              feature: 'bc-openCard', runId: 'attach-guard',
              adapter: variant.adapter, runMode: variant.runMode,
              executePhase: async phase => ({ status: 'passed', phase }),
            });
          } catch { rejected = true; }
          assert(rejected, `attach guard accepted ${JSON.stringify(variant)}`);
        }
        assert(eventsBefore.equals(fs.readFileSync(path.join(prepared.runDir, 'events.jsonl'))),
          'attach guard appended an event');
        assert(readRunControl(prepared.runDir, 'attach-guard')?.owner === null,
          'attach guard mutated owner');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'compatibility driver is a thin bridge with no assess/gate/advance loop',
    run: () => {
      const driver = fs.readFileSync(path.resolve(__dirname, '../../scripts/utils/goal-in-session-driver.ts'), 'utf8');
      const compatibility = fs.readFileSync(path.resolve(__dirname, '../../scripts/utils/goal-phase-runtime.ts'), 'utf8');
      const host = fs.readFileSync(path.resolve(__dirname, '../../scripts/goal-mode-entry.ts'), 'utf8');
      assert(!/assessFeature|runHarnessPhase|phase_verdict|for\s*\(let round|while\s*\(/.test(driver),
        'driver retained private lifecycle');
      assert(!/assessFeature|runHarnessPhase|phase_verdict|for\s*\(let round|while\s*\(/.test(compatibility),
        'compatibility runtime retained private lifecycle');
      assert(host.includes('new GoalPhaseRuntime'), 'host does not delegate to canonical runtime');
    },
  },
  {
    name: 'session handoff uses production mailbox/fence and leaves the run ready for process owner',
    run: () => {
      const root = setupGoalRuntimeHost('codex').root;
      try {
        const prepared = prepareGoalModeRun({
          projectRoot: root, frameworkRoot: FRAMEWORK_ROOT,
          feature: 'bc-openCard', runId: 'handoff-source', adapter: 'codex',
          requirement: 'handoff source', endPhase: 'spec',
        });
        const control = ensureRunControl(prepared.runDir, prepared.manifest.run_id);
        const acquired = casAcquireRunOwner(prepared.runDir, prepared.manifest.run_id, control.current_epoch, {
          kind: 'session', owner_id: 'session-owner', lease_ms: 60_000,
        });
        assert(acquired.ok, 'session owner acquisition failed');
        const requestId = handoffSessionToDetached({
          projectRoot: root, frameworkRoot: FRAMEWORK_ROOT,
          runDir: prepared.runDir, token: acquired.token, manifest: prepared.manifest,
          workflow: resolveWorkflowSpec(root, { frameworkRoot: FRAMEWORK_ROOT }),
          adapter: 'codex', mode: 'attended', authorization: { mode: 'goal_mode' },
        });
        assert(requestId.length > 0, 'handoff request identity missing');
        assert(readRunControl(prepared.runDir, prepared.manifest.run_id)?.owner?.state === 'released',
          'handoff source owner was not released');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'persisted manifest remains load-only at host attach boundary',
    run: () => {
      const root = setupGoalRuntimeHost('codex').root;
      try {
        const prepared = prepareGoalModeRun({
          projectRoot: root, frameworkRoot: FRAMEWORK_ROOT,
          feature: 'bc-openCard', runId: 'load-only', adapter: 'codex',
          requirement: 'load only', endPhase: 'spec',
        });
        const loaded = loadGoalManifestFromRun(root, prepared.manifest.run_id, { feature: 'bc-openCard' });
        assert(loaded.run_id === prepared.manifest.run_id, 'host attach changed run identity');
        assert(loaded.created_at === prepared.manifest.created_at, 'host attach reparsed creation time');
        assert(loaded.run_base_sha === undefined, 'spec-only run invented a git baseline');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'goal path matrix: default/custom features_dir × legacy/CU covers prepare, attach, self exclusion',
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
        // 3.0.0 统一运行时：host bridge attach 前跑完整 preflight（adapter 物化、personal 字段外迁
        // framework.local.json、toolchain、vision canary…）——复用生产级宿主夹具，只按行改 features_dir。
        const root = setupGoalRuntimeHost('codex').root;
        try {
          const cfgPath = path.join(root, 'framework.config.json');
          const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as { paths: Record<string, unknown> };
          cfg.paths = {
            ...cfg.paths,
            features_dir: row.featuresDir,
            reports_dir_pattern: `${row.featuresDir}/<feature>/<phase>/reports`,
          };
          fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8');
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
];

export interface UnitCaseResult { name: string; ok: boolean; error?: string }

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
