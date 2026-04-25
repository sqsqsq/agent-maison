// ============================================================================
// doc-freshness.ts — DOC_INVENTORY 加载 & 文档时间戳比对（纯函数为主）
// ============================================================================
// 把"易随框架演进而漂移"的逻辑抽到这里，方便 hdc-runner 那种 unit 测试做白盒：
//   - parseInventory               : YAML 解析 + schema 验证
//   - compareTimestamps            : 给定 docTs / srcTimestamps，判定 fresh/stale/skip
//   - decideStaleness              : 多源仅当任一 src 比 doc 新 → stale
//
// 实际 git log 时间戳读取由调用方（check-docs.ts）注入，避免在单元测试里依赖
// 真实 git 仓库。
// ============================================================================

import * as fs from 'fs';
import * as YAML from 'yaml';

// --------------------------------------------------------------------------
// Inventory schema
// --------------------------------------------------------------------------

export interface DocEntry {
  path: string;
  role: string;
  audience?: string;
  sources: string[];
  update_triggers?: string[];
}

export interface DocInventory {
  schema_version: string;
  docs: DocEntry[];
}

export interface InventoryParseError {
  kind:
    | 'yaml_parse_failed'
    | 'root_not_object'
    | 'missing_schema_version'
    | 'missing_docs'
    | 'docs_not_array'
    | 'doc_missing_path'
    | 'doc_missing_role'
    | 'doc_missing_sources'
    | 'doc_sources_not_array';
  index?: number;
  message: string;
}

export interface InventoryParseResult {
  ok: boolean;
  inventory?: DocInventory;
  errors: InventoryParseError[];
}

/**
 * 解析 + 校验 inventory YAML 文本。
 * 不依赖文件系统、不依赖 git，纯字符串 → 结构 → 校验。
 */
export function parseInventory(yamlText: string): InventoryParseResult {
  const errors: InventoryParseError[] = [];

  let data: unknown;
  try {
    data = YAML.parse(yamlText);
  } catch (err) {
    errors.push({
      kind: 'yaml_parse_failed',
      message: `YAML 解析失败：${(err as Error).message}`,
    });
    return { ok: false, errors };
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    errors.push({ kind: 'root_not_object', message: 'inventory 根必须是对象' });
    return { ok: false, errors };
  }

  const root = data as Record<string, unknown>;

  if (typeof root.schema_version !== 'string' || root.schema_version.length === 0) {
    errors.push({
      kind: 'missing_schema_version',
      message: 'inventory 缺少 schema_version (string)',
    });
  }

  if (!('docs' in root)) {
    errors.push({ kind: 'missing_docs', message: 'inventory 缺少 docs 字段' });
    return { ok: errors.length === 0, errors };
  }
  if (!Array.isArray(root.docs)) {
    errors.push({ kind: 'docs_not_array', message: 'inventory.docs 必须是数组' });
    return { ok: errors.length === 0, errors };
  }

  const docs: DocEntry[] = [];
  root.docs.forEach((raw, idx) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      errors.push({
        kind: 'doc_missing_path',
        index: idx,
        message: `docs[${idx}] 必须是对象`,
      });
      return;
    }
    const item = raw as Record<string, unknown>;
    if (typeof item.path !== 'string' || item.path.length === 0) {
      errors.push({
        kind: 'doc_missing_path',
        index: idx,
        message: `docs[${idx}].path 缺失或非字符串`,
      });
      return;
    }
    if (typeof item.role !== 'string' || item.role.length === 0) {
      errors.push({
        kind: 'doc_missing_role',
        index: idx,
        message: `docs[${idx}] (path=${item.path}) 缺失 role`,
      });
    }
    if (!('sources' in item)) {
      errors.push({
        kind: 'doc_missing_sources',
        index: idx,
        message: `docs[${idx}] (path=${item.path}) 缺失 sources 字段（即使空也要写 []）`,
      });
      return;
    }
    if (!Array.isArray(item.sources)) {
      errors.push({
        kind: 'doc_sources_not_array',
        index: idx,
        message: `docs[${idx}] (path=${item.path}).sources 必须是数组`,
      });
      return;
    }
    const sources = item.sources.filter((s): s is string => typeof s === 'string');
    docs.push({
      path: item.path,
      role: typeof item.role === 'string' ? item.role : '',
      audience: typeof item.audience === 'string' ? item.audience : undefined,
      sources,
      update_triggers: Array.isArray(item.update_triggers)
        ? item.update_triggers.filter((t): t is string => typeof t === 'string')
        : undefined,
    });
  });

  if (errors.length > 0) {
    return { ok: false, errors, inventory: { schema_version: String(root.schema_version), docs } };
  }

  return {
    ok: true,
    errors: [],
    inventory: {
      schema_version: String(root.schema_version),
      docs,
    },
  };
}

// --------------------------------------------------------------------------
// 时间戳比对
// --------------------------------------------------------------------------

export type FreshnessVerdict = 'fresh' | 'stale' | 'skip_no_sources' | 'skip_no_doc_history';

export interface SourceTimestamp {
  path: string;
  /** ISO8601 字符串；undefined / null 表示该路径没有 git 历史（可能是新增未提交） */
  ts: string | null;
  /** path 在仓库中是否存在（对于"过期 inventory 条目"友好提示） */
  exists: boolean;
}

export interface FreshnessReport {
  doc_path: string;
  doc_ts: string | null;
  verdict: FreshnessVerdict;
  /** 比 doc_ts 更新的 source 列表（verdict=stale 时非空） */
  stale_sources: SourceTimestamp[];
  /** 仓库中不存在的 source 列表（仅记录，由调用方决定如何报告） */
  missing_sources: SourceTimestamp[];
  /** 没有 git 历史但存在的 source（新增未提交，比对时按"无穷新"处理） */
  uncommitted_sources: SourceTimestamp[];
}

/**
 * 判定一份文档是否过期。
 *
 * 规则（与 docs-rules.yaml > traceability_checks.doc_freshness 对应）：
 *   1. sources 全空 → skip_no_sources（占位条目，跳过）
 *   2. doc_ts 为 null（doc 自己也没 git 历史） → skip_no_doc_history
 *      （新写的 doc 还没 commit，没法判定）
 *   3. 任一 src.ts 严格大于 doc_ts → stale
 *   4. 任一 src.exists=true 但 ts=null（未提交的源改动）→ stale（视为"无穷新"）
 *   5. 否则 → fresh
 *
 * 不存在的 source（exists=false）不计入 staleness 判定，仅放进 missing_sources。
 */
export function compareTimestamps(
  doc_path: string,
  doc_ts: string | null,
  sources: SourceTimestamp[],
): FreshnessReport {
  const present = sources.filter(s => s.exists);
  const missing = sources.filter(s => !s.exists);

  if (present.length === 0) {
    return {
      doc_path,
      doc_ts,
      verdict: 'skip_no_sources',
      stale_sources: [],
      missing_sources: missing,
      uncommitted_sources: [],
    };
  }

  if (doc_ts === null) {
    return {
      doc_path,
      doc_ts,
      verdict: 'skip_no_doc_history',
      stale_sources: [],
      missing_sources: missing,
      uncommitted_sources: present.filter(s => s.ts === null),
    };
  }

  const docMs = Date.parse(doc_ts);
  const stale: SourceTimestamp[] = [];
  const uncommitted: SourceTimestamp[] = [];

  for (const s of present) {
    if (s.ts === null) {
      uncommitted.push(s);
      continue;
    }
    const sMs = Date.parse(s.ts);
    if (Number.isFinite(sMs) && Number.isFinite(docMs) && sMs > docMs) {
      stale.push(s);
    }
  }

  // 未提交的源改动等同于"无穷新"
  if (stale.length > 0 || uncommitted.length > 0) {
    return {
      doc_path,
      doc_ts,
      verdict: 'stale',
      stale_sources: stale,
      missing_sources: missing,
      uncommitted_sources: uncommitted,
    };
  }

  return {
    doc_path,
    doc_ts,
    verdict: 'fresh',
    stale_sources: [],
    missing_sources: missing,
    uncommitted_sources: [],
  };
}

// --------------------------------------------------------------------------
// 文件系统辅助（IO 层；不在 unit test 里测）
// --------------------------------------------------------------------------

export function loadInventoryFromFile(absPath: string): InventoryParseResult {
  if (!fs.existsSync(absPath)) {
    return {
      ok: false,
      errors: [{
        kind: 'yaml_parse_failed',
        message: `inventory 文件不存在: ${absPath}`,
      }],
    };
  }
  const text = fs.readFileSync(absPath, 'utf-8');
  return parseInventory(text);
}
