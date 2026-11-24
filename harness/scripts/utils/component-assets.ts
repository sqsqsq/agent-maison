import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { ArchitectureDsl, componentIndexPath, componentCatalogPath, loadFrameworkConfig, loadArchitectureDsl, isOuterDepAllowed, isIntraLayerDepAllowed } from '../../config';
import { loadResolvedProfile } from '../../profile-loader';
import { tryLoadProfileHarnessModule } from '../../profile-host-loader';
import { ModuleCard, loadCatalog } from './catalog-parser';
import { validateProjectRelativePath } from './project-relative-path';
import { asRecord, asRecords, asStrings, nonEmptyString, type BlueprintRecord } from './component-blueprint-model';

export const ASSET_RESOLUTIONS = ['reuse', 'configure', 'adapt', 'evolve', 'custom'] as const;
export const STATIC_CHECKS = ['scalable_font_unit', 'no_hardcoded_hex_color', 'declared_touch_target'] as const;

/** Rebuild only the source-derived inventory; never curate or choose an asset. */
export function refreshComponentIndex(root: string, feature?: string): ReturnType<typeof scanComponentIndex> {
  const result = scanComponentIndex(root);
  const file = componentIndexPath(root);
  const text = serializeComponentIndex(result.index);
  if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) {
    const write = () => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text, 'utf8'); };
    if (feature) (require('./phase-write-boundary') as typeof import('./phase-write-boundary')).recordProducedPhaseWrites({
      projectRoot: root, feature, producer: 'component-index', files: [file] }, write);
    else write();
  }
  return result;
}

/** A configured, current inventory is derived bookkeeping regardless of its directory. */
export function isCurrentComponentInventory(root: string, file: string): boolean {
  if (path.resolve(root, file) !== path.resolve(componentIndexPath(root))) return false;
  try {
    const index = readComponentIndex(root);
    return !!index && serializeComponentIndex(index) === serializeComponentIndex(scanComponentIndex(root).index);
  } catch { return false; }
}
export type StaticCheck = 'pass' | 'fail' | 'unknown' | 'not_applicable';
export interface AssetSelection {
  resolution: typeof ASSET_RESOLUTIONS[number];
  component_ref?: string;
  bindings?: Record<string, unknown>;
  rationale?: string;
}
export interface ComponentAsset {
  id: string;
  module: string;
  file: string;
  symbol: string;
  kind: 'component' | 'builder';
  props: string[];
  deprecated: boolean;
  source_fingerprint: string;
  static_checks: Record<typeof STATIC_CHECKS[number], StaticCheck>;
}
export interface ComponentIndex { schema_version: '1.0'; components: ComponentAsset[] }
export interface CuratedComponent {
  id: string;
  intent: string[];
  one_liner: string;
  use_when: string[];
  not_for: string[];
  easily_confused_with: string[];
  status: 'recommended' | 'legacy' | 'deprecated';
  notes: string;
  golden?: { file: string; symbol: string };
}
export interface ComponentCatalog { schema_version: '1.0'; components: CuratedComponent[] }
export type SourceReader = (relativePath: string) => string | null;
export interface ComponentScan { index: ComponentIndex; warnings: string[]; exportFiles: Map<string, string> }
export type ComponentExtractor = (root: string, card: ModuleCard, arch: ArchitectureDsl, read?: SourceReader) => { components: ComponentAsset[]; warnings: string[]; exportFile: string };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
const nonempty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(nonempty);
export function isComponentId(value: unknown): value is string {
  return typeof value === 'string' && /^[^/\\:#\s]+\/(?:[^/\\:#\s]+\/)*[^/\\:#\s]+#[A-Za-z_$][\w$]*$/.test(value)
    && !value.split(/[\/#]/).some(segment => segment === '.' || segment === '..');
}
export function isUiComponent(value: { kind?: unknown; decorator?: unknown; nav_destination?: unknown; nav_destinations?: unknown }): boolean {
  return ['page', 'component', 'builder'].includes(String(value.kind).toLowerCase())
    || /^@?(Component(?:V2)?|Builder)$/.test(String(value.decorator))
    || nonempty(value.nav_destination) || (Array.isArray(value.nav_destinations) && value.nav_destinations.length > 0);
}

/** UI facts can be declared on a development node or in its typed construction contract. */
export function isBlueprintUiTarget(node: BlueprintRecord): boolean {
  return isUiComponent(node) || asRecords(asRecord(node.contracts)?.components).some(isUiComponent);
}

function declaredComponentName(component: { name?: unknown; class?: unknown }): unknown {
  return component.name === undefined ? component.class : component.name;
}

export function componentLocation(component: { file?: unknown; name?: unknown; class?: unknown }): string | undefined {
  const name = declaredComponentName(component);
  if (nonEmptyString(component.file) && nonEmptyString(name)) return `${component.file}#${name}`;
}

/** Legacy page facts bind an extra in-scope file to a source-confirmed symbol. */
function declaredExistingPages(root: string, blueprint: BlueprintRecord, target: BlueprintRecord, typed: BlueprintRecord[], report: (message: string) => void): BlueprintRecord[] {
  if (target.kind !== 'page') return [];
  const files = new Set(asStrings(asRecord(target.contracts)?.files));
  return asRecords(asRecord(blueprint.discovery)?.facts).flatMap(fact => {
    const value = asRecord(fact.value);
    const provenance = asRecord(fact.provenance);
    if (!value || !String(fact.subject).startsWith('existing_page:') || !nonEmptyString(value.file) || !files.has(value.file)
      || value.module !== target.module || value.file === target.file || typed.some(row => row.file === value.file && componentLocation(row))
      || provenance?.evidence_strength !== 'authoritative' || provenance.source_ref !== value.file) return [];
    const name = value.name ?? value.route;
    try {
      if (nonEmptyString(name)) {
        const source = fs.readFileSync(path.join(root, validateProjectRelativePath(root, value.file, 'existing page fact')), 'utf8');
        const profile = loadResolvedProfile(root, loadFrameworkConfig(root));
        const host = tryLoadProfileHarnessModule<{ componentSourceSymbols?: (source: string) => string[] }>(profile.profileDir, 'component-extractor');
        if (host?.componentSourceSymbols?.(source).filter(symbol => symbol === name).length === 1) {
          return [{ file: value.file, name, kind: 'page', module: value.module }];
        }
      }
    } catch { /* The owner can replace unreadable or ambiguous evidence with a typed declaration. */ }
    report(`discovery.facts.${String(fact.fact_id)} (${value.file}): 缺少可确认的页面符号，请补 contracts.components.file/name`);
    return [];
  });
}

/** Complete a target's existing declarations from its own identified component facts. */
export function blueprintTargetComponents(root: string | undefined, blueprint: BlueprintRecord, target: BlueprintRecord, report: (message: string) => void): BlueprintRecord[] {
  const named = (row: BlueprintRecord): BlueprintRecord => {
    if (row.name !== undefined && nonEmptyString(row.class) && row.name !== row.class) {
      report(`${String(row.file)}: 组件 name=${String(row.name)} 与旧式 class=${row.class} 冲突`);
    }
    return row.name === undefined && nonEmptyString(row.class) ? { ...row, name: declaredComponentName(row) } : row;
  };
  const fields = ['file', 'name', 'module', 'kind', 'decorator', 'linked_functions', 'state', 'props', 'events', 'children', 'nav_destinations', 'nav_destination', 'description', 'asset_selection'];
  const direct = isUiComponent(target) ? named(target) : undefined;
  const explicit = direct && componentLocation(direct)
    ? [Object.fromEntries(fields.filter(field => direct[field] !== undefined).map(field => [field, direct[field]]))] : [];
  const typed = asRecords(asRecord(target.contracts)?.components).filter(row => isUiComponent(row) || row.asset_selection !== undefined
    || row.kind === undefined && isUiComponent(target)).map(named);
  const standalone = [...explicit, ...(root ? declaredExistingPages(root, blueprint, target, typed, report) : [])];
  const identities = new Map([...standalone, ...typed].flatMap(row => {
    const id = componentLocation(row);
    return id ? [[id, row] as const] : [];
  }));
  const components = new Map<string, BlueprintRecord>();
  for (const row of [...standalone, ...typed]) {
    const candidates = componentLocation(row) ? [row] : [...identities.values()].filter(known =>
      (row.file === undefined || known.file === row.file) && (row.name === undefined || known.name === row.name));
    if (candidates.length !== 1) {
      report(`contracts.components.file/name 缺失或有歧义：${JSON.stringify({ file: row.file, name: row.name })}`);
      continue;
    }
    const known = candidates[0];
    const key = componentLocation(known)!;
    const prior = components.get(key);
    for (const field of ['module', 'kind'] as const) {
      if (prior?.[field] !== undefined && row[field] !== undefined && prior[field] !== row[field]) {
        report(`${key}: 目标与 contracts.components 的 ${field} 冲突（${String(prior[field])} / ${String(row[field])}）`);
      }
    }
    const completed: BlueprintRecord = { ...prior, ...row, file: known.file, name: known.name };
    completed.module ??= target.module;
    completed.kind ??= target.kind;
    components.set(key, completed);
  }
  for (const [key, component] of components) {
    if (!nonEmptyString(component.module) || !nonEmptyString(component.kind)) report(`${key}: contracts.components 缺 module/kind`);
  }
  return [...components.values()];
}

export function blueprintUiComponents(blueprint: BlueprintRecord, root?: string): BlueprintRecord[] {
  const development = asRecords(blueprint.design_views).find(view => view.view_id === 'development');
  const components = asRecords(development?.nodes).flatMap(node => blueprintTargetComponents(root, blueprint, node, () => undefined));
  return [...new Map(components.flatMap(component => {
    const key = componentLocation(component);
    return key ? [[key, component] as const] : [];
  })).values()];
}

/** Select by the declared target relationship, never by a guessed name or the local selection value. */
export function blueprintComponentDecisions(blueprint: BlueprintRecord, component: BlueprintRecord, root?: string): BlueprintRecord[] {
  const nodes = asRecords(asRecords(blueprint.design_views).find(view => view.view_id === 'development')?.nodes);
  const key = componentLocation(component);
  if (!key) return [];
  const exact = nodes.filter(node => isUiComponent(node) && componentLocation(node) === key);
  const owners = exact.length ? exact : nodes.filter(node => blueprintTargetComponents(root, blueprint, node, () => undefined)
    .some(item => componentLocation(item) === key));
  const targets = new Set(owners.map(node => `view:development/node:${node.node_id}`));
  return asRecords(asRecord(blueprint.decisions_and_gaps)?.decisions)
    .filter(decision => decision.kind === 'component_asset_selection' && targets.has(String(decision.target_ref)));
}
export function selectionShapeIssues(value: unknown): string[] {
  if (!isRecord(value)) return ['asset_selection 必须是单值对象'];
  const errors: string[] = [];
  if (!(ASSET_RESOLUTIONS as readonly unknown[]).includes(value.resolution)) errors.push('resolution 值域非法');
  if (value.resolution !== 'custom' && !isComponentId(value.component_ref)) errors.push('非 custom 必须有合法 component_ref');
  if (value.component_ref !== undefined && !isComponentId(value.component_ref)) errors.push('component_ref 格式非法');
  if (['adapt', 'evolve', 'custom'].includes(String(value.resolution)) && !nonempty(value.rationale)) errors.push('adapt/evolve/custom 必须有 rationale');
  if (value.rationale !== undefined && !nonempty(value.rationale)) errors.push('rationale 必须是非空字符串');
  if (value.bindings !== undefined && !isRecord(value.bindings)) errors.push('bindings 必须是对象');
  if (Object.keys(value).some(key => !['resolution', 'component_ref', 'bindings', 'rationale'].includes(key))) errors.push('asset_selection 含未知字段');
  return errors;
}

export function readComponentIndex(root: string): ComponentIndex | null {
  const file = componentIndexPath(root);
  if (!fs.existsSync(file)) return null;
  const value: unknown = YAML.parse(fs.readFileSync(file, 'utf8'));
  if (!isRecord(value) || value.schema_version !== '1.0' || !Array.isArray(value.components)
    || Object.keys(value).some(k => !['schema_version', 'components'].includes(k))) throw new Error('component-index 根结构非法');
  const catalog = loadCatalog(root);
  if (!catalog.ok) throw new Error('component-index 无法读取 module-catalog');
  const ids = new Set<string>();
  for (const item of value.components) {
    if (!isRecord(item) || !isComponentId(item.id) || !nonempty(item.module) || !nonempty(item.file) || !nonempty(item.symbol)
      || !['component', 'builder'].includes(String(item.kind)) || !strings(item.props) || typeof item.deprecated !== 'boolean'
      || !/^sha256:[a-f0-9]{64}$/.test(String(item.source_fingerprint)) || !isRecord(item.static_checks)
      || STATIC_CHECKS.some(k => !['pass', 'fail', 'unknown', 'not_applicable'].includes(String((item.static_checks as Record<string, unknown>)[k])))
      || Object.keys(item.static_checks).length !== STATIC_CHECKS.length
      || Object.keys(item).some(k => !['id', 'module', 'file', 'symbol', 'kind', 'props', 'deprecated', 'source_fingerprint', 'static_checks'].includes(k))) throw new Error(`component-index 条目非法：${JSON.stringify(item)}`);
    const mod = catalog.catalog.modules.find(m => m.name === item.module);
    if (!mod || !['HAR', 'HSP'].includes(String(mod.format).toUpperCase())) throw new Error(`组件模块不在 HAR/HSP catalog：${item.module}`);
    const rel = validateProjectRelativePath(root, item.file, 'component-index.file');
    const prefix = `${mod.layer}/${mod.name}/`;
    if (!rel.startsWith(prefix) || item.id !== `${mod.name}/${rel.slice(prefix.length)}#${item.symbol}`) throw new Error(`组件稳定 ID 与定义位置不一致：${item.id}`);
    if (ids.has(item.id)) throw new Error(`组件 ID 重复：${item.id}`);
    ids.add(item.id);
  }
  return value as unknown as ComponentIndex;
}

export function parseComponentCatalog(root: string, value: unknown): ComponentCatalog {
  if (!isRecord(value) || value.schema_version !== '1.0' || !Array.isArray(value.components)
    || Object.keys(value).some(k => !['schema_version', 'components'].includes(k))) throw new Error('component-catalog 根结构非法');
  const ids = new Set<string>();
  for (const card of value.components) {
    if (!isRecord(card) || !isComponentId(card.id) || !nonempty(card.one_liner) || !strings(card.intent)
      || !strings(card.use_when) || !strings(card.not_for) || !strings(card.easily_confused_with)
      || !['recommended', 'legacy', 'deprecated'].includes(String(card.status)) || typeof card.notes !== 'string'
      || Object.keys(card).some(k => !['id', 'intent', 'one_liner', 'use_when', 'not_for', 'easily_confused_with', 'status', 'notes', 'golden'].includes(k))) throw new Error('component-catalog 条目非法或复制了 index 字段');
    if (ids.has(card.id)) throw new Error(`策展 ID 重复：${card.id}`);
    ids.add(card.id);
    if (card.golden !== undefined) {
      if (!isRecord(card.golden) || !nonempty(card.golden.file) || !nonempty(card.golden.symbol)
        || Object.keys(card.golden).some(k => !['file', 'symbol'].includes(k))) throw new Error(`golden 格式非法：${card.id}`);
      validateProjectRelativePath(root, card.golden.file, 'component-catalog.golden.file');
    }
  }
  return value as unknown as ComponentCatalog;
}
export function readComponentCatalog(root: string): ComponentCatalog {
  const file = componentCatalogPath(root);
  return fs.existsSync(file) ? parseComponentCatalog(root, YAML.parse(fs.readFileSync(file, 'utf8'))) : { schema_version: '1.0', components: [] };
}

export function scanComponentIndex(root: string, read?: SourceReader): ComponentScan {
  const cfg = loadFrameworkConfig(root);
  const profile = loadResolvedProfile(root, cfg);
  const host = tryLoadProfileHarnessModule<{ extractComponents?: ComponentExtractor }>(profile.profileDir, 'component-extractor');
  if (!host?.extractComponents) throw new Error(`profile ${profile.name} 缺少 component extractor`);
  const catalog = loadCatalog(root);
  if (!catalog.ok) throw new Error('无法读取 module-catalog');
  const components: ComponentAsset[] = [];
  const warnings: string[] = [];
  const exportFiles = new Map<string, string>();
  for (const card of catalog.catalog.modules) {
    if (!['HAR', 'HSP'].includes(String(card.format).toUpperCase())) continue;
    const extracted = host.extractComponents(root, card, loadArchitectureDsl(root), read);
    components.push(...extracted.components); warnings.push(...extracted.warnings);
    exportFiles.set(card.name, extracted.exportFile);
  }
  components.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return { index: { schema_version: '1.0', components }, warnings: [...new Set(warnings)].sort(), exportFiles };
}
export function serializeComponentIndex(index: ComponentIndex): string {
  return '# 机器生成，勿手编。重跑：npm run bootstrap:component-index -- --project-root <root>\n' + YAML.stringify(index);
}

export interface AdmittedModules {
  /** module-catalog 可读；不可读时 modules 只含本蓝图声明的新模块。 */
  catalogOk: boolean;
  /**
   * 获准模块 name → layer：catalog 当前模块 ∪ declared（declared 覆盖 move 的新层）∪ 本蓝图 retire_module
   * 声明的模块（退役中沿用 catalog 层；已按 closure 归位移出 catalog 的层为 ''，仍是获准身份但不参与依赖判定）。
   */
  modules: Map<string, string>;
  /** 本蓝图 architecture_impact add_module / move_module 声明的目标模块 name → layer（layer ∈ 当前 DSL）。 */
  declared: Map<string, string>;
}

/**
 * plan a3c7e9d1 t2：获准模块唯一解析（P1 节点 module、术语 canonical_module、componentDependencyAllowed
 * 三处同源）。catalog 保持当前态语义（蓝图期不改），声明的新模块只作施工期获准目标。
 */
export function resolveAdmittedModules(root: string, blueprint: Record<string, unknown>, architecture?: ArchitectureDsl): AdmittedModules {
  const layers = new Set((architecture ?? loadArchitectureDsl(root)).outer_layers.map(l => l.id));
  const gaps = isRecord(blueprint.decisions_and_gaps) ? blueprint.decisions_and_gaps : {};
  const declared = new Map<string, string>();
  const retired: string[] = [];
  for (const d of Array.isArray(gaps.decisions) ? gaps.decisions.filter(isRecord) : []) {
    if (d.kind !== 'architecture_impact') continue;
    if (d.change === 'retire_module' && nonempty(d.module)) retired.push(d.module);
    const layer = d.change === 'add_module' ? d.layer : d.change === 'move_module' ? d.to_layer : undefined;
    if (nonempty(d.module) && nonempty(layer) && layers.has(layer)) declared.set(d.module, layer);
  }
  const catalog = loadCatalog(root);
  const modules = new Map(catalog.ok ? catalog.catalog.modules.map(m => [m.name, m.layer] as [string, string]) : []);
  for (const [name, layer] of declared) modules.set(name, layer);
  for (const name of retired) if (!modules.has(name)) modules.set(name, '');
  return { catalogOk: catalog.ok, modules, declared };
}

/**
 * 依赖许可按当前 DSL 判定。端点为模块名（catalog 或 declared 覆盖）或外层 id；`declared` 由调用方传入
 * （蓝图侧=architecture_impact 声明，plan 侧=contracts.modules name→layer），新模块作 consumer 时按声明 layer 判定。
 */
export function componentDependencyAllowed(root: string, consumer: string, provider: string, declared?: Map<string, string>, architecture?: ArchitectureDsl): boolean {
  const catalog = loadCatalog(root);
  const arch = architecture ?? loadArchitectureDsl(root);
  const layerOf = (name: string): string | undefined => declared?.get(name)
    ?? (catalog.ok ? catalog.catalog.modules.find(m => m.name === name)?.layer : undefined)
    ?? (arch.outer_layers.some(l => l.id === name) ? name : undefined);
  const from = layerOf(consumer);
  const to = layerOf(provider);
  if (!from || !to) return false;
  if (!arch.outer_layers.some(l => l.id === from) || !arch.outer_layers.some(l => l.id === to)) return false;
  return from === to
    ? isIntraLayerDepAllowed(arch, from, consumer, provider)
    : isOuterDepAllowed(arch, from, to);
}

/** staging 不携带确认状态；confirmedIds 来自调用者本轮逐条 y，检查成功前不写盘。 */
export function mergeComponentCatalog(root: string, staged: unknown, confirmedIds: string[]): ComponentCatalog {
  const incoming = parseComponentCatalog(root, staged);
  const index = readComponentIndex(root);
  if (!index) throw new Error('先生成 component-index');
  const ids = new Set(index.components.map(c => c.id));
  for (const card of incoming.components) {
    if (!confirmedIds.includes(card.id)) throw new Error(`未逐条确认：${card.id}`);
    if (!ids.has(card.id) || card.easily_confused_with.some(id => !ids.has(id))) throw new Error(`策展引用不存在：${card.id}`);
  }
  const existing = readComponentCatalog(root);
  const merged = new Map(existing.components.map(c => [c.id, c]));
  for (const card of incoming.components) merged.set(card.id, card);
  const result: ComponentCatalog = { schema_version: '1.0', components: [...merged.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0) };
  const file = componentCatalogPath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, YAML.stringify(result), 'utf8');
  return result;
}
