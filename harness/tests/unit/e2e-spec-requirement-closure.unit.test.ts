import { beginUnitCase } from '../utils/unit-cases';
// 消费者扩展在 spec harness 入口的两种失败判定。

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
  for (const d of ['scripts', 'schemas', 'templates', 'prompts', 'code-graph', 'graph-extractor', 'state', 'trace']) {
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

function runHarness(
  harnessDir: string,
  args: string[],
): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['ts-node', path.join(harnessDir, 'harness-runner.ts'), ...args],
    { cwd: harnessDir, encoding: 'utf-8', shell: process.platform === 'win32' },
  );
  return { status: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function git(root: string, args: string[]): void {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf-8', shell: false });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${r.stderr}`);
}

/** 铺一个完整 spec 工程（PASS 所需：spec.md + acceptance + facts + source + git）。 */
function scaffoldFeature(root: string, adapter = 'codeagent'): void {
  fs.mkdirSync(path.join(root, 'doc', 'features', 'demo', 'spec'), { recursive: true });
  fs.writeFileSync(path.join(root, 'framework.config.json'), JSON.stringify({
    schema_version: '1.0', project_name: 'e2e', active_workflow: 'spec-driven', project_profile: { name: 'generic' },
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

interface Case { name: string; run: () => void | Promise<void> }
const cases: Case[] = [
  {
    name: 'extension before_phase_verify required produces 缺失进入 harness-runner summary CheckResult',
    run: () => {
      const { root, harnessDir } = provisionFramework();
      try {
        scaffoldFeature(root);
        const extensionRoot = path.join(root, 'doc', 'extensions');
        fs.mkdirSync(extensionRoot, { recursive: true });
        fs.writeFileSync(path.join(extensionRoot, 'manifest.yaml'), [
          'schema_version: "1.1"', 'name: runner-extension', 'provides:', '  skills: []',
          '  mcp_actions:', '    verify-action:', '      tool: host.verify', '      required: true',
          '      severity: BLOCKER', '      produces: [doc/missing-verify.json]', '      usage: verify',
          'phase_bindings:', '  spec:', '    before_phase_verify:',
          '      - { kind: mcp, ref: verify-action }', '',
        ].join('\n'), 'utf-8');
        git(root, ['add', '-A']);
        git(root, ['commit', '-qm', 'extension fixture']);
        const result = runHarness(harnessDir, ['--phase', 'spec', '--feature', 'demo', '--summary']);
        assert(result.status !== 0, `required produces 缺失应失败：${result.stdout}`);
        const report = readJson(root, 'doc/features/demo/spec/reports/script-report.json') as {
          checks?: Array<{ id?: string; status?: string }>;
        };
        assert(report.checks?.some(check => check.id?.startsWith('extension_produces_') && check.status === 'FAIL'),
          `summary/CheckResult 缺 extension_produces_ FAIL：${JSON.stringify(report.checks)}`);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: '非法 1.1 + rogue Skill + required binding：runner 明确 BLOCKER 且不降级目录注入',
    run: () => {
      const { root, harnessDir } = provisionFramework();
      try {
        scaffoldFeature(root);
        const extensionRoot = path.join(root, 'doc', 'extensions');
        fs.mkdirSync(path.join(extensionRoot, 'skills', 'rogue'), { recursive: true });
        fs.writeFileSync(path.join(extensionRoot, 'skills', 'rogue', 'SKILL.md'), '# rogue\n', 'utf8');
        fs.writeFileSync(path.join(extensionRoot, 'manifest.yaml'), [
          'schema_version: "1.1"', 'name: invalid-runner-extension', 'unknown: true', 'provides:',
          '  skills: []', '  mcp_actions:', '    verify-action:', '      tool: host.verify',
          '      required: true', '      produces: [doc/missing-verify.json]', '      usage: verify',
          'phase_bindings:', '  spec:', '    before_phase_verify:',
          '      - { kind: mcp, ref: verify-action }', '',
        ].join('\n'), 'utf-8');
        git(root, ['add', '-A']);
        git(root, ['commit', '-qm', 'invalid extension fixture']);
        const result = runHarness(harnessDir, ['--phase', 'spec', '--feature', 'demo', '--summary']);
        assert(result.status !== 0, `invalid manifest 应失败：${result.stdout}`);
        const report = readJson(root, 'doc/features/demo/spec/reports/script-report.json') as {
          checks?: Array<{ id?: string; status?: string; severity?: string }>;
        };
        assert(report.checks?.some(check => check.id?.startsWith('extension_manifest_manifest_unknown_field')
          && check.status === 'FAIL' && check.severity === 'BLOCKER'),
        `runner 缺 manifest BLOCKER：${JSON.stringify(report.checks)}`);
        assert(!fs.existsSync(path.join(root, '.cac', 'commands', 'rogue.md')), 'rogue Skill 不得注入');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
];

export async function runAll() {
  const results: UnitCaseResult[] = [];
  for (const c of cases) {
    const name = `e2e-spec-requirement-closure: ${c.name}`;
    const endUnitCase = beginUnitCase(name);
    if (!endUnitCase) continue;
    try {
      await c.run();
      results.push({ name, ok: true });
    } catch (err) {
      results.push({
        name,
        ok: false,
        error: (err as Error).stack ?? (err as Error).message,
      });
    } finally {  endUnitCase(); }
  }
  return results;
}
