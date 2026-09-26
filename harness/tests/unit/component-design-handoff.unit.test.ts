// ============================================================================
// component-design-handoff.unit.test.ts — M7 t5：/component-design 设计交接的仓内验收
// ============================================================================
//
// 覆盖两条完整链，全部用生产入口，不含任何宿主工程改造：
//
//  · **单 CU 正式需求**：物化材料 → 薄蓝图 admitted → 设计准备段（0 CU 合法入口）
//    → 原子写 1 个 canonical CU → design_refs 建立 → readiness → **停在交接**；
//  · **多 CU 正式需求**：条件式设计义务确实触发——CU 边界与关系分析（真实 requires 边）、
//    共享部件级决策只裁决一次并由各 CU 经 design_refs 消费、组合闭环义务成行。
//
// "停在交接"用可证伪的方式断言：走完设计准备段后，工作区内**没有** goal-runs 目录、
// **没有** component-closure 产物——即没有进入 selector / Goal Mode / P3。

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as YAML from 'yaml';
import { clearFrameworkConfigCache, featureFilePath, featuresDirPath } from '../../config';
import { deriveBlueprintSkillInput } from '../../scripts/utils/blueprint-skill-projection';
import { loadHostSnapshot, SNAPSHOT_CU_FEATURE } from '../fixtures/host-snapshot-3.1.0/generate';
import { BlueprintRecord, ComponentBlueprintRef, asRecord, asRecords } from '../../scripts/utils/component-blueprint-model';
import { componentBlueprintPath, loadCanonicalBlueprint, sha256Bytes } from '../../scripts/utils/component-blueprint-path';
import { isChangedView } from '../../scripts/utils/blueprint-views';
import { checkCanonicalComponentBlueprint } from '../../scripts/check-component-blueprint';
import { blueprintRefAddress } from '../../scripts/utils/change-unit-model';
import {
  asChangeUnitArtifact,
  createChangeUnitRef,
  deriveChangeUnitFeatureId,
  enumerateCanonicalChangeUnits,
  inspectDerivedFeatureBinding,
  loadCanonicalChangeUnit,
  resolveChangeUnitRef,
} from '../../scripts/utils/change-unit-path';
import { validateChangeUnitFeatureProjection } from '../../scripts/utils/change-unit-feature-projection';
import { ContractsSpec } from '../../scripts/utils/types';
import { validateChangeUnitDesign } from '../../scripts/utils/change-unit-design-gate';
import { evaluateChangeUnitDependencies } from '../../scripts/utils/change-unit-dependencies';
import {
  ChangeUnitDecompositionRejected,
  acceptChangeUnitDecomposition,
  deriveDesignPreparationReadiness,
  evaluateConstructionEntry,
  evaluateDesignPreparationEntry,
  reconcileChangeUnitBlueprintRefs,
} from '../../scripts/utils/change-unit-design-preparation';
import { deriveChangeUnitReadySet } from '../../scripts/utils/change-unit-ready-set';
import { deriveChangeUnitProgressionDecision } from '../../scripts/utils/change-unit-progress-loop';
import { validateRequirementSourceMaterialization } from '../../scripts/utils/blueprint-host-seams';
import { componentClosurePath } from '../../scripts/utils/component-closure-path';
import { evaluateComponentClosure } from '../../scripts/utils/component-closure-validator';
import { prepareCompleteProject } from './component-closure.unit.test';
import { clearSkillsIndexCache, resolveSkillPath } from '../../scripts/utils/resolve-skill-path';

interface UnitCaseResult { name: string; ok: boolean; error?: string }

const FRAMEWORK_ROOT = path.resolve(__dirname, '..', '..', '..');
const BASE_PROJECT = path.resolve(__dirname, '..', 'fixtures', 'component-blueprint', 'valid');
const SAMPLES_DIR = path.join(FRAMEWORK_ROOT, 'docs', 'operations', 'samples');
const BLUEPRINT_ID = 'ledger-app-blueprint';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function test(name: string, run: () => void): UnitCaseResult {
  try { run(); return { name, ok: true }; }
  catch (error) { return { name, ok: false, error: (error as Error).stack ?? (error as Error).message }; }
}

function withProject(run: (projectRoot: string) => void): void {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-design-handoff-'));
  const projectRoot = path.join(tempRoot, 'project');
  fs.cpSync(BASE_PROJECT, projectRoot, { recursive: true });
  try { run(projectRoot); } finally { fs.rmSync(tempRoot, { recursive: true, force: true }); }
}

function workspaceDir(projectRoot: string): string {
  return path.join(featuresDirPath(projectRoot), BLUEPRINT_ID);
}

/** 清空工作区的全部 canonical CU 与施工产物 —— 模拟"蓝图刚 admitted、还没拆单元"。 */
function emptyWorkspace(projectRoot: string): void {
  const dir = workspaceDir(projectRoot);
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name !== 'blueprint') {
      fs.rmSync(path.join(dir, entry.name), { recursive: true, force: true });
    }
  }
}

/** 从既有 canonical CU 派生一个新候选：保持 design_refs / provenance 语义，只换 id。 */
function candidateFrom(projectRoot: string, templateId: string, newId: string) {
  const template = loadCanonicalChangeUnit(projectRoot, BLUEPRINT_ID, templateId).changeUnit;
  const artifact = asChangeUnitArtifact(JSON.parse(JSON.stringify(template)));
  artifact.change_unit_id = newId;
  artifact.provenance.extraction_method =
    `${artifact.provenance.extraction_method} + builtin-vertical-slice-decomposition + consumer-validation`;
  return { providerId: 'builtin-vertical-slice-decomposition', artifact };
}

/** 把候选 CU 的全部蓝图 ref 重绑到给定 artifact hash（瘦身后蓝图字节变了）。 */
function rebindBlueprintHash(cu: BlueprintRecord, artifactSha256: string): void {
  (cu.component_blueprint_ref as BlueprintRecord).artifact_sha256 = artifactSha256;
  for (const ref of cu.design_refs as BlueprintRecord[]) ref.artifact_sha256 = artifactSha256;
  for (const touch of cu.touches as BlueprintRecord[]) {
    (touch.design_ref as BlueprintRecord).artifact_sha256 = artifactSha256;
  }
}

/** 设计交接段结束后，绝不能出现的施工/闭环痕迹。 */
function assertStoppedAtHandoff(projectRoot: string): void {
  assert(!fs.existsSync(componentClosurePath(projectRoot, BLUEPRINT_ID)), '设计交接段产出了 component closure 产物');
  const dir = workspaceDir(projectRoot);
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'blueprint') continue;
    assert(
      !fs.existsSync(path.join(dir, entry.name, 'goal-runs')),
      `设计交接段启动了 Goal Mode run：${entry.name}/goal-runs`,
    );
  }
}

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];

  results.push(test('design entry: draft/admitted local checks preserve canonical bytes and do not decompose', () => {
    for (const admitted of [false, true]) withProject(projectRoot => {
      emptyWorkspace(projectRoot);
      const file = componentBlueprintPath(projectRoot, BLUEPRINT_ID);
      if (!admitted) {
        const draft = YAML.parse(fs.readFileSync(file, 'utf8'));
        draft.review_summary.admission.status = 'blocked';
        fs.writeFileSync(file, YAML.stringify(draft));
      }
      const before = fs.readFileSync(file, 'utf8');
      for (let reentry = 0; reentry < 2; reentry++) {
        const checked = checkCanonicalComponentBlueprint(projectRoot, BLUEPRINT_ID);
        assert((checked.issues.filter(i => i.severity === 'BLOCKER').length === 0) === admitted, '草稿/准入检查失真');
        assert(evaluateDesignPreparationEntry(projectRoot, BLUEPRINT_ID).canEnter === admitted, '草稿被当成已准入');
        assert(!deriveDesignPreparationReadiness(projectRoot, BLUEPRINT_ID).ready, '局部检查被当成完整交接');
      }
      assert(fs.readFileSync(file, 'utf8') === before, '只读重入改变 canonical 字节/revision');
      assert(enumerateCanonicalChangeUnits(projectRoot, BLUEPRINT_ID).length === 0, '局部操作自动创建 CU');
      assertStoppedAtHandoff(projectRoot);
    });
  }));

  results.push(test('design entry: existing admitted zero-CU design finishes handoff once and reuses accepted CU', () => {
    withProject(projectRoot => {
      const candidate = candidateFrom(projectRoot, 'ledger-refresh', 'continued-cu');
      emptyWorkspace(projectRoot);
      const blueprintFile = componentBlueprintPath(projectRoot, BLUEPRINT_ID);
      const before = fs.readFileSync(blueprintFile, 'utf8');
      const entry = evaluateDesignPreparationEntry(projectRoot, BLUEPRINT_ID);
      assert(entry.canEnter && entry.existingChangeUnitIds.length === 0, '既有 0 CU 蓝图不能继续');
      const accepted = acceptChangeUnitDecomposition(projectRoot, BLUEPRINT_ID, [candidate]);
      const unitBefore = fs.readFileSync(accepted.accepted[0]!.canonicalPath, 'utf8');
      const reentry = evaluateDesignPreparationEntry(projectRoot, BLUEPRINT_ID);
      assert(reentry.existingChangeUnitIds.join(',') === 'continued-cu', '重入未找到可复用 CU');
      assert(deriveDesignPreparationReadiness(projectRoot, BLUEPRINT_ID).ready, '既有 CU 无法交接');
      let rejected = false;
      try { acceptChangeUnitDecomposition(projectRoot, BLUEPRINT_ID, [candidate]); }
      catch (error) { rejected = error instanceof ChangeUnitDecompositionRejected; }
      assert(rejected, 'consumer 未拒绝重复接受');
      assert(enumerateCanonicalChangeUnits(projectRoot, BLUEPRINT_ID).length === 1, '重复创建 CU');
      assert(fs.readFileSync(accepted.accepted[0]!.canonicalPath, 'utf8') === unitBefore, '重入改写已接受 CU');
      assert(fs.readFileSync(blueprintFile, 'utf8') === before, '首次分解或重入不应修订蓝图');
      assertStoppedAtHandoff(projectRoot);
    });
  }));

  results.push(test('design entry: internal P1 workflow links resolve within the release content', () => {
    for (const rel of ['skills/project/component-design/SKILL.md', 'skills/reference/app-component-blueprint-workflow.md']) {
      const file = path.join(FRAMEWORK_ROOT, rel);
      for (const match of fs.readFileSync(file, 'utf8').matchAll(/\]\(([^)]+)\)/g)) {
        const target = path.resolve(path.dirname(file), match[1]!.split('#')[0]!);
        assert(fs.existsSync(target), `${rel} 引用缺失：${match[1]}`);
        assert(!path.relative(FRAMEWORK_ROOT, target).startsWith('..'), '内部流程引用超出发布件');
      }
    }
  }));

  // -------------------------------------------------------------------------
  // 单 CU 正式需求：完整设计交接
  // -------------------------------------------------------------------------
  results.push(test('M7 t5: single-CU formal requirement completes a full design handoff and stops there', () => {
    withProject(projectRoot => {
      // ① 需求源物化（接缝 1）：正式需求 required，上游显式分类具权威性
      const materialization = JSON.parse(
        fs.readFileSync(path.join(SAMPLES_DIR, 'requirement-source-materialization.valid.json'), 'utf8'),
      );
      assert(
        validateRequirementSourceMaterialization(materialization, { projectRoot, blueprintId: BLUEPRINT_ID, componentId: 'ledger' }).length === 0,
        '物化材料未通过校验',
      );

      // 先取模板（清空工作区后就读不到了），再模拟"蓝图刚 admitted、还没拆单元"
      const soloCandidate = candidateFrom(projectRoot, 'ledger-refresh', 'solo-ledger-refresh');

      // ② 蓝图 admitted —— 合法性判据**不含 CU 数量**
      emptyWorkspace(projectRoot);
      const blueprintCheck = checkCanonicalComponentBlueprint(projectRoot, BLUEPRINT_ID);
      assert(
        blueprintCheck.issues.filter(item => item.severity === 'BLOCKER').length === 0,
        `admitted blueprint + 0 CU 应合法，实际：${blueprintCheck.issues.map(item => item.id).join(', ')}`,
      );
      assert(
        asRecord(asRecord(blueprintCheck.blueprint.review_summary)?.admission)?.status === 'pass',
        '前提：蓝图应处于 admitted',
      );

      // ③ 设计准备段：0 CU 是合法入口；施工段前提此刻不成立
      const entry = evaluateDesignPreparationEntry(projectRoot, BLUEPRINT_ID);
      assert(entry.canEnter && entry.existingChangeUnitIds.length === 0, '0 CU 未被判为合法设计准备入口');
      assert(!evaluateConstructionEntry(projectRoot, BLUEPRINT_ID).canEnter, '0 CU 时施工段入口不应放行');

      // ④ 候选 → consumer validator 原子写出 1 个 canonical CU
      const accepted = acceptChangeUnitDecomposition(projectRoot, BLUEPRINT_ID, [soloCandidate]);
      assert(accepted.changeUnitIds.join(',') === 'solo-ledger-refresh', `单 CU 写出失败：${accepted.changeUnitIds.join(',')}`);

      // ⑤ 每个 CU 建立 design_refs 引用，且经设计可施工门
      const unit = accepted.accepted[0]!.changeUnit;
      const designRefs = unit.design_refs as unknown as ComponentBlueprintRef[];
      assert(Array.isArray(designRefs) && designRefs.length > 0, '交接 CU 缺 design_refs');
      const design = validateChangeUnitDesign(projectRoot, unit);
      assert(design.verdict === 'constructable', `CU 未过设计可施工门：${design.issues.map(item => item.id).join(', ')}`);

      // ⑥ readiness = 完整设计交付；终点是交接，不是施工
      const readiness = deriveDesignPreparationReadiness(projectRoot, BLUEPRINT_ID);
      assert(readiness.ready, `readiness 未就绪：${JSON.stringify(readiness.perUnit)}`);
      assert(readiness.entersConstruction === false, '设计准备段不得进入施工');
      assert(readiness.nextEntry === 'change-unit-progression', `下一步入口应是既有施工入口：${readiness.nextEntry}`);
      assert(evaluateConstructionEntry(projectRoot, BLUEPRINT_ID).canEnter, '≥1 CU 后施工段应可进入');

      // ⑦ 可证伪地断言"停在交接之前"
      assertStoppedAtHandoff(projectRoot);
    });
  }));

  // -------------------------------------------------------------------------
  // 返修测试项 1：真正的**薄蓝图**全链
  //   1 个 applicable+changed 视图 + 其余 applicable 视图真实 verified_unchanged
  //   + 1 个 canonical CU + 非空 CU sidecar 映射 + readiness + 单 CU 退化 closure
  // 只组合既有协议，不新增任何生产机制。
  // -------------------------------------------------------------------------
  results.push(test('M7 fix: a genuinely THIN blueprint runs the full chain through real P3 closure', () => {
    withProject(projectRoot => {
      const soloCandidate = candidateFrom(projectRoot, 'ledger-refresh', 'thin-solo-cu');
      // configureFeature（既有 closure 装配）是在**已存在**的 contracts.yaml 上打 sidecar，
      // 因此把模板 CU 的 contracts.yaml 底稿一并捕获，稍后放进新 CU 目录。
      const contractsTemplate = fs.readFileSync(
        path.join(workspaceDir(projectRoot), 'ledger-refresh', 'contracts.yaml'), 'utf8',
      );
      emptyWorkspace(projectRoot);

      // ① 把蓝图瘦成"只有 runtime 是 changed"，其余 applicable 视图真实 verified_unchanged
      const blueprintFile = componentBlueprintPath(projectRoot, BLUEPRINT_ID);
      const blueprint = YAML.parse(fs.readFileSync(blueprintFile, 'utf8')) as BlueprintRecord;
      const questioning = asRecord(asRecord(blueprint.review_summary)?.questioning);
      const thinned: string[] = [];
      for (const view of asRecords(blueprint.design_views)) {
        const viewId = String(view.view_id);
        if (view.applicability !== 'applicable' || viewId === 'runtime') continue;
        const evidence = [`src/ledger/Thin-${viewId}.ts`];
        fs.writeFileSync(path.join(projectRoot, 'src', 'ledger', `Thin-${viewId}.ts`), `export const thin${viewId} = true;\n`, 'utf8');
        view.evolution_impact = 'verified_unchanged';
        view.unchanged_evidence = { evidence_refs: evidence, current_state_ref: evidence[0]! };
        view.target_state = view.current_state;   // view-level 无本次 delta
        view.delta = 'none';
        for (const node of asRecords(view.nodes)) { node.target_state = node.current_state; node.delta = 'none'; }
        const item = asRecords(questioning?.items).find(entry => entry.scope_ref === `view:${viewId}`);
        if (item) { item.disposition = 'answered_with_evidence'; item.evidence_refs = [...evidence]; }
        thinned.push(viewId);
      }
      assert(thinned.length >= 2, `前提：至少两个视图被瘦成 verified_unchanged，实际 ${thinned.join(',')}`);
      fs.writeFileSync(blueprintFile, YAML.stringify(blueprint), 'utf8');

      // ② 薄蓝图仍然合法且 admitted（这正是"小正式需求成本可控"的判据）
      const check = checkCanonicalComponentBlueprint(projectRoot, BLUEPRINT_ID);
      assert(
        check.issues.filter(item => item.severity === 'BLOCKER').length === 0,
        `薄蓝图被误拒：${check.issues.map(item => `${item.id}@${item.path}`).join(', ')}`,
      );
      const changedViews = asRecords(check.blueprint.design_views).filter(isChangedView).map(v => String(v.view_id));
      assert(changedViews.join(',') === 'runtime', `薄蓝图应只剩 runtime 为 changed，实际 ${changedViews.join(',')}`);

      // ③ 设计准备段：0 CU 入口 → 原子写 1 个 canonical CU（candidate 的 hash 需重绑到瘦后的蓝图）
      const artifactSha = sha256Bytes(fs.readFileSync(blueprintFile));
      rebindBlueprintHash(soloCandidate.artifact as unknown as BlueprintRecord, artifactSha);
      assert(evaluateDesignPreparationEntry(projectRoot, BLUEPRINT_ID).canEnter, '薄蓝图 + 0 CU 未被判为合法入口');
      const accepted = acceptChangeUnitDecomposition(projectRoot, BLUEPRINT_ID, [soloCandidate]);
      assert(accepted.changeUnitIds.join(',') === 'thin-solo-cu', `薄链单 CU 写出失败：${accepted.changeUnitIds.join(',')}`);

      // ④ readiness 就绪，且终点仍停在交接之前
      const readiness = deriveDesignPreparationReadiness(projectRoot, BLUEPRINT_ID);
      assert(readiness.ready, `薄链 readiness 未就绪：${JSON.stringify(readiness.perUnit)}`);
      assertStoppedAtHandoff(projectRoot);

      // ⑤ CU-bound sidecar：三组映射**非空**且逐条覆盖 canonical 集合（空数组会被门禁抓住）
      const unit = accepted.accepted[0]!.changeUnit;
      const featureId = deriveChangeUnitFeatureId(BLUEPRINT_ID, 'thin-solo-cu');
      const implRef = 'src/ledger/ThinFeature.ets';
      const testRef = 'test/ledger/ThinFeature.test.ets';
      fs.mkdirSync(path.join(projectRoot, 'test', 'ledger'), { recursive: true });
      fs.writeFileSync(path.join(projectRoot, implRef), 'export const thinFeature = true;\n', 'utf8');
      fs.writeFileSync(path.join(projectRoot, testRef), 'export const thinFeatureTest = true;\n', 'utf8');
      const sidecar = {
        change_unit_ref: createChangeUnitRef(accepted.accepted[0]!),
        predicate_mappings: asRecords(unit.target_predicates).map(item => ({
          predicate_id: String(item.predicate_id), implementation_refs: [implRef], test_refs: [testRef],
        })),
        provide_mappings: asRecords(unit.provides).map(item => ({
          provide_id: String(item.provide_id), implementation_refs: [implRef], test_refs: [testRef],
        })),
        design_ref_mappings: (unit.design_refs as unknown as ComponentBlueprintRef[]).map(ref => ({
          design_ref: JSON.parse(JSON.stringify(ref)), implementation_refs: [implRef], verification_refs: [testRef],
        })),
      };
      assert(sidecar.predicate_mappings.length > 0 && sidecar.design_ref_mappings.length > 0, '前提：canonical 集合非空，映射也必须非空');

      // 薄链的 changed 视图正是 runtime，故该 CU 的 runtime flow design_ref 照常欠
      // contracts.state_management —— 运行时施工投影义务不因"薄"而豁免。
      const flowRef = (unit.design_refs as unknown as ComponentBlueprintRef[]).find(ref => ref.target.kind === 'flow')!;
      assert(flowRef, '前提：薄链 CU 应引用 runtime flow');
      const stateManagement = [{
        data: 'ledger', scope: 'component', decorator: 'none', holder: 'LedgerStore', module: 'ledger',
        design_ref: JSON.parse(JSON.stringify(flowRef)),
        owner_ref: 'view:runtime/node:ledger-repository', contract_refs: ['contract:create-entry-v1'],
        ordered_steps: ['persist mutation', 'publish snapshot', 'refresh consumer'],
        lifecycle_triggers: ['process_recreation'],
        failure_recovery: { strategy: 'reload repository snapshot' },
        mutations: [{ mutation_id: 'add-entry', kind: 'user', publication_ref: 'publication:ledger-changed', recovery_ref: 'recovery:reload-ledger' }],
        publications: [{ publication_id: 'ledger-changed' }],
        subscriptions: [{ subscription_id: 'ledger-page-subscription', consumer_ref: 'consumer:ledger-page', publication_ref: 'publication:ledger-changed', replay_or_snapshot: 'latest', cleanup: 'detach observer' }],
        consumers: [{ consumer_id: 'ledger-page', initial_load_ref: 'initial-load:repository-snapshot', update_ref: 'publication:ledger-changed' }],
      }];

      // 反例先行：空映射照抄必然失败（证明"空数组示例"是错的）
      const emptyContracts = { feature: featureId, state_management: stateManagement, change_unit: { ...sidecar, predicate_mappings: [], provide_mappings: [], design_ref_mappings: [] } };
      const emptyResult = validateChangeUnitFeatureProjection(
        projectRoot, featureId, emptyContracts as unknown as ContractsSpec, undefined, false, 'change',
      );
      assert(emptyResult.issues.length > 0, '空映射 sidecar 未被抓住 —— change-lite 示例若照抄空数组会假绿');

      // 正例：非空 1:1 映射通过（lite 轨的 change 阶段即校验）
      const contracts = { feature: featureId, state_management: stateManagement, change_unit: sidecar };
      const projected = validateChangeUnitFeatureProjection(
        projectRoot, featureId, contracts as unknown as ContractsSpec, undefined, true, 'change',
      );
      assert(projected.applicable, 'CU sidecar 未被判为适用');
      assert(projected.issues.length === 0, `薄链 CU sidecar 被误拒：${projected.issues.map(i => `${i.id}:${i.message}`).join(' | ')}`);

      // ⑥ 把非空 sidecar **写进真实 contracts.yaml** 并形成 completion/evidence。
      //    复用既有 closure 套件的现场装配（configureFeature 写同形 sidecar + use-cases，
      //    writeTrustedEvidenceChain 形成 VALID completion），不另造第二套夹具。
      const thinFeatureDir = path.join(workspaceDir(projectRoot), 'thin-solo-cu');
      fs.writeFileSync(
        path.join(thinFeatureDir, 'contracts.yaml'),
        contractsTemplate.replace(/^feature: .*$/m, `feature: ${featureId}`),
        'utf8',
      );
      prepareCompleteProject(projectRoot);

      // 薄化在 prepareCompleteProject 重写蓝图后仍然成立
      const afterPrepare = checkCanonicalComponentBlueprint(projectRoot, BLUEPRINT_ID);
      assert(
        afterPrepare.issues.filter(item => item.severity === 'BLOCKER').length === 0,
        `装配后薄蓝图失效：${afterPrepare.issues.map(item => item.id).join(', ')}`,
      );
      assert(
        asRecords(afterPrepare.blueprint.design_views).filter(isChangedView).map(v => String(v.view_id)).join(',') === 'runtime',
        '装配后薄化被冲掉（应仍只有 runtime 为 changed）',
      );

      // ⑦ sidecar 被正式消费：binding 变为 matched，且落盘映射非空
      const binding = inspectDerivedFeatureBinding(projectRoot, BLUEPRINT_ID, 'thin-solo-cu', 'ledger');
      assert(binding.status === 'matched', `CU sidecar 未被正式绑定：status=${binding.status}`);
      const onDisk = YAML.parse(fs.readFileSync(featureFilePath(projectRoot, featureId, 'contracts.yaml'), 'utf8')) as BlueprintRecord;
      const onDiskSection = asRecord(onDisk.change_unit)!;
      assert(
        asRecords(onDiskSection.predicate_mappings).length > 0
          && asRecords(onDiskSection.design_ref_mappings).length > 0,
        '落盘 sidecar 的映射为空 —— 未真正消费 canonical 集合',
      );

      // ⑧ 走到真实 P3：单 CU 退化 closure
      const closure = evaluateComponentClosure(projectRoot, BLUEPRINT_ID, {
        evaluatedAt: '2026-08-20T12:00:00+08:00',
        observeCompletion: (_root, cu) => ({
          state: 'VALID',
          featureId: deriveChangeUnitFeatureId(cu.blueprint_id, cu.change_unit_id),
          expectedTrack: 'default',
          expectedChain: ['ut', 'testing'],
          reasons: [],
        }),
      });
      assert(closure.closure.inputs.change_units.length === 1, `薄链应只有 1 个 CU，实际 ${closure.closure.inputs.change_units.length}`);
      const blockers = closure.issues.filter(item => item.severity === 'BLOCKER');
      assert(blockers.length === 0, `薄链单 CU closure 未通过：${blockers.map(i => `${i.id}@${i.path}`).join(', ')}`);
      assert(
        !closure.issues.some(item => item.id === 'component_closure_dependency_assembly_unverified'),
        '空跨单元组装边被误判为缺组合证据',
      );
      assert(
        ['PASS', 'PASS_WITH_DEGRADATION'].includes(String(closure.closure.verdict)),
        `薄链 closure verdict 不成立：${closure.closure.verdict}`,
      );
      // 追溯链成行：需求 → 蓝图地址 → design_refs → completion 证据
      const rows = closure.closure.coverage_rows;
      assert(rows.some(row => row.kind.startsWith('source_')), '缺“需求 → 蓝图地址”追溯行');
      // 蓝图稳定地址 → CU design_refs：该 CU 因 design_refs 成为某个蓝图地址的 owner
      assert(
        rows.some(row => row.blueprint_refs.length > 0 && row.owner_change_unit_ids.includes('thin-solo-cu')),
        `缺“蓝图地址 → CU design_refs”覆盖行；实际 kinds=${[...new Set(rows.map(r => r.kind))].join(',')}`,
      );
      assert(
        rows.some(row => row.owner_change_unit_ids.includes('thin-solo-cu') && row.evidence_identities.length > 0),
        '缺“CU → completion 证据”绑定行',
      );
      assert(
        rows.every(row => row.owner_change_unit_ids.every(id => id === 'thin-solo-cu')),
        '出现了不属于唯一 CU 的 owner',
      );    });
  }));

  // -------------------------------------------------------------------------
  // 多 CU 正式需求：条件式设计义务真的触发
  // -------------------------------------------------------------------------
  results.push(test('M7 t5: multi-CU formal requirement triggers the conditional design obligations', () => {
    withProject(projectRoot => {
      const units = enumerateCanonicalChangeUnits(projectRoot, BLUEPRINT_ID).map(loaded => loaded.changeUnit);
      assert(units.length >= 3, `前提：多 CU 现场，实际 ${units.length}`);

      // 义务①：CU 边界与关系分析——requires 是**真实依赖边**，能被精确 provide 满足
      const edges = units.flatMap(unit => asRecords(unit.requires).map(requirement => ({
        from: String(unit.change_unit_id),
        to: String(requirement.from_change_unit_id),
        provide: String(requirement.provide_id),
      })));
      assert(edges.length > 0, '多 CU 现场没有任何依赖边——边界与关系分析义务无从检验');
      for (const edge of edges) {
        const provider = units.find(unit => String(unit.change_unit_id) === edge.to);
        assert(provider, `依赖边指向不存在的 CU：${edge.from} → ${edge.to}`);
        assert(
          asRecords(provider!.provides).some(item => String(item.provide_id) === edge.provide),
          `依赖边 ${edge.from} → ${edge.to} 的 provide_id=${edge.provide} 在提供方不存在（伪造依赖边）`,
        );
      }
      // 反例：伪造一条指向不存在 provide 的依赖边 → 依赖分析必须抓住
      const forged = JSON.parse(JSON.stringify(units[0])) as Record<string, unknown>;
      forged.requires = [{ require_id: 'forged', from_change_unit_id: String(units[1]!.change_unit_id), provide_id: 'not-a-real-provide' }];
      const forgedIssues = evaluateChangeUnitDependencies(
        forged as never,
        units as never,
        new Map(),
        new Map(),
      ).issues;
      assert(forgedIssues.length > 0, '伪造的依赖边未被依赖分析抓住');

      // 义务②：共享部件级设计决策**只在蓝图裁决一次**，各 CU 经 design_refs 消费
      const decisionConsumers = new Map<string, string[]>();
      for (const unit of units) {
        for (const ref of unit.design_refs as unknown as ComponentBlueprintRef[]) {
          if (ref.target.kind !== 'decision') continue;
          const address = blueprintRefAddress(ref);
          decisionConsumers.set(address, [...(decisionConsumers.get(address) ?? []), String(unit.change_unit_id)]);
        }
      }
      const shared = [...decisionConsumers.entries()].filter(([, consumers]) => consumers.length > 1);
      assert(shared.length > 0, `没有被多个 CU 共享消费的部件级决策：${JSON.stringify([...decisionConsumers])}`);
      // 该决策只在蓝图裁决一次——蓝图内 decision_id 唯一
      const blueprint = loadCanonicalBlueprint(projectRoot, BLUEPRINT_ID).blueprint;
      const decisions = asRecords(asRecord(blueprint.decisions_and_gaps)?.decisions);
      for (const [address] of shared) {
        const decisionId = address.replace(/^decision:/, '');
        const matches = decisions.filter(item => String(item.decision_id) === decisionId);
        assert(matches.length === 1, `共享决策 ${decisionId} 在蓝图内出现 ${matches.length} 次，应只裁决一次`);
      }

      // 义务③：组合闭环——存在跨 CU 的依赖关系，故"单独绿 ≠ 整体完成"义务成立
      const crossUnitProviders = new Set(edges.map(edge => edge.to));
      assert(crossUnitProviders.size > 0, '不存在跨 CU 依赖，组合闭环义务无从触发');

      // 义务④：安全中间态是**单/多 CU 通用**义务——每个 CU 都必须有
      for (const unit of units) {
        assert(asRecord(unit.safe_intermediate_state), `CU ${String(unit.change_unit_id)} 缺 safe_intermediate_state（通用义务）`);
      }
    });
  }));

  // -------------------------------------------------------------------------
  // 完整设计交付 vs 合法蓝图：分层验收
  // -------------------------------------------------------------------------
  results.push(test('M7 t5: a legal blueprint is not yet a complete design handoff', () => {
    withProject(projectRoot => {
      emptyWorkspace(projectRoot);
      // 合法蓝图：0 CU 也 PASS
      assert(
        checkCanonicalComponentBlueprint(projectRoot, BLUEPRINT_ID).issues
          .filter(item => item.severity === 'BLOCKER').length === 0,
        '蓝图合法性错误地依赖了 CU 数量',
      );
      // 完整设计交付：0 CU 时未完成
      const readiness = deriveDesignPreparationReadiness(projectRoot, BLUEPRINT_ID);
      assert(!readiness.ready, '0 CU 时不应宣称设计交付完成');
      assert(readiness.nextEntry === 'component-design', `未完成时下一步应回设计入口：${readiness.nextEntry}`);
      // 推进决策把它路由到设计准备段，而不是当作故障
      const decision = deriveChangeUnitProgressionDecision(
        deriveChangeUnitReadySet(projectRoot, BLUEPRINT_ID),
        { active: [], corrupt: [] },
      );
      assert(decision.action === 'design_preparation_required', `0-CU 路由错误：${decision.action}`);
      assertStoppedAtHandoff(projectRoot);
    });
  }));

  // -------------------------------------------------------------------------
  // 反向：非法候选不得成为设计交付
  // -------------------------------------------------------------------------
  results.push(test('M7 t5: an unconstructable candidate cannot become a design handoff', () => {
    withProject(projectRoot => {
      const candidate = candidateFrom(projectRoot, 'ledger-refresh', 'broken-cu');
      emptyWorkspace(projectRoot);
      (candidate.artifact.design_refs as unknown as ComponentBlueprintRef[])[0].target.id = 'not-real';
      let code = '';
      try {
        acceptChangeUnitDecomposition(projectRoot, BLUEPRINT_ID, [candidate]);
      } catch (error) {
        code = (error as ChangeUnitDecompositionRejected).code;
      }
      assert(code === 'change_unit_candidate_design_rejected', `设计闭包破损的候选未被拒绝：${code}`);
      assert(enumerateCanonicalChangeUnits(projectRoot, BLUEPRINT_ID).length === 0, '被拒候选落盘了');
      assert(!deriveDesignPreparationReadiness(projectRoot, BLUEPRINT_ID).ready, '被拒后不得宣称交付完成');
    });
  }));

  // -------------------------------------------------------------------------
  // 入口在三方物化面一致（skills index / bridge / commands）
  // -------------------------------------------------------------------------
  results.push(test('M7 t5: /component-design resolves through the existing skills index SSOT', () => {
    clearSkillsIndexCache();
    const resolved = resolveSkillPath(FRAMEWORK_ROOT, 'component-design');
    assert(
      fs.existsSync(path.join(FRAMEWORK_ROOT, 'skills', 'project', 'component-design', 'SKILL.md')),
      'component-design SKILL 缺失',
    );
    assert(resolved.skillMdRepoRel.endsWith('skills/project/component-design/SKILL.md'), resolved.skillMdRepoRel);
    assert(
      fs.existsSync(path.join(FRAMEWORK_ROOT, 'agents/shared/agent-bundle/templates/skills-bridge/component-design/SKILL.md')),
      'component-design skills-bridge 跳板缺失',
    );
    for (const adapter of ['claude', 'codeagent', 'cursor']) {
      assert(
        fs.existsSync(path.join(FRAMEWORK_ROOT, 'agents', adapter, 'templates', 'commands', 'component-design.md')),
        `${adapter} 缺 /component-design slash 路由`,
      );
    }
  }));

  // -------------------------------------------------------------------------
  // 适配自足性走查：仅凭发布件即可实现三条接缝 adapter
  // -------------------------------------------------------------------------
  results.push(test('M7 t5: the three seam adapters are implementable from the release artifact alone', () => {
    // 走查口径：宿主开发者只读发布件（docs/ + harness/schemas/ + harness/scripts/ + skills/），
    // 不读 Maison 的 .cursor/、openspec/ 或模拟钱包源码。逐项确认所需材料都在包内。
    const guide = fs.readFileSync(path.join(FRAMEWORK_ROOT, 'docs/operations/component-design-host-adaptation.md'), 'utf8');

    // ① 方向、触发时点、生产者、消费者、required/optional
    for (const needle of [
      'requirement-source-materialization', 'blueprint-review-publication', 'blueprint-review-feedback',
      '宿主 → Maison', 'Maison → 宿主', 'required', 'optional',
      '生产者', '消费者', '触发时点',
    ]) {
      assert(guide.includes(needle), `交接指南缺"${needle}"，宿主无法独立判断接缝语义`);
    }
    // ② 两条最小接入流程 + Story 扩展职责映射 + 零新事实 + 授权反馈产生新 revision
    for (const needle of [
      '单 CU 正式需求', '多 CU 正式需求', 'Story 类扩展的职责映射',
      '零新事实', '新** revision', '适配检查清单', '验证命令速查', '常见错误',
    ]) {
      assert(guide.includes(needle), `交接指南缺"${needle}"`);
    }
    // ③ 明确不关心内网实现
    assert(
      guide.includes('不涉及任何内网敏感实现') && guide.includes('token'),
      '交接指南未明确 Maison 不关心内网标识/token/URL/归档接口',
    );
    // ④ 契约与校验入口确实在发布件内可读
    for (const rel of [
      'harness/schemas/requirement-source-materialization.schema.json',
      'harness/schemas/blueprint-review-feedback.schema.json',
      'harness/schemas/app-component-blueprint.schema.json',
      'harness/scripts/check-component-blueprint.ts',
      'harness/scripts/utils/blueprint-host-seams.ts',
      'harness/scripts/utils/blueprint-review-projection.ts',
      'skills/project/component-design/SKILL.md',
    ]) {
      assert(fs.existsSync(path.join(FRAMEWORK_ROOT, rel)), `发布件内缺 ${rel}`);
    }
    // ⑤ 样例与校验命令齐备
    for (const sample of [
      'requirement-source-materialization.valid.json', 'requirement-source-materialization.invalid-hash.json',
      'blueprint-review-projection.valid.md', 'blueprint-review-projection.invalid-added-fact.md',
      'blueprint-review-feedback.valid.json', 'blueprint-review-feedback.invalid-authority.json',
    ]) {
      assert(fs.existsSync(path.join(SAMPLES_DIR, sample)), `随包样例缺 ${sample}`);
    }
    for (const flag of ['--materialization', '--projection', '--feedback']) {
      assert(guide.includes(flag), `交接指南缺校验入口 ${flag}`);
    }
    // ⑥ 反向：指南不得把宿主指向 dev-only 目录或模拟钱包源码
    for (const offLimits of ['.cursor/', 'openspec/', 'SimulatedWalletForHmos']) {
      assert(!guide.includes(offLimits), `交接指南把宿主指向了发布件之外的 ${offLimits}`);
    }
  }));

  // b2d7f4e9 §3.3：蓝图升版后 CU 指针原位升版（契约不变即同一 CU）
  results.push(test('b2d7 reconcile: blueprint bump re-points every CU in place, contract untouched, idempotent', () => {
    withProject(projectRoot => {
      const beforeUnits = new Map(enumerateCanonicalChangeUnits(projectRoot, BLUEPRINT_ID)
        .map(loaded => [String(loaded.changeUnit.change_unit_id), loaded.changeUnit]));
      const current = bumpBlueprint(projectRoot);
      const readiness = deriveDesignPreparationReadiness(projectRoot, BLUEPRINT_ID);
      assert(readiness.blueprintRefs.skipped.length === 0, `不应跳过：${JSON.stringify(readiness.blueprintRefs.skipped)}`);
      assert(readiness.blueprintRefs.bumped.map(item => item.change_unit_id).join(',') === [...beforeUnits.keys()].join(','),
        `应升版全部 CU：${JSON.stringify(readiness.blueprintRefs.bumped)}`);
      for (const [id, before] of beforeUnits) {
        const loaded = loadCanonicalChangeUnit(projectRoot, BLUEPRINT_ID, id);
        const after = loaded.changeUnit;
        assert(after.change_unit_id === id && after.revision === Number(before.revision) + 1, `${id} 身份/revision 错：${after.revision}`);
        for (const ref of identityPointers(after)) {
          assert(ref.revision === current.revision && ref.source_fingerprint === current.source_fingerprint
            && ref.artifact_sha256 === current.artifact_sha256, `${id} 有指针未指向当前蓝图：${JSON.stringify(ref)}`);
        }
        assert(JSON.stringify(withoutIdentity(after)) === JSON.stringify(withoutIdentity(before)), `${id} 契约字段被改写`);
        resolveChangeUnitRef(projectRoot, createChangeUnitRef(loaded));
      }
      assert(readiness.ready, `升版后 readiness 应就绪：${JSON.stringify(readiness.perUnit)}`);
      const bytes = unitBytes(projectRoot);
      const again = reconcileChangeUnitBlueprintRefs(projectRoot, BLUEPRINT_ID);
      assert(again.bumped.length === 0 && again.skipped.length === 0, `非幂等：${JSON.stringify(again)}`);
      assert(unitBytes(projectRoot) === bytes, '再跑一次改写了 CU 字节');
    });
  }));

  // codex r2 P1：B 已在当前蓝图、精确 supersedes 仍绑旧蓝图的 A → A 不升版（superseded_by_unbumped），
  // 且作为合法退役 CU 不再要求可施工、不计入推进；B 的引用不精确时 A 仍是活动 CU，照旧阻断。
  for (const [label, brokenA, exact] of [
    ['retired A (consistent pointers, pinned) is outside the active set', false, true],
    ['retired A (contract-changed pointers, not constructable) is outside the active set', true, true],
    ['an inexact supersedes leaves A active and still blocks readiness', true, false],
  ] as const) {
    results.push(test(`b2d7 active set: ${label}`, () => {
      withProject(projectRoot => {
        const fileOf = (id: string) => loadCanonicalChangeUnit(projectRoot, BLUEPRINT_ID, id).canonicalPath;
        if (brokenA) {
          const a = YAML.parse(fs.readFileSync(fileOf('ledger-summary'), 'utf8'));
          a.design_refs[0].artifact_sha256 = 'sha256:' + '1'.repeat(64);
          fs.writeFileSync(fileOf('ledger-summary'), YAML.stringify(a));
        }
        const current = bumpBlueprint(projectRoot);
        const b = YAML.parse(fs.readFileSync(fileOf('ledger-consumer'), 'utf8'));
        for (const ref of identityPointers(b)) Object.assign(ref, current);
        b.revision = Number(b.revision) + 1;
        b.supersedes = createChangeUnitRef(loadCanonicalChangeUnit(projectRoot, BLUEPRINT_ID, 'ledger-summary'));
        if (!exact) b.supersedes.artifact_sha256 = 'sha256:' + '2'.repeat(64);
        fs.writeFileSync(fileOf('ledger-consumer'), YAML.stringify(b));
        const readiness = deriveDesignPreparationReadiness(projectRoot, BLUEPRINT_ID);
        assert(readiness.blueprintRefs.skipped.some(item => item.change_unit_id === 'ledger-summary'), `前提：A 不升版：${JSON.stringify(readiness.blueprintRefs)}`);
        assert(asRecord(loadCanonicalChangeUnit(projectRoot, BLUEPRINT_ID, 'ledger-summary').changeUnit.component_blueprint_ref)?.revision !== current.revision, '前提：A 仍绑旧蓝图');
        const inReadySet = deriveChangeUnitReadySet(projectRoot, BLUEPRINT_ID).units.some(unit => unit.changeUnit.change_unit_id === 'ledger-summary');
        if (exact) {
          assert(readiness.ready && readiness.nextEntry === 'change-unit-progression', `合法退役的 A 仍阻断设计交接：${JSON.stringify(readiness.perUnit)}`);
          assert(!readiness.changeUnitIds.includes('ledger-summary'), '退役 A 仍在活动集合');
          assert(!inReadySet, '退役 A 仍进推进（ready / allCompleted）');
          // closure 侧「A 仍记为 retired」在 component-closure 套件断言（本夹具无 framework 树，跑不了完整 closure 输入）。
        } else {
          assert(!readiness.ready && readiness.perUnit.some(unit => unit.changeUnitId === 'ledger-summary' && unit.verdict !== 'constructable'),
            `非法引用下 A 应仍是活动 CU 且阻断：${JSON.stringify(readiness.perUnit)}`);
          assert(inReadySet, '非法引用下 A 被逐出推进');
        }
      });
    }));
  }

  results.push(test('b2d7 reconcile ★4: an in-place contract change is not a pointer bump and still needs a new id', () => {
    withProject(projectRoot => {
      const current = bumpBlueprint(projectRoot);
      const file = loadCanonicalChangeUnit(projectRoot, BLUEPRINT_ID, 'ledger-refresh').canonicalPath;
      const edited = YAML.parse(fs.readFileSync(file, 'utf8'));
      const newTarget = JSON.parse(JSON.stringify(edited.design_refs[0]));
      Object.assign(newTarget, current);
      edited.touches.push({ owner: 'ledger-extra-team', design_ref: newTarget, write_refs: ['planned:src/ledger-extra'] });
      fs.writeFileSync(file, YAML.stringify(edited));
      const before = fs.readFileSync(file);
      const result = reconcileChangeUnitBlueprintRefs(projectRoot, BLUEPRINT_ID);
      assert(!result.bumped.some(item => item.change_unit_id === 'ledger-refresh'), '契约变化被当成指针升版');
      const skipped = result.skipped.find(item => item.change_unit_id === 'ledger-refresh');
      assert(skipped?.reasons.some(reason => reason.includes('blueprint_ref_identity_inconsistent')), JSON.stringify(result.skipped));
      assert(fs.readFileSync(file).equals(before), 'reconcile 改写了契约变化的 CU');
      const candidate = { providerId: 'builtin-vertical-slice-decomposition', artifact: asChangeUnitArtifact(edited) };
      candidate.artifact.provenance.extraction_method = 'builtin-vertical-slice-decomposition';
      let code = '';
      let message = '';
      try { acceptChangeUnitDecomposition(projectRoot, BLUEPRINT_ID, [candidate]); }
      catch (error) { code = (error as ChangeUnitDecompositionRejected).code; message = (error as Error).message; }
      assert(code === 'change_unit_candidate_already_exists' && message.includes('supersedes'), `同路径再接受未要求新 id：${code} ${message}`);
    });
  }));

  results.push(test('b2d7 reconcile ★5: a removed design_ref target fails carry-forward, no bump, bytes untouched', () => {
    withProject(projectRoot => {
      bumpBlueprint(projectRoot, bp => {
        const drop = (value: unknown): unknown => Array.isArray(value)
          ? value.filter(item => asRecord(item)?.relation_id !== 'domain-owned-by-module'
            && asRecord(item)?.question_id !== 'q-relation-domain-module').map(drop)
          : asRecord(value) ? Object.fromEntries(Object.entries(value as object).map(([key, item]) => [key, drop(item)])) : value;
        Object.assign(bp, drop(bp));
      });
      const bytes = unitBytes(projectRoot);
      const result = deriveDesignPreparationReadiness(projectRoot, BLUEPRINT_ID).blueprintRefs;
      assert(result.bumped.length === 0, `carry-forward 失败仍升版：${JSON.stringify(result.bumped)}`);
      const refresh = result.skipped.find(item => item.change_unit_id === 'ledger-refresh');
      assert(refresh?.reasons.some(reason => reason.includes('relation:domain-owned-by-module') && reason.includes('不可解析')),
        `skipped 未带 carry-forward 原因：${JSON.stringify(result.skipped)}`);
      assert(unitBytes(projectRoot) === bytes, 'carry-forward 失败时改写了 CU 字节');
    });
  }));

  results.push(test('b2d7 reconcile: one bump candidate failing canonical validation writes nothing for the whole batch', () => {
    withProject(projectRoot => {
      const file = loadCanonicalChangeUnit(projectRoot, BLUEPRINT_ID, 'ledger-summary').canonicalPath;
      const broken = YAML.parse(fs.readFileSync(file, 'utf8'));
      broken.purpose = '';
      fs.writeFileSync(file, YAML.stringify(broken));
      bumpBlueprint(projectRoot);
      const bytes = unitBytes(projectRoot);
      let code = '';
      try { reconcileChangeUnitBlueprintRefs(projectRoot, BLUEPRINT_ID); }
      catch (error) { code = (error as ChangeUnitDecompositionRejected).code; }
      assert(code === 'change_unit_blueprint_ref_bump_rejected', `校验失败未整批拒绝：${code}`);
      assert(unitBytes(projectRoot) === bytes, '整批拒绝后仍有 CU 落盘');
    });
  }));

  // b2d7f4e9 t2c：CU 派生 feature 目录里的旧机器投影随指针升版同批刷新（快照 = 上一版宿主产物，ledger-refresh 有三份机器投影）
  // t2d：来源戳全部指向升版前身份即刷新，不做内容核对——
  //  · 蓝图升版改了会进投影的内容（宿主事故形状）→ 刷新为新内容；
  //  · 保戳手改：该状态在旧蓝图下已被投影门（use-cases 冲突判定）拒绝、任何 run 起不来，是非法态，用新投影覆盖即修复。
  for (const [label, prepare] of [
    ['identity-only bump', undefined],
    ['a bump that changes projected blueprint content (ledger-domain acceptance expected_result)', undefined],
    ['a hand edit under the original stamp (illegal state, repaired)', (root: string) => {
      const file = featureFilePath(root, SNAPSHOT_CU_FEATURE, 'use-cases.yaml');
      const doc = YAML.parse(fs.readFileSync(file, 'utf8')) as BlueprintRecord;
      (asRecords(doc.use_cases)[0]!).coordinator = 'HandEdited.add';
      fs.writeFileSync(file, YAML.stringify(doc));
    }],
  ] as const) {
  results.push(test(`b2d7 t2c refresh: ${label} → machine projections re-derived in the same batch, other feature files untouched`, () => {
    withSnapshotProject(({ root, frameworkRoot }) => {
      prepare?.(root);
      const contentChange = label.startsWith('a bump that changes');
      const other = snapshotFeatureBytes(root, ['feature.yaml', 'feature-completion.json', 'next.json']);
      const before = snapshotFeatureBytes(root, PROJECTIONS);
      const current = bumpBlueprint(root, contentChange ? bp => {
        const node = findRecord(bp, record => record.node_id === 'ledger-domain' && !!asRecord(record.acceptance));
        asRecords(asRecord(node?.acceptance)?.criteria)[0]!.expected_result = 'consumer refreshed and balance survives restart';
      } : undefined);
      const result = reconcileChangeUnitBlueprintRefs(root, BLUEPRINT_ID);
      assert(result.bumped.some(item => item.change_unit_id === 'ledger-refresh') && result.skipped.length === 0, JSON.stringify(result));
      const after = snapshotFeatureBytes(root, PROJECTIONS);
      for (const name of PROJECTIONS) assert(after[name] !== before[name], `${name} 未刷新`);
      const loaded = loadCanonicalChangeUnit(root, BLUEPRINT_ID, 'ledger-refresh');
      resolveChangeUnitRef(root, createChangeUnitRef(loaded));
      const acceptance = deriveBlueprintSkillInput(root, SNAPSHOT_CU_FEATURE, frameworkRoot, 'acceptance');
      const contracts = deriveBlueprintSkillInput(root, SNAPSHOT_CU_FEATURE, frameworkRoot, 'contracts');
      assert(acceptance.state === 'resolved' && contracts.state === 'resolved', `投影门仍拒绝：${acceptance.detail ?? ''} ${contracts.detail ?? ''}`);
      const onDisk = (name: string): unknown => YAML.parse(after[name]);
      assert(JSON.stringify(onDisk('acceptance.yaml')) === JSON.stringify(JSON.parse(JSON.stringify(acceptance.value))), 'acceptance.yaml ≠ 新投影');
      assert(JSON.stringify(onDisk('contracts.yaml')) === JSON.stringify(JSON.parse(JSON.stringify(contracts.value))), 'contracts.yaml ≠ 新投影');
      assert(JSON.stringify(onDisk('use-cases.yaml')) === JSON.stringify(JSON.parse(JSON.stringify(contracts.artifacts!['use-cases@1']))), 'use-cases.yaml ≠ 新投影');
      if (contentChange) {
        const criteria = asRecords((onDisk('acceptance.yaml') as BlueprintRecord).criteria);
        assert(criteria[0]?.expected_result === 'consumer refreshed and balance survives restart', 'acceptance 未刷新为新蓝图内容');
      }
      if (prepare) assert((asRecords((onDisk('use-cases.yaml') as BlueprintRecord).use_cases)[0]!).coordinator !== 'HandEdited.add', '保戳手改的非法态未被修复');
      const useCases = onDisk('use-cases.yaml') as BlueprintRecord;
      assert(useCases.source === `derive.blueprint-contracts:${loaded.artifactSha256}:${current.artifact_sha256}`, `use-cases 来源戳未指向新身份：${String(useCases.source)}`);
      const ref = asRecord(asRecord((onDisk('contracts.yaml') as BlueprintRecord).change_unit)?.change_unit_ref);
      assert(ref?.artifact_sha256 === loaded.artifactSha256, 'contracts change_unit_ref 未指向升版后 CU');
      assert(JSON.stringify(snapshotFeatureBytes(root, ['feature.yaml', 'feature-completion.json', 'next.json'])) === JSON.stringify(other), 'feature 其它文件被改');
      const again = reconcileChangeUnitBlueprintRefs(root, BLUEPRINT_ID);
      assert(again.bumped.length === 0 && again.skipped.length === 0, `非幂等：${JSON.stringify(again)}`);
      assert(JSON.stringify(snapshotFeatureBytes(root, PROJECTIONS)) === JSON.stringify(after), '再跑一次改写了投影');
    });
  }));
  }

  for (const [label, file, tamper] of [
    ['a use-cases.yaml source stamp pointing at another identity', 'use-cases.yaml',
      (doc: BlueprintRecord) => { doc.source = 'derive.blueprint-contracts:sha256:0000:sha256:0000'; }],
    ['a contracts.yaml change_unit_ref pointing at another CU sha', 'contracts.yaml',
      (doc: BlueprintRecord) => { asRecord(asRecord(doc.change_unit)?.change_unit_ref)!.artifact_sha256 = 'sha256:' + '0'.repeat(64); }],
  ] as const) {
    results.push(test(`b2d7 t2c refresh: ${label} → CU skipped, pointer and all projections byte-identical`, () => {
      withSnapshotProject(({ root }) => {
        const target = featureFilePath(root, SNAPSHOT_CU_FEATURE, file);
        const doc = YAML.parse(fs.readFileSync(target, 'utf8')) as BlueprintRecord;
        tamper(doc);
        fs.writeFileSync(target, YAML.stringify(doc));
        bumpBlueprint(root);
        const cuFile = loadCanonicalChangeUnit(root, BLUEPRINT_ID, 'ledger-refresh').canonicalPath;
        const watched = [cuFile, ...[...PROJECTIONS, 'feature.yaml'].map(name => featureFilePath(root, SNAPSHOT_CU_FEATURE, name))];
        const bytes = watched.map(item => fs.readFileSync(item));
        const result = reconcileChangeUnitBlueprintRefs(root, BLUEPRINT_ID);
        assert(!result.bumped.some(item => item.change_unit_id === 'ledger-refresh'), '戳不指向升版前身份仍升版');
        const skipped = result.skipped.find(item => item.change_unit_id === 'ledger-refresh');
        assert(skipped?.reasons[0].startsWith('derived_projection_not_machine_owned') && skipped.reasons[0].includes(file), JSON.stringify(result.skipped));
        watched.forEach((item, index) => assert(fs.readFileSync(item).equals(bytes[index]!), `${path.basename(item)} 被改写`));
      });
    }));
  }

  results.push(test('b2d7 t2c refresh atomicity: a mid-write failure rolls back the whole batch', () => {
    withSnapshotProject(({ root }) => {
      // ② 写到第三份时失败（写出顺序 acceptance → contracts → use-cases；use-cases.yaml 只读）
      //    → 已写的 acceptance/contracts 与整批 CU 指针全部回滚
      bumpBlueprint(root);
      const bytes = unitBytes(root);
      const projections = snapshotFeatureBytes(root, PROJECTIONS);
      const lastFile = featureFilePath(root, SNAPSHOT_CU_FEATURE, 'use-cases.yaml');
      fs.chmodSync(lastFile, 0o444);
      let code = '';
      try { reconcileChangeUnitBlueprintRefs(root, BLUEPRINT_ID); }
      catch (error) { code = (error as ChangeUnitDecompositionRejected).code; }
      finally { fs.chmodSync(lastFile, 0o666); }
      assert(code === 'change_unit_blueprint_ref_bump_rejected', `写出失败未整批拒绝：${code}`);
      assert(unitBytes(root) === bytes, '整批拒绝后仍有 CU 指针落盘');
      assert(JSON.stringify(snapshotFeatureBytes(root, PROJECTIONS)) === JSON.stringify(projections), '整批拒绝后投影未回滚');
    });
  }));

  results.push(test('b2d7 t2c refresh atomicity: a write that dies half-way leaves the file being written intact', () => {
    withSnapshotProject(({ root }) => {
      // codex r1 P1-1：覆盖写到一半抛错（磁盘满等）——当前那份文件不得留半截字节。桩 = 写入前一半内容后抛错，只触发一次。
      bumpBlueprint(root);
      const bytes = unitBytes(root);
      const projections = snapshotFeatureBytes(root, PROJECTIONS);
      const nodeFs = require('fs') as typeof fs; // eslint-disable-line @typescript-eslint/no-require-imports
      const original = nodeFs.writeFileSync;
      let armed = true;
      nodeFs.writeFileSync = ((file: fs.PathOrFileDescriptor, data: string | NodeJS.ArrayBufferView, options?: fs.WriteFileOptions) => {
        if (armed && typeof file === 'string' && path.basename(file).startsWith('use-cases.yaml')) {
          armed = false;
          original(file, String(data).slice(0, Math.floor(String(data).length / 2)), options);
          throw new Error('ENOSPC: simulated partial write');
        }
        return original(file, data, options);
      }) as typeof fs.writeFileSync;
      let code = '';
      try { reconcileChangeUnitBlueprintRefs(root, BLUEPRINT_ID); }
      catch (error) { code = (error as ChangeUnitDecompositionRejected).code; }
      finally { nodeFs.writeFileSync = original; }
      assert(!armed, '前提：桩未命中 use-cases.yaml 的写出');
      assert(code === 'change_unit_blueprint_ref_bump_rejected', `写出失败未整批拒绝：${code}`);
      assert(unitBytes(root) === bytes, '整批拒绝后仍有 CU 指针落盘');
      assert(JSON.stringify(snapshotFeatureBytes(root, PROJECTIONS)) === JSON.stringify(projections), '写到一半的投影留下损坏字节 / 未回滚');
      const leftovers = fs.readdirSync(path.dirname(featureFilePath(root, SNAPSHOT_CU_FEATURE, 'use-cases.yaml'))).filter(name => name.includes('.tmp-'));
      assert(leftovers.length === 0, `残留临时文件：${leftovers.join(', ')}`);
    });
  }));

  // 宿主形状（2026-09-26 回灌）：三份派生文件由 plan 阶段 agent 手写、无 `derive.blueprint-*` 来源戳，contracts 仍带
  // change_unit_ref + design_ref_mappings。升版不刷新内容（不归投影 writer），只把 contracts 的身份指针随 CU / 蓝图同批原位维护。
  results.push(test('b2d7 host shape: unstamped hand-written contracts whose change_unit_ref is the pre-bump CU → only identity pointers follow the bump, every other byte kept', () => {
    withSnapshotProject(({ root }) => {
      handWriteProjections(root);
      const before = snapshotFeatureBytes(root, PROJECTIONS);
      const current = bumpBlueprint(root);
      const result = reconcileChangeUnitBlueprintRefs(root, BLUEPRINT_ID);
      assert(result.bumped.some(item => item.change_unit_id === 'ledger-refresh') && result.skipped.length === 0, JSON.stringify(result));
      const after = snapshotFeatureBytes(root, PROJECTIONS);
      for (const name of ['acceptance.yaml', 'use-cases.yaml']) assert(after[name] === before[name], `${name} 被改写`);
      // 逐行：行数不变、注释保留，变化行只能是身份字段
      const [oldLines, newLines] = [before['contracts.yaml'].split('\n'), after['contracts.yaml'].split('\n')];
      assert(oldLines.length === newLines.length && newLines[0] === HAND_COMMENT, 'contracts 行结构 / 注释被改');
      const changed = oldLines.flatMap((line, index) => line === newLines[index] ? [] : [newLines[index]!.trim()]);
      assert(changed.length > 0 && changed.every(line => /^(revision|source_fingerprint|artifact_sha256): /.test(line)), `contracts 身份指针未维护或非身份行被改：${JSON.stringify(changed)}`);
      const loaded = loadCanonicalChangeUnit(root, BLUEPRINT_ID, 'ledger-refresh');
      const doc = YAML.parse(after['contracts.yaml']) as BlueprintRecord;
      const ref = asRecord(asRecord(doc.change_unit)?.change_unit_ref);
      assert(JSON.stringify(ref) === JSON.stringify(createChangeUnitRef(loaded)), `change_unit_ref 未跟随升版后 CU：${JSON.stringify(ref)}`);
      resolveChangeUnitRef(root, ref);
      const blueprintRefs: BlueprintRecord[] = [];
      findRecord(doc, record => { if (record.artifact === 'component-blueprint@1') blueprintRefs.push(record); return false; });
      assert(blueprintRefs.length > 0 && blueprintRefs.every(item => item.revision === current.revision && item.artifact_sha256 === current.artifact_sha256 && item.source_fingerprint === current.source_fingerprint),
        'design_ref 身份未跟随升版后蓝图');
      assert(JSON.stringify(contractsWithoutIdentity(doc)) === JSON.stringify(contractsWithoutIdentity(YAML.parse(before['contracts.yaml']))), '去掉身份字段后内容不等');
      const again = reconcileChangeUnitBlueprintRefs(root, BLUEPRINT_ID);
      assert(again.bumped.length === 0 && again.skipped.length === 0 && JSON.stringify(snapshotFeatureBytes(root, PROJECTIONS)) === JSON.stringify(after), `非幂等：${JSON.stringify(again)}`);
    });
  }));

  results.push(test('b2d7 host shape: unstamped contracts whose change_unit_ref names another CU → its pointers are not ours, all three files byte-identical', () => {
    withSnapshotProject(({ root }) => {
      handWriteProjections(root, ref => { ref.change_unit_id = 'ledger-consumer'; });
      const before = snapshotFeatureBytes(root, PROJECTIONS);
      bumpBlueprint(root);
      const result = reconcileChangeUnitBlueprintRefs(root, BLUEPRINT_ID);
      assert(result.bumped.some(item => item.change_unit_id === 'ledger-refresh'), `无戳文件不归本 writer，CU 照常升版：${JSON.stringify(result)}`);
      assert(JSON.stringify(snapshotFeatureBytes(root, PROJECTIONS)) === JSON.stringify(before), 'ref 指向别的 CU 仍被维护');
    });
  }));

  results.push(test('b2d7 host shape atomicity: the hand-written contracts write failing rolls back every CU pointer', () => {
    withSnapshotProject(({ root }) => {
      handWriteProjections(root);
      bumpBlueprint(root);
      const bytes = unitBytes(root);
      const projections = snapshotFeatureBytes(root, PROJECTIONS);
      const contracts = featureFilePath(root, SNAPSHOT_CU_FEATURE, 'contracts.yaml');
      fs.chmodSync(contracts, 0o444);
      let code = '';
      try { reconcileChangeUnitBlueprintRefs(root, BLUEPRINT_ID); }
      catch (error) { code = (error as ChangeUnitDecompositionRejected).code; }
      finally { fs.chmodSync(contracts, 0o666); }
      assert(code === 'change_unit_blueprint_ref_bump_write_failed', `写出失败未整批拒绝：${code}`);
      assert(unitBytes(root) === bytes, '整批拒绝后仍有 CU 指针落盘');
      assert(JSON.stringify(snapshotFeatureBytes(root, PROJECTIONS)) === JSON.stringify(projections), 'contracts 未保持原字节');
    });
  }));

  return results;
}

const HAND_COMMENT = '# plan 阶段手写：沿用 CU 施工映射，补充读侧文件与通知步骤';

/** 宿主形状：去掉三份派生文件的来源戳，contracts 保留 change_unit 映射并补 plan 会写的内容（含一行注释）。 */
export function handWriteProjections(root: string, tamperRef?: (ref: BlueprintRecord) => void): void {
  for (const name of PROJECTIONS) {
    const file = featureFilePath(root, SNAPSHOT_CU_FEATURE, name);
    const doc = YAML.parse(fs.readFileSync(file, 'utf8')) as BlueprintRecord;
    delete doc.source;
    let prefix = '';
    if (name === 'contracts.yaml') {
      (doc.files as string[]).push('src/ledger/LedgerIntakeConsumer.ts');
      (asRecords(doc.state_management)[0]!.ordered_steps as string[]).push('notify observers');
      tamperRef?.(asRecord(asRecord(doc.change_unit)?.change_unit_ref)!);
      prefix = `${HAND_COMMENT}\n`;
    }
    fs.writeFileSync(file, prefix + YAML.stringify(doc));
  }
}

function contractsWithoutIdentity(doc: unknown): unknown {
  return JSON.parse(JSON.stringify(doc), (key, value) => ['revision', 'source_fingerprint', 'artifact_sha256'].includes(key) ? undefined : value);
}

const PROJECTIONS = ['acceptance.yaml', 'contracts.yaml', 'use-cases.yaml'];

function withSnapshotProject(run: (s: { root: string; frameworkRoot: string }) => void): void {
  const snapshot = loadHostSnapshot();
  try { clearFrameworkConfigCache(); run(snapshot); } finally { clearFrameworkConfigCache(); fs.rmSync(snapshot.root, { recursive: true, force: true }); }
}

function findRecord(value: unknown, match: (record: BlueprintRecord) => boolean): BlueprintRecord | undefined {
  if (Array.isArray(value)) { for (const item of value) { const hit = findRecord(item, match); if (hit) return hit; } return undefined; }
  const record = asRecord(value);
  if (!record) return undefined;
  if (match(record)) return record;
  for (const child of Object.values(record)) { const hit = findRecord(child, match); if (hit) return hit; }
  return undefined;
}

function snapshotFeatureBytes(root: string, names: string[]): Record<string, string> {
  return Object.fromEntries(names.map(name => [name, fs.readFileSync(featureFilePath(root, SNAPSHOT_CU_FEATURE, name), 'utf8')]));
}

/** 蓝图升一个 admitted revision（内容可选改动），返回新身份。 */
function bumpBlueprint(projectRoot: string, mutate?: (bp: BlueprintRecord) => void) {
  const file = componentBlueprintPath(projectRoot, BLUEPRINT_ID);
  const bp = YAML.parse(fs.readFileSync(file, 'utf8'));
  bp.revision = Number(bp.revision) + 1;
  for (const result of bp.derived_results ?? []) result.input_revision = bp.revision;
  mutate?.(bp);
  fs.writeFileSync(file, YAML.stringify(bp));
  const loaded = loadCanonicalBlueprint(projectRoot, BLUEPRINT_ID);
  return {
    revision: Number(loaded.blueprint.revision),
    source_fingerprint: String(loaded.blueprint.source_fingerprint),
    artifact_sha256: loaded.artifactSha256,
  };
}

function identityPointers(cu: BlueprintRecord): BlueprintRecord[] {
  return [
    cu.component_blueprint_ref as BlueprintRecord,
    ...(cu.design_refs as BlueprintRecord[]),
    ...(cu.touches as BlueprintRecord[]).map(touch => touch.design_ref as BlueprintRecord),
  ];
}

/** 去掉三处身份字段与 CU revision 后的整份 CU：必须与升版前逐字段相等。 */
function withoutIdentity(cu: BlueprintRecord): BlueprintRecord {
  const copy = JSON.parse(JSON.stringify(cu)) as BlueprintRecord;
  delete copy.revision;
  for (const ref of identityPointers(copy)) {
    delete ref.revision;
    delete ref.source_fingerprint;
    delete ref.artifact_sha256;
  }
  return copy;
}

function unitBytes(projectRoot: string): string {
  return enumerateCanonicalChangeUnits(projectRoot, BLUEPRINT_ID).map(loaded => loaded.bytes.toString('utf8')).join('\n---\n');
}

if (require.main === module) {
  const results = runAll();
  for (const result of results) console.log(`${result.ok ? 'PASS' : 'FAIL'}  ${result.name}${result.ok ? '' : `\n  ${result.error}`}`);
  process.exit(results.every(result => result.ok) ? 0 : 1);
}
