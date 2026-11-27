import { putPlugin } from './extension-test-fixture';
import { beginUnitCase } from '../utils/unit-cases';
import { testCliArgs } from '../utils/test-cli-args';
// 消费者扩展在 spec harness 入口的消费与格式诊断。

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import type { UnitCaseResult } from '../run-unit';

const FRAMEWORK_ROOT = path.resolve(__dirname, '..', '..', '..');

function assert(cond: unknown, msg: string): void { if (!cond) throw new Error(msg); }

function provisionFramework(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-e2e-'));
  fs.symlinkSync(FRAMEWORK_ROOT, path.join(root, 'framework'), process.platform === 'win32' ? 'junction' : 'dir');
  return root;
}

function runHarness(
  root: string,
  args: string[],
): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(
    process.execPath,
    [...testCliArgs(path.join(FRAMEWORK_ROOT, 'harness', 'harness-runner.ts')), '--project-root', root, ...args],
    { cwd: path.join(root, 'framework', 'harness'), encoding: 'utf-8', windowsHide: true },
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
    '## 7. 异常/边界场景处理', '', '| 编号 | 异常场景 | 处理方式 |', '|------|----------|----------|',
    '| E1 | 网络异常 | 显示重试入口 |', '| E2 | 数据为空 | 显示空态 |', '| E3 | 功能暂不支持 | 显示说明 |', '',
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
}

function readJson(root: string, rel: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf-8'));
}

interface Case { name: string; run: () => void | Promise<void> }
const cases: Case[] = [
  {
    name: 'extension before_phase_verify required produces 缺失进入 harness-runner summary CheckResult',
    run: () => {
      const root = provisionFramework();
      try {
        scaffoldFeature(root);
        putPlugin(root, 'runner-extension', { declaration: { provides: { mcp_actions: {
          'verify-action': { tool: 'host.verify', required: true, severity: 'BLOCKER', produces: ['doc/missing-verify.json'], usage: 'verify' },
        } }, bindings: {
          verify: { at: 'feature.before_phase_verify@1', phase: 'spec', kind: 'action', ref: 'verify-action' },
        } } });
        git(root, ['add', '-A']);
        git(root, ['-c', 'user.email=e2e@test', '-c', 'user.name=e2e', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'extension fixture']);
        const result = runHarness(root, ['--phase', 'spec', '--feature', 'demo', '--summary']);
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
    name: '已发布的旧平铺根只读提示，普通 spec 继续且不投递 rogue Skill',
    run: () => {
      const root = provisionFramework();
      const baselineRoot = provisionFramework();
      try {
        scaffoldFeature(root);
        scaffoldFeature(baselineRoot);
        const args = ['--phase', 'spec', '--feature', 'demo', '--summary'];
        const summaryPath = 'doc/features/demo/spec/reports/summary.json';
        const extensionRoot = path.join(root, 'doc', 'extensions');
        const rogue = path.join(extensionRoot, 'skills', 'rogue', 'SKILL.md');
        const manifest = path.join(extensionRoot, 'manifest.yaml');
        const old = 'schema_version: "1.0"\nname: legacy-extension\nprovides:\n  skills: [rogue]\n';
        fs.mkdirSync(path.dirname(rogue), { recursive: true });
        fs.writeFileSync(rogue, '# LEGACY_ROGUE\n', 'utf8');
        fs.writeFileSync(manifest, old, 'utf8');
        for (const project of [root, baselineRoot]) {
          git(project, ['add', '-A']);
          git(project, ['-c', 'user.email=e2e@test', '-c', 'user.name=e2e', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'spec fixture']);
        }
        const baseline = runHarness(baselineRoot, args);
        const baselineVerdict = readJson(baselineRoot, summaryPath).verdict;
        const result = runHarness(root, args);
        assert(result.status === baseline.status && readJson(root, summaryPath).verdict === baselineVerdict,
          `旧扩展不得改变普通业务结论：${result.stdout} ${result.stderr}`);
        const report = readJson(root, 'doc/features/demo/spec/reports/script-report.json') as {
          checks?: Array<{ id?: string; status?: string; severity?: string; details?: string }>;
        };
        assert(report.checks?.some(check => check.id === 'extension_legacy_layout' && check.status === 'WARN'
          && check.details?.includes('请按需手工整理后重新接入')), '旧清单须提供手工接入提示');
        assert(!report.checks?.some(check => check.status === 'FAIL' && check.id?.startsWith('extension_')),
          '旧扩展不得进入正式门禁');
        assert(report.checks?.some(check => check.id === 'required_chapters' && check.status === 'PASS'), '原生业务检查须执行');
        assert(!result.stdout.includes('LEGACY_ROGUE'), '旧 Skill 正文不得投递');
        assert(!fs.existsSync(path.join(root, '.cac', 'commands', 'rogue.md')), '旧 Skill 不得物化');
        assert(fs.readFileSync(rogue, 'utf8') === '# LEGACY_ROGUE\n' && fs.readFileSync(manifest, 'utf8') === old, '旧资源保持原字节');
      } finally {
        fs.rmSync(baselineRoot, { recursive: true, force: true });
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: '损坏的 2.0 宿主清单经普通 runner 报结构 BLOCKER',
    run: () => {
      const root = provisionFramework();
      try {
        scaffoldFeature(root);
        const extensionRoot = path.join(root, 'doc', 'extensions');
        fs.mkdirSync(extensionRoot, { recursive: true });
        fs.writeFileSync(path.join(extensionRoot, 'manifest.yaml'),
          'schema_version: "2.0"\nkind: host\nplugins: {}\nunknown: true\n', 'utf8');
        git(root, ['add', '-A']);
        git(root, ['-c', 'user.email=e2e@test', '-c', 'user.name=e2e', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'invalid extension fixture']);
        const result = runHarness(root, ['--phase', 'spec', '--feature', 'demo', '--summary']);
        assert(result.status !== 0, `invalid manifest 应失败：${result.stdout}`);
        const report = readJson(root, 'doc/features/demo/spec/reports/script-report.json') as {
          checks?: Array<{ id?: string; status?: string; severity?: string }>;
        };
        assert(report.checks?.some(check => check.id?.startsWith('extension_manifest_manifest_unknown_field')
          && check.status === 'FAIL' && check.severity === 'BLOCKER'),
        `runner 缺 manifest BLOCKER：${JSON.stringify(report.checks)}`);
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
