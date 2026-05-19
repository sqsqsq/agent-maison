// ============================================================================
// materialize-agent-bundle-skills — generic inline / bridge skill 物化
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import {
  BUILTIN_SKILL_BRIDGE_DESCRIPTIONS,
  type AgentBundleSkillMode,
  type ResolvedAgentBundlePaths,
} from './agent-bundle-paths';

export { BUILTIN_SKILL_BRIDGE_DESCRIPTIONS };

export function listFrameworkBuiltinSkillDirs(frameworkDir: string): string[] {
  const skillsRoot = path.join(frameworkDir, 'skills');
  if (!fs.existsSync(skillsRoot)) {
    return [];
  }
  const dirs: string[] = [];
  for (const ent of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!ent.isDirectory()) {
      continue;
    }
    const skillMd = path.join(skillsRoot, ent.name, 'SKILL.md');
    if (fs.existsSync(skillMd) && fs.statSync(skillMd).isFile()) {
      dirs.push(ent.name);
    }
  }
  return dirs.sort();
}

export function skillDescriptionForDir(skillDir: string): string {
  return (
    BUILTIN_SKILL_BRIDGE_DESCRIPTIONS[skillDir] ??
    `Framework Skill（完整流程见 framework/skills/${skillDir}/SKILL.md）`
  );
}

/** 从实例根下 stub 文件相对路径计算到正文 SKILL 的 `../` 前缀 */
export function posixRelativeFromSkillStubTo(
  stubTargetRelPosix: string,
  skillMdRepoRelPosix: string,
): string {
  const parts = stubTargetRelPosix.replace(/\\/g, '/').split('/').filter(Boolean);
  const depth = Math.max(parts.length - 1, 1);
  return `${'../'.repeat(depth)}${skillMdRepoRelPosix}`;
}

export function renderBridgeSkillStubMarkdown(
  skillDir: string,
  stubTargetRelPosix: string,
  skillMdRepoRelPosix: string,
): string {
  const relFromStub = posixRelativeFromSkillStubTo(stubTargetRelPosix, skillMdRepoRelPosix);
  const description = skillDescriptionForDir(skillDir);
  return [
    '---',
    `name: ${skillDir}`,
    `description: ${description}`,
    '---',
    '',
    '# 跳板文件',
    '',
    `完整 Skill 定义请阅读：**[${skillMdRepoRelPosix}](${relFromStub})**`,
    '',
  ].join('\n');
}

export function materializeInlineSkillMarkdown(
  frameworkDir: string,
  skillDir: string,
): string {
  const src = path.join(frameworkDir, 'skills', skillDir, 'SKILL.md');
  if (!fs.existsSync(src)) {
    throw new Error(`[materialize-agent-bundle] 源 SKILL 不存在：${src}`);
  }
  const body = fs.readFileSync(src, 'utf8').replace(/^\uFEFF/, '');
  const description = skillDescriptionForDir(skillDir);
  return ['---', `name: ${skillDir}`, `description: ${description}`, '---', '', body.replace(/^\s+/, '')].join(
    '\n',
  );
}

export interface MaterializeAgentBundleOptions {
  projectRoot: string;
  frameworkDir: string;
  bundle: ResolvedAgentBundlePaths;
  mode?: AgentBundleSkillMode;
  skillDirs?: string[];
}

export interface MaterializeAgentBundleResult {
  filesWritten: string[];
  warnings: string[];
}

export function materializeAgentBundleSkills(
  options: MaterializeAgentBundleOptions,
): MaterializeAgentBundleResult {
  const { projectRoot, frameworkDir, bundle } = options;
  const mode = options.mode ?? bundle.skillMode;
  const dirs = options.skillDirs ?? listFrameworkBuiltinSkillDirs(frameworkDir);
  const filesWritten: string[] = [];
  const warnings: string[] = [];

  const mkdirWrite = (relPosix: string, body: string) => {
    const abs = path.join(projectRoot, ...relPosix.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body, 'utf8');
    filesWritten.push(relPosix);
  };

  for (const dir of dirs) {
    const skillMdRepoRel = `framework/skills/${dir}/SKILL.md`;
    const targetRel = `${bundle.skillsDir}/${dir}/SKILL.md`;
    if (mode === 'inline') {
      mkdirWrite(targetRel, materializeInlineSkillMarkdown(frameworkDir, dir));
    } else {
      mkdirWrite(targetRel, renderBridgeSkillStubMarkdown(dir, targetRel, skillMdRepoRel));
    }
  }

  return { filesWritten, warnings };
}
