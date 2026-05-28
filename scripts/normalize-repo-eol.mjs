#!/usr/bin/env node
// normalize-repo-eol.mjs — 将 git 已跟踪文本文件工作区行尾归一化为 LF
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  isProbablyBinaryBuffer,
  isReleaseBinaryRelPath,
  normalizeReleaseTextEol,
  toPosixPath,
} from './release-pack-rules.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

/** @returns {string[]} */
function listTrackedFiles() {
  const raw = execSync('git ls-files -z', { cwd: REPO_ROOT });
  const parts = raw.toString('utf8').split('\0').filter(Boolean);
  return parts.map(p => toPosixPath(p));
}

function main() {
  let changed = 0;
  let skippedBinary = 0;
  for (const rel of listTrackedFiles()) {
    const abs = path.join(REPO_ROOT, rel);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
    if (isReleaseBinaryRelPath(rel)) {
      skippedBinary += 1;
      continue;
    }
    const raw = fs.readFileSync(abs);
    if (isProbablyBinaryBuffer(raw)) {
      skippedBinary += 1;
      continue;
    }
    const text = raw.toString('utf8');
    const normalized = normalizeReleaseTextEol(text);
    if (text === normalized) continue;
    fs.writeFileSync(abs, normalized, 'utf8');
    changed += 1;
  }
  console.log(`[normalize-repo-eol] changed=${changed} skippedBinary=${skippedBinary}`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}
