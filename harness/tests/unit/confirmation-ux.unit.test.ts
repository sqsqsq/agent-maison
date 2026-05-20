// confirmation-ux.unit.test.ts — check-skills-confirmation-ux 单元测试

import * as path from 'path';
import { lintConfirmationUx } from '../../scripts/check-skills-confirmation-ux';
import type { UnitCaseResult } from '../run-unit';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'lintConfirmationUx: SSOT + registry exist → no BLOCKER',
    run: () => {
      const out = lintConfirmationUx({ projectRoot: REPO_ROOT });
      const blockers = out.filter(r => r.status === 'FAIL');
      assert(blockers.length === 0, `unexpected blockers: ${blockers.map(b => b.details).join('; ')}`);
    },
  },
  {
    name: 'lintConfirmationUx: registry has ≥20 entries',
    run: () => {
      const out = lintConfirmationUx({ projectRoot: REPO_ROOT });
      const sizeWarn = out.find(r => r.id === 'registry_size');
      assert(!sizeWarn, 'registry too small');
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
