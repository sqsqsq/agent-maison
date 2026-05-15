#!/usr/bin/env node
// ============================================================================
// merge-framework-config.ts — UPDATE 模式下「字段级只补缺」合并工具
// ============================================================================
//
// 经由 merge-framework-config.mjs shim 调用：`node .../merge-framework-config.mjs`
// → ts-node 本文件。
//
// 设计目标：解决 Skill 00 UPDATE 模式历史只有「整文件替换 / 跳过」两档导致的
// 「框架新增字段无法机器化追平」问题。本脚本只补缺、不覆盖：
//
//   - 老 config 完全没有的白名单字段 → 按 framework 默认值补；
//   - 老 config 已有的字段（哪怕值不同于默认）→ 一律保留；
//   - 白名单之外的字段 → 一律不动；
//   - 白名单 SSOT 在 utils/config-field-merger.ts 的 BACKFILL_FIELDS。
//
// 用法：
//   node framework/harness/scripts/merge-framework-config.mjs [--dry-run] [--apply] [--config <path>]
//
// 参数：
//   --dry-run             仅打印缺失字段表与合并后预览（默认模式，不写盘）
//   --apply               写回 framework.config.json，先备份到 .framework-backup/<UTC>/
//   --config <path>       指定 framework.config.json 绝对路径（默认 <repo-root>/framework.config.json）
//
// 退出码：
//   0  无缺失字段（无需合并） 或 dry-run / apply 成功
//   1  CLI 参数错误 / 找不到 / 无法解析 framework.config.json
//   2  --apply 时写入或备份失败
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';

import {
  BACKFILL_FIELDS,
  detectMissingBackfillFields,
  mergeBackfillFields,
  MissingFieldEntry,
} from './utils/config-field-merger';

const SCRIPT_DIR = __dirname;
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../../..');
const DEFAULT_CONFIG_PATH = path.join(REPO_ROOT, 'framework.config.json');

interface CliArgs {
  apply: boolean;
  dryRun: boolean;
  configPath: string;
}

function fail(msg: string, code = 1): never {
  process.stderr.write(`[merge-framework-config] ${msg}\n`);
  process.exit(code);
}

function parseArgs(argv: string[]): CliArgs {
  let apply = false;
  let dryRun = false;
  let configPath = DEFAULT_CONFIG_PATH;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') apply = true;
    else if (a === '--dry-run') dryRun = true;
    else if (a === '--config') {
      const next = argv[i + 1];
      if (!next) fail('--config 需要跟一个路径参数');
      // mjs shim 把 cwd 切到 harnessRoot；--config 的相对路径应**相对于用户调用 shim 时的 cwd**
      // 解析，否则会把 `framework/harness/foo.json` 误解析为 `<harness>/framework/harness/foo.json`。
      const userCwd = process.env.MERGE_FW_CONFIG_USER_CWD || process.cwd();
      configPath = path.isAbsolute(next) ? next : path.resolve(userCwd, next);
      i++;
    } else if (a === '--help' || a === '-h') {
      process.stdout.write(USAGE + '\n');
      process.exit(0);
    } else {
      fail(`未知参数：${a}`);
    }
  }
  if (apply && dryRun) fail('--apply 与 --dry-run 互斥');
  if (!apply && !dryRun) dryRun = true; // 默认 dry-run，避免误改
  return { apply, dryRun, configPath };
}

const USAGE = `用法: merge-framework-config [--dry-run] [--apply] [--config <path>]

  --dry-run    仅打印缺失字段与合并预览，不写盘（默认）
  --apply      先备份到 <repo>/.framework-backup/<UTC>/，再写回 framework.config.json
  --config     指定 framework.config.json 路径（默认 <repo-root>/framework.config.json）`;

function readConfig(p: string): { raw: unknown; text: string } {
  if (!fs.existsSync(p)) fail(`找不到 framework.config.json：${p}`);
  let text: string;
  try {
    text = fs.readFileSync(p, 'utf8');
  } catch (err) {
    fail(`读取失败：${(err as Error).message}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    fail(`framework.config.json 不是合法 JSON：${(err as Error).message}`);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    fail('framework.config.json 顶层必须是 JSON 对象');
  }
  return { raw, text };
}

function formatJson(obj: unknown): string {
  return JSON.stringify(obj, null, 2) + '\n';
}

function utcStamp(): string {
  return new Date()
    .toISOString()
    .replace(/[:T]/g, '-')
    .replace(/\.\d+Z$/, 'Z');
}

function backupFile(configPath: string): string {
  const repoRoot = path.dirname(configPath);
  const backupRoot = path.join(repoRoot, '.framework-backup', utcStamp());
  fs.mkdirSync(backupRoot, { recursive: true });
  const dst = path.join(backupRoot, 'framework.config.json');
  fs.copyFileSync(configPath, dst);
  return path.relative(repoRoot, dst).replace(/\\/g, '/');
}

function formatMissingTable(missing: MissingFieldEntry[]): string {
  if (missing.length === 0) return '（无）';
  const lines: string[] = [];
  lines.push('| # | 字段路径 | 默认值 | 说明 |');
  lines.push('|---|----------|--------|------|');
  missing.forEach((f, i) => {
    const val =
      typeof f.defaultValue === 'string'
        ? `"${f.defaultValue}"`
        : JSON.stringify(f.defaultValue);
    lines.push(`| ${i + 1} | \`${f.path}\` | \`${val}\` | ${f.note} |`);
  });
  return lines.join('\n');
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const { raw, text: originalText } = readConfig(args.configPath);

  const missing = detectMissingBackfillFields(raw);
  process.stdout.write(`\n=== merge-framework-config ===\n`);
  process.stdout.write(`config: ${args.configPath}\n`);
  process.stdout.write(`mode: ${args.apply ? 'apply' : 'dry-run'}\n`);
  process.stdout.write(`backfill whitelist size: ${BACKFILL_FIELDS.length}\n`);
  process.stdout.write(`missing fields: ${missing.length}\n\n`);

  if (missing.length === 0) {
    process.stdout.write('当前 framework.config.json 已包含所有白名单字段，无需合并。\n');
    process.exit(0);
  }

  process.stdout.write('缺失字段表：\n');
  process.stdout.write(formatMissingTable(missing) + '\n\n');

  const { merged } = mergeBackfillFields(raw);
  const mergedText = formatJson(merged);

  if (args.dryRun) {
    process.stdout.write('--dry-run：未写盘。合并后的 framework.config.json 预览（前 80 行）：\n');
    const preview = mergedText.split('\n').slice(0, 80).join('\n');
    process.stdout.write(preview + '\n');
    if (mergedText.split('\n').length > 80) {
      process.stdout.write('... (合并预览截断；如需写盘请加 --apply)\n');
    }
    process.exit(0);
  }

  // --apply
  try {
    // 仅当当前磁盘内容确实与即将写入不同才动盘，避免反复触发 git diff
    if (originalText === mergedText) {
      process.stdout.write('--apply：合并后内容与磁盘一致，跳过写入。\n');
      process.exit(0);
    }
    const backupRel = backupFile(args.configPath);
    process.stdout.write(`已备份原 framework.config.json 至：${backupRel}\n`);
    fs.writeFileSync(args.configPath, mergedText, 'utf8');
    process.stdout.write(`已写回：${args.configPath}\n`);
    process.stdout.write(`本次补缺 ${missing.length} 个字段。\n`);
    process.exit(0);
  } catch (err) {
    fail(`--apply 写入失败：${(err as Error).message}`, 2);
  }
}

main();
