#!/usr/bin/env npx ts-node
/**
 * Lint agent-authored ad-hoc steps-file (no device).
 *
 *   npm run lint-adhoc-steps -- --file path/to/test-steps.json
 */
import * as fs from 'fs';
import * as path from 'path';
import minimist from 'minimist';
import { validatePlannedStepsArray } from './utils/hylyre-planned-step-lint';
import { normalizePlannedStepsInput } from './utils/hylyre-steps-normalize';

const argv = minimist(process.argv.slice(2), {
  string: ['file', 'f', 'normalized-out', 'project-root', 'p'],
  boolean: ['normalize', 'n'],
});

const filePath = (argv.file || argv.f || '').trim();
const normalize = argv.normalize === true || argv.n === true;
const normalizedOut = (argv['normalized-out'] || '').trim();

if (!filePath) {
  console.error('用法: npm run lint-adhoc-steps -- --file <path> [--normalize] [--normalized-out <path>]');
  process.exit(2);
}

const abs = path.resolve(filePath);
if (!fs.existsSync(abs)) {
  console.error(`文件不存在: ${abs}`);
  process.exit(2);
}

let parsed: unknown;
try {
  parsed = JSON.parse(fs.readFileSync(abs, 'utf-8'));
} catch (e) {
  console.error(`JSON 解析失败: ${(e as Error).message}`);
  process.exit(2);
}

let toLint = parsed;
const normWarnings: string[] = [];
if (normalize) {
  const norm = normalizePlannedStepsInput(parsed);
  normWarnings.push(...norm.warnings);
  toLint = norm.steps;
  if (norm.changed && normalizedOut) {
    fs.mkdirSync(path.dirname(path.resolve(normalizedOut)), { recursive: true });
    fs.writeFileSync(
      path.resolve(normalizedOut),
      `${JSON.stringify(norm.steps, null, 2)}\n`,
      'utf-8',
    );
    console.error(`ADHOC_NORMALIZED_FILE=${path.resolve(normalizedOut)}`);
  }
  for (const w of norm.warnings) console.error(`[normalize] ${w}`);
}

const v = validatePlannedStepsArray(toLint);
const report = {
  ok: v.ok,
  file: abs,
  normalized: normalize,
  violations: v.ok ? [] : v.violations,
  normalize_warnings: normWarnings,
};

if (!v.ok) {
  console.error(JSON.stringify(report, null, 2));
  for (const x of v.violations) {
    console.error(`  [${x.rule_id}] #${x.index}: ${x.message}`);
  }
  process.exit(2);
}

console.log(JSON.stringify(report, null, 2));
process.exit(0);
