import { runUnitCasesAsync } from '../utils/unit-cases';
import { componentBlueprintPath } from '../../scripts/utils/component-blueprint-path';
// Current design publication, source protection and real writer/authority recovery boundaries.

import assert from 'assert';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';

import { clearFrameworkConfigCache, featureFilePath } from '../../config';
import { deriveDesignPreparationReadiness, reconcileChangeUnitBlueprintRefs } from '../../scripts/utils/change-unit-design-preparation';
import { deriveChangeUnitFeatureId, loadCanonicalChangeUnit } from '../../scripts/utils/change-unit-path';
import { classifyDesignAuthorityCodes, materializeBlueprintSkillInputs, diagnoseBlueprintSkillAuthority } from '../../scripts/utils/blueprint-skill-projection';
import { loadCanonicalBlueprint } from '../../scripts/utils/component-blueprint-path';
import { FEATURE_LOCK_NAME, releaseLock, tryAcquireLock } from '../../scripts/utils/goal-run-lock';
import { BLUEPRINT_ID, withFreshCuHost } from '../utils/real-chain-host';
import type { UnitCaseResult } from '../run-unit';

type Snapshot = Parameters<Parameters<typeof withFreshCuHost>[0]>[0];

function bumpBlueprint(s: Snapshot, mutate?: (bp: Record<string, unknown>) => void): void {
  const file = componentBlueprintPath(s.root, BLUEPRINT_ID);
  const bp = YAML.parse(fs.readFileSync(file, 'utf8'));
  bp.revision = Number(bp.revision) + 1;
  for (const result of bp.derived_results ?? []) result.input_revision = bp.revision;
  mutate?.(bp);
  fs.writeFileSync(file, YAML.stringify(bp));
}

type Ev = Record<string, any>;
const CU = 'ledger-refresh';
const CU_FEATURE = deriveChangeUnitFeatureId(BLUEPRINT_ID, CU);
const SIBLING = 'ledger-summary';

const blueprintFile = (s: Snapshot): string => path.join(featureFilePath(s.root, BLUEPRINT_ID, ''), 'blueprint', 'component-blueprint.yaml');
const featureLockPath = (s: Snapshot, changeUnitId: string): string =>
  featureFilePath(s.root, deriveChangeUnitFeatureId(BLUEPRINT_ID, changeUnitId), path.join('goal-runs', FEATURE_LOCK_NAME));
const pointsAtCurrentBlueprint = (s: Snapshot, changeUnitId: string): boolean => {
  const ref = loadCanonicalChangeUnit(s.root, BLUEPRINT_ID, changeUnitId).changeUnit.component_blueprint_ref as { revision?: number; artifact_sha256?: string };
  const current = loadCanonicalBlueprint(s.root, BLUEPRINT_ID);
  return ref.revision === Number(current.blueprint.revision) && ref.artifact_sha256 === current.artifactSha256;
};
function ledgerDomain(bp: Record<string, unknown>): Ev {
  let hit: Ev | undefined;
  const visit = (v: unknown): void => {
    if (hit || !v || typeof v !== 'object') return;
    if (Array.isArray(v)) { v.forEach(visit); return; }
    if ((v as { node_id?: string }).node_id === 'ledger-domain') { hit = v as Ev; return; }
    Object.values(v).forEach(visit);
  };
  visit(bp);
  assert(hit, '快照蓝图缺 ledger-domain');
  return hit!;
}

// ---- S15：B 类停机 → 修好 → 自动续跑 -------------------------------------------------------------
//
// 两种宿主形状：
//  · 全手写（宿主原始形状）：acceptance / contracts / use-cases 都是手写无戳文件，绑定是 artifact——蓝图内容变化后
//    由 spec / plan 在链内改写、经范围修订重签，所以修好后重新接入同一 run。
//  · 派生施工契约：acceptance 手写、contracts / use-cases 不落盘，施工契约绑定来自 `derive.blueprint-contracts`——
//    没有责任阶段能重签；修复改了它依赖的蓝图内容时同一 run 续不下去，要自动起后继。

const TEXT_ACCEPTANCE = '验收写成了一段文本';
const sha = (file: string): string => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const restoreNode = (node: Ev, saved: Ev): void => { for (const key of Object.keys(node)) delete node[key]; Object.assign(node, structuredClone(saved)); };
const readDoc = (file: string): Ev => YAML.parse(fs.readFileSync(file, 'utf8')) as Ev;
const writeDoc = (file: string, doc: Ev): void => fs.writeFileSync(file, YAML.stringify(doc));

const cases: Array<{ name: string; run: () => Promise<void> }> = [
  ...(['current', 'own-gap', 'sibling-gap'] as const).map(mode => ({
    name: `S14 current writer ${mode}: reconcile only eligible CUs with the original feature lock`,
    run: () => withFreshCuHost(async s => {
      bumpBlueprint(s, bp => { if (mode === 'own-gap') ledgerDomain(bp).knowledge_state = 'unknown'; });
      if (mode === 'sibling-gap') {
        const sibling = loadCanonicalChangeUnit(s.root, BLUEPRINT_ID, SIBLING);
        const changed = readDoc(sibling.canonicalPath); changed.touches[0].design_ref.revision += 40; writeDoc(sibling.canonicalPath, changed);
      }
      const ownBefore = loadCanonicalChangeUnit(s.root, BLUEPRINT_ID, CU).artifactSha256;
      const siblingBefore = loadCanonicalChangeUnit(s.root, BLUEPRINT_ID, SIBLING).artifactSha256;
      const lock = tryAcquireLock(featureLockPath(s, CU), { run_id: 'current-writer' }); assert(lock);
      try {
        const result = reconcileChangeUnitBlueprintRefs(s.root, BLUEPRINT_ID, { heldFeatureLocks: [{ path: featureLockPath(s, CU), ownerId: lock.ownerId }] });
        assert(!result.busy, JSON.stringify(result));
        if (mode === 'own-gap') {
          assert(result.skipped.some(row => row.change_unit_id === CU && row.reasons.some(reason => reason.includes('ledger-domain'))), JSON.stringify(result));
          assert.equal(loadCanonicalChangeUnit(s.root, BLUEPRINT_ID, CU).artifactSha256, ownBefore, 'unresolved current design cannot rewrite the CU');
        } else {
          assert(result.bumped.some(row => row.change_unit_id === CU) && pointsAtCurrentBlueprint(s, CU), JSON.stringify(result));
          if (mode === 'sibling-gap') {
            assert(result.skipped.some(row => row.change_unit_id === SIBLING && row.reasons.some(reason => reason.includes('blueprint_ref_identity_inconsistent'))), JSON.stringify(result));
            assert.equal(loadCanonicalChangeUnit(s.root, BLUEPRINT_ID, SIBLING).artifactSha256, siblingBefore);
          }
        }
        assert(fs.existsSync(featureLockPath(s, CU)), 'the writer must retain the borrowed lock');
      } finally { releaseLock(featureLockPath(s, CU), lock.ownerId); }
    }),
  })),
  ...(['shape', 'unresolved'] as const).map(mode => ({
    name: `S15 current design ${mode}: unchanged input stays blocked and actual owner correction restores readiness`,
    run: () => withFreshCuHost(async s => {
      materializeBlueprintSkillInputs(s.root, CU_FEATURE, s.frameworkRoot);
      const saved = structuredClone(ledgerDomain(loadCanonicalBlueprint(s.root, BLUEPRINT_ID).blueprint));
      bumpBlueprint(s, bp => { const node = ledgerDomain(bp); if (mode === 'shape') node.acceptance = TEXT_ACCEPTANCE; else node.knowledge_state = 'unknown'; });
      const watched = [blueprintFile(s), loadCanonicalChangeUnit(s.root, BLUEPRINT_ID, CU).canonicalPath];
      const before = watched.map(sha);
      const probe = () => { clearFrameworkConfigCache(); const current = diagnoseBlueprintSkillAuthority(s.root, s.frameworkRoot, CU_FEATURE);
        return { ready: !current.unevaluable && !current.findings.length, reason: current.unevaluable ?? current.findings.map(row => row.codes.join(',')).join(';') }; };
      const first = probe(), repeated = probe();
      assert(!first.ready && !repeated.ready, JSON.stringify({ first, repeated }));
      assert.deepEqual(watched.map(sha), before, 'probing unchanged design must be read-only');
      bumpBlueprint(s, bp => restoreNode(ledgerDomain(bp), saved));
      const ready = deriveDesignPreparationReadiness(s.root, BLUEPRINT_ID);
      assert(!ready.blueprintRefs.busy && ready.perUnit.find(row => row.changeUnitId === CU)?.verdict === 'constructable', JSON.stringify(ready));
      assert(probe().ready, JSON.stringify(probe()));
    }),
  })),

  {
    name: 'B4-table 分类表：机器内容文字归 B1；需要裁决、缺事实、扩大范围与混合原因码归 B2；空集、未登记及已退役映射码一律 B2',
    run: async () => {
      assert.strictEqual(classifyDesignAuthorityCodes(['authority_content_not_machine_structure']).class, 'B1');
      for (const code of ['a_code_added_later', 'authority_cu_mapping_stale', 'authority_cu_mapping_conflict']) {
        const unlisted = classifyDesignAuthorityCodes([code]);
        assert(unlisted.class === 'B2' && /未登记/.test(unlisted.needs.join()), `未列入的原因码默认 B2：${JSON.stringify(unlisted)}`);
      }
      assert.strictEqual(classifyDesignAuthorityCodes([]).class, 'B2', '没有原因码不得当成 B1');
      for (const code of [
        'change_unit_current_design_unresolved', 'change_unit_contract_not_admitted', 'cu_architecture_impact_not_effective', 'cu_scope_matches_blueprint',
        'change_unit_schema_invalid', 'change_unit_design_ref_unresolvable', 'change_unit_blueprint_unresolvable', 'authority_contract_files_missing',
        'authority_content_conflict', 'authority_target_provenance_missing', 'change_unit_blueprint_ref_stale', 'component_blueprint_invalid', 'change_unit_missing',
        'authority_content_missing', 'authority_projection_shape_invalid',
      ]) {
        const verdict = classifyDesignAuthorityCodes([code]);
        assert(verdict.class === 'B2' && verdict.needs.length === 1 && !/未登记/.test(verdict.needs[0]), `${code} 应登记为 B2 并写清缺什么：${JSON.stringify(verdict)}`);
      }
      const mixed = classifyDesignAuthorityCodes(['authority_content_not_machine_structure', 'change_unit_current_design_unresolved']);
      assert(mixed.class === 'B2' && mixed.needs.length === 2, `B1 与 B2 混合按 B2：${JSON.stringify(mixed)}`);
    },
  },
  {
    name: 'B1-mixed 机器内容形状与真实DSL冲突：两条原因都解除才就绪，续跑或后继仍由既有绑定判断',
    run: () => withFreshCuHost(async s => {
      const feature = CU_FEATURE;
      materializeBlueprintSkillInputs(s.root, feature, s.frameworkRoot);
      const saved = structuredClone(ledgerDomain(loadCanonicalBlueprint(s.root, BLUEPRINT_ID).blueprint));
      const configBytes = fs.readFileSync(path.join(s.root, 'framework.config.json'));
      bumpBlueprint(s, bp => {
        ledgerDomain(bp).acceptance = TEXT_ACCEPTANCE;
        (bp.decisions_and_gaps as Ev).decisions.push({ decision_id: 'mixed-remove-edge', kind: 'architecture_impact', change: 'dependency_edge',
          from: 'ledger', to: 'FinancialCard', direction: 'remove', status: 'decided_with_authority', owner: 'design-owner',
          rationale: '领域不依赖页面', verification_refs: ['view:development'], provenance: structuredClone(bp.provenance) });
      });
      reconcileChangeUnitBlueprintRefs(s.root, BLUEPRINT_ID);
      const probe = () => { clearFrameworkConfigCache(); const current = diagnoseBlueprintSkillAuthority(s.root, s.frameworkRoot, feature);
        return { ready: !current.unevaluable && !current.findings.length, reason: current.unevaluable ?? current.findings.map(row => row.codes.join(',')).join(';') }; };
      const both = probe();
      assert(!both.ready && /authority_content_not_machine_structure/.test(String(both.reason)) && /cu_architecture_impact_not_effective/.test(String(both.reason)), JSON.stringify(both));
      bumpBlueprint(s, bp => restoreNode(ledgerDomain(bp), saved));
      reconcileChangeUnitBlueprintRefs(s.root, BLUEPRINT_ID);
      const one = probe();
      assert(!one.ready && /cu_architecture_impact_not_effective/.test(String(one.reason)) && !/authority_content_not_machine_structure/.test(String(one.reason)), JSON.stringify(one));
      bumpBlueprint(s, bp => { const decisions = bp.decisions_and_gaps as Ev; decisions.decisions = decisions.decisions.filter((row: Ev) => row.decision_id !== 'mixed-remove-edge'); });
      const ready = deriveDesignPreparationReadiness(s.root, BLUEPRINT_ID);
      assert(ready.perUnit.find(row => row.changeUnitId === CU)?.verdict === 'constructable', JSON.stringify(ready));
      assert(probe().ready, JSON.stringify(probe()));
      assert.deepEqual(fs.readFileSync(path.join(s.root, 'framework.config.json')), configBytes, 'the test must correct its original decision rather than change the DSL');
    }),
  },
  // S16 main integration stays in reliability-scenarios; current S14/S15 boundaries are short cases above.

];

export function runAll(): Promise<UnitCaseResult[]> {
  return runUnitCasesAsync(cases.map(test => ({ ...test, name: `design-authority-repair: ${test.name}` })));
}
