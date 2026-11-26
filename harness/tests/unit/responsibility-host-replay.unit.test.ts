import { beginUnitCase } from '../utils/unit-cases';
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as zlib from 'zlib';
import { factsBaselineFingerprint } from '../../scripts/utils/context-facts';
import { compareExistingTestPreservation } from '../../scripts/utils/repair-responsibility';
import type { UnitCaseResult } from '../run-unit';
const historyRoot = path.resolve(__dirname, '../fixtures/host-recovery-history');
const group = '20261022/20261022T103904Z-179a73';
const recorded = path.join(historyRoot, group);
const spy = '02-Feature/WalletMain/src/ohosTest/ets/test/spy/SpyBankRepository.ets';
const bankInfo = '02-Feature/WalletMain/src/main/ets/data/model/BankInfo.ets';
const sha = (bytes: Buffer | string): string => crypto.createHash('sha256').update(bytes).digest('hex');
const historyEvents = (): any[] => fs.readFileSync(path.join(recorded, 'events.jsonl'), 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line));

const cases: Array<{ name: string; run(): void | Promise<void> }> = [
  { name: '179a73 immutable history retains review FAIL, i5 UT-write contradiction, i6 baseline loss and terminal failure', run() {
    const sources = JSON.parse(fs.readFileSync(path.join(historyRoot, 'sources.json'), 'utf8'));
    for (const entry of sources.files.filter((item: { file: string }) => item.file.startsWith(`${group}/`))) {
      assert.equal(sha(fs.readFileSync(path.join(historyRoot, entry.file))), entry.sha256, entry.file);
      if (entry.raw_file) assert.equal(sha(zlib.gunzipSync(fs.readFileSync(path.join(historyRoot, entry.raw_file)))), entry.original_sha256, entry.raw_file);
    }
    const events = historyEvents();
    assert.deepStrictEqual(events.filter(event => event.type === 'phase_verdict').map(event => [event.invoke_id, event.verdict]), [
      ['spec-i1', 'PASS'], ['plan-i2', 'PASS'], ['coding-i3', 'PASS'], ['review-i4', 'FAIL'], ['coding-i5', 'FAIL'], ['coding-i6', 'FAIL'], ['coding-i7', 'FAIL'],
    ]);
    const i5 = events.find(event => event.type === 'agent_invoke_start' && event.invoke_id === 'coding-i5');
    const baseline = fs.readFileSync(path.join(recorded, 'facts.spec-original.md'), 'utf8');
    const beforeI6 = fs.readFileSync(path.join(recorded, 'facts.before-i6.md'), 'utf8');
    assert.equal(factsBaselineFingerprint(baseline), i5.facts_context.baseline.fingerprint);
    assert.equal(factsBaselineFingerprint(beforeI6), i5.facts_context.baseline.fingerprint);
    assert(beforeI6.includes('CR-001 返修前已核对'));
    assert(!beforeI6.includes('2026-10-22 本次重试实际重新读取'));
    for (const attempt of ['coding-i6', 'coding-i7']) assert.equal(events.find(event => event.type === 'agent_invoke_start' && event.invoke_id === attempt).facts_context.baseline, undefined);
    const observed = events.find(event => event.type === 'phase_write_observed' && event.invoke_id === 'coding-i5');
    assert.equal((observed.owned ?? []).length, 0);
    assert.equal(observed.observations[0].owner, 'ut');
    assert.equal(observed.observations[0].disposition, 'deferred_to_checker');
    assert.equal(sha(fs.readFileSync(path.join(recorded, 'SpyBankRepository.before.ets'))), observed.observations[0].pre_sha256);
    assert.equal(sha(fs.readFileSync(path.join(recorded, 'project', spy))), observed.observations[0].post_sha256);
    const modelChange = events.find(event => event.type === 'phase_write_observed' && event.invoke_id === 'coding-i3').owned.find((entry: { path: string }) => entry.path === bankInfo);
    assert.equal(sha(fs.readFileSync(path.join(recorded, 'BankInfo.before.ets'))), modelChange.pre_sha256);
    assert.equal(events.find(event => event.type === 'run_end').halt_reason, 'content_retry_exhausted');
    const review = fs.readFileSync(path.join(recorded, 'phases/review/harness/review-report.md'), 'utf8');
    const verification = fs.readFileSync(path.join(recorded, 'phases/review/harness/verifier.report.md'), 'utf8');
    assert(review.includes('| CR-002 | MAJOR | 视觉保真 |'));
    assert(verification.includes('- issue: CR-002\n  verdict: confirmed'));
  } },
  { name: '179a73 real two-line fixture repair preserves old tests; changed assertions, skips and unknown originals cannot acquire coding permission', run() {
    const before = fs.readFileSync(path.join(recorded, 'SpyBankRepository.before.ets'), 'utf8');
    const after = fs.readFileSync(path.join(recorded, 'project', spy), 'utf8');
    assert.equal(compareExistingTestPreservation(before, after).preserved, true);
    const test = "describe('old', () => { it('keeps assertion', 0, () => { expect(value).assertEqual(1); }); });\n";
    for (const changed of [test.replace('assertEqual(1)', 'assertEqual(2)'), test.replace("it('keeps", "it.skip('keeps"), test + "it('new', 0, () => {});\n"]) {
      assert.equal(compareExistingTestPreservation(test, changed).preserved, false);
    }
    assert.equal(compareExistingTestPreservation(undefined, after).preserved, false);
  } },
];

export async function runAll(): Promise<UnitCaseResult[]> {
  const results: UnitCaseResult[] = [];
  for (const test of cases) {
    const endUnitCase = beginUnitCase(test.name);
    if (!endUnitCase) continue;
    try { await test.run(); results.push({ name: test.name, ok: true }); }
    catch (error) { results.push({ name: test.name, ok: false, error: (error as Error).stack }); }
    finally {  endUnitCase(); }
  }
  return results;
}
