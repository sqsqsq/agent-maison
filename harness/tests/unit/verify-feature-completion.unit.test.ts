// verify-feature-completion.unit.test.ts — t8 完成凭证生成与唯一验证入口
//
// 覆盖面（openspec goal-runner delta + codex 终审剧本）：
//   clean_pass 违例拒生成 / VALID roundtrip / 原件篡改 INVALID / 手工伪造(假 aggregate)
//   INVALID / 世界后变(artifact 改动·更晚 HALTED run) STALE / supersedes 豁免。

import assert from 'assert';
import { computeRunRequirementSha } from '../../scripts/utils/fidelity-shared';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { clearFrameworkConfigCache, featureFilePath, receiptDirPath, resolveFeatureArtifact } from '../../config';
import {
  receiptPathForPhase,
  resolvePhaseEvidenceManifest,
  writePhaseEvidenceManifest,
  writeReceiptManifestPointer,
} from '../../scripts/utils/phase-evidence-manifest';
import {
  FEATURE_COMPLETION_FILENAME,
  classifyCleanPassIssues,
  collectCleanPassIssues,
  generateFeatureCompletion,
  hasPendingHumanReview,
  resolvePhaseRunIds,
  runtimeFidelityObjectHash,
  runtimeFidelityReceiptPath,
  verifyFeatureCompletion,
} from '../../scripts/utils/verify-feature-completion';
import { canonicalReceiptPayload } from '../../scripts/utils/confirmation-receipt';
import {
  seedCleanCompletionChain,
  writeFeatureArtifact,
  writePhaseReceipt,
  writePhaseSummary,
  writeRunEvents as seedWriteRunEvents,
} from '../utils/completion-chain-seed';
import * as crypto from 'crypto';
import type { Phase } from '../../scripts/utils/types';
import type { UnitCaseResult } from '../run-unit';

const FEATURE = 'completion-fixture';
const CHAIN = ['spec', 'plan'];
const FIXED_NOW = () => new Date('2026-07-13T00:00:00.000Z');

function mkProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-completion-'));
  clearFrameworkConfigCache();
  return root;
}

// 造场景的四个 writer 与 seedCleanChain 已提到 tests/utils/completion-chain-seed.ts
// （plan 2d6b4f83 mg1：唯一实现，MG 跨层链共用）；此处只做绑定 FEATURE 的薄委托。
function writeArtifact(root: string, name: string, content: string): void {
  writeFeatureArtifact(root, FEATURE, name, content);
}

function writeSummary(root: string, phase: string, verdict: string): void {
  writePhaseSummary(root, FEATURE, phase, verdict);
}

function writeLegacySummary(root: string, phase: string, verdict: string): void {
  const p = path.join(receiptDirPath(root, FEATURE, phase), 'reports', 'summary.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ schema_version: '1.0', verdict }), 'utf-8');
}

function writeReceipt(root: string, phase: string): void {
  writePhaseReceipt(root, FEATURE, phase);
}

function writeRunEvents(root: string, runId: string, events: Array<Record<string, unknown>>): void {
  seedWriteRunEvents(root, FEATURE, runId, events);
}

/** 全链干净现场——实现见 tests/utils/completion-chain-seed.ts（唯一实现，MG 跨层链共用）。 */
function seedCleanChain(root: string): void {
  seedCleanCompletionChain({ projectRoot: root, feature: FEATURE, chain: CHAIN, now: FIXED_NOW });
}

function runDirAbs(root: string, runId: string): string {
  return featureFilePath(root, FEATURE, path.join('goal-runs', runId));
}

function generate(root: string, over?: Partial<Parameters<typeof generateFeatureCompletion>[0]>) {
  return generateFeatureCompletion({
    projectRoot: root, feature: FEATURE, chain: CHAIN,
    workflowTrack: 'full', runId: 'RUN1', runDirAbs: runDirAbs(root, 'RUN1'),
    phaseRunIds: {}, now: FIXED_NOW, ...over,
  });
}

function verify(root: string, over?: Partial<Parameters<typeof verifyFeatureCompletion>[0]>) {
  return verifyFeatureCompletion({
    projectRoot: root, feature: FEATURE, expectedChain: CHAIN, expectedTrack: 'full', ...over,
  });
}

interface Case { name: string; run: () => void }

const cases: Case[] = [
  {
    name: 'clean_pass 违例拒生成：verdict 非 PASS / waiver 存在 / 档位钳制；账本待复核不再阻断（只留报告展示）',
    run: () => {
      const root = mkProject();
      seedCleanChain(root);
      writeSummary(root, 'plan', 'FAIL');
      assert.throws(() => generate(root), /verdict_pass/);
      writeSummary(root, 'plan', 'PASS');

      const waiver = featureFilePath(root, FEATURE, 'testing/skip-waivers.yaml');
      fs.mkdirSync(path.dirname(waiver), { recursive: true });
      fs.writeFileSync(waiver, 'waivers:\n  - tc_id: TC-1\n', 'utf-8');
      assert.throws(() => generate(root), /no_waivers/);
      fs.rmSync(waiver);

      // 真实门禁的 needs_human 封顶不受账本退役影响（档位钳制仍在）
      assert.strictEqual(
        collectCleanPassIssues({ projectRoot: root, feature: FEATURE, chain: CHAIN, fidelityCapped: true })
          .some((i) => i.condition === 'no_fidelity_cap'),
        true,
      );

      // codex 收口刀定向回归②：历史 must_review 行只出现在报告中，不得控制终态/生成——
      // 跨 run 累积账本曾把 45 条旧待复核永久压在 clean-pass 上（旧行不可消解）。
      const mdPath = featureFilePath(root, FEATURE, 'spec/headless-assumptions.md');
      fs.writeFileSync(mdPath, '| # | Gate | 决议 |\n|---|---|---|\n| 1 | x | y |\n', 'utf-8');
      assert.strictEqual(
        collectCleanPassIssues({ projectRoot: root, feature: FEATURE, chain: CHAIN })
          .some((i) => i.condition === 'no_pending_must_review'),
        false,
        '账本 must_review 不得再产生 clean-pass issue',
      );
      assert.doesNotThrow(() => generate(root), '账本待复核不得阻断 completion 生成');
    },
  },
  {
    name: 'codex 方案二：flow_contract 缺 receipt 不进 clean_pass（签发端未建成）；runtime_fidelity 等其他 receipt 校验不动',
    run: () => {
      const root = mkProject();
      seedCleanChain(root);
      // 带 P0 device flow 的 acceptance（flow_contract/runtime_fidelity 两门都 applicable；无任何 receipt）
      writeArtifact(root, 'acceptance.yaml', [
        'flows:',
        '  main:',
        '    screens: [a, b]',
        'criteria:',
        '  - id: AC-1',
        '    priority: P0',
        '    ut_layer: device',
        '    linked_flow: main',
      ].join('\n'));
      const issues = collectCleanPassIssues({ projectRoot: root, feature: FEATURE, chain: CHAIN });
      assert.strictEqual(
        issues.some((i) => i.condition === 'flow_contract_receipt'),
        false,
        'flow_contract 缺 receipt 不得再产生 clean_pass issue——保留 WARN 提醒、删除签不出来的强制手续',
      );
      assert.strictEqual(
        issues.some((i) => i.condition === 'runtime_step_evidence'),
        true,
        '其他 receipt 校验（runtime fidelity attestation）保持不动（对照组）',
      );
    },
  },
  {
    name: 'codex 收口刀定向回归①：run 终态分类按实际执行切片——下游未跑不得判 needs_fix（宿主 PARTIAL 误报形态）',
    run: () => {
      const root = mkProject();
      seedCleanChain(root); // 只闭环 spec+plan
      // 实际切片（本 run 跑过的部分）：干净——needsFix/needsHuman 双 false
      const sliced = classifyCleanPassIssues(
        collectCleanPassIssues({ projectRoot: root, feature: FEATURE, chain: CHAIN }),
      );
      assert.strictEqual(sliced.needsFix, false, `实际切片不得 needs_fix：${JSON.stringify(sliced)}`);
      // 全链视角（含从未执行的 coding）：lineage missing → needs_fix——这正是宿主
      // run 20260815T093217Z-42d1bc 被误投 PARTIAL 的形态；终态分类必须用实际切片。
      const fullChain = classifyCleanPassIssues(
        collectCleanPassIssues({ projectRoot: root, feature: FEATURE, chain: [...CHAIN, 'coding'] }),
      );
      assert.strictEqual(fullChain.needsFix, true, '未执行下游按全链算必产 needs_fix（对照组）');
    },
  },
  {
    name: 'roundtrip：干净现场生成 → verify=VALID；原件在 runner-owned run 目录',
    run: () => {
      const root = mkProject();
      seedCleanChain(root);
      const { originalAbs } = generate(root);
      assert.ok(originalAbs.includes('goal-runs'));
      const v = verify(root);
      assert.strictEqual(v.verdict, 'VALID', v.reasons.join('；'));
    },
  },
  {
    name: 'run 血缘核验（codex 六轮 P0-4 复现）：引用 run 无 phase_start → INVALID；run_end 非成功态 → INVALID',
    run: () => {
      const root = mkProject();
      seedCleanChain(root);
      // 攻击 A：RUN1 只有 run_start（无 phase_start）——旧实现判 VALID
      writeRunEvents(root, 'RUN1', [{ ts: '2026-07-12T23:00:00.000Z', type: 'run_start', chain: CHAIN }]);
      generate(root);
      let v = verify(root);
      assert.strictEqual(v.verdict, 'INVALID', '无 phase_start 血缘=伪造');
      assert.ok(v.reasons.some((r) => r.includes('phase_start') || r.includes('从未执行')));
      // 攻击 B：有 phase_start 但 run_end=HALTED（非成功态不得作 clean 血缘）
      writeRunEvents(root, 'RUN1', [
        { ts: '2026-07-12T23:00:00.000Z', type: 'run_start', chain: CHAIN },
        ...CHAIN.map((phase, i) => ({ ts: `2026-07-12T23:0${i + 1}:00.000Z`, type: 'phase_start', phase })),
        { ts: '2026-07-12T23:30:00.000Z', type: 'run_end', status: 'HALTED' },
      ]);
      generate(root);
      v = verify(root);
      assert.strictEqual(v.verdict, 'INVALID');
      assert.ok(v.reasons.some((r) => r.includes('HALTED') || r.includes('非成功态')));
      // 攻击 C（codex 七轮 P0-1）：有 phase_start 但 run_end **缺失**（崩溃/中断/截断）
      writeRunEvents(root, 'RUN1', [
        { ts: '2026-07-12T23:00:00.000Z', type: 'run_start', chain: CHAIN },
        ...CHAIN.map((phase, i) => ({ ts: `2026-07-12T23:0${i + 1}:00.000Z`, type: 'phase_start', phase })),
      ]);
      generate(root);
      v = verify(root);
      assert.strictEqual(v.verdict, 'INVALID', 'run_end 缺失=未终局不得完成');
      assert.ok(v.reasons.some((r) => r.includes('无 run_end')));
    },
  },
  {
    name: 'P0 device flow 无运行时证据（codex 七轮 P0-3）：clean_pass 拒绝且 needs_human 封顶',
    run: () => {
      const root = mkProject();
      writeArtifact(root, 'acceptance.yaml', [
        'schema_version: "1.0"',
        `feature: ${FEATURE}`,
        'flows: { f: { screens: [a, b] } }',
        'criteria:',
        '  - id: AC-1',
        '    priority: P0',
        '    ut_layer: device',
        '    linked_flow: f',
      ].join('\n'));
      const issues = collectCleanPassIssues({ projectRoot: root, feature: FEATURE, chain: CHAIN });
      const rt = issues.find((i) => i.condition === 'runtime_step_evidence');
      assert.ok(rt, '有 P0 device flow 必产 runtime_step_evidence 违例');
      assert.strictEqual(rt!.kind, 'needs_human');
      assert.strictEqual(classifyCleanPassIssues(issues).needsHuman, true);
      // codex 八轮 P0-1：空文件不再解除——唯一通道=有效 runtime_fidelity_attestation receipt
      const evPath = featureFilePath(root, FEATURE, path.join('testing', 'reports', '20260713', 'runtime-step-evidence.json'));
      fs.mkdirSync(path.dirname(evPath), { recursive: true });
      fs.writeFileSync(evPath, '{}', 'utf-8');
      assert.ok(
        collectCleanPassIssues({ projectRoot: root, feature: FEATURE, chain: CHAIN }).some((i) => i.condition === 'runtime_step_evidence'),
        '空文件不得解除封顶（后门已封）',
      );
      // 有效 receipt（ed25519 + registry 经 MAISON_TRUST_REGISTRY）→ 解除
      const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
      const regPath = path.join(root, '..', `reg-${path.basename(root)}.json`);
      fs.writeFileSync(regPath, JSON.stringify({
        schema_version: '1.0',
        issuers: [{ issuer_id: 'ops', keys: [{ key_id: 'k1', alg: 'ed25519', public_key_pem: publicKey.export({ type: 'spki', format: 'pem' }).toString() }] }],
      }), 'utf-8');
      process.env.MAISON_TRUST_REGISTRY = regPath;
      try {
        const payload = {
          action: 'runtime_fidelity_attestation' as const,
          feature: FEATURE,
          object_hash: runtimeFidelityObjectHash(root, FEATURE),
          issued_at: '2026-07-13T11:00:00.000Z',
          expiry: '2999-01-01T00:00:00.000Z',
        };
        const receipt = {
          schema_version: '1.0', receipt_id: 'r', issuer_id: 'ops', key_id: 'k1', alg: 'ed25519',
          payload_schema_version: '1.0', payload,
          signature: crypto.sign(null, canonicalReceiptPayload(payload), privateKey).toString('base64'),
        };
        fs.writeFileSync(runtimeFidelityReceiptPath(root, FEATURE), JSON.stringify(receipt), 'utf-8');
        assert.ok(
          !collectCleanPassIssues({ projectRoot: root, feature: FEATURE, chain: CHAIN }).some((i) => i.condition === 'runtime_step_evidence'),
          '有效 receipt 解除封顶',
        );
      } finally {
        delete process.env.MAISON_TRUST_REGISTRY;
      }
    },
  },
  {
    name: 'needs_fix vs needs_human 分类（codex 七轮 P1-2）：verdict FAIL/血缘 stale=needs_fix，不投影 AWAITING',
    run: () => {
      const root = mkProject();
      seedCleanChain(root);
      writeSummary(root, 'plan', 'FAIL');
      const issues = collectCleanPassIssues({ projectRoot: root, feature: FEATURE, chain: CHAIN });
      const cls = classifyCleanPassIssues(issues);
      assert.strictEqual(cls.needsFix, true);
      assert.strictEqual(cls.needsHuman, false, 'verdict FAIL 是 needs_fix，不封顶 AWAITING');
      assert.strictEqual(hasPendingHumanReview({ projectRoot: root, feature: FEATURE, chain: CHAIN }), false);
    },
  },
  {
    name: 'attempt 事件对账（codex 九轮 P1 复现）：改写 attempt+同步投影哈希 → INVALID；schema 守卫缺字段 INVALID 不抛异常',
    run: () => {
      const root = mkProject();
      seedCleanChain(root);
      const { originalAbs } = generate(root);
      // 攻击：改 attempt 为 forged-i999 并同步投影哈希
      const doc = JSON.parse(fs.readFileSync(originalAbs, 'utf-8'));
      doc.phases[0].attempt = 'forged-i999';
      const text = JSON.stringify(doc, null, 2) + '\n';
      fs.writeFileSync(originalAbs, text, 'utf-8');
      const cryptoM = require('crypto') as typeof import('crypto');
      fs.writeFileSync(featureFilePath(root, FEATURE, FEATURE_COMPLETION_FILENAME), JSON.stringify({
        schema_version: '1.1',
        original_path: path.relative(root, originalAbs).split(path.sep).join('/'),
        original_sha256: cryptoM.createHash('sha256').update(text, 'utf-8').digest('hex'),
      }), 'utf-8');
      let v = verify(root);
      assert.strictEqual(v.verdict, 'INVALID', 'attempt 改写须 INVALID');
      assert.ok(v.reasons.some((r) => r.includes('attempt')));
      // schema 守卫：删 artifact_hashes / supersedes → INVALID（不抛异常）
      for (const missing of ['artifact_hashes', 'supersedes'] as const) {
        const bad = JSON.parse(text);
        delete bad[missing];
        const badText = JSON.stringify(bad, null, 2) + '\n';
        fs.writeFileSync(originalAbs, badText, 'utf-8');
        fs.writeFileSync(featureFilePath(root, FEATURE, FEATURE_COMPLETION_FILENAME), JSON.stringify({
          schema_version: '1.1',
          original_path: path.relative(root, originalAbs).split(path.sep).join('/'),
          original_sha256: cryptoM.createHash('sha256').update(badText, 'utf-8').digest('hex'),
        }), 'utf-8');
        v = verify(root);
        assert.strictEqual(v.verdict, 'INVALID', `缺 ${missing} 须 INVALID 而非抛异常`);
      }
      // track 对账：expectedTrack 失配 → INVALID
      generate(root);
      v = verify(root, { expectedTrack: 'lite' });
      assert.strictEqual(v.verdict, 'INVALID');
      assert.ok(v.reasons.some((r) => r.includes('workflow_track')));
    },
  },
  {
    name: 'attempt 三态（codex 十轮 P1 复现）：合法 i<N> 正向 roundtrip VALID；malformed invoke_id 不退化 null → 验证 INVALID/生成拒产；expectedTrack 缺失 INVALID',
    run: () => {
      const root = mkProject();
      seedCleanChain(root);
      // 正向：事件含合法 invocation 序数 → 生产两侧（resolvePhaseRunIds→generate→verify）闭环
      writeRunEvents(root, 'RUN1', [
        { ts: '2026-07-12T23:00:00.000Z', type: 'run_start', chain: CHAIN },
        ...CHAIN.flatMap((phase, i) => [
          { ts: `2026-07-12T23:0${i + 1}:00.000Z`, type: 'phase_start', phase },
          { ts: `2026-07-12T23:0${i + 1}:30.000Z`, type: 'agent_invoke_start', phase, invoke_id: `RUN1-${phase}-i${i + 2}` },
        ]),
        { ts: '2026-07-12T23:30:00.000Z', type: 'run_end', status: 'CHAIN_SLICE_COMPLETED' },
      ]);
      const { runIds, attempts } = resolvePhaseRunIds(root, FEATURE, CHAIN);
      assert.deepStrictEqual(attempts, { spec: 'i2', plan: 'i3' }, '合法 i<N> 推导为 invocation 序数');
      generate(root, { phaseRunIds: runIds, phaseAttempts: attempts });
      let v = verify(root);
      assert.strictEqual(v.verdict, 'VALID', v.reasons.join('；'));

      // 负向（codex 十轮最小复现）：invoke_id=malformed + 凭证 attempt:null——
      // 旧实现推导退化 null，null===null 放行；现在须 INVALID。
      writeRunEvents(root, 'RUN1', [
        { ts: '2026-07-12T23:00:00.000Z', type: 'run_start', chain: CHAIN },
        ...CHAIN.map((phase, i) => ({ ts: `2026-07-12T23:0${i + 1}:00.000Z`, type: 'phase_start', phase })),
        { ts: '2026-07-12T23:05:00.000Z', type: 'agent_invoke_start', phase: 'spec', invoke_id: 'malformed' },
        { ts: '2026-07-12T23:30:00.000Z', type: 'run_end', status: 'CHAIN_SLICE_COMPLETED' },
      ]);
      generate(root); // phaseAttempts 缺省 → attempt 全 null（复现凭证形态）
      v = verify(root);
      assert.strictEqual(v.verdict, 'INVALID', 'malformed invocation 不得与"无 invocation"合流放行');
      assert.ok(v.reasons.some((r) => r.includes('invoke_id') || r.includes('invocation 事件非法')));
      // 生成侧同样 fail-closed：resolvePhaseRunIds 拒绝推导
      assert.throws(() => resolvePhaseRunIds(root, FEATURE, CHAIN), /非法/);

      // codex 十轮 P2：expectedTrack 缺失/空 → INVALID（fail-open API 已封）
      const v3 = verify(root, { expectedTrack: '' });
      assert.strictEqual(v3.verdict, 'INVALID');
      assert.ok(v3.reasons.some((r) => r.includes('expectedTrack')));
    },
  },
  {
    name: '缩链绕过（codex 五轮 P0 复现）：凭证 chain ⊂ workflow 链 → INVALID；跨 feature 同判',
    run: () => {
      const root = mkProject();
      seedCleanChain(root);
      generate(root);
      // 消费方按 workflow 解析出的真实链更长 → 自报 chain 失配即 INVALID
      const v = verify(root, { expectedChain: ['spec', 'plan', 'coding', 'review', 'ut', 'testing'] });
      assert.strictEqual(v.verdict, 'INVALID');
      assert.ok(v.reasons.some((r) => r.includes('缩链') || r.includes('chain')));
      // expectedChain 缺失=消费方违约 → 同样 INVALID（禁止退回信自报）
      const v2 = verifyFeatureCompletion({ projectRoot: root, feature: FEATURE, expectedChain: [], expectedTrack: 'full' });
      assert.strictEqual(v2.verdict, 'INVALID');
      // 凭证 feature 与待验 feature 失配
      const v3 = verifyFeatureCompletion({ projectRoot: root, feature: 'other-feature', expectedChain: CHAIN, expectedTrack: 'full' });
      assert.strictEqual(v3.verdict, 'INVALID');
    },
  },
  {
    name: '原件篡改 → 投影哈希失配 INVALID；投影缺指针字段 INVALID',
    run: () => {
      const root = mkProject();
      seedCleanChain(root);
      const { originalAbs } = generate(root);
      fs.appendFileSync(originalAbs, '\n', 'utf-8');
      assert.strictEqual(verify(root).verdict, 'INVALID');

      const projAbs = featureFilePath(root, FEATURE, FEATURE_COMPLETION_FILENAME);
      fs.writeFileSync(projAbs, JSON.stringify({ schema_version: '1.0' }), 'utf-8');
      const v = verify(root);
      assert.strictEqual(v.verdict, 'INVALID');
      assert.ok(v.reasons.some((r) => r.includes('禁止以文件存在性')));
    },
  },
  {
    name: '手工伪造（codex 终审剧本）：schema 合法+投影自洽但 aggregate 对不上重算 → INVALID',
    run: () => {
      const root = mkProject();
      seedCleanChain(root);
      const dir = runDirAbs(root, 'FAKE');
      fs.mkdirSync(dir, { recursive: true });
      const fake = {
        schema_version: '1.1', feature: FEATURE, generated_at: '2026-07-13T00:00:00.000Z',
        run_id: 'FAKE', workflow_track: 'full', chain: CHAIN,
        artifact_hashes: { spec_md: 'f'.repeat(64), acceptance_yaml: 'f'.repeat(64), contracts_yaml: null },
        requirement_sha256: null, review_attestation_aggregate: null, testing_source_aggregate: 'f'.repeat(64),
        phases: CHAIN.map((phase) => ({
          phase, run_id: 'FAKE', attempt: null, gate_fingerprint: null,
          receipt_sha256: 'a'.repeat(64), evidence_manifest_aggregate: 'b'.repeat(64),
        })),
        parent_run_id: null, supersedes: [],
      };
      const text = JSON.stringify(fake, null, 2) + '\n';
      const originalAbs = path.join(dir, FEATURE_COMPLETION_FILENAME);
      fs.writeFileSync(originalAbs, text, 'utf-8');
      const crypto = require('crypto') as typeof import('crypto');
      fs.writeFileSync(featureFilePath(root, FEATURE, FEATURE_COMPLETION_FILENAME), JSON.stringify({
        schema_version: '1.0',
        original_path: path.relative(root, originalAbs).split(path.sep).join('/'),
        original_sha256: crypto.createHash('sha256').update(text, 'utf-8').digest('hex'),
      }), 'utf-8');
      const v = verify(root);
      assert.strictEqual(v.verdict, 'INVALID');
      assert.ok(v.reasons.some((r) => r.includes('失配')));
    },
  },
  {
    name: '世界后变 → STALE：acceptance 改动；更晚 HALTED run',
    run: () => {
      const root = mkProject();
      seedCleanChain(root);
      generate(root);
      const acc = resolveFeatureArtifact(root, FEATURE, 'acceptance.yaml').actualPath;
      const original = fs.readFileSync(acc, 'utf-8');
      fs.appendFileSync(acc, 'changed: true\n', 'utf-8');
      let v = verify(root);
      assert.strictEqual(v.verdict, 'STALE', v.reasons.join('；'));
      fs.writeFileSync(acc, original, 'utf-8');
      assert.strictEqual(verify(root).verdict, 'VALID');

      writeRunEvents(root, 'RUN2', [
        { ts: '2026-07-14T00:00:00.000Z', type: 'run_end', status: 'HALTED' },
      ]);
      v = verify(root);
      // plan e7c2a4d8 T1d 契约更正：真实 run 恒有 manifest（无 manifest+有 events=
      // corrupt），而后建 run 的 manifest 本就进 requirement SSOT aggregate（七轮
      // P1-3）→ 凭证按设计 INVALID（需求 SSOT 变更）且同时携「更晚未终局 run」
      // 新鲜度理由。旧 STALE 期望依赖「RUN2 无 manifest」的不真实夹具。
      assert.ok(v.verdict === 'INVALID' || v.verdict === 'STALE', v.verdict);
      assert.ok(v.reasons.some((r) => r.includes('RUN2')), v.reasons.join('；'));
    },
  },
  {
    name: 'supersedes 审计核验（codex 五轮 P1）：自报无事件 → INVALID；有 --supersede 审计事件 → VALID',
    run: () => {
      const root = mkProject();
      seedCleanChain(root);
      writeRunEvents(root, 'RUN2', [
        { ts: '2026-07-14T00:00:00.000Z', type: 'run_end', status: 'HALTED' },
      ]);
      // 自报 supersedes 但 RUN1 events 无审计事件 → 自报失配 INVALID（绕过不再是测试契约）
      generate(root, { supersedes: ['RUN2'] });
      let v = verify(root);
      assert.strictEqual(v.verdict, 'INVALID');
      assert.ok(v.reasons.some((r) => r.includes('无对应审计事件')));

      // 补上真实审计事件后重新生成 → VALID（保留 phase_start 血缘 + 成功 run_end）
      writeRunEvents(root, 'RUN1', [
        { ts: '2026-07-12T23:00:00.000Z', type: 'run_start', chain: CHAIN },
        ...CHAIN.map((phase, i) => ({ ts: `2026-07-12T23:0${i + 1}:00.000Z`, type: 'phase_start', phase })),
        { ts: '2026-07-12T23:30:00.000Z', type: 'run_end', status: 'CHAIN_SLICE_COMPLETED' },
        { ts: '2026-07-14T01:00:00.000Z', type: 'supersede', target_run_id: 'RUN2' },
      ]);
      generate(root, { supersedes: ['RUN2'] });
      v = verify(root);
      assert.strictEqual(v.verdict, 'VALID', v.reasons.join('；'));
    },
  },
];

export function runAll(): UnitCaseResult[] {
  return cases.map((c) => {
    try {
      c.run();
      return { name: `verify-feature-completion: ${c.name}`, ok: true };
    } catch (err) {
      return {
        name: `verify-feature-completion: ${c.name}`,
        ok: false,
        error: (err as Error).stack ?? (err as Error).message,
      };
    }
  });
}
