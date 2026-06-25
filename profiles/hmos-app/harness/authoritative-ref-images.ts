// ============================================================================
// authoritative-ref-images.ts — visual_handoff authoritative_refs → 可达图片路径
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';
import { resolveAuthoritativePath } from '../../../harness/scripts/utils/visual-source-resolver';
import { extractCodeBlocks } from '../../../harness/scripts/utils/markdown-parser';
import {
  FIDELITY_SNAPSHOT_KIND,
  fidelityLockAbsPath,
  loadFidelityLock,
  mergeLockScreensIntoById,
  parseOnlineVisualHandoff,
  resolveSnapshotDirFromHandoff,
  type FidelityLockDoc,
} from '../../../harness/scripts/utils/fidelity-lock-shared';
import type { CheckContext, CheckResult } from '../../../harness/scripts/utils/types';

const requireHarness = createRequire(path.resolve(__dirname, '../../../harness/harness-runner.ts'));
const YAML = requireHarness('yaml') as { parse: (s: string) => unknown };

export interface AuthoritativeRefImageIndex {
  byId: Map<string, string>;
  /** 第一个 reachable 图片（无 source_ref 时的显式 fallback） */
  firstReachable: string | null;
  /** lock 与 yaml authoritative_refs 同 id 冲突（lock 已胜出） */
  lockIdConflicts: string[];
}

interface PendingLock {
  cacheDir: string;
  lock: FidelityLockDoc;
}

function firstReachableFromLock(cacheDir: string, lock: FidelityLockDoc): string | null {
  for (const s of lock.screens) {
    const abs = path.isAbsolute(s.png) ? s.png : path.resolve(cacheDir, s.png);
    if (fs.existsSync(abs)) return abs;
  }
  return null;
}

export function buildAuthoritativeRefImageIndex(
  ctx: CheckContext,
  specMd: string,
): AuthoritativeRefImageIndex {
  const byId = new Map<string, string>();
  let firstReachable: string | null = null;
  const lockIdConflicts: string[] = [];
  const pendingLocks: PendingLock[] = [];
  let inlineSnapshotLockLoaded = false;

  for (const b of extractCodeBlocks(specMd, 'yaml')) {
    try {
      const doc = YAML.parse(b.content) as Record<string, unknown>;
      const vh = doc?.visual_handoff as Record<string, unknown> | undefined;
      if (!vh || typeof vh !== 'object') continue;

      const kind = typeof vh.kind === 'string' ? vh.kind.trim() : '';

      if (kind === FIDELITY_SNAPSHOT_KIND) {
        const online = parseOnlineVisualHandoff(vh);
        const cacheDir = resolveSnapshotDirFromHandoff(
          online?.snapshot,
          ctx.projectRoot,
          ctx.feature,
        );
        const lockPath = path.join(cacheDir, 'fidelity.lock.yaml');
        const { doc: lock } = loadFidelityLock(lockPath);
        if (lock) {
          pendingLocks.push({ cacheDir, lock });
          inlineSnapshotLockLoaded = true;
        }
        continue;
      }

      const refs = vh.authoritative_refs as Array<{ id?: string; path?: string }> | undefined;
      if (!Array.isArray(refs)) continue;
      for (const r of refs) {
        if (typeof r.path !== 'string' || !/\.(png|jpe?g|webp)$/i.test(r.path)) continue;
        const resolved = resolveAuthoritativePath(r.path, {
          projectRoot: ctx.projectRoot,
          externalRoots: ctx.specVisualSources?.external_roots,
          allowAbsolutePaths: Boolean(ctx.specVisualSources?.allow_absolute_paths),
          allowNetworkPaths: Boolean(ctx.specVisualSources?.allow_network_paths),
        });
        if (!resolved.agentReachable || !resolved.resolvedAbsolute) continue;
        if (!firstReachable) firstReachable = resolved.resolvedAbsolute;
        const id = typeof r.id === 'string' ? r.id.trim() : '';
        if (id) byId.set(id, resolved.resolvedAbsolute);
      }
    } catch { /* skip block */ }
  }

  // 方案 a：无 inline fidelity_snapshot lock 时尝试默认 cache
  if (!inlineSnapshotLockLoaded) {
    const defaultLock = loadFidelityLock(fidelityLockAbsPath(ctx.projectRoot, ctx.feature));
    if (defaultLock.doc) {
      pendingLocks.push({
        cacheDir: path.dirname(fidelityLockAbsPath(ctx.projectRoot, ctx.feature)),
        lock: defaultLock.doc,
      });
    }
  }

  // lock 统一在 refs 之后 merge，保证 lock 胜且 conflict 可检测（与 yaml 块顺序无关）
  for (const { cacheDir, lock } of pendingLocks) {
    const { conflicts, merged } = mergeLockScreensIntoById(byId, cacheDir, lock);
    lockIdConflicts.push(...conflicts);
    if (!firstReachable && merged > 0) {
      firstReachable = firstReachableFromLock(cacheDir, lock);
    }
  }

  return { byId, firstReachable, lockIdConflicts };
}

/** lock 与 authoritative_refs 同 id 冲突时 WARN（lock 已胜出） */
export function checkAuthoritativeRefLockConflicts(ctx: CheckContext, specMd: string): CheckResult[] {
  const checks = ctx.phaseRule.structure_checks as Record<string, { description: string }>;
  const desc = checks?.authoritative_ref_lock_conflict?.description?.trim()
    ?? '在线高保真 lock 与 authoritative_refs 同 id 路径冲突（lock 已胜出）';
  const index = buildAuthoritativeRefImageIndex(ctx, specMd);
  if (index.lockIdConflicts.length === 0) {
    return [];
  }
  return [{
    id: 'authoritative_ref_lock_conflict',
    category: 'structure',
    description: desc,
    severity: 'MAJOR',
    status: 'WARN',
    details: `id 冲突：${index.lockIdConflicts.join(', ')}；请移除 spec 中重复的 authoritative_refs 或改用不同 id`,
    affected_files: [],
  }];
}

export function resolveRefSourceImage(
  index: AuthoritativeRefImageIndex,
  sourceRef: string | undefined,
): { path: string | null; note?: string } {
  const ref = sourceRef?.trim();
  if (ref && index.byId.has(ref)) {
    return { path: index.byId.get(ref)! };
  }
  if (ref && !index.byId.has(ref)) {
    return { path: null, note: `source_ref=${ref} 无 reachable 图片映射` };
  }
  if (index.firstReachable) {
    return {
      path: index.firstReachable,
      note: ref ? undefined : '未指定 source_ref，回退首张 authoritative_ref 图片',
    };
  }
  return { path: null, note: '无 reachable authoritative_ref 图片' };
}
