// ============================================================================
// profile-skill-assets.ts — 根 SKILL 与 profile 托管模板/示例的动态解析与校验
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { loadFrameworkConfig } from '../../config';
import {
  frameworkAbs,
  frameworkLogicalRelPath,
  frameworkRelPath,
  inferRepoLayout,
  resolveFrameworkPrefixedPath,
  type RepoLayout,
} from '../../repo-layout';

function layoutOf(projectRoot: string, layout?: RepoLayout): RepoLayout {
  return layout ?? inferRepoLayout(projectRoot);
}

/** SKILL 正文中的占位引用：profile-skill-asset:<skill-id>/<asset_key> */
export const PROFILE_SKILL_ASSET_RE = /profile-skill-asset:([0-9a-z-]+)\/([a-z][a-z0-9_]*)/gi;

/** legacy skill-id / asset_key → canonical（≥2 minor 窗口，实例旧引用仍可解析） */
const SKILL_ID_ALIASES: Readonly<Record<string, string>> = {
  'prd-design': 'spec',
  'requirement-design': 'plan',
  '1-prd-design': 'spec',
  '1-spec': 'spec',
  '2-requirement-design': 'plan',
  '2-plan': 'plan',
};

const ASSET_KEY_ALIASES: Readonly<Record<string, string>> = {
  prd_template: 'spec_template',
  example_prd: 'example_spec',
  design_template: 'plan_template',
  example_design: 'example_plan',
  examples_prd_mapping: 'examples_spec_mapping',
};

export function normalizeSkillAssetRef(
  skillId: string,
  assetKey: string,
): { skillId: string; assetKey: string } {
  return {
    skillId: SKILL_ID_ALIASES[skillId] ?? skillId,
    assetKey: ASSET_KEY_ALIASES[assetKey] ?? assetKey,
  };
}

export interface SkillAssetsManifest {
  schema_version: string;
  profile: string;
  assets: Record<string, Record<string, string>>;
}

export interface LoadedManifest {
  ok: boolean;
  manifest?: SkillAssetsManifest;
  manifestRelPath: string;
  errors: string[];
}

export function skillAssetsManifestLogicalRel(profileName: string): string {
  return frameworkLogicalRelPath('profiles', profileName, 'skills', 'skill-assets.yaml');
}

export function skillAssetsManifestRel(projectRoot: string, profileName: string, layout?: RepoLayout): string {
  const L = layoutOf(projectRoot, layout);
  return frameworkRelPath(L, 'profiles', profileName, 'skills', 'skill-assets.yaml');
}

export function loadSkillAssetsManifest(
  projectRoot: string,
  profileName: string,
  layout?: RepoLayout,
): LoadedManifest {
  const L = layoutOf(projectRoot, layout);
  const manifestRelPath = skillAssetsManifestLogicalRel(profileName);
  const abs = frameworkAbs(L, 'profiles', profileName, 'skills', 'skill-assets.yaml');
  const errors: string[] = [];
  if (!fs.existsSync(abs)) {
    return {
      ok: false,
      manifestRelPath,
      errors: [`缺少 skill 资产清单：${manifestRelPath}`],
    };
  }
  let raw: string;
  try {
    raw = fs.readFileSync(abs, 'utf-8');
  } catch (e) {
    return {
      ok: false,
      manifestRelPath,
      errors: [`无法读取 ${manifestRelPath}: ${(e as Error).message}`],
    };
  }
  let parsed: unknown;
  try {
    parsed = YAML.parse(raw);
  } catch (e) {
    return {
      ok: false,
      manifestRelPath,
      errors: [`YAML 解析失败 ${manifestRelPath}: ${(e as Error).message}`],
    };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, manifestRelPath, errors: [`${manifestRelPath} 根对象非法`] };
  }
  const o = parsed as Record<string, unknown>;
  const assets = o.assets;
  if (!assets || typeof assets !== 'object' || Array.isArray(assets)) {
    errors.push(`${manifestRelPath} 缺少合法 assets 映射`);
  }
  const manifest: SkillAssetsManifest = {
    schema_version: typeof o.schema_version === 'string' ? o.schema_version : '',
    profile: typeof o.profile === 'string' ? o.profile : profileName,
    assets:
      assets && typeof assets === 'object' && !Array.isArray(assets)
        ? (assets as Record<string, Record<string, string>>)
        : {},
  };
  if (manifest.profile !== profileName) {
    errors.push(
      `${manifestRelPath} profile 字段=${manifest.profile} 与当前 project_profile.name=${profileName} 不一致`,
    );
  }
  if (errors.length > 0) {
    return { ok: false, manifest, manifestRelPath, errors };
  }
  return { ok: true, manifest, manifestRelPath, errors: [] };
}

/**
 * 解析清单中的单条路径：
 * - 以 `framework/` 开头 → 相对 projectRoot（consumer）或去前缀（standalone）
 * - 否则 → 相对 `profiles/<profile>/skills/<skillId>/`
 */
export function resolveManifestEntryPath(
  projectRoot: string,
  profileName: string,
  skillId: string,
  relOrFw: string,
  layout?: RepoLayout,
): string {
  const norm = relOrFw.replace(/\\/g, '/').trim();
  if (norm.startsWith('framework/')) {
    return resolveFrameworkPrefixedPath(projectRoot, norm, layoutOf(projectRoot, layout));
  }
  const L = layoutOf(projectRoot, layout);
  const base = frameworkAbs(L, 'profiles', profileName, 'skills', skillId);
  return path.join(base, norm);
}

export function resolveSkillAssetPath(
  projectRoot: string,
  profileName: string,
  manifest: SkillAssetsManifest,
  skillId: string,
  assetKey: string,
  layout?: RepoLayout,
  extensionSkillAssetAbsPaths?: Record<string, Record<string, string>>,
): { ok: boolean; relRepo?: string; absPath?: string; error?: string } {
  const normalized = normalizeSkillAssetRef(skillId, assetKey);
  skillId = normalized.skillId;
  assetKey = normalized.assetKey;
  const extAbs = extensionSkillAssetAbsPaths?.[skillId]?.[assetKey];
  if (extAbs) {
    const relRepo = path.relative(projectRoot, extAbs).replace(/\\/g, '/');
    return { ok: true, relRepo, absPath: extAbs };
  }
  const bucket = manifest.assets[skillId];
  if (!bucket) {
    return { ok: false, error: `manifest 未声明 skill「${skillId}」` };
  }
  const entry = bucket[assetKey];
  if (!entry || typeof entry !== 'string') {
    return {
      ok: false,
      error: `manifest 未声明资产「${skillId}/${assetKey}」`,
    };
  }
  const abs = resolveManifestEntryPath(projectRoot, profileName, skillId, entry, layout);
  const relRepo = path.relative(projectRoot, abs).replace(/\\/g, '/');
  return { ok: true, relRepo, absPath: abs };
}

export function extractProfileSkillAssetRefs(content: string): Array<{ skill: string; key: string }> {
  const out: Array<{ skill: string; key: string }> = [];
  const re = new RegExp(PROFILE_SKILL_ASSET_RE.source, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    out.push({ skill: m[1], key: m[2] });
  }
  return out;
}

/** Markdown 静态链接 `](path)`：仅用于根 framework/skills 下坏链扫描 */
const MD_LINK_TARGET_RE = /\]\(([^)]+)\)/g;

function isExternalOrSpecialTarget(target: string): boolean {
  const t = target.trim();
  if (!t || t.startsWith('#')) return true;
  if (/^[a-z][a-z0-9+.-]*:/i.test(t)) return true;
  return false;
}

/**
 * 扫描单文件内相对链接是否指向存在的路径；返回问题列表（人类可读）。
 */
export function scanMarkdownRelativeLinks(
  projectRoot: string,
  mdFileAbs: string,
  content: string,
  layout?: RepoLayout,
): string[] {
  const L = layoutOf(projectRoot, layout);
  const skillsRootNorm = path.normalize(frameworkAbs(L, 'skills'));
  const issues: string[] = [];
  const dir = path.dirname(mdFileAbs);
  let m: RegExpExecArray | null;
  const re = new RegExp(MD_LINK_TARGET_RE.source, 'g');
  while ((m = re.exec(content)) !== null) {
    const target = m[1].trim();
    if (isExternalOrSpecialTarget(target)) continue;
    if (target.startsWith('profile-skill-asset:')) continue;
    const decoded = target.split(/\s+/)[0];
    const pathOnly = decoded.split('#')[0].trim();
    if (!pathOnly) continue;
    const joined = path.normalize(path.join(dir, pathOnly));
    if (!joined.startsWith(skillsRootNorm)) {
      continue;
    }
    if (!fs.existsSync(joined)) {
      const relMd = path.relative(projectRoot, mdFileAbs).replace(/\\/g, '/');
      issues.push(`${relMd}：坏链接目标不存在 → ${pathOnly}`);
    }
  }
  return issues;
}

/**
 * 仅收集各阶段 SKILL.md 与 prompts/*.md。
 * 与 docs phase `profile_skill_assets_resolvable` 规则一致：不扫 templates/、reference/ 等示意骨架，避免误报。
 */
const SKILL_SCOPE_DIRS = new Set(['project', 'feature']);

function collectSkillMarkdownUnderDir(skillDir: string, out: string[]): void {
  const skillMd = path.join(skillDir, 'SKILL.md');
  if (fs.existsSync(skillMd)) {
    out.push(skillMd);
  }
  const promptsDir = path.join(skillDir, 'prompts');
  if (fs.existsSync(promptsDir)) {
    for (const p of fs.readdirSync(promptsDir)) {
      if (p.endsWith('.md')) {
        out.push(path.join(promptsDir, p));
      }
    }
  }
}

function walkSkillDocMarkdownFiles(skillsRoot: string, out: string[]): void {
  if (!fs.existsSync(skillsRoot)) return;
  for (const ent of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    if (ent.name === 'reference') continue;
    const top = path.join(skillsRoot, ent.name);
    if (SKILL_SCOPE_DIRS.has(ent.name)) {
      for (const sub of fs.readdirSync(top, { withFileTypes: true })) {
        if (!sub.isDirectory()) continue;
        collectSkillMarkdownUnderDir(path.join(top, sub.name), out);
      }
      continue;
    }
    collectSkillMarkdownUnderDir(top, out);
  }
}

export function scanAllRootSkillMarkdown(projectRoot: string, layout?: RepoLayout): string[] {
  const L = layoutOf(projectRoot, layout);
  const root = frameworkAbs(L, 'skills');
  const files: string[] = [];
  walkSkillDocMarkdownFiles(root, files);
  const issues: string[] = [];
  for (const abs of files) {
    let content: string;
    try {
      content = fs.readFileSync(abs, 'utf-8');
    } catch {
      continue;
    }
    issues.push(...scanMarkdownRelativeLinks(projectRoot, abs, content, L));
  }
  return issues;
}

/**
 * 根 SKILL 树不应写死 **hmos-app** 物理路径；应使用 `profile-skill-asset:` 或 `<project_profile.name>`。
 * （`generic` 等名在少数「回落链」解释中可出现，不在这里一刀切拦截。）
 */
export function scanRootSkillsHardcodedProfilePaths(projectRoot: string, layout?: RepoLayout): string[] {
  const L = layoutOf(projectRoot, layout);
  const root = frameworkAbs(L, 'skills');
  const files: string[] = [];
  walkSkillDocMarkdownFiles(root, files);
  const issues: string[] = [];
  const hmosRe = /(?:framework\/)?profiles\/hmos-app\//;
  for (const abs of files) {
    if (path.basename(abs).toLowerCase() === 'readme.md') continue;
    let content: string;
    try {
      content = fs.readFileSync(abs, 'utf-8');
    } catch {
      continue;
    }
    if (!hmosRe.test(content)) continue;
    const rel = path.relative(projectRoot, abs).replace(/\\/g, '/');
    issues.push(
      `${rel}：含硬编码路径 *profiles/hmos-app/*，请改为 \`profile-skill-asset:...\` 或 \`<project_profile.name>\` 占位说明`,
    );
  }
  return issues;
}

// ============================================================================
// G1 — README anchor 链接完整性
// SKILL.md / prompts 内 `](....README.md#anchor)` 链接：目标 README 必须存在，
// 且 anchor 对应 heading 必须存在。直接拦住"协议链接指错 README / 锚点缺失"这一类
// （历史 bug：多处把 Profile skill asset protocol 链接写成指向无该小节的根 README）。
// ============================================================================

/** GitHub 风格 heading → slug（仅用于 ascii 锚点比对；CJK 锚点不在链接正则捕获范围内）。 */
export function slugifyHeading(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\w一-龥 -]/g, '')
    .replace(/\s+/g, '-');
}

/** 提取 markdown 文件内所有 ATX heading 的 slug 集合。 */
export function extractMarkdownAnchors(content: string): Set<string> {
  const set = new Set<string>();
  const re = /^#{1,6}\s+(.+?)\s*#*\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    set.add(slugifyHeading(m[1]));
  }
  return set;
}

export function scanReadmeAnchorLinks(projectRoot: string, mdFileAbs: string, content: string): string[] {
  const issues: string[] = [];
  const dir = path.dirname(mdFileAbs);
  const relMd = path.relative(projectRoot, mdFileAbs).replace(/\\/g, '/');
  const re = /\]\(([^)\s]+?README\.md)#([a-z0-9-]+)\)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const rel = m[1].trim();
    const anchor = m[2].trim().toLowerCase();
    const target = path.normalize(path.join(dir, rel));
    if (!fs.existsSync(target)) {
      issues.push(`${relMd}：协议/锚点链接目标 README 不存在 → ${rel}（#${anchor}）；正确目标通常是 skills/README.md`);
      continue;
    }
    const anchors = extractMarkdownAnchors(fs.readFileSync(target, 'utf-8'));
    if (!anchors.has(anchor)) {
      issues.push(`${relMd}：链接锚点不存在 → ${rel}#${anchor}（目标文件无对应标题）`);
    }
  }
  return issues;
}

// ============================================================================
// G2 — profile-addendum 纳入门禁
// addendum 不再是"浮动散文"：其 `profile-skill-asset:` 引用须可解析，
// 残留的字面 framework/skills|profiles 路径须落盘（拦住历史 bug：表头误标基准
// 目录导致 spec_template 等路径漂移到不存在的 framework/skills/feature/.../templates/）。
// ============================================================================

const ADDENDUM_LITERAL_PATH_RE = /framework\/(?:skills|profiles)\/[A-Za-z0-9._/-]+/g;

function collectProfileAddendums(
  projectRoot: string,
  layout: RepoLayout,
): Array<{ profile: string; abs: string }> {
  const out: Array<{ profile: string; abs: string }> = [];
  const profilesRoot = frameworkAbs(layout, 'profiles');
  if (!fs.existsSync(profilesRoot)) return out;
  for (const prof of fs.readdirSync(profilesRoot, { withFileTypes: true })) {
    if (!prof.isDirectory()) continue;
    const skillsDir = path.join(profilesRoot, prof.name, 'skills');
    if (!fs.existsSync(skillsDir)) continue;
    for (const skill of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (!skill.isDirectory()) continue;
      const add = path.join(skillsDir, skill.name, 'profile-addendum.md');
      if (fs.existsSync(add)) out.push({ profile: prof.name, abs: add });
    }
  }
  return out;
}

export function scanAddendumAssetRefs(
  projectRoot: string,
  profileName: string,
  manifest: SkillAssetsManifest,
  addendumAbs: string,
  layout?: RepoLayout,
  extensionSkillAssetAbsPaths?: Record<string, Record<string, string>>,
): string[] {
  const L = layoutOf(projectRoot, layout);
  const issues: string[] = [];
  const relMd = path.relative(projectRoot, addendumAbs).replace(/\\/g, '/');
  let content: string;
  try {
    content = fs.readFileSync(addendumAbs, 'utf-8');
  } catch {
    return issues;
  }
  for (const { skill, key } of extractProfileSkillAssetRefs(content)) {
    const r = resolveSkillAssetPath(projectRoot, profileName, manifest, skill, key, L, extensionSkillAssetAbsPaths);
    if (!r.ok || !r.absPath) {
      issues.push(`${relMd}：profile-skill-asset:${skill}/${key} 无法解析（${r.error ?? 'unknown'}）`);
    } else if (!fs.existsSync(r.absPath)) {
      issues.push(`${relMd}：profile-skill-asset:${skill}/${key} → ${r.relRepo} 不存在`);
    }
  }
  const seen = new Set<string>();
  const re = new RegExp(ADDENDUM_LITERAL_PATH_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const token = m[0].replace(/[.,;:]+$/, '');
    if (seen.has(token)) continue;
    seen.add(token);
    const abs = resolveFrameworkPrefixedPath(projectRoot, token, L);
    if (!fs.existsSync(abs)) {
      issues.push(`${relMd}：字面 framework 资产路径不存在 → ${token}（应改用 \`profile-skill-asset:\` 占位符或修正路径）`);
    }
  }
  // (c) bare 根 skill 树路径 `skills/feature|project/...`（**词首**出现、前面不是 `/` 或 `framework/`，
  //     从而放过 `../../skills/...` 相对链接与 `framework/skills/...` 逻辑路径）——
  //     这正是历史 bug 的"相对 `skills/feature/spec/`"误导基准表头 / 裸串形态。既然 WS2 后
  //     addendum 不应再出现此形态，任何复现都拦成 FAIL（即便它恰好指向真实目录也不放过）。
  const bareSeen = new Set<string>();
  const bareRe = /(^|[^/\w])(skills\/(?:feature|project)\/[A-Za-z0-9._/-]*)/g;
  while ((m = bareRe.exec(content)) !== null) {
    const token = m[2].replace(/[`、，。）).,;:]+$/, '');
    if (bareSeen.has(token)) continue;
    bareSeen.add(token);
    issues.push(
      `${relMd}：出现不带 \`framework/\` 前缀的根 skill 树裸路径 \`${token}\`（疑似"相对 skills/feature|project/<x>/"误导基准形态）；根 skill 树资产用 \`framework/skills/...\` 逻辑路径，profile 资产用 \`profile-skill-asset:\` 占位符`,
    );
  }
  return issues;
}

// ============================================================================
// G3 — 命令式产物不得硬编码他 profile 路径
// prompts/、templates/ 是 agent"照做"的产物，须用 `profile-skill-asset:` 占位符，
// 不得写死他 profile（Q≠P）的物理路径（历史 bug：generic 的 prompt 命令式硬编码
// framework/profiles/hmos-app/...，使 generic 上下文跑去读 hmos-app 文件）。
// profile-addendum.md 为解释性散文（合法说明"切到他 profile 再读其资产"），故豁免。
// ============================================================================

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function listProfileNames(projectRoot: string, layout: RepoLayout): string[] {
  const profilesRoot = frameworkAbs(layout, 'profiles');
  if (!fs.existsSync(profilesRoot)) return [];
  return fs
    .readdirSync(profilesRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

const IMPERATIVE_EXTS = new Set(['.md', '.yaml', '.yml', '.json', '.txt']);

function walkImperativeFiles(dir: string, out: string[]): void {
  if (!fs.existsSync(dir)) return;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      walkImperativeFiles(p, out);
    } else if (IMPERATIVE_EXTS.has(path.extname(ent.name).toLowerCase())) {
      out.push(p);
    }
  }
}

export function scanCrossProfileHardcodedPaths(projectRoot: string, layout?: RepoLayout): string[] {
  const L = layoutOf(projectRoot, layout);
  const profiles = listProfileNames(projectRoot, L);
  const issues: string[] = [];
  for (const P of profiles) {
    const others = profiles.filter((q) => q !== P);
    if (others.length === 0) continue;
    const skillsDir = frameworkAbs(L, 'profiles', P, 'skills');
    if (!fs.existsSync(skillsDir)) continue;
    const files: string[] = [];
    for (const skill of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (!skill.isDirectory()) continue;
      walkImperativeFiles(path.join(skillsDir, skill.name, 'prompts'), files);
      walkImperativeFiles(path.join(skillsDir, skill.name, 'templates'), files);
    }
    const otherAlt = others.map(escapeRegExp).join('|');
    for (const abs of files) {
      let content: string;
      try {
        content = fs.readFileSync(abs, 'utf-8');
      } catch {
        continue;
      }
      const re = new RegExp(`(?:framework/)?profiles/(${otherAlt})/`, 'g');
      const hits = new Set<string>();
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) hits.add(m[1]);
      if (hits.size > 0) {
        const rel = path.relative(projectRoot, abs).replace(/\\/g, '/');
        issues.push(
          `${rel}：profile「${P}」的命令式产物硬编码了他 profile 路径 profiles/${[...hits].join(',')}/...；应改用 \`profile-skill-asset:\` 占位符（addendum 解释性引用才豁免）`,
        );
      }
    }
  }
  return issues;
}

/**
 * P 自己的命令式产物（prompts/、templates/）中对**本 profile** 资产目录
 * （skills/<skill>/{templates,examples,reference}/）的物理路径硬编码——路径虽对，
 * 但绕过 `profile-skill-asset:` 占位符，清单移动时不受机制约束。统一收口到占位符。
 * （addendum 为解释性散文，豁免；非资产目录如 harness/、vendor/、profile.yaml 不在扫描面。）
 */
export function scanSameProfileAssetHardcodes(projectRoot: string, layout?: RepoLayout): string[] {
  const L = layoutOf(projectRoot, layout);
  const issues: string[] = [];
  for (const P of listProfileNames(projectRoot, L)) {
    const skillsDir = frameworkAbs(L, 'profiles', P, 'skills');
    if (!fs.existsSync(skillsDir)) continue;
    const files: string[] = [];
    for (const skill of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (!skill.isDirectory()) continue;
      walkImperativeFiles(path.join(skillsDir, skill.name, 'prompts'), files);
      walkImperativeFiles(path.join(skillsDir, skill.name, 'templates'), files);
    }
    const reSrc = `(?:framework/)?profiles/${escapeRegExp(P)}/skills/[A-Za-z0-9._-]+/(?:templates|examples|reference)/[A-Za-z0-9._/-]+`;
    for (const abs of files) {
      let content: string;
      try {
        content = fs.readFileSync(abs, 'utf-8');
      } catch {
        continue;
      }
      const hits = new Set<string>();
      const re = new RegExp(reSrc, 'g');
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) hits.add(m[0]);
      if (hits.size > 0) {
        const rel = path.relative(projectRoot, abs).replace(/\\/g, '/');
        issues.push(
          `${rel}：命令式产物硬编码了本 profile 资产物理路径（${[...hits][0]}${hits.size > 1 ? ` 等 ${hits.size} 处` : ''}）；应改用 \`profile-skill-asset:<skill>/<键>\` 占位符以收口到机器清单`,
        );
      }
    }
  }
  return issues;
}

export interface ProfileSkillAssetsValidation {
  ok: boolean;
  errors: string[];
}

/**
 * 使用当前实例 framework.config.json 的 project_profile.name 做完整校验。
 */
export function validateProfileSkillAssetsForProject(
  projectRoot: string,
  layout?: RepoLayout,
  extensionSkillAssetAbsPaths?: Record<string, Record<string, string>>,
): ProfileSkillAssetsValidation {
  const errors: string[] = [];
  const L = layoutOf(projectRoot, layout);
  const cfg = loadFrameworkConfig(projectRoot);
  const profileName = cfg.project_profile.name;
  const loaded = loadSkillAssetsManifest(projectRoot, profileName, L);
  if (!loaded.ok || !loaded.manifest) {
    errors.push(...loaded.errors);
    return { ok: false, errors };
  }
  const manifest = loaded.manifest;
  const skillsRoot = frameworkAbs(L, 'skills');
  const mdFiles: string[] = [];
  walkSkillDocMarkdownFiles(skillsRoot, mdFiles);

  const seenRefs = new Map<string, Set<string>>();
  for (const abs of mdFiles) {
    const content = fs.readFileSync(abs, 'utf-8');
    for (const { skill, key } of extractProfileSkillAssetRefs(content)) {
      let ks = seenRefs.get(skill);
      if (!ks) {
        ks = new Set();
        seenRefs.set(skill, ks);
      }
      ks.add(key);
    }
  }

  for (const [skillId, keys] of seenRefs) {
    for (const assetKey of keys) {
      const r = resolveSkillAssetPath(
        projectRoot,
        profileName,
        manifest,
        skillId,
        assetKey,
        L,
        extensionSkillAssetAbsPaths,
      );
      if (!r.ok || !r.absPath) {
        errors.push(
          `profile-skill-asset:${skillId}/${assetKey} 无法解析：${r.error ?? 'unknown'}`,
        );
        continue;
      }
      if (!fs.existsSync(r.absPath)) {
        errors.push(
          `profile-skill-asset:${skillId}/${assetKey} → ${r.relRepo} 文件或目录不存在`,
        );
      }
    }
  }

  for (const skillId of Object.keys(manifest.assets)) {
    const bucket = manifest.assets[skillId];
    for (const assetKey of Object.keys(bucket)) {
      const relOrAbs = bucket[assetKey];
      const abs = resolveManifestEntryPath(projectRoot, profileName, skillId, relOrAbs, L);
      if (!fs.existsSync(abs)) {
        errors.push(
          `skill-assets.yaml 声明缺失：${skillId}/${assetKey} → ${path.relative(projectRoot, abs).replace(/\\/g, '/')}`,
        );
      }
    }
  }

  errors.push(...scanAllRootSkillMarkdown(projectRoot, L));
  errors.push(...scanRootSkillsHardcodedProfilePaths(projectRoot, L));

  // G1: README anchor 链接完整性（复用已收集的根 SKILL/prompts md 集合）
  for (const abs of mdFiles) {
    errors.push(...scanReadmeAnchorLinks(projectRoot, abs, fs.readFileSync(abs, 'utf-8')));
  }

  // G2: profile-addendum 纳入门禁（按各自 profile 的清单解析）
  const manifestCache = new Map<string, SkillAssetsManifest | null>();
  manifestCache.set(profileName, manifest);
  for (const { profile: addProfile, abs } of collectProfileAddendums(projectRoot, L)) {
    if (!manifestCache.has(addProfile)) {
      const loadedAdd = loadSkillAssetsManifest(projectRoot, addProfile, L);
      manifestCache.set(addProfile, loadedAdd.ok ? loadedAdd.manifest ?? null : null);
    }
    const addManifest = manifestCache.get(addProfile);
    if (!addManifest) continue;
    errors.push(
      ...scanAddendumAssetRefs(projectRoot, addProfile, addManifest, abs, L, extensionSkillAssetAbsPaths),
    );
  }

  // G3: 命令式产物（prompts/templates）不得硬编码他 profile 路径，
  //     亦不得硬编码本 profile 资产物理路径（应统一走 profile-skill-asset 占位符）。
  errors.push(...scanCrossProfileHardcodedPaths(projectRoot, L));
  errors.push(...scanSameProfileAssetHardcodes(projectRoot, L));

  return { ok: errors.length === 0, errors };
}
