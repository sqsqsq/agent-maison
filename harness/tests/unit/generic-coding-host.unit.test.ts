// ============================================================================
// generic profile：无 coding-host 时 check-coding 必须返回 coding_host_missing
// ============================================================================

import * as path from 'path';
import assert from 'assert';
import type { CheckContext } from '../../scripts/utils/types';
import codingChecker from '../../scripts/check-coding';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

const PROFILES_ROOT = path.resolve(__dirname, '..', '..', '..', '..', 'framework', 'profiles');
const genericProfileDir = path.join(PROFILES_ROOT, 'generic');

export async function runAll(): Promise<UnitCaseResult[]> {
  const cases: Array<{ name: string; run: () => Promise<void> }> = [
    {
      name: 'check-coding: generic 无 profileCodingHost → coding_host_missing BLOCKER',
      run: async () => {
        const ctx: CheckContext = {
          phase: 'coding',
          feature: 'probe',
          projectRoot: process.cwd(),
          phaseRule: {
            phase: 'coding',
            structure_checks: {},
            semantic_checks: {},
            traceability_checks: {},
          } as any,
          featureSpec: {
            feature: 'probe',
            contracts: {
              feature: 'probe',
              source: 'design.md',
              version: '1',
              module_dependencies: [],
              files: [],
              modules: [],
            } as any,
          },
          resolvedProfile: {
            name: 'generic',
            profileDir: genericProfileDir,
            yaml: {} as any,
            phasesDisabled: new Set(),
            capabilities: {},
          },
        };
        const results = await codingChecker.check(ctx);
        const hit = results.find(r => r.id === 'coding_host_missing');
        assert.ok(hit, '必须产出 coding_host_missing');
        assert.strictEqual(hit!.status, 'FAIL');
        assert.strictEqual(hit!.severity, 'BLOCKER');
      },
    },
  ];

  const out: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      await c.run();
      out.push({ name: c.name, ok: true });
    } catch (err) {
      out.push({ name: c.name, ok: false, error: (err as Error).stack ?? (err as Error).message });
    }
  }
  return out;
}
