// ============================================================================
// product-source-snapshot.ts — invocation 前后精确快照（plan d8c5f3a7 v23 F2）
// ----------------------------------------------------------------------------
// 【v23 重写：纯文件系统递归哈希，不再依赖 git】旧实现走 `git ls-files`/`git status`，
// 在真实宿主上是半盲的：`goal-runs/`、`reports/*` 本就在 canonical .gitignore；
// `docs_committed:false` 的宿主 doc 域整体不进 git——需求 SSOT 恰好全在盲区。
// （旧文件还混入过真实 NUL 字节。）
//
// 快照三个集合（v23 F2 冻结范围）：
//   ① 产品源码层目录（architecture outer_layers）；
//   ② 当前 feature 的需求 SSOT 六文件（经 resolveFeatureArtifact 定位 canonical/legacy
//      真实路径）：acceptance.yaml / contracts.yaml / ui-spec.yaml / spec.md / plan.md /
//      use-cases.yaml；
//   ③ 根构建配置：build-profile.json5 / oh-package.json5 / hvigorfile.ts / AppScope。
//
// 判据语义：**invoke 前后对比，不与 HEAD 比**——pre-existing dirty 合法（新 goal 的
// 未提交需求不受伤），本 invocation 新增的变化才违规。覆盖五类变化：新增/删除/内容/
// 路径/类型。
//
// 实现约束（v23 冻结）：递归用 lstat，**不跟随 symlink/junction**（防 Windows junction
// 循环或逃出预期范围——symlink 记录其自身身份，不进目标）；路径稳定排序后哈希；
// **配置声明的产品层目录缺失/不可枚举 = 快照失败**（消费点必须 fail-closed，不得调 agent）。
//
// 与 worktree-digest.ts 的 computeProductWorktreeDigest 职责分离不变：那边是轻量 stale
// 检测（16 hex、二进制不可见），本模块是密码学级身份（64 hex、按文件原始字节）。
// ============================================================================

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { resolveFeatureArtifact } from '../../config';

/** 无法核实哨兵——消费点见此值一律 fail-closed（不得当作"无变化"，也不得调 agent） */
export const PRODUCT_SOURCE_SNAPSHOT_UNVERIFIABLE = 'unverifiable';
/** 无产品层声明（framework.config 未配 outer_layers）——同属不可核实，单列便于报文 */
export const PRODUCT_SOURCE_SNAPSHOT_NO_LAYERS = 'no-layers';

/** 需求 SSOT 六文件（v23 F2 冻结清单；经 resolveFeatureArtifact 定位真实路径） */
export const REQUIREMENT_SSOT_FILES: readonly string[] = [
  'acceptance.yaml',
  'contracts.yaml',
  'ui-spec.yaml',
  'spec.md',
  'plan.md',
  'use-cases.yaml',
];

/** 根构建配置——改这些同样改变产物，必须入快照 */
const ROOT_CONFIG_PATHS: readonly string[] = [
  'oh-package.json5',
  'build-profile.json5',
  'hvigorfile.ts',
  'AppScope',
];

/** 输出/依赖目录：改它们不代表源码变化，排除以免快照恒变 */
const EXCLUDED_SEGMENTS: ReadonlySet<string> = new Set([
  'build', 'dist', 'node_modules', 'oh_modules', '.hvigor', '.idea', '.git',
]);

// 测试缝（仓内先例：__testing_setDigestReadFile）——注入读失败模拟"持续不可读"
let snapshotReadFile: (abs: string) => Buffer = abs => fs.readFileSync(abs);
export function __testing_setSnapshotReadFile(fn: ((abs: string) => Buffer) | null): void {
  snapshotReadFile = fn ?? (abs => fs.readFileSync(abs));
}

export type SnapshotEntryKind = 'file' | 'symlink' | 'dir-symlink';

export interface ProductSourceSnapshotDetail {
  /** 64 hex，或 unverifiable / no-layers 哨兵 */
  sha256: string;
  /** 参与计算的文件数（哨兵时为 0） */
  fileCount: number;
  /** 逐文件条目（rel 为 POSIX 相对 projectRoot；kind 参与身份——类型变化=变化） */
  entries: Array<{ path: string; kind: SnapshotEntryKind; sha256: string }>;
  /** 哨兵时的人读原因（正常快照为 null） */
  failureReason: string | null;
}

interface CollectFailure {
  reason: string;
}

/** 单文件条目哈希；symlink 记录 link 目标字符串的哈希（身份=链接本身，不跟随） */
function entryOf(abs: string, rel: string, st: fs.Stats): { path: string; kind: SnapshotEntryKind; sha256: string } {
  if (st.isSymbolicLink()) {
    const target = fs.readlinkSync(abs);
    return { path: rel, kind: 'symlink', sha256: crypto.createHash('sha256').update(target, 'utf-8').digest('hex') };
  }
  const buf = snapshotReadFile(abs);
  return { path: rel, kind: 'file', sha256: crypto.createHash('sha256').update(buf).digest('hex') };
}

/**
 * 递归收集一个根下的全部文件条目。
 * - `lstat` 判类型：symlink/junction **不跟随**（Windows junction 在 node 里表现为
 *   directory symlink——记录为 dir-symlink 条目，不进目标目录）；
 * - 排除段命中即剪枝；
 * - 任一 stat/read 失败 → 整体失败（fail-closed，交调用方哨兵化）。
 */
function collectRoot(
  projectRoot: string,
  rootAbs: string,
  out: Array<{ path: string; kind: SnapshotEntryKind; sha256: string }>,
): CollectFailure | null {
  const walk = (abs: string): CollectFailure | null => {
    let st: fs.Stats;
    try {
      st = fs.lstatSync(abs);
    } catch (e) {
      return { reason: `lstat 失败：${path.relative(projectRoot, abs)}（${(e as Error).message}）` };
    }
    const rel = path.relative(projectRoot, abs).split(path.sep).join('/');
    if (rel.split('/').some(seg => EXCLUDED_SEGMENTS.has(seg))) return null;
    try {
      if (st.isSymbolicLink()) {
        // 目录型 junction/symlink 也在这里被拦（lstat 先于 isDirectory 判定）
        let target = '';
        try {
          target = fs.readlinkSync(abs);
        } catch {
          target = '<unreadable-link>';
        }
        out.push({
          path: rel,
          kind: 'dir-symlink',
          sha256: crypto.createHash('sha256').update(target, 'utf-8').digest('hex'),
        });
        return null;
      }
      if (st.isDirectory()) {
        let names: string[];
        try {
          names = fs.readdirSync(abs);
        } catch (e) {
          return { reason: `目录不可枚举：${rel}（${(e as Error).message}）` };
        }
        for (const n of names) {
          const fail = walk(path.join(abs, n));
          if (fail) return fail;
        }
        return null;
      }
      if (st.isFile()) {
        out.push(entryOf(abs, rel, st));
        return null;
      }
      // FIFO/socket 等异类：记类型即可（产品源码不应出现，出现即身份变化）
      out.push({ path: rel, kind: 'file', sha256: `special:${st.mode.toString(8)}` });
      return null;
    } catch (e) {
      return { reason: `读取失败：${rel}（${(e as Error).message}）` };
    }
  };
  return walk(rootAbs);
}

function sentinel(sha: string, reason: string | null): ProductSourceSnapshotDetail {
  return { sha256: sha, fileCount: 0, entries: [], failureReason: reason };
}

/**
 * 计算 invocation 快照（三集合并、稳定排序、整体 SHA-256）。
 *
 * fail-closed 语义：
 * - 产品层未声明 → `no-layers`；
 * - **配置声明的产品层目录缺失或不可枚举 → `unverifiable`**（快照失败；调用方不得调 agent）；
 * - SSOT/根配置文件**不存在是合法态**（新 feature 可能还没写 contracts.yaml）——不存在
 *   就不进快照，之后"凭空出现"会作为新增条目被 diff 捕获。
 */
export function computeProductSourceSnapshotDetail(
  projectRoot: string,
  layerDirs: string[],
  feature?: string,
): ProductSourceSnapshotDetail {
  if (layerDirs.length === 0) return sentinel(PRODUCT_SOURCE_SNAPSHOT_NO_LAYERS, '产品层未声明（outer_layers 为空）');

  const entries: Array<{ path: string; kind: SnapshotEntryKind; sha256: string }> = [];

  // ① 产品源码层：目录缺失/不可枚举 = 快照失败（这是配置声明过的保护范围）
  for (const dir of layerDirs) {
    const abs = path.join(projectRoot, dir);
    if (!fs.existsSync(abs)) {
      return sentinel(PRODUCT_SOURCE_SNAPSHOT_UNVERIFIABLE, `配置声明的产品层目录不存在：${dir}`);
    }
    const fail = collectRoot(projectRoot, abs, entries);
    if (fail) return sentinel(PRODUCT_SOURCE_SNAPSHOT_UNVERIFIABLE, fail.reason);
  }

  // ② 需求 SSOT（有 feature 时）：canonical 与 legacy 两个候选路径都看——agent 写哪个都算。
  // 另加 `spec/<name>` 候选：宿主真实产物把 ui-spec/acceptance 放在 spec/ 子目录
  //（bc-openCard 事故产物即 spec/ui-spec.yaml），而 resolveFeatureArtifact 对这些文件只给
  // 扁平 canonical——漏掉该候选，SSOT 保护对真实宿主形态失明（本模块单测抓到的真 bug）。
  if (feature?.trim()) {
    const seen = new Set<string>();
    let featDirAbs: string | null = null;
    for (const name of REQUIREMENT_SSOT_FILES) {
      try {
        const r = resolveFeatureArtifact(projectRoot, feature, name);
        if (featDirAbs === null && r.canonicalPath) {
          // canonical 的父目录链里取 feature 根（…/<features_dir>/<feature>/…）
          const parts = r.canonicalPath.split(path.sep);
          const fi = parts.lastIndexOf(feature);
          featDirAbs = fi >= 0 ? parts.slice(0, fi + 1).join(path.sep) : null;
        }
        const specNested = featDirAbs ? path.join(featDirAbs, 'spec', name) : null;
        for (const abs of [r.canonicalPath, r.legacyPath, specNested]) {
          if (!abs || seen.has(abs) || !fs.existsSync(abs)) continue;
          seen.add(abs);
          const fail = collectRoot(projectRoot, abs, entries);
          if (fail) return sentinel(PRODUCT_SOURCE_SNAPSHOT_UNVERIFIABLE, fail.reason);
        }
      } catch (e) {
        return sentinel(PRODUCT_SOURCE_SNAPSHOT_UNVERIFIABLE, `SSOT 路径解析失败：${name}（${(e as Error).message}）`);
      }
    }
  }

  // ③ 根构建配置：不存在合法；存在则入快照
  for (const rel of ROOT_CONFIG_PATHS) {
    const abs = path.join(projectRoot, rel);
    if (!fs.existsSync(abs)) continue;
    const fail = collectRoot(projectRoot, abs, entries);
    if (fail) return sentinel(PRODUCT_SOURCE_SNAPSHOT_UNVERIFIABLE, fail.reason);
  }

  // 稳定排序（路径字典序）后整体哈希；kind 参与身份（file→symlink 也是变化）
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const h = crypto.createHash('sha256');
  for (const e of entries) h.update(`${e.path}\n${e.kind}\n${e.sha256}\n`, 'utf-8');
  return { sha256: h.digest('hex'), fileCount: entries.length, entries, failureReason: null };
}

/** 只要 64 hex 身份时的便捷入口 */
export function computeProductSourceSnapshotSha256(
  projectRoot: string,
  layerDirs: string[],
  feature?: string,
): string {
  return computeProductSourceSnapshotDetail(projectRoot, layerDirs, feature).sha256;
}

export function isUsableSnapshot(sha: string): boolean {
  return /^[0-9a-f]{64}$/.test(sha);
}

export type SourceMutationVerdict =
  | { kind: 'clean' }
  | {
      kind: 'mutated';
      changed: Array<{ path: string; how: 'added' | 'removed' | 'modified' | 'type-changed' }>;
    }
  | { kind: 'unverifiable'; reason: string };

/**
 * invoke 前后快照 diff。任一侧哨兵 → unverifiable（fail-closed）。
 * 五类变化：新增 / 删除 / 内容 / 类型（路径变化天然表现为 removed+added 对）。
 */
export function diffProductSourceSnapshots(
  pre: ProductSourceSnapshotDetail,
  post: ProductSourceSnapshotDetail,
): SourceMutationVerdict {
  if (!isUsableSnapshot(pre.sha256)) {
    return { kind: 'unverifiable', reason: `invoke 前快照不可用（${pre.sha256}：${pre.failureReason ?? '未知'}）` };
  }
  if (!isUsableSnapshot(post.sha256)) {
    return { kind: 'unverifiable', reason: `invoke 后快照不可用（${post.sha256}：${post.failureReason ?? '未知'}）` };
  }
  if (pre.sha256 === post.sha256) return { kind: 'clean' };

  const preMap = new Map(pre.entries.map(e => [e.path, e]));
  const postMap = new Map(post.entries.map(e => [e.path, e]));
  const changed: Array<{ path: string; how: 'added' | 'removed' | 'modified' | 'type-changed' }> = [];
  for (const [p, e] of postMap) {
    const prev = preMap.get(p);
    if (!prev) changed.push({ path: p, how: 'added' });
    else if (prev.kind !== e.kind) changed.push({ path: p, how: 'type-changed' });
    else if (prev.sha256 !== e.sha256) changed.push({ path: p, how: 'modified' });
  }
  for (const p of preMap.keys()) {
    if (!postMap.has(p)) changed.push({ path: p, how: 'removed' });
  }
  changed.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  // 总 hash 变了但逐项集合没差 —— 理论不可达；防御性归为 unverifiable 而非 clean
  if (changed.length === 0) {
    return { kind: 'unverifiable', reason: '快照 hash 不等但条目集合无差——快照实现异常' };
  }
  return { kind: 'mutated', changed };
}
