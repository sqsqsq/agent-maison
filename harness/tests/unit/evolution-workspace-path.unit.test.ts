// ============================================================================
// evolution-workspace-path.unit.test.ts — M5A 手下新布局生产入口最小合成用例
// ============================================================================
// t2 返修验收口径（codex review）：“用新布局最小合成用例实跑
// resolveChangeUnitRef → enumerateFeatures → closure inputs 三个生产入口零 BLOCKER，
// 并把这个用例留作 t4 证明 11/12 的底座”。
//
// 本套件从既有 fixture（fixtures/component-blueprint/valid，已是新布局）直接复制
//   <features_dir>/<blueprint_id>/blueprint/component-blueprint.yaml
//   <features_dir>/<blueprint_id>/<change_unit_id>/change-unit.yaml
//   <features_dir>/<blueprint_id>/<change_unit_id>/<phase>/… 与 contracts.yaml
// 然后直跑生产入口：
//   1. resolveChangeUnitRef      —— CU ref 五字段 + path/root/owner 一致 + binding matched
//   2. enumerateFeatures         —— workspace 容器下钻，featureId↔路径往返恒等（proof 11）
//   3. resolveComponentClosureInputs —— 同工作区输入枚举零 BLOCKER（proof 12 底座）
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as YAML from 'yaml';
import { enumerateFeatures, featureDir } from '../../config';
import { resolveChangeUnitRef, createChangeUnitRef, deriveChangeUnitFeatureId, loadCanonicalChangeUnit } from '../../scripts/utils/change-unit-path';
import { loadCanonicalBlueprint, resolveComponentBlueprintRef } from '../../scripts/utils/component-blueprint-path';
import { resolveComponentClosureInputs } from '../../scripts/utils/component-closure-inputs';
import { featureRelativePath } from '../../scripts/utils/feature-identity';

interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

const FIXTURE_VALID = path.resolve(__dirname, '..', 'fixtures', 'component-blueprint', 'valid');
const BLUEPRINT_ID = 'ledger-app-blueprint';
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

/** 从既有 fixture（新布局）复制为临时工程的完整工作区；返回 root。 */
function buildWorkspaceProject(): string {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-m5a-workspace-'));
  try {
    // 1) 蓝图 + 评审投影（fixture 已是新布局：<features_dir>/<blueprint_id>/blueprint/）
    const featuresDir = path.join(temp, 'doc', 'features');
    const wsDir = path.join(featuresDir, BLUEPRINT_ID);
    const blueprintDir = path.join(wsDir, 'blueprint');
    fs.mkdirSync(blueprintDir, { recursive: true });
    const srcBlueprint = path.join(FIXTURE_VALID, 'doc', 'features', BLUEPRINT_ID, 'blueprint', 'component-blueprint.yaml');
    const srcReview = path.join(FIXTURE_VALID, 'doc', 'features', BLUEPRINT_ID, 'blueprint', 'component-blueprint.review.md');
    fs.copyFileSync(srcBlueprint, path.join(blueprintDir, 'component-blueprint.yaml'));
    fs.copyFileSync(srcReview, path.join(blueprintDir, 'component-blueprint.review.md'));

    // 2) CU 目录整体复制（change-unit.yaml + contracts.yaml 已在 fixture 中）
    for (const unitId of UNIT_IDS) {
      const srcCuDir = path.join(FIXTURE_VALID, 'doc', 'features', BLUEPRINT_ID, unitId);
      const cuDir = path.join(wsDir, unitId);
      fs.mkdirSync(cuDir, { recursive: true });
      fs.copyFileSync(path.join(srcCuDir, 'change-unit.yaml'), path.join(cuDir, 'change-unit.yaml'));
      fs.copyFileSync(path.join(srcCuDir, 'contracts.yaml'), path.join(cuDir, 'contracts.yaml'));
      const featureId = deriveChangeUnitFeatureId(BLUEPRINT_ID, unitId);
      const relFeature = featureDir(temp, featureId);
      assert(relFeature === cuDir, `featureDir 必须等于 CU 物理目录：${relFeature} vs ${cuDir}`);
      fs.mkdirSync(path.join(cuDir, 'spec'), { recursive: true });
      fs.writeFileSync(path.join(cuDir, 'spec', 'spec.md'), `# ${unitId}\n\nscope 施工中\n`, 'utf8');
    }

    // 4) 蓝图 owner 校验所需旁路文件（requirements / mappings / src / test 与 architecture）
    fs.cpSync(path.join(FIXTURE_VALID, 'doc', 'architecture.yaml'), path.join(temp, 'doc', 'architecture.yaml'));
    fs.cpSync(path.join(FIXTURE_VALID, 'doc', 'module-catalog.yaml'), path.join(temp, 'doc', 'module-catalog.yaml'));
    fs.cpSync(path.join(FIXTURE_VALID, 'requirements'), path.join(temp, 'requirements'), { recursive: true });
    fs.cpSync(path.join(FIXTURE_VALID, 'mappings'), path.join(temp, 'mappings'), { recursive: true });
    fs.cpSync(path.join(FIXTURE_VALID, 'contracts'), path.join(temp, 'contracts'), { recursive: true });
    fs.cpSync(path.join(FIXTURE_VALID, 'src'), path.join(temp, 'src'), { recursive: true });
    fs.cpSync(path.join(FIXTURE_VALID, 'test'), path.join(temp, 'test'), { recursive: true });

    // 5) 消费方宿主形态：framework/ 子树标记（inferRepoLayout 要求 skills/ 或 workflows/）
    fs.mkdirSync(path.join(temp, 'framework', 'skills'), { recursive: true });
    fs.mkdirSync(path.join(temp, 'framework', 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(temp, 'framework', 'skills', '.gitkeep'), '');
    return temp;
  } catch (error) {
    fs.rmSync(temp, { recursive: true, force: true });
    throw error;
  }
}

export function runAll(): UnitCaseResult[] {
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
        // 往返：parse(featureId) === (workspace dir, subdir) → 逐字节一致
        assert(featureRelativePath(featureId) === item!.relativePath, 'featureId→路径往返不一致');
      }
      // 工作区容器本身不是 Feature
      assert(!byId.has(BLUEPRINT_ID), '工作区容器不得作为 Feature 返回');
    }));

    results.push(test('生产入口 3：resolveComponentClosureInputs 同工作区枚举零 BLOCKER（proof 12 底座）', () => {
      const blueprint = loadCanonicalBlueprint(temp, BLUEPRINT_ID);
      assert(String(blueprint.blueprint.blueprint_id) === BLUEPRINT_ID, 'loader 必须解析 blueprint_id');
      // 手动构造 owner ref 并先过 resolveComponentBlueprintRef（P1 resolver 全链）
      const blueprintRef = {
        artifact: 'component-blueprint@1' as const,
        component_id: COMPONENT_ID,
        blueprint_id: BLUEPRINT_ID,
        revision: Number(blueprint.blueprint.revision),
        source_fingerprint: String(blueprint.blueprint.source_fingerprint),
        artifact_sha256: blueprint.artifactSha256,
        target: { kind: 'blueprint' as const, id: BLUEPRINT_ID },
      };
      const resolved = resolveComponentBlueprintRef(temp, blueprintRef);
      assert(resolved.blueprint.blueprint_id === BLUEPRINT_ID, 'P1 resolver 定位错误');
      const closure = resolveComponentClosureInputs(temp, BLUEPRINT_ID);
      assert(closure.issues.filter(item => item.severity === 'BLOCKER').length === 0,
        `closure inputs 不应有 BLOCKER：${closure.issues.map(item => item.id).join(', ')}`);
      assert(closure.units.length === UNIT_IDS.length, `closure 输入应含 ${UNIT_IDS.length} 个 CU`);
    }));

    results.push(test('判别 fail-closed：<features_dir> 顶层合法 cu- 编码目录（影子目录）报错', () => {
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
  return results;
}
