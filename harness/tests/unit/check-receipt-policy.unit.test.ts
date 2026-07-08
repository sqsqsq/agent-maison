// ============================================================================
// check-receipt-policy.unit.test.ts — C2 verification-matrix 端到端回归
// （plan d4a7c1e8）
// ============================================================================
// 覆盖真实 CLI 路径（tryValidateReceipt 真 spawn check-receipt.ts 子进程）：
//   - lite track：not_applicable，零 spawn（架构性短路）
//   - full×strict（缺省）：verifier 缺失仍 FAIL——零回归
//   - full×balanced×非保留 phase：verifier 缺失也 PASS（off 跳过整块）
//   - full×balanced：trace 缺失仅 WARN 不 FAIL（optional 豁免"不提供"）
// 每个真实 spawn 用例都构造完整合法回执骨架，只消融被测字段，隔离变量。

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { tryValidateReceipt } from '../../scripts/utils/phase-state';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const HARNESS_ROOT = path.resolve(__dirname, '..', '..');

function initGit(root: string): string {
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: root, shell: false });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root, shell: false });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: root, shell: false });
  spawnSync('git', ['add', '-A'], { cwd: root, shell: false });
  spawnSync('git', ['commit', '-q', '-m', 'baseline'], { cwd: root, shell: false });
  const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf-8', shell: false });
  return sha.stdout.trim();
}

interface ReceiptOpts {
  evidenceProfile?: 'balanced';
  omitVerifier?: boolean;
  omitTrace?: boolean;
}

/** 构造一个「除被消融字段外全部合法」的 full track 工程；返回 { root, sha, phase }。 */
function buildProject(phase: string, opts: ReceiptOpts): { root: string; sha: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'receipt-policy-'));
  const featureDir = path.join(root, 'doc', 'features', 'demo', phase);
  const reportsDir = path.join(featureDir, 'reports');
  fs.mkdirSync(reportsDir, { recursive: true });

  // submodule layout：resolveWorkflowSpec（check-receipt.ts 子进程内、无显式 frameworkRoot）
  // 依赖 <projectRoot>/framework/workflows/ 探测到 workflow tree。
  fs.mkdirSync(path.join(root, 'framework', 'harness', 'state'), { recursive: true });
  fs.mkdirSync(path.join(root, 'framework', 'workflows'), { recursive: true });
  fs.copyFileSync(
    path.join(HARNESS_ROOT, '..', 'workflows', 'spec-driven.workflow.yaml'),
    path.join(root, 'framework', 'workflows', 'spec-driven.workflow.yaml'),
  );

  fs.writeFileSync(
    path.join(root, 'framework.config.json'),
    JSON.stringify(
      {
        schema_version: '1.1',
        project_name: 'receipt-policy-test',
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
        ...(opts.evidenceProfile ? { evidence_profile: opts.evidenceProfile } : {}),
      },
      null,
      2,
    ),
  );

  const tracePath = path.join(reportsDir, 'trace.json');
  fs.writeFileSync(tracePath, JSON.stringify({ schema_version: '1.0.0', feature: 'demo', phase }), 'utf-8');
  const ceAbs = path.join(featureDir, 'context-exploration.md');
  fs.writeFileSync(ceAbs, '# context exploration\n', 'utf-8');
  const verifierReportAbs = path.join(reportsDir, 'verifier.report.md');
  fs.writeFileSync(verifierReportAbs, 'verdict: PASS\n', 'utf-8');

  const sha = initGit(root);

  const verifierBlock = opts.omitVerifier
    ? 'verifier_subagent: {}\n'
    : [
        'verifier_subagent:',
        '  invoked_via: "Task(subagent_type=verifier)"',
        '  report_path: "doc/features/demo/' + phase + '/reports/verifier.report.md"',
        '  verdict: "PASS"',
        '',
      ].join('\n');

  const traceBlock = opts.omitTrace
    ? 'trace_json: {}\n'
    : [
        'trace_json:',
        '  path: "doc/features/demo/' + phase + '/reports/trace.json"',
        '  exists: true',
        '  schema_valid: true',
        '',
      ].join('\n');

  const receipt = [
    '---',
    'feature: "demo"',
    `phase: "${phase}"`,
    'agent_model: "test-model"',
    'agent_runtime: "test-runtime"',
    'claimed_completion_at: "2026-07-08T10:00:00+08:00"',
    `claimed_completion_commit_sha: "${sha}"`,
    'script_harness:',
    '  exit_code: 0',
    '  blocker_count: 0',
    verifierBlock,
    traceBlock,
    'context_exploration:',
    '  summary_path: "doc/features/demo/' + phase + '/context-exploration.md"',
    '  exists: true',
    '  ready_to_produce: true',
    '  has_blocker_coverage_risk: false',
    'self_check:',
    '  q1_trace_json_abs_path: "' + tracePath.replace(/\\/g, '\\\\') + '"',
    '  q2_verifier_verdict_quoted: "PASS"',
    '  q3_last_diff_file: "doc/features/demo/' + phase + '/context-exploration.md"',
    '  q4_no_hallucinated_rule_used: true',
    '  q4_evidence: "n/a"',
    '---',
    '',
    '## 反假设条款回顾',
    '',
    '- [x] a',
    '- [x] b',
    '- [x] c',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(featureDir, 'phase-completion-receipt.md'), receipt, 'utf-8');

  return { root, sha };
}

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: 'tryValidateReceipt：lite track → not_applicable，架构性短路（无 subprocess）',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'receipt-lite-'));
      try {
        fs.mkdirSync(path.join(root, 'doc', 'features', 'demo'), { recursive: true });
        fs.writeFileSync(
          path.join(root, 'doc', 'features', 'demo', 'feature.yaml'),
          'schema_version: "1.0"\ntrack: lite\n',
          'utf-8',
        );
        const v = tryValidateReceipt(HARNESS_ROOT, root, 'exit', 'demo');
        assert(v.status === 'not_applicable', `expected not_applicable, got ${v.status}`);
        assert(!!v.message && v.message.includes('lite'), 'message 应说明 lite 语义');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    // review 不在 generic profile 的 phases_disabled 内、也不在默认保留集 {spec,coding}——
    // 干净的"非保留 phase"样本（ut/coding 会被 generic 直接禁用整阶段，测不到本矩阵逻辑）。
    name: 'full×strict（缺省，无 evidence_profile）：verifier 缺失仍 FAIL——零回归基线',
    run: () => {
      const { root } = buildProject('review', { omitVerifier: true });
      try {
        const v = tryValidateReceipt(HARNESS_ROOT, root, 'review', 'demo');
        assert(v.status === 'failed', `expected failed under strict, got ${v.status}`);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'full×balanced×非保留 phase（review）：verifier 缺失仍 PASS（off 跳过整块）',
    run: () => {
      const { root } = buildProject('review', { evidenceProfile: 'balanced', omitVerifier: true });
      try {
        const v = tryValidateReceipt(HARNESS_ROOT, root, 'review', 'demo');
        assert(v.status === 'passed', `expected passed under balanced+review(off), got ${v.status}: ${v.message ?? ''}`);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'full×balanced×保留 phase（spec）：verifier 缺失仍 FAIL（保留集内不豁免）',
    run: () => {
      const { root } = buildProject('spec', { evidenceProfile: 'balanced', omitVerifier: true });
      try {
        const v = tryValidateReceipt(HARNESS_ROOT, root, 'spec', 'demo');
        assert(v.status === 'failed', `expected failed（spec 在保留集内）, got ${v.status}`);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'full×balanced：trace 缺失仅 WARN 不 FAIL（optional 豁免"不提供"）',
    run: () => {
      const { root } = buildProject('review', { evidenceProfile: 'balanced', omitTrace: true });
      try {
        const v = tryValidateReceipt(HARNESS_ROOT, root, 'review', 'demo');
        assert(v.status === 'passed', `expected passed（trace optional 缺失不阻塞）, got ${v.status}: ${v.message ?? ''}`);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'full×strict：trace 缺失仍 FAIL（strict 下 trace required，零回归）',
    run: () => {
      const { root } = buildProject('review', { omitTrace: true });
      try {
        const v = tryValidateReceipt(HARNESS_ROOT, root, 'review', 'demo');
        assert(v.status === 'failed', `expected failed under strict, got ${v.status}`);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    // tryValidateReceipt 在 PASS 时不保留 stdout（只关心 status），直接 spawn
    // 才能验证"缺失仅 WARN"真的把提示打到了 stdout，而不只是"没让它 FAIL"。
    name: 'full×balanced：trace 缺失的 WARN 真实出现在 stdout（而非仅"没 FAIL"）',
    run: () => {
      const { root } = buildProject('review', { evidenceProfile: 'balanced', omitTrace: true });
      try {
        const checker = path.join(HARNESS_ROOT, 'scripts', 'check-receipt.ts');
        const r = spawnSync(
          process.platform === 'win32' ? 'npx.cmd' : 'npx',
          ['ts-node', checker, '--feature', 'demo', '--phase', 'review', '--project-root', root, '--skip-state-sync'],
          { cwd: HARNESS_ROOT, encoding: 'utf-8', shell: process.platform === 'win32' },
        );
        assert(r.status === 0, `expected exit 0, got ${r.status}\n${r.stderr}`);
        assert(
          (r.stdout ?? '').includes('trace_json_missing_optional'),
          `stdout 应包含 optional-missing 提示 id；实际 stdout:\n${r.stdout}`,
        );
        assert(
          (r.stdout ?? '').includes('profile_resolved=balanced'),
          `stdout 应含 HARNESS_EVIDENCE_POLICY 标记行；实际:\n${r.stdout}`,
        );
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
];

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      c.run();
      results.push({ name: c.name, ok: true });
    } catch (err) {
      results.push({ name: c.name, ok: false, error: (err as Error).message });
    }
  }
  return results;
}
