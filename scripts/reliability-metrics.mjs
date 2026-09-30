#!/usr/bin/env node
// reliability-metrics.mjs — 可靠性指标采集入口（dev-only，plan 1dbe4fa4 t1 / §3）
//
// 按 candidate-release.mjs 的先例，用 harness 的 ts-node（--transpile-only）起子进程运行
// harness/tests/utils/reliability-metrics.ts；参数经环境变量 RELIABILITY_METRICS_OPTIONS（JSON）传入。
// 采集器只读，不向被分析工程写任何文件。
//
// 用法（仓库根）：
//   node scripts/reliability-metrics.mjs --project <工程根> --feature <id> [--framework-root <路径>]
//        [--runs <id,id>] [--observations <json>] [--scenario-results <json>] [--format json|md]
//   node scripts/reliability-metrics.mjs --runs-dir <只含若干 run 目录的目录> [...同上可选项]
//   node scripts/reliability-metrics.mjs --scenario-results <json> [--format md]
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HARNESS = path.join(REPO_ROOT, 'harness');
const TSNODE = path.join(HARNESS, 'node_modules', 'ts-node', 'dist', 'bin.js');
const COLLECTOR = path.join(HARNESS, 'tests', 'utils', 'reliability-metrics.ts');

const USAGE = '用法：--project <工程根> --feature <id> | --runs-dir <目录> | --scenario-results <json>'
  + '；可选 --framework-root --runs --observations --format json|md';

/** @param {string[]} argv @returns {Record<string, unknown>} */
export function parseArgs(argv) {
  const flags = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--') || i + 1 >= argv.length) throw new Error(`参数不完整：${key}\n${USAGE}`);
    flags.set(key.slice(2), argv[(i += 1)]);
  }
  const known = new Set(['project', 'feature', 'framework-root', 'runs', 'runs-dir', 'observations', 'scenario-results', 'format']);
  for (const k of flags.keys()) if (!known.has(k)) throw new Error(`未知参数：--${k}\n${USAGE}`);
  const abs = (k) => (flags.has(k) ? path.resolve(flags.get(k)) : undefined);
  const opts = {
    projectRoot: abs('project'),
    feature: flags.get('feature'),
    frameworkRoot: abs('framework-root'),
    runsDir: abs('runs-dir'),
    runIds: flags.has('runs') ? flags.get('runs').split(',').map((s) => s.trim()).filter(Boolean) : undefined,
    observations: abs('observations'),
    scenarioResults: abs('scenario-results'),
    format: flags.get('format') ?? 'json',
  };
  if (!['json', 'md'].includes(opts.format)) throw new Error(`--format 只支持 json|md：${opts.format}`);
  if (!!opts.projectRoot !== !!opts.feature) throw new Error(`--project 与 --feature 须同时给出\n${USAGE}`);
  if (!opts.projectRoot && !opts.runsDir && !opts.scenarioResults) throw new Error(USAGE);
  return opts;
}

/** @param {string[]} argv */
export function runReliabilityMetrics(argv) {
  const opts = parseArgs(argv);
  if (!fs.existsSync(TSNODE)) throw new Error(`缺少 ts-node：${TSNODE}（先在 harness 下 npm install）`);
  return spawnSync(process.execPath, [TSNODE, '--transpile-only', COLLECTOR], {
    cwd: HARNESS,
    env: { ...process.env, RELIABILITY_METRICS_OPTIONS: JSON.stringify(opts) },
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
    shell: false,
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const r = runReliabilityMetrics(process.argv.slice(2));
    if (r.error) throw r.error;
    process.stdout.write(r.stdout ?? '');
    process.stderr.write(r.stderr ?? '');
    process.exitCode = r.status ?? 1;
  } catch (error) {
    console.error(`[reliability-metrics] ${error.message}`);
    process.exitCode = 2;
  }
}
