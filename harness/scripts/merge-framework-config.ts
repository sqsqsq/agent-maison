#!/usr/bin/env node
// ============================================================================
// merge-framework-config.ts — UPDATE 模式下 config 三 pass 同步工具
// ============================================================================
//
// Pass 1 — BACKFILL：只补缺、不覆盖（BACKFILL_FIELDS）
// Pass 2 — MIGRATION：modernize 已有 key（MIGRATION_RULES，如 project_type → sub_variant）
// Pass 3 — CONFIRM：行为级变更，须 S2 CONFIRM pass（`--confirm-*` flag）后才写入（CONFIRM_FIELDS）
//
// 用法：
//   node framework/harness/scripts/merge-framework-config.mjs [--dry-run] [--apply] [--config <path>]
//     [--confirm-reports-dir-pattern=y|n]
//
// 退出码：
//   0  无需合并 / dry-run / apply 成功
//   1  CLI 参数错误 / 找不到 / 无法解析 framework.config.json
//   2  --apply 时写入或备份失败
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';

import {
  CONFIRM_FIELDS,
  MIGRATION_RULES,
  detectMissingBackfillFields,
  detectMissingConfirmFields,
  detectPendingMigrations,
  getEffectiveBackfillFields,
  mergeFrameworkConfig,
  resolveProfileNameFromRaw,
  MissingFieldEntry,
  PendingConfirmEntry,
  PendingMigrationEntry,
} from './utils/config-field-merger';

const SCRIPT_DIR = __dirname;
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../../..');
const DEFAULT_CONFIG_PATH = path.join(REPO_ROOT, 'framework.config.json');

interface CliArgs {
  apply: boolean;
  dryRun: boolean;
  configPath: string;
  confirmAnswers: Record<string, boolean>;
}

function fail(msg: string, code = 1): never {
  process.stderr.write(`[merge-framework-config] ${msg}\n`);
  process.exit(code);
}

function parseYnFlag(raw: string, flagName: string): boolean {
  const v = raw.trim().toLowerCase();
  if (v === 'y' || v === 'yes' || v === 'true' || v === '1') return true;
  if (v === 'n' || v === 'no' || v === 'false' || v === '0') return false;
  fail(`${flagName} 必须是 y 或 n，收到：${raw}`);
}

function parseArgs(argv: string[]): CliArgs {
  let apply = false;
  let dryRun = false;
  let configPath = DEFAULT_CONFIG_PATH;
  const confirmAnswers: Record<string, boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') apply = true;
    else if (a === '--dry-run') dryRun = true;
    else if (a === '--config') {
      const next = argv[i + 1];
      if (!next) fail('--config 需要跟一个路径参数');
      const userCwd = process.env.MERGE_FW_CONFIG_USER_CWD || process.cwd();
      configPath = path.isAbsolute(next) ? next : path.resolve(userCwd, next);
      i++;
    } else if (a.startsWith('--confirm-reports-dir-pattern=')) {
      confirmAnswers.reports_dir_pattern = parseYnFlag(
        a.slice('--confirm-reports-dir-pattern='.length),
        '--confirm-reports-dir-pattern',
      );
      process.stderr.write(
        '[merge-framework-config] reports_dir_pattern 已自动 BACKFILL，--confirm-reports-dir-pattern 被忽略\n',
      );
    } else if (a === '--help' || a === '-h') {
      process.stdout.write(USAGE + '\n');
      process.exit(0);
    } else {
      fail(`未知参数：${a}`);
    }
  }
  if (apply && dryRun) fail('--apply 与 --dry-run 互斥');
  if (!apply && !dryRun) dryRun = true;
  return { apply, dryRun, configPath, confirmAnswers };
}

const USAGE = `用法: merge-framework-config [--dry-run] [--apply] [--config <path>]

  --dry-run                         打印三 pass 诊断与合并预览，不写盘（默认）
  --apply                           先备份到 <repo>/.framework-backup/<UTC>/，再写回
  --config <path>                   指定 framework.config.json 路径
  --confirm-reports-dir-pattern=y|n （deprecated，no-op；reports_dir_pattern 已自动 BACKFILL）`;

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

function formatMigrationTable(pending: PendingMigrationEntry[]): string {
  if (pending.length === 0) return '（无）';
  const lines: string[] = [];
  lines.push('| # | 规则 ID | 说明 |');
  lines.push('|---|---------|------|');
  pending.forEach((m, i) => {
    lines.push(`| ${i + 1} | \`${m.id}\` | ${m.note} |`);
  });
  return lines.join('\n');
}

function formatConfirmTable(pending: PendingConfirmEntry[]): string {
  if (pending.length === 0) return '（无）';
  const lines: string[] = [];
  lines.push('| # | confirmKey | 字段路径 | 默认值 | 说明 |');
  lines.push('|---|------------|----------|--------|------|');
  pending.forEach((c, i) => {
    const val =
      typeof c.defaultValue === 'string'
        ? `"${c.defaultValue}"`
        : JSON.stringify(c.defaultValue);
    lines.push(`| ${i + 1} | \`${c.confirmKey}\` | \`${c.path}\` | \`${val}\` | ${c.note} |`);
  });
  return lines.join('\n');
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const { raw, text: originalText } = readConfig(args.configPath);

  const profileName = resolveProfileNameFromRaw(raw);
  const effectiveBackfill = getEffectiveBackfillFields(profileName);
  const missing = detectMissingBackfillFields(raw, profileName);
  const pendingMigrations = detectPendingMigrations(raw);
  const pendingConfirm = detectMissingConfirmFields(raw);

  process.stdout.write(`\n=== merge-framework-config ===\n`);
  process.stdout.write(`config: ${args.configPath}\n`);
  process.stdout.write(`mode: ${args.apply ? 'apply' : 'dry-run'}\n`);
  process.stdout.write(`profile: ${profileName}\n`);
  process.stdout.write(`backfill whitelist size: ${effectiveBackfill.length}\n`);
  process.stdout.write(`migration rules: ${MIGRATION_RULES.length}\n`);
  process.stdout.write(`confirm fields: ${CONFIRM_FIELDS.length}\n`);
  process.stdout.write(`missing backfill fields: ${missing.length}\n`);
  process.stdout.write(`pending migrations: ${pendingMigrations.length}\n`);
  process.stdout.write(`pending confirm fields: ${pendingConfirm.length}\n\n`);

  const hasConfirmAnswer = Object.keys(args.confirmAnswers).length > 0;
  const nothingToDo =
    missing.length === 0 &&
    pendingMigrations.length === 0 &&
    pendingConfirm.length === 0;

  if (nothingToDo && !hasConfirmAnswer) {
    process.stdout.write('当前 framework.config.json 已 modernize，无需合并。\n');
    process.exit(0);
  }

  process.stdout.write('【Pass 1 · BACKFILL】缺失字段表：\n');
  process.stdout.write(formatMissingTable(missing) + '\n\n');
  process.stdout.write('【Pass 2 · MIGRATION】待迁移规则：\n');
  process.stdout.write(formatMigrationTable(pendingMigrations) + '\n\n');
  process.stdout.write('【Pass 3 · CONFIRM】待确认字段（须 CONFIRM pass 显式 y 才写入）：\n');
  process.stdout.write(formatConfirmTable(pendingConfirm) + '\n\n');

  const { merged, backfillReport, migrationReport, confirmReport } = mergeFrameworkConfig(
    raw,
    args.confirmAnswers,
    profileName,
  );
  const mergedText = formatJson(merged);

  process.stdout.write('合并摘要：\n');
  process.stdout.write(`  backfill 写入: ${backfillReport.appliedFields.length} 项\n`);
  process.stdout.write(`  migration 执行: ${migrationReport.appliedMigrations.length} 项\n`);
  for (const m of migrationReport.appliedMigrations) {
    process.stdout.write(`    - ${m.id}: ${m.summary}\n`);
  }
  process.stdout.write(`  confirm 写入: ${confirmReport.appliedFields.length} 项\n`);
  for (const c of confirmReport.appliedFields) {
    process.stdout.write(`    - ${c.path}\n`);
  }
  if (confirmReport.rejectedKeys.length > 0) {
    process.stdout.write(`  confirm 拒绝: ${confirmReport.rejectedKeys.join(', ')}\n`);
  }
  process.stdout.write('\n');

  if (args.dryRun) {
    process.stdout.write('--dry-run：未写盘。合并后的 framework.config.json 预览（前 80 行）：\n');
    const preview = mergedText.split('\n').slice(0, 80).join('\n');
    process.stdout.write(preview + '\n');
    if (mergedText.split('\n').length > 80) {
      process.stdout.write('... (合并预览截断；如需写盘请加 --apply)\n');
    }
    process.exit(0);
  }

  try {
    if (originalText === mergedText) {
      process.stdout.write('--apply：合并后内容与磁盘一致，跳过写入。\n');
      process.exit(0);
    }
    const backupRel = backupFile(args.configPath);
    process.stdout.write(`已备份原 framework.config.json 至：${backupRel}\n`);
    fs.writeFileSync(args.configPath, mergedText, 'utf8');
    process.stdout.write(`已写回：${args.configPath}\n`);
    process.exit(0);
  } catch (err) {
    fail(`--apply 写入失败：${(err as Error).message}`, 2);
  }
}

main();
