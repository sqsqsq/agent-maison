// ============================================================================
// 统一报告生成器
// ============================================================================
// 功能：
//   1. 生成 script-report.json（脚本 Harness 报告）
//   2. 组装 ai-prompt.md（填充 AI Harness prompt 模板 + 上下文）
//   3. 生成 merged-report.md（合并报告，供人工审查）
//
// 报告目录由 config.featurePhaseReportsDir() 解析（默认可走 doc/features/.../reports）。
// ============================================================================

import type { ImageInputMode } from './multimodal-probe';
import { formatReadImageEvidenceInstructions } from './read-image-evidence';
import * as fs from 'fs';
import * as path from 'path';

import { featurePhaseReportsDir, relFeaturesDir } from '../../config';
import {
  Phase,
  CheckResult,
  CheckStatus,
  ScriptReport,
  ReportSummary,
  Severity,
  Verdict,
  VisualHandoffResolutionRow,
  HarnessResolvedProfile,
  ScriptReportCompatApplied,
  ScriptReportCompatExpired,
  ContextFileEntry,
} from './types';
import { applyCompatDowngrade } from '../../compat-loader';
import { fillCompatMessage, SUGGESTION_COMPAT_APPLIED, SUGGESTION_COMPAT_EXPIRED } from '../../compat-messages';
import { collectBlockedCapabilityFacts } from './capability-resolution';
import type { CapabilityResolutionReport } from './capability-resolution';

// --------------------------------------------------------------------------
// 报告目录管理
// --------------------------------------------------------------------------

function ensureReportDir(projectRoot: string, feature: string, phase: Phase, frameworkRoot?: string): string {
  const dir = featurePhaseReportsDir(projectRoot, feature, phase, frameworkRoot);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// --------------------------------------------------------------------------
// 脚本报告生成
// --------------------------------------------------------------------------

/**
 * t1a①（plan e6a3c9f4）：suggestion 规范化——BLOCKER 级 FAIL 缺 suggestion 时补统一 fallback。
 * 在 finalizeChecksForScriptReport（ScriptReport 落盘前的唯一上游）应用，
 * 使 script-report.json / summary.json / merged-report / console --failures-only 四出口一致；
 * 只改渲染面会漏 summary-blockers 透传与控制台出口（codex round3 坐实）。
 */
export function resolveEffectiveSuggestion(check: CheckResult, phase: Phase): string | undefined {
  if (check.suggestion && check.suggestion.trim().length > 0) return check.suggestion;
  if (check.severity !== 'BLOCKER' || check.status !== 'FAIL') return check.suggestion;
  // P1-7（plan 7c4f2e9b）：agent 通道只给产物级动作——旧文案「检索 id=… 查看判定实现」
  // 把弱模型引进 framework 源码逆向（事故 i5：135 次工具调用 62 Bash+33 Grep 全在读门禁
  // 实现、写 debug 脚本进 framework/harness/，0 次产物修复）。源码定位指引移 operator_note
  // （goal-report 渲染，不进重试回喂）。
  const origin = check.source ?? `check-${phase}.ts`;
  if (!check.operator_note) {
    check.operator_note =
      `（operator 参考）判定实现：framework/harness/scripts/ 或对应 profile harness 的 ${origin}，` +
      `检索 id="${check.id}"；各阶段门禁速查见 docs/operations/harness-runbook.md §5。`;
  }
  return (
    `（自动指引）按 details 与 affected_files 修产物；` +
    `修复路径不明时如实 halt 上报，不要为绕过门禁读改 framework 实现。`
  );
}

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
  const { results: downgraded, stats } = applyCompatDowngrade(checks, { feature, phase, projectRoot }, nowMs);
  // t1a/t1d（plan e6a3c9f4）：非 PASS 结果统一补 source 回退与 suggestion fallback——
  // 在 ScriptReport 落盘前完成，下游（summary/merged/console）零各自兜底。
  const results = downgraded.map(c => {
    if (c.status === 'PASS') return c;
    const withSource = c.source ? c : { ...c, source: `check-${phase}.ts` };
    const effective = resolveEffectiveSuggestion(withSource, phase);
    return effective === withSource.suggestion ? withSource : { ...withSource, suggestion: effective };
  });
  let compat_applied: ScriptReportCompatApplied | undefined;
  if (stats.appliedIds.length > 0) {
    compat_applied = {
      count: stats.appliedIds.length,
      ids: [...stats.appliedIds],
      suggestion: fillCompatMessage(SUGGESTION_COMPAT_APPLIED, projectRoot, feature, phase),
    };
  }
  let compat_expired: ScriptReportCompatExpired | undefined;
  if (stats.expiredFired) {
    compat_expired = {
      feature,
      suggestion: fillCompatMessage(SUGGESTION_COMPAT_EXPIRED, projectRoot, feature, phase),
    };
  }
  return { checks: results, compat_applied, compat_expired };
}

export function generateScriptReport(
  _harnessRoot: string,
  phase: Phase,
  feature: string,
  projectRoot: string,
  checks: CheckResult[],
  frameworkRoot?: string,
  capabilityReport?: CapabilityResolutionReport,
): ScriptReport {
  void _harnessRoot;
  void frameworkRoot;
  const finalized = finalizeChecksForScriptReport(checks, phase, feature, projectRoot);
  const summary = computeSummary(finalized.checks);
  const report: ScriptReport = {
    phase,
    feature,
    timestamp: new Date().toISOString(),
    project_root: projectRoot,
    assurance: capabilityReport?.assurance ?? 'not_applicable',
    capability_resolutions: capabilityReport?.capabilities ?? [],
    capability_resolution_contract_fingerprint: capabilityReport?.contract_fingerprint ?? null,
    checks: finalized.checks,
    summary,
  };

  if (finalized.compat_applied) {
    report.compat_applied = finalized.compat_applied;
  }
  if (finalized.compat_expired) {
    report.compat_expired = finalized.compat_expired;
  }

  const dir = ensureReportDir(projectRoot, feature, phase, frameworkRoot);
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
export function fatalFailureKindForStage(stage: 'assemble_ai_prompt' | 'generate_merged_report' | 'closure_finalization'): 'closure_finalization_failed' | 'framework_bug' {
  return stage === 'closure_finalization' ? 'closure_finalization_failed' : 'framework_bug';
}

export function failScriptReportWithFatalError(
  report: ScriptReport,
  stage: 'assemble_ai_prompt' | 'generate_merged_report' | 'closure_finalization',
  err: Error,
  frameworkRoot?: string,
): ScriptReport {
  const fatal: CheckResult = {
    id: `runner_${stage}_failed`,
    category: 'structure',
    description: `Harness runner 在 ${stage} 阶段抛出未捕获异常`,
    severity: 'BLOCKER',
    status: 'FAIL',
    details: `[Harness runner fatal] ${err.message}\n${err.stack ?? ''}`,
    failure_kind: fatalFailureKindForStage(stage),
    blocking_class: stage === 'closure_finalization' ? 'closure_finalization' : 'framework_bug',
    actionability: 'human_only',
  };

  const updated: ScriptReport = {
    ...report,
    checks: [...report.checks, fatal],
    summary: computeSummary([...report.checks, fatal]),
    timestamp: new Date().toISOString(),
    compat_applied: report.compat_applied,
    compat_expired: report.compat_expired,
  };

  const dir = ensureReportDir(updated.project_root, updated.feature, updated.phase, frameworkRoot);
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
  projectRoot: string,
  phase: Phase,
  feature: string,
  contextFiles: ContextFileEntry[],
  scriptReportJson: string,
  specContent: string,
  resolvedProfile?: HarnessResolvedProfile,
  lifecycleHookFragments?: string[],
  frameworkRoot?: string,
  options?: {
    imageInput?: ImageInputMode;
    /**
     * plan a9d4e7c2 P1-1：**workflow 声明的模板路径**（`verifier_prompt`，相对 harness 根），
     * 由 `resolveVerifierPlan` 带出。调用方必须传——装配用哪个模板是 workflow 的声明说了算。
     *
     * 曾经这里硬编码 `prompts/verify-<phase>.md` 并在文件缺失时**偷偷造一个 fallback**：
     * custom workflow 声明模板 B，runner 却按 A（或 fallback）装配，hook 仍会把这份
     * 「审错了东西」的 prompt 哈希绑成有效证据——静默审错，正是本 plan 要根治的形态。
     * 缺省仅为**兼容既有非 verifier 调用点**（如 init 的 prompt 组装）；一旦传入，
     * 声明路径不可读即抛错，绝不回退。
     */
    verifierPromptRel?: string;
  },
): string {
  const declaredRel = options?.verifierPromptRel?.trim();
  const templatePath = declaredRel
    ? path.resolve(harnessRoot, declaredRel)
    : path.join(harnessRoot, 'prompts', `verify-${phase}.md`);
  if (!fs.existsSync(templatePath)) {
    // fail-closed：声明了却读不到 = 声明与磁盘不一致，必须明确失败。
    // 绝不 fallback——"造一个通用模板顶上"会让 verifier 审了一份谁也没声明过的东西，
    // 而绑定链照样把它当有效证据。
    throw new Error(
      `[report-generator] verifier prompt 模板不存在：${templatePath}` +
        (declaredRel
          ? `（workflow 为 phase "${phase}" 声明的是 verifier_prompt: ${declaredRel}）`
          : `（phase "${phase}" 的默认模板）`) +
        '。请修正 workflow 的 verifier_prompt 声明或补齐该模板；框架不会自动生成替代品。',
    );
  }
  const template0 = fs.readFileSync(templatePath, 'utf-8');
  let template: string = template0;

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

  const dir = ensureReportDir(projectRoot, feature, phase, frameworkRoot);
  const contextImageDir = path.join(dir, 'context-images');
  let imageIdx = 0;

  const contextSection = contextFiles
    .map(cf => {
      if (cf.kind === 'image' && cf.imagePath && fs.existsSync(cf.imagePath)) {
        fs.mkdirSync(contextImageDir, { recursive: true });
        const base = path.basename(cf.imagePath).replace(/[^\w.-]+/g, '_');
        const sidecarName = `${String(imageIdx).padStart(2, '0')}-${base}`;
        imageIdx++;
        const sidecarAbs = path.join(contextImageDir, sidecarName);
        fs.copyFileSync(cf.imagePath, sidecarAbs);
        const sidecarRel = path.join('context-images', sidecarName).replace(/\\/g, '/');
        const mime = cf.mime ?? 'image/png';
        return [
          `### ${cf.label}`,
          '',
          `> 多模态上下文图片（sidecar）：\`${sidecarRel}\` · ${mime}`,
          '',
          `![${cf.label}](${sidecarRel})`,
          '',
          cf.content.trim()
            ? cf.content
            : 'VL verifier 须读取 sidecar 像素文件对照 ui-spec（禁止把 data URI 当保真注入）。',
        ].join('\n');
      }
      return `### ${cf.label}\n\n\`\`\`\n${cf.content}\n\`\`\``;
    })
    .join('\n\n');
  const sidecarNames: string[] = [];
  if (fs.existsSync(contextImageDir)) {
    for (const f of fs.readdirSync(contextImageDir).sort()) {
      if (/\.(png|jpe?g|webp|gif)$/i.test(f)) sidecarNames.push(f);
    }
  }

  let tail = '';
  if (phase === 'coding' && options?.imageInput === 'tool_read') {
    tail +=
      '\n\n---\n\n## 多模态读图取证（tool_read · M3）\n\n' +
      formatReadImageEvidenceInstructions(sidecarNames) +
      '\n';
  }
  if (lifecycleHookFragments && lifecycleHookFragments.length > 0) {
    tail +=
      '\n\n---\n\n## Lifecycle hooks（实例 / profile / framework）\n\n' +
      lifecycleHookFragments.map((f, i) => `### Hook fragment ${i + 1}\n\n${f}`).join('\n\n');
  }

  // 占位符填充抽成纯函数：写盘文本与规范化摘要**同一次装配、同一套输入**产出，
  // 只有两处 runner telemetry 取不同值。这样"规范化"不再是事后对自由文本猜正则，
  // 而是在格式化之前就精确知道哪两段是易变量。
  // round7 skills/文案批（plan a9c4e7f1）：{features_dir} 解析实例配置的 paths.features_dir，
  // custom 宿主下 verifier 读/引用真实路径，不再硬编码 doc/features。
  const fill = (scriptReportValue: string, timestampValue: string): string => {
    let out = template;
    out = out.replace(/\{spec_content\}/g, specContent);
    out = out.replace(/\{script_report\}/g, scriptReportValue);
    out = out.replace(/\{feature_name\}/g, feature);
    out = out.replace(/\{phase\}/g, phase);
    out = out.replace(/\{timestamp\}/g, timestampValue);
    out = out.replace(/\{features_dir\}/g, relFeaturesDir(projectRoot));
    out = out.replace(/\{context_files\}/g, contextSection);
    return out + tail;
  };

  // plan a9d4e7c2 T4：这里曾经额外产出一份「规范化摘要」（把 {timestamp} 与
  // {script_report} 换成占位符）供 subject 派生，好让零改动重跑不换代。整套 canonical
  // 投影已随「稳定 subject」承诺一并裁撤——subject 现在直接哈希写盘的 ai-prompt.md 字节。
  const assembled = fill(scriptReportJson, new Date().toISOString());

  const promptPath = path.join(dir, 'ai-prompt.md');
  fs.writeFileSync(promptPath, assembled, 'utf-8');

  return assembled;
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
  projectRoot: string,
  phase: Phase,
  feature: string,
  scriptReport: ScriptReport,
  aiReportContent?: string,
  frameworkRoot?: string,
): string {
  const lines: string[] = [];

  lines.push(`# ${phase.toUpperCase()} 阶段验证报告 — ${feature}`);
  lines.push('');
  lines.push(`> 生成时间: ${new Date().toISOString()}`);
  lines.push(`> 保证等级: ${scriptReport.assurance}`);
  lines.push(`> 能力解析: ${scriptReport.capability_resolutions.length} 项`);
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
      if (check.source) {
        lines.push(`- **来源**: ${check.source}`);
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

  // Visual Handoff：结构化解析与可达性（仅 spec 且 spec 声明 handoff 并由脚本写出 visual_resolution_rows）
  if (phase === 'spec') {
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
    const dir = ensureReportDir(projectRoot, feature, phase, frameworkRoot);
    const promptPath = path.join(dir, 'ai-prompt.md');
    if (fs.existsSync(promptPath)) {
      lines.push(`> AI Harness prompt 已生成，请将以下文件发送给任意 AI 模型执行验证：`);
      lines.push(`> \`${path.relative(process.cwd(), promptPath)}\``);
    } else {
      lines.push('> AI Harness 尚未执行。');
    }
  }
  lines.push('');

  // plan c8e5b3f1 t2 A：blocked capability 明细（人读面，非门禁）——从 capability_resolutions 确定性
  // 提取 active ∧ blocked 的事实。requirement 专属话术只来自该 capability 的 attempt.detail（原样转述），
  // 通用段不夹带专属建议。
  const blockedFacts = collectBlockedCapabilityFacts({ capabilities: scriptReport.capability_resolutions });
  if (blockedFacts.length > 0) {
    lines.push('## 二·五、blocked capability 明细');
    lines.push('');
    for (const fact of blockedFacts) {
      lines.push(`### capability: ${fact.capability}（axis=${fact.axis}）`);
      lines.push('');
      if (fact.unresolved.length === 0) {
        lines.push(
          `- applicability invalid：provider=${fact.applicability_provider ?? 'n/a'}` +
            (fact.applicability_dependencies.length > 0
              ? `，path=${fact.applicability_dependencies.map((d) => d.path).join(', ')}`
              : '') +
            '。补齐该输入后重跑当前 phase。',
        );
      }
      for (const u of fact.unresolved) {
        lines.push(`- input=${u.input} source=${u.source}${u.detail ? `：${u.detail}` : ''}`);
        if (u.upstream_producer) {
          lines.push(`  upstream_producer=${u.upstream_producer}`);
        }
        if (u.dependencies.length > 0) {
          lines.push(
            `  dependencies: ${u.dependencies.map((d) => `${d.path}${d.exists ? '' : ' (missing)'}`).join(', ')}`,
          );
        }
      }
      lines.push('');
    }
  }

  // 最终裁定
  lines.push('## 三、最终裁定');
  lines.push('');
  if (scriptReport.summary.verdict === 'FAIL') {
    lines.push(`**FAIL** — 存在 ${scriptReport.summary.blockers} 个 BLOCKER 级别失败，必须修复后重新验证。`);
  } else if (blockedFacts.length > 0) {
    // review P2：已列出 blocked capability（脚本 checks 或无 BLOCKER，但 capability unresolved）——
    // 不得宣告 PASS，明确阶段 INCOMPLETE、先补输入重跑（不改 ScriptReport 领域模型）。
    lines.push(
      `**INCOMPLETE** — 脚本 Harness 未发现 BLOCKER 失败，但存在 ${blockedFacts.length} 个 blocked capability（见上「blocked capability 明细」）；` +
      '阶段因 capability 输入未解析为 INCOMPLETE，请补齐输入后重跑当前 phase。',
    );
  } else {
    lines.push('**PASS** — 脚本 Harness 未发现 BLOCKER 失败。注意：脚本 PASS 不代表阶段闭环完成，仍必须继续执行 verifier 语义验证并填写 completion receipt。');
  }
  lines.push('');

  const report = lines.join('\n');
  const dir = ensureReportDir(projectRoot, feature, phase, frameworkRoot);
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
  console.log(`  assurance=${report.assurance}`);
  console.log(`  capability_resolutions=${report.capability_resolutions.length}`);
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
      // t1a（plan e6a3c9f4）：console 出口与 script-report/summary/merged 同源展示修复指引与来源。
      if (check.suggestion) {
        console.log(`       Fix: ${formatConsoleDetails(check.suggestion, 600)}`);
      }
      if (check.source) {
        console.log(`       Source: ${check.source}`);
      }
    }
  }

  console.log('');
  console.log(`${'─'.repeat(60)}`);
  console.log(`  Total: ${report.summary.total}  |  PASS: ${report.summary.pass}  |  FAIL: ${report.summary.fail}  |  WARN: ${report.summary.warn}  |  SKIP: ${report.summary.skip}`);
  console.log(`  Blockers: ${report.summary.blockers}`);
  const verdictLabel =
    report.summary.verdict === 'PASS'
      ? (chalk ? chalk.green('PASS') : 'PASS')
      : report.summary.verdict === 'INCOMPLETE'
        ? (chalk ? chalk.yellow('INCOMPLETE') : 'INCOMPLETE')
        : (chalk ? chalk.red('FAIL') : 'FAIL');
  console.log(`  Verdict: ${verdictLabel}`);
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

function isUtDeviceExternalBlocked(checks: CheckResult[]): boolean {
  const build = checks.find(c => c.id === 'ut_hvigor_build');
  const test = checks.find(c => c.id === 'ut_hvigor_test');
  if (build?.status !== 'PASS' || test?.status !== 'FAIL') return false;
  return test.blocking_class === 'externalBlocked' || test.failure_kind === 'device_blocked';
}

function areBlockersOnlyUtDeviceExternal(checks: CheckResult[]): boolean {
  const blockerFails = checks.filter(c => c.severity === 'BLOCKER' && c.status === 'FAIL');
  if (blockerFails.length === 0) return false;
  return blockerFails.every(
    c =>
      c.id === 'ut_hvigor_test' &&
      (c.blocking_class === 'externalBlocked' || c.failure_kind === 'device_blocked'),
  );
}

function isTestingDeviceExternalBlocked(checks: CheckResult[]): boolean {
  const build = checks.find(c => c.id === 'device_test_build');
  const install = checks.find(c => c.id === 'device_test_install');
  if (build?.status !== 'PASS' || install?.status !== 'FAIL') return false;
  return install.blocking_class === 'externalBlocked' || install.failure_kind === 'device_blocked';
}

function areBlockersOnlyTestingDeviceExternal(checks: CheckResult[]): boolean {
  const blockerFails = checks.filter(c => c.severity === 'BLOCKER' && c.status === 'FAIL');
  if (blockerFails.length === 0) return false;
  return blockerFails.every(
    c =>
      c.id === 'device_test_install' &&
      (c.blocking_class === 'externalBlocked' || c.failure_kind === 'device_blocked'),
  );
}

/**
 * f9c2e6b4 t2（codex 复核补接）：coding 编译的**外部条件阻塞**——构建事务原样重跑后
 * 仍报"引用路径找不到、但它就在那儿"，属环境/复验不一致，不是本轮编码的内容问题。
 * 与 ut/testing 设备阻塞同构：唯一 BLOCKER 且标 `externalBlocked` → 投影 INCOMPLETE，
 * 后续由 dependency policy 走 defer_external 分支，而不是回去让 agent 改代码。
 */
function areBlockersOnlyCodingBuildExternal(checks: CheckResult[]): boolean {
  const blockerFails = checks.filter(c => c.severity === 'BLOCKER' && c.status === 'FAIL');
  if (blockerFails.length === 0) return false;
  return blockerFails.every(
    c =>
      c.blocking_class === 'externalBlocked' &&
      c.failure_kind === 'project_build_environment_inconsistent',
  );
}

/**
 * Provider/profile capability gaps are generic external blockers. They are
 * distinct from a provider that declared support and then emitted invalid
 * evidence, which deliberately has no externalBlocked classification.
 */
function areBlockersOnlyCapabilityMissing(checks: CheckResult[]): boolean {
  const blockerFails = checks.filter(c => c.severity === 'BLOCKER' && c.status === 'FAIL');
  if (blockerFails.length === 0) return false;
  return blockerFails.every(
    c => c.blocking_class === 'externalBlocked' && c.failure_kind === 'capability_missing',
  );
}

/** 供 unit test 与 report 生成复用 */
export function resolveVerdictFromChecks(checks: CheckResult[]): Verdict {
  let blockers = 0;
  for (const check of checks) {
    if (check.status === 'FAIL' && check.severity === 'BLOCKER') {
      blockers++;
    }
  }
  if (blockers === 0) return 'PASS';
  if (areBlockersOnlyUtDeviceExternal(checks) && isUtDeviceExternalBlocked(checks)) {
    return 'INCOMPLETE';
  }
  if (areBlockersOnlyTestingDeviceExternal(checks) && isTestingDeviceExternalBlocked(checks)) {
    return 'INCOMPLETE';
  }
  if (areBlockersOnlyCodingBuildExternal(checks)) {
    return 'INCOMPLETE';
  }
  if (areBlockersOnlyCapabilityMissing(checks)) {
    return 'INCOMPLETE';
  }
  return 'FAIL';
}

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

  summary.verdict = resolveVerdictFromChecks(checks);

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
