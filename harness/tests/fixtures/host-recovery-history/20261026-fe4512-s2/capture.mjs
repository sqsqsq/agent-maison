#!/usr/bin/env node
// Development evidence only: copy from the host, never execute or write there.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOST = 'D:/1.code/SimulatedWalletForHmos';
const FEATURE = 'doc/features/bc-openCard-2/bank-card-opening-flow';
const RUN = `${FEATURE}/goal-runs/20261023T044016Z-fe4512`;
const BASE = path.resolve(HERE, '../20261024-fe4512-s1');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = file => fs.readFileSync(file);
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

function capturedBytes(file, original) {
  if (file.endsWith('.log') || /\.(png|jpe?g|gz)$/i.test(file)) return { bytes: original };
  const text = original.toString('utf8');
  if (!text.includes('\r\n')) return { bytes: original };
  assert(!/(?<!\r)\n|\r(?!\n)/.test(text), `Mixed newlines require an explicit byte-preservation rule: ${file}`);
  return { bytes: Buffer.from(text.replace(/\r\n/g, '\n')), normalization: 'CRLF->LF only' };
}

function originalBytes(row) {
  const bytes = read(path.join(HERE, row.file));
  assert.equal(hash(bytes), row.sha256, row.file);
  assert.equal(bytes.length, row.bytes, row.file);
  const restored = row.normalization ? Buffer.from(bytes.toString('utf8').replace(/\n/g, '\r\n')) : bytes;
  assert.equal(hash(restored), row.source_sha256, `Original source SHA: ${row.file}`);
  return restored;
}

if (process.argv.includes('--capture')) {
  const base = readJson(path.join(BASE, 'sources.json'));
  const selected = new Map();
  const add = (sourceFile, file = sourceFile) => {
    const source = path.join(HOST, sourceFile);
    if (fs.existsSync(source) && fs.statSync(source).isFile()) selected.set(file, { source, sourceFile });
  };
  const walk = rel => {
    const abs = path.join(HOST, rel);
    for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
      const item = `${rel}/${ent.name}`;
      if (ent.isDirectory()) walk(item);
      else add(item);
    }
  };
  // Reuse S1 unchanged bytes; capture every changed file in its existing input set.
  for (const row of base.files) {
    const source = path.join(HOST, row.file);
    if (!fs.existsSync(source) || row.extraction) continue;
    const candidate = capturedBytes(row.file, read(source));
    if (hash(candidate.bytes) !== row.sha256) add(row.file);
  }
  for (const rel of ['manifest.json', 'events.jsonl', 'progress.json', 'progress.md', 'goal-report.json',
    'goal-report.md', 'run-control.json', 'intermediate-rounds.journal.jsonl', 'liveness.json']) add(`${RUN}/${rel}`);
  walk(`${RUN}/phases/plan`);
  walk(`${RUN}/phases/plan-verifier-format-repair`);
  walk(`${FEATURE}/plan/reports`);
  walk(`${FEATURE}/ut/reports/20261024T192859Z-969`);
  for (const rel of ['acceptance.yaml', 'change-unit.yaml', 'contracts.yaml', 'use-cases.yaml',
    'feature.yaml', 'next.json', 'context/facts.md', 'plan/plan.md']) add(`${FEATURE}/${rel}`);
  for (const rel of ['component-blueprint.yaml', 'component-blueprint.review.md']) add(`doc/features/bc-openCard-2/blueprint/${rel}`);
  for (const rel of ['domain/service/OtpService.ets', 'domain/service/BankCardOpeningService.ets',
    'presentation/components/OtpVerificationSheet.ets', 'shared/constant/BankConstants.ets']) add(`02-Feature/WalletMain/src/main/ets/${rel}`);
  for (const rel of ['bank_open_card_ut.test.ets', 'spy/SpyBankCardOpeningDependencies.ets']) add(`02-Feature/WalletMain/src/ohosTest/ets/test/${rel}`);
  add('framework/RELEASE-MANIFEST.json', 'evidence/RELEASE-MANIFEST.json');
  add('framework/RELEASE-MANIFEST.sha256', 'evidence/RELEASE-MANIFEST.sha256');
  add('hvigor/hvigor-config.json5');
  const files = [...selected.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([file, source]) => {
    const original = read(source.source);
    const captured = capturedBytes(file, original);
    const target = path.join(HERE, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, captured.bytes);
    return { file, source: `${HOST}/${source.sourceFile}`, source_sha256: hash(original),
      sha256: hash(captured.bytes), bytes: captured.bytes.length,
      ...(captured.normalization ? { normalization: captured.normalization } : {}) };
  });
  const sources = { captured_at: new Date().toISOString(), host_root: HOST, feature: FEATURE,
    run_id: '20261023T044016Z-fe4512', base_fixture: '../20261024-fe4512-s1',
    base_sources_sha256: hash(read(path.join(BASE, 'sources.json'))),
    missing: [
      'plan-i26 author output and its prompt were overwritten at the fixed phase path by plan-i28; request-e3.json and original events survive, but current phase output is not its historical output.',
      'verifier.report.75dbc... was overwritten by the format-repair attempt; this snapshot records the present bytes only. S1 original verifier bytes and S2 events may be combined explicitly for a replay, never presented as recovered S2 historical bytes.',
      'Earlier raw gate snapshots overwritten at fixed report paths are unavailable. The retained plan/reports script report timestamp is inside plan-i28 final harness_start/end and its summary binds the same run; original events remain authoritative for earlier calls.',
      'Unrelated detach, other author logs, device screenshots and work directories remain only on the host. S0/S1 already retained applicable earlier execution evidence; no device or host harness was run.',
    ], files };
  fs.writeFileSync(path.join(HERE, 'sources.json'), `${JSON.stringify(sources, null, 2)}\n`);
}

const sources = readJson(path.join(HERE, 'sources.json'));
assert.equal(hash(read(path.join(BASE, 'sources.json'))), sources.base_sources_sha256, 'S1 source manifest');
for (const row of sources.files) {
  const original = originalBytes(row);
  if (process.argv.includes('--verify-source')) assert.deepEqual(read(row.source), original, `Host source drift: ${row.file}`);
}
const events = fs.readFileSync(path.join(HERE, RUN, 'events.jsonl'), 'utf8').trim().split(/\r?\n/).map(JSON.parse);
const settled = events.find(e => e.type === 'agent_process_settled' && e.invoke_id === 'plan-i28');
assert(settled, 'The author settled before gate reuse');
const verdict = events.findLast(e => e.type === 'phase_verdict' && e.invoke_id === 'plan-i28');
assert.equal(verdict.verdict, 'FAIL');
assert.equal(verdict.harness_exit, 0);
assert.equal(verdict.blocker_signature, 'open_finding:acceptance_to_interface');
const gate = readJson(path.join(HERE, FEATURE, 'plan/reports/script-report.json'));
const start = events.findLast(e => e.type === 'harness_start' && e.invoke_id === 'plan-i28');
const end = events.findLast(e => e.type === 'harness_end' && e.invoke_id === 'plan-i28');
assert.equal(gate.summary.verdict, 'PASS');
assert(Date.parse(start.ts) <= Date.parse(gate.timestamp) && Date.parse(gate.timestamp) <= Date.parse(end.ts));
const progress = readJson(path.join(HERE, RUN, 'progress.json'));
assert.equal(progress.budget.turns_used, 29);
assert.equal(progress.budget.turns_limit, 30);
const ut = readJson(path.join(HERE, FEATURE, 'ut/reports/20261024T192859Z-969/ut/frozen.ut-result.WalletMain.json'));
assert.deepEqual(ut.testResult, { total: 26, passed: 26, failed: 0, skipped: 0, failures: [] });
const utManifest = readJson(path.join(BASE, FEATURE, 'ut/reports/phase-evidence-manifest.json'));
const boundFiles = [...utManifest.inputs, ...utManifest.outputs];
for (const row of sources.files.filter(row => row.file.startsWith('02-Feature/'))) {
  assert.equal(boundFiles.find(file => file.path === row.file)?.sha256, row.source_sha256, `UT-bound source: ${row.file}`);
}
for (const rel of ['plan/plan.md', 'contracts.yaml', 'use-cases.yaml']) {
  const file = `${FEATURE}/${rel}`;
  const base = readJson(path.join(BASE, 'sources.json')).files.find(row => row.file === file);
  assert.equal(sources.files.find(row => row.file === file).source_sha256, base.source_sha256 ?? base.sha256, `Unchanged product: ${file}`);
}
console.log(JSON.stringify({ ok: true, files: sources.files.length, bytes: sources.files.reduce((n, row) => n + row.bytes, 0),
  events: events.length, raw_gate: gate.summary.verdict, current_verdict: verdict.verdict,
  turns: `${progress.budget.turns_used}/${progress.budget.turns_limit}`, ut: `${ut.testResult.passed}/${ut.testResult.total}` }));
