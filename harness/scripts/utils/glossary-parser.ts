// ============================================================================
// Glossary 解析工具
// ============================================================================
// 读取术语表 SSOT（默认 doc/glossary.yaml，实际路径由
// framework.config.json.paths.glossary 决定），提供：
//   - loadGlossary(projectRoot)
//   - lookupTerm(glossary, term): 精确查 + 别名查
//   - allKnownTerms(glossary): 返回所有 term + alias 的扁平列表
//
// 消费者:
//   - framework/harness/scripts/check-prd.ts (terminology_mapping_table BLOCKER)
//   - 未来可用于 skills 的辅助脚本
// ============================================================================

import * as fs from 'fs';
import * as YAML from 'yaml';
import { glossaryPath, relGlossary } from '../../config';

// --------------------------------------------------------------------------
// 类型
// --------------------------------------------------------------------------

export interface GlossaryConfusionEntry {
  term: string;
  module: string;
  disambiguation: string;
}

export interface GlossaryTerm {
  term: string;
  canonical_module: string;
  owner_layer: string;
  aliases: string[];
  sample_usage?: string;
  confidence_hint?: string;
  easily_confused_with: GlossaryConfusionEntry[];
}

export interface Glossary {
  schema_version: string;
  terms: GlossaryTerm[];
}

export type GlossaryLoadError =
  | { kind: 'file_not_found'; path: string }
  | { kind: 'invalid_yaml'; message: string }
  | { kind: 'invalid_schema'; message: string };

// --------------------------------------------------------------------------
// 加载
// --------------------------------------------------------------------------

/**
 * @deprecated 阶段 3：实际路径从 framework.config.json 读取。本常量仅用于
 * 向后兼容；新代码请改用 `relGlossary(projectRoot)`。
 */
export const GLOSSARY_RELATIVE_PATH = 'doc/glossary.yaml';

export function loadGlossary(
  projectRoot: string,
): { ok: true; glossary: Glossary } | { ok: false; error: GlossaryLoadError } {
  const fullPath = glossaryPath(projectRoot);
  const relPath = relGlossary(projectRoot);

  if (!fs.existsSync(fullPath)) {
    return { ok: false, error: { kind: 'file_not_found', path: relPath } };
  }

  let raw: string;
  try {
    raw = fs.readFileSync(fullPath, 'utf-8');
  } catch {
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
  const termsRaw = root.terms;
  if (!Array.isArray(termsRaw)) {
    return {
      ok: false,
      error: { kind: 'invalid_schema', message: 'terms must be an array' },
    };
  }

  const terms: GlossaryTerm[] = [];
  for (let i = 0; i < termsRaw.length; i++) {
    const t = termsRaw[i] as Record<string, unknown> | undefined;
    if (!t || typeof t !== 'object') {
      return {
        ok: false,
        error: { kind: 'invalid_schema', message: `terms[${i}] must be an object` },
      };
    }

    const term = typeof t.term === 'string' ? t.term : '';
    const canonical_module =
      typeof t.canonical_module === 'string' ? t.canonical_module : '';
    const owner_layer = typeof t.owner_layer === 'string' ? t.owner_layer : '';

    if (!term || !canonical_module) {
      return {
        ok: false,
        error: {
          kind: 'invalid_schema',
          message: `terms[${i}] missing term or canonical_module`,
        },
      };
    }

    terms.push({
      term,
      canonical_module,
      owner_layer,
      aliases: toStringArray(t.aliases),
      sample_usage: typeof t.sample_usage === 'string' ? t.sample_usage : undefined,
      confidence_hint: typeof t.confidence_hint === 'string' ? t.confidence_hint : undefined,
      easily_confused_with: toConfusionArray(t.easily_confused_with),
    });
  }

  return {
    ok: true,
    glossary: {
      schema_version: String(root.schema_version ?? '1.0'),
      terms,
    },
  };
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

function toConfusionArray(value: unknown): GlossaryConfusionEntry[] {
  if (!Array.isArray(value)) return [];
  const out: GlossaryConfusionEntry[] = [];
  for (const entry of value) {
    if (entry && typeof entry === 'object') {
      const e = entry as Record<string, unknown>;
      const term = typeof e.term === 'string' ? e.term : '';
      const module = typeof e.module === 'string' ? e.module : '';
      const disambiguation = typeof e.disambiguation === 'string' ? e.disambiguation : '';
      if (term && module) out.push({ term, module, disambiguation });
    }
  }
  return out;
}

// --------------------------------------------------------------------------
// 查询
// --------------------------------------------------------------------------

export interface TermMatch {
  term: GlossaryTerm;
  matched_as: 'exact' | 'alias';
  matched_text: string;
}

export function lookupTerm(glossary: Glossary, query: string): TermMatch | undefined {
  const q = query.trim();
  if (!q) return undefined;

  for (const t of glossary.terms) {
    if (t.term === q) return { term: t, matched_as: 'exact', matched_text: q };
  }
  for (const t of glossary.terms) {
    for (const alias of t.aliases) {
      if (alias === q) return { term: t, matched_as: 'alias', matched_text: alias };
    }
  }
  return undefined;
}

export function allKnownTerms(glossary: Glossary): string[] {
  const set = new Set<string>();
  for (const t of glossary.terms) {
    set.add(t.term);
    for (const a of t.aliases) set.add(a);
  }
  return Array.from(set);
}

// --------------------------------------------------------------------------
// 错误描述
// --------------------------------------------------------------------------

export function describeGlossaryError(err: GlossaryLoadError): string {
  switch (err.kind) {
    case 'file_not_found':
      return `未找到术语表文件 ${err.path}（请先创建）`;
    case 'invalid_yaml':
      return `术语表 YAML 解析失败: ${err.message}`;
    case 'invalid_schema':
      return `术语表 schema 错误: ${err.message}`;
  }
}
