// ============================================================================
// render-visibility.ts — 设备渲染可见性（blind-visual-hardening d2 / P0-B④，calibrate 节点）
// ----------------------------------------------------------------------------
// 事故锚（bc-openCard 二轮 TC-002）：「底部5个小图标可见」以 uitree Image 节点存在为准，
// 空白渲染照样 PASS——组件真值与像素真值脱节。本模块以确定性像素统计补齐"看得见"判据：
//   uitree Image 节点 bbox × 设备截图区域 → 三信号合议：
//   ①区域内部结构（lumaStddev）②区域-周边背景对比（扩窗众数色 ΔE2000）——
//   两者皆低 → invisible（与背景不可区分/无前景信号）。
// 【两段式落地（codex 二轮 M5 / cursor 二轮⑤ / design §1.3）】本文件为 **calibrate 节点**：
//   - 阈值冻结为版本 r1-calibrate（synthetic 夹具双向校准，见 asset-integrity.unit.test）；
//   - check 以 MAJOR/WARN 产出结构化 findings **观察**，不阻断；
//   - enforce（升 BLOCKER）为独立后续节点，条件=连续两轮真实 run 零误报——
//     观察期内 P0-B 不得声称完成（tasks.md 4.6 单列）。
// 无 VL 依赖：纯 jimp 统计；jimp 不可用 → unknown（不误报也不冒充已验）。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import type { CheckContext, CheckResult } from '../../../harness/scripts/utils/types';
import { featureDir } from '../../../harness/config';
import {
  cropAssetFromBbox,
  computeImageStats,
  deltaE2000,
  hexToLab,
  isJimpAvailable,
  readImageDimensions,
  sampleColorFromBbox,
} from './image-toolkit';
import { parseHypiumDump, flattenLayoutNodes, type LayoutRect } from './layout-oracle-check';

export const RENDER_VISIBILITY_THRESHOLD_VERSION = 'r1-calibrate';

/** 区域内部结构下限：灰度标准差低于此值=区域内无前景结构（空白图标区实测 ≈0-2） */
export const REGION_MIN_LUMA_STDDEV = 4;
/** 区域-背景对比下限：区域众数色 vs 扩窗众数色 ΔE2000 低于此值=与背景不可区分 */
export const REGION_BG_MIN_DELTA_E = 6;
/** 只检小图形节点（图标/logo 类）：区域面积占屏比上限——整屏大图不适用本判据 */
export const REGION_MAX_SCREEN_AREA_FRACTION = 0.25;
/** 过小区域跳过（<8px 边，统计不稳定） */
export const REGION_MIN_EDGE_PX = 8;

export interface RegionVisibilityAssessment {
  status: 'visible' | 'invisible' | 'unknown';
  lumaStddev?: number;
  bgDeltaE?: number;
  reasons: string[];
}

/** 单区域可见性合议（纯像素统计；三态输出，unknown 不冒充已验）。
 * 注意：image-toolkit 的 bbox 语义 SSOT 是**归一化 [x,y,w,h]**（image-jimp-worker.cjs 头注），
 * uitree bounds 是像素 [x1,y1][x2,y2]——此处做换算，勿直传（round6 bbox 转置教训同族）。 */
export function assessImageRegionVisibility(
  screenshotAbs: string,
  rect: LayoutRect,
  workDir: string,
  tag: string,
): RegionVisibilityAssessment {
  if (!isJimpAvailable()) return { status: 'unknown', reasons: ['jimp 不可用'] };
  const w = rect.x2 - rect.x1;
  const h = rect.y2 - rect.y1;
  if (w < REGION_MIN_EDGE_PX || h < REGION_MIN_EDGE_PX) {
    return { status: 'unknown', reasons: [`区域过小（${w}×${h}），统计不稳定`] };
  }
  const dims = readImageDimensions(screenshotAbs);
  if (!dims || !dims.w || !dims.h) return { status: 'unknown', reasons: ['截图尺寸不可读'] };
  const bbox = [rect.x1 / dims.w, rect.y1 / dims.h, w / dims.w, h / dims.h];
  const cropAbs = path.join(workDir, `region-${tag}.png`);
  const crop = cropAssetFromBbox(screenshotAbs, bbox, cropAbs, 0);
  if (!crop.ok) return { status: 'unknown', reasons: [`区域裁取失败：${crop.error ?? ''}`] };
  const stats = computeImageStats(cropAbs);
  if (!stats.ok) return { status: 'unknown', reasons: [`区域统计失败：${stats.error ?? ''}`] };
  const lumaStddev = stats.lumaStddev ?? 0;

  // 背景对比：区域众数色 vs 扩窗（padding 0.6 → 背景像素占多数）众数色
  const regionColor = sampleColorFromBbox(screenshotAbs, bbox, 0);
  const ringColor = sampleColorFromBbox(screenshotAbs, bbox, 0.6);
  let bgDeltaE: number | undefined;
  if (regionColor.sampled && ringColor.sampled) {
    bgDeltaE = deltaE2000(hexToLab(regionColor.hex), hexToLab(ringColor.hex));
  }

  const noStructure = lumaStddev < REGION_MIN_LUMA_STDDEV;
  const noContrast = bgDeltaE !== undefined && bgDeltaE < REGION_BG_MIN_DELTA_E;
  if (noStructure && (bgDeltaE === undefined ? true : noContrast)) {
    return {
      status: 'invisible',
      lumaStddev,
      bgDeltaE,
      reasons: [
        `区域无前景结构（lumaStddev=${lumaStddev.toFixed(1)} < ${REGION_MIN_LUMA_STDDEV}）`,
        ...(bgDeltaE !== undefined ? [`与背景不可区分（ΔE=${bgDeltaE.toFixed(1)} < ${REGION_BG_MIN_DELTA_E}）`] : []),
      ],
    };
  }
  return { status: 'visible', lumaStddev, bgDeltaE, reasons: [] };
}

export interface RenderVisibilityFinding {
  screen: string;
  nodeIndex: number;
  bounds: LayoutRect;
  assessment: RegionVisibilityAssessment;
}

function deviceScreenshotsDirAbs(projectRoot: string, feature: string): string {
  return path.join(featureDir(projectRoot, feature), 'device-testing', 'device-screenshots');
}

/**
 * calibrate 检查：对每对 layout-<screen>.json + shot-<screen>.png，取 Image 类节点做区域可见性
 * 合议；invisible 命中 → MAJOR/WARN 结构化 findings（观察期不阻断）。
 * 采集物缺失（无 dump/无截图）→ 不产结果（采集完备性归 visual_diff_capture 既有 BLOCKER）。
 */
export function checkRenderVisibilityCalibrate(ctx: CheckContext): CheckResult[] {
  const id = 'render_visibility_calibrate';
  const description =
    `设备渲染可见性（calibrate 观察节点，阈值版本 ${RENDER_VISIBILITY_THRESHOLD_VERSION}）——uitree 存在 ≠ 像素可见`;
  const dir = deviceScreenshotsDirAbs(ctx.projectRoot, ctx.feature);
  if (!fs.existsSync(dir)) return [];
  const layoutFiles = fs.readdirSync(dir).filter(f => /^layout-.+\.json$/.test(f));
  if (layoutFiles.length === 0) return [];

  const findings: RenderVisibilityFinding[] = [];
  const unknowns: string[] = [];
  let pairs = 0;
  const workDir = path.join(dir, '_render-visibility');
  for (const lf of layoutFiles) {
    const screen = lf.replace(/^layout-/, '').replace(/\.json$/, '');
    const shotAbs = path.join(dir, `shot-${screen}.png`);
    if (!fs.existsSync(shotAbs)) continue; // 命名不齐/未采屏——完备性归采集门禁
    let dump: ReturnType<typeof parseHypiumDump>;
    try {
      dump = parseHypiumDump(JSON.parse(fs.readFileSync(path.join(dir, lf), 'utf-8')));
    } catch {
      unknowns.push(`${screen}: layout dump 解析失败`);
      continue;
    }
    if (!dump) {
      unknowns.push(`${screen}: layout dump 无有效根`);
      continue;
    }
    pairs++;
    const screenArea = (dump.screenRect.x2 - dump.screenRect.x1) * (dump.screenRect.y2 - dump.screenRect.y1);
    const imageNodes = flattenLayoutNodes(dump.appRoot!).filter(e => {
      const n = e.node;
      if (n.type !== 'Image' || !n.bounds) return false;
      const area = (n.bounds.x2 - n.bounds.x1) * (n.bounds.y2 - n.bounds.y1);
      return area > 0 && area / Math.max(1, screenArea) <= REGION_MAX_SCREEN_AREA_FRACTION;
    });
    imageNodes.forEach((e, i) => {
      const a = assessImageRegionVisibility(shotAbs, e.node.bounds!, workDir, `${screen}-${i}`);
      if (a.status === 'invisible') findings.push({ screen, nodeIndex: i, bounds: e.node.bounds!, assessment: a });
      else if (a.status === 'unknown') unknowns.push(`${screen}#${i}: ${a.reasons.join('；')}`);
    });
  }

  if (pairs === 0) return [];
  if (findings.length === 0) {
    return [{
      id, category: 'structure', description,
      severity: 'MAJOR', status: 'PASS',
      details: [
        `已核 ${pairs} 屏 Image 区域，无"节点在、像素不可见"命中。`,
        unknowns.length > 0 ? `unknown ${unknowns.length} 项（不冒充已验）：${unknowns.slice(0, 5).join('；')}` : null,
      ].filter(Boolean).join('\n'),
    }];
  }
  return [{
    id, category: 'structure', description,
    severity: 'MAJOR', status: 'WARN', // calibrate 观察期：不阻断；enforce 升 BLOCKER 为独立后续节点
    details: [
      `【渲染可见性 calibrate】${findings.length} 处 Image 节点"存在但像素不可见"（bc-openCard 假可见形态）：`,
      ...findings.slice(0, 12).map(f =>
        `  - [${f.screen}] node#${f.nodeIndex} bounds=${JSON.stringify(f.bounds)}：${f.assessment.reasons.join('；')}`),
      findings.length > 12 ? `  …还有 ${findings.length - 12} 处` : null,
      '【观察期语义】本节点 WARN 观察、findings 入视觉债务；连续两轮真实 run 零误报后升 BLOCKER（enforce 节点）。',
    ].filter(Boolean).join('\n'),
    suggestion:
      '空白 Image 通常=占位/素材缺失或资源引用错误——用真实素材或按 role 生成可见语义占位；' +
      '若判定为误报（扁平合法 UI），把样本回灌 render-visibility 夹具并在实施记录登记阈值校准。',
    structured: { kind: 'render_visibility', threshold_version: RENDER_VISIBILITY_THRESHOLD_VERSION, findings },
  }];
}
