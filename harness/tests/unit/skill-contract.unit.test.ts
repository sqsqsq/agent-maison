// ============================================================================
// skill-contract.unit.test.ts — capability contract parsing and static graph gate
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadWorkflowSpec } from '../../workflow-loader';
import { checkContractConsistency, validateContractConsistency } from '../../scripts/check-contract-consistency';
import {
  assuranceSatisfies,
  loadArtifactInventory,
  loadFeatureContracts,
  loadSkillContract,
} from '../../scripts/utils/skill-contract';

export interface UnitCaseResult { name: string; ok: boolean; error?: string; }
interface Case { name: string; run: () => void; }
const FRAMEWORK_ROOT = path.resolve(__dirname, '..', '..', '..');

function assert(condition: boolean, message: string): void { if (!condition) throw new Error(message); }
function expectThrow(fn: () => void, includes: string): void {
  let message = '';
  try { fn(); } catch (error) { message = (error as Error).message; }
  assert(message.includes(includes), `expected ${includes}, got ${message}`);
}
function writeContract(source: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-contract-'));
  const file = path.join(dir, 'contract.yaml');
  fs.writeFileSync(file, source, 'utf8');
  return file;
}

const prefix = [
  'schema_version: "1.0"',
  'skill: fixture',
  'skill_doc: SKILL.md',
  'phases:',
  '  fixture:',
  '    tracks: [full]',
  '    inputs:',
  '      - id: plan',
  '        sources: [{ kind: artifact, artifact: plan@1 }]',
  '    capabilities:',
  '      - id: capability_fixture',
  '        axis: functional',
  '        inputs: [plan]',
  '        tracks: [full]',
  '        on_missing: fail',
  '    produces: []',
  '    verifies: { check: check-fixture.ts }',
];

const cases: Case[] = [
  {
    name: 'artifact inventory registers narrative artifacts and schemas',
    run: () => {
      const ids = new Set(loadArtifactInventory(FRAMEWORK_ROOT).artifacts.map((artifact) => artifact.id));
      for (const required of ['change@1', 'use-cases@1', 'ui-spec@1', 'visual-parity@1', 'asset-manifest@1']) {
        assert(ids.has(required), `missing ${required}`);
      }
    },
  },
  {
    name: 'workflow feature phases rather than a fixed skill count define coverage',
    run: () => {
      const contracts = loadFeatureContracts(FRAMEWORK_ROOT);
      const phases = contracts.flatMap((contract) => Object.keys(contract.phases));
      assert(phases.includes('change') && phases.includes('exit'), 'change-lite phase sections missing');
      const source = fs.readFileSync(path.resolve(FRAMEWORK_ROOT, 'harness/scripts/utils/skill-contract.ts'), 'utf8');
      assert(source.includes('listWorkflowPhases'), 'coverage must derive workflow phases');
      assert(!source.includes('enumerateTierCombinations'), 'tier enumeration must be removed');
    },
  },
  {
    name: 'legacy tiers/when/depth_field are rejected by the loader',
    run: () => {
      const file = writeContract([...prefix, '    tiers: {}'].join('\n'));
      expectThrow(() => loadSkillContract(file), '含未知字段 tiers');
    },
  },
  {
    name: 'capability input references and provider ids fail closed',
    run: () => {
      const unknownInput = writeContract(prefix.join('\n').replace('inputs: [plan]', 'inputs: [unknown]'));
      expectThrow(() => loadSkillContract(unknownInput), '引用未知 input');
      const unknownProvider = writeContract(prefix.join('\n').replace('artifact: plan@1', 'provider_id: derive.not-registered').replace('{ kind: artifact, provider_id:', '{ kind: derive, provider_id:'));
      expectThrow(() => loadSkillContract(unknownProvider), 'provider_id 未注册');
    },
  },
  {
    name: 'assurance order is global and blocked never satisfies a floor',
    run: () => {
      assert(assuranceSatisfies('full', 'full'), 'full >= full');
      assert(assuranceSatisfies('full', 'degraded'), 'full >= degraded');
      assert(assuranceSatisfies('degraded', 'degraded'), 'degraded >= degraded');
      assert(!assuranceSatisfies('degraded', 'full'), 'degraded < full');
      assert(!assuranceSatisfies('blocked', 'degraded'), 'blocked cannot satisfy degraded');
    },
  },
  {
    name: 'missing producer from an artifact source is rejected by static graph gate',
    run: () => {
      const workflow = loadWorkflowSpec(FRAMEWORK_ROOT, 'spec-driven');
      const contracts = loadFeatureContracts(FRAMEWORK_ROOT);
      const plan = contracts.find((contract) => contract.skill === 'plan')!;
      const source = plan.phases.plan.inputs.find((input) => input.id === 'spec')!.sources[0];
      if (source.kind !== 'artifact') throw new Error('fixture assumption');
      source.artifact = 'orphan@1';
      const registered = new Set([...loadArtifactInventory(FRAMEWORK_ROOT).artifacts.map((artifact) => artifact.id), 'orphan@1']);
      const issues = validateContractConsistency(FRAMEWORK_ROOT, workflow, contracts, registered);
      assert(issues.some((issue) => issue.code === 'missing_producer' && issue.message.includes('orphan@1')), JSON.stringify(issues));
    },
  },
  {
    name: 'production capability contracts pass the static declaration gate',
    run: () => {
      const issues = checkContractConsistency(FRAMEWORK_ROOT);
      assert(issues.length === 0, issues.map((issue) => `${issue.code}: ${issue.message}`).join('\n'));
    },
  },
];

export function runAll(): UnitCaseResult[] {
  return cases.map((testCase) => {
    try { testCase.run(); return { name: testCase.name, ok: true }; }
    catch (error) { return { name: testCase.name, ok: false, error: (error as Error).message }; }
  });
}