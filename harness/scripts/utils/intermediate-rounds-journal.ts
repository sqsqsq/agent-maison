// ============================================================================
// intermediate-rounds-journal.ts — goal 态视觉中间轮 journal（单写者协议）
// （visual-capability-truth S5 / P0-E；修改 critic-loop-hardening ledger 对账规格）
// ----------------------------------------------------------------------------
// 20260718 事故：agent 在 attempt 内合法中途重跑 harness 直写正式 ledger → events
// 期望集无该 row_hash → 对账判孤儿 → visual_ledger_integrity 误熔断。
// 单写者协议：goal 态 agent 侧 harness 只写本 journal（proposal）；goal-runner 在
// agent invocation 结束后**顺序重放重算**（不信任 journal 自带 decision/row_hash，
// 仅作对照），全一致才写正式 ledger 行 + events；任一不一致 → halt。
// hash 链证明力边界（规格如实声明）：可检非尾部删行/插行/乱序/改行；**尾部截断属
// 非密码学边界**（需 runner 文件观察器/head checkpoint/IPC broker 锚定，本模块不承诺）。
// ============================================================================

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { featureDir } from '../../config';
import {
  canonicalJson,
  evaluateVisualRoundOverRows,
  readVisualRoundsLedger,
  appendVisualRound,
  type VisualRoundInput,
  type VisualRoundRow,
} from './visual-rounds-ledger';

export const JOURNAL_SCHEMA_VERSION = '1.0';
/** 每 invocation 中间轮上限（防 runaway journal；超限行拒收编 → halt） */
export const MAX_INTERMEDIATE_ROUNDS_PER_INVOCATION = 12;

export interface JournalProposalRow {
  schema_version: string;
  at: string;
  attempt_id: string;
  sequence: number;
  previous_proposal_hash: string | null;
  /** hash(canonicalJson(去 proposal_hash 的行)) 前 16 hex */
  proposal_hash: string;
  /** 完整评估输入面（runner 重放重算的依据——不是只存最终 row） */
  round_input: Omit<VisualRoundInput, 'now'>;
  /** agent 侧自算结果——仅对照，runner 重算不信任 */
  claimed: { base_state_hash: string; row_hash: string; fused: boolean };
  gate_fingerprint?: string;
}

/**
 * codex 实施 review P0-5：journal 按 **goal run 隔离**存储（goal-runs/<runId>/ 下）——
 * attempt 序号（iN）跨 run 必然重号，feature 级共享文件会让新 run 读到/收编旧 run 同号
 * 记录、旧损坏行永久污染后续 run。run 隔离 + 行内 goalRunId 双保险。
 */
export function intermediateRoundsJournalPath(projectRoot: string, feature: string, runId: string): string {
  return path.join(
    featureDir(projectRoot, feature),
    'goal-runs',
    runId,
    'intermediate-rounds.journal.jsonl',
  );
}

function proposalHash(row: Omit<JournalProposalRow, 'proposal_hash'>): string {
  return crypto.createHash('sha256').update(canonicalJson(row)).digest('hex').slice(0, 16);
}

export function readJournalProposals(p: string): { rows: JournalProposalRow[]; corruptLines: number } {
  const rows: JournalProposalRow[] = [];
  let corruptLines = 0;
  if (!fs.existsSync(p)) return { rows, corruptLines };
  for (const line of fs.readFileSync(p, 'utf-8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    try {
      const parsed = JSON.parse(t) as JournalProposalRow;
      if (
        parsed && typeof parsed === 'object' &&
        typeof parsed.attempt_id === 'string' &&
        typeof parsed.sequence === 'number' &&
        typeof parsed.proposal_hash === 'string' &&
        parsed.round_input && typeof parsed.round_input === 'object'
      ) {
        rows.push(parsed);
      } else corruptLines++;
    } catch {
      corruptLines++;
    }
  }
  return { rows, corruptLines };
}

/** agent 侧追加 proposal（hash 链：previous=同 attempt 最后一行的 proposal_hash）。 */
export function appendJournalProposal(
  journalPath: string,
  args: {
    attemptId: string;
    roundInput: Omit<VisualRoundInput, 'now'>;
    claimed: { base_state_hash: string; row_hash: string; fused: boolean };
    gateFingerprint?: string;
    now?: () => string;
  },
): JournalProposalRow {
  const { rows } = readJournalProposals(journalPath);
  const mine = rows.filter(r => r.attempt_id === args.attemptId);
  const base: Omit<JournalProposalRow, 'proposal_hash'> = {
    schema_version: JOURNAL_SCHEMA_VERSION,
    at: (args.now ?? (() => new Date().toISOString()))(),
    attempt_id: args.attemptId,
    sequence: mine.length,
    previous_proposal_hash: mine.length > 0 ? mine[mine.length - 1].proposal_hash : null,
    round_input: args.roundInput,
    claimed: args.claimed,
    ...(args.gateFingerprint ? { gate_fingerprint: args.gateFingerprint } : {}),
  };
  const row: JournalProposalRow = { ...base, proposal_hash: proposalHash(base) };
  fs.mkdirSync(path.dirname(journalPath), { recursive: true });
  fs.appendFileSync(journalPath, `${JSON.stringify(row)}\n`, 'utf-8');
  return row;
}

/** journal 行 → 逻辑历史视图行（agent 侧第 N+1 轮评估拼接用；claimed 值自信自用，收编时重算校验）。 */
export function journalRowsToLogicalHistory(rows: JournalProposalRow[], attemptId: string): VisualRoundRow[] {
  const out: VisualRoundRow[] = [];
  for (const r of rows.filter(x => x.attempt_id === attemptId).sort((a, b) => a.sequence - b.sequence)) {
    const i = r.round_input;
    out.push({
      schema_version: '1.0',
      at: r.at,
      loop_id: i.loopId,
      ...(i.goalRunId ? { goal_run_id: i.goalRunId } : {}),
      ...(i.attemptId !== null ? { attempt_id: i.attemptId } : {}),
      base_state_hash: r.claimed.base_state_hash,
      build_fingerprint: i.buildFingerprint,
      screens_hash: i.screensHash,
      defect_fingerprints: [...i.defectFingerprints].sort(),
      source_fail_hit_ids: [...i.sourceFailHitIds].sort(),
      source_warn_ids: [...(i.sourceWarnIds ?? [])].sort(),
      fingerprintable: i.fingerprintable,
      actionable_residual: i.actionableResidual,
      await_human_only: i.awaitHumanOnly,
      decision: { fused: r.claimed.fused },
      row_hash: r.claimed.row_hash,
    });
  }
  return out;
}

export interface ReplayResult {
  ok: boolean;
  committed: VisualRoundRow[];
  mismatches: string[];
  replayed: number;
}

/**
 * runner 收编 = 从 ledger 基线按 sequence 顺序重放重算（decision/base_state_hash/row_hash
 * 全部重新计算，journal claimed 仅比对）；hash 链/序单调/上限校验；任一不一致 →
 * ok:false（调用方 halt visual_ledger_integrity，不得静默收编）。
 * dryRun=false 时把重放通过的行写入正式 ledger 并返回 committed（调用方逐行写 events）。
 */
export function replayJournalIntoLedger(args: {
  ledgerPath: string;
  journalPath: string;
  attemptId: string;
  /** 收编只认本 run 的行（行内 round_input.goalRunId 双保险——路径隔离之外的纵深） */
  runId?: string;
  dryRun?: boolean;
}): ReplayResult {
  const mismatches: string[] = [];
  const { rows: journalRows, corruptLines } = readJournalProposals(args.journalPath);
  if (corruptLines > 0) {
    mismatches.push(`journal 存在 ${corruptLines} 条损坏行（崩溃半行/篡改）`);
  }
  const mine = journalRows.filter(
    r =>
      r.attempt_id === args.attemptId &&
      (!args.runId || r.round_input.goalRunId === args.runId),
  );
  if (mine.length === 0) return { ok: mismatches.length === 0, committed: [], mismatches, replayed: 0 };
  if (mine.length > MAX_INTERMEDIATE_ROUNDS_PER_INVOCATION) {
    mismatches.push(`中间轮数 ${mine.length} 超上限 ${MAX_INTERMEDIATE_ROUNDS_PER_INVOCATION}`);
    return { ok: false, committed: [], mismatches, replayed: 0 };
  }
  // hash 链与序校验（可检非尾部删行/插行/乱序/改行；尾部截断=已声明边界）
  let prevHash: string | null = null;
  mine.sort((a, b) => a.sequence - b.sequence);
  for (let i = 0; i < mine.length; i++) {
    const r = mine[i];
    if (r.sequence !== i) mismatches.push(`sequence 不单调：期望 ${i} 实得 ${r.sequence}`);
    if (r.previous_proposal_hash !== prevHash) {
      mismatches.push(`hash 链断裂于 sequence=${r.sequence}（previous 期望 ${prevHash ?? 'null'}）`);
    }
    const { proposal_hash: _drop, ...rest } = r;
    if (proposalHash(rest) !== r.proposal_hash) {
      mismatches.push(`proposal_hash 重算不符于 sequence=${r.sequence}（行被修改）`);
    }
    prevHash = r.proposal_hash;
  }
  if (mismatches.length > 0) return { ok: false, committed: [], mismatches, replayed: 0 };

  // 顺序重放重算（不信任 claimed）
  const { rows: ledgerRows } = readVisualRoundsLedger(args.ledgerPath);
  const committed: VisualRoundRow[] = [];
  for (const r of mine) {
    const evalRows = [...ledgerRows, ...committed];
    const ev = evaluateVisualRoundOverRows(evalRows, { ...r.round_input, now: () => r.at });
    if (ev.disposition === 'duplicate') {
      // 与已收编/已有行同 round_key——journal 自带 claimed 应与重放一致
      if (ev.row.row_hash !== r.claimed.row_hash) {
        mismatches.push(`sequence=${r.sequence} 重放为 duplicate 但 row_hash 与 claimed 不符`);
      }
      continue;
    }
    if (
      ev.row.base_state_hash !== r.claimed.base_state_hash ||
      ev.row.row_hash !== r.claimed.row_hash ||
      ev.decision.fused !== r.claimed.fused
    ) {
      mismatches.push(
        `sequence=${r.sequence} 重放结果与 claimed 不符（base ${ev.row.base_state_hash}≟${r.claimed.base_state_hash}，` +
        `row ${ev.row.row_hash}≟${r.claimed.row_hash}，fused ${ev.decision.fused}≟${r.claimed.fused}）——评估器漂移或 journal 被篡改`,
      );
      continue;
    }
    committed.push(ev.row);
  }
  if (mismatches.length > 0) return { ok: false, committed: [], mismatches, replayed: 0 };
  if (!args.dryRun) {
    for (const row of committed) appendVisualRound(args.ledgerPath, row);
  }
  return { ok: true, committed, mismatches, replayed: committed.length };
}
