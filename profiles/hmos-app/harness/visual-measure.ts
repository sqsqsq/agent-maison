// ============================================================================
// visual-measure.ts — `--measure --feature <f> [--screen <id>]`（plan 07a41ec6 T10 /
// openspec efficiency-first-closure「Visual measurement is facts only」）
// ----------------------------------------------------------------------------
// 视觉量测只承担**测量**，不承担完整视觉裁决：
//   · 复用 layout-oracle-check 的布局树读取与 T8 几何不变量、visual-diff-capture 的截图寻址、
//     image-toolkit 的尺寸/取色；对 ui-spec 声明元素输出可复算事实：bounds、卡片边界、间距、
//     重叠、参考图与设备的差值（px 与按设计宽反算的 vp 估算）、颜色采样；
//   · 结果写 device-screenshots/measure-<screen_slug>.json 并打印人可读表；
//   · 三轴：geometry PASS/FAIL（阈值只取 ui-spec 元素级 tolerance_px；缺省 = ADVISORY）、
//     content CHECKED/UNKNOWN、style CHECKED/UNKNOWN；
//   · visual-diff.json 的 defects[].note 由量测事实自动补充，verdict 不动；
//   · 不改写 ui-spec 真源，最多输出 bbox 建议；measurement 不等于 pixel_1to1 PASS，
//     geometry PASS 不解除 visual/release block。
// 宿主 2026-09-02 回归：66 次手写脚本量像素，本模块把那些脚本变成一条命令。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';

import { resolveFeatureArtifact } from '../../../harness/config';
import type { CheckContext } from '../../../harness/scripts/utils/types';
import {
  loadUiSpecFile,
  uiSpecAbsPath,
  walkComponentNodes,
  type UiSpecComponentNode,
  type UiSpecDoc,
  type UiSpecScreen,
} from '../../../harness/scripts/utils/ui-spec-shared';
import { buildAuthoritativeRefImageIndex, resolveRefSourceImage } from './authoritative-ref-images';
import { deltaE2000, hexToLab, readImageDimensions, sampleColorFromBbox } from './image-toolkit';
import {
  collectLayoutOracleForScreen,
  loadLayoutDumpFile,
  locateElements,
  rectsIntersect,
  type DeclaredElement,
  type LayoutRect,
  type ParsedLayoutDump,
} from './layout-oracle-check';
import { deviceScreenshotsDir, resolveLayoutDumpPath, sanitizeVisualDiffScreenSlug } from './visual-diff-capture';

export const MEASURE_SCHEMA = 'maison-visual-measure@1';
/** vp 估算假设：HarmonyOS 默认设计宽 360vp——只是估算，输出里明写假设。 */
export const DESIGN_WIDTH_VP = 360;

export type GeometryStatus = 'PASS' | 'FAIL' | 'ADVISORY' | 'UNLOCATED';

export interface MeasuredElement {
  element_id: string;
  confidence: string;
  bounds_px: LayoutRect | null;
  size_px: { w: number; h: number } | null;
  /** 归一化 [x,y,w,h]（相对 app 窗口） */
  bbox_norm: [number, number, number, number] | null;
  /** ui-spec 声明的归一化 bbox（缺省 null） */
  expected_bbox_norm: [number, number, number, number] | null;
  /** 设备实测 − 按设备视口换算的声明值（px） */
  delta_px: { dx: number; dy: number; dw: number; dh: number } | null;
  delta_vp_estimate: { dx: number; dy: number; dw: number; dh: number } | null;
  /** ui-spec 元素级 tolerance_px；缺省 null → geometry 只作 advisory */
  tolerance_px: number | null;
  geometry: GeometryStatus;
  color: {
    token: string | null;
    expected_hex: string | null;
    device_hex: string | null;
    reference_hex: string | null;
    delta_e_device_vs_expected: number | null;
    delta_e_device_vs_reference: number | null;
    sampled: boolean;
  } | null;
}

export interface ScreenMeasurement {
  schema: string;
  feature: string;
  screen_id: string;
  generated_at: string;
  screenshot: { path: string | null; w: number | null; h: number | null };
  reference: { path: string | null; w: number | null; h: number | null };
  layout_dump: { path: string | null; status: string; app_rect: LayoutRect | null };
  px_per_vp_estimate: number | null;
  assumption: string;
  elements: MeasuredElement[];
  overlaps: Array<{ a: string; b: string; intersection_px: LayoutRect }>;
  /** 按 y 排序的相邻元素纵向间距（px；负值 = 重叠） */
  gaps: Array<{ a: string; b: string; gap_px: number }>;
  layout_findings: Array<{ finding_id: string; signal: string; tier: string; elements: string[]; note: string }>;
  axes: { geometry: 'PASS' | 'FAIL' | 'ADVISORY' | 'UNAVAILABLE'; content: 'CHECKED' | 'UNKNOWN'; style: 'CHECKED' | 'UNKNOWN' };
  /** 供 spec 作者参考的 bbox 建议（不写回 ui-spec） */
  bbox_suggestions: Array<{ element_id: string; bbox_norm: [number, number, number, number] }>;
  notes: string[];
}

function round(n: number, d = 3): number {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

function normalizeBbox(raw: number[] | undefined, refDims: { w: number | null; h: number | null } | null): [number, number, number, number] | null {
  if (!Array.isArray(raw) || raw.length !== 4 || raw.some(v => typeof v !== 'number' || !Number.isFinite(v))) return null;
  const [x, y, w, h] = raw;
  if (x <= 1 && y <= 1 && w <= 1 && h <= 1) return [x, y, w, h];
  if (refDims?.w && refDims?.h) return [x / refDims.w, y / refDims.h, w / refDims.w, h / refDims.h];
  return null;
}

function rectToNorm(r: LayoutRect, app: LayoutRect): [number, number, number, number] {
  const aw = Math.max(1, app.x2 - app.x1);
  const ah = Math.max(1, app.y2 - app.y1);
  return [round((r.x1 - app.x1) / aw), round((r.y1 - app.y1) / ah), round((r.x2 - r.x1) / aw), round((r.y2 - r.y1) / ah)];
}

function tokenHex(doc: UiSpecDoc, name: string | undefined): { token: string | null; hex: string | null } {
  if (!name) return { token: null, hex: null };
  const t = doc.tokens?.[name];
  const hex = t && typeof t.value === 'string' && /^#[0-9a-fA-F]{6}$/.test(t.value.trim()) ? t.value.trim() : null;
  return { token: name, hex };
}

function deltaE(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  try {
    return round(deltaE2000(hexToLab(a), hexToLab(b)), 2);
  } catch {
    return null;
  }
}

export interface MeasureScreenInput {
  feature: string;
  screen: UiSpecScreen;
  doc: UiSpecDoc;
  dump: ParsedLayoutDump | null;
  dumpPath: string | null;
  dumpStatus: string;
  screenshotAbs: string | null;
  referenceAbs: string | null;
  /** visual-diff.json 中该屏条目（content 轴依据；缺省 null） */
  visualDiffScreen: { verdict?: string; evaluated_screenshot_hash?: string } | null;
  now?: () => Date;
  /** 测试注入：取色函数（缺省 sampleColorFromBbox，需 jimp） */
  sampleColor?: (imagePath: string, bboxNorm: number[]) => { hex: string; sampled: boolean };
}

/** 单屏量测（纯计算：全部输入已由调用方读好）。 */
export function measureScreen(input: MeasureScreenInput): ScreenMeasurement {
  const { screen, doc, dump } = input;
  const notes: string[] = [];
  const shotDims = input.screenshotAbs ? readImageDimensions(input.screenshotAbs) : null;
  const refDims = input.referenceAbs ? readImageDimensions(input.referenceAbs) : null;
  const sample = input.sampleColor ?? ((p: string, b: number[]) => sampleColorFromBbox(p, b));

  const declaredNodes: UiSpecComponentNode[] = [];
  walkComponentNodes(screen.root, declaredNodes);
  const nodeById = new Map<string, UiSpecComponentNode>();
  for (const n of declaredNodes) if (n.id && !nodeById.has(n.id)) nodeById.set(n.id, n);
  const declared: DeclaredElement[] = [...nodeById.entries()].map(([id, n]) => ({ elementId: id, ...(n.text ? { text: n.text } : {}) }));
  for (const id of screen.must_have_elements ?? []) if (!nodeById.has(id)) declared.push({ elementId: id });

  const elements: MeasuredElement[] = [];
  const overlaps: ScreenMeasurement['overlaps'] = [];
  const gaps: ScreenMeasurement['gaps'] = [];
  const bboxSuggestions: ScreenMeasurement['bbox_suggestions'] = [];
  let layoutFindings: ScreenMeasurement['layout_findings'] = [];
  let pxPerVp: number | null = null;

  if (dump) {
    const app = dump.appRect;
    pxPerVp = round((app.x2 - app.x1) / DESIGN_WIDTH_VP, 4);
    const { located, coverage } = locateElements(declared, dump.appRoot);
    notes.push(`locator 覆盖率 ${(coverage * 100).toFixed(0)}%（${located.size}/${declared.length}）`);
    const locatedRects: Array<{ id: string; rect: LayoutRect; ancestors: Set<unknown> }> = [];
    for (const d of declared) {
      const loc = located.get(d.elementId);
      const node = nodeById.get(d.elementId);
      const expected = normalizeBbox(node?.bbox, refDims);
      const tolRaw = (node as { tolerance_px?: unknown } | undefined)?.tolerance_px;
      const tolerance = typeof tolRaw === 'number' && Number.isFinite(tolRaw) && tolRaw >= 0 ? tolRaw : null;
      const rect = loc?.node?.bounds ?? null;
      const colorRef = node?.color_ref ?? node?.bg_color;
      const { token, hex: expectedHex } = tokenHex(doc, colorRef);
      let color: MeasuredElement['color'] = null;
      if (!rect) {
        elements.push({
          element_id: d.elementId, confidence: loc?.confidence ?? 'unmatched', bounds_px: null, size_px: null, bbox_norm: null,
          expected_bbox_norm: expected, delta_px: null, delta_vp_estimate: null, tolerance_px: tolerance, geometry: 'UNLOCATED', color: null,
        });
        continue;
      }
      const bboxNorm = rectToNorm(rect, app);
      locatedRects.push({ id: d.elementId, rect, ancestors: new Set(loc?.ancestors ?? []) });
      let delta: MeasuredElement['delta_px'] = null;
      let deltaVp: MeasuredElement['delta_vp_estimate'] = null;
      let geometry: GeometryStatus = 'ADVISORY';
      if (expected) {
        const aw = app.x2 - app.x1;
        const ah = app.y2 - app.y1;
        delta = {
          dx: round(rect.x1 - (app.x1 + expected[0] * aw), 1),
          dy: round(rect.y1 - (app.y1 + expected[1] * ah), 1),
          dw: round(rect.x2 - rect.x1 - expected[2] * aw, 1),
          dh: round(rect.y2 - rect.y1 - expected[3] * ah, 1),
        };
        deltaVp = pxPerVp ? { dx: round(delta.dx / pxPerVp, 1), dy: round(delta.dy / pxPerVp, 1), dw: round(delta.dw / pxPerVp, 1), dh: round(delta.dh / pxPerVp, 1) } : null;
        if (tolerance !== null) {
          const worst = Math.max(Math.abs(delta.dx), Math.abs(delta.dy), Math.abs(delta.dw), Math.abs(delta.dh));
          geometry = worst <= tolerance ? 'PASS' : 'FAIL';
        }
      } else {
        bboxSuggestions.push({ element_id: d.elementId, bbox_norm: bboxNorm });
      }
      if (token) {
        const dev = input.screenshotAbs ? sample(input.screenshotAbs, bboxNorm) : { hex: '#000000', sampled: false };
        const ref = input.referenceAbs && expected ? sample(input.referenceAbs, expected) : { hex: '#000000', sampled: false };
        color = {
          token,
          expected_hex: expectedHex,
          device_hex: dev.sampled ? dev.hex : null,
          reference_hex: ref.sampled ? ref.hex : null,
          delta_e_device_vs_expected: dev.sampled ? deltaE(dev.hex, expectedHex) : null,
          delta_e_device_vs_reference: dev.sampled && ref.sampled ? deltaE(dev.hex, ref.hex) : null,
          sampled: dev.sampled,
        };
      }
      elements.push({
        element_id: d.elementId, confidence: loc?.confidence ?? 'unmatched', bounds_px: rect,
        size_px: { w: rect.x2 - rect.x1, h: rect.y2 - rect.y1 }, bbox_norm: bboxNorm, expected_bbox_norm: expected,
        delta_px: delta, delta_vp_estimate: deltaVp, tolerance_px: tolerance, geometry, color,
      });
    }
    for (let i = 0; i < locatedRects.length; i += 1) {
      for (let j = i + 1; j < locatedRects.length; j += 1) {
        const a = locatedRects[i];
        const b = locatedRects[j];
        if (a.ancestors.size > 0 || b.ancestors.size > 0) {
          const aNode = located.get(a.id)?.node;
          const bNode = located.get(b.id)?.node;
          if ((aNode && b.ancestors.has(aNode)) || (bNode && a.ancestors.has(bNode))) continue; // 亲缘包含不算重叠
        }
        if (rectsIntersect(a.rect, b.rect)) {
          overlaps.push({
            a: a.id, b: b.id,
            intersection_px: { x1: Math.max(a.rect.x1, b.rect.x1), y1: Math.max(a.rect.y1, b.rect.y1), x2: Math.min(a.rect.x2, b.rect.x2), y2: Math.min(a.rect.y2, b.rect.y2) },
          });
        }
      }
    }
    const byY = [...locatedRects].sort((a, b) => a.rect.y1 - b.rect.y1 || a.rect.x1 - b.rect.x1);
    for (let i = 1; i < byY.length; i += 1) {
      gaps.push({ a: byY[i - 1].id, b: byY[i].id, gap_px: byY[i].rect.y1 - byY[i - 1].rect.y2 });
    }
    try {
      layoutFindings = collectLayoutOracleForScreen({ screenId: screen.id, screen, dump }).findings.map(f => ({
        finding_id: f.finding_id, signal: f.signal, tier: f.tier, elements: f.elements, note: f.note,
      }));
    } catch (e) {
      notes.push(`T8 几何不变量未能计算：${(e as Error).message}`);
    }
  } else {
    notes.push(`无布局 dump（${input.dumpStatus}）：bounds/间距/重叠不可量测；只报截图与参考图尺寸`);
  }

  // codex review：整屏 PASS 的条件是**每个**声明元素都定位到且逐个 PASS；有 UNLOCATED / ADVISORY 就只能 ADVISORY（不造确定性假 PASS）。
  const geometryAxis: ScreenMeasurement['axes']['geometry'] = !dump
    ? 'UNAVAILABLE'
    : elements.some(e => e.geometry === 'FAIL')
      ? 'FAIL'
      : elements.length > 0 && elements.every(e => e.geometry === 'PASS')
        ? 'PASS'
        : 'ADVISORY';
  const vd = input.visualDiffScreen;
  const contentAxis: ScreenMeasurement['axes']['content'] =
    vd && ['pass', 'warn', 'fail'].includes(String(vd.verdict)) && typeof vd.evaluated_screenshot_hash === 'string' && vd.evaluated_screenshot_hash.trim()
      ? 'CHECKED'
      : 'UNKNOWN';
  const styleAxis: ScreenMeasurement['axes']['style'] = elements.some(e => e.color?.sampled) ? 'CHECKED' : 'UNKNOWN';
  if (geometryAxis === 'ADVISORY') {
    const unlocated = elements.filter(e => e.geometry === 'UNLOCATED').map(e => e.element_id);
    notes.push(
      `geometry=ADVISORY：${unlocated.length > 0 ? `未定位元素 ${unlocated.join('、')}；` : ''}` +
      'ui-spec 未给元素级 tolerance_px 的元素只作事实，不作判定',
    );
  }
  if (contentAxis === 'UNKNOWN') notes.push('content=UNKNOWN：本屏尚无基于当前截图的视觉判定（visual-diff.json verdict/evaluated_screenshot_hash）');
  if (styleAxis === 'UNKNOWN') notes.push('style=UNKNOWN：无颜色采样（元素未声明 color_ref/bg_color，或 jimp 不可用）');

  return {
    schema: MEASURE_SCHEMA,
    feature: input.feature,
    screen_id: screen.id,
    generated_at: (input.now ? input.now() : new Date()).toISOString(),
    screenshot: { path: input.screenshotAbs, w: shotDims?.w ?? null, h: shotDims?.h ?? null },
    reference: { path: input.referenceAbs, w: refDims?.w ?? null, h: refDims?.h ?? null },
    layout_dump: { path: input.dumpPath, status: input.dumpStatus, app_rect: dump?.appRect ?? null },
    px_per_vp_estimate: pxPerVp,
    assumption: `design_width_vp=${DESIGN_WIDTH_VP}（vp 换算只是估算）`,
    elements,
    overlaps,
    gaps,
    layout_findings: layoutFindings,
    axes: { geometry: geometryAxis, content: contentAxis, style: styleAxis },
    bbox_suggestions: bboxSuggestions,
    notes,
  };
}

/** 量测事实一行化（写进 visual-diff.json defects[].note，verdict 不动）。 */
export function measureNoteFor(el: MeasuredElement): string {
  const b = el.bounds_px;
  const parts = [
    b ? `bounds=[${b.x1},${b.y1},${b.x2},${b.y2}]px` : 'bounds=未定位',
    el.delta_px ? `Δ(dx,dy,dw,dh)=(${el.delta_px.dx},${el.delta_px.dy},${el.delta_px.dw},${el.delta_px.dh})px` : '',
    el.delta_vp_estimate ? `≈(${el.delta_vp_estimate.dx},${el.delta_vp_estimate.dy},${el.delta_vp_estimate.dw},${el.delta_vp_estimate.dh})vp` : '',
    el.geometry !== 'ADVISORY' ? `geometry=${el.geometry}` : '',
    el.color?.device_hex ? `color=${el.color.device_hex}${el.color.expected_hex ? `(期望 ${el.color.expected_hex}，ΔE=${el.color.delta_e_device_vs_expected ?? '?'})` : ''}` : '',
  ].filter(Boolean);
  return `[measure] ${parts.join(' ')}`;
}

/**
 * 把量测事实补进 visual-diff.json 的 defects[].note（只追加，不改 verdict / must_fix / 其它字段）。
 * 返回补充条数；文件缺失或无匹配 defect 时零写入。
 */
export function fillVisualDiffDefectNotes(reportDir: string, measurements: ScreenMeasurement[]): number {
  const jsonPath = path.join(reportDir, 'visual-diff.json');
  if (!fs.existsSync(jsonPath)) return 0;
  let doc: { screens?: Array<{ screen_id: string; defects?: Array<{ element?: string; note: string }> }> };
  try {
    doc = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  } catch {
    return 0;
  }
  const byScreen = new Map(measurements.map(m => [m.screen_id, m]));
  let filled = 0;
  for (const s of doc.screens ?? []) {
    const m = byScreen.get(s.screen_id);
    if (!m) continue;
    for (const d of s.defects ?? []) {
      if (!d.element || typeof d.note !== 'string' || d.note.includes('[measure]')) continue;
      const el = m.elements.find(e => e.element_id === d.element);
      if (!el) continue;
      d.note = `${d.note.trimEnd()} ${measureNoteFor(el)}`;
      filled += 1;
    }
  }
  if (filled > 0) fs.writeFileSync(jsonPath, `${JSON.stringify(doc, null, 2)}\n`, 'utf-8');
  return filled;
}

export function renderMeasurementTable(m: ScreenMeasurement): string[] {
  const lines = [
    `▪ ${m.screen_id}  geometry=${m.axes.geometry}  content=${m.axes.content}  style=${m.axes.style}` +
      `  截图=${m.screenshot.w ?? '?'}×${m.screenshot.h ?? '?'}  参考图=${m.reference.w ?? '-'}×${m.reference.h ?? '-'}  px/vp≈${m.px_per_vp_estimate ?? '-'}`,
    '| element | bounds(px) | size(px) | Δ vs ui-spec (px) | ≈vp | tol | geometry | color |',
    '|---|---|---|---|---|---|---|---|',
  ];
  for (const e of m.elements) {
    const b = e.bounds_px;
    lines.push(
      `| ${e.element_id} | ${b ? `[${b.x1},${b.y1},${b.x2},${b.y2}]` : '-'} | ${e.size_px ? `${e.size_px.w}×${e.size_px.h}` : '-'} | ` +
        `${e.delta_px ? `(${e.delta_px.dx},${e.delta_px.dy},${e.delta_px.dw},${e.delta_px.dh})` : '-'} | ` +
        `${e.delta_vp_estimate ? `(${e.delta_vp_estimate.dx},${e.delta_vp_estimate.dy},${e.delta_vp_estimate.dw},${e.delta_vp_estimate.dh})` : '-'} | ` +
        `${e.tolerance_px ?? '-'} | ${e.geometry} | ${e.color?.device_hex ?? '-'}${e.color?.delta_e_device_vs_expected != null ? ` ΔE=${e.color.delta_e_device_vs_expected}` : ''} |`,
    );
  }
  if (m.overlaps.length > 0) lines.push(`  重叠：${m.overlaps.map(o => `${o.a}∩${o.b}`).join('、')}`);
  if (m.gaps.length > 0) lines.push(`  纵向间距：${m.gaps.map(g => `${g.a}→${g.b}=${g.gap_px}px`).join('、')}`);
  for (const f of m.layout_findings) lines.push(`  [T8 ${f.tier}] ${f.signal}: ${f.note}`);
  for (const n of m.notes) lines.push(`  · ${n}`);
  return lines;
}

export interface RunVisualMeasureOptions {
  projectRoot: string;
  frameworkRoot: string;
  feature: string;
  screen?: string;
  specVisualSources?: CheckContext['specVisualSources'];
}

/** CLI 入口（harness-runner --measure 经 profile 分派）。退出码：0 量测完成；2 无可量测输入。 */
export function runVisualMeasure(opts: RunVisualMeasureOptions): number {
  const { projectRoot, feature } = opts;
  const uiDoc = loadUiSpecFile(uiSpecAbsPath(projectRoot, feature));
  if (!uiDoc) {
    console.error(`错误: 读不到 ui-spec（${uiSpecAbsPath(projectRoot, feature)}）——--measure 只对 ui-spec 声明元素量测`);
    return 2;
  }
  const screens = (uiDoc.screens ?? []).filter(s => !opts.screen || s.id === opts.screen);
  if (screens.length === 0) {
    console.error(`错误: ui-spec 无${opts.screen ? `屏 ${opts.screen}` : '任何屏'}`);
    return 2;
  }
  const reportDir = deviceScreenshotsDir(projectRoot, feature);
  const specResolved = resolveFeatureArtifact(projectRoot, feature, 'spec.md');
  const specMd = specResolved.exists ? fs.readFileSync(specResolved.actualPath, 'utf-8') : '';
  const ctx = { projectRoot, feature, phase: 'testing', phaseRule: {}, specVisualSources: opts.specVisualSources } as unknown as CheckContext;
  const refIndex = specMd ? buildAuthoritativeRefImageIndex(ctx, specMd) : null;
  let visualDiff: { screens?: Array<{ screen_id: string; verdict?: string; evaluated_screenshot_hash?: string }> } | null = null;
  try {
    const p = path.join(reportDir, 'visual-diff.json');
    visualDiff = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf-8')) : null;
  } catch {
    visualDiff = null;
  }

  console.log(`\n📐 measure: feature=${feature}${opts.screen ? `, screen=${opts.screen}` : ''}（只测量，不裁决；不改 ui-spec / verdict）`);
  const measurements: ScreenMeasurement[] = [];
  for (const screen of screens) {
    const slug = sanitizeVisualDiffScreenSlug(screen.id);
    if (!slug) {
      console.log(`   跳过 ${screen.id}：screen_id 非法`);
      continue;
    }
    const shotAbs = path.join(reportDir, `shot-${slug}.png`);
    const layout = resolveLayoutDumpPath(reportDir, screen.id);
    const dumpPath = layout.status === 'canonical' || layout.status === 'legacy' ? layout.abs : null;
    const refAbs = refIndex ? resolveRefSourceImage(refIndex, screen.ref_id ?? screen.id).path : null;
    const m = measureScreen({
      feature,
      screen,
      doc: uiDoc,
      dump: dumpPath ? loadLayoutDumpFile(dumpPath) : null,
      dumpPath,
      dumpStatus: layout.status,
      screenshotAbs: fs.existsSync(shotAbs) ? shotAbs : null,
      referenceAbs: refAbs,
      visualDiffScreen: visualDiff?.screens?.find(s => s.screen_id === screen.id) ?? null,
    });
    measurements.push(m);
    fs.mkdirSync(reportDir, { recursive: true });
    fs.writeFileSync(path.join(reportDir, `measure-${slug}.json`), `${JSON.stringify(m, null, 2)}\n`, 'utf-8');
    for (const line of renderMeasurementTable(m)) console.log(line);
  }
  if (measurements.length === 0) return 2;
  const filled = fillVisualDiffDefectNotes(reportDir, measurements);
  console.log(`\n   量测结果：${measurements.map(m => `measure-${sanitizeVisualDiffScreenSlug(m.screen_id)}.json`).join('、')}（${path.relative(projectRoot, reportDir).replace(/\\/g, '/')}）`);
  if (filled > 0) console.log(`   visual-diff.json defects[].note 已补充 ${filled} 条量测事实（verdict 未动）`);
  console.log('   说明：geometry PASS 不等于 pixel_1to1 PASS，也不解除 visual/release block；content/style 未验证部分如实标 UNKNOWN。');
  return 0;
}
