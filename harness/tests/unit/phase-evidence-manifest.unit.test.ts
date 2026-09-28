// phase-evidence-manifest.unit.test.ts — t8 阶段证据快照（goal-fakepass-hardening）
//
// 覆盖面（openspec harness-gates/feature-artifact-layout delta）：
//   - loader 表一致性（inputs 与 spec-loader REQUIRED/OPTIONAL 同源，无第二手写表）
//   - 无环封装：回执/manifest 自身禁入集合；规范化剔指针幂等；aggregate 不含时间戳
//   - staleness 重算：input/output 变更、回执变更、缺 manifest、下游传染

import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { clearFrameworkConfigCache, resolveFeatureArtifact } from '../../config';
import {
  REQUIRED_FEATURE_FILES_BY_PHASE,
  OPTIONAL_FEATURE_FILES_BY_PHASE,
} from '../../scripts/utils/spec-loader';
import {
  canonicalizeReceiptContent,
  computeCanonicalReceiptSha256,
  loadPhaseEvidenceManifest,
  phaseEvidenceManifestPath,
  receiptPathForPhase,
  recomputePhaseEvidenceStaleness,
  resolvePhaseEvidenceManifest,
  writePhaseEvidenceManifest,
  writeReceiptManifestPointer,
  verifyPhaseEvidenceManifestWithStagedOutputs,
  sha256File,
} from '../../scripts/utils/phase-evidence-manifest';
import { resolveFactsAbsPath, factsBaselineFingerprint, type FactsInvocationContext } from '../../scripts/utils/context-facts';
import { buildVerifierMaterialView } from '../../scripts/utils/verifier-material';
import { readBoundInput, resolveCapabilityInputs, type InputBinding } from '../../scripts/utils/capability-resolution';
import { reconcileChangeUnitBlueprintRefs } from '../../scripts/utils/change-unit-design-preparation';
import { changeUnitPath } from '../../scripts/utils/change-unit-path';
import { componentBlueprintPath } from '../../scripts/utils/component-blueprint-path';
import { stableStringify } from '../../scripts/utils/phase-evidence-manifest';
import { loadHostSnapshot, SNAPSHOT_CU_FEATURE } from '../fixtures/host-snapshot-3.1.0/generate';
import type { Phase } from '../../scripts/utils/types';
import type { UnitCaseResult } from '../run-unit';
import * as crypto from 'crypto';
import * as YAML from 'yaml';

const FEATURE = 'ev-manifest-fixture';

function mkProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-evman-'));
  clearFrameworkConfigCache();
  return root;
}

function writeArtifact(root: string, name: string, content: string): string {
  const p = resolveFeatureArtifact(root, FEATURE, name).canonicalPath;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf-8');
  return p;
}

function writeReceipt(root: string, phase: string, body: string): string {
  const p = receiptPathForPhase(root, FEATURE, phase);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body, 'utf-8');
  return p;
}

function seedSpecPhase(root: string): void {
  writeArtifact(root, 'spec.md', '# spec v1\n');
  writeArtifact(root, 'acceptance.yaml', 'criteria: []\n');
  writeReceipt(root, 'spec', 'feature: "x"\nphase: "spec"\nverdict: PASS\n');
}

const FIXED_NOW = () => new Date('2026-07-13T00:00:00.000Z');

/** 生成 manifest + 回写回执指针（生产封装序）——staleness 测试须走此路径，否则缺指针=tampered */
function writeManifestWithPointer(root: string, phase: string): void {
  const written = writePhaseEvidenceManifest(root, resolvePhaseEvidenceManifest({ projectRoot: root, feature: FEATURE, phase: phase as Phase, now: FIXED_NOW }));
  writeReceiptManifestPointer(root, FEATURE, phase, `doc/features/${FEATURE}/${phase}/reports/phase-evidence-manifest.json`, written.sha256);
}

// ---- plan c4e7a9b2 §6 B2：已证明业务内容相同的身份更新不触发重验（上一版宿主快照的 CU Feature） ----
const B2_BLUEPRINT = 'ledger-app-blueprint';
type Snapshot = ReturnType<typeof loadHostSnapshot>;
type Blueprint = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function withCuSnapshot(run: (s: Snapshot) => void): void {
  const s = loadHostSnapshot();
  try {
    clearFrameworkConfigCache();
    run(s);
  } finally {
    clearFrameworkConfigCache();
    fs.rmSync(s.root, { recursive: true, force: true });
  }
}
/** 蓝图升一个 revision 并改内容 → 生产调和 writer 原位升版 CU 指针、刷新派生投影。 */
function bumpAndReconcile(s: Snapshot, mutate: (bp: Blueprint) => void): ReturnType<typeof reconcileChangeUnitBlueprintRefs> {
  const file = componentBlueprintPath(s.root, B2_BLUEPRINT);
  const bp = YAML.parse(fs.readFileSync(file, 'utf8')) as Blueprint;
  bp.revision = Number(bp.revision) + 1;
  for (const result of bp.derived_results ?? []) result.input_revision = bp.revision;
  mutate(bp);
  fs.writeFileSync(file, YAML.stringify(bp));
  clearFrameworkConfigCache();
  return reconcileChangeUnitBlueprintRefs(s.root, B2_BLUEPRINT);
}
const bumped = (r: ReturnType<typeof reconcileChangeUnitBlueprintRefs>): boolean => r.bumped.some(b => b.change_unit_id === 'ledger-refresh') && !r.skipped.length;
/** 本 CU（ledger-refresh）未消费的蓝图内容：开放缺口的解锁条件。 */
export const changeUnconsumedBlueprintContent = (bp: Blueprint): void => { bp.decisions_and_gaps.gaps[0].unlock_condition += '（措辞调整）'; };
/** 本 CU 消费的 target（design_refs 与 touches 都指向的 development 节点 ledger-module）的内容；不进派生投影。 */
export const changeConsumedTargetContent = (bp: Blueprint): void => {
  const node = (bp.design_views as Blueprint[]).flatMap(view => view.nodes ?? []).find((n: Blueprint) => n.node_id === 'ledger-module');
  assert(node, '快照蓝图缺 ledger-module');
  node.target_state += '（目标态调整）';
};
function b2Files(s: Snapshot): string[] {
  return [
    changeUnitPath(s.root, B2_BLUEPRINT, 'ledger-refresh'), componentBlueprintPath(s.root, B2_BLUEPRINT),
    ...['acceptance.yaml', 'contracts.yaml', 'use-cases.yaml'].map(name => resolveFeatureArtifact(s.root, SNAPSHOT_CU_FEATURE, name).actualPath),
  ];
}
const relOf = (s: Snapshot, abs: string): string => path.relative(s.root, abs).split(path.sep).join('/');
/** 蓝图新增一条已裁决的 dependency_edge remove 架构影响决策（不进任何 CU 的 design_refs）。 */
const addEdgeRemoval = (id: string, from: string, to: string) => (bp: Blueprint): void => {
  bp.decisions_and_gaps.decisions.push({ decision_id: id, kind: 'architecture_impact', change: 'dependency_edge', from, to, direction: 'remove',
    rationale: 'fixture', status: 'decided_with_authority', owner: 'architecture-owner', provenance: bp.provenance, verification_refs: [`verify:${id}`] });
};

interface Case { name: string; run: () => void }

const cases: Case[] = [
  {
    name: '下游责任阶段可推进其源码，非责任漂移仍使上游 stale',
    run: () => {
      const root = mkProject();
      const source = path.join(root, 'src', 'value.ts');
      fs.mkdirSync(path.dirname(source), { recursive: true });
      fs.writeFileSync(source, 'before\n');
      const planFacts: FactsInvocationContext = {
        subject: { feature: FEATURE, run_id: 'run' }, first_phase: 'plan',
        source_paths: ['src/value.ts'], source_owners: { 'src/value.ts': 'coding' }, required_input_snippets: [],
      };
      writePhaseEvidenceManifest(root, resolvePhaseEvidenceManifest({ projectRoot: root, feature: FEATURE, phase: 'plan', factsContext: planFacts }));
      fs.writeFileSync(source, 'after\n');
      assert.strictEqual(recomputePhaseEvidenceStaleness(root, FEATURE, ['plan', 'coding'])[0].verdict, 'stale', '无责任阶段证据时不得洗绿');
      writePhaseEvidenceManifest(root, resolvePhaseEvidenceManifest({
        projectRoot: root, feature: FEATURE, phase: 'coding',
        factsContext: { ...planFacts, baseline: { established_by: 'plan', fingerprint: 'baseline', dependencies: [] } },
      }));
      const advanced = recomputePhaseEvidenceStaleness(root, FEATURE, ['plan', 'coding']);
      assert.deepStrictEqual(advanced.map(item => item.verdict), ['fresh', 'fresh']);
      assert.strictEqual(recomputePhaseEvidenceStaleness(root, FEATURE, ['plan'])[0].verdict, 'fresh', 'owner 承接不得依赖调用方传完整 chain');
      fs.writeFileSync(source, 'unattributed\n');
      assert.deepStrictEqual(recomputePhaseEvidenceStaleness(root, FEATURE, ['plan', 'coding']).map(item => item.verdict), ['stale', 'stale']);
    },
  },
  {
    name: 'UT 自有测试不反向作废 coding/review，产品源码变化仍从 coding 失效',
    run: () => {
      const root = mkProject();
      for (const [rel, body] of [['src/value.ts', 'source\n'], ['test/value.test.ts', 'test one\n']] as const) {
        const abs = path.join(root, rel); fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, body);
      }
      const common = { subject: { feature: FEATURE, run_id: 'run' } as const, first_phase: 'coding', required_input_snippets: [] as string[] };
      writePhaseEvidenceManifest(root, resolvePhaseEvidenceManifest({ projectRoot: root, feature: FEATURE, phase: 'coding', factsContext: { ...common, source_paths: ['src/value.ts'], source_owners: { 'src/value.ts': 'coding' } } }));
      writePhaseEvidenceManifest(root, resolvePhaseEvidenceManifest({ projectRoot: root, feature: FEATURE, phase: 'review', factsContext: { ...common, source_paths: ['src/value.ts'], baseline: { established_by: 'coding', fingerprint: 'baseline', dependencies: [] } } }));
      const utFacts: FactsInvocationContext = { ...common, source_paths: ['src/value.ts', 'test/value.test.ts'], source_owners: { 'test/value.test.ts': 'ut' }, baseline: { established_by: 'coding', fingerprint: 'baseline', dependencies: [] } };
      writePhaseEvidenceManifest(root, resolvePhaseEvidenceManifest({ projectRoot: root, feature: FEATURE, phase: 'ut', factsContext: utFacts }));
      fs.writeFileSync(path.join(root, 'test/value.test.ts'), 'test two\n');
      assert.deepStrictEqual(recomputePhaseEvidenceStaleness(root, FEATURE, ['coding', 'review']).map(item => item.verdict), ['fresh', 'fresh']);
      assert.strictEqual(recomputePhaseEvidenceStaleness(root, FEATURE, ['coding', 'review', 'ut'])[2].verdict, 'stale');
      writePhaseEvidenceManifest(root, resolvePhaseEvidenceManifest({ projectRoot: root, feature: FEATURE, phase: 'ut', factsContext: utFacts }));
      fs.writeFileSync(path.join(root, 'src/value.ts'), 'source changed\n');
      const changed = recomputePhaseEvidenceStaleness(root, FEATURE, ['coding', 'review', 'ut']);
      assert.strictEqual(changed[0].verdict, 'stale');
      assert.strictEqual(changed[1].propagated_from, 'coding');
    },
  },
  {
    // OWN-T5 反例（plan b5c1e9d7 §4）：归属登记扩大之后，"正在施工"这把豁免**只**属于条目上
    // 写着的那个 owner。落点是本次修复真正接线的那个消费点——`recomputePhaseEvidenceStaleness`
    // （授权门与 `capability-resolution-entry-input` 的 facts 基线都经它）。终局 completion 的
    // ⑤ 血缘不在其列：`verify-feature-completion.ts` 那处 recompute 本笔一行未改，只给
    // requirement/frameworkRoot，**没有**入口能声明"某阶段正在施工"。
    name: 'OWN-T5 反例：pendingOwner 只豁免条目自己的 owner，非 owner 阶段改 coding 源码仍 stale',
    run: () => {
      const root = mkProject();
      const source = path.join(root, 'src/value.ts');
      fs.mkdirSync(path.dirname(source), { recursive: true });
      fs.writeFileSync(source, 'source\n');
      // 观察期 plan 闭环后的真实形状（本笔修复的产物）：产品源码以 `owner_phase=coding` 进 plan 证据，
      // 而 coding 还没有自己的 manifest。
      writePhaseEvidenceManifest(root, resolvePhaseEvidenceManifest({
        projectRoot: root, feature: FEATURE, phase: 'plan',
        factsContext: { subject: { feature: FEATURE, run_id: 'run' }, first_phase: 'plan', required_input_snippets: [], source_paths: ['src/value.ts'], source_owners: { 'src/value.ts': 'coding' } },
      }));
      assert.strictEqual(recomputePhaseEvidenceStaleness(root, FEATURE, ['plan'])[0].verdict, 'fresh', '前提：闭环后须 fresh');
      fs.writeFileSync(source, 'edited\n');
      // 反例：改的是 **coding 负责**的源码，review/ut/testing 声称"自己在施工"不得因此洗绿；
      // 不声明任何 pending owner 同样必须 stale。
      for (const claimant of [undefined, 'review', 'ut', 'testing']) {
        const verdict = recomputePhaseEvidenceStaleness(root, FEATURE, ['plan'],
          claimant ? { pendingOwnerPhase: claimant } : undefined)[0].verdict;
        assert.strictEqual(verdict, 'stale',
          `pendingOwnerPhase=${claimant ?? '<none>'} 洗绿了非本人负责的漂移`);
      }
      // 单变量对照：换成条目上真正写着的那个 owner 才承接——证明上面几条不是"恒 stale"。
      assert.strictEqual(recomputePhaseEvidenceStaleness(root, FEATURE, ['plan'], { pendingOwnerPhase: 'coding' })[0].verdict, 'fresh',
        'owner 施工期上游被判漂移——本次修复的正向效果没了');
    },
  },
  {
    name: '写集外 Research 漂移没有 owner 豁免',
    run: () => {
      const root = mkProject();
      const source = path.join(root, 'readonly.config'); fs.writeFileSync(source, 'before\n');
      const facts: FactsInvocationContext = { subject: { feature: FEATURE, run_id: 'run' }, first_phase: 'plan', source_paths: ['readonly.config'], required_input_snippets: [] };
      writePhaseEvidenceManifest(root, resolvePhaseEvidenceManifest({ projectRoot: root, feature: FEATURE, phase: 'plan', factsContext: facts }));
      fs.writeFileSync(source, 'after\n');
      assert.strictEqual(recomputePhaseEvidenceStaleness(root, FEATURE, ['plan'])[0].verdict, 'stale');
      assert.strictEqual(recomputePhaseEvidenceStaleness(root, FEATURE, ['plan'], { pendingOwnerPhase: 'coding' })[0].verdict, 'stale', 'pending owner 不得豁免无归属 Research');
    },
  },
  {
    name: 'facts 只绑定基线与本阶段增量，普通和 staged 新鲜度同判',
    run: () => {
      const root = mkProject();
      const factsContext: FactsInvocationContext = { subject: { feature: FEATURE, run_id: 'run' }, first_phase: 'coding', source_paths: [], required_input_snippets: [] };
      const file = resolveFactsAbsPath(root, FEATURE, factsContext);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const base = '---\nschema_version: "1.1"\nfeature: ' + FEATURE + '\nestablished_by: coding\n---\n## Code Facts\nbase fact\n';
      const coding = '\n## phase_delta: coding\noriginal coding fact\n';
      const review = '\n## phase_delta: review\nnone\n';
      const assertVerdict = (phase: string, verdict: string): void => {
        assert.strictEqual(recomputePhaseEvidenceStaleness(root, FEATURE, [phase])[0].verdict, verdict);
        assert.strictEqual(verifyPhaseEvidenceManifestWithStagedOutputs({ projectRoot: root, feature: FEATURE, phase, stagedOutputs: [] }).verdict, verdict);
      };
      fs.writeFileSync(file, base + coding);
      writePhaseEvidenceManifest(root, resolvePhaseEvidenceManifest({ projectRoot: root, feature: FEATURE, phase: 'coding', factsContext }));
      assertVerdict('coding', 'fresh');
      fs.appendFileSync(file, review);
      assertVerdict('coding', 'fresh');
      writePhaseEvidenceManifest(root, resolvePhaseEvidenceManifest({ projectRoot: root, feature: FEATURE, phase: 'review', factsContext: { ...factsContext, baseline: { established_by: 'coding', fingerprint: factsBaselineFingerprint(base), dependencies: [] } } }));
      fs.appendFileSync(file, '\n## phase_delta: testing\nnone\n');
      assertVerdict('coding', 'fresh');
      assertVerdict('review', 'fresh');
      fs.writeFileSync(file, base + coding + review.replace('none', 'changed review fact'));
      assertVerdict('coding', 'fresh');
      assertVerdict('review', 'stale');
      fs.writeFileSync(file, base + coding.replace('original', 'changed') + review);
      assertVerdict('coding', 'stale');
      fs.writeFileSync(file, base.replace('base fact', 'changed base') + coding + review);
      assertVerdict('coding', 'stale');
      assertVerdict('review', 'stale');
    },
  },
  {
    name: 'facts 原来源在 manifest 与 verifier 发布前必须保持绑定，不能重签新字节',
    run: () => {
      for (const includeSourcePath of [false, true]) {
        const root = mkProject();
        const source = path.join(root, 'source.ts');
        fs.writeFileSync(source, 'before');
        const dep = { path: source, exists: true, sha256: sha256File(source), role: 'derive' as const };
        const factsContext: FactsInvocationContext = { subject: { feature: FEATURE, run_id: 'run' }, first_phase: 'review', source_paths: includeSourcePath ? ['source.ts'] : [], required_input_snippets: [], baseline: { established_by: 'coding', fingerprint: 'baseline', dependencies: [dep] } };
        const resolvedInputs = { context: { schema_version: '1.1' as const, subject: { feature: FEATURE }, obligations: {}, required_outputs: [] }, phase: 'review', values: {}, artifacts: {} };
        const opts = { projectRoot: root, feature: FEATURE, phase: 'review', factsContext, resolvedInputs };
        const publishers = [() => resolvePhaseEvidenceManifest(opts), () => buildVerifierMaterialView({ ...opts, gateFingerprint: null, phaseRuleText: '', templateText: '', checks: [], contextFiles: [] })];
        for (const publish of publishers) assert.doesNotThrow(publish);
        fs.writeFileSync(source, 'after');
        for (const publish of publishers) assert.throws(publish, /input binding stale/);
        fs.unlinkSync(source);
        for (const publish of publishers) assert.throws(publish, /input binding stale/);
      }
    },
  },
  {
    name: '责任阶段可在闭环时承接自己刚写出的新字节',
    run: () => {
      const root = mkProject();
      const source = path.join(root, 'source.ts');
      fs.writeFileSync(source, 'before');
      const dep = { path: source, exists: true, sha256: sha256File(source), role: 'derive' as const };
      fs.writeFileSync(source, 'after');
      const factsContext: FactsInvocationContext = {
        subject: { feature: FEATURE, run_id: 'run' }, first_phase: 'plan', source_paths: ['source.ts'],
        source_owners: { 'source.ts': 'coding' }, required_input_snippets: [],
        baseline: { established_by: 'plan', fingerprint: 'baseline', dependencies: [dep] },
      };
      const manifest = resolvePhaseEvidenceManifest({ projectRoot: root, feature: FEATURE, phase: 'coding', factsContext });
      const entry = manifest.outputs.find(item => item.path === 'source.ts');
      assert(entry && entry.owner_phase === 'coding' && entry.sha256 === sha256File(source), 'coding 应绑定完成后的当前源码');
    },
  },
  {
    name: 'inputs 与 spec-loader 表同源（review：REQUIRED 全入，OPTIONAL 仅存在才入）',
    run: () => {
      const root = mkProject();
      for (const f of REQUIRED_FEATURE_FILES_BY_PHASE.review!) writeArtifact(root, f, `${f} v1\n`);
      // OPTIONAL review=[spec.md] 已存在（REQUIRED plan 集里没写也行——这里显式建）
      const m = resolvePhaseEvidenceManifest({ projectRoot: root, feature: FEATURE, phase: 'review' as Phase, now: FIXED_NOW });
      const inputBases = m.inputs.map((e) => path.basename(e.path)).sort();
      const expected = [...new Set([
        ...REQUIRED_FEATURE_FILES_BY_PHASE.review!,
        ...OPTIONAL_FEATURE_FILES_BY_PHASE.review!.filter((f) =>
          resolveFeatureArtifact(root, FEATURE, f).exists),
      ])].sort();
      // review-report.md 是 outputs overlay，不应混进 inputs-only 视图
      assert.deepStrictEqual(inputBases.filter((b) => b !== 'review-report.md'), expected);
      assert.ok(m.inputs.every((e) => e.exists && e.sha256), 'REQUIRED 输入均已落哈希');
    },
  },
  {
    name: 'outputs overlay：spec.md 同为 spec 阶段输入与产出 → role=both 两侧可见',
    run: () => {
      const root = mkProject();
      seedSpecPhase(root);
      const m = resolvePhaseEvidenceManifest({ projectRoot: root, feature: FEATURE, phase: 'spec' as Phase, now: FIXED_NOW });
      const specIn = m.inputs.find((e) => path.basename(e.path) === 'spec.md');
      const specOut = m.outputs.find((e) => path.basename(e.path) === 'spec.md');
      assert.ok(specIn && specOut, 'spec.md 在两侧');
      assert.strictEqual(specIn!.role, 'both');
    },
  },
  {
    name: 'role=both stale 诊断按 normalized path 去重',
    run: () => {
      const root = mkProject();
      seedSpecPhase(root);
      writeManifestWithPointer(root, 'spec');
      const specPath = resolveFeatureArtifact(root, FEATURE, 'spec.md').actualPath;
      fs.appendFileSync(specPath, '# changed once\n', 'utf-8');
      const result = recomputePhaseEvidenceStaleness(root, FEATURE, ['spec'])[0];
      assert.strictEqual(result.verdict, 'stale');
      const specChanges = result.changed_paths.filter((p) => p.endsWith('/spec.md'));
      assert.strictEqual(specChanges.length, 1, `role=both 路径不得重复：${result.changed_paths.join(',')}`);
    },
  },
  {
    name: '自引用环防线：回执/manifest 自身进集合即 throw',
    run: () => {
      const root = mkProject();
      seedSpecPhase(root);
      assert.throws(
        () => resolvePhaseEvidenceManifest({
          projectRoot: root, feature: FEATURE, phase: 'spec' as Phase, now: FIXED_NOW,
          extraOutputs: [receiptPathForPhase(root, FEATURE, 'spec')],
        }),
        /自引用环/,
      );
      assert.throws(
        () => resolvePhaseEvidenceManifest({
          projectRoot: root, feature: FEATURE, phase: 'spec' as Phase, now: FIXED_NOW,
          extraInputs: [phaseEvidenceManifestPath(root, FEATURE, 'spec')],
        }),
        /自引用环/,
      );
    },
  },
  {
    name: 'aggregate 不含时间戳：不同 now 生成的 aggregate 相同；manifest 文件哈希≠aggregate（不自 hash）',
    run: () => {
      const root = mkProject();
      seedSpecPhase(root);
      const m1 = resolvePhaseEvidenceManifest({ projectRoot: root, feature: FEATURE, phase: 'spec' as Phase, now: FIXED_NOW });
      const m2 = resolvePhaseEvidenceManifest({
        projectRoot: root, feature: FEATURE, phase: 'spec' as Phase,
        now: () => new Date('2027-01-01T00:00:00.000Z'),
      });
      assert.strictEqual(m1.aggregate_sha256, m2.aggregate_sha256);
      const written = writePhaseEvidenceManifest(root, m1);
      const loaded = loadPhaseEvidenceManifest(root, FEATURE, 'spec');
      assert.ok(loaded, '可回读');
      assert.strictEqual(loaded!.fileSha256, written.sha256);
      assert.notStrictEqual(loaded!.fileSha256, m1.aggregate_sha256);
      assert.strictEqual(loaded!.manifest.aggregate_sha256, m1.aggregate_sha256);
    },
  },
  {
    name: 'staleness：fresh → 改输入文件 → stale 且指名路径',
    run: () => {
      const root = mkProject();
      seedSpecPhase(root);
      writeManifestWithPointer(root, 'spec');
      let r = recomputePhaseEvidenceStaleness(root, FEATURE, ['spec']);
      assert.strictEqual(r[0].verdict, 'fresh');
      const acc = resolveFeatureArtifact(root, FEATURE, 'acceptance.yaml').actualPath;
      fs.appendFileSync(acc, 'tampered: true\n', 'utf-8');
      r = recomputePhaseEvidenceStaleness(root, FEATURE, ['spec']);
      assert.strictEqual(r[0].verdict, 'stale');
      assert.ok(r[0].changed_paths.some((p2) => p2.endsWith('acceptance.yaml')));
    },
  },
  {
    name: 'tamper（codex 五轮 P0 复现）：改文件+同步改 entry 哈希留旧 aggregate → tampered 不洗白',
    run: () => {
      const root = mkProject();
      seedSpecPhase(root);
      writeManifestWithPointer(root, 'spec');
      // 攻击：改 acceptance，再把 manifest 条目 hash 改成新值，保留旧 aggregate
      const acc = resolveFeatureArtifact(root, FEATURE, 'acceptance.yaml').actualPath;
      fs.appendFileSync(acc, 'tampered: true\n', 'utf-8');
      const mPath = phaseEvidenceManifestPath(root, FEATURE, 'spec');
      const doc = JSON.parse(fs.readFileSync(mPath, 'utf-8'));
      const crypto = require('crypto') as typeof import('crypto');
      const newHash = crypto.createHash('sha256').update(fs.readFileSync(acc)).digest('hex');
      for (const e of [...doc.inputs, ...doc.outputs]) {
        if (e.path.endsWith('acceptance.yaml')) e.sha256 = newHash;
      }
      fs.writeFileSync(mPath, JSON.stringify(doc, null, 2) + '\n', 'utf-8');
      const r = recomputePhaseEvidenceStaleness(root, FEATURE, ['spec']);
      assert.strictEqual(r[0].verdict, 'tampered', 'aggregate 重算必须抓住条目改写');
      assert.ok(r[0].integrity_errors!.some((e) => /aggregate 重算失配/.test(e)));
    },
  },
  {
    name: '需求血缘（codex 八轮 P0-2）：新 run 换需求→上游 closure stale（旧 closure 文件未变）',
    run: () => {
      const root = mkProject();
      seedSpecPhase(root);
      // spec 闭环记录 R1 的 requirement sha
      const written = writePhaseEvidenceManifest(root, resolvePhaseEvidenceManifest({
        projectRoot: root, feature: FEATURE, phase: 'spec' as Phase, now: FIXED_NOW,
        requirementSha: 'req-A-sha',
      }));
      writeReceiptManifestPointer(root, FEATURE, 'spec', `doc/features/${FEATURE}/spec/reports/phase-evidence-manifest.json`, written.sha256);
      // 当前权威 requirement 仍是 A → fresh
      assert.strictEqual(
        recomputePhaseEvidenceStaleness(root, FEATURE, ['spec'], { currentRequirementSha: 'req-A-sha' })[0].verdict,
        'fresh',
      );
      // 新 run 换需求 B（closure 文件一字未改）→ stale
      const r = recomputePhaseEvidenceStaleness(root, FEATURE, ['spec'], { currentRequirementSha: 'req-B-sha' });
      assert.strictEqual(r[0].verdict, 'stale');
      assert.ok(r[0].changed_paths.some((p2) => p2.includes('requirement')));
    },
  },
  {
    name: '需求血缘 fail-closed（codex 九轮 P0 复现）：记录为 null 的旧 closure 遇新需求 → stale（requirement_unbound）',
    run: () => {
      const root = mkProject();
      seedSpecPhase(root);
      // 交互态闭环合法产生 requirement_sha256: null（不传 requirementSha）
      const written = writePhaseEvidenceManifest(root, resolvePhaseEvidenceManifest({
        projectRoot: root, feature: FEATURE, phase: 'spec' as Phase, now: FIXED_NOW,
      }));
      writeReceiptManifestPointer(root, FEATURE, 'spec', `doc/features/${FEATURE}/spec/reports/phase-evidence-manifest.json`, written.sha256);
      // 交互态消费（不传 current）→ fresh（合法）
      assert.strictEqual(recomputePhaseEvidenceStaleness(root, FEATURE, ['spec'])[0].verdict, 'fresh');
      // 新 goal 从中间阶段起链（传 current=req-B）→ 未绑定即 stale，不得 fresh
      const r = recomputePhaseEvidenceStaleness(root, FEATURE, ['spec'], { currentRequirementSha: 'req-B-sha' });
      assert.strictEqual(r[0].verdict, 'stale', 'null 记录不得被新需求复用');
      assert.ok(r[0].changed_paths.some((p2) => p2.includes('requirement_unbound')));
    },
  },
  {
    name: '身份校验（codex 七轮 P2-1）：manifest.feature/phase 被重标 → tampered',
    run: () => {
      const root = mkProject();
      seedSpecPhase(root);
      writeManifestWithPointer(root, 'spec');
      const mPath = phaseEvidenceManifestPath(root, FEATURE, 'spec');
      const doc = JSON.parse(fs.readFileSync(mPath, 'utf-8'));
      doc.feature = 'other-feature'; // 跨 feature 搬运/重标
      // 重算 aggregate 使其自洽（只改身份，不改条目）
      fs.writeFileSync(mPath, JSON.stringify(doc, null, 2) + '\n', 'utf-8');
      const r = recomputePhaseEvidenceStaleness(root, FEATURE, ['spec']);
      assert.strictEqual(r[0].verdict, 'tampered');
      assert.ok(r[0].integrity_errors!.some((e) => /feature 失配|aggregate/.test(e)));
    },
  },
  {
    name: 'plan 07a41ec6（codex review P0）：回执指针退出证据链——manifest 完整且无指针 → fresh；回执被投影重写 → 仍 fresh',
    run: () => {
      const root = mkProject();
      seedSpecPhase(root);
      writePhaseEvidenceManifest(root, resolvePhaseEvidenceManifest({ projectRoot: root, feature: FEATURE, phase: 'spec' as Phase, now: FIXED_NOW }));
      // 不写指针
      let r = recomputePhaseEvidenceStaleness(root, FEATURE, ['spec']);
      assert.strictEqual(r[0].verdict, 'fresh', JSON.stringify(r[0]));
      // 回执整文件被 harness 投影重写（无指针、正文变化）——不得使刚闭环的阶段自失效
      fs.writeFileSync(receiptPathForPhase(root, FEATURE, 'spec'), '---\nreceipt_schema: "2.1"\nfeature: "x"\n---\n', 'utf-8');
      r = recomputePhaseEvidenceStaleness(root, FEATURE, ['spec']);
      assert.strictEqual(r[0].verdict, 'fresh', JSON.stringify(r[0]));
      assert.strictEqual(r[0].receipt_changed, false);
    },
  },
  {
    name: 'environment 重算（codex P0-5）：framework.config 变化 → stale',
    run: () => {
      const root = mkProject();
      seedSpecPhase(root);
      fs.writeFileSync(path.join(root, 'framework.config.json'), JSON.stringify({ project_profile: { name: 'x' } }), 'utf-8');
      const written = writePhaseEvidenceManifest(root, resolvePhaseEvidenceManifest({ projectRoot: root, feature: FEATURE, phase: 'spec' as Phase, now: FIXED_NOW }));
      writeReceiptManifestPointer(root, FEATURE, 'spec', 'doc/features/' + FEATURE + '/spec/reports/phase-evidence-manifest.json', written.sha256);
      assert.strictEqual(recomputePhaseEvidenceStaleness(root, FEATURE, ['spec'])[0].verdict, 'fresh');
      fs.writeFileSync(path.join(root, 'framework.config.json'), JSON.stringify({ project_profile: { name: 'y' } }), 'utf-8');
      const r = recomputePhaseEvidenceStaleness(root, FEATURE, ['spec']);
      assert.strictEqual(r[0].verdict, 'stale');
      assert.ok(r[0].changed_paths.some((p2) => p2.includes('environment')));
    },
  },
  {
    name: 'reports 产出入保护面：summary.json 闭环后被改 FAIL→PASS → stale（codex 五轮 P1）',
    run: () => {
      const root = mkProject();
      seedSpecPhase(root);
      const summaryPath = path.join(root, 'doc/features', FEATURE, 'spec', 'reports', 'summary.json');
      fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
      fs.writeFileSync(summaryPath, JSON.stringify({ verdict: 'FAIL' }), 'utf-8');
      const m = resolvePhaseEvidenceManifest({ projectRoot: root, feature: FEATURE, phase: 'spec' as Phase, now: FIXED_NOW });
      assert.ok(m.outputs.some((e) => e.path.endsWith('reports/summary.json')), 'summary 在 outputs 保护面');
      writeManifestWithPointer(root, 'spec');
      fs.writeFileSync(summaryPath, JSON.stringify({ verdict: 'PASS' }), 'utf-8');
      const r = recomputePhaseEvidenceStaleness(root, FEATURE, ['spec']);
      assert.strictEqual(r[0].verdict, 'stale');
      assert.ok(r[0].changed_paths.some((p2) => p2.endsWith('summary.json')));
    },
  },
  {
    name: 'staleness：上游 stale/missing 沿链传染下游（propagated_from）',
    run: () => {
      const root = mkProject();
      seedSpecPhase(root);
      for (const f of REQUIRED_FEATURE_FILES_BY_PHASE.plan!) {
        if (!resolveFeatureArtifact(root, FEATURE, f).exists) writeArtifact(root, f, `${f} v1\n`);
      }
      writeReceipt(root, 'plan', 'phase: "plan"\n');
      writeManifestWithPointer(root, 'spec');
      writeManifestWithPointer(root, 'plan');
      // spec 的产出 acceptance.yaml 被改 → spec stale，plan 被传染
      fs.appendFileSync(resolveFeatureArtifact(root, FEATURE, 'acceptance.yaml').actualPath, 'x: 1\n', 'utf-8');
      const r = recomputePhaseEvidenceStaleness(root, FEATURE, ['spec', 'plan']);
      assert.strictEqual(r[0].verdict, 'stale');
      assert.strictEqual(r[1].verdict, 'stale');
      assert.strictEqual(r[1].propagated_from, 'spec');
      // missing 同样传染
      fs.rmSync(phaseEvidenceManifestPath(root, FEATURE, 'spec'));
      const r2 = recomputePhaseEvidenceStaleness(root, FEATURE, ['spec', 'plan']);
      assert.strictEqual(r2[0].verdict, 'missing');
      assert.strictEqual(r2[1].propagated_from, 'spec');
    },
  },
  {
    name: 'B2-1/B2-2/B2-4 阶段证据：纯身份升版（改本 CU 未消费的蓝图内容）→ 新写证据 fresh、旧快照证据按字节 stale；改本 CU 消费的 target 内容 → 新写证据 stale',
    run: () => withCuSnapshot(s => {
      const feature = SNAPSHOT_CU_FEATURE;
      const freshness = (phase: string) => recomputePhaseEvidenceStaleness(s.root, feature, [phase], { frameworkRoot: s.frameworkRoot })[0];
      const files = b2Files(s);
      writePhaseEvidenceManifest(s.root, resolvePhaseEvidenceManifest({ projectRoot: s.root, feature, phase: 'plan', extraInputs: files, frameworkRoot: s.frameworkRoot }));
      assert.strictEqual(freshness('plan').verdict, 'fresh', '前提：新写证据当下 fresh');
      assert.strictEqual(freshness('coding').verdict, 'fresh', '前提：快照 coding 证据当下 fresh');
      const before = files.map(file => sha256File(file));
      assert(bumped(bumpAndReconcile(s, changeUnconsumedBlueprintContent)), '前提：调和原位升版 ledger-refresh');
      assert.deepStrictEqual(files.filter((file, i) => sha256File(file) === before[i]), [], '前提：五个登记文件字节都已变化（身份更新真实发生）');
      const identityOnly = freshness('plan');
      assert.strictEqual(identityOnly.verdict, 'fresh', `纯身份变化不得判 stale：${JSON.stringify(identityOnly)}`);
      const legacy = freshness('coding');
      assert(legacy.verdict === 'stale' && legacy.changed_paths.includes(relOf(s, files[0])), `旧格式证据仍按字节口径失效：${JSON.stringify(legacy)}`);
      assert(bumped(bumpAndReconcile(s, changeConsumedTargetContent)), '前提：第二次调和原位升版');
      const consumed = freshness('plan');
      assert(consumed.verdict === 'stale' && consumed.changed_paths.includes(relOf(s, files[0])), `本 CU 消费的 target 内容变化必须失效：${JSON.stringify(consumed)}`);
    }),
  },
  {
    name: 'B2 授权边界：新增端点与本 CU 无关的架构影响决策 → 证据 fresh、绑定命中；新增端点落在本 CU 可修改模块的 dependency_edge remove → 证据 stale、绑定 stale',
    run: () => withCuSnapshot(s => {
      const feature = SNAPSHOT_CU_FEATURE;
      // 快照 DSL 只有一个 dag 外层（层内依赖全允许），「删除边」在其下永远未生效、会被施工门挡在调和之外；
      // 先把层内依赖改为 forbid（在写证据之前，环境指纹随证据一起定格），使 remove 决策合法生效。
      const configFile = path.join(s.root, 'framework.config.json');
      const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
      config.architecture.outer_layers[0].intra_layer_deps = 'forbid';
      fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
      clearFrameworkConfigCache();
      const freshness = () => recomputePhaseEvidenceStaleness(s.root, feature, ['plan'], { frameworkRoot: s.frameworkRoot })[0];
      writePhaseEvidenceManifest(s.root, resolvePhaseEvidenceManifest({ projectRoot: s.root, feature, phase: 'plan', extraInputs: b2Files(s), frameworkRoot: s.frameworkRoot }));
      const inputs = resolveCapabilityInputs({
        projectRoot: s.root, frameworkRoot: s.frameworkRoot, feature, phase: 'plan', track: 'full',
        inputContext: { schema_version: '1.1', subject: { feature }, obligations: {}, required_outputs: [] },
      }).inputs!.values;
      const contracts = inputs.contracts;
      assert(contracts?.state === 'resolved', `前提：plan.contracts 可解析：${JSON.stringify(contracts)}`);
      const read = () => readBoundInput({ projectRoot: s.root, frameworkRoot: s.frameworkRoot, feature, phase: 'plan', track: 'full' }, contracts.binding);
      const unrelated = bumpAndReconcile(s, addEdgeRemoval('edge-elsewhere', '04-BusinessBase', '05-Foundation'));
      assert(bumped(unrelated), `前提：无关决策下调和原位升版：${JSON.stringify(unrelated)}`);
      assert.strictEqual(freshness().verdict, 'fresh', `端点与本 CU 无关的决策不得使证据失效：${JSON.stringify(freshness())}`);
      assert.doesNotThrow(read, '端点与本 CU 无关的决策不得使绑定失效');
      const relevant = bumpAndReconcile(s, addEdgeRemoval('edge-from-ledger', 'ledger', 'FinancialCard'));
      assert(bumped(relevant), `前提：相关决策下调和原位升版：${JSON.stringify(relevant)}`);
      const result = freshness();
      assert(result.verdict === 'stale' && result.changed_paths.includes(relOf(s, b2Files(s)[0])), `作用于本 CU 可修改模块的决策是授权边界，必须失效：${JSON.stringify(result)}`);
      assert.throws(read, /input binding stale/, '作用于本 CU 可修改模块的决策必须使 contracts 绑定失效');
    }),
  },
  {
    name: 'B2-3 阶段证据：本 CU 消费的 relation 被删（引用解析失败）→ 新写证据 stale',
    run: () => withCuSnapshot(s => {
      const feature = SNAPSHOT_CU_FEATURE;
      writePhaseEvidenceManifest(s.root, resolvePhaseEvidenceManifest({ projectRoot: s.root, feature, phase: 'plan', extraInputs: b2Files(s), frameworkRoot: s.frameworkRoot }));
      const r = bumpAndReconcile(s, bp => { bp.relations = (bp.relations as Blueprint[]).filter(item => item.relation_id !== 'repository-publishes-store'); });
      assert(r.skipped.some(item => item.change_unit_id === 'ledger-refresh'), `前提：target 被删的 CU 不能原位升版：${JSON.stringify(r)}`);
      const result = recomputePhaseEvidenceStaleness(s.root, feature, ['plan'], { frameworkRoot: s.frameworkRoot })[0];
      assert.strictEqual(result.verdict, 'stale', `解析失败不得判等价：${JSON.stringify(result)}`);
    }),
  },
  {
    name: 'B2-1/B2-2/B2-4 输入绑定：纯身份升版后本轮绑定仍命中（重读与冻结对照两条路径），旧全值指纹按全值口径 stale；改消费 target 内容 → stale',
    run: () => withCuSnapshot(s => {
      const feature = SNAPSHOT_CU_FEATURE;
      const specs = [['plan', 'contracts'], ['ut', 'acceptance']] as const;
      const resolve = (phase: string, expected?: InputBinding[]) => resolveCapabilityInputs({
        projectRoot: s.root, frameworkRoot: s.frameworkRoot, feature, phase, track: 'full',
        inputContext: { schema_version: '1.1', subject: { feature }, obligations: {}, required_outputs: [], ...(expected ? { expected_bindings: expected } : {}) },
      }).inputs!.values;
      const read = (phase: string, binding: InputBinding) => readBoundInput({ projectRoot: s.root, frameworkRoot: s.frameworkRoot, feature, phase, track: 'full' }, binding);
      const current = specs.map(([phase, id]) => {
        const value = resolve(phase)[id];
        assert(value?.state === 'resolved', `前提：${phase}.${id} 可解析：${JSON.stringify(value)}`);
        return { phase, id, binding: value.binding, legacy: { ...value.binding, content_fingerprint: crypto.createHash('sha256').update(stableStringify(value.value)).digest('hex') } };
      });
      assert(bumped(bumpAndReconcile(s, changeUnconsumedBlueprintContent)), '前提：调和原位升版 ledger-refresh');
      for (const { phase, id, binding, legacy } of current) {
        assert.doesNotThrow(() => read(phase, binding), `${id}：纯身份变化后本轮绑定应仍命中`);
        const again = resolve(phase, [binding])[id];
        assert.strictEqual(again?.state, 'resolved', `${id}：冻结绑定对照不应判 stale：${JSON.stringify(again)}`);
        assert.throws(() => read(phase, legacy), /input binding stale/, `${id}：旧全值指纹只能按全值命中`);
      }
      assert(bumped(bumpAndReconcile(s, changeConsumedTargetContent)), '前提：第二次调和原位升版');
      // contracts 经 change_unit_ref 依赖 CU 契约（含其消费的 target 内容）→ stale；
      // acceptance 投影正文未变、来源戳指向当前 CU/蓝图 → 仍是同一内容（阶段级重验由 CU/蓝图证据条目负责，见上一例）。
      const [contracts, acceptance] = current;
      assert.throws(() => read(contracts.phase, contracts.binding), /input binding stale/, 'contracts：本 CU 消费的 target 内容变化必须 stale');
      assert.doesNotThrow(() => read(acceptance.phase, acceptance.binding), 'acceptance：投影正文未变不应 stale');
      assert(bumped(bumpAndReconcile(s, bp => {
        const domain = (bp.design_views as Blueprint[]).flatMap(view => view.nodes ?? []).find((n: Blueprint) => n.node_id === 'ledger-domain');
        domain.acceptance.criteria[0].expected_result = 'consumer refreshed and balance survives restart';
      })), '前提：第三次调和原位升版');
      assert.throws(() => read(acceptance.phase, acceptance.binding), /input binding stale/, 'acceptance：本 CU 消费的验收内容变化必须 stale');
    }),
  },
];

export function runAll(): UnitCaseResult[] {
  return cases.map((c) => {
    try {
      c.run();
      return { name: `phase-evidence-manifest: ${c.name}`, ok: true };
    } catch (err) {
      return {
        name: `phase-evidence-manifest: ${c.name}`,
        ok: false,
        error: (err as Error).stack ?? (err as Error).message,
      };
    }
  });
}
