import { runUnitCasesAsync } from '../utils/unit-cases';
import '../utils/transpile-only-env';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as YAML from 'yaml';
import { clearFrameworkConfigCache, featureFilePath } from '../../config';
import { loadCanonicalBlueprint } from '../../scripts/utils/component-blueprint-path';
import { deriveChangeUnitFeatureId } from '../../scripts/utils/change-unit-path';
import { reconcileChangeUnitBlueprintRefs, BLUEPRINT_RECONCILE_LOCK_NAME } from '../../scripts/utils/change-unit-design-preparation';
import { diagnoseBlueprintSkillAuthority, deriveBlueprintSkillInput } from '../../scripts/utils/blueprint-skill-projection';
import { writeBackAdmission, reusableDesignQuestioning, questioningDependencyChanges } from '../../scripts/utils/design-repair-unattended';
import { capturePhaseInvocationSnapshot, diffPhaseInvocationSnapshots } from '../../scripts/utils/phase-write-boundary';
import { tryAcquireLock, releaseLock, FEATURE_LOCK_NAME } from '../../scripts/utils/goal-run-lock';
import { fixture as projectionFixture } from './blueprint-skill-projection.unit.test';

type Json = Record<string, any>;
const FRAMEWORK = path.resolve(__dirname, '../../..'), BLUEPRINT = 'ledger-app-blueprint';
const FEATURE = deriveChangeUnitFeatureId(BLUEPRINT, 'ledger-refresh');
const read = (file: string): Json => YAML.parse(fs.readFileSync(file, 'utf8'));
const write = (file: string, value: unknown): void => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, YAML.stringify(value)); };
const node = (doc: Json): Json => {
  const find = (value: any): Json | undefined => {
    if (!value || typeof value !== 'object') return undefined;
    if (value.node_id === 'ledger-domain') return value;
    for (const child of Object.values(value)) { const found = find(child); if (found) return found; }
    return undefined;
  };
  const found = find(doc); assert(found, 'valid fixture contains ledger-domain'); return found;
};

async function withProject(run: (root: string, fixture: ReturnType<typeof projectionFixture>) => void | Promise<void>): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'design-repair-daily-'));
  const fixture = projectionFixture(root); // Approved author input only; no goal result or completion is supplied.
  fs.writeFileSync(path.join(root, 'framework.config.json'), JSON.stringify({ schema_version: '1.1', project_name: 'design repair boundaries',
    project_profile: { name: 'generic' }, active_workflow: 'obligation-driven', paths: { features_dir: 'doc/features' },
    architecture: { outer_layers: [{ id: 'src', can_depend_on: [] }], module_inner_layers: ['shared', 'data', 'domain', 'presentation'], inner_dependency_direction: 'upward', cross_module_exports_file: 'index.ts' } }));
  try { clearFrameworkConfigCache(); await run(root, fixture); }
  finally { clearFrameworkConfigCache(); assert.equal(path.dirname(root), path.resolve(os.tmpdir())); fs.rmSync(root, { recursive: true, force: true }); }
}

const cases: Array<{ name: string; run: () => Promise<void> }> = [
  {
    name: 'daily design content: actual malformed authority is diagnosed and the owner repair restores projection',
    run: () => withProject(root => {
      const loaded = loadCanonicalBlueprint(root, BLUEPRINT), original = fs.readFileSync(loaded.canonicalPath);
      const before = deriveBlueprintSkillInput(root, FEATURE, FRAMEWORK, 'acceptance');
      assert.equal(before.state, 'resolved', JSON.stringify(before));
      const doc = read(loaded.canonicalPath); node(doc).acceptance = '当前验收误写成一段文字';
      write(loaded.canonicalPath, doc); reconcileChangeUnitBlueprintRefs(root, BLUEPRINT);
      const broken = diagnoseBlueprintSkillAuthority(root, FRAMEWORK, FEATURE);
      assert(broken.findings.some(finding => finding.codes.includes('authority_content_not_machine_structure')), JSON.stringify(broken));
      fs.writeFileSync(loaded.canonicalPath, original); reconcileChangeUnitBlueprintRefs(root, BLUEPRINT);
      assert.equal(deriveBlueprintSkillInput(root, FEATURE, FRAMEWORK, 'acceptance').state, 'resolved');
    }),
  },
  {
    name: 'daily design content: author self-reported admission cannot hide missing required design evidence',
    run: () => withProject(root => {
      const loaded = loadCanonicalBlueprint(root, BLUEPRINT), doc = structuredClone(loaded.blueprint) as Json;
      doc.review_summary.questioning.items = [];
      doc.review_summary.admission = { status: 'pass', root_questions_complete: true, current_slice: { contracts_ready: true, design_refs_ready: true }, blocker_refs: [] };
      const derived = writeBackAdmission(doc, { projectRoot: root, canonicalPath: loaded.canonicalPath });
      assert.equal(derived.status, 'blocker'); assert.equal(doc.review_summary.admission.status, 'blocker');
      assert(doc.review_summary.admission.blocker_refs.length > 0);
    }),
  },
  {
    name: 'daily design content: independent Q reuse requires a completed read-only original and retains a real blocker',
    run: () => withProject(root => {
      const loaded = loadCanonicalBlueprint(root, BLUEPRINT), doc = loaded.blueprint as Json;
      const pre = capturePhaseInvocationSnapshot({ projectRoot: root, protectedRoots: ['doc', 'src', 'requirements', 'contracts'] });
      const input = { projectRoot: root, blueprintPath: loaded.canonicalPath, blueprint: doc, beforeBlueprint: fs.readFileSync(loaded.canonicalPath, 'utf8'),
        output: JSON.stringify(doc.review_summary.questioning), providerId: 'independent-design-questioning', completed: true, preSnapshot: pre, postSnapshot: pre };
      assert(reusableDesignQuestioning(input), 'current independent fixture Q has a usable read-only original');
      assert.equal(reusableDesignQuestioning({ ...input, completed: false }), null);
      assert.equal(reusableDesignQuestioning({ ...input, preSnapshot: undefined }), null);
      const changed = structuredClone(doc); changed.title = 'actual design change';
      assert.equal(reusableDesignQuestioning({ ...input, blueprint: changed }), null);
      const denial = structuredClone(doc.review_summary.questioning); denial.items[0].disposition = 'blocker';
      denial.items[0].answer = '当前必需设计仍缺原批准职责的依据，不允许降级验收。';
      const retained = reusableDesignQuestioning({ ...input, output: JSON.stringify(denial) }) as Json;
      assert(retained?.items.some((item: Json) => item.disposition === 'blocker' && item.answer === denial.items[0].answer));
    }),
  },
  {
    name: 'daily design content: changing only a knowledge asset invalidates positive Q while retaining real denial',
    run: () => withProject(root => {
      const loaded = loadCanonicalBlueprint(root, BLUEPRINT), doc = loaded.blueprint as Json;
      const relative = 'doc/glossary.yaml', file = path.join(root, relative);
      fs.writeFileSync(file, 'terms: []\n');
      doc.discovery.inputs.knowledge_assets.push(relative); write(loaded.canonicalPath, doc);
      const generated = path.join(root, 'doc/component-index.yaml'); fs.writeFileSync(generated, 'generated: before\n');
      doc.discovery.inputs.knowledge_assets.push('doc/component-index.yaml'); write(loaded.canonicalPath, doc);
      const pre = capturePhaseInvocationSnapshot({ projectRoot: root, protectedRoots: ['doc', 'src', 'requirements', 'contracts'] });
      const input = { projectRoot: root, blueprintPath: loaded.canonicalPath, blueprint: doc,
        beforeBlueprint: fs.readFileSync(loaded.canonicalPath, 'utf8'), output: JSON.stringify(doc.review_summary.questioning),
        providerId: 'independent-design-questioning', completed: true, preSnapshot: pre, postSnapshot: pre };
      assert(reusableDesignQuestioning(input));
      fs.writeFileSync(generated, 'generated: after construction\n');
      assert(reusableDesignQuestioning(input), 'machine index refresh is not a business knowledge writer change');
      fs.appendFileSync(file, '# actual writer change without any blueprint change\n');
      assert.equal(reusableDesignQuestioning(input), null);
      assert(questioningDependencyChanges(root, doc, pre, loaded.canonicalPath).some(entry => path.resolve(entry.path) === file));
      const denial = structuredClone(doc.review_summary.questioning); denial.items[0].disposition = 'blocker';
      assert(reusableDesignQuestioning({ ...input, output: JSON.stringify(denial) }), 'effective denial still goes directly to the author');
    }),
  },
  {
    name: 'daily design runtime: snapshot distinguishes authorized draft and own heartbeat from protected input writes',
    run: () => withProject(root => {
      const draft = 'doc/features/repair/goal-runs/current/design-repair/draft.yaml', own = 'doc/features/repair/goal-runs/current/liveness.json';
      for (const file of [draft, own]) { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), 'before'); }
      const resolution = { projectRoot: root, protectedRoots: ['doc', 'src', 'requirements', 'framework.config.json'], executionRole: 'author' as const };
      const options = { ownedPrefixes: [path.dirname(draft)], runtimeExcluded: [own] };
      const before = capturePhaseInvocationSnapshot(resolution, options);
      fs.writeFileSync(path.join(root, draft), 'actual draft'); fs.writeFileSync(path.join(root, own), 'actual heartbeat');
      assert.equal(diffPhaseInvocationSnapshots(before, capturePhaseInvocationSnapshot(resolution, options)).kind, 'clean');
      const requirement = path.join(root, 'requirements/ledger.md'); fs.appendFileSync(requirement, '\nunauthorized requirement change\n');
      const change = diffPhaseInvocationSnapshots(before, capturePhaseInvocationSnapshot(resolution, options));
      assert(change.kind === 'changed' && change.changes.some(row => row.path === 'requirements/ledger.md'));
    }),
  },
  {
    name: 'daily design runtime: unreadable protected input is unverifiable rather than clean',
    run: () => withProject(root => {
      const target = path.join(root, 'requirements/ledger.md');
      const resolution = { projectRoot: root, protectedRoots: ['requirements'] };
      const before = capturePhaseInvocationSnapshot(resolution), nativeFs = require('fs') as typeof fs, readFile = fs.readFileSync;
      try {
        nativeFs.readFileSync = ((file: fs.PathOrFileDescriptor, ...args: any[]) => {
          if (typeof file !== 'number' && path.resolve(String(file)) === target) throw Object.assign(new Error('controlled EACCES'), { code: 'EACCES' });
          return (readFile as any)(file, ...args);
        }) as typeof fs.readFileSync;
        const after = capturePhaseInvocationSnapshot(resolution);
        assert(after.failureReason); assert.equal(diffPhaseInvocationSnapshots(before, after).kind, 'unverifiable');
      } finally { nativeFs.readFileSync = readFile; }
    }),
  },
  {
    name: 'daily design runtime: a newly referenced normally excluded input remains an unknown original',
    run: () => withProject(root => {
      const loaded = loadCanonicalBlueprint(root, BLUEPRINT), before = capturePhaseInvocationSnapshot({ projectRoot: root, protectedRoots: ['doc', 'src', 'requirements', 'contracts'] });
      const file = path.join(root, 'context/new-contract.yaml'); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'newly referenced original\n');
      const doc = structuredClone(loaded.blueprint) as Json; node(doc).contracts.source_ref = 'context/new-contract.yaml';
      const changed = questioningDependencyChanges(root, doc, before, loaded.canonicalPath);
      assert(changed.some(entry => path.resolve(entry.path) === file && entry.exists), JSON.stringify(changed));
    }),
  },
  {
    name: 'daily design runtime: failed second lock releases owned locks and retains the borrowed feature lock',
    run: () => withProject(root => {
      const doc = loadCanonicalBlueprint(root, BLUEPRINT); const changed = structuredClone(doc.blueprint) as Json; changed.revision++;
      for (const result of changed.derived_results ?? []) result.input_revision = changed.revision;
      write(doc.canonicalPath, changed);
      const lockPath = (id: string) => featureFilePath(root, deriveChangeUnitFeatureId(BLUEPRINT, id), path.join('goal-runs', FEATURE_LOCK_NAME));
      const borrowedPath = lockPath('ledger-refresh'), contenderPath = lockPath('ledger-recovery');
      const blueprintLock = path.join(featureFilePath(root, BLUEPRINT, ''), BLUEPRINT_RECONCILE_LOCK_NAME);
      const lent = tryAcquireLock(borrowedPath, { run_id: 'actual-caller' }); assert(lent);
      const borrowedBytes = fs.readFileSync(borrowedPath);
      const nativeFs = require('fs') as typeof fs, link = fs.linkSync;
      const competitor: { lock: ReturnType<typeof tryAcquireLock>; bytes?: Buffer } = { lock: null };
      const options = { heldFeatureLocks: [{ path: borrowedPath, ownerId: lent.ownerId }] };
      try {
        nativeFs.linkSync = (source, destination) => {
          if (competitor.lock || path.resolve(String(destination)) !== path.resolve(contenderPath)) return link(source, destination);
          assert(fs.existsSync(blueprintLock) && fs.existsSync(lockPath('ledger-consumer')), 'the reconciler must already own both preceding locks');
          nativeFs.linkSync = link;
          competitor.lock = tryAcquireLock(contenderPath, { run_id: 'competing-caller' }); assert(competitor.lock);
          competitor.bytes = fs.readFileSync(contenderPath);
          throw Object.assign(new Error('controlled lock EACCES'), { code: 'EACCES' });
        };
        assert.throws(() => reconcileChangeUnitBlueprintRefs(root, BLUEPRINT, options), /EACCES/);
        assert(competitor.lock && competitor.bytes);
        assert.deepEqual(fs.readFileSync(borrowedPath), borrowedBytes, 'the borrowed lock stays owned by its caller');
        assert.deepEqual(fs.readFileSync(contenderPath), competitor.bytes, 'the failed publication cannot remove a competing lock');
        assert(!fs.existsSync(blueprintLock));
        for (const id of ['ledger-consumer', 'ledger-summary']) assert(!fs.existsSync(lockPath(id)));
        releaseLock(contenderPath, competitor.lock.ownerId);
        const retry = reconcileChangeUnitBlueprintRefs(root, BLUEPRINT, options);
        assert(!retry.busy && retry.bumped.length === 4, JSON.stringify(retry));
      } finally {
        nativeFs.linkSync = link;
        if (competitor.lock) releaseLock(contenderPath, competitor.lock.ownerId);
        releaseLock(borrowedPath, lent.ownerId);
      }
    }),
  },
];

export const runAll = () => runUnitCasesAsync(cases);
if (require.main === module) void runAll().then(result => { console.log(JSON.stringify(result, null, 2)); process.exitCode = result.some(row => !row.ok) ? 1 : 0; });
