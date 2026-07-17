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
import { computeGateFingerprint } from '../../scripts/utils/gate-fingerprint';
import { computeProductWorktreeDigest } from '../../scripts/utils/worktree-digest';

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
  /** t2 v6 负例（codex 第五轮 P1）：summary 侧写入哨兵值（no-git/unverifiable 等非 hex） */
  sentinelWorktreeDigest?: string;
  /** t2 v6 负例（codex 第五轮 P1）：校验前删除 .git——当前侧 no-git + HEAD 不可解析 */
  dropGitDirBeforeValidate?: boolean;
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
        agent_adapter: 'generic',
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
  fs.writeFileSync(path.join(reportsDir, 'verifier.report.md'), 'verdict: PASS\n', 'utf-8');
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
      schema_version: '1.0',
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
    'verifier_subagent:',
    '  invoked_via: "Task(subagent_type=verifier)"',
    `  report_path: "doc/features/demo/${PHASE}/reports/verifier.report.md"`,
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
