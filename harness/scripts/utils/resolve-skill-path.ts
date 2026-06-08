// ============================================================================
// resolve-skill-path.ts — skills.index.yaml SSOT → id / source_rel / SKILL.md 路径
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import YAML from 'yaml';

export type SkillScope = 'project' | 'feature';

export interface SkillIndexEntry {
  id: string;
  scope: SkillScope;
  source_rel: string;
  order: number;
  description: string;
}

export interface SkillIndex {
  schema_version: string;
  skills: SkillIndexEntry[];
}

export interface ResolvedSkillPath {
  id: string;
  scope: SkillScope;
  /** Relative to framework/skills/, e.g. project/framework-init */
  sourceRel: string;
  /** Relative to framework root, e.g. skills/project/framework-init/SKILL.md */
  skillMdFrameworkRel: string;
  /** Relative to repo with framework/ prefix, e.g. framework/skills/project/framework-init/SKILL.md */
  skillMdRepoRel: string;
}

const INDEX_REL = path.posix.join('skills', 'skills.index.yaml');

let cachedIndex: SkillIndex | null = null;
let cachedFrameworkDir: string | null = null;

export function skillsIndexAbs(frameworkDir: string): string {
  return path.join(frameworkDir, 'skills', 'skills.index.yaml');
}

export function loadSkillsIndex(frameworkDir: string, force = false): SkillIndex {
  if (!force && cachedIndex && cachedFrameworkDir === frameworkDir) {
    return cachedIndex;
  }
  const abs = skillsIndexAbs(frameworkDir);
  if (!fs.existsSync(abs)) {
    throw new Error(`[resolve-skill-path] 缺少 ${INDEX_REL}`);
  }
  const parsed = YAML.parse(fs.readFileSync(abs, 'utf-8')) as SkillIndex;
  if (!parsed?.skills?.length) {
    throw new Error(`[resolve-skill-path] ${INDEX_REL} skills 为空`);
  }
  cachedIndex = parsed;
  cachedFrameworkDir = frameworkDir;
  return parsed;
}

export function clearSkillsIndexCache(): void {
  cachedIndex = null;
  cachedFrameworkDir = null;
}

export function listBuiltinSkillIds(frameworkDir: string): string[] {
  const index = loadSkillsIndex(frameworkDir);
  return [...index.skills].sort((a, b) => a.order - b.order).map(s => s.id);
}

export function resolveSkillPath(frameworkDir: string, skillId: string): ResolvedSkillPath {
  const index = loadSkillsIndex(frameworkDir);
  const entry = index.skills.find(s => s.id === skillId);
  if (!entry) {
    throw new Error(`[resolve-skill-path] 未知 skill id: ${skillId}`);
  }
  const sourceRel = entry.source_rel.replace(/\\/g, '/');
  const skillMdFrameworkRel = path.posix.join('skills', sourceRel, 'SKILL.md');
  return {
    id: entry.id,
    scope: entry.scope,
    sourceRel,
    skillMdFrameworkRel,
    skillMdRepoRel: `framework/${skillMdFrameworkRel}`,
  };
}

export function resolveSkillPathOrNull(frameworkDir: string, skillId: string): ResolvedSkillPath | null {
  try {
    return resolveSkillPath(frameworkDir, skillId);
  } catch {
    return null;
  }
}

export function skillMdAbs(frameworkDir: string, skillId: string): string {
  const r = resolveSkillPath(frameworkDir, skillId);
  return path.join(frameworkDir, r.skillMdFrameworkRel);
}

export function skillDirAbs(frameworkDir: string, skillId: string): string {
  const r = resolveSkillPath(frameworkDir, skillId);
  return path.join(frameworkDir, 'skills', r.sourceRel);
}

export function skillSourceRelPosix(skillId: string, index: SkillIndex): string {
  const entry = index.skills.find(s => s.id === skillId);
  if (!entry) {
    throw new Error(`[resolve-skill-path] 未知 skill id: ${skillId}`);
  }
  return entry.source_rel.replace(/\\/g, '/');
}
