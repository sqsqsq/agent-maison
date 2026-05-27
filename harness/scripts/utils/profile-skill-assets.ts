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
): { ok: boolean; relRepo?: string; absPath?: string; error?: string } {
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
function walkSkillDocMarkdownFiles(skillsRoot: string, out: string[]): void {
  if (!fs.existsSync(skillsRoot)) return;
  for (const ent of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const skillDir = path.join(skillsRoot, ent.name);
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
      const r = resolveSkillAssetPath(projectRoot, profileName, manifest, skillId, assetKey, L);
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

  return { ok: errors.length === 0, errors };
}
