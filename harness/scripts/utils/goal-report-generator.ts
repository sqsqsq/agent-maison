/**
 * Goal report generator — aggregates per-phase harness summaries into goal-report.{md,json}
 */

import * as fs from 'fs';
import * as path from 'path';
import type { FeaturePhase, GoalRunStatus } from './phase-transition-policy';
import type { PhaseSnapshotFiles } from './goal-phase-snapshot';

export interface MustReviewItem {
  phase: FeaturePhase;
  summary: string;
  assumptions_path: string;
}

export interface GoalReportMarkdownOptions {
  mustReviewItems?: MustReviewItem[];
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
  const lines: string[] = [
    `# Goal Report — ${report.feature}`,
    '',
    `- **Run ID**: ${report.run_id}`,
    `- **Status**: ${report.status}`,
    `- **Generated**: ${report.generated_at}`,
    '',
  ];

  const mustReview = options.mustReviewItems ?? [];
  if (mustReview.length > 0) {
    lines.push(
      '## Must-review（goal-mode 自动确认 · 待人工复核）',
      '',
      '以下项在 headless 下已自动放行，须人工复核后再视为最终确认：',
      '',
    );
    for (const item of mustReview) {
      lines.push(`- **${item.phase}**: ${item.summary}（见 \`${item.assumptions_path}\`）`);
    }
    lines.push('');
  }

  if (report.status !== 'COMPLETED') {
    lines.push(
      '> **注意**：本报告生成 ≠ 所有子进程已退出 / goal 全流程已完成。非 COMPLETED 终态请结合 events.jsonl 判断是否在跑。',
      '',
    );
  }

  lines.push(
    '## Phase outcomes',
    '',
    '| Phase | Verdict | DEFERRED | Reason | Summary |',
    '|-------|---------|----------|--------|---------|',
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
                  : p.halted
                    ? 'halted'
                    : '—');
    const summary = p.summary_path ?? '—';
    lines.push(`| ${p.phase} | ${p.verdict} | ${deferred} | ${reason} | ${summary} |`);
    if (p.interaction_question) {
      lines.push(`| ↳ 待确认 | — | — | ${p.interaction_question.replace(/\|/g, '\\|')} | — |`);
    }
    if (p.agent_warn) {
      lines.push(`| ↳ agent | WARN | — | ${p.agent_warn} | — |`);
    }
    // P0-D（codex P3）：断流信封原文/agent stderr 直进报告——下游无需回读 events.jsonl。
    if (p.api_error_excerpt) {
      lines.push(`| ↳ API 断流信封 | — | — | ${p.api_error_excerpt.replace(/\|/g, '\\|')} | — |`);
    }
    if (p.agent_stderr_excerpt) {
      lines.push(`| ↳ agent stderr | — | — | ${p.agent_stderr_excerpt.replace(/\|/g, '\\|')} | — |`);
    }
  }

  // P0-10a 补强②：await_human_visual_confirm 的机器生成引导渲染进 md（detach 用户看 md 亦撞见）。
  const awaitConfirm = report.phases.filter(
    (p) => p.halt_reason === 'await_human_visual_confirm' && p.halt_guidance,
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
export function collectMustReviewFromAssumptions(
  projectRoot: string,
  feature: string,
  phases: FeaturePhase[],
): MustReviewItem[] {
  const items: MustReviewItem[] = [];
  for (const phase of phases) {
    const assumptionsRel = `doc/features/${feature}/${phase}/headless-assumptions.md`;
    const assumptionsAbs = path.join(projectRoot, assumptionsRel);
    if (!fs.existsSync(assumptionsAbs)) continue;
    const content = fs.readFileSync(assumptionsAbs, 'utf-8');
    for (const rawLine of content.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const isMustReview =
        /\bmust-review:\s*(true|yes|是)\b/i.test(line) ||
        /\bDEFERRED-review\b/i.test(line);
      if (!isMustReview) continue;
      items.push({
        phase,
        summary: line.replace(/^[-*]\s*/, '').replace(/\|/g, '\\|'),
        assumptions_path: assumptionsRel,
      });
    }
  }
  return items;
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
    generateGoalReportMarkdown(report, { mustReviewItems }),
    'utf-8',
  );
  return { jsonPath, mdPath };
}
