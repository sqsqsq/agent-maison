// ============================================================================
// HAR · entry_file 与 oh-package main 一致性（hmos-app）
// ============================================================================

import type { CheckContext, CheckResult } from '../../../harness/scripts/utils/types';
import type { ModuleCatalog } from '../../../harness/scripts/utils/catalog-parser';
import { loadFrameworkConfig, relCatalog } from '../../../harness/config';
import { normalizeRelativePath, resolveHarExportEntryPath } from './har-export-resolve';

function ruleDesc(ctx: CheckContext, id: string): string {
  const checks = ctx.phaseRule.traceability_checks as Record<string, { description?: string }> | undefined;
  return checks?.[id]?.description?.trim() ?? id;
}

export function checkEntryFileMatchesOhPackageMain(
  ctx: CheckContext,
  catalog: ModuleCatalog,
): CheckResult[] {
  const cfg = loadFrameworkConfig(ctx.projectRoot);
  const indexFileName = cfg.architecture.cross_module_exports_file;
  const mismatches: string[] = [];
  const affected = new Set<string>([relCatalog(ctx.projectRoot)]);

  for (const m of catalog.modules) {
    if (m.format !== 'HAR') continue;
    if (!m.entry_file) continue;

    const packagePath = `${m.layer}/${m.name}`;
    const resolved = resolveHarExportEntryPath(
      ctx.projectRoot,
      { name: m.name, package_path: packagePath },
      indexFileName,
    );
    const expected = normalizeRelativePath(resolved.relPath);
    const actual = normalizeRelativePath(m.entry_file);
    if (expected !== actual) {
      mismatches.push(`${m.name}: catalog=${actual}，oh-package 解析期望=${expected}`);
      affected.add(m.entry_file);
    }
  }

  if (mismatches.length === 0) {
    return [{
      id: 'entry_file_matches_oh_package_main',
      category: 'traceability',
      description: ruleDesc(ctx, 'entry_file_matches_oh_package_main'),
      severity: 'MAJOR',
      status: 'PASS',
      details: '所有 HAR 模块 entry_file 与 oh-package.json5 main 解析路径一致。',
    }];
  }

  return [{
    id: 'entry_file_matches_oh_package_main',
    category: 'traceability',
    description: ruleDesc(ctx, 'entry_file_matches_oh_package_main'),
    severity: 'MAJOR',
    status: 'WARN',
    details: `${mismatches.length} 个模块 entry_file 与 oh-package main 漂移：\n  - ${mismatches.join('\n  - ')}`,
    suggestion:
      '对每个漂移模块 <M> 跑 `/catalog-bootstrap <M>` 进入 UPDATE 模式刷新 entry_file；\n' +
      '或修正 oh-package.json5 main 与 catalog 保持一致。',
    affected_files: Array.from(affected),
  }];
}
