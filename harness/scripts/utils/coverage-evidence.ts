// coverage-evidence.ts — UT 覆盖证据契约（machine-readable）
import fs from 'fs';
import path from 'path';
import { acCoverageCoversScope, type AcCoverageReport } from './ac-coverage-report';
import { featureFilePath, relFeatureFile } from '../../config';
export type EvidenceSourceKind =
  | 'dag_archived'
  | 'dag_ephemeral'
  | 'ac_coverage'
  | 'ut_tags';

export interface CoverageEvidenceMapping {
  scope_id: string;
  scope_kind: 'acceptance_criterion' | 'boundary' | 'branch';
  evidence_source: EvidenceSourceKind;
  evidence_ref?: string;
}

export interface CoverageEvidenceFile {
  schema_version: string;
  feature: string;
  primary_evidence_source?: EvidenceSourceKind;
  sources?: Partial<Record<EvidenceSourceKind, string[]>>;
  mappings?: CoverageEvidenceMapping[];
  skip_reason?: string;
}

export type CoverageEvidenceReadObservation =
  | {
      status: 'missing';
      absPath: string;
      relPath: string;
    }
  | {
      status: 'invalid';
      absPath: string;
      relPath: string;
      error: string;
    }
  | {
      status: 'loaded';
      absPath: string;
      relPath: string;
      raw: string;
      evidence: CoverageEvidenceFile;
    };

const EVIDENCE_PRIORITY: EvidenceSourceKind[] = [
  'dag_archived',
  'dag_ephemeral',
  'ac_coverage',
  'ut_tags',
];

/** Ephemeral flow DAG directory for a feature (relative to project root). */
export function ephemeralFlowDagRel(projectRoot: string, feature: string): string {
  return relFeatureFile(projectRoot, feature, 'ut/reports/flow-dag');
}

export function coverageEvidenceRel(projectRoot: string, feature: string): string {
  return relFeatureFile(projectRoot, feature, 'ut/reports/coverage-evidence.json');
}

/** Absolute ephemeral flow-dag directory for a feature. */
export function ephemeralFlowDagDir(projectRoot: string, feature: string): string {
  return featureFilePath(projectRoot, feature, path.join('ut', 'reports', 'flow-dag'));
}

export function resolveCoverageEvidencePath(projectRoot: string, feature: string): string {
  return featureFilePath(projectRoot, feature, path.join('ut', 'reports', 'coverage-evidence.json'));
}

export function readCoverageEvidence(
  projectRoot: string,
  feature: string,
): CoverageEvidenceReadObservation {
  const absPath = resolveCoverageEvidencePath(projectRoot, feature);
  const relPath = coverageEvidenceRel(projectRoot, feature);
  if (!fs.existsSync(absPath)) return { status: 'missing', absPath, relPath };
  try {
    const raw = fs.readFileSync(absPath, 'utf-8').replace(/^\uFEFF/, '');
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        status: 'invalid',
        absPath,
        relPath,
        error: 'coverage-evidence 根节点必须是 JSON object',
      };
    }
    return {
      status: 'loaded',
      absPath,
      relPath,
      raw,
      evidence: parsed as CoverageEvidenceFile,
    };
  } catch (e) {
    return {
      status: 'invalid',
      absPath,
      relPath,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export function loadCoverageEvidence(
  projectRoot: string,
  feature: string,
): CoverageEvidenceFile | null {
  const observed = readCoverageEvidence(projectRoot, feature);
  return observed.status === 'loaded' ? observed.evidence : null;
}

export function writeCoverageEvidence(
  projectRoot: string,
  feature: string,
  doc: CoverageEvidenceFile,
): void {
  const abs = resolveCoverageEvidencePath(projectRoot, feature);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(doc, null, 2)}\n`, 'utf-8');
}

export function highestEvidenceSource(
  available: Set<EvidenceSourceKind>,
): EvidenceSourceKind | null {
  for (const k of EVIDENCE_PRIORITY) {
    if (available.has(k)) return k;
  }
  return null;
}

export interface UnitBothScopeItem {
  id: string;
  kind: 'criterion' | 'boundary';
  priority?: string;
  ut_layer?: string;
}

export function listUnitBothScopeItems(acceptance: {
  criteria?: Array<{ id: string; priority?: string; ut_layer?: string }>;
  boundaries?: Array<{ id: string; priority?: string; ut_layer?: string }>;
} | null | undefined): UnitBothScopeItem[] {
  if (!acceptance) return [];
  const isUnit = (layer?: string) =>
    layer === 'unit' || layer === 'both' || layer === undefined;
  const out: UnitBothScopeItem[] = [];
  for (const c of acceptance.criteria ?? []) {
    if (isUnit(c.ut_layer)) {
      out.push({ id: c.id, kind: 'criterion', priority: c.priority, ut_layer: c.ut_layer });
    }
  }
  for (const b of acceptance.boundaries ?? []) {
    if (isUnit(b.ut_layer)) {
      out.push({ id: b.id, kind: 'boundary', priority: b.priority, ut_layer: b.ut_layer });
    }
  }
  return out;
}

export function mappingCoversScope(
  mappings: CoverageEvidenceMapping[] | undefined,
  scopeId: string,
): boolean {
  if (!mappings?.length) return false;
  return mappings.some(m => m.scope_id === scopeId);
}

/** Minimal DAG node fields for AC/BD linkage (aligned with check-ut acceptance_coverage). */
export interface DagEvidenceNodeLink {
  type?: string;
  linked_acceptance?: string[];
  linked_boundaries?: string[];
  linked_branch?: string;
}

/** Minimal DAG fields for AC/BD ↔ evidence linkage (no harness import cycle). */
export interface DagEvidenceLink {
  flow_type?: string;
  linked_acceptance?: string[];
  linked_boundaries?: string[];
  nodes?: DagEvidenceNodeLink[];
}

export interface DagEvidenceRecord {
  dag: DagEvidenceLink;
  path?: string;
  source?: 'archived' | 'ephemeral';
}

export function dagLinksScopeId(dag: DagEvidenceLink, scopeId: string): boolean {
  if ((dag.linked_acceptance ?? []).includes(scopeId)) return true;
  if ((dag.linked_boundaries ?? []).includes(scopeId)) return true;
  for (const node of dag.nodes ?? []) {
    if ((node.linked_acceptance ?? []).includes(scopeId)) return true;
    if ((node.linked_boundaries ?? []).includes(scopeId)) return true;
  }
  return false;
}

/** True only when every DAG that declares flow_type is characterization (mixed → false). */
export function dagsAllCharacterization(dags: Array<{ dag: DagEvidenceLink }>): boolean {
  const typed = dags.filter(d => d.dag.flow_type != null && String(d.dag.flow_type).trim() !== '');
  if (typed.length === 0) return false;
  return typed.every(d => d.dag.flow_type === 'characterization');
}

/**
 * Skill-authored mapping is trusted only when backed by UT tags or DAG linked_acceptance.
 * Harness MUST NOT treat bare scope_id rows as coverage proof.
 */
/** Strict per declared evidence_source (mapping row must match its claimed source). */
export function mappingBackedByResolvableEvidence(
  mapping: CoverageEvidenceMapping,
  dags: DagEvidenceRecord[],
  hasUtTagForScope: boolean,
  projectRoot: string,
  feature: string,
  acReportOverride?: AcCoverageReport | null,
): boolean {
  switch (mapping.evidence_source) {
    case 'ut_tags':
      return hasUtTagForScope;
    case 'dag_archived':
      return dags.some(d => d.source === 'archived' && dagLinksScopeId(d.dag, mapping.scope_id));
    case 'dag_ephemeral':
      return dags.some(d => d.source === 'ephemeral' && dagLinksScopeId(d.dag, mapping.scope_id));
    case 'ac_coverage':
      return acCoverageCoversScope(projectRoot, feature, mapping.scope_id, acReportOverride);
    default:
      return false;
  }
}

/** Resolve whether a scope id has any allowed evidence source (priority OR, not blanket mapping). */
export function scopeHasResolvableEvidence(opts: {
  projectRoot: string;
  feature: string;
  scopeId: string;
  dags: DagEvidenceRecord[];
  hasUtTag: boolean;
  mapping?: CoverageEvidenceMapping;
  acReport?: AcCoverageReport | null;
}): boolean {
  if (opts.mapping) {
    return mappingBackedByResolvableEvidence(
      opts.mapping,
      opts.dags,
      opts.hasUtTag,
      opts.projectRoot,
      opts.feature,
      opts.acReport,
    );
  }
  if (opts.hasUtTag) return true;
  if (opts.dags.some(d => dagLinksScopeId(d.dag, opts.scopeId))) return true;
  if (acCoverageCoversScope(opts.projectRoot, opts.feature, opts.scopeId, opts.acReport)) return true;
  return false;
}
