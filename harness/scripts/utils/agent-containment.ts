// ============================================================================
// agent-containment.ts — Windows agent containment 的 Node 侧装帧（plan c6a9e4d2 t2）
// ----------------------------------------------------------------------------
// guardian 进程本体是 PowerShell P/Invoke 脚本（agent-guardian.ps1，零新增二进制）。
// 本模块只负责：
//   · 构造 guardian 调用（参数编码/argv 装帧）与 containment 启用判定；
//   · **argv → Windows command line 的组装与转义（P1-7 review 收归本层：标准
//     CommandLineToArgvW 反向 quoting + cmd /S /C 分支的 % 转义，可单测）；**
//   · 把 guardian 的 ManagedProcessIdentity（t3 接管契约）从事件侧组装给调用方
//     （pid 即 spawn 返回的 guardian pid；startedAtMs/executable 经共享探针读取，
//     token 为 guardian argv 明文携带的 run_id/invoke_id）。
//
// 纪律（plan 冻结）：
//   · guardian 是 Job handle 的唯一长期持有者，不向 runner/agent 复制句柄；
//   · 禁止 spawn→assign 竞态（guardian 内部 CREATE_SUSPENDED → assign → resume）；
//   · agent stdout/stderr 经句柄继承继续抵达 runner 既有消费管道；
//   · Windows unattended 下 containment 建立失败=invoke 失败如实上浮，绝不
//     WARN 后放行（guardian 快速非零退出 + stderr 前缀诊断即失败路径）；
//   · 非 Windows / attended / dry-run 零变化（不使用 guardian）。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

export const GUARDIAN_SCRIPT_PATH = path.join(__dirname, 'agent-guardian.ps1');

/** t3 身份契约：guardian argv 必须显式携带的 token（run_id/invoke_id 合体）。 */
export function guardianToken(runId: string, invokeId: string): string {
  return `${runId}/${invokeId}`;
}

export interface GuardianAgentSpec {
  argv: string[];
  cwd: string;
  /**
   * 二轮 review：guardian 不再自行拼接命令行——本层已按目标形态完成转义
   *（全 direct：shim 已被解包）。guardian 只做 `CreateProcess(appName, commandLine)`。
   */
  commandLine: string;
  appName: string;
}

export interface GuardianInvocation {
  /** 可直接交 spawn 的完整调用（file = powershell.exe）。 */
  file: string;
  args: string[];
  /** Base64(UTF-16LE(JSON)) 的 agent 规格（不经过命令行转义风险面）。 */
  agentJsonEncoded: string;
}

function resolvePowerShellExe(): string | null {
  const candidates = ['powershell.exe', 'pwsh.exe'];
  for (const name of candidates) {
    try {
      const ps = spawnSync('where.exe', [name] as string[], {
        encoding: 'utf-8', timeout: 5_000, windowsHide: true,
      }) as { status: number | null; stdout: string };
      if (ps.status === 0 && ps.stdout?.trim()) {
        const first = ps.stdout.trim().split(/\r?\n/)[0]!.trim();
        if (first && fs.existsSync(first)) return first;
      }
    } catch {
      /* fallthrough */
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// P1-7（review）：Windows command line 转义（本层单点实现 + 单测）
// ---------------------------------------------------------------------------

/**
 * 标准 Windows argv quoting（CommandLineToArgvW 的反向算法）：
 *   · 无空白/引号 → 原样；否则整体加双引号；
 *   · 元素内的 `"` 前置（2n+1）个反斜杠；
 *   · 元素尾部的反斜杠序列双写（防被引号闭合吞掉）。
 */
export function quoteWindowsArg(arg: string): string {
  if (arg === '') return '""';
  // 标准（CommandLineToArgvW 反向）：空格/引号**或尾部反斜杠**需要引号包裹
  // （尾部 `\` 会被 CreateProcess 的解析吞掉，反引号闭合时尤其危险）。
  if (!/[\s"]/.test(arg) && !/\\$/.test(arg)) return arg;
  let out = '"';
  let backslashes = 0;
  for (const ch of arg) {
    if (ch === '\\') {
      backslashes += 1;
      continue;
    }
    if (ch === '"') {
      out += '\\'.repeat(backslashes * 2 + 1) + '"';
      backslashes = 0;
      continue;
    }
    out += '\\'.repeat(backslashes) + ch;
    backslashes = 0;
  }
  out += '\\'.repeat(backslashes * 2);
  out += '"';
  return out;
}

/** direct CreateProcess 的命令行：各元素标准 quoting 后空格连接。 */
export function buildDirectCommandLine(argv: string[]): string {
  return argv.map(quoteWindowsArg).join(' ');
}

/**
 * cmd shim **解包**（二轮 review P1）：不再经 `cmd.exe /S /C` 执行 shim——cmd 的
 * `%VAR%` 展开在引号内仍生效且无可靠转义（实测 `%%` 双写会被 cmd 折叠后展开，
 * 参数无法无损）。改为把 npm 生成的 .cmd/.bat 解包成**直接可 CreateProcess**
 * 的目标，全链路走 direct（不经 cmd 解析器，argv 无损）：
 *   · exe 形态（npm v11+ / Claude 系）：`"%dp0%\node_modules\...\bin\<name>.exe" %*`
 *     → 提取 exe 绝对路径，args 原样透传；
 *   · node 形态（传统 npm shim）：`"%_prog%"  "%dp0%\node_modules\...\cli.js" %*`
 *     → node.exe（dp0\node.exe 存在优先，否则 PATH）+ 入口 js，node direct 执行；
 *   · 其它形态 → null（调用方 fail-closed，不堆叠字符转义规则）。
 */
export interface UnpackedCmdInvocation {
  /** CreateProcess 的直接目标（exe 或 node.exe，绝对路径）。 */
  file: string;
  /** 目标自身的固定参数（node 形态时=[入口 js]；exe 形态=[]），原 argv 附加在后。 */
  entryArgs: string[];
}

function expandDp0(s: string, shimDir: string): string {
  return s.replace(/%~?dp0%/gi, shimDir);
}

export interface ResolvedAgentCommand {
  /** CreateProcess 的 lpApplicationName（绝对路径；shim 解包后=目标 exe/node 绝对路径）。 */
  appName: string;
  /** 最终命令行（本层已完成转义，全 direct 形态）。 */
  commandLine: string;
}

function resolveNodeExe(shimDir: string, progRaw: string): string | null {
  const expanded = expandDp0(progRaw.trim(), shimDir);
  if (/^node(\.exe)?$/i.test(expanded)) {
    const r = spawnSync('where.exe', ['node.exe'], {
      encoding: 'utf-8', shell: false, windowsHide: true, timeout: 10_000,
    }) as { stdout: string };
    const hit = (r.stdout ?? '').split(/\r?\n/).map((l) => l.trim())
      .find((p) => /\.exe$/i.test(p) && fs.existsSync(p));
    return hit ?? null;
  }
  if (fs.existsSync(expanded)) return expanded;
  return null;
}

export function unpackCmdShim(shimPath: string): UnpackedCmdInvocation | null {
  let text: string;
  try {
    text = fs.readFileSync(shimPath, 'utf-8');
  } catch {
    return null;
  }
  const shimDir = path.dirname(shimPath);
  // _prog 语义（传统形态）：按 shim 的 `IF EXIST "%dp0%\node.exe"` 分支模拟——
  // dp0 下 node.exe 存在 → %dp0%\node.exe；否则 PATH node（else 分支 SET _prog=node）。
  const progRaw = fs.existsSync(path.join(shimDir, 'node.exe'))
    ? path.join(shimDir, 'node.exe')
    : 'node';

  // 执行行：含 %* 的引号引用行（`&` 分段取最后一段——npm shim 的
  // `endLocal & ... || title %COMSPEC% & "<prog>" "<entry>" %*`）
  let execLine = '';
  for (const line of text.split(/\r?\n/)) {
    if (!/%\s*\*/.test(line)) continue;
    if (!/"(?:%_prog%|%_prog%|%~?dp0%|%dp0%)/i.test(line)) continue;
    const tail = line.split('&').pop()!.trim();
    if (tail) {
      execLine = tail;
      break;
    }
  }
  if (!execLine) return null;
  const beforeStar = execLine.replace(/%\s*\*.*$/, '').trim();
  const toks: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(beforeStar)) !== null) {
    toks.push(m[1] ?? m[2]);
  }
  if (toks.length === 0) return null;
  const prog = toks[0]!;
  // exe 形态：program 含 .exe/.com 且实际存在 → direct，无 entry
  if (/\.(exe|com)$/i.test(prog)) {
    const file = path.resolve(shimDir, expandDp0(prog, shimDir));
    if (!fs.existsSync(file)) return null;
    return { file, entryArgs: [] };
  }
  // node 形态：program=_prog（node），entry=第二个 token（入口 js）
  if (/^%?_?prog%?$/i.test(prog) || /node(\.exe)?$/i.test(prog.split('\\').pop() ?? '')) {
    if (toks.length < 2) return null;
    const node = resolveNodeExe(shimDir, progRaw ?? 'node');
    if (!node) return null;
    const entryRaw = toks[1]!;
    const entry = path.resolve(shimDir, expandDp0(entryRaw, shimDir));
    if (!fs.existsSync(entry)) return null;
    return { file: node, entryArgs: [entry] };
  }
  return null;
}

/**
 * 解析 argv[0] 并产出可执行的 CreateProcess 形态：
 *   · 存在的 .exe/.com → direct；
 *   · 存在的 .cmd/.bat → 尝试**安全解包**（仅 npm 标准两形态），失败 fail-closed
 *     （绝不退化 cmd /C 字符转义堆叠）；
 *   · 裸命令名 → where.exe（只接受可执行扩展名——无扩展裸文件 CreateProcess
 *     会报 193 ERROR_BAD_EXE_FORMAT，实测）。
 */
export function resolveAgentCommand(argv: string[]): ResolvedAgentCommand | { error: string } {
  const binary0 = argv[0] ?? '';
  if (!binary0.trim()) return { error: 'agent argv 为空' };
  const rest = argv.slice(1);

  const existing = (p: string): boolean => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  };
  if (existing(binary0)) {
    const abs = path.resolve(binary0);
    if (/\.(cmd|bat)$/i.test(abs)) {
      const unpacked = unpackCmdShim(abs);
      if (!unpacked) {
        return {
          error:
            `cmd shim 无法安全解包（不支持该形态，fail-closed）：${abs}——` +
            '请给 adapter 配可执行 exe 的 headless_invoke，或升级 shim 到 npm 标准形态',
        };
      }
      const argv2 = [unpacked.file, ...unpacked.entryArgs, ...rest];
      return { appName: unpacked.file, commandLine: buildDirectCommandLine(argv2) };
    }
    return { appName: abs, commandLine: buildDirectCommandLine([abs, ...rest]) };
  }

  // 裸命令名（npm shim / PATH 解析）
  const where = spawnSync('where.exe', [binary0], {
    encoding: 'utf-8', shell: false, windowsHide: true, timeout: 10_000,
  });
  const hits = (where.stdout ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && existing(l));
  const exeHit = hits.find((l) => /\.(exe|com)$/i.test(l));
  if (exeHit) {
    return { appName: path.resolve(exeHit), commandLine: buildDirectCommandLine([path.resolve(exeHit), ...rest]) };
  }
  const shimHit = hits.find((l) => /\.(cmd|bat)$/i.test(l));
  if (shimHit) {
    const unpacked = unpackCmdShim(shimHit);
    if (!unpacked) {
      return {
        error:
          `cmd shim 无法安全解包（不支持该形态，fail-closed）：${shimHit}——` +
          '请给 adapter 配可执行 exe 的 headless_invoke，或升级 shim 到 npm 标准形态',
      };
    }
    const argv2 = [unpacked.file, ...unpacked.entryArgs, ...rest];
    return { appName: unpacked.file, commandLine: buildDirectCommandLine(argv2) };
  }
  return { error: `agent binary 无法解析（文件不存在且 PATH 无 .exe/.cmd/.bat）：${binary0}` };
}

export function encodeAgentJson(spec: GuardianAgentSpec): string {
  const json = JSON.stringify(spec);
  return Buffer.from(json, 'utf-16le').toString('base64');
}

export function decodeAgentJson(encoded: string): GuardianAgentSpec {
  const json = Buffer.from(encoded, 'base64').toString('utf-16le');
  const spec = JSON.parse(json) as GuardianAgentSpec;
  if (!Array.isArray(spec.argv) || spec.argv.length < 1) {
    throw new Error('guardian agent spec 缺少 argv');
  }
  if (typeof spec.cwd !== 'string' || !spec.cwd.trim()) {
    throw new Error('guardian agent spec 缺少 cwd');
  }
  if (typeof spec.commandLine !== 'string' || !spec.commandLine.trim()) {
    throw new Error('guardian agent spec 缺少 commandLine');
  }
  if (typeof spec.appName !== 'string' || !spec.appName.trim()) {
    throw new Error('guardian agent spec 缺少 appName');
  }
  return spec;
}

/** guardian 脚本到位检查：脚本缺失 = containment 结构性不可用，调用方须 fail-closed。 */
export function guardianScriptAvailable(): boolean {
  return fs.existsSync(GUARDIAN_SCRIPT_PATH);
}

/**
 * 构造 guardian 调用（win32 专用）。身份 token 明文进 argv（t3 接管核验的唯一
 * argv 通道）；agent 命令行由本层完成转义（P1-7 review 单点）。
 */
export function buildGuardianInvocation(
  spec: GuardianAgentSpec,
  runnerPid: number,
  token: string,
): GuardianInvocation | { error: string } {
  if (process.platform !== 'win32') {
    return { error: `agent containment 仅支持 win32（当前 ${process.platform}）` };
  }
  const ps = resolvePowerShellExe();
  if (!ps) {
    return { error: '无法解析 powershell.exe（containment 需要的 P/Invoke guardian 不可用）' };
  }
  if (!guardianScriptAvailable()) {
    return { error: `guardian 脚本缺失：${GUARDIAN_SCRIPT_PATH}（containment 结构性不可用）` };
  }
  const encoded = encodeAgentJson(spec);
  return {
    file: ps,
    args: [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', GUARDIAN_SCRIPT_PATH,
      '-RunnerPid', String(runnerPid),
      '-Token', token,
      '-AgentJson', encoded,
    ],
    agentJsonEncoded: encoded,
  };
}