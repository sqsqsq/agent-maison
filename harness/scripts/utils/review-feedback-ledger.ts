/**
 * review-feedback-ledger.ts — t6（plan f7a3d9c2）：终审回灌台账。
 *
 * 所有者=visual-confirm CLI（真人 TTY 工具）：y/f/overrule 时经**崩溃可恢复事务**落账
 * （feedback_id + pending journal + 启动 reconciliation——普通文件系统无法原子双写
 * visual-diff.json 与 ledger，「同一事务」的诚实定义是崩溃可恢复而非原子）。
 * agent 不承担转录义务（靠 agent 转录=反馈不丢仍靠自觉）。
 *
 * ledger 为 **append-only jsonl**（台账语义，只增不改）；oracle_version 字段支撑
 * "oracle 代码变了 → 历史样本失效标注"的可推导性。
 *
 * FN/FP 归因（rev4 收窄，codex）：
 * - FP：overrule 自带 signal，按 signal 直接归因；
 * - FN：reject 且 machine snapshot 全绿 → 默认 **unattributed_fn**（全绿时程序无法知道
 *   "谁本应发现"）；可选 human_issue_kind（人描述问题类别）→ 程序按固定映射折算到预期
 *   detector family 计 FN——归因由程序完成，不让人自填 signals_that_missed。
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { featureDir } from '../../config';

export const FEEDBACK_LEDGER_SCHEMA_VERSION = '1.0';

export type HumanVerdict = 'approve' | 'reject' | 'overrule';

export type HumanIssueKind =
  | 'geometry_overlap'
  | 'text_placement'
  | 'missing_render'
  | 'visual_style'
  | 'other';

/** human_issue_kind → 预期 detector family 固定映射（FN 归因由程序完成） */
export const ISSUE_KIND_TO_DETECTOR_FAMILY: Record<HumanIssueKind, string> = {
  geometry_overlap: 'T8',
  text_placement: 'placement',
  missing_render: 'OCR',
  visual_style: 'critic',
  other: 'unattributed',
};

export interface MachineSignalsSnapshot {
  /** 该屏**可归属**命中（T8 stable/unstable findings 按 screen_id 归屏），全绿=空数组 */
  hits: Array<{ id: string; status: 'FAIL' | 'WARN' }>;
  /**
   * review-fix 轮3（codex P2-1）：报告级命中（OCR/placement/M1 等无逐屏归属的信号）——
   * 单独记录不冒充"该屏信号"；FN 判定要求两者皆空（报告级有 FAIL 时无法断言"机器全绿"），
   * 但 FN 不据此归因到具体屏。
   */
  report_level_hits?: Array<{ id: string; status: 'FAIL' | 'WARN' }>;
  build_fingerprint: string;
  screenshot_hash: string;
  /** layout-oracle 代码指纹（版本变化 → 历史样本失效标注） */
  oracle_version: string;
}

export interface FeedbackLedgerEntry {
  schema_version: string;
  at: string;
  feedback_id: string;
  feature: string;
  screen: string;
  human_verdict: HumanVerdict;
  reason?: string;
  /** 落账人署名（CLI TTY 采集；与 confirmed_by 同口径校验） */
  by?: string;
  /** overrule 必填：被否决的信号（FP 按 signal 归因的锚点） */
  signal?: string;
  finding_id?: string;
  /** reject 可选：真人描述的问题类别（程序映射 detector family 计 FN） */
  human_issue_kind?: HumanIssueKind;
  build_fingerprint: string;
  screenshot_hash: string;
  oracle_version: string;
  machine_signals_snapshot: MachineSignalsSnapshot;
}

export function reviewFeedbackLedgerPath(projectRoot: string, feature: string): string {
  return path.join(featureDir(projectRoot, feature), 'device-testing', 'reports', 'review-feedback.ledger.jsonl');
}

export function feedbackJournalPath(projectRoot: string, feature: string): string {
  return path.join(featureDir(projectRoot, feature), 'device-testing', 'reports', '.review-feedback.journal.json');
}

export function newFeedbackId(): string {
  return crypto.randomBytes(8).toString('hex');
}

export function readFeedbackLedger(ledgerPath: string): {
  entries: FeedbackLedgerEntry[];
  corruptLines: number;
} {
  if (!fs.existsSync(ledgerPath)) return { entries: [], corruptLines: 0 };
  const entries: FeedbackLedgerEntry[] = [];
  let corruptLines = 0;
  for (const line of fs.readFileSync(ledgerPath, 'utf-8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const e = JSON.parse(trimmed) as FeedbackLedgerEntry;
      if (
        e && typeof e === 'object' &&
        typeof e.feedback_id === 'string' &&
        typeof e.screen === 'string' &&
        (e.human_verdict === 'approve' || e.human_verdict === 'reject' || e.human_verdict === 'overrule')
      ) {
        entries.push(e);
      } else {
        corruptLines++;
      }
    } catch {
      corruptLines++;
    }
  }
  return { entries, corruptLines };
}

/** feedback_id 幂等：已存在同 id 条目则不追加（journal 恢复/重放安全） */
export function appendFeedbackEntry(ledgerPath: string, entry: FeedbackLedgerEntry): { appended: boolean } {
  const { entries } = readFeedbackLedger(ledgerPath);
  if (entries.some(e => e.feedback_id === entry.feedback_id)) return { appended: false };
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.appendFileSync(ledgerPath, `${JSON.stringify(entry)}\n`, 'utf-8');
  return { appended: true };
}

// ---------------------------------------------------------------------------
// 崩溃可恢复事务（journal）：写 pending → 原子替换 visual-diff.json → append ledger →
// journal 标 committed/删除；CLI 启动 reconciliation 按 feedback_id 幂等补账。
// ---------------------------------------------------------------------------

export interface FeedbackJournal {
  feedback_id: string;
  at: string;
  entry: FeedbackLedgerEntry;
  /** 事务里要写入 visual-diff.json 的完整新内容（原子替换：tmp+rename） */
  visual_diff_next: unknown;
  visual_diff_path: string;
  state: 'pending' | 'json_written';
}

export function writeFeedbackJournal(journalPath: string, journal: FeedbackJournal): void {
  fs.mkdirSync(path.dirname(journalPath), { recursive: true });
  fs.writeFileSync(journalPath, JSON.stringify(journal, null, 2), 'utf-8');
}

export function clearFeedbackJournal(journalPath: string): void {
  try {
    if (fs.existsSync(journalPath)) fs.unlinkSync(journalPath);
  } catch { /* 清理失败下次 reconcile */ }
}

/** 原子替换（同目录 tmp + rename） */
export function atomicWriteJson(targetPath: string, content: unknown): void {
  const tmp = `${targetPath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(content, null, 2)}\n`, 'utf-8');
  fs.renameSync(tmp, targetPath);
}

/**
 * 事务执行：journal(pending) → visual-diff.json 原子替换 → journal(json_written) →
 * ledger append（feedback_id 幂等）→ journal 清除。任一断点崩溃后由 reconcile 恢复。
 */
export function commitFeedbackTransaction(input: {
  journalPath: string;
  ledgerPath: string;
  journal: FeedbackJournal;
}): void {
  writeFeedbackJournal(input.journalPath, { ...input.journal, state: 'pending' });
  atomicWriteJson(input.journal.visual_diff_path, input.journal.visual_diff_next);
  writeFeedbackJournal(input.journalPath, { ...input.journal, state: 'json_written' });
  appendFeedbackEntry(input.ledgerPath, input.journal.entry);
  clearFeedbackJournal(input.journalPath);
}

/**
 * 启动 reconciliation：发现 pending journal → 按状态幂等补完事务（json 未写则重写、
 * ledger 未记则补记），随后清除。返回处置说明（CLI 打印给真人）。
 * review-fix（codex P1-5）：journal 内的 visual_diff_path 不再被无条件信任——须与调用方
 * 按 feature 重新派生的期望路径完全一致，否则视为被构造的 journal 丢弃（防真人启动确认
 * 命令时被诱导覆盖工作区任意 JSON）。
 */
export function reconcileFeedbackJournal(input: {
  journalPath: string;
  ledgerPath: string;
  /** 期望的 visual-diff.json 绝对路径（由 feature/phase 重新派生，非 journal 自述） */
  expectedVisualDiffPath: string;
}): { recovered: boolean; detail?: string } {
  if (!fs.existsSync(input.journalPath)) return { recovered: false };
  let journal: FeedbackJournal;
  try {
    journal = JSON.parse(fs.readFileSync(input.journalPath, 'utf-8')) as FeedbackJournal;
  } catch {
    clearFeedbackJournal(input.journalPath);
    return { recovered: true, detail: 'journal 损坏（半写）——已清除；上次操作未生效，请重做' };
  }
  if (!journal?.feedback_id || !journal.entry) {
    clearFeedbackJournal(input.journalPath);
    return { recovered: true, detail: 'journal 字段不全——已清除；上次操作未生效，请重做' };
  }
  if (
    typeof journal.visual_diff_path !== 'string' ||
    path.resolve(journal.visual_diff_path) !== path.resolve(input.expectedVisualDiffPath)
  ) {
    clearFeedbackJournal(input.journalPath);
    return {
      recovered: true,
      detail: `journal 目标路径与本 feature 期望不符（${journal.visual_diff_path}）——已丢弃不写盘（防覆盖任意文件）；上次操作未生效，请重做`,
    };
  }
  // pending：json 可能已写可能没写——重写一遍（原子替换幂等）再补 ledger
  if (journal.state === 'pending') {
    atomicWriteJson(journal.visual_diff_path, journal.visual_diff_next);
  }
  const { appended } = appendFeedbackEntry(input.ledgerPath, journal.entry);
  clearFeedbackJournal(input.journalPath);
  return {
    recovered: true,
    detail:
      `恢复未完成的反馈事务 feedback_id=${journal.feedback_id}（screen=${journal.entry.screen}，` +
      `${journal.entry.human_verdict}）：visual-diff.json 已确认写入，ledger ${appended ? '已补记' : '已存在（幂等跳过）'}`,
  };
}

// ---------------------------------------------------------------------------
// FP/FN 聚合（校准报告消费——升档评审的数据素材，非机制化升档）
// ---------------------------------------------------------------------------

export interface FeedbackAggregation {
  total_entries: number;
  approve_count: number;
  reject_count: number;
  overrule_count: number;
  /** FP：overrule 按 signal 归因 */
  fp_by_signal: Record<string, number>;
  /** FN：reject 且 snapshot 全绿 → unattributed（默认，全绿无法按 signal 归因） */
  fn_unattributed: number;
  /** FN（可选增强）：human_issue_kind 经固定映射折算到 detector family 的估计 */
  fn_by_family: Record<string, number>;
  /** oracle_version 与最新条目不同的历史样本数（失效标注） */
  stale_oracle_version_entries: number;
}

export function aggregateFeedbackLedger(entries: FeedbackLedgerEntry[]): FeedbackAggregation {
  const fpBySignal: Record<string, number> = {};
  const fnByFamily: Record<string, number> = {};
  let fnUnattributed = 0;
  let approve = 0;
  let reject = 0;
  let overrule = 0;
  const latestOracle = entries.length > 0 ? entries[entries.length - 1].oracle_version : '';
  let stale = 0;
  for (const e of entries) {
    if (latestOracle && e.oracle_version !== latestOracle) stale++;
    if (e.human_verdict === 'approve') {
      approve++;
      continue;
    }
    if (e.human_verdict === 'overrule') {
      overrule++;
      const sig = e.signal?.trim() || 'unknown_signal';
      fpBySignal[sig] = (fpBySignal[sig] ?? 0) + 1;
      continue;
    }
    // reject：snapshot 全绿=FN 样本——"全绿"含报告级（报告级有命中时机器并非全绿，
    // 不计 FN；但报告级信号不冒充该屏归属）
    reject++;
    const allGreen =
      (e.machine_signals_snapshot?.hits ?? []).length === 0 &&
      (e.machine_signals_snapshot?.report_level_hits ?? []).length === 0;
    if (!allGreen) continue; // 有信号命中的 reject 不是漏检——信号已见，属处置分歧，不计 FN
    if (e.human_issue_kind && e.human_issue_kind !== 'other') {
      const family = ISSUE_KIND_TO_DETECTOR_FAMILY[e.human_issue_kind];
      fnByFamily[family] = (fnByFamily[family] ?? 0) + 1;
    } else {
      fnUnattributed++;
    }
  }
  return {
    total_entries: entries.length,
    approve_count: approve,
    reject_count: reject,
    overrule_count: overrule,
    fp_by_signal: fpBySignal,
    fn_unattributed: fnUnattributed,
    fn_by_family: fnByFamily,
    stale_oracle_version_entries: stale,
  };
}
