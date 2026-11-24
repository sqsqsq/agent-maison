import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { createHash } from 'crypto';
import { ChangeUnitArtifact, sameBlueprintIdentity } from './change-unit-model';
import { asRecord, blueprintAuthorContent, type BlueprintRecord, type ComponentBlueprintRef } from './component-blueprint-model';
import { stableJson } from './blueprint-discovery';
import { blueprintIdentityPointers, currentBlueprintIdentity } from './change-unit-blueprint-identity';
import { changeUnitPath, deriveChangeUnitFeatureId, loadCanonicalChangeUnit, type LoadedChangeUnit } from './change-unit-path';
import { componentBlueprintPath, loadCanonicalBlueprint, resolveBlueprintCandidateRefFromLoaded, resolveComponentBlueprintRef } from './component-blueprint-path';
import { validateComponentBlueprint, validateComponentBlueprintUpstream } from './component-blueprint-validator';
import { resolveProbeFrameworkRoot } from '../../repo-layout';
import { assertValidChangeUnit } from './change-unit-validator';
import { validateChangeUnitDesign, readChangeUnitDesignOwnership } from './change-unit-design-gate';
import { validateProjectRelativePath } from './project-relative-path';
import type { BlueprintSkillProjection, DesignAuthorityLocation } from './blueprint-skill-projection';

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
  construction_mapping?: import('./blueprint-skill-projection').ChangeUnitConstructionMapping;
}

type CompactDesignSelection = Pick<ComponentBlueprintRef, 'target'> & {
  implementation_refs?: string[];
  verification_refs?: string[];
};
type ConstructionMapping = NonNullable<ChangeUnitCandidate['construction_mapping']>;

export interface ChangeUnitCandidateInput extends Omit<ChangeUnitCandidate, 'artifact' | 'construction_mapping'> {
  artifact: Omit<ChangeUnitArtifact, 'design_refs' | 'touches'> & {
    design_refs: Array<ComponentBlueprintRef | CompactDesignSelection>;
    touches: Array<Omit<ChangeUnitArtifact['touches'][number], 'design_ref'> & { design_ref: ComponentBlueprintRef | Pick<ComponentBlueprintRef, 'target'> }>;
  };
  construction_mapping?: Omit<ConstructionMapping, 'design_ref_mappings'> & { design_ref_mappings?: ConstructionMapping['design_ref_mappings'] };
}

export function dropUnacceptedChangeUnitCandidates(_candidates: readonly ChangeUnitCandidate[]): ChangeUnitCandidate[] {
  return [];
}

export class ChangeUnitCandidateRejected extends Error {
  constructor(public readonly code: string, message: string,
    public readonly designAuthority?: import('./blueprint-skill-projection').DesignAuthorityFinding[],
    public readonly issues?: ChangeUnitPrecheckIssue[]) {
    super(message);
    this.name = 'ChangeUnitCandidateRejected';
  }
}

export interface ChangeUnitPrecheckIssue {
  owner: 'blueprint' | 'candidate';
  code: string;
  message: string;
  change_unit_id?: string;
  locations?: DesignAuthorityLocation[];
}

interface CandidateAuthority {
  snapshot: ReturnType<typeof loadCanonicalBlueprint>;
  blueprint: BlueprintRecord;
  resolve: typeof resolveComponentBlueprintRef;
}

function candidateProjection(projectRoot: string, candidate: ChangeUnitCandidate, authority?: CandidateAuthority): BlueprintSkillProjection {
  const { deriveBlueprintCandidateSkillInput } = require('./blueprint-skill-projection') as typeof import('./blueprint-skill-projection');
  const { artifact } = candidate;
  const source = authority?.snapshot ?? loadCanonicalBlueprint(projectRoot, artifact.blueprint_id);
  return deriveBlueprintCandidateSkillInput(projectRoot, deriveChangeUnitFeatureId(artifact.blueprint_id, artifact.change_unit_id), resolveProbeFrameworkRoot(projectRoot),
    'contracts', { blueprint: authority?.blueprint ?? source.blueprint, blueprintSource: source, changeUnit: artifact, constructionMapping: candidate.construction_mapping });
}

/** A late cleanup may consume only a batch already written with the same CU and authored landings. */
export function matchesAcceptedChangeUnitCandidate(projectRoot: string, input: ChangeUnitCandidateInput): boolean {
  try {
    const candidate = expandChangeUnitCandidate(input);
    const { artifact } = candidate;
    const existing = loadCanonicalChangeUnit(projectRoot, artifact.blueprint_id, artifact.change_unit_id);
    if (stableJson(existing.changeUnit) !== stableJson(artifact)) return false;
    if (!candidate.construction_mapping) return true;
    const expected = candidateProjection(projectRoot, candidate);
    if (expected.state !== 'resolved') return false;
    const { resolveFeatureArtifact } = require('../../config') as typeof import('../../config');
    const feature = deriveChangeUnitFeatureId(artifact.blueprint_id, artifact.change_unit_id);
    const contracts = resolveFeatureArtifact(projectRoot, feature, 'contracts.yaml');
    if (!contracts.exists) return false;
    const actual = asRecord(YAML.parse(fs.readFileSync(contracts.actualPath, 'utf8')))?.change_unit;
    return stableJson(actual) === stableJson(asRecord(expected.value)?.change_unit);
  } catch { return false; }
}

/** The candidate selects its target once. Canonical CU and Feature contracts keep their existing exact references. */
export function expandChangeUnitCandidate(input: ChangeUnitCandidateInput): ChangeUnitCandidate {
  const compact = (selection: unknown, allowed: string[]): selection is CompactDesignSelection => {
    const record = asRecord(selection);
    return !!asRecord(record?.target) && Object.keys(record!).every(key => allowed.includes(key));
  };
  const compactFields = ['target', 'implementation_refs', 'verification_refs'];
  const author = input.artifact;
  if (!asRecord(author?.component_blueprint_ref) || !Array.isArray(author?.design_refs)) return input as ChangeUnitCandidate;
  const compactReferences = author.design_refs.some(selection => compact(selection, compactFields));
  if (!compactReferences && !(Array.isArray(author.touches) && author.touches.some(touch => compact(touch?.design_ref, ['target'])))) return input as ChangeUnitCandidate;
  const candidate = structuredClone(input);
  const artifact = candidate.artifact;
  const complete = (selection: Pick<ComponentBlueprintRef, 'target'>): ComponentBlueprintRef =>
    ({ ...artifact.component_blueprint_ref, target: structuredClone(selection.target) });
  const { construction_mapping: section, ...original } = candidate;
  const existing = Array.isArray(section?.design_ref_mappings) ? section.design_ref_mappings : [];
  const designRefs = artifact.design_refs.map((selection, index) => {
    if (!compact(selection, compactFields)) return selection as ComponentBlueprintRef;
    const ref = complete(selection);
    if (!Object.prototype.hasOwnProperty.call(selection, 'implementation_refs') && !Object.prototype.hasOwnProperty.call(selection, 'verification_refs')) return ref;
    const row = existing.findIndex(mapping => {
      const source = asRecord(mapping?.design_ref);
      return stableJson(source?.target ?? source) === stableJson(ref.target);
    });
    const prior = existing[row];
    if (!prior) existing.push({ design_ref: ref, implementation_refs: selection.implementation_refs ?? [], verification_refs: selection.verification_refs ?? [] });
    else for (const key of ['implementation_refs', 'verification_refs'] as const) {
      if (!Object.prototype.hasOwnProperty.call(selection, key)) continue;
      if (prior[key] === undefined) prior[key] = selection[key]!;
      else if (stableJson(prior[key]) !== stableJson(selection[key])) throw new ChangeUnitCandidateRejected('change_unit_candidate_design_rejected',
        `${artifact.change_unit_id}: artifact.design_refs[${index}].${key} 与 construction_mapping.design_ref_mappings[${row}].${key} 声明冲突`);
    }
    return ref;
  });
  const touches = Array.isArray(artifact.touches) ? artifact.touches.map(touch => compact(touch?.design_ref, ['target'])
    ? { ...touch, design_ref: complete(touch.design_ref) } : touch) as ChangeUnitArtifact['touches'] : artifact.touches as ChangeUnitArtifact['touches'];
  if (section && section.design_ref_mappings === undefined) section.design_ref_mappings = existing;
  return { ...original, artifact: { ...artifact, design_refs: designRefs, touches },
    ...(section ? { construction_mapping: section as ConstructionMapping } : compactReferences ? {
      construction_mapping: { predicate_mappings: [], provide_mappings: [], design_ref_mappings: existing },
    } : {}) };
}

/** The runtime supplies the exact draft and candidate bytes bound to the independent questioning request. */
export function rebindQuestionedChangeUnitCandidates(beforeBlueprint: Buffer, current: ReturnType<typeof loadCanonicalBlueprint>,
  candidates: readonly ChangeUnitCandidateInput[]): ChangeUnitCandidate[] {
  const before = asRecord(YAML.parse(beforeBlueprint.toString('utf8')));
  const rejected = (message: string) => new ChangeUnitCandidateRejected('change_unit_candidate_blueprint_mismatch', message);
  if (!before || before.blueprint_id !== current.blueprint.blueprint_id || before.component_id !== current.blueprint.component_id
    || before.revision !== current.blueprint.revision || stableJson(blueprintAuthorContent(before)) !== stableJson(blueprintAuthorContent(current.blueprint))) {
    throw rejected('独立质询前像与当前蓝图设计内容不一致，请原作者核对当前候选和精确蓝图身份。');
  }
  const rootRef = { artifact: 'component-blueprint@1' as const, blueprint_id: String(before.blueprint_id), component_id: String(before.component_id),
    target: { kind: 'blueprint' as const, id: String(before.blueprint_id) } };
  const previous = { ...rootRef, ...currentBlueprintIdentity({ ...current, blueprint: before,
    artifactSha256: 'sha256:' + createHash('sha256').update(beforeBlueprint).digest('hex') }) };
  const identity = currentBlueprintIdentity(current);
  const next = { ...rootRef, ...identity };
  return candidates.map(input => {
    const candidate = expandChangeUnitCandidate(structuredClone(input));
    const owner = candidate.artifact.component_blueprint_ref;
    if (!asRecord(owner)) throw rejected(`${candidate.artifact.change_unit_id}: 缺少候选蓝图绑定。`);
    const refs = [...blueprintIdentityPointers(candidate.artifact as unknown as Record<string, unknown>),
      ...(candidate.construction_mapping?.design_ref_mappings ?? []).map(row => asRecord(row.design_ref)).filter(ref => ref?.artifact !== undefined)];
    const basis = sameBlueprintIdentity(owner, previous) ? previous : next;
    if (refs.some(ref => !ref || !sameBlueprintIdentity(ref as unknown as ComponentBlueprintRef, basis))) {
      throw rejected(`${candidate.artifact.change_unit_id}: 候选含未绑定到已质询前像或当前蓝图的引用，请原候选作者重验。`);
    }
    for (const ref of refs) Object.assign(ref!, identity);
    return candidate;
  });
}

/** A published author revision can introduce new IDs on targets the original candidate already owns. */
export function assertPendingCandidateAcceptanceReferences(
  baseline: import('./component-blueprint-model').BlueprintRecord,
  current: import('./component-blueprint-model').BlueprintRecord,
  original: readonly ChangeUnitCandidateInput[],
  candidates: readonly ChangeUnitCandidateInput[],
): void {
  const { resolveBlueprintTarget, stableAddressIndex } = require('./blueprint-addressing') as typeof import('./blueprint-addressing');
  const { asRecord, asRecords } = require('./component-blueprint-model') as typeof import('./component-blueprint-model');
  const { extractAcceptanceIdRefs } = require('./check-acceptance') as typeof import('./check-acceptance');
  const acceptanceIds = (target: ReturnType<typeof asRecord>): string[] => {
    const acceptance = asRecord(target?.acceptance);
    return ['criteria', 'boundaries', 'performance'].flatMap(key => asRecords(acceptance?.[key]).flatMap(row =>
      typeof row.id === 'string' && extractAcceptanceIdRefs(row.id).includes(row.id.toUpperCase()) ? [row.id.toUpperCase()] : []));
  };
  const oldIds = new Set([...stableAddressIndex(baseline).values()].flatMap(acceptanceIds));
  const owners = new Map<string, Set<string>>();
  for (const { artifact } of original) for (const ref of artifact.design_refs) {
    let target;
    try { target = resolveBlueprintTarget(current, ref.target); }
    catch { continue; } // Identity and closure still go through the original consumer.
    for (const id of acceptanceIds(target)) if (!oldIds.has(id)) {
      const ids = owners.get(id) ?? new Set<string>();
      ids.add(artifact.change_unit_id);
      owners.set(id, ids);
    }
  }
  const required = [...owners].filter(([, matches]) => matches.size === 1);
  const missing = new Map<string, string[]>();
  for (const [id, matches] of required) {
    const [owner] = matches;
    const artifact = candidates.find(row => row.artifact.change_unit_id === owner)?.artifact;
    if (!artifact?.verification_refs.some(ref => extractAcceptanceIdRefs(ref).includes(id))) {
      missing.set(owner, [...missing.get(owner) ?? [], id]);
    }
  }
  if (missing.size) throw new ChangeUnitCandidateRejected('change_unit_candidate_design_rejected',
    `蓝图已有新验收。由原分解写方在同一候选的 verification_refs 补齐：${[...missing]
      .map(([id, refs]) => `${id} → ${refs.join('、')}`).join('；')}。保留当前蓝图及候选身份。`);
  if (required.length && (candidates.length !== original.length || candidates.some(row =>
    !original.some(prior => prior.artifact.change_unit_id === row.artifact.change_unit_id)))) {
    throw new ChangeUnitCandidateRejected('change_unit_candidate_design_rejected', '当前候选补齐验收引用须保留原批次 CU 身份。');
  }
}

/**
 * 唯一 consumer 校验原语：provider provenance → 目标路径 → 重复接受 → canonical schema/identity
 * → 设计闭包门。**只做校验、不落盘**，返回已校验的目标路径。
 *
 * 单候选与批量接受都必须经过它，避免两份会漂移的 provenance/schema/design 逻辑。
 */
export function validateChangeUnitCandidate(projectRoot: string, candidate: ChangeUnitCandidate, existing?: LoadedChangeUnit, authority?: CandidateAuthority): string {
  const artifact = candidate.artifact;
  if (!artifact.provenance.extraction_method.includes(candidate.providerId)) {
    throw new ChangeUnitCandidateRejected(
      'change_unit_candidate_provider_provenance_missing',
      `候选 ${artifact.change_unit_id} 的 provenance.extraction_method 未记录 provider ${candidate.providerId}。`,
    );
  }
  const target = changeUnitPath(projectRoot, artifact.blueprint_id, artifact.change_unit_id);
  if (fs.existsSync(target) && !existing) {
    throw new ChangeUnitCandidateRejected(
      'change_unit_candidate_already_exists',
      `canonical CU 已存在，重复接受 fail-closed：${target}。未完成活动单元经 reviseChangeUnitContent 修订；完成后新增工作用新 change_unit_id + supersedes，蓝图身份变化走原指针调和。`,
    );
  }
  if (existing && path.resolve(target) !== path.resolve(existing.canonicalPath)) throw new ChangeUnitCandidateRejected('change_unit_candidate_blueprint_mismatch', '内容修订不得改变 CU/Feature identity 或目录。');
  try {
    assertValidChangeUnit(artifact as unknown as Record<string, unknown>, { projectRoot, canonicalPath: target, resolveBlueprintRef: authority?.resolve });
  } catch (error) {
    throw new ChangeUnitCandidateRejected(
      'change_unit_candidate_schema_rejected',
      `候选 ${artifact.change_unit_id} 未通过 canonical 校验：${(error as Error).message}`,
    );
  }
  const design = validateChangeUnitDesign(projectRoot, artifact as unknown as Record<string, unknown>, { resolveBlueprintRef: authority?.resolve });
  if (design.verdict !== 'constructable') {
    const { blueprintCandidateAuthorityFindings } = require('./blueprint-skill-projection') as typeof import('./blueprint-skill-projection');
    const failures = design.issues.map(issue => ({ codes: [issue.id], detail: issue.message, locations: issue.authority ? [issue.authority] : [] }));
    const designAuthority = blueprintCandidateAuthorityFindings(projectRoot, artifact.blueprint_id, { state: 'invalid', dependencies: [], failures });
    const projection = candidateProjection(projectRoot, candidate, authority);
    for (const finding of blueprintCandidateAuthorityFindings(projectRoot, artifact.blueprint_id, projection)) {
      if (!designAuthority.some(prior => JSON.stringify(prior.locations) === JSON.stringify(finding.locations)
        && JSON.stringify(prior.codes) === JSON.stringify(finding.codes))) designAuthority.push(finding);
    }
    throw new ChangeUnitCandidateRejected(
      'change_unit_candidate_design_rejected',
      `候选 ${artifact.change_unit_id} 未通过设计闭包门（${design.verdict}）：${design.issues.map(item => `${item.id}: ${item.message}`).join('；')}`
        + (projection.state === 'invalid' ? '\n' + projection.failures?.filter(failure => !failure.codes.some(code => design.issues.some(issue => issue.id === code)))
          .map(failure => failure.detail).join('\n') : ''),
      designAuthority.length ? designAuthority : undefined,
      [...design.issues.map(issue => ({ owner: issue.route === 'reconcile_blueprint' ? 'blueprint' as const : 'candidate' as const,
        code: issue.id, message: issue.message, change_unit_id: artifact.change_unit_id, locations: issue.authority ? [issue.authority] : undefined })),
      ...projectionIssues(projectRoot, artifact, projection)],
    );
  }
  return target;
}

function projectionIssues(projectRoot: string, artifact: ChangeUnitArtifact, projection: BlueprintSkillProjection): ChangeUnitPrecheckIssue[] {
  if (projection.state === 'resolved') return [];
  const { blueprintCandidateAuthorityFindings } = require('./blueprint-skill-projection') as typeof import('./blueprint-skill-projection');
  const failures = projection.failures?.length ? projection.failures : [{ codes: projection.codes ?? [], detail: projection.detail ?? '缺少可消费的施工契约', locations: projection.locations ?? [] }];
  return failures.map(failure => ({
    owner: blueprintCandidateAuthorityFindings(projectRoot, artifact.blueprint_id, { ...projection, failures: [failure] }).length ? 'blueprint' : 'candidate',
    code: failure.codes[0] ?? 'change_unit_candidate_design_rejected', message: failure.detail, change_unit_id: artifact.change_unit_id,
    ...(failure.locations.length ? { locations: failure.locations } : {}),
  }));
}

function candidateAuthority(projectRoot: string, snapshot: ReturnType<typeof loadCanonicalBlueprint>, draft: boolean): {
  authority: CandidateAuthority; issues: ChangeUnitPrecheckIssue[]; pendingQuestioning: boolean;
} {
  const blueprint = draft ? structuredClone(snapshot.blueprint) : snapshot.blueprint;
  if (draft) {
    const { refreshBlueprintFingerprints } = require('./design-repair-unattended') as typeof import('./design-repair-unattended');
    refreshBlueprintFingerprints(blueprint);
  }
  const context = { projectRoot, canonicalPath: snapshot.canonicalPath, sourceCache: new Map([[path.resolve(snapshot.canonicalPath), blueprint]]) };
  const checks = draft ? validateComponentBlueprintUpstream(blueprint, context) : validateComponentBlueprint(blueprint, context);
  const pendingQuestioning = draft || checks.some(issue => issue.id.startsWith('blueprint_questioning_'));
  const issues: ChangeUnitPrecheckIssue[] = checks.filter(issue => issue.severity === 'BLOCKER' && !(draft && issue.id.startsWith('blueprint_questioning_')))
    .map(issue => ({ owner: 'blueprint', code: issue.id, message: `${issue.path}: ${issue.message}` }));
  return { authority: { snapshot, blueprint, resolve: (_root, ref) => resolveBlueprintCandidateRefFromLoaded(snapshot, blueprint, ref) }, issues, pendingQuestioning };
}

interface PreparedCandidateBatch {
  candidates: ChangeUnitCandidate[];
  targets: string[];
  errors: ChangeUnitCandidateRejected[];
  issues: ChangeUnitPrecheckIssue[];
  authorities: Map<string, CandidateAuthority>;
  pendingQuestioning: boolean;
}

/** Shared read-only preparation. Draft mode defers independent questioning and retains exact input bindings. */
function prepareCandidateBatch(projectRoot: string, input: readonly ChangeUnitCandidateInput[], options?: {
  snapshot: ReturnType<typeof loadCanonicalBlueprint>;
  draft: boolean;
}): PreparedCandidateBatch {
  const prepared: PreparedCandidateBatch = { candidates: [], targets: [], errors: [], issues: [], authorities: new Map(), pendingQuestioning: false };
  const authorityIssues = new Map<string, ChangeUnitPrecheckIssue[]>();
  const authorityFor = (blueprintId: string): CandidateAuthority => {
    const prior = prepared.authorities.get(blueprintId);
    if (prior) return prior;
    let snapshot: ReturnType<typeof loadCanonicalBlueprint>;
    try { snapshot = options?.snapshot ?? loadCanonicalBlueprint(projectRoot, blueprintId); }
    catch (error) {
      const issues: ChangeUnitPrecheckIssue[] = [{ owner: 'blueprint', code: 'change_unit_blueprint_unresolvable', message: (error as Error).message }];
      throw new ChangeUnitCandidateRejected('change_unit_candidate_schema_rejected', issues[0].message, undefined, issues);
    }
    if (snapshot.blueprint.blueprint_id !== blueprintId) throw new ChangeUnitCandidateRejected('change_unit_candidate_blueprint_mismatch', `候选归属 ${blueprintId}，与当前设计 ${String(snapshot.blueprint.blueprint_id)} 不一致。`);
    const observed = candidateAuthority(projectRoot, snapshot, !!options?.draft);
    prepared.issues.push(...observed.issues);
    authorityIssues.set(blueprintId, observed.issues);
    prepared.pendingQuestioning ||= observed.pendingQuestioning;
    prepared.authorities.set(blueprintId, observed.authority);
    return observed.authority;
  };
  if (options) authorityFor(String(options.snapshot.blueprint.blueprint_id));
  if (!input.length && options?.draft) {
    const id = String(options.snapshot.blueprint.blueprint_id);
    const { blueprintDeclaredAcceptanceIssues } = require('./blueprint-skill-projection') as typeof import('./blueprint-skill-projection');
    prepared.issues.push(...blueprintDeclaredAcceptanceIssues(projectRoot, id, authorityFor(id).blueprint).map(issue => ({
      owner: 'blueprint' as const, code: issue.id, message: `${issue.path}: ${issue.message}`,
    })));
  }
  const seen = new Set<string>();
  for (const row of input) {
    const candidateRecord = asRecord(row);
    const candidateArtifact = asRecord(candidateRecord?.artifact);
    const id = typeof candidateArtifact?.change_unit_id === 'string' ? candidateArtifact.change_unit_id : undefined;
    try {
      if (!id || typeof candidateRecord?.providerId !== 'string' || !candidateRecord.providerId.trim()
        || typeof candidateArtifact?.blueprint_id !== 'string' || typeof asRecord(candidateArtifact.provenance)?.extraction_method !== 'string') {
        throw new ChangeUnitCandidateRejected('change_unit_candidate_schema_rejected', '候选须含 providerId、artifact.blueprint_id、change_unit_id 及 provenance.extraction_method。');
      }
      if (seen.has(id)) throw new ChangeUnitCandidateRejected('change_unit_candidate_duplicate_in_batch', `同一批候选内 change_unit_id=${id} 重复。`);
      seen.add(id);
      const candidate = expandChangeUnitCandidate(row);
      if (!candidate.artifact.provenance.extraction_method.includes(candidate.providerId)) {
        throw new ChangeUnitCandidateRejected('change_unit_candidate_provider_provenance_missing',
          `候选 ${id} 的 provenance.extraction_method 未记录 provider ${candidate.providerId}。`);
      }
      const authority = authorityFor(candidate.artifact.blueprint_id);
      const target = validateChangeUnitCandidate(projectRoot, candidate, undefined, authority);
      prepared.candidates.push(candidate);
      prepared.targets.push(target);
      if (candidate.construction_mapping) {
        const projection = candidateProjection(projectRoot, candidate, authority);
        if (projection.state !== 'resolved' || !projection.artifacts?.['acceptance@1']) {
          const { blueprintCandidateAuthorityFindings } = require('./blueprint-skill-projection') as typeof import('./blueprint-skill-projection');
          const design = blueprintCandidateAuthorityFindings(projectRoot, candidate.artifact.blueprint_id, projection);
          const issues = projection.state === 'resolved' ? [{ owner: 'blueprint' as const, code: 'authority_content_missing', message: '候选选定目标缺少可消费的 typed acceptance', change_unit_id: id }]
            : projectionIssues(projectRoot, candidate.artifact, projection);
          throw new ChangeUnitCandidateRejected('change_unit_candidate_design_rejected', projection.detail ?? issues[0].message,
            design.length ? design : undefined, issues);
        }
      }
    } catch (error) {
      const rejected = error instanceof ChangeUnitCandidateRejected ? error
        : new ChangeUnitCandidateRejected('change_unit_candidate_design_rejected', (error as Error).message);
      prepared.errors.push(rejected);
      prepared.issues.push(...(rejected.issues ?? [{ owner: rejected.designAuthority?.length ? 'blueprint' : 'candidate',
        code: rejected.code, message: rejected.message, change_unit_id: id }]));
    }
  }
  for (const [blueprintId, authority] of prepared.authorities) {
    const candidates = prepared.candidates.filter(candidate => candidate.artifact.blueprint_id === blueprintId);
    if (!candidates.length) continue;
    const ownership = readChangeUnitDesignOwnership(projectRoot, blueprintId, candidates.map(candidate => candidate.artifact), authority.blueprint, authority.snapshot);
    if (!ownership.length) continue;
    const issues = ownership.map(issue => ({ owner: 'candidate' as const, code: issue.id, message: issue.message }));
    prepared.issues.push(...issues);
    prepared.errors.push(new ChangeUnitCandidateRejected('change_unit_candidate_design_rejected',
      ownership.map(issue => `${issue.id}: ${issue.message}`).join('\n'), undefined, issues));
  }
  const blueprintIssues = [...authorityIssues.values()].flat();
  if (blueprintIssues.length && !options?.draft) {
    const { blueprintCandidateAuthorityFindings } = require('./blueprint-skill-projection') as typeof import('./blueprint-skill-projection');
    const findings = [...authorityIssues].flatMap(([blueprintId, issues]) => blueprintCandidateAuthorityFindings(projectRoot, blueprintId,
      { state: 'invalid', dependencies: [], failures: issues.map(issue => ({ codes: ['change_unit_blueprint_reconciliation_required'], detail: issue.message, locations: [] })) }));
    prepared.errors.unshift(new ChangeUnitCandidateRejected('change_unit_candidate_design_rejected',
      blueprintIssues.map(issue => issue.message).join('\n'), findings, blueprintIssues));
  }
  return prepared;
}

export function inspectChangeUnitCandidateBatch(input: {
  projectRoot: string; blueprintId: string; draftPath?: string; candidatesPath?: string;
}): { ready_for_questioning: boolean; pending_questioning: boolean; issues: ChangeUnitPrecheckIssue[]; blueprint_identity?: ComponentBlueprintRef;
  designAuthority?: ChangeUnitCandidateRejected['designAuthority'] } {
  const { projectRoot, blueprintId } = input;
  let owner: ChangeUnitPrecheckIssue['owner'] = 'blueprint';
  try {
    const artifactPath = (file: string, label: string) =>
      path.resolve(projectRoot, validateProjectRelativePath(projectRoot, path.relative(projectRoot, path.resolve(projectRoot, file)), label));
    let snapshot: ReturnType<typeof loadCanonicalBlueprint>;
    if (input.draftPath) {
      const bytes = fs.readFileSync(artifactPath(input.draftPath, 'blueprint draft'));
      const blueprint = asRecord(YAML.parse(bytes.toString('utf8')));
      if (!blueprint || blueprint.blueprint_id !== blueprintId) throw new Error(`草案 blueprint_id 必须为 ${blueprintId}。`);
      snapshot = { bytes, blueprint, canonicalPath: componentBlueprintPath(projectRoot, blueprintId),
        artifactSha256: 'sha256:' + createHash('sha256').update(bytes).digest('hex') };
    } else snapshot = loadCanonicalBlueprint(projectRoot, blueprintId);
    const rootRef = { artifact: 'component-blueprint@1' as const, blueprint_id: blueprintId, component_id: String(snapshot.blueprint.component_id),
      target: { kind: 'blueprint' as const, id: blueprintId }, ...currentBlueprintIdentity(snapshot) };
    owner = 'candidate';
    const candidates: unknown = input.candidatesPath ? JSON.parse(fs.readFileSync(artifactPath(input.candidatesPath, 'change unit candidates'), 'utf8')) : [];
    if (!Array.isArray(candidates)) throw new Error('候选文件须为 JSON 数组 [{providerId, artifact, construction_mapping?}]');
    const result = prepareCandidateBatch(projectRoot, candidates as ChangeUnitCandidateInput[], { snapshot, draft: true });
    const findings = result.errors.flatMap(error => error.designAuthority ?? []);
    return { ready_for_questioning: !result.issues.length, pending_questioning: result.pendingQuestioning,
      issues: result.issues, blueprint_identity: rootRef, ...(findings.length ? { designAuthority: findings } : {}) };
  } catch (error) {
    return { ready_for_questioning: false, pending_questioning: true, issues: [
      { owner, code: error instanceof ChangeUnitCandidateRejected ? error.code : 'change_unit_candidate_schema_rejected', message: (error as Error).message },
    ] };
  }
}

/** 唯一写入原语：temp(wx) → rename。批量接受与蓝图指针原位升版（design-preparation）共用。 */
export function writeCanonicalChangeUnit(target: string, artifact: ChangeUnitArtifact, suffix: string): void {
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
  input: readonly ChangeUnitCandidateInput[],
) {
  if (!input.length) throw new ChangeUnitCandidateRejected('change_unit_decomposition_empty', '设计准备子流程必须写出 1..N 个 canonical CU；零候选不构成一次接受。');
  const prepared = prepareCandidateBatch(projectRoot, input);
  if (prepared.errors.length) throw new ChangeUnitCandidateRejected(prepared.errors[0].code,
    prepared.errors.map(error => error.message).join('\n'),
    prepared.errors.some(error => error.designAuthority?.length) ? prepared.errors.flatMap(error => error.designAuthority ?? []) : undefined,
    prepared.issues);
  const { candidates, targets } = prepared;
  for (const { snapshot } of prepared.authorities.values()) if (!fs.readFileSync(snapshot.canonicalPath).equals(snapshot.bytes)) {
    throw new ChangeUnitCandidateRejected('change_unit_candidate_blueprint_mismatch', '候选准备期间蓝图已变化，请按当前绑定重验。');
  }

  const written: string[] = [];
  const projections: Array<{ file: string; previous?: Buffer }> = [];
  let projectionCandidate: ChangeUnitCandidate | undefined;
  try {
    candidates.forEach((candidate, index) => {
      writeCanonicalChangeUnit(targets[index]!, candidate.artifact, `${process.pid}-${index}`);
      written.push(targets[index]!);
    });
    const { materializeBlueprintSkillInputs, resolveChangeUnitConstructionInputs, BLUEPRINT_PROJECTION_FILES } = require('./blueprint-skill-projection') as typeof import('./blueprint-skill-projection');
    const { resolveFeatureArtifact } = require('../../config') as typeof import('../../config');
    for (const candidate of candidates) {
      projectionCandidate = candidate;
      const feature = deriveChangeUnitFeatureId(candidate.artifact.blueprint_id, candidate.artifact.change_unit_id);
      const frameworkRoot = resolveProbeFrameworkRoot(projectRoot);
      if (!candidate.construction_mapping && resolveChangeUnitConstructionInputs(projectRoot, feature, frameworkRoot).gap) continue;
      for (const name of Object.values(BLUEPRINT_PROJECTION_FILES)) {
        const location = resolveFeatureArtifact(projectRoot, feature, name);
        projections.push({ file: location.exists ? location.actualPath : location.canonicalPath,
          ...(location.exists ? { previous: fs.readFileSync(location.actualPath) } : {}) });
      }
      materializeBlueprintSkillInputs(projectRoot, feature, frameworkRoot, undefined, undefined, candidate.construction_mapping);
    }
  } catch (error) {
    const { BlueprintProjectionPreparationError, blueprintCandidateAuthorityFindings } = require('./blueprint-skill-projection') as typeof import('./blueprint-skill-projection');
    const projection = error instanceof BlueprintProjectionPreparationError ? error.projection : undefined;
    const designAuthority = projection?.state === 'invalid' && projectionCandidate
      ? blueprintCandidateAuthorityFindings(projectRoot, projectionCandidate.artifact.blueprint_id, projection) : undefined;
    for (const projection of projections) if (projection.previous) fs.writeFileSync(projection.file, projection.previous);
    else if (fs.existsSync(projection.file)) fs.unlinkSync(projection.file);
    for (const target of written) {
      if (fs.existsSync(target)) fs.unlinkSync(target);
    }
    throw new ChangeUnitCandidateRejected(
      projection?.state === 'invalid' ? 'change_unit_candidate_design_rejected' : 'change_unit_decomposition_write_failed',
      `原子写出失败并已回滚本批：${(error as Error).message}`,
      designAuthority?.length ? designAuthority : undefined,
    );
  }
  return candidates.map(candidate => loadCanonicalChangeUnit(
    projectRoot,
    candidate.artifact.blueprint_id,
    candidate.artifact.change_unit_id,
  ));
}

/** 单候选接受 = 批量接受的 1 元包装。不保留第二份校验/落盘实现。 */
export function acceptChangeUnitCandidate(projectRoot: string, candidate: ChangeUnitCandidateInput) {
  return acceptChangeUnitCandidates(projectRoot, [candidate])[0]!;
}
