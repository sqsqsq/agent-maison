import * as path from 'path';
import {
  checkAcceptanceCoverage,
  checkItNameHasAcOrBranchTag,
  checkUtCoverageEvidenceMappingsComplete,
  checkUtCoverageEvidenceResolves,
  type CoverageEvidenceObservation,
  type DagLoadObservation,
} from '../../scripts/check-ut';
import type { CheckContext } from '../../scripts/utils/types';
import type { UnitCaseResult } from './ut-artifact-validate.unit.test';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function makeCtx(): CheckContext {
  const projectRoot = path.resolve(__dirname, '../../..');
  return {
    projectRoot,
    frameworkRoot: projectRoot,
    feature: 'demo',
    phaseRule: {
      structure_checks: {
        it_name_has_ac_or_branch_tag: { description: 'traceability name tag' },
      },
      traceability_checks: {
        acceptance_coverage: { description: 'DAG acceptance coverage' },
        ut_coverage_evidence_mappings_complete: { description: 'mapping complete' },
        ut_coverage_evidence_resolves: { description: 'evidence resolves' },
      },
    } as unknown as CheckContext['phaseRule'],
    featureSpec: {
      acceptance: {
        criteria: [{
          id: 'AC-01',
          priority: 'P0',
          ut_layer: 'unit',
          description: 'demo criterion',
        }],
        boundaries: [],
      },
    } as unknown as CheckContext['featureSpec'],
    resolvedProfile: {
      name: 'hmos-app',
      profileDir: path.join(projectRoot, 'profiles', 'hmos-app'),
      personalPrerequisites: {},
    },
  } as CheckContext;
}

function testBoundaryTagIsValidNamePrefix(): void {
  const ctx = makeCtx();
  const directBoundary = checkItNameHasAcOrBranchTag(ctx, [{
    path: 'module/src/ohosTest/ets/test/Boundary.test.ets',
    content: "it('[BD-01] empty result', 0, () => { expect(true); });",
  }])[0];
  assert(directBoundary.status === 'PASS', directBoundary.details);

  const untagged = checkItNameHasAcOrBranchTag(ctx, [{
    path: 'module/src/ohosTest/ets/test/Untagged.test.ets',
    content: "it('empty result', 0, () => { expect(true); });",
  }])[0];
  assert(untagged.status === 'FAIL', untagged.details);
  assert(untagged.suggestion?.includes('[BD-xxx]') === true, untagged.suggestion ?? '');
}

const missingEvidence: CoverageEvidenceObservation = {
  status: 'missing',
  relPath: 'doc/features/demo/ut/reports/coverage-evidence.json',
  absPath: 'C:/consumer/doc/features/demo/ut/reports/coverage-evidence.json',
};

function testAcceptanceCoverageIsDagOnlyWhileTagGatePasses(): void {
  const ctx = makeCtx();
  const dags = [{ path: 'module/test/dag/demo.dag.yaml', dag: { nodes: [] } }];
  const observation: DagLoadObservation = {
    files: [{ ...dags[0], raw: 'nodes: []', source: 'archived' }],
    candidatePaths: [dags[0].path],
    probedDirs: ['module/test/dag'],
    issues: [],
  };
  const acceptance = checkAcceptanceCoverage(ctx, dags, observation)[0];
  assert(acceptance.status === 'FAIL', acceptance.status);
  assert(acceptance.details.includes('不读取 it() 名'), acceptance.details);
  assert(acceptance.details.includes(dags[0].path), acceptance.details);
  assert(acceptance.suggestion?.includes('git add 不会改变本 gate') === true, acceptance.suggestion ?? '');

  const tagged = [{
    path: 'module/src/ohosTest/ets/test/Demo.test.ets',
    content: "it('[AC-01] tagged', 0, () => { expect(true); });",
  }];
  const resolves = checkUtCoverageEvidenceResolves(ctx, tagged, missingEvidence, observation.files)[0];
  assert(resolves.status === 'PASS', resolves.details);
  assert(resolves.details.includes(tagged[0].path), resolves.details);
}

function testDagCanResolveWithoutUtFiles(): void {
  const ctx = makeCtx();
  const dags = [{
    path: 'module/test/dag/demo.dag.yaml',
    raw: 'linked_acceptance: [AC-01]',
    source: 'archived' as const,
    dag: { linked_acceptance: ['AC-01'] },
  }];
  const result = checkUtCoverageEvidenceResolves(ctx, [], missingEvidence, dags)[0];
  assert(result.status === 'PASS', result.details);
  assert(result.details.includes('scoped_ut_files=(无)'), result.details);
  assert(result.details.includes('dag/demo.dag.yaml'), result.details);
}

function testMappingFailureNamesDeclaredSourceAndInputs(): void {
  const ctx = makeCtx();
  const observed: CoverageEvidenceObservation = {
    status: 'loaded',
    relPath: 'doc/features/demo/ut/reports/coverage-evidence.json',
    absPath: 'C:/consumer/doc/features/demo/ut/reports/coverage-evidence.json',
    warnings: [],
    evidence: {
      schema_version: '1.0',
      feature: 'demo',
      mappings: [{
        scope_id: 'AC-01',
        scope_kind: 'acceptance_criterion',
        evidence_source: 'ut_tags',
        evidence_ref: 'Demo.test.ets',
      }],
    },
  };
  const result = checkUtCoverageEvidenceMappingsComplete(ctx, [], observed, [], null)[0];
  assert(result.status === 'FAIL', result.details);
  assert(result.details.includes('declared evidence_source=ut_tags'), result.details);
  assert(result.details.includes('mapping=ut_tags:unresolved ref=Demo.test.ets'), result.details);
  assert(result.details.includes('coverage_evidence=loaded:'), result.details);
}

function testAcTagDoesNotResolveSameNumberedBoundary(): void {
  const ctx = makeCtx();
  ctx.featureSpec.acceptance!.boundaries = [{
    id: 'BD-01',
    priority: 'P0',
    ut_layer: 'unit',
    description: 'same suffix boundary',
  }] as never;
  const tagged = [{
    path: 'module/src/ohosTest/ets/test/Demo.test.ets',
    content: "it('[AC-01] criterion only', 0, () => { expect(true); });",
  }];
  const result = checkUtCoverageEvidenceResolves(ctx, tagged, missingEvidence, [])[0];
  assert(result.status === 'FAIL', result.details);
  assert(result.details.includes('BD-01'), result.details);
  assert(result.details.includes('BD-01: ut_tag_or_branch=false'), result.details);
}

function testEphemeralMappingDoesNotUseArchivedDag(): void {
  const ctx = makeCtx();
  const observed: CoverageEvidenceObservation = {
    status: 'loaded',
    relPath: 'doc/features/demo/ut/reports/coverage-evidence.json',
    absPath: 'C:/consumer/doc/features/demo/ut/reports/coverage-evidence.json',
    warnings: [],
    evidence: {
      schema_version: '1.0',
      feature: 'demo',
      mappings: [{
        scope_id: 'AC-01',
        scope_kind: 'acceptance_criterion',
        evidence_source: 'dag_ephemeral',
      }],
    },
  };
  const archived = [{
    path: 'module/test/dag/demo.dag.yaml',
    raw: 'linked_acceptance: [AC-01]',
    source: 'archived' as const,
    dag: { linked_acceptance: ['AC-01'] },
  }];
  const result = checkUtCoverageEvidenceMappingsComplete(ctx, [], observed, archived, null)[0];
  assert(result.status === 'FAIL', result.details);
  assert(result.details.includes('declared evidence_source=dag_ephemeral'), result.details);
  assert(result.details.includes('mapping=dag_ephemeral:unresolved'), result.details);
}

export function runAll(): UnitCaseResult[] {
  const cases = [
    { name: 'acceptance coverage is DAG-only while tag-aware gate passes', fn: testAcceptanceCoverageIsDagOnlyWhileTagGatePasses },
    { name: 'DAG evidence resolves without UT files', fn: testDagCanResolveWithoutUtFiles },
    { name: 'mapping failure names declared source and inspected inputs', fn: testMappingFailureNamesDeclaredSourceAndInputs },
    { name: 'AC tag does not resolve same-numbered boundary', fn: testAcTagDoesNotResolveSameNumberedBoundary },
    { name: 'ephemeral mapping does not use archived DAG', fn: testEphemeralMappingDoesNotUseArchivedDag },
    { name: 'direct boundary tag is a valid test-name prefix', fn: testBoundaryTagIsValidNamePrefix },
  ];
  return cases.map(({ name, fn }) => {
    try {
      fn();
      return { name, ok: true };
    } catch (e) {
      return { name, ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
}
