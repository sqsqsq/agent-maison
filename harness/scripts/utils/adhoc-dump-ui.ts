/**
 * Run hylyre dump-ui for ad-hoc observation (CLI subcommand, not a planned step).
 */
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { ensureHypiumWorkDir } from '../../../profiles/hmos-app/harness/device-test-hypium-workdir';
import { featurePhaseReportsDir } from '../../config';

export interface AdhocDumpUiOptions {
  projectRoot: string;
  bundle: string;
  pythonPath: string;
  appSnapshotCacheAbs: string;
  deviceSn?: string;
  outPath?: string;
  logPath?: string;
}

export interface AdhocDumpUiResult {
  ok: boolean;
  outPath: string;
  exitCode: number | null;
  stderr: string;
}

export function resolveAdhocDumpUiOutPath(
  projectRoot: string,
  bundle: string,
  explicitOut?: string,
): string {
  if (explicitOut?.trim()) return path.resolve(explicitOut.trim());
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const slug = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  return path.join(projectRoot, 'doc', 'app-snapshot-cache', bundle, `dump-ui-${slug}.json`);
}

export function runAdhocDumpUi(opts: AdhocDumpUiOptions): AdhocDumpUiResult {
  const reportsBase = featurePhaseReportsDir(opts.projectRoot, '_adhoc', 'testing');
  const hypiumWorkDir = ensureHypiumWorkDir(reportsBase);
  const outPath = resolveAdhocDumpUiOutPath(opts.projectRoot, opts.bundle, opts.outPath);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const sessionArgs = ['-m', 'hylyre', 'session', 'start'];
  if (opts.deviceSn?.trim()) sessionArgs.push('--device-sn', opts.deviceSn.trim());
  spawnSync(opts.pythonPath, sessionArgs, {
    cwd: opts.projectRoot,
    encoding: 'utf-8',
    env: { ...process.env, HYLYRE_APP_STORE_DIR: opts.appSnapshotCacheAbs },
    timeout: 30_000,
  });

  const dumpArgs = ['-m', 'hylyre', 'dump-ui', '--out', outPath];
  if (opts.deviceSn?.trim()) dumpArgs.push('--device-sn', opts.deviceSn.trim());

  const logPath = opts.logPath ?? path.join(reportsBase, 'device-test-run.log');
  const cmd = `${opts.pythonPath} ${dumpArgs.join(' ')}`;
  if (opts.logPath) {
    fs.appendFileSync(logPath, `\n$ ${cmd}\n`);
  }

  const dump = spawnSync(opts.pythonPath, dumpArgs, {
    cwd: hypiumWorkDir,
    encoding: 'utf-8',
    env: { ...process.env, HYLYRE_APP_STORE_DIR: opts.appSnapshotCacheAbs },
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
  });

  const stderr = `${dump.stderr ?? ''}${dump.stdout ?? ''}`;
  if (opts.logPath) {
    fs.appendFileSync(logPath, stderr);
  }

  const ok = dump.status === 0 && fs.existsSync(outPath);
  return { ok, outPath, exitCode: dump.status, stderr };
}
