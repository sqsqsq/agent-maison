// ============================================================================
// agent-bundle-paths — generic adapter 可配置 bundle 根目录与物化模式
// ============================================================================

import * as path from 'path';

/** 与 framework.config.json paths 段对齐（避免 config.ts 循环依赖） */
export interface AgentBundlePathsSlice {
  agent_bundle_root?: string;
  agent_bundle_skill_mode?: AgentBundleSkillMode;
  features_dir?: string;
}

export interface AgentBundleConfigSlice {
  agent_adapter: string;
  paths: AgentBundlePathsSlice;
}

export type AgentBundleSkillMode = 'bridge' | 'inline';

export interface ResolvedAgentBundlePaths {
  root: string;
  skillsDir: string;
  rulesDir: string;
  skillMode: AgentBundleSkillMode;
}

const RESERVED_ROOT_PREFIXES = ['framework', 'doc/features'];

/**
 * config 驱动的 skill 模式解析。
 * inline 已彻底废弃（DEPRECATED）：无论 config 写了什么，一律解析为 `bridge` 薄跳板。
 * inline 物化仅保留为测试直接构造 bundle 对象（`{ skillMode: 'inline' }`）注入的能力，不再经由 config。
 */
export function normalizeAgentBundleSkillMode(_raw: unknown): AgentBundleSkillMode {
  return 'bridge';
}

export function validateAgentBundleRoot(root: string): void {
  const r = root.trim().replace(/\\/g, '/');
  if (!r) {
    throw new Error('[agent-bundle] paths.agent_bundle_root 不能为空');
  }
  if (path.isAbsolute(r) || /^[a-zA-Z]:/.test(r)) {
    throw new Error('[agent-bundle] paths.agent_bundle_root 必须是相对实例工程根的路径');
  }
  if (r.includes('..')) {
    throw new Error('[agent-bundle] paths.agent_bundle_root 不得包含 ".."');
  }
  const segments = r.split('/').filter(Boolean);
  if (segments.length === 0) {
    throw new Error('[agent-bundle] paths.agent_bundle_root 无效');
  }
  const first = segments[0].toLowerCase();
  for (const p of RESERVED_ROOT_PREFIXES) {
    if (first === p || r.toLowerCase().startsWith(`${p}/`)) {
      throw new Error(
        `[agent-bundle] paths.agent_bundle_root 不应落在保留前缀 "${p}" 下（收到 "${r}"）`,
      );
    }
  }
}

export function readAgentBundlePathsFromConfig(
  cfg: AgentBundleConfigSlice,
): ResolvedAgentBundlePaths | null {
  if (cfg.agent_adapter !== 'generic') {
    return null;
  }
  return resolveGenericBundlePathsFromPaths(cfg.paths);
}

/** 解析 generic bundle 路径；不依赖 cfg.agent_adapter（供物化入口探测） */
export function resolveGenericBundlePathsFromPaths(
  paths: AgentBundlePathsSlice,
): ResolvedAgentBundlePaths {
  const root =
    typeof paths.agent_bundle_root === 'string' && paths.agent_bundle_root.trim()
      ? paths.agent_bundle_root.trim()
      : '.agents';
  validateAgentBundleRoot(root);
  const skillMode = normalizeAgentBundleSkillMode(paths.agent_bundle_skill_mode);
  const posixRoot = root.replace(/\\/g, '/');
  return {
    root: posixRoot,
    skillsDir: `${posixRoot}/skills`,
    rulesDir: `${posixRoot}/rules`,
    skillMode,
  };
}

/** shared/agent-bundle/templates/skills-bridge 相对 framework/agents */
export const SHARED_SKILLS_BRIDGE_TEMPLATE_DIR = path.posix.join(
  'agents',
  'shared',
  'agent-bundle',
  'templates',
  'skills-bridge',
);

export const SHARED_RULES_TEMPLATE_DIR = path.posix.join(
  'agents',
  'shared',
  'agent-bundle',
  'templates',
  'rules',
);
