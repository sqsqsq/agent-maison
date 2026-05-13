// ============================================================================
// 统一报告生成器
// ============================================================================
// 功能：
//   1. 生成 script-report.json（脚本 Harness 报告）
//   2. 组装 ai-prompt.md（填充 AI Harness prompt 模板 + 上下文）
//   3. 生成 merged-report.md（合并报告，供人工审查）
//
// 报告输出到 framework/harness/reports/{feature}/{phase}/ 目录。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import {
  Phase,
  CheckResult,
  CheckStatus,
  ScriptReport,
  ReportSummary,
  Severity,
  VisualHandoffResolutionRow,
  HarnessResolvedProfile,
  ScriptReportCompatApplied,
  ScriptReportCompatExpired,
} from './types';
import { applyCompatDowngrade } from '../../compat-loader';
import { fillCompatMessage, SUGGESTION_COMPAT_APPLIED, SUGGESTION_COMPAT_EXPIRED } from '../../compat-messages';

// --------------------------------------------------------------------------
// 报告目录管理
// --------------------------------------------------------------------------

function ensureReportDir(harnessRoot: string, feature: string, phase: Phase): string {
  const dir = path.join(harnessRoot, 'reports', feature, phase);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// --------------------------------------------------------------------------
// 脚本报告生成
// --------------------------------------------------------------------------

export function finalizeChecksForScriptReport(
  checks: CheckResult[],
  phase: Phase,
  feature: string,
  projectRoot: string,
  nowMs: number = Date.now(),
): {
  checks: CheckResult[];
  compat_applied?: ScriptReportCompatApplied;
  compat_expired?: ScriptReportCompatExpired;
} {
  const { results, stats } = applyCompatDowngrade(checks, { feature, phase, projectRoot }, nowMs);
  let compat_applied: ScriptReportCompatApplied | undefined;
  if (stats.appliedIds.length > 0) {
    compat_applied = {
      count: stats.appliedIds.length,
      ids: [...stats.appliedIds],
      suggestion: fillCompatMessage(SUGGESTION_COMPAT_APPLIED, feature, phase),
    };
  }
  let compat_expired: ScriptReportCompatExpired | undefined;
  if (stats.expiredFired) {
    compat_expired = {
      feature,
      suggestion: fillCompatMessage(SUGGESTION_COMPAT_EXPIRED, feature, phase),
    };
  }
  return { checks: results, compat_applied, compat_expired };
}

export function generateScriptReport(
  harnessRoot: string,
  phase: Phase,
  feature: string,
  projectRoot: string,
  checks: CheckResult[],
): ScriptReport {
  const finalized = finalizeChecksForScriptReport(checks, phase, feature, projectRoot);
  const summary = computeSummary(finalized.checks);
  const report: ScriptReport = {
    phase,
    feature,
    timestamp: new Date().toISOString(),
    project_root: projectRoot,
    checks: finalized.checks,
    summary,
  };

  if (finalized.compat_applied) {
    report.compat_applied = finalized.compat_applied;
  }
  if (finalized.compat_expired) {
    report.compat_expired = finalized.compat_expired;
  }

  const dir = ensureReportDir(harnessRoot, feature, phase);
  const reportPath = path.join(dir, 'script-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');

  return report;
}

/**
 * Step 4/5（组装 prompt / 合并报告）阶段若出现未捕获异常，
 * 必须将失败回写到已经落盘的 script-report.json，避免"磁盘 PASS + 控制台崩栈"误导。
 *
 * 行为：
 *   1. 把 err 转成一条 BLOCKER / FAIL 的 CheckResult，追加到 report.checks
 *   2. 重算 summary（verdict 会自动变成 FAIL）
 *   3. 覆盖写回 script-report.json
 *   4. 删除同目录下可能残留的 ai-prompt.md / merged-report.md（避免下游误读）
 */
export function failScriptReportWithFatalError(
  harnessRoot: string,
  report: ScriptReport,
  stage: 'assemble_ai_prompt' | 'generate_merged_report',
  err: Error,
): ScriptReport {
  const fatal: CheckResult = {
    id: `runner_${stage}_failed`,
    category: 'structure',
    description: `Harness runner 在 ${stage} 阶段抛出未捕获异常`,
    severity: 'BLOCKER',
    status: 'FAIL',
    details: `[Harness runner fatal] ${err.message}\n${err.stack ?? ''}`,
  };

  const updated: ScriptReport = {
    ...report,
    checks: [...report.checks, fatal],
    summary: computeSummary([...report.checks, fatal]),
    timestamp: new Date().toISOString(),
    compat_applied: report.compat_applied,
    compat_expired: report.compat_expired,
  };

  const dir = ensureReportDir(harnessRoot, updated.feature, updated.phase);
  fs.writeFileSync(
    path.join(dir, 'script-report.json'),
    JSON.stringify(updated, null, 2),
    'utf-8',
  );

  for (const stale of ['ai-prompt.md', 'merged-report.md']) {
    const p = path.join(dir, stale);
    if (fs.existsSync(p)) {
      try { fs.unlinkSync(p); } catch { /* best-effort */ }
    }
  }

  return updated;
}

// --------------------------------------------------------------------------
// AI Prompt 组装
// --------------------------------------------------------------------------

/**
 * 读取 prompts/{verify-phase}.md 模板，用上下文填充占位符，
 * 将组装好的 prompt 写到 reports/{feature}/{phase}/ai-prompt.md。
 * 返回组装后的完整 prompt 文本。
 */
export function assembleAIPrompt(
  harnessRoot: string,
  phase: Phase,
  feature: string,
  contextFiles: Array<{ label: string; content: string }>,
  scriptReportJson: string,
  specContent: string,
  resolvedProfile?: HarnessResolvedProfile,
  lifecycleHookFragments?: string[],
): string {
  const templatePath = path.join(harnessRoot, 'prompts', `verify-${phase}.md`);
  let template: string;

  if (fs.existsSync(templatePath)) {
    template = fs.readFileSync(templatePath, 'utf-8');
  } else {
    template = buildFallbackTemplate(phase);
  }

  if (resolvedProfile) {
    const overlayPath = path.join(
      resolvedProfile.profileDir,
      'harness',
      'prompts',
      `verify-${phase}.overlay.md`,
    );
    if (fs.existsSync(overlayPath)) {
      const overlay = fs.readFileSync(overlayPath, 'utf-8').trim();
      if (overlay.length > 0) {
        template = `${template.trimEnd()}\n\n---\n\n## Profile Overlay：${resolvedProfile.name}\n\n${overlay}\n`;
      }
    }
  }

  let assembled = template;
  assembled = assembled.replace(/\{spec_content\}/g, specContent);
  assembled = assembled.replace(/\{script_report\}/g, scriptReportJson);
  assembled = assembled.replace(/\{feature_name\}/g, feature);
  assembled = assembled.replace(/\{phase\}/g, phase);
  assembled = assembled.replace(/\{timestamp\}/g, new Date().toISOString());

  const contextSection = contextFiles
    .map(cf => `### ${cf.label}\n\n\`\`\`\n${cf.content}\n\`\`\``)
    .join('\n\n');
  assembled = assembled.replace(/\{context_files\}/g, contextSection);

  if (lifecycleHookFragments && lifecycleHookFragments.length > 0) {
    assembled +=
      '\n\n---\n\n## Lifecycle hooks（实例 / profile / framework）\n\n' +
      lifecycleHookFragments.map((f, i) => `### Hook fragment ${i + 1}\n\n${f}`).join('\n\n');
  }

  const dir = ensureReportDir(harnessRoot, feature, phase);
  const promptPath = path.join(dir, 'ai-prompt.md');
  fs.writeFileSync(promptPath, assembled, 'utf-8');

  return assembled;
}

/** 当 prompt 模板不存在时，生成一个通用回退模板 */
function buildFallbackTemplate(phase: Phase): string {
  return `# ${phase} 阶段语义验证

## 你的角色
你是一个独立的审查员。你的职责是根据 Spec 约束客观评估 ${phase} 阶段的产出是否满足要求。

## 阶段
${phase}

## 功能模块
{feature_name}

## Spec 规约内容

\`\`\`yaml
{spec_content}
\`\`\`

## 脚本 Harness 已通过的检查

\`\`\`json
{script_report}
\`\`\`

## 上下文文件

{context_files}

## 验证任务
请针对 Spec 中所有 semantic_checks 项逐一评估，对每项给出 PASS / FAIL / WARN 判定。

## 输出格式（必须严格遵循）

\`\`\`yaml
verification_result:
  phase: "${phase}"
  feature: "{feature_name}"
  timestamp: "{timestamp}"
  checks:
    - id: <check_id>
      status: PASS | FAIL | WARN
      severity: BLOCKER | MAJOR | MINOR
      details: "具体发现..."
      affected_files: ["path/to/file"]
      suggestion: "修正建议..."
  summary:
    total: N
    pass: N
    fail: N
    warn: N
    verdict: PASS | FAIL
\`\`\`
`;
}

// --------------------------------------------------------------------------
// 合并报告
// --------------------------------------------------------------------------

function collectVisualResolutionRows(scriptReport: ScriptReport): VisualHandoffResolutionRow[] {
  const out: VisualHandoffResolutionRow[] = [];
  for (const check of scriptReport.checks) {
    const rows = check.visual_resolution_rows;
    if (rows && rows.length > 0) out.push(...rows);
  }
  return out;
}

function escapeMdCell(s: string): string {
  return s.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
}

/**
 * 合并脚本报告和 AI 报告（AI 报告可选），输出 merged-report.md
 */
export function generateMergedReport(
  harnessRoot: string,
  phase: Phase,
  feature: string,
  scriptReport: ScriptReport,
  aiReportContent?: string,
): string {
  const lines: string[] = [];

  lines.push(`# ${phase.toUpperCase()} 阶段验证报告 — ${feature}`);
  lines.push('');
  lines.push(`> 生成时间: ${new Date().toISOString()}`);
  lines.push('');

  // 脚本 Harness 摘要
  lines.push('## 一、脚本 Harness 检查结果');
  lines.push('');
  lines.push(`| 指标 | 值 |`);
  lines.push(`|------|-----|`);
  lines.push(`| 总检查项 | ${scriptReport.summary.total} |`);
  lines.push(`| PASS | ${scriptReport.summary.pass} |`);
  lines.push(`| FAIL | ${scriptReport.summary.fail} |`);
  lines.push(`| WARN | ${scriptReport.summary.warn} |`);
  lines.push(`| SKIP | ${scriptReport.summary.skip} |`);
  lines.push(`| BLOCKER 数 | ${scriptReport.summary.blockers} |`);
  lines.push(`| **裁定** | **${scriptReport.summary.verdict}** |`);
  lines.push('');

  // 失败项明细
  const failedChecks = scriptReport.checks.filter(c => c.status === 'FAIL');
  if (failedChecks.length > 0) {
    lines.push('### 失败项明细');
    lines.push('');
    for (const check of failedChecks) {
      lines.push(`#### ${severityBadge(check.severity)} ${check.id}`);
      lines.push('');
      lines.push(`- **描述**: ${check.description}`);
      lines.push(`- **详情**: ${check.details}`);
      if (check.affected_files?.length) {
        lines.push(`- **涉及文件**: ${check.affected_files.join(', ')}`);
      }
      if (check.suggestion) {
        lines.push(`- **建议**: ${check.suggestion}`);
      }
      lines.push('');
    }
  }

  // 警告项
  const warnChecks = scriptReport.checks.filter(c => c.status === 'WARN');
  if (warnChecks.length > 0) {
    lines.push('### 警告项');
    lines.push('');
    for (const check of warnChecks) {
      lines.push(`- ${severityBadge(check.severity)} **${check.id}**: ${check.details}`);
    }
    lines.push('');
  }

  // Visual Handoff：结构化解析与可达性（仅 PRD 且 PRD 声明 handoff 并由脚本写出 visual_resolution_rows）
  if (phase === 'prd') {
    const vRows = collectVisualResolutionRows(scriptReport);
    if (vRows.length > 0) {
      lines.push('### Resolved Visual Sources');
      lines.push('');
      lines.push('| ref_id | declared_path | declared_url | resolution_kind | agent_reachable | resolved_absolute | note |');
      lines.push('|--------|----------------|--------------|-----------------|-----------------|-------------------|------|');
      for (const row of vRows) {
        lines.push(
          '| ' +
            [
              escapeMdCell(row.ref_id),
              escapeMdCell(row.declared_path ?? '—'),
              escapeMdCell(row.declared_url ?? '—'),
              escapeMdCell(row.resolution_kind ?? '—'),
              escapeMdCell(String(row.agent_reachable)),
              escapeMdCell(row.resolved_absolute ?? '—'),
              escapeMdCell(row.note ?? '—'),
            ].join(' | ') +
            ' |',
        );
      }
      lines.push('');
    }
  }

  // AI Harness
  lines.push('## 二、AI Harness 语义验证');
  lines.push('');
  if (aiReportContent) {
    lines.push(aiReportContent);
  } else {
    const dir = ensureReportDir(harnessRoot, feature, phase);
    const promptPath = path.join(dir, 'ai-prompt.md');
    if (fs.existsSync(promptPath)) {
      lines.push(`> AI Harness prompt 已生成，请将以下文件发送给任意 AI 模型执行验证：`);
      lines.push(`> \`${path.relative(process.cwd(), promptPath)}\``);
    } else {
      lines.push('> AI Harness 尚未执行。');
    }
  }
  lines.push('');

  // 最终裁定
  lines.push('## 三、最终裁定');
  lines.push('');
  if (scriptReport.summary.verdict === 'FAIL') {
    lines.push(`**FAIL** — 存在 ${scriptReport.summary.blockers} 个 BLOCKER 级别失败，必须修复后重新验证。`);
  } else {
    lines.push('**PASS** — 脚本 Harness 未发现 BLOCKER 失败。注意：脚本 PASS 不代表阶段闭环完成，仍必须继续执行 verifier 语义验证并填写 completion receipt。');
  }
  lines.push('');

  const report = lines.join('\n');
  const dir = ensureReportDir(harnessRoot, feature, phase);
  fs.writeFileSync(path.join(dir, 'merged-report.md'), report, 'utf-8');

  return report;
}

// --------------------------------------------------------------------------
// 控制台输出
// --------------------------------------------------------------------------

export interface PrintReportOptions {
  failuresOnly?: boolean;
  maxDetailsChars?: number;
}

export function printReportToConsole(report: ScriptReport, options: PrintReportOptions = {}): void {
  const chalk = tryLoadChalk();

  console.log('');
  console.log(`${'='.repeat(60)}`);
  console.log(`  Harness Script Report — ${report.phase}/${report.feature}`);
  console.log(`  ${report.timestamp}`);
  console.log(`${'='.repeat(60)}`);
  console.log('');

  const checksToPrint = options.failuresOnly
    ? report.checks.filter(check => check.status === 'FAIL' || check.status === 'WARN' || (check.status === 'SKIP' && check.severity === 'BLOCKER'))
    : report.checks;

  if (options.failuresOnly) {
    const hidden = report.checks.length - checksToPrint.length;
    console.log(`  Showing FAIL/WARN/BLOCKER-SKIP only (${checksToPrint.length} shown, ${hidden} PASS/SKIP hidden; use --verbose to expand).`);
    console.log('');
  }

  if (checksToPrint.length === 0) {
    console.log('  No FAIL/WARN checks.');
  }

  for (const check of checksToPrint) {
    const badge = statusBadge(check.status, chalk);
    const sev = severityTag(check.severity, chalk);
    console.log(`  ${badge} ${sev} ${check.id}`);
    if (check.status !== 'PASS') {
      console.log(`       ${formatConsoleDetails(check.details, options.maxDetailsChars ?? 4000)}`);
      if (check.affected_files?.length) {
        console.log(`       Files: ${check.affected_files.slice(0, 5).join(', ')}${check.affected_files.length > 5 ? ` (+${check.affected_files.length - 5} more)` : ''}`);
      }
    }
  }

  console.log('');
  console.log(`${'─'.repeat(60)}`);
  console.log(`  Total: ${report.summary.total}  |  PASS: ${report.summary.pass}  |  FAIL: ${report.summary.fail}  |  WARN: ${report.summary.warn}  |  SKIP: ${report.summary.skip}`);
  console.log(`  Blockers: ${report.summary.blockers}`);
  console.log(`  Verdict: ${report.summary.verdict === 'PASS' ? (chalk ? chalk.green('PASS') : 'PASS') : (chalk ? chalk.red('FAIL') : 'FAIL')}`);
  console.log(`${'─'.repeat(60)}`);
  console.log('');
}

function formatConsoleDetails(details: string, maxChars: number): string {
  const normalized = details.replace(/\r/g, '');
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars)}\n       ... details truncated in console; read script-report.json for full content.`;
}

// --------------------------------------------------------------------------
// 辅助方法
// --------------------------------------------------------------------------

function computeSummary(checks: CheckResult[]): ReportSummary {
  const summary: ReportSummary = {
    total: checks.length,
    pass: 0,
    fail: 0,
    warn: 0,
    skip: 0,
    blockers: 0,
    verdict: 'PASS',
  };

  for (const check of checks) {
    switch (check.status) {
      case 'PASS': summary.pass++; break;
      case 'FAIL': summary.fail++; break;
      case 'WARN': summary.warn++; break;
      case 'SKIP': summary.skip++; break;
    }
    if (check.status === 'FAIL' && check.severity === 'BLOCKER') {
      summary.blockers++;
    }
  }

  if (summary.blockers > 0) {
    summary.verdict = 'FAIL';
  }

  return summary;
}

function severityBadge(severity: Severity): string {
  switch (severity) {
    case 'BLOCKER': return '🚫';
    case 'MAJOR': return '⚠️';
    case 'MINOR': return 'ℹ️';
  }
}

function statusBadge(status: CheckStatus, chalk: ChalkLike | null): string {
  if (chalk) {
    switch (status) {
      case 'PASS': return chalk.green('✓ PASS');
      case 'FAIL': return chalk.red('✗ FAIL');
      case 'WARN': return chalk.yellow('⚠ WARN');
      case 'SKIP': return chalk.gray('⊘ SKIP');
    }
  }
  switch (status) {
    case 'PASS': return '✓ PASS';
    case 'FAIL': return '✗ FAIL';
    case 'WARN': return '⚠ WARN';
    case 'SKIP': return '⊘ SKIP';
  }
}

function severityTag(severity: Severity, chalk: ChalkLike | null): string {
  const tag = `[${severity}]`;
  if (chalk) {
    switch (severity) {
      case 'BLOCKER': return chalk.red(tag);
      case 'MAJOR': return chalk.yellow(tag);
      case 'MINOR': return chalk.gray(tag);
    }
  }
  return tag;
}

interface ChalkLike {
  green(s: string): string;
  red(s: string): string;
  yellow(s: string): string;
  gray(s: string): string;
}

function tryLoadChalk(): ChalkLike | null {
  try {
    return require('chalk') as ChalkLike;
  } catch {
    return null;
  }
}
