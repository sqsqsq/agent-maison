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
    name: 'S2 P0-B: buildHylyreSpawnInvocation 恒注入 PYTHONUTF8=1 + PYTHONIOENCODING=utf-8（两路径共享装配点）',
    run: () => {
      const inv = buildHylyreSpawnInvocation({
        pythonPath: 'python',
        hypiumWorkDir: HYPIUM_CWD,
        hylyreArgv: ['run', '--steps-file', '/abs/steps.json'],
      });
      assert(inv.env.PYTHONUTF8 === '1', `PYTHONUTF8 want 1, got ${inv.env.PYTHONUTF8}`);
      assert(
        inv.env.PYTHONIOENCODING === 'utf-8',
        `PYTHONIOENCODING want utf-8, got ${inv.env.PYTHONIOENCODING}`,
      );
    },
  },
  {
    name: '八轮 P0：信任锚 env 不进宿主可执行链——hylyre/hvigor 子进程 env 剥离（真实子进程验证）',
    run: () => {
      const { spawnSync } = require('child_process') as typeof import('child_process');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const hv = require('../../hvigor-runner') as typeof import('../../hvigor-runner');
      const prev = {
        k1: process.env.MAISON_HMAC_GOAL_CHECKPOINT,
        k2: process.env.MAISON_TRUST_REGISTRY,
        k3: process.env.MAISON_GOAL_CHECKPOINT_DIR,
      };
      process.env.MAISON_HMAC_GOAL_CHECKPOINT = 'secret-k';
      process.env.MAISON_TRUST_REGISTRY = '/x/registry.json';
      process.env.MAISON_GOAL_CHECKPOINT_DIR = '/x/cp';
      try {
        // hylyre 路径：装配层剥离
        const inv = buildHylyreSpawnInvocation({
          pythonPath: 'python', hypiumWorkDir: HYPIUM_CWD, hylyreArgv: ['doctor'],
        });
        assert(inv.env.MAISON_HMAC_GOAL_CHECKPOINT === undefined, 'hylyre env 不得含 HMAC 密钥');
        assert(inv.env.MAISON_TRUST_REGISTRY === undefined, 'hylyre env 不得含 registry 路径');
        assert(inv.env.MAISON_GOAL_CHECKPOINT_DIR === undefined, 'hylyre env 不得含 checkpoint 路径');
        // 九轮 P0：Python 准备链（探测/import/venv/pip）统一剥离口径
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const dtr = require('../../providers/device-test-run') as { pythonSpawnEnv: () => NodeJS.ProcessEnv };
        const pyEnv = dtr.pythonSpawnEnv();
        assert(pyEnv.MAISON_HMAC_GOAL_CHECKPOINT === undefined, 'python 链 env 不得含 HMAC 密钥');
        assert(pyEnv.MAISON_TRUST_REGISTRY === undefined, 'python 链 env 不得含 registry 路径');
        assert(pyEnv.MAISON_GOAL_CHECKPOINT_DIR === undefined, 'python 链 env 不得含 checkpoint 路径');
        // hvigor 路径（宿主 hvigorfile.ts/构建插件=agent 可产出代码）：真实子进程读 env 验证
        const childEnv = hv.buildChildEnv(path.resolve(__dirname, '..', '..'));
        const probe = spawnSync(process.execPath, [
          '-e',
          'console.log(JSON.stringify({a:process.env.MAISON_HMAC_GOAL_CHECKPOINT??null,b:process.env.MAISON_TRUST_REGISTRY??null,c:process.env.MAISON_GOAL_CHECKPOINT_DIR??null}))',
        ], { env: childEnv, encoding: 'utf-8', shell: false, timeout: 15000 });
        const seen = JSON.parse((probe.stdout ?? '').trim() || '{}') as { a: unknown; b: unknown; c: unknown };
        assert(seen.a === null && seen.b === null && seen.c === null,
          `hvigor 子进程不得读到信任锚 env：${probe.stdout}`);
      } finally {
        if (prev.k1 === undefined) delete process.env.MAISON_HMAC_GOAL_CHECKPOINT; else process.env.MAISON_HMAC_GOAL_CHECKPOINT = prev.k1;
        if (prev.k2 === undefined) delete process.env.MAISON_TRUST_REGISTRY; else process.env.MAISON_TRUST_REGISTRY = prev.k2;
        if (prev.k3 === undefined) delete process.env.MAISON_GOAL_CHECKPOINT_DIR; else process.env.MAISON_GOAL_CHECKPOINT_DIR = prev.k3;
      }
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
