// ============================================================================
// adhoc-dump-ui-path.unit.test.ts — resolveAdhocDumpUiOutPath 纯函数
// ============================================================================

import * as path from 'path';

import { resolveAdhocDumpUiOutPath } from '../../scripts/utils/adhoc-dump-ui';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'resolveAdhocDumpUiOutPath: explicitOut 时解析为绝对路径',
    run: () => {
      const out = resolveAdhocDumpUiOutPath('/proj', 'b', 'sub/dir/x.json');
      assert(out === path.resolve('sub/dir/x.json'), `got ${out}`);
    },
  },
  {
    name: 'resolveAdhocDumpUiOutPath: explicitOut 前后空白被裁剪',
    run: () => {
      const out = resolveAdhocDumpUiOutPath('/proj', 'b', '  /tmp/y.json  ');
      assert(out === path.resolve('/tmp/y.json'), `got ${out}`);
    },
  },
  {
    name: 'resolveAdhocDumpUiOutPath: 无 explicitOut → app-snapshot-cache 下 dump-ui-<slug>.json',
    run: () => {
      const out = resolveAdhocDumpUiOutPath('/proj', 'com.example', undefined);
      const dir = path.join('/proj', 'doc', 'app-snapshot-cache', 'com.example');
      assert(path.dirname(out) === dir, `dir=${path.dirname(out)}`);
      const base = path.basename(out);
      assert(/^dump-ui-\d{8}\.json$/.test(base), `base=${base}`);
    },
  },
  {
    name: 'resolveAdhocDumpUiOutPath: 空白 explicitOut 视为未提供 → 默认路径',
    run: () => {
      const out = resolveAdhocDumpUiOutPath('/proj', 'b', '   ');
      assert(out.includes(path.join('doc', 'app-snapshot-cache', 'b')), `got ${out}`);
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

if (require.main === module) {
  const r = runAll();
  for (const x of r) {
    console.log(x.ok ? `PASS ${x.name}` : `FAIL ${x.name}: ${x.error}`);
  }
  process.exit(r.every(x => x.ok) ? 0 : 1);
}
