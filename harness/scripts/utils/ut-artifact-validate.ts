/**
 * UT 产物格式预校验（供 validate-ut-artifact.ts CLI 与单元测试复用）。
 */
import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { detectRepoLayout } from '../../repo-layout';
import {
  collectMockPlanTypedIssues,
  parseMockPlanFile,
  parseTestabilityAuditFromText,
} from './ut-artifact-parse';

export interface ArtifactValidationIssue {
  field: string;
  message: string;
}

export interface ArtifactValidationResult {
  ok: boolean;
  errors: ArtifactValidationIssue[];
  warnings: ArtifactValidationIssue[];
}

const MARKDOWN_TABLE_RE = /^\s*\|[^\n]+\|\s*$/m;
const MARKDOWN_FENCE_RE = /```\s*ya?ml/i;

function err(field: string, message: string): ArtifactValidationIssue {
  return { field, message };
}

/**
 * 解析 --file 路径：优先 cwd；不存在时相对 project root（显式 --project-root 或自动推断）。
 */
export function resolveUtArtifactFilePath(fileArg: string, projectRootOpt?: string): string {
  const trimmed = fileArg.trim();
  if (!trimmed) return trimmed;
  if (path.isAbsolute(trimmed)) {
    return path.resolve(trimmed);
  }
  const cwdResolved = path.resolve(trimmed);
  if (fs.existsSync(cwdResolved)) {
    return cwdResolved;
  }
  let projectRoot: string;
  try {
    projectRoot = projectRootOpt?.trim()
      ? path.resolve(projectRootOpt.trim())
      : detectRepoLayout(path.join(__dirname, '..')).projectRoot;
  } catch {
    return cwdResolved;
  }
  return path.resolve(projectRoot, trimmed);
}

export function validateTestabilityAuditContent(text: string, filePath?: string): ArtifactValidationResult {
  const errors: ArtifactValidationIssue[] = [];
  const warnings: ArtifactValidationIssue[] = [];
  const label = filePath ?? 'testability-audit.md';

  if (MARKDOWN_TABLE_RE.test(text)) {
    errors.push(
      err('format', `${label} 含 Markdown 表格；须改为 fenced yaml 块且根字段 records[]`),
    );
  }

  const records = parseTestabilityAuditFromText(text);
  if (records.length === 0) {
    errors.push(err('records', `${label} 未解析到任何 records[] 条目（需 fenced yaml 或纯 YAML）`));
  }

  for (const r of records) {
    if (!r.acceptance_id?.trim()) {
      errors.push(err('acceptance_id', '存在空的 acceptance_id'));
    } else if (/[-][a-z]$/.test(r.acceptance_id)) {
      warnings.push(
        err('acceptance_id', `${r.acceptance_id} 疑似子编号（如 -a）；须与 acceptance.yaml 已有 ID 一致`),
      );
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

export function validateTestabilityAuditFile(filePath: string): ArtifactValidationResult {
  if (!fs.existsSync(filePath)) {
    return {
      ok: false,
      errors: [err('file', `文件不存在：${filePath}`)],
      warnings: [],
    };
  }
  const text = fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '');
  return validateTestabilityAuditContent(text, filePath);
}

export function validateMockPlanContent(text: string, filePath?: string): ArtifactValidationResult {
  const errors: ArtifactValidationIssue[] = [];
  const warnings: ArtifactValidationIssue[] = [];
  const label = filePath ?? 'mock-plan.yaml';

  if (MARKDOWN_FENCE_RE.test(text)) {
    errors.push(err('format', `${label} 含 markdown 围栏；须为纯 YAML 文件`));
  }

  let plan: ReturnType<typeof parseMockPlanFile> = null;
  try {
    const doc = YAML.parse(text.replace(/^\uFEFF/, ''));
    if (doc && typeof doc === 'object') {
      plan = doc as ReturnType<typeof parseMockPlanFile>;
    }
  } catch (e) {
    errors.push(err('yaml', `YAML 解析失败：${(e as Error).message}`));
  }

  if (plan) {
    const typed = collectMockPlanTypedIssues(plan);
    for (const msg of typed) {
      errors.push(err('presets', msg));
    }
    if (!Array.isArray(plan.spies) || plan.spies.length === 0) {
      warnings.push(err('spies', 'spies[] 为空或未声明'));
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

export function validateMockPlanFile(filePath: string): ArtifactValidationResult {
  if (!fs.existsSync(filePath)) {
    return {
      ok: false,
      errors: [err('file', `文件不存在：${filePath}`)],
      warnings: [],
    };
  }
  const text = fs.readFileSync(filePath, 'utf-8');
  const result = validateMockPlanContent(text, filePath);
  if (!parseMockPlanFile(filePath) && result.errors.every(e => e.field !== 'yaml')) {
    result.errors.push(err('parse', `${filePath} 无法解析为 mock-plan`));
    result.ok = false;
  }
  return result;
}
