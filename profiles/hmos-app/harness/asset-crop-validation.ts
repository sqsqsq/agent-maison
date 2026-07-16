// ============================================================================
// asset-crop-validation.ts — P0-B 裁剪产物验真门禁（plan f2d8c4a6）
// ----------------------------------------------------------------------------
// 背景（round6）：asset-acquisition 裁完即过、resolved_path 已存在直接 continue——204×2938 整页竖切条、
//   纯蓝色块、空白小图全部畅通物化进模块 media。本 check 对**全部** acquisition:crop 资产验真：
//   新裁 / 历史已存在 / 已物化，一律重验，不吃"已存在"豁免（堵 asset-acquisition.ts existsSync→continue 洞）。
// 三层证据：
//   1) 确定性 sanity（先跑、可一票否决）：条状塌缩 / icon 长宽比与面积占比 / 纯色与空白（jimp stats）。
//      本次三类废图（竖条、纯蓝、空白）全部命中。
//   2) VL 独立辨认（契约文件 spec/reports/asset-crop-vl.yaml，由 spec agent 以**隔离会话**逐图辨认后落盘：
//      新会话只给 crop 图问"这是什么"，答案与资产用途匹配才 match:true——防"裁的人自己说裁对了"自报）。
//      sanity 只能否决坏图、不能证明语义对，故 sanity PASS 仍须 VL match 或真人确认（bbox_verified_by）。
//      VL 记录缺失/失配/不可用 → pixel_1to1 不得静默 PASS（外部评审采纳：VL 断流≠放行），入待人工确认清单。
//   3) 贴回对照 contact-sheet（证据落盘 spec/reports/asset-contact-sheet-<ref>.png）：
//      左=原图+bbox 红框、右=crop 缩略图，人 3 秒可判，headless 留审计证据。
// 产物：spec/reports/asset-crop-validation.json 机器裁决（verified|failed|pending per key）——
//   coding 阶段物化门禁（visual_parity_unverified_crop）消费之，未 verified 的 crop 不得进模块 media。
// 与 P0-C 的分界：human_crop_confirmed/crop_confirmed_by=user_requirement 是**裁剪授权**（能不能裁），
//   本 check 是**产物验真**（裁没裁对）——授权绝不豁免验真。
// ============================================================================

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';
import type { CheckContext, CheckResult } from '../../../harness/scripts/utils/types';
import {
  loadUiSpecFile,
  parseUiChangeFromSpecMarkdown,
  uiSpecAbsPath,
  uiSpecRelPath,
  UI_CHANGE_REQUIRES_UI_SPEC,
  type UiSpecAsset,
} from '../../../harness/scripts/utils/ui-spec-shared';
import { featureFilePath, relFeatureFile } from '../../../harness/config';
import { asArray } from '../../../harness/scripts/utils/shape-guards';
import {
  isPixel1to1,
  fidelityRatchetFailOrWarn,
  isHumanVerified,
  isAutomationSigner,
} from '../../../harness/scripts/utils/fidelity-shared';
import { findModuleMediaFile } from './visual-parity-backstop';
import {
  computeImageStats,
  isJimpAvailable,
  readImageDimensions,
  renderContactSheet,
  type ContactSheetEntry,
} from './image-toolkit';
import {
  buildAuthoritativeRefImageIndex,
  resolveRefSourceImage,
} from './authoritative-ref-images';

const requireHarness = createRequire(path.resolve(__dirname, '../../../harness/harness-runner.ts'));
const YAML = requireHarness('yaml') as { parse: (s: string) => unknown };

// ---- sanity 阈值（启发初值，round6 夹具 + 宿主 checkpoint 校准；见 plan §四 P0-B 阈值 FP 注记）----

/** 任意 crop：长边/短边超此值判条状塌缩（204×2938≈14.4 命中；正常插画横图 ≤3） */
export const CROP_STRIP_MAX_RATIO = 4;
/** icon 类：trim 后长宽比合法区间 */
export const ICON_ASPECT_MIN = 1 / 3;
export const ICON_ASPECT_MAX = 3;
/** icon 类：crop 面积占原图比例上限（图标不该占整屏 8% 以上） */
export const ICON_MAX_AREA_FRACTION = 0.08;
/** 纯色判定：量化唯一色 ≤ 此值 或 灰度标准差 < 下值（纯蓝块 uniqueColors=1 命中） */
export const SOLID_MAX_UNIQUE_COLORS = 2;
export const SOLID_MIN_LUMA_STDDEV = 3;
/** 空白判定：非近白/近黑内容占比 < 此值（空白小图命中） */
export const BLANK_MAX_CONTENT_RATIO = 0.02;

export type CropKind = 'icon' | 'illustration';

/** 按 key 语义分型（icon/logo/tab → icon；ill/promo/其余 → illustration 宽松档） */
export function classifyCropKind(key: string): CropKind {
  const k = key.toLowerCase();
  if (/(^|_)(icon|logo|tab)(_|$)/.test(k) || k.startsWith('icon') || k.startsWith('logo')) return 'icon';
  return 'illustration';
}

export interface CropSanityResult {
  status: 'pass' | 'fail' | 'unknown';
  reasons: string[];
  width?: number;
  height?: number;
}

/**
 * 确定性 sanity。sourceDims 可选（缺则跳过面积占比项）。
 * jimp 不可用时纯色/空白项无法判 → 头部尺寸项全过则 status='unknown'（调用方按 pixel_1to1 硬策略处置）。
 */
export function runCropSanity(
  cropAbsPath: string,
  kind: CropKind,
  sourceDims?: { w: number; h: number } | null,
): CropSanityResult {
  const dims = readImageDimensions(cropAbsPath);
  if (!dims || dims.w === null || dims.h === null) {
    return { status: 'fail', reasons: ['无法读取图像尺寸（疑似损坏/非图像）'] };
  }
  const { w, h } = dims as { w: number; h: number };
  const reasons: string[] = [];
  const long = Math.max(w, h);
  const short = Math.max(1, Math.min(w, h));
  if (long / short > CROP_STRIP_MAX_RATIO) {
    reasons.push(`条状塌缩：${w}×${h}（长短边比 ${(long / short).toFixed(1)} > ${CROP_STRIP_MAX_RATIO}，疑似整屏切条/bbox 错位）`);
  }
  if (kind === 'icon') {
    const aspect = w / h;
    if (aspect < ICON_ASPECT_MIN || aspect > ICON_ASPECT_MAX) {
      reasons.push(`icon 长宽比反常：${aspect.toFixed(2)}（合法 [${ICON_ASPECT_MIN.toFixed(2)}, ${ICON_ASPECT_MAX}]）`);
    }
    if (sourceDims && sourceDims.w > 0 && sourceDims.h > 0) {
      const frac = (w * h) / (sourceDims.w * sourceDims.h);
      if (frac > ICON_MAX_AREA_FRACTION) {
        reasons.push(`icon 面积占原图 ${(frac * 100).toFixed(1)}% > ${ICON_MAX_AREA_FRACTION * 100}%（图标不该裁出整块区域）`);
      }
    }
  }
  if (reasons.length > 0) return { status: 'fail', reasons, width: w, height: h };

  const stats = computeImageStats(cropAbsPath);
  if (!stats.ok) {
    return { status: 'unknown', reasons: [`纯色/空白项无法判（${stats.error ?? 'jimp stats 失败'}）`], width: w, height: h };
  }
  if ((stats.uniqueColors ?? 99) <= SOLID_MAX_UNIQUE_COLORS || (stats.lumaStddev ?? 99) < SOLID_MIN_LUMA_STDDEV) {
    reasons.push(`近纯色块：uniqueColors=${stats.uniqueColors} lumaStddev=${stats.lumaStddev}（无图标/插画内容）`);
  }
  if ((stats.contentRatio ?? 1) < BLANK_MAX_CONTENT_RATIO) {
    reasons.push(`近空白：内容像素占比 ${((stats.contentRatio ?? 0) * 100).toFixed(2)}%`);
  }
  return reasons.length > 0
    ? { status: 'fail', reasons, width: w, height: h }
    : { status: 'pass', reasons: [], width: w, height: h };
}

// ---- VL 独立辨认契约（spec agent 落盘）----

export interface CropVlEntry {
  key: string;
  /** 隔离会话对 crop 图的独立辨认描述 */
  identified_as?: string;
  /** 辨认结果与资产用途是否匹配（spec agent 判定并落盘；sanity 可否决但不可替代） */
  match?: boolean;
  /**
   * 辨认来源署名（隔离会话/模型标识，如 "vl-isolated-claude"）。
   * 必须非空且非 AUTOMATION_SIGNER_IDS（goal-mode-auto 等自报身份 match:true 不算数）——
   * 外部评审（codex 2026-07-02）指出的自签绕过洞：契约本身是软约束，但至少把"懒惰自签"这条最容易的
   * 造假路径堵死；粗暴废图另有确定性 sanity 硬兜底。
   */
  by?: string;
}

/** VL 辨认署名合法性：非空且非自动化自报身份 */
export function isValidVlSigner(by: string | undefined): boolean {
  return typeof by === 'string' && by.trim().length > 0 && !isAutomationSigner(by);
}

/** crop 产物内容指纹（验真裁决与文件内容绑定，防陈旧 verified 复用） */
export function sha256File(absPath: string): string | null {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(absPath)).digest('hex');
  } catch {
    return null;
  }
}

export function cropVlReportAbsPath(projectRoot: string, feature: string): string {
  return featureFilePath(projectRoot, feature, path.join('spec', 'reports', 'asset-crop-vl.yaml'));
}

export function loadCropVlEntries(projectRoot: string, feature: string): Map<string, CropVlEntry> {
  const abs = cropVlReportAbsPath(projectRoot, feature);
  const out = new Map<string, CropVlEntry>();
  if (!fs.existsSync(abs)) return out;
  try {
    const doc = YAML.parse(fs.readFileSync(abs, 'utf-8')) as { entries?: CropVlEntry[] } | null;
    // P0-2：entries 非数组真值（{} 等）→ asArray 防 for..of 崩（原实现靠外层 catch 吞掉
    // TypeError 整表作废；归一后按"无记录"语义走既有 fail-closed 路径——每个 crop 资产
    // 会得到"无裁决记录"的结构化 FAIL，非静默 PASS）。复审补：坏形状留 warn 痕迹，
    // 排障者可区分"真没跑 VL"与"报告文件形状坏了"。
    if (doc?.entries !== undefined && doc?.entries !== null && !Array.isArray(doc.entries)) {
      console.warn(`[asset-crop-validation] ${abs} 的 entries 非数组（${typeof doc.entries}），按无记录处理——相关 crop 资产将 FAIL"无裁决记录"`);
    }
    for (const e of asArray<CropVlEntry>(doc?.entries)) {
      if (e && typeof e.key === 'string' && e.key.trim()) out.set(e.key.trim(), e);
    }
  } catch {
    /* 解析失败按无记录处理（缺证据不放行，不因坏文件崩 check） */
  }
  return out;
}

// ---- 机器裁决产物（coding 物化门禁消费）----

export type CropVerdict = 'verified' | 'failed' | 'pending';

export interface CropVerdictEntry {
  verdict: CropVerdict;
  kind: CropKind;
  reasons?: string[];
  /** 验真时 crop 产物的 sha256（裁决与内容绑定；coding 消费时重算比对，防重裁/换图后吃陈旧 verified） */
  sha256?: string | null;
  /** 验真时的 resolved_path / source_bbox 快照（spec 变更未重验 → 绑定失效） */
  resolved_path?: string;
  source_bbox?: number[];
}

export interface CropValidationVerdicts {
  schema_version: string;
  generated_at: string;
  entries: Record<string, CropVerdictEntry>;
}

export function cropValidationVerdictsAbsPath(projectRoot: string, feature: string): string {
  return featureFilePath(projectRoot, feature, path.join('spec', 'reports', 'asset-crop-validation.json'));
}

export function loadCropValidationVerdicts(
  projectRoot: string,
  feature: string,
): CropValidationVerdicts | null {
  const abs = cropValidationVerdictsAbsPath(projectRoot, feature);
  if (!fs.existsSync(abs)) return null;
  try {
    const doc = JSON.parse(fs.readFileSync(abs, 'utf-8')) as CropValidationVerdicts;
    if (!doc || typeof doc !== 'object' || typeof doc.entries !== 'object') return null;
    return doc;
  } catch {
    return null;
  }
}

function sameBbox(a?: number[], b?: number[]): boolean {
  if (!Array.isArray(a) || !Array.isArray(b)) return a === b || (!a && !b);
  return a.length === b.length && a.every((v, i) => Number(v) === Number(b[i]));
}

/**
 * coding 物化前置（visual_parity_unverified_crop 消费）：未 verified 的 crop 资产清单行。
 * 报告缺失=spec 未跑新门禁（旧产物），整组判未验真。
 * 绑定校验（codex P2 采纳，2026-07-02）：verified 裁决须与**当前**产物/声明一致——
 * 重算 crop 文件 sha256、比对 resolved_path/source_bbox 快照，任一漂移=陈旧裁决不放行；
 * 传入 contracts 时对已物化进模块 media 的副本一并核 hash 一致（plan §四 P0-B 原文要求）。
 */
export function collectUnverifiedCropLines(
  projectRoot: string,
  feature: string,
  doc: {
    assets?: Array<{
      key: string;
      acquisition?: string;
      placeholder?: boolean;
      resolved_path?: string;
      source_bbox?: number[];
    }>;
  },
  opts?: { contracts?: Parameters<typeof findModuleMediaFile>[1] },
): string[] {
  const cropAssets = (doc.assets ?? []).filter(a => a.acquisition === 'crop' && !a.placeholder);
  if (cropAssets.length === 0) return [];
  const verdicts = loadCropValidationVerdicts(projectRoot, feature);
  if (!verdicts) {
    return [
      `spec 缺 asset-crop-validation.json 机器裁决（${cropAssets.length} 项 crop 资产全部未验真——spec 阶段未跑 asset_crop_validation，须重跑 spec harness）`,
    ];
  }
  const out: string[] = [];
  for (const a of cropAssets) {
    const v = verdicts.entries[a.key];
    if (!v || v.verdict !== 'verified') {
      out.push(`${a.key}：${v ? `${v.verdict}（${asArray<string>(v.reasons).join('；') || '未通过验真'}）` : '无裁决记录'}`);
      continue;
    }
    // 绑定字段强制齐全（codex 二轮 P1 采纳）：verified 缺 sha256/resolved_path 即"旧格式/未绑定"裁决，
    // 不得放行——本格式本轮引入、无真实存量，"字段存在才查"会让手写最小 verified 整体绕过绑定校验。
    if (!v.sha256 || v.resolved_path === undefined) {
      out.push(`${a.key}：裁决缺绑定字段（sha256/resolved_path）——旧格式或非门禁产出的裁决，须重跑 spec asset_crop_validation`);
      continue;
    }
    const rel = a.resolved_path ?? relFeatureFile(projectRoot, feature, `spec/assets/${a.key}.png`);
    if (v.resolved_path !== rel) {
      out.push(`${a.key}：裁决绑定失效（验真时 resolved_path=${v.resolved_path}，当前=${rel}——spec 变更后未重验）`);
      continue;
    }
    // source_bbox：快照与当前声明须一致（含"双方都缺省"）；单边有另一边无=已漂移
    const snapHas = v.source_bbox !== undefined;
    const curHas = Array.isArray(a.source_bbox);
    if (snapHas !== curHas || (snapHas && !sameBbox(v.source_bbox, a.source_bbox))) {
      out.push(`${a.key}：裁决绑定失效（source_bbox 已变更，验真结论不再适用——重跑 spec asset_crop_validation）`);
      continue;
    }
    const abs = path.resolve(projectRoot, rel);
    const cur = fs.existsSync(abs) ? sha256File(abs) : null;
    if (cur !== v.sha256) {
      out.push(`${a.key}：裁决绑定失效（crop 产物内容已变化${cur ? '' : '/缺失'}，sha256 与验真时不符——重裁后须重验）`);
      continue;
    }
    // 已物化进模块 media 的副本须与验真产物字节一致（防"验真了 A，物化了 B"）
    if (opts?.contracts) {
      const mediaFile = findModuleMediaFile(projectRoot, opts.contracts, a.key);
      if (mediaFile && sha256File(mediaFile) !== v.sha256) {
        out.push(`${a.key}：模块 media 物化副本与验真产物 hash 不一致（${path.basename(mediaFile)}——须从 ${rel} 原样复制，不得再加工/换图）`);
      }
    }
  }
  return out;
}

function ruleDesc(ctx: CheckContext): string {
  const checks = ctx.phaseRule.structure_checks as Record<string, { description: string }>;
  return checks?.asset_crop_validation?.description?.trim() ?? 'asset_crop_validation';
}

/**
 * 人工验真逃生阀：真人署名（非自动化身份）即 verified（halt-confirm 回执/交互确认落 ui-spec）。
 * P0-6：bbox_verified_by 是**验真**语义——user_requirement（裁剪授权哨兵）不算，授权≠过目。
 */
function isHumanBboxVerified(a: UiSpecAsset & { bbox_verified_by?: string }): boolean {
  return isHumanVerified(a.bbox_verified_by);
}

/**
 * P0-B 主检查（spec 阶段）。对全部 crop 资产：sanity → VL/人确认 → 汇总裁决 + contact-sheet + 落盘 json。
 */
export function checkAssetCropValidation(ctx: CheckContext): CheckResult[] {
  const desc = ruleDesc(ctx);
  const uiSpecRel = uiSpecRelPath(ctx.projectRoot, ctx.feature);
  const specPath = featureFilePath(ctx.projectRoot, ctx.feature, path.join('spec', 'spec.md'));
  if (!fs.existsSync(specPath)) return [];
  const specMd = fs.readFileSync(specPath, 'utf-8');
  const uiChange = parseUiChangeFromSpecMarkdown(specMd);
  if (!uiChange || !UI_CHANGE_REQUIRES_UI_SPEC.has(uiChange)) return [];
  const doc = loadUiSpecFile(uiSpecAbsPath(ctx.projectRoot, ctx.feature));
  if (!doc) return [];

  const cropAssets = (doc.assets ?? []).filter(a => a.acquisition === 'crop' && !a.placeholder);
  if (cropAssets.length === 0) return [];

  const pixel = isPixel1to1(ctx);
  const results: CheckResult[] = [];

  // jimp 缺失：头部项仍可判条状，但纯色/空白盲 → pixel_1to1 不得静默放行（toolchain 归因）
  if (!isJimpAvailable() && pixel) {
    results.push({
      id: 'asset_crop_validation_toolchain_unavailable',
      category: 'structure',
      description: desc,
      severity: 'BLOCKER',
      status: 'FAIL',
      details:
        '【P0-B toolchain 不可用】jimp 未安装——纯色/空白 sanity 与 contact-sheet 无法执行，' +
        'pixel_1to1 下裁剪产物验真不完整，不得放行（确定性 sanity 是废图的唯一机器防线）。',
      suggestion: '在 harness 安装 jimp 后重跑（此 id 归 toolchain，signature 重复即 halt 求人）。',
      affected_files: [uiSpecRel],
    });
  }

  const refIndex = buildAuthoritativeRefImageIndex(ctx, specMd);
  const vlEntries = loadCropVlEntries(ctx.projectRoot, ctx.feature);

  const verdicts: CropValidationVerdicts = {
    schema_version: '1.0',
    generated_at: new Date().toISOString(),
    entries: {},
  };
  const failedLines: string[] = [];
  const pendingLines: string[] = [];
  const unknownSanity: string[] = [];
  const okKeys: string[] = [];
  const sheetsBySource = new Map<string, { sourcePath: string; entries: ContactSheetEntry[] }>();

  for (const a of cropAssets) {
    const key = a.key;
    const kind = classifyCropKind(key);
    const rel = a.resolved_path ?? relFeatureFile(ctx.projectRoot, ctx.feature, `spec/assets/${key}.png`);
    const abs = path.resolve(ctx.projectRoot, rel);
    if (!fs.existsSync(abs)) {
      // 未裁剪：授权/裁剪流转归 asset_acquisition；本 check 只验已存在产物
      verdicts.entries[key] = { verdict: 'pending', kind, reasons: ['crop 产物尚不存在（待 acquisition 裁剪）'] };
      pendingLines.push(`${key}：产物不存在（${rel}）`);
      continue;
    }

    let sourceDims: { w: number; h: number } | null = null;
    const srcPick = resolveRefSourceImage(refIndex, a.source_ref);
    if (srcPick.path) {
      const d = readImageDimensions(srcPick.path);
      if (d?.w && d?.h) sourceDims = { w: d.w, h: d.h };
      if (Array.isArray(a.source_bbox) && a.source_bbox.length === 4) {
        const group = sheetsBySource.get(srcPick.path) ?? { sourcePath: srcPick.path, entries: [] };
        group.entries.push({ key, bbox: a.source_bbox, cropPath: abs });
        sheetsBySource.set(srcPick.path, group);
      }
    }

    // 裁决与产物/声明绑定（codex P2）：sha256+resolved_path+source_bbox 快照，coding 消费时重比对
    const binding = { sha256: sha256File(abs), resolved_path: rel, source_bbox: a.source_bbox };

    const sanity = runCropSanity(abs, kind, sourceDims);

    // 真人验真至高（cursor FP 出口采纳）：对照 contact-sheet 的真人确认可翻案 sanity 启发阈值的误伤
    // （如合法的超长横幅营销图 long/short>4）——框架"pixel_1to1 人确认主背靠"原则；自动化署名不算。
    if (isHumanBboxVerified(a as UiSpecAsset & { bbox_verified_by?: string })) {
      verdicts.entries[key] = {
        verdict: 'verified', kind, ...binding,
        ...(sanity.status === 'fail'
          ? { reasons: [`真人确认翻案 sanity（${sanity.reasons.join('；')}）——特殊形状经人核合法`] }
          : {}),
      };
      okKeys.push(`${key}(人确认${sanity.status === 'fail' ? '·翻案sanity' : ''})`);
      continue;
    }

    if (sanity.status === 'fail') {
      verdicts.entries[key] = { verdict: 'failed', kind, reasons: sanity.reasons, ...binding };
      failedLines.push(`${key}（${kind}, ${sanity.width}×${sanity.height}）：${sanity.reasons.join('；')}`);
      continue;
    }
    if (sanity.status === 'unknown') {
      unknownSanity.push(`${key}：${sanity.reasons.join('；')}`);
    }

    // sanity 通过 ≠ 语义对：还须 VL 独立辨认 match（署名合法）或真人确认
    const vl = vlEntries.get(key);
    if (vl && vl.match === true && isValidVlSigner(vl.by)) {
      verdicts.entries[key] = { verdict: 'verified', kind, ...binding };
      okKeys.push(key);
    } else if (vl && vl.match === true) {
      // codex P1 采纳：match:true 但署名缺失/自动化自报（goal-mode-auto 等）不算数——防懒惰自签
      verdicts.entries[key] = {
        verdict: 'pending', kind, ...binding,
        reasons: [`VL 记录署名非法（by=${vl.by ?? '缺失'}，自动化自报不算）——须隔离会话署名或真人 bbox_verified_by`],
      };
      pendingLines.push(`${key}：VL match:true 但署名非法（by=${vl.by ?? '缺失'}）——自报不算，须隔离会话署名`);
    } else if (vl && vl.match === false) {
      verdicts.entries[key] = {
        verdict: 'failed', kind, ...binding,
        reasons: [`VL 独立辨认失配：辨认为「${vl.identified_as ?? '?'}」与资产用途不符`],
      };
      failedLines.push(`${key}：VL 辨认失配（「${vl.identified_as ?? '?'}」≠ 用途 ${key}）`);
    } else {
      verdicts.entries[key] = {
        verdict: 'pending', kind, ...binding,
        reasons: ['sanity 通过但缺 VL 独立辨认记录/真人确认——sanity 只能否决坏图，不能证明语义正确'],
      };
      pendingLines.push(`${key}：缺 VL 辨认记录（asset-crop-vl.yaml）或 bbox_verified_by 真人确认`);
    }
  }

  // contact-sheet 证据落盘（尽力而为；失败不阻断、只记注）
  const sheetNotes: string[] = [];
  if (isJimpAvailable()) {
    const reportsDir = featureFilePath(ctx.projectRoot, ctx.feature, path.join('spec', 'reports'));
    for (const [, group] of sheetsBySource) {
      const stem = path.basename(group.sourcePath).replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_');
      const out = path.join(reportsDir, `asset-contact-sheet-${stem}.png`);
      const r = renderContactSheet(group.sourcePath, group.entries, out);
      sheetNotes.push(r.ok
        ? `contact-sheet: ${path.relative(ctx.projectRoot, out).replace(/\\/g, '/')}（${group.entries.length} 项）`
        : `contact-sheet 生成失败（${stem}）：${r.error}`);
    }
  }

  // 机器裁决落盘（coding visual_parity_unverified_crop 消费）
  const verdictsAbs = cropValidationVerdictsAbsPath(ctx.projectRoot, ctx.feature);
  fs.mkdirSync(path.dirname(verdictsAbs), { recursive: true });
  fs.writeFileSync(verdictsAbs, JSON.stringify(verdicts, null, 2), 'utf-8');

  const statsLine =
    `verified ${okKeys.length} / failed ${failedLines.length} / pending ${pendingLines.length}` +
    `（共 ${cropAssets.length}，含历史已存在产物，无"已存在"豁免）` +
    (unknownSanity.length ? `；纯色项未判：${unknownSanity.join('；')}` : '') +
    (sheetNotes.length ? `\n${sheetNotes.join('\n')}` : '') +
    `\n机器裁决：${path.relative(ctx.projectRoot, verdictsAbs).replace(/\\/g, '/')}`;

  if (failedLines.length > 0) {
    const { severity, status } = fidelityRatchetFailOrWarn(ctx, true);
    results.push({
      id: 'asset_crop_validation',
      category: 'structure',
      description: desc,
      severity,
      status,
      details:
        `【P0-B 裁剪产物验真不通过】${failedLines.length}/${cropAssets.length} 项 crop 资产判废：\n` +
        failedLines.map(l => `  ${l}`).join('\n') + `\n${statsLine}`,
      suggestion:
        '废图=bbox 错位/转置的直接产物：先过 ui_spec_bbox_semantic 修坐标语义，再重裁并重跑本 check；' +
        '对照 contact-sheet 人核。未 verified 的 crop 不得物化进模块 media（coding 门禁会拦）。',
      affected_files: [uiSpecRel],
    });
  }

  if (pendingLines.length > 0) {
    const { severity, status } = pixel
      ? { severity: 'BLOCKER' as const, status: 'FAIL' as const }
      : { severity: 'MAJOR' as const, status: 'WARN' as const };
    results.push({
      id: 'asset_crop_validation_pending_confirm',
      category: 'structure',
      description: desc,
      severity,
      status,
      details:
        `【P0-B 待验真】${pendingLines.length} 项 crop 资产 sanity 无异常但缺独立验真（VL 辨认/真人确认），` +
        `pixel_1to1 下不得静默 PASS：\n` + pendingLines.map(l => `  ${l}`).join('\n'),
      suggestion:
        'spec agent 以隔离会话逐图辨认（新会话只给 crop 图问"这是什么元素"），结果落 ' +
        'spec/reports/asset-crop-vl.yaml（entries[].key/identified_as/match）；或真人对照 contact-sheet 确认后在 ' +
        'ui-spec 对应 asset 记 bbox_verified_by（真人署名，自动化身份不算）。goal headless 走 halt-confirm 求人。',
      affected_files: [uiSpecRel],
    });
  }

  if (failedLines.length === 0) {
    results.push({
      id: 'asset_crop_validation',
      category: 'structure',
      description: desc,
      severity: pendingLines.length > 0 ? 'MAJOR' : 'MINOR',
      status: pendingLines.length > 0 ? 'WARN' : 'PASS',
      details: `crop 资产验真：${statsLine}`,
      affected_files: [uiSpecRel],
    });
  }
  return results;
}
