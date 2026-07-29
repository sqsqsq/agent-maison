// ============================================================================
// device-credential-store.ts — 设备解锁凭据与**机器级**失败锁存
//                              （openspec device-readiness-and-completion t6）
// ----------------------------------------------------------------------------
// 事故（2026-07-28）：agent 对用户真机枚举 10 组常见 PIN 致设备锁定。根治不是"限制
// 尝试次数"——换个密码再试即可绕过；而是**只允许使用用户登记的凭据，且任何一次失败
// 即机器级锁死**。
//
// 三条硬约束：
//   1. **口令永不明文落盘、永不出 helper 进程**——由 Windows Credential Manager 托管；
//      本仓与 framework.local.json 只出现 opaque `credential_ref`。
//   2. **锁存必须是机器级**，不是 goal 级。goal 级有两条绕过路径：新建 goal 看不到旧
//      goal 的 events；并发 wrapper 各自账本都显示"尚未失败"→ 同时输入 PIN。
//   3. **凭据身份不可变**——`credential_version` 只增不改，轮换新建记录、绝不原地覆盖。
//      否则旧 goal 会拿新 PIN 跑旧锁存状态，"一个版本只许失败一次"被击穿。
//
// ## 状态机就是那条凭据本身（review 三轮的根治）
//
// 早先实现把状态放 `~/.maison/*.json`、口令放 CM。**失效方向是反的**：删掉 json →
// 锁存复位而口令还在 → 可以再输一次同一个错 PIN（fail-open）。而删掉 CM 条目 →
// 口令没了 → 结构上无法再试（fail-safe）。
//
// 故不设任何旁路状态文件：**CM 里那条 blob 的形态直接编码状态**。
//
// | blob 形态                              | 状态        | 含义                       |
// |----------------------------------------|-------------|----------------------------|
// | 不存在                                 | `absent`    | 未登记，或已被 burn        |
// | `^\d{4,16}$`                           | `ready`     | 可用                       |
// | `MAISON-CLAIM/<nonce>/<pin>`           | `in_flight` | 有人在临界区，或崩在临界区 |
// | 其它                                   | `unsupported` | 形态不受支持             |
//
// 解锁的整个生命周期由三个动作组成，口令只在 CM 与 helper 进程之间流动：
//   1. `claimAndUnlock` —— 一个 PowerShell 进程内完成：读 blob → 若已是 claim 则
//      BLOCKED → 覆盖写 `MAISON-CLAIM/<nonce>/<pin>` → **读回校验 nonce 是自己的** →
//      赢家才逐位点击。
//   2. `commitUnlock` —— 复验确实已解锁后，把 claim 里的 pin 写回成裸 PIN（回 `ready`）。
//   3. `burnCredential` —— 失败即 `CredDelete` + 落墓碑，永久 `disabled`。
//
// ## 互斥：OS named mutex 保护读改写，claim 承担持久排他
//
// **`CredWrite` 不是 compare-and-swap**（三轮 review 的 P0）。它是 last-writer-wins，
// 回读只能证明"此刻仍是我"，拦不住后来者。这个时序完全合法：
//   ① A 读到裸 PIN；② B 也读到裸 PIN；③ A 写 claim-A、回读 claim-A → 开始点击；
//   ④ B 写 claim-B、回读 claim-B → **也**开始点击。两个赢家，互斥失效。
//
// 故 `read → 判形态 → write claim → 回读` 这一段必须由**真正的原子原语**保护：
// Windows named mutex（`System.Threading.Mutex`，跨进程）。
//
// 临界区**刻意做得很短**——只覆盖上面那个读改写，不覆盖点击/复验/commit。理由：
// claim 一旦写进凭据库，它本身就是**持久的**排他标记（后来者读到 claim 前缀即
// BLOCKED），不再需要 mutex 兜着。这样 mutex 只在单个 PowerShell 进程内持有几十
// 毫秒，既不会跨进程调用丢锁，也不存在"持有者长期崩溃把大家锁死"的问题。
//
// `AbandonedMutexException` 视为**取得**锁：前任崩在临界区里，只可能崩在"写 claim 前"
// （凭据库仍是裸 PIN，我们照常走）或"写 claim 后"（我们会读到它的 claim → BLOCKED）。
// 两种都安全。
//
// 崩溃语义天然正确：崩在临界区 → 凭据库里留着 claim → 后续所有人读到 claim 前缀即
// BLOCKED，且该状态**持久、不可靠删文件复位**（claim 里的 pin 因此永远用不上，
// 等价于 disabled）。解除只有一条路：重新登记生成新 `credential_version`。
// ============================================================================

import { spawnSync } from 'child_process';
import { createHash, randomBytes } from 'crypto';

/**
 * serial 允许字符集（**安全边界**，R15）：serial 会被拼进 PowerShell 脚本的
 * target 名，含引号/分号的值可破坏脚本甚至注入命令。此处收敛为设备序列号的
 * 现实字符集；不合规一律拒绝，绝不转义了事。
 */
export const SERIAL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

export function isValidSerial(serial: string): boolean {
  return SERIAL_PATTERN.test(serial);
}

/** 凭据在 OS 密钥库中的**不可变**身份。轮换 = 新建一条，version 只增不改。 */
export interface CredentialIdentity {
  serial: string;
  version: number;
}

/** framework.local.json 里存的 opaque 引用（不含口令） */
export function credentialRefOf(id: CredentialIdentity): string {
  return `maison/device/${id.serial}/v${id.version}`;
}

export function parseCredentialRef(ref: string): CredentialIdentity | null {
  const m = /^maison\/device\/(.+)\/v(\d+)$/.exec(ref.trim());
  if (!m) return null;
  const version = Number(m[2]);
  if (!Number.isInteger(version) || version <= 0) return null;
  // R15：ref 是可被手改的配置内容，解析处必须收敛字符集（下游会拼进 PowerShell）
  if (!isValidSerial(m[1])) return null;
  return { serial: m[1], version };
}

/** OS 密钥库 target 名——**必须含 version**，否则轮换会原地覆盖（见文件头约束 3） */
export function credentialTargetName(id: CredentialIdentity): string {
  return `MaisonDeviceUnlock:${id.serial}:v${id.version}`;
}

/** 墓碑 target：记录"该版本因失败被烧毁"的原因。内容非秘密。 */
export function tombstoneTargetName(id: CredentialIdentity): string {
  return `${credentialTargetName(id)}#burned`;
}

/** 版本分配期间的抢占 target（见 allocateCredentialVersion） */
function reserveTargetName(serial: string, version: number): string {
  return `MaisonDeviceUnlock:${serial}:v${version}#reserve`;
}

// ---------------------------------------------------------------------------
// blob 形态 ⇄ 状态
// ---------------------------------------------------------------------------

/** 受支持的口令形态：纯数字 PIN。手势/字母口令 unsupported（见 plan D3c）。 */
export const PIN_PATTERN = /^\d{4,16}$/;

/**
 * 临界区标记形态。前缀含字母，**结构上不可能与合法 PIN 混淆**（PIN 是纯数字），
 * 因此不需要不可见字符（`\0` 前缀会与 marshal 的字符串长度处理纠缠）。
 */
export const CLAIM_PATTERN = /^MAISON-CLAIM\/([0-9a-f]{16})\/(\d{4,16})$/;

/**
 * OS named mutex 名。从 target 派生并哈希：mutex 名不得含 `\`（那是命名空间分隔符），
 * 而 target 里有 `:` 和 `.`；哈希顺带把长度钉死在合法范围内。
 * 不加 `Global\` 前缀——同一登录会话内的互斥即可，`Global\` 还要额外权限。
 */
export function mutexNameFor(key: string): string {
  return `Maison-DeviceUnlock-${createHash('sha256').update(key).digest('hex').slice(0, 32)}`;
}

/** 取 mutex 的有界等待预算——拿不到一律零输入，绝不无限阻塞 */
export const MUTEX_WAIT_MS = 15_000;

export type CredentialState = 'absent' | 'ready' | 'in_flight' | 'unsupported' | 'burned';

export interface CredentialStateRead {
  state: CredentialState;
  /** state==='burned' 时的原因（来自墓碑） */
  reason?: string;
  /** state==='in_flight' 时持有 claim 的 nonce（仅用于诊断，不含口令） */
  nonce?: string;
  /** provider 层面的错误（读取失败等）——此时 state 一律按最保守处理 */
  error?: string;
}

/** 生成一次性 claim nonce */
export function newClaimNonce(): string {
  return randomBytes(8).toString('hex');
}

export type ClaimOutcome =
  | 'clicked'
  /** 凭据库里已是别人的 claim（在途，或上次崩在临界区） */
  | 'blocked_in_flight'
  /** 未能在预算内取得 OS 互斥——另一进程正在读改写 */
  | 'blocked_mutex'
  /** 取得互斥后回读发现 claim 不是自己的（兜底，正常不该发生） */
  | 'blocked_race'
  | 'absent'
  | 'unsupported'
  | 'error';

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export interface CredentialProvider {
  available(): boolean;

  /**
   * 交互式登记：口令**全程不出 helper 进程**——`Read-Host -AsSecureString` 从真实
   * 控制台读入，直接 Marshal 成非托管内存交给 `CredWriteW`。
   */
  promptAndWrite(id: CredentialIdentity, prompt: string): { ok: boolean; error?: string };

  /**
   * 读取**状态**（不是口令）。这是唯一的放行判定来源（plan D3g 的安全 SSOT）。
   */
  inspect(id: CredentialIdentity): CredentialStateRead;

  /**
   * 抢占临界区并解锁：一个进程内完成 读 → 判形态 → 写 claim → 读回验 nonce → 点击。
   * `keys` 是数字→坐标的映射（由调用方从**当前**锁屏 UI 快照解析）。
   * 口令不出该进程；传给 hdc 的 argv 只有坐标。
   */
  claimAndUnlock(
    id: CredentialIdentity,
    keys: ReadonlyArray<{ digit: string; x: number; y: number }>,
    serial: string,
    nonce: string,
  ): { outcome: ClaimOutcome; error?: string };

  /** 复验确已解锁后调用：把 claim 里的口令写回成裸 PIN（回到 `ready`） */
  commitUnlock(id: CredentialIdentity, nonce: string): { ok: boolean; error?: string };

  /** 失败/放弃：删除凭据并落墓碑。**这是唯一的"锁死"动作，且不可逆**。 */
  burnCredential(id: CredentialIdentity, reason: string): { ok: boolean; error?: string };

  /** 登记管理用：彻底移除（含墓碑）。轮换走"新建版本"，不走这里。 */
  remove(id: CredentialIdentity): { ok: boolean; error?: string };

  /** 列出该 serial 已存在的所有版本号（含墓碑与 reserve 占位）——版本分配用 */
  listVersions(serial: string): { ok: boolean; versions?: number[]; error?: string };

  /**
   * 版本分配抢占：当且仅当 reserve target 此刻不属于别人时写入自己的 nonce 并读回确认。
   * 赢返回 true。崩溃残留只会让该版本号被永久跳过，无安全后果。
   */
  reserveVersion(serial: string, version: number, nonce: string): { ok: boolean; won?: boolean; error?: string };
}

/**
 * 机器级唯一版本分配（R4）。
 *
 * 此前版本只从**当前项目**的 framework.local.json 推导：两个项目首次登记同一台手机
 * 都会得到 v1 → 指向同一个 Credential Manager target → 后登记的覆盖先登记的，
 * 而先前那个项目的 ref 仍写着 v1，于是**旧引用读到新 secret**，凭据身份不可变被击穿。
 *
 * 现按机器级 CM 内容分配：枚举已存在版本取 max+1，用 reserve target 做 CAS 抢占；
 * 抢输就 +1 重试。版本号**不要求连续**——崩溃残留的 reserve 只是跳号，无害。
 */
export function allocateCredentialVersion(
  serial: string,
  provider: CredentialProvider,
): { ok: true; version: number } | { ok: false; reason: string } {
  if (!isValidSerial(serial)) return { ok: false, reason: `serial 含非法字符：${serial}` };
  if (!provider.available()) return { ok: false, reason: '当前平台不支持 OS 凭据库' };
  const listed = provider.listVersions(serial);
  if (!listed.ok) return { ok: false, reason: `无法枚举已有版本：${listed.error ?? '未知错误'}` };
  let candidate = Math.max(0, ...(listed.versions ?? [])) + 1;
  for (let attempt = 0; attempt < 16; attempt++) {
    const nonce = newClaimNonce();
    const r = provider.reserveVersion(serial, candidate, nonce);
    if (!r.ok) return { ok: false, reason: `版本抢占失败：${r.error ?? '未知错误'}` };
    if (r.won) return { ok: true, version: candidate };
    candidate += 1;
  }
  return { ok: false, reason: '连续 16 次版本抢占均被并发占用，请稍后重试' };
}

/**
 * 放行判定：**只**依据 OS 凭据库状态。
 * 任何非 `ready` 一律零输入——含读取失败（provider 错误绝不能放行）。
 */
export function canAttemptUnlock(
  id: CredentialIdentity,
  provider: CredentialProvider,
): { ok: boolean; reason: string } {
  const read = provider.inspect(id);
  switch (read.state) {
    case 'ready':
      return { ok: true, reason: '凭据可用' };
    case 'absent':
      return {
        ok: false,
        reason: read.error
          ? `凭据状态不可读（${read.error}）——零输入`
          : '凭据不存在（未登记，或此前失败后已被烧毁）——须重新登记生成新版本',
      };
    case 'burned':
      return {
        ok: false,
        reason: `该凭据版本已因失败被永久禁用（${read.reason ?? '原因未记录'}）——须重新登记生成新版本`,
      };
    case 'in_flight':
      return {
        ok: false,
        reason: '该凭据正被另一进程使用，或上次解锁崩在临界区——零输入',
      };
    case 'unsupported':
      return { ok: false, reason: '凭据形态不受支持（仅支持 4–16 位数字 PIN）——零输入' };
    default:
      return { ok: false, reason: '凭据状态未知——零输入' };
  }
}

const PS_CRED_HELPER = String.raw`
$ErrorActionPreference = 'Stop'
# 输出编码必须显式设为 UTF-8：默认走系统 ANSI 代码页，中文（墓碑原因）回到 Node 就是乱码。
# 真实 CM 集成用例实测命中。
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
Add-Type -Namespace Maison -Name Cred -MemberDefinition @'
[DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
public static extern bool CredWriteW(ref CREDENTIAL c, uint flags);
[DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
public static extern bool CredReadW(string target, uint type, uint flags, out IntPtr cred);
[DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
public static extern bool CredDeleteW(string target, uint type, uint flags);
[DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
public static extern bool CredEnumerateW(string filter, uint flags, out uint count, out IntPtr creds);
[DllImport("advapi32.dll")]
public static extern void CredFree(IntPtr buf);
[StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
public struct CREDENTIAL {
  public uint Flags; public uint Type; public string TargetName; public string Comment;
  public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
  public uint CredentialBlobSize; public IntPtr CredentialBlob;
  public uint Persist; public uint AttributeCount; public IntPtr Attributes;
  public string TargetAlias; public string UserName;
}
'@

function Read-Blob([string]$target) {
  $p = [IntPtr]::Zero
  if (-not [Maison.Cred]::CredReadW($target, 1, 0, [ref]$p)) { return $null }
  $c = [Runtime.InteropServices.Marshal]::PtrToStructure($p, [Type][Maison.Cred+CREDENTIAL])
  $s = [Runtime.InteropServices.Marshal]::PtrToStringUni($c.CredentialBlob, $c.CredentialBlobSize / 2)
  [Maison.Cred]::CredFree($p)
  return $s
}

# OS named mutex：跨进程原子原语。CredWrite 只是 last-writer-wins，保护不了读改写。
# 返回 $null 表示未能在预算内取得（调用方须零输入退出）。
function Enter-MaisonMutex([string]$name, [int]$waitMs) {
  $m = New-Object System.Threading.Mutex($false, $name)
  try {
    if ($m.WaitOne($waitMs)) { return $m }
  } catch [System.Threading.AbandonedMutexException] {
    # 前任持锁时崩了。它只可能崩在"写 claim 前"（库里仍是裸 PIN，我们照常走）
    # 或"写 claim 后"（我们会读到它的 claim 并 BLOCKED）。两种都安全，可以接管。
    return $m
  }
  $m.Dispose()
  return $null
}

function Exit-MaisonMutex($m) {
  if ($null -eq $m) { return }
  try { $m.ReleaseMutex() } catch { }
  $m.Dispose()
}

function Write-Blob([string]$target, [string]$value) {
  $bytes = [System.Text.Encoding]::Unicode.GetBytes($value)
  $ptr = [Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)
  try {
    [Runtime.InteropServices.Marshal]::Copy($bytes, 0, $ptr, $bytes.Length)
    $c = New-Object Maison.Cred+CREDENTIAL
    $c.Type = 1; $c.TargetName = $target; $c.CredentialBlobSize = $bytes.Length
    $c.CredentialBlob = $ptr; $c.Persist = 2; $c.UserName = 'maison'
    if (-not [Maison.Cred]::CredWriteW([ref]$c, 0)) { throw "CredWriteW failed" }
  } finally {
    # 明文可能经此缓冲区——释放前先清零，不留进程内残影
    [Runtime.InteropServices.Marshal]::Copy((New-Object byte[] $bytes.Length), 0, $ptr, $bytes.Length)
    [Runtime.InteropServices.Marshal]::FreeHGlobal($ptr)
  }
}
`;
// 注：**不要**加 `-UsingNamespace System.Runtime.InteropServices`——Add-Type -MemberDefinition
// 已默认注入该 using，再传会因重复 using 编译失败（provider spike 实测命中）。

/** Windows Credential Manager（CredRead/CredWrite via P/Invoke）。非 Windows → unavailable。 */
export function windowsCredentialProvider(): CredentialProvider {
  const isWin = process.platform === 'win32';
  // R15：target **经环境变量**传给脚本（`$env:MAISON_CRED_TARGET`），不再拼进 -Command
  // 源码。即便 serial 校验被绕过，脚本文本也不含外部输入，注入面归零。
  const runPs = (
    script: string,
    env: Record<string, string>,
    timeoutMs = 20_000,
  ): { ok: boolean; out: string } => {
    const r = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', PS_CRED_HELPER + script],
      {
        encoding: 'utf-8',
        timeout: timeoutMs,
        windowsHide: true,
        env: { ...process.env, ...env },
      },
    );
    return { ok: !r.error && r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
  };
  const unsupportedPlatform = { ok: false, error: '仅 Windows 支持 Credential Manager' };

  return {
    available: () => isWin,

    promptAndWrite(id, prompt) {
      if (!isWin) return unsupportedPlatform;
      const script =
        PS_CRED_HELPER +
        String.raw`
$sec = Read-Host -AsSecureString $env:MAISON_CRED_PROMPT
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
try {
  $len = [Runtime.InteropServices.Marshal]::ReadInt32($bstr, -4)
  $c = New-Object Maison.Cred+CREDENTIAL
  $c.Type = 1; $c.TargetName = $env:MAISON_CRED_TARGET; $c.CredentialBlobSize = $len
  $c.CredentialBlob = $bstr; $c.Persist = 2; $c.UserName = 'maison'
  if (-not [Maison.Cred]::CredWriteW([ref]$c, 0)) { throw "CredWriteW failed" }
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}
Write-Output "OK"
`;
      const r = spawnSync(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
        {
          encoding: 'utf-8',
          timeout: 300_000,
          windowsHide: true,
          // stdin 必须继承真实 TTY——用 pipe 就没法隐藏输入，也就等于口令过管道
          stdio: ['inherit', 'pipe', 'inherit'],
          env: {
            ...process.env,
            MAISON_CRED_TARGET: credentialTargetName(id),
            MAISON_CRED_PROMPT: prompt,
          },
        },
      );
      const out = `${r.stdout ?? ''}`;
      if (r.error || r.status !== 0 || !/OK/.test(out)) {
        return { ok: false, error: (r.error?.message ?? out).trim().slice(0, 300) || '写入失败' };
      }
      return { ok: true };
    },

    inspect(id) {
      if (!isWin) return { state: 'absent', error: '仅 Windows 支持 Credential Manager' };
      // 只回**形态分类**，绝不回 blob 内容本身
      const script = String.raw`
$s = Read-Blob $env:MAISON_CRED_TARGET
if ($null -eq $s) {
  $t = Read-Blob $env:MAISON_CRED_TOMBSTONE
  if ($null -eq $t) { Write-Output "ABSENT" } else { Write-Output "BURNED $t" }
  exit 0
}
if ($s -match '^MAISON-CLAIM/([0-9a-f]{16})/') { Write-Output "INFLIGHT $($Matches[1])"; exit 0 }
if ($s -match '^\d{4,16}$') { Write-Output "READY" } else { Write-Output "UNSUPPORTED" }
`;
      const r = runPs(script, {
        MAISON_CRED_TARGET: credentialTargetName(id),
        MAISON_CRED_TOMBSTONE: tombstoneTargetName(id),
      });
      if (!r.ok) return { state: 'absent', error: r.out.trim().slice(0, 300) || '读取失败' };
      const out = r.out.trim();
      if (/^READY$/m.test(out)) return { state: 'ready' };
      const inflight = /^INFLIGHT ([0-9a-f]{16})$/m.exec(out);
      if (inflight) return { state: 'in_flight', nonce: inflight[1] };
      const burned = /^BURNED (.*)$/m.exec(out);
      if (burned) return { state: 'burned', reason: burned[1].trim() };
      if (/^UNSUPPORTED$/m.test(out)) return { state: 'unsupported' };
      if (/^ABSENT$/m.test(out)) return { state: 'absent' };
      return { state: 'absent', error: `无法解析凭据状态：${out.slice(0, 120)}` };
    },

    claimAndUnlock(id, keys, serial, nonce) {
      if (!isWin) return { outcome: 'error', error: '仅 Windows 支持 Credential Manager' };
      if (!/^[0-9a-f]{16}$/.test(nonce)) return { outcome: 'error', error: 'nonce 形态非法' };
      const map = Object.fromEntries(keys.map(k => [k.digit, [k.x, k.y]]));
      // 抢占 + 点击在**同一个进程**内完成：口令读出后既不回 Node 也不进 argv。
      const script = String.raw`
$target = $env:MAISON_CRED_TARGET
$nonce = $env:MAISON_CRED_NONCE
$pin = $null
# ---- 临界区：读 → 判形态 → 写 claim → 回读。必须原子，否则两个进程会同时"赢" ----
$mutex = Enter-MaisonMutex $env:MAISON_CRED_MUTEX ([int]$env:MAISON_CRED_MUTEX_WAIT_MS)
if ($null -eq $mutex) { Write-Output "MUTEXTIMEOUT"; exit 0 }
try {
  $s = Read-Blob $target
  if ($null -eq $s) { Write-Output "ABSENT"; exit 0 }
  if ($s -match '^MAISON-CLAIM/') { Write-Output "INFLIGHT"; exit 0 }
  if ($s -notmatch '^\d{4,16}$') { Write-Output "UNSUPPORTED"; exit 0 }
  Write-Blob $target ("MAISON-CLAIM/" + $nonce + "/" + $s)
  $back = Read-Blob $target
  if ($back -notmatch ('^MAISON-CLAIM/' + $nonce + '/')) { Write-Output "RACE"; exit 0 }
  $pin = $s
  $s = $null
} finally {
  Exit-MaisonMutex $mutex
}
# ---- 临界区结束。claim 已在凭据库里，它本身就是持久的排他标记，点击无需持锁 ----
$keys = $env:MAISON_CRED_KEYMAP | ConvertFrom-Json
$sn = $env:MAISON_CRED_SERIAL
foreach ($ch in $pin.ToCharArray()) {
  $xy = $keys."$ch"
  if (-not $xy) { throw "keypad missing digit" }
  & hdc -t $sn shell uitest uiInput click $xy[0] $xy[1] | Out-Null
  Start-Sleep -Milliseconds 200
}
$pin = $null
Write-Output "CLICKED"
`;
      const r = runPs(
        script,
        {
          MAISON_CRED_TARGET: credentialTargetName(id),
          MAISON_CRED_NONCE: nonce,
          MAISON_CRED_KEYMAP: JSON.stringify(map),
          MAISON_CRED_SERIAL: serial,
          MAISON_CRED_MUTEX: mutexNameFor(credentialTargetName(id)),
          MAISON_CRED_MUTEX_WAIT_MS: String(MUTEX_WAIT_MS),
        },
        60_000 + MUTEX_WAIT_MS,
      );
      const out = r.out.trim();
      if (/^CLICKED$/m.test(out)) return { outcome: 'clicked' };
      if (/^INFLIGHT$/m.test(out)) return { outcome: 'blocked_in_flight' };
      if (/^MUTEXTIMEOUT$/m.test(out)) return { outcome: 'blocked_mutex' };
      if (/^RACE$/m.test(out)) return { outcome: 'blocked_race' };
      if (/^ABSENT$/m.test(out)) return { outcome: 'absent' };
      if (/^UNSUPPORTED$/m.test(out)) return { outcome: 'unsupported' };
      return { outcome: 'error', error: out.slice(0, 300) || '解锁执行失败' };
    },

    commitUnlock(id, nonce) {
      if (!isWin) return unsupportedPlatform;
      if (!/^[0-9a-f]{16}$/.test(nonce)) return { ok: false, error: 'nonce 形态非法' };
      // 只有持有该 nonce 的 claim 才能被 commit——防止别的进程把状态推回 ready
      const script = String.raw`
$target = $env:MAISON_CRED_TARGET
$nonce = $env:MAISON_CRED_NONCE
$s = Read-Blob $target
if ($null -eq $s) { throw "credential missing" }
if ($s -notmatch ('^MAISON-CLAIM/' + $nonce + '/(\d{4,16})$')) { Write-Output "NOTMINE"; exit 0 }
Write-Blob $target $Matches[1]
Write-Output "OK"
`;
      const r = runPs(script, {
        MAISON_CRED_TARGET: credentialTargetName(id),
        MAISON_CRED_NONCE: nonce,
      });
      if (!r.ok) return { ok: false, error: r.out.trim().slice(0, 300) };
      if (/^NOTMINE$/m.test(r.out)) return { ok: false, error: 'claim 已不属于本次调用' };
      return /^OK$/m.test(r.out) ? { ok: true } : { ok: false, error: r.out.trim().slice(0, 300) };
    },

    burnCredential(id, reason) {
      if (!isWin) return unsupportedPlatform;
      // 先落墓碑再删凭据：反过来的话，中途崩溃会退化成"未登记"，用户看不到禁用原因。
      // 墓碑存在而凭据仍在，只是多一次提示，不影响安全（放行判定仍看凭据本身）。
      // 原因文本是中文：env 变量走系统 ANSI 代码页传给 PowerShell 会乱码，
      // 故以 base64(UTF-8) 传递，在脚本内解回。（真实 CM 集成用例实测命中）
      const script = String.raw`
$reason = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:MAISON_CRED_REASON_B64))
Write-Blob $env:MAISON_CRED_TOMBSTONE $reason
[Maison.Cred]::CredDeleteW($env:MAISON_CRED_TARGET, 1, 0) | Out-Null
$after = Read-Blob $env:MAISON_CRED_TARGET
if ($null -ne $after) { throw "credential still present after delete" }
Write-Output "OK"
`;
      const r = runPs(script, {
        MAISON_CRED_TARGET: credentialTargetName(id),
        MAISON_CRED_TOMBSTONE: tombstoneTargetName(id),
        MAISON_CRED_REASON_B64: Buffer.from(
          reason.replace(/[\r\n]+/g, ' ').slice(0, 400),
          'utf-8',
        ).toString('base64'),
      });
      return r.ok && /^OK$/m.test(r.out) ? { ok: true } : { ok: false, error: r.out.trim().slice(0, 300) };
    },

    remove(id) {
      if (!isWin) return unsupportedPlatform;
      const script = String.raw`
[Maison.Cred]::CredDeleteW($env:MAISON_CRED_TARGET, 1, 0) | Out-Null
[Maison.Cred]::CredDeleteW($env:MAISON_CRED_TOMBSTONE, 1, 0) | Out-Null
Write-Output "OK"
`;
      const r = runPs(script, {
        MAISON_CRED_TARGET: credentialTargetName(id),
        MAISON_CRED_TOMBSTONE: tombstoneTargetName(id),
      });
      return r.ok ? { ok: true } : { ok: false, error: r.out.trim().slice(0, 300) };
    },

    listVersions(serial) {
      if (!isWin) return { ok: false, error: '仅 Windows 支持 Credential Manager' };
      if (!isValidSerial(serial)) return { ok: false, error: `serial 含非法字符：${serial}` };
      // 枚举含墓碑与 reserve 占位——已烧毁的版本号绝不可被重新分配
      const script = String.raw`
$count = 0; $p = [IntPtr]::Zero
if (-not [Maison.Cred]::CredEnumerateW($env:MAISON_CRED_FILTER, 0, [ref]$count, [ref]$p)) {
  Write-Output "NONE"; exit 0
}
for ($i = 0; $i -lt $count; $i++) {
  $entry = [Runtime.InteropServices.Marshal]::ReadIntPtr($p, $i * [IntPtr]::Size)
  $c = [Runtime.InteropServices.Marshal]::PtrToStructure($entry, [Type][Maison.Cred+CREDENTIAL])
  Write-Output ("T " + $c.TargetName)
}
[Maison.Cred]::CredFree($p)
`;
      const r = runPs(script, { MAISON_CRED_FILTER: `MaisonDeviceUnlock:${serial}:v*` });
      if (!r.ok) return { ok: false, error: r.out.trim().slice(0, 300) };
      if (/^NONE$/m.test(r.out)) return { ok: true, versions: [] };
      const versions = new Set<number>();
      for (const line of r.out.split(/\r?\n/)) {
        const m = /^T MaisonDeviceUnlock:.+:v(\d+)(?:#\w+)?$/.exec(line.trim());
        if (m) versions.add(Number(m[1]));
      }
      return { ok: true, versions: [...versions] };
    },

    reserveVersion(serial, version, nonce) {
      if (!isWin) return { ok: false, error: '仅 Windows 支持 Credential Manager' };
      if (!isValidSerial(serial)) return { ok: false, error: `serial 含非法字符：${serial}` };
      if (!/^[0-9a-f]{16}$/.test(nonce)) return { ok: false, error: 'nonce 形态非法' };
      // 版本抢占同样是**读改写**，同样不能靠 CredWrite 的覆盖语义充当 CAS：
      // 两个进程都读到"没人占"，然后各写各的 nonce，后写的赢——但先写的也会
      // 回读到……不，回读到的是后者，于是先写的判 TAKEN。问题在于**先回读的那个**
      // 可能读到自己、随后被覆盖，两边都认为拿到了同一版本号 → 共用一个 CM target。
      // 故与解锁临界区同一处理：OS named mutex 保护整段读改写。
      const script = String.raw`
$mutex = Enter-MaisonMutex $env:MAISON_CRED_MUTEX ([int]$env:MAISON_CRED_MUTEX_WAIT_MS)
if ($null -eq $mutex) { Write-Output "MUTEXTIMEOUT"; exit 0 }
try {
  if ($null -ne (Read-Blob $env:MAISON_CRED_TARGET)) { Write-Output "TAKEN"; exit 0 }
  if ($null -ne (Read-Blob $env:MAISON_CRED_TOMBSTONE)) { Write-Output "TAKEN"; exit 0 }
  $existing = Read-Blob $env:MAISON_CRED_RESERVE
  if ($null -ne $existing -and $existing -ne $env:MAISON_CRED_NONCE) { Write-Output "TAKEN"; exit 0 }
  Write-Blob $env:MAISON_CRED_RESERVE $env:MAISON_CRED_NONCE
  if ((Read-Blob $env:MAISON_CRED_RESERVE) -ne $env:MAISON_CRED_NONCE) { Write-Output "TAKEN"; exit 0 }
  Write-Output "WON"
} finally {
  Exit-MaisonMutex $mutex
}
`;
      const r = runPs(script, {
        MAISON_CRED_TARGET: credentialTargetName({ serial, version }),
        MAISON_CRED_TOMBSTONE: tombstoneTargetName({ serial, version }),
        MAISON_CRED_RESERVE: reserveTargetName(serial, version),
        MAISON_CRED_NONCE: nonce,
        // 按 **serial** 取锁：版本分配对同一台设备必须整体串行，
        // 按 version 取锁的话两个进程各锁各的版本号，等于没锁。
        MAISON_CRED_MUTEX: mutexNameFor(`alloc:${serial}`),
        MAISON_CRED_MUTEX_WAIT_MS: String(MUTEX_WAIT_MS),
      }, 20_000 + MUTEX_WAIT_MS);
      if (!r.ok) return { ok: false, error: r.out.trim().slice(0, 300) };
      if (/^MUTEXTIMEOUT$/m.test(r.out)) {
        return { ok: false, error: '未能取得版本分配互斥（另一进程正在登记同一台设备）' };
      }
      return { ok: true, won: /^WON$/m.test(r.out) };
    },
  };
}
