/**
 * D1.1 — feature 级冻结记录（轻量交互路径的范围载体）。
 *
 * 它与 run 的 `manifest.execution_scope` + `scope_revised` 事件是**同一套机制的两个载体**：
 * 出生段是 `resolveExecutionScope` 的输出，修订是形状与 `scope_revised` 一致的记录，有效范围
 * 由**同一个** `applyScopeRevisions` 算出。这里不新增任何签名体系、不新增第二个运行权威。
 *
 * 三条硬约束（D1.1 / §6.1）：
 *  1. **机器写入、单 writer**：只有本文件的 `freezeFeatureExecutionScope` / `appendFeatureScopeRevision`
 *     写它，调用方分别是 harness-runner 的首次冻结入口与阶段收尾的修订应用；
 *  2. **不写进 feature.yaml**：feature.yaml 是 AI 可编辑的**候选**载体，冻结结果与候选混在一个
 *     文件里就分不清谁改了谁；
 *  3. 路径一律经 `featureFilePath` 解析，禁止 `doc/features` 字面量。
 */

import * as fs from 'fs';
import * as path from 'path';
import { featureFilePath, featurePhaseReportsDir, type FeaturePathOptions } from '../../config';
import {
  applyScopeRevisions,
  loadScopeRevisions,
} from './goal-run-creation';
import {
  executionScopeFingerprint,
  validateExecutionScope,
  type ExecutionScope,
  type ExecutionScopeInput,
} from './execution-scope';
import { FEATURE_LOCK_NAME, STALE_LOCK_MS, isLockStale, isPidAlive, readLockRecord, type LockRecord } from './goal-run-lock';
import { SCOPE_REVISION_FIELDS } from './goal-manifest';
import { featureScopeCandidateFingerprint, featureTrackDeclPath, resolveFeatureExecutionScope } from './feature-track';
import { resolveWorkflowSpec, type WorkflowSpec } from '../../workflow-loader';
import type { CheckResult } from './types';

const relPosix = (projectRoot: string, abs: string): string => path.relative(projectRoot, abs).split(path.sep).join('/');

export const FEATURE_EXECUTION_SCOPE_FILENAME = 'execution-scope.json';

/** 与 `scope_revised` 事件同形；feature 载体没有 run 字段（`run_id` / `run_base_sha`）。 */
export interface FeatureScopeRevision {
  type: 'scope_revised';
  revision_index: number;
  previous_scope_fingerprint: string;
  allowed_fields: readonly string[];
  execution_scope: ExecutionScope;
  /** 与 run 侧 `scope_revised` 同形：产生本次修订的提案原样留痕（可为 null）。 */
  revision_input?: ExecutionScopeInput | null;
  applied_at: string;
  trigger?: { phase?: string; check_id?: string };
}

export interface FeatureFrozenScope {
  schema_version: '1.0';
  scope_source: 'feature';
  frozen_at: string;
  /** feature.yaml 的 `execution_scope` 候选指纹——候选被改动而未经修订即 BLOCKER。 */
  candidate_fingerprint: string;
  /** 出生范围自带的 policy 指纹（contracts / workflow），原样登记便于诊断。 */
  policy_fingerprint: string;
  execution_scope: ExecutionScope;
  revisions: FeatureScopeRevision[];
  /** D1.3：已转交给某个 run 之后登记，feature 记录自此是来源历史。 */
  transferred_to?: string;
  transferred_scope_fingerprint?: string;
}

export function featureFrozenScopePath(projectRoot: string, feature: string, opts?: FeaturePathOptions): string {
  return featureFilePath(projectRoot, feature, FEATURE_EXECUTION_SCOPE_FILENAME, opts);
}

/** 读冻结记录。文件不存在 → null；存在但结构非法 → 抛错（不静默沿用、不静默重算）。 */
export function readFeatureFrozenScope(projectRoot: string, feature: string, opts?: FeaturePathOptions): FeatureFrozenScope | null {
  const abs = featureFrozenScopePath(projectRoot, feature, opts);
  if (!fs.existsSync(abs)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (error) {
    throw new Error(`[execution-scope] feature 冻结记录无法解析：${(error as Error).message}`);
  }
  return validateFeatureFrozenScope(raw);
}

export function validateFeatureFrozenScope(value: unknown): FeatureFrozenScope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('[execution-scope] feature 冻结记录损坏');
  const record = value as FeatureFrozenScope;
  if (record.schema_version !== '1.0' || record.scope_source !== 'feature') throw new Error('[execution-scope] feature 冻结记录版本或载体标记非法');
  if (typeof record.candidate_fingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(record.candidate_fingerprint)) throw new Error('[execution-scope] feature 冻结记录缺少候选指纹');
  if (typeof record.frozen_at !== 'string' || !record.frozen_at) throw new Error('[execution-scope] feature 冻结记录缺少冻结时间');
  validateExecutionScope(record.execution_scope);
  if (!Array.isArray(record.revisions)) throw new Error('[execution-scope] feature 冻结记录的 revisions 非数组');
  // `loadScopeRevisions` 内部按 `type === 'scope_revised'` **过滤**——被篡改成别的 type 的条目
  // 会被静默跳过，记录照样可用（第四轮阻断 2）。所以先要求每一项都是修订记录。
  record.revisions.forEach((item, index) => {
    if (!item || typeof item !== 'object' || (item as { type?: unknown }).type !== 'scope_revised') {
      throw new Error(`[execution-scope] feature 冻结记录的 revisions[${index}] 不是合法的 scope_revised 记录`);
    }
  });
  // 修订链完整性走**与 run 完全相同**的校验（index 连续、指纹接续、可改字段边界、
  // 请求边界不变、required 义务不得被删或降级）——不另写一套。
  loadScopeRevisions(record.revisions as never, record.execution_scope);
  if (typeof record.policy_fingerprint !== 'string' || record.policy_fingerprint !== record.execution_scope.policy_fingerprint) {
    throw new Error('[execution-scope] feature 冻结记录的 policy_fingerprint 与出生范围不一致');
  }
  if (record.transferred_to !== undefined && (typeof record.transferred_to !== 'string' || !record.transferred_to)) throw new Error('[execution-scope] transferred_to 形状非法');
  if (record.transferred_scope_fingerprint !== undefined && !/^[0-9a-f]{64}$/.test(String(record.transferred_scope_fingerprint))) {
    throw new Error('[execution-scope] transferred_scope_fingerprint 形状非法');
  }
  if ((record.transferred_to === undefined) !== (record.transferred_scope_fingerprint === undefined)) {
    throw new Error('[execution-scope] 转交登记不完整：transferred_to 与 transferred_scope_fingerprint 必须同时在场');
  }
  return record;
}

function readRecordBytes(projectRoot: string, feature: string, opts?: FeaturePathOptions): string | null {
  const abs = featureFrozenScopePath(projectRoot, feature, opts);
  return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
}

/**
 * 写事务：**排他临时锁 + 持锁期内读-比-写 + temp/rename**。
 *
 * 之前那版「写前再读一次字节比对」不是原子 CAS——两个 writer 都可能在对方 rename 之前完成
 * 比较，然后各自 rename，后者覆盖前者（第二轮阻断 3）。这里改成真正的串行化：
 *  · `openSync(lock, 'wx')` 由内核裁决谁进临界区；
 *  · 抢不到锁时**不抢占**：读锁内容，同机 pid 还活着或未超既有 `STALE_LOCK_MS` → 报「记录正被
 *    写入」，只有过期锁才清理后重试一次；
 *  · 临界区内再比一次读入字节（防止本次读发生在上一个持锁者提交之前）；
 *  · `finally` 里删锁——**不跨调用持有、不登记、不续期**，所以它是写事务，不是租约。
 */
let injectedInsideRecordWriteLock: (() => void) | null = null;
let injectedBeforeStaleLockReclaim: (() => void) | null = null;

/** 测试缝：在**持锁临界区内**回调一次，用于构造真实交错（生产路径恒为 null）。 */
export function __testing_setInsideRecordWriteLock(fn: (() => void) | null): void {
  injectedInsideRecordWriteLock = fn;
}

/** 测试缝：在**判定过期之后、抢占过期锁之前**回调一次，用于构造「两个清理者」竞态。 */
export function __testing_setBeforeStaleLockReclaim(fn: (() => void) | null): void {
  injectedBeforeStaleLockReclaim = fn;
}

function withRecordWriteLock<T>(projectRoot: string, feature: string, opts: FeaturePathOptions | undefined, body: () => T): T {
  const abs = featureFrozenScopePath(projectRoot, feature, opts);
  const lockPath = `${abs}.lock`;
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const acquire = (): number | null => {
    try {
      return fs.openSync(lockPath, 'wx');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      return null;
    }
  };
  let fd = acquire();
  if (fd === null) {
    let holder: { pid?: number; at?: string } = {};
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
      // `JSON.parse('null')` 返回 null，直接读属性会抛——非对象一律按「元数据缺失」处理。
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) holder = parsed as { pid?: number; at?: string };
    } catch { holder = {}; }
    // 崩溃恢复：`openSync(wx)` 与写入 pid/at 之间崩溃会留下**空锁 / 半写锁**。
    // 规则统一（第四轮阻断 1）：**pid 只在元数据完整（pid 与 at 都合法）时参与判断**，
    // 否则只看锁文件 mtime——否则一条 `{"pid": <存活 pid>}` 的半写锁会因为 pid 活着而永久阻塞。
    const declaredAt = typeof holder.at === 'string' ? new Date(holder.at).getTime() : NaN;
    const complete = typeof holder.pid === 'number' && !Number.isNaN(declaredAt);
    let observedMtime = NaN;
    try { observedMtime = fs.statSync(lockPath).mtimeMs; } catch { observedMtime = NaN; }
    const at = complete ? declaredAt : (Number.isNaN(observedMtime) ? 0 : observedMtime);
    const expired = Date.now() - at > STALE_LOCK_MS;
    const alive = complete && isPidAlive(holder.pid!);
    if (alive || !expired) {
      throw new Error(`[execution-scope] feature 冻结记录正被其他写者写入（pid=${holder.pid ?? '?'} at=${holder.at ?? '?'}）——请稍后重跑本步骤`);
    }
    // 第五轮阻断 3：过期锁**不能直接 rmSync**——两个 writer 都判过期时，A 删完新建的锁会被 B 的
    // rmSync 一并删掉，两者同时进临界区。改成 rename 抢占：同目录唯一临时名由内核裁决谁抢到
    //（输的一方 ENOENT），抢到后再核一次身份（mtime 与判过期时看到的一致），身份不符说明这期间
    // 有人重建了锁——原样 rename 回去并报「正被其他写者写入」，不硬闯。
    const reclaimed = `${lockPath}.stale.${process.pid}.${Date.now()}`;
    if (injectedBeforeStaleLockReclaim) {
      const hook = injectedBeforeStaleLockReclaim;
      injectedBeforeStaleLockReclaim = null;
      hook();
    }
    try {
      fs.renameSync(lockPath, reclaimed);
    } catch {
      throw new Error('[execution-scope] feature 冻结记录写锁竞争失败——请重跑本步骤');
    }
    let reclaimedMtime = NaN;
    try { reclaimedMtime = fs.statSync(reclaimed).mtimeMs; } catch { reclaimedMtime = NaN; }
    if (Number.isNaN(reclaimedMtime) || reclaimedMtime !== observedMtime) {
      try { fs.renameSync(reclaimed, lockPath); } catch { /* 对方已重建：让它继续持有，不覆盖 */ }
      throw new Error('[execution-scope] feature 冻结记录正被其他写者写入（过期锁在抢占期间被重建）——请稍后重跑本步骤');
    }
    fs.rmSync(reclaimed, { force: true });
    fd = acquire();
    if (fd === null) throw new Error('[execution-scope] feature 冻结记录写锁竞争失败——请重跑本步骤');
  }
  try {
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }), 'utf-8');
    if (injectedInsideRecordWriteLock) {
      const hook = injectedInsideRecordWriteLock;
      injectedInsideRecordWriteLock = null;
      hook();
    }
    return body();
  } finally {
    try { fs.closeSync(fd); } finally { fs.rmSync(lockPath, { force: true }); }
  }
}

/** 持锁期内提交一次「读-改-写」：读入字节与临界区内再读不一致即拒（调用方重跑）。 */
function commitRecord(projectRoot: string, feature: string, before: string | null, next: FeatureFrozenScope, opts?: FeaturePathOptions): void {
  withRecordWriteLock(projectRoot, feature, opts, () => {
    const now = readRecordBytes(projectRoot, feature, opts);
    if (now !== before) throw new Error('[execution-scope] feature 冻结记录在本次读改写期间被其他写者改动——请重跑本步骤');
    writeRecord(featureFrozenScopePath(projectRoot, feature, opts), next);
  });
}

/** 有效范围 = 出生段 + 已应用 revisions（与 run 载体共用同一函数）。 */
export function featureEffectiveScope(record: FeatureFrozenScope): ExecutionScope {
  return applyScopeRevisions(record.execution_scope, record.revisions as never);
}

/**
 * 原子写（temp + rename，与 `harness-runner.ts` 的 `atomicWriteJson` 同款）——崩溃或并发读
 * 都读不到半截 JSON。temp 名带 pid，两个进程不会互相截断对方的临时文件。
 */
function writeRecord(abs: string, record: FeatureFrozenScope): void {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(record, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmp, abs);
}

/**
 * 首次冻结（单 writer 之一）。已存在记录时**不覆盖**——是否沿用由调用方按候选指纹判定。
 */
export function freezeFeatureExecutionScope(input: {
  projectRoot: string;
  feature: string;
  scope: ExecutionScope;
  candidateFingerprint: string;
  featuresDirAbs?: string;
}): FeatureFrozenScope {
  const opts = input.featuresDirAbs ? { featuresDirAbs: input.featuresDirAbs } : undefined;
  const abs = featureFrozenScopePath(input.projectRoot, input.feature, opts);
  const record: FeatureFrozenScope = {
    schema_version: '1.0',
    scope_source: 'feature',
    frozen_at: new Date().toISOString(),
    candidate_fingerprint: input.candidateFingerprint,
    policy_fingerprint: input.scope.policy_fingerprint,
    execution_scope: validateExecutionScope(input.scope),
    revisions: [],
  };
  // 首次冻结同样走**写事务**：持锁期内确认文件不存在再 temp+rename——既不 TOCTOU，
  // 也不会在崩溃时留半截 JSON（`wx` 直写目标文件会）。
  const created = withRecordWriteLock(input.projectRoot, input.feature, opts, () => {
    if (fs.existsSync(abs)) return false;
    writeRecord(abs, record);
    return true;
  });
  if (created) return record;
  const existing = readFeatureFrozenScope(input.projectRoot, input.feature, opts);
  if (existing
    && existing.candidate_fingerprint === record.candidate_fingerprint
    && executionScopeFingerprint(existing.execution_scope) === executionScopeFingerprint(record.execution_scope)) {
    return existing;
  }
  throw new Error('[execution-scope] feature 冻结记录已存在且与本次计算不一致——首次冻结不得覆盖既有记录');
}

/**
 * 追加一条修订（单 writer 之二）。指纹接续与义务保全由 `loadScopeRevisions` 统一判定：
 * 校验不通过即抛错，不写盘。
 */
export function appendFeatureScopeRevision(input: {
  projectRoot: string;
  feature: string;
  nextScope: ExecutionScope;
  trigger?: { phase?: string; check_id?: string };
  revisionInput?: ExecutionScopeInput | null;
  featuresDirAbs?: string;
}): { record: FeatureFrozenScope; revision: FeatureScopeRevision | null } {
  const opts = input.featuresDirAbs ? { featuresDirAbs: input.featuresDirAbs } : undefined;
  const before = readRecordBytes(input.projectRoot, input.feature, opts);
  const record = readFeatureFrozenScope(input.projectRoot, input.feature, opts);
  if (!record) throw new Error('[execution-scope] 没有 feature 冻结记录，无法追加修订');
  if (record.transferred_to) throw new Error(`[execution-scope] feature 范围已转交给 run ${record.transferred_to}——修订应在该 run 内进行`);
  const previous = featureEffectiveScope(record);
  // 幂等：目标范围与当前有效范围**完全相同** = 没有可修订的东西（与 run 路径的 no-op 同义），
  // 重试同一条修订因此不会追加第二条。
  if (executionScopeFingerprint(input.nextScope) === executionScopeFingerprint(previous)) {
    return { record, revision: record.revisions.at(-1) ?? null };
  }
  const revision: FeatureScopeRevision = {
    type: 'scope_revised',
    revision_index: record.revisions.length + 1,
    previous_scope_fingerprint: executionScopeFingerprint(previous),
    // 可改字段边界与 run 载体**同一个常量**——`loadScopeRevisions` 逐字比对它。
    allowed_fields: SCOPE_REVISION_FIELDS,
    execution_scope: validateExecutionScope(input.nextScope),
    revision_input: input.revisionInput ?? null,
    applied_at: new Date().toISOString(),
    ...(input.trigger ? { trigger: input.trigger } : {}),
  };
  const next: FeatureFrozenScope = { ...record, revisions: [...record.revisions, revision] };
  // 写盘前先过一遍与 run 同款的链校验——不合法就不落盘。
  loadScopeRevisions(next.revisions as never, next.execution_scope);
  // 幂等：同一条修订（同 index、同前指纹、同结果范围）重试时直接返回既有记录，不追加第二条。
  commitRecord(input.projectRoot, input.feature, before, next, opts);
  return { record: next, revision };
}

/** D1.3：出生成功后登记转交。只写一次；重复登记同一 run 视为幂等。 */
export function registerFeatureScopeTransfer(input: {
  projectRoot: string;
  feature: string;
  runId: string;
  transferredScopeFingerprint: string;
  featuresDirAbs?: string;
}): FeatureFrozenScope | null {
  const opts = input.featuresDirAbs ? { featuresDirAbs: input.featuresDirAbs } : undefined;
  const before = readRecordBytes(input.projectRoot, input.feature, opts);
  const record = readFeatureFrozenScope(input.projectRoot, input.feature, opts);
  if (!record) return null;
  // 转交指纹**由记录自己的有效范围算**，不信调用方传进来的值——调用方传错就是登记错。
  const effective = executionScopeFingerprint(featureEffectiveScope(record));
  if (input.transferredScopeFingerprint !== effective) {
    throw new Error(`[execution-scope] 转交指纹与 feature 有效范围失配：调用方=${input.transferredScopeFingerprint.slice(0, 16)} 记录有效范围=${effective.slice(0, 16)}（run=${input.runId}）`);
  }
  if (record.transferred_to === input.runId) {
    if (record.transferred_scope_fingerprint !== effective) {
      throw new Error(`[execution-scope] 已登记的转交指纹与当前有效范围失配：记录=${String(record.transferred_scope_fingerprint).slice(0, 16)} 现算=${effective.slice(0, 16)}（run=${input.runId}）——转交记录损坏`);
    }
    return record; // 幂等重试
  }
  if (record.transferred_to) {
    throw new Error(`[execution-scope] feature 范围已转交给 run ${record.transferred_to}，不能再转交给 ${input.runId}`);
  }
  const next: FeatureFrozenScope = { ...record, transferred_to: input.runId, transferred_scope_fingerprint: effective };
  commitRecord(input.projectRoot, input.feature, before, next, opts);
  return next;
}

/**
 * §3 问题 12 第 2 步的**读取实验**落地为生产检查：无身份调用时，本 feature 的
 * `.feature.lock` 是否有活着的持柄者。
 *
 * 实验结论（§11 批次 3 记录）：`LockRecord.run_id` 是**可选**字段、跨机活性只有 TTL、同机靠
 * pid（自带复用窗口），因此它只能回答「是否可能有人正持有这个 feature」，**回答不了「本次调用
 * 关联的是哪个 run」**。所以 D1.3 第一行按 §3 问题 12 第 4 步收窄为只认显式 run 身份，而这里
 * 发现任何非 stale 的锁记录时一律交给调用方明确报错（D1.3 第三行「不选边」）。
 */
export function detectLiveFeatureLock(projectRoot: string, feature: string, opts?: FeaturePathOptions): { lockPath: string; record: LockRecord | null; unreadable: boolean } | null {
  const lockPath = featureFilePath(projectRoot, feature, path.join('goal-runs', FEATURE_LOCK_NAME), opts);
  if (!fs.existsSync(lockPath)) return null;
  const record = readLockRecord(lockPath);
  // **锁文件在但读不出来 = 未知权威**，不是「没有锁」。`readLockRecord` 对非法 JSON 返回
  // null（`goal-run-lock.ts:45-52`），按无锁处理等于把不可判读成放行。
  // 第五轮阻断 4：它只 JSON.parse **不校验结构**——`{}` / `[]` 会被当成 LockRecord，随后
  // `isLockStale` 因 `updated_at` 缺失算出 NaN 而判 stale，等于把结构损坏的锁放行。
  // 必要字段缺一不可，缺了就是 unreadable，不进 stale 判断。
  // 第六轮：只校验**类型**还不够——`updated_at: "invalid"` 会让 `isLockStale` 的
  // `Number.isNaN(updated)` 直接判 stale，`pid: 0 / -1` 会让 `isPidAlive` 恒 false 而同机判 stale；
  // 两者都是「值非法」而不是「锁过期」。所以按**值**校验：pid 正整数、hostname 非空、时间可解析。
  const candidate = (!!record && typeof record === 'object' && !Array.isArray(record)) ? record as LockRecord : null;
  const structured = !!candidate
    && Number.isInteger(candidate.pid) && candidate.pid > 0
    && typeof candidate.hostname === 'string' && candidate.hostname.trim().length > 0
    && typeof candidate.updated_at === 'string' && !Number.isNaN(new Date(candidate.updated_at).getTime());
  if (!structured || !candidate) return { lockPath, record: null, unreadable: true };
  if (isLockStale(candidate)) return null;
  return { lockPath, record: candidate, unreadable: false };
}

/**
 * 所有**无 run 入口**（普通 phase、`--sync-closure`、`--report-reconcile-only`）共用的锁前置。
 * 返回 null 表示可以继续；返回一条 BLOCKER 表示本次调用说不清权威——报错、不选边。
 */
export function featureAuthorityLockBlocker(projectRoot: string, feature: string, runId?: string, opts?: FeaturePathOptions): CheckResult | null {
  if (runId?.trim()) return null;
  const live = detectLiveFeatureLock(projectRoot, feature, opts);
  if (!live) return null;
  const detail = live.unreadable
    ? `本次调用没有 run 身份，而该 feature 的锁文件存在但无法解析（未知权威） | lock=${relPosix(projectRoot, live.lockPath)}`
    : `本次调用没有 run 身份，但该 feature 有活着的持柄者：run_id=${live.record!.run_id ?? '(锁记录未声明)'} pid=${live.record!.pid} host=${live.record!.hostname} updated_at=${live.record!.updated_at} | lock=${relPosix(projectRoot, live.lockPath)}`;
  return {
    id: 'execution_scope_frozen', category: 'structure', severity: 'BLOCKER', status: 'FAIL',
    description: 'feature 级冻结范围可用且与候选一致',
    details: detail,
    affected_files: [relPosix(projectRoot, featureFilePath(projectRoot, feature, path.join('goal-runs', FEATURE_LOCK_NAME), opts))],
    suggestion: '这次调用无法确定权威：要么带上该 run 的身份（--goal-run-id <run_id>）再跑，要么等该 run 结束 / 清理陈旧锁后重试。不会替你在两个载体之间选边。',
  };
}

/**
 * D1.2 首次冻结 / 每次核对的唯一入口（harness-runner 在 capability 解析**之前**调用）。
 *
 * 顺序按 §3 问题 12 第 3 步：**先**做锁的读取检查，再谈冻结或选择 feature 权威。
 *  - 有显式 run 身份 → run 是权威，一行不写（D1.3 第一行）；
 *  - 无身份但发现活着的 `.feature.lock` → 明确报错，不选边、不静默走 feature 载体（D1.3 第三行）；
 *  - 无记录 → 按候选冻结；有记录 → 只核对候选指纹，**不重算、不沿用**。
 */
export function ensureFeatureExecutionScopeFrozen(input: {
  projectRoot: string;
  frameworkRoot: string;
  feature: string;
  featuresDirAbs?: string;
  runId?: string;
}): { status: 'run-authority' | 'frozen' | 'reused' | 'not-applicable'; record?: FeatureFrozenScope; checks: CheckResult[] } {
  const { projectRoot, feature } = input;
  const opts = input.featuresDirAbs ? { featuresDirAbs: input.featuresDirAbs } : undefined;
  if (input.runId?.trim()) return { status: 'run-authority', checks: [] };

  const fail = (details: string, suggestion: string): { status: 'not-applicable'; checks: CheckResult[] } => ({
    status: 'not-applicable',
    checks: [{
      id: 'execution_scope_frozen', category: 'structure', severity: 'BLOCKER', status: 'FAIL',
      description: 'feature 级冻结范围可用且与候选一致',
      details,
      affected_files: [
        relPosix(projectRoot, featureTrackDeclPath(projectRoot, feature)),
        relPosix(projectRoot, featureFrozenScopePath(projectRoot, feature, opts)),
      ],
      suggestion,
    }],
  });

  const lockBlocker = featureAuthorityLockBlocker(projectRoot, feature, input.runId, opts);
  if (lockBlocker) return { status: 'not-applicable', checks: [lockBlocker] };

  let workflow;
  try {
    workflow = resolveWorkflowSpec(projectRoot, { frameworkRoot: input.frameworkRoot });
  } catch (error) {
    return fail(`无法解析 workflow：${(error as Error).message}`, '修复 framework.config.json 的 active_workflow 后重试。');
  }
  if (workflow.schema_version !== '1.2') return { status: 'not-applicable', checks: [] };

  let existing: FeatureFrozenScope | null;
  try {
    existing = readFeatureFrozenScope(projectRoot, feature, opts);
  } catch (error) {
    return fail((error as Error).message, '冻结记录由机器写入：不要手改；损坏时走既有 correction 路径重建（harness-runner --correction-init）。');
  }

  let candidateFingerprint: string;
  try {
    candidateFingerprint = featureScopeCandidateFingerprint(projectRoot, feature);
  } catch (error) {
    // 候选缺失 / 不可解析：沿用现状 BLOCKER，不回落 track。
    return fail((error as Error).message, '先用 goal-mode-entry --prepare-scope 生成范围候选，再跑阶段。');
  }

  if (existing) {
    if (existing.transferred_to) {
      return fail(
        `feature 范围已转交给 run ${existing.transferred_to}，本次调用却没有 run 身份 | source=${relPosix(projectRoot, featureFrozenScopePath(projectRoot, feature, opts))}`,
        '带上该 run 的身份再跑（--goal-run-id），或按既有 correction / successor 路径开新 run。',
      );
    }
    if (existing.candidate_fingerprint !== candidateFingerprint) {
      return fail(
        `候选已变更而冻结范围未经修订 | candidate_fingerprint=${candidateFingerprint.slice(0, 16)} frozen_candidate_fingerprint=${existing.candidate_fingerprint.slice(0, 16)} source=${relPosix(projectRoot, featureFrozenScopePath(projectRoot, feature, opts))}`,
        '候选已变更而冻结范围未经修订：走既有 stale/correction 路径（harness-runner --correction-init）；不要手改冻结记录。',
      );
    }
    return { status: 'reused', record: existing, checks: [] };
  }

  // D1.3 第三行（第二轮阻断 2）：既无 run 身份、也无冻结记录，**却已有阶段报告 / 证据** ——
  // 说明这个 feature 之前由别的权威跑过（历史 run 或遗留报告）。此时首次冻结会把那些产物
  // 静默归属到一份新的 feature 载体上。不选边：明确报错，指向 correction 或显式 run 身份。
  const existingPhases = phasesWithExistingEvidence(projectRoot, feature, workflow, input.frameworkRoot);
  if (existingPhases.length) {
    return fail(
      `没有 run 身份、也没有 feature 冻结记录，但该 feature 已有阶段产物：${existingPhases.join(', ')}——无法确定这些产物属于哪个权威`,
      '带上原 run 的身份（--goal-run-id <run_id>）继续，或走既有 correction 路径（harness-runner --correction-init）重新确立权威；不会把既有阶段产物默认归给一份新冻结记录。',
    );
  }

  let scope;
  try {
    scope = resolveFeatureExecutionScope(projectRoot, feature, workflow, input.frameworkRoot);
  } catch (error) {
    return fail((error as Error).message, '按报错修正 feature.yaml 的候选（或用 goal-mode-entry --prepare-scope 重新生成）后重试。');
  }
  if (!scope) return { status: 'not-applicable', checks: [] };
  try {
    const record = freezeFeatureExecutionScope({ projectRoot, feature, scope, candidateFingerprint, featuresDirAbs: input.featuresDirAbs });
    return { status: 'frozen', record, checks: [] };
  } catch (error) {
    return fail((error as Error).message, '冻结记录由机器写入：不要手改；损坏时走既有 correction 路径重建。');
  }
}

/**
 * D1.5 / D2.7 的**唯一**无 run 收尾函数：两个出口（普通阶段尾部、`--sync-closure`）都调它，
 * 三步顺序与判据零重复：
 *
 *   ① 消费本阶段 script-report 里的修订输入 → 追加进 feature 冻结记录的 `revisions[]`；
 *   ② 重新读取有效范围；
 *   ③ 按 §6.5 四条件检查并生成无 run 完成原件。
 *
 * 有 run 身份时整个函数是 no-op（run 有自己的 runtime 收尾路径）。
 */
export function applyFeatureScopeRevisionsThenMaybeComplete(input: {
  projectRoot: string;
  frameworkRoot: string;
  feature: string;
  phase: string;
  workflowTrack: string;
  runId?: string;
  /** 本轮已确认闭环的阶段（用于按当前证据补既有满足证明）——与 run 路径同义。 */
  completedPhases?: ReadonlySet<string>;
}): { revisionApplied: boolean; completionPath?: string; skippedReason?: string } {
  if (input.runId?.trim()) return { revisionApplied: false, skippedReason: 'run-authority' };
  const { projectRoot, frameworkRoot, feature } = input;
  // 与冻结入口**同一条**锁前置：说不清权威时不写任何东西（含修订与完成原件）。
  const lockBlocker = featureAuthorityLockBlocker(projectRoot, feature, input.runId);
  if (lockBlocker) throw new Error(lockBlocker.details ?? '[execution-scope] 无法确定权威');
  let record = readFeatureFrozenScope(projectRoot, feature);
  if (!record) return { revisionApplied: false, skippedReason: 'no-frozen-record' };
  if (record.transferred_to) return { revisionApplied: false, skippedReason: 'transferred' };
  // D1.2：收尾同样要核候选指纹——候选被改而记录未经修订时，不得基于旧冻结范围生成完成原件。
  const candidateFingerprint = featureScopeCandidateFingerprint(projectRoot, feature);
  if (candidateFingerprint !== record.candidate_fingerprint) {
    throw new Error(`[execution-scope] 候选已变更而冻结范围未经修订，收尾不予继续 | candidate_fingerprint=${candidateFingerprint.slice(0, 16)} frozen_candidate_fingerprint=${record.candidate_fingerprint.slice(0, 16)}`);
  }

  /* eslint-disable @typescript-eslint/no-require-imports */
  const { executionCompletionPhases } = require('./execution-scope') as typeof import('./execution-scope');
  const { resolveScopeRevisionProposal } = require('./feature-track') as typeof import('./feature-track');
  const completionModule = require('./verify-feature-completion') as typeof import('./verify-feature-completion');
  /* eslint-enable @typescript-eslint/no-require-imports */

  // ① 修订：触发面与校验**与 run 路径同一个函数**（`resolveScopeRevisionProposal`）——
  //    单提案、请求边界、已完成阶段补证明、impact 继承/修正、失效 satisfied_by 剔除、
  //    「范围变了就必须有新来源」全部同源。边界是「写完本阶段结果、退出前」，
  //    **不以 closure 成功为条件**（§6.7）。
  const workflow = resolveWorkflowSpec(projectRoot, { frameworkRoot });
  const proposals = readPhaseScopeRevisionInputs(projectRoot, feature, input.phase, frameworkRoot);
  let revisionApplied = false;
  const previous = featureEffectiveScope(record!);
  // 第五轮建议 2：已闭环阶段交给提案校验去补既有满足证明——不接的话，一次合法修订会把
  // 已经闭环的阶段重新加回未满足义务，白跑一遍。取法与判据复用**同一个** clean-pass 收集器：
  // 修订前链上没有 issue 的阶段就是「本次可以自证闭环」的阶段，不另造一套完成判定。
  const previousChain = executionCompletionPhases(previous).map(String);
  const cleanIssues = completionModule.collectCleanPassIssues({
    projectRoot, feature, chain: previousChain, executionScope: previous, frameworkRoot,
  });
  const completedPhases = input.completedPhases
    ?? new Set(previousChain.filter(phase => !cleanIssues.some(issue => issue.phase === phase)));
  const outcome = resolveScopeRevisionProposal({
    projectRoot, frameworkRoot, feature, workflow,
    proposals,
    previous,
    completedPhases,
  });
  if (outcome) {
    record = appendFeatureScopeRevision({ projectRoot, feature, nextScope: outcome.scope, trigger: { phase: input.phase }, revisionInput: outcome.input }).record;
    revisionApplied = true;
  }

  // ② 重新读取有效范围（修订后的那一份）
  const scope = featureEffectiveScope(record!);

  // ③ 四条件：无 run 身份 + 有冻结记录（上面已确保）、completion_target=feature、无 unresolved、
  //    完整完成链每个阶段 clean-pass（与 goal 侧**同一个** `shouldGenerateFeatureCompletion`）。
  const chain = executionCompletionPhases(scope).map(String);
  const gate = completionModule.shouldGenerateFeatureCompletion(scope, {
    projectRoot, feature, chain, executionScope: scope, frameworkRoot,
  });
  if (!gate.eligible) {
    return { revisionApplied, skippedReason: gate.issues.length ? `non_clean_pass: ${gate.issues.slice(0, 3).map(issue => `[${issue.phase}] ${issue.condition}`).join('; ')}` : 'scope_not_complete' };
  }
  const { originalAbs } = completionModule.generateFeatureCompletion({
    projectRoot, feature, chain,
    workflowTrack: input.workflowTrack,
    runId: null,
    runDirAbs: featureFilePath(projectRoot, feature, 'completion'),
    phaseRunIds: {},
    executionScope: scope,
    frameworkRoot,
  });
  return { revisionApplied, completionPath: originalAbs };
}

/** 读本阶段 script-report 上的修订输入（runtime 的同一读取面：`checks[].scope_revision_input`）。 */
function readPhaseScopeRevisionInputs(projectRoot: string, feature: string, phase: string, frameworkRoot: string): ExecutionScopeInput[] {
  const abs = path.join(featurePhaseReportsDir(projectRoot, feature, phase, frameworkRoot), 'script-report.json');
  if (!fs.existsSync(abs)) return [];
  try {
    const report = JSON.parse(fs.readFileSync(abs, 'utf8')) as { checks?: Array<{ scope_revision_input?: ExecutionScopeInput }> };
    return (report.checks ?? []).map(check => check.scope_revision_input).filter((input): input is ExecutionScopeInput => !!input);
  } catch {
    return [];
  }
}

/**
 * D1.3 出生范围的**唯一**取法——两个出生入口（`--prepare-run` 与 fresh/detached runtime）
 * 原位换成它，不新增第三条路径：
 *  · 有 feature 冻结记录（且未转交）→ 返回它的**有效**范围（出生段 + 已应用 revisions），
 *    **不从候选重算**——「一次计算」就是这条：feature 上算过的 S1 不能在出生时退回 S0；
 *  · 没有记录 → 沿现状 `resolveFeatureExecutionScope`（从候选算）。
 */
export function resolveBirthExecutionScope(
  projectRoot: string,
  feature: string,
  workflow: WorkflowSpec,
  frameworkRoot?: string,
  requirement?: string,
): { scope: ExecutionScope | undefined; source: 'feature-record' | 'candidate' } {
  if (workflow.schema_version === '1.2') {
    const record = readFeatureFrozenScope(projectRoot, feature);
    if (record?.transferred_to) {
      // 已转交的记录**不得**静默回算候选——那会让「同一 feature 第二次出生」拿到一份
      // 与在跑 run 无关的范围。这是 D1.3 第三行的明确报错场景。
      throw new Error(`[execution-scope] feature 范围已转交给 run ${record.transferred_to}——请恢复该 run，或按既有 correction / successor 路径开新 run`);
    }
    if (record) {
      // 与冻结入口**同一套**候选漂移检查：候选变了而记录未经修订，出生同样不许放行。
      const candidateFingerprint = featureScopeCandidateFingerprint(projectRoot, feature);
      if (candidateFingerprint !== record.candidate_fingerprint) {
        throw new Error(`[execution-scope] 候选已变更而冻结范围未经修订，不能据此出生 | candidate_fingerprint=${candidateFingerprint.slice(0, 16)} frozen_candidate_fingerprint=${record.candidate_fingerprint.slice(0, 16)}`);
      }
      // 需求 provenance：与冻结/重解析同一条通道——出生带的需求必须与候选算过的那句一致。
      if (requirement?.trim()) assertCandidateRequirementProvenance(projectRoot, feature, workflow, frameworkRoot, requirement);
      return { scope: featureEffectiveScope(record), source: 'feature-record' };
    }
  }
  return { scope: resolveFeatureExecutionScope(projectRoot, feature, workflow, frameworkRoot, requirement), source: 'candidate' };
}

/**
 * 已有阶段产物的阶段清单——复用**既有**的阶段证据与 summary 读取器，不新造扫描规则。
 * 只要 summary 或 evidence manifest 任一在场，就算「这个阶段跑过」。
 */
function phasesWithExistingEvidence(projectRoot: string, feature: string, workflow: WorkflowSpec, frameworkRoot?: string): string[] {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { loadPhaseEvidenceManifest } = require('./phase-evidence-manifest') as typeof import('./phase-evidence-manifest');
  const { featurePhaseReportsDir } = require('../../config') as typeof import('../../config');
  /* eslint-enable @typescript-eslint/no-require-imports */
  const out: string[] = [];
  for (const artifact of workflow.artifacts) {
    if (artifact.scope !== 'feature') continue;
    const phase = artifact.id;
    let hasReport = false;
    try {
      const dir = featurePhaseReportsDir(projectRoot, feature, phase, frameworkRoot);
      // 第五轮阻断 5：`script-report.json` 由 harness 在 summary / evidence **之前**写
      //（`report-generator.ts` 的 generateScriptReport）——进程在那之后崩溃时，只剩它在场。
      // 漏查它就会把已经跑过的阶段静默归入一份新冻结记录。
      hasReport = fs.existsSync(path.join(dir, 'summary.json')) || fs.existsSync(path.join(dir, 'script-report.json'));
    } catch { hasReport = false; }
    let hasEvidence = false;
    try { hasEvidence = !!loadPhaseEvidenceManifest(projectRoot, feature, phase); } catch { hasEvidence = false; }
    if (hasReport || hasEvidence) out.push(phase);
  }
  return out;
}

/**
 * manifest 自带范围时的出生解析：**先**过 feature 记录的转交 / 候选漂移 / provenance 检查，
 * 再决定用哪一份范围。有 feature 记录时以记录的有效范围为准（转交对账在 `registerFeatureScopeTransfer`
 * 里做）；没有记录才用 manifest 自带值或候选重算。
 */
export function resolveBirthScopeForManifest(
  projectRoot: string,
  manifest: { feature: string; requirement?: string; execution_scope?: unknown },
  workflow: WorkflowSpec,
  frameworkRoot?: string,
): ExecutionScope | undefined {
  if (workflow.schema_version !== '1.2') return manifest.execution_scope ? validateExecutionScope(manifest.execution_scope) : undefined;
  const resolved = resolveBirthExecutionScope(projectRoot, manifest.feature, workflow, frameworkRoot, manifest.requirement);
  if (resolved.source === 'feature-record') return resolved.scope;
  return manifest.execution_scope ? validateExecutionScope(manifest.execution_scope) : resolved.scope;
}

/**
 * 用**既有**的 `resolveFeatureExecutionScope` 通道核一次需求 provenance（它内部会对
 * `request.requirement_basis` 走 `verifyBasisBinding` 重解析，文本分叉即 `input binding stale`）。
 * 这里只取它的「通过 / 抛错」，范围仍用冻结记录的有效范围——不重算、不换范围。
 */
function assertCandidateRequirementProvenance(
  projectRoot: string,
  feature: string,
  workflow: WorkflowSpec,
  frameworkRoot: string | undefined,
  requirement: string,
): void {
  resolveFeatureExecutionScope(projectRoot, feature, workflow, frameworkRoot, requirement);
}
