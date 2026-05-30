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

/** 内置 Skill 跳板 description（与 shared/skills-bridge 对齐） */
export const BUILTIN_SKILL_BRIDGE_DESCRIPTIONS: Record<string, string> = {
  '00-framework-init':
    '接入或升级 Framework 配置与 agent 产物（完整流程见 framework/skills/00-framework-init/SKILL.md）',
  '00b-framework-setup':
    '个人 Framework 设置（agent_adapter + DevEco 路径 → framework.local.json；完整流程见 framework/skills/00b-framework-setup/SKILL.md）',
  '0-catalog-bootstrap':
    '模块画像 catalog 与业务术语表 glossary 自举（完整流程见 framework/skills/0-catalog-bootstrap/SKILL.md）',
  '1-prd-design': 'PRD 撰写（完整流程见仓库 framework/skills/1-prd-design/SKILL.md）',
  '2-requirement-design':
    'PRD → 技术设计 design.md（完整流程见 framework/skills/2-requirement-design/SKILL.md）',
  '3-coding':
    '按 design / contracts 落地实现代码（宿主语言由 project_profile 决定；完整流程见 framework/skills/3-coding/SKILL.md）',
  '4-code-review': '代码审查报告（完整流程见 framework/skills/4-code-review/SKILL.md）',
  '5-business-ut': '业务级 UT / DAG（完整流程见 framework/skills/5-business-ut/SKILL.md）',
  '6-device-testing': '真机测试计划与报告（完整流程见 framework/skills/6-device-testing/SKILL.md）',
};

const RESERVED_ROOT_PREFIXES = ['framework', 'doc/features'];

export function normalizeAgentBundleSkillMode(raw: unknown): AgentBundleSkillMode {
  if (typeof raw === 'string' && raw.trim() === 'bridge') {
    return 'bridge';
  }
  return 'inline';
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
  const root = typeof cfg.paths.agent_bundle_root === 'string' ? cfg.paths.agent_bundle_root.trim() : '';
  if (!root) {
    throw new Error(
      '[agent-bundle] agent_adapter=generic 时必须配置 paths.agent_bundle_root（如 ".agents"）',
    );
  }
  validateAgentBundleRoot(root);
  const skillMode = normalizeAgentBundleSkillMode(cfg.paths.agent_bundle_skill_mode);
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
