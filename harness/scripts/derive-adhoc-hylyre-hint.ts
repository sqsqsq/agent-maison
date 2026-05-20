#!/usr/bin/env npx ts-node
/**
 * Ad-hoc derive hint: bundle + NL steps → JSON for agent (no Hylyre JSON translation).
 *
 *   cd framework/harness && npm run derive-adhoc-hylyre-hint -- \
 *     --bundle com.example.app --steps "打开应用->点击首页"
 */
import * as fs from 'fs';
import * as path from 'path';
import minimist from 'minimist';
import { buildAdhocDerivePayload } from './utils/adhoc-derive-payload';

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

const payload = buildAdhocDerivePayload(projectRoot, bundle, stepsRaw);
const text = `${JSON.stringify(payload, null, 2)}\n`;
if (outPath) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, text, 'utf-8');
  console.error(`已写入 ${path.resolve(outPath)}`);
} else {
  process.stdout.write(text);
}
