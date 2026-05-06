#!/usr/bin/env node
// ============================================================================
// render-agents-md.mjs — 渲染 framework/templates/AGENTS.md.template
// ============================================================================
//
// 用途
// ----
// 把 framework/templates/AGENTS.md.template 按 framework.config.json 中的
// project_name / project_type / agent_adapter / paths 等字段，加上调用方
// 提供的 --entry-file（须与所选 adapter 的 agent_entry_file.target_path 一致）与
// 替换占位符后写到 --out 指定路径。
//
// 何时调用
// --------
// - framework/skills/00-framework-init Skill **Step 4.1**：当体检表第 2 项
//   报 MISSING / EMPTY 时直接渲染、报 POPULATED 且 Step 0.3.4 收到 Q2=y 时
//   整文件替换。
// - framework 自检 / 模板迁移验证：手工跑一次确认模板渲染产物符合预期。
//
// 路径优先级（v2.8.3 起）
// ----------------------
// 本脚本是 Step 4.1 的**首选路径 / 弱模型强制路径**——不再是「可选辅助工具」。
// 渲染产物 200+ 行中文 markdown，弱模型通过 LLM tool-call 协议向 Write 工具
// 传递大 content 参数时容易出现 `InputValidationError: file_path / content
// missing`（已在真实工程发生事故，v2.8.3 BLOCKER `tool-call retry-loop Ban`
// 的事故现场）。本脚本运行在 Node 进程内，整个大 content 不经过 tool-call
// 协议，从机制上规避此类失败。
//
// 兜底路径（手工 Read 模板 + 占位符替换 + Write 写入）仅在脚本不可用时
// 启用，且重试 ≥ 2 次仍失败必须切回本脚本——见 SKILL §4.1.2 / §4.1.3。
//
// 与 SKILL Step 4.1 占位符表的 SSOT 关系
// --------------------------------------
// 本脚本的占位符列表与 [framework/skills/00-framework-init/SKILL.md] §4.1
// 同步；新增占位符时**必须同时**：
//   1. 更新本脚本 `vars` 对象；
//   2. 更新 SKILL Step 4.1 占位符表；
//   3. 更新 [framework/agents/adapter-schema.yaml] 中 placeholders 段。
//
// 不做什么
// --------
// - 不做 framework.config.json 的 schema 校验（由 config.ts 负责）；
// - 不与用户交互（CLI 一次性写入，由调用方决定是否覆盖；调用前请按 SKILL
//   Step 0.3 体检结果决策）；
// - 不在 Skill 流程外被自动调用（不属于 harness-runner 的 phase）。
//
// 用法
// ----
//   node framework/harness/scripts/render-agents-md.mjs \
//     --entry-file AGENTS.md \
//     --summary "5 外层；模块内 4 层；跨模块出口 Index.ets" \
//     --out AGENTS.md
//
// 选项
//   --entry-file   <文件名>   入口文件展示名（替换 {{AGENT_ENTRY_FILE}}）
//   --summary      <一句话>                 架构摘要（替换 {{ARCHITECTURE_SUMMARY}}）
//   --out          <实例工程根相对路径>     输出文件（已存在则覆盖）
//
// 退出码
//   0  正常写入
//   1  缺少必填参数 / 模板或 config 不存在 / 渲染产物中仍有未替换占位符
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../../..');
const TEMPLATE_PATH = path.join(REPO_ROOT, 'framework/templates/AGENTS.md.template');
const CONFIG_PATH = path.join(REPO_ROOT, 'framework.config.json');

const KNOWN_PROJECT_TYPE_LABELS = {
  app: '应用工程',
  atomic_service: '元服务工程',
};

function fail(message, exitCode = 1) {
  process.stderr.write(`[render-agents-md] ${message}\n`);
  process.exit(exitCode);
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    fail(`framework.config.json 不存在：${CONFIG_PATH}`);
  }
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (err) {
    fail(`framework.config.json 解析失败：${err.message}`);
  }
}

function loadTemplate() {
  if (!fs.existsSync(TEMPLATE_PATH)) {
    fail(`AGENTS.md.template 不存在：${TEMPLATE_PATH}`);
  }
  return fs.readFileSync(TEMPLATE_PATH, 'utf8');
}

function buildVars(config, { entryFile, architectureSummary }) {
  const projectTypeLabel = KNOWN_PROJECT_TYPE_LABELS[config.project_type] ?? config.project_type;
  const paths = config.paths ?? {};
  return {
    AGENT_ENTRY_FILE: entryFile,
    PROJECT_NAME: config.project_name ?? '',
    PROJECT_TYPE: config.project_type ?? '',
    PROJECT_TYPE_LABEL: projectTypeLabel ?? '',
    AGENT_ADAPTER: config.agent_adapter ?? '',
    ARCHITECTURE_SUMMARY: architectureSummary,
    ARCHITECTURE_MD_PATH: paths.architecture_md ?? 'doc/architecture.md',
    MODULE_CATALOG_PATH: paths.module_catalog ?? 'doc/module-catalog.yaml',
    GLOSSARY_PATH: paths.glossary ?? 'doc/glossary.yaml',
    FEATURES_DIR: paths.features_dir ?? 'doc/features',
  };
}

function renderTemplate(tpl, vars) {
  let rendered = tpl;
  for (const [key, value] of Object.entries(vars)) {
    rendered = rendered.replaceAll(`{{${key}}}`, value);
  }
  return rendered;
}

function findUnreplacedPlaceholders(rendered) {
  const matches = rendered.match(/\{\{[A-Z_][A-Z0-9_]*\}\}/g);
  return matches ? Array.from(new Set(matches)) : [];
}

function parseArgs(argv) {
  const known = new Set(['--entry-file', '--summary', '--out']);
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (!known.has(flag)) continue;
    const value = argv[i + 1];
    if (typeof value === 'undefined' || value.startsWith('--')) {
      fail(`选项 ${flag} 缺少值`);
    }
    result[flag] = value;
    i++;
  }
  return result;
}

function printUsage() {
  process.stderr.write(
    'Usage: render-agents-md.mjs --entry-file <EntryMarkdown.md> ' +
      '--summary "<one-line>" --out <path-relative-to-repo-root>\n',
  );
}

function main() {
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
      `渲染产物仍有未替换占位符：${remaining.join(', ')}\n` +
        `请检查模板与本脚本 vars 表是否同步。`,
    );
  }

  const outPath = path.resolve(REPO_ROOT, args['--out']);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, rendered, 'utf8');

  const lineCount = rendered.split('\n').length;
  process.stdout.write(
    `[render-agents-md] wrote ${outPath} (${rendered.length} chars, ${lineCount} lines)\n`,
  );
}

main();
