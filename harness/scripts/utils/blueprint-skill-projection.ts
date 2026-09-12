import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as YAML from 'yaml';
import { resolveFeatureArtifact, loadFrameworkConfig } from '../../config';
import { loadWorkflowSpec } from '../../workflow-loader';
import { loadFrozenExecutionScope } from './goal-run-creation';
import { resolveExecutionScope, type ExecutionScopeInput } from './execution-scope';
import { asRecord, asRecords, type BlueprintRecord } from './component-blueprint-model';
import { resolveComponentBlueprintRef } from './component-blueprint-path';
import { parseChangeUnitFeatureId, loadCanonicalChangeUnit, asChangeUnitArtifact } from './change-unit-path';
import { validateChangeUnitDesign } from './change-unit-design-gate';
import { validateChangeUnit } from './change-unit-validator';
import { validateChangeUnitFeatureProjection } from './change-unit-feature-projection';
import { resolveContractFileReferences, findUnauthorizedContractFileReferences } from './contract-reference-closure';
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
  if (!subject || !('run_id' in subject) || !subject.run_id || !ctx.resolvedInputs || checks.some(check => check.status === 'FAIL')) return [];
  const scope = loadFrozenExecutionScope(ctx.projectRoot, ctx.feature, subject.run_id);
  if (!scope || scope.completion_target !== 'feature') return [];
  const kind = ctx.phase === 'spec' ? 'acceptance-context' : 'design-context';
  const inputId = ctx.phase === 'spec' ? 'acceptance' : 'contracts';
  const resolved = ctx.resolvedInputs.values[inputId];
  if (resolved?.state !== 'resolved') return [];
  if (scope.obligations.some(obligation => obligation.kind === kind && obligation.basis.some(binding => canonical(binding) === canonical(resolved.binding)))) return [];
  const remaining = [...new Set(scope.obligations.filter(obligation => obligation.applicability === 'required' && !obligation.satisfied_by?.length && obligation.owner_phase !== ctx.phase).map(obligation => obligation.owner_phase))];
  if (!remaining.length) return [];
  const facts = scope.obligations.filter(obligation => ctx.phase !== 'spec' || obligation.applicability !== 'unknown' || !['unit-evidence:pending', 'device-evidence:pending', 'unit-evidence:acceptance', 'device-evidence:acceptance'].includes(obligation.id)).map(obligation => {
    if (obligation.kind !== kind) return structuredClone(obligation);
    const basis = obligation.basis.filter(binding => !(binding.source.kind === 'artifact' && binding.source.artifact === `${inputId}@1`));
    return { ...obligation, applicability: 'required' as const, reason: `${ctx.phase} produced validated design content`, basis: [...basis, resolved.binding], satisfied_by: [resolved.binding] };
  });
  if (!facts.some(fact => fact.kind === kind)) facts.push({ id: `${kind}:design-output`, kind, owner_phase: ctx.phase, applicability: 'required', reason: `${ctx.phase} produced validated design content`, basis: [resolved.binding], satisfied_by: [resolved.binding] });
  const proposal: ExecutionScopeInput = { request: { completion_target: scope.completion_target, requested_results: scope.requested_results, requested_phases: remaining }, facts, contract_fingerprints: [], control_edges: scope.control_edges };
  const acceptance = ctx.phase === 'spec' && ctx.featureSpec.acceptance ? { value: ctx.featureSpec.acceptance, binding: resolved.binding } : undefined;
  const workflow = loadWorkflowSpec(ctx.frameworkRoot, loadFrameworkConfig(ctx.projectRoot).active_workflow ?? 'spec-driven');
  const next = resolveExecutionScope(proposal, workflow, acceptance);
  if (scope.obligations.some(old => old.applicability === 'required' && !next.obligations.some(fact => fact.id === old.id && fact.applicability === 'required'))) {
    return [{ id: 'design_scope_facts', category: 'structure', severity: 'BLOCKER', status: 'FAIL', description: '设计修订不得静默删除冻结义务', details: '新验收与既有 required 义务冲突；返回 scope owner 澄清，不缩减本 run 责任', suggestion: '回到 scope owner 澄清验收变化，保留已冻结义务；正式需求变化沿既有 correction/successor 处理。' }];
  }
  if (!next.phase_chain.length) return [];
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

/** Copy only explicit machine content selected by the canonical CU; never infer from refs/touches. */
export function deriveBlueprintSkillInput(projectRoot: string, feature: string, frameworkRoot: string, kind: BlueprintProjectionKind): BlueprintSkillProjection {
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
              const identity = (row: unknown): string | undefined => {
                const record = asRecord(row);
                const id = record?.id ?? record?.name ?? record?.class ?? record?.data;
                return id === undefined ? undefined : canonical([record?.module, record?.file, record?.holder, id]);
              };
              const id = identity(item);
              if (id && rows.some(old => identity(old) === id)) throw new Error(`component-design/外部 owner: ${field}.${key} 同一标识内容冲突`);
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
        if (canonical(YAML.parse(fs.readFileSync(existing.actualPath, 'utf8'))) !== canonical(parsed.useCases)) throw new Error('plan: 既有 use-cases.yaml 与获准投影冲突');
      }
    }
    return { state: 'resolved', dependencies, value: kind === 'acceptance' ? parsed.acceptance : parsed.contracts, artifacts: normalized };
  } catch (error) { return { state: 'invalid', dependencies, detail: String(error) }; }
}

/** One writer: prepare and validate the complete bundle before touching any artifact. */
export function materializeBlueprintSkillInputs(projectRoot: string, feature: string, frameworkRoot: string): string[] {
  const acceptance = deriveBlueprintSkillInput(projectRoot, feature, frameworkRoot, 'acceptance');
  const contracts = deriveBlueprintSkillInput(projectRoot, feature, frameworkRoot, 'contracts');
  for (const result of [acceptance, contracts]) if (result.state !== 'resolved') throw new Error(result.detail);
  const artifacts = { ...contracts.artifacts, 'acceptance@1': acceptance.value };
  const names: Record<string, string> = { 'acceptance@1': 'acceptance.yaml', 'contracts@1': 'contracts.yaml', 'use-cases@1': 'use-cases.yaml' };
  const writes: Array<{ file: string; text: string }> = [];
  for (const [artifact, value] of Object.entries(artifacts)) {
    const location = resolveFeatureArtifact(projectRoot, feature, names[artifact]);
    if (location.exists) {
      const existing = YAML.parse(fs.readFileSync(location.actualPath, 'utf8'));
      if (canonical(existing) !== canonical(value)) throw new Error(`plan: 既有 ${names[artifact]} 与投影冲突，不覆盖人工决策`);
    } else writes.push({ file: location.canonicalPath, text: YAML.stringify(value) });
  }
  for (const dep of [...acceptance.dependencies, ...contracts.dependencies]) if (fs.existsSync(dep.path) !== dep.exists || (dep.exists && digest(dep.path) !== dep.sha256)) throw new Error('blueprint projection stale; return to design owner');
  for (const { file, text } of writes) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text, { flag: 'wx' }); }
  return writes.map(write => write.file);
}
