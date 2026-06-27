// ============================================================================
// static-fidelity-score.ts — 静态保真分（ΔE / 文案 / 资产 / 结构顺序）
// ============================================================================
// 明确剔除静态 bbox 几何 IoU（归 device visual_diff）。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import type { CheckContext, CheckResult } from '../../../harness/scripts/utils/types';
import {
  collectCopyTexts,
  flattenResourceKeyEntries,
  type UiSpecDoc,
  uiSpecRelPath,
} from '../../../harness/scripts/utils/ui-spec-shared';
import { deltaE2000, hexToLab } from './image-toolkit';
import { resourceKeyToRef, scanFeatureSourceTree } from './source-ref-scan';
import { computeStructureSequenceScore, loadVisualParityMappings } from './visual-structure-parity';
import { isPixel1to1, fidelityRatchetFailOrWarn } from '../../../harness/scripts/utils/fidelity-shared';
import { collectSemanticColorBindingIssues } from './visual-parity-backstop';

const COPY_MATCH_THRESHOLD = 0.85;
const ASSET_COVER_THRESHOLD = 0.8;
const COLOR_DE_THRESHOLD = 8; // JPEG 截图采色含噪声/抗锯齿，ΔE>5 常见；8 为可接受近似匹配
const STRUCT_MATCH_THRESHOLD = 0.6;

function ruleDesc(ctx: CheckContext): string {
  const checks = ctx.phaseRule.structure_checks as Record<string, { description: string }>;
  return checks?.static_fidelity_score?.description?.trim() ?? 'static_fidelity_score';
}

function readColorHexFromResources(projectRoot: string, tokenKey: string, contracts: CheckContext['featureSpec']['contracts']): string | null {
  const rkList = flattenResourceKeyEntries(contracts?.resource_keys);
  const snake = tokenKey.replace(/\./g, '_');
  const rk = rkList.find(r => r.key === snake || r.key?.includes(snake));
  const pathVal = (rk as { path?: string; value?: string } | undefined)?.path ?? rk?.value;
  if (pathVal && pathVal.includes('/')) {
    const abs = path.resolve(projectRoot, pathVal);
    if (fs.existsSync(abs)) {
      try {
        const data = JSON.parse(fs.readFileSync(abs, 'utf-8')) as Record<string, unknown>;
        if (Array.isArray(data.color)) {
          const hit = (data.color as Array<{ name?: string; value?: string }>).find(
            c => c.name === snake || c.name === rk?.key,
          );
          if (hit?.value && String(hit.value).startsWith('#')) return String(hit.value);
        } else {
          // 旧对象格式兼容：{ color: { token: "#..." | { value } } } 或根对象 map
          const colors = (data.color ?? data) as Record<string, unknown>;
          const entry = colors[snake] ?? colors[tokenKey];
          if (typeof entry === 'string' && entry.startsWith('#')) return entry;
          if (entry && typeof entry === 'object' && 'value' in (entry as object)) {
            const v = String((entry as { value: unknown }).value);
            if (v.startsWith('#')) return v;
          }
        }
      } catch { /* skip */ }
    }
  }
  if (typeof rk?.value === 'string' && rk.value.startsWith('#')) return rk.value;
  for (const mod of contracts?.modules ?? []) {
    const base = path.join(projectRoot, mod.package_path, 'src', 'main', 'resources');
    const hex = readColorHexFromDir(base, snake);
    if (hex) return hex;
  }
  return null;
}

function readColorHexFromDir(dir: string, snake: string): string | null {
  if (!fs.existsSync(dir)) return null;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      const nested = readColorHexFromDir(full, snake);
      if (nested) return nested;
    } else if (ent.name === 'color.json') {
      try {
        const data = JSON.parse(fs.readFileSync(full, 'utf-8')) as Record<string, unknown>;
        if (Array.isArray(data.color)) {
          const hit = (data.color as Array<{ name?: string; value?: string }>).find(c => c.name === snake);
          if (hit?.value && String(hit.value).startsWith('#')) return String(hit.value);
        } else {
          // 旧对象格式兼容（与 visual-parity-backstop 一致）
          const colors = (data.color ?? data) as Record<string, unknown>;
          const entry = colors[snake];
          if (typeof entry === 'string' && entry.startsWith('#')) return entry;
          if (entry && typeof entry === 'object' && 'value' in (entry as object)) {
            const v = String((entry as { value: unknown }).value);
            if (v.startsWith('#')) return v;
          }
        }
      } catch { /* skip */ }
    }
  }
  return null;
}

export function computeStaticFidelityScore(
  ctx: CheckContext,
  doc: UiSpecDoc,
  baselineUnverified: boolean,
): CheckResult[] {
  const desc = ruleDesc(ctx);
  const uiSpecRel = uiSpecRelPath(ctx.projectRoot, ctx.feature);
  const contracts = ctx.featureSpec.contracts;

  if (baselineUnverified) {
    return [{
      id: 'static_fidelity_score',
      category: 'structure',
      description: desc,
      severity: 'MAJOR',
      status: 'WARN',
      details: '基线未校验（ui-spec verified=unverified）：静态保真分仅供参考，不作保真结论。',
      affected_files: [uiSpecRel],
    }];
  }

  const scores: string[] = [];

  // ΔE for color tokens
  let colorTotal = 0;
  let colorPass = 0;
  for (const [key, tok] of Object.entries(doc.tokens ?? {})) {
    if (tok.kind !== 'color' || !tok.value) continue;
    colorTotal++;
    const implHex = readColorHexFromResources(ctx.projectRoot, key, contracts);
    if (!implHex) {
      scores.push(`${key}：无实现色值`);
      continue;
    }
    try {
      const dE = deltaE2000(hexToLab(tok.value), hexToLab(implHex));
      if (dE <= COLOR_DE_THRESHOLD) colorPass++;
      scores.push(`${key} ΔE=${dE.toFixed(2)} (spec=${tok.value} impl=${implHex})`);
    } catch {
      scores.push(`${key}：色值解析失败`);
    }
  }

  // copy exact-match %
  const copies = collectCopyTexts(doc);
  let copyHit = 0;
  if (copies.length > 0 && contracts) {
    const allStrings = new Set<string>();
    for (const mod of contracts.modules ?? []) {
      const base = path.join(ctx.projectRoot, mod.package_path, 'src', 'main', 'resources');
      walkStringJson(base, allStrings);
    }
    for (const t of copies) {
      if (allStrings.has(t)) copyHit++;
    }
  }
  const copyPct = copies.length > 0 ? copyHit / copies.length : 1;

  // asset coverage %（文件存在 + 源码 $r 引用）
  const sourceScan = contracts ? scanFeatureSourceTree(ctx.projectRoot, contracts) : null;
  const assets = doc.assets ?? [];
  let assetResolved = 0;
  let assetReferenced = 0;
  const pixel1to1 = isPixel1to1(ctx);
  for (const a of assets) {
    const countsInDenom = !a.placeholder || pixel1to1;
    if (!countsInDenom) continue;
    const hasFile = Boolean(a.resolved_path && fs.existsSync(path.resolve(ctx.projectRoot, a.resolved_path)));
    if (hasFile) assetResolved++;
    if (sourceScan) {
      const mediaRef = resourceKeyToRef(a.key, 'media');
      const altSnake = resourceKeyToRef(a.key.replace(/\./g, '_'), 'media');
      if (sourceScan.resourceRefs.has(mediaRef) || sourceScan.resourceRefs.has(altSnake)) {
        assetReferenced++;
      }
    }
  }
  const denomAssets = assets.filter(a => !a.placeholder || pixel1to1);
  const assetPct = denomAssets.length > 0
    ? (sourceScan ? assetReferenced / denomAssets.length : assetResolved / denomAssets.length)
    : 1;

  // structure order match（经 visual-parity.yaml components 映射 vs 源码 struct，禁止 taxonomy 直比）
  const vpMappings = loadVisualParityMappings(ctx.projectRoot, ctx.feature);
  const structScore = sourceScan
    ? computeStructureSequenceScore(doc, vpMappings, sourceScan.structNames, sourceScan.structNamesOrdered)
    : null;
  let structPct = 1;
  if (structScore) {
    structPct = structScore.ratio;
    scores.push(...structScore.detail);
  } else if (vpMappings?.components?.length) {
    scores.push('结构分：有 visual-parity 映射但无源码 struct 扫描，跳过');
    structPct = 0;
  } else {
    scores.push('结构分：缺 visual-parity.yaml components 映射，禁止 taxonomy↔struct 直比');
    structPct = 0;
  }

  const semanticIssues = collectSemanticColorBindingIssues(ctx, doc, baselineUnverified);

  const overallWarn =
    copyPct < COPY_MATCH_THRESHOLD ||
    assetPct < ASSET_COVER_THRESHOLD ||
    (colorTotal > 0 && colorPass / colorTotal < 0.8) ||
    structPct < STRUCT_MATCH_THRESHOLD ||
    semanticIssues.length > 0;

  const summary = [
    `色差 ΔE≤${COLOR_DE_THRESHOLD}：${colorPass}/${colorTotal}`,
    `文案 exact-match：${(copyPct * 100).toFixed(0)}%`,
    `资产覆盖：${(assetPct * 100).toFixed(0)}%（${sourceScan ? `源码引用 ${assetReferenced}/${denomAssets.length}` : `文件 ${assetResolved}/${denomAssets.length}`}）${pixel1to1 ? '；pixel_1to1 含 placeholder 计入分母' : ''}`,
    `结构屏匹配：${(structPct * 100).toFixed(0)}%`,
    semanticIssues.length > 0
      ? `语义色绑定缺失：${semanticIssues.map(i => i.detail).join('；')}`
      : '语义色绑定：通过',
    '【边界】结构分仅基于源码 struct 声明名 presence + 映射顺序近似（LCS+覆盖率），' +
      '不分析组件调用/嵌套/页面归属——空 struct 或未挂载组件可能仍被计入。真·结构与几何对齐归 M4 设备 visual_diff，' +
      '本分仅作 MAJOR/WARN 参考，不得据此宣称"结构已保真"。',
    ...scores,
  ].join('\n');

  const ratchet = pixel1to1 && overallWarn
    ? fidelityRatchetFailOrWarn(ctx, false)
    : { severity: 'MAJOR' as const, status: (overallWarn ? 'WARN' : 'PASS') as 'WARN' | 'PASS' };

  return [{
    id: 'static_fidelity_score',
    category: 'structure',
    description: desc,
    severity: ratchet.severity,
    status: ratchet.status,
    details: summary,
    affected_files: [uiSpecRel],
  }];
}

function walkStringJson(dir: string, out: Set<string>): void {
  if (!fs.existsSync(dir)) return;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walkStringJson(full, out);
    else if (ent.name === 'string.json') {
      try {
        const data = JSON.parse(fs.readFileSync(full, 'utf-8')) as Record<string, unknown>;
        if (Array.isArray(data.string)) {
          for (const item of data.string as Array<{ value?: string }>) {
            if (typeof item.value === 'string') out.add(item.value);
          }
        } else {
          const inner = (data.string ?? data) as Record<string, unknown>;
          for (const v of Object.values(inner)) {
            if (typeof v === 'string') out.add(v);
          }
        }
      } catch { /* skip */ }
    }
  }
}
