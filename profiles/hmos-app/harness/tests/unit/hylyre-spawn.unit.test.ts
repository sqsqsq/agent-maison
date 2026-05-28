import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HYPIUM_WORKDIR_BASENAME, resolveHypiumWorkDir } from '../../device-test-hypium-workdir';
import {
  buildHylyreSpawnInvocation,
  resolveHylyreRuntimeWorkDir,
  spawnHylyre,
} from '../../hylyre-spawn';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

const HYPIUM_CWD = '/repo/doc/features/wallet/testing/reports/.hypium-workdir';
const STORE_ABS = '/repo/doc/app-snapshot-cache/com.example.app';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'buildHylyreSpawnInvocation: doctor → cwd=hypiumWorkDir, argv -m hylyre doctor, 无 store',
    run: () => {
      const inv = buildHylyreSpawnInvocation({
        pythonPath: '/venv/python.exe',
        hypiumWorkDir: HYPIUM_CWD,
        hylyreArgv: ['doctor'],
      });
      assert(inv.cwd === HYPIUM_CWD, `cwd want ${HYPIUM_CWD}, got ${inv.cwd}`);
      assert(
        JSON.stringify(inv.argv) === JSON.stringify(['-m', 'hylyre', 'doctor']),
        `argv ${JSON.stringify(inv.argv)}`,
      );
      assert(
        inv.env.HYLYRE_APP_STORE_DIR === undefined,
        `doctor must not set HYLYRE_APP_STORE_DIR, got ${inv.env.HYLYRE_APP_STORE_DIR}`,
      );
    },
  },
  {
    name: 'buildHylyreSpawnInvocation: run 传入 appSnapshotCacheAbs',
    run: () => {
      const inv = buildHylyreSpawnInvocation({
        pythonPath: '/venv/python',
        hypiumWorkDir: HYPIUM_CWD,
        hylyreArgv: ['run', '--plan', '/abs/plan.md'],
        appSnapshotCacheAbs: STORE_ABS,
      });
      assert(inv.env.HYLYRE_APP_STORE_DIR === STORE_ABS, 'HYLYRE_APP_STORE_DIR missing');
      assert(inv.argv[0] === '-m' && inv.argv[1] === 'hylyre' && inv.argv[2] === 'run', 'argv prefix');
    },
  },
  {
    name: 'buildHylyreSpawnInvocation: 空白 store 不注入 env',
    run: () => {
      const inv = buildHylyreSpawnInvocation({
        pythonPath: 'python',
        hypiumWorkDir: HYPIUM_CWD,
        hylyreArgv: ['dump-ui'],
        appSnapshotCacheAbs: '   ',
      });
      assert(inv.env.HYLYRE_APP_STORE_DIR === undefined, 'blank store must not inject');
    },
  },
  {
    name: 'resolveHylyreRuntimeWorkDir: reportsBase + .hypium-workdir（仓内 layout）',
    run: () => {
      // agent-maison standalone：harness 在仓根
      const projectRoot = path.resolve(__dirname, '..', '..', '..', '..', '..');
      const frameworkRoot = projectRoot;
      const { reportsBase, hypiumWorkDir } = resolveHylyreRuntimeWorkDir(
        projectRoot,
        'demo-feature',
        'testing',
        frameworkRoot,
      );
      const wantWork = resolveHypiumWorkDir(reportsBase);
      assert(hypiumWorkDir === wantWork, `hypiumWorkDir ${hypiumWorkDir}`);
      assert(
        hypiumWorkDir.endsWith(path.join(HYPIUM_WORKDIR_BASENAME)),
        'must end with .hypium-workdir',
      );
      assert(
        reportsBase.includes('demo-feature') && reportsBase.includes('testing'),
        `reportsBase ${reportsBase}`,
      );
      assert(fs.existsSync(hypiumWorkDir), 'ensureHypiumWorkDir should mkdir');
    },
  },
  {
    name: 'spawnHylyre: 记录 hypium cwd 到 logPath',
    run: () => {
      const logPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hylyre-spawn-log-')), 'run.log');
      spawnHylyre({
        pythonPath: process.execPath,
        hypiumWorkDir: HYPIUM_CWD,
        hylyreArgv: ['doctor'],
        logPath,
        echoToStdout: false,
        timeout: 1000,
      });
      const log = fs.readFileSync(logPath, 'utf-8');
      assert(log.includes(HYPIUM_CWD), 'log must record hypium cwd');
      assert(log.includes('-m hylyre doctor'), 'log must record command');
    },
  },
];

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      c.run();
      results.push({ name: c.name, ok: true });
    } catch (e) {
      results.push({ name: c.name, ok: false, error: (e as Error).message });
    }
  }
  return results;
}
