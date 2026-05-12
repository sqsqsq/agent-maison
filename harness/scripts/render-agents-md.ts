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
import {
  emitInstanceSkillBridge,
  formatExtensionSkillSectionMarkdown,
  loadReservedBridgeIds,
  resolveBridgeTargets,
  scanExtensionSkills,
} from './utils/instance-skill-bridge';

const SCRIPT_DIR = __dirname;
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../../..');
const FRAMEWORK_DIR = path.join(REPO_ROOT, 'framework');
const TEMPLATE_PATH = path.join(FRAMEWORK_DIR, 'templates/AGENTS.md.template');
const CONFIG_PATH = path.join(REPO_ROOT, 'framework.config.json');

const KNOWN_PROJECT_TYPE_LABELS: Record<string, string> = {
  app: '应用工程',
  atomic_service: '元服务工程',
};

function fail(message: string, exitCode = 1): never {
  process.stderr.write(`[render-agents-md] ${message}\n`);
  process.exit(exitCode);
}

function loadProfileAgentsPartial(profileName: string, fileBase: string): string {
  const name =
    typeof profileName === 'string' && profileName.trim() !== '' ? profileName.trim() : 'hmos-app';
  const candidates = [
    path.join(FRAMEWORK_DIR, 'profiles', name, 'templates', 'agents-md', `${fileBase}.partial.md`),
    path.join(FRAMEWORK_DIR, 'profiles', 'generic', 'templates', 'agents-md', `${fileBase}.partial.md`),
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) {
      continue;
    }
    return fs.readFileSync(p, 'utf8').replace(/\s+$/, '');
  }
  return '';
}

function loadConfig(): Record<string, unknown> {
  if (!fs.existsSync(CONFIG_PATH)) {
    fail(`framework.config.json 不存在：${CONFIG_PATH}`);
  }
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as Record<string, unknown>;
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

function buildVars(
  config: Record<string, unknown>,
  opts: { entryFile: string; architectureSummary: string },
): Record<string, string> {
  const projectTypeLabel =
    KNOWN_PROJECT_TYPE_LABELS[String(config.project_type)] ?? String(config.project_type ?? '');
  const paths = (config.paths && typeof config.paths === 'object'
    ? config.paths
    : {}) as Record<string, unknown>;
  const pp =
    config.project_profile && typeof config.project_profile === 'object'
      ? (config.project_profile as Record<string, unknown>)
      : {};
  const profileName =
    typeof pp.name === 'string' && pp.name.trim() !== '' ? pp.name.trim() : 'hmos-app';
  const extDir =
    typeof paths.extension_dir === 'string' && paths.extension_dir.trim()
      ? paths.extension_dir.trim()
      : 'doc/extensions';

  const rows = scanExtensionSkills(REPO_ROOT, extDir);
  const reserved = loadReservedBridgeIds(FRAMEWORK_DIR);
  const { targets } = resolveBridgeTargets(rows, reserved);

  return {
    AGENT_ENTRY_FILE: opts.entryFile,
    PROJECT_NAME: String(config.project_name ?? ''),
    PROJECT_TYPE: String(config.project_type ?? ''),
    PROJECT_TYPE_LABEL: projectTypeLabel ?? '',
    AGENT_ADAPTER: String(config.agent_adapter ?? ''),
    PROJECT_PROFILE_NAME: profileName,
    PROJECT_PROFILE_SUB_VARIANT:
      typeof pp.sub_variant === 'string' && pp.sub_variant.trim() ? pp.sub_variant.trim() : '—',
    ARCHITECTURE_SUMMARY: opts.architectureSummary,
    PROFILE_AGENT_SSOT_ROWS: loadProfileAgentsPartial(profileName, 'agent-ssot-rows'),
    PROFILE_AGENT_GUARDRAILS: loadProfileAgentsPartial(profileName, 'agent-guardrails'),
    ARCHITECTURE_MD_PATH: String(paths.architecture_md ?? 'doc/architecture.md'),
    MODULE_CATALOG_PATH: String(paths.module_catalog ?? 'doc/module-catalog.yaml'),
    GLOSSARY_PATH: String(paths.glossary ?? 'doc/glossary.yaml'),
    FEATURES_DIR: String(paths.features_dir ?? 'doc/features'),
    EXTENSION_SKILL_SECTION: formatExtensionSkillSectionMarkdown(targets),
  };
}

function renderTemplate(tpl: string, vars: Record<string, string>): string {
  let rendered = tpl;
  for (const [key, value] of Object.entries(vars)) {
    rendered = rendered.split(`{{${key}}}`).join(value);
  }
  return rendered;
}

function findUnreplacedPlaceholders(rendered: string): string[] {
  const matches = rendered.match(/\{\{[A-Z_][A-Z0-9_]*\}\}/g);
  return matches ? Array.from(new Set(matches)) : [];
}

function parseArgs(argv: string[]): {
  '--entry-file'?: string;
  '--summary'?: string;
  '--out'?: string;
  '--no-instance-bridge'?: boolean;
} {
  const known = new Set(['--entry-file', '--summary', '--out', '--no-instance-bridge']);
  const result: {
    '--entry-file'?: string;
    '--summary'?: string;
    '--out'?: string;
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
    result[flag as '--entry-file' | '--summary' | '--out'] = value;
    i++;
  }
  return result;
}

function printUsage(): void {
  process.stderr.write(
    'Usage: render-agents-md.ts --entry-file <EntryMarkdown.md> ' +
      '--summary "<one-line>" --out <path-relative-to-repo-root> [--no-instance-bridge]\n',
  );
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  if (!args['--entry-file'] || !args['--summary'] || !args['--out']) {
    printUsage();
    process.exit(1);
  }

  const config = loadConfig();
  const tpl = loadTemplate();
  const vars = buildVars(config, {
    entryFile: args['--entry-file'],
    architectureSummary: args['--summary'],
  });
  const rendered = renderTemplate(tpl, vars);

  const remaining = findUnreplacedPlaceholders(rendered);
  if (remaining.length > 0) {
    fail(
      `渲染产物仍有未替换占位符：${remaining.join(', ')}\n` + `请检查模板与本脚本 vars 表是否同步。`,
    );
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
