import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  computeDeviceTestInputsMaxMtimeMs,
  evaluateDeviceTestBuildReuse,
} from '../../device-test-build-reuse';
import { runDeviceTestAppBuild } from '../../providers/device-test-build';
import { clearFrameworkConfigCache } from '../../../../../harness/config';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function mkReuseFixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-reuse-'));
  fs.writeFileSync(
    path.join(root, 'build-profile.json5'),
    '{"modules":[{"name":"Phone","srcPath":"./01-Product/Phone"}]}',
    'utf-8',
  );
  fs.writeFileSync(
    path.join(root, 'framework.config.json'),
    JSON.stringify({
      schema_version: '1.1',
      architecture: {
        outer_layers: [{ id: '02-Feature', can_depend_on: [], intra_layer_deps: 'dag' }],
      },
    }),
    'utf-8',
  );
  const layer = path.join(root, '02-Feature', 'Demo');
  fs.mkdirSync(path.join(layer, 'src'), { recursive: true });
  const srcFile = path.join(layer, 'src', 'Index.ets');
  fs.writeFileSync(srcFile, 'export {}', 'utf-8');
  const hapDir = path.join(root, '01-Product', 'Phone', 'build', 'default', 'outputs', 'default');
  fs.mkdirSync(hapDir, { recursive: true });
  const hapPath = path.join(hapDir, 'Phone-default-signed.hap');
  fs.writeFileSync(hapPath, 'fake-hap', 'utf-8');
  const srcMtime = fs.statSync(srcFile).mtimeMs;
  const hapMtime = srcMtime + 60_000;
  fs.utimesSync(hapPath, hapMtime / 1000, hapMtime / 1000);
  return root;
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'computeDeviceTestInputsMaxMtimeMs: 扫描 architecture 外层 ets',
    run: () => {
      const root = mkReuseFixture();
      try {
        const layer = path.join(root, '02-Feature', 'Demo', 'src', 'Index.ets');
        const srcMtime = fs.statSync(layer).mtimeMs;
        const inputsMax = computeDeviceTestInputsMaxMtimeMs(root);
        if (inputsMax < srcMtime) throw new Error('inputs max should include ets');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'evaluateDeviceTestBuildReuse: HAP 新于源码 → reuse',
    run: () => {
      const root = mkReuseFixture();
      const prev = process.env.HARNESS_DEVICE_TEST_FORCE_BUILD;
      process.env.HARNESS_DEVICE_TEST_FORCE_BUILD = '';
      try {
        const decision = evaluateDeviceTestBuildReuse({ projectRoot: root, product: 'default' });
        if (!decision.reuse) throw new Error('should reuse when hap newer than sources');
        if (!decision.hapPath) throw new Error('hap path resolved');
      } finally {
        process.env.HARNESS_DEVICE_TEST_FORCE_BUILD = prev ?? '';
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'evaluateDeviceTestBuildReuse: 源码新于 HAP → 必须重编',
    run: () => {
      const root = mkReuseFixture();
      const prev = process.env.HARNESS_DEVICE_TEST_FORCE_BUILD;
      process.env.HARNESS_DEVICE_TEST_FORCE_BUILD = '';
      try {
        const srcFile = path.join(root, '02-Feature', 'Demo', 'src', 'Index.ets');
        const srcMtime = fs.statSync(srcFile).mtimeMs;
        fs.utimesSync(srcFile, (srcMtime + 120_000) / 1000, (srcMtime + 120_000) / 1000);
        const decision = evaluateDeviceTestBuildReuse({ projectRoot: root, product: 'default' });
        if (decision.reuse) throw new Error('should rebuild when source newer than hap');
      } finally {
        process.env.HARNESS_DEVICE_TEST_FORCE_BUILD = prev ?? '';
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'evaluateDeviceTestBuildReuse: FORCE_BUILD=1 → 禁止复用',
    run: () => {
      const root = mkReuseFixture();
      const prev = process.env.HARNESS_DEVICE_TEST_FORCE_BUILD;
      process.env.HARNESS_DEVICE_TEST_FORCE_BUILD = '1';
      try {
        const decision = evaluateDeviceTestBuildReuse({ projectRoot: root, product: 'default' });
        if (decision.reuse) throw new Error('force build disables reuse');
      } finally {
        process.env.HARNESS_DEVICE_TEST_FORCE_BUILD = prev ?? '';
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'evaluateDeviceTestBuildReuse: staleSuspect 纯观测——unsigned 新于 signed 时标记但不影响 reuse 判定（plan d7e4b2a9 t2）',
    run: () => {
      const root = mkReuseFixture();
      const prev = process.env.HARNESS_DEVICE_TEST_FORCE_BUILD;
      process.env.HARNESS_DEVICE_TEST_FORCE_BUILD = '';
      try {
        const hapDir = path.join(root, '01-Product', 'Phone', 'build', 'default', 'outputs', 'default');
        const signed = path.join(hapDir, 'Phone-default-signed.hap');
        const unsigned = path.join(hapDir, 'Phone-default-unsigned.hap');
        fs.writeFileSync(unsigned, 'unsigned', 'utf-8');
        const signedMtime = fs.statSync(signed).mtimeMs;
        fs.utimesSync(unsigned, (signedMtime + 60_000) / 1000, (signedMtime + 60_000) / 1000);

        const decision = evaluateDeviceTestBuildReuse({ projectRoot: root, product: 'default' });
        if (!decision.reuse) throw new Error('staleSuspect 是纯观测，不应改变 reuse 判定（HAP 仍新于源码）');
        if (decision.staleSuspect !== true) throw new Error('unsigned 更新时应标记 staleSuspect=true');
        if (decision.staleSuspectUnsignedPath !== unsigned) throw new Error('staleSuspectUnsignedPath 应指向配对 unsigned 文件');
      } finally {
        process.env.HARNESS_DEVICE_TEST_FORCE_BUILD = prev ?? '';
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'evaluateDeviceTestBuildReuse: 无 unsigned 配对时 staleSuspect=false（不误报）',
    run: () => {
      const root = mkReuseFixture();
      const prev = process.env.HARNESS_DEVICE_TEST_FORCE_BUILD;
      process.env.HARNESS_DEVICE_TEST_FORCE_BUILD = '';
      try {
        const decision = evaluateDeviceTestBuildReuse({ projectRoot: root, product: 'default' });
        if (decision.staleSuspect) throw new Error('无 unsigned 配对不应误报 staleSuspect');
      } finally {
        process.env.HARNESS_DEVICE_TEST_FORCE_BUILD = prev ?? '';
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'evaluateDeviceTestBuildReuse: reuse=true 分支也回填 scannedDirs/candidates（plan d7e4b2a9 review P2：复用路径不应让歧义 WARN 静默）',
    run: () => {
      const root = mkReuseFixture();
      const prev = process.env.HARNESS_DEVICE_TEST_FORCE_BUILD;
      process.env.HARNESS_DEVICE_TEST_FORCE_BUILD = '';
      try {
        // 额外放一个候选（另一 outputs 子目录），制造歧义，验证复用分支不再丢弃 candidates。
        const extraDir = path.join(root, '01-Product', 'Phone', 'build', 'product', 'outputs', 'product');
        fs.mkdirSync(extraDir, { recursive: true });
        fs.writeFileSync(path.join(extraDir, 'Phone-product-signed.hap'), 'fake-hap-2', 'utf-8');

        const decision = evaluateDeviceTestBuildReuse({ projectRoot: root, product: 'default' });
        if (!decision.reuse) throw new Error('HAP 仍新于源码，应复用');
        if (!decision.scannedDirs || decision.scannedDirs.length === 0) {
          throw new Error('reuse=true 分支应回填 scannedDirs（此前调 findAppSignedHap 薄包装会丢弃）');
        }
        if (!decision.candidates || decision.candidates.length < 2) {
          throw new Error(`reuse=true 分支应回填全部候选（此前会静默丢弃歧义）：${JSON.stringify(decision.candidates)}`);
        }
      } finally {
        process.env.HARNESS_DEVICE_TEST_FORCE_BUILD = prev ?? '';
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'provider 生产入口：skip env 必须短路——多候选 + skip + 已有旧 HAP 时不得复用、不得解析、最终 FAIL（review P1 第二轮）',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-skip-'));
      try {
        clearFrameworkConfigCache();
        // 多候选 build-profile（unresolved 会触发）+ 一个**较新**的 signed HAP
        //（若走到复用判定会命中 reuse → check-testing 假 PASS）
        fs.writeFileSync(
          path.join(root, 'build-profile.json5'),
          JSON.stringify({
            app: { products: [{ name: 'product' }, { name: 'mirror' }] },
            modules: [{ name: 'Phone', srcPath: './01-Product/Phone' }],
          }),
          'utf-8',
        );
        fs.writeFileSync(
          path.join(root, 'framework.config.json'),
          JSON.stringify({
            schema_version: '1.1',
            project_name: 'SkipInt',
            project_profile: { name: 'hmos-app', sub_variant: 'app' },
            architecture: {
              outer_layers: [{ id: '01-Product', can_depend_on: [], intra_layer_deps: 'forbid' }],
              module_inner_layers: ['shared'],
              inner_dependency_direction: 'upward',
              cross_module_exports_file: 'index.ets',
            },
            paths: { features_dir: 'doc/features' },
          }),
          'utf-8',
        );
        const hapDir = path.join(root, '01-Product', 'Phone', 'build', 'product', 'outputs', 'product');
        fs.mkdirSync(hapDir, { recursive: true });
        fs.writeFileSync(path.join(hapDir, 'Phone-product-signed.hap'), 'stale-but-new', 'utf-8');

        const prev = process.env.HARNESS_SKIP_DEVICE_TEST_BUILD;
        process.env.HARNESS_SKIP_DEVICE_TEST_BUILD = '1';
        try {
          const res = runDeviceTestAppBuild({
            projectRoot: root,
            harnessRoot: path.join(__dirname, '..', '..', '..', '..', '..', 'harness'),
            feature: 'skip-int',
            phase: 'testing',
          });
          if (!res.hvigor.skippedByEnv) throw new Error('必须返回 skippedByEnv 失败桩（不得进入解析/复用）');
          if (res.reused !== undefined && res.reused !== false && res.reused) {
            throw new Error('skip 路径不得复用 HAP');
          }
          if (res.hapPath !== null) throw new Error(`skip 路径不得扫描/命中任何 HAP（实际 ${res.hapPath}）`);
        } finally {
          if (prev === undefined) delete process.env.HARNESS_SKIP_DEVICE_TEST_BUILD;
          else process.env.HARNESS_SKIP_DEVICE_TEST_BUILD = prev;
        }
        // 生产源码顺序断言：skip 分支必须先于 resolveProductSelection / reuse / daemon
        const src = fs.readFileSync(
          path.join(__dirname, '..', '..', 'providers', 'device-test-build.ts'),
          'utf-8',
        );
        const skipIdx = src.indexOf("process.env[skipEnvVar]");
        const resolveIdx = src.indexOf('resolveProductSelection({');
        const reuseIdx = src.indexOf('evaluateDeviceTestBuildReuse({');
        const daemonIdx = src.indexOf('stopHvigorDaemon({');
        if (!(skipIdx >= 0 && skipIdx < resolveIdx && skipIdx < reuseIdx && skipIdx < daemonIdx)) {
          throw new Error(`skip 短路必须先于解析/复用/daemon（skip=${skipIdx}, resolve=${resolveIdx}, reuse=${reuseIdx}, daemon=${daemonIdx}）`);
        }
      } finally {
        clearFrameworkConfigCache();
        fs.rmSync(root, { recursive: true, force: true });
      }
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
