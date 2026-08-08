/**
 * Goal report generator — aggregates per-phase harness summaries into goal-report.{md,json}
 */

import { loadFidelityIntentSsot } from './fidelity-shared';
import * as fs from 'fs';
import * as path from 'path';
import type { FeaturePhase, GoalRunStatus } from './phase-transition-policy';
import type { PhaseSnapshotFiles } from './goal-phase-snapshot';
import { relFeatureFile } from '../../config';
import { collectAutoDecisions } from './headless-assumptions';
import type { Disposition, WaitKind } from './adjudication';

export interface MustReviewItem {
  phase: FeaturePhase;
  summary: string;
  assumptions_path: string;
  /** 非待复核条目（must_review=false）也进汇总，仅标记不同 */
  must_review?: boolean;
}

export interface GoalReportMarkdownOptions {
  mustReviewItems?: MustReviewItem[];
  /** workflow 解析出的完整链——本 run 仅覆盖切片时在状态行显式注明（t8 语义收窄） */
  workflowChain?: string[];
  /** phase → WARN 摘要（t9：warn_count + 置顶类 WARN id）；writeGoalReport 构建 */
  warnDigest?: Map<string, string>;
  /** P1-6（plan 7c4f2e9b）：events.jsonl 回放——no_progress/closure 族 halt 渲染四轴时间线 */
  events?: Array<Record<string, unknown>>;
  /** P1#7（post-impl review）：operator 专用门禁指引（不进 agent 回喂，在报告渲染给人） */
  operatorNotes?: Array<{ phase: string; blockerId: string; note: string }>;
}

/** t9：WARN 摘要置顶类——视觉缺席/覆盖不足/证据缺失沉底即事故形状，固定优先展示 */
const PINNED_WARN_ID_RE = /visual|coverage|evidence|p0_|fidelity|flow_contract|attestation/i;

/** P1#7（post-impl review）：从各 phase summary 收集 blocker.operator_note——受众分级的
 * operator 半边：不进 agent 回喂（extractPriorFailureContext 已排除），在此渲染给人看。 */
export function collectOperatorNotes(
  projectRoot: string,
  report: GoalReport,
): Array<{ phase: string; blockerId: string; note: string }> {
  const out: Array<{ phase: string; blockerId: string; note: string }> = [];
  for (const p of report.phases) {
    if (!p.summary_path) continue;
    try {
      const summaryAbs = path.isAbsolute(p.summary_path) ? p.summary_path : path.join(projectRoot, p.summary_path);
      if (!fs.existsSync(summaryAbs)) continue;
      const summary = JSON.parse(fs.readFileSync(summaryAbs, 'utf-8')) as {
        blockers?: Array<{ id?: string; operator_note?: string }>;
      };
      for (const b of summary.blockers ?? []) {
        if (typeof b.operator_note === 'string' && b.operator_note.trim()) {
          out.push({ phase: String(p.phase), blockerId: b.id ?? '(unnamed)', note: b.operator_note.trim() });
        }
      }
    } catch { /* summary 读不出 → 无 note */ }
  }
  return out;
}

export function buildWarnDigest(projectRoot: string, report: GoalReport): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of report.phases) {
    if (!p.summary_path) continue;
    try {
      const summaryAbs = path.isAbsolute(p.summary_path) ? p.summary_path : path.join(projectRoot, p.summary_path);
      if (!fs.existsSync(summaryAbs)) continue;
      const summary = JSON.parse(fs.readFileSync(summaryAbs, 'utf-8')) as {
        warn_count?: number;
        script_report?: string;
      };
      const warnCount = summary.warn_count ?? 0;
      if (warnCount === 0) {
        out.set(String(p.phase), '0');
        continue;
      }
      let ids: string[] = [];
      if (summary.script_report) {
        const srAbs = path.isAbsolute(summary.script_report)
          ? summary.script_report
          : path.join(projectRoot, summary.script_report);
        if (fs.existsSync(srAbs)) {
          const sr = JSON.parse(fs.readFileSync(srAbs, 'utf-8')) as { results?: Array<{ id?: string; status?: string }> };
          ids = (sr.results ?? [])
            .filter((r) => r.status === 'WARN' && typeof r.id === 'string')
            .map((r) => r.id!) as string[];
        }
      }
      const pinned = ids.filter((i) => PINNED_WARN_ID_RE.test(i));
      const rest = ids.filter((i) => !PINNED_WARN_ID_RE.test(i));
      const top = [...pinned, ...rest].slice(0, 3);
      out.set(String(p.phase), `${warnCount}${top.length > 0 ? `（${top.join('、')}${ids.length > 3 ? '…' : ''}）` : ''}`);
    } catch {
      /* summary 不可读则不展示 digest */
    }
  }
  return out;
}

export interface GoalPhaseOutcome {
  phase: FeaturePhase;
  verdict: string;
  deferred?: boolean;
  deferred_reason?: string;
  halted?: boolean;
  summary_path?: string;
  report_dir?: string;
  retries?: number;
  agent_exit_code?: number;
  agent_timed_out?: boolean;
  agent_silent_killed?: boolean;
  agent_warn?: string;
  halt_reason?: string;
  /**
   * plan d6b1a8e3 t5④：**权威**状态/next-action 轴——由统一投影出口给出。
   * 报告的状态与下一步一律读本字段；`halt_reason` 只作诊断散文的键与原文透传，
   * **不得**用来推导状态或 next action（那就是第二张分类表）。
   */
  run_disposition?: Disposition;
  run_wait_kind?: WaitKind;
  /** P0-9b：await_human_visual_confirm 等设计内求人 halt 的逐步操作指引（给真人读） */
  halt_guidance?: string;
  /** P0-5（plan d9b4f7e2）：framework_integrity_block 的多值 subtype（全 blocker 收集去重）。 */
  integrity_subtypes?: string[];
  interaction_question?: string;
  /** Set when closure gate blocked advance (open receipt / timeout). */
  advance_blocked?: boolean;
  snapshot_files?: PhaseSnapshotFiles;
  // P0-B/P0-D（codex P3）诊断保真：只读 goal-report 的下游也能看到真因原文。
  failure_kind_classified?: string;
  /** API 断流哨兵命中的 CLI 错误信封行（transient_api_error 时）。 */
  api_error_excerpt?: string;
  agent_duration_ms?: number;
  /** agent 非零退出时的 stderr 摘要（binary 不可 spawn 的 preflight 诊断在此）。 */
  agent_stderr_excerpt?: string;
}

export interface GoalReportFidelityRouting {
  inferred: string;
  selected: string;
  effective: string;
  strictness: string;
  asset_acquisition_mode: string;
  clamped: boolean;
  source: string;
  decision_id: string;
}

export interface GoalReport {
  schema_version: '1.0';
  run_id: string;
  feature: string;
  /** `INTERRUPTED`＝未处理异常的优雅收口（e5d8a2c4 T1①）——events 层异常终态在
   *  报告里如实透传，与正常终态并列显示，**不是** GoalRunStatus 的新成员。 */
  status: GoalRunStatus | 'INTERRUPTED';
  phases: GoalPhaseOutcome[];
  deferred_phases: FeaturePhase[];
  generated_at: string;
  /** plan f6b2d9a4：三轴路由投影（writeGoalReport 从 fidelity-intent SSOT 派生；非 UI/legacy 缺省无） */
  fidelity_routing?: GoalReportFidelityRouting;
}

// ============================================================================
// P1-6（plan 7c4f2e9b）：attempt 四正交轴时间线（codex P1#9：i2 同属「超时」与「PASS 被拦」
// 两轴，互斥计数 3+2+1=6≠5 必然对不上）。轴：agent termination（timeout/exit0/error）×
// harness verdict（PASS/FAIL/unavailable）× transition（advanced/advance_blocked/halted/
// retried）× artifact delta（changed/unchanged/restored/unknown）。逐 attempt 渲染，
// 汇总不伪装互斥计数——no_progress_* 族 halt 的死模板由本时间线替换主叙事。
// ============================================================================

interface AttemptAxisEventLike {
  type?: string;
  phase?: string;
  invoke_id?: string;
  exit_code?: number;
  timed_out?: boolean;
  verdict?: string;
  action?: string;
  advance_blocked?: boolean;
  halt_reason?: string;
  artifact_delta?: string;
}

export function buildAttemptAxesTimeline(events: AttemptAxisEventLike[], phase: string): string[] {
  const rows: string[] = [];
  const invokes = events.filter(e => e.type === 'agent_invoke_end' && e.phase === phase);
  const verdicts = events.filter(e => e.type === 'phase_verdict' && e.phase === phase);
  const restores = new Set(
    events.filter(e => e.type === 'pass_snapshot_restored' && e.phase === phase).map(e => e.invoke_id),
  );
  let timeouts = 0;
  let contentFails = 0;
  let passBlocked = 0;
  for (const inv of invokes) {
    const v = verdicts.find(x => x.invoke_id === inv.invoke_id);
    const termination = inv.timed_out === true ? 'timeout' : inv.exit_code === 0 ? 'exit0' : 'error';
    const harnessVerdict = v?.verdict ?? 'unavailable';
    const transition = v
      ? (v.action === 'advance' ? 'advanced' : v.advance_blocked ? 'advance_blocked' : v.action === 'halt' ? 'halted' : 'retried')
      : 'unavailable';
    const delta = restores.has(inv.invoke_id) ? 'restored' : (v?.artifact_delta ?? 'unknown');
    rows.push(`- ${inv.invoke_id ?? '?'}: ${termination} × ${harnessVerdict} × ${transition} × ${delta}`);
    if (termination === 'timeout') timeouts++;
    if (harnessVerdict === 'FAIL' && termination !== 'timeout') contentFails++;
    if (harnessVerdict === 'PASS' && v?.advance_blocked) passBlocked++;
  }
  if (rows.length > 0) {
    rows.push(
      `- 汇总（轴可重叠，非互斥计数）：${invokes.length} attempts；其中 ${timeouts} 次超时、` +
      `${contentFails} 次非超时内容 FAIL、${passBlocked} 次 harness PASS 被闭环拦截。`,
    );
  }
  return rows;
}

export function generateGoalReportJson(
  runId: string,
  feature: string,
  status: GoalRunStatus | 'INTERRUPTED',
  phases: GoalPhaseOutcome[],
): GoalReport {
  const deferred_phases = phases.filter((p) => p.deferred).map((p) => p.phase);
  // t5④（codex 订正）：报告**只消费**投影，绝不重算。
  // 此前这里调 withRunDisposition 用**中性上下文**按 halt_reason 重新 decide——
  // 那是第二个裁决入口：runner 拿着真实结构事实（回退预算/截断链/重复指纹）算出
  // TERMINAL，报告却会重算成 RECOVERY_PENDING，「运行器说无法恢复、报告说正在恢复」。
  // 真实投影由生产端在 halt 那一刻写进事件，并由 runner 回填进 outcome（见
  // goal-runner enrichOutcomesWithProjection）。此处原样透传。
  return {
    schema_version: '1.0',
    run_id: runId,
    feature,
    status,
    phases,
    deferred_phases,
    generated_at: new Date().toISOString(),
  };
}


// ---------------------------------------------------------------------------
// plan d6b1a8e3 t5④：报告侧「权威轴 vs 诊断散文」分离
// ---------------------------------------------------------------------------
// 此前这里是一棵 19 层嵌套的 `halt_reason === …` 三元树，把两件事揉在一列：
// ①这个 phase 现在算什么状态、下一步该谁动手（**控制语义**）；②给人读的一句话解释。
// ① 必须来自统一投影 `run_disposition`（否则就是下游第二张分类表）；② 是散文，
// 允许按 halt_reason 查表、也允许缺项——缺了只是话说得笼统，不影响任何判定。
// ---------------------------------------------------------------------------

/** 权威轴的人读标签（**只由 disposition 决定**，与具体事故原因无关）。 */
const DISPOSITION_LABEL: Readonly<Record<string, string>> = {
  RESUME_READY: '可续跑',
  RECOVERY_PENDING: '框架自动恢复中',
  TERMINAL: '终局·本 run 无法继续',
};

export function renderPhaseDispositionCell(p: {
  run_disposition?: string; run_wait_kind?: string; halted?: boolean;
}): string {
  const d = p.run_disposition;
  if (!d) return p.halted ? 'halted' : '—';
  if (d === 'WAITING') {
    return p.run_wait_kind === 'external' ? '等待外部条件（环境/设备/工具链）' : '等待人工处置';
  }
  return DISPOSITION_LABEL[d] ?? d;
}

/**
 * 诊断散文（**非权威**，仅供人读；缺项完全可以）。取值优先级：
 *   ① 生产端已生成的 halt_guidance 首行（最贴近现场，随生产端演进自动更新）
 *   ② 本表按 halt_reason 查到的固定说明
 *   ③ 通用兜底 `halted (<halt_reason>)`
 */
const HALT_DIAGNOSTIC_PROSE: Readonly<Record<string, string>> = {
  headless_interaction_required:
    '需人工输入（headless）',
  no_progress_guard:
    '确定性闸门无进展',
  transient_api_error_exhausted:
    'API 连接反复中断（非框架/需求/代码问题）——退避重试已达上限，请检查网络/代理稳定性或增大 max_transient_api_retries',
  agent_no_output:
    'agent 空产出（疑似 spawn/权限/弱模型，非 API 断流）——请人工核查 agent-output.log 与 CLI 环境',
  no_progress_agent_timeout:
    '连续超时且产物零进展——请人工核查（预算见 phase_timeout_seconds）',
  closure_timeout:
    'closure-only attempt（PASS 已冻结仅补关环）超时——不回内容重试；人工核查 receipt/closure 后 --resume',
  pass_snapshot_unavailable:
    'PASS 快照不可复用（head 损坏/快照失败/预期快照消失）——丢弃缓存，重跑责任阶段；若存储不可写则等待 external probe',
  closure_probe_error:
    'receipt 探针自身执行失败（framework/toolchain 坏，非产物问题）——不派 agent 修 receipt，人工修复环境/回灌源仓后 --resume',
  closure_state_invariant:
    'lite track 不产生 receipt 却 advance_blocked——runner 状态机不变量违例（framework bug），请回灌源仓核查',
  await_operator_toolchain:
    '环境/工具链阻塞（重试 agent 修不了环境）——operator 修复工具链后 --resume，详见 blocker details',
  await_human_gate_deferral:
    '仅剩需真人签字/确认项（设计内求人时刻，内容重试无意义）——逐条完成人签后 --resume；语义同 AWAITING_HUMAN_REVIEW',
  pass_snapshot_restore_refused:
    'PASS 冻结缓存不可复用——保留宿主现状，丢弃缓存并重跑责任阶段，经完整门禁重新建立快照',
  pass_snapshot_journal_unverifiable:
    'PASS 快照失效记录不可复用——按事件重放并丢弃缓存，重跑责任阶段，不读取旧 journal 恢复字节',
  await_human_visual_confirm:
    '待真人逐屏过目确认（设计内求人时刻，见下方引导）',
  framework_integrity_block:
    'framework 完整性拦截——须真人处置（allowlist 具名审批/还原/重铺/回灌，见下方引导），agent 不得改动 framework 发布件',
  framework_bug:
    '门禁脚本自身异常（framework 缺陷，非产物问题）——须回灌源仓修复，见下方引导',
  agent_timeout_repeated:
    '连续超时（升档后仍超时）——预算/需求规模/adapter 环境三选一排查，见下方引导',
  budget_wall_clock:
    'wall 总预算耗尽（deadline 制硬截断）',
  await_human_capability_gap:
    '工具链能力缺口（invoke 前 preflight 拦截，未烧 agent 轮次）——按 HARNESS_PREFLIGHT 双出口处置：修环境或确认停止；修好后 --resume 重检放行',
};

const SPLIT_LINES = /\r?\n/;
const PIPE = /\|/g;
const PIPE_ESC = '\\|';

export function renderPhaseDiagnosticProse(p: {
  halt_reason?: string; halt_guidance?: string; halted?: boolean; integrity_subtypes?: string[];
}): string {
  const guidanceHead = p.halt_guidance
    ?.split(SPLIT_LINES)
    .map((l) => l.trim())
    .find(Boolean);
  // 表格单元格内需转义竖线，否则一行 guidance 会把 Markdown 表撑破
  if (guidanceHead) return guidanceHead.replace(PIPE, PIPE_ESC);
  const reason = p.halt_reason ?? '';
  const prose = HALT_DIAGNOSTIC_PROSE[reason];
  if (prose) {
    return reason === 'framework_integrity_block' && p.integrity_subtypes?.length
      ? `${prose}（${p.integrity_subtypes.join(' + ')}）`
      : prose;
  }
  return p.halted ? `halted (${reason || 'unknown'})` : '—';
}


/**
 * plan d6b1a8e3 t5③：**lineage 断裂展示**。
 * 上游 a5f9c3e2 只负责写 `lineage_discontinuity` / `lineage_reset_committed` 事件并
 * 禁止连续性主张；把它讲给人听是报告的事。
 * 铁律：结论只能声称「新 lineage 已全链验证」，**不得**出现「历史连续性得以保持」。
 * 无断裂事件时返回空数组——不给未 reset 的 run 平白加一节。
 */
export function renderLineageDiscontinuitySection(
  events: ReadonlyArray<Record<string, unknown>>,
  /**
   * 本 run 的终态（`report.status`）。**必须由调用方传入，不能从 events 里找 run_end**
   * ——生产顺序是 writeGoalReport 先于 emit(run_end)，报告生成时事件流里永远还没有
   * 本次终态，靠扫事件会让**每一个成功 run 都被写成「尚不能声称已全链验证」**。
   * 传 status 而不是重排落盘顺序：重排会造出「run_end 已落、报告却说失败」的反向不一致。
   */
  runStatus?: string,
): string[] {
  const broken = events.filter((e) => e.type === 'lineage_discontinuity');
  if (broken.length === 0) return [];
  const committed = events.filter((e) => e.type === 'lineage_reset_committed');
  const lines: string[] = ['## Vision lineage', '', '> **历史连续性已撤销**（本 run 显式放弃旧 lineage 并重建）。', ''];
  for (const b of broken) {
    const oldHead = typeof b.old_head_sha256 === 'string' ? b.old_head_sha256 : '(absent)';
    const gen = b.old_generation ?? '(n/a)';
    lines.push(`- 断裂原因：${String(b.reason ?? '(未记录)')}`);
    lines.push(`- 旧锚：head=\`${oldHead}\` · 世代 ${String(gen)}`);
  }
  for (const c of committed) {
    lines.push(`- 新 lineage：head=\`${String(c.new_head_sha256 ?? '(pending)')}\` · 世代 ${String(c.new_generation ?? '(pending)')}`);
  }
  // codex 订正：此前只要见到 discontinuity 就宣称「新 lineage 已全链验证」——
  // reset 中途失败、或后续阶段 HALTED 时那就是**假话**。三个事实按证据**递进**：
  //   ①有 discontinuity            → 只能说「历史连续性已撤销」
  //   ②有 lineage_reset_committed  → 才能加一句「新 lineage 已建立」
  //   ③run 真的走完（CHAIN_SLICE_COMPLETED/COMPLETED）→ 才能说「已全链验证」
  const chainCompleted =
    runStatus === 'CHAIN_SLICE_COMPLETED' || runStatus === 'COMPLETED';
  lines.push('', '结论口径（按已有证据逐级给出，不越级）：');
  lines.push('- 历史连续性**已撤销**——旧 lineage 的判定不因本次重建而延续，也不因本次重建而被洗白（断裂已如实记账）。');
  if (committed.length > 0) {
    lines.push('- 新 lineage **已建立**（reset 事务已提交，旧场外锚已清理）。');
  } else {
    lines.push('- 新 lineage **尚未建立**：reset 事务未提交（中途中断）——旧锚备份仍在，下次启动会先回滚再重做。');
  }
  if (committed.length > 0 && chainCompleted) {
    lines.push('- 新 lineage **已全链验证**（本 run 走完整链并取得完成终态）。');
  } else {
    lines.push('- **尚不能声称「已全链验证」**：本 run 未取得完成终态，新 lineage 的验证不完整。');
  }
  lines.push('');
  return lines;
}

export function generateGoalReportMarkdown(
  report: GoalReport,
  options: GoalReportMarkdownOptions = {},
): string {
  const executedPhases = report.phases.map((p) => String(p.phase));
  const workflowChain = options.workflowChain ?? [];
  const isSlice =
    workflowChain.length > 0 &&
    (executedPhases.length < workflowChain.length ||
      executedPhases.some((p, i) => p !== workflowChain[i]));
  const mustReview = options.mustReviewItems ?? [];
  const pendingCount = mustReview.filter((i) => i.must_review !== false).length;

  // t8 状态语义收窄：状态行自带切片范围与待复核计数——"两行 PASS 被读成需求完成"
  // 的事故形状在此显式拆穿；feature 级完成只认 verify-feature-completion。
  const statusSuffixParts: string[] = [];
  if (isSlice) {
    statusSuffixParts.push(
      `本 run 仅覆盖 ${executedPhases[0]}→${executedPhases[executedPhases.length - 1]}，` +
        `完整链=${workflowChain.join('→')}；feature 级完成状态以 verify-feature-completion 为准`,
    );
  }
  if (pendingCount > 0) {
    statusSuffixParts.push(`含 ${pendingCount} 项 goal-mode 自动决议待人工复核`);
  }
  const statusLine =
    `- **Status**: ${report.status}` +
    (statusSuffixParts.length > 0 ? `（${statusSuffixParts.join('；')}）` : '');

  const lines: string[] = [
    `# Goal Report — ${report.feature}`,
    '',
    `- **Run ID**: ${report.run_id}`,
    statusLine,
    `- **Generated**: ${report.generated_at}`,
    '',
  ];

  // plan f6b2d9a4 P2：三轴路由投影（与 goal-report.json 同一 SSOT 派生，头部固定渲染）
  if (report.fidelity_routing) {
    const fr = report.fidelity_routing;
    lines.push(
      `- **保真路由**（SSOT 派生）：inferred=${fr.inferred} → selected=${fr.selected} → effective=${fr.effective}` +
      `${fr.clamped ? '（能力钳制）' : ''} · 严格度=${fr.strictness} · 素材=${fr.asset_acquisition_mode} · source=${fr.source}`,
      '',
    );
  }

  if (mustReview.length > 0) {
    lines.push(
      '## 自动决议汇总（goal-mode 自动确认 · 待人工复核）',
      '',
      `headless 下共 ${mustReview.length} 项自动决议（其中 ${pendingCount} 项待人工复核）。`,
      '复核前不得视为最终确认；账本记录不构成任何降低硬门禁的授权：',
      '',
    );
    const byPhase = new Map<string, MustReviewItem[]>();
    for (const item of mustReview) {
      const list = byPhase.get(String(item.phase)) ?? [];
      list.push(item);
      byPhase.set(String(item.phase), list);
    }
    for (const [phase, items] of byPhase) {
      const shown = items.slice(0, 10);
      for (const item of shown) {
        const tag = item.must_review === false ? '' : ' **[待复核]**';
        lines.push(`- **${phase}**:${tag} ${item.summary}（见 \`${item.assumptions_path}\`）`);
      }
      if (items.length > shown.length) {
        lines.push(`- **${phase}**: …另有 ${items.length - shown.length} 项，见 \`${items[0].assumptions_path}\``);
      }
    }
    lines.push('');
  }

  const CLEAN_TERMINAL = new Set<string>(['COMPLETED', 'CHAIN_SLICE_COMPLETED', 'AWAITING_HUMAN_REVIEW']);
  if (!CLEAN_TERMINAL.has(String(report.status))) {
    lines.push(
      '> **注意**：本报告生成 ≠ 所有子进程已退出 / goal 全流程已完成。非终局成功态请结合 events.jsonl 判断是否在跑。',
      '',
    );
  }

  const warnDigest = options.warnDigest ?? new Map<string, string>();
  lines.push(
    '## Phase outcomes',
    '',
    '| Phase | Verdict | DEFERRED | WARNs | Disposition | Reason | Summary |',
    '|-------|---------|----------|-------|-------------|--------|---------|',
  );

  for (const p of report.phases) {
    const deferred = p.deferred ? 'YES（未完成·待外部条件）' : '—';
    // t5④：**权威轴**（状态/next action）只来自 run_disposition；
    // halt_reason 仅作诊断散文的键与原文透传。等价性：固定 disposition 后替换
    // halt_reason，Disposition 列必须逐字不变（散文列可变，它不参与控制）。
    const disposition = renderPhaseDispositionCell(p);
    const reason = p.deferred_reason ?? renderPhaseDiagnosticProse(p);
    const summary = p.summary_path ?? '—';
    const warns = warnDigest.get(String(p.phase)) ?? '—';
    lines.push(`| ${p.phase} | ${p.verdict} | ${deferred} | ${warns} | ${disposition} | ${reason} | ${summary} |`);
    if (p.interaction_question) {
      lines.push(`| ↳ 待确认 | — | — | — | — | ${p.interaction_question.replace(/\|/g, '\\|')} | — |`);
    }
    if (p.agent_warn) {
      lines.push(`| ↳ agent | WARN | — | — | — | ${p.agent_warn} | — |`);
    }
    // P0-D（codex P3）：断流信封原文/agent stderr 直进报告——下游无需回读 events.jsonl。
    if (p.api_error_excerpt) {
      lines.push(`| ↳ API 断流信封 | — | — | — | — | ${p.api_error_excerpt.replace(/\|/g, '\\|')} | — |`);
    }
    if (p.agent_stderr_excerpt) {
      lines.push(`| ↳ agent stderr | — | — | — | — | ${p.agent_stderr_excerpt.replace(/\|/g, '\\|')} | — |`);
    }
    // P2#9（post-impl review）：显式超时预算过小 advisory 入报告（仅 console 会在 detach 后蒸发）
    if (options.events?.length) {
      const advisories = new Set(
        options.events
          .filter(e => e.type === 'timeout_advisory' && e.phase === String(p.phase) && typeof e.detail === 'string')
          .map(e => e.detail as string),
      );
      for (const a of advisories) {
        lines.push(`| ↳ 预算提示 | — | — | — | — | ${a.replace(/\|/g, '\\|')} | — |`);
      }
    }
  }

  // t5③：lineage 断裂展示（上游只写事件+禁连续性主张，讲给人听归报告）
  if (options.events?.length) {
    const section = renderLineageDiscontinuitySection(options.events, report.status);
    if (section.length > 0) lines.push('', ...section);
  }

  // P1-6（plan 7c4f2e9b）：no_progress/超时族 halt 附四轴 attempt 时间线——事故文案
  // 「连续超时且产物零进展」双分句失实（3/5 超时、产物一直在变），死模板降为兜底一行，
  // 主叙事交给逐 attempt 四轴（termination × verdict × transition × delta）。
  if (options.events?.length) {
    // t5④（codex 裁决）：**不再按 halt_reason 正则筛选**——那是又一处按事故原因分叉的
    // 控制逻辑，且新增 halt 家族必然漏配。改为对所有 halted phase 一律尝试生成，
    // 有数据才展示（时间线本身是证据渲染，没数据自然不出节）。
    const axedPhases = report.phases.filter((p) => p.halted);
    for (const p of axedPhases) {
      const rows = buildAttemptAxesTimeline(options.events as AttemptAxisEventLike[], String(p.phase));
      if (rows.length > 0) {
        lines.push('', `## Attempt 时间线（${p.phase} · 四轴：termination × verdict × transition × delta）`, '', ...rows);
      }
    }
  }

  // P1#7（post-impl review）：operator_note 渲染——受众分级若只做「不给 agent」半边、
  // operator 也看不到，等于信息蒸发。
  if (options.operatorNotes?.length) {
    lines.push('', '## Operator 参考（门禁内部指引，勿向 agent 转述）', '');
    for (const n of options.operatorNotes) {
      lines.push(`- **${n.phase} · ${n.blockerId}**：${n.note.replace(/\|/g, '\\|')}`);
    }
  }

  // P0-10a 补强②（rev：cursor 复审采纳改为 reason 无关）：凡带 halt_guidance 的 halt
  // 一律渲染进 md——detach 用户只看 md，framework_integrity_block/framework_bug/
  // agent_timeout_repeated 的补救文案不渲染等于没写。
  const guidedHalts = report.phases.filter((p) => p.halt_guidance);
  if (guidedHalts.length > 0) {
    lines.push('', '## 需人工处置（halt 引导）', '');
    for (const p of guidedHalts) {
      lines.push(`### ${p.phase} · ${p.halt_reason ?? 'halted'}`, '', p.halt_guidance!.trim(), '');
    }
  }

  const needsReview = report.phases.filter((p) => p.interaction_question);
  if (needsReview.length > 0) {
    lines.push('', '## 需人工介入（headless 无法继续）', '');
    for (const p of needsReview) {
      lines.push(`- **${p.phase}**: ${p.interaction_question}`);
    }
    lines.push(
      '',
      '请人工确认后 `--resume` 续跑；或补全 `user-confirmation-ux.md` §9 覆盖该闸门。',
    );
  }

  if (report.deferred_phases.length > 0) {
    lines.push('', '## DEFERRED 说明', '');
    lines.push(
      '以下阶段因外部阻塞未闭环，**不得**视为已完成：' + report.deferred_phases.join(', '),
    );
  }

  if (report.status === 'DEFERRED' || report.status === 'PARTIAL') {
    lines.push('', '> 总状态非 COMPLETED：存在 DEFERRED 或未完成阶段。');
  }

  lines.push('', 'Progress snapshot: progress.md');

  return lines.join('\n') + '\n';
}

/** Parse headless-assumptions.md for DEFERRED-review / must-review entries (§9.3). */
/**
 * goal-fakepass-hardening t1 重写：SSOT=headless-assumptions.jsonl（schema 解析），
 * legacy markdown 兼容读取（表格行保守全量计入待复核）。旧实现的行内
 * `must-review: 是` 正则与 agent 实写的 markdown 表格错配 → 0 匹配 → 整节静默不渲染
 * （bc-openCard 洞⑤）——事故双表格式已固化为 headless-assumptions 单测 fixture。
 */
export function collectMustReviewFromAssumptions(
  projectRoot: string,
  feature: string,
  phases: FeaturePhase[],
): MustReviewItem[] {
  return collectAutoDecisions(projectRoot, feature, phases.map(String)).map((d) => ({
    phase: d.phase as FeaturePhase,
    summary: `${d.summary}${d.source === 'legacy_md' ? '（legacy md）' : ''}`.replace(/\|/g, '\\|'),
    assumptions_path: relFeatureFile(
      projectRoot,
      feature,
      `${d.phase}/headless-assumptions.${d.source === 'jsonl' ? 'jsonl' : 'md'}`,
    ),
    must_review: d.must_review,
  }));
}

export function loadGoalReportJson(projectRoot: string, reportDir: string): GoalReport | null {
  const jsonPath = path.join(projectRoot, reportDir, 'goal-report.json');
  if (!fs.existsSync(jsonPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as GoalReport;
  } catch {
    return null;
  }
}

export function writeGoalReport(
  projectRoot: string,
  reportDir: string,
  report: GoalReport,
  opts?: { workflowChain?: string[] },
): { jsonPath: string; mdPath: string } {
  const base = path.join(projectRoot, reportDir);
  fs.mkdirSync(base, { recursive: true });
  const jsonPath = path.join(base, 'goal-report.json');
  const mdPath = path.join(base, 'goal-report.md');
  // plan f6b2d9a4：三轴路由投影——从 fidelity-intent.json 单一 SSOT 派生（报告不自算，
  // 防 intent/report/summary 三处结论漂移）；SSOT 缺失（非 UI/legacy）不注入。
  try {
    const routingSsot = loadFidelityIntentSsot(projectRoot, report.feature);
    if (routingSsot) {
      report.fidelity_routing = {
        inferred: routingSsot.inferred_fidelity,
        selected: routingSsot.selected_fidelity,
        effective: routingSsot.effective_fidelity,
        strictness: routingSsot.acceptance_strictness,
        asset_acquisition_mode: routingSsot.asset_acquisition_mode,
        clamped: routingSsot.clamped,
        source: routingSsot.decision.source,
        decision_id: routingSsot.decision.decision_id,
      };
    }
  } catch { /* 投影失败不阻断报告 */ }
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n', 'utf-8');
  const mustReviewItems = collectMustReviewFromAssumptions(
    projectRoot,
    report.feature,
    report.phases.map((p) => p.phase),
  );
  // P1-6：events.jsonl 回放供四轴时间线（读取失败降级为空——报告永不因时间线炸）
  let axesEvents: Array<Record<string, unknown>> = [];
  try {
    const eventsPath = path.join(base, 'events.jsonl');
    if (fs.existsSync(eventsPath)) {
      axesEvents = fs
        .readFileSync(eventsPath, 'utf-8')
        .split('\n')
        .filter(Boolean)
        .map(l => { try { return JSON.parse(l) as Record<string, unknown>; } catch { return null; } })
        .filter((x): x is Record<string, unknown> => x !== null);
    }
  } catch { /* ignore */ }
  fs.writeFileSync(
    mdPath,
    generateGoalReportMarkdown(report, {
      mustReviewItems,
      workflowChain: opts?.workflowChain,
      warnDigest: buildWarnDigest(projectRoot, report),
      events: axesEvents,
      operatorNotes: collectOperatorNotes(projectRoot, report),
    }),
    'utf-8',
  );
  return { jsonPath, mdPath };
}
