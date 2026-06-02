#!/usr/bin/env node
// check-stale-init-refs.mjs — 发布内容中 stale framework-init 旧编号扫描（context-anchored）
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  collectReleaseFiles,
  isProbablyBinaryBuffer,
  isReleaseBinaryRelPath,
  loadReleaseExcludes,
} from './release-pack-rules.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

/** @type {RegExp[]} context-anchored；禁用裸 Step \d.\d 以免误伤 catalog/coding 自身步骤 */
const STALE_PATTERNS = [
  /(?:Skill|SKILL)\s*00\s*(?:§|Step)\s*\d/,
  /(?:Skill|SKILL)\s*0\.3(?:\.\d+)?/,
  /§\s*0\.3(?:\.\d+)?/,
  /init\s+Skill\s+Step\s*\d/,
  /init\s+Step\s*0\./,
  /Q1\.[A-Z]/,
  /(?:SKILL|根\s*SKILL)\s*5\.4\.5(?:\.\d+)?/,
  /Step\s*0\s*(?:→|->|~|～|-|—|－|至|到)\s*(?:Step\s*)?7/,
];

/**
 * 精确行级 allowlist（Phase 0 实际命中 · legacy 历史回顾）。
 * 禁止宽泛条件（如 `§v\d` / 任意含 legacy 的行），以免误放行同条现在时 stale 引用。
 * @type {{ file: string, line: number, match: RegExp }[]}
 */
const LINE_ALLOWLIST = [
  { file: 'MIGRATION.md', line: 73, match: /Step 0\.3\.4.*已废弃/ },
  { file: 'MIGRATION.md', line: 131, match: /Step 0\.3\.4 \*\*Q1=y\*\*/ },
  { file: 'MIGRATION.md', line: 375, match: /v2\.5 之前 Skill 00 §5\.1/ },
  { file: 'MIGRATION.md', line: 403, match: /legacy Q1\.A/ },
  { file: 'MIGRATION.md', line: 599, match: /Step 0\.2\.5\.1 表格/ },
  { file: 'MIGRATION.md', line: 600, match: /legacy Step 0\.3\.4/ },
  { file: 'MIGRATION.md', line: 620, match: /§0\.2\.5\.1/ },
  { file: 'docs/overview.md', line: 171, match: /Step 0\.3\.4.*v2\.8\.2/ },
];

/**
 * @param {string} rel POSIX path
 * @param {string} line
 * @param {number} lineNo 1-based
 */
function isAllowlisted(rel, line, lineNo) {
  return LINE_ALLOWLIST.some(
    (entry) => entry.file === rel && entry.line === lineNo && entry.match.test(line),
  );
}

/**
 * @param {string} [repoRoot]
 * @returns {{ ok: boolean, hits: { file: string, line: number, text: string }[] }}
 */
export function checkStaleInitRefs(repoRoot = REPO_ROOT) {
  const rules = loadReleaseExcludes();
  const { included } = collectReleaseFiles(repoRoot, rules);
  /** @type {{ file: string, line: number, text: string }[]} */
  const hits = [];

  for (const rel of included) {
    if (isReleaseBinaryRelPath(rel)) continue;
    const abs = path.join(repoRoot, rel);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
    const buf = fs.readFileSync(abs);
    if (isProbablyBinaryBuffer(buf)) continue;

    const lines = buf.toString('utf8').replace(/\r\n?/g, '\n').split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const lineNo = i + 1;
      if (isAllowlisted(rel, line, lineNo)) continue;
      for (const re of STALE_PATTERNS) {
        if (re.test(line)) {
          hits.push({ file: rel, line: lineNo, text: line.trim() });
          break;
        }
      }
    }
  }

  return { ok: hits.length === 0, hits };
}

/** @param {{ file: string, line: number, text: string }[]} hits */
export function formatStaleInitRefHits(hits) {
  return hits.map(h => `${h.file}:${h.line}: ${h.text}`).join('\n');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { ok, hits } = checkStaleInitRefs();
  if (!ok) {
    console.error('[check-stale-init-refs] FAIL — stale framework-init references in release content:\n');
    console.error(formatStaleInitRefHits(hits));
    process.exit(1);
  }
  console.log('[check-stale-init-refs] PASS (release scope, allowlist applied)');
}
