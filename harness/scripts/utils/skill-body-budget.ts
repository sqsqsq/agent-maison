// ============================================================================
// skill-body-budget — skills/**/SKILL.md 主干行数预算门禁（C3-task4）
// ============================================================================
// 基准 150 行；per-skill 覆写只认 docs-rules.yaml 显式声明（附理由），不读代码硬编码表，
// 防止"改预算不改台账"的静默漂移。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';

import { frameworkAbs, frameworkPhysicalRelPath, type RepoLayout } from '../../repo-layout';

export interface SkillBudgetOverride {
  skill: string;
  budget: number;
  reason: string;
}

export interface SkillBodyBudgetRule {
  default_budget?: number;
  overrides?: SkillBudgetOverride[];
}

export interface SkillBudgetViolation {
  file: string;
  skillId: string;
  lines: number;
  budget: number;
}

const DEFAULT_BUDGET = 150;

function countLines(abs: string): number {
  const text = fs.readFileSync(abs, 'utf-8');
  const normalized = text.replace(/\r\n?/g, '\n');
  const trimmed = normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized;
  if (trimmed.length === 0) return 0;
  return trimmed.split('\n').length;
}

/** `skills/feature/business-ut/SKILL.md` → `business-ut`; `skills/project/framework-init/SKILL.md` → `framework-init`. */
export function resolveSkillIdFromSkillMdRel(rel: string): string {
  const norm = rel.replace(/\\/g, '/');
  const parts = norm.split('/').filter(Boolean);
  const idx = parts.lastIndexOf('SKILL.md');
  return idx >= 1 ? parts[idx - 1] : norm;
}

function collectSkillMdFiles(root: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(root)) return out;
  const walk = (dir: string) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === 'node_modules' || ent.name === '.git') continue;
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(abs);
        continue;
      }
      if (ent.name === 'SKILL.md') out.push(abs);
    }
  };
  walk(root);
  return out;
}

export function resolveSkillBudget(skillId: string, rule: SkillBodyBudgetRule): { budget: number; reason?: string } {
  const override = (rule.overrides ?? []).find(o => o.skill === skillId);
  if (override) return { budget: override.budget, reason: override.reason };
  return { budget: rule.default_budget ?? DEFAULT_BUDGET };
}

/** 只扫 skills/SKILL.md（非 reference/templates/examples 等条件加载/示意文件不受本预算约束）。 */
export function scanSkillBodyBudget(
  layout: RepoLayout,
  rule: SkillBodyBudgetRule,
): SkillBudgetViolation[] {
  const skillsRoot = frameworkAbs(layout, 'skills');
  const files = collectSkillMdFiles(skillsRoot);
  const violations: SkillBudgetViolation[] = [];
  for (const abs of files) {
    const rel = frameworkPhysicalRelPath(layout, path.relative(layout.frameworkRoot, abs).replace(/\\/g, '/'));
    const skillId = resolveSkillIdFromSkillMdRel(rel);
    const lines = countLines(abs);
    const { budget } = resolveSkillBudget(skillId, rule);
    if (lines > budget) {
      violations.push({ file: rel, skillId, lines, budget });
    }
  }
  return violations;
}
