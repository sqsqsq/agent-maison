import { runUnitCasesAsync } from '../utils/unit-cases';
import '../utils/transpile-only-env';
import assert from 'assert';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as YAML from 'yaml';
import { clearFrameworkConfigCache, featureFilePath } from '../../config';
import { loadCanonicalBlueprint } from '../../scripts/utils/component-blueprint-path';
import { deriveChangeUnitFeatureId, loadCanonicalChangeUnit } from '../../scripts/utils/change-unit-path';
import { reconcileChangeUnitBlueprintRefs, BLUEPRINT_RECONCILE_LOCK_NAME } from '../../scripts/utils/change-unit-design-preparation';
import { diagnoseBlueprintSkillAuthority, deriveBlueprintSkillInput } from '../../scripts/utils/blueprint-skill-projection';
import { assessDesignQuestioning, writeBackAdmission, reusableDesignQuestioning, questioningDependencyChanges, questioningRunInputs, publishedDesignQuestioning } from '../../scripts/utils/design-repair-unattended';
import { applyIndependentQuestioningOutput, hasQuestioningCounterexampleSourceRule, mergeIndependentQuestioningResult, renderQuestioningResultInstructions, selectQuestioningScopes, validateBlueprintQuestioning } from '../../scripts/utils/blueprint-questioning';
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
    name: 'daily design Q: shared P0 writes need evidence of both operations and unrelated calls cannot stand in',
    run: async () => {
      const writeCheck = { id: 'AC-1', priority: 'P0', linked_flow: 'edit' };
      const clearCheck = { id: 'AC-2', priority: 'P0', linked_flow: 'edit' };
      const joint = { id: 'ordering', linked_acceptance: ['BD-1'], expected_port_calls: ['Port.load', 'Other.read'] };
      const flow = { flow_id: 'store', source_of_truth: { persistence: 'store' }, development_owner_ref: 'view:development/node:editor',
        external_contract_refs: ['contract:store'], mutations: [
          { mutation_id: 'one', persistence_ref: 'store', verification_refs: ['AC-1', 'BD-1'] },
          { mutation_id: 'two', persistence_ref: 'store', verification_refs: ['AC-2', 'BD-1'] },
        ] };
      const doc = { design_views: [{ view_id: 'runtime', applicability: 'applicable', evolution_impact: 'changed', runtime_data_flows: [flow] },
        { view_id: 'development', nodes: [{ node_id: 'editor',
          acceptance: { criteria: [writeCheck, clearCheck], boundaries: [{ id: 'BD-1', linked_flow: 'edit', linked_branch: 'ordering' }] },
          use_cases: { use_cases: [{ id: 'edit', branches: [
            { id: 'one', linked_acceptance: ['AC-1'], expected_port_calls: ['Port.edit'] },
            { id: 'two', linked_acceptance: ['AC-2'], expected_port_calls: ['Port.delete'] }, joint,
          ] }] },
        }] }], contracts: [{ contract_id: 'store', idempotency: { source_ref: 'contract.yaml#/idempotency', verification_refs: ['AC-1', 'AC-2'] } }] };
      const row = { scope_kind: 'flow', scope_ref: 'flow:store', disposition: 'answered_with_evidence',
        question: 'Do the writes permit the declared results?', owner: 'editor', answer: 'Independent response', evidence_refs: ['AC-1'], verification_refs: ['BD-1'] };
      const check = () => validateBlueprintQuestioning({ ...doc, review_summary: {
        questioning: mergeIndependentQuestioningResult(doc, { items: [row] }, 'independent'),
      }}).filter(issue => issue.id === 'blueprint_questioning_evidence_missing');
      assert.equal(check().length, 1);
      joint.expected_port_calls = ['Port.edit', 'Port.load'];
      assert.equal(check().length, 1);
      row.evidence_refs = ['AC-1', 'contract.yaml#/idempotency'];
      assert.equal(check().length, 1, 'a general idempotency locator does not sign the other P0 result');
      row.evidence_refs.push('AC-2');
      assert.equal(check().length, 0, 'the independent answer can use a contract premise plus both P0 results');
      row.evidence_refs[2] = '#/design_views/1/nodes/0/use_cases/use_cases/0/branches/1';
      assert.equal(check().length, 0, 'a uniquely located acceptance branch supplies its P0 result');
      row.evidence_refs = ['AC-1'];
      joint.expected_port_calls = ['Port.edit', 'Port.delete'];
      assert.equal(check().length, 0);
      row.verification_refs = ['AC-1'];
      assert.equal(check().length, 1, 'an independent answer covering one operation cannot be promoted');
    },
  },
  {
    name: 'daily design Q: same-file evidence must resolve in its declared range and optional lens rows can be absent',
    run: () => withProject(root => {
      const source = path.join(root, 'source.ets');
      fs.writeFileSync(source, 'one\ntwo\nthree\nfour\n');
      const row = { scope_kind: 'view', scope_ref: 'view:deployment', question: 'Any change?', owner: 'design', answer: 'Source unchanged',
        disposition: 'answered_with_evidence', evidence_refs: ['source.ets#L2-L3'], verification_refs: ['source.ets'] };
      const doc = { app_lens: { feature_flags: { disposition: 'answered_with_evidence' } },
        design_views: [{ view_id: 'deployment', applicability: 'applicable', evolution_impact: 'verified_unchanged',
        unchanged_evidence: { evidence_refs: ['source.ets'] } }] };
      const check = () => validateBlueprintQuestioning({ ...doc, review_summary: {
        questioning: mergeIndependentQuestioningResult(doc, { items: [row] }, 'independent'),
      }}, root).filter(issue => ['blueprint_questioning_unchanged_evidence_unrelated', 'blueprint_questioning_coverage_missing'].includes(issue.id));
      assert.deepEqual(check(), []);
      row.evidence_refs = ['source.ets#L2-L200'];
      assert.equal(check().length, 1);
      row.evidence_refs = ['elsewhere/source.ets#L2'];
      assert.equal(check().length, 1);
      doc.design_views[0].unchanged_evidence.evidence_refs = ['source.ets#L1-L2'];
      row.evidence_refs = ['source.ets#L3-L4'];
      assert.equal(check().length, 1);
      row.evidence_refs = ['source.ets#L2-L3'];
      assert.deepEqual(check(), []);
      doc.app_lens.feature_flags.disposition = 'blocker';
      assert(check().some(issue => issue.id === 'blueprint_questioning_coverage_missing' && issue.message.includes('app_lens:feature_flags')));
    }),
  },
  {
    name: 'daily design Q: receipt outside a requested scope cannot erase a negative and a second counterexample retains both',
    run: () => withProject(root => {
      const doc = { design_views: [{ view_id: 'runtime', applicability: 'applicable', evolution_impact: 'changed',
        runtime_data_flows: [{ flow_id: 'flow' }] }] };
      fs.writeFileSync(path.join(root, 'source.ets'), 'begin\nflush\nend\n');
      fs.writeFileSync(path.join(root, 'unrelated.ets'), 'unrelated\n');
      const evidence = { projectRoot: root, readSignedFile: (file: string) => path.relative(root, file) === 'source.ets' ? 'begin\nflush\nend\n' : undefined };
      const row = { scope_kind: 'flow', scope_ref: 'flow:flow', question: 'Lost result', answer: 'Late first completion', disposition: 'blocker',
        verification_refs: ['source.ets#L3'], review_original: { path: 'old-q.json', sha256: '7'.repeat(64) } };
      const old = { items: [row] };
      const apply = (result: typeof row, selected: string[] = []) => mergeIndependentQuestioningResult(doc, { items: [result] },
        'independent', old, selected, undefined, undefined, evidence).items as Json[];
      const [unchanged] = apply({ ...row, disposition: 'answered_with_evidence', question: 'New wording', answer: 'Everything passes' });
      assert.equal(unchanged.answer, row.answer);
      const invalid = { ...row, question: 'Suggested change', answer: 'Prefer a different persistence approach',
        verification_refs: ['flow:flow', '#/design_views/0/runtime_data_flows/0', 'source.ets'],
        evidence_refs: ['source.ets#L100', 'unrelated.ets#L1'] };
      assert.equal(apply(invalid)[0].answer, row.answer);
      assert.equal(apply(invalid, ['flow:flow'])[0].answer, invalid.answer, 'assigned scopes retain their existing independent decision path');
      const supported = { ...row, question: 'Wrong persistent value', answer: 'Delete overtaken at flush',
        verification_refs: ['flow:flow'], evidence_refs: ['source.ets#L2'] };
      assert.equal(apply({ ...supported, verification_refs: [] })[0].answer, row.answer);
      const [both] = apply(supported);
      assert(both.answer.includes(row.answer) && both.answer.includes('Delete overtaken at flush') && both.answer.includes('old-q.json'));
      assert.equal(both.disposition, 'blocker');
    }),
  },
  {
    name: 'daily design Q: a signed late denial stays open after its source changes or disappears',
    run: () => withProject(root => {
      const { canonicalPath, blueprint } = loadCanonicalBlueprint(root, BLUEPRINT);
      const file = path.join(root, 'late-source.ets');
      fs.writeFileSync(file, 'prepare\ncomplete\n');
      const signedBoundary = { projectRoot: root, protectedRoots: fs.readdirSync(root), executionRole: 'verifier' as const,
        immutableInputPaths: [], feature: BLUEPRINT, phaseOrder: [], domains: [], diagnostics: [], unresolvedSourcePhases: [] };
      const preSnapshot = capturePhaseInvocationSnapshot(signedBoundary);
      const previous = (blueprint as Json).review_summary.questioning;
      const selected = previous.items.find((item: Json) => item.scope_ref === 'view:development');
      const prior = previous.items.find((item: Json) => item.scope_ref === 'view:logical');
      const late = { ...prior, disposition: 'blocker', answer: 'Late completion overwrites the committed result.',
        verification_refs: [prior.scope_ref], evidence_refs: ['late-source.ets#L2'] };
      const input = { projectRoot: root, blueprintPath: canonicalPath, blueprint, previous, signedBoundary, preSnapshot, postSnapshot: preSnapshot,
        beforeBlueprint: fs.readFileSync(canonicalPath, 'utf8'), providerId: 'initial-design-questioning', completed: true,
        signedScopes: new Map([[selected.scope_ref, { kind: selected.scope_kind, questionId: selected.question_id }]]),
        output: JSON.stringify({ items: [selected, late] }) };
      const replay = (override: Partial<typeof input> & { requireCounterexampleSources?: boolean } = {}) => reusableDesignQuestioning({ ...input, ...override })?.items as Json[];
      const outputWith = (item: Json) => JSON.stringify({ items: [selected, item] });
      const denial = (result: Json[]) => result.find(item => item.scope_ref === prior.scope_ref);
      const issued = renderQuestioningResultInstructions(blueprint, input.providerId, [selected.scope_ref]);
      assert(hasQuestioningCounterexampleSourceRule(issued));
      const rule = issued.find(line => line.startsWith('已签范围以外的 blocker'))!;
      assert(!hasQuestioningCounterexampleSourceRule([rule, 'quote only', ...issued.filter(line => line !== rule)]));
      const original = denial(replay());
      assert.equal(original?.disposition, 'blocker');
      const absolute = { ...late, evidence_refs: [`${file}#L2`] };
      assert.equal(denial(replay({ output: outputWith(absolute) }))?.disposition, 'blocker');
      const pastEnd = { ...late, evidence_refs: ['late-source.ets#L999999'] };
      assert.equal(denial(replay({ output: outputWith(pastEnd) }))?.disposition, 'answered_with_evidence');
      fs.writeFileSync(path.join(root, 'not-signed.ets'), 'complete\n');
      const unsupported = { ...late, question: 'A different claim', answer: 'Suggested rewrite', evidence_refs: ['not-signed.ets#L1'] };
      assert.equal(denial(replay({ output: outputWith(unsupported) }))?.disposition, 'answered_with_evidence');
      assert.deepEqual(denial(replay({ output: outputWith(unsupported), previous: { items: replay() } })), original);
      for (const update of [() => fs.writeFileSync(file, 'fixed\n'), () => fs.unlinkSync(file)]) {
        update();
        const result = replay();
        assert.deepEqual(denial(result), original);
        assert.deepEqual(assessDesignQuestioning({ projectRoot: root, blueprintPath: canonicalPath, blueprint, beforeDocument: blueprint,
          beforeSnapshot: preSnapshot, previous: { items: result }, signedBoundary, revisitFindings: false }).selectedScopes, [prior.scope_ref]);
      }
      const legacy = { ...late, verification_refs: ['late-source.ets'], evidence_refs: [] };
      assert.equal(denial(replay({ output: outputWith(legacy) }))?.disposition, 'answered_with_evidence');
      assert.equal(denial(replay({ output: outputWith(legacy), requireCounterexampleSources: false }))?.disposition, 'blocker');
      const phase = 'design-repair-questioning', invoke = 'q-managed';
      const run = path.join(root, 'goal-runs', 'managed');
      const invocation = path.join('phases', phase, invoke);
      const request = path.join(invocation, 'request-e1.json');
      fs.mkdirSync(path.join(run, invocation), { recursive: true });
      const requestText = JSON.stringify({ invoke_id: invoke, purpose: 'questioning', write_boundary: signedBoundary,
        context: { phase, workInput: { material: { segments: issued } } } });
      fs.writeFileSync(path.join(run, request), requestText);
      fs.writeFileSync(path.join(run, 'events.jsonl'), JSON.stringify({ type: 'agent_invoke_start', phase, invoke_id: invoke,
        handoff_request: { path: request, sha256: createHash('sha256').update(requestText).digest('hex') } }) + '\n');
      const beforeApply = fs.readFileSync(canonicalPath, 'utf8');
      assert.throws(() => applyIndependentQuestioningOutput(canonicalPath, path.join(run, invocation, 'questioning-output.json'),
        outputWith(unsupported), input.providerId, root), /缺少可核原件/);
      assert.equal(fs.readFileSync(canonicalPath, 'utf8'), beforeApply, 'the managed receipt cannot fall back to the whole unverified answer');
      const legacyResult = applyIndependentQuestioningOutput(canonicalPath, path.join(root, 'legacy-output.json'), outputWith(legacy), input.providerId);
      assert.equal(denial(legacyResult.items as Json[])?.disposition, 'blocker');
    }),
  },
  {
    name: 'daily design Q: directory comparison uses snapshot members, with exact scope for addition and deletion',
    run: () => withProject(root => {
      const loaded = loadCanonicalBlueprint(root, BLUEPRINT), doc = loaded.blueprint as Json;
      const directory = path.join(root, 'dir');
      fs.mkdirSync(directory);
      fs.writeFileSync(path.join(directory, 'stable.txt'), 'same bytes');
      const answer = doc.review_summary.questioning.items[0];
      answer.evidence_refs.push('dir');
      answer.verification_refs.push('dir');
      const args = { projectRoot: root, blueprintPath: loaded.canonicalPath, blueprint: doc, beforeDocument: doc,
        previous: doc.review_summary.questioning, revisitFindings: false };
      const snap = () => capturePhaseInvocationSnapshot({ projectRoot: root, protectedRoots: fs.readdirSync(root), executionRole: 'verifier' });
      const initial = snap(), added = path.join(directory, 'added.txt');
      assert.deepEqual(assessDesignQuestioning({ ...args, beforeSnapshot: initial }).selectedScopes, []);
      fs.writeFileSync(added, 'new source');
      const next = snap();
      assert.deepEqual(assessDesignQuestioning({ ...args, beforeSnapshot: initial }).selectedScopes, [answer.scope_ref]);
      fs.unlinkSync(added);
      assert.deepEqual(assessDesignQuestioning({ ...args, beforeSnapshot: next }).selectedScopes, [answer.scope_ref]);
      const native = require('fs') as typeof fs, readdir = native.readdirSync;
      let enumerations = 0;
      try {
        native.readdirSync = ((file: fs.PathLike, ...options: unknown[]) => {
          if (path.resolve(String(file)) === directory) {
            enumerations++;
            throw Object.assign(new Error('simulated directory read failure'), { code: 'EACCES' });
          }
          return (readdir as (...input: unknown[]) => unknown)(file, ...options);
        }) as typeof fs.readdirSync;
        const failed = assessDesignQuestioning({ ...args, beforeSnapshot: initial });
        assert.deepEqual(failed.selectedScopes, [answer.scope_ref]);
        assert(failed.affectedDependencies.some(dep => dep.path === directory && dep.state === 'unknown'));
        assert.equal(enumerations, 1);
        assert.deepEqual(assessDesignQuestioning({ ...args, beforeSnapshot: initial, observedSnapshot: initial }).selectedScopes, []);
        assert.equal(enumerations, 1, 'use supplied snapshot without enumerating again');
      } finally { native.readdirSync = readdir; }
    }),
  },
  {
    name: 'daily design Q: publish changes the draft receipt, while signed CU content stays observable',
    run: () => withProject(root => {
      const { canonicalPath, blueprint } = loadCanonicalBlueprint(root, BLUEPRINT);
      const unit = loadCanonicalChangeUnit(root, BLUEPRINT, 'ledger-refresh');
      const run = path.join(path.dirname(path.dirname(canonicalPath)), 'goal-runs', 'r1');
      const draft = path.join(run, 'design-repair', 'component-blueprint.yaml'), cu = path.join(path.dirname(draft), 'change-unit.yaml');
      const architecture = path.join(path.dirname(draft), 'architecture.json');
      const relative = (file: string) => path.relative(root, file).replace(/\\/g, '/');
      const hash = (text: string) => createHash('sha256').update(text).digest('hex');
      const before = structuredClone(blueprint) as Json, current = structuredClone(blueprint) as Json;
      current.review_summary.admission = { status: 'pass' };
      const previous = structuredClone(before.review_summary.questioning);
      previous.items.find((item: Json) => item.scope_ref === 'view:logical').evidence_refs.push(relative(draft));
      previous.items.find((item: Json) => item.scope_ref === 'view:development').evidence_refs.push(relative(cu));
      previous.items.find((item: Json) => item.scope_ref === 'app_lens:module_boundaries').evidence_refs.push(relative(architecture));
      write(draft, before);
      fs.writeFileSync(cu, unit.bytes);
      const beforeArchitecture = JSON.stringify({ controls: ['current'] });
      fs.writeFileSync(architecture, beforeArchitecture);
      const context = JSON.stringify({ baseline: fs.readFileSync(canonicalPath).toString('base64') });
      fs.writeFileSync(path.join(run, 'design-repair/original-context.json'), context);
      const signedBoundary = { projectRoot: root, protectedRoots: fs.readdirSync(root), executionRole: 'verifier' as const,
        immutableInputPaths: [relative(path.dirname(draft))], feature: BLUEPRINT, phaseOrder: [], domains: [], diagnostics: [], unresolvedSourcePhases: [] };
      const pre = capturePhaseInvocationSnapshot(signedBoundary);
      const identity = { type: 'design_authority_repair', phase: 'initial-design', signature: 'repair', blueprint_id: BLUEPRINT };
      const original = { invokeId: 'q1', completed: true, output: '', source: '', beforeSource: '', providerId: 'design-repair-questioning', beforeDocument: before, requireCounterexampleSources: false,
        beforeBlueprint: fs.readFileSync(draft, 'utf8'), preSnapshot: pre, signedBoundary,
        additionalInputs: { [cu]: unit.bytes.toString('utf8'), [architecture]: beforeArchitecture } };
      const attempted = { ...identity, stage: 'attempted', preauthorization: `${relative(run)}/manifest.json#requirement`,
        handoff_context: { path: 'design-repair/original-context.json', sha256: hash(context) } };
      const invoked = { type: 'agent_invoke_start', phase: 'design-repair-questioning', invoke_id: 'q1', handoff_request: { path: 'request.json', sha256: hash('signed') } };
      const completed = { type: 'agent_invoke_end', phase: invoked.phase, invoke_id: invoked.invoke_id };
      const published = { ...identity, stage: 'published', new_revision: current.revision, admission_after_questioning: 'pass', files: [relative(canonicalPath)] };
      const events = [attempted, invoked, completed, published];
      const proof = publishedDesignQuestioning(run, events, original, canonicalPath, current, root);
      assert(proof?.changeUnit, 'signed publisher connects the candidate CU and its canonical authority');
      assert.equal(publishedDesignQuestioning(run, events.slice(0, -1), original, canonicalPath, current, root), undefined);
      const unrelatedPublication = { ...published, signature: 'different' };
      assert.equal(publishedDesignQuestioning(run, [attempted, invoked, completed, unrelatedPublication], original, canonicalPath, current, root), undefined);
      write(draft, current);
      write(canonicalPath, current);
      write(unit.canonicalPath, { ...unit.changeUnit, revision: Number(unit.changeUnit.revision) + 1 });
      const input = { projectRoot: root, blueprintPath: canonicalPath, blueprint: current, beforeDocument: before, beforeSnapshot: pre,
        previous, signedBoundary, revisitFindings: false };
      assert.deepEqual(assessDesignQuestioning(input).selectedScopes, ['view:logical']);
      assert.deepEqual(assessDesignQuestioning({ ...input, publishedRepair: proof }).selectedScopes, []);
      const initialBoundary = { ...signedBoundary, immutableInputPaths: [] };
      const snapshotOptions = { runtimeExcluded: [relative(run)] };
      const observedInitial = capturePhaseInvocationSnapshot(initialBoundary, snapshotOptions);
      const observedLater = capturePhaseInvocationSnapshot(signedBoundary);
      assert.deepEqual(assessDesignQuestioning({ ...input, publishedRepair: proof, observedSnapshot: observedInitial,
        observedSnapshotBoundary: initialBoundary, observedSnapshotOptions: snapshotOptions }).selectedScopes, []);
      fs.writeFileSync(architecture, JSON.stringify({ controls: ['changed'] }));
      assert.deepEqual(assessDesignQuestioning({ ...input, publishedRepair: proof, observedSnapshot: observedInitial,
        observedSnapshotBoundary: initialBoundary, observedSnapshotOptions: snapshotOptions }).selectedScopes, ['app_lens:module_boundaries']);
      fs.writeFileSync(architecture, beforeArchitecture);
      const initial = { ...input, signedBoundary: initialBoundary, snapshotOptions, beforeSnapshot: observedInitial, observedSnapshot: observedLater,
        previous: { items: previous.items.filter((item: Json) => item.scope_ref === 'view:development') } };
      assert.deepEqual(assessDesignQuestioning(initial).selectedScopes, ['view:development']);
      assert.deepEqual(assessDesignQuestioning({ ...initial, publishedRepair: proof }).selectedScopes, []);
      write(unit.canonicalPath, { ...unit.changeUnit, safe_intermediate_state: 'changed official CU commitment' });
      assert.deepEqual(assessDesignQuestioning({ ...input, publishedRepair: proof }).selectedScopes, ['view:development']);
      write(unit.canonicalPath, unit.changeUnit);
      fs.appendFileSync(cu, '\n# actual changes must remain observable\n');
      assert.deepEqual(assessDesignQuestioning({ ...input, publishedRepair: proof }).selectedScopes, ['view:development']);
      write(draft, { ...current, component_id: 'not-the-published-blueprint' });
      assert.deepEqual(assessDesignQuestioning({ ...input, publishedRepair: proof }).selectedScopes, ['view:logical', 'view:development']);
    }),
  },
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
    name: 'daily design runtime: process artifacts do not shadow a referenced independent report or a missing original',
    run: () => withProject(root => {
      const { canonicalPath, blueprint } = loadCanonicalBlueprint(root, BLUEPRINT);
      const result = structuredClone((blueprint as Json).review_summary.questioning);
      const item = result.items[0];
      const carrier = 'doc/features/ledger-app-blueprint/goal-runs/r1/phases/';
      const preimage = carrier + 'initial-design-questioning/q1/blueprint-before.yaml';
      const counterproof = carrier + 'review/r2/review-report.md';
      const original = carrier + 'initial-design-questioning/q1/questioning-output.json';
      write(path.join(root, preimage), blueprint);
      item.verification_refs.push(preimage, counterproof);
      const resolution = { projectRoot: root, protectedRoots: fs.readdirSync(root), executionRole: 'verifier' as const };
      const inputs = questioningRunInputs(root, blueprint, result);
      assert.deepEqual(inputs, [path.resolve(root, counterproof)]);
      const otherInputs = questioningDependencyChanges(root, blueprint, undefined, canonicalPath, undefined, result)
        .filter(dep => dep.exists).map(dep => dep.path);
      const snapshot = () => capturePhaseInvocationSnapshot(resolution, { includeFiles: [...inputs, ...otherInputs] });
      const before = snapshot();
      const selected = (snapshot = before) => selectQuestioningScopes(blueprint, blueprint, result,
        questioningDependencyChanges(root, blueprint, snapshot, canonicalPath, undefined, result)
          .filter(dep => dep.exists || dep.recorded).map(dep => dep.path), root);
      assert.deepEqual(selected(), []);
      write(path.join(root, counterproof), 'Independent review observed the handoff break.');
      assert.deepEqual(selected(), [item.scope_ref]);
      const reviewed = snapshot();
      assert.deepEqual(selected(reviewed), []);
      item.review_original = { path: original, sha256: 'a'.repeat(64) };
      assert.deepEqual(selected(reviewed), [item.scope_ref]);
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
