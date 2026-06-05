// ============================================================================
// template-renderer.ts — AGENTS.md.template 共享渲染（init + render-agents-md CLI）
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';

import { DEFAULT_PROJECT_PROFILE_SUB_VARIANT_DISPLAY } from '../../config';
import {
  formatExtensionSkillSectionMarkdown,
  loadReservedBridgeIds,
  resolveBridgeTargets,
  scanExtensionSkills,
} from './instance-skill-bridge';

export type TemplateVars = Record<string, string>;

const KNOWN_PROJECT_TYPE_LABELS: Record<string, string> = {
  app: '应用工程',
  atomic_service: '元服务工程',
};

export function renderAgentsTemplate(tpl: string, vars: TemplateVars): string {
  let rendered = tpl;
  for (const [key, value] of Object.entries(vars)) {
    rendered = rendered.split(`{{${key}}}`).join(value);
  }
  return rendered;
}

export function findUnreplacedPlaceholders(rendered: string): string[] {
  const matches = rendered.match(/\{\{[A-Z_][A-Z0-9_]*\}\}/g);
  return matches ? Array.from(new Set(matches)) : [];
}

export function assertNoUnreplacedPlaceholders(rendered: string, context?: string): void {
  const remaining = findUnreplacedPlaceholders(rendered);
  if (remaining.length > 0) {
    throw new Error(
      `[template-renderer] 渲染后仍有未替换占位符：${remaining.join(', ')}` +
        (context ? `（${context}）` : ''),
    );
  }
}

/** DSL 引用风格架构摘要（不内联 cross_module_exports_file 字面值） */
export function buildArchitectureSummary(arch: unknown): string {
  if (!arch || typeof arch !== 'object') return '<待生成>';
  const a = arch as Record<string, unknown>;
  const layers = Array.isArray(a.outer_layers) ? a.outer_layers : [];
  const inner = Array.isArray(a.module_inner_layers) ? a.module_inner_layers : [];
  const ids = layers
    .map(l => (l && typeof l === 'object' ? (l as Record<string, unknown>).id : undefined))
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  const layerPart =
    ids.length === 0
      ? '0 个外层'
      : `${ids.length} 个外层（${ids[0]}…${ids[ids.length - 1]}）`;
  const innerPart =
    inner.length === 0 ? '模块内 0 层' : `模块内 ${inner.length} 层 ${inner.join('→')}`;
  return `${layerPart}，${innerPart}，跨模块出口见 DSL \`cross_module_exports_file\``;
}

export function loadProfileAgentsPartial(
  frameworkRoot: string,
  profileName: string,
  fileBase: string,
): string {
  const name = profileName.trim() !== '' ? profileName.trim() : 'hmos-app';
  const candidates = [
    path.join(frameworkRoot, 'profiles', name, 'templates', 'agents-md', `${fileBase}.partial.md`),
    path.join(frameworkRoot, 'profiles', 'generic', 'templates', 'agents-md', `${fileBase}.partial.md`),
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    return fs.readFileSync(p, 'utf8').replace(/\s+$/, '');
  }
  return '';
}

/** 与 normalizeFrameworkConfig 中 project_type 回退对齐 */
export function effectiveProjectType(config: Record<string, unknown>): string {
  if (typeof config.project_type === 'string' && config.project_type.trim() !== '') {
    return config.project_type.trim();
  }
  const pp =
    config.project_profile && typeof config.project_profile === 'object'
      ? (config.project_profile as Record<string, unknown>)
      : {};
  const sub =
    typeof pp.sub_variant === 'string' && pp.sub_variant.trim() !== '' ? pp.sub_variant.trim() : '';
  if (sub === 'element-service') return 'atomic_service';
  return 'app';
}

function projectTypeLabel(kind: string): string {
  return KNOWN_PROJECT_TYPE_LABELS[kind] ?? kind;
}

export interface BuildAgentsTemplateVarsOptions {
  entryFile: string;
  projectRoot: string;
  frameworkRoot: string;
  /** 缺省时内部 buildArchitectureSummary(config.architecture) */
  architectureSummary?: string;
  agentAdapter?: string;
  paths?: {
    architecture_md?: string;
    module_catalog?: string;
    glossary?: string;
    features_dir?: string;
    extension_dir?: string;
  };
}

/**
 * 构建 AGENTS.md.template 全部占位符 vars（UPPERCASE keys）。
 */
export function buildAgentsTemplateVars(
  config: Record<string, unknown>,
  opts: BuildAgentsTemplateVarsOptions,
): TemplateVars {
  const projectType = effectiveProjectType(config);
  const projectTypeLabelText = projectTypeLabel(projectType);
  const paths = opts.paths ?? {};
  const pp =
    config.project_profile && typeof config.project_profile === 'object'
      ? (config.project_profile as Record<string, unknown>)
      : {};
  const profileName =
    typeof pp.name === 'string' && pp.name.trim() !== '' ? pp.name.trim() : 'hmos-app';
  const extDir =
    typeof paths.extension_dir === 'string' && paths.extension_dir.trim()
      ? paths.extension_dir.trim()
      : typeof (config.paths as Record<string, unknown> | undefined)?.extension_dir === 'string'
        ? String((config.paths as Record<string, unknown>).extension_dir).trim()
        : 'doc/extensions';

  const cfgPaths =
    config.paths && typeof config.paths === 'object'
      ? (config.paths as Record<string, unknown>)
      : {};

  const rows = scanExtensionSkills(opts.projectRoot, extDir);
  const reserved = loadReservedBridgeIds(opts.frameworkRoot);
  const { targets } = resolveBridgeTargets(rows, reserved);

  const arch = config.architecture;
  const summary =
    opts.architectureSummary !== undefined && opts.architectureSummary !== ''
      ? opts.architectureSummary
      : buildArchitectureSummary(arch);

  return {
    AGENT_ENTRY_FILE: opts.entryFile,
    PROJECT_NAME: String(config.project_name ?? ''),
    PROJECT_TYPE: projectType,
    PROJECT_TYPE_LABEL: projectTypeLabelText,
    AGENT_ADAPTER: opts.agentAdapter ?? String(config.agent_adapter ?? ''),
    PROJECT_PROFILE_NAME: profileName,
    PROJECT_PROFILE_SUB_VARIANT:
      typeof pp.sub_variant === 'string' && pp.sub_variant.trim()
        ? pp.sub_variant.trim()
        : DEFAULT_PROJECT_PROFILE_SUB_VARIANT_DISPLAY,
    ARCHITECTURE_SUMMARY: summary,
    PROFILE_AGENT_SSOT_ROWS: loadProfileAgentsPartial(
      opts.frameworkRoot,
      profileName,
      'agent-ssot-rows',
    ),
    PROFILE_AGENT_GUARDRAILS: loadProfileAgentsPartial(
      opts.frameworkRoot,
      profileName,
      'agent-guardrails',
    ),
    ARCHITECTURE_MD_PATH: String(
      paths.architecture_md ?? cfgPaths.architecture_md ?? 'doc/architecture.md',
    ),
    MODULE_CATALOG_PATH: String(
      paths.module_catalog ?? cfgPaths.module_catalog ?? 'doc/module-catalog.yaml',
    ),
    GLOSSARY_PATH: String(paths.glossary ?? cfgPaths.glossary ?? 'doc/glossary.yaml'),
    FEATURES_DIR: String(paths.features_dir ?? cfgPaths.features_dir ?? 'doc/features'),
    EXTENSION_SKILL_SECTION: formatExtensionSkillSectionMarkdown(targets),
  };
}

/** check-init 兼容：snake_case env → renderAgentsTemplate */
export interface LegacyRenderEnv {
  agent_entry_file: string;
  project_name: string;
  project_type: string;
  project_type_label: string;
  agent_adapter: string;
  project_profile_name: string;
  project_profile_sub_variant: string;
  architecture_summary: string;
  architecture_md_path: string;
  module_catalog_path: string;
  glossary_path: string;
  features_dir: string;
  module_inner_layers_csv: string;
  cross_module_exports_file: string;
  profile_agent_ssot_rows: string;
  profile_agent_guardrails: string;
  extension_skill_section?: string;
}

export function legacyRenderEnvToTemplateVars(env: LegacyRenderEnv): TemplateVars {
  return {
    AGENT_ENTRY_FILE: env.agent_entry_file,
    PROJECT_NAME: env.project_name,
    PROJECT_TYPE: env.project_type,
    PROJECT_TYPE_LABEL: env.project_type_label,
    AGENT_ADAPTER: env.agent_adapter,
    PROJECT_PROFILE_NAME: env.project_profile_name,
    PROJECT_PROFILE_SUB_VARIANT: env.project_profile_sub_variant,
    ARCHITECTURE_SUMMARY: env.architecture_summary,
    PROFILE_AGENT_SSOT_ROWS: env.profile_agent_ssot_rows,
    PROFILE_AGENT_GUARDRAILS: env.profile_agent_guardrails,
    ARCHITECTURE_MD_PATH: env.architecture_md_path,
    MODULE_CATALOG_PATH: env.module_catalog_path,
    GLOSSARY_PATH: env.glossary_path,
    FEATURES_DIR: env.features_dir,
    EXTENSION_SKILL_SECTION: env.extension_skill_section ?? '',
    MODULE_INNER_LAYERS_CSV: env.module_inner_layers_csv,
    CROSS_MODULE_EXPORTS_FILE: env.cross_module_exports_file,
  };
}

export function renderFromLegacyEnv(text: string, env: LegacyRenderEnv): string {
  const rendered = renderAgentsTemplate(text, legacyRenderEnvToTemplateVars(env));
  assertNoUnreplacedPlaceholders(rendered, 'check-init entry render');
  return rendered;
}
