#!/usr/bin/env node
// ============================================================================
// show-last-committed-framework-config.mjs
// -----------------------------------------------------------------------------
// Reads framework.config.json from git object database (typically HEAD path).
// For /framework-init when the working-copy file was deleted but history exists.
//
// Usage (from repo root):
//   node framework/harness/scripts/show-last-committed-framework-config.mjs
// Exit: 0 + JSON to stdout when found; non-zero when git missing / path absent.
// ============================================================================

const { spawnSync } = require('child_process');
const path = require('path');

const SCRIPT_DIR = __dirname;
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../../..'); // harness/scripts → repo root

function printUsage() {
  process.stderr.write(
    `Usage: show-last-committed-framework-config.mjs [--ref <rev>]\n` +
      `  Prints committed framework.config.json to stdout (must be valid JSON text in git).\n` +
      `  Default pathspec is HEAD:framework.config.json; --ref resolves <rev>:framework.config.json.\n` +
      `  Repo root = parent directory of ./framework\n`,
  );
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  printUsage();
  process.exit(0);
}

let refSpec = 'HEAD';
const refIdx = process.argv.indexOf('--ref');
if (refIdx !== -1 && typeof process.argv[refIdx + 1] === 'string' && process.argv[refIdx + 1].trim()) {
  refSpec = process.argv[refIdx + 1].trim();
}
const GIT_PATHSPEC = `${refSpec}:framework.config.json`;

const gitShow = spawnSync('git', ['-C', REPO_ROOT, 'show', GIT_PATHSPEC], {
  encoding: 'utf8',
  maxBuffer: 10 * 1024 * 1024,
});

if (gitShow.status !== 0) {
  const msg =
    gitShow.stderr.trim() ||
    `git show ${GIT_PATHSPEC} failed (exit ${gitShow.status ?? '?'})。` +
      ` 常见于：仓库无提交、HEAD 不包含该路径、或未安装 git。`;
  process.stderr.write(`[show-last-committed-framework-config] ${msg}\n`);
  process.exit(3);
}

const text = gitShow.stdout;
if (!text || !text.trim()) {
  process.stderr.write('[show-last-committed-framework-config] empty output\n');
  process.exit(4);
}

// Validate JSON early so SKILL consumers get a single error surface.
try {
  JSON.parse(text);
} catch (e) {
  process.stderr.write(
    `[show-last-committed-framework-config] 历史版本不是合法 JSON：${(e && e.message) || String(e)}\n`,
  );
  process.exit(5);
}

process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
