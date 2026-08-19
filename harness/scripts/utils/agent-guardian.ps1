# ============================================================================
# agent-guardian.ps1 — Windows agent containment guardian（plan c6a9e4d2 t2）
# ----------------------------------------------------------------------------
# 职责：在 execution 任何用户代码前把 agent 放入 KILL_ON_JOB_CLOSE Job；
#       guardian 是 Job handle 的**唯一长期持有者**（不向 runner/agent 复制句柄）。
#
# 协议（runner = goal-runner；agent = claude -p / codex exec / cursor-agent 等）：
#   - 参数经 AWS 风格命名参数传入；AgentJson = Base64(UTF-16LE(JSON))，内容：
#       { "argv": [...], "cwd": "..." }（argv[0] 为解析后的 binary 路径）
#   - 顺序：CreateJobObject → SetInformationJobObject(KILL_ON_JOB_CLOSE) →
#           CreateProcess(CREATE_SUSPENDED) → AssignProcessToJobObject →
#           ResumeThread —— 杜绝 spawn→assign 竞态窗口（挂起中的主线程不执行
#           任何用户代码，assign 失败则 TerminateProcess，绝不 resume 放行）。
#   - stdio 透传：agent 继承 guardian 的 stdin/stdout/stderr 句柄（Node runner
#     的既有消费管道），guardian 自身**绝不写 stdout**；错误诊断只写 stderr
#     并带 `[maison-guardian]` 前缀。
#   - 同时等待 runner 与 agent：
#       · runner 异常消失（WaitForMultipleObjects 命中 runner handle）→
#         TerminateJobObject → 团灭 agent 全树 → exit 3；
#       · guardian 自身被杀 → OS 关闭其句柄（同为 Job 最后句柄）→
#         KILL_ON_JOB_CLOSE 团灭；
#       · 正常收尾（agent 先退出）→ 透传 agent exit code 并退出——Job 无句柄
#         立即关闭，残余后代被团灭，管道随 guardian 退出排空（runner close）。
#
# 退出码（runner 消费）：
#   0          = agent 成功退出（invoke 成功）
#   1          = 参数/解码错误
#   2          = containment 建立失败（agent 未被放行）
#   3          = runner 先消失，guardian 主动团灭
#   其它非 0   = agent 退出码透传（均为 invoke 失败语义，无需在 runner 区分）
#
# 身份契约（t3）：本脚本的**命令行**显式携带 -Token（run_id/invoke_id token），
# 供接管侧以 ManagedProcessIdentity 四元组核验（pid + 启动时刻 + 可执行文件 =
# powershell.exe 绝对路径 + commandLine 含 token）。
# ============================================================================

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][int]$RunnerPid,
  [Parameter(Mandatory = $true)][string]$Token,
  [Parameter(Mandatory = $true)][string]$AgentJson
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2

# 诊断出口：任何失败都走这里（stderr 带前缀；成功路径绝不调用）。
function Write-GuardianError([string]$msg) {
  try { [Console]::Error.WriteLine("[maison-guardian] $msg") } catch { }
}
function Exit-Guardian([int]$code, [string]$msg) {
  if ($msg) { Write-GuardianError $msg }
  exit $code
}

# ---------------------------------------------------------------------------
# P/Invoke 层（Add-Type 内嵌 C#；PowerShell P/Invoke 先行方案，零新增二进制）
# ---------------------------------------------------------------------------
$nativeSource = @'
using System;
using System.Runtime.InteropServices;

namespace MaisonGuardian
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct STARTUPINFO
    {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public int dwX;
        public int dwY;
        public int dwXSize;
        public int dwYSize;
        public int dwXCountChars;
        public int dwYCountChars;
        public int dwFillAttribute;
        public int dwFlags;
        public short wShowWindow;
        public short cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct PROCESS_INFORMATION
    {
        public IntPtr hProcess;
        public IntPtr hThread;
        public int dwProcessId;
        public int dwThreadId;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct IO_COUNTERS
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    public static class Native
    {
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern IntPtr CreateJobObjectW(IntPtr lpJobAttributes, string lpName);

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool SetInformationJobObject(
            IntPtr hJob, int JobObjectInformationClass,
            ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION lpJobObjectInformation, uint cbJobObjectInformationLength);

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProcess);

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool TerminateJobObject(IntPtr hJob, uint uExitCode);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern bool CreateProcessW(
            string lpApplicationName, string lpCommandLine,
            IntPtr lpProcessAttributes, IntPtr lpThreadAttributes,
            bool bInheritHandles, uint dwCreationFlags,
            IntPtr lpEnvironment, string lpCurrentDirectory,
            ref STARTUPINFO lpStartupInfo, out PROCESS_INFORMATION lpProcessInformation);

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern uint ResumeThread(IntPtr hThread);

        // PowerShell 5.1 把 uint 返回值映射为 Int32（0xFFFFFFFF → -1），直接比较
        // 会触发 InvalidCastException——封装成语义化 bool 再交给脚本层。
        public static bool ResumeAgentThread(IntPtr hThread)
        {
            uint r = ResumeThread(hThread);
            return r != 0xFFFFFFFF;
        }

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern uint WaitForMultipleObjects(
            uint nCount, IntPtr[] lpHandles, bool bWaitAll, uint dwMilliseconds);

        public const uint WAIT_OBJECT_0 = 0;
        public const uint WAIT_OBJECT_1 = 1;

        public static int WaitForRunnerOrAgent(IntPtr[] handles)
        {
            uint r = WaitForMultipleObjects(2, handles, false, INFINITE);
            if (r == WAIT_OBJECT_0) return 0; // runner 先消失
            if (r == WAIT_OBJECT_1) return 1; // agent 先退出
            return -1; // 异常（含 wait failed）
        }

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool GetExitCodeProcess(IntPtr hProcess, out uint lpExitCode);

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool TerminateProcess(IntPtr hProcess, uint uExitCode);

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern IntPtr OpenProcess(uint dwDesiredAccess, bool bInheritHandle, int dwProcessId);

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern IntPtr GetStdHandle(int nStdHandle);

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool CloseHandle(IntPtr hObject);

[DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool QueryInformationJobObject(
IntPtr hJob, int JobObjectInformationClass,
            ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION lpJobObjectInformation,
            uint cbJobObjectInformationLength, out uint lpReturnLength);

        /// <summary>
        /// 创建 KILL_ON_JOB_CLOSE Job（含读回断言）。
        /// 为什么必须在 C# 内完成：2026-08-18 本机实测定谳——PowerShell 的
        /// `[ref]` blittable struct marshaling 会让 SetInformationJobObject 静默
        /// 收到空数据（返回 True 但 flags 全零，Query 读回 0x0），KILL 形同虚设。
        /// C# `ref` 参数路径读回一致（verdict=1）。设置成功且读回含 KILL 才返回
        /// Job handle；否则返回 IntPtr.Zero（调用方 fail-closed exit 2）。
        /// </summary>
        public static IntPtr CreateKillOnCloseJob()
        {
            IntPtr job = CreateJobObjectW(IntPtr.Zero, null);
            if (job == IntPtr.Zero) return IntPtr.Zero;
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION ji = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
            ji.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            bool ok = SetInformationJobObject(job, JobObjectExtendedLimitInformation,
                ref ji, (uint)Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION)));
            if (!ok)
            {
                CloseHandle(job);
                return IntPtr.Zero;
            }
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION q = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
            uint r;
            bool readBack = QueryInformationJobObject(job, JobObjectExtendedLimitInformation,
                ref q, (uint)Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION)), out r);
            if (!readBack || (q.BasicLimitInformation.LimitFlags & JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE) == 0)
            {
                CloseHandle(job);
                return IntPtr.Zero;
            }
            return job;
        }

        public const uint CREATE_SUSPENDED = 0x00000004;
        public const uint CREATE_NEW_CONSOLE = 0x00000010;
        public const uint CREATE_NO_WINDOW = 0x08000000;
        public const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
        public const uint CREATE_BREAKAWAY_FROM_JOB = 0x01000000;
        public const int STARTF_USESTDHANDLES = 0x00000100;
        public const int STARTF_USESHOWWINDOW = 0x00000001;
        public const short SW_HIDE = 0;
        public const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
        public const int JobObjectExtendedLimitInformation = 9;
        public const uint PROCESS_SYNCHRONIZE = 0x00100000;
        public const uint INFINITE = 0xFFFFFFFF;
        public const int STD_INPUT_HANDLE = -10;
        public const int STD_OUTPUT_HANDLE = -11;
        public const int STD_ERROR_HANDLE = -12;
    }
}
'@

try {
  Add-Type -TypeDefinition $nativeSource -Language CSharp
} catch {
  Exit-Guardian 1 "Add-Type 编译失败: $($_.Exception.Message)"
}

# ---------------------------------------------------------------------------
# 参数解码（AgentJson = Base64(UTF-16LE(JSON)) —— 与 PowerShell -EncodedCommand
# 同款编码，避免命令行转义地狱；Token 保持明文在 argv 中供身份核验）
# ---------------------------------------------------------------------------
$agent = $null
try {
  $jsonText = [System.Text.Encoding]::Unicode.GetString([System.Convert]::FromBase64String($AgentJson))
  $agent = $jsonText | ConvertFrom-Json
} catch {
  Exit-Guardian 1 "AgentJson 解码失败: $($_.Exception.Message)"
}
if (-not $agent -or -not $agent.argv -or $agent.argv.Count -lt 1) {
  Exit-Guardian 1 "AgentJson 缺少 argv"
}
$agentArgv = @($agent.argv)
# cwd 规范化：生产侧恒为文件系统绝对路径（node path 类型）；防御 PSDrive 形态
# （Microsoft.PowerShell.Core\FileSystem::…）与相对路径——CreateProcess 只认
# 可解析的 Win32 目录，无效时会以 ERROR_PATH_NOT_FOUND 拒建进程。
$agentCwdRaw = if ($agent.cwd) { [string]$agent.cwd } else { '' }
$agentCwd = $agentCwdRaw
if ($agentCwdRaw) {
  try {
    $item = Get-Item -LiteralPath $agentCwdRaw -ErrorAction Stop
    if ($item -is [System.IO.DirectoryInfo]) { $agentCwd = $item.FullName }
  } catch {
    # 目录不存在：保留原值，由 CreateProcess 层如实失败（不猜测）
  }
}
if (-not $agentCwd) { $agentCwd = (Get-Location).Path }
if (-not $Token -or $Token.Trim().Length -eq 0) {
  Exit-Guardian 1 "Token 缺失（run_id/invoke_id 身份契约必须显式携带）"
}

# ---------------------------------------------------------------------------
# 命令行来源（P1-7 review）：**本层不再自行拼装/转义**——quote/转义收在 Node 侧
# （agent-containment.ts，标准 CommandLineToArgvW 反向算法 + cmd /S /C 分支的
# % 转义，均有单测）。AgentJson 携带已转义的 `commandLine` 与 CreateProcess 的
# `appName`（绝对路径；cmd shim 时=cmd.exe 绝对路径）。此处仅做存在性防御。
# ---------------------------------------------------------------------------
$appName = if ($agent.appName) { [string]$agent.appName } else { '' }
$cmdline = if ($agent.commandLine) { [string]$agent.commandLine } else { '' }
if (-not $appName -or -not $cmdline) {
  Exit-Guardian 1 "AgentJson 缺少 appName/commandLine（转义必须由 Node 侧完成）"
}
if (-not (Test-Path -LiteralPath $appName -PathType Leaf)) {
  Exit-Guardian 2 "appName 不是可执行文件: $appName"
}

# ---------------------------------------------------------------------------
# 1) runner SYNCHRONIZE handle **先于 CreateProcess**（P1-6 review）：agent 还在
#    挂起中即已持有原 runner 的进程句柄——PowerShell 编译/启动耗时期间 runner
#    若死亡且 PID 被重用，此后按 PID 打开会等到无关进程；句柄先行则无此窗口。
#    打开失败 = runner 已不存在 → 不得创建 agent，fail-closed exit 2。
# ---------------------------------------------------------------------------
$runnerHandle = [MaisonGuardian.Native]::OpenProcess([MaisonGuardian.Native]::PROCESS_SYNCHRONIZE, $false, $RunnerPid)
if ($runnerHandle -eq [IntPtr]::Zero) {
  Exit-Guardian 2 "runner(pid=$RunnerPid) 无法打开（已不存在/权限不足），不得创建 agent"
}

# ---------------------------------------------------------------------------
# 2) CreateJobObject + KILL_ON_JOB_CLOSE（C# 内建含读回断言——PS [ref] marshaling
# 会让 SetInformationJobObject 静默失效，实测见 C# CreateKillOnCloseJob 注释）
# ---------------------------------------------------------------------------
$jobHandle = [MaisonGuardian.Native]::CreateKillOnCloseJob()
if ($jobHandle -eq [IntPtr]::Zero) {
  Exit-Guardian 2 "CreateKillOnCloseJob 失败或 KILL_ON_JOB_CLOSE 读回断言未过: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
}

# ---------------------------------------------------------------------------
# 3) CreateProcess(CREATE_SUSPENDED | CREATE_BREAKAWAY_FROM_JOB) — stdio 句柄
#    继承（透传 runner 管道）
# ---------------------------------------------------------------------------
# CREATE_BREAKAWAY_FROM_JOB：2026-08-18 本机实测定谳——宿主工具环境（Claude
# Desktop）进程位于 kill-on-close 宿主 Job 内（flags=0x3C00，含 BREAKAWAY_OK/
# SILENT_BREAKAWAY_OK/KILL_ON_JOB_CLOSE）。若 agent 留在宿主 Job 内（嵌套），
# 我们自建 Job 的 KILL_ON_JOB_CLOSE 与 TerminateJobObject 对嵌套成员**均不生效**
# （close 句柄后成员存活，实测复现），containment 结构性失效。对策：agent 以
# CREATE_BREAKAWAY_FROM_JOB 显式脱离宿主 Job，使 agent 唯一归属于 guardianJob
# （单层）→ guardian 死/Job 关 → KILL_ON_JOB_CLOSE 必团灭。宿主不允许
# breakaway 时 CreateProcess 直接失败 → containment 建立失败 fail-closed
# （绝不静默降级）。guardianJob 自身不设 BREAKAWAY_OK——agent 在其中不能再逃。
$si = New-Object MaisonGuardian.STARTUPINFO
$si.cb = [System.Runtime.InteropServices.Marshal]::SizeOf([type][MaisonGuardian.STARTUPINFO])
# 三轮 review 定谳：console 类 agent（cmd/claude/powershell 等）在**无控制台**环境
# （node runner 的守护者没有 conhost）下会挂起等待控制台分配（实测 cmd echo /
# claude --version 在 guardian 下 >8s 无输出，裸 powershell 的 Start-Sleep 正常）；
# guardian 等待 agent 超过 ~8s 会被宿主清杀（guardian 特有——Job/子进程在持）。
# 对策：给 agent 创建**隐藏**的新控制台（CREATE_NEW_CONSOLE + STARTF_USESHOWWINDOW
# + SW_HIDE）——console 类 agent 正常启动/退出，窗口不可见（保持 windowsHide 卫生）。
$si.dwFlags = [MaisonGuardian.Native]::STARTF_USESTDHANDLES -bor `
              [MaisonGuardian.Native]::STARTF_USESHOWWINDOW
$si.wShowWindow = [MaisonGuardian.Native]::SW_HIDE
$si.hStdInput = [MaisonGuardian.Native]::GetStdHandle([MaisonGuardian.Native]::STD_INPUT_HANDLE)
$si.hStdOutput = [MaisonGuardian.Native]::GetStdHandle([MaisonGuardian.Native]::STD_OUTPUT_HANDLE)
$si.hStdError = [MaisonGuardian.Native]::GetStdHandle([MaisonGuardian.Native]::STD_ERROR_HANDLE)

$pi = New-Object MaisonGuardian.PROCESS_INFORMATION
$creationFlags = [MaisonGuardian.Native]::CREATE_SUSPENDED -bor `
                 [MaisonGuardian.Native]::CREATE_NEW_CONSOLE -bor `
                 [MaisonGuardian.Native]::CREATE_UNICODE_ENVIRONMENT -bor `
                 [MaisonGuardian.Native]::CREATE_BREAKAWAY_FROM_JOB
$okCreate = [MaisonGuardian.Native]::CreateProcessW(
  $appName, # lpApplicationName：绝对路径（实测：无路径 appname 在本机宿主会被安全面拦截）
  $cmdline,
  [IntPtr]::Zero, [IntPtr]::Zero,
  $true, # bInheritHandles：agent 继承 guardian 的 stdio 句柄
  $creationFlags,
  [IntPtr]::Zero, # lpEnvironment=NULL → 继承当前环境（runner 已注入 agent env）
  $agentCwd,
  [ref]$si,
  [ref]$pi)

if (-not $okCreate) {
  Exit-Guardian 2 "CreateProcess(CREATE_SUSPENDED) 失败: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())（argv=$cmdline）"
}

try {
  # -------------------------------------------------------------------------
  # 3) AssignProcessToJobObject —— **必须先于 ResumeThread**（无 spawn→assign
  #    竞态窗口）。失败 → 终止挂起进程并 fail-closed，绝不 resume 放行。
  # -------------------------------------------------------------------------
  $okAssign = [MaisonGuardian.Native]::AssignProcessToJobObject($jobHandle, $pi.hProcess)
  if (-not $okAssign) {
    $assignErr = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    [MaisonGuardian.Native]::TerminateProcess($pi.hProcess, 9) | Out-Null
    Exit-Guardian 2 "AssignProcessToJobObject 失败(agent 未放行): $assignErr"
  }

  # -------------------------------------------------------------------------
  # 4) ResumeThread —— 此刻 agent 已是 Job 成员
  # -------------------------------------------------------------------------
  $okResume = [MaisonGuardian.Native]::ResumeAgentThread($pi.hThread)
  if (-not $okResume) {
    [MaisonGuardian.Native]::TerminateProcess($pi.hProcess, 9) | Out-Null
    Exit-Guardian 2 "ResumeThread 失败: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
  }

  # -------------------------------------------------------------------------
  # 5) 与 runner（SYNCHRONIZE handle，P1-6: 已先于 CreateProcess 打开）与 agent
  #    （进程句柄）同时等待
  # -------------------------------------------------------------------------
  # 说明：runner handle 在此前已取得（创建 agent 前）——此处在等待语义上复用，
  # 若 runner 已消失（等待立即命中）由下方统一团灭路径处理。
  $handles = [IntPtr[]]@($runnerHandle, $pi.hProcess)
  $waitResult = [MaisonGuardian.Native]::WaitForRunnerOrAgent($handles)

  if ($waitResult -eq 0) {
    # runner 先消失 —— 主动团灭整树（TerminateJobObject 尽力；KILL_ON_JOB_CLOSE
    # 在单层 Job 下必然兜底），避免 agent 脱管野跑
    [MaisonGuardian.Native]::TerminateJobObject($jobHandle, 3) | Out-Null
    Exit-Guardian 3 "runner(pid=$RunnerPid) 消失，guardian 主动团灭 Job"
  }
  if ($waitResult -ne 1) {
    [MaisonGuardian.Native]::TerminateJobObject($jobHandle, 3) | Out-Null
    Exit-Guardian 3 "WaitForMultipleObjects 异常($waitResult)，guardian 主动团灭 Job"
  }

  # -------------------------------------------------------------------------
  # 6) 正常收尾：agent 先退出 → 尽力 TerminateJobObject 清扫残留后代（单层 Job 下
  #    KILL_ON_JOB_CLOSE 最终兜底），透传 exit code 并退出；guardian 退出释放
  #    Job 句柄 → 管道排空 → runner close。
  # -------------------------------------------------------------------------
  $agentExit = [uint32]1
  [MaisonGuardian.Native]::GetExitCodeProcess($pi.hProcess, [ref]$agentExit) | Out-Null
  if ($agentExit -eq 259) { $agentExit = 1 } # STILL_ACTIVE 兜底（理论不可达）
  [MaisonGuardian.Native]::TerminateJobObject($jobHandle, 0) | Out-Null
  exit ([int]$agentExit)
} finally {
  # 进程退出前清句柄（best-effort；失败路径也已由 OS 兜底回收）
  if ($pi.hThread -ne [IntPtr]::Zero) { [MaisonGuardian.Native]::CloseHandle($pi.hThread) | Out-Null }
  if ($pi.hProcess -ne [IntPtr]::Zero) { [MaisonGuardian.Native]::CloseHandle($pi.hProcess) | Out-Null }
  if ($runnerHandle -and $runnerHandle -ne [IntPtr]::Zero) { [MaisonGuardian.Native]::CloseHandle($runnerHandle) | Out-Null }
}
