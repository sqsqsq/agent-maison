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
import { loadFrameworkConfig, resolveReceiptFilePath } from '../config';
import { normalizePhaseId } from './utils/phase-alias';
import { isCapabilitySkipped } from '../capability-registry';
import { isPhaseDisabledByProfile, loadResolvedProfile } from '../profile-loader';
import {
  applyClosurePatchFromReceiptValidation,
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

type Phase = 'spec' | 'plan' | 'coding' | 'review' | 'ut' | 'testing';

const VALID_PHASES: Phase[] = ['spec', 'plan', 'coding', 'review', 'ut', 'testing'];

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
  if (!phase || !VALID_PHASES.includes(phase)) {
    console.error(`错误：必须指定 --phase，且为 ${VALID_PHASES.join('|')} 之一`);
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
  const resolvedProfile = loadResolvedProfile(projectRoot, fw);
  if (isPhaseDisabledByProfile(phase, resolvedProfile)) {
    console.log(
      `\n🧾 check-receipt: feature=${feature}, phase=${phase}` +
        `\n   project_profile=${resolvedProfile.name} 已禁用该阶段（phases_disabled），跳过回执强制校验 → exit 0\n`,
    );
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

  // 2. script_harness 必须 exit_code=0 且零 BLOCKER
  const sh = frontmatter.script_harness ?? {};
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
  if (sh.report_dir) {
    const summaryPath = path.join(projectRoot, sh.report_dir, 'summary.json');
    if (fs.existsSync(summaryPath)) {
      try {
        const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8')) as { verdict?: string };
        if ((summary.verdict ?? '').toUpperCase() === 'INCOMPLETE') {
          issues.push({
            id: 'summary_verdict_incomplete',
            severity: 'BLOCKER',
            message:
              `summary.json verdict=INCOMPLETE（${path.relative(projectRoot, summaryPath).replace(/\\/g, '/')}）；UT 阶段未闭环。`,
          });
        }
      } catch {
        /* ignore corrupt summary */
      }
    }
  }

  // 3. verifier 必须 PASS
  const vs = frontmatter.verifier_subagent ?? {};
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

  // 4. trace.json 凭证
  const tj = frontmatter.trace_json ?? {};
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
  } else {
    const traceAbs = path.resolve(projectRoot, tj.path);
    if (!fs.existsSync(traceAbs)) {
      issues.push({
        id: 'trace_json_file_not_found',
        severity: 'BLOCKER',
        message: `trace_json.path="${tj.path}" 在文件系统中不存在（缺失即视为阶段未完成，全局入口 §5.1）。`,
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

  // 3.5 context_exploration（与 Context Exploration Gate 对齐）
  const ce = frontmatter.context_exploration ?? {};
  if (ce.exists !== true) {
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

  // 6. 自检题 Q1：trace.json 真实路径
  const sc = frontmatter.self_check ?? {};
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

  // 9. "反假设条款回顾" 三项 checkbox 全部为 [x]
  const checkboxResult = scanHallucinationCheckboxes(bodyAfterFm);
  if (checkboxResult.total !== 3 || checkboxResult.checked !== 3) {
    issues.push({
      id: 'hallucination_checklist_incomplete',
      severity: 'BLOCKER',
      message: `反假设条款回顾未全部勾选：识别出 ${checkboxResult.total} 项，已勾选 ${checkboxResult.checked} 项；要求 3 项全部 [x]。`,
    });
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
      patchSummarySoftAdvisory(projectRoot, sh.report_dir, mmAdvisory);
      if (mmAdvisory.status === 'WARN') {
        console.warn(`\n⚠️  [MAJOR/WARN] ${mmAdvisory.id}: ${mmAdvisory.details}\n`);
      } else if (mmAdvisory.status === 'SKIP') {
        console.warn(`\nℹ️  [SKIP] ${mmAdvisory.id}: ${mmAdvisory.details}\n`);
      }
      console.log(
        `HARNESS_ADVISORY id=${mmAdvisory.id} status=${mmAdvisory.status} effective_image_input=${mmAdvisory.effective_image_input ?? 'n/a'}`,
      );
    }
    console.log('✅ PASS — 完成回执校验通过。');
    console.log('   - script_harness: exit_code=0, blocker_count=0');
    console.log(`   - verifier_subagent: verdict=${vs.verdict}`);
    console.log(`   - trace_json: ${tj.path}（存在）`);
    console.log(`   - commit_sha: ${sha}`);
    console.log('   - 反假设条款 3/3 已勾选');
    console.log('');
    console.log('阶段闭环判定（全局入口 §5.1）四条件已满足，可放行。\n');

    if (!skipStateSync) {
      const receiptValidation = {
        status: 'passed' as const,
        receipt_path: receiptRel,
        exit_code: 0,
      };
      syncPhaseStateOnReceiptPass(projectRoot, feature, phase as FeaturePhase, receiptValidation, {
        blocker_count: typeof sh.blocker_count === 'number' ? sh.blocker_count : 0,
        frameworkRoot,
      });
      applyClosurePatchFromReceiptValidation(
        projectRoot,
        feature,
        phase as FeaturePhase,
        receiptValidation,
        frameworkRoot,
      );
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
