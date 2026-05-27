// ============================================================================
// adhoc-canonical-paths.unit.test.ts
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  adhocHylyreRunDir,
  adhocHylyreRunDirRel,
  adhocStepsStagingPath,
  adhocStepsStagingRel,
  isForbiddenAdhocWritePath,
  isUnderAdhocFeatureDir,
} from '../../scripts/utils/adhoc-canonical-paths';
import { DEFAULT_LAYOUT } from '../utils/layout-test-helper';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

const FIXED_TS = '20260521-120000';

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'adhocHylyreRunDirRel: under doc/features/_adhoc/testing/reports/<ts>/hylyre',
    run: () => {
      const rel = adhocHylyreRunDirRel(FIXED_TS).replace(/\\/g, '/');
      if (rel !== `doc/features/_adhoc/testing/reports/${FIXED_TS}/hylyre`) {
        throw new Error(`unexpected rel: ${rel}`);
      }
    },
  },
  {
    name: 'execute output dir independent of steps-file in framework/harness',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'adhoc-out-'));
      const harnessSteps = path.join(root, 'framework', 'harness', 'steps.json');
      fs.mkdirSync(path.dirname(harnessSteps), { recursive: true });
      fs.writeFileSync(harnessSteps, '[]\n', 'utf-8');

      const hylyreDir = adhocHylyreRunDir(root, FIXED_TS);
      const traceOut = path.join(hylyreDir, 'trace.json');
      const stepsDir = path.dirname(harnessSteps);

      if (path.dirname(traceOut) === stepsDir) {
        throw new Error('trace must not land in framework/harness');
      }
      if (!traceOut.replace(/\\/g, '/').includes('doc/features/_adhoc/testing/reports')) {
        throw new Error(`trace not under canonical tree: ${traceOut}`);
      }
    },
  },
  {
    name: 'isUnderAdhocFeatureDir: false for framework/harness steps',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'adhoc-can-'));
      const harnessSteps = path.join(root, 'framework', 'harness', 'steps.json');
      if (isUnderAdhocFeatureDir(root, harnessSteps)) {
        throw new Error('harness steps should be outside _adhoc feature dir');
      }
      const staging = adhocStepsStagingPath(root);
      if (!isUnderAdhocFeatureDir(root, staging)) {
        throw new Error('staging steps should be under _adhoc feature dir');
      }
    },
  },
  {
    name: 'isForbiddenAdhocWritePath: true for harness tree (consumer layout)',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'adhoc-forbid-'));
      fs.mkdirSync(path.join(root, 'framework', 'workflows'), { recursive: true });
      const harnessReport = path.join(root, 'framework', 'harness', 'trace.json');
      if (!isForbiddenAdhocWritePath(root, harnessReport)) {
        throw new Error('framework/harness should be forbidden');
      }
      const canonical = adhocHylyreRunDir(root, FIXED_TS);
      if (isForbiddenAdhocWritePath(root, canonical)) {
        throw new Error('doc/features/_adhoc hylyre dir should be allowed');
      }
    },
  },
  {
    name: 'isForbiddenAdhocWritePath: external frameworkRoot 不 infer projectRoot',
    run: () => {
      const host = fs.mkdtempSync(path.join(os.tmpdir(), 'adhoc-forbid-ext-'));
      const harnessReport = path.join(DEFAULT_LAYOUT.frameworkRoot, 'harness', 'trace.json');
      if (!isForbiddenAdhocWritePath(host, harnessReport, DEFAULT_LAYOUT.frameworkRoot)) {
        throw new Error('external framework harness path should be forbidden');
      }
      const canonical = adhocHylyreRunDir(host, FIXED_TS);
      if (isForbiddenAdhocWritePath(host, canonical, DEFAULT_LAYOUT.frameworkRoot)) {
        throw new Error('doc/features/_adhoc hylyre dir should be allowed');
      }
    },
  },
  {
    name: 'adhocStepsStagingRel: canonical staging path',
    run: () => {
      const rel = adhocStepsStagingRel().replace(/\\/g, '/');
      if (rel !== 'doc/features/_adhoc/testing/staging/test-steps.json') {
        throw new Error(`unexpected staging rel: ${rel}`);
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
