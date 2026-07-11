/**
 * visual-rounds-ledger 单测（t1，plan f7a3d9c2）：state/round 二维轮次账本 + 指纹级熔断。
 * 覆盖 rev4/rev5/rev6 三轮 review 钉死的全矩阵：
 *  - 同 attempt 双写去重且 duplicate 重放 decision（fused=false/true 两态）
 *  - 跨 attempt 同状态追加并熔断（no_fix_attempt）——rev4 阻断修正的核心场景
 *  - 重建后同指纹熔断（ineffective_fix）
 *  - 交互态收窄：同状态吞、状态变后可熔
 *  - awaitHumanOnly 优先 / actionable residual 门 / 空集与不可指纹轮不比较
 *  - base_state_hash 排除 fuse 自身（source_fail_hit_ids 由调用方传 base 集——本模块只验
 *    "同输入同 hash/异输入异 hash"）
 *  - canonical row_hash 稳定性（字段序/数组序无关）
 *  - 跨 loop_id 隔离 / 损坏行容错
 *  - rev6 integrity：删行/改 decision → FAIL；pending 行按 attempt 收养；损坏≠空历史
 *  - resume 身份（codex 指定）：attempt A fused=false → 状态不变 + 新 attempt ≠ A → 追加并熔断
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  appendVisualRound,
  canonicalJson,
  computeBaseStateHash,
  computeRowHash,
  evaluateVisualRound,
  readVisualRoundsLedger,
  reconcileLedgerWithEvents,
  type VisualRoundInput,
  type VisualRoundRow,
} from '../../scripts/utils/visual-rounds-ledger';
import type { UnitCaseResult } from '../run-unit';

const cases: Array<{ name: string; run: () => void }> = [];
function test(name: string, run: () => void): void {
  cases.push({ name, run });
}

function tmpLedger(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vrl-'));
  return path.join(dir, 'visual-rounds.ledger.jsonl');
}

const NOW = () => '2026-07-11T00:00:00.000Z';

function baseInput(over: Partial<VisualRoundInput> = {}): VisualRoundInput {
  return {
    loopId: 'goal:run-1',
    attemptId: 'i1',
    goalRunId: 'run-1',
    buildFingerprint: 'build-aaa',
    screensHash: 'screens-1',
    defectFingerprints: ['home|overlap|close|0.1,0.1,0.2,0.2'],
    sourceFailHitIds: ['visual_diff'],
    fingerprintable: true,
    awaitHumanOnly: false,
    actionableResidual: true,
    now: NOW,
    ...over,
  };
}

test('canonical_row_hash_stable_regardless_of_field_and_array_order', () => {
  const a = canonicalJson({ b: 2, a: [3, 1], c: { y: 1, x: 2 } });
  const b = canonicalJson({ c: { x: 2, y: 1 }, a: [3, 1], b: 2 });
  assert.strictEqual(a, b, '键序无关');
  // 数组保持语义序（调用方排序）——row 构造时 defect_fingerprints/source_fail_hit_ids 已排序
  const row1 = evaluateVisualRound(tmpLedger(), baseInput({ defectFingerprints: ['b', 'a'], sourceFailHitIds: ['y', 'x'] })).row;
  const row2 = evaluateVisualRound(tmpLedger(), baseInput({ defectFingerprints: ['a', 'b'], sourceFailHitIds: ['x', 'y'] })).row;
  assert.strictEqual(row1.row_hash, row2.row_hash, '数组输入序无关（构造时排序）');
  const { row_hash, ...rest } = row1;
  assert.strictEqual(computeRowHash(rest), row_hash, 'row_hash=去自身字段后的 canonical hash');
});

test('base_state_hash_changes_with_fingerprints_and_hits', () => {
  const h1 = computeBaseStateHash({ buildFingerprint: 'b', screensHash: 's', defectFingerprints: ['f1'], sourceFailHitIds: ['x'], fingerprintable: true, actionableResidual: true, awaitHumanOnly: false });
  const h2 = computeBaseStateHash({ buildFingerprint: 'b', screensHash: 's', defectFingerprints: ['f2'], sourceFailHitIds: ['x'], fingerprintable: true, actionableResidual: true, awaitHumanOnly: false });
  const h3 = computeBaseStateHash({ buildFingerprint: 'b', screensHash: 's', defectFingerprints: ['f1'], sourceFailHitIds: ['x', 'visual_diff_layout_invariants'], fingerprintable: true, actionableResidual: true, awaitHumanOnly: false });
  const h1b = computeBaseStateHash({ buildFingerprint: 'b', screensHash: 's', defectFingerprints: ['f1'], sourceFailHitIds: ['x'], fingerprintable: true, actionableResidual: true, awaitHumanOnly: false });
  assert.ok(h1 !== h2 && h1 !== h3, '指纹/hit 集变化 → 状态变化');
  assert.strictEqual(h1, h1b, '同输入同 hash（critic 只改 defects 也算新状态由输入差异保证）');
});

test('decision_inputs_enter_state_hash_and_baseline_eligibility', () => {
  // review-fix（codex P1-3）：actionable/awaitHuman 变化=新状态（不被同键吞）
  const base = { buildFingerprint: 'b', screensHash: 's', defectFingerprints: ['f1'], sourceFailHitIds: ['x'], fingerprintable: true };
  const hA = computeBaseStateHash({ ...base, actionableResidual: true, awaitHumanOnly: false });
  const hB = computeBaseStateHash({ ...base, actionableResidual: false, awaitHumanOnly: false });
  const hC = computeBaseStateHash({ ...base, actionableResidual: true, awaitHumanOnly: true });
  assert.ok(hA !== hB && hA !== hC, '决定性输入变化 → 状态 hash 变化');
  // 基线资格：无资格上一轮（actionable=false / awaitHuman=true / 不可指纹）不作比较基线
  const ledger = tmpLedger();
  appendVisualRound(ledger, evaluateVisualRound(ledger, baseInput({ attemptId: 'i1', actionableResidual: false })).row);
  const afterIneligible = evaluateVisualRound(ledger, baseInput({ attemptId: 'i2' }));
  assert.strictEqual(afterIneligible.decision.fused, false, 'actionable=false 的轮不作熔断基线');
  appendVisualRound(ledger, evaluateVisualRound(ledger, baseInput({ attemptId: 'i3', awaitHumanOnly: true })).row);
  const afterAwait = evaluateVisualRound(ledger, baseInput({ attemptId: 'i4' }));
  assert.strictEqual(afterAwait.decision.fused, false, 'awaitHuman 轮不作熔断基线');
  // 有资格基线落账后，同指纹新轮才熔
  appendVisualRound(ledger, evaluateVisualRound(ledger, baseInput({ attemptId: 'i5' })).row);
  const fused = evaluateVisualRound(ledger, baseInput({ attemptId: 'i6' }));
  assert.strictEqual(fused.decision.fused, true, '有资格基线 + 同指纹 → 熔断');
});

test('commit_append_failed_reports_honestly', () => {
  // review-fix（codex P1-2）：append 落盘失败 → disposition=append_failed（无 row_hash）
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vrl-'));
  const bogusLedger = path.join(dir, 'as-dir'); // 让 append 撞目录名失败
  fs.mkdirSync(path.join(bogusLedger, 'visual-rounds.ledger.jsonl'), { recursive: true });
  const evaln = evaluateVisualRound(path.join(dir, 'clean.jsonl'), baseInput());
  const { commitVisualRound } = require('../../scripts/utils/visual-rounds-ledger');
  const receipt = commitVisualRound(path.join(bogusLedger, 'visual-rounds.ledger.jsonl'), evaln);
  assert.strictEqual(receipt.disposition, 'append_failed');
  assert.strictEqual(receipt.row_hash, undefined, 'append_failed 不得携带 row_hash 冒充已提交');
});

test('same_attempt_duplicate_replays_decision_not_append', () => {
  const ledger = tmpLedger();
  const first = evaluateVisualRound(ledger, baseInput());
  assert.strictEqual(first.disposition, 'appended');
  assert.strictEqual(first.decision.fused, false, '首轮无前置有效轮，不熔');
  appendVisualRound(ledger, first.row);
  // 同 attempt 同状态（agent 自跑后外层 gate 双写）→ duplicate 重放 fused=false
  const second = evaluateVisualRound(ledger, baseInput());
  assert.strictEqual(second.disposition, 'duplicate');
  assert.strictEqual(second.decision.fused, false, 'fused=false 也重放 false');
  assert.strictEqual(readVisualRoundsLedger(ledger).rows.length, 1, '不追加');
});

test('cross_attempt_same_state_appends_and_fuses_no_fix_attempt', () => {
  const ledger = tmpLedger();
  const a1 = evaluateVisualRound(ledger, baseInput({ attemptId: 'i1' }));
  appendVisualRound(ledger, a1.row);
  // attempt 2 原地重跑（状态完全不变）——rev4 修正的核心：必须追加并熔断，不能被吞
  const a2 = evaluateVisualRound(ledger, baseInput({ attemptId: 'i2' }));
  assert.strictEqual(a2.disposition, 'appended', '跨 attempt 同状态是新轮，不是 duplicate');
  assert.strictEqual(a2.decision.fused, true);
  assert.strictEqual(a2.decision.attribution, 'no_fix_attempt', 'build 未变=跑了没修');
  assert.deepStrictEqual(a2.decision.residual_fingerprints, [...baseInput().defectFingerprints].sort());
  appendVisualRound(ledger, a2.row);
  // 外层 gate 撞 attempt2 的 round_key → duplicate 重放 fused=true（rev5 关键：外层必须看到）
  const gate = evaluateVisualRound(ledger, baseInput({ attemptId: 'i2' }));
  assert.strictEqual(gate.disposition, 'duplicate');
  assert.strictEqual(gate.decision.fused, true, 'duplicate 重放 fused=true——外层 gate 稳定看到熔断');
});

test('resume_new_attempt_id_fuses_after_unchanged_state', () => {
  // codex 指定场景：attempt A 写 fused=false → 进程退出 → resume（新 attempt ≠ A）→
  // 状态不变 → 追加第二轮并触发 no_fix_attempt。
  const ledger = tmpLedger();
  const before = evaluateVisualRound(ledger, baseInput({ attemptId: 'i3' }));
  assert.strictEqual(before.decision.fused, false);
  appendVisualRound(ledger, before.row);
  // resume 后 attempt 序数从 events 回放恢复继续单调（i4），绝不回到 i1/i3
  const resumed = evaluateVisualRound(ledger, baseInput({ attemptId: 'i4' }));
  assert.strictEqual(resumed.disposition, 'appended');
  assert.strictEqual(resumed.decision.fused, true);
  assert.strictEqual(resumed.decision.attribution, 'no_fix_attempt');
});

test('rebuild_same_fingerprints_fuses_ineffective_fix', () => {
  const ledger = tmpLedger();
  appendVisualRound(ledger, evaluateVisualRound(ledger, baseInput({ attemptId: 'i1', buildFingerprint: 'build-aaa' })).row);
  // 重建重采（build/screens 变）但缺陷指纹原样——homepage 经典空转
  const r = evaluateVisualRound(
    ledger,
    baseInput({ attemptId: 'i2', buildFingerprint: 'build-bbb', screensHash: 'screens-2' }),
  );
  assert.strictEqual(r.decision.fused, true);
  assert.strictEqual(r.decision.attribution, 'ineffective_fix', 'build 变了=修了没用');
});

test('interactive_narrowing_same_state_swallowed_changed_state_fuses', () => {
  const ledger = tmpLedger();
  const interactive = (over: Partial<VisualRoundInput>) =>
    baseInput({ loopId: 'interactive:feat', attemptId: null, goalRunId: null, ...over });
  appendVisualRound(ledger, evaluateVisualRound(ledger, interactive({})).row);
  // 同状态重跑：幂等吞（诚实收窄——交互态无 attempt 身份，不判 no_fix_attempt）
  const rerun = evaluateVisualRound(ledger, interactive({}));
  assert.strictEqual(rerun.disposition, 'duplicate', '交互态同状态重跑被吞');
  // 状态变（重建）但指纹没变：ineffective_fix 仍可熔（无需 attempt 身份）
  const changed = evaluateVisualRound(ledger, interactive({ buildFingerprint: 'build-ccc' }));
  assert.strictEqual(changed.decision.fused, true);
  assert.strictEqual(changed.decision.attribution, 'ineffective_fix');
});

test('await_human_only_and_actionable_gate_suppress_fuse', () => {
  const ledger = tmpLedger();
  appendVisualRound(ledger, evaluateVisualRound(ledger, baseInput({ attemptId: 'i1' })).row);
  // candidate-pass 只差人签：awaitHumanOnly=true → 不熔（求人路径优先，rev5）
  const awaitHuman = evaluateVisualRound(ledger, baseInput({ attemptId: 'i2', awaitHumanOnly: true }));
  assert.strictEqual(awaitHuman.decision.fused, false, 'awaitHumanOnly 优先于 fuse');
  // 无 actionable residual（如仅 capability degradation/minor defects）→ 不熔
  const noActionable = evaluateVisualRound(ledger, baseInput({ attemptId: 'i3', actionableResidual: false }));
  assert.strictEqual(noActionable.decision.fused, false, '非 loop-actionable 残差不触发 fuse');
});

test('empty_or_ineligible_fingerprints_never_compare', () => {
  const ledger = tmpLedger();
  // 空指纹集（全 pending）两轮相等也不得真空熔断
  appendVisualRound(ledger, evaluateVisualRound(ledger, baseInput({ attemptId: 'i1', defectFingerprints: [] })).row);
  const empty = evaluateVisualRound(ledger, baseInput({ attemptId: 'i2', defectFingerprints: [] }));
  assert.strictEqual(empty.decision.fused, false, '空集不比较');
  // 不可指纹轮（rev10 计数门未过）不参与比较
  appendVisualRound(ledger, evaluateVisualRound(ledger, baseInput({ attemptId: 'i3', fingerprintable: false })).row);
  const afterIneligible = evaluateVisualRound(ledger, baseInput({ attemptId: 'i4' }));
  // 最后一有效行是 i1（空集）——i4 非空集与之不等 → 不熔；绝不拿 i3（无资格）比
  assert.strictEqual(afterIneligible.decision.fused, false);
});

test('cross_loop_isolation', () => {
  const ledger = tmpLedger();
  appendVisualRound(ledger, evaluateVisualRound(ledger, baseInput({ loopId: 'goal:old-run', attemptId: 'i9' })).row);
  // 新 run 起始状态与旧 run 相同：绝不跨 loop 比较/吞并
  const fresh = evaluateVisualRound(ledger, baseInput({ loopId: 'goal:new-run', attemptId: 'i1' }));
  assert.strictEqual(fresh.disposition, 'appended', '不被旧 loop 吞');
  assert.strictEqual(fresh.decision.fused, false, '不与旧 loop 比较');
});

test('corrupt_lines_skipped_and_counted', () => {
  const ledger = tmpLedger();
  const r = evaluateVisualRound(ledger, baseInput());
  appendVisualRound(ledger, r.row);
  fs.appendFileSync(ledger, '{"half":'); // 崩溃半行
  const read = readVisualRoundsLedger(ledger);
  assert.strictEqual(read.rows.length, 1);
  assert.strictEqual(read.corruptLines, 1);
  const evaluated = evaluateVisualRound(ledger, baseInput());
  assert.strictEqual(evaluated.corrupt_lines, 1, '损坏行计数暴露给调用方（WARN 注记）');
});

test('integrity_missing_and_modified_rows_fail_pending_adopted', () => {
  const ledger = tmpLedger();
  const r1 = evaluateVisualRound(ledger, baseInput({ attemptId: 'i1' }));
  appendVisualRound(ledger, r1.row);
  const r2 = evaluateVisualRound(ledger, baseInput({ attemptId: 'i2', buildFingerprint: 'build-bbb' }));
  appendVisualRound(ledger, r2.row);

  // 正常：events 期望 r1，r2 是当前 invocation 的 pending 行 → 收养
  const okRes = reconcileLedgerWithEvents({
    ledgerPath: ledger,
    loopId: 'goal:run-1',
    expectedRowHashes: [r1.row.row_hash],
    pendingAttemptIds: ['i2'],
  });
  assert.ok(okRes.ok, `pending 行按 attempt 收养：${JSON.stringify(okRes.issues)}`);

  // orphan：r2 不在期望集且非 pending attempt → FAIL
  const orphan = reconcileLedgerWithEvents({
    ledgerPath: ledger,
    loopId: 'goal:run-1',
    expectedRowHashes: [r1.row.row_hash],
    pendingAttemptIds: [],
  });
  assert.ok(!orphan.ok && orphan.issues.some(i => i.kind === 'orphan_pending_stale'));

  // 删行：期望的 r1 被删（只留 r2）→ missing_row（删账本≠空历史）
  fs.writeFileSync(ledger, `${JSON.stringify(r2.row)}\n`, 'utf-8');
  const missing = reconcileLedgerWithEvents({
    ledgerPath: ledger,
    loopId: 'goal:run-1',
    expectedRowHashes: [r1.row.row_hash],
    pendingAttemptIds: ['i2'],
  });
  assert.ok(!missing.ok && missing.issues.some(i => i.kind === 'missing_row'), '删上一轮账本行 → integrity FAIL');

  // 改 decision：row_hash 重算不符 → modified_row
  const tampered: VisualRoundRow = { ...r2.row, decision: { fused: false } };
  fs.writeFileSync(ledger, `${JSON.stringify(tampered)}\n`, 'utf-8');
  const modified = reconcileLedgerWithEvents({
    ledgerPath: ledger,
    loopId: 'goal:run-1',
    expectedRowHashes: [],
    pendingAttemptIds: ['i2'],
  });
  assert.ok(!modified.ok && modified.issues.some(i => i.kind === 'modified_row'), '改 decision → integrity FAIL');

  // corrupt 行在 goal 对账 fail-closed（交互态读取仍容忍——本函数只用于 goal）
  fs.writeFileSync(ledger, `${JSON.stringify(r2.row)}
{"half":`, 'utf-8');
  const corrupt = reconcileLedgerWithEvents({
    ledgerPath: ledger,
    loopId: 'goal:run-1',
    expectedRowHashes: [r2.row.row_hash],
    pendingAttemptIds: [],
  });
  assert.ok(!corrupt.ok && corrupt.issues.some(i => i.kind === 'corrupt_lines'), '损坏行 → integrity FAIL');

  // 重复 row_hash（复制行充数）→ integrity FAIL
  fs.writeFileSync(ledger, `${JSON.stringify(r2.row)}
${JSON.stringify(r2.row)}
`, 'utf-8');
  const dup = reconcileLedgerWithEvents({
    ledgerPath: ledger,
    loopId: 'goal:run-1',
    expectedRowHashes: [r2.row.row_hash],
    pendingAttemptIds: [],
  });
  assert.ok(!dup.ok && dup.issues.some(i => i.kind === 'duplicate_row_hash'), '复制行 → integrity FAIL');

  // ledger 整体缺失但 events 期望非空 → 全部 missing（损坏不解释成空历史）
  fs.unlinkSync(ledger);
  const gone = reconcileLedgerWithEvents({
    ledgerPath: ledger,
    loopId: 'goal:run-1',
    expectedRowHashes: [r1.row.row_hash],
    pendingAttemptIds: [],
  });
  assert.ok(!gone.ok && gone.issues.every(i => i.kind === 'missing_row'));
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
