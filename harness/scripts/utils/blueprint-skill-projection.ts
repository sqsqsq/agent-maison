import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as YAML from 'yaml';
import { resolveFeatureArtifact, loadFrameworkConfig, featureFilePath } from '../../config';
import { loadWorkflowSpec } from '../../workflow-loader';
import { loadEffectiveExecutionScope } from './goal-run-creation';
import { resolveExecutionScope, findSubtractedRequiredObligations, type ExecutionScope, type ExecutionScopeInput } from './execution-scope';
import { readScopeAcceptance, collectResolvedScopeFacts, recomputeDefinitionFacts } from './feature-track';
import { loadGoalManifestFromRun } from './goal-manifest';
import { asRecord, asRecords, type BlueprintRecord } from './component-blueprint-model';
import { componentBlueprintPath, resolveComponentBlueprintRef } from './component-blueprint-path';
import { parseChangeUnitFeatureId, loadCanonicalChangeUnit, asChangeUnitArtifact, changeUnitPath, BLUEPRINT_REF_STALE_ISSUE } from './change-unit-path';
import { validateChangeUnitDesign } from './change-unit-design-gate';
import { validateChangeUnit } from './change-unit-validator';
import { checkChangeUnitFeatureProjection, validateChangeUnitFeatureProjection } from './change-unit-feature-projection';
import { resolveContractFileReferences, findUnauthorizedContractFileReferences, CONTRACT_FILE_REFERENCE_FIELDS } from './contract-reference-closure';
import { checkAcceptanceContent, checkAcceptanceUtLayerComplete, checkAcceptanceDeviceFocusPresent, checkAcceptanceLinkedUseCases, extractAcceptanceIdRefs } from './check-acceptance';
import { isInsideProjectRoot } from './project-relative-path';
import { evaluateAcceptanceFlowStructure } from './p0-semantic-gates';
import { SpecLoader } from './spec-loader';
import { checkUseCaseSpecSchema } from '../check-ut';
import type { AcceptanceSpec, CheckContext, CheckResult, ContractsSpec } from './types';
import type { ResolutionDependency } from './capability-resolution';
import { resolveCheckDisposition } from './check-disposition';

export type BlueprintProjectionKind = 'acceptance' | 'contracts';
/** plan 9c3d7e1a §3：invalid 的结构化原因——取自 validateChangeUnit 的 issue code，不解析 detail 文本。 */
export type DesignAuthorityInvalidReason = 'blueprint_ref_stale' | 'other';
/**
 * B1 原因码在蓝图里的位置：哪份蓝图、哪个 design_ref 目标、目标下的哪个字段（点分路径）。
 * `authority_content_not_machine_structure` → acceptance / contracts / use_cases；`authority_cu_mapping_stale` → contracts.change_unit.change_unit_ref。
 */
export interface DesignAuthorityLocation { blueprint_id: string; target: { kind: string; view_id?: string; id: string }; field: string }
export interface BlueprintSkillProjection {
  state: 'resolved' | 'absent' | 'invalid';
  dependencies: ResolutionDependency[];
  detail?: string;
  /** 仅 invalid：BLOCKER 只有 `change_unit_blueprint_ref_stale` 时为 'blueprint_ref_stale'，其余 'other'。 */
  reason?: DesignAuthorityInvalidReason;
  /** 仅 invalid（plan 9c3d7e1a §5.0）：失败处的 issue code——验证器 / 解析器 / 设计门的既有 code，或投影自身抛错点的 code；分类表按它判 B1 / B2。 */
  codes?: string[];
  /** 仅 invalid（plan 9c3d7e1a t6 codex 第五轮）：B1 原因码在蓝图里的位置——修复只许改这些位置。 */
  locations?: DesignAuthorityLocation[];
  value?: AcceptanceSpec | ContractsSpec;
  artifacts?: Record<string, unknown>;
}

/** Publish new design facts through P2's existing report field, never mutate the born scope. */
export function designScopeRevisionChecks(ctx: CheckContext, checks: CheckResult[]): CheckResult[] {
  const subject = ctx.factsContext?.subject;
  // D1 §6.4：无 run 不再直接放弃修订提议——feature 载体也要能发布新设计事实。
  // 身份位按载体二分：run 载体取 `run_id`，feature 载体（`{ feature }`）走统一入口的 feature 分支。
  // plan f7045213 第二批：已登记为披露的账本与形状类失败（探索过程的自报数字与格式，不是设计事实的依据）
  // 不挡发布；其余任何 FAIL（不分级别）保持原判据——这里不整体改成谓词。
  if (!subject || !('feature' in subject) || !ctx.resolvedInputs || checks.some(check => check.status === 'FAIL' && resolveCheckDisposition(check).action !== 'disclose')) return [];
  const runId = 'run_id' in subject ? subject.run_id : undefined;
  if ('run_id' in subject && !runId) return [];
  const scope = loadEffectiveExecutionScope(ctx.projectRoot, ctx.feature, runId);
  // plan a9f3c7d2 第二笔（R5）：request 终点原先被整个排除在定义事实修订之外，于是单职责 spec/plan
  // 即使产出合法 acceptance/contracts、检查全 PASS，出生时的 unknown 也永远关不掉，run 恒判
  // `execution_scope_unresolved`。两种终点都进；下面三处按 completion_target 二分，feature 分支一字不变。
  if (!scope) return [];
  const kind = ctx.phase === 'spec' ? 'acceptance-context' : 'design-context';
  const inputId = ctx.phase === 'spec' ? 'acceptance' : 'contracts';
  const resolved = ctx.resolvedInputs.values[inputId];
  if (resolved?.state !== 'resolved') return [];
  if (scope.obligations.some(obligation => obligation.kind === kind && obligation.basis.some(binding => canonical(binding) === canonical(resolved.binding)))) return [];
  const remaining = [...new Set(scope.obligations.filter(obligation => obligation.applicability === 'required' && !obligation.satisfied_by?.length && obligation.owner_phase !== ctx.phase).map(obligation => obligation.owner_phase))];
  // 请求动作按终点二分：feature 终点仍是「除本阶段外还剩哪些责任阶段」；request 终点是单职责请求，
  // 请求动作**就是它自己**——结构上不可能新增阶段（`feature-track.ts` 另有一道 fail-closed 校验兜底）。
  const requestedPhases = scope.completion_target === 'feature' ? remaining : [ctx.phase];
  if (!requestedPhases.length) return [];
  const facts = scope.obligations.filter(obligation => ctx.phase !== 'spec' || obligation.applicability !== 'unknown' || !['unit-evidence:pending', 'device-evidence:pending', 'unit-evidence:acceptance', 'device-evidence:acceptance'].includes(obligation.id)).map(obligation => {
    if (obligation.kind !== kind) return structuredClone(obligation);
    const basis = obligation.basis.filter(binding => !(binding.source.kind === 'artifact' && binding.source.artifact === `${inputId}@1`));
    return { ...obligation, applicability: 'required' as const, reason: `${ctx.phase} produced validated design content`, basis: [...basis, resolved.binding], satisfied_by: [resolved.binding] };
  });
  if (!facts.some(fact => fact.kind === kind)) facts.push({ id: `${kind}:design-output`, kind, owner_phase: ctx.phase, applicability: 'required', reason: `${ctx.phase} produced validated design content`, basis: [resolved.binding], satisfied_by: [resolved.binding] });
  if (ctx.phase === 'spec') {
    for (const fact of facts.filter(fact => fact.kind === 'unit-evidence' || fact.kind === 'device-evidence')) {
      fact.basis = [...fact.basis.filter(binding => binding.input_id !== 'acceptance'), resolved.binding];
    }
  }
  const proposal: ExecutionScopeInput = { request: { completion_target: scope.completion_target, requested_results: scope.requested_results, requested_phases: requestedPhases,
    // D0.1: inherit the sourced impact judgement — dropping it sends device back to `unknown`
    // on every revision, so a legal zero-device scope would regress one step each time.
    ...(scope.request_impact ? { impact: scope.request_impact } : {}) },
    facts, contract_fingerprints: [], control_edges: scope.control_edges };
  // This round's freshly produced acceptance wins; otherwise re-read the proposal's own binding.
  // NOT `readScopeAcceptance(...) ?? fallback`: it calls readBoundInput directly, which *throws*
  // on a stale binding, so `??` would never reach the right-hand side. A stale-binding error is
  // deliberately propagated — "source went stale" must not be laundered into "no acceptance".
  const acceptance = ctx.phase === 'spec' && ctx.featureSpec.acceptance
    ? { value: ctx.featureSpec.acceptance, binding: resolved.binding }
    : readScopeAcceptance(ctx.projectRoot, proposal, { feature: ctx.feature, frameworkRoot: ctx.frameworkRoot });
  const workflow = loadWorkflowSpec(ctx.frameworkRoot, loadFrameworkConfig(ctx.projectRoot).active_workflow ?? 'spec-driven');
  // D0.1「不采信自报」同样适用于修订输入：在**提案副本**上按来源重算两条定义类事实，
  // 否则一条手写的 unknown 能在修订里把 §4.1.3 子情形 (a) 的 definitionGapPending 伪造出来。
  // 只动 proposal，不读也不写已冻结的 manifest / 出生范围。
  recomputeDefinitionFacts(proposal, { projectRoot: ctx.projectRoot, feature: ctx.feature, frameworkRoot: ctx.frameworkRoot }, workflow, true);
  const next = resolveExecutionScope(proposal, workflow, acceptance,
    // requirement source (checker-side revision budget): the run's frozen manifest.requirement —
    // this checker only runs inside a real run, so the manifest is always the authority here.
    collectResolvedScopeFacts(proposal, { projectRoot: ctx.projectRoot, feature: ctx.feature, frameworkRoot: ctx.frameworkRoot, ...(runId ? { currentRunId: runId } : {}),
      // requirement source：run 载体取冻结 manifest；feature 载体没有 run manifest，
      // 需求文本留空（provenance 比对由出生冻结时做过，这里不编一份，见批次 2 教训 #15）。
      requirement: runId ? loadGoalManifestFromRun(ctx.projectRoot, runId, { feature: ctx.feature }).requirement : undefined,
      // This budget always inherits the frozen scope impact; it never authors a new one.
      impactInherited: true }));
  if (findSubtractedRequiredObligations(scope, next).length) {
    return [{ id: 'design_scope_facts', category: 'structure', severity: 'BLOCKER', status: 'FAIL', description: '设计修订不得静默删除冻结义务', details: '新验收与既有 required 义务冲突；返回 scope owner 澄清，不缩减本 run 责任', suggestion: '回到 scope owner 澄清验收变化，保留已冻结义务；正式需求变化沿既有 correction/successor 处理。' }];
  }
  // feature 终点：空链＝没有可交接的下一步，不必发提案（既有语义）。
  // request 终点：空链**正是**「本阶段定义义务已满足、没有下一步」——这条修订必须发出去，
  // 否则出生时的 unknown 关不掉，单职责请求永远到不了成功终局。
  if (!next.phase_chain.length && scope.completion_target === 'feature') return [];
  return [{ id: 'design_scope_facts', category: 'structure', severity: 'MINOR', status: 'PASS', description: '新设计事实交由既有 P2 边界重签', details: `${ctx.phase}: ${inputId} 已产生新的真实绑定`, scope_revision_input: proposal }];
}
const digest = (file: string): string => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
export function checkTypedConstructionContent(ctx: CheckContext): CheckResult[] {
  const contracts = ctx.featureSpec.contracts;
  const issues: string[] = [];
  if (!contracts?.files?.length) issues.push('contracts.files 缺少明确授权文件');
  for (const model of contracts?.data_models ?? []) {
    if (!model.name || !model.file || !model.kind) issues.push('data_models 缺 name/file/kind');
    for (const field of model.fields ?? []) if (!field.name || !field.type || field.type === 'any' || typeof field.required !== 'boolean') issues.push(`${model.name}: 字段缺明确类型/required`);
  }
  for (const api of contracts?.interfaces ?? []) {
    if (!api.class || !api.file || !api.methods?.length) issues.push('interfaces 缺 class/file/methods');
    for (const method of api.methods ?? []) if (!method.name || !method.return || method.return === 'any' || !Array.isArray(method.params) || method.params.some(param => !param.name || !param.type || param.type === 'any')) issues.push(`${api.class}: 方法缺精确签名`);
  }
  return [{ id: 'construction_content_complete', description: '施工类型、签名与用例引用完整', category: 'structure', severity: 'BLOCKER', status: issues.length ? 'FAIL' : 'PASS', details: issues.join('; ') || '施工内容完整' }, ...checkAcceptanceLinkedUseCases(ctx), ...(ctx.featureSpec.useCases ? checkUseCaseSpecSchema(ctx) : [])];
}
function canonical(value: unknown): string {
  const sort = (v: unknown): unknown => Array.isArray(v) ? v.map(sort) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sort(x)])) : v;
  return JSON.stringify(sort(value));
}

/**
 * plan b2d7f4e9 t2c/t2d：CU 指针原位升版时，来源戳指向升版前身份（`changeUnitSha` / `blueprintSha`）的派生文件
 * 按定义就是升版前的机器投影，用新投影覆盖即修复（保戳手改在旧蓝图下本就被投影门拒绝，是非法态，不是人工决策）。
 * 只有调和 writer（`reconcileChangeUnitBlueprintRefs`）传入。
 */
export interface ProjectionRefresh { changeUnitSha: string; blueprintSha: string }
/** `materializeBlueprintSkillInputs` 写出的三份派生文件。 */
export const BLUEPRINT_PROJECTION_FILES: Readonly<Record<string, string>> = { 'acceptance@1': 'acceptance.yaml', 'contracts@1': 'contracts.yaml', 'use-cases@1': 'use-cases.yaml' };
function hasPreBumpStamp(artifact: string, existing: unknown, refresh: ProjectionRefresh): boolean {
  const record = asRecord(existing);
  const kind = artifact === 'acceptance@1' ? 'acceptance' : 'contracts';
  if (record?.source !== `derive.blueprint-${kind}:${refresh.changeUnitSha}:${refresh.blueprintSha}`) return false;
  return artifact !== 'contracts@1' || asRecord(asRecord(record.change_unit)?.change_unit_ref)?.artifact_sha256 === refresh.changeUnitSha;
}
/**
 * 升版前只读核对既有派生文件的来源戳：
 *  - `'none'`：没有任何文件带 `derive.blueprint-` 来源戳——不是本 writer 的产物（手写 / 阶段产出），不刷新也不覆盖；
 *  - `'stamped'`：全部既有文件的来源戳都指向升版前身份，可交刷新 writer；
 *  - 文件名数组：部分带戳、或戳不指向升版前身份——不能证明是机器投影。
 */
export function inspectProjectionStamps(projectRoot: string, feature: string, refresh: ProjectionRefresh): 'none' | 'stamped' | string[] {
  const existing = Object.entries(BLUEPRINT_PROJECTION_FILES).flatMap(([artifact, name]) => {
    const location = resolveFeatureArtifact(projectRoot, feature, name);
    if (!location.exists) return [];
    let doc: unknown;
    try { doc = YAML.parse(fs.readFileSync(location.actualPath, 'utf8')); } catch { doc = undefined; }
    return [{ artifact, name, doc }];
  });
  if (!existing.some(({ doc }) => String(asRecord(doc)?.source ?? '').startsWith('derive.blueprint-'))) return 'none';
  const mismatched = existing.filter(({ artifact, doc }) => !hasPreBumpStamp(artifact, doc, refresh)).map(({ name }) => name);
  return mismatched.length ? mismatched : 'stamped';
}

/** 投影合并与 A1 对齐共用的记录身份（plan c4e7a9b2 §3.1）：`[module, file, holder, id ?? name ?? class ?? data]`。 */
function projectionRowIdentity(row: unknown): string | undefined {
  const record = asRecord(row);
  const id = record?.id ?? record?.name ?? record?.class ?? record?.data;
  return id === undefined ? undefined : canonical([record?.module, record?.file, record?.holder, id]);
}

/**
 * 蓝图任意深度的 `source_ref`（需求的 current-scope 来源、契约与事实的 provenance、选型证据……）指向的项目内现存文件
 *（绝对路径，按出现顺序去重）。投影的依赖记录与无人值守修复的保护集合共用这一份解析。
 */
export function blueprintSourceRefFiles(projectRoot: string, blueprint: unknown): string[] {
  const files: string[] = [];
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (key === 'source_ref' && typeof child === 'string') {
        const file = path.resolve(projectRoot, child.split('#')[0]);
        if (!files.includes(file) && isInsideProjectRoot(projectRoot, file) && fs.existsSync(file) && fs.statSync(file).isFile()) files.push(file);
      } else visit(child);
    }
  };
  visit(blueprint);
  return files;
}

/**
 * Copy only explicit machine content selected by the canonical CU; never infer from refs/touches.
 * `refresh === 'pure'`（plan c4e7a9b2 §3.1 纯投影读取）：只跳过「既有 use-cases.yaml 与投影冲突」一处——
 * 那是拿待比较的手写产物反向校验权威；CU 映射来源 stale、投影门与规范化照跑。
 */
export function deriveBlueprintSkillInput(projectRoot: string, feature: string, frameworkRoot: string, kind: BlueprintProjectionKind, refresh?: ProjectionRefresh | 'pure'): BlueprintSkillProjection {
  const dependencies: ResolutionDependency[] = [];
  const depend = (file: string): void => {
    if (!dependencies.some(dep => dep.path === file)) dependencies.push({ path: file, exists: fs.existsSync(file), sha256: fs.existsSync(file) ? digest(file) : null, role: 'artifact' });
  };
  if (!feature.startsWith('cu-')) return { state: 'absent', dependencies, detail: 'blueprint projection requires canonical CU context' };
  let reason: DesignAuthorityInvalidReason = 'other';
  let codes: string[] = [];
  let locations: DesignAuthorityLocation[] = [];
  const fail: (failed: string | string[], message: string, at?: DesignAuthorityLocation[]) => never = (failed, message, at = []) => { codes = [failed].flat(); locations = at; throw new Error(message); };
  try {
    const identity = parseChangeUnitFeatureId(feature);
    const loaded = loadCanonicalChangeUnit(projectRoot, identity.blueprintId, identity.changeUnitId);
    depend(loaded.canonicalPath);
    const cu = asChangeUnitArtifact(loaded.changeUnit);
    const cuIssues = validateChangeUnit(loaded.changeUnit, { projectRoot, canonicalPath: loaded.canonicalPath }).filter(issue => issue.severity === 'BLOCKER');
    if (cuIssues.length) {
      if (cuIssues.every(issue => issue.id === BLUEPRINT_REF_STALE_ISSUE)) reason = 'blueprint_ref_stale';
      fail(cuIssues.map(issue => issue.id), 'component-design: ' + cuIssues.map(issue => issue.message).join('; '));
    }
    const parent = resolveComponentBlueprintRef(projectRoot, cu.component_blueprint_ref);
    depend(parent.canonicalPath);
    for (const file of blueprintSourceRefFiles(projectRoot, parent.blueprint)) depend(file);
    const design = validateChangeUnitDesign(projectRoot, loaded.changeUnit);
    if (design.verdict !== 'constructable') fail(design.issues.map(i => i.id), `component-design: ${design.issues.map(i => i.message).join('; ')}`);
    const selected = cu.design_refs.map(ref => {
      const resolved = resolveComponentBlueprintRef(projectRoot, ref); depend(resolved.canonicalPath);
      const target = asRecord(resolved.target);
      if (!target || ((target[kind] !== undefined || target.use_cases !== undefined) && asRecord(target.provenance)?.evidence_strength !== 'authoritative')) fail('authority_target_provenance_missing', `component-design: ${ref.target.id} 缺获准来源`);
      const content = structuredClone(target);
      if (ref.target.kind === 'flow') for (const state of asRecords(asRecord(content.contracts)?.state_management)) {
        if (state.design_ref === undefined) state.design_ref = ref;
      }
      return { ref, target: content };
    });
    const locate = (field: string, hit: (target: BlueprintRecord) => boolean): DesignAuthorityLocation[] => selected.filter(({ target }) => hit(target)).map(({ ref }) => ({
      blueprint_id: ref.blueprint_id, target: { kind: ref.target.kind, ...(ref.target.view_id !== undefined ? { view_id: ref.target.view_id } : {}), id: ref.target.id }, field,
    }));
    // 写成文字的位置：本 CU 所选目标里三个机器内容字段中所有写成文字的（同一类缺陷、同一原文依据，一次修完）。
    const proseLocations = (): DesignAuthorityLocation[] => (['acceptance', 'contracts', 'use_cases'] as const)
      .flatMap(field => locate(field, target => typeof target[field] === 'string' && !!(target[field] as string).trim()));
    const merge = (field: string): BlueprintRecord | undefined => {
      const parts = selected.flatMap(({ target }) => target[field] === undefined ? [] : [target[field]]);
      if (!parts.length) return undefined;
      const result: BlueprintRecord = {};
      for (const part of parts) {
        const record = asRecord(part);
        // 写成了一段文字 = 有原文可依、改回机器结构即可；null / 数字 / 空串 / 数组等没有可恢复的内容，是缺内容。
        if (!record) {
          const prose = typeof part === 'string' && !!part.trim();
          fail(prose ? 'authority_content_not_machine_structure' : 'authority_content_missing', `${field} 必须是机器结构；文本需交责任 Skill 澄清`, prose ? proseLocations() : []);
        }
        for (const [key, value] of Object.entries(record)) {
          if (!(key in result)) result[key] = structuredClone(value);
          else if (Array.isArray(result[key]) && Array.isArray(value)) {
            for (const item of value) {
              const rows = result[key] as unknown[];
              if (rows.some(old => canonical(old) === canonical(item))) continue;
              const id = projectionRowIdentity(item);
              if (id && rows.some(old => projectionRowIdentity(old) === id)) fail('authority_content_conflict', `component-design/外部 owner: ${field}.${key} 同一标识内容冲突`);
              rows.push(structuredClone(item));
            }
          } else if (canonical(result[key]) !== canonical(value)) fail('authority_content_conflict', `component-design/外部 owner: ${field}.${key} 存在冲突`);
        }
      }
      return result;
    };
    const source = `derive.blueprint-${kind}:${loaded.artifactSha256}:${cu.component_blueprint_ref.artifact_sha256}`;
    const acceptance = merge('acceptance');
    const construction = kind === 'contracts' ? merge('contracts') : undefined;
    const useCases = merge('use_cases');
    const raw = kind === 'acceptance' ? acceptance : construction;
    if (!raw) return { state: 'absent', dependencies, detail: `${kind === 'acceptance' ? 'spec' : 'plan'}: 缺精确 ${kind} 内容，design_refs/verification_refs 不等价于设计` };
    raw.feature = feature; raw.source = source;
    if (construction) {
      const mappings = asRecord(construction.change_unit);
      if (!mappings) fail('authority_cu_mapping_missing', 'plan: 缺获准 CU 施工/测试 ID 映射，不能从 touches 或 verification_refs 猜造');
      const currentRef = { artifact: cu.artifact, component_id: cu.component_id, blueprint_id: cu.blueprint_id, change_unit_id: cu.change_unit_id, revision: cu.revision, artifact_sha256: loaded.artifactSha256 };
      if (mappings.change_unit_ref && canonical(mappings.change_unit_ref) !== canonical(currentRef)) {
        // 同一个 CU 的旧 revision / 旧字节 = 身份过期，删掉这条可省略的引用即可；指向别的 CU（或形状不对）是归属冲突，要裁决。
        const mapped = asRecord(mappings.change_unit_ref);
        const sameUnit = !!mapped && (['artifact', 'component_id', 'blueprint_id', 'change_unit_id'] as const).every(key => mapped[key] === currentRef[key]);
        fail(sameUnit ? 'authority_cu_mapping_stale' : 'authority_cu_mapping_conflict', 'plan: CU 映射来源 stale',
          sameUnit ? locate('contracts.change_unit.change_unit_ref', target => asRecord(asRecord(target.contracts)?.change_unit)?.change_unit_ref !== undefined) : []);
      }
      mappings.change_unit_ref = currentRef;
      for (const mapping of asRecords(mappings.design_ref_mappings)) {
        const reference = cu.design_refs.find(ref => canonical(ref.target) === canonical(mapping.design_ref));
        if (reference) mapping.design_ref = structuredClone(reference);
      }
    }
    if (useCases) useCases.source = `derive.blueprint-contracts:${loaded.artifactSha256}:${cu.component_blueprint_ref.artifact_sha256}`;
    const artifacts: Record<string, unknown> = { ...(acceptance ? { 'acceptance@1': acceptance } : {}), ...(construction ? { 'contracts@1': construction } : {}), ...(useCases ? { 'use-cases@1': useCases } : {}) };
    const parsed = new SpecLoader(projectRoot, undefined, undefined, frameworkRoot).loadFeatureSpec(feature, { context: { schema_version: '1.1', subject: { feature }, obligations: {}, required_outputs: [] }, phase: 'plan', values: {}, artifacts });
    if (parsed.shape_issues?.length) fail('authority_projection_shape_invalid', parsed.shape_issues.join('; '));
    if (parsed.acceptance) {
      const ctx = { projectRoot, feature, featureSpec: parsed } as CheckContext;
      const content = checkAcceptanceContent(ctx);
      if (content.some(check => check.status === 'FAIL')) fail('authority_acceptance_content_invalid', 'spec: ' + content.map(check => check.details).join('; '));
      const covered = new Set([...parsed.acceptance.criteria, ...(parsed.acceptance.boundaries ?? [])].map(item => item.id.toUpperCase()));
      const unmapped = cu.target_predicates.filter(predicate => !predicate.verification_refs.flatMap(extractAcceptanceIdRefs).some(id => covered.has(id)));
      if (unmapped.length) fail('authority_predicate_acceptance_unmapped', 'spec: CU predicate 缺明确验收 ID 映射：' + unmapped.map(predicate => predicate.predicate_id).join(', '));
      const failures = [...checkAcceptanceUtLayerComplete(ctx, (_c, _s, id) => id), ...checkAcceptanceDeviceFocusPresent(ctx, (_c, _s, id) => id), ...checkAcceptanceLinkedUseCases(ctx), ...evaluateAcceptanceFlowStructure(projectRoot, feature, parsed.acceptance)].filter(check => check.status === 'FAIL');
      if (failures.length) fail('authority_acceptance_content_invalid', 'spec: ' + failures.map(check => check.details).join('; '));
    }
    if (kind === 'contracts') {
      const contracts = parsed.contracts!;
      const contentIssues = checkTypedConstructionContent({ projectRoot, feature, featureSpec: parsed, phaseRule: {} } as CheckContext).filter(check => check.status === 'FAIL');
      if (contentIssues.length) fail('authority_construction_content_incomplete', 'plan: ' + contentIssues.map(check => check.details).join('; '));
      if (!contracts.files?.length) fail('authority_contract_files_missing', 'plan: contracts.files 缺少明确授权文件；touches 不构成授权');
      const closure = resolveContractFileReferences(projectRoot, contracts);
      const violations = findUnauthorizedContractFileReferences(closure);
      if (closure.invalid_paths.length || violations.length) fail('authority_contract_write_set_open', 'plan: contracts.files 写集未闭合：' + [...closure.invalid_paths.map(i => i.message), ...violations.map(i => i.path)].join('; '));
      const projection = validateChangeUnitFeatureProjection(projectRoot, feature, contracts, parsed.acceptance, !!parsed.useCases, 'plan');
      if (projection.issues.length) fail(projection.issues.flatMap(i => i.codes ?? [i.id]), 'plan/component-design: ' + projection.issues.map(i => i.message).join('; '));
    }
    const normalized = { ...(parsed.acceptance ? { 'acceptance@1': parsed.acceptance } : {}), ...(parsed.contracts ? { 'contracts@1': parsed.contracts } : {}), ...(parsed.useCases ? { 'use-cases@1': parsed.useCases } : {}) };
    if (parsed.useCases) {
      const existing = resolveFeatureArtifact(projectRoot, feature, 'use-cases.yaml');
      if (existing.exists) {
        depend(existing.actualPath);
        // 刷新模式由唯一 writer 在覆盖前核对同一文件的来源戳（hasPreBumpStamp），此处不重复判；纯投影读取不拿手写产物校验权威。
        if (!refresh &&canonical(YAML.parse(fs.readFileSync(existing.actualPath, 'utf8'))) !== canonical(parsed.useCases)) fail('authority_use_cases_conflict', 'plan: 既有 use-cases.yaml 与获准投影冲突');
      }
    }
    return { state: 'resolved', dependencies, value: kind === 'acceptance' ? parsed.acceptance : parsed.contracts, artifacts: normalized };
  } catch (error) {
    // 解析器错误（ChangeUnitResolutionError / ComponentBlueprintResolutionError / FeatureIdentityError）自带 code；未编码的抛错留空（分类默认 B2）。
    const thrown = (error as { code?: unknown }).code;
    return { state: 'invalid', dependencies, detail: String(error), reason, codes: codes.length ? codes : typeof thrown === 'string' ? [thrown] : [], ...(locations.length ? { locations } : {}) };
  }
}

export interface AuthoritativeDriftItem { id: string; field: string; expected: unknown; actual: unknown }
export type AuthoritativeContentDrift =
  | { state: 'aligned' }
  | { state: 'not_applicable' }
  | { state: 'drift'; items: AuthoritativeDriftItem[] }
  | { state: 'invalid'; detail: string; reason: DesignAuthorityInvalidReason; codes: string[]; locations?: DesignAuthorityLocation[] };
/**
 * 集合语义字段；其余数组一律有序。contracts 内的列表型文件引用字段名取自统一解析边界登记
 * （`CONTRACT_FILE_REFERENCE_FIELDS` 中 `schemaField` 以 `[]` 结尾者），本地只补边界外的 contracts.files /
 * planned_locations 与 acceptance tags。
 */
const SET_FIELDS = new Set([
  'files', 'planned_locations', 'tags',
  ...CONTRACT_FILE_REFERENCE_FIELDS.filter(field => field.schemaField.endsWith('[]')).map(field => field.kind.slice(field.kind.lastIndexOf('.') + 1)),
]);
/** 顶层身份 / 来源字段不比；`change_unit` 由 `changeUnitMappingIssues` 负责。 */
const UNCOMPARED_TOP_LEVEL = new Set(['feature', 'source', 'version', 'change_unit']);
const rowLabel = (row: unknown): string => { const r = asRecord(row)!; return String(r.id ?? r.name ?? r.class ?? r.data); };

function alignNode(expected: unknown, actual: unknown, id: string, field: string, key: string, items: AuthoritativeDriftItem[]): void {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) { items.push({ id, field, expected, actual }); return; }
    if (SET_FIELDS.has(key)) {
      if (expected.some(item => !actual.some(row => canonical(row) === canonical(item)))) items.push({ id, field, expected, actual });
      return;
    }
    // 有序数组：投影元素按权威顺序以子序列出现在手写侧，其间 / 末尾可插入补充元素。
    let cursor = 0;
    let wholeArray = false;
    for (const item of expected) {
      const identity = projectionRowIdentity(item);
      const matches = (row: unknown): boolean => identity !== undefined ? projectionRowIdentity(row) === identity : canonical(row) === canonical(item);
      const at = actual.findIndex((row, index) => index >= cursor && matches(row));
      const found = at >= 0 ? at : actual.findIndex(matches);
      if (found < 0) {
        if (identity !== undefined) items.push({ id: rowLabel(item), field: '<missing>', expected: item, actual: undefined });
        else if (asRecord(item)) items.push({ id: canonical(item), field: '<missing>', expected: item, actual: undefined });
        else wholeArray = true;
        continue;
      }
      if (at < 0) wholeArray = true;
      else cursor = at + 1;
      if (identity !== undefined) alignNode(item, actual[found], rowLabel(item), '', '', items);
    }
    if (wholeArray) items.push({ id, field, expected, actual });
    return;
  }
  const record = asRecord(expected);
  if (record) {
    const other = asRecord(actual);
    if (!other) { items.push({ id, field, expected, actual }); return; }
    for (const [child, value] of Object.entries(record)) alignNode(value, other[child], id, field ? `${field}.${child}` : child, child, items);
    return;
  }
  if (canonical(expected) !== canonical(actual)) items.push({ id, field, expected, actual });
}

/**
 * plan c4e7a9b2 §3.1 A1 唯一比较：无来源戳的手写产物（`SpecLoader` 规范化值）按稳定 ID 逐字段对齐当前规范化投影，
 * 允许不冲突的补充。带 `derive.blueprint-*` 来源戳的文件走 `resolveArtifact` 的整份比对，不经本函数。
 * `absent`（蓝图不携带机器内容）→ not_applicable；投影自身 invalid → 不跳过，交调用方报 `authority_projection_invalid`。
 * 放弃的准确性：投影删除的旧条目仍留在手写侧按补充放行（无旧投影可比，不建档案）。
 */
export function authoritativeContentDrift(projectRoot: string, feature: string, frameworkRoot: string, kind: BlueprintProjectionKind, handwritten: unknown): AuthoritativeContentDrift {
  const record = asRecord(handwritten);
  if (!record || String(record.source ?? '').startsWith('derive.blueprint-')) return { state: 'not_applicable' };
  const projected = deriveBlueprintSkillInput(projectRoot, feature, frameworkRoot, kind, 'pure');
  if (projected.state === 'absent') return { state: 'not_applicable' };
  if (projected.state === 'invalid') return { state: 'invalid', detail: projected.detail ?? 'blueprint projection invalid', reason: projected.reason ?? 'other', codes: projected.codes ?? [], ...(projected.locations ? { locations: projected.locations } : {}) };
  const items: AuthoritativeDriftItem[] = [];
  for (const [key, value] of Object.entries(asRecord(projected.artifacts?.[`${kind}@1`]) ?? {})) {
    if (!UNCOMPARED_TOP_LEVEL.has(key)) alignNode(value, record[key], key, '', key, items);
  }
  return items.length ? { state: 'drift', items } : { state: 'aligned' };
}

const driftLabel = (item: AuthoritativeDriftItem): string => item.field ? `${item.id}.${item.field}` : item.id;
/** 人读缺口：drift → `手写<验收/设计>与当前设计权威不一致：<id.field …>`；invalid → `authority_projection_invalid：…`；其余 undefined。 */
export function describeAuthoritativeDrift(drift: AuthoritativeContentDrift, kind: BlueprintProjectionKind): string | undefined {
  if (drift.state === 'invalid') return `authority_projection_invalid：${kind === 'acceptance' ? '验收' : '设计'}权威投影不可用（${drift.detail}）`;
  if (drift.state !== 'drift') return undefined;
  return `手写${kind === 'acceptance' ? '验收' : '设计'}与当前设计权威不一致：${drift.items.map(driftLabel).join(', ')}`;
}

/** 责任阶段门（spec → acceptance / plan → contracts）：BLOCKER `authoritative_content_aligned`。不适用时不出行。 */
export function checkAuthoritativeContentAligned(ctx: CheckContext, kind: BlueprintProjectionKind): CheckResult[] {
  const value = kind === 'acceptance' ? ctx.featureSpec.acceptance : ctx.featureSpec.contracts;
  const drift = authoritativeContentDrift(ctx.projectRoot, ctx.feature, ctx.frameworkRoot, kind, value);
  if (drift.state === 'not_applicable') return [];
  const file = `${kind}.yaml`;
  const base = { id: 'authoritative_content_aligned', category: 'traceability' as const, severity: 'BLOCKER' as const, description: `手写 ${file} 与当前设计权威按稳定 ID 逐字段对齐`, affected_files: [featureFilePath(ctx.projectRoot, ctx.feature, file)] };
  if (drift.state === 'aligned') return [{ ...base, status: 'PASS', details: `${file} 与当前规范化投影对齐（补充内容不判）` }];
  // 无效分支责任在链外的设计 owner（plan f7045213 最终评审返修二）：既有字段 repair_owner='external' 让 goal 首次即停交设计 owner；漂移分支不标。
  if (drift.state === 'invalid') return [{ ...base, status: 'FAIL', repair_owner: 'external', structured: { kind: 'design_authority', reason: drift.reason, codes: drift.codes, ...(drift.locations ? { locations: drift.locations } : {}) }, details: describeAuthoritativeDrift(drift, kind)!, suggestion: '设计权威投影自身不可用：回设计 owner 修复蓝图 / CU 后重跑。' }];
  const details = drift.items.map(item => `${driftLabel(item)}: 期望=${JSON.stringify(item.expected)} 实际=${JSON.stringify(item.actual)}`).join('\n');
  return [{ ...base, status: 'FAIL', details, suggestion: `按设计权威改写 ${file}，保留不冲突的补充。` }];
}

/**
 * One writer: prepare and validate the complete bundle before touching any artifact.
 * `refresh`（只由 CU 指针原位升版传入）：既有文件与新投影不同时，仅当其来源戳指向升版前身份才覆盖；
 * 否则一个字节不写。写出中途失败按原字节回滚本次已写文件。
 */
export function materializeBlueprintSkillInputs(projectRoot: string, feature: string, frameworkRoot: string, refresh?: ProjectionRefresh): string[] {
  const acceptance = deriveBlueprintSkillInput(projectRoot, feature, frameworkRoot, 'acceptance', refresh);
  const contracts = deriveBlueprintSkillInput(projectRoot, feature, frameworkRoot, 'contracts', refresh);
  for (const result of [acceptance, contracts]) if (result.state !== 'resolved') throw new Error(result.detail);
  const artifacts = { ...contracts.artifacts, 'acceptance@1': acceptance.value };
  const names = BLUEPRINT_PROJECTION_FILES;
  const writes: Array<{ file: string; text: string; previous?: Buffer }> = [];
  for (const [artifact, value] of Object.entries(artifacts)) {
    const location = resolveFeatureArtifact(projectRoot, feature, names[artifact]);
    if (location.exists) {
      const previous = fs.readFileSync(location.actualPath);
      const existing = YAML.parse(previous.toString('utf8'));
      if (canonical(existing) === canonical(value)) continue;
      if (!refresh) throw new Error(`plan: 既有 ${names[artifact]} 与投影冲突，不覆盖人工决策`);
      if (!hasPreBumpStamp(artifact, existing, refresh)) throw new Error(`plan: 既有 ${names[artifact]} 来源戳不指向升版前身份，不覆盖人工决策`);
      writes.push({ file: location.actualPath, text: YAML.stringify(value), previous });
    } else writes.push({ file: location.canonicalPath, text: YAML.stringify(value) });
  }
  for (const dep of [...acceptance.dependencies, ...contracts.dependencies]) if (fs.existsSync(dep.path) !== dep.exists || (dep.exists && digest(dep.path) !== dep.sha256)) throw new Error('blueprint projection stale; return to design owner');
  const done: typeof writes = [];
  try {
    for (const write of writes) {
      fs.mkdirSync(path.dirname(write.file), { recursive: true });
      if (!write.previous && fs.existsSync(write.file)) throw new Error(`plan: ${write.file} 已存在，不覆盖`);
      // temp → rename：写到一半失败只留临时文件，被覆盖的旧文件保持原字节（与 completion 原件同一写法）。
      const tmp = `${write.file}.tmp-${process.pid}`;
      try {
        fs.writeFileSync(tmp, write.text);
        fs.renameSync(tmp, write.file);
      } catch (error) {
        fs.rmSync(tmp, { force: true });
        throw error;
      }
      done.push(write);
    }
  } catch (error) {
    for (const write of done) if (write.previous) fs.writeFileSync(write.file, write.previous); else fs.rmSync(write.file, { force: true });
    throw error;
  }
  return writes.map(write => write.file);
}

// ---------------------------------------------------------------------------
// plan 9c3d7e1a §5.0：设计 owner 阻断的 B1 / B2 分类——唯一一张表。goal 运行时的停机说明、探针
// design_authority_projectable 与无人值守 B1 接手（§5.5）共用；不解析 detail 文本，只按 issue code 判。
//   B1 = 在既有授权内、依据明确：code 本身就证明有原内容或唯一的替代目标可依，改正不需要新的设计决定。
//   B2 = 需要新的产品选择、扩大范围或缺少事实；混合原因码（形状错误本身不证明可依据既有权威恢复）一律归 B2。
// 未列入的 code 默认 B2。`needs` 是停机说明里"缺什么"的那句话。
// ---------------------------------------------------------------------------
export type DesignRepairClass = 'B1' | 'B2';
type DesignArtifactKind = 'blueprint' | 'change_unit';
const DESIGN_AUTHORITY_CLASS_ROWS: ReadonlyArray<readonly [DesignRepairClass, DesignArtifactKind, string, readonly string[]]> = [
  // ---- B1 ----
  ['B1', 'blueprint', '蓝图里的机器内容被写成了一段文字：按原文含义改回机器结构（不新增决定）', ['authority_content_not_machine_structure']],
  // 不能"改指当前 CU"：发布新 revision 后调和会把 CU 再升一版，引用立即又过期（蓝图字节含 CU 的 sha、CU 字节含蓝图的 sha）。
  ['B1', 'blueprint', '蓝图 contracts.change_unit.change_unit_ref 指向的是本 CU 的旧 revision：删掉这条可省略的引用（投影按当前 canonical CU 填入），其余映射保留', ['authority_cu_mapping_stale']],
  // ---- B2：投影自身的抛错点（取证清单 §1 #6–#12）----
  ['B2', 'blueprint', '蓝图里该处的机器内容为空或不是可恢复的内容（null、数字等）：缺内容，需要设计 owner 给出', ['authority_content_missing']],
  ['B2', 'blueprint', '投影规范化报形状问题（含缺必填路径、路径越界等没有确定替代值的情形）：需要设计 owner 判断怎么补', ['authority_projection_shape_invalid']],
  ['B2', 'blueprint', '蓝图 contracts.change_unit.change_unit_ref 指向另一个 CU：归属冲突，需要有权者裁决', ['authority_cu_mapping_conflict']],
  ['B2', 'blueprint', 'design_ref 目标带验收 / 契约 / 用例却缺权威来源：需要取得权威来源', ['authority_target_provenance_missing']],
  ['B2', 'blueprint', '多个 design_ref 目标的同一内容互相冲突：需要有权者裁决保留哪一份', ['authority_content_conflict', 'authority_use_cases_conflict']],
  ['B2', 'blueprint', '蓝图缺获准的 CU 施工 / 测试 ID 映射：需要设计 owner 给出映射（不能从 touches 猜）', ['authority_cu_mapping_missing']],
  ['B2', 'blueprint', '蓝图验收内容未过内容门或 CU predicate 缺验收映射：需要补全验收定义', ['authority_acceptance_content_invalid', 'authority_predicate_acceptance_unmapped']],
  ['B2', 'blueprint', '蓝图施工契约不完整（类型签名 / 授权写集 / 写集闭合）：需要设计 owner 补写集与契约', ['authority_construction_content_incomplete', 'authority_contract_files_missing', 'authority_contract_write_set_open']],
  // ---- B2：canonical CU 的加载与解析（§1 #1–#2；change-unit-path）----
  ['B2', 'change_unit', 'canonical CU 缺失、无法解析或身份与路径不符：需要恢复或确认 CU 定义', [
    'change_unit_id_reserved', 'change_unit_missing', 'change_unit_yaml_invalid', 'change_unit_root_invalid', 'change_unit_identity_mismatch',
    'change_unit_ref_invalid', 'change_unit_invalid', 'change_unit_feature_binding_conflict', 'change_unit_ref_unresolvable', 'change_unit_feature_identity_invalid']],
  // ---- B2：validateChangeUnit（§1 #3a–#3c；change-unit-validator）----
  ['B2', 'change_unit', 'CU 指针指向旧蓝图 revision：框架已尝试原位升版未完成，原因见说明（竞争退出时不需要改设计内容）', ['change_unit_blueprint_ref_stale']],
  ['B2', 'change_unit', 'CU 的 owner 蓝图不可解析：需要修蓝图或确认 CU 指向', ['change_unit_provenance_owner_unresolvable', 'change_unit_blueprint_ref_invalid']],
  ['B2', 'change_unit', 'canonical CU 未过 schema / 语义门：形状错误本身不证明能依据既有权威恢复，需要设计 owner 判断（契约变化走新 change_unit_id + supersedes）', [
    'change_unit_schema_invalid', 'change_unit_artifact_invalid', 'change_unit_forbidden_authority_field', 'change_unit_path_identity_mismatch',
    'change_unit_blueprint_mismatch', 'change_unit_blueprint_owner_invalid', 'change_unit_blueprint_owner_mismatch', 'change_unit_blueprint_identity_mismatch',
    'change_unit_provenance_context_missing', 'change_unit_provenance_source_unrecognized', 'change_unit_provenance_authority_invalid', 'change_unit_provenance_time_invalid',
    'change_unit_purpose_missing', 'change_unit_provides_missing', 'change_unit_design_refs_missing', 'change_unit_touches_missing', 'change_unit_invariants_missing',
    'change_unit_predicates_missing', 'change_unit_verification_missing', 'change_unit_provide_id_duplicate', 'change_unit_predicate_id_duplicate',
    'change_unit_invariant_id_duplicate', 'change_unit_require_id_duplicate', 'change_unit_blocker_id_duplicate', 'change_unit_touch_blueprint_mismatch',
    'change_unit_touch_not_in_design_refs', 'change_unit_touch_write_refs_missing', 'change_unit_predicate_provide_invalid', 'change_unit_predicate_verification_missing',
    'change_unit_invariant_evidence_missing', 'change_unit_self_dependency', 'change_unit_safe_intermediate_state_invalid', 'change_unit_blocker_self_resolved',
    'change_unit_blocker_probe_missing', 'change_unit_blocker_authority_missing', 'component_closure']],
  // ---- B2：蓝图引用解析（§1 #4；component-blueprint-path）----
  ['B2', 'blueprint', '蓝图缺失、无法解析、身份与引用不符或未过准入：需要修蓝图并重新准入', [
    'blueprint_id_invalid', 'component_id_invalid', 'component_blueprint_ref_invalid', 'component_blueprint_missing', 'component_blueprint_yaml_invalid',
    'component_blueprint_root_invalid', 'component_blueprint_identity_mismatch', 'component_blueprint_invalid']],
  // ---- B2：设计门（§1 #5、§2；change-unit-design-gate）----
  ['B2', 'blueprint', 'CU 的 owner 蓝图或某条 design_ref 在当前蓝图解析不到：缺明确的替代目标，需要设计 owner 给出', ['change_unit_blueprint_unresolvable', 'change_unit_design_ref_unresolvable']],
  ['B2', 'blueprint', 'CU 设计闭包缺稳定地址或 touch 未指向 development 视图节点：需要设计 owner 补设计闭包', ['change_unit_design_closure_incomplete', 'change_unit_touch_development_owner_missing']],
  ['B2', 'blueprint', '设计闭包内有未决决策、blocker 或 unknown：需要有权者裁决', ['change_unit_current_design_unresolved']],
  ['B2', 'blueprint', '闭包里的 contract 缺权威来源：需要取得权威来源', ['change_unit_contract_not_admitted']],
  ['B2', 'blueprint', '施工事实推翻了蓝图：需要回设计 owner 调和蓝图', ['change_unit_blueprint_reconciliation_required']],
  // ---- B2：CU 施工投影的 reconcile 路线（§2；change-unit-feature-projection）----
  ['B2', 'blueprint', '施工范围越出蓝图 touches 派生的可修改模块：扩大范围需要设计 owner 决定', ['cu_scope_matches_blueprint']],
  ['B2', 'blueprint', '相关架构影响未经权威裁决，或与架构 DSL 冲突：需要有权者裁决（DSL 改动走 framework-init 获准路径）', ['cu_architecture_impact_not_effective']],
];
const DESIGN_AUTHORITY_CODE_TABLE = new Map(DESIGN_AUTHORITY_CLASS_ROWS.flatMap(([cls, artifact, needs, codes]) => codes.map(code => [code, { class: cls, artifact, needs }] as const)));
const UNLISTED_DESIGN_CODE = { class: 'B2' as const, artifact: 'blueprint' as const, needs: '原因码未登记在分类表里，按需要有权者判断处理' };

/** 一组原因码的分类：全部是 B1 才算 B1；空集、未登记、任一 B2 → B2。 */
export function classifyDesignAuthorityCodes(codes: readonly string[]): { class: DesignRepairClass; artifacts: DesignArtifactKind[]; needs: string[] } {
  const rows = (codes.length ? codes : ['']).map(code => DESIGN_AUTHORITY_CODE_TABLE.get(code) ?? UNLISTED_DESIGN_CODE);
  return {
    class: codes.length > 0 && rows.every(row => row.class === 'B1') ? 'B1' : 'B2',
    artifacts: [...new Set(rows.map(row => row.artifact))],
    needs: [...new Set(rows.map(row => row.needs))],
  };
}

/** 修复简报的一条：哪条检查、哪个产物、原因码与分类、依据（检查原文）、缺什么。 */
export interface DesignAuthorityFinding {
  check: string;
  codes: string[];
  class: DesignRepairClass;
  /** 要修的设计产物（工程相对路径）。 */
  artifacts: string[];
  basis: string;
  needs: string[];
  /** B1 原因码的位置（投影抛错点经检查的 structured 通道带出）；无人值守修复只许改这些位置。 */
  locations?: DesignAuthorityLocation[];
}

/** 重跑结果：`unevaluable` 非空 = 这道门此刻重评不了（输入解析失败 / 门的对象不在），调用方不得据此认为阻断已消除。 */
export interface DesignAuthorityDiagnosis { findings: DesignAuthorityFinding[]; unevaluable?: string }

/**
 * 只读重跑某阶段的设计权威门（spec → A1 验收；其余阶段 → CU 施工投影，plan 另含 A1 契约），返回其中责任在设计 owner 的阻断
 *（`repair_owner='external'` 且带 `structured.kind='design_authority'`）。停机说明的分类 / 简报与探针共用。
 * 输入走生产检查同一条解析路径（harness-runner：`resolveCapabilityResolutionEntryInput` → `resolveCapabilityInputs` →
 * `SpecLoader.loadFeatureSpec(feature, inputs)`），所以只来自派生输入的施工契约也看得到。只有一处不同：不带 run 冻结的期望绑定
 *——这里问的是"按当前输入这道门还拦不拦"，冻结绑定是否仍有效由 `staleFrozenBindings` 另判。
 */
export function diagnoseDesignAuthority(projectRoot: string, frameworkRoot: string, feature: string, phase: string, runId?: string): DesignAuthorityDiagnosis {
  const cuGate = ['plan', 'change', 'coding', 'review', 'ut'].includes(phase);
  if (phase !== 'spec' && !cuGate) return { findings: [] };
  let featureSpec: CheckContext['featureSpec'];
  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { resolveCapabilityResolutionEntryInput } = require('./capability-resolution-entry-input') as typeof import('./capability-resolution-entry-input');
    const { resolveCapabilityInputs } = require('./capability-resolution') as typeof import('./capability-resolution');
    const { resolveFeatureTrack } = require('./runtime-policy') as typeof import('./runtime-policy');
    const { loadFeatureTrackDecl } = require('./feature-track') as typeof import('./feature-track');
    const { relFeaturesDir } = require('../../config') as typeof import('../../config');
    /* eslint-enable @typescript-eslint/no-require-imports */
    const entry = resolveCapabilityResolutionEntryInput({ frameworkRoot, projectRoot, feature, phase, featuresDir: relFeaturesDir(projectRoot), ...(runId ? { goalRunId: runId } : {}) });
    const { expected_bindings: _frozen, ...inputContext } = entry.inputContext ?? ({} as NonNullable<typeof entry.inputContext>);
    const resolution = resolveCapabilityInputs({
      frameworkRoot, projectRoot, feature, phase, track: resolveFeatureTrack(loadFeatureTrackDecl(projectRoot, feature)),
      ...entry, ...(entry.inputContext ? { inputContext } : {}),
    });
    featureSpec = new SpecLoader(projectRoot, undefined, undefined, frameworkRoot).loadFeatureSpec(feature, resolution.inputs);
  } catch (error) {
    return { findings: [], unevaluable: `${phase} 的输入按生产路径解析失败：${(error as Error).message}` };
  }
  // 门的对象不在（解析不出 acceptance / contracts）时，门会按"不适用"空转——那不是阻断消除了，是重评不了。
  if (phase === 'spec' ? !featureSpec.acceptance : feature.startsWith('cu-') && !featureSpec.contracts) {
    return { findings: [], unevaluable: `${phase} 的 ${phase === 'spec' ? 'acceptance' : 'contracts'} 按当前输入解析不出来，设计权威门无法重评` };
  }
  const ctx = { projectRoot, frameworkRoot, feature, phase, phaseRule: {}, featureSpec } as unknown as CheckContext;
  const checks = phase === 'spec' ? checkAuthoritativeContentAligned(ctx, 'acceptance') : checkChangeUnitFeatureProjection(ctx, phase as 'plan');
  const rel = (file: string): string => path.relative(projectRoot, file).replace(/\\/g, '/');
  const paths = (() => {
    try {
      const identity = parseChangeUnitFeatureId(feature);
      return { blueprint: rel(componentBlueprintPath(projectRoot, identity.blueprintId)), change_unit: rel(changeUnitPath(projectRoot, identity.blueprintId, identity.changeUnitId)) };
    } catch { return { blueprint: '(canonical 蓝图)', change_unit: '(canonical Change Unit)' }; }
  })();
  return { findings: checks.flatMap(check => {
    const structured = asRecord(check.structured);
    if (check.status !== 'FAIL' || check.repair_owner !== 'external' || structured?.kind !== 'design_authority') return [];
    const codes = Array.isArray(structured.codes) ? structured.codes.map(String) : [];
    const verdict = classifyDesignAuthorityCodes(codes);
    const locations = Array.isArray(structured.locations) ? structured.locations as DesignAuthorityLocation[] : undefined;
    return [{ check: check.id, codes, class: verdict.class, artifacts: verdict.artifacts.map(kind => paths[kind]), basis: check.details, needs: verdict.needs, ...(locations ? { locations } : {}) }];
  }) };
}
