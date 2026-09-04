// e2e-spec-requirement-closure.unit.test.ts — plan c8e5b3f1 t2 P2-3
//
// 可重跑 E2E：临时 consumer 工程，真实运行 fidelity-intent-init + harness-runner + check-receipt，
// 不设 MAISON_GOAL_RUN_ID。
//   正例：带 --requirement → summary PASS + check-receipt exit 0（完整闭环回执）。
//   goal gate：有效 receipt 在场也只落 PASS/open base；standalone 仍可正常关环。
//   反例：不带 requirement（合法 intent_fallback SSOT）→ requirement capability blocked →
//         INCOMPLETE + readiness(next_action/assess/merged-report) + check-receipt slim_summary_not_pass 拒。
// 随机临时目录 + 严格清理；测试前后 repo 的 doc/features 不得新增。

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { spawnSync } from 'child_process';
import type { UnitCaseResult } from '../run-unit';
import { prepareGoalModeRun, runGoalModeHostBridge } from '../../scripts/goal-mode-entry';
import type { InSessionPhaseRequestContext } from '../../scripts/utils/goal-in-session-driver';
import { casAcquireRunOwner, readRunControl } from '../../scripts/utils/goal-run-control';
import { publishFixtureVerifierEvidence } from '../utils/verifier-evidence-fixture';

const FRAMEWORK_ROOT = path.resolve(__dirname, '..', '..', '..');

function assert(cond: unknown, msg: string): void { if (!cond) throw new Error(msg); }

// ---- framework 最小复制（junction node_modules 避免复制 88MB） ----
function copyDir(src: string, dst: string): void {
  if (!fs.existsSync(dst)) fs.mkdirSync(dst, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dst, ent.name);
    if (ent.isDirectory()) copyDir(s, d);
    else if (ent.isFile()) fs.copyFileSync(s, d);
  }
}

function provisionFramework(): { root: string; harnessDir: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-e2e-'));
  const fw = path.join(root, 'framework');
  const harness = path.join(fw, 'harness');
  fs.mkdirSync(harness, { recursive: true });
  // harness 最小集（不含 node_modules / reports / tests 等历史产物）
  fs.copyFileSync(path.join(FRAMEWORK_ROOT, 'harness', 'package.json'), path.join(harness, 'package.json'));
  for (const f of fs.readdirSync(path.join(FRAMEWORK_ROOT, 'harness'))) {
    if (f.endsWith('.ts') || f.startsWith('tsconfig')) {
      fs.copyFileSync(path.join(FRAMEWORK_ROOT, 'harness', f), path.join(harness, f));
    }
  }
  for (const d of ['scripts', 'schemas', 'templates', 'prompts', 'code-graph', 'framework', 'graph-extractor', 'state', 'trace']) {
    copyDir(path.join(FRAMEWORK_ROOT, 'harness', d), path.join(harness, d));
  }
  // junction node_modules（Windows Only；避免复制 88MB）
  const nmLink = path.join(harness, 'node_modules');
  const nmTarget = path.join(FRAMEWORK_ROOT, 'harness', 'node_modules');
  if (process.platform === 'win32') {
    const r = spawnSync('cmd', ['/c', 'mklink', '/J', nmLink, nmTarget]);
    assert(r.status === 0, `junction node_modules 失败：${r.stderr}`);
  } else {
    fs.symlinkSync(nmTarget, nmLink, 'dir');
  }
  // framework 资产 + 根 package.json（gate fingerprint 需要）
  for (const d of ['skills', 'workflows', 'specs', 'profiles', 'templates', 'agents']) {
    copyDir(path.join(FRAMEWORK_ROOT, d), path.join(fw, d));
  }
  fs.copyFileSync(path.join(FRAMEWORK_ROOT, 'package.json'), path.join(fw, 'package.json'));
  return { root, harnessDir: harness };
}

function run(harnessDir: string, script: string, args: string[], root: string): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['ts-node', path.join(harnessDir, 'scripts', script), ...args],
    { cwd: harnessDir, encoding: 'utf-8', shell: process.platform === 'win32' },
  );
  return { status: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function runHarness(
  harnessDir: string,
  args: string[],
  root: string,
  envOverrides: Record<string, string | undefined> = {},
): { status: number; stdout: string; stderr: string } {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const [key, value] of Object.entries(envOverrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  const r = spawnSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['ts-node', path.join(harnessDir, 'harness-runner.ts'), ...args],
    { cwd: harnessDir, encoding: 'utf-8', shell: process.platform === 'win32', env },
  );
  return { status: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function git(root: string, args: string[]): void {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf-8', shell: false });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${r.stderr}`);
}

/** 铺一个完整 spec 工程（PASS 所需：spec.md + acceptance + facts + source + git）。 */
// plan a9d4e7c2: interactive full-track spec requires an adapter that actually
// registers a verifier capability; `generic` has no SubagentStop publisher, so it
// now resolves to `blocked` (INCOMPLETE / verifier_provider_unavailable) by design.
// `codeagent` registers one and shares AGENTS.md as its entry file, so the
// personal-setup gate stays satisfied by this scaffold.
// The goal-mode case below passes its own adapter and is unaffected.
function scaffoldFeature(root: string, adapter = 'codeagent'): void {
  fs.mkdirSync(path.join(root, 'doc', 'features', 'demo', 'spec'), { recursive: true });
  fs.writeFileSync(path.join(root, 'framework.config.json'), JSON.stringify({
    schema_version: '1.0', project_name: 'e2e', project_profile: { name: 'generic' },
    paths: { features_dir: 'doc/features', module_catalog: 'doc/module-catalog.yaml', glossary: 'doc/glossary.yaml', glossary_seed: 'doc/glossary-seed.txt', architecture_md: 'doc/architecture.md', docs_committed: false },
    materialized_adapters: [adapter],
  }), 'utf-8');
  fs.writeFileSync(path.join(root, 'framework.local.json'), JSON.stringify({ schema_version: '1.0', agent_adapter: adapter }), 'utf-8');
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# AGENTS\n', 'utf-8');
  fs.writeFileSync(path.join(root, 'doc', 'features', 'demo', 'spec', 'spec.md'), [
    '# spec', '',
    '## 0. 术语映射表', '',
    '| 原始术语 | 权威模块 | 所属层 | 置信度 | 易混项 | 用户确认 |',
    '|----------|----------|--------|--------|--------|---------|',
    '| 账户 | ModA | 02-Feature | medium | — | [x] |', '',
    '## 1. 功能概述', '', '账户页含余额展示与转账入口。', '',
    '## 2. Scope 声明', '', '```yaml', 'in_scope_modules:', '  - ModA', 'out_of_scope_modules: []', 'rationale: fixture', '```', '',
    '## 3. 目标用户与使用场景', '', '| 字段 | 取值 |', '|------|------|', '| 用户 | e2e |', '',
    '## 4. 功能清单', '', '| 编号 | 功能名称 | 优先级 | 描述 |', '|------|---------|--------|------|', '| F1 | 余额展示 | P0 | 展示余额 |', '| F2 | 转账入口 | P1 | 提供转账入口 |', '',
    '## 5. 页面/界面描述', '', '账户页展示余额与转账入口。', '',
    '## 6. 业务流程图', '', '```mermaid', 'flowchart LR', '  A --> B', '```', '',
    '## 7. 异常/边界场景处理', '', '| 异常场景 | 处理方式 |', '|----------|----------|', '| 余额为负 | 展示告警 |', '',
    '## 8. 非功能性需求', '', '加载时间 < 500ms。', '',
    '## 9. 验收标准', '', '**AC-1** (F1): 余额展示可测试。', '**AC-2** (F2): 转账入口可测试。', '',
  ].join('\n'), 'utf-8');
  fs.writeFileSync(path.join(root, 'doc', 'features', 'demo', 'acceptance.yaml'), [
    'feature: demo', 'criteria:',
    '  - id: AC-1', '    feature: F1', '    target: 余额展示', '    ut_layer: unit', '    ut_focus: AccountService 余额字段',
    '  - id: AC-2', '    feature: F2', '    target: 转账入口', '    ut_layer: unit', '    ut_focus: TransferService 转账能力',
    'boundaries: []', 'coverage_summary:', '  comment: fixture', '',
  ].join('\n'), 'utf-8');
  fs.writeFileSync(path.join(root, 'doc', 'module-catalog.yaml'), [
    'schema_version: "1.0"', 'modules:',
    '  - name: "ModA"', '    layer: "02-Feature"', '    sub_layer: null', '    format: "library"', '    one_liner: "fixture"',
    '    responsibilities: []', '    NOT_responsible_for: []', '    typical_business_terms: []', '    easily_confused_with: []',
    '    key_exports: []', '    entry_file: "02-Feature/ModA/index.ets"', '',
  ].join('\n'), 'utf-8');
  fs.writeFileSync(path.join(root, 'doc', 'glossary.yaml'), 'schema_version: "1.0"\nterms: []\n', 'utf-8');
  fs.writeFileSync(path.join(root, 'doc', 'architecture.md'), '# architecture\n', 'utf-8');
  fs.mkdirSync(path.join(root, '02-Feature', 'ModA'), { recursive: true });
  fs.writeFileSync(path.join(root, '02-Feature', 'ModA', 'index.ets'), 'export class AccountService { balance = 0; }', 'utf-8');
  fs.writeFileSync(path.join(root, '02-Feature', 'ModA', 'transfer.ets'), 'export class TransferService {}', 'utf-8');
  fs.mkdirSync(path.join(root, 'app'), { recursive: true });
  fs.writeFileSync(path.join(root, 'app', 'index.ets'), 'export const e2eApp = true;\n', 'utf-8');
  fs.mkdirSync(path.join(root, 'doc', 'features', 'demo', 'context'), { recursive: true });
  fs.writeFileSync(path.join(root, 'doc', 'features', 'demo', 'context', 'facts.md'), [
    '---', 'schema_version: "1.0"', 'feature: demo', 'established_by: spec', 'ready_to_produce: true', 'has_blocker_coverage_risk: false',
    'exploration_mode: minimal', 'key_inputs_read:', '  - doc/glossary.yaml', '  - doc/module-catalog.yaml', '  - doc/architecture.md',
    'subagents_used: none', 'decisions_unlocked:', '  - account_page_balance_transfer', 'files_inspected_count: 8', 'searches_performed_estimate: 6',
    'source_code_paths:', '  - 02-Feature/ModA/index.ets', '  - 02-Feature/ModA/transfer.ets', '---', '',
    '## Code Facts', '', '| 路径 | 事实 | 对本阶段影响 |', '|------|------|--------------|',
    '| 02-Feature/ModA/index.ets | AccountService 提供余额 | 确认数据来源 |', '| 02-Feature/ModA/transfer.ets | TransferService 提供转账 | 确认入口可行 |', '',
    '## phase_delta: spec', '', '已确认余额与转账两主功能。', '',
  ].join('\n'), 'utf-8');
  fs.writeFileSync(path.join(root, '.gitignore'), 'framework/\n', 'utf-8');
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 'e2e@test']);
  git(root, ['config', 'user.name', 'e2e']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'baseline']);
}

function readJson(root: string, rel: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf-8'));
}

function writeValidSpecReceipt(root: string, summary: Record<string, unknown>, attemptId = ''): void {
  const reportsDir = path.join(root, 'doc/features/demo/spec/reports');
  // plan e5b8c3f7：verifier 证据 = 与 hook 同形的 canonical JSON，subject 取自
  // 本次真实 harness run 写入 summary 的 verifier_subject_id（不重写 summary 字节）。
  publishFixtureVerifierEvidence({
    projectRoot: root,
    reportsDir,
    feature: 'demo',
    phase: 'spec',
    subjectId: String(summary.verifier_subject_id ?? ''),
    reportText: '# spec verifier\n\nverdict: PASS\n',
    skipSummaryPatch: true,
  });
  fs.writeFileSync(path.join(reportsDir, 'trace.json'), '{"trace": []}', 'utf-8');
  fs.writeFileSync(path.join(root, 'doc/features/demo/spec/phase-completion-receipt.md'), [
    '---', 'receipt_schema: "2.0"', 'feature: "demo"', 'phase: "spec"', 'agent_model: "e2e"', 'agent_runtime: "e2e"',
    'claimed_completion_at: "2026-08-11T10:00:00+08:00"',
    `claimed_completion_commit_sha: "${String(summary.source_commit_sha)}"`, `claimed_attempt_id: "${attemptId}"`,
    'verifier_subagent:', '  invoked_via: "Task(subagent_type=verifier)"',
    '  prompt_template: "framework/harness/prompts/verify-spec.md"',
    '  report_path: "doc/features/demo/spec/reports/verifier.report.json"', '  verdict: "PASS"',
    '  ran_at: "2026-08-11T10:00:00+08:00"', '---', '',
    '## 反假设条款回顾', '', '- [x] 我没有引用不存在规则', '- [x] 若曾认为受限已逐字 quote', '- [x] 没有把假设当借口', '',
  ].join('\n'), 'utf-8');
}

function repoDocFeatures(): string[] {
  const dir = path.join(FRAMEWORK_ROOT, 'doc', 'features');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir);
}

interface Case { name: string; run: () => void | Promise<void> }
const cases: Case[] = [
  {
    name: 'E2E attended：fenced request → initializer → formal harness → receipt/sync closure，旧 epoch 拒绝',
    run: async () => {
      const before = repoDocFeatures();
      const { root, harnessDir } = provisionFramework();
      try {
        scaffoldFeature(root, 'codex');
        const runId = '20260825T000000Z-attended-e2e';
        const prepared = prepareGoalModeRun({
          projectRoot: root,
          frameworkRoot: path.join(root, 'framework'),
          feature: 'demo',
          runId,
          adapter: 'codex',
          adapterSource: 'local_config',
          requirement: '设计账户页，含余额展示与转账入口。',
          endPhase: 'spec',
        });
        const captured: { value?: InSessionPhaseRequestContext } = {};
        let fidelityHash = '';
        const contextFlags = (context: InSessionPhaseRequestContext): string[] => [
          '--goal-run-id', context.runId,
          '--goal-attempt-id', context.attemptId,
          '--goal-owner-id', context.ownerId,
          '--goal-owner-epoch', String(context.ownerEpoch),
        ];
        await runGoalModeHostBridge({
          projectRoot: root,
          frameworkRoot: path.join(root, 'framework'),
          feature: 'demo',
          runId,
          adapter: 'codex',
          runMode: 'attended',
          leaseMs: 5 * 60_000,
          maxRounds: 1,
          executePhase: async (phase, _recommendation, context) => {
            captured.value = context;
            assert(phase === 'spec' && context.phase === phase, 'bridge phase context mismatch');
            const init = run(harnessDir, 'fidelity-intent-init.ts', [
              '--feature', 'demo', '--goal-phase', phase, ...contextFlags(context),
            ], root);
            assert(init.status === 0, `attended initializer 失败：${init.stderr}`);
            const ssotPath = path.join(root, 'doc/features/demo/spec/reports/fidelity-intent.json');
            fidelityHash = crypto.createHash('sha256').update(fs.readFileSync(ssotPath)).digest('hex');

            const harness = runHarness(harnessDir, [
              '--phase', phase, '--feature', 'demo', '--summary', ...contextFlags(context),
            ], root);
            assert(harness.status === 0, `attended harness 失败：${harness.stderr}\n${harness.stdout}`);
            const summary = readJson(root, 'doc/features/demo/spec/reports/summary.json');
            assert(summary.verdict === 'PASS', `attended verdict=${summary.verdict}`);
            assert(summary.closure_status === 'open', 'receipt 未填前 closure 必须保持 open');
            writeValidSpecReceipt(root, summary, context.attemptId);

            const sync = runHarness(harnessDir, [
              '--sync-closure', '--phase', phase, '--feature', 'demo', ...contextFlags(context),
            ], root);
            assert(sync.status === 0, `attended sync-closure 失败：${sync.stderr}\n${sync.stdout}`);
            const closed = readJson(root, 'doc/features/demo/spec/reports/summary.json');
            assert(closed.receipt_status === 'passed' && closed.closure_status === 'closed',
              `attended closure 未闭合：${JSON.stringify(closed)}`);
            assert(!fs.existsSync(path.join(harnessDir, 'state', '.current-phase.json')),
              'attended harness 不得产生 .current-phase.json');
            assert(crypto.createHash('sha256').update(fs.readFileSync(ssotPath)).digest('hex') === fidelityHash,
              'harness/sync closure 改写了 fidelity SSOT');
            return { status: 'passed' as const, phase };
          },
        });
        if (!captured.value) throw new Error('bridge 未发出 phase request');
        const oldContext = captured.value;
        const control = readRunControl(prepared.runDir, runId);
        assert(control?.owner?.state === 'released', 'bridge 返回后 session owner 应 released');
        const next = casAcquireRunOwner(prepared.runDir, runId, control!.current_epoch, {
          kind: 'session', owner_id: 'attended-e2e-next-owner', lease_ms: 60_000,
        });
        assert(next.ok, 'reattach owner acquisition failed');
        const staleInit = run(harnessDir, 'fidelity-intent-init.ts', [
          '--feature', 'demo', '--goal-phase', 'spec', ...contextFlags(oldContext),
        ], root);
        assert(staleInit.status !== 0, '旧 epoch initializer 不得借用新 owner');
        const ssotPath = path.join(root, 'doc/features/demo/spec/reports/fidelity-intent.json');
        assert(crypto.createHash('sha256').update(fs.readFileSync(ssotPath)).digest('hex') === fidelityHash,
          '旧 epoch 拒绝路径改写了 fidelity SSOT');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
        assert(JSON.stringify(repoDocFeatures()) === JSON.stringify(before), 'E2E 不得新增 repo doc/features');
      }
    },
  },
  {
    name: 'E2E 正例：带 --requirement → summary PASS + check-receipt exit 0',
    run: () => {
      const before = repoDocFeatures();
      const { root, harnessDir } = provisionFramework();
      try {
        scaffoldFeature(root);
        // Step 1：显式需求 → explicit_cli SSOT
        const init = run(harnessDir, 'fidelity-intent-init.ts', ['--feature', 'demo', '--requirement', '设计账户页，含余额展示与转账入口。'], root);
        assert(init.status === 0, `Step1 init 失败：${init.stderr}`);
        // harness-runner spec → PASS
        const hr = runHarness(harnessDir, ['--phase', 'spec', '--feature', 'demo', '--summary'], root);
        const summary = readJson(root, 'doc/features/demo/spec/reports/summary.json');
        assert(summary.verdict === 'PASS', `正例 verdict=${summary.verdict}，stdout=${hr.stdout}`);
        assert((summary.capability_resolutions as Array<{ id: string; state: string }>)
          .find((c) => c.id === 'capability_spec_requirement')?.state === 'resolved', 'requirement 应 resolved');
        // 完整闭环回执（verifier + trace + slim）
        writeValidSpecReceipt(root, summary);
        const rc = run(harnessDir, 'check-receipt.ts', ['--feature', 'demo', '--phase', 'spec', '--project-root', root], root);
        assert(rc.status === 0, `正例 check-receipt 应 exit 0，got ${rc.status}：${rc.stderr}\n${rc.stdout}`);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
        assert(JSON.stringify(repoDocFeatures()) === JSON.stringify(before), 'E2E 不得新增 repo doc/features');
      }
    },
  },
  {
    name: 'E2E revalidate（plan 07a41ec6 T8）：spec 闭环后改 spec.md → 一条 --revalidate 重新 closed，标 script_revalidated + semantic_not_reverified',
    run: () => {
      const before = repoDocFeatures();
      const { root, harnessDir } = provisionFramework();
      try {
        scaffoldFeature(root);
        const init = run(harnessDir, 'fidelity-intent-init.ts', ['--feature', 'demo', '--requirement', '设计账户页，含余额展示与转账入口。'], root);
        assert(init.status === 0, `Step1 init 失败：${init.stderr}`);
        runHarness(harnessDir, ['--phase', 'spec', '--feature', 'demo', '--summary'], root);
        const summary = readJson(root, 'doc/features/demo/spec/reports/summary.json');
        assert(summary.verdict === 'PASS', `前提：首轮 spec 应 PASS，实得 ${summary.verdict}`);
        writeValidSpecReceipt(root, summary);
        const rc = run(harnessDir, 'check-receipt.ts', ['--feature', 'demo', '--phase', 'spec', '--project-root', root], root);
        assert(rc.status === 0, `前提：首轮闭环应 exit 0：${rc.stderr}
${rc.stdout}`);
        assert(readJson(root, 'doc/features/demo/spec/reports/summary.json').closure_status === 'closed', '前提：首轮应 closed');

        // 修正：直接改 SSOT（spec.md），不重新进入六阶段流程。
        const specPath = path.join(root, 'doc', 'features', 'demo', 'spec', 'spec.md');
        fs.writeFileSync(specPath, fs.readFileSync(specPath, 'utf-8').replace('账户页含余额展示与转账入口。', '账户页含余额展示与转账入口；修正记录：补充余额刷新说明。'), 'utf-8');

        const rv = runHarness(harnessDir, ['--revalidate', '--feature', 'demo'], root);
        assert(rv.status === 0, `--revalidate 应 exit 0，got ${rv.status}：${rv.stderr}
${rv.stdout}`);
        const after = readJson(root, 'doc/features/demo/spec/reports/summary.json');
        assert(after.closure_status === 'closed', `重验后应重新 closed，实得 ${after.closure_status}
${rv.stdout}`);
        assert(after.verifier_subject_id !== summary.verifier_subject_id, '材料变了 subject 应换代');
        assert(
          (after.verifier_closure as { mode?: string } | undefined)?.mode === 'completed_with_prior_review',
          `材料变了但历史有 PASS → 沿用并登记：${JSON.stringify(after.verifier_closure)}`,
        );
        assert(
          (after.readiness_signals as Array<{ id: string }>).some((r) => r.id === 'script_revalidated'),
          `summary 应标 script_revalidated：${JSON.stringify(after.readiness_signals)}`,
        );
        const record = readJson(root, 'doc/features/demo/revalidation.json');
        const results = record.results as Array<{ phase: string; flags: string[]; verifier: string; closure_status: string }>;
        assert(results.length === 1 && results[0].phase === 'spec' && results[0].closure_status === 'closed', JSON.stringify(record));
        assert(results[0].flags.includes('script_revalidated') && results[0].flags.includes('semantic_not_reverified'), JSON.stringify(results[0]));
        assert(results[0].verifier === 'completed_with_prior_review', JSON.stringify(results[0]));
        // 第二次 --revalidate：链已 fresh，无目标，exit 0。
        const again = runHarness(harnessDir, ['--revalidate', '--feature', 'demo'], root);
        assert(again.status === 0 && /没有需要重验的阶段/.test(again.stdout), `fresh 链应无目标：${again.stdout}`);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
        assert(JSON.stringify(repoDocFeatures()) === JSON.stringify(before), 'E2E 不得新增 repo doc/features');
      }
    },
  },
  {
    name: 'E2E goal gate：真实 harness-runner 只写 open base，外层 goal-runner 独占 full-track closure',
    run: () => {
      const before = repoDocFeatures();
      const { root, harnessDir } = provisionFramework();
      try {
        scaffoldFeature(root);
        const init = run(harnessDir, 'fidelity-intent-init.ts', ['--feature', 'demo', '--requirement', '设计账户页，含余额展示与转账入口。'], root);
        assert(init.status === 0, `Step1 init 失败：${init.stderr}`);

        // 先用真实 runner 生成可供 slim receipt 绑定的 PASS base，再铺一份可通过校验的回执。
        const first = runHarness(harnessDir, ['--phase', 'spec', '--feature', 'demo', '--summary'], root);
        assert(first.status === 0, `初始 harness 失败：${first.stdout}`);
        writeValidSpecReceipt(root, readJson(root, 'doc/features/demo/spec/reports/summary.json'));

        // 事故边界：goal gate 子进程即使看见有效回执，也只能产 open base；不得自己校验/关环。
        const gated = runHarness(
          harnessDir,
          ['--phase', 'spec', '--feature', 'demo', '--summary'],
          root,
          {
            MAISON_GOAL_GATE_HARNESS: '1',
            MAISON_GOAL_RUNNER: undefined,
            MAISON_GOAL_HEADLESS: undefined,
            MAISON_GOAL_RUN_ID: undefined,
            MAISON_GOAL_ATTEMPT: undefined,
            MAISON_GOAL_ATTEMPT_PHASE: undefined,
          },
        );
        assert(gated.status === 0, `goal gate harness 失败：${gated.stdout}`);
        const gatedSummary = readJson(root, 'doc/features/demo/spec/reports/summary.json');
        assert(gatedSummary.verdict === 'PASS', `goal gate 仍须产 PASS base：${JSON.stringify(gatedSummary)}`);
        assert(gatedSummary.closure_status === 'open', `goal gate 不得先关环：${JSON.stringify(gatedSummary)}`);
        assert(!('closure_commit' in gatedSummary), 'goal gate 不得写 closure_commit');
        assert(!('receipt_status' in gatedSummary), 'goal gate 不得运行 receipt validation');
        const gatedNext = readJson(root, 'doc/features/demo/next.json');
        assert(gatedNext.run_status_candidate !== 'CHAIN_SLICE_COMPLETED',
          `open gate 不得投影完成态：${JSON.stringify(gatedNext)}`);

        // 非 goal 的 standalone 行为保持原样：同一有效回执由真实入口正常校验并关环。
        //
        // plan a9d4e7c2：subject 按**实际审查材料**寻址，而 ai-prompt.md 内嵌 `{timestamp}`
        // 与整份 script-report——每跑一次 harness 材料就变一次，subject 随之换代（这是
        // 定稿接受的合法结果，不再有 canonical 投影去把 telemetry 归一掉）。因此闭环纪律
        // 固定为 harness → verifier → receipt → `--sync-closure`：`--sync-closure` 不重跑
        // 脚本 harness、不重发 request，正是为这一步存在的入口。这里先按上一轮 gated
        // summary 补齐 verifier 证据（等价于"跑完 harness 再跑 verifier"），再走该入口。
        writeValidSpecReceipt(root, gatedSummary);
        const standalone = runHarness(
          harnessDir,
          ['--sync-closure', '--phase', 'spec', '--feature', 'demo'],
          root,
          { MAISON_GOAL_GATE_HARNESS: undefined },
        );
        assert(standalone.status === 0, `standalone 闭环失败：${standalone.stdout}\n${standalone.stderr}`);
        const closedSummary = readJson(root, 'doc/features/demo/spec/reports/summary.json');
        assert(closedSummary.receipt_status === 'passed', `standalone 须校验 receipt：${JSON.stringify(closedSummary)}`);
        assert(closedSummary.closure_status === 'closed', `standalone 须正常关环：${JSON.stringify(closedSummary)}`);
        assert(typeof closedSummary.closure_commit === 'object' && closedSummary.closure_commit !== null,
          'standalone 须写 closure_commit');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
        assert(JSON.stringify(repoDocFeatures()) === JSON.stringify(before), 'E2E 不得新增 repo doc/features');
      }
    },
  },
  {
    name: 'E2E 反例：不带 requirement（intent_fallback SSOT）→ INCOMPLETE + 诊断三件套 + check-receipt slim_summary_not_pass 拒',
    run: () => {
      const before = repoDocFeatures();
      const { root, harnessDir } = provisionFramework();
      try {
        scaffoldFeature(root);
        // Step 1：无 requirement → intent_fallback SSOT（合法，不删 SSOT）
        const init = run(harnessDir, 'fidelity-intent-init.ts', ['--feature', 'demo'], root);
        assert(init.status === 0, `Step1 init 失败：${init.stderr}`);
        const ssot = readJson(root, 'doc/features/demo/spec/reports/fidelity-intent.json');
        assert(ssot.requirement_provenance === 'intent_fallback', `SSOT provenance=${ssot.requirement_provenance}`);
        // harness-runner spec → INCOMPLETE
        const hr = runHarness(harnessDir, ['--phase', 'spec', '--feature', 'demo', '--summary'], root);
        const summary = readJson(root, 'doc/features/demo/spec/reports/summary.json');
        assert(summary.verdict === 'INCOMPLETE', `反例 verdict=${summary.verdict}，stdout=${hr.stdout}`);
        const cap = (summary.capability_resolutions as Array<{ id: string; state: string }>)
          .find((c) => c.id === 'capability_spec_requirement')!;
        assert(cap.state === 'blocked', `requirement 应 blocked，got ${cap.state}`);
        // readiness / next_action / mismatch
        const signals = summary.readiness_signals as Array<{ id: string }>;
        assert(signals.some((s) => s.id === 'capability_input_unresolved'), 'readiness 含 capability_input_unresolved');
        assert(!signals.some((s) => s.id === 'quality_axes_projection_mismatch'), 'blocked 合法投影不报 mismatch');
        assert(summary.next_action === 'resolve_capability_inputs_then_rerun', `next_action=${summary.next_action}`);
        // merged-report blocked 明细
        const md = fs.readFileSync(path.join(root, 'doc/features/demo/spec/reports/merged-report.md'), 'utf-8');
        assert(md.includes('blocked capability 明细'), 'merged-report 有 blocked 明细');
        assert(md.includes('capability_spec_requirement'), 'merged-report 含 capability');
        // assess（NEXT_STEP 渲染）：failed gap detail 含 capability/input/attempt + rerun_phase（review F3/E2E）
        assert(hr.stdout.includes('recommendation=rerun_phase'), `assess 应 rerun_phase，stdout=${hr.stdout}`);
        assert(hr.stdout.includes('capability=capability_spec_requirement'), 'assess detail 含 capability');
        assert(hr.stdout.includes('input=requirement'), 'assess detail 含 input');
        // 写一份最小 slim 回执（回执存在 → check-receipt 才走到 summary verdict 校验 → slim_summary_not_pass）
        const sha = String(summary.source_commit_sha ?? '');
        fs.writeFileSync(path.join(root, 'doc/features/demo/spec/phase-completion-receipt.md'), ([
          '---', 'receipt_schema: "2.0"', 'feature: "demo"', 'phase: "spec"', 'agent_model: "e2e"', 'agent_runtime: "e2e"',
          'claimed_completion_at: "2026-08-11T10:00:00+08:00"', `claimed_completion_commit_sha: "${sha}"`, 'claimed_attempt_id: ""', '---', '',
          '## 反假设条款回顾', '', '- [x] a', '- [x] b', '- [x] c', '',
        ]).join('\n'), 'utf-8');
        // check-receipt 经 slim_summary_not_pass 拒
        const rc = run(harnessDir, 'check-receipt.ts', ['--feature', 'demo', '--phase', 'spec', '--project-root', root], root);
        assert(rc.status !== 0, `反例 check-receipt 应被拒，got ${rc.status}`);
        const rcText = `${rc.stdout}\n${rc.stderr}`;
        assert(rcText.includes('slim_summary_not_pass'), `应按 slim_summary_not_pass 拒，out=${rcText}`);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
        assert(JSON.stringify(repoDocFeatures()) === JSON.stringify(before), 'E2E 不得新增 repo doc/features');
      }
    },
  },
];

export async function runAll(): Promise<UnitCaseResult[]> {
  const results: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      await c.run();
      results.push({ name: `e2e-spec-requirement-closure: ${c.name}`, ok: true });
    } catch (err) {
      results.push({
        name: `e2e-spec-requirement-closure: ${c.name}`,
        ok: false,
        error: (err as Error).stack ?? (err as Error).message,
      });
    }
  }
  return results;
}
