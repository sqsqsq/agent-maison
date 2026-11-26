// ============================================================================
// Extensions 阶段 — 校验 doc/extensions/manifest.yaml（实例扩展）
// ============================================================================

import type { PhaseChecker, CheckContext, CheckResult } from './utils/types';
import { inspectInstanceExtensions } from './utils/extension-inspect';
import { detectRepoLayout } from '../repo-layout';

const FRAMEWORK_DIR = detectRepoLayout(__dirname).frameworkRoot;

export const checker: PhaseChecker = {
  phase: 'extensions',
  async check(ctx: CheckContext): Promise<CheckResult[]> {
    const inspection = inspectInstanceExtensions(ctx.projectRoot, ctx.frameworkRoot ?? FRAMEWORK_DIR);
    const results: CheckResult[] = [];

    if (inspection.manifestErrors.length === 0) {
      results.push({
        id: 'extension_manifest_ok',
        category: 'structure',
        description: '实例扩展 manifest 校验通过（或无 manifest / 空扩展目录）',
        severity: 'MINOR',
        status: 'PASS',
        details: inspection.manifest
          ? `manifest=${inspection.manifest}`
          : inspection.extensionRoot
            ? `扩展目录存在但未提供 manifest.yaml（跳过 provides）`
            : '未检测到实例扩展目录（零影响）',
      });
    } else for (const e of inspection.manifestErrors) {
      results.push({
        id: `extension_manifest_${e.code}`,
        category: 'structure',
        description: `扩展 manifest / provides 校验失败：${e.message}`,
        severity: 'BLOCKER',
        status: 'FAIL',
        details: [e.message, e.path ?? '', inspection.manifest ?? ''].filter(Boolean).join('\n'),
      });
    }
    for (const finding of inspection.findings) results.push({
      id: finding.code,
      category: 'structure',
      description: finding.message,
      severity: 'MINOR',
      status: 'FAIL',
      details: finding.path ?? finding.message,
      suggestion: '运行 /extension materialize 刷新桥接，或修正 manifest 与目录声明。',
    });
    return results;
  },
};

export default checker;
