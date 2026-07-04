// ============================================================================
// device_test.visual_diff — Hylyre 截图报告校验（禁假 PASS）
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import type { CheckContext, CheckResult } from '../../../harness/scripts/utils/types';
import { relFeatureArtifact } from '../../../harness/config';
import {
  UI_CHANGE_REQUIRES_UI_SPEC,
  loadUiSpecFile,
  parseUiChangeFromSpecMarkdown,
  uiSpecAbsPath,
  collectAllComponentNodes,
  type UiSpecDoc,
} from '../../../harness/scripts/utils/ui-spec-shared';
import { extractCodeBlocks } from '../../../harness/scripts/utils/markdown-parser';
import { collectP0VisualTargetIds } from './visual-diff-targets';
import { collectOutOfBoundsGlobalElements, collectGrossMissingAnchorText, collectTextPlacementSignals, collectVerdictAbandonment } from './visual-diff-ocr-gates';
import { buildAuthoritativeRefImageIndex, resolveRefSourceImage } from './authoritative-ref-images';
import { canonicalOverlayBase } from './visual-diff-nav';
import { EDGE_TILE_ROWS, EDGE_TILE_COLS, EDGE_SENTINEL_MIN_UNCOVERED } from './image-toolkit';
import { isPixel1to1, fidelityRatchetFailOrWarn, isHumanConfirmed } from '../../../harness/scripts/utils/fidelity-shared';
import { loadRefElementsFile, refElementsAbsPath } from '../../../harness/scripts/utils/fidelity-shared';
import { createRequire } from 'module';

const requireHarness = createRequire(path.resolve(__dirname, '../../../harness/harness-runner.ts'));
const YAML = requireHarness('yaml') as { parse: (s: string) => unknown };

/**
 * verdict=pass 时 fidelity_score / geometric_iou 的最低阈值。
 * 低于此值视为「自报 0 分却宣称 pass」的假 PASS，降级 WARN。
 */
const PASS_MIN_FIDELITY = 0.6;
const PASS_MIN_IOU = 0.5;
/**
 * C：finalized 屏（尤其 warn）的「灾难地板」。warn 本表示有残差，但低到灾难级（全色块 fidelity~0.1）
 * 仍放行是无底洞（宿主 homepage 6 屏全 warn+0.08~0.12 曾整体 PASS）——低于此地板即便 warn 也 ratchet
 * （pixel_1to1 → FAIL）。取值低于 PASS_MIN，只抓崩坏（~0.1），不误伤正常残差 warn（~0.5）。
 */
const FINALIZED_MIN_FIDELITY = 0.45;
const FINALIZED_MIN_IOU = 0.4;
/** VL fidelity 显著高于 score_floor 时触发复核 WARN */
const SCORE_FLOOR_SENTINEL_GAP = 0.35;
/** defects[] 枚举合法取值（v1 渲染缺陷枚举契约） */
const VALID_DEFECT_CLASSES = new Set(['clipping', 'overlap', 'shape_mismatch', 'missing_render', 'other']);
const VALID_DEFECT_SEVERITIES = new Set(['blocker', 'major', 'minor']);

function ruleDesc(ctx: CheckContext): string {
  const checks = ctx.phaseRule.structure_checks as Record<string, { description: string }>;
  return checks?.visual_diff?.description?.trim() ?? 'visual_diff';
}

function loadSpecMarkdown(ctx: CheckContext): string | null {
  const p = path.join(ctx.projectRoot, 'doc', 'features', ctx.feature, 'spec', 'spec.md');
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf-8');
}

export type VisualDiffDefectClass = 'clipping' | 'overlap' | 'shape_mismatch' | 'missing_render' | 'other';
export type VisualDiffDefectSeverity = 'blocker' | 'major' | 'minor';

/** 正向渲染缺陷（实现有但渲染错）。bbox 为归一化 [x,y,w,h] ∈ [0,1] */
export interface VisualDiffDefect {
  class: VisualDiffDefectClass;
  element?: string;
  bbox?: number[];
  severity: VisualDiffDefectSeverity;
  note: string;
}

export interface VisualDiffScreenEntry {
  screen_id: string;
  verdict: 'pass' | 'warn' | 'fail' | 'skipped' | 'pending';
  screenshot_path?: string;
  ref_path?: string;
  ref_id?: string;
  fidelity_score?: number;
  geometric_iou?: number;
  /** jimp 半定量客观下限/哨兵（不参与 PASS 阈值） */
  /** reference_only（P1-C）：像素直方图下限，历史多次实测证伪（UI 全错仍近满分），不参与任何判定 */
  score_floor?: number;
  must_fix?: string[];
  /** 当前 screenshot_path 对应 PNG 的 sha256 前缀（16 hex） */
  screenshot_hash?: string;
  /** VL/agent 判定 verdict 时所依据的截图 hash；须与当前文件 hash 一致 */
  evaluated_screenshot_hash?: string;
  /** T2：真人确认者署名（pixel_1to1 P0 pass 屏须真人过目确认；goal-mode-auto 等自签不算） */
  confirmed_by?: string;
  /** 反向 diff：参考图有、实现无的元素 id 清单 */
  reverse_missing?: string[];
  /** 正向缺陷枚举：实现有但渲染错（裁切/重叠/形态/缺渲染）。pixel_1to1 下 verdict=pass 须为空数组 */
  defects?: VisualDiffDefect[];
  /** v2 采集层边缘哨兵：超阈 tile 网格坐标 [row,col]（grid=GRID_ROWS×GRID_COLS） */
  edge_over_threshold_tiles?: number[][];
  /** v2 边缘密度 tile 最大散度（[0,1]，越大越疑似局部渲染差异） */
  edge_tile_divergence?: number;
}

export interface VisualDiffReport {
  schema_version: string;
  screens: VisualDiffScreenEntry[];
  degraded?: boolean;
  degrade_reason?: string;
}

function resolveShotPath(projectRoot: string, shot: string): string {
  return path.isAbsolute(shot) ? shot : path.resolve(projectRoot, shot);
}

/** PNG 文件 sha256 前 16 hex，用于截图变更检测 */
export function hashScreenshotFile(absPath: string): string | null {
  if (!fs.existsSync(absPath)) return null;
  try {
    return createHash('sha256').update(fs.readFileSync(absPath)).digest('hex').slice(0, 16);
  } catch {
    return null;
  }
}

/** pending/skipped 可被采集覆盖；pass/warn/fail 须 hash 一致才保留 */
export function isCaptureMutableVerdict(verdict: VisualDiffScreenEntry['verdict'] | undefined): boolean {
  return verdict === undefined || verdict === 'pending' || verdict === 'skipped';
}

/** pass/warn/fail 须显式写入 evaluated_screenshot_hash（不得仅靠 screenshot_hash 充数） */
export function isMissingEvaluatedScreenshotHash(screen: VisualDiffScreenEntry): boolean {
  if (isCaptureMutableVerdict(screen.verdict)) return false;
  return typeof screen.evaluated_screenshot_hash !== 'string' || !screen.evaluated_screenshot_hash.trim();
}

/** finalized verdict 的 evaluated_screenshot_hash 是否与当前截图文件不一致 */
export function isStaleVisualDiffVerdict(
  screen: VisualDiffScreenEntry,
  projectRoot: string,
): boolean {
  if (isCaptureMutableVerdict(screen.verdict) || isMissingEvaluatedScreenshotHash(screen)) return false;
  const shot = screen.screenshot_path;
  if (typeof shot !== 'string' || !shot.trim()) return false;
  const currentHash = hashScreenshotFile(resolveShotPath(projectRoot, shot));
  if (!currentHash) return true;
  return currentHash !== screen.evaluated_screenshot_hash!.trim();
}

function collectAuthoritativeRefIds(specMd: string, uiDoc: ReturnType<typeof loadUiSpecFile>): Set<string> {
  const ids = new Set<string>();
  for (const s of uiDoc?.screens ?? []) {
    if (s.ref_id) ids.add(s.ref_id);
    ids.add(s.id);
  }
  for (const b of extractCodeBlocks(specMd, 'yaml')) {
    try {
      const doc = YAML.parse(b.content) as Record<string, unknown>;
      const vh = doc?.visual_handoff as Record<string, unknown> | undefined;
      const refs = vh?.authoritative_refs as Array<{ id?: string }> | undefined;
      if (Array.isArray(refs)) {
        for (const r of refs) {
          if (typeof r.id === 'string' && r.id.trim()) ids.add(r.id.trim());
        }
      }
    } catch { /* skip */ }
  }
  return ids;
}

export function validateVisualDiffJson(
  raw: unknown,
  projectRoot: string,
  opts?: { authoritativeRefIds?: Set<string> },
):
  | { ok: true; report: VisualDiffReport; errors: string[]; fatal: false }
  | { ok: false; report: VisualDiffReport | null; errors: string[]; fatal: boolean } {
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, report: null, errors: ['root must be object'], fatal: true };
  }
  const rep = raw as Record<string, unknown>;
  const schemaVersion =
    typeof rep.schema_version === 'string' && rep.schema_version.trim() ? rep.schema_version.trim() : '';
  if (!schemaVersion) {
    errors.push('schema_version 必填');
  }
  if (!Array.isArray(rep.screens) || rep.screens.length === 0) {
    // 无 screens 数组 = 无可门禁对象（fatal）；其余 schema 问题走 best-effort 部分 report。
    errors.push('screens 须为非空数组');
    return { ok: false, report: null, errors, fatal: true };
  }

  // G0：凡有合法 screen_id + verdict 的屏都进 best-effort report，让下游 P0-pending /
  // 撞-hash / 缺屏 / score-floor 等实质门禁仍可计算；缺图、非法 ref_id 等 schema 问题
  // 记入 errors 由调用方「追加一条 finding」，不再因一处 schema 错就早退出掩盖真 BLOCKER。
  const bestEffortScreens: VisualDiffScreenEntry[] = [];
  {
    for (const [i, s] of (rep.screens as unknown[]).entries()) {
      if (!s || typeof s !== 'object') {
        errors.push(`screens[${i}] 须为 object`);
        continue;
      }
      const row = s as Record<string, unknown>;
      const screenIdValid = typeof row.screen_id === 'string' && Boolean(row.screen_id.trim());
      if (!screenIdValid) {
        errors.push(`screens[${i}].screen_id 必填`);
      }
      const verdict = row.verdict;
      const verdictValid =
        verdict === 'pass' ||
        verdict === 'warn' ||
        verdict === 'fail' ||
        verdict === 'skipped' ||
        verdict === 'pending';
      if (!verdictValid) {
        errors.push(`screens[${i}].verdict 非法：${String(verdict)}`);
      }
      const shot = row.screenshot_path;
      if (typeof shot !== 'string' || !shot.trim()) {
        errors.push(`screens[${i}].screenshot_path 必填`);
      } else if (!fs.existsSync(resolveShotPath(projectRoot, shot))) {
        errors.push(`screens[${i}].screenshot_path 不存在：${shot}`);
      }
      const refPath = row.ref_path;
      const refId = row.ref_id;
      if (typeof refPath === 'string' && refPath.trim()) {
        if (!fs.existsSync(resolveShotPath(projectRoot, refPath))) {
          errors.push(`screens[${i}].ref_path 不存在：${refPath}`);
        }
      } else if (typeof refId !== 'string' || !refId.trim()) {
        errors.push(`screens[${i}] 须含 ref_path（reachable 文件）或 ref_id`);
      } else if (opts?.authoritativeRefIds && opts.authoritativeRefIds.size > 0) {
        if (!opts.authoritativeRefIds.has(refId.trim())) {
          errors.push(`screens[${i}].ref_id=${refId} 不在 ui-spec/spec authoritative_refs`);
        }
      }
      if (verdict === 'pass' || verdict === 'warn') {
        const fsScore = row.fidelity_score;
        const iou = row.geometric_iou;
        if (typeof fsScore !== 'number' || Number.isNaN(fsScore)) {
          errors.push(`screens[${i}] verdict=${verdict} 时 fidelity_score 须为 number`);
        } else if (fsScore < 0 || fsScore > 1) {
          errors.push(`screens[${i}] fidelity_score 须在 [0,1]，收到 ${fsScore}`);
        }
        if (typeof iou !== 'number' || Number.isNaN(iou)) {
          errors.push(`screens[${i}] verdict=${verdict} 时 geometric_iou 须为 number`);
        } else if (iou < 0 || iou > 1) {
          errors.push(`screens[${i}] geometric_iou 须在 [0,1]，收到 ${iou}`);
        }
      }
      if (verdict === 'fail') {
        const mf = row.must_fix;
        if (!Array.isArray(mf) || mf.length === 0 || !mf.every(x => typeof x === 'string' && x.trim())) {
          errors.push(`screens[${i}] verdict=fail 时 must_fix 须为非空字符串数组`);
        }
      }
      const reverseMissing = row.reverse_missing;
      if (reverseMissing !== undefined && reverseMissing !== null) {
        if (!Array.isArray(reverseMissing) || !reverseMissing.every(x => typeof x === 'string')) {
          errors.push(`screens[${i}] reverse_missing 须为字符串数组`);
        }
      }
      const defects = row.defects;
      if (defects !== undefined && defects !== null) {
        if (!Array.isArray(defects)) {
          errors.push(`screens[${i}] defects 须为数组`);
        } else {
          for (const [j, d] of defects.entries()) {
            if (!d || typeof d !== 'object') {
              errors.push(`screens[${i}].defects[${j}] 须为 object`);
              continue;
            }
            const dd = d as Record<string, unknown>;
            if (typeof dd.class !== 'string' || !VALID_DEFECT_CLASSES.has(dd.class)) {
              errors.push(`screens[${i}].defects[${j}].class 非法：${String(dd.class)}`);
            }
            if (typeof dd.severity !== 'string' || !VALID_DEFECT_SEVERITIES.has(dd.severity)) {
              errors.push(`screens[${i}].defects[${j}].severity 非法：${String(dd.severity)}`);
            }
            if (typeof dd.note !== 'string' || !dd.note.trim()) {
              errors.push(`screens[${i}].defects[${j}].note 必填`);
            }
            if (dd.bbox !== undefined && dd.bbox !== null) {
              const bb = dd.bbox;
              if (!Array.isArray(bb) || bb.length !== 4 || !bb.every(n => typeof n === 'number' && n >= 0 && n <= 1)) {
                errors.push(`screens[${i}].defects[${j}].bbox 须为 4 个 [0,1] 数`);
              }
            }
          }
        }
      }
      const edgeTiles = row.edge_over_threshold_tiles;
      if (edgeTiles !== undefined && edgeTiles !== null) {
        if (
          !Array.isArray(edgeTiles) ||
          !edgeTiles.every(
            t => Array.isArray(t) && t.length === 2 && t.every(n => typeof n === 'number' && Number.isInteger(n) && n >= 0),
          )
        ) {
          errors.push(`screens[${i}] edge_over_threshold_tiles 须为 [row,col] 非负整数对数组`);
        }
      }
      const edgeDiv = row.edge_tile_divergence;
      if (edgeDiv !== undefined && edgeDiv !== null) {
        if (typeof edgeDiv !== 'number' || Number.isNaN(edgeDiv) || edgeDiv < 0 || edgeDiv > 1) {
          errors.push(`screens[${i}] edge_tile_divergence 须在 [0,1]，收到 ${String(edgeDiv)}`);
        }
      }
      const confirmedBy = row.confirmed_by;
      if (confirmedBy !== undefined && confirmedBy !== null && typeof confirmedBy !== 'string') {
        errors.push(`screens[${i}] confirmed_by 须为字符串`);
      }
      const scoreFloor = row.score_floor;
      if (scoreFloor !== undefined && scoreFloor !== null) {
        if (typeof scoreFloor !== 'number' || Number.isNaN(scoreFloor)) {
          errors.push(`screens[${i}] score_floor 须为 number`);
        } else if (scoreFloor < 0 || scoreFloor > 1) {
          errors.push(`screens[${i}] score_floor 须在 [0,1]，收到 ${scoreFloor}`);
        }
      }

      if (screenIdValid && verdictValid) {
        bestEffortScreens.push(row as unknown as VisualDiffScreenEntry);
      }
    }
  }

  const report: VisualDiffReport = {
    schema_version: schemaVersion || '0',
    screens: bestEffortScreens,
    ...(typeof rep.degraded === 'boolean' ? { degraded: rep.degraded } : {}),
    ...(typeof rep.degrade_reason === 'string' ? { degrade_reason: rep.degrade_reason } : {}),
  };
  if (errors.length > 0) {
    return { ok: false, report, errors, fatal: false };
  }
  return { ok: true, report, errors: [], fatal: false };
}

/** tile [row,col] 的归一化矩形 [x,y,w,h]（与采集层 EDGE_TILE 网格一致） */
function tileToNormRect(row: number, col: number): [number, number, number, number] {
  return [col / EDGE_TILE_COLS, row / EDGE_TILE_ROWS, 1 / EDGE_TILE_COLS, 1 / EDGE_TILE_ROWS];
}

/** 两归一化矩形 [x,y,w,h] 是否相交 */
function normRectsOverlap(a: number[], b: number[]): boolean {
  if (a.length !== 4 || b.length !== 4) return false;
  const [ax, ay, aw, ah] = a;
  const [bx, by, bw, bh] = b;
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

export interface EdgeSentinelUncovered {
  screen_id: string;
  tiles: number[][];
}

/**
 * v2 边缘哨兵兜底：超阈 tile（结构差异）未被任一 defect.bbox 几何覆盖、且数量达地板的屏 → 疑似漏登记。
 * reverse_missing 是元素 id 清单、无 bbox，不参与几何覆盖（须用 class=missing_render 的 defect.bbox 定位）。
 * 坐标对账：edge_over_threshold_tiles 为 [row,col]，经 EDGE_TILE 网格换算成归一化矩形再与 defect.bbox 求交。
 * 最小未覆盖数（minUncovered）：经合成 FP 探针，忠实设备图拉伸对齐后约 3 个 tile 为纯 FP 地板，
 * 真缺陷屏 ≥6；仅当未覆盖 tile ≥minUncovered(默认 5) 才 WARN，吸收 FP 地板（仍低置信、不 gate）。
 */
export function collectEdgeSentinelUncovered(
  screens: VisualDiffScreenEntry[],
  minUncovered: number = EDGE_SENTINEL_MIN_UNCOVERED,
): EdgeSentinelUncovered[] {
  const out: EdgeSentinelUncovered[] = [];
  for (const s of screens) {
    const tiles = s.edge_over_threshold_tiles;
    if (!Array.isArray(tiles) || tiles.length === 0) continue;
    const defectBoxes = (s.defects ?? [])
      .map(d => d.bbox)
      .filter((b): b is number[] => Array.isArray(b) && b.length === 4);
    const uncovered = tiles.filter(t => {
      if (!Array.isArray(t) || t.length !== 2) return false;
      const rect = tileToNormRect(t[0], t[1]);
      return !defectBoxes.some(b => normRectsOverlap(rect, b));
    });
    if (uncovered.length >= minUncovered) out.push({ screen_id: s.screen_id, tiles: uncovered });
  }
  return out;
}

/**
 * T4：pixel_1to1 P0 warn 屏「无可执行回修指令」——verdict=warn 却 **must_fix 空**。
 * 语义：pixel_1to1 P0 下 warn = "有残差、需再修一轮"；coding 真正消费的回修通道是 **must_fix**（可执行可定位的指令），
 * 而 defects/reverse_missing 只是**证据**、不是指令（单纯 `defects:[{note}]` 不能告诉 coding 改哪 → loop 仍瞎猜，
 * 正是 homepage 把卡包描述从卡夹下瞎挪到上的根源）。故 **defects/reverse_missing 不替代 must_fix**：要么把它们结构化成
 * must_fix（warn，须修），要么残差可接受就判 **pass + minor defect** 记录（无需修）。与灾难地板(0.45)互补：地板抓崩坏分，
 * 本条抓"压线 warn 却无 must_fix"（home_with_card 0.52 / manage_non_local 0.48 即此类）。
 * 注：reverse_missing/major defects 另有各自 ratchet（本条不依赖它们兜底，只钉死 must_fix 通道）。
 */
export function collectWarnP0NoActionable(
  screens: VisualDiffScreenEntry[],
  p0Ids: string[],
): VisualDiffScreenEntry[] {
  const p0IdSet = new Set(p0Ids);
  return screens.filter(
    s => s.verdict === 'warn' && p0IdSet.has(s.screen_id) && (s.must_fix?.length ?? 0) === 0,
  );
}

interface VisualDiffHit {
  id: string;
  severity: 'BLOCKER' | 'MAJOR';
  status: 'FAIL' | 'WARN';
  line: string;
  rank: number;
}

function visualDiffHitRank(severity: 'BLOCKER' | 'MAJOR', status: 'FAIL' | 'WARN'): number {
  return severity === 'BLOCKER' || status === 'FAIL' ? 3 : 2;
}

function pushVisualDiffHit(hits: VisualDiffHit[], hit: Omit<VisualDiffHit, 'rank'>): void {
  hits.push({ ...hit, rank: visualDiffHitRank(hit.severity, hit.status) });
}

function uiSpecCoversElementId(
  elementId: string,
  nodeIds: Set<string>,
  mustHave: Set<string>,
): boolean {
  if (nodeIds.has(elementId) || mustHave.has(elementId)) return true;
  const lower = elementId.toLowerCase();
  for (const id of nodeIds) {
    if (id.toLowerCase() === lower) return true;
  }
  for (const id of mustHave) {
    if (id.toLowerCase() === lower) return true;
  }
  return false;
}

function finalizeVisualDiffHits(
  desc: string,
  reportRel: string,
  baseDetails: string,
  hits: VisualDiffHit[],
): CheckResult {
  if (hits.length === 0) {
    return {
      id: 'visual_diff',
      category: 'structure',
      description: desc,
      severity: 'MAJOR',
      status: 'PASS',
      details: baseDetails,
      affected_files: [reportRel],
    };
  }
  hits.sort((a, b) => b.rank - a.rank || a.id.localeCompare(b.id));
  const top = hits[0];
  const resultId = hits.some(h => h.rank >= 3) ? 'visual_diff' : top.id;
  return {
    id: resultId,
    category: 'structure',
    description: desc,
    severity: top.severity,
    status: top.status,
    details: `${baseDetails}\n${hits.map(h => h.line).join('\n')}`,
    affected_files: [reportRel],
  };
}

/** device-testing 渲染回环报告校验 */
export function checkVisualDiff(ctx: CheckContext): CheckResult[] {
  const desc = ruleDesc(ctx);
  const reportRel = relFeatureArtifact(ctx.projectRoot, ctx.feature, 'visual-diff.md');
  const reportDir = path.join(
    ctx.projectRoot,
    'doc',
    'features',
    ctx.feature,
    'device-testing',
    'device-screenshots',
  );

  const specMd = loadSpecMarkdown(ctx);
  const uiChange = specMd ? parseUiChangeFromSpecMarkdown(specMd) : null;
  if (!uiChange || !UI_CHANGE_REQUIRES_UI_SPEC.has(uiChange)) {
    return [];
  }

  if (process.env.HARNESS_SKIP_VISUAL_DIFF === '1') {
    return [{
      id: 'visual_diff',
      category: 'structure',
      description: desc,
      severity: 'MINOR',
      status: 'SKIP',
      details: 'HARNESS_SKIP_VISUAL_DIFF=1',
      affected_files: [reportRel],
    }];
  }

  const mdPath = path.join(
    ctx.projectRoot,
    'doc',
    'features',
    ctx.feature,
    'device-testing',
    'visual-diff.md',
  );
  const jsonPath = path.join(reportDir, 'visual-diff.json');

  const deviceUnavailable =
    process.env.HARNESS_VISUAL_DIFF_DEGRADED === '1' ||
    process.env.HARNESS_SKIP_HVIGOR === '1';

  if (deviceUnavailable) {
    return [{
      id: 'visual_diff',
      category: 'structure',
      description: desc,
      severity: 'MAJOR',
      status: 'SKIP',
      details:
        '设备渲染回环未执行（warmup/无设备/Hylyre 不可用）；仅静态保真分生效。显式标注 degraded。',
      affected_files: [reportRel],
    }];
  }

  if (!fs.existsSync(mdPath) && !fs.existsSync(jsonPath)) {
    return [{
      id: 'visual_diff',
      category: 'structure',
      description: desc,
      severity: 'MAJOR',
      status: 'WARN',
      details:
        'visual-diff 报告尚未产出。device-testing 须执行 Hylyre 截图 QA + 多模态 vs 原图对照，写入 device-testing/visual-diff.md。',
      suggestion: '见 device-testing SKILL visual diff 步骤；MVP 先覆盖可直达顶层屏。',
      affected_files: [reportRel],
    }];
  }

  if (!fs.existsSync(jsonPath)) {
    return [{
      id: 'visual_diff',
      category: 'structure',
      description: desc,
      severity: 'MAJOR',
      status: 'WARN',
      details: 'visual-diff.md 存在但缺少 device-screenshots/visual-diff.json 结构化报告。',
      affected_files: [reportRel],
    }];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  } catch (e) {
    return [{
      id: 'visual_diff',
      category: 'structure',
      description: desc,
      severity: 'MAJOR',
      status: 'FAIL',
      details: `visual-diff.json 解析失败：${(e as Error).message}`,
      affected_files: [reportRel],
    }];
  }

  const uiDoc = loadUiSpecFile(uiSpecAbsPath(ctx.projectRoot, ctx.feature));
  const refIds = specMd ? collectAuthoritativeRefIds(specMd, uiDoc) : new Set<string>();
  const validated = validateVisualDiffJson(parsed, ctx.projectRoot, { authoritativeRefIds: refIds });
  const bestEffortReport = validated.report;
  if (validated.fatal || !bestEffortReport) {
    // root 非法 / screens 数组缺失：无可门禁对象。UI change=new_or_changed 且有 P0 目标屏时
    // 不得静默放行（视为「无有效视觉证据」），升 BLOCKER。
    const p0Targets = collectP0VisualTargetIds(uiDoc);
    const fatalBlocker = uiChange === 'new_or_changed' && p0Targets.length > 0;
    return [{
      id: 'visual_diff',
      category: 'structure',
      description: desc,
      severity: fatalBlocker ? 'BLOCKER' : 'MAJOR',
      status: 'FAIL',
      details: `visual-diff.json 无法解析为可校验报告：${validated.errors.join('；')}`,
      affected_files: [reportRel],
    }];
  }

  // G0：非 fatal 的 schema 问题（缺图 / 非法 ref_id 等）转 finding 追加，绝不掩盖下方实质门禁。
  const rep = bestEffortReport;
  const schemaErrors = validated.errors;
  const mustFix = rep.screens.flatMap(s => s.must_fix ?? []);
  const failScreens = rep.screens.filter(s => s.verdict === 'fail');
  const warnScreens = rep.screens.filter(s => s.verdict === 'warn');
  const passScreens = rep.screens.filter(s => s.verdict === 'pass');
  const skippedScreens = rep.screens.filter(s => s.verdict === 'skipped');
  const pendingScreens = rep.screens.filter(s => s.verdict === 'pending');
  const byScreenId = new Map(rep.screens.map(s => [s.screen_id, s] as const));

  const resolveP0Entry = (targetId: string): VisualDiffScreenEntry | undefined => {
    const direct = byScreenId.get(targetId);
    if (direct) return direct;
    // 兼容回落仅允许 overlay id → 其 parent/base entry（采集把 overlay 并入主屏 entry 的旧形态）；
    // 绝不允许 base 屏 id 被 overlay entry 反向覆盖——否则只采到 X__overlay__* 时，主屏 X 缺截图会被假覆盖、P0 漏采被放过。
    const sep = targetId.indexOf('__overlay__');
    if (sep > 0) {
      const baseEntry = byScreenId.get(targetId.slice(0, sep));
      if (baseEntry) return baseEntry;
    }
    return undefined;
  };

  // --- P0 覆盖：ui-spec 的 P0 屏必须出现且 verdict 非 skipped/pending ---
  const p0Ids = collectP0VisualTargetIds(uiDoc);
  const p0Uncovered = p0Ids.filter(id => {
    const entry = resolveP0Entry(id);
    return !entry || entry.verdict === 'skipped' || entry.verdict === 'pending';
  });

  // --- pass 屏的分数必须达最低阈值（堵「自报 0 分仍 pass」假 PASS）---
  const lowScorePass = passScreens.filter(
    s =>
      (typeof s.fidelity_score === 'number' && s.fidelity_score < PASS_MIN_FIDELITY) ||
      (typeof s.geometric_iou === 'number' && s.geometric_iou < PASS_MIN_IOU),
  );

  // --- pass 屏不得登记 blocker/major 渲染缺陷（裁切/重叠/形态/缺渲染）---
  const blockingDefectPass = passScreens.filter(s =>
    (s.defects ?? []).some(d => d.severity === 'blocker' || d.severity === 'major'),
  );

  const scoreFloorSentinel = rep.screens.filter(s => {
    if (typeof s.score_floor !== 'number' || typeof s.fidelity_score !== 'number') return false;
    return s.fidelity_score - s.score_floor >= SCORE_FLOOR_SENTINEL_GAP;
  });

  const reverseMissingAll = rep.screens.flatMap(s => s.reverse_missing ?? []);

  const missingEvalHashScreens = rep.screens.filter(s => isMissingEvaluatedScreenshotHash(s));
  const staleScreens = rep.screens.filter(s => isStaleVisualDiffVerdict(s, ctx.projectRoot));

  const hashGroups = new Map<string, string[]>();
  for (const s of rep.screens) {
    const h = s.screenshot_hash?.trim();
    if (!h) continue;
    const list = hashGroups.get(h) ?? [];
    list.push(s.screen_id);
    hashGroups.set(h, list);
  }
  const duplicateHashScreens = [...hashGroups.entries()]
    .filter(([, ids]) => ids.length >= 2)
    .map(([h, ids]) => `${h}:${ids.join('+')}`);

  const pixel1to1 = isPixel1to1(ctx);
  const refElementsPath = refElementsAbsPath(ctx.projectRoot, ctx.feature);
  const refElementsDoc = fs.existsSync(refElementsPath)
    ? loadRefElementsFile(refElementsPath)
    : null;
  const screensMissingReverseEnum = pixel1to1
    ? rep.screens.filter(s => !isCaptureMutableVerdict(s.verdict) && s.reverse_missing === undefined)
    : [];
  // D11：pixel_1to1 下 finalized verdict 须逐屏枚举 defects（可为 []），与 reverse_missing 对齐
  const screensMissingDefectsEnum = pixel1to1
    ? rep.screens.filter(s => !isCaptureMutableVerdict(s.verdict) && s.defects === undefined)
    : [];

  // 采集层边缘哨兵：超阈 tile 未被任何 defect.bbox 覆盖、且数量达地板 → 疑似漏登记（v2；
  // reverse_missing 无 bbox 不参与几何覆盖，须用 class=missing_render 的 defect.bbox 定位）
  const edgeUncoveredScreens = collectEdgeSentinelUncovered(rep.screens);

  const details = [
    `screens=${rep.screens.length}`,
    `pass=${passScreens.length}`,
    `warn=${warnScreens.length}`,
    `fail=${failScreens.length}`,
    `skipped=${skippedScreens.length}`,
    `pending=${pendingScreens.length}`,
    `must_fix=${mustFix.length}`,
    `p0=${p0Ids.length}`,
    `defects=${rep.screens.reduce((n, s) => n + (s.defects?.length ?? 0), 0)}`,
    rep.degraded ? 'degraded' : '',
  ].filter(Boolean).join('；');
  /** P1-C：不参与判定的参考注记（score_floor reference_only 等），只随 details 展示 */
  const referenceNotes: string[] = [];

  const hits: VisualDiffHit[] = [];

  if (schemaErrors.length > 0) {
    pushVisualDiffHit(hits, {
      id: 'visual_diff_schema',
      severity: 'MAJOR',
      status: 'FAIL',
      line:
        `visual-diff.json 结构问题（已继续计算实质门禁、未掩盖）：` +
        `${schemaErrors.slice(0, 6).join('；')}${schemaErrors.length > 6 ? '…' : ''}`,
    });
  }

  if (p0Uncovered.length > 0) {
    const uiChangeGate = uiChange === 'new_or_changed';
    pushVisualDiffHit(hits, {
      id: 'visual_diff',
      severity: uiChangeGate ? 'BLOCKER' : 'MAJOR',
      status: uiChangeGate ? 'FAIL' : 'WARN',
      line: `P0 屏/overlay 未覆盖或被 skipped/pending：${p0Uncovered.join(', ')}`,
    });
  }

  const effectiveScreens = passScreens.length + warnScreens.length + failScreens.length;
  if (effectiveScreens === 0) {
    const pendingHint =
      pendingScreens.length > 0
        ? '所有屏 verdict=pending（VL 未完成判定），无有效视觉对照'
        : '所有屏 verdict=skipped，无有效视觉对照';
    const uiChangeGate = uiChange === 'new_or_changed' && p0Ids.length > 0 && pendingScreens.length > 0;
    pushVisualDiffHit(hits, {
      id: 'visual_diff',
      severity: uiChangeGate ? 'BLOCKER' : 'MAJOR',
      status: uiChangeGate ? 'FAIL' : 'WARN',
      line: `${pendingHint}；不得作为视觉保真 PASS`,
    });
  }

  if (lowScorePass.length > 0) {
    const ratchet = pixel1to1
      ? fidelityRatchetFailOrWarn(ctx, false)
      : { severity: 'MAJOR' as const, status: 'WARN' as const };
    pushVisualDiffHit(hits, {
      id: 'visual_diff',
      severity: ratchet.severity,
      status: ratchet.status,
      line:
        `verdict=pass 但分数低于阈值（fidelity<${PASS_MIN_FIDELITY} 或 iou<${PASS_MIN_IOU}）：` +
        lowScorePass.map(s => `${s.screen_id}(f=${s.fidelity_score ?? 'n/a'},iou=${s.geometric_iou ?? 'n/a'})`).join(', '),
    });
  }

  // C：warn 屏灾难地板——warn 允许有残差，但 fidelity/iou 低到灾难级（全色块 ~0.1）仍放行是无底洞。
  // pass 屏由上方 lowScorePass(0.6) 覆盖；此处补 warn 屏（0.45/0.40），只抓崩坏不误伤正常残差。
  const lowFidelityWarn = warnScreens.filter(
    s =>
      (typeof s.fidelity_score === 'number' && s.fidelity_score < FINALIZED_MIN_FIDELITY) ||
      (typeof s.geometric_iou === 'number' && s.geometric_iou < FINALIZED_MIN_IOU),
  );
  if (lowFidelityWarn.length > 0) {
    const ratchet = pixel1to1
      ? fidelityRatchetFailOrWarn(ctx, false)
      : { severity: 'MAJOR' as const, status: 'WARN' as const };
    pushVisualDiffHit(hits, {
      id: 'visual_diff_low_fidelity_floor',
      severity: ratchet.severity,
      status: ratchet.status,
      line:
        `verdict=warn 但分数低于灾难地板（fidelity<${FINALIZED_MIN_FIDELITY} 或 iou<${FINALIZED_MIN_IOU}）：` +
        lowFidelityWarn.map(s => `${s.screen_id}(f=${s.fidelity_score ?? 'n/a'},iou=${s.geometric_iou ?? 'n/a'})`).join(', '),
    });
    // 诚实性交叉校验：低于地板却 defects:[] 且 reverse_missing:[] = 低分无依据（注水/不诚实）→ 同级 ratchet。
    const dishonest = lowFidelityWarn.filter(
      s => (s.defects?.length ?? 0) === 0 && (s.reverse_missing?.length ?? 0) === 0,
    );
    if (dishonest.length > 0) {
      pushVisualDiffHit(hits, {
        id: 'visual_diff_low_fidelity_floor',
        severity: ratchet.severity,
        status: ratchet.status,
        line:
          `低于地板却未登记任何 defects/reverse_missing（低分无依据，须 VL 补缺陷或修分）：` +
          dishonest.map(s => s.screen_id).join(', '),
      });
    }
  }

  // T4：pixel_1to1 P0 warn 屏必须带**非空 must_fix**（coding 消费的回修指令通道；defects/reverse_missing 只是证据、不替代——
  // 详见 collectWarnP0NoActionable 文档）。否则 = "知道不完美却不告诉 loop 改哪" → loop 饿死瞎猜（homepage 把卡包描述从卡夹下
  // 瞎挪到上的根源）。与上方灾难地板(0.45)互补：地板抓"崩坏分"，本条抓"压线 warn 却无 must_fix"（home_with_card 0.52 /
  // manage_non_local 0.48 即此类）。残差可接受就判 pass(+minor defect)；判 warn 就必须用 must_fix 说清改哪。
  const warnP0NoActionable = collectWarnP0NoActionable(rep.screens, p0Ids);
  if (pixel1to1 && warnP0NoActionable.length > 0) {
    const ratchet = fidelityRatchetFailOrWarn(ctx, false);
    pushVisualDiffHit(hits, {
      id: 'visual_diff_warn_no_actionable',
      severity: ratchet.severity,
      status: ratchet.status,
      line:
        `pixel_1to1 P0 屏 verdict=warn 却无可执行回修指令（must_fix 空，loop 无法精准回修；defects/reverse_missing 是证据非指令、不替代）：` +
        warnP0NoActionable.map(s => `${s.screen_id}(f=${s.fidelity_score ?? 'n/a'})`).join(', ') +
        `；warn 须给 coding 可执行 must_fix（残差可接受则判 pass+minor defect 记录）`,
    });
  }

  // T5：声明式全局元素越界（如底部「首页/我的」Tab 泄漏到 card_pack/add_card 子页）——OCR 确定性检测，
  // 不靠 root 类型猜（实测子页 root 也是 navigation_frame@0）。仅 global_elements 声明 + OCR 可用时实际跑 OCR。
  const oob = collectOutOfBoundsGlobalElements(
    uiDoc?.global_elements,
    rep.screens,
    rel => resolveShotPath(ctx.projectRoot, rel),
  );
  if (oob.violations.length > 0) {
    const ratchet = pixel1to1
      ? fidelityRatchetFailOrWarn(ctx, false)
      : { severity: 'MAJOR' as const, status: 'WARN' as const };
    pushVisualDiffHit(hits, {
      id: 'visual_diff_out_of_bounds_element',
      severity: ratchet.severity,
      status: ratchet.status,
      line:
        `全局元素越界（仅属主屏可渲染该元素，却现于其它屏指定 band）：` +
        oob.violations.map(v => `${v.element_id}@${v.screen_id}[${v.texts.join('+')}]`).join(', '),
    });
  }
  // 降级信号：声明了 global_elements 须检测、却因 OCR 不可用/失败无法确认的屏——降 WARN 复核，不静默放过
  // （OCR 不可用 ≠ 没泄漏；对齐"降 WARN 不 SKIP 整门禁"设计意图）。
  if (oob.ocrUnavailable.length > 0) {
    pushVisualDiffHit(hits, {
      id: 'visual_diff_out_of_bounds_degraded',
      severity: 'MAJOR',
      status: 'WARN',
      line:
        `越界门禁降级：以下屏声明了 global_elements 但 OCR 不可用/失败、无法确认是否越界，须复核（装 tesseract.js/物化 chi_sim 后重采）：` +
        oob.ocrUnavailable.join(', '),
    });
  }

  // T1（窄）：pixel_1to1 P0 pass 屏声明锚点文本整块缺失 = 疑似 missing-render（高置信窄门禁，对 device≠mockup 鲁棒）。
  // 两次实测证伪了像素/文本-位置度量；唯一鲁棒的 OCR 信号是文本存在性，故 T1 仅做"整块缺失"。位置/样式/图标类
  // 假 PASS 不靠 T1，靠 T2（pixel_1to1 P0 人确认）+ T7（VL 证据）。
  if (pixel1to1 && uiDoc) {
    // codex 四轮 P1：pass/P0 过滤与 anchors 键全部按基屏归一化（吸收 __overlay__* 后缀），
    // 否则 root-overlay 的 P0 pass 屏（manage_non_local__overlay__0）拿不到 anchors、T1 静默跳过；
    // "仅 pass 屏受检"的语义改在 screens 入参处过滤（anchors 键已归一化，不能再靠键面隐含过滤）。
    const passBaseIds = new Set(passScreens.map(s => canonicalOverlayBase(s.screen_id)));
    const p0BaseIds = new Set(p0Ids.map(canonicalOverlayBase));
    const screenAnchors = new Map<string, string[]>();
    for (const sc of uiDoc.screens ?? []) {
      if (!p0BaseIds.has(sc.id) || !passBaseIds.has(sc.id)) continue;
      const nodes = collectAllComponentNodes({ screens: [sc], tokens: {}, assets: [] } as UiSpecDoc);
      const texts = nodes.map(n => n.text).filter((t): t is string => typeof t === 'string' && t.trim().length > 0);
      if (texts.length > 0) screenAnchors.set(sc.id, texts);
    }
    const missingRes = collectGrossMissingAnchorText(
      screenAnchors,
      rep.screens.filter(s => s.verdict === 'pass'),
      rel => resolveShotPath(ctx.projectRoot, rel),
    );
    if (missingRes.violations.length > 0) {
      const ratchet = fidelityRatchetFailOrWarn(ctx, false);
      pushVisualDiffHit(hits, {
        id: 'visual_diff_text_missing',
        severity: ratchet.severity,
        status: ratchet.status,
        line:
          `pixel_1to1 P0 pass 屏声明锚点文本整块缺失（疑似该区域 missing-render；VL 不应判 pass）：` +
          missingRes.violations.map(v => `${v.screen_id}(缺 ${v.missing.length}/${v.declared}: ${v.missing.slice(0, 4).join(',')})`).join('; '),
      });
    }
    if (missingRes.ocrUnavailable.length > 0) {
      pushVisualDiffHit(hits, {
        id: 'visual_diff_text_missing_degraded',
        severity: 'MAJOR',
        status: 'WARN',
        line: `锚点缺失检测降级（OCR 不可用，须复核）：${missingRes.ocrUnavailable.join(', ')}`,
      });
    }
  }

  // P1-C（f2d8c4a6）：文本块二部匹配观测——参考图 vs 截图的相对信号（存在性/同行分组/纵向顺序，
  // 对 device≠mockup 缩放不变；绝对偏移已两次实测证伪故不做）。fail 级信号是确定性证据，
  // VL verdict=pass 不可推翻；per-element must_fix 喂回 loop（治"halt 了却说不出改哪"）。
  if (uiDoc && specMd) {
    const refIndex = buildAuthoritativeRefImageIndex(ctx, specMd);
    const screenTextsMap = new Map<string, string[]>();
    for (const sc of uiDoc.screens ?? []) {
      const nodes = collectAllComponentNodes({ screens: [sc], tokens: {}, assets: [] } as UiSpecDoc);
      const texts: string[] = [];
      for (const n of nodes) {
        if (typeof n.text === 'string' && n.text.trim()) texts.push(n.text);
        const sub = (n as { subtitle?: string }).subtitle;
        if (typeof sub === 'string' && sub.trim()) texts.push(sub);
      }
      if (texts.length > 0) screenTextsMap.set(sc.id, texts);
    }
    const screenRefIds = new Map<string, string>();
    for (const sc of uiDoc.screens ?? []) screenRefIds.set(sc.id, sc.ref_id ?? sc.id);
    // overlay 屏 id 归一化回落基屏（codex 三轮 P1）：ref 解析与 P0 判定都吸收 __overlay__* 后缀
    const refIdFor = (s: { screen_id: string; ref_id?: string }): string =>
      screenRefIds.get(s.screen_id) ??
      screenRefIds.get(canonicalOverlayBase(s.screen_id)) ??
      s.ref_id ??
      canonicalOverlayBase(s.screen_id);
    const placement = collectTextPlacementSignals(
      screenTextsMap,
      rep.screens,
      rel => resolveShotPath(ctx.projectRoot, rel),
      s => resolveRefSourceImage(refIndex, refIdFor(s)).path,
    );
    const p0BaseSet = new Set(p0Ids.map(canonicalOverlayBase));
    const failScreensPlacement = placement.perScreen.filter(
      p => p.fail_signals.length > 0 && p0BaseSet.has(canonicalOverlayBase(p.screen_id)),
    );
    const warnScreensPlacement = placement.perScreen.filter(p => !failScreensPlacement.includes(p));
    if (failScreensPlacement.length > 0) {
      const ratchet = pixel1to1
        ? fidelityRatchetFailOrWarn(ctx, false)
        : { severity: 'MAJOR' as const, status: 'WARN' as const };
      pushVisualDiffHit(hits, {
        id: 'visual_diff_text_placement',
        severity: ratchet.severity,
        status: ratchet.status,
        line:
          `文本块结构背离（相对信号确定性证据，VL pass 不可推翻）：` +
          failScreensPlacement
            .map(p => `${p.screen_id}: ${[...p.fail_signals, ...p.must_fix].slice(0, 4).join('；')}`)
            .join(' | '),
      });
    }
    // advisory 语义（codex 三轮 P2 明确化）：存在性缺失/单对逆序是**观测素材**（WARN，不写回
    // visual-diff.json、不进 pixel_1to1 阻断通道）——设备 OCR 噪声使其直接阻断=FP 风暴风险。
    // 喂回 loop 的链路：VL/agent 终判时把这些观测折算进 screens[].must_fix（T4 强制 P0 warn 屏
    // must_fix 非空，本 WARN 提供可直接引用的 per-element 素材）；fail_signals 才走上面的阻断通道。
    if (warnScreensPlacement.length > 0) {
      pushVisualDiffHit(hits, {
        id: 'visual_diff_text_placement_must_fix',
        severity: 'MAJOR',
        status: 'WARN',
        line:
          `文本块观测 per-element 素材（advisory，VL 终判须折算进 screens[].must_fix；不直接阻断）：` +
          warnScreensPlacement
            .map(p => `${p.screen_id}: ${[...p.fail_signals, ...p.must_fix].slice(0, 4).join('；')}`)
            .join(' | '),
      });
    }
    // P0-2 弃判硬 backstop：fail_signals 在手的屏不许 pending——确定性 FAIL 可判即须判
    // （verdict=fail + 信号转 must_fix + 重试轮内修码重测），弃判=浪费重试预算且 loop 饿死。
    const abandonment = collectVerdictAbandonment(placement.perScreen, rep.screens);
    if (abandonment.length > 0) {
      const ratchet = pixel1to1
        ? fidelityRatchetFailOrWarn(ctx, false)
        : { severity: 'MAJOR' as const, status: 'WARN' as const };
      pushVisualDiffHit(hits, {
        id: 'visual_diff_verdict_abandonment',
        severity: ratchet.severity,
        status: ratchet.status,
        line:
          `【弃判】以下屏有确定性 FAIL 信号却 verdict=pending——headless 下必须判 fail 并把信号转 must_fix 后修码重测，` +
          `不得以"无人值守不可闭环"弃判（真人确认只在 pass 候选时需要）：` +
          abandonment
            .map(a => `${a.screen_id}: ${a.lines.slice(0, 4).join('；')}${a.lines.length > 4 ? '…' : ''}`)
            .join(' | '),
      });
    }
    if (placement.ocrUnavailable.length > 0 || placement.refUnavailable.length > 0) {
      pushVisualDiffHit(hits, {
        id: 'visual_diff_text_placement_degraded',
        severity: 'MAJOR',
        status: 'WARN',
        line:
          `文本块观测降级：` +
          (placement.ocrUnavailable.length ? `截图 OCR 不可用（${placement.ocrUnavailable.join(', ')}）` : '') +
          (placement.refUnavailable.length ? `${placement.ocrUnavailable.length ? '；' : ''}参考原图缺失/不可读（${placement.refUnavailable.join(', ')}）` : '') +
          `——须复核，不静默放过`,
      });
    }
  }

  // T2（主背靠）：pixel_1to1 P0 屏判 pass 须真人过目确认（confirmed_by 非空且非自动化身份）。
  // 两次实测证伪了像素/文本-位置度量（忠实屏误报）——图标/颜色/样式类假 PASS 不可约地需 VL/人判，
  // 故 pixel_1to1 最严档下 P0 pass 屏不得仅凭 VL 自报闭环。headless 缺确认 → BLOCKER（goal-runner 据此 HALT 求人）；
  // 交互态 → BLOCKER（agent 当场 stop-and-ask 用户确认、置 confirmed_by 后重判）。goal-mode-auto 等自签不算。
  if (pixel1to1) {
    const p0Set = new Set(p0Ids);
    const unconfirmed = passScreens.filter(s => p0Set.has(s.screen_id) && !isHumanConfirmed(s.confirmed_by));
    if (unconfirmed.length > 0) {
      const ratchet = fidelityRatchetFailOrWarn(ctx, false);
      pushVisualDiffHit(hits, {
        id: 'visual_diff_human_confirm_required',
        severity: ratchet.severity,
        status: ratchet.status,
        line:
          `pixel_1to1 P0 屏判 pass 须真人确认（confirmed_by 非自动化身份）——客观度量无法判图标/颜色/样式，须人兜底：` +
          unconfirmed.map(s => `${s.screen_id}${s.confirmed_by ? `(confirmed_by=${s.confirmed_by} 属自动化/无效)` : '(缺 confirmed_by)'}`).join(', ') +
          `；headless 走 HALT 求人，交互态当场确认后置 confirmed_by 重判。`,
      });
    }
  }

  if (blockingDefectPass.length > 0) {
    const ratchet = pixel1to1
      ? fidelityRatchetFailOrWarn(ctx, false)
      : { severity: 'MAJOR' as const, status: 'WARN' as const };
    pushVisualDiffHit(hits, {
      id: 'visual_diff',
      severity: ratchet.severity,
      status: ratchet.status,
      line:
        `verdict=pass 但登记了 blocker/major 渲染缺陷（裁切/重叠/形态/缺渲染）：` +
        blockingDefectPass
          .map(s => `${s.screen_id}(${(s.defects ?? []).filter(d => d.severity !== 'minor').map(d => d.class).join(',')})`)
          .join(', '),
    });
  }

  if (missingEvalHashScreens.length > 0) {
    pushVisualDiffHit(hits, {
      id: 'visual_diff',
      severity: pixel1to1 ? 'BLOCKER' : 'MAJOR',
      status: pixel1to1 ? 'FAIL' : 'WARN',
      line:
        `finalized verdict 缺少 evaluated_screenshot_hash：` +
        missingEvalHashScreens.map(s => s.screen_id).join(', '),
    });
  }

  if (staleScreens.length > 0) {
    pushVisualDiffHit(hits, {
      id: 'visual_diff',
      severity: pixel1to1 ? 'BLOCKER' : 'MAJOR',
      status: pixel1to1 ? 'FAIL' : 'WARN',
      line:
        `verdict 所依据截图已变更，须 VL 重判：` +
        staleScreens.map(s => s.screen_id).join(', '),
    });
  }

  // P1-C（f2d8c4a6）：score_floor 降级为 reference_only 注记——像素直方图度量已被历史多次实测证伪
  // （round6 card_pack=0.999：UI 全错像素分近满分；round2/3：忠实屏被排在崩坏屏之下），
  // 不再参与任何判定/权重；字段保留仅作参考注记，文本类观测（存在性/同行/顺序）才是确定性信号。
  if (scoreFloorSentinel.length > 0) {
    referenceNotes.push(
      `[reference_only] score_floor 与 VL 分差参考注记（不参与判定，像素度量已实测证伪）：` +
      scoreFloorSentinel.map(s => `${s.screen_id}(f=${s.fidelity_score},floor=${s.score_floor})`).join(', '),
    );
  }

  if (duplicateHashScreens.length > 0) {
    // x-capture-bug：≥2 个不同屏共享 hash = Tab 未切换/重复采集，至少一屏是错图，
    // VL 在错图上闭环（homepage：home 与 mine 同 d3bea384…）。pixel_1to1 下升 BLOCKER。
    const ratchet = pixel1to1
      ? fidelityRatchetFailOrWarn(ctx, false)
      : { severity: 'MAJOR' as const, status: 'WARN' as const };
    pushVisualDiffHit(hits, {
      id: 'visual_diff_screenshot_dedup',
      severity: ratchet.severity,
      status: ratchet.status,
      line: `≥2 屏共享 screenshot_hash（疑似 Tab 未切换/重复采集，至少一屏为错图）：${duplicateHashScreens.join('; ')}`,
    });
  }

  if (screensMissingReverseEnum.length > 0) {
    const ratchet = fidelityRatchetFailOrWarn(ctx, false);
    pushVisualDiffHit(hits, {
      id: 'visual_diff_reverse_enum',
      severity: ratchet.severity,
      status: ratchet.status,
      line:
        `pixel_1to1 须逐屏填写 reverse_missing（可为 []）：` +
        screensMissingReverseEnum.map(s => s.screen_id).join(', '),
    });
  }

  if (screensMissingDefectsEnum.length > 0) {
    const ratchet = fidelityRatchetFailOrWarn(ctx, false);
    pushVisualDiffHit(hits, {
      id: 'visual_diff_defects_enum',
      severity: ratchet.severity,
      status: ratchet.status,
      line:
        `pixel_1to1 须逐屏填写 defects（可为 []）：` +
        screensMissingDefectsEnum.map(s => s.screen_id).join(', '),
    });
  }

  // 边缘哨兵兜底：只发 WARN、永不单独 FAIL（容忍对齐误差；以 VL 复核为准）
  if (edgeUncoveredScreens.length > 0) {
    pushVisualDiffHit(hits, {
      id: 'visual_diff_edge_sentinel',
      severity: 'MAJOR',
      status: 'WARN',
      line:
        `边缘哨兵：超阈 tile 有结构差异但未被 defect.bbox 登记，VL 须复核区域：` +
        edgeUncoveredScreens
          .map(e => `${e.screen_id}[${e.tiles.map(t => `${t[0]},${t[1]}`).join(' ')}]`)
          .join('; '),
    });
  }

  if (reverseMissingAll.length > 0) {
    const ratchet = pixel1to1
      ? fidelityRatchetFailOrWarn(ctx, false)
      : { severity: 'MAJOR' as const, status: 'WARN' as const };
    pushVisualDiffHit(hits, {
      id: 'visual_diff_reverse_missing',
      severity: ratchet.severity,
      status: ratchet.status,
      line: `反向 diff 残差（参考图有、实现无）：${reverseMissingAll.slice(0, 12).join(', ')}${reverseMissingAll.length > 12 ? '…' : ''}`,
    });
  }

  if (refElementsDoc && pixel1to1 && uiDoc && passScreens.length > 0) {
    const nodes = collectAllComponentNodes(uiDoc);
    const nodeIds = new Set(nodes.map(n => n.id).filter((id): id is string => Boolean(id)));
    const mustHave = new Set((uiDoc.screens ?? []).flatMap(s => s.must_have_elements ?? []));
    const reverseLower = new Set(reverseMissingAll.map(r => r.toLowerCase()));
    const implementIds = refElementsDoc.elements
      .filter(e => e.disposition !== 'defer')
      .map(e => e.element_id);
    const unaccounted = implementIds.filter(id => {
      if (uiSpecCoversElementId(id, nodeIds, mustHave)) return false;
      const lower = id.toLowerCase();
      if (reverseLower.has(lower)) return false;
      for (const r of reverseLower) {
        if (r.includes(lower) || lower.includes(r)) return false;
      }
      return true;
    });
    if (unaccounted.length > 0) {
      const ratchet = fidelityRatchetFailOrWarn(ctx, false);
      pushVisualDiffHit(hits, {
        id: 'visual_diff_bidirectional_residual',
        severity: ratchet.severity,
        status: ratchet.status,
        line:
          `ref-elements implement 未进 ui-spec 也未写入 reverse_missing：` +
          `${unaccounted.slice(0, 12).join(', ')}${unaccounted.length > 12 ? '…' : ''}`,
      });
    }
  }

  if (failScreens.length > 0 || mustFix.length > 0) {
    const ratchet = pixel1to1
      ? fidelityRatchetFailOrWarn(ctx, false)
      : { severity: 'MAJOR' as const, status: 'WARN' as const };
    pushVisualDiffHit(hits, {
      id: 'visual_diff',
      severity: ratchet.severity,
      status: ratchet.status,
      line: `must-fix：${mustFix.slice(0, 5).join('；')}${failScreens.length > 0 ? `；fail 屏：${failScreens.map(s => s.screen_id).join(', ')}` : ''}`,
    });
  }

  const detailsWithNotes = referenceNotes.length > 0 ? `${details}\n${referenceNotes.join('\n')}` : details;
  return [finalizeVisualDiffHits(desc, reportRel, detailsWithNotes, hits)];
}
