import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { UnitCaseResult } from '../run-unit';
import {
  buildGoalManifestFromInput,
  computeManifestIdentityFields,
  loadGoalManifestFromRun,
} from '../../scripts/utils/goal-manifest';
import {
  assertGoalRunAttachable,
  buildSupersedeAuditEvent,
  createGoalRun,
  inspectGoalRunCreation,
  validateRebaselineRequest,
} from '../../scripts/utils/goal-run-creation';
import {
  resolveManifestDriftDecision,
  resolveManifestIdentityBaseline,
} from '../../scripts/goal-runner';
import { buildAgentSpawnEnv } from '../../scripts/utils/agent-invoke';
import { classifyGoalRunsDir } from '../../scripts/utils/fidelity-shared';
import { resolveLatestRunId } from '../../scripts/utils/goal-progress';
import { hasGoalExecutionSignal, isAgentSideGoalHarness } from '../../scripts/utils/phase-state';

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
        assert.strictEqual(inspectGoalRunCreation(root, manifest).state, 'complete');
        assert.strictEqual(loadGoalManifestFromRun(root, manifest.run_id, { feature: 'demo' }).run_base_sha, SHA);
        assert('run_base_sha' in computeManifestIdentityFields(manifest));
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
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
];

export function runAll(): UnitCaseResult[] {
  return cases.map(test => {
    try { test.run(); return { name: test.name, ok: true }; }
    catch (error) { return { name: test.name, ok: false, error: (error as Error).stack ?? String(error) }; }
  });
}
