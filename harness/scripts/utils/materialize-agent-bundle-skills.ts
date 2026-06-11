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
import {
  listBuiltinSkillIds,
  resolveSkillPath,
  skillMdAbs,
} from './resolve-skill-path';

export { BUILTIN_SKILL_BRIDGE_DESCRIPTIONS };

/** @deprecated use listBuiltinSkillIds */
export function listFrameworkBuiltinSkillDirs(frameworkDir: string): string[] {
  return listBuiltinSkillIds(frameworkDir);
}

export function skillDescriptionForDir(skillId: string): string {
  return (
    BUILTIN_SKILL_BRIDGE_DESCRIPTIONS[skillId] ??
    `Framework Skill（完整流程见 framework/skills/…/${skillId}/SKILL.md）`
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
  skillId: string,
  stubTargetRelPosix: string,
  skillMdRepoRelPosix: string,
): string {
  const relFromStub = posixRelativeFromSkillStubTo(stubTargetRelPosix, skillMdRepoRelPosix);
  const description = skillDescriptionForDir(skillId);
  return [
    '---',
    `name: ${skillId}`,
    `description: ${description}`,
    '---',
    '',
    '# 跳板文件',
    '',
    `完整 Skill 定义请阅读：**[${skillMdRepoRelPosix}](${relFromStub})**`,
    '',
  ].join('\n');
}

const INLINE_REL_LINK_RE = /\]\((\.\.\/[^)\s#]+(?:#[^)\s]*)?)\)/g;
const INLINE_BACKTICK_REL_RE = /`(\.\.\/[^`\s]+)`/g;

const FRAMEWORK_ASSET_TOP_DIRS = new Set([
  'skills',
  'harness',
  'profiles',
  'workflows',
  'specs',
  'templates',
  'agents',
  'docs',
]);

function isFrameworkAssetAbsPath(targetAbs: string, fwRoot: string): boolean {
  const rel = path.relative(fwRoot, targetAbs).replace(/\\/g, '/');
  if (!rel || rel.startsWith('..')) return false;
  const top = rel.split('/')[0];
  return FRAMEWORK_ASSET_TOP_DIRS.has(top);
}

export interface InlineMaterializeLinkContext {
  projectRoot: string;
  stubTargetRelPosix: string;
}

/**
 * inline 物化到 `.agents/skills/<id>/` 时改写相对链接：
 * - framework 树内 → `framework/...` 逻辑路径
 * - 宿主工程根（doc/、framework.config.json 等）→ 相对 stub 位置的路径
 */
export function rewriteRelativeLinksForInlineMaterialize(
  body: string,
  sourceSkillMdAbs: string,
  frameworkDir: string,
  ctx: InlineMaterializeLinkContext,
): string {
  const fwRoot = path.resolve(frameworkDir);
  const projRoot = path.resolve(ctx.projectRoot);
  const stubAbs = path.join(projRoot, ...ctx.stubTargetRelPosix.split('/'));
  const stubDir = path.dirname(stubAbs);
  const sourceDir = path.dirname(sourceSkillMdAbs);

  const rewrite = (rel: string): string => {
    const [pathPart, hash = ''] = rel.split('#');
    if (!pathPart.startsWith('../')) {
      return rel;
    }
    const targetAbs = path.resolve(sourceDir, pathPart);
    const hashSuffix = hash ? `#${hash}` : '';
    const fwPrefix = fwRoot + path.sep;
    const projPrefix = projRoot + path.sep;

    const underConsumerFramework =
      fwRoot !== projRoot && (targetAbs.startsWith(fwPrefix) || targetAbs === fwRoot);
    if (underConsumerFramework || isFrameworkAssetAbsPath(targetAbs, fwRoot)) {
      const inside = path.relative(fwRoot, targetAbs).replace(/\\/g, '/');
      return `framework/${inside}${hashSuffix}`;
    }

    if (targetAbs.startsWith(projPrefix) || targetAbs === projRoot) {
      const relFromStub = path.relative(stubDir, targetAbs).replace(/\\/g, '/');
      return `${relFromStub}${hashSuffix}`;
    }

    // consumer 布局下 feature/project skill 常以多一层 ../ 指向宿主 doc/ 或 framework.config.json
    const hostTail = pathPart.match(/^((?:\.\.\/)+)(doc\/.+|framework\.config\.json)$/);
    if (hostTail) {
      const hostAbs = path.join(projRoot, hostTail[2]);
      const relFromStub = path.relative(stubDir, hostAbs).replace(/\\/g, '/');
      return `${relFromStub}${hashSuffix}`;
    }

    return rel;
  };

  let out = body.replace(INLINE_REL_LINK_RE, (_m, rel: string) => `](${rewrite(rel)})`);
  out = out.replace(INLINE_BACKTICK_REL_RE, (_m, rel: string) => `\`${rewrite(rel)}\``);
  return out;
}

/** @deprecated use rewriteRelativeLinksForInlineMaterialize */
export const rewriteRelativeLinksToFrameworkLogical = rewriteRelativeLinksForInlineMaterialize;

export function materializeInlineSkillMarkdown(
  frameworkDir: string,
  skillId: string,
  ctx?: InlineMaterializeLinkContext,
): string {
  const src = skillMdAbs(frameworkDir, skillId);
  if (!fs.existsSync(src)) {
    throw new Error(`[materialize-agent-bundle] 源 SKILL 不存在：${src}`);
  }
  const raw = fs.readFileSync(src, 'utf8').replace(/^\uFEFF/, '');
  let body = raw.replace(/^\s+/, '');
  if (ctx) {
    body = rewriteRelativeLinksForInlineMaterialize(body, src, frameworkDir, ctx);
  }
  const description = skillDescriptionForDir(skillId);
  return ['---', `name: ${skillId}`, `description: ${description}`, '---', '', body].join('\n');
}

export interface MaterializeAgentBundleOptions {
  projectRoot: string;
  frameworkDir: string;
  bundle: ResolvedAgentBundlePaths;
  mode?: AgentBundleSkillMode;
  skillIds?: string[];
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
  const ids = options.skillIds ?? listBuiltinSkillIds(frameworkDir);
  const filesWritten: string[] = [];
  const warnings: string[] = [];

  const mkdirWrite = (relPosix: string, body: string) => {
    const abs = path.join(projectRoot, ...relPosix.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body, 'utf8');
    filesWritten.push(relPosix);
  };

  for (const id of ids) {
    const resolved = resolveSkillPath(frameworkDir, id);
    const skillMdRepoRel = resolved.skillMdRepoRel;
    const targetRel = `${bundle.skillsDir}/${id}/SKILL.md`;
    if (mode === 'inline') {
      mkdirWrite(
        targetRel,
        materializeInlineSkillMarkdown(frameworkDir, id, {
          projectRoot,
          stubTargetRelPosix: targetRel,
        }),
      );
    } else {
      mkdirWrite(targetRel, renderBridgeSkillStubMarkdown(id, targetRel, skillMdRepoRel));
    }
  }

  return { filesWritten, warnings };
}
