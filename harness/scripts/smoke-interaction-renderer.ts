#!/usr/bin/env node
/**
 * smoke-interaction-renderer.ts — 交互层产物 smoke（framework 源模板 + 消费者路径）
 *
 * 用法：
 *   npx ts-node harness/scripts/smoke-interaction-renderer.ts
 *   npx ts-node harness/scripts/smoke-interaction-renderer.ts --project-root <path>
 *   npx ts-node harness/scripts/smoke-interaction-renderer.ts --skip-consumer
 *
 * Phase A — framework 源模板静态检查（agents/claude/templates）
 * Phase B — 消费者 smoke（tmpdir 或 --project-root）：
 *   - claude：materialize 后 `.claude/rules/interaction-renderer.md` 存在
 *   - claude UPDATE：deprecated backup_delete 清理 widget-options/ 与 confirmation-ux.md
 *   - generic + `.codex` bundle root：renderer 落在 `.codex/rules/`，非默认 `.agents/rules/`
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { applyDeprecatedArtifactsCleanup, __testing as checkInitTesting } from './check-init';

type LoadedAdapter = ReturnType<typeof checkInitTesting.loadAdapter>;

const FRAMEWORK_ROOT = path.resolve(__dirname, '..', '..');

const SLASH_COMMANDS = [
  'commands/framework-init.md',
  'commands/catalog-bootstrap.md',
  'commands/glossary-bootstrap.md',
  'commands/prd-design.md',
  'commands/requirement-design.md',
  'commands/coding.md',
  'commands/code-review.md',
  'commands/business-ut.md',
  'commands/device-testing.md',
] as const;

interface SmokeOptions {
  projectRoot: string | null;
  skipConsumer: boolean;
}

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function parseArgs(argv: string[]): SmokeOptions {
  let projectRoot: string | null = null;
  let skipConsumer = false;
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--skip-consumer') {
      skipConsumer = true;
    } else if (arg === '--project-root') {
      const next = argv[i + 1];
      if (!next) fail('--project-root 需要路径参数');
      projectRoot = path.resolve(next);
      i += 1;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`用法: npx ts-node harness/scripts/smoke-interaction-renderer.ts [--project-root <path>] [--skip-consumer]`);
      process.exit(0);
    } else {
      fail(`未知参数: ${arg}`);
    }
  }
  return { projectRoot, skipConsumer };
}

function runFrameworkTemplateSmoke(): void {
  const claudeTpl = path.join(FRAMEWORK_ROOT, 'agents', 'claude', 'templates');
  const renderer = path.join(claudeTpl, 'rules', 'interaction-renderer.md');
  if (!fs.existsSync(renderer)) {
    fail('agents/claude/templates/rules/interaction-renderer.md 缺失');
  }
  const rendererText = fs.readFileSync(renderer, 'utf-8');
  if (!rendererText.includes('AskUserQuestion')) {
    fail('interaction-renderer.md 须声明 AskUserQuestion');
  }

  const legacyConfirm = path.join(claudeTpl, 'rules', 'confirmation-ux.md');
  if (fs.existsSync(legacyConfirm)) {
    fail('confirmation-ux.md 应已删除');
  }
  const legacyWidget = path.join(claudeTpl, 'rules', 'widget-options');
  if (fs.existsSync(legacyWidget)) {
    fail('widget-options/ 应已删除');
  }

  for (const rel of SLASH_COMMANDS) {
    const abs = path.join(claudeTpl, rel);
    if (!fs.existsSync(abs)) fail(`slash 模板缺失: ${rel}`);
    const content = fs.readFileSync(abs, 'utf-8');
    if (!content.includes('AskUserQuestion')) {
      fail(`${rel} 缺少 AskUserQuestion 强约束`);
    }
    if (!content.includes('interaction-renderer')) {
      fail(`${rel} 缺少 interaction-renderer 链接`);
    }
    if (content.includes('widget-options') || content.includes('confirmation-ux.md')) {
      fail(`${rel} 仍引用废弃路径`);
    }
  }

  const registryPath = path.join(FRAMEWORK_ROOT, 'skills', 'reference', 'confirmation-registry.yaml');
  const registry = fs.readFileSync(registryPath, 'utf-8');
  if (!/schema_version:\s*"2\.0"/.test(registry)) {
    fail('confirmation-registry.yaml 须 schema_version 2.0');
  }
  if (/widget_hint:|widget_options_ref:/.test(registry)) {
    fail('confirmation-registry.yaml 不得含废弃字段');
  }
}

function materializeAdapterTemplates(projectRoot: string, adapter: LoadedAdapter): void {
  for (const f of adapter.templateFiles) {
    if (f.kind === 'materialized') continue;
    const tplAbs = path.join(FRAMEWORK_ROOT, f.templateRel);
    if (!fs.existsSync(tplAbs)) continue;
    const tgAbs = path.join(projectRoot, f.targetRel);
    fs.mkdirSync(path.dirname(tgAbs), { recursive: true });
    fs.copyFileSync(tplAbs, tgAbs);
  }
}

function assertConsumerClaudeArtifacts(projectRoot: string): void {
  const renderer = path.join(projectRoot, '.claude/rules/interaction-renderer.md');
  if (!fs.existsSync(renderer)) {
    fail('consumer: .claude/rules/interaction-renderer.md 缺失');
  }
  if (fs.existsSync(path.join(projectRoot, '.claude/rules/confirmation-ux.md'))) {
    fail('consumer: confirmation-ux.md 不应存在');
  }
  if (fs.existsSync(path.join(projectRoot, '.claude/rules/widget-options'))) {
    fail('consumer: widget-options/ 不应存在');
  }
}

function runConsumerSmoke(projectRoot: string, ownsTmp: boolean): void {
  try {
    // --- Claude CREATE：materialize adapter 模板 ---
    const claudeAdapter = checkInitTesting.loadAdapter('claude');
    materializeAdapterTemplates(projectRoot, claudeAdapter);
    assertConsumerClaudeArtifacts(projectRoot);

    // --- Claude UPDATE：deprecated backup_delete ---
    const legacyWidget = path.join(projectRoot, '.claude/rules/widget-options');
    const legacyConfirm = path.join(projectRoot, '.claude/rules/confirmation-ux.md');
    fs.mkdirSync(legacyWidget, { recursive: true });
    fs.writeFileSync(path.join(legacyWidget, 'index.md'), '# legacy');
    fs.writeFileSync(legacyConfirm, '# legacy');

    const { cleaned } = applyDeprecatedArtifactsCleanup(projectRoot, claudeAdapter, 'update');
    if (cleaned.length < 2) {
      fail(`consumer UPDATE: deprecated_artifacts_cleaned 应 ≥2 条，实际 ${cleaned.length}`);
    }
    if (fs.existsSync(legacyWidget) || fs.existsSync(legacyConfirm)) {
      fail('consumer UPDATE: 旧 widget-options/ 或 confirmation-ux.md 未清理');
    }

    // --- Generic 自定义 bundle root ---
    const genericAdapter = checkInitTesting.loadAdapter('generic');
    checkInitTesting.applyGenericAdapterBundle(genericAdapter, {
      root: '.codex',
      skillsDir: '.codex/skills',
      rulesDir: '.codex/rules',
      skillMode: 'inline',
    });
    materializeAdapterTemplates(projectRoot, genericAdapter);

    const genericRenderer = path.join(projectRoot, '.codex/rules/interaction-renderer.md');
    if (!fs.existsSync(genericRenderer)) {
      fail('consumer generic: .codex/rules/interaction-renderer.md 缺失');
    }
    const defaultAgentsRenderer = path.join(projectRoot, '.agents/rules/interaction-renderer.md');
    if (fs.existsSync(defaultAgentsRenderer)) {
      fail('consumer generic: renderer 不应落在默认 .agents/rules/');
    }
  } finally {
    if (ownsTmp) {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  }
}

function main(): void {
  const opts = parseArgs(process.argv);
  runFrameworkTemplateSmoke();

  if (opts.skipConsumer) {
    console.log('PASS: smoke-interaction-renderer（framework 源模板；已跳过 consumer smoke）');
    return;
  }

  if (opts.projectRoot) {
    if (!fs.existsSync(opts.projectRoot)) {
      fail(`--project-root 不存在: ${opts.projectRoot}`);
    }
    assertConsumerClaudeArtifacts(opts.projectRoot);
    console.log(`PASS: smoke-interaction-renderer（framework 源模板 + 消费者 ${opts.projectRoot}）`);
    return;
  }

  const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-interaction-'));
  runConsumerSmoke(tmpdir, true);
  console.log('PASS: smoke-interaction-renderer（framework 源模板 + consumer smoke）');
}

main();
