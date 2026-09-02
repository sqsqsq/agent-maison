// ============================================================================
// fidelity-snapshot-check.ts — 在线高保真快照谓词驱动离线校验（must-fix②）
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import type { CheckContext, CheckResult } from '../../../harness/scripts/utils/types';
import { relFeatureArtifact } from '../../../harness/config';
import { fidelityRatchetFailOrWarn } from '../../../harness/scripts/utils/fidelity-shared';
import {
  collectUiSpecScreenRefIds,
  hasFidelitySnapshotPromise,
  loadFidelityLock,
  parseOnlineVisualHandoff,
  resolveLockScreenPngAbs,
  resolveSnapshotDirFromHandoff,
} from '../../../harness/scripts/utils/fidelity-lock-shared';
import { loadUiSpecFile, parseVisualHandoffYamlRoot, uiSpecAbsPath } from '../../../harness/scripts/utils/ui-spec-shared';
import { buildAuthoritativeRefImageIndex, resolveRefSourceImage } from './authoritative-ref-images';
import { REFERENCE_VIEWPORT_ASPECT_TOLERANCE, readImageDimensions, referenceViewportIncompatible } from './image-toolkit';

function ruleDesc(ctx: CheckContext, id: string): string {
  const checks = ctx.phaseRule.structure_checks as Record<string, { description: string }>;
  return checks?.[id]?.description?.trim() ?? id;
}

export function checkFidelitySnapshotPromise(ctx: CheckContext, specMd: string): CheckResult[] {
  if (!hasFidelitySnapshotPromise(specMd)) {
    return [];
  }

  const desc = ruleDesc(ctx, 'fidelity_snapshot_promise');
  const specRel = relFeatureArtifact(ctx.projectRoot, ctx.feature, 'spec.md');
  const doc = parseVisualHandoffYamlRoot(specMd);
  const vh = doc?.visual_handoff as Record<string, unknown> | undefined;
  const online = parseOnlineVisualHandoff(vh);
  if (!online) {
    return [];
  }

  const cacheDir = resolveSnapshotDirFromHandoff(online.snapshot, ctx.projectRoot, ctx.feature);
  const lockPath = path.join(cacheDir, 'fidelity.lock.yaml');
  const lockRel = path.relative(ctx.projectRoot, lockPath).replace(/\\/g, '/');

  const { doc: lock, errors: lockErrors } = loadFidelityLock(lockPath);
  if (!lock) {
    const { severity, status } = fidelityRatchetFailOrWarn(ctx, false);
    return [{
      id: 'fidelity_snapshot_promise',
      category: 'structure',
      description: desc,
      severity,
      status,
      details: `已声明 source_link 承诺但快照不可用：${lockErrors.join('；')}`,
      suggestion: 'spec 阶段经宿主 MCP fetch_fidelity 导出到 _fidelity-cache/，或人工落盘 fidelity.lock.yaml + PNG 后重跑 harness',
      affected_files: [specRel, lockRel],
    }];
  }

  const structureErrors: string[] = [...lockErrors];
  if (online.source_link && lock.source_link && lock.source_link !== online.source_link) {
    structureErrors.push(`lock.source_link 与 spec 声明不一致（lock=${lock.source_link}）`);
  }

  const declaredScreens = collectUiSpecScreenRefIds(ctx.projectRoot, ctx.feature);
  const missingPng: string[] = [];
  const missingIds: string[] = [];

  for (const screenId of declaredScreens) {
    const entry = lock.screens.find(s => s.id === screenId);
    if (!entry) {
      missingIds.push(screenId);
      continue;
    }
    const abs = resolveLockScreenPngAbs(cacheDir, entry);
    if (!abs || !fs.existsSync(abs)) {
      missingPng.push(`${screenId}→${entry.png}`);
    }
  }

  const details: string[] = [];
  if (structureErrors.length) details.push(...structureErrors);
  if (missingIds.length) {
    details.push(`声明屏缺少 lock 条目：${missingIds.join(', ')}`);
  }
  if (missingPng.length) {
    details.push(`lock 条目 PNG 不可达：${missingPng.join('; ')}`);
  }

  const provenance = [
    `source_link=${online.source_link}`,
    lock.version_id ? `version_id=${lock.version_id}` : '',
    lock.content_hash ? `content_hash=${lock.content_hash}` : '',
    lock.fetched_at ? `fetched_at=${lock.fetched_at}` : '',
    lock.viewport ? `viewport=${lock.viewport.w}x${lock.viewport.h}${lock.viewport.dpr ? `@${lock.viewport.dpr}` : ''}` : '',
  ].filter(Boolean).join('；');

  if (details.length > 0) {
    const softMissingOnly = missingIds.length === 0 && missingPng.length === 0 && structureErrors.length > 0;
    const { severity, status } = fidelityRatchetFailOrWarn(ctx, softMissingOnly);
    return [{
      id: 'fidelity_snapshot_promise',
      category: 'structure',
      description: desc,
      severity,
      status,
      details: details.join('；'),
      suggestion: '重登宿主 MCP / 人工导出完整快照；pixel_1to1 下不齐即 BLOCKER',
      affected_files: [specRel, lockRel],
    }];
  }

  return [{
    id: 'fidelity_snapshot_promise',
    category: 'structure',
    description: desc,
    severity: 'BLOCKER',
    status: 'PASS',
    details: `快照承诺校验通过（${lock.screens.length} 屏）；${provenance}`,
    affected_files: [specRel, lockRel],
  }];
}

/** 供报告：解析 handoff 是否 fidelity_snapshot + 在线字段 */
export function summarizeOnlineFidelityHandoff(specMd: string): string | null {
  if (!hasFidelitySnapshotPromise(specMd)) return null;
  const doc = parseVisualHandoffYamlRoot(specMd);
  const vh = doc?.visual_handoff as Record<string, unknown> | undefined;
  const online = parseOnlineVisualHandoff(vh);
  if (!online) return null;
  const kind = typeof vh?.kind === 'string' ? vh.kind : '';
  return `kind=${kind} source_link=${online.source_link}${online.snapshot ? ` snapshot=${online.snapshot}` : ''}`;
}

/**
 * plan b3d7e5a1 T5（spec 阶段）：参考图与 lock.viewport 的尺寸兼容性前置门。
 * - 无在线 handoff / 无 lock：viewport 无处可取，零结果（lock 缺失本身由 fidelity_snapshot_promise 裁决；
 *   testing 会用实测截图尺寸再判一次）；
 * - lock 未声明 viewport：WARN 明示推迟到 testing，不 PASS-by-silence；
 * - 不兼容屏：pixel_1to1 → BLOCKER FAIL，低档 → 既有 ratchet WARN；全部兼容 → 零结果（check 集合逐字不变）。
 * 出路由作者建模：长页拆成多个 viewport 尺寸的 screen（各自 ref_id + nav 末步 scroll_to 锚点）；不建 reference_region/crop/自动分段体系。
 */
export function checkReferenceViewportSpec(ctx: CheckContext, specMd: string): CheckResult[] {
  const doc = parseVisualHandoffYamlRoot(specMd);
  const vh = doc?.visual_handoff as Record<string, unknown> | undefined;
  const online = parseOnlineVisualHandoff(vh);
  if (!online) return [];
  const cacheDir = resolveSnapshotDirFromHandoff(online.snapshot, ctx.projectRoot, ctx.feature);
  const { doc: lock } = loadFidelityLock(path.join(cacheDir, 'fidelity.lock.yaml'));
  if (!lock) return [];
  const uiDoc = loadUiSpecFile(uiSpecAbsPath(ctx.projectRoot, ctx.feature));
  const screens = uiDoc?.screens ?? [];
  if (screens.length === 0) return [];

  const id = 'visual_reference_viewport';
  const description = '参考图与设备视口尺寸兼容性前置门（plan b3d7e5a1 T5）';
  const specRel = relFeatureArtifact(ctx.projectRoot, ctx.feature, 'spec.md');
  const remedy =
    '责任在 spec 参考资产。出路由作者建模而非机器推导：长页按锚点拆成多个 screen，每段一个 viewport 尺寸的 ref_id 裁图，visual-diff-nav.json 中该段 nav 末步 scroll_to 锚点元素（选对齐确定的元素，如列表项；nav 校验复用 planned-step 全键表，scroll_to 本就合法）；像素路径前提：每段 nav 从已知状态出发且滚动落点已证明可重复（宿主至少两个冷启动轮次的中/尾 checkpoint 落点一致），否则继续 FAIL 而不宣称支持；不属像素范围的段落排除在 pixel_1to1 屏之外、由功能/结构 AC 覆盖——没有屏级/段级 fidelity 档位。' +
    '每屏参考图兼容后现有 visual pipeline 原样运行；不做自动 crop/分段/拼接，也不按参考图改写 viewport。';
  if (!lock.viewport) {
    return [{
      id,
      category: 'structure',
      description,
      severity: 'MAJOR',
      status: 'WARN',
      details: 'fidelity.lock.yaml 未声明 viewport，spec 阶段无法比对参考图尺寸；该校验推迟到 testing 用实测截图尺寸执行。',
      suggestion: '在 lock 中补 viewport{w,h}（导出快照的设备视口），或接受 testing 阶段再判。',
      affected_files: [specRel],
    }];
  }
  const refIndex = buildAuthoritativeRefImageIndex(ctx, specMd);
  const viewport = { w: lock.viewport.w, h: lock.viewport.h };
  const incompatible: string[] = [];
  for (const sc of screens) {
    const refAbs = resolveRefSourceImage(refIndex, sc.ref_id ?? sc.id).path;
    if (!refAbs) continue;
    const dims = readImageDimensions(refAbs);
    if (referenceViewportIncompatible(dims, viewport)) {
      incompatible.push(`${sc.id}: 参考图 ${dims!.w}×${dims!.h} vs lock.viewport ${viewport.w}×${viewport.h}`);
    }
  }
  if (incompatible.length === 0) return [];
  const ratchet = fidelityRatchetFailOrWarn(ctx, true);
  return [{
    id,
    category: 'structure',
    description,
    severity: ratchet.severity,
    status: ratchet.status,
    details:
      `以下 ${incompatible.length} 屏的参考图高宽比超出 lock.viewport ×${REFERENCE_VIEWPORT_ASPECT_TOLERANCE}（整页拼接图 vs 单视口），` +
      `不构成合法像素参考：${incompatible.join('；')}`,
    suggestion: remedy,
    affected_files: [specRel],
  }];
}
