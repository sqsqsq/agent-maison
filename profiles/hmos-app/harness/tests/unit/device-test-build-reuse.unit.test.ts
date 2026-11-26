import { runUnitCases } from '../../../../../harness/tests/utils/unit-cases';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  evaluateDeviceTestBuildReuse,
  snapshotDeviceTestBuildInputs,
} from '../../device-test-build-reuse';
import { runDeviceTestAppBuild } from '../../providers/device-test-build';
import { computeHapSha256Full } from '../../build-fingerprint';
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
    '{"modules":[{"name":"Phone","srcPath":"./01-Product/Phone"},{"name":"Demo","srcPath":"./02-Feature/Demo"}]}',
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
  fs.mkdirSync(path.join(layer, 'src/main'));
  fs.writeFileSync(path.join(layer, 'src/main/module.json5'), '{"module":{"type":"har"}}');
  fs.writeFileSync(path.join(layer, 'oh-package.json5'), '{"version":"1.0.0"}');
  fs.writeFileSync(path.join(layer, 'hvigorfile.ts'), "import { harTasks } from '@ohos/hvigor-ohos-plugin';\nexport default { system: harTasks, plugins: [] }\n");
  fs.writeFileSync(path.join(root, 'hvigorfile.ts'), "import { appTasks } from '@ohos/hvigor-ohos-plugin';\nexport default { system: appTasks, plugins: [] }\n");
  const hapDir = path.join(root, '01-Product', 'Phone', 'build', 'default', 'outputs', 'default');
  fs.mkdirSync(hapDir, { recursive: true });
  const hapPath = path.join(hapDir, 'Phone-default-signed.hap');
  fs.writeFileSync(hapPath, 'fake-hap', 'utf-8');
  fs.writeFileSync(hapPath.replace('-signed.hap', '-unsigned.hap'), 'unsigned');
  const srcMtime = fs.statSync(srcFile).mtimeMs;
  const hapMtime = srcMtime + 60_000;
  fs.utimesSync(hapPath, hapMtime / 1000, hapMtime / 1000);
  fs.writeFileSync(path.join(root, 'device-test-build.result.json'), JSON.stringify({ buildSucceeded: true,
    resolvedProduct: 'default', resolvedBuildMode: 'debug', hapPath, hapSha256Full: computeHapSha256Full(hapPath),
    buildInputsSha256: snapshotDeviceTestBuildInputs(root, 'default', 'debug')?.sha256 }));
  return root;
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'snapshotDeviceTestBuildInputs: 扫描 architecture 外层 ets',
    run: () => {
      const root = mkReuseFixture();
      try {
        const layer = path.join(root, '02-Feature', 'Demo', 'src', 'Index.ets');
        const srcMtime = fs.statSync(layer).mtimeMs;
        const inputsMax = snapshotDeviceTestBuildInputs(root, 'default', 'debug')!.maxMtimeMs;
        if (inputsMax < srcMtime) throw new Error('inputs max should include ets');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: '构建输入不读私钥和环境文件，公开签名身份、库文件状态和换包仍使构建失效',
    run: () => {
      const root = mkReuseFixture();
      const external = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-signing-'));
      const nodeFs = require('node:fs') as typeof fs;
      const crypto = require('node:crypto') as typeof import('crypto');
      const originalRead = nodeFs.readFileSync;
      const originalHash = crypto.createHash;
      const attemptedReads: string[] = [];
      let secretHashed = false;
      try {
        const opaque = [path.join(external, 'selected.p12'), path.join(root, '.ohpmrc'),
          ...['cached.p12', 'backup.PFX', 'debug.jks', 'signing.key', '.env.local', 'opaque-store'].map(name => path.join(root, '02-Feature/Demo', name))];
        for (const file of opaque) fs.writeFileSync(file, 'fixture-secret-value');
        fs.writeFileSync(path.join(root, 'sign.cer'), 'public fixture certificate');
        fs.writeFileSync(path.join(root, 'app.p7b'), 'public fixture profile');
        const bpFile = path.join(root, 'build-profile.json5');
        const bp = JSON.parse(fs.readFileSync(bpFile, 'utf8'));
        const material = { storeFile: opaque[0], profile: 'app.p7b', certpath: 'sign.cer', keyAlias: 'app-key',
          keyPassword: 'fixture-secret-value', storePassword: 'fixture-secret-value', signAlg: 'SHA256withECDSA' };
        bp.app = { products: [{ name: 'default', signingConfig: 'debug' }],
          signingConfigs: [{ name: 'debug', type: 'HarmonyOS', material },
            { name: 'other', type: 'HarmonyOS', material: { ...material, storeFile: opaque.at(-1) } }] };
        const writeConfig = () => fs.writeFileSync(bpFile, JSON.stringify(bp));
        writeConfig();
        nodeFs.readFileSync = ((file: Parameters<typeof originalRead>[0], ...rest: unknown[]) => {
          if (typeof file === 'string' && opaque.includes(file)) attemptedReads.push(path.basename(file));
          return Reflect.apply(originalRead, nodeFs, [file, ...rest]);
        }) as typeof originalRead;
        crypto.createHash = ((...args: Parameters<typeof originalHash>) => {
          const hash = originalHash(...args);
          const update = hash.update;
          hash.update = ((value: string | Buffer, ...rest: unknown[]) => {
            if (value.toString().includes('fixture-secret-value')) secretHashed = true;
            return Reflect.apply(update, hash, [value, ...rest]);
          }) as typeof update;
          return hash;
        }) as typeof originalHash;
        const result = path.join(root, 'device-test-build.result.json');
        const bind = () => {
          const snapshot = snapshotDeviceTestBuildInputs(root, 'default', 'debug');
          assert(snapshot);
          const record = JSON.parse(fs.readFileSync(result, 'utf8'));
          fs.writeFileSync(result, JSON.stringify({ ...record, buildInputsSha256: snapshot.sha256 }));
          return record.hapPath as string;
        };
        const reuse = () => evaluateDeviceTestBuildReuse({ projectRoot: root, product: 'default', reportDir: root }).reuse;
        const hap = bind();
        assert(reuse());
        assert.deepEqual(attemptedReads, []);
        assert.equal(secretHashed, false);
        for (const publicFile of ['sign.cer', 'app.p7b']) {
          const file = path.join(root, publicFile);
          const stat = fs.statSync(file);
          fs.writeFileSync(file, 'changed public fixture identity');
          fs.utimesSync(file, stat.atime, stat.mtime);
          assert(!reuse());
          bind();
        }
        material.keyAlias = 'other-key'; writeConfig();
        assert(!reuse()); bind();
        const storeStat = fs.statSync(opaque[0]);
        fs.utimesSync(opaque[0], storeStat.atime, new Date(storeStat.mtimeMs + 2000));
        assert(!reuse()); bind();
        fs.writeFileSync(hap, 'fixture-replacement-hap');
        assert(!reuse());
        material.profile = opaque[0]; writeConfig();
        assert.equal(snapshotDeviceTestBuildInputs(root, 'default', 'debug'), null);
        assert.deepEqual(attemptedReads, []);
        assert.equal(secretHashed, false);
      } finally {
        nodeFs.readFileSync = originalRead;
        crypto.createHash = originalHash;
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(external, { recursive: true, force: true });
      }
    },
  },
  {
    name: '标准 HAR test BuildProfile 不失效，手写同名、错误 target、目录和 custom task 仍是输入',
    run: () => {
      const root = mkReuseFixture();
      try {
        const build = () => evaluateDeviceTestBuildReuse({ projectRoot: root, product: 'default', reportDir: root });
        const moduleRoot = path.join(root, '02-Feature/Demo');
        const generated = path.join(moduleRoot, 'BuildProfile.ets');
        const consts = { HAR_VERSION: "'1.0.0'", BUILD_MODE_NAME: "'test'", DEBUG: 'true', TARGET_NAME: "'default'" };
        const profile = Object.entries(consts).map(([k, v]) => `export const ${k} = ${v};`).join('\n') +
          '\nexport default class BuildProfile {\n' + Object.keys(consts).map(key => `static readonly ${key} = ${key};`).join('\n') + '\n}\n';
        fs.writeFileSync(generated, profile);
        const future = Date.now() / 1000 + 120;
        fs.utimesSync(generated, future, future);
        assert(build().reuse);
        fs.writeFileSync(generated, profile.replace('DEBUG = true', 'DEBUG = false'));
        assert(!build().reuse);
        fs.writeFileSync(generated, profile.replace('DEBUG = true', "DEBUG = 'true'"));
        assert(!build().reuse);
        fs.writeFileSync(generated, profile.replace("TARGET_NAME = 'default'", "TARGET_NAME = 'unexpected'"));
        assert(!build().reuse);
        fs.writeFileSync(generated, profile + 'export const custom = 1;');
        assert(!build().reuse);
        fs.writeFileSync(generated, profile);
        fs.writeFileSync(path.join(moduleRoot, 'src/BuildProfile.ets'), profile);
        assert(!build().reuse);
        fs.unlinkSync(path.join(moduleRoot, 'src/BuildProfile.ets'));
        const script = path.join(moduleRoot, 'hvigorfile.ts');
        fs.appendFileSync(script, '\nexport const customize = true;\n');
        const beforeCustomProfile = snapshotDeviceTestBuildInputs(root, 'default', 'debug')?.sha256;
        fs.unlinkSync(generated);
        assert.notEqual(snapshotDeviceTestBuildInputs(root, 'default', 'debug')?.sha256, beforeCustomProfile);
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    },
  },
  {
    name: '资源增删、保 mtime 修改、实际签名文件和构建变体分别失效',
    run: () => {
      const root = mkReuseFixture();
      try {
        const result = path.join(root, 'device-test-build.result.json');
        const bind = () => fs.writeFileSync(result, JSON.stringify({ ...JSON.parse(fs.readFileSync(result, 'utf8')),
          buildInputsSha256: snapshotDeviceTestBuildInputs(root, 'default', 'debug')?.sha256 }));
        const build = (buildMode?: 'debug' | 'release') => evaluateDeviceTestBuildReuse({ projectRoot: root, product: 'default', buildMode, reportDir: root });
        const resource = path.join(root, '02-Feature/Demo/src/main/resources/base/media/asset.png');
        fs.mkdirSync(path.dirname(resource), { recursive: true });
        fs.writeFileSync(resource, Buffer.from([1, 2]));
        assert(!build().reuse);
        bind();
        assert(build().reuse);
        const stat = fs.statSync(resource);
        fs.writeFileSync(resource, Buffer.from([1, 3]));
        fs.utimesSync(resource, stat.atime, stat.mtime);
        assert(!build().reuse);
        bind();
        fs.unlinkSync(resource);
        assert(!build().reuse);
        const rootConfig = path.join(root, 'build-profile.json5');
        const bp = JSON.parse(fs.readFileSync(rootConfig, 'utf8'));
        bp.app = { products: [{ name: 'default', signingConfig: 'debug' }], signingConfigs: [{ name: 'debug',
          material: { storeFile: 'key.p12', profile: 'app.p7b', certpath: 'app.cer' } }] };
        fs.writeFileSync(rootConfig, JSON.stringify(bp));
        for (const name of ['key.p12', 'app.p7b', 'app.cer']) fs.writeFileSync(path.join(root, name), 'fixture');
        bind();
        assert(build().reuse);
        assert(!build('release').reuse);
        fs.writeFileSync(path.join(root, 'app.p7b'), 'changed');
        assert(!build().reuse);
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    },
  },
  {
    name: 'evaluateDeviceTestBuildReuse: HAP 新于源码 → reuse',
    run: () => {
      const root = mkReuseFixture();
      const prev = process.env.HARNESS_DEVICE_TEST_FORCE_BUILD;
      process.env.HARNESS_DEVICE_TEST_FORCE_BUILD = '';
      try {
        const decision = evaluateDeviceTestBuildReuse({ projectRoot: root, product: 'default', reportDir: root });
        if (!decision.reuse) throw new Error('should reuse when hap newer than sources');
        if (!decision.hapPath) throw new Error('hap path resolved');
      } finally {
        process.env.HARNESS_DEVICE_TEST_FORCE_BUILD = prev ?? '';
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'evaluateDeviceTestBuildReuse: 源码字节改变 → 必须重编',
    run: () => {
      const root = mkReuseFixture();
      const prev = process.env.HARNESS_DEVICE_TEST_FORCE_BUILD;
      process.env.HARNESS_DEVICE_TEST_FORCE_BUILD = '';
      try {
        const srcFile = path.join(root, '02-Feature', 'Demo', 'src', 'Index.ets');
        fs.writeFileSync(srcFile, 'export const value = 1;');
        const decision = evaluateDeviceTestBuildReuse({ projectRoot: root, product: 'default', reportDir: root });
        if (decision.reuse) throw new Error('should rebuild when source bytes changed');
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
        const decision = evaluateDeviceTestBuildReuse({ projectRoot: root, product: 'default', reportDir: root });
        if (decision.reuse) throw new Error('force build disables reuse');
      } finally {
        process.env.HARNESS_DEVICE_TEST_FORCE_BUILD = prev ?? '';
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'evaluateDeviceTestBuildReuse: unsigned 新于 signed 时不得复用',
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

        const decision = evaluateDeviceTestBuildReuse({ projectRoot: root, product: 'default', reportDir: root });
        if (decision.reuse || decision.hapPath) throw new Error('陈旧 signed 不得复用或作为安装路径');
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
        fs.unlinkSync(path.join(root, '01-Product/Phone/build/default/outputs/default/Phone-default-unsigned.hap'));
        const decision = evaluateDeviceTestBuildReuse({ projectRoot: root, product: 'default', reportDir: root });
        if (decision.reuse || decision.artifactValidation?.status !== 'unknown') throw new Error('无配对依据不得复用');
        if (decision.staleSuspect) throw new Error('无 unsigned 配对不应误报 staleSuspect');
      } finally {
        process.env.HARNESS_DEVICE_TEST_FORCE_BUILD = prev ?? '';
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'evaluateDeviceTestBuildReuse: reuse=true 分支保留所选 product 的 scannedDirs/candidates',
    run: () => {
      const root = mkReuseFixture();
      const prev = process.env.HARNESS_DEVICE_TEST_FORCE_BUILD;
      process.env.HARNESS_DEVICE_TEST_FORCE_BUILD = '';
      try {
        // 放入其它 product 的包，验证复用诊断只保留当前 product 的候选。
        const extraDir = path.join(root, '01-Product', 'Phone', 'build', 'product', 'outputs', 'product');
        fs.mkdirSync(extraDir, { recursive: true });
        fs.writeFileSync(path.join(extraDir, 'Phone-product-signed.hap'), 'fake-hap-2', 'utf-8');

        const decision = evaluateDeviceTestBuildReuse({ projectRoot: root, product: 'default', reportDir: root });
        if (!decision.reuse) throw new Error('HAP 仍新于源码，应复用');
        if (!decision.scannedDirs || decision.scannedDirs.length === 0) {
          throw new Error('reuse=true 分支应回填 scannedDirs（此前调 findAppSignedHap 薄包装会丢弃）');
        }
        if (!decision.candidates || decision.candidates.length !== 1) {
          throw new Error(`reuse=true 只保留所选 product 候选：${JSON.stringify(decision.candidates)}`);
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
        // 生产源码顺序断言：skip 分支必须先于 resolveProductSelection / reuse
        const src = fs.readFileSync(
          path.join(__dirname, '..', '..', 'providers', 'device-test-build.ts'),
          'utf-8',
        );
        const skipIdx = src.indexOf("process.env[skipEnvVar]");
        const resolveIdx = src.indexOf('resolveProductSelection({');
        const reuseIdx = src.indexOf('evaluateDeviceTestBuildReuse({');
        if (!(skipIdx >= 0 && skipIdx < resolveIdx && skipIdx < reuseIdx)) {
          throw new Error(`skip 短路必须先于解析/复用（skip=${skipIdx}, resolve=${resolveIdx}, reuse=${reuseIdx}）`);
        }
      } finally {
        clearFrameworkConfigCache();
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
];

export function runAll(): UnitCaseResult[] {
  return runUnitCases(cases);
}
