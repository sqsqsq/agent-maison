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
      assert(typeof json.harness_root === 'string');
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
