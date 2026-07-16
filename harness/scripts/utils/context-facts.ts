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

import { featuresDirPath } from '../../config';
import { CheckResult } from './types';
import {
  checkContextExplorationArtifact,
  isContextExplorationPhase,
  parseContextExploration,
  runQuantitativeChecks,
  type ContextExplorationCheckOptions,
  type ContextExplorationPhase,
} from './context-exploration';
import { loadFeatureTrackDecl } from './feature-track';
import { resolveFeatureTrack } from './runtime-policy';

/** 该 track 的首个 feature phase——建立 facts.md 全量事实的阶段。 */
export const FACTS_ESTABLISHING_PHASES: ReadonlySet<string> = new Set(['spec', 'change']);

export function isFactsEstablishingPhase(phase: string): boolean {
  return FACTS_ESTABLISHING_PHASES.has(phase);
}

export function resolveFactsAbsPath(projectRoot: string, feature: string): string {
  return path.join(featuresDirPath(projectRoot), feature, 'context', 'facts.md');
}

interface PhaseDeltaSection {
  present: boolean;
  content: string;
}

/** 匹配 `## phase_delta: <phase>` 小节直到下一个 `##` 标题或文末。 */
function findPhaseDeltaSection(body: string, phase: string): PhaseDeltaSection {
  const escaped = phase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`##\\s*phase_delta:\\s*${escaped}\\b([\\s\\S]*?)(?=\\n##\\s|$)`, 'i');
  const m = re.exec(body);
  if (!m) return { present: false, content: '' };
  return { present: true, content: (m[1] ?? '').trim() };
}

function checkEstablishingFacts(
  projectRoot: string,
  feature: string,
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
    phase as ContextExplorationPhase,
    fm,
    body,
    relPath,
    options,
  );
}

function checkDeltaFacts(body: string, phase: string, relPath: string): CheckResult[] {
  const { present, content } = findPhaseDeltaSection(body, phase);
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
  feature: string,
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
  const schemaVersion = (fm.schema_version ?? '').trim();
  if (schemaVersion !== '1.0') {
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

  if (fm.feature !== feature) {
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
  if (!establishedBy || !isFactsEstablishingPhase(establishedBy)) {
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
  } else {
    // codex review 采纳：仅校验 established_by ∈ {spec,change} 不够——full track 的 feature
    // 若沿用早年 lite 阶段建立的 facts.md（established_by: change），delta 阶段（plan/coding/...）
    // 只查 phase_delta 节，不会发现"这份事实基线其实是按 lite 更轻的门槛建立的"。
    // 按 feature.yaml 声明的 track（缺省 full）推导期望值：full→spec，lite→change，不一致即 FAIL。
    const track = resolveFeatureTrack(loadFeatureTrackDecl(projectRoot, feature));
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

  if (isFactsEstablishingPhase(phase)) {
    results.push(...checkEstablishingFacts(projectRoot, feature, phase, fm, body, relPath, options));
  } else {
    results.push(...checkDeltaFacts(body, phase, relPath));
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
  feature: string,
  phase: string,
  options?: ContextExplorationCheckOptions,
): CheckResult[] {
  const factsAbs = resolveFactsAbsPath(projectRoot, feature);
  const factsRel = path.relative(projectRoot, factsAbs).replace(/\\/g, '/');

  if (fs.existsSync(factsAbs)) {
    return checkFactsFile(factsAbs, factsRel, projectRoot, feature, phase, options);
  }

  if (isContextExplorationPhase(phase)) {
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
    suggestion: isFactsEstablishingPhase(phase)
      ? '本阶段是该 track 的首个 feature phase，须建立 facts.md（frontmatter + Code Facts 表 + 首个 phase_delta 节）。'
      : '本阶段依赖已建立的 facts.md；若上游建立阶段尚未产出，请先完成该阶段，或运行 backfill-context-exploration.ts --to-facts 从旧产物归并。',
    affected_files: [factsRel],
  }];
}
