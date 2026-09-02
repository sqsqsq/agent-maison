// ============================================================================
// visual-provider-review.ts — 只读视觉 provider 的逐屏评审接线（plan ab072691 t5）
// ============================================================================
// 两句话契约：
//   · **对 provider 结果 fail-closed** —— 坏的、旧的、身份/hash 不符的载荷一律不采信；
//   · **对循环按事实投影**           —— phase/release 均非必需时 unavailable 保持 advisory；
//                                        strict 或 release-required unavailable capability-defer；
//                                        invalid evidence 由 testing FAIL/retry。
//
// 边界（不得放宽）：
//   · provider **不产 verdict**——它只交出逐屏 must_fix/defects；「能否推进」唯一归 gate；
//   · provider **永不写 confirmed_by**——legacy 字段无质量权威；
//   · 合法载荷 = 可直接回修的 critic candidate，**不进** producer 感知信号的
//     defect-review；primary dispute 或缺复核没有否决权；
//   · 写入前**只清掉旧 provider 结果**——T8 转录与其它来源的 defect/must_fix 原样保留，
//     否则转录对账会被本机制误伤。
// ============================================================================

import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import type { CheckContext } from '../../../harness/scripts/utils/types';
import { featureDir } from '../../../harness/config';
import { loadUiSpecFile, uiSpecAbsPath } from '../../../harness/scripts/utils/ui-spec-shared';
import { isPixel1to1, loadSpecMarkdown } from '../../../harness/scripts/utils/fidelity-shared';
import { buildAuthoritativeRefImageIndex, resolveRefSourceImage } from './authoritative-ref-images';
import { readImageDimensions, referenceViewportIncompatible } from './image-toolkit';
import { canonicalOverlayBase } from './visual-diff-nav';
import { resolveActiveVisualProvider } from '../../../harness/scripts/utils/visual-provider-identity';
import {
  extractJsonObjectFromText,
  invokeVisualProvider,
  validateProviderIdentityEcho,
  writeVisualProviderInvokeEvent,
  type VisualProviderInvocation,
} from '../../../harness/scripts/utils/visual-provider-invoke';
import type { ProviderRef } from '../../../harness/scripts/utils/types';
import {
  type VisualDiffDefect,
  type VisualDiffScreenEntry,
} from './visual-diff-check';

export const VISUAL_PROVIDER_REVIEW_SCHEMA_VERSION = '1.0';

// ---------------------------------------------------------------------------
// 目标屏与输入装配
// ---------------------------------------------------------------------------

export interface ReviewTargetScreen {
  screen_id: string;
  /** 参考原图（工程内真实绝对路径） */
  refAbs: string;
  refHash: string;
  /** 实机截图（工程内真实绝对路径） */
  shotAbs: string;
  shotHash: string;
  /** ui-spec 目标节点摘要（优先级 + 屏级必备元素）——只给"该看什么"，不给结论 */
  priority?: string;
  mustHaveElements?: string[];
}

function sha16(abs: string): string | null {
  try {
    return createHash('sha256').update(fs.readFileSync(abs)).digest('hex').slice(0, 16);
  } catch {
    return null;
  }
}

export function visualDiffJsonPathFor(projectRoot: string, feature: string): string {
  return path.join(featureDir(projectRoot, feature), 'device-testing', 'device-screenshots', 'visual-diff.json');
}

/**
 * 从 visual-diff.json + ui-spec 装配目标屏集合。
 * 只收「参考图与实机截图**都在盘上**」的屏——缺图的屏本来就不是可评审对象
 * （缺屏是 capture 层的事实，由既有门禁承担，不该由 provider 代答）。
 */
export function collectReviewTargets(
  ctx: Pick<CheckContext, 'projectRoot' | 'feature' | 'specVisualSources'>,
  screens: VisualDiffScreenEntry[],
  /** plan b3d7e5a1 T5（codex P1）：回传因参考图/视口尺寸不兼容被排除的屏——调用方须复位其旧 provider 状态 */
  viewportOut?: { viewportIncompatibleIds: string[] },
): ReviewTargetScreen[] {
  const { projectRoot, feature } = ctx;
  const uiDoc = loadUiSpecFile(uiSpecAbsPath(projectRoot, feature));
  const byId = new Map((uiDoc?.screens ?? []).map(s => [s.id, s]));
  // 参考图解析走**既有权威解析链**（spec 的 visual_handoff.authoritative_refs / fidelity lock）：
  // capture 骨架写的是 `ref_id`（buildVisualDiffSkeletonEntry），**不是** ref_path——直接读
  // ref_path 会让真实轮次目标屏恒为空，provider 结构性不会被调用。
  const specMd = loadSpecMarkdown(projectRoot, feature);
  const refIndex = specMd ? buildAuthoritativeRefImageIndex(ctx as CheckContext, specMd) : null;
  // overlay 屏 id 归一化回落基屏——与 visual-diff-check 的 refIdFor 同一口径。
  const screenRefIds = new Map<string, string>();
  for (const sc of uiDoc?.screens ?? []) screenRefIds.set(sc.id, sc.ref_id ?? sc.id);
  const refIdFor = (s: VisualDiffScreenEntry): string =>
    screenRefIds.get(s.screen_id)
    ?? screenRefIds.get(canonicalOverlayBase(s.screen_id))
    ?? s.ref_id
    ?? canonicalOverlayBase(s.screen_id);

  const out: ReviewTargetScreen[] = [];
  for (const s of screens) {
    // `skipped` 屏**不进评审**：它是「本轮明确不评」的既有事实，把它评成 pass 等于把
    // skip 洗成干净通过（本仓反复付过代价的形态）。缺屏/不可达同理由既有门禁承担。
    if (s.verdict === 'skipped') continue;
    if (!s.screenshot_path) continue;
    const shotAbs = path.resolve(projectRoot, s.screenshot_path);
    // ref_path 显式在场时优先（部分消费者/历史产物带它）；否则按 ref_id 走权威解析。
    const refAbs = s.ref_path
      ? path.resolve(projectRoot, s.ref_path)
      : (refIndex ? resolveRefSourceImage(refIndex, refIdFor(s)).path : null);
    if (!refAbs) continue;
    if (!fs.existsSync(shotAbs) || !fs.existsSync(refAbs)) continue;
    // plan b3d7e5a1 T5（codex P1）：整页参考图不交给 delegated provider——与 check 侧前置门同一判据，
    // 该屏由 visual_reference_viewport 独立裁决，不在长图上产出 provider verdict/must_fix。
    if (referenceViewportIncompatible(readImageDimensions(refAbs), readImageDimensions(shotAbs))) {
      viewportOut?.viewportIncompatibleIds.push(s.screen_id);
      continue;
    }
    const shotHash = sha16(shotAbs);
    const refHash = sha16(refAbs);
    if (!shotHash || !refHash) continue;
    // plan ab072691 t5④（六轮返修 P0）：ui-spec 查找与严格 gate **同一口径**——先按 overlay
    // 归一化回基屏，再回落原 id。overlay 的 P0 与 `must_have_elements` 通常声明在基屏上；
    // 若这里查不到 spec，`priority` 为空 → 采信前的区域覆盖预检被跳过，严格 gate 才发现
    // 覆盖不全，造成一次无效评审。故在采信前使用与 gate 相同的 overlay 归一化口径。
    const spec = byId.get(canonicalOverlayBase(s.screen_id)) ?? byId.get(s.screen_id);
    out.push({
      screen_id: s.screen_id,
      refAbs,
      refHash,
      shotAbs,
      shotHash,
      ...(spec?.priority ? { priority: spec.priority } : {}),
      ...(spec?.must_have_elements?.length ? { mustHaveElements: [...spec.must_have_elements] } : {}),
    });
  }
  return out;
}

export interface ReviewPromptIdentity {
  runId?: string;
  attemptId?: string;
  /** pixel_1to1 硬契约：pass 屏须附 region_attest（既有 candidate-pass 要求，非新机制） */
  requireRegionAttest: boolean;
}

export function buildVisualProviderReviewPrompt(
  targets: ReviewTargetScreen[],
  identity: ReviewPromptIdentity,
): string {
  const allHashes = targets.flatMap(t => [t.refHash, t.shotHash]);
  const lines: string[] = [
    'You are a READ-ONLY visual reviewer. You cannot and must not modify anything in this project:',
    'no files, no artifacts, no gate outputs. You produce a review payload and nothing else.',
    '',
    'For EVERY screen listed below, compare the device screenshot against its reference image and',
    'enumerate the concrete rendering defects you can actually see. Then state the minimal fixes.',
    '',
    'Rules:',
    '- Cover EVERY screen exactly once. A missing or duplicated screen invalidates the whole payload.',
    '- An empty payload is NOT "no defects" — if you cannot review, say so by omitting the payload.',
    '- Do NOT produce a verdict, a score, or a pass/fail judgement. That is the gate\'s job, not yours.',
    '- Do NOT write legacy `confirmed_by` or claim human authority; only report machine observations.',
    '- Anchor every defect to the fixes: `must_fix_refs` holds indices into that screen\'s `must_fix`.',
    '',
    'Screens:',
  ];
  for (const t of targets) {
    lines.push(
      `- screen_id: ${t.screen_id}`,
      `  reference_image: ${t.refAbs}  (hash ${t.refHash})`,
      `  device_screenshot: ${t.shotAbs}  (hash ${t.shotHash})`,
      ...(t.priority ? [`  priority: ${t.priority}`] : []),
      ...(t.mustHaveElements ? [`  ui-spec required elements: ${t.mustHaveElements.join(', ')}`] : []),
    );
  }
  lines.push(
    '',
    'Reply with ONE JSON object and nothing else:',
    '{',
    `  "schema_version": "${VISUAL_PROVIDER_REVIEW_SCHEMA_VERSION}",`,
    ...(identity.runId ? [`  "run_id": "${identity.runId}",`] : []),
    ...(identity.attemptId ? [`  "attempt_id": "${identity.attemptId}",`] : []),
    `  "image_hashes": ${JSON.stringify(allHashes)},`,
    '  "screens": [',
    '    {',
    '      "screen_id": "<one of the ids above>",',
    '      "reference_image_hash": "<that screen\'s reference hash>",',
    '      "evaluated_screenshot_hash": "<that screen\'s screenshot hash>",',
    '      "must_fix": ["<minimal concrete fix>"],',
    '      "defects": [{"class": "clipping|overlap|shape_mismatch|missing_render|other",',
    '                   "severity": "blocker|major|minor", "element": "<optional id>",',
    '                   "note": "<what is wrong>", "must_fix_refs": [0]}]',
    ...(identity.requireRegionAttest
      ? [
          '      , "region_attest": [{"region": "<area you checked>", "verdict": "no_diff|diff_logged",',
          '                           "method": "vl_screening"}]',
          '      // region_attest is REQUIRED for any screen whose must_fix is empty (pixel contract).',
        ]
      : []),
    '    }',
    '  ]',
    '}',
  );
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 统一载荷校验（fail-closed）
// ---------------------------------------------------------------------------

export interface ReviewScreenPayload {
  screen_id: string;
  must_fix: string[];
  defects: VisualDiffDefect[];
  region_attest?: Array<{ region: string; verdict: 'no_diff' | 'diff_logged'; method: 'vl_screening' }>;
}

export type ReviewPayloadResult =
  | { ok: true; screens: ReviewScreenPayload[] }
  | { ok: false; reason: string };

const DEFECT_CLASSES = new Set(['clipping', 'overlap', 'shape_mismatch', 'missing_render', 'other']);
const DEFECT_SEVERITIES = new Set(['blocker', 'major', 'minor']);

/**
 * 逐项校验。任何一条不成立即整份拒收（**部分可用**不是一个选项：半份评审会让
 * 「未覆盖的屏」看起来像「没缺陷的屏」）。
 */
export function validateVisualProviderReviewPayload(
  body: string,
  expected: {
    targets: ReviewTargetScreen[];
    runId?: string;
    attemptId?: string;
    requireRegionAttest: boolean;
  },
): ReviewPayloadResult {
  const doc = extractJsonObjectFromText(body);
  if (!doc) return { ok: false, reason: '正文中没有可解析的 JSON 对象' };

  // 冻结 schema 版本必须逐字回显——协议升版后旧形态载荷一律不采信（schema-invalid 即无效）。
  if (doc.schema_version !== VISUAL_PROVIDER_REVIEW_SCHEMA_VERSION) {
    return {
      ok: false,
      reason: `schema_version 不符（期望 ${VISUAL_PROVIDER_REVIEW_SCHEMA_VERSION}，实际 ${String(doc.schema_version)}）`,
    };
  }

  const identityErr = validateProviderIdentityEcho(doc, {
    ...(expected.runId !== undefined ? { runId: expected.runId } : {}),
    ...(expected.attemptId !== undefined ? { attemptId: expected.attemptId } : {}),
    imageHashes: expected.targets.flatMap(t => [t.refHash, t.shotHash]),
  });
  if (identityErr) return { ok: false, reason: identityErr };

  const rawScreens = doc.screens;
  if (!Array.isArray(rawScreens) || rawScreens.length === 0) {
    // 空输出**绝不**等价「无缺陷」——本轮判未审查。
    return { ok: false, reason: 'screens 缺失或为空（空输出不等于无缺陷）' };
  }

  const byId = new Map(expected.targets.map(t => [t.screen_id, t]));
  const seen = new Set<string>();
  const out: ReviewScreenPayload[] = [];

  for (const raw of rawScreens) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false, reason: 'screens 条目不是对象' };
    }
    const row = raw as Record<string, unknown>;
    const screenId = typeof row.screen_id === 'string' ? row.screen_id.trim() : '';
    const target = byId.get(screenId);
    if (!target) return { ok: false, reason: `screens 含非目标屏：${screenId || '(空 screen_id)'}` };
    if (seen.has(screenId)) return { ok: false, reason: `screens 重复屏：${screenId}` };
    seen.add(screenId);

    if (row.reference_image_hash !== target.refHash) {
      return { ok: false, reason: `${screenId} 参考图 hash 不符（期望 ${target.refHash}）` };
    }
    if (row.evaluated_screenshot_hash !== target.shotHash) {
      return { ok: false, reason: `${screenId} 截图 hash 不符（期望 ${target.shotHash}）` };
    }

    const mustFixRaw = row.must_fix;
    if (!Array.isArray(mustFixRaw) || mustFixRaw.some(x => typeof x !== 'string' || !x.trim())) {
      return { ok: false, reason: `${screenId} must_fix 须为字符串数组（可为空数组）` };
    }
    const mustFix = (mustFixRaw as string[]).map(s => s.trim());

    const defectsRaw = row.defects;
    if (!Array.isArray(defectsRaw)) {
      return { ok: false, reason: `${screenId} defects 须为数组（可为空数组）` };
    }
    const defects: VisualDiffDefect[] = [];
    for (const d of defectsRaw) {
      if (!d || typeof d !== 'object' || Array.isArray(d)) {
        return { ok: false, reason: `${screenId} defects 条目不是对象` };
      }
      const dd = d as Record<string, unknown>;
      if (typeof dd.class !== 'string' || !DEFECT_CLASSES.has(dd.class)) {
        return { ok: false, reason: `${screenId} defect.class 非法：${String(dd.class)}` };
      }
      if (typeof dd.severity !== 'string' || !DEFECT_SEVERITIES.has(dd.severity)) {
        return { ok: false, reason: `${screenId} defect.severity 非法：${String(dd.severity)}` };
      }
      if (typeof dd.note !== 'string' || !dd.note.trim()) {
        return { ok: false, reason: `${screenId} defect.note 必填` };
      }
      let refs: number[] | undefined;
      if (dd.must_fix_refs !== undefined && dd.must_fix_refs !== null) {
        const r = dd.must_fix_refs;
        if (
          !Array.isArray(r) ||
          !r.every(n => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < mustFix.length)
        ) {
          return { ok: false, reason: `${screenId} defect.must_fix_refs 越界或非整数数组` };
        }
        refs = r as number[];
      }
      let bbox: number[] | undefined;
      if (dd.bbox !== undefined && dd.bbox !== null) {
        const b = dd.bbox;
        if (!Array.isArray(b) || b.length !== 4 || !b.every(n => typeof n === 'number' && n >= 0 && n <= 1)) {
          return { ok: false, reason: `${screenId} defect.bbox 须为 4 个 [0,1] 数` };
        }
        bbox = b as number[];
      }
      defects.push({
        class: dd.class as VisualDiffDefect['class'],
        severity: dd.severity as VisualDiffDefect['severity'],
        note: dd.note.trim(),
        ...(typeof dd.element === 'string' && dd.element.trim() ? { element: dd.element.trim() } : {}),
        ...(bbox ? { bbox } : {}),
        ...(refs ? { must_fix_refs: refs } : {}),
      });
    }

    // **每条 must_fix 都必须被本屏某个 defect 引用**。两个理由：
    //  ① 与既有 pixel P0 的 must_fix_refs 锚定要求同源（堵"条数凑平但错配"的 filler）；
    //  ② 清场靠 must_fix_refs 反查 provider 所属条目——未锚定的 provider must_fix
    //     下一轮识别不出来，会跨 attempt 残留。
    const anchored = new Set<number>();
    for (const d of defects) for (const i of d.must_fix_refs ?? []) anchored.add(i);
    const orphan = mustFix.map((_, i) => i).filter(i => !anchored.has(i));
    if (orphan.length > 0) {
      return {
        ok: false,
        reason: `${screenId} 有 ${orphan.length} 条 must_fix 未被任何 defect 的 must_fix_refs 锚定（下标 ${orphan.join(',')}）`,
      };
    }

    let regionAttest: ReviewScreenPayload['region_attest'];
    const attestRaw = row.region_attest;
    if (attestRaw !== undefined && attestRaw !== null) {
      if (!Array.isArray(attestRaw)) return { ok: false, reason: `${screenId} region_attest 须为数组` };
      const rows: NonNullable<ReviewScreenPayload['region_attest']> = [];
      for (const a of attestRaw) {
        if (!a || typeof a !== 'object' || Array.isArray(a)) {
          return { ok: false, reason: `${screenId} region_attest 条目不是对象` };
        }
        const aa = a as Record<string, unknown>;
        if (typeof aa.region !== 'string' || !aa.region.trim()) {
          return { ok: false, reason: `${screenId} region_attest.region 必填` };
        }
        if (aa.verdict !== 'no_diff' && aa.verdict !== 'diff_logged') {
          return { ok: false, reason: `${screenId} region_attest.verdict 非法：${String(aa.verdict)}` };
        }
        // provider 只能以 vl_screening 举证——paired_crop_compare 需要 crop 产物（写工程），
        // legacy human method 也不属于只读 provider 的机器证据。
        if (aa.method !== 'vl_screening') {
          return { ok: false, reason: `${screenId} region_attest.method 只接受 vl_screening` };
        }
        rows.push({ region: aa.region.trim(), verdict: aa.verdict, method: 'vl_screening' });
      }
      regionAttest = rows;
    }
    // ----------------------------------------------------------------------
    // plan ab072691 t5④（五轮返修 P0）：**pixel clean-pass 的举证要求在「采信前」就查**，
    // 与既有严格 gate 逐条同构。
    //
    // 不能留给严格 gate 事后查：本机制在采信后会清 `evaluation_invalidated` 并写下 pass +
    // 被评 hash；举证不全会平白制造一次无效轮次。把判据前移到采信关口：不合格即 invalid
    // → 标记保留 → 下一轮照常重评。
    // ----------------------------------------------------------------------
    const isCleanPassCandidate = mustFix.length === 0 && defects.length === 0;
    if (expected.requireRegionAttest && mustFix.length === 0 && (regionAttest?.length ?? 0) === 0) {
      return {
        ok: false,
        reason: `${screenId} 在 pixel 硬契约下 must_fix 为空却无 region_attest 举证`,
      };
    }
    if (expected.requireRegionAttest && isCleanPassCandidate && regionAttest) {
      // ① 逐区域覆盖：一条泛化 region 不能替代全部 must_have_elements（gate rev7 同款判据）。
      //    与 gate 一致只对 P0 屏要求——非 P0 屏 gate 本就不查，这里也不越权收紧。
      if (target.priority === 'P0') {
        const covered = new Set(regionAttest.map(a => a.region));
        const missing = (target.mustHaveElements ?? []).filter(e => !covered.has(e));
        if (missing.length > 0) {
          return {
            ok: false,
            reason:
              `${screenId} region_attest 未覆盖屏级 must_have_elements（缺 ` +
              `${missing.slice(0, 6).join('/')}${missing.length > 6 ? '…' : ''}）`,
          };
        }
      }
      // ② diff_logged 必须落账。clean pass 候选的 defects/must_fix 皆空，任何 diff_logged
      //    在结构上都无处锚定 = 知情不报，直接判 invalid。
      const orphan = regionAttest.filter(a => a.verdict === 'diff_logged').map(a => a.region);
      if (orphan.length > 0) {
        return {
          ok: false,
          reason: `${screenId} region_attest verdict=diff_logged 却无对应 defect/must_fix：${orphan.join(', ')}`,
        };
      }
    }

    out.push({ screen_id: screenId, must_fix: mustFix, defects, ...(regionAttest ? { region_attest: regionAttest } : {}) });
  }

  const missing = expected.targets.filter(t => !seen.has(t.screen_id)).map(t => t.screen_id);
  if (missing.length > 0) return { ok: false, reason: `漏屏：${missing.join(', ')}` };

  return { ok: true, screens: out };
}

// ---------------------------------------------------------------------------
// 写入：清旧 provider 结果 → 合并新载荷 → 原子覆盖
// ---------------------------------------------------------------------------

function isProviderDefect(d: VisualDiffDefect): boolean {
  return d.source?.producer === 'visual_provider';
}

/**
 * 清掉一屏里的旧 provider 结果，**保留其它来源**（T8 转录 / legacy 自报）。
 *
 * must_fix 没有自带 provenance，故用 `must_fix_refs` 反查：只删「仅被 provider defect
 * 引用」的条目，被其它来源也引用的一律保留；随后重排下标并重映射剩余 defect 的引用。
 */
export function clearProviderReviewFromScreen(entry: VisualDiffScreenEntry): void {
  // provider 的 region_attest **无条件**先清：上一轮可能是「零缺陷 + region_attest 举证」
  // 的干净通过（没有任何 provider defect），若按 defect 是否存在提前 return，那份举证
  // 会跨轮留存——正是「用旧结果制造 PASS」的形态。
  if (entry.region_attest) {
    const kept = entry.region_attest.filter(
      a => !(a.method === 'vl_screening' && typeof a.by === 'string' && a.by.startsWith('visual_provider:')),
    );
    entry.region_attest = kept.length > 0 ? kept : undefined;
  }
  const defects = entry.defects ?? [];
  const providerDefects = defects.filter(isProviderDefect);
  const others = defects.filter(d => !isProviderDefect(d));
  if (providerDefects.length === 0) return;

  const providerRefs = new Set<number>();
  for (const d of providerDefects) for (const i of d.must_fix_refs ?? []) providerRefs.add(i);
  const otherRefs = new Set<number>();
  for (const d of others) for (const i of d.must_fix_refs ?? []) otherRefs.add(i);

  const mustFix = entry.must_fix ?? [];
  const keep: number[] = [];
  for (let i = 0; i < mustFix.length; i++) {
    if (providerRefs.has(i) && !otherRefs.has(i)) continue;
    keep.push(i);
  }
  const remap = new Map(keep.map((oldIdx, newIdx) => [oldIdx, newIdx]));
  entry.must_fix = keep.map(i => mustFix[i]);
  entry.defects = others.map(d => ({
    ...d,
    ...(d.must_fix_refs
      ? { must_fix_refs: d.must_fix_refs.map(i => remap.get(i)).filter((n): n is number => n !== undefined) }
      : {}),
  }));
}

/**
 * plan ab072691 t5④（返修）：**delegated 轮次开工前的清场**——每次 review 调用**之前**
 * 对每个目标屏执行，落盘后再发起调用。
 *
 * 为什么不能"只在写入前清"：provider 本轮 unavailable/invalid 时不会走到写入，于是上一轮的
 * provider 缺陷、举证与由它派生的 verdict 会**原封不动跨 attempt 存活**，被 goal-runner
 * 的候选收集当成本轮事实重新物化——正是「不能用旧的结果制造 PASS / 驱动回修」要挡的。
 *
 * 一并复位 `verdict` 与 `evaluated_screenshot_hash`：delegated 轮次里逐屏 verdict **就是**
 * harness 依据 provider 输出算出来的（盲 primary 不得自报视觉裁决）。本轮尚未有被采信的
 * 评审，诚实状态就是 `pending`。legacy `confirmed_by` 字节保持不动但没有豁免权。
 */
export function resetDelegatedRoundState(
  entry: VisualDiffScreenEntry,
): void {
  clearProviderReviewFromScreen(entry);
  // 每一轮都丢弃旧 provider-derived verdict/hash；legacy confirmed_by 字节可保留但无豁免权。
  entry.verdict = 'pending';
  delete entry.evaluated_screenshot_hash;
  // `evaluation_invalidated` 的语义就是「这屏的旧评估产物不可信，等一次 fresh 重评」。
  // 既然本轮要重评，就把它点名不可信的那些产物一并丢掉——**但标记本身保留**，只有
  // 真正采信了一次合法重评才由 harness 删（见 applyProviderReviewToScreen）。
  if (entry.evaluation_invalidated === true) discardDistrustedEvaluationArtifacts(entry);
}

/**
 * plan ab072691 t5④（四轮返修 → 五轮订正）：丢弃 `evaluation_invalidated` 点名不可信的
 * 旧评估产物。
 *
 * 只丢**评估产物**，不碰采集身份（screenshot/build/run 指纹由 capture 机器盖戳，
 * 与「评估可不可信」正交），也不改 legacy `confirmed_by` 字节。
 *
 * **`region_attest` 全清，legacy `method:'human'` 也不例外**：
 *  · 既有规格说该标记的失效对象就包含**全部** region_attest；
 *  · `region_attest[].by` 是**可选自由字符串**，既不过 `isHumanVerified`、也不绑截图 hash，
 *    它不是当前机器证据，不能成为平行真源；
 *  · 保留旧条目会让「旧举证 + 新 provider 举证」拼接起来满足区域覆盖，直接削弱本机制
 *    要求的 fresh re-evaluation。
 * `confirmed_by` 仅作为 legacy provenance 原样保留，不参与质量结论。
 */
export function discardDistrustedEvaluationArtifacts(entry: VisualDiffScreenEntry): void {
  delete entry.fidelity_score;
  delete entry.geometric_iou;
  delete entry.reported_fidelity_score;
  delete entry.reported_geometric_iou;
  delete entry.region_attest;
}

/**
 * 把一屏的 provider 载荷合并进条目。**不产 verdict**：verdict 由既有 gate 依据
 * must_fix/defects 判定，本函数只交事实。
 */
export function applyProviderReviewToScreen(
  entry: VisualDiffScreenEntry,
  payload: ReviewScreenPayload,
  ctx: { invokeId: string; provider: ProviderRef; evaluatedScreenshotHash?: string },
): void {
  clearProviderReviewFromScreen(entry);
  const base = entry.must_fix ?? [];
  const offset = base.length;
  entry.must_fix = [...base, ...payload.must_fix];
  entry.defects = [
    ...(entry.defects ?? []),
    ...payload.defects.map(d => ({
      ...d,
      ...(d.must_fix_refs ? { must_fix_refs: d.must_fix_refs.map(i => i + offset) } : {}),
      source: { producer: 'visual_provider' as const, invoke_id: ctx.invokeId },
    })),
  ];
  if (payload.region_attest?.length) {
    entry.region_attest = [
      ...(entry.region_attest ?? []),
      ...payload.region_attest.map(a => ({
        ...a,
        by: `visual_provider:${ctx.provider.adapter}:${ctx.provider.model}`,
      })),
    ];
  }
  // ------------------------------------------------------------------------
  // 确定性 verdict 映射（plan ab072691 t5④）。
  //
  // **provider 不产 verdict**——它的载荷里根本没有 verdict 字段。这里是 **harness** 按
  // 一条写死的规则从事实推导：合并后 must_fix 为空 → `pass` **候选**；非空 → `fail`。
  // 「能否推进」仍然唯一归 gate：pass 候选还要过 defects 枚举、region_attest、critic
  // 回执与 pixel P0 机器证据等既有全要件，本函数一个门槛都没绕过。
  //
  // 同时盖上被评截图的 hash：既有可行动性判据要求
  // `evaluated_screenshot_hash` 等于盘上当前截图 hash，否则该屏的 must_fix 只会被记为
  // unverified 而不驱动回修。该值已在载荷校验里逐屏核对过，不是自报。
  //
  // legacy `confirmed_by` 字节不改，但 gate 不消费；provider 永远不写该字段。
  if (ctx.evaluatedScreenshotHash) entry.evaluated_screenshot_hash = ctx.evaluatedScreenshotHash;
  entry.verdict = (entry.must_fix?.length ?? 0) > 0 ? 'fail' : 'pass';
  // ------------------------------------------------------------------------
  // plan ab072691 t5④（四轮返修）：**harness 确定性清除 `evaluation_invalidated`**。
  //
  // 这不是「给 provider 一个清除权限」——provider 的载荷里没有、也不许有任何形如
  // `clear_invalidated` 的字段。状态转换权唯一归 harness：只有当一份载荷通过了全部既有
  // 校验（schema/全屏覆盖/身份回显/当前图片 hash/must_fix 全锚定）**并已成功应用到本屏**，
  // 才在这里删标记。provider unavailable/invalid/错身份/错 hash/漏屏/工作区变脏时根本走
  // 不到这一行，标记原样保留——不存在假清除。
  //
  // 该标记问的是「旧评估是否可信」，不是「UI 是否通过」：因此**无论本次映射为 pass 还是
  // fail 都清**。真发现缺陷时，新写入的 must_fix/defects 自然继续阻断并驱动回修。
  // 与 receipt 的关系要说准（六轮订正——此前这里写反了）：**`input_provenance` 的证据等级
  // 不决定是否采信**（受理与披露分立，零改动）；但**回执成功持久化是提交本轮评审结果的
  // 前置条件**——提交顺序见本函数调用方，写不出即整轮 `unusable`、标记保留。
  //
  // 不接通这一步会让 delegated 闭环永久阻断：被标记屏 → provider 每轮成功重评 →
  // 标记始终不清 →
  // `visual_diff_evaluation_invalidated` 档位无关 FAIL 永远挂着。
  delete entry.evaluation_invalidated;
}

/**
 * plan ab072691 t5④：delegated 形态的 critic 回执——**如实披露，不是物化门槛**。
 *
 * 只在「本轮确实有一份通过校验的 provider 载荷」时写；provider 不可用/载荷无效时
 * **什么都不写**（不覆盖、不伪造——没跑成的评审不该在盘上留下痕迹）。
 *
 * 字段全部取真实事实：adapter/model = provider 真身；`input_provenance` 取本次调用的
 * 验读证据等级（无解析器的 adapter 恒 unverified，这不影响载荷被采信）；
 * `runner_attestation.evidence_log_path` 指向 provider **自己**的调用证据流。
 *
 * 覆盖顺序：runner 在 agent invoke 之后可能已按 primary 写过一份回执；本函数在 gate 内
 * 稍后执行并覆盖它——delegated 轮次里"谁看了图"就是 provider，回执必须说实话。
 */
export function writeDelegatedCriticReceipt(input: {
  projectRoot: string;
  feature: string;
  provider: ProviderRef;
  invocation: VisualProviderInvocation;
  prompt: string;
  runId?: string;
  attemptId?: string;
  targets: ReviewTargetScreen[];
}): string | null {
  const { runId, attemptId } = input;
  // plan ab072691 t5④（返修）：**交互态也必须写回执**。
  // delegated 把 pixel_1to1 解钳后，candidate-pass 路径会强制要求一份结构合法回执；
  // 交互态若不写，就形成一个"结构上无法满足"的 BLOCKER FAIL——与「receipt 只披露、
  // 任何情况不造成 halt」的契约直接冲突。交互态没有 run/attempt 身份，用调用 id 作
  // critic_run_id（既有校验对非 goal 语境只要求非空），并**如实标 unverified**：
  // 既有校验本就不在交互态采信 verified，硬报 verified 只会白白换来一条降级 WARN。
  const inGoalContext = Boolean(runId && attemptId);
  const criticRunId = inGoalContext ? `${runId}-${attemptId}` : `interactive-${input.invocation.invoke_id}`;
  const provenance = inGoalContext ? input.invocation.input_provenance : 'unverified';
  const imageInputs = input.targets.flatMap(t => [
    { path: path.relative(input.projectRoot, t.refAbs).replace(/\\/g, '/'), hash: t.refHash },
    { path: path.relative(input.projectRoot, t.shotAbs).replace(/\\/g, '/'), hash: t.shotHash },
  ]);
  if (imageInputs.length === 0) return null;

  const evidencePath = input.invocation.events_path;
  let attestation: Record<string, unknown> | undefined;
  // attestation 只在 goal 语境下有意义（它绑定 goal_run_id）；交互态不写，避免造一个
  // 校验侧本就不会采信的空主张。
  if (inGoalContext && evidencePath && fs.existsSync(evidencePath)) {
    attestation = {
      goal_run_id: runId,
      evidence_log_path: path.relative(input.projectRoot, evidencePath).replace(/\\/g, '/'),
      evidence_log_hash: createHash('sha256').update(fs.readFileSync(evidencePath)).digest('hex').slice(0, 16),
      source: 'visual_provider_invoke',
    };
  }
  const receipt = {
    schema_version: '1.1',
    critic_run_id: criticRunId,
    adapter: input.provider.adapter,
    model: input.provider.model,
    prompt_hash: createHash('sha256').update(input.prompt, 'utf-8').digest('hex').slice(0, 16),
    input_provenance: provenance,
    image_inputs: imageInputs,
    ...(input.invocation.body
      ? { output_hash: createHash('sha256').update(input.invocation.body, 'utf-8').digest('hex').slice(0, 16) }
      : {}),
    ...(attestation ? { runner_attestation: attestation } : {}),
  };
  const abs = path.join(featureDir(input.projectRoot, input.feature), 'device-testing', 'reports', 'critic-receipt.json');
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(receipt, null, 2)}\n`, 'utf-8');
  fs.renameSync(tmp, abs);
  return abs;
}

/** 原子覆盖写回（tmp + rename）——半截 JSON 会让整轮门禁读到坏文件。 */
export function writeVisualDiffJsonAtomic(jsonPath: string, doc: unknown): void {
  const tmp = `${jsonPath}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`, 'utf-8');
  fs.renameSync(tmp, jsonPath);
}

// ---------------------------------------------------------------------------
// 编排入口（check-testing 在 capture 之后、严格 dispatch 之前显式 await 本函数）
// ---------------------------------------------------------------------------

export type VisualProviderReviewOutcome =
  /** 非 delegated / 无目标屏 —— 本机制整体不激活，调用方照常走既有严格 dispatch */
  | { kind: 'skipped'; reason: string }
  /** 合法载荷已写入 —— 调用方照常走既有严格 dispatch（此时屏已有 must_fix/defects） */
  | { kind: 'applied'; invocation: VisualProviderInvocation; screens: number }
  /** provider 不可用 / 载荷无效 —— 调用方不跑 provider-dependent dispatch，并按三分支投影 */
  | { kind: 'unusable'; outcome: 'unavailable' | 'invalid'; reason: string; invocation?: VisualProviderInvocation };

export interface RunVisualProviderReviewOptions {
  frameworkRoot: string;
  /** 本轮 run/attempt 身份（goal 态由 env 提供；交互态可缺省） */
  runId?: string;
  attemptId?: string;
  /** 测试注入缝：替换真实 invoke（生产路径恒用 invokeVisualProvider） */
  invoke?: typeof invokeVisualProvider;
  provider?: ProviderRef;
}

export async function runVisualProviderReview(
  ctx: CheckContext,
  opts: RunVisualProviderReviewOptions,
): Promise<VisualProviderReviewOutcome> {
  const provider = opts.provider ?? resolveActiveVisualProvider(ctx.projectRoot, opts.frameworkRoot).pin;
  if (!provider) return { kind: 'skipped', reason: '本 run 未配置只读视觉 provider（native/blind）' };

  const jsonPath = visualDiffJsonPathFor(ctx.projectRoot, ctx.feature);
  if (!fs.existsSync(jsonPath)) {
    return { kind: 'skipped', reason: 'visual-diff.json 不存在（capture 未产出）' };
  }
  let doc: { screens?: VisualDiffScreenEntry[] };
  try {
    doc = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as { screens?: VisualDiffScreenEntry[] };
  } catch (e) {
    // 坏文件由既有 schema 门禁处置——provider 不去修它，也不在坏文件上写东西。
    return { kind: 'skipped', reason: `visual-diff.json 解析失败：${(e as Error).message}` };
  }
  const screens = Array.isArray(doc.screens) ? doc.screens : [];
  const viewportOut = { viewportIncompatibleIds: [] as string[] };
  const targets = collectReviewTargets(ctx, screens, viewportOut);
  const viewportIncompatibleSet = new Set(viewportOut.viewportIncompatibleIds);
  if (targets.length === 0) {
    // plan b3d7e5a1 T5（codex P1）：全部屏都因长图被排除时也不能让旧 provider PASS/attest/defect 跨轮存活——
    // 早退前先把不兼容屏复位为 fresh pending 并落盘（与下面调用前清场同一语义）。
    if (viewportIncompatibleSet.size > 0) {
      for (const s of screens) if (viewportIncompatibleSet.has(s.screen_id)) resetDelegatedRoundState(s);
      writeVisualDiffJsonAtomic(jsonPath, doc);
    }
    return {
      kind: 'skipped',
      reason: viewportIncompatibleSet.size > 0
        ? `无可评审目标屏：${[...viewportIncompatibleSet].join(', ')} 参考图与视口尺寸不兼容（由 visual_reference_viewport 独立裁决，旧 provider 状态已复位）`
        : '无可评审目标屏（参考图/截图缺失由既有门禁承担）',
    };
  }

  const requireRegionAttest = isPixel1to1(ctx);
  const runId = opts.runId ?? process.env.MAISON_GOAL_RUN_ID?.trim() ?? undefined;
  const attemptId = opts.attemptId ?? process.env.MAISON_GOAL_ATTEMPT?.trim() ?? undefined;
  const invokeId = `review-${runId ?? 'local'}-${attemptId ?? 'na'}-${targets.length}`;
  const evidenceDir = path.join(
    featureDir(ctx.projectRoot, ctx.feature),
    'device-testing',
    'reports',
    'visual-review',
    invokeId,
  );

  // ------------------------------------------------------------------------
  // 调用**之前**清场并落盘：本轮尚未有被采信的评审，盘上就不该留着上一轮的 provider
  // 结果。这样 provider 随后 unavailable/invalid 时，跨 attempt 复用在结构上不可能发生。
  // ------------------------------------------------------------------------
  const targetIds = new Set(targets.map(t => t.screen_id));
  for (const s of screens) {
    if (targetIds.has(s.screen_id) || viewportIncompatibleSet.has(s.screen_id)) {
      // 目标屏与长图屏都复位：长图屏不评审，但旧 provider verdict/attest/defect 同样不得跨轮存活。
      resetDelegatedRoundState(s);
    }
    // 非目标屏也要清掉旧 provider 结果（它本轮同样没被评审），但不动其 verdict：
    // 那不是本机制写的（缺图/skipped 等由既有门禁裁决）。
    else clearProviderReviewFromScreen(s);
  }
  writeVisualDiffJsonAtomic(jsonPath, doc);

  const prompt = buildVisualProviderReviewPrompt(targets, {
    ...(runId ? { runId } : {}),
    ...(attemptId ? { attemptId } : {}),
    requireRegionAttest,
  });
  const invocation = await (opts.invoke ?? invokeVisualProvider)({
    projectRoot: ctx.projectRoot,
    frameworkRoot: opts.frameworkRoot,
    provider,
    purpose: 'review',
    prompt,
    imagePaths: targets.flatMap(t => [t.refAbs, t.shotAbs]),
    invokeId,
    evidenceDir,
  });
  // 成功与失败**同等**落一份调用事件（披露对称；不新建 ledger、不跨进程写 run 事件日志）。
  writeVisualProviderInvokeEvent(evidenceDir, invocation);

  if (invocation.outcome !== 'success' || !invocation.body) {
    return {
      kind: 'unusable',
      outcome: invocation.outcome === 'success' ? 'invalid' : invocation.outcome,
      reason: invocation.reason ?? 'provider 未产出可用正文',
      invocation,
    };
  }

  const parsed = validateVisualProviderReviewPayload(invocation.body, {
    targets,
    ...(runId ? { runId } : {}),
    ...(attemptId ? { attemptId } : {}),
    requireRegionAttest,
  });
  if (!parsed.ok) {
    // 载荷校验失败=本轮未审查。**丢弃**，不写盘、不改判、不停等。
    return { kind: 'unusable', outcome: 'invalid', reason: parsed.reason, invocation };
  }

  // 盘上此刻已是「清场后」状态（见上），这里只做本轮合法载荷的写入。
  const byId = new Map(screens.map(s => [s.screen_id, s]));
  const targetById = new Map(targets.map(t => [t.screen_id, t]));
  for (const p of parsed.screens) {
    const entry = byId.get(p.screen_id);
    if (!entry) continue;
    applyProviderReviewToScreen(entry, p, {
      invokeId,
      provider,
      ...(targetById.get(p.screen_id)?.shotHash
        ? { evaluatedScreenshotHash: targetById.get(p.screen_id)!.shotHash }
        : {}),
    });
  }
  // ------------------------------------------------------------------------
  // plan ab072691 t5④（五轮返修 P0）：**回执先落盘成功，再提交 visual-diff.json**。
  //
  // 上面对 `doc` 的修改此刻只在内存里。既有严格 gate 在任何 region_attest 在场时都要求一份
  // 结构合法回执；本机制采信后会清 `evaluation_invalidated`。回执写失败若仍提交 json，
  // 会留下“评估看似有效、证据提交失败”的不一致状态。
  //
  // 故提交顺序反过来：回执写成功才落 json。写不出即本轮按 `unusable` 处理，盘上停在
  // 调用前的清场态（标记仍在），下一轮照常重评。这**不是**把 receipt 升级成物化门槛——
  // 回执内容仍只作披露、`input_provenance` 仍只是证据等级；这里约束的只是**提交顺序**。
  // ------------------------------------------------------------------------
  let receiptPath: string | null = null;
  try {
    receiptPath = writeDelegatedCriticReceipt({
      projectRoot: ctx.projectRoot,
      feature: ctx.feature,
      provider,
      invocation,
      prompt,
      ...(runId ? { runId } : {}),
      ...(attemptId ? { attemptId } : {}),
      targets,
    });
  } catch (e) {
    return {
      kind: 'unusable',
      outcome: 'invalid',
      reason: `critic 回执未能持久化（${(e as Error).message}）——本轮不提交评审结果`,
      invocation,
    };
  }
  if (!receiptPath) {
    return {
      kind: 'unusable',
      outcome: 'invalid',
      reason: 'critic 回执未能持久化——本轮不提交评审结果',
      invocation,
    };
  }
  writeVisualDiffJsonAtomic(jsonPath, doc);
  return { kind: 'applied', invocation, screens: parsed.screens.length };
}
