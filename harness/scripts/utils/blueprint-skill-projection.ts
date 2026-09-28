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
import { resolveComponentBlueprintRef } from './component-blueprint-path';
import { parseChangeUnitFeatureId, loadCanonicalChangeUnit, asChangeUnitArtifact } from './change-unit-path';
import { validateChangeUnitDesign } from './change-unit-design-gate';
import { validateChangeUnit } from './change-unit-validator';
import { validateChangeUnitFeatureProjection } from './change-unit-feature-projection';
import { resolveContractFileReferences, findUnauthorizedContractFileReferences, CONTRACT_FILE_REFERENCE_FIELDS } from './contract-reference-closure';
import { checkAcceptanceContent, checkAcceptanceUtLayerComplete, checkAcceptanceDeviceFocusPresent, checkAcceptanceLinkedUseCases, extractAcceptanceIdRefs } from './check-acceptance';
import { isInsideProjectRoot } from './project-relative-path';
import { evaluateAcceptanceFlowStructure } from './p0-semantic-gates';
import { SpecLoader } from './spec-loader';
import { checkUseCaseSpecSchema } from '../check-ut';
import type { AcceptanceSpec, CheckContext, CheckResult, ContractsSpec } from './types';
import type { ResolutionDependency } from './capability-resolution';

export type BlueprintProjectionKind = 'acceptance' | 'contracts';
export interface BlueprintSkillProjection {
  state: 'resolved' | 'absent' | 'invalid';
  dependencies: ResolutionDependency[];
  detail?: string;
  value?: AcceptanceSpec | ContractsSpec;
  artifacts?: Record<string, unknown>;
}

/** Publish new design facts through P2's existing report field, never mutate the born scope. */
export function designScopeRevisionChecks(ctx: CheckContext, checks: CheckResult[]): CheckResult[] {
  const subject = ctx.factsContext?.subject;
  // D1 §6.4：无 run 不再直接放弃修订提议——feature 载体也要能发布新设计事实。
  // 身份位按载体二分：run 载体取 `run_id`，feature 载体（`{ feature }`）走统一入口的 feature 分支。
  if (!subject || !('feature' in subject) || !ctx.resolvedInputs || checks.some(check => check.status === 'FAIL')) return [];
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
  try {
    const identity = parseChangeUnitFeatureId(feature);
    const loaded = loadCanonicalChangeUnit(projectRoot, identity.blueprintId, identity.changeUnitId);
    depend(loaded.canonicalPath);
    const cu = asChangeUnitArtifact(loaded.changeUnit);
    const cuIssues = validateChangeUnit(loaded.changeUnit, { projectRoot, canonicalPath: loaded.canonicalPath }).filter(issue => issue.severity === 'BLOCKER');
    if (cuIssues.length) throw new Error('component-design: ' + cuIssues.map(issue => issue.message).join('; '));
    const parent = resolveComponentBlueprintRef(projectRoot, cu.component_blueprint_ref);
    depend(parent.canonicalPath);
    const collectSources = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) {
        if (key === 'source_ref' && typeof child === 'string') {
          const file = path.resolve(projectRoot, child.split('#')[0]);
          if (isInsideProjectRoot(projectRoot, file) && fs.existsSync(file) && fs.statSync(file).isFile()) depend(file);
        } else collectSources(child);
      }
    };
    collectSources(parent.blueprint);
    const design = validateChangeUnitDesign(projectRoot, loaded.changeUnit);
    if (design.verdict !== 'constructable') throw new Error(`component-design: ${design.issues.map(i => i.message).join('; ')}`);
    const selected = cu.design_refs.map(ref => {
      const resolved = resolveComponentBlueprintRef(projectRoot, ref); depend(resolved.canonicalPath);
      const target = asRecord(resolved.target);
      if (!target || ((target[kind] !== undefined || target.use_cases !== undefined) && asRecord(target.provenance)?.evidence_strength !== 'authoritative')) throw new Error(`component-design: ${ref.target.id} 缺获准来源`);
      const content = structuredClone(target);
      if (ref.target.kind === 'flow') for (const state of asRecords(asRecord(content.contracts)?.state_management)) {
        if (state.design_ref === undefined) state.design_ref = ref;
      }
      return { ref, target: content };
    });
    const merge = (field: string): BlueprintRecord | undefined => {
      const parts = selected.flatMap(({ target }) => target[field] === undefined ? [] : [target[field]]);
      if (!parts.length) return undefined;
      const result: BlueprintRecord = {};
      for (const part of parts) {
        const record = asRecord(part);
        if (!record) throw new Error(`${field} 必须是机器结构；文本需交责任 Skill 澄清`);
        for (const [key, value] of Object.entries(record)) {
          if (!(key in result)) result[key] = structuredClone(value);
          else if (Array.isArray(result[key]) && Array.isArray(value)) {
            for (const item of value) {
              const rows = result[key] as unknown[];
              if (rows.some(old => canonical(old) === canonical(item))) continue;
              const id = projectionRowIdentity(item);
              if (id && rows.some(old => projectionRowIdentity(old) === id)) throw new Error(`component-design/外部 owner: ${field}.${key} 同一标识内容冲突`);
              rows.push(structuredClone(item));
            }
          } else if (canonical(result[key]) !== canonical(value)) throw new Error(`component-design/外部 owner: ${field}.${key} 存在冲突`);
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
      if (!mappings) throw new Error('plan: 缺获准 CU 施工/测试 ID 映射，不能从 touches 或 verification_refs 猜造');
      const currentRef = { artifact: cu.artifact, component_id: cu.component_id, blueprint_id: cu.blueprint_id, change_unit_id: cu.change_unit_id, revision: cu.revision, artifact_sha256: loaded.artifactSha256 };
      if (mappings.change_unit_ref && canonical(mappings.change_unit_ref) !== canonical(currentRef)) throw new Error('plan: CU 映射来源 stale');
      mappings.change_unit_ref = currentRef;
      for (const mapping of asRecords(mappings.design_ref_mappings)) {
        const reference = cu.design_refs.find(ref => canonical(ref.target) === canonical(mapping.design_ref));
        if (reference) mapping.design_ref = structuredClone(reference);
      }
    }
    if (useCases) useCases.source = `derive.blueprint-contracts:${loaded.artifactSha256}:${cu.component_blueprint_ref.artifact_sha256}`;
    const artifacts: Record<string, unknown> = { ...(acceptance ? { 'acceptance@1': acceptance } : {}), ...(construction ? { 'contracts@1': construction } : {}), ...(useCases ? { 'use-cases@1': useCases } : {}) };
    const parsed = new SpecLoader(projectRoot, undefined, undefined, frameworkRoot).loadFeatureSpec(feature, { context: { schema_version: '1.1', subject: { feature }, obligations: {}, required_outputs: [] }, phase: 'plan', values: {}, artifacts });
    if (parsed.shape_issues?.length) throw new Error(parsed.shape_issues.join('; '));
    if (parsed.acceptance) {
      const ctx = { projectRoot, feature, featureSpec: parsed } as CheckContext;
      const content = checkAcceptanceContent(ctx);
      if (content.some(check => check.status === 'FAIL')) throw new Error('spec: ' + content.map(check => check.details).join('; '));
      const covered = new Set([...parsed.acceptance.criteria, ...(parsed.acceptance.boundaries ?? [])].map(item => item.id.toUpperCase()));
      const unmapped = cu.target_predicates.filter(predicate => !predicate.verification_refs.flatMap(extractAcceptanceIdRefs).some(id => covered.has(id)));
      if (unmapped.length) throw new Error('spec: CU predicate 缺明确验收 ID 映射：' + unmapped.map(predicate => predicate.predicate_id).join(', '));
      const failures = [...checkAcceptanceUtLayerComplete(ctx, (_c, _s, id) => id), ...checkAcceptanceDeviceFocusPresent(ctx, (_c, _s, id) => id), ...checkAcceptanceLinkedUseCases(ctx), ...evaluateAcceptanceFlowStructure(projectRoot, feature, parsed.acceptance)].filter(check => check.status === 'FAIL');
      if (failures.length) throw new Error('spec: ' + failures.map(check => check.details).join('; '));
    }
    if (kind === 'contracts') {
      const contracts = parsed.contracts!;
      const contentIssues = checkTypedConstructionContent({ projectRoot, feature, featureSpec: parsed, phaseRule: {} } as CheckContext).filter(check => check.status === 'FAIL');
      if (contentIssues.length) throw new Error('plan: ' + contentIssues.map(check => check.details).join('; '));
      if (!contracts.files?.length) throw new Error('plan: contracts.files 缺少明确授权文件；touches 不构成授权');
      const closure = resolveContractFileReferences(projectRoot, contracts);
      const violations = findUnauthorizedContractFileReferences(closure);
      if (closure.invalid_paths.length || violations.length) throw new Error('plan: contracts.files 写集未闭合：' + [...closure.invalid_paths.map(i => i.message), ...violations.map(i => i.path)].join('; '));
      const projection = validateChangeUnitFeatureProjection(projectRoot, feature, contracts, parsed.acceptance, !!parsed.useCases, 'plan');
      if (projection.issues.length) throw new Error('plan/component-design: ' + projection.issues.map(i => i.message).join('; '));
    }
    const normalized = { ...(parsed.acceptance ? { 'acceptance@1': parsed.acceptance } : {}), ...(parsed.contracts ? { 'contracts@1': parsed.contracts } : {}), ...(parsed.useCases ? { 'use-cases@1': parsed.useCases } : {}) };
    if (parsed.useCases) {
      const existing = resolveFeatureArtifact(projectRoot, feature, 'use-cases.yaml');
      if (existing.exists) {
        depend(existing.actualPath);
        // 刷新模式由唯一 writer 在覆盖前核对同一文件的来源戳（hasPreBumpStamp），此处不重复判；纯投影读取不拿手写产物校验权威。
        if (!refresh &&canonical(YAML.parse(fs.readFileSync(existing.actualPath, 'utf8'))) !== canonical(parsed.useCases)) throw new Error('plan: 既有 use-cases.yaml 与获准投影冲突');
      }
    }
    return { state: 'resolved', dependencies, value: kind === 'acceptance' ? parsed.acceptance : parsed.contracts, artifacts: normalized };
  } catch (error) { return { state: 'invalid', dependencies, detail: String(error) }; }
}

export interface AuthoritativeDriftItem { id: string; field: string; expected: unknown; actual: unknown }
export type AuthoritativeContentDrift =
  | { state: 'aligned' }
  | { state: 'not_applicable' }
  | { state: 'drift'; items: AuthoritativeDriftItem[] }
  | { state: 'invalid'; detail: string };
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
  if (projected.state === 'invalid') return { state: 'invalid', detail: projected.detail ?? 'blueprint projection invalid' };
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
  if (drift.state === 'invalid') return [{ ...base, status: 'FAIL', details: describeAuthoritativeDrift(drift, kind)!, suggestion: '设计权威投影自身不可用：回设计 owner 修复蓝图 / CU 后重跑。' }];
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
