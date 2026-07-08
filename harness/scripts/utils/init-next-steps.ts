// ============================================================================
// init-next-steps.ts — deriveInitNextSteps + renderNextStepsMarkdown
// ============================================================================

import * as path from 'path';

import {
  probeModuleGraphReadiness as probeModuleGraphReadinessByCatalogState,
  type ModuleGraphReadiness,
  type ModuleGraphReadinessState,
} from '../../code-graph/module-graph-probe';
import { resolveProbeFrameworkRoot } from '../../repo-layout';
import { listWorkflowPhases, resolveWorkflowSpec, type WorkflowSpec } from '../../workflow-loader';
import { resolvePhaseChain } from './runtime-policy';
import type { InitTaskPlan, TaskScope } from './init-task-planner';
import {
  describeCatalogError,
  loadCatalog,
  type CatalogLoadError,
} from './catalog-parser';
import {
  describeGlossaryError,
  loadGlossary,
  type GlossaryLoadError,
} from './glossary-parser';
import {
  findIndexStepByWorkflowArtifact,
  listExpandedInitNextStepDefs,
  type ExpandedInitNextStepDef,
  type SkillIndexInitNextStep,
} from './skills-index-init-steps';
import { loadSkillsIndex } from './resolve-skill-path';
import { resolveMaterializedBuiltinSkillEntryRel } from './instance-skill-bridge';

export type InitNextStepSource = 'index' | 'harness';

export interface InitNextStep {
  step_id: string;
  source: InitNextStepSource;
  when: string;
  kind: 'required' | 'optional';
  priority: number;
  message: string;
  skill_id?: string;
  invoke?: {
    neutral: string;
    command_id: string;
    param_hint?: string | null;
    availability_note?: string;
  };
  workflow_artifact?: string;
}

export interface InitNextStepsMinContext {
  projectRoot: string;
  harnessRoot: string;
  scope: TaskScope;
  materialized_adapters?: string[];
}

export interface InitNextStepsContext extends InitNextStepsMinContext {
  frameworkRoot: string;
  plan?: InitTaskPlan;
  workflowSpec?: WorkflowSpec;
}

type ReadinessState = 'missing' | 'empty' | 'corrupt' | 'ready';

export interface CatalogReadiness {
  state: ReadinessState;
  error?: CatalogLoadError;
}

export interface GlossaryReadiness {
  state: ReadinessState;
  error?: GlossaryLoadError;
}

export type { ModuleGraphReadiness, ModuleGraphReadinessState };

export function probeModuleGraphReadiness(
  projectRoot: string,
  catalog: CatalogReadiness,
): ModuleGraphReadiness {
  return probeModuleGraphReadinessByCatalogState(projectRoot, catalog.state);
}

export interface InitRunLogEntryLike {
  task_id: string;
  action: string;
  status: 'executed' | 'skipped' | 'failed';
  message: string;
  reason?: string;
}

export interface InitRunLogLike {
  entries: InitRunLogEntryLike[];
  materialized_adapters?: string[];
}

const RERUN_FRAMEWORK_INIT = '修复后重新执行 `/framework-init`';
const MODULE_GRAPH_REPAIR_FOOTER =
  '请修复 code-graph 产物或重新执行 code-graph，随后重新运行受阻的后续 phase 校验。';

function renderMessageAsListItemLines(message: string): string[] {
  const out: string[] = [];
  for (const line of message.split('\n')) {
    if (line.trim() === '') continue;
    if (out.length === 0) {
      out.push(line.startsWith('- ') ? line : `- ${line}`);
      continue;
    }
    out.push(`  ${line}`);
  }
  return out;
}

export function isBlockerInitLog(log: InitRunLogLike): boolean {
  if (log.entries.some(e => e.status === 'failed')) return true;
  if (log.entries.some(e => e.reason === 'preflight_blocked')) return true;
  if (
    log.entries.some(
      e => e.task_id === '<materialized-adapters>' && e.action === 'validate',
    )
  ) {
    return true;
  }
  return false;
}

function collectBlockerMessages(entries: InitRunLogEntryLike[]): string[] {
  const lines: string[] = [];
  for (const e of entries) {
    if (e.status !== 'failed') continue;
    if (e.task_id === '<materialized-adapters>' && e.action === 'validate') {
      lines.push(`materialized_adapters: ${e.message}`);
    } else {
      lines.push(`${e.task_id}: ${e.message}`);
    }
  }
  return [...new Set(lines)];
}

function synthesizeFailureRecovery(log: InitRunLogLike): InitNextStep[] {
  const bullets = collectBlockerMessages(log.entries);
  const body =
    bullets.length > 0
      ? `以下 init 任务失败需先修复：\n${bullets.map(b => `- ${b}`).join('\n')}\n\n${RERUN_FRAMEWORK_INIT}`
      : RERUN_FRAMEWORK_INIT;
  return [
    {
      step_id: 'failure-recovery',
      source: 'harness',
      when: 'failure_recovery',
      kind: 'required',
      priority: 0,
      message: body,
    },
  ];
}

export function probeCatalogReadiness(projectRoot: string): CatalogReadiness {
  try {
    const result = loadCatalog(projectRoot);
    if (!result.ok) {
      if (result.error.kind === 'file_not_found') {
        return { state: 'missing' };
      }
      return { state: 'corrupt', error: result.error };
    }
    if (result.catalog.modules.length === 0) {
      return { state: 'empty' };
    }
    return { state: 'ready' };
  } catch (err) {
    return {
      state: 'corrupt',
      error: {
        kind: 'invalid_schema',
        message: (err as Error).message,
      },
    };
  }
}

export function probeGlossaryReadiness(projectRoot: string): GlossaryReadiness {
  try {
    const result = loadGlossary(projectRoot);
    if (!result.ok) {
      if (result.error.kind === 'file_not_found') {
        return { state: 'missing' };
      }
      return { state: 'corrupt', error: result.error };
    }
    if (result.glossary.terms.length === 0) {
      return { state: 'empty' };
    }
    return { state: 'ready' };
  } catch (err) {
    return {
      state: 'corrupt',
      error: {
        kind: 'invalid_schema',
        message: (err as Error).message,
      },
    };
  }
}

function synthesizeCorruptStep(
  when: 'catalog_corrupt' | 'glossary_corrupt',
  describe: string,
): InitNextStep {
  return {
    step_id: when,
    source: 'harness',
    when,
    kind: 'required',
    priority: 5,
    message: `${describe}\n\n须先修复文件后再继续；${RERUN_FRAMEWORK_INIT}`,
  };
}

function synthesizeModuleGraphRepairStep(mg: ModuleGraphReadiness): InitNextStep {
  const when =
    mg.state === 'blocked' ? 'module-graph_blocked' : 'module-graph_corrupt';
  const subject = mg.module
    ? `模块 ${mg.module} 的 code-graph.yaml`
    : 'code-graph.yaml';
  const qualifier = mg.state === 'blocked' ? '未通过漂移门禁' : '无效';
  return {
    step_id: when,
    source: 'harness',
    when,
    kind: 'required',
    priority: 5,
    message: `${subject} ${qualifier}：${mg.error ?? '未知错误'}。\n\n${MODULE_GRAPH_REPAIR_FOOTER}`,
  };
}

function formatIndexMessage(
  def: ExpandedInitNextStepDef,
  paramValue?: string,
): string {
  const { step, enclosingSkillId } = def;
  let msg = step.invoke.neutral;
  if (step.invoke.param_hint && paramValue) {
    msg += `（${paramValue}）`;
  } else if (step.invoke.param_hint && !paramValue) {
    msg += ` ${step.invoke.param_hint}`;
  }
  if (step.invoke.availability_note) {
    msg += ` — ${step.invoke.availability_note}`;
  }
  return msg;
}

function indexStepToInitNextStep(
  def: ExpandedInitNextStepDef,
  paramValue?: string,
): InitNextStep {
  const { step, enclosingSkillId } = def;
  return {
    step_id: `${enclosingSkillId}:${step.step_id}`,
    source: 'index',
    when: step.when,
    kind: step.kind,
    priority: step.priority,
    message: formatIndexMessage(def, paramValue),
    skill_id: enclosingSkillId,
    invoke: {
      neutral: step.invoke.neutral,
      command_id: step.invoke.command_id,
      param_hint: step.invoke.param_hint,
      availability_note: step.invoke.availability_note,
    },
    workflow_artifact: step.workflow_artifact,
  };
}

function globalArtifactReady(
  artifactId: string,
  catalog: CatalogReadiness,
  glossary: GlossaryReadiness,
  moduleGraph: ModuleGraphReadiness,
): boolean {
  if (artifactId === 'catalog') {
    return catalog.state === 'ready';
  }
  if (artifactId === 'glossary') {
    return glossary.state === 'ready';
  }
  if (artifactId === 'module-graph') {
    return moduleGraph.state === 'ready';
  }
  return false;
}

export function findFirstLaunchableFeatureArtifact(
  spec: WorkflowSpec,
  catalog: CatalogReadiness,
  glossary: GlossaryReadiness,
  moduleGraph: ModuleGraphReadiness,
): string | undefined {
  // 默认入口建议只看 full 轨（lite-only phase 由 track 路由进入，不作 init 首步建议——C1）
  const order = resolvePhaseChain(spec, 'full').ordered;
  for (const phaseId of order) {
    const artifact = spec.artifacts.find(a => a.id === phaseId);
    if (!artifact || artifact.scope !== 'feature') continue;
    const reqsReady = artifact.requires.every(r =>
      globalArtifactReady(r, catalog, glossary, moduleGraph),
    );
    if (reqsReady) return phaseId;
  }
  return undefined;
}

function shouldSuggestInitRerun(log: InitRunLogLike, plan?: InitTaskPlan): boolean {
  if (isBlockerInitLog(log)) return false;
  if (!plan) return false;

  for (const task of plan.tasks) {
    if (!task.id.startsWith('materialize-adapter:')) continue;
    if (task.status !== 'needed') continue;
    const entry = log.entries.find(e => e.task_id === task.id);
    if (!entry) continue;
    if (entry.status === 'executed') continue;
    if (entry.reason === 'drift_default_keep') continue;
    if (entry.reason === 'satisfied') continue;
    return true;
  }
  return false;
}

function indexStepHasExecutableEntry(ctx: InitNextStepsContext, step: InitNextStep): boolean {
  if (step.source !== 'index' || !step.skill_id || !step.invoke) {
    return true;
  }
  const adapters = ctx.materialized_adapters ?? [];
  if (adapters.length === 0) {
    return true;
  }
  for (const adapter of adapters) {
    const entry = resolveMaterializedBuiltinSkillEntryRel(
      ctx.projectRoot,
      ctx.frameworkRoot,
      adapter,
      step.skill_id,
      step.invoke.command_id,
    );
    if (entry?.exists) {
      return true;
    }
  }
  return false;
}

function filterIndexStepsByEntryAvailability(
  ctx: InitNextStepsContext,
  steps: InitNextStep[],
): { steps: InitNextStep[]; suppressedOptional: boolean } {
  const filtered: InitNextStep[] = [];
  let suppressedOptional = false;
  for (const step of steps) {
    if (step.source === 'index' && step.kind === 'optional') {
      if (indexStepHasExecutableEntry(ctx, step)) {
        filtered.push(step);
      } else {
        suppressedOptional = true;
      }
      continue;
    }
    filtered.push(step);
  }
  return { steps: filtered, suppressedOptional };
}

function evaluateIndexSteps(ctx: InitNextStepsContext): InitNextStep[] {
  const index = loadSkillsIndex(ctx.frameworkRoot, true);
  const defs = listExpandedInitNextStepDefs(index);
  const catalog = probeCatalogReadiness(ctx.projectRoot);
  const glossary = probeGlossaryReadiness(ctx.projectRoot);
  const moduleGraph = probeModuleGraphReadiness(ctx.projectRoot, catalog);
  const out: InitNextStep[] = [];

  if (catalog.state === 'corrupt') {
    return [
      synthesizeCorruptStep(
        'catalog_corrupt',
        describeCatalogError(catalog.error!),
      ),
    ];
  }
  if (glossary.state === 'corrupt') {
    return [
      synthesizeCorruptStep(
        'glossary_corrupt',
        describeGlossaryError(glossary.error!),
      ),
    ];
  }
  if (moduleGraph.state === 'corrupt' || moduleGraph.state === 'blocked') {
    return [synthesizeModuleGraphRepairStep(moduleGraph)];
  }

  for (const def of defs) {
    const { step } = def;
    if (step.when === 'catalog_empty') {
      if (catalog.state === 'missing' || catalog.state === 'empty') {
        out.push(indexStepToInitNextStep(def));
      }
    } else if (step.when === 'glossary_empty') {
      if (
        (catalog.state === 'ready') &&
        (glossary.state === 'missing' || glossary.state === 'empty')
      ) {
        out.push(indexStepToInitNextStep(def));
      }
    } else if (step.when === 'graph_gap') {
      if (moduleGraph.state === 'gap' && moduleGraph.module) {
        out.push(indexStepToInitNextStep(def, moduleGraph.module));
      }
    } else if (step.when === 'feature_ready') {
      // handled after loop via workflow artifact lookup
    }
  }

  const spec =
    ctx.workflowSpec ??
    resolveWorkflowSpec(ctx.projectRoot, { frameworkRoot: ctx.frameworkRoot });
  const firstFeature = findFirstLaunchableFeatureArtifact(spec, catalog, glossary, moduleGraph);
  if (firstFeature) {
    const featureDef = findIndexStepByWorkflowArtifact(
      index,
      'feature_ready',
      firstFeature,
    );
    if (featureDef) {
      out.push(indexStepToInitNextStep(featureDef));
    }
  }

  for (const def of defs) {
    if (def.step.when === 'always_optional') {
      out.push(indexStepToInitNextStep(def));
    }
  }

  return out.sort((a, b) => a.priority - b.priority);
}

function synthesizeInitRerun(): InitNextStep {
  return {
    step_id: 'init-rerun',
    source: 'harness',
    when: 'init_rerun',
    kind: 'required',
    priority: 15,
    message: `仍有 adapter 物化或入口未完成。${RERUN_FRAMEWORK_INIT}`,
  };
}

export function deriveInitNextSteps(
  log: InitRunLogLike,
  ctx?: InitNextStepsContext,
): InitNextStep[] {
  if (isBlockerInitLog(log)) {
    return synthesizeFailureRecovery(log);
  }

  if (!ctx?.frameworkRoot) {
    return [];
  }

  if (ctx.scope === 'personal') {
    return [];
  }

  let steps = evaluateIndexSteps(ctx);

  const { steps: filtered, suppressedOptional } = filterIndexStepsByEntryAvailability(ctx, steps);
  steps = filtered;

  const needsInitRerun = shouldSuggestInitRerun(log, ctx.plan) || suppressedOptional;
  if (needsInitRerun && !steps.some(s => s.when === 'init_rerun')) {
    steps.push(synthesizeInitRerun());
    steps.sort((a, b) => a.priority - b.priority);
  }

  return steps;
}

export interface RenderNextStepsOptions {
  materializedAdapters?: string[];
  projectRoot?: string;
  frameworkRoot?: string;
}

export function renderNextStepsMarkdown(
  steps: InitNextStep[],
  options: RenderNextStepsOptions = {},
): string {
  if (steps.length === 0) {
    return '## 可选下一步\n\ninit 已完成，暂无额外前置建议。';
  }

  const required = steps.filter(s => s.kind === 'required');
  const optional = steps.filter(s => s.kind === 'optional');
  const lines: string[] = [];

  if (required.length > 0) {
    lines.push('## 必须处理', '');
    for (const s of required) {
      lines.push(...renderMessageAsListItemLines(s.message));
      lines.push('');
    }
  }

  if (optional.length > 0) {
    lines.push('## 可选下一步', '');
    for (const s of optional) {
      lines.push(...renderMessageAsListItemLines(s.message));
    }
    lines.push('');
  }

  const indexSteps = steps.filter(s => s.source === 'index' && s.skill_id && s.invoke);
  const materializedAdapters = options.materializedAdapters;
  if (indexSteps.length > 0 && materializedAdapters?.length && options.projectRoot) {
    const frameworkRoot =
      options.frameworkRoot ?? resolveProbeFrameworkRoot(options.projectRoot);
    lines.push('### 本实例调用方式', '');
    for (const s of indexSteps) {
      lines.push(`- **${s.invoke!.neutral}** (\`${s.skill_id}\` / \`${s.invoke!.command_id}\`):`);
      for (const adapter of materializedAdapters) {
        const entry = resolveMaterializedBuiltinSkillEntryRel(
          options.projectRoot,
          frameworkRoot,
          adapter,
          s.skill_id!,
          s.invoke!.command_id,
        );
        if (!entry?.exists) {
          continue;
        }
        if (adapter === 'claude') {
          lines.push(`  - claude: \`/${s.invoke!.command_id}\` → \`${entry.rel}\``);
        } else {
          lines.push(`  - ${adapter}: \`${entry.rel}\``);
        }
      }
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

export function resolveFeatureReadyStepForArtifact(
  frameworkDir: string,
  workflowArtifactId: string,
  spec?: WorkflowSpec,
): ExpandedInitNextStepDef | undefined {
  const index = loadSkillsIndex(frameworkDir, true);
  return findIndexStepByWorkflowArtifact(index, 'feature_ready', workflowArtifactId);
}

export { findIndexStepByWorkflowArtifact, loadDefaultWorkflowSpec } from './skills-index-init-steps';