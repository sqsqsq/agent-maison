// ============================================================================
// authoritative-ref-images.ts — visual_handoff authoritative_refs → 可达图片路径
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';
import { resolveAuthoritativePath, type ResolvedVisualPath } from '../../../harness/scripts/utils/visual-source-resolver';
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
  /** **对外形状冻结**：只含 reachable 的 id → 绝对路径（asset-acquisition 等多处依赖） */
  byId: Map<string, string>;
  /**
   * plan e7a2c4f1 §3.3（G12 确定 bug）：**已声明但当前不可达**的 id 的解析事实。
   * 旧实现在 `!agentReachable` 时直接 `continue`，于是"已声明但文件丢了"在下游变成
   * "引用未声明"——责任文件与该改哪一行全丢。这里只记事实、不放宽可达性判据，
   * 诊断复用 `ResolvedVisualPath` 已有的 `agentReachable / error / resolutionKind`。
   */
  unreachableById: Map<string, ResolvedVisualPath>;
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
  const unreachableById = new Map<string, ResolvedVisualPath>();
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
        const id = typeof r.id === 'string' ? r.id.trim() : '';
        if (!resolved.agentReachable || !resolved.resolvedAbsolute) {
          // 声明在案、文件不可达：记事实供诊断分类（byId 不收，可达性判据不变）
          if (id && !byId.has(id)) unreachableById.set(id, resolved);
          continue;
        }
        if (!firstReachable) firstReachable = resolved.resolvedAbsolute;
        if (id) {
          byId.set(id, resolved.resolvedAbsolute);
          unreachableById.delete(id);
        }
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

  return { byId, unreachableById, firstReachable, lockIdConflicts };
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

/**
 * note 的稳定前缀（消费方按前缀分类，不解析散文；前缀本身也进报告，人读一眼即知是哪一类）。
 */
export const REF_NOTE_MISSING_FILE = '[ref_missing_file]';
export const REF_NOTE_UNDECLARED = '[ref_undeclared]';

/** `[ref_undeclared]` 文案唯一出处（testing 期参考图解析与 spec 期 ref_id 对账共用） */
export function undeclaredRefNote(ref: string, declaredIds: readonly string[]): string {
  return (
    `${REF_NOTE_UNDECLARED} ref_id=${ref} 未在 spec.md 的 visual_handoff.authoritative_refs 声明` +
    `（spec.md 现有 id：${declaredIds.length > 0 ? declaredIds.slice(0, 8).join(', ') : '(无)'}）` +
    `——spec/ui-spec.yaml 的 screens[].ref_id 与 spec/spec.md 的 authoritative_refs[].id 须统一为同一套；` +
    '两边由 spec owner 改，框架不猜字符串对齐'
  );
}

/**
 * plan e7a2c4f1 §3.3：参考图引用解析。返回契约 `{path, note}` **冻结**（多处调用方依赖），
 * 只把 `note` 从一句"无 reachable 图片映射"升级成能定位责任文件与具体 id 的话：
 *  · 已声明但文件不可达 → 点名 spec.md 里该 id 的 `path` 与解析事实（`resolutionKind`/`error`）；
 *  · 根本没声明 → 点名 ui-spec.yaml 的 `ref_id` 与 spec.md 现有 id 清单（宿主三轮都卡在这条：
 *    四个 id 两边全不一致，报告却只说"原图缺失"，agent 一直在找图片文件）。
 */
export function resolveRefSourceImage(
  index: AuthoritativeRefImageIndex,
  sourceRef: string | undefined,
): { path: string | null; note?: string } {
  const ref = sourceRef?.trim();
  if (ref && index.byId.has(ref)) {
    return { path: index.byId.get(ref)! };
  }
  if (ref && index.unreachableById.has(ref)) {
    const r = index.unreachableById.get(ref)!;
    return {
      path: null,
      note:
        `${REF_NOTE_MISSING_FILE} ref_id=${ref} 已在 spec.md 的 visual_handoff.authoritative_refs 声明，但文件不可达` +
        `（path=${r.declared}；解析=${r.resolutionKind}${r.error ? `；${r.error}` : ''}）——补齐该文件或改 spec.md 里这一条的 path`,
    };
  }
  if (ref) {
    return { path: null, note: undeclaredRefNote(ref, [...index.byId.keys(), ...index.unreachableById.keys()]) };
  }
  if (index.firstReachable) {
    return {
      path: index.firstReachable,
      note: ref ? undefined : '未指定 source_ref，回退首张 authoritative_ref 图片',
    };
  }
  return { path: null, note: '无 reachable authoritative_ref 图片' };
}
