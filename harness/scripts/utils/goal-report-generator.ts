/**
 * Goal report generator — aggregates per-phase harness summaries into goal-report.{md,json}
 */

import * as fs from 'fs';
import * as path from 'path';
import type { FeaturePhase, GoalRunStatus } from './phase-transition-policy';
import type { PhaseSnapshotFiles } from './goal-phase-snapshot';
import { relFeatureFile } from '../../config';
import { collectAutoDecisions } from './headless-assumptions';

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
}

/** t9：WARN 摘要置顶类——视觉缺席/覆盖不足/证据缺失沉底即事故形状，固定优先展示 */
const PINNED_WARN_ID_RE = /visual|coverage|evidence|p0_|fidelity|flow_contract|attestation/i;

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
  /** P0-9b：await_human_visual_confirm 等设计内求人 halt 的逐步操作指引（给真人读） */
  halt_guidance?: string;
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

export interface GoalReport {
  schema_version: '1.0';
  run_id: string;
  feature: string;
  status: GoalRunStatus;
  phases: GoalPhaseOutcome[];
  deferred_phases: FeaturePhase[];
  generated_at: string;
}

export function generateGoalReportJson(
  runId: string,
  feature: string,
  status: GoalRunStatus,
  phases: GoalPhaseOutcome[],
): GoalReport {
  const deferred_phases = phases.filter((p) => p.deferred).map((p) => p.phase);
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
    '| Phase | Verdict | DEFERRED | WARNs | Reason | Summary |',
    '|-------|---------|----------|-------|--------|---------|',
  );

  for (const p of report.phases) {
    const deferred = p.deferred ? 'YES（未完成·待外部条件）' : '—';
    const reason =
      p.deferred_reason ??
      (p.halt_reason === 'headless_interaction_required'
        ? '需人工输入（headless）'
        : p.halt_reason === 'no_progress_guard'
          ? '确定性闸门无进展'
          : p.halt_reason === 'transient_api_error_exhausted'
            ? 'API 连接反复中断（非框架/需求/代码问题）——退避重试已达上限，请检查网络/代理稳定性或增大 max_transient_api_retries'
            : p.halt_reason === 'agent_no_output'
              ? 'agent 空产出（疑似 spawn/权限/弱模型，非 API 断流）——请人工核查 agent-output.log 与 CLI 环境'
              : p.halt_reason === 'no_progress_agent_timeout'
                ? '连续超时且产物零进展——请人工核查（预算见 phase_timeout_seconds）'
                : p.halt_reason === 'await_human_visual_confirm'
                  ? '待真人逐屏过目确认（设计内求人时刻，见下方引导）'
                  : p.halt_reason === 'await_human_p0_skip'
                    ? 'P0 用例被跳过待真人裁决（设计内求人时刻，见下方引导）'
                    : p.halted
                      ? 'halted'
                      : '—');
    const summary = p.summary_path ?? '—';
    const warns = warnDigest.get(String(p.phase)) ?? '—';
    lines.push(`| ${p.phase} | ${p.verdict} | ${deferred} | ${warns} | ${reason} | ${summary} |`);
    if (p.interaction_question) {
      lines.push(`| ↳ 待确认 | — | — | — | ${p.interaction_question.replace(/\|/g, '\\|')} | — |`);
    }
    if (p.agent_warn) {
      lines.push(`| ↳ agent | WARN | — | — | ${p.agent_warn} | — |`);
    }
    // P0-D（codex P3）：断流信封原文/agent stderr 直进报告——下游无需回读 events.jsonl。
    if (p.api_error_excerpt) {
      lines.push(`| ↳ API 断流信封 | — | — | — | ${p.api_error_excerpt.replace(/\|/g, '\\|')} | — |`);
    }
    if (p.agent_stderr_excerpt) {
      lines.push(`| ↳ agent stderr | — | — | — | ${p.agent_stderr_excerpt.replace(/\|/g, '\\|')} | — |`);
    }
  }

  // P0-10a 补强②：await_human_visual_confirm 的机器生成引导渲染进 md（detach 用户看 md 亦撞见）。
  const awaitConfirm = report.phases.filter(
    (p) =>
      (p.halt_reason === 'await_human_visual_confirm' || p.halt_reason === 'await_human_p0_skip') &&
      p.halt_guidance,
  );
  if (awaitConfirm.length > 0) {
    lines.push('', '## 需真人逐屏确认（await_human_visual_confirm）', '');
    for (const p of awaitConfirm) {
      lines.push(p.halt_guidance!.trim(), '');
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
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n', 'utf-8');
  const mustReviewItems = collectMustReviewFromAssumptions(
    projectRoot,
    report.feature,
    report.phases.map((p) => p.phase),
  );
  fs.writeFileSync(
    mdPath,
    generateGoalReportMarkdown(report, {
      mustReviewItems,
      workflowChain: opts?.workflowChain,
      warnDigest: buildWarnDigest(projectRoot, report),
    }),
    'utf-8',
  );
  return { jsonPath, mdPath };
}
