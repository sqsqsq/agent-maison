// ============================================================================
// goal-brief.ts — 目标简报（plan 33784ed1 §3）
// ----------------------------------------------------------------------------
// 一个组装函数从既有真源现算结构化简报，一个渲染函数出文本；执行者提示词、视觉 provider、
// verifier 与 harness 控制台都调这同一对函数。简报不落盘、不进证据清单、不是输入绑定。
// ============================================================================

import { loadFrameworkConfig, resolveFeatureArtifact } from '../../config';
import { loadRefElementsFile, refElementsAbsPath, resolveCurrentRequirementSource } from './fidelity-shared';
import { loadEffectiveExecutionScope } from './goal-run-creation';
import { effectiveHeadlessUnattended } from './goal-manifest';
import { parseScope } from './scope-parser';
import { loadRepairDeclineState } from './repair-candidates';
import type { ResolvedPhaseInputs } from './capability-resolution';
import * as fs from 'fs';

export interface GoalBrief {
  /** null = 需求原文不可得（如实写明，不猜） */
  requirement: string | null;
  requested?: { completion_target: string; requested_results: string[] };
  exclusions?: { elements: Array<{ element_id: string; quote: string }>; out_of_scope_modules: string[] };
  permissions?: { write_mode: string; approval_mode: string };
  /** §4 的拒修记录（resolveRepairDeclineState 输出的最近一次来源核验通过的拒修） */
  resolved_conflicts: Array<{ candidate: string; basis: string; run_id: string }>;
}

export type GoalBriefSection = 'requirement' | 'requested' | 'exclusions' | 'permissions' | 'resolved_conflicts' | 'judgement';

const ALL_SECTIONS: readonly GoalBriefSection[] = ['requirement', 'requested', 'exclusions', 'permissions', 'resolved_conflicts', 'judgement'];

/** goal 执行者：需求行与冻结范围段已在提示词里，简报块只补这三栏（§3.2 装配去重）。 */
export const EXECUTOR_BRIEF_SECTIONS: readonly GoalBriefSection[] = ['exclusions', 'resolved_conflicts', 'judgement'];
/** 普通模式控制台：只打印这两栏，不打印需求全文（§3.3）。 */
export const CONSOLE_BRIEF_SECTIONS: readonly GoalBriefSection[] = ['exclusions', 'resolved_conflicts'];

export function assembleGoalBrief(projectRoot: string, feature: string, opts: { runId?: string } = {}): GoalBrief {
  let featuresDirRel = 'doc/features';
  try {
    featuresDirRel = (loadFrameworkConfig(projectRoot).paths?.features_dir ?? featuresDirRel).replace(/\\/g, '/');
  } catch { /* 无配置 → 默认目录 */ }
  const runId = (opts.runId ?? process.env.MAISON_GOAL_RUN_ID)?.trim() || undefined;

  let source: ReturnType<typeof resolveCurrentRequirementSource> = null;
  try { source = resolveCurrentRequirementSource(projectRoot, feature, featuresDirRel, runId ?? ''); } catch { /* 不可得 */ }
  const requirementText = source?.kind === 'run' ? source.requirement.trim() : source?.kind === 'runless' ? source.text.trim() : '';

  const brief: GoalBrief = { requirement: requirementText || null, resolved_conflicts: [] };

  try {
    const scope = loadEffectiveExecutionScope(projectRoot, feature, runId);
    if (scope) brief.requested = { completion_target: scope.completion_target, requested_results: [...scope.requested_results] };
  } catch { /* 范围不可得 → 省略该栏 */ }

  const elements = (loadRefElementsFile(refElementsAbsPath(projectRoot, feature))?.elements ?? [])
    .filter(e => e?.disposition === 'excluded')
    .map(e => ({ element_id: String(e.element_id), quote: typeof e.requirement_quote === 'string' ? e.requirement_quote.trim() : '' }));
  let outOfScope: string[] = [];
  try {
    const spec = resolveFeatureArtifact(projectRoot, feature, 'spec.md');
    if (spec.exists) outOfScope = parseScope(fs.readFileSync(spec.actualPath, 'utf-8')).scope?.out_of_scope_modules ?? [];
  } catch { /* spec 不可读 → 无出范围模块 */ }
  if (elements.length > 0 || outOfScope.length > 0) brief.exclusions = { elements, out_of_scope_modules: outOfScope };

  if (source?.kind === 'run') {
    const u = effectiveHeadlessUnattended();
    brief.permissions = { write_mode: u.write_mode, approval_mode: u.approval_mode };
    // §4.6：本交付周期内来源核验通过的拒修——与四处运行时判定同一个状态函数，不另读账本
    try {
      brief.resolved_conflicts = [...loadRepairDeclineState(projectRoot, feature, source.runId).values()]
        .flatMap(s => (s.basis ? [{ s, b: s.basis }] : []))
        .sort((x, y) => Date.parse(x.b.round.ts) - Date.parse(y.b.round.ts) || x.s.id.localeCompare(y.s.id))
        .map(({ s, b }) => ({ candidate: `${s.id}（${s.summary}）`, basis: b.text, run_id: b.run_id }));
    } catch { /* 事件或账本不可读 → 省略该栏 */ }
  }
  return brief;
}

/**
 * verifier 装配去重（§3.2）：已解析输入里已有 derive.requirement 的需求正文时，简报不再重复它。
 */
export function resolvedInputsCarryRequirement(inputs: ResolvedPhaseInputs | undefined): boolean {
  return Object.values(inputs?.values ?? {}).some(v =>
    v.state === 'resolved'
    && v.binding.source.kind === 'derive'
    && v.binding.source.provider_id === 'derive.requirement'
    && typeof v.value === 'string'
    && v.value.trim() !== '');
}

export function renderGoalBrief(
  brief: GoalBrief,
  opts: { sections?: readonly GoalBriefSection[]; requirementInContext?: boolean } = {},
): string {
  const wanted = new Set(opts.sections ?? ALL_SECTIONS);
  const blocks: string[] = [];
  for (const key of ALL_SECTIONS) {
    if (!wanted.has(key)) continue;
    const body = sectionBody(brief, key, opts.requirementInContext === true);
    if (body) blocks.push(`### ${SECTION_TITLES[key]}\n\n${body}`);
  }
  return blocks.length ? ['## 目标简报（goal brief）', '', blocks.join('\n\n')].join('\n') : '';
}

const SECTION_TITLES: Record<GoalBriefSection, string> = {
  requirement: '需求原文',
  requested: '请求结果与完成目标',
  exclusions: '明确不做',
  permissions: '已授予的权限',
  resolved_conflicts: '已裁决的冲突',
  judgement: '判定办法',
};

function sectionBody(brief: GoalBrief, key: GoalBriefSection, requirementInContext: boolean): string {
  switch (key) {
    case 'requirement':
      if (requirementInContext) return '需求原文已在上方已解析输入中，此处不重复。';
      return brief.requirement ?? '需求原文不可得（本次调用身份下没有可核实的需求来源）；以下栏目照常。';
    case 'requested':
      return brief.requested
        ? `- 完成终点：${brief.requested.completion_target}\n- 请求结果：${brief.requested.requested_results.join('；') || '（无）'}`
        : '';
    case 'exclusions':
      return brief.exclusions
        ? [
            '需求原文里明确写了不要或本次不做的内容同样是排除项，即使尚未登记。',
            ...brief.exclusions.elements.map(e => `- 参考图元素 ${e.element_id}${e.quote ? `：「${e.quote}」` : ''}`),
            ...(brief.exclusions.out_of_scope_modules.length
              ? [`- spec 出范围模块：${brief.exclusions.out_of_scope_modules.join('、')}`]
              : []),
          ].join('\n')
        : '';
    case 'permissions':
      return brief.permissions ? `- 写入模式 ${brief.permissions.write_mode}，审批模式 ${brief.permissions.approval_mode}` : '';
    case 'resolved_conflicts':
      return brief.resolved_conflicts.length
        ? [
            '执行者已按目标拒修下列候选。裁判：对照目标与实测证据，接受则不再提出，不接受则带证据提出。',
            ...brief.resolved_conflicts.map(c => `- ${c.candidate}：${c.basis}（run ${c.run_id}）`),
          ].join('\n')
        : '';
    case 'judgement':
      return '目标以当前有效的授权与明确修订为准；候选缺陷、参考图、下位产物与目标冲突时按目标裁决并留一行裁决记录，'
        + '只有目标本身冲突或缺失且无法裁决时才问人。详见 framework 行为规约 skills/reference/agent-behavioral-principles.md「权威判定」。';
  }
}
