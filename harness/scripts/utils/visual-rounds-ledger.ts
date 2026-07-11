/**
 * visual-rounds-ledger.ts — t1（plan f7a3d9c2）：视觉迭代轮次账本 + 指纹级 no-progress
 * 熔断的 SSOT 纯逻辑层。
 *
 * 定位：telemetry/标注侧车（非判定文件，不含 verdict/分数/签字——tamper-scan 红线外）。
 * 账本行由 harness-runner 在 check 之后追加（runner 写、check 只读判定）；goal-runner
 * 在 gate/resume 时反向对账（events.jsonl ↔ ledger 的 row_hash，运行时一致性防护——
 * events 与 ledger 均在 agent 可写工作区，本模块不宣称对协同篡改双文件的密码学防护）。
 *
 * 轮次模型（rev4/rev5/rev6 三轮 review 收敛）：
 * - base_state_hash = hash(build_fingerprint, screens_hash, defect_fingerprints,
 *   source_fail_hit_ids, fingerprintable)——source_fail_hit_ids 取**计算 fuse 之前**的
 *   base hit id 集（排除 visual_diff_no_progress_fuse 自身与派生聚合 hit，防反馈环）。
 * - round_key = (loop_id, attempt_id, base_state_hash)。goal 态 attempt_id=invocation
 *   唯一 id（跨 --resume 单调，禁 retries+1）；交互态 attempt_id=null → 收窄：同状态
 *   重跑幂等吞（不判 no_fix_attempt），fuse 只覆盖"状态变了指纹没变"（ineffective_fix）。
 * - duplicate（同 round_key 已在账本）→ 不追加、**重放该行 decision**（fuse 裁决是轮次
 *   属性而非执行副作用——agent 自跑首检 fuse 后，外层 gate 必须仍能看到并 halt）。
 * - 熔断条件：与同 loop_id 最后一有效行（fingerprintable）比较，两轮指纹集**非空**且
 *   相等 + 本轮 awaitHumanOnly=false + 存在 actionable visual residual → fused。
 * - 归因：build 不同 → ineffective_fix（修了没用）；build 相同 → no_fix_attempt（跑了没修）。
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { featureDir } from '../../config';

export const VISUAL_ROUNDS_LEDGER_SCHEMA_VERSION = '1.0';

export interface VisualRoundDecision {
  fused: boolean;
  failure_kind?: 'no_progress_fuse';
  attribution?: 'no_fix_attempt' | 'ineffective_fix';
  /** 熔断时的残差指纹清单（halt 求人时的交付物） */
  residual_fingerprints?: string[];
}

export interface VisualRoundRow {
  schema_version: string;
  at: string;
  loop_id: string;
  goal_run_id?: string;
  attempt_id?: string;
  base_state_hash: string;
  build_fingerprint: string;
  screens_hash: string;
  defect_fingerprints: string[];
  source_fail_hit_ids: string[];
  /**
   * review-fix 轮2（codex P1-3）：未处置 actionable WARN 的稳定身份（candidate-blocking
   * WARN hit id + 未转录 warn finding_id）——WARN 从 A 变 B 不是同状态，不得重放旧 decision。
   */
  source_warn_ids: string[];
  fingerprintable: boolean;
  /** review-fix（codex P1-3）：决定性输入随行持久化——基线资格与状态身份都要吃它们 */
  actionable_residual: boolean;
  await_human_only: boolean;
  decision: VisualRoundDecision;
  row_hash: string;
}

export interface VisualRoundEvaluation {
  disposition: 'appended' | 'duplicate';
  decision: VisualRoundDecision;
  /** disposition=appended：待追加的新行（含 row_hash）；duplicate：命中的既有行 */
  row: VisualRoundRow;
  /** 读取账本时跳过的损坏行数（崩溃半行等，>0 时调用方发 WARN 注记） */
  corrupt_lines: number;
}

/** 账本路径（feature 侧车，与 critic-receipt 同目录层级） */
export function visualRoundsLedgerPath(projectRoot: string, feature: string): string {
  return path.join(featureDir(projectRoot, feature), 'device-testing', 'reports', 'visual-rounds.ledger.jsonl');
}

/**
 * canonical JSON：键按字典序递归排序、无空白——row_hash 的唯一序列化口径
 * （字段序/换行/缩进不参与 hash；数组保持语义序，语义上无序的数组由调用方先排序）。
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const rec = value as Record<string, unknown>;
  const keys = Object.keys(rec).filter(k => rec[k] !== undefined).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalJson(rec[k])}`).join(',')}}`;
}

/** row_hash = sha256(canonicalJson(去 row_hash 后的行)) 前 16 hex */
export function computeRowHash(row: Omit<VisualRoundRow, 'row_hash'>): string {
  return crypto.createHash('sha256').update(canonicalJson(row)).digest('hex').slice(0, 16);
}

/**
 * base_state_hash——评估状态身份。输入数组在此排序（顺序无关）；
 * source_fail_hit_ids 由调用方保证为 fuse 计算之前的 base 集（排除 fuse 自身/派生聚合 hit）。
 * review-fix（codex P1-3）：一切影响 decision 的输入都进状态 hash——actionable/awaitHuman
 * 变化（如同指纹下从 candidate-pass 转 actionable）是新评估状态，不得被同键去重吞掉。
 */
export function computeBaseStateHash(input: {
  buildFingerprint: string;
  screensHash: string;
  defectFingerprints: string[];
  sourceFailHitIds: string[];
  /** 未处置 actionable WARN 身份（可缺省=[]，legacy 兼容） */
  sourceWarnIds?: string[];
  fingerprintable: boolean;
  actionableResidual: boolean;
  awaitHumanOnly: boolean;
}): string {
  const key = canonicalJson({
    build: input.buildFingerprint,
    screens: input.screensHash,
    fingerprints: [...input.defectFingerprints].sort(),
    fail_hits: [...input.sourceFailHitIds].sort(),
    warn_ids: [...(input.sourceWarnIds ?? [])].sort(),
    fingerprintable: input.fingerprintable,
    actionable: input.actionableResidual,
    await_human: input.awaitHumanOnly,
  });
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
}

/** 读账本：逐行 JSON.parse，损坏行（崩溃半行等）计数跳过、绝不中断 */
export function readVisualRoundsLedger(ledgerPath: string): { rows: VisualRoundRow[]; corruptLines: number } {
  if (!fs.existsSync(ledgerPath)) return { rows: [], corruptLines: 0 };
  const rows: VisualRoundRow[] = [];
  let corruptLines = 0;
  const raw = fs.readFileSync(ledgerPath, 'utf-8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as VisualRoundRow;
      if (
        parsed && typeof parsed === 'object' &&
        typeof parsed.loop_id === 'string' &&
        typeof parsed.base_state_hash === 'string' &&
        Array.isArray(parsed.defect_fingerprints) &&
        typeof parsed.fingerprintable === 'boolean' &&
        parsed.decision && typeof parsed.decision.fused === 'boolean'
      ) {
        rows.push(parsed);
      } else {
        corruptLines++;
      }
    } catch {
      corruptLines++;
    }
  }
  return { rows, corruptLines };
}

export interface VisualRoundInput {
  loopId: string;
  /** goal 态=invocation 唯一 id（跨 resume 单调）；交互态=null（收窄语义） */
  attemptId: string | null;
  goalRunId: string | null;
  /** 当前构建指纹；不可算时传空串（仍参与状态身份） */
  buildFingerprint: string;
  screensHash: string;
  defectFingerprints: string[];
  sourceFailHitIds: string[];
  /** review-fix 轮2：未处置 actionable WARN 身份（缺省 []） */
  sourceWarnIds?: string[];
  fingerprintable: boolean;
  /** rev5：仅 awaitHumanOnly=false 才计算 fuse（candidate-pass/求人路径优先） */
  awaitHumanOnly: boolean;
  /** rev5：结构化 actionable visual residual 谓词结果（非前缀判断，调用方计算） */
  actionableResidual: boolean;
  now?: () => string;
}

/**
 * 评估当前轮：只读账本 → duplicate 重放 / 新轮算 decision。**不写盘**——追加由
 * harness-runner 在 check 后调用 appendVisualRound（disposition=appended 时）。
 */
export function evaluateVisualRound(ledgerPath: string, input: VisualRoundInput): VisualRoundEvaluation {
  const { rows, corruptLines } = readVisualRoundsLedger(ledgerPath);
  const loopRows = rows.filter(r => r.loop_id === input.loopId);
  const baseStateHash = computeBaseStateHash({
    buildFingerprint: input.buildFingerprint,
    screensHash: input.screensHash,
    defectFingerprints: input.defectFingerprints,
    sourceFailHitIds: input.sourceFailHitIds,
    sourceWarnIds: input.sourceWarnIds ?? [],
    fingerprintable: input.fingerprintable,
    actionableResidual: input.actionableResidual,
    awaitHumanOnly: input.awaitHumanOnly,
  });

  // duplicate 判定：goal 态=同 (loop, attempt, state)；交互态（attempt 缺失）=同 (loop, state)。
  // 取**最后一个**命中行重放（同 round 可能被多次执行，decision 恒一致）。
  const isDuplicateOf = (r: VisualRoundRow): boolean => {
    if (r.base_state_hash !== baseStateHash) return false;
    if (input.attemptId !== null) return r.attempt_id === input.attemptId;
    return true;
  };
  const dupRow = [...loopRows].reverse().find(isDuplicateOf);
  if (dupRow) {
    return { disposition: 'duplicate', decision: dupRow.decision, row: dupRow, corrupt_lines: corruptLines };
  }

  // 新轮：与同 loop 最后一**有资格基线**比较——review-fix（codex P1-3）：基线除
  // fingerprintable 外还须 actionable_residual && !await_human_only（转录未净/求人态/
  // 无残差的轮不构成"上一轮修复目标"，与之比较会错误熔断）。legacy 行（无新字段）不作基线。
  const prevEligible = [...loopRows]
    .reverse()
    .find(r => r.fingerprintable && r.actionable_residual === true && r.await_human_only === false);
  const currentSorted = [...input.defectFingerprints].sort();
  let decision: VisualRoundDecision = { fused: false };
  if (
    prevEligible &&
    input.fingerprintable &&
    !input.awaitHumanOnly &&
    input.actionableResidual &&
    currentSorted.length > 0 &&
    prevEligible.defect_fingerprints.length === currentSorted.length &&
    [...prevEligible.defect_fingerprints].sort().every((v, i) => v === currentSorted[i])
  ) {
    decision = {
      fused: true,
      failure_kind: 'no_progress_fuse',
      attribution:
        prevEligible.build_fingerprint !== input.buildFingerprint ? 'ineffective_fix' : 'no_fix_attempt',
      residual_fingerprints: currentSorted,
    };
  }

  const rowBase: Omit<VisualRoundRow, 'row_hash'> = {
    schema_version: VISUAL_ROUNDS_LEDGER_SCHEMA_VERSION,
    at: (input.now ?? (() => new Date().toISOString()))(),
    loop_id: input.loopId,
    ...(input.goalRunId ? { goal_run_id: input.goalRunId } : {}),
    ...(input.attemptId !== null ? { attempt_id: input.attemptId } : {}),
    base_state_hash: baseStateHash,
    build_fingerprint: input.buildFingerprint,
    screens_hash: input.screensHash,
    defect_fingerprints: currentSorted,
    source_fail_hit_ids: [...input.sourceFailHitIds].sort(),
    source_warn_ids: [...(input.sourceWarnIds ?? [])].sort(),
    fingerprintable: input.fingerprintable,
    actionable_residual: input.actionableResidual,
    await_human_only: input.awaitHumanOnly,
    decision,
  };
  const row: VisualRoundRow = { ...rowBase, row_hash: computeRowHash(rowBase) };
  return { disposition: 'appended', decision, row, corrupt_lines: corruptLines };
}

/** 追加账本行（disposition=appended 时由 harness-runner 调用）。 */
export function appendVisualRound(ledgerPath: string, row: VisualRoundRow): void {
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.appendFileSync(ledgerPath, `${JSON.stringify(row)}\n`, 'utf-8');
}

export interface VisualRoundReceipt {
  loop_id: string;
  attempt?: string;
  row_hash?: string;
  /** review-fix（codex P1-2）：append 落盘失败必须如实上报——不得继续宣称 appended */
  disposition: 'appended' | 'duplicate' | 'append_failed';
  decision?: VisualRoundDecision;
}

/**
 * review-fix（codex P1-2）：提交轮次并产出 summary 回执——append 失败返回
 * `append_failed`（无 row_hash），消费方（goal-runner）据此立即 halt（fail-closed），
 * 绝不写入"已提交"的 events 期望。
 */
export function commitVisualRound(ledgerPath: string, evaluation: VisualRoundEvaluation): VisualRoundReceipt {
  const base = {
    loop_id: evaluation.row.loop_id,
    ...(evaluation.row.attempt_id ? { attempt: evaluation.row.attempt_id } : {}),
    decision: evaluation.decision,
  };
  if (evaluation.disposition === 'duplicate') {
    return { ...base, row_hash: evaluation.row.row_hash, disposition: 'duplicate' };
  }
  try {
    appendVisualRound(ledgerPath, evaluation.row);
    return { ...base, row_hash: evaluation.row.row_hash, disposition: 'appended' };
  } catch {
    return { ...base, disposition: 'append_failed' };
  }
}

// ---------------------------------------------------------------------------
// rev6：events ↔ ledger 反向对账（goal gate / resume 启动时调用）
// ---------------------------------------------------------------------------

export interface LedgerIntegrityIssue {
  kind: 'missing_row' | 'modified_row' | 'orphan_pending_stale' | 'corrupt_lines' | 'duplicate_row_hash';
  detail: string;
}

/**
 * goal 态一致性对账：events.jsonl 中记录的期望 row_hash 集 vs ledger 中同 loop_id 行。
 * review-fix（codex P1-1 / cursor Critical）后语义：
 * - **无条件执行**（不再以期望集非空为前置——期望恒空正是主路径的失效形态）；
 * - 期望集=events 所有携带 row_hash 的 visual_round（**含 duplicate**——row_hash 即账本
 *   行 hash，agent 先写→gate duplicate 的主路径也把行纳入期望）；
 * - events 有、ledger 无 → missing_row（删账本行=绕 fuse）；
 * - ledger 行 row_hash 重算不符 → modified_row（改行/改 decision）；
 * - ledger 有、events 无 → 仅当 attempt_id ∈ pendingAttemptIds（**已 start、未 commit**
 *   的 invocation——由事件回放收窄，不是本 run 全部历史）才收养；否则 orphan_pending_stale；
 * - goal loop 内出现**损坏行**（崩溃半行/坏 JSON）→ corrupt_lines（fail-closed：损坏
 *   不解释成空历史；交互态读取仍容忍 WARN，本函数只用于 goal 对账）；
 * - 同 loop 内**重复 row_hash** → duplicate_row_hash（复制行充数）。
 * ledger 文件缺失但 events 期望非空 → 全部 missing_row。
 */
export function reconcileLedgerWithEvents(input: {
  ledgerPath: string;
  loopId: string;
  expectedRowHashes: string[];
  pendingAttemptIds: string[];
}): {
  ok: boolean;
  issues: LedgerIntegrityIssue[];
  /** review-fix 轮2（codex P1-1）：被收养的 pending 行——调用方须补写 recovery event
   * 使其进入下次期望集（否则 pending attempt 永久存活、孤儿行可借其名义永续） */
  adopted: Array<{ attempt_id: string; row_hash: string }>;
} {
  const issues: LedgerIntegrityIssue[] = [];
  const adopted: Array<{ attempt_id: string; row_hash: string }> = [];
  const { rows, corruptLines } = readVisualRoundsLedger(input.ledgerPath);
  if (fs.existsSync(input.ledgerPath) && corruptLines > 0) {
    issues.push({
      kind: 'corrupt_lines',
      detail: `账本存在 ${corruptLines} 条不可解析行（崩溃半行/篡改）——goal 对账 fail-closed，须人工核查`,
    });
  }
  const loopRows = rows.filter(r => r.loop_id === input.loopId);
  const ledgerHashes = new Set(loopRows.map(r => r.row_hash));
  if (loopRows.length !== ledgerHashes.size) {
    issues.push({
      kind: 'duplicate_row_hash',
      detail: `同 loop 内存在重复 row_hash（${loopRows.length - ledgerHashes.size} 处）——复制行充数`,
    });
  }
  for (const expected of input.expectedRowHashes) {
    if (!ledgerHashes.has(expected)) {
      issues.push({
        kind: 'missing_row',
        detail: `events 期望 row_hash=${expected} 在账本缺失（删行/损坏不解释成空历史）`,
      });
    }
  }
  const expectedSet = new Set(input.expectedRowHashes);
  for (const r of loopRows) {
    const { row_hash: declared, ...rest } = r;
    const actual = computeRowHash(rest);
    if (actual !== declared) {
      issues.push({
        kind: 'modified_row',
        detail: `账本行 ${declared} 重算 hash=${actual} 不符（行内容/decision 被改）`,
      });
      continue;
    }
    if (!expectedSet.has(declared)) {
      const pendingOk = r.attempt_id !== undefined && input.pendingAttemptIds.includes(r.attempt_id);
      if (!pendingOk) {
        issues.push({
          kind: 'orphan_pending_stale',
          detail: `账本行 ${declared}（attempt=${r.attempt_id ?? 'n/a'}）不在 events 期望集且非未提交 invocation 的 pending 行`,
        });
      } else {
        adopted.push({ attempt_id: r.attempt_id!, row_hash: declared });
      }
    }
  }
  return { ok: issues.length === 0, issues, adopted };
}
