// ============================================================================
// 阶段完成回执校验脚本（Layer 2 凭证检查）
// ============================================================================
// 用法（在仓库根目录或任意位置执行均可）：
//   npx ts-node framework/harness/scripts/check-receipt.ts \
//     --feature <feature> --phase <spec|plan|coding|review|ut|testing>
//
// 行为：
//   1. 读取回执（canonical spec/plan 目录；legacy prd/design 目录可回退，见 resolveReceiptFilePath）
//   2. 解析 YAML frontmatter
//   3. 校验：
//      - feature / phase 字段与 CLI 参数一致
//      - script_harness.exit_code === 0  &&  blocker_count === 0
//      - verifier_subagent.verdict === "PASS"
//      - trace_json.exists === true  且 trace_json.path 文件真实存在
//      - testing 阶段且 profile 未 SKIP device_test.run 时：testing_run_artifacts 四字段与 Hylyre 产物路径
//      - claimed_completion_commit_sha 是 40 位 hex 且在仓库中真实存在
//      - self_check.q1_trace_json_abs_path 真实存在
//      - self_check.q3_last_diff_file 为非空真实路径；
//        当 paths.docs_committed=true 时还须在工作区可读（存在）
//      - self_check.q4_no_hallucinated_rule_used === true
//      - "反假设条款回顾" 三项 checkbox 全部为 [x]
//      任一失败 → exit 1 + 详细 BLOCKER 报告
//   4. profile `phases_disabled` 命中本 phase 时：不要求回执，直接 exit 0。
//   5. 致命错误（回执文件缺失 / YAML 解析失败）→ exit 2。
//
// 退出码语义（与 harness-runner / Stop hook 协议一致）：
//   0 = PASS（阶段闭环条件 4 满足）
//   1 = 校验失败（回执存在但内容造假 / 不达标）
//   2 = 致命错误（回执文件缺失 / 模板未填）
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
import { validateLedgerForClosure } from './utils/headless-assumptions';
import { collectRequirementSsotPaths, computeRunRequirementSha } from './utils/fidelity-shared';
import {
  resolvePhaseEvidenceManifest,
  writePhaseEvidenceManifest,
  writeReceiptManifestPointer,
} from './utils/phase-evidence-manifest';
import { writeReviewClosureAttestation } from './utils/closure-attestation';
import type { Phase as EvidencePhase } from './utils/types';
import { scanCommandForPreloadInjection } from './utils/process-integrity';
import { validateLiteSchema } from './utils/lite-json-schema';
import { computeProductWorktreeDigest } from './utils/worktree-digest';
import { isCapabilitySkipped } from '../capability-registry';
import { isPhaseDisabledByProfile, loadResolvedProfile } from '../profile-loader';
import {
  applyClosurePatchFromReceiptValidation,
  isGoalOrchestrationEnv,
  syncPhaseStateOnReceiptPass,
  type FeaturePhase,
} from './utils/phase-state';
import {
  evaluateMultimodalEvidenceGate,
  readVerifierReportFile,
  type MultimodalEvidenceGateResult,
} from './utils/multimodal-evidence-gate';
import { resolveContextAdapterImageInput } from './utils/multimodal-probe';
import type { HarnessRunSummary, SoftAdvisory } from './utils/types';

/** Feature phase id（由 active workflow 定义；main() 内按 workflow 合法集校验——C0 收编）。 */
type Phase = string;

interface ReceiptFrontmatter {
  feature?: string;
  phase?: string;
  agent_model?: string;
  agent_runtime?: string;
  claimed_completion_at?: string;
  claimed_completion_commit_sha?: string;
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
`);
}

// --------------------------------------------------------------------------
// 主流程
// --------------------------------------------------------------------------

function main(): void {
  const { feature, phase, projectRoot, skipStateSync } = parseArgs();
  const frameworkRoot = path.resolve(__dirname, '..', '..');

  const fw = loadFrameworkConfig(projectRoot);
  // phase 合法性按 active workflow feature phase 集校验（C0 收编：不再持有硬编码枚举）
  try {
    assertWorkflowFeaturePhase(resolveWorkflowSpec(projectRoot, { config: fw }), phase);
  } catch (err) {
    console.error(`错误：${(err as Error).message}`);
    process.exit(2);
  }
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
    mode: isGoalOrchestrationEnv() ? 'goal' : 'interactive',
    adapter: fw.agent_adapter ?? 'generic',
    phase,
    workflow: fw.active_workflow ?? 'spec-driven',
    can_prompt_user: !isGoalOrchestrationEnv(),
    can_collect_usage: isGoalOrchestrationEnv(),
  };
  const evidenceConfig = { evidence_profile: fw.evidence_profile };
  const policy = resolveEvidencePolicy(track, runtimeCtx, evidenceConfig);
  const profileResolved = resolveProfileLabel(track, runtimeCtx, evidenceConfig);

  // lite track：receipt 机制架构性不适用（正常调用路径下 tryValidateReceipt 已在
  // phase-state.ts 短路、不会走到本进程；本分支是直接 CLI 调用的防御性兜底）——
  // 绝不当作 passed，也不触碰任何 state，交由 exit 阶段自身的 script-report 承载闭环。
  if (policy.receipt === 'not_applicable') {
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

  if (!fs.existsSync(receiptPath)) {
    console.error('❌ FATAL: 回执文件不存在。');
    console.error('');
    console.error('阶段闭环判定（全局入口 §5.1）四条件之一未满足：');
    console.error(`  → ${receiptRel} 不存在`);
    console.error('');
    console.error('修复指引：');
    console.error('  1. 复制模板到目标路径：');
    console.error(`     framework/harness/templates/phase-completion-receipt.md`);
    console.error(`     →  ${receiptRel}`);
    console.error('  2. 真实填写所有字段（不允许编造）。');
    console.error('  3. 重新执行本检查。');
    process.exit(2);
  }

  const raw = fs.readFileSync(receiptPath, 'utf-8');

  let frontmatter: ReceiptFrontmatter;
  let bodyAfterFm = '';
  try {
    const parsed = parseFrontmatterAndBody(raw);
    frontmatter = parsed.frontmatter;
    bodyAfterFm = parsed.body;
  } catch (err) {
    console.error(`❌ FATAL: 回执 YAML frontmatter 解析失败: ${(err as Error).message}`);
    process.exit(2);
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
  const isSlim = String((frontmatter as { receipt_schema?: unknown }).receipt_schema ?? '').trim() === '2.0';
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
      if (isGoalOrchestrationEnv()) {
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

  // 3. verifier（policy.verifier === 'off' 时整块不检——balanced 档非保留 phase / lite 已短路）
  const vs = frontmatter.verifier_subagent ?? {};
  if (policy.verifier === 'off') {
    observed.verifier = 'skipped_by_policy';
  } else {
    observed.verifier = vs.verdict ? 'provided' : 'missing';
    if ((vs.verdict ?? '').toUpperCase() !== 'PASS') {
      issues.push({
        id: 'verifier_not_pass',
        severity: 'BLOCKER',
        message: `verifier_subagent.verdict="${vs.verdict ?? '<missing>'}", 必须为 PASS。`,
      });
    }
    if (!vs.invoked_via || !/Task|subagent/i.test(vs.invoked_via)) {
      issues.push({
        id: 'verifier_invocation_unspecified',
        severity: 'BLOCKER',
        message: `verifier_subagent.invoked_via="${vs.invoked_via ?? ''}"；必须明示通过 Task 工具触发 (subagent_type=verifier)，不允许"提示用户去跑"。`,
      });
    }
    if (vs.report_path) {
      const verifierReportAbs = path.resolve(projectRoot, vs.report_path);
      if (!fs.existsSync(verifierReportAbs)) {
        issues.push({
          id: 'verifier_report_missing',
          severity: 'BLOCKER',
          message: `verifier_subagent.report_path="${vs.report_path}" 在文件系统中不存在。`,
        });
      }
    } else {
      issues.push({
        id: 'verifier_report_path_missing',
        severity: 'BLOCKER',
        message: 'verifier_subagent.report_path 未填写。',
      });
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
  if (phase === 'testing' && !isCapabilitySkipped(resolvedProfile, 'device_test.run')) {
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

  // 5. claimed_completion_commit_sha 必须是 40 位 hex 且在 git 中真实存在
  const sha = (frontmatter.claimed_completion_commit_sha ?? '').trim();
  if (!/^[0-9a-fA-F]{7,40}$/.test(sha)) {
    issues.push({
      id: 'commit_sha_format_invalid',
      severity: 'BLOCKER',
      message: `claimed_completion_commit_sha="${sha}" 不是合法 git SHA（7~40 位 hex）。`,
    });
  } else {
    const verify = spawnSync('git', ['cat-file', '-e', sha], {
      cwd: projectRoot,
      shell: false,
    });
    if (verify.status !== 0) {
      issues.push({
        id: 'commit_sha_not_in_repo',
        severity: 'BLOCKER',
        message: `claimed_completion_commit_sha=${sha} 在仓库中不存在（git cat-file -e 返回非 0）；不允许伪造提交。`,
      });
    }
  }

  // 6. 自检题 Q1：trace.json 真实路径（slim：q1/q3/q4 随镜像块删除——q1 重复 trace 路径、
  //    q3 无真 diff 对账、q4 与反假设 checkbox 重复；反假设自证由 §9 checkbox 承载）
  const sc = frontmatter.self_check ?? {};
  if (!isSlim) {
  if (!sc.q1_trace_json_abs_path) {
    issues.push({
      id: 'self_check_q1_missing',
      severity: 'BLOCKER',
      message: 'self_check.q1_trace_json_abs_path 未填写。',
    });
  } else {
    const q1Path = path.isAbsolute(sc.q1_trace_json_abs_path)
      ? sc.q1_trace_json_abs_path
      : path.resolve(projectRoot, sc.q1_trace_json_abs_path);
    if (!fs.existsSync(q1Path)) {
      issues.push({
        id: 'self_check_q1_file_not_found',
        severity: 'BLOCKER',
        message: `self_check.q1_trace_json_abs_path="${sc.q1_trace_json_abs_path}" 不存在。`,
      });
    }
  }

  // 7. 自检题 Q3：`git diff --name-only` 末行路径；docs_committed=true 时必须存在
  let docsCommitted = false;
  try {
    docsCommitted = loadFrameworkConfig(projectRoot).paths.docs_committed ?? false;
  } catch {
    docsCommitted = false;
  }
  const q3 = (sc.q3_last_diff_file ?? '').trim();
  const q3LooksTemplate =
    !q3 ||
    q3.includes('<本阶段 git diff') ||
    q3.includes('最后一行真实文件路径>');
  if (q3LooksTemplate) {
    issues.push({
      id: 'self_check_q3_missing_or_placeholder',
      severity: 'BLOCKER',
      message: 'self_check.q3_last_diff_file 须替换为真实的末行变更路径（不可保留模板占位符）。',
    });
  } else if (docsCommitted) {
    const q3Abs = path.isAbsolute(q3) ? path.normalize(q3) : path.resolve(projectRoot, q3);
    if (!fs.existsSync(q3Abs)) {
      issues.push({
        id: 'self_check_q3_path_not_found',
        severity: 'BLOCKER',
        message:
          `paths.docs_committed=true：self_check.q3_last_diff_file="${q3}" 解析为 ${q3Abs} 但文件不存在。` +
          ' 若过程产物不入库，请将 framework.config.json 的 paths.docs_committed 置为 false。',
      });
    }
  }

  // 8. 自检题 Q4：必须为 true
  if (sc.q4_no_hallucinated_rule_used !== true) {
    issues.push({
      id: 'self_check_q4_failed',
      severity: 'BLOCKER',
      message:
        'self_check.q4_no_hallucinated_rule_used !== true。' +
        ' 自承使用了不存在的规则 = 反假设条款触发 = 任务失败。',
    });
  }
  } // end !isSlim（legacy §6-8 self_check）

  // 9. "反假设条款回顾" 三项 checkbox 全部为 [x]
  const checkboxResult = scanHallucinationCheckboxes(bodyAfterFm);
  if (checkboxResult.total !== 3 || checkboxResult.checked !== 3) {
    issues.push({
      id: 'hallucination_checklist_incomplete',
      severity: 'BLOCKER',
      message: `反假设条款回顾未全部勾选：识别出 ${checkboxResult.total} 项，已勾选 ${checkboxResult.checked} 项；要求 3 项全部 [x]。`,
    });
  }

  // 10. goal 环境：自动决议账本 schema + registry 完整性（goal-fakepass-hardening t1）
  //     JSONL 为判定 SSOT（markdown 仅人读投影）；registry 不可读同样 fail-closed——
  //     bc-openCard 洞⑤：留痕解析静默失败让待复核清单消失，本门禁把留痕升为闭环硬条件。
  if (isGoalOrchestrationEnv()) {
    // P1-2 + 七轮 P2-2：goal orchestration 下 run identity 必填——缺 MAISON_GOAL_RUN_ID
    // 不得静默降级（跳过 run 对账），fail-closed。
    const currentRunId = process.env.MAISON_GOAL_RUN_ID?.trim();
    if (!currentRunId) {
      issues.push({
        id: 'headless_assumptions_ledger',
        severity: 'BLOCKER',
        message: 'goal 环境缺 MAISON_GOAL_RUN_ID——run identity 是闭环必填项，不得静默降级（fail-closed）。',
      });
    } else {
      const ledger = validateLedgerForClosure(projectRoot, frameworkRoot, feature, phase, {
        expectedRunId: currentRunId,
      });
      for (const e of ledger.errors) {
        issues.push({ id: 'headless_assumptions_ledger', severity: 'BLOCKER', message: e });
      }
    }
  }

  // --------------------------------------------------------------------
  // 输出
  // --------------------------------------------------------------------

  if (issues.length === 0) {
    const mmAdvisory = collectMultimodalEvidenceAdvisory(
      projectRoot,
      frameworkRoot,
      phase,
      frontmatter,
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
    console.log(`✅ PASS — 完成回执校验通过${isSlim ? '（瘦身格式 2.0，机器事实=本次 base summary 直读）' : ''}。`);
    console.log(
      isSlim
        ? `   - base summary: verdict=PASS, blocker_count=0, fingerprint fresh（${canonicalReportsRel}/summary.json）`
        : '   - script_harness: exit_code=0, blocker_count=0',
    );
    console.log(
      `   - verifier_subagent: ${policy.verifier === 'off' ? 'skipped_by_policy（balanced 档非保留 phase）' : `verdict=${vs.verdict}`}`,
    );
    console.log(`   - trace_json: ${traceDisplay}`);
    console.log(`   - commit_sha: ${sha}`);
    console.log('   - 反假设条款 3/3 已勾选');
    if (warnings.length > 0) {
      console.log('');
      console.log(`⚠️  ${warnings.length} 项非阻塞提示：`);
      for (const w of warnings) console.log(`  [${w.severity}] ${w.id}: ${w.message}`);
    }
    console.log('');
    console.log(`阶段闭环判定（全局入口 §5.1）四条件已满足，可放行（evidence_profile=${profileResolved}）。\n`);

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
      syncPhaseStateOnReceiptPass(projectRoot, feature, phase as FeaturePhase, receiptValidation, {
        blocker_count: isSlim ? (slimSummary?.blocker_count ?? 0) : typeof sh.blocker_count === 'number' ? sh.blocker_count : 0,
        frameworkRoot,
        evidence_policy_snapshot: evidencePolicySnapshot,
      });
      applyClosurePatchFromReceiptValidation(
        projectRoot,
        feature,
        phase as FeaturePhase,
        receiptValidation,
        frameworkRoot,
      );

      // goal-fakepass-hardening t2/t8：闭环产物——review attestation + 阶段证据快照 +
      // 回执指针。封装序（openspec design §3.1）：summary 已被 closure patch 定稿 →
      // （review）attestation → manifest（含 summary/attestation 哈希）→ 指针回写回执
      // （指针行在规范化剔除集内，回执规范化哈希不变）。生成失败=closure 不成立。
      try {
        const extraOutputs: string[] = [];
        if (phase === 'review') {
          const attRunId = process.env.MAISON_GOAL_RUN_ID?.trim();
          // P1-1（八轮）：attempt 是字符串（invocation 序数如 "i3"）——旧 Number("i3")=NaN
          // 使 attempt 永远丢失。直接用字符串。
          const attAttempt = process.env.MAISON_GOAL_ATTEMPT?.trim();
          const att = writeReviewClosureAttestation({
            projectRoot,
            feature,
            // 消费态宿主（应用工程）恒预期有产品源码；空 inventory=root discovery
            // 失败 → fail-closed（closure-attestation 内 throw）
            expectProductSources: true,
            gateFingerprint: computeGateFingerprint(frameworkRoot, phase),
            // P1-2：绑定 run/attempt 身份（此前恒 null，与 spec 不符）
            runIdentity: attRunId
              ? { run_id: attRunId, ...(attAttempt ? { attempt: attAttempt } : {}) }
              : null,
          });
          extraOutputs.push(att.absPath);
          console.log(
            `   review-closure-attestation 已生成（inventory ${att.attestation.inventory.file_count} 文件）：` +
              path.relative(projectRoot, att.absPath).replace(/\\/g, '/'),
          );
        }
        // t6/P0-5：需求 SSOT 引用文档 + ux-reference 进阶段血缘输入——改原始需求后
        // 上游 closure 应判 stale（此前 extraInputs 缺失让需求变更对 closure 隐形）。
        // P0-2（八轮）：requirementSha 绑定"当前权威 run"的规范化 requirement 内容——
        // recompute 比对当前权威 requirement，抓"新 run 换需求复用旧 closure"。
        const featuresDirRel = (fw.paths?.features_dir ?? 'doc/features').replace(/\\/g, '/');
        const currentRunId = process.env.MAISON_GOAL_RUN_ID?.trim();
        const closureReqSha = computeRunRequirementSha(projectRoot, feature, currentRunId, featuresDirRel);
        // 九轮 P0：goal 环境闭环必须绑定 requirement 血缘——算不出（manifest 缺失/不可读）
        // 即 fail-closed，不产出 requirement_sha256:null 的"未绑定" closure。
        if (isGoalOrchestrationEnv() && closureReqSha === null) {
          console.error(
            '\n❌ BLOCKER — goal 环境闭环无法计算 requirement 血缘哈希' +
              `（goal-runs/${currentRunId ?? '<缺 run id>'}/manifest.json 缺失/不可读）——closure 不成立。`,
          );
          process.exit(1);
        }
        const manifest = resolvePhaseEvidenceManifest({
          projectRoot,
          feature,
          phase: phase as EvidencePhase,
          extraInputs: collectRequirementSsotPaths(projectRoot, feature, featuresDirRel),
          extraOutputs,
          frameworkRoot,
          requirementSha: closureReqSha,
        });
        const written = writePhaseEvidenceManifest(projectRoot, manifest);
        const relManifest = path.relative(projectRoot, written.absPath).replace(/\\/g, '/');
        writeReceiptManifestPointer(projectRoot, feature, phase, relManifest, written.sha256);
        console.log(`   phase-evidence-manifest 已生成并回写回执指针：${relManifest}`);
      } catch (err) {
        console.error(`\n❌ BLOCKER — 闭环产物生成失败（closure 不成立）：${(err as Error).message}`);
        process.exit(1);
      }
    }

    process.exit(0);
  }

  console.error('❌ BLOCKER — 完成回执校验未通过：\n');
  for (const it of issues) {
    console.error(`  [${it.severity}] ${it.id}: ${it.message}`);
  }
  console.error('');
  console.error('修复指引：');
  console.error('  1. 不要篡改 receipt 数值伪造通过；check-receipt 会与真实文件 / git 状态比对。');
  console.error('  2. 缺什么补什么：跑 harness、调用 verifier、生成 trace.json、再如实回填。');
  console.error('  3. 全局入口 §6.5 反假设条款适用：本失败列表本身就是"为何不能放行"的逐字证据。');
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
// M3 读图证据软门禁（claude-scoped 强制；非 Claude 仅 advisory SKIP 文案）
// --------------------------------------------------------------------------

function collectMultimodalEvidenceAdvisory(
  projectRoot: string,
  frameworkRoot: string,
  phase: Phase,
  frontmatter: ReceiptFrontmatter,
  fw: ReturnType<typeof loadFrameworkConfig>,
): (MultimodalEvidenceGateResult & { effective_image_input?: string }) | null {
  if (phase !== 'coding') return null;
  const adapter = (fw.agent_adapter ?? 'generic').trim() || 'generic';
  const probe = resolveContextAdapterImageInput(projectRoot, frameworkRoot, adapter);
  const vs = frontmatter.verifier_subagent ?? {};
  let reportText: string | undefined;
  if (vs.report_path) {
    const abs = path.resolve(projectRoot, vs.report_path);
    reportText = readVerifierReportFile(abs) ?? undefined;
  }
  const gate = evaluateMultimodalEvidenceGate({
    adapter,
    imageInput: probe.imageInput,
    verifierReportText: reportText,
    forceParse: adapter === 'claude',
  });
  if (!gate) return null;
  if (gate.status === 'PASS') return null;
  return { ...gate, effective_image_input: probe.imageInput };
}

function patchSummarySoftAdvisory(
  projectRoot: string,
  reportDirRel: string | undefined,
  advisory: MultimodalEvidenceGateResult & { effective_image_input?: string },
): void {
  if (!reportDirRel?.trim()) return;
  const summaryPath = path.join(projectRoot, reportDirRel.trim(), 'summary.json');
  if (!fs.existsSync(summaryPath)) return;
  try {
    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8')) as HarnessRunSummary;
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

function scanHallucinationCheckboxes(body: string): { total: number; checked: number } {
  // 只扫描 "反假设条款回顾" 段落内的 checkbox
  const sectionMatch = /##\s+反假设条款回顾[\s\S]*$/i.exec(body);
  if (!sectionMatch) return { total: 0, checked: 0 };
  const section = sectionMatch[0];
  // markdown checkbox: - [ ] / - [x] / - [X]
  const lines = section.split(/\r?\n/);
  let total = 0;
  let checked = 0;
  for (const line of lines) {
    const m = /^\s*[-*]\s+\[( |x|X)\]\s+/.exec(line);
    if (!m) continue;
    total++;
    if (m[1].toLowerCase() === 'x') checked++;
  }
  return { total, checked };
}

main();
