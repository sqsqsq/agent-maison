/**
 * goal-checkpoint.ts — P2 phase 内断点续跑：从**可验证产物**派生断点，agent 永不自报。
 *
 * 核心：超时重试时，runner 读盘上 context-exploration.md（探索进度）+ partial 报告，
 * 派生"已检视且验真存在"的源文件 skip-list，让续跑跳过已探索文件、只补剩余，
 * 而非 fresh-context 从零重读。checkpoint 由 runner 对"盘上现实"快照（含 hash/mtime），
 * 结构上无法被 agent 伪造。
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as YAML from 'yaml';
import type { FeaturePhase } from './phase-transition-policy';
import {
  isContextExplorationPhase,
  parseContextExploration,
  readContextExplorationInspection,
  type ContextExplorationInspection,
} from './context-exploration';
import { isFactsEstablishingPhase, resolveFactsAbsPath } from './context-facts';
import { extractHeadings } from './markdown-parser';
import { relFeatureFile } from '../../config';

function normalizeStringArrayLocal(v: unknown): string[] {
  if (v === null || v === undefined) return [];
  if (Array.isArray(v)) return v.map(x => String(x).trim()).filter(Boolean);
  if (typeof v === 'string') {
    const t = v.trim();
    return t ? [t] : [];
  }
  return [];
}

/**
 * facts.md 优先的探索进度读取（C4）：存在 facts.md 时按其 frontmatter 派生
 * ContextExplorationInspection（建立阶段字段形态与旧 per-phase 文件兼容）；
 * facts.md 不存在则回落 readContextExplorationInspection（legacy 契约不变）。
 * delta 阶段（非建立阶段）不产出 skip-list（该阶段本身不做全量探索，
 * P2 断点续跑的价值有限，直接回落 legacy 判断更安全）。
 */
function readFactsOrLegacyInspection(
  projectRoot: string,
  feature: string,
  phase: FeaturePhase,
): ContextExplorationInspection | null {
  if (isFactsEstablishingPhase(phase)) {
    const abs = resolveFactsAbsPath(projectRoot, feature);
    if (fs.existsSync(abs)) {
      try {
        const raw = fs.readFileSync(abs, 'utf-8');
        const mtimeMs = fs.statSync(abs).mtimeMs;
        const { fm, error } = parseContextExploration(raw);
        if (error) {
          return { readyToProduce: false, sourceCodePaths: [], filesInspectedCount: null, mtimeMs, absPath: abs };
        }
        return {
          readyToProduce: fm.ready_to_produce === true,
          sourceCodePaths: normalizeStringArrayLocal(fm.source_code_paths),
          filesInspectedCount:
            typeof fm.files_inspected_count === 'number' ? fm.files_inspected_count : null,
          mtimeMs,
          absPath: abs,
        };
      } catch {
        return null;
      }
    }
  }
  if (!isContextExplorationPhase(phase)) return null;
  return readContextExplorationInspection(projectRoot, feature, phase);
}

function normalizeRel(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

/**
 * 加载 feature 的审查/契约范围（contracts.yaml > files，POSIX 归一）。
 * 用于给 skip-list 加"审查范围内"这一重验真。contracts.yaml 不存在（如 plan 早期
 * 尚未产出契约）→ undefined，调用方降级为仅 existsSync。
 */
export function loadContractsFileScope(projectRoot: string, feature: string): Set<string> | undefined {
  try {
    const abs = path.join(projectRoot, relFeatureFile(projectRoot, feature, 'contracts.yaml'));
    if (!fs.existsSync(abs)) return undefined;
    const doc = YAML.parse(fs.readFileSync(abs, 'utf-8')) as { files?: unknown } | null;
    const files = Array.isArray(doc?.files)
      ? doc!.files.map(x => normalizeRel(String(x))).filter(Boolean)
      : [];
    return files.length > 0 ? new Set(files) : undefined;
  } catch {
    return undefined;
  }
}

export type ResumeStage = 'exploring' | 'reporting';

export interface ResumeInspection {
  /** exploring=探索途中超时（还没写完 context-exploration）；reporting=探索完成、报告段超时。 */
  stage: ResumeStage;
  /** 已检视且**验真存在**的源文件（续跑 skip-list）。 */
  inspectedFiles: string[];
}

/**
 * 从盘上 context-exploration.md 派生续跑 skip-list。
 * 仅对有探索产物的 phase；文件须本 run 产出（mtime≥sinceMs，滤跨 run 陈旧）；
 * skip-list 仅取"已登记 ∩ 真实存在"文件（验真，防伪造）。无可用信息 → null。
 */
export function deriveResumeInspection(
  projectRoot: string,
  feature: string,
  phase: FeaturePhase,
  sinceMs: number,
): ResumeInspection | null {
  if (!isContextExplorationPhase(phase) && !isFactsEstablishingPhase(phase)) return null;
  const insp = readFactsOrLegacyInspection(projectRoot, feature, phase);
  if (!insp) return null;
  if (insp.mtimeMs === null || insp.mtimeMs < sinceMs) return null; // 陈旧/非本 run

  // 验真第 1 重：真实存在。
  const existing = insp.sourceCodePaths.filter(f => {
    try {
      return fs.existsSync(path.resolve(projectRoot, f));
    } catch {
      return false;
    }
  });
  // 验真第 2 重：审查/契约范围内（contracts.files 交集）。
  // 安全兜底：若 scope 过滤会把 skip-list 清空（多为路径格式不一致），退回仅 existsSync，
  // 避免 P2 静默失效（越界文件被 skip 无害，报告门禁仍强制范围内文件覆盖）。
  const scope = loadContractsFileScope(projectRoot, feature);
  let inspectedFiles = existing;
  if (scope) {
    const inScope = existing.filter(f => scope.has(normalizeRel(f)));
    if (inScope.length > 0) inspectedFiles = inScope;
  }

  if (inspectedFiles.length === 0) return null;
  return { stage: insp.readyToProduce ? 'reporting' : 'exploring', inspectedFiles };
}

/**
 * 从盘上 partial 报告派生"已写章节"（level-2 heading，runner 读现实，非 agent 自报）。
 * 取 artifactRelPaths 中第一个非 context-exploration 的 .md 报告的二级标题。
 */
export function deriveReportSections(projectRoot: string, artifactRelPaths: string[]): string[] {
  for (const rel of artifactRelPaths) {
    if (rel.endsWith('context-exploration.md') || !rel.endsWith('.md')) continue;
    try {
      const content = fs.readFileSync(path.resolve(projectRoot, rel), 'utf-8');
      const chapters = extractHeadings(content)
        .filter(h => h.level === 2)
        .map(h => h.text.trim())
        .filter(Boolean);
      if (chapters.length > 0) return chapters;
    } catch {
      /* 读不了就跳过 */
    }
  }
  return [];
}

/**
 * 构造注入 prompt 的续跑 skip-list 段（拼进 P1-B 的超时续作块）。
 * 探索段：列已检视文件、令勿重读、从剩余继续；
 * 报告段：探索已完成、直接续写；有已写章节则列出、只补未写章节（章节级断点）。
 */
export function buildResumeSkipLines(
  inspection: ResumeInspection,
  reportSectionsDone: string[] = [],
): string[] {
  if (inspection.stage === 'reporting') {
    const lines = [
      '',
      `探索已完成（context-exploration.md 已就绪，覆盖 ${inspection.inspectedFiles.length} 个源文件）。**勿重跑探索**——直接续写报告并重跑 harness。`,
    ];
    if (reportSectionsDone.length > 0) {
      lines.push(
        `报告已写章节：${reportSectionsDone.join('、')}。**只补未写章节**，勿重写已完成章节。`,
      );
    }
    return lines;
  }
  const shown = inspection.inspectedFiles.slice(0, 40);
  return [
    '',
    `以下 ${inspection.inspectedFiles.length} 个源文件上次已检视并登记进 context-exploration.md，**勿重复 Read**：`,
    ...shown.map(f => `  - ${f}`),
    ...(inspection.inspectedFiles.length > shown.length
      ? [`  - …还有 ${inspection.inspectedFiles.length - shown.length} 个（见 context-exploration.md）`]
      : []),
    '从**未登记**的待审文件继续探索，补全 context-exploration.md 后再产出报告。',
  ];
}

export interface CheckpointArtifactRef {
  path: string;
  sha256: string;
  mtime_ms: number;
}

export interface PhaseCheckpoint {
  phase: string;
  /** unknown = 该 phase 无探索产物（如 testing）或未产出。 */
  stage: ResumeStage | 'unknown';
  timed_out: boolean;
  inspected_file_count: number;
  inspected_files: string[];
  /** 已写报告章节（level-2 heading，runner 从 partial 报告派生）——报告段章节级断点。 */
  report_sections_done: string[];
  artifacts: CheckpointArtifactRef[];
  derived_at: string;
}

function hashArtifact(projectRoot: string, rel: string): CheckpointArtifactRef | null {
  try {
    const abs = path.resolve(projectRoot, rel);
    const buf = fs.readFileSync(abs);
    return {
      path: rel,
      sha256: crypto.createHash('sha256').update(buf).digest('hex'),
      mtime_ms: fs.statSync(abs).mtimeMs,
    };
  } catch {
    return null;
  }
}

/**
 * 每次 attempt 结束后由 runner 对"盘上现实"派生并落盘 checkpoint.json
 * （观测 + 跨进程 resume 用；agent 不写）。
 */
export function deriveAndWriteCheckpoint(opts: {
  projectRoot: string;
  reportDir: string;
  feature: string;
  phase: FeaturePhase;
  sinceMs: number;
  timedOut: boolean;
  artifactRelPaths: string[];
}): PhaseCheckpoint {
  const inspection = deriveResumeInspection(
    opts.projectRoot,
    opts.feature,
    opts.phase,
    opts.sinceMs,
  );
  const artifacts = opts.artifactRelPaths
    .map(rel => hashArtifact(opts.projectRoot, rel))
    .filter((x): x is CheckpointArtifactRef => x !== null);

  const checkpoint: PhaseCheckpoint = {
    phase: opts.phase,
    stage: inspection?.stage ?? 'unknown',
    timed_out: opts.timedOut,
    inspected_file_count: inspection?.inspectedFiles.length ?? 0,
    inspected_files: inspection?.inspectedFiles ?? [],
    report_sections_done: deriveReportSections(opts.projectRoot, opts.artifactRelPaths),
    artifacts,
    derived_at: new Date().toISOString(),
  };

  try {
    const dir = path.join(opts.projectRoot, opts.reportDir, 'phases', opts.phase);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'checkpoint.json'),
      JSON.stringify(checkpoint, null, 2) + '\n',
      'utf-8',
    );
  } catch {
    /* 落盘失败不阻断主流程——checkpoint 仅观测/续跑加速 */
  }
  return checkpoint;
}

/**
 * 跨进程 resume 用：读上轮 checkpoint.json 的 timed_out。
 * 补 in-process priorAttemptTimedOut 在新进程丢失的缺口（c3f08a21 遗留）。
 */
export function readPhaseCheckpointTimedOut(
  projectRoot: string,
  reportDir: string,
  phase: FeaturePhase,
): boolean {
  try {
    const abs = path.join(projectRoot, reportDir, 'phases', phase, 'checkpoint.json');
    if (!fs.existsSync(abs)) return false;
    const cp = JSON.parse(fs.readFileSync(abs, 'utf-8')) as PhaseCheckpoint;
    return cp.timed_out === true;
  } catch {
    return false;
  }
}
