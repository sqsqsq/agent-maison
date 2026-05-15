// ============================================================================
// Harness 统一运行入口
// ============================================================================
// 用法（在仓库根目录执行）:
//   cd framework/harness && npx ts-node harness-runner.ts --phase coding --feature home-page
//   cd framework/harness && npx ts-node harness-runner.ts --phase prd --feature home-page
//   cd framework/harness && npx ts-node harness-runner.ts --list
//
// 流程:
//   1. 读取 framework/specs/phase-rules/{phase}-rules.yaml (阶段级规约)
//   2. 读取 doc/features/{feature}/ (功能级规约 · 实例工程根，扁平归档)
//   3. 运行脚本 Harness (scripts/check-{phase}.ts)
//   4. 输出脚本报告到实例解析的报告目录（默认可为 doc/features/{feature}/{phase}/reports/script-report.json）
//   5. 组装 AI Harness 的 prompt (填充模板 + 上下文)
//   6. 输出 prompt 到同目录 ai-prompt.md
//   7. 生成合并报告 merged-report.md
//
// 模型无关: 第 5/6 步只生成 prompt，不调用任何 AI API。
// ============================================================================

import * as path from 'path';
import * as fs from 'fs';
import { spawnSync } from 'child_process';
import minimist from 'minimist';
import { SpecLoader, FeatureArtifactInspection } from './scripts/utils/spec-loader';
import {
  generateScriptReport,
  assembleAIPrompt,
  generateMergedReport,
  printReportToConsole,
  failScriptReportWithFatalError,
} from './scripts/utils/report-generator';
import {
  Phase,
  CheckResult,
  CheckContext,
  PhaseChecker,
  ScriptReport,
  GLOBAL_FEATURE_SENTINEL,
} from './scripts/utils/types';
import {
  resolvePaths,
  featureFilePath,
  featureDir,
  relFeatureFile,
  catalogPath,
  glossaryPath,
  architectureMdPath,
  relCatalog,
  relGlossary,
  relArchitectureMd,
  statefilePath,
  receiptFilePath,
  loadFrameworkConfig,
  relFeaturePhaseReportsDir,
  featurePhaseReportsDir,
} from './config';
import {
  loadResolvedProfile,
  loadPhaseRuleWithOverlays,
  isPhaseDisabledByProfile,
} from './profile-loader';
import {
  resolveWorkflowSpec,
  workflowPhaseIdSet,
  isPhaseGlobalInWorkflow,
  listWorkflowPhases,
  type WorkflowSpec,
} from './workflow-loader';
import {
  dispatchLifecycleHooks,
  type HookDispatchPayload,
  type HookEventName,
} from './hooks-dispatcher';
import * as YAML from 'yaml';

// --------------------------------------------------------------------------
// CLI 参数解析
// --------------------------------------------------------------------------

const args = minimist(process.argv.slice(2), {
  string: ['phase', 'feature', 'ai-report', 'adapter', 'workflow'],
  boolean: ['list', 'help', 'verbose', 'clear-state', 'summary', 'failures-only', 'skip-visual-handoff'],
  alias: {
    p: 'phase',
    f: 'feature',
    l: 'list',
    h: 'help',
    v: 'verbose',
  },
});

// --------------------------------------------------------------------------
// 帮助信息
// --------------------------------------------------------------------------

function printHelp(): void {
  console.log(`
Harness — Spec/Harness 验证工具

用法（需先 cd framework/harness）:
  npx ts-node harness-runner.ts [options]

选项:
  -p, --phase <phase>       指定验证阶段（合法集合由当前 workflow 决定，默认见 framework/workflows/spec-driven.workflow.yaml）
  --workflow <name>         覆盖 framework.config.json 的 active_workflow（CLI 优先）
  -f, --feature <name>      指定功能模块名 (如 home-page)；全局 scope 阶段可不填（默认 _global）
  --adapter <adapter_name>      init 必选；须与 framework/agents/<adapter_name>/ 存在且含 adapter.yaml（其他阶段忽略）
  -l, --list                列出可用的 Spec 文件
  -v, --verbose             展开全部检查项（默认控制台只打印 FAIL/WARN）
  --ai-report <path>        指定 AI Harness 报告文件路径，合并到最终报告
  --clear-state             丢弃当前阶段状态文件（用于明确放弃某个未闭环阶段）
  --summary                 输出稳定短摘要，并写入实例解析的报告目录（同 phase）summary.json
  --failures-only           控制台只打印 FAIL/WARN/BLOCKER-SKIP 项（默认已启用；保留给脚本显式表达）
  --skip-visual-handoff     PRD 阶段跳过 Visual Handoff 脚本检查（应急）；建议设置环境变量 HARNESS_SKIP_VISUAL_HANDOFF_REASON 留审计说明
  -h, --help                显示帮助

示例:
  cd framework/harness && npx ts-node harness-runner.ts --phase coding --feature home-page
  cd framework/harness && npx ts-node harness-runner.ts --phase catalog
  cd framework/harness && npx ts-node harness-runner.ts --phase glossary
  cd framework/harness && npx ts-node harness-runner.ts --phase docs
  cd framework/harness && npx ts-node harness-runner.ts --phase init --adapter generic
  cd framework/harness && npx ts-node harness-runner.ts --list

放弃当前阶段（清理 Stop hook 的状态文件）:
  cd framework/harness && npx ts-node harness-runner.ts --clear-state
`);
}

// --------------------------------------------------------------------------
// 主流程
// --------------------------------------------------------------------------

async function main(): Promise<void> {
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  // __dirname 指向 framework/harness/；projectRoot 需要再向上一级回到仓库/实例根。
  // 阶段 3：harness 下所有路径解析统一走 config.resolvePaths；harness-runner
  //        只把 projectRoot 当输入，不再自拼具体目录字符串。
  const projectRoot = path.resolve(__dirname, '..', '..');
  const harnessRoot = __dirname;
  const paths = resolvePaths(projectRoot, path.resolve(__dirname, '..'));
  const specLoader = new SpecLoader(projectRoot, paths.phaseRulesDir);
  const phaseRulesRel = path.relative(projectRoot, paths.phaseRulesDir).replace(/\\/g, '/');
  const featuresRel = path.relative(projectRoot, paths.featuresDir).replace(/\\/g, '/');

  // --list 模式
  if (args.list) {
    printAvailableSpecs(specLoader, projectRoot, phaseRulesRel, featuresRel);
    process.exit(0);
  }

  // --clear-state 模式：明确放弃当前阶段，让 Stop hook 不再以陈旧 state
  // 拦截后续 cli 会话。无条件删除：state file 本身只承载判定状态，
  // 历史 verdict / 报告落在 paths.reports_dir_pattern 解析目录，或遗留 layout 下的 framework/harness/reports。
  if (args['clear-state']) {
    handleClearState(projectRoot);
    process.exit(0);
  }

  // 参数校验
  const phase = args.phase as Phase | undefined;
  let feature = args.feature as string | undefined;

  if (!phase) {
    console.error('错误: 必须指定 --phase 参数');
    printHelp();
    process.exit(1);
  }

  const fwConfigEarly = loadFrameworkConfig(projectRoot);
  let workflowSpec: WorkflowSpec;
  try {
    workflowSpec = resolveWorkflowSpec(projectRoot, {
      config: fwConfigEarly,
      workflowOverride: typeof args.workflow === 'string' ? args.workflow : undefined,
    });
  } catch (err) {
    console.error(`错误: 无法解析 workflow：${(err as Error).message}`);
    process.exit(1);
  }

  const phaseIds = workflowPhaseIdSet(workflowSpec);
  if (!phaseIds.has(phase)) {
    const hint = listWorkflowPhases(workflowSpec).join(', ');
    console.error(`错误: 无效的阶段 "${phase}"。当前 workflow 合法 phase: ${hint}`);
    process.exit(1);
  }

  // workflow 中 scope=global 的阶段不归属任何 feature。
  // 若用户显式传了 --feature 也尊重其值（便于在不同 staging 轮次下分别归档报告），
  // 否则使用哨兵值 GLOBAL_FEATURE_SENTINEL（= "_global"）。
  const phaseIsGlobal = isPhaseGlobalInWorkflow(workflowSpec, phase);
  if (phaseIsGlobal) {
    if (!feature) {
      feature = GLOBAL_FEATURE_SENTINEL;
    }
  } else if (!feature) {
    console.error('错误: 必须指定 --feature 参数');
    printHelp();
    process.exit(1);
  }

  console.log(`\n🔍 Harness 验证开始: phase=${phase}, feature=${feature}\n`);

  const resolvedProfile = loadResolvedProfile(projectRoot, fwConfigEarly);

  // Step 1: 加载 Spec
  console.log('📋 Step 1: 加载 Spec 规约...');
  let phaseRule;
  try {
    phaseRule = specLoader.loadPhaseRule(phase);
    phaseRule = loadPhaseRuleWithOverlays(phase, phaseRule, resolvedProfile);
    console.log(`   ✓ 阶段级规约: ${phaseRulesRel}/${phase}-rules.yaml`);
    console.log(`   ✓ project_profile: ${resolvedProfile.name}${resolvedProfile.subVariant ? ` / ${resolvedProfile.subVariant}` : ''}`);
  } catch (err) {
    console.error(`   ✗ 无法加载阶段级规约: ${(err as Error).message}`);
    process.exit(1);
  }

  const artifactInspection = phaseIsGlobal ? null : specLoader.inspectFeatureArtifacts(feature, phase);
  if (artifactInspection) {
    printFeatureArtifactInspection(artifactInspection, featuresRel);
    if (artifactInspection.verdict === 'missing_directory' || artifactInspection.verdict === 'path_not_directory') {
      const blocker = featureArtifactBlocker(projectRoot, artifactInspection);
      const quickReport = generateScriptReport(harnessRoot, phase, feature, projectRoot, [blocker]);
      printReportToConsole(quickReport, {
        failuresOnly: Boolean(args['failures-only']) || !Boolean(args.verbose),
      });
      process.exit(1);
    }
  }

  // catalog/glossary 是全局阶段，不加载功能级规约
  const featureSpec = phaseIsGlobal ? { feature } : specLoader.loadFeatureSpec(feature);

  if (phaseIsGlobal) {
    console.log(`   ⊘ 全局阶段（${phase}）：跳过功能级规约加载。`);
  } else {
    if (featureSpec.contracts) {
      console.log(`   ✓ 功能级规约: ${relFeatureFile(projectRoot, feature, 'contracts.yaml')}`);
    } else {
      console.log(`   ⊘ 功能级规约: contracts.yaml 不存在 (跳过契约检查)`);
    }
    if (featureSpec.acceptance) {
      console.log(`   ✓ 功能级规约: ${relFeatureFile(projectRoot, feature, 'acceptance.yaml')}`);
    } else {
      console.log(`   ⊘ 功能级规约: acceptance.yaml 不存在 (跳过验收检查)`);
    }
  }

  // Step 2: 运行脚本 Harness
  console.log('\n🔧 Step 2: 运行脚本 Harness...');
  const fwConfig = fwConfigEarly;
  const vhMode = fwConfig.prd?.visual_handoff_enforcement as
    | 'strict'
    | 'warn'
    | 'reachable'
    | 'off'
    | undefined;
  const context: CheckContext = {
    phase,
    feature,
    projectRoot,
    phaseRule,
    featureSpec,
    adapter: typeof args.adapter === 'string' ? args.adapter : undefined,
    visualHandoffEnforcement: vhMode,
    prdVisualSources: fwConfig.prd?.visual_sources,
    docsCommitted: fwConfig.paths.docs_committed ?? false,
    skipVisualHandoff: Boolean(args['skip-visual-handoff']),
    resolvedProfile,
  };

  // 记录本次 harness 运行起点的 commit，供 ut_no_src_mutation 等规则使用
  // （注意：HEAD 是当前已提交状态；UT 阶段未提交的改动会被 git diff 检测到）
  recordStartCommit(harnessRoot, phase, feature, projectRoot);

  // 阶段状态机：标记 running，供 Stop hook 在 agent 想结束消息时判断
  // "当前是否处于阶段流程中"。harness 跑完后会再次更新 verdict / blocker_count；
  // claimed_done 始终为 false——只有 agent 显式填写完成回执并通过 check-receipt
  // 后才会被 Stop hook 视为闭环。
  writeCurrentPhaseState(projectRoot, workflowSpec, {
    phase,
    feature,
    status: 'running',
    started_at: new Date().toISOString(),
  });

  const hookOpts = {
    enabled: fwConfig.lifecycle_hooks_enabled !== false,
    timeoutMs: 30000,
  };
  const lifecycleFragments: string[] = [];

  async function emitLifecycle(
    event: HookEventName,
    extra?: Partial<Pick<HookDispatchPayload, 'checkScript' | 'violation'>>,
  ): Promise<CheckResult[]> {
    const { promptFragments, hookCheckResults } = await dispatchLifecycleHooks(
      harnessRoot,
      event,
      {
        projectRoot,
        phase: phase as Phase,
        feature: feature as string,
        resolvedProfileName: resolvedProfile.name,
        hookEvent: event,
        ...extra,
      },
      resolvedProfile,
      hookOpts,
    );
    lifecycleFragments.push(...promptFragments);
    return hookCheckResults;
  }

  let checks: CheckResult[] = [];
  checks.push(...(await emitLifecycle('pre_phase')));
  checks.push(...(await emitLifecycle('pre_check', { checkScript: `check-${phase}.ts` })));

  checks.push(
    ...(isPhaseDisabledByProfile(phase, resolvedProfile)
      ? [
          {
            id: 'phase_disabled_by_profile',
            category: 'structure' as const,
            description: `阶段 ${phase} 已由 project_profile 禁用（跳过脚本规则集）`,
            severity: 'MINOR' as const,
            status: 'SKIP' as const,
            details: `profile=${resolvedProfile.name}，参见 framework/profiles/${resolvedProfile.name}/profile.yaml phases_disabled`,
          },
        ]
      : await runScriptHarness(harnessRoot, context)),
  );

  checks.push(...(await emitLifecycle('post_check', { checkScript: `check-${phase}.ts` })));

  const violations = checks.filter(
    c => c.status === 'FAIL' && (c.severity === 'BLOCKER' || c.severity === 'MAJOR'),
  );
  for (const v of violations) {
    checks.push(
      ...(await emitLifecycle('on_violation', {
        violation: { ruleId: v.id, severity: v.severity, details: v.details ?? '' },
      })),
    );
  }

  checks.push(...(await emitLifecycle('pre_verifier')));
  checks.push(...(await emitLifecycle('on_context_load')));
  checks.push(...(await emitLifecycle('post_verifier')));
  checks.push(...(await emitLifecycle('post_phase')));

  // Step 3: 生成脚本报告
  console.log('\n📊 Step 3: 生成脚本报告...');
  const scriptReport = generateScriptReport(harnessRoot, phase, feature, projectRoot, checks);
  printReportToConsole(scriptReport, {
    failuresOnly: Boolean(args['failures-only']) || !Boolean(args.verbose),
  });

  // Step 4/5：组装 AI prompt + 合并报告。
  // 这两步发生在 Step 3（script-report.json 已落盘）之后，若裸调用崩栈会造成
  // "磁盘 PASS + 控制台崩栈" 的错位假 PASS。因此统一捕获：任何崩栈都回写
  // script-report.json 为 FAIL（并清理 ai-prompt.md / merged-report.md 残留）。
  const reportDirRel = relFeaturePhaseReportsDir(projectRoot, feature, phase, paths.frameworkRoot);
  let finalReport = scriptReport;

  try {
    // Step 4: 组装 AI prompt
    console.log('🤖 Step 4: 组装 AI Harness prompt...');
    // Test hook：用于验证 Step 4 崩栈回写链路，仅自动化验证场景使用
    if (process.env.HARNESS_FORCE_STEP4_FAIL) {
      throw new TypeError('relativePath.endsWith is not a function (simulated by HARNESS_FORCE_STEP4_FAIL)');
    }
    const contextFiles = collectContextFiles(specLoader, projectRoot, phase, feature, featureSpec);
    const specContent = YAML.stringify(phaseRule);

    assembleAIPrompt(
      harnessRoot,
      projectRoot,
      phase,
      feature,
      contextFiles,
      JSON.stringify(scriptReport, null, 2),
      specContent,
      resolvedProfile,
      lifecycleFragments,
    );
    console.log(`   ✓ AI prompt 已写入 ${reportDirRel}/ai-prompt.md`);
  } catch (err) {
    const e = err as Error;
    console.error(`   ✗ Step 4 组装 AI Harness prompt 失败: ${e.message}`);
    finalReport = failScriptReportWithFatalError(scriptReport, 'assemble_ai_prompt', e);
  }

  if (finalReport === scriptReport) {
    try {
      // Step 5: 合并报告（仅当 Step 4 成功时才执行）
      console.log('\n📝 Step 5: 生成合并报告...');
      const aiReportPath = args['ai-report'];
      let aiReportContent: string | undefined;
      if (aiReportPath && fs.existsSync(aiReportPath)) {
        aiReportContent = fs.readFileSync(aiReportPath, 'utf-8');
        console.log(`   ✓ 读取 AI 报告: ${aiReportPath}`);
      }

      generateMergedReport(harnessRoot, projectRoot, phase, feature, scriptReport, aiReportContent);
      console.log(`   ✓ 合并报告已写入 ${reportDirRel}/merged-report.md`);
    } catch (err) {
      const e = err as Error;
      console.error(`   ✗ Step 5 生成合并报告失败: ${e.message}`);
      finalReport = failScriptReportWithFatalError(scriptReport, 'generate_merged_report', e);
    }
  }

  // 阶段状态机：脚本 harness 完毕，写入 verdict / blocker_count
  // 并尝试 best-effort 跑一遍 check-receipt：
  //   - 回执存在 → 校验它，把校验结果回填到 state file，给 Stop hook 提供精确判据
  //   - 回执不存在 → state.receipt.status = 'missing'（不报错；此时阶段未闭环）
  // 这样 agent 在 harness 跑完之后，仍必须主动填回执 + 通过 check-receipt
  // 才能把 claimed_done 推到 true（由专门的 markPhaseClaimedDone 流程驱动；
  // 当前版本里，Stop hook 负责拒绝 claimed_done=false 时的 stop）。
  const receiptValidation = phaseIsGlobal ? null : tryValidateReceipt(harnessRoot, projectRoot, phase, feature);
  writeCurrentPhaseState(projectRoot, workflowSpec, {
    phase,
    feature,
    status: 'harness_finished',
    last_run_at: new Date().toISOString(),
    verdict: finalReport.summary.verdict,
    blocker_count: finalReport.summary.blockers,
    receipt: receiptValidation,
  });

  const runSummary = writeRunSummary(projectRoot, finalReport, receiptValidation);
  if (args.summary || args['failures-only']) {
    printStableSummary(runSummary);
  }

  // 最终结果
  console.log('\n' + '='.repeat(60));
  if (finalReport.summary.verdict === 'PASS') {
    console.log('  ✅ 脚本 Harness 检查通过');
    console.log('  📤 请将 ai-prompt.md 发送给 AI 模型执行语义验证');
  } else {
    const runnerFailed = finalReport.checks.some(c => c.id.startsWith('runner_') && c.status === 'FAIL');
    if (runnerFailed) {
      console.log(`  ❌ Harness runner 执行异常 (详见 ${reportDirRel}/script-report.json)`);
      console.log('  🔧 请修复 runner_*_failed 报告项后重新运行');
    } else {
      console.log(`  ❌ 脚本 Harness 检查未通过 (${finalReport.summary.blockers} BLOCKER)`);
      console.log('  🔧 请修复 BLOCKER 项后重新运行');
    }
  }
  console.log('='.repeat(60) + '\n');

  process.exit(finalReport.summary.verdict === 'PASS' ? 0 : 1);
}

interface HarnessRunSummary {
  schema_version: '1.0';
  phase: Phase;
  feature: string;
  verdict: 'PASS' | 'FAIL';
  blocker_count: number;
  fail_count: number;
  warn_count: number;
  script_report: string;
  merged_report: string;
  ai_prompt: string;
  summary_json: string;
  run_statuses: Array<{
    id: string;
    status: string;
    can_claim_done?: boolean;
    details: string;
  }>;
  ut_run_status?: string;
  readiness_signals: Array<{
    id: string;
    status: 'ready' | 'incomplete' | 'unknown';
    message: string;
    source_check?: string;
  }>;
  blocking_warnings: Array<{
    id: string;
    blocking_class?: string;
    details_excerpt: string;
    suggestion?: string;
  }>;
  blocking_skips: Array<{
    id: string;
    blocking_class?: string;
    details_excerpt: string;
    suggestion?: string;
  }>;
  blockers: Array<{
    id: string;
    severity: string;
    status: string;
    classification?: string;
    details_excerpt: string;
    affected_files?: string[];
    suggestion?: string;
  }>;
  next_action: string;
  receipt_status?: string;
}

function writeRunSummary(
  projectRoot: string,
  report: ScriptReport,
  receiptValidation: ReturnType<typeof tryValidateReceipt> | null,
): HarnessRunSummary {
  const dir = featurePhaseReportsDir(projectRoot, report.feature, report.phase);
  const rel = (name: string): string => path.relative(projectRoot, path.join(dir, name)).replace(/\\/g, '/');
  const blockers = report.checks
    .filter(c => c.status === 'FAIL' && c.severity === 'BLOCKER')
    .map(c => ({
      id: c.id,
      severity: c.severity,
      status: c.status,
      classification: c.failure_kind ?? extractFailureClassification(c.details),
      details_excerpt: excerpt(c.details, 800),
      affected_files: c.affected_files,
      suggestion: c.suggestion,
    }));
  const runStatuses = report.checks
    .filter(c => c.id.endsWith('_run_status'))
    .map(c => ({
      id: c.id,
      status: c.status,
      can_claim_done: extractCanClaimDone(c.details),
      details: c.details,
    }));
  const blockingWarnings = report.checks
    .filter(c => c.status === 'WARN' && c.severity === 'BLOCKER')
    .map(c => ({
      id: c.id,
      blocking_class: c.blocking_class,
      details_excerpt: excerpt(c.details, 500),
      suggestion: c.suggestion,
    }));
  const blockingSkips = report.checks
    .filter(c => c.status === 'SKIP' && c.severity === 'BLOCKER')
    .map(c => ({
      id: c.id,
      blocking_class: c.blocking_class,
      details_excerpt: excerpt(c.details, 500),
      suggestion: c.suggestion,
    }));
  const utStatus = runStatuses.find(c => c.id === 'ut_run_status')?.details;
  const readinessSignals = buildReadinessSignals(report);
  const summary: HarnessRunSummary = {
    schema_version: '1.0',
    phase: report.phase,
    feature: report.feature,
    verdict: report.summary.verdict,
    blocker_count: report.summary.blockers,
    fail_count: report.summary.fail,
    warn_count: report.summary.warn,
    script_report: rel('script-report.json'),
    merged_report: rel('merged-report.md'),
    ai_prompt: rel('ai-prompt.md'),
    summary_json: rel('summary.json'),
    run_statuses: runStatuses,
    ut_run_status: utStatus,
    readiness_signals: readinessSignals,
    blocking_warnings: blockingWarnings,
    blocking_skips: blockingSkips,
    blockers,
    next_action: decideNextAction(report, blockers, runStatuses, blockingSkips, readinessSignals),
    receipt_status: receiptValidation?.status,
  };
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf-8');
  return summary;
}

function printStableSummary(summary: HarnessRunSummary): void {
  console.log('');
  console.log('HARNESS_SUMMARY');
  console.log(`phase=${summary.phase}`);
  console.log(`feature=${summary.feature}`);
  console.log(`verdict=${summary.verdict}`);
  console.log(`blocker_count=${summary.blocker_count}`);
  console.log(`summary_json=${summary.summary_json}`);
  console.log(`next_action=${summary.next_action}`);
  if (summary.run_statuses.length > 0) {
    console.log('run_statuses:');
    for (const status of summary.run_statuses) {
      console.log(`  - ${status.id}: ${status.status}${typeof status.can_claim_done === 'boolean' ? `, can_claim_done=${status.can_claim_done ? 'YES' : 'NO'}` : ''}`);
    }
  }
  if (summary.blockers.length > 0) {
    console.log('blockers:');
    for (const b of summary.blockers) {
      console.log(`  - ${b.id}${b.classification ? ` (${b.classification})` : ''}`);
    }
  }
  console.log('END_HARNESS_SUMMARY');
}

function decideNextAction(
  report: ScriptReport,
  blockers: HarnessRunSummary['blockers'],
  runStatuses: HarnessRunSummary['run_statuses'],
  blockingSkips: HarnessRunSummary['blocking_skips'],
  readinessSignals: HarnessRunSummary['readiness_signals'],
): string {
  if (blockers.some(b => b.classification === 'stale_diff_base' || b.details_excerpt.includes('stale_diff_base'))) {
    return 'rerun_with_HARNESS_DIFF_BASE_REF_working';
  }
  if (blockers.some(b => b.classification === 'project_dependency_missing')) {
    return 'resolve_project_dependencies_then_rerun';
  }
  if (blockers.some(b => b.classification?.startsWith('missing_') || b.details_excerpt.includes('review_context'))) {
    return 'complete_review_context_then_rerun';
  }
  if (blockers.some(b => b.classification === 'external_project_build_blocker')) {
    return 'defer_external_blocker_or_fix_project_build_then_rerun';
  }
  if (runStatuses.some(s => s.can_claim_done === false)) {
    return 'fix_run_status_blockers_then_rerun';
  }
  if (readinessSignals.some(s => s.status === 'incomplete')) {
    return 'complete_readiness_warnings_then_continue';
  }
  if (report.summary.verdict === 'PASS' && blockingSkips.length > 0) {
    return 'review_blocking_skips_then_verifier';
  }
  if (report.summary.verdict === 'PASS') return 'run_verifier_then_receipt';
  if (blockers.some(b => b.id === 'ut_no_src_mutation' && /baseRef 可能过旧|HARNESS_DIFF_BASE_REF=working/.test(b.details_excerpt))) {
    return 'rerun_with_HARNESS_DIFF_BASE_REF_working';
  }
  if (blockingSkips.length > 0) {
    return 'resolve_blocking_skips_then_rerun';
  }
  return 'fix_blockers_then_rerun';
}

function extractFailureClassification(details: string): string | undefined {
  const match = details.match(/失败归因：([a-zA-Z0-9_]+)/);
  return match?.[1];
}

function excerpt(text: string, max: number): string {
  const compact = text.replace(/\r/g, '').trim();
  return compact.length <= max ? compact : `${compact.slice(0, max)}...`;
}

function extractCanClaimDone(details: string): boolean | undefined {
  const match = details.match(/can_claim_done:\s*(YES|NO)/i);
  if (!match) return undefined;
  return match[1].toUpperCase() === 'YES';
}

function buildReadinessSignals(report: ScriptReport): HarnessRunSummary['readiness_signals'] {
  const signals: HarnessRunSummary['readiness_signals'] = [];

  if (report.phase === 'docs') {
    const docFreshness = report.checks.find(c => c.id === 'doc_freshness');
    if (docFreshness?.status === 'SKIP') {
      signals.push({
        id: 'doc_freshness_effective',
        status: 'unknown',
        source_check: 'doc_freshness',
        message: docFreshness.details,
      });
    }
  }

  if (report.phase === 'catalog') {
    const modules = report.checks.find(c => c.id === 'modules_is_list');
    if (modules?.status === 'WARN' && /为空/.test(modules.details)) {
      signals.push({
        id: 'bootstrap_incomplete',
        status: 'incomplete',
        source_check: 'modules_is_list',
        message: modules.details,
      });
    }
  }

  if (report.phase === 'glossary') {
    const terms = report.checks.find(c => c.id === 'terms_is_list');
    if (terms?.status === 'WARN' && /为空/.test(terms.details)) {
      signals.push({
        id: 'bootstrap_incomplete',
        status: 'incomplete',
        source_check: 'terms_is_list',
        message: terms.details,
      });
    }
  }

  return signals;
}

// --------------------------------------------------------------------------
// 脚本 Harness 调度
// --------------------------------------------------------------------------

async function runScriptHarness(harnessRoot: string, context: CheckContext): Promise<CheckResult[]> {
  const checkerPath = path.join(harnessRoot, 'scripts', `check-${context.phase}.ts`);

  if (!fs.existsSync(checkerPath)) {
    console.log(`   ⊘ 脚本检查器 check-${context.phase}.ts 尚未实现，跳过脚本检查`);
    return [{
      id: `${context.phase}_checker_not_found`,
      category: 'structure',
      description: `check-${context.phase}.ts 检查脚本尚未实现`,
      severity: 'MINOR',
      status: 'SKIP',
      details: `脚本检查器文件 ${checkerPath} 不存在，所有脚本检查项跳过。`,
    }];
  }

  try {
    const checkerModule = require(checkerPath);
    const checker: PhaseChecker = checkerModule.default || checkerModule.checker || checkerModule;

    if (typeof checker.check !== 'function') {
      console.error(`   ✗ check-${context.phase}.ts 未导出有效的检查器 (需要 { check(ctx): Promise<CheckResult[]> })`);
      return [{
        id: `${context.phase}_checker_invalid`,
        category: 'structure',
        description: `check-${context.phase}.ts 导出格式无效`,
        severity: 'MINOR',
        status: 'SKIP',
        details: '检查器必须导出 { phase, check(ctx) } 或 default export。',
      }];
    }

    console.log(`   ▶ 执行 check-${context.phase}.ts ...`);
    return await checker.check(context);
  } catch (err) {
    console.error(`   ✗ 执行 check-${context.phase}.ts 时出错: ${(err as Error).message}`);
    return [{
      id: `${context.phase}_checker_error`,
      category: 'structure',
      description: `check-${context.phase}.ts 执行异常`,
      severity: 'BLOCKER',
      status: 'FAIL',
      details: (err as Error).message,
    }];
  }
}

function printFeatureArtifactInspection(inspection: FeatureArtifactInspection, featuresRel: string): void {
  console.log(`   Feature 目录: ${featuresRel}/${inspection.feature}/ (${inspection.pathKind})`);
  if (inspection.sameNameArchives.length > 0) {
    console.log(`   同名归档旁证: ${inspection.sameNameArchives.join(', ')}（已忽略，正式 feature 只认目录）`);
  }
  if (inspection.relatedSiblingEntries.length > 0) {
    console.log(`   同名前缀旁证: ${inspection.relatedSiblingEntries.join(', ')}（不作为精确 feature）`);
  }
  if (inspection.requiredFiles.length > 0) {
    if (inspection.missingRequiredFiles.length === 0) {
      console.log(`   阶段必需文件: ${inspection.requiredFiles.join(', ')} 均存在`);
    } else {
      console.log(`   阶段必需文件缺失: ${inspection.missingRequiredFiles.join(', ')}`);
    }
  }
}

function featureArtifactBlocker(projectRoot: string, inspection: FeatureArtifactInspection): CheckResult {
  const featuresRel = path.relative(projectRoot, resolvePaths(projectRoot).featuresDir).replace(/\\/g, '/');
  const relPath = `${featuresRel}/${inspection.feature}`;
  const archiveHint = inspection.sameNameArchives.length > 0
    ? `\n检测到同名归档旁证：${inspection.sameNameArchives.join(', ')}。归档不会被当作正式 feature；如需恢复，请先获得用户明确确认后手动恢复为目录。`
    : '';
  const siblingHint = inspection.relatedSiblingEntries.length > 0
    ? `\n检测到同名前缀旁证：${inspection.relatedSiblingEntries.join(', ')}。同名前缀条目不会被当作精确 feature。`
    : '';
  return {
    id: 'feature_artifact_resolution',
    category: 'structure',
    description: 'Feature 输入必须解析为 doc/features/<feature>/ 精确目录',
    severity: 'BLOCKER',
    status: 'FAIL',
    details: `无法把 feature="${inspection.feature}" 解析为正式目录：${relPath}/，当前路径类型为 ${inspection.pathKind}。${archiveHint}${siblingHint}`,
    affected_files: [relPath],
    suggestion: '请确认 feature 名称，或先把需求产物恢复为 doc/features/<feature>/ 目录后再运行 harness。',
    failure_kind: 'feature_artifact_resolution_failed',
    blocking_class: 'feature_artifact_resolution',
  };
}

// --------------------------------------------------------------------------
// trace.json: start_commit 记录
// --------------------------------------------------------------------------

/**
 * 在 reports/<feature>/<phase>/trace.json 记录本次 harness 运行起点的 git commit。
 * 供 ut_no_src_mutation 等规则确定 git diff 的 baseRef。
 *
 * 行为约定：
 *   - 已存在 trace.json 且含 start_commit → 不覆盖（保留首次进入该阶段的 baseline）；
 *   - 否则写入 { phase, feature, started_at, start_commit }；
 *   - 非 git 仓库或 git 不可用 → 静默跳过（rule 端会回退 HEAD~1）。
 */
function recordStartCommit(
  _harnessRoot: string,
  phase: Phase,
  feature: string,
  projectRoot: string,
): void {
  const dir = featurePhaseReportsDir(projectRoot, feature, phase);
  const tracePath = path.join(dir, 'trace.json');

  // 已有 start_commit 不动，保留 baseline
  if (fs.existsSync(tracePath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(tracePath, 'utf-8')) as Record<string, unknown>;
      if (existing && typeof existing.start_commit === 'string' && existing.start_commit) {
        return;
      }
    } catch {
      // bad JSON → 重新写
    }
  }

  const headProbe = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: projectRoot,
    encoding: 'utf-8',
    shell: false,
  });
  if (headProbe.status !== 0) {
    return; // 非 git 仓库或 git 不可用
  }
  const startCommit = (headProbe.stdout ?? '').trim();
  if (!startCommit) return;

  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const trace = {
    phase,
    feature,
    started_at: new Date().toISOString(),
    start_commit: startCommit,
  };
  try {
    fs.writeFileSync(tracePath, JSON.stringify(trace, null, 2), 'utf-8');
  } catch {
    // best-effort
  }
}

// --------------------------------------------------------------------------
// 上下文文件收集
// --------------------------------------------------------------------------

function collectContextFiles(
  specLoader: SpecLoader,
  projectRoot: string,
  phase: Phase,
  feature: string,
  featureSpec: import('./scripts/utils/types').FeatureSpec,
): Array<{ label: string; content: string }> {
  const files: Array<{ label: string; content: string }> = [];

  // catalog/glossary 是全局阶段：上下文只包含两份 SSOT 文件本身，
  // 不读任何 feature 维度的 PRD.md / design.md / 源码。
  if (phase === 'catalog' || phase === 'glossary') {
    const catPath = catalogPath(projectRoot);
    if (fs.existsSync(catPath)) {
      files.push({
        label: relCatalog(projectRoot),
        content: fs.readFileSync(catPath, 'utf-8'),
      });
    }
    const glosPath = glossaryPath(projectRoot);
    if (fs.existsSync(glosPath)) {
      files.push({
        label: relGlossary(projectRoot),
        content: fs.readFileSync(glosPath, 'utf-8'),
      });
    }
    return files;
  }

  // docs 是 framework 自检阶段：上下文只放 inventory 自身，
  // 不读 catalog/glossary，也不读 feature 维度文件。
  if (phase === 'docs') {
    const inventoryPath = path.join(projectRoot, 'framework', 'docs', 'DOC_INVENTORY.yaml');
    if (fs.existsSync(inventoryPath)) {
      files.push({
        label: 'framework/docs/DOC_INVENTORY.yaml',
        content: fs.readFileSync(inventoryPath, 'utf-8'),
      });
    }
    return files;
  }

  // init 是 framework-init 元阶段：上下文最小化，只放 framework.config.json
  // （若存在）。adapter.yaml / 模板由 check-init.ts 自行解析读取，避免
  // collectContextFiles 重复 IO。CREATE 模式下 framework.config.json 还
  // 没有，files 为空也合法（init 没有 verifier 子 agent，AI prompt 只是
  // 形式上保留）。
  if (phase === 'init') {
    const cfgPath = path.join(projectRoot, 'framework.config.json');
    if (fs.existsSync(cfgPath)) {
      files.push({
        label: 'framework.config.json',
        content: fs.readFileSync(cfgPath, 'utf-8'),
      });
    }
    return files;
  }

  const prd = specLoader.loadFeatureDoc(projectRoot, feature, 'PRD.md');
  if (prd) {
    files.push({ label: relFeatureFile(projectRoot, feature, 'PRD.md'), content: prd });
  }

  if (['design', 'coding', 'review', 'ut', 'testing'].includes(phase)) {
    const design = specLoader.loadFeatureDoc(projectRoot, feature, 'design.md');
    if (design) {
      files.push({ label: relFeatureFile(projectRoot, feature, 'design.md'), content: design });
    }
  }

  if (phase === 'design') {
    const archPath = architectureMdPath(projectRoot);
    if (fs.existsSync(archPath)) {
      files.push({ label: relArchitectureMd(projectRoot), content: fs.readFileSync(archPath, 'utf-8') });
    }
  }

  if (['coding', 'review', 'ut'].includes(phase) && featureSpec.contracts) {
    const sourceFiles = specLoader.collectSourceFiles(projectRoot, featureSpec.contracts, '.ets');
    let count = 0;
    for (const [filePath, content] of sourceFiles) {
      if (count >= 30) {
        files.push({
          label: '(truncated)',
          content: `... 还有 ${sourceFiles.size - count} 个文件未包含`,
        });
        break;
      }
      files.push({ label: filePath, content });
      count++;
    }
  }

  if (phase === 'review') {
    const reviewReport = specLoader.loadFeatureDoc(projectRoot, feature, 'review-report.md');
    if (reviewReport) {
      files.push({ label: relFeatureFile(projectRoot, feature, 'review-report.md'), content: reviewReport });
    }

    const specDir = featureDir(projectRoot, feature);
    for (const specFile of ['acceptance.yaml', 'contracts.yaml']) {
      const specPath = path.join(specDir, specFile);
      if (fs.existsSync(specPath)) {
        files.push({
          label: relFeatureFile(projectRoot, feature, specFile),
          content: fs.readFileSync(specPath, 'utf-8'),
        });
      }
    }
  }

  if (phase === 'ut') {
    const specDir = featureDir(projectRoot, feature);
    for (const specFile of ['acceptance.yaml', 'contracts.yaml', 'use-cases.yaml']) {
      const specPath = path.join(specDir, specFile);
      if (fs.existsSync(specPath)) {
        files.push({
          label: relFeatureFile(projectRoot, feature, specFile),
          content: fs.readFileSync(specPath, 'utf-8'),
        });
      }
    }

    if (featureSpec.contracts?.modules) {
      for (const mod of featureSpec.contracts.modules) {
        const dagDir = path.join(projectRoot, mod.package_path, 'test', 'dag');
        if (fs.existsSync(dagDir)) {
          collectFilesFromDir(dagDir, projectRoot, /\.dag\.yaml$/, files, 10);
        }

        const utDir = path.join(projectRoot, mod.package_path, 'src', 'ohosTest', 'ets', 'test');
        if (fs.existsSync(utDir)) {
          collectFilesFromDir(utDir, projectRoot, /\.test\.ets$/, files, 20);
        }

        const mockDir = path.join(utDir, 'mock');
        if (fs.existsSync(mockDir)) {
          collectFilesFromDir(mockDir, projectRoot, /\.ets$/, files, 10);
        }
      }
    }
  }

  if (phase === 'testing') {
    const specDir = featureDir(projectRoot, feature);
    for (const specFile of ['acceptance.yaml', 'contracts.yaml']) {
      const specPath = path.join(specDir, specFile);
      if (fs.existsSync(specPath)) {
        files.push({
          label: relFeatureFile(projectRoot, feature, specFile),
          content: fs.readFileSync(specPath, 'utf-8'),
        });
      }
    }

    const testPlan = specLoader.loadFeatureDoc(projectRoot, feature, 'test-plan.md');
    if (testPlan) {
      files.push({ label: relFeatureFile(projectRoot, feature, 'test-plan.md'), content: testPlan });
    }

    const testReport = specLoader.loadFeatureDoc(projectRoot, feature, 'test-report.md');
    if (testReport) {
      files.push({ label: relFeatureFile(projectRoot, feature, 'test-report.md'), content: testReport });
    }
  }

  return files;
}

// --------------------------------------------------------------------------
// 文件收集辅助
// --------------------------------------------------------------------------

function collectFilesFromDir(
  dir: string,
  projectRoot: string,
  pattern: RegExp,
  files: Array<{ label: string; content: string }>,
  maxFiles: number,
): void {
  let count = 0;
  const scan = (d: string) => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (count >= maxFiles) return;
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        scan(full);
      } else if (pattern.test(entry.name)) {
        const relPath = path.relative(projectRoot, full).replace(/\\/g, '/');
        files.push({ label: relPath, content: fs.readFileSync(full, 'utf-8') });
        count++;
      }
    }
  };
  scan(dir);
}

// --------------------------------------------------------------------------
// 阶段状态机（agent 工作流强制门 / Layer 3 配套）
// --------------------------------------------------------------------------
//
// 写入 framework/harness/state/.current-phase.json。该文件是 Stop hook
// （实例根 Stop hook 脚本若存在）读取本 state 的唯一判据：
//   - status='running'         → harness 还没跑完，agent 不应停下
//   - status='harness_finished'，verdict='PASS'，receipt.status='passed'
//                              → 阶段闭环，可放行
//   - 其它组合                  → Stop hook 阻止 stop 并把缺失项注入下一轮 prompt

interface ReceiptValidation {
  status: 'passed' | 'failed' | 'missing' | 'error';
  receipt_path: string;
  exit_code?: number;
  message?: string;
}

/**
 * runner 写 state 时关心的业务字段。session 维度字段（session_id /
 * session_id_recorded_at / last_seen_*）由 Stop hook 单边维护，
 * runner **不写**它们——runner 是 Bash tool 子进程，拿不到稳定的
 * cli session_id。详见 harness 与设计文档中的「Stop hook 跨会话隔离」说明。
 */
interface CurrentPhaseStatePartial {
  phase: Phase;
  feature: string;
  status: 'running' | 'harness_finished';
  started_at?: string;
  last_run_at?: string;
  verdict?: 'PASS' | 'FAIL' | string;
  blocker_count?: number;
  receipt?: ReceiptValidation | null;
}

interface CurrentPhaseState extends CurrentPhaseStatePartial {
  schema_version: string;
  updated_at: string;
  /** Stop hook 第一次命中时回填；runner 不写它，仅在合并旧 state 时透传 */
  session_id?: string | null;
  /** session_id 被 hook 回填的时刻，便于审计 */
  session_id_recorded_at?: string | null;
  /** 上一次 Stop hook 触发时的 cli session_id（用于审计） */
  last_seen_session_id?: string | null;
  /** 上一次 Stop hook 触发时间 */
  last_seen_at?: string | null;
}

/**
 * `--clear-state` 子命令实现：删除阶段状态文件。
 *
 * 设计取舍：
 *   - 无条件删除：用户明确要"放弃"这个阶段时再触发，没必要再加确认；
 *     脚本化场景（CI / 工具链）友好。
 *   - 不报错：文件不存在视为"已经是干净状态"，console.log 提示即可。
 *   - 不删除其它产物：reports/ / receipt md / trace.json 都不动——
 *     state file 本身只承载 Stop hook 的判定状态，历史审计资料保留。
 */
function handleClearState(projectRoot: string): void {
  const stateAbs = statefilePath(projectRoot);
  const rel = path.relative(projectRoot, stateAbs).replace(/\\/g, '/');
  if (fs.existsSync(stateAbs)) {
    try {
      fs.unlinkSync(stateAbs);
      console.log(`✓ 已删除阶段状态文件 ${rel}`);
    } catch (err) {
      console.error(`✗ 删除 ${rel} 失败: ${(err as Error).message}`);
      process.exitCode = 1;
      return;
    }
  } else {
    console.log(`⊘ ${rel} 不存在，无需清理`);
  }
  console.log('');
  console.log('提示：');
  console.log('  - 历史 verdict / 报告通常在 doc/features/<feature>/<phase>/reports/（配置了 reports_dir_pattern 时），回执仍在 doc/features 下；');
  console.log('  - 如需重新进入该阶段，按对应 SKILL.md 重新执行 harness-runner.ts；');
  console.log('  - --clear-state 表示"放弃已有进度"，与"暂停"不同。');
}

function writeCurrentPhaseState(
  projectRoot: string,
  workflowSpec: WorkflowSpec,
  partial: CurrentPhaseStatePartial,
): void {
  // workflow 中 scope=global 的阶段不参与"feature 维度阶段闭环判定"——
  // 它们没有完成回执模板（参见 framework/harness/scripts/check-init.ts 头部
  // "元阶段三件套刻意不对称"段落，以及 framework/harness/templates/
  // phase-completion-receipt.md 的字段全部围绕 feature/phase 设计）。
  //
  // 若给全局阶段写 state file，Stop hook 会因为 receipt=null 把它误当成
  // "未闭环 feature 阶段"硬拦，并要求 agent 去填一份**根本不存在**的回执
  // doc/features/_global/init/phase-completion-receipt.md。这是 v2.8 主体
  // commit 落地后用户在真实工程跑 /framework-init 时遇到的回归。
  //
  // 修复策略：对全局阶段直接不写——不主动清理已存在的 state file，因为
  // 用户可能正在做 feature 维度阶段（如 coding），中途顺手跑了 docs 全局阶段，
  // 不应抹掉其 coding state。Hook 端有兜底（evaluateState 看到 phase 是
  // 全局阶段也直接 allow），即使存在历史污染也不会误拦。
  if (isPhaseGlobalInWorkflow(workflowSpec, partial.phase)) {
    return;
  }

  try {
    const stateAbs = statefilePath(projectRoot);
    const dir = path.dirname(stateAbs);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // 读旧状态（若存在）做增量合并：started_at 不要被 harness_finished 覆盖
    let prev: Partial<CurrentPhaseState> = {};
    if (fs.existsSync(stateAbs)) {
      try {
        prev = JSON.parse(fs.readFileSync(stateAbs, 'utf-8')) as Partial<CurrentPhaseState>;
      } catch {
        // 旧文件损坏 → 直接覆盖
      }
    }

    // 同 phase/feature 时，保留 hook 维护的 session 维度字段——
    // runner 自己不写它们，但也不能因为重写 state 把旧值清掉，否则
    // hook 下次触发会误判"刚跑完 + 没盖章"。
    const sameTask = prev.phase === partial.phase && prev.feature === partial.feature;
    const carrySessionId = sameTask ? prev.session_id ?? null : null;
    const carrySessionRecordedAt = sameTask ? prev.session_id_recorded_at ?? null : null;
    const carryLastSeenSid = sameTask ? prev.last_seen_session_id ?? null : null;
    const carryLastSeenAt = sameTask ? prev.last_seen_at ?? null : null;

    const next: CurrentPhaseState = {
      schema_version: '1.1',
      phase: partial.phase,
      feature: partial.feature,
      status: partial.status,
      started_at:
        partial.status === 'running'
          ? partial.started_at ?? new Date().toISOString()
          : sameTask
            ? prev.started_at ?? partial.started_at
            : partial.started_at,
      last_run_at: partial.last_run_at,
      verdict: partial.verdict,
      blocker_count: partial.blocker_count,
      receipt: partial.receipt ?? null,
      session_id: carrySessionId,
      session_id_recorded_at: carrySessionRecordedAt,
      last_seen_session_id: carryLastSeenSid,
      last_seen_at: carryLastSeenAt,
      updated_at: new Date().toISOString(),
    };

    fs.writeFileSync(stateAbs, JSON.stringify(next, null, 2) + '\n', 'utf-8');
  } catch (err) {
    // best-effort：不让状态机故障阻塞 harness 主流程
    console.warn(`   ⚠ 写 .current-phase.json 失败: ${(err as Error).message}`);
  }
}

/**
 * 当回执文件已存在时，主动跑一遍 check-receipt.ts 把判定结果带回 state file。
 * 回执不存在不视为错误——因为 agent 通常先跑 harness、再填回执；
 * 真正的"未填即未闭环"由 Stop hook 在 agent 即将结束消息时拦截。
 */
function tryValidateReceipt(
  harnessRoot: string,
  projectRoot: string,
  phase: Phase,
  feature: string,
): ReceiptValidation {
  const receiptAbs = receiptFilePath(projectRoot, feature, phase);
  const receiptRel = path.relative(projectRoot, receiptAbs).replace(/\\/g, '/');

  if (!fs.existsSync(receiptAbs)) {
    return {
      status: 'missing',
      receipt_path: receiptRel,
      message: '回执文件不存在；本阶段尚未闭环（全局入口 §5.1 第 4 条）。',
    };
  }

  const checker = path.join(harnessRoot, 'scripts', 'check-receipt.ts');
  if (!fs.existsSync(checker)) {
    return {
      status: 'error',
      receipt_path: receiptRel,
      message: `check-receipt.ts 不存在于 ${checker}（框架未升级到位）。`,
    };
  }

  // 用 tsx/ts-node 直接运行；harness-runner.ts 自己已经在 ts-node 进程里，
  // 子进程独立 spawn 一份 ts-node 即可，避免污染主流程的 require 缓存。
  const result = spawnSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    [
      'ts-node',
      checker,
      '--feature',
      feature,
      '--phase',
      phase,
      '--project-root',
      projectRoot,
    ],
    {
      cwd: harnessRoot,
      encoding: 'utf-8',
      shell: false,
    },
  );

  if (result.status === 0) {
    return { status: 'passed', receipt_path: receiptRel, exit_code: 0 };
  }
  if (result.status === 1) {
    return {
      status: 'failed',
      receipt_path: receiptRel,
      exit_code: 1,
      message: (result.stderr ?? '').slice(0, 800),
    };
  }
  return {
    status: 'error',
    receipt_path: receiptRel,
    exit_code: result.status ?? -1,
    message: (result.stderr ?? result.error?.message ?? 'unknown').slice(0, 800),
  };
}

// --------------------------------------------------------------------------
// --list 模式
// --------------------------------------------------------------------------

function printAvailableSpecs(
  specLoader: SpecLoader,
  projectRoot: string,
  phaseRulesRel: string,
  featuresRel: string,
): void {
  console.log('\n📋 可用的 Spec 文件:\n');

  console.log(`  阶段级规约 (${phaseRulesRel}/):`);
  const phases = specLoader.listAvailablePhaseRules();
  if (phases.length === 0) {
    console.log('    (无)');
  } else {
    for (const p of phases) {
      console.log(`    ✓ ${p}-rules.yaml`);
    }
  }

  console.log(`\n  功能级需求 (${featuresRel}/):`);
  const features = specLoader.listAvailableFeatures();
  if (features.length === 0) {
    console.log('    (无)');
  } else {
    for (const f of features) {
      const spec = specLoader.loadFeatureSpec(f);
      const parts: string[] = [];
      if (spec.contracts) parts.push('contracts');
      if (spec.acceptance) parts.push('acceptance');
      console.log(`    ✓ ${f}/ [${parts.join(', ')}]`);
    }
  }

  console.log('');
}

// --------------------------------------------------------------------------
// 入口
// --------------------------------------------------------------------------

main().catch(err => {
  console.error('致命错误:', err);
  process.exit(2);
});
