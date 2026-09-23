import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { ArchitectureDsl, componentIndexPath, componentCatalogPath, loadFrameworkConfig, loadArchitectureDsl, isOuterDepAllowed, isIntraLayerDepAllowed } from '../../config';
import { loadResolvedProfile } from '../../profile-loader';
import { tryLoadProfileHarnessModule } from '../../profile-host-loader';
import { ModuleCard, loadCatalog } from './catalog-parser';
import { validateProjectRelativePath } from './project-relative-path';

export const ASSET_RESOLUTIONS = ['reuse', 'configure', 'adapt', 'evolve', 'custom'] as const;
export const STATIC_CHECKS = ['scalable_font_unit', 'no_hardcoded_hex_color', 'declared_touch_target'] as const;
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
export function resolveAdmittedModules(root: string, blueprint: Record<string, unknown>): AdmittedModules {
  const layers = new Set(loadArchitectureDsl(root).outer_layers.map(l => l.id));
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
export function componentDependencyAllowed(root: string, consumer: string, provider: string, declared?: Map<string, string>): boolean {
  const catalog = loadCatalog(root);
  const arch = loadArchitectureDsl(root);
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
