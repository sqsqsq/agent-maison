// ============================================================================
// assess-renderer.ts — bounded outer-CLI rendering for assess@1
// ============================================================================

import {
  assessFeature,
  type AssessAuthorizationContext,
  type AssessResult,
} from './assess';
import { loadGoalManifestFromRun } from './goal-manifest';
import { mapCategoryToChainPhase } from './correction-routing';

export interface AssessRenderOptions {
  projectRoot: string;
  frameworkRoot?: string;
  feature: string;
  phase: string;
  mode: AssessAuthorizationContext['mode'];
  status: string;
  goalEnd?: string;
  minimumAssurance?: Record<string, 'degraded' | 'full'>;
  runId?: string;
  attemptId?: string;
}

let renderedInProcess = false;

function oneLine(value: string, max = 280): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1)}…`;
}

export function formatAssessNextStep(
  result: AssessResult,
  meta: Pick<AssessRenderOptions, 'phase' | 'mode' | 'status'>,
): string {
  const target = result.recommendation.phase
    ? `${result.recommendation.action}:${result.recommendation.phase}`
    : result.recommendation.action;
  return [
    'NEXT_STEP',
    `feature=${result.feature} phase=${meta.phase} mode=${meta.mode} status=${oneLine(meta.status, 96)}`,
    `observed_fingerprint=${result.observed_fingerprint.slice(0, 16)} gaps=${result.gaps.length} fused=${result.stop.fused}`,
    `recommendation=${target}`,
    `reason=${oneLine(result.recommendation.reason)}`,
    `authorization=driver_required policy=${result.authorization_context.mode}`,
    'END_NEXT_STEP',
  ].join('\n');
}

/**
 * 责任阶段统一路由（plan b6e4c9f2 t3·manual）：当前 phase 的可信可修缺陷
 * （summary.repair_candidates，harness 共享事实层产出）在人工链路渲染为**确认菜单**
 * ——manual 绝不擅自跨阶段改文件，只自动诊断责任阶段并把选择权给用户；
 * 用户选 1 后由当前人工 agent 切换对应 Skill 继续，不新增执行器。
 * goal/batch 模式不渲染（自动路径由 runner/授权区间承载）。
 */
export function formatRepairCandidatesMenu(
  result: AssessResult,
  options: Pick<AssessRenderOptions, 'phase' | 'mode'>,
): string | null {
  if (options.mode !== 'manual') return null;
  // 候选来自 assess 观测（其唯一真源=phase summary）——不再单独读文件，三模式同事实。
  const candidates = result.observed.phases.find((p) => p.phase === options.phase)?.repair_candidates ?? [];
  if (candidates.length === 0) return null;
  const chainPhases = result.observed.phases.map((p) => p.phase);
  const targets = [...new Set(candidates.map((c) => c.category))]
    .map((category) => mapCategoryToChainPhase(category, chainPhases, result.track))
    .filter((p): p is string => p !== null && p !== options.phase);
  const upstream = targets.sort(
    (a, b) => chainPhases.indexOf(a) - chainPhases.indexOf(b),
  )[0];
  if (!upstream) return null;
  return [
    '',
    'REPAIR_CANDIDATES',
    `${options.phase} 发现 ${candidates.length} 个可信可修缺陷，责任阶段为 ${upstream}：`,
    ...candidates.slice(0, 6).map((c) => `  - ${c.id}: ${oneLine(c.summary ?? '', 120)}`),
    '',
    `1. 返回 ${upstream} 修复，随后重新执行 ${options.phase}`,
    '2. 暂停',
    '3. 其它处理方式',
    '（请向用户呈现以上选项并等待确认——manual 模式不得未经确认跨阶段修改文件）',
    'END_REPAIR_CANDIDATES',
  ].join('\n');
}

/**
 * Process-wide once guard prevents an outer CLI from rendering twice. Nested
 * check-receipt calls use --skip-state-sync and never invoke this helper.
 */
export function assessAndRenderNextStep(options: AssessRenderOptions): AssessResult | null {
  if (renderedInProcess) return null;
  renderedInProcess = true;
  try {
    const runId = options.runId ?? (process.env.MAISON_GOAL_RUN_ID?.trim() || undefined);
    let goalEnd = options.goalEnd;
    let minimumAssurance = options.minimumAssurance;
    if (runId && (options.mode === 'goal_mode' || process.env.MAISON_GOAL_GATE_HARNESS === '1') && (!goalEnd || !minimumAssurance)) {
      const manifest = loadGoalManifestFromRun(options.projectRoot, runId, {
        feature: options.feature,
      });
      goalEnd ??= manifest.end_phase;
      minimumAssurance ??= manifest.minimum_assurance;
    }
    const result = assessFeature({
      projectRoot: options.projectRoot,
      frameworkRoot: options.frameworkRoot,
      feature: options.feature,
      goalEnd,
      minimumAssurance,
      authorization: { mode: options.mode },
      runId,
      attemptId: options.attemptId ?? (process.env.MAISON_GOAL_ATTEMPT?.trim() || undefined),
      writeProjection: true,
    });
    console.log('');
    console.log(formatAssessNextStep(result, options));
    const menu = formatRepairCandidatesMenu(result, options);
    if (menu) console.log(menu);
    return result;
  } catch (error) {
    console.warn('');
    console.warn('NEXT_STEP');
    console.warn(`feature=${options.feature} phase=${options.phase} mode=${options.mode} status=${oneLine(options.status, 96)}`);
    console.warn('recommendation=retry_assess');
    console.warn(`reason=${oneLine((error as Error).message)}`);
    console.warn('authorization=driver_required');
    console.warn('END_NEXT_STEP');
    return null;
  }
}

export function __testing_resetAssessRenderer(): void {
  renderedInProcess = false;
}
