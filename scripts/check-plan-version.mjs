#!/usr/bin/env node
// check-plan-version.mjs — plan 版本标签校验（default / --release）
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import {
  compareSemver,
  findOpenChecklistItems,
  hasOpenTodos,
  isLegacyAllowlistEligible,
  isValidSemver,
  loadAllPlans,
  loadLegacyAllowlist,
  loadPreFrontmatterAllowlist,
  readCurrentVersion,
} from './plan-version-lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const RELATION_VALUES = new Set([
  'knowledge-provider',
  'app-asset-provider',
  'verification-provider',
  'execution-trust-foundation',
  'core',
]);
const LAYER_VALUES = new Set([
  'knowledge',
  'capability-handoff',
  'component-blueprint',
  'change-unit',
  'closure',
  'governance',
]);
const GOAL_ID_RE = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

/**
 * @typedef {{ file: string, reason: string }} Hit
 */

/**
 * @param {{ mode?: 'default' | 'release', repoRoot?: string }} [opts]
 * @returns {{ ok: boolean, hits: Hit[], current: string }}
 */
export function checkPlanVersions(opts = {}) {
  const repoRoot = opts.repoRoot ?? REPO_ROOT;
  const mode = opts.mode ?? 'default';
  const current = readCurrentVersion(repoRoot);
  const allowlist = loadLegacyAllowlist(repoRoot);
  const preFrontmatterAllowlist = loadPreFrontmatterAllowlist(repoRoot);
  const plans = loadAllPlans(repoRoot);
  /** @type {Hit[]} */
  const hits = [];

  for (const { basename, rel, parsed } of plans) {
    const inAllowlist = allowlist.has(basename);
    const { version, deferred_to, todos, rawFrontmatter, body } = parsed;
    const open = hasOpenTodos(todos);

    if (!rawFrontmatter?.trim()) {
      if (preFrontmatterAllowlist.has(basename)) continue;
      hits.push({
        file: rel,
        reason:
          'plan 无 YAML frontmatter；须补 frontmatter+version 或列入 scripts/plan-version-pre-frontmatter-allowlist.json',
      });
      continue;
    }

    hits.push(...checkParentGoalDeclarations({ repoRoot, rel, parsed }));

    if (inAllowlist) {
      if (isLegacyAllowlistEligible(parsed)) continue;
      hits.push({
        file: rel,
        reason:
          'allowlist 项不再符合豁免条件（须 terminal + 无 version + 无 deferred_to）；重跑 gen-plan-version-allowlist 或改走正常校验',
      });
    }

    if (!version || !isValidSemver(version)) {
      hits.push({
        file: rel,
        reason: open
          ? '在研 plan 缺少合法 frontmatter version'
          : '非 allowlist plan 缺少合法 frontmatter version',
      });
      continue;
    }

    const cmp = compareSemver(version, current);

    // plan a3e7d1c9：frontmatter todos 是唯一机器待办 SSOT。既有 version/deferred_to 合法性
    // 校验通过后，对**所有 version >= 当前窗口**的 plan 检查正文——合法 deferred_to **不构成
    // 豁免**（否则新 plan 可以靠顺延绕开登记）。已有 frontmatter todos 也不豁免（双账本漂移面）。
    // 本条在**默认模式**即生效：是登记面缺陷，不该拖到发布时才暴露。
    if (cmp >= 0) {
      const openBoxes = findOpenChecklistItems(body);
      if (openBoxes.length > 0) {
        const sample = openBoxes
          .slice(0, 3)
          .map((b) => `正文第 ${b.line} 行「${b.text}」`)
          .join('；');
        hits.push({
          file: rel,
          reason:
            `正文含 ${openBoxes.length} 处未勾 \`- [ ]\`（${sample}${openBoxes.length > 3 ? ' …' : ''}）——` +
            '待办须登记到 frontmatter todos（唯一机器 SSOT）；正文 checklist 门禁不可见，会形成假绿。' +
            '历史 `- [x]` 可保留但不作机器状态；重新打开任务须先在 frontmatter 登记',
        });
      }
    }

    if (cmp > 0) {
      if (!deferred_to || deferred_to !== version) {
        hits.push({
          file: rel,
          reason: `version > 当前 (${version} > ${current}) 须 deferred_to === version`,
        });
      }
      continue;
    }

    if (cmp < 0 && open) {
      hits.push({
        file: rel,
        reason: `version < 当前 (${version}) 仍有未完成 todo，须 completed/cancelled`,
      });
      continue;
    }

    if (mode === 'release' && cmp === 0 && open) {
      hits.push({
        file: rel,
        reason: `发布门禁：version === 当前 (${current}) 的 plan 仍有未完成 todo`,
      });
    }
  }

  return { ok: hits.length === 0, hits, current };
}

/**
 * @param {string} content
 * @returns {string | undefined}
 */
function readGoalId(content) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!match) return undefined;
  const id = /^id:[ \t]*(.+)$/m.exec(match[1]);
  if (!id) return undefined;
  return id[1].trim().replace(/^(["'])(.*)\1$/, '$2');
}

/**
 * @param {string} content
 * @returns {{ ids: Set<string>, error?: string }}
 */
function readGoalTargetIds(content) {
  const lines = content.split(/\r?\n/);
  const section = lines.findIndex((line) => /^#{1,6}\s+0\.1(?:\s|$)/.test(line));
  if (section < 0) return { ids: new Set(), error: '未找到 §0.1 目标表' };

  const ids = new Set();
  for (let i = section + 1; i < lines.length; i += 1) {
    if (/^#{1,6}\s+/.test(lines[i])) break;
    const match = /^\s*\|\s*`([^`]+)`\s*\|/.exec(lines[i]);
    if (match) ids.add(match[1]);
  }
  if (ids.size === 0) return { ids, error: '§0.1 目标表首列未提取到任何反引号目标 id' };
  return { ids };
}

/**
 * @param {string} repoRoot
 * @param {string} parentGoal
 * @returns {{ abs: string, content: string }[]}
 */
function findGoalMatches(repoRoot, parentGoal) {
  const goalsDir = path.join(repoRoot, '.cursor', 'goals');
  if (!fs.existsSync(goalsDir)) return [];
  return fs
    .readdirSync(goalsDir)
    .filter((name) => name.endsWith('.goal.md'))
    .sort()
    .map((name) => path.join(goalsDir, name))
    .map((abs) => ({ abs, content: fs.readFileSync(abs, 'utf8') }))
    .filter(({ content }) => readGoalId(content) === parentGoal);
}

/**
 * @param {{ repoRoot: string, rel: string, parsed: ReturnType<import('./plan-version-lib.mjs').parsePlanFile> }} opts
 * @returns {Hit[]}
 */
export function checkParentGoalDeclarations({ repoRoot, rel, parsed }) {
  if (!parsed.parentGoalDeclared) return [];
  /** @type {Hit[]} */
  const hits = [];
  const missing = (field) => {
    hits.push({ file: rel, reason: `${field}: 缺失（父目标声明的必填字段）` });
  };

  if (!parsed.parent_goal?.trim()) {
    hits.push({ file: rel, reason: 'parent_goal: 缺失或为空（须唯一匹配 .cursor/goals/*.goal.md 的 frontmatter id）' });
  }
  if (!parsed.advances) {
    missing('advances');
  } else if (!Array.isArray(parsed.advances) || parsed.advances.length === 0) {
    hits.push({ file: rel, reason: 'advances: 必须为非空 block-list' });
  }
  if (!parsed.relation) {
    missing('relation');
  } else if (!RELATION_VALUES.has(parsed.relation)) {
    hits.push({
      file: rel,
      reason: `relation: 非法值「${parsed.relation}」（允许：${[...RELATION_VALUES].join(', ')}）`,
    });
  }
  if (!parsed.layer) {
    missing('layer');
  } else if (!LAYER_VALUES.has(parsed.layer)) {
    hits.push({
      file: rel,
      reason: `layer: 非法值「${parsed.layer}」（允许：${[...LAYER_VALUES].join(', ')}）`,
    });
  }
  for (const field of ['goal_requires', 'goal_provides']) {
    const value = parsed[field];
    if (!value) {
      missing(field);
      continue;
    }
    if (!Array.isArray(value)) {
      hits.push({ file: rel, reason: `${field}: 必须为行内 [] 或非空 block-list` });
      continue;
    }
    for (const item of value) {
      if (!GOAL_ID_RE.test(item)) {
        hits.push({ file: rel, reason: `${field}: 非法条目「${item}」（须匹配 ${GOAL_ID_RE}）` });
      }
    }
  }
  if (!parsed.real_host_validation?.trim()) {
    hits.push({ file: rel, reason: 'real_host_validation: 缺失或为空（折叠/字面块的缩进正文必须非空）' });
  }
  if (parsed.parallel_authority_added === undefined || parsed.parallel_authority_added === '') {
    missing('parallel_authority_added');
  } else if (parsed.parallel_authority_added !== 'false') {
    hits.push({
      file: rel,
      reason: 'parallel_authority_added: 必须为 false；如需放开，须先修订总纲并更新本 capability spec',
    });
  }

  if (!parsed.parent_goal?.trim()) return hits;
  const matches = findGoalMatches(repoRoot, parsed.parent_goal.trim());
  if (matches.length === 0) {
    hits.push({
      file: rel,
      reason: `parent_goal: id「${parsed.parent_goal.trim()}」未唯一匹配 .cursor/goals/*.goal.md（匹配 0 份）`,
    });
    return hits;
  }
  if (matches.length > 1) {
    hits.push({
      file: rel,
      reason: `parent_goal: id「${parsed.parent_goal.trim()}」匹配多个 goal 文件（匹配 ${matches.length} 份）`,
    });
    return hits;
  }

  const targetIds = readGoalTargetIds(matches[0].content);
  if (targetIds.error) {
    hits.push({ file: rel, reason: `advances: ${targetIds.error}（goal 文件 §0.1，fail-closed）` });
  } else if (Array.isArray(parsed.advances)) {
    for (const item of parsed.advances) {
      if (!targetIds.ids.has(item)) {
        hits.push({
          file: rel,
          reason: `advances: 非法目标 id「${item}」；合法集合来自 goal 文件 §0.1 表格首列`,
        });
      }
    }
  }
  return hits;
}

/**
 * @param {Hit[]} hits
 */
export function formatPlanVersionHits(hits) {
  return hits.map((h) => `  ${h.file}: ${h.reason}`).join('\n');
}

function parseArgs(argv) {
  const release = argv.includes('--release');
  return { mode: release ? 'release' : 'default' };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { mode } = parseArgs(process.argv.slice(2));
  const result = checkPlanVersions({ mode });
  console.log(`[check-plan-version] mode=${mode} current=${result.current}`);
  if (!result.ok) {
    console.error('[check-plan-version] FAIL:\n' + formatPlanVersionHits(result.hits));
    process.exit(1);
  }
  console.log('[check-plan-version] PASS');
}
