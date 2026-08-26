// ============================================================================
// adapter-catalog.ts — 磁盘 agents/ 成员 + registry options join（纯函数，接 frameworkRoot）
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import YAML from 'yaml';

import type { CheckResult } from './types';

export interface AdapterCatalogEntry {
  value: string;
  label: string;
  portable: string;
}

export interface AdapterListIssue {
  adapter: string;
  message: string;
}

export interface AdapterListResult {
  names: string[];
  issues: AdapterListIssue[];
}

/** Cursor AskQuestion 多选上限（reviewer 估计区间 2–4，**本环境尚未实测锁定**；取区间上界作保守缺省；catalog 超出时须 portable 编号 fallback） */
export const CURSOR_ASKQUESTION_MULTISELECT_MAX = 4;

export const ADAPTER_CANDIDATES_ANCHOR_START = '<!-- adapter-candidates:start -->';
export const ADAPTER_CANDIDATES_ANCHOR_END = '<!-- adapter-candidates:end -->';

const INIT_MATERIALIZED_ADAPTERS_ID = 'init.materialized_adapters';

const MENU_CANDIDATE_SCAN_FILES = [
  ['skills', 'project', 'framework-init', 'SKILL.md'],
  ['skills', 'project', 'framework-init', 'prompts', 'adapter-selection.md'],
  ['skills', 'project', 'framework-init', 'templates', 'adapter-widget-options.md'],
  ['agents', 'claude', 'templates', 'commands', 'framework-init.md'],
  // codeagent 自有 commands 副本（plan c7a9e2f4）：与 claude 版同携 adapter-candidates 锚点，
  // 同样纳入硬编码扫描，防止副本漂移出菜单口径。
  ['agents', 'codeagent', 'templates', 'commands', 'framework-init.md'],
  ['skills', 'reference', 'user-confirmation-ux.md'],
] as const;

const AGENTS_README_REFERENCE_SECTIONS = [
  { start: '## Init Skill：`adapter.yaml` 产物速查', end: '## Init Skill：`adapter.yaml` 字段处理示例' },
  { start: '## `materialized_adapters` 多选建议', end: '## Adapter 选定建议' },
  { start: '## 第一版 adapter 列表', end: '### Layer 3 物理拦截能力' },
] as const;

/** widget 承载 gate 文案须引用此符号，数值 SSOT 见本文件 `CURSOR_ASKQUESTION_MULTISELECT_MAX` */
export const WIDGET_GATE_SSOT_SYMBOL = 'CURSOR_ASKQUESTION_MULTISELECT_MAX';

const WIDGET_GATE_DOC_FILES = [
  ['skills', 'reference', 'user-confirmation-ux.md'],
  ['skills', 'project', 'framework-init', 'SKILL.md'],
  ['skills', 'project', 'framework-init', 'templates', 'adapter-widget-options.md'],
  ['agents', 'cursor', 'templates', 'rules', 'interaction-renderer.mdc'],
  ['agents', 'claude', 'templates', 'rules', 'interaction-renderer.md'],
  ['agents', 'claude', 'templates', 'commands', 'framework-init.md'],
  ['agents', 'codeagent', 'templates', 'commands', 'framework-init.md'],
] as const;

function isAdapterDirName(name: string): boolean {
  if (!name || name.startsWith('.')) return false;
  if (name === 'shared') return false;
  return true;
}

function readAdapterYamlName(frameworkRoot: string, dirName: string): {
  adapterName?: string;
  issue?: AdapterListIssue;
} {
  const yamlPath = path.join(frameworkRoot, 'agents', dirName, 'adapter.yaml');
  if (!fs.existsSync(yamlPath)) {
    return {
      issue: { adapter: dirName, message: `agents/${dirName}/adapter.yaml 缺失` },
    };
  }
  let cfg: unknown;
  try {
    cfg = YAML.parse(fs.readFileSync(yamlPath, 'utf-8'));
  } catch (e) {
    return {
      issue: { adapter: dirName, message: `agents/${dirName}/adapter.yaml 解析失败: ${(e as Error).message}` },
    };
  }
  if (!cfg || typeof cfg !== 'object') {
    return {
      issue: { adapter: dirName, message: `agents/${dirName}/adapter.yaml 顶层不是对象` },
    };
  }
  const adapterName = (cfg as Record<string, unknown>).adapter_name;
  if (typeof adapterName !== 'string' || !adapterName.trim()) {
    return {
      issue: { adapter: dirName, message: `agents/${dirName}/adapter.yaml 缺少 adapter_name` },
    };
  }
  const trimmed = adapterName.trim();
  if (trimmed !== dirName) {
    return {
      issue: {
        adapter: dirName,
        message: `agents/${dirName}/adapter.yaml adapter_name="${trimmed}" 与目录名不一致`,
      },
    };
  }
  return { adapterName: trimmed };
}

export function listAvailableAdapters(frameworkRoot: string): AdapterListResult {
  const agentsDir = path.join(frameworkRoot, 'agents');
  const issues: AdapterListIssue[] = [];
  const names: string[] = [];
  const seen = new Map<string, string>();

  if (!fs.existsSync(agentsDir)) {
    return {
      names: [],
      issues: [{ adapter: 'agents', message: `agents/ 目录不存在: ${agentsDir}` }],
    };
  }

  const entries = fs.readdirSync(agentsDir, { withFileTypes: true })
    .filter(ent => ent.isDirectory() && isAdapterDirName(ent.name))
    .map(ent => ent.name)
    .sort();

  for (const dirName of entries) {
    const parsed = readAdapterYamlName(frameworkRoot, dirName);
    if (parsed.issue) {
      issues.push(parsed.issue);
      continue;
    }
    const name = parsed.adapterName!;
    const priorDir = seen.get(name);
    if (priorDir) {
      issues.push({
        adapter: dirName,
        message: `adapter_name "${name}" 与 agents/${priorDir} 重名`,
      });
      continue;
    }
    seen.set(name, dirName);
    names.push(name);
  }

  return { names, issues };
}

interface RegistryMaterializedOptions {
  options: AdapterCatalogEntry[];
  portableMenu?: string;
}

function loadRegistryMaterializedOptions(frameworkRoot: string): RegistryMaterializedOptions {
  const registryPath = path.join(frameworkRoot, 'skills', 'reference', 'confirmation-registry.yaml');
  if (!fs.existsSync(registryPath)) {
    throw new Error(`confirmation-registry.yaml 缺失: ${registryPath}`);
  }
  const doc = YAML.parse(fs.readFileSync(registryPath, 'utf-8')) as {
    entries?: Array<Record<string, unknown>>;
  };
  const entries = Array.isArray(doc?.entries) ? doc.entries : [];
  const entry = entries.find(e => e?.id === INIT_MATERIALIZED_ADAPTERS_ID);
  if (!entry) {
    throw new Error(`confirmation-registry.yaml 缺少 ${INIT_MATERIALIZED_ADAPTERS_ID}`);
  }
  const rawOptions = Array.isArray(entry.options) ? entry.options : [];
  const options: AdapterCatalogEntry[] = [];
  for (const opt of rawOptions) {
    if (!opt || typeof opt !== 'object') continue;
    const row = opt as Record<string, unknown>;
    const value = typeof row.value === 'string' ? row.value.trim() : '';
    const label = typeof row.label === 'string' ? row.label : '';
    const portable = typeof row.portable === 'string' ? row.portable : '';
    if (!value || !label || !portable) continue;
    options.push({ value, label, portable });
  }
  const portableMenu = typeof entry.portable_menu === 'string' ? entry.portable_menu : undefined;
  return { options, portableMenu };
}

export class AdapterCatalogError extends Error {
  constructor(public readonly issues: string[]) {
    super(issues.join('; '));
    this.name = 'AdapterCatalogError';
  }
}

export function buildAdapterCatalogOrThrow(frameworkRoot: string): AdapterCatalogEntry[] {
  const { names, issues } = listAvailableAdapters(frameworkRoot);
  const messages: string[] = issues.map(i => i.message);

  let registry: RegistryMaterializedOptions;
  try {
    registry = loadRegistryMaterializedOptions(frameworkRoot);
  } catch (e) {
    messages.push((e as Error).message);
    throw new AdapterCatalogError(messages);
  }

  const optionByValue = new Map(registry.options.map(o => [o.value, o]));
  const catalog: AdapterCatalogEntry[] = [];

  for (const name of names) {
    const opt = optionByValue.get(name);
    if (!opt) {
      messages.push(`confirmation-registry options 缺少磁盘 adapter "${name}" 的 label/portable`);
      continue;
    }
    catalog.push({ ...opt });
  }

  for (const opt of registry.options) {
    if (!names.includes(opt.value)) {
      messages.push(`confirmation-registry options 含磁盘不存在的 adapter "${opt.value}"`);
    }
  }

  if (messages.length > 0) {
    throw new AdapterCatalogError(messages);
  }

  return catalog;
}

function countAdapterNamesInText(text: string, adapterNames: string[]): string[] {
  const hits: string[] = [];
  for (const name of adapterNames) {
    const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    if (re.test(text)) hits.push(name);
  }
  return hits;
}

function extractAnchoredSections(content: string): string[] {
  const sections: string[] = [];
  let cursor = 0;
  while (cursor < content.length) {
    const start = content.indexOf(ADAPTER_CANDIDATES_ANCHOR_START, cursor);
    if (start < 0) break;
    const end = content.indexOf(ADAPTER_CANDIDATES_ANCHOR_END, start + ADAPTER_CANDIDATES_ANCHOR_START.length);
    if (end < 0) break;
    sections.push(content.slice(start + ADAPTER_CANDIDATES_ANCHOR_START.length, end));
    cursor = end + ADAPTER_CANDIDATES_ANCHOR_END.length;
  }
  return sections;
}

function stripExcludedReadmeSections(content: string): string {
  let stripped = content;
  for (const { start, end } of AGENTS_README_REFERENCE_SECTIONS) {
    const s = stripped.indexOf(start);
    if (s < 0) continue;
    const e = stripped.indexOf(end, s + start.length);
    if (e < 0) continue;
    stripped = stripped.slice(0, s) + stripped.slice(e);
  }
  return stripped;
}

function catalogBlocker(
  id: string,
  details: string,
  files: string[],
  suggestion?: string,
): CheckResult {
  return {
    id,
    category: 'structure',
    description: `adapter catalog: ${id}`,
    severity: 'BLOCKER',
    status: 'FAIL',
    details,
    affected_files: files,
    suggestion,
  };
}

function catalogPass(id: string, details: string): CheckResult {
  return {
    id,
    category: 'structure',
    description: `adapter catalog: ${id}`,
    severity: 'BLOCKER',
    status: 'PASS',
    details,
  };
}

export function checkAdapterCatalogConsistency(frameworkRoot: string): CheckResult[] {
  const results: CheckResult[] = [];
  const rel = (parts: string[]) => parts.join('/');

  try {
    buildAdapterCatalogOrThrow(frameworkRoot);
    results.push(catalogPass('catalog_join', '磁盘 agents/ 与 registry options join 一致'));
  } catch (e) {
    const issues = e instanceof AdapterCatalogError ? e.issues : [(e as Error).message];
    results.push(catalogBlocker(
      'catalog_join',
      issues.join('; '),
      [rel(['skills', 'reference', 'confirmation-registry.yaml']), rel(['agents'])],
    ));
  }

  const { names } = listAvailableAdapters(frameworkRoot);
  if (names.length === 0) {
    results.push(catalogBlocker('catalog_empty', 'agents/ 未发现可用 adapter', [rel(['agents'])]));
    return results;
  }

  for (const parts of MENU_CANDIDATE_SCAN_FILES) {
    const abs = path.join(frameworkRoot, ...parts);
    const fileRel = rel([...parts]);
    if (!fs.existsSync(abs)) {
      results.push(catalogBlocker('menu_anchor_file_missing', `菜单口径文件缺失: ${fileRel}`, [fileRel]));
      continue;
    }
    const content = fs.readFileSync(abs, 'utf-8');
    if (!content.includes(ADAPTER_CANDIDATES_ANCHOR_START)) {
      results.push(catalogBlocker(
        'menu_anchor_missing',
        `${fileRel} 缺少 ${ADAPTER_CANDIDATES_ANCHOR_START}`,
        [fileRel],
        '在菜单口径段包裹 adapter-candidates 锚点',
      ));
      continue;
    }
    const sections = extractAnchoredSections(content);
    if (sections.length === 0) {
      results.push(catalogBlocker(
        'menu_anchor_unclosed',
        `${fileRel} adapter-candidates 锚点未闭合`,
        [fileRel],
      ));
      continue;
    }
    for (const section of sections) {
      const hits = countAdapterNamesInText(section, names);
      if (hits.length >= 2) {
        results.push(catalogBlocker(
          'menu_hardcoded_adapters',
          `${fileRel} 锚点段硬编码 ≥2 个 adapter 名: ${hits.join(', ')}`,
          [fileRel],
          '选项须来自 S1 adapter_catalog 原样渲染，禁止写死成员',
        ));
      }
    }
  }

  try {
    const registry = loadRegistryMaterializedOptions(frameworkRoot);
    if (registry.portableMenu) {
      const hits = countAdapterNamesInText(registry.portableMenu, names);
      if (hits.length >= 2) {
        results.push(catalogBlocker(
          'portable_menu_hardcoded',
          `confirmation-registry ${INIT_MATERIALIZED_ADAPTERS_ID}.portable_menu 硬编码 ≥2 个 adapter 名: ${hits.join(', ')}`,
          [rel(['skills', 'reference', 'confirmation-registry.yaml'])],
          'portable_menu 应指向 adapter_catalog，勿枚举具体 adapter',
        ));
      }
    }
  } catch (e) {
    results.push(catalogBlocker(
      'registry_load',
      (e as Error).message,
      [rel(['skills', 'reference', 'confirmation-registry.yaml'])],
    ));
  }

  const readmePath = path.join(frameworkRoot, 'agents', 'README.md');
  if (fs.existsSync(readmePath)) {
    const readmeRel = rel(['agents', 'README.md']);
    const raw = fs.readFileSync(readmePath, 'utf-8');
    const scanText = stripExcludedReadmeSections(raw);
    const sections = extractAnchoredSections(scanText);
    for (const section of sections) {
      const hits = countAdapterNamesInText(section, names);
      if (hits.length >= 2) {
        results.push(catalogBlocker(
          'readme_menu_hardcoded',
          `${readmeRel} 锚点段硬编码 ≥2 个 adapter 名: ${hits.join(', ')}`,
          [readmeRel],
        ));
      }
    }
  }

  for (const parts of WIDGET_GATE_DOC_FILES) {
    const abs = path.join(frameworkRoot, ...parts);
    const fileRel = rel([...parts]);
    if (!fs.existsSync(abs)) continue;
    const content = fs.readFileSync(abs, 'utf-8');
    if (!content.includes(WIDGET_GATE_SSOT_SYMBOL)) {
      results.push(catalogBlocker(
        'widget_gate_ssot_missing',
        `${fileRel} 须引用 ${WIDGET_GATE_SSOT_SYMBOL}（数值 SSOT：adapter-catalog.ts = ${CURSOR_ASKQUESTION_MULTISELECT_MAX}）`,
        [fileRel],
      ));
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// 视觉委托 provider 支持列表（plan ab072691 t1⑥）
// ---------------------------------------------------------------------------
// **唯一真源**：`agents/<adapter>/adapter.yaml` 的 `visual_provider` 完整声明。
// 这里只做「扫描 + 完整性校验」，不维护任何 adapter 名白名单、不做内核家族推断、
// 不与 KNOWN_MODEL_PIN_ADAPTERS 之类的集合求交/求差——那些都会形成平行真源。
// `goal_capability` 不参与 provider 资格判定（正交能力：能不能当 goal 主执行体
// ≠ 能不能只读看图）。
// ---------------------------------------------------------------------------

/** 只读启动机制 id（机制名，非厂商名——多个 adapter 可共用同一机制）。 */
export const VISUAL_PROVIDER_READONLY_INVOKE_MODES = [
  'safe_mode_read_only_tools',
  'read_only_sandbox',
  'ask_mode',
  'permission_deny_non_read',
] as const;
export type VisualProviderReadonlyInvoke = (typeof VISUAL_PROVIDER_READONLY_INVOKE_MODES)[number];

/** 图片入模路径（两者都直接用工程内原路径，无暂存复制）。 */
export const VISUAL_PROVIDER_IMAGE_TRANSPORTS = ['prompt_path', 'native_image_flag'] as const;
export type VisualProviderImageTransport = (typeof VISUAL_PROVIDER_IMAGE_TRANSPORTS)[number];

/** stdout 信封方言——决定复用哪个**既有**正文投影/terminal 解析能力，不新建 parser。 */
export const VISUAL_PROVIDER_STDOUT_ENVELOPES = [
  'stream_json_result',
  'turn_jsonl',
  'result_json',
  'events_json',
] as const;
export type VisualProviderStdoutEnvelope = (typeof VISUAL_PROVIDER_STDOUT_ENVELOPES)[number];

export interface VisualProviderDeclaration {
  readonly_invoke: VisualProviderReadonlyInvoke;
  image_transport: VisualProviderImageTransport;
  stdout_envelope: VisualProviderStdoutEnvelope;
  /** 模型回放旗标 token（如 `--model` / `-m`）——model 必须真实进入该旗标 */
  model_replay: string;
}

export type VisualProviderDeclarationParse =
  | { ok: true; declaration: VisualProviderDeclaration }
  | { ok: false; reason: string };

/** 声明允许的键集合——多余键即视为不完整声明（防写错字段名却「看起来齐了」）。 */
const VISUAL_PROVIDER_KEYS = new Set([
  'readonly_invoke',
  'image_transport',
  'stdout_envelope',
  'model_replay',
]);

/**
 * 纯函数：把 adapter.yaml 的 `visual_provider` 原始值解析为完整声明。
 * **缺一即不完整**（不补默认值）——不完整=无资格，不是「降级可用」。
 */
export function parseVisualProviderDeclaration(raw: unknown): VisualProviderDeclarationParse {
  if (raw === undefined || raw === null) return { ok: false, reason: 'visual_provider 未声明' };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'visual_provider 必须是对象' };
  }
  const obj = raw as Record<string, unknown>;
  const unknown = Object.keys(obj).filter(k => !VISUAL_PROVIDER_KEYS.has(k));
  if (unknown.length > 0) {
    return { ok: false, reason: `visual_provider 含未知键: ${unknown.join(', ')}` };
  }
  const pickEnum = <T extends string>(
    key: string,
    allowed: readonly T[],
  ): { ok: true; value: T } | { ok: false; reason: string } => {
    const v = obj[key];
    if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
      return {
        ok: false,
        reason: `visual_provider.${key} 必须是 ${allowed.join('|')}，收到 ${String(v)}`,
      };
    }
    return { ok: true, value: v as T };
  };
  const readonlyInvoke = pickEnum('readonly_invoke', VISUAL_PROVIDER_READONLY_INVOKE_MODES);
  if (!readonlyInvoke.ok) return readonlyInvoke;
  const imageTransport = pickEnum('image_transport', VISUAL_PROVIDER_IMAGE_TRANSPORTS);
  if (!imageTransport.ok) return imageTransport;
  const stdoutEnvelope = pickEnum('stdout_envelope', VISUAL_PROVIDER_STDOUT_ENVELOPES);
  if (!stdoutEnvelope.ok) return stdoutEnvelope;
  const modelReplayRaw = obj.model_replay;
  const modelReplay = typeof modelReplayRaw === 'string' ? modelReplayRaw.trim() : '';
  if (!modelReplay.startsWith('-') || modelReplay.length < 2 || /\s/.test(modelReplay)) {
    return {
      ok: false,
      reason: `visual_provider.model_replay 必须是单个模型回放旗标 token（如 --model），收到 ${String(modelReplayRaw)}`,
    };
  }
  return {
    ok: true,
    declaration: {
      readonly_invoke: readonlyInvoke.value,
      image_transport: imageTransport.value,
      stdout_envelope: stdoutEnvelope.value,
      model_replay: modelReplay,
    },
  };
}

export interface VisualProviderCatalogEntry {
  adapter: string;
  declaration: VisualProviderDeclaration;
}

/** 读单个 adapter 的声明；文件缺失/解析失败/声明不完整一律返回 not ok（不 throw）。 */
export function loadVisualProviderDeclaration(
  frameworkRoot: string,
  adapterName: string,
): VisualProviderDeclarationParse {
  const yamlPath = path.join(frameworkRoot, 'agents', adapterName, 'adapter.yaml');
  if (!fs.existsSync(yamlPath)) {
    return { ok: false, reason: `agents/${adapterName}/adapter.yaml 缺失` };
  }
  let cfg: unknown;
  try {
    cfg = YAML.parse(fs.readFileSync(yamlPath, 'utf-8'));
  } catch (e) {
    return { ok: false, reason: `agents/${adapterName}/adapter.yaml 解析失败: ${(e as Error).message}` };
  }
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) {
    return { ok: false, reason: `agents/${adapterName}/adapter.yaml 顶层不是对象` };
  }
  return parseVisualProviderDeclaration((cfg as Record<string, unknown>).visual_provider);
}

/**
 * 派生 provider 支持列表（**唯一**支持列表来源）。按 adapter 名确定性排序。
 * 目录扫描复用 listAvailableAdapters（adapter_name 与目录名一致性已在那里把关）。
 */
export function listVisualProviderAdapters(frameworkRoot: string): VisualProviderCatalogEntry[] {
  const { names } = listAvailableAdapters(frameworkRoot);
  const out: VisualProviderCatalogEntry[] = [];
  for (const adapter of [...names].sort()) {
    const parsed = loadVisualProviderDeclaration(frameworkRoot, adapter);
    if (parsed.ok) out.push({ adapter, declaration: parsed.declaration });
  }
  return out;
}

/** 支持项名单（提示/错误/校验共用同一结果，禁止第二处枚举）。 */
export function listVisualProviderAdapterNames(frameworkRoot: string): string[] {
  return listVisualProviderAdapters(frameworkRoot).map(e => e.adapter);
}

export function isVisualProviderSupported(frameworkRoot: string, adapterName: string): boolean {
  return loadVisualProviderDeclaration(frameworkRoot, adapterName).ok;
}

/** 人读支持项文案（catalog 派生；不得在别处硬编码 adapter 名）。 */
export function formatVisualProviderSupportList(frameworkRoot: string): string {
  const names = listVisualProviderAdapterNames(frameworkRoot);
  return names.length > 0 ? names.join('、') : '（当前无任何 adapter 声明 visual_provider）';
}
