#!/usr/bin/env npx ts-node
/**
 * Summarize hylyre dump-ui JSON for ad-hoc observation (avoid reading full UI tree).
 *
 *   npm run summarize-adhoc-dump -- --file doc/app-snapshot-cache/<bundle>/dump-ui-*.json
 */
import * as fs from 'fs';
import * as path from 'path';
import minimist from 'minimist';
import {
  formatAdhocDumpSummaryMarkdown,
  summarizeAdhocDumpFile,
} from './utils/adhoc-summarize-dump';

const argv = minimist(process.argv.slice(2), {
  string: ['file', 'f', 'format'],
  boolean: ['markdown', 'md'],
});

const filePath = (argv.file || argv.f || '').trim();
const asMarkdown = argv.markdown === true || argv.md === true || argv.format === 'md';

if (!filePath) {
  console.error('用法: npm run summarize-adhoc-dump -- --file <dump-ui.json> [--markdown]');
  process.exit(2);
}

const abs = path.resolve(filePath);
if (!fs.existsSync(abs)) {
  console.error(`文件不存在: ${abs}`);
  process.exit(2);
}

const summary = summarizeAdhocDumpFile(abs);

if (asMarkdown) {
  process.stdout.write(formatAdhocDumpSummaryMarkdown(summary));
} else {
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}
console.error(`ADHOC_SUMMARY_JSON=${JSON.stringify(summary)}`);
