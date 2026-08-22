// ============================================================================
// evolution-workspace-path.unit.test.ts — M5A t4 机械证明主套件（plan e2a7c4b9 §7）
// ============================================================================
// 底座说明（t2 返修验收，codex review）：“用新布局最小合成用例实跑
// resolveChangeUnitRef → enumerateFeatures → closure inputs 三个生产入口零 BLOCKER，
// 并把这个用例留作 t4 证明 11/12 的底座”。
//
// 证明 1/6 在 component-blueprint / component-closure 套件内（见三列表）；
// 证明 8/9/10 与 hooks 黑盒在 evolution-path-governance.unit.test.ts（同批新套件，
// 已注册进 CORE_SUITES）。
//
// 变异原则：靠“改生产代码或输入让它红”，不许为证明造第二套实现。
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as YAML from 'yaml';
import {
  enumerateFeatures,
  encodeFeatureIdFromWorkspace,
  featureDir,
  featureFilePath,
  receiptDirPath,
  resolveFeatureArtifact,
  featurePhaseReportsDir,
} from '../../config';
import {
  resolveChangeUnitRef,
  createChangeUnitRef,
  deriveChangeUnitFeatureId,
  parseChangeUnitFeatureId,
  loadCanonicalChangeUnit,
  enumerateCanonicalChangeUnits,
  asChangeUnitArtifact,
} from '../../scripts/utils/change-unit-path';
import {
  loadCanonicalBlueprint,
} from '../../scripts/utils/component-blueprint-path';
import { resolveComponentClosureInputs } from '../../scripts/utils/component-closure-inputs';
import { featureRelativePath, encodeCuFeatureId } from '../../scripts/utils/feature-identity';
import { evaluateChangeUnitDependencies } from '../../scripts/utils/change-unit-dependencies';
import { evaluateChangeUnitCarryForward } from '../../scripts/utils/change-unit-reconciliation';
import {
  resolveGoalReportDir,
  buildGoalManifestFromInput,
  loadGoalManifestFile,
} from '../../scripts/utils/goal-manifest';
import {
  resolveFeatureLockPath,
  resolveRunnerLockPath,
} from '../../scripts/utils/goal-progress';
import { resolveFactsAbsPath } from '../../scripts/utils/context-facts';
import {
  casAcquireRunOwner,
  releaseRunOwner,
  readRunControl,
} from '../../scripts/utils/goal-run-control';
import { appendGoalEventFenced } from '../../scripts/utils/goal-in-session-evidence';
import { prepareGoalModeRun, runGoalModeHostBridge } from '../../scripts/goal-mode-entry';
import { resolveWorkflowSpec } from '../../workflow-loader';
import { loadEventsJsonl } from '../../scripts/utils/goal-runner-phase';
import checker from '../../scripts/check-catalog';
import type { CheckContext } from '../../scripts/utils/types';
import { SpecLoader } from '../../scripts/utils/spec-loader';
import { scanReceiptPathReconcileCandidates } from '../../scripts/utils/receipt-path-reconcile';
import { writeReceiptScaffold } from '../../scripts/utils/receipt-scaffold';
import { prepareCompleteProject } from './component-closure.unit.test';
import { writeCanonicalComponentClosure, checkCanonicalComponentClosure } from '../../scripts/check-component-closure';
import { componentClosurePath } from '../../scripts/utils/component-closure-path';
import { resolveChangeUnitExpectedExecution, observeChangeUnitCompletion } from '../../scripts/utils/change-unit-completion';
import { generateFeatureCompletion } from '../../scripts/utils/verify-feature-completion';
import { seedCleanCompletionChain } from '../utils/completion-chain-seed';

interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

const FIXTURE_VALID = path.resolve(__dirname, '..', 'fixtures', 'component-blueprint', 'valid');
const BLUEPRINT_ID = 'ledger-app-blueprint';
const SECOND_BLUEPRINT_ID = 'ledger-app-blueprint-v2';
const COMPONENT_ID = 'ledger';
const UNIT_IDS = ['ledger-consumer', 'ledger-recovery', 'ledger-refresh', 'ledger-summary'];

function test(name: string, body: () => void): UnitCaseResult {
  try {
    body();
    return { name, ok: true };
  } catch (error) {
    return { name, ok: false, error: (error as Error).stack ?? (error as Error).message };
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function asyncTest(name: string, body: () => Promise<void>): Promise<UnitCaseResult> {
  try {
    await body();
    return { name, ok: true };
  } catch (error) {
    return { name, ok: false, error: (error as Error).stack ?? (error as Error).message };
  }
}

/** 复制（可含第二工作区）为临时工程；返回 root。 */
function buildWorkspaceProject(opts: { secondWorkspace?: boolean; featuresDir?: string } = {}): string {
  const featuresDir = opts.featuresDir ?? 'doc/features';
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-m5a-workspace-'));
  try {
    const featuresAbs = path.join(temp, featuresDir);
    const wsDir = path.join(featuresAbs, BLUEPRINT_ID);
    const blueprintDir = path.join(wsDir, 'blueprint');
    fs.mkdirSync(blueprintDir, { recursive: true });
    const srcBlueprint = path.join(FIXTURE_VALID, 'doc', 'features', BLUEPRINT_ID, 'blueprint', 'component-blueprint.yaml');
    const srcReview = path.join(FIXTURE_VALID, 'doc', 'features', BLUEPRINT_ID, 'blueprint', 'component-blueprint.review.md');
    fs.copyFileSync(srcBlueprint, path.join(blueprintDir, 'component-blueprint.yaml'));
    fs.copyFileSync(srcReview, path.join(blueprintDir, 'component-blueprint.review.md'));

    for (const unitId of UNIT_IDS) {
      const srcCuDir = path.join(FIXTURE_VALID, 'doc', 'features', BLUEPRINT_ID, unitId);
      const cuDir = path.join(wsDir, unitId);
      fs.mkdirSync(cuDir, { recursive: true });
      if (featuresDir !== 'doc/features') {
        // 模拟真实宿主：custom features_dir 下 provenance.source_ref 跟随 owner 蓝图
        // 实际 canonical 位置（path.relative(projectRoot, canonicalPath) 形态），
        // 而非沿用 fixture 的 doc/features 前缀（validateProvenanceSource 按解析出的
        // canonical path 比对 source_ref，见 change-unit-validator.ts）。
        const cu = YAML.parse(fs.readFileSync(path.join(srcCuDir, 'change-unit.yaml'), 'utf8'));
        cu.provenance = {
          ...cu.provenance,
          source_ref: `${featuresDir}/${BLUEPRINT_ID}/blueprint/component-blueprint.yaml#blueprint:${BLUEPRINT_ID}`,
        };
        fs.writeFileSync(path.join(cuDir, 'change-unit.yaml'), YAML.stringify(cu), 'utf8');
      } else {
        fs.copyFileSync(path.join(srcCuDir, 'change-unit.yaml'), path.join(cuDir, 'change-unit.yaml'));
      }
      fs.copyFileSync(path.join(srcCuDir, 'contracts.yaml'), path.join(cuDir, 'contracts.yaml'));
      fs.mkdirSync(path.join(cuDir, 'spec'), { recursive: true });
      fs.writeFileSync(path.join(cuDir, 'spec', 'spec.md'), '# ' + unitId + '\n\n## Scope 声明\n\n' + '```yaml' + '\nrationale: demo scope\nin_scope_modules: [ledger]\nout_of_scope_modules: []\n' + '```' + '\n', 'utf8');
    }

    // 第二工作区：同 component_id、新 blueprint_id，复制 A 的 4 个 CU 并改写身份字段
    if (opts.secondWorkspace) {
      const wsB = path.join(featuresAbs, SECOND_BLUEPRINT_ID);
      const blueprintBDir = path.join(wsB, 'blueprint');
      fs.mkdirSync(blueprintBDir, { recursive: true });
      const blueprintB = YAML.parse(fs.readFileSync(srcBlueprint, 'utf8'));
      blueprintB.blueprint_id = SECOND_BLUEPRINT_ID;
      blueprintB.revision = Number(blueprintB.revision) + 1;
      fs.writeFileSync(path.join(blueprintBDir, 'component-blueprint.yaml'), YAML.stringify(blueprintB), 'utf8');
      for (const unitId of UNIT_IDS) {
        const srcCuDir = path.join(FIXTURE_VALID, 'doc', 'features', BLUEPRINT_ID, unitId);
        const cuBDir = path.join(wsB, unitId);
        fs.mkdirSync(cuBDir, { recursive: true });
        const cu = YAML.parse(fs.readFileSync(path.join(srcCuDir, 'change-unit.yaml'), 'utf8'));
        cu.blueprint_id = SECOND_BLUEPRINT_ID;
        cu.component_blueprint_ref = {
          ...cu.component_blueprint_ref,
          blueprint_id: SECOND_BLUEPRINT_ID,
          revision: blueprintB.revision,
          target: { kind: 'blueprint', id: SECOND_BLUEPRINT_ID },
        };
        cu.design_refs = (cu.design_refs ?? []).map((ref: Record<string, unknown>) => ({
          ...ref,
          blueprint_id: SECOND_BLUEPRINT_ID,
          target: { ...(ref.target as Record<string, unknown>), id: ref.target && (ref.target as Record<string, unknown>).kind === 'blueprint' ? SECOND_BLUEPRINT_ID : (ref.target as Record<string, unknown>).id },
        }));
        cu.provenance = {
          ...cu.provenance,
          source_ref: `${featuresDir}/${SECOND_BLUEPRINT_ID}/blueprint/component-blueprint.yaml#blueprint:${SECOND_BLUEPRINT_ID}`,
        };
        fs.writeFileSync(path.join(cuBDir, 'change-unit.yaml'), YAML.stringify(cu), 'utf8');
        fs.copyFileSync(path.join(srcCuDir, 'contracts.yaml'), path.join(cuBDir, 'contracts.yaml'));
      }
    }

    // 蓝图 owner 校验所需旁路文件（requirements / mappings / src / test 与 architecture）
    fs.cpSync(path.join(FIXTURE_VALID, 'doc', 'architecture.yaml'), path.join(temp, 'doc', 'architecture.yaml'));
    fs.cpSync(path.join(FIXTURE_VALID, 'doc', 'module-catalog.yaml'), path.join(temp, 'doc', 'module-catalog.yaml'));
    fs.cpSync(path.join(FIXTURE_VALID, 'requirements'), path.join(temp, 'requirements'), { recursive: true });
    fs.cpSync(path.join(FIXTURE_VALID, 'mappings'), path.join(temp, 'mappings'), { recursive: true });
    fs.cpSync(path.join(FIXTURE_VALID, 'contracts'), path.join(temp, 'contracts'), { recursive: true });
    fs.cpSync(path.join(FIXTURE_VALID, 'src'), path.join(temp, 'src'), { recursive: true });
    fs.cpSync(path.join(FIXTURE_VALID, 'test'), path.join(temp, 'test'), { recursive: true });
    fs.mkdirSync(path.join(temp, 'framework', 'skills'), { recursive: true });
    fs.mkdirSync(path.join(temp, 'framework', 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(temp, 'framework', 'skills', '.gitkeep'), '');
    // prepareGoalModeRun 需要真实 workflow spec（loadWorkflowSpec）；投影仓库 workflows/
    //（与 mechanical-loop-closure 套件同口径：MG plan §14.1 偏离 1）
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const repoWorkflows = path.join(repoRoot, 'workflows');
    if (fs.existsSync(repoWorkflows)) {
      fs.cpSync(repoWorkflows, path.join(temp, 'framework', 'workflows'), { recursive: true });
    }
    return temp;
  } catch (error) {
    fs.rmSync(temp, { recursive: true, force: true });
    throw error;
  }
}

/** 完整装配工程：fixture 副本 + workflows 投影 + P3 现场装配（prepareCompleteProject），
 * 供 closure 深化用例（proof 5/7）使用——与 MG 套件 withChainProject 同口径。
 * 注意：prepareCompleteProject 硬编码 doc/features（P3 fixture 装配假设），
 * custom features_dir 场景不套装配（proof 12 走 writeCanonicalComponentClosure 直接验证落点）。 */
function withCompleteProject(
  body: (projectRoot: string) => void,
  options: { customFeaturesDir?: string; mutateProject?: (projectRoot: string) => void } = {},
): void {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-m5a-complete-'));
  try {
    fs.cpSync(FIXTURE_VALID, projectRoot, { recursive: true });
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    fs.cpSync(path.join(repoRoot, 'workflows'), path.join(projectRoot, 'framework', 'workflows'), { recursive: true });
    if (options.customFeaturesDir) {
      // fixture 树挪到 custom features_dir，并写 custom config（CLI/生产入口经 config 解析）
      const src = path.join(projectRoot, 'doc', 'features');
      const dst = path.join(projectRoot, options.customFeaturesDir);
      fs.mkdirSync(dst, { recursive: true });
      fs.cpSync(src, dst, { recursive: true });
      fs.rmSync(src, { recursive: true, force: true });
      // 保留 doc/ 其余文件（architecture.yaml / module-catalog.yaml——knowledge_refs 与
      // catalog 解析依赖它们；只把 features 子树搬走，不删整个 doc/）
      fs.writeFileSync(
        path.join(projectRoot, 'framework.config.json'),
        JSON.stringify({
          schema_version: '1.0',
          project_name: 'complete-custom',
          project_type: 'app',
          agent_adapter: 'claude',
          paths: {
            features_dir: options.customFeaturesDir,
            receipt_dir_pattern: `${options.customFeaturesDir}/<feature>/<phase>`,
            reports_dir_pattern: `${options.customFeaturesDir}/<feature>/<phase>/reports`,
          },
        }, null, 2),
        'utf8',
      );
      // CU provenance.source_ref 跟随新 features_dir（validateProvenanceSource 按 canonical 比对）
      for (const unitId of UNIT_IDS) {
        const p = path.join(dst, BLUEPRINT_ID, unitId, 'change-unit.yaml');
        const cu = YAML.parse(fs.readFileSync(p, 'utf8'));
        cu.provenance = {
          ...cu.provenance,
          source_ref: `${options.customFeaturesDir}/${BLUEPRINT_ID}/blueprint/component-blueprint.yaml#blueprint:${BLUEPRINT_ID}`,
        };
        fs.writeFileSync(p, YAML.stringify(cu), 'utf8');
      }
    }
    // 装配（P3 现场装配：evidence 链 + hash 重绑 + 清 blocker）；unitsDir 已改为
    // features_dir 驱动（component-closure.unit.test.ts），custom 下同样生效
    prepareCompleteProject(projectRoot);
    options.mutateProject?.(projectRoot);
    body(projectRoot);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
}

export async function runAll(): Promise<UnitCaseResult[]> {
  const results: UnitCaseResult[] = [];
  const temp = buildWorkspaceProject();
  try {
    results.push(test('生产入口 1：resolveChangeUnitRef 在新布局下零 BLOCKER 且 binding=matched', () => {
      for (const unitId of UNIT_IDS) {
        const loaded = loadCanonicalChangeUnit(temp, BLUEPRINT_ID, unitId);
        assert(String(loaded.changeUnit.blueprint_id) === BLUEPRINT_ID, `CU 根 blueprint_id 缺失：${unitId}`);
        const ref = createChangeUnitRef(loaded);
        assert(ref.blueprint_id === BLUEPRINT_ID, 'createChangeUnitRef 必须携带 blueprint_id');
        const resolved = resolveChangeUnitRef(temp, ref);
        assert(String(resolved.changeUnit.change_unit_id) === unitId, 'resolveChangeUnitRef 解析错 unit');
      }
    }));

    results.push(test('生产入口 2：enumerateFeatures 只返回 CU Feature 且 featureId↔路径往返恒等（proof 11）', () => {
      const features = enumerateFeatures(temp);
      assert(features.length === UNIT_IDS.length, `应只枚举 ${UNIT_IDS.length} 个 CU Feature，实际 ${features.length}`);
      const byId = new Map(features.map(item => [item.featureId, item]));
      for (const unitId of UNIT_IDS) {
        const featureId = deriveChangeUnitFeatureId(BLUEPRINT_ID, unitId);
        const item = byId.get(featureId);
        assert(item !== undefined, `缺 CU Feature：${featureId}`);
        assert(item!.kind === 'cu', `kind 必须为 cu：${featureId}`);
        assert(item!.relativePath === `${BLUEPRINT_ID}/${unitId}`, `物理相对路径错误：${item!.relativePath}`);
        // 往返 1：featureId→路径逐字节一致
        assert(featureRelativePath(featureId) === item!.relativePath, 'featureId→路径往返不一致');
        // 往返 2：parse(featureId) → (blueprint, unit) 逐字节正确
        const parsed = parseChangeUnitFeatureId(featureId);
        assert(parsed.blueprintId === BLUEPRINT_ID && parsed.changeUnitId === unitId, 'parse(featureId) 身份错误');
        // 往返 3：**从目录重建**（review 三轮）——直接取枚举返回的 relativePath 两个目录段，
        // 经生产侧 encodeFeatureIdFromWorkspace 重建，再 parse 全等（不依赖原 featureId 变量）。
        const relSegs0 = item!.relativePath.split('/');
        assert(relSegs0.length === 2, `relativePath 应为两段：${item!.relativePath}`);
        const rebuiltId = encodeFeatureIdFromWorkspace(relSegs0[0], relSegs0[1]);
        assert(rebuiltId === featureId, `目录段重建 featureId 不一致：${rebuiltId} vs ${featureId}`);
        const rebuiltParsed = parseChangeUnitFeatureId(rebuiltId);
        assert(rebuiltParsed.blueprintId === relSegs0[0] && rebuiltParsed.changeUnitId === relSegs0[1],
          '重建 featureId 再 parse 必须还原目录段');
      }
      // 工作区容器本身不是 Feature
      assert(!byId.has(BLUEPRINT_ID), '工作区容器不得作为 Feature 返回');
      // 枚举点同源（review 三轮）：全部枚举入口必须经同一 SSOT——
      // (a) P2 枚举器 enumerateCanonicalChangeUnits；(b) check-catalog 的枚举循环
      //（用 enumerateFeatures + resolveFeatureArtifact，同 check-catalog.ts 生产写法）；
      // (c) receipt reconcile 的 listReceiptTargets（内部用 enumerateFeatures，经
      // scanReceiptPathReconcileCandidates 间接覆盖——详见 governance proof 8）。
      // 任一入口脱钩 SSOT（如自拼 doc/features/<id>）即红。
      const cuFeatures = enumerateCanonicalChangeUnits(temp, BLUEPRINT_ID)
        .map(u => deriveChangeUnitFeatureId(BLUEPRINT_ID, String(u.changeUnit.change_unit_id)));
      assert(cuFeatures.length === features.length, `枚举点同源数量不一致：${cuFeatures.length} vs ${features.length}`);
      for (const fid of cuFeatures) {
        assert(byId.has(fid), `P2 枚举器产出的 ${fid} 不在共享枚举器结果中（脱钩）`);
      }
      // (b)/(c) check-catalog 与 receipt reconcile 的生产入口同源验证在 proof 11b
      //（真实调用 checker.check / scanReceiptPathReconcileCandidates，见下）。
    }));

    // proof 11b（review 三轮）：枚举点同源 = 直接调用三个生产枚举入口，不复制“同款循环”。
    // (1) SpecLoader.listAvailableFeatures()（spec-loader.ts 生产方法）；
    // (2) check-catalog 生产入口 checker.check(ctx)（其枚举循环若脱钩自拼路径，CU spec.md
    //     命中数为 0 → feature_scope_integrity 返回 SKIP → 断言红）；
    // (3) scanReceiptPathReconcileCandidates()（receipt reconcile 的 listReceiptTargets 内部
    //     用 enumerateFeatures——先经生产 writeReceiptScaffold 落 CU receipt，再扫描取 featureId）。
    results.push(await asyncTest('proof 11b：三个生产枚举入口（SpecLoader/check-catalog/receipt reconcile）与共享枚举同源', async () => {
      const root11b = buildWorkspaceProject();
      try {
        // fixture 的 module-catalog.yaml 缺 name/layer（catalog check 会 BLOCKER）；
        // 覆盖为合法最小形态，使 check 走到 feature_scope_integrity 枚举
        fs.writeFileSync(path.join(root11b, 'doc', 'module-catalog.yaml'),
          'schema_version: "1.0"\nmodules: []\n', 'utf8');
        const shared = new Set(enumerateFeatures(root11b).map(f => f.featureId));
        // (1) SpecLoader.listAvailableFeatures（frameworkRoot=仓库根提供 phase-rules）
        const loader = new SpecLoader(
          root11b,
          undefined,
          path.join(root11b, 'doc', 'features'),
          path.resolve(__dirname, '..', '..', '..'),
        );
        const avail = loader.listAvailableFeatures();
        assert(avail.length === shared.size, `SpecLoader 列举数量与共享枚举不一致：${avail.length} vs ${shared.size}`);
        for (const fid of avail) assert(shared.has(fid), `SpecLoader 产出的 ${fid} 不在共享枚举集（脱钩）`);
        // (2) check-catalog 生产入口
        const phaseRule = loader.loadPhaseRule('catalog');
        const ctx11b: CheckContext = {
          phase: 'catalog',
          feature: '',
          projectRoot: root11b,
          frameworkRoot: path.resolve(__dirname, '..', '..', '..'),
          frameworkRel: 'framework',
          harnessRoot: path.join(root11b, 'framework', 'harness'),
          phaseRule,
          featureSpec: { feature: '' } as CheckContext['featureSpec'],
          resolvedProfile: {
            name: 'generic',
            profileDir: path.join(path.resolve(__dirname, '..', '..', '..'), 'profiles', 'generic'),
            yaml: {} as CheckContext['resolvedProfile']['yaml'],
            phasesDisabled: new Set(),
            capabilities: {},
            personalPrerequisites: {},
          },
        };
        const diagArt = resolveFeatureArtifact(root11b, deriveChangeUnitFeatureId(BLUEPRINT_ID, UNIT_IDS[0]), 'spec.md');
        const catalogResults = await checker.check(ctx11b);
        const scopeCheck = catalogResults.find(r => r.id === 'feature_scope_integrity');
        assert(scopeCheck !== undefined && scopeCheck.status !== 'SKIP',
          `check-catalog 枚举未命中 CU feature（脱钩或断言失败）：${scopeCheck?.status ?? '缺 feature_scope_integrity'} details=${scopeCheck?.details ?? '(无 details)'}`);
        // (3) receipt reconcile：生产 writeReceiptScaffold 落 CU receipt → scan 取 featureId
        const fid0 = deriveChangeUnitFeatureId(BLUEPRINT_ID, UNIT_IDS[0]);
        const scaffold = writeReceiptScaffold(root11b, fid0, 'coding');
        assert(scaffold.wrote === true, `writeReceiptScaffold 未写盘：${scaffold.failure ?? scaffold.receiptPath}`);
        // receipt reconcile 需要 reports_dir_pattern 配置（启用条件）+
        // receipt frontmatter 带 legacy reports rel（reconciler 的 patch 目标）
        fs.writeFileSync(path.join(root11b, 'framework.config.json'), JSON.stringify({
          schema_version: '1.0', project_name: 'p11b', project_type: 'app', agent_adapter: 'claude',
          paths: {
            features_dir: 'doc/features',
            reports_dir_pattern: 'doc/features/<feature>/<phase>/reports',
          },
        }, null, 2), 'utf8');
                // 模拟 agent 完成自证字段（生产 reconciler 的输入：legacy reports rel）——
        // 扫描目标即 applyReceiptPathReconcileCandidate 的候选集，featureId 必须仍来自共享枚举
        // resolveModernReportsRelForLegacyRef 要求 modern 目标存在才产 patch——
        // 先写 modern summary.json 到 CU 报告目录（reconciler 的“迁移后”参照物）
        const modernReportDir = featurePhaseReportsDir(root11b, fid0, 'coding');
        fs.mkdirSync(modernReportDir, { recursive: true });
        fs.writeFileSync(path.join(modernReportDir, 'summary.json'), JSON.stringify({ verdict: 'PASS' }), 'utf8');
        if (scaffold.receiptPath) {
          // frontmatter 结束的 --- 前注入 legacy trace_json.path（reconciler 的 patch 目标）
          const receiptText = fs.readFileSync(scaffold.receiptPath, 'utf8');
          const inject = 'trace_json:\n  path: framework/harness/reports/' + fid0 + '/coding/summary.json\n';
          const marker = '\n---\n';
          const idx = receiptText.indexOf(marker);
          assert(idx > 0, 'receipt frontmatter 结束标记缺失');
          fs.writeFileSync(scaffold.receiptPath,
            receiptText.slice(0, idx) + '\n' + inject + receiptText.slice(idx), 'utf8');
        }
        const candidates = scanReceiptPathReconcileCandidates(root11b);
        assert(candidates.length > 0, 'receipt reconcile 应产出候选（frontmatter legacy rel）');
        const candidateFeatures = [...new Set(candidates.map(c => c.feature))];
        assert(candidateFeatures.includes(fid0),
          `receipt reconcile 枚举未返回 CU feature（脱钩）：${candidateFeatures.join(',') || '(空)'}`);
      } finally {
        fs.rmSync(root11b, { recursive: true, force: true });
      }
    }));

    results.push(test('生产入口 3：resolveComponentClosureInputs 同工作区枚举零 BLOCKER（proof 12 底座）', () => {
      const blueprint = loadCanonicalBlueprint(temp, BLUEPRINT_ID);
      assert(String(blueprint.blueprint.blueprint_id) === BLUEPRINT_ID, 'loader 必须解析 blueprint_id');
      const closure = resolveComponentClosureInputs(temp, BLUEPRINT_ID);
      assert(closure.issues.filter(item => item.severity === 'BLOCKER').length === 0,
        `closure inputs 不应有 BLOCKER：${closure.issues.map(item => item.id).join(', ')}`);
      assert(closure.units.length === UNIT_IDS.length, `closure 输入应含 ${UNIT_IDS.length} 个 CU`);
    }));

    results.push(test('判别 fail-closed：<features_dir> 顶层合法 cu- 编码目录（影子目录）报错（proof 14）', () => {
      const shadowDir = path.join(temp, 'doc', 'features', deriveChangeUnitFeatureId(BLUEPRINT_ID, 'shadow-unit'));
      fs.mkdirSync(shadowDir, { recursive: true });
      fs.writeFileSync(path.join(shadowDir, 'spec.md'), '# shadow\n', 'utf8');
      let threw = false;
      try {
        enumerateFeatures(temp);
      } catch (error) {
        threw = true;
        assert(String((error as Error).message).includes('影子目录'), `应点名影子目录：${(error as Error).message}`);
      }
      assert(threw, '影子目录必须 fail-closed 而非当 legacy 返回');
      fs.rmSync(shadowDir, { recursive: true, force: true });
    }));
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }

  // ---------- t4 追加证明（§7 身份/隔离/兼容条） ----------

  // proof 2：两个工作区相同 change_unit_id，featureId 与物理路径均不冲突
  results.push(test('proof 2：同 change_unit_id 跨工作区 featureId 与物理路径均不冲突', () => {
    const temp2 = buildWorkspaceProject({ secondWorkspace: true });
    try {
      for (const unitId of UNIT_IDS) {
        const idA = deriveChangeUnitFeatureId(BLUEPRINT_ID, unitId);
        const idB = deriveChangeUnitFeatureId(SECOND_BLUEPRINT_ID, unitId);
        assert(idA !== idB, `featureId 撞车：${idA} vs ${idB}`);
        assert(parseChangeUnitFeatureId(idA).blueprintId === BLUEPRINT_ID, 'A featureId 不可逆');
        assert(parseChangeUnitFeatureId(idB).blueprintId === SECOND_BLUEPRINT_ID, 'B featureId 不可逆');
        assert(featureRelativePath(idA) !== featureRelativePath(idB), '物理路径冲突');
        assert(featureRelativePath(idA) === `${BLUEPRINT_ID}/${unitId}`, 'A 物理路径错误');
        assert(featureRelativePath(idB) === `${SECOND_BLUEPRINT_ID}/${unitId}`, 'B 物理路径错误');
        // 各自工作区可独立加载（不串）
        const a = loadCanonicalChangeUnit(temp2, BLUEPRINT_ID, unitId);
        const b = loadCanonicalChangeUnit(temp2, SECOND_BLUEPRINT_ID, unitId);
        assert(String(a.changeUnit.blueprint_id) === BLUEPRINT_ID, 'A 被 B 串');
        assert(String(b.changeUnit.blueprint_id) === SECOND_BLUEPRINT_ID, 'B 被 A 串');
      }
      // 枚举层：两个工作区各自 featureId 都出现，且各自 relativePath 正确
      const features = enumerateFeatures(temp2);
      for (const unitId of UNIT_IDS) {
        const idA = deriveChangeUnitFeatureId(BLUEPRINT_ID, unitId);
        const idB = deriveChangeUnitFeatureId(SECOND_BLUEPRINT_ID, unitId);
        const feats = new Map(features.map(item => [item.featureId, item]));
        assert(feats.has(idA) && feats.has(idB), `双工作区枚举缺 id：${unitId}`);
        assert(feats.get(idA)!.relativePath === `${BLUEPRINT_ID}/${unitId}`, 'A 枚举路径错误');
        assert(feats.get(idB)!.relativePath === `${SECOND_BLUEPRINT_ID}/${unitId}`, 'B 枚举路径错误');
      }
    } finally {
      fs.rmSync(temp2, { recursive: true, force: true });
    }
  }));

  // proof 3：P2 不用另一工作区 CU 满足 requires/provides（ref 层失败 + 派生层不可见双证）
  results.push(test('proof 3：P2 不跨工作区满足 requires/provides（真实 artifact + ref 层失败 + 派生层不可见）', () => {
    const temp2 = buildWorkspaceProject({ secondWorkspace: true });
    try {
      // 派生层不可见：A 工作区 enumerateCanonicalChangeUnits 只返回 A 的 4 个 CU
      const aUnits = enumerateCanonicalChangeUnits(temp2, BLUEPRINT_ID);
      assert(aUnits.length === UNIT_IDS.length, `A 枚举被跨工作区污染：${aUnits.length}`);
      for (const loaded of aUnits) {
        assert(String(loaded.changeUnit.blueprint_id) === BLUEPRINT_ID, 'A 枚举混入 B CU');
      }
      // ref 层失败：用**真实生产 artifact**（loadCanonicalChangeUnit + asChangeUnitArtifact，
      // 未经任何手工 render）。A 的 ledger-consumer requires from ledger-refresh；给 evaluator
      // 的 units 表里只有 B 工作区的 ledger-refresh——复合键 (blueprint_id, change_unit_id)
      // 使跨工作区同名 CU 永不可见 → provider_missing。
      const aConsumer = asChangeUnitArtifact(loadCanonicalChangeUnit(temp2, BLUEPRINT_ID, 'ledger-consumer').changeUnit);
      const bRefresh = asChangeUnitArtifact(loadCanonicalChangeUnit(temp2, SECOND_BLUEPRINT_ID, 'ledger-refresh').changeUnit);
      assert(aConsumer.requires.some(r => r.from_change_unit_id === 'ledger-refresh'), 'fixture consumer requires 缺失');
      assert(bRefresh.provides.some(p => p.provide_id === 'ledger-refresh-vertical-slice'), 'fixture B refresh provides 缺失');
      const depOnBOnly = evaluateChangeUnitDependencies(
        aConsumer,
        [bRefresh],
        new Map(),
        new Map(),
      );
      assert(!depOnBOnly.satisfied, '跨工作区 CU 不得满足 requires（ref 层失败）');
      assert(depOnBOnly.issues.some(i => i.id === 'change_unit_dependency_provider_missing'),
        `应为 provider_missing 而非被 B 满足：${depOnBOnly.issues.map(i => i.id).join(',')}`);
    } finally {
      fs.rmSync(temp2, { recursive: true, force: true });
    }
  }));

  // proof 4：carry-forward 仅同 blueprint_id 内跨 revision 生效；跨工作区历史 CU 的 provides
  // 不参与依赖满足（用真实 artifact + 强制 provider_missing，变异敏感）
  results.push(test('proof 4：carry-forward 仅同 blueprint_id 生效（跨工作区历史 CU 不参与，真实 artifact）', () => {
    const temp2 = buildWorkspaceProject({ secondWorkspace: true });
    try {
      const aConsumer = asChangeUnitArtifact(loadCanonicalChangeUnit(temp2, BLUEPRINT_ID, 'ledger-consumer').changeUnit);
      const bRefresh = asChangeUnitArtifact(loadCanonicalChangeUnit(temp2, SECOND_BLUEPRINT_ID, 'ledger-refresh').changeUnit);
      // B 工作区内 carry-forward 的裁决（按 B 自己的 blueprint_id 加载 B 蓝图）
      const cfB = evaluateChangeUnitCarryForward(temp2, bRefresh);
      // A 的 consumer requires 只能由 A 工作区 provider 满足。即使 B 有有效 carry-forward，
      // 复合键 (A, ledger-refresh) 在 [B-refresh] 表里找不到 → 必须 provider_missing。
      const depAOnB = evaluateChangeUnitDependencies(
        aConsumer,
        [bRefresh],
        new Map([[String(bRefresh.change_unit_id), { state: 'VALID' } as never]]),
        new Map([[String(bRefresh.change_unit_id), { allowed: cfB.allowed, reasons: cfB.reasons }]]),
      );
      assert(!depAOnB.satisfied, 'A 的 requires 不得被 B 工作区历史提供者满足（proof 4 依赖侧）');
      assert(depAOnB.issues.some(i => i.id === 'change_unit_dependency_provider_missing'),
        `必须 provider_missing（复合键隔离），实际：${depAOnB.issues.map(i => i.id).join(',')}`);
      // 对照：A 工作区内 carry-forward 按 A 蓝图正常裁决（同 blueprint_id 跨 revision 生效）
      const aRefresh = asChangeUnitArtifact(loadCanonicalChangeUnit(temp2, BLUEPRINT_ID, 'ledger-refresh').changeUnit);
      const cfA = evaluateChangeUnitCarryForward(temp2, aRefresh);
      assert(typeof cfA.allowed === 'boolean' && (cfA.allowed === true || cfA.reasons.length > 0),
        'A 内 carry-forward 应有明确裁决');
      if (cfA.allowed === true) {
        const depAInA = evaluateChangeUnitDependencies(
          aConsumer,
          [aRefresh],
          new Map([[String(aRefresh.change_unit_id), {
            state: 'VALID', featureId: deriveChangeUnitFeatureId(BLUEPRINT_ID, 'ledger-refresh'), reasons: [],
          }]]),
          new Map([[String(aRefresh.change_unit_id), { allowed: cfA.allowed, reasons: cfA.reasons }]]),
        );
        assert(depAInA.satisfied, '同工作区内提供者应正常满足（对照组）');
      }
    } finally {
      fs.rmSync(temp2, { recursive: true, force: true });
    }
  }));

  // proof 5：P3 closure 不消费另一工作区的 CU/Feature/证据（跨工作区枚举隔离）
  // codex review（t4 一轮）：resolveChangeUnitRef 是独立解析器，按 ref 自带 blueprint_id
  // 定位；“把 B 的 ref 交给它期望失败”不能证明工作区隔离（只能证明 B 自身无效与否）。
  // 正确断言面 = P3 输入枚举限定：enumerateCanonicalChangeUnits(A) 只含 A 工作区 CU，
  // resolveComponentClosureInputs 输入集全部为 A 工作区（B 的同名 CU 不可见）。
  results.push(test('proof 5：P3 closure inputs 不消费另一工作区 CU（枚举限定 + 输入集隔离）', () => {
    const temp2 = buildWorkspaceProject({ secondWorkspace: true });
    try {
      // 枚举限定：A 的 enumerateCanonicalChangeUnits 只返回 A 的 4 个 CU（B 的同名 CU 不可见）
      const aEnumerated = enumerateCanonicalChangeUnits(temp2, BLUEPRINT_ID);
      assert(aEnumerated.length === UNIT_IDS.length, `A 枚举被跨工作区污染：${aEnumerated.length}`);
      for (const loaded of aEnumerated) {
        assert(String(loaded.changeUnit.blueprint_id) === BLUEPRINT_ID, 'A 枚举混入 B CU');
      }
      // 输入集隔离：closure 输入全部为 A 工作区，不消费任一 B CU
      const closure = resolveComponentClosureInputs(temp2, BLUEPRINT_ID);
      assert(closure.units.length === UNIT_IDS.length, `closure 不应消费 B 工作区 CU：${closure.units.length}`);
      for (const u of closure.units) {
        assert(String(u.changeUnit.blueprint_id) === BLUEPRINT_ID, 'closure 输入混入跨工作区 CU');
      }
      // 反例定位：B 存在同名 ledger-refresh（若枚举未限定，closure.units 会 >4 或混入 B）——
      // 变异 B 的 CU 数或放宽枚举即可让本断言红。
      const bCount = enumerateCanonicalChangeUnits(temp2, SECOND_BLUEPRINT_ID).length;
      assert(bCount === UNIT_IDS.length, 'B 工作区自身枚举应完整（对照组成立）');
    } finally {
      fs.rmSync(temp2, { recursive: true, force: true });
    }
  }));

  // proof 5 深化（P3 closure 行为）：完整装配 A → closure 落盘 PASS；再加 B 工作区
  //（含 A 缺失的 CU 与 evidence），A 的 closure 输入/行/verdict 必须逐项不变——
  // B 的 CU/evidence 不被 A 消费（跨工作区 row 不出现、不计分）。
  results.push(test('proof 5 deepen：B 的 provides 本可满足 A obligation，A row 仍 uncovered（规格正反例）', () => {
    withCompleteProject(projectRoot => {
      // 基线：完整装配 → A closure PASS；记录目标 obligation row（cu-require:ledger-consumer:need-refresh
      // ——A 的 ledger-consumer requires ledger-refresh 提供 ledger-refresh-vertical-slice）
      const TARGET_OBLIGATION = 'obligation:cu-require:ledger-consumer:need-refresh';
      const baseline = writeCanonicalComponentClosure(projectRoot, BLUEPRINT_ID, { evaluatedAt: '2026-08-22T00:00:00+08:00' });
      const baselineRow = baseline.closure.coverage_rows.find(r => r.obligation_id === TARGET_OBLIGATION);
      assert(baselineRow !== undefined, `基线缺目标 obligation row：${TARGET_OBLIGATION}`);
      // 基线 A 本地即缺该 dependency 的组合 evidence（uncovered）——本反例的区分点在：
      // B 提供同一 obligation 所需真实 completion/evidence 后，A row 必须**仍** uncovered。

      // A 本地 evidence 缺失：删除 A 的 ledger-refresh 的 completion 投影与 goal-runs
      //（observeChangeUnitCompletion → ABSENT；A 内 provider 不再可满足 requires）
      const aRefreshFid = deriveChangeUnitFeatureId(BLUEPRINT_ID, 'ledger-refresh');
      const aCompletionFile = featureFilePath(projectRoot, aRefreshFid, 'feature-completion.json');
      fs.rmSync(aCompletionFile, { force: true });
      const aRunsDir = featureFilePath(projectRoot, aRefreshFid, 'goal-runs');
      fs.rmSync(aRunsDir, { recursive: true, force: true });

      // B 提供同一 obligation 的完整真实证据：B 工作区建同名 ledger-refresh CU（provides 同
      // ledger-refresh-vertical-slice）+ 真实 completion 链（spec/contracts/receipt/report）。
      const wsB = path.join(projectRoot, 'doc', 'features', SECOND_BLUEPRINT_ID);
      fs.mkdirSync(path.join(wsB, 'blueprint'), { recursive: true });
      const srcBp = path.join(FIXTURE_VALID, 'doc', 'features', BLUEPRINT_ID, 'blueprint', 'component-blueprint.yaml');
      const bpB = YAML.parse(fs.readFileSync(srcBp, 'utf8'));
      bpB.blueprint_id = SECOND_BLUEPRINT_ID;
      bpB.revision = Number(bpB.revision) + 1;
      fs.writeFileSync(path.join(wsB, 'blueprint', 'component-blueprint.yaml'), YAML.stringify(bpB), 'utf8');
      const bRefreshDir = path.join(wsB, 'ledger-refresh');
      fs.mkdirSync(bRefreshDir, { recursive: true });
      // B 的 CU = A fixture 的 ledger-refresh 完整副本 + 身份改写（保留全字段与 refs，
      // 使 B 的 CU 是完整可观察的同一能力提供者）
      const srcRefreshCu = path.join(FIXTURE_VALID, 'doc', 'features', BLUEPRINT_ID, 'ledger-refresh', 'change-unit.yaml');
      const cuB = YAML.parse(fs.readFileSync(srcRefreshCu, 'utf8'));
      cuB.blueprint_id = SECOND_BLUEPRINT_ID;
      cuB.component_blueprint_ref = { ...cuB.component_blueprint_ref, blueprint_id: SECOND_BLUEPRINT_ID };
      cuB.provenance = {
        ...cuB.provenance,
        source_ref: `doc/features/${SECOND_BLUEPRINT_ID}/blueprint/component-blueprint.yaml#blueprint:${SECOND_BLUEPRINT_ID}`,
      };
      fs.writeFileSync(path.join(bRefreshDir, 'change-unit.yaml'), YAML.stringify(cuB), 'utf8');
      const bRefreshFid = deriveChangeUnitFeatureId(SECOND_BLUEPRINT_ID, 'ledger-refresh');
      fs.mkdirSync(path.join(bRefreshDir, 'spec'), { recursive: true });
      fs.writeFileSync(path.join(bRefreshDir, 'spec', 'spec.md'),
        '# ledger-refresh' + '\n\n## Scope 声明\n\n```yaml\nrationale: refresh\nin_scope_modules: [ledger]\nout_of_scope_modules: []\n```' + '\n', 'utf8');
      // B 的 contracts = A fixture 副本 + change_unit_ref 由生产 createChangeUnitRef 重建
      //（从 B 的 CU 字节算 hash/revision——binding 校验要求 contracts ref 与 CU 文件精确等值）
      const srcRefreshContracts = path.join(FIXTURE_VALID, 'doc', 'features', BLUEPRINT_ID, 'ledger-refresh', 'contracts.yaml');
      const contractsB = YAML.parse(fs.readFileSync(srcRefreshContracts, 'utf8'));
      contractsB.feature = bRefreshFid;
      const loadedB = loadCanonicalChangeUnit(projectRoot, SECOND_BLUEPRINT_ID, 'ledger-refresh');
      const refBFull = createChangeUnitRef(loadedB);
      contractsB.change_unit = { ...(contractsB.change_unit ?? {}), change_unit_ref: refBFull };
      fs.writeFileSync(path.join(bRefreshDir, 'contracts.yaml'), YAML.stringify(contractsB), 'utf8');
      const expectedB = resolveChangeUnitExpectedExecution(projectRoot, bRefreshFid);
      seedCleanCompletionChain({
        projectRoot,
        feature: bRefreshFid,
        chain: [...expectedB.expectedChain],
        runId: 'run-b-refresh',
        now: () => new Date('2026-08-22T00:00:00+08:00'),
      });
      generateFeatureCompletion({
        projectRoot,
        feature: bRefreshFid,
        chain: [...expectedB.expectedChain],
        workflowTrack: expectedB.expectedTrack,
        runId: 'run-b-refresh',
        runDirAbs: featureFilePath(projectRoot, bRefreshFid, path.join('goal-runs', 'run-b-refresh')),
        phaseRunIds: {},
        now: () => new Date('2026-08-22T00:00:00+08:00'),
      });

      // 反例前提自证：B 的 completion 必须真实 VALID（observeChangeUnitCompletion 生产入口）——
      // 否则"B 本可满足"不成立，反例无区分度。
      const bRefreshLoaded = loadCanonicalChangeUnit(projectRoot, SECOND_BLUEPRINT_ID, 'ledger-refresh');
      const bRefreshArtifact = asChangeUnitArtifact(bRefreshLoaded.changeUnit);
      const bObservation = observeChangeUnitCompletion(projectRoot, bRefreshArtifact);
      assert(bObservation.state === 'VALID',
        `B 的 completion 应为 VALID（反例前提）：${bObservation.state} ${bObservation.reasons.join('；')}`);

      // 重算 A closure：目标 row 必须仍 uncovered（B 的 provides/evidence 不进 A 计分）；
      // 若错误实现跨区 credit B 的 completion → observation=covered → 红。
      const rerun = writeCanonicalComponentClosure(projectRoot, BLUEPRINT_ID, { evaluatedAt: '2026-08-22T00:00:00+08:00' });
      const rerunRow = rerun.closure.coverage_rows.find(r => r.obligation_id === TARGET_OBLIGATION);
      assert(rerunRow !== undefined, `重算缺目标 obligation row：${TARGET_OBLIGATION}`);
      // B 的 completes/evidence 本可满足该 obligation（B 的 ledger-refresh CU provides 同一
      // provide_id + 完整 completion 链）；正确实现必须拒绝跨区 credit → row 仍 uncovered。
      assert(rerunRow.observation === 'uncovered',
        `A 目标 row 必须保持 uncovered（跨区 credit 被拒）：${rerunRow.observation}`);
      // 无 B 的任何标识 credit 到该 row（owner/feature/evidence 字段任一出现 B 即红）
      const rowJson = JSON.stringify(rerunRow);
      assert(!rowJson.includes(SECOND_BLUEPRINT_ID), `A 目标 row 出现 B 工作区标识：${rowJson.slice(0, 300)}`);
      // row 的 owner feature/evidence credit 字段不得出现 B 的 featureId（跨区 credit 的直接证据）
      const rowFeatureIds = rerunRow.feature_ids ?? [];
      assert(!rowFeatureIds.includes(String(bRefreshFid)),
        `A 目标 row 的 owner feature_ids 混入 B feature：${JSON.stringify(rowFeatureIds)}`);
      // 反例定位：若 B 的 CU/evidence 被 A closure 枚举（inputs 混入 SECOND 工作区），
      // 输入清单 JSON 会出现 B 的标识——必须保持与基线一致（A 输入集未被 B 污染）。
      assert(JSON.stringify((rerun.closure.inputs?.change_units ?? []).map(u => String((u as { ref?: { change_unit_id?: string } }).ref?.change_unit_id ?? '')))
        === JSON.stringify((baseline.closure.inputs?.change_units ?? []).map(u => String((u as { ref?: { change_unit_id?: string } }).ref?.change_unit_id ?? ''))),
        'A closure 输入清单被 B 工作区污染');
    });
  }));
  // proof 7：创建新工作区不改旧工作区蓝图/CU/closure（前后字节对比）
  results.push(test('proof 7：创建新工作区不改旧工作区的蓝图/CU/closure（字节对比）', () => {
    const temp2 = buildWorkspaceProject(); // 先只建 A
    try {
      const aBlueprint = path.join(temp2, 'doc', 'features', BLUEPRINT_ID, 'blueprint', 'component-blueprint.yaml');
      const before = fs.readFileSync(aBlueprint);
      const cuFiles: Array<[string, Buffer]> = [];
      for (const unitId of UNIT_IDS) {
        const p = path.join(temp2, 'doc', 'features', BLUEPRINT_ID, unitId, 'change-unit.yaml');
        cuFiles.push([p, fs.readFileSync(p)]);
      }
      // 写 closure 前的输入枚举（只读）
      resolveComponentClosureInputs(temp2, BLUEPRINT_ID);
      assert(fs.readFileSync(aBlueprint).equals(before), 'closure 输入枚举改写了蓝图');
      for (const [p, b] of cuFiles) assert(fs.readFileSync(p).equals(b), `CU 被改写：${p}`);

      // ── closure 快照：**在创建 B 之前**首次写盘 A closure 并记录字节（review 三轮）──
      // 顺序 = plan 要求“创建新工作区不改旧工作区 closure”：先有 A 的 closure 快照，再建 B。
      const FIXED_NOW7 = '2026-08-22T00:00:00+08:00';
      const closurePathA = componentClosurePath(temp2, BLUEPRINT_ID);
      writeCanonicalComponentClosure(temp2, BLUEPRINT_ID, { evaluatedAt: FIXED_NOW7 });
      assert(fs.existsSync(closurePathA), 'A closure 应已写盘（B 创建前快照）');
      const closureBytesBeforeB = fs.readFileSync(closurePathA);
      const closureReviewPathA = componentClosurePath(temp2, BLUEPRINT_ID).replace(/\.yaml$/, '.md');
      assert(fs.existsSync(closureReviewPathA), 'A closure 评审投影应已写盘（B 创建前快照）');
      const closureReviewBytesBeforeB = fs.readFileSync(closureReviewPathA);

      // 现在创建第二工作区（写 B），再对比 A 字节
      const featuresAbs = path.join(temp2, 'doc', 'features');
      const wsB = path.join(featuresAbs, SECOND_BLUEPRINT_ID);
      fs.mkdirSync(path.join(wsB, 'blueprint'), { recursive: true });
      const srcBp = path.join(FIXTURE_VALID, 'doc', 'features', BLUEPRINT_ID, 'blueprint', 'component-blueprint.yaml');
      const bpB = YAML.parse(fs.readFileSync(srcBp, 'utf8'));
      bpB.blueprint_id = SECOND_BLUEPRINT_ID;
      bpB.revision = Number(bpB.revision) + 1;
      fs.writeFileSync(path.join(wsB, 'blueprint', 'component-blueprint.yaml'), YAML.stringify(bpB), 'utf8');
      for (const unitId of UNIT_IDS) {
        const srcCu = path.join(FIXTURE_VALID, 'doc', 'features', BLUEPRINT_ID, unitId, 'change-unit.yaml');
        const cu = YAML.parse(fs.readFileSync(srcCu, 'utf8'));
        cu.blueprint_id = SECOND_BLUEPRINT_ID;
        cu.component_blueprint_ref = { ...cu.component_blueprint_ref, blueprint_id: SECOND_BLUEPRINT_ID };
        fs.mkdirSync(path.join(wsB, unitId), { recursive: true });
        fs.writeFileSync(path.join(wsB, unitId, 'change-unit.yaml'), YAML.stringify(cu), 'utf8');
      }
      assert(fs.readFileSync(aBlueprint).equals(before), '创建 B 改写了 A 蓝图');
      for (const [p, b] of cuFiles) assert(fs.readFileSync(p).equals(b), `创建 B 改写 A CU：${p}`);

      // 双工作区都可独立 enumerate，B 的枚举不影响 A 字节
      const aFeats = enumerateFeatures(temp2).filter(f => f.relativePath.startsWith(`${BLUEPRINT_ID}/`));
      assert(aFeats.length === UNIT_IDS.length, 'B 创建后 A 枚举被污染');
      for (const [p, b] of cuFiles) assert(fs.readFileSync(p).equals(b), `枚举 B 改写 A CU：${p}`);

      // 创建 B 之后再跑 A 的 closure 输入枚举（生产入口），A 蓝图/CU 字节仍不变
      const closureAfterB = resolveComponentClosureInputs(temp2, BLUEPRINT_ID);
      assert(closureAfterB.units.length === UNIT_IDS.length, 'B 创建后 A closure 输入被污染');
      assert(fs.readFileSync(aBlueprint).equals(before), 'B 创建后 closure 枚举改写了 A 蓝图');
      for (const [p, b] of cuFiles) assert(fs.readFileSync(p).equals(b), `B 创建后 closure 枚举改写 A CU：${p}`);

      // closure 行为深化（review 三轮）：A 的 closure 快照在创建 B **之前**已落盘
      //（见上）；现在 B 已在场——重写 A closure，字节必须与 B 创建前快照逐项一致。
      writeCanonicalComponentClosure(temp2, BLUEPRINT_ID, { evaluatedAt: FIXED_NOW7 });
      assert(fs.readFileSync(closurePathA).equals(closureBytesBeforeB),
        '创建 B 后重算 A closure 字节漂移（B 污染或非确定性输出）');
      assert(fs.readFileSync(closureReviewPathA).equals(closureReviewBytesBeforeB),
        '创建 B 后重算 A closure 评审投影字节漂移');
    } finally {
      fs.rmSync(temp2, { recursive: true, force: true });
    }
  }));

  // proof 12：自定义 paths.features_dir 下蓝图/CU/closure/Feature 全链完整运行
  results.push(test('proof 12：自定义 features_dir（requirements/features）下全链运行（含 closure 闭环）', () => {
    withCompleteProject(projectRoot => {
      // 蓝图解析（custom config 驱动）
      const bp = loadCanonicalBlueprint(projectRoot, BLUEPRINT_ID);
      assert(String(bp.blueprint.blueprint_id) === BLUEPRINT_ID, 'custom features_dir 蓝图解析失败');
      // CU 枚举 + 往返
      const feats = enumerateFeatures(projectRoot);
      assert(feats.length === UNIT_IDS.length, `custom features_dir 枚举失败：${feats.length}`);
      for (const unitId of UNIT_IDS) {
        const id = deriveChangeUnitFeatureId(BLUEPRINT_ID, unitId);
        const f = feats.find(i => i.featureId === id);
        assert(f !== undefined, `custom features_dir 缺 CU：${unitId}`);
        assert(f!.relativePath === `${BLUEPRINT_ID}/${unitId}`, 'custom 相对路径错误');
        const absDir = featureDir(projectRoot, id).replace(/\\/g, '/');
        assert(absDir.endsWith(`requirements/features/${BLUEPRINT_ID}/${unitId}`), `featureDir 未走 custom：${absDir}`);
        const cu = loadCanonicalChangeUnit(projectRoot, BLUEPRINT_ID, unitId);
        assert(String(cu.changeUnit.change_unit_id) === unitId, 'custom CU 加载失败');
      }
      // 产物路径（receipt/report/feature 文件）在 custom 目录下
      const id0 = deriveChangeUnitFeatureId(BLUEPRINT_ID, UNIT_IDS[0]);
      const rec = receiptDirPath(projectRoot, id0, 'coding').replace(/\\/g, '/');
      assert(rec.includes(`requirements/features/${BLUEPRINT_ID}/${UNIT_IDS[0]}`), `receipt 未走 custom：${rec}`);
      const rep = featurePhaseReportsDir(projectRoot, id0, 'coding').replace(/\\/g, '/');
      assert(rep.includes(`requirements/features/${BLUEPRINT_ID}/${UNIT_IDS[0]}`), `report 未走 custom：${rep}`);
      const sp = featureFilePath(projectRoot, id0, 'spec/spec.md').replace(/\\/g, '/');
      assert(sp.includes(`requirements/features/${BLUEPRINT_ID}/${UNIT_IDS[0]}`), `feature 文件未走 custom：${sp}`);
      // closure 深化（review 三轮）：custom dir 下 write → check 全链，**且必须闭环**——
      // issues 无 BLOCKER、verdict 为 PASS/PASS_WITH_DEGRADATION（装配后 evidence 链完整，
      // 若 custom 路径断链（如 configured block 读取走 doc/features），closure 必 FAIL 而红）。
      // 先行生成真实 completion 链（MG 等价：resolveChangeUnitExpectedExecution →
      // seedCleanCompletionChain → generateFeatureCompletion；真实写得 goal-runs/receipt/report）
      const FIXED_NOW_P12 = '2026-08-22T00:00:00+08:00';
      for (const unitId of UNIT_IDS) {
        const fid = deriveChangeUnitFeatureId(BLUEPRINT_ID, unitId);
        const expected = resolveChangeUnitExpectedExecution(projectRoot, fid);
        const runId = 'run-p12-' + unitId;
        seedCleanCompletionChain({
          projectRoot,
          feature: fid,
          chain: [...expected.expectedChain],
          runId,
          now: () => new Date(FIXED_NOW_P12),
        });
        generateFeatureCompletion({
          projectRoot,
          feature: fid,
          chain: [...expected.expectedChain],
          workflowTrack: expected.expectedTrack,
          runId,
          runDirAbs: featureFilePath(projectRoot, fid, path.join('goal-runs', runId)),
          phaseRunIds: {},
          now: () => new Date(FIXED_NOW_P12),
        });
      }
      const closureWrite = writeCanonicalComponentClosure(projectRoot, BLUEPRINT_ID, { evaluatedAt: FIXED_NOW_P12 });
      const blockers = closureWrite.issues.filter(i => i.severity === 'BLOCKER');
      assert(blockers.length === 0, `custom closure 有 BLOCKER（闭环失败）：${blockers.map(i => i.id).join(',')}`);
      assert(closureWrite.closure.verdict === 'PASS' || closureWrite.closure.verdict === 'PASS_WITH_DEGRADATION',
        `custom closure verdict 未闭环：${closureWrite.closure.verdict}`);
      assert(String(closureWrite.closure.blueprint_id) === BLUEPRINT_ID,
        'closure blueprint_id 必须与 owner 一致（不得缺失）');
      const closureYaml = componentClosurePath(projectRoot, BLUEPRINT_ID);
      assert(closureYaml.replace(/\\/g, '/').includes(`requirements/features/${BLUEPRINT_ID}/blueprint/component-closure.yaml`),
        `closure yaml 未落 custom 目录：${closureYaml}`);
      assert(fs.existsSync(closureYaml), 'closure yaml 未写盘');
      // 无 doc/features 残留写盘
      assert(!fs.existsSync(path.join(projectRoot, 'doc', 'features', BLUEPRINT_ID, 'blueprint', 'component-closure.yaml')),
        'custom 模式下不得向 doc/features 写 closure');
    }, { customFeaturesDir: 'requirements/features' });
  }));

  // proof 13：Goal Mode 真实启动/暂停/恢复（生产入口 prepareGoalModeRun + 事件写入 +
  // 锁获取/释放/重获 + manifest 读回），receipt/report/manifest/lock/context 全部落 CU 物理目录
  results.push(await asyncTest('proof 13：真实 Goal Mode 启动/暂停/恢复全链落 CU 物理目录（host bridge 暂停/恢复两轮 + proof 14 无影子目录）', async () => {
    const temp2 = buildWorkspaceProject();
    try {
      // 显式配置 receipt/reports pattern（P2 spec：默认形态 = <features_dir>/<feature>/<phase>/…）；
      // 无 pattern 时 deriveDefaultPatternsFromFeaturesDir 也会从 features_dir 派生。
      fs.writeFileSync(
        path.join(temp2, 'framework.config.json'),
        JSON.stringify({
          schema_version: '1.0',
          project_name: 'proof13',
          project_type: 'app',
          agent_adapter: 'claude',
          paths: {
            features_dir: 'doc/features',
            receipt_dir_pattern: 'doc/features/<feature>/<phase>',
            reports_dir_pattern: 'doc/features/<feature>/<phase>/reports',
          },
        }, null, 2),
        'utf8',
      );
      const unitId = UNIT_IDS[0];
      const featureId = deriveChangeUnitFeatureId(BLUEPRINT_ID, unitId);
      const rel = featureRelativePath(featureId);

      // 启动：生产入口 prepareGoalModeRun 落 manifest + run-control 骨架
      const FRAMEWORK_ROOT_REPO = path.resolve(__dirname, '..', '..', '..');
      const prepared = prepareGoalModeRun({
        projectRoot: temp2,
        frameworkRoot: FRAMEWORK_ROOT_REPO,
        feature: featureId,
        runId: 'r-prove13',
        adapter: 'codex',
        requirement: 'prove goal paths',
        startPhase: 'spec',
        endPhase: 'spec',
      });
      const runId = String(prepared.manifest.run_id);
      const runDirAbs = prepared.runDir.replace(/\\/g, '/');
      assert(runDirAbs.endsWith(`doc/features/${BLUEPRINT_ID}/${unitId}/goal-runs/${runId}`),
        `runDir 未落 CU 物理目录：${runDirAbs}`);
      assert(!runDirAbs.includes(encodeCuFeatureId(BLUEPRINT_ID, unitId)), 'goal-runs 目录不得含编码 id 段');
      assert(fs.existsSync(prepared.manifestPath), 'manifest 未落盘');
      assert(fs.existsSync(path.join(prepared.runDir, 'run-control.json')), 'run-control 未落盘');

      // 运行：获取 owner 锁 + 写真实 event
      const first = casAcquireRunOwner(prepared.runDir, runId, 0, {
        kind: 'session', owner_id: 'owner-1', lease_ms: 60_000,
      });
      assert(first.ok, '首次 acquire 失败');
      appendGoalEventFenced(temp2, prepared.manifest, prepared.runDir, first.token, {
        type: 'phase_started', phase: 'spec', run_id: runId,
      });
      const eventsAbs = path.join(temp2, prepared.manifest.report_dir, 'events.jsonl');
      assert(fs.existsSync(eventsAbs), 'events.jsonl 未落盘');
      assert(loadEventsJsonl(eventsAbs).length === 1, 'events.jsonl 应恰有一行');
      assert(!eventsAbs.replace(/\\/g, '/').includes(encodeCuFeatureId(BLUEPRINT_ID, unitId)), 'events 路径不得含编码 id');

      // 暂停：释放 owner
      releaseRunOwner(prepared.runDir, first.token);

      // 恢复：重新 acquire + 从磁盘读回 manifest（生产 loadGoalManifestFile）；读回后释放
      const second = casAcquireRunOwner(prepared.runDir, runId, 1, {
        kind: 'session', owner_id: 'owner-2', lease_ms: 60_000,
      });
      assert(second.ok, '暂停后重新 acquire 失败（恢复失败）');
      const restored = loadGoalManifestFile(prepared.manifestPath, temp2);
      assert(String(restored.feature) === featureId, '恢复读回的 manifest feature 错误');
      assert(String(restored.run_id) === runId, '恢复读回的 run_id 错误');
      // 读回完成即释放——后面交还 host bridge 完整接管（bridge 自 acquire/release）
      releaseRunOwner(prepared.runDir, second.token);

      // 落盘点：锁 / context / receipt / report 全部在 CU 物理目录
      const featureLock = resolveFeatureLockPath(temp2, 'doc/features', featureId);
      assert(featureLock.replace(/\\/g, '/').endsWith(`doc/features/${BLUEPRINT_ID}/${unitId}/goal-runs/.feature.lock`),
        `feature lock 未落 CU 物理目录：${featureLock}`);
      const runnerLock = resolveRunnerLockPath(temp2, 'doc/features', featureId, runId, prepared.manifest.report_dir);
      assert(runnerLock.replace(/\\/g, '/').includes(`${unitId}/goal-runs/${runId}/.runner.lock`),
        `runner lock 未落 CU 物理目录：${runnerLock}`);
      const factsAbs = resolveFactsAbsPath(temp2, featureId);
      assert(factsAbs.replace(/\\/g, '/').endsWith(`doc/features/${BLUEPRINT_ID}/${unitId}/context/facts.md`),
        `context facts 未落 CU 物理目录：${factsAbs}`);
      const rec = receiptDirPath(temp2, featureId, 'coding').replace(/\\/g, '/');
      assert(rec.endsWith(`doc/features/${BLUEPRINT_ID}/${unitId}/coding`), `receipt 未落 CU 物理目录：${rec}`);
      const rep = featurePhaseReportsDir(temp2, featureId, 'coding').replace(/\\/g, '/');
      assert(rep.endsWith(`doc/features/${BLUEPRINT_ID}/${unitId}/coding/reports`), `report 未落 CU 物理目录：${rep}`);

      // ── 真实 Goal Mode 启停恢复（host bridge 两轮，正式 waiting 语义）──────────
      // 暂停：在 CU 物理报告目录写 summary.json（verdict=INCOMPLETE + externalBlocked blocker）
      // → assess 推荐 waiting（不执行 phase、不伪造推进）→ host bridge 释放 owner = 可恢复停点。
      // 该 summary 位置正是 featurePhaseReportsDir（CU 物理目录）——顺带验证 report 落点。
      const specReports = featurePhaseReportsDir(temp2, featureId, 'spec', FRAMEWORK_ROOT_REPO);
      fs.mkdirSync(specReports, { recursive: true });
      fs.writeFileSync(path.join(specReports, 'summary.json'), JSON.stringify({
        schema_version: '1.2',
        verdict: 'INCOMPLETE',
        closure_status: 'open',
        assurance: 'full',
        blockers: [{ id: 'device_missing', blocking_class: 'externalBlocked' }],
      }), 'utf8');
      let executedFirst = false;
      const bridgeFirst = await runGoalModeHostBridge({
        projectRoot: temp2,
        frameworkRoot: FRAMEWORK_ROOT_REPO,
        feature: featureId,
        runId,
        adapter: 'codex',
        maxRounds: 1,
        executePhase: async phase => {
          executedFirst = true;
          return { status: 'passed', phase };
        },
      });
      assert(bridgeFirst.status === 'waiting' && !!bridgeFirst.waiting_item,
        `第一轮应 waiting（blocker 暂停点，不执行 phase）：${bridgeFirst.status} ${bridgeFirst.waiting_item ?? ''}`);
      assert(!executedFirst, '暂停点不得执行 phase（waiting 语义）');
      // 暂停点后 events 计数（恢复轮必须在基准之上严格增长，防“事件没写、用例恒绿”）
      const eventsAfterPause = loadEventsJsonl(eventsAbs).length;
      assert(typeof bridgeFirst.waiting_item === 'string' && bridgeFirst.waiting_item.length > 0,
        '暂停理由应非空（blocker 暂停点）；实际=' + String(bridgeFirst.waiting_item));
      // 暂停后 owner 已被 host bridge 释放（best-effort release）——必须在状态上闭合
      //（review 三轮：不仅 run-control 存在，且 owner.state === released）
      const controlAfterPause = readRunControl(path.dirname(prepared.manifestPath), runId);
      assert(controlAfterPause !== null, '暂停后 run-control 仍存在');
      assert(controlAfterPause!.owner?.state === 'released',
        `暂停后 owner 应为 released（可恢复停点）：${controlAfterPause!.owner?.state}`);

      // 恢复：移除 blocker（外部条件解除的真实姿势：bloacker 从 summary 消失）→ 第二轮
      // host bridge 重新加载已落盘 manifest + 重获 owner → assess 推荐 phase → execute 成功
      fs.writeFileSync(path.join(specReports, 'summary.json'), JSON.stringify({
        schema_version: '1.2',
        verdict: 'OPEN',
        closure_status: 'open',
        assurance: 'full',
        blockers: [],
      }), 'utf8');
      let executedSecond = false;
      const bridgeSecond = await runGoalModeHostBridge({
        projectRoot: temp2,
        frameworkRoot: FRAMEWORK_ROOT_REPO,
        feature: featureId,
        runId,
        adapter: 'codex',
        maxRounds: 1,
        executePhase: async phase => {
          executedSecond = true;
          return { status: 'passed', phase };
        },
      });
      assert(bridgeSecond.status === 'executed' || bridgeSecond.status === 'fused',
        `第二轮应恢复执行（executed/fused）：${bridgeSecond.status}`);
      assert(executedSecond, '恢复后必须真正执行 phase');
      // 恢复后 events 追加（真实事件写入在 runInSessionRound 内完成）；严格大于暂停点计数
      const eventsAfterResume = loadEventsJsonl(eventsAbs);
      assert(eventsAfterResume.length > eventsAfterPause,
        `恢复轮应追加事件：暂停后 ${eventsAfterPause} 条，恢复后 ${eventsAfterResume.length} 条`);

      // ── 真实产物落盘（review 三轮收尾）────────────────────────────
      // receipt：用生产 writer writeReceiptScaffold 落盘（不走手工 writeFileSync）；
      // 工厂入口解析 receipt 路径（resolveReceiptFilePath 内部经 SSOT）——真实 writer 若
      // 回归写进编码目录，receiptPath 断言立即红。
      const scaffold = writeReceiptScaffold(temp2, featureId, 'coding');
      assert(scaffold.wrote === true, `writeReceiptScaffold 未写盘：${scaffold.failure ?? '(未知)'}`);
      assert(scaffold.receiptPath !== null && fs.existsSync(scaffold.receiptPath), 'receipt 未真实落盘（生产 writer）');
      const receiptPosix = (scaffold.receiptPath ?? '').replace(/\\/g, '/');
      assert(!receiptPosix.includes(String(featureId)) && receiptPosix.endsWith(`doc/features/${BLUEPRINT_ID}/${unitId}/coding/phase-completion-receipt.md`),
        `receipt 未落 CU 物理目录或含编码 id：${receiptPosix}`);
      // context facts / feature lock / runner lock：真实写盘由各自生产 owner 的既有测试覆盖
      //（context facts → goals 探索事实写入器；locks → goal-runner 的锁生命周期），本证明只
      // 做「解析路径」断言（在 CU 物理目录、不含编码 id）并移交三列表引用——host bridge
      // 不负责写 receipt/facts/locks，此处不伪造。
      const factsAbs3 = resolveFactsAbsPath(temp2, featureId);
      assert(factsAbs3.replace(/\\/g, '/').endsWith(`doc/features/${BLUEPRINT_ID}/${unitId}/context/facts.md`),
        `facts 解析未落 CU 物理目录：${factsAbs3}`);
      assert(!factsAbs3.replace(/\\/g, '/').includes(String(featureId)), 'facts 路径不得含编码 id');
      const featureLock3 = resolveFeatureLockPath(temp2, 'doc/features', featureId);
      const runnerLock3 = resolveRunnerLockPath(temp2, 'doc/features', featureId, runId, prepared.manifest.report_dir);
      assert(featureLock3.replace(/\\/g, '/').endsWith(`doc/features/${BLUEPRINT_ID}/${unitId}/goal-runs/.feature.lock`),
        `feature lock 解析未落 CU 物理目录：${featureLock3}`);
      assert(runnerLock3.replace(/\\/g, '/').includes(`${unitId}/goal-runs/${runId}/.runner.lock`),
        `runner lock 解析未落 CU 物理目录：${runnerLock3}`);
      assert(!featureLock3.replace(/\\/g, '/').includes(String(featureId)), 'feature lock 路径不得含编码 id');
      assert(!runnerLock3.replace(/\\/g, '/').includes(String(featureId)), 'runner lock 路径不得含编码 id');
      // manifest 真实落盘（已断言）+ 路径不含编码 id
      assert(!prepared.manifestPath.replace(/\\/g, '/').includes(String(featureId)), 'manifest 路径不得含编码 id');

      // ── proof 14：整轮执行后不存在 <features_dir>/<encoded-featureId> 影子目录 ──
      const encodedSegments = enumerateFeatures(temp2)
        .map(f => f.relativePath.split('/')[0]);
      void encodedSegments;
      for (const ent of fs.readdirSync(path.join(temp2, 'doc', 'features'))) {
        assert(!ent.startsWith('cu-'), `整轮执行后存在编码影子目录：${ent}`);
      }
    } finally {
      fs.rmSync(temp2, { recursive: true, force: true });
    }
  }));

  return results;
}
