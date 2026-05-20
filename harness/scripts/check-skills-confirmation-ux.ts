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
