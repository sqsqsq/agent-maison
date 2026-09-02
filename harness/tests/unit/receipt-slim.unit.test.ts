// ============================================================================
// receipt-slim.unit.test.ts — 瘦身回执（receipt_schema 2.0）端到端回归
// （plan e6a3c9f4 t2 / openspec receipt-slim）
// ----------------------------------------------------------------------------
// 真实 CLI 路径（tryValidateReceipt spawn check-receipt.ts 子进程）：
//   - slim PASS：base summary（PASS+0 blocker+指纹新鲜）+ 瘦身回执完整 → passed
//   - 骨架未签（checkbox 未勾）→ failed（骨架不构成闭环）
//   - 本次 FAIL 的 base summary → failed（slim_summary_not_pass——"读旧 PASS 件"环已拆）
//   - 伪造/过期 gate_fingerprint → failed（gate_fingerprint_stale）
//   - 他 feature 的 summary → failed（identity mismatch，防串目录）
//   - summary 缺失 → failed（不静默豁免）
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { tryValidateReceipt } from '../../scripts/utils/phase-state';
import { writeReceiptScaffold } from '../../scripts/utils/receipt-scaffold';
import { computeGateFingerprint } from '../../scripts/utils/gate-fingerprint';
import { computeProductWorktreeDigest } from '../../scripts/utils/worktree-digest';
import { publishFixtureVerifierEvidence } from '../utils/verifier-evidence-fixture';
import { SUMMARY_SCHEMA_VERSION_CURRENT } from '../../scripts/utils/quality-axes';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const HARNESS_ROOT = path.resolve(__dirname, '..', '..');
const FRAMEWORK_ROOT = path.resolve(HARNESS_ROOT, '..');
const PHASE = 'review'; // generic profile 未禁用、非 balanced 保留集——策略干净样本

function initGit(root: string): string {
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: root, shell: false });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root, shell: false });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: root, shell: false });
  spawnSync('git', ['add', '-A'], { cwd: root, shell: false });
  spawnSync('git', ['commit', '-q', '-m', 'baseline'], { cwd: root, shell: false });
  return spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf-8', shell: false }).stdout.trim();
}

interface SlimOpts {
  summaryVerdict?: 'PASS' | 'FAIL';
  summaryFeature?: string;
  staleFingerprint?: boolean;
  omitSummary?: boolean;
  uncheckedBoxes?: boolean;
  /** t2 v2 负例：故意缺 schema 必填字段（手搓片段冒充） */
  dropRequiredKey?: string;
  /** t2 v2 负例：summary.source_commit_sha 与回执/HEAD 不一致（旧件冒充） */
  mismatchedSourceSha?: boolean;
  /** t2 v3 负例：worktree_digest 与当前工作区状态不符（HEAD 不动源码已改） */
  staleWorktreeDigest?: boolean;
  /** t2 v4 负例（codex 第三轮阻断2）：summary 生成后改 untracked 源码**内容**（路径不变） */
  dirtyUntrackedAfter?: boolean;
  /** t2 v5 负例（codex 第四轮阻断1）：中文+空格路径的 untracked 内容 A→B（quotePath 转义绕过场景） */
  dirtyUnicodeAfter?: boolean;
  /** t2 v4 负例（codex 第三轮阻断2）：summary 生成后改根级构建配置（tracked root 输入） */
  dirtyRootConfigAfter?: boolean;
  /** t2 v4 负例（codex 第三轮高优）：goal 环境 summary 带/不带 run_id */
  summaryRunId?: string;
  /** f9c2e6b4 t1：回执自报的 attempt 身份（省略 = 旧格式回执） */
  claimedAttemptId?: string;
  /** t2 v6 负例（codex 第五轮 P1）：summary 侧写入哨兵值（no-git/unverifiable 等非 hex） */
  sentinelWorktreeDigest?: string;
  /** t2 v6 负例（codex 第五轮 P1）：校验前删除 .git——当前侧 no-git + HEAD 不可解析 */
  dropGitDirBeforeValidate?: boolean;
  /** runner-owned-machine-facts 正例：写一条**旧 run** 的账本行（且不覆盖 registry gate）——
   *  账本是跨 run 累积留痕，不再拥有 closure 否决权 */
  staleLedgerFromPriorRun?: boolean;
}

function buildSlimProject(opts: SlimOpts): { root: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'receipt-slim-'));
  const featureDir = path.join(root, 'doc', 'features', 'demo', PHASE);
  const reportsDir = path.join(featureDir, 'reports');
  fs.mkdirSync(reportsDir, { recursive: true });
  fs.mkdirSync(path.join(root, 'framework', 'harness', 'state'), { recursive: true });
  fs.mkdirSync(path.join(root, 'framework', 'workflows'), { recursive: true });
  fs.copyFileSync(
    path.join(FRAMEWORK_ROOT, 'workflows', 'spec-driven.workflow.yaml'),
    path.join(root, 'framework', 'workflows', 'spec-driven.workflow.yaml'),
  );
  fs.writeFileSync(
    path.join(root, 'framework.config.json'),
    JSON.stringify(
      {
        schema_version: '1.1',
        project_name: 'receipt-slim-test',
        project_profile: { name: 'generic' },
        // plan a9d4e7c2：full×interactive 的 verifier=required 需要一个**已登记
        // verifier 能力**的 adapter（generic 没有 SubagentStop 发布链路，恒 blocked）。
        // 本套用例测的是回执/slim 机制，不是 provider 可用性——用 claude 保持变量单一。
        agent_adapter: 'claude',
        architecture: {
          outer_layers: [{ id: 'app', can_depend_on: [], intra_layer_deps: 'forbid' }],
          module_inner_layers: ['content'],
          inner_dependency_direction: 'upward',
          cross_module_exports_file: 'index.ts',
        },
        paths: {
          features_dir: 'doc/features',
          module_catalog: 'doc/module-catalog.yaml',
          glossary: 'doc/glossary.yaml',
          glossary_seed: 'doc/glossary-seed.txt',
          architecture_md: 'doc/architecture.md',
          docs_committed: false,
          receipt_dir_pattern: 'doc/features/<feature>/<phase>',
          reports_dir_pattern: 'doc/features/<feature>/<phase>/reports',
        },
      },
      null,
      2,
    ),
  );

  fs.writeFileSync(
    path.join(reportsDir, 'trace.json'),
    JSON.stringify({ schema_version: '1.0.0', feature: 'demo', phase: PHASE }),
    'utf-8',
  );
  if (opts.staleLedgerFromPriorRun) {
    fs.writeFileSync(
      path.join(featureDir, 'headless-assumptions.jsonl'),
      `${JSON.stringify({
        decision_id: 'stale-1',
        run_id: 'r-prior',
        phase: PHASE,
        gate_id: `${PHASE}.freeze`,
        class: 'artifact_checkbox',
        decision: 'n/a: 旧 run 留痕',
        must_review: false,
        source: 'agent',
        ts: '2026-07-08T10:00:00.000Z',
      })}\n`,
      'utf-8',
    );
  }
  // t2 v4：根级构建配置（tracked）——worktree digest 必须把根配置输入纳入绑定
  fs.writeFileSync(path.join(root, 'build-profile.json5'), '{ "app": { "sdk": "6.0" } }\n', 'utf-8');

  const sha = initGit(root);

  // t2 v4：真实 untracked 产品源码（initGit 之后创建=不入 commit）——digest 必须哈希其内容，
  // 否则"路径不变、内容从 A 改 B"不可见（codex 第三轮阻断2 实锤场景）。
  fs.mkdirSync(path.join(root, 'app'), { recursive: true });
  fs.writeFileSync(path.join(root, 'app', 'untracked-src.ets'), 'const V = 1;\n', 'utf-8');
  // t2 v5：中文+空格 untracked 路径（quotePath 默认转义——非 -z 实现会恒 unreadable 而绕过）
  fs.writeFileSync(path.join(root, 'app', '中文 组件.ets'), 'const CN = 1;\n', 'utf-8');

  if (!opts.omitSummary) {
    const fingerprint = opts.staleFingerprint
      ? 'v9.9.9:deadbeef0000'
      : computeGateFingerprint(FRAMEWORK_ROOT, PHASE);
    const rel = (name: string): string => `doc/features/demo/${PHASE}/reports/${name}`;
    // t2 v2：完整 schema 必填集（codex BLOCKER3a——测试不得把 schema-invalid 片段固化成绿灯）
    const summary: Record<string, unknown> = {
      // plan a9d4e7c2 T3：分派锚从"subject 在不在"重键为 schema_version——夹具必须
      // 写**当代**版本，否则会被 check-receipt 正确地判成上一代产物走 grandfather 分支。
      schema_version: SUMMARY_SCHEMA_VERSION_CURRENT,
      phase: PHASE,
      feature: opts.summaryFeature ?? 'demo',
      verdict: opts.summaryVerdict ?? 'PASS',
      blocker_count: opts.summaryVerdict === 'FAIL' ? 1 : 0,
      fail_count: 0,
      warn_count: 0,
      ...(fingerprint ? { gate_fingerprint: fingerprint } : {}),
      script_report: rel('script-report.json'),
      merged_report: rel('merged-report.md'),
      ai_prompt: rel('ai-prompt.md'),
      summary_json: rel('summary.json'),
      run_statuses: [],
      readiness_signals: [],
      blocking_warnings: [],
      blocking_skips: [],
      blockers: [],
      next_action: 'fill_receipt_then_check',
      // schema 的 allOf/if-then 规定：schema_version ∈ {1.2,1.3} 必带这四项。
      // 上面那句"完整 schema 必填集"此前并未做到——`lite-json-schema` 对
      // allOf/if-then **整条忽略**（fail-open），于是缺三项的夹具照样过 schema 门。
      // 校验器补齐组合关键字后这里立刻暴露，按 schema 补全而不是放松校验。
      assurance: 'not_applicable',
      capability_resolutions: [],
      capability_resolution_contract_fingerprint: null,
      closure_status: 'open',
      generated_at: new Date().toISOString(),
      source_commit_sha: opts.mismatchedSourceSha ? '0'.repeat(40) : sha,
      worktree_digest: opts.sentinelWorktreeDigest
        ? opts.sentinelWorktreeDigest
        : opts.staleWorktreeDigest
          ? 'deadbeefdeadbeef'
          : computeProductWorktreeDigest(root, ['app']),
      ...(opts.summaryRunId ? { run_id: opts.summaryRunId } : {}),
    };
    if (opts.dropRequiredKey) delete summary[opts.dropRequiredKey];
    fs.writeFileSync(path.join(reportsDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf-8');
    // plan e5b8c3f7：summary 落盘后立刻发布与 hook 同形的 verifier 机器证据
    // （subject 写进本次 summary），slim 回执的 verifier 面自此走真验真。
    publishFixtureVerifierEvidence({ projectRoot: root, reportsDir, feature: 'demo', phase: PHASE });
  }
  const box = opts.uncheckedBoxes ? '[ ]' : '[x]';
  const receipt = [
    '---',
    'receipt_schema: "2.0"',
    'feature: "demo"',
    `phase: "${PHASE}"`,
    'agent_model: "test-model"',
    'agent_runtime: "test-runtime"',
    'claimed_completion_at: "2026-07-16T10:00:00+08:00"',
    `claimed_completion_commit_sha: "${sha}"`,
    ...(opts.claimedAttemptId ? [`claimed_attempt_id: "${opts.claimedAttemptId}"`] : []),
    'verifier_subagent:',
    '  invoked_via: "Task(subagent_type=verifier)"',
    `  report_path: "doc/features/demo/${PHASE}/reports/verifier.report.json"`,
    '  verdict: "PASS"',
    '---',
    '',
    '## 反假设条款回顾',
    '',
    `- ${box} a`,
    `- ${box} b`,
    `- ${box} c`,
    '',
  ].join('\n');
  fs.writeFileSync(path.join(featureDir, 'phase-completion-receipt.md'), receipt, 'utf-8');
  return { root };
}

function runCase(opts: SlimOpts, env?: Record<string, string | undefined>): ReturnType<typeof tryValidateReceipt> {
  const { root } = buildSlimProject(opts);
  // t2 v4：summary/receipt 已定稿后再改工作区——重算 digest 必须抓到（真实 dirty 场景，
  // 不再靠手写假摘要冒充）。
  if (opts.dirtyUntrackedAfter) {
    fs.writeFileSync(path.join(root, 'app', 'untracked-src.ets'), 'const V = 2;\n', 'utf-8');
  }
  if (opts.dirtyUnicodeAfter) {
    fs.writeFileSync(path.join(root, 'app', '中文 组件.ets'), 'const CN = 2;\n', 'utf-8');
  }
  if (opts.dropGitDirBeforeValidate) {
    // rename 而非 rmSync：Windows 下 .git/objects pack 只读，rm 会 EPERM；rename 同样让
    // git 视为非仓库（当前侧 digest=no-git + rev-parse HEAD 失败），fault injection 等效。
    fs.renameSync(path.join(root, '.git'), path.join(root, '.git-off'));
  }
  if (opts.dirtyRootConfigAfter) {
    fs.writeFileSync(path.join(root, 'build-profile.json5'), '{ "app": { "sdk": "6.1" } }\n', 'utf-8');
  }
  const savedEnv: Record<string, string | undefined> = {};
  if (env) {
    for (const [k, v] of Object.entries(env)) {
      savedEnv[k] = process.env[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
  try {
    return tryValidateReceipt(HARNESS_ROOT, root, PHASE, 'demo');
  } finally {
    if (env) {
      for (const [k, v] of Object.entries(savedEnv)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'slim PASS：base summary（PASS+0+指纹新鲜）+ 完整瘦身回执 → passed',
    run: () => {
      const v = runCase({});
      assert(v.status === 'passed', `expected passed, got ${v.status}: ${v.message ?? ''}`);
    },
  },
  {
    name: '骨架未签（checkbox 未勾）→ failed（骨架不构成闭环）',
    run: () => {
      const v = runCase({ uncheckedBoxes: true });
      assert(v.status === 'failed', `expected failed, got ${v.status}`);
    },
  },
  {
    name: '本次 FAIL 的 base summary → failed（时序拆环：不再读旧 PASS 件）',
    run: () => {
      const v = runCase({ summaryVerdict: 'FAIL' });
      assert(v.status === 'failed', `expected failed, got ${v.status}`);
    },
  },
  {
    name: '伪造/过期 gate_fingerprint → failed（stale 治理照拦 slim）',
    run: () => {
      const v = runCase({ staleFingerprint: true });
      assert(v.status === 'failed', `expected failed, got ${v.status}`);
    },
  },
  {
    name: '他 feature 的 summary → failed（identity mismatch，防串目录）',
    run: () => {
      const v = runCase({ summaryFeature: 'other-feature' });
      assert(v.status === 'failed', `expected failed, got ${v.status}`);
    },
  },
  {
    name: 'summary 缺失 → failed（机器事实源缺失不静默豁免）',
    run: () => {
      const v = runCase({ omitSummary: true });
      assert(v.status === 'failed', `expected failed, got ${v.status}`);
    },
  },
  {
    name: 't2 v2：缺 schema 必填字段的手搓 summary → failed（slim_summary_schema_invalid）',
    run: () => {
      const v = runCase({ dropRequiredKey: 'run_statuses' });
      assert(v.status === 'failed', `expected failed, got ${v.status}`);
    },
  },
  {
    name: 't2 v2：summary.source_commit_sha 与回执/HEAD 不一致 → failed（旧件冒充被 run identity 拒）',
    run: () => {
      const v = runCase({ mismatchedSourceSha: true });
      assert(v.status === 'failed', `expected failed, got ${v.status}`);
    },
  },
  {
    name: 't2 v3：worktree_digest 失配 → failed（HEAD 不动、源码已改的 dirty worktree 旧件被拒）',
    run: () => {
      const v = runCase({ staleWorktreeDigest: true });
      assert(v.status === 'failed', `expected failed, got ${v.status}`);
    },
  },
  {
    name: 't2 v4：untracked 源码内容 A→B（路径不变）→ failed（digest 哈希内容，非只看路径清单）',
    run: () => {
      const v = runCase({ dirtyUntrackedAfter: true });
      assert(v.status === 'failed', `expected failed, got ${v.status}`);
      assert((v.message ?? '').includes('worktree'), `应命中 worktree 失配：${v.message}`);
    },
  },
  {
    name: 't2 v5：中文+空格 untracked 路径内容 A→B → failed（quotePath 转义不再绕过，-z 修复）',
    run: () => {
      const v = runCase({ dirtyUnicodeAfter: true });
      assert(v.status === 'failed', `expected failed, got ${v.status}`);
      assert((v.message ?? '').includes('worktree'), `应命中 worktree 失配：${v.message}`);
    },
  },
  {
    name: 't2 v4：根级构建配置（tracked root 输入）summary 后被改 → failed（根配置纳入绑定）',
    run: () => {
      const v = runCase({ dirtyRootConfigAfter: true });
      assert(v.status === 'failed', `expected failed, got ${v.status}`);
      assert((v.message ?? '').includes('worktree'), `应命中 worktree 失配：${v.message}`);
    },
  },
  {
    name: 't2 v6 fail-closed：summary 侧哨兵值（no-git）→ failed（哨兵不得进相等比较，两侧同错误常量假匹配被排除）',
    run: () => {
      const v = runCase({ sentinelWorktreeDigest: 'no-git' });
      assert(v.status === 'failed', `expected failed, got ${v.status}`);
      assert(
        (v.message ?? '').includes('slim_summary_worktree_unverifiable'),
        `应命中 worktree 无法核实 BLOCKER：${v.message}`,
      );
    },
  },
  {
    name: 't2 v6 fail-closed：校验前 .git 被删（当前侧 no-git + HEAD 不可解析）→ failed（HEAD 校验不得静默跳过）',
    run: () => {
      const v = runCase({ dropGitDirBeforeValidate: true });
      assert(v.status === 'failed', `expected failed, got ${v.status}`);
      assert(
        (v.message ?? '').includes('slim_summary_head_unverifiable'),
        `应命中 HEAD 无法核实 BLOCKER：${v.message}`,
      );
    },
  },
  // ==========================================================================
  // f9c2e6b4 t1 —— attempt 身份门禁必须在**Cursor 丢 env 的真实形态**下也生效。
  // 仓内实锤（phase-state.ts:107）：adapter 工具子进程会丢 MAISON_GOAL_HEADLESS/RUNNER，
  // 只留 RUN_ID/ATTEMPT。若门禁只认 isGoalOrchestrationEnv()，agent 侧跑 check-receipt
  // 时校验完全不执行，而 observer 又严格要求该字段 → 一路跑到 hard timeout。
  // 三例均只设 RUN_ID+ATTEMPT（不设 RUNNER/HEADLESS），复现该形态。
  // ==========================================================================
  {
    name: 'f9c2e6b4 t1：仅 RUN_ID+ATTEMPT（cursor 丢 env 形态）且回执缺 claimed_attempt_id → failed',
    run: () => {
      const v = runCase(
        { summaryRunId: 'r-123' },
        {
          MAISON_GOAL_RUNNER: undefined, MAISON_GOAL_HEADLESS: undefined,
          MAISON_GOAL_GATE_HARNESS: undefined,
          MAISON_GOAL_RUN_ID: 'r-123', MAISON_GOAL_ATTEMPT: 'i5',
          MAISON_GOAL_ATTEMPT_PHASE: PHASE,
        },
      );
      assert(v.status === 'failed', `expected failed, got ${v.status}`);
      assert(
        (v.message ?? '').includes('claimed_attempt_id'),
        `应点名 claimed_attempt_id 缺失：${v.message}`,
      );
    },
  },
  {
    name: 'f9c2e6b4 t1：仅 RUN_ID+ATTEMPT 且 claimed_attempt_id 与本轮不符（抄旧回执）→ failed',
    run: () => {
      const v = runCase(
        { summaryRunId: 'r-123', claimedAttemptId: 'i3' },
        {
          MAISON_GOAL_RUNNER: undefined, MAISON_GOAL_HEADLESS: undefined,
          MAISON_GOAL_GATE_HARNESS: undefined,
          MAISON_GOAL_RUN_ID: 'r-123', MAISON_GOAL_ATTEMPT: 'i5',
          MAISON_GOAL_ATTEMPT_PHASE: PHASE,
        },
      );
      assert(v.status === 'failed', `expected failed, got ${v.status}`);
      assert(
        (v.message ?? '').includes('i3') && (v.message ?? '').includes('i5'),
        `应点名两侧 attempt 值：${v.message}`,
      );
    },
  },
  {
    // 二轮复核：上面三例只证明 attempt 门禁没被绕过，未证明**整个 check-receipt** 在该
    // 环境下仍保持 goal 语义。本例打 slim 凭证的 run 绑定分支（与 attempt 门禁无关的另一处
    // goal 分支）：cursor 形态下 summary 缺 run_id 必须照样 BLOCKER，否则说明该分支仍被
    // 误判成 interactive 而静默跳过。
    name: 'f9c2e6b4 t1：cursor 丢 env 形态下**非 attempt 分支**同样保持 goal 语义（summary 缺 run_id → failed）',
    run: () => {
      const v = runCase(
        { claimedAttemptId: 'i5' }, // 不设 summaryRunId
        {
          MAISON_GOAL_RUNNER: undefined, MAISON_GOAL_HEADLESS: undefined,
          MAISON_GOAL_GATE_HARNESS: undefined,
          MAISON_GOAL_RUN_ID: 'r-123', MAISON_GOAL_ATTEMPT: 'i5',
          MAISON_GOAL_ATTEMPT_PHASE: PHASE,
        },
      );
      assert(v.status === 'failed', `expected failed, got ${v.status}`);
      assert(
        (v.message ?? '').includes('slim_summary_run_id_missing'),
        `goal 语义须覆盖 slim 凭证 run 绑定分支：${v.message}`,
      );
    },
  },
  {
    name: 'f9c2e6b4 t1：仅 RUN_ID+ATTEMPT 且 claimed_attempt_id 精确匹配 → 不因本门禁失败',
    run: () => {
      const v = runCase(
        { summaryRunId: 'r-123', claimedAttemptId: 'i5' },
        {
          MAISON_GOAL_RUNNER: undefined, MAISON_GOAL_HEADLESS: undefined,
          MAISON_GOAL_GATE_HARNESS: undefined,
          MAISON_GOAL_RUN_ID: 'r-123', MAISON_GOAL_ATTEMPT: 'i5',
          MAISON_GOAL_ATTEMPT_PHASE: PHASE,
        },
      );
      assert(
        !(v.message ?? '').includes('claimed_attempt_id'),
        `匹配时不得再报 attempt 身份问题：${v.message}`,
      );
    },
  },
  // ==========================================================================
  // b3e8d4c7 t1 —— attempt 等值**只在同 phase 内成立**。
  // 宿主实锤 run 20260804T033834Z-99c0a1：coding attempt(i5) 里按门禁指引回上游重跑
  // plan harness，plan 回执写的是 plan 自己的 attempt(i3)——跨阶段复验结构上不可能通过
  // （填 i3≠i5，改 i5=伪造），把框架自己指的修复路堵死，最终死锁。
  // ==========================================================================
  {
    name: 'b3e8d4c7 t1 事故回归：跨阶段复验（attempt 属别的 phase）不得因 attempt 不等而 BLOCKER',
    run: () => {
      const v = runCase(
        { summaryRunId: 'r-123', claimedAttemptId: 'i3' }, // 回执带本 phase 自己的 attempt
        {
          MAISON_GOAL_RUNNER: undefined, MAISON_GOAL_HEADLESS: undefined,
          MAISON_GOAL_GATE_HARNESS: undefined,
          MAISON_GOAL_RUN_ID: 'r-123',
          MAISON_GOAL_ATTEMPT: 'i5', MAISON_GOAL_ATTEMPT_PHASE: 'coding', // 当前在 coding attempt 里
        },
      );
      assert(
        !(v.message ?? '').includes('claimed_attempt_id'),
        `跨阶段复验不得报 attempt 身份问题（本次事故形态）：${v.message}`,
      );
    },
  },
  {
    name: 'b3e8d4c7 t1：goal context 有 attempt 却缺 ATTEMPT_PHASE → failed（fail-closed，不静默跳过门禁）',
    run: () => {
      const v = runCase(
        { summaryRunId: 'r-123', claimedAttemptId: 'i5' },
        {
          MAISON_GOAL_RUNNER: undefined, MAISON_GOAL_HEADLESS: undefined,
          MAISON_GOAL_GATE_HARNESS: undefined,
          MAISON_GOAL_RUN_ID: 'r-123', MAISON_GOAL_ATTEMPT: 'i5',
          MAISON_GOAL_ATTEMPT_PHASE: undefined,
        },
      );
      assert(v.status === 'failed', `expected failed, got ${v.status}`);
      assert(
        (v.message ?? '').includes('MAISON_GOAL_ATTEMPT_PHASE'),
        `应点名 attempt phase 上下文缺失：${v.message}`,
      );
    },
  },
  {
    name: 'b3e8d4c7 t1：仅 ATTEMPT_PHASE 在场也算 goal 信号（并集扩充，不得当 manual 放行）',
    run: () => {
      const v = runCase(
        { claimedAttemptId: 'i5' }, // 不设 summaryRunId
        {
          MAISON_GOAL_RUNNER: undefined, MAISON_GOAL_HEADLESS: undefined,
          MAISON_GOAL_GATE_HARNESS: undefined, MAISON_GOAL_ATTEMPT: undefined,
          MAISON_GOAL_RUN_ID: undefined, MAISON_GOAL_ATTEMPT_PHASE: PHASE,
        },
      );
      assert(v.status === 'failed', `expected failed, got ${v.status}`);
      assert(
        (v.message ?? '').includes('MAISON_GOAL_RUN_ID'),
        `goal 语义须生效（run identity 必填）：${v.message}`,
      );
    },
  },
  {
    name: 't2 v4 fail-closed：goal 环境缺 MAISON_GOAL_RUN_ID → failed（传播异常不得静默跳过绑定校验）',
    run: () => {
      const v = runCase(
        { summaryRunId: 'r-123' },
        { MAISON_GOAL_RUNNER: '1', MAISON_GOAL_HEADLESS: undefined, MAISON_GOAL_RUN_ID: undefined },
      );
      assert(v.status === 'failed', `expected failed, got ${v.status}`);
      assert(
        (v.message ?? '').includes('slim_summary_run_identity_unavailable'),
        `应命中 run identity 缺失 BLOCKER：${v.message}`,
      );
    },
  },
  {
    name: 't2 v4 fail-closed：goal 环境 summary 缺 run_id → failed（旧版产物不得闭环）',
    run: () => {
      const v = runCase(
        {},
        { MAISON_GOAL_RUNNER: '1', MAISON_GOAL_HEADLESS: undefined, MAISON_GOAL_RUN_ID: 'r-123' },
      );
      assert(v.status === 'failed', `expected failed, got ${v.status}`);
      assert(
        (v.message ?? '').includes('slim_summary_run_id_missing'),
        `应命中 summary 缺 run_id BLOCKER：${v.message}`,
      );
    },
  },
  {
    name: 't2 v4：goal 环境 run_id 不匹配 → failed（跨 run 复用被拒，语义保持）',
    run: () => {
      const v = runCase(
        { summaryRunId: 'r-old' },
        { MAISON_GOAL_RUNNER: '1', MAISON_GOAL_HEADLESS: undefined, MAISON_GOAL_RUN_ID: 'r-new' },
      );
      assert(v.status === 'failed', `expected failed, got ${v.status}`);
      assert(
        (v.message ?? '').includes('slim_summary_run_id_mismatch'),
        `应命中 run_id 失配 BLOCKER：${v.message}`,
      );
    },
  },
  {
    name: 'runner-owned-machine-facts：旧 run 账本行在场+registry gate 未覆盖 → 不再否决闭环（goal 态 passed）',
    run: () => {
      // 宿主实锤 run 20260815T083127Z-edfe38：账本 58 条旧 run 行 + 2 条初 run 已物化决议
      // 曾把完整且身份等值的回执恒判 failed。账本仅留痕，closure 否决权已退役。
      const v = runCase(
        { summaryRunId: 'r-new', claimedAttemptId: 'i2', staleLedgerFromPriorRun: true },
        {
          MAISON_GOAL_RUNNER: '1',
          MAISON_GOAL_HEADLESS: undefined,
          MAISON_GOAL_RUN_ID: 'r-new',
          MAISON_GOAL_ATTEMPT: 'i2',
          MAISON_GOAL_ATTEMPT_PHASE: PHASE,
        },
      );
      assert(v.status === 'passed', `账本留痕不得否决完整且身份等值的回执：${v.status} ${v.message ?? ''}`);
    },
  },
  {
    name: 'runner-owned-machine-facts：骨架身份预填（attemptId）/幂等不覆盖/force 重建作废旧回执/非 goal 留空',
    run: () => {
      // goal 态预填：claimed_attempt_id 由 runner 写入骨架
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'receipt-scaffold-'));
      const r1 = writeReceiptScaffold(root, 'demo', PHASE, { attemptId: 'i3' });
      assert(r1.wrote && r1.receiptPath !== null, '首次生成应写盘');
      const text1 = fs.readFileSync(r1.receiptPath!, 'utf-8');
      assert(text1.includes('claimed_attempt_id: "i3"'), `身份应预填 i3：${text1.slice(0, 300)}`);
      assert(text1.includes('feature: "demo"') && text1.includes(`phase: "${PHASE}"`), 'feature/phase 应预填');
      // 幂等：已存在 + 非 force → 不覆盖（harness PASS 语义，agent 已填内容不丢）
      fs.appendFileSync(r1.receiptPath!, '\n<!-- agent-filled -->\n', 'utf-8');
      const r2 = writeReceiptScaffold(root, 'demo', PHASE, { attemptId: 'i4' });
      assert(!r2.wrote, '已存在时非 force 不得覆盖');
      assert(fs.readFileSync(r1.receiptPath!, 'utf-8').includes('agent-filled'), '既有内容应保留');
      // force：closure attempt 前重建——旧回执作废、身份换新、骨架回到未完成态
      const r3 = writeReceiptScaffold(root, 'demo', PHASE, { attemptId: 'i4', force: true });
      assert(r3.wrote, 'force 应重建');
      const text3 = fs.readFileSync(r3.receiptPath!, 'utf-8');
      assert(text3.includes('claimed_attempt_id: "i4"'), '身份应更新为 i4');
      assert(!text3.includes('agent-filled'), '上一 attempt 的旧回执内容应被作废（防旧声明误命中完成观测）');
      assert(/- \[ \]/.test(text3), '反假设 checkbox 应回到未勾（骨架不构成闭环）');
      // 非 goal（人工态）：attemptId 省略 → 字段留空
      const root2 = fs.mkdtempSync(path.join(os.tmpdir(), 'receipt-scaffold-'));
      const r4 = writeReceiptScaffold(root2, 'demo', PHASE, {});
      assert(r4.wrote && r4.receiptPath !== null, '非 goal 也应能生成骨架');
      assert(
        fs.readFileSync(r4.receiptPath!, 'utf-8').includes('claimed_attempt_id: ""'),
        '非 goal 态身份字段保持留空',
      );
    },
  },
  {
    name: '骨架写失败携带真实原因（failure 非空）——runner 消费它 fail-closed，静默吞已根治',
    run: () => {
      // 让回执路径落在一个"以文件占位"的目录下：mkdirSync 必然 EEXIST/ENOTDIR
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'receipt-scaffold-fail-'));
      const featuresDir = path.join(root, 'doc', 'features');
      fs.mkdirSync(path.dirname(featuresDir), { recursive: true });
      fs.writeFileSync(featuresDir, 'not-a-directory', 'utf-8');
      const r = writeReceiptScaffold(root, 'demo', PHASE, { attemptId: 'i2', force: true });
      assert(!r.wrote, '写失败不得报 wrote');
      assert(
        typeof r.failure === 'string' && r.failure.length > 0,
        `失败必须携带真实原因（路径+I/O 错误），实得：${JSON.stringify(r)}`,
      );
    },
  },
  {
    name: 'goal 态 harness-runner 第二写入点让位：writeReceiptSkeletonIfMissing 见 MAISON_GOAL_ATTEMPT 即返回（生产接线）',
    run: () => {
      // 源码正则钉接线：goal 态骨架唯一写者=goal runner（invoke 前 force 写入）；
      // harness PASS 后的幂等首建只服务非 goal 手动流程。双写者会掩盖 runner 写失败。
      const harness = fs.readFileSync(path.resolve(__dirname, '../../harness-runner.ts'), 'utf8');
      assert(
        /function writeReceiptSkeletonIfMissing[\s\S]{0,400}if \(process\.env\.MAISON_GOAL_ATTEMPT\?\.trim\(\)\) return;/.test(harness),
        'goal 态（MAISON_GOAL_ATTEMPT 存在）必须直接返回——不得保留第二写入点',
      );
    },
  },
];

export function runAll(): UnitCaseResult[] {
  const out: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      c.run();
      out.push({ name: c.name, ok: true });
    } catch (err) {
      out.push({ name: c.name, ok: false, error: (err as Error).stack ?? (err as Error).message });
    }
  }
  return out;
}
