// ============================================================================
// skill-contract.unit.test.ts — contract parsing, tier proof, graph consistency
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadWorkflowSpec } from '../../workflow-loader';
import {
  checkContractConsistency,
  validateContractConsistency,
} from '../../scripts/check-contract-consistency';
import {
  enumerateTierCombinations,
  loadArtifactInventory,
  loadFeatureContracts,
  loadSkillContract,
  parseTierPredicate,
  evaluateTierPredicate,
  tierSatisfies,
} from '../../scripts/utils/skill-contract';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

interface Case {
  name: string;
  run: () => void;
}

const FRAMEWORK_ROOT = path.resolve(__dirname, '..', '..', '..');

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function expectThrow(fn: () => void, includes: string): void {
  let message = '';
  try {
    fn();
  } catch (error) {
    message = (error as Error).message;
  }
  assert(message.includes(includes), `expected error containing "${includes}", got "${message}"`);
}

function writeContract(source: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-contract-'));
  const filePath = path.join(dir, 'contract.yaml');
  fs.writeFileSync(filePath, source, 'utf8');
  return filePath;
}

const contractPrefix = [
  'schema_version: "1.0"',
  'skill: fixture',
  'skill_doc: SKILL.md',
  'phases:',
  '  fixture:',
  '    tracks: [full]',
  '    inputs:',
  '      required: []',
  '      optional:',
  '        - id: plan',
  '          artifact: plan@1',
  '          absent_effect: fixture',
  '    produces: []',
  '    verifies:',
  '      check: check-fixture.ts',
  '      depth_field: summary.depth',
  '    tiers:',
];

const cases: Case[] = [
  {
    name: 'artifact inventory 注册完整的 16 个叙述产物与 schema',
    run: () => {
      const inventory = loadArtifactInventory(FRAMEWORK_ROOT);
      const ids = new Set(inventory.artifacts.map((artifact) => artifact.id));
      assert(ids.size === 16, `inventory size=${ids.size}`);
      for (const required of [
        'change@1',
        'use-cases@1',
        'ui-spec@1',
        'visual-parity@1',
        'ref-elements@1',
        'asset-manifest@1',
      ]) {
        assert(ids.has(required), `missing ${required}`);
      }
    },
  },
  {
    name: 'workflow feature phases, not a hardcoded skill count, define contract coverage',
    run: () => {
      const contracts = loadFeatureContracts(FRAMEWORK_ROOT);
      const phases = contracts.flatMap((contract) => Object.keys(contract.phases));
      assert(contracts.length === 7, `contracts=${contracts.length}`);
      assert(phases.length === 8, `phases=${phases.join(',')}`);
      assert(phases.includes('change') && phases.includes('exit'), 'change-lite phase sections missing');
      const source = fs.readFileSync(path.resolve(FRAMEWORK_ROOT, 'harness/scripts/utils/skill-contract.ts'), 'utf8');
      assert(source.includes('listWorkflowPhases'), 'coverage must derive expected phases from workflow');
      assert(!source.includes('contracts.length !== 7'), 'coverage must not hardcode seven contracts');
    },
  },
  {
    name: 'bounded tier DSL evaluates nested all/any/not predicates',
    run: () => {
      const predicate = parseTierPredicate('all(present(plan), not(alternative(cases, adhoc)))');
      const observed = {
        present: new Set(['plan', 'cases']),
        alternatives: new Map([['cases', 'acceptance']]),
      };
      assert(evaluateTierPredicate(predicate, observed), 'predicate should match');
    },
  },
  {
    name: 'tier enumeration selects exactly one tier for all production contracts',
    run: () => {
      for (const contract of loadFeatureContracts(FRAMEWORK_ROOT)) {
        for (const phase of Object.values(contract.phases)) {
          for (const track of phase.tracks) {
            const combinations = enumerateTierCombinations(phase, track);
            assert(combinations.length > 0, `${contract.skill}/${track} has no combinations`);
          }
        }
      }
    },
  },
  {
    name: 'zero-match fixture without otherwise is rejected',
    run: () => {
      const filePath = writeContract([
        ...contractPrefix,
        '      full:',
        '        when: "present(plan)"',
        '        satisfies: [full]',
      ].join('\n'));
      expectThrow(() => loadSkillContract(filePath), '必须且只能有一个 otherwise');
    },
  },
  {
    name: 'multiple-match fixture is rejected by finite enumeration',
    run: () => {
      const filePath = writeContract([
        ...contractPrefix,
        '      full:',
        '        when: "present(plan)"',
        '        satisfies: [full]',
        '      broad:',
        '        when: "any(present(plan), not(present(plan)))"',
        '        satisfies: [broad]',
        '      fallback:',
        '        when: otherwise',
        '        satisfies: [fallback]',
      ].join('\n'));
      expectThrow(() => loadSkillContract(filePath), 'tier 非确定');
    },
  },
  {
    name: 'missing-producer fixture is rejected by producer/consumer graph',
    run: () => {
      const workflow = loadWorkflowSpec(FRAMEWORK_ROOT, 'spec-driven');
      const contracts = loadFeatureContracts(FRAMEWORK_ROOT);
      const plan = contracts.find((contract) => contract.skill === 'plan');
      assert(Boolean(plan), 'plan contract missing');
      plan!.phases.plan.inputs.required[0].artifact = 'orphan@1';
      const registered = new Set([
        ...loadArtifactInventory(FRAMEWORK_ROOT).artifacts.map((artifact) => artifact.id),
        'orphan@1',
      ]);
      const issues = validateContractConsistency(FRAMEWORK_ROOT, workflow, contracts, registered);
      assert(
        issues.some((issue) => issue.code === 'missing_producer' && issue.message.includes('orphan@1')),
        JSON.stringify(issues),
      );
    },
  },
  {
    name: 'production contracts pass workflow consistency',
    run: () => {
      const issues = checkContractConsistency(FRAMEWORK_ROOT);
      assert(issues.length === 0, issues.map((issue) => `${issue.code}: ${issue.message}`).join('\n'));
    },
  },
  {
    name: 'tier satisfaction is contract-local and explicit',
    run: () => {
      const ut = loadFeatureContracts(FRAMEWORK_ROOT)
        .find((contract) => contract.skill === 'business-ut')!.phases.ut;
      assert(tierSatisfies(ut, 'full', 'basic'), 'full should satisfy basic');
      assert(!tierSatisfies(ut, 'basic', 'full'), 'basic must not satisfy full');
      assert(!tierSatisfies(ut, 'adhoc', 'basic'), 'unknown cross-contract tier must not compare');
    },
  },
];

export function runAll(): UnitCaseResult[] {
  return cases.map((testCase) => {
    try {
      testCase.run();
      return { name: testCase.name, ok: true };
    } catch (error) {
      return { name: testCase.name, ok: false, error: (error as Error).message };
    }
  });
}
