/**
 * 统一 `python -m hylyre …` 子进程：强制 cwd=hypiumWorkDir，可选 HYLYRE_APP_STORE_DIR。
 * 不包含 pip / venv / python -c 探测（仍用 projectRoot cwd）。
 */
import * as fs from 'fs';
import { spawnSync, type SpawnSyncOptions, type SpawnSyncReturns } from 'child_process';
import { featurePhaseReportsDir } from '../../../harness/config';
import { ensureHdcServerWarm, mergeEnvWithHdcOnPath } from './hdc-runner';
import { ensureHypiumWorkDir } from './device-test-hypium-workdir';

export interface HylyreRuntimeWorkDir {
  reportsBase: string;
  hypiumWorkDir: string;
}

export function resolveHylyreRuntimeWorkDir(
  projectRoot: string,
  feature: string,
  phase: string,
  frameworkRoot?: string,
): HylyreRuntimeWorkDir {
  const reportsBase = featurePhaseReportsDir(projectRoot, feature, phase, frameworkRoot);
  const hypiumWorkDir = ensureHypiumWorkDir(reportsBase);
  return { reportsBase, hypiumWorkDir };
}

export interface SpawnHylyreOptions {
  pythonPath: string;
  hypiumWorkDir: string;
  /** `hylyre` 之后的参数，如 `['doctor']` 或 `['run', '--plan', …]` */
  hylyreArgv: string[];
  appSnapshotCacheAbs?: string;
  logPath?: string;
  timeout?: number;
  maxBuffer?: number;
  stdio?: SpawnSyncOptions['stdio'];
  /** 将子进程 stdout/stderr 写到 process.stdout（默认 true） */
  echoToStdout?: boolean;
}

function appendLogLine(logPath: string | undefined, line: string): void {
  if (!logPath) return;
  try {
    fs.appendFileSync(logPath, line, 'utf-8');
  } catch {
    /* best-effort */
  }
}

/** 纯函数：组装 spawnSync 参数（单测断言 cwd / argv / env 回归边界）。 */
export function buildHylyreSpawnInvocation(opts: SpawnHylyreOptions): {
  pythonPath: string;
  argv: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  encoding: 'utf-8';
  stdio: SpawnSyncOptions['stdio'];
  maxBuffer: number;
  timeout?: number;
} {
  const argv = ['-m', 'hylyre', ...opts.hylyreArgv];
  const env: NodeJS.ProcessEnv = { ...mergeEnvWithHdcOnPath(process.env) };
  const store = (opts.appSnapshotCacheAbs ?? '').trim();
  if (store) {
    env.HYLYRE_APP_STORE_DIR = store;
  }
  return {
    pythonPath: opts.pythonPath,
    argv,
    cwd: opts.hypiumWorkDir,
    env,
    encoding: 'utf-8',
    stdio: opts.stdio ?? ['ignore', 'pipe', 'pipe'],
    maxBuffer: opts.maxBuffer ?? 64 * 1024 * 1024,
    timeout: opts.timeout,
  };
}

export function spawnHylyre(opts: SpawnHylyreOptions): SpawnSyncReturns<string> {
  const warm = ensureHdcServerWarm();
  const inv = buildHylyreSpawnInvocation(opts);
  const cmdLine = `${inv.pythonPath} ${inv.argv.join(' ')}`;
  appendLogLine(opts.logPath, `\n$ ${cmdLine}\n`);
  appendLogLine(
    opts.logPath,
    `hypium cwd: ${inv.cwd}（禁止工程根；tmp_hypium 应落在其下）\n`,
  );
  appendLogLine(
    opts.logPath,
    `hdc prewarm: exe=${warm.exe} isolated_cwd=${warm.isolatedCwd} prewarmed=${warm.prewarmed} warm_error=${warm.warm_error ?? '-'}\n`,
  );

  const run = spawnSync(inv.pythonPath, inv.argv, {
    cwd: inv.cwd,
    env: inv.env,
    encoding: inv.encoding,
    stdio: inv.stdio,
    maxBuffer: inv.maxBuffer,
    timeout: inv.timeout,
  }) as SpawnSyncReturns<string>;

  const out = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  if (out) {
    appendLogLine(opts.logPath, out);
    if (opts.echoToStdout !== false) {
      process.stdout.write(out);
    }
  }
  if (run.error) {
    appendLogLine(opts.logPath, `${run.error.message}\n`);
  }

  return run;
}
