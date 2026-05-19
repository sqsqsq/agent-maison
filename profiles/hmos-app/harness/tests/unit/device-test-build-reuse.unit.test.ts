import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  computeDeviceTestInputsMaxMtimeMs,
  evaluateDeviceTestBuildReuse,
} from '../../device-test-build-reuse';

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
        const decision = evaluateDeviceTestBuildReuse({ projectRoot: root });
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
        const decision = evaluateDeviceTestBuildReuse({ projectRoot: root });
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
        const decision = evaluateDeviceTestBuildReuse({ projectRoot: root });
        if (decision.reuse) throw new Error('force build disables reuse');
      } finally {
        process.env.HARNESS_DEVICE_TEST_FORCE_BUILD = prev ?? '';
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
