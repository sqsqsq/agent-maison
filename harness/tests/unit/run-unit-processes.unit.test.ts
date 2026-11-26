import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { mapQueued, runDiscoveredSuite, superviseProcess } from '../utils/unit-suite-processes';
import { runUnitCasesAsync } from '../utils/unit-cases';

export function runAll() {
  return runUnitCasesAsync([
    { name: 'idle slots take the next discovered task in order', async run() {
      const started: string[] = [];
      let releaseFirst!: () => void;
      const first = new Promise<void>(resolve => { releaseFirst = resolve; });
      const results = await mapQueued(['first', 'second', 'third'], 2, async name => {
        started.push(name);
        if (name === 'first') await first;
        if (name === 'third') releaseFirst();
        return name;
      });
      assert.deepEqual(started, ['first', 'second', 'third']);
      assert.deepEqual(results, started);
    } },
    { name: 'external deadline kills synchronous hangs and does not reset at case start', async run() {
      const supervisor = { root: os.tmpdir(), signal: new AbortController().signal };
      await assert.rejects(
        superviseProcess(['-e', "process.send('start'); while (true) {}"], {
          supervisor, limit: 1_500, label: 'Blocked',
          monitor: (_, watchdog) => watchdog.label('Blocked case'),
        }),
        /Blocked case timed out after 1500ms/,
      );
    } },
    { name: 'native root hook cleanup and synchronous callback use the same parent deadline', async run() {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'root-watchdog-'));
      try {
        const supervisor = { root, signal: new AbortController().signal };
        const hang = "writeFileSync(new URL('started', import.meta.url), 'entered'); while (true) {}";
        for (const declaration of [
          `test('blocked', () => { ${hang} });`,
          `test('blocked', () => {}); afterEach(ctx => { if (ctx.name === 'blocked') { ${hang} } });`,
        ]) {
          const modulePath = path.join(root, 'blocked.unit.mjs');
          const started = path.join(root, 'started');
          await fs.rm(started, { force: true });
          await fs.writeFile(modulePath, "import { test, afterEach } from 'node:test'; import { writeFileSync } from 'node:fs'; test('done', () => {});\n" + declaration);
          const run = await runDiscoveredSuite({ id: 'blocked', modulePath, kind: 'root' }, supervisor, ['done', 'blocked'], 1_500);
          assert.equal(await fs.readFile(started, 'utf8'), 'entered');
          assert.equal(run.timedOut, 1);
          assert.equal(run.executed, 1);
          assert.equal(run.missed, 1);
          assert.equal(run.missingResults, 2);
          assert.match(run.error!, /blocked.*timed out after 1500ms/);
        }
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    } },
  ]);
}
