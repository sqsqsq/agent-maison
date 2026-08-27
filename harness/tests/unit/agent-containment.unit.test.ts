// ============================================================================
// agent-containment.unit.test.ts — plan c6a9e4d2 t2/t3（Windows containment +
// controlled takeover 的 Node 侧契约）
// ============================================================================
// 覆盖：
//   · guardian 调用装帧（token 明文进 argv / AgentJson 往返 / 平台门）
//   · Windows command line 转义（P1-7：标准 quoting；cmd shim **解包**到 direct
//     目标——二轮 review：%VAR% 在 cmd /C 引号内仍会展开且 %% 转义不可靠，故
//     不再经 cmd 执行；解包失败 fail-closed）
//   · 接管对账矩阵（P0-1 **逐一对账全部未闭合绑定** / orphan_reclaimed 闭合 /
//     P1-4 legacy 只认未闭合 invoke；二轮 review P0：identify null ≠ 死亡证明，
//     死亡判定走独立 PID existence 通道）
//   · goal-supervise 受控 force 行为测试（进程内 main + 注入探针/spawn）
//   · 真实进程行为：经真实 guardian 的 argv 回显无损；真实活进程 + identify 恒
//     null 不得误判死亡
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  buildGuardianInvocation,
  decodeAgentJson,
  encodeAgentJson,
  guardianToken,
  quoteWindowsArg,
  buildDirectCommandLine,
  unpackCmdShim,
  resolveAgentCommand,
} from '../../scripts/utils/agent-containment';
import {
  awaitGuardianGone,
  findUnclosedGuardianBounds,
  identifyWithRetry,
  pidExists,
  reconcileGuardianOwnership,
  unclosedAgentInvokeCount,
  hasAnyGuardianBoundEvent,
  terminateGuardianProcessOnly,
  __testing_setPidProbeExecutor,
  type GuardianBoundRecord,
} from '../../scripts/utils/goal-containment-reconcile';
import type { ProcessProbe } from '../../scripts/utils/device-session';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

/** 可控探针：按表返回身份（默认 pid 不存在）。 */
function makeProbe(
  table: Record<number, { startedAtMs: number; executable: string; commandLine?: string } | null> = {},
): ProcessProbe {
  return {
    identify(pid: number) {
      const hit = table[pid];
      if (!hit) return null;
      const out: { pid: number; startedAtMs: number; executable: string; commandLine?: string } = {
        pid,
        startedAtMs: hit.startedAtMs,
        executable: hit.executable,
      };
      if (hit.commandLine !== undefined) out.commandLine = hit.commandLine;
      return out;
    },
    killTree() {
      return true;
    },
  };
}

function bound(partial: Partial<GuardianBoundRecord> = {}): Record<string, unknown> {
  return {
    ts: '2026-08-18T00:00:00.000Z',
    type: 'agent_process_bound',
    phase: 'coding',
    invoke_id: 'i1',
    run_id: 'r1',
    pid: 4242,
    started_at_ms: 1723953600000,
    executable: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    token: 'r1/i1',
    ...partial,
  };
}

const EXE = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';

/** npm 风格 shim 的两种标准形态（内联真实文本，2026-08-19 宿主实测） */
const SHIM_EXE_FORM = `@ECHO off
GOTO start
:find_dp0
SET dp0=%~dp0
EXIT /b
:start
SETLOCAL
CALL :find_dp0
"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*
`;
const SHIM_NODE_FORM = `@ECHO off
GOTO start
:find_dp0
SET dp0=%~dp0
EXIT /b
:start
SETLOCAL
CALL :find_dp0

IF EXIST "%dp0%\\node.exe" (
  SET "_prog=%dp0%\\node.exe"
) ELSE (
  SET "_prog=node"
  SET PATHEXT=%PATHEXT:;.JS;=;%
)

endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@fission-ai\\openspec\\bin\\openspec.js" %*
`;

const cases: Array<{ name: string; run: () => void | Promise<void> }> = [
  {
    name: 't2: guardian 装帧——token 明文进 argv、AgentJson 往返无损、cwd 携带',
    run: () => {
      const spec = {
        argv: ['claude', '-p', '--output-format', 'stream-json'],
        cwd: 'D:\\proj',
        commandLine: '"C:\\x\\claude.exe" -p --output-format stream-json',
        appName: 'C:\\x\\claude.exe',
      };
      const inv = buildGuardianInvocation(spec, 777, 'runA/invB');
      if ('error' in inv) throw new Error(inv.error);
      const joined = inv.args.join(' ');
      assert(joined.includes('-Token'), 'argv 缺 -Token');
      assert(joined.includes('runA/invB'), 'token 未明文进 argv');
      assert(inv.file.toLowerCase().includes('powershell'), `file=${inv.file}`);
      const decoded = decodeAgentJson(inv.agentJsonEncoded);
      assert(decoded.argv.join('|') === spec.argv.join('|'), 'argv 往返失败');
      assert(decoded.cwd === spec.cwd, 'cwd 往返失败');
      assert(decoded.commandLine === spec.commandLine, 'commandLine 往返失败');
      assert(decoded.appName === spec.appName, 'appName 往返失败');
      assert(guardianToken('runA', 'invB') === 'runA/invB', 'token 合成不一致');
    },
  },
  {
    name: 't2: guardian 装帧——脚本必须随发布件齐备（containment 结构性可用）',
    run: () => {
      const scriptPath = path.join(__dirname, '../../scripts/utils/agent-guardian.ps1');
      assert(fs.existsSync(scriptPath), `guardian 脚本缺失：${scriptPath}`);
      const head = fs.readFileSync(scriptPath, 'utf-8');
      assert(head.includes('KILL_ON_JOB_CLOSE'), 'guardian 缺少 KILL_ON_JOB_CLOSE 语义');
      assert(head.includes('CREATE_SUSPENDED'), 'guardian 缺少 CREATE_SUSPENDED 语义');
      assert(head.includes('AssignProcessToJobObject'), 'guardian 缺少 assign-before-resume 语义');
      // P1-6：runner handle 必须先于 CreateProcess（guardian 不得在 agent resume
      // 后才按 PID 开 runner——有 PID 重用竞态）。定位**调用点**排除 DllImport
      // 声明顺序干扰。
      const callOpen = head.indexOf('[MaisonGuardian.Native]::OpenProcess');
      const callCreate = head.indexOf('[MaisonGuardian.Native]::CreateProcessW(');
      assert(callOpen >= 0 && callCreate >= 0, `调用点缺失 open=${callOpen} create=${callCreate}`);
      assert(callOpen < callCreate, 'runner OpenProcess 调用必须先于 CreateProcessW 调用');
    },
  },
  {
    name: 'P1-7: quoteWindowsArg 标准算法（空格/引号/尾部反斜杠/引号前反斜杠）',
    run: () => {
      const table: Array<[string, string]> = [
        ['plain', 'plain'],
        ['', '""'],
        ['a b', '"a b"'],
        ['a"b', '"a\\"b"'],
        ['a\\', '"a\\\\"'],
        ['a\\\\', '"a\\\\\\\\"'],
        ['a\\\\"b', '"a\\\\\\\\\\"b"'],
        ['C:\\Program Files\\claude.cmd', '"C:\\Program Files\\claude.cmd"'],
      ];
      for (const [input, expected] of table) {
        const actual = quoteWindowsArg(input);
        assert(actual === expected, `quoteWindowsArg(${JSON.stringify(input)}) => ${actual}，期望 ${expected}`);
      }
      const direct = buildDirectCommandLine(['C:\\a b\\tool.exe', '--flag= x', 'plain']);
      assert(direct === '"C:\\a b\\tool.exe" "--flag= x" plain', `direct=${direct}`);
    },
  },
  {
    name: 'P1-7: cmd shim **解包**（二轮 review）——exe 形态 / node 形态 / 不支持形态 fail-closed',
    run: () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-shim-'));
      try {
        // exe 形态（claude.cmd 实测形态）→ 提取 exe 绝对路径，entryArgs=[]
        const exeShim = path.join(tmp, 'claude.cmd');
        fs.writeFileSync(exeShim, SHIM_EXE_FORM, 'utf-8');
        const nodeModules = path.join(tmp, 'node_modules', '@anthropic-ai', 'claude-code', 'bin');
        fs.mkdirSync(nodeModules, { recursive: true });
        fs.writeFileSync(path.join(nodeModules, 'claude.exe'), 'MZ stub', 'binary');
        const exeUnpacked = unpackCmdShim(exeShim);
        if (!exeUnpacked) throw new Error('exe 形态 shim 解包失败');
        assert(exeUnpacked.file.toLowerCase().endsWith('claude.exe'), `file=${exeUnpacked.file}`);
        assert(exeUnpacked.entryArgs.length === 0, 'exe 形态无 entry args');

        // 传统 node 形态（openspec.cmd 实测形态；dp0 无 node.exe → _prog=node → PATH）
        const nodeShim = path.join(tmp, 'openspec.cmd');
        fs.writeFileSync(nodeShim, SHIM_NODE_FORM, 'utf-8');
        const openspecJs = path.join(tmp, 'node_modules', '@fission-ai', 'openspec', 'bin', 'openspec.js');
        fs.mkdirSync(path.dirname(openspecJs), { recursive: true });
        fs.writeFileSync(openspecJs, 'console.log("x")', 'utf-8');
        const nodeUnpacked = unpackCmdShim(nodeShim);
        if (!nodeUnpacked) throw new Error('node 形态 shim 解包失败');
        assert(/node(\.exe)?$/i.test(nodeUnpacked.file), `node 形态 file 应为 node：${nodeUnpacked.file}`);
        assert(fs.existsSync(nodeUnpacked.file), 'resolved node 必须存在');
        assert(nodeUnpacked.entryArgs.length === 1 && nodeUnpacked.entryArgs[0].endsWith('openspec.js'),
          `entry=${nodeUnpacked.entryArgs.join(',')}`);

        // 不支持形态（自定义 bat：无 %* 引用行）→ null（fail-closed）
        const weird = path.join(tmp, 'weird.bat');
        fs.writeFileSync(weird, '@echo off\nchcp 65001 >nul\necho hello\n', 'utf-8');
        const bad = unpackCmdShim(weird);
        assert(bad === null, '不支持形态必须解包失败（fail-closed）');
      } finally {
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
      }
    },
  },
  {
    name: 'P1-7: resolveAgentCommand——exe direct；裸 claude 经 shim 解包为 claude.exe direct（无 cmd 包裹）',
    run: () => {
      if (process.platform !== 'win32') return;
      const r = resolveAgentCommand(['claude', '--version']);
      if ('error' in r) throw new Error(r.error);
      assert(r.appName.toLowerCase().endsWith('claude.exe'), `应解包到 claude.exe：${r.appName}`);
      assert(!r.appName.toLowerCase().endsWith('cmd.exe'), '不得再经 cmd /C 包裹');
      const r2 = resolveAgentCommand([EXE, '-NoProfile', '-Command', 'x']);
      if ('error' in r2) throw new Error(r2.error);
      assert(r2.appName.toLowerCase() === EXE.toLowerCase(), `appName=${r2.appName}`);
      const r3 = resolveAgentCommand(['definitely-not-a-real-cmd-xyz-12345']);
      assert('error' in r3, '不可解析 binary 必须显式报错（fail-closed）');
    },
  },
  {
    name: 't3: 对账矩阵——无 invoke / 已 settled 闭合 → 无未闭合绑定',
    run: () => {
      const r1 = reconcileGuardianOwnership(
        [{ type: 'run_start' }, { type: 'run_end', status: 'COMPLETED' }],
        makeProbe({}),
      );
      assert(r1.kind === 'no_unclosed_bounds', `r1=${r1.kind}`);
      const r2 = reconcileGuardianOwnership(
        [bound({}), { ...bound(), type: 'agent_process_settled' }],
        makeProbe({}),
      );
      assert(r2.kind === 'no_unclosed_bounds', `r2=${r2.kind}`);
      assert(findUnclosedGuardianBounds([]).length === 0, '空 events 无未闭合');
    },
  },
  {
    name: 't3: orphan_reclaimed 也是闭合事件（reclaimed 后不再进入对账）',
    run: () => {
      const events = [
        bound({}),
        { ...bound(), type: 'orphan_reclaimed', method: 'terminate_job_owner' },
      ];
      assert(findUnclosedGuardianBounds(events).length === 0, 'orphan_reclaimed 未闭合 bound');
      const r = reconcileGuardianOwnership(
        events,
        makeProbe({ 4242: { startedAtMs: 1723953600000, executable: EXE, commandLine: 'powershell -Token r1/i1' } }),
        () => true,
      );
      assert(r.kind === 'no_unclosed_bounds', `reclaimed 后仍有处置：${r.kind}`);
    },
  },
  {
    name: 'P1-4: legacy 只认未闭合 invoke——已闭合旧 run 可正常恢复；未闭合旧 invoke 仍 fail-closed',
    run: () => {
      const closedLegacy = [
        { type: 'run_start' },
        { type: 'agent_invoke_start', phase: 'coding', invoke_id: 'i9' },
        { type: 'agent_invoke_end', phase: 'coding', invoke_id: 'i9', exit_code: 1 },
      ];
      assert(unclosedAgentInvokeCount(closedLegacy) === 0, '闭合 invoke 不得计入未闭合');
      assert(hasAnyGuardianBoundEvent(closedLegacy) === false, 'legacy 前提错误');
      const r = reconcileGuardianOwnership(closedLegacy, makeProbe({}));
      assert(r.kind === 'no_unclosed_bounds', `闭合旧 run 应可恢复：${r.kind}`);

      const openLegacy = [
        { type: 'run_start' },
        { type: 'agent_invoke_start', phase: 'coding', invoke_id: 'i9' },
      ];
      assert(unclosedAgentInvokeCount(openLegacy) === 1, '未闭合 invoke 计数错误');
      const r2 = reconcileGuardianOwnership(openLegacy, makeProbe({}));
      assert(r2.kind === 'legacy_run', `未闭合旧 invoke 应 legacy：${r2.kind}`);
      const recovered = [
        { type: 'run_start' },
        { type: 'agent_invoke_start', phase: 'coding', invoke_id: 'i9' },
        { type: 'agent_invoke_recovered', phase: 'coding', invoke_id: 'i9' },
      ];
      assert(unclosedAgentInvokeCount(recovered) === 0, 'recovered 应闭合 invoke');
    },
  },
  {
    name: 'P0-1: 多个未闭合 guardian **逐一对账**——old 匹配存活 + new 消失两项都返回，不只看最后一个',
    run: () => {
      const events = [
        bound({ invoke_id: 'old-invoke', pid: 1111, started_at_ms: 1111000, token: 'r1/old-invoke' }),
        bound({ invoke_id: 'new-invoke', pid: 2222, started_at_ms: 2222000, token: 'r1/new-invoke' }),
      ];
      const probe = makeProbe({
        1111: { startedAtMs: 1111000, executable: EXE, commandLine: 'powershell -Token r1/old-invoke -AgentJson AAA' },
        // 2222 identify null（配合 existsProbe 只承认 1111 → 2222 判 gone）
      });
      const r = reconcileGuardianOwnership(events, probe, (pid) => pid === 1111);
      assert(r.kind === 'outcomes', `kind=${r.kind}`);
      if (r.kind !== 'outcomes') return;
      assert(r.items.length === 2, `应逐一对账 2 条，实得 ${r.items.length}`);
      const kinds = r.items.map((i) => i.kind);
      assert(kinds.includes('guardian_alive_matching'), `old 未被识别为匹配存活：${kinds.join(',')}`);
      assert(kinds.includes('guardian_gone'), `new 未被识别为已消失：${kinds.join(',')}`);
    },
  },
  {
    name: '二轮 review P1: 经真实 guardian 的 argv 回显无损（%VAR%/空/空格/引号/尾反斜杠/&|<>^()!）',
    run: () => {
      if (process.platform !== 'win32') return;
      const { spawn } = require('child_process') as typeof import('child_process');
      const script = `const d = JSON.stringify(process.argv.slice(1)); require('fs').writeFileSync(process.env.MAISON_ECHO_OUT, d);`;
      const echoOut = path.join(os.tmpdir(), `maison-echo-${process.pid}.json`);
      process.env.MAISON_ECHO_OUT = echoOut;
      try {
        const argv = [
          'a%MAISON_QTEST%b', '', 'sp ace', 'q"uote', 'trailing\\',
          'a&b|c<d>e^f(g)!h', 'C:\\Program Files\\x',
        ];
        const nodeExe = process.execPath;
        const resolved = resolveAgentCommand([nodeExe, '-e', script, ...argv]);
        if ('error' in resolved) throw new Error(resolved.error);
        const spec = {
          argv: [nodeExe, '-e', script, ...argv],
          cwd: os.tmpdir(),
          commandLine: resolved.commandLine,
          appName: resolved.appName,
        };
        const enc = encodeAgentJson(spec);
        const g = spawn('powershell.exe', [
          '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
          '-File', path.join(__dirname, '../../scripts/utils/agent-guardian.ps1'),
          '-RunnerPid', String(process.pid), '-Token', 'echo/t1', '-AgentJson', enc,
        ], { cwd: os.tmpdir(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        g.stderr.on('data', (d: Buffer) => console.error('GERR ' + String(d)));
        const sleepBuf = new Int32Array(new SharedArrayBuffer(4));
        let waited = 0;
        while (!fs.existsSync(echoOut) && waited < 20000) {
          Atomics.wait(sleepBuf, 0, 0, 200);
          waited += 200;
        }
        if (!fs.existsSync(echoOut)) throw new Error('回显未落盘（guardian 链失败）');
        const echoed = JSON.parse(fs.readFileSync(echoOut, 'utf-8')) as string[];
        for (let i = 0; i < argv.length; i++) {
          if (echoed[i] !== argv[i]) {
            throw new Error(`argv[${i}]=${JSON.stringify(echoed[i])} ≠ 期望 ${JSON.stringify(argv[i])}`);
          }
        }
        assert(!echoed.includes('EXPANDED'), `%MAISON_QTEST% 被展开：${JSON.stringify(echoed)}`);
      } finally {
        delete process.env.MAISON_ECHO_OUT;
        try { fs.rmSync(echoOut, { force: true }); } catch { /* best-effort */ }
      }
    },
  },
  {
    name: '二轮 review P0: 真实活进程 + identify 恒 null → 未证明死亡（不判 gone、不 HALT 放行）',
    run: () => {
      if (process.platform !== 'win32') return;
      const { spawn } = require('child_process') as typeof import('child_process');
      const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000);'], {
        stdio: 'ignore', windowsHide: true,
      });
      const pid = child.pid!;
      try {
        const blindProbe: ProcessProbe = {
          identify() {
            return null;
          },
          killTree() {
            return true;
          },
        };
        // 1) awaitGuardianGone 默认通道（独立 PID existence）必须判「未消失」
        const gone = awaitGuardianGone(pid, pidExists, 3, 50);
        assert(gone === false, '活进程不得被误判为已死亡');
        // 2) reconcile classify：进程存在 + identify null → identity_unverifiable，非 gone
        const events = [bound({ pid, started_at_ms: Date.now() - 1000, token: 'r1/i9' })];
        const r = reconcileGuardianOwnership(events, blindProbe, pidExists);
        assert(r.kind === 'outcomes', `kind=${r.kind}`);
        if (r.kind !== 'outcomes') return;
        assert(r.items[0].kind === 'guardian_identity_unverifiable',
          `identify null 但进程活：不得判 gone，实得 ${r.items[0].kind}`);
        // 3) 确认 destroy 后同一探测链判定消失（正路径仍通）
        child.kill('SIGKILL');
        const sleepBuf = new Int32Array(new SharedArrayBuffer(4));
        let dead = false;
        for (let i = 0; i < 40 && !dead; i++) {
          Atomics.wait(sleepBuf, 0, 0, 100);
          dead = !pidExists(pid);
        }
        assert(dead, '真实死亡必须被确定性捕获');
      } finally {
        try { child.kill('SIGKILL'); } catch { /* already dead */ }
      }
    },
  },
  {
    name: 't3: 对账矩阵——guardian 确定性不存在（existsProbe=false）→ guardian_gone',
    run: () => {
      const r = reconcileGuardianOwnership([bound({})], makeProbe({}), () => false);
      assert(r.kind === 'outcomes', `kind=${r.kind}`);
      if (r.kind !== 'outcomes') return;
      assert(r.items[0].kind === 'guardian_gone', `kind=${r.items[0].kind}`);
      // 存在但 identify 全 null → 也不得 gone（CIM 不可得 ≠ 死亡）
      const r2 = reconcileGuardianOwnership([bound({})], makeProbe({}), () => true);
      assert(r2.kind === 'outcomes' && r2.items[0].kind === 'guardian_identity_unverifiable',
        `CIM null+进程存在 不得判 gone：${r2.kind}`);
    },
  },
  {
    name: 't3: 对账矩阵——四元组严格匹配且存活 → guardian_alive_matching（仅此可回收）',
    run: () => {
      const probe = makeProbe({
        4242: {
          startedAtMs: 1723953600000,
          executable: EXE,
          commandLine: 'powershell.exe -File agent-guardian.ps1 -RunnerPid 9 -Token r1/i1 -AgentJson AAAA',
        },
      });
      const r = reconcileGuardianOwnership([bound({})], probe, () => true);
      assert(r.kind === 'outcomes', `kind=${r.kind}`);
      if (r.kind !== 'outcomes') return;
      assert(r.items[0].kind === 'guardian_alive_matching', `kind=${r.items[0].kind}`);
    },
  },
  {
    name: 't3: 对账矩阵——PID 重用/可执行文件不符/命令行不可读/缺 token 均不可回收',
    run: () => {
      const exists = (): boolean => true;
      const r1 = reconcileGuardianOwnership(
        [bound({})],
        makeProbe({ 4242: { startedAtMs: 999999999999, executable: EXE, commandLine: '-Token r1/i1' } }),
        exists,
      );
      if (r1.kind !== 'outcomes' || r1.items[0].kind !== 'guardian_identity_unverifiable') {
        throw new Error(`PID 重用未拒：${r1.kind}`);
      }
      const r2 = reconcileGuardianOwnership(
        [bound({})],
        makeProbe({ 4242: { startedAtMs: 1723953600000, executable: 'C:\\evil\\fake.exe', commandLine: '-Token r1/i1' } }),
        exists,
      );
      if (r2.kind !== 'outcomes' || r2.items[0].kind !== 'guardian_identity_unverifiable') {
        throw new Error(`exe 不符未拒：${r2.kind}`);
      }
      const r3 = reconcileGuardianOwnership(
        [bound({})],
        makeProbe({ 4242: { startedAtMs: 1723953600000, executable: EXE } }),
        exists,
      );
      if (r3.kind !== 'outcomes' || r3.items[0].kind !== 'guardian_identity_unverifiable') {
        throw new Error(`命令行不可读未拒：${r3.kind}`);
      }
      const r4 = reconcileGuardianOwnership(
        [bound({})],
        makeProbe({ 4242: { startedAtMs: 1723953600000, executable: EXE, commandLine: 'powershell -OtherToken' } }),
        exists,
      );
      if (r4.kind !== 'outcomes' || r4.items[0].kind !== 'guardian_identity_unverifiable') {
        throw new Error(`缺 token 未拒：${r4.kind}`);
      }
    },
  },
  {
    name: 'P0-2: identifyWithRetry 有界重试（CIM 渐进可见）',
    run: () => {
      let calls = 0;
      const probe: ProcessProbe = {
        identify() {
          calls += 1;
          if (calls < 3) return null;
          return { pid: 1, startedAtMs: 1723953600000, executable: EXE, commandLine: '-Token t' };
        },
        killTree() {
          return true;
        },
      };
      const hit = identifyWithRetry(1, probe, 5, 1);
      assert(hit !== null, '第 3 次应可见');
      assert(calls === 3, `应恰好重试到第 3 次，实得 ${calls}`);
      let neverCalls = 0;
      const neverProbe: ProcessProbe = {
        identify() {
          neverCalls += 1;
          return null;
        },
        killTree() {
          return true;
        },
      };
      const miss = identifyWithRetry(2, neverProbe, 4, 1);
      assert(miss === null, '始终不可见应返回 null');
      assert(neverCalls === 4, `应恰好尝试 4 次，实得 ${neverCalls}`);
    },
  },
  {
    name: '三轮 review P0: pidExists 探针失败/超时 → 保守存疑（活进程不得判死亡）',
    run: () => {
      try {
        // spawnSync 启动失败形态（error + status=null + 空 stdout）→ 必须 true
        __testing_setPidProbeExecutor(() => ({ error: new Error('spawn ENOENT'), status: null, stdout: '' }));
        assert(pidExists(12345) === true, 'error 形态必须保守存疑');
        // 超时形态（status=null，无 error）→ 必须 true
        __testing_setPidProbeExecutor(() => ({ status: null, stdout: '' }));
        assert(pidExists(12345) === true, 'status=null 超时形态必须保守存疑');
        // status=1 属「查询完成但非零」——与脚本执行失败同形（策略拦截/cmdlet 异常
        // 都 exit 1），**不得**当作不存在证明 → 保守存疑
        __testing_setPidProbeExecutor(() => ({ status: 1, stdout: '' }));
        assert(pidExists(12345) === true, 'status=1 + 空输出必须保守存疑');
        __testing_setPidProbeExecutor(() => ({ status: 1, stdout: 'ABSENT' }));
        assert(pidExists(12345) === true, '非零退出即使 stdout=ABSENT 也保守存疑');
        // 四轮 review P0：显式 ABSENT 契约——只有 status=0 + stdout 精确 ABSENT 才判不存在
        __testing_setPidProbeExecutor(() => ({ status: 0, stdout: 'ABSENT' }));
        assert(pidExists(12345) === false, 'status=0 + ABSENT → 确定性不存在');
        __testing_setPidProbeExecutor(() => ({ status: 0, stdout: 'PRESENT:12345' }));
        assert(pidExists(12345) === true, 'status=0 + PRESENT:<pid> → 存在');
        // 畸形/空输出（status=0）→ 无法确定性否定 → 保守存疑
        __testing_setPidProbeExecutor(() => ({ status: 0, stdout: '' }));
        assert(pidExists(12345) === true, 'status=0 空输出必须保守存疑');
        __testing_setPidProbeExecutor(() => ({ status: 0, stdout: 'garbage!!' }));
        assert(pidExists(12345) === true, '畸形输出必须保守存疑');
        __testing_setPidProbeExecutor(() => ({ status: 0, stdout: '99999' }));
        assert(pidExists(12345) === true, '非 ABSENT 输出（旧形态 PID 行）保守存疑');
      } finally {
        __testing_setPidProbeExecutor(null);
      }
    },
  },
  {
    name: '三轮 review P0: 真实活进程 + 探针执行失败 → pidExists 仍 true（不误判死亡）',
    run: () => {
      if (process.platform !== 'win32') return;
      const { spawn } = require('child_process') as typeof import('child_process');
      const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000);'], {
        stdio: 'ignore', windowsHide: true,
      });
      const pid = child.pid!;
      try {
        try {
          __testing_setPidProbeExecutor(() => ({ error: new Error('spawn ENOENT'), status: null, stdout: '' }));
          assert(pidExists(pid) === true, '探针启动失败不得把活进程判死亡');
          __testing_setPidProbeExecutor(() => ({ status: null, stdout: '' }));
          assert(pidExists(pid) === true, '探针超时不得把活进程判死亡');
        } finally {
          __testing_setPidProbeExecutor(null);
        }
        // 默认执行器（真实 Get-Process）→ 活进程 = 存在
        assert(pidExists(pid) === true, '默认探针须确认活进程存在');
      } finally {
        try { child.kill('SIGKILL'); } catch { /* already dead */ }
      }
    },
  },
  {
    name: 't3: 终止只发单进程（taskkill 无 /T）+ 杀后确认消失契约',
    run: () => {
      if (process.platform !== 'win32') return;
      assert(terminateGuardianProcessOnly(0) === false, 'pid=0 必须拒绝');
      const gone = awaitGuardianGone(99999999, pidExists, 2, 10);
      assert(gone, '不存在进程应确认消失');
    },
  },
  {
    name: 't3: goal-runner 接线——resume 对账逐项处置（legacy force 路径/settled 条件/收口）',
    run: () => {
      const src = fs.readFileSync(path.join(__dirname, '../../scripts/goal-runner.ts'), 'utf-8');
      assert(src.includes('reconcileGuardianOwnership(priorEvents, defaultProcessProbe())'), 'resume 对账未接线');
      assert(src.includes("type: 'orphan_reclaimed'"), 'orphan_reclaimed 事件缺失');
      assert(src.includes('terminateGuardianProcessOnly'), '匹配终止（单进程）未接线');
      assert(src.includes("type: 'agent_process_bound'"), 'agent_process_bound 事件缺失');
      assert(src.includes("type: 'agent_process_settled'"), 'agent_process_settled 事件缺失');
      assert(src.includes('for (const item of reconcile.items)'), '多未闭合逐项处置缺失');
      assert(src.includes("type: 'legacy_run_override'"), 'legacy force 确认事件缺失');
      const settledIdx = src.indexOf("type: 'agent_process_settled'");
      // adjudicated-repair-loop：resumePostAgent（跳过已 settled 的 agent）不再重复 emit——
      // settled 仍受 bound 成功约束（且 resumePostAgent 分支排除）
      const settledCondIdx = src.indexOf('if (containmentCtx && !guardianBoundError && !resumePostAgent)');
      const settledCondIdxLegacy = src.indexOf('if (containmentCtx && !guardianBoundError)');
      assert(
        (settledCondIdx >= 0 && settledCondIdx < settledIdx) ||
          (settledCondIdxLegacy >= 0 && settledCondIdxLegacy < settledIdx),
        'settled 未受 bound 成功条件约束',
      );
      assert(src.includes("concludeStartupBlocker('legacy_run_requires_manual_cleanup'"), 'legacy BLOCKER 未收口');
      assert(src.includes("concludeStartupBlocker('guardian_termination_failed'"), '杀不死 BLOCKER 未收口');
      const killTreeCallSites = src.match(/killProcessTree\(/g) ?? [];
      if (killTreeCallSites.length === 0) throw new Error('killProcessTree 调用点缺失（既有杀树路径回归）');
    },
  },
  {
    name: 'P1-3: goal-supervise 受控 force 行为测试——guardian gone 拉起带 --force-resume；owner 存活不拉起',
    run: async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-sup-force-'));
      const featDir = path.join(tmp, 'doc/features/f1');
      const runDir = path.join(featDir, 'goal-runs/20260101T000000Z');
      fs.mkdirSync(runDir, { recursive: true });
      fs.writeFileSync(path.join(runDir, 'manifest.json'), JSON.stringify({
        run_id: '20260101T000000Z',
        report_dir: 'doc/features/f1/goal-runs/20260101T000000Z',
      }), 'utf-8');
      const writeEvents = (rows: Array<Record<string, unknown>>): void => {
        fs.writeFileSync(
          path.join(runDir, 'events.jsonl'),
          rows.map((r) => JSON.stringify(r)).join('\n') + '\n',
          'utf-8',
        );
      };
      const writeControl = (
        kind: 'process' | 'session',
        state: 'active' | 'quiescing' | 'released' | 'orphaned_session',
      ): void => {
        fs.writeFileSync(path.join(runDir, 'run-control.json'), JSON.stringify({
          schema: 'run-control@1',
          run_id: '20260101T000000Z',
          current_epoch: 1,
          owner: {
            kind, owner_id: `test-${kind}`, epoch: 1, state,
            ...(kind === 'process'
              ? { pid: process.pid, hostname: os.hostname() }
              : { lease_expires_at: new Date(Date.now() + 60_000).toISOString() }),
          },
          updated_at: new Date().toISOString(),
        }, null, 2) + '\n', 'utf-8');
      };
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const supervise = require('../../scripts/goal-supervise') as typeof import('../../scripts/goal-supervise');
      const eventsPath = path.join(runDir, 'events.jsonl');
      const base = [
        { ts: '2026-01-01T00:00:00.000Z', type: 'run_start' },
        { ts: '2026-01-01T00:01:00.000Z', type: 'phase_verdict', phase: 'spec', verdict: 'PASS', action: 'advance' },
        { ts: '2026-01-01T00:02:00.000Z', type: 'phase_halt', phase: 'coding', halt_reason: 'backtrack_limit' },
        { ts: '2026-01-01T00:03:00.000Z', type: 'run_end', status: 'HALTED', halt_reason: 'backtrack_limit' },
      ];
      const prevArgv = process.argv;
      const runCli = async (): Promise<number> => {
        process.argv = ['node', 'goal-supervise.ts', '--feature', 'f1', '--project-root', tmp, '--run-id', '20260101T000000Z'];
        try {
          return await supervise.__testing_main();
        } finally {
          process.argv = prevArgv;
        }
      };
      try {
        writeControl('process', 'released');
        // 场景 1：未闭合 bound + probe 匹配身份 + PID existence 注入（存在）→ owner 存活 → 不拉起
        writeEvents([
          ...base,
          {
            ts: '2026-01-01T00:04:00.000Z', type: 'agent_process_bound', phase: 'coding',
            invoke_id: 'i1', run_id: '20260101T000000Z', pid: 5555, started_at_ms: 5555000,
            executable: EXE, token: '20260101T000000Z/i1',
          },
        ]);
        supervise.__testing_setProcessProbe(makeProbe({
          5555: { startedAtMs: 5555000, executable: EXE, commandLine: 'powershell -Token 20260101T000000Z/i1' },
        }));
        supervise.__testing_setPidExists(() => true);
        let spawned = 0;
        supervise.__testing_setSpawnImpl(() => {
          spawned += 1;
          return { pid: 12345, unref() {} };
        });
        const c1 = await runCli();
        assert(spawned === 0, `owner 存活不得 spawn runner（spawned=${spawned}）`);
        const rowsAfter1 = fs.readFileSync(eventsPath, 'utf-8').trim().split('\n')
          .map((l) => JSON.parse(l) as { type?: string; action?: string });
        assert(rowsAfter1.some((e) => e.type === 'supervisor_observation' && e.action === 'owner_alive'),
          'owner 存活须落 owner_alive 观察');
        assert(c1 === 0, `owner_alive 应 exit 0，实得 ${c1}`);
        supervise.__testing_setProcessProbe(null);
        supervise.__testing_setPidExists(null);

        // 场景 2：guardian gone（存在性否定）→ 拉起并**带 --force-resume**（P1-3 统一追加）
        writeEvents([
          ...base,
          { ts: '2026-01-01T00:05:00.000Z', type: 'resume', start_index: 1, start_phase: 'coding' },
          { ts: '2026-01-01T00:06:00.000Z', type: 'run_end', status: 'HALTED', halt_reason: 'backtrack_limit' },
        ]);
        fs.rmSync(path.join(runDir, 'liveness.json'), { force: true });
        const spawnedArgv: string[][] = [];
        supervise.__testing_setSpawnImpl((_file, args) => {
          spawnedArgv.push(args);
          return { pid: 12345, unref() {} };
        });
        const c2 = await runCli();
        assert(c2 === 0, `场景 2 exit=${c2}`);
        assert(spawnedArgv.length === 1, `场景 2 应 spawn 一次 runner（实得 ${spawnedArgv.length}）`);
        const flat = spawnedArgv[0].join(' ');
        assert(flat.includes('--force-resume'), `拉起参数缺 --force-resume：${flat}`);
        assert(flat.includes('--resume'), `拉起参数缺 --resume：${flat}`);
      } finally {
        supervise.__testing_setSpawnImpl(null);
        supervise.__testing_setProcessProbe(null);
        supervise.__testing_setPidExists(null);
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
      }
    },
  },
  {
    name: 'goal-supervise owner 边界：session 全状态零事件；process/released 的 WAITING probe 可恢复',
    run: async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-sup-owner-'));
      const runId = '20260101T000000Z';
      const runDir = path.join(tmp, 'doc/features/f1/goal-runs', runId);
      const eventsPath = path.join(runDir, 'events.jsonl');
      fs.mkdirSync(runDir, { recursive: true });
      fs.writeFileSync(path.join(runDir, 'manifest.json'), JSON.stringify({
        run_id: runId,
        report_dir: `doc/features/f1/goal-runs/${runId}`,
      }), 'utf-8');
      const supervise = require('../../scripts/goal-supervise') as typeof import('../../scripts/goal-supervise');
      const writeControl = (kind: 'process' | 'session', state: string): void => {
        fs.writeFileSync(path.join(runDir, 'run-control.json'), JSON.stringify({
          schema: 'run-control@1', run_id: runId, current_epoch: 1,
          owner: {
            kind, owner_id: `owner-${kind}`, epoch: 1, state,
            ...(kind === 'process'
              ? { pid: process.pid, hostname: os.hostname() }
              : { lease_expires_at: new Date(Date.now() + 60_000).toISOString() }),
          },
          updated_at: new Date().toISOString(),
        }, null, 2) + '\n', 'utf-8');
      };
      const runCli = async (): Promise<number> => {
        const prevArgv = process.argv;
        process.argv = ['node', 'goal-supervise.ts', '--feature', 'f1', '--project-root', tmp, '--run-id', runId];
        try { return await supervise.__testing_main(); }
        finally { process.argv = prevArgv; }
      };
      try {
        let spawned = 0;
        supervise.__testing_setSpawnImpl(() => {
          spawned += 1;
          return { pid: 12345, unref() {} };
        });
        const sessionEvents = [
          { ts: '2026-01-01T00:00:00.000Z', type: 'run_start' },
          { ts: '2026-01-01T00:01:00.000Z', type: 'phase_backtrack_requested', phase: 'coding', run_disposition: 'RECOVERY_PENDING' },
        ];
        for (const state of ['active', 'quiescing', 'released', 'orphaned_session']) {
          fs.writeFileSync(eventsPath, sessionEvents.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf-8');
          writeControl('session', state);
          const before = fs.readFileSync(eventsPath, 'utf-8');
          const code = await runCli();
          assert(code === 0, `session/${state} exit=${code}`);
          assert(fs.readFileSync(eventsPath, 'utf-8') === before, `session/${state} 不得写事件`);
        }
        assert(spawned === 0, `session owner 不得 spawn（${spawned}）`);

        for (const controlCase of ['missing', 'corrupt'] as const) {
          fs.writeFileSync(eventsPath, sessionEvents.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf-8');
          const controlPath = path.join(runDir, 'run-control.json');
          if (controlCase === 'missing') fs.rmSync(controlPath, { force: true });
          else fs.writeFileSync(controlPath, '{"schema":"broken"}\n', 'utf-8');
          const before = fs.readFileSync(eventsPath, 'utf-8');
          const code = await runCli();
          assert(code === 0, `${controlCase} run-control exit=${code}`);
          assert(fs.readFileSync(eventsPath, 'utf-8') === before, `${controlCase} run-control 不得写事件`);
          assert(spawned === 0, `${controlCase} run-control 不得 spawn`);
        }

        writeControl('process', 'released');
        fs.writeFileSync(path.join(runDir, 'handoff-request.json'), JSON.stringify({ status: 'pending' }), 'utf-8');
        const beforeHandoff = fs.readFileSync(eventsPath, 'utf-8');
        const handoffCode = await runCli();
        assert(handoffCode === 0, `pending handoff exit=${handoffCode}`);
        assert(fs.readFileSync(eventsPath, 'utf-8') === beforeHandoff, 'pending handoff 不得写事件');
        assert(spawned === 0, 'pending handoff 不得 spawn');
        for (const status of ['accepted', 'rejected']) {
          fs.writeFileSync(path.join(runDir, 'handoff-request.json'), JSON.stringify({ status }), 'utf-8');
          const beforeMalformed = fs.readFileSync(eventsPath, 'utf-8');
          const malformedCode = await runCli();
          assert(malformedCode === 0, `malformed ${status} handoff exit=${malformedCode}`);
          assert(fs.readFileSync(eventsPath, 'utf-8') === beforeMalformed,
            `malformed ${status} handoff 不得写事件`);
          assert(spawned === 0, `malformed ${status} handoff 不得 spawn`);
        }
        fs.rmSync(path.join(runDir, 'handoff-request.json'), { force: true });

        fs.writeFileSync(eventsPath, [
          JSON.stringify({ ts: '2026-01-01T00:00:00.000Z', type: 'run_start' }),
          JSON.stringify({
            ts: '2026-01-01T00:01:00.000Z', type: 'phase_halt', phase: 'coding',
            run_disposition: 'WAITING', run_wait_kind: 'external', probe: 'storage_ready',
          }),
        ].join('\n') + '\n', 'utf-8');
        writeControl('process', 'released');
        supervise.__testing_setConditionProbe(() => ({ ready: true, reason: 'ready' }));
        const processCode = await runCli();
        assert(processCode === 0, `process/released exit=${processCode}`);
        assert(spawned === 1, `process/released + ready probe 应 spawn 一次（${spawned}）`);
      } finally {
        supervise.__testing_setSpawnImpl(null);
        supervise.__testing_setConditionProbe(null);
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    },
  },
];

export function runAll(): Promise<UnitCaseResult[]> {
  return runAllAsync();
}

export async function runAllAsync(): Promise<UnitCaseResult[]> {
  const results: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      await c.run();
      results.push({ name: c.name, ok: true });
    } catch (e) {
      results.push({ name: c.name, ok: false, error: (e as Error).message });
    }
  }
  return results;
}

if (require.main === module) {
  void runAllAsync().then((r) => {
    for (const x of r) {
      console.log(x.ok ? `PASS ${x.name}` : `FAIL ${x.name}: ${x.error}`);
    }
    process.exit(r.every((x) => x.ok) ? 0 : 1);
  });
}
