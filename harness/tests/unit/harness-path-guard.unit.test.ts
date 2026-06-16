// ============================================================================
// harness-path-guard.unit.test.ts
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { CheckContext } from '../../scripts/utils/types';
import {
  collectContractPackagePathPollution,
  formatPollutionDisplayPath,
  isUnderHarnessRoot,
  mergePollutionViolations,
} from '../../scripts/utils/harness-path-guard';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function makeCtx(partial: Pick<CheckContext, 'projectRoot' | 'harnessRoot'> & {
  packagePath?: string;
}): CheckContext {
  const modules = partial.packagePath
    ? [{ name: 'Demo', package_path: partial.packagePath, layer: '02-Feature' }]
    : [];
  return {
    phase: 'ut',
    feature: 'demo',
    projectRoot: partial.projectRoot,
    harnessRoot: partial.harnessRoot,
    phaseRule: { structure_checks: {} },
    featureSpec: {
      feature: 'demo',
      contracts: { modules },
    },
    resolvedProfile: { name: 'hmos-app', profileDir: '', personalPrerequisites: {} },
    frameworkRoot: path.join(partial.projectRoot, 'framework'),
    frameworkRel: 'framework',
  } as CheckContext;
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'isUnderHarnessRoot: true for path inside harness',
    run: () => {
      const harness = path.join(os.tmpdir(), 'hg-harness');
      const inner = path.join(harness, '02-Feature', 'Demo');
      if (!isUnderHarnessRoot(harness, inner)) {
        throw new Error('expected inside harness');
      }
    },
  },
  {
    name: 'formatPollutionDisplayPath: consumer layout uses repo-relative path',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hg-consumer-'));
      const harnessRoot = path.join(root, 'framework', 'harness');
      const misplaced = path.join(harnessRoot, '02-Feature', 'Demo');
      fs.mkdirSync(misplaced, { recursive: true });
      const ctx = makeCtx({ projectRoot: root, harnessRoot, packagePath: '02-Feature/Demo' });
      const display = formatPollutionDisplayPath(ctx, misplaced);
      if (display !== 'framework/harness/02-Feature/Demo') {
        throw new Error(`unexpected display: ${display}`);
      }
    },
  },
  {
    name: 'formatPollutionDisplayPath: external harnessRoot uses [harness] prefix',
    run: () => {
      const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hg-proj-'));
      const harnessRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hg-ext-harness-'));
      const misplaced = path.join(harnessRoot, '02-Feature', 'Demo');
      fs.mkdirSync(misplaced, { recursive: true });
      const ctx = makeCtx({ projectRoot, harnessRoot, packagePath: '02-Feature/Demo' });
      const display = formatPollutionDisplayPath(ctx, misplaced);
      if (display !== '[harness]/02-Feature/Demo') {
        throw new Error(`unexpected display: ${display}`);
      }
    },
  },
  {
    name: 'collectContractPackagePathPollution: detects package_path under harnessRoot',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hg-pollute-'));
      const harnessRoot = path.join(root, 'framework', 'harness');
      fs.mkdirSync(path.join(harnessRoot, '02-Feature', 'Demo'), { recursive: true });
      const ctx = makeCtx({ projectRoot: root, harnessRoot, packagePath: '02-Feature/Demo' });
      const violations = collectContractPackagePathPollution(ctx);
      if (violations.length !== 1 || !violations[0].includes('framework/harness/02-Feature/Demo')) {
        throw new Error(`unexpected violations: ${JSON.stringify(violations)}`);
      }
    },
  },
  {
    name: 'collectContractPackagePathPollution: PASS when harness clean',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hg-clean-'));
      const harnessRoot = path.join(root, 'framework', 'harness');
      fs.mkdirSync(harnessRoot, { recursive: true });
      const ctx = makeCtx({ projectRoot: root, harnessRoot, packagePath: '02-Feature/Demo' });
      const violations = collectContractPackagePathPollution(ctx);
      if (violations.length !== 0) {
        throw new Error(`expected no violations: ${JSON.stringify(violations)}`);
      }
    },
  },
  {
    name: 'mergePollutionViolations: dedupes display paths',
    run: () => {
      const merged = mergePollutionViolations(
        ['framework/harness/02-Feature/Demo', 'a'],
        ['framework/harness/02-Feature/Demo', 'b'],
      );
      if (merged.length !== 3 || merged[0] !== 'framework/harness/02-Feature/Demo') {
        throw new Error(`unexpected merge: ${JSON.stringify(merged)}`);
      }
    },
  },
];

export async function runAll(): Promise<UnitCaseResult[]> {
  const out: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      c.run();
      out.push({ name: c.name, ok: true });
    } catch (err) {
      out.push({ name: c.name, ok: false, error: (err as Error).message });
    }
  }
  return out;
}

if (require.main === module) {
  runAll().then(r => {
    for (const x of r) {
      console.log(x.ok ? `PASS ${x.name}` : `FAIL ${x.name}: ${x.error}`);
    }
    process.exit(r.every(x => x.ok) ? 0 : 1);
  });
}
