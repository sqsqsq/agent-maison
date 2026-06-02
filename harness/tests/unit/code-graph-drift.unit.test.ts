import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { evaluateCodeGraphDrift } from '../../code-graph/drift';
import type { CodeGraphFile } from '../../code-graph/types';
import type { UnitCaseResult } from './ut-artifact-validate.unit.test';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function testMissingFileBlocker(): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-drift-'));
  const graph: CodeGraphFile = {
    schema_version: '1.0',
    module: 'm1',
    nodes: [
      {
        id: 'n1',
        core: true,
        anchor: { file: 'missing.ets', symbol: 'foo', content_hash: 'abc' },
      },
    ],
  };
  const findings = evaluateCodeGraphDrift(dir, graph);
  assert(findings.some(f => f.code === 'anchor_file_missing' && f.severity === 'BLOCKER'), 'file missing');
  fs.rmSync(dir, { recursive: true, force: true });
}

function testBodyHashWarn(): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-drift-'));
  const rel = 'src/Foo.ets';
  const body = 'function foo() { return 1; }';
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), body, 'utf-8');
  const graph: CodeGraphFile = {
    schema_version: '1.0',
    module: 'm1',
    nodes: [
      {
        id: 'n1',
        anchor: { file: rel, symbol: 'foo', content_hash: 'deadbeef00000000' },
      },
    ],
  };
  const findings = evaluateCodeGraphDrift(dir, graph);
  assert(findings.some(f => f.code === 'body_hash_changed'), 'hash drift');
  fs.rmSync(dir, { recursive: true, force: true });
}

export function runAll(): UnitCaseResult[] {
  const cases = [
    { name: 'missing file BLOCKER', fn: testMissingFileBlocker },
    { name: 'body hash WARN', fn: testBodyHashWarn },
  ];
  return cases.map(({ name, fn }) => {
    try {
      fn();
      return { name, ok: true };
    } catch (e) {
      return { name, ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
}
