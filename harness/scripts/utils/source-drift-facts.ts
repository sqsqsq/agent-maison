// ============================================================================
// source-drift-facts.ts — 源码漂移事实的两个 provider（plan a5f9c3e2 t1③）
// ----------------------------------------------------------------------------
// 普通模式与 goal 模式**允许不同采集器**（前者 trace.start_commit 的 git diff，后者
// review closure attestation 对账），但必须归一成同一 `SourceDriftFacts`：
// canonical 三元组（added/modified/deleted）逐字段相等，`provenance` / `baseline_kind`
// 是来源标注、不入等值断言。
//
// 正确的复用是「两个 provider 产出同一种事实」，**不是强删其中一个数据源**。
// 本模块只做 I/O + 归一，不产动作、不产话术——裁决在 adjudication.decide()。
// ============================================================================

import { diffChangedFiles, diffChangedFilesWithStatus } from './git-diff';
import { loadReviewClosureAttestation, reconcileSourceTreeAgainstAttestation } from './closure-attestation';
import { canonicalizeSourceDrift, type SourceDriftFacts } from './adjudication';

export interface ClosureDriftFactsResult {
  facts: SourceDriftFacts;
  /** review closure inventory 聚合 hash——授权 receipt 的 source_inventory_before 锚点 */
  inventoryHash: string | null;
  /** 零漂移（调用方直接 PASS，不进裁决） */
  clean: boolean;
}

/**
 * goal 模式 provider：review closure attestation 基线对账。
 * 只裁决 review 后漂移——coding 阶段合法实现不在裁决域。
 * 返回 null = 基线不可用（调用方按 fail-closed 处置，不得回退到别的基线冒充）。
 */
export function driftFactsFromClosureAttestation(
  projectRoot: string,
  feature: string,
): ClosureDriftFactsResult | null {
  const att = loadReviewClosureAttestation(projectRoot, feature);
  if (!att) return null;
  const rec = reconcileSourceTreeAgainstAttestation(projectRoot, att);
  return {
    facts: canonicalizeSourceDrift({
      added: rec.added,
      modified: rec.modified,
      deleted: rec.deleted,
      provenance: `review-closure-attestation:${feature}`,
      baseline_kind: 'review_closure_attestation',
    }),
    inventoryHash: att.inventory.aggregate_sha256 ?? null,
    clean: rec.ok,
  };
}

/**
 * 普通（direct）模式 provider：trace.start_commit / HARNESS_DIFF_BASE_REF 起算的 git diff。
 *
 * **集合口径与改造前逐字等值**——`files` 由调用方传入既有 `diffChangedFiles` +
 * protected-prefix 过滤后的结果，本函数只负责**分区**（不增删任何条目）：
 *   untracked → added；status diff 命中 A/D → added/deleted；其余 → modified。
 * 拿不到 status（非 git / baseRef 不可达）时全部归 modified：集合不变、分类保守。
 */
export function partitionDriftByGitStatus(args: {
  projectRoot: string;
  baseRef?: string;
  /** 已过滤的业务变更文件全集（POSIX 归一）——本函数不得增删其中任何条目 */
  files: readonly string[];
  /** 既有 diffChangedFiles().untrackedFiles（同样已过滤） */
  untrackedFiles?: readonly string[];
  provenance: string;
}): SourceDriftFacts {
  const norm = (p: string): string => p.replace(/\\/g, '/').trim();
  const all = new Set(args.files.map(norm));
  const untracked = new Set((args.untrackedFiles ?? []).map(norm));

  const statusByPath = new Map<string, string>();
  if (args.baseRef) {
    const sd = diffChangedFilesWithStatus({ projectRoot: args.projectRoot, baseRef: args.baseRef });
    if (sd.executed) {
      for (const e of sd.entries) statusByPath.set(norm(e.path), e.status);
    }
  }

  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];
  for (const f of all) {
    if (untracked.has(f)) { added.push(f); continue; }
    const st = statusByPath.get(f);
    if (st === 'A') added.push(f);
    else if (st === 'D') deleted.push(f);
    else modified.push(f);
  }
  return canonicalizeSourceDrift({
    added,
    modified,
    deleted,
    provenance: args.provenance,
    baseline_kind: 'trace_start_commit',
  });
}

/**
 * 便捷 provider（普通模式全流程）：解析 baseRef → git diff → protected 过滤 → 分区。
 * `filter` 由调用方注入（protected prefixes 属 profile 知识，本模块保持中性）。
 */
export function driftFactsFromTraceBase(args: {
  projectRoot: string;
  baseRef?: string;
  pathspecs: string[];
  filter: (files: string[]) => string[];
  provenance: string;
}): SourceDriftFacts | null {
  const diff = diffChangedFiles({
    projectRoot: args.projectRoot,
    baseRef: args.baseRef,
    pathspecs: args.pathspecs,
  });
  if (!diff.executed) return null;
  return partitionDriftByGitStatus({
    projectRoot: args.projectRoot,
    baseRef: diff.baseRef,
    files: args.filter(diff.changedFiles),
    untrackedFiles: args.filter(diff.untrackedFiles),
    provenance: args.provenance,
  });
}
