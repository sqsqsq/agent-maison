// init-readiness.unit.test.ts

import assert from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';

const HARNESS_ROOT = path.join(__dirname, '../..');
const SCRIPT = path.join(HARNESS_ROOT, 'scripts', 'init-readiness.mjs');
const SCRIPT_URL = pathToFileURL(SCRIPT).href;

interface ReadinessResult {
  ok: boolean;
  missing: string[];
  recommended_command: string;
  recommended_cwd: string;
  recommended_executable: string;
  recommended_args: string[];
  harness_root: string;
}

function checkInitReadiness(harnessRoot: string, cwd: string): ReadinessResult {
  const code = [
    `import { checkInitReadiness } from ${JSON.stringify(SCRIPT_URL)};`,
    `const r = checkInitReadiness(${JSON.stringify(harnessRoot)}, ${JSON.stringify(cwd)});`,
    'process.stdout.write(JSON.stringify(r));',
  ].join('');
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    encoding: 'utf-8',
  });
  if (r.status !== 0) {
    throw new Error(`checkInitReadiness failed: ${r.stderr ?? r.stdout}`);
  }
  return JSON.parse((r.stdout ?? '').trim()) as ReadinessResult;
}

function runReadinessCli(cwd: string): { status: number | null; json: ReadinessResult } {
  const r = spawnSync(process.execPath, [SCRIPT], { cwd, encoding: 'utf-8' });
  const raw = (r.stdout ?? '').trim();
  return { status: r.status, json: JSON.parse(raw || '{}') as ReadinessResult };
}

function mkHarnessFixture(options: {
  withPackageJson?: boolean;
  withTsNode?: boolean;
  withTypesNode?: boolean;
}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'init-ready-'));
  if (options.withPackageJson !== false) {
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ name: 'harness-fixture' }),
      'utf-8',
    );
  }
  if (options.withTsNode) {
    const p = path.join(root, 'node_modules', 'ts-node', 'package.json');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, '{}', 'utf-8');
  }
  if (options.withTypesNode) {
    const p = path.join(root, 'node_modules', '@types', 'node', 'package.json');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, '{}', 'utf-8');
  }
  return root;
}

/**
 * E5（多模态降级阶梯 plan d4a8f3c6）：standalone 布局全套夹具——
 * projectRoot=frameworkRoot=<tmp>，harnessRoot=<tmp>/harness。
 */
function mkStandaloneProjectFixture(options: {
  profileName?: string;
  withProfileOcrToolkit?: boolean;
  withTesseractJs?: boolean;
  withTessdata?: boolean;
}): { projectRoot: string; harnessRoot: string } {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'init-ready-e5-'));
  const harnessRoot = path.join(projectRoot, 'harness');
  fs.mkdirSync(harnessRoot, { recursive: true });
  fs.writeFileSync(path.join(harnessRoot, 'package.json'), JSON.stringify({ name: 'h' }), 'utf-8');
  fs.mkdirSync(path.join(harnessRoot, 'node_modules', 'ts-node'), { recursive: true });
  fs.writeFileSync(path.join(harnessRoot, 'node_modules', 'ts-node', 'package.json'), '{}', 'utf-8');
  fs.mkdirSync(path.join(harnessRoot, 'node_modules', '@types', 'node'), { recursive: true });
  fs.writeFileSync(path.join(harnessRoot, 'node_modules', '@types', 'node', 'package.json'), '{}', 'utf-8');

  const profileName = options.profileName ?? 'hmos-app';
  fs.writeFileSync(
    path.join(projectRoot, 'framework.config.json'),
    JSON.stringify({ schema_version: '1.0', project_profile: { name: profileName } }),
    'utf-8',
  );
  const profileHarnessDir = path.join(projectRoot, 'profiles', profileName, 'harness');
  fs.mkdirSync(profileHarnessDir, { recursive: true });
  if (options.withProfileOcrToolkit) {
    fs.writeFileSync(path.join(profileHarnessDir, 'ocr-toolkit.ts'), '// stub\n', 'utf-8');
  }
  if (options.withTesseractJs) {
    const p = path.join(harnessRoot, 'node_modules', 'tesseract.js', 'package.json');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, '{}', 'utf-8');
  }
  if (options.withTessdata) {
    const tessDir = path.join(projectRoot, 'profiles', profileName, 'vendor', 'tessdata');
    fs.mkdirSync(tessDir, { recursive: true });
    fs.writeFileSync(path.join(tessDir, 'chi_sim.traineddata'), 'stub', 'utf-8');
  }
  return { projectRoot, harnessRoot };
}

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

const RECOMMENDED_COMMAND = 'cd framework/harness && npm install';

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'checkInitReadiness all deps present and cwd matches',
    run: () => {
      const root = mkHarnessFixture({ withTsNode: true, withTypesNode: true });
      try {
        const r = checkInitReadiness(root, root);
        assert.strictEqual(r.ok, true);
        assert.deepStrictEqual(r.missing, []);
        assert.strictEqual(r.recommended_command, RECOMMENDED_COMMAND);
        assert.strictEqual(r.recommended_cwd, root);
        assert.strictEqual(r.recommended_executable, 'npm');
        assert.deepStrictEqual(r.recommended_args, ['install']);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'checkInitReadiness reports missing ts-node',
    run: () => {
      const root = mkHarnessFixture({ withTypesNode: true });
      try {
        const r = checkInitReadiness(root, root);
        assert.strictEqual(r.ok, false);
        assert(
          r.missing.some((m: string) => m.includes('ts-node')),
          `expected ts-node in missing: ${r.missing.join(',')}`,
        );
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'checkInitReadiness reports missing @types/node',
    run: () => {
      const root = mkHarnessFixture({ withTsNode: true });
      try {
        const r = checkInitReadiness(root, root);
        assert.strictEqual(r.ok, false);
        assert(
          r.missing.some((m: string) => m.includes('@types/node')),
          `expected @types/node in missing: ${r.missing.join(',')}`,
        );
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'checkInitReadiness reports missing package.json',
    run: () => {
      const root = mkHarnessFixture({
        withPackageJson: false,
        withTsNode: true,
        withTypesNode: true,
      });
      try {
        const r = checkInitReadiness(root, root);
        assert.strictEqual(r.ok, false);
        assert(r.missing.some((m: string) => m.includes('package.json')));
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'checkInitReadiness reports wrong cwd',
    run: () => {
      const root = mkHarnessFixture({ withTsNode: true, withTypesNode: true });
      const parent = path.dirname(root);
      try {
        const r = checkInitReadiness(root, parent);
        assert.strictEqual(r.ok, false);
        assert(r.missing.some((m: string) => m.includes('cwd must be framework/harness')));
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'init-readiness CLI ok when real harness deps installed',
    run: () => {
      const tsNode = path.join(HARNESS_ROOT, 'node_modules', 'ts-node', 'package.json');
      const typesNode = path.join(HARNESS_ROOT, 'node_modules', '@types', 'node', 'package.json');
      if (!fs.existsSync(tsNode) || !fs.existsSync(typesNode)) {
        return;
      }
      const { status, json } = runReadinessCli(HARNESS_ROOT);
      assert.strictEqual(status, 0);
      assert.strictEqual(json.ok, true);
      assert.deepStrictEqual(json.missing, []);
    },
  },
  {
    name: 'init-readiness CLI JSON shape is stable',
    run: () => {
      const { json } = runReadinessCli(HARNESS_ROOT);
      assert('ok' in json);
      assert(Array.isArray(json.missing));
      assert(typeof json.recommended_command === 'string');
      assert(typeof json.recommended_cwd === 'string');
      assert(typeof json.recommended_executable === 'string');
      assert(Array.isArray(json.recommended_args));
      assert(typeof json.harness_root === 'string');
    },
  },
  // ==========================================================================
  // E5（多模态降级阶梯 plan d4a8f3c6）：Tier_1 探针补 OCR 就绪度
  // ==========================================================================
  {
    name: 'E5 checkInitReadiness: profile 有 ocr-toolkit + tesseract.js/tessdata 齐全 → ok（不误报）',
    run: () => {
      const { projectRoot, harnessRoot } = mkStandaloneProjectFixture({
        withProfileOcrToolkit: true,
        withTesseractJs: true,
        withTessdata: true,
      });
      try {
        const r = checkInitReadiness(harnessRoot, harnessRoot);
        assert.strictEqual(r.ok, true, JSON.stringify(r.missing));
        assert.deepStrictEqual(r.missing, []);
      } finally {
        fs.rmSync(projectRoot, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'E5 checkInitReadiness: profile 有 ocr-toolkit 但缺 tesseract.js → 命中，指向 npm install',
    run: () => {
      const { projectRoot, harnessRoot } = mkStandaloneProjectFixture({
        withProfileOcrToolkit: true,
        withTesseractJs: false,
        withTessdata: true,
      });
      try {
        const r = checkInitReadiness(harnessRoot, harnessRoot);
        assert.strictEqual(r.ok, false);
        const hit = r.missing.find((m) => m.includes('tesseract.js'));
        assert(hit, `expected tesseract.js in missing: ${r.missing.join(' | ')}`);
        assert(hit!.includes('npm install'), hit);
      } finally {
        fs.rmSync(projectRoot, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'E5 checkInitReadiness: profile 有 ocr-toolkit 但缺 chi_sim.traineddata → 命中，指向 framework 完整性修复（非 npm install）',
    run: () => {
      const { projectRoot, harnessRoot } = mkStandaloneProjectFixture({
        withProfileOcrToolkit: true,
        withTesseractJs: true,
        withTessdata: false,
      });
      try {
        const r = checkInitReadiness(harnessRoot, harnessRoot);
        assert.strictEqual(r.ok, false);
        const hit = r.missing.find((m) => m.includes('chi_sim.traineddata'));
        assert(hit, `expected chi_sim.traineddata in missing: ${r.missing.join(' | ')}`);
        assert(hit!.includes('分发不完整'), hit);
        assert(hit!.includes('非 npm 包'), 'tessdata 缺失应明说非 npm 包（区别于 npm install 修复）：' + hit);
      } finally {
        fs.rmSync(projectRoot, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'E5 checkInitReadiness: profile 无 ocr-toolkit（如 generic）→ 完全跳过 OCR 检查，即便 tesseract.js/tessdata 都缺',
    run: () => {
      const { projectRoot, harnessRoot } = mkStandaloneProjectFixture({
        profileName: 'generic',
        withProfileOcrToolkit: false,
        withTesseractJs: false,
        withTessdata: false,
      });
      try {
        const r = checkInitReadiness(harnessRoot, harnessRoot);
        assert.strictEqual(r.ok, true, `非 OCR profile 不应因缺 OCR 资产被判 not-ok：${JSON.stringify(r.missing)}`);
        assert.deepStrictEqual(r.missing, []);
      } finally {
        fs.rmSync(projectRoot, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'E5 checkInitReadiness: 无 framework.config.json（未初始化）不阻断 Tier_1 探针本身（按默认 profile 回落，文件不存在则天然跳过 OCR 检查）',
    run: () => {
      const root = mkHarnessFixture({ withTsNode: true, withTypesNode: true });
      try {
        // mkHarnessFixture 不写 framework.config.json、不建 profiles/ —— 模拟"harness 依赖已装
        // 但项目尚未跑过 framework-init"的边缘态；不应因 OCR 探测逻辑本身报错或误判。
        const r = checkInitReadiness(root, root);
        assert.strictEqual(r.ok, true, JSON.stringify(r.missing));
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
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
