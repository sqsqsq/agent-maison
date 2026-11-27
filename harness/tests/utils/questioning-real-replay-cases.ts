import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import { gunzipSync } from 'zlib';
import { clearFrameworkConfigCache } from '../../config';
import { asRecord, asRecords, asStrings, blueprintAuthorContent, BlueprintRecord } from '../../scripts/utils/component-blueprint-model';
import { stableAddressIndex } from '../../scripts/utils/blueprint-addressing';
import { requiredQuestioningScopes, selectQuestioningScopes, validateBlueprintQuestioning } from '../../scripts/utils/blueprint-questioning';
import { questioningDependencyChanges } from '../../scripts/utils/design-repair-unattended';
import { stableStringify } from '../../scripts/utils/phase-evidence-manifest';

const DIRECTORY = path.resolve(__dirname, '../fixtures/host-recovery-history/20261115-design-recovery/scope-replays');
const PAIRS = [[3, 5], [6, 8], [13, 15], [15, 17], [8, 10], [10, 13]] as const;
type FixtureRecord = Record<string, any>;

// The archived R3 range and facts remain immutable. Only these independently located edges differ today.
const PRECISE_SCOPE_CHANGES: Record<string, { retainRelations?: string[]; recheck?: Array<{ lens: string; id: string; field: string; via?: string }> }> = {
  '3:5': { recheck: [{ lens: 'process_recovery', id: 'BD-4', field: 'expected_behavior' }] },
  '13:15': {
    retainRelations: ['bank-catalog-realized', 'card-catalog-realized'],
    recheck: [{ lens: 'process_recovery', id: 'BD-4', field: 'handling' }],
  },
  '15:17': {
    retainRelations: ['bank-catalog-realized', 'card-catalog-realized', 'open-session-realized'],
    recheck: [
      { lens: 'ui_refresh', id: 'AC-11', field: 'verification_steps' },
      { lens: 'feature_flags', id: 'AC-11', field: 'verification_steps', via: 'decision:decision-home-override-priority' },
    ],
  },
  '8:10': {
    retainRelations: ['bank-catalog-realized', 'card-catalog-realized', 'open-session-realized', 'app-deployed'],
    recheck: [{ lens: 'data_producers_consumers', id: 'AC-8', field: 'expected_result', via: 'contract:card-store' }],
  },
  '10:13': {
    retainRelations: ['bank-catalog-realized', 'card-catalog-realized', 'card-record-realized', 'open-session-realized',
      'home-state-realized', 'app-deployed', 'rdb-deployed'],
  },
};

function preciseScopeEdits(first: number, revised: number, before: BlueprintRecord, next: BlueprintRecord) {
  const changes = PRECISE_SCOPE_CHANGES[`${first}:${revised}`];
  const retain = (changes?.retainRelations ?? []).map(id => `relation:rel-${id}`);
  const old = stableAddressIndex(blueprintAuthorContent(before));
  const current = stableAddressIndex(blueprintAuthorContent(next));
  for (const address of retain) {
    const relation = old.get(address)!;
    assert.equal(stableStringify(current.get(address)), stableStringify(relation), address);
    for (const endpoint of [relation.from, relation.to]) {
      assert(old.has(String(endpoint)), 'retained relation must locate both stable endpoints');
      assert.equal(stableStringify(current.get(String(endpoint))), stableStringify(old.get(String(endpoint))), String(endpoint));
    }
  }
  const recheck = (changes?.recheck ?? []).map(({ lens, id, field, via }) => {
    const ref = `acceptance:${id}`;
    const consumer = asRecord(asRecord(next.app_lens)?.[lens]);
    assert(asStrings(consumer?.evidence_refs).includes(via ?? ref), lens);
    if (via) assert(stableStringify(current.get(via)).includes(JSON.stringify(ref)), `${via} → ${ref}`);
    const criterion = (index: typeof old) => {
      const acceptance = asRecord(index.get('view:development/node:dev-add-card-result-page')?.acceptance);
      return [...asRecords(acceptance?.criteria), ...asRecords(acceptance?.boundaries)].find(item => item.id === id);
    };
    assert(criterion(old)?.[field] !== undefined && criterion(current)?.[field] !== undefined, `${id}.${field}`);
    assert.notEqual(stableStringify(criterion(old)?.[field]), stableStringify(criterion(current)?.[field]), `${id}.${field}`);
    return `app_lens:${lens}`;
  });
  return { retain, recheck };
}
function readInputs() {
  const bytes = gunzipSync(fs.readFileSync(path.join(DIRECTORY, 'inputs.json.gz')));
  const evidence = JSON.parse(fs.readFileSync(path.join(DIRECTORY, 'sources-and-results.json'), 'utf8')) as FixtureRecord;
  assert.equal(createHash('sha256').update(bytes).digest('hex'), evidence.bundleSha256, 'historical projection bytes changed');
  return { inputs: JSON.parse(bytes.toString('utf8')) as FixtureRecord, evidence };
}
function scopeFacts(blueprint: BlueprintRecord): Map<string, unknown> {
  return new Map([
    ...asRecords(blueprint.design_views).flatMap(view => [[`view:${view.view_id}`, view] as [string, unknown],
      ...asRecords(view.runtime_data_flows).map(flow => [`flow:${flow.flow_id}`, flow] as [string, unknown])]),
    ...asRecords(blueprint.relations).map(relation => [`relation:${relation.relation_id}`, relation] as [string, unknown]),
    ...Object.entries(asRecord(blueprint.app_lens) ?? {}).map(([key, value]) => [`app_lens:${key}`, value] as [string, unknown]),
    ['terminology:current_scope_items', asRecord(blueprint.discovery)?.inputs] as [string, unknown],
  ]);
}
function withHistory<T>(run: (root: string, inputs: FixtureRecord, evidence: FixtureRecord) => T): T {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'questioning-real-history-')));
  try {
    fs.writeFileSync(path.join(root, 'framework.config.json'), JSON.stringify({ schema_version: '1.0', project_name: 'HistoricalScopeReplay',
      project_profile: { name: 'hmos-app' }, paths: { features_dir: 'doc/features' } }));
    clearFrameworkConfigCache();
    const { inputs, evidence } = readInputs();
    return run(root, inputs, evidence);
  } finally {
    clearFrameworkConfigCache();
    assert(root.startsWith(fs.realpathSync(os.tmpdir()) + path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  }
}
function dependencies(root: string, before: FixtureRecord, current: FixtureRecord): string[] {
  const own = path.join(root, 'doc/features/bc-openCard-2/blueprint/component-blueprint.yaml');
  fs.mkdirSync(path.dirname(own), { recursive: true });
  fs.writeFileSync(path.join(path.dirname(own), 'component-blueprint.review.md'), current.reviewHeader.text);
  return questioningDependencyChanges(root, current.blueprint, before.preSnapshot, own, current.preSnapshot, before.previous)
    .map(item => path.relative(root, item.path).replace(/\\/g, '/'));
}
function pointer(document: unknown, address: string): unknown {
  return address.slice(1).split('/').reduce((value: any, key) => value?.[key.replace(/~1/g, '/').replace(/~0/g, '~')], document);
}
function setPointer(document: FixtureRecord, address: string, value: unknown): void {
  const split = address.lastIndexOf('/');
  const parent = pointer(document, address.slice(0, split)) as FixtureRecord;
  parent[address.slice(split + 1).replace(/~1/g, '/').replace(/~0/g, '~')] = value;
}
function verifyReason(scope: string, expected: FixtureRecord, before: FixtureRecord, current: FixtureRecord,
  changes: string[], pending: string[], oldFacts: Map<string, unknown>, newFacts: Map<string, unknown>, visited = new Set<string>()): void {
  assert(!visited.has(scope), 'reason cycle: ' + scope);
  visited.add(scope);
  const reason = expected.reasons[scope] ?? expected.authorityProofs[scope];
  assert(reason && typeof reason.basis === 'string' && reason.basis.length > 0, 'missing factual basis: ' + scope);
  if (reason.kind === 'direct') assert.notEqual(stableStringify(oldFacts.get(scope)), stableStringify(newFacts.get(scope)), scope);
  else if (reason.kind === 'unresolved') assert(pending.includes(scope), scope);
  else if (['authority', 'summary', 'guide'].includes(reason.kind)) {
    assert.notEqual(stableStringify(pointer(before.blueprint, reason.changed)), stableStringify(pointer(current.blueprint, reason.changed)), scope);
  } else if (reason.kind === 'fallback') {
    const fallback = expected.fullFallback;
    assert.equal(fallback.kind, 'unresolved_explicit_landing');
    assert.equal(pointer(before.blueprint, fallback.field), fallback.beforeValue, 'full fallback lost its real previous landing');
    assert.equal(pointer(current.blueprint, fallback.field), fallback.value, 'full fallback lost its real unresolved field');
    assert.equal(asRecord(pointer(current.blueprint, fallback.authority))?.[fallback.idField], fallback.authorityId);
    for (const witness of fallback.sourceWitnesses) assert.equal(pointer(witness.side === 'before' ? before.blueprint : current.blueprint, witness.path), witness.value);
    assert.notEqual(stableStringify(pointer(before.blueprint, fallback.authority)), stableStringify(pointer(current.blueprint, fallback.authority)), scope);
  } else if (reason.kind === 'source') {
    assert(changes.includes(reason.dependency), 'source reason has no actual changed dependency: ' + scope);
    const item = asRecords(before.previous.items).find(item => item.scope_ref === scope)!;
    assert([...asStrings(item.evidence_refs), ...asStrings(item.verification_refs), asRecord(item.provenance)?.source_ref].some(ref =>
      typeof ref === 'string' && (reason.dependency === ref.replace(/\\/g, '/').split(/#|:(?=\d)/)[0]
        || reason.dependency.startsWith(ref.replace(/\\/g, '/').split(/#|:(?=\d)/)[0] + '/'))), scope);
  } else if (reason.kind === 'consumer') {
    assert(expected.selected.includes(reason.from) || expected.authorityProofs[reason.from], 'consumer chain starts from a retained scope: ' + scope);
    verifyReason(reason.from, expected, before, current, changes, pending, oldFacts, newFacts, new Set(visited));
    const edge = reason.edge;
    assert.equal(edge.source, reason.from); assert.equal(edge.target, scope);
    const witnesses = asRecords(edge.witness).map(item => ({ side: String(item.side), path: String(item.path), value: String(item.value) }));
    for (const witness of witnesses) {
      const document = witness.side === 'previous' ? before.previous : witness.side === 'before' ? before.blueprint : current.blueprint;
      assert.equal(pointer(document, witness.path), witness.value, 'reference witness no longer exists: ' + scope);
    }
    if (edge.kind === 'id') {
      const kind = String(witnesses[0].path).split('/').at(-1)!.slice(0, -3).replace(/_/g, '-');
      const id = String(witnesses[0].value).startsWith(kind + ':') ? witnesses[0].value : kind + ':' + witnesses[0].value;
      assert.equal(id, edge.id);
      assert(String(witnesses[1].value).includes(id) || witnesses[1].value === witnesses[0].value, scope);
    } else if (edge.kind === 'source') {
      const file = (value: string) => value.replace(/\\/g, '/').split(/#|:(?=\d)/)[0];
      assert.equal(file(witnesses[0].value), file(witnesses[1].value), scope);
      for (const witness of witnesses) {
        assert(!/^[A-Za-z][A-Za-z0-9+.-]*:/.test(witness.value), 'typed business reference is not an evidence file');
        assert(/\/(?:source_refs?|evidence_refs|verification_refs|knowledge_refs)(?:\/|$)/.test(witness.path), 'file proof must be a structured source field');
      }
      assert.equal((expected.reasons[reason.from] ?? expected.authorityProofs[reason.from]).kind, 'authority', 'file edge must originate in an actually changed authority');
    } else {
      assert(['pointer', 'input-pointer'].includes(edge.kind), 'unknown reference edge: ' + scope);
      const ref = String(witnesses[0].value).split('#').at(-1)!.replace(/^\/?/, '/');
      assert(ref === edge.targetPath || ref.startsWith(edge.targetPath + '/'), scope);
    }
  } else assert.equal(reason.kind, 'retained', 'unsupported evidence kind for ' + scope);
}

export function questioningRealReplayCases() {
  return [...PAIRS.map(([first, revised]) => ({
    name: `a920 real historical scope replay i${first} to i${revised} checks exact ranges and retained verdicts`,
    run: () => withHistory((root, inputs, evidence) => {
      const before = inputs.snapshots[first], current = inputs.snapshots[revised];
      const recorded = asRecords(evidence.pairs).find(pair => pair.first === first && pair.revised === revised)!;
      const expected = JSON.parse(fs.readFileSync(path.join(DIRECTORY, 'expectations.json'), 'utf8')).pairs
        .find((pair: BlueprintRecord) => pair.first === first && pair.revised === revised);
      assert(recorded.originalVersusProjectionEqual, 'capture did not compare real originals with the minimal input');
      assert.equal(evidence.r3SelectorSha256, '8b1e5d023f11fc6d9bd8638d413903fb4420a31d36210cd5931847eb6e510c65', 'R3 source differs from the preserved packet');
      const issues = validateBlueprintQuestioning({ ...before.blueprint,
        review_summary: { ...before.blueprint.review_summary, questioning: before.previous } });
      assert(issues.every(issue => issue.id === 'blueprint_admission_false_pass'), JSON.stringify(issues));
      const changes = dependencies(root, before, current);
      assert.deepStrictEqual(changes, asRecords(recorded.changedDependencies).map(item => item.path));
      const selected = selectQuestioningScopes(before.blueprint, current.blueprint, before.previous, changes);
      assert.deepStrictEqual(expected.selected, recorded.selected, 'historical assertions and original capture disagree');
      const reused = first === 13 && revised === 15 || first === 15 && revised === 17 ? ['terminology:current_scope_items'] : [];
      if (reused.length) {
        const reason = expected.reasons[reused[0]];
        assert.equal(reason.edge.kind, 'source', 'reuse removes the shared document edge');
        const source = String(reason.edge.witness[1].value);
        assert(!changes.includes(source), 'the shared requirements actually changed');
        assert.deepStrictEqual(before.blueprint.discovery.facts, current.blueprint.discovery.facts, 'original terminology cites these facts');
      }
      if (first === 10 && revised === 13) {
        const scope = 'view:development';
        const reason = expected.reasons[scope];
        assert.equal(reason.from, 'view:scenarios');
        const witness = 'view:scenarios/node:sc-open-card-success';
        assert.equal(reason.edge.witness[1].value, witness);
        const oldIndex = stableAddressIndex(before.blueprint), newIndex = stableAddressIndex(current.blueprint);
        assert(oldIndex.has(witness));
        assert.deepStrictEqual(newIndex.get(witness), oldIndex.get(witness), 'the scenario consumed by development is unchanged');
        assert.deepStrictEqual(newIndex.get(scope), oldIndex.get(scope), 'development itself is unchanged');
        assert.deepStrictEqual(changes, [], 'no changed external source can invalidate the development answer');
        const prior = asRecords(before.previous.items).find(item => item.scope_ref === scope)!;
        const refs = [...asStrings(prior.verification_refs), ...asStrings(prior.evidence_refs)].filter(ref => ref.includes('#/'));
        assert(refs.length > 0);
        for (const ref of refs) {
          const at = ref.slice(ref.indexOf('#') + 1);
          assert(pointer(before.blueprint, at) !== undefined);
          assert.deepStrictEqual(pointer(current.blueprint, at), pointer(before.blueprint, at), ref);
        }
        const flow = 'view:runtime/flow:flow-card-open-run';
        const oldFlow = oldIndex.get(flow)!, newFlow = newIndex.get(flow)!;
        const state = asRecords(asRecord(newFlow.contracts)?.state_management)[0];
        assert.equal(state.owner_ref, 'view:development/node:dev-card-open-session');
        assert(String(state.data).includes('完整卡号，仅内存'));
        assert.notDeepStrictEqual(newFlow, oldFlow, 'retain the actual changed card identity handoff');
        assert(selected.includes('flow:flow-card-open-run'));
        reused.push(scope);
      }
      const required = [...requiredQuestioningScopes(current.blueprint).keys()];
      const precise = preciseScopeEdits(first, revised, before.blueprint, current.blueprint);
      reused.push(...precise.retain);
      assert.deepStrictEqual(selected, required.filter(scope => precise.recheck.includes(scope) || expected.selected.includes(scope) && !reused.includes(scope)),
        'exact selected scope identities regressed');
      if (expected.fullFallback) {
        const fallback = expected.fullFallback;
        assert.deepStrictEqual(selected, required, 'real unresolved authority must trigger full fallback');
        const isolated = structuredClone(before.blueprint);
        setPointer(isolated, fallback.authority, structuredClone(pointer(current.blueprint, fallback.authority)));
        assert.deepStrictEqual(selectQuestioningScopes(before.blueprint, isolated, before.previous), required,
          'one changed real authority with an unresolved explicit landing was hidden by its source references');
        const located = structuredClone(isolated);
        const locatedBefore = structuredClone(before.blueprint);
        setPointer(located, fallback.field, fallback.locatedCounterexample);
        setPointer(locatedBefore, fallback.field, fallback.locatedCounterexample);
        assert(selectQuestioningScopes(locatedBefore, located, before.previous).length < required.length,
          'uniquely locating the real authority still causes unconditional full fallback');
      }
      const oldFacts = scopeFacts(before.blueprint), newFacts = scopeFacts(current.blueprint);
      const pending = asRecords(before.previous.items).filter(item => ['blocker', 'open_decision'].includes(String(item.disposition))).map(item => String(item.scope_ref));
      assert.deepStrictEqual(pending, asRecords(recorded.pendingBefore).map(item => item.scope));
      for (const scope of pending) assert(selected.includes(scope), 'real unresolved finding was lost: ' + scope);
      for (const scope of required) {
        const reason = expected.reasons[scope];
        verifyReason(scope, expected, before, current, changes, pending, oldFacts, newFacts);
        if (!selected.includes(scope)) {
          assert(reason.kind === 'retained' || reused.includes(scope), scope);
          assert.equal(stableStringify(oldFacts.get(scope)), stableStringify(newFacts.get(scope)), 'retained design fact changed: ' + scope);
          assert(!pending.includes(scope), 'retained a real unresolved finding: ' + scope);
          assert.equal(asRecords(before.previous.items).filter(item => item.scope_ref === scope).length, 1, 'retained result is not unique');
        } else assert(reason.kind !== 'retained' || precise.recheck.includes(scope), scope);
      }
    }),
  })), {
    name: 'a920 real historical scope replay reopens a retained finding and conservatively falls back on unlocatable authority',
    run: () => withHistory((root, inputs) => {
      const before = inputs.snapshots[15], current = inputs.snapshots[17], changes = dependencies(root, before, current);
      const selected = selectQuestioningScopes(before.blueprint, current.blueprint, before.previous, changes);
      const retained = [...requiredQuestioningScopes(current.blueprint).keys()].find(scope => !selected.includes(scope))!;
      assert(retained, 'the real pair must exercise retained independent conclusions');
      const reopened = structuredClone(before.previous);
      asRecords(reopened.items).find(item => item.scope_ref === retained)!.disposition = 'open_decision';
      assert(selectQuestioningScopes(before.blueprint, current.blueprint, reopened, changes).includes(retained), 'new independent doubt was silently retained');
      const ambiguous = structuredClone(current.blueprint);
      delete asRecords(ambiguous.contracts)[0].contract_id;
      assert.deepStrictEqual(selectQuestioningScopes(before.blueprint, ambiguous, before.previous, changes),
        [...requiredQuestioningScopes(ambiguous).keys()], 'changed authority without stable identity was narrowed');
      assert.deepStrictEqual(selectQuestioningScopes(before.blueprint, current.blueprint, before.previous, [...changes, 'unknown-source.ts']),
        [...requiredQuestioningScopes(current.blueprint).keys()], 'unmapped historical evidence was guessed unchanged');
    }),
  }];
}
