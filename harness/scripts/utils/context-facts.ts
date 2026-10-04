// ============================================================================
// Context Facts Gate — C4 exploration-scale：per-feature facts.md 共享探索契约
// ============================================================================
// 设计（openspec/changes/exploration-scale/design.md）：
//   - <features_dir>/<feature>/context/facts.md 由该 track 的首个 feature phase 建立
//     （full=spec / lite=change），承载 Code Facts 全量表 + frontmatter。
//   - 后续所有 active feature phase（full 含 plan/coding/review/ut/testing；
//     lite 含 coding/exit）以 `## phase_delta: <phase>` 增量节追加，不重做全量探索；
//     量化阈值/subagent 强制只在建立阶段生效，delta 阶段只要求节存在且非空。
//   - 兼容：facts.md 不存在但旧 per-phase context-exploration.md 存在时，
//     回落旧契约校验 + WARN 提示 backfill；两者都不存在才 FAIL。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { ResolutionDependency } from './capability-resolution';
import { isInsideProjectRoot } from './project-relative-path';
import { extractTables } from './markdown-parser';
import { diffChangedFilesWithStatus, resolveEffectiveDiffBaseline } from './git-diff';

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
import { loadFeatureTrackDecl } from './feature-track';
import { resolveFeatureTrack } from './runtime-policy';

/** 该 track 的首个 feature phase——建立 facts.md 全量事实的阶段。 */
export const FACTS_ESTABLISHING_PHASES: ReadonlySet<string> = new Set(['spec', 'change']);

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

export function factsBaselineFingerprint(raw: string): string {
  return crypto.createHash('sha256').update(raw.replace(/\r\n/g, '\n').split(/^##\s*phase_delta:/m)[0].trimEnd()).digest('hex');
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

interface PhaseDeltaSection {
  present: boolean;
  content: string;
}

/** 匹配 `## phase_delta: <phase>` 小节直到下一个 `##` 标题或文末。 */
function findPhaseDeltaSection(body: string, phase: string, merge = false): PhaseDeltaSection {
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

/** Bind the baseline and this phase's delta, not later append-only investigation. */
export function factsPhaseFingerprint(raw: string, phase: string): string {
  const { body, error } = parseContextExploration(raw);
  if (error) throw new Error(error);
  return crypto.createHash('sha256').update(JSON.stringify([
    factsBaselineFingerprint(raw), findPhaseDeltaSection(body, phase),
  ])).digest('hex');
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

function checkDeltaFacts(body: string, phase: string, relPath: string): CheckResult[] {
  const { present, content } = findPhaseDeltaSection(body, phase, true);
  if (!present) {
    return [{
      id: 'context_exploration_facts_phase_delta_missing',
      category: 'structure',
      description: 'facts.md 须含本阶段 `## phase_delta: <phase>` 增量节',
      severity: 'BLOCKER',
      status: 'FAIL',
      details: `未找到 "## phase_delta: ${phase}" 小节。`,
      suggestion: `在 facts.md 末尾追加 "## phase_delta: ${phase}"，无新增事实须显式写 "none"（不得留空）。`,
      affected_files: [relPath],
    }];
  }
  if (!content) {
    return [{
      id: 'context_exploration_facts_phase_delta_empty',
      category: 'structure',
      description: '`## phase_delta: <phase>` 节内容不得为空',
      severity: 'BLOCKER',
      status: 'FAIL',
      details: `"## phase_delta: ${phase}" 节存在但内容为空。`,
      suggestion: '无新增事实时显式写 "none"，不要留空——空节无法区分"忘写"与"确实没有"。',
      affected_files: [relPath],
    }];
  }
  return [{
    id: 'context_exploration_facts_phase_delta_present',
    category: 'structure',
    description: 'facts.md 本阶段 phase_delta 节已声明',
    severity: 'BLOCKER',
    status: 'PASS',
    details: `"## phase_delta: ${phase}" 节已声明（${content.length} 字符）。`,
  }];
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
  let ownedSourceDelta = false;
  if (invocation) {
    const issue = (id: string, details: string): void => { results.push({ id, category: 'structure', description: 'facts 调用身份、来源与范围一致', severity: 'BLOCKER', status: 'FAIL', details, suggestion: id === 'context_exploration_facts_baseline_stale'
      ? `保留已核基线正文及原身份，仅在 ## phase_delta: ${phase} 精确追加变化来源与事实；来源实际失效时回责任阶段重建，不只改run_id。`
      : '按实际调用身份与目标补齐 facts；来源或基线已变化时回责任方重新验证，不伪造建立阶段。', affected_files: [relPath] }); };
    // plan e7a2c4f1 §3.4（G01）：账本类缺口的披露出口——同一 check id，只降档不改名。
    // 「声明的来源没进基线登记」不影响产品，能补登记的已由入口补齐（见
    // capability-resolution-entry-input 的 facts baseline 组装），补不了的在这里如实
    // 披露，不单独阻断阶段。
    const ledgerWarn = (id: string, details: string, suggestion = '来源不可读或不在项目内时无法自动补登记：确认该来源是否仍属本次探索面；仍需要就把它放回项目内并重跑建立阶段，否则从 facts 的 source_code_paths 去掉。追溯弱一级，不阻断本阶段。'): void => { results.push({ id, category: 'structure', description: 'facts 调用身份、来源与范围一致', severity: 'MAJOR', status: 'WARN', details, suggestion, affected_files: [relPath] }); };
    const registrationSuggestion = (source: string): string => `可在 ## phase_delta: ${phase} 的「路径 | 事实 | 影响」表补一行 ${source} 以完善追溯；缺少登记只披露，不阻断本阶段。`;
    const subject = invocation.subject;
    if (!options?.resolvedInputs || options.resolvedInputs.phase !== phase) issue('context_exploration_facts_input_context', '须由当前调用提供同一 resolvedInputs，不能回退读取旧 Feature 文件');
    const inputSubject = options?.resolvedInputs?.context.subject;
    if (inputSubject && ('feature' in subject
      ? !('feature' in inputSubject) || inputSubject.feature !== subject.feature
      : !('request_sha256' in inputSubject) || inputSubject.request_sha256 !== subject.request_sha256)) issue('context_exploration_facts_input_context', 'facts 与输入解析 subject 不一致');
    const record = fm as Record<string, unknown>;
    const declared = Array.isArray(fm.source_code_paths) ? fm.source_code_paths.filter((source): source is string => typeof source === 'string') : [];
    if (new Set(declared.map(source => path.posix.normalize(source.replace(/\\/g, '/')))).size !== declared.length) {
      issue('context_exploration_facts_scope_coverage', 'facts source paths contain duplicates; rebuild canonical source declarations');
    }
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
    const deltaPaths = extractTables(findPhaseDeltaSection(body, phase, true).content)
      .filter(table => table.headers.some(header => /事实/.test(header)))
      .flatMap(table => { const column = table.headers.findIndex(header => /路径/.test(header)); return column < 0 ? [] : table.rows.map(row => {
        const source = (row[column] ?? '').replace(/`/g, '').trim().replace(/\\/g, '/');
        const absolute = path.resolve(projectRoot, source);
        return source && isInsideProjectRoot(projectRoot, absolute) ? path.relative(projectRoot, absolute).replace(/\\/g, '/') : '';
      }); });
    const currentTargets = new Set(Object.values(options?.resolvedInputs?.values ?? {}).flatMap(input => input.state === 'resolved'
      && input.binding.source.kind === 'derive' && ['derive.codebase', 'derive.test-targets'].includes(input.binding.source.provider_id)
      ? input.binding.dependencies.filter(dep => dep.exists && dep.role === 'derive').map(dep => path.resolve(dep.path)) : []));
    // UT's test_targets input is declared but need not belong to an active capability.
    // The entry still supplies its actual test targets in source_paths; ownership and
    // the existing write boundary below remain necessary before treating one as writable.
    if (phase === 'ut') for (const source of invocation.source_paths) if (invocation.source_owners?.[source] === phase) currentTargets.add(path.resolve(projectRoot, source));
    let admission: FactsInvocationContext | undefined;
    const { loadFactsInvocationContext, resolveFactsPhaseOwnedSources } = require('./capability-resolution-entry-input') as typeof import('./capability-resolution-entry-input');
    if ('run_id' in invocation.subject) {
      try {
        admission = loadFactsInvocationContext({ projectRoot, feature: invocation.subject.feature, phase, runId: invocation.subject.run_id,
          attemptId: options?.goalAttemptId ?? process.env.MAISON_GOAL_ATTEMPT });
      } catch { /* No verifiable admission: strict dependency comparison below. */ }
    }
    const ownedSources = 'feature' in invocation.subject ? resolveFactsPhaseOwnedSources({ projectRoot,
      frameworkRoot: options?.frameworkRoot ?? path.resolve(__dirname, '../../..'), feature: invocation.subject.feature, phase,
      ...('run_id' in invocation.subject ? { runId: invocation.subject.run_id } : {}) }, invocation) : new Set<string>();
    const mayAdvanceSource = (source: string, hash: string | null): boolean => !!hash && ownedSources.has(source)
      && currentTargets.has(path.resolve(projectRoot, source)) && invocation.source_owners?.[source] === phase
      && ('run_id' in invocation.subject
        ? !!admission?.baseline && admission.baseline.fingerprint === invocation.baseline?.fingerprint && admission.source_owners?.[source] === phase
        : !!invocation.baseline);
    if (record.established_by !== expectedPhase || !expectedPhase || (!invocation.baseline && phase !== invocation.first_phase)) issue('context_exploration_facts_established_by_invalid', '建立资格必须来自首个实际调用或经验证的已有基线');
    if (invocation.baseline) {
      if (factsBaselineFingerprint(raw) !== invocation.baseline.fingerprint) issue('context_exploration_facts_baseline_stale', `facts 基线正文或原身份已变化；保留已核基线，在 ## phase_delta: ${phase} 精确追加当前变化来源与事实，不通过改正文或run_id洗新`);
      for (const dep of invocation.baseline.dependencies) {
        if (!isInsideProjectRoot(projectRoot, dep.path)) { issue('context_exploration_facts_source_stale', '事实来源不在项目内'); continue; }
        let hash: string | null = null;
        try { hash = crypto.createHash('sha256').update(fs.readFileSync(dep.path)).digest('hex'); } catch { /* stale below */ }
        if (hash !== dep.sha256 || fs.existsSync(dep.path) !== dep.exists) {
          const source = path.relative(projectRoot, dep.path).replace(/\\/g, '/');
          if (!mayAdvanceSource(source, hash)) issue('context_exploration_facts_source_stale', source);
          else {
            ownedSourceDelta = true;
            if (!deltaPaths.includes(source)) ledgerWarn('context_exploration_facts_source_stale', `本阶段授权内源码已变化但未登记精确 delta：${source}；追溯弱一级，不阻断本阶段。`, registrationSuggestion(source));
          }
        }
      }
      for (const source of declared) {
        if (!invocation.baseline.dependencies.some(dep => path.resolve(dep.path) === path.resolve(projectRoot, source) && dep.exists && dep.sha256)) ledgerWarn('context_exploration_facts_source_stale', `基线未绑定原有来源：${source}（该来源不在项目内或不可读，无法自动补登记；追溯弱一级，不阻断本阶段）`);
      }
    }
    for (const input of Object.values(options?.resolvedInputs?.values ?? {})) {
      if (input.state !== 'resolved' || input.binding.source.kind !== 'derive' || !['derive.codebase', 'derive.test-targets'].includes(input.binding.source.provider_id)) continue;
      for (const dep of input.binding.dependencies.filter(dep => dep.exists && dep.role === 'derive')) {
        if (!invocation.source_paths.some(source => path.resolve(projectRoot, source) === path.resolve(dep.path))) issue('context_exploration_facts_scope_coverage', `facts 未承接解析后的真实目标：${dep.path}`);
      }
    }
    for (const source of invocation.source_paths) {
      if (!declared.includes(source) && !deltaPaths.includes(source)) {
        const absolute = path.resolve(projectRoot, source);
        let hash: string | null = null;
        try { hash = crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex'); } catch { /* Strict unreadable check below. */ }
        const before = (admission?.baseline ?? invocation.baseline)?.dependencies.find(dep => path.resolve(dep.path) === absolute);
        let changedInPhase = before ? before.exists !== fs.existsSync(absolute) || before.sha256 !== hash
          : !!admission && !admission.source_paths.includes(source);
        if (!before && !admission && 'feature' in invocation.subject && !('run_id' in invocation.subject)) {
          const baseline = resolveEffectiveDiffBaseline(projectRoot, invocation.subject.feature);
          const diff = baseline.available ? diffChangedFilesWithStatus({ projectRoot, baseRef: baseline.baseSha }) : undefined;
          changedInPhase = !!diff?.executed && diff.entries.some(entry => entry.path === source && entry.status === 'A');
        }
        if (changedInPhase && mayAdvanceSource(source, hash)) {
          ownedSourceDelta = true;
          ledgerWarn('context_exploration_facts_scope_coverage', `本阶段授权内新增或修改的源码未登记：${source}；追溯弱一级，不阻断本阶段。`, registrationSuggestion(source));
        } else issue('context_exploration_facts_scope_coverage', `当前目标未覆盖：${source}`);
      }
      try {
        assertFactsSourceReadable(projectRoot, source, options);
      } catch { issue('context_exploration_facts_scope_coverage', `当前来源不可读或越界：${source}`); }
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
      description: 'facts.md frontmatter.established_by 须为该 track 首个 feature phase（spec 或 change）',
      severity: 'BLOCKER',
      status: 'FAIL',
      details:
        `established_by="${establishedBy || '<missing>'}"，期望 "spec"（full track）或 "change"（lite track）。` +
        `在 frontmatter 顶层补一行，如：established_by: spec`,
      affected_files: [relPath],
    });
  } else if (!invocation) {
    // codex review 采纳：仅校验 established_by ∈ {spec,change} 不够——full track 的 feature
    // 若沿用早年 lite 阶段建立的 facts.md（established_by: change），delta 阶段（plan/coding/...）
    // 只查 phase_delta 节，不会发现"这份事实基线其实是按 lite 更轻的门槛建立的"。
    // 按 feature.yaml 声明的 track（缺省 full）推导期望值：full→spec，lite→change，不一致即 FAIL。
    const track = resolveFeatureTrack(loadFeatureTrackDecl(projectRoot, feature!));
    const expectedEstablishedBy = track === 'lite' ? 'change' : 'spec';
    if (establishedBy !== expectedEstablishedBy) {
      results.push({
        id: 'context_exploration_facts_established_by_track_mismatch',
        category: 'structure',
        description: 'facts.md established_by 须与 feature.yaml 声明的 track 一致（full→spec，lite→change）',
        severity: 'BLOCKER',
        status: 'FAIL',
        details: `established_by="${establishedBy}"，但 feature track="${track}"（期望 established_by="${expectedEstablishedBy}"）`,
        suggestion: track === 'full'
          ? '该 feature 现为 full track，facts.md 须由 spec 阶段重新建立（如从 lite 升档而来，请回 spec 阶段重跑 Research Sub-Phase 并重写 facts.md）。'
          : '该 feature 现为 lite track，facts.md 须由 change 阶段建立。',
        affected_files: [relPath],
      });
    }
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
    results.push(...checkEstablishingFacts(projectRoot, feature, phase, fm, body, relPath, options));
  }
  if (!isFactsEstablishingPhase(phase, invocation)) {
    results.push(...checkDeltaFacts(body, phase, relPath).map(check => ownedSourceDelta && check.status === 'FAIL'
      ? { ...check, severity: 'MAJOR' as const, status: 'WARN' as const,
        suggestion: `可在 ## phase_delta: ${phase} 的「路径 | 事实 | 影响」表补齐本阶段变化以完善追溯；缺少登记只披露，不阻断本阶段。` } : check));
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
    return checkFactsFile(factsAbs, factsRel, projectRoot, feature, phase, options);
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
          description: '使用旧版 per-phase context-exploration.md（建议 backfill 到 facts.md）',
          severity: 'MINOR',
          status: 'WARN',
          details: `${factsRel} 缺失，回落旧版 per-phase 契约校验；建议运行 backfill-context-exploration.ts --to-facts 归并。`,
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
      : '本阶段依赖已建立的 facts.md；若上游建立阶段尚未产出，请先完成该阶段，或运行 backfill-context-exploration.ts --to-facts 从旧产物归并。',
    affected_files: [factsRel],
  }];
}
