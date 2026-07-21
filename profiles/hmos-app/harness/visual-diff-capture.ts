// ============================================================================
// visual-diff-capture.ts — device_test.visual_diff 运行时截图 + 骨架生成（M4）
// 带设备副作用：归 device_test.run 层调用，不得进入 check-testing 校验 dispatch。
// ============================================================================

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { canonicalJson } from '../../../harness/scripts/utils/visual-rounds-ledger';
import type { CheckContext } from '../../../harness/scripts/utils/types';
import { featureDir } from '../../../harness/config';
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
import { sampleQuiescent } from './quiescence-sampling';
import { collectP0OverlayTargetIds, isP0VisualTargetScreen, isOverlayRootScreen } from './visual-diff-targets';
import {
  evaluateScreenIdentity,
  extractLayoutDumpFacets,
  resolveNavForTargets,
  type NavConfig,
  type NavScreenIdentity,
  type NavScreenSteps,
} from './visual-diff-nav';

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

/**
 * round5 P1-A：到达某屏的导航执行器（真机侧驱动 Hylyre touch/wait/back）。
 * 采集层在对每屏 screenshot 前调用之；返回 ok:false 则该屏视为采集失败（不截错屏）。
 */
export type VisualDiffNavExecutorFn = (args: {
  screenId: string;
  steps: NavScreenSteps;
  deviceSn?: string;
  bundleName?: string;
}) => { ok: boolean; error?: string };

/**
 * t2（plan c6d8f2b4）：布局树 dump 执行器——每屏截图成功后同步 dump 运行时组件树
 * （hylyre dump-ui，hypium-ui-dump-v1），供 T8 几何不变量消费。与截图同一时点、
 * 同键持久（跳采屏不重 dump）。
 */
export type VisualDiffLayoutDumpFn = (args: {
  screenId: string;
  destAbs: string;
  deviceSn?: string;
  bundleName?: string;
}) => { ok: boolean; error?: string };

export interface VisualDiffCaptureOptions {
  projectRoot: string;
  feature: string;
  uiDoc?: UiSpecDoc | null;
  specMd?: string | null;
  /** 注入 mock 或真实 Hylyre screenshot；缺省且无 Hylyre 时不写屏条目 */
  screenshotFn?: VisualDiffScreenshotFn;
  /** round5 P1-A：每屏到达步骤的显式导航配置（key 经 X1 归一化匹配 P0 target）；缺省则不导航（沿用旧裸采行为） */
  navConfig?: NavConfig;
  /** round5 P1-A：导航执行器（真机 Hylyre）；缺省则不导航。与 navConfig 同时提供才生效 */
  navExecutorFn?: VisualDiffNavExecutorFn;
  /**
   * S2 P0-C（visual-capability-truth）：每屏页面身份锚点（resolveIdentityForTargets 产物，
   * proposed 候选须由调用方过滤）。有 identity 且 layoutDumpFn 可用时，导航后先 dump→
   * identity gate→通过才 screenshot 落正式目录；不匹配 → screen_identity_mismatch，
   * 证据图归档 _mismatch/，正式目录零写入（20260718 错页截图计入 captured 的解药）。
   */
  screenIdentity?: Map<string, NavScreenIdentity>;
  /** t2：布局树 dump 执行器；缺省 → 各屏 layout_dump_status=unavailable（能力缺失，非采集失败） */
  layoutDumpFn?: VisualDiffLayoutDumpFn;
  /**
   * t4b（f7a3d9c2，2026-07-11 真机双拍数据回填后启用）：静稳采样——shot₁→dump₁→dump₂→shot₂
   * 双稳判据（app 裁剪 hash + 布局签名）替代单 shot+dump；重试耗尽 → layout_dump_status=
   * 'unstable'（T8 降档独立 id）。**仅 pixel_1to1 装配**（check-testing 侧与 layoutDumpFn
   * 同守卫）；缺省/false=旧行为逐字节不变（t6b 守恒）。真机实测（bc-openCard 8 屏）：
   * 5/8 屏整图 hash 漂移而 app 裁剪判据 8/8 稳，动效屏 3 组内收敛——默认重试 2 已够。
   */
  quiescenceSampling?: boolean;
  bundleName?: string;
  deviceSn?: string;
  /** 对 shot vs authoritative ref 写入 score_floor（jimp 不可用则跳过） */
  computeScoreFloor?: boolean;
  ctx?: Pick<CheckContext, 'projectRoot' | 'specVisualSources'>;
  /**
   * P0-9a：当前构建指纹（调用侧**现算自实际安装 hap**，见 build-fingerprint.ts）。
   * 已定判定（pass/warn/fail）在「绑定截图文件未变 + 本指纹与其 evaluated_build_fingerprint
   * 一致」时**跳过重采**（判定持久）；null/缺省 = 指纹不可用，一律不得跳采（codex 硬前提）。
   */
  currentBuildFingerprint?: string | null;
}

export interface VisualDiffCaptureResult {
  ok: boolean;
  jsonPath: string;
  reportDir: string;
  mdPath: string;
  screensWritten: number;
  /** 本次采集后仍保留 VL/agent 判定的屏数（重采后像素恒等的退化路径，真机罕见） */
  screensPreserved?: number;
  /** 截图 hash 变更导致 verdict 回退 pending 的屏数 */
  screensInvalidated?: number;
  /** P0-9a：build 指纹有效而**跳过重采**、判定持久保留的屏数（合法新鲜，非陈旧证据） */
  screensPreservedBuildValid?: number;
  errors: string[];
  /** E1：P0 顶层屏尝试采集却失败（截图失败/hash 失败/骨架失败）的 screen_id；非顶层屏跳过不计入 */
  p0CaptureFailures?: string[];
  skippedReason?: string;
}

// P0-9 顺手项（codex）：feature artifact 路径统一走 featureDir（尊重 paths.features_dir 配置）。
export function deviceScreenshotsDir(projectRoot: string, feature: string): string {
  return path.join(featureDir(projectRoot, feature), 'device-testing', 'device-screenshots');
}

export function shotRelPath(projectRoot: string, feature: string, screenSlug: string): string {
  return path
    .relative(projectRoot, path.join(deviceScreenshotsDir(projectRoot, feature), `shot-${screenSlug}.png`))
    .replace(/\\/g, '/');
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
  const rel = shotRelPath(projectRoot, feature, slug);
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

/**
 * t2：布局树 dump 单屏执行——写 `layout-<screen_id>.json` 到 device-screenshots。
 * 无 layoutDumpFn=能力缺失（unavailable）；有但失败=failed（错误记 errors 不中断采集）。
 */
function runLayoutDump(
  opts: VisualDiffCaptureOptions,
  screenId: string,
  reportDir: string,
  errors: string[],
): 'captured' | 'failed' | 'unavailable' {
  if (!opts.layoutDumpFn) return 'unavailable';
  const destAbs = path.join(reportDir, `layout-${screenId}.json`);
  try {
    const r = opts.layoutDumpFn({ screenId, destAbs, deviceSn: opts.deviceSn, bundleName: opts.bundleName });
    if (r.ok && fs.existsSync(destAbs)) return 'captured';
    errors.push(`${screenId}: 布局树 dump 失败${r.error ? ` — ${r.error}` : ''}（截图不受影响，T8 该屏降级）`);
    return 'failed';
  } catch (e) {
    errors.push(`${screenId}: 布局树 dump 异常 — ${(e as Error).message}`);
    return 'failed';
  }
}

/**
 * t4b：单屏取材（截图+布局树）统一入口。
 * - 旧路径（缺省）：单 shot + runLayoutDump（行为逐字节不变，t6b 守恒）；
 * - 静稳路径（quiescenceSampling && layoutDumpFn）：t4a 采样器双 shot 双 dump——probe
 *   产物落 `_quiescence/`（记录含逐组 hash/签名/时间戳），final=正式 shot/dump 路径；
 *   稳 → 'captured'；重试耗尽 → 'unstable'+reason（judgment 不禁，T8 降档观测）；
 *   设备执行失败 → ok:false（与判据不稳区分，按采集失败处置）。
 */
function acquireScreenArtifacts(
  opts: VisualDiffCaptureOptions,
  screenId: string,
  shotAbs: string,
  reportDir: string,
  errors: string[],
): {
  ok: boolean;
  error?: string;
  dumpStatus: 'captured' | 'failed' | 'unavailable' | 'unstable';
  unstableReason?: string;
} {
  if (!(opts.quiescenceSampling && opts.layoutDumpFn)) {
    const shot = opts.screenshotFn!({
      screenId,
      destAbs: shotAbs,
      bundleName: opts.bundleName,
      deviceSn: opts.deviceSn,
    });
    if (!shot.ok || !fs.existsSync(shotAbs)) {
      return { ok: false, error: `截图失败${shot.error ? ` — ${shot.error}` : ''}`, dumpStatus: 'unavailable' };
    }
    return { ok: true, dumpStatus: runLayoutDump(opts, screenId, reportDir, errors) };
  }
  const qDir = path.join(reportDir, '_quiescence');
  fs.mkdirSync(qDir, { recursive: true });
  const slug = sanitizeVisualDiffScreenSlug(screenId) ?? 'screen';
  const dumpAbs = path.join(reportDir, `layout-${screenId}.json`);
  const q = sampleQuiescent({
    probeShotAbs: path.join(qDir, `shot-${slug}.probe.png`),
    probeDumpAbs: path.join(qDir, `layout-${slug}.probe.json`),
    finalShotAbs: shotAbs,
    finalDumpAbs: dumpAbs,
    fns: {
      screenshotFn: destAbs =>
        opts.screenshotFn!({ screenId, destAbs, bundleName: opts.bundleName, deviceSn: opts.deviceSn }),
      layoutDumpFn: destAbs =>
        opts.layoutDumpFn!({ screenId, destAbs, deviceSn: opts.deviceSn, bundleName: opts.bundleName }),
    },
  });
  try {
    fs.writeFileSync(
      path.join(qDir, `${slug}.records.json`),
      `${JSON.stringify({ stable: q.stable, attempts: q.attempts, unstable_reason: q.unstable_reason, records: q.records }, null, 2)}\n`,
      'utf-8',
    );
  } catch { /* 记录侧车失败不阻断取材 */ }
  if (q.error) {
    return { ok: false, error: `静稳采样失败 — ${q.error}`, dumpStatus: 'failed' };
  }
  if (!fs.existsSync(shotAbs)) {
    return { ok: false, error: '静稳采样未产出最终截图', dumpStatus: 'failed' };
  }
  if (q.stable) return { ok: true, dumpStatus: 'captured' };
  errors.push(
    `${screenId}: 静稳采样重试耗尽（${q.unstable_reason ?? 'unknown'}）——标 unstable，T8 该屏降档观测（独立 id，不阻断 candidate-pass）`,
  );
  return { ok: true, dumpStatus: 'unstable', unstableReason: q.unstable_reason };
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

/**
 * P0-9a：判定持久化——已定判定（pass/warn/fail）可跳过重采的判据。
 * 硬前提（codex，缺一不可）：①当前构建指纹已成功现算（非 null）；②条目带
 * evaluated_build_fingerprint 且与当前指纹一致（缺失=legacy → 不跳，照常重采失效）；
 * ③evaluated_screenshot_hash 存在且与**盘上绑定截图文件**一致（文件未被替换/删除）。
 * 满足则该屏判定（含真人 confirmed_by）跨 harness 轮持久；build 一变（改码重装）自动失效。
 * 背景：像素恒等作新鲜度键被真机证伪（状态栏时钟/轮播必漂移，2026-07-05 回修轮实锤）。
 */
export function canSkipRecaptureForScreen(
  prev: VisualDiffScreenEntry | undefined,
  projectRoot: string,
  currentBuildFingerprint: string | null | undefined,
): boolean {
  if (!prev || isCaptureMutableVerdict(prev.verdict)) return false;
  if (typeof currentBuildFingerprint !== 'string' || !currentBuildFingerprint.trim()) return false;
  const fp = prev.evaluated_build_fingerprint?.trim();
  if (!fp || fp !== currentBuildFingerprint.trim()) return false;
  const evalHash = prev.evaluated_screenshot_hash?.trim();
  if (!evalHash) return false;
  const shot = prev.screenshot_path;
  if (typeof shot !== 'string' || !shot.trim()) return false;
  const abs = path.isAbsolute(shot) ? shot : path.resolve(projectRoot, shot);
  const fileHash = hashScreenshotFile(abs);
  return fileHash !== null && fileHash === evalHash;
}

/**
 * pending/skipped 可被采集覆盖；pass/warn/fail 仅在「截图 hash 未变 **且** build 指纹一致
 * （当前指纹可算时，codex P1：换 build 后即便新截图字节恰好相同也必须重判——改码必重判）」时保留。
 * currentBuildFingerprint 缺省/null = 指纹不可用 → 退回纯 hash 判据（静态夹具/交互态兼容）。
 */
export function mergeCapturedScreenEntry(
  existing: VisualDiffScreenEntry | undefined,
  captured: VisualDiffScreenEntry,
  capturedHash: string,
  currentBuildFingerprint?: string | null,
): VisualDiffScreenEntry {
  if (!existing || isCaptureMutableVerdict(existing.verdict)) {
    return { ...captured, screenshot_hash: capturedHash };
  }
  const evalHash = existing.evaluated_screenshot_hash?.trim();
  const currentFp = currentBuildFingerprint?.trim();
  const fpOk = !currentFp || existing.evaluated_build_fingerprint?.trim() === currentFp;
  if (!evalHash || capturedHash !== evalHash || !fpOk) {
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
  // t2：本轮真跑过 dump 则更新状态（保留判定不受影响——评估/采集新鲜度解耦）
  if (captured.layout_dump_status) {
    merged.layout_dump_status = captured.layout_dump_status;
    // t4b：unstable 原因随状态同步（非 unstable 轮清掉旧 reason）
    if (captured.layout_dump_unstable_reason) {
      merged.layout_dump_unstable_reason = captured.layout_dump_unstable_reason;
    } else {
      delete merged.layout_dump_unstable_reason;
    }
  }
  return merged;
}

export function mergeVisualDiffReports(
  existing: VisualDiffReport | null,
  capturedScreens: Array<{ entry: VisualDiffScreenEntry; hash: string }>,
  currentBuildFingerprint?: string | null,
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
    const merged = mergeCapturedScreenEntry(prev, captured, hash, currentBuildFingerprint);
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
      // t8（rev7）：capture 会写入 1.1 字段（layout_dump_status 等），新报告/合并报告一律标 1.1
      //（legacy 1.0 读入由 validateVisualDiffJson 映射兼容，升版无破坏）。
      schema_version: '1.1',
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

/** 各屏 screenshot_hash 分组：返回 ≥2 屏共享 hash 的组（采集完整性/撞图检测，与 visual-diff-check dedup 同口径）。 */
export function collectDuplicateHashGroups(report: VisualDiffReport): string[] {
  const groups = new Map<string, string[]>();
  for (const s of report.screens) {
    const h = s.screenshot_hash?.trim();
    if (!h) continue;
    const list = groups.get(h) ?? [];
    list.push(s.screen_id);
    groups.set(h, list);
  }
  return [...groups.entries()]
    .filter(([, ids]) => ids.length >= 2)
    .map(([h, ids]) => `${h}: ${ids.join(' + ')}`);
}

/**
 * round5 P1-C：visual-diff.md 为 visual-diff.json 的**纯投影**，每次采集后无条件再生（不再"定型后不再生成"）。
 * 含「采集完整性」节（hash 唯一性 / P0 采集失败 / 未判屏），根除手写散文与 JSON 背离（曾出现 md 手写
 * "6 屏 hash 均已唯一"而 JSON 实为 5 屏同 hash 的谎言）。门禁结论始终以 JSON 为准。
 */
export function buildVisualDiffMdBody(
  report: VisualDiffReport,
  opts?: { p0CaptureFailures?: string[]; preservedBuildValidIds?: string[] },
): string {
  const dupGroups = collectDuplicateHashGroups(report);
  const noHashScreens = report.screens.filter(s => !s.screenshot_hash?.trim()).map(s => s.screen_id);
  const pendingScreens = report.screens.filter(s => s.verdict === 'pending').map(s => s.screen_id);
  const p0Fail = (opts?.p0CaptureFailures ?? []).filter(f => typeof f === 'string' && f.trim());
  return [
    '# Visual diff（设备渲染回环）',
    '',
    '> 本文件由 harness 从 `device-screenshots/visual-diff.json` **自动生成，请勿手改**——门禁结论始终以 JSON 为准。',
    '> agent/VL 须在 **JSON**（结构化）填每屏 `verdict`（pass/warn/fail）+ `must_fix`/`defects[]`/`region_attest[]` + `evaluated_screenshot_hash`（`reported_fidelity_score`/`reported_geometric_iou` 为参考自评、零 gate 权重）；勿在本 md 手写与 JSON 矛盾的结论。',
    '',
    `screens=${report.screens.length}；json=\`device-screenshots/visual-diff.json\`${report.degraded ? '；degraded' : ''}`,
    '',
    '## 屏清单',
    '',
    '| screen_id | verdict | score_floor | must_fix |',
    '|-----------|---------|-------------|----------|',
    ...report.screens.map(s => {
      const floor = typeof s.score_floor === 'number' ? s.score_floor.toFixed(3) : '-';
      const mf = (s.must_fix ?? []).join('；').replace(/\|/g, '\\|') || '-';
      return `| ${s.screen_id} | ${s.verdict} | ${floor} | ${mf} |`;
    }),
    '',
    '## 采集完整性',
    '',
    dupGroups.length > 0
      ? `- ✗ **screenshot_hash 非唯一（疑似 Tab 未切换/重复采集，至少一屏为错图）**：${dupGroups.join('；')}`
      : '- ✓ 各屏 screenshot_hash 唯一',
    `- P0 采集失败：${p0Fail.length > 0 ? p0Fail.join(', ') : '无'}`,
    `- 缺截图（无 hash）：${noHashScreens.length > 0 ? noHashScreens.join(', ') : '无'}`,
    `- 未判定（verdict=pending）：${pendingScreens.length > 0 ? pendingScreens.join(', ') : '无'}`,
    ...((opts?.preservedBuildValidIds?.length ?? 0) > 0
      ? [`- build 指纹有效跳采（判定持久，P0-9a）：${opts!.preservedBuildValidIds!.join(', ')}`]
      : []),
    '',
  ].join('\n');
}

/**
 * 按 ui-spec P0 屏采集截图并写入 visual-diff.json 骨架（verdict=pending）。
 * 非顶层屏跳过自动截图（由 agent 导航后重跑或手工补 shot）。
 */
/** identity 规则指纹（skip 旁路封堵：identity 变更/从未验证过身份的旧截图不得跳采） */
export function identityFingerprintOf(identity: NavScreenIdentity): string {
  return crypto.createHash('sha256').update(canonicalJson(identity)).digest('hex').slice(0, 16);
}

/**
 * codex 实施 review P1-3：build 指纹跳采的 identity 维度——屏有**已确认** identity 时，
 * 旧 entry 必须携带相同 identity_fingerprint（该截图曾过同一身份规则）才可跳采；
 * identity 新增/变更、或旧图从未验身份（可能本来就是错页）→ 不得跳采。
 */
export function skipAllowedByIdentity(
  entry: VisualDiffScreenEntry | undefined,
  identity: NavScreenIdentity | undefined,
): boolean {
  if (!identity || identity.proposed === true) return true;
  const fp = identityFingerprintOf(identity);
  return (entry as { identity_fingerprint?: string } | undefined)?.identity_fingerprint === fp;
}

/**
 * S2 P0-C：页面身份 gate——navigate 后、screenshot 落正式目录前执行。
 * 顺序契约：navigate → dump uitree（_identity 探测位）→ identity gate → screenshot →
 * canonical write。无 identity/proposed 候选/无 dump 能力 → 直接放行（强制策略由
 * validateNavConfigV2 的 requireConfirmedIdentity 在校验层管）。
 */
function runScreenIdentityGate(
  opts: VisualDiffCaptureOptions,
  screenId: string,
  reportDir: string,
): { ok: boolean; detail?: string } {
  const identity = opts.screenIdentity?.get(screenId);
  if (!identity || identity.proposed === true) return { ok: true };
  if (!opts.layoutDumpFn) return { ok: true };
  const slug = sanitizeVisualDiffScreenSlug(screenId) ?? 'screen';
  const probeAbs = path.join(reportDir, '_identity', `layout-${slug}.json`);
  try {
    fs.mkdirSync(path.dirname(probeAbs), { recursive: true });
  } catch {
    /* mkdir 失败随 dump 失败一并报 */
  }
  const d = opts.layoutDumpFn({
    screenId,
    destAbs: probeAbs,
    deviceSn: opts.deviceSn,
    bundleName: opts.bundleName,
  });
  if (!d.ok) {
    return { ok: false, detail: `identity 探测 dump 失败${d.error ? ` — ${d.error}` : ''}（身份未验不得落正式截图）` };
  }
  let json: unknown;
  try {
    json = JSON.parse(fs.readFileSync(probeAbs, 'utf-8'));
  } catch (e) {
    return { ok: false, detail: `identity dump 不可解析：${(e as Error).message}` };
  }
  const ev = evaluateScreenIdentity(identity, extractLayoutDumpFacets(json));
  if (!ev.ok) {
    const evidenceAbs = path.join(reportDir, '_mismatch', `shot-${slug}.png`);
    try {
      fs.mkdirSync(path.dirname(evidenceAbs), { recursive: true });
      opts.screenshotFn?.({ screenId, destAbs: evidenceAbs, bundleName: opts.bundleName, deviceSn: opts.deviceSn });
    } catch {
      /* 证据图 best-effort，不影响 mismatch 判定 */
    }
    return {
      ok: false,
      detail: `screen_identity_mismatch — ${ev.detail}（证据图 _mismatch/shot-${slug}.png；正式目录零写入）`,
    };
  }
  return { ok: true };
}

export function captureVisualDiff(opts: VisualDiffCaptureOptions): VisualDiffCaptureResult {
  const errors: string[] = [];
  const uiDoc =
    opts.uiDoc !== undefined
      ? opts.uiDoc
      : loadUiSpecFile(uiSpecAbsPath(opts.projectRoot, opts.feature));
  const reportDir = deviceScreenshotsDir(opts.projectRoot, opts.feature);
  fs.mkdirSync(reportDir, { recursive: true });
  const jsonPath = path.join(reportDir, 'visual-diff.json');
  const mdPath = path.join(featureDir(opts.projectRoot, opts.feature), 'device-testing', 'visual-diff.md');

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

  // round5 P1-A：有 nav 配置 + executor 时，按屏导航到位再截（含非顶层屏），根除"多屏截同一帧"。
  // 屏 id 经 X1 归一化匹配（screen_id/ref_id/overlay_id/nav_key），overlay 亦纳入解析。
  const navEnabled = Boolean(opts.navConfig && opts.navExecutorFn);
  const navResolve = navEnabled
    ? resolveNavForTargets(opts.navConfig as NavConfig, [
        ...targets.map(t => t.id),
        ...collectP0OverlayTargetIds(uiDoc).map(o => o.id),
      ])
    : null;

  // P0-9a：判定持久化——先读既有报告，build 指纹有效的已定屏跳过重采（判定含真人签持久）。
  const existingReportEarly = loadExistingVisualDiffReport(jsonPath);
  const existingById = new Map<string, VisualDiffScreenEntry>(
    (existingReportEarly?.screens ?? [])
      .filter(s => typeof s.screen_id === 'string' && s.screen_id.trim())
      .map(s => [s.screen_id, s]),
  );
  const currentFp =
    typeof opts.currentBuildFingerprint === 'string' && opts.currentBuildFingerprint.trim()
      ? opts.currentBuildFingerprint.trim()
      : null;
  const preservedBuildValidIds: string[] = [];

  const capturedScreens: Array<{ entry: VisualDiffScreenEntry; hash: string }> = [];
  const p0CaptureFailures: string[] = [];
  for (const screen of targets) {
    // root 即 overlay 的 base 屏（manage_non_local）由下方 overlay 循环采集，主循环跳过（避免重复/误判缺 nav）。
    if (isOverlayRootScreen(screen)) continue;
    if (
      canSkipRecaptureForScreen(existingById.get(screen.id), opts.projectRoot, currentFp) &&
      skipAllowedByIdentity(existingById.get(screen.id), opts.screenIdentity?.get(screen.id))
    ) {
      preservedBuildValidIds.push(screen.id);
      continue;
    }
    const navSteps = navResolve?.resolved.get(screen.id);
    // P1-A：启用 nav 后，每个 P0 屏都须在配置里有到达步骤条目——缺条目即**拒绝裸采**（防多屏截同一帧），记 p0 失败。
    if (navEnabled && navSteps === undefined) {
      errors.push(`${screen.id}: nav 配置未覆盖该 P0 屏（拒绝裸采以防多屏截同一帧，须补 visual-diff-nav 到达步骤）`);
      p0CaptureFailures.push(screen.id);
      continue;
    }
    const hasNav = navEnabled && navSteps !== undefined;
    // 未启用 nav 时：非可直达顶层屏沿旧行为跳过（须补 nav 配置）。
    if (!isLikelyTopLevelScreen(screen) && !hasNav) {
      errors.push(`${screen.id}: 非可直达顶层屏且无 nav 配置，跳过自动截图（须补 device-testing/visual-diff-nav 到达步骤）`);
      continue;
    }
    const paths = resolveShotPaths(opts.projectRoot, opts.feature, screen.id);
    if (!paths) {
      errors.push(`${screen.id}: screen_id 非法（须安全 slug，禁止路径分隔符）`);
      continue;
    }
    fs.mkdirSync(path.dirname(paths.abs), { recursive: true });
    // P1-A：截图前先导航到位（有 executor 时）；导航失败 → 记 P0 采集失败，绝不截错屏。
    if (navEnabled) {
      const nav = opts.navExecutorFn!({
        screenId: screen.id,
        steps: navSteps ?? [],
        deviceSn: opts.deviceSn,
        bundleName: opts.bundleName,
      });
      if (!nav.ok) {
        errors.push(`${screen.id}: 导航失败${nav.error ? ` — ${nav.error}` : ''}（未截图，避免截错屏）`);
        p0CaptureFailures.push(screen.id);
        continue;
      }
    }
    // S2 P0-C：identity gate（dump→判定）先于任何正式截图落盘
    const idGate = runScreenIdentityGate(opts, screen.id, reportDir);
    if (!idGate.ok) {
      errors.push(`${screen.id}: ${idGate.detail}`);
      p0CaptureFailures.push(screen.id);
      continue;
    }
    // t2/t4b：取材统一入口——旧路径=单 shot+dump；静稳路径=双 shot 双 dump（仅 pixel_1to1 装配）
    const acq = acquireScreenArtifacts(opts, screen.id, paths.abs, reportDir, errors);
    if (!acq.ok) {
      errors.push(`${screen.id}: ${acq.error ?? '取材失败'}`);
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
    row.layout_dump_status = acq.dumpStatus;
    if (acq.unstableReason) row.layout_dump_unstable_reason = acq.unstableReason;
    // P0-9a：机器盖构建指纹戳（agent 无须也不应手填）——后续判定即绑定本构建。
    if (currentFp) row.evaluated_build_fingerprint = currentFp;
    // P1-3：本截图通过的身份规则指纹——后续同 build 跳采须 identity 未变才合法
    const idnMain = opts.screenIdentity?.get(screen.id);
    if (idnMain && idnMain.proposed !== true) {
      (row as { identity_fingerprint?: string }).identity_fingerprint = identityFingerprintOf(idnMain);
    }
    capturedScreens.push({ entry: row, hash: screenshotHash });
  }

  for (const ov of collectP0OverlayTargetIds(uiDoc)) {
    if (capturedScreens.some(c => c.entry.screen_id === ov.id)) continue;
    if (
      canSkipRecaptureForScreen(existingById.get(ov.id), opts.projectRoot, currentFp) &&
      skipAllowedByIdentity(existingById.get(ov.id), opts.screenIdentity?.get(ov.id))
    ) {
      preservedBuildValidIds.push(ov.id);
      continue;
    }
    const paths = resolveShotPaths(opts.projectRoot, opts.feature, ov.id);
    if (!paths) {
      errors.push(`${ov.id}: overlay screen_id 非法`);
      continue;
    }
    // P1-A：overlay 是子态（半模态），有 nav 到达步骤则导航拉起后再截；否则沿旧行为仅登记 pending 骨架。
    const ovSteps = navResolve?.resolved.get(ov.id);
    if (navEnabled && ovSteps !== undefined) {
      fs.mkdirSync(path.dirname(paths.abs), { recursive: true });
      const nav = opts.navExecutorFn!({ screenId: ov.id, steps: ovSteps, deviceSn: opts.deviceSn, bundleName: opts.bundleName });
      if (!nav.ok) {
        errors.push(`${ov.id}: overlay 导航失败${nav.error ? ` — ${nav.error}` : ''}（未截图，避免截错屏）`);
        p0CaptureFailures.push(ov.id);
        continue;
      }
      // S2 P0-C：overlay 同样过 identity gate（sheet 开启态身份）
      const ovIdGate = runScreenIdentityGate(opts, ov.id, reportDir);
      if (!ovIdGate.ok) {
        errors.push(`${ov.id}: ${ovIdGate.detail}`);
        p0CaptureFailures.push(ov.id);
        continue;
      }
      // t2/t4b：overlay 屏在 sheet 开启态（导航后）取材——与主屏同一统一入口
      const acq = acquireScreenArtifacts(opts, ov.id, paths.abs, reportDir, errors);
      if (!acq.ok) {
        errors.push(`${ov.id}: overlay ${acq.error ?? '取材失败'}`);
        p0CaptureFailures.push(ov.id);
        continue;
      }
      // overlay 的参考图取其基屏（parentScreenId）——与 visual-diff.json ref_id=基屏 一致。
      const refId = ov.parentScreenId;
      const refAbs = refIndex ? resolveRefSourceImage(refIndex, refId).path : null;
      const floor = resolveScoreFloor(paths.abs, refAbs, Boolean(opts.computeScoreFloor));
      const edge = resolveEdgeSentinel(paths.abs, refAbs, Boolean(opts.computeScoreFloor));
      const screenshotHash = hashScreenshotFile(paths.abs);
      if (!screenshotHash) {
        errors.push(`${ov.id}: overlay 截图 hash 计算失败`);
        p0CaptureFailures.push(ov.id);
        continue;
      }
      const row: VisualDiffScreenEntry = { screen_id: ov.id, screenshot_path: paths.rel, ref_id: refId, verdict: 'pending' };
      if (typeof floor === 'number' && !Number.isNaN(floor)) row.score_floor = Math.max(0, Math.min(1, floor));
      row.screenshot_hash = screenshotHash;
      if (currentFp) row.evaluated_build_fingerprint = currentFp;
      if (edge) { row.edge_tile_divergence = edge.divergence; row.edge_over_threshold_tiles = edge.tiles; }
      row.layout_dump_status = acq.dumpStatus;
      if (acq.unstableReason) row.layout_dump_unstable_reason = acq.unstableReason;
      const idnOv = opts.screenIdentity?.get(ov.id);
      if (idnOv && idnOv.proposed !== true) {
        (row as { identity_fingerprint?: string }).identity_fingerprint = identityFingerprintOf(idnOv);
      }
      capturedScreens.push({ entry: row, hash: screenshotHash });
      continue;
    }
    capturedScreens.push({
      entry: {
        screen_id: ov.id,
        screenshot_path: paths.rel,
        ref_id: ov.parentScreenId,
        verdict: 'pending',
      },
      hash: fs.existsSync(paths.abs) ? (hashScreenshotFile(paths.abs) ?? '') : '',
    });
  }

  if (capturedScreens.length === 0) {
    // P0-9a：全部屏均因 build 指纹有效而合法跳采（判定持久）→ 非"无采集"失败，md 照常再生。
    if (preservedBuildValidIds.length > 0 && p0CaptureFailures.length === 0 && existingReportEarly) {
      fs.writeFileSync(
        mdPath,
        buildVisualDiffMdBody(existingReportEarly, { p0CaptureFailures, preservedBuildValidIds }),
        'utf-8',
      );
      return {
        ok: true,
        jsonPath,
        reportDir,
        mdPath,
        screensWritten: 0,
        screensPreserved: 0,
        screensInvalidated: 0,
        screensPreservedBuildValid: preservedBuildValidIds.length,
        errors,
        p0CaptureFailures,
      };
    }
    return {
      ok: false,
      jsonPath,
      reportDir,
      mdPath,
      screensWritten: 0,
      ...(preservedBuildValidIds.length > 0
        ? { screensPreservedBuildValid: preservedBuildValidIds.length }
        : {}),
      errors: errors.length ? errors : ['无成功截图，未写入 visual-diff.json'],
      p0CaptureFailures,
      skippedReason: 'no_captures',
    };
  }

  const { report, preserved, updated, invalidated } = mergeVisualDiffReports(existingReportEarly, capturedScreens, currentFp);
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');

  // P1-C：md 为 JSON 纯投影，每次无条件再生（不再"定型后不再生成"，根除手写散文与 JSON 背离）。
  fs.writeFileSync(mdPath, buildVisualDiffMdBody(report, { p0CaptureFailures, preservedBuildValidIds }), 'utf-8');

  return {
    ok: true,
    jsonPath,
    reportDir,
    mdPath,
    screensWritten: updated + invalidated,
    screensPreserved: preserved,
    screensInvalidated: invalidated,
    screensPreservedBuildValid: preservedBuildValidIds.length,
    errors,
    p0CaptureFailures,
  };
}
