#!/usr/bin/env node
// ============================================================================
// render-agents-md.ts — 渲染 framework/templates/AGENTS.md.template
// ============================================================================
//
// 经由 render-agents-md.mjs shim 调用：`node .../render-agents-md.mjs` → ts-node 本文件。
// 详见原 mjs 头注释（占位符 / SSOT / 用法）。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { detectRepoLayout } from '../repo-layout';
import { emitInstanceSkillBridge } from './utils/instance-skill-bridge';
import {
  assertNoUnreplacedPlaceholders,
  buildAgentsTemplateVars,
  renderAgentsTemplate,
} from './utils/template-renderer';

const SCRIPT_DIR = __dirname;
const layout = detectRepoLayout(SCRIPT_DIR);
const REPO_ROOT = layout.projectRoot;
const FRAMEWORK_DIR = layout.frameworkRoot;
const TEMPLATE_PATH = path.join(FRAMEWORK_DIR, 'templates/AGENTS.md.template');
const DEFAULT_CONFIG_PATH = path.join(REPO_ROOT, 'framework.config.json');

function fail(message: string, exitCode = 1): never {
  process.stderr.write(`[render-agents-md] ${message}\n`);
  process.exit(exitCode);
}

function resolveConfigPath(cliPath: string | undefined): string {
  if (!cliPath || cliPath.trim() === '') {
    return DEFAULT_CONFIG_PATH;
  }
  const t = cliPath.trim();
  return path.isAbsolute(t) ? t : path.resolve(REPO_ROOT, t);
}

function loadConfig(configPath: string): Record<string, unknown> {
  if (!fs.existsSync(configPath)) {
    fail(`config 不存在或不可读（可用 --config 指定路径）：${configPath}`);
  }
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>;
  } catch (err) {
    fail(`framework.config.json 解析失败：${(err as Error).message}`);
  }
}

function loadTemplate(): string {
  if (!fs.existsSync(TEMPLATE_PATH)) {
    fail(`AGENTS.md.template 不存在：${TEMPLATE_PATH}`);
  }
  return fs.readFileSync(TEMPLATE_PATH, 'utf8');
}

function parseArgs(argv: string[]): {
  '--entry-file'?: string;
  '--summary'?: string;
  '--out'?: string;
  '--config'?: string;
  '--no-instance-bridge'?: boolean;
} {
  const known = new Set(['--entry-file', '--summary', '--out', '--config', '--no-instance-bridge']);
  const result: {
    '--entry-file'?: string;
    '--summary'?: string;
    '--out'?: string;
    '--config'?: string;
    '--no-instance-bridge'?: boolean;
  } = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--no-instance-bridge') {
      result['--no-instance-bridge'] = true;
      continue;
    }
    if (!known.has(flag)) {
      continue;
    }
    const value = argv[i + 1];
    if (typeof value === 'undefined' || value.startsWith('--')) {
      fail(`选项 ${flag} 缺少值`);
    }
    if (flag === '--entry-file') {
      result['--entry-file'] = value;
    } else if (flag === '--summary') {
      result['--summary'] = value;
    } else if (flag === '--out') {
      result['--out'] = value;
    } else if (flag === '--config') {
      result['--config'] = value;
    }
    i++;
  }
  return result;
}

function printUsage(): void {
  process.stderr.write(
    'Usage: render-agents-md.ts --entry-file <EntryMarkdown.md> ' +
      '[--summary "<one-line>"] --out <path-relative-to-repo-root> ' +
      '[--config <path>] [--no-instance-bridge]\n' +
      '  --summary: 可选；未传时按 config.architecture 生成 DSL 风格架构摘要。\n' +
      '  --config: 默认读取仓库根下 framework.config.json；可指向其它 JSON（绝对路径或相对仓库根）。\n',
  );
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  if (!args['--entry-file'] || !args['--out']) {
    printUsage();
    process.exit(1);
  }

  const configPath = resolveConfigPath(args['--config']);
  const config = loadConfig(configPath);
  const tpl = loadTemplate();
  const vars = buildAgentsTemplateVars(config, {
    entryFile: args['--entry-file'],
    projectRoot: REPO_ROOT,
    frameworkRoot: FRAMEWORK_DIR,
    architectureSummary: args['--summary'],
  });
  const rendered = renderAgentsTemplate(tpl, vars);

  try {
    assertNoUnreplacedPlaceholders(rendered, 'render-agents-md CLI');
  } catch (e) {
    fail((e as Error).message);
  }

  const outPath = path.resolve(REPO_ROOT, args['--out']);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, rendered, 'utf8');

  const lineCount = rendered.split('\n').length;
  process.stdout.write(
    `[render-agents-md] wrote ${outPath} (${rendered.length} chars, ${lineCount} lines)\n`,
  );

  if (!args['--no-instance-bridge']) {
    const paths = (config.paths && typeof config.paths === 'object'
      ? config.paths
      : {}) as Record<string, unknown>;
    const extDir =
      typeof paths.extension_dir === 'string' && paths.extension_dir.trim()
        ? paths.extension_dir.trim()
        : 'doc/extensions';
    const emit = emitInstanceSkillBridge({
      repoRoot: REPO_ROOT,
      frameworkDir: FRAMEWORK_DIR,
      agentAdapter: String(config.agent_adapter ?? 'generic'),
      extensionDirRel: extDir,
    });
    for (const w of emit.warnings) {
      process.stderr.write(`[render-agents-md] ${w}\n`);
    }
    if (emit.filesWritten.length > 0) {
      process.stdout.write(
        `[render-agents-md] instance_skill_bridge wrote ${emit.filesWritten.length} file(s)\n`,
      );
    }
  }
}

main();
