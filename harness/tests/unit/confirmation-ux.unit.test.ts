// confirmation-ux.unit.test.ts — check-skills-confirmation-ux 单元测试

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { lintConfirmationUx } from '../../scripts/check-skills-confirmation-ux';
import { detectRepoLayout } from '../../repo-layout';
import { externalStandaloneLayout } from '../utils/layout-test-helper';
import type { UnitCaseResult } from '../run-unit';

const { projectRoot: REPO_ROOT } = detectRepoLayout(__dirname);

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
  {
    name: 'lintConfirmationUx: Claude templates widget BLOCKER',
    run: () => {
      const out = lintConfirmationUx({ projectRoot: REPO_ROOT });
      const fails = out.filter(r => r.status === 'FAIL' && r.id.startsWith('claude_'));
      assert(fails.length === 0, `claude template blockers: ${fails.map(f => f.details).join('; ')}`);
    },
  },
  {
    name: 'lintConfirmationUx: external frameworkRoot 不 infer projectRoot',
    run: () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cux-ext-'));
      const layout = externalStandaloneLayout(tmp);
      const out = lintConfirmationUx({ projectRoot: tmp, layout });
      const ssotFail = out.find(r => r.status === 'FAIL' && r.id === 'ssot_exists');
      assert(!ssotFail, `should resolve SSOT via layout: ${ssotFail?.details ?? ''}`);
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
