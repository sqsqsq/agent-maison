import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { ChangeUnitArtifact } from './change-unit-model';
import { changeUnitPath, loadCanonicalChangeUnit } from './change-unit-path';
import { assertValidChangeUnit } from './change-unit-validator';
import { validateChangeUnitDesign } from './change-unit-design-gate';

export type ChangeUnitProviderSeam = 'cu_decomposition' | 'relation_ready_analysis' | 'candidate_selection';

export interface ChangeUnitProviderBinding {
  seam: ChangeUnitProviderSeam;
  providerId: string;
  authoritative: boolean;
  available: boolean;
}

export interface ChangeUnitProviderBoundaryResult {
  ok: boolean;
  blockers: string[];
  decompositionAvailable: boolean;
}

export const BUILTIN_CHANGE_UNIT_PROVIDERS: readonly ChangeUnitProviderBinding[] = [
  { seam: 'cu_decomposition', providerId: 'builtin-vertical-slice-decomposition', authoritative: false, available: true },
  { seam: 'relation_ready_analysis', providerId: 'builtin-exact-requires-provides-analyzer', authoritative: true, available: true },
  { seam: 'candidate_selection', providerId: 'builtin-priority-stable-id-selector', authoritative: true, available: true },
];

export function validateChangeUnitProviderBoundary(
  bindings: readonly ChangeUnitProviderBinding[] = BUILTIN_CHANGE_UNIT_PROVIDERS,
): ChangeUnitProviderBoundaryResult {
  const blockers: string[] = [];
  for (const seam of ['relation_ready_analysis', 'candidate_selection'] as const) {
    const providers = bindings.filter(item => item.seam === seam && item.available && item.authoritative);
    if (providers.length === 0) blockers.push(`change_unit_provider_missing:${seam}`);
    if (providers.length > 1) blockers.push(`change_unit_provider_authority_conflict:${seam}:${providers.map(item => item.providerId).join(',')}`);
  }
  const decomposition = bindings.filter(item => item.seam === 'cu_decomposition' && item.available);
  if (decomposition.length > 1) blockers.push(`change_unit_provider_conflict:cu_decomposition:${decomposition.map(item => item.providerId).join(',')}`);
  return { ok: blockers.length === 0, blockers, decompositionAvailable: decomposition.length === 1 };
}

export interface ChangeUnitCandidate {
  providerId: string;
  artifact: ChangeUnitArtifact;
}

export function dropUnacceptedChangeUnitCandidates(_candidates: readonly ChangeUnitCandidate[]): ChangeUnitCandidate[] {
  return [];
}

export function acceptChangeUnitCandidate(projectRoot: string, candidate: ChangeUnitCandidate) {
  const provenance = candidate.artifact.provenance;
  if (!provenance.extraction_method.includes(candidate.providerId)) {
    throw new Error('change_unit_candidate_provider_provenance_missing');
  }
  const target = changeUnitPath(projectRoot, candidate.artifact.blueprint_id, candidate.artifact.change_unit_id);
  assertValidChangeUnit(candidate.artifact as unknown as Record<string, unknown>, {
    projectRoot,
    canonicalPath: target,
  });
  const design = validateChangeUnitDesign(projectRoot, candidate.artifact as unknown as Record<string, unknown>);
  if (design.verdict !== 'constructable') {
    throw new Error(`change_unit_candidate_design_rejected:${design.issues.map(item => item.id).join(',')}`);
  }
  if (fs.existsSync(target)) throw new Error(`change_unit_candidate_already_exists:${target}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.candidate-${process.pid}`;
  fs.writeFileSync(temporary, YAML.stringify(candidate.artifact), { encoding: 'utf8', flag: 'wx' });
  try {
    fs.renameSync(temporary, target);
  } catch (error) {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    throw error;
  }
  return loadCanonicalChangeUnit(projectRoot, candidate.artifact.blueprint_id, candidate.artifact.change_unit_id);
}
