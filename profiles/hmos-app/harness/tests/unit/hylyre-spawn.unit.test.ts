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
    name: 'buildHylyreSpawnInvocation: custom Python wrapper 可替代 -m hylyre 且保留原 argv',
    run: () => {
      const wrapper = '/framework/profiles/hmos-app/harness/custom-python-wrapper.py';
      const hylyreArgv = ['run', '--plan', '/abs/plan.md', '--out', '/abs/trace.json'];
      const inv = buildHylyreSpawnInvocation({
        pythonPath: '/venv/python',
        pythonScriptPath: wrapper,
        hypiumWorkDir: HYPIUM_CWD,
        hylyreArgv,
      });
      assert(
        JSON.stringify(inv.argv) === JSON.stringify([wrapper, ...hylyreArgv]),
        `wrapper argv ${JSON.stringify(inv.argv)}`,
      );
      assert(!inv.argv.includes('-m'), 'wrapper 路径不得同时追加 -m hylyre');
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
  // ==========================================================================
  // 工具链环境派生（plan a9f3c7d2 第一笔 · R4）
  // 事故归因：agent 裸调 hvigor 撞 `Invalid value of 'DEVECO_SDK_HOME'` 后判「本机环境问题」。
  // 事实是执行器一直从 framework.local.json 的 installPath 派生该变量——本用例把它锁住。
  // 既有覆盖（本文件上方）只证明信任锚三键不外泄，不覆盖 installPath → SDK_HOME 这条派生。
  // ==========================================================================
  {
    name: 'hvigor child env derives DEVECO_SDK_HOME from installPath when the variable is absent',
    run: () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const hv = require('../../hvigor-runner') as { buildChildEnv: (projectRoot: string) => NodeJS.ProcessEnv };
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { spawnSync } = require('child_process') as typeof import('child_process');
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deveco-derive-'));
      const previous = process.env.DEVECO_SDK_HOME;
      try {
        const installPath = path.join(root, 'DevEco Studio');
        fs.mkdirSync(path.join(installPath, 'sdk'), { recursive: true });
        fs.writeFileSync(
          path.join(root, 'framework.local.json'),
          JSON.stringify({ schema_version: '1.0', toolchain: { devEcoStudio: { installPath } } }),
        );
        delete process.env.DEVECO_SDK_HOME;
        const derived = hv.buildChildEnv(root);
        assert(
          typeof derived.DEVECO_SDK_HOME === 'string' && fs.existsSync(derived.DEVECO_SDK_HOME),
          `未设该变量时应从 installPath 派生出存在的 SDK 目录，实得 ${String(derived.DEVECO_SDK_HOME)}`,
        );
        // 真实子进程确认这份 env 确实被子进程看到（本文件上方那条子进程用例查的是信任锚剥离，
        // 不覆盖这条派生；第一轮代码 review 建议 1）。
        const seen = spawnSync(process.execPath, ['-e', 'console.log(process.env.DEVECO_SDK_HOME ?? "")'], {
          env: derived,
          encoding: 'utf-8',
          shell: false,
          timeout: 15000,
        });
        assert(
          (seen.stdout ?? '').trim() === derived.DEVECO_SDK_HOME,
          `子进程未拿到派生的 DEVECO_SDK_HOME：${JSON.stringify(seen.stdout)}`,
        );
        // 用户已显式设置时不得覆盖（派生只补缺，不抢）。
        process.env.DEVECO_SDK_HOME = path.join(root, 'explicit-sdk');
        assert(
          hv.buildChildEnv(root).DEVECO_SDK_HOME === path.join(root, 'explicit-sdk'),
          '已显式设置 DEVECO_SDK_HOME 时不得被派生值覆盖',
        );
      } finally {
        if (previous === undefined) delete process.env.DEVECO_SDK_HOME;
        else process.env.DEVECO_SDK_HOME = previous;
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    // **源码 smoke**（如实命名，第一轮代码 review 建议 1）：这条不读实际生成的 metadata 文件——
    // 生成它需要真跑 hvigor。它只证明 envProbe 的装配点声明了本次 childEnv 的 SDK 路径字段。
    name: 'build metadata source declares the resolved sdk home path',
    run: () => {
      // A12：既有布尔只说明变量是否设置，诊断要回答「这次用的哪个 SDK」就得有路径本身。
      const source = fs.readFileSync(path.join(__dirname, '../../hvigor-runner.ts'), 'utf-8');
      const probe = source.slice(source.indexOf('envProbe: {'), source.indexOf('logFile: path.basename(logAbs)'));
      assert(/DEVECO_SDK_HOME:\s*Boolean\(childEnv\.DEVECO_SDK_HOME\)/.test(probe), '既有布尔字段不得被改写');
      // 只要求「新增路径字段 + 取自 childEnv」，不锁具体表达式（等价实现同样合法）。
      assert(/DEVECO_SDK_HOME_PATH\s*:[^\n]*childEnv\.DEVECO_SDK_HOME/.test(probe),
        'metadata 未补记本次 childEnv 的 SDK 路径，A4/A6/A7 的诊断口径就没有可读证据');
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
