import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { discoverCases, runDiscoveredSuite } from '../utils/unit-suite-processes';
import { runUnitCasesAsync } from '../utils/unit-cases';

export function runAll() {
  return runUnitCasesAsync([
    { name: 'test worker isolates inherited trust and cleans its own temporary roots', async run() {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trust-blackbox-'));
      const previous = process.env.MAISON_GOAL_CHECKPOINT_DIR;
      try {
        const sentinel = path.join(root, 'sentinel');
        await fs.mkdir(sentinel);
        await fs.writeFile(path.join(sentinel, 'sentinel.txt'), 'DO-NOT-TOUCH');
        process.env.MAISON_GOAL_CHECKPOINT_DIR = sentinel;
        const modulePath = path.resolve(__dirname, 'trust-isolation-probe.unit.test.ts');
        const suite = { id: 'trust-isolation-probe', modulePath, kind: 'unit' as const };
        const supervisor = { root, signal: new AbortController().signal };
        const expected = await discoverCases(suite, supervisor);
        const result = await runDiscoveredSuite(suite, supervisor, expected);
        assert.equal(result.error, undefined);
        assert.equal(result.passed, expected.length);
        assert.deepEqual(await fs.readdir(root), ['sentinel']);
        assert.deepEqual(await fs.readdir(sentinel), ['sentinel.txt']);
        assert.equal(await fs.readFile(path.join(sentinel, 'sentinel.txt'), 'utf8'), 'DO-NOT-TOUCH');
      } finally {
        if (previous === undefined) delete process.env.MAISON_GOAL_CHECKPOINT_DIR;
        else process.env.MAISON_GOAL_CHECKPOINT_DIR = previous;
        await fs.rm(root, { recursive: true, force: true });
      }
    } },
  ]);
}
