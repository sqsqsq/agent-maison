import assert from 'assert';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { UnitCaseResult } from '../run-unit';
import {
  buildGoalManifestFromInput,
  computeManifestIdentityFields,
  loadGoalManifestFromRun,
  mergeSuccessorRequirement,
  deriveSuccessorRequirement,
  SUCCESSOR_REQUIREMENT_INCREMENT_MARKER,
} from '../../scripts/utils/goal-manifest';
import {
  assertGoalRunAttachable,
  buildSupersedeAuditEvent,
  createGoalRun,
  decideRunContinuation,
  inspectGoalRunCreation,
  validateRebaselineRequest,
  type RunContinuationDecision,
} from '../../scripts/utils/goal-run-creation';
import { withRunDisposition } from '../../scripts/utils/adjudication';
import {
  resolveManifestDriftDecision,
  resolveManifestIdentityBaseline,
} from '../../scripts/goal-runner';
import { buildAgentSpawnEnv } from '../../scripts/utils/agent-invoke';
import { resolveGoalRunBaseline } from '../../scripts/utils/goal-run-baseline';
import { classifyGoalRunsDir } from '../../scripts/utils/fidelity-shared';
import { resolveLatestRunId } from '../../scripts/utils/goal-progress';
import {
  hasGoalExecutionSignal,
  isAgentSideGoalHarness,
  resolveHarnessDiffBaseRef,
} from '../../scripts/utils/phase-state';

const SHA = 'a'.repeat(40);
const unattended = { write_mode: 'full-access' as const, approval_mode: 'never' as const };

function fixture(end = 'testing'): { root: string; manifest: ReturnType<typeof buildGoalManifestFromInput> } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-birth-'));
  const manifest = buildGoalManifestFromInput({
    feature: 'demo', run_id: `run-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    start_phase: 'spec', end_phase: end, unattended,
  }, { projectRoot: root });
  return { root, manifest };
}

function writeFrameworkConfig(root: string): void {
  fs.writeFileSync(path.join(root, 'framework.config.json'), JSON.stringify({
    schema_version: '1.1',
    project_name: 'BirthContractFixture',
    project_profile: { name: 'hmos-app', sub_variant: 'app' },
    architecture: {
      outer_layers: [{ id: '02-Feature', can_depend_on: [], intra_layer_deps: 'dag' }],
      module_inner_layers: ['shared'],
      inner_dependency_direction: 'upward',
      cross_module_exports_file: 'index.ets',
    },
    paths: { features_dir: 'doc/features', docs_committed: false },
    materialized_adapters: ['codex'],
  }, null, 2), 'utf8');
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'coding/UT chain freezes exact HEAD, writes manifest before one run_created and round-trips identity',
    run: () => {
      const { root, manifest } = fixture('ut');
      try {
        const created = createGoalRun({ projectRoot: root, manifest, chain: ['spec', 'plan', 'coding', 'ut'], resolveHead: () => SHA });
        assert.strictEqual(manifest.run_base_sha, SHA);
        assert(fs.existsSync(created.manifestPath));
        const lines = fs.readFileSync(created.eventsPath, 'utf8').trim().split(/\r?\n/);
        assert.strictEqual(lines.length, 1);
        assert.strictEqual(JSON.parse(lines[0]).type, 'run_created');
        assert.deepStrictEqual(created.runCreated.phase_chain, ['spec', 'plan', 'coding', 'ut']);
        assert.deepStrictEqual(manifest.phase_chain, created.runCreated.phase_chain);
        assert.strictEqual(inspectGoalRunCreation(root, manifest).state, 'complete');
        assert.strictEqual(loadGoalManifestFromRun(root, manifest.run_id, { feature: 'demo' }).run_base_sha, SHA);
        assert('run_base_sha' in computeManifestIdentityFields(manifest));
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    },
  },
  {
    name: 'shared baseline resolver rejects run_base_sha presence and value drift from birth',
    run: () => {
      const injected = fixture('plan');
      const deleted = fixture('coding');
      const changed = fixture('coding');
      try {
        for (const item of [injected, deleted, changed]) writeFrameworkConfig(item.root);
        createGoalRun({ projectRoot: injected.root, manifest: injected.manifest, chain: ['spec', 'plan'] });
        const injectedPath = path.join(injected.root, injected.manifest.report_dir, 'manifest.json');
        fs.writeFileSync(injectedPath, JSON.stringify({ ...injected.manifest, run_base_sha: 'b'.repeat(40) }), 'utf8');
        const injectedBaseline = resolveGoalRunBaseline(injected.root, 'demo', injected.manifest.run_id);
        assert.strictEqual(injectedBaseline.available, false);
        assert.match(injectedBaseline.available ? '' : injectedBaseline.reason, /存在性不匹配/);

        createGoalRun({
          projectRoot: deleted.root, manifest: deleted.manifest, chain: ['coding'], resolveHead: () => SHA,
        });
        const deletedPath = path.join(deleted.root, deleted.manifest.report_dir, 'manifest.json');
        const deletedManifest = { ...deleted.manifest } as Record<string, unknown>;
        delete deletedManifest.run_base_sha;
        fs.writeFileSync(deletedPath, JSON.stringify(deletedManifest), 'utf8');
        const deletedBaseline = resolveGoalRunBaseline(deleted.root, 'demo', deleted.manifest.run_id);
        assert.strictEqual(deletedBaseline.available, false);
        assert.match(deletedBaseline.available ? '' : deletedBaseline.reason, /存在性不匹配/);

        createGoalRun({
          projectRoot: changed.root, manifest: changed.manifest, chain: ['coding'], resolveHead: () => SHA,
        });
        const changedPath = path.join(changed.root, changed.manifest.report_dir, 'manifest.json');
        fs.writeFileSync(changedPath, JSON.stringify({ ...changed.manifest, run_base_sha: 'c'.repeat(40) }), 'utf8');
        const changedBaseline = resolveGoalRunBaseline(changed.root, 'demo', changed.manifest.run_id);
        assert.strictEqual(changedBaseline.available, false);
        assert.match(changedBaseline.available ? '' : changedBaseline.reason, /出生摘要不匹配/);
      } finally {
        fs.rmSync(injected.root, { recursive: true, force: true });
        fs.rmSync(deleted.root, { recursive: true, force: true });
        fs.rmSync(changed.root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'pure spec/plan chain may omit run_base_sha but still has one run_created',
    run: () => {
      const { root, manifest } = fixture('plan');
      try {
        createGoalRun({ projectRoot: root, manifest, chain: ['spec', 'plan'], resolveHead: () => { throw new Error('must not read HEAD'); } });
        assert.strictEqual(manifest.run_base_sha, undefined);
        assert.strictEqual(inspectGoalRunCreation(root, manifest).state, 'complete');
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    },
  },
  {
    name: 'required HEAD failure leaves zero manifest/events and dispatchable state',
    run: () => {
      const { root, manifest } = fixture('coding');
      try {
        assert.throws(() => createGoalRun({
          projectRoot: root, manifest, chain: ['coding'], resolveHead: () => { throw new Error('not a git repo'); },
        }), /not a git repo/);
        assert(!fs.existsSync(path.join(root, manifest.report_dir, 'manifest.json')));
        assert(!fs.existsSync(path.join(root, manifest.report_dir, 'events.jsonl')));
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    },
  },
  {
    name: 'manifest-only residue is CREATION_INCOMPLETE and attach never repairs it',
    run: () => {
      const { root, manifest } = fixture('plan');
      try {
        const manifestPath = path.join(root, manifest.report_dir, 'manifest.json');
        fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
        fs.writeFileSync(manifestPath, JSON.stringify(manifest), 'utf8');
        assert.strictEqual(inspectGoalRunCreation(root, manifest).state, 'creation_incomplete');
        assert.throws(() => assertGoalRunAttachable(root, manifest), /CREATION_INCOMPLETE/);
        assert(!fs.existsSync(path.join(root, manifest.report_dir, 'events.jsonl')));
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    },
  },
  {
    name: 'duplicate or tampered run_created is CREATION_INCOMPLETE',
    run: () => {
      const { root, manifest } = fixture('plan');
      try {
        const created = createGoalRun({ projectRoot: root, manifest, chain: ['plan'] });
        fs.appendFileSync(created.eventsPath, `${JSON.stringify(created.runCreated)}\n`, 'utf8');
        assert.strictEqual(inspectGoalRunCreation(root, manifest).state, 'creation_incomplete');
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    },
  },
  {
    name: 'run_base_sha remains visible to diff but override-manifest cannot authorize change or deletion',
    run: () => {
      const birth = { feature: 'f', run_base_sha: 'birth-a' };
      for (const current of [
        { feature: 'f', run_base_sha: 'birth-b' },
        { feature: 'f' },
      ] as Array<Record<string, string>>) {
        const decision = resolveManifestDriftDecision({
          currentFields: current,
          currentHash: 'hash',
          birthFields: birth,
          overrides: { 'override-manifest': true, 'override-start': false, 'override-end': false },
          fidelityTransitionFields: new Set(),
        });
        assert(decision.changedFields.includes('run_base_sha'));
        assert.strictEqual(decision.halt?.classification, 'baseline_corruption_or_tampering');
      }
      const legal = resolveManifestDriftDecision({
        currentFields: { ...birth, feature: 'g' }, currentHash: 'hash', birthFields: birth,
        overrides: { 'override-manifest': true, 'override-start': false, 'override-end': false },
        fidelityTransitionFields: new Set(),
      });
      assert.strictEqual(legal.rebaseApplied, true);
    },
  },
  {
    name: 'identity replay rejects a historical rebase that changes or removes run_base_sha',
    run: () => {
      assert.throws(() => resolveManifestIdentityBaseline([
        { type: 'run_created', manifest_identity_fields: { feature: 'f', run_base_sha: 'base-a' } },
        { type: 'manifest_identity_rebase', to_fields: { feature: 'f', run_base_sha: 'base-b' } },
      ]), /baseline_corruption_or_tampering/);
      assert.throws(() => resolveManifestIdentityBaseline([
        { type: 'run_created', manifest_identity_fields: { feature: 'f', run_base_sha: 'base-a' } },
        { type: 'manifest_identity_rebase', to_fields: { feature: 'g' } },
      ]), /baseline_corruption_or_tampering/);
    },
  },
  {
    name: 'successor preserves lineage baseline without reading HEAD and missing lineage fails closed',
    run: () => {
      const ok = fixture('coding');
      const missing = fixture('coding');
      try {
        ok.manifest.successor_of = 'old-run';
        ok.manifest.run_base_sha = SHA;
        createGoalRun({
          projectRoot: ok.root, manifest: ok.manifest, chain: ['coding'],
          resolveHead: () => { throw new Error('successor must not read HEAD'); },
        });
        assert.strictEqual(ok.manifest.run_base_sha, SHA);

        missing.manifest.successor_of = 'legacy-without-base';
        assert.throws(() => createGoalRun({
          projectRoot: missing.root, manifest: missing.manifest, chain: ['coding'], resolveHead: () => SHA,
        }), /缺少可信 lineage/);
        assert(!fs.existsSync(path.join(missing.root, missing.manifest.report_dir, 'manifest.json')));
      } finally {
        fs.rmSync(ok.root, { recursive: true, force: true });
        fs.rmSync(missing.root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'rebaseline requires one supersede, exact current HEAD and no goal execution signal',
    run: () => {
      assert.throws(() => validateRebaselineRequest({
        supersedeTargets: ['old'], rebaselineTo: SHA, resume: false, dryRun: false,
        hasGoalExecutionSignal: true, currentHead: SHA,
      }), /runtime 之外/);
      assert.throws(() => validateRebaselineRequest({
        supersedeTargets: ['old'], rebaselineTo: SHA, resume: false, dryRun: false,
        hasGoalExecutionSignal: false, currentHead: 'b'.repeat(40),
      }), /HEAD 不一致/);
      assert.deepStrictEqual(validateRebaselineRequest({
        supersedeTargets: ['old'], rebaselineTo: SHA, resume: false, dryRun: false,
        hasGoalExecutionSignal: false, currentHead: SHA,
      }), { sourceRunId: 'old', baseSha: SHA });
    },
  },
  {
    name: 'formal gate marker does not erase the shared goal execution signal',
    run: () => {
      const saved = {
        run: process.env.MAISON_GOAL_RUN_ID,
        gate: process.env.MAISON_GOAL_GATE_HARNESS,
      };
      try {
        process.env.MAISON_GOAL_RUN_ID = 'r1';
        process.env.MAISON_GOAL_GATE_HARNESS = '1';
        assert.strictEqual(hasGoalExecutionSignal(), true);
        assert.strictEqual(isAgentSideGoalHarness(), false);
      } finally {
        if (saved.run === undefined) delete process.env.MAISON_GOAL_RUN_ID;
        else process.env.MAISON_GOAL_RUN_ID = saved.run;
        if (saved.gate === undefined) delete process.env.MAISON_GOAL_GATE_HARNESS;
        else process.env.MAISON_GOAL_GATE_HARNESS = saved.gate;
      }
    },
  },
  {
    name: 'goal child env scrubs HARNESS_DIFF_BASE_REF case-insensitively',
    run: () => {
      const env = buildAgentSpawnEnv({ Harness_Diff_Base_Ref: 'evil', SAFE: '1' }, {});
      assert(!Object.keys(env).some(key => key.toUpperCase() === 'HARNESS_DIFF_BASE_REF'));
      assert.strictEqual(env.SAFE, '1');
    },
  },
  {
    name: 'every goal execution signal ignores HARNESS_DIFF_BASE_REF while direct harness keeps it',
    run: () => {
      const keys = [
        'MAISON_GOAL_RUN_ID', 'MAISON_GOAL_ATTEMPT', 'MAISON_GOAL_ATTEMPT_PHASE',
        'MAISON_GOAL_RUNNER', 'MAISON_GOAL_HEADLESS', 'HARNESS_DIFF_BASE_REF',
      ] as const;
      const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
      try {
        for (const key of keys) delete process.env[key];
        process.env.HARNESS_DIFF_BASE_REF = 'main';
        assert.strictEqual(resolveHarnessDiffBaseRef(), 'main');
        for (const signal of keys.slice(0, 5)) {
          for (const key of keys.slice(0, 5)) delete process.env[key];
          process.env[signal] = signal === 'MAISON_GOAL_RUNNER' || signal === 'MAISON_GOAL_HEADLESS'
            ? '1'
            : 'present';
          assert.strictEqual(resolveHarnessDiffBaseRef(), undefined, signal);
        }
      } finally {
        for (const key of keys) {
          const value = saved[key];
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      }
    },
  },
  {
    name: 'CREATION_INCOMPLETE is excluded from authoritative and latest-run projections',
    run: () => {
      const complete = fixture('plan');
      try {
        createGoalRun({ projectRoot: complete.root, manifest: complete.manifest, chain: ['plan'] });
        const brokenId = `zz-${Date.now()}`;
        const brokenDir = path.join(complete.root, 'doc/features/demo/goal-runs', brokenId);
        fs.mkdirSync(brokenDir, { recursive: true });
        fs.writeFileSync(path.join(brokenDir, 'manifest.json'), JSON.stringify({
          ...complete.manifest, run_id: brokenId,
          report_dir: `doc/features/demo/goal-runs/${brokenId}`,
          created_at: '2099-01-01T00:00:00.000Z',
        }), 'utf8');
        const classified = classifyGoalRunsDir(path.join(complete.root, 'doc/features/demo/goal-runs'));
        assert.deepStrictEqual(classified.runs, [complete.manifest.run_id]);
        assert.strictEqual(classified.corruptRuns[0]?.runId, brokenId);
        assert.strictEqual(resolveLatestRunId(complete.root, 'doc/features', 'demo'), complete.manifest.run_id);
      } finally { fs.rmSync(complete.root, { recursive: true, force: true }); }
    },
  },
  {
    name: 'valid management successor starts, audits only the new run and runtime drivers never construct rebaseline',
    run: () => {
      const old = fixture('plan');
      try {
        const oldCreation = createGoalRun({ projectRoot: old.root, manifest: old.manifest, chain: ['plan'] });
        const oldBytes = fs.readFileSync(oldCreation.eventsPath);
        const successor = buildGoalManifestFromInput({
          feature: 'demo', run_id: `${old.manifest.run_id}-successor`, start_phase: 'coding', end_phase: 'coding',
          unattended,
        }, { projectRoot: old.root });
        successor.successor_of = old.manifest.run_id;
        successor.run_base_sha = SHA;
        const creation = createGoalRun({
          projectRoot: old.root, manifest: successor, chain: ['coding'],
          rebaselineFromRunId: old.manifest.run_id,
          resolveHead: () => { throw new Error('rebaseline successor must not re-read HEAD'); },
        });
        const audit = buildSupersedeAuditEvent({
          targetRunId: old.manifest.run_id,
          supersedingRunId: successor.run_id,
          rebaselineTo: SHA,
          creation,
        });
        fs.appendFileSync(creation.eventsPath, `${JSON.stringify(audit)}\n`, 'utf8');
        assert.strictEqual(creation.runCreated.rebaseline_from_run_id, old.manifest.run_id);
        assert.strictEqual(audit.run_created_event_hash, creation.runCreated.event_hash);
        assert.deepStrictEqual(fs.readFileSync(oldCreation.eventsPath), oldBytes, 'old events must remain byte-identical');

        for (const rel of ['harness/scripts/goal-supervise.ts', 'harness/scripts/goal-mode-entry.ts']) {
          const source = fs.readFileSync(path.resolve(__dirname, '../../..', rel), 'utf8');
          assert(!source.includes('--rebaseline-to'), `${rel} must never construct --rebaseline-to`);
        }
      } finally { fs.rmSync(old.root, { recursive: true, force: true }); }
    },
  },
  {
    name: 'fresh continuation guard: same/rewritten inline request cannot erase failed terminal; --force audits override',
    run: () => {
      const old = fixture('plan');
      try {
        old.manifest.requirement = '完成开卡需求';
        const oldCreation = createGoalRun({ projectRoot: old.root, manifest: old.manifest, chain: ['plan'] });
        fs.appendFileSync(oldCreation.eventsPath, `${JSON.stringify({
          ts: '2026-09-20T10:00:00.000Z', type: 'run_end', status: 'HALTED', halt_reason: 'content_retry_exhausted',
        })}\n`, 'utf8');
        const next = buildGoalManifestFromInput({
          feature: 'demo', run_id: `${old.manifest.run_id}-fresh`, start_phase: 'plan', end_phase: 'plan',
          requirement: '完成开卡需求（已有代码与截图）', unattended,
        }, { projectRoot: old.root });
        assert.throws(
          () => createGoalRun({ projectRoot: old.root, manifest: next, chain: ['plan'] }),
          /fresh run refused.*可恢复时 --resume.*结构终态使用既有 --supersede.*request_impact、HEAD、notes 或改写 CLI 散文均不构成新事实/,
        );
        assert(!fs.existsSync(path.join(old.root, next.report_dir, 'manifest.json')), '拒绝必须发生在出生写盘前');

        const forced = buildGoalManifestFromInput({
          feature: 'demo', run_id: `${old.manifest.run_id}-forced`, start_phase: 'plan', end_phase: 'plan',
          requirement: '完成开卡需求', unattended,
        }, { projectRoot: old.root });
        const forcedCreation = createGoalRun({ projectRoot: old.root, manifest: forced, chain: ['plan'], forceFresh: true });
        const events = fs.readFileSync(forcedCreation.eventsPath, 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line));
        assert.deepStrictEqual(events.map(event => event.type), ['run_created', 'fresh_run_override']);
        assert.strictEqual(events[1].source, '--force');
        assert.strictEqual(events[1].verified_grant, false);
      } finally { fs.rmSync(old.root, { recursive: true, force: true }); }
    },
  },
  {
    name: 'fresh continuation guard: bound requirement source content change is a real new fact',
    run: () => {
      const old = fixture('plan');
      try {
        const sourceRel = 'requirements/task.md';
        fs.mkdirSync(path.join(old.root, 'requirements'), { recursive: true });
        fs.writeFileSync(path.join(old.root, sourceRel), '旧需求', 'utf8');
        old.manifest.requirement = '旧需求';
        old.manifest.requirement_source_files = [sourceRel];
        const oldCreation = createGoalRun({ projectRoot: old.root, manifest: old.manifest, chain: ['plan'] });
        fs.appendFileSync(oldCreation.eventsPath, `${JSON.stringify({
          ts: '2026-09-20T10:00:00.000Z', type: 'run_end', status: 'HALTED', halt_reason: 'framework_bug',
        })}\n`, 'utf8');
        const newSourceRel = 'requirements/task2.md';
        fs.writeFileSync(path.join(old.root, newSourceRel), '新需求', 'utf8');
        const unbound = buildGoalManifestFromInput({
          feature: 'demo', run_id: `${old.manifest.run_id}-unbound-source`, start_phase: 'plan', end_phase: 'plan',
          requirement: '新需求', requirement_source_files: [newSourceRel], unattended,
        }, { projectRoot: old.root });
        assert.throws(
          () => createGoalRun({ projectRoot: old.root, manifest: unbound, chain: ['plan'] }),
          /fresh run refused/,
          '新增未与 prior 绑定的 source 不能把 CLI 散文变成机器新事实',
        );
        fs.writeFileSync(path.join(old.root, sourceRel), '新需求', 'utf8');
        const next = buildGoalManifestFromInput({
          feature: 'demo', run_id: `${old.manifest.run_id}-new-source`, start_phase: 'plan', end_phase: 'plan',
          requirement: '新需求', requirement_source_files: [`requirements/./task.md`], unattended,
        }, { projectRoot: old.root });
        createGoalRun({ projectRoot: old.root, manifest: next, chain: ['plan'] });
        assert(fs.existsSync(path.join(old.root, next.report_dir, 'manifest.json')));
      } finally { fs.rmSync(old.root, { recursive: true, force: true }); }
    },
  },
  {
    name: 'fresh continuation guard: authoritative terminal successor replaces its halted ancestor',
    run: () => {
      const old = fixture('plan');
      try {
        old.manifest.requirement = '完成开卡需求';
        const oldCreation = createGoalRun({ projectRoot: old.root, manifest: old.manifest, chain: ['plan'] });
        fs.appendFileSync(oldCreation.eventsPath, `${JSON.stringify({
          ts: '2026-09-20T10:00:00.000Z', type: 'run_end', status: 'HALTED', halt_reason: 'framework_bug',
        })}\n`, 'utf8');
        const successor = buildGoalManifestFromInput({
          feature: 'demo', run_id: `${old.manifest.run_id}-successor-done`, start_phase: 'plan', end_phase: 'plan',
          requirement: old.manifest.requirement, unattended,
        }, { projectRoot: old.root });
        successor.successor_of = old.manifest.run_id;
        const successorCreation = createGoalRun({ projectRoot: old.root, manifest: successor, chain: ['plan'] });
        const premature = buildGoalManifestFromInput({
          feature: 'demo', run_id: `${old.manifest.run_id}-before-successor-terminal`, start_phase: 'plan', end_phase: 'plan', unattended,
        }, { projectRoot: old.root });
        assert.throws(
          () => createGoalRun({ projectRoot: old.root, manifest: premature, chain: ['plan'] }),
          new RegExp(`fresh run refused:.*${old.manifest.run_id}.*framework_bug`),
          '只有 successor manifest/run_created、尚无终态审计时不得覆盖祖先失败',
        );
        fs.appendFileSync(successorCreation.eventsPath, `${JSON.stringify(buildSupersedeAuditEvent({
          targetRunId: old.manifest.run_id, supersedingRunId: successor.run_id,
        }))}\n${JSON.stringify({
          ts: '2026-09-20T11:00:00.000Z', type: 'run_end', status: 'CHAIN_SLICE_COMPLETED',
        })}\n`, 'utf8');
        const fresh = buildGoalManifestFromInput({
          feature: 'demo', run_id: `${old.manifest.run_id}-after-done`, start_phase: 'plan', end_phase: 'plan',
          requirement: old.manifest.requirement, unattended,
        }, { projectRoot: old.root });
        createGoalRun({ projectRoot: old.root, manifest: fresh, chain: ['plan'] });
        assert(fs.existsSync(path.join(old.root, fresh.report_dir, 'manifest.json')));
      } finally { fs.rmSync(old.root, { recursive: true, force: true }); }
    },
  },
  {
    name: 'fresh continuation guard: a failed terminal successor is judged instead of its ancestor',
    run: () => {
      const old = fixture('plan');
      try {
        const oldCreation = createGoalRun({ projectRoot: old.root, manifest: old.manifest, chain: ['plan'] });
        fs.appendFileSync(oldCreation.eventsPath, `${JSON.stringify({
          ts: '2026-09-20T10:00:00.000Z', type: 'run_end', status: 'HALTED', halt_reason: 'framework_bug',
        })}\n`, 'utf8');
        const successor = buildGoalManifestFromInput({
          feature: 'demo', run_id: `${old.manifest.run_id}-successor-failed`, start_phase: 'plan', end_phase: 'plan', unattended,
        }, { projectRoot: old.root });
        successor.successor_of = old.manifest.run_id;
        const successorCreation = createGoalRun({ projectRoot: old.root, manifest: successor, chain: ['plan'] });
        fs.appendFileSync(successorCreation.eventsPath, `${JSON.stringify(buildSupersedeAuditEvent({
          targetRunId: old.manifest.run_id, supersedingRunId: successor.run_id,
        }))}\n${JSON.stringify({
          ts: '2026-09-20T11:00:00.000Z', type: 'run_end', status: 'HALTED', halt_reason: 'no_progress_fuse',
        })}\n`, 'utf8');
        const fresh = buildGoalManifestFromInput({
          feature: 'demo', run_id: `${old.manifest.run_id}-after-failed`, start_phase: 'plan', end_phase: 'plan', unattended,
        }, { projectRoot: old.root });
        assert.throws(
          () => createGoalRun({ projectRoot: old.root, manifest: fresh, chain: ['plan'] }),
          new RegExp(`fresh run refused:.*${successor.run_id}.*no_progress_fuse`),
        );
      } finally { fs.rmSync(old.root, { recursive: true, force: true }); }
    },
  },
  {
    name: 'fresh continuation guard: only a hash-proven prior repair file change is a new fact',
    run: () => {
      const old = fixture('testing');
      try {
        old.manifest.requirement = '完成开卡需求';
        const sourceRel = 'entry/src/main/ets/OpenCard.ets';
        const sourceAbs = path.join(old.root, sourceRel);
        fs.mkdirSync(path.dirname(sourceAbs), { recursive: true });
        fs.writeFileSync(sourceAbs, 'old implementation', 'utf8');
        const oldHash = crypto.createHash('sha256').update(fs.readFileSync(sourceAbs)).digest('hex');
        const oldCreation = createGoalRun({ projectRoot: old.root, manifest: old.manifest, chain: ['testing'] });
        const summaryPath = path.join(old.root, old.manifest.report_dir, 'phases/testing/harness/summary.json');
        fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
        fs.writeFileSync(summaryPath, JSON.stringify({
          verdict: 'FAIL', repair_candidates: [{ id: 'visual_fix', files: [sourceRel] }],
        }), 'utf8');
        for (const event of [
          { ts: '2026-09-20T09:59:00.000Z', type: 'phase_write_observed', phase: 'testing', observations: [{ path: sourceRel, post_sha256: oldHash }] },
          { ts: '2026-09-20T09:59:30.000Z', type: 'phase_verdict', phase: 'testing', verdict: 'FAIL', action: 'halt' },
          { ts: '2026-09-20T10:00:00.000Z', type: 'run_end', status: 'HALTED', halt_reason: 'content_retry_exhausted' },
        ]) fs.appendFileSync(oldCreation.eventsPath, `${JSON.stringify(event)}\n`, 'utf8');

        fs.writeFileSync(path.join(old.root, 'notes.md'), 'agent rewrote notes', 'utf8');
        const unrelated = buildGoalManifestFromInput({
          feature: 'demo', run_id: `${old.manifest.run_id}-notes`, start_phase: 'testing', end_phase: 'testing',
          requirement: old.manifest.requirement, unattended,
        }, { projectRoot: old.root });
        assert.throws(() => createGoalRun({ projectRoot: old.root, manifest: unrelated, chain: ['testing'] }), /fresh run refused/);

        fs.writeFileSync(sourceAbs, 'fixed implementation', 'utf8');
        const repaired = buildGoalManifestFromInput({
          feature: 'demo', run_id: `${old.manifest.run_id}-repair`, start_phase: 'testing', end_phase: 'testing',
          requirement: old.manifest.requirement, unattended,
        }, { projectRoot: old.root });
        createGoalRun({ projectRoot: old.root, manifest: repaired, chain: ['testing'] });
        assert(fs.existsSync(path.join(old.root, repaired.report_dir, 'manifest.json')));
      } finally { fs.rmSync(old.root, { recursive: true, force: true }); }
    },
  },
];

// ---------------------------------------------------------------------------
// plan 4e6fb3b6 §7.2 / A11：接续决策四种结果与六种变化（纯函数；run 由生产 createGoalRun 出生，停机事件经生产写盘层投影）
// ---------------------------------------------------------------------------

const HOUR = 3_600_000;

/** 与 goalEvents 写盘同一形状：ts + 事件；带 halt_reason 的事件经生产 withRunDisposition 补处置投影。 */
function appendRunEvents(eventsPath: string, events: Array<Record<string, unknown>>): void {
  for (const event of events) fs.appendFileSync(eventsPath, `${JSON.stringify(withRunDisposition(event))}\n`, 'utf8');
}

function bornRun(root: string, requirement: string, suffix: string, extra: Partial<Parameters<typeof buildGoalManifestFromInput>[0]> = {}): ReturnType<typeof createGoalRun> & { manifest: ReturnType<typeof buildGoalManifestFromInput> } {
  const manifest = buildGoalManifestFromInput({
    feature: 'demo', run_id: `20260929T00000${suffix}Z-${suffix}${suffix}${suffix}`, start_phase: 'plan', end_phase: 'plan',
    requirement, unattended, ...extra,
  }, { projectRoot: root });
  return { ...createGoalRun({ projectRoot: root, manifest, chain: ['plan'], forceFresh: true }), manifest };
}

const at = (ms: number): string => new Date(ms).toISOString();
const started = (ms: number): Record<string, unknown> => ({ ts: at(ms), type: 'run_start', dry_run: false, session_started_at: at(ms), chain: ['plan'], manifest_hash: 'h' });
const halted = (ms: number, reason: string): Array<Record<string, unknown>> => [
  { ts: at(ms), type: 'phase_halt', phase: 'plan', halt_reason: reason, verdict: 'FAIL', halt_guidance: `原停止说明：${reason}` },
  { ts: at(ms), type: 'run_end', status: 'HALTED', halt_reason: reason },
];

function decisionCase(name: string, run: (root: string) => void): { name: string; run: () => void } {
  return {
    name: `P3 t5 A11 接续决策：${name}`,
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-continuation-'));
      try { run(root); } finally { fs.rmSync(root, { recursive: true, force: true }); }
    },
  };
}

const decide = (root: string, call: Parameters<typeof decideRunContinuation>[0]['call'] = {}, nowMs = Date.now()): RunContinuationDecision =>
  decideRunContinuation({ projectRoot: root, feature: 'demo', call, nowMs });

const T0 = Date.parse('2026-09-29T01:00:00.000Z');

cases.push(
  decisionCase('没有 run / 上一次完成之后没有未终局的 run → 新开', (root) => {
    assert.strictEqual(decide(root).kind, 'fresh');
    const done = bornRun(root, '完成开卡', '1');
    appendRunEvents(done.eventsPath, [started(T0), { ts: at(T0 + 10), type: 'run_end', status: 'CHAIN_SLICE_COMPLETED' }]);
    const d = decide(root, { requirement: '完成开卡' });
    assert.strictEqual(d.kind, 'fresh', JSON.stringify(d));
  }),
  decisionCase('最新的未终局 run 不是结构终局 → 重新接入（有正式开始走恢复；启动即失败走附着）', (root) => {
    const a = bornRun(root, '完成开卡', '1');
    appendRunEvents(a.eventsPath, [started(T0), ...halted(T0 + 10, 'framework_bug')]);
    let d = decide(root, { requirement: '完成开卡' }, T0 + HOUR);
    assert.deepStrictEqual([d.kind, d.kind === 'rejoin' && d.runId, d.kind === 'rejoin' && d.started], ['rejoin', a.manifest.run_id, true]);
    const b = bornRun(root, '完成开卡', '2');
    appendRunEvents(b.eventsPath, [
      { ts: at(T0 + 20), type: 'phase_halt', phase: 'plan', halt_reason: 'canary_cli_hard_failure', verdict: 'FAIL', halt_guidance: 'canary' },
      { ts: at(T0 + 20), type: 'run_end', status: 'HALTED', halt_reason: 'canary_cli_hard_failure', session_started_at: at(T0 + 15) },
    ]);
    d = decide(root, { requirement: '完成开卡' }, T0 + HOUR);
    assert.deepStrictEqual([d.kind, d.kind === 'rejoin' && d.runId, d.kind === 'rejoin' && d.started], ['rejoin', b.manifest.run_id, false], JSON.stringify(d));
  }),
  decisionCase('没有任何变化：结构终局 → 保持停止；非结构终局但仍在冷却期 → 保持停止（交还原停止说明）', (root) => {
    const a = bornRun(root, '完成开卡', '1');
    appendRunEvents(a.eventsPath, [started(T0), ...halted(T0 + 10, 'framework_bug')]);
    let d = decide(root, { requirement: '完成开卡' }, T0 + 60_000);
    assert.strictEqual(d.kind, 'hold', `冷却期内没有变化须保持停止：${JSON.stringify(d)}`);
    assert(d.kind === 'hold' && /约 \d+ 秒后再发起/.test(d.guidance), `无人值守的冷却须给出剩余秒数：${JSON.stringify(d)}`);
    // 调度方 2026-09-29 裁定：有人在场不设冷却——同一现场直接重新接入（条件是否解除交给原检查）
    const att = decide(root, { requirement: '完成开卡', attended: true }, T0 + 60_000);
    assert(att.kind === 'rejoin' && att.runId === a.manifest.run_id, `有人在场须直接重新接入：${JSON.stringify(att)}`);
    const b = bornRun(root, '完成开卡', '2');
    appendRunEvents(b.eventsPath, [started(T0 + 100), ...halted(T0 + 200, 'budget_wall_clock')]);
    d = decide(root, { requirement: '完成开卡' }, T0 + HOUR);
    assert.strictEqual(d.kind, 'hold', `结构终局且没有变化须保持停止：${JSON.stringify(d)}`);
    assert.strictEqual(decide(root, { requirement: '完成开卡', attended: true }, T0 + HOUR).kind, 'hold', '有人在场不改变结构终局的判定');
    assert(d.kind === 'hold' && d.runId === b.manifest.run_id && d.haltReason === 'budget_wall_clock' && d.guidance.includes('原停止说明：budget_wall_clock')
      && d.guidance.includes('重新发起同一请求'), JSON.stringify(d));
    assert(!/<run|run_id>|--supersede|--force-resume/.test(d.guidance), `说明不得要求枚举 run 或拼旗标：${d.kind === 'hold' ? d.guidance : ''}`);
  }),
  decisionCase('结构终局 + 需求增量 → 起后继；非结构终局 + 需求增量/新型号同样起后继（原 run 接不住）', (root) => {
    const a = bornRun(root, '完成开卡', '1');
    appendRunEvents(a.eventsPath, [started(T0), ...halted(T0 + 10, 'budget_wall_clock')]);
    let d = decide(root, { requirement: '完成开卡，并补充绑卡提示' }, T0 + HOUR);
    assert(d.kind === 'successor' && d.change === 'requirement_increment' && d.source === a.manifest.run_id, JSON.stringify(d));
    assert.strictEqual(decide(root, { requirement: '完成开卡' }, T0 + HOUR).kind, 'hold', '重发同一需求不是增量');
    const b = bornRun(root, '完成开卡', '2');
    appendRunEvents(b.eventsPath, [started(T0 + 100), ...halted(T0 + 200, 'framework_bug')]);
    d = decide(root, { requirement: '完成开卡', model: 'gpt-5.5' }, T0 + HOUR);
    assert(d.kind === 'successor' && d.change === 'model_changed', `非结构终局 + 新型号 → 后继：${JSON.stringify(d)}`);
  }),
  decisionCase('全量回归（甲）：从未正式开始过的 run 不作后继的合同来源——需求不同 → 新开；同一需求 → 附着；只换型号 → 仍起后继', (root) => {
    const a = bornRun(root, '完成开卡', '1');
    appendRunEvents(a.eventsPath, [
      { ts: at(T0), type: 'phase_halt', phase: 'plan', halt_reason: 'canary_cli_hard_failure', verdict: 'FAIL', halt_guidance: 'canary' },
      { ts: at(T0), type: 'run_end', status: 'HALTED', halt_reason: 'canary_cli_hard_failure' },
    ]);
    const d = decide(root, { requirement: '改成只做绑卡', attended: true }, T0 + HOUR);
    assert(d.kind === 'fresh' && !d.explicit, `从未开始过的 run 没有可继承的证据，需求不同须新开：${JSON.stringify(d)}`);
    const same = decide(root, { requirement: '完成开卡' }, T0 + HOUR);
    assert(same.kind === 'rejoin' && !same.started && same.runId === a.manifest.run_id, JSON.stringify(same));
    const model = decide(root, { requirement: '完成开卡', model: 'gpt-5.5' }, T0 + HOUR);
    assert(model.kind === 'successor' && model.change === 'model_changed' && model.source === a.manifest.run_id, JSON.stringify(model));
  }),
  decisionCase('R1 需求增量按全文判重：子串不算重复；合并过的需求里原请求与历史增量整段重发不算增量', (root) => {
    const a = bornRun(root, '不要启用通知', '1');
    appendRunEvents(a.eventsPath, [started(T0), ...halted(T0 + 10, 'budget_wall_clock')]);
    let d = decide(root, { requirement: '启用通知' }, T0 + HOUR);
    assert(d.kind === 'successor' && d.change === 'requirement_increment', `"启用通知"是"不要启用通知"的子串但不是重复：${JSON.stringify(d)}`);
    const b = bornRun(root, mergeSuccessorRequirement('完成开卡', '补绑卡提示'), '2');
    appendRunEvents(b.eventsPath, [started(T0 + 100), ...halted(T0 + 200, 'budget_wall_clock')]);
    for (const same of ['完成开卡', '补绑卡提示', '  完成开卡  ']) {
      d = decide(root, { requirement: same }, T0 + HOUR);
      assert.strictEqual(d.kind, 'hold', `整段重发不是增量（${same}）：${JSON.stringify(d)}`);
    }
    d = decide(root, { requirement: '开卡' }, T0 + HOUR);
    assert(d.kind === 'successor' && d.change === 'requirement_increment', `子串不是重复：${JSON.stringify(d)}`);
  }),
  decisionCase('R1 二轮：历史增量内部的片段不算重复；合并后的完整需求原样重发算重复', (root) => {
    const merged = mergeSuccessorRequirement('完成开卡', '禁止以下操作：\n启用通知');
    const a = bornRun(root, merged, '1');
    appendRunEvents(a.eventsPath, [started(T0), ...halted(T0 + 10, 'budget_wall_clock')]);
    let d = decide(root, { requirement: '启用通知' }, T0 + HOUR);
    assert(d.kind === 'successor' && d.change === 'requirement_increment', `历史增量内部的一行不是完整增量：${JSON.stringify(d)}`);
    d = decide(root, { requirement: merged }, T0 + HOUR);
    assert.strictEqual(d.kind, 'hold', `合并后的完整需求原样重发是重复：${JSON.stringify(d)}`);
    d = decide(root, { requirement: '禁止以下操作：\n启用通知' }, T0 + HOUR);
    assert.strictEqual(d.kind, 'hold', `整个历史增量块重发是重复：${JSON.stringify(d)}`);
  }),
  decisionCase('最终评审返修：本次需求已是合并格式——只在能确认时剥离已有内容，新增内容一字不丢、标记只一个', (root) => {
    const M = SUCCESSOR_REQUIREMENT_INCREMENT_MARKER;
    const source = mergeSuccessorRequirement('完成开卡', '增量一\n增量二');
    const count = (text: string | undefined): number => (text ?? '').split(M).length - 1;
    // 原请求段相同、增量段开头按整行等于整个历史块 → 只取其后的新增
    assert.strictEqual(deriveSuccessorRequirement(source, `完成开卡\n${M}\n增量一\n增量二\n新增三`), mergeSuccessorRequirement(source, '新增三'));
    // 去掉已有内容后什么都不剩 → 重复（换行不同也算）；决策同口径保持停止
    assert.notStrictEqual(`完成开卡\n\n${M}\n\n增量一\n增量二`, source, '夹具：字面与源不同');
    assert.strictEqual(deriveSuccessorRequirement(source, `完成开卡\n\n${M}\n\n增量一\n增量二`), source);
    const a = bornRun(root, source, '1');
    appendRunEvents(a.eventsPath, [started(T0), ...halted(T0 + 10, 'budget_wall_clock')]);
    assert.strictEqual(decide(root, { requirement: `完成开卡\n\n${M}\n增量一\n增量二` }, T0 + HOUR).kind, 'hold', '带标记且没有新内容须按重复处理');
    // 只对上历史块的一部分 / 子串 → 不剥离，整段保留（宁可重复，不丢需求）
    const partial = deriveSuccessorRequirement(source, `完成开卡\n${M}\n增量一\n新增三`);
    assert(partial!.endsWith('增量一\n新增三') && count(partial) === 1, `部分相同须整段保留：${partial}`);
    const sub = deriveSuccessorRequirement(source, `完成开卡\n${M}\n增量\n新增三`);
    assert(sub!.endsWith('增量\n新增三') && count(sub) === 1, `子串相同须整段保留：${sub}`);
    // 原请求段与源不同 → 那段文字也进结果；源里已有的历史增量不丢；重复标记去掉
    const other = deriveSuccessorRequirement(source, `完成开卡并绑卡\n${M}\n新增三\n${M}\n新增四`);
    assert(other!.startsWith(source) && other!.includes('完成开卡并绑卡') && other!.includes('新增三') && other!.includes('新增四') && count(other) === 1, `原请求段不同也不丢：${other}`);
    // 源没有历史增量时同样只取新增
    assert.strictEqual(deriveSuccessorRequirement('完成开卡', mergeSuccessorRequirement('完成开卡', '新增三')), mergeSuccessorRequirement('完成开卡', '新增三'));
  }),
  decisionCase('六种变化各一例（结构终局上）：需求来源、相关修复、需求增量、型号、预算、显式旗标', (root) => {
    const sourceRel = 'requirements/task.md';
    fs.mkdirSync(path.join(root, 'requirements'), { recursive: true });
    fs.writeFileSync(path.join(root, sourceRel), '旧需求', 'utf8');
    const productRel = 'entry/src/main/ets/OpenCard.ets';
    fs.mkdirSync(path.join(root, path.dirname(productRel)), { recursive: true });
    fs.writeFileSync(path.join(root, productRel), 'old implementation', 'utf8');
    const oldHash = crypto.createHash('sha256').update('old implementation').digest('hex');
    const a = bornRun(root, '旧需求', '1', { requirement_source_files: [sourceRel] });
    const summaryPath = path.join(root, a.manifest.report_dir, 'phases/plan/harness/summary.json');
    fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
    fs.writeFileSync(summaryPath, JSON.stringify({ verdict: 'FAIL', repair_candidates: [{ id: 'fix', files: [productRel] }] }), 'utf8');
    appendRunEvents(a.eventsPath, [
      started(T0),
      { ts: at(T0 + 1), type: 'phase_write_observed', phase: 'plan', observations: [{ path: productRel, post_sha256: oldHash }] },
      { ts: at(T0 + 2), type: 'phase_verdict', phase: 'plan', verdict: 'FAIL', action: 'halt' },
      ...halted(T0 + 10, 'budget_wall_clock'),
    ]);
    const now = T0 + HOUR;
    const changeOf = (call: Parameters<typeof decide>[1]): string => {
      const d = decide(root, call, now);
      return d.kind === 'successor' ? d.change : d.kind;
    };
    assert.strictEqual(changeOf({ requirement: '旧需求' }), 'hold', '夹具：没有变化时保持停止');
    assert.strictEqual(changeOf({ requirement: '旧需求', model: 'gpt-5.5' }), 'model_changed');
    assert.strictEqual(changeOf({ requirement: '旧需求，另加一句' }), 'requirement_increment');
    assert.strictEqual(changeOf({ requirement: '旧需求', budgetOverride: true }), 'hold', '只带授权旗标、预算没改不算变化');
    const manifestPath = path.join(root, a.manifest.report_dir, 'manifest.json');
    const onDisk = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { budget: { wall_clock_minutes: number } };
    onDisk.budget.wall_clock_minutes += 60;
    fs.writeFileSync(manifestPath, JSON.stringify(onDisk, null, 2), 'utf8');
    assert.strictEqual(changeOf({ requirement: '旧需求' }), 'hold', '预算改了但没有既有授权不算变化');
    assert.strictEqual(changeOf({ requirement: '旧需求', budgetOverride: true }), 'budget_changed');
    fs.writeFileSync(manifestPath, JSON.stringify({ ...onDisk, budget: { ...onDisk.budget, wall_clock_minutes: onDisk.budget.wall_clock_minutes - 60 } }, null, 2), 'utf8');
    fs.writeFileSync(path.join(root, sourceRel), '新需求', 'utf8');
    assert.strictEqual(changeOf({ requirement: '新需求', requirementSourceFiles: [sourceRel] }), 'requirement_source_changed');
    fs.writeFileSync(path.join(root, sourceRel), '旧需求', 'utf8');
    fs.writeFileSync(path.join(root, productRel), 'fixed implementation', 'utf8');
    assert.strictEqual(changeOf({ requirement: '旧需求' }), 'related_repair_changed');
    const sup = decide(root, { supersede: [a.manifest.run_id] }, now);
    assert(sup.kind === 'successor' && sup.explicit && sup.change === 'explicit_flag', JSON.stringify(sup));
    const force = decide(root, { force: true }, now);
    assert(force.kind === 'fresh' && force.explicit, JSON.stringify(force));
    const resume = decide(root, { resume: a.manifest.run_id }, now);
    assert(resume.kind === 'rejoin' && resume.explicit, JSON.stringify(resume));
  }),
);

export function runAll(): UnitCaseResult[] {
  return cases.map(test => {
    try { test.run(); return { name: test.name, ok: true }; }
    catch (error) { return { name: test.name, ok: false, error: (error as Error).stack ?? String(error) }; }
  });
}
