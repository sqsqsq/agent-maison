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
  HarnessRunSummary,
} from './scripts/utils/types';
import { isLegacyPhaseId, normalizePhaseId } from './scripts/utils/phase-alias';
import { buildSummaryBlockers } from './scripts/utils/summary-blockers';
import { computeGateFingerprint } from './scripts/utils/gate-fingerprint';
import {
  commitVisualRound,
  visualRoundsLedgerPath,
  type VisualRoundEvaluation,
} from './scripts/utils/visual-rounds-ledger';
import { runFrameworkIntegrityPreflight } from './scripts/utils/framework-integrity';
import { runProcessIntegrityPreflight } from './scripts/utils/process-integrity';
import {
  resolveFidelityContextFromFeature,
  resolveEffectiveFidelityContext,
  resolveOcrAvailableForRun,
} from './scripts/utils/fidelity-shared';
import {
  resolvePaths,
  featureFilePath,
  featureDir,
  relFeatureFile,
  relFeatureArtifact,
  resolveFeatureArtifact,
  catalogPath,
  glossaryPath,
  architectureMdPath,
  relCatalog,
  relGlossary,
  relArchitectureMd,
  statefilePath,
  loadFrameworkConfig,
  relFeaturePhaseReportsDir,
  featurePhaseReportsDir,
  relFeaturesDir,
  resolveReceiptFilePath,
} from './config';
import {
  ensurePersonalSetup,
} from './scripts/utils/personal-setup-gate';
import { evaluateConfigPlacementGate } from './scripts/utils/config-placement-gate';
import { resolvePhasePersonalPrerequisites } from './scripts/utils/phase-personal-prerequisites';
import { runCapabilityPreflight, emitHarnessPreflightGap } from './scripts/utils/capability-preflight';
import { computeProductWorktreeDigest } from './scripts/utils/worktree-digest';
import {
  mergeAndWritePhaseState,
  tryValidateReceipt,
  runSyncClosure,
  type ReceiptValidation,
} from './scripts/utils/phase-state';
import {
  runAdhocCorrection,
  runCorrectionCheck,
  runCorrectionInit,
} from './scripts/utils/correction-commands';
import { correctionStatePath } from './scripts/utils/correction-state';
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
import { resolveFeatureTrack, resolvePhaseChain, resolvePhaseClosureSource } from './scripts/utils/runtime-policy';
import { loadFeatureTrackDecl } from './scripts/utils/feature-track';
import {
  dispatchLifecycleHooks,
  type HookDispatchPayload,
  type HookEventName,
} from './hooks-dispatcher';
import * as YAML from 'yaml';
import { detectRepoLayout, frameworkAbs, frameworkRelPath, frameworkLogicalRelPath, inferRepoLayout, type RepoLayout } from './repo-layout';
import { probeAdapterImageInput, collectAuthoritativeImagePaths, resolveContextAdapterImageInput } from './scripts/utils/multimodal-probe';
import { resolveAuthoritativePath } from './scripts/utils/visual-source-resolver';
import { parseUiChangeFromSpecMarkdown, UI_CHANGE_REQUIRES_UI_SPEC, uiSpecRelPath, uiSpecAbsPath } from './scripts/utils/ui-spec-shared';

// --------------------------------------------------------------------------
// CLI 参数解析
// --------------------------------------------------------------------------

const args = minimist(process.argv.slice(2), {
  string: ['phase', 'feature', 'ai-report', 'adapter', 'workflow', 'correction-request', 'q-requirement', 'q-contract', 'q-code'],
  boolean: ['list', 'help', 'verbose', 'clear-state', 'sync-closure', 'summary', 'failures-only', 'skip-visual-handoff', 'skip-ui-spec', 'skip-visual-parity', 'correction-init', 'correction-check', 'adhoc-correction'],
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
  --clear-state             丢弃当前阶段状态文件（用于明确放弃某个未闭环阶段）；一并清理未收口的 .current-correction.json（C5-full）
  --sync-closure            不跑脚本 harness；仅 check-receipt + 同步 .current-phase.json / summary.json
  --summary                 输出稳定短摘要，并写入实例解析的报告目录（同 phase）summary.json
  --failures-only           控制台只打印 FAIL/WARN/BLOCKER-SKIP 项（默认已启用；保留给脚本显式表达）
  --skip-visual-handoff     spec 阶段跳过 Visual Handoff 脚本检查（应急）；建议设置环境变量 HARNESS_SKIP_VISUAL_HANDOFF_REASON 留审计说明
  -h, --help                显示帮助

修正闭环（C5-min correction-routing；修正三问先分层再动手，重验≠重做）:
  --correction-init         归属 + 三问分层 → 写 .current-correction.json（pending）
                            必带 --correction-request "<原始请求>" 与三问答案
                            --q-requirement y|n --q-contract y|n --q-code y|n；
                            可选 --feature <name> 显式点名归属（缺省取活跃 state，均无 = no-feature）
  --correction-check        对照 revalidate 清单核查证据全绿 → status: closed（stale/缺 state 拒绝）
  --adhoc-correction        no-feature 载体：compile + lint + 架构规则 + catalog 反查
                            touched modules；报告落 framework/harness/reports/_adhoc/<ts>/

示例:
  cd framework/harness && npx ts-node harness-runner.ts --phase coding --feature home-page
  cd framework/harness && npx ts-node harness-runner.ts --phase catalog
  cd framework/harness && npx ts-node harness-runner.ts --phase glossary
  cd framework/harness && npx ts-node harness-runner.ts --phase docs
  cd framework/harness && npx ts-node harness-runner.ts --phase init --adapter generic
  cd framework/harness && npx ts-node harness-runner.ts --list

放弃当前阶段（清理 Stop hook 的状态文件）:
  cd framework/harness && npx ts-node harness-runner.ts --clear-state

跨会话恢复闭环态（framework 升级 / 新会话前）:
  cd framework/harness && npx ts-node harness-runner.ts --sync-closure --phase review --feature <feature>
`);
}

/**
 * Tier_1：若 harness 自身 npm 未安装，部分环境下顶层 import 仍可能侥幸启动；
 * 在正式进入 phase 逻辑前做确定性探测，给出可读报错或按需自动安装。
 */
function ensureHarnessTier1DepsOrExit(): void {
  const harnessRoot = __dirname;
  const marker = path.join(harnessRoot, 'node_modules', 'ts-node', 'package.json');
  if (fs.existsSync(marker)) {
    return;
  }

  if (process.env.HARNESS_AUTO_NPM_INSTALL === '1') {
    console.error('[harness] HARNESS_AUTO_NPM_INSTALL=1 → 正在 framework/harness 执行 npm install ...');
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const result = spawnSync(npmCmd, ['install'], {
      cwd: harnessRoot,
      stdio: 'inherit',
      env: process.env,
    });
    if (result.status !== 0) {
      process.exit(result.status ?? 1);
    }
    if (!fs.existsSync(marker)) {
      console.error(
        '[harness] npm install 已结束但仍未检测到 ts-node；请见 framework/skills/reference/host-harness-readiness.md'
      );
      process.exit(1);
    }
    return;
  }

  console.error(
    '[harness] Tier_1 缺失：未检测到 framework/harness/node_modules/ts-node（请先安装 harness npm 依赖）。\n' +
      '  cd framework/harness && npm install\n' +
      '  SSOT: framework/skills/reference/host-harness-readiness.md\n' +
      '  可选（自担 registry/联网策略）：HARNESS_AUTO_NPM_INSTALL=1 cd framework/harness && npx ts-node harness-runner.ts ...'
  );
  process.exit(1);
}

// --------------------------------------------------------------------------
// 主流程
// --------------------------------------------------------------------------

async function main(): Promise<void> {
  ensureHarnessTier1DepsOrExit();

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const harnessRoot = __dirname;
  const layout = detectRepoLayout(harnessRoot);
  const { projectRoot, frameworkRoot: resolvedFrameworkRoot, frameworkRel, kind: layoutKind } = layout;
  const paths = resolvePaths(projectRoot, resolvedFrameworkRoot);
  const specLoader = new SpecLoader(projectRoot, paths.phaseRulesDir, paths.featuresDir, resolvedFrameworkRoot);
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

  if (args['sync-closure']) {
    const syncPhase = args.phase as Phase | undefined;
    const syncFeature = args.feature as string | undefined;
    if (!syncPhase || !syncFeature) {
      console.error('错误: --sync-closure 必须同时指定 --phase 与 --feature');
      printHelp();
      process.exit(1);
    }
    const exitCode = runSyncClosure(harnessRoot, projectRoot, syncFeature, syncPhase, resolvedFrameworkRoot);
    process.exit(exitCode);
  }

  // 修正闭环命令（C5-min correction-routing）
  if (args['correction-init']) {
    const requestText = String(args['correction-request'] ?? '').trim();
    if (!requestText) {
      console.error('错误: --correction-init 必须携带 --correction-request "<原始修正请求>"（fingerprint 防换题复用）');
      process.exit(1);
    }
    for (const k of ['q-requirement', 'q-contract', 'q-code'] as const) {
      const v = String(args[k] ?? '').trim().toLowerCase();
      if (v !== 'y' && v !== 'n') {
        console.error(`错误: --${k} 必须显式给 y|n（修正三问不许缺答，见 AGENTS §4.0 修正三问）`);
        process.exit(1);
      }
    }
    const yn = (k: string): boolean => String(args[k]).trim().toLowerCase() === 'y';
    process.exit(
      runCorrectionInit(projectRoot, {
        requestedFeature: (args.feature as string | undefined) ?? undefined,
        answers: {
          requirement_changed: yn('q-requirement'),
          contract_changed: yn('q-contract'),
          code_change_needed: yn('q-code'),
        },
        requestText,
        frameworkRoot: resolvedFrameworkRoot,
      }),
    );
  }
  if (args['correction-check']) {
    process.exit(runCorrectionCheck(projectRoot, harnessRoot, resolvedFrameworkRoot));
  }
  if (args['adhoc-correction']) {
    process.exit(await runAdhocCorrection(projectRoot, harnessRoot, resolvedFrameworkRoot));
  }

  // 参数校验
  const rawPhase = args.phase as Phase | undefined;
  let feature = args.feature as string | undefined;

  if (!rawPhase) {
    console.error('错误: 必须指定 --phase 参数');
    printHelp();
    process.exit(1);
  }

  const phase =
    isLegacyPhaseId(rawPhase) || rawPhase === 'prd' || rawPhase === 'design'
      ? normalizePhaseId(rawPhase)
      : rawPhase;

  const fwConfigEarly = loadFrameworkConfig(projectRoot);
  let workflowSpec: WorkflowSpec;
  try {
    workflowSpec = resolveWorkflowSpec(projectRoot, {
      config: fwConfigEarly,
      workflowOverride: typeof args.workflow === 'string' ? args.workflow : undefined,
      frameworkRoot: resolvedFrameworkRoot,
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

  // C1 feature-track：按 feature 声明的 track 过滤合法 phase（缺省 full = 现状零变化；
  // lite feature 误跑 full-only phase 明确报错而非静默跑——OpenSpec feature-track）
  if (!phaseIsGlobal && feature && feature !== GLOBAL_FEATURE_SENTINEL) {
    const featureTrack = resolveFeatureTrack(loadFeatureTrackDecl(projectRoot, feature));
    const trackChain = resolvePhaseChain(workflowSpec, featureTrack);
    if (!trackChain.idSet.has(phase)) {
      console.error(
        `错误: phase "${phase}" 不在 feature "${feature}"（track=${featureTrack}）的合法集。` +
          `该 track 合法 feature phase: ${trackChain.featureOrdered.join(', ')}`,
      );
      process.exit(1);
    }
  }

  console.log(`\n🔍 Harness 验证开始: phase=${phase}, feature=${feature}\n`);

  const personalSetupExemptPhases = new Set<Phase>(['init', 'docs']);
  const initInternalGlobalRun = process.env.HARNESS_INIT_INTERNAL_GLOBAL_RUN === '1';
  const skipPersonalGateForInitInternal =
    initInternalGlobalRun && (phase === 'catalog' || phase === 'glossary');
  if (!personalSetupExemptPhases.has(phase) && !skipPersonalGateForInitInternal) {
    const resolvedForGate = loadResolvedProfile(projectRoot, fwConfigEarly);
    const placement = evaluateConfigPlacementGate(projectRoot);
    if (!placement.ok) {
      console.error(`   ✗ ${placement.message.replace(/\n/g, '\n     ')}`);
      console.error('     Step1: init UPDATE / migrate-config 清场 project personal 字段；');
      console.error(
        '     Step2: cd framework/harness && npx ts-node scripts/check-personal-setup.ts --json --ensure --phase ' +
          `${phase} --project-root <repo-root>`,
      );
      process.exit(1);
    }
    // t3-min（openspec capability-gap-preflight）：共享 preflight——缺口输出结构化
    // HARNESS_PREFLIGHT（stdout 标记行+state 持久化，goal/交互态同源可分类）+ 双出口话术；
    // 机器行为恒=非零退出，不读 stdin、不放行（07-16 事故 A：裸 console.error 让 goal 侧无从归因）。
    const preflight = runCapabilityPreflight(projectRoot, phase, resolvedForGate);
    if (!preflight.ok) {
      emitHarnessPreflightGap(projectRoot, phase, preflight);
      console.error(`   ✗ [${preflight.code}] ${preflight.message.replace(/\n/g, '\n     ')}`);
      console.error(`     ${preflight.guidance_install}`);
      console.error(`     ${preflight.guidance_stop}`);
      console.error(
        '     或修正 materialized_adapters / 物化产物；详见 framework/skills/reference/personal-setup-gate.md',
      );
      process.exit(1);
    }
  }

  if (phase === 'testing' && feature === '_adhoc') {
    console.error(
      '   ✗ 即席（ad-hoc）真机测试勿使用 harness-runner --feature _adhoc。\n' +
        '     请改用: derive-adhoc-hylyre-hint 或 adhoc-device-test --steps "…"（derive）；\n' +
        '     跑机: adhoc-device-test --bundle <id> --plan <agent写的 test-plan.hylyre.md>\n' +
        '     （CLI 内自动 ensureHylyreReady，不要求用户 pip install / 手删 .hylyre/venv）\n' +
        '     详见 framework/skills/feature/device-testing/SKILL.md Step 4.B',
    );
    process.exit(1);
  }

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
    printFeatureArtifactInspection(projectRoot, artifactInspection, featuresRel);
    if (artifactInspection.verdict === 'missing_directory' || artifactInspection.verdict === 'path_not_directory') {
      const blocker = featureArtifactBlocker(projectRoot, artifactInspection, paths.frameworkRoot);
      const quickReport = generateScriptReport(harnessRoot, phase, feature, projectRoot, [blocker], resolvedFrameworkRoot);
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
  const vhMode = fwConfig.spec?.visual_handoff_enforcement as
    | 'strict'
    | 'warn'
    | 'reachable'
    | 'off'
    | undefined;
  const uiSpecMode = fwConfig.spec?.ui_spec_enforcement as typeof vhMode;
  const vpMode = fwConfig.coding?.visual_parity_enforcement as typeof vhMode;
  const mmProbe = resolveContextAdapterImageInput(projectRoot, resolvedFrameworkRoot, fwConfig.agent_adapter);
  // E2：能力钳制——全局阶段（catalog/glossary/docs）不涉及 feature UI，固定 semantic_layout
  // 不钳制；feature 阶段按 mmProbe.supported（视觉能力）+ profile OCR 就绪度钳制 desired→effective，
  // 单点收口：全部 19 处 isPixel1to1/fidelityTarget 消费面只读 context.fidelityTarget（此处赋的
  // 有效档位），零改动自动随能力降级（capture_completeness_external 等 pixel 分支天然降 WARN）。
  const fidelityCtx = phaseIsGlobal
    ? {
        fidelityTarget: 'semantic_layout' as const,
        declaredFidelityTarget: 'semantic_layout' as const,
        fidelityClamped: false,
        fidelityClampReason: undefined as 'no_vision_ocr_available' | 'no_vision_no_ocr' | undefined,
        assetAcquisitionMode: 'approximate' as const,
        effectiveAssetAcquisitionMode: 'approximate' as const,
        fidelityDeferrals: [] as CheckContext['fidelityDeferrals'],
      }
    : resolveEffectiveFidelityContext(resolveFidelityContextFromFeature(projectRoot, feature), {
        hasVision: mmProbe.supported,
        ocrAvailable: resolveOcrAvailableForRun(projectRoot, resolvedProfile.profileDir, fwConfig.agent_adapter),
      });
  const context: CheckContext = {
    phase,
    feature,
    projectRoot,
    phaseRule,
    featureSpec,
    adapter: typeof args.adapter === 'string' ? args.adapter : undefined,
    visualHandoffEnforcement: vhMode,
    uiSpecEnforcement: uiSpecMode,
    visualParityEnforcement: vpMode,
    specVisualSources: fwConfig.spec?.visual_sources,
    docsCommitted: fwConfig.paths.docs_committed ?? false,
    skipVisualHandoff: Boolean(args['skip-visual-handoff']),
    skipUiSpec: Boolean(args['skip-ui-spec']),
    skipVisualParity: Boolean(args['skip-visual-parity']),
    fidelityTarget: fidelityCtx.fidelityTarget,
    declaredFidelityTarget: fidelityCtx.declaredFidelityTarget,
    fidelityClamped: fidelityCtx.fidelityClamped,
    fidelityClampReason: fidelityCtx.fidelityClampReason,
    assetAcquisitionMode: fidelityCtx.assetAcquisitionMode,
    effectiveAssetAcquisitionMode: fidelityCtx.effectiveAssetAcquisitionMode,
    fidelityDeferrals: fidelityCtx.fidelityDeferrals,
    adapterMultimodal: mmProbe.supported,
    adapterImageInput: mmProbe.imageInput,
    frameworkRoot: resolvedFrameworkRoot,
    frameworkRel,
    harnessRoot,
    layoutKind,
    resolvedProfile,
  };

  // 记录本次 harness 运行起点的 commit，供 ut_no_src_mutation 等规则使用
  // （注意：HEAD 是当前已提交状态；UT 阶段未提交的改动会被 git diff 检测到）
  recordStartCommit(harnessRoot, phase, feature, projectRoot, resolvedFrameworkRoot);

  // 阶段状态机：标记 running，供 Stop hook 在 agent 想结束消息时判断
  // "当前是否处于阶段流程中"。harness 跑完后会再次更新 verdict / blocker_count；
  // claimed_done 始终为 false——只有 agent 显式填写完成回执并通过 check-receipt
  // 后才会被 Stop hook 视为闭环。
  mergeAndWritePhaseState(projectRoot, workflowSpec, {
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
  // 防漂移 preflight（c2）：全局框架自检，全模式入口直调，不经 capability-registry / profile。
  checks.push(...runFrameworkIntegrityPreflight({ frameworkRoot: resolvedFrameworkRoot, projectRoot }));
  // P0-7②：进程预加载注入自检（file-drift 对进程注入无感，须独立防线）。
  checks.push(...runProcessIntegrityPreflight({ projectRoot, harnessDir: harnessRoot }));
  checks.push(...(await emitLifecycle('pre_phase')));
  checks.push(...(await emitLifecycle('pre_check', { checkScript: `check-${phase}.ts` })));

  // P0-2（plan d9b4f7e2 复审）：spec-loader 形状留痕升结构化 FAIL——归一化只防崩溃，
  // "modules: {} 被归空后某门禁安静 PASS"属静默洗形状，此处兜底拦截（agent 可修：
  // details 给期望形状与最小样例）。
  if (context.featureSpec.shape_issues?.length) {
    checks.push({
      id: 'feature_spec_shape',
      category: 'structure',
      description: 'contracts/acceptance/use-cases 集合字段与根节点形状合法',
      severity: 'BLOCKER',
      status: 'FAIL',
      details: context.featureSpec.shape_issues.join('\n'),
      suggestion: '按 details 中的最小合法样例修正对应 YAML 字段形状后重跑；这是产物形状问题（agent 可修），非框架缺陷。',
    });
  }

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
  const scriptReport = generateScriptReport(harnessRoot, phase, feature, projectRoot, checks, resolvedFrameworkRoot);
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
    const contextFiles = collectContextFiles(specLoader, layout, phase, feature, featureSpec, {
      adapterMultimodal: context.adapterMultimodal,
      adapterImageInput: context.adapterImageInput,
      specVisualSources: context.specVisualSources,
    });
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
      resolvedFrameworkRoot,
      { imageInput: context.adapterImageInput },
    );
    console.log(`   ✓ AI prompt 已写入 ${reportDirRel}/ai-prompt.md`);
  } catch (err) {
    const e = err as Error;
    console.error(`   ✗ Step 4 组装 AI Harness prompt 失败: ${e.message}`);
    finalReport = failScriptReportWithFatalError(scriptReport, 'assemble_ai_prompt', e, resolvedFrameworkRoot);
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

      generateMergedReport(harnessRoot, projectRoot, phase, feature, scriptReport, aiReportContent, resolvedFrameworkRoot);
      console.log(`   ✓ 合并报告已写入 ${reportDirRel}/merged-report.md`);
    } catch (err) {
      const e = err as Error;
      console.error(`   ✗ Step 5 生成合并报告失败: ${e.message}`);
      finalReport = failScriptReportWithFatalError(scriptReport, 'generate_merged_report', e, resolvedFrameworkRoot);
    }
  }

  // 阶段状态机：脚本 harness 完毕，写入 verdict / blocker_count
  // 并尝试 best-effort 跑一遍 check-receipt：
  //   - 回执存在 → 校验它，把校验结果回填到 state file，给 Stop hook 提供精确判据
  //   - 回执不存在 → state.receipt.status = 'missing'（不报错；此时阶段未闭环）
  // 这样 agent 在 harness 跑完之后，仍必须主动填回执 + 通过 check-receipt
  // 才能把 claimed_done 推到 true（由专门的 markPhaseClaimedDone 流程驱动；
  // 当前版本里，Stop hook 负责拒绝 claimed_done=false 时的 stop）。
  // t2 receipt-slim（openspec receipt-slim）：base→骨架→check（读本次 base）→closure patch。
  // 拆环：旧序 receiptValidation 先于 summary 落盘，check-receipt 直读 summary 时会读到
  // 上次 run 的旧件；现在 base summary（无 receipt 依赖、原子写）先落盘。
  const baseSummary = writeRunSummaryBase(projectRoot, finalReport, resolvedFrameworkRoot);
  if (!phaseIsGlobal) {
    writeReceiptSkeletonIfMissing(projectRoot, feature, phase, finalReport.summary.verdict);
  }
  const receiptValidation = phaseIsGlobal ? null : tryValidateReceipt(harnessRoot, projectRoot, phase, feature);
  mergeAndWritePhaseState(projectRoot, workflowSpec, {
    phase,
    feature,
    status: 'harness_finished',
    last_run_at: new Date().toISOString(),
    verdict: finalReport.summary.verdict,
    blocker_count: finalReport.summary.blockers,
    receipt: receiptValidation,
  });

  const runSummary = patchRunSummaryClosure(projectRoot, finalReport, baseSummary, receiptValidation, resolvedFrameworkRoot);
  if (args.summary || args['failures-only']) {
    printStableSummary(runSummary);
  }

  // review-fix 轮3（codex P2-2）：账本落盘失败在交互态也 fail-closed——ledger 是熔断与
  // 校准的持久化基础，写失败不得以 exit 0 溜走（goal 态另有 summary 消费路径双保险）。
  if (runSummary.visual_round?.disposition === 'append_failed') {
    console.error('\n  ❌ 视觉轮次账本落盘失败（append_failed）——本轮评估未持久化，按失败退出（修复磁盘/权限后重跑）。');
    process.exit(1);
  }

  // 最终结果
  console.log('\n' + '='.repeat(60));
  if (finalReport.summary.verdict === 'PASS') {
    console.log('  ✅ 脚本 Harness 检查通过');
    console.log('  📤 请将 ai-prompt.md 发送给 AI 模型执行语义验证');
  } else if (finalReport.summary.verdict === 'INCOMPLETE') {
    console.log('  ⚠️  脚本 Harness 部分就绪（INCOMPLETE）');
    console.log('  📱 编译已通过但真机/模拟器不可用；修复设备环境后重跑 UT');
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

/**
 * t1（plan f7a3d9c2）：消费 check 的 visual_diff 结构化 payload——runner 侧追加轮次账本
 * （check 只读判定、runner 写：账本与判定文件的红线切分），并生成 summary.visual_round
 * 回执（goal-runner 写入 events.jsonl 做 integrity 对账）。
 * disposition=duplicate：不追加，但**同样回传重放后的 decision**（rev5：agent 自跑首检
 * fuse 后，外层 gate 必须仍能看到 no_progress_fuse）。
 */
function consumeVisualRoundPayload(
  projectRoot: string,
  report: ScriptReport,
): HarnessRunSummary['visual_round'] | undefined {
  for (const c of report.checks) {
    const s = c.structured as { kind?: string; round?: VisualRoundEvaluation } | undefined;
    if (!s || s.kind !== 'visual_diff' || !s.round) continue;
    // review-fix（codex P1-2）：commitVisualRound 落盘失败返回 disposition=append_failed
    // （无 row_hash）——如实进 summary，goal-runner 据此 fail-closed halt；绝不在写失败后
    // 仍宣称 appended（末轮无下次对账兜底）。
    const receipt = commitVisualRound(visualRoundsLedgerPath(projectRoot, report.feature), s.round);
    if (receipt.disposition === 'append_failed') {
      console.warn('   ⚠ [visual-rounds] 账本追加失败——已按 append_failed 上报（goal 态将 fail-closed halt）');
    }
    return receipt;
  }
  return undefined;
}

/**
 * t2 receipt-slim（plan e6a3c9f4 / openspec receipt-slim）：base summary——**无 receipt 依赖**、
 * 完整 schema-valid、原子写。closure 字段以"未闭环/等待 receipt"初值填充，由后续
 * patchRunSummaryClosure 定稿；进程中途崩溃不会留下非法 JSON 或残留旧 closed 态。
 */
function writeRunSummaryBase(
  projectRoot: string,
  report: ScriptReport,
  frameworkRoot: string,
): HarnessRunSummary {
  const dir = featurePhaseReportsDir(projectRoot, report.feature, report.phase, frameworkRoot);
  const rel = (name: string): string => path.relative(projectRoot, path.join(dir, name)).replace(/\\/g, '/');
  // review#3：blocker 映射抽至 buildSummaryBlockers（可测纯函数），保真传 c.blocking_class（如 device_toolchain）。
  const blockers = buildSummaryBlockers(report.checks, excerpt, extractFailureClassification);
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
      ...(c.source ? { source: c.source } : {}),
    }));
  const blockingSkips = report.checks
    .filter(c => c.status === 'SKIP' && c.severity === 'BLOCKER')
    .map(c => ({
      id: c.id,
      blocking_class: c.blocking_class,
      details_excerpt: excerpt(c.details, 500),
      suggestion: c.suggestion,
      ...(c.source ? { source: c.source } : {}),
    }));
  const utStatus = runStatuses.find(c => c.id === 'ut_run_status')?.details;
  const readinessSignals = buildReadinessSignals(report);
  // 回执 stale 治理：机器写入门禁集指纹（agent 零参与）；check-receipt 消费时重算比对，
  // framework 门禁集升级后旧 summary/回执即失效（round6 Checkpoint-2：旧 spec 回执整体豁免 P0-D 的洞）。
  const gateFingerprint = computeGateFingerprint(frameworkRoot, report.phase);
  // t1（f7a3d9c2）：runner 侧追加视觉轮次账本 + 回执（在 summary 落盘前完成，保证
  // summary.visual_round 与账本一致）。
  const visualRound = consumeVisualRoundPayload(projectRoot, report);
  const summary: HarnessRunSummary = {
    schema_version: '1.0',
    phase: report.phase,
    feature: report.feature,
    verdict: report.summary.verdict,
    blocker_count: report.summary.blockers,
    fail_count: report.summary.fail,
    warn_count: report.summary.warn,
    ...(gateFingerprint ? { gate_fingerprint: gateFingerprint } : {}),
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
    // base 初值：未闭环/等待 receipt——closure 定稿归 patchRunSummaryClosure。
    next_action: decideNextAction(report, blockers, runStatuses, blockingSkips, readinessSignals),
    closure_status: 'open',
    // t2 v2（codex BLOCKER3）：run identity——slim 回执三方绑定的机器锚（同版本 framework 下
    // 旧 PASS 件复用被 sha 失配拒绝）。
    generated_at: new Date().toISOString(),
    ...(resolveGitHeadSha(projectRoot) ? { source_commit_sha: resolveGitHeadSha(projectRoot)! } : {}),
    // t2 v3（codex 阻断3）：dirty worktree 绑定——层目录 tracked diff+untracked 摘要，
    // HEAD 不动但源码已改时旧 PASS 件同样失效。
    worktree_digest: computeProductWorktreeDigest(
      projectRoot,
      (loadFrameworkConfig(projectRoot).architecture?.outer_layers ?? []).map(l => l.id),
    ),
    ...(process.env.MAISON_GOAL_RUN_ID?.trim() ? { run_id: process.env.MAISON_GOAL_RUN_ID.trim() } : {}),
    ...(visualRound ? { visual_round: visualRound } : {}),
  };
  const compileFirstError = extractCompileFirstError(report);
  if (compileFirstError) {
    summary.compile_first_error = compileFirstError;
  }
  atomicWriteJson(path.join(dir, 'summary.json'), summary);
  return summary;
}

/**
 * t2 receipt-slim：瘦身回执骨架——仅 verdict=PASS 且回执缺失时幂等生成（FAIL 跑不留半真骨架）；
 * lite track 豁免（receipt 机制 not_applicable）。骨架自证字段占位、反假设 checkbox 全未勾，
 * 不构成闭环；生成失败不阻断门禁（best-effort，agent 可自行从模板复制）。
 */
function writeReceiptSkeletonIfMissing(
  projectRoot: string,
  feature: string,
  phase: Phase,
  verdict: string,
): void {
  try {
    if (verdict !== 'PASS') return;
    if (resolveFeatureTrack(loadFeatureTrackDecl(projectRoot, feature)) === 'lite') return;
    const receiptPath = resolveReceiptFilePath(projectRoot, feature, phase).path;
    if (fs.existsSync(receiptPath)) return;
    const templatePath = path.join(__dirname, 'templates', 'phase-completion-receipt.md');
    if (!fs.existsSync(templatePath)) return;
    const skeleton = fs
      .readFileSync(templatePath, 'utf-8')
      .replace('feature: "<feature-name>"', `feature: "${feature}"`)
      .replace('phase: "<spec | plan | coding | review | ut | testing>"', `phase: "${phase}"`);
    fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
    fs.writeFileSync(receiptPath, skeleton, 'utf-8');
    console.log(
      `   ✓ 已生成瘦身回执骨架（PASS-gated）：${path.relative(projectRoot, receiptPath).replace(/\\/g, '/')}` +
        '——自证字段待真实填写、反假设 checkbox 待勾选，骨架不构成闭环。',
    );
  } catch {
    /* best-effort：骨架失败不阻断，agent 仍可全手填 */
  }
}

/** 当前 git HEAD（best-effort；非 git 环境返回 null）——run identity 锚。 */
let cachedHeadSha: string | null | undefined;
function resolveGitHeadSha(projectRoot: string): string | null {
  if (cachedHeadSha !== undefined) return cachedHeadSha;
  try {
    const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, encoding: 'utf-8', shell: false });
    cachedHeadSha = r.status === 0 ? r.stdout.trim() : null;
  } catch {
    cachedHeadSha = null;
  }
  return cachedHeadSha;
}

/** 原子写 JSON（tmp+rename）——崩溃不留半截文件。 */
function atomicWriteJson(absPath: string, value: unknown): void {
  const tmp = `${absPath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf-8');
  fs.renameSync(tmp, absPath);
}

/**
 * t2 receipt-slim：closure patch——只定稿 receipt_status/closure_status/next_action 三字段。
 * check-receipt 独立 CLI 通过时由 applyClosurePatchFromReceiptValidation 定稿（含 manifest 封装序）；
 * 本函数负责 harness 在跑（in-run best-effort 校验）后的同义收敛：写入值与 check-receipt
 * PASS 路径一致（byte-stable），不会使已生成的 evidence-manifest 哈希失效。
 */
function patchRunSummaryClosure(
  projectRoot: string,
  report: ScriptReport,
  base: HarnessRunSummary,
  receiptValidation: ReturnType<typeof tryValidateReceipt> | null,
  frameworkRoot: string,
): HarnessRunSummary {
  // C2：closure 来源按 track 分派——lite 的 receipt 恒 not_applicable，闭环判据改用
  // 该 phase 自身脚本 verdict（如 exit 的 script-report PASS），不再被误判为"未闭环"。
  const closureTrack = resolveFeatureTrack(loadFeatureTrackDecl(projectRoot, report.feature));
  const closed =
    resolvePhaseClosureSource(closureTrack, report.summary.verdict, receiptValidation?.status) !== 'open';
  const patched: HarnessRunSummary = {
    ...base,
    next_action: closed ? 'phase_closed_wait_user' : base.next_action,
    receipt_status: receiptValidation?.status,
    closure_status: closed ? 'closed' : 'open',
  };
  const dir = featurePhaseReportsDir(projectRoot, report.feature, report.phase, frameworkRoot);
  atomicWriteJson(path.join(dir, 'summary.json'), patched);
  return patched;
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
  if (summary.closure_status) {
    console.log(`closure_status=${summary.closure_status}`);
  }
  if (summary.compile_first_error) {
    const e = summary.compile_first_error;
    const loc = e.file ? `${e.file}${e.line != null ? ':' + e.line : ''}` : '(no file)';
    console.log(`compile_first_error=${loc} — ${e.message}${e.kind ? ` [${e.kind}]` : ''}`);
  }
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
  // codex P2：readiness_signals 此前只写 summary.json、从不打印——PASS 场景下的"值得单独提醒"
  // 信号（如 fidelity_capability_clamped）用户永远看不到。通用打印，非仅本次改动的信号受益。
  if (summary.readiness_signals.length > 0) {
    console.log('readiness_signals:');
    for (const s of summary.readiness_signals) {
      console.log(`  - ${s.id} [${s.status}]: ${s.message}`);
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
  if (report.summary.verdict === 'INCOMPLETE') {
    return report.phase === 'testing' ? 'device_ready_then_rerun_testing' : 'device_ready_then_rerun_ut';
  }
  if (blockers.some(b => b.classification === 'install_downgrade_self_healable' || b.details_excerpt.includes('selfHealable'))) {
    return 'set_HARNESS_DEVICE_TEST_UNINSTALL_BEFORE_INSTALL_then_rerun';
  }
  if (blockers.some(b => b.classification === 'install_needs_confirmation' || b.details_excerpt.includes('needsConfirmation'))) {
    return 'confirm_install_action_then_rerun_ut';
  }
  if (blockers.some(b => b.classification === 'stale_diff_base' || b.details_excerpt.includes('stale_diff_base'))) {
    return 'rerun_with_HARNESS_DIFF_BASE_REF_working';
  }
  if (blockers.some(b => b.classification === 'project_dependency_install_failed')) {
    return 'resolve_dependency_install_blocker_then_rerun';
  }
  if (blockers.some(b => b.classification === 'project_dependency_undeclared')) {
    return 'declare_dependencies_then_rerun';
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

const CODING_COMPILE_CHECK_IDS = new Set(['coding_compile', 'coding_hvigor_build']);

function extractCompileFirstError(report: ScriptReport): HarnessRunSummary['compile_first_error'] | undefined {
  if (report.phase !== 'coding') return undefined;
  const compileCheck = report.checks.find(
    c => CODING_COMPILE_CHECK_IDS.has(c.id) && c.status === 'FAIL',
  );
  if (!compileCheck) return undefined;

  const details = compileCheck.details ?? '';
  const kind = compileCheck.failure_kind ?? extractFailureClassification(details);

  const parsedLine = details.match(/^\s*-\s+(\S+?):(\d+)\s{2,}\S*\s{2,}(.+)$/m);
  if (parsedLine) {
    return {
      file: parsedLine[1].trim(),
      line: Number(parsedLine[2]),
      message: parsedLine[3].trim(),
      kind,
    };
  }

  const atFile = details.match(/At File:\s*([^\r\n]+?):(\d+)(?::\d+)?/i);
  const errMsg = details.match(/Error Message:\s*([^\r\n]+)/i);
  if (atFile || errMsg) {
    return {
      file: atFile?.[1]?.trim(),
      line: atFile ? Number(atFile[2]) : undefined,
      message: (errMsg?.[1] ?? '编译失败，详见完整日志').trim(),
      kind,
    };
  }

  const cannotFind = details.match(/Cannot find module\s+['"]([^'"]+)['"]/);
  if (cannotFind) {
    return {
      message: `Cannot find module '${cannotFind[1]}'`,
      kind: kind ?? 'project_dependency_missing',
    };
  }

  if (kind) {
    return { message: compileCheck.suggestion ?? 'coding_compile 失败，详见 script-report', kind };
  }
  return undefined;
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

  // E2 P2（codex review）：钳制事实此前只落在 fidelity_target_declared 这个 PASS check 的
  // details 里——summary.json 不收 PASS check，goal run 全绿时用户/runner 看不到降级发生过。
  // readiness_signals 是本文件既有的"PASS 但值得单独提醒"通道，接进来即最小成本获得可见性。
  const fidelityDeclared = report.checks.find(c => c.id === 'fidelity_target_declared');
  if (fidelityDeclared?.status === 'PASS' && fidelityDeclared.details.includes('能力钳制')) {
    signals.push({
      id: 'fidelity_capability_clamped',
      status: 'ready',
      source_check: 'fidelity_target_declared',
      message: fidelityDeclared.details,
    });
  }

  if (report.phase === 'ut') {
    const test = report.checks.find(c => c.id === 'ut_hvigor_test');
    const build = report.checks.find(c => c.id === 'ut_hvigor_build');
    if (
      build?.status === 'PASS' &&
      test?.status === 'FAIL' &&
      (test.blocking_class === 'externalBlocked' || test.failure_kind === 'device_blocked')
    ) {
      signals.push({
        id: 'compile_passed_device_blocked',
        status: 'incomplete',
        source_check: 'ut_hvigor_test',
        message:
          '宿主测试模块编译已通过，但真机/模拟器不可用；summary.verdict=INCOMPLETE，不视为 UT 阶段完成。',
      });
    }
  }

  if (report.phase === 'testing') {
    const install = report.checks.find(c => c.id === 'device_test_install');
    const build = report.checks.find(c => c.id === 'device_test_build');
    if (
      build?.status === 'PASS' &&
      install?.status === 'FAIL' &&
      (install.blocking_class === 'externalBlocked' || install.failure_kind === 'device_blocked')
    ) {
      signals.push({
        id: 'compile_passed_device_blocked',
        status: 'incomplete',
        source_check: 'device_test_install',
        message:
          '主应用 HAP 已就绪，但真机/模拟器不可用；summary.verdict=INCOMPLETE，不视为 testing 阶段完成。',
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
    try {
      const hdc = require('./scripts/utils/hdc-runner') as {
        resetHdcUsed?: () => void;
      };
      hdc.resetHdcUsed?.();
    } catch {
      /* non-hmos profile — no hdc shim */
    }

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
  } finally {
    try {
      const hdc = require('./scripts/utils/hdc-runner') as {
        killHdcServerIfUsed?: (projectRoot?: string) => {
          used: boolean;
          attempted: boolean;
          ok: boolean;
          exitCode: number | null;
          error: string | null;
          policy: { source: string; shouldKill: boolean };
          skipped_reason?: string;
        };
        writeHdcCleanupArtifact?: (
          reportsDir: string,
          cleanup: {
            used: boolean;
            attempted: boolean;
            ok: boolean;
            exitCode: number | null;
            error: string | null;
            policy: { source: string; shouldKill: boolean };
            skipped_reason?: string;
          },
        ) => string | null;
      };
      const cleanup = hdc.killHdcServerIfUsed?.(context.projectRoot);
      if (cleanup && (cleanup.used || cleanup.attempted)) {
        const reportsDir = featurePhaseReportsDir(
          context.projectRoot,
          context.feature,
          context.phase,
          context.frameworkRoot,
        );
        const artifact = hdc.writeHdcCleanupArtifact?.(reportsDir, cleanup);
        const skip = cleanup.skipped_reason ? ` skipped=${cleanup.skipped_reason}` : '';
        const artifactRel = artifact
          ? path.relative(context.projectRoot, artifact).replace(/\\/g, '/')
          : 'write_failed';
        console.log(
          `   hdc daemon cleanup: kill_attempted=${cleanup.attempted} ok=${cleanup.ok} policy_source=${cleanup.policy.source}${skip} artifact=${artifactRel}`,
        );
      }
    } catch {
      /* non-hmos profile */
    }
  }
}

function printFeatureArtifactInspection(
  projectRoot: string,
  inspection: FeatureArtifactInspection,
  featuresRel: string,
): void {
  console.log(`   Feature 目录: ${featuresRel}/${inspection.feature}/ (${inspection.pathKind})`);
  if (inspection.sameNameArchives.length > 0) {
    console.log(`   同名归档旁证: ${inspection.sameNameArchives.join(', ')}（已忽略，正式 feature 只认目录）`);
  }
  if (inspection.relatedSiblingEntries.length > 0) {
    console.log(`   同名前缀旁证: ${inspection.relatedSiblingEntries.join(', ')}（不作为精确 feature）`);
  }
  if (inspection.requiredFiles.length > 0) {
    if (inspection.missingRequiredFiles.length === 0) {
      const present = inspection.requiredFiles.filter(
        (f) => !inspection.missingRequiredFiles.includes(f),
      );
      if (present.length > 0 && inspection.pathKind === 'directory') {
        console.log(`   阶段必需文件均已解析到：`);
        for (const file of present) {
          const r = resolveFeatureArtifact(projectRoot, inspection.feature, file);
          const relActual = path.relative(projectRoot, r.actualPath).replace(/\\/g, '/');
          const relCanon = relFeatureArtifact(projectRoot, inspection.feature, file);
          if (r.legacyDuplicate) {
            console.log(`     - ${file}: ⚠ canonical 与 legacy 双份（读 ${relActual}）`);
          } else if (r.usedLegacy) {
            console.log(`     - ${file}: 兼容旧路径 ${relActual}（建议迁至 ${relCanon}）`);
          } else {
            console.log(`     - ${file}: ${relActual}`);
          }
        }
      } else {
        console.log(`   阶段必需文件: ${inspection.requiredFiles.join(', ')} 均存在`);
      }
    } else {
      console.log(`   阶段必需文件缺失: ${inspection.missingRequiredFiles.join(', ')}`);
      const found = inspection.requiredFiles.filter((f) => !inspection.missingRequiredFiles.includes(f));
      if (found.length > 0 && inspection.pathKind === 'directory') {
        for (const file of found) {
          const r = resolveFeatureArtifact(projectRoot, inspection.feature, file);
          if (!r.exists) continue;
          const relActual = path.relative(projectRoot, r.actualPath).replace(/\\/g, '/');
          const suffix = r.usedLegacy ? '（兼容旧路径）' : r.legacyDuplicate ? '（双份并存）' : '';
          console.log(`     已命中: ${file} → ${relActual}${suffix}`);
        }
      }
    }
  }
}

function featureArtifactBlocker(
  projectRoot: string,
  inspection: FeatureArtifactInspection,
  frameworkRoot?: string,
): CheckResult {
  const featuresRel = path.relative(projectRoot, resolvePaths(projectRoot, frameworkRoot).featuresDir).replace(/\\/g, '/');
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
    description: `Feature 输入必须解析为 ${featuresRel}/<feature>/ 精确目录`,
    severity: 'BLOCKER',
    status: 'FAIL',
    details: `无法把 feature="${inspection.feature}" 解析为正式目录：${relPath}/，当前路径类型为 ${inspection.pathKind}。${archiveHint}${siblingHint}`,
    affected_files: [relPath],
    suggestion: `请确认 feature 名称，或先把需求产物恢复为 ${featuresRel}/<feature>/ 目录后再运行 harness。`,
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
  frameworkRoot: string,
): void {
  const dir = featurePhaseReportsDir(projectRoot, feature, phase, frameworkRoot);
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
  layout: RepoLayout,
  phase: Phase,
  feature: string,
  featureSpec: import('./scripts/utils/types').FeatureSpec,
  opts?: {
    adapterMultimodal?: boolean;
    adapterImageInput?: 'none' | 'tool_read' | 'native_attach';
    specVisualSources?: CheckContext['specVisualSources'];
  },
): import('./scripts/utils/types').ContextFileEntry[] {
  const { projectRoot } = layout;
  const files: import('./scripts/utils/types').ContextFileEntry[] = [];

  // catalog/glossary 是全局阶段：上下文只包含两份 SSOT 文件本身，
  // 不读任何 feature 维度的 spec.md / plan.md / 源码。
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
    const inventoryPath = frameworkAbs(layout, 'docs', 'DOC_INVENTORY.yaml');
    const inventoryLabel = frameworkLogicalRelPath('docs', 'DOC_INVENTORY.yaml');
    if (fs.existsSync(inventoryPath)) {
      files.push({
        label: inventoryLabel,
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

  const prd = specLoader.loadFeatureDoc(projectRoot, feature, 'spec.md');
  if (prd) {
    files.push({ label: relFeatureArtifact(projectRoot, feature, 'spec.md'), content: prd });
  }

  const uiSpecPath = uiSpecAbsPath(projectRoot, feature);
  if (fs.existsSync(uiSpecPath)) {
    files.push({
      label: uiSpecRelPath(projectRoot, feature),
      content: fs.readFileSync(uiSpecPath, 'utf-8'),
    });
  }

  const uiChange = prd ? parseUiChangeFromSpecMarkdown(prd) : null;
  const wantsVisualContext =
    ['spec', 'coding', 'review'].includes(phase) &&
    uiChange !== null &&
    UI_CHANGE_REQUIRES_UI_SPEC.has(uiChange);

  if (wantsVisualContext) {
    const imageInput = opts?.adapterImageInput ?? (opts?.adapterMultimodal === false ? 'none' : 'tool_read');
    if (imageInput === 'none') {
      files.push({
        label: '(multimodal-degraded)',
        kind: 'text',
        content:
          '视觉多模态层已降级：adapter image_input=none；仅文本 ui-spec + 确定性 parity 生效。',
      });
    } else if (prd) {
      const imgPaths = collectAuthoritativeImagePaths(projectRoot, prd, (p) => {
        const r = resolveAuthoritativePath(p, {
          projectRoot,
          externalRoots: opts?.specVisualSources?.external_roots,
          allowAbsolutePaths: Boolean(opts?.specVisualSources?.allow_absolute_paths),
          allowNetworkPaths: Boolean(opts?.specVisualSources?.allow_network_paths),
        });
        return r.agentReachable ? r.resolvedAbsolute ?? null : null;
      });
      for (const img of imgPaths.slice(0, 8)) {
        const ext = path.extname(img).toLowerCase();
        const mime =
          ext === '.png' ? 'image/png' :
          ext === '.webp' ? 'image/webp' :
          ext === '.gif' ? 'image/gif' :
          'image/jpeg';
        files.push({
          label: path.relative(projectRoot, img).replace(/\\/g, '/'),
          kind: 'image',
          mime,
          imagePath: img,
          content: '权威视觉参考图（sidecar 副本；VL verifier 须读 reports/.../context-images/）',
        });
      }
      if (imgPaths.length === 0) {
        files.push({
          label: '(multimodal-no-images)',
          kind: 'text',
          content:
            'ui_change 需要 ui-spec，但未解析到 reachable 的 authoritative_ref 图片；多模态对照不可用。',
        });
      }
    }
  }

  if (['plan', 'coding', 'review', 'ut', 'testing'].includes(phase)) {
    const design = specLoader.loadFeatureDoc(projectRoot, feature, 'plan.md');
    if (design) {
      files.push({ label: relFeatureArtifact(projectRoot, feature, 'plan.md'), content: design });
    }
  }

  if (phase === 'plan') {
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
      files.push({ label: relFeatureArtifact(projectRoot, feature, 'review-report.md'), content: reviewReport });
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
      files.push({ label: relFeatureArtifact(projectRoot, feature, 'test-plan.md'), content: testPlan });
    }

    const testReport = specLoader.loadFeatureDoc(projectRoot, feature, 'test-report.md');
    if (testReport) {
      files.push({ label: relFeatureArtifact(projectRoot, feature, 'test-report.md'), content: testReport });
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
// 阶段状态机 — 见 scripts/utils/phase-state.ts（check-receipt / harness-runner 共用）
// --------------------------------------------------------------------------

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
  // C5-full：Stop hook 的 correction 联动（hard_hook 深度集成）没有独立逃生阀，
  // --clear-state 是既有"明确放弃"出口——一并清理未收口的 correction state，
  // 避免用户已放弃阶段却仍被残留的 pending correction 拦截 stop。
  const correctionAbs = correctionStatePath(projectRoot);
  const correctionRel = path.relative(projectRoot, correctionAbs).replace(/\\/g, '/');
  if (fs.existsSync(correctionAbs)) {
    try {
      fs.unlinkSync(correctionAbs);
      console.log(`✓ 已删除修正状态文件 ${correctionRel}`);
    } catch (err) {
      console.error(`✗ 删除 ${correctionRel} 失败: ${(err as Error).message}`);
    }
  }
  console.log('');
  console.log('提示：');
  console.log(`  - 历史 verdict / 报告通常在 ${relFeaturesDir(projectRoot)}/<feature>/<phase>/reports/（配置了 reports_dir_pattern 时），回执仍在 ${relFeaturesDir(projectRoot)} 下；`);
  console.log('  - 如需重新进入该阶段，按对应 SKILL.md 重新执行 harness-runner.ts；');
  console.log('  - --clear-state 表示"放弃已有进度"，与"暂停"不同。');
  console.log('  - --sync-closure 仅对齐闭环态（check-receipt + state），不重跑脚本 harness。');
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
