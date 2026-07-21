// ============================================================================
// device_test.visual_diff — Hylyre 截图报告校验（禁假 PASS）
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import type { CheckContext, CheckResult } from '../../../harness/scripts/utils/types';
import { relFeatureArtifact, featuresDirPath, featureDir } from '../../../harness/config';
import { resolveCurrentBuildFingerprint } from './build-fingerprint';
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
import { collectVisualDiffTamperArtifacts } from './evidence-tamper-scan';
import { checkRenderVisibilityCalibrate } from './render-visibility';
import { checkUiKitRuntimeConformance } from './ui-kit-conformance-check';
import { checkRuntimeMountConformance } from './runtime-mount-conformance';
import { checkVisualFeedback } from './visual-feedback';
import { EDGE_TILE_ROWS, EDGE_TILE_COLS, EDGE_SENTINEL_MIN_UNCOVERED } from './image-toolkit';
import { isPixel1to1, fidelityRatchetFailOrWarn, isHumanVerified } from '../../../harness/scripts/utils/fidelity-shared';
import { loadRefElementsFile, refElementsAbsPath } from '../../../harness/scripts/utils/fidelity-shared';
import { collectLayoutOracleForScreen, loadLayoutDumpFile, LOCATOR_COVERAGE_THRESHOLD, type LayoutFinding } from './layout-oracle-check';
import {
  intermediateRoundsJournalPath,
  journalRowsToLogicalHistory,
  readJournalProposals,
} from '../../../harness/scripts/utils/intermediate-rounds-journal';
import {
  evaluateVisualRound,
  visualRoundsLedgerPath,
  type VisualRoundEvaluation,
} from '../../../harness/scripts/utils/visual-rounds-ledger';
import { parseImageReadEventsFor } from '../../../harness/scripts/utils/critic-receipt-producer';
import { createRequire } from 'module';

const requireHarness = createRequire(path.resolve(__dirname, '../../../harness/harness-runner.ts'));
const YAML = requireHarness('yaml') as { parse: (s: string) => unknown };

/**
 * t4（plan c6d8f2b4）：自报分数退出一切 gate 输入。历史 PASS_MIN/FINALIZED_MIN 地板消费的是
 * VL 自报值（bc-openCard 实证自报退化成填表：8 屏 iou 恒 0.95、7/8 屏逐位抄 floor——地板=假保障）。
 * 阈值常量保留备将来「真算几何值」接入；当前无真算来源 → 地板 SKIP+注记，绝不再吃 reported_*。
 */
const PASS_MIN_FIDELITY = 0.6;
const PASS_MIN_IOU = 0.5;
const FINALIZED_MIN_FIDELITY = 0.45;
const FINALIZED_MIN_IOU = 0.4;
/** M1：压线检测 ε——|reported_fidelity_score − score_floor| < ε 且 pass 且 defects=[] → WARN */
const SELFREPORT_GRAZE_EPSILON = 0.005;
/** M1：跨屏常数检测最小样本（finalized 屏数） */
const SELFREPORT_CONSTANT_MIN_SCREENS = 4;
/** M1：抄 floor 检测最小屏数（浮点逐位相等） */
const SELFREPORT_COPYFLOOR_MIN_SCREENS = 2;
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
  // P0-9 顺手项：走 featureDir 尊重 paths.features_dir 配置
  const p = path.join(featureDir(ctx.projectRoot, ctx.feature), 'spec', 'spec.md');
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf-8');
}

export type VisualDiffDefectClass = 'clipping' | 'overlap' | 'shape_mismatch' | 'missing_render' | 'other';
export type VisualDiffDefectSeverity = 'blocker' | 'major' | 'minor';

/** t0（plan f7a3d9c2）：defect 的 T8 转录溯源锚点——transcription audit 主判据 */
export interface VisualDiffDefectSource {
  producer: 'T8';
  finding_id: string;
  signal: string;
}

/** 正向渲染缺陷（实现有但渲染错）。bbox 为归一化 [x,y,w,h] ∈ [0,1] */
export interface VisualDiffDefect {
  class: VisualDiffDefectClass;
  element?: string;
  bbox?: number[];
  severity: VisualDiffDefectSeverity;
  note: string;
  /** t0：T8 发现转录溯源（可选，legacy 兼容）；t2 对账主判据 */
  source?: VisualDiffDefectSource;
  /**
   * t0：本 defect 结构化锚定的 must_fix 条目下标（该屏 must_fix 数组下标）。
   * t2：pixel_1to1 P0 屏每条 must_fix 须被 ≥1 个 defect 引用，否则 BLOCKER（堵
   * "条数凑平但错配"的 filler defects 剩余缝）。
   */
  must_fix_refs?: number[];
}

/** t5/t7（schema 1.1）：pass 的逐区域举证条目 */
export interface RegionAttestEntry {
  region: string;
  verdict: 'no_diff' | 'diff_logged';
  method: 'paired_crop_compare' | 'vl_screening' | 'human';
  /** method=paired_crop_compare 时必填：_attest/ 并排 crop 相对路径（harness 验存在性） */
  evidence?: string;
  /** rev8（paired 必填）：crop 文件 sha256-16——harness 重算比对，"文件存在"升级为"内容绑定" */
  evidence_hash?: string;
  /** rev8（paired 必填）：被评截图 hash——须等于该屏 evaluated_screenshot_hash（绑定"这张真机图"） */
  source_screenshot_hash?: string;
  /** rev8（paired 必填）：参考原图 hash——ref 可解析时重算比对（绑定"这张参考图"） */
  source_ref_hash?: string;
  /** rev8（paired 必填）：crop 来源区域，归一化 [x,y,w,h]（绑定"这个区域"） */
  source_bbox?: number[];
  by?: string;
}

/** t7：critic 调用回执（device-testing/reports/critic-receipt.json） */
export interface CriticReceipt {
  schema_version?: string;
  critic_run_id: string;
  /** rev8：必填（OpenSpec 结构字段）——哪个 adapter 执行的 critic */
  adapter: string;
  model?: string;
  prompt_hash: string;
  /** verified=调用侧可证图片注入（native_attach/transcript 验读）；tool_read 交互态一律如实 unverified */
  input_provenance: 'verified' | 'unverified';
  /** rev8：非空必填，每项 path 合法——空数组回执=声称跑了 critic 却没看任何图，任何档位拒绝 */
  image_inputs: Array<{ path: string; hash?: string }>;
  /** rev8：provenance=verified 时必填（critic 输出可追溯） */
  output_hash?: string;
  /**
   * t3b（f7a3d9c2）：runner attestation——verified 档唯一合法来源（完整性绑定，非密码学
   * 签名）。check 重算 evidence_log_hash 比对：缺段/hash 不符=手写 verified 冒充 → 降级。
   */
  runner_attestation?: {
    goal_run_id: string;
    /** 相对 projectRoot；须为纯净结构化事件文件（agent-events.jsonl），非混合人读日志 */
    evidence_log_path: string;
    evidence_log_hash: string;
    source?: string;
  };
  /** t3b：验读覆盖缺口（runner 审计如实记录，unverified 档） */
  unread_screenshots?: string[];
  unread_crops?: string[];
}

export interface VisualDiffScreenEntry {
  screen_id: string;
  verdict: 'pass' | 'warn' | 'fail' | 'skipped' | 'pending';
  /** S2/P1-3（visual-capability-truth）：本截图通过的 identity 规则指纹——同 build 跳采
   * 须 identity 未变才合法（identity 变更/旧图未验身份 → 强制重采过 gate） */
  identity_fingerprint?: string;
  screenshot_path?: string;
  ref_path?: string;
  ref_id?: string;
  /** legacy 1.0 字段名——读入即映射 reported_*；零 gate 权重 */
  fidelity_score?: number;
  geometric_iou?: number;
  /** t4（1.1）：VL 参考自评，零 gate 权重（自报值退出一切 gate 输入） */
  reported_fidelity_score?: number;
  reported_geometric_iou?: number;
  /**
   * t4③：评估新鲜度失效标记——与采集新鲜度解耦。true=该屏评估产物（reported 分数与
   * region_attest）须独立重评；不触发设备重采、不重置真人 confirmed_by 的 verdict；未清 → BLOCKER。
   */
  evaluation_invalidated?: boolean;
  /** t5（1.1）：pixel_1to1 P0 pass 屏 defects=[] 时必填的逐区域举证 */
  region_attest?: RegionAttestEntry[];
  /**
   * t2（1.1）：布局树采集状态（capture 机器盖戳）。
   * t4b（f7a3d9c2，2026-07-11 真机双拍数据回填后启用）：'unstable'=静稳采样重试耗尽仍
   * 图/树不稳（动画/轮播/动效屏）——T8 命中对该屏降档走独立 id（capability degradation）。
   */
  layout_dump_status?: 'captured' | 'failed' | 'unavailable' | 'unstable';
  /** t4b：unstable 时的原因（image_drift|layout_drift|approot_drift|both，capture 机器盖戳） */
  layout_dump_unstable_reason?: string;
  /** jimp 半定量客观下限/哨兵（不参与 PASS 阈值） */
  /** reference_only（P1-C）：像素直方图下限，历史多次实测证伪（UI 全错仍近满分），不参与任何判定 */
  score_floor?: number;
  must_fix?: string[];
  /** 当前 screenshot_path 对应 PNG 的 sha256 前缀（16 hex） */
  screenshot_hash?: string;
  /** VL/agent 判定 verdict 时所依据的截图 hash；须与当前文件 hash 一致 */
  evaluated_screenshot_hash?: string;
  /**
   * P0-9a：截图采集时的应用构建指纹（实际 hap sha256 前 12 hex，capture 机器盖戳）。
   * 判定新鲜度键=「绑定截图文件未变 + 本指纹与现算当前构建一致」；build 一变判定自动失效。
   * 已定判定缺本字段 = legacy stale（当前指纹可算时）。
   */
  evaluated_build_fingerprint?: string;
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

/**
 * finalized verdict 是否 stale。
 * P0-9a 改键：①文件级——evaluated_screenshot_hash 须与**盘上绑定截图文件**一致（防换图；
 * 像素恒等对新采图的要求已废除，真机时钟/轮播必漂移属证伪判据）；②构建级——当前构建指纹
 * 可现算时（opts.currentBuildFingerprint 非空），evaluated_build_fingerprint 缺失（legacy）
 * 或与当前不一致 → stale（改码重装必重判）。指纹不可算时退回文件级校验（持久化不启用）。
 */
export function isStaleVisualDiffVerdict(
  screen: VisualDiffScreenEntry,
  projectRoot: string,
  opts?: { currentBuildFingerprint?: string | null },
): boolean {
  if (isCaptureMutableVerdict(screen.verdict) || isMissingEvaluatedScreenshotHash(screen)) return false;
  const shot = screen.screenshot_path;
  if (typeof shot !== 'string' || !shot.trim()) return false;
  const currentHash = hashScreenshotFile(resolveShotPath(projectRoot, shot));
  if (!currentHash) return true;
  if (currentHash !== screen.evaluated_screenshot_hash!.trim()) return true;
  const currentFp = opts?.currentBuildFingerprint?.trim();
  if (currentFp) {
    const fp = screen.evaluated_build_fingerprint?.trim();
    if (!fp || fp !== currentFp) return true;
  }
  return false;
}

/**
 * P0-10c（plan b6d3e9a2）：逐屏"可交由真人确认"资格谓词——checkVisualDiff 的 await 收窄判定
 * 与 visual-confirm CLI 的"待确认屏"筛选**同源**（防 CLI 宽筛把 stale/带 must_fix/绑定不全的
 * 屏签掉）。资格 = pixel_1to1 语境下该屏 verdict=pass、零 must_fix、指纹与当前构建一致、
 * evaluated hash 齐、非 stale（绑定截图文件未变、指纹一致）。currentBuildFp 不可算 → 一律不合格
 * （下轮无法跳采，签了也会被重采清）。confirmed_by 是否已填不在此判据内（由调用侧按用途叠加）。
 */
export function isScreenAwaitConfirmEligible(
  screen: VisualDiffScreenEntry,
  projectRoot: string,
  currentBuildFingerprint: string | null | undefined,
): boolean {
  const fp = typeof currentBuildFingerprint === 'string' ? currentBuildFingerprint.trim() : '';
  if (!fp) return false;
  if (screen.verdict !== 'pass') return false;
  if ((screen.must_fix?.length ?? 0) !== 0) return false;
  // t4③：评估已失效的屏不是干净的待签候选——critic 重评清标记后才可交真人
  if (screen.evaluation_invalidated === true) return false;
  if (screen.evaluated_build_fingerprint?.trim() !== fp) return false;
  if (isMissingEvaluatedScreenshotHash(screen)) return false;
  if (isStaleVisualDiffVerdict(screen, projectRoot, { currentBuildFingerprint: fp })) return false;
  return true;
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
      // t4（schema 1.1）：reported_* 零 gate 权重、不再强制 pass/warn 必填数字；
      // legacy 1.0 字段（fidelity_score/geometric_iou）读入即映射 reported_*（M1 对 legacy 文件照常判）。
      if (row.reported_fidelity_score === undefined && typeof row.fidelity_score === 'number') {
        row.reported_fidelity_score = row.fidelity_score;
      }
      if (row.reported_geometric_iou === undefined && typeof row.geometric_iou === 'number') {
        row.reported_geometric_iou = row.geometric_iou;
      }
      for (const [fieldName, v] of [
        ['reported_fidelity_score', row.reported_fidelity_score],
        ['reported_geometric_iou', row.reported_geometric_iou],
      ] as const) {
        if (v !== undefined && v !== null) {
          if (typeof v !== 'number' || Number.isNaN(v) || v < 0 || v > 1) {
            errors.push(`screens[${i}].${fieldName} 须在 [0,1]，收到 ${String(v)}`);
          }
        }
      }
      if (row.evaluation_invalidated !== undefined && typeof row.evaluation_invalidated !== 'boolean') {
        errors.push(`screens[${i}].evaluation_invalidated 须为布尔`);
      }
      const lds = row.layout_dump_status;
      if (
        lds !== undefined && lds !== null &&
        lds !== 'captured' && lds !== 'failed' && lds !== 'unavailable' && lds !== 'unstable'
      ) {
        errors.push(`screens[${i}].layout_dump_status 非法：${String(lds)}`);
      }
      if (
        row.layout_dump_unstable_reason !== undefined &&
        row.layout_dump_unstable_reason !== null &&
        typeof row.layout_dump_unstable_reason !== 'string'
      ) {
        errors.push(`screens[${i}].layout_dump_unstable_reason 须为字符串`);
      }
      // t5：region_attest 结构校验
      const attest = row.region_attest;
      if (attest !== undefined && attest !== null) {
        if (!Array.isArray(attest)) {
          errors.push(`screens[${i}].region_attest 须为数组`);
        } else {
          for (const [j, a] of attest.entries()) {
            if (!a || typeof a !== 'object') {
              errors.push(`screens[${i}].region_attest[${j}] 须为 object`);
              continue;
            }
            const aa = a as Record<string, unknown>;
            if (typeof aa.region !== 'string' || !aa.region.trim()) {
              errors.push(`screens[${i}].region_attest[${j}].region 必填`);
            }
            if (aa.verdict !== 'no_diff' && aa.verdict !== 'diff_logged') {
              errors.push(`screens[${i}].region_attest[${j}].verdict 非法：${String(aa.verdict)}`);
            }
            if (aa.method !== 'paired_crop_compare' && aa.method !== 'vl_screening' && aa.method !== 'human') {
              errors.push(`screens[${i}].region_attest[${j}].method 非法：${String(aa.method)}`);
            }
            if (aa.method === 'paired_crop_compare') {
              if (typeof aa.evidence !== 'string' || !aa.evidence.trim()) {
                errors.push(`screens[${i}].region_attest[${j}] method=paired_crop_compare 时 evidence 必填（_attest/ crop 路径）`);
              }
              // rev8：绑定字段必填——"文件存在且新鲜"不等于"确实是这张参考图与这张真机图的对应区域"
              for (const f of ['evidence_hash', 'source_screenshot_hash', 'source_ref_hash'] as const) {
                if (typeof aa[f] !== 'string' || !(aa[f] as string).trim()) {
                  errors.push(`screens[${i}].region_attest[${j}] method=paired_crop_compare 时 ${f} 必填（内容绑定，rev8）`);
                }
              }
              const sb = aa.source_bbox;
              if (!Array.isArray(sb) || sb.length !== 4 || !sb.every(n => typeof n === 'number' && n >= 0 && n <= 1)) {
                errors.push(`screens[${i}].region_attest[${j}] method=paired_crop_compare 时 source_bbox 须为 4 个 [0,1] 数`);
              }
            }
          }
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
            // t0（f7a3d9c2）：转录溯源与 must_fix 锚点——可选字段，形状校验（legacy 兼容）
            if (dd.source !== undefined && dd.source !== null) {
              const src = dd.source as Record<string, unknown>;
              if (
                typeof src !== 'object' ||
                src.producer !== 'T8' ||
                typeof src.finding_id !== 'string' || !src.finding_id.trim() ||
                typeof src.signal !== 'string' || !src.signal.trim()
              ) {
                errors.push(`screens[${i}].defects[${j}].source 须为 {producer:'T8', finding_id, signal}`);
              }
            }
            if (dd.must_fix_refs !== undefined && dd.must_fix_refs !== null) {
              const refs = dd.must_fix_refs;
              const mfLen = Array.isArray(row.must_fix) ? row.must_fix.length : 0;
              if (
                !Array.isArray(refs) ||
                !refs.every(n => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < mfLen)
              ) {
                errors.push(`screens[${i}].defects[${j}].must_fix_refs 须为该屏 must_fix 合法下标数组（0..${Math.max(0, mfLen - 1)}）`);
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
      const buildFp = row.evaluated_build_fingerprint;
      if (buildFp !== undefined && buildFp !== null && typeof buildFp !== 'string') {
        errors.push(`screens[${i}] evaluated_build_fingerprint 须为字符串（capture 机器盖戳）`);
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

/** 两归一化矩形 [x,y,w,h] 是否相交（t0 起导出：transcription audit 复用） */
export function normRectsOverlap(a: number[], b: number[]): boolean {
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

/**
 * t9（rev7）：稳定缺陷指纹 `screen_id|class|element/region|bbox_bucket[|producer#finding_id]`
 * ——no-progress 熔断的机器判据（禁自然语言比对，同义改写会逃逸）。bbox 按 0.1 网格分桶
 * 吸收像素抖动。check 会把当轮指纹集打进 details（[fingerprints] 注记）——连续两轮输出
 * 逐字相同即 no-progress，goal 重试比对与交互态 critic 熔断共用此判据。
 *
 * review-fix 轮4（codex P1）：T8 转录 defect 追加 `source.producer#finding_id` 尾段——
 * class/element/0.1 桶是粗粒度（多个 T8 signal 映射同 class，如 B 类全归 shape_mismatch），
 * 已转录 finding 的身份若只剩这三元组，"修掉 A、冒出同元素同桶的 B"会撞同指纹误熔断
 * （FAIL/WARN 转录发现同险，此处统一覆盖）。finding_id=hash(screen|signal|elements|桶)
 * 天然区分 signal/元素集。legacy 无 source 的 defect（VL 自报）保持旧四元组不变；
 * 新旧格式跨轮比较必不相等 → 熔断推迟一轮，错向安全侧，账本无需迁移。
 */
export function computeDefectFingerprint(screenId: string, d: VisualDiffDefect): string {
  const bucket = Array.isArray(d.bbox) && d.bbox.length === 4
    ? d.bbox.map(n => (Math.round(n * 10) / 10).toFixed(1)).join(',')
    : 'nobbox';
  const src = d.source?.finding_id?.trim() ? `|${d.source.producer}#${d.source.finding_id.trim()}` : '';
  return `${screenId}|${d.class}|${d.element?.trim() || 'unknown'}|${bucket}${src}`;
}

export function collectDefectFingerprints(screens: VisualDiffScreenEntry[]): string[] {
  const out = new Set<string>();
  for (const s of screens) {
    for (const d of s.defects ?? []) out.add(computeDefectFingerprint(s.screen_id, d));
  }
  return [...out].sort();
}

/**
 * rev9/rev10（codex：计数式入纹会把"两组完全不同、恰好同数"的问题误判成无进展 → 错误熔断；
 * rev10 追打：must_fix 2 条+defects 1 条的"部分转录"轮同样漏纹）：
 * 轮次是否有资格参与稳定指纹比较——任一屏 must_fix 条数**多于**结构化 defects 条数
 * （存在未转录余量）→ 无资格。这是**必要条件近似**，错向安全侧：宁可判无资格推迟熔断
 * （退回预算兜底），绝不让漏纹轮次误熔断；"每条 must_fix 确有对应 defect"的完整对账
 * 归 f7a3d9c2 t2 transcription audit（或 must_fix↔defect 关联 id），本函数不冒称。
 */
export function isRoundFingerprintable(screens: VisualDiffScreenEntry[]): boolean {
  return !screens.some(s => (s.must_fix?.length ?? 0) > (s.defects?.length ?? 0));
}

export function fingerprintSetsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

// ---------------------------------------------------------------------------
// t0/t1/t2（plan f7a3d9c2）：转录对账与轮次账本的纯函数层
// ---------------------------------------------------------------------------

/** 两归一化矩形 [x,y,w,h] 的 IoU（t2：bbox legacy 对账收紧为 IoU≥0.5，防大框误消账） */
export function normRectIoU(a: number[], b: number[]): number {
  if (a.length !== 4 || b.length !== 4) return 0;
  const ix = Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
  const inter = ix * iy;
  const union = a[2] * a[3] + b[2] * b[3] - inter;
  return union > 0 ? inter / union : 0;
}

/** t2：bbox legacy 回退对账的最小 IoU */
export const TRANSCRIPTION_BBOX_IOU_MIN = 0.5;

/** t2：T8 signal → 转录 defect 允许的 class 集（elements 次判据的语义类一致性约束） */
export function signalExpectedClasses(signal: string): Set<VisualDiffDefectClass> {
  if (signal.startsWith('A2')) return new Set<VisualDiffDefectClass>(['clipping', 'overlap', 'other']);
  if (signal.startsWith('A')) return new Set<VisualDiffDefectClass>(['overlap', 'other']);
  return new Set<VisualDiffDefectClass>(['shape_mismatch', 'missing_render', 'other']);
}

/** t2：未转录 hard 发现的模板 defect class 推荐值 */
export function defaultClassForSignal(signal: string): VisualDiffDefectClass {
  if (signal.startsWith('A2')) return 'clipping';
  if (signal.startsWith('A')) return 'overlap';
  return 'shape_mismatch';
}

/**
 * t1（rev5）：loop-actionable 视觉残差 hit id 白名单（结构化谓词，非 visual_diff_ 前缀猜测）。
 * 排除（各归各的路径，不入 UI defect fuse）：human_confirm_required（T2 求人）、
 * layout_invariants_unstable（capability degradation，t4）、*_degraded/layout_dump_missing
 * （能力降级）、critic_receipt/attest_evidence/**region_attest**（evidence repair——
 * review-fix cursor I-2：纯举证缺口是评审义务不是 UI 缺陷，补 attest 不是 coding 回修，
 * 不得据此熔断）、schema（结构问题）、tamper_artifact（红线，另有人工复核路径）、
 * edge_sentinel/text_placement_must_fix（advisory）。
 */
export const LOOP_ACTIONABLE_HIT_IDS: ReadonlySet<string> = new Set([
  'visual_diff',
  'visual_diff_layout_invariants',
  'visual_diff_out_of_bounds_element',
  'visual_diff_text_missing',
  'visual_diff_text_placement',
  'visual_diff_verdict_abandonment',
  'visual_diff_warn_no_actionable',
  'visual_diff_reverse_enum',
  'visual_diff_defects_enum',
  'visual_diff_bidirectional_residual',
  'visual_diff_reverse_missing',
  'visual_diff_screenshot_dedup',
  'visual_diff_selfreport_integrity',
  'visual_diff_evaluation_invalidated',
  'visual_diff_finding_transcription',
]);

/**
 * t1（rev5）：has_actionable_visual_residual——本轮是否存在真正要求进入 coding/critic
 * 下一轮的残差。裁决优先级由调用方保证（仅 awaitHumanOnly=false 才计算 fuse）。
 */
export function hasActionableVisualResidual(
  screens: VisualDiffScreenEntry[],
  hits: Array<{ id: string; status: 'FAIL' | 'WARN' }>,
): boolean {
  if (screens.some(s => s.verdict === 'fail' || (s.must_fix?.length ?? 0) > 0)) return true;
  if (hits.some(h => h.status === 'FAIL' && LOOP_ACTIONABLE_HIT_IDS.has(h.id))) return true;
  // 未解决 T8/M1 blocking WARN 亦属 loop-actionable（与 candidate-pass 阻断口径一致）
  return hits.some(
    h => h.status === 'WARN' && (h.id === 'visual_diff_layout_invariants' || h.id === 'visual_diff_selfreport_integrity'),
  );
}

/** t1：screens_hash——全屏 (screen_id, 绑定截图 hash) 集合的稳定 hash（状态身份分量） */
export function computeScreensHash(screens: VisualDiffScreenEntry[]): string {
  const parts = screens
    .map(s => `${s.screen_id}:${s.evaluated_screenshot_hash?.trim() || s.screenshot_hash?.trim() || ''}`)
    .sort();
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 16);
}

/** t0③：check → runner 的进程内结构化 payload（不进 summary.json，持久化走账本侧车） */
export interface VisualDiffStructuredPayload {
  kind: 'visual_diff';
  loop_id: string;
  attempt_id: string | null;
  goal_run_id: string | null;
  build_fingerprint: string | null;
  screens_hash: string;
  defect_fingerprints: string[];
  fingerprintable: boolean;
  /** 计算 fuse 之前的 base FAIL hit id 集（排除 fuse 自身——feedback 环防护） */
  source_fail_hit_ids: string[];
  /** 未处置 actionable WARN 身份（candidate-blocking WARN hit id + 未转录 warn finding_id） */
  source_warn_ids: string[];
  await_human_only: boolean;
  actionable_residual: boolean;
  /** 轮次账本评估（disposition/decision/row）；账本评估失败时缺省 */
  round?: VisualRoundEvaluation;
  /** unstable 屏的 T8 命中（capability degradation——per-screen snapshot 消费，不入指纹/对账） */
  t8_unstable_findings?: Array<{
    screen_id: string;
    finding_id: string;
    signal: string;
    tier: string;
    elements: string[];
    bbox?: number[];
  }>;
  t8_findings: Array<{
    screen_id: string;
    finding_id: string;
    signal: string;
    tier: string;
    elements: string[];
    bbox?: number[];
  }>;
}

/**
 * M1（t4②，plan c6d8f2b4）：自报退化模式收集——纯函数供 check 消费与单测直打
 * （bc-openCard 反例靶：8 屏 iou 恒 0.95、7/8 屏 fidelity 逐位抄 score_floor）。
 * 定位=异常检测，非诚实性证明。
 */
export function collectSelfreportDegeneracy(screens: VisualDiffScreenEntry[]): {
  constantGroups: string[];
  copyFloor: VisualDiffScreenEntry[];
  grazing: VisualDiffScreenEntry[];
} {
  const finalized = screens.filter(s => !isCaptureMutableVerdict(s.verdict));
  const constantGroups: string[] = [];
  for (const [field, label] of [
    ['reported_geometric_iou', 'geometric_iou'],
    ['reported_fidelity_score', 'fidelity_score'],
  ] as const) {
    const byValue = new Map<number, string[]>();
    for (const s of finalized) {
      const v = s[field];
      if (typeof v !== 'number') continue;
      const list = byValue.get(v) ?? [];
      list.push(s.screen_id);
      byValue.set(v, list);
    }
    for (const [v, ids] of byValue) {
      if (ids.length >= SELFREPORT_CONSTANT_MIN_SCREENS) {
        constantGroups.push(`${label}=${v} 恒等于 ${ids.length} 屏（${ids.slice(0, 6).join(',')}${ids.length > 6 ? '…' : ''}）`);
      }
    }
  }
  const copyFloor = finalized.filter(
    s =>
      typeof s.reported_fidelity_score === 'number' &&
      typeof s.score_floor === 'number' &&
      Object.is(s.reported_fidelity_score, s.score_floor),
  );
  const grazing = screens.filter(
    s =>
      s.verdict === 'pass' &&
      typeof s.reported_fidelity_score === 'number' &&
      typeof s.score_floor === 'number' &&
      !Object.is(s.reported_fidelity_score, s.score_floor) &&
      Math.abs(s.reported_fidelity_score - s.score_floor) < SELFREPORT_GRAZE_EPSILON &&
      (s.defects?.length ?? 0) === 0,
  );
  return { constantGroups, copyFloor, grazing };
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
/** 入口：core 判定 + blind-visual-hardening d2/d3 附加面（渲染可见性 calibrate + 三段闭环运行时段） */
export function checkVisualDiff(ctx: CheckContext): CheckResult[] {
  const results = checkVisualDiffCore(ctx);
  // P0-B④ calibrate：采集物（shot-*/layout-*）在即评，自守卫（无目录/无配对→零结果）；
  // WARN 观察不阻断，findings 供视觉债务与 enforce 校准消费。
  results.push(...safeCalibrate(ctx));
  // P0-C③ 运行时段：声明语义容器的锚点须出现在 layout dump（dump 缺失自跳过）。
  // 异常=BLOCKER（codex 三轮 P1-3：地板门禁不得因异常降 SKIP 绕过）。
  try {
    results.push(...checkUiKitRuntimeConformance(ctx));
  } catch (e) {
    results.push({
      id: 'ui_kit_runtime_conformance', category: 'structure',
      description: 'UI kit 三段闭环·运行时段执行异常（地板门禁不得因异常绕过）',
      severity: 'BLOCKER', status: 'FAIL',
      details: `执行异常：${(e as Error).message}\n${(e as Error).stack ?? ''}`,
      suggestion: '框架/环境问题——修复后重跑；不要通过删除 block 声明来绕过本门禁。',
      failure_kind: 'framework_bug',
      blocking_class: 'ui_kit_conformance',
    });
  }
  // S7（visual-capability-truth P2-J.1）：结构保真运行时挂载轴——uitree 证据面（拆轴：
  // 静态声明轴照旧；无 dump 自 SKIP 不装死）。
  try {
    results.push(...checkRuntimeMountConformance(ctx));
  } catch (e) {
    results.push({
      id: 'runtime_mount_conformance', category: 'structure',
      description: '运行时挂载轴执行异常',
      severity: 'MAJOR', status: 'WARN',
      details: `执行异常：${(e as Error).message}`,
    });
  }
  // P1-E：盲档确定性反馈（deterministic_feedback 机器派生，非 agent 开关；自守卫）。
  try {
    results.push(...checkVisualFeedback(ctx));
  } catch (e) {
    results.push({
      id: 'visual_feedback', category: 'structure',
      description: '确定性视觉反馈执行异常',
      severity: 'MINOR', status: 'SKIP',
      details: `执行异常：${(e as Error).message}`,
    });
  }
  return results;
}

function safeCalibrate(ctx: CheckContext): CheckResult[] {
  try {
    return checkRenderVisibilityCalibrate(ctx);
  } catch (e) {
    return [{
      id: 'render_visibility_calibrate',
      category: 'structure',
      description: '设备渲染可见性（calibrate）执行异常',
      severity: 'MINOR',
      status: 'SKIP',
      details: `calibrate 执行异常（观察节点不阻断）：${(e as Error).message}`,
    }];
  }
}

function checkVisualDiffCore(ctx: CheckContext): CheckResult[] {
  const desc = ruleDesc(ctx);
  const reportRel = relFeatureArtifact(ctx.projectRoot, ctx.feature, 'visual-diff.md');
  // P0-9 顺手项：走 featureDir 尊重 paths.features_dir 配置
  const reportDir = path.join(featureDir(ctx.projectRoot, ctx.feature), 'device-testing', 'device-screenshots');

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

  const mdPath = path.join(featureDir(ctx.projectRoot, ctx.feature), 'device-testing', 'visual-diff.md');
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

  // --- pass 屏不得登记 blocker/major 渲染缺陷（裁切/重叠/形态/缺渲染）---
  const blockingDefectPass = passScreens.filter(s =>
    (s.defects ?? []).some(d => d.severity === 'blocker' || d.severity === 'major'),
  );

  const scoreFloorSentinel = rep.screens.filter(s => {
    if (typeof s.score_floor !== 'number' || typeof s.reported_fidelity_score !== 'number') return false;
    return s.reported_fidelity_score - s.score_floor >= SCORE_FLOOR_SENTINEL_GAP;
  });

  const reverseMissingAll = rep.screens.flatMap(s => s.reverse_missing ?? []);

  const missingEvalHashScreens = rep.screens.filter(s => isMissingEvaluatedScreenshotHash(s));
  // P0-9a：当前构建指纹现算自实际安装 hap（不可算=null → 指纹校验不启用，退回文件级）。
  const currentBuildFp = resolveCurrentBuildFingerprint(ctx.projectRoot, ctx.feature, ctx.phase);
  const staleScreens = rep.screens.filter(s =>
    isStaleVisualDiffVerdict(s, ctx.projectRoot, { currentBuildFingerprint: currentBuildFp }),
  );

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

  // P0-7③：伪签物证扫描——testing/device-testing 目录出现"改判脚本"（引用 visual-diff.json 且
  // 命中填 pass/填 confirmed_by/清 must_fix/伪造 hash 特征）→ BLOCKER 物证上桌。
  // 2026-07-05 实锤：auto-fill/fill-pass/reset 三脚本成套伪签流水线。
  const tamperArtifacts = collectVisualDiffTamperArtifacts(
    ctx.projectRoot,
    ctx.feature,
    featuresDirPath(ctx.projectRoot),
  );
  if (tamperArtifacts.length > 0) {
    pushVisualDiffHit(hits, {
      id: 'visual_diff_tamper_artifact',
      severity: 'BLOCKER',
      status: 'FAIL',
      line:
        `检出视觉判定改判脚本物证（程序化伪造/销毁 visual-diff.json 判定，属证据篡改）：` +
        tamperArtifacts.map(a => `${a.file}［${a.signatures.join('、')}］`).join('; ') +
        `——判定只能由 capture/真人逐屏产生；删除脚本并还原判定后重跑，行为已违反框架红线（须人工复核）。`,
    });
  }

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

  // t4：分数地板（PASS_MIN/FINALIZED_MIN）不再消费自报值——bc-openCard 实证自报退化成填表，
  // 吃自报的地板=假保障。真算几何值可得时再启用（未来接布局树度量）；当前 SKIP+注记。
  if (rep.screens.some(s => typeof s.reported_fidelity_score === 'number' || typeof s.reported_geometric_iou === 'number')) {
    referenceNotes.push(
      `[skipped] 分数地板未启用：reported_fidelity_score/reported_geometric_iou 为 VL 参考自评、零 gate 权重` +
      `（阈值 ${PASS_MIN_FIDELITY}/${PASS_MIN_IOU}/${FINALIZED_MIN_FIDELITY}/${FINALIZED_MIN_IOU} 保留待真算几何值接入）；` +
      `pass 的举证责任=region_attest+defects 枚举+确定性信号，非分数`,
    );
  }

  // M1（t4②）：自报退化模式元检测——异常拦截，非诚实性证明（换随机数可绕过；真举证在 attest/回执）。
  {
    const { constantGroups, copyFloor, grazing } = collectSelfreportDegeneracy(rep.screens);
    if (constantGroups.length > 0 || copyFloor.length >= SELFREPORT_COPYFLOOR_MIN_SCREENS) {
      const ratchet = pixel1to1
        ? fidelityRatchetFailOrWarn(ctx, false)
        : { severity: 'MAJOR' as const, status: 'WARN' as const };
      pushVisualDiffHit(hits, {
        id: 'visual_diff_selfreport_integrity',
        severity: ratchet.severity,
        status: ratchet.status,
        line:
          `【M1 自报退化】评审产物疑似填表而非逐屏独立评审：` +
          [
            ...constantGroups.map(g => `跨屏常数——${g}`),
            copyFloor.length >= SELFREPORT_COPYFLOOR_MIN_SCREENS
              ? `抄 floor——${copyFloor.length} 屏 reported_fidelity_score 与脚本 score_floor 浮点逐位相同（${copyFloor.map(s => s.screen_id).slice(0, 6).join(',')}）`
              : '',
          ].filter(Boolean).join('；') +
          `——处置：命中屏写 evaluation_invalidated:true，由独立 critic 逐屏重评（重填 reported_*/region_attest）后清标记；` +
          `真人 confirmed_by 的 pass 表态不作废、不触发设备重采（评估/采集双新鲜度解耦）`,
      });
    }
    if (grazing.length > 0) {
      pushVisualDiffHit(hits, {
        id: 'visual_diff_selfreport_integrity',
        severity: 'MAJOR',
        status: 'WARN',
        line:
          `【M1 压线提示】pass 屏 reported_fidelity_score 与 score_floor 压线（|Δ|<${SELFREPORT_GRAZE_EPSILON}）且 defects=[]，` +
          `疑似参照 floor 填数：${grazing.map(s => s.screen_id).join(', ')}——须独立依据（region_attest）支撑`,
      });
    }
  }

  // t4③：evaluation_invalidated 未清 → 阻断（评估新鲜度失效；不触发重采、不作废真人签字）
  const invalidatedScreens = rep.screens.filter(s => s.evaluation_invalidated === true);
  if (invalidatedScreens.length > 0) {
    const ratchet = pixel1to1
      ? fidelityRatchetFailOrWarn(ctx, false)
      : { severity: 'MAJOR' as const, status: 'WARN' as const };
    pushVisualDiffHit(hits, {
      id: 'visual_diff_evaluation_invalidated',
      severity: ratchet.severity,
      status: ratchet.status,
      line:
        `评估已失效待重判（evaluation_invalidated=true）：${invalidatedScreens.map(s => s.screen_id).join(', ')}` +
        `——独立 critic 重评（重填 reported_*/region_attest）后移除该标记；真人已签屏保留 verdict/confirmed_by，` +
        `未签屏须整体重判；本标记不触发设备重采（P0-9a 采集持久化不受影响）`,
    });
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
  // P0-6：user_requirement 亦不算——它是需求级授权哨兵，不能替代对具体屏的真人过目
  // （2026-07-05 实锤：agent 以它伪签 T2 并在自跑 harness 中通关过一次）。
  if (pixel1to1) {
    const p0Set = new Set(p0Ids);
    const unconfirmed = passScreens.filter(s => p0Set.has(s.screen_id) && !isHumanVerified(s.confirmed_by));
    if (unconfirmed.length > 0) {
      const ratchet = fidelityRatchetFailOrWarn(ctx, false);
      pushVisualDiffHit(hits, {
        id: 'visual_diff_human_confirm_required',
        severity: ratchet.severity,
        status: ratchet.status,
        line:
          `pixel_1to1 P0 屏判 pass 须真人确认（confirmed_by 非自动化身份且非 user_requirement——` +
          `后者属需求级授权，不能替代对具体屏的真人过目）——客观度量无法判图标/颜色/样式，须人兜底：` +
          unconfirmed.map(s => `${s.screen_id}${s.confirmed_by ? `(confirmed_by=${s.confirmed_by} 属自动化/授权哨兵，无效)` : '(缺 confirmed_by)'}`).join(', ') +
          `；headless 走 HALT 求人，交互态当场确认后置 confirmed_by 重判。`,
      });
    }
  }

  // t5：pixel_1to1 P0 pass 屏 defects=[] 须附 region_attest——pass 的举证责任=逐区域对照声明，
  // 不是"没看见问题"（与 D11 缺枚举同级）。rev7（codex/cursor 同点）：非空不够，须**逐区域覆盖**
  // ——一条任意 {region:"root"} 不能替代全部 must_have_elements；diff_logged 须能关联 defect/must_fix。
  if (pixel1to1 && uiDoc) {
    const p0Set = new Set(p0Ids.map(canonicalOverlayBase));
    const uiById = new Map((uiDoc.screens ?? []).map(s => [s.id, s] as const));
    const attestP0Pass = passScreens.filter(
      s => p0Set.has(canonicalOverlayBase(s.screen_id)) && Array.isArray(s.defects) && s.defects.length === 0,
    );
    const bareEmptyDefects = attestP0Pass.filter(s => (s.region_attest?.length ?? 0) === 0);
    if (bareEmptyDefects.length > 0) {
      const ratchet = fidelityRatchetFailOrWarn(ctx, false);
      pushVisualDiffHit(hits, {
        id: 'visual_diff_region_attest',
        severity: ratchet.severity,
        status: ratchet.status,
        line:
          `pixel_1to1 P0 pass 屏 defects=[] 却无 region_attest（空数组免检已收紧，t5）：` +
          bareEmptyDefects.map(s => s.screen_id).join(', ') +
          `——逐 must_have_elements/zone 填 {region, verdict: no_diff|diff_logged, method, evidence?, by}`,
      });
    }
    const coverageMisses: string[] = [];
    const orphanDiffLogged: string[] = [];
    for (const s of attestP0Pass) {
      const attest = s.region_attest ?? [];
      if (attest.length === 0) continue;
      const regions = new Set(attest.map(a => a.region));
      const uiScreen = uiById.get(canonicalOverlayBase(s.screen_id)) ?? uiById.get(s.screen_id);
      const expected = uiScreen?.must_have_elements ?? [];
      const missing = expected.filter(e => !regions.has(e));
      if (missing.length > 0) {
        coverageMisses.push(`${s.screen_id}（缺 ${missing.slice(0, 6).join('/')}${missing.length > 6 ? '…' : ''}）`);
      }
      // diff_logged 是"发现差异"的举证——须能落到 defects/must_fix，否则=知情不报
      for (const a of attest) {
        if (a.verdict !== 'diff_logged') continue;
        const inDefects = (s.defects ?? []).some(d => d.element === a.region || (d.note ?? '').includes(a.region));
        const inMustFix = (s.must_fix ?? []).some(m => m.includes(a.region));
        if (!inDefects && !inMustFix) orphanDiffLogged.push(`${s.screen_id}/${a.region}`);
      }
    }
    if (coverageMisses.length > 0) {
      const ratchet = fidelityRatchetFailOrWarn(ctx, false);
      pushVisualDiffHit(hits, {
        id: 'visual_diff_region_attest',
        severity: ratchet.severity,
        status: ratchet.status,
        line:
          `region_attest 未覆盖屏级 must_have_elements（一条泛化 region 不能替代逐区域举证，rev7）：` +
          coverageMisses.join('; '),
      });
    }
    if (orphanDiffLogged.length > 0) {
      const ratchet = fidelityRatchetFailOrWarn(ctx, false);
      pushVisualDiffHit(hits, {
        id: 'visual_diff_region_attest',
        severity: ratchet.severity,
        status: ratchet.status,
        line:
          `region_attest verdict=diff_logged 却无对应 defect/must_fix（发现差异必须落账）：` +
          orphanDiffLogged.join(', '),
      });
    }
  }

  // t7：attest 证据物证 + critic 回执校验（可证边界=素材物化+调用记录，非模型认知）。
  // rev7 收紧（codex P1×2）：①回执在**任何** region_attest 存在时必需（vl_screening-only 也是
  // critic 调用，无回执=无调用记录——OpenSpec 两档 candidate-pass 均要求结构合法回执）；
  // ②evidence 限定本 feature 的 _attest/ 目录且 mtime 不早于被评截图；③image_inputs[].hash
  // 提供即重算比对，provenance=verified 时 hash 必填（verified 主张更强证明，须配更强证据）。
  let receiptProvenance: 'verified' | 'unverified' | null = null;
  {
    const attestScreens = rep.screens.filter(s => (s.region_attest?.length ?? 0) > 0);
    const pairedEntries: Array<{ screen: VisualDiffScreenEntry; attest: RegionAttestEntry }> = [];
    for (const s of attestScreens) {
      for (const a of s.region_attest ?? []) {
        if (a.method === 'paired_crop_compare') pairedEntries.push({ screen: s, attest: a });
      }
    }
    const attestDirAbs = path.resolve(reportDir, '_attest') + path.sep;
    // rev9：source_ref_hash 验真——参考图可解析时重算比对（绑定"这张参考图"）；
    // 不可解析时仅存声明（诚实边界：source_bbox 为声明性定位元数据，"crop 确为该区域"
    // 的像素级复核归 critic/人审，确定性侧不做图像重裁比对——像素处理超出零阈值承诺）。
    const refIndexForAttest = pairedEntries.length > 0 && specMd ? buildAuthoritativeRefImageIndex(ctx, specMd) : null;
    const uiScreensForAttest = new Map((uiDoc?.screens ?? []).map(s => [s.id, s] as const));
    const evidenceIssues: string[] = [];
    for (const e of pairedEntries) {
      const raw = e.attest.evidence?.trim();
      if (!raw) {
        evidenceIssues.push(`${e.screen.screen_id}/${e.attest.region}（evidence 空）`);
        continue;
      }
      const abs = resolveShotPath(ctx.projectRoot, raw);
      if (!fs.existsSync(abs)) {
        evidenceIssues.push(`${e.screen.screen_id}/${e.attest.region}（${raw} 不存在）`);
        continue;
      }
      if (!path.resolve(abs).startsWith(attestDirAbs)) {
        evidenceIssues.push(`${e.screen.screen_id}/${e.attest.region}（证据须在本 feature device-screenshots/_attest/ 下，收到 ${raw}——外部文件不作数）`);
        continue;
      }
      // mtime：对照 crop 不得早于被评截图（陈旧证据=拿旧图充数）
      const shotRel = e.screen.screenshot_path;
      if (typeof shotRel === 'string' && shotRel.trim()) {
        const shotAbs = resolveShotPath(ctx.projectRoot, shotRel);
        try {
          if (fs.existsSync(shotAbs) && fs.statSync(abs).mtimeMs < fs.statSync(shotAbs).mtimeMs) {
            evidenceIssues.push(`${e.screen.screen_id}/${e.attest.region}（crop 早于被评截图，陈旧证据须重裁）`);
          }
        } catch { /* stat 失败不阻断，存在性已验 */ }
      }
      // rev8 内容绑定验真：任意图片拷进 _attest/ 刷 mtime 不再作数
      const declaredEvidenceHash = e.attest.evidence_hash?.trim();
      if (declaredEvidenceHash) {
        const actual = hashScreenshotFile(abs);
        if (actual !== declaredEvidenceHash) {
          evidenceIssues.push(`${e.screen.screen_id}/${e.attest.region}（evidence_hash 不符：声明 ${declaredEvidenceHash.slice(0, 8)}… 实际 ${actual ? actual.slice(0, 8) + '…' : '不可读'}）`);
        }
      }
      const declaredShotHash = e.attest.source_screenshot_hash?.trim();
      if (declaredShotHash && e.screen.evaluated_screenshot_hash?.trim() && declaredShotHash !== e.screen.evaluated_screenshot_hash.trim()) {
        evidenceIssues.push(`${e.screen.screen_id}/${e.attest.region}（source_screenshot_hash 与该屏 evaluated_screenshot_hash 不符——crop 不是从本轮被评截图裁出）`);
      }
      // rev9：ref hash 重算——任意字符串充数不再作数（可解析时）
      const declaredRefHash = e.attest.source_ref_hash?.trim();
      if (declaredRefHash && refIndexForAttest) {
        const base = canonicalOverlayBase(e.screen.screen_id);
        const uiScreen = uiScreensForAttest.get(e.screen.screen_id) ?? uiScreensForAttest.get(base);
        const refId = uiScreen?.ref_id ?? e.screen.ref_id ?? base;
        const refAbs = resolveRefSourceImage(refIndexForAttest, refId).path;
        if (refAbs && fs.existsSync(refAbs)) {
          const actualRef = hashScreenshotFile(refAbs);
          if (actualRef && actualRef !== declaredRefHash) {
            evidenceIssues.push(`${e.screen.screen_id}/${e.attest.region}（source_ref_hash 不符：声明 ${declaredRefHash.slice(0, 8)}… 参考图实际 ${actualRef.slice(0, 8)}…——crop 不是从当前参考图裁出）`);
          }
        }
      }
    }
    if (evidenceIssues.length > 0) {
      const ratchet = pixel1to1
        ? fidelityRatchetFailOrWarn(ctx, false)
        : { severity: 'MAJOR' as const, status: 'WARN' as const };
      pushVisualDiffHit(hits, {
        id: 'visual_diff_attest_evidence',
        severity: ratchet.severity,
        status: ratchet.status,
        line:
          `region_attest paired_crop_compare 证据无效：${evidenceIssues.join('; ')}` +
          `——须先物化 _attest/<screen>_<region>.png 并排对照图再声明`,
      });
    }
    // t2③（f7a3d9c2）：candidate 路径活跃=pixel_1to1 且 P0 全覆盖且全部 P0 屏 finalized
    // pass 零 must_fix——此时**无论有无 attest** 均须结构合法回执（堵"每屏塞 minor defect
    // 绕过 attest→绕过回执"的窄缝；OpenSpec："Both candidate-pass tiers require a
    // structurally valid receipt"）。低档位无 candidate 路径，天然零接触（t6b 守恒）。
    const candidateP0Screens = pixel1to1
      ? p0Ids
          .map(id => resolveP0Entry(id))
          .filter((e): e is VisualDiffScreenEntry => Boolean(e))
          .filter(e => e.verdict === 'pass' && (e.must_fix?.length ?? 0) === 0)
      : [];
    const candidatePathActive =
      pixel1to1 &&
      p0Ids.length > 0 &&
      p0Ids.every(id => {
        const e = resolveP0Entry(id);
        return Boolean(e && e.verdict === 'pass' && (e.must_fix?.length ?? 0) === 0);
      });
    if (attestScreens.length > 0 || candidatePathActive) {
      const receiptAbs = path.join(
        featureDir(ctx.projectRoot, ctx.feature),
        'device-testing',
        'reports',
        'critic-receipt.json',
      );
      let receipt: CriticReceipt | null = null;
      let receiptErr = '';
      if (!fs.existsSync(receiptAbs)) {
        receiptErr = 'critic-receipt.json 不存在';
      } else {
        try {
          const raw = JSON.parse(fs.readFileSync(receiptAbs, 'utf-8')) as Record<string, unknown>;
          if (
            typeof raw.critic_run_id !== 'string' || !raw.critic_run_id.trim() ||
            typeof raw.adapter !== 'string' || !raw.adapter.trim() ||
            typeof raw.prompt_hash !== 'string' || !raw.prompt_hash.trim() ||
            (raw.input_provenance !== 'verified' && raw.input_provenance !== 'unverified') ||
            !Array.isArray(raw.image_inputs)
          ) {
            receiptErr = '回执缺必填字段（critic_run_id/adapter/prompt_hash/input_provenance/image_inputs）';
          } else if (
            // rev8：空 image_inputs=声称跑了 critic 却没看任何图——任何档位拒绝（codex 反例实锤）
            raw.image_inputs.length === 0 ||
            !raw.image_inputs.every(i => i && typeof (i as { path?: unknown }).path === 'string' && ((i as { path: string }).path).trim())
          ) {
            receiptErr = 'image_inputs 须非空且逐项含合法 path（空数组/坏条目=无视觉输入的"视觉评审"，拒绝）';
          } else if (raw.input_provenance === 'verified' && (typeof raw.output_hash !== 'string' || !raw.output_hash.trim())) {
            receiptErr = 'provenance=verified 须带 output_hash（更强主张须更强证据，rev8）';
          } else {
            receipt = raw as unknown as CriticReceipt;
          }
        } catch (e) {
          receiptErr = `回执解析失败：${(e as Error).message}`;
        }
      }
      if (receipt) {
        // t3b（f7a3d9c2，接替 rev10 的一律降级）：verified 档唯一合法来源=runner attestation
        // ——重算证据日志 hash 比对：缺段/日志缺失/hash 不符=手写 verified 冒充或日志被改
        // → 降级 unverified + WARN。verified 主张触发的更严校验（逐项 hash/output_hash/覆盖）
        // 照常执行（主张更强 → 查得更严，即便结论被降级）。
        if (receipt.input_provenance === 'verified') {
          const att = receipt.runner_attestation;
          let attErr = '';
          if (
            !att ||
            typeof att.goal_run_id !== 'string' || !att.goal_run_id.trim() ||
            typeof att.evidence_log_path !== 'string' || !att.evidence_log_path.trim() ||
            typeof att.evidence_log_hash !== 'string' || !att.evidence_log_hash.trim()
          ) {
            attErr = '缺 runner_attestation 段（手写 verified 属冒充）';
          } else if (path.basename(att.evidence_log_path) !== 'agent-events.jsonl') {
            // review-fix（codex P1-4）：证据文件只能是纯净结构化事件文件——指向任意现存
            // 文件算 hash 不构成证明
            attErr = `attestation 证据须为 agent-events.jsonl（收到 ${path.basename(att.evidence_log_path)}）`;
          } else if (!process.env.MAISON_GOAL_RUN_ID?.trim() || !process.env.MAISON_GOAL_ATTEMPT?.trim()) {
            // review-fix 轮2（codex P1-2）：verified 仅在 goal gate 语境采信——交互态采信
            // 历史 goal 回执会产出 candidate-pass(verified)，与"交互态 verified 不在本期"
            // 的显式非目标冲突；交互态一律如实 unverified（不否定其曾在 gate 语境的采信）。
            attErr = 'verified 仅在 goal gate 语境采信（当前无 MAISON_GOAL_RUN_ID/ATTEMPT）——交互态如实按 unverified 呈现';
          } else if (att.goal_run_id.trim() !== process.env.MAISON_GOAL_RUN_ID.trim()) {
            attErr = `attestation goal_run_id 与当前 run 不符（${att.goal_run_id} ≠ ${process.env.MAISON_GOAL_RUN_ID}）`;
          } else if (
            // review-fix 轮2：attempt 级精确绑定（startsWith 可被旧 attempt 回执充数）
            receipt.critic_run_id !==
            `${process.env.MAISON_GOAL_RUN_ID.trim()}-${process.env.MAISON_GOAL_ATTEMPT.trim()}`
          ) {
            attErr = `critic_run_id 未精确绑定当前 invocation（${receipt.critic_run_id} ≠ ${process.env.MAISON_GOAL_RUN_ID}-${process.env.MAISON_GOAL_ATTEMPT}）`;
          } else if (
            // review-fix 轮4（codex P2）：子串 includes 不能证明文件在当前 run 目录（父目录/
            // 其他路径片段含 run_id 即可通过）——收紧为**期望全路径精确等值**：回执只在
            // testing 阶段由 runner 签发（goal-runner t3b 分支 phase==='testing'），期望路径
            // 唯一可推导 = <featureDir>/goal-runs/<run_id>/phases/testing/agent-events.jsonl。
            path.resolve(ctx.projectRoot, att.evidence_log_path) !==
            path.resolve(
              featureDir(ctx.projectRoot, ctx.feature),
              'goal-runs',
              process.env.MAISON_GOAL_RUN_ID.trim(),
              'phases',
              'testing',
              'agent-events.jsonl',
            )
          ) {
            attErr = `attestation 证据路径未绑定当前 run 的 testing 阶段目录（${att.evidence_log_path}）`;
          } else {
            const evidenceAbs = path.resolve(ctx.projectRoot, att.evidence_log_path);
            if (!fs.existsSync(evidenceAbs)) {
              attErr = `attestation 证据日志不存在：${att.evidence_log_path}`;
            } else {
              const actual = createHash('sha256').update(fs.readFileSync(evidenceAbs)).digest('hex').slice(0, 16);
              if (actual !== att.evidence_log_hash.trim()) {
                attErr = `attestation 证据日志 hash 不符（声明 ${att.evidence_log_hash.slice(0, 8)}… 实际 ${actual.slice(0, 8)}…——日志被改或回执伪造）`;
              } else {
                // review-fix（codex P1-4）核心：check 侧**复核验读事件**——重解析证据日志，
                // image_inputs 逐项须有对应结构化读取事件。"某文件 hash 未变"不等于
                // "本轮 critic 确实读过这些图"；无解析器的 adapter 无法复核 → 不采信。
                const reads = parseImageReadEventsFor(receipt.adapter, fs.readFileSync(evidenceAbs, 'utf-8'));
                if (reads === null) {
                  attErr = `adapter=${receipt.adapter} 无注册解析器，verified 主张不可复核`;
                } else {
                  const readSet = new Set(reads.map(r => path.resolve(ctx.projectRoot, r)));
                  const unbacked = receipt.image_inputs.filter(
                    i => typeof i?.path === 'string' && !readSet.has(path.resolve(ctx.projectRoot, i.path)),
                  );
                  if (unbacked.length > 0) {
                    attErr = `image_inputs 有 ${unbacked.length} 项在证据日志中无验读事件（回执与日志不符：${unbacked.slice(0, 3).map(i => i.path).join(', ')}…）`;
                  }
                }
              }
            }
          }
          if (attErr) {
            receiptProvenance = 'unverified';
            pushVisualDiffHit(hits, {
              id: 'visual_diff_critic_receipt',
              severity: 'MAJOR',
              status: 'WARN',
              line:
                `verified 主张不采信（${attErr}）：已按 unverified 档呈现；` +
                `verified 只能由 goal-runner 审计结构化验读事件后签发（runner attestation，t3b）`,
            });
          } else {
            receiptProvenance = 'verified';
          }
        } else {
          receiptProvenance = receipt.input_provenance;
        }
        const hashIssues: string[] = [];
        const missingFiles: string[] = [];
        const inputSet = new Set<string>();
        for (const inp of receipt.image_inputs) {
          if (typeof inp?.path !== 'string' || !inp.path.trim()) continue;
          const abs = path.resolve(ctx.projectRoot, inp.path);
          inputSet.add(abs);
          // rev9（codex）：文件存在性两档通用——unverified 只表示"无法证明注入模型"，
          // 不表示"无法证明输入文件存在"；引用不存在的图=凭空回执，任何档位拒绝。
          if (!fs.existsSync(abs)) {
            missingFiles.push(inp.path);
            continue;
          }
          const declaredHash = typeof inp.hash === 'string' ? inp.hash.trim() : '';
          if (declaredHash) {
            const actual = hashScreenshotFile(abs);
            if (actual !== declaredHash) {
              hashIssues.push(`${inp.path}（声明 ${declaredHash.slice(0, 8)}… 实际 ${actual ? actual.slice(0, 8) + '…' : '不可读'}）`);
            }
          } else if (receipt.input_provenance === 'verified') {
            hashIssues.push(`${inp.path}（provenance=verified 须逐项带 hash——更强主张须更强证据）`);
          }
        }
        if (missingFiles.length > 0) {
          const ratchet = pixel1to1
            ? fidelityRatchetFailOrWarn(ctx, false)
            : { severity: 'MAJOR' as const, status: 'WARN' as const };
          pushVisualDiffHit(hits, {
            id: 'visual_diff_critic_receipt',
            severity: ratchet.severity,
            status: ratchet.status,
            line: `critic 回执 image_inputs 引用不存在的文件（rev9，任何档位拒绝）：${missingFiles.slice(0, 5).join('; ')}${missingFiles.length > 5 ? '…' : ''}`,
          });
        }
        if (hashIssues.length > 0) {
          const ratchet = pixel1to1
            ? fidelityRatchetFailOrWarn(ctx, false)
            : { severity: 'MAJOR' as const, status: 'WARN' as const };
          pushVisualDiffHit(hits, {
            id: 'visual_diff_critic_receipt',
            severity: ratchet.severity,
            status: ratchet.status,
            line: `critic 回执 image_inputs hash 验真失败（rev7）：${hashIssues.slice(0, 5).join('; ')}${hashIssues.length > 5 ? '…' : ''}`,
          });
        }
        // rev8/rev9：被评截图覆盖改为**两档通用**——"评审引用了本轮这些屏的图"是回执与
        // 本轮相关性的最低语义，与注入证明无关（verified 额外要求的是 hash+output_hash）。
        // t2③/t3b（f7a3d9c2）：覆盖范围与生产侧最低输入集统一——candidate 路径活跃时
        // 扩到全部 candidate P0 finalized 屏（不只 attest 屏），防无 attest 时范围不明。
        {
          const coverageScreens = candidatePathActive
            ? [...new Map([...attestScreens, ...candidateP0Screens].map(s => [s.screen_id, s])).values()]
            : attestScreens;
          const uncoveredShots = coverageScreens.filter(s => {
            const rel = s.screenshot_path;
            // path.resolve 归一化两侧（Windows 正/反斜杠混用时 Set 直比会假阴）
            return typeof rel === 'string' && rel.trim() && !inputSet.has(path.resolve(resolveShotPath(ctx.projectRoot, rel)));
          });
          if (uncoveredShots.length > 0) {
            const ratchet = pixel1to1
              ? fidelityRatchetFailOrWarn(ctx, false)
              : { severity: 'MAJOR' as const, status: 'WARN' as const };
            pushVisualDiffHit(hits, {
              id: 'visual_diff_critic_receipt',
              severity: ratchet.severity,
              status: ratchet.status,
              line:
                `critic 回执 image_inputs 未覆盖被评截图（与本轮无关的回执不作数，rev9 两档通用）：` +
                uncoveredShots.map(s => s.screen_id).join(', '),
            });
          }
        }
        const uncoveredCrops = pairedEntries.filter(
          e => e.attest.evidence?.trim() && !inputSet.has(path.resolve(resolveShotPath(ctx.projectRoot, e.attest.evidence))),
        );
        if (uncoveredCrops.length > 0) {
          const ratchet = pixel1to1
            ? fidelityRatchetFailOrWarn(ctx, false)
            : { severity: 'MAJOR' as const, status: 'WARN' as const };
          pushVisualDiffHit(hits, {
            id: 'visual_diff_critic_receipt',
            severity: ratchet.severity,
            status: ratchet.status,
            line:
              `critic 回执 image_inputs 未覆盖 attest 证据 crop（声称对照过却无调用记录）：` +
              uncoveredCrops.map(e => `${e.screen.screen_id}/${e.attest.region}`).join(', '),
          });
        }
        referenceNotes.push(
          `[provenance] critic 回执生效档位=${receiptProvenance}` +
          (receipt.input_provenance === 'verified' && receiptProvenance === 'unverified'
            ? '（回执声明 verified 但 runner attestation 未通过，已降级——见 WARN）'
            : receiptProvenance === 'verified'
              ? '（runner attestation 校验通过：证明工具调用发生且输入被注入，不证明模型认知）'
              : '（交互态无法从外部证明图片注入——不宣称"已证明看图"；防线=SSOT 强制写 verdict 前逐屏 Read crop）'),
        );
      } else {
        const ratchet = pixel1to1
          ? fidelityRatchetFailOrWarn(ctx, false)
          : { severity: 'MAJOR' as const, status: 'WARN' as const };
        pushVisualDiffHit(hits, {
          id: 'visual_diff_critic_receipt',
          severity: ratchet.severity,
          status: ratchet.status,
          line:
            `存在 region_attest 但 critic 回执无效（${receiptErr}）——任何档位 candidate-pass 均须结构合法回执（rev7）：` +
            `写 device-testing/reports/critic-receipt.json（critic_run_id/prompt_hash/input_provenance/image_inputs[]）；` +
            `交互态如实标 input_provenance: unverified`,
        });
      }
    }
  }

  // T8（t3）：运行时布局树几何不变量——档位以 docs/operations/layout-oracle-calibration.md 决定表为准。
  // 确定性 hard 命中与 P1-C 同语义：VL pass 不可推翻、禁止弃判。
  // t0（f7a3d9c2）：findings 同时以结构化形态收集（finding_id/elements/bbox），供
  // t2 transcription audit 与结构化 payload 消费——hit line 只是人读投影。
  const t8Findings: Array<{ screen_id: string; finding: LayoutFinding }> = [];
  const t8UnstableFindings: Array<{ screen_id: string; finding: LayoutFinding }> = [];
  if (uiDoc) {
    const uiScreensById = new Map((uiDoc.screens ?? []).map(s => [s.id, s] as const));
    const hardLines: string[] = [];
    const warnLines: string[] = [];
    const unstableLines: string[] = [];
    const dumpMissing: string[] = [];
    const p0Set = new Set(p0Ids.map(canonicalOverlayBase));
    for (const s of rep.screens) {
      if (s.verdict === 'skipped') continue;
      const uiScreen = uiScreensById.get(s.screen_id) ?? uiScreensById.get(canonicalOverlayBase(s.screen_id));
      if (!uiScreen) continue;
      const layoutAbs = path.join(reportDir, `layout-${s.screen_id}.json`);
      const dump = loadLayoutDumpFile(layoutAbs);
      if (!dump) {
        // rev7（codex P1）：status=captured 却解析不出=文件事后被删/损坏/schema 不符——
        // 任何屏都不许静默跳过（声称有证据而证据不可用，比"没采"更可疑）。
        if (s.layout_dump_status === 'captured' || s.layout_dump_status === 'unstable') {
          dumpMissing.push(`${s.screen_id}（声称已采集但 layout-${s.screen_id}.json 缺失/不可解析——文件被删或损坏，须重采）`);
        } else if (pixel1to1 && p0Set.has(canonicalOverlayBase(s.screen_id))) {
          dumpMissing.push(`${s.screen_id}（${s.layout_dump_status ?? '未采集'}）`);
        }
        continue;
      }
      const res = collectLayoutOracleForScreen({ screenId: s.screen_id, screen: uiScreen, dump });
      // t4b（f7a3d9c2）：unstable 屏（静稳采样重试耗尽，图/树可能非同状态）——T8 命中全体
      // 降档走独立 id（capability degradation：不进 candidate-blocking、免 t2 转录、T2 批量
      // 消息明示真人复核）。A/B/C 不豁免 A 类——过渡态下 A 类同样瞬时误报（rev3 codex/claude）。
      if (s.layout_dump_status === 'unstable') {
        for (const f of res.findings) {
          if (f.tier === 'advisory') continue;
          t8UnstableFindings.push({ screen_id: s.screen_id, finding: f });
          unstableLines.push(
            `${s.screen_id}[${f.signal}#${f.finding_id}·${f.tier}→unstable]${f.bbox ? ` bbox=${JSON.stringify(f.bbox)}` : ''}: ${f.note}`,
          );
        }
        continue;
      }
      if (res.bClassSkipped) {
        warnLines.push(
          `${s.screen_id}: locator 覆盖率 ${(res.coverage * 100).toFixed(0)}% < ${LOCATOR_COVERAGE_THRESHOLD * 100}%，` +
          `B 类断言 SKIP（不带病判定）——coding 为声明元素设 .id(<element_id>) 可修复`,
        );
      }
      for (const f of res.findings) {
        t8Findings.push({ screen_id: s.screen_id, finding: f });
        const line = `${s.screen_id}[${f.signal}#${f.finding_id}]${f.bbox ? ` bbox=${JSON.stringify(f.bbox)}` : ''}: ${f.note}`;
        if (f.tier === 'hard') hardLines.push(line);
        else if (f.tier === 'warn') warnLines.push(line);
        else referenceNotes.push(`[T8 advisory] ${line}`);
      }
    }
    if (unstableLines.length > 0) {
      pushVisualDiffHit(hits, {
        id: 'visual_diff_layout_invariants_unstable',
        severity: 'MAJOR',
        status: 'WARN',
        line:
          `【T8 观测（unstable 屏降档——静稳采样重试耗尽，图/树可能非同状态；capability degradation，` +
          `不阻断 candidate-pass、免转录，T2 批量终审时真人复核）】` +
          unstableLines.slice(0, 6).join(' | ') + (unstableLines.length > 6 ? ` …共 ${unstableLines.length} 处` : ''),
      });
    }
    if (hardLines.length > 0) {
      const ratchet = pixel1to1
        ? fidelityRatchetFailOrWarn(ctx, false)
        : { severity: 'MAJOR' as const, status: 'WARN' as const };
      pushVisualDiffHit(hits, {
        id: 'visual_diff_layout_invariants',
        severity: ratchet.severity,
        status: ratchet.status,
        line:
          `【T8 布局不变量违反（运行时布局树确定性证据，VL pass 不可推翻、禁止弃判）】` +
          hardLines.slice(0, 6).join(' | ') + (hardLines.length > 6 ? ` …共 ${hardLines.length} 处` : ''),
      });
    }
    if (warnLines.length > 0) {
      pushVisualDiffHit(hits, {
        id: 'visual_diff_layout_invariants',
        severity: 'MAJOR',
        status: 'WARN',
        line:
          `【T8 布局结构观测（WARN 档，档位见 layout-oracle-calibration.md）】` +
          warnLines.slice(0, 6).join(' | ') + (warnLines.length > 6 ? ` …共 ${warnLines.length} 处` : ''),
      });
    }
    if (dumpMissing.length > 0) {
      pushVisualDiffHit(hits, {
        id: 'visual_diff_layout_dump_missing',
        severity: 'MAJOR',
        status: 'WARN',
        line:
          `pixel_1to1 P0 屏缺布局树 dump（layout-<screen_id>.json，几何不变量未运行）：${dumpMissing.join(', ')}` +
          `——capture 层随截图同步 dump（首版 WARN，视 D1/D2 校准结论收紧）`,
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
        `verdict 证据已失效（绑定截图文件被改动，或构建已更换/缺 build 指纹——改码重装必重判）：` +
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

  // t2（f7a3d9c2）：转录对账门禁 visual_diff_finding_transcription——
  // ①T8 hard/warn 发现 ↔ defects 对账（主判据 finding_id；次判据 elements∩+signal 语义类；
  //   bbox 仅 IoU≥0.5 legacy 回退）；②must_fix 逐条锚定（defect.must_fix_refs 引用，
  //   堵"条数凑平但错配"的 filler defects 缝——rev10 计数门只是必要条件近似）。
  // t4 的 unstable 独立 id 命中不产生 findings（capability degradation），天然免转录。
  // review-fix（codex P1-3）：转录对账不净（hard 未转录/must_fix 漏锚定 FAIL）→ 本轮
  // 指纹集缺斤短两/被 filler 污染——透传 transcriptionDirty 给指纹资格判定。
  let transcriptionDirty = false;
  const unloggedWarnFindingIds: string[] = [];
  {
    const unloggedHard: string[] = [];
    const unloggedWarn: string[] = [];
    const templates: string[] = [];
    for (const { screen_id, finding } of t8Findings) {
      if (finding.tier === 'advisory') continue;
      const entry = byScreenId.get(screen_id);
      const defects = entry?.defects ?? [];
      const matched =
        defects.some(d => d.source?.finding_id === finding.finding_id) ||
        (finding.elements.length > 0 &&
          defects.some(
            d =>
              typeof d.element === 'string' &&
              finding.elements.includes(d.element) &&
              signalExpectedClasses(finding.signal).has(d.class),
          )) ||
        // review-fix（codex P2-2）：bbox legacy 回退同样须语义类一致——同区域一个无关
        // 类别的 defect 不得消账（IoU 只证"位置重叠"，不证"同一问题"）。
        (Array.isArray(finding.bbox) &&
          defects.some(
            d =>
              Array.isArray(d.bbox) &&
              d.bbox.length === 4 &&
              signalExpectedClasses(finding.signal).has(d.class) &&
              normRectIoU(finding.bbox as number[], d.bbox) >= TRANSCRIPTION_BBOX_IOU_MIN,
          ));
      if (matched) continue;
      const label = `${screen_id}[${finding.signal}#${finding.finding_id}]`;
      if (finding.tier === 'hard') {
        unloggedHard.push(label);
        if (templates.length < 3) {
          templates.push(
            JSON.stringify({
              class: defaultClassForSignal(finding.signal),
              ...(finding.elements.length > 0 ? { element: finding.elements[0] } : {}),
              ...(finding.bbox ? { bbox: finding.bbox } : {}),
              severity: 'major',
              note: finding.note.slice(0, 120),
              source: { producer: 'T8', finding_id: finding.finding_id, signal: finding.signal },
            }),
          );
        }
      } else {
        unloggedWarn.push(label);
        unloggedWarnFindingIds.push(finding.finding_id);
      }
    }
    if (unloggedHard.length > 0) {
      const ratchet = pixel1to1
        ? fidelityRatchetFailOrWarn(ctx, false)
        : { severity: 'MAJOR' as const, status: 'WARN' as const };
      if (ratchet.status === 'FAIL') transcriptionDirty = true;
      pushVisualDiffHit(hits, {
        id: 'visual_diff_finding_transcription',
        severity: ratchet.severity,
        status: ratchet.status,
        line:
          `【t2 发现未落账】T8 hard 命中无对应 defect（source.finding_id/element/bbox 均未对上）：` +
          `${unloggedHard.slice(0, 6).join(', ')}${unloggedHard.length > 6 ? `…共 ${unloggedHard.length} 处` : ''}` +
          `——照抄模板进该屏 defects[]（并折算 must_fix）：${templates.join(' ')}`,
      });
    }
    if (unloggedWarn.length > 0) {
      // review-fix 轮2（codex P1-3）：未转录的 candidate-blocking WARN 使本轮失去熔断
      // 资格（其身份不在 defect 指纹集内，比较会吃残缺数据——错向安全侧推迟熔断）。
      transcriptionDirty = true;
      // T8 warn 命中本身已在 CANDIDATE_BLOCKING_WARN_IDS 阻断 candidate-pass——
      // 本 WARN 只是落账提醒，不另加阻断。
      pushVisualDiffHit(hits, {
        id: 'visual_diff_finding_transcription',
        severity: 'MAJOR',
        status: 'WARN',
        line:
          `【t2 落账提醒】T8 warn 命中未转录 defects（终判前须落账或以 defect 记录处置结论）：` +
          `${unloggedWarn.slice(0, 6).join(', ')}${unloggedWarn.length > 6 ? `…共 ${unloggedWarn.length} 处` : ''}`,
      });
    }
    // ②must_fix 逐条锚定（pixel_1to1 P0 finalized 屏）
    if (pixel1to1) {
      const p0BaseSet = new Set(p0Ids.map(canonicalOverlayBase));
      const unanchored: string[] = [];
      for (const s of rep.screens) {
        if (isCaptureMutableVerdict(s.verdict)) continue;
        if (!p0BaseSet.has(canonicalOverlayBase(s.screen_id))) continue;
        const mf = s.must_fix ?? [];
        if (mf.length === 0) continue;
        const anchored = new Set<number>();
        for (const d of s.defects ?? []) {
          for (const r of d.must_fix_refs ?? []) anchored.add(r);
        }
        for (let i = 0; i < mf.length; i++) {
          if (!anchored.has(i)) unanchored.push(`${s.screen_id}#${i}「${mf[i].slice(0, 40)}」`);
        }
      }
      if (unanchored.length > 0) {
        const ratchet = fidelityRatchetFailOrWarn(ctx, false);
        if (ratchet.status === 'FAIL') transcriptionDirty = true;
        pushVisualDiffHit(hits, {
          id: 'visual_diff_finding_transcription',
          severity: ratchet.severity,
          status: ratchet.status,
          line:
            `【t2 回修指令未结构化锚定】以下 must_fix 条目无任何 defect 以 must_fix_refs 引用` +
            `（凑数 filler defects 不作数——每条指令须有结构化 class/element/bbox 锚点）：` +
            `${unanchored.slice(0, 6).join('; ')}${unanchored.length > 6 ? `…共 ${unanchored.length} 条` : ''}`,
        });
      }
    }
  }

  // t9（rev7/rev9）：当轮缺陷指纹集进 details——连续两轮 [fingerprints] 行逐字相同=no-progress，
  // 熔断判据机器可比（goal 重试日志 diff / 交互态 critic 直接对照），不依赖自然语言。
  // rev9：未转录轮次（must_fix 无对应结构化 defects）无资格比较——显式标 ineligible，
  // 消费方不得对该轮做熔断判定（同数异质问题会被计数近似误判成无进展）。
  // review-fix（codex P1-3）：资格=rev10 计数门 && 转录对账净——filler defects 轮
  // （凑数错配）虽过计数门，但其指纹是污染数据，不得进入熔断比较基线。
  const fingerprintable = isRoundFingerprintable(rep.screens) && !transcriptionDirty;
  const roundFingerprints = fingerprintable ? collectDefectFingerprints(rep.screens) : [];
  if (!fingerprintable) {
    referenceNotes.push(
      `[fingerprints] ineligible（存在 must_fix 未转录/未锚定的屏——本轮不参与熔断比较，先按 transcription 门禁逐条转录锚定）`,
    );
  } else if (roundFingerprints.length > 0) {
    referenceNotes.push(`[fingerprints] ${roundFingerprints.join(' ')}`);
  }

  // P0-9b（codex 收窄）：唯一阻塞=T2 真人确认 → 机器可读 await_human_confirm（goal-runner 据此
  // halt 为 await_human_visual_confirm 而非 no_progress）。条件缺一不可：全部 FAIL hit 均为
  // T2、P0 全覆盖、全屏 finalized pass 且零 must_fix、零 stale/缺 hash——warn+must_fix 混杂
  // ≠待签（不得教用户签过未裁决内容）。
  // t1（rev5）：awaitHumanOnly 在 fuse **之前**以 base hits 计算——candidate-pass/求人路径
  // 优先于 no_progress_fuse；fuse 只在 awaitHumanOnly=false 时评估（防"只差人签"被抢走）。
  const failHitsOnly = hits.filter(h => h.status === 'FAIL');
  // rev8（codex P1）：candidate 资格不只排除额外 FAIL——**未处置的 T8/M1 WARN** 同样取消资格
  //（OpenSpec："no unresolved T8/M1 hit"；B 类结构背离/locator 覆盖不足/压线自报未处置就发起
  // T2 = 教用户签未裁决内容）。边界（防死锁）：dump 缺失（layout_dump_missing）是**能力降级**
  // 而非未处置发现——纳入阻断会让无 dump 能力的宿主永远无法 candidate-pass/收口；它随批量终审
  // 消息呈现供人知情，待 t4/t11 校准后该信号自身收紧为 FAIL 时自然阻断。OCR 降级/边缘哨兵同理。
  const CANDIDATE_BLOCKING_WARN_IDS = new Set([
    'visual_diff_layout_invariants',
    'visual_diff_selfreport_integrity',
  ]);
  const hasBlockingWarn = hits.some(h => h.status === 'WARN' && CANDIDATE_BLOCKING_WARN_IDS.has(h.id));
  // codex P2：须当前指纹可算且全屏指纹一致——否则（如 install meta 缺失）下一轮 capture 无法
  // 跳采，真人签仍会被重采清掉，不得诱导用户此刻签名。
  const awaitHumanOnly =
    pixel1to1 &&
    typeof currentBuildFp === 'string' &&
    currentBuildFp.length > 0 &&
    failHitsOnly.length > 0 &&
    failHitsOnly.every(h => h.id === 'visual_diff_human_confirm_required') &&
    !hasBlockingWarn &&
    p0Uncovered.length === 0 &&
    rep.screens.length > 0 &&
    // 逐屏资格与 CLI 同源谓词（含 pass/零 must_fix/指纹一致/非 stale/hash 齐）
    rep.screens.every(s => isScreenAwaitConfirmEligible(s, ctx.projectRoot, currentBuildFp));

  // t1（f7a3d9c2）：轮次账本评估 + 指纹级 no-progress fuse。
  // - source_fail_hit_ids=fuse 之前的 base FAIL hit 集（rev5：排除 fuse 自身防反馈环）；
  // - actionable residual=结构化谓词（rev5：非前缀猜测）且仅 pixel_1to1（t6b 守恒——低档
  //   位 decision 恒 fused=false，账本仍照常观测）；
  // - check 只读账本判定，追加由 harness-runner 消费 structured payload 完成（红线切分）。
  const sourceFailHitIds = [...new Set(failHitsOnly.map(h => h.id))];
  // review-fix 轮2（codex P1-3）：未处置 actionable WARN 的稳定身份进状态——WARN 从 A
  // 变 B（同截图同 defects）不是同状态，不得撞 round_key 重放旧 decision。
  const sourceWarnIds = [
    ...new Set([
      ...hits.filter(h => h.status === 'WARN' && CANDIDATE_BLOCKING_WARN_IDS.has(h.id)).map(h => h.id),
      ...unloggedWarnFindingIds,
    ]),
  ];
  const actionableResidual =
    pixel1to1 && hasActionableVisualResidual(rep.screens, hits.map(h => ({ id: h.id, status: h.status })));
  const goalRunId = process.env.MAISON_GOAL_RUN_ID?.trim() || null;
  const attemptId = process.env.MAISON_GOAL_ATTEMPT?.trim() || null;
  // review-fix（cursor I-1）：交互态 loop_id 带「采集世代」=ui-spec 内容指纹——spec 变更
  // （新一轮设计迭代）自动开新世代，防跨会话拿旧轮同指纹误熔 ineffective_fix；
  // 同一 spec 下跨会话比较仍成立（残差确实没修）。
  const uiSpecGeneration = (() => {
    try {
      const specPath = uiSpecAbsPath(ctx.projectRoot, ctx.feature);
      if (fs.existsSync(specPath)) {
        return createHash('sha256').update(fs.readFileSync(specPath)).digest('hex').slice(0, 8);
      }
    } catch { /* 世代不可算退 nospec */ }
    return 'nospec';
  })();
  const loopId = goalRunId ? `goal:${goalRunId}` : `interactive:${ctx.feature}:${uiSpecGeneration}`;
  let roundEvaluation: VisualRoundEvaluation | undefined;
  // review-fix（cursor I-5）：goal 身份不完整（有 RUN_ID 无 ATTEMPT——新 harness 配旧
  // runner 的混版场景）不得静默按交互态去重（会吞跨 attempt 同状态熔断）——如实跳过
  // 账本评估（无 fuse、无追加），注记求修版本。
  const roundIdentityComplete = !goalRunId || Boolean(attemptId);
  if (!roundIdentityComplete) {
    referenceNotes.push(
      '[visual_rounds] goal 轮次身份不完整（有 MAISON_GOAL_RUN_ID 无 MAISON_GOAL_ATTEMPT——runner 版本过旧？）——本轮跳过账本评估，不误判不误吞',
    );
  } else {
    try {
      // S5（visual-capability-truth 单写者）：goal 态 agent 侧评估的逻辑历史 =
      // committed ledger + 本 attempt 的 journal proposals（中间轮第 N+1 轮能看到
      // 第 N 轮，no-progress 熔断语义不随单写者化丢失）；gate harness（正式行已含
      // 收编中间轮）extraRows 自然为空集。
      let extraRows: import('../../../harness/scripts/utils/visual-rounds-ledger').VisualRoundRow[] = [];
      if (goalRunId && attemptId && process.env.MAISON_GOAL_GATE_HARNESS !== '1') {
        try {
          const journal = readJournalProposals(
            intermediateRoundsJournalPath(ctx.projectRoot, ctx.feature, goalRunId),
          );
          extraRows = journalRowsToLogicalHistory(journal.rows, attemptId);
        } catch {
          extraRows = [];
        }
      }
      roundEvaluation = evaluateVisualRound(visualRoundsLedgerPath(ctx.projectRoot, ctx.feature), {
        loopId,
        attemptId: goalRunId ? attemptId : null,
        goalRunId,
        buildFingerprint: currentBuildFp ?? '',
        screensHash: computeScreensHash(rep.screens),
        defectFingerprints: roundFingerprints,
        sourceFailHitIds,
        sourceWarnIds,
        fingerprintable,
        awaitHumanOnly,
        actionableResidual,
      }, { extraRows });
      if (roundEvaluation.corrupt_lines > 0) {
        referenceNotes.push(
          `[visual_rounds] 账本存在 ${roundEvaluation.corrupt_lines} 条损坏行（崩溃半行已跳过；行数异常回退须人工核查——账本损坏不解释成空历史）`,
        );
      }
    } catch (e) {
      referenceNotes.push(`[visual_rounds] 轮次账本评估失败（不阻断本轮判定）：${(e as Error).message}`);
    }
  }
  if (roundEvaluation?.decision.fused && pixel1to1) {
    const d = roundEvaluation.decision;
    const guidance =
      d.attribution === 'ineffective_fix'
        ? '重建后缺陷指纹原样复现（修了没用）——停止迭代、halt 求人，携残差清单'
        : '未经重建/修码原样重跑（跑了没修）——先改码重建再测，重复空跑不消耗迭代';
    pushVisualDiffHit(hits, {
      id: 'visual_diff_no_progress_fuse',
      severity: 'BLOCKER',
      status: 'FAIL',
      line:
        `【t1 无进展熔断（${d.attribution}${roundEvaluation.disposition === 'duplicate' ? '，duplicate 重放' : ''}）】` +
        `连续两有效轮缺陷指纹集相等且仍有 loop-actionable 残差：${guidance}；残差指纹：` +
        `${(d.residual_fingerprints ?? []).slice(0, 6).join(' ')}${(d.residual_fingerprints?.length ?? 0) > 6 ? '…' : ''}`,
    });
  }

  const detailsWithNotes = referenceNotes.length > 0 ? `${details}\n${referenceNotes.join('\n')}` : details;
  const finalResult = finalizeVisualDiffHits(desc, reportRel, detailsWithNotes, hits);

  if (awaitHumanOnly) {
    finalResult.failure_kind = 'await_human_confirm';
    // t3b：candidate-pass 两档位——verified 档由 runner attestation 校验解锁（手写 verified
    // 已在回执校验处降级），其余如实 unverified、照常进 T2 批量终审。
    const tier = receiptProvenance === 'verified' ? 'candidate-pass(verified)' : 'candidate-pass(unverified)';
    finalResult.details +=
      `\n【await_human_visual_confirm · ${tier}】唯一阻塞=真人过目确认（设计内求人时刻，非无进展）：` +
      '逐屏审阅 device-screenshots/shot-*.png 对照参考原图，认可后在 visual-diff.json ' +
      'screens[].confirmed_by 填真人署名（user_requirement/自动化身份无效）并重跑 harness；' +
      '不认可的屏改 verdict=fail 并写 must_fix。';
  } else if (roundEvaluation?.decision.fused && pixel1to1) {
    // t1：goal-runner 据此 classification 首触即 halt（不烧重试预算）；duplicate 重放
    // 同样置位——外层 gate 在 agent 自跑首检 fuse 后必须仍能看到（rev5）。
    finalResult.failure_kind = 'no_progress_fuse';
  }

  // t0③：进程内结构化 payload（runner 消费追加账本 + summary.visual_round；不进 summary
  // blocker schema）。持久化侧车=账本本身。
  const structuredPayload: VisualDiffStructuredPayload = {
    kind: 'visual_diff',
    loop_id: loopId,
    attempt_id: goalRunId ? attemptId : null,
    goal_run_id: goalRunId,
    build_fingerprint: currentBuildFp ?? null,
    screens_hash: computeScreensHash(rep.screens),
    defect_fingerprints: roundFingerprints,
    fingerprintable,
    source_fail_hit_ids: sourceFailHitIds,
    source_warn_ids: sourceWarnIds,
    await_human_only: awaitHumanOnly,
    actionable_residual: actionableResidual,
    ...(roundEvaluation ? { round: roundEvaluation } : {}),
    t8_unstable_findings: t8UnstableFindings.map(({ screen_id, finding }) => ({
      screen_id,
      finding_id: finding.finding_id,
      signal: finding.signal,
      tier: finding.tier,
      elements: finding.elements,
      ...(finding.bbox ? { bbox: finding.bbox } : {}),
    })),
    t8_findings: t8Findings.map(({ screen_id, finding }) => ({
      screen_id,
      finding_id: finding.finding_id,
      signal: finding.signal,
      tier: finding.tier,
      elements: finding.elements,
      ...(finding.bbox ? { bbox: finding.bbox } : {}),
    })),
  };
  finalResult.structured = structuredPayload;
  return [finalResult];
}
