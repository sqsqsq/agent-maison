/**
 * Goal report generator — aggregates per-phase harness summaries into goal-report.{md,json}
 */

import * as fs from 'fs';
import * as path from 'path';
import type { FeaturePhase, GoalRunStatus } from './phase-transition-policy';
import type { PhaseSnapshotFiles } from './goal-phase-snapshot';

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
  snapshot_files?: PhaseSnapshotFiles;
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

export function generateGoalReportMarkdown(report: GoalReport): string {
  const lines: string[] = [
    `# Goal Report — ${report.feature}`,
    '',
    `- **Run ID**: ${report.run_id}`,
    `- **Status**: ${report.status}`,
    `- **Generated**: ${report.generated_at}`,
    '',
  ];

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
    const reason = p.deferred_reason ?? (p.halted ? 'halted' : '—');
    const summary = p.summary_path ?? '—';
    lines.push(`| ${p.phase} | ${p.verdict} | ${deferred} | ${reason} | ${summary} |`);
    if (p.agent_warn) {
      lines.push(`| ↳ agent | WARN | — | ${p.agent_warn} | — |`);
    }
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

  return lines.join('\n') + '\n';
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
  fs.writeFileSync(mdPath, generateGoalReportMarkdown(report), 'utf-8');
  return { jsonPath, mdPath };
}
