/**
 * review-feedback-ledger 单测（t6，plan f7a3d9c2）：崩溃可恢复事务 + feedback_id 幂等 +
 * FN/FP 程序推导（unattributed 默认 + issue_kind 映射）+ append-only。
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  aggregateFeedbackLedger,
  appendFeedbackEntry,
  atomicWriteJson,
  commitFeedbackTransaction,
  readFeedbackLedger,
  reconcileFeedbackJournal,
  writeFeedbackJournal,
  FEEDBACK_LEDGER_SCHEMA_VERSION,
  type FeedbackJournal,
  type FeedbackLedgerEntry,
} from '../../scripts/utils/review-feedback-ledger';
import type { UnitCaseResult } from '../run-unit';

const cases: Array<{ name: string; run: () => void }> = [];
function test(name: string, run: () => void): void {
  cases.push({ name, run });
}

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rfl-'));
}

function entry(over: Partial<FeedbackLedgerEntry> = {}): FeedbackLedgerEntry {
  return {
    schema_version: FEEDBACK_LEDGER_SCHEMA_VERSION,
    at: '2026-07-11T00:00:00.000Z',
    feedback_id: 'fb-0001',
    feature: 'bank-card',
    screen: 'home',
    human_verdict: 'reject',
    reason: '卡片阴影缺失',
    by: '盛某',
    build_fingerprint: 'build-aaa',
    screenshot_hash: 'hash-1111',
    oracle_version: 'oracle-v1',
    machine_signals_snapshot: {
      hits: [],
      build_fingerprint: 'build-aaa',
      screenshot_hash: 'hash-1111',
      oracle_version: 'oracle-v1',
    },
    ...over,
  };
}

function journal(dir: string, e: FeedbackLedgerEntry, vd: unknown = { screens: [] }): FeedbackJournal {
  return {
    feedback_id: e.feedback_id,
    at: e.at,
    entry: e,
    visual_diff_next: vd,
    visual_diff_path: path.join(dir, 'visual-diff.json'),
    state: 'pending',
  };
}

test('transaction_commits_json_then_ledger_then_clears_journal', () => {
  const dir = tmpDir();
  const journalPath = path.join(dir, '.journal.json');
  const ledgerPath = path.join(dir, 'ledger.jsonl');
  const e = entry();
  commitFeedbackTransaction({ journalPath, ledgerPath, journal: journal(dir, e, { screens: [{ screen_id: 'home', verdict: 'fail' }] }) });
  const vd = JSON.parse(fs.readFileSync(path.join(dir, 'visual-diff.json'), 'utf-8')) as { screens: unknown[] };
  assert.strictEqual(vd.screens.length, 1, 'visual-diff.json 已原子写入');
  assert.strictEqual(readFeedbackLedger(ledgerPath).entries.length, 1, 'ledger 已落账');
  assert.ok(!fs.existsSync(journalPath), 'journal 已清除');
});

test('crash_recovery_all_three_breakpoints', () => {
  // 断点①：journal(pending) 写完即崩（json/ledger 都没写）→ reconcile 补完整个事务
  {
    const dir = tmpDir();
    const journalPath = path.join(dir, '.journal.json');
    const ledgerPath = path.join(dir, 'ledger.jsonl');
    writeFeedbackJournal(journalPath, journal(dir, entry({ feedback_id: 'fb-b1' }), { screens: ['next'] }));
    const r = reconcileFeedbackJournal({ journalPath, ledgerPath, expectedVisualDiffPath: path.join(dir, 'visual-diff.json') });
    assert.ok(r.recovered);
    assert.ok(fs.existsSync(path.join(dir, 'visual-diff.json')), '断点① json 补写');
    assert.strictEqual(readFeedbackLedger(ledgerPath).entries[0]?.feedback_id, 'fb-b1', '断点① ledger 补记');
    assert.ok(!fs.existsSync(journalPath));
  }
  // 断点②：json 已写、ledger 未写（state=json_written）→ 补 ledger
  {
    const dir = tmpDir();
    const journalPath = path.join(dir, '.journal.json');
    const ledgerPath = path.join(dir, 'ledger.jsonl');
    const j = journal(dir, entry({ feedback_id: 'fb-b2' }), { screens: ['written'] });
    atomicWriteJson(j.visual_diff_path, j.visual_diff_next);
    writeFeedbackJournal(journalPath, { ...j, state: 'json_written' });
    const r = reconcileFeedbackJournal({ journalPath, ledgerPath, expectedVisualDiffPath: path.join(dir, 'visual-diff.json') });
    assert.ok(r.recovered);
    assert.strictEqual(readFeedbackLedger(ledgerPath).entries[0]?.feedback_id, 'fb-b2', '断点② ledger 补记');
  }
  // 断点③：ledger 已写、journal 未清 → 幂等跳过（不重复落账）
  {
    const dir = tmpDir();
    const journalPath = path.join(dir, '.journal.json');
    const ledgerPath = path.join(dir, 'ledger.jsonl');
    const e = entry({ feedback_id: 'fb-b3' });
    appendFeedbackEntry(ledgerPath, e);
    writeFeedbackJournal(journalPath, { ...journal(dir, e), state: 'json_written' });
    const r = reconcileFeedbackJournal({ journalPath, ledgerPath, expectedVisualDiffPath: path.join(dir, 'visual-diff.json') });
    assert.ok(r.recovered && /幂等跳过/.test(r.detail ?? ''));
    assert.strictEqual(readFeedbackLedger(ledgerPath).entries.length, 1, '断点③ 不重复落账');
  }
});

test('journal_path_mismatch_is_discarded_not_written', () => {
  // review-fix（codex P1-5）：构造 journal 指向别处 → 丢弃不写盘（防覆盖任意 JSON）
  const dir = tmpDir();
  const journalPath = path.join(dir, '.journal.json');
  const ledgerPath = path.join(dir, 'ledger.jsonl');
  const victim = path.join(dir, 'victim.json');
  fs.writeFileSync(victim, '{"precious":true}', 'utf-8');
  const j = journal(dir, entry({ feedback_id: 'fb-evil' }), { screens: ['pwned'] });
  writeFeedbackJournal(journalPath, { ...j, visual_diff_path: victim });
  const r = reconcileFeedbackJournal({ journalPath, ledgerPath, expectedVisualDiffPath: path.join(dir, 'visual-diff.json') });
  assert.ok(r.recovered && /路径与本 feature 期望不符/.test(r.detail ?? ''));
  assert.strictEqual(fs.readFileSync(victim, 'utf-8'), '{"precious":true}', '目标文件不得被覆盖');
  assert.strictEqual(readFeedbackLedger(ledgerPath).entries.length, 0, '不落账');
  assert.ok(!fs.existsSync(journalPath), 'journal 已清除');
});

test('feedback_id_idempotent_append', () => {
  const dir = tmpDir();
  const ledgerPath = path.join(dir, 'ledger.jsonl');
  assert.strictEqual(appendFeedbackEntry(ledgerPath, entry()).appended, true);
  assert.strictEqual(appendFeedbackEntry(ledgerPath, entry()).appended, false, '同 feedback_id 幂等');
  assert.strictEqual(readFeedbackLedger(ledgerPath).entries.length, 1);
});

test('aggregate_fp_by_signal_fn_unattributed_and_family_mapping', () => {
  const entries: FeedbackLedgerEntry[] = [
    // FP：overrule 自带 signal
    entry({ feedback_id: 'a', human_verdict: 'overrule', signal: 'A3_close_overlap_default' }),
    entry({ feedback_id: 'b', human_verdict: 'overrule', signal: 'A3_close_overlap_default' }),
    // FN：reject 且全绿、无 issue_kind → unattributed
    entry({ feedback_id: 'c', human_verdict: 'reject' }),
    // FN：reject 且全绿、有 issue_kind → 映射 detector family（geometry_overlap→T8）
    entry({ feedback_id: 'd', human_verdict: 'reject', human_issue_kind: 'geometry_overlap' }),
    // reject 但 snapshot 有命中（信号已见=处置分歧）→ 不计 FN
    entry({
      feedback_id: 'e',
      human_verdict: 'reject',
      machine_signals_snapshot: {
        hits: [{ id: 'B1_layout_group_divergent', status: 'WARN' }],
        build_fingerprint: 'build-aaa',
        screenshot_hash: 'hash-1111',
        oracle_version: 'oracle-v1',
      },
    }),
    entry({ feedback_id: 'f', human_verdict: 'approve' }),
  ];
  const agg = aggregateFeedbackLedger(entries);
  assert.strictEqual(agg.fp_by_signal.A3_close_overlap_default, 2, 'FP 按 signal 归因');
  assert.strictEqual(agg.fn_unattributed, 1, '全绿无类别 → unattributed（不宣称按 signal 归因）');
  assert.strictEqual(agg.fn_by_family.T8, 1, 'issue_kind 经固定映射折算 family');
  assert.strictEqual(agg.approve_count, 1);
  assert.strictEqual(agg.reject_count, 3);
  assert.strictEqual(agg.overrule_count, 2);
});

test('aggregate_marks_stale_oracle_version_entries', () => {
  const entries = [
    entry({ feedback_id: 'x1', oracle_version: 'oracle-v1' }),
    entry({ feedback_id: 'x2', oracle_version: 'oracle-v2' }),
  ];
  const agg = aggregateFeedbackLedger(entries);
  assert.strictEqual(agg.stale_oracle_version_entries, 1, '与最新 oracle_version 不同的历史样本被标失效');
});

test('ledger_read_skips_corrupt_lines', () => {
  const dir = tmpDir();
  const ledgerPath = path.join(dir, 'ledger.jsonl');
  appendFeedbackEntry(ledgerPath, entry());
  fs.appendFileSync(ledgerPath, '{"broken":\n', 'utf-8');
  const r = readFeedbackLedger(ledgerPath);
  assert.strictEqual(r.entries.length, 1);
  assert.strictEqual(r.corruptLines, 1);
});

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      c.run();
      results.push({ name: c.name, ok: true });
    } catch (e) {
      results.push({ name: c.name, ok: false, error: (e as Error).message });
    }
  }
  return results;
}
