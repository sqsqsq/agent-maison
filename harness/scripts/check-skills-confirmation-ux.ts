// ============================================================================
// check-skills-confirmation-ux.ts — Skill 文案确认 UX 静态 lint
// ============================================================================
// 只扫描 Markdown 指令质量，不验证运行时 agent 是否调用了 AskQuestion。
// 由 check-docs.ts 在 docs phase 调用；单元测试见 confirmation-ux.unit.test.ts
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';

import type { CheckContext, CheckResult } from './utils/types';
import { loadFrameworkConfig } from '../config';

const SSOT_REL = 'framework/skills/reference/user-confirmation-ux.md';
const REGISTRY_REL = 'framework/skills/reference/confirmation-registry.yaml';

const SCAN_GLOBS = [
  'framework/skills',
  'framework/profiles',
] as const;

const CLAUDE_TEMPLATES_REL = 'framework/agents/claude/templates';

const CLAUDE_WIDGET_OPTION_FILES = [
  'rules/widget-options/index.md',
  'rules/widget-options/phase-next-step-options.md',
  'rules/widget-options/skill0-catalog-options.md',
  'rules/widget-options/skill1-prd-options.md',
  'rules/widget-options/skill2-design-options.md',
  'rules/widget-options/skill3-coding-options.md',
  'rules/widget-options/skill4-review-options.md',
  'rules/widget-options/skill5-ut-options.md',
  'rules/widget-options/skill6-testing-options.md',
] as const;

const CLAUDE_SLASH_WIDGET_COMMANDS = [
  'commands/prd-design.md',
  'commands/requirement-design.md',
  'commands/coding.md',
  'commands/code-review.md',
  'commands/business-ut.md',
  'commands/device-testing.md',
  'commands/catalog-bootstrap.md',
  'commands/glossary-bootstrap.md',
] as const;

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
}

export function lintConfirmationUx(options: ConfirmationUxLintOptions): CheckResult[] {
  const { projectRoot } = options;
  const results: CheckResult[] = [];

  const ssotPath = path.join(projectRoot, SSOT_REL);
  const registryPath = path.join(projectRoot, REGISTRY_REL);

  if (!fs.existsSync(ssotPath)) {
    results.push(blocker('ssot_exists', 'user-confirmation-ux.md 缺失', [SSOT_REL]));
    return results;
  }
  if (!fs.existsSync(registryPath)) {
    results.push(blocker('registry_exists', 'confirmation-registry.yaml 缺失', [REGISTRY_REL]));
    return results;
  }

  const registryText = fs.readFileSync(registryPath, 'utf-8');
  const registryIds = [...registryText.matchAll(/^\s*-\s+id:\s+([a-z0-9_.]+)/gm)].map(m => m[1]);

  const files: string[] = [];
  for (const sub of SCAN_GLOBS) {
    files.push(...listMarkdownFiles(projectRoot, sub));
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

  // registry skill folders exist
  const skillDirs = new Set<string>();
  for (const m of registryText.matchAll(/skill:\s+"([^"]+)"/g)) {
    skillDirs.add(m[1]);
  }
  for (const skill of skillDirs) {
    const dir = path.join(projectRoot, 'framework/skills', skill, 'SKILL.md');
    if (!fs.existsSync(dir)) {
      results.push(warn('registry_skill_path', `registry 引用 skill ${skill} 但目录不存在`, [REGISTRY_REL]));
    }
  }

  if (registryIds.length < 20) {
    results.push(warn('registry_size', `confirmation-registry 仅 ${registryIds.length} 条，预期 ≥20`, [REGISTRY_REL]));
  }

  results.push(...lintClaudeConfirmationTemplates(projectRoot));

  return results;
}

function lintClaudeConfirmationTemplates(projectRoot: string): CheckResult[] {
  const results: CheckResult[] = [];
  const base = path.join(projectRoot, CLAUDE_TEMPLATES_REL);
  if (!fs.existsSync(base)) {
    return results;
  }

  for (const rel of CLAUDE_WIDGET_OPTION_FILES) {
    const abs = path.join(base, rel);
    const posix = `${CLAUDE_TEMPLATES_REL}/${rel}`.replace(/\\/g, '/');
    if (!fs.existsSync(abs)) {
      results.push(blocker(
        'claude_widget_options_missing',
        `Claude widget-options SSOT 缺失: ${posix}`,
        [posix],
      ));
    }
  }

  const confirmUxPath = path.join(base, 'rules/confirmation-ux.md');
  const confirmUxRel = `${CLAUDE_TEMPLATES_REL}/rules/confirmation-ux.md`;
  if (!fs.existsSync(confirmUxPath)) {
    results.push(blocker(
      'claude_confirmation_ux_missing',
      'Claude confirmation-ux.md 模板缺失',
      [confirmUxRel],
    ));
    return results;
  }

  const confirmUx = fs.readFileSync(confirmUxPath, 'utf-8');
  if (/非 Skill 逐步 BLOCKER/.test(confirmUx) || /\*\*SHOULD\*\*/.test(confirmUx)) {
    results.push(blocker(
      'claude_confirmation_ux_should_only',
      'confirmation-ux.md 仍为 SHOULD；须为 Claude 会话级 BLOCKER',
      [confirmUxRel],
    ));
  }
  if (!confirmUx.includes('AskUserQuestion')) {
    results.push(blocker(
      'claude_confirmation_ux_no_ask_user',
      'confirmation-ux.md 须声明 AskUserQuestion',
      [confirmUxRel],
    ));
  }
  if (!confirmUx.includes('widget-options/index.md')) {
    results.push(blocker(
      'claude_confirmation_ux_no_index',
      'confirmation-ux.md 须链 widget-options/index.md',
      [confirmUxRel],
    ));
  }
  if (!confirmUx.includes('../../framework/skills/reference/user-confirmation-ux.md')) {
    results.push(blocker(
      'claude_confirmation_ux_bad_ssot_link',
      'confirmation-ux.md SSOT 链接须为部署后路径 ../../framework/skills/reference/user-confirmation-ux.md',
      [confirmUxRel],
    ));
  }
  const adapterWidgetRelFromRules = '../../framework/skills/00-framework-init/templates/adapter-widget-options.md';
  if (!confirmUx.includes(adapterWidgetRelFromRules)) {
    results.push(blocker(
      'claude_confirmation_ux_bad_adapter_widget_link',
      `confirmation-ux.md init adapter 链接须为部署后路径 ${adapterWidgetRelFromRules}`,
      [confirmUxRel],
    ));
  }
  if (/\.\.\/\.\.\/\.\.\/skills\//.test(confirmUx)) {
    results.push(blocker(
      'claude_confirmation_ux_legacy_skills_link',
      'confirmation-ux.md 不得使用 ../../../skills/ 旧路径（缺 framework/ 段）',
      [confirmUxRel],
    ));
  }

  const widgetIndexPath = path.join(base, 'rules/widget-options/index.md');
  const widgetIndexRel = `${CLAUDE_TEMPLATES_REL}/rules/widget-options/index.md`;
  if (fs.existsSync(widgetIndexPath)) {
    const widgetIndex = fs.readFileSync(widgetIndexPath, 'utf-8');
    const adapterFromWidgetIndex = '../../../framework/skills/00-framework-init/templates/adapter-widget-options.md';
    if (!widgetIndex.includes(adapterFromWidgetIndex)) {
      results.push(blocker(
        'claude_widget_index_bad_adapter_link',
        `widget-options/index.md init 链接须为部署后路径 ${adapterFromWidgetIndex}`,
        [widgetIndexRel],
      ));
    }
    if (/\.\.\/\.\.\/\.\.\/\.\.\/skills\//.test(widgetIndex)) {
      results.push(blocker(
        'claude_widget_index_legacy_skills_link',
        'widget-options/index.md 不得使用 ../../../../skills/ 旧路径',
        [widgetIndexRel],
      ));
    }
  }

  for (const rel of CLAUDE_SLASH_WIDGET_COMMANDS) {
    const abs = path.join(base, rel);
    const posix = `${CLAUDE_TEMPLATES_REL}/${rel}`.replace(/\\/g, '/');
    if (!fs.existsSync(abs)) {
      results.push(blocker(
        'claude_slash_missing',
        `Claude slash 模板缺失: ${posix}`,
        [posix],
      ));
      continue;
    }
    const content = fs.readFileSync(abs, 'utf-8');
    if (!content.includes('AskUserQuestion') || !content.includes('BLOCKER')) {
      results.push(blocker(
        'claude_slash_no_widget_blocker',
        `${posix} 须含 AskUserQuestion Widget BLOCKER 段`,
        [posix],
      ));
    }
    if (!content.includes('../rules/widget-options/')) {
      results.push(blocker(
        'claude_slash_no_widget_options_ref',
        `${posix} 须链 ../rules/widget-options/ SSOT`,
        [posix],
      ));
    }
  }

  const initSlash = path.join(base, 'commands/framework-init.md');
  if (fs.existsSync(initSlash)) {
    const initContent = fs.readFileSync(initSlash, 'utf-8');
    if (initContent.includes('../rules/widget-options/skill1-prd-options.md')) {
      results.push(blocker(
        'claude_init_slash_polluted',
        'framework-init.md 不得注入 Skills 1–6 widget-options（init 自有 adapter-widget-options）',
        [`${CLAUDE_TEMPLATES_REL}/commands/framework-init.md`],
      ));
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
    // Skill 00 §0.3.4 legacy: must also link SSOT after migration
    if (rel === 'framework/skills/00-framework-init/SKILL.md' && content.includes('§0.3.4')) {
      if (!content.includes('user-confirmation-ux.md')) {
        results.push(blocker(
          'confirm_requires_ssot_link',
          `${rel} 含 §0.3.4 确认流但未链 user-confirmation-ux.md`,
          [rel],
        ));
      }
    } else if (rel.endsWith('SKILL.md') || rel.endsWith('profile-addendum.md')) {
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

  if (rel.includes('1-prd-design/SKILL.md') && needsConfirmUx) {
    if (!/\[x\]/.test(content) || !content.includes('术语映射')) {
      results.push(blocker(
        'artifact_checkbox_unchanged',
        'Skill 1 须保留 PRD 术语表 [x] BLOCKER',
        [rel],
      ));
    }
  }

  results.push(...lintPhaseClosureGates(rel, content));

  return results;
}

/** Feature phase SKILL.md must declare closure stop gates (user-confirmation-ux §8). */
const PHASE_CLOSURE_LINT: Array<{ suffix: string; requiredIds: string[] }> = [
  { suffix: '1-prd-design/SKILL.md', requiredIds: ['phase.next_step', '闭环停等'] },
  { suffix: '2-requirement-design/SKILL.md', requiredIds: ['design.ok_to_code', 'phase.next_step', '闭环停等'] },
  { suffix: '3-coding/SKILL.md', requiredIds: ['coding.ok_to_review', 'phase.next_step', '闭环停等'] },
  { suffix: '4-code-review/SKILL.md', requiredIds: ['review.ok_to_ut', 'phase.next_step', '闭环停等'] },
  { suffix: '5-business-ut/SKILL.md', requiredIds: ['ut.ok_to_testing', 'phase.next_step', '闭环停等'] },
  { suffix: '6-device-testing/SKILL.md', requiredIds: ['phase.next_step', '闭环停等'] },
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
