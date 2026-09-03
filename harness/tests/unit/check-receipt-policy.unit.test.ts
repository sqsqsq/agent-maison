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
import { runSyncClosureDetailed, tryValidateReceipt } from '../../scripts/utils/phase-state';
import { statefilePath } from '../../config';
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
  /** 环 C（plan f3a8c6d2 t2）：goal 下的 attempt 身份自证字段；省略=非 goal 夹具（现状） */
  claimedAttemptId?: string;
  /**
   * 环 C：goal 身份在场时 check-receipt 另行强制 headless-assumptions 账本
   * （registry 中该 phase 的每个 gate 都须有记录）。账本 closure 否决已退役
   * （runner-owned-machine-facts）——本选项保留仅为可写旧 run 账本行，钉住
   * 「账本内容不参与闭环裁决」。
   */
  goalLedgerRunId?: string;
  extensionManifest?: string;
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
  // plan e5b8c3f7：verifier 证据 = summary.verifier_subject_id + 身份验真过的
  // verifier.report.json（与 SubagentStop hook 同形，经共享 fixture 工具发布）。
  // omitVerifier 时**两者都不写**——这正是"verifier 缺失"的新形态（旧形态是不写 MD）。
  if (!opts.omitVerifier) {
    fs.writeFileSync(
      path.join(reportsDir, 'summary.json'),
      JSON.stringify(
        {
          // plan a9d4e7c2 T3: dispatch is keyed on schema_version now, so the fixture
          // must carry the current generation or it is (correctly) treated as legacy.
          schema_version: SUMMARY_SCHEMA_VERSION_CURRENT,
          phase,
          feature: 'demo',
          verdict: 'PASS',
          blocker_count: 0,
          fail_count: 0,
          warn_count: 0,
          // assurance 刻意缺席：本夹具用于身份/证据面断言，闭环提交阶段必然失败
          // （见「环C：重签后放行」用例——它靠 finalizer 抛错区分"身份放行"与"身份拦截"）。
          closure_status: 'open',
        },
        null,
        2,
      ),
      'utf-8',
    );
    publishFixtureVerifierEvidence({ projectRoot: root, reportsDir, feature: 'demo', phase });
  }

  if (opts.extensionManifest) {
    fs.mkdirSync(path.join(root, 'doc', 'extensions'), { recursive: true });
    fs.writeFileSync(path.join(root, 'doc', 'extensions', 'manifest.yaml'), opts.extensionManifest, 'utf-8');
  }
  const sha = initGit(root);

  const verifierBlock = opts.omitVerifier
    ? 'verifier_subagent: {}\n'
    : [
        'verifier_subagent:',
        '  invoked_via: "Task(subagent_type=verifier)"',
        '  report_path: "doc/features/demo/' + phase + '/reports/verifier.report.json"',
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
    ...(opts.claimedAttemptId ? [`claimed_attempt_id: "${opts.claimedAttemptId}"`] : []),
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

  // runner-owned-machine-facts：账本 closure 否决已退役——这里刻意写一条**旧 run** 的
  // 账本行（run_id 与当前 goal run 不同），钉住「账本内容（含旧 run 行/未覆盖 registry
  // gate）不再参与闭环裁决」；attempt 等值仍是唯一被消融变量。
  if (opts.goalLedgerRunId) {
    const ledger = JSON.stringify({
      decision_id: `${phase}-fixture-stale`,
      run_id: 'stale-prior-run',
      phase,
      gate_id: `${phase}.freeze`,
      class: 'artifact_checkbox',
      decision: 'n/a: unit fixture（旧 run 留痕）',
      must_review: false,
      source: 'agent',
      ts: '2026-07-08T10:00:00.000Z',
    });
    fs.writeFileSync(path.join(featureDir, 'headless-assumptions.jsonl'), `${ledger}\n`, 'utf-8');
  }

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
    name: 'extension 1.1 after_phase_verify_before_close required produces 缺失 → 真 spawn receipt FAIL',
    run: () => {
      const extensionManifest = [
        'schema_version: "1.1"', 'name: receipt-extension', 'provides:', '  skills: []',
        '  mcp_actions:', '    close-action:', '      tool: host.close', '      required: true',
        '      severity: BLOCKER', '      produces: [doc/missing-close.json]', '      usage: close',
        'phase_bindings:', '  review:', '    after_phase_verify_before_close:',
        '      - { kind: mcp, ref: close-action }', '',
      ].join('\n');
      const { root } = buildProject('review', {
        evidenceProfile: 'balanced', omitVerifier: true, extensionManifest,
      });
      try {
        const result = tryValidateReceipt(HARNESS_ROOT, root, 'review', 'demo');
        assert(result.status === 'failed', `expected failed, got ${result.status}`);
        assert((result.message ?? '').includes('extension_produces_'), result.message ?? 'missing message');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: '非法 extension manifest → 真 spawn receipt 复用 manifest BLOCKER，不静默关闭 gate',
    run: () => {
      const extensionManifest = [
        'schema_version: "1.1"', 'name: invalid-receipt-extension', 'unknown: true',
        'provides:', '  skills: []', '  mcp_actions:', '    close-action:',
        '      tool: host.close', '      required: true', '      produces: [doc/missing-close.json]',
        '      usage: close', 'phase_bindings:', '  review:', '    after_phase_verify_before_close:',
        '      - { kind: mcp, ref: close-action }', '',
      ].join('\n');
      const { root } = buildProject('review', {
        evidenceProfile: 'balanced', omitVerifier: true, extensionManifest,
      });
      try {
        const result = tryValidateReceipt(HARNESS_ROOT, root, 'review', 'demo');
        assert(result.status === 'failed', `expected failed, got ${result.status}`);
        assert((result.message ?? '').includes('extension_manifest_manifest_unknown_field'), result.message ?? 'missing message');
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
  // ==========================================================================
  // 环 C（plan f3a8c6d2 t2）：closure **提交侧**的严格 attempt 等值校验。
  // 事故：receipt claimed_attempt_id=i7 与终局 attempt i8 失配；而 runSyncClosureDetailed
  // 此前调 tryValidateReceipt 不带 goalIdentity → goal 门禁在提交侧静默跳过（最松一环）。
  // 修法只加"透传身份"，不引入迁移/改绑协议、不新增控制流：失配即不闭环，
  // 只有 agent 把 receipt 重签为当前 attempt 才允许提交。
  // ==========================================================================
  {
    name: '环C：attempt 失配时 closure 提交被拒——不写闭环 state、不改绑',
    run: () => {
      const { root } = buildProject('review', { claimedAttemptId: 'i7', goalLedgerRunId: 'run-X' });
      try {
        // 先取裁决原文：必须**因 attempt 身份**被拒，而不是碰巧栽在别的门禁上
        const probe = tryValidateReceipt(HARNESS_ROOT, root, 'review', 'demo', {
          goalIdentity: { runId: 'run-X', attemptId: 'i8', attemptPhase: 'review' },
        });
        assert(probe.status === 'failed', `probe 应 failed，实得 ${probe.status}`);
        assert(
          /attempt/i.test(probe.message ?? '') && (probe.message ?? '').includes('i7'),
          `拒绝原因须指向 attempt 身份失配，实得：${probe.message}`,
        );

        const res = runSyncClosureDetailed(HARNESS_ROOT, root, 'demo', 'review', undefined, {
          goalIdentity: { runId: 'run-X', attemptId: 'i8', attemptPhase: 'review' },
        });
        assert(res.exitCode !== 0, `attempt 失配必须拒绝闭环，实得 exitCode=${res.exitCode}`);
        // 关键：必须**在 receipt 校验阶段就被拒**，而不是走进 finalize 后才失败。
        // finalizationError 有值 = receipt 被判 passed、已进入闭环提交（身份校验没生效）——
        // 那正是"提交侧是最松一环"的旧缺陷形态，单看 exitCode!==0 无法区分（会假绿）。
        assert(
          res.finalizationError === undefined,
          `失配须在校验阶段拒绝、不得进入闭环提交；实得 finalizationError=${res.finalizationError}`,
        );

        // 不得写入闭环态（receipt.status=passed）——state 文件可因 harness_finished 存在，
        // 但绝不能出现 passed；也不得把 receipt 的 i7 改绑成 i8。
        const stateAbs = statefilePath(root);
        if (fs.existsSync(stateAbs)) {
          const state = JSON.parse(fs.readFileSync(stateAbs, 'utf-8')) as { receipt?: { status?: string } };
          assert(
            state.receipt?.status !== 'passed',
            `失配态不得写入 receipt.status=passed，实得 ${JSON.stringify(state.receipt)}`,
          );
        }
        const receiptRaw = fs.readFileSync(
          path.join(root, 'doc', 'features', 'demo', 'review', 'phase-completion-receipt.md'),
          'utf-8',
        );
        assert(receiptRaw.includes('claimed_attempt_id: "i7"'), 'receipt 的 attempt 身份不得被改绑');
        assert(!receiptRaw.includes('"i8"'), 'receipt 不得被写入当前 attempt 身份（禁止迁移采信）');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: '环C：receipt 重签为当前 attempt 后校验放行（证明拒绝仅来自身份失配）',
    run: () => {
      // 与上一用例**同一夹具**，只把 claimed_attempt_id 由 i7 改签为 i8：
      // 若这里仍失败，说明上一用例的"拒绝"来自别的门禁而非 attempt 等值（假绿）。
      const { root } = buildProject('review', { claimedAttemptId: 'i8', goalLedgerRunId: 'run-X' });
      try {
        const probe = tryValidateReceipt(HARNESS_ROOT, root, 'review', 'demo', {
          goalIdentity: { runId: 'run-X', attemptId: 'i8', attemptPhase: 'review' },
        });
        assert(
          probe.status === 'passed',
          `重签为当前 attempt 后应放行，实得 ${probe.status}；msg=${probe.message}`,
        );
        // 关键：必须经过**本次真正被改的函数** runSyncClosureDetailed（codex 抓出的缺口
        // ——只验 tryValidateReceipt 的话，即使它对匹配的 i8 也一律拒绝，正负两例仍会全绿）。
        // 夹具的 summary.json 刻意缺 assurance（plan e5b8c3f7 后 verifier 证据面需 summary 承载 subject），于是身份放行后必然**推进到 finalizer** 才失败：
        //   · finalizationError 有值 = 身份校验放行、已进入闭环提交（本例期望）
        //   · finalizationError === undefined = 在校验阶段就被拒（负向用例期望）
        // 两者构成阶段对照，无需补完整 summary 夹具即可证明"拒绝仅来自身份失配"。
        const res = runSyncClosureDetailed(HARNESS_ROOT, root, 'demo', 'review', undefined, {
          goalIdentity: { runId: 'run-X', attemptId: 'i8', attemptPhase: 'review' },
        });
        assert(
          res.finalizationError !== undefined,
          '身份一致时须放行至 finalizer（本夹具因 summary 刻意缺 assurance 才在提交阶段失败）；' +
            `实得 finalizationError=undefined、exitCode=${res.exitCode}——说明仍被身份校验拦下`,
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
