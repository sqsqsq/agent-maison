// ============================================================================
// adhoc-input-path.unit.test.ts
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveAdhocInputPath } from '../../scripts/utils/adhoc-input-path';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'resolveAdhocInputPath: project-relative from harness cwd',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'adhoc-path-'));
      const docDir = path.join(root, 'doc', 'features', '_adhoc', 'testing');
      fs.mkdirSync(docDir, { recursive: true });
      const target = path.join(docDir, 'steps.json');
      fs.writeFileSync(target, '[]\n', 'utf-8');
      const harnessCwd = path.join(root, 'framework', 'harness');
      fs.mkdirSync(harnessCwd, { recursive: true });
      const prev = process.cwd();
      try {
        process.chdir(harnessCwd);
        const resolved = resolveAdhocInputPath(root, '../../doc/features/_adhoc/testing/steps.json');
        if (resolved !== path.resolve(target)) {
          throw new Error(`expected ${target}, got ${resolved}`);
        }
      } finally {
        process.chdir(prev);
      }
    },
  },
  {
    name: 'resolveAdhocInputPath: does not escape projectRoot via ..',
    run: () => {
      const root = path.resolve('D:\\proj-test-adhoc');
      const resolved = resolveAdhocInputPath(root, '..\\..\\doc\\x.json');
      if (resolved.includes('D:\\doc\\')) {
        throw new Error(`escaped root: ${resolved}`);
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

if (require.main === module) {
  const r = runAll();
  for (const x of r) {
    console.log(x.ok ? `PASS ${x.name}` : `FAIL ${x.name}: ${x.error}`);
  }
  process.exit(r.every(x => x.ok) ? 0 : 1);
}
