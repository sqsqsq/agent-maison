// ============================================================================
// plan · visual-parity.yaml 覆盖守门
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';
import type { CheckContext, CheckResult } from '../../../harness/scripts/utils/types';
import { relFeatureArtifact, relFeatureFile, featureFilePath } from '../../../harness/config';
import {
  UI_CHANGE_REQUIRES_UI_SPEC,
  loadUiSpecFile,
  parseUiChangeFromSpecMarkdown,
  structureFailOrWarn,
  uiSpecAbsPath,
  visualParityAbsPath,
  flattenResourceKeyEntries,
  collectP0ComponentNodeIds,
  type VisualEnforcementMode,
} from '../../../harness/scripts/utils/ui-spec-shared';
import { shapeName, takeArray } from '../../../harness/scripts/utils/shape-guards';

const requireHarness = createRequire(path.resolve(__dirname, '../../../harness/harness-runner.ts'));
const YAML = requireHarness('yaml') as { parse: (s: string) => unknown };

function ruleDesc(ctx: CheckContext): string {
  const checks = ctx.phaseRule.structure_checks as Record<string, { description: string }>;
  return checks?.visual_parity_coverage?.description?.trim() ?? 'visual_parity_coverage';
}

interface VisualParityDoc {
  mappings?: {
    assets?: Array<{ ui_spec_key: string; contract_resource_key?: string }>;
    tokens?: Array<{ ui_spec_key: string; contract_resource_key?: string }>;
    components?: Array<{ ui_spec_node_id?: string; contract_component?: string }>;
  };
}

export function checkVisualParityCoverage(ctx: CheckContext): CheckResult[] {
  const desc = ruleDesc(ctx);
  const planRel = relFeatureArtifact(ctx.projectRoot, ctx.feature, 'plan.md');
  const vpRel = relFeatureFile(ctx.projectRoot, ctx.feature, 'plan/visual-parity.yaml');

  const specPath = featureFilePath(ctx.projectRoot, ctx.feature, path.join('spec', 'spec.md'));
  if (!fs.existsSync(specPath)) return [];
  const specMd = fs.readFileSync(specPath, 'utf-8');
  const uiChange = parseUiChangeFromSpecMarkdown(specMd);
  if (!uiChange || !UI_CHANGE_REQUIRES_UI_SPEC.has(uiChange)) {
    return [];
  }

  const enforcement = ctx.visualParityEnforcement as VisualEnforcementMode | undefined;
  if (enforcement === 'off') {
    return [{
      id: 'visual_parity_coverage',
      category: 'structure',
      description: desc,
      severity: 'MINOR',
      status: 'SKIP',
      details: 'visual_parity_enforcement=off',
      affected_files: [vpRel],
    }];
  }

  const uiDoc = loadUiSpecFile(uiSpecAbsPath(ctx.projectRoot, ctx.feature));
  const vpAbs = visualParityAbsPath(ctx.projectRoot, ctx.feature);
  if (!fs.existsSync(vpAbs)) {
    const { severity, status } = structureFailOrWarn(enforcement);
    return [{
      id: 'visual_parity_coverage',
      category: 'structure',
      description: desc,
      severity,
      status,
      details: `${vpRel} 不存在；plan Step 7 须产出 visual-parity.yaml。`,
      affected_files: [planRel, vpRel],
    }];
  }

  let vpDoc: VisualParityDoc;
  try {
    const parsed = YAML.parse(fs.readFileSync(vpAbs, 'utf-8')) as VisualParityDoc | null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not a mapping document');
    }
    vpDoc = parsed;
  } catch {
    const { severity, status } = structureFailOrWarn(enforcement);
    return [{
      id: 'visual_parity_coverage',
      category: 'structure',
      description: desc,
      severity,
      status,
      details: `${vpRel} YAML 解析失败或根节点不是映射（map）`,
      affected_files: [vpRel],
    }];
  }

  const issues: string[] = [];

  // P0-2（plan d9b4f7e2，07-13 现场 :142 `(x ?? []).map is not a function` 实锤）：
  // mappings.* 非数组真值（{}/"" 等）→ 归一为空数组 + 形状留痕进 issues（结构化 FAIL，
  // 不静默洗形状）；mappings 自身非 map 同理。
  {
    const shapeIssues: string[] = [];
    const vr = vpDoc as unknown as Record<string, unknown>;
    if (vr.mappings !== undefined && (vr.mappings === null || typeof vr.mappings !== 'object' || Array.isArray(vr.mappings))) {
      shapeIssues.push(`mappings 应为映射（YAML map），实际是 ${shapeName(vr.mappings)}——最小合法样例：\`mappings: {assets: [], tokens: [], components: []}\``);
      vr.mappings = {};
    }
    const mr = (vr.mappings ?? {}) as Record<string, unknown>;
    if (mr.assets !== undefined) mr.assets = takeArray(mr.assets, 'mappings.assets', shapeIssues);
    if (mr.tokens !== undefined) mr.tokens = takeArray(mr.tokens, 'mappings.tokens', shapeIssues);
    if (mr.components !== undefined) mr.components = takeArray(mr.components, 'mappings.components', shapeIssues);
    for (const si of shapeIssues) issues.push(`shape: ${si}`);
  }
  const assetKeys = new Set((uiDoc?.assets ?? []).map(a => a.key));
  const tokenKeys = new Set(Object.keys(uiDoc?.tokens ?? {}));
  const mappedAssets = new Set((vpDoc.mappings?.assets ?? []).map(a => a.ui_spec_key));
  const mappedTokens = new Set((vpDoc.mappings?.tokens ?? []).map(t => t.ui_spec_key));

  for (const k of assetKeys) {
    if (!mappedAssets.has(k)) issues.push(`ui-spec asset ${k} 未在 visual-parity.yaml 映射`);
  }
  for (const k of tokenKeys) {
    if (!mappedTokens.has(k)) issues.push(`ui-spec token ${k} 未在 visual-parity.yaml 映射`);
  }

  for (const m of vpDoc.mappings?.assets ?? []) {
    if (!m.contract_resource_key?.trim()) {
      issues.push(`visual-parity asset ${m.ui_spec_key} 缺 contract_resource_key`);
    }
  }
  for (const m of vpDoc.mappings?.tokens ?? []) {
    if (!m.contract_resource_key?.trim()) {
      issues.push(`visual-parity token ${m.ui_spec_key} 缺 contract_resource_key`);
    }
  }

  const p0NodeIds = uiDoc ? collectP0ComponentNodeIds(uiDoc) : [];
  const mappedComponents = new Set(
    (vpDoc.mappings?.components ?? [])
      .map(c => c.ui_spec_node_id)
      .filter(Boolean) as string[],
  );
  for (const nodeId of p0NodeIds) {
    if (!mappedComponents.has(nodeId)) {
      issues.push(`P0 节点 ${nodeId} 未在 visual-parity.yaml components 映射`);
    }
  }
  for (const m of vpDoc.mappings?.components ?? []) {
    if (!m.ui_spec_node_id?.trim()) {
      issues.push('visual-parity components 项缺 ui_spec_node_id');
    }
    if (!m.contract_component?.trim()) {
      issues.push(`visual-parity component ${m.ui_spec_node_id ?? '?'} 缺 contract_component`);
    }
  }

  const contractKeys = new Set(flattenResourceKeyEntries(ctx.featureSpec.contracts?.resource_keys).map(r => r.key));
  const contractComponents = new Set(
    (ctx.featureSpec.contracts?.components ?? [])
      .map(c => c.name)
      .filter(Boolean) as string[],
  );
  for (const m of vpDoc.mappings?.assets ?? []) {
    if (m.contract_resource_key && contractKeys.size > 0 && !contractKeys.has(m.contract_resource_key)) {
      issues.push(`visual-parity asset 映射 ${m.contract_resource_key} 不在 contracts.resource_keys`);
    }
  }
  for (const m of vpDoc.mappings?.tokens ?? []) {
    if (m.contract_resource_key && contractKeys.size > 0 && !contractKeys.has(m.contract_resource_key)) {
      issues.push(`visual-parity token 映射 ${m.contract_resource_key} 不在 contracts.resource_keys`);
    }
  }
  for (const m of vpDoc.mappings?.components ?? []) {
    if (m.contract_component && contractComponents.size > 0 && !contractComponents.has(m.contract_component)) {
      issues.push(`visual-parity component ${m.contract_component} 不在 contracts.components`);
    }
  }

  if (issues.length > 0) {
    const { severity, status } = structureFailOrWarn(enforcement);
    return [{
      id: 'visual_parity_coverage',
      category: 'structure',
      description: desc,
      severity,
      status,
      details: issues.join('；'),
      affected_files: [vpRel, relFeatureFile(ctx.projectRoot, ctx.feature, 'contracts.yaml')],
    }];
  }

  return [{
    id: 'visual_parity_coverage',
    category: 'structure',
    description: desc,
    severity: 'BLOCKER',
    status: 'PASS',
    details: `ui-spec assets/tokens 均已映射到 visual-parity.yaml（assets=${assetKeys.size} tokens=${tokenKeys.size}）`,
    affected_files: [vpRel],
  }];
}
