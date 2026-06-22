// ============================================================================
// ohpm-runner.unit.test.ts — ohpm 安装 provider 纯函数回归
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  classifyOhpmInstallFailure,
  installProjectDeps,
  resolveOhpmSpawnPlan,
} from '../../ohpm-runner';
import { provider as depsInstallProvider } from '../../providers/deps-install';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function assertEq<T>(actual: T, expected: T, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${label}\n    expected: ${e}\n    actual:   ${a}`);
  }
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'classifyOhpmInstallFailure: exit 0 → ok',
    run: () => {
      assertEq(classifyOhpmInstallFailure('', 0), 'ok', 'exit 0');
    },
  },
  {
    name: 'classifyOhpmInstallFailure: 401 → auth_required',
    run: () => {
      assertEq(classifyOhpmInstallFailure('HTTP 401 Unauthorized', 1), 'auth_required', '401');
    },
  },
  {
    name: 'classifyOhpmInstallFailure: ENOTFOUND → network',
    run: () => {
      assertEq(classifyOhpmInstallFailure('getaddrinfo ENOTFOUND registry.example.com', 1), 'network', 'network');
    },
  },
  {
    name: 'classifyOhpmInstallFailure: registry 404 → registry_unreachable',
    run: () => {
      assertEq(
        classifyOhpmInstallFailure('404 not found in registry for @scope/pkg', 1),
        'registry_unreachable',
        'registry',
      );
    },
  },
  {
    name: 'classifyOhpmInstallFailure: 未知错误 → unknown',
    run: () => {
      assertEq(classifyOhpmInstallFailure('something went wrong', 2), 'unknown', 'unknown');
    },
  },
  {
    name: 'resolveOhpmSpawnPlan: 无 DevEco 配置 → toolMissing',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ohpm-no-deveco-'));
      try {
        const plan = resolveOhpmSpawnPlan(root);
        if (!('toolMissing' in plan)) {
          throw new Error('应返回 toolMissing');
        }
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'resolveOhpmSpawnPlan: DevEco 根存在且 ohpm 在 bin → spawn plan',
    run: () => {
      const savedEnv = {
        DEVECO_STUDIO_HOME: process.env.DEVECO_STUDIO_HOME,
        HUAWEI_DEVECO_STUDIO_HOME: process.env.HUAWEI_DEVECO_STUDIO_HOME,
      };
      delete process.env.DEVECO_STUDIO_HOME;
      delete process.env.HUAWEI_DEVECO_STUDIO_HOME;
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ohpm-deveco-'));
      try {
        const devecoRoot = path.join(root, 'DevEco');
        const nodeExe = path.join(devecoRoot, 'tools', 'node', process.platform === 'win32' ? 'node.exe' : 'node');
        const ohpmName = process.platform === 'win32' ? 'ohpm.bat' : 'ohpm';
        const ohpmExe = path.join(devecoRoot, 'tools', 'ohpm', 'bin', ohpmName);
        fs.mkdirSync(path.dirname(nodeExe), { recursive: true });
        fs.mkdirSync(path.dirname(ohpmExe), { recursive: true });
        fs.writeFileSync(nodeExe, '', 'utf-8');
        fs.writeFileSync(ohpmExe, '@echo off\n', 'utf-8');

        const projectRoot = path.join(root, 'proj');
        fs.mkdirSync(projectRoot, { recursive: true });
        fs.writeFileSync(
          path.join(projectRoot, 'framework.local.json'),
          JSON.stringify({
            schema_version: '1.0',
            toolchain: { devEcoStudio: { installPath: devecoRoot } },
          }),
          'utf-8',
        );

        const plan = resolveOhpmSpawnPlan(projectRoot);
        if ('toolMissing' in plan) {
          throw new Error('不应 toolMissing');
        }
        assertEq(plan.spawnArgs, ['install'], 'args');
        assertEq(plan.source, 'deveco_install_path', 'source');
      } finally {
        if (savedEnv.DEVECO_STUDIO_HOME !== undefined) {
          process.env.DEVECO_STUDIO_HOME = savedEnv.DEVECO_STUDIO_HOME;
        }
        if (savedEnv.HUAWEI_DEVECO_STUDIO_HOME !== undefined) {
          process.env.HUAWEI_DEVECO_STUDIO_HOME = savedEnv.HUAWEI_DEVECO_STUDIO_HOME;
        }
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'installProjectDeps: Windows shell 路径含空格时真实 spawn 带 install 参数',
    run: () => {
      if (process.platform !== 'win32') return;
      const savedEnv = {
        DEVECO_STUDIO_HOME: process.env.DEVECO_STUDIO_HOME,
        HUAWEI_DEVECO_STUDIO_HOME: process.env.HUAWEI_DEVECO_STUDIO_HOME,
      };
      delete process.env.DEVECO_STUDIO_HOME;
      delete process.env.HUAWEI_DEVECO_STUDIO_HOME;
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ohpm-spawn-'));
      try {
        const devecoRoot = path.join(root, 'Program Files', 'DevEco Studio');
        const nodeExe = path.join(devecoRoot, 'tools', 'node', 'node.exe');
        const ohpmBat = path.join(devecoRoot, 'tools', 'ohpm', 'bin', 'ohpm.bat');
        fs.mkdirSync(path.dirname(nodeExe), { recursive: true });
        fs.mkdirSync(path.dirname(ohpmBat), { recursive: true });
        fs.writeFileSync(nodeExe, '', 'utf-8');
        fs.writeFileSync(
          ohpmBat,
          '@echo off\r\necho OHPM_ARGS=%*\r\nexit /b 0\r\n',
          'utf-8',
        );

        const projectRoot = path.join(root, 'proj');
        fs.mkdirSync(projectRoot, { recursive: true });
        fs.writeFileSync(
          path.join(projectRoot, 'framework.config.json'),
          JSON.stringify({
            schema_version: '1.0',
            project_name: 'ohpm-unit',
            project_profile: { name: 'hmos-app' },
            agent_adapter: 'generic',
            architecture: {
              outer_layers: [{ id: 'L1', can_depend_on: [], intra_layer_deps: 'forbid' }],
              module_inner_layers: ['shared'],
              inner_dependency_direction: 'upward',
              cross_module_exports_file: 'index.ets',
            },
            paths: {
              reports_dir_pattern: 'doc/features/<feature>/<phase>/reports',
            },
          }),
          'utf-8',
        );
        fs.writeFileSync(
          path.join(projectRoot, 'framework.local.json'),
          JSON.stringify({
            schema_version: '1.0',
            toolchain: { devEcoStudio: { installPath: devecoRoot } },
          }),
          'utf-8',
        );

        const repoRoot = path.resolve(__dirname, '..', '..', '..', '..', '..');
        const res = installProjectDeps({
          projectRoot,
          harnessRoot: path.join(repoRoot, 'harness'),
          feature: 'unit-ohpm',
          phase: 'coding',
          frameworkRoot: repoRoot,
        });
        if (!res.executed || !res.ok) {
          throw new Error(`install 应成功：${JSON.stringify(res)}`);
        }
        const log = fs.readFileSync(res.logPath!, 'utf-8');
        if (!log.includes('install')) {
          throw new Error(`日志应含 install 子命令：${log}`);
        }
      } finally {
        if (savedEnv.DEVECO_STUDIO_HOME !== undefined) {
          process.env.DEVECO_STUDIO_HOME = savedEnv.DEVECO_STUDIO_HOME;
        }
        if (savedEnv.HUAWEI_DEVECO_STUDIO_HOME !== undefined) {
          process.env.HUAWEI_DEVECO_STUDIO_HOME = savedEnv.HUAWEI_DEVECO_STUDIO_HOME;
        }
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'deps-install provider metadata',
    run: () => {
      assertEq(depsInstallProvider.id, 'ohpm', 'id');
      assertEq(depsInstallProvider.capability, 'coding.deps_install', 'capability');
      if (!depsInstallProvider.exports.includes('installProjectDeps')) {
        throw new Error('exports 应含 installProjectDeps');
      }
    },
  },
];

export function runAll(): UnitCaseResult[] {
  return cases.map(c => {
    try {
      c.run();
      return { name: c.name, ok: true };
    } catch (err) {
      return { name: c.name, ok: false, error: (err as Error).stack ?? (err as Error).message };
    }
  });
}
