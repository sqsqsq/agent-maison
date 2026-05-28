/**

 * Warm up doc/app-snapshot-cache/<bundle>/ when empty (dump-ui + page save).

 */

import * as fs from 'fs';

import * as path from 'path';

import { spawnSync } from 'child_process';
import { spawnHylyre } from './hylyre-spawn';

import { resolveHylyreToolConfig } from '../../../harness/config';

import { buildHylyreAppPageSaveArgv } from './device-test-page-save';

import { hdcTargetPrefix, mergeEnvWithHdcOnPath, resolveHdcExecutableSync } from './hdc-runner';

import {

  collectDeviceInfo,

  pollUntilForeground,

  type DeviceInfo,

} from './hdc-foreground-probe';

import { markAppMetaCacheStale } from './resolve-main-ability';
import { isSnapshotCacheEmpty } from '../../../harness/scripts/utils/app-snapshot-cache-hint';



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



export type WarmupReasonKind =

  | 'device_locked'

  | 'no_hdc_target'

  | 'aa_start_failed'

  | 'app_not_foreground'

  | 'ability_wrong'

  | 'dump_ui_failed'

  | 'page_save_failed'

  | 'unknown';



export interface SnapshotWarmupResult {

  ok: boolean;

  skipped: boolean;

  reason?: string;

  reasonKind?: WarmupReasonKind;

  metaPath?: string;

  pageSaveExitCode?: number | null;

  log: string;

}



/** Delegates to harness SSOT (pages/ + legacy flat root layout). */
export function isAppSnapshotCacheEmpty(appSnapshotCacheAbs: string, bundleName: string): boolean {
  return isSnapshotCacheEmpty(appSnapshotCacheAbs, bundleName);
}



function appendLog(logPath: string | undefined, line: string): void {

  if (!logPath) return;

  try {

    fs.appendFileSync(logPath, line, 'utf-8');

  } catch {

    /* ignore */

  }

}



function warmupMetaPathFromLog(logPath?: string): string {

  if (logPath?.trim()) {

    return path.join(path.dirname(logPath), 'snapshot-warmup.meta.json');

  }

  return 'snapshot-warmup.meta.json';

}



function writeWarmupMeta(metaPath: string, body: Record<string, unknown>): void {

  fs.mkdirSync(path.dirname(metaPath), { recursive: true });

  fs.writeFileSync(
    metaPath,
    `${JSON.stringify({ schema_version: '0.1', ...body }, null, 2)}\n`,
    'utf-8',
  );

}



export interface AaStartCapture {

  ok: boolean;

  exitCode: number | null;

  output: string;

  stderr: string;

}



export function runAaStartWithCapture(

  bundle: string,

  ability: string,

  deviceSn: string | undefined,

  logPath?: string,

): AaStartCapture {

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

  const stdout = r.stdout ?? '';

  const stderr = r.stderr ?? '';

  const output = `${stdout}${stderr}`;

  appendLog(logPath, output);

  return { ok: r.status === 0, exitCode: r.status, output, stderr };

}



interface CommandCapture {

  exitCode: number | null;

  stderr: string;

  stdout: string;

}



function runDumpUi(

  pythonPath: string,

  hypiumWorkDir: string,

  appSnapshotCacheAbs: string,

  deviceSn: string | undefined,

  logPath?: string,

): CommandCapture {

  const dumpArgv = ['dump-ui'];
  if (deviceSn?.trim()) dumpArgv.push('--device-sn', deviceSn.trim());

  const dump = spawnHylyre({
    pythonPath,
    hypiumWorkDir,
    hylyreArgv: dumpArgv,
    appSnapshotCacheAbs,
    logPath,
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024,
    echoToStdout: false,
  });

  const stdout = dump.stdout ?? '';
  const stderr = dump.stderr ?? '';
  return { exitCode: dump.status, stderr, stdout };

}



function runPageSave(

  pythonPath: string,

  hypiumWorkDir: string,

  appSnapshotCacheAbs: string,

  opts: SnapshotWarmupOptions,

): CommandCapture {

  const saveArgs = buildHylyreAppPageSaveArgv({

    bundleName: opts.bundleName,

    deviceSn: opts.deviceSn,

    abilityName: opts.mainAbility,

    pageSlug: opts.pageSlug ?? 'home',

  });

  const hylyreArgv =
    saveArgs[0] === '-m' && saveArgs[1] === 'hylyre' ? saveArgs.slice(2) : saveArgs;
  const save = spawnHylyre({
    pythonPath,
    hypiumWorkDir: opts.hypiumWorkDir,
    hylyreArgv,
    appSnapshotCacheAbs,
    logPath: opts.logPath,
    timeout: 60_000,
    maxBuffer: 4 * 1024 * 1024,
    echoToStdout: false,
  });

  const stdout = save.stdout ?? '';
  const stderr = save.stderr ?? '';
  return { exitCode: save.status, stderr, stdout };

}



export function classifyWarmupFailure(

  aaStart: { ok: boolean; output: string },

  foreground: { ok: boolean; lastDumpExcerpt: string },

  dumpUi: { exitCode: number | null; stderr: string },

  pageSave: { exitCode: number | null; stderr: string },

): WarmupReasonKind {

  const aaOut = aaStart.output;

  if (!aaStart.ok && /screen.*locked|need.*unlock|UserId.*not active/i.test(aaOut)) return 'device_locked';

  if (!aaStart.ok && /no targets|no device/i.test(aaOut)) return 'no_hdc_target';

  if (!aaStart.ok) return 'aa_start_failed';

  if (!foreground.ok) return 'app_not_foreground';

  const dumpErr = dumpUi.stderr;

  if (dumpUi.exitCode !== 0 && dumpUi.exitCode !== null) {

    if (/ability.*not.*found|page.*not.*registered/i.test(dumpErr)) return 'ability_wrong';

    return 'dump_ui_failed';

  }

  if (pageSave.exitCode !== 0 && pageSave.exitCode !== null) return 'page_save_failed';

  return 'unknown';

}



export function ensureAppSnapshotWarmup(opts: SnapshotWarmupOptions): SnapshotWarmupResult {

  const logLines: string[] = [];

  const metaPath = warmupMetaPathFromLog(opts.logPath);

  const deviceInfo: DeviceInfo = collectDeviceInfo(opts.deviceSn);



  if (!isAppSnapshotCacheEmpty(opts.appSnapshotCacheAbs, opts.bundleName)) {

    writeWarmupMeta(metaPath, {

      skipped: true,

      ok: true,

      reason: 'cache_nonempty',

      bundle: opts.bundleName,

      device_info: deviceInfo,

      ran_at: new Date().toISOString(),

    });

    return {

      ok: true,

      skipped: true,

      reason: 'cache_nonempty',

      metaPath,

      log: 'snapshot cache already has pages\n',

    };

  }



  logLines.push(`snapshot warmup: cache empty for ${opts.bundleName}\n`);



  const aa = runAaStartWithCapture(opts.bundleName, opts.mainAbility, opts.deviceSn, opts.logPath);

  const fg = aa.ok

    ? pollUntilForeground(opts.bundleName, opts.deviceSn)

    : { ok: false, tookMs: 0, lastDumpExcerpt: '', attempts: 0 };



  const dump = runDumpUi(

    opts.pythonPath,

    opts.hypiumWorkDir,

    opts.appSnapshotCacheAbs,

    opts.deviceSn,

    opts.logPath,

  );

  logLines.push(`dump-ui exit=${dump.exitCode}\n`);



  const save = runPageSave(opts.pythonPath, opts.hypiumWorkDir, opts.appSnapshotCacheAbs, opts);

  logLines.push(`page save exit=${save.exitCode}\n`);



  const stillEmpty = isAppSnapshotCacheEmpty(opts.appSnapshotCacheAbs, opts.bundleName);

  const reasonKind = stillEmpty

    ? classifyWarmupFailure(aa, fg, dump, save)

    : undefined;



  writeWarmupMeta(metaPath, {

    skipped: false,

    ok: !stillEmpty,

    reason_kind: reasonKind ?? null,

    bundle: opts.bundleName,

    main_ability: opts.mainAbility,

    device_info: deviceInfo,

    aa_start: {

      ok: aa.ok,

      exit_code: aa.exitCode,

      stderr_excerpt: aa.stderr.slice(0, 2000),

      output_excerpt: aa.output.slice(0, 2000),

    },

    foreground_check: {

      ok: fg.ok,

      took_ms: fg.tookMs,

      attempts: fg.attempts,

      last_dump_excerpt: fg.lastDumpExcerpt,

    },

    dump_ui: {

      exit_code: dump.exitCode,

      stderr_excerpt: dump.stderr.slice(0, 2000),

    },

    page_save: {

      exit_code: save.exitCode,

      stderr_excerpt: save.stderr.slice(0, 2000),

    },

    ran_at: new Date().toISOString(),

  });



  if (reasonKind === 'app_not_foreground' || reasonKind === 'ability_wrong') {

    markAppMetaCacheStale(opts.projectRoot, opts.bundleName);

  }



  if (stillEmpty) {

    const msg = `warmup_failed:${reasonKind ?? 'unknown'}`;

    return {

      ok: false,

      skipped: false,

      reason: msg,

      reasonKind,

      metaPath,

      pageSaveExitCode: save.exitCode,

      log: logLines.join(''),

    };

  }



  return {

    ok: true,

    skipped: false,

    pageSaveExitCode: save.exitCode,

    metaPath,

    log: logLines.join(''),

  };

}



export function resolveAppSnapshotCacheAbs(projectRoot: string): string {

  const cfg = resolveHylyreToolConfig(projectRoot);

  return path.resolve(projectRoot, cfg.app_snapshot_cache_dir);

}


