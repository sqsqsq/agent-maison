// ============================================================================
// ut-module-selection.unit.test.ts — selectUtModulesToCompile 回归
// ----------------------------------------------------------------------------
// 背景：findModulesWithUt 会把 contracts.modules 里每个带 src/ohosTest/ 的模块
// 都列为编译候选；entry/product 模块（如 Phone）常只含模板测试、且无法生成
// genOnDeviceTestHap。selectUtModulesToCompile 用本需求 scoped UT 文件把这类
// 与需求无关的模块筛掉，避免误判整轮 UT 失败。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import {
  checkUtHvigorBuild,
  checkUtHvigorTest,
  orderUtModulesForCompile,
  selectUtModulesToCompile,
  utBuildCollectorKey,
} from '../../../profiles/hmos-app/harness/ut-host-impl';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const WALLET = { name: 'WalletMain', package_path: '02-Feature/WalletMain' };
const PHONE = { name: 'Phone', package_path: '01-Product/Phone' };
const ACCOUNT = { name: 'AccountManager', package_path: '04-BusinessBase/AccountManager' };

function names(mods: Array<{ name: string }>): string[] {
  return mods.map(m => m.name).sort();
}

// 核心回归（本 bug）：scoped 全在 WalletMain → 排除只含模板测试的 Phone。
function testExcludesModuleWithoutScopedUt(): void {
  const scoped = [
    { path: '02-Feature/WalletMain/src/ohosTest/ets/test/bc_open_card_ut.test.ets' },
    { path: '02-Feature/WalletMain/src/ohosTest/ets/test/List.test.ets' },
  ];
  const out = selectUtModulesToCompile([WALLET, PHONE], scoped);
  assert(out.length === 1, `expected 1 module, got ${out.length}`);
  assert(out[0].name === 'WalletMain', `expected WalletMain, got ${out[0].name}`);
}

// 多模块：scoped 落在两个模块 → 两个都保留。
function testKeepsAllModulesThatOwnScopedUt(): void {
  const scoped = [
    { path: '02-Feature/WalletMain/src/ohosTest/ets/test/a.test.ets' },
    { path: '04-BusinessBase/AccountManager/src/ohosTest/ets/test/b.test.ets' },
  ];
  const out = selectUtModulesToCompile([WALLET, PHONE, ACCOUNT], scoped);
  assert(out.length === 2, `expected 2 modules, got ${out.length}`);
  assert(
    names(out).join(',') === 'AccountManager,WalletMain',
    `expected AccountManager,WalletMain, got ${names(out).join(',')}`,
  );
}

// 兜底：scoped 为空（无 scoped 信息）→ 原样返回，保持旧行为不回归。
function testFallbackWhenScopedEmpty(): void {
  const out = selectUtModulesToCompile([WALLET, PHONE], []);
  assert(out.length === 2, `expected passthrough of 2 modules, got ${out.length}`);
}

// 兜底：scoped 不匹配任何模块 package_path → 退回全集而非筛空。
function testFallbackWhenNoneMatch(): void {
  const scoped = [{ path: 'some/unrelated/path/x.test.ets' }];
  const out = selectUtModulesToCompile([WALLET, PHONE], scoped);
  assert(out.length === 2, `expected fallback to full set, got ${out.length}`);
}

// 已知边界（locked）：partitionUtFiles 无 scope 线索时返回 scoped=all（含 Phone 模板测试）。
// 此时本函数按设计「退回包含 Phone」——锁定该行为，提醒改动者 fallback:all 路径不做排除；
// goal 流程必产 context-exploration，真实场景 scoped 具体、Phone 仍被排除（见首个用例）。
function testFallbackAllScopeKeepsTemplateModule(): void {
  const scopedIsAll = [
    { path: '02-Feature/WalletMain/src/ohosTest/ets/test/bc_open_card_ut.test.ets' },
    { path: '01-Product/Phone/src/ohosTest/ets/test/Ability.test.ets' },
  ];
  const out = selectUtModulesToCompile([WALLET, PHONE], scopedIsAll);
  assert(out.length === 2, `fallback:all keeps both modules, got ${out.length}`);
  assert(
    names(out).join(',') === 'Phone,WalletMain',
    `expected Phone,WalletMain, got ${names(out).join(',')}`,
  );
}

// plan 423e5d0f P0：feature 新增 UT 归属的模块必须排最前——真实编译错误仍会短路循环，
// 顺带被触碰的存量模块（如 Phone 的 Main.test.ets 被加 AC 标签）不得把真目标模块挤出执行窗口。
function testOrdersFeatureNewModuleFirst(): void {
  const scoped = [
    { path: '01-Product/Phone/src/ohosTest/ets/test/Main.test.ets' },
    { path: '02-Feature/WalletMain/src/ohosTest/ets/test/not_login.test.ets' },
  ];
  const featureNew = [
    { path: '02-Feature/WalletMain/src/ohosTest/ets/test/not_login.test.ets' },
  ];
  const out = orderUtModulesForCompile([PHONE, WALLET], scoped, featureNew);
  assert(out[0].name === 'WalletMain', `feature-new module first, got ${out[0].name}`);
  assert(out[1].name === 'Phone', `touched-legacy module second, got ${out[1].name}`);
}

// 无 featureNew 信息 → 保持原顺序（稳定，不回归）。
function testOrderStableWithoutFeatureNew(): void {
  const scoped = [
    { path: '01-Product/Phone/src/ohosTest/ets/test/Main.test.ets' },
    { path: '02-Feature/WalletMain/src/ohosTest/ets/test/a.test.ets' },
  ];
  const out = orderUtModulesForCompile([PHONE, WALLET], scoped, []);
  assert(out[0].name === 'Phone' && out[1].name === 'WalletMain', `stable order, got ${names(out).join(',')}`);
}

// plan 5e1c7a93 D1：build 侧写入与 test 侧读取必须同键——同 (module, product) 稳定同值，
// 换模块或换 product 即换键；两个调用点必须共用 utBuildCollectorKey（不得各自内联维度）。
function testBuildCollectorKeyIdentity(): void {
  const root = path.resolve(__dirname, '../../..');
  const a = utBuildCollectorKey(root, 'WalletMain', 'default');
  assert(a === utBuildCollectorKey(root, 'WalletMain', 'default'), 'same (module,product) must be stable');
  assert(a !== utBuildCollectorKey(root, 'Phone', 'default'), 'different module must change key');
  assert(a !== utBuildCollectorKey(root, 'WalletMain', 'oversea'), 'different product must change key');
  assert(a !== utBuildCollectorKey(root, 'WalletMain', undefined), 'absent product must change key');

  const src = fs.readFileSync(
    path.join(root, 'profiles', 'hmos-app', 'harness', 'ut-host-impl.ts'),
    'utf-8',
  );
  const uses = src.match(/utBuildCollectorKey\(ctx\.projectRoot, mod\.name, selection\.product \?\? undefined\)/g) ?? [];
  assert(uses.length === 2, `build/test 两侧必须共用同一键式，实际命中 ${uses.length} 处`);
}

// ---------------------------------------------------------------------------
// plan 5e1c7a93 §6「生产接线要求」+ codex review 第 1 轮 #5：
// **保留真实 provider 与真实 runner**——影子 profileDir 里的 provider 只做「记一笔再转导
// 到真实实现」，被观察的是它们最终真的 spawn 了几次工具。合成结果一律注入在
// `child_process.spawnSync` 这个**进程调用边界**上，分桶计数：
//   hvigor(genOnDeviceTestHap) / hdc install / hdc shell aa test / 身份与就绪探针（允许非零）。
// 单测全程不碰真机、不依赖开发机是否装了 DevEco。
// ---------------------------------------------------------------------------

const FRAMEWORK_ROOT = path.resolve(__dirname, '../../..');
const REAL_PROVIDERS_DIR = path.join(FRAMEWORK_ROOT, 'profiles', 'hmos-app', 'harness', 'providers');

interface UtDispatchLog {
  compile: Array<{ module: string; product?: string }>;
  run: Array<{ module: string; product?: string; prebuild: unknown }>;
}

interface UtModuleSpec {
  name: string;
  package_path: string;
}

interface UtFixture {
  root: string;
  modules: UtModuleSpec[];
  feature: string;
  ctx: import('../../scripts/utils/types').CheckContext;
}

/** 每一类工具调用单独一个桶：身份/就绪探针允许非零，装机与执行必须能被单独归零。 */
interface ToolSpawns {
  /** ohosTest 出包（genOnDeviceTestHap）——D1「一次门禁一个模块一个包」数这个桶 */
  hvigor: string[];
  /** hdc install -r */
  install: string[];
  /** hdc shell aa test */
  aaTest: string[];
  /** 设备身份/就绪查询与工具链版本探针（hdc list targets、wm size、bm dump、hvigor -v…） */
  probe: string[];
}

type AaMode = 'pass' | 'fail' | 'nonzero' | 'throw';

function readDirTexts(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...readDirTexts(abs));
    else out.push(`${ent.name} ${fs.readFileSync(abs, 'utf-8')}`);
  }
  return out;
}

/**
 * 合成「编译」：产物字节由该模块 ohosTest 源码内容决定——源码变 → 重新出包 → HAP 摘要变
 * → 整轮键变 → 真跑。真实 hvigor 的增量语义留 B06 宿主窗口，这里只保证链路可被观察。
 */
function writeSignedHap(fx: UtFixture, moduleName: string): void {
  const crypto = require('crypto') as typeof import('crypto');
  const mod = fx.modules.find(m => m.name === moduleName);
  if (!mod) return;
  const dir = path.join(fx.root, mod.package_path, 'build', 'default', 'outputs', 'ohosTest');
  fs.mkdirSync(dir, { recursive: true });
  const digest = crypto
    .createHash('sha256')
    .update(readDirTexts(path.join(fx.root, mod.package_path, 'src', 'ohosTest')).join(''))
    .digest('hex');
  fs.writeFileSync(path.join(dir, `${moduleName}-ohosTest-signed.hap`), `hap:${moduleName}:${digest}`);
}

function installToolBoundary(
  fx: UtFixture,
  opts: { aa?: AaMode; buildFailModules?: string[] } = {},
): { spawns: ToolSpawns; restore: () => void } {
  const cp = require('child_process') as { spawnSync: (...a: unknown[]) => unknown };
  const original = cp.spawnSync;
  const spawns: ToolSpawns = { hvigor: [], install: [], aaTest: [], probe: [] };
  const aa = opts.aa ?? 'pass';
  const buildFail = new Set(opts.buildFailModules ?? []);
  const ret = (status: number, stdout = ''): unknown =>
    ({ status, signal: null, stdout, stderr: '', pid: 0, output: [] });

  cp.spawnSync = function (file: unknown, args: unknown, ...rest: unknown[]): unknown {
    const argv = Array.isArray(args) ? args.map(String) : [];
    const command = [String(file), ...argv].join(' ');
    // where/which 探针一律未命中：让 hvigor 解析确定性地落在工程根 wrapper 上，
    // 结果不随开发机 PATH 里有没有真 hvigor 而变。
    if (/^(where|which)(\.exe)?$/i.test(String(file))) return ret(1);
    if (/genOnDeviceTestHap/.test(command)) {
      const mod = /module=([^@\s"]+)@ohosTest/.exec(command)?.[1] ?? '';
      if (buildFail.has(mod)) return ret(1, 'BUILD FAILED');
      spawns.hvigor.push(command);
      if (mod) writeSignedHap(fx, mod);
      return ret(0, 'BUILD SUCCESSFUL');
    }
    if (/hvigor/i.test(command)) {
      spawns.probe.push(command);
      return ret(0);
    }
    if (/hdc/i.test(command)) {
      if (argv.includes('install')) {
        spawns.install.push(command);
        return ret(0, 'install bundle successfully');
      }
      if (argv.includes('aa') && argv.includes('test')) {
        spawns.aaTest.push(command);
        if (aa === 'throw') throw new Error('B03_FAKE_LINK_FAILURE');
        if (aa === 'nonzero') return ret(1, 'aa test: connection broken');
        // 关键现场（codex review 第 1 轮 #1）：**进程退出码仍是 0**，失败只出现在
        // Hypium 的汇总行里——真实 hdc 就是这个形态。
        const summary = aa === 'fail'
          ? 'Tests run: 1, Failure: 1, Error: 0, Pass: 0'
          : 'Tests run: 1, Failure: 0, Error: 0, Pass: 1';
        return ret(0, `OHOS_REPORT_RESULT: stream=${summary}\nOHOS_REPORT_STATUS_CODE: 0`);
      }
      spawns.probe.push(command);
      return ret(0, argv.includes('targets') ? 'B03FAKE\n' : '');
    }
    return (original as (...a: unknown[]) => unknown).call(cp, file, args, ...rest);
  };
  return { spawns, restore: () => { cp.spawnSync = original; } };
}

function makeUtOrchestrationFixture(modules: UtModuleSpec[]): UtFixture {
  const os = require('os') as typeof import('os');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'b03-ut-'));
  const profileDir = path.join(root, 'shadow-profile');
  const providersDir = path.join(profileDir, 'harness', 'providers');
  fs.mkdirSync(providersDir, { recursive: true });

  // 影子 provider = 记一笔 + 转导真实 provider（真实 runner 全程在场）。
  // dispatch 次数写进 JSONL（跨 require 边界，不能靠闭包）。
  const logPath = path.join(root, 'dispatch.jsonl').replace(/\\/g, '/');
  const transit = (realModule: string, wrapped: string, recKind: string, recBody: string): string => [
    "const fs = require('fs');",
    `const real = require(${JSON.stringify(path.join(REAL_PROVIDERS_DIR, realModule).replace(/\\/g, '/'))});`,
    `const rec = (k, o) => fs.appendFileSync(${JSON.stringify(logPath)}, JSON.stringify(Object.assign({ k: k }, o)) + '\\n');`,
    'for (const k of Object.keys(real)) exports[k] = real[k];',
    'exports.provider = real.provider;',
    `exports.${wrapped} = function (o) {`,
    `  rec(${JSON.stringify(recKind)}, ${recBody});`,
    `  return real.${wrapped}(o);`,
    '};',
  ].join('\n');
  fs.writeFileSync(
    path.join(providersDir, 'ut-compile.js'),
    transit('ut-compile', 'runHvigorBuild', 'compile', '{ module: o.moduleName, product: o.product }'),
  );
  fs.writeFileSync(
    path.join(providersDir, 'ut-run.js'),
    transit(
      'ut-run',
      'runHvigorTest',
      'run',
      '{ module: o.moduleName, product: o.product, prebuild: o.prebuild ? { command: o.prebuild.command } : null }',
    ),
  );

  // 真实 runner 会在没拿到显式 frameworkRoot 时 inferRepoLayout（写 ut-install-diag 等），
  // 夹具按 consumer 布局给一棵最小 framework 树；reports 路径仍由 pattern 决定，不受影响。
  fs.mkdirSync(path.join(root, 'framework', 'skills'), { recursive: true });
  fs.writeFileSync(path.join(root, 'build-profile.json5'), JSON.stringify({ app: { products: [{ name: 'default' }] } }));
  fs.mkdirSync(path.join(root, 'AppScope'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'AppScope', 'app.json5'),
    JSON.stringify({ app: { bundleName: 'com.b03.demo', versionCode: 1, versionName: '1.0.0' } }),
  );
  // 工程根 wrapper：resolveHvigorCommand 的 ③ 分支，解析结果不依赖开发机 PATH。
  for (const wrapper of ['hvigorw', 'hvigorw.bat']) {
    fs.writeFileSync(path.join(root, wrapper), '@echo off\n');
  }
  for (const m of modules) {
    const ohosTest = path.join(root, m.package_path, 'src', 'ohosTest');
    fs.mkdirSync(path.join(ohosTest, 'ets', 'test'), { recursive: true });
    fs.writeFileSync(
      path.join(ohosTest, 'module.json5'),
      JSON.stringify({ module: { name: `${m.name}_test`, type: 'feature' } }),
    );
    fs.writeFileSync(path.join(ohosTest, 'ets', 'test', 'List.test.ets'), `// ut source of ${m.name}\n`);
  }

  const ctx = {
    projectRoot: root,
    feature: 'b03-ut',
    frameworkRoot: FRAMEWORK_ROOT,
    phase: 'ut',
    phaseRule: { structure_checks: { ut_hvigor_build: { description: 'b' }, ut_hvigor_test: { description: 't' } } },
    featureSpec: { contracts: { modules } },
    resolvedProfile: {
      name: 'shadow', profileDir, yaml: {}, phasesDisabled: [], personalPrerequisites: [],
      capabilities: {
        'ut.compile': { provider: 'hvigor_ohostest', severity: 'BLOCKER' },
        'ut.run': { provider: 'hvigor_hypium', severity: 'BLOCKER' },
      },
    },
  } as unknown as import('../../scripts/utils/types').CheckContext;
  return { root, modules, feature: 'b03-ut', ctx };
}

function utReportsDir(fx: UtFixture): string {
  return path.join(fx.root, 'doc', 'features', fx.feature, 'ut', 'reports');
}

/** 该模块的 ohosTest 源码文件——改它即改编译输入（出包字节随之变，见 writeSignedHap）。 */
function utSourceFile(fx: UtFixture, moduleName: string): string {
  const mod = fx.modules.find(m => m.name === moduleName)!;
  return path.join(fx.root, mod.package_path, 'src', 'ohosTest', 'ets', 'test', 'List.test.ets');
}

function readDispatchLog(root: string): UtDispatchLog {
  const p = path.join(root, 'dispatch.jsonl');
  const out: UtDispatchLog = { compile: [], run: [] };
  if (!fs.existsSync(p)) return out;
  for (const line of fs.readFileSync(p, 'utf-8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const rec = JSON.parse(line) as { k: string } & Record<string, unknown>;
    if (rec.k === 'compile') out.compile.push({ module: String(rec.module), product: rec.product as string });
    else out.run.push({ module: String(rec.module), product: rec.product as string, prebuild: rec.prebuild });
  }
  return out;
}

/** V1：编译日志与 meta 在 test 阶段跑完后必须**逐字不变**（改前会被第二次出包覆盖）。 */
function readBuildArtifactDigests(fx: UtFixture): Record<string, string> {
  const crypto = require('crypto') as typeof import('crypto');
  const dir = utReportsDir(fx);
  const out: Record<string, string> = {};
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir).sort()) {
    if (!/^hvigor-ut-build\..*\.(log|meta\.json)$/.test(f)) continue;
    out[f] = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, f))).digest('hex');
  }
  return out;
}

function readLatestExecutionKeyRecord(fx: UtFixture): Record<string, unknown> | null {
  const base = utReportsDir(fx);
  if (!fs.existsSync(base)) return null;
  const stamps = fs.readdirSync(base, { withFileTypes: true })
    .filter(e => e.isDirectory() && fs.existsSync(path.join(base, e.name, 'ut', 'execution-key.json')))
    .map(e => e.name)
    .sort();
  const latest = stamps[stamps.length - 1];
  if (!latest) return null;
  return JSON.parse(fs.readFileSync(path.join(base, latest, 'ut', 'execution-key.json'), 'utf-8')) as Record<string, unknown>;
}

function withFakeDevice<T>(fn: () => T): T {
  const prev = process.env.HARNESS_HDC_TARGET;
  process.env.HARNESS_HDC_TARGET = 'B03FAKE';
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.HARNESS_HDC_TARGET;
    else process.env.HARNESS_HDC_TARGET = prev;
  }
}

interface UtRoundResult {
  details: string;
  runDispatches: number;
  compileDispatches: number;
  threw: boolean;
  spawns: ToolSpawns;
}

/** 一轮 check-ut 编排：collector 按次创建，同时传给 build 与 test 两侧。 */
function runUtRound(fx: UtFixture, opts: { aa?: AaMode; forceDevice?: boolean } = {}): UtRoundResult {
  const roundCtx = opts.forceDevice
    ? ({ ...(fx.ctx as unknown as Record<string, unknown>), forceDevice: true } as unknown as typeof fx.ctx)
    : fx.ctx;
  const before = readDispatchLog(fx.root);
  const boundary = installToolBoundary(fx, { aa: opts.aa });
  let details = '';
  let threw = false;
  try {
    const builds = new Map<string, unknown>();
    checkUtHvigorBuild(roundCtx, [], [], builds);
    details = checkUtHvigorTest(roundCtx, [], [], builds)[0]?.details ?? '';
  } catch {
    // check-ut.ts:4097 的 safeRun 在生产里兜住这条；本用例只关心它留下了什么记录
    threw = true;
  } finally {
    boundary.restore();
  }
  const after = readDispatchLog(fx.root);
  return {
    details,
    threw,
    spawns: boundary.spawns,
    runDispatches: after.run.length - before.run.length,
    compileDispatches: after.compile.length - before.compile.length,
  };
}

// V1：真实编排 + 真实 runner。断言全部落在**进程调用边界**：两个模块的
// genOnDeviceTestHap 恰 2 次（改前 test 阶段会再出一次，共 4 次），且编译日志/meta 不被覆盖。
function testV1CollectorWiring(): void {
  const fx = makeUtOrchestrationFixture([
    { name: 'Alpha', package_path: '02-Feature/Alpha' },
    { name: 'Beta', package_path: '02-Feature/Beta' },
  ]);
  const boundary = installToolBoundary(fx);
  try {
    withFakeDevice(() => {
      const builds = new Map<string, unknown>();
      const buildRes = checkUtHvigorBuild(fx.ctx, [], [], builds);
      assert(buildRes[0]?.status === 'PASS', `build 应 PASS：${buildRes[0]?.details}`);
      assert(builds.size === 2, `两个模块的成功出包都应进 collector，实际 ${builds.size}`);
      assert(
        boundary.spawns.hvigor.length === 2,
        `build 阶段 genOnDeviceTestHap 恰 2 次，实际 ${boundary.spawns.hvigor.length}`,
      );
      const digestsAfterBuild = readBuildArtifactDigests(fx);
      assert(Object.keys(digestsAfterBuild).length === 4, `每模块一份 log + 一份 meta，实际 ${Object.keys(digestsAfterBuild).join(',')}`);

      const testRes = checkUtHvigorTest(fx.ctx, [], [], builds);
      assert(
        boundary.spawns.hvigor.length === 2,
        `test 阶段不得再出包（改前两模块共 4 次），实际 ${boundary.spawns.hvigor.length}`,
      );
      assert(
        JSON.stringify(readBuildArtifactDigests(fx)) === JSON.stringify(digestsAfterBuild),
        'hvigor-ut-build.<module>.log/.meta.json 在 test 阶段后必须逐字不变',
      );
      assert(
        boundary.spawns.install.length === 2 && boundary.spawns.aaTest.length === 2,
        `两个模块各装机各执行一次，实际 install=${boundary.spawns.install.length} aaTest=${boundary.spawns.aaTest.length}`,
      );

      const log = readDispatchLog(fx.root);
      assert(log.run.length > 0, `ut.run 未被调用，checkUtHvigorTest 提前返回：${testRes[0]?.details}`);
      assert(log.compile.length === 2, `ut.compile 每模块恰一次，实际 ${log.compile.length}`);
      assert(log.run.length === 2, `ut.run 每模块恰一次，实际 ${log.run.length}`);
      for (const r of log.run) {
        assert(r.prebuild !== null, `${r.module} 的 ut.run 应收到非空 prebuild`);
        assert(r.product === 'default', `${r.module} 的 product 应贯穿：${r.product}`);
      }
      assert(
        log.run.map(r => r.module).sort().join(',') === 'Alpha,Beta',
        `ut.run 的模块集合应与 build 一致：${log.run.map(r => r.module).join(',')}`,
      );
    });
  } finally {
    boundary.restore();
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
}

// V3a（plan §6 / codex review 第 1 轮 #5 补项）：HARNESS_SKIP_HVIGOR=1 的**正式编排**——
// skippedByEnv ⇒ ut_hvigor_build FAIL ⇒ check-ut.ts:4536 短路，checkUtHvigorTest 根本不被调用。
// 显式计数：ut.run dispatch 零次、genOnDeviceTestHap 零次、hdc 零次，且 skip 不进 collector。
function testV3aSkipEnvShortCircuit(): void {
  const fx = makeUtOrchestrationFixture([
    { name: 'Alpha', package_path: '02-Feature/Alpha' },
    { name: 'Beta', package_path: '02-Feature/Beta' },
  ]);
  const boundary = installToolBoundary(fx);
  const prev = process.env.HARNESS_SKIP_HVIGOR;
  process.env.HARNESS_SKIP_HVIGOR = '1';
  try {
    withFakeDevice(() => {
      const builds = new Map<string, unknown>();
      let buildRes: ReturnType<typeof checkUtHvigorBuild> = [];
      try {
        buildRes = checkUtHvigorBuild(fx.ctx, [], [], builds);
      } catch {
        /* 归因路径依赖真实工具链探针，与本断言无关 */
      }
      const buildFailed = buildRes.some(r => r.id === 'ut_hvigor_build' && r.status === 'FAIL');
      assert(buildFailed, `显式跳过必须判 ut_hvigor_build FAIL：${buildRes.map(r => `${r.id}=${r.status}`).join(',')}`);
      // check-ut.ts:4536 的短路语义：buildFailed 为真 → 直接产 FAIL，**不调** checkUtHvigorTest
      if (!buildFailed) checkUtHvigorTest(fx.ctx, [], [], builds);
      assert(builds.size === 0, `跳过不得被洗成构建成功进 collector，实际 ${builds.size}`);
      const log = readDispatchLog(fx.root);
      assert(log.run.length === 0, `ut.run dispatch 必须为 0，实际 ${log.run.length}`);
      assert(boundary.spawns.hvigor.length === 0, `genOnDeviceTestHap spawn 必须为 0，实际 ${boundary.spawns.hvigor.length}`);
      const hdc = boundary.spawns.install.length + boundary.spawns.aaTest.length;
      assert(hdc === 0, `装机/执行 hdc spawn 必须为 0，实际 ${hdc}`);
    });
  } finally {
    if (prev === undefined) delete process.env.HARNESS_SKIP_HVIGOR;
    else process.env.HARNESS_SKIP_HVIGOR = prev;
    boundary.restore();
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
}

// V3b / V11①：无 collector 的路径（check-exit.ts:317 直调形态）——test 侧拿不到 prebuild，
// 走今天的内建出包，且**不参与执行键复用**（复用资格前置第 1 条不满足）。
function testV11NoCollectorNoReuse(): void {
  const fx = makeUtOrchestrationFixture([{ name: 'Alpha', package_path: '02-Feature/Alpha' }]);
  const boundary = installToolBoundary(fx);
  try {
    withFakeDevice(() => {
      const res = checkUtHvigorTest(fx.ctx, [], []);
      const log = readDispatchLog(fx.root);
      assert(log.run.length > 0, `ut.run 未被调用，checkUtHvigorTest 提前返回：${res[0]?.details}`);
      assert(log.compile.length === 0, 'test 侧不得自己调 ut.compile provider');
      assert(log.run.length === 1, `ut.run 仍被调用（真跑），实际 ${log.run.length}`);
      assert(log.run[0]!.prebuild === null, '无 collector 时 prebuild 必须缺席');
      assert(
        boundary.spawns.hvigor.length === 1,
        `无 prebuild 时内建出包必须真的发生，实际 ${boundary.spawns.hvigor.length}`,
      );
      const details = res[0]?.details ?? '';
      assert(
        /本次调用无成功 prebuild，不做同键复用/.test(details),
        `复用资格前置应出词并拒绝复用：${details}`,
      );
    });
  } finally {
    boundary.restore();
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
}

// 失败的出包不得被洗成"本次已出包"：build 在进程边界返回非零 → 不进 collector。
function testFailedBuildNeverEntersCollector(): void {
  const fx = makeUtOrchestrationFixture([{ name: 'FailOne', package_path: '02-Feature/FailOne' }]);
  const boundary = installToolBoundary(fx, { buildFailModules: ['FailOne'] });
  try {
    const builds = new Map<string, unknown>();
    try {
      const buildRes = checkUtHvigorBuild(fx.ctx, [], [], builds);
      assert(buildRes[0]?.status === 'FAIL', 'build 失败应判 FAIL');
    } catch {
      /* 归因路径依赖真实工具链探针，与本断言无关 */
    }
    assert(builds.size === 0, `失败出包不得进 collector，实际 ${builds.size}`);
  } finally {
    boundary.restore();
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
}

// check-ut.ts 的接线：**一个** collector 按次创建，同时传给 build 与 test 两侧。
function testCheckUtPassesOneCollectorToBothStages(): void {
  const src = fs.readFileSync(path.join(FRAMEWORK_ROOT, 'harness', 'scripts', 'check-ut.ts'), 'utf-8');
  assert(
    (src.match(/const utBuilds = new Map<string, unknown>\(\);/g) ?? []).length === 1,
    'check-ut 必须按次创建恰一个 collector',
  );
  assert(/featureNewUtFiles,\s*\n\s*utBuilds,/.test(src), 'collector 必须传给 checkUtHvigorBuild');
  assert(/checkUtHvigorTest\(ctx, runScope, targetCases, utBuilds\)/.test(src), 'collector 必须传给 checkUtHvigorTest');
}

// ---------------------------------------------------------------------------
// V4 / V4b / V5 / V6 / V6b / V11②（plan 5e1c7a93 D2）：UT 同键复用的生产路径。
// 复用轮的判据落在进程边界：**装机与执行的 hdc spawn 为 0**（身份探针允许非零）。
// ---------------------------------------------------------------------------

// V4 + V5：输入不变 → 第二轮零装机零执行；改 HAP 字节 → 整轮真跑（键不符）；
// --force-device → 真跑（用户要求）。
function testV4V5SameKeyReuse(): void {
  const fx = makeUtOrchestrationFixture([{ name: 'Alpha', package_path: '02-Feature/Alpha' }]);
  try {
    withFakeDevice(() => {
      const first = runUtRound(fx);
      assert(first.runDispatches === 1, `第一轮应真跑，实际 dispatch ${first.runDispatches}`);
      assert(first.spawns.aaTest.length === 1, `第一轮应真的发一次 aa test，实际 ${first.spawns.aaTest.length}`);
      assert(/本轮真跑/.test(first.details), first.details);

      const second = runUtRound(fx);
      assert(second.runDispatches === 0, `第二轮应复用、零 ut.run dispatch，实际 ${second.runDispatches}`);
      assert(
        second.spawns.install.length === 0 && second.spawns.aaTest.length === 0,
        `复用轮零装机零执行，实际 install=${second.spawns.install.length} aaTest=${second.spawns.aaTest.length}`,
      );
      assert(/同键复用/.test(second.details), second.details);

      // ①HAP 字节变 → 整轮键变 → 真跑。字节由本轮出包产出，所以改的是编译输入（源码），
      // 而不是手改盘上产物——后者会被下一轮 build 原样重写，等于没改。
      fs.writeFileSync(utSourceFile(fx, 'Alpha'), '// changed ut source\n');
      const third = runUtRound(fx);
      assert(third.runDispatches === 1, `HAP 变了必须真跑，实际 ${third.runDispatches}`);
      assert(/其他 execution key/.test(third.details), third.details);

      // ②--force-device → 唯一显式逃生口
      const forced = runUtRound(fx, { forceDevice: true });
      assert(forced.runDispatches === 1, `--force-device 必须真跑，实际 ${forced.runDispatches}`);
      assert(forced.spawns.aaTest.length === 1, '--force-device 轮必须真的执行一次');
      assert(/--force-device/.test(forced.details), forced.details);
    });
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
}

// V4b：两个模块，只改**非首模块**的 HAP → 整轮真跑（两个模块的 ut.run 都被调），不出现半复用。
function testV4bWholeRoundKey(): void {
  const fx = makeUtOrchestrationFixture([
    { name: 'Alpha', package_path: '02-Feature/Alpha' },
    { name: 'Beta', package_path: '02-Feature/Beta' },
  ]);
  try {
    withFakeDevice(() => {
      assert(runUtRound(fx).runDispatches === 2, '第一轮两个模块都真跑');
      const reused = runUtRound(fx);
      assert(reused.runDispatches === 0, '输入不变第二轮应整轮复用');
      assert(reused.spawns.aaTest.length === 0, '复用轮不得发 aa test');
      // 只动**次模块**的编译输入 → 只有 Beta 的 HAP 摘要变
      fs.writeFileSync(utSourceFile(fx, 'Beta'), '// changed ut source of Beta\n');
      const third = runUtRound(fx);
      assert(third.runDispatches === 2, `只改次模块也必须整轮真跑（不半复用），实际 ${third.runDispatches}`);
      assert(third.spawns.aaTest.length === 2, `整轮真跑 = 两个模块都执行，实际 ${third.spawns.aaTest.length}`);
    });
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
}

// V11②（在 spawnSync 边界能证明的那一半；真实 hvigor 增量语义留 B06）：
// 改测试源码 → 正式编排下 prebuild 真的重新出包 → 新 HAP 摘要 ≠ 记录摘要 → 整轮键变 → 真跑。
function testV11bRecompileOnSourceChange(): void {
  const fx = makeUtOrchestrationFixture([{ name: 'Alpha', package_path: '02-Feature/Alpha' }]);
  try {
    withFakeDevice(() => {
      assert(runUtRound(fx).runDispatches === 1, '第一轮真跑并落同键成功记录');
      const reused = runUtRound(fx);
      assert(reused.runDispatches === 0, '输入不变第二轮应复用');
      assert(reused.spawns.hvigor.length === 1, '复用轮的 build 阶段照常出包（D1 不改 build 侧语义）');

      const srcFile = path.join(fx.root, '02-Feature/Alpha', 'src', 'ohosTest', 'ets', 'test', 'List.test.ets');
      fs.writeFileSync(srcFile, '// changed ut source\n');
      const after = runUtRound(fx);
      assert(after.spawns.hvigor.length === 1, `源码变后仍必须真的经过一次出包，实际 ${after.spawns.hvigor.length}`);
      assert(after.runDispatches === 1, `新 HAP 摘要 → 整轮键变 → 必须真跑，实际 ${after.runDispatches}`);
      assert(after.spawns.aaTest.length === 1, '真跑 = 真的发一次 aa test');
      assert(/其他 execution key/.test(after.details), after.details);
    });
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
}

// codex review 第 1 轮 #1：**退出码 0 + Hypium 断言失败**的生产返回形态——
// hdc 命令本身成功，失败只在汇总行里。这一轮不得被记成 success，下一轮必须真跑。
function testCaseFailureNeverRecordedAsSuccess(): void {
  const fx = makeUtOrchestrationFixture([{ name: 'Alpha', package_path: '02-Feature/Alpha' }]);
  try {
    withFakeDevice(() => {
      const failed = runUtRound(fx, { aa: 'fail' });
      assert(failed.runDispatches === 1, '第一轮真跑');
      assert(failed.spawns.aaTest.length === 1, 'aa test 真的发了一次');
      const rec = readLatestExecutionKeyRecord(fx);
      assert(rec !== null, '生产路径必须落一条执行键记录');
      assert(
        rec!.outcome !== 'success',
        `用例失败（Failure: 1、hdc 退出码 0）不得记成 success，实际 outcome=${String(rec!.outcome)}`,
      );

      const next = runUtRound(fx, { aa: 'pass' });
      assert(next.runDispatches === 1, `失败轮之后必须真跑，实际 ${next.runDispatches}`);
      assert(next.spawns.aaTest.length === 1, '下一轮必须真的重新执行，不得复用失败结果');
      assert(/outcome=failed/.test(next.details), next.details);
    });
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
}

// V6：失败轮的记录**由生产路径写出**——链路在进程边界返回非零（不 throw）的一轮记整轮失败，
// 下一轮不复用、真跑，理由指名「最新同键 run outcome=…」；旧成功不被拿来盖新失败。
function testV6FailureRecordWrittenByProduction(): void {
  const fx = makeUtOrchestrationFixture([{ name: 'Alpha', package_path: '02-Feature/Alpha' }]);
  try {
    withFakeDevice(() => {
      assert(runUtRound(fx).runDispatches === 1, '①先落一条同键成功记录');
      const failed = runUtRound(fx, { aa: 'nonzero', forceDevice: true });
      assert(failed.runDispatches === 1, '②失败轮本身也要真跑');
      assert(failed.spawns.aaTest.length === 1, '②失败发生在真实 aa test 的进程边界');
      const third = runUtRound(fx);
      assert(third.runDispatches === 1, `③最新同键失败 → 必须真跑，实际 ${third.runDispatches}`);
      assert(/最新同键 run .* outcome=failed/.test(third.details), third.details);
    });
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
}

// V6b：先有成功历史，再让 checkUtHvigorTest 抛出（生产里被 check-ut.ts:4097 的 safeRun 兜住）。
// 抛出轮留下的是 dispatch 前的**非成功前置记录**，它比第一轮的成功更新 → 下一轮真跑。
function testV6bThrownRoundLeavesNonSuccessRecord(): void {
  const fx = makeUtOrchestrationFixture([{ name: 'Alpha', package_path: '02-Feature/Alpha' }]);
  try {
    withFakeDevice(() => {
      assert(runUtRound(fx).runDispatches === 1, '①先落一条同键成功记录');
      const thrown = runUtRound(fx, { aa: 'throw', forceDevice: true });
      assert(thrown.threw, '②本轮应抛出（生产里由 safeRun 兜住）');
      const third = runUtRound(fx);
      assert(third.runDispatches === 1, `③抛出轮之后必须真跑，不得沿用第一轮的成功，实际 ${third.runDispatches}`);
      assert(/outcome=started/.test(third.details), `前置记录应挡住旧成功：${third.details}`);
    });
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
}

export function runAll(): UnitCaseResult[] {
  const cases: Array<{ name: string; fn: () => void }> = [
    { name: 'ut build collector key identity (5e1c7a93 D1)', fn: testBuildCollectorKeyIdentity },
    { name: 'V1 真实 provider/runner：genOnDeviceTestHap 恰 2 次、编译日志与 meta 不被覆盖', fn: testV1CollectorWiring },
    { name: 'V3a HARNESS_SKIP_HVIGOR=1 正式编排：ut.run 零 dispatch、hvigor/hdc 零 spawn', fn: testV3aSkipEnvShortCircuit },
    { name: 'V11① 无 collector 路径：prebuild 缺席且不参与同键复用', fn: testV11NoCollectorNoReuse },
    { name: '失败出包不得进 collector（不把跳过/失败洗成构建成功）', fn: testFailedBuildNeverEntersCollector },
    { name: 'check-ut 接线：一个 collector 同时传给 build 与 test', fn: testCheckUtPassesOneCollectorToBothStages },
    { name: 'V4/V5 UT 同键复用：输入不变零装机零执行；HAP 变 / --force-device 真跑', fn: testV4V5SameKeyReuse },
    { name: 'V4b 整轮键：只改次模块也整轮真跑（不半复用）', fn: testV4bWholeRoundKey },
    { name: 'V11② 源码变 → 重新出包 → 键变 → 真跑（spawn 边界可证的那一半）', fn: testV11bRecompileOnSourceChange },
    { name: '退出码 0 + Hypium 断言失败不得记 success，下一轮真跑（codex #1）', fn: testCaseFailureNeverRecordedAsSuccess },
    { name: 'V6 失败记录由生产路径写出：旧成功不盖新失败', fn: testV6FailureRecordWrittenByProduction },
    { name: 'V6b 抛出轮留下非成功前置记录，下一轮真跑', fn: testV6bThrownRoundLeavesNonSuccessRecord },
    { name: 'excludes module without scoped UT (Phone)', fn: testExcludesModuleWithoutScopedUt },
    { name: 'keeps all modules that own scoped UT', fn: testKeepsAllModulesThatOwnScopedUt },
    { name: 'fallback to full set when scoped empty', fn: testFallbackWhenScopedEmpty },
    { name: 'fallback to full set when none match', fn: testFallbackWhenNoneMatch },
    { name: 'fallback:all scope keeps template-only module (locked)', fn: testFallbackAllScopeKeepsTemplateModule },
    { name: 'orders feature-new module first (423e5d0f)', fn: testOrdersFeatureNewModuleFirst },
    { name: 'order stable without feature-new info', fn: testOrderStableWithoutFeatureNew },
  ];
  return cases.map(({ name, fn }) => {
    try {
      fn();
      return { name, ok: true };
    } catch (e) {
      return { name, ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
}
