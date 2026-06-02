import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { computeAnchorContentHash, sha256ContentHash } from '../../code-graph/anchor-hash';
import type { UnitCaseResult } from './ut-artifact-validate.unit.test';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function testStableHash(): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-hash-'));
  const rel = 'src/Foo.ets';
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), 'function foo() { return 1; }', 'utf-8');
  const h1 = computeAnchorContentHash(dir, rel, 'foo');
  const h2 = computeAnchorContentHash(dir, rel, 'foo');
  assert(Boolean(h1 && h1 === h2), 'hash stable');
  assert(h1 === sha256ContentHash('function foo() { return 1; }'), 'matches body hash');
  fs.rmSync(dir, { recursive: true, force: true });
}

export function runAll(): UnitCaseResult[] {
  const cases = [{ name: 'anchor hash stable', fn: testStableHash }];
  return cases.map(({ name, fn }) => {
    try {
      fn();
      return { name, ok: true };
    } catch (e) {
      return { name, ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
}
