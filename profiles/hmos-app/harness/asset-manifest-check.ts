// ============================================================================
// asset-manifest-check.ts — P1-2 素材需求清单 + 占位显式化
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';
import type { CheckContext, CheckResult } from '../../../harness/scripts/utils/types';
import { relFeatureArtifact } from '../../../harness/config';
import {
  assetManifestAbsPath,
  fidelityRatchetFailOrWarn,
  isPixel1to1,
} from '../../../harness/scripts/utils/fidelity-shared';
import {
  collectAllComponentNodes,
  loadUiSpecFile,
  parseUiChangeFromSpecMarkdown,
  UI_CHANGE_REQUIRES_UI_SPEC,
  uiSpecAbsPath,
  uiSpecRelPath,
} from '../../../harness/scripts/utils/ui-spec-shared';

const requireHarness = createRequire(path.resolve(__dirname, '../../../harness/harness-runner.ts'));
const YAML = requireHarness('yaml') as { parse: (s: string) => unknown };

function ruleDesc(ctx: CheckContext): string {
  const checks = ctx.phaseRule.structure_checks as Record<string, { description: string }>;
  return checks?.asset_manifest?.description?.trim() ?? 'asset_manifest';
}

interface AssetManifestEntry {
  key: string;
  purpose?: string;
  screen_id?: string;
  has_source?: boolean;
}

function collectRequiredArtAssets(uiDoc: ReturnType<typeof loadUiSpecFile>): AssetManifestEntry[] {
  const out: AssetManifestEntry[] = [];
  if (!uiDoc) return out;

  for (const a of uiDoc.assets ?? []) {
    if (!a.key) continue;
    out.push({
      key: a.key,
      purpose: a.rationale,
      has_source: Boolean(a.resolved_path) && !a.placeholder,
    });
  }

  for (const n of collectAllComponentNodes(uiDoc)) {
    const kind = n.icon?.kind;
    if (kind === 'brand_logo' || kind === 'illustration') {
      const key = n.icon?.ref ?? n.asset_ref ?? n.id ?? `${n.type}_icon`;
      out.push({
        key,
        purpose: `${kind} node=${n.id ?? n.type}`,
        screen_id: undefined,
        has_source: Boolean(n.asset_ref),
      });
    }
  }

  const seen = new Set<string>();
  return out.filter(e => {
    if (seen.has(e.key)) return false;
    seen.add(e.key);
    return true;
  });
}

export function checkAssetManifest(ctx: CheckContext): CheckResult[] {
  const specMdPath = path.join(ctx.projectRoot, 'doc', 'features', ctx.feature, 'spec', 'spec.md');
  if (!fs.existsSync(specMdPath)) return [];
  const specMd = fs.readFileSync(specMdPath, 'utf-8');
  const uiChange = parseUiChangeFromSpecMarkdown(specMd);
  if (!uiChange || !UI_CHANGE_REQUIRES_UI_SPEC.has(uiChange)) {
    return [];
  }

  const desc = ruleDesc(ctx);
  const manifestRel = relFeatureArtifact(ctx.projectRoot, ctx.feature, 'asset-manifest.yaml');
  const manifestAbs = assetManifestAbsPath(ctx.projectRoot, ctx.feature);
  const uiSpecRel = uiSpecRelPath(ctx.projectRoot, ctx.feature);
  const uiDoc = loadUiSpecFile(uiSpecAbsPath(ctx.projectRoot, ctx.feature));
  if (!uiDoc) return [];

  const placeholders = (uiDoc.assets ?? []).filter(a => a.placeholder);
  const required = collectRequiredArtAssets(uiDoc);
  const results: CheckResult[] = [];

  if (isPixel1to1(ctx) && placeholders.length > 0) {
    const { severity, status } = fidelityRatchetFailOrWarn(ctx, true);
    results.push({
      id: 'asset_placeholder_manifest',
      category: 'structure',
      description: desc,
      severity,
      status,
      details: [
        `pixel_1to1 下占位资产 ${placeholders.length} 项（须显式决策，不得静默占位）`,
        placeholders.slice(0, 8).map(a => a.key).join(', '),
        'framework 拒绝 AI 生成缺失 logo/插画；须提供 user_dir 素材或登记 defer。',
      ].join('\n'),
      affected_files: [uiSpecRel, manifestRel],
    });
  }

  const effectiveMode = ctx.effectiveAssetAcquisitionMode ?? 'approximate';
  if (effectiveMode === 'user_dir' && !fs.existsSync(manifestAbs)) {
    const { severity, status } = fidelityRatchetFailOrWarn(ctx, !isPixel1to1(ctx));
    results.push({
      id: 'asset_manifest',
      category: 'structure',
      description: desc,
      severity,
      status,
      details: `effective asset mode=user_dir 须产出 ${manifestRel}（${required.length} 项美术资产待供给）`,
      suggestion: '从 ui-spec assets + brand_logo/illustration 节点盘点，反馈用户素材目录约定',
      affected_files: [manifestRel, uiSpecRel],
    });
    return results;
  }

  if (fs.existsSync(manifestAbs)) {
    try {
      const raw = YAML.parse(fs.readFileSync(manifestAbs, 'utf-8')) as { assets?: AssetManifestEntry[] };
      const listed = Array.isArray(raw?.assets) ? raw.assets.length : 0;
      results.push({
        id: 'asset_manifest',
        category: 'structure',
        description: desc,
        severity: 'BLOCKER',
        status: 'PASS',
        details: `${manifestRel} 已登记 ${listed} 项；ui-spec 需 ${required.length} 项美术相关资产`,
        affected_files: [manifestRel],
      });
    } catch (e) {
      results.push({
        id: 'asset_manifest',
        category: 'structure',
        description: desc,
        severity: 'MAJOR',
        status: 'FAIL',
        details: `${manifestRel} 解析失败：${(e as Error).message}`,
        affected_files: [manifestRel],
      });
    }
  }

  return results;
}
