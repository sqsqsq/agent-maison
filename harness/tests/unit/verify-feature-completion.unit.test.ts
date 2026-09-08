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
  verifyFeatureCompletion,
} from '../../scripts/utils/verify-feature-completion';
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

function writeArtifact(root: string, name: string, content: string): void {
  const p = resolveFeatureArtifact(root, FEATURE, name).canonicalPath;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf-8');
}

/** 最小合法 lattice（过 validateQualityAxes：P0-3 裸 1.1 拒收后夹具须带轴） */
function minimalAxes(): Record<string, unknown> {
  const na = { applicable: false, required_for_release: false, verdict: 'NOT_APPLICABLE', blocking_class: null, source_checks: [], resolution: null };
  return {
    functional: { applicable: true, required_for_release: true, verdict: 'PASS', blocking_class: null, source_checks: [], resolution: null },
    visual: na, asset: na, evidence: na,
  };
}

function writeSummary(root: string, phase: string, verdict: string): void {
  const p = path.join(receiptDirPath(root, FEATURE, phase), 'reports', 'summary.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  // completion 干净依据须 summary 1.2 + lattice + closure commit；
  // legacy 1.0 拒绝行为由专门用例覆盖（writeLegacySummary）。
  fs.writeFileSync(p, JSON.stringify({
    schema_version: '1.2',
    verdict,
    report_validity: 'PASS',
    quality_axes: minimalAxes(),
    release_readiness: 'READY',
    completion_status: 'COMPLETE',
    assurance: 'full',
    capability_resolutions: [],
    capability_resolution_contract_fingerprint: null,
    closure_status: 'closed',
    closure_commit: { schema_version: '1.0' },
  }), 'utf-8');
}

function writeLegacySummary(root: string, phase: string, verdict: string): void {
  const p = path.join(receiptDirPath(root, FEATURE, phase), 'reports', 'summary.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ schema_version: '1.0', verdict }), 'utf-8');
}

function writeReceipt(root: string, phase: string): void {
  const p = receiptPathForPhase(root, FEATURE, phase);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `feature: "${FEATURE}"\nphase: "${phase}"\nverdict: PASS\n`, 'utf-8');
}

function writeRunEvents(root: string, runId: string, events: Array<Record<string, unknown>>): void {
  const p = featureFilePath(root, FEATURE, path.join('goal-runs', runId, 'events.jsonl'));
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const normalized = events.some((event) => event.type === 'run_start')
    ? events
    : [{ ts: '2026-07-13T23:59:00.000Z', type: 'run_start', chain: CHAIN }, ...events];
  fs.writeFileSync(p, normalized.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf-8');
  // plan e7c2a4d8 T1d：真实 runner 恒在启动即写 manifest——fixture 同步落一份，
  // 否则「有 events 无 manifest」会被残留二分正确判为 corrupt run（v22 P1 契约）。
  const manifestAbs = featureFilePath(root, FEATURE, path.join('goal-runs', runId, 'manifest.json'));
  if (!fs.existsSync(manifestAbs)) {
    // requirement 字段留空：feature 级 intent 拼接（collectRequirementIntentText）
    // 对空 requirement 零贡献——后建 run 不因 fixture 需求文本重复而翻转需求 SSOT。
    fs.writeFileSync(
      manifestAbs,
      JSON.stringify({ schema_version: '1.0', feature: FEATURE, run_id: runId }),
      'utf-8',
    );
  }
}

/**
 * 全链干净现场：artifacts + PASS summaries + receipts + evidence manifests(+回执指针) +
 * RUN1 事件（含每 phase 的 phase_start + 成功 run_end，满足 codex P0-4 血缘核验）。
 */
function seedCleanChain(
  root: string,
  opts?: { chain?: string[]; invocations?: boolean; beforeClosure?: (root: string) => void },
): void {
  const chain = opts?.chain ?? CHAIN;
  writeArtifact(root, 'spec.md', '# spec\n');
  writeArtifact(root, 'acceptance.yaml', 'criteria: []\n');
  writeArtifact(root, 'plan.md', '# plan\n');
  writeArtifact(root, 'contracts.yaml', 'files: []\n');
  // plan a3f7c1d9 V4：闭环前追加/覆盖夹具（P0 acceptance、device-test-evidence、trace），
  // 让 manifest 冻结的是最终字节；invocations=true 时每 phase 落 agent_invoke_start（attempt=i<N>）。
  opts?.beforeClosure?.(root);
  // plan e7c2a4d8 T1d：先落 RUN1 manifest（真实 runner 启动即写）——evidence 血缘
  // 与残留二分（有 events 无 manifest=corrupt）都以其在场为前提；requirementSha
  // 绑定 closure（八/九轮 requirement 血缘契约）。
  writeRunEvents(root, 'RUN1', [
    { ts: '2026-07-12T23:00:00.000Z', type: 'run_start', chain },
    ...chain.flatMap((phase, i) => [
      { ts: `2026-07-12T23:0${i + 1}:00.000Z`, type: 'phase_start', phase },
      ...(opts?.invocations
        ? [{ ts: `2026-07-12T23:0${i + 1}:30.000Z`, type: 'agent_invoke_start', phase, invoke_id: `RUN1-${phase}-i${i + 2}` }]
        : []),
    ]),
    { ts: '2026-07-12T23:30:00.000Z', type: 'run_end', status: 'CHAIN_SLICE_COMPLETED' },
  ]);
  const reqSha = computeRunRequirementSha(root, FEATURE, 'RUN1');
  for (const phase of chain) {
    writeSummary(root, phase, 'PASS');
    writeReceipt(root, phase);
    const written = writePhaseEvidenceManifest(root, resolvePhaseEvidenceManifest({
      projectRoot: root, feature: FEATURE, phase: phase as Phase, now: FIXED_NOW, requirementSha: reqSha,
    }));
    writeReceiptManifestPointer(root, FEATURE, phase, `doc/features/${FEATURE}/${phase}/reports/phase-evidence-manifest.json`, written.sha256);
  }
}

// ---------------- plan a3f7c1d9 V4–V6 夹具：P0 acceptance + native v1 信封 trace + device-test-evidence ----------------
const CHAIN_T = ['spec', 'plan', 'testing'];
const P0_ACCEPTANCE = [
  'schema_version: "1.0"',
  `feature: ${FEATURE}`,
  'flows: { f: { screens: [a, b] } }',
  'criteria:',
  '  - id: AC-1',
  '    priority: P0',
  '    ut_layer: device',
  '    linked_flow: f',
].join('\n') + '\n';
/** 只需过 dispatchHylyreResult（schema_version + result_protocol + environment + cases[]），不必是完整 golden */
const V1_TRACE = {
  schema_version: '0.4-p0', result_protocol: 'hylyre.step-outcome/1',
  environment: { trace_schema_version: '0.4-p0', result_protocol: 'hylyre.step-outcome/1', selector_engine: 'fixture' },
  cases: [], tool_calls: [],
};
const LEGACY_TRACE = { schema_version: '0.3-p0', feature: FEATURE, cases: [] };

function writeNativeRuntimeEvidence(
  root: string,
  over?: { trace?: unknown; traceAbs?: string; doc?: Record<string, unknown> },
): void {
  const reportsDir = path.join(receiptDirPath(root, FEATURE, 'testing'), 'reports');
  const traceAbs = over?.traceAbs ?? path.join(reportsDir, 'hylyre', 'trace.json');
  fs.mkdirSync(path.dirname(traceAbs), { recursive: true });
  fs.writeFileSync(traceAbs, JSON.stringify(over?.trace ?? V1_TRACE, null, 2) + '\n', 'utf-8');
  const cryptoM = require('crypto') as typeof import('crypto');
  const traceSha = cryptoM.createHash('sha256').update(fs.readFileSync(traceAbs)).digest('hex');
  const doc: Record<string, unknown> = {
    schema_version: '1.1', goal_run_id: 'RUN1', attempt_id: 'i4',
    device_target: { serial: 'dev-1', target_kind: 'physical', session_id: null },
    hap_sha256_full: 'a'.repeat(64), install_executed: true, install_ok: true,
    trace_path: traceAbs, run_failure_kind: null, written_at: '2026-07-12T23:03:40.000Z', cases: [],
    artifact_binding: {
      test_plan_path: 'testing/test-plan.md', test_plan_sha256: 'b'.repeat(64),
      derived_plan_path: 'testing/derived-plan.json', derived_plan_sha256: 'c'.repeat(64),
      trace_path: traceAbs, trace_sha256: traceSha,
    },
    ...over?.doc,
  };
  fs.mkdirSync(reportsDir, { recursive: true });
  fs.writeFileSync(path.join(reportsDir, 'device-test-evidence.json'), JSON.stringify(doc, null, 2) + '\n', 'utf-8');
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
    name: 'clean_pass：verdict/档位钳制拒生成；legacy waiver 与账本待复核均只留审计',
    run: () => {
      const root = mkProject();
      seedCleanChain(root);
      writeSummary(root, 'plan', 'FAIL');
      assert.throws(() => generate(root), /verdict_pass/);
      writeSummary(root, 'plan', 'PASS');

      const waiver = featureFilePath(root, FEATURE, 'testing/skip-waivers.yaml');
      fs.mkdirSync(path.dirname(waiver), { recursive: true });
      fs.writeFileSync(waiver, 'waivers:\n  - tc_id: TC-1\n', 'utf-8');
      assert.doesNotThrow(() => generate(root));
      fs.rmSync(waiver);

      // 档位钳制仍阻断，但投影为 needs_fix/capability 路径而非 needs_human。
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
    name: 'flow_contract 缺 receipt 不进 clean_pass；P0 runtime fidelity 改为机器证据硬门',
    run: () => {
      const root = mkProject();
      seedCleanChain(root);
      // 带 P0 device flow 的 acceptance：flow_contract 人签已退役，runtime 机器证据仍为硬义务。
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
        'P0 runtime fidelity 机器证据缺失必须阻断',
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
    name: 'P0 device flow 无机器运行时证据：clean_pass needs_fix；legacy runtime receipt 无放行权',
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
      assert.strictEqual(rt!.kind, 'needs_fix');
      assert.strictEqual(classifyCleanPassIssues(issues).needsFix, true);
      assert.strictEqual(classifyCleanPassIssues(issues).needsHuman, false);
      // 任意空文件不得解除。
      const evPath = featureFilePath(root, FEATURE, path.join('testing', 'reports', '20260713', 'runtime-step-evidence.json'));
      fs.mkdirSync(path.dirname(evPath), { recursive: true });
      fs.writeFileSync(evPath, '{}', 'utf-8');
      assert.ok(
        collectCleanPassIssues({ projectRoot: root, feature: FEATURE, chain: CHAIN }).some((i) => i.condition === 'runtime_step_evidence'),
        '空文件不得解除质量义务',
      );
      // 即便放入历史 runtime_fidelity_attestation receipt，它也只是 legacy 文件，不再改写机器结论。
      const legacyRuntimeReceipt = featureFilePath(root, FEATURE, path.join('testing', 'runtime-fidelity.receipt.json'));
      fs.mkdirSync(path.dirname(legacyRuntimeReceipt), { recursive: true });
      fs.writeFileSync(legacyRuntimeReceipt, '{"legacy":true}\n', 'utf-8');
      assert.ok(
        collectCleanPassIssues({ projectRoot: root, feature: FEATURE, chain: CHAIN }).some((i) => i.condition === 'runtime_step_evidence'),
        'legacy receipt 不得解除机器证据缺失',
      );
    },
  },
  // ---------------- plan a3f7c1d9 D2：完成侧按 trace 协议三态分派（V4–V7）----------------
  {
    name: 'V4 正例：P0 device flow + native v1 trace + artifact_binding + testing manifest 冻结 → 无 runtime_step_evidence；generate 成功、verify VALID（首个 P0 需求干净完成正例）',
    run: () => {
      const root = mkProject();
      seedCleanChain(root, {
        chain: CHAIN_T, invocations: true,
        beforeClosure: (r) => { writeArtifact(r, 'acceptance.yaml', P0_ACCEPTANCE); writeNativeRuntimeEvidence(r); },
      });
      const issues = collectCleanPassIssues({ projectRoot: root, feature: FEATURE, chain: CHAIN_T });
      assert.strictEqual(
        issues.length, 0,
        `native v1 证据在场且被 manifest 冻结时不得有任何 clean-pass issue：${issues.map((i) => `[${i.phase}] ${i.condition}: ${i.detail}`).join('；')}`,
      );
      const { runIds, attempts } = resolvePhaseRunIds(root, FEATURE, CHAIN_T);
      assert.strictEqual(attempts.testing, 'i4', 'testing attempt 推导');
      generate(root, { chain: CHAIN_T, phaseRunIds: runIds, phaseAttempts: attempts });
      const v = verify(root, { expectedChain: CHAIN_T });
      assert.strictEqual(v.verdict, 'VALID', v.reasons.join('；'));
    },
  },
  {
    name: 'V5 反例：attempt_id 改 → 不匹配；manifest 不含 trace → 未绑定；缺 artifact_binding → 文案；legacy_unsupported 且无 runtime_fidelity → 文案',
    run: () => {
      const runtimeIssue = (seed: (r: string) => void): string => {
        const root = mkProject();
        seedCleanChain(root, { chain: CHAIN_T, invocations: true, beforeClosure: (r) => { writeArtifact(r, 'acceptance.yaml', P0_ACCEPTANCE); seed(r); } });
        const hit = collectCleanPassIssues({ projectRoot: root, feature: FEATURE, chain: CHAIN_T }).find((i) => i.condition === 'runtime_step_evidence');
        assert.ok(hit, '须产生 runtime_step_evidence 违例');
        assert.strictEqual(hit!.kind, 'needs_fix');
        return hit!.detail;
      };
      assert.match(runtimeIssue((r) => writeNativeRuntimeEvidence(r, { doc: { attempt_id: 'i9' } })), /attempt_id 不匹配/);
      assert.match(
        runtimeIssue((r) => writeNativeRuntimeEvidence(r, { traceAbs: path.join(r, 'elsewhere', 'trace.json') })),
        /未绑定 runtime 产物/,
        'trace 不在 reports 目录 → manifest 不冻结 → 未绑定',
      );
      assert.match(runtimeIssue((r) => writeNativeRuntimeEvidence(r, { doc: { artifact_binding: undefined } })), /缺 artifact_binding/);
      assert.match(runtimeIssue((r) => writeNativeRuntimeEvidence(r, { trace: LEGACY_TRACE })), /既无 native v1 trace 也无 legacy runtime_fidelity/);
    },
  },
  {
    name: 'V6 三态：v1 trace + doc 含 runtime_fidelity → 只走 native（无 issue）；unsupported trace + runtime_fidelity → 仍 needs_fix 不回落；legacy_unsupported + runtime_fidelity → legacy 分支',
    run: () => {
      // 结构完整的 legacy runtime_fidelity（provider 四字段、bindings 十字段、一条完整 checkpoint）——
      // 证明 unsupported 分支的 needs_fix 不是因为字段缺失，而是 trace 协议不可判别/混装本身。
      const legacyFidelity = {
        schema_version: '1.0',
        provider: { id: 'hylyre', version: '0.4.0', collector: 'hylyre-runtime-telemetry', collector_version: '0.4.0' },
        bindings: {
          feature: FEATURE, goal_run_id: 'RUN1', attempt_id: 'i4', device_session_id: 'sess-1',
          acceptance_sha256: 'd'.repeat(64), test_plan_sha256: 'b'.repeat(64), derived_plan_sha256: 'c'.repeat(64),
          hap_sha256_full: 'a'.repeat(64), testing_source_aggregate: 'e'.repeat(64), trace_sha256: 'f'.repeat(64),
        },
        checkpoints: [{
          acceptance_id: 'AC-1', flow_id: 'f', case_id: 'TC-1', step_index: 0, action_kind: 'tap',
          declared_target_element_id: 'btn_open',
          actual_hit: { stable_node_id: 'node#btn_open', bounds: [0, 0, 100, 40] },
          pre_screen: { declared_screen_id: 'a', signature_sha256: '1'.repeat(64), observed_element_ids: ['btn_open'] },
          post_screen: { declared_screen_id: 'b', signature_sha256: '2'.repeat(64), observed_element_ids: ['title_b'] },
          required_observations: [{ element_id: 'title_b', present: true }],
          forbidden_observations: [{ element_id: 'err_toast', present: false }],
          outcome: 'passed',
        }],
      };
      const issuesFor = (seed: (r: string) => void) => {
        const root = mkProject();
        seedCleanChain(root, { chain: CHAIN_T, invocations: true, beforeClosure: (r) => { writeArtifact(r, 'acceptance.yaml', P0_ACCEPTANCE); seed(r); } });
        return collectCleanPassIssues({ projectRoot: root, feature: FEATURE, chain: CHAIN_T }).filter((i) => i.condition === 'runtime_step_evidence');
      };
      // v1 + runtime_fidelity（legacy 重算必不过：sha 均为占位）→ native 分支不看它 → 无 issue
      assert.deepStrictEqual(issuesFor((r) => writeNativeRuntimeEvidence(r, { doc: { runtime_fidelity: legacyFidelity } })), [], 'v1 只走 native');
      // unsupported：缺 schema_version / 混装（legacy 版本却声明 result_protocol）→ 即使带 runtime_fidelity 也不回落
      for (const trace of [{ cases: [] }, { schema_version: '0.3-p0', result_protocol: 'hylyre.step-outcome/1', cases: [] }]) {
        const hits = issuesFor((r) => writeNativeRuntimeEvidence(r, { trace, doc: { runtime_fidelity: legacyFidelity } }));
        assert.strictEqual(hits.length, 1, `unsupported trace 须 needs_fix：${JSON.stringify(trace)}`);
        assert.strictEqual(hits[0].kind, 'needs_fix', 'unsupported 是 needs_fix，不是 needs_human');
        assert.match(hits[0].detail, /trace 协议不可判别\/混装/, '结构完整的 runtime_fidelity 也不回落 legacy');
      }
      // legacy_unsupported + runtime_fidelity → 原 legacy 校验（过渡）：不是 native/unsupported 文案，而是 legacy 重算的失败原因
      const legacyHits = issuesFor((r) => writeNativeRuntimeEvidence(r, { trace: LEGACY_TRACE, doc: { runtime_fidelity: legacyFidelity } }));
      assert.strictEqual(legacyHits.length, 1);
      assert.doesNotMatch(legacyHits[0].detail, /既无 native|不可判别|缺 artifact_binding/);
      assert.match(legacyHits[0].detail, /runtime fidelity|trace/, `legacy 分支文案：${legacyHits[0].detail}`);
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
