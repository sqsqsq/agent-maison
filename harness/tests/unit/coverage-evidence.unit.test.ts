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
} from '../../scripts/utils/coverage-evidence';
import { writeAcCoverageReport } from '../../scripts/utils/ac-coverage-report';
import { validateCoverageEvidenceContent } from '../../scripts/utils/ut-artifact-validate';
import type { UnitCaseResult } from './ut-artifact-validate.unit.test';

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
  const dags = [{ dag: { linked_acceptance: ['AC-2'] } }];
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

export function runAll(): UnitCaseResult[] {
  const cases = [
    { name: 'evidence priority', fn: testPriority },
    { name: 'unit/both scope', fn: testUnitBothScope },
    { name: 'all-characterization only when every dag', fn: testDagsAllCharacterizationMixed },
    { name: 'mapping requires backing', fn: testMappingNotTrustedWithoutBacking },
    { name: 'dag node linked_acceptance', fn: testDagNodeLevelLinkedAcceptance },
    { name: 'ac_coverage resolvable', fn: testAcCoverageResolvable },
    { name: 'mappings array may be empty file', fn: testMappingsCompleteRequiresRows },
    { name: 'validate roundtrip', fn: testValidateAndRoundtrip },
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
