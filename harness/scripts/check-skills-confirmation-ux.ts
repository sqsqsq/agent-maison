// ============================================================================
// check-skills-confirmation-ux.ts — Skill 文案确认 UX 静态 lint
// ============================================================================
// 只扫描 Markdown 指令质量，不验证运行时 agent 是否调用了 AskQuestion。
// 由 check-docs.ts 在 docs phase 调用；单元测试见 confirmation-ux.unit.test.ts
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import YAML from 'yaml';

import type { CheckContext, CheckResult } from './utils/types';
import { loadFrameworkConfig } from '../config';
import { frameworkAbs, frameworkLogicalRelPath, frameworkRelPath, inferRepoLayout, repoLayoutFromContext, type RepoLayout } from '../repo-layout';
import { resolveSkillPathOrNull } from './utils/resolve-skill-path';

const SHARED_LAYER_TOOL_NAME_FORBIDDEN = /\b(?:AskUserQuestion|AskQuestion)\b/;
const TEXT_LIKE_EXTENSIONS = new Set([
  '.md', '.mdc', '.yaml', '.yml', '.template.md', '.md.template',
]);
const CLAUDE_SLASH_COMMANDS = [
  'commands/spec.md',
  'commands/plan.md',
  'commands/coding.md',
  'commands/code-review.md',
  'commands/business-ut.md',
  'commands/device-testing.md',
  'commands/catalog-bootstrap.md',
  'commands/glossary-bootstrap.md',
  'commands/framework-init.md',
  'commands/goal-mode.md',
  'commands/code-graph.md',
] as const;
const ADAPTER_NAMES = ['claude', 'cursor', 'generic', 'codex', 'chrys', 'opencode'] as const;

/** registry `skill` 无物理 SKILL.md 的虚拟命名空间（须与 confirmation-registry 同步登记） */
export const VIRTUAL_REGISTRY_SKILLS = new Set(['_cross_phase', '_personal_setup']);

export function lintRegistrySkillPaths(
  registryText: string,
  layout: RepoLayout,
  registryRel: string,
): CheckResult[] {
  const results: CheckResult[] = [];
  const skillDirs = new Set<string>();
  for (const m of registryText.matchAll(/skill:\s+"([^"]+)"/g)) {
    skillDirs.add(m[1]);
  }
  const frameworkDir = path.dirname(frameworkAbs(layout, 'skills'));
  for (const skill of skillDirs) {
    if (VIRTUAL_REGISTRY_SKILLS.has(skill)) continue;
    const resolved = resolveSkillPathOrNull(frameworkDir, skill);
    const skillMdAbs = resolved
      ? path.join(frameworkDir, resolved.skillMdFrameworkRel)
      : frameworkAbs(layout, 'skills', skill, 'SKILL.md');
    if (!fs.existsSync(skillMdAbs)) {
      results.push(warn('registry_skill_path', `registry 引用 skill ${skill} 但 SKILL.md 不存在`, [registryRel]));
    }
  }
  return results;
}

function listMarkdownFiles(root: string, sub: string): string[] {
  const base = path.join(root, sub);
  if (!fs.existsSync(base)) return [];
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === 'node_modules') continue;
        walk(abs);
      } else if (ent.name === 'SKILL.md' || ent.name.endsWith('.template.md') || ent.name === 'profile-addendum.md') {
        out.push(abs);
      }
    }
  };
  walk(base);
  return out;
}

export interface ConfirmationUxLintOptions {
  projectRoot: string;
  /** 实例扩展 skills（可选） */
  extensionSkillDirs?: string[];
  layout?: RepoLayout;
}

export function lintConfirmationUx(options: ConfirmationUxLintOptions): CheckResult[] {
  const { projectRoot } = options;
  const results: CheckResult[] = [];
  const layout = options.layout ?? inferRepoLayout(projectRoot);

  const ssotRel = frameworkLogicalRelPath('skills', 'reference', 'user-confirmation-ux.md');
  const registryRel = frameworkLogicalRelPath('skills', 'reference', 'confirmation-registry.yaml');
  const ssotPath = frameworkAbs(layout, 'skills', 'reference', 'user-confirmation-ux.md');
  const registryPath = frameworkAbs(layout, 'skills', 'reference', 'confirmation-registry.yaml');

  if (!fs.existsSync(ssotPath)) {
    results.push(blocker('ssot_exists', 'user-confirmation-ux.md 缺失', [ssotRel]));
    return results;
  }
  if (!fs.existsSync(registryPath)) {
    results.push(blocker('registry_exists', 'confirmation-registry.yaml 缺失', [registryRel]));
    return results;
  }

  const registryText = fs.readFileSync(registryPath, 'utf-8');
  const registryIds = [...registryText.matchAll(/^\s*-\s+id:\s+([a-z0-9_.]+)/gm)].map(m => m[1]);

  const files: string[] = [];
  for (const scanRoot of [
    frameworkAbs(layout, 'skills'),
    frameworkAbs(layout, 'profiles'),
  ]) {
    files.push(...listMarkdownFiles(scanRoot, '.'));
  }
  for (const extDir of options.extensionSkillDirs ?? []) {
    const abs = path.isAbsolute(extDir) ? extDir : path.join(projectRoot, extDir);
    if (fs.existsSync(abs)) {
      files.push(...listMarkdownFiles(abs, '.'));
    }
  }

  for (const abs of files) {
    const rel = path.relative(projectRoot, abs).replace(/\\/g, '/');
    const content = fs.readFileSync(abs, 'utf-8');
    results.push(...lintOneFile(rel, content));
  }

  results.push(...lintRegistrySkillPaths(registryText, layout, registryRel));

  if (registryIds.length < 20) {
    results.push(warn('registry_size', `confirmation-registry 仅 ${registryIds.length} 条，预期 ≥20`, [registryRel]));
  }

  results.push(...lintRegistryOptionsSchema(registryText, registryRel));
  results.push(...lintInitSetupNoFreeText(registryText, registryRel));
  results.push(...lintInitSetupPromptsAndTemplates(layout));
  results.push(...lintInitS4ClosedNoPortableFooter(layout));
  results.push(...lintSharedLayerNoToolNames(layout));
  results.push(...lintAdapterInteractionRenderers(layout));
  results.push(...lintClaudeInteractionTemplates(layout));

  return results;
}

function listTextLikeFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === 'node_modules') continue;
        walk(abs);
        continue;
      }
      const lower = ent.name.toLowerCase();
      const ext = path.extname(lower);
      const isTextLike =
        TEXT_LIKE_EXTENSIONS.has(ext)
        || lower.endsWith('.md.template')
        || lower.endsWith('.template.md')
        || ent.name === 'SKILL.md'
        || ent.name === 'profile-addendum.md';
      if (isTextLike) out.push(abs);
    }
  };
  walk(root);
  return out;
}

function lintSharedLayerNoToolNames(layout: RepoLayout): CheckResult[] {
  const results: CheckResult[] = [];
  const scanRoots = [
    frameworkAbs(layout, 'skills'),
    frameworkAbs(layout, 'profiles'),
    frameworkAbs(layout, 'agents', 'shared'),
    frameworkAbs(layout, 'templates'),
  ];
  for (const root of scanRoots) {
    for (const abs of listTextLikeFiles(root)) {
      const rel = frameworkRelPath(layout, abs).replace(/\\/g, '/');
      const content = fs.readFileSync(abs, 'utf-8');
      if (SHARED_LAYER_TOOL_NAME_FORBIDDEN.test(content)) {
        results.push(blocker(
          'shared_layer_tool_name',
          `${rel} 共享层不得出现 AskUserQuestion/AskQuestion`,
          [rel],
          '将工具名移至 adapter interaction-renderer 或 commands',
        ));
      }
    }
  }
  return results;
}

const INIT_SETUP_REGISTRY_IDS = new Set([
  'init.task_plan',
  'init.task_decision',
  'init.materialized_adapters',
  'init.project_profile',
  'init.architecture_preset',
  'init.intra_layer_deps',
  'init.intra_layer_deps.matrix',
  'init.create_downgrade',
  'setup.adapter',
  'setup.deveco_path',
]);

const INIT_SETUP_PROMPT_TEMPLATE_FORBIDDEN: Array<{ id: string; re: RegExp; message: string }> = [
  {
    id: 'init_setup_fully_custom',
    re: /完全自定义/,
    message: 'init/setup 禁止「完全自定义」对话分支；改用手动编辑 framework.config.json',
  },
  {
    id: 'init_setup_collect_fields',
    re: /收集字段/,
    message: 'init/setup 禁止对话「收集字段」',
  },
  {
    id: 'init_setup_manual_assemble_json',
    re: /手工拼装\s*JSON/,
    message: 'init/setup 禁止对话手工拼装 JSON',
  },
  {
    id: 'init_setup_item_by_item_confirm',
    re: /逐项确认/,
    message: 'init/setup 禁止 architecture 逐项确认问卷',
  },
  {
    id: 'init_setup_append_questionnaire',
    re: /追加问卷/,
    message: 'init/setup 禁止追加问卷交互',
  },
  {
    id: 'init_setup_followup_sublayer',
    re: /继续追问/,
    message: 'init/setup 禁止对话追问 sublayer 字段',
  },
  {
    id: 'init_setup_sublayer_questionnaire',
    re: /子层问卷/,
    message: 'init/setup 禁止子层问卷；sublayer 须在 preset/磁盘 JSON 中预置',
  },
  {
    id: 'init_setup_questionnaire_collect',
    re: /问卷.*收集|收集.*问卷/,
    message: 'init/setup 禁止问卷式收集 architecture 字段',
  },
];

function initSetupPromptLineAllowed(line: string): boolean {
  return /禁止|不得|STOP|反模式|❌|已下线|非对话/.test(line);
}

function listInitSetupPromptTemplateFiles(layout: RepoLayout): string[] {
  const frameworkDir = path.dirname(frameworkAbs(layout, 'skills'));
  const initDir = path.join(frameworkDir, 'skills', 'project', 'framework-init');
  const roots = [
    path.join(initDir, 'prompts'),
    path.join(initDir, 'templates'),
  ];
  const out: string[] = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const walk = (dir: string) => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(abs);
        else if (ent.name.endsWith('.md')) out.push(abs);
      }
    };
    walk(root);
  }
  return out;
}

/** 对单文件逐行扫描 init/setup 禁止的自由文本问卷模式 */
function lintInitSetupForbiddenPatternsInFile(projectRoot: string, abs: string): CheckResult[] {
  const results: CheckResult[] = [];
  const rel = path.relative(projectRoot, abs).replace(/\\/g, '/');
  const lines = fs.readFileSync(abs, 'utf-8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (initSetupPromptLineAllowed(line)) continue;
    for (const rule of INIT_SETUP_PROMPT_TEMPLATE_FORBIDDEN) {
      if (rule.re.test(line)) {
        results.push(blocker(
          rule.id,
          `${rule.message}（${rel}:${i + 1}）`,
          [rel],
        ));
        break;
      }
    }
  }
  return results;
}

/** 扫描 framework-init prompts/templates 与 user-confirmation-ux SSOT，阻断 architecture 自由文本问卷后门 */
function lintInitSetupPromptsAndTemplates(layout: RepoLayout): CheckResult[] {
  const results: CheckResult[] = [];
  for (const abs of listInitSetupPromptTemplateFiles(layout)) {
    results.push(...lintInitSetupForbiddenPatternsInFile(layout.projectRoot, abs));
  }
  const ssotAbs = frameworkAbs(layout, 'skills', 'reference', 'user-confirmation-ux.md');
  if (fs.existsSync(ssotAbs)) {
    results.push(...lintInitSetupForbiddenPatternsInFile(layout.projectRoot, ssotAbs));
  }
  return results;
}

/** init/setup registry 禁止 custom / 自由路径 / legacy Q1=y 通道 */
function lintInitSetupNoFreeText(registryText: string, registryRel: string): CheckResult[] {
  const results: CheckResult[] = [];
  if (/\n  - id: init\.populated_diff\b/.test(registryText)) {
    results.push(blocker(
      'registry_init_populated_diff_removed',
      'registry 不得保留 init.populated_diff（已下线，改用 init.task_decision）',
      [registryRel],
    ));
  }
  if (/\n  - id: init\.adapter\b/.test(registryText)) {
    results.push(blocker(
      'registry_init_adapter_removed',
      'registry 不得保留 init.adapter（已下线，改用 init.materialized_adapters + setup.adapter）',
      [registryRel],
    ));
  }
  for (const block of registryText.split(/\n  - id:/).slice(1)) {
    const skillMatch = block.match(/\n    skill: "(framework-init|_personal_setup)"/);
    if (!skillMatch) continue;
    const idMatch = block.match(/^ ([a-z0-9_.]+)/);
    const id = idMatch?.[1] ?? '?';
    for (const labelMatch of block.matchAll(/\n        label: "(.+)"/g)) {
      const label = labelMatch[1] ?? '';
      if (/子层问卷|追加问卷/.test(label)) {
        results.push(blocker(
          'registry_init_setup_no_questionnaire_label',
          `registry ${id} (${skillMatch[1]}) label 仍含问卷交互：${label}`,
          [registryRel],
        ));
        break;
      }
      if (/复述|重复.*名|须在本轮/.test(label)) {
        results.push(blocker(
          'registry_init_setup_no_repeat_name_label',
          `registry ${id} (${skillMatch[1]}) label 暗示自由复述：${label}`,
          [registryRel],
        ));
        break;
      }
    }
    for (const portableMatch of block.matchAll(/\n        portable: "(.+)"/g)) {
      const portable = portableMatch[1] ?? '';
      if (/复述|重复.*名|须在本轮/.test(portable)) {
        results.push(blocker(
          'registry_init_setup_no_repeat_name_portable',
          `registry ${id} (${skillMatch[1]}) portable 暗示自由复述：${portable}`,
          [registryRel],
        ));
        break;
      }
    }
  }
  const entryBlocks = registryText.split(/\n  - id:/).slice(1);
  for (const block of entryBlocks) {
    const idMatch = block.match(/^ ([a-z0-9_.]+)/);
    if (!idMatch || !INIT_SETUP_REGISTRY_IDS.has(idMatch[1]!)) continue;
    const id = idMatch[1]!;
    if (/\n      - value: custom\b/.test(block)) {
      results.push(blocker(
        'registry_init_setup_no_custom_value',
        `registry ${id} 禁止 value: custom（init/setup 须 select-only）`,
        [registryRel],
      ));
    }
    const legacyQ = block.match(/\n    portable_menu: "(.+)"/);
    if (legacyQ && /Q1=|all=y|all=n|\by=|\bN=/.test(legacyQ[1] ?? '')) {
      results.push(blocker(
        'registry_init_setup_legacy_q_portable_menu',
        `registry ${id} portable_menu 仍含 Q1/y/N 通道：${legacyQ[1]}`,
        [registryRel],
      ));
    }
    for (const portableMatch of block.matchAll(/\n        portable: "(.+)"/g)) {
      const portable = portableMatch[1] ?? '';
      if (/^y=|^N=|Q1=|all=y|all=n/.test(portable)) {
        results.push(blocker(
          'registry_init_setup_legacy_q_portable',
          `registry ${id} option portable 仍含 Q1/y/N 通道：${portable}`,
          [registryRel],
        ));
        break;
      }
    }
    for (const labelMatch of block.matchAll(/\n        label: (.+)/g)) {
      const label = labelMatch[1] ?? '';
      if (/字符串|自定义路径|自由/.test(label)) {
        results.push(blocker(
          'registry_init_setup_no_freeform_label',
          `registry ${id} option label 暗示自由输入：${label}`,
          [registryRel],
        ));
        break;
      }
    }
    for (const notesMatch of block.matchAll(/\n    notes: "(.+)"/g)) {
      const notes = notesMatch[1] ?? '';
      if (/自由路径|自由文本|自定义 name/.test(notes) && !/禁止/.test(notes)) {
        results.push(blocker(
          'registry_init_setup_freeform_notes',
          `registry ${id} notes 仍允许自由输入：${notes}`,
          [registryRel],
        ));
      }
    }
  }
  return results;
}

function lintRegistryOptionsSchema(registryText: string, registryRel: string): CheckResult[] {
  const results: CheckResult[] = [];
  if (!/schema_version:\s*"2\.0"/.test(registryText)) {
    results.push(blocker('registry_schema_version', 'confirmation-registry.yaml 须 schema_version: "2.0"', [registryRel]));
  }
  if (/widget_hint:|widget_options_ref:/.test(registryText)) {
    results.push(blocker(
      'registry_deprecated_fields',
      'confirmation-registry.yaml 不得含 widget_hint / widget_options_ref',
      [registryRel],
    ));
  }

  const entryBlocks = registryText.split(/\n  - id:/).slice(1);
  for (const block of entryBlocks) {
    const idMatch = block.match(/^ ([a-z0-9_.]+)/);
    if (!idMatch) continue;
    const id = idMatch[1];
    const classMatch = block.match(/\n    class: ([a-z_]+)/);
    const cls = classMatch?.[1] ?? '';
    if (['enum', 'gate', 'freeform_approval', 'artifact_checkbox'].includes(cls)) {
      if (!/\n    options:\n/.test(block)) {
        results.push(blocker(
          'registry_options_missing',
          `registry ${id} (${cls}) 缺少 options 数组`,
          [registryRel],
        ));
        continue;
      }
      const optionRows = [...block.matchAll(/\n      - value: /g)];
      if (optionRows.length === 0) {
        results.push(blocker('registry_options_empty', `registry ${id} options 为空`, [registryRel]));
      }
      for (const row of optionRows) {
        const slice = block.slice(row.index ?? 0, (row.index ?? 0) + 400);
        if (!/\n        label:/.test(slice) || !/\n        portable:/.test(slice)) {
          results.push(blocker(
            'registry_option_incomplete',
            `registry ${id} 某项 option 缺少 label/portable`,
            [registryRel],
          ));
          break;
        }
      }
    }
    if (cls === 'matrix') {
      const hasMatrix = /\n    matrix_options:\n/.test(block) || /\n    parent:/.test(block);
      if (!hasMatrix) {
        results.push(blocker(
          'registry_matrix_incomplete',
          `registry ${id} (matrix) 须 matrix_options 或 parent`,
          [registryRel],
        ));
      }
    }
  }
  return results;
}

const INIT_S4_CLOSED_MARKER = 'S4 已闭环';

function lintInitS4ClosedNoPortableFooter(layout: RepoLayout): CheckResult[] {
  const results: CheckResult[] = [];
  const requiredFiles: Array<{ parts: string[]; label: string }> = [
    { parts: ['skills', 'project', 'framework-init', 'SKILL.md'], label: 'framework-init SKILL' },
    { parts: ['skills', 'reference', 'user-confirmation-ux.md'], label: 'user-confirmation-ux' },
  ];
  for (const { parts, label } of requiredFiles) {
    const abs = frameworkAbs(layout, ...parts);
    const rel = frameworkRelPath(layout, abs);
    if (!fs.existsSync(abs)) {
      results.push(blocker('init_s4_closed_ssot_missing', `${label} 缺失`, [rel]));
      continue;
    }
    const text = fs.readFileSync(abs, 'utf-8');
    if (!text.includes(INIT_S4_CLOSED_MARKER)) {
      results.push(blocker(
        'init_s4_closed_ssot_missing_rule',
        `${label} 须声明 ${INIT_S4_CLOSED_MARKER}（禁止 S4 摘要后附 init portable 脚注）`,
        [rel],
      ));
    }
  }
  return results;
}

function lintAdapterInteractionRenderers(layout: RepoLayout): CheckResult[] {
  const results: CheckResult[] = [];
  for (const adapter of ADAPTER_NAMES) {
    const yamlPath = frameworkAbs(layout, 'agents', adapter, 'adapter.yaml');
    const yamlRel = frameworkRelPath(layout, yamlPath);
    if (!fs.existsSync(yamlPath)) {
      results.push(blocker('adapter_yaml_missing', `${adapter} adapter.yaml 缺失`, [yamlRel]));
      continue;
    }
    const cfg = YAML.parse(fs.readFileSync(yamlPath, 'utf-8')) as Record<string, unknown>;
    const uc = cfg.user_confirmation as Record<string, unknown> | undefined;
    if (!uc) {
      results.push(blocker('adapter_user_confirmation_missing', `${adapter} 缺少 user_confirmation`, [yamlRel]));
      continue;
    }
    const ruleRel = uc.interaction_renderer_rule;
    if (typeof ruleRel !== 'string' || !ruleRel.trim()) {
      results.push(blocker(
        'adapter_interaction_renderer_missing',
        `${adapter} user_confirmation 缺少 interaction_renderer_rule`,
        [yamlRel],
      ));
      continue;
    }
    const ruleAbs = frameworkAbs(layout, 'agents', adapter, ruleRel);
    const rulePathRel = frameworkRelPath(layout, ruleAbs);
    if (!fs.existsSync(ruleAbs)) {
      results.push(blocker(
        'adapter_interaction_renderer_file_missing',
        `${adapter} interaction_renderer_rule 指向的文件不存在: ${ruleRel}`,
        [rulePathRel],
      ));
    } else {
      const ruleText = fs.readFileSync(ruleAbs, 'utf-8');
      if (!ruleText.includes(INIT_S4_CLOSED_MARKER)) {
        results.push(blocker(
          'adapter_interaction_renderer_init_s4_closed',
          `${adapter} interaction-renderer 须声明 ${INIT_S4_CLOSED_MARKER}（禁止 S4 摘要后附 portable 脚注）`,
          [rulePathRel],
        ));
      }
    }
    if (uc.widget_tool_hint !== undefined) {
      results.push(blocker(
        'adapter_widget_tool_hint_deprecated',
        `${adapter} adapter.yaml 仍含 widget_tool_hint，须删除`,
        [yamlRel],
      ));
    }
  }
  return results;
}

function lintClaudeInteractionTemplates(layout: RepoLayout): CheckResult[] {
  const results: CheckResult[] = [];
  const templatesRel = frameworkRelPath(layout, 'agents', 'claude', 'templates');
  const base = frameworkAbs(layout, 'agents', 'claude', 'templates');
  if (!fs.existsSync(base)) return results;

  const rendererPath = path.join(base, 'rules/interaction-renderer.md');
  const rendererRel = `${templatesRel}/rules/interaction-renderer.md`.replace(/\\/g, '/');
  if (!fs.existsSync(rendererPath)) {
    results.push(blocker('claude_interaction_renderer_missing', 'Claude interaction-renderer.md 模板缺失', [rendererRel]));
  } else {
    const renderer = fs.readFileSync(rendererPath, 'utf-8');
    if (!renderer.includes('AskUserQuestion')) {
      results.push(blocker('claude_interaction_renderer_no_tool', 'interaction-renderer.md 须声明 AskUserQuestion', [rendererRel]));
    }
    if (!renderer.includes('confirmation-registry.yaml')) {
      results.push(blocker('claude_interaction_renderer_no_registry', 'interaction-renderer.md 须链 confirmation-registry.yaml', [rendererRel]));
    }
  }

  const legacyConfirm = path.join(base, 'rules/confirmation-ux.md');
  if (fs.existsSync(legacyConfirm)) {
    results.push(blocker('claude_confirmation_ux_legacy', 'confirmation-ux.md 已废弃，须删除', [`${templatesRel}/rules/confirmation-ux.md`]));
  }
  const legacyWidgetDir = path.join(base, 'rules/widget-options');
  if (fs.existsSync(legacyWidgetDir)) {
    results.push(blocker('claude_widget_options_legacy', 'widget-options/ 已废弃，须删除', [`${templatesRel}/rules/widget-options/`]));
  }

  for (const rel of CLAUDE_SLASH_COMMANDS) {
    const abs = path.join(base, rel);
    const posix = `${templatesRel}/${rel}`.replace(/\\/g, '/');
    if (!fs.existsSync(abs)) {
      results.push(blocker('claude_slash_missing', `Claude slash 模板缺失: ${posix}`, [posix]));
      continue;
    }
    const content = fs.readFileSync(abs, 'utf-8');
    if (!content.includes('AskUserQuestion') || !content.includes('BLOCKER')) {
      results.push(blocker('claude_slash_no_widget_blocker', `${posix} 须含 AskUserQuestion BLOCKER 段`, [posix]));
    }
    if (!content.includes('interaction-renderer')) {
      results.push(blocker('claude_slash_no_renderer_ref', `${posix} 须链 interaction-renderer`, [posix]));
    }
    if (content.includes('../rules/widget-options/') || content.includes('confirmation-ux.md')) {
      results.push(blocker('claude_slash_legacy_ref', `${posix} 仍引用废弃 widget-options/confirmation-ux`, [posix]));
    }
  }

  return results;
}

function lintOneFile(rel: string, content: string): CheckResult[] {
  const results: CheckResult[] = [];
  const hasSsot =
    content.includes('user-confirmation-ux.md') ||
    content.includes('confirmation-registry.yaml') ||
    /`(?:init|prd|design|coding|ut|testing|catalog|review)\.[a-z0-9_.]+`/.test(content);

  const needsConfirmUx =
    /(?:BLOCKER|HARD STOP)/.test(content) &&
    /(?:确认|停下来|等待用户|显式回复|须.*用户)/.test(content);

  if (needsConfirmUx && !hasSsot && !rel.includes('reference/')) {
    if (rel.endsWith('SKILL.md') || rel.endsWith('profile-addendum.md')) {
      results.push(blocker(
        'confirm_requires_ssot_link',
        `${rel} 含 BLOCKER/HARD STOP 确认描述但未链 SSOT 或 registry id`,
        [rel],
        '添加链接 framework/skills/reference/user-confirmation-ux.md 或 `registry.id`',
      ));
    }
  }

  // naked typing without gate — exclude reference docs
  const nakedTyping = /(?:逐行.*(?:明确)?回复|请按以下格式回复)/.test(content);
  const hasGate =
    /请选择（回复编号/.test(content) ||
    content.includes('user-confirmation-ux.md') ||
    /Q1=/.test(content) ||
    /1=.*2=/.test(content);

  if (nakedTyping && !hasGate && rel.includes('intra-layer-deps-confirm')) {
    results.push(blocker(
      'no_naked_typing_menu',
      `${rel} 仍要求逐行打字且无 gate/编号菜单`,
      [rel],
    ));
  }

  if (rel.includes('spec/SKILL.md') && needsConfirmUx) {
    if (!/\[x\]/.test(content) || !content.includes('术语映射')) {
      results.push(blocker(
        'artifact_checkbox_unchanged',
        'spec 须保留术语映射表 [x] BLOCKER',
        [rel],
      ));
    }
  }

  results.push(...lintPhaseClosureGates(rel, content));

  return results;
}

/** Feature phase SKILL.md must declare closure stop gates (user-confirmation-ux §8). */
const PHASE_CLOSURE_LINT: Array<{ suffix: string; requiredIds: string[] }> = [
  { suffix: 'feature/spec/SKILL.md', requiredIds: ['phase.next_step', '闭环停等'] },
  { suffix: 'feature/plan/SKILL.md', requiredIds: ['plan.ok_to_code', 'phase.next_step', '闭环停等'] },
  { suffix: 'feature/coding/SKILL.md', requiredIds: ['coding.ok_to_review', 'phase.next_step', '闭环停等'] },
  { suffix: 'feature/code-review/SKILL.md', requiredIds: ['review.ok_to_ut', 'phase.next_step', '闭环停等'] },
  { suffix: 'feature/business-ut/SKILL.md', requiredIds: ['ut.ok_to_testing', 'phase.next_step', '闭环停等'] },
  { suffix: 'feature/device-testing/SKILL.md', requiredIds: ['phase.next_step', '闭环停等'] },
];

function lintPhaseClosureGates(rel: string, content: string): CheckResult[] {
  const results: CheckResult[] = [];
  for (const { suffix, requiredIds } of PHASE_CLOSURE_LINT) {
    if (!rel.endsWith(suffix)) continue;
    for (const token of requiredIds) {
      if (!content.includes(token)) {
        results.push(blocker(
          'phase_closure_gate_missing',
          `${rel} 缺少阶段闭环停等标记 \`${token}\`（user-confirmation-ux §8）`,
          [rel],
          '在阶段闭环判定段补充 phase.next_step / *.ok_to_* BLOCKER 停等',
        ));
      }
    }
    if (/阶段完成，可进入 Skill/.test(content)) {
      results.push(blocker(
        'phase_closure_autopilot_wording',
        `${rel} 闭环段仍用「可进入 Skill」易误导 autopilot；须改为「具备…资格」+ 停等`,
        [rel],
      ));
    }
  }
  return results;
}

function blocker(
  id: string,
  details: string,
  files: string[],
  suggestion?: string,
): CheckResult {
  return {
    id,
    category: 'structure',
    description: `confirmation UX: ${id}`,
    severity: 'BLOCKER',
    status: 'FAIL',
    details,
    affected_files: files,
    suggestion,
  };
}

function warn(id: string, details: string, files: string[]): CheckResult {
  return {
    id,
    category: 'structure',
    description: `confirmation UX: ${id}`,
    severity: 'MINOR',
    status: 'WARN',
    details,
    affected_files: files,
  };
}

export function runConfirmationUxChecks(ctx: CheckContext): CheckResult[] {
  let extensionSkillDirs: string[] = [];
  try {
    const cfg = loadFrameworkConfig(ctx.projectRoot);
    const extDir = cfg.paths?.extension_dir;
    if (typeof extDir === 'string' && extDir.trim()) {
      extensionSkillDirs.push(path.join(extDir.trim(), 'skills'));
    }
  } catch {
    // no config — skip extension scan
  }
  const raw = lintConfirmationUx({
    projectRoot: ctx.projectRoot,
    extensionSkillDirs,
    layout: repoLayoutFromContext(ctx),
  });
  const pass: CheckResult = {
    id: 'confirmation_ux_lint',
    category: 'structure',
    description: 'Skill 确认 UX 静态 lint（user-confirmation-ux SSOT）',
    severity: 'BLOCKER',
    status: 'PASS',
    details: '所有扫描文件符合 progressive enhancement 规则',
  };
  const fails = raw.filter(r => r.status === 'FAIL');
  if (fails.length === 0) {
    const warns = raw.filter(r => r.status === 'WARN');
    if (warns.length === 0) return [pass];
    return [pass, ...warns];
  }
  return fails;
}

export default { runConfirmationUxChecks, lintConfirmationUx };
