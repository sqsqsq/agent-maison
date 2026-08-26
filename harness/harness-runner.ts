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

import * as crypto from 'crypto';
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
import {
  applyAssetAxisInheritance,
  deriveSummaryVerdictLattice,
  projectCompletionStatus,
  projectReleaseReadiness,
  resolveEffectiveVerdict,
  validateSummaryV11,
} from './scripts/utils/quality-axes';
import { createHash } from 'crypto';
import { receiptDirPath } from './config';
import {
  annotateAssetTriState,
  applyVisualAcceptance,
  assetDomainDebtRevision,
  countBlockingDebt,
  deriveVisualDebt,
  loadVisualDebtEx,
  validateRubricPolicy,
  writeVisualDebt,
  type VisualAcceptancePayload,
} from './scripts/utils/visual-debt';
import {
  defaultTrustRegistryPath,
  validateConfirmationReceiptFile,
} from './scripts/utils/confirmation-receipt';
import { computeGateFingerprint } from './scripts/utils/gate-fingerprint';
import {
  commitVisualRound,
  visualRoundsLedgerPath,
  type VisualRoundEvaluation,
} from './scripts/utils/visual-rounds-ledger';
import {
  appendJournalProposal,
  intermediateRoundsJournalPath,
} from './scripts/utils/intermediate-rounds-journal';
import { runFrameworkIntegrityPreflight } from './scripts/utils/framework-integrity';
import { deleteEnvKeyCaseInsensitive, runProcessIntegrityPreflight } from './scripts/utils/process-integrity';
import { validateAttendedGoalContext } from './scripts/utils/attended-goal-context';
import {
  resolveFidelityContextFromFeature,
  resolveEffectiveFidelityContext,
  resolveOcrAvailableForRun,
  loadFidelityIntentSsot,
  loadCapabilitySnapshot,
  deriveEffectiveAdapterImageInput,
  effectiveAssetAcquisitionMode,
} from './scripts/utils/fidelity-shared';
import { reviewVisionForMode } from './scripts/utils/visual-provider-identity';
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
import { buildSummaryRepairCandidates } from './scripts/utils/repair-candidates';
import { evaluateConfigPlacementGate } from './scripts/utils/config-placement-gate';
import { resolvePhasePersonalPrerequisites } from './scripts/utils/phase-personal-prerequisites';
import { runCapabilityPreflight, emitHarnessPreflightGap } from './scripts/utils/capability-preflight';
import {
  applyFrozenDeviceEnv,
  buildTestingTargetKindCap,
  runPhaseEntryDeviceGate,
} from './scripts/utils/device-readiness-gate';
import { phaseRequiresDevice } from './scripts/utils/phase-device-requirement';
import {
  defaultProcessProbe,
  reclaimManagedDevice,
  registerManagedDeviceCleanup,
} from './scripts/utils/device-session';
import { computeProductWorktreeDigest } from './scripts/utils/worktree-digest';
import {
  isAgentSideGoalHarness,
  isGoalOrchestrationEnv,
  MAISON_GOAL_RUNNER_ENV,
  MAISON_GOAL_MODEL_PIN_ENV,
  mergeAndWritePhaseState,
  syncPhaseStateOnReceiptPassStrict,
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
import { resolveCapabilityResolutionEntryInput } from './scripts/utils/capability-resolution-entry-input';
import { finalizePhaseClosure } from './scripts/utils/phase-closure-finalizer';
import {
  assertCapabilityConsumption,
  capabilityResolutionChecks,
  collectBlockedCapabilityFacts,
  resolveCapabilityReport,
  type CapabilityResolutionReport,
} from './scripts/utils/capability-resolution';
import { assessAndRenderNextStep } from './scripts/utils/assess-renderer';
import {
  dispatchLifecycleHooks,
  type HookDispatchPayload,
  type HookEventName,
} from './hooks-dispatcher';
import * as YAML from 'yaml';
import { detectRepoLayout, frameworkAbs, frameworkRelPath, frameworkLogicalRelPath, inferRepoLayout, type RepoLayout } from './repo-layout';
import { probeAdapterImageInput, collectAuthoritativeImagePaths, resolveContextAdapterImageInput } from './scripts/utils/multimodal-probe';
import { resolveEffectiveVisionContext } from './scripts/utils/effective-vision-context';
import { writeReceiptScaffold } from './scripts/utils/receipt-scaffold';

/** capability-snapshot 缺失时的当前执行能力回落；产物文件不参与判定。 */
function resolveCurrentVisualForHarness(projectRoot: string, feature: string): boolean {
  try {
    const goalRunId = process.env.MAISON_GOAL_RUN_ID?.trim();
    const modelPin = process.env[MAISON_GOAL_MODEL_PIN_ENV]?.trim();
    const vctx = resolveEffectiveVisionContext({
      projectRoot,
      feature,
      ...(goalRunId ? { runId: goalRunId } : {}),
      ...(modelPin ? { modelPin } : {}),
    });
    return vctx.vision_capability.verdict === 'tool_read' || vctx.vision_capability.verdict === 'native';
  } catch {
    return false;
  }
}
import { resolveAuthoritativePath } from './scripts/utils/visual-source-resolver';
import { parseUiChangeFromSpecMarkdown, UI_CHANGE_REQUIRES_UI_SPEC, uiSpecRelPath, uiSpecAbsPath } from './scripts/utils/ui-spec-shared';

// --------------------------------------------------------------------------
// CLI 参数解析
// --------------------------------------------------------------------------

const args = minimist(process.argv.slice(2), {
  string: [
    'phase', 'feature', 'ai-report', 'adapter', 'workflow', 'adhoc-cases', 'correction-request',
    'q-requirement', 'q-contract', 'q-code', 'goal-run-id', 'goal-attempt-id',
    'goal-owner-id', 'goal-owner-epoch',
  ],
  boolean: ['list', 'help', 'verbose', 'clear-state', 'sync-closure', 'summary', 'failures-only', 'skip-visual-handoff', 'skip-ui-spec', 'skip-visual-parity', 'correction-init', 'correction-check', 'adhoc-correction'],
  alias: {
    p: 'phase',
    f: 'feature',
    l: 'list',
    h: 'help',
    v: 'verbose',
  },
});

export function bindAttendedGoalContext(input: {
  projectRoot: string;
  feature?: string;
  phase?: string;
  goalRunId?: string;
  goalAttemptId?: string;
  goalOwnerId?: string;
  goalOwnerEpoch?: string | number;
  env?: NodeJS.ProcessEnv;
}): { bound: boolean; runId?: string; attemptId?: string; ownerId?: string; ownerEpoch?: number } {
  const extraContextPresent =
    input.goalAttemptId !== undefined || input.goalOwnerId !== undefined || input.goalOwnerEpoch !== undefined;
  if (input.goalRunId === undefined) {
    if (extraContextPresent) throw new Error('attended goal 上下文缺 --goal-run-id');
    return { bound: false };
  }
  const runId = input.goalRunId.trim();
  if (!runId) throw new Error('--goal-run-id 显式给出时不能为空');
  const attemptId = input.goalAttemptId?.trim() ?? '';
  const ownerId = input.goalOwnerId?.trim() ?? '';
  const ownerEpoch = Number(input.goalOwnerEpoch);
  const context = validateAttendedGoalContext({
    projectRoot: input.projectRoot,
    feature: input.feature?.trim() ?? '',
    runId,
    phase: input.phase?.trim() ?? '',
    attemptId,
    ownerId,
    ownerEpoch,
  });
  const env = input.env ?? process.env;
  deleteEnvKeyCaseInsensitive(env, 'MAISON_GOAL_RUN_ID');
  deleteEnvKeyCaseInsensitive(env, MAISON_GOAL_RUNNER_ENV);
  deleteEnvKeyCaseInsensitive(env, 'MAISON_GOAL_ATTEMPT');
  deleteEnvKeyCaseInsensitive(env, 'MAISON_GOAL_ATTEMPT_PHASE');
  deleteEnvKeyCaseInsensitive(env, 'MAISON_GOAL_GATE_HARNESS');
  env.MAISON_GOAL_RUN_ID = runId;
  env[MAISON_GOAL_RUNNER_ENV] = '1';
  env.MAISON_GOAL_ATTEMPT = attemptId;
  env.MAISON_GOAL_ATTEMPT_PHASE = context.identity.phase;
  env.MAISON_GOAL_GATE_HARNESS = '1';
  return { bound: true, runId, attemptId, ownerId, ownerEpoch };
}

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
  --goal-run-id <run_id>    attended phase context；须与下面三项成组传入
  --goal-attempt-id <id>    attended attempt identity（来自 phase_execute_request）
  --goal-owner-id <id>      attended fenced session owner identity
  --goal-owner-epoch <n>    attended fenced session owner epoch
  -l, --list                列出可用的 Spec 文件
  -v, --verbose             展开全部检查项（默认控制台只打印 FAIL/WARN）
  --ai-report <path>        指定 AI Harness 报告文件路径，合并到最终报告
  --adhoc-cases <text>      normalized fallback cases when testing has no acceptance.yaml
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
  try {
    bindAttendedGoalContext({
      projectRoot,
      feature: typeof args.feature === 'string' ? args.feature : undefined,
      phase: typeof args.phase === 'string' ? args.phase : undefined,
      goalRunId: Object.prototype.hasOwnProperty.call(args, 'goal-run-id')
        ? String(args['goal-run-id'])
        : undefined,
      goalAttemptId: Object.prototype.hasOwnProperty.call(args, 'goal-attempt-id')
        ? String(args['goal-attempt-id'])
        : undefined,
      goalOwnerId: Object.prototype.hasOwnProperty.call(args, 'goal-owner-id')
        ? String(args['goal-owner-id'])
        : undefined,
      goalOwnerEpoch: Object.prototype.hasOwnProperty.call(args, 'goal-owner-epoch')
        ? String(args['goal-owner-epoch'])
        : undefined,
    });
  } catch (error) {
    console.error(`[harness] BLOCKER: ${(error as Error).message}`);
    process.exit(1);
  }
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

  // ==========================================================================
  // 普通模式设备前置（b3f7d9a2 t2）——排在 Step 2 之前，即**任何设备操作之前**
  //
  // 事故（2026-08-17 宿主）：普通模式 UT 撞上锁屏，自动解锁链从未启动。两条根因都在
  // 这里收口：① 解锁链的目标解析只认 `HARNESS_HDC_TARGET`，而普通模式没人注入它，
  // hdc 却隐式选唯一在线设备 → 解锁链"不知道对哪台动手"整体跳过；② 普通模式的
  // `device-policy --check` + 四选一只有 SKILL 文档约束，无进程级门。
  //
  // 与 goal 侧共用**同一就绪核心**（ensureDeviceReady），此处只做出口翻译：
  // 未通过 = 前脚本 fail-fast（打印 guidance + 非零退出，**不调用任何 checker/provider**）。
  // 通过则把解析到的目标经 deviceEnvFor 注入本进程 env，后续 wake/解锁/bm dump/
  // install/aa test 全链经 hdcTargetPrefix 共用同一 serial（目标只解析一次）。
  //
  // 写 process.env 与 deviceEnvFor 头注"不写全局 process.env"不冲突：那条约束防的是
  // **长驻的 goal-runner** 跨 phase/run 串 target；此处进程生命周期**就是**单个 phase。
  // ==========================================================================
  /**
   * 模拟器/未知目标的 testing 结论封顶（Step 2 之后与其它 CheckResult 一并入账）。
   * 在门这里生成、稍后 push——目标分类只有门知道，而 checks 数组要到 Step 2 才存在。
   */
  let deviceConclusionCap: CheckResult | undefined;
  if (phaseRequiresDevice(phase, resolvedProfile)) {
    {
      let gate;
      try {
        gate = await runPhaseEntryDeviceGate({ projectRoot, phase });
      } catch (err) {
        // 策略检查/就绪核心自身执行失败（凭据库不可读、配置损坏…）：与
        // `device_policy_unset`（正常态）严格区分——必须停止，不得当成"未配置"
        // 去引导用户重新登记凭据。
        console.error(`   ✗ 设备策略检查执行失败：${(err as Error).message.replace(/\n/g, '\n     ')}`);
        process.exit(1);
      }
      for (const n of gate.notes) console.log(`   · [device] ${n}`);
      // **回收登记必须早于任何退出分支**（codex 二轮 P1）：托管模拟器"起来了但没就绪"
      // （boot 超时/仍锁屏）是**普通、可执行清理的失败路径**，不是 SIGKILL 边界。
      // 此前把这段放在 `!gate.ok` 之后，那个实例会零凭证泄漏。
      if (gate.managed) {
        // 普通模式的设备生命周期**就是本进程**，故身份留在内存、退出即回收，不落
        // device-session.json（单文件 session + 跨 run 对账是 goal 的模型，normal
        // 模式没有 run 目录也没有对账方，写了也无人消费）。
        // **诚实边界**：进程被硬杀（SIGKILL/断电）留下的孤儿实例，普通模式没有兜底
        // 对账，需用户手动关闭——goal 模式才有下次启动对账那张网。
        const identity = gate.managed;
        const serial = gate.target?.serial ?? gate.orphanSerial ?? null;
        registerManagedDeviceCleanup(() => {
          const out = reclaimManagedDevice(
            {
              schema_version: '1.0',
              serial,
              target_kind: 'emulator',
              started_by_run: `harness-${phase}-${process.pid}`,
              managed: identity,
              status: gate.ok ? 'ready' : 'failed',
              updated_at: new Date().toISOString(),
            },
            defaultProcessProbe(),
          );
          if (out.action === 'reclaimed') {
            console.log(`[device] 退出：已回收本次托管启动的模拟器（pid=${out.pid}）`);
          } else if (out.action === 'refused') {
            console.error(
              `[device] 退出：托管模拟器未能回收（${out.reason}）——请手动结束 pid=${identity.pid}`,
            );
          }
        });
      }
      if (!gate.ok) {
        console.error(`   ✗ ${(gate.reason ?? '设备前置未通过').replace(/\n/g, '\n     ')}`);
        process.exit(1);
      }
      if (gate.env) {
        // **整组原子注入**（codex 二轮 P0 + 三轮 P1）：逐键"不存在才写"会留下继承来的
        // 陈旧 MAISON_DEVICE_CREDENTIAL_REF（manual 策略下被运行期优先取用 → 自动输 PIN）；
        // 保留旧 HARNESS_HDC_TARGET 则会在已授权降级后造出"hdc 操作离线真机、门以为是
        // 模拟器"的目标分裂。规则与理由见 applyFrozenDeviceEnv（提成函数以便行为测试）。
        applyFrozenDeviceEnv(process.env, gate.env);
        console.log(`   ✓ 设备目标已解析并注入：${process.env.HARNESS_HDC_TARGET}`);
      }
      // 模拟器/未知目标上的 testing **不得冒充真机整体通过**（harness-gates spec）。
      // 既有封顶判据只在 goal-runner 被消费；普通模式此前根本没有 target kind 可用，
      // 新门产出后直接复用同一函数，不依赖 agent 自报。
      if (gate.target) {
        deviceConclusionCap = buildTestingTargetKindCap(phase, gate.target);
        if (deviceConclusionCap) {
          console.log(`   ⚠ [device] testing 结论将被封顶（target_kind=${gate.target.targetKind}，非 physical）`);
        }
      }
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
  // plan f6b2d9a4 v5/v7：fidelity-intent.json 为三轴唯一 SSOT（initializer 首产）——
  // 在场时 selected 档位/素材轴以 SSOT 为准（spec.md Visual Handoff 仅为投影，由
  // check-spec 复核一致性）；缺失（legacy/未初始化）回落投影解析。capability 输入
  // snapshot 优先（v3 P1-4 同源），live policy meet 仍参与（blind-safe 降级只收紧不放宽）。
  const intentSsot = phaseIsGlobal ? null : loadFidelityIntentSsot(projectRoot, feature);
  const capSnap = phaseIsGlobal ? null : loadCapabilitySnapshot(projectRoot, feature);
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
    : (() => {
        const projection = resolveFidelityContextFromFeature(projectRoot, feature);
        const raw = intentSsot
          ? {
              ...projection,
              fidelityTarget: intentSsot.selected_fidelity,
              assetAcquisitionMode: intentSsot.asset_acquisition_mode,
              effectiveAssetAcquisitionMode: effectiveAssetAcquisitionMode(
                intentSsot.selected_fidelity,
                intentSsot.asset_acquisition_mode,
              ),
            }
          : projection;
        return resolveEffectiveFidelityContext(raw, {
          // post-impl2 P0-1（消费面只认同一 run 快照）：snapshot 在场即为唯一能力真值
          //（live policy 收紧由 runner 侧原子重建 snapshot+SSOT 后再被本处消费——消费面
          // 不得自行叠加 meet，否则「快照 visual、live 盲」会让 hard pixel 静默降档绕过
          // DEFER）。snapshot 缺失（legacy/交互式）回落本地探测+meet。
          hasVision: capSnap
            ? capSnap.vision.verdict
            : mmProbe.supported && resolveCurrentVisualForHarness(projectRoot, feature),
          // plan ab072691 t2③：评审轴只从**冻结快照**取（vision_mode 由 spec 期 preflight
          // 派生一次、run 内不可变）。旧快照/无快照无该键 → undefined → clamp 回落
          // hasVision，行为与本改动前逐字一致。消费面绝不自行重探 provider。
          ...(capSnap?.vision_mode
            ? { reviewVision: reviewVisionForMode(capSnap.vision_mode) }
            : {}),
          ocrAvailable: capSnap
            ? capSnap.ocr.verdict
            : resolveOcrAvailableForRun(projectRoot, resolvedProfile.profileDir, fwConfig.agent_adapter),
        });
      })();
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
    // plan f6b2d9a4：严格度轴（SSOT 缺失=best_effort 缺省）——裁决类谓词 isHardPixelContract 消费
    acceptanceStrictness: intentSsot?.acceptance_strictness ?? 'best_effort',
    assetAcquisitionMode: fidelityCtx.assetAcquisitionMode,
    effectiveAssetAcquisitionMode: fidelityCtx.effectiveAssetAcquisitionMode,
    fidelityDeferrals: fidelityCtx.fidelityDeferrals,
    // post-impl3 P0-3：能力单源——快照判盲时 blind 门禁与 fidelity 同步转盲
    adapterMultimodal: capSnap ? capSnap.vision.verdict : mmProbe.supported,
    adapterImageInput: deriveEffectiveAdapterImageInput(capSnap ? capSnap.vision.verdict : null, mmProbe.imageInput),
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
  // Contract capability resolution is the one immutable pre-check report. It is
  // intentionally computed before checker execution and never receives runtime
  // build/install/run outcomes.
  let capabilityReport: CapabilityResolutionReport | undefined;
  if (!phaseIsGlobal) {
    try {
      const capabilityInput = resolveCapabilityResolutionEntryInput({
        projectRoot,
        feature,
        phase,
        featuresDir: featuresRel,
        goalRunId: process.env.MAISON_GOAL_RUN_ID,
        explicitAdhocCases: typeof args['adhoc-cases'] === 'string' ? args['adhoc-cases'] : undefined,
      });
      capabilityReport = resolveCapabilityReport({
        frameworkRoot: resolvedFrameworkRoot,
        projectRoot,
        feature,
        phase,
        track: resolveFeatureTrack(loadFeatureTrackDecl(projectRoot, feature)),
        ...capabilityInput,
      });
    } catch (error) {
      checks.push({
        id: 'capability_resolution_contract',
        category: 'structure',
        description: 'feature capability contract resolves before checker execution',
        severity: 'BLOCKER',
        status: 'FAIL',
        details: (error as Error).message,
        suggestion: '修复 contract.yaml 的 capability/input source 声明后重跑。',
      });
    }
  }
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

  // 设备目标分类导致的 testing 结论封顶：与 checker 事实同账，参与 violations/报告/退出码。
  // 由入口设备门产出（只有它知道 target_kind），不依赖 agent 自报。
  if (deviceConclusionCap) checks.push(deviceConclusionCap);

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

  if (capabilityReport) {
    // Capability-owned CheckResults are the sole materialization of the immutable
    // pre-check report. Runtime checker facts remain separate; duplicate IDs prove
    // a checker attempted to contradict the contract and fail consumption.
    checks.push(...capabilityResolutionChecks(capabilityReport));
    assertCapabilityConsumption(capabilityReport, checks);
  }

  // Step 3: 生成脚本报告
  console.log('\n📊 Step 3: 生成脚本报告...');
  const scriptReport = generateScriptReport(harnessRoot, phase, feature, projectRoot, checks, resolvedFrameworkRoot, capabilityReport);
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
  let baseSummary = writeRunSummaryBase(projectRoot, finalReport, resolvedFrameworkRoot);
  if (!phaseIsGlobal) {
    writeReceiptSkeletonIfMissing(projectRoot, feature, phase, finalReport.summary.verdict);
  }
  const closureTrack = resolveFeatureTrack(loadFeatureTrackDecl(projectRoot, feature));
  // adjudicated-repair-loop P0 宿主回放：goal-runner 只有等本 gate 子进程返回后，才能从
  // script-report.json 读取 uncertain/disputed 信号。full track 若在这里先验 receipt 并关环，
  // 外层随后 halt 会形成 PASS/closed + WAITING 的矛盾权威态。现有 gate 标志即所有权边界：
  // 子进程只落 base summary；外层 goal-runner 完成裁决后独占 receipt validation/finalization。
  // standalone 与无 testing 的 lite track 保持原有闭环语义。
  const deferFullClosureToGoalRunner =
    !phaseIsGlobal &&
    closureTrack === 'full' &&
    process.env.MAISON_GOAL_GATE_HARNESS === '1';
  const receiptValidation =
    phaseIsGlobal || deferFullClosureToGoalRunner
      ? null
      : tryValidateReceipt(harnessRoot, projectRoot, phase, feature);
  let runSummary: HarnessRunSummary = baseSummary;
  let closureFinalized = false;
  if (
    !phaseIsGlobal &&
    !deferFullClosureToGoalRunner &&
    closureTrack === 'full' &&
    finalReport.summary.verdict === 'PASS' &&
    receiptValidation?.status === 'passed'
  ) {
    try {
      const finalized = finalizePhaseClosure({
        projectRoot,
        frameworkRoot: resolvedFrameworkRoot,
        feature,
        phase,
        receipt: { ...receiptValidation, status: 'passed' },
        blockerCount: finalReport.summary.blockers,
        persistPhaseState: () =>
          syncPhaseStateOnReceiptPassStrict(
            projectRoot,
            feature,
            phase,
            receiptValidation,
            {
              blocker_count: finalReport.summary.blockers,
              frameworkRoot: resolvedFrameworkRoot,
            },
          ),
      });
      runSummary = finalized.summary;
      closureFinalized = true;
    } catch (err) {
      const e = err as Error;
      console.error(`   ✗ closure finalization 失败: ${e.message}`);
      finalReport = failScriptReportWithFatalError(
        finalReport,
        'closure_finalization',
        e,
        resolvedFrameworkRoot,
      );
      baseSummary = writeRunSummaryBase(projectRoot, finalReport, resolvedFrameworkRoot);
    }
  }
  if (!closureFinalized) {
    mergeAndWritePhaseState(projectRoot, workflowSpec, {
      phase,
      feature,
      status: 'harness_finished',
      last_run_at: new Date().toISOString(),
      verdict: finalReport.summary.verdict,
      blocker_count: finalReport.summary.blockers,
      receipt: receiptValidation,
    });
    runSummary = patchRunSummaryClosure(
      projectRoot,
      finalReport,
      baseSummary,
      receiptValidation,
      resolvedFrameworkRoot,
    );
  }
  if (args.summary || args['failures-only']) {
    printStableSummary(runSummary);
  }

  if (!phaseIsGlobal && feature !== GLOBAL_FEATURE_SENTINEL) {
    assessAndRenderNextStep({
      projectRoot,
      frameworkRoot: resolvedFrameworkRoot,
      feature,
      phase,
      // b3e8d4c7 t3：判的是"在不在 goal run 里"，**不是**"是不是 agent 侧"。
      // isAgentSideGoalHarness 是 vision 账本的**单写者**谓词，刻意排除
      // MAISON_GOAL_GATE_HARNESS=1——于是权威 gate harness 反而按 manual 渲染并写投影
      //（宿主实锤 run 20260804T033834Z-99c0a1：NEXT_STEP mode=manual policy=manual）。
      // 用既有并集，不新造谓词。
      mode: isGoalOrchestrationEnv() || isAgentSideGoalHarness() ? 'goal_mode' : 'manual',
      status: `${runSummary.verdict}/${runSummary.closure_status ?? 'open'}`,
    });
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
    // S5（visual-capability-truth 单写者）：goal 态 **agent 自跑** harness（有 goal 轮次
    // 身份但无 MAISON_GOAL_GATE_HARNESS 标）不直写正式 ledger——写 journal proposal，
    // 由 goal-runner 在 invocation 结束后顺序重放收编（20260718 孤儿行误熔断的根治）。
    // gate harness（runner 直接 spawn，带标）与交互态维持直写。
    // b7e4d2a9 Todo3：判定统一走共享谓词（对现状是超集收紧——HEADLESS/ATTEMPT-only
    // 形态也走 journal，语义一致；check-spec attestation 同谓词，永不再分叉）。
    const isGoalAgentSide = isAgentSideGoalHarness();
    if (isGoalAgentSide && s.round.disposition === 'appended' && s.round.row.attempt_id) {
      try {
        const row = s.round.row;
        const rowAttemptId = row.attempt_id as string; // 外层已判真值
        appendJournalProposal(
          intermediateRoundsJournalPath(
            projectRoot,
            report.feature,
            (process.env.MAISON_GOAL_RUN_ID ?? row.goal_run_id ?? 'unknown-run').trim(),
          ),
          {
            attemptId: rowAttemptId,
            roundInput: {
              loopId: row.loop_id,
              attemptId: rowAttemptId,
              goalRunId: row.goal_run_id ?? null,
              buildFingerprint: row.build_fingerprint,
              screensHash: row.screens_hash,
              defectFingerprints: row.defect_fingerprints,
              sourceFailHitIds: row.source_fail_hit_ids,
              sourceWarnIds: row.source_warn_ids,
              fingerprintable: row.fingerprintable,
              awaitHumanOnly: row.await_human_only,
              actionableResidual: row.actionable_residual,
            },
            claimed: {
              base_state_hash: row.base_state_hash,
              row_hash: row.row_hash,
              fused: s.round.decision.fused,
            },
            // plan d8c5f3a7 T2：传**评估时刻**（row.at 即算出 claimed.row_hash 时用的 at）。
            // 此前不传 → appendJournalProposal 用 new Date() 重打，与 claimed 不同源；
            // at 参与 row_hash 不参与 base_state_hash，runner 重放遂得「base 全对、
            // fused 全对、row 全错」→ 被判篡改 halt（2026-07-24 事故直接死因）。
            at: row.at,
          },
        );
        console.log('   [visual-rounds] goal 态中间轮已写 journal proposal（runner 收编后入正式账本）');
        return {
          loop_id: row.loop_id,
          attempt: row.attempt_id,
          row_hash: row.row_hash,
          disposition: 'journaled',
        } as HarnessRunSummary['visual_round'];
      } catch (e) {
        console.warn(`   ⚠ [visual-rounds] journal 写入失败（${(e as Error).message}）——按 append_failed 上报`);
        return { loop_id: s.round.row.loop_id, attempt: s.round.row.attempt_id, disposition: 'append_failed' } as HarnessRunSummary['visual_round'];
      }
    }
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
 * blind-visual-hardening d1 切片二：轴适用性判定（visual=UI 需求；asset=ui-spec 声明素材）。
 * 懒 require ui-spec-shared——非 UI 项目不引入依赖面（沿 check-review 先例）；
 * 任何读取失败按"不适用"保守处理（不适用轴的 FAIL 会被 deriveQualityAxes 重映射 functional，
 * 不会丢失阻断）。
 */
function resolveAxisApplicability(
  projectRoot: string,
  feature: string,
  phase: Phase,
): { phase: Phase; visualApplicable: boolean; assetApplicable: boolean } {
  let visualApplicable = false;
  let assetApplicable = false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const shared = require('./scripts/utils/ui-spec-shared') as typeof import('./scripts/utils/ui-spec-shared');
    const specPath = featureFilePath(projectRoot, feature, path.join('spec', 'spec.md'));
    if (fs.existsSync(specPath)) {
      const uiChange = shared.parseUiChangeFromSpecMarkdown(fs.readFileSync(specPath, 'utf-8'));
      visualApplicable = Boolean(uiChange && shared.UI_CHANGE_REQUIRES_UI_SPEC.has(uiChange));
    }
    if (visualApplicable) {
      const uiDoc = shared.loadUiSpecFile(shared.uiSpecAbsPath(projectRoot, feature));
      const assets = (uiDoc as { assets?: unknown[] } | null)?.assets;
      assetApplicable = Array.isArray(assets) && assets.length > 0;
    }
  } catch {
    /* 保守：读取失败按不适用处理 */
  }
  return { phase, visualApplicable, assetApplicable };
}

/**
 * blind-visual-hardening d5：视觉债务管线（派生→验收消费→落盘→轴调整）。
 * 全程 try/catch best-effort（债务管线异常不阻断 summary 落盘——但打印告警不静默）。
 */
/**
 * S7（P2-J.2）I/O 面：五指纹一致性判定 → AssetAxisInheritance（null=coding summary 不可得，
 * 不继承）。判据：coding summary 1.1 存在且 asset 轴可读；review 闭环 attestation 对账 ok
 * （源码/资产未漂移——build/source/inventory 三链的现实可得代理）；visual-debt 无 open 的
 * asset 域条目（debt revision 面）。证据引用=coding summary sha256 + attestation inventory。
 */
function resolveAssetAxisInheritance(
  projectRoot: string,
  feature: string,
): import('./scripts/utils/quality-axes').AssetAxisInheritance | null {
  try {
    const codingSummaryPath = path.join(
      receiptDirPath(projectRoot, feature, 'coding'),
      'reports',
      'summary.json',
    );
    if (!fs.existsSync(codingSummaryPath)) return null;
    const raw = fs.readFileSync(codingSummaryPath, 'utf-8');
    const parsed = JSON.parse(raw) as {
      schema_version?: string;
      gate_fingerprint?: { fingerprint?: string } | string;
      quality_axes?: { asset?: { applicable?: boolean; verdict?: string } };
      asset_debt_revision?: string;
    };
    if (
      (parsed.schema_version !== '1.1' && parsed.schema_version !== '1.2') ||
      !parsed.quality_axes?.asset
    ) return null;
    const upstreamVerdict = String(parsed.quality_axes.asset.verdict ?? 'UNVERIFIED');
    const summaryHash = createHash('sha256').update(raw).digest('hex').slice(0, 16);
    const issues: string[] = [];
    // 指纹链 0（codex 实施 review P1-2 + 二轮 P1-6 fail-closed）：coding gate_fingerprint
    // vs 当前重算——规则面变更后 asset 结论按 STALE；任一侧**缺失**同样不继承（缺指纹
    // ≠ 指纹一致，fail-closed）。
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const gf = require('./scripts/utils/gate-fingerprint') as typeof import('./scripts/utils/gate-fingerprint');
      const layout = detectRepoLayout(projectRoot);
      const current = gf.computeGateFingerprint(layout.frameworkRoot, 'coding');
      const recorded =
        typeof parsed.gate_fingerprint === 'string'
          ? parsed.gate_fingerprint
          : parsed.gate_fingerprint?.fingerprint;
      if (!current || !recorded) {
        issues.push(`coding gate_fingerprint 不可比（recorded=${recorded ?? '缺失'}，current=${current ?? '缺失'}）——缺指纹不继承`);
      } else if (current !== recorded) {
        issues.push(`coding gate_fingerprint 漂移（规则面已变：${recorded} → ${current}）`);
      }
    } catch (e) {
      issues.push(`gate fingerprint 重算异常：${(e as Error).message}`);
    }
    // 指纹链 1：review 闭环 attestation 对账（源码漂移检测=source fingerprint 实质绑定）；
    // 证据引用记 inventory aggregate_sha256（二轮 P1-6：file_count 不是 hash）。
    let inventoryRef = '';
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const ca = require('./scripts/utils/closure-attestation') as typeof import('./scripts/utils/closure-attestation');
      const att = ca.loadReviewClosureAttestation(projectRoot, feature);
      if (!att) issues.push('无 review closure attestation（源码基线不可证）');
      else {
        const rec = ca.reconcileSourceTreeAgainstAttestation(projectRoot, att);
        if (!rec.ok) issues.push(`源码漂移（+${rec.added.length}/~${rec.modified.length}/-${rec.deleted.length}）`);
        const aggregate = (att.inventory as { aggregate_sha256?: string }).aggregate_sha256;
        if (!aggregate) issues.push('attestation inventory 缺 aggregate_sha256——inventory hash 不可锚定');
        else inventoryRef = `inventory:${aggregate}`;
      }
    } catch (e) {
      issues.push(`attestation 对账异常：${(e as Error).message}`);
    }
    // 指纹链 2（二轮 P1-6 补上游比对）：asset 域债务 revision——coding summary 落盘值 vs
    // 当前重算（域内投影，跨阶段其他域条目变动不误伤）；coding 侧未记录 → 不继承。
    let debtRevisionRef = '';
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const vd = require('./scripts/utils/visual-debt') as typeof import('./scripts/utils/visual-debt');
      const load = vd.loadVisualDebtEx(projectRoot, feature);
      if (load.state === 'invalid') issues.push('visual-debt.json 损坏');
      else {
        const openAsset = (load.doc?.entries ?? []).filter(
          e => e.status === 'open' && /asset/i.test(e.source_check_id ?? ''),
        );
        if (openAsset.length > 0) issues.push(`债务账本存在 open 资产条目（${openAsset.map(e => e.id).join(',')}）`);
        const currentRevision = vd.assetDomainDebtRevision(load.doc);
        const recordedRevision = (parsed.asset_debt_revision ?? '').trim();
        if (!recordedRevision) {
          issues.push('coding summary 未记录 asset_debt_revision——债务 revision 链不可比（旧版 summary 不继承）');
        } else if (recordedRevision !== currentRevision) {
          issues.push(`asset 域债务 revision 漂移（coding=${recordedRevision} → 当前=${currentRevision}）`);
        }
        debtRevisionRef = `debt:${currentRevision}`;
      }
    } catch (e) {
      issues.push(`debt 账本读取异常：${(e as Error).message}`);
    }
    // 指纹链 3（build fingerprint，三轮 review P1-5 fail-closed）：7.2b 落地前 build 链
    // 不可证——**不允许部分 provenance 的 PASS 继承**（spec 要求五链全一致），恒并入缺证
    // 原因 → 继承保持 STALE/needs_human；build 身份钩子（hylyre 实机采集）接入后解除。
    issues.push('build fingerprint 链未接入（tasks 7.2b pending）——五链不齐，asset 轴不继承');
    return {
      upstreamPhase: 'coding',
      upstreamVerdict: upstreamVerdict as import('./scripts/utils/quality-axes').AxisVerdict,
      provenanceIntact: issues.length === 0,
      provenanceDetail: issues.join('；') || 'ok',
      evidenceRefs: [
        `summary:${summaryHash}`,
        ...(inventoryRef ? [inventoryRef] : []),
        ...(debtRevisionRef ? [debtRevisionRef] : []),
      ],
    };
  } catch {
    return null;
  }
}

function applyVisualDebtPipeline(
  projectRoot: string,
  report: ScriptReport,
  lattice: ReturnType<typeof deriveSummaryVerdictLattice>,
): void {
  try {
    const prevLoad = loadVisualDebtEx(projectRoot, report.feature);
    if (prevLoad.state === 'invalid') {
      // codex 三轮 P0-1：损坏账本≠不存在——fail-closed 且**不覆盖**原文件（保留取证现场）
      throw new Error(`visual-debt.json 损坏（${prevLoad.reason}）——单调 ledger 不可信，禁止按"无历史"重建`);
    }
    const prev = prevLoad.doc;
    let debtDoc = annotateAssetTriState(deriveVisualDebt(report.feature, report.checks, prev), report.checks);
    if (debtDoc.entries.length === 0 && !prev) return; // 无债务面（非 UI/全绿且无历史）不落空文件

    // 人工验收消费：payload（visual-acceptance.json）+ 信任链 receipt（.receipt.json 绑 payload 字节哈希）
    const accDir = path.join(featureDir(projectRoot, report.feature), 'device-testing');
    const payloadPath = path.join(accDir, 'visual-acceptance.json');
    const receiptPath = path.join(accDir, 'visual-acceptance.receipt.json');
    if (fs.existsSync(payloadPath) && fs.existsSync(receiptPath)) {
      try {
        const payload = JSON.parse(fs.readFileSync(payloadPath, 'utf-8')) as VisualAcceptancePayload;
        const objectHash = crypto.createHash('sha256').update(fs.readFileSync(payloadPath)).digest('hex');
        const trust = validateConfirmationReceiptFile(receiptPath, defaultTrustRegistryPath(projectRoot), {
          action: 'human_visual_acceptance',
          feature: report.feature,
          object_hash: objectHash,
        });
        const policyErrors = validateRubricPolicy(payload);
        if (trust.valid && policyErrors.length === 0) {
          const applied = applyVisualAcceptance(
            debtDoc,
            payload,
            path.relative(projectRoot, receiptPath).replace(/\\/g, '/'),
          );
          debtDoc = applied.doc;
          if (applied.rejected.length > 0) {
            console.warn(`   ⚠ [visual-debt] 验收 receipt 试图清偿确定性 FAIL，已拒绝：\n${applied.rejected.map(r => `     - ${r}`).join('\n')}`);
          }
        } else {
          console.warn(
            `   ⚠ [visual-debt] 人工验收无效（不予清偿）：${[...trust.reasons ?? [], ...policyErrors].slice(0, 4).join('；')}`,
          );
        }
      } catch (e) {
        console.warn(`   ⚠ [visual-debt] 验收消费异常（不予清偿）：${(e as Error).message}`);
      }
    }
    writeVisualDebt(projectRoot, debtDoc);

    const { open } = countBlockingDebt(debtDoc);
    const visual = lattice.quality_axes.visual;
    if (open > 0 && visual.applicable && visual.verdict === 'PASS') {
      lattice.quality_axes.visual = {
        ...visual,
        verdict: 'UNVERIFIED',
        blocking_class: 'needs_human',
        resolution: { class: 'needs_human', owner: 'human', retry_phase: null },
      };
    }
    // 债务影响 release/completion 投影（advance 投影不含 visual UNVERIFIED，等价性不破）
    lattice.release_readiness = projectReleaseReadiness(lattice.quality_axes);
    lattice.completion_status = projectCompletionStatus(lattice.quality_axes);
  } catch (e) {
    // fail-closed（codex 实施 review P0-2）：治理链自身失败时**最不该**放行——
    // release 直接 BLOCKED、completion 记管线故障、visual 轴降 UNVERIFIED(needs_fix)；
    // 债务文件不更新（保留 last-known-good），summary 携带故障态落盘。
    console.warn(`   ⚠ [visual-debt] 债务管线异常——fail-closed：release=BLOCKED（${(e as Error).message}）`);
    const visual = lattice.quality_axes.visual;
    if (visual.applicable && (visual.verdict === 'PASS' || visual.verdict === 'NOT_APPLICABLE')) {
      lattice.quality_axes.visual = {
        ...visual,
        applicable: true,
        verdict: 'UNVERIFIED',
        blocking_class: 'needs_fix',
        resolution: { class: 'needs_fix', owner: 'toolchain', retry_phase: String(report.phase) },
      };
    }
    lattice.release_readiness = 'BLOCKED';
    lattice.completion_status = 'DEBT_PIPELINE_ERROR';
  }
}

/**
 * t2 receipt-slim（plan e6a3c9f4 / openspec receipt-slim）：base summary——**无 receipt 依赖**、
 * 完整 schema-valid、原子写。closure 字段以"未闭环/等待 receipt"初值填充，由后续
 * patchRunSummaryClosure 定稿；进程中途崩溃不会留下非法 JSON 或残留旧 closed 态。
 */
/** best-effort 文本读取（repair candidates 的输入面：缺文件=null=零候选，不抛） */
function readTextOrNull(absPath: string): string | null {
  try {
    return fs.existsSync(absPath) ? fs.readFileSync(absPath, 'utf-8') : null;
  } catch {
    return null;
  }
}

/**
 * 读 feature 文档（canonical + legacy 全候选）——**必须走既有 artifact resolver**：
 * 正式 review 报告在 `<feature>/review/review-report.md`，手拼 `<feature>/<doc>` 会读成
 * null，导致 review 候选恒不生成（codex review 冻结项①：纯函数测试绕过生产读取路径，
 * 出现假绿）。不新增路径规则或兼容层。
 */
function readFeatureDocOrNull(
  projectRoot: string,
  feature: string,
  docName: string,
): string | null {
  const resolved = resolveFeatureArtifact(projectRoot, feature, docName);
  return resolved.exists ? readTextOrNull(resolved.actualPath) : null;
}

/** 与 check-review conditional_pass_closure 同款校验：receipt 绑定当前报告 hash 才有效。 */
function isConditionalReviewReceiptValid(
  projectRoot: string,
  feature: string,
): boolean {
  try {
    const report = readFeatureDocOrNull(projectRoot, feature, 'review-report.md');
    if (!report) return false;
    const reportSha = crypto.createHash('sha256').update(report, 'utf-8').digest('hex');
    const receiptPath = featureFilePath(
      projectRoot, feature, path.join('review', 'conditional-authorization.receipt.json'),
    );
    return validateConfirmationReceiptFile(
      receiptPath,
      defaultTrustRegistryPath(projectRoot),
      { action: 'conditional_review_authorization', feature, object_hash: reportSha },
    ).valid;
  } catch {
    return false;
  }
}

/** c7e4a2d9：测试入口导出（runner 集成测试经桩调用真实 writer 落盘，禁止手搓 summary）。 */
export function writeRunSummaryBase(
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
  // plan c8e5b3f1 t2 A：blocked capability 通用诊断——确定性提取（capability_input_unresolved）。
  // 通用投影只转述 capability/input/attempt/dependency；requirement 专属话术只来自 derive.requirement
  // 自己的 attempt.detail（经 fact.unresolved[].detail 原样带出），此处不硬编码。
  readinessSignals.push(...capabilityBlockedReadinessSignals(report));
  // 回执 stale 治理：机器写入门禁集指纹（agent 零参与）；check-receipt 消费时重算比对，
  // framework 门禁集升级后旧 summary/回执即失效（round6 Checkpoint-2：旧 spec 回执整体豁免 P0-D 的洞）。
  const gateFingerprint = computeGateFingerprint(frameworkRoot, report.phase);
  // t1（f7a3d9c2）：runner 侧追加视觉轮次账本 + 回执（在 summary 落盘前完成，保证
  // summary.visual_round 与账本一致）。
  const visualRound = consumeVisualRoundPayload(projectRoot, report);
  // blind-visual-hardening d1 切片二：多轴产品裁决 + report_validity（harness 派生，
  // 非 agent 自报）。外部阻塞分类以 resolveVerdictFromChecks 为唯一 oracle。
  // plan c8e5b3f1 t2 B：归因统一走共享 deriveSummaryVerdictLattice（暴露 pre/post/has_blocked），
  // runner 与测试同源；post 已含 hasBlocked 顶层钳制（不拿 rawPost 归因，否则 visual/asset blocked
  // 会漏判），pre 供 pre!==legacy 的真派生缺陷判定。
  const lattice = deriveSummaryVerdictLattice(
    report.checks,
    resolveAxisApplicability(projectRoot, report.feature, report.phase),
    report.capability_resolution_contract_fingerprint === null
      ? undefined
      : { capabilities: report.capability_resolutions as CapabilityResolutionReport['capabilities'] },
  );
  const { has_blocked: hasBlocked, pre_projection_verdict: pre, projected_verdict: post } = lattice;
  // S7（visual-capability-truth P2-J.2）：testing 期 asset 轴带 provenance 继承——
  // 上游（coding）asset PASS 只有在源码/资产指纹链未漂移时才可继承为证据引用；
  // 任一漂移 → STALE（needs_human），不复制裸 PASS。应用后重投影。
  if (report.phase === 'testing') {
    const inh = resolveAssetAxisInheritance(projectRoot, report.feature);
    if (inh) {
      applyAssetAxisInheritance(lattice.quality_axes, inh);
      lattice.release_readiness = projectReleaseReadiness(lattice.quality_axes);
      lattice.completion_status = projectCompletionStatus(lattice.quality_axes);
    }
  }
  // blind-visual-hardening d5：视觉债务 SSOT 派生（harness 派生非 agent 自报）+ 人工验收
  // receipt 消费（只清 needs_human；needs_fix 拒绝）+ 未清偿债务 → visual 轴 UNVERIFIED
  //（advance 不受影响——visual 非推进阻断轴，等价性保持；release 由此 BLOCKED）。
  applyVisualDebtPipeline(projectRoot, report, lattice);
  // S7 二轮 P1-6：asset 域债务 revision 落盘（继承指纹链 2 的上游锚点——testing 期
  // resolveAssetAxisInheritance 重算比对；债务管线刚写完盘，此处读的是本轮定稿态）。
  let assetDebtRevision: string | undefined;
  try {
    const debtNow = loadVisualDebtEx(projectRoot, report.feature);
    if (debtNow.state !== 'invalid') assetDebtRevision = assetDomainDebtRevision(debtNow.doc);
  } catch {
    /* 债务面异常时不落 revision（继承侧按缺失 fail-closed） */
  }
  // 不变量对账（codex 实施 review P0-2 fail-closed）：顶层 verdict 取**更严一侧**
  //（FAIL > INCOMPLETE > PASS），绝不选择较宽松侧放行。plan c8e5b3f1 t2 B 因果归因：
  //   · 仅 pre===legacy && post!==legacy → 差异由 capability 合法投影造成，**不报** mismatch；
  //   · pre!==legacy → 独立派生缺陷，即使同时存在 blocked 也**照报** mismatch。
  const legacy = report.summary.verdict;
  // plan c8e5b3f1 t2 B：顶层 verdict 归因统一走共享纯函数 resolveEffectiveVerdict（评审：裁决逻辑
  // 不该埋在 runner 内联，且 FAIL 降级保护须有守门测试）。它保证投影取更严侧、不把既有 FAIL 降级，
  // mismatch 只在 pre!==legacy 时报（pre===legacy 的 capability 合法投影不报）。
  const { verdict: effectiveVerdict, mismatch } = resolveEffectiveVerdict({ pre, post, legacy });
  if (mismatch) {
    // 文案按 pre 说话（review：mismatch=pre!==legacy，post 可能 ===legacy，写「投影≠legacy」是假话）。
    console.warn(
      `   ⚠ [quality-axes] 投影前(pre=${pre}) ≠ legacy(${legacy})（post=${post} 已按 capability 投影/钳制）——独立派生缺陷，按更严侧 ${effectiveVerdict} 落盘（框架缺陷，请回灌源仓）`,
    );
    readinessSignals.push({
      id: 'quality_axes_projection_mismatch',
      status: 'incomplete',
      message: `quality_axes 投影前(pre=${pre}) ≠ legacy=${legacy}（post=${post}）——独立派生缺陷，已按更严侧 ${effectiveVerdict} 落盘`,
    });
  }
  const summary: HarnessRunSummary = {
    schema_version: '1.2',
    phase: report.phase,
    feature: report.feature,
    verdict: effectiveVerdict,
    report_validity: lattice.report_validity,
    quality_axes: lattice.quality_axes,
    release_readiness: lattice.release_readiness,
    completion_status: lattice.completion_status,
    blocker_count: report.summary.blockers,
    fail_count: report.summary.fail,
    warn_count: report.summary.warn,
    ...(gateFingerprint ? { gate_fingerprint: gateFingerprint } : {}),
    ...(assetDebtRevision ? { asset_debt_revision: assetDebtRevision } : {}),
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
    next_action: decideNextAction(report, blockers, runStatuses, blockingSkips, readinessSignals, {
      effectiveVerdict,
      capabilityBlocked: hasBlocked,
    }),
    closure_status: 'open',
    assurance: report.assurance,
    capability_resolutions: report.capability_resolutions,
    capability_resolution_contract_fingerprint: report.capability_resolution_contract_fingerprint,
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
  // 责任阶段统一路由（plan b6e4c9f2 t1）：可信可修缺陷的单一共享事实——harness 派生
  // 非 agent 自报；manual/batch/goal 消费同一字段（goal 的 deterministic_defects 只是
  // 其指纹投影）。信任闸（c7e4a2d9 收窄）：report_validity 只抑制**依赖报告自由文本**
  // 的 review 候选；机器 check / verifier 合取候选（含 p0_coverage_integrity FAIL+
  // code_regression）不得因产品负面结论被整体清空（负面结论恰是回修候选最需要存活的
  // 时刻）。review 侧另叠 verifier 逐条 confirmed + conditional receipt 抑制
  // （组装函数内部把关）。agent 自跑轮 verifier.report.md 可能尚未存在 → 零 candidate
  // （gate 轮自然出现）。
  try {
    // 生产接线走**共享实现** buildSummaryRepairCandidates（测试调同一函数——
    // 源码正则冒充接线验证已被 codex 二轮冻结项③点名禁止）
    const repairCandidates = buildSummaryRepairCandidates({
      phase: report.phase,
      checks: report.checks,
      reportValidity: lattice.report_validity,
      reviewReportText:
        report.phase === 'review'
          ? readFeatureDocOrNull(projectRoot, report.feature, 'review-report.md')
          : null,
      verifierReportText: readTextOrNull(path.join(dir, 'verifier.report.md')),
      conditionalReceiptValid:
        report.phase === 'review'
          ? isConditionalReviewReceiptValid(projectRoot, report.feature)
          : false,
      parseClassificationFromDetails: extractFailureClassification,
    });
    if (repairCandidates.length > 0) summary.repair_candidates = repairCandidates;
  } catch (e) {
    // best-effort 事实层：组装失败不阻断 summary（无 candidate=落回既有 retry/halt 行为）
    console.warn(`   ⚠ [repair-candidates] 组装失败（零候选继续）：${(e as Error).message}`);
  }
  // Writer fail-fast：1.2 extends the quality lattice with assurance provenance and closure state.
  const v11Errors = validateSummaryV11(summary);
  if (v11Errors.length > 0) {
    throw new Error(`[quality-axes] summary 1.2 契约违反（框架缺陷，拒绝落盘）：${v11Errors.join('；')}`);
  }
  atomicWriteJson(path.join(dir, 'summary.json'), summary);
  return summary;
}

/**
 * t2 receipt-slim：瘦身回执骨架——仅 verdict=PASS 且回执缺失时幂等生成（FAIL 跑不留半真骨架）；
 * lite track 豁免（receipt 机制 not_applicable）。骨架自证字段占位、反假设 checkbox 全未勾，
 * 不构成闭环；生成失败不阻断门禁（best-effort，agent 可自行从模板复制）。
 * openspec runner-owned-machine-facts：**goal 态让位**——骨架由 goal runner 在每次 invoke
 * 前单点 force 写入（写失败 fail-closed 不启动 agent），本函数不再兼任第二写入点
 * （双写者会掩盖 runner 写失败，且 PASS 后才建骨架迫使 closure 必然多跑一轮）。
 * 非 goal 手动流程无 runner 可依，保留 PASS-gated 幂等首建。
 */
function writeReceiptSkeletonIfMissing(
  projectRoot: string,
  feature: string,
  phase: Phase,
  verdict: string,
): void {
  try {
    if (process.env.MAISON_GOAL_ATTEMPT?.trim()) return;
    if (verdict !== 'PASS') return;
    if (resolveFeatureTrack(loadFeatureTrackDecl(projectRoot, feature)) === 'lite') return;
    const res = writeReceiptScaffold(projectRoot, feature, phase, {
      attemptId: undefined,
    });
    if (res.wrote && res.receiptPath) {
      console.log(
        `   ✓ 已生成瘦身回执骨架（PASS-gated）：${path.relative(projectRoot, res.receiptPath).replace(/\\/g, '/')}` +
          '——身份字段已预填（不得改动）；自证字段待真实填写、反假设 checkbox 待勾选，骨架不构成闭环。',
      );
    }
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
  opts?: { effectiveVerdict?: string; capabilityBlocked?: boolean },
): string {
  // plan c8e5b3f1 t2：effective verdict = 顶层钳制后的最终值（capability blocked 时 ≠ legacy PASS）。
  // 开头的 legacy INCOMPLETE/device-external 分支保持原语义（legacy 变 INCOMPLETE 的唯一路径就是
  // device-external 例外），不得换成 effective。
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
  // plan c8e5b3f1 t2 C：capability 动作插在具名 blocker 链与 run_status 之后、readiness 通用动作
  // 之前。位置不算保证——必须显式前置条件（真实 blocker/SKIP/run-status 在场时一律不给 capability 动作）。
  if (
    opts?.capabilityBlocked === true &&
    blockers.length === 0 &&
    blockingSkips.length === 0 &&
    !runStatuses.some(s => s.can_claim_done === false)
  ) {
    return 'resolve_capability_inputs_then_rerun';
  }
  if (readinessSignals.some(s => s.status === 'incomplete')) {
    return 'complete_readiness_warnings_then_continue';
  }
  // plan c8e5b3f1 t2 C：最后的 PASS 判定用 effective verdict——capability blocked（effective≠PASS）
  // 时不得落 run_verifier_then_receipt。
  const effectiveVerdict = opts?.effectiveVerdict ?? report.summary.verdict;
  if (effectiveVerdict === 'PASS' && blockingSkips.length > 0) {
    return 'review_blocking_skips_then_verifier';
  }
  if (effectiveVerdict === 'PASS') return 'run_verifier_then_receipt';
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

/**
 * plan c8e5b3f1 t2 A：blocked capability 的通用诊断 readiness signals（capability_input_unresolved）。
 * 从 report.capability_resolutions 确定性提取 active ∧ blocked 的事实（按 capability id 稳定排序）；
 * message 只转述 capability/input/attempt/dependency，requirement 专属话术只经 fact.unresolved[].detail
 * 原样带出（derive.requirement 自己的 detail），不在此硬编码。applicability invalid 的 blocked（无
 * 普通 input attempt）也产出，避免整项静默漏掉。
 */
function capabilityBlockedReadinessSignals(report: ScriptReport): HarnessRunSummary['readiness_signals'] {
  return collectBlockedCapabilityFacts({ capabilities: report.capability_resolutions }).map((fact) => {
    const parts = fact.unresolved.length > 0
      ? fact.unresolved.map((u) => {
          // 展示**全部**相关 dependency path（不只第一个），保证尝试路径可诊断（review P2）。
          const deps = u.dependencies.filter((d) => !!d.path).map((d) => `${d.path}${d.exists ? '' : '(missing)'}`).join(', ');
          return `input=${u.input} source=${u.source}` +
            (u.detail ? `: ${u.detail}` : '') +
            (deps ? ` path=[${deps}]` : '');
        }).join('；')
      // applicability invalid 的 blocked：展示 provider + 全部 applicability_dependencies path（review P2）。
      : `applicability invalid（provider=${fact.applicability_provider ?? 'n/a'}` +
        (fact.applicability_dependencies.length > 0
          ? `，path=[${fact.applicability_dependencies.map((d) => `${d.path}${d.exists ? '' : '(missing)'}`).join(', ')}]` : '') +
        `）`;
    return {
      id: 'capability_input_unresolved',
      status: 'incomplete' as const,
      source_check: fact.capability,
      message: `capability=${fact.capability} 输入未解析：${parts}`,
    };
  });
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

export { decideNextAction };
export { capabilityBlockedReadinessSignals };

if (require.main === module) {
  main().catch(err => {
    console.error('致命错误:', err);
    process.exit(2);
  });
}
