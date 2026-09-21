// ============================================================================
// render-visibility.ts — 设备渲染可见性（blind-visual-hardening d2 / P0-B④，债务门控观察节点）
// ----------------------------------------------------------------------------
// 事故锚（bc-openCard 二轮 TC-002）：「底部5个小图标可见」以 uitree Image 节点存在为准，
// 空白渲染照样 PASS——组件真值与像素真值脱节。本模块以确定性像素统计补齐"看得见"判据：
//   uitree Image 节点 bbox × 设备截图区域 → 三信号合议：
//   ①区域内部结构（lumaStddev）②区域-周边背景对比（扩窗众数色 ΔE2000）——
//   两者皆低 → invisible（与背景不可区分/无前景信号）。
// 【终态语义（3.0.0 收尾决定）】本文件为 **debt-gated observation**：
//   - 阈值冻结为版本 r1-debt-gated（synthetic 夹具双向校准，见 asset-integrity.unit.test）；
//   - check 以 MAJOR/WARN 产出结构化 findings，不阻断 phase；
//   - findings 进入 visual-debt；open debt 令 visual 轴 UNVERIFIED 并阻断 release，
//     不再预留同一事实的独立 phase BLOCKER/enforce。
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
import { parseHypiumDump, flattenLayoutNodes, type LayoutNode, type LayoutRect } from './layout-oracle-check';
import { sanitizeVisualDiffScreenSlug } from './visual-diff-capture';
import { isOverlayId, OVERLAY_SEP } from './visual-diff-nav';

export const RENDER_VISIBILITY_THRESHOLD_VERSION = 'r1-debt-gated';

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
 * plan e7a2c4f1 §3.2：layout 文件名 slug → 逻辑 screen_id。
 *
 * 本文件的 `screen` 取自文件名（`layout-<slug>.json`），而 slug 经
 * `sanitizeVisualDiffScreenSlug` 把 `_+` 压成单个 `_`——宿主实际是
 * `layout-card_type_sheet_overlay_cts_root.json`，按 `__overlay__` 直接匹配会漏掉全部目标。
 * 逻辑 id 的唯一真源是 `visual-diff.json` 的 `screens[].screen_id`。
 * 一个 slug 对多个逻辑 id（归一冲突）时**不任选**——采集侧已 fail-closed 跳过冲突双方
 * （visual-diff-capture 的归一冲突检测），读侧只消费该保证，映射为 null 并按 unknowns 披露。
 */
function screenIdBySlugFromVisualDiff(dir: string): Map<string, string | null> {
  const out = new Map<string, string | null>();
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(path.join(dir, 'visual-diff.json'), 'utf-8'));
  } catch {
    return out;
  }
  const screens = (raw as { screens?: unknown }).screens;
  if (!Array.isArray(screens)) return out;
  for (const s of screens) {
    const id = typeof (s as { screen_id?: unknown })?.screen_id === 'string'
      ? (s as { screen_id: string }).screen_id.trim()
      : '';
    if (!id) continue;
    const slug = sanitizeVisualDiffScreenSlug(id);
    if (!slug) continue;
    out.set(slug, out.has(slug) && out.get(slug) !== id ? null : id);
  }
  return out;
}

/** overlay 逻辑 id（`<base>__overlay__<rootId>`）的 overlay 根节点 id；非 overlay → null。 */
function overlayRootNodeId(screenId: string): string | null {
  const idx = screenId.indexOf(OVERLAY_SEP);
  if (idx <= 0) return null;
  const rootId = screenId.slice(idx + OVERLAY_SEP.length).trim();
  return rootId || null;
}

function findNodeById(root: LayoutNode, nodeId: string): LayoutNode | null {
  for (const e of flattenLayoutNodes(root)) {
    if (e.node.id === nodeId || e.node.key === nodeId) return e.node;
  }
  return null;
}

function unknownsLine(unknowns: string[]): string | null {
  return unknowns.length > 0
    ? `unknown ${unknowns.length} 项（不冒充已验）：${unknowns.slice(0, 5).join('；')}`
    : null;
}

/**
 * 债务门控观察检查：对每对 layout-<screen>.json + shot-<screen>.png，取 Image 类节点做区域可见性
 * 合议；invisible 命中 → MAJOR/WARN 结构化 findings（不阻断 phase，入 visual-debt 阻断 release）。
 * 采集物缺失（无 dump/无截图）→ 不产结果（采集完备性归 visual_diff_capture 既有 BLOCKER）。
 */
export function checkRenderVisibilityCalibrate(ctx: CheckContext): CheckResult[] {
  const id = 'render_visibility_calibrate';
  const description =
    `设备渲染可见性（债务门控观察，阈值版本 ${RENDER_VISIBILITY_THRESHOLD_VERSION}）——uitree 存在 ≠ 像素可见`;
  const dir = deviceScreenshotsDirAbs(ctx.projectRoot, ctx.feature);
  if (!fs.existsSync(dir)) return [];
  const layoutFiles = fs.readdirSync(dir).filter(f => /^layout-.+\.json$/.test(f));
  if (layoutFiles.length === 0) return [];

  const findings: RenderVisibilityFinding[] = [];
  const unknowns: string[] = [];
  let pairs = 0;
  const workDir = path.join(dir, '_render-visibility');
  const screenIdBySlug = screenIdBySlugFromVisualDiff(dir);
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
    const screenArea = (dump.screenRect.x2 - dump.screenRect.x1) * (dump.screenRect.y2 - dump.screenRect.y1);
    const candidateImageNodes = (root: LayoutNode): Array<{ node: LayoutNode }> =>
      flattenLayoutNodes(root).filter(e => {
        const n = e.node;
        if (n.type !== 'Image' || !n.bounds) return false;
        const area = (n.bounds.x2 - n.bounds.x1) * (n.bounds.y2 - n.bounds.y1);
        return area > 0 && area / Math.max(1, screenArea) <= REGION_MAX_SCREEN_AREA_FRACTION;
      });
    // plan e7a2c4f1 §3.2（G20 误报）：overlay 屏只在其 overlay 根节点子树内判定——子树外的节点
    // 按定义是被半模态盖住的底页，bounds 仍有效但那块像素是被遮住的纯色，一律命中"节点在、像素
    // 不可见"（宿主 7 处全是这个形态）。LayoutNode 没有背景色/透明度/z-order，真遮挡关系无从求值，
    // 所以用"屏 id 自带的 overlay 根"这条现成信息划范围；非 overlay 屏行为不变（全树判定）。
    // 判据本身不放宽：overlay 子树内与非 overlay 屏的命中照旧 FAIL 并开 visual-debt。
    const logicalId = screenIdBySlug.get(screen);
    if (logicalId === null) {
      unknowns.push(`${screen}: 文件名 slug 对应多个逻辑 screen_id，本屏不判定`);
      continue;
    }
    let scopeRoot = dump.appRoot!;
    if (logicalId && isOverlayId(logicalId)) {
      const rootNodeId = overlayRootNodeId(logicalId);
      const overlayRoot = rootNodeId ? findNodeById(dump.appRoot!, rootNodeId) : null;
      if (!overlayRoot) {
        // 目标 id 的后缀在 ui-spec 无 id 时取的是 `order`（visual-diff-targets 的既有命名），
        // 所以"找不到"有两种：后缀本来就不是节点 id（纯数字序号），或节点真的不在树里。
        unknowns.push(
          `${screen}: overlay 根 ${rootNodeId ?? '(未知)'} 未定位到布局树节点` +
            `（${rootNodeId && /^\d+$/.test(rootNodeId) ? '后缀是 order 序号、不是节点 id' : '节点 id 不在本轮 dump 中'}），本屏未核`,
        );
        continue;
      }
      scopeRoot = overlayRoot;
      const skipped = candidateImageNodes(dump.appRoot!).length - candidateImageNodes(scopeRoot).length;
      if (skipped > 0) unknowns.push(`${screen}: 未核 ${skipped} 个 overlay 根子树外节点（被弹层遮挡的底页）`);
    }
    pairs++; // 整屏被跳过（slug 冲突 / overlay 根不在树里）时不计入"已核 N 屏"
    const imageNodes = candidateImageNodes(scopeRoot);
    imageNodes.forEach((e, i) => {
      const a = assessImageRegionVisibility(shotAbs, e.node.bounds!, workDir, `${screen}-${i}`);
      if (a.status === 'invisible') findings.push({ screen, nodeIndex: i, bounds: e.node.bounds!, assessment: a });
      else if (a.status === 'unknown') unknowns.push(`${screen}#${i}: ${a.reasons.join('；')}`);
    });
  }

  // 采集物缺失（无 dump/无截图）才是"无门禁对象"；**屏被跳过但有 unknown 必须披露**——
  // 否则"整屏未核"会跟"这轮压根没采"长得一模一样（plan e7a2c4f1 §3.2 偏差 5 的兑现处）。
  if (pairs === 0 && unknowns.length === 0) return [];
  if (findings.length === 0) {
    return [{
      id, category: 'structure', description,
      severity: 'MAJOR', status: 'PASS',
      details: [
        pairs > 0
          ? `已核 ${pairs} 屏 Image 区域，无"节点在、像素不可见"命中。`
          : '已核 0 屏 Image 区域（全部屏未进入判定，原因见下）——本轮不构成"已验"。',
        unknownsLine(unknowns),
      ].filter(Boolean).join('\n'),
    }];
  }
  return [{
    id, category: 'structure', description,
    // plan a3f7c1d9 D3(e)：缺陷用 FAIL、披露用 WARN。MAJOR FAIL：不计入 phase verdict/blockers（只数 BLOCKER），
    // findings 入 visual-debt 阻断 release（账本只对 FAIL / 非 MINOR SKIP 开账，WARN 会关账）。
    severity: 'MAJOR', status: 'FAIL',
    details: [
      `【渲染可见性（债务门控观察）】${findings.length} 处 Image 节点"存在但像素不可见"（bc-openCard 假可见形态）：`,
      ...findings.slice(0, 12).map(f =>
        `  - [${f.screen}] node#${f.nodeIndex} bounds=${JSON.stringify(f.bounds)}：${f.assessment.reasons.join('；')}`),
      findings.length > 12 ? `  …还有 ${findings.length - 12} 处` : null,
      // plan e7a2c4f1 §3.2：unknowns 以前只在 PASS 分支打印，FAIL 分支直接丢弃——有命中的那一屏
      // 恰恰最需要知道"还有多少没核"。两个分支同一行文案。
      unknownsLine(unknowns),
      '【终态语义】本节点 MAJOR FAIL：不计入 phase verdict/blockers（只数 BLOCKER）；findings 入 visual-debt，open debt 令 testing 期 visual 轴 UNVERIFIED 并阻断 release，不设独立 enforce 节点。',
    ].filter(Boolean).join('\n'),
    suggestion:
      '空白 Image 通常=占位/素材缺失或资源引用错误——用真实素材或按 role 生成可见语义占位；' +
      '若判定为误报（扁平合法 UI），把样本回灌 render-visibility 夹具并在实施记录登记阈值校准。',
    structured: { kind: 'render_visibility', threshold_version: RENDER_VISIBILITY_THRESHOLD_VERSION, findings },
  }];
}
