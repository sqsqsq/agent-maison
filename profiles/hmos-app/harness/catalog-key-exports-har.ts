// ============================================================================
// HAR · key_exports 与 entry_file 导出入口同步（hmos-app）
// ============================================================================
// 由 check-catalog 在 traceability 段通过 require 加载；仅当 phase-rules overlay
// 声明 key_exports_fresh_vs_index 时调用。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import type { CheckContext, CheckResult } from '../../../harness/scripts/utils/types';
import type { ModuleCatalog } from '../../../harness/scripts/utils/catalog-parser';
import { relCatalog } from '../../../harness/config';
import { isLibraryFormat } from './har-export-resolve';

function ruleDesc(ctx: CheckContext, id: string): string {
  const checks = ctx.phaseRule.traceability_checks as Record<string, { description?: string }> | undefined;
  return checks?.[id]?.description?.trim() ?? id;
}

/**
 * 从 HAR 模块 entry_file（导出入口，如 index.ets）源码里抽取 top-level export 符号集合。
 */
export function extractTopLevelExports(source: string): Set<string> {
  const out = new Set<string>();

  const declRegex =
    /^[\t ]*export[\t ]+(?:default[\t ]+)?(?:class|function|const|let|var|interface|type|enum)[\t ]+([A-Za-z_][A-Za-z0-9_]*)/gm;
  let m: RegExpExecArray | null;
  while ((m = declRegex.exec(source)) !== null) {
    out.add(m[1]);
  }

  const braceRegex = /^[\t ]*export[\t ]*\{([^}]+)\}/gm;
  while ((m = braceRegex.exec(source)) !== null) {
    const raw = m[1];
    for (const item of raw.split(',')) {
      const trimmed = item.trim();
      if (!trimmed) continue;
      const parts = trimmed.split(/\s+as\s+/);
      const exposedName = parts[parts.length - 1].trim();
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(exposedName)) {
        out.add(exposedName);
      }
    }
  }

  return out;
}

export function checkKeyExportsFreshVsIndex(ctx: CheckContext, catalog: ModuleCatalog): CheckResult[] {
  const MAX_CAP = 10;
  const stale: string[] = [];
  const affected = new Set<string>([relCatalog(ctx.projectRoot)]);

  for (const m of catalog.modules) {
    if (!isLibraryFormat(m.format)) continue;
    if (!m.entry_file) continue;

    const entryPath = path.join(ctx.projectRoot, m.entry_file);
    if (!fs.existsSync(entryPath)) continue;

    const source = fs.readFileSync(entryPath, 'utf-8');
    const actual = extractTopLevelExports(source);
    const documented = new Set(m.key_exports || []);

    const removed: string[] = [];
    for (const name of documented) {
      if (!actual.has(name)) removed.push(name);
    }

    let added: string[] = [];
    if (documented.size < MAX_CAP) {
      for (const name of actual) {
        if (!documented.has(name)) added.push(name);
      }
    }

    if (removed.length === 0 && added.length === 0) continue;

    affected.add(m.entry_file);

    const parts: string[] = [];
    if (removed.length > 0) {
      parts.push(`已记录但导出入口中找不到：[${removed.join(', ')}]`);
    }
    if (added.length > 0) {
      const preview = added.slice(0, 5).join(', ');
      const more = added.length > 5 ? ` …共 ${added.length} 个` : '';
      parts.push(
        `导出入口新增但未记录：[${preview}${more}]（当前 key_exports ${documented.size} 条，未达 ${MAX_CAP} 条上限）`,
      );
    }
    stale.push(`${m.name}：${parts.join('；')}`);
  }

  if (stale.length === 0) {
    return [{
      id: 'key_exports_fresh_vs_index',
      category: 'traceability',
      description: ruleDesc(ctx, 'key_exports_fresh_vs_index'),
      severity: 'MAJOR',
      status: 'PASS',
      details: '所有 HAR/HSP 库模块的 key_exports 与导出入口声明的 top-level export 一致。',
    }];
  }

  return [{
    id: 'key_exports_fresh_vs_index',
    category: 'traceability',
    description: ruleDesc(ctx, 'key_exports_fresh_vs_index'),
    severity: 'MAJOR',
    status: 'WARN',
    details: `${stale.length} 个模块的 key_exports 与导出入口漂移：\n  - ${stale.join('\n  - ')}`,
    suggestion:
      '对每个漂移模块 <M> 跑 `/catalog-bootstrap <M>` 进入 UPDATE 模式刷新画像；\n' +
      'catalog-bootstrap Step 5.1.B 会给出字段级 diff，确认后 `y` 替换旧画像。',
    affected_files: Array.from(affected),
  }];
}
