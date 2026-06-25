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
import { parseVisualHandoffYamlRoot } from '../../../harness/scripts/utils/ui-spec-shared';

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
