// ============================================================================
// Context Exploration Gate — structured summary checks (profile-neutral + 1.1.0 thresholds)
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { receiptDirPath } from '../../config';
import { CheckResult } from './types';
import type { ExplorationThresholds, PhaseRuleSpec } from './types';
import { fillCompatMessage, SUGGESTION_CONTEXT_EXPLORATION_MISSING } from '../../compat-messages';
import { LEGACY_EXPLORATION_PHASES } from './runtime-policy';
import { validateProjectRelativePath } from './project-relative-path';

export type ContextExplorationPhase = string;

/** legacy exploration-snippets.yaml phase keys（≥2 minor 窗口 fallback） */
const LEGACY_EXPLORATION_SNIPPET_PHASE_KEYS: Partial<Record<ContextExplorationPhase, string>> = {
  spec: 'prd',
  plan: 'design',
};

export const CONTEXT_EXPLORATION_SCHEMA_VERSIONS = ['1.0.0', '1.1.0'] as const;
export type ContextExplorationSchemaVersion = (typeof CONTEXT_EXPLORATION_SCHEMA_VERSIONS)[number];

/** 各阶段 frontmatter.key_inputs_read 中须能覆盖到的子串（小写匹配，profile-neutral） */
export const CONTEXT_EXPLORATION_PHASE_INPUT_SNIPPETS: Record<ContextExplorationPhase, string[]> = {
  spec: ['glossary', 'module-catalog', 'architecture'],
  plan: ['spec', 'acceptance', 'architecture', 'module-catalog', 'framework.config'],
  coding: ['plan', 'contract', 'acceptance'],
  review: ['contract', 'acceptance', 'coding-rule', 'plan'],
  ut: ['acceptance', 'contract', 'spec', 'plan'],
};

/** schema 1.1.0 且 phase-rules 未声明时的 per-phase 默认阈值 */
export const DEFAULT_EXPLORATION_THRESHOLDS: Record<ContextExplorationPhase, ExplorationThresholds> = {
  spec: {
    require_subagent_when_scope_gte: 3,
    exploration_mode_allowed: ['subagent', 'sequential', 'minimal'],
  },
  plan: {
    require_subagent_when_scope_gte: 2,
    exploration_mode_allowed: ['subagent', 'sequential'],
  },
  coding: {
    require_subagent_when_contract_files_gt: 5,
    exploration_mode_allowed: ['subagent', 'sequential'],
  },
  review: {
    require_subagent_when_review_files_gt: 8,
    exploration_mode_allowed: ['subagent', 'sequential'],
  },
  ut: {
    require_subagent_when_use_cases_gt: 2,
    exploration_mode_allowed: ['subagent', 'sequential'],
  },
};

export interface ContextExplorationFrontmatter {
  schema_version?: string;
  feature?: string;
  phase?: string;
  ready_to_produce?: boolean;
  has_blocker_coverage_risk?: boolean;
  key_inputs_read?: unknown;
  subagents_used?: unknown;
  searches_performed_estimate?: number;
  files_inspected_count?: number;
  source_code_paths?: unknown;
  exploration_mode?: string;
  decisions_unlocked?: unknown;
  legacy_backfill?: boolean;
  change_intent?: unknown;
  estimated_loc_delta?: unknown;
  touches_layers?: unknown;
  adds_new_exports?: unknown;
  single_function_scope?: unknown;
}

export interface ContextExplorationCheckOptions {
  /** context-facts supplies its already parsed current-phase additions; no reverse import. */
  deltaSourcePaths?: readonly string[];
  /** Only the facts establishing call checks the recorded exploration mode. */
  checkExplorationMode?: boolean;
  goalAttemptId?: string;
  request?: import('./capability-resolution-entry-input').PreparedRequest;
  factsContext?: import('./context-facts').FactsInvocationContext;
  resolvedInputs?: import('./capability-resolution').ResolvedPhaseInputs;
  phaseRule?: PhaseRuleSpec;
  profileName?: string;
  frameworkRoot?: string;
}

/** Historical review consumes the selected commit; all other invocations consume disk. */
export function assertFactsSourceReadable(projectRoot: string, source: string, options?: ContextExplorationCheckOptions): void {
  const safe = validateProjectRelativePath(projectRoot, source, 'facts source');
  const request = options?.request;
  if (request?.phase === 'review' && request.baseline.head !== 'WORKTREE'
    && request.sourceContents.some(file => file.path === safe)
    && request.bindings.some(binding => binding.path === safe && binding.exists && binding.sha256)) return;
  const absolute = path.resolve(projectRoot, safe);
  if (!fs.statSync(absolute).isFile()) throw new Error('not a file');
  fs.accessSync(absolute, fs.constants.R_OK);
}

interface ProfileExplorationSnippetsFile {
  schema_version?: string;
  phases?: Record<string, { extra_snippets?: string[] }>;
}

/** 导出供 context-facts.ts（C4）复用——facts.md frontmatter 形态与 per-phase 文件兼容子集。 */
export function parseContextExploration(
  raw: string,
): { fm: ContextExplorationFrontmatter; body: string; error?: string } {
  const trimmed = raw.replace(/^\uFEFF/, '');
  const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(trimmed);
  if (!fmMatch) {
    return { fm: {}, body: trimmed, error: '缺少 YAML frontmatter（必须以 --- 开头）' };
  }
  try {
    const data = YAML.parse(fmMatch[1]) as ContextExplorationFrontmatter | null;
    if (!data || typeof data !== 'object') {
      return { fm: {}, body: trimmed.slice(fmMatch[0].length), error: 'frontmatter 必须是对象' };
    }
    return { fm: data, body: trimmed.slice(fmMatch[0].length) };
  } catch (e) {
    return { fm: {}, body: trimmed, error: (e as Error).message };
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

function normalizeStringArray(v: unknown): string[] {
  if (v === null || v === undefined) return [];
  if (Array.isArray(v)) {
    return v.map(x => String(x).trim()).filter(Boolean);
  }
  if (typeof v === 'string') {
    const t = v.trim();
    return t ? [t] : [];
  }
  return [];
}

/**
 * 去重（路径分隔符归一 + `path.posix.normalize` 折叠 `a/../a`、`a//b`、`./` 等变体后按值
 * 去重，保序）——防止把同一条 source_code_paths 重复写多遍（或写成路径变体）来凑
 * min_source_code_paths 数量阈值（codex review 抓到的真实绕过口子：阈值原先直接用数组
 * 长度，重复 5 次同一路径也能过 ">=5"；`path.posix.normalize` 折叠是同批 review 的
 * 后续加固建议，一并做掉，防止只做字符串级归一漏掉 `a/../a` 这类变体）。
 */
function dedupeNormalizedPaths(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = path.posix.normalize(item.replace(/\\/g, '/'));
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/** 有 context-exploration.md 门禁的 phase（testing 无——靠 trace；SSOT = runtime-policy，C0 收编）。 */
const CONTEXT_EXPLORATION_PHASES = new Set<string>(LEGACY_EXPLORATION_PHASES);
export function isContextExplorationPhase(phase: string): phase is ContextExplorationPhase {
  return CONTEXT_EXPLORATION_PHASES.has(phase);
}

export interface ContextExplorationInspection {
  /** 探索是否已完成（可进入主产出）。 */
  readyToProduce: boolean;
  /** frontmatter.source_code_paths（已检视源文件声明，规范化后）。 */
  sourceCodePaths: string[];
  filesInspectedCount: number | null;
  /** context-exploration.md 自身的 mtime（用于判断是否本 run 产出）。 */
  mtimeMs: number | null;
  absPath: string;
}

/**
 * 读取 context-exploration.md 的探索进度（P2 断点续跑派生 skip-list 用）。
 * 文件不存在/解析失败 → null / 空。只读不校验（校验归 checkContextExplorationArtifact）。
 */
export function readContextExplorationInspection(
  projectRoot: string,
  feature: string,
  phase: ContextExplorationPhase,
): ContextExplorationInspection | null {
  const abs = path.join(receiptDirPath(projectRoot, feature, phase), 'context-exploration.md');
  if (!fs.existsSync(abs)) return null;
  let raw: string;
  let mtimeMs: number | null = null;
  try {
    raw = fs.readFileSync(abs, 'utf-8');
    mtimeMs = fs.statSync(abs).mtimeMs;
  } catch {
    return null;
  }
  const { fm, error } = parseContextExploration(raw);
  if (error) {
    return { readyToProduce: false, sourceCodePaths: [], filesInspectedCount: null, mtimeMs, absPath: abs };
  }
  return {
    readyToProduce: fm.ready_to_produce === true,
    sourceCodePaths: normalizeStringArray(fm.source_code_paths),
    filesInspectedCount:
      typeof fm.files_inspected_count === 'number' ? fm.files_inspected_count : null,
    mtimeMs,
    absPath: abs,
  };
}

export function resolveThresholds(
  phase: ContextExplorationPhase,
  phaseRule?: PhaseRuleSpec,
): ExplorationThresholds {
  const defaults = DEFAULT_EXPLORATION_THRESHOLDS[phase] ?? {
    min_files_inspected: 1, min_source_code_paths: 1, min_searches: 1, min_code_facts: 1,
  };
  const fromRule = phaseRule?.exploration_thresholds ?? {};
  return { ...defaults, ...fromRule };
}

/** 读取 profile 级 exploration-snippets overlay（可选） */
export function loadProfileExplorationSnippets(
  profileName: string,
  phase: ContextExplorationPhase,
): string[] {
  const filePath = path.join(
    __dirname,
    '..',
    '..',
    '..',
    'profiles',
    profileName,
    'harness',
    'exploration-snippets.yaml',
  );
  if (!fs.existsSync(filePath)) return [];
  try {
    const parsed = YAML.parse(fs.readFileSync(filePath, 'utf-8')) as ProfileExplorationSnippetsFile;
    const phases = parsed.phases;
    let snippets = phases?.[phase]?.extra_snippets;
    if (!snippets?.length) {
      const legacyKey = LEGACY_EXPLORATION_SNIPPET_PHASE_KEYS[phase];
      if (legacyKey) {
        snippets = phases?.[legacyKey as keyof typeof phases]?.extra_snippets;
      }
    }
    return (snippets ?? []).map(s => String(s).trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export function resolvePhaseInputSnippets(
  phase: ContextExplorationPhase,
  profileName: string,
  phaseRule?: PhaseRuleSpec,
): string[] {
  const base = CONTEXT_EXPLORATION_PHASE_INPUT_SNIPPETS[phase] ?? [];
  const profileExtra = loadProfileExplorationSnippets(profileName, phase);
  const ruleExtra = phaseRule?.exploration_thresholds?.phase_input_snippets_extra ?? [];
  const merged = [...base, ...profileExtra, ...ruleExtra];
  const seen = new Set<string>();
  return merged.filter(s => {
    const key = s.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function countCodeFactsRows(body: string): number {
  const sectionMatch = /##\s*Code Facts[^\n]*\n([\s\S]*?)(?=\n##\s|$)/i.exec(body);
  if (!sectionMatch) return 0;
  const section = sectionMatch[1];
  const lines = section.split('\n');
  let count = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) continue;
    if (/^\|\s*[-:]+\s*\|/.test(trimmed)) continue;
    if (/路径/.test(trimmed) && /事实/.test(trimmed)) continue;
    if (trimmed === '| ... | ... | ... |') continue;
    if (trimmed.includes('...')) continue;
    count++;
  }
  return count;
}

/** 导出供 context-facts.ts（C4）复用于 facts.md 建立阶段全量检查（无需 fm.phase）。 */
export function runQuantitativeChecks(
  projectRoot: string,
  feature: string | undefined,
  phase: ContextExplorationPhase,
  fm: ContextExplorationFrontmatter,
  body: string,
  relFromRoot: string,
  options?: ContextExplorationCheckOptions,
): CheckResult[] {
  const results: CheckResult[] = [];
  const sourcePaths = dedupeNormalizedPaths(normalizeStringArray(fm.source_code_paths));
  const decisions = normalizeStringArray(fm.decisions_unlocked);
  const missingOnDisk: string[] = [];
  const requiredSources = options?.factsContext?.baseline ? [] : sourcePaths;
  for (const rel of requiredSources) {
    try {
      assertFactsSourceReadable(projectRoot, rel, options);
    } catch { missingOnDisk.push(rel); }
  }
  if (missingOnDisk.length > 0) {
    results.push({
      id: 'context_exploration_source_code_paths_exist',
      category: 'structure',
      description: 'source_code_paths 中的路径须在仓库磁盘上存在',
      severity: 'BLOCKER',
      status: 'FAIL',
      details: `不存在：${missingOnDisk.slice(0, 8).join('、')}${missingOnDisk.length > 8 ? '…' : ''}`,
      suggestion:
        'source_code_paths 每项必须是**纯相对路径**（相对仓库根、磁盘上真实存在），' +
        '不要写成「路径 - 描述」「路径（原因）」等带附注的形式——附注会被当作路径的一部分导致存在性校验失败。' +
        '正确示例：`- src/main/ets/service/FooService.ets`；描述/原因请写在正文「已检视文件」表格。' +
        '若路径确实存在但仍报错，请核对相对根与大小写。',
      affected_files: [relFromRoot, ...missingOnDisk.slice(0, 5)],
    });
  }

  if (sourcePaths.length > 0 && countCodeFactsRows(body) === 0) {
    results.push({
      id: 'context_exploration_code_facts_min',
      category: 'structure',
      description: 'Code Facts 记录支撑决定的实际事实',
      severity: 'BLOCKER',
      status: 'FAIL',
      details: '已引用当前来源，但缺少来源所支持的具体事实及影响。',
      affected_files: [relFromRoot],
    });
  }

  if (decisions.length === 0) {
    results.push({
      id: 'context_exploration_decisions_unlocked',
      category: 'structure',
      description: 'decisions_unlocked 须非空（探索须显式解锁本阶段决策）',
      severity: 'BLOCKER',
      status: 'FAIL',
      details: 'decisions_unlocked 为空',
      affected_files: [relFromRoot],
    });
  }

  return results;
}

/**
 * 校验 context-exploration.md：存在、frontmatter 合法、ready_to_produce、最低输入覆盖。
 * 检查已记录的事实、实际决策与当前可读来源。
 */
export function checkContextExplorationArtifact(
  projectRoot: string,
  feature: string,
  phase: ContextExplorationPhase,
  options?: ContextExplorationCheckOptions,
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
        suggestion: fillCompatMessage(SUGGESTION_CONTEXT_EXPLORATION_MISSING, projectRoot, feature, phase),
        affected_files: [relFromRoot],
      },
    ];
  }

  const raw = fs.readFileSync(abs, 'utf-8');
  const { fm, body, error } = parseContextExploration(raw);

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
  const schemaVersion = fm.schema_version ?? '1.0.0';

  if (!CONTEXT_EXPLORATION_SCHEMA_VERSIONS.includes(schemaVersion as ContextExplorationSchemaVersion)) {
    results.push({
      id: 'context_exploration_schema_version',
      category: 'structure',
      description: `context-exploration schema_version 须为 ${CONTEXT_EXPLORATION_SCHEMA_VERSIONS.join(' 或 ')}`,
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

  if (schemaVersion === '1.1.0') results.push(...runQuantitativeChecks(projectRoot, feature, phase, fm, body, relFromRoot, options));

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
