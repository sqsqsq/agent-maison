// ============================================================================
// hvigor-runner.ts
// ============================================================================
// 封装对 HarmonyOS 构建工具 hvigor 的调用，供：
//   - check-coding.ts  coding_hvigor_build（模块级编译，BLOCKER）
//   - check-ut.ts      ut_hvigor_build（ohosTest 模块编译，BLOCKER）
//   - check-ut.ts      ut_hvigor_test（hypium 装机运行 UT，BLOCKER）
//
// 设计要点：
//  - 使用 `child_process.spawnSync`；coding/ut 构建 stdout+stderr **直写日志 fd**，
//    避免 maxBuffer / 内存复制；超时由 spawnSync.timeout 杀死子进程。
//  - v2.3 起查找顺序：
//      ① framework.local.json > toolchain.devEcoStudio.hvigorBin（显式路径）
//      ② framework.local.json > toolchain.devEcoStudio.installPath → 推导
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
  HvigorCodingConfig,
  featurePhaseReportsDir,
} from '../../../harness/config';
import { diagnoseInstallBlocking, writeUtInstallDiagJson } from './device-install-diag';
// type-only：编译期擦除，不构成 hvigor-runner ↔ hdc-runner 运行期 import 环
// （运行期互调仍走函数内 require，见 runHvigorTest）。
import type { OhosTestSignDiagnosis } from './hdc-runner';
import { inferRepoLayout, harnessRootFromLayout } from '../../../harness/repo-layout';

export interface HvigorRunResult {
  /** 是否真正执行了 hvigor（false：工具链缺失 / 被 env 跳过） */
  executed: boolean;
  /** 工具是否不可用（wrapper / PATH 均未找到） */
  toolMissing?: boolean;
  /** 被用户环境变量显式跳过 */
  skippedByEnv?: boolean;
  /** 退出码（仅当 executed=true） */
  exitCode?: number;
  /** spawnSync 超时杀死（仅 executed=true） */
  timedOut?: boolean;
  /** 日志尾部是否命中成功哨兵（仅 requireSuccessMarker 时检查；UT 路径恒 true） */
  successMarkerFound?: boolean;
  /** 执行耗时 ms */
  durationMs: number;
  /** 报告用日志尾部摘要（约 8KB），非完整日志 */
  logExcerpt: string;
  /** 落盘的完整日志路径（相对 process.cwd()） */
  logPath?: string;
  /** hvigor-build.meta.json 等（相对 process.cwd()） */
  metaPath?: string;
  /** 日志绝对路径（供上层读取全量，不依赖 cwd） */
  logAbsPath?: string;
  /** 解析出的错误条目 */
  errors: HvigorError[];
  /** 运行时诊断提示；不参与 PASS/FAIL 判定，只帮助定位慢编译 / 增量缓存问题 */
  diagnostics?: string[];
  /** hypium test 解析结果（仅 runHvigorTest 填充） */
  testResult?: HypiumTestResult;
  /** 装机预检阻塞诊断（runHvigorTest 在 install_preflight 短路时填充） */
  installBlocking?: import('./device-install-diag').InstallBlockingDiagnosis;
  /** 执行命令的完整 argv，便于复现 */
  command?: string;
  /** 调用驱动：node_hvigorw_js / hvigorw_wrapper / path / … */
  invocationDriver?: string;
  /** 日志命中 `Will skip sign`（plan d7e4b2a9 t3：签名被跳过，产物仅 unsigned） */
  signSkipped?: boolean;
  /** 日志命中 `No signingConfigs profile is configured`（signSkipped 的已知原因之一） */
  signingConfigMissing?: boolean;
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

/** coding 阶段未配置 toolchain.hvigor.timeoutMs 时的默认超时 */
export const DEFAULT_HVIGOR_TIMEOUT_CODING_MS = 45 * 60 * 1000;

/** ut 相关 hvigor 未配置 timeout 时的默认超时 */
export const DEFAULT_HVIGOR_TIMEOUT_UT_MS = 15 * 60 * 1000;

const MAX_LOG_ANALYSIS_BYTES = 32 * 1024 * 1024;
const TAIL_SUCCESS_SCAN_BYTES = 256 * 1024;
const REPORT_EXCERPT_TAIL_CHARS = 8000;

const DEFAULT_SUCCESS_REGEX_SOURCES = ['BUILD SUCCESSFUL', 'Compilation successful!'];

export function resolveHvigorTimeout(projectRoot: string, kind: 'coding' | 'ut'): number {
  try {
    const t = loadFrameworkConfig(projectRoot).toolchain?.hvigor?.timeoutMs;
    if (typeof t === 'number' && Number.isFinite(t) && t > 0) {
      return Math.floor(t);
    }
  } catch {
    /* ignore */
  }
  return kind === 'coding' ? DEFAULT_HVIGOR_TIMEOUT_CODING_MS : DEFAULT_HVIGOR_TIMEOUT_UT_MS;
}

function compileSuccessMarkerRegexes(sources: string[] | undefined): RegExp[] {
  const src = sources?.length ? sources : DEFAULT_SUCCESS_REGEX_SOURCES;
  return src.map((p) => {
    const t = p.trim();
    if (t.startsWith('/') && t.length > 2) {
      const last = t.lastIndexOf('/');
      if (last > 0) {
        try {
          return new RegExp(t.slice(1, last), t.slice(last + 1));
        } catch {
          /* fall through */
        }
      }
    }
    try {
      return new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    } catch {
      return /$^/;
    }
  });
}

function scanSuccessMarkers(text: string, regexes: RegExp[]): boolean {
  return regexes.some((re) => re.test(text));
}

function readLogTextForAnalysis(logAbs: string): string {
  try {
    const st = fs.statSync(logAbs);
    if (st.size <= MAX_LOG_ANALYSIS_BYTES) {
      return fs.readFileSync(logAbs, 'utf-8');
    }
    const fd = fs.openSync(logAbs, 'r');
    const take = MAX_LOG_ANALYSIS_BYTES;
    const buf = Buffer.alloc(take);
    const start = st.size - take;
    fs.readSync(fd, buf, 0, take, start);
    fs.closeSync(fd);
    return `[…日志前 ${st.size - take} 字节已省略，以下仅为尾部 ${take} 字节用于错误解析…]\n${buf.toString('utf-8')}`;
  } catch {
    return '';
  }
}

function readFileTailUtf8(file: string, maxBytes: number): string {
  try {
    const st = fs.statSync(file);
    const take = Math.min(maxBytes, st.size);
    if (take <= 0) return '';
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(take);
    fs.readSync(fd, buf, 0, take, st.size - take);
    fs.closeSync(fd);
    return buf.toString('utf-8');
  } catch {
    return '';
  }
}

function metaBasenameFromLog(logBasename: string): string {
  if (logBasename.endsWith('.log')) {
    return logBasename.replace(/\.log$/i, '.meta.json');
  }
  return `${logBasename}.meta.json`;
}

function quoteCmdArgWin(s: string): string {
  if (!/[ \t"&]/.test(s)) return s;
  return `"${s.replace(/"/g, '\\"')}"`;
}

/**
 * 解析 DevEco 安装根：环境变量优先，其次 framework.config.json。
 */
export function resolveDevEcoInstallRoot(projectRoot: string): string | null {
  const tryRoot = (raw: string | undefined): string | null => {
    if (!raw || typeof raw !== 'string') return null;
    const trimmed = raw.trim().replace(/[/\\]+$/, '');
    if (!trimmed) return null;
    const nodeName = process.platform === 'win32' ? 'node.exe' : 'node';
    const nodeExe = path.join(trimmed, 'tools', 'node', nodeName);
    return fs.existsSync(nodeExe) ? trimmed : null;
  };

  const fromEnv =
    tryRoot(process.env.DEVECO_STUDIO_HOME) ??
    tryRoot(process.env.HUAWEI_DEVECO_STUDIO_HOME);
  if (fromEnv) return fromEnv;

  try {
    const p = loadDevEcoConfig(projectRoot)?.installPath;
    return tryRoot(p);
  } catch {
    return null;
  }
}

function resolveNodeHvigorwJs(projectRoot: string): { root: string; nodeExe: string; hvigorwJs: string } | null {
  const root = resolveDevEcoInstallRoot(projectRoot);
  if (!root) return null;
  const nodeName = process.platform === 'win32' ? 'node.exe' : 'node';
  const nodeExe = path.join(root, 'tools', 'node', nodeName);
  const hvigorwJs = path.join(root, 'tools', 'hvigor', 'bin', 'hvigorw.js');
  if (!fs.existsSync(nodeExe) || !fs.existsSync(hvigorwJs)) return null;
  return { root, nodeExe, hvigorwJs };
}

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

// 真实"依赖解析失败"信号。**刻意不含** /oh_modules/ 或 /ohpm/——那两个是路径/工具名，
// 几乎每条 Harmony 构建日志都提到，会让"依赖问题"判定近乎恒真、把真实代码错也盖成依赖未声明
// （根因 B）。只保留会明确表达"某 specifier 解析不到"的信号。
const PROJECT_DEPENDENCY_PATTERNS = [
  /Failed to resolve OhmUrl/i,
  /Cannot find module/i,
  /Could not resolve/i,
  /Cannot resolve/i,
  /Unable to resolve/i,
  /Module not found/i,
];

// ohpm 物理上**无法声明**的点分 SDK / 系统命名空间（SDK 自带，不进 oh-package.json5）。
// 只收窄到点分命名空间；@hms-* / @hw-* 等连字符 vendor scope 是真·第三方 ohpm 包，绝不在此过滤
// （否则会把真实缺声明吞成漏报、并破坏现有单测）。
const SDK_RESERVED_SCOPE = /^@(?:ohos|kit|system|arkts)(?:\.|$)/i;

/** 版本目录碎片（如 @1.0.0-301/oh_modules）——非包名，来自 .ohpm 缓存路径，物理上不可声明。 */
function isVersionFragmentDep(scope: string, name: string): boolean {
  return /^@\d/.test(scope) || name === 'oh_modules';
}

/**
 * "依赖解析失败"信号的**单一判据**（根因 B 收敛点）。
 * coding / ut 两条归因链都用它作为"是否走依赖分支"的前置门，避免各自内联正则漂移。
 * 与 `analyzeProjectDependencyIssue().found` 同源（后者即 `PROJECT_DEPENDENCY_PATTERNS.some` 命中）。
 */
export function hasDependencyResolutionFailure(log: string): boolean {
  return PROJECT_DEPENDENCY_PATTERNS.some(re => re.test(log));
}

export function analyzeProjectDependencyIssue(
  projectRoot: string,
  input: Pick<HvigorRunResult, 'logExcerpt' | 'errors' | 'logAbsPath'> | string,
  frameworkRoot?: string,
): ProjectDependencyIssue {
  let log: string;
  if (typeof input === 'string') {
    log = input;
  } else {
    const fromDisk =
      input.logAbsPath && fs.existsSync(input.logAbsPath)
        ? readLogTextForAnalysis(input.logAbsPath)
        : '';
    log = [
      fromDisk,
      input.logExcerpt,
      ...input.errors.map((e) => `${e.file ?? ''} ${e.message}`),
    ]
      .filter((s) => s && String(s).trim().length > 0)
      .join('\n');
  }
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
  const harnessRoot = frameworkRoot
    ? path.join(path.resolve(frameworkRoot), 'harness')
    : harnessRootFromLayout(inferRepoLayout(projectRoot));
  const harnessNodeModulesReady = fs.existsSync(
    path.join(harnessRoot, 'node_modules', 'ts-node', 'package.json'),
  );
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
    // 只有命中真实解析失败信号才算"依赖问题"（根因 A.4）。
    // "仅提取到包名"不足以判定——那可能只是失败行里顺带出现的路径；已由 A.1 收窄，此处再兜一道。
    found: indicators.length > 0,
    dependencies,
    indicators,
    harnessNodeModulesReady,
    ohModulesExists,
    ohPackageFiles: ohPackageFiles.map(f => path.relative(projectRoot, f).replace(/\\/g, '/')),
    missingDeclarations,
    installHints,
  };
}

/**
 * 合并 UT 失败归因用的 hvigor 文本：优先读落盘全量日志，再拼 excerpt / command / errors。
 * （与 `analyzeProjectDependencyIssue` 同源思路，避免仅凭 8KB 尾部误判。）
 */
export function mergeHvigorLogForUtClassification(
  res: Pick<HvigorRunResult, 'logExcerpt' | 'errors' | 'logAbsPath' | 'command'>,
): string {
  const fromDisk =
    res.logAbsPath && fs.existsSync(res.logAbsPath)
      ? readLogTextForAnalysis(res.logAbsPath)
      : '';
  return [
    fromDisk,
    res.logExcerpt,
    res.command ?? '',
    ...((res.errors ?? []).map(e => `${e.file ?? ''} ${e.message}`)),
  ]
    .filter(s => s && String(s).trim().length > 0)
    .join('\n');
}

/**
 * 粗粒度识别「hvigor 命令形态未对齐 ohosTest / DevEco」导致的伪编译失败。
 * 命中时应优先修 harness/参数，而不是引导 `ohpm install`。
 */
export function looksLikeUtHvigorCommandMismatch(log: string): boolean {
  const utContext =
    /genOnDeviceTestHap/i.test(log) ||
    /@ohosTest/i.test(log) ||
    /ohosTest/i.test(log);
  if (!utContext) return false;

  if (/isOhosTest:\s*false/i.test(log) || /isOhosTest\s*=\s*false/i.test(log)) return true;
  if (/-p\s+isOhosTest=false/i.test(log) || /-p\s*isOhosTest=false/i.test(log)) return true;

  const firstCmdLine = log.split(/\r?\n/).find(l => l.trim().startsWith('$')) ?? '';
  if (/genOnDeviceTestHap/i.test(firstCmdLine) && !/--mode\s+module/i.test(firstCmdLine)) return true;

  const mProd = firstCmdLine.match(/-p\s+product=([^\s]+)/);
  const productArg = mProd?.[1];
  if (productArg && productArg !== 'default' && /entryTarget:\s*default/i.test(log)) return true;

  return false;
}

function extractDependencyNames(log: string): string[] {
  const deps = new Set<string>();
  const scopedRe = /@[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._\-\/]+)?/g;
  for (const line of log.split(/\r?\n/)) {
    // 根因 A.1：只从"真实解析失败行"抽 import specifier。
    // 构建进度 / 路径列举 / .ohpm 缓存路径（含 @<版本>/oh_modules 碎片）都不在失败行里 →
    // 不再被通配误抓。行过滤复用 PROJECT_DEPENDENCY_PATTERNS，天然与 indicators 一致、不漂移。
    if (!PROJECT_DEPENDENCY_PATTERNS.some(re => re.test(line))) continue;
    for (const match of line.matchAll(scopedRe)) {
      const raw = match[0].replace(/\\/g, '/');
      const parts = raw.split('/');
      if (parts.length < 2) continue;
      const scope = parts[0];
      const name = parts[1];
      if (isVersionFragmentDep(scope, name)) continue; // A.2：版本目录碎片
      if (SDK_RESERVED_SCOPE.test(scope)) continue; // A.3：点分 SDK 命名空间（不碰连字符 vendor）
      deps.add(`${scope}/${name}`);
    }
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
 *   ① framework.local.json > toolchain.devEcoStudio.hvigorBin（显式）
 *   ② framework.local.json > toolchain.devEcoStudio.installPath → 推导
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
export function buildChildEnv(projectRoot: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  let installPath: string | undefined;
  try {
    installPath = resolveDevEcoInstallRoot(projectRoot) ?? loadDevEcoConfig(projectRoot)?.installPath;
  } catch {
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
      const existingHome = env.JAVA_HOME;
      const existingJava =
        existingHome && typeof existingHome === 'string'
          ? path.join(
              existingHome,
              'bin',
              process.platform === 'win32' ? 'java.exe' : 'java',
            )
          : '';
      if (!existingHome || !fs.existsSync(existingJava)) {
        env.JAVA_HOME = jbrHome;
      }
      const jbrBin = path.join(jbrHome, 'bin');
      const pathKey = process.platform === 'win32' ? 'Path' : 'PATH';
      const cur = env[pathKey] ?? env.PATH ?? '';
      const sep = process.platform === 'win32' ? ';' : ':';
      // 始终前插 DevEco JBR，避免用户 Path 无 java 导致 PackageHap/SignHap spawn ENOENT
      const rest = cur
        .split(sep)
        .map(p => p.trim())
        .filter(p => p && path.resolve(p) !== path.resolve(jbrBin));
      const merged = [jbrBin, ...rest].join(sep);
      env[pathKey] = merged;
      if (pathKey === 'Path') env.PATH = merged;
      else env.Path = merged;
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
  const cfgPath = 'framework.local.json > toolchain.devEcoStudio';
  let configStatus: string;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { loadDevEcoConfig } = require('../../../harness/config') as typeof import('../../../harness/config');
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
    '自动探测：npx ts-node framework/harness/scripts/detect-deveco.ts';
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
    const { loadDevEcoConfig } = require('../../../harness/config') as typeof import('../../../harness/config');
    const cfg = loadDevEcoConfig(projectRoot);
    const source: 'config_hvigorBin' | 'config_installPath' = cfg?.hvigorBin
      ? 'config_hvigorBin'
      : 'config_installPath';
    return { path: bin, source };
  } catch {
    return null;
  }
}

function ensureHvigorLogReportDir(
  projectRoot: string,
  feature: string,
  phase: string,
  frameworkRoot?: string,
): string {
  const dir = featurePhaseReportsDir(projectRoot, feature, phase, frameworkRoot);
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

  const goalOrchestrated =
    process.env.MAISON_GOAL_RUNNER === '1' || process.env.MAISON_GOAL_HEADLESS === '1';

  return {
    daemon: goalOrchestrated
      ? false
      : (fromConfig?.daemon ?? DEFAULT_HVIGOR_OPTIONS.daemon),
    parallel: fromConfig?.parallel ?? DEFAULT_HVIGOR_OPTIONS.parallel,
    incremental: fromConfig?.incremental ?? DEFAULT_HVIGOR_OPTIONS.incremental,
    analyze: fromConfig?.analyze ?? DEFAULT_HVIGOR_OPTIONS.analyze,
  };
}

function buildHvigorTuningArgs(
  projectRoot: string,
  override?: Partial<ResolvedHvigorOptions>,
): string[] {
  const opts = { ...resolveHvigorOptions(projectRoot), ...override };
  const args: string[] = [opts.daemon ? '--daemon' : '--no-daemon'];

  if (opts.parallel) args.push('--parallel');
  if (opts.incremental) args.push('--incremental');
  if (opts.analyze !== 'off') args.push(`--analyze=${opts.analyze}`);

  return args;
}

/**
 * UT（ohosTest / genOnDeviceTestHap）专用调优参数：parallel / incremental / daemon 仍读全局
 * `toolchain.hvigor`；`analyze` 在**非 off** 时固定为 `normal`，以对齐 DevEco Run ohosTest。
 */
export function buildUtHvigorTuningArgs(projectRoot: string): string[] {
  const opts = resolveHvigorOptions(projectRoot);
  const analyzeLevel = opts.analyze === 'off' ? 'off' : 'normal';
  const args: string[] = [opts.daemon ? '--daemon' : '--no-daemon'];

  if (opts.parallel) args.push('--parallel');
  if (opts.incremental) args.push('--incremental');
  if (analyzeLevel !== 'off') args.push(`--analyze=${analyzeLevel}`);

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

  const javaSpawnEnoent =
    /spawn\s+java\s+ENOENT/i.test(log) ||
    (/ENOENT/i.test(log) && /spawn\s+java/i.test(log));
  if (javaSpawnEnoent) {
    diagnostics.push(
      [
        '检测到 PackageHap/SignHap 阶段 spawn java ENOENT：签名链找不到 java 可执行文件（非 ArkTS 编译错误）。',
        'Harness 已从 framework.local.json → toolchain.devEcoStudio.installPath 推导 DevEco JBR 并前插 Path/JAVA_HOME。',
        '真机 testing 在「源码触发重编」前会自动执行 hvigor --stop-daemon，避免旧 daemon worker 沿用无 java 的环境。',
        '若仍失败：在 DevEco 内 Build Hap 一次，或确认系统 JAVA_HOME 未指向无效目录。',
      ].join(' '),
    );
  }

  const signSkip = detectSignSkip(log);
  if (signSkip.signSkipped) {
    diagnostics.push(
      [
        '检测到 hvigor 签名被跳过（Will skip sign）：本轮产物为 unsigned，非编译错误。',
        signSkip.signingConfigMissing
          ? 'hvigor 明确报告：当前工程未配置 signingConfigs profile（No signingConfigs profile is configured）。'
          : '未命中 "No signingConfigs profile is configured" 提示，具体跳过原因请见完整日志。',
        '如需真机安装/自动化测试签名产物：在 DevEco 配置签名（如启用自动签名），并确认 build-profile.json5',
        '最终存在可供 headless hvigor 使用的 signingConfigs（不承诺特定 IDE 版本点击后必定持久化，请核实落盘结果）；',
        '或扩展自定义签名任务覆盖该 target。',
      ].join(' '),
    );
  }

  return diagnostics;
}

/**
 * plan d7e4b2a9 t3①：从 hvigor 日志解析签名跳过的机读标志。
 * 不参与 PASS/FAIL 判定，供 HvigorRunResult.signSkipped/signingConfigMissing 与
 * 下游 ut/testing 分层诊断消费（宿主 bc-openCard 现场日志即命中此模式）。
 */
export function detectSignSkip(log: string): { signSkipped: boolean; signingConfigMissing: boolean } {
  return {
    signSkipped: /Will skip sign/i.test(log),
    signingConfigMissing: /No signingConfigs profile is configured/i.test(log),
  };
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
//   ② build-profile.json5 app.products：若存在名为 `product` / `default` 的条目优先于无序首位
//   ③ 否则取 products[0].name
//   ④ 兜底常量 'default'（让 hvigor 自己报 product not found，不抢报错）
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

  // ② build-profile.json5：优先命中名为 product / default 的条目，其次首位
  try {
    const buildProfile = path.join(projectRoot, 'build-profile.json5');
    if (fs.existsSync(buildProfile)) {
      const raw = fs.readFileSync(buildProfile, 'utf-8');
      const obj = parseProductJson5(raw) as {
        app?: { products?: Array<{ name?: string }> };
      };
      const products = obj?.app?.products ?? [];
      const names = products
        .map((p) => (typeof p?.name === 'string' ? p.name.trim() : ''))
        .filter((n) => n.length > 0);
      if (names.length > 0) {
        if (names.includes('product')) return 'product';
        if (names.includes('default')) return 'default';
        return names[0]!;
      }
    }
  } catch {
    // build-profile.json5 不可解析 → 继续兜底
  }

  // ③ fallback
  return 'default';
}

/**
 * 枚举 build-profile.json5 中声明的全部 product 名（供 device-testing 真机打包前展示选项）。
 * 解析失败或为空时返回 `['default']`。
 */
export function listAvailableProducts(projectRoot: string): string[] {
  try {
    const buildProfile = path.join(projectRoot, 'build-profile.json5');
    if (!fs.existsSync(buildProfile)) {
      return ['default'];
    }
    const raw = fs.readFileSync(buildProfile, 'utf-8');
    const obj = parseProductJson5(raw) as {
      app?: { products?: Array<{ name?: string }> };
    };
    const names = (obj?.app?.products ?? [])
      .map((p) => (typeof p?.name === 'string' ? p.name.trim() : ''))
      .filter((n) => n.length > 0);
    return names.length > 0 ? names : ['default'];
  } catch {
    return ['default'];
  }
}

export interface BuildProfileModuleEntry {
  name: string;
  srcPath: string;
}

/**
 * 读取 build-profile.json5 > modules[]（相对路径去掉 `./`），用于扫描主应用 HAP 产物目录。
 */
export function listBuildProfileModules(projectRoot: string): BuildProfileModuleEntry[] {
  try {
    const buildProfile = path.join(projectRoot, 'build-profile.json5');
    if (!fs.existsSync(buildProfile)) {
      return [];
    }
    const raw = fs.readFileSync(buildProfile, 'utf-8');
    const obj = parseProductJson5(raw) as {
      modules?: Array<{ name?: string; srcPath?: string }>;
    };
    const mods = obj?.modules ?? [];
    return mods
      .map((m) => ({
        name: typeof m?.name === 'string' ? m.name.trim() : '',
        srcPath: typeof m?.srcPath === 'string' ? m.srcPath.replace(/^\.\//, '').trim() : '',
      }))
      .filter((m) => m.name.length > 0 && m.srcPath.length > 0);
  } catch {
    return [];
  }
}

/** G2（plan d7e4b2a9）：build/<segment>/outputs/ 下枚举到的主 HAP signed 候选。 */
export interface HapDiscoveryCandidate {
  path: string;
  moduleName: string;
  moduleSrcPath: string;
  /** `build/<segment>/` 段名（如 product、default，或其他自定义 target 名） */
  segment: string;
  /** `outputs/<outputsDir>/` 段名 */
  outputsDir: string;
}

export interface HapDiscoveryResult {
  /** 按四级排序键选出的首选 signed HAP（无命中为 null） */
  signedPath: string | null;
  /** 全部命中的候选，按同一排序键升序（[0] === signedPath 所在候选） */
  candidates: HapDiscoveryCandidate[];
  /** 实际扫描过的 outputs 目录（相对 projectRoot，正斜杠），无论是否命中都记录 */
  scannedDirs: string[];
}

const OHOS_TEST_OUTPUTS_DIR_RE = /^ohostest$/i;
const OHOS_TEST_NAME_RE = /ohostest/i;

function rankBySegmentOrProduct(name: string, resolvedProduct: string): number {
  if (name === resolvedProduct) return 0;
  if (name === 'default') return 1;
  return 2;
}

interface RawHapCandidate {
  path: string;
  moduleName: string;
  moduleSrcPath: string;
  moduleIndex: number;
  segment: string;
  outputsDir: string;
  fileName: string;
}

/**
 * 四级确定性排序键（plan d7e4b2a9 t1，codex round2 采纳）：
 * ① segment rank（resolvedProduct → default → 其余字典序）
 * ② build-profile modules[] 声明序
 * ③ outputs 子目录 rank（resolvedProduct → default → 其余非 ohosTest 字典序）
 * ④ 文件名 rank（非 ohostest 命名优先 → 字典序尾条，与既有行为一致）
 */
function compareHapCandidates(a: RawHapCandidate, b: RawHapCandidate, resolvedProduct: string): number {
  const segRankA = rankBySegmentOrProduct(a.segment, resolvedProduct);
  const segRankB = rankBySegmentOrProduct(b.segment, resolvedProduct);
  if (segRankA !== segRankB) return segRankA - segRankB;
  if (segRankA === 2 && a.segment !== b.segment) return a.segment < b.segment ? -1 : 1;

  if (a.moduleIndex !== b.moduleIndex) return a.moduleIndex - b.moduleIndex;

  const outRankA = rankBySegmentOrProduct(a.outputsDir, resolvedProduct);
  const outRankB = rankBySegmentOrProduct(b.outputsDir, resolvedProduct);
  if (outRankA !== outRankB) return outRankA - outRankB;
  if (outRankA === 2 && a.outputsDir !== b.outputsDir) return a.outputsDir < b.outputsDir ? -1 : 1;

  const ohosA = OHOS_TEST_NAME_RE.test(a.fileName) ? 1 : 0;
  const ohosB = OHOS_TEST_NAME_RE.test(b.fileName) ? 1 : 0;
  if (ohosA !== ohosB) return ohosA - ohosB;

  // 字典序尾条：与既有行为一致（pool.sort() 后取最后一条 = 更大的文件名优先）
  if (a.fileName !== b.fileName) return a.fileName < b.fileName ? 1 : -1;
  return 0;
}

/**
 * 枚举模块 `build/<segment>/outputs/<outputsDir>/` 下的已签名主应用 HAP（非 ohosTest）。
 * 不再硬编码 outputs 子目录名为 'default'——真实布局中 target 段可能与 product 同名
 * （如 `build/product/outputs/product/`），旧实现只扫 `outputs/default` 导致 headless
 * 已签出的主 HAP 被判"未找到"（宿主 bc-openCard 误报根因）。
 */
export function discoverAppHapArtifacts(projectRoot: string, buildProduct?: string): HapDiscoveryResult {
  const resolvedProduct = buildProduct?.trim() ?? '';
  const modules = listBuildProfileModules(projectRoot);
  const scannedDirs: string[] = [];
  const raw: RawHapCandidate[] = [];

  modules.forEach((m, moduleIndex) => {
    const buildRoot = path.join(projectRoot, m.srcPath, 'build');
    if (!fs.existsSync(buildRoot)) return;
    let segEntries: fs.Dirent[];
    try {
      segEntries = fs.readdirSync(buildRoot, { withFileTypes: true });
    } catch {
      return;
    }
    for (const segEnt of segEntries) {
      if (!segEnt.isDirectory()) continue;
      const segment = segEnt.name;
      const outputsRoot = path.join(buildRoot, segment, 'outputs');
      if (!fs.existsSync(outputsRoot)) continue;
      let outEntries: fs.Dirent[];
      try {
        outEntries = fs.readdirSync(outputsRoot, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const outEnt of outEntries) {
        if (!outEnt.isDirectory()) continue;
        if (OHOS_TEST_OUTPUTS_DIR_RE.test(outEnt.name)) continue; // ohosTest 产物由 findOhosTestSignedHap 负责
        const outputsDir = path.join(outputsRoot, outEnt.name);
        scannedDirs.push(path.relative(projectRoot, outputsDir).split(path.sep).join('/'));
        let files: string[];
        try {
          files = fs.readdirSync(outputsDir).filter((f) => f.endsWith('-signed.hap'));
        } catch {
          continue;
        }
        for (const fileName of files) {
          raw.push({
            path: path.join(outputsDir, fileName),
            moduleName: m.name,
            moduleSrcPath: m.srcPath,
            moduleIndex,
            segment,
            outputsDir: outEnt.name,
            fileName,
          });
        }
      }
    }
  });

  raw.sort((a, b) => compareHapCandidates(a, b, resolvedProduct));

  const candidates: HapDiscoveryCandidate[] = raw.map((c) => ({
    path: c.path,
    moduleName: c.moduleName,
    moduleSrcPath: c.moduleSrcPath,
    segment: c.segment,
    outputsDir: c.outputsDir,
  }));

  return {
    signedPath: candidates.length > 0 ? candidates[0]!.path : null,
    candidates,
    scannedDirs,
  };
}

/**
 * 薄包装（codex round2 采纳）：保持既有 `string | null` 契约，供
 * device-test-build-reuse.ts / providers/device-test-build.ts 等既有调用方零改动消费。
 * 需要 scannedDirs/candidates 的调用方应改用 discoverAppHapArtifacts。
 */
export function findAppSignedHap(projectRoot: string, buildProduct?: string): string | null {
  return discoverAppHapArtifacts(projectRoot, buildProduct).signedPath;
}

/**
 * G2（plan d7e4b2a9 t2）：signed HAP 是否可能基于「上一轮」unsigned 产物——纯观测，
 * 不做硬门禁（两家 review round2 一致意见：本批反馈无实锤样本，任意目录 mtime 比较
 * 会误伤其他 target/变体；仅按相同 basename 配对，构建后由调用方带出该字段即可）。
 */
export interface StaleSignedSuspect {
  staleSuspect: boolean;
  unsignedPath: string | null;
  note?: string;
}

export function detectStaleSignedSuspect(signedPath: string): StaleSignedSuspect {
  const SIGNED_SUFFIX = '-signed.hap';
  if (!signedPath.endsWith(SIGNED_SUFFIX)) {
    return { staleSuspect: false, unsignedPath: null };
  }
  const unsignedPath = `${signedPath.slice(0, -SIGNED_SUFFIX.length)}-unsigned.hap`;
  if (!fs.existsSync(unsignedPath)) {
    return { staleSuspect: false, unsignedPath: null };
  }
  try {
    const signedMtime = fs.statSync(signedPath).mtimeMs;
    const unsignedMtime = fs.statSync(unsignedPath).mtimeMs;
    if (unsignedMtime > signedMtime) {
      return {
        staleSuspect: true,
        unsignedPath,
        note: 'signed 可能基于上一轮 unsigned，宿主自定义签名任务时序所致，建议核对后重跑构建',
      };
    }
    return { staleSuspect: false, unsignedPath };
  } catch {
    return { staleSuspect: false, unsignedPath };
  }
}

/** framework.config > toolchain.hvigor.coding 与默认值合并（不抛） */
function loadResolvedCodingConfig(projectRoot: string): {
  driver: NonNullable<HvigorCodingConfig['driver']>;
  mode: 'module' | 'project';
  task: string;
  passBuildModeDebug: boolean;
  extraArgs: string[];
  successMarkers: string[] | undefined;
} {
  let raw: HvigorCodingConfig | undefined;
  try {
    raw = loadFrameworkConfig(projectRoot).toolchain?.hvigor?.coding;
  } catch {
    raw = undefined;
  }
  const driver = raw?.driver ?? 'node_hvigorw_js';
  const defaultTask = driver === 'assemble_app_project' ? 'assembleApp' : 'assembleHap';
  return {
    driver,
    mode: raw?.mode ?? 'module',
    task: raw?.task ?? defaultTask,
    passBuildModeDebug: raw?.passBuildModeDebug !== false,
    extraArgs: raw?.extraArgs ?? [],
    successMarkers: raw?.successMarkers,
  };
}

/**
 * coding_hvigor_build 传给 hvigorw 的参数列表（不含 node / wrapper 可执行文件）。
 * 默认对齐 DevEco：`--mode module … assembleHap`；`driver=assemble_app_project` 时同 `buildAssembleAppArgs`。
 */
export function buildCodingHvigorArgs(
  projectRoot: string,
  overrides?: {
    task?: string;
    extraArgs?: string[];
    /** 覆盖 detectProduct / preferredProduct（含显式 `-p product=`） */
    product?: string;
    /** 显式 buildMode；不设时沿用 config.passBuildModeDebug（默认追 debug） */
    buildMode?: 'debug' | 'release';
    /** 装依赖后重编译：强制 --no-daemon */
    forceNoDaemon?: boolean;
  },
): string[] {
  const c = loadResolvedCodingConfig(projectRoot);
  const task = overrides?.task ?? c.task;
  const extraArgs = overrides?.extraArgs ?? c.extraArgs;
  const product = overrides?.product?.trim() || detectProduct(projectRoot);
  if (c.driver === 'assemble_app_project') {
    return buildAssembleAppArgs(projectRoot, task, extraArgs, {
      product: overrides?.product?.trim() || undefined,
      buildMode: overrides?.buildMode,
    });
  }
  const args: string[] = ['--mode', c.mode];
  args.push('-p', `product=${product}`);
  if (overrides?.buildMode) {
    args.push('-p', `buildMode=${overrides.buildMode}`);
  } else if (c.passBuildModeDebug) {
    args.push('-p', 'buildMode=debug');
  }
  args.push(
    ...buildHvigorTuningArgs(
      projectRoot,
      overrides?.forceNoDaemon ? { daemon: false, incremental: false } : undefined,
    ),
  );
  args.push(...extraArgs);
  args.push(task);
  return args;
}

export interface HvigorSpawnPlan {
  spawnFile: string;
  spawnArgs: string[];
  useShell: boolean;
  /** shell 模式下的整条命令行（与 spawnFile 相同） */
  shellCmdLine?: string;
  commandDisplay: string;
  invocationDriver: string;
}

function buildSpawnPlanFromResolved(
  resolved: NonNullable<ReturnType<typeof resolveHvigorCommand>>,
  hvigorArgs: string[],
  driverLabel: string,
): HvigorSpawnPlan {
  const needsShell = resolved.useShell;
  if (needsShell) {
    const shellCmdLine = [resolved.cmd, ...hvigorArgs].map(quoteCmdArgWin).join(' ');
    return {
      spawnFile: shellCmdLine,
      spawnArgs: [],
      useShell: true,
      shellCmdLine,
      commandDisplay: shellCmdLine,
      invocationDriver: driverLabel,
    };
  }
  return {
    spawnFile: resolved.cmd,
    spawnArgs: hvigorArgs,
    useShell: false,
    commandDisplay: `${resolved.cmd} ${hvigorArgs.join(' ')}`,
    invocationDriver: driverLabel,
  };
}

/**
 * 解析 coding 阶段真实 spawn 形态：优先 node+hvigorw.js（DevEco 对齐），失败再回退 hvigorw wrapper。
 */
export function resolveCodingHvigorSpawnPlan(
  projectRoot: string,
  hvigorArgs: string[],
): { spawnPlan: HvigorSpawnPlan } | { toolMissing: true } {
  const cfg = loadResolvedCodingConfig(projectRoot);

  if (cfg.driver === 'hvigorw_wrapper') {
    const resolved = resolveHvigorCommand(projectRoot);
    if (!resolved) return { toolMissing: true };
    return { spawnPlan: buildSpawnPlanFromResolved(resolved, hvigorArgs, 'hvigorw_wrapper') };
  }

  const nodePair = resolveNodeHvigorwJs(projectRoot);
  if (nodePair) {
    const display =
      `${quoteCmdArgWin(nodePair.nodeExe)} ${quoteCmdArgWin(nodePair.hvigorwJs)} ${hvigorArgs.map(quoteCmdArgWin).join(' ')}`;
    return {
      spawnPlan: {
        spawnFile: nodePair.nodeExe,
        spawnArgs: [nodePair.hvigorwJs, ...hvigorArgs],
        useShell: false,
        commandDisplay: display,
        invocationDriver: 'node_hvigorw_js',
      },
    };
  }

  const resolved = resolveHvigorCommand(projectRoot);
  if (!resolved) return { toolMissing: true };
  return {
    spawnPlan: buildSpawnPlanFromResolved(
      resolved,
      hvigorArgs,
      'hvigorw_wrapper_fallback',
    ),
  };
}

/**
 * UT 阶段 spawn 解析：与 coding 共用 `resolveCodingHvigorSpawnPlan`（node+hvigorw.js 优先），
 * 仅参数装配由 `buildUtHvigorArgs` 负责，避免在通用 framework.config 模板增加 hvigor.ut 段。
 */
export function resolveUtHvigorSpawnPlan(
  projectRoot: string,
  hvigorArgs: string[],
): { spawnPlan: HvigorSpawnPlan } | { toolMissing: true } {
  return resolveCodingHvigorSpawnPlan(projectRoot, hvigorArgs);
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
  /** framework 资产根；缺省时从 projectRoot infer */
  frameworkRoot?: string;
  /** feature 名（reports 子目录） */
  feature: string;
  /** phase（reports 子目录） */
  phase: string;
  /** 日志文件名（相对 reports/<feature>/<phase>/），如 'hvigor-build.log' */
  logBasename: string;
  /**
   * 传给 hvigor 的参数（不含可执行路径）。与 `spawnPlan` 二选一：
   * 提供 `spawnPlan` 时忽略此字段。
   */
  args?: string[];
  /** 已解析的 spawn（coding 路径）；未提供时按 ut 语义 `resolveHvigorCommand` + `args`。 */
  spawnPlan?: HvigorSpawnPlan;
  /** 被此环境变量跳过时，返回 skippedByEnv=true（调用方应翻译为 FAIL） */
  skipEnvVar?: string;
  /** 超时（ms）；未设置时用 timeoutKind 默认 */
  timeoutMs?: number;
  /** 与 toolchain.hvigor.timeoutMs 共同决定默认超时时长 */
  timeoutKind?: 'coding' | 'ut';
  /**
   * coding 门禁：exitCode=0 且无解析 error 时仍要求日志尾部命中成功哨兵；
   * ut 模块编译为 false。
   */
  requireSuccessMarker?: boolean;
  /** 覆盖 config 中的 toolchain.hvigor.coding.successMarkers */
  successMarkerSources?: string[];
  /** 合并进落盘 *.meta.json 的额外字段（如 `utHvigor`） */
  metaExtras?: Record<string, unknown>;
}

function excerptFromLogFile(logAbs: string): string {
  const tailBytes = readFileTailUtf8(logAbs, Math.max(REPORT_EXCERPT_TAIL_CHARS * 6, 24_000));
  if (tailBytes.length <= REPORT_EXCERPT_TAIL_CHARS) return tailBytes;
  return tailBytes.slice(-REPORT_EXCERPT_TAIL_CHARS);
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

  const childEnv = buildChildEnv(opts.projectRoot);
  const childCwd = opts.cwd ?? opts.projectRoot;
  const timeoutMs =
    opts.timeoutMs ?? resolveHvigorTimeout(opts.projectRoot, opts.timeoutKind ?? 'ut');

  let spawnPlan: HvigorSpawnPlan;
  if (opts.spawnPlan) {
    spawnPlan = opts.spawnPlan;
  } else {
    const hvigorArgs = opts.args;
    if (!hvigorArgs) {
      return {
        executed: false,
        durationMs: Date.now() - t0,
        logExcerpt: '[Harness 内部错误] invokeHvigor 缺少 args 与 spawnPlan',
        errors: [{ message: 'invokeHvigor：必须提供 args 或 spawnPlan' }],
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
    spawnPlan = buildSpawnPlanFromResolved(resolved, hvigorArgs, 'hvigorw_wrapper');
  }

  const dir = ensureHvigorLogReportDir(opts.projectRoot, opts.feature, opts.phase, opts.frameworkRoot);
  const logAbs = path.join(dir, opts.logBasename);
  const commandDisplay = spawnPlan.commandDisplay;
  const header = `$ ${commandDisplay}\n\n`;

  let logFd: number;
  try {
    logFd = fs.openSync(logAbs, 'w');
  } catch (err) {
    const e = err as Error;
    return {
      executed: false,
      durationMs: Date.now() - t0,
      logExcerpt: `[open log error] ${e.message}`,
      errors: [{ message: `无法创建 hvigor 日志文件：${e.message}` }],
    };
  }

  fs.writeSync(logFd, header, undefined, 'utf-8');

  let spawnRet: SpawnSyncReturns<string | Buffer>;
  try {
    spawnRet = spawnPlan.useShell
      ? spawnSync(spawnPlan.spawnFile, [], {
          cwd: childCwd,
          shell: true,
          timeout: timeoutMs,
          env: childEnv,
          stdio: ['ignore', logFd, logFd],
          windowsHide: true,
        })
      : spawnSync(spawnPlan.spawnFile, spawnPlan.spawnArgs, {
          cwd: childCwd,
          shell: false,
          timeout: timeoutMs,
          env: childEnv,
          stdio: ['ignore', logFd, logFd],
          windowsHide: true,
        });
  } catch (err) {
    fs.closeSync(logFd);
    const e = err as Error;
    return {
      executed: false,
      durationMs: Date.now() - t0,
      logExcerpt: `[spawnSync error] ${e.message}`,
      errors: [{ message: `hvigor 启动失败：${e.message}` }],
    };
  }

  fs.closeSync(logFd);

  const errCode = spawnRet.error && (spawnRet.error as NodeJS.ErrnoException).code;
  const timedOut = errCode === 'ETIMEDOUT';

  let logBytes = 0;
  try {
    logBytes = fs.statSync(logAbs).size;
  } catch {
    logBytes = 0;
  }

  const analysisText = readLogTextForAnalysis(logAbs);
  const errors = parseBuildErrors(analysisText);
  const diagnostics = buildHvigorDiagnostics(analysisText);
  const excerptTail = excerptFromLogFile(logAbs);

  const requireMarker = opts.requireSuccessMarker === true;
  const markers = requireMarker
    ? compileSuccessMarkerRegexes(
      opts.successMarkerSources ?? loadResolvedCodingConfig(opts.projectRoot).successMarkers,
    )
    : [];
  const tailForMarker = readFileTailUtf8(logAbs, TAIL_SUCCESS_SCAN_BYTES);
  const successMarkerFound = requireMarker ? scanSuccessMarkers(tailForMarker, markers) : true;

  const metaAbs = path.join(dir, metaBasenameFromLog(opts.logBasename));
  const metaPayload = {
    tool: 'hvigor',
    command: commandDisplay,
    cwd: childCwd,
    exitCode: spawnRet.status ?? null,
    signal: spawnRet.signal ?? null,
    durationMs: Date.now() - t0,
    timedOut,
    logBytes,
    successMarkerRequired: requireMarker,
    successMarkerFound,
    invocationDriver: spawnPlan.invocationDriver,
    envProbe: {
      DEVECO_SDK_HOME: Boolean(childEnv.DEVECO_SDK_HOME),
      JAVA_HOME: typeof childEnv.JAVA_HOME === 'string' ? childEnv.JAVA_HOME : null,
      DEVECO_STUDIO_HOME: Boolean(process.env.DEVECO_STUDIO_HOME),
      HUAWEI_DEVECO_STUDIO_HOME: Boolean(process.env.HUAWEI_DEVECO_STUDIO_HOME),
    },
    logFile: path.basename(logAbs),
    ...(opts.metaExtras ?? {}),
  };
  try {
    fs.writeFileSync(metaAbs, JSON.stringify(metaPayload, null, 2), 'utf-8');
  } catch {
    /* best-effort */
  }

  const logPath = path.relative(process.cwd(), logAbs).replace(/\\/g, '/');
  const metaPath = path.relative(process.cwd(), metaAbs).replace(/\\/g, '/');
  const signSkip = detectSignSkip(analysisText);

  return {
    executed: true,
    exitCode: timedOut ? -1 : (spawnRet.status ?? -1),
    timedOut,
    successMarkerFound,
    durationMs: Date.now() - t0,
    logExcerpt: excerptTail,
    logPath,
    metaPath,
    logAbsPath: logAbs,
    errors,
    diagnostics,
    command: commandDisplay,
    invocationDriver: spawnPlan.invocationDriver,
    signSkipped: signSkip.signSkipped,
    signingConfigMissing: signSkip.signingConfigMissing,
  };
}

/**
 * 模块级编译。
 *
 * 用于 ut_hvigor_build（`genOnDeviceTestHap`，与 DevEco Run ohosTest 对齐）。
 * Coding 阶段默认走 `runHvigorAssembleApp`（`toolchain.hvigor.coding`，与 DevEco `--mode module assembleHap` 对齐）。
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
  if (opts.skipEnvVar && process.env[opts.skipEnvVar]) {
    return {
      executed: false,
      skippedByEnv: true,
      durationMs: 0,
      logExcerpt: `[skipped] env ${opts.skipEnvVar}=${process.env[opts.skipEnvVar]}`,
      errors: [],
    };
  }

  const target = opts.target ?? 'default';
  const task = opts.task ?? (target === 'ohosTest' ? 'genOnDeviceTestHap' : 'assembleHap');

  if (target === 'ohosTest') {
    const utArgs = buildUtHvigorArgs(opts.projectRoot, opts.moduleName, task);
    const resolved = resolveUtHvigorSpawnPlan(opts.projectRoot, utArgs);
    if ('toolMissing' in resolved) {
      return {
        executed: false,
        toolMissing: true,
        durationMs: 0,
        logExcerpt: buildToolMissingMessage(opts.projectRoot),
        errors: [],
      };
    }
    const product = detectProduct(opts.projectRoot);
    return invokeHvigor({
      ...opts,
      spawnPlan: resolved.spawnPlan,
      logBasename: 'hvigor-ut-build.log',
      timeoutKind: 'ut',
      requireSuccessMarker: false,
      metaExtras: {
        utHvigor: {
          mode: 'module',
          product,
          buildMode: 'test',
          isOhosTest: true,
          task,
        },
      },
    });
  }

  const args = buildModuleHapArgs(opts.projectRoot, opts.moduleName, 'default', task);
  return invokeHvigor({
    ...opts,
    args,
    logBasename: 'hvigor-build.log',
    timeoutKind: 'ut',
    requireSuccessMarker: false,
  });
}

/**
 * 停止 hvigor daemon（真编译前调用，避免旧 worker 进程缺少 JBR/java 导致 PackageHap ENOENT）。
 * 失败不阻断后续 assemble；仅 best-effort。
 */
export function stopHvigorDaemon(
  opts: Pick<HvigorInvokeOpts, 'projectRoot' | 'harnessRoot' | 'frameworkRoot' | 'feature' | 'phase'>,
): void {
  const resolved = resolveCodingHvigorSpawnPlan(opts.projectRoot, ['--stop-daemon']);
  if ('toolMissing' in resolved) return;
  invokeHvigor({
    ...opts,
    spawnPlan: resolved.spawnPlan,
    logBasename: 'hvigor-stop-daemon.log',
    timeoutKind: 'coding',
    requireSuccessMarker: false,
  });
}

/**
 * Coding 阶段项目级 / 模块级 hvigor 门禁入口（默认与 DevEco 一致：`node hvigorw.js --mode module … assembleHap`）。
 *
 * 由 `toolchain.hvigor.coding` 控制 driver/mode/task；`driver=assemble_app_project` 时等价于历史 `assembleApp` 项目级验证。
 */
export function runHvigorAssembleApp(
  opts: Omit<HvigorInvokeOpts, 'args' | 'logBasename' | 'spawnPlan'> & {
    /** 覆盖 config 中的 coding.task */
    task?: string;
    /** 覆盖 / 合并 config 的 coding.extraArgs（此处传入即整段替换 config 的 extraArgs） */
    extraArgs?: string[];
    /** 覆盖 `-p product=`（device-testing device-testing 等） */
    product?: string;
    /** 覆盖 `-p buildMode=` */
    buildMode?: 'debug' | 'release';
    /** 装依赖后重编译：强制 --no-daemon，避免 daemon 缓存漏读新 oh_modules */
    forceNoDaemon?: boolean;
    /** 自定义日志基名（默认 hvigor-build.log） */
    logBasename?: string;
  },
): HvigorRunResult {
  const { task, extraArgs, product, buildMode, forceNoDaemon, logBasename, ...rest } = opts;
  if (rest.skipEnvVar && process.env[rest.skipEnvVar]) {
    return {
      executed: false,
      skippedByEnv: true,
      durationMs: 0,
      logExcerpt: `[skipped] env ${rest.skipEnvVar}=${process.env[rest.skipEnvVar]}`,
      errors: [],
    };
  }

  const hvigorArgs = buildCodingHvigorArgs(opts.projectRoot, {
    task,
    extraArgs,
    product,
    buildMode,
    forceNoDaemon,
  });
  const resolved = resolveCodingHvigorSpawnPlan(opts.projectRoot, hvigorArgs);
  if ('toolMissing' in resolved) {
    return {
      executed: false,
      toolMissing: true,
      durationMs: 0,
      logExcerpt: buildToolMissingMessage(opts.projectRoot),
      errors: [],
    };
  }
  return invokeHvigor({
    ...rest,
    spawnPlan: resolved.spawnPlan,
    logBasename: logBasename ?? 'hvigor-build.log',
    timeoutKind: 'coding',
    requireSuccessMarker: true,
  });
}

// ----------------------------------------------------------------------------
// args 装配（单测覆盖：profiles/hmos-app/harness/tests/unit/hvigor-args.unit.test.ts）
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
  assembleOpts?: { product?: string; buildMode?: 'debug' | 'release' },
): string[] {
  const product = assembleOpts?.product ?? detectProduct(projectRoot);
  const buildMode = assembleOpts?.buildMode ?? 'debug';
  return [
    '--mode', 'project',
    '-p', `product=${product}`,
    '-p', `buildMode=${buildMode}`,
    ...buildHvigorTuningArgs(projectRoot),
    ...(extraArgs ?? []),
    task,
  ];
}

/**
 * 装配 ohosTest / `genOnDeviceTestHap` 的 hvigor args（ut_hvigor_build / ut_hvigor_test 共用）。
 *
 * 与 DevEco Studio「Run ohosTest」默认对齐：`node hvigorw.js --mode module`
 * + `-p module=<name>@ohosTest` + `-p isOhosTest=true` + `-p product=<detectProduct()>`
 * + `-p buildMode=test` + task + `--analyze=normal`（analyze 非 off 时）+ parallel/incremental/daemon。
 *
 * **不**写入通用 `framework.config` 模板；平台默认收敛在本函数与 `resolveUtHvigorSpawnPlan`。
 */
export function buildUtHvigorArgs(
  projectRoot: string,
  moduleName: string,
  task: string = 'genOnDeviceTestHap',
): string[] {
  return [
    '--mode', 'module',
    '-p', `module=${moduleName}@ohosTest`,
    '-p', 'isOhosTest=true',
    '-p', `product=${detectProduct(projectRoot)}`,
    '-p', 'buildMode=test',
    task,
    ...buildUtHvigorTuningArgs(projectRoot),
  ];
}

/**
 * 装配模块级 default target 的 hvigor args（历史路径：不传 `--mode`，与 wrapper 直跑兼容）。
 *
 * **ohosTest** 请使用 `buildUtHvigorArgs`（`runHvigorBuild(..., target: 'ohosTest')` 已内置）。
 */
export function buildModuleHapArgs(
  projectRoot: string,
  moduleName: string,
  target: 'default' | 'ohosTest',
  task: string,
): string[] {
  if (target === 'ohosTest') {
    return buildUtHvigorArgs(projectRoot, moduleName, task);
  }
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
 * 存在 TestAbility.ets。HAR / HSP 库模块（典型如 feature 级 HAR）没有
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

/**
 * 确保 errors 里存在一条 `失败阶段：<X>` 前缀的消息，供 ut-host-impl.ts 的
 * `stageHint = errors.find(e => /失败阶段：/.test(e.message))` 契约消费
 * （plan d7e4b2a9 review P1，codex round5 指出）。
 *
 * 只在**没有任何一条**消息命中 `/失败阶段：/` 时才**前插**一条合成消息——不能只判断
 * `errors.length === 0`：hdc-runner 的诊断消息（sign-skip 分层诊断、部分无 diagnosis
 * 的 install/aa-test 失败文案）可能已有内容但不含该前缀，此时若不补，会让
 * `stageHint` 落空、suggestion 误导向"修改 UT"。也不能无条件覆盖/前插：已有
 * `失败阶段：device_locked；...` 这类更具体消息时，`failedAt`（如 'run'）粒度更粗，
 * 前插反而会用粗粒度覆盖 `.find()` 命中的细粒度消息，丢失 device_locked 特判。
 */
export function ensureFailedAtStageTag(
  errors: HvigorError[],
  failedAt: string | undefined,
): HvigorError[] {
  if (!failedAt) return errors;
  if (errors.some((e) => /失败阶段：/.test(e.message))) return errors;
  return [{ message: `失败阶段：${failedAt}` }, ...errors];
}

/**
 * 组装 runHvigorTest → runOnDeviceUt 的模块级签名诊断透传对象（plan d7e4b2a9 t3③）。
 * 抽成纯函数供单测覆盖"接线是否正确"（cursor round5 minor：此前仅测了分层文案本身，
 * 未测 runHvigorTest 是否真的把 buildRes 的字段传对）。
 */
export function buildOnDeviceSignDiagnosis(
  buildRes: Pick<HvigorRunResult, 'signSkipped' | 'signingConfigMissing'>,
  mainAppSignedPath: string | null,
): OhosTestSignDiagnosis {
  return {
    signSkipped: buildRes.signSkipped,
    signingConfigMissing: buildRes.signingConfigMissing,
    mainAppSignedPath,
  };
}

export function runHvigorTest(
  opts: Omit<HvigorInvokeOpts, 'args' | 'logBasename'> & {
    moduleName: string;
    /** 模块源码相对路径（相对 projectRoot），如 '02-Feature/FeatureAlpha' */
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

  // 装机前诊断：版本降级 / 设备可用性（与 testing 侧 device-install-diag 共用逻辑）
  const installDiag = diagnoseInstallBlocking(opts.projectRoot);
  writeUtInstallDiagJson(
    opts.projectRoot,
    opts.feature,
    opts.phase,
    opts.frameworkRoot ?? inferRepoLayout(opts.projectRoot).frameworkRoot,
    installDiag,
  );
  if (installDiag.kind !== 'clear') {
    return {
      executed: false,
      exitCode: 1,
      durationMs: Date.now() - t0,
      logExcerpt:
        `[install-preflight blocked] kind=${installDiag.kind}\n${installDiag.details}`,
      logPath: buildRes.logPath,
      errors: [{ message: `失败阶段：install_preflight (${installDiag.kind})` }],
      installBlocking: installDiag,
      command: 'genOnDeviceTestHap + install_preflight',
    };
  }

  // ② / ③ / ④：装机 + 执行 + 解析（封装在 hdc-runner，避免本文件臃肿）
  // 这里通过 require 动态导入，避免 hvigor-runner ↔ hdc-runner 之间形成 import 环。
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { runOnDeviceUt } = require('./hdc-runner') as typeof import('./hdc-runner');
  const resolvedProduct = detectProduct(opts.projectRoot);
  // plan d7e4b2a9 t3③④：模块级签名诊断——同函数内直传，不跨阶段传输，防多 ohosTest 模块串诊断。
  // mainAppSignedPath 仅扫描磁盘、不核对来源（codex round5 P1）：不得断言"本轮/本环境
  // 已验证签名链路可用"，只作为"headless 全局不支持签名"这一归因不成立的弱证据，
  // 具体措辞见 describeOhosTestSignSkipDiagnosis。
  const mainAppDiscovery = discoverAppHapArtifacts(opts.projectRoot, resolvedProduct);
  const onDevice = runOnDeviceUt({
    projectRoot: opts.projectRoot,
    harnessRoot: opts.harnessRoot,
    frameworkRoot: opts.frameworkRoot,
    feature: opts.feature,
    phase: opts.phase,
    srcModuleName: opts.moduleName,
    srcPath: opts.moduleSrcPath,
    buildProduct: resolvedProduct,
    skipEnvVar: opts.skipEnvVar, // 允许跟 build 用同一个 env 变量整体跳过
    signDiagnosis: buildOnDeviceSignDiagnosis(buildRes, mainAppDiscovery.signedPath),
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
  res.errors = ensureFailedAtStageTag(res.errors, onDevice.failedAt);
  if (onDevice.report && onDevice.report.failed === 0 && onDevice.executed) {
    res.exitCode = 0;
  }
  return res;
}

/** @deprecated 使用 hdc-runner.probeDevices（统一隔离 cwd + hdcTargetPrefix）。 */
export { probeDevices } from './hdc-runner';
