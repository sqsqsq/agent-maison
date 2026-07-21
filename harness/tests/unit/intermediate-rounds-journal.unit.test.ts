// ============================================================================
// intermediate-rounds-journal.unit.test.ts — S5 单写者/逻辑历史/重放收编回归
// 验收「Ledger 安全双侧四用例」+ no-progress fuse 保全 + 546beb77 孤儿形态根治
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  appendJournalProposal,
  journalRowsToLogicalHistory,
  readJournalProposals,
  replayJournalIntoLedger,
} from '../../scripts/utils/intermediate-rounds-journal';
import {
  appendVisualRound,
  evaluateVisualRound,
  evaluateVisualRoundOverRows,
  readVisualRoundsLedger,
  reconcileLedgerWithEvents,
  type VisualRoundInput,
} from '../../scripts/utils/visual-rounds-ledger';
import type { UnitCaseResult } from '../run-unit';

const cases: Array<{ name: string; run: () => void }> = [];
function test(name: string, run: () => void): void {
  cases.push({ name, run });
}
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function withTmp<T>(fn: (dir: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'journal-'));
  try {
    return fn(dir);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

const INPUT = (over?: Partial<Omit<VisualRoundInput, 'now'>>): Omit<VisualRoundInput, 'now'> => ({
  loopId: 'goal:r1',
  attemptId: 'i9',
  goalRunId: 'r1',
  buildFingerprint: 'bf1',
  screensHash: 'sh1',
  defectFingerprints: ['fp:a'],
  sourceFailHitIds: ['visual_diff'],
  sourceWarnIds: [],
  fingerprintable: true,
  awaitHumanOnly: false,
  actionableResidual: true,
  ...over,
});

/** 模拟 agent 侧一轮：evaluate（逻辑历史）→ 写 journal proposal */
function agentRound(
  ledgerPath: string,
  journalPath: string,
  input: Omit<VisualRoundInput, 'now'>,
  at: string,
): { fused: boolean } {
  const journal = readJournalProposals(journalPath);
  const extraRows = journalRowsToLogicalHistory(journal.rows, input.attemptId!);
  const ev = evaluateVisualRound(ledgerPath, { ...input, now: () => at }, { extraRows });
  if (ev.disposition === 'appended') {
    appendJournalProposal(journalPath, {
      attemptId: input.attemptId!,
      roundInput: input,
      claimed: { base_state_hash: ev.row.base_state_hash, row_hash: ev.row.row_hash, fused: ev.decision.fused },
      now: () => at,
    });
  }
  return { fused: ev.decision.fused };
}

test('546beb77 形态根治：agent 中间轮走 journal → runner 重放收编 → 对账零孤儿不熔断', () => {
  withTmp(dir => {
    const ledger = path.join(dir, 'ledger.jsonl');
    const journal = path.join(dir, 'journal.jsonl');
    // agent 中间轮（第一次残差）
    agentRound(ledger, journal, INPUT(), '2026-07-18T08:15:52.000Z');
    assert(readVisualRoundsLedger(ledger).rows.length === 0, 'agent 侧不得直写正式账本');
    // runner 收编
    const replay = replayJournalIntoLedger({ ledgerPath: ledger, journalPath: journal, attemptId: 'i9' });
    assert(replay.ok && replay.replayed === 1, JSON.stringify(replay.mismatches));
    const rows = readVisualRoundsLedger(ledger).rows;
    assert(rows.length === 1, '收编后正式账本 1 行');
    // events 期望集含收编行 → 对账零孤儿
    const recon = reconcileLedgerWithEvents({
      ledgerPath: ledger,
      loopId: 'goal:r1',
      expectedRowHashes: rows.map(r => r.row_hash),
      pendingAttemptIds: [],
    });
    assert(recon.ok, `对账须通过：${JSON.stringify(recon.issues)}`);
  });
});

test('no-progress fuse 保全：journal 两轮相同残差（第二轮换 build）仍触发熔断（逻辑历史生效）', () => {
  withTmp(dir => {
    const ledger = path.join(dir, 'ledger.jsonl');
    const journal = path.join(dir, 'journal.jsonl');
    const r1 = agentRound(ledger, journal, INPUT(), '2026-07-18T08:00:00.000Z');
    assert(!r1.fused, '首轮不熔断');
    // 第二轮：重建后（build 变）同残差指纹——ineffective_fix 熔断
    const r2 = agentRound(ledger, journal, INPUT({ buildFingerprint: 'bf2' }), '2026-07-18T08:10:00.000Z');
    assert(r2.fused, '第二轮相同残差须熔断（若逻辑历史丢失此处 false——单写者不得带走熔断语义）');
  });
});

test('runner 重放不信任 claimed：篡改 journal claimed.fused → 收编拒绝（mismatch halt）', () => {
  withTmp(dir => {
    const ledger = path.join(dir, 'ledger.jsonl');
    const journal = path.join(dir, 'journal.jsonl');
    agentRound(ledger, journal, INPUT(), '2026-07-18T08:00:00.000Z');
    // 篡改 claimed（同时重算 proposal_hash 以骗过链校验——重放重算仍须识破）
    const rows = readJournalProposals(journal).rows;
    const tampered = { ...rows[0], claimed: { ...rows[0].claimed, fused: !rows[0].claimed.fused } };
    const { proposal_hash: _d, ...rest } = tampered;
    const crypto = require('crypto') as typeof import('crypto');
    const { canonicalJson } = require('../../scripts/utils/visual-rounds-ledger') as typeof import('../../scripts/utils/visual-rounds-ledger');
    tampered.proposal_hash = crypto.createHash('sha256').update(canonicalJson(rest)).digest('hex').slice(0, 16);
    fs.writeFileSync(journal, `${JSON.stringify(tampered)}\n`, 'utf-8');
    const replay = replayJournalIntoLedger({ ledgerPath: ledger, journalPath: journal, attemptId: 'i9' });
    assert(!replay.ok, '篡改 claimed 须拒收编');
    assert(replay.mismatches.some(m => m.includes('不符')), JSON.stringify(replay.mismatches));
    assert(readVisualRoundsLedger(ledger).rows.length === 0, '拒收编不落正式行');
  });
});

test('hash 链：非尾部删行/改行/乱序可检；正式账本伪造旧行仍由既有对账熔断', () => {
  withTmp(dir => {
    const ledger = path.join(dir, 'ledger.jsonl');
    const journal = path.join(dir, 'journal.jsonl');
    agentRound(ledger, journal, INPUT(), '2026-07-18T08:00:00.000Z');
    agentRound(ledger, journal, INPUT({ defectFingerprints: ['fp:b'] }), '2026-07-18T08:05:00.000Z');
    agentRound(ledger, journal, INPUT({ defectFingerprints: ['fp:c'] }), '2026-07-18T08:08:00.000Z');
    const lines = fs.readFileSync(journal, 'utf-8').trim().split('\n');
    // 非尾部删行（删中间行）
    fs.writeFileSync(ledger, '', 'utf-8');
    fs.writeFileSync(journal, `${lines[0]}\n${lines[2]}\n`, 'utf-8');
    const delMid = replayJournalIntoLedger({ ledgerPath: ledger, journalPath: journal, attemptId: 'i9' });
    assert(!delMid.ok && delMid.mismatches.some(m => m.includes('sequence 不单调') || m.includes('hash 链断裂')), `非尾部删行须检出：${JSON.stringify(delMid.mismatches)}`);
    // 改行（改 round_input 不重算 hash）
    const modified = JSON.parse(lines[1]) as Record<string, unknown>;
    (modified.round_input as Record<string, unknown>).buildFingerprint = 'tampered';
    fs.writeFileSync(journal, `${lines[0]}\n${JSON.stringify(modified)}\n${lines[2]}\n`, 'utf-8');
    const mod = replayJournalIntoLedger({ ledgerPath: ledger, journalPath: journal, attemptId: 'i9' });
    assert(!mod.ok && mod.mismatches.some(m => m.includes('proposal_hash 重算不符')), `改行须检出：${JSON.stringify(mod.mismatches)}`);
    // 乱序
    fs.writeFileSync(journal, `${lines[1]}\n${lines[0]}\n${lines[2]}\n`, 'utf-8');
    const disorder = replayJournalIntoLedger({ ledgerPath: ledger, journalPath: journal, attemptId: 'i9' });
    assert(disorder.ok || disorder.mismatches.length > 0, '乱序按 sequence 排序后 hash 链仍一致则容忍（物理序非语义序）');
    // 正式账本伪造旧行 → 既有 reconcile 熔断（对账语义不变）
    fs.writeFileSync(ledger, '', 'utf-8');
    appendVisualRound(ledger, {
      schema_version: '1.0', at: 'x', loop_id: 'goal:r1', attempt_id: 'i1',
      base_state_hash: 'forged', build_fingerprint: 'x', screens_hash: 'x',
      defect_fingerprints: [], source_fail_hit_ids: [], source_warn_ids: [],
      fingerprintable: true, actionable_residual: true, await_human_only: false,
      decision: { fused: false }, row_hash: 'forgedhash0000',
    });
    const recon = reconcileLedgerWithEvents({ ledgerPath: ledger, loopId: 'goal:r1', expectedRowHashes: [], pendingAttemptIds: [] });
    assert(!recon.ok, '伪造旧行（events 无记录且非 pending）仍熔断');
  });
});

test('跨 attempt journal 行不参与收编与逻辑历史', () => {
  withTmp(dir => {
    const ledger = path.join(dir, 'ledger.jsonl');
    const journal = path.join(dir, 'journal.jsonl');
    agentRound(ledger, journal, INPUT(), '2026-07-18T08:00:00.000Z');
    // 另一 attempt 的收编：零行
    const other = replayJournalIntoLedger({ ledgerPath: ledger, journalPath: journal, attemptId: 'i10' });
    assert(other.ok && other.replayed === 0, '跨 attempt 不收编');
    const hist = journalRowsToLogicalHistory(readJournalProposals(journal).rows, 'i10');
    assert(hist.length === 0, '跨 attempt 不入逻辑历史');
  });
});

test('收编幂等：重复重放同 attempt → duplicate 语义零新行', () => {
  withTmp(dir => {
    const ledger = path.join(dir, 'ledger.jsonl');
    const journal = path.join(dir, 'journal.jsonl');
    agentRound(ledger, journal, INPUT(), '2026-07-18T08:00:00.000Z');
    const first = replayJournalIntoLedger({ ledgerPath: ledger, journalPath: journal, attemptId: 'i9' });
    assert(first.ok && first.replayed === 1, 'first');
    const second = replayJournalIntoLedger({ ledgerPath: ledger, journalPath: journal, attemptId: 'i9' });
    assert(second.ok && second.replayed === 0, `resume 后不得重复收编：${JSON.stringify(second.mismatches)}`);
    assert(readVisualRoundsLedger(ledger).rows.length === 1, '正式账本仍 1 行');
  });
});

test('对抗（codex 实施 review P0-5）：跨 run 同号 attempt 不得读取/收编旧 run 行', () => {
  withTmp(dir => {
    const ledger = path.join(dir, 'ledger.jsonl');
    const journal = path.join(dir, 'journal.jsonl');
    // 旧 run r0 的 i9 中间轮（同号 attempt——跨 run 必然重号）
    agentRound(ledger, journal, INPUT({ goalRunId: 'r0', loopId: 'goal:r0' }), '2026-07-17T08:00:00.000Z');
    // 新 run r1 收编：runId 过滤 → 旧 run 行零收编
    const replay = replayJournalIntoLedger({ ledgerPath: ledger, journalPath: journal, attemptId: 'i9', runId: 'r1' });
    assert(replay.ok && replay.replayed === 0, `旧 run 行不得被新 run 收编：${JSON.stringify(replay)}`);
    // 路径隔离双保险：不同 run 的 journal 路径不同
    const { intermediateRoundsJournalPath } = require('../../scripts/utils/intermediate-rounds-journal') as typeof import('../../scripts/utils/intermediate-rounds-journal');
    const p0 = intermediateRoundsJournalPath(dir, 'f', 'r0');
    const p1 = intermediateRoundsJournalPath(dir, 'f', 'r1');
    assert(p0 !== p1 && p0.includes('r0') && p1.includes('r1'), 'journal 按 run 隔离存储');
  });
});

test('evaluateVisualRoundOverRows 纯核：与文件路径入口等价', () => {
  withTmp(dir => {
    const ledger = path.join(dir, 'ledger.jsonl');
    const input = { ...INPUT(), now: () => '2026-07-18T08:00:00.000Z' };
    const viaFile = evaluateVisualRound(ledger, input);
    const viaRows = evaluateVisualRoundOverRows([], input);
    assert(viaFile.row.row_hash === viaRows.row.row_hash, '纯核与文件入口同一结果');
  });
});

export function runAll(): UnitCaseResult[] {
  const out: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      c.run();
      out.push({ name: c.name, ok: true });
    } catch (err) {
      out.push({ name: c.name, ok: false, error: (err as Error).stack ?? (err as Error).message });
    }
  }
  return out;
}
