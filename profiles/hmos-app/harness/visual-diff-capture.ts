// ============================================================================
// visual-diff-capture.ts — device_test.visual_diff 运行时截图 + 骨架生成（M4）
// 带设备副作用：归 device_test.run 层调用，不得进入 check-testing 校验 dispatch。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import type { CheckContext } from '../../../harness/scripts/utils/types';
import {
  loadUiSpecFile,
  uiSpecAbsPath,
  type UiSpecDoc,
  type UiSpecScreen,
} from '../../../harness/scripts/utils/ui-spec-shared';
import {
  buildAuthoritativeRefImageIndex,
  resolveRefSourceImage,
} from './authoritative-ref-images';
import {
  computeHistogramSimilarity,
  computeTileMinSimilarity,
  computeEdgeDensityTileDivergence,
  isJimpAvailable,
} from './image-toolkit';
import type { VisualDiffReport, VisualDiffScreenEntry } from './visual-diff-check';
import { hashScreenshotFile, isCaptureMutableVerdict } from './visual-diff-check';
import { collectP0OverlayTargetIds, isP0VisualTargetScreen } from './visual-diff-targets';

export { collectP0OverlayTargetIds } from './visual-diff-targets';

export interface VisualDiffScreenshotFnArgs {
  screenId: string;
  destAbs: string;
  bundleName?: string;
  deviceSn?: string;
}

export interface VisualDiffScreenshotFnResult {
  ok: boolean;
  error?: string;
}

export type VisualDiffScreenshotFn = (
  args: VisualDiffScreenshotFnArgs,
) => VisualDiffScreenshotFnResult;

export interface VisualDiffCaptureOptions {
  projectRoot: string;
  feature: string;
  uiDoc?: UiSpecDoc | null;
  specMd?: string | null;
  /** 注入 mock 或真实 Hylyre screenshot；缺省且无 Hylyre 时不写屏条目 */
  screenshotFn?: VisualDiffScreenshotFn;
  bundleName?: string;
  deviceSn?: string;
  /** 对 shot vs authoritative ref 写入 score_floor（jimp 不可用则跳过） */
  computeScoreFloor?: boolean;
  ctx?: Pick<CheckContext, 'projectRoot' | 'specVisualSources'>;
}

export interface VisualDiffCaptureResult {
  ok: boolean;
  jsonPath: string;
  reportDir: string;
  mdPath: string;
  screensWritten: number;
  /** 本次采集后仍保留 VL/agent 判定的屏数 */
  screensPreserved?: number;
  /** 截图 hash 变更导致 verdict 回退 pending 的屏数 */
  screensInvalidated?: number;
  errors: string[];
  /** E1：P0 顶层屏尝试采集却失败（截图失败/hash 失败/骨架失败）的 screen_id；非顶层屏跳过不计入 */
  p0CaptureFailures?: string[];
  skippedReason?: string;
}

export function deviceScreenshotsDir(projectRoot: string, feature: string): string {
  return path.join(projectRoot, 'doc', 'features', feature, 'device-testing', 'device-screenshots');
}

export function shotRelPath(feature: string, screenSlug: string): string {
  return `doc/features/${feature}/device-testing/device-screenshots/shot-${screenSlug}.png`;
}

/** screen_id → 安全文件名 slug（拒绝路径分隔与 ..） */
export function sanitizeVisualDiffScreenSlug(screenId: string): string | null {
  const trimmed = screenId.trim();
  if (!trimmed) return null;
  const slug = trimmed
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  if (!slug || slug.includes('..')) return null;
  return slug;
}

/** 解析截图相对/绝对路径，并断言落在 device-screenshots/ 内 */
export function resolveShotPaths(
  projectRoot: string,
  feature: string,
  screenId: string,
): { rel: string; abs: string; slug: string } | null {
  const slug = sanitizeVisualDiffScreenSlug(screenId);
  if (!slug) return null;
  const reportDir = path.resolve(deviceScreenshotsDir(projectRoot, feature));
  const rel = shotRelPath(feature, slug);
  const abs = path.resolve(projectRoot, rel);
  const prefix = reportDir + path.sep;
  if (abs !== reportDir && !abs.startsWith(prefix)) return null;
  return { rel, abs, slug };
}

/** MVP：navigation_frame @ order 0 视为可直达顶层屏 */
export function isLikelyTopLevelScreen(screen: UiSpecScreen): boolean {
  const root = screen.root;
  if (!root) return true;
  return root.type === 'navigation_frame' && (root.order === 0 || root.order === undefined);
}

export function collectP0CaptureTargets(uiDoc: UiSpecDoc | null): UiSpecScreen[] {
  const out: UiSpecScreen[] = [];
  for (const s of uiDoc?.screens ?? []) {
    if (isP0VisualTargetScreen(s)) out.push(s);
  }
  return out;
}

export function buildVisualDiffSkeletonEntry(
  projectRoot: string,
  feature: string,
  screen: UiSpecScreen,
  scoreFloor?: number,
  screenshotHash?: string,
): VisualDiffScreenEntry | null {
  const paths = resolveShotPaths(projectRoot, feature, screen.id);
  if (!paths) return null;
  const refId = (screen.ref_id ?? screen.id).trim();
  const row: VisualDiffScreenEntry = {
    screen_id: screen.id,
    screenshot_path: paths.rel,
    ref_id: refId,
    verdict: 'pending',
  };
  if (typeof screenshotHash === 'string' && screenshotHash.trim()) {
    row.screenshot_hash = screenshotHash.trim();
  }
  if (typeof scoreFloor === 'number' && !Number.isNaN(scoreFloor)) {
    row.score_floor = Math.max(0, Math.min(1, scoreFloor));
  }
  return row;
}

function resolveScoreFloor(
  shotAbs: string,
  refAbs: string | null,
  enabled: boolean,
): number | undefined {
  if (!enabled || !refAbs || !isJimpAvailable()) return undefined;
  const sim = computeHistogramSimilarity(shotAbs, refAbs);
  const tile = computeTileMinSimilarity(shotAbs, refAbs, 4);
  const globalSim = sim.ok && typeof sim.similarity === 'number' ? sim.similarity : undefined;
  const tileSim = tile.ok && typeof tile.similarity === 'number' ? tile.similarity : undefined;
  if (globalSim === undefined && tileSim === undefined) return undefined;
  if (globalSim === undefined) return tileSim;
  if (tileSim === undefined) return globalSim;
  return Math.min(globalSim, tileSim);
}

/** 采集层边缘哨兵：算 ref vs shot 的边缘密度 tile 散度 + 超阈 tile（与 score_floor 同一开关/同层） */
function resolveEdgeSentinel(
  shotAbs: string,
  refAbs: string | null,
  enabled: boolean,
): { divergence: number; tiles: number[][] } | undefined {
  if (!enabled || !refAbs || !isJimpAvailable()) return undefined;
  const res = computeEdgeDensityTileDivergence(refAbs, shotAbs);
  if (!res.ok || typeof res.divergence !== 'number') return undefined;
  return { divergence: res.divergence, tiles: res.tiles ?? [] };
}

/** pending/skipped 可被采集覆盖；pass/warn/fail 仅在截图 hash 未变时保留 */
export function mergeCapturedScreenEntry(
  existing: VisualDiffScreenEntry | undefined,
  captured: VisualDiffScreenEntry,
  capturedHash: string,
): VisualDiffScreenEntry {
  if (!existing || isCaptureMutableVerdict(existing.verdict)) {
    return { ...captured, screenshot_hash: capturedHash };
  }
  const evalHash = existing.evaluated_screenshot_hash?.trim();
  if (!evalHash || capturedHash !== evalHash) {
    return {
      ...captured,
      screenshot_hash: capturedHash,
      verdict: 'pending',
    };
  }
  const merged: VisualDiffScreenEntry = { ...existing };
  merged.screenshot_path = captured.screenshot_path;
  merged.screenshot_hash = capturedHash;
  if (typeof captured.score_floor === 'number') {
    merged.score_floor = captured.score_floor;
  }
  if (typeof captured.edge_tile_divergence === 'number') {
    merged.edge_tile_divergence = captured.edge_tile_divergence;
  }
  if (Array.isArray(captured.edge_over_threshold_tiles)) {
    merged.edge_over_threshold_tiles = captured.edge_over_threshold_tiles;
  }
  return merged;
}

export function mergeVisualDiffReports(
  existing: VisualDiffReport | null,
  capturedScreens: Array<{ entry: VisualDiffScreenEntry; hash: string }>,
): { report: VisualDiffReport; preserved: number; updated: number; invalidated: number } {
  const byId = new Map<string, VisualDiffScreenEntry>();
  for (const s of existing?.screens ?? []) {
    if (typeof s.screen_id === 'string' && s.screen_id.trim()) {
      byId.set(s.screen_id, s);
    }
  }
  let preserved = 0;
  let updated = 0;
  let invalidated = 0;
  for (const { entry: captured, hash } of capturedScreens) {
    const prev = byId.get(captured.screen_id);
    const merged = mergeCapturedScreenEntry(prev, captured, hash);
    if (prev && !isCaptureMutableVerdict(prev.verdict)) {
      if (merged.verdict === 'pending' && !isCaptureMutableVerdict(prev.verdict)) invalidated++;
      else preserved++;
    } else {
      updated++;
    }
    byId.set(captured.screen_id, merged);
  }
  return {
    report: {
      schema_version: existing?.schema_version ?? '1.0',
      screens: [...byId.values()],
      ...(existing?.degraded ? { degraded: existing.degraded } : {}),
      ...(existing?.degrade_reason ? { degrade_reason: existing.degrade_reason } : {}),
    },
    preserved,
    updated,
    invalidated,
  };
}

export function loadExistingVisualDiffReport(jsonPath: string): VisualDiffReport | null {
  if (!fs.existsSync(jsonPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const rep = parsed as VisualDiffReport;
    if (!Array.isArray(rep.screens)) return null;
    return rep;
  } catch {
    return null;
  }
}

function reportHasFinalizedVerdicts(report: VisualDiffReport | null): boolean {
  return (report?.screens ?? []).some(s => !isCaptureMutableVerdict(s.verdict));
}

function buildVisualDiffMdBody(report: VisualDiffReport): string {
  return [
    '# Visual diff（设备渲染回环）',
    '',
    '> harness 自动采集骨架；agent/VL 须将每屏 `verdict` 从 `pending` 填为 pass/warn/fail，并补 fidelity_score / geometric_iou / must-fix；同时将 `evaluated_screenshot_hash` 设为当前 `screenshot_hash`。',
    '',
    `screens=${report.screens.length}；json=\`device-screenshots/visual-diff.json\``,
    '',
    '## 屏清单',
    '',
    ...report.screens.map(
      s =>
        `- **${s.screen_id}**: verdict=${s.verdict}, ref_id=${s.ref_id ?? '-'}${typeof s.score_floor === 'number' ? `, score_floor=${s.score_floor.toFixed(3)}` : ''}`,
    ),
    '',
  ].join('\n');
}

/**
 * 按 ui-spec P0 屏采集截图并写入 visual-diff.json 骨架（verdict=pending）。
 * 非顶层屏跳过自动截图（由 agent 导航后重跑或手工补 shot）。
 */
export function captureVisualDiff(opts: VisualDiffCaptureOptions): VisualDiffCaptureResult {
  const errors: string[] = [];
  const uiDoc =
    opts.uiDoc !== undefined
      ? opts.uiDoc
      : loadUiSpecFile(uiSpecAbsPath(opts.projectRoot, opts.feature));
  const reportDir = deviceScreenshotsDir(opts.projectRoot, opts.feature);
  fs.mkdirSync(reportDir, { recursive: true });
  const jsonPath = path.join(reportDir, 'visual-diff.json');
  const mdPath = path.join(
    opts.projectRoot,
    'doc',
    'features',
    opts.feature,
    'device-testing',
    'visual-diff.md',
  );

  if (!opts.screenshotFn) {
    return {
      ok: false,
      jsonPath,
      reportDir,
      mdPath,
      screensWritten: 0,
      errors: ['screenshotFn 未注入；visual_diff 采集须在 device_test.run 层提供 Hylyre 或 mock'],
      skippedReason: 'no_screenshot_fn',
    };
  }

  const targets = collectP0CaptureTargets(uiDoc);
  if (targets.length === 0) {
    return {
      ok: false,
      jsonPath,
      reportDir,
      mdPath,
      screensWritten: 0,
      errors: ['ui-spec 无 P0 屏，跳过 visual_diff 采集'],
      skippedReason: 'no_p0_targets',
    };
  }

  const refIndex =
    opts.specMd && opts.ctx
      ? buildAuthoritativeRefImageIndex(opts.ctx as CheckContext, opts.specMd)
      : null;

  const capturedScreens: Array<{ entry: VisualDiffScreenEntry; hash: string }> = [];
  const p0CaptureFailures: string[] = [];
  for (const screen of targets) {
    if (!isLikelyTopLevelScreen(screen)) {
      errors.push(`${screen.id}: 非可直达顶层屏，跳过自动截图（须 device-testing 导航后补 shot）`);
      continue;
    }
    const paths = resolveShotPaths(opts.projectRoot, opts.feature, screen.id);
    if (!paths) {
      errors.push(`${screen.id}: screen_id 非法（须安全 slug，禁止路径分隔符）`);
      continue;
    }
    fs.mkdirSync(path.dirname(paths.abs), { recursive: true });
    const shot = opts.screenshotFn({
      screenId: screen.id,
      destAbs: paths.abs,
      bundleName: opts.bundleName,
      deviceSn: opts.deviceSn,
    });
    if (!shot.ok || !fs.existsSync(paths.abs)) {
      errors.push(`${screen.id}: 截图失败${shot.error ? ` — ${shot.error}` : ''}`);
      p0CaptureFailures.push(screen.id);
      continue;
    }
    const refId = (screen.ref_id ?? screen.id).trim();
    let refAbs: string | null = null;
    if (refIndex) {
      refAbs = resolveRefSourceImage(refIndex, refId).path;
    }
    const floor = resolveScoreFloor(paths.abs, refAbs, Boolean(opts.computeScoreFloor));
    const edge = resolveEdgeSentinel(paths.abs, refAbs, Boolean(opts.computeScoreFloor));
    const screenshotHash = hashScreenshotFile(paths.abs);
    if (!screenshotHash) {
      errors.push(`${screen.id}: 截图 hash 计算失败`);
      p0CaptureFailures.push(screen.id);
      continue;
    }
    const row = buildVisualDiffSkeletonEntry(opts.projectRoot, opts.feature, screen, floor, screenshotHash);
    if (!row) {
      errors.push(`${screen.id}: 骨架条目生成失败（路径校验）`);
      p0CaptureFailures.push(screen.id);
      continue;
    }
    if (edge) {
      row.edge_tile_divergence = edge.divergence;
      row.edge_over_threshold_tiles = edge.tiles;
    }
    capturedScreens.push({ entry: row, hash: screenshotHash });
  }

  for (const ov of collectP0OverlayTargetIds(uiDoc)) {
    if (capturedScreens.some(c => c.entry.screen_id === ov.id)) continue;
    const paths = resolveShotPaths(opts.projectRoot, opts.feature, ov.id);
    if (!paths) {
      errors.push(`${ov.id}: overlay screen_id 非法`);
      continue;
    }
    capturedScreens.push({
      entry: {
        screen_id: ov.id,
        screenshot_path: paths.rel,
        ref_id: ov.id,
        verdict: 'pending',
      },
      hash: fs.existsSync(paths.abs) ? (hashScreenshotFile(paths.abs) ?? '') : '',
    });
  }

  if (capturedScreens.length === 0) {
    return {
      ok: false,
      jsonPath,
      reportDir,
      mdPath,
      screensWritten: 0,
      errors: errors.length ? errors : ['无成功截图，未写入 visual-diff.json'],
      p0CaptureFailures,
      skippedReason: 'no_captures',
    };
  }

  const existingReport = loadExistingVisualDiffReport(jsonPath);
  const { report, preserved, updated, invalidated } = mergeVisualDiffReports(existingReport, capturedScreens);
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');

  if (!reportHasFinalizedVerdicts(existingReport)) {
    fs.writeFileSync(mdPath, buildVisualDiffMdBody(report), 'utf-8');
  }

  return {
    ok: true,
    jsonPath,
    reportDir,
    mdPath,
    screensWritten: updated + invalidated,
    screensPreserved: preserved,
    screensInvalidated: invalidated,
    errors,
    p0CaptureFailures,
  };
}
