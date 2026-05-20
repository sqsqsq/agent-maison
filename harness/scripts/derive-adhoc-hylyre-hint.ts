#!/usr/bin/env npx ts-node
/**
 * Ad-hoc derive hint: bundle + NL steps → JSON for agent / adhoc-device-test.
 *
 *   cd framework/harness && npm run derive-adhoc-hylyre-hint -- \
 *     --bundle com.example.app --steps "打开应用->点击首页"
 */
import * as fs from 'fs';
import * as path from 'path';
import minimist from 'minimist';
import { buildNavigationHintForCase } from './utils/test-plan-derive-hint';
import {
  appSnapshotCacheAbsFor,
  buildSelectorHints,
  isSnapshotCacheEmpty,
  listSnapshotPages,
} from './utils/app-snapshot-cache-hint';
import {
  FORBIDDEN_STEP_ROOT_KEYS,
  PLANNED_STEP_ROOT_KEYS,
} from './utils/hylyre-planned-step-keys';
import {
  splitNaturalLanguageSteps,
  translateNaturalStepsToPlanned,
} from './utils/adhoc-step-translate';

const argv = minimist(process.argv.slice(2), {
  string: ['bundle', 'b', 'steps', 's', 'project-root', 'p', 'out', 'o'],
});

function defaultProjectRoot(): string {
  const cwd = process.cwd();
  if (path.basename(cwd) === 'harness' && path.basename(path.dirname(cwd)) === 'framework') {
    return path.resolve(cwd, '..', '..');
  }
  return cwd;
}

const projectRoot = path.resolve(argv['project-root'] || argv.p || defaultProjectRoot());
const bundle = (argv.bundle || argv.b || '').trim();
const stepsRaw = (argv.steps || argv.s || '').trim();
const outPath = (argv.out || argv.o || '').trim();

if (!bundle || !stepsRaw) {
  console.error(
    '用法: npm run derive-adhoc-hylyre-hint -- --bundle <id> --steps "打开->点击…" [--out file.json]',
  );
  process.exit(2);
}

const natural_steps = splitNaturalLanguageSteps(stepsRaw);
const planned_steps = translateNaturalStepsToPlanned(natural_steps);
const cacheAbs = appSnapshotCacheAbsFor(projectRoot);
const snapshot_cache_empty = isSnapshotCacheEmpty(cacheAbs, bundle);
const available_pages = listSnapshotPages(cacheAbs, bundle);
const selector_hints = buildSelectorHints(cacheAbs, bundle, natural_steps);

const navRow = {
  tc_id: 'TC-001',
  name: 'adhoc flow',
  precondition: '已启动 app',
  steps_natural_language: stepsRaw,
  expected: '',
  priority: 'P0',
  ac_ref: 'ad-hoc',
};

const payload = {
  schema: 4,
  mode: 'adhoc',
  bundle,
  generated_at: new Date().toISOString(),
  natural_steps,
  planned_steps,
  navigation_hint: buildNavigationHintForCase(navRow),
  snapshot_cache_empty,
  available_pages,
  selector_hints,
  allowed_step_roots: [...PLANNED_STEP_ROOT_KEYS],
  forbidden_in_steps: ['start_app', ...FORBIDDEN_STEP_ROOT_KEYS],
  canonical_format: 'direct root keys e.g. {"touch":{"by_text":"…"}} — no markdown backticks in plan cells',
};

const text = `${JSON.stringify(payload, null, 2)}\n`;
if (outPath) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, text, 'utf-8');
  console.error(`已写入 ${path.resolve(outPath)}`);
} else {
  process.stdout.write(text);
}
