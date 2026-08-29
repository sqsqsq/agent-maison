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

export class ChangeUnitCandidateRejected extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'ChangeUnitCandidateRejected';
  }
}

/**
 * 唯一 consumer 校验原语：provider provenance → 目标路径 → 重复接受 → canonical schema/identity
 * → 设计闭包门。**只做校验、不落盘**，返回已校验的目标路径。
 *
 * 单候选与批量接受都必须经过它，避免两份会漂移的 provenance/schema/design 逻辑。
 */
function validateCandidateForAcceptance(projectRoot: string, candidate: ChangeUnitCandidate): string {
  const artifact = candidate.artifact;
  if (!artifact.provenance.extraction_method.includes(candidate.providerId)) {
    throw new ChangeUnitCandidateRejected(
      'change_unit_candidate_provider_provenance_missing',
      `候选 ${artifact.change_unit_id} 的 provenance.extraction_method 未记录 provider ${candidate.providerId}。`,
    );
  }
  const target = changeUnitPath(projectRoot, artifact.blueprint_id, artifact.change_unit_id);
  if (fs.existsSync(target)) {
    throw new ChangeUnitCandidateRejected(
      'change_unit_candidate_already_exists',
      `canonical CU 已存在，重复接受 fail-closed：${target}。修正已接受单元请新建修订/superseding CU。`,
    );
  }
  try {
    assertValidChangeUnit(artifact as unknown as Record<string, unknown>, { projectRoot, canonicalPath: target });
  } catch (error) {
    throw new ChangeUnitCandidateRejected(
      'change_unit_candidate_schema_rejected',
      `候选 ${artifact.change_unit_id} 未通过 canonical 校验：${(error as Error).message}`,
    );
  }
  const design = validateChangeUnitDesign(projectRoot, artifact as unknown as Record<string, unknown>);
  if (design.verdict !== 'constructable') {
    throw new ChangeUnitCandidateRejected(
      'change_unit_candidate_design_rejected',
      `候选 ${artifact.change_unit_id} 未通过设计闭包门（${design.verdict}）：${design.issues.map(item => item.id).join(',')}`,
    );
  }
  return target;
}

/** 唯一写入原语：temp(wx) → rename。返回目标路径，供批量接受回滚。 */
function writeCanonicalChangeUnit(target: string, artifact: ChangeUnitArtifact, suffix: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.candidate-${suffix}`;
  fs.writeFileSync(temporary, YAML.stringify(artifact), { encoding: 'utf8', flag: 'wx' });
  try {
    fs.renameSync(temporary, target);
  } catch (error) {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    throw error;
  }
}

/**
 * consumer validator：接受**一批** decomposition 候选并原子写出 1..N canonical CU。
 *
 * 原子语义：整批先全量校验（含批内重复），任一条不通过即整批拒绝、一个字节都不落盘；
 * 写入中途失败时回滚本批已落盘目标与临时文件。
 *
 * 这是**唯一** canonical CU 写入真源；`acceptChangeUnitCandidate` 是它的单候选包装。
 */
export function acceptChangeUnitCandidates(
  projectRoot: string,
  candidates: readonly ChangeUnitCandidate[],
) {
  if (candidates.length === 0) {
    throw new ChangeUnitCandidateRejected(
      'change_unit_decomposition_empty',
      '设计准备子流程必须写出 1..N 个 canonical CU；零候选不构成一次接受。',
    );
  }
  const seen = new Set<string>();
  const targets: string[] = [];
  for (const candidate of candidates) {
    const id = candidate.artifact.change_unit_id;
    if (seen.has(id)) {
      throw new ChangeUnitCandidateRejected(
        'change_unit_candidate_duplicate_in_batch',
        `同一批候选内 change_unit_id=${id} 重复。`,
      );
    }
    seen.add(id);
    targets.push(validateCandidateForAcceptance(projectRoot, candidate));
  }

  const written: string[] = [];
  try {
    candidates.forEach((candidate, index) => {
      writeCanonicalChangeUnit(targets[index]!, candidate.artifact, `${process.pid}-${index}`);
      written.push(targets[index]!);
    });
  } catch (error) {
    for (const target of written) {
      if (fs.existsSync(target)) fs.unlinkSync(target);
    }
    throw new ChangeUnitCandidateRejected(
      'change_unit_decomposition_write_failed',
      `原子写出失败并已回滚本批：${(error as Error).message}`,
    );
  }
  return candidates.map(candidate => loadCanonicalChangeUnit(
    projectRoot,
    candidate.artifact.blueprint_id,
    candidate.artifact.change_unit_id,
  ));
}

/** 单候选接受 = 批量接受的 1 元包装。不保留第二份校验/落盘实现。 */
export function acceptChangeUnitCandidate(projectRoot: string, candidate: ChangeUnitCandidate) {
  return acceptChangeUnitCandidates(projectRoot, [candidate])[0]!;
}
