import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  loadFeatureContracts,
  phaseContractIndex,
  resolvePhaseQuality,
  tierSatisfies,
  validateMinimumDepthByPhase,
} from '../../scripts/utils/skill-contract';

const FRAMEWORK_ROOT = path.resolve(__dirname, '..', '..', '..');

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function touch(root: string, feature: string, relative: string): void {
  const filePath = path.join(root, 'doc', 'features', feature, relative);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, 'fixture\n', 'utf8');
}

function withProject(run: (root: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quality-tiers-'));
  try {
    fs.mkdirSync(path.join(root, 'doc', 'features'), { recursive: true });
    run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

interface TestCase { name: string; run: () => void }

const cases: TestCase[] = [
  {
    name: 'business-ut: acceptance-only selects basic; plan+contracts selects full',
    run: () => withProject((root) => {
      touch(root, 'demo', 'acceptance.yaml');
      const basic = resolvePhaseQuality(FRAMEWORK_ROOT, root, 'demo', 'ut', 'full');
      assert(basic.depth === 'basic', `depth=${basic.depth}`);
      assert(basic.missing_optional_inputs.includes('plan'), 'basic must disclose plan');
      assert(basic.missing_optional_inputs.includes('contracts'), 'basic must disclose contracts');
      touch(root, 'demo', 'plan/plan.md');
      touch(root, 'demo', 'contracts.yaml');
      const full = resolvePhaseQuality(FRAMEWORK_ROOT, root, 'demo', 'ut', 'full');
      assert(full.depth === 'full', `depth=${full.depth}`);
    }),
  },
  {
    name: 'code-review: missing design inputs selects basic and spec+contracts selects full',
    run: () => withProject((root) => {
      const basic = resolvePhaseQuality(FRAMEWORK_ROOT, root, 'demo', 'review', 'full');
      assert(basic.depth === 'basic', `depth=${basic.depth}`);
      touch(root, 'demo', 'spec/spec.md');
      touch(root, 'demo', 'contracts.yaml');
      const full = resolvePhaseQuality(FRAMEWORK_ROOT, root, 'demo', 'review', 'full');
      assert(full.depth === 'full', `depth=${full.depth}`);
    }),
  },
  {
    name: 'legacy spec/plan aliases count as present for review and ut depth',
    run: () => withProject((root) => {
      touch(root, 'demo', 'PRD.md');
      touch(root, 'demo', 'design/design.md');
      touch(root, 'demo', 'contracts.yaml');
      const review = resolvePhaseQuality(FRAMEWORK_ROOT, root, 'demo', 'review', 'full');
      const ut = resolvePhaseQuality(FRAMEWORK_ROOT, root, 'demo', 'ut', 'full');
      assert(review.depth === 'full', `review depth=${review.depth}`);
      assert(ut.depth === 'full', `ut depth=${ut.depth}`);
      assert(!review.missing_optional_inputs.includes('spec'), 'legacy spec reported missing');
      assert(!ut.missing_optional_inputs.includes('plan'), 'legacy plan reported missing');
    }),
  },
  {
    name: 'minimum depth preflight rejects unknown phase and contract-local tier',
    run: () => {
      let phaseError = '';
      try {
        validateMinimumDepthByPhase(
          FRAMEWORK_ROOT, { 'device-testing': 'full' }, new Set(['testing']),
        );
      } catch (error) { phaseError = (error as Error).message; }
      assert(phaseError.includes('不在 active workflow'), phaseError);
      let tierError = '';
      try {
        validateMinimumDepthByPhase(FRAMEWORK_ROOT, { coding: 'full' }, new Set(['coding']));
      } catch (error) { tierError = (error as Error).message; }
      assert(tierError.includes('tier 非法') && tierError.includes('standard'), tierError);
    },
  },  {
    name: 'device-testing: acceptance and adhoc alternatives select distinct contract-local depths',
    run: () => withProject((root) => {
      touch(root, 'demo', 'acceptance.yaml');
      const phase = resolvePhaseQuality(FRAMEWORK_ROOT, root, 'demo', 'testing', 'full');
      assert(phase.depth === 'full', `phase depth=${phase.depth}`);
      const adhoc = resolvePhaseQuality(
        FRAMEWORK_ROOT,
        root,
        '_adhoc',
        'testing',
        'full',
        new Map([['cases', 'adhoc']]),
      );
      assert(adhoc.depth === 'adhoc', `adhoc depth=${adhoc.depth}`);
    }),
  },
  {
    name: 'minimum depth uses contract-local satisfies sets, never lexical ordering',
    run: () => {
      const index = phaseContractIndex(loadFeatureContracts(FRAMEWORK_ROOT));
      const ut = index.get('ut')!.phase;
      const testing = index.get('testing')!.phase;
      assert(tierSatisfies(ut, 'full', 'basic'), 'ut full should satisfy basic');
      assert(!tierSatisfies(ut, 'basic', 'full'), 'ut basic must not satisfy full');
      assert(tierSatisfies(testing, 'adhoc', 'adhoc'), 'testing adhoc should satisfy itself');
      assert(!tierSatisfies(testing, 'adhoc', 'full'), 'testing adhoc must not satisfy full');
    },
  },
];

export function runAll(): Array<{ name: string; ok: boolean; error?: string }> {
  return cases.map((testCase) => {
    try {
      testCase.run();
      return { name: testCase.name, ok: true };
    } catch (error) {
      return { name: testCase.name, ok: false, error: (error as Error).message };
    }
  });
}
