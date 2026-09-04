import * as fs from 'fs';
import * as path from 'path';
import { componentIndexPath, featurePhaseReportsDir, resolveFeatureArtifact, relComponentIndex, relComponentCatalog } from '../../config';
import { CheckContext, CheckResult, ContractsSpec } from './types';
import { componentDependencyAllowed, isUiComponent, readComponentIndex, readComponentCatalog, scanComponentIndex, selectionShapeIssues } from './component-assets';
import { componentResult } from './component-catalog-check';
import { listFilesAtRef, readFileAtRef, readTraceStartCommit } from './git-diff';
import { resolveHarnessDiffBaseRef } from './phase-state';
import { parseScope } from './scope-parser';
import { resolveComponentBlueprintRef } from './component-blueprint-path';
import { ComponentBlueprintRef, asRecord, asStrings } from './component-blueprint-model';
import { ChangeUnitArtifact, sameBlueprintTarget } from './change-unit-model';
import { loadCatalog } from './catalog-parser';
import { validateProjectRelativePath } from './project-relative-path';
import { resolveGoalRunBaseline } from './goal-run-baseline';

/** 在既有 CU 投影校验中使用其已解析的 canonical CU，不再加载第二份 CU。 */
export function componentProjectionErrors(root: string, contracts: ContractsSpec, cu: ChangeUnitArtifact): string[] {
  if (!fs.existsSync(componentIndexPath(root))) return [];
  const errors: string[] = [];
  const components = contracts.components ?? [];
  const mapped = new Set<ContractsSpec['components'][number]>();
  for (const mapping of contracts.change_unit?.design_ref_mappings ?? []) {
    const ref = mapping.design_ref;
    if (!ref || ref.target?.kind !== 'decision' || !cu.design_refs.some(r => sameBlueprintTarget(r, ref))) continue;
    try {
      const decision = asRecord(resolveComponentBlueprintRef(root, ref as ComponentBlueprintRef).target);
      if (decision?.kind !== 'component_asset_selection') continue;
      if (!['answered_with_evidence', 'decided_with_authority'].includes(String(decision.status))) errors.push(`${ref.target.id}: 选型权责未闭合，不能进入 Feature 施工；新边请求 await-confirm`);
      let consumers = 0;
      for (const component of components) {
        const matches = asStrings(mapping.implementation_refs).some(raw => {
          const [file, symbol] = raw.replace(/^planned:/, '').split('#');
          return file === component.file && (symbol ? symbol === component.name : components.filter(c => c.file === file).length === 1);
        });
        if (!matches) continue;
        consumers++;
        if (mapped.has(component)) errors.push(`${component.file}#${component.name}: 多个选型 decision 映射同一组件`);
        mapped.add(component);
        const selection = component.asset_selection;
        if (!selection || selection.resolution !== decision.asset_resolution || selection.component_ref !== decision.component_ref || selection.rationale !== decision.rationale) errors.push(`${component.name}: asset_selection 与蓝图 ${ref.target.id} 不一致`);
      }
      if (!consumers) errors.push(`${ref.target.id}: 选型映射未命中 components.file#name`);
    } catch (error) { errors.push((error as Error).message); }
  }
  for (const component of components) if ((isUiComponent(component) || component.asset_selection) && !mapped.has(component)) errors.push(`${component.file}#${component.name}: 缺少 canonical CU 的 component_asset_selection decision 映射，不能在 Feature 自行选型`);
  return errors;
}

export function checkComponentSelections(ctx: CheckContext): CheckResult[] {
  if (!fs.existsSync(componentIndexPath(ctx.projectRoot))) return [];
  try {
    const index = readComponentIndex(ctx.projectRoot)!;
    const contracts = ctx.featureSpec.contracts;
    if (!contracts) return [];
    const result: CheckResult[] = [];
    const fail = (message: string) => result.push(componentResult('component_asset_selection', 'FAIL', message));
    const planFile = resolveFeatureArtifact(ctx.projectRoot, ctx.feature, 'plan.md');
    const scope = planFile.exists ? parseScope(fs.readFileSync(planFile.actualPath, 'utf8')).scope : null;
    for (const component of contracts.components ?? []) {
      const selection = component.asset_selection;
      if (!selection) { if (isUiComponent(component)) fail(`${component.name}: 已启用 index，页面/UI 组件必须有 asset_selection`); continue; }
      const errors = selectionShapeIssues(selection);
      if (errors.length) { fail(`${component.name}: ${errors.join('；')}`); continue; }
      if (selection.component_ref) {
        const asset = index.components.find(c => c.id === selection.component_ref);
        if (!asset) { fail(`${component.name}: component_ref 不存在：${selection.component_ref}`); continue; }
        if (!componentDependencyAllowed(ctx.projectRoot, component.module, asset.module)) fail(`${component.name}: ${component.module} → ${asset.module} 依赖非法；换合法候选 > plan 声明组件下沉 > 请求用户批准新边（goal: await-confirm 后 resume）`);
        if (selection.resolution === 'evolve' && !scope?.in_scope_modules.includes(asset.module)) fail(`${component.name}: evolve 共享模块 ${asset.module} 必须进入 plan in_scope_modules`);
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
          const invalid = Object.entries(asset.static_checks).filter(([, value]) => value === 'fail' || value === 'unknown');
          if (invalid.length) result.push(componentResult('component_new_static_checks', 'FAIL', `${asset.id}: 新登记共享组件不得引入 fail/unknown：${invalid.map(([k, v]) => `${k}=${v}`).join(', ')}`));
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
  const calls = new Map(index.components.map(c => [c.id, [] as string[]]));
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
        for (let i = 0; i < lines.length && hits.length < 3; i++) if (pattern.test(lines[i])) hits.push(`${file}:${i + 1}: ${lines[i].trim()}`);
      }
    }
  };
  if (modules.ok) for (const module of modules.catalog.modules) visit(`${module.layer}/${module.name}`);
  return [
    { label: relComponentIndex(root), content: JSON.stringify(index) },
    { label: relComponentCatalog(root), content: JSON.stringify(catalog) },
    { label: '组件候选 live 调用点（每组件最多 3 个样本，非引用总数）', content: [...calls].map(([id, hits]) => `${id}\n${hits.length ? hits.join('\n') : '未检出调用样本（不代表无调用，别名可能漏采）'} `).join('\n\n') },
  ];
}
