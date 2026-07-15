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
} from '../../scripts/utils/phase-evidence-manifest';
import type { Phase } from '../../scripts/utils/types';
import type { UnitCaseResult } from '../run-unit';

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

interface Case { name: string; run: () => void }

const cases: Case[] = [
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
    name: '回执规范化幂等：追加三类指针行不改变规范化哈希',
    run: () => {
      const root = mkProject();
      seedSpecPhase(root);
      const before = computeCanonicalReceiptSha256(root, FEATURE, 'spec');
      const p = receiptPathForPhase(root, FEATURE, 'spec');
      fs.appendFileSync(p, [
        'evidence_manifest: "doc/features/x/spec/reports/phase-evidence-manifest.json"',
        'evidence_manifest_sha256: "deadbeef"',
        '  phase_closure_fingerprint: "abc"',
      ].join('\n') + '\n', 'utf-8');
      const after = computeCanonicalReceiptSha256(root, FEATURE, 'spec');
      assert.strictEqual(after, before, '指针行剔除后哈希不变');
      // 而正文变化必须可见
      fs.appendFileSync(p, 'verdict_note: changed\n', 'utf-8');
      assert.notStrictEqual(computeCanonicalReceiptSha256(root, FEATURE, 'spec'), before);
      // CRLF 归一
      assert.strictEqual(canonicalizeReceiptContent('a\r\nb'), 'a\nb');
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
    name: 'staleness：回执正文变更 → receipt_changed；指针行追加不触发',
    run: () => {
      const root = mkProject();
      seedSpecPhase(root);
      writeManifestWithPointer(root, 'spec');
      let r = recomputePhaseEvidenceStaleness(root, FEATURE, ['spec']);
      assert.strictEqual(r[0].verdict, 'fresh', '指针回写不算篡改');
      const p = receiptPathForPhase(root, FEATURE, 'spec');
      fs.appendFileSync(p, 'blocker_count: 999\n', 'utf-8');
      r = recomputePhaseEvidenceStaleness(root, FEATURE, ['spec']);
      assert.strictEqual(r[0].verdict, 'stale');
      assert.strictEqual(r[0].receipt_changed, true);
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
    name: 'tamper：回执指针锚——用生产 writer 写指针（codex P0-1：writer 空行不得使刚生成即 stale）',
    run: () => {
      const root = mkProject();
      seedSpecPhase(root);
      const written = writePhaseEvidenceManifest(root, resolvePhaseEvidenceManifest({ projectRoot: root, feature: FEATURE, phase: 'spec' as Phase, now: FIXED_NOW }));
      // 生产 writer 写指针（含尾部空行分隔）——规范化剔指针+归一尾空行后哈希须稳定
      const relManifest = 'doc/features/' + FEATURE + '/spec/reports/phase-evidence-manifest.json';
      writeReceiptManifestPointer(root, FEATURE, 'spec', relManifest, written.sha256);
      const r0 = recomputePhaseEvidenceStaleness(root, FEATURE, ['spec']);
      assert.strictEqual(r0[0].verdict, 'fresh', `刚生成即 stale：${JSON.stringify(r0[0])}`);
      // 重跑 writer 幂等（不叠加空行/指针）
      writeReceiptManifestPointer(root, FEATURE, 'spec', relManifest, written.sha256);
      assert.strictEqual(recomputePhaseEvidenceStaleness(root, FEATURE, ['spec'])[0].verdict, 'fresh');
      // 攻击：改文件后整体重新生成 manifest（aggregate 自洽）——但回执指针没跟上
      const acc = resolveFeatureArtifact(root, FEATURE, 'acceptance.yaml').actualPath;
      fs.appendFileSync(acc, 'x: 1\n', 'utf-8');
      writePhaseEvidenceManifest(root, resolvePhaseEvidenceManifest({ projectRoot: root, feature: FEATURE, phase: 'spec' as Phase, now: FIXED_NOW }));
      const r = recomputePhaseEvidenceStaleness(root, FEATURE, ['spec']);
      assert.strictEqual(r[0].verdict, 'tampered');
      assert.ok(r[0].integrity_errors!.some((e) => /指针|evidence_manifest_sha256/.test(e)));
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
    name: 'fail-closed：manifest 存在但回执无指针 → tampered（codex P0-5：null 不当兼容旧现场）',
    run: () => {
      const root = mkProject();
      seedSpecPhase(root);
      writePhaseEvidenceManifest(root, resolvePhaseEvidenceManifest({ projectRoot: root, feature: FEATURE, phase: 'spec' as Phase, now: FIXED_NOW }));
      // 不写指针
      const r = recomputePhaseEvidenceStaleness(root, FEATURE, ['spec']);
      assert.strictEqual(r[0].verdict, 'tampered');
      assert.ok(r[0].integrity_errors!.some((e) => /缺 evidence_manifest_sha256 指针/.test(e)));
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
