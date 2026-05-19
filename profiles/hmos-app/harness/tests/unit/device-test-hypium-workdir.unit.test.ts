import * as path from 'path';
import {
  HYPIUM_TMP_DIR_NAME,
  HYPIUM_WORKDIR_BASENAME,
  legacyHypiumTmpAtProjectRoot,
  resolveHypiumWorkDir,
} from '../../device-test-hypium-workdir';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'resolveHypiumWorkDir 落在 reports/.hypium-workdir',
    run: () => {
      const reports = '/repo/doc/features/x/testing/reports';
      const got = resolveHypiumWorkDir(reports);
      const want = path.join(reports, HYPIUM_WORKDIR_BASENAME);
      if (got !== want) throw new Error(`want ${want}, got ${got}`);
    },
  },
  {
    name: 'legacyHypiumTmpAtProjectRoot 指向工程根 tmp_hypium',
    run: () => {
      const got = legacyHypiumTmpAtProjectRoot('/repo');
      if (got !== path.join('/repo', HYPIUM_TMP_DIR_NAME)) {
        throw new Error(`unexpected legacy path: ${got}`);
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
