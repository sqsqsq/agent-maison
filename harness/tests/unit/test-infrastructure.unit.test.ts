import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { runUnitCases } from '../utils/unit-cases';
import { snapshotTestInputs } from '../utils/test-input-snapshot';
import { filterSuites } from '../utils/unit-suite-registry';
import { verifyCaseResults } from '../utils/unit-suite-processes';

export function runAll() {
  return runUnitCases([
    { name: 'discovery matches a literal suite substring without falling back to case names', run() {
      const suites = ['a[1]', 'aX1'].map(id => ({ id, kind: 'unit' as const, modulePath: id }));
      assert.deepEqual(filterSuites(suites, '[1]').map(suite => suite.id), ['a[1]']);
      assert.throws(() => filterSuites(suites, 'missing'), /no test suites match/);
    } },
    { name: 'case copies cannot stand in for a distinct registered case', run() {
      const a = { name: 'a', ok: true };
      assert.deepEqual(verifyCaseResults(['a', 'b'], ['a', 'b'], [a, { name: 'b', ok: true }]), { passed: 2, failed: 0, missed: 0 });
      const duplicate = verifyCaseResults(['a', 'b'], ['a'], [a, a]);
      assert.equal(duplicate.passed, 1);
      assert.equal(duplicate.missed, 1);
      assert.match(duplicate.error!, /unexpected or repeated case result: a/);
      assert.match(duplicate.error!, /missing case results: b/);
      assert.equal(verifyCaseResults(['a'], [], [a]).missed, 1);
    } },
    { name: 'source identity covers staged, unstaged and new root tool inputs', run() {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'test-input-'));
      try {
        const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
        git('init', '-q');
        fs.writeFileSync(path.join(root, 'package.json'), '{}');
        git('add', '.');
        git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'base');
        const before = snapshotTestInputs(root);
        fs.mkdirSync(path.join(root, 'scripts/tests'), { recursive: true });
        fs.writeFileSync(path.join(root, 'scripts/tests/new.unit.mjs'), 'export {};');
        git('add', 'scripts/tests/new.unit.mjs');
        fs.writeFileSync(path.join(root, 'package.json'), '{"version":"1"}');
        const after = snapshotTestInputs(root);
        assert.notEqual(before.id, after.id);
        assert.notEqual(before.files['package.json'], after.files['package.json']);
        assert.match(after.files['scripts/tests/new.unit.mjs'], /^[a-f0-9]{64}$/);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    } },
  ]);
}
