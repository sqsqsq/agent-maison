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
import {
  collectP0OverlayTargetIds,
  isP0VisualTargetScreen,
  isOverlayRootScreen,
  resolveGoldenCaptureTargets,
  type GoldenForbiddenTarget,
  type GoldenScreenTarget,
} from './visual-diff-targets';
import {
  evaluateScreenIdentity,
  extractLayoutDumpFacets,
  resolveNavForTargets,
  type NavConfig,
  type NavScreenIdentity,
  type NavScreenSteps,
} from './visual-diff-nav';
// T5 接线：采集失败即崩溃诊断（此前本模块零生产调用方）
import {
  archiveTimeoutDiagnosis,
  diagnoseNavigationFailure,
  makeHdcCrashProbeDeps,
  renderDiagnosis,
  snapshotFaultlogSet,
  type CrashProbeDeps,
} from './device-crash-diagnostics';

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
  /** v23 F3：崩溃诊断依赖注入（缺省走真机 hdc）；单测用它免真机 */
  crashProbeDeps?: CrashProbeDeps;
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
  /**
   * c4e8b1d3 G3：golden 显式 capture targets（consumer golden 回归专用）。
   * 缺省时读 env MAISON_GOLDEN_CONTRACT（指向随包 contract JSON）；两者都无 = 普通
   * visual-diff，保持 P0-only。显式目标不受 P0 过滤；解析失败 fail-closed 计入采集失败。
   */
  goldenTargets?: GoldenScreenTarget[];
  /**
   * round20 P1：golden 负向目标（HomeTab forbidden anchor 的证据**生产**接线）。
   * 缺省随 env contract 装载；golden 模式下逐条导航 + UITree dump，写 wrapper 证据
   *（run_id + build fp 绑定）；nav/dumpFn 缺失或导航失败 → fail-closed 记采集失败。
   */
  goldenForbidden?: GoldenForbiddenTarget[];
}

export interface GoldenContractEnvLoad {
  /** env 未设 → null（普通模式）；设了 → contract positive_screens 条目 */
  targets: GoldenScreenTarget[] | null;
  /** env 未设 / contract 无 forbidden 数组 → [] */
  forbidden: GoldenForbiddenTarget[];
}

/**
 * env MAISON_GOLDEN_CONTRACT → positive_screens + forbidden 的**单次**装载（两字段同文件、
 * 单次 JSON.parse——调用方解析一次后显式传给消费方，不得各自重读 env）。
 * 未设 env → { targets: null, forbidden: [] }（普通模式）。
 * 设了却读不出（路径错/JSON 坏/shape 非法）→ 抛错（fail-closed：golden 回归不许静默降级成 P0-only）。
 */
export function loadGoldenContractFromEnv(projectRoot: string): GoldenContractEnvLoad {
  const raw = process.env.MAISON_GOLDEN_CONTRACT?.trim();
  if (!raw) return { targets: null, forbidden: [] };
  const abs = path.isAbsolute(raw) ? raw : path.resolve(projectRoot, raw);
  if (!fs.existsSync(abs)) {
    throw new Error(`[golden-contract] MAISON_GOLDEN_CONTRACT 指向的文件不存在：${abs}`);
  }
  const doc = JSON.parse(fs.readFileSync(abs, 'utf-8')) as { positive_screens?: unknown; forbidden?: unknown };
  if (!Array.isArray(doc.positive_screens) || doc.positive_screens.length === 0) {
    throw new Error(`[golden-contract] contract 缺 positive_screens：${abs}`);
  }
  const targets: GoldenScreenTarget[] = [];
  for (const s of doc.positive_screens as Array<Record<string, unknown>>) {
    if (typeof s?.declared !== 'string' || typeof s?.capture !== 'string' || !s.declared || !s.capture) {
      throw new Error(`[golden-contract] positive_screens 条目 shape 非法：${JSON.stringify(s)}`);
    }
    targets.push({ declared: s.declared, capture: s.capture });
  }
  const forbidden: GoldenForbiddenTarget[] = [];
  for (const f of (Array.isArray(doc.forbidden) ? doc.forbidden : []) as Array<Record<string, unknown>>) {
    if (typeof f?.id !== 'string' || typeof f?.anchor !== 'string' || typeof f?.evidence !== 'string' ||
        !f.id || !f.anchor || !f.evidence) {
      throw new Error(`[golden-contract] forbidden 条目 shape 非法：${JSON.stringify(f)}`);
    }
    forbidden.push({ id: f.id, anchor: f.anchor, evidence: f.evidence });
  }
  return { targets, forbidden };
}

/** env MAISON_GOLDEN_CONTRACT → contract 的 positive_screens；未设/不可读 → null（普通模式）。
 * 设了却读不出（路径错/JSON 坏/shape 非法）→ 抛错（fail-closed：golden 回归不许静默降级成 P0-only）。
 * （委托 loadGoldenContractFromEnv——同一解析器，避免第二套 golden contract 解析。） */
export function loadGoldenContractTargetsFromEnv(projectRoot: string): GoldenScreenTarget[] | null {
  return loadGoldenContractFromEnv(projectRoot).targets;
}

/** env contract 的 forbidden 负向目标（round20 P1：证据生产接线的输入）；未设 env → []；
 * 设了但条目 shape 非法 → 抛错（与 targets 装载器同 fail-closed 语义）。 */
export function loadGoldenContractForbiddenFromEnv(projectRoot: string): GoldenForbiddenTarget[] {
  return loadGoldenContractFromEnv(projectRoot).forbidden;
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
  /**
   * t4（plan f3a8c6d2）：本轮视觉熔断资格的**唯一裁决**（单点产出/单点消费）。
   * 矩阵与依赖见 `VisualFuseEligibility` 注释。
   */
  fuseEligibility?: VisualFuseEligibility;
  skippedReason?: string;
}

// P0-9 顺手项（codex）：feature artifact 路径统一走 featureDir（尊重 paths.features_dir 配置）。
// plan d8c5f3a7 T4 接线：截图批绑定装机会话（未登记的截图来源不可追溯 → verify 判断链）

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

/** 崩溃诊断归档根：`device-testing/reports`（消费者按同一口径回读，见 goal-runner 的确定性缺陷收集） */
function testingReportsDirForDiag(projectRoot: string, feature: string): string {
  return path.join(featureDir(projectRoot, feature), 'device-testing', 'reports');
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

// --- t2b（plan c6d8f2b4，2026-08-12 宿主实测纠偏项）：布局 dump 统一寻址 ---
// 事故：写侧用 raw `layout-<screen_id>.json`，读侧有的也用 raw、有的用 slug
// （sanitizeVisualDiffScreenSlug）——两套命名并存。宿主 out-of-band 采集按 slug 命名，
// overlay 屏（`select_card_type_sheet__overlay__…` 双下划线压成单下划线）对不上，
// 把命名问题误导成「文件被删或损坏，须重采」。
// 落点：新写入统一 canonical slug（`layout-<slug>.json`）；读取按 canonical 优先，
// legacy raw 仅作兼容 fallback；raw 与 slug 同时存在、或不同 screen_id 归一后 slug
// 冲突 → fail-closed（不做无优先级的双查——否则可能读到旧文件且无法判别）。
// ----------------------------------------------------------------------------

/** layout dump 的 canonical 文件名：`layout-<slug>.json`（slug=sanitizeVisualDiffScreenSlug）。 */
export function layoutDumpCanonicalFileName(screenId: string): string | null {
  const slug = sanitizeVisualDiffScreenSlug(screenId);
  if (!slug) return null;
  return `layout-${slug}.json`;
}

/** legacy raw 文件名：`layout-<raw screen_id>.json`（历史口径；仅作兼容 fallback）。 */
export function layoutDumpLegacyFileName(screenId: string): string {
  return `layout-${screenId}.json`;
}

export type LayoutDumpResolvedPath =
  | { status: 'canonical'; abs: string; rel: string }
  | { status: 'legacy'; abs: string; rel: string }
  | { status: 'conflict'; canonicalAbs: string; legacyAbs: string }
  | { status: 'missing' };

/**
 * 统一解析某屏 layout dump 的落盘文件（device-screenshots 目录内）。
 * - canonical 文件存在 → 用之；
 * - 仅 legacy raw 文件存在（且与 canonical 不同名）→ 兼容回退，rel 标注 legacy；
 * - 两者同时存在 → conflict（fail-closed：不得无优先级双查）；
 * - 均不存在且 screen_id 本身已是合法 slug（canonical 与 legacy 同名）→ missing；
 * - screen_id 非法（sanitize 拒绝）→ missing。
 * 不同 screen_id 归一后 slug 冲突由调用方（capture 层）在目标集合上 fail-closed。
 */
export function resolveLayoutDumpPath(
  reportDir: string,
  screenId: string,
): LayoutDumpResolvedPath {
  const canonicalName = layoutDumpCanonicalFileName(screenId);
  if (!canonicalName) return { status: 'missing' };
  const canonicalAbs = path.join(reportDir, canonicalName);
  const legacyName = layoutDumpLegacyFileName(screenId);
  const legacyAbs = legacyName === canonicalName ? '' : path.join(reportDir, legacyName);
  const hasCanonical = fs.existsSync(canonicalAbs);
  const hasLegacy = legacyAbs !== '' && fs.existsSync(legacyAbs);
  if (hasCanonical && hasLegacy) {
    return { status: 'conflict', canonicalAbs, legacyAbs };
  }
  if (hasCanonical) {
    return { status: 'canonical', abs: canonicalAbs, rel: canonicalName };
  }
  if (hasLegacy) {
    return { status: 'legacy', abs: legacyAbs, rel: legacyName };
  }
  return { status: 'missing' };
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
 * t2：布局树 dump 单屏执行——写 `layout-<slug>.json`（canonical；t2b 统一寻址，
 * legacy raw 名仅作读取兼容）。无 layoutDumpFn=能力缺失（unavailable）；
 * 有但失败=failed（错误记 errors 不中断采集）。
 */
function runLayoutDump(
  opts: VisualDiffCaptureOptions,
  screenId: string,
  reportDir: string,
  errors: string[],
): 'captured' | 'failed' | 'unavailable' {
  if (!opts.layoutDumpFn) return 'unavailable';
  const canonicalName = layoutDumpCanonicalFileName(screenId);
  if (!canonicalName) {
    errors.push(`${screenId}: screen_id 非法（sanitize 拒绝），无法写布局树 dump`);
    return 'failed';
  }
  const destAbs = path.join(reportDir, canonicalName);
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
  // t2b：canonical slug 命名（与 runLayoutDump 同口径）
  const dumpAbs = path.join(reportDir, layoutDumpCanonicalFileName(screenId) ?? `layout-${slug}.json`);
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
 * 满足则该屏的 hash-bound 机器判定可跨 harness 轮复用；build 一变（改码重装）自动失效。
 * legacy confirmed_by 仅随条目保留，不参与该判据。
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
  // round19 P1：字节恒等的保留路径也更新 run 戳——该屏本轮确实被重采（真值），
  // golden run 绑定校验才不会把"重采后像素恒等"误判成跨 run 复用。
  if (captured.captured_in_run) merged.captured_in_run = captured.captured_in_run;
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

/**
 * t4（plan f3a8c6d2）：**视觉熔断资格的唯一裁决对象**。
 *
 * 收敛动机（review 四轮后的方法论修正）：此前"本轮能否参与熔断"的事实散落在
 * CheckResult 分类、capture 结果、以及三个可能互相矛盾的 ctx 字段里，生产者与消费者
 * 可以各自"正确"而组合错误——判据换了四版（device id 白名单 → element_absent →
 * screensWritten 批次代理 → identity mismatch → results 扫描），每修掉一个局部反例
 * 就冒出新的。故改为**单点产出、单点消费**：由 capture 产出本对象，外层只在
 * capture 未运行时补一条 `capture_not_run`。这是**删机制**，不新增状态/协议。
 *
 * 资格矩阵（穷举，勿再局部打补丁）：
 *   | 本轮事实                                   | eligible |
 *   |--------------------------------------------|----------|
 *   | capture 根本未执行                          | false（外层补 capture_not_run） |
 *   | dump / 截图 / 解析失败                      | false |
 *   | 缺屏中任一为 probe_failed（锁屏/桌面/系统态或 dump 能力缺失） | false（整轮） |
 *   | 缺屏无对应 screenEvidence（导航失败/采集失败等环境阻断）      | false（整轮） |
 *   | 所有 P0 缺屏均确证 mismatched（应用页面树在场但非目标页）      | true（进 missing_screen） |
 *   | 当前截图成功且存在视觉缺陷                   | true（既有 defects 通道） |
 *
 * t3 收口（2026-08-13 宿主校准）：mismatched 现为**确定性**内容正证据——身份不中 +
 * 页面组件前缀在场，即应用页面树在场但渲染了非目标页；锁屏/桌面系统态 dump
 * （含仅宿主 bundle 图标的桌面 dump）前缀为 0，落入 probe_failed。本判据随 t3 已验证。
 */
export interface VisualFuseEligibility {
  eligible: boolean;
  /** 合格且由缺屏驱动时：内容可行动的缺屏 id（进 missing_screen 指纹）；否则空 */
  actionableMissingIds: string[];
  /** 机器可读的判定依据（进 reference notes，供人读与回归断言） */
  reason: string;
}

/** capture 未运行时外层补的裁决——结构上不可能漏：ctx 上没有值就等于没跑过 capture。 */
export const CAPTURE_NOT_RUN_ELIGIBILITY: VisualFuseEligibility = {
  eligible: false,
  actionableMissingIds: [],
  reason: 'capture_not_run：本轮未执行视觉采集（build/install/run 或静态门禁提前返回），旧视觉状态不得参与熔断',
};

/**
 * 按上表裁决本轮资格（纯函数；真实生产链由 captureVisualDiff 调用）。
 *
 * 判据（t3/t4 收口，2026-08-13）：**只有被 identity gate 确证为 mismatched 的缺屏**
 * （身份不中 + dump 含页面组件前缀 = 应用页面树在场但渲染了错页）才具备熔断资格——
 * 设备活性由 dump 证据自身携带，属内容问题，可进 missing_screen 指纹。
 * 其余缺屏一律整轮 ineligible：probe_failed（锁屏/桌面/系统态、dump 能力缺失、
 * dump 失败/不可解析）与无 screenEvidence 的缺屏（导航失败、golden 失败、截图失败等
 * 环境阻断）对"应用在前台"一无所知——绝不把环境故障改口成"修了没用"。
 * element_absent / screensWritten / none_of / bundle 命中已被逐轮证伪，一律不恢复。
 */
export function resolveVisualFuseEligibility(input: {
  p0CaptureFailures: readonly string[];
  /** 逐屏 identity gate 结论（mismatched=内容正证据；probe_failed=环境/证据不足） */
  screenEvidence: ReadonlyMap<string, 'mismatched' | 'probe_failed'>;
}): VisualFuseEligibility {
  const failures = [...new Set(input.p0CaptureFailures.filter(s => typeof s === 'string' && s.trim()))].sort();
  if (failures.length === 0) {
    return { eligible: true, actionableMissingIds: [], reason: '无 P0 缺屏；资格由既有 defects 通道决定' };
  }
  // 整轮合格 ⇔ 每个缺屏都有 **mismatched** 正证据（混合轮/证据缺失轮 fail-safe ineligible）
  const allActionable = failures.every(id => input.screenEvidence.get(id) === 'mismatched');
  if (allActionable) {
    return {
      eligible: true,
      actionableMissingIds: failures,
      reason:
        `${failures.length} 个 P0 缺屏均经 identity gate 确证为应用页面树在场但非目标页（mismatched）` +
        `——内容可行动，进 missing_screen 指纹`,
    };
  }
  const probeFailed = failures.filter(id => input.screenEvidence.get(id) === 'probe_failed');
  const unknown = failures.filter(id => !input.screenEvidence.has(id));
  return {
    eligible: false,
    actionableMissingIds: [],
    reason:
      `${failures.length} 个 P0 缺屏——` +
      `${probeFailed.length > 0 ? `${probeFailed.length} 屏 probe_failed（锁屏/桌面/系统态或 dump 能力缺失）：${probeFailed.slice(0, 5).join('、')}` : ''}` +
      `${probeFailed.length > 0 && unknown.length > 0 ? '；' : ''}` +
      `${unknown.length > 0 ? `${unknown.length} 屏无身份证据（导航/截图失败等环境阻断）：${unknown.slice(0, 5).join('、')}` : ''}` +
      '——本轮整体不参与熔断比较（环境/证据事实不明，不得改口成内容问题）',
  };
}

export function mergeVisualDiffReports(
  existing: VisualDiffReport | null,
  capturedScreens: Array<{ entry: VisualDiffScreenEntry; hash: string }>,
  currentBuildFingerprint?: string | null,
  /**
   * t3（plan f3a8c6d2）：本轮**瞬时**失效的 screen id（当前仅 identity mismatch）。
   * 这些屏本轮拿不出可信截图，其旧条目（score/verdict）不得继续被消费——否则
   * "错页高分"会跨轮存活（bc-openCard 的 0.997 即此形态）。瞬时=不落盘、不进 schema、
   * 不新增持久状态；下一轮身份对上并成功采集即自然恢复。
   */
  invalidateScreenIds?: readonly string[],
): { report: VisualDiffReport; preserved: number; updated: number; invalidated: number } {
  const byId = new Map<string, VisualDiffScreenEntry>();
  const dropped = new Set(
    (invalidateScreenIds ?? []).filter(id => typeof id === 'string' && id.trim()),
  );
  for (const s of existing?.screens ?? []) {
    if (typeof s.screen_id === 'string' && s.screen_id.trim()) {
      if (dropped.has(s.screen_id)) continue; // 身份失配屏：旧裁决整条丢弃
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
 * t4（plan f3a8c6d2）：身份 gate 的**可区分**结论。
 *   · matched       —— 身份命中（或没有 identity / proposed 候选，按既有契约放行）
 *   · mismatched    —— dump 取到了、**且证据显示被测应用页面树确实在渲染**，但不是目标页
 *                      ＝纯导航/实现问题，唯一可作内容正证据的形态
 *   · probe_failed  —— dump 执行失败/不可解析、confirmed identity 但无 dump 能力、
 *                      或 dump 里找不到被测应用的页面组件前缀
 *                      （锁屏页、桌面、系统弹窗都会落这里）——对页面一无所知，不得当证据
 * 旧实现把这三者压成同一个 `ok:false`，于是 dump IO 故障被当成"唯一正证据"既进熔断、
 * 又错误删除旧裁决（review 抓出）。`ok` 保留给既有调用点做放行判断，语义不变。
 */
export interface ScreenIdentityGateResult {
  ok: boolean;
  status: 'matched' | 'mismatched' | 'probe_failed';
  detail?: string;
}

/**
 * 被测应用页面在场的**所有权证据集**：全部已确认声明屏的 `all_of`/`any_of` **正向 id**。
 *
 * plan e6b3f8d2 t3（撤销强制 Maison UI kit）：此前用 `maison:<feature>:` 组件 id 前缀
 * 推导所有权——那是 kit anchor 机制的副产品，随 kit 一并删除。页面身份判据**迁移到既有
 * `visual-diff-nav` screen identity 声明**，让它真正成为唯一真源（不新增前缀/注册表/
 * anchor 文件，不建第二套机制）：
 *   · 只取 `all_of`/`any_of` 的**正向 id**，按**精确 id** 判在场；
 *   · **不得使用 `none_of`**——它的契约只是「目标页禁入锚点」，不保证该锚属于本应用
 *     （`none_of=[上滑解锁]` 配真实锁屏树会把锁屏判成"应用错页"，仓内已证伪）；
 *   · 只声明 text/route 的工程推导不出任何 id ⇒ 返回空集，调用方 fail-safe 走 probe_failed。
 * 取**全部已确认声明屏**而不只是目标屏：任一已确认屏的正向 id 在场，都足以证明被测应用的
 * 页面树正在渲染（这正是「应用错页」与「锁屏/桌面等系统态」的分界）。
 */
function declaredScreenIdentityIds(opts: VisualDiffCaptureOptions): Set<string> {
  const out = new Set<string>();
  for (const identity of opts.screenIdentity?.values() ?? []) {
    // proposed=true 是自动预填、未经确认的候选。生产调用会把 resolveIdentityForTargets 的
    // 完整 map 传入，因此本 SSOT 消费点必须自行 fail-closed；候选既不参与目标 gate，
    // 也绝不能替其他屏证明「应用页面在场」并把 probe_failed 升成确定性 mismatched。
    if (identity.proposed === true) continue;
    // 刻意不含 none_of：禁入锚点不构成所有权证明（见上）。
    for (const m of [...(identity.all_of ?? []), ...(identity.any_of ?? [])]) {
      if (typeof m.id !== 'string') continue;
      const id = m.id.trim();
      if (id) out.add(id);
    }
  }
  return out;
}

/**
 * S2 P0-C：页面身份 gate——navigate 后、screenshot 落正式目录前执行。
 * 顺序契约：navigate → dump uitree（_identity 探测位）→ identity gate → screenshot →
 * canonical write。无 identity/proposed 候选 → 直接放行（强制策略由
 * validateNavConfigV2 的 requireConfirmedIdentity 在校验层管）。
 *
 * t3（plan f3a8c6d2）：**confirmed identity 但无 layoutDumpFn ⇒ probe_failed**。
 * 历史 0.997 错页条目（layout_dump_status=unavailable）正是"无 dump 能力时未验证放行"
 * 时代的产物——身份验真没有实际执行，截图却进了正式目录。有确认身份却验不了真时
 * 不得放行；probe_failed 语义=证据不足（不删旧裁决、不得作为内容/熔断正证据）。
 */
function runScreenIdentityGate(
  opts: VisualDiffCaptureOptions,
  screenId: string,
  reportDir: string,
): ScreenIdentityGateResult {
  const identity = opts.screenIdentity?.get(screenId);
  if (!identity || identity.proposed === true) return { ok: true, status: 'matched' };
  if (!opts.layoutDumpFn) {
    return {
      ok: false,
      status: 'probe_failed',
      detail: 'identity 已确认但无 layoutDumpFn（UITree dump 能力缺失）——身份无法验真，不得落正式截图',
    };
  }
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
    // t4：探测失败 ≠ 身份失配。dump 拿不到时我们对页面**一无所知**（设备可能锁屏/离线），
    // 归 probe_failed——绝不能当成"页面渲染了只是错页"的内容证据。
    return {
      ok: false,
      status: 'probe_failed',
      detail: `identity 探测 dump 失败${d.error ? ` — ${d.error}` : ''}（身份未验不得落正式截图）`,
    };
  }
  let json: unknown;
  try {
    json = JSON.parse(fs.readFileSync(probeAbs, 'utf-8'));
  } catch (e) {
    return { ok: false, status: 'probe_failed', detail: `identity dump 不可解析：${(e as Error).message}` };
  }
  const facets = extractLayoutDumpFacets(json);
  const ev = evaluateScreenIdentity(identity, facets);
  if (!ev.ok) {
    const evidenceAbs = path.join(reportDir, '_mismatch', `shot-${slug}.png`);
    try {
      fs.mkdirSync(path.dirname(evidenceAbs), { recursive: true });
      opts.screenshotFn?.({ screenId, destAbs: evidenceAbs, bundleName: opts.bundleName, deviceSn: opts.deviceSn });
    } catch {
      /* 证据图 best-effort，不影响 mismatch 判定 */
    }
    // 身份不命中还不够——`dump-ui` 不绑 bundle，锁屏页/桌面/系统弹窗同样会"不命中"。
    // 判"应用错页"必须有**应用页面树所有权**的确定事实：dump 里精确命中任一**已确认屏**
    // 的正向 identity id（ArkUI `.id()` 透传，系统页不会有）。
    //
    // 主页校准（2026-08-13 foreground-identity-calibration）：锁屏 119 节点 / 桌面
    // 231 节点 dump 中应用页面组件 id 均为 0 命中——系统态拿不到应用页面 id；桌面 dump
    // 虽出现 `com.example.simulatedwallet`（AppIcon 图标 id），但属**宿主 bundle 命中**
    // 而非声明的页面组件 id，不会被当作所有权证据。
    // 结论：有已确认 id + 身份不中 ⇒ 应用页面树在场但非目标页（mismatched，确定性）；
    //       无任何已确认 id ⇒ probe_failed（锁屏/桌面/系统态，页面一无所知）。
    //
    // 曾试图把 `none_of` 命中也当所有权证明（为纯文本锚工程兜底）——**已证伪**：
    // `none_of` 的契约只是"目标页禁入锚点"，不保证该锚属于本应用；把
    // `none_of=[上滑解锁]` 配上真实锁屏树，锁屏就会被判成"应用错页"并进熔断。
    const declaredIds = declaredScreenIdentityIds(opts);
    const appRendered = declaredIds.size > 0 && facets.ids.some(id => declaredIds.has(id));
    // 记法遵循 openspec `visual-diff` 契约：身份规则不通过一律记 `screen_identity_mismatch`
    // （证据图归档 _mismatch/、正式目录零写入、该屏按缺证据处理）。
    const cause = appRendered
      ? 'dump 含已声明屏的正向 identity id（应用页面树在场）但非目标页'
      : 'dump 无任何已声明 identity id（锁屏/桌面/系统态，或工程只声明了 text/route）';
    return {
      ok: false,
      status: appRendered ? 'mismatched' : 'probe_failed',
      detail:
        `screen_identity_mismatch — ${ev.detail}（${cause}）` +
        `（证据图 _mismatch/shot-${slug}.png；正式目录零写入）`,
    };
  }
  return { ok: true, status: 'matched' };
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

  // c4e8b1d3 G3 / Todo 3：golden 显式 targets（不受 P0 过滤；普通模式两者皆无 → 纯 P0-only 原行为）。
  // **单解析契约**：未显式注入 targets 时只调一次 loadGoldenContractFromEnv（单次 JSON.parse
  // 同时取 targets/forbidden）——禁止 targets 与 forbidden 分两次读 env（两次读取间文件内容
  // 可能漂移，违背本 change 自己的单解析契约）；显式注入路径不读 env。
  const goldenEnvLoad = opts.goldenTargets ? null : loadGoldenContractFromEnv(opts.projectRoot);
  const goldenSpec = opts.goldenTargets ?? (goldenEnvLoad ? goldenEnvLoad.targets : null);
  const golden = goldenSpec ? resolveGoldenCaptureTargets(uiDoc, goldenSpec) : null;
  // round20 P1：负向目标（证据生产）——opts 注入优先；opts.goldenTargets 注入而未给
  // forbidden 时不读 env（测试注入面独立），env 路径两者一体装载（同一 goldenEnvLoad）。
  const goldenForbidden: GoldenForbiddenTarget[] = golden
    ? (opts.goldenForbidden ?? (opts.goldenTargets ? [] : (goldenEnvLoad ? goldenEnvLoad.forbidden : [])))
    : [];
  const p0Screens = collectP0CaptureTargets(uiDoc);
  const targets = golden
    ? [...p0Screens, ...golden.extraScreens.filter(s => !p0Screens.some(p => p.id === s.id))]
    : p0Screens;
  const p0Overlays = collectP0OverlayTargetIds(uiDoc);
  const overlayTargets = golden
    ? [...p0Overlays, ...golden.extraOverlays.filter(o => !p0Overlays.some(p => p.id === o.id))]
    : p0Overlays;
  if (targets.length === 0 && overlayTargets.length === 0 && (golden?.failures.length ?? 0) === 0) {
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
        ...overlayTargets.map(o => o.id),
        ...goldenForbidden.map(f => f.id),
      ])
    : null;

  // P0-9a：判定持久化——先读既有报告，build 指纹有效的当前 hash-bound 机器判定可跳过重采。
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
  // t2b（plan c6d8f2b4）：**归一 slug 冲突 fail-closed**——不同 screen_id 归一到同一个
  // canonical slug（如 `a__b` 与 `a_b`、或 overlay 双下划线被压成单下划线）时，布局
  // dump / probe / 截图会互相覆盖，读侧无法判别归属。采集开始前在目标集合上检测，
  // **冲突双方（owner 与 collider）全部**记 P0 采集失败并跳过（不写、不猜），
  // 两条采集循环（主屏 / overlay）入口均须跳过冲突屏。
  const slugConflictIds = new Set<string>();
  {
    const slugOwners = new Map<string, string>();
    for (const id of [...targets.map(t => t.id), ...overlayTargets.map(o => o.id)]) {
      const slug = sanitizeVisualDiffScreenSlug(id);
      if (!slug) continue;
      const prev = slugOwners.get(slug);
      if (prev !== undefined && prev !== id) {
        // 原 owner 与后出现者都进冲突集合——owner 此前已被登记，须一并剔除
        slugConflictIds.add(prev);
        slugConflictIds.add(id);
        continue;
      }
      slugOwners.set(slug, id);
    }
    if (slugConflictIds.size > 0) {
      const bySlug = new Map<string, string[]>();
      for (const id of slugConflictIds) {
        const slug = sanitizeVisualDiffScreenSlug(id);
        if (!slug) continue;
        const list = bySlug.get(slug) ?? [];
        list.push(id);
        bySlug.set(slug, list);
      }
      for (const [slug, ids] of bySlug) {
        errors.push(
          `slug 归一冲突（fail-closed）：${ids.join('、')} 归一到同一 ` +
            `canonical 文件名 layout-${slug}.json——布局 dump/截图会互相覆盖，本屏不采集。` +
            `须改 screen_id 命名（避免双下划线/下划线混用）后重试。`,
        );
        for (const id of ids) p0CaptureFailures.push(id);
      }
    }
  }
  // t3（plan f3a8c6d2）：本轮**确证**身份失配屏的瞬时失效集合——不落盘、不进 schema，
  // 仅用于 merge 前剔除该屏的旧条目（见 mergeVisualDiffReports 的 invalidateScreenIds）。
  // 只加入 identity gate 的确定性 `mismatched`（页面组件前缀在场 + 目标锚缺失＝应用页面
  // 树在场但渲染错页）；`probe_failed`（锁屏/桌面/systemd 或 dump 能力缺失）绝不加入——
  // 证据不足时旧条目原样保留（含 inert legacy 字段），与 t4 资格矩阵同判据；
  // 是否可信仍由后续 freshness/evidence gate 重算。
  const identityMismatchIds: string[] = [];
  // t4：逐屏 identity gate 结论（唯一的内容正证据来源，不做任何反推）
  const screenEvidence = new Map<string, 'mismatched' | 'probe_failed'>();
  // golden 解析失败 fail-closed：contract 要求的屏无法成为采集目标 = 采集失败，
  // 绝不静默跳过（否则 evaluator 端只见"缺屏"，丢了真因）。
  if (golden) {
    for (const f of golden.failures) {
      errors.push(`golden_contract:${f.declared}: ${f.reason}（fail-closed——contract 屏无法解析为 capture target）`);
      p0CaptureFailures.push(f.declared);
    }
  }
  // v23 F3：集合差基线——导航前拍 faultlog 文件名集合；失败后重列，只有**本轮新增**
  // 且属于本应用的 faultlog 才判崩溃（无时钟依赖：旧时间窗方案按 UTC 解析设备本地时间
  // 文件名，时区差会把历史崩溃判成本轮崩溃）。仅有 bundleName 时才拍（诊断可用的前提）。
  // v23 F3：集合差崩溃诊断。基线**每次导航前单独拍**（review 第 10 轮 P1：整批只拍一次
  // 的话，A 屏崩溃产生的 faultlog 对之后 B 屏的"整批基线"永远是新增——B 只是选择器超时
  // 也会被误判 crash_suspected）。无时钟依赖（旧时间窗方案的时区坑已删）。
  const crashDeps = opts.crashProbeDeps ?? (opts.bundleName?.trim() ? makeHdcCrashProbeDeps() : null);
  const takeFaultlogBaseline = (): ReadonlySet<string> | null =>
    crashDeps && opts.bundleName?.trim() ? snapshotFaultlogSet(crashDeps) : null;
  // c4e8b1d3 round19 P1：当前 goal run 身份——新采条目盖 captured_in_run 戳；golden 模式
  // 下同 build 跳采**额外要求条目就是本 run 采的**（强制每 run 重采，第二个 run 不得
  // 复用第一个 run 的截图凑 golden）。普通模式跳采行为逐字节不变（P0-9a 判定持久保留）。
  const runIdNow = process.env.MAISON_GOAL_RUN_ID?.trim() || null;
  const goldenSkipAllowed = (existing: VisualDiffScreenEntry | undefined): boolean =>
    !golden || (typeof existing?.captured_in_run === 'string' && existing.captured_in_run === runIdNow);
  // v23 F3：清理**本 run** 的既有 crash 归档——本轮采集将对每个导航失败屏重新判定；
  // 不清的话，上一轮修好后旧归档仍在（run_id 相同）会被消费成 actionable，造成
  // "修好了还回退/熔断"的假信号。其他 run 的归档不动（本来就不被消费）。
  {
    const diagDirNow = path.join(testingReportsDirForDiag(opts.projectRoot, opts.feature), 'crash-diagnostics');
    if (runIdNow && fs.existsSync(diagDirNow)) {
      for (const n of fs.readdirSync(diagDirNow)) {
        if (!n.endsWith('.json')) continue;
        try {
          const doc = JSON.parse(fs.readFileSync(path.join(diagDirNow, n), 'utf-8')) as { run_id?: string };
          if (doc.run_id === runIdNow) fs.rmSync(path.join(diagDirNow, n));
        } catch { /* 损坏归档一并清（本轮会重写） */ fs.rmSync(path.join(diagDirNow, n), { force: true }); }
      }
    }
  }
  for (const screen of targets) {
    // t2b：slug 冲突屏（owner 与 collider）采集入口直接跳过——已在冲突检测处记 P0 失败
    if (slugConflictIds.has(screen.id)) continue;
    // root 即 overlay 的 base 屏（manage_non_local）由下方 overlay 循环采集，主循环跳过（避免重复/误判缺 nav）。
    if (isOverlayRootScreen(screen)) continue;
    if (
      canSkipRecaptureForScreen(existingById.get(screen.id), opts.projectRoot, currentFp) &&
      skipAllowedByIdentity(existingById.get(screen.id), opts.screenIdentity?.get(screen.id)) &&
      goldenSkipAllowed(existingById.get(screen.id))
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
      const navFaultlogBaseline = takeFaultlogBaseline();   // per-nav（不是整批一拍）
      const nav = opts.navExecutorFn!({
        screenId: screen.id,
        steps: navSteps ?? [],
        deviceSn: opts.deviceSn,
        bundleName: opts.bundleName,
      });
      if (!nav.ok) {
        // 到不了屏时**立刻**诊断是不是进入即崩溃。事故里这一步缺席，于是
        // "点全部银行直接崩溃"被降级成一条 15.1s 元素超时，真凶从未进回修集合。
        // 结构化诊断 + **归档**（含 run_id）——goal-runner 只认本 run 的归档，作为
        // ActionableDefect(source='crash') 直接进回修环
        const dg = crashDeps
          ? diagnoseNavigationFailure(opts.bundleName ?? '', navFaultlogBaseline, crashDeps)
          : { kind: 'diagnosis_unavailable' as const, reason: '未知 bundleName，崩溃诊断未跑' };
        archiveTimeoutDiagnosis(testingReportsDirForDiag(opts.projectRoot, opts.feature), screen.id, dg);
        errors.push(
          `${screen.id}: 导航失败${nav.error ? ` — ${nav.error}` : ''}（未截图，避免截错屏）；${renderDiagnosis(dg)}`,
        );
        p0CaptureFailures.push(screen.id);
        continue;
      }
    }
    // S2 P0-C：identity gate（dump→判定）先于任何正式截图落盘
    const idGate = runScreenIdentityGate(opts, screen.id, reportDir);
    if (!idGate.ok) {
      errors.push(`${screen.id}: ${idGate.detail}`);
      p0CaptureFailures.push(screen.id);
      if (idGate.status !== 'matched') screenEvidence.set(screen.id, idGate.status);
      // t3（plan f3a8c6d2）：**确定性 mismatched 才瞬时失效旧裁决**——identity gate
      // 已确证"应用页面树在场但渲染了非目标页"（页面组件前缀 + 锚缺失），该屏旧条目
      // （score/verdict，含 0.997 型错页高分）不得继续被消费；merge 时按
      // invalidateScreenIds 剔除。probe_failed（锁屏/桌面/系统态、dump 能力缺失、
      // dump 失败/不可解析）**绝不删除**——证据不足时旧条目及 inert legacy 字段原样保留；
      // 后续 freshness/evidence gate 仍会重算其可信度。
      if (idGate.status === 'mismatched') identityMismatchIds.push(screen.id);
      // 证据图（_mismatch/）照常归档，正式目录仍零写入——取证与拦截都不受影响。
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
    // round19 P1：run 身份戳（golden 强制本 run 重采 + evaluator run 绑定校验的依据）
    if (runIdNow) row.captured_in_run = runIdNow;
    // P1-3：本截图通过的身份规则指纹——后续同 build 跳采须 identity 未变才合法
    const idnMain = opts.screenIdentity?.get(screen.id);
    if (idnMain && idnMain.proposed !== true) {
      (row as { identity_fingerprint?: string }).identity_fingerprint = identityFingerprintOf(idnMain);
    }
    capturedScreens.push({ entry: row, hash: screenshotHash });
  }

  for (const ov of overlayTargets) {
    // t2b：slug 冲突屏（owner 与 collider）同规则跳过——overlay 与主屏一致
    if (slugConflictIds.has(ov.id)) continue;
    if (capturedScreens.some(c => c.entry.screen_id === ov.id)) continue;
    if (
      canSkipRecaptureForScreen(existingById.get(ov.id), opts.projectRoot, currentFp) &&
      skipAllowedByIdentity(existingById.get(ov.id), opts.screenIdentity?.get(ov.id)) &&
      goldenSkipAllowed(existingById.get(ov.id))
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
      const ovFaultlogBaseline = takeFaultlogBaseline();    // per-nav（overlay 同规则）
      const nav = opts.navExecutorFn!({ screenId: ov.id, steps: ovSteps, deviceSn: opts.deviceSn, bundleName: opts.bundleName });
      if (!nav.ok) {
        const dg = crashDeps
          ? diagnoseNavigationFailure(opts.bundleName ?? '', ovFaultlogBaseline, crashDeps)
          : { kind: 'diagnosis_unavailable' as const, reason: '未知 bundleName，崩溃诊断未跑' };
        archiveTimeoutDiagnosis(testingReportsDirForDiag(opts.projectRoot, opts.feature), ov.id, dg);
        errors.push(
          `${ov.id}: overlay 导航失败${nav.error ? ` — ${nav.error}` : ''}（未截图，避免截错屏）；${renderDiagnosis(dg)}`,
        );
        p0CaptureFailures.push(ov.id);
        continue;
      }
      // S2 P0-C：overlay 同样过 identity gate（sheet 开启态身份）
      const ovIdGate = runScreenIdentityGate(opts, ov.id, reportDir);
      if (!ovIdGate.ok) {
        errors.push(`${ov.id}: ${ovIdGate.detail}`);
        p0CaptureFailures.push(ov.id);
        if (ovIdGate.status !== 'matched') screenEvidence.set(ov.id, ovIdGate.status);
        // t3：overlay 与主屏同规则——仅确定性 mismatched 瞬时失效旧裁决；
        // probe_failed（锁屏/桌面/系统态、dump 能力缺失）不得删旧条目
        //（见主屏分支注释，两处判据与 t4 资格矩阵同口径）。
        if (ovIdGate.status === 'mismatched') identityMismatchIds.push(ov.id);
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
      if (runIdNow) row.captured_in_run = runIdNow;
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
        ...(runIdNow ? { captured_in_run: runIdNow } : {}),
      },
      hash: fs.existsSync(paths.abs) ? (hashScreenshotFile(paths.abs) ?? '') : '',
    });
  }

  // round20 P1：golden 负向证据生产——contract.forbidden 逐条导航 + UITree dump，写
  // wrapper 证据（run_id + build fp 绑定；evaluator 只认 wrapper）。不可生产（缺 nav 步骤/
  // 缺 layoutDumpFn/导航失败/dump 失败）→ fail-closed 记采集失败，绝不静默（否则干净宿主
  // 按说明执行会"证据缺席必然 FAIL"却查不到真因）。
  for (const f of goldenForbidden) {
    const fSlug = sanitizeVisualDiffScreenSlug(f.id);
    const evidenceRel = f.evidence.replace(/\\/g, '/');
    if (!fSlug || evidenceRel.split('/').some(s => s === '' || s === '..')) {
      errors.push(`golden_forbidden:${f.id}: id/evidence 路径非法（禁止空段与 ..）`);
      p0CaptureFailures.push(f.id);
      continue;
    }
    const fSteps = navResolve?.resolved.get(f.id);
    if (!navEnabled || fSteps === undefined || !opts.layoutDumpFn) {
      errors.push(
        `golden_forbidden:${f.id}: 负向证据无法生产（${
          !navEnabled ? '未启用导航（缺 navConfig/navExecutorFn）'
            : fSteps === undefined ? 'nav 配置缺该屏到达步骤'
            : '无 layoutDumpFn（UITree dump 能力缺失）'
        }）——evaluator 将 fail-closed`,
      );
      p0CaptureFailures.push(f.id);
      continue;
    }
    const fBaseline = takeFaultlogBaseline();
    const fNav = opts.navExecutorFn!({ screenId: f.id, steps: fSteps, deviceSn: opts.deviceSn, bundleName: opts.bundleName });
    if (!fNav.ok) {
      const dg = crashDeps
        ? diagnoseNavigationFailure(opts.bundleName ?? '', fBaseline, crashDeps)
        : { kind: 'diagnosis_unavailable' as const, reason: '未知 bundleName，崩溃诊断未跑' };
      archiveTimeoutDiagnosis(testingReportsDirForDiag(opts.projectRoot, opts.feature), f.id, dg);
      errors.push(`golden_forbidden:${f.id}: 导航失败${fNav.error ? ` — ${fNav.error}` : ''}；${renderDiagnosis(dg)}`);
      p0CaptureFailures.push(f.id);
      continue;
    }
    const tmpDump = path.join(reportDir, `.golden-forbidden-${fSlug}.json`);
    const dump = opts.layoutDumpFn({ screenId: f.id, destAbs: tmpDump, deviceSn: opts.deviceSn, bundleName: opts.bundleName });
    if (!dump.ok || !fs.existsSync(tmpDump)) {
      errors.push(`golden_forbidden:${f.id}: UITree dump 失败${dump.error ? ` — ${dump.error}` : ''}`);
      p0CaptureFailures.push(f.id);
      continue;
    }
    let tree: unknown;
    try {
      tree = JSON.parse(fs.readFileSync(tmpDump, 'utf-8'));
    } catch {
      tree = fs.readFileSync(tmpDump, 'utf-8');
    }
    fs.rmSync(tmpDump, { force: true });
    const evidenceAbs = path.join(featureDir(opts.projectRoot, opts.feature), evidenceRel);
    fs.mkdirSync(path.dirname(evidenceAbs), { recursive: true });
    fs.writeFileSync(evidenceAbs, `${JSON.stringify({
      schema_version: '1.0',
      kind: 'golden_forbidden_evidence',
      screen: f.id,
      anchor: f.anchor,
      run_id: runIdNow,
      evaluated_build_fingerprint: currentFp,
      captured_at: new Date().toISOString(),
      tree,
    }, null, 2)}\n`, 'utf-8');
  }

  if (capturedScreens.length === 0) {
    // t3（plan f3a8c6d2）：**零成功采集也必须清掉身份失配屏的旧裁决**。
    // 本早退路径原样保留盘上 json（"无成功截图不写盘"），于是全屏失败那轮里，
    // 已被证伪的错页条目（如 add_card_home_collapsed=全部银行页 0.997）会继续存活并
    // 喂出误导性反馈——与 merge 路径的处置自相矛盾。此处只做**删除**（不新增条目、
    // 不改其他屏），失配屏随后表现为"缺屏"，与 identity gate 的结论一致。
    if (identityMismatchIds.length > 0 && existingReportEarly) {
      const kept = existingReportEarly.screens.filter(
        s => !identityMismatchIds.includes(s.screen_id),
      );
      if (kept.length !== existingReportEarly.screens.length) {
        const pruned: VisualDiffReport = { ...existingReportEarly, schema_version: '1.1', screens: kept };
        fs.writeFileSync(jsonPath, `${JSON.stringify(pruned, null, 2)}\n`, 'utf-8');
        fs.writeFileSync(
          mdPath,
          buildVisualDiffMdBody(pruned, { p0CaptureFailures, preservedBuildValidIds }),
          'utf-8',
        );
      }
    }
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
        fuseEligibility: resolveVisualFuseEligibility({ p0CaptureFailures, screenEvidence }),
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
      fuseEligibility: resolveVisualFuseEligibility({ p0CaptureFailures, screenEvidence }),
      skippedReason: 'no_captures',
    };
  }

  const { report, preserved, updated, invalidated } = mergeVisualDiffReports(
    existingReportEarly,
    capturedScreens,
    currentFp,
    identityMismatchIds,
  );
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
    fuseEligibility: resolveVisualFuseEligibility({ p0CaptureFailures, screenEvidence }),
  };
}
