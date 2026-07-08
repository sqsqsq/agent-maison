// ============================================================================
// entry-template-budget — templates/AGENTS.md.template 行数与骨架内容门禁（C3-task4）
// ============================================================================

import * as fs from 'fs';

import { frameworkAbs, type RepoLayout } from '../../repo-layout';

export interface EntryTemplateBudgetRule {
  max_lines?: number;
  required_markers?: string[];
}

export interface EntryTemplateBudgetReport {
  path: string;
  exists: boolean;
  lines: number;
  maxLines: number;
  missingMarkers: string[];
}

const DEFAULT_MAX_LINES = 120;

function countLines(text: string): number {
  const normalized = text.replace(/\r\n?/g, '\n');
  const trimmed = normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized;
  if (trimmed.length === 0) return 0;
  return trimmed.split('\n').length;
}

export function checkEntryTemplateBudget(
  layout: RepoLayout,
  rule: EntryTemplateBudgetRule,
): EntryTemplateBudgetReport {
  const abs = frameworkAbs(layout, 'templates', 'AGENTS.md.template');
  const maxLines = rule.max_lines ?? DEFAULT_MAX_LINES;
  const requiredMarkers = rule.required_markers ?? [];
  if (!fs.existsSync(abs)) {
    return { path: abs, exists: false, lines: 0, maxLines, missingMarkers: requiredMarkers };
  }
  const text = fs.readFileSync(abs, 'utf-8');
  const lines = countLines(text);
  const missingMarkers = requiredMarkers.filter(m => !text.includes(m));
  return { path: abs, exists: true, lines, maxLines, missingMarkers };
}
