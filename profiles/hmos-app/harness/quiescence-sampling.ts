// ============================================================================
// quiescence-sampling.ts — t4a（plan f7a3d9c2）：静稳采样（quiescence sampling）
// observe-only 共享采样器。
//
// 协议（rev5 双 dump，codex 阻断修正）：shot₁ → dump₁ → dump₂ → shot₂。
// 双稳判据：
//   图像稳 = shot₁/shot₂ 的 **app 窗口裁剪区** hash 一致（appRect 来自 dump，裁掉状态栏
//            /系统区——整图字节恒等在真机上几乎恒假：状态栏时钟/电池/信号秒级变化）；
//            两 shot 括住两次 dump，图像稳定即覆盖整个 dump 窗口；
//   布局稳 = dump₁/dump₂ 的规范化布局签名相等，且 appRoot/screen identity 一致。
// 任一不稳 → 重试整组（默认 2 次）；仍不稳 → unstable + unstable_reason 记录。
// dump₂ 为 T8 消费的最终 dump、shot₂ 为最终截图。
//
// 【消费方（t4b 已启用，2026-07-11 真机数据回填后）】①正式 testing 采集链——
// visual-diff-capture acquireScreenArtifacts，`quiescenceSampling` **仅 pixel_1to1 装配**
// （check-testing 与 layoutDumpFn 同守卫；低档保持单 shot 单 dump，t6b 守恒）；
// ②t5 校准 CLI（⑨双拍稳定性实测）。unstable 降档走独立 id
// visual_diff_layout_invariants_unstable（不进 candidate-blocking、免转录）。
//
// 已知残余局限（如实记录，不宣称原子采样）：A→B→A 状态往返、裁剪区外变化影响布局的
// 边角情形——静稳是**启发式**。
// ============================================================================

import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { parseHypiumDump, type LayoutNode, type ParsedLayoutDump, type LayoutRect } from './layout-oracle-check';
import { cropAssetFromBbox, isJimpAvailable } from './image-toolkit';

export const QUIESCENCE_DEFAULT_RETRIES = 2;

export type QuiescenceUnstableReason = 'image_drift' | 'layout_drift' | 'approot_drift' | 'both';

export interface QuiescenceAttemptRecord {
  attempt: number;
  at: string;
  shot1_full_hash: string | null;
  shot2_full_hash: string | null;
  /** app 裁剪区 hash（jimp 可用且 dump 给出 appRect 时；否则 null → 退回整图并注记） */
  shot1_crop_hash: string | null;
  shot2_crop_hash: string | null;
  layout1_signature: string | null;
  layout2_signature: string | null;
  approot1_identity: string | null;
  approot2_identity: string | null;
  image_stable: boolean;
  layout_stable: boolean;
  approot_stable: boolean;
  /** 图像判据实际用的口径（t5⑨ 三口径稳定率统计的分母标注） */
  image_criterion: 'app_crop' | 'full_frame';
}

export interface QuiescenceSampleResult {
  stable: boolean;
  attempts: number;
  unstable_reason?: QuiescenceUnstableReason;
  /** 最终产物（shot₂/dump₂ 的落盘路径；unstable 时同样保留供降档消费） */
  final_shot_abs: string;
  final_dump_abs: string;
  records: QuiescenceAttemptRecord[];
  /** 采样器自身失败（截图/dump 执行失败）——与 unstable（判据不稳）区分 */
  error?: string;
}

export interface QuiescenceSampleFns {
  /** 截图执行器（写 destAbs） */
  screenshotFn: (destAbs: string) => { ok: boolean; error?: string };
  /** 布局树 dump 执行器（写 destAbs，hypium-ui-dump-v1） */
  layoutDumpFn: (destAbs: string) => { ok: boolean; error?: string };
  now?: () => string;
}

function sha256File16(absPath: string): string | null {
  if (!fs.existsSync(absPath)) return null;
  try {
    return createHash('sha256').update(fs.readFileSync(absPath)).digest('hex').slice(0, 16);
  } catch {
    return null;
  }
}

/** 节点规范化序列化（type/id/key/clickable/bounds，递归；文本不参与——文本闪变≠布局漂移） */
function serializeNode(n: LayoutNode): unknown {
  return {
    t: n.type,
    i: n.id,
    k: n.key,
    c: n.clickable,
    b: n.bounds ? [n.bounds.x1, n.bounds.y1, n.bounds.x2, n.bounds.y2] : null,
    ch: n.children.map(serializeNode),
  };
}

/** t4：规范化布局签名——dump 树（type/id/bounds 结构）的稳定 hash */
export function normalizedLayoutSignature(dump: ParsedLayoutDump): string {
  return createHash('sha256').update(JSON.stringify(serializeNode(dump.root))).digest('hex').slice(0, 16);
}

/** appRoot/screen identity——两 dump 须选中同一 app 子树（防 approot 漂移下的假布局稳） */
export function approotIdentity(dump: ParsedLayoutDump): string {
  const r = dump.appRect;
  return `${dump.appRoot.type}:[${r.x1},${r.y1},${r.x2},${r.y2}]|screen:[${dump.screenRect.x1},${dump.screenRect.y1},${dump.screenRect.x2},${dump.screenRect.y2}]`;
}

/** screenRect 内的 appRect → 归一化 [x,y,w,h]（jimp crop 的 bbox 口径） */
export function appRectToNormBBox(appRect: LayoutRect, screenRect: LayoutRect): [number, number, number, number] {
  const sw = Math.max(1, screenRect.x2 - screenRect.x1);
  const sh = Math.max(1, screenRect.y2 - screenRect.y1);
  return [
    (appRect.x1 - screenRect.x1) / sw,
    (appRect.y1 - screenRect.y1) / sh,
    (appRect.x2 - appRect.x1) / sw,
    (appRect.y2 - appRect.y1) / sh,
  ];
}

/** app 裁剪区 hash：jimp crop（padding=0，无宽松框）→ sha256；jimp 不可用/失败 → null */
export function hashAppCrop(
  shotAbs: string,
  appRect: LayoutRect,
  screenRect: LayoutRect,
): string | null {
  if (!isJimpAvailable()) return null;
  const outAbs = `${shotAbs}.appcrop.tmp.png`;
  try {
    const res = cropAssetFromBbox(shotAbs, appRectToNormBBox(appRect, screenRect), outAbs, 0);
    if (!res.ok) return null;
    return sha256File16(outAbs);
  } finally {
    try {
      if (fs.existsSync(outAbs)) fs.unlinkSync(outAbs);
    } catch { /* 清理失败不影响判据 */ }
  }
}

function loadDump(absPath: string): ParsedLayoutDump | null {
  if (!fs.existsSync(absPath)) return null;
  try {
    return parseHypiumDump(JSON.parse(fs.readFileSync(absPath, 'utf-8')));
  } catch {
    return null;
  }
}

/**
 * 静稳采样主入口。probe*（shot₁/dump₁）与 final*（shot₂/dump₂）由调用方给路径——
 * final 即正式产物落点，unstable 时保留最后一组（降档由消费方按 layout_dump_status 处置）。
 */
export function sampleQuiescent(input: {
  probeShotAbs: string;
  probeDumpAbs: string;
  finalShotAbs: string;
  finalDumpAbs: string;
  fns: QuiescenceSampleFns;
  retries?: number;
}): QuiescenceSampleResult {
  const retries = input.retries ?? QUIESCENCE_DEFAULT_RETRIES;
  const now = input.fns.now ?? (() => new Date().toISOString());
  const records: QuiescenceAttemptRecord[] = [];
  fs.mkdirSync(path.dirname(input.finalShotAbs), { recursive: true });
  fs.mkdirSync(path.dirname(input.finalDumpAbs), { recursive: true });

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    // shot₁ → dump₁ → dump₂ → shot₂（两 shot 括住两 dump）
    const s1 = input.fns.screenshotFn(input.probeShotAbs);
    if (!s1.ok) {
      return failResult(`shot₁ 失败${s1.error ? `：${s1.error}` : ''}`, input, attempt, records);
    }
    const d1 = input.fns.layoutDumpFn(input.probeDumpAbs);
    if (!d1.ok) {
      return failResult(`dump₁ 失败${d1.error ? `：${d1.error}` : ''}`, input, attempt, records);
    }
    const d2 = input.fns.layoutDumpFn(input.finalDumpAbs);
    if (!d2.ok) {
      return failResult(`dump₂ 失败${d2.error ? `：${d2.error}` : ''}`, input, attempt, records);
    }
    const s2 = input.fns.screenshotFn(input.finalShotAbs);
    if (!s2.ok) {
      return failResult(`shot₂ 失败${s2.error ? `：${s2.error}` : ''}`, input, attempt, records);
    }

    const dump1 = loadDump(input.probeDumpAbs);
    const dump2 = loadDump(input.finalDumpAbs);
    // review-fix（codex P1-6）：dump 执行成功但**不可解析**（损坏/schema 不符）是采集失败，
    // 不是"时序不稳"——误归 unstable 会让坏 dump 走降档继续 candidate 路径。
    if (!dump1 || !dump2) {
      return failResult(
        `dump 不可解析（损坏/schema 不符：${!dump1 ? 'dump₁' : ''}${!dump1 && !dump2 ? '、' : ''}${!dump2 ? 'dump₂' : ''}）`,
        input,
        attempt,
        records,
      );
    }
    const layout1 = dump1 ? normalizedLayoutSignature(dump1) : null;
    const layout2 = dump2 ? normalizedLayoutSignature(dump2) : null;
    const approot1 = dump1 ? approotIdentity(dump1) : null;
    const approot2 = dump2 ? approotIdentity(dump2) : null;

    const fullHash1 = sha256File16(input.probeShotAbs);
    const fullHash2 = sha256File16(input.finalShotAbs);
    // app 裁剪区判据（dump₂ 的 appRect 为准）；jimp/appRect 不可得 → 退回整图（口径注记）
    const crop1 = dump2 ? hashAppCrop(input.probeShotAbs, dump2.appRect, dump2.screenRect) : null;
    const crop2 = dump2 ? hashAppCrop(input.finalShotAbs, dump2.appRect, dump2.screenRect) : null;
    const imageCriterion: 'app_crop' | 'full_frame' = crop1 !== null && crop2 !== null ? 'app_crop' : 'full_frame';
    const imageStable =
      imageCriterion === 'app_crop'
        ? crop1 !== null && crop1 === crop2
        : fullHash1 !== null && fullHash1 === fullHash2;
    const layoutStable = layout1 !== null && layout1 === layout2;
    const approotStable = approot1 !== null && approot1 === approot2;

    records.push({
      attempt,
      at: now(),
      shot1_full_hash: fullHash1,
      shot2_full_hash: fullHash2,
      shot1_crop_hash: crop1,
      shot2_crop_hash: crop2,
      layout1_signature: layout1,
      layout2_signature: layout2,
      approot1_identity: approot1,
      approot2_identity: approot2,
      image_stable: imageStable,
      layout_stable: layoutStable,
      approot_stable: approotStable,
      image_criterion: imageCriterion,
    });

    if (imageStable && layoutStable && approotStable) {
      return {
        stable: true,
        attempts: attempt,
        final_shot_abs: input.finalShotAbs,
        final_dump_abs: input.finalDumpAbs,
        records,
      };
    }
  }

  const last = records[records.length - 1];
  let reason: QuiescenceUnstableReason;
  if (last && !last.approot_stable) reason = 'approot_drift';
  else if (last && !last.image_stable && !last.layout_stable) reason = 'both';
  else if (last && !last.image_stable) reason = 'image_drift';
  else reason = 'layout_drift';
  return {
    stable: false,
    attempts: records.length,
    unstable_reason: reason,
    final_shot_abs: input.finalShotAbs,
    final_dump_abs: input.finalDumpAbs,
    records,
  };
}

function failResult(
  error: string,
  input: { finalShotAbs: string; finalDumpAbs: string },
  attempts: number,
  records: QuiescenceAttemptRecord[],
): QuiescenceSampleResult {
  return {
    stable: false,
    attempts,
    final_shot_abs: input.finalShotAbs,
    final_dump_abs: input.finalDumpAbs,
    records,
    error,
  };
}
