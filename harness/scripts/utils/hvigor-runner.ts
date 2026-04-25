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
//  - Windows 优先跑 `hvigorw.bat`，其次 `hvigorw`，再次 `hvigor`（PATH）；
//  - 日志按 feature/phase 落盘到 reports 目录（便于后续追溯）；
//  - **默认启用**真实编译/运行；环境变量 HARNESS_SKIP_HVIGOR[_TEST]=1 为
//    "逃生阀"，在调用点被转译为 FAIL（不是 SKIP），详见 check-coding.ts /
//    check-ut.ts 里的规则实现。
//  - 兜底：若 hvigor 工具不可用（wrapper/PATH 都找不到），返回 toolMissing=true，
//    由调用点翻译为 BLOCKER FAIL，并输出诊断指引。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync, SpawnSyncReturns } from 'child_process';

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

const MAX_LOG_CHARS = 200_000;

/** 按优先级解析 hvigor 可执行命令：wrapper (bat > sh) → PATH */
function resolveHvigorCommand(projectRoot: string): { cmd: string; useShell: boolean } | null {
  const isWin = process.platform === 'win32';
  const candidates = isWin
    ? ['hvigorw.bat', 'hvigorw']
    : ['hvigorw', 'hvigorw.bat'];

  for (const name of candidates) {
    const abs = path.join(projectRoot, name);
    if (fs.existsSync(abs)) {
      return { cmd: abs, useShell: isWin };
    }
  }

  // PATH 兜底：允许全局 hvigor CLI（DevEco / ohpm 安装）
  const globalCandidates = isWin
    ? ['hvigorw.bat', 'hvigor.bat', 'hvigorw', 'hvigor']
    : ['hvigorw', 'hvigor'];
  for (const name of globalCandidates) {
    const probe = spawnSync(isWin ? 'where' : 'which', [name], {
      encoding: 'utf-8',
      shell: false,
    });
    if (probe.status === 0 && probe.stdout && probe.stdout.trim()) {
      return { cmd: name, useShell: isWin };
    }
  }

  return null;
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

export interface HvigorInvokeOpts {
  /** 项目根（hvigorw 所在目录） */
  projectRoot: string;
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
      logExcerpt:
        '未找到 hvigorw 可执行文件。请确认 DevEco Studio 已安装，且项目根目录存在 hvigorw.bat / hvigorw 包装脚本，' +
        '或 hvigor CLI 已加入 PATH（可通过 ohpm 全局安装）。',
      errors: [],
    };
  }

  let spawnRet: SpawnSyncReturns<string>;
  try {
    spawnRet = spawnSync(resolved.cmd, opts.args, {
      cwd: opts.projectRoot,
      encoding: 'utf-8',
      shell: resolved.useShell,
      timeout: opts.timeoutMs ?? 15 * 60 * 1000,
      maxBuffer: 64 * 1024 * 1024, // 64 MB，防大日志截断异常
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
  const fullLog = truncateLog(`$ ${resolved.cmd} ${opts.args.join(' ')}\n\n${stdout}\n${stderr}`);

  const dir = ensureReportDir(opts.harnessRoot, opts.feature, opts.phase);
  const logAbs = path.join(dir, opts.logBasename);
  try {
    fs.writeFileSync(logAbs, fullLog, 'utf-8');
  } catch {
    // best-effort；日志落盘失败不应阻断检查
  }
  const logPath = path.relative(process.cwd(), logAbs).replace(/\\/g, '/');

  const errors = parseBuildErrors(fullLog);

  return {
    executed: true,
    exitCode: spawnRet.status ?? -1,
    durationMs: Date.now() - t0,
    logExcerpt: fullLog.slice(-8000), // 尾部 8KB 放到 result 方便报告展示
    logPath,
    errors,
    command: `${resolved.cmd} ${opts.args.join(' ')}`,
  };
}

/**
 * 模块级编译：assembleHap（或等价 build task）。
 * 用于 coding_hvigor_build / ut_hvigor_build 规则。
 */
export function runHvigorBuild(
  opts: Omit<HvigorInvokeOpts, 'args' | 'logBasename'> & {
    /** 目标模块名（对应 build-profile.json5 > modules[].name） */
    moduleName: string;
    /** 对应 build 目标；ohosTest 模块用 'ohosTest' */
    target?: 'default' | 'ohosTest';
  },
): HvigorRunResult {
  const target = opts.target ?? 'default';
  const args = [
    '--mode', 'module',
    '-p', `module=${opts.moduleName}@${target}`,
    '-p', 'product=default',
    '--no-daemon',
    'assembleHap',
  ];
  return invokeHvigor({
    ...opts,
    args,
    logBasename: target === 'ohosTest' ? 'hvigor-ut-build.log' : 'hvigor-build.log',
  });
}

/**
 * hypium 装机执行 UT：hvigor test（需要真机/模拟器）。
 * 用于 ut_hvigor_test 规则。
 */
export function runHvigorTest(
  opts: Omit<HvigorInvokeOpts, 'args' | 'logBasename'> & {
    moduleName: string;
  },
): HvigorRunResult {
  const args = [
    '--mode', 'module',
    '-p', `module=${opts.moduleName}@ohosTest`,
    '-p', 'product=default',
    '--no-daemon',
    'test',
  ];
  const res = invokeHvigor({ ...opts, args, logBasename: 'hvigor-test.log' });
  if (res.executed) {
    res.testResult = parseHypiumOutput(res.logExcerpt + '\n' + (fs.existsSync(path.join(opts.harnessRoot, 'reports', opts.feature, opts.phase, 'hvigor-test.log')) ? fs.readFileSync(path.join(opts.harnessRoot, 'reports', opts.feature, opts.phase, 'hvigor-test.log'), 'utf-8') : ''));
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
