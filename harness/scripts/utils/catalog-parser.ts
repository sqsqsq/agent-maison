// ============================================================================
// Module Catalog 解析工具
// ============================================================================
// 读取模块画像 SSOT（默认 doc/module-catalog.yaml，实际路径由
// framework.config.json.paths.module_catalog 决定），提供：
//   - loadCatalog(projectRoot): 加载完整 catalog
//   - findModule(catalog, name): 按模块名精确查找
//   - findModulesByTerm(catalog, term): 按业务术语反查模块（精确 + 近似）
//   - hasModule(catalog, name): 快速存在性检查
//
// 消费者:
//   - framework/harness/scripts/check-spec.ts (scope_matches_catalog / terminology_mapping_table)
//   - framework/harness/scripts/check-plan.ts (交叉校验 scope 一致性)
// ============================================================================

import * as fs from 'fs';
import * as YAML from 'yaml';
import { catalogPath, relCatalog } from '../../config';

// --------------------------------------------------------------------------
// 类型
// --------------------------------------------------------------------------

export interface EasilyConfusedEntry {
  module: string;
  disambiguation: string;
}

export interface ModuleCard {
  name: string;
  layer: string;
  sub_layer: string | null;
  format?: string;
  one_liner: string;
  responsibilities: string[];
  NOT_responsible_for: string[];
  typical_business_terms: string[];
  easily_confused_with: EasilyConfusedEntry[];
  key_exports: string[];
  entry_file: string;
}

export interface ModuleCatalog {
  schema_version: string;
  modules: ModuleCard[];
}

export type CatalogLoadError =
  | { kind: 'file_not_found'; path: string }
  | { kind: 'invalid_yaml'; message: string }
  | { kind: 'invalid_schema'; message: string };

// --------------------------------------------------------------------------
// 加载
// --------------------------------------------------------------------------

/**
 * @deprecated 阶段 3：实际路径从 framework.config.json 读取。本常量仅用于
 * 向后兼容已经导入过它的外部代码；新代码请改用 `relCatalog(projectRoot)`。
 */
export const CATALOG_RELATIVE_PATH = 'doc/module-catalog.yaml';

export function loadCatalog(
  projectRoot: string,
): { ok: true; catalog: ModuleCatalog } | { ok: false; error: CatalogLoadError } {
  const fullPath = catalogPath(projectRoot);
  const relPath = relCatalog(projectRoot);

  if (!fs.existsSync(fullPath)) {
    return { ok: false, error: { kind: 'file_not_found', path: relPath } };
  }

  let raw: string;
  try {
    raw = fs.readFileSync(fullPath, 'utf-8');
  } catch (err) {
    return { ok: false, error: { kind: 'file_not_found', path: relPath } };
  }

  let parsed: unknown;
  try {
    parsed = YAML.parse(raw);
  } catch (err) {
    return {
      ok: false,
      error: { kind: 'invalid_yaml', message: (err as Error).message },
    };
  }

  if (!parsed || typeof parsed !== 'object') {
    return {
      ok: false,
      error: { kind: 'invalid_schema', message: 'root must be an object' },
    };
  }

  const root = parsed as Record<string, unknown>;
  const modules = root.modules;

  if (!Array.isArray(modules)) {
    return {
      ok: false,
      error: { kind: 'invalid_schema', message: 'modules must be an array' },
    };
  }

  const normalized: ModuleCard[] = [];
  for (let i = 0; i < modules.length; i++) {
    const m = modules[i] as Record<string, unknown> | undefined;
    if (!m || typeof m !== 'object') {
      return {
        ok: false,
        error: {
          kind: 'invalid_schema',
          message: `modules[${i}] must be an object`,
        },
      };
    }

    const name = typeof m.name === 'string' ? m.name : '';
    const layer = typeof m.layer === 'string' ? m.layer : '';
    const one_liner = typeof m.one_liner === 'string' ? m.one_liner : '';

    if (!name || !layer) {
      return {
        ok: false,
        error: {
          kind: 'invalid_schema',
          message: `modules[${i}] missing name or layer`,
        },
      };
    }

    normalized.push({
      name,
      layer,
      sub_layer: (m.sub_layer as string | null | undefined) ?? null,
      format: typeof m.format === 'string' ? m.format : undefined,
      one_liner,
      responsibilities: toStringArray(m.responsibilities),
      NOT_responsible_for: toStringArray(m.NOT_responsible_for),
      typical_business_terms: toStringArray(m.typical_business_terms),
      easily_confused_with: toEasilyConfusedArray(m.easily_confused_with),
      key_exports: toStringArray(m.key_exports),
      entry_file: typeof m.entry_file === 'string' ? m.entry_file : '',
    });
  }

  return {
    ok: true,
    catalog: {
      schema_version: String(root.schema_version ?? '1.0'),
      modules: normalized,
    },
  };
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

function toEasilyConfusedArray(value: unknown): EasilyConfusedEntry[] {
  if (!Array.isArray(value)) return [];
  const out: EasilyConfusedEntry[] = [];
  for (const entry of value) {
    if (entry && typeof entry === 'object') {
      const e = entry as Record<string, unknown>;
      const module = typeof e.module === 'string' ? e.module : '';
      const disambiguation = typeof e.disambiguation === 'string' ? e.disambiguation : '';
      // 不再丢弃 module 为空的条目——`easily_confused_no_self_reference` BLOCKER 检查
      // 需要看见空字段才能报告。`easily_confused_references_exist` 自行跳过空 module。
      out.push({ module, disambiguation });
    }
  }
  return out;
}

// --------------------------------------------------------------------------
// 查询
// --------------------------------------------------------------------------

export function findModule(catalog: ModuleCatalog, name: string): ModuleCard | undefined {
  return catalog.modules.find(m => m.name === name);
}

export function hasModule(catalog: ModuleCatalog, name: string): boolean {
  return catalog.modules.some(m => m.name === name);
}

export function allModuleNames(catalog: ModuleCatalog): string[] {
  return catalog.modules.map(m => m.name);
}

/**
 * 按业务术语反查模块：
 *  - exactHits: 术语精确出现在 typical_business_terms 里的模块
 *  - fuzzyHits: 术语作为子串出现在 typical_business_terms / one_liner / responsibilities 里的模块
 *  - confusedHits: 术语命中其他模块的 easily_confused_with（提示模型警惕）
 */
export interface TermLookupResult {
  term: string;
  exactHits: ModuleCard[];
  fuzzyHits: ModuleCard[];
  confusedHits: Array<{ fromModule: string; entry: EasilyConfusedEntry }>;
}

export function findModulesByTerm(catalog: ModuleCatalog, term: string): TermLookupResult {
  const trimmed = term.trim();
  const exactHits: ModuleCard[] = [];
  const fuzzyHits: ModuleCard[] = [];
  const confusedHits: Array<{ fromModule: string; entry: EasilyConfusedEntry }> = [];

  if (!trimmed) {
    return { term: trimmed, exactHits, fuzzyHits, confusedHits };
  }

  for (const m of catalog.modules) {
    const terms = m.typical_business_terms;
    if (terms.some(t => t === trimmed)) {
      exactHits.push(m);
      continue;
    }
    const appearsInFuzzy =
      terms.some(t => t.includes(trimmed) || trimmed.includes(t)) ||
      m.one_liner.includes(trimmed) ||
      m.responsibilities.some(r => r.includes(trimmed));
    if (appearsInFuzzy) fuzzyHits.push(m);

    for (const ec of m.easily_confused_with) {
      if (
        ec.disambiguation.includes(trimmed) ||
        terms.some(t => ec.disambiguation.includes(t))
      ) {
        confusedHits.push({ fromModule: m.name, entry: ec });
      }
    }
  }

  return { term: trimmed, exactHits, fuzzyHits, confusedHits };
}

// --------------------------------------------------------------------------
// 错误描述
// --------------------------------------------------------------------------

export function describeCatalogError(err: CatalogLoadError): string {
  switch (err.kind) {
    case 'file_not_found':
      return `未找到模块画像文件 ${err.path}（请先创建）`;
    case 'invalid_yaml':
      return `模块画像 YAML 解析失败: ${err.message}`;
    case 'invalid_schema':
      return `模块画像 schema 错误: ${err.message}`;
  }
}
