// ============================================================================
// Context Facts Gate — C4 exploration-scale：per-feature facts.md 共享探索契约
// ============================================================================
// 设计（openspec/changes/exploration-scale/design.md）：
//   - <features_dir>/<feature>/context/facts.md 由该 track 的首个 feature phase 建立
//   - 后续所有 active feature phase（full 含 plan/coding/review/ut/testing；
//     量化阈值/subagent 强制只在建立阶段生效，delta 阶段只要求节存在且非空。
//   - 兼容：facts.md 不存在但旧 per-phase context-exploration.md 存在时，
//     回落旧契约校验 + WARN 提示 backfill；两者都不存在才 FAIL。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { ResolutionDependency } from './capability-resolution';
import { isInsideProjectRoot } from './project-relative-path';

import { featuresDirPath } from '../../config';
// M5A §4.3：逻辑 featureId → 物理相对路径唯一 SSOT
import { featureRelativePath } from './feature-identity';
import { CheckResult } from './types';
import {
  checkContextExplorationArtifact,
  isContextExplorationPhase,
  parseContextExploration,
  runQuantitativeChecks,
  assertFactsSourceReadable,
  type ContextExplorationCheckOptions,
  type ContextExplorationPhase,
} from './context-exploration';

/** 该 track 的首个 feature phase——建立 facts.md 全量事实的阶段。 */
export const FACTS_ESTABLISHING_PHASES: ReadonlySet<string> = new Set(['spec']);

/** Supplied by the invoking runtime/request entry, never read from authored facts. */
export interface FactsInvocationContext {
  /**
   * D1 §6.4 G3：Feature 事实的身份位有两种载体——run 载体绑 `run_id`；**无 run 的 feature
   * 载体绑冻结范围指纹**（frontmatter 用 `frozen_scope_fingerprint`，与 `run_id` 互斥）。
   */
  subject: { feature: string; run_id: string } | { feature: string } | { request_sha256: string; report_dir: string };
  first_phase: string;
  source_paths: string[];
  /** Effective-scope owner for a source target; runtime provenance, never authored in facts.md. */
  source_owners?: Record<string, string>;
  required_input_snippets: string[];
  /** Validated predecessor/current baseline: preserve its real establishing phase. */
  baseline?: { established_by: string; fingerprint: string; dependencies: ResolutionDependency[] };
  /** D1 G3：feature 载体的身份位（`executionScopeFingerprint(有效范围)`），run 载体不设。 */
  frozen_scope_fingerprint?: string;
}

function factsBaseline(raw: string): string {
  return raw.replace(/\r\n/g, '\n').split(/^##\s*phase_delta:/m)[0].trimEnd();
}

export function factsBaselineFingerprint(raw: string): string {
  return crypto.createHash('sha256').update(factsBaseline(raw)).digest('hex');
}

export function isFactsEstablishingPhase(phase: string, context?: FactsInvocationContext): boolean {
  if (context) return !context.baseline && context.first_phase === phase;
  return FACTS_ESTABLISHING_PHASES.has(phase);
}

export function resolveFactsAbsPath(projectRoot: string, feature: string | undefined, context?: FactsInvocationContext): string {
  if (context && 'request_sha256' in context.subject) {
    const reportDir = path.resolve(projectRoot, context.subject.report_dir);
    const relative = path.relative(projectRoot, reportDir);
    if (!relative || !isInsideProjectRoot(projectRoot, reportDir)) throw new Error('request facts report_dir must be inside project');
    return path.join(reportDir, 'context', 'facts.md');
  }
  if (feature === undefined) throw new Error('Feature subject required for Feature facts');
  return path.join(featuresDirPath(projectRoot), ...featureRelativePath(feature).split('/'), 'context', 'facts.md');
}

export interface PhaseDeltaSection {
  present: boolean;
  content: string;
}

/** 匹配 `## phase_delta: <phase>` 小节直到下一个 `##` 标题或文末。 */
export function findPhaseDeltaSection(body: string, phase: string, merge = false): PhaseDeltaSection {
  const escaped = phase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`##\\s*phase_delta:\\s*${escaped}\\b([\\s\\S]*?)(?=\\n##\\s|$)`, merge ? 'gi' : 'i');
  if (merge) {
    const sections = [...body.matchAll(re)];
    return { present: sections.length > 0, content: sections.map(section => (section[1] ?? '').trim()).filter(Boolean).join('\n\n') };
  }
  const m = re.exec(body);
  if (!m) return { present: false, content: '' };
  return { present: true, content: (m[1] ?? '').trim() };
}

export function projectFactsForPhase(raw: string, phase: string): { baseline: string; delta: PhaseDeltaSection } {
  const { body, error } = parseContextExploration(raw);
  if (error) throw new Error(error);
  return { baseline: factsBaseline(raw), delta: findPhaseDeltaSection(body, phase) };
}

/** Match an intact historical digest, then use the current decision and its actual source declarations. */
export function factsPhaseFingerprint(raw: string, phase: string, recorded?: string | null): string {
  const { baseline, delta } = projectFactsForPhase(raw, phase);
  const hash = (value: unknown) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
  if (recorded && hash([factsBaselineFingerprint(raw), delta]) === recorded) return recorded;

  const { fm, body } = parseContextExploration(baseline);
  const business = { ...fm };
  for (const field of ['key_inputs_read', 'files_inspected_count', 'searches_performed_estimate',
    'subagents_used', 'exploration_mode', 'legacy_backfill'] as const) delete business[field];
  return hash([business, body, delta]);
}

function checkEstablishingFacts(
  projectRoot: string,
  feature: string | undefined,
  phase: string,
  fm: ReturnType<typeof parseContextExploration>['fm'],
  body: string,
  relPath: string,
  options?: ContextExplorationCheckOptions,
): CheckResult[] {
  // runQuantitativeChecks 不读 fm.phase，可安全对 facts.md 复用（'spec'|'change' 均为合法 ContextExplorationPhase）。
  return runQuantitativeChecks(
    projectRoot,
    feature,
    phase,
    fm,
    body,
    relPath,
    options,
  );
}

function checkFactsFile(
  absPath: string,
  relPath: string,
  projectRoot: string,
  feature: string | undefined,
  phase: string,
  options?: ContextExplorationCheckOptions,
): CheckResult[] {
  const raw = fs.readFileSync(absPath, 'utf-8');
  const { fm, body, error } = parseContextExploration(raw);
  if (error) {
    return [{
      id: 'context_exploration_facts_parse',
      category: 'structure',
      description: 'facts.md frontmatter 可解析',
      severity: 'BLOCKER',
      status: 'FAIL',
      details: error,
      affected_files: [relPath],
    }];
  }

  const results: CheckResult[] = [];
  const schemaVersion = typeof fm.schema_version === 'string' ? fm.schema_version.trim() : '';
  const invocation = options?.factsContext;
  if (invocation) {
    const issue = (id: string, details: string): void => { results.push({ id, category: 'structure', description: 'facts 调用身份、来源与范围一致', severity: 'BLOCKER', status: 'FAIL', details, suggestion: '按实际身份、原需求与当前可读依据核实事实。', affected_files: [relPath] }); };
    const subject = invocation.subject;
    if (!options?.resolvedInputs || options.resolvedInputs.phase !== phase) issue('context_exploration_facts_input_context', '须由当前调用提供同一 resolvedInputs，不能回退读取旧 Feature 文件');
    const inputSubject = options?.resolvedInputs?.context.subject;
    if (inputSubject && ('feature' in subject
      ? !('feature' in inputSubject) || inputSubject.feature !== subject.feature
      : !('request_sha256' in inputSubject) || inputSubject.request_sha256 !== subject.request_sha256)) issue('context_exploration_facts_input_context', 'facts 与输入解析 subject 不一致');
    const record = fm as Record<string, unknown>;
    if (schemaVersion !== '1.1' && !(schemaVersion === '1.0' && invocation.baseline)) {
      issue('context_exploration_facts_schema_version', '新事实须使用 1.1；旧 1.0 仅可经显式 baseline 承接');
      issue('context_exploration_facts_input_context', '未验证的旧schema不能建立当前调用事实；须由责任阶段真正建立schema 1.1');
    }
    if ('feature' in subject) {
      if (subject.feature !== feature || fm.feature !== feature || record.request_sha256 !== undefined) issue('context_exploration_facts_feature_match', 'Feature subject 不匹配或混入 request 身份');
      // G3：按 subject 形态二分。run 载体沿现状；feature 载体改绑**冻结范围指纹**，
      // 两个身份位互斥——同时出现即身份混淆，直接判 issue。
      if ('run_id' in subject) {
        if (!subject.run_id || (!invocation.baseline && record.run_id !== subject.run_id)) issue('context_exploration_facts_run_match', '建立事实必须绑定真实调用 run_id');
      } else {
        const fingerprint = invocation.frozen_scope_fingerprint;
        if (record.run_id !== undefined) issue('context_exploration_facts_run_match', '无 run 的事实不得声明 run_id（身份位与冻结范围指纹互斥）');
        else if (!fingerprint) issue('context_exploration_facts_run_match', '无 run 的事实必须由调用方给出冻结范围指纹');
        // 身份位**与 baseline 无关**：baseline 只管「来源是否新鲜」，不能替代「这份事实属于
        // 哪一份冻结范围」。run 载体那侧的 `!invocation.baseline` 豁免是历史形状，feature
        // 载体不继承（第一轮阻断 5）。
        else if (record.frozen_scope_fingerprint !== fingerprint) issue('context_exploration_facts_run_match', '建立事实必须绑定当前 feature 冻结范围指纹');
      }
    } else if (feature || fm.feature !== undefined || record.run_id !== undefined || !/^[0-9a-f]{64}$/.test(subject.request_sha256) || record.request_sha256 !== subject.request_sha256) {
      issue('context_exploration_facts_request_match', 'request subject 不匹配或混入 Feature/run 身份');
    }
    const expectedPhase = invocation.baseline?.established_by ?? invocation.first_phase;
    if (!expectedPhase || record.established_by !== expectedPhase) issue('context_exploration_facts_established_by_invalid', '事实建立阶段必须与本请求或已验证原件相符');
    const actualSources = Object.values(options?.resolvedInputs?.values ?? {}).flatMap(input => input.state === 'resolved'
      && input.binding.source.kind === 'derive' && ['derive.codebase', 'derive.test-targets'].includes(input.binding.source.provider_id)
      ? input.binding.dependencies.filter(dep => dep.exists && dep.role === 'derive').map(dep => dep.path) : []);
    for (const source of new Set([...actualSources, ...invocation.source_paths].map(source => path.relative(projectRoot, path.resolve(projectRoot, source)).replace(/\\/g, '/')))) {
      try { assertFactsSourceReadable(projectRoot, source, options); }
      catch { issue('context_exploration_facts_scope_coverage', `当前来源不可读或越界：${source}`); }
    }
  } else if (schemaVersion !== '1.0') {
    // P1-8（plan d9b4f7e2，07-13 chrys 案 i4/i5 实证连踩两轮）：facts.md 的 "1.0" 与隔壁
    // context-exploration.md 的 1.0.0/1.1.0 是**两套版本号体系**，弱模型极易写混——
    // details 直接给期望值 + 最小合法模板，不让 agent 猜。
    results.push({
      id: 'context_exploration_facts_schema_version',
      category: 'structure',
      description: 'facts.md schema_version 须为 "1.0"',
      severity: 'BLOCKER',
      status: 'FAIL',
      details:
        `当前 schema_version=${fm.schema_version ?? '<missing>'}，期望 "1.0"（带引号的字符串）。` +
        `注意：这是 context/facts.md 的版本号，与 context-exploration.md 的 1.0.0/1.1.0 是两套体系，不要照抄。` +
        `最小合法 frontmatter：\n---\nschema_version: "1.0"\nfeature: ${feature}\nestablished_by: spec\n---`,
      affected_files: [relPath],
    });
  }

  if (!invocation && fm.feature !== feature) {
    results.push({
      id: 'context_exploration_facts_feature_match',
      category: 'structure',
      description: 'facts.md frontmatter.feature 须与 harness --feature 一致',
      severity: 'BLOCKER',
      status: 'FAIL',
      details: `frontmatter.feature="${fm.feature ?? ''}"，期望 "${feature}"`,
      affected_files: [relPath],
    });
  }

  const establishedBy = String((fm as Record<string, unknown>).established_by ?? '').trim();
  if (!invocation && (!establishedBy || !isFactsEstablishingPhase(establishedBy))) {
    results.push({
      id: 'context_exploration_facts_established_by_invalid',
      category: 'structure',
      description: 'facts.md frontmatter.established_by 须为旧出生协议的 spec 阶段',
      severity: 'BLOCKER',
      status: 'FAIL',
      details:
        `established_by="${establishedBy || '<missing>'}"，旧出生协议期望 "spec"。` +
        `在 frontmatter 顶层补一行，如：established_by: spec`,
      affected_files: [relPath],
    });
  }

  if (fm.ready_to_produce !== true) {
    results.push({
      id: 'context_exploration_facts_ready',
      category: 'structure',
      description: 'facts.md ready_to_produce 须为 true 方可进入本阶段主产出',
      severity: 'BLOCKER',
      status: 'FAIL',
      details: `ready_to_produce=${fm.ready_to_produce ?? '<missing>'}`,
      affected_files: [relPath],
    });
  }

  if (fm.has_blocker_coverage_risk === true) {
    results.push({
      id: 'context_exploration_facts_blocker_risk',
      category: 'structure',
      description: 'facts.md 存在未解决的 BLOCKER 级覆盖风险时不得结束 harness',
      severity: 'BLOCKER',
      status: 'FAIL',
      details: 'has_blocker_coverage_risk=true',
      affected_files: [relPath],
    });
  }

  if ((invocation && options?.resolvedInputs) || (!invocation && isFactsEstablishingPhase(phase))) {
    results.push(...checkEstablishingFacts(projectRoot, feature, phase, fm, body, relPath, {
      ...options,
    }));
  }

  return results;
}

/**
 * Context Facts Gate 主入口：facts.md 存在则按新契约校验；
 * 不存在但旧 per-phase context-exploration.md 存在（仅 spec/plan/coding/review/ut 曾有该契约）
 * 则回落旧校验 + WARN 提示 backfill；两者皆无 → FAIL 指向 facts.md。
 */
export function checkFactsArtifact(
  projectRoot: string,
  feature: string | undefined,
  phase: string,
  options?: ContextExplorationCheckOptions,
): CheckResult[] {
  const factsAbs = resolveFactsAbsPath(projectRoot, feature, options?.factsContext);
  const factsRel = path.relative(projectRoot, factsAbs).replace(/\\/g, '/');

  if (fs.existsSync(factsAbs)) {
    const checks = checkFactsFile(factsAbs, factsRel, projectRoot, feature, phase, options);
    if (feature && checks.some(check => check.status === 'FAIL' && ['context_exploration_facts_source_stale', 'context_exploration_facts_baseline_stale', 'context_exploration_facts_established_by_invalid'].includes(check.id))) {
      const { factsCheckRepairOwner } = require('./repair-responsibility') as typeof import('./repair-responsibility');
      const owner = factsCheckRepairOwner({ projectRoot, feature, frameworkRoot: options?.frameworkRoot ?? path.resolve(__dirname, '../../..'),
        runId: options?.factsContext?.subject && 'run_id' in options.factsContext.subject ? options.factsContext.subject.run_id : process.env.MAISON_GOAL_RUN_ID, currentPhase: phase });
      for (const check of checks) if (check.status === 'FAIL' && ['context_exploration_facts_source_stale', 'context_exploration_facts_baseline_stale', 'context_exploration_facts_established_by_invalid'].includes(check.id) && owner) check.repair_owner = owner;
    }
    return checks;
  }

  if (feature !== undefined && !options?.factsContext && isContextExplorationPhase(phase)) {
    const legacyResults = checkContextExplorationArtifact(
      projectRoot,
      feature,
      phase as ContextExplorationPhase,
      options,
    );
    const legacyPresent = legacyResults.every(r => r.status !== 'FAIL' || r.id !== 'context_exploration_present');
    if (legacyPresent) {
      return [
        ...legacyResults,
        {
          id: 'context_exploration_facts_legacy_fallback',
          category: 'structure',
          description: '使用旧版 per-phase context-exploration.md',
          severity: 'MINOR',
          status: 'WARN',
          details: `${factsRel} 缺失，沿用可核的旧 per-phase facts。`,
        },
      ];
    }
  }

  return [{
    id: 'context_exploration_facts_present',
    category: 'structure',
    description: 'Context Facts Gate：须在 <features_dir>/<feature>/context/facts.md 建立共享探索事实',
    severity: 'BLOCKER',
    status: 'FAIL',
    details: `缺失：${factsRel}`,
    suggestion: isFactsEstablishingPhase(phase, options?.factsContext)
      ? '本阶段负责建立 facts.md（frontmatter + Code Facts 表）；必须记录实际建立阶段，不补造 spec/change 执行。'
      : '本阶段依赖已建立的 facts.md；请从当前需求、契约与可读来源核对实际决定。',
    affected_files: [factsRel],
  }];
}
