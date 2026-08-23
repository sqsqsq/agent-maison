// ============================================================================
// goal-runner-repair-convergence.unit.test.ts — adjudicated-repair-loop M1
// ----------------------------------------------------------------------------
// 覆盖（plan e2b7c4a9 t1.8；design §3）：
//   1. 60bcd1 events 反演：i12→i16 屏级→信号级身份漂移后，expanded 伪缺陷身份 ∈
//      attempted（其回退窗口后目标 phase 已执行）→ eligible 空 → 停 repair_not_converging；
//      i17 no-op（快照 pre/post 相等）语义由 runner 决策（纯函数层验证 eligible 空）。
//   2. A/C 交替：A 已 attempted 后，C 的触发轮不使 A 重获资格。
//   3. crash 两场景：request 后目标 phase 未执行 → 仍 eligible（resume 收到候选）；
//      settled 后崩溃 → 已 attempted，不再自动修。
//   4. collectActionableDefects 信号级：每结构化 defect 一条候选、identity 指纹=
//      sha256(computeDefectFingerprint(screen, defect))、指令经 must_fix_refs 反向解析；
//      纯文本 must_fix 保底 legacy。
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import {
  collectActionableDefects,
  computeEligibleSignalIdentities,
  deriveHaltValidationOnlyEligibility,
  replayAttemptedSignalIdentities,
  type BacktrackWindowEvent,
} from '../../scripts/goal-runner';
import { actionableDefectsToCandidates, validateRepairCandidatesShape } from '../../scripts/utils/repair-candidates';
import type { UnitCaseResult } from '../run-unit';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const cases: Array<{ name: string; run: () => void }> = [];

/** 登记用例（不执行）——runAll 统一遍历执行并捕获异常（标准模式，防假 PASS） */
function run(name: string, fn: () => void): void {
  cases.push({ name, run: fn });
}

const FP_A = 'a'.repeat(64);
const FP_B = 'b'.repeat(64);
const FP_C = 'c'.repeat(64);

const signalCandidate = (fp: string) => ({
  id: 'visual_diff:screen',
  category: 'coding' as const,
  files: [],
  summary: 'x',
  item_fingerprint: fp,
  source_phase: 'testing',
  identity_schema: 'signal@1' as const,
});

const legacyCandidate = (fp: string) => ({
  id: 'check:x',
  category: 'coding' as const,
  files: [],
  summary: 'x',
  item_fingerprint: fp,
  source_phase: 'review',
});

const events = (...evs: BacktrackWindowEvent[]): BacktrackWindowEvent[] => evs;

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];
  run('60bcd1 i16 反演：expanded 伪缺陷已 attempted → eligible 空（停）', () => {
    // 事件序列：第一次回退（collapsed 真缺陷）→ coding 执行（settled）→ 第二次回退
    // （i12 屏级聚合 → i16 信号级展开后同一 expanded 伪缺陷再次 open）→ 目标 phase 已执行。
    const evs = events(
      { type: 'phase_backtrack_requested', to_phase: 'coding', candidates: [signalCandidate(FP_A)] },
      { type: 'phase_backtrack_started', to_phase: 'coding' },
      { type: 'agent_process_settled', phase: 'coding' },
      { type: 'phase_backtrack_requested', to_phase: 'coding', candidates: [signalCandidate(FP_B)] },
      { type: 'phase_backtrack_started', to_phase: 'coding' },
      { type: 'agent_process_settled', phase: 'coding' },
    );
    const attempted = replayAttemptedSignalIdentities(evs);
    assert(attempted.has(FP_A), 'FP_A 已 attempted（第一次回退目标 phase 已执行）');
    assert(attempted.has(FP_B), 'FP_B 已 attempted（第二次回退目标 phase 已执行）');
    // i16 轮 expanded 伪缺陷 open 身份（此前某轮已 attempted）→ eligible 空
    const open = [signalCandidate(FP_A), signalCandidate(FP_B)];
    const eligible = computeEligibleSignalIdentities(open, attempted);
    assert(eligible.length === 0, 'eligible 必须为空 → runner 停 repair_not_converging');
  });

  run('A/C 交替：A 已 attempted 后不因 C 触发的新回退重获资格', () => {
    // A 驱动回退并执行（失败未消除）；C 驱动另一轮回退并执行；下一轮 A 又 open。
    const evs = events(
      { type: 'phase_backtrack_requested', to_phase: 'coding', candidates: [signalCandidate(FP_A)] },
      { type: 'agent_process_settled', phase: 'coding' },
      { type: 'phase_backtrack_requested', to_phase: 'coding', candidates: [signalCandidate(FP_C)] },
      { type: 'agent_process_settled', phase: 'coding' },
    );
    const attempted = replayAttemptedSignalIdentities(evs);
    assert(attempted.has(FP_A) && attempted.has(FP_C), 'A 与 C 均已 attempted');
    const open = [signalCandidate(FP_A), signalCandidate(FP_C)];
    const eligible = computeEligibleSignalIdentities(open, attempted);
    assert(eligible.length === 0, 'A/C 均不重获资格（累计 one-shot）');
    // 新身份 D open 时：D eligible，A 仍不
    const open2 = [signalCandidate(FP_A), signalCandidate('d'.repeat(64))];
    const eligible2 = computeEligibleSignalIdentities(open2, attempted);
    assert(eligible2.length === 1 && eligible2[0].item_fingerprint === 'd'.repeat(64),
      '只有从未 attempted 的 D 可回退');
  });

  run('crash 场景 1：request 后目标 phase 未执行 → 候选仍 eligible（resume 收到）', () => {
    // request → crash（无 settled/verdict）→ resume
    const evs = events(
      { type: 'phase_backtrack_requested', to_phase: 'coding', candidates: [signalCandidate(FP_A)] },
      { type: 'phase_backtrack_started', to_phase: 'coding' },
    );
    const attempted = replayAttemptedSignalIdentities(evs);
    assert(!attempted.has(FP_A), '未执行的 request-only 候选不得计入 attempted');
    const eligible = computeEligibleSignalIdentities([signalCandidate(FP_A)], attempted);
    assert(eligible.length === 1, 'resume 后 candidate 仍 eligible（既有 crash/resume 契约不破）');
  });

  run('crash 场景 2：目标 phase settled 后崩溃 → 已 attempted，不再自动修', () => {
    // request → coding 执行（settled）→ completed 前崩溃 → resume
    const evs = events(
      { type: 'phase_backtrack_requested', to_phase: 'coding', candidates: [signalCandidate(FP_A)] },
      { type: 'agent_process_settled', phase: 'coding' },
    );
    const attempted = replayAttemptedSignalIdentities(evs);
    assert(attempted.has(FP_A), 'settled 后即计入 attempted（不依赖 completed）');
    const eligible = computeEligibleSignalIdentities([signalCandidate(FP_A)], attempted);
    assert(eligible.length === 0, '不得再次自动修');
  });

  run('legacy check-domain 候选不参与收敛判定（eligible 恒真）', () => {
    const evs = events(
      { type: 'phase_backtrack_requested', to_phase: 'coding', candidates: [legacyCandidate(FP_A)] },
      { type: 'agent_process_settled', phase: 'coding' },
    );
    const attempted = replayAttemptedSignalIdentities(evs);
    assert(attempted.size === 0, 'legacy（无 identity_schema）不入 attempted 回放');
    const eligible = computeEligibleSignalIdentities([legacyCandidate(FP_A)], attempted);
    assert(eligible.length === 1, 'legacy 候选保持既有可回退语义');
  });

  run('signal@1 标记随断言：actionableDefectsToCandidates 产出 identity_schema + sha256 指纹', () => {
    const defects = [{
      source: 'visual_diff',
      screen_or_case_id: 'add_card_home',
      instructions: ['修复文案'],
      fingerprint: 'add_card_home|shape_mismatch|hc_title|0.1,0.2,0.3,0.4',
      evidence_path: 'doc/features/x/device-testing/device-screenshots/visual-diff.json#add_card_home',
      signal_identity: true, // 结构化视觉信号才标 signal@1（review 修复）
    }];
    const cands = actionableDefectsToCandidates(defects, 'testing');
    assert(cands.length === 1, '单信号产一条候选');
    assert(cands[0].identity_schema === 'signal@1', '身份 schema 标记');
    assert(cands[0].item_fingerprint === createHash('sha256').update(defects[0].fingerprint, 'utf-8').digest('hex'),
      'identity = sha256(computeDefectFingerprint)');
    assert(validateRepairCandidatesShape(cands).length === 0, '形状合法');
    assert(validateRepairCandidatesShape([{ ...cands[0], identity_schema: 'bogus' }]).length > 0,
      '非法 identity_schema 报错');
  });

  run('collectActionableDefects：身份未绑定仍 fail-closed（unverified 不静默丢）', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-cell-'));
    try {
      const featDir = path.join(root, 'doc', 'features', 'demo');
      const shotsDir = path.join(featDir, 'device-testing', 'device-screenshots');
      fs.mkdirSync(shotsDir, { recursive: true });
      // visual-diff.json：一屏两条结构化 defects（各自 refs 指向不同 must_fix），
      // 但缺失 evaluated_screenshot_hash → 身份不可核实 → 全部进 unverified（fail-closed）。
      const visualDiff = {
        screens: [{
          screen_id: 'add_card_home_collapsed',
          verdict: 'fail',
          must_fix: ['修复标题文案', '修复银行行布局'],
          screenshot_path: 'shot-a.png',
          defects: [
            { class: 'shape_mismatch', element: 'hc_page_title', severity: 'major', note: '标题错位',
              must_fix_refs: [0], bbox: [0.1, 0.2, 0.3, 0.4] },
            { class: 'overlap', element: 'hc_bank_row', severity: 'major', note: '行重叠',
              must_fix_refs: [1], bbox: [0.5, 0.6, 0.7, 0.8] },
          ],
        }],
      };
      fs.writeFileSync(path.join(shotsDir, 'visual-diff.json'), JSON.stringify(visualDiff, null, 2), 'utf-8');
      const result = collectActionableDefects(root, 'demo', 'run-1');
      assert(result.defects.length === 0, '身份未绑定不产候选（fail-closed 不变）');
      assert(result.unverified.length >= 1, '身份缺失进 unverified（不静默丢）');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  // ---- t3 收口（plan t3 · adjudicated-repair-loop）：显式契约不回归断言 ----
  run('t3 契约不回归：结构视觉信号才标 signal@1（crash/device_test/纯文本 legacy 不参与收敛）', () => {
    const cands = actionableDefectsToCandidates([
      {
        source: 'visual_diff', screen_or_case_id: 's1', instructions: ['x'],
        fingerprint: 's1|shape_mismatch|e1|0.1,0.2,0.3,0.4', evidence_path: 'p', signal_identity: true,
      },
      {
        source: 'crash', screen_or_case_id: 's2', instructions: ['crash'],
        fingerprint: 'crash|s2', evidence_path: 'p', signal_identity: false,
      },
      {
        source: 'device_test', screen_or_case_id: 'TC-1', instructions: ['d'],
        fingerprint: 'product_actionable|TC-1|step:0|by_id:x', evidence_path: 'p', signal_identity: false,
      },
      {
        source: 'visual_diff', screen_or_case_id: 's3', instructions: ['text'],
        fingerprint: 's3|text:abc', evidence_path: 'p', signal_identity: false,
      },
    ], 'testing');
    assert(cands.filter((c) => c.identity_schema === 'signal@1').length === 1,
      `仅结构化视觉信号标 signal@1：${JSON.stringify(cands.map((c) => c.identity_schema))}`);
  });

  run('t3 契约不回归：no-op 判定后的 eligible 空由守卫 halt（纯函数层：attempted 集不回放进 eligible）', () => {
    // i17 反演：零改动修复 = 快照 pre/post 相等（runner 集成层判定）→ 候选并入 attempted
    // （settled 触发回放）→ 下一轮 eligible 空。纯函数层验证回放侧：settled 在案即 attempted。
    const evs = events(
      { type: 'phase_backtrack_requested', to_phase: 'coding', candidates: [signalCandidate(FP_A)] },
      { type: 'agent_process_settled', phase: 'coding' },
    );
    const attempted = replayAttemptedSignalIdentities(evs);
    assert(attempted.has(FP_A), 'target phase 已执行（settled）即计入 attempted（no-op 并入逻辑的输入）');
    assert(computeEligibleSignalIdentities([signalCandidate(FP_A)], attempted).length === 0,
      'no-op 后 eligible 空 → 守卫 halt repair_not_converging（runner 集成层断言见 R-8）');
  });

  run('t3 契约不回归：legacy 与 signal 混合时 legacy 仍可回退（不误伤 check-domain）', () => {
    const attempted = new Set([FP_A]);
    const open = [signalCandidate(FP_A), legacyCandidate('d'.repeat(64))];
    const eligible = computeEligibleSignalIdentities(open, attempted);
    assert(eligible.length === 1 && eligible[0].identity_schema === undefined,
      'signal 全 attempted 时 legacy 仍保留可回退（守卫只在全空时 halt）');
  });

  // ==========================================================================
  // plan b5f1d9c3 t1：resume 验证优先——deriveHaltValidationOnlyEligibility 反例矩阵
  // （7 条反例一律只断言“不进入 resumePostAgentPhases”（返回 null），不规定其后是否重新
  //  invoke agent——终态/人工 resume 契约本 change 不动）。
  // ==========================================================================
  const haltEv = (extra: Record<string, unknown>) => ({
    type: 'phase_halt', phase: 'testing', run_disposition: 'WAITING', ...extra,
  });
  const settledEv = (extra: Record<string, unknown>) => ({
    type: 'agent_process_settled', phase: 'testing', invoke_id: 'testing-i4', ...extra,
  });
  const harnessEndEv = (extra: Record<string, unknown>) => ({
    type: 'harness_end', phase: 'testing', invoke_id: 'testing-i4', exit_code: 0, ...extra,
  });
  // 正例基线：settled → harness_end → phase_halt(WAITING) →（run_end）→ resume 派生资格
  const baselineEvents = () => [
    settledEv({}),
    harnessEndEv({}),
    haltEv({}),
  ];

  run('b5f1d9c3 t1 正例：settled → harness_end → phase_halt(WAITING) → 派生 validation-only 资格', () => {
    const r = deriveHaltValidationOnlyEligibility(baselineEvents());
    assert(!!r, '正例应派生资格');
    assert(r!.phase === 'testing' && r!.invoke_id === 'testing-i4', '应返回 halt phase + 原 invoke_id');
  });

  run('b5f1d9c3 t1 反例①：settled 之后出现 FAIL phase_verdict → 不派生', () => {
    const r = deriveHaltValidationOnlyEligibility([
      settledEv({}),
      harnessEndEv({}),
      { type: 'phase_verdict', phase: 'testing', verdict: 'FAIL', action: 'halt' },
      haltEv({}),
    ]);
    assert(r === null, 'FAIL verdict 后不派生（不进入 resumePostAgentPhases）');
  });

  run('b5f1d9c3 t1 反例②：settled 之后出现更新的 agent_invoke_start → 不派生', () => {
    const r = deriveHaltValidationOnlyEligibility([
      settledEv({}),
      harnessEndEv({}),
      haltEv({}),
      { type: 'agent_invoke_start', phase: 'testing', invoke_id: 'testing-i5' },
    ]);
    assert(r === null, '更新的 invoke_start 后不派生');
  });

  run('b5f1d9c3 t1 反例③：settled 带 timeout/kill → 不派生', () => {
    const r1 = deriveHaltValidationOnlyEligibility([
      settledEv({ timed_out: true, kill_reason: 'agent_timeout' }),
      harnessEndEv({}),
      haltEv({}),
    ]);
    assert(r1 === null, 'timed_out settled 不派生');
    const r2 = deriveHaltValidationOnlyEligibility([
      settledEv({ kill_reason: 'agent_timeout' }),
      harnessEndEv({}),
      haltEv({}),
    ]);
    assert(r2 === null, 'kill_reason=agent_timeout 不派生');
  });

  run('b5f1d9c3 t1 反例④：settled 缺 invoke_id → 不派生', () => {
    const r = deriveHaltValidationOnlyEligibility([
      { type: 'agent_process_settled', phase: 'testing' },
      harnessEndEv({}),
      haltEv({}),
    ]);
    assert(r === null, '缺 invoke_id 的 settled 不派生');
  });

  run('b5f1d9c3 t1 反例⑤：halt 缺 run_disposition 投影 → 不派生', () => {
    const r = deriveHaltValidationOnlyEligibility([
      settledEv({}),
      harnessEndEv({}),
      { type: 'phase_halt', phase: 'testing' }, // 无 run_disposition
    ]);
    assert(r === null, 'halt 缺投影不派生');
  });

  run('b5f1d9c3 t1 反例⑥：halt 投影为 TERMINAL / RECOVERY_PENDING → 不派生（终态语义不动）', () => {
    const r1 = deriveHaltValidationOnlyEligibility([
      settledEv({}),
      harnessEndEv({}),
      haltEv({ run_disposition: 'TERMINAL' }),
    ]);
    assert(r1 === null, 'TERMINAL 投影不派生');
    const r2 = deriveHaltValidationOnlyEligibility([
      settledEv({}),
      harnessEndEv({}),
      haltEv({ run_disposition: 'RECOVERY_PENDING' }),
    ]);
    assert(r2 === null, 'RECOVERY_PENDING 投影不派生');
  });

  run('b5f1d9c3 t1 反例⑦（review P1）：halt 之后出现更新的 backtrack/invalidated 窗口 → 不派生（新窗口优先）', () => {
    // request-only crash 组合：settled → harness → halt(WAITING) → resume → backtrack → 崩溃
    const r1 = deriveHaltValidationOnlyEligibility([
      settledEv({}),
      harnessEndEv({}),
      haltEv({}),
      { type: 'phase_backtrack_requested', to_phase: 'coding' },
      { type: 'agent_invoke_start', phase: 'coding', invoke_id: 'coding-i5' },
    ]);
    assert(r1 === null, 'halt 后出现 backtrack 不派生（资格交给 applyInvalidationsToResume）');
    const r2 = deriveHaltValidationOnlyEligibility([
      settledEv({}),
      harnessEndEv({}),
      haltEv({}),
      { type: 'phase_invalidated', phase: 'testing' },
    ]);
    assert(r2 === null, 'halt 后出现 invalidation 不派生');
    // 同一 halt 之前已有 backtrack 的历史窗口不受影响（本函数只看 halt 之后）
    const r3 = deriveHaltValidationOnlyEligibility([
      settledEv({}),
      harnessEndEv({}),
      { type: 'phase_backtrack_requested', to_phase: 'coding' },
      settledEv({ invoke_id: 'testing-i4' }),
      harnessEndEv({ invoke_id: 'testing-i4' }),
      haltEv({}),
    ]);
    assert(!!r3 && r3.invoke_id === 'testing-i4', 'halt 前的旧 backtrack 不影响（用最新 settled 身份）');
  });

  run('b5f1d9c3 t1 边界：同一 invoke 后无 harness_end → 不派生（窗口不完整）', () => {
    const r = deriveHaltValidationOnlyEligibility([
      settledEv({}),
      haltEv({}), // 无 harness_end
    ]);
    assert(r === null, '缺 harness_end 不派生');
  });

  run('b5f1d9c3 t1 边界：harness_end 在不同 invoke（旧 invoke）→ 不派生', () => {
    const r = deriveHaltValidationOnlyEligibility([
      settledEv({}),
      harnessEndEv({ invoke_id: 'testing-i3' }), // 不同 invoke
      haltEv({}),
    ]);
    assert(r === null, 'harness_end 必须属同一 invoke 才有效');
  });

  run('b5f1d9c3 t1 边界：最新执行事件是 invoke_start 而非 settled（request-only 崩溃）→ 不派生', () => {
    const r = deriveHaltValidationOnlyEligibility([
      settledEv({ invoke_id: 'testing-i3' }),
      harnessEndEv({ invoke_id: 'testing-i3' }),
      { type: 'agent_invoke_start', phase: 'testing', invoke_id: 'testing-i4' },
      haltEv({}),
    ]);
    assert(r === null, '最新执行事件为 invoke_start 不派生（resume 重新 invoke agent，保留候选上下文）');
  });

  run('b5f1d9c3 t1 边界：无 phase_halt 事件 → 不派生', () => {
    const r = deriveHaltValidationOnlyEligibility([
      settledEv({}),
      harnessEndEv({}),
    ]);
    assert(r === null, '无 halt 不派生');
  });

  run('b5f1d9c3 t1 边界：halt phase 无执行事件（0 事件后直接 halt）→ 不派生（缺 settled）', () => {
    const r = deriveHaltValidationOnlyEligibility([
      haltEv({}), // 无任何执行事件
    ]);
    assert(r === null, '无 settled 不派生');
  });

  // 标准执行模式：逐条执行并捕获异常（不可只登记 ok:true——那是假 PASS）
  for (const c of cases) {
    try {
      c.run();
      results.push({ name: c.name, ok: true });
    } catch (err) {
      results.push({ name: c.name, ok: false, error: (err as Error).message });
    }
  }
  return results;
}

if (require.main === module) {
  const results = runAll();
  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    console.log(r.ok ? `PASS ${r.name}` : `FAIL ${r.name}: ${r.error}`);
  }
  process.exit(failed.length > 0 ? 1 : 0);
}