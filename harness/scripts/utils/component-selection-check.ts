import * as fs from 'fs';
import * as path from 'path';
import { componentIndexPath, featurePhaseReportsDir, resolveFeatureArtifact, relComponentIndex, relComponentCatalog } from '../../config';
import { CheckContext, CheckResult, ContractsSpec } from './types';
import { blueprintComponentDecisions, blueprintTargetComponents, blueprintUiComponents, componentLocation, componentDependencyAllowed, isUiComponent, readComponentIndex, readComponentCatalog, resolveAdmittedModules, scanComponentIndex, selectionShapeIssues } from './component-assets';
import { asChangeUnitArtifact, loadCanonicalChangeUnit, parseChangeUnitFeatureId } from './change-unit-path';
import { componentResult } from './component-catalog-check';
import { listFilesAtRef, readFileAtRef, readTraceStartCommit } from './git-diff';
import { resolveHarnessDiffBaseRef } from './phase-state';
import { parseScope } from './scope-parser';
import { resolveComponentBlueprintRef } from './component-blueprint-path';
import { ComponentBlueprintRef, asRecord, asStrings, type BlueprintRecord } from './component-blueprint-model';
import { ChangeUnitArtifact, sameBlueprintIdentity, sameBlueprintTarget } from './change-unit-model';
import { stableAddressIndex } from './blueprint-addressing';
import { loadCatalog } from './catalog-parser';
import { validateProjectRelativePath } from './project-relative-path';
import { resolveGoalRunBaseline } from './goal-run-baseline';

type ContractComponent = ContractsSpec['components'][number];

function selectionLanding(raw: string): { file: string; symbol?: string } {
  const landing = raw.replace(/^planned:/, '');
  const hash = landing.indexOf('#');
  return hash < 0 ? { file: landing } : { file: landing.slice(0, hash), symbol: landing.slice(hash + 1) };
}

export interface ComponentProjectionFinding {
  message: string;
  route: 'repair_feature_mapping' | 'repair_change_unit' | 'reconcile_blueprint';
  decision?: ComponentBlueprintRef['target'];
  targetAddress?: string;
}

/** Project and check each explicitly selected decision against its own target. */
export function resolveComponentSelectionProjection(root: string, contracts: ContractsSpec, cu: ChangeUnitArtifact,
  resolveRef = resolveComponentBlueprintRef, legacyComponents = contracts.components ?? []): { contracts: ContractsSpec; findings: ComponentProjectionFinding[] } {
  const findings: ComponentProjectionFinding[] = [];
  if (!fs.existsSync(componentIndexPath(root))) return { contracts, findings };
  let blueprint: BlueprintRecord;
  let targets: Map<string, BlueprintRecord>;
  try {
    blueprint = resolveRef(root, cu.component_blueprint_ref).blueprint;
    targets = stableAddressIndex(blueprint);
  } catch (error) {
    return { contracts, findings: [{ message: `蓝图选型权威不可解析：${(error as Error).message}`, route: 'reconcile_blueprint' }] };
  }
  const projected = structuredClone(contracts);
  const components = projected.components ?? [];
  const decisions = cu.design_refs.flatMap(ref => {
    if (ref.target.kind !== 'decision') return [];
    const decision = targets.get(`decision:${ref.target.id}`);
    if (decision?.kind !== 'component_asset_selection') return [];
    const targetAddress = String(decision.target_ref);
    const report = (route: ComponentProjectionFinding['route'], message: string) => {
      findings.push({ route, message: `${ref.target.id} → ${targetAddress}: ${message}`, decision: ref.target, targetAddress });
    };
    const target = targets.get(targetAddress);
    if (!target || !['answered_with_evidence', 'decided_with_authority'].includes(String(decision.status))) {
      report('reconcile_blueprint', '选型目标或权责未闭合，请设计作者核对 target_ref 和决定状态');
      return [];
    }
    const before = findings.length;
    const declared = blueprintTargetComponents(root, blueprint, target, message => report('reconcile_blueprint', message));
    const targetFiles = asStrings(asRecord(target.contracts)?.files);
    // A legacy plan may supply the symbol only for the blueprint's own verified file, matching module and unique row. New candidates supply no legacy rows.
    if (!declared.length && findings.length === before) {
      const evidenceFiles = asStrings(target.verification_refs).filter(file => targetFiles.includes(file));
      const previous = legacyComponents.filter(component => evidenceFiles.includes(component.file) && componentLocation(component)
        && (isUiComponent(component) || component.asset_selection));
      if (previous.length === 1 && previous[0].module === target.module) declared.push(previous[0] as unknown as BlueprintRecord);
    }
    if (!declared.length) report('reconcile_blueprint', '缺少可消费的 contracts.components.file/name 声明；请设计作者补齐目标符号');
    const declarationComplete = findings.length === before;
    const expected = new Map<string, ContractComponent>();
    for (const row of declared) {
      const key = componentLocation(row)!;
      const matches = components.filter(component => componentLocation(component) === key || (!componentLocation(component)
        && (component.file === undefined || component.file === row.file) && (component.name === undefined || component.name === row.name)));
      if (matches.length > 1 || matches.some(component => !componentLocation(component) && declared.filter(item =>
        (component.file === undefined || component.file === item.file) && (component.name === undefined || component.name === item.name)).length > 1)) {
        report('reconcile_blueprint', `${key}: contracts.components 声明有歧义`);
        continue;
      }
      const component = matches[0] ?? {} as ContractComponent;
      if (!matches.length) components.push(component);
      for (const [field, value] of Object.entries(row)) {
        if (field === 'asset_selection') continue;
        const output = component as unknown as BlueprintRecord;
        output[field] ??= structuredClone(value);
      }
      expected.set(key, component);
      const source = asRecord(row.asset_selection);
      const selection = component.asset_selection;
      const conflicts = (copy: BlueprintRecord | undefined) => copy && (copy.resolution !== undefined && copy.resolution !== decision.asset_resolution
        || copy.component_ref !== undefined && copy.component_ref !== decision.component_ref);
      if (conflicts(source)) report('reconcile_blueprint', `${key}: 蓝图 contracts.components.asset_selection 与选型结论不一致`);
      if (conflicts(selection as unknown as BlueprintRecord | undefined) && !conflicts(source)) {
        report('repair_feature_mapping', `${key}: asset_selection 与蓝图选型结论不一致（期望 resolution=${decision.asset_resolution}, component_ref=${decision.component_ref ?? '(无)'}）`);
      }
      component.asset_selection = { resolution: decision.asset_resolution as NonNullable<ContractComponent['asset_selection']>['resolution'],
        ...(typeof decision.component_ref === 'string' ? { component_ref: decision.component_ref } : {}),
        ...(typeof decision.rationale === 'string' ? { rationale: decision.rationale } : {}), ...source, ...selection };
    }
    return [{ ref, decision, targetFiles, declarationComplete, expected, report }];
  });
  if (components.length) projected.components = components;
  const knownFiles = new Map<string, Set<string>>();
  for (const component of [...components, ...blueprintUiComponents(blueprint)]) {
    const key = componentLocation(component);
    if (typeof component.file !== 'string' || !key) continue;
    const known = knownFiles.get(component.file) ?? new Set<string>();
    known.add(key);
    knownFiles.set(component.file, known);
  }
  const section = projected.change_unit;
  const declaredOwners = new Map<string, string>();
  for (const { ref, decision, targetFiles, declarationComplete, expected, report } of decisions) {
    for (const key of expected.keys()) {
      const previous = declaredOwners.get(key);
      if (previous) report('reconcile_blueprint', `${key}: 与 decision:${previous} 重复选型`);
      else declaredOwners.set(key, ref.target.id);
    }
    if (!declarationComplete || !section || !expected.size) continue;
    const mapping = section.design_ref_mappings.find(row => row.design_ref && sameBlueprintTarget(row.design_ref, ref));
    if (!mapping) {
      section.design_ref_mappings.push({ design_ref: ref,
        implementation_refs: [...expected].map(([key, component]) => fs.existsSync(path.join(root, component.file)) ? key : `planned:${key}`),
        verification_refs: asStrings(decision.verification_refs) });
      continue;
    }
    if (!sameBlueprintIdentity(mapping.design_ref, cu.component_blueprint_ref)) {
      report('repair_feature_mapping', '映射身份与 canonical CU 不一致');
      continue;
    }
    const covered = new Set<string>();
    for (const raw of asStrings(mapping.implementation_refs)) {
      const { file, symbol } = selectionLanding(raw);
      const entries = knownFiles.get(file);
      const matched = symbol !== undefined ? `${file}#${symbol}` : entries?.size === 1 ? [...entries][0] : undefined;
      if (matched && expected.has(matched)) covered.add(matched);
      else if (entries?.size || !targetFiles.includes(file)) report('repair_feature_mapping',
        `选型映射 ${raw} 未命中 components.file#name；此目标允许 ${[...expected.keys()].join('、')}`);
    }
    for (const key of expected.keys()) if (!covered.has(key)) report('repair_feature_mapping', `选型映射未覆盖 ${key}`);
  }
  for (const component of components) {
    const key = componentLocation(component);
    if (!key || !isUiComponent(component) && !component.asset_selection || declaredOwners.has(key)) continue;
    const choices = blueprintComponentDecisions(blueprint, component as unknown as BlueprintRecord);
    findings.push({ message: `${key}: 缺少 canonical CU 的 component_asset_selection decision 映射`,
      route: choices.length === 1 ? 'repair_change_unit' : 'reconcile_blueprint' });
  }
  return { contracts: projected, findings };
}

export function projectComponentSelections(root: string, contracts: ContractsSpec, cu: ChangeUnitArtifact, resolveRef = resolveComponentBlueprintRef): ContractsSpec {
  return resolveComponentSelectionProjection(root, contracts, cu, resolveRef).contracts;
}

export function componentProjectionErrors(root: string, contracts: ContractsSpec, cu: ChangeUnitArtifact): string[] {
  return resolveComponentSelectionProjection(root, contracts, cu).findings.map(finding => finding.message);
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
