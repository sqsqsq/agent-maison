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
