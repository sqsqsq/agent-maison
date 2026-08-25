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
  const uiDoc = loadUiSpecFile(uiSpecAbsPath(ctx.projectRoot, ctx.feature));
  const vpAbs = visualParityAbsPath(ctx.projectRoot, ctx.feature);

  // plan e6b3f8d2 t3⑤：**产品所有权子集是硬地板**——UI feature 的 P0 节点必须能追到
  // 宿主自己的产品组件（visual-parity.contract_component → contracts.components →
  // contracts.files）。这一子集**不受 `visual_parity_enforcement=warn|reachable|off`
  // 降级**：它回答的是「这个 UI 归谁实现、代码在哪」这一所有权/可追溯性问题，不是
  // 视觉质量问题。assets/tokens/结构相似度等**视觉质量项**照旧遵守 enforcement。
  //
  // 为什么必须硬：撤销强制 Maison UI kit 后，盲档视觉地板改由本链承接；而本链此前
  // 结构上不是地板——宿主默认 `warn` 只出 MAJOR/WARN、`off` 在映射检查前整体 SKIP、
  // `contracts.components` 为空反而跳过存在性检查、且从无 `file ∈ contracts.files` 校验。
  const ownershipIssues: string[] = [];
  const qualityIssues: string[] = [];
  const enforcementOff = enforcement === 'off';

  if (!fs.existsSync(vpAbs)) {
    // visual-parity.yaml 缺失 = 所有权链整条不存在。P0 UI 节点在场时属硬地板缺口
    //（enforcement 不得降级）；无 P0 节点时才回落既有档位语义。
    const p0Missing = uiDoc ? collectP0ComponentNodeIds(uiDoc) : [];
    if (p0Missing.length > 0) {
      return [{
        id: 'visual_parity_coverage',
        category: 'structure',
        description: desc,
        severity: 'BLOCKER',
        status: 'FAIL',
        details:
          `${vpRel} 不存在，但 ui-spec 声明了 ${p0Missing.length} 个 P0 组件节点——` +
          '产品组件所有权链缺失（P0 节点→contract_component→contracts.components/files），' +
          `不受 visual_parity_enforcement=${enforcement ?? 'default'} 降级。plan Step 7 须产出 visual-parity.yaml。`,
        affected_files: [planRel, vpRel],
        suggestion:
          'UI feature 的每个 P0 节点都要能追到宿主自己的产品组件：plan Step 7 产出 '
          + 'visual-parity.yaml，components[].contract_component → contracts.yaml components[].name，'
          + '该组件的 file 须列入 contracts.files。framework 不规定组件如何实现，只要求所有权与源文件可追溯。',
      }];
    }
    if (enforcementOff) {
      return [{
        id: 'visual_parity_coverage',
        category: 'structure',
        description: desc,
        severity: 'MINOR',
        status: 'SKIP',
        details: 'visual_parity_enforcement=off（且 ui-spec 无 P0 组件节点，无所有权地板可判）',
        affected_files: [vpRel],
      }];
    }
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
    const p0Broken = uiDoc ? collectP0ComponentNodeIds(uiDoc) : [];
    if (p0Broken.length > 0) {
      return [{
        id: 'visual_parity_coverage',
        category: 'structure',
        description: desc,
        severity: 'BLOCKER',
        status: 'FAIL',
        details:
          `${vpRel} YAML 解析失败或根节点不是映射（map）——` +
          'P0 组件所有权链不可读即视同缺失（硬地板，不受 enforcement 降级）',
        affected_files: [vpRel],
        suggestion:
          '修正 visual-parity.yaml 为合法 YAML 映射（最小合法样例：'
          + '`mappings: {assets: [], tokens: [], components: []}`），再补齐 P0 节点 → contract_component 映射。',
      }];
    }
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

  // 视觉质量项（遵守 enforcement）；所有权子集另记 ownershipIssues（不受降级）。
  const issues = qualityIssues;

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

  // ---- 所有权子集①：UI feature 的 P0 节点必须映射并带 contract_component ----
  const p0NodeIds = uiDoc ? collectP0ComponentNodeIds(uiDoc) : [];
  const p0NodeIdSet = new Set(p0NodeIds);
  const componentMappings = vpDoc.mappings?.components ?? [];
  const componentByNode = new Map<string, { ui_spec_node_id?: string; contract_component?: string }>();
  for (const m of componentMappings) {
    const nodeId = m.ui_spec_node_id?.trim();
    if (nodeId) componentByNode.set(nodeId, m);
  }
  for (const nodeId of p0NodeIds) {
    const mapped = componentByNode.get(nodeId);
    if (!mapped) {
      ownershipIssues.push(`P0 节点 ${nodeId} 未在 visual-parity.yaml components 映射`);
    } else if (!mapped.contract_component?.trim()) {
      ownershipIssues.push(`P0 节点 ${nodeId} 的 visual-parity 映射缺 contract_component`);
    }
  }
  for (const m of componentMappings) {
    if (!m.ui_spec_node_id?.trim()) {
      issues.push('visual-parity components 项缺 ui_spec_node_id');
    }
    if (!m.contract_component?.trim()) {
      issues.push(`visual-parity component ${m.ui_spec_node_id ?? '?'} 缺 contract_component`);
    }
  }

  const contractKeys = new Set(flattenResourceKeyEntries(ctx.featureSpec.contracts?.resource_keys).map(r => r.key));
  const contractComponentEntries = ctx.featureSpec.contracts?.components ?? [];
  const contractComponents = new Set(
    contractComponentEntries.map(c => c.name).filter(Boolean) as string[],
  );
  const contractComponentFile = new Map<string, string | undefined>(
    contractComponentEntries.map(c => [c.name, c.file] as [string, string | undefined]),
  );
  const contractFiles = new Set(
    (ctx.featureSpec.contracts?.files ?? [])
      .filter((f): f is string => typeof f === 'string' && f.trim().length > 0)
      .map(f => f.trim().replace(/\\/g, '/')),
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
  // ---- 所有权子集②③：**P0 节点引用的**组件必须真实存在于 contracts.components
  //      （空数组也判失败），且其 `file` 必须存在于 contracts.files ----
  // 旧实现用 `contractComponents.size > 0` 作前置：contracts.components 为空反而跳过
  // 存在性检查——「没声明任何组件」于是成了最省事的绕过路径。现在空数组即判失败。
  // plan e6b3f8d2 t3 review：硬地板范围严格止于 P0；P1/非 P0 mapping 的同类陈旧
  // 仍写入 `issues`，按既有 enforcement 处理，不得被升级成档位无关 BLOCKER。
  for (const m of componentMappings) {
    const name = m.contract_component?.trim();
    if (!name) continue;
    const targetIssues = p0NodeIdSet.has(m.ui_spec_node_id?.trim() ?? '')
      ? ownershipIssues
      : issues;
    if (!contractComponents.has(name)) {
      targetIssues.push(
        contractComponentEntries.length === 0
          ? `visual-parity component ${name} 不在 contracts.components（contracts.components 为空数组——组件所有权未声明，不得视为豁免）`
          : `visual-parity component ${name} 不在 contracts.components`,
      );
      continue;
    }
    const file = contractComponentFile.get(name)?.trim();
    if (!file) {
      targetIssues.push(`contracts.components 的 ${name} 缺 file（无法定位实现源文件）`);
    } else if (!contractFiles.has(file.replace(/\\/g, '/'))) {
      targetIssues.push(`contracts.components 的 ${name}.file（${file}）不在 contracts.files`);
    }
  }

  const affected = [vpRel, relFeatureFile(ctx.projectRoot, ctx.feature, 'contracts.yaml')];

  // 所有权硬地板优先：命中即 BLOCKER FAIL，**任何 enforcement 档位都不降级**。
  if (ownershipIssues.length > 0) {
    return [{
      id: 'visual_parity_coverage',
      category: 'structure',
      description: desc,
      severity: 'BLOCKER',
      status: 'FAIL',
      details: [
        `【产品组件所有权（硬地板，不受 visual_parity_enforcement=${enforcement ?? 'default'} 降级）】`,
        ...ownershipIssues.map(x => `  - ${x}`),
        ...(issues.length > 0 ? ['【视觉质量项（遵守 enforcement）】', ...issues.map(x => `  - ${x}`)] : []),
      ].join('\n'),
      affected_files: affected,
      suggestion:
        'UI feature 的每个 P0 节点都要能追到宿主自己的产品组件：visual-parity.yaml ' +
        'components[].contract_component → contracts.yaml components[].name → 该组件的 file ' +
        '须列入 contracts.files。framework 不规定组件如何实现，只要求所有权与源文件可追溯。',
    }];
  }

  // 视觉质量项：照旧遵守 enforcement（off 时下方直接 SKIP）。
  if (enforcementOff) {
    return [{
      id: 'visual_parity_coverage',
      category: 'structure',
      description: desc,
      severity: 'MINOR',
      status: 'SKIP',
      details: `visual_parity_enforcement=off（产品组件所有权硬地板已校验通过，P0 节点=${p0NodeIds.length}）`,
      affected_files: [vpRel],
    }];
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
      affected_files: affected,
    }];
  }

  return [{
    id: 'visual_parity_coverage',
    category: 'structure',
    description: desc,
    severity: 'BLOCKER',
    status: 'PASS',
    details:
      `产品组件所有权链完整（P0 节点=${p0NodeIds.length} → contract_component → contracts.components/files）；` +
      `ui-spec assets/tokens 均已映射到 visual-parity.yaml（assets=${assetKeys.size} tokens=${tokenKeys.size}）`,
    affected_files: [vpRel],
  }];
}
