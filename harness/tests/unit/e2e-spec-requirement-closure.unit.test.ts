// e2e-spec-requirement-closure.unit.test.ts — plan c8e5b3f1 t2 P2-3
//
// 可重跑 E2E：临时 consumer 工程，真实运行 fidelity-intent-init + harness-runner + check-receipt，
// 不设 MAISON_GOAL_RUN_ID。
//   正例：带 --requirement → summary PASS + check-receipt exit 0（完整闭环回执）。
//   反例：不带 requirement（合法 intent_fallback SSOT）→ requirement capability blocked →
//         INCOMPLETE + readiness(next_action/assess/merged-report) + check-receipt slim_summary_not_pass 拒。
// 随机临时目录 + 严格清理；测试前后 repo 的 doc/features 不得新增。

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import type { UnitCaseResult } from '../run-unit';

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

function runHarness(harnessDir: string, args: string[], root: string): { status: number; stdout: string } {
  const r = spawnSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['ts-node', path.join(harnessDir, 'harness-runner.ts'), ...args],
    { cwd: harnessDir, encoding: 'utf-8', shell: process.platform === 'win32' },
  );
  return { status: r.status ?? -1, stdout: r.stdout ?? '' };
}

function git(root: string, args: string[]): void {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf-8', shell: false });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${r.stderr}`);
}

/** 铺一个完整 spec 工程（PASS 所需：spec.md + acceptance + facts + source + git）。 */
function scaffoldFeature(root: string): void {
  fs.mkdirSync(path.join(root, 'doc', 'features', 'demo', 'spec'), { recursive: true });
  fs.writeFileSync(path.join(root, 'framework.config.json'), JSON.stringify({
    schema_version: '1.0', project_name: 'e2e', project_profile: { name: 'generic' },
    paths: { features_dir: 'doc/features', module_catalog: 'doc/module-catalog.yaml', glossary: 'doc/glossary.yaml', glossary_seed: 'doc/glossary-seed.txt', architecture_md: 'doc/architecture.md', docs_committed: false },
  }), 'utf-8');
  fs.writeFileSync(path.join(root, 'framework.local.json'), JSON.stringify({ schema_version: '1.0', agent_adapter: 'generic' }), 'utf-8');
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

function repoDocFeatures(): string[] {
  const dir = path.join(FRAMEWORK_ROOT, 'doc', 'features');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir);
}

interface Case { name: string; run: () => void }
const cases: Case[] = [
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
        const sha = String(summary.source_commit_sha);
        fs.writeFileSync(path.join(root, 'doc/features/demo/spec/reports/verifier.report.md'), '# spec verifier\nverdict: PASS\n', 'utf-8');
        fs.writeFileSync(path.join(root, 'doc/features/demo/spec/reports/trace.json'), '{"trace": []}', 'utf-8');
        fs.writeFileSync(path.join(root, 'doc/features/demo/spec/phase-completion-receipt.md'), [
          '---', 'receipt_schema: "2.0"', 'feature: "demo"', 'phase: "spec"', 'agent_model: "e2e"', 'agent_runtime: "e2e"',
          'claimed_completion_at: "2026-08-11T10:00:00+08:00"', `claimed_completion_commit_sha: "${sha}"`, 'claimed_attempt_id: ""',
          'verifier_subagent:', '  invoked_via: "Task(subagent_type=verifier)"', '  prompt_template: "framework/harness/prompts/verify-spec.md"',
          '  report_path: "doc/features/demo/spec/reports/verifier.report.md"', '  verdict: "PASS"', '  ran_at: "2026-08-11T10:00:00+08:00"', '---', '',
          '## 反假设条款回顾', '', '- [x] 我没有引用不存在规则', '- [x] 若曾认为受限已逐字 quote', '- [x] 没有把假设当借口', '',
        ].join('\n'), 'utf-8');
        const rc = run(harnessDir, 'check-receipt.ts', ['--feature', 'demo', '--phase', 'spec', '--project-root', root], root);
        assert(rc.status === 0, `正例 check-receipt 应 exit 0，got ${rc.status}：${rc.stderr}\n${rc.stdout}`);
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

export function runAll(): UnitCaseResult[] {
  return cases.map((c) => {
    try { c.run(); return { name: `e2e-spec-requirement-closure: ${c.name}`, ok: true }; }
    catch (err) { return { name: `e2e-spec-requirement-closure: ${c.name}`, ok: false, error: (err as Error).stack ?? (err as Error).message }; }
  });
}