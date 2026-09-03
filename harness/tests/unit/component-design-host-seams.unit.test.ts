// ============================================================================
// component-design-host-seams.unit.test.ts — M7 三条 Story 类宿主接缝的仓内契约验收
// ============================================================================
//
// 两件事：
//  1. **随包样例锁定**：`docs/operations/samples/` 下的有效/无效样例（发布件包含路径，
//     不是被排除的 `harness/tests/**`）必须经**同一正式 checker**（生产入口
//     `checkHostSeamMaterials`，即 `check:component-blueprint` 的 --materialization /
//     --projection / --feedback 模式）跑通/跑挂。样例与 schema/renderer 漂移即失败。
//  2. **mock provider / consumer 正反场景**：以仓内 mock 演练三条接缝的方向、权威、
//     缺失与冲突行为——不含任何宿主工程改造。
//
// 不新增 CLI、状态、registry；解析复用既有 resolveCurrentScopeSource。

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as YAML from 'yaml';
import { BlueprintRecord, asRecord, asRecords } from '../../scripts/utils/component-blueprint-model';
import { componentBlueprintPath, loadCanonicalBlueprint, sha256Bytes } from '../../scripts/utils/component-blueprint-path';
import { renderBlueprintReviewMarkdown } from '../../scripts/utils/blueprint-review-projection';
import { reconcileP1DerivedResults } from '../../scripts/utils/blueprint-reconciliation';
import {
  declaredFormalRequirementItems,
  materializedScopeItems,
  validateBlueprintReviewFeedback,
  validateRequirementSourceMaterialization,
} from '../../scripts/utils/blueprint-host-seams';
import {
  checkCanonicalComponentBlueprint,
  checkHostSeamMaterials,
  checkMaterializationOnly,
} from '../../scripts/check-component-blueprint';

interface UnitCaseResult { name: string; ok: boolean; error?: string }

const FRAMEWORK_ROOT = path.resolve(__dirname, '..', '..', '..');
/** 发布件包含路径（`docs/` 入包，`harness/tests/**` 被排除）——样例必须落在这里。 */
const SAMPLES_DIR = path.join(FRAMEWORK_ROOT, 'docs', 'operations', 'samples');
const BASE_PROJECT = path.resolve(__dirname, '..', 'fixtures', 'component-blueprint', 'valid');
const BLUEPRINT_ID = 'ledger-app-blueprint';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function test(name: string, run: () => void): UnitCaseResult {
  try { run(); return { name, ok: true }; }
  catch (error) { return { name, ok: false, error: (error as Error).stack ?? (error as Error).message }; }
}

function withProject(run: (projectRoot: string) => void): void {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-host-seams-'));
  const projectRoot = path.join(tempRoot, 'project');
  fs.cpSync(BASE_PROJECT, projectRoot, { recursive: true });
  try { run(projectRoot); } finally { fs.rmSync(tempRoot, { recursive: true, force: true }); }
}

function samplePath(name: string): string {
  const abs = path.join(SAMPLES_DIR, name);
  assert(fs.existsSync(abs), `随包样例缺失（必须落发布件包含路径 docs/operations/samples/）：${abs}`);
  return abs;
}

/** 生产入口：与 CLI 完全同一条路径，不在测试里重实现校验编排。 */
function runSeamCheck(projectRoot: string, args: { materialization?: string; projection?: string; feedback?: string }) {
  const loaded = checkCanonicalComponentBlueprint(projectRoot, BLUEPRINT_ID);
  assert(
    loaded.issues.filter(item => item.severity === 'BLOCKER').length === 0,
    `前提：基线蓝图应 admitted，实际 ${loaded.issues.map(item => item.id).join(', ')}`,
  );
  return checkHostSeamMaterials(projectRoot, loaded, args);
}

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];

  // -------------------------------------------------------------------------
  // 随包样例：由同一正式 checker 验证正例通过、反例失败
  // -------------------------------------------------------------------------

  results.push(test('shipped samples live on the release-included path, not under harness/tests', () => {
    const excluded = JSON.parse(fs.readFileSync(path.join(FRAMEWORK_ROOT, 'scripts', 'release-excludes.json'), 'utf8')) as {
      excludeRootDirs: string[]; excludeGlobs: string[];
    };
    const rel = path.relative(FRAMEWORK_ROOT, SAMPLES_DIR).replace(/\\/g, '/');
    assert(rel.startsWith('docs/'), `样例目录必须在 docs/ 下，实际 ${rel}`);
    assert(!excluded.excludeRootDirs.includes('docs'), 'docs/ 不应被排除出发布件');
    // docs/ 下允许存在针对 vendor 文档的排除（3.0.0 起 docs/vendor/**），但样例目录自身不得被任何 docs/ 规则命中
    const docsGlobsCoveringSamples = excluded.excludeGlobs.filter(
      glob => glob.startsWith('docs/') && `${rel}/`.startsWith(glob.replace(/[/]?[*][*]$/, '/')),
    );
    assert(
      docsGlobsCoveringSamples.length === 0,
      `样例目录 ${rel} 被发布排除规则命中：${docsGlobsCoveringSamples.join(', ')}`,
    );
    // 反向确认：harness/tests/** 确实被排除——样例不能放那里
    assert(excluded.excludeGlobs.includes('harness/tests/**'), 'harness/tests/** 应被排除（样例不得放 fixtures）');
  }));

  // -------------------------------------------------------------------------
  // 返修 P0-2：物化在建蓝图**之前**，materialization 模式不得要求蓝图已存在
  // -------------------------------------------------------------------------
  results.push(test('M7 fix: materialization validates in a workspace that has no blueprint yet', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-pre-blueprint-'));
    const projectRoot = path.join(tempRoot, 'project');
    try {
      // 空工作区：只有需求材料，没有任何 canonical blueprint
      fs.mkdirSync(path.join(projectRoot, 'doc', 'features'), { recursive: true });
      fs.mkdirSync(path.join(projectRoot, 'requirements'), { recursive: true });
      fs.copyFileSync(
        path.join(BASE_PROJECT, 'requirements', 'ledger.md'),
        path.join(projectRoot, 'requirements', 'ledger.md'),
      );
      // 前提证伪：加载蓝图的路径此时必然抛错——证明本用例真的在"无蓝图"现场
      let loadFailed = '';
      try { checkCanonicalComponentBlueprint(projectRoot, BLUEPRINT_ID); }
      catch (error) { loadFailed = (error as { code?: string }).code ?? 'threw'; }
      assert(loadFailed === 'component_blueprint_missing', `前提不成立：期望无蓝图，实际 ${loadFailed || '(加载成功)'}`);

      // materialization 模式必须独立跑通，不被 component_blueprint_missing 前置阻断
      const only = checkMaterializationOnly(
        projectRoot, BLUEPRINT_ID, samplePath('requirement-source-materialization.valid.json'),
      );
      assert(only.modes.includes('requirement-source-materialization'), '未进入 materialization 模式');
      assert(only.issues.length === 0, `前蓝图物化被误拒：${only.issues.map(i => `${i.id}@${i.path}`).join(', ')}`);

      // 无蓝图时同样能抓住真实缺陷（不是"跳过校验"式的假通过）
      const bad = checkMaterializationOnly(
        projectRoot, BLUEPRINT_ID, samplePath('requirement-source-materialization.invalid-hash.json'),
      );
      assert(
        bad.issues.some(item => item.id === 'materialization_source_hash_mismatch'),
        `前蓝图模式下 hash 冲突未被抓住：${bad.issues.map(i => i.id).join(', ')}`,
      );
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }));

  // -------------------------------------------------------------------------
  // 返修 P1-2：source_revision 与 provenance 一致性，判据与 P1 current-scope 同源
  // -------------------------------------------------------------------------
  results.push(test('M7 fix: materialized source_revision must agree with its provenance', () => {
    withProject(projectRoot => {
      const doc = JSON.parse(fs.readFileSync(samplePath('requirement-source-materialization.valid.json'), 'utf8'));
      doc.items[0].source_revision = 'DIFFERENT-r99';
      const issues = validateRequirementSourceMaterialization(doc, { projectRoot, blueprintId: BLUEPRINT_ID });
      const mismatch = issues.find(item => item.id === 'materialization_provenance_mismatch');
      assert(mismatch, `source_revision 不一致未被抓住：${issues.map(i => i.id).join(', ') || '(none)'}`);
      assert(
        mismatch!.message.includes('DIFFERENT-r99') && mismatch!.message.includes('fixture-r1'),
        `诊断未同时报告两值：${mismatch!.message}`,
      );
    });
  }));

  // 镜像 schema 与字段语义权威不得漂移（宿主可读的静态镜像，判据仍在 P1 helper）
  results.push(test('M7 fix: materialization schema mirrors the authoritative currentScopeItem shape', () => {
    const authority = JSON.parse(fs.readFileSync(
      path.join(FRAMEWORK_ROOT, 'harness', 'schemas', 'app-component-blueprint.schema.json'), 'utf8',
    )) as { $defs: Record<string, { required: string[]; properties: Record<string, unknown> }> };
    const mirror = JSON.parse(fs.readFileSync(
      path.join(FRAMEWORK_ROOT, 'harness', 'schemas', 'requirement-source-materialization.schema.json'), 'utf8',
    )) as { $defs: Record<string, { required: string[]; properties: Record<string, unknown> }> };
    const auth = authority.$defs.currentScopeItem!;
    const mir = mirror.$defs.materializedScopeItem!;
    // 权威的每个必填字段镜像里都必须在，且 required 语义一致；镜像只允许**多**出 authority
    for (const key of auth.required) {
      assert(mir.required.includes(key), `镜像缺权威必填字段 ${key}`);
    }
    const extraRequired = mir.required.filter(k => !auth.required.includes(k));
    assert(
      extraRequired.length === 1 && extraRequired[0] === 'authority',
      `镜像 required 只允许额外增加 authority，实际额外：${extraRequired.join(', ')}`,
    );
    for (const key of Object.keys(auth.properties)) {
      assert(key in mir.properties, `镜像缺权威字段 ${key}`);
      assert(
        JSON.stringify(mir.properties[key]) === JSON.stringify(auth.properties[key]),
        `镜像字段 ${key} 与权威定义漂移：\n  权威=${JSON.stringify(auth.properties[key])}\n  镜像=${JSON.stringify(mir.properties[key])}`,
      );
    }
    const extraProps = Object.keys(mir.properties).filter(k => !(k in auth.properties));
    assert(
      extraProps.length === 1 && extraProps[0] === 'authority',
      `镜像只允许额外增加 authority 字段，实际额外：${extraProps.join(', ')}`,
    );
  }));

  results.push(test('sample: valid materialization passes through the formal checker', () => {
    withProject(projectRoot => {
      const seam = runSeamCheck(projectRoot, { materialization: samplePath('requirement-source-materialization.valid.json') });
      assert(seam.modes.includes('requirement-source-materialization'), '未进入 materialization 校验模式');
      assert(seam.issues.length === 0, `有效样例被误拒：${seam.issues.map(item => `${item.id}@${item.path}`).join(', ')}`);
    });
  }));

  results.push(test('sample: materialization with a conflicting hash fails and reports both values', () => {
    withProject(projectRoot => {
      const seam = runSeamCheck(projectRoot, { materialization: samplePath('requirement-source-materialization.invalid-hash.json') });
      const mismatch = seam.issues.find(item => item.id === 'materialization_source_hash_mismatch');
      assert(mismatch, `无效样例未被拒绝：${seam.issues.map(item => item.id).join(', ')}`);
      assert(
        mismatch!.message.includes('sha256:0000') && /实际原始字节 sha256:[0-9a-f]{64}/.test(mismatch!.message),
        `hash 冲突诊断未同时报告声明值与实际值：${mismatch!.message}`,
      );
    });
  }));

  results.push(test('sample: valid review projection matches the deterministic renderer byte for byte', () => {
    withProject(projectRoot => {
      const seam = runSeamCheck(projectRoot, { projection: samplePath('blueprint-review-projection.valid.md') });
      assert(seam.modes.includes('blueprint-review-publication'), '未进入 publication 校验模式');
      assert(seam.issues.length === 0, `有效投影样例被误拒：${seam.issues.map(item => item.id).join(', ')}`);
    });
  }));

  results.push(test('sample: a projection that adds a design fact is rejected', () => {
    withProject(projectRoot => {
      const seam = runSeamCheck(projectRoot, { projection: samplePath('blueprint-review-projection.invalid-added-fact.md') });
      assert(
        seam.issues.some(item => item.id === 'publication_projection_added_facts'),
        `投影新增设计事实未被拒绝：${seam.issues.map(item => item.id).join(', ')}`,
      );
    });
  }));

  results.push(test('sample: valid feedback passes and only the authoritative ruling can rule', () => {
    withProject(projectRoot => {
      const seam = runSeamCheck(projectRoot, { feedback: samplePath('blueprint-review-feedback.valid.json') });
      assert(seam.modes.includes('blueprint-review-feedback'), '未进入 feedback 校验模式');
      assert(seam.issues.length === 0, `有效反馈样例被误拒：${seam.issues.map(item => `${item.id}@${item.path}`).join(', ')}`);

      const loaded = loadCanonicalBlueprint(projectRoot, BLUEPRINT_ID);
      const intake = validateBlueprintReviewFeedback(
        JSON.parse(fs.readFileSync(samplePath('blueprint-review-feedback.valid.json'), 'utf8')),
        loaded.blueprint,
      );
      // 四类里只有 authoritative_ruling 进 decided_with_authority
      assert(
        intake.authoritativeRulingCandidateIds.join(',') === 'fb-ruling-seam-shape',
        `授权裁决集合不正确：${intake.authoritativeRulingCandidateIds.join(',')}`,
      );
      assert(intake.requiresReconciliation, '合法授权裁决必须要求生成新 revision');
    });
  }));

  results.push(test('sample: feedback claiming authority without it cannot be laundered into decided_with_authority', () => {
    withProject(projectRoot => {
      const seam = runSeamCheck(projectRoot, { feedback: samplePath('blueprint-review-feedback.invalid-authority.json') });
      assert(
        seam.issues.some(item => item.id === 'review_feedback_authority_insufficient'),
        `authority 不足的反馈未被拒绝：${seam.issues.map(item => item.id).join(', ')}`,
      );
      const loaded = loadCanonicalBlueprint(projectRoot, BLUEPRINT_ID);
      const intake = validateBlueprintReviewFeedback(
        JSON.parse(fs.readFileSync(samplePath('blueprint-review-feedback.invalid-authority.json'), 'utf8')),
        loaded.blueprint,
      );
      assert(intake.authoritativeRulingCandidateIds.length === 0, 'authority 不足的反馈被洗白进了裁决集合');
      assert(!intake.requiresReconciliation, 'authority 不足的反馈不得触发 revision 递进');
    });
  }));

  // -------------------------------------------------------------------------
  // mock provider / consumer 正反场景
  // -------------------------------------------------------------------------

  results.push(test('mock requirement-source provider: materialized items feed blueprint scope unchanged', () => {
    withProject(projectRoot => {
      const doc = JSON.parse(fs.readFileSync(samplePath('requirement-source-materialization.valid.json'), 'utf8'));
      assert(
        validateRequirementSourceMaterialization(doc, { projectRoot, blueprintId: BLUEPRINT_ID, componentId: 'ledger' }).length === 0,
        'mock provider 的合法产物被拒',
      );
      // 消费面：物化条目原样成为蓝图 current_scope_items（同一形状，不是第二套 schema）
      const produced = materializedScopeItems(doc);
      const actual = asRecords(asRecord(asRecord(loadCanonicalBlueprint(projectRoot, BLUEPRINT_ID).blueprint.discovery)?.inputs)?.current_scope_items);
      assert(JSON.stringify(produced) === JSON.stringify(actual), `物化产物与蓝图 scope item 形状不一致：\n${JSON.stringify(produced)}\n${JSON.stringify(actual)}`);
      // 上游显式分类具有权威性
      assert(declaredFormalRequirementItems(doc).join(',') === 'req-ledger-refresh', '上游显式 formal_requirement 分类未被识别');
    });
  }));

  results.push(test('mock requirement-source provider: required-but-missing becomes a blocker, cross-workspace fails closed', () => {
    withProject(projectRoot => {
      // 缺失：空 items → 结构化 blocker，不凭转述补造
      const empty = { artifact: 'requirement-source-materialization@1', blueprint_id: BLUEPRINT_ID, component_id: 'ledger', items: [] };
      const emptyIssues = validateRequirementSourceMaterialization(empty, { projectRoot, blueprintId: BLUEPRINT_ID });
      assert(emptyIssues.some(item => item.id === 'materialization_items_empty'), `缺材料未成 blocker：${emptyIssues.map(i => i.id).join(', ')}`);

      // 跨工作区材料混用 fail-closed
      const foreign = JSON.parse(fs.readFileSync(samplePath('requirement-source-materialization.valid.json'), 'utf8'));
      foreign.blueprint_id = 'other-blueprint';
      const foreignIssues = validateRequirementSourceMaterialization(foreign, { projectRoot, blueprintId: BLUEPRINT_ID });
      assert(foreignIssues.some(item => item.id === 'materialization_blueprint_mismatch'), '跨工作区材料未 fail-closed');

      // 同一 item_id 两份不同字节 → 冲突 fail-closed，同时报告双方，不 last-write-wins
      const conflicting = JSON.parse(fs.readFileSync(samplePath('requirement-source-materialization.valid.json'), 'utf8'));
      const second = JSON.parse(JSON.stringify(conflicting.items[0]));
      second.source_sha256 = `sha256:${'a'.repeat(64)}`;
      conflicting.items.push(second);
      const conflictIssues = validateRequirementSourceMaterialization(conflicting, { projectRoot, blueprintId: BLUEPRINT_ID });
      const conflict = conflictIssues.find(item => item.id === 'materialization_source_conflict');
      assert(conflict, `同 item_id 冲突未 fail-closed：${conflictIssues.map(i => i.id).join(', ')}`);
      assert(conflict!.message.includes('sha256:aaaa'), `冲突诊断未报告双方：${conflict!.message}`);

      // 缺 authority owner
      const noAuthority = JSON.parse(fs.readFileSync(samplePath('requirement-source-materialization.valid.json'), 'utf8'));
      delete noAuthority.items[0].authority.owner;
      assert(
        validateRequirementSourceMaterialization(noAuthority, { projectRoot, blueprintId: BLUEPRINT_ID })
          .some(item => item.id === 'materialization_authority_missing'),
        'authority.owner 缺失未被抓住',
      );
    });
  }));

  results.push(test('mock publication consumer: assembles a demo artifact from one admitted revision only', () => {
    withProject(projectRoot => {
      const loaded = loadCanonicalBlueprint(projectRoot, BLUEPRINT_ID);
      const projection = renderBlueprintReviewMarkdown(loaded.blueprint, loaded.artifactSha256);

      // mock consumer：只做重排版式/加标题的装配，不新增设计事实
      const storyDocument = ['# Story Document（宿主装配）', '', '> 本文件是投影的重排版式，零新设计事实。', '', projection].join('\n');
      assert(storyDocument.includes(`  revision: ${String(loaded.blueprint.revision)}`), 'Story Document 未携带被评审 revision');
      assert(storyDocument.includes(`  artifact_sha256: ${loaded.artifactSha256}`), 'derived_from 未精确指向该 revision 的字节');

      // 投影严格派生自**一个** revision：换 revision 即换字节
      const other = JSON.parse(JSON.stringify(loaded.blueprint)) as BlueprintRecord;
      other.revision = Number(loaded.blueprint.revision) + 1;
      const otherProjection = renderBlueprintReviewMarkdown(other, loaded.artifactSha256);
      assert(otherProjection !== projection, '不同 revision 的投影不应字节相同');

      // 确定性：同一输入重算逐字节一致
      assert(renderBlueprintReviewMarkdown(loaded.blueprint, loaded.artifactSha256) === projection, '投影 renderer 非确定性');
    });
  }));

  results.push(test('mock review-feedback provider: an authorized ruling yields a NEW revision and stales derived results', () => {
    withProject(projectRoot => {
      const loaded = loadCanonicalBlueprint(projectRoot, BLUEPRINT_ID);
      const beforeBytes = fs.readFileSync(componentBlueprintPath(projectRoot, BLUEPRINT_ID));
      const intake = validateBlueprintReviewFeedback(
        JSON.parse(fs.readFileSync(samplePath('blueprint-review-feedback.valid.json'), 'utf8')),
        loaded.blueprint,
      );
      assert(intake.requiresReconciliation, '前提：样例含一条合法授权裁决');

      // 经既有 reconciliation 生成新 revision（不回写旧 revision）
      const nextRevision = Number(loaded.blueprint.revision) + 1;
      const nextBlueprint = JSON.parse(JSON.stringify(loaded.blueprint)) as BlueprintRecord;
      nextBlueprint.revision = nextRevision;
      nextBlueprint.decision_fingerprint = `sha256:${'d'.repeat(64)}`;
      const reconciled = reconcileP1DerivedResults(
        asRecords(loaded.blueprint.derived_results),
        nextRevision,
        String(loaded.blueprint.source_fingerprint),
        String(nextBlueprint.decision_fingerprint),
      );
      assert(reconciled.length > 0 && reconciled.every(item => item.status === 'stale'), '授权裁决后受影响派生结论未标 stale');
      assert(
        reconciled.every(item => item.superseded_by_revision === nextRevision),
        '历史 stale 结论未指向 superseding revision',
      );
      // 旧 revision 字节未被改写
      assert(fs.readFileSync(componentBlueprintPath(projectRoot, BLUEPRINT_ID)).equals(beforeBytes), 'intake 阶段改写了旧 revision 字节');

      // 反向：反馈指向旧 revision（回写企图）必须 fail-closed
      const stale = JSON.parse(fs.readFileSync(samplePath('blueprint-review-feedback.valid.json'), 'utf8'));
      stale.source_revision = Number(loaded.blueprint.revision) - 1;
      for (const item of stale.items) item.source_revision = stale.source_revision;
      const staleIntake = validateBlueprintReviewFeedback(stale, loaded.blueprint);
      assert(
        staleIntake.issues.some(item => item.id === 'review_feedback_stale_source_revision'),
        `回写旧 revision 的反馈未被拒绝：${staleIntake.issues.map(i => i.id).join(', ')}`,
      );
      assert(staleIntake.authoritativeRulingCandidateIds.length === 0, '被拒批次仍产出了裁决集合');
    });
  }));

  // 返修 P1-3：批次身份核验含 component_id；四类语义与既有 P1 reconciliation 契约一致
  results.push(test('M7 fix: feedback component identity disagreement fails closed', () => {
    withProject(projectRoot => {
      const loaded = loadCanonicalBlueprint(projectRoot, BLUEPRINT_ID);
      const doc = JSON.parse(fs.readFileSync(samplePath('blueprint-review-feedback.valid.json'), 'utf8'));
      doc.component_id = 'totally-other-component';
      const intake = validateBlueprintReviewFeedback(doc, loaded.blueprint);
      const mismatch = intake.issues.find(item => item.id === 'review_feedback_component_mismatch');
      assert(mismatch, `component_id 不一致未被抓住：${intake.issues.map(i => i.id).join(', ') || '(none)'}`);
      assert(
        mismatch!.message.includes('totally-other-component') && mismatch!.message.includes(String(loaded.blueprint.component_id)),
        `诊断未同时报告双方：${mismatch!.message}`,
      );
      assert(intake.authoritativeRulingCandidateIds.length === 0, '身份不一致的批次仍产出了裁决集合');
      assert(!intake.requiresReconciliation, '身份不一致的批次不得要求 revision 递进');
    });
  }));

  results.push(test('M7 fix: accepted fact supplements share the existing new-revision rule; opinions never do', () => {
    withProject(projectRoot => {
      const loaded = loadCanonicalBlueprint(projectRoot, BLUEPRINT_ID);
      const base = JSON.parse(fs.readFileSync(samplePath('blueprint-review-feedback.valid.json'), 'utf8'));

      // 只留一条事实补充：既有 P1 契约是"新事实、权威裁决 MUST 生成新 revision"，
      // 因此被接受后它同样在 revision 递进覆盖面内——不是"永远不改 revision"。
      const factOnly = { ...base, items: base.items.filter((i: { kind: string }) => i.kind === 'fact_supplement') };
      const factIntake = validateBlueprintReviewFeedback(factOnly, loaded.blueprint);
      assert(factIntake.issues.length === 0, `合法事实补充被拒：${factIntake.issues.map(i => i.id).join(', ')}`);
      assert(factIntake.authoritativeRulingCandidateIds.length === 0, '事实补充不得进入 decided_with_authority');
      assert(factIntake.factSupplementCandidateIds.length === 1, '事实补充未被识别');
      assert(factIntake.requiresReconciliation, '被接受的事实补充应落在既有 revision 递进覆盖面内');

      // 只留意见与建议：永远不触发 revision 递进
      const softOnly = {
        ...base,
        items: base.items.filter((i: { kind: string }) => i.kind === 'opinion' || i.kind === 'suggestion'),
      };
      const softIntake = validateBlueprintReviewFeedback(softOnly, loaded.blueprint);
      assert(softIntake.issues.length === 0, `合法意见/建议被拒：${softIntake.issues.map(i => i.id).join(', ')}`);
      assert(!softIntake.requiresReconciliation, '意见与建议不得触发 revision 递进');
      assert(
        softIntake.authoritativeRulingCandidateIds.length === 0 && softIntake.factSupplementCandidateIds.length === 0,
        '意见/建议被误分类',
      );
    });
  }));

  results.push(test('mock review-feedback provider: unresolvable target and non-ruling decision fail closed', () => {
    withProject(projectRoot => {
      const loaded = loadCanonicalBlueprint(projectRoot, BLUEPRINT_ID);
      const doc = JSON.parse(fs.readFileSync(samplePath('blueprint-review-feedback.valid.json'), 'utf8'));

      const dangling = JSON.parse(JSON.stringify(doc));
      dangling.items[0].target_ref = 'view:logical/node:does-not-exist';
      assert(
        validateBlueprintReviewFeedback(dangling, loaded.blueprint).issues
          .some(item => item.id === 'review_feedback_target_unresolvable'),
        'target_ref 无法解析未被抓住',
      );

      const laundered = JSON.parse(JSON.stringify(doc));
      laundered.items[0].decision = { verdict: 'accept', rationale: '想让一条意见带上决策语义' };
      assert(
        validateBlueprintReviewFeedback(laundered, loaded.blueprint).issues
          .some(item => item.id === 'review_feedback_non_ruling_carries_decision'),
        '非裁决类反馈携带 decision 未被抓住',
      );
    });
  }));

  // -------------------------------------------------------------------------
  // 发现路径闭环：交接指南与样例互相点名，且指南进入发布件
  // -------------------------------------------------------------------------

  results.push(test('the host adaptation guide is release-included and names every sample and schema', () => {
    const guide = path.join(FRAMEWORK_ROOT, 'docs', 'operations', 'component-design-host-adaptation.md');
    assert(fs.existsSync(guide), '宿主适配指南缺失');
    const text = fs.readFileSync(guide, 'utf8');
    for (const sample of fs.readdirSync(SAMPLES_DIR)) {
      assert(text.includes(`samples/${sample}`), `指南未点名随包样例 ${sample}`);
    }
    for (const schema of [
      'requirement-source-materialization.schema.json',
      'blueprint-review-feedback.schema.json',
      'app-component-blueprint.schema.json',
    ]) {
      assert(text.includes(schema), `指南未点名发布态 schema ${schema}`);
    }
    for (const schema of ['requirement-source-materialization.schema.json', 'blueprint-review-feedback.schema.json']) {
      assert(fs.existsSync(path.join(FRAMEWORK_ROOT, 'harness', 'schemas', schema)), `发布件内 schema 缺失：${schema}`);
    }
    // DOC_INVENTORY 登记
    const inventory = YAML.parse(fs.readFileSync(path.join(FRAMEWORK_ROOT, 'docs', 'DOC_INVENTORY.yaml'), 'utf8')) as {
      docs: Array<{ path: string }>;
    };
    assert(
      inventory.docs.some(doc => doc.path === 'framework/docs/operations/component-design-host-adaptation.md'),
      '宿主适配指南未登记到 DOC_INVENTORY',
    );
  }));

  return results;
}

if (require.main === module) {
  const results = runAll();
  for (const result of results) console.log(`${result.ok ? 'PASS' : 'FAIL'}  ${result.name}${result.ok ? '' : `\n  ${result.error}`}`);
  process.exit(results.every(result => result.ok) ? 0 : 1);
}
