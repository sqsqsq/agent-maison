// ============================================================================
// Context Exploration Gate — 结构化摘要校验（profile-neutral）
// ============================================================================
// 产物路径：<receipt_dir_pattern>/<phase>/context-exploration.md
// 与 phase-completion-receipt.md 同目录，见 config.receiptDirPath。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { receiptDirPath } from '../../config';
import { CheckResult } from './types';
import { fillCompatMessage, SUGGESTION_CONTEXT_EXPLORATION_MISSING } from '../../compat-messages';

export type ContextExplorationPhase = 'prd' | 'design' | 'coding' | 'review' | 'ut';

/** 各阶段 frontmatter.key_inputs_read 中须能覆盖到的子串（小写匹配，profile-neutral） */
export const CONTEXT_EXPLORATION_PHASE_INPUT_SNIPPETS: Record<ContextExplorationPhase, string[]> = {
  prd: ['glossary', 'module-catalog', 'architecture'],
  design: ['prd', 'acceptance', 'architecture', 'module-catalog', 'framework.config'],
  coding: ['design', 'contract', 'acceptance'],
  review: ['contract', 'acceptance', 'coding-rule', 'design'],
  ut: ['acceptance', 'contract', 'prd', 'design'],
};

export interface ContextExplorationFrontmatter {
  schema_version?: string;
  feature?: string;
  phase?: string;
  ready_to_produce?: boolean;
  has_blocker_coverage_risk?: boolean;
  key_inputs_read?: unknown;
  subagents_used?: unknown;
}

function parseContextExploration(
  raw: string,
): { fm: ContextExplorationFrontmatter; error?: string } {
  const trimmed = raw.replace(/^\uFEFF/, '');
  const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(trimmed);
  if (!fmMatch) {
    return { fm: {}, error: '缺少 YAML frontmatter（必须以 --- 开头）' };
  }
  try {
    const data = YAML.parse(fmMatch[1]) as ContextExplorationFrontmatter | null;
    if (!data || typeof data !== 'object') {
      return { fm: {}, error: 'frontmatter 必须是对象' };
    }
    return { fm: data };
  } catch (e) {
    return { fm: {}, error: (e as Error).message };
  }
}

function flattenKeyInputs(keyInputs: unknown): string {
  if (!keyInputs) return '';
  if (Array.isArray(keyInputs)) {
    return keyInputs
      .map((item: unknown) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object' && 'path' in (item as Record<string, unknown>)) {
          return String((item as Record<string, unknown>).path ?? '');
        }
        return JSON.stringify(item);
      })
      .join('\n')
      .toLowerCase();
  }
  return String(keyInputs).toLowerCase();
}

/**
 * 校验 context-exploration.md：存在、frontmatter 合法、ready_to_produce、最低输入覆盖。
 */
export function checkContextExplorationArtifact(
  projectRoot: string,
  feature: string,
  phase: ContextExplorationPhase,
): CheckResult[] {
  const abs = path.join(receiptDirPath(projectRoot, feature, phase), 'context-exploration.md');
  const relFromRoot = path.relative(projectRoot, abs).replace(/\\/g, '/');

  if (!fs.existsSync(abs)) {
    return [
      {
        id: 'context_exploration_present',
        category: 'structure',
        description:
          'Context Exploration Gate：须在阶段目录写入 context-exploration.md（与 phase-completion-receipt 同目录）。',
        severity: 'BLOCKER',
        status: 'FAIL',
        details: `缺失：${relFromRoot}`,
        suggestion: fillCompatMessage(SUGGESTION_CONTEXT_EXPLORATION_MISSING, feature, phase),
        affected_files: [relFromRoot],
      },
    ];
  }

  const raw = fs.readFileSync(abs, 'utf-8');
  const { fm, error } = parseContextExploration(raw);

  if (error) {
    return [
      {
        id: 'context_exploration_parse',
        category: 'structure',
        description: 'context-exploration.md frontmatter 可解析',
        severity: 'BLOCKER',
        status: 'FAIL',
        details: error,
        affected_files: [relFromRoot],
      },
    ];
  }

  const results: CheckResult[] = [];

  if (fm.schema_version !== '1.0.0') {
    results.push({
      id: 'context_exploration_schema_version',
      category: 'structure',
      description: 'context-exploration schema_version 须为 1.0.0',
      severity: 'BLOCKER',
      status: 'FAIL',
      details: `当前 schema_version=${fm.schema_version ?? '<missing>'}`,
      affected_files: [relFromRoot],
    });
  }

  if (fm.feature !== feature) {
    results.push({
      id: 'context_exploration_feature_match',
      category: 'structure',
      description: 'context-exploration frontmatter.feature 须与 harness --feature 一致',
      severity: 'BLOCKER',
      status: 'FAIL',
      details: `frontmatter.feature="${fm.feature ?? ''}"，期望 "${feature}"`,
      affected_files: [relFromRoot],
    });
  }

  if (fm.phase !== phase) {
    results.push({
      id: 'context_exploration_phase_match',
      category: 'structure',
      description: 'context-exploration frontmatter.phase 须与当前阶段一致',
      severity: 'BLOCKER',
      status: 'FAIL',
      details: `frontmatter.phase="${fm.phase ?? ''}"，期望 "${phase}"`,
      affected_files: [relFromRoot],
    });
  }

  if (fm.ready_to_produce !== true) {
    results.push({
      id: 'context_exploration_ready',
      category: 'structure',
      description: 'context-exploration ready_to_produce 须为 true 方可进入本阶段主产出',
      severity: 'BLOCKER',
      status: 'FAIL',
      details: `ready_to_produce=${fm.ready_to_produce ?? '<missing>'}`,
      suggestion: '补齐探索项或提高覆盖后再置为 true；存在未解决 BLOCKER 级覆盖风险时不得宣称可产出。',
      affected_files: [relFromRoot],
    });
  }

  if (fm.has_blocker_coverage_risk === true) {
    results.push({
      id: 'context_exploration_blocker_risk',
      category: 'structure',
      description: 'context-exploration 存在未解决的 BLOCKER 级覆盖风险时不得结束 harness',
      severity: 'BLOCKER',
      status: 'FAIL',
      details: 'has_blocker_coverage_risk=true',
      affected_files: [relFromRoot],
    });
  }

  const haystack = flattenKeyInputs(fm.key_inputs_read);
  const required = CONTEXT_EXPLORATION_PHASE_INPUT_SNIPPETS[phase];
  const missing = required.filter(sub => !haystack.includes(sub.toLowerCase()));
  if (missing.length > 0) {
    results.push({
      id: 'context_exploration_inputs_coverage',
      category: 'structure',
      description:
        'context-exploration key_inputs_read 须覆盖本阶段最低输入（路径或说明中含下列关键词之一）',
      severity: 'BLOCKER',
      status: 'FAIL',
      details: `缺少可匹配项：${missing.join('、')}（在 key_inputs_read 中提供对应路径或条目即可）`,
      affected_files: [relFromRoot],
    });
  }

  if (results.length === 0) {
    results.push({
      id: 'context_exploration_present',
      category: 'structure',
      description: 'Context Exploration Gate 摘要已落盘且字段合规',
      severity: 'BLOCKER',
      status: 'PASS',
      details: relFromRoot,
    });
  }

  return results;
}
