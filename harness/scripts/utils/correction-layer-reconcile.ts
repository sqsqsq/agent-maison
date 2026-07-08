// ============================================================================
// correction-layer-reconcile.ts — C5-full touched_layers 对账
// ============================================================================
// 设计（openspec/changes/correction-routing/design.md「touched_layers 对账」）：
//   只拦"未声明的 touched layer"：声明仅 spec/plan 却出现 code diff → 拦；
//   声明含 coding 的组合修正（改 spec 同轮把代码修到新契约）→ 放行但必须重验 coding 及下游。
// 本模块是启发式文件→phase 分类（首版，覆盖 feature 产物目录内的确定性映射 +
// features_dir 外的粗粒度 coding/ut 判别），不追求 100% 精确——误判后果是多要求
// 声明一个层，而非放过真实越权修改（对账目标是防"悄悄多改"，不是精确考古）。
// ============================================================================

import * as path from 'path';
import { featuresDirPath } from '../../config';

export interface LayerReconcileResult {
  /** 从 diff 推导出的实际触及层（去重）。 */
  actualLayers: string[];
  /** 未在 .current-correction.json 声明但实际触及的层。 */
  undeclared: string[];
  /** 归入某层的文件明细（仅前若干条，供报告展示）。 */
  byLayer: Record<string, string[]>;
}

const FEATURE_ARTIFACT_LAYER_RULES: Array<{ layer: string; test: (rel: string) => boolean }> = [
  { layer: 'spec', test: (rel) => rel === 'spec.md' || rel.startsWith('spec/') || rel === 'acceptance.yaml' },
  { layer: 'change', test: (rel) => rel === 'change.md' },
  { layer: 'plan', test: (rel) => rel === 'plan.md' || rel.startsWith('plan/') || rel === 'contracts.yaml' || rel === 'use-cases.yaml' },
  { layer: 'review', test: (rel) => rel.startsWith('review/') },
  { layer: 'ut', test: (rel) => rel.startsWith('ut/') },
  { layer: 'testing', test: (rel) => rel.startsWith('testing/') },
];

/** features_dir 外的源码文件：路径/文件名含常见测试目录或后缀 → 归 'ut'；否则 'coding'（粗粒度，见文件头说明）。 */
const TEST_PATH_HEURISTIC = /(^|[/\\])(test|tests|ohosTest|__tests__)([/\\]|$)|\.(test|spec)\.[a-z]+$/i;

/** 不归属任何层的中性路径（框架/文档基础设施，与 diff_within_scope 的中性变更处理一致）。 */
const NEUTRAL_PREFIXES = [/^framework\//, /^doc\/(?!features\/)/, /^specs\//, /^openspec\//, /^\.cursor\//];

function classifyOneFile(rel: string, featureRel: string | null): string | null {
  if (NEUTRAL_PREFIXES.some((re) => re.test(rel))) return null;

  if (featureRel && rel.startsWith(`${featureRel}/`)) {
    const inner = rel.slice(featureRel.length + 1);
    for (const rule of FEATURE_ARTIFACT_LAYER_RULES) {
      if (rule.test(inner)) return rule.layer;
    }
    if (inner === 'feature.yaml' || inner.startsWith('context/')) return null; // 治理产物本身，非声明层
    return 'coding'; // feature 目录内但不匹配已知产物（如误落盘源码）——保守归 coding
  }

  return TEST_PATH_HEURISTIC.test(rel) ? 'ut' : 'coding';
}

/**
 * 对账 changedFiles（相对 projectRoot，POSIX 分隔）与声明 touched_layers。
 * `feature` 为 null（no-feature/--adhoc-correction）时全部文件按 coding/ut 粗判，无 spec/plan/change 层。
 */
export function reconcileTouchedLayers(
  projectRoot: string,
  feature: string | null,
  declaredLayers: readonly string[],
  changedFiles: readonly string[],
): LayerReconcileResult {
  const featureRel = feature
    ? path.relative(projectRoot, path.join(featuresDirPath(projectRoot), feature)).replace(/\\/g, '/')
    : null;

  const byLayer: Record<string, string[]> = {};
  for (const rel of changedFiles) {
    const layer = classifyOneFile(rel.replace(/\\/g, '/'), featureRel);
    if (!layer) continue;
    (byLayer[layer] ??= []).push(rel);
  }

  const actualLayers = Object.keys(byLayer).sort();
  const declared = new Set(declaredLayers);
  const undeclared = actualLayers.filter((l) => !declared.has(l));

  return { actualLayers, undeclared, byLayer };
}
