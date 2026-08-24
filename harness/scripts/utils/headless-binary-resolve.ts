/**
 * Resolve headless CLI binaries on PATH (preflight + spawn share this logic).
 *
 * plan c4e8a1f7 T1a（宿主运行边界真值）：Windows 解析真值——
 *  - adapter candidate-name 顺序保持（外层循环）；每个 name 内按 where.exe/PATH 目录
 *    原顺序取**首个明确受支持且可 spawn** 的 Windows 执行形态；
 *  - 不再跨目录全局偏好 `.exe`（旧 pickBestCandidate / resolveViaPathWalk 会跳过前面
 *    目录的 npm `codex.cmd` 去选后置 WindowsApps `codex.exe`，宿主实锤）；
 *  - extensionless 文件必须为原生 PE（MZ 头）才算可 spawn 的 Windows 执行形态；
 *    `#!/bin/sh` POSIX shim 与 ELF（0x7F 'ELF'）不得仅凭存在入选（CreateProcess 对它们
 *    要么 Access denied 要么 ERROR_BAD_EXE_FORMAT）；
 *  - 被跳过/后置候选记入 shadowed[]（上限 10），供 adapter_probe 诊断展示。
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

export type HeadlessBinaryKind = 'exe' | 'cmd' | 'bare';

export interface ResolvedHeadlessBinary {
  /** Executable path or bare command name when only bare resolution succeeded. */
  path: string;
  kind: HeadlessBinaryKind;
  /** File exists at known path but access was denied (EPERM/EACCES, e.g. sandbox). */
  inaccessible?: boolean;
  /**
   * plan c4e8a1f7 T1a：解析过程中评估过但未选中的候选（不支持形态 / 后置优先级），
   * 供 adapter_probe 诊断展示（有界 ≤ SHADOWED_CAP_LIMIT）。
   */
  shadowed?: string[];
}

const SHADOWED_CAP_LIMIT = 10;

function pushShadowed(shadowed: string[], entry: string): void {
  if (shadowed.length >= SHADOWED_CAP_LIMIT) return;
  if (!shadowed.includes(entry)) shadowed.push(entry);
}

/**
 * 探测单个候选文件的执行形态（Windows 语义）：
 *  - 'exe'：`.exe` 扩展名；
 *  - 'cmd'：`.cmd/.bat`（经 cross-spawn/containment 解包执行）；
 *  - 'bare_native'：无扩展名且文件头为原生 PE（MZ）——CreateProcess 可执行的裸形态；
 *  - 'shim'：无扩展名且文件头为 POSIX shebang（`#!`）——Windows 上不可直接 spawn；
 *  - 'elf'：无扩展名且为 ELF 文件头——Windows 上不可直接 spawn；
 *  - 'unsupported'：其余无扩展名形态（不可判定为可 spawn 的 Windows 执行形态）；
 *  - 'missing' / 'inaccessible'：文件不存在 / 存在但不可读（EPERM/EACCES 类）。
 */
export type CandidateForm =
  | 'exe' | 'cmd' | 'bare_native' | 'shim' | 'elf' | 'unsupported' | 'missing' | 'inaccessible';

/** 读文件头（≤8 字节）判执行形态；不存在/不可读返回对应探测结果。 */
export function probeCandidateForm(absPath: string): CandidateForm {
  let fd: number | null = null;
  try {
    fd = fs.openSync(absPath, 'r');
    const buf = Buffer.alloc(8);
    const read = fs.readSync(fd, buf, 0, 8, 0);
    const ext = path.extname(absPath).toLowerCase();
    if (ext === '.exe') return 'exe';
    if (ext === '.cmd' || ext === '.bat') return 'cmd';
    if (read >= 2 && buf[0] === 0x4d && buf[1] === 0x5a) return 'bare_native'; // MZ
    if (read >= 2 && buf[0] === 0x23 && buf[1] === 0x21) return 'shim'; // #!
    if (read >= 4 && buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46) {
      return 'elf'; // \x7fELF
    }
    return 'unsupported';
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') return 'missing';
    return 'inaccessible';
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

/** 该形态是否 Maison 在 Windows 明确支持的执行形态（可 spawn 前提）。 */
export function isSupportedCandidateForm(form: CandidateForm): boolean {
  return form === 'exe' || form === 'cmd' || form === 'bare_native';
}

/**
 * 把 where.exe 逐行输出按原顺序扫描为第一个受支持候选。
 * 旧实现 pickBestCandidate 全局找任意 .exe——跨目录偏好正是事故根因（fact #3/#4）。
 */
function pickBestCandidate(lines: string[]): { binary: ResolvedHeadlessBinary | null; shadowed: string[] } {
  const trimmed = lines.map((l) => l.trim()).filter(Boolean);
  const shadowed: string[] = [];
  if (trimmed.length === 0) return { binary: null, shadowed };
  let inaccessibleFallback: ResolvedHeadlessBinary | null = null;
  for (const line of trimmed) {
    const form = probeCandidateForm(line);
    if (form === 'shim' || form === 'elf' || form === 'unsupported' || form === 'missing') {
      pushShadowed(shadowed, `${line} (unsupported:${form})`);
      continue;
    }
    if (form === 'inaccessible') {
      // 存在但无法读取——记录为兜底（preflight 会给出 EPERM 指引），继续扫描后续候选。
      if (!inaccessibleFallback) {
        inaccessibleFallback = {
          path: line,
          kind: 'bare',
          inaccessible: true,
          ...(shadowed.length > 0 ? { shadowed: [...shadowed] } : {}),
        };
      }
      continue;
    }
    const kind: HeadlessBinaryKind = form === 'cmd' ? 'cmd' : form === 'exe' ? 'exe' : 'bare';
    // 评审 P2：命中后把**后置**候选记入 shadowed（遮蔽诊断显示完整优先级序列，
    // 如 npm codex.cmd 当选时 WindowsApps codex/codex.exe 也可见）。
    for (const later of trimmed.slice(trimmed.indexOf(line) + 1)) {
      pushShadowed(shadowed, `${later} (lower-priority)`);
    }
    return { binary: { path: line, kind, ...(shadowed.length > 0 ? { shadowed } : {}) }, shadowed };
  }
  // 无受支持候选：若有不可访问候选则以 inaccessible 身份返回（诊断用），否则 null。
  if (inaccessibleFallback) return { binary: inaccessibleFallback, shadowed };
  return { binary: null, shadowed };
}

function resolveViaWhereExe(name: string): { binary: ResolvedHeadlessBinary | null; shadowed: string[] } {
  const result = spawnSync('where.exe', [name], { encoding: 'utf-8', shell: false });
  if (result.status !== 0 || !result.stdout?.trim()) return { binary: null, shadowed: [] };
  return pickBestCandidate(result.stdout.trim().split(/\r?\n/));
}

/**
 * PATH 目录序走查（where.exe/which 不可用/无命中时的回退）：
 *  - 目录按 PATH 顺序；每个目录内按 PATHEXT 顺序取首个受支持候选——**不得跨目录**
 *    为 `.exe` 跳过前面目录的 `.cmd`（旧实现正是如此，fact #3）；
 *  - Windows：扩展名缺失的裸文件须为原生 PE（MZ）才算可 spawn；shim/ELF 一律跳过记 shadowed；
 *  - 非 Windows（评审 P2 修复）：POSIX 平台裸文件（ELF/shebang）本就是合法可 spawn 执行形态，
 *    不得套用 PE/MZ 判定——首个存在的候选即当选（旧语义）。
 */
function resolveViaPathWalk(name: string): { binary: ResolvedHeadlessBinary | null; shadowed: string[] } {
  const pathEnv = process.env.PATH ?? '';
  const sep = process.platform === 'win32' ? ';' : ':';
  const pathext =
    process.platform === 'win32'
      ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').map((e) => e.toLowerCase())
      : [''];

  const isWin = process.platform === 'win32';
  const shadowed: string[] = [];
  const dirs = pathEnv.split(sep).filter(Boolean);
  // 注意：不再保留 cmdFallback 延迟返回——首个目录内的首个受支持形态即选中。
  for (const dir of dirs) {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
    // where.exe 逐目录输出序（plan c4e8a1f7 fact #4 实测：npm codex→codex.cmd）——
    // 裸名先于 PATHEXT 扩展名；win32 裸名须为原生 PE（MZ）才算受支持形态，shim/ELF 跳过记诊断。
    const bare = path.join(dir, name);
    if (fs.existsSync(bare) && !bare.toLowerCase().endsWith('.cmd') && !bare.toLowerCase().endsWith('.bat')) {
      if (!isWin) {
        // POSIX：裸文件（ELF/shebang/任意可执行）直接当选（旧语义，完整性优先）
        return { binary: { path: bare, kind: 'bare', ...(shadowed.length > 0 ? { shadowed } : {}) }, shadowed };
      }
      const bareForm = probeCandidateForm(bare);
      if (bareForm === 'bare_native') {
        // 命中后把同目录后续 PATHEXT 候选与其余目录候选记入 shadowed（评审 P2：
        // 遮蔽诊断要显示**后置**候选，不只有前置 shim）。
        collectLowerPriorityShadows(name, dirs, dir, shadowed);
        return { binary: { path: bare, kind: 'bare', ...(shadowed.length > 0 ? { shadowed } : {}) }, shadowed };
      }
      if (bareForm === 'inaccessible') {
        return {
          binary: { path: bare, kind: 'bare', inaccessible: true, ...(shadowed.length > 0 ? { shadowed } : {}) },
          shadowed,
        };
      }
      pushShadowed(shadowed, `${bare} (unsupported:${bareForm})`);
    }
    for (const ext of pathext) {
      const candidate = path.join(dir, name + ext);
      if (!fs.existsSync(candidate)) continue;
      const form = probeCandidateForm(candidate);
      if (isSupportedCandidateForm(form)) {
        const kind: HeadlessBinaryKind = form === 'cmd' ? 'cmd' : form === 'exe' ? 'exe' : 'bare';
        collectLowerPriorityShadows(name, dirs, dir, shadowed, ext);
        return { binary: { path: candidate, kind, ...(shadowed.length > 0 ? { shadowed } : {}) }, shadowed };
      }
      pushShadowed(shadowed, `${candidate} (unsupported:${form})`);
    }
  }
  return { binary: null, shadowed };
}

/**
 * 命中后把**后置**候选记入 shadowed（评审 P2：遮蔽诊断应显示完整优先级序列，
 * 如 npm codex.cmd 当选时 WindowsApps codex/codex.exe 也应可见）。
 * startDir 为命中目录、startExt 为命中扩展名（缺省=裸名命中，跳过同目录 PATHEXT 中
 * 已扫描部分之外的全部）。有界：受 pushShadowed 全局 10 条上限约束。
 */
function collectLowerPriorityShadows(
  name: string,
  dirs: string[],
  startDir: string,
  shadowed: string[],
  startExt = '',
): void {
  const isWin = process.platform === 'win32';
  const pathext =
    isWin
      ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').map((e) => e.toLowerCase())
      : [''];
  let sawStartDir = false;
  for (const dir of dirs) {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
    if (!sawStartDir) {
      if (dir === startDir) sawStartDir = true;
      else continue; // 命中目录之前的目录已扫描过
    }
    // 同目录：从命中扩展名之后继续；裸名已处理
    if (dir === startDir && startExt) {
      const startIdx = pathext.indexOf(startExt);
      for (let i = startIdx + 1; i < pathext.length; i++) {
        const c = path.join(dir, name + pathext[i]);
        if (fs.existsSync(c)) pushShadowed(shadowed, `${c} (lower-priority)`);
      }
      continue;
    }
    if (dir === startDir) {
      // 裸名命中（startExt=''）：同目录 PATHEXT 候选在 resolveViaPathWalk 中尚未扫描
      // （裸名检查先于扩展名循环），评审 P2 修复——全部记入 lower-priority 诊断。
      for (const ext of pathext) {
        if (!ext) continue;
        const c = path.join(dir, name + ext);
        if (fs.existsSync(c)) pushShadowed(shadowed, `${c} (lower-priority)`);
      }
      continue;
    }
    // 后置目录：全部候选记入
    for (const ext of pathext) {
      const c = path.join(dir, name + ext);
      if (fs.existsSync(c)) pushShadowed(shadowed, `${c} (lower-priority)`);
    }
    const bareLater = path.join(dir, name);
    if (fs.existsSync(bareLater) && !bareLater.toLowerCase().endsWith('.cmd') && !bareLater.toLowerCase().endsWith('.bat')) {
      pushShadowed(shadowed, `${bareLater} (lower-priority)`);
    }
  }
}

function resolveViaWhich(name: string): ResolvedHeadlessBinary | null {
  const result = spawnSync('which', [name], { encoding: 'utf-8', shell: false });
  if (result.status !== 0 || !result.stdout?.trim()) return null;
  const p = result.stdout.trim();
  if (/\.(cmd|bat)$/i.test(p)) return { path: p, kind: 'cmd' };
  if (/\.exe$/i.test(p)) return { path: p, kind: 'exe' };
  return { path: p, kind: 'bare' };
}

/**
 * Windows well-known install dirs for headless CLIs not always on PATH.
 * Cursor Agent CLI installs to %LOCALAPPDATA%\cursor-agent\ but the
 * installer may not add it to the system/user PATH (Cursor desktop
 * injects it into its own terminal profile, other shells may lack it).
 */
function probeFileAccess(filePath: string): 'ok' | 'missing' | 'inaccessible' {
  try {
    fs.accessSync(filePath, fs.constants.R_OK);
    return 'ok';
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') return 'missing';
    return 'inaccessible';
  }
}

function resolveViaKnownDirs(name: string): { binary: ResolvedHeadlessBinary | null; shadowed: string[] } {
  if (process.platform !== 'win32') return { binary: null, shadowed: [] };
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return { binary: null, shadowed: [] };

  const shadowed: string[] = [];
  const knownDirs = [
    path.join(localAppData, 'cursor-agent'),
    path.join(localAppData, 'chrys', 'bin'),
  ];
  const pathext = (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM')
    .split(';')
    .map((e) => e.toLowerCase());

  for (const dir of knownDirs) {
    const dirProbe = probeFileAccess(dir);
    if (dirProbe === 'missing') continue;
    if (dirProbe === 'inaccessible') {
      return {
        binary: { path: path.join(dir, name), kind: 'bare', inaccessible: true, ...(shadowed.length > 0 ? { shadowed } : {}) },
        shadowed,
      };
    }
    for (const ext of pathext) {
      const candidate = path.join(dir, name + ext);
      const probe = probeFileAccess(candidate);
      if (probe === 'missing') continue;
      const kind: HeadlessBinaryKind =
        ext === '.exe' ? 'exe' : ext === '.cmd' || ext === '.bat' ? 'cmd' : 'bare';
      if (probe === 'inaccessible') {
        return {
          binary: { path: candidate, kind, inaccessible: true, ...(shadowed.length > 0 ? { shadowed } : {}) },
          shadowed,
        };
      }
      // 扩展名缺失时同样执行形态探测（known-dirs 内的裸 shim 不得冒充可 spawn）
      if (kind === 'bare') {
        const form = probeCandidateForm(candidate);
        if (form === 'bare_native') {
          return { binary: { path: candidate, kind, ...(shadowed.length > 0 ? { shadowed } : {}) }, shadowed };
        }
        pushShadowed(shadowed, `${candidate} (unsupported:${form})`);
        continue;
      }
      return { binary: { path: candidate, kind, ...(shadowed.length > 0 ? { shadowed } : {}) }, shadowed };
    }
  }
  return { binary: null, shadowed };
}

/**
 * 解析结果（含诊断）：adapter candidate-name 顺序不变；每个 name 内取首个受支持且
 * 可 spawn 的 Windows 执行形态。win32 上不跨目录偏好 .exe；extensionless shim 不入选。
 */
export function resolveHeadlessBinary(
  candidates: string[],
): ResolvedHeadlessBinary | null {
  const allShadowed: string[] = [];
  const mergeShadowed = (extra: string[] | undefined): string[] => {
    // 评审 P2：聚合后**全局**保持 ≤ SHADOWED_CAP_LIMIT 条（pushShadowed 只保证单数组内部）
    const out = [...allShadowed, ...(extra ?? [])];
    return out.slice(0, SHADOWED_CAP_LIMIT);
  };
  for (const name of candidates) {
    if (!name?.trim()) continue;
    const n = name.trim();
    if (process.platform === 'win32') {
      const { binary, shadowed } = resolveViaWhereExe(n);
      if (binary) return { ...binary, shadowed: mergeShadowed(shadowed) };
      allShadowed.push(...shadowed);
    } else {
      const viaWhich = resolveViaWhich(n);
      if (viaWhich) return viaWhich;
    }
    const { binary: viaWalk, shadowed: walkShadowed } = resolveViaPathWalk(n);
    if (viaWalk) return { ...viaWalk, shadowed: mergeShadowed(walkShadowed) };
    allShadowed.push(...walkShadowed);
    const { binary: viaKnown, shadowed: knownShadowed } = resolveViaKnownDirs(n);
    if (viaKnown) return { ...viaKnown, shadowed: mergeShadowed(knownShadowed) };
    allShadowed.push(...knownShadowed);
  }
  return null;
}

/** cross-spawn required to run Windows .cmd/.bat with arguments (Node CVE-2024-27980). */
export function crossSpawnAvailable(): boolean {
  try {
    require.resolve('cross-spawn');
    return true;
  } catch {
    return false;
  }
}

export function shouldUseCrossSpawn(binary: ResolvedHeadlessBinary | null | undefined): boolean {
  return process.platform === 'win32' && binary?.kind === 'cmd' && crossSpawnAvailable();
}

/**
 * 可 spawn 判据（两级防线：解析时已过滤 + 消费侧复检）：
 *  - win32 上 .cmd/.bat 需要 cross-spawn；
 *  - win32 上 bare（无扩展名）必须是原生 PE（MZ 头）——shim/ELF 一律不可 spawn。
 */
export function headlessBinarySpawnable(binary: ResolvedHeadlessBinary | null): boolean {
  if (!binary) return false;
  if (process.platform !== 'win32') return true;
  if (binary.kind === 'cmd') return crossSpawnAvailable();
  if (binary.kind === 'bare') {
    if (binary.inaccessible) return false; // 评审 P1-2：inaccessible bare 不得判可 spawn
    if (!fs.existsSync(binary.path)) return false;
    const form = probeCandidateForm(binary.path);
    return form === 'bare_native';
  }
  return true;
}

export function formatHeadlessBinaryIssue(
  adapterLabel: string,
  candidates: string[],
  binary: ResolvedHeadlessBinary | null,
): string {
  if (!binary) {
    return (
      `[goal-runner] preflight BLOCKER: ${adapterLabel} 无头 CLI 未在 PATH 中找到` +
      `（已尝试: ${candidates.join(', ')}）。请安装对应 CLI 并确保在 PATH 中。`
    );
  }
  if (binary.inaccessible) {
    return (
      `[goal-runner] preflight BLOCKER: 在 ${binary.path} 找到 ${adapterLabel} 无头 CLI` +
      ` 但当前进程无权访问（EPERM，疑似沙箱/权限限制）——请从非沙箱 shell 运行。`
    );
  }
  if (!headlessBinarySpawnable(binary)) {
    return (
      `[goal-runner] preflight BLOCKER: ${adapterLabel} 无头 CLI 解析为 Windows .cmd 垫片` +
      `（${binary.path}），需要 cross-spawn 才能 spawn。请在 framework/harness 执行 npm install。`
    );
  }
  return '';
}