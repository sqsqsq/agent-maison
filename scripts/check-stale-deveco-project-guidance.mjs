#!/usr/bin/env node
// check-stale-deveco-project-guidance.mjs — 发布内容禁止「把 personal DevEco 写入 project config」的执行指引
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

/** 整文件 allowlist（迁移/历史叙事） */
const FILE_PREFIX_ALLOWLIST = ['MIGRATION.md', 'openspec/changes/archive/'];

/** @param {string} rel POSIX */
function isFileAllowlisted(rel) {
  return FILE_PREFIX_ALLOWLIST.some((prefix) => rel === prefix || rel.startsWith(prefix));
}

/** 行级否定/迁移语境 — 命中则不算 stale 执行指引 */
const NEGATION_RE =
  /勿写入|不再写入|禁止写入|不得写入|不在项目 init 写|不再写入|移出|外迁|legacy|已废弃|deprecated|错位|misconfigured|含 personal|删除 project|仅 migrate|不要写入|改由.*framework\.local|写入 gitignored/i;

/** personal 路径写入 project config 的错误执行指引 */
const STALE_PATTERNS = [
  {
    id: 'project_deveco_personal_path',
    re: /framework\.config\.json[^`\n]*toolchain\.devEcoStudio\.(installPath|hvigorBin)/i,
  },
  {
    id: 'project_deveco_personal_arrow',
    re: /framework\.config\.json\s*(?:→|->|>\s*)[^\n]*toolchain\.devEcoStudio/i,
  },
  {
    id: 'project_deveco_tuning',
    re: /framework\.config\.json[^`\n]*toolchain\.devEcoStudio\.(aaTestTimeoutMs|killHdcServerOnFinish|testRunner)/i,
  },
  {
    id: 'write_project_deveco',
    re: /(?:写入|写进|写到)[^`\n]{0,80}framework\.config\.json[^`\n]*devEcoStudio/i,
  },
];

/**
 * @param {string} rel
 * @param {string} line
 * @param {number} lineNo 1-based
 */
function isLineAllowlisted(rel, line, lineNo) {
  if (isFileAllowlisted(rel)) return true;
  if (NEGATION_RE.test(line)) return true;
  if (/RELEASE-NOTES-v\d+\.md$/.test(rel)) return true;
  return false;
}

/**
 * @param {string} [repoRoot]
 * @returns {{ ok: boolean, hits: { file: string, line: number, id: string, text: string }[] }}
 */
export function checkStaleDevecoProjectGuidance(repoRoot = REPO_ROOT) {
  const rules = loadReleaseExcludes();
  const { included } = collectReleaseFiles(repoRoot, rules);
  /** @type {{ file: string, line: number, id: string, text: string }[]} */
  const hits = [];

  for (const rel of included) {
    if (isFileAllowlisted(rel)) continue;
    if (isReleaseBinaryRelPath(rel)) continue;
    const abs = path.join(repoRoot, rel);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
    const buf = fs.readFileSync(abs);
    if (isProbablyBinaryBuffer(buf)) continue;

    const lines = buf.toString('utf8').replace(/\r\n?/g, '\n').split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const lineNo = i + 1;
      if (isLineAllowlisted(rel, line, lineNo)) continue;
      for (const pat of STALE_PATTERNS) {
        if (pat.re.test(line)) {
          hits.push({ file: rel, line: lineNo, id: pat.id, text: line.trim() });
          break;
        }
      }
    }
  }

  return { ok: hits.length === 0, hits };
}

/** @param {{ file: string, line: number, id: string, text: string }[]} hits */
export function formatStaleDevecoProjectGuidanceHits(hits) {
  return hits.map((h) => `${h.file}:${h.line} [${h.id}]: ${h.text}`).join('\n');
}

/** @returns {string[]} */
export function runSyntheticDevecoGuidanceTests() {
  /** @type {string[]} */
  const errors = [];

  const bad = '在 framework.config.json > toolchain.devEcoStudio.installPath 配置 IDE 安装根目录后重跑 harness。';
  if (NEGATION_RE.test(bad)) {
    errors.push('synthetic: bad line must not match NEGATION_RE');
  }
  let matchedBad = false;
  for (const pat of STALE_PATTERNS) {
    if (pat.re.test(bad)) matchedBad = true;
  }
  if (!matchedBad) {
    errors.push('synthetic: bad line must match at least one STALE pattern');
  }

  const goodMigration =
    '| project config 写 `toolchain.devEcoStudio.installPath` | 外迁到 **local** |';
  if (!NEGATION_RE.test(goodMigration)) {
    errors.push('synthetic: migration row must match NEGATION_RE');
  }
  for (const pat of STALE_PATTERNS) {
    if (pat.re.test(goodMigration) && !NEGATION_RE.test(goodMigration)) {
      errors.push(`synthetic: migration row must not match ${pat.id} without negation`);
    }
  }

  const goodLocal =
    '按 framework.local.json > toolchain.devEcoStudio.installPath 配置 DevEco Studio 路径后重跑。';
  for (const pat of STALE_PATTERNS) {
    if (pat.re.test(goodLocal)) {
      errors.push(`synthetic: local guidance must not match ${pat.id}`);
    }
  }

  return errors;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const synth = runSyntheticDevecoGuidanceTests();
  if (synth.length > 0) {
    console.error('[check-stale-deveco-project-guidance] synthetic FAIL:\n' + synth.join('\n'));
    process.exit(1);
  }
  const { ok, hits } = checkStaleDevecoProjectGuidance();
  if (!ok) {
    console.error(
      '[check-stale-deveco-project-guidance] FAIL — stale project-config DevEco guidance in release content:\n',
    );
    console.error(formatStaleDevecoProjectGuidanceHits(hits));
    process.exit(1);
  }
  console.log('[check-stale-deveco-project-guidance] PASS (release scope, allowlist applied)');
}
