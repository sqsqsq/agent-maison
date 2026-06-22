/**
 * Resolve headless CLI binaries on PATH (preflight + spawn share this logic).
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
}

function pickBestCandidate(lines: string[]): ResolvedHeadlessBinary | null {
  const trimmed = lines.map((l) => l.trim()).filter(Boolean);
  if (trimmed.length === 0) return null;
  const exe = trimmed.find((l) => /\.exe$/i.test(l));
  if (exe) return { path: exe, kind: 'exe' };
  const cmd = trimmed.find((l) => /\.(cmd|bat)$/i.test(l));
  if (cmd) return { path: cmd, kind: 'cmd' };
  return { path: trimmed[0]!, kind: 'bare' };
}

function resolveViaWhereExe(name: string): ResolvedHeadlessBinary | null {
  const result = spawnSync('where.exe', [name], { encoding: 'utf-8', shell: false });
  if (result.status !== 0 || !result.stdout?.trim()) return null;
  return pickBestCandidate(result.stdout.trim().split(/\r?\n/));
}

function resolveViaPathWalk(name: string): ResolvedHeadlessBinary | null {
  const pathEnv = process.env.PATH ?? '';
  const sep = process.platform === 'win32' ? ';' : ':';
  const pathext =
    process.platform === 'win32'
      ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').map((e) => e.toLowerCase())
      : [''];

  const dirs = pathEnv.split(sep).filter(Boolean);
  let cmdFallback: ResolvedHeadlessBinary | null = null;

  for (const dir of dirs) {
    for (const ext of pathext) {
      const candidate = path.join(dir, name + ext);
      if (!fs.existsSync(candidate)) continue;
      if (ext.toLowerCase() === '.exe') {
        return { path: candidate, kind: 'exe' };
      }
      if (!cmdFallback && (ext.toLowerCase() === '.cmd' || ext.toLowerCase() === '.bat')) {
        cmdFallback = { path: candidate, kind: 'cmd' };
      }
    }
    const bare = path.join(dir, name);
    if (
      fs.existsSync(bare) &&
      !bare.toLowerCase().endsWith('.cmd') &&
      !bare.toLowerCase().endsWith('.bat')
    ) {
      return { path: bare, kind: 'bare' };
    }
  }
  return cmdFallback;
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

function resolveViaKnownDirs(name: string): ResolvedHeadlessBinary | null {
  if (process.platform !== 'win32') return null;
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return null;

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
      return { path: path.join(dir, name), kind: 'bare', inaccessible: true };
    }
    for (const ext of pathext) {
      const candidate = path.join(dir, name + ext);
      const probe = probeFileAccess(candidate);
      if (probe === 'missing') continue;
      const kind: HeadlessBinaryKind =
        ext === '.exe' ? 'exe' : ext === '.cmd' || ext === '.bat' ? 'cmd' : 'bare';
      if (probe === 'inaccessible') {
        return { path: candidate, kind, inaccessible: true };
      }
      return { path: candidate, kind };
    }
  }
  return null;
}

/** Try candidates in order; prefer .exe over .cmd on Windows. */
export function resolveHeadlessBinary(candidates: string[]): ResolvedHeadlessBinary | null {
  for (const name of candidates) {
    if (!name?.trim()) continue;
    const n = name.trim();
    if (process.platform === 'win32') {
      const viaWhere = resolveViaWhereExe(n);
      if (viaWhere) return viaWhere;
    } else {
      const viaWhich = resolveViaWhich(n);
      if (viaWhich) return viaWhich;
    }
    const viaWalk = resolveViaPathWalk(n);
    if (viaWalk) return viaWalk;
    const viaKnown = resolveViaKnownDirs(n);
    if (viaKnown) return viaKnown;
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

export function headlessBinarySpawnable(binary: ResolvedHeadlessBinary | null): boolean {
  if (!binary) return false;
  if (process.platform !== 'win32') return true;
  if (binary.kind === 'cmd') return crossSpawnAvailable();
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
