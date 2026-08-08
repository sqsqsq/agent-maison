import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  highestEvidenceSource,
  listUnitBothScopeItems,
  mappingCoversScope,
  mappingBackedByResolvableEvidence,
  dagsAllCharacterization,
  dagLinksScopeId,
  scopeHasResolvableEvidence,
  writeCoverageEvidence,
  loadCoverageEvidence,
  readCoverageEvidence,
} from '../../scripts/utils/coverage-evidence';
import {
  checkUtCoverageEvidencePresent,
  inspectCoverageEvidence,
} from '../../scripts/check-ut';
import { buildAcCoverageReport, writeAcCoverageReport } from '../../scripts/utils/ac-coverage-report';
import { validateCoverageEvidenceContent } from '../../scripts/utils/ut-artifact-validate';
import type { UnitCaseResult } from './ut-artifact-validate.unit.test';
import type { CheckContext } from '../../scripts/utils/types';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function testPriority(): void {
  const available = new Set(['ut_tags', 'dag_ephemeral', 'dag_archived'] as const);
  assert(highestEvidenceSource(available) === 'dag_archived', 'archived wins');
}

function testUnitBothScope(): void {
  const items = listUnitBothScopeItems({
    criteria: [{ id: 'AC-1', ut_layer: 'device' }, { id: 'AC-2', ut_layer: 'unit' }],
    boundaries: [],
  });
  assert(items.length === 1 && items[0].id === 'AC-2', 'only unit/both');
}

function testDagsAllCharacterizationMixed(): void {
  assert(!dagsAllCharacterization([
    { dag: { flow_type: 'characterization' } },
    { dag: { flow_type: 'usecase_driven' } },
  ]), 'mixed must not skip spec gates');
  assert(dagsAllCharacterization([
    { dag: { flow_type: 'characterization' } },
    { dag: { flow_type: 'characterization' } },
  ]), 'all char should skip');
}

function testMappingNotTrustedWithoutBacking(): void {
  const dags = [{ source: 'ephemeral' as const, dag: { linked_acceptance: ['AC-2'] } }];
  const row = {
    scope_id: 'AC-1',
    scope_kind: 'acceptance_criterion' as const,
    evidence_source: 'dag_ephemeral' as const,
  };
  const root = '/tmp/unused';
  const feat = 'f';
  assert(!mappingBackedByResolvableEvidence(row, dags, false, root, feat), 'dag mapping without dag link');
  assert(!mappingBackedByResolvableEvidence(row, dags, true, root, feat), 'dag source ignores ut tag alone');
  assert(mappingBackedByResolvableEvidence(
    { ...row, scope_id: 'AC-2' },
    dags,
    false,
    root,
    feat,
  ), 'dag link backs dag_ephemeral mapping');
  assert(mappingBackedByResolvableEvidence(
    { scope_id: 'AC-1', scope_kind: 'acceptance_criterion', evidence_source: 'ut_tags' },
    dags,
    true,
    root,
    feat,
  ), 'ut_tags source requires tag');
  assert(dagLinksScopeId(dags[0].dag, 'AC-2'), 'dag link helper');
}

function testDagMappingRequiresDeclaredSourceKind(): void {
  const archived = [{ source: 'archived' as const, dag: { linked_acceptance: ['AC-1'] } }];
  const base = {
    scope_id: 'AC-1',
    scope_kind: 'acceptance_criterion' as const,
  };
  assert(mappingBackedByResolvableEvidence(
    { ...base, evidence_source: 'dag_archived' },
    archived,
    false,
    '/tmp/unused',
    'f',
  ), 'archived declaration resolves from archived DAG');
  assert(!mappingBackedByResolvableEvidence(
    { ...base, evidence_source: 'dag_ephemeral' },
    archived,
    false,
    '/tmp/unused',
    'f',
  ), 'ephemeral declaration must not resolve from archived DAG');
}

function testAcAndBdPrefixesDoNotCrossCover(): void {
  const report = buildAcCoverageReport('demo', {
    criteria: [{ id: 'AC-01', priority: 'P0', ut_layer: 'unit' }],
    boundaries: [{ id: 'BD-01', priority: 'P0', ut_layer: 'unit' }],
  } as never, ['[AC-01] criterion only']);
  assert(report.criteria[0].ut_covered, 'AC-01 should be covered');
  assert(!report.boundaries[0].ut_covered, 'BD-01 must not be covered by AC-01');
}

function testDagNodeLevelLinkedAcceptance(): void {
  const dag = {
    nodes: [{ type: 'assertion', linked_acceptance: ['AC-9'] }],
  };
  assert(dagLinksScopeId(dag, 'AC-9'), 'node-level linked_acceptance counts');
  assert(!dagLinksScopeId(dag, 'AC-1'), 'unlinked ac');
}

function testAcCoverageResolvable(): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-cov-'));
  const feature = 'feat-ac';
  writeAcCoverageReport(dir, feature, {
    schema_version: '1.0',
    feature,
    generated_at: new Date().toISOString(),
    harness_phase: 'ut',
    criteria: [{
      id: 'AC-1',
      kind: 'criterion',
      ut_covered: true,
      it_tags: ['[AC-1] ok'],
    }],
    boundaries: [],
    summary: { unit_scope_total: 1, unit_covered: 1, device_delegated: 0 },
  });
  const report = {
    schema_version: '1.0' as const,
    feature,
    generated_at: new Date().toISOString(),
    harness_phase: 'ut' as const,
    criteria: [{
      id: 'AC-1',
      kind: 'criterion' as const,
      ut_covered: true,
      it_tags: ['[AC-1] ok'],
    }],
    boundaries: [],
    summary: { unit_scope_total: 1, unit_covered: 1, device_delegated: 0 },
  };
  assert(scopeHasResolvableEvidence({
    projectRoot: dir,
    feature,
    scopeId: 'AC-1',
    dags: [],
    hasUtTag: false,
    mapping: {
      scope_id: 'AC-1',
      scope_kind: 'acceptance_criterion',
      evidence_source: 'ac_coverage',
    },
    acReport: report,
  }), 'ac_coverage mapping uses in-memory report');
  fs.rmSync(dir, { recursive: true, force: true });
}

function testValidateAndRoundtrip(): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cov-ev-'));
  const projectRoot = dir;
  const feature = 'feat-a';
  const doc = {
    schema_version: '1.0',
    feature,
    primary_evidence_source: 'dag_ephemeral' as const,
    sources: { dag_ephemeral: ['doc/features/feat-a/ut/reports/flow-dag/x.dag.yaml'] },
    mappings: [{
      scope_id: 'AC-1',
      scope_kind: 'acceptance_criterion' as const,
      evidence_source: 'ut_tags' as const,
    }],
  };
  writeCoverageEvidence(projectRoot, feature, doc);
  const loaded = loadCoverageEvidence(projectRoot, feature);
  assert(!!loaded && loaded.feature === feature, 'roundtrip');
  const v = validateCoverageEvidenceContent(JSON.stringify(doc));
  assert(v.ok, JSON.stringify(v.errors));
  assert(mappingCoversScope(doc.mappings, 'AC-1'), 'mapping covers');
  fs.rmSync(dir, { recursive: true, force: true });
}

function testMappingsCompleteRequiresRows(): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cov-map-'));
  const feature = 'feat-map';
  writeCoverageEvidence(dir, feature, {
    schema_version: '1.0',
    feature,
    primary_evidence_source: 'ut_tags',
    mappings: [],
  });
  const ev = loadCoverageEvidence(dir, feature);
  assert(ev !== null && (ev.mappings?.length ?? 0) === 0, 'empty mappings');
  fs.rmSync(dir, { recursive: true, force: true });
}

function makeCtx(projectRoot: string, feature: string): CheckContext {
  return {
    projectRoot,
    frameworkRoot: projectRoot,
    feature,
    phaseRule: {
      traceability_checks: {
        ut_coverage_evidence_present: { description: 'coverage evidence present' },
      },
    } as unknown as CheckContext['phaseRule'],
    featureSpec: {
      acceptance: {
        criteria: [{ id: 'AC-01', priority: 'P0', ut_layer: 'unit' }],
        boundaries: [],
      },
    } as unknown as CheckContext['featureSpec'],
    resolvedProfile: { name: 'hmos-app', profileDir: '', personalPrerequisites: {} },
  } as CheckContext;
}

function testReadObservationDistinguishesStates(): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cov-observe-'));
  const feature = 'feat-observe';
  try {
    const missing = readCoverageEvidence(dir, feature);
    assert(missing.status === 'missing', missing.status);
    const abs = missing.absPath;
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, '{ broken', 'utf-8');
    const invalidJson = readCoverageEvidence(dir, feature);
    assert(invalidJson.status === 'invalid', invalidJson.status);
    fs.writeFileSync(abs, '[]\n', 'utf-8');
    const invalidRoot = readCoverageEvidence(dir, feature);
    assert(invalidRoot.status === 'invalid', invalidRoot.status);
    assert(invalidRoot.status === 'invalid' && invalidRoot.error.includes('JSON object'), JSON.stringify(invalidRoot));
    fs.writeFileSync(abs, JSON.stringify({ schema_version: '1.0', feature, mappings: [] }), 'utf-8');
    const loaded = readCoverageEvidence(dir, feature);
    assert(loaded.status === 'loaded', loaded.status);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function testPresentGateReportsInvalidCanonicalPath(): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cov-invalid-gate-'));
  const feature = 'feat-invalid';
  try {
    const first = readCoverageEvidence(dir, feature);
    fs.mkdirSync(path.dirname(first.absPath), { recursive: true });
    fs.writeFileSync(first.absPath, '{ broken', 'utf-8');
    const ctx = makeCtx(dir, feature);
    const observed = inspectCoverageEvidence(ctx);
    assert(observed.status === 'invalid', observed.status);
    const result = checkUtCoverageEvidencePresent(ctx, observed)[0];
    assert(result.status === 'FAIL', result.status);
    assert(result.details.includes(first.absPath), result.details);
    assert(result.details.includes('已存在但无效'), result.details);
    assert(!result.details.includes('缺少 canonical'), result.details);
    assert(result.suggestion?.includes('不需要 git add') === true, result.suggestion ?? '');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function testInspectRejectsWrongFeatureAndMissingFields(): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cov-shape-gate-'));
  const feature = 'feat-shape';
  try {
    const first = readCoverageEvidence(dir, feature);
    fs.mkdirSync(path.dirname(first.absPath), { recursive: true });
    fs.writeFileSync(first.absPath, JSON.stringify({ feature: 'other', mappings: [] }), 'utf-8');
    const observed = inspectCoverageEvidence(makeCtx(dir, feature));
    assert(observed.status === 'invalid', observed.status);
    assert(
      observed.status === 'invalid' && observed.errors.some(e => e.includes('schema_version')),
      JSON.stringify(observed),
    );
    assert(
      observed.status === 'invalid' && observed.errors.some(e => e.includes('当前 feature')),
      JSON.stringify(observed),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function runAll(): UnitCaseResult[] {
  const cases = [
    { name: 'evidence priority', fn: testPriority },
    { name: 'unit/both scope', fn: testUnitBothScope },
    { name: 'all-characterization only when every dag', fn: testDagsAllCharacterizationMixed },
    { name: 'mapping requires backing', fn: testMappingNotTrustedWithoutBacking },
    { name: 'DAG mapping requires declared source kind', fn: testDagMappingRequiresDeclaredSourceKind },
    { name: 'AC and BD prefixes do not cross-cover', fn: testAcAndBdPrefixesDoNotCrossCover },
    { name: 'dag node linked_acceptance', fn: testDagNodeLevelLinkedAcceptance },
    { name: 'ac_coverage resolvable', fn: testAcCoverageResolvable },
    { name: 'mappings array may be empty file', fn: testMappingsCompleteRequiresRows },
    { name: 'validate roundtrip', fn: testValidateAndRoundtrip },
    { name: 'read observation distinguishes missing invalid loaded', fn: testReadObservationDistinguishesStates },
    { name: 'present gate reports invalid canonical path', fn: testPresentGateReportsInvalidCanonicalPath },
    { name: 'inspect rejects wrong feature and missing fields', fn: testInspectRejectsWrongFeatureAndMissingFields },
  ];
  return cases.map(({ name, fn }) => {
    try {
      fn();
      return { name, ok: true };
    } catch (e) {
      return { name, ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
}
