/**
 * Warm up doc/app-snapshot-cache/<bundle>/ when empty (dump-ui + page save).
 */
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { resolveHylyreToolConfig } from '../../../harness/config';
import { buildHylyreAppPageSaveArgv } from './device-test-page-save';
import { hdcTargetPrefix, resolveHdcExecutableSync } from './hdc-runner';

export interface SnapshotWarmupOptions {
  projectRoot: string;
  bundleName: string;
  mainAbility: string;
  pythonPath: string;
  appSnapshotCacheAbs: string;
  hypiumWorkDir: string;
  deviceSn?: string;
  logPath?: string;
  pageSlug?: string;
}

export interface SnapshotWarmupResult {
  ok: boolean;
  skipped: boolean;
  reason?: string;
  pageSaveExitCode?: number | null;
  log: string;
}

export function isAppSnapshotCacheEmpty(appSnapshotCacheAbs: string, bundleName: string): boolean {
  const pagesDir = path.join(appSnapshotCacheAbs, bundleName, 'pages');
  if (!fs.existsSync(pagesDir)) return true;
  try {
    const entries = fs.readdirSync(pagesDir);
    return !entries.some(f => f.endsWith('.json'));
  } catch {
    return true;
  }
}

function appendLog(logPath: string | undefined, line: string): void {
  if (!logPath) return;
  try {
    fs.appendFileSync(logPath, line, 'utf-8');
  } catch {
    /* ignore */
  }
}

function runAaStart(bundle: string, ability: string, deviceSn: string | undefined, logPath?: string): boolean {
  const args = [...hdcTargetPrefix(), 'shell', 'aa', 'start', '-a', ability, '-b', bundle];
  appendLog(logPath, `$ hdc ${args.join(' ')}\n`);
  const hdcExe = resolveHdcExecutableSync();
  const useShell = process.platform === 'win32' && hdcExe === 'hdc';
  const r = spawnSync(hdcExe, args, {
    encoding: 'utf-8',
    shell: useShell,
    timeout: 120_000,
    maxBuffer: 2 * 1024 * 1024,
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  appendLog(logPath, out);
  return r.status === 0;
}

export function ensureAppSnapshotWarmup(opts: SnapshotWarmupOptions): SnapshotWarmupResult {
  const logLines: string[] = [];
  if (!isAppSnapshotCacheEmpty(opts.appSnapshotCacheAbs, opts.bundleName)) {
    return { ok: true, skipped: true, reason: 'cache_nonempty', log: 'snapshot cache already has pages\n' };
  }

  logLines.push(`snapshot warmup: cache empty for ${opts.bundleName}\n`);
  if (!runAaStart(opts.bundleName, opts.mainAbility, opts.deviceSn, opts.logPath)) {
    const msg = 'aa start failed during snapshot warmup';
    logLines.push(msg + '\n');
    return { ok: false, skipped: false, reason: msg, log: logLines.join('') };
  }

  const dumpArgs = ['-m', 'hylyre', 'dump-ui'];
  if (opts.deviceSn?.trim()) dumpArgs.push('--device-sn', opts.deviceSn.trim());
  appendLog(opts.logPath, `$ ${opts.pythonPath} ${dumpArgs.join(' ')}\n`);
  const dump = spawnSync(opts.pythonPath, dumpArgs, {
    cwd: opts.hypiumWorkDir,
    encoding: 'utf-8',
    env: { ...process.env, HYLYRE_APP_STORE_DIR: opts.appSnapshotCacheAbs },
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  const dumpOut = `${dump.stdout ?? ''}${dump.stderr ?? ''}`;
  appendLog(opts.logPath, dumpOut);
  logLines.push(`dump-ui exit=${dump.status}\n`);

  const saveArgs = buildHylyreAppPageSaveArgv({
    bundleName: opts.bundleName,
    deviceSn: opts.deviceSn,
    abilityName: opts.mainAbility,
    pageSlug: opts.pageSlug ?? 'home',
  });
  appendLog(opts.logPath, `$ ${opts.pythonPath} ${saveArgs.join(' ')}\n`);
  const save = spawnSync(opts.pythonPath, saveArgs, {
    cwd: opts.hypiumWorkDir,
    encoding: 'utf-8',
    env: { ...process.env, HYLYRE_APP_STORE_DIR: opts.appSnapshotCacheAbs },
    timeout: 60_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  const saveOut = `${save.stdout ?? ''}${save.stderr ?? ''}`;
  appendLog(opts.logPath, saveOut);
  logLines.push(`page save exit=${save.status}\n`);

  const stillEmpty = isAppSnapshotCacheEmpty(opts.appSnapshotCacheAbs, opts.bundleName);
  if (save.status !== 0 || stillEmpty) {
    return {
      ok: false,
      skipped: false,
      reason: stillEmpty ? 'page save did not populate cache' : `page save exit=${save.status}`,
      pageSaveExitCode: save.status,
      log: logLines.join(''),
    };
  }
  return { ok: true, skipped: false, pageSaveExitCode: save.status, log: logLines.join('') };
}

export function resolveAppSnapshotCacheAbs(projectRoot: string): string {
  const cfg = resolveHylyreToolConfig(projectRoot);
  return path.resolve(projectRoot, cfg.app_snapshot_cache_dir);
}
