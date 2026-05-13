// ============================================================================
// Extensions 阶段 — 校验 doc/extensions/manifest.yaml（实例扩展）
// ============================================================================

import type { PhaseChecker, CheckContext, CheckResult } from './utils/types';
import { loadFrameworkConfig } from '../config';
import { loadInstanceExtensions } from '../extension-loader';

export const checker: PhaseChecker = {
  phase: 'extensions',
  async check(ctx: CheckContext): Promise<CheckResult[]> {
    const fw = loadFrameworkConfig(ctx.projectRoot);
    const bundle = loadInstanceExtensions(ctx.projectRoot, fw.paths?.extension_dir);
    const results: CheckResult[] = [];

    if (bundle.errors.length === 0) {
      results.push({
        id: 'extension_manifest_ok',
        category: 'structure',
        description: '实例扩展 manifest 校验通过（或无 manifest / 空扩展目录）',
        severity: 'MINOR',
        status: 'PASS',
        details: bundle.manifestPath
          ? `manifest=${bundle.manifestPath}`
          : bundle.rootDir
            ? `扩展目录存在但未提供 manifest.yaml（跳过 provides）`
            : '未检测到实例扩展目录（零影响）',
      });
      return results;
    }

    for (const e of bundle.errors) {
      results.push({
        id: `extension_manifest_${e.code}`,
        category: 'structure',
        description: `扩展 manifest / provides 校验失败：${e.message}`,
        severity: 'BLOCKER',
        status: 'FAIL',
        details: [e.message, e.path ?? '', bundle.manifestPath ?? ''].filter(Boolean).join('\n'),
      });
    }
    return results;
  },
};

export default checker;
