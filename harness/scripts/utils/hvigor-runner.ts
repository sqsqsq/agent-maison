// ============================================================================
// hvigor-runner.ts
// ============================================================================
// 封装对 HarmonyOS 构建工具 hvigor 的调用，供：
//   - check-coding.ts  coding_hvigor_build（模块级编译，BLOCKER）
//   - check-ut.ts      ut_hvigor_build（ohosTest 模块编译，BLOCKER）
//   - check-ut.ts      ut_hvigor_test（hypium 装机运行 UT，BLOCKER）
//
// 设计要点：
//  - 使用 `child_process.spawnSync`，避免 PowerShell 拼接注入问题；
//  - v2.3 起查找顺序：
//      ① framework.config.json > toolchain.devEcoStudio.hvigorBin（显式路径）
//      ② framework.config.json > toolchain.devEcoStudio.installPath → 推导
//        {installPath}/tools/hvigor/bin/hvigorw{.bat}
//      ③ 项目根 hvigorw.bat / hvigorw（向后兼容 Gradle-wrapper 风格工程）
//      ④ 系统 PATH（全局安装的 hvigor / hvigorw）
//      ⑤ 全部未命中 → toolMissing=true，由调用点翻译为 BLOCKER FAIL；
//    现代 DevEco Studio 已不再生成项目本地 wrapper，③④ 基本靠不上，
//    实际落地必走 ①② 路径，必须在 framework.config.json 中声明 DevEco 安装路径。
//  - 日志按 feature/phase 落盘到 reports 目录（便于后续追溯）；
//  - **默认启用**真实编译/运行；环境变量 HARNESS_SKIP_HVIGOR[_TEST]=1 为
//    "逃生阀"，在调用点被转译为 FAIL（不是 SKIP），详见 check-coding.ts /
//    check-ut.ts 里的规则实现。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync, SpawnSyncReturns } from 'child_process';
import {
  resolveHvigorBinFromConfig,
  loadDevEcoConfig,
  loadFrameworkConfig,
  deriveSdkHomeFromInstallPath,
  deriveJbrHomeFromInstallPath,
  HvigorOptionsConfig,
} from '../../config';

export interface HvigorRunResult {
  /** 是否真正执行了 hvigor（false：工具链缺失 / 被 env 跳过） */
  executed: boolean;
  /** 工具是否不可用（wrapper / PATH 均未找到） */
  toolMissing?: boolean;
  /** 被用户环境变量显式跳过 */
  skippedByEnv?: boolean;
  /** 退出码（仅当 executed=true） */
  exitCode?: number;
  /** 执行耗时 ms */
  durationMs: number;
  /** 日志输出（stdout + stderr 合并，截断至 MAX_LOG_CHARS） */
  logExcerpt: string;
  /** 落盘的完整日志路径（相对项目根） */
  logPath?: string;
  /** 解析出的错误条目 */
  errors: HvigorError[];
  /** 运行时诊断提示；不参与 PASS/FAIL 判定，只帮助定位慢编译 / 增量缓存问题 */
  diagnostics?: string[];
  /** hypium test 解析结果（仅 runHvigorTest 填充） */
  testResult?: HypiumTestResult;
  /** 执行命令的完整 argv，便于复现 */
  command?: string;
}

export interface HvigorError {
  file?: string;
  line?: number;
  code?: string;
  message: string;
}

export interface HypiumTestResult {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  failures: Array<{ suite: string; test: string; message: string }>;
}

export interface ProjectDependencyIssue {
  found: boolean;
  dependencies: string[];
  indicators: string[];
  harnessNodeModulesReady: boolean;
  ohModulesExists: boolean;
  ohPackageFiles: string[];
  missingDeclarations: string[];
  installHints: string[];
}

const MAX_LOG_CHARS = 200_000;

interface ResolvedHvigorOptions {
  daemon: boolean;
  parallel: boolean;
  incremental: boolean;
  analyze: 'off' | 'normal' | 'advanced';
}

const DEFAULT_HVIGOR_OPTIONS: ResolvedHvigorOptions = {
  daemon: true,
  parallel: true,
  incremental: true,
  analyze: 'advanced',
};

const PROJECT_DEPENDENCY_PATTERNS = [
  /Failed to resolve OhmUrl/i,
  /Cannot find module/i,
  /Could not resolve/i,
  /Cannot resolve/i,
  /Unable to resolve/i,
  /Module not found/i,
  /oh_modules/i,
  /ohpm/i,
];

export function analyzeProjectDependencyIssue(
  projectRoot: string,
  input: Pick<HvigorRunResult, 'logExcerpt' | 'errors'> | string,
): ProjectDependencyIssue {
  const log = typeof input === 'string'
    ? input
    : `${input.logExcerpt}\n${input.errors.map(e => `${e.file ?? ''} ${e.message}`).join('\n')}`;
  const indicators = PROJECT_DEPENDENCY_PATTERNS
    .filter(re => re.test(log))
    .map(re => re.source.replace(/\\/g, ''));
  const dependencies = extractDependencyNames(log);
  const ohPackageFiles = collectOhPackageFiles(projectRoot);
  const declared = new Set<string>();
  for (const file of ohPackageFiles) {
    const content = safeReadText(file);
    for (const dep of dependencies) {
      if (content.includes(dep)) declared.add(dep);
    }
  }
  const missingDeclarations = dependencies.filter(dep => !declared.has(dep));
  const harnessNodeModulesReady = fs.existsSync(path.join(projectRoot, 'framework', 'harness', 'node_modules', 'ts-node', 'package.json'));
  const ohModulesExists = fs.existsSync(path.join(projectRoot, 'oh_modules'));
  const installHints: string[] = [];
  if (!harnessNodeModulesReady) {
    installHints.push('framework/harness/node_modules 缺失：可在 framework/harness 执行 npm install 后重跑。');
  }
  if (!ohModulesExists || dependencies.length > 0) {
    installHints.push('Harmony 工程依赖可能未安装或未解析：可在工程根执行 ohpm install 后重跑。');
  }
  if (missingDeclarations.length > 0) {
    installHints.push(`以下依赖未在已扫描 oh-package.json5 中声明：${missingDeclarations.join(', ')}；请先确认依赖声明或内网 registry。`);
  }

  return {
    found: indicators.length > 0 || dependencies.length > 0,
    dependencies,
    indicators,
    harnessNodeModulesReady,
    ohModulesExists,
    ohPackageFiles: ohPackageFiles.map(f => path.relative(projectRoot, f).replace(/\\/g, '/')),
    missingDeclarations,
    installHints,
  };
}

function extractDependencyNames(log: string): string[] {
  const deps = new Set<string>();
  const scopedRe = /@[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._\-\/]+)?/g;
  for (const match of log.matchAll(scopedRe)) {
    const raw = match[0].replace(/\\/g, '/');
    const parts = raw.split('/');
    if (parts.length >= 2) deps.add(`${parts[0]}/${parts[1]}`);
  }
  return Array.from(deps).sort();
}

function collectOhPackageFiles(projectRoot: string): string[] {
  const out: string[] = [];
  const skip = new Set(['.git', 'node_modules', 'oh_modules', 'build', 'dist', '.preview']);
  const walk = (dir: string, depth: number) => {
    if (depth > 5) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (skip.has(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isFile() && entry.name === 'oh-package.json5') {
        out.push(abs);
      } else if (entry.isDirectory()) {
        walk(abs, depth + 1);
      }
    }
  };
  walk(projectRoot, 0);
  return out.sort();
}

function safeReadText(file: string): string {
  try {
    return fs.readFileSync(file, 'utf-8');
  } catch {
    return '';
  }
}

/**
 * 按 v2.3 查找顺序解析 hvigor 可执行命令：
 *   ① framework.config.json > toolchain.devEcoStudio.hvigorBin（显式）
 *   ② framework.config.json > toolchain.devEcoStudio.installPath → 推导
 *   ③ 项目根 hvigorw.bat / hvigorw（老工程兼容）
 *   ④ 系统 PATH
 * 返回 `source` 便于诊断信息里告诉用户命中的是哪条路径。
 */
function resolveHvigorCommand(
  projectRoot: string,
): { cmd: string; useShell: boolean; source: 'config_hvigorBin' | 'config_installPath' | 'project_wrapper' | 'path' } | null {
  const isWin = process.platform === 'win32';

  // ① / ②：从 framework.config.json 解析
  const configBin = safeResolveFromConfig(projectRoot);
  if (configBin) {
    if (fs.existsSync(configBin.path)) {
      return { cmd: configBin.path, useShell: isWin, source: configBin.source };
    }
    // 声明了但路径不存在——不静默回退，返回 null 让调用方把错误消息指回 config
    // （若路径存在才继续；否则停在这里，保持"配置优先、且不骗人"）
    // 注：为了不破坏老工程（仅设置了 installPath 但路径错了）的回退能力，这里
    // 仍然允许继续往下走 ③④，但 toolMissing 的消息会提示配置问题。
  }

  // ③：项目根 wrapper
  const wrapperNames = isWin ? ['hvigorw.bat', 'hvigorw'] : ['hvigorw', 'hvigorw.bat'];
  for (const name of wrapperNames) {
    const abs = path.join(projectRoot, name);
    if (fs.existsSync(abs)) {
      return { cmd: abs, useShell: isWin, source: 'project_wrapper' };
    }
  }

  // ④ PATH 兜底：允许全局 hvigor CLI（DevEco / ohpm 安装）
  const globalCandidates = isWin
    ? ['hvigorw.bat', 'hvigor.bat', 'hvigorw', 'hvigor']
    : ['hvigorw', 'hvigor'];
  for (const name of globalCandidates) {
    const probe = spawnSync(isWin ? 'where' : 'which', [name], {
      encoding: 'utf-8',
      shell: false,
    });
    if (probe.status === 0 && probe.stdout && probe.stdout.trim()) {
      return { cmd: name, useShell: isWin, source: 'path' };
    }
  }

  return null;
}

/**
 * 构造传给 hvigor 子进程的 env：
 *   - 继承当前进程 env；
 *   - 若用户未显式设置 DEVECO_SDK_HOME，尝试从 installPath 派生补上。
 *
 * HarmonyOS hvigor 命令行跑时，若没有 DEVECO_SDK_HOME 会直接报
 * `Invalid value of 'DEVECO_SDK_HOME' in the system environment path`。
 * IDE 内部跑时 DevEco 会注入，但 harness 命令行跑不会。
 */
function buildChildEnv(projectRoot: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  let installPath: string | undefined;
  try {
    installPath = loadDevEcoConfig(projectRoot)?.installPath;
  } catch {
    // 读取 config 失败时保持 env 不变；hvigor 会自己报错，诊断消息已在
    // buildToolMissingMessage 中给出。
    return env;
  }

  if (!env.DEVECO_SDK_HOME) {
    const sdkHome = deriveSdkHomeFromInstallPath(installPath);
    if (sdkHome && fs.existsSync(sdkHome)) env.DEVECO_SDK_HOME = sdkHome;
  }

  // DevEco 自带 JBR；签名阶段 hap-sign-tool.jar 依赖 `java` 可执行。
  // 若用户 PATH 中没有 java，这里从 installPath 推导 JBR 并注入：
  //   - 未设 JAVA_HOME 则填上；
  //   - 把 <jbrHome>/bin 前插到 PATH，保证 `spawn java` 能命中。
  // 已有 JAVA_HOME / PATH 的用户不会被覆盖，最大兼容。
  const jbrHome = deriveJbrHomeFromInstallPath(installPath);
  if (jbrHome) {
    const javaExe = process.platform === 'win32'
      ? path.join(jbrHome, 'bin', 'java.exe')
      : path.join(jbrHome, 'bin', 'java');
    if (fs.existsSync(javaExe)) {
      if (!env.JAVA_HOME) env.JAVA_HOME = jbrHome;
      const jbrBin = path.join(jbrHome, 'bin');
      const pathKey = process.platform === 'win32' ? 'Path' : 'PATH';
      const cur = env[pathKey] ?? env.PATH ?? '';
      const sep = process.platform === 'win32' ? ';' : ':';
      if (!cur.split(sep).some(p => path.resolve(p) === path.resolve(jbrBin))) {
        env[pathKey] = cur ? `${jbrBin}${sep}${cur}` : jbrBin;
      }
    }
  }

  return env;
}

/**
 * 构造 toolMissing 诊断消息：区分"从未配置"与"配置了但路径不对"两种情况，
 * 明确指向 framework.config.json 的字段，帮助用户一次性修对。
 */
function buildToolMissingMessage(projectRoot: string): string {
  const header = '未找到 hvigor 可执行文件。';
  const cfgPath = 'framework.config.json > toolchain.devEcoStudio';
  let configStatus: string;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { loadDevEcoConfig } = require('../../config') as typeof import('../../config');
    const cfg = loadDevEcoConfig(projectRoot);
    if (!cfg) {
      configStatus =
        `[未配置] 请在 ${cfgPath} 声明 installPath（DevEco Studio 安装路径），示例：\n` +
        '  "toolchain": { "devEcoStudio": { "installPath": "D:/Program Files/Huawei/DevEco Studio" } }';
    } else if (cfg.hvigorBin) {
      configStatus =
        `[已配置但文件不存在] ${cfgPath}.hvigorBin = "${cfg.hvigorBin}"\n` +
        '  请确认该路径指向真实存在的 hvigorw 可执行文件。';
    } else if (cfg.installPath) {
      configStatus =
        `[已配置但推导路径不存在] ${cfgPath}.installPath = "${cfg.installPath}"\n` +
        `  期望存在：${cfg.installPath}/tools/hvigor/bin/hvigorw${process.platform === 'win32' ? '.bat' : ''}\n` +
        '  请确认 DevEco Studio 已正确安装，或改用 hvigorBin 字段显式指定 wrapper 路径。';
    } else {
      configStatus = `[配置异常] ${cfgPath} 既未设置 installPath 也未设置 hvigorBin。`;
    }
  } catch (err) {
    configStatus = `[读取配置失败] ${(err as Error).message}`;
  }
  const detector =
    '自动探测：npx ts-node framework/harness/scripts/utils/detect-deveco.ts';
  return `${header}\n${configStatus}\n${detector}`;
}

/**
 * 从 framework.config.json 解析 hvigor 可执行路径。出错时返回 null，
 * 不抛异常——加载 config 的错误不应阻断 hvigor-runner 的回退链。
 */
function safeResolveFromConfig(
  projectRoot: string,
): { path: string; source: 'config_hvigorBin' | 'config_installPath' } | null {
  try {
    const bin = resolveHvigorBinFromConfig(projectRoot);
    if (!bin) return null;
    // 区分来源：若 config 里直接写了 hvigorBin 则是 config_hvigorBin，否则是 installPath 推导
    // 重新读一次配置看是走了哪条
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { loadDevEcoConfig } = require('../../config') as typeof import('../../config');
    const cfg = loadDevEcoConfig(projectRoot);
    const source: 'config_hvigorBin' | 'config_installPath' = cfg?.hvigorBin
      ? 'config_hvigorBin'
      : 'config_installPath';
    return { path: bin, source };
  } catch {
    return null;
  }
}

function ensureReportDir(harnessRoot: string, feature: string, phase: string): string {
  const dir = path.join(harnessRoot, 'reports', feature, phase);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function truncateLog(text: string): string {
  if (text.length <= MAX_LOG_CHARS) return text;
  const head = text.slice(0, MAX_LOG_CHARS / 2);
  const tail = text.slice(text.length - MAX_LOG_CHARS / 2);
  return `${head}\n\n... [日志过长，已截断中段] ...\n\n${tail}`;
}

function resolveHvigorOptions(projectRoot: string): ResolvedHvigorOptions {
  let fromConfig: HvigorOptionsConfig | undefined;
  try {
    fromConfig = loadFrameworkConfig(projectRoot).toolchain?.hvigor;
  } catch {
    fromConfig = undefined;
  }

  return {
    daemon: fromConfig?.daemon ?? DEFAULT_HVIGOR_OPTIONS.daemon,
    parallel: fromConfig?.parallel ?? DEFAULT_HVIGOR_OPTIONS.parallel,
    incremental: fromConfig?.incremental ?? DEFAULT_HVIGOR_OPTIONS.incremental,
    analyze: fromConfig?.analyze ?? DEFAULT_HVIGOR_OPTIONS.analyze,
  };
}

function buildHvigorTuningArgs(projectRoot: string): string[] {
  const opts = resolveHvigorOptions(projectRoot);
  const args: string[] = [opts.daemon ? '--daemon' : '--no-daemon'];

  if (opts.parallel) args.push('--parallel');
  if (opts.incremental) args.push('--incremental');
  if (opts.analyze !== 'off') args.push(`--analyze=${opts.analyze}`);

  return args;
}

/**
 * 解析 hvigor 编译日志里的错误行。
 * 常见模式：
 *   > hvigor ERROR: ArkTS:ERROR File: xxx.ets:12:34
 *   error TS2322: ...
 *   ArkTS:ERROR xxx.ets(12, 34): Some message
 */
function parseBuildErrors(log: string): HvigorError[] {
  const errors: HvigorError[] = [];
  const lines = log.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // TypeScript style: `file.ts(12,34): error TS1234: message`
    const mTsc = line.match(/^(.+?)\((\d+),\s*(\d+)\):\s*error\s+(TS\d+):\s*(.+)$/);
    if (mTsc) {
      errors.push({
        file: mTsc[1],
        line: Number(mTsc[2]),
        code: mTsc[4],
        message: mTsc[5].trim(),
      });
      continue;
    }

    // hvigor style: `> hvigor ERROR: ArkTS:ERROR File: xxx.ets:12:34`
    if (/> hvigor ERROR/.test(line) || /ArkTS:ERROR/.test(line)) {
      // 合并后续 2 行作为消息上下文，便于诊断
      const msg = [line, lines[i + 1], lines[i + 2]]
        .filter(Boolean)
        .join(' | ')
        .trim();
      const mLoc = msg.match(/([^\s:]+\.ets)\s*[:(]\s*(\d+)[:,]\s*(\d+)/);
      errors.push({
        file: mLoc?.[1],
        line: mLoc ? Number(mLoc[2]) : undefined,
        message: msg,
      });
      continue;
    }

    // 通用 ERROR 行（降级抓取）
    if (/^\s*ERROR\b/i.test(line) && !/\b0 errors\b/i.test(line)) {
      errors.push({ message: line.trim() });
      continue;
    }

    if (/00308018|Failed to find the incremental input file/i.test(line)) {
      const msg = [line, lines[i + 1], lines[i + 2]]
        .filter(Boolean)
        .join(' | ')
        .trim();
      errors.push({
        code: /00308018/.test(msg) ? '00308018' : undefined,
        message: msg,
      });
    }
  }
  // 去重（完全相同的 message 合并）
  const seen = new Set<string>();
  return errors.filter(e => {
    const key = `${e.file ?? ''}|${e.line ?? ''}|${e.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildHvigorDiagnostics(log: string): string[] {
  const diagnostics: string[] = [];
  const hasIncrementalInputMissing =
    /00308018/i.test(log) || /Failed to find the incremental input file/i.test(log);

  if (hasIncrementalInputMissing) {
    const inputMatch = log.match(/Failed to find the incremental input file[:：]?\s*([^\r\n]+)/i);
    diagnostics.push(
      [
        '检测到 hvigor 增量输入缺失（00308018 / Failed to find the incremental input file）。',
        inputMatch?.[1]?.trim() ? `缺失输入：${inputMatch[1].trim()}` : '',
        '这通常不是 ArkTS 编译错误，而是签名/打包链路的增量状态引用了不存在的 unsigned 产物。',
      ].filter(Boolean).join(' '),
    );
  }

  if (hasIncrementalInputMissing && /onlineSign|SignHap|archivePackage/i.test(log)) {
    diagnostics.push(
      '日志同时出现 onlineSign/SignHap/archivePackage 线索：请优先核对自定义签名任务是否声明 inputs/outputs，以及 unsigned/signed 文件命名是否与标准 PackageHap/SignHap 产物一致。',
    );
  }

  if (/--analyze=advanced/.test(log)) {
    diagnostics.push(
      '`--analyze=advanced` 已启用；它适合诊断构建图，不建议作为日常 harness 默认参数。请回传关闭 analyze 后的 warm build 对比。',
    );
  }

  if (hasIncrementalInputMissing && /--daemon/.test(log)) {
    diagnostics.push(
      '`--daemon` 已启用；若 00308018 只在命令行 harness 复现，请补充 daemon=false 的对比日志，以排除 daemon 复用脏增量状态。',
    );
  }

  return diagnostics;
}

/** 解析 hypium test 输出 */
function parseHypiumOutput(log: string): HypiumTestResult {
  const result: HypiumTestResult = { total: 0, passed: 0, failed: 0, skipped: 0, failures: [] };
  const lines = log.split(/\r?\n/);

  let curSuite = '';
  for (const line of lines) {
    // OHOS_REPORT_RESULT 汇总行（hypium）
    //  OHOS_REPORT_RESULT: Tests run: 12, Failure: 2, Error: 0, Pass: 10
    const mSummary = line.match(/Tests run:\s*(\d+),\s*Failure:\s*(\d+),\s*Error:\s*(\d+),\s*Pass:\s*(\d+)/);
    if (mSummary) {
      result.total = Number(mSummary[1]);
      result.failed = Number(mSummary[2]) + Number(mSummary[3]);
      result.passed = Number(mSummary[4]);
      continue;
    }

    // OHOS_REPORT_STATUS: class=<suite>
    const mClass = line.match(/OHOS_REPORT_STATUS:\s*class=(.+)/);
    if (mClass) {
      curSuite = mClass[1].trim();
      continue;
    }

    // OHOS_REPORT_STATUS_CODE: -2  （hypium: -2 = failure, -3 = error, 0 = pass）
    //  搭配 OHOS_REPORT_STATUS: test=<name> 与 stack=<msg>
    const mTest = line.match(/OHOS_REPORT_STATUS:\s*test=(.+)/);
    if (mTest) {
      // 保存"最近一个 test" 便于配对 stack
      (result as unknown as Record<string, string>).__lastTest = mTest[1].trim();
      continue;
    }

    const mStack = line.match(/OHOS_REPORT_STATUS:\s*stack=(.+)/);
    if (mStack) {
      const rec = result as unknown as Record<string, string>;
      const testName = rec.__lastTest ?? '<unknown>';
      result.failures.push({ suite: curSuite, test: testName, message: mStack[1].trim() });
      continue;
    }
  }

  // 规整：__lastTest 是内部临时字段，清理掉
  delete (result as unknown as Record<string, unknown>).__lastTest;
  return result;
}

// ----------------------------------------------------------------------------
// product 探测（v2.7 起）
// ----------------------------------------------------------------------------
//
// hvigor `-p product=` 指定使用的 product 名（来自 build-profile.json5
// app.products[].name）。v2.6 之前 hvigor-runner 把这个值写死成 'default'，
// 但内网工程实际可能叫 'mirror' / 'phone' / 'tablet'，写死会让 hvigor 报
// `product not found`，无法过编译。
//
// 探测优先级（高 → 低）：
//   ① framework.config.json > toolchain.preferredProduct（用户显式覆盖渠道）
//   ② 项目根 build-profile.json5 > app.products[0].name（多 product 工程取首位）
//   ③ 兜底常量 'default'（让 hvigor 自己报 product not found，不抢报错）
//
// 容错纪律：任一阶段失败（文件不存在 / JSON5 解析失败 / 字段缺失 / 字段非字符串）
// 一律安静回退到下一档，不抛异常 —— framework harness 是个门禁脚本，product
// 探测本身不应该成为编译失败的原因。

/** 简易 JSON5 解析（容忍 // / /* 注释与尾逗号） */
function parseProductJson5(content: string): unknown {
  let s = content.replace(/^\s*\/\/.*$/gm, '');
  s = s.replace(/([^"':])\s*\/\/.*$/gm, '$1');
  s = s.replace(/\/\*[\s\S]*?\*\//g, '');
  s = s.replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(s);
}

/**
 * 探测当前工程应当传给 hvigor `-p product=` 的 product 名。
 *
 * 不抛异常；任何阶段失败都安静兜底到 `'default'`。
 *
 * 单测覆盖：framework/harness/tests/unit/detect-product.test.ts。
 */
export function detectProduct(projectRoot: string): string {
  // ① framework.config.json > toolchain.preferredProduct
  try {
    const cfg = loadFrameworkConfig(projectRoot);
    const pref = cfg.toolchain?.preferredProduct;
    if (typeof pref === 'string' && pref.trim().length > 0) {
      return pref.trim();
    }
  } catch {
    // 加载 framework.config.json 失败 → 继续兜底
  }

  // ② build-profile.json5 > app.products[0].name
  try {
    const buildProfile = path.join(projectRoot, 'build-profile.json5');
    if (fs.existsSync(buildProfile)) {
      const raw = fs.readFileSync(buildProfile, 'utf-8');
      const obj = parseProductJson5(raw) as {
        app?: { products?: Array<{ name?: string }> };
      };
      const first = obj?.app?.products?.[0]?.name;
      if (typeof first === 'string' && first.trim().length > 0) {
        return first.trim();
      }
    }
  } catch {
    // build-profile.json5 不可解析 → 继续兜底
  }

  // ③ fallback
  return 'default';
}

export interface HvigorInvokeOpts {
  /** 项目根（hvigorw 所在目录、env / config 解析锚点） */
  projectRoot: string;
  /**
   * 子进程 cwd；不传则用 projectRoot。
   * 模块级 task 必须切到模块目录下跑（hvigor `--mode module` 默认从 cwd 推断
   * 当前模块），否则即使传 qualified task name 也会报 "Task was not found"。
   */
  cwd?: string;
  /** harness 根（reports 落盘） */
  harnessRoot: string;
  /** feature 名（reports 子目录） */
  feature: string;
  /** phase（reports 子目录） */
  phase: string;
  /** 日志文件名（相对 reports/<feature>/<phase>/），如 'hvigor-build.log' */
  logBasename: string;
  /** hvigor 子命令 + 参数，如 ['--mode', 'module', '-p', 'module=WalletMain@default', 'assembleHap'] */
  args: string[];
  /** 被此环境变量跳过时，返回 skippedByEnv=true（调用方应翻译为 FAIL） */
  skipEnvVar?: string;
  /** 超时（ms），默认 15 min */
  timeoutMs?: number;
}

function invokeHvigor(opts: HvigorInvokeOpts): HvigorRunResult {
  const t0 = Date.now();

  if (opts.skipEnvVar && process.env[opts.skipEnvVar]) {
    return {
      executed: false,
      skippedByEnv: true,
      durationMs: 0,
      logExcerpt: `[skipped] env ${opts.skipEnvVar}=${process.env[opts.skipEnvVar]}`,
      errors: [],
    };
  }

  const resolved = resolveHvigorCommand(opts.projectRoot);
  if (!resolved) {
    return {
      executed: false,
      toolMissing: true,
      durationMs: Date.now() - t0,
      logExcerpt: buildToolMissingMessage(opts.projectRoot),
      errors: [],
    };
  }

  // Windows 下 .bat 必须用 shell: true，但 DevEco 默认装在 "D:\Program Files\..."
  // 这种含空格的绝对路径上；若直接把 cmd + args 分开交给 spawnSync，Node 会
  // 拼成 `D:\Program Files\... --mode ...` 让 cmd.exe 解析，空格会被当作分隔
  // 符（出现 "'D:\Program' 不是内部或外部命令" 报错）。
  // 稳妥做法：自己把命令行拼好、按需加引号，交给 shell 当作整串命令执行。
  const needsShell = resolved.useShell;
  const quoteIfNeeded = (s: string): string => (/\s/.test(s) ? `"${s}"` : s);
  const cmdLine = needsShell
    ? [resolved.cmd, ...opts.args].map(quoteIfNeeded).join(' ')
    : undefined;

  // 注入 DEVECO_SDK_HOME：DevEco 内嵌 hvigor 在命令行模式下必须能找到 SDK，
  // 否则会报 `00303217 Invalid value of 'DEVECO_SDK_HOME'`。
  // 用户已显式导出的 DEVECO_SDK_HOME 优先，其次从 installPath 派生。
  const childEnv = buildChildEnv(opts.projectRoot);

  const childCwd = opts.cwd ?? opts.projectRoot;

  let spawnRet: SpawnSyncReturns<string>;
  try {
    spawnRet = needsShell
      ? spawnSync(cmdLine!, [], {
          cwd: childCwd,
          encoding: 'utf-8',
          shell: true,
          timeout: opts.timeoutMs ?? 15 * 60 * 1000,
          maxBuffer: 64 * 1024 * 1024,
          env: childEnv,
        })
      : spawnSync(resolved.cmd, opts.args, {
          cwd: childCwd,
          encoding: 'utf-8',
          shell: false,
          timeout: opts.timeoutMs ?? 15 * 60 * 1000,
          maxBuffer: 64 * 1024 * 1024,
          env: childEnv,
        });
  } catch (err) {
    const e = err as Error;
    return {
      executed: false,
      durationMs: Date.now() - t0,
      logExcerpt: `[spawnSync error] ${e.message}`,
      errors: [{ message: `hvigor 启动失败：${e.message}` }],
    };
  }

  const stdout = spawnRet.stdout ?? '';
  const stderr = spawnRet.stderr ?? '';
  const commandDisplay = cmdLine ?? `${resolved.cmd} ${opts.args.join(' ')}`;
  const fullLog = truncateLog(`$ ${commandDisplay}\n\n${stdout}\n${stderr}`);

  const dir = ensureReportDir(opts.harnessRoot, opts.feature, opts.phase);
  const logAbs = path.join(dir, opts.logBasename);
  try {
    fs.writeFileSync(logAbs, fullLog, 'utf-8');
  } catch {
    // best-effort；日志落盘失败不应阻断检查
  }
  const logPath = path.relative(process.cwd(), logAbs).replace(/\\/g, '/');

  const errors = parseBuildErrors(fullLog);
  const diagnostics = buildHvigorDiagnostics(fullLog);

  return {
    executed: true,
    exitCode: spawnRet.status ?? -1,
    durationMs: Date.now() - t0,
    logExcerpt: fullLog.slice(-8000), // 尾部 8KB 放到 result 方便报告展示
    logPath,
    errors,
    diagnostics,
    command: commandDisplay,
  };
}

/**
 * 模块级编译。
 *
 * 用于 ut_hvigor_build（跑 OhosTestCompileArkTS）。
 * 也可被 coding_hvigor_build 在"想对特定模块做精细编译"时调用，但默认情况
 * 下 coding 阶段更推荐 `runHvigorAssembleApp`——项目级 assembleApp 能一次
 * 覆盖所有模块（含 HAR/HSP，避免对非 entry 模块跑不存在的 assembleHap）。
 *
 * 注意：**HAR / HSP 模块没有 assembleHap task**。如果把 `task` 设为
 * `assembleHap` 同时模块是 library，会报 "Task was not found"；此时应把
 * `task` 改为 `OhosTestCompileArkTS`（ut 目标）或 `assembleHar`（library 出包）。
 */
export function runHvigorBuild(
  opts: Omit<HvigorInvokeOpts, 'args' | 'logBasename'> & {
    /** 目标模块名（对应 build-profile.json5 > modules[].name） */
    moduleName: string;
    /** 对应 build 目标；ohosTest 模块用 'ohosTest' */
    target?: 'default' | 'ohosTest';
    /**
     * 要执行的 hvigor task 名（unqualified hook task）。
     * - 默认：default 目标 → 'assembleHap'；ohosTest 目标 → 'genOnDeviceTestHap'。
     *   两者都是 hvigor 命令行直接接受的 hook task：
     *     · `assembleHap` 触发模块 default target 的完整编译 + 签名；
     *     · `genOnDeviceTestHap` 触发 ohosTest target 的 ArkTS 编译 + 装机包生成
     *       （等价于 DevEco "Run ohosTest" 出包的那一步）。
     *   **不要**传 `OhosTestCompileArkTS` / `UnitTestArkTS` 这类 internal task —
     *   它们只在 hook 内部展开，CLI 直接调用会报 "Task was not found"。
     * - 调用方可显式覆盖（比如 HAR 模块想跑 'assembleHar'）。
     */
    task?: string;
  },
): HvigorRunResult {
  const target = opts.target ?? 'default';
  const task = opts.task ?? (target === 'ohosTest' ? 'genOnDeviceTestHap' : 'assembleHap');
  const args = buildModuleHapArgs(opts.projectRoot, opts.moduleName, target, task);
  return invokeHvigor({
    ...opts,
    args,
    logBasename: target === 'ohosTest' ? 'hvigor-ut-build.log' : 'hvigor-build.log',
  });
}

/**
 * 项目级编译：跑顶级 `assembleApp` task（打 App 包），一次覆盖所有模块。
 *
 * 用于 coding_hvigor_build：比起遍历每个模块跑 assembleHap 更稳健，因为：
 *   - Library 模块（HAR/HSP）没有 assembleHap；
 *   - DevEco Studio "Build HAP" 顶级 action 走的就是 assembleApp。
 *
 * 代价：比单模块编译耗时长；但只在规则触发时跑一次（通常走增量缓存）。
 */
export function runHvigorAssembleApp(
  opts: Omit<HvigorInvokeOpts, 'args' | 'logBasename'> & {
    /** 默认 'assembleApp'；允许覆盖为 'build' / 'assembleHap' 等 */
    task?: string;
    /** 附加参数，如 '--daemon' / '-p buildMode=release' */
    extraArgs?: string[];
  },
): HvigorRunResult {
  const task = opts.task ?? 'assembleApp';
  const args = buildAssembleAppArgs(opts.projectRoot, task, opts.extraArgs);
  return invokeHvigor({
    ...opts,
    args,
    logBasename: 'hvigor-build.log',
  });
}

// ----------------------------------------------------------------------------
// args 装配（单测覆盖：tests/unit/hvigor-args.unit.test.ts）
// ----------------------------------------------------------------------------
//
// 把 args 装配从 runHvigorBuild / runHvigorAssembleApp 抽出来，独立函数有两个
// 好处：
//   1. 单测可以直接断言"加了哪些 flag、product 是不是探测来的"，而不必 mock
//      整个 spawnSync；
//   2. 编辑参数时一处生效，coding / ut / 未来其它 phase 不会漂。

/**
 * 装配项目级 assembleApp 的 hvigor args（coding 阶段用）。
 *
 * v2.7 加速纪律：
 *   - product 由 detectProduct() 自动探测；
 *   - 强制 `-p buildMode=debug`：assembleApp 默认 release，coding 门禁只验通过
 *     性，debug 可砍 30%~50% 编译时间；用户需要 release 校验可通过 `extraArgs`
 *     传 `-p buildMode=release` 覆盖（hvigor 后传同名 -p 以最后一次为准，因此
 *     extraArgs 必须放在 task 之前的末端位置）；
 *   - `--parallel` / `--incremental`：开 hvigor 并发 + 缓存。
 */
export function buildAssembleAppArgs(
  projectRoot: string,
  task: string = 'assembleApp',
  extraArgs?: string[],
): string[] {
  return [
    '--mode', 'project',
    '-p', `product=${detectProduct(projectRoot)}`,
    '-p', 'buildMode=debug',
    ...buildHvigorTuningArgs(projectRoot),
    ...(extraArgs ?? []),
    task,
  ];
}

/**
 * 装配模块级 assembleHap / genOnDeviceTestHap 的 hvigor args（ut 阶段用）。
 *
 * 不传 `--mode`（实测 `--mode module` + 模块 cwd 会让 hvigor 去模块目录找
 * hvigor-config.json5，反而失败；`--mode project` 又只暴露顶层 hook task）。
 *
 * **不**加 `-p buildMode=debug`：assembleHap / genOnDeviceTestHap 默认就是
 * debug，加了只是噪音。
 */
export function buildModuleHapArgs(
  projectRoot: string,
  moduleName: string,
  target: 'default' | 'ohosTest',
  task: string,
): string[] {
  return [
    '-p', `module=${moduleName}@${target}`,
    '-p', `product=${detectProduct(projectRoot)}`,
    ...buildHvigorTuningArgs(projectRoot),
    task,
  ];
}

/**
 * v2.3 P2：真机执行 UT 的完整链路。
 *
 * v2.2 旧路：直接跑 `hvigor test` —— 这条 task 走 unit test 路径，强制要求模块下
 * 存在 TestAbility.ets。HAR / HSP 库模块（典型如 feature-level WalletMain）没有
 * TestAbility，hvigor 立刻挂在 UnitTestArkTS。
 *
 * v2.3 新路（与 DevEco Studio "Run ohosTest" 等效）：
 *   ① genOnDeviceTestHap：编译 ohosTest 代码 + 打 ohosTest HAP + 签名
 *   ② hdc install -r <hap>：装机
 *   ③ hdc shell aa test -b <bundle> -m <module> -s unittest <runner> -w <ms>
 *   ④ 解析 OHOS_REPORT_RESULT 行得到 hypium 统计
 *
 * 任何阶段失败都会被翻译成 HvigorRunResult，并把上下文（命令、日志路径、设备列表、
 * 失败阶段标记）回填，便于上层 check-ut.ts 给用户精准诊断。
 */
export function runHvigorTest(
  opts: Omit<HvigorInvokeOpts, 'args' | 'logBasename'> & {
    moduleName: string;
    /** 模块源码相对路径（相对 projectRoot），如 '02-Feature/WalletMain' */
    moduleSrcPath: string;
  },
): HvigorRunResult {
  const t0 = Date.now();

  // ① 出包：genOnDeviceTestHap（与 ut_hvigor_build 共享 task；hvigor 命中 cache 时只需毫秒）。
  //    ohosTest 模块的 task 入口必须用 hook task，不能用 `test`（要 TestAbility）也不能
  //    用 OhosTestCompileArkTS（CLI 拒收的内部 task）。
  const buildRes = runHvigorBuild({
    ...opts,
    moduleName: opts.moduleName,
    target: 'ohosTest',
    task: 'genOnDeviceTestHap',
  });
  if (!buildRes.executed || (buildRes.exitCode !== undefined && buildRes.exitCode !== 0)) {
    // build 失败/被跳过：直接把 build 结果原样返回，让 check-ut 沿用 ut_hvigor_build 的失败语义。
    return buildRes;
  }

  // ② / ③ / ④：装机 + 执行 + 解析（封装在 hdc-runner，避免本文件臃肿）
  // 这里通过 require 动态导入，避免 hvigor-runner ↔ hdc-runner 之间形成 import 环。
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { runOnDeviceUt } = require('./hdc-runner') as typeof import('./hdc-runner');
  const onDevice = runOnDeviceUt({
    projectRoot: opts.projectRoot,
    harnessRoot: opts.harnessRoot,
    feature: opts.feature,
    phase: opts.phase,
    srcModuleName: opts.moduleName,
    srcPath: opts.moduleSrcPath,
    skipEnvVar: opts.skipEnvVar, // 允许跟 build 用同一个 env 变量整体跳过
  });

  // 把 onDevice 结果折叠进 HvigorRunResult，让上层报告看见完整链路日志。
  const combinedLog =
    `[stage 1: build]\n${buildRes.logExcerpt}\n\n` +
    `[stage 2: on-device]\n${onDevice.logExcerpt}`;
  const res: HvigorRunResult = {
    executed: onDevice.executed,
    toolMissing: onDevice.toolMissing,
    skippedByEnv: onDevice.skippedByEnv,
    exitCode: onDevice.aaTest?.exitCode ?? (onDevice.executed ? 1 : -1),
    durationMs: Date.now() - t0,
    logExcerpt: truncateLog(combinedLog).slice(-8000),
    logPath: onDevice.logPath ?? buildRes.logPath,
    errors: onDevice.errors.length ? onDevice.errors : (buildRes.errors ?? []),
    testResult: onDevice.report,
    command: 'genOnDeviceTestHap + hdc install -r + hdc shell aa test',
  };
  // 用 onDevice.failedAt 标注失败阶段：当 install 失败时仍属于真实执行链路异常，
  // 让 check-ut 把它当 BLOCKER FAIL 报；on_pass=有用例 fail 也是 FAIL。
  // 成功路径下 onDevice.report?.failed === 0 + executed=true，res.exitCode=0。
  if (onDevice.failedAt && !res.errors.length) {
    res.errors = [{ message: `失败阶段：${onDevice.failedAt}` }];
  }
  if (onDevice.report && onDevice.report.failed === 0 && onDevice.executed) {
    res.exitCode = 0;
  }
  return res;
}

/**
 * 探测是否存在可用设备 / 模拟器（hdc list targets）。
 * 用于 ut_hvigor_test：无设备时不跑 test，直接 BLOCKER FAIL。
 */
export function probeDevices(): {
  available: boolean;
  hdcPresent: boolean;
  targets: string[];
  raw: string;
} {
  const isWin = process.platform === 'win32';
  const probe = spawnSync('hdc', ['list', 'targets'], {
    encoding: 'utf-8',
    shell: isWin,
    timeout: 5000,
  });

  if (probe.error || probe.status !== 0) {
    return { available: false, hdcPresent: false, targets: [], raw: probe.stderr ?? probe.error?.message ?? '' };
  }

  const raw = (probe.stdout ?? '').trim();
  // 典型无设备输出："[Empty]" 或空字符串
  if (!raw || /^\[?Empty\]?$/i.test(raw)) {
    return { available: false, hdcPresent: true, targets: [], raw };
  }
  const targets = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  return { available: targets.length > 0, hdcPresent: true, targets, raw };
}
