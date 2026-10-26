#!/usr/bin/env node
// ============================================================================
// capture.mjs — 只读保全 fe4512 S1（2026-10-24 最终收尾）真实原件
// ----------------------------------------------------------------------------
// plan 6fd6c8c1 t1：S0 = 20261023 夹具已有（10-23 framework_bug 停机 + 旧 plan 发现）；
// S1 = 本目录（10-24 六阶段 PASS/closed 收尾、run_end PARTIAL、测试自检/正式 gate 重复执行）。
//
// 规则：
//   · 只从宿主现场**复制**，不改写、不清理、不回写；
//   · 复制范围 = 决策所需原件 + 证据 manifest 的输入/输出 + 两组重复设备执行的执行键/冻结件；
//   · 大日志（detach.log / agent-output.log）与截图现场保留在宿主，不复制（见 missing）；
//   · sources.json 记录每个文件的来源、sha256、字节数与采集时间。
//
// 用法（仓根或任意目录均可，须 Node 18+）：
//   node harness/tests/fixtures/host-recovery-history/20261024-fe4512-s1/capture.mjs
//   node .../capture.mjs --verify   # 只核对既有副本与现场哈希一致，不写盘
// ============================================================================
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOST_ROOT = 'D:/1.code/SimulatedWalletForHmos';
const FEATURE = 'doc/features/bc-openCard-2/bank-card-opening-flow';
const BLUEPRINT = 'doc/features/bc-openCard-2/blueprint';
const RUN = `${FEATURE}/goal-runs/20261023T044016Z-fe4512`;
const VERIFY_ONLY = process.argv.includes('--verify');

const PRODUCT_ROOTS = ['01-Product', '02-Feature', '03-CommonBusiness', '04-BusinessBase', '05-SystemBase', 'AppScope'];
const ROOT_FILES = ['framework.config.json', 'framework.local.json', 'build-profile.json5', 'oh-package.json5', 'oh-package-lock.json5', 'hvigorfile.ts'];
const DOC_TOP = ['architecture.md', 'component-index.yaml', 'glossary.yaml', 'module-catalog.yaml'];
const FEATURE_ROOT_FILES = [
  'acceptance.yaml', 'change-unit.yaml', 'contracts.yaml', 'feature.yaml', 'next.json', 'use-cases.yaml',
  'visual-debt.json', 'visual-debt.md',
];
const FEATURE_FILES = [
  ...FEATURE_ROOT_FILES.map(name => `${FEATURE}/${name}`),
  `${FEATURE}/spec/spec.md`, `${FEATURE}/spec/ui-spec.yaml`, `${FEATURE}/spec/ref-elements.yaml`,
  `${FEATURE}/spec/asset-manifest.yaml`, `${FEATURE}/spec/headless-assumptions.jsonl`,
  `${FEATURE}/spec/phase-completion-receipt.md`,
  `${FEATURE}/plan/plan.md`, `${FEATURE}/plan/visual-parity.yaml`, `${FEATURE}/plan/headless-assumptions.jsonl`,
  `${FEATURE}/plan/phase-completion-receipt.md`,
  `${FEATURE}/coding/upstream-issues.md`, `${FEATURE}/coding/structure-conformance.yaml`,
  `${FEATURE}/coding/headless-assumptions.jsonl`,
  `${FEATURE}/review/review-report.md`, `${FEATURE}/review/context-exploration.md`,
  `${FEATURE}/review/phase-completion-receipt.md`,
  `${FEATURE}/ut/testability-audit.md`, `${FEATURE}/ut/mock-plan.yaml`, `${FEATURE}/ut/context-exploration.md`,
  `${FEATURE}/ut/headless-assumptions.jsonl`, `${FEATURE}/ut/phase-completion-receipt.md`,
  `${FEATURE}/testing/test-plan.md`, `${FEATURE}/testing/test-report.md`, `${FEATURE}/testing/notes.md`,
  `${FEATURE}/testing/headless-assumptions.jsonl`, `${FEATURE}/testing/phase-completion-receipt.md`,
  `${BLUEPRINT}/component-blueprint.yaml`, `${BLUEPRINT}/component-blueprint.review.md`,
];
const RUN_FILES = [
  'events.jsonl', 'manifest.json', 'goal-report.json', 'goal-report.md', 'progress.json', 'progress.md',
  'run-control.json', 'intermediate-rounds.journal.jsonl', 'liveness.json',
];
const PHASES = ['spec', 'plan', 'coding', 'review', 'ut', 'testing'];
const PHASE_FILES = ['prompt.md', 'checkpoint.json', 'harness/summary.json', 'harness/script-report.json',
  'harness/merged-report.md', 'harness/trace.json', 'harness/verifier.report.md'];
// plan 6fd6c8c1 §2：两组真实重复设备执行（17:37/17:42 与 18:47/18:54）各自冻结的执行事实。
const TESTING_RUNS = ['20261024T173648Z-721', '20261024T173847Z-921',
  '20261024T174757Z-893', '20261024T175459Z-004', '20261024T184311Z-686', '20261024T185039Z-266'];
// 最后一轮正式 gate（43.567s）与前一成功轮，用于证明成功复用未被重复真跑。
const TESTING_SUCCESS_RUNS = ['20261024T193106Z-353', '20261024T194450Z-003'];
const TESTING_RUN_FILES = ['execution-key.json', 'trace.json', 'test-report.md',
  'test-plan.hylyre.md', 'checkpoint-injection.json',
  'frozen.device-test-run.meta.json', 'frozen.device-test-timing.json'];
// UT：包键变化但未被证实为无效重跑的一轮（真实失败）与其冻结件。
const UT_FAILED_RUN = '20261024T170825Z-490';
// 各 phase 的报告目录（除重目录），加上执行键记录（小文件）。
const PHASE_REPORT_EXCLUDES = [
  /[\\/]testing[\\/]reports[\\/][^\\/]+[\\/]hylyre[\\/]/,
  /[\\/]ut[\\/]reports[\\/][^\\/]+[\\/]ut[\\/]/,
];

const HEAVY_DIR = /^(node_modules|oh_modules|build|\.hvigor|\.preview|\.test|\.idea|\.git|intermediates|failures|\.hypium-workdir)$/;
const HEAVY_FILE = /(?:^|[\\/])agent-output\.log$/;

function walk(abs, out = []) {
  for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
    const p = path.join(abs, ent.name);
    if (ent.isDirectory()) {
      if (HEAVY_DIR.test(ent.name)) continue;
      walk(p, out);
    } else if (!HEAVY_FILE.test(p)) out.push(p);
  }
  return out;
}

function collect() {
  const rels = new Set();
  const add = rel => { if (fs.existsSync(path.join(HOST_ROOT, rel))) rels.add(rel.replace(/\\/g, '/')); };
  const files = [];
  for (const root of PRODUCT_ROOTS) { const out = []; walk(path.join(HOST_ROOT, root), out); files.push(...out); }
  files.forEach(abs => add(path.relative(HOST_ROOT, abs)));
  for (const f of ROOT_FILES) add(f);
  for (const f of DOC_TOP) add(`doc/${f}`);
  for (const f of FEATURE_FILES) add(f);
  for (const f of RUN_FILES) add(`${RUN}/${f}`);
  for (const phase of PHASES) for (const f of PHASE_FILES) add(`${RUN}/phases/${phase}/${f}`);
  // phase 报告目录（排除 testing/ut 的运行目录与其冻结件——按下面选定轮次单独复制）
  for (const phase of PHASES) {
    const dir = path.join(HOST_ROOT, RUN, 'phases', phase);
    if (!fs.existsSync(dir)) continue;
    walk(dir, []).forEach(abs => add(path.relative(HOST_ROOT, abs)));
  }
  for (const phase of ['spec', 'plan', 'coding', 'review', 'ut', 'testing']) {
    const dir = path.join(HOST_ROOT, FEATURE, phase, 'reports');
    if (!fs.existsSync(dir)) continue;
    walk(dir, []).forEach(abs => {
      const rel = path.relative(HOST_ROOT, abs);
      if (PHASE_REPORT_EXCLUDES.some(rx => rx.test(rel))) return;
      add(rel);
    });
  }
  // UT 执行键记录（全部轮次，小文件）+ 失败轮冻结件
  const utReports = path.join(HOST_ROOT, FEATURE, 'ut', 'reports');
  if (fs.existsSync(utReports)) {
    for (const stamp of fs.readdirSync(utReports)) {
      for (const f of ['ut/execution-key.json']) add(`${FEATURE}/ut/reports/${stamp}/${f}`);
      if (stamp === UT_FAILED_RUN) walk(path.join(utReports, stamp, 'ut'), []).forEach(abs => add(path.relative(HOST_ROOT, abs)));
    }
  }
  // testing 执行键记录（全部轮次）+ 选定轮次的执行事实
  const testingReports = path.join(HOST_ROOT, FEATURE, 'testing', 'reports');
  if (fs.existsSync(testingReports)) {
    for (const stamp of fs.readdirSync(testingReports)) {
      add(`${FEATURE}/testing/reports/${stamp}/hylyre/execution-key.json`);
    }
    for (const stamp of [...TESTING_RUNS, ...TESTING_SUCCESS_RUNS]) {
      for (const f of TESTING_RUN_FILES) add(`${FEATURE}/testing/reports/${stamp}/hylyre/${f}`);
    }
  }
  // 证据 manifest 的输入/输出是判定的真实依赖：显式补齐（防止手工清单漏项）。
  for (const phase of ['spec', 'plan', 'coding', 'review', 'ut', 'testing']) {
    const manifestPath = path.join(HOST_ROOT, FEATURE, phase, 'reports', 'phase-evidence-manifest.json');
    if (!fs.existsSync(manifestPath)) continue;
    const doc = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    for (const entry of [...(doc.inputs ?? []), ...(doc.outputs ?? [])]) {
      if (typeof entry?.path !== 'string') continue;
      const abs = path.isAbsolute(entry.path) ? entry.path : path.join(HOST_ROOT, entry.path);
      if (!fs.existsSync(abs)) continue;
      const rel = path.relative(HOST_ROOT, abs);
      if (rel.startsWith('..') || HEAVY_FILE.test(abs)) continue;
      add(rel);
    }
  }
  // 两个时间截面共用的 fe4512 run 目录里的旧 plan verifier subject 材料（S0 夹具已有，S1 保留原字节）
  for (const file of ['goal-runs/20261023T044016Z-fe4512/phases/plan/harness/verifier.report.md']) add(`${FEATURE}/${file}`);
  return [...rels].sort();
}

function sha(abs) { return createHash('sha256').update(fs.readFileSync(abs)).digest('hex'); }

const rels = collect();
const now = new Date().toISOString();
const entries = rels.map(rel => {
  const abs = path.join(HOST_ROOT, rel);
  if (/\.(?:ets|ts|js|mjs|cjs|json|json5|jsonl|md|ya?ml|txt|svg|sha256)$/i.test(rel) || path.basename(rel) === '.gitignore') {
    const original = fs.readFileSync(abs, 'utf8');
    const lf = original.replace(/\r\n/g, '\n');
    if (original !== lf) return { file: rel, source: `${HOST_ROOT}/${rel}`, source_sha256: sha(abs),
      normalization: 'CRLF->LF only', sha256: createHash('sha256').update(lf).digest('hex'), bytes: Buffer.byteLength(lf) };
  }
  return { file: rel, source: `D:/1.code/SimulatedWalletForHmos/${rel}`, sha256: sha(abs), bytes: fs.statSync(abs).size };
});
// The real Get-Content output retains the pre-TC003 top plan; its hash must match the old run binding.
const topSource = path.join(HOST_ROOT, RUN, 'phases/testing/agent-output.log');
const topOutput = fs.readFileSync(topSource, 'utf8').split('\n').filter(line => line.includes('## 三、测试用例清单'))
  .map(line => JSON.parse(line)).find(row => row.item?.type === 'command_execution'
    && row.item.aggregated_output?.includes('## 三、测试用例清单'))?.item.aggregated_output;
if (!topOutput) throw new Error('Original top test plan command output is missing');
const topBody = topOutput.split('---REPORT---')[0].trimEnd() + '\n';
const topSha = createHash('sha256').update(topBody).digest('hex');
if (topSha !== 'c7bec927496e5f03aedde4b1728fa8eeda3552b795253132ab9acc46effb9b3c') throw new Error('Original top test plan binding changed');
const topFile = `${FEATURE}/testing/test-plan.before-tc003.md`;
entries.push({ file: topFile, source: topSource.replace(/\\/g, '/'), source_sha256: sha(topSource),
  extraction: 'item.completed command_execution aggregated_output before ---REPORT---; trimEnd()+LF; exact original artifact_binding.test_plan_sha256',
  sha256: topSha, bytes: Buffer.byteLength(topBody) });
const sources = {
  description: 'fe4512 S1（2026-10-24 最终收尾）只读原件副本；历史缺陷仍是缺陷，未合成任何事件或结论。S0 见同目录 ../20261023。',
  captured_at: now,
  host_root: HOST_ROOT,
  s0_fixture: '20261023/20261023T044016Z-fe4512',
  missing: [
    'detach.log（539 KB）与各阶段 agent-output.log（约 6 MB）留在宿主现场，未复制：调用次数/时长/失败结果由 events.jsonl 与 prompt.md 保留，日志本身不参与判定。',
    'testing/failures（17.3 MB）与 .hypium-workdir（2.7 MB）为截图/工作目录现场，不是证据 manifest 的输入或输出，未复制。',
    'testing/hylyre、ut 运行目录中未被测试使用的截图未复制；已复制两组重复执行的 execution-key/trace/frozen meta 与最后一轮成功 gate。',
  ],
  files: entries,
};
if (VERIFY_ONLY) {
  const previous = JSON.parse(fs.readFileSync(path.join(HERE, 'sources.json'), 'utf8'));
  const drift = previous.files.filter(item => {
    const abs = path.join(HERE, item.file);
    return !fs.existsSync(abs) || sha(abs) !== item.sha256;
  });
  const extra = entries.filter(item => !previous.files.some(old => old.file === item.file));
  console.log(JSON.stringify({ ok: drift.length === 0 && extra.length === 0, drift: drift.map(d => d.file), extra: extra.map(e => e.file) }, null, 2));
  process.exit(drift.length === 0 && extra.length === 0 ? 0 : 1);
}
for (const item of entries) {
  const dst = path.join(HERE, item.file);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  if (item.file === topFile) fs.writeFileSync(dst, topBody, 'utf8');
  else if (item.normalization) fs.writeFileSync(dst, fs.readFileSync(item.source, 'utf8').replace(/\r\n/g, '\n'), 'utf8');
  else fs.copyFileSync(path.join(HOST_ROOT, item.file), dst);
}
fs.writeFileSync(path.join(HERE, 'sources.json'), `${JSON.stringify(sources, null, 2)}\n`, 'utf8');
const bytes = entries.reduce((sum, item) => sum + item.bytes, 0);
console.log(JSON.stringify({ copied: entries.length, bytes, megabytes: Number((bytes / 1048576).toFixed(1)) }, null, 2));
