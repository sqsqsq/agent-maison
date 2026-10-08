// adhoc-repair-diagnosis.unit.test.ts — plan a2f7c9e4 §3.6：返修局部诊断（装当前构建 / 量测 / dump 落点 / 提示入口 / CLI 设备门）
//
// 设备一律替身：只 mock hdc 传输面（probe / bm dump / install / 候选元数据 / 装前就绪桥），install provider 主体走生产代码；
// 出包用同形替身（单测没有 hvigor），unresolved 用例走真实 build provider（解析器在 hvigor 之前就停）。

import assert from 'assert';
import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { featureDir, featurePhaseReportsDir } from '../../config';
import { installCurrentBuildForAdhoc, measureAdhocScreen } from '../../scripts/utils/adhoc-repair-diagnosis';
import { resolveAdhocDumpUiOutPath } from '../../scripts/utils/adhoc-dump-ui';
import { formatRepairLocalDiagnosis, type RepairCandidate } from '../../scripts/utils/repair-candidates';
import { computeHapBuildFingerprint, computeHapSha256Full } from '../../../profiles/hmos-app/harness/build-fingerprint';
import { installDeviceTestApp } from '../../../profiles/hmos-app/harness/providers/device-test-install';
import type { DeviceTestBuildOptions, DeviceTestBuildResult } from '../../../profiles/hmos-app/harness/providers/device-test-build';
import type { UnitCaseResult } from '../run-unit';

const HARNESS_ROOT = path.resolve(__dirname, '..', '..');
const FEATURE = 'demo';
const FORCE = 'HARNESS_DEVICE_TEST_FORCE_INSTALL';

function tmpProject(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.writeFileSync(path.join(root, 'framework.config.json'), JSON.stringify({
    schema_version: '1.1', project_name: 'T', active_workflow: 'spec-driven', project_profile: { name: 'hmos-app', sub_variant: 'app' },
    architecture: { outer_layers: [{ id: '02-Feature', can_depend_on: [], intra_layer_deps: 'dag' }], module_inner_layers: ['shared'], inner_dependency_direction: 'upward', cross_module_exports_file: 'index.ets' },
    paths: { features_dir: 'doc/features', docs_committed: false, reports_dir_pattern: 'doc/features/<feature>/<phase>/reports' },
    materialized_adapters: ['cursor'],
  }));
  return root;
}

/** 目录下全部文件的 相对路径 → sha256（正式证据字节不变的判据） */
function treeHashes(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string): void => {
    if (!fs.existsSync(d)) return;
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, ent.name);
      if (ent.isDirectory()) walk(abs);
      else out[path.relative(dir, abs).replace(/\\/g, '/')] = createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
    }
  };
  walk(dir);
  return out;
}

function fakePng(w: number, h: number): Buffer {
  const buf = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12);
  buf.writeUInt32BE(w, 16);
  buf.writeUInt32BE(h, 20);
  return buf;
}

const node = (attrs: Record<string, string>, children: unknown[] = []): unknown => ({ attributes: attrs, children });
const RAW_DUMP = {
  schema_version: 'hylyre-hypium-ui-dump-v1',
  tree: node({ type: 'root', bounds: '[0,0][1080,2340]' }, [
    node({ type: 'root', bounds: '[0,0][1080,2340]' }, [
      node({ id: 'title', type: 'Text', text: '标题', bounds: '[40,100][400,160]' }),
      node({ id: 'card', type: 'Column', bounds: '[40,200][1040,600]' }),
    ]),
  ]),
};
const UI_SPEC = {
  screens: [{
    id: 'home', priority: 'P0',
    root: {
      type: 'navigation_frame', order: 0,
      children: [
        { id: 'title', type: 'text', order: 0, text: '标题', bbox: [0.037, 0.0427, 0.3333, 0.0256], tolerance_px: 8 },
        { id: 'card', type: 'card', order: 1, bbox: [0.037, 0.0855, 0.9259, 0.1282], tolerance_px: 12 },
      ],
    },
  }],
  tokens: {},
  assets: [],
};

/** 正式 feature 证据（诊断前后必须逐字节不变） */
function writeFormalEvidence(root: string): void {
  const fdir = featureDir(root, FEATURE);
  const put = (rel: string, body: string | Buffer): void => {
    const abs = path.join(fdir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  };
  put('spec/ui-spec.yaml', JSON.stringify(UI_SPEC, null, 2));
  put('testing/reports/trace.json', '{"schema":"formal-trace"}\n');
  put('device-testing/device-screenshots/shot-home.png', fakePng(1080, 2340));
  put('device-testing/device-screenshots/visual-diff.json', JSON.stringify({
    schema_version: '1.1',
    screens: [{ screen_id: 'home', verdict: 'fail', must_fix: ['card 太高'], defects: [{ class: 'geometry', element: 'card', severity: 'major', note: '卡片高度超出' }] }],
  }, null, 2));
  put('device-testing/reports/critic-receipt.json', '{"schema":"formal-receipt"}\n');
}

interface HdcMock { installCalls: number; restore: () => void }

/** 与 testing-trace-gates B08-V3 同一 mock 面：只换 hdc 传输与装前就绪桥 */
function mockHdc(): HdcMock {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const hdc = require('../../../profiles/hmos-app/harness/hdc-runner') as Record<string, unknown>;
  const bridge = require('../../../profiles/hmos-app/harness/device-recovery-bridge') as Record<string, unknown>;
  /* eslint-enable @typescript-eslint/no-require-imports */
  const keys = ['probeDevices', 'runHdcShellBmDump', 'installHap', 'parseInstalledBundleVersionFromDump', 'loadAppInstallCandidateMeta'];
  const saved = Object.fromEntries(keys.map(k => [k, hdc[k]]));
  const savedBridge = bridge.ensureReadyBefore;
  const savedEnv = ['HARNESS_DEVICE_TEST_FORCE_INSTALL', 'HARNESS_SKIP_DEVICE_TEST_INSTALL', 'HARNESS_DEVICE_TEST_UNINSTALL_BEFORE_INSTALL']
    .map(k => [k, process.env[k]] as const);
  for (const [k] of savedEnv) delete process.env[k];
  const state: HdcMock = { installCalls: 0, restore: () => undefined };
  hdc.probeDevices = () => ({ hdcPresent: true, available: true, targets: ['dev-A'] });
  hdc.runHdcShellBmDump = () => ({ exitCode: 0, output: 'versionCode: 1' });
  hdc.parseInstalledBundleVersionFromDump = () => ({ installed: true, versionCode: 1 });
  hdc.loadAppInstallCandidateMeta = () => ({ bundleName: 'com.example.diag', versionCode: 1, versionName: '1.0.0' });
  hdc.installHap = () => { state.installCalls += 1; return { ok: true, exitCode: 0, durationMs: 1, output: 'install ok' }; };
  bridge.ensureReadyBefore = () => ({ ready: true, blocked: false, note: 'mock ready', authorized: true });
  state.restore = () => {
    for (const k of keys) hdc[k] = saved[k];
    bridge.ensureReadyBefore = savedBridge;
    for (const [k, v] of savedEnv) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  };
  return state;
}

function fakeBuild(hapPath: string, bytes: string, seen: Array<Record<string, unknown>>) {
  return (o: DeviceTestBuildOptions): DeviceTestBuildResult => {
    seen.push({ ...o });
    fs.mkdirSync(path.dirname(hapPath), { recursive: true });
    if (!fs.existsSync(hapPath) || fs.readFileSync(hapPath, 'utf-8') !== bytes) fs.writeFileSync(hapPath, bytes);
    return {
      hvigor: { executed: false, exitCode: 0, durationMs: 0, logExcerpt: 'reuse', errors: [], successMarkerFound: true },
      hapPath, resolvedProduct: 'default', resolvedBuildMode: 'debug', reused: true,
    };
  };
}

const CANDIDATE_BASE = { id: 'TC-001', category: 'coding' as const, files: [], summary: 's', item_fingerprint: 'a'.repeat(64), source_phase: 'testing' };

const cases: Array<{ name: string; run: () => void | Promise<void> }> = [
  {
    name: '装当前构建：_adhoc 落 meta、恒真装（复用启发不生效）、完整摘要在返回值；正式证据逐字节不变；随后 testing 仍按自身规则重装且摘要绑定新 HAP',
    run: () => {
      const root = tmpProject('adhoc-diag-install-');
      const mock = mockHdc();
      try {
        const hapPath = path.join(root, 'build', 'default', 'outputs', 'default', 'entry-default-signed.hap');
        fs.mkdirSync(path.dirname(hapPath), { recursive: true });
        fs.writeFileSync(hapPath, 'hap-v1-before-repair');
        // 上一轮正式 testing 装机（生产 provider）→ testing 目录留下 v1 的 meta
        const earlier = installDeviceTestApp({ projectRoot: root, harnessRoot: root, feature: FEATURE, phase: 'testing', hapPath, buildReused: false });
        assert.strictEqual(earlier.ok, true, JSON.stringify(earlier.errors));
        const v1Full = computeHapSha256Full(hapPath)!;
        writeFormalEvidence(root);
        const formalBefore = treeHashes(featureDir(root, FEATURE));

        const seenBuild: Array<Record<string, unknown>> = [];
        const seenForce: Array<string | undefined> = [];
        const install = (o: Parameters<typeof installDeviceTestApp>[0]) => { seenForce.push(process.env[FORCE]); return installDeviceTestApp(o); };
        const build = fakeBuild(hapPath, 'hap-v2-current-working-tree', seenBuild);
        const first = installCurrentBuildForAdhoc({ projectRoot: root, harnessRoot: root }, { build, install });
        const second = installCurrentBuildForAdhoc({ projectRoot: root, harnessRoot: root }, { build, install });
        assert.ok(first.ok && second.ok, JSON.stringify({ first, second }));
        assert.deepStrictEqual(seenBuild.map(o => [o.feature, o.phase, 'product' in o, 'buildMode' in o]),
          [['_adhoc', 'testing', false, false], ['_adhoc', 'testing', false, false]], '出包只给 _adhoc/testing，product/build mode 交给 provider 内的同一解析器');
        assert.deepStrictEqual(seenForce, ['1', '1'], '装机期间进程内强制真装');
        assert.strictEqual(process.env[FORCE], undefined, '装完恢复环境，不泄漏到同进程后续步骤');
        assert.strictEqual(mock.installCalls, 3, `两次诊断都真装（第二次 HAP 与 _adhoc meta 未变，不强制就会走复用）：${mock.installCalls}`);
        const v2Full = computeHapSha256Full(hapPath)!;
        assert.ok(/^[0-9a-f]{64}$/.test(v2Full) && first.hapSha256Full === v2Full && v2Full !== v1Full, '完整 64 位摘要在返回值，且是当前构建的字节');
        const adhocMeta = JSON.parse(fs.readFileSync(path.join(featurePhaseReportsDir(root, '_adhoc', 'testing'), 'device-test-install.meta.json'), 'utf-8')) as Record<string, unknown>;
        assert.strictEqual(adhocMeta.hapSha256, computeHapBuildFingerprint(hapPath), '装机 meta 沿用既有 12 位 hapSha256');
        assert.ok(!('hapSha256Full' in adhocMeta), '不为诊断加 meta 字段');
        assert.deepStrictEqual(treeHashes(featureDir(root, FEATURE)), formalBefore, '正式 testing / device-testing / ui-spec 字节不变');

        // 返修后的正式 testing：不强制、构建复用同源 HAP，装机复用仍被 testing 自己的 meta 拦下 → 真装，执行键输入绑定新 HAP
        const testing = installDeviceTestApp({ projectRoot: root, harnessRoot: root, feature: FEATURE, phase: 'testing', hapPath, buildReused: true });
        assert.ok(testing.ok && testing.reused === false && (mock.installCalls as number) === 4, JSON.stringify({ reused: testing.reused, calls: mock.installCalls }));
        assert.strictEqual(testing.hapSha256Full, v2Full, 'testing 的执行键输入是本轮装入 HAP 的完整摘要');
        const again = installDeviceTestApp({ projectRoot: root, harnessRoot: root, feature: FEATURE, phase: 'testing', hapPath, buildReused: true });
        assert.strictEqual(again.reused, true, '对照：HAP 未再变时 testing 的复用启发照常生效（上一次真装确由 HAP 变化触发）');
      } finally {
        mock.restore();
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'product 解析 unresolved（真实 build provider）→ 按既有口径停：不装机、不猜 product，_adhoc 记 rejected',
    run: () => {
      const root = tmpProject('adhoc-diag-unresolved-');
      const saved = { product: process.env.HARNESS_DEVICE_TEST_PRODUCT, skip: process.env.HARNESS_SKIP_DEVICE_TEST_BUILD };
      delete process.env.HARNESS_DEVICE_TEST_PRODUCT;
      delete process.env.HARNESS_SKIP_DEVICE_TEST_BUILD;
      try {
        const r = installCurrentBuildForAdhoc({ projectRoot: root, harnessRoot: HARNESS_ROOT }, {
          install: () => { throw new Error('unresolved 时不得装机'); },
        });
        assert.strictEqual(r.ok, false);
        assert.ok(/product-selection unresolved/.test(r.reason ?? ''), r.reason);
        const result = JSON.parse(fs.readFileSync(path.join(featurePhaseReportsDir(root, '_adhoc', 'testing'), 'device-test-build.result.json'), 'utf-8')) as Record<string, unknown>;
        assert.strictEqual(result.rejected, 'product_selection_unresolved');
      } finally {
        if (saved.product === undefined) delete process.env.HARNESS_DEVICE_TEST_PRODUCT; else process.env.HARNESS_DEVICE_TEST_PRODUCT = saved.product;
        if (saved.skip === undefined) delete process.env.HARNESS_SKIP_DEVICE_TEST_BUILD; else process.env.HARNESS_SKIP_DEVICE_TEST_BUILD = saved.skip;
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: '量测：截图 / 布局 / measure 只写 _adhoc 目录，content 轴 UNKNOWN；正式 visual-diff 不回填、截图不改；取材全失败即停',
    run: () => {
      const root = tmpProject('adhoc-diag-measure-');
      try {
        writeFormalEvidence(root);
        const formalBefore = treeHashes(featureDir(root, FEATURE));
        const outDir = path.join(featurePhaseReportsDir(root, '_adhoc', 'testing'), 'measure-t1');
        const dests: string[] = [];
        const r = measureAdhocScreen({
          projectRoot: root, feature: FEATURE, screenId: 'home', outDir,
          screenshot: ({ destAbs }) => { dests.push(destAbs); fs.writeFileSync(destAbs, fakePng(1080, 2340)); return { ok: true }; },
          layoutDump: ({ destAbs }) => { dests.push(destAbs); fs.writeFileSync(destAbs, JSON.stringify(RAW_DUMP)); return { ok: true }; },
        });
        assert.ok(r.ok, r.reason);
        assert.ok(dests.every(d => path.dirname(d) === outDir) && dests.length === 2, `取材落 _adhoc：${dests.join(',')}`);
        assert.strictEqual(r.measurePath, path.join(outDir, 'measure-home.json'));
        const m = JSON.parse(fs.readFileSync(r.measurePath!, 'utf-8')) as { elements: Array<{ element_id: string; geometry: string }>; axes: { content: string } };
        assert.strictEqual(m.axes.content, 'UNKNOWN', '诊断不读正式 visual-diff');
        assert.deepStrictEqual(m.elements.map(e => [e.element_id, e.geometry]), [['title', 'PASS'], ['card', 'FAIL']]);
        assert.deepStrictEqual(treeHashes(featureDir(root, FEATURE)), formalBefore, '正式 visual-diff 的 defects note 未回填、正式截图未改');

        const failed = measureAdhocScreen({
          projectRoot: root, feature: FEATURE, screenId: 'home', outDir: path.join(outDir, '..', 'measure-t2'),
          screenshot: () => ({ ok: false, error: 'no device' }), layoutDump: () => ({ ok: false, error: 'no device' }),
        });
        assert.strictEqual(failed.ok, false);
        assert.ok(!fs.existsSync(path.join(outDir, '..', 'measure-t2', 'measure-home.json')), '取材全失败不写量测结果');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'dump 缺省落点：即席 reports（不再写 app-snapshot-cache）；显式 --dump-ui-out 照用',
    run: () => {
      const base = path.join(os.tmpdir(), 'x', 'doc', 'features', '_adhoc', 'testing', 'reports');
      const p = resolveAdhocDumpUiOutPath(base);
      assert.strictEqual(path.dirname(p), base);
      assert.ok(/^dump-ui-\d{8}-\d{6}\.json$/.test(path.basename(p)), p);
      assert.strictEqual(resolveAdhocDumpUiOutPath(base, 'some/where.json'), path.resolve('some/where.json'));
    },
  },
  {
    name: 'c3f8a2d7 §3.3 复看要求：coding 收到候选（testing / review 来源）且本 run 有设备资格时给出；无设备资格、非 coding、无候选为空',
    run: () => {
      const ctx = { harnessDir: 'framework/harness', feature: FEATURE, deviceCapable: true };
      const withRef: RepairCandidate = { ...CANDIDATE_BASE, evidence_refs: [{ trace_path: 'doc/features/demo/testing/reports/t/trace.json', case_id: 'TC-001', step_index: 3 }] };
      const visual: RepairCandidate = { ...CANDIDATE_BASE, id: 'visual_diff:home' };
      const review: RepairCandidate = { ...CANDIDATE_BASE, id: 'CR-001', source_phase: 'review' };
      const lines = formatRepairLocalDiagnosis('coding', [review, withRef], ctx).join('\n');
      assert.ok(lines.includes('--install-current-build') && lines.includes('--dump-ui-only') && lines.includes(`--feature ${FEATURE}`), lines);
      assert.ok(lines.includes('cd framework/harness && npm run adhoc-device-test'), '入口是既有 npm script');
      assert.ok(/no visual judgement/.test(lines) && /not acceptance evidence/.test(lines) && lines.includes('doc/features/_adhoc/testing/reports/'), lines);
      assert.ok(!/optional/i.test(lines), '复看是执行要求，不再标 optional');
      assert.ok(/you MUST reproduce the relevant state with your current build and check the fix result before handing back/.test(lines), lines);
      assert.ok(/record what you tried, the obstacle and the remaining uncertainty/.test(lines) && lines.includes('coding/notes.md'), '条件不足时记入既有交回说明');
      assert.ok(/One valid recheck of the same screen can cover several related candidates/.test(lines), '一次复看覆盖多条候选');
      assert.ok(/never blocks the phase/.test(lines), '不因缺诊断文件阻断');
      assert.ok(formatRepairLocalDiagnosis('coding', [visual], ctx).length > 0, 'testing 来源（视觉缺陷）仍含');
      assert.deepStrictEqual(formatRepairLocalDiagnosis('coding', [review], ctx), formatRepairLocalDiagnosis('coding', [withRef], ctx), 'review 来源与 testing 来源给同一段复看要求');
      assert.deepStrictEqual(formatRepairLocalDiagnosis('coding', [review, withRef], { ...ctx, deviceCapable: false }), [], '无设备资格的 run 不含');
      assert.deepStrictEqual(formatRepairLocalDiagnosis('coding', [], ctx), [], '无候选不提示');
      assert.deepStrictEqual(formatRepairLocalDiagnosis('spec', [withRef], ctx), [], '非 coding 不提示');
    },
  },
  {
    name: 'CLI 真实入口：装当前构建在设备门不过时按门停（exit 1、无堆栈、未出包）；--measure-screen 缺 --feature 用法错误',
    run: () => {
      const root = tmpProject('adhoc-diag-cli-');
      try {
        const env: NodeJS.ProcessEnv = { ...process.env, TS_NODE_PROJECT: path.join(HARNESS_ROOT, 'tsconfig.json') };
        for (const k of ['MAISON_DEVICE_ATTEMPT_FROZEN', 'HARNESS_HDC_TARGET', 'MAISON_DEVICE_TARGET_KIND']) delete env[k];
        const cli = (args: string[]) => spawnSync(process.execPath, ['-r', require.resolve('ts-node/register/transpile-only'),
          path.join(HARNESS_ROOT, 'scripts', 'adhoc-device-test.ts'), '--bundle', 'com.example.diag', '--project-root', root, ...args],
        { cwd: HARNESS_ROOT, encoding: 'utf8', env, timeout: 180_000 });
        const gated = cli(['--install-current-build']);
        assert.strictEqual(gated.status, 1, `${gated.status}\n${gated.stderr}`);
        assert.ok(gated.stderr.includes('ADHOC_PHASE=device_gate') && gated.stderr.includes('device_policy_unset'), gated.stderr);
        assert.ok(!gated.stderr.includes('ADHOC_PHASE=install_current_build') && !/\n\s+at /.test(gated.stderr), gated.stderr);
        assert.ok(!fs.existsSync(path.join(featurePhaseReportsDir(root, '_adhoc', 'testing'), 'device-test-build.result.json')), '门不过不出包');
        const usage = cli(['--measure-screen', 'home']);
        assert.strictEqual(usage.status, 2, `${usage.status}\n${usage.stderr}`);
        assert.ok(usage.stderr.includes('--measure-screen 需要 --feature'), usage.stderr);
        // dump 与 observe 两处 dump 都透传 --dump-ui-out（observe 分支此前漏传）；observe 需真机，这里钉接线
        const src = fs.readFileSync(path.join(HARNESS_ROOT, 'scripts', 'adhoc-device-test.ts'), 'utf-8');
        const dumpCalls = src.split('runAdhocDumpUi({').slice(1).map(s => s.slice(0, s.indexOf('});')));
        assert.ok(dumpCalls.length === 2 && dumpCalls.every(c => c.includes('outPath: dumpUiOutArg || undefined')), `两处 dump 都须透传：${dumpCalls.length}`);
        // 执行 / observe 路径：量测失败时 JSON 的 ok 与退出码一致（该路径需真机，钉接线）
        const tail = src.slice(src.indexOf("const measuredOk = run.ok ? measureCurrent("));
        assert.ok(tail.includes('ok: run.ok && !warmupDegraded && measuredOk,') && tail.includes('process.exit(run.ok && measuredOk ? 0 : 1);'),
          'JSON ok 与退出码都须计入量测结果');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
];

export async function runAll(): Promise<UnitCaseResult[]> {
  const results: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      await c.run();
      results.push({ name: c.name, ok: true });
    } catch (err) {
      results.push({ name: c.name, ok: false, error: (err as Error).stack ?? (err as Error).message });
    }
  }
  return results;
}
