// ============================================================================
// phase-completion-probe.unit.test.ts — 完成观测判据（openspec ... t4）
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  collectCompletionEvidence,
  createCompletionProbe,
  decideSkipAgentInvoke,
  isCompletionEvidenceComplete,
  isEvidenceFromCurrentInvocation,
  type CompletionEvidenceState,
} from '../../scripts/utils/phase-completion-probe';
import {
  DEFAULT_COMPLETION_GRACE_MS,
  DEFAULT_COMPLETION_POLL_MS,
} from '../../scripts/utils/agent-invoke';
import {
  isReceiptFreshForInvokeStart,
  resolvePhaseHarnessVerdict,
} from '../../scripts/utils/goal-runner-phase';
import type { UnitCaseResult } from '../run-unit';

const tmpRoots: string[] = [];

function run(results: UnitCaseResult[], name: string, fn: () => void): void {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, error: (err as Error).stack ?? (err as Error).message });
  }
}
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}
function assertEq<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const FEATURE = 'bc-openCard';
const PHASE = 'ut';

/**
 * R6/S11：四条件齐备的夹具——回执按 **schema 2.0 必填字段**构造（不再是"含关键词即可"），
 * summary 带身份 + 闭环两态。
 */
/** 形态合法的 commit sha（探针会校验 7–40 位 hex，随手编的字符串挡在门外） */
const RECEIPT_SHA = 'abc123def4567890abc123def4567890abc12345';
const FULL_RECEIPT = [
  '# 阶段完成回执',
  'receipt_schema: "2.0"',
  `feature: "${FEATURE}"`,
  `phase: "${PHASE}"`,
  'claimed_completion_at: "2026-07-28T10:00:00+08:00"',
  `claimed_completion_commit_sha: "${RECEIPT_SHA}"`,
  '',
].join('\n');
const FULL_SUMMARY = JSON.stringify({
  phase: PHASE,
  feature: FEATURE,
  verdict: 'PASS',
  receipt_status: 'passed',
  closure_status: 'closed',
  // run identity 锚：schema 2.0 的回执必须与它一致（探针与 check-receipt 同源判据）
  source_commit_sha: RECEIPT_SHA,
});

function hostWith(opts: { receipt?: string; summary?: string }): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'completion-probe-'));
  tmpRoots.push(root);
  fs.writeFileSync(
    path.join(root, 'framework.config.json'),
    JSON.stringify({
      schema_version: '1.1',
      project_name: 'T',
      paths: { features_dir: 'doc/features', reports_dir_pattern: 'doc/features/<feature>/<phase>/reports' },
    }),
    'utf-8',
  );
  const phaseDir = path.join(root, 'doc', 'features', FEATURE, PHASE);
  fs.mkdirSync(path.join(phaseDir, 'reports'), { recursive: true });
  if (opts.receipt !== undefined) {
    fs.writeFileSync(path.join(phaseDir, 'phase-completion-receipt.md'), opts.receipt, 'utf-8');
  }
  if (opts.summary !== undefined) {
    fs.writeFileSync(path.join(phaseDir, 'reports', 'summary.json'), opts.summary, 'utf-8');
  }
  return root;
}

/** 可编程证据序列：模拟 invoke 期间证据从无到有 */
function scriptedCollect(seq: CompletionEvidenceState[]): () => CompletionEvidenceState {
  let i = 0;
  return () => seq[Math.min(i++, seq.length - 1)];
}

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];
  try {

  run(results, 'R6：**四条件**齐备才算完成——占位文本/裸 JSON 不得触发收口', () => {
    const full = collectCompletionEvidence(
      hostWith({ receipt: FULL_RECEIPT, summary: FULL_SUMMARY }),
      FEATURE, PHASE,
    );
    assert(isCompletionEvidenceComplete(full), JSON.stringify(full));
    assertEq(full.verdict, 'PASS', 'verdict 记录');

    // **核心反例**：任意占位文本 + 任意 JSON —— 旧实现会误判完成并杀掉在干活的 agent
    const placeholder = collectCompletionEvidence(
      hostWith({ receipt: 'TODO\n', summary: '{"verdict":"PASS"}' }),
      FEATURE, PHASE,
    );
    assert(!isCompletionEvidenceComplete(placeholder), `占位文本不得算完成：${JSON.stringify(placeholder)}`);
    assert(placeholder.missing!.includes('receipt'), '须指出回执不合格');
    assert(placeholder.missing!.includes('closure_status'), '须指出闭环未关');

    // S11：**未填写的模板占位**（`<feature-name>` 之类）不得算完成
    const unfilled = collectCompletionEvidence(
      hostWith({
        receipt: FULL_RECEIPT.replace(`"${FEATURE}"`, '"<feature-name>"'),
        summary: FULL_SUMMARY,
      }),
      FEATURE, PHASE,
    );
    assert(!isCompletionEvidenceComplete(unfilled), '模板占位未填写不得算完成');

    // S11：回执**身份不符**（别的 phase 的回执）不得算完成
    const wrongPhaseReceipt = collectCompletionEvidence(
      hostWith({ receipt: FULL_RECEIPT.replace(`"${PHASE}"`, '"coding"'), summary: FULL_SUMMARY }),
      FEATURE, PHASE,
    );
    assert(!isCompletionEvidenceComplete(wrongPhaseReceipt), '回执 phase 不符不得算完成');

    // S11：summary **缺身份字段**不得当作通过（此前"字段缺失也算吻合"）
    const noIdentity = collectCompletionEvidence(
      hostWith({ receipt: FULL_RECEIPT, summary: '{"verdict":"PASS","receipt_status":"passed","closure_status":"closed"}' }),
      FEATURE, PHASE,
    );
    assert(!isCompletionEvidenceComplete(noIdentity), 'summary 缺 phase/feature 不得算完成');

    // 闭环未关（回执与 summary 都在，但 closure_status 不是 closed）
    const notClosed = collectCompletionEvidence(
      hostWith({
        receipt: FULL_RECEIPT,
        summary: FULL_SUMMARY.replace('"closed"', '"open"'),
      }),
      FEATURE, PHASE,
    );
    assert(!isCompletionEvidenceComplete(notClosed), '闭环未关不得算完成');

    // 回执校验未过
    const receiptNotPassed = collectCompletionEvidence(
      hostWith({ receipt: FULL_RECEIPT, summary: FULL_SUMMARY.replace('"passed"', '"failed"') }),
      FEATURE, PHASE,
    );
    assert(!isCompletionEvidenceComplete(receiptNotPassed), 'receipt_status 未过不得算完成');

    // 身份不符（读到别的 feature 的 summary）
    const wrongIdentity = collectCompletionEvidence(
      hostWith({ receipt: FULL_RECEIPT, summary: FULL_SUMMARY.replace(FEATURE, 'other-feature') }),
      FEATURE, PHASE,
    );
    assert(!isCompletionEvidenceComplete(wrongIdentity), '身份不符不得算完成');

    const noReceipt = collectCompletionEvidence(hostWith({ summary: FULL_SUMMARY }), FEATURE, PHASE);
    assert(!isCompletionEvidenceComplete(noReceipt), '缺回执不算完成');

    const emptyReceipt = collectCompletionEvidence(
      hostWith({ receipt: '', summary: FULL_SUMMARY }), FEATURE, PHASE,
    );
    assert(!isCompletionEvidenceComplete(emptyReceipt), '空回执不算完成');

    const noSummary = collectCompletionEvidence(hostWith({ receipt: FULL_RECEIPT }), FEATURE, PHASE);
    assert(!isCompletionEvidenceComplete(noSummary), '缺 summary 不算完成');
  });

  run(results, '半写入 JSON → 本轮未完成（不得误判，下轮重试）', () => {
    const root = hostWith({ receipt: FULL_RECEIPT, summary: '{"verdict":"PA' });
    const s = collectCompletionEvidence(root, FEATURE, PHASE);
    assertEq(s.summary, false, '半写入 JSON 须判未完成');
    assert(!isCompletionEvidenceComplete(s), '半写入不得算完成');

    // 补完后即完成（证明只是"这一轮"不算，不是永久拒绝）
    fs.writeFileSync(
      path.join(root, 'doc', 'features', FEATURE, PHASE, 'reports', 'summary.json'),
      FULL_SUMMARY, 'utf-8',
    );
    assert(isCompletionEvidenceComplete(collectCompletionEvidence(root, FEATURE, PHASE)), '补完后应完成');
  });

  run(results, '完成 ≠ 通过：verdict=FAIL 也算证据完整（质量由 gate 判，不由观测判）', () => {
    const s = collectCompletionEvidence(
      hostWith({ receipt: FULL_RECEIPT, summary: FULL_SUMMARY.replace('"PASS"', '"FAIL"') }),
      FEATURE, PHASE,
    );
    assert(isCompletionEvidenceComplete(s), 'FAIL 也是"跑完了"');
    assertEq(s.verdict, 'FAIL', 'verdict 如实记录');
  });

  run(results, '三轮 P1：**字段值须成形**——schema/sha/时间戳任一不合法即不算完成', () => {
    // 字段都在、都非占位，但值是随手编的 —— 此前这样就能触发提前 tree-kill
    const cases: Array<{ name: string; receipt: string }> = [
      { name: 'schema 不是 2.0', receipt: FULL_RECEIPT.replace('"2.0"', '"1.0"') },
      { name: 'sha 不是 hex', receipt: FULL_RECEIPT.replace(RECEIPT_SHA, 'not-a-sha-at-all') },
      { name: 'sha 太短', receipt: FULL_RECEIPT.replace(RECEIPT_SHA, 'abc') },
      {
        name: '时间戳不可解析',
        receipt: FULL_RECEIPT.replace('2026-07-28T10:00:00+08:00', 'soon'),
      },
    ];
    for (const c of cases) {
      const s = collectCompletionEvidence(
        hostWith({ receipt: c.receipt, summary: FULL_SUMMARY }),
        FEATURE, PHASE,
      );
      assert(!s.receipt, `${c.name}：不得判为回执完整`);
      assert(!isCompletionEvidenceComplete(s), `${c.name}：不得触发收口`);
    }
  });

  run(results, '三轮 P1：回执 sha 必须与 summary 的 run identity 锚一致', () => {
    // sha 形态合法但与 summary 对不上 —— 伪造回执骗收口的最后一条路
    const mismatched = FULL_SUMMARY.replace(
      RECEIPT_SHA,
      'fedcba9876543210fedcba9876543210fedcba98',
    );
    const s = collectCompletionEvidence(
      hostWith({ receipt: FULL_RECEIPT, summary: mismatched }),
      FEATURE, PHASE,
    );
    assert(!s.summary, 'sha 与 summary 锚不一致时不得判为 summary 就绪');
    assert(!isCompletionEvidenceComplete(s), '不得触发收口');

    // summary 缺锚同样不放行（schema 2.0 的产物必然带锚）
    const anchorless = JSON.stringify({
      phase: PHASE, feature: FEATURE, verdict: 'PASS',
      receipt_status: 'passed', closure_status: 'closed',
    });
    const s2 = collectCompletionEvidence(
      hostWith({ receipt: FULL_RECEIPT, summary: anchorless }),
      FEATURE, PHASE,
    );
    assert(!isCompletionEvidenceComplete(s2), 'summary 缺 run identity 锚不得触发收口');
  });

  run(results, '新鲜度：基线已完整 → 探针恒 false（不得启动后立刻杀）', () => {
    const { probe, baselineComplete } = createCompletionProbe({
      projectRoot: '/x', feature: FEATURE, phase: PHASE,
      collect: scriptedCollect([{ receipt: true, summary: true, receiptStatus: true, closure: true }]),
    });
    assertEq(baselineComplete, true, '基线应判为已完整');
    assertEq(probe(), false, '基线已完整时不得命中');
    assertEq(probe(), false, '重复轮询仍不得命中');
  });

  run(results, '新鲜度：本次调用内 不完整→完整 才命中，且只命中一次', () => {
    const { probe, baselineComplete } = createCompletionProbe({
      projectRoot: '/x', feature: FEATURE, phase: PHASE,
      collect: scriptedCollect([
        { receipt: false, summary: false, receiptStatus: false, closure: false }, // 基线
        { receipt: true, summary: false, receiptStatus: false, closure: false },  // 中途：只有回执
        { receipt: true, summary: true, receiptStatus: true, closure: true },   // 跃迁完成
        { receipt: true, summary: true, receiptStatus: true, closure: true },
      ]),
    });
    assertEq(baselineComplete, false, '基线不完整');
    assertEq(probe(), false, '部分证据不得命中');
    assertEq(probe(), true, '跃迁完成须命中');
    assertEq(probe(), false, '命中后锁存，不得重复触发 kill');
  });

  run(results, 'R7：跳过 agent 须过**新鲜度判据**——回退/重试/跨 run 一律不跳', () => {
    const base = {
      baselineComplete: true,
      retries: 0,
      pendingHandoffCount: 0,
      evidenceRunId: 'run-A',
      currentRunId: 'run-A',
    };
    assertEq(decideSkipAgentInvoke(base).skip, true, '四条都满足才可跳过');

    // ① 证据不全 → 不跳
    assertEq(decideSkipAgentInvoke({ ...base, baselineComplete: false }).skip, false, '证据不全不跳');

    // ② **重试轮**不跳——上一轮判了失败，失败轮的证据不代表本轮不用干活
    const retry = decideSkipAgentInvoke({ ...base, retries: 1 });
    assertEq(retry.skip, false, '重试轮必须真跑');
    assert(retry.reason.includes('上一轮判失败'), retry.reason);

    // ③ **有回退交接待修**不跳——这正是"跳过会破坏 backtrack"的那条
    const handoff = decideSkipAgentInvoke({ ...base, pendingHandoffCount: 2 });
    assertEq(handoff.skip, false, '有待修项必须真跑');
    assert(handoff.reason.includes('回退交接'), handoff.reason);

    // ④ 跨 run 遗留不跳
    assertEq(
      decideSkipAgentInvoke({ ...base, evidenceRunId: 'run-OLD' }).skip,
      false,
      '其它 run 的证据不代表本轮已完成',
    );
    assertEq(
      decideSkipAgentInvoke({ ...base, evidenceRunId: null }).skip,
      false,
      '证据缺 run 身份 → 不跳（fail-safe）',
    );
  });

  run(results, '有界参数取定值：poll 2s / grace 5s（防实现漂移成无限等待）', () => {
    assertEq(DEFAULT_COMPLETION_POLL_MS, 2_000, 'poll 间隔');
    assertEq(DEFAULT_COMPLETION_GRACE_MS, 5_000, 'grace 上限');
  });

  run(results, 'grace 不得越过绝对 deadline（收口不能反把 run 拖过预算）', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', 'scripts', 'utils', 'agent-invoke.ts'),
      'utf-8',
    );
    assert(
      /Math\.min\(graceBudget,\s*untilDeadline\)/.test(src),
      'grace 必须与 deadline 取 min',
    );
    assert(/Math\.max\(0,/.test(src), 'grace 不得为负');
  });

  run(results, '收口不算 agent_failed：completionObserved 时非零退出码不判失败', () => {
    const base = {
      dryRun: false,
      agentExitCode: 1, // tree-kill 必然非零
      harnessExitCode: 0,
      summaryBeforeMtime: 1,
      summaryAfterMtime: 2,
      summaryVerdict: 'PASS' as const,
      receiptRequired: true,
      closureStatus: 'closed',
      receiptStatus: 'passed',
    };
    const observed = resolvePhaseHarnessVerdict({ ...base, completionObserved: true });
    assertEq(observed.agent_failed, false, '完成收口不得判 agent_failed');
    assertEq(observed.verdict, 'PASS', '结论仍由 harness summary 决定');

    // 反向：同样非零退出但**不是**完成收口 → 仍如实判 agent_failed
    const plain = resolvePhaseHarnessVerdict({ ...base });
    assertEq(plain.agent_failed, true, '非收口的非零退出仍须判失败');
  });

  run(results, 'observer 与失败标记互斥：completion 路径不置 timed_out/silent_killed', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', 'scripts', 'utils', 'agent-invoke.ts'),
      'utf-8',
    );
    // killTree('completion') 分支不得落入 timedOut/silentKilled 赋值
    assert(
      /if \(reason === 'timeout'\) timedOut = true;/.test(src) &&
        /if \(reason === 'silent'\) silentKilled = true;/.test(src),
      '既有两标记赋值须保持按 reason 精确匹配',
    );
    assert(
      !/reason === 'completion'\) (timedOut|silentKilled)/.test(src),
      'completion 不得置任何失败标记',
    );
    assert(/completion_observed: completionObserved/.test(src), '结果须回传 completion_observed');
  });

  run(results, '三轮 P1：completion 命中须**同时**停掉 hard timeout 与 silent watchdog', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', 'scripts', 'utils', 'agent-invoke.ts'),
      'utf-8',
    );
    // 此前只 clearTimeout(timeoutTimer)：5s grace 内 silent watchdog 仍会开枪，
    // 最终同时得到 completion_observed 与 silent_killed，又被归入失败分类。
    const hit = /completionObserved = true;[\s\S]{0,900}?const graceBudget/.exec(src);
    assert(hit !== null, '应能定位 completion 命中分支');
    assert(/clearTimeout\(timeoutTimer\)/.test(hit![0]), 'completion 命中须取消 hard timeout');
    assert(/clearInterval\(silentTimer\)/.test(hit![0]), 'completion 命中须停掉 silent watchdog');
    // 双保险：silent 回调自身也要认 completionObserved（clear 与回调可能已排队）
    assert(
      /setInterval\(\(\) => \{[\s\S]{0,400}?if \(completionObserved\) return;[\s\S]{0,300}?killTree\('silent'\)/.test(src),
      'silent 回调须在 completionObserved 时直接返回',
    );
  });

  // ==========================================================================
  // f9c2e6b4 t1 —— 完成证据必须属于**本次 invocation**
  // 立项事故 run 20260803T103413Z-3f72a8：coding attempt 2/3 各只活 35.3 秒，
  // 因为上一轮回执被原样复写（mtime 新、claimed_completion_at 仍是旧的 19:40），
  // observer 判"不完整→完整"跃迁成立即 tree-kill，90 秒烧光重试预算。
  // ==========================================================================

  /** 把四条件证据落盘到既有 host（模拟 agent 在 invoke 期间写出回执 + summary） */
  function materializeEvidence(root: string, receipt: string, runId?: string): void {
    const phaseDir = path.join(root, 'doc', 'features', FEATURE, PHASE);
    fs.writeFileSync(path.join(phaseDir, 'phase-completion-receipt.md'), receipt, 'utf-8');
    const summary = runId
      ? JSON.stringify({ ...JSON.parse(FULL_SUMMARY), run_id: runId })
      : FULL_SUMMARY;
    fs.writeFileSync(path.join(phaseDir, 'reports', 'summary.json'), summary, 'utf-8');
  }
  const withAttempt = (receipt: string, attempt: string): string =>
    receipt.replace('claimed_completion_at:', `claimed_attempt_id: "${attempt}"\nclaimed_completion_at:`);
  const withClaimedAt = (receipt: string, iso: string): string =>
    receipt.replace(/claimed_completion_at: "[^"]*"/, `claimed_completion_at: "${iso}"`);

  run(results, 't1 立项事故回归：原样复写的旧回执（claimed_completion_at 早于本次调用）不得命中', () => {
    const root = hostWith({});
    const probe = createCompletionProbe({
      projectRoot: root,
      feature: FEATURE,
      phase: PHASE,
      invocation: { runId: 'run-A', attemptId: 'i5', startedAtMs: Date.now() },
    });
    assert(!probe.baselineComplete, '前置：基线应不完整（否则测的不是跃迁）');
    materializeEvidence(root, FULL_RECEIPT); // claimed_completion_at = 2026-07-28，早于 now
    assertEq(probe.probe(), false, '旧声明被原样复写 → 不得判本轮完成');
  });

  run(results, 't1 正例：本轮 attempt 写出的回执须命中（不得把 observer 判死）', () => {
    const root = hostWith({});
    const probe = createCompletionProbe({
      projectRoot: root,
      feature: FEATURE,
      phase: PHASE,
      invocation: { runId: 'run-A', attemptId: 'i5', startedAtMs: Date.now() },
    });
    // goal 模式的生产形态：check-receipt 会强制 agent 填 claimed_attempt_id
    materializeEvidence(root, withAttempt(FULL_RECEIPT, 'i5'), 'run-A');
    assertEq(probe.probe(), true, '本轮 attempt 的完成声明应命中');
  });

  run(results, 't1 goal 模式不得回退时间戳：新鲜时间戳但缺 attempt 字段 → 不命中', () => {
    // codex 复核订正：原实现缺字段就退到 claimed_completion_at，等于 goal 下没有绑定——
    // agent 自报未来时间仍能骗停本轮。goal 模式（invocation 带 attemptId）一律硬绑。
    const root = hostWith({});
    const startedAtMs = Date.now();
    const probe = createCompletionProbe({
      projectRoot: root,
      feature: FEATURE,
      phase: PHASE,
      invocation: { runId: 'run-A', attemptId: 'i5', startedAtMs },
    });
    materializeEvidence(
      root,
      withClaimedAt(FULL_RECEIPT, new Date(startedAtMs + 600_000).toISOString()),
      'run-A',
    );
    assertEq(probe.probe(), false, 'goal 模式缺 claimed_attempt_id 一律不命中');
  });

  run(results, 't1 goal 模式 run 身份缺失即 fail-closed', () => {
    const s: CompletionEvidenceState = {
      receipt: true, summary: true, receiptStatus: true, closure: true,
      attemptId: 'i5', // run_id 缺失
    };
    assertEq(
      isEvidenceFromCurrentInvocation(s, { runId: 'run-A', attemptId: 'i5', startedAtMs: Date.now() }),
      false,
      'goal 模式下证据缺 run_id 不得放行',
    );
  });

  run(results, 't1 显式绑定：claimed_attempt_id 不符当前 attempt → 不命中；相符 → 命中', () => {
    const stale = hostWith({});
    const staleProbe = createCompletionProbe({
      projectRoot: stale,
      feature: FEATURE,
      phase: PHASE,
      invocation: { runId: 'run-A', attemptId: 'i5', startedAtMs: Date.now() },
    });
    // 关键：即便时间戳是新的，attempt 不符也不得命中（显式字段优先于 legacy 时间判据）
    materializeEvidence(
      stale,
      withAttempt(withClaimedAt(FULL_RECEIPT, new Date(Date.now() + 60_000).toISOString()), 'i3'),
    );
    assertEq(staleProbe.probe(), false, 'attempt=i3 的回执不得算作 i5 的完成');

    const fresh = hostWith({});
    const freshProbe = createCompletionProbe({
      projectRoot: fresh,
      feature: FEATURE,
      phase: PHASE,
      invocation: { runId: 'run-A', attemptId: 'i5', startedAtMs: Date.now() },
    });
    materializeEvidence(fresh, withAttempt(FULL_RECEIPT, 'i5'), 'run-A');
    assertEq(freshProbe.probe(), true, 'attempt 相符即命中（此时不看时间戳）');
  });

  run(results, 't1 legacy 分支与 isReceiptFreshForInvokeStart 等价（两处判据不得漂移）', () => {
    // 同一份"旧声明"素材，喂给两个实现应得同一结论；漂移会让 gate 与 observer 各说各话。
    // **夹具必须带 `---` frontmatter**：isReceiptFreshForInvokeStart 只解析 frontmatter 块，
    // 无分隔符时宽容返回 true（生产回执恒带分隔符，实证宿主
    // doc/features/bc-openCard/coding/phase-completion-receipt.md）。用无分隔符的夹具比，
    // 比的是解析面差异而不是判据差异。
    const root = hostWith({});
    const startedAtMs = Date.now();
    materializeEvidence(root, `---\n${FULL_RECEIPT}---\n`); // 旧 claimed_completion_at
    const state = collectCompletionEvidence(root, FEATURE, PHASE);
    // legacy 分支只在**非 goal**（无 attemptId）下生效，故此处不传 attemptId
    const pure = isEvidenceFromCurrentInvocation(state, { startedAtMs });
    const onDisk = isReceiptFreshForInvokeStart(root, FEATURE, PHASE as never, startedAtMs);
    assertEq(pure, false, 'legacy 分支应判旧');
    assertEq(pure, onDisk, '纯函数判据须与文件级判据同判（严格大于，语义对齐）');
  });

  run(results, 't1 run 身份不符一律不命中（别的 run 的遗留证据）', () => {
    const s: CompletionEvidenceState = {
      receipt: true, summary: true, receiptStatus: true, closure: true,
      runId: 'run-OTHER', claimedCompletionAtMs: Date.now() + 60_000,
    };
    assertEq(
      isEvidenceFromCurrentInvocation(s, { runId: 'run-A', attemptId: 'i5', startedAtMs: Date.now() }),
      false,
      '跨 run 遗留证据不得算本次完成',
    );
  });

  run(results, 't1 护栏：身份绑定不得改变 decideSkipAgentInvoke 的既有正例', () => {
    // codex 三轮订正：调用前的跳过判据**不得**要求匹配"尚未开始的新 attempt"，
    // 否则「证据须属当前 attempt」与「调用前已完整则跳过」会变成互相不可达。
    assertEq(
      decideSkipAgentInvoke({
        baselineComplete: true, retries: 0, pendingHandoffCount: 0,
        evidenceRunId: 'run-A', currentRunId: 'run-A',
      }).skip,
      true,
      '同 run、非重试、无待修、证据齐全 → 仍须可跳过',
    );
    assertEq(
      decideSkipAgentInvoke({
        baselineComplete: true, retries: 1, pendingHandoffCount: 0,
        evidenceRunId: 'run-A', currentRunId: 'run-A',
      }).skip,
      false,
      '重试轮仍须真跑（立项事故里 attempt 2/3 正是靠这条正确地没被跳过）',
    );
  });

  return results;
  } finally {
    for (const r of tmpRoots) {
      try { fs.rmSync(r, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  }
}
