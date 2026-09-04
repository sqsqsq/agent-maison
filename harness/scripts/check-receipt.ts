// ============================================================================
// 阶段完成回执校验脚本（Layer 2 凭证检查）
// ============================================================================
// 用法（在仓库根目录或任意位置执行均可）：
//   npx ts-node framework/harness/scripts/check-receipt.ts \
//     --feature <feature> --phase <spec|plan|coding|review|ut|testing>
//
// 行为（plan 07a41ec6 T4 / openspec efficiency-first-closure）：
//   1. 当前 schema 只校验 summary.json / verifier 报告 / policy；闭环成功后 best-effort 生成回执投影
//      （receipt_schema 2.1，agent 零手填；备注写 <phase>/notes.md）：
//      - base summary verdict=PASS 且 blocker_count=0，gate_fingerprint / source sha / worktree digest / run id 新鲜
//      - verifier 证据按 resolved plan 验真（identity）——policy=required 时必须在场
//      - trace.json 在 canonical 路径存在且可解析（policy 档决定缺失是 BLOCKER 还是 WARN）
//      不再校验：commit sha 手抄、self_check 问答、反假设 checkbox（全部删除）。
//      任一失败 → exit 1 + 详细 BLOCKER 报告；全部通过 → finalize closure（本命令即 finalize）。
//   2. profile `phases_disabled` 命中本 phase 时：不要求回执，直接 exit 0。
//   3. legacy 回执 YAML 解析失败 → exit 2；当前 schema 的投影写入失败只 WARN，不改变闭环。
//
// 退出码语义（与 harness-runner / Stop hook 协议一致）：
//   0 = PASS（summary/verifier/policy 满足，阶段已闭环）
//   1 = 校验失败（机器事实不达标）
//   2 = 致命错误（legacy 回执解析失败）
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import * as YAML from 'yaml';
import minimist from 'minimist';
import { loadFrameworkConfig, resolveReceiptFilePath, featurePhaseReportsDir } from '../config';
import { resolveWorkflowSpec } from '../workflow-loader';
import {
  assertWorkflowFeaturePhase,
  buildEvidencePolicySnapshot,
  resolveEvidencePolicy,
  resolveFeatureTrack,
  resolveProfileLabel,
  type EvidencePolicy,
  type EvidenceValidationStatus,
  type RuntimeContext,
} from './utils/runtime-policy';
import { loadFeatureTrackDecl } from './utils/feature-track';
import { normalizePhaseId } from './utils/phase-alias';
import { assertGateFingerprintFresh, computeGateFingerprint } from './utils/gate-fingerprint';
import { finalizePhaseClosure } from './utils/phase-closure-finalizer';
import { assessAndRenderNextStep } from './utils/assess-renderer';
import { isClaudeKernelAdapter } from './utils/types';
import { scanCommandForPreloadInjection } from './utils/process-integrity';
import { validateLiteSchema } from './utils/lite-json-schema';
import { computeProductWorktreeDigest } from './utils/worktree-digest';
import { isCapabilitySkipped } from '../capability-registry';
import { isPhaseDisabledByProfile, loadResolvedProfile } from '../profile-loader';
import {
  isAgentSideGoalHarness,
  isGoalOrchestrationEnv,
  resolveRunOwnerKind,
  syncPhaseStateOnReceiptPassStrict,
  type FeaturePhase,
} from './utils/phase-state';
import { canPromptNow } from './utils/adjudication';
import {
  evaluateMultimodalEvidenceGate,
  type MultimodalEvidenceGateResult,
} from './utils/multimodal-evidence-gate';
import {
  loadVerifierEvidence,
  findPriorPassVerifierEvidence,
  loadVerifierReportTextOrNull,
  readSummaryClosureStatus,
  readSummarySchemaVersion,
  readSummaryVerifierSubjectId,
  type VerifierEvidence,
} from './utils/verifier-evidence';
import {
  resolveVerifierPlan,
  workflowVerifierPrompt,
  type VerifierPlan,
} from './utils/verifier-plan';
import { resolveVerifierCapability } from './utils/adapter-catalog';
import { SUMMARY_SCHEMA_VERSION_CURRENT } from './utils/quality-axes';
import { recomputePhaseEvidenceStaleness } from './utils/phase-evidence-manifest';
import { RECEIPT_PROJECTION_SCHEMA } from './utils/receipt-scaffold';
import { diffVerifierMaterial, readVerifierMaterialOrNull } from './utils/verifier-material';
import type { VerifierClosureRecord } from './utils/types';
import { resolveContextAdapterImageInput } from './utils/multimodal-probe';
import type { HarnessRunSummary, SoftAdvisory } from './utils/types';

/** Feature phase id（由 active workflow 定义；main() 内按 workflow 合法集校验——C0 收编）。 */
type Phase = string;

interface ReceiptFrontmatter {
  receipt_schema?: string;
  feature?: string;
  phase?: string;
  agent_model?: string;
  agent_runtime?: string;
  claimed_completion_at?: string;
  claimed_completion_commit_sha?: string;
  /** f9c2e6b4 t1：本回执属于哪一次 attempt（goal 环境必填；值取自 env MAISON_GOAL_ATTEMPT） */
  claimed_attempt_id?: string;
  script_harness?: {
    command?: string;
    exit_code?: number;
    report_dir?: string;
    blocker_count?: number;
    verdict?: string;
    ran_at?: string;
  };
  verifier_subagent?: {
    invoked_via?: string;
    prompt_template?: string;
    report_path?: string;
    verdict?: string;
    ran_at?: string;
  };
  trace_json?: {
    path?: string;
    exists?: boolean;
    schema_valid?: boolean;
  };
  context_exploration?: {
    summary_path?: string;
    exists?: boolean;
    ready_to_produce?: boolean;
    has_blocker_coverage_risk?: boolean;
  };
  self_check?: {
    q1_trace_json_abs_path?: string;
    q2_verifier_verdict_quoted?: string;
    q3_last_diff_file?: string;
    q4_no_hallucinated_rule_used?: boolean;
    q4_evidence?: string;
  };
  /** testing 阶段且 profile 未 SKIP device_test.run 时必填 */
  testing_run_artifacts?: {
    hylyre_run_exit_code?: number;
    hylyre_report_path?: string;
    hylyre_trace_path?: string;
    app_snapshot_cache_dir?: string;
  };
}

interface CheckIssue {
  id: string;
  severity: 'BLOCKER' | 'MAJOR' | 'INFO';
  message: string;
}

/** framework 根（repo 根或宿主 framework/ 目录）：本脚本恒位于 <frameworkRoot>/harness/scripts/ */
function frameworkRootFromHere(): string {
  return path.resolve(__dirname, '..', '..');
}

// --------------------------------------------------------------------------
// CLI
// --------------------------------------------------------------------------

function parseArgs() {
  const args = minimist(process.argv.slice(2), {
    string: ['feature', 'phase', 'project-root'],
    boolean: ['help', 'skip-state-sync'],
    alias: { f: 'feature', p: 'phase', h: 'help' },
  });

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const feature = args.feature as string | undefined;
  const rawPhase = args.phase as string | undefined;
  const phase = rawPhase ? (normalizePhaseId(rawPhase) as Phase) : undefined;
  const projectRoot = path.resolve(
    (args['project-root'] as string | undefined) ??
      // 默认假设脚本位于 <root>/framework/harness/scripts/，向上 3 级
      path.resolve(__dirname, '..', '..', '..'),
  );

  if (!feature) {
    console.error('错误：必须指定 --feature <name>');
    printHelp();
    process.exit(2);
  }
  if (!phase) {
    console.error('错误：必须指定 --phase <workflow feature phase>');
    printHelp();
    process.exit(2);
  }

  return {
    feature,
    phase,
    projectRoot,
    skipStateSync: Boolean(args['skip-state-sync']),
  };
}

function printHelp(): void {
  console.log(`
check-receipt.ts — 阶段完成回执校验（Layer 2 凭证）

用法：
  npx ts-node framework/harness/scripts/check-receipt.ts \\
    --feature <feature> \\
    --phase <spec|plan|coding|review|ut|testing>  （prd/design 仍接受为 alias）

可选：
  --project-root <abs-path>   显式指定仓库根（默认从 __dirname 向上推导）
  --skip-state-sync          内部用：校验通过但不写 .current-phase.json（harness-runner tryValidateReceipt）

说明：回执是 harness 的只读投影（schema 2.1），本命令先重新生成再校验；通过即 finalize closure。
`);
}

// --------------------------------------------------------------------------
// 主流程
// --------------------------------------------------------------------------

function main(): void {
  const { feature, phase, projectRoot, skipStateSync } = parseArgs();
  const frameworkRoot = path.resolve(__dirname, '..', '..');

  /**
   * f9c2e6b4 t1（二轮复核收敛）：**本文件所有 goal 分支的唯一判据**。
   *
   * 此前各处分别写 `isGoalOrchestrationEnv()`——而 adapter 工具子进程会丢 env
   * （phase-state.ts:107 实锤：cursor 丢 MAISON_GOAL_HEADLESS/RUNNER，只留 RUN_ID/ATTEMPT）。
   * 于是 agent 侧跑 check-receipt 时被误判成 interactive：evidence policy 走人工档、
   * slim 凭证的 run 绑定不校验、assumptions ledger 不校验、assess 投影成 manual。
   * **门禁被静默跳过比门禁判错更难发现**，所以这里一次算准、全文件复用。
   *
   * 并集是严格超集：gate harness（runner 直接 spawn，带 MAISON_GOAL_GATE_HARNESS=1）
   * 由 orchestration 位命中；agent 侧由 isAgentSideGoalHarness() 命中。
   */
  const inGoalReceiptContext = isGoalOrchestrationEnv() || isAgentSideGoalHarness();

  const fw = loadFrameworkConfig(projectRoot);
  // phase 合法性按 active workflow feature phase 集校验（C0 收编：不再持有硬编码枚举）
  try {
    assertWorkflowFeaturePhase(resolveWorkflowSpec(projectRoot, { config: fw }), phase);
  } catch (err) {
    console.error(`错误：${(err as Error).message}`);
    process.exit(2);
  }
  const workflowSpecForPlan = (() => {
    try {
      return resolveWorkflowSpec(projectRoot, { config: fw });
    } catch {
      return null;
    }
  })();
  const resolvedProfile = loadResolvedProfile(projectRoot, fw);
  if (isPhaseDisabledByProfile(phase, resolvedProfile)) {
    console.log(
      `\n🧾 check-receipt: feature=${feature}, phase=${phase}` +
        `\n   project_profile=${resolvedProfile.name} 已禁用该阶段（phases_disabled），跳过回执强制校验 → exit 0\n`,
    );
    process.exit(0);
  }

  // C2 verification-matrix：track/mode/config → evidence policy 求解。
  const track = resolveFeatureTrack(loadFeatureTrackDecl(projectRoot, feature));
  const runtimeCtx: RuntimeContext = {
    mode: inGoalReceiptContext ? 'goal' : 'interactive',
    adapter: fw.agent_adapter ?? 'generic',
    phase,
    workflow: fw.active_workflow ?? 'spec-driven',
    // plan a5f9c3e2 t1：能否问人取决于**当前 run owner**（session=会话内驱动、真人在旁；
    // process=脱离会话），不是「是不是 goal」——旧式 `!isGoalOrchestrationEnv()` 把
    // goal「有人在场」误判成无人。owner 动态可 handoff，故按 run-control 现值解析。
    can_prompt_user: canPromptNow(resolveRunOwnerKind(projectRoot, feature)),
    can_collect_usage: inGoalReceiptContext,
  };
  const evidenceConfig = { evidence_profile: fw.evidence_profile };
  const policy = resolveEvidencePolicy(track, runtimeCtx, evidenceConfig);
  const profileResolved = resolveProfileLabel(track, runtimeCtx, evidenceConfig);
  // plan a9d4e7c2 T1/T3：verifier 适用性与生产端**同一个解析器**——闭环侧不再自行
  // 用 `policy.verifier === 'off'` 二分（那会把"workflow 未声明"和"adapter 无能力"
  // 一起误判成"该有却缺失"）。结果不落盘，随时可重算。
  const verifierPlan: VerifierPlan = resolveVerifierPlan({
    phase,
    track,
    runtimeMode: runtimeCtx.mode,
    policy,
    workflowVerifierPrompt: workflowVerifierPrompt(workflowSpecForPlan, phase),
    phaseDisabledByProfile: false, // profile 禁用的 phase 已在上方 exit 0
    adapterCapability: resolveVerifierCapability(frameworkRoot, fw.agent_adapter),
    adapterName: fw.agent_adapter,
  });

  // lite track：receipt 机制架构性不适用（正常调用路径下 tryValidateReceipt 已在
  // phase-state.ts 短路、不会走到本进程；本分支是直接 CLI 调用的防御性兜底）——
  // 绝不当作 passed，也不触碰任何 state，交由 exit 阶段自身的 script-report 承载闭环。
  if (track === 'lite') {
    console.log(`\n🧾 check-receipt: feature=${feature}, phase=${phase}`);
    console.log(`   track=lite：receipt 机制不适用（evidence_policy_snapshot.profile_resolved=${profileResolved}）`);
    console.log('   闭环判据 = change.md checkbox 全勾 + exit 阶段 script-report verdict=PASS（非 receipt）。');
    console.log('   本命令不会写入 .current-phase.json；请改查 exit 阶段的 script-report.json。\n');
    process.exit(0);
  }

  const receiptResolved = resolveReceiptFilePath(projectRoot, feature, phase);
  const receiptPath = receiptResolved.path;
  const receiptRel = path.relative(projectRoot, receiptPath).replace(/\\/g, '/');

  console.log(`\n🧾 check-receipt: feature=${feature}, phase=${phase}`);
  console.log(`   回执路径: ${receiptRel}`);
  if (receiptResolved.usedLegacyDir) {
    console.log(
      `   ⚠ legacy 目录 phase=${receiptResolved.resolvedPhaseDir}（canonical=${phase}）；建议迁移至 spec/plan 目录`,
    );
  }
  console.log('');

  // plan 07a41ec6 T4：当前 schema 不读 receipt；闭环后才 best-effort 生成只读投影。
  // 3.0 之前手写的 legacy 回执（无 receipt_schema）在隔离分支按旧格式只读兼容。
  const currentSchema = readSummarySchemaVersion(projectRoot, feature, phase, frameworkRoot) === SUMMARY_SCHEMA_VERSION_CURRENT;
  const existingRaw = !currentSchema && fs.existsSync(receiptPath) ? fs.readFileSync(receiptPath, 'utf-8') : null;
  const existingIsLegacy = existingRaw !== null && !/^receipt_schema:\s*"?2\.[01]"?/m.test(existingRaw);

  let frontmatter: ReceiptFrontmatter;
  let bodyAfterFm = '';
  if (existingIsLegacy) {
    console.log('   legacy 回执（无 receipt_schema）：按旧格式只读校验，不重写');
    try {
      const parsed = parseFrontmatterAndBody(existingRaw!);
      frontmatter = parsed.frontmatter;
      bodyAfterFm = parsed.body;
    } catch (err) {
      console.error(`❌ FATAL: legacy 回执 YAML frontmatter 解析失败: ${(err as Error).message}`);
      process.exit(2);
    }
  } else {
    console.log(`   当前 schema：闭环只读 summary/verifier/policy；receipt_schema ${RECEIPT_PROJECTION_SCHEMA} 在 closed 后生成`);
    frontmatter = { feature, phase, receipt_schema: RECEIPT_PROJECTION_SCHEMA };
  }

  const issues: CheckIssue[] = [];

  // 1. feature/phase 字段一致
  if (frontmatter.feature !== feature) {
    issues.push({
      id: 'feature_mismatch',
      severity: 'BLOCKER',
      message: `frontmatter.feature="${frontmatter.feature ?? ''}" 与 CLI --feature="${feature}" 不一致。`,
    });
  }
  const fmPhaseRaw = frontmatter.phase ?? '';
  const fmPhaseNorm = fmPhaseRaw.trim()
    ? (normalizePhaseId(fmPhaseRaw.trim()) as Phase)
    : undefined;
  if (fmPhaseNorm !== phase) {
    issues.push({
      id: 'phase_mismatch',
      severity: 'BLOCKER',
      message: `frontmatter.phase="${fmPhaseRaw}" 与 CLI --phase="${phase}" 不一致（legacy prd/design 请改用 spec/plan）。`,
    });
  }

  // receipt-slim（plan e6a3c9f4 t2 / openspec receipt-slim）：receipt_schema=2.0 走瘦身契约——
  // 机器事实（harness verdict/blocker/fingerprint/trace 存在性）直读本次 base summary 与磁盘，
  // receipt 只承载不可派生自证；旧格式（无 receipt_schema）全量校验零变化。
  const receiptSchema = String((frontmatter as { receipt_schema?: unknown }).receipt_schema ?? '').trim();
  const isSlim = receiptSchema === '2.0' || receiptSchema === RECEIPT_PROJECTION_SCHEMA;
  const canonicalReportsDir = featurePhaseReportsDir(projectRoot, feature, phase, frameworkRoot);
  const canonicalReportsRel = path.relative(projectRoot, canonicalReportsDir).replace(/\\/g, '/');
  let slimSummary: { verdict?: string; blocker_count?: number; feature?: string; phase?: string; gate_fingerprint?: unknown } | null = null;

  if (isSlim) {
    const summaryPath = path.join(canonicalReportsDir, 'summary.json');
    if (!fs.existsSync(summaryPath)) {
      issues.push({
        id: 'slim_summary_missing',
        severity: 'BLOCKER',
        message:
          `瘦身回执的机器事实源 summary.json 缺失（${canonicalReportsRel}/summary.json）——` +
          '请先自跑 harness-runner 生成本次 base summary，再校验回执（summary 缺失不静默豁免）。',
      });
    } else {
      try {
        slimSummary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
      } catch {
        issues.push({
          id: 'slim_summary_unparseable',
          severity: 'BLOCKER',
          message: `summary.json 不是合法 JSON（${canonicalReportsRel}/summary.json）——重跑 harness 重新生成。`,
        });
      }
    }
    if (slimSummary) {
      // t2 v3（codex 高优4）：summary 须过完整 schema 子集校验（type/enum/$ref/pattern/
      // additionalProperties）——错误类型/非法嵌套/额外字段的伪 summary 不得过。
      try {
        const schemaPath = path.join(frameworkRoot, 'harness', 'schemas', 'summary.schema.json');
        const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8')) as Record<string, unknown>;
        const violations = validateLiteSchema(slimSummary, schema);
        if (violations.length > 0) {
          issues.push({
            id: 'slim_summary_schema_invalid',
            severity: 'BLOCKER',
            message:
              `summary.json 未通过 schema 校验（${violations.length} 处）：` +
              violations.slice(0, 8).map(v => `${v.path}: ${v.message}`).join('；') +
              '——瘦身回执的机器事实源必须是 harness 真实产出的完整 summary。',
          });
        }
      } catch (e) {
        issues.push({
          id: 'slim_summary_schema_invalid',
          severity: 'BLOCKER',
          message: `无法加载 summary.schema.json 做校验：${(e as Error).message}`,
        });
      }
      // t2 v2（codex BLOCKER3b）：run identity 三方绑定——summary.source_commit_sha 必须存在、
      // 等于回执 claimed sha、且等于当前 git HEAD；同版本 framework 下旧 PASS 件复用被 sha 拒绝。
      const summarySha = ((slimSummary as { source_commit_sha?: string }).source_commit_sha ?? '').trim();
      if (!summarySha) {
        issues.push({
          id: 'slim_summary_source_sha_missing',
          severity: 'BLOCKER',
          message:
            'summary.json 缺 source_commit_sha（run identity 锚）——请用当前版本 harness 重跑生成 base summary。',
        });
      } else {
        // v3（codex）：短 SHA 先解析为完整 SHA 再比较（claimed 允许 7-40 位）。
        const claimedRaw = (frontmatter.claimed_completion_commit_sha ?? '').trim();
        let claimedFull = claimedRaw;
        if (claimedRaw) {
          const resolveClaimed = spawnSync('git', ['rev-parse', `${claimedRaw}^{commit}`], {
            cwd: projectRoot,
            encoding: 'utf-8',
            shell: false,
          });
          if (resolveClaimed.status === 0) claimedFull = resolveClaimed.stdout.trim();
        }
        if (claimedFull && summarySha !== claimedFull) {
          issues.push({
            id: 'slim_summary_source_sha_mismatch',
            severity: 'BLOCKER',
            message:
              `summary.source_commit_sha=${summarySha} 与回执 claimed_completion_commit_sha=${claimedRaw} 不一致——` +
              'summary 与回执必须出自同一工作状态（旧 summary 冒充/回执后补皆拒）。',
          });
        }
        const headProbe = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, encoding: 'utf-8', shell: false });
        const headSha = headProbe.status === 0 ? headProbe.stdout.trim() : '';
        // v6（codex 第五轮 P1）：HEAD 解析失败=run identity 无法核实 → fail-closed BLOCKER，
        // 不得静默跳过 HEAD 绑定校验（slim 凭证链以 git 为前提）。
        if (!headSha) {
          issues.push({
            id: 'slim_summary_head_unverifiable',
            severity: 'BLOCKER',
            message:
              'git rev-parse HEAD 失败——当前 HEAD 无法核实时不得放行 summary 的 commit 绑定（fail-closed）；' +
              '排查 git 环境后重跑闭环校验。',
          });
        } else if (summarySha !== headSha) {
          issues.push({
            id: 'slim_summary_source_sha_stale',
            severity: 'BLOCKER',
            message:
              `summary.source_commit_sha=${summarySha} ≠ 当前 HEAD=${headSha}——` +
              'HEAD 已推进，summary 属旧工作状态；请重跑 harness 重新生成后再闭环。',
          });
        }
      }
      // t2 v3（codex 阻断3）：dirty worktree 绑定——重算产品层目录工作区摘要比对；
      // HEAD 不动但源码已改时旧 PASS 件失效。
      const summaryWorktree = ((slimSummary as { worktree_digest?: string }).worktree_digest ?? '').trim();
      if (!summaryWorktree) {
        issues.push({
          id: 'slim_summary_worktree_missing',
          severity: 'BLOCKER',
          message: 'summary.json 缺 worktree_digest——请用当前版本 harness 重跑生成 base summary。',
        });
      } else {
        const layerDirs = (fw.architecture?.outer_layers ?? []).map(l => l.id);
        const currentDigest = computeProductWorktreeDigest(projectRoot, layerDirs);
        // v6（codex 第五轮 P1，收紧 v5）：**只有两侧都是 16 hex 摘要（或双 no-layers 的
        // 确定性配置态）才允许相等比较**——no-git/unverifiable/未知哨兵一律 BLOCKER，
        // 构造性排除"两侧同错误常量假匹配"（no-git===no-git 曾可放行）。
        const HEX16 = /^[0-9a-f]{16}$/;
        const bothNoLayers = currentDigest === 'no-layers' && summaryWorktree === 'no-layers';
        if (!bothNoLayers && (!HEX16.test(currentDigest) || !HEX16.test(summaryWorktree))) {
          issues.push({
            id: 'slim_summary_worktree_unverifiable',
            severity: 'BLOCKER',
            message:
              `worktree_digest 无法核实（summary=${summaryWorktree}，当前重算=${currentDigest}）——` +
              '闭环只认成功生成的 16 hex 摘要；git 失败/文件不可读等哨兵值一律不放行（fail-closed）。' +
              '排查 git 环境与不可读文件后重跑 harness。',
          });
        } else if (summaryWorktree !== currentDigest) {
          issues.push({
            id: 'slim_summary_worktree_stale',
            severity: 'BLOCKER',
            message:
              `worktree_digest 失配（summary=${summaryWorktree}，当前=${currentDigest}）——` +
              '产品源码工作区状态已变（HEAD 未动也算），summary 属旧状态；请重跑 harness。',
          });
        }
      }
      // t2 v3（codex 阻断3）：goal 环境 run 身份绑定——同 commit 上 run A 的 summary 不得被
      // run B 复用。v4（codex 第三轮高优）fail-closed：goal 环境下当前 run id / summary run id
      // 任一缺失同样 BLOCKER，不得静默降级（与 §10 assumptions ledger 的 run identity 先例对齐）。
      if (inGoalReceiptContext) {
        const currentRunId = process.env.MAISON_GOAL_RUN_ID?.trim() ?? '';
        const summaryRunId = ((slimSummary as { run_id?: string }).run_id ?? '').trim();
        if (!currentRunId) {
          issues.push({
            id: 'slim_summary_run_identity_unavailable',
            severity: 'BLOCKER',
            message:
              'goal 环境缺 MAISON_GOAL_RUN_ID——run identity 是 slim 凭证绑定必填项，' +
              '传播链异常不得静默跳过校验（fail-closed）。',
          });
        } else if (!summaryRunId) {
          issues.push({
            id: 'slim_summary_run_id_missing',
            severity: 'BLOCKER',
            message:
              `goal 环境 summary.json 缺 run_id（当前 run=${currentRunId}）——` +
              '旧版/非本 run 产物不得闭环；请在本 run 内重跑 harness 重新生成。',
          });
        } else if (summaryRunId !== currentRunId) {
          issues.push({
            id: 'slim_summary_run_id_mismatch',
            severity: 'BLOCKER',
            message:
              `summary.run_id=${summaryRunId} ≠ 当前 goal run=${currentRunId}——` +
              '跨 run 复用 summary 被拒；请在本 run 内重跑 harness。',
          });
        }
      }
      if (slimSummary.feature !== feature || slimSummary.phase !== phase) {
        issues.push({
          id: 'slim_summary_identity_mismatch',
          severity: 'BLOCKER',
          message:
            `summary.json 身份不匹配：feature=${slimSummary.feature ?? '<missing>'}/phase=${slimSummary.phase ?? '<missing>'}，` +
            `期望 ${feature}/${phase}（canonical path 按 feature/phase 解析，防串目录/串阶段）。`,
        });
      }
      if ((slimSummary.verdict ?? '').toUpperCase() !== 'PASS') {
        issues.push({
          id: 'slim_summary_not_pass',
          severity: 'BLOCKER',
          message: `本次 base summary verdict=${slimSummary.verdict ?? '<missing>'}，必须为 PASS（含 INCOMPLETE 不放行）。`,
        });
      }
      if (slimSummary.blocker_count !== 0) {
        issues.push({
          id: 'slim_summary_blockers_present',
          severity: 'BLOCKER',
          message: `本次 base summary blocker_count=${slimSummary.blocker_count ?? '<missing>'}，必须为 0。`,
        });
      }
      const staleReason = assertGateFingerprintFresh(slimSummary, frameworkRootFromHere(), phase);
      if (staleReason) {
        issues.push({
          id: 'gate_fingerprint_stale',
          severity: 'BLOCKER',
          message: `【回执 stale】${staleReason}`,
        });
      }
    }
  }

  // 2. script_harness 必须 exit_code=0 且零 BLOCKER（legacy 格式；slim 已由 summary 直读承载）
  const sh = frontmatter.script_harness ?? {};
  if (!isSlim) {
  if (sh.exit_code !== 0) {
    issues.push({
      id: 'script_harness_not_pass',
      severity: 'BLOCKER',
      message: `script_harness.exit_code=${sh.exit_code ?? '<missing>'}, 必须为 0。`,
    });
  }
  if (typeof sh.blocker_count !== 'number' || sh.blocker_count > 0) {
    issues.push({
      id: 'script_harness_blocker_present',
      severity: 'BLOCKER',
      message: `script_harness.blocker_count=${sh.blocker_count ?? '<missing>'}, 必须为 0。`,
    });
  }
  const harnessVerdict = (sh.verdict ?? '').toUpperCase();
  if (harnessVerdict === 'INCOMPLETE') {
    issues.push({
      id: 'script_harness_incomplete',
      severity: 'BLOCKER',
      message:
        'script_harness.verdict=INCOMPLETE：编译通过但设备不可用，不允许宣称 UT 阶段完成；请接入设备后重跑 harness。',
    });
  }

  // P0-7④：回执 command 注入特征校验——2026-07-05 伪签事故中回执 script_harness.command 原样
  // 自曝 `$env:NODE_OPTIONS='--require …auto-fill.cjs'` 且 blocker_count=0（伪造在该次自跑中通关）。
  const injectionSignatures = scanCommandForPreloadInjection(sh.command);
  if (injectionSignatures.length > 0) {
    issues.push({
      id: 'script_harness_command_injection',
      severity: 'BLOCKER',
      message:
        `script_harness.command 含进程预加载注入特征（${injectionSignatures.join('; ')}）——` +
        `harness 必须在干净环境运行，预加载 hook 可篡改门禁产物；清除注入后重跑 harness 并重填回执。`,
    });
  }
  if (sh.report_dir) {
    const summaryPath = path.join(projectRoot, sh.report_dir, 'summary.json');
    if (fs.existsSync(summaryPath)) {
      try {
        const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8')) as {
          verdict?: string;
          gate_fingerprint?: unknown;
        };
        if ((summary.verdict ?? '').toUpperCase() === 'INCOMPLETE') {
          issues.push({
            id: 'summary_verdict_incomplete',
            severity: 'BLOCKER',
            message:
              `summary.json verdict=INCOMPLETE（${path.relative(projectRoot, summaryPath).replace(/\\/g, '/')}）；UT 阶段未闭环。`,
          });
        }
        // 回执 stale 治理（2026-07-03）：summary 的机器指纹须与当前门禁集一致——
        // framework 升级（rules 变化）后旧回执不得继续豁免阶段（round6 Checkpoint-2：
        // 旧 spec 回执"启动前已闭环"整体绕过 P0-D 新门禁的实锤洞）。goal/普通模式共用本校验点。
        const staleReason = assertGateFingerprintFresh(summary, frameworkRootFromHere(), phase);
        if (staleReason) {
          issues.push({
            id: 'gate_fingerprint_stale',
            severity: 'BLOCKER',
            message: `【回执 stale】${staleReason}`,
          });
        }
      } catch {
        /* ignore corrupt summary */
      }
    }
  }
  } // end !isSlim（legacy §2 script_harness）

  // C2：非 BLOCKER 的证据缺项（如 optional 档 trace 缺失）单独记录，不影响 pass/fail 判定。
  const warnings: CheckIssue[] = [];
  const observed: Partial<Record<keyof EvidencePolicy, EvidenceValidationStatus>> = {};

  // 3. verifier（真验真——不再信回执手填 verdict + 文件存在）
  //
  // **分派两问，各有各的锚**（plan a9d4e7c2 T3 重键；subject 在场与否**不再**是分派锚——
  // 它曾同时背着协议代际、适用性、证据身份三种职责，于是"被合法关掉"读成了"旧件"）：
  //   ① 适不适用？→ resolveVerifierPlan：disabled 零要求 / blocked 直接 BLOCKER / enabled 继续；
  //   ② 是哪一代？→ summary.schema_version：当代要求 request 化证据；上一代 closed ∧ 旧
  //      manifest fresh 走 grandfather，否则指引重跑该 phase 的 harness。
  // 回执手填 invoked_via/report_path/verdict/ran_at 已**退出裁决权威**，只留兼容投影
  //（与机器事实不符时降为 WARN，不再据以判 PASS/FAIL）。
  const vs = frontmatter.verifier_subagent ?? {};
  let verifierEvidence: VerifierEvidence | null = null;
  // plan 07a41ec6 T7：沿用既往 PASS 闭环时的登记（null = 当前 subject 自身已验真，闭环时清除旧登记）
  let verifierClosure: VerifierClosureRecord | null = null;
  if (verifierPlan.mode === 'disabled') {
    // **缺席即为零**：不调用 loader，JSON/MD/request 均不要求。磁盘上残留的旧
    // prompt/request/report 不得把这条轴重新激活（plan a9d4e7c2 否决闸）。
    observed.verifier =
      verifierPlan.reason === 'policy_not_applicable' || verifierPlan.reason === 'phase_disabled_by_profile'
        ? 'not_applicable'
        : 'skipped_by_policy';
    console.log(`   ℹ verifier: ${verifierPlan.message}`);
  } else if (verifierPlan.mode === 'blocked') {
    // 到这里说明脚本门禁已经跑完（harness 侧的阶梯已把真实失败如实报过），
    // 闭环入口只负责不放行——不重复诊断、也不假装通过。
    observed.verifier = 'missing';
    issues.push({
      id: 'verifier_provider_unavailable',
      severity: 'BLOCKER',
      message: `【verifier 能力不可用】${verifierPlan.message}`,
    });
  } else {
    const summarySchemaVersion = readSummarySchemaVersion(projectRoot, feature, phase, frameworkRoot);
    const verifierSubjectId = readSummaryVerifierSubjectId(projectRoot, feature, phase, frameworkRoot);
    // **分派重键**（plan a9d4e7c2 T3）：代际靠 schema_version，不再靠"subject 在不在"。
    //   · 当代 summary → 必须有 request 化 subject 与验真通过的 JSON；
    //   · 上一代 summary → grandfather：closed ∧ 旧 manifest fresh 即按旧登记面复核。
    const currentGeneration = summarySchemaVersion === SUMMARY_SCHEMA_VERSION_CURRENT;
    if (currentGeneration && verifierSubjectId) {
      const loaded = loadVerifierEvidence(projectRoot, feature, phase, { frameworkRoot });
      // plan 07a41ec6 T7：当前 subject 无报告，但本 phase 历史已有 PASS → 沿用（completed_with_prior_review），
      // 把未重审的材料差异如实登记；从未 PASS 过才是 BLOCKER（至少要完整审一次）。
      const priorPass =
        !loaded.ok && loaded.code === 'report_missing'
          ? findPriorPassVerifierEvidence(projectRoot, feature, phase, { frameworkRoot, excludeSubject: verifierSubjectId })
          : null;
      if (!loaded.ok && priorPass) {
        const reportsDirAbs = featurePhaseReportsDir(projectRoot, feature, phase, frameworkRoot);
        const notReverified = diffVerifierMaterial(
          readVerifierMaterialOrNull(reportsDirAbs, priorPass.subject_id),
          readVerifierMaterialOrNull(reportsDirAbs, verifierSubjectId),
        );
        verifierEvidence = priorPass;
        observed.verifier = 'provided';
        verifierClosure = {
          mode: 'completed_with_prior_review',
          reviewed_subject_id: priorPass.subject_id,
          current_subject_id: verifierSubjectId,
          current_material_not_reverified: notReverified,
        };
        warnings.push({
          id: 'verifier_prior_pass_reused',
          severity: 'MAJOR',
          message:
            `verifier 沿用既往 PASS（subject ${priorPass.subject_id.slice(0, 12)}…，${priorPass.json_path_rel}）；` +
            `当前材料未经重审：${notReverified.join('、') || '（无差异记录）'}。` +
            '语义结论只在首轮完整审查，之后只核对；如确需对当前材料重审，把 summary.verifier_request 指向的 request JSON 整段投给 verifier。',
        });
      } else if (!loaded.ok) {
        observed.verifier = 'missing';
        issues.push({
          id: `verifier_evidence_${loaded.code}`,
          severity: 'BLOCKER',
          message:
            `【verifier 证据验真失败】${loaded.message}` +
            (loaded.code === 'report_missing' ? '（本 phase 尚无任何 PASS 的 verifier 报告可沿用——至少要完整审一次。）' : ''),
        });
      } else {
        verifierEvidence = loaded.evidence;
        observed.verifier = 'provided';
        if (verifierEvidence.verdict !== 'PASS') {
          issues.push({
            id: 'verifier_not_pass',
            severity: 'BLOCKER',
            message:
              `verifier 机器结论 verdict=${verifierEvidence.verdict}（blocker_count=${verifierEvidence.blocker_count}，` +
              `来源 ${verifierEvidence.json_path_rel}），必须为 PASS。修复缺陷后重跑 verifier——改回执不构成通过。`,
          });
        }
        // 兼容投影核对（非裁决面）：手填字段与机器事实不符只提示，不影响 pass/fail。
        const declaredVerdict = (vs.verdict ?? '').trim().toUpperCase();
        if (declaredVerdict && declaredVerdict !== verifierEvidence.verdict) {
          warnings.push({
            id: 'verifier_receipt_projection_drift',
            severity: 'MAJOR',
            message:
              `回执 verifier_subagent.verdict="${vs.verdict}" 与机器真源 ${verifierEvidence.json_path_rel} ` +
              `的 verdict=${verifierEvidence.verdict} 不一致；手填字段已退出裁决权威（兼容投影），请照机器事实回填。`,
          });
        }
      }
    } else if (currentGeneration) {
      // 当代 summary 却没有 subject：能力已启用但本轮没写出 request
      //（Step 4 崩栈、prompt 不可读、凭证落盘失败）。重跑 harness 即可，别改文书。
      observed.verifier = 'missing';
      issues.push({
        id: 'verifier_request_absent',
        severity: 'BLOCKER',
        message:
          `summary.json 缺 verifier_subject_id / verifier_request（${canonicalReportsRel}/summary.json），` +
          `但本 phase 的 verifier 能力已启用（${verifierPlan.reason}）——本轮没有生成调用凭证。` +
          '正确路径：重跑该 phase 的 harness（分钟级）→ 把新生成的 verifier.request.<subject>.json 整段投给 verifier → 重跑本检查。',
      });
    } else {
      observed.verifier = 'missing';
      const closed = readSummaryClosureStatus(projectRoot, feature, phase, frameworkRoot) === 'closed';
      const manifestFresh =
        closed &&
        recomputePhaseEvidenceStaleness(projectRoot, feature, [phase], { frameworkRoot })[0]?.verdict === 'fresh';
      if (manifestFresh) {
        // grandfather：上一代闭环沿其**当时的登记面**复核，不解析 MD、不要求当代 request。
        // 主动重跑 check-receipt = 复核旧 closure，**不构成重新裁决**——重新裁决只随新
        // harness run（summary 重生成为当代、subject 按新材料寻址）进入。
        observed.verifier = 'provided';
        console.log(
          `   ℹ verifier: grandfather（summary schema=${summarySchemaVersion ?? '缺失'} 的上一代闭环；` +
            '按旧 evidence manifest 登记面复核，当前仍 fresh）',
        );
      } else {
        issues.push({
          id: 'verifier_summary_generation_stale',
          severity: 'BLOCKER',
          message:
            `summary schema_version=${summarySchemaVersion ?? '缺失'}（${canonicalReportsRel}/summary.json），` +
            `非当代 ${SUMMARY_SCHEMA_VERSION_CURRENT}——上一代产物只有"已 closed ∧ 旧 evidence manifest 仍 fresh"时才 grandfather。` +
            '正确路径：重跑该 phase 的 harness（生成当代 summary + verifier.request.<subject>.json，分钟级）→ ' +
            '把该 request JSON 整段投给 verifier → 重跑本检查。不回退业务代码、不重写上游产物。' +
            (closed ? '（本阶段虽已 closed，但旧 evidence manifest 已非 fresh，不适用 grandfather。）' : ''),
        });
      }
    }
  }

  // 4. trace.json 凭证（policy.trace === 'optional' 时"缺失"降 WARN；"提供但损坏"恒 BLOCKER——
  //    劣质凭证比没凭证更危险，optional 只豁免"不提供"，不豁免"提供假的"）
  //    slim：不再经 receipt 手抄字段，直查 canonical 路径磁盘存在性与可解析性。
  const tj = frontmatter.trace_json ?? {};
  let traceProvided: boolean;
  let traceDisplay: string;
  if (isSlim) {
    const traceAbsSlim = path.join(canonicalReportsDir, 'trace.json');
    traceProvided = fs.existsSync(traceAbsSlim);
    traceDisplay = traceProvided ? `${canonicalReportsRel}/trace.json（磁盘直查存在）` : `未发现（${policy.trace} 档）`;
    observed.trace = traceProvided ? 'provided' : 'missing';
    if (!traceProvided) {
      if (policy.trace === 'required') {
        issues.push({
          id: 'trace_json_file_not_found',
          severity: 'BLOCKER',
          message: `trace.json 在 canonical 路径不存在（${canonicalReportsRel}/trace.json）——阶段遥测凭证缺失。`,
        });
      } else {
        warnings.push({
          id: 'trace_json_missing_optional',
          severity: 'MAJOR',
          message: `trace 为 optional 档，缺失不阻塞（${canonicalReportsRel}/trace.json）——建议仍尽量提供。`,
        });
      }
    } else {
      try {
        JSON.parse(fs.readFileSync(traceAbsSlim, 'utf-8'));
      } catch {
        issues.push({
          id: 'trace_json_not_parseable',
          severity: 'BLOCKER',
          message: `${canonicalReportsRel}/trace.json 不是合法 JSON。`,
        });
      }
    }
  } else {
  traceProvided = tj.exists === true && Boolean(tj.path);
  traceDisplay = traceProvided ? `${tj.path}（存在）` : `未提供（${policy.trace} 档）`;
  observed.trace = traceProvided ? 'provided' : 'missing';
  if (!traceProvided) {
    const traceMissingDetail = `trace_json.exists=${tj.exists ?? '<missing>'}, trace_json.path=${tj.path ?? '<missing>'}`;
    if (policy.trace === 'required') {
      if (tj.exists !== true) {
        issues.push({
          id: 'trace_json_exists_false',
          severity: 'BLOCKER',
          message: `trace_json.exists=${tj.exists ?? '<missing>'}, 必须为 true。`,
        });
      }
      if (!tj.path) {
        issues.push({
          id: 'trace_json_path_missing',
          severity: 'BLOCKER',
          message: 'trace_json.path 未填写。',
        });
      }
    } else {
      warnings.push({
        id: 'trace_json_missing_optional',
        severity: 'MAJOR',
        message: `trace 为 optional 档，缺失不阻塞（${traceMissingDetail}）——建议仍尽量提供。`,
      });
    }
  } else {
    const traceAbs = path.resolve(projectRoot, tj.path!);
    if (!fs.existsSync(traceAbs)) {
      issues.push({
        id: 'trace_json_file_not_found',
        severity: 'BLOCKER',
        message: `trace_json.path="${tj.path}" 在文件系统中不存在（提供了却是假的，optional 不豁免——全局入口 §5.1）。`,
      });
    } else if (tj.schema_valid !== false) {
      // 尽可能解析一下
      try {
        JSON.parse(fs.readFileSync(traceAbs, 'utf-8'));
      } catch {
        issues.push({
          id: 'trace_json_not_parseable',
          severity: 'BLOCKER',
          message: `trace_json.path="${tj.path}" 不是合法 JSON。`,
        });
      }
    }
  }
  } // end !isSlim（legacy §4 trace_json）

  // 3.5 context_exploration（与 Context Exploration Gate 对齐；policy.exploration === 'off'/'not_applicable' 时不检）
  //     slim：exploration 由各 phase 门禁的 facts gate（checkFactsArtifact）承载，receipt 不再手抄；
  //     此处按 policy 记 observed（facts gate 未过时 base summary 本就不会 PASS）。
  const ce = frontmatter.context_exploration ?? {};
  if (isSlim) {
    observed.exploration = policy.exploration === 'off' || policy.exploration === 'not_applicable'
      ? 'skipped_by_policy'
      : 'provided';
  } else {
  observed.exploration = ce.exists === true ? 'provided' : 'missing';
  if (policy.exploration === 'off' || policy.exploration === 'not_applicable') {
    // 矩阵当前所有 full 分支恒 required；此分支只在未来矩阵调整时生效，现状不可达。
  } else if (ce.exists !== true) {
    issues.push({
      id: 'context_exploration_exists_false',
      severity: 'BLOCKER',
      message: `context_exploration.exists=${ce.exists ?? '<missing>'}, 必须为 true。`,
    });
  }
  const cePath = (ce.summary_path ?? '').trim();
  if (!cePath) {
    issues.push({
      id: 'context_exploration_summary_path_missing',
      severity: 'BLOCKER',
      message: 'context_exploration.summary_path 未填写。',
    });
  } else {
    const ceAbs = path.resolve(projectRoot, cePath);
    if (!fs.existsSync(ceAbs)) {
      issues.push({
        id: 'context_exploration_file_not_found',
        severity: 'BLOCKER',
        message: `context_exploration.summary_path="${cePath}" 在文件系统中不存在。`,
      });
    }
  }
  if (ce.ready_to_produce !== true) {
    issues.push({
      id: 'context_exploration_not_ready',
      severity: 'BLOCKER',
      message: `context_exploration.ready_to_produce=${ce.ready_to_produce ?? '<missing>'}, 必须为 true。`,
    });
  }
  if (ce.has_blocker_coverage_risk === true) {
    issues.push({
      id: 'context_exploration_blocker_risk',
      severity: 'BLOCKER',
      message: 'context_exploration.has_blocker_coverage_risk=true，不得在完成回执中宣称阶段闭环。',
    });
  }
  } // end !isSlim（legacy §3.5 context_exploration）

  // 4.5 testing_run_artifacts（Hylyre 子产物；仅 phase=testing 且 device_test.run 非 SKIP）
  if (!isSlim && phase === 'testing' && !isCapabilitySkipped(resolvedProfile, 'device_test.run')) {
    const tra = frontmatter.testing_run_artifacts ?? {};
    if (typeof tra.hylyre_run_exit_code !== 'number') {
      issues.push({
        id: 'testing_run_artifacts_exit_code_missing',
        severity: 'BLOCKER',
        message: `testing_run_artifacts.hylyre_run_exit_code 必须为数字，收到 ${String(tra.hylyre_run_exit_code ?? '<missing>')}。`,
      });
    }
    const repRel = (tra.hylyre_report_path ?? '').trim();
    const trcRel = (tra.hylyre_trace_path ?? '').trim();
    const cacheRel = (tra.app_snapshot_cache_dir ?? '').trim();
    if (!repRel) {
      issues.push({
        id: 'testing_run_artifacts_report_missing',
        severity: 'BLOCKER',
        message: 'testing_run_artifacts.hylyre_report_path 未填写。',
      });
    }
    if (!trcRel) {
      issues.push({
        id: 'testing_run_artifacts_trace_missing',
        severity: 'BLOCKER',
        message: 'testing_run_artifacts.hylyre_trace_path 未填写。',
      });
    }
    if (!cacheRel) {
      issues.push({
        id: 'testing_run_artifacts_cache_missing',
        severity: 'BLOCKER',
        message: 'testing_run_artifacts.app_snapshot_cache_dir 未填写。',
      });
    }
    if (repRel) {
      const repAbs = path.resolve(projectRoot, repRel);
      if (!fs.existsSync(repAbs)) {
        issues.push({
          id: 'testing_run_artifacts_report_not_found',
          severity: 'BLOCKER',
          message: `testing_run_artifacts.hylyre_report_path="${repRel}" 在文件系统中不存在。`,
        });
      }
    }
    if (trcRel) {
      const trcAbs = path.resolve(projectRoot, trcRel);
      if (!fs.existsSync(trcAbs)) {
        issues.push({
          id: 'testing_run_artifacts_hylyre_trace_not_found',
          severity: 'BLOCKER',
          message: `testing_run_artifacts.hylyre_trace_path="${trcRel}" 在文件系统中不存在。`,
        });
      } else {
        try {
          const hylyreTrace = JSON.parse(fs.readFileSync(trcAbs, 'utf-8')) as Record<string, unknown>;
          if (typeof hylyreTrace.feature !== 'string' || typeof hylyreTrace.outcome !== 'string') {
            issues.push({
              id: 'testing_run_artifacts_trace_schema_soft_fail',
              severity: 'BLOCKER',
              message:
                'Hylyre trace.json 缺少软校验必填字段：`feature`（string）与 `outcome`（string）。',
            });
          }
          if (
            hylyreTrace.phase !== undefined &&
            hylyreTrace.phase !== null &&
            String(hylyreTrace.phase) !== 'testing'
          ) {
            issues.push({
              id: 'testing_run_artifacts_trace_phase_mismatch',
              severity: 'BLOCKER',
              message: `Hylyre trace.json phase=「${String(hylyreTrace.phase)}」，期望 testing。`,
            });
          }
        } catch (e) {
          issues.push({
            id: 'testing_run_artifacts_trace_not_json',
            severity: 'BLOCKER',
            message: `无法解析 Hylyre trace.json：${(e as Error).message}`,
          });
        }
      }
    }
  }

  // 5.（已删除，plan 07a41ec6 T4）commit sha 由 summary.source_commit_sha 投影，不再手抄、不再 git cat-file 复核。

  // 6–9.（已删除，plan 07a41ec6 T4）self_check 问答与反假设 checkbox 是代理自证，不构成机器事实；
  //      宿主 2026-09-02 回归 check-receipt 41 次全在修这些字段。备注写 <phase>/notes.md。

  // 10. goal 环境：自动决议账本 schema + registry 完整性（goal-fakepass-hardening t1）
  //     JSONL 为判定 SSOT（markdown 仅人读投影）；registry 不可读同样 fail-closed——
  //     bc-openCard 洞⑤：留痕解析静默失败让待复核清单消失，本门禁把留痕升为闭环硬条件。
  // f9c2e6b4 t1：goal 下 `claimed_attempt_id` **必填且须等于本次 attempt**。
  // 它是完成观测判"这份回执属不属于本轮"的唯一凭据——立项事故（run 20260803T103413Z-3f72a8）
  // 正是"旧回执原样复写"骗停了两次 attempt；observer 现已严格要求该字段，门禁必须把它变成
  // 硬条件，否则 agent 不填 → observer 永不命中 → 跑到 hard timeout。
  //
  // **谓词取并集（codex 复核订正）**：不能只用 isGoalOrchestrationEnv()——仓内已实锤
  // adapter 工具子进程会丢 env（phase-state.ts:107：2026-07-27 宿主实锤 cursor 丢
  // MAISON_GOAL_HEADLESS 只留 RUN_ID/ATTEMPT，"单一信号判定必翻车"）。复用既有
  // isAgentSideGoalHarness()，不新造谓词。
  // plan b3e8d4c7 t1：attempt 等值**只在同 phase 内成立**。
  // 宿主实锤（run 20260804T033834Z-99c0a1）：coding attempt(i5) 里按门禁指引回上游重跑
  // plan harness，plan 回执写的是 plan 自己的 attempt(i3)——跨阶段复验结构上永远不可能
  // 通过（填 i3≠i5，改 i5=伪造），把框架自己指的修复路堵死。
  // 跨阶段回执的新鲜度由 run_id 绑定 + evidence manifest + sha 三重承担，本就不缺 attempt。
  if (!isSlim && inGoalReceiptContext) {
    const currentAttempt = process.env.MAISON_GOAL_ATTEMPT?.trim();
    const attemptPhase = process.env.MAISON_GOAL_ATTEMPT_PHASE?.trim();
    const claimedAttempt = frontmatter.claimed_attempt_id?.trim();
    // 缺 phase 上下文 fail-closed：否则 cursor 丢 env 形态下新 env 一丢，
    // 门禁又被静默跳过（f9c2e6b4 三轮复核同款坑，不再踩第二次）。
    // 跨阶段**只跳过最后的等值比较**——身份字段的存在性一律无条件校验，
    // 否则跨阶段复验会接受一份完全没有 attempt 身份的回执（codex 复核 P1）。
    if (currentAttempt && !attemptPhase) {
      issues.push({
        id: 'receipt_attempt_identity',
        severity: 'BLOCKER',
        message:
          'goal 信号与 MAISON_GOAL_ATTEMPT 在场但缺 MAISON_GOAL_ATTEMPT_PHASE——' +
          'attempt 所属 phase 是判定"能否做 attempt 等值"的前提，环境传播链异常不得静默降级（fail-closed）。',
      });
    } else if (!currentAttempt) {
      // goal 信号在场却没有 attempt：是环境传播链异常，不是"非 goal"——静默跳过等于把
      // 本门禁关掉（与上面 MAISON_GOAL_RUN_ID 缺失同一处置口径）。
      issues.push({
        id: 'receipt_attempt_identity',
        severity: 'BLOCKER',
        message:
          'goal 信号在场但缺 MAISON_GOAL_ATTEMPT——attempt identity 是闭环必填项，' +
          '环境传播链异常不得静默降级（fail-closed）。',
      });
    } else if (!claimedAttempt) {
      issues.push({
        id: 'receipt_attempt_identity',
        severity: 'BLOCKER',
        message:
          `回执缺 claimed_attempt_id——goal 态该字段由 runner 在骨架中预填（当前 attempt=${currentAttempt}）。` +
          '骨架缺失/被删时重跑本阶段 harness 重新生成；不要手填或从别处抄写身份值。',
      });
    } else if (attemptPhase === phase && claimedAttempt !== currentAttempt) {
      // **只有同阶段**才做等值：跨阶段时 currentAttempt 属于别的 phase，比了必假
      //（宿主实锤：coding 的 i5 比 plan 回执的 i3，无解死锁）。
      issues.push({
        id: 'receipt_attempt_identity',
        severity: 'BLOCKER',
        message:
          `回执 claimed_attempt_id="${claimedAttempt}" 与本次 attempt="${currentAttempt}" 不一致` +
          '——身份字段由 runner 预填，不一致通常是旧 attempt 回执残留或该字段被手改；' +
          '不要手写/猜测身份值，重跑本阶段 harness（或等 runner 重建骨架）后只填自证字段。',
      });
    }
  }

  // headless-assumptions 账本闭环否决已退役（openspec runner-owned-machine-facts；宿主
  // 实锤 run 20260815T083127Z-edfe38：账本是 feature 级跨 run 累积留痕，58 条旧 run 行被
  // run 绑定判"非法"+2 条初 run 已物化的决议被判"缺登记"，一份完整且身份等值的回执因此
  // 恒 failed）。账本自身声明"仅留痕、不构成授权"——留痕不得反向拥有 closure 否决权；
  // feature_path/terminology 等已有真正门禁复核，无需账本重复证明。run identity 的
  // fail-closed 对账由上方 slim summary 段承载（slim_summary_run_identity_unavailable）。

  // --------------------------------------------------------------------
  // 输出
  // --------------------------------------------------------------------

  if (issues.length === 0) {
    const mmAdvisory = collectMultimodalEvidenceAdvisory(
      projectRoot,
      frameworkRoot,
      phase,
      feature,
      fw,
    );
    if (mmAdvisory) {
      patchSummarySoftAdvisory(projectRoot, isSlim ? canonicalReportsRel : sh.report_dir, mmAdvisory);
      if (mmAdvisory.status === 'WARN') {
        console.warn(`\n⚠️  [MAJOR/WARN] ${mmAdvisory.id}: ${mmAdvisory.details}\n`);
      } else if (mmAdvisory.status === 'SKIP') {
        console.warn(`\nℹ️  [SKIP] ${mmAdvisory.id}: ${mmAdvisory.details}\n`);
      }
      console.log(
        `HARNESS_ADVISORY id=${mmAdvisory.id} status=${mmAdvisory.status} effective_image_input=${mmAdvisory.effective_image_input ?? 'n/a'}`,
      );
    }
    console.log(`✅ PASS — 闭环条件校验通过${isSlim ? '（当前 schema：机器事实直读 base summary/verifier/policy）' : '（legacy receipt 只读兼容）'}。`);
    console.log(
      isSlim
        ? `   - base summary: verdict=PASS, blocker_count=0, fingerprint fresh（${canonicalReportsRel}/summary.json）`
        : '   - script_harness: exit_code=0, blocker_count=0',
    );
    console.log(
      `   - verifier_subagent: ${
        verifierPlan.mode === 'disabled'
          ? `${observed.verifier}（${verifierPlan.reason}）`
          : verifierEvidence
            ? `verdict=${verifierEvidence.verdict}（机器真源 ${verifierEvidence.json_path_rel}，subject=${verifierEvidence.subject_id.slice(0, 12)}…，agent=${verifierEvidence.agent_id}）${verifierClosure ? '，沿用既往 PASS（completed_with_prior_review）' : ''}`
            : 'grandfather（上一代闭环，按旧 evidence manifest 登记面复核）'
      }`,
    );
    console.log(`   - trace_json: ${traceDisplay}`);
    console.log(`   - commit_sha: ${(slimSummary as { source_commit_sha?: unknown } | null)?.source_commit_sha ?? frontmatter.claimed_completion_commit_sha ?? '(unknown)'}（summary 投影）`);
    if (warnings.length > 0) {
      console.log('');
      console.log(`⚠️  ${warnings.length} 项非阻塞提示：`);
      for (const w of warnings) console.log(`  [${w.severity}] ${w.id}: ${w.message}`);
    }
    console.log('');
    console.log(
      '阶段闭环判定（全局入口 §5.1）：脚本 verdict PASS ∧ 全部 required 证据已提供，可放行' +
        `（evidence_profile=${profileResolved}）。\n`,
    );

    const evidencePolicySnapshot = buildEvidencePolicySnapshot(policy, profileResolved, observed);
    console.log(
      `HARNESS_EVIDENCE_POLICY profile_resolved=${profileResolved} verifier=${evidencePolicySnapshot.items.verifier.validation_status} trace=${evidencePolicySnapshot.items.trace.validation_status} exploration=${evidencePolicySnapshot.items.exploration.validation_status}`,
    );

    if (!skipStateSync) {
      const receiptValidation = {
        status: 'passed' as const,
        receipt_path: receiptRel,
        exit_code: 0,
      };
      try {
        const finalized = finalizePhaseClosure({
          projectRoot,
          frameworkRoot,
          feature,
          phase,
          blockerCount:
            isSlim
              ? slimSummary?.blocker_count ?? 0
              : typeof sh.blocker_count === 'number'
                ? sh.blocker_count
                : 0,
          evidencePolicySnapshot,
          summaryPatch: { verifier_closure: verifierClosure },
          persistPhaseState: () =>
            syncPhaseStateOnReceiptPassStrict(
              projectRoot,
              feature,
              phase as FeaturePhase,
              receiptValidation,
              {
                blocker_count:
                  isSlim
                    ? slimSummary?.blocker_count ?? 0
                    : typeof sh.blocker_count === 'number'
                      ? sh.blocker_count
                      : 0,
                frameworkRoot,
                evidence_policy_snapshot: evidencePolicySnapshot,
              },
            ),
        });
        console.log(
          `   closure_commit ${finalized.transitioned ? 'published' : 'already current'}：` +
            `${finalized.closure_fingerprint.slice(0, 16)} (${finalized.manifest_path})`,
        );
      } catch (err) {
        console.error(`\n❌ BLOCKER — 闭环产物生成失败（closure 不成立）：${(err as Error).message}`);
        process.exit(1);
      }
    }

    if (!skipStateSync) {
      assessAndRenderNextStep({
        projectRoot,
        frameworkRoot,
        feature,
        phase,
        mode: inGoalReceiptContext ? 'goal_mode' : 'manual',
        status: 'PASS/closed',
      });
    }

    process.exit(0);
  }

  console.error('❌ BLOCKER — 完成回执校验未通过：\n');
  for (const it of issues) {
    console.error(`  [${it.severity}] ${it.id}: ${it.message}`);
  }
  console.error('');
  console.error('修复指引：');
  console.error('  1. 回执由 harness 投影生成，改它不改变判定；缺什么补什么：跑 harness、调用 verifier、生成 trace.json。');
  console.error('  2. 补齐后重跑本命令（或 harness-runner --sync-closure）即 finalize；备注写 <phase>/notes.md。');
  console.error('');
  process.exit(1);
}

// --------------------------------------------------------------------------
// frontmatter 解析
// --------------------------------------------------------------------------

function parseFrontmatterAndBody(raw: string): {
  frontmatter: ReceiptFrontmatter;
  body: string;
} {
  const trimmed = raw.replace(/^\uFEFF/, '');
  const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(trimmed);
  if (!fmMatch) {
    throw new Error('未找到 YAML frontmatter（必须以 `---` 开头并以 `---` 结束）。');
  }
  const fmText = fmMatch[1];
  const body = fmMatch[2] ?? '';
  // 容忍 frontmatter 内含注释行（# 开头）；YAML 自带支持。
  const data = YAML.parse(fmText) as ReceiptFrontmatter | null;
  if (!data || typeof data !== 'object') {
    throw new Error('frontmatter 必须是对象类型。');
  }
  return { frontmatter: data, body };
}

// --------------------------------------------------------------------------
// M3 读图证据软门禁（claude-kernel scoped 强制——claude/codeagent；非家族仅 advisory SKIP 文案）
// --------------------------------------------------------------------------

function collectMultimodalEvidenceAdvisory(
  projectRoot: string,
  frameworkRoot: string,
  phase: Phase,
  feature: string,
  fw: ReturnType<typeof loadFrameworkConfig>,
): (MultimodalEvidenceGateResult & { effective_image_input?: string }) | null {
  if (phase !== 'coding') return null;
  const adapter = (fw.agent_adapter ?? 'generic').trim() || 'generic';
  const probe = resolveContextAdapterImageInput(projectRoot, frameworkRoot, adapter);
  // plan e5b8c3f7 T3：读图证据取自**身份验真后的 canonical JSON**，不再按回执手填
  // report_path 裸读 Markdown——否则编辑 MD 即可伪造读图证据块（假闭环通道）。
  // 验真不通过 → undefined = 既有的"未取得读图证据"降级通道，语义不变。
  const reportText =
    loadVerifierReportTextOrNull(projectRoot, feature, phase, { frameworkRoot }) ?? undefined;
  const gate = evaluateMultimodalEvidenceGate({
    adapter,
    imageInput: probe.imageInput,
    verifierReportText: reportText,
    // 家族谓词（plan c7a9e2f4）：codeagent 事件流与 claude 同构，同样强制解析
    forceParse: isClaudeKernelAdapter(adapter),
  });
  if (!gate) return null;
  if (gate.status === 'PASS') return null;
  return { ...gate, effective_image_input: probe.imageInput };
}

export function patchSummarySoftAdvisory(
  projectRoot: string,
  reportDirRel: string | undefined,
  advisory: MultimodalEvidenceGateResult & { effective_image_input?: string },
): void {
  if (!reportDirRel?.trim()) return;
  const summaryPath = path.join(projectRoot, reportDirRel.trim(), 'summary.json');
  if (!fs.existsSync(summaryPath)) return;
  try {
    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8')) as HarnessRunSummary;
    // Closed summary bytes are manifest-bound evidence. Advisory is presentation-only
    // and must never mutate an already committed closure.
    if (summary.closure_status === 'closed') return;
    const existing = Array.isArray(summary.soft_advisories) ? summary.soft_advisories : [];
    const entry: SoftAdvisory = {
      id: advisory.id,
      status: advisory.status === 'SKIP' ? 'SKIP' : 'WARN',
      details: advisory.details,
      effective_image_input: advisory.effective_image_input,
      source: 'check-receipt',
    };
    summary.soft_advisories = [
      ...existing.filter(a => a?.id !== advisory.id),
      entry,
    ];
    fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf-8');
  } catch {
    /* best-effort */
  }
}

// --------------------------------------------------------------------------
// 反假设条款 checkbox 扫描
// --------------------------------------------------------------------------

// scanHallucinationCheckboxes 已删除（plan 07a41ec6 T4）

if (require.main === module) main();
