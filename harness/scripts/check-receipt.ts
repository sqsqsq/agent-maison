// ============================================================================
// 阶段完成回执校验脚本（Layer 2 凭证检查）
// ============================================================================
// 用法（在仓库根目录或任意位置执行均可）：
//   npx ts-node framework/harness/scripts/check-receipt.ts \
//     --feature <feature> --phase <prd|design|coding|review|ut|testing>
//
// 行为：
//   1. 读取 doc/features/<feature>/<phase>/phase-completion-receipt.md
//   2. 解析 YAML frontmatter
//   3. 校验：
//      - feature / phase 字段与 CLI 参数一致
//      - script_harness.exit_code === 0  &&  blocker_count === 0
//      - verifier_subagent.verdict === "PASS"
//      - trace_json.exists === true  且 trace_json.path 文件真实存在
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
import { loadFrameworkConfig } from '../config';
import { isPhaseDisabledByProfile, loadResolvedProfile } from '../profile-loader';

type Phase = 'prd' | 'design' | 'coding' | 'review' | 'ut' | 'testing';

const VALID_PHASES: Phase[] = ['prd', 'design', 'coding', 'review', 'ut', 'testing'];

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
  self_check?: {
    q1_trace_json_abs_path?: string;
    q2_verifier_verdict_quoted?: string;
    q3_last_diff_file?: string;
    q4_no_hallucinated_rule_used?: boolean;
    q4_evidence?: string;
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
    boolean: ['help'],
    alias: { f: 'feature', p: 'phase', h: 'help' },
  });

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const feature = args.feature as string | undefined;
  const phase = args.phase as Phase | undefined;
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

  return { feature, phase, projectRoot };
}

function printHelp(): void {
  console.log(`
check-receipt.ts — 阶段完成回执校验（Layer 2 凭证）

用法：
  npx ts-node framework/harness/scripts/check-receipt.ts \\
    --feature <feature> \\
    --phase <prd|design|coding|review|ut|testing>

可选：
  --project-root <abs-path>   显式指定仓库根（默认从 __dirname 向上推导）
`);
}

// --------------------------------------------------------------------------
// 主流程
// --------------------------------------------------------------------------

function main(): void {
  const { feature, phase, projectRoot } = parseArgs();

  const fw = loadFrameworkConfig(projectRoot);
  const resolved = loadResolvedProfile(projectRoot, fw);
  if (isPhaseDisabledByProfile(phase, resolved)) {
    console.log(
      `\n🧾 check-receipt: feature=${feature}, phase=${phase}` +
        `\n   project_profile=${resolved.name} 已禁用该阶段（phases_disabled），跳过回执强制校验 → exit 0\n`,
    );
    process.exit(0);
  }

  const receiptRel = `doc/features/${feature}/${phase}/phase-completion-receipt.md`;
  const receiptPath = path.join(projectRoot, receiptRel);

  console.log(`\n🧾 check-receipt: feature=${feature}, phase=${phase}`);
  console.log(`   回执路径: ${receiptRel}\n`);

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
  if (frontmatter.phase !== phase) {
    issues.push({
      id: 'phase_mismatch',
      severity: 'BLOCKER',
      message: `frontmatter.phase="${frontmatter.phase ?? ''}" 与 CLI --phase="${phase}" 不一致。`,
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
    console.log('✅ PASS — 完成回执校验通过。');
    console.log('   - script_harness: exit_code=0, blocker_count=0');
    console.log(`   - verifier_subagent: verdict=${vs.verdict}`);
    console.log(`   - trace_json: ${tj.path}（存在）`);
    console.log(`   - commit_sha: ${sha}`);
    console.log('   - 反假设条款 3/3 已勾选');
    console.log('');
    console.log('阶段闭环判定（全局入口 §5.1）四条件已满足，可放行。\n');
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
