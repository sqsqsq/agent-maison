/**
 * Run hylyre dump-ui for ad-hoc observation (CLI subcommand, not a planned step).
 */
import * as fs from 'fs';
import * as path from 'path';
import { resolveHylyreRuntimeWorkDir, spawnHylyre } from '../../../profiles/hmos-app/harness/hylyre-spawn';

export interface AdhocDumpUiOptions {
  projectRoot: string;
  frameworkRoot?: string;
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
  const { reportsBase, hypiumWorkDir } = resolveHylyreRuntimeWorkDir(
    opts.projectRoot,
    '_adhoc',
    'testing',
    opts.frameworkRoot,
  );
  const outPath = resolveAdhocDumpUiOutPath(opts.projectRoot, opts.bundle, opts.outPath);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const logPath = opts.logPath ?? path.join(reportsBase, 'device-test-run.log');
  const sessionArgv = ['session', 'start'];
  if (opts.deviceSn?.trim()) sessionArgv.push('--device-sn', opts.deviceSn.trim());
  spawnHylyre({
    pythonPath: opts.pythonPath,
    hypiumWorkDir,
    hylyreArgv: sessionArgv,
    appSnapshotCacheAbs: opts.appSnapshotCacheAbs,
    logPath: opts.logPath ? logPath : undefined,
    timeout: 30_000,
    echoToStdout: false,
  });

  const dumpArgv = ['dump-ui', '--out', outPath];
  if (opts.deviceSn?.trim()) dumpArgv.push('--device-sn', opts.deviceSn.trim());

  const dump = spawnHylyre({
    pythonPath: opts.pythonPath,
    hypiumWorkDir,
    hylyreArgv: dumpArgv,
    appSnapshotCacheAbs: opts.appSnapshotCacheAbs,
    logPath: opts.logPath ? logPath : undefined,
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
    echoToStdout: false,
  });

  const stderr = `${dump.stderr ?? ''}${dump.stdout ?? ''}`;

  const ok = dump.status === 0 && fs.existsSync(outPath);
  return { ok, outPath, exitCode: dump.status, stderr };
}
