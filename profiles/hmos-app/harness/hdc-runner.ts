// ============================================================================
// hdc-runner.ts
// ============================================================================
// 封装对 HarmonyOS Device Connector (hdc) 的调用，用于 v2.3 P2 的 ut_hvigor_test
// 真机执行链路：genOnDeviceTestHap 出包 → hdc install → hdc shell aa test → 解析。
//
// 为什么不直接用 `hvigor test`：
//   `hvigor test` 走 unit test 路径，强制要求模块下存在 TestAbility.ets。
//   HAR / HSP 库模块（如某 Feature 级 HAR）没有 TestAbility，hvigor 立刻报：
//     ERROR: srcEntry file '.../testability/TestAbility.ets' does not exist.
//   而 DevEco Studio "Run ohosTest" 实际是用 `genOnDeviceTestHap` 出 ohosTest
//   HAP，再用 hdc 完成装机 + aa test。本模块按这套流程把它复刻进 harness。
//
// 数据来源（一次配置不必再传）：
//   bundleName       ← AppScope/app.json5 > app.bundleName
//   ohosTestModule   ← <srcPath>/src/ohosTest/module.json5 > module.name
//   testRunner       ← 默认 "/ets/testrunner/OpenHarmonyTestRunner"（hypium 标准），
//                      可由 framework.config.json > toolchain.devEcoStudio.testRunner 覆盖
//   timeoutMs        ← framework.config.json > toolchain.devEcoStudio.aaTestTimeoutMs，默认 60s
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync, SpawnSyncReturns } from 'child_process';
import { loadDevEcoConfig } from '../../../harness/config';
import { HypiumTestResult } from './hvigor-runner';

const MAX_LOG_CHARS = 200_000;

export interface OhosTestMetadata {
  bundleName: string;
  ohosTestModuleName: string;
  testRunner: string;
  /** 单条用例超时（ms），传给 aa test -w */
  testTimeoutMs: number;
}

export interface DeviceProbeResult {
  available: boolean;
  hdcPresent: boolean;
  targets: string[];
  raw: string;
}

export interface HdcInstallResult {
  ok: boolean;
  exitCode: number;
  durationMs: number;
  output: string;
  diagnosis?: HdcFailureDiagnosis;
}

export interface AaTestResult {
  ok: boolean;
  exitCode: number;
  durationMs: number;
  /** 完整 stdout + stderr（截断到 MAX_LOG_CHARS） */
  output: string;
  /** hypium 解析后的统计；仅当能解析到 OHOS_REPORT_RESULT 时填充 */
  report?: HypiumTestResult;
  diagnosis?: HdcFailureDiagnosis;
}

export type HdcFailureKind =
  | 'device_locked'
  | 'ability_start_failed'
  | 'aa_test_timeout'
  | 'aa_test_no_result'
  | 'install_failed'
  | 'test_failed';

export interface HdcFailureDiagnosis {
  kind: HdcFailureKind;
  summary: string;
  suggestion: string;
}

export interface OnDeviceUtRunResult {
  /** 是否真正进入装机/执行阶段（false：被 env 跳过 / 工具不存在 / 找不到 hap） */
  executed: boolean;
  toolMissing?: boolean;
  skippedByEnv?: boolean;
  /**
   * 哪一阶段触发的失败（只在失败时设置）；用于 check-ut.ts 显示更精准的诊断：
   *   'metadata' = 解析 bundle / module 失败
   *   'hap_not_found' = 找不到 ohosTest 出包
   *   'install' = hdc install 失败
   *   'run' = aa test 启动失败 / 异常退出
   *   'no_pass' = 跑通但有用例 fail / error
   */
  failedAt?: 'metadata' | 'hap_not_found' | 'install' | 'run' | 'no_pass';
  durationMs: number;
  /** 总日志（命令拼接 + 各阶段输出），落盘 + 报告展示 */
  logExcerpt: string;
  /** 完整日志落盘路径（相对 cwd） */
  logPath?: string;
  /** 各阶段细分结果 */
  install?: HdcInstallResult;
  aaTest?: AaTestResult;
  metadata?: OhosTestMetadata;
  /** 直接复用 hvigor-runner 的 HypiumTestResult，让上层报告统一 */
  report?: HypiumTestResult;
  /** 错误条目，给 check 报告 */
  errors: Array<{ message: string }>;
}

// ----------------------------------------------------------------------------
// JSON5 解析（HarmonyOS 配置文件常含注释、尾逗号；与 check-coding.ts 同源）
// ----------------------------------------------------------------------------
function parseJson5(content: string): unknown {
  let stripped = content.replace(/^\s*\/\/.*$/gm, '');
  stripped = stripped.replace(/([^"':])\s*\/\/.*$/gm, '$1');
  stripped = stripped.replace(/\/\*[\s\S]*?\*\//g, '');
  stripped = stripped.replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(stripped);
}

// ----------------------------------------------------------------------------
// 元数据解析
// ----------------------------------------------------------------------------

/**
 * 从 AppScope/app.json5 读取 bundleName。
 * 找不到文件或字段缺失抛错（让调用方翻译成 BLOCKER FAIL，不静默兜底）。
 */
export function loadAppBundleName(projectRoot: string): string {
  const appJson = path.join(projectRoot, 'AppScope', 'app.json5');
  if (!fs.existsSync(appJson)) {
    throw new Error(`未找到 AppScope/app.json5：${appJson}`);
  }
  const obj = parseJson5(fs.readFileSync(appJson, 'utf-8')) as { app?: { bundleName?: string } };
  const name = obj?.app?.bundleName;
  if (!name || typeof name !== 'string') {
    throw new Error('AppScope/app.json5 > app.bundleName 缺失或非字符串');
  }
  return name;
}

/**
 * 读取模块的 ohosTest module.json5，拿到 ohosTest module name。
 * srcPath：模块相对项目根的路径（如 `02-Feature/FeatureAlpha`），即 build-profile.json5
 *          modules[].srcPath 去掉 './' 前缀。
 */
export function loadOhosTestModuleName(projectRoot: string, srcPath: string): string {
  const file = path.join(projectRoot, srcPath, 'src', 'ohosTest', 'module.json5');
  if (!fs.existsSync(file)) {
    throw new Error(`未找到 ohosTest/module.json5：${file}`);
  }
  const obj = parseJson5(fs.readFileSync(file, 'utf-8')) as { module?: { name?: string } };
  const name = obj?.module?.name;
  if (!name || typeof name !== 'string') {
    throw new Error(`${file} > module.name 缺失或非字符串`);
  }
  return name;
}

/**
 * 综合解析跑测试需要的全部元数据。
 * testRunner / timeoutMs 允许从 framework.config.json 覆盖；都不配置则走 hypium 默认。
 */
export function loadOhosTestMetadata(projectRoot: string, srcPath: string): OhosTestMetadata {
  const bundleName = loadAppBundleName(projectRoot);
  const ohosTestModuleName = loadOhosTestModuleName(projectRoot, srcPath);
  const cfg = (loadDevEcoConfig(projectRoot) ?? {}) as Record<string, unknown>;
  const testRunner = (cfg.testRunner as string) || '/ets/testrunner/OpenHarmonyTestRunner';
  const testTimeoutMs = Number(cfg.aaTestTimeoutMs) || 60_000;
  return { bundleName, ohosTestModuleName, testRunner, testTimeoutMs };
}

/**
 * 在模块的 build/<product>/outputs/ohosTest/ 下找已签名 hap。
 * 命名约定（hvigor 5.x）：`<srcModuleName>-ohosTest-signed.hap`，
 *   srcModuleName 取 build-profile.json5 modules[].name（即 contracts.modules[].name）。
 */
export function findOhosTestSignedHap(
  projectRoot: string,
  srcPath: string,
  srcModuleName: string,
  buildProduct?: string,
): string | null {
  const segments: string[] = [];
  if (buildProduct && buildProduct.trim()) {
    segments.push(buildProduct.trim());
  }
  if (!segments.includes('default')) {
    segments.push('default');
  }

  for (const seg of segments) {
    const conventional = path.join(
      projectRoot,
      srcPath,
      'build',
      seg,
      'outputs',
      'ohosTest',
      `${srcModuleName}-ohosTest-signed.hap`,
    );
    if (fs.existsSync(conventional)) return conventional;

    const dir = path.join(projectRoot, srcPath, 'build', seg, 'outputs', 'ohosTest');
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir).filter(f => f.endsWith('-signed.hap'));
      if (files.length) return path.join(dir, files[0]!);
    }
  }

  const buildRoot = path.join(projectRoot, srcPath, 'build');
  if (!fs.existsSync(buildRoot)) return null;
  for (const ent of fs.readdirSync(buildRoot, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const ohosDir = path.join(buildRoot, ent.name, 'outputs', 'ohosTest');
    if (!fs.existsSync(ohosDir)) continue;
    const conv = path.join(ohosDir, `${srcModuleName}-ohosTest-signed.hap`);
    if (fs.existsSync(conv)) return conv;
    const files = fs.readdirSync(ohosDir).filter(f => f.endsWith('-signed.hap'));
    if (files.length) return path.join(ohosDir, files[0]!);
  }
  return null;
}

// ----------------------------------------------------------------------------
// 设备探测
// ----------------------------------------------------------------------------

export function probeDevices(): DeviceProbeResult {
  const isWin = process.platform === 'win32';
  const probe = spawnSync('hdc', ['list', 'targets'], {
    encoding: 'utf-8',
    shell: isWin,
    timeout: 5000,
  });
  if (probe.error || probe.status !== 0) {
    return {
      available: false,
      hdcPresent: false,
      targets: [],
      raw: probe.stderr ?? probe.error?.message ?? '',
    };
  }
  const raw = (probe.stdout ?? '').trim();
  if (!raw || /^\[?Empty\]?$/i.test(raw)) {
    return { available: false, hdcPresent: true, targets: [], raw };
  }
  const targets = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  return { available: targets.length > 0, hdcPresent: true, targets, raw };
}

// ----------------------------------------------------------------------------
// hdc install / aa test
// ----------------------------------------------------------------------------

function truncate(s: string): string {
  return s.length > MAX_LOG_CHARS ? s.slice(0, MAX_LOG_CHARS) + '\n... [truncated]' : s;
}

function runHdc(args: string[], timeoutMs = 60_000): SpawnSyncReturns<string> {
  return spawnSync('hdc', args, {
    encoding: 'utf-8',
    shell: process.platform === 'win32',
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  });
}

/**
 * `hdc install -r <hap>`。-r 表示已存在则覆盖。
 * 注意 hdc 即使 install 失败 stderr 也常为空，需要扫 stdout 找 "msg:install bundle successfully"
 * 之类标志位才稳。这里用 exit code 0 + 不含 "fail/error" 关键词作为成功判据。
 */
export function installHap(hapPath: string): HdcInstallResult {
  const t0 = Date.now();
  const ret = runHdc(['install', '-r', hapPath], 60_000);
  const out = truncate(`$ hdc install -r ${hapPath}\n${ret.stdout ?? ''}\n${ret.stderr ?? ''}`);
  const lower = out.toLowerCase();
  const hasFailureWord = /\bfailed\b|install failed|error\b/.test(lower) && !/successfully/.test(lower);
  const ok = ret.status === 0 && !hasFailureWord;
  const diagnosis = ok
    ? undefined
    : {
        kind: 'install_failed' as const,
        summary: `hdc install 失败 (exit=${ret.status ?? -1})。`,
        suggestion:
          '检查设备是否在线且已授权、空间是否充足、签名/包名是否冲突；可先手动执行日志中的 hdc install 命令确认设备侧错误。',
      };
  return { ok, exitCode: ret.status ?? -1, durationMs: Date.now() - t0, output: out, diagnosis };
}

/**
 * `hdc shell aa test -b <bundle> -m <module> -s unittest <runner> -w <ms>`。
 * 触发 OpenHarmonyTestRunner 在设备上执行 hypium 测试，stdout 同步回流。
 */
export function runAaTest(meta: OhosTestMetadata): AaTestResult {
  const t0 = Date.now();
  const cmdParts = [
    'shell', 'aa', 'test',
    '-b', meta.bundleName,
    '-m', meta.ohosTestModuleName,
    '-s', 'unittest', meta.testRunner,
    '-w', String(meta.testTimeoutMs),
  ];
  // aa test 的整体 walltime 上界：每条用例 timeoutMs * 估算（最少 5 分钟）
  const walltimeMs = Math.max(5 * 60_000, meta.testTimeoutMs * 10);
  const ret = runHdc(cmdParts, walltimeMs);
  const out = truncate(`$ hdc ${cmdParts.join(' ')}\n${ret.stdout ?? ''}\n${ret.stderr ?? ''}`);

  const report = parseHypiumStdout(out);
  // 判定是否真的跑过：
  //   1) hdc 命令本身要 exit 0
  //   2) 必须看到 OHOS_REPORT_RESULT 行（不然只是装包成功但 ability 没 ready）
  //   3) Failure + Error 都为 0
  const hasResult = !!report;
  const noFailure = report ? report.failed === 0 : false;
  const ok = ret.status === 0 && hasResult && noFailure;
  const diagnosis = ok
    ? undefined
    : classifyAaTestFailure(out, ret.status ?? -1, report);

  return {
    ok,
    exitCode: ret.status ?? -1,
    durationMs: Date.now() - t0,
    output: out,
    report,
    diagnosis,
  };
}

// ----------------------------------------------------------------------------
// hypium 输出解析（与 hvigor-runner 保留两份独立解析，避免循环依赖）
// 导出供单元测试用：DevEco / hypium 升级输出格式时这是回归风险最高的点。
// ----------------------------------------------------------------------------

export function parseHypiumStdout(out: string): HypiumTestResult | undefined {
  const result: HypiumTestResult = { total: 0, passed: 0, failed: 0, skipped: 0, failures: [] };
  let matched = false;
  let curSuite = '';
  let lastTest = '';
  for (const line of out.split(/\r?\n/)) {
    // OHOS_REPORT_RESULT: stream=Tests run: X, Failure: Y, Error: Z, Pass: W, Ignore: V
    const mSummary = line.match(/Tests run:\s*(\d+),\s*Failure:\s*(\d+),\s*Error:\s*(\d+),\s*Pass:\s*(\d+)(?:,\s*Ignore:\s*(\d+))?/);
    if (mSummary) {
      result.total = Number(mSummary[1]);
      result.failed = Number(mSummary[2]) + Number(mSummary[3]);
      result.passed = Number(mSummary[4]);
      result.skipped = Number(mSummary[5] ?? 0);
      matched = true;
      continue;
    }
    const mClass = line.match(/OHOS_REPORT_STATUS:\s*class=(.+)/);
    if (mClass) { curSuite = mClass[1].trim(); continue; }
    const mTest = line.match(/OHOS_REPORT_STATUS:\s*test=(.+)/);
    if (mTest) { lastTest = mTest[1].trim(); continue; }
    const mStack = line.match(/OHOS_REPORT_STATUS:\s*stack=(.+)/);
    if (mStack) {
      result.failures.push({ suite: curSuite, test: lastTest || '<unknown>', message: mStack[1].trim() });
      continue;
    }
  }
  return matched ? result : undefined;
}

export function classifyAaTestFailure(
  output: string,
  exitCode: number,
  report?: HypiumTestResult,
): HdcFailureDiagnosis {
  if (report && report.failed > 0) {
    return {
      kind: 'test_failed',
      summary: `Hypium 用例失败：total=${report.total} passed=${report.passed} failed=${report.failed} skipped=${report.skipped}`,
      suggestion: '按失败用例堆栈修复 UT 预期、被测实现或 Spy/Stub 预设后重跑。',
    };
  }

  if (/screen is locked|unlock screen failed|device screen is locked|Error Code:\s*10106102/i.test(output)) {
    return {
      kind: 'device_locked',
      summary: '设备已连接，但 aa test 启动测试 Ability 时发现屏幕锁定，无法自动解锁。',
      suggestion:
        '请手动解锁真机并保持在桌面/前台（不要锁屏），确认 `hdc list targets` 仍非空后重跑 UT harness。',
    };
  }

  if (/timed?\s*out|timeout|TestFinished-ResultCode:\s*-?2/i.test(output)) {
    return {
      kind: 'aa_test_timeout',
      summary: `aa test 超时或未在期限内返回 Hypium 结果（exit=${exitCode}）。`,
      suggestion:
        '确认设备未息屏、应用测试 Ability 能启动；必要时调大 framework.config.json > toolchain.devEcoStudio.aaTestTimeoutMs 后重跑。',
    };
  }

  if (/failed to start ability|start ability failed|TestFinished-ResultCode:\s*-/i.test(output)) {
    return {
      kind: 'ability_start_failed',
      summary: `aa test 未能启动测试 Ability 或启动后异常退出（exit=${exitCode}）。`,
      suggestion:
        '检查 bundleName、ohosTest module.name、testRunner 路径与设备状态；若日志含锁屏/权限/签名等 Error Code，优先按对应提示处理。',
    };
  }

  return {
    kind: 'aa_test_no_result',
    summary: `aa test 未输出 OHOS_REPORT_RESULT（exit=${exitCode}），无法确认用例真实执行。`,
    suggestion:
      '查看 hdc-test.log，重点检查 testRunner 路径、ohosTest module name、测试 Ability 是否启动，以及设备是否弹出权限/锁屏/前台限制。',
  };
}

// ----------------------------------------------------------------------------
// 总编排：装机 → 跑测 → 落日志
// ----------------------------------------------------------------------------

export interface OnDeviceUtOptions {
  projectRoot: string;
  harnessRoot: string;
  feature: string;
  phase: string;
  /** 模块名（contracts.modules[].name，对应 build-profile.json5 modules[].name） */
  srcModuleName: string;
  /** 模块源码相对路径（相对 projectRoot） */
  srcPath: string;
  /**
   * 与 hvigor `-p product=` / `build/<product>/outputs/ohosTest` 对齐的产物目录段。
   * 不传时 `findOhosTestSignedHap` 会尝试 default 并扫描 `build/*`。
   */
  buildProduct?: string;
  /** 跳过环境变量（v2.2 风格） */
  skipEnvVar?: string;
}

function ensureReportDir(harnessRoot: string, feature: string, phase: string): string {
  const dir = path.join(harnessRoot, 'reports', feature, phase);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function runOnDeviceUt(opts: OnDeviceUtOptions): OnDeviceUtRunResult {
  const t0 = Date.now();
  const errors: Array<{ message: string }> = [];
  const logChunks: string[] = [];
  const append = (s: string) => logChunks.push(s);

  if (opts.skipEnvVar && process.env[opts.skipEnvVar]) {
    return {
      executed: false,
      skippedByEnv: true,
      durationMs: 0,
      logExcerpt: `[skipped] env ${opts.skipEnvVar}=${process.env[opts.skipEnvVar]}`,
      errors: [],
    };
  }

  // 1) 元数据
  let metadata: OhosTestMetadata;
  try {
    metadata = loadOhosTestMetadata(opts.projectRoot, opts.srcPath);
    append(`[meta] bundle=${metadata.bundleName} module=${metadata.ohosTestModuleName} runner=${metadata.testRunner} timeoutMs=${metadata.testTimeoutMs}`);
  } catch (err) {
    const msg = (err as Error).message;
    return finalize({
      executed: false,
      failedAt: 'metadata',
      logExcerpt: `[meta] FAIL: ${msg}`,
      errors: [{ message: msg }],
      durationMs: Date.now() - t0,
    }, opts);
  }

  // 2) 找 hap
  const hap = findOhosTestSignedHap(opts.projectRoot, opts.srcPath, opts.srcModuleName, opts.buildProduct);
  if (!hap) {
    const prodHint = opts.buildProduct?.trim() ? `product=${opts.buildProduct.trim()}` : 'default + build/* 扫描';
    const msg = `未在 ${opts.srcPath}/build/<product>/outputs/ohosTest/ 找到 *-signed.hap（已尝试 ${prodHint}），请先 genOnDeviceTestHap`;
    return finalize({
      executed: false,
      failedAt: 'hap_not_found',
      metadata,
      logExcerpt: `${logChunks.join('\n')}\n[hap] FAIL: ${msg}`,
      errors: [{ message: msg }],
      durationMs: Date.now() - t0,
    }, opts);
  }
  append(`[hap] ${hap}`);

  // 3) 设备
  const dev = probeDevices();
  append(`[device] hdcPresent=${dev.hdcPresent} available=${dev.available} targets=${dev.targets.join(',')}`);
  if (!dev.hdcPresent) {
    const msg = '未找到 hdc 命令（HarmonyOS Device Connector）。请确保 DevEco SDK 的 toolchains 在 PATH 中。';
    return finalize({
      executed: false,
      toolMissing: true,
      metadata,
      logExcerpt: `${logChunks.join('\n')}\n[device] FAIL: ${msg}`,
      errors: [{ message: msg }],
      durationMs: Date.now() - t0,
    }, opts);
  }
  if (!dev.available) {
    const msg = 'hdc 检测到 [Empty] —— 没有真机/模拟器在线。本规则不接受 SKIP，请先连接设备或启动模拟器。';
    return finalize({
      executed: false,
      failedAt: 'install',
      metadata,
      logExcerpt: `${logChunks.join('\n')}\n[device] FAIL: ${msg}\n[device.raw] ${dev.raw}`,
      errors: [{ message: msg }],
      durationMs: Date.now() - t0,
    }, opts);
  }

  // 4) install
  const install = installHap(hap);
  append(install.output);
  if (!install.ok) {
    const diagnosis = install.diagnosis;
    return finalize({
      executed: true,
      failedAt: 'install',
      metadata,
      install,
      logExcerpt: logChunks.join('\n'),
      errors: [
        {
          message:
            diagnosis
              ? `失败阶段：install；${diagnosis.summary}\n修复建议：${diagnosis.suggestion}`
              : `hdc install 失败 (exit=${install.exitCode})`,
        },
      ],
      durationMs: Date.now() - t0,
    }, opts);
  }

  // 5) aa test
  const aa = runAaTest(metadata);
  append(aa.output);
  if (!aa.ok) {
    const ec = aa.exitCode;
    const diagnosis = aa.diagnosis;
    const msg = diagnosis
      ? `失败阶段：${diagnosis.kind}；${diagnosis.summary}\n修复建议：${diagnosis.suggestion}`
      : aa.report
        ? `用例存在失败：total=${aa.report.total} passed=${aa.report.passed} failed=${aa.report.failed} skipped=${aa.report.skipped}`
        : `aa test 没有输出 OHOS_REPORT_RESULT（exit=${ec}）。常见原因：testRunner 路径错误 / module name 错误 / 测试 ability 未启动。`;
    return finalize({
      executed: true,
      failedAt: aa.report ? 'no_pass' : 'run',
      metadata,
      install,
      aaTest: aa,
      report: aa.report,
      logExcerpt: logChunks.join('\n'),
      errors: [{ message: msg }],
      durationMs: Date.now() - t0,
    }, opts);
  }

  return finalize({
    executed: true,
    metadata,
    install,
    aaTest: aa,
    report: aa.report,
    logExcerpt: logChunks.join('\n'),
    errors,
    durationMs: Date.now() - t0,
  }, opts);
}

function finalize(
  res: OnDeviceUtRunResult,
  opts: OnDeviceUtOptions,
): OnDeviceUtRunResult {
  // 落盘日志
  try {
    const dir = ensureReportDir(opts.harnessRoot, opts.feature, opts.phase);
    const file = path.join(dir, 'hdc-test.log');
    fs.writeFileSync(file, res.logExcerpt, 'utf-8');
    res.logPath = path.relative(process.cwd(), file).replace(/\\/g, '/');
  } catch {
    // 日志落盘失败不阻断主流程；上层报告里依然能看到 logExcerpt 尾段。
  }
  // 截断 logExcerpt 到 8KB 给报告展示
  if (res.logExcerpt.length > 8000) {
    res.logExcerpt = res.logExcerpt.slice(-8000);
  }
  return res;
}
