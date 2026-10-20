import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { withProject } from './rule-convergence.unit.test';
import { createIdentityNeutralDigestReaders, identityNeutralDigest } from '../../scripts/utils/identity-neutral-digest';
import { loadCanonicalChangeUnit } from '../../scripts/utils/change-unit-path';
import { resolveComponentBlueprintRef } from '../../scripts/utils/component-blueprint-path';
import { publishArchitectureRevision } from '../../scripts/utils/init-task-executor';
import { resolvePhaseEvidenceManifest, recomputeManifestAggregate, recomputePhaseEvidenceStaleness } from '../../scripts/utils/phase-evidence-manifest';
import { resolvePhaseWriteBoundary } from '../../scripts/utils/phase-write-boundary';
import { resolveCapabilityResolutionEntryInput } from '../../scripts/utils/capability-resolution-entry-input';
import { buildPhasePrompt } from '../../scripts/goal-phase-runtime';
import { assessFeature } from '../../scripts/utils/assess';
import type { UnitCaseResult } from '../run-unit';
import { matchesUnitCase, selectedUnitCases } from '../utils/unit-case-selection';

const feature = 'cu-YmMtb3BlbkNhcmQtMgBvcGVuLWNhcmQtZmxvdw';
const rel = 'doc/features/bc-openCard-2/open-card-flow';
const runId = '20261019T033030Z-1b91ba';

/** Count real parsing/validation, not reader invocations; restore before another test. */
function counted<T>(action: () => T): { value: T; counts: Record<string, number> } {
  const yaml = require('yaml') as typeof import('yaml');
  const blueprint = require('../../scripts/utils/component-blueprint-validator') as typeof import('../../scripts/utils/component-blueprint-validator');
  const unit = require('../../scripts/utils/change-unit-validator') as typeof import('../../scripts/utils/change-unit-validator');
  const parse = yaml.parse, validateBlueprint = blueprint.validateComponentBlueprint, validateUnit = unit.validateChangeUnit;
  const counts: Record<string, number> = {};
  const add = (key: string): void => { counts[key] = (counts[key] ?? 0) + 1; };
  yaml.parse = ((...args: Parameters<typeof parse>) => {
    const value = parse(...args);
    if (value?.artifact === 'component-blueprint@1') add('blueprint.parse');
    if (value?.artifact === 'change-unit@1') add('cu.parse');
    return value;
  }) as typeof parse;
  blueprint.validateComponentBlueprint = (...args) => { add('blueprint.validate'); return validateBlueprint(...args); };
  unit.validateChangeUnit = (...args) => { add('cu.validate'); return validateUnit(...args); };
  try { return { value: action(), counts }; }
  finally { yaml.parse = parse; blueprint.validateComponentBlueprint = validateBlueprint; unit.validateChangeUnit = validateUnit; }
}

const cases: Array<{ name: string; run(): Promise<void> }> = [
  { name: 'one action shares CU and blueprint across digests and references; reference identities remain strict', run: () => withProject(({ root }) => {
    const captured = counted(() => {
      const readers = createIdentityNeutralDigestReaders();
      const cu = readers.loadChangeUnit!(root, 'bc-openCard-2', 'open-card-flow');
      const first = identityNeutralDigest(root, 'change-unit@1', cu.changeUnit, readers);
      assert(first);
      for (let i = 0; i < 4; i++) {
        assert.equal(identityNeutralDigest(root, 'change-unit@1', cu.changeUnit, readers), first);
        for (const ref of cu.changeUnit.design_refs as unknown[]) readers.blueprint(root, ref);
      }
      const owner = cu.changeUnit.component_blueprint_ref as Record<string, unknown>;
      assert.throws(() => readers.blueprint(root, { ...owner, revision: Number(owner.revision) + 1 }), { code: 'component_blueprint_identity_mismatch' });
      assert.throws(() => readers.blueprint(root, { ...owner, target: { kind: 'decision', id: 'not-present' } }));
    });
    assert.equal(captured.counts['blueprint.validate'], 1);
    assert.equal(captured.counts['blueprint.parse'], 1);
    assert.equal(captured.counts['cu.parse'], 1);
  }) },
  { name: 'blueprint-only digests share validation within an action and revalidate in the next action', run: () => withProject(({ root }) => {
    const cu = loadCanonicalChangeUnit(root, 'bc-openCard-2', 'open-card-flow').changeUnit;
    const artifact = { design_ref: cu.component_blueprint_ref };
    for (let action = 0; action < 2; action++) {
      const captured = counted(() => {
        const readers = createIdentityNeutralDigestReaders();
        const first = identityNeutralDigest(root, 'acceptance@1', artifact, readers);
        assert(first);
        for (let i = 0; i < 5; i++) assert.equal(identityNeutralDigest(root, 'acceptance@1', artifact, readers), first);
      });
      assert.equal(captured.counts['blueprint.validate'], 1);
      assert.equal(captured.counts['blueprint.parse'], 1);
    }
  }) },
  { name: 'DSL-only publication invalidates the next action without a manual reader-cache reset', run: () => withProject(({ root }) => {
    const cu = loadCanonicalChangeUnit(root, 'bc-openCard-2', 'open-card-flow').changeUnit;
    const blueprintFile = path.join(root, 'doc/features/bc-openCard-2/blueprint/component-blueprint.yaml');
    const bytes = fs.readFileSync(blueprintFile);
    const config = JSON.parse(fs.readFileSync(path.join(root, 'framework.config.json'), 'utf8'));
    const blueprintOnly = { design_ref: cu.component_blueprint_ref };
    const firstBlueprintDigest = identityNeutralDigest(root, 'acceptance@1', blueprintOnly);
    assert(firstBlueprintDigest);
    const initial = identityNeutralDigest(root, 'change-unit@1', cu, createIdentityNeutralDigestReaders());
    assert(initial);
    const denied = structuredClone(config.architecture);
    denied.outer_layers = denied.outer_layers.filter((layer: { id: string }) => layer.id !== '02-Feature');
    for (const layer of denied.outer_layers) layer.can_depend_on = layer.can_depend_on.filter((id: string) => id !== '02-Feature');
    publishArchitectureRevision(root, denied);
    assert(fs.readFileSync(blueprintFile).equals(bytes));
    const changed = counted(() => identityNeutralDigest(root, 'change-unit@1', cu, createIdentityNeutralDigestReaders()));
    assert.equal(changed.value, null, 'new DSL must not reuse old blueprint validation');
    assert((changed.counts['blueprint.validate'] ?? 0) > 0);
    assert.throws(() => resolveComponentBlueprintRef(root, cu.component_blueprint_ref), { code: 'component_blueprint_invalid' });
    assert.equal(identityNeutralDigest(root, 'acceptance@1', blueprintOnly), null, 'blueprint-only digest must also see the DSL change');
    publishArchitectureRevision(root, config.architecture);
    assert.equal(identityNeutralDigest(root, 'change-unit@1', cu, createIdentityNeutralDigestReaders()), initial);
    assert.equal(identityNeutralDigest(root, 'acceptance@1', blueprintOnly), firstBlueprintDigest);
  }) },
  { name: 'missing canonical authority cannot reuse a preceding action and can recover after restoration', run: () => withProject(({ root }) => {
    const cu = loadCanonicalChangeUnit(root, 'bc-openCard-2', 'open-card-flow').changeUnit;
    const file = path.join(root, 'doc/features/bc-openCard-2/blueprint/component-blueprint.yaml');
    const bytes = fs.readFileSync(file);
    const first = identityNeutralDigest(root, 'change-unit@1', cu);
    assert(first);
    fs.unlinkSync(file);
    try { assert.equal(identityNeutralDigest(root, 'change-unit@1', cu), null); }
    finally { fs.writeFileSync(file, bytes); }
    assert.equal(identityNeutralDigest(root, 'change-unit@1', cu), first);
  }) },
  { name: 'component-index-only change is visible in the next action', run: () => withProject(({ root }) => {
    const cu = loadCanonicalChangeUnit(root, 'bc-openCard-2', 'open-card-flow').changeUnit;
    const file = path.join(root, 'doc/component-index.yaml');
    const bytes = fs.readFileSync(file);
    const yaml = require('yaml') as typeof import('yaml');
    const first = identityNeutralDigest(root, 'change-unit@1', cu);
    assert(first);
    const index = yaml.parse(bytes.toString('utf8'));
    index.components = index.components.filter((item: { id: string }) => !item.id.includes('#buildAllBanksPage'));
    fs.writeFileSync(file, yaml.stringify(index));
    try { assert.equal(identityNeutralDigest(root, 'change-unit@1', cu), null); }
    finally { fs.writeFileSync(file, bytes); }
    assert.equal(identityNeutralDigest(root, 'change-unit@1', cu), first);
  }) },
  { name: '1b91ba normal coding preparation and assess each validate once without stale-upstream shortcuts', run: () => withProject(({ root, frameworkRoot }) => {
    for (const phase of ['spec', 'plan'] as const) {
      const file = path.join(root, rel, phase, 'reports/phase-evidence-manifest.json');
      const old = JSON.parse(fs.readFileSync(file, 'utf8'));
      old.environment = resolvePhaseEvidenceManifest({ projectRoot: root, feature, phase, frameworkRoot,
        requirementSha: old.environment.requirement_sha256 }).environment;
      old.aggregate_sha256 = recomputeManifestAggregate(old);
      fs.writeFileSync(file, JSON.stringify(old));
    }
    assert(recomputePhaseEvidenceStaleness(root, feature, ['spec', 'plan'], { frameworkRoot, runId })
      .every(item => item.verdict === 'fresh'));
    const manifest = JSON.parse(fs.readFileSync(path.join(root, rel, 'goal-runs', runId, 'manifest.json'), 'utf8'));
    const coding = counted(() => {
      const authorityReaders = createIdentityNeutralDigestReaders();
      const boundary = resolvePhaseWriteBoundary({ projectRoot: root, frameworkRoot, feature, runId, authorityReaders,
        pendingOwnerPhase: 'coding', phaseOrder: ['spec', 'plan', 'coding', 'review', 'ut', 'testing'], track: 'full',
        profileDir: path.join(frameworkRoot, 'profiles/hmos-app'), productLayerDirs: ['01-Product', '02-Feature', '04-BusinessBase', '05-SystemBase'] });
      const admitted = resolveCapabilityResolutionEntryInput({ projectRoot: root, frameworkRoot, feature, phase: 'coding',
        featuresDir: 'doc/features', goalRunId: runId, goalAttemptId: 'i7', authorityReaders });
      assert(admitted.factsContext && !admitted.factsRebuildReason, `normal admission must succeed without rebuild: ${admitted.factsRebuildReason}`);
      assert.equal(admitted.factsContext.source_owners?.['02-Feature/WalletMain/src/main/resources/base/element/string.json'], 'coding');
      const prompt = buildPhasePrompt(manifest, root, 'coding', frameworkRoot, [], undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined, undefined, boundary);
      assert(prompt.includes('Goal run phase: coding') && prompt.includes(manifest.requirement));
    });
    assert.equal(coding.counts['blueprint.validate'], 1, JSON.stringify(coding.counts));
    assert.equal(coding.counts['blueprint.parse'], 1);
    assert.equal(coding.counts['cu.validate'], 1);
    const assessed = counted(() => assessFeature({ projectRoot: root, frameworkRoot, feature, runId, writeProjection: false }));
    assert.equal(assessed.counts['blueprint.validate'], 1, JSON.stringify(assessed.counts));
    assert.equal(assessed.counts['blueprint.parse'], 1);
    const phases = assessed.value.observed.phases;
    for (const phase of ['spec', 'plan']) assert.equal(phases.find(item => item.phase === phase)?.closure, 'closed');
    assert.equal(assessed.value.recommendation.phase, 'coding');
    assert.equal(assessed.value.recommendation.action, 'rerun_phase', 'historical coding defect must not disappear');
  }) },
];

export async function runSelectedCases(selector?: string) {
  const results: UnitCaseResult[] = [];
  for (const test of cases) {
    if (!matchesUnitCase(test.name, selector)) continue;
    try { await test.run(); results.push({ name: test.name, ok: true }); }
    catch (error) { results.push({ name: test.name, ok: false, error: (error as Error).stack }); }
  }
  return selectedUnitCases(results, selector, []);
}
export const runAll = async (): Promise<UnitCaseResult[]> => (await runSelectedCases()).results;
