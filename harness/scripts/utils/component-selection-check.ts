import * as fs from 'fs';
import * as path from 'path';
import { componentIndexPath, featurePhaseReportsDir, resolveFeatureArtifact, relComponentIndex, relComponentCatalog } from '../../config';
import { CheckContext, CheckResult, ContractsSpec } from './types';
import { blueprintComponentDecisions, blueprintUiComponents, componentDependencyAllowed, isUiComponent, readComponentIndex, readComponentCatalog, resolveAdmittedModules, scanComponentIndex, selectionShapeIssues } from './component-assets';
import { asChangeUnitArtifact, loadCanonicalChangeUnit, parseChangeUnitFeatureId } from './change-unit-path';
import { componentResult } from './component-catalog-check';
import { listFilesAtRef, readFileAtRef, readTraceStartCommit } from './git-diff';
import { resolveHarnessDiffBaseRef } from './phase-state';
import { parseScope } from './scope-parser';
import { resolveComponentBlueprintRef } from './component-blueprint-path';
import { ComponentBlueprintRef, asRecord, asRecords, asStrings, type BlueprintRecord } from './component-blueprint-model';
import { ChangeUnitArtifact, sameBlueprintIdentity, sameBlueprintTarget } from './change-unit-model';
import { resolveBlueprintTarget } from './blueprint-addressing';
import { loadCatalog } from './catalog-parser';
import { validateProjectRelativePath } from './project-relative-path';
import { resolveGoalRunBaseline } from './goal-run-baseline';

function selectionRefMatches(raw: string, component: ContractsSpec['components'][number], components: ContractsSpec['components']): boolean {
  const [file, symbol] = raw.replace(/^planned:/, '').split('#');
  return file === component.file && (symbol ? symbol === component.name : components.filter(c => c.file === file).length === 1);
}

/** Only fill mechanically determined projections; never overwrite a conflicting authored value. */
export function projectComponentSelections(root: string, contracts: ContractsSpec, cu: ChangeUnitArtifact, resolveRef = resolveComponentBlueprintRef): ContractsSpec {
  if (!fs.existsSync(componentIndexPath(root))) return contracts;
  const blueprint = resolveRef(root, cu.component_blueprint_ref).blueprint;
  return projectSelectionFacts(root, contracts, cu, blueprint);
}

function projectSelectionFacts(root: string, contracts: ContractsSpec, cu: ChangeUnitArtifact, blueprint: BlueprintRecord): ContractsSpec {
  const selectionIds = new Set(asRecords(asRecord(blueprint.decisions_and_gaps)?.decisions)
    .filter(decision => decision.kind === 'component_asset_selection').map(decision => String(decision.decision_id)));
  const projected = structuredClone(contracts);
  for (const component of projected.components ?? []) {
    if (!isUiComponent(component) && !component.asset_selection) continue;
    const candidates = blueprintComponentDecisions(blueprint, component as unknown as Record<string, unknown>);
    if (candidates.length !== 1) continue;
    const decision = candidates[0];
    const ref = cu.design_refs.find(ref => ref.target.kind === 'decision' && ref.target.id === decision.decision_id);
    if (!ref || !['answered_with_evidence', 'decided_with_authority'].includes(String(decision.status))) continue;
    const source = blueprintUiComponents(blueprint).find(item => item.file === component.file && item.name === component.name);
    component.asset_selection ??= structuredClone(asRecord(source?.asset_selection) as typeof component.asset_selection) ?? { resolution: decision.asset_resolution as NonNullable<typeof component.asset_selection>['resolution'],
      ...(typeof decision.component_ref === 'string' ? { component_ref: decision.component_ref } : {}),
      ...(typeof decision.rationale === 'string' ? { rationale: decision.rationale } : {}) };
    const section = projected.change_unit;
    if (!section) continue;
    const key = `${component.file}#${component.name}`;
    const mapped = section.design_ref_mappings.some(mapping => mapping.design_ref.target.kind === 'decision' && selectionIds.has(mapping.design_ref.target.id)
      && mapping.implementation_refs.some(raw => selectionRefMatches(raw, component, projected.components)));
    if (mapped) continue;
    const mapping = section.design_ref_mappings.find(mapping => sameBlueprintTarget(mapping.design_ref, ref));
    const implementation = fs.existsSync(path.join(root, component.file)) ? key : `planned:${key}`;
    if (mapping) mapping.implementation_refs.push(implementation);
    else section.design_ref_mappings.push({ design_ref: ref, implementation_refs: [implementation], verification_refs: asStrings(decision.verification_refs) });
  }
  return projected;
}

export interface ComponentProjectionFinding { message: string; route: 'repair_feature_mapping' | 'repair_change_unit' | 'reconcile_blueprint' }
/** The caller keeps the cause/owner instead of flattening every failure into plan work. */
export function componentProjectionFindings(root: string, contracts: ContractsSpec, cu: ChangeUnitArtifact): ComponentProjectionFinding[] {
  if (!fs.existsSync(componentIndexPath(root))) return [];
  let blueprint: BlueprintRecord;
  try {
    blueprint = resolveComponentBlueprintRef(root, cu.component_blueprint_ref).blueprint;
    contracts = projectSelectionFacts(root, contracts, cu, blueprint);
  }
  catch (error) { return [{ message: `蓝图选型权威不可解析：${(error as Error).message}`, route: 'reconcile_blueprint' }]; }
  const errors: string[] = [];
  const findings: ComponentProjectionFinding[] = [];
  const components = contracts.components ?? [];
  const mapped = new Set<ContractsSpec['components'][number]>();
  for (const mapping of contracts.change_unit?.design_ref_mappings ?? []) {
    const ref = mapping.design_ref;
    if (!ref || ref.target?.kind !== 'decision' || !cu.design_refs.some(r => sameBlueprintTarget(r, ref))) continue;
    try {
      if (!sameBlueprintIdentity(ref, cu.component_blueprint_ref)) throw new Error(`${ref.target.id}: 映射身份与 canonical CU 不一致`);
      const decision = asRecord(resolveBlueprintTarget(blueprint, ref.target));
      if (decision?.kind !== 'component_asset_selection') continue;
      if (!['answered_with_evidence', 'decided_with_authority'].includes(String(decision.status))) findings.push({ route: 'reconcile_blueprint', message: `${ref.target.id}: 选型权责未闭合，不能进入 Feature 施工；新边回设计 owner，按当前请求授权正式裁决` });
      let consumers = 0;
      for (const component of components) {
        const matches = asStrings(mapping.implementation_refs).some(raw => selectionRefMatches(raw, component, components));
        if (!matches) continue;
        consumers++;
        if (mapped.has(component)) errors.push(`${component.file}#${component.name}: 多个选型 decision 映射同一组件`);
        mapped.add(component);
        const selection = component.asset_selection;
        // 选型结论来自 decision；组件说明由其上游施工契约负责，不能再要求与总理由逐字相同。
        if (!selection || selection.resolution !== decision.asset_resolution || selection.component_ref !== decision.component_ref) {
          errors.push(`${component.file}#${component.name}: asset_selection 与蓝图 ${ref.target.id} 的选型结论不一致；`
            + `期望 resolution=${decision.asset_resolution}, component_ref=${decision.component_ref ?? '(无)'}；`
            + `实际 resolution=${selection?.resolution ?? '(缺失)'}, component_ref=${selection?.component_ref ?? '(无)'}`);
        }
      }
      if (!consumers) errors.push(`${ref.target.id}: 选型映射未命中 components.file#name`);
    } catch (error) { errors.push((error as Error).message); }
  }
  findings.push(...errors.map(message => ({ message, route: 'repair_feature_mapping' as const })));
  for (const component of components) if ((isUiComponent(component) || component.asset_selection) && !mapped.has(component)) {
    const choices = blueprintComponentDecisions(blueprint, component as unknown as Record<string, unknown>);
    const referenced = choices.length === 1 && cu.design_refs.some(ref => ref.target.kind === 'decision' && ref.target.id === choices[0].decision_id);
    findings.push({ message: `${component.file}#${component.name}: 缺少 canonical CU 的 component_asset_selection decision 映射，不能在 Feature 自行选型`,
      route: choices.length !== 1 ? 'reconcile_blueprint' : referenced ? 'repair_feature_mapping' : 'repair_change_unit' });
  }
  return findings;
}

export function componentProjectionErrors(root: string, contracts: ContractsSpec, cu: ChangeUnitArtifact): string[] {
  return componentProjectionFindings(root, contracts, cu).map(finding => finding.message);
}

export function checkComponentSelections(ctx: CheckContext): CheckResult[] {
  if (!fs.existsSync(componentIndexPath(ctx.projectRoot))) return [];
  try {
    const index = readComponentIndex(ctx.projectRoot)!;
    let contracts = ctx.featureSpec.contracts;
    if (!contracts) return [];
    if (ctx.feature.startsWith('cu-')) {
      const identity = parseChangeUnitFeatureId(ctx.feature);
      try { contracts = projectComponentSelections(ctx.projectRoot, contracts, asChangeUnitArtifact(loadCanonicalChangeUnit(ctx.projectRoot, identity.blueprintId, identity.changeUnitId).changeUnit)); }
      catch (error) { return [{ ...componentResult('component_asset_selection', 'FAIL', `选型权威不可用：${(error as Error).message}`),
        repair_owner: 'external', structured: { kind: 'design_authority', reason: 'other', codes: ['component_asset_selection'] } }]; }
    }
    const result: CheckResult[] = [];
    const fail = (message: string) => result.push(componentResult('component_asset_selection', 'FAIL', message));
    const planFile = resolveFeatureArtifact(ctx.projectRoot, ctx.feature, 'plan.md');
    const scope = planFile.exists ? parseScope(fs.readFileSync(planFile.actualPath, 'utf8')).scope : null;
    let declared: Map<string, string> | undefined;
    const layerDeclarations = (): Map<string, string> => {
      if (declared) return declared;
      if (ctx.feature.startsWith('cu-')) {
        // CU-bound：层级只认 canonical 蓝图获准模块（同 P1 的 resolveAdmittedModules，含已批准 move 的新层）；contracts 手写层级与之不一致即拒。
        const { blueprintId, changeUnitId } = parseChangeUnitFeatureId(ctx.feature);
        const cu = asChangeUnitArtifact(loadCanonicalChangeUnit(ctx.projectRoot, blueprintId, changeUnitId).changeUnit);
        const admitted = resolveAdmittedModules(ctx.projectRoot, resolveComponentBlueprintRef(ctx.projectRoot, cu.component_blueprint_ref).blueprint);
        for (const m of contracts.modules ?? []) {
          const layer = admitted.modules.get(m.name);
          if (layer && layer !== m.layer) fail(`contracts.modules ${m.name} layer=${m.layer} 与蓝图获准层级 ${layer} 不一致；改层只经蓝图 architecture_impact move_module 决策授权`);
        }
        return (declared = admitted.declared);
      }
      // 非 CU-bound：只让 catalog 外的新模块按 contracts.modules 声明 layer 判定；既有模块层级仍以 catalog 为准，不给 plan 改层绕过 DSL 的口子。
      const catalog = loadCatalog(ctx.projectRoot);
      return (declared = new Map((contracts.modules ?? []).filter(m => !(catalog.ok && catalog.catalog.modules.some(c => c.name === m.name)))
        .map(m => [m.name, m.layer] as [string, string])));
    };
    for (const component of contracts.components ?? []) {
      const selection = component.asset_selection;
      if (!selection) { if (isUiComponent(component)) fail(`${component.name}: 已启用 index，页面/UI 组件必须有 asset_selection`); continue; }
      const errors = selectionShapeIssues(selection);
      if (errors.length) { fail(`${component.name}: ${errors.join('；')}`); continue; }
      if (selection.component_ref) {
        const asset = index.components.find(c => c.id === selection.component_ref);
        if (!asset) { fail(`${component.name}: component_ref 不存在：${selection.component_ref}`); continue; }
        if (!componentDependencyAllowed(ctx.projectRoot, component.module, asset.module, layerDeclarations())) fail(`${component.name}: ${component.module} → ${asset.module} 依赖非法；换合法候选 > plan 声明组件下沉 > 交设计 owner 正式裁决新边（无人值守原需求内自动，有人在场保留确认）`);
        // Provider changes are reviewed against the real API and DSL, not a predicted module list.
      }
    }
    if (['coding', 'review'].includes(ctx.phase)) {
      const fresh = scanComponentIndex(ctx.projectRoot);
      const runId = process.env.MAISON_GOAL_RUN_ID;
      const goalBase = runId ? resolveGoalRunBaseline(ctx.projectRoot, ctx.feature, runId) : undefined;
      const explicit = resolveHarnessDiffBaseRef();
      const baseline = goalBase?.available ? goalBase.baseSha : (explicit && explicit !== 'working' ? explicit : readTraceStartCommit(path.join(featurePhaseReportsDir(ctx.projectRoot, ctx.feature, 'coding'), 'trace.json')) ?? 'HEAD');
      const pathKey = (file: string) => process.platform === 'win32' ? file.toLowerCase() : file;
      const baselineFiles = new Map([...listFilesAtRef(ctx.projectRoot, baseline).files].map(file => [pathKey(file), file]));
      const before = new Set(scanComponentIndex(ctx.projectRoot, file => {
        const actualPath = baselineFiles.get(pathKey(file));
        return actualPath ? readFileAtRef(ctx.projectRoot, baseline, actualPath)?.toString('utf8') ?? null : null;
      }).index.components.map(c => c.id));
      const registered = new Set(index.components.map(c => c.id));
      const changedFiles = new Set(contracts.files.map(pathKey));
      for (const asset of fresh.index.components.filter(c => changedFiles.has(pathKey(c.file))
        || changedFiles.has(pathKey(fresh.exportFiles.get(c.module)!)))) {
        if (!registered.has(asset.id)) result.push(componentResult('component_export_registered', 'FAIL', `${asset.id}: 新增/修改共享导出未登记，重跑 index`));
        if (!before.has(asset.id)) {
          const invalid = Object.entries(asset.static_checks).filter(([, value]) => value === 'fail');
          const unknown = Object.entries(asset.static_checks).filter(([, value]) => value === 'unknown');
          if (invalid.length) result.push(componentResult('component_new_static_checks', 'FAIL', `${asset.id}: 共享组件存在已证实的静态缺陷：${invalid.map(([k, v]) => `${k}=${v}`).join(', ')}`));
          if (unknown.length) result.push(componentResult('component_new_static_checks', 'WARN', `${asset.id}: 静态分析未确认 ${unknown.map(([key, value]) => `${key}=${value}`).join('、')}；review 核对真实组件源码，适用交互/视觉由 testing 验证；不代表通过或不适用。`));
        }
      }
      for (const warning of fresh.warnings) result.push(componentResult('component_export_warning', 'WARN', warning));
    }
    const curated = new Set(readComponentCatalog(ctx.projectRoot).components.map(c => c.id));
    for (const component of contracts.components ?? []) {
      const id = component.asset_selection?.component_ref;
      if (id && !curated.has(id)) result.push(componentResult('component_uncurated', 'WARN', `${id}: uncurated；按需增量策展`));
    }
    return result.length ? result : [componentResult('component_asset_selection', 'PASS', '选型与依赖预检通过')];
  } catch (error) { return [componentResult('component_asset_selection', 'FAIL', (error as Error).message)]; }
}

/** 仅供当次 verifier；不把引用数/调用点写回 index。 */
export function componentReviewContext(root: string): Array<{ label: string; content: string }> {
  const index = readComponentIndex(root);
  if (!index) return [];
  const catalog = readComponentCatalog(root);
  const curated = new Map(catalog.components.map(card => [card.id, card]));
  const calls = new Map(index.components.map(c => [c.id, [] as string[]]));
  const sourceFiles = new Set(index.components.map(component => component.file));
  const modules = loadCatalog(root);
  const visit = (rel: string) => {
    const dir = path.join(root, validateProjectRelativePath(root, rel, 'component live usage'));
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || ['node_modules', 'oh_modules', 'build', '.git'].includes(entry.name)) continue;
      const file = `${rel}/${entry.name}`;
      if (entry.isDirectory()) { visit(file); continue; }
      if (!/\.(ets|ts)$/.test(file)) continue;
      const lines = fs.readFileSync(path.join(root, file), 'utf8').split(/\r?\n/);
      // ponytail: 小型索引逐组件检索；每组件只带 3 个 live 样本，读不完时再引入检索器。
      for (const asset of index.components) {
        if (asset.file === file) continue;
        const hits = calls.get(asset.id)!;
        const pattern = new RegExp(`\\b${asset.symbol.replace(/[$]/g, '\\$')}\\s*\\(`);
        for (let i = 0; i < lines.length && hits.length < 3; i++) if (pattern.test(lines[i])) {
          hits.push(`${file}:${i + 1}: ${lines[i].trim()}`);
          sourceFiles.add(file);
        }
      }
    }
  };
  if (modules.ok) for (const module of modules.catalog.modules) visit(`${module.layer}/${module.name}`);
  return [
    { label: '(组件静态未确认)', content: index.components.filter(component => Object.values(component.static_checks).includes('unknown'))
      .map(component => `${component.id}: ${Object.entries(component.static_checks).filter(([, value]) => value === 'unknown').map(([key]) => key).join('、')} 未确认；核真实组件源码，适用交互/视觉交 testing，不能当作 PASS 或不适用。`).join('\n') },
    { label: relComponentIndex(root), content: JSON.stringify({ ...index, components: index.components.map(component => ({ ...component, curation: curated.get(component.id) ?? null })) }) },
    { label: relComponentCatalog(root), content: JSON.stringify(catalog) },
    { label: '(组件候选 live 调用点)', content: '每组件最多 3 个样本，非引用总数\n' + [...calls].map(([id, hits]) => `${id}\n${hits.length ? hits.join('\n') : '未检出调用样本（不代表无调用，别名可能漏采）'} `).join('\n\n') },
    ...[...sourceFiles].sort().map(file => ({ label: file, content: '组件定义 / live 样本原文；按路径打开核对。' })),
  ];
}
