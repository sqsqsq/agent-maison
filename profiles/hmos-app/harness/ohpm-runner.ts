// ============================================================================
// ohpm-runner.ts — HarmonyOS 工程依赖安装（ohpm install）
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { featurePhaseReportsDir } from '../../../harness/config';
import { buildChildEnv, resolveDevEcoInstallRoot } from './hvigor-runner';

export type OhpmInstallClassification =
  | 'ok'
  | 'toolchain_unavailable'
  | 'registry_unreachable'
  | 'auth_required'
  | 'network'
  | 'unknown';

export interface OhpmSpawnPlan {
  spawnFile: string;
  spawnArgs: string[];
  useShell: boolean;
  commandDisplay: string;
  source: 'deveco_install_path' | 'path';
}

export interface OhpmInstallResult {
  executed: boolean;
  ok: boolean;
  exitCode?: number;
  durationMs: number;
  classification: OhpmInstallClassification;
  command?: string;
  logPath?: string;
  metaPath?: string;
  logExcerpt?: string;
}

export interface OhpmInstallOpts {
  projectRoot: string;
  harnessRoot: string;
  feature: string;
  phase: string;
  frameworkRoot?: string;
}

const DEFAULT_OHPM_TIMEOUT_MS = 10 * 60 * 1000;
const LOG_EXCERPT_CHARS = 8000;

function quoteCmdArgWin(arg: string): string {
  if (/[\s"]/.test(arg)) return `"${arg.replace(/"/g, '\\"')}"`;
  return arg;
}

/**
 * 独立解析 ohpm 可执行文件（与 hvigorw.js 路径/调用方式不同）。
 */
export function resolveOhpmSpawnPlan(projectRoot: string): OhpmSpawnPlan | { toolMissing: true } {
  const isWin = process.platform === 'win32';
  const root = resolveDevEcoInstallRoot(projectRoot);
  if (!root) {
    return { toolMissing: true };
  }

  const binDir = path.join(root, 'tools', 'ohpm', 'bin');
  const candidates = isWin ? ['ohpm.bat', 'ohpm.cmd', 'ohpm'] : ['ohpm'];
  for (const name of candidates) {
    const full = path.join(binDir, name);
    if (fs.existsSync(full)) {
      const args = ['install'];
      const display = `${quoteCmdArgWin(full)} ${args.join(' ')}`;
      return {
        spawnFile: full,
        spawnArgs: args,
        useShell: isWin && (name.endsWith('.bat') || name.endsWith('.cmd')),
        commandDisplay: display,
        source: 'deveco_install_path',
      };
    }
  }

  return { toolMissing: true };
}

export function classifyOhpmInstallFailure(
  log: string,
  exitCode: number | undefined,
): OhpmInstallClassification {
  if (exitCode === 0) return 'ok';
  const text = log.toLowerCase();
  if (/401|403|unauthorized|authentication|auth failed|permission denied|access denied/.test(text)) {
    return 'auth_required';
  }
  if (/econnrefused|enotfound|etimedout|network|socket|connect timeout|getaddrinfo/.test(text)) {
    return 'network';
  }
  if (/registry|404 not found|package not found|cannot find package|repo.*unreachable/.test(text)) {
    return 'registry_unreachable';
  }
  return 'unknown';
}

function ensureReportDir(
  projectRoot: string,
  feature: string,
  phase: string,
  frameworkRoot?: string,
): string {
  const dir = featurePhaseReportsDir(projectRoot, feature, phase, frameworkRoot);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function excerptLog(text: string): string {
  const compact = text.replace(/\r/g, '');
  return compact.length <= LOG_EXCERPT_CHARS
    ? compact
    : compact.slice(-LOG_EXCERPT_CHARS);
}

export function installProjectDeps(opts: OhpmInstallOpts): OhpmInstallResult {
  const t0 = Date.now();
  const resolved = resolveOhpmSpawnPlan(opts.projectRoot);

  if ('toolMissing' in resolved) {
    return {
      executed: false,
      ok: false,
      durationMs: Date.now() - t0,
      classification: 'toolchain_unavailable',
      logExcerpt:
        '未找到 ohpm 可执行文件。请在 framework.local.json > toolchain.devEcoStudio.installPath 配置 DevEco 安装根目录。',
    };
  }

  const dir = ensureReportDir(opts.projectRoot, opts.feature, opts.phase, opts.frameworkRoot);
  const logAbs = path.join(dir, 'ohpm-install.log');
  const metaAbs = path.join(dir, 'ohpm-install.meta.json');
  const commandDisplay = resolved.commandDisplay;
  const header = `$ ${commandDisplay}\n\n`;

  let logFd: number;
  try {
    logFd = fs.openSync(logAbs, 'w');
  } catch (err) {
    const e = err as Error;
    return {
      executed: false,
      ok: false,
      durationMs: Date.now() - t0,
      classification: 'unknown',
      logExcerpt: `[open log error] ${e.message}`,
    };
  }

  fs.writeSync(logFd, header, undefined, 'utf-8');
  const childEnv = buildChildEnv(opts.projectRoot);

  const spawnRet = resolved.useShell
    ? spawnSync(resolved.commandDisplay, [], {
        cwd: opts.projectRoot,
        shell: true,
        env: childEnv,
        timeout: DEFAULT_OHPM_TIMEOUT_MS,
        encoding: 'utf-8',
      })
    : spawnSync(resolved.spawnFile, resolved.spawnArgs, {
        cwd: opts.projectRoot,
        shell: false,
        env: childEnv,
        timeout: DEFAULT_OHPM_TIMEOUT_MS,
        encoding: 'utf-8',
      });

  const stdout = spawnRet.stdout?.toString() ?? '';
  const stderr = spawnRet.stderr?.toString() ?? '';
  const combined = `${stdout}\n${stderr}`;
  fs.writeSync(logFd, combined, undefined, 'utf-8');
  fs.closeSync(logFd);

  const exitCode = spawnRet.status ?? (spawnRet.error ? 1 : 0);
  const classification = classifyOhpmInstallFailure(combined, exitCode);
  const ok = exitCode === 0 && classification === 'ok';

  const meta = {
    tool: 'ohpm',
    command: commandDisplay,
    cwd: opts.projectRoot,
    exitCode,
    durationMs: Date.now() - t0,
    classification,
    source: resolved.source,
    logFile: 'ohpm-install.log',
  };
  fs.writeFileSync(metaAbs, JSON.stringify(meta, null, 2), 'utf-8');

  return {
    executed: true,
    ok,
    exitCode,
    durationMs: Date.now() - t0,
    classification,
    command: commandDisplay,
    logPath: logAbs,
    metaPath: metaAbs,
    logExcerpt: excerptLog(combined),
  };
}
