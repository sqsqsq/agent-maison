// ============================================================================
// init-orchestrate.ts — enum decision JSON 执行 + run-log + 摘要
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { prepareConfigWriteForTask, readExistingConfigFromDisk } from './utils/config-builder';
import {
  executeInitTask,
  type InitExecutionContext,
} from './utils/init-task-executor';
import type {
  CleanupEffects,
  CleanupResult,
  FileEffects,
  SyncTemplateResult,
} from './utils/init-sync-telemetry';
import { formatFileEffectsCounts } from './utils/init-sync-telemetry';
import {
  type InitTask,
  type InitTaskPlan,
  prepareInitExecutionPlanWithStaleIds,
  probeInitTaskPlan,
  type TaskScope,
} from './utils/init-task-planner';
import type { InitNextStep } from './utils/init-next-steps';
import { isBlockerInitLog, renderNextStepsMarkdown } from './utils/init-next-steps';
import {
  buildInitNextStepsMinContext,
  buildInitNextStepsPhase1Context,
  writeRunArtifacts,
} from './utils/finalize-init-run-log';

export type DecisionMode = 'smart' | 'manual';

export interface TaskDecision {
  task_id: string;
  action: 'run' | 'skip' | 'overwrite' | 'keep';
}

export interface InitRunDecision {
  schema_version: '1.0';
  scope: TaskScope;
  decision_mode: DecisionMode;
  plan_generated_at: string;
  tasks: TaskDecision[];
  /** project 作用域：S2 init.materialized_adapters 本轮选定（preflight 必填）；personal 可省略 */
  materialized_adapters?: string[];
}

export type InitRunLogSkipReason =
  | 'satisfied'
  | 'drift_default_keep'
  | 'decision_skip'
  | 'keep'
  | 'preflight_blocked'
  | 'dependency_blocked';

export interface InitRunLogEntry {
  task_id: string;
  action: string;
  status: 'executed' | 'skipped' | 'failed';
  message: string;
  reason?: InitRunLogSkipReason;
  category?: string;
  title?: string;
  target_path?: string;
  file_effects?: FileEffects;
  file_results?: SyncTemplateResult[];
  cleanup_results?: CleanupResult[];
  cleanup_effects?: CleanupEffects;
}

export interface InitRunLogAuditMeta {
  mode?: 'create' | 'update';
  plan_generated_at?: string;
  project_root?: string;
  materialized_adapters?: string[];
}

export interface InitRunLog extends InitRunLogAuditMeta {
  schema_version: '1.0';
  scope: TaskScope;
  started_at: string;
  finished_at: string;
  decision_mode: DecisionMode;
  entries: InitRunLogEntry[];
  next_steps?: InitNextStep[];
}

export interface InitStagingTemplate {
  decision: InitRunDecision;
  context: Omit<InitExecutionContext, 'projectRoot' | 'harnessRoot' | 'plan'>;
}

const VALID_ACTIONS = new Set(['run', 'skip', 'overwrite', 'keep']);
const VALID_SCOPES = new Set<TaskScope>(['project', 'personal']);
const VALID_DECISION_MODES = new Set<DecisionMode>(['smart', 'manual']);
const DEFAULT_GENERIC_BUNDLE_ROOT = '.agents';
const DEFAULT_GENERIC_BUNDLE_SKILL_MODE = 'bridge';

const CONTEXT_RESERVED_KEYS = ['projectRoot', 'harnessRoot', 'plan'] as const;
const CONTEXT_STAGING_META_KEYS = ['schema_version', 'scope'] as const;

const DOC_PAYLOAD_KEY_BY_TASK: Record<
  string,
  keyof NonNullable<InitExecutionContext['docWritePayload']>
> = {
  'write-architecture': 'architecture_md',
  'ensure-catalog': 'module_catalog',
  'ensure-glossary': 'glossary_yaml',
  'ensure-glossary-seed': 'glossary_seed',
};

/** 统一 staging context：保留 payload，剥离 CLI/plan 与 staging 元数据 */
export function normalizeStagingContext(
  raw?: Omit<InitExecutionContext, 'projectRoot' | 'harnessRoot' | 'plan'>,
): Omit<InitExecutionContext, 'projectRoot' | 'harnessRoot' | 'plan'> | undefined {
  if (!raw) return undefined;
  const cloned = { ...(raw as Record<string, unknown>) };
  for (const k of [...CONTEXT_RESERVED_KEYS, ...CONTEXT_STAGING_META_KEYS]) {
    delete cloned[k];
  }
  return cloned as Omit<InitExecutionContext, 'projectRoot' | 'harnessRoot' | 'plan'>;
}

/** 剥离 staging context 中不得出现的 CLI/plan 字段（防覆盖 execute 路径） */
export function stripContextReservedFields(
  context?: Omit<InitExecutionContext, 'projectRoot' | 'harnessRoot' | 'plan'>,
): Omit<InitExecutionContext, 'projectRoot' | 'harnessRoot' | 'plan'> | undefined {
  return normalizeStagingContext(context);
}

function pickFirstAllowedAction(
  task: InitTask,
  candidates: TaskDecision['action'][],
): TaskDecision['action'] {
  for (const action of candidates) {
    if (task.allowed_actions.includes(action)) return action;
  }
  throw new Error(
    `[init-orchestrate] 无法为任务 ${task.id} 解析 action（允许: ${task.allowed_actions.join(',')}）`,
  );
}

function resolveSmartImplicitAction(task: InitTask): TaskDecision['action'] {
  if (task.status === 'satisfied' && task.allowed_actions.includes('skip')) return 'skip';
  if (task.status === 'drift') {
    return pickFirstAllowedAction(task, ['overwrite', 'keep', 'skip']);
  }
  if (task.default_action === 'skip' && task.allowed_actions.includes('skip')) return 'skip';
  return pickFirstAllowedAction(task, ['run', 'overwrite', 'keep', 'skip']);
}

function buildSkippedEntry(
  task: InitTask,
  action: TaskDecision['action'],
): Pick<InitRunLogEntry, 'message' | 'reason'> {
  if (action === 'keep') {
    return { message: '保留当前磁盘内容', reason: 'keep' };
  }
  if (task.status === 'satisfied') {
    return { message: '已满足，跳过', reason: 'satisfied' };
  }
  if (task.status === 'drift' && task.default_action === 'skip' && action === 'skip') {
    return { message: 'drift 默认保留，跳过', reason: 'drift_default_keep' };
  }
  return { message: '决策 skip，未执行', reason: 'decision_skip' };
}

export function buildRunLogAuditMeta(options: {
  plan: InitTaskPlan;
  decision: InitRunDecision;
  projectRoot?: string;
}): InitRunLogAuditMeta {
  const adapters = normalizeDecisionMaterializedAdapters(options.decision);
  return {
    mode: options.plan.mode,
    plan_generated_at: options.decision.plan_generated_at,
    ...(options.projectRoot ? { project_root: options.projectRoot } : {}),
    ...(adapters.length ? { materialized_adapters: adapters } : {}),
  };
}

export function normalizeDecisionMaterializedAdapters(decision: InitRunDecision): string[] {
  const raw = decision.materialized_adapters ?? [];
  return [
    ...new Set(
      raw.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map(x => x.trim()),
    ),
  ];
}

/** S3：以 decision 清单为准同步进 execution context（再交给 planner） */
export function syncDecisionAdaptersIntoContext(
  decision: InitRunDecision,
  context?: Omit<InitExecutionContext, 'projectRoot' | 'harnessRoot' | 'plan'>,
): Omit<InitExecutionContext, 'projectRoot' | 'harnessRoot' | 'plan'> {
  const base = stripContextReservedFields(context) ?? {};
  if (decision.scope !== 'project') return base;
  const adapters = normalizeDecisionMaterializedAdapters(decision);
  if (!adapters.length) return base;
  const out: Omit<InitExecutionContext, 'projectRoot' | 'harnessRoot' | 'plan'> = {
    ...base,
    materializedAdapters: adapters,
  };
  if (out.configWritePayload && typeof out.configWritePayload === 'object') {
    out.configWritePayload = {
      ...out.configWritePayload,
      materialized_adapters: adapters,
    };
  }
  return out;
}

function collectMaterializedAdapters(
  context?: Omit<InitExecutionContext, 'projectRoot' | 'harnessRoot' | 'plan'>,
): string[] {
  const fromCtx = (context?.materializedAdapters ?? []).filter(
    (x): x is string => typeof x === 'string' && x.trim().length > 0,
  );
  if (fromCtx.length > 0) return [...new Set(fromCtx.map(x => x.trim()))];
  const payloadAdapters = context?.configWritePayload?.materialized_adapters;
  if (Array.isArray(payloadAdapters)) {
    return [
      ...new Set(
        payloadAdapters.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
          .map(x => x.trim()),
      ),
    ];
  }
  return [];
}

function withInitContextDefaults(
  context?: Omit<InitExecutionContext, 'projectRoot' | 'harnessRoot' | 'plan'>,
): Omit<InitExecutionContext, 'projectRoot' | 'harnessRoot' | 'plan'> {
  const cloned = context
    ? (JSON.parse(JSON.stringify(context)) as Omit<InitExecutionContext, 'projectRoot' | 'harnessRoot' | 'plan'>)
    : {};
  const adapters = collectMaterializedAdapters(cloned);
  if (adapters.includes('generic') && cloned.configWritePayload) {
    const payload = cloned.configWritePayload;
    const paths =
      payload.paths && typeof payload.paths === 'object' && !Array.isArray(payload.paths)
        ? { ...(payload.paths as Record<string, unknown>) }
        : {};
    if (typeof paths.agent_bundle_root !== 'string' || !paths.agent_bundle_root.trim()) {
      paths.agent_bundle_root = DEFAULT_GENERIC_BUNDLE_ROOT;
    }
    // init 写盘 SSOT：generic bundle skills 恒为 bridge 薄跳板（勿回退 inline 全量物化）
    paths.agent_bundle_skill_mode = DEFAULT_GENERIC_BUNDLE_SKILL_MODE;
    payload.paths = paths;
  }
  return cloned;
}

function resolveTemplateAction(task: InitTask): TaskDecision['action'] {
  if (task.status === 'satisfied' && task.allowed_actions.includes('skip')) return 'skip';
  if (task.status === 'drift') {
    if (task.allowed_actions.includes('overwrite')) return 'overwrite';
    if (task.allowed_actions.includes('keep')) return 'keep';
    if (task.allowed_actions.includes('skip')) return 'skip';
  }
  if (task.default_action === 'skip' && task.allowed_actions.includes('skip')) return 'skip';
  if (task.allowed_actions.includes('run')) return 'run';
  if (task.allowed_actions.includes('overwrite')) return 'overwrite';
  if (task.allowed_actions.includes('keep')) return 'keep';
  if (task.allowed_actions.includes('skip')) return 'skip';
  throw new Error(`[init-orchestrate] 无法为任务生成 staging action: ${task.id}`);
}

/** UPDATE：从磁盘 config 提取最小语义 payload（不含 builder 自动注入项） */
const KNOWN_EXPORTS_CANONICAL: Record<string, string> = {
  'Index.ets': 'index.ets',
  'INDEX.ETS': 'index.ets',
  Index: 'index',
  INDEX: 'index',
};

export function validateMaterializedAdapterSetsCrossCheck(
  primary: string[],
  secondary: string[],
  labelPrimary: string,
  labelSecondary: string,
): string | null {
  const fromPrimary = [
    ...new Set(primary.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim())),
  ];
  const fromSecondary = [
    ...new Set(secondary.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim())),
  ];
  if (!fromSecondary.length) return null;
  const a = new Set(fromPrimary);
  const b = new Set(fromSecondary);
  if (a.size !== b.size || [...a].some(x => !b.has(x))) {
    return `materialized_adapters 不一致：${labelPrimary} 与 ${labelSecondary} 清单不匹配`;
  }
  return null;
}

export function deriveUpdateConfigWritePayload(
  projectRoot: string,
  materializedAdapters: string[],
): Record<string, unknown> | undefined {
  const existing = readExistingConfigFromDisk(projectRoot);
  if (!existing) return undefined;

  const payload: Record<string, unknown> = {};
  if (typeof existing.project_name === 'string' && existing.project_name.trim()) {
    payload.project_name = existing.project_name.trim();
  }
  if (
    existing.project_profile &&
    typeof existing.project_profile === 'object' &&
    !Array.isArray(existing.project_profile)
  ) {
    payload.project_profile = JSON.parse(JSON.stringify(existing.project_profile));
  }
  if (
    existing.architecture &&
    typeof existing.architecture === 'object' &&
    !Array.isArray(existing.architecture)
  ) {
    const archClone = JSON.parse(JSON.stringify(existing.architecture)) as Record<string, unknown>;
    if (typeof archClone.cross_module_exports_file === 'string') {
      const current = archClone.cross_module_exports_file;
      if (KNOWN_EXPORTS_CANONICAL[current]) {
        archClone.cross_module_exports_file = KNOWN_EXPORTS_CANONICAL[current];
      }
    }
    payload.architecture = archClone;
  }
  if (existing.paths && typeof existing.paths === 'object' && !Array.isArray(existing.paths)) {
    const clonedPaths = JSON.parse(JSON.stringify(existing.paths)) as Record<string, unknown>;
    // inline 已彻底废弃：从磁盘派生 payload 时把残留 inline 归一为 bridge，
    // 避免 staging 模板 / 执行 payload 把历史污染再写回 config。
    if (
      clonedPaths.agent_bundle_skill_mode !== undefined &&
      clonedPaths.agent_bundle_skill_mode !== 'bridge'
    ) {
      clonedPaths.agent_bundle_skill_mode = 'bridge';
    }
    payload.paths = clonedPaths;
  }
  if (existing.tools && typeof existing.tools === 'object' && !Array.isArray(existing.tools)) {
    payload.tools = JSON.parse(JSON.stringify(existing.tools));
  }

  // 仅当调用方显式传入 decision adapters（execute SSOT）时写入 payload；
  // emit 预填不得从磁盘带入 materialized_adapters，否则会与 S2 decision 冲突触发 cross-check。
  const adapters = materializedAdapters
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .map(x => x.trim());
  if (adapters.length) {
    payload.materialized_adapters = [...new Set(adapters)];
  }

  if (!payload.project_name && !payload.architecture) return undefined;
  return payload;
}

export interface DeriveBaseContextResult {
  baseContext: Omit<InitExecutionContext, 'projectRoot' | 'harnessRoot' | 'plan'>;
  crossCheckError: string | null;
}

/** Phase 1：strip → cross-check(pre-sync) → sync adapters → defaults */
export function deriveBaseContextForPlanning(
  rawContext: Omit<InitExecutionContext, 'projectRoot' | 'harnessRoot' | 'plan'> | undefined,
  decision: InitRunDecision,
): DeriveBaseContextResult {
  const stripped = stripContextReservedFields(rawContext) ?? {};
  const crossCheckError = validateMaterializedAdaptersCrossCheck(decision, stripped);
  const synced = syncDecisionAdaptersIntoContext(decision, stripped);
  return {
    baseContext: withInitContextDefaults(synced),
    crossCheckError,
  };
}

/** Phase 2：plan 已知 mode 后补 configWritePayload（S2 显式优先） */
export function deriveContextForExecution(
  baseContext: Omit<InitExecutionContext, 'projectRoot' | 'harnessRoot' | 'plan'>,
  plan: InitTaskPlan,
  projectRoot: string,
  decisionAdapters: string[],
): Omit<InitExecutionContext, 'projectRoot' | 'harnessRoot' | 'plan'> {
  if (plan.mode !== 'update') return baseContext;
  if (baseContext.configWritePayload) return baseContext;
  const derived = deriveUpdateConfigWritePayload(projectRoot, decisionAdapters);
  if (!derived) return baseContext;
  return { ...baseContext, configWritePayload: derived };
}

export function buildInitStagingTemplate(
  plan: InitTaskPlan,
  context?: Omit<InitExecutionContext, 'projectRoot' | 'harnessRoot' | 'plan'>,
  decisionMode: DecisionMode = 'smart',
  projectRoot?: string,
): InitStagingTemplate {
  let normalizedContext = withInitContextDefaults(context);
  if (
    plan.mode === 'update' &&
    projectRoot?.trim() &&
    !normalizedContext.configWritePayload
  ) {
    const derived = deriveUpdateConfigWritePayload(projectRoot.trim(), []);
    if (derived) {
      normalizedContext = { ...normalizedContext, configWritePayload: derived };
    }
  }
  return {
    decision: {
      schema_version: '1.0',
      scope: plan.scope,
      decision_mode: decisionMode,
      plan_generated_at: plan.generated_at,
      tasks: plan.tasks.map(task => ({
        task_id: task.id,
        action: resolveTemplateAction(task),
      })),
      /** 待补全模板：须由 S2 init.materialized_adapters 替换为非空数组，否则 preflight 阻断 */
      materialized_adapters: [],
    },
    context: normalizedContext,
  };
}

/** 决策 JSON 结构 + 枚举守卫（JSON.parse 成功后立即调用） */
export function assertDecisionStructure(raw: unknown): InitRunDecision {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('[init-orchestrate] 决策 JSON 非法：根须为对象');
  }
  const o = raw as Record<string, unknown>;
  if (o.schema_version === undefined && (o.mode !== undefined || o.task_decisions !== undefined)) {
    throw new Error(
      '[init-orchestrate] 决策 JSON 非法：检测到旧 staging 结构（mode/task_decisions）。请使用 schema_version/scope/decision_mode/plan_generated_at/tasks[]/materialized_adapters，或运行 --emit-staging-template 生成骨架。',
    );
  }
  if (o.schema_version !== '1.0') {
    throw new Error(
      `[init-orchestrate] 决策 JSON 非法：schema_version 须为 "1.0"，当前=${String(o.schema_version ?? '<missing>')}`,
    );
  }
  if (typeof o.scope !== 'string' || !VALID_SCOPES.has(o.scope as TaskScope)) {
    throw new Error(
      `[init-orchestrate] 决策 JSON 非法：scope 须为 project|personal，当前=${String(o.scope ?? '<missing>')}`,
    );
  }
  if (
    typeof o.decision_mode !== 'string' ||
    !VALID_DECISION_MODES.has(o.decision_mode as DecisionMode)
  ) {
    throw new Error(
      `[init-orchestrate] 决策 JSON 非法：decision_mode 须为 smart|manual，当前=${String(o.decision_mode ?? '<missing>')}`,
    );
  }
  if (typeof o.plan_generated_at !== 'string' || !o.plan_generated_at.trim()) {
    throw new Error('[init-orchestrate] 决策 JSON 非法：plan_generated_at 缺失或非字符串');
  }
  if (!Array.isArray(o.tasks)) {
    throw new Error('[init-orchestrate] 决策 JSON 非法：tasks 缺失或非数组');
  }
  const tasks: TaskDecision[] = [];
  for (let i = 0; i < o.tasks.length; i++) {
    const item = o.tasks[i];
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`[init-orchestrate] 决策 JSON 非法：tasks[${i}] 须为对象`);
    }
    const t = item as Record<string, unknown>;
    if (typeof t.task_id !== 'string' || !t.task_id.trim()) {
      throw new Error(`[init-orchestrate] 决策 JSON 非法：tasks[${i}].task_id 缺失或非字符串`);
    }
    if (typeof t.action !== 'string' || !VALID_ACTIONS.has(t.action)) {
      throw new Error(
        `[init-orchestrate] 决策 JSON 非法：tasks[${i}].action 非法（允许: run,skip,overwrite,keep）`,
      );
    }
    tasks.push({ task_id: t.task_id, action: t.action as TaskDecision['action'] });
  }
  let materialized_adapters: string[] | undefined;
  if (o.materialized_adapters !== undefined) {
    if (!Array.isArray(o.materialized_adapters)) {
      throw new Error('[init-orchestrate] 决策 JSON 非法：materialized_adapters 须为数组');
    }
    materialized_adapters = [];
    for (let i = 0; i < o.materialized_adapters.length; i++) {
      const el = o.materialized_adapters[i];
      if (typeof el !== 'string' || !el.trim()) {
        throw new Error(
          `[init-orchestrate] 决策 JSON 非法：materialized_adapters[${i}] 须为非空 string`,
        );
      }
      materialized_adapters.push(el.trim());
    }
  }
  return {
    schema_version: '1.0',
    scope: o.scope as TaskScope,
    decision_mode: o.decision_mode as DecisionMode,
    plan_generated_at: o.plan_generated_at,
    tasks,
    ...(materialized_adapters !== undefined ? { materialized_adapters } : {}),
  };
}

function checkWriteTaskPayload(
  task: InitTask,
  action: TaskDecision['action'],
  context?: Omit<InitExecutionContext, 'projectRoot' | 'harnessRoot' | 'plan'>,
  projectRoot?: string,
): string | null {
  if (action === 'skip' || action === 'keep') return null;

  if (task.id === 'ensure-config') {
    if (!context?.configWritePayload) {
      return (
        'ensure-config：context.configWritePayload 缺失；须由 Skill S2 注入 JSON，或在 S2 决策 skip。' +
        ' UPDATE 模式下可重跑：cd framework/harness && npx ts-node scripts/init-orchestrate.ts ' +
        '--emit-staging-template --scope project --project-root <repo-root>（输出含磁盘 config 预填的 configWritePayload）'
      );
    }
    if (!projectRoot?.trim()) {
      return 'ensure-config：preflight 缺少 project_root（传 audit.project_root 或 preflightExecute options.projectRoot）';
    }
    try {
      prepareConfigWriteForTask(
        { projectRoot: projectRoot.trim(), configWritePayload: context.configWritePayload },
        action,
      );
    } catch (e) {
      return `ensure-config：config 校验失败：${(e as Error).message}`;
    }
    return null;
  }

  const docKey = DOC_PAYLOAD_KEY_BY_TASK[task.id];
  if (docKey) {
    const content = context?.docWritePayload?.[docKey]?.trim();
    if (!content) {
      return `${task.id}：context.docWritePayload.${docKey} 缺失；须由 Skill S2 注入内容，或在 S2 决策 skip`;
    }
  }
  return null;
}

function extractUnknownTaskId(error: string): string | undefined {
  const m = error.match(/未知 task_id:\s*(\S+)/);
  return m?.[1];
}

function validateMaterializedAdaptersCrossCheck(
  decision: InitRunDecision,
  context?: Omit<InitExecutionContext, 'projectRoot' | 'harnessRoot' | 'plan'>,
): string | null {
  if (decision.scope !== 'project') return null;
  const fromDecision = normalizeDecisionMaterializedAdapters(decision);
  const fromCtx = collectMaterializedAdapters(stripContextReservedFields(context));
  return validateMaterializedAdapterSetsCrossCheck(
    fromDecision,
    fromCtx,
    'decision',
    'context',
  );
}

function injectCliMaterializedAdaptersIntoContext(
  context: Omit<InitExecutionContext, 'projectRoot' | 'harnessRoot' | 'plan'> | undefined,
  cliAdapters: string[],
): Omit<InitExecutionContext, 'projectRoot' | 'harnessRoot' | 'plan'> | undefined {
  if (!cliAdapters.length) return context;
  const base = context ?? {};
  const out: Omit<InitExecutionContext, 'projectRoot' | 'harnessRoot' | 'plan'> = {
    ...base,
    materializedAdapters: cliAdapters,
  };
  if (out.configWritePayload && typeof out.configWritePayload === 'object') {
    out.configWritePayload = {
      ...out.configWritePayload,
      materialized_adapters: cliAdapters,
    };
  }
  return out;
}

function buildPreflightBlockedLog(
  plan: InitTaskPlan,
  decision: InitRunDecision,
  startedAt: string,
  violations: Array<{ task_id: string; action: string; message: string }>,
  decisionValidationFailed: boolean,
  audit?: InitRunLogAuditMeta,
): InitRunLog {
  const entries: InitRunLogEntry[] = [];
  const violationByTask = new Map(violations.map(v => [v.task_id, v]));

  if (decisionValidationFailed) {
    for (const v of violations) {
      entries.push({
        task_id: v.task_id,
        action: v.action,
        status: 'failed',
        message: v.message,
      });
    }
    for (const task of plan.tasks) {
      entries.push({
        task_id: task.id,
        action: 'skip',
        status: 'skipped',
        message: 'preflight 决策校验失败，未执行',
        reason: 'preflight_blocked',
      });
    }
  } else {
    for (const task of plan.tasks) {
      const v = violationByTask.get(task.id);
      if (v) {
        entries.push({
          task_id: task.id,
          action: v.action,
          status: 'failed',
          message: v.message,
        });
      } else {
        entries.push({
          task_id: task.id,
          action: 'skip',
          status: 'skipped',
          message: 'preflight 阻断，未执行',
          reason: 'preflight_blocked',
        });
      }
    }
  }

  return {
    schema_version: '1.0',
    scope: plan.scope,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    decision_mode: decision.decision_mode,
    entries,
    ...audit,
  };
}

export interface PreflightExecuteOptions {
  /** 实例工程根；优先于 audit.project_root（供程序化调用方显式传入） */
  projectRoot?: string;
}

function resolvePreflightProjectRoot(
  audit?: InitRunLogAuditMeta,
  options?: PreflightExecuteOptions,
): string | undefined {
  const fromOpt = options?.projectRoot?.trim();
  if (fromOpt) return fromOpt;
  return audit?.project_root?.trim() || undefined;
}

/** S3 执行前无副作用 preflight；失败返回 blocked run-log（零项目业务/机制写盘） */
export function preflightExecute(
  plan: InitTaskPlan,
  decision: InitRunDecision,
  context?: Omit<InitExecutionContext, 'projectRoot' | 'harnessRoot' | 'plan'>,
  audit?: InitRunLogAuditMeta,
  options?: PreflightExecuteOptions,
): { ok: true } | { ok: false; blocked: InitRunLog } {
  const started = new Date().toISOString();
  const normalizedContext = withInitContextDefaults(context);
  const validation = validateDecisionJson(plan, decision);
  if (!validation.ok) {
    const unknownId = extractUnknownTaskId(validation.error);
    return {
      ok: false,
      blocked: buildPreflightBlockedLog(
        plan,
        decision,
        started,
        [
          {
            task_id: unknownId ?? '<decision-validation>',
            action: 'validate',
            message: validation.error,
          },
        ],
        true,
        audit,
      ),
    };
  }

  const adapterMismatch = validateMaterializedAdaptersCrossCheck(decision, normalizedContext);
  if (adapterMismatch) {
    return {
      ok: false,
      blocked: buildPreflightBlockedLog(
        plan,
        decision,
        started,
        [
          {
            task_id: '<materialized-adapters>',
            action: 'validate',
            message: adapterMismatch,
          },
        ],
        true,
        audit,
      ),
    };
  }

  const violations: Array<{ task_id: string; action: string; message: string }> = [];
  for (const task of plan.tasks) {
    let action: TaskDecision['action'];
    try {
      action = resolveTaskAction(task, decision);
    } catch (e) {
      violations.push({
        task_id: task.id,
        action: 'validate',
        message: (e as Error).message,
      });
      continue;
    }
    if (action === 'skip' || action === 'keep') continue;
    const msg = checkWriteTaskPayload(
      task,
      action,
      normalizedContext,
      resolvePreflightProjectRoot(audit, options),
    );
    if (msg) {
      violations.push({ task_id: task.id, action, message: msg });
    }
  }

  if (violations.length > 0) {
    return {
      ok: false,
      blocked: buildPreflightBlockedLog(plan, decision, started, violations, false, audit),
    };
  }

  return { ok: true };
}

function taskRequiresExplicitManualDecision(task: InitTask): boolean {
  return Boolean(task.decision_class) || task.default_action === 'prompt';
}

export function validateDecisionJson(
  plan: InitTaskPlan,
  decision: InitRunDecision,
): { ok: true } | { ok: false; error: string } {
  if (decision.scope !== plan.scope) {
    return { ok: false, error: `scope 不匹配：decision=${decision.scope} plan=${plan.scope}` };
  }
  const taskById = new Map(plan.tasks.map(t => [t.id, t]));
  const seen = new Set<string>();
  for (const d of decision.tasks) {
    if (!taskById.has(d.task_id)) {
      return { ok: false, error: `未知 task_id: ${d.task_id}` };
    }
    if (seen.has(d.task_id)) {
      return { ok: false, error: `重复 task_id: ${d.task_id}` };
    }
    seen.add(d.task_id);
    if (!VALID_ACTIONS.has(d.action)) {
      return { ok: false, error: `未知 action: ${d.action}` };
    }
    const task = taskById.get(d.task_id)!;
    if (!task.allowed_actions.includes(d.action as TaskDecision['action'])) {
      return {
        ok: false,
        error: `task ${d.task_id} 不允许 action=${d.action}（允许: ${task.allowed_actions.join(',')}）`,
      };
    }
  }

  for (const task of plan.tasks) {
    if (!task.skippable && decision.tasks.find(d => d.task_id === task.id)?.action === 'skip') {
      return { ok: false, error: `不可跳过任务被 skip: ${task.id}` };
    }
  }

  const skipIds = new Set(
    decision.tasks.filter(d => d.action === 'skip').map(d => d.task_id),
  );
  for (const task of plan.tasks) {
    if (skipIds.has(task.id)) continue;
    for (const dep of task.deps) {
      if (!skipIds.has(dep)) continue;
      const depTask = taskById.get(dep);
      if (depTask?.status === 'satisfied') continue;
      return { ok: false, error: `依赖闭包违反：${task.id} 依赖 ${dep} 但 ${dep} 被跳过` };
    }
  }

  if (decision.scope === 'project') {
    const adapters = normalizeDecisionMaterializedAdapters(decision);
    if (!adapters.length) {
      return {
        ok: false,
        error:
          'project 作用域 decision.materialized_adapters 缺失或为空；须经 init.materialized_adapters 多选收集本轮清单',
      };
    }
  }

  if (decision.decision_mode === 'manual') {
    for (const task of plan.tasks) {
      if (!taskRequiresExplicitManualDecision(task)) continue;
      if (!decision.tasks.some(d => d.task_id === task.id)) {
        return { ok: false, error: `manual 模式缺少显式决策：${task.id}` };
      }
    }
  }

  return { ok: true };
}

/** 仅剥离 staleMaterializeTaskIds 白名单内的 S1 残留物化 task；其它未知 task_id 保留供 validate 拒绝 */
export function reconcileInitRunDecisionForPlan(
  plan: InitTaskPlan,
  decision: InitRunDecision,
  options?: { staleMaterializeTaskIds?: readonly string[] },
): InitRunDecision {
  const planIds = new Set(plan.tasks.map(t => t.id));
  const stale = new Set(options?.staleMaterializeTaskIds ?? []);
  return {
    ...decision,
    tasks: decision.tasks.filter(d => {
      if (planIds.has(d.task_id)) return true;
      if (stale.has(d.task_id)) return false;
      return true;
    }),
  };
}

export function resolveTaskAction(
  task: InitTask,
  decision: InitRunDecision,
): TaskDecision['action'] {
  const explicit = decision.tasks.find(d => d.task_id === task.id);
  if (explicit) return explicit.action;
  if (decision.decision_mode === 'smart') {
    return resolveSmartImplicitAction(task);
  }
  if (task.default_action === 'skip') return 'skip';
  if (taskRequiresExplicitManualDecision(task)) {
    throw new Error(`[init-orchestrate] manual 模式缺少显式决策：${task.id}`);
  }
  return 'run';
}

export interface RunSummaryOptions {
  runLogPath?: string;
  summaryPath?: string;
  externalStaging?: string;
}

const CATEGORY_SUMMARY_ORDER = ['config', 'adapter', 'docs', 'mechanism', 'verify', 'personal'] as const;

const CATEGORY_SUMMARY_LABEL: Record<string, string> = {
  config: 'config',
  adapter: 'adapter',
  docs: 'docs',
  mechanism: 'mechanism',
  verify: 'verify',
  personal: 'personal',
};

function summaryCategoryKey(entry: InitRunLogEntry): string {
  const cat = entry.category ?? '';
  if (cat === 'config') return 'config';
  if (
    cat === 'adapter-bundle' ||
    cat === 'adapter-entry' ||
    cat === 'adapter-template' ||
    cat === 'adapter-template-sync'
  ) {
    return 'adapter';
  }
  if (cat === 'docs') return 'docs';
  if (cat === 'mechanism') return 'mechanism';
  if (cat === 'verify') return 'verify';
  if (cat === 'personal') return 'personal';
  return cat || 'other';
}

function formatEntryCategoryLine(entry: InitRunLogEntry): string {
  if (entry.cleanup_effects?.backup_deleted) {
    const backupHint = entry.message.includes('.framework-backup/')
      ? entry.message.match(/（备份 ([^）]+)）/)?.[1]
      : undefined;
    return backupHint
      ? `backup_deleted ${entry.cleanup_effects.backup_deleted}（备份 ${backupHint}）`
      : `backup_deleted ${entry.cleanup_effects.backup_deleted}`;
  }
  if (entry.file_effects) {
    const adapterMatch = entry.task_id.match(/^materialize-adapter:(.+)$/);
    if (adapterMatch) {
      return `${adapterMatch[1]}（${formatFileEffectsCounts(entry.file_effects)}）`;
    }
    return `${entry.task_id}（${formatFileEffectsCounts(entry.file_effects)}）`;
  }
  return `${entry.task_id} ${entry.action}`;
}

function buildCategorySummaryLines(entries: InitRunLogEntry[]): string[] {
  const grouped = new Map<string, string[]>();
  for (const entry of entries) {
    if (entry.status === 'skipped') {
      const key = summaryCategoryKey(entry);
      const bucket = grouped.get(key) ?? [];
      bucket.push(`${entry.task_id} skip`);
      grouped.set(key, bucket);
      continue;
    }
    if (entry.status !== 'executed') continue;
    const key = summaryCategoryKey(entry);
    const bucket = grouped.get(key) ?? [];
    bucket.push(formatEntryCategoryLine(entry));
    grouped.set(key, bucket);
  }

  const lines: string[] = ['## 类别摘要'];
  let any = false;
  for (const key of CATEGORY_SUMMARY_ORDER) {
    const items = grouped.get(key);
    if (!items?.length) continue;
    any = true;
    const label = CATEGORY_SUMMARY_LABEL[key] ?? key;
    if (key === 'docs') {
      const skipCount = items.filter(x => x.endsWith(' skip')).length;
      if (skipCount === items.length) {
        lines.push(`- ${label}: ${skipCount} 项保留磁盘（skip）`);
      } else {
        lines.push(`- ${label}: ${items.join(', ')}`);
      }
    } else {
      lines.push(`- ${label}: ${items.join(', ')}`);
    }
    grouped.delete(key);
  }
  for (const [key, items] of grouped) {
    any = true;
    lines.push(`- ${key}: ${items.join(', ')}`);
  }
  if (!any) {
    lines.push('- （无 executed/skipped 任务）');
  }
  return lines;
}

export function buildRunSummary(log: InitRunLog, options: RunSummaryOptions = {}): string {
  const lines: string[] = [
    `# Framework Init 执行摘要`,
    ``,
    `- scope: ${log.scope}`,
    `- decision_mode: ${log.decision_mode}`,
    `- started: ${log.started_at}`,
    `- finished: ${log.finished_at}`,
  ];
  if (log.mode) lines.push(`- mode: ${log.mode}`);
  if (log.project_root) lines.push(`- project_root: ${log.project_root}`);
  if (log.materialized_adapters?.length) {
    lines.push(`- materialized_adapters: ${JSON.stringify(log.materialized_adapters)}`);
  }
  if (options.runLogPath) lines.push(`- run_log: ${options.runLogPath}`);
  if (options.summaryPath) lines.push(`- summary: ${options.summaryPath}`);
  if (options.externalStaging) lines.push(`- external_staging: ${options.externalStaging}`);
  lines.push('', ...buildCategorySummaryLines(log.entries), '');
  lines.push(
    `| task_id | action | status | message |`,
    `|---------|--------|--------|---------|`,
  );
  for (const e of log.entries) {
    lines.push(`| ${e.task_id} | ${e.action} | ${e.status} | ${e.message.replace(/\|/g, '\\|')} |`);
  }
  const executed = log.entries.filter(e => e.status === 'executed').length;
  const skipped = log.entries.filter(e => e.status === 'skipped').length;
  const failed = log.entries.filter(e => e.status === 'failed').length;
  lines.push('');
  lines.push(`合计：executed=${executed} skipped=${skipped} failed=${failed}`);
  if (log.next_steps !== undefined) {
    lines.push('');
    lines.push(
      renderNextStepsMarkdown(log.next_steps, {
        materializedAdapters: log.materialized_adapters,
        projectRoot: log.project_root,
      }),
    );
  }
  return lines.join('\n');
}

function summaryPathForRunLog(runLogPath: string): string {
  return path.join(path.dirname(runLogPath), 'summary.md');
}

function summaryOptionsForCli(opts: ReturnType<typeof parseArgs>): Pick<RunSummaryOptions, 'externalStaging'> {
  return opts.smartAuto ? { externalStaging: '未创建（smart-auto 内部生成临时上下文）' } : {};
}

function writeInitRunAndPrint(
  log: InitRunLog,
  opts: ReturnType<typeof parseArgs>,
  finalize: {
    projectRoot: string;
    scope: TaskScope;
    plan?: InitTaskPlan;
    includePhase1: boolean;
  },
): string {
  const minCtx = buildInitNextStepsMinContext({
    projectRoot: finalize.projectRoot,
    harnessRoot: opts.harnessRoot,
    scope: finalize.scope,
    log,
  });
  const phase1Ctx =
    finalize.includePhase1 &&
    !isBlockerInitLog(log) &&
    finalize.scope === 'project'
      ? buildInitNextStepsPhase1Context(minCtx, {
          projectRoot: finalize.projectRoot,
          harnessRoot: opts.harnessRoot,
          plan: finalize.plan,
        })
      : undefined;
  const artifacts = writeRunArtifacts(opts.harnessRoot, log, buildRunSummary, {
    minCtx,
    phase1Ctx: phase1Ctx
      ? {
          frameworkRoot: phase1Ctx.frameworkRoot,
          plan: phase1Ctx.plan,
        }
      : undefined,
    summaryOptions: summaryOptionsForCli(opts),
  });
  process.stdout.write(`${artifacts.summary}\n`);
  process.stderr.write(`[init-orchestrate] run-log: ${artifacts.runLogPath}\n`);
  return artifacts.runLogPath;
}

export interface ExecuteOptions {
  projectRoot: string;
  harnessRoot: string;
  plan: InitTaskPlan;
  decision: InitRunDecision;
  executionContext?: Omit<InitExecutionContext, 'projectRoot' | 'harnessRoot' | 'plan'>;
}

/** 执行已校验决策 */
export function executeInitPlan(options: ExecuteOptions): InitRunLog {
  const validation = validateDecisionJson(options.plan, options.decision);
  if (!validation.ok) {
    throw new Error(`[init-orchestrate] 决策 JSON 非法：${validation.error}`);
  }

  const ctx: InitExecutionContext = {
    ...withInitContextDefaults(stripContextReservedFields(options.executionContext)),
    projectRoot: options.projectRoot,
    harnessRoot: options.harnessRoot,
    plan: options.plan,
  };

  const started = new Date().toISOString();
  const entries: InitRunLogEntry[] = [];
  const failedIds = new Set<string>();
  const blockedIds = new Set<string>();

  for (const task of options.plan.tasks) {
    const action = resolveTaskAction(task, options.decision);
    const depBlocked = task.deps.some(dep => failedIds.has(dep) || blockedIds.has(dep));
    if (depBlocked) {
      blockedIds.add(task.id);
      entries.push({
        task_id: task.id,
        action: 'skip',
        status: 'skipped',
        message: '依赖任务失败或未执行，跳过',
        reason: 'dependency_blocked',
        category: task.category,
        title: task.title,
        ...(task.target_path ? { target_path: task.target_path } : {}),
      });
      continue;
    }

    if (action === 'skip' || action === 'keep') {
      const skipped = buildSkippedEntry(task, action);
      entries.push({
        task_id: task.id,
        action,
        status: 'skipped',
        message: skipped.message,
        reason: skipped.reason,
        category: task.category,
        title: task.title,
        ...(task.target_path ? { target_path: task.target_path } : {}),
      });
      continue;
    }

    try {
      const result = executeInitTask(task, action, ctx);
      entries.push({
        task_id: task.id,
        action,
        status: 'executed',
        message: result.message,
        category: task.category,
        title: task.title,
        ...(task.target_path ? { target_path: task.target_path } : {}),
        ...(result.file_effects ? { file_effects: result.file_effects } : {}),
        ...(result.file_results?.length ? { file_results: result.file_results } : {}),
        ...(result.cleanup_results?.length ? { cleanup_results: result.cleanup_results } : {}),
        ...(result.cleanup_effects ? { cleanup_effects: result.cleanup_effects } : {}),
      });
    } catch (e) {
      failedIds.add(task.id);
      entries.push({
        task_id: task.id,
        action,
        status: 'failed',
        message: (e as Error).message,
        category: task.category,
        title: task.title,
        ...(task.target_path ? { target_path: task.target_path } : {}),
      });
    }
  }

  return {
    schema_version: '1.0',
    scope: options.plan.scope,
    started_at: started,
    finished_at: new Date().toISOString(),
    decision_mode: options.decision.decision_mode,
    entries,
    ...buildRunLogAuditMeta({
      plan: options.plan,
      decision: options.decision,
      projectRoot: options.projectRoot,
    }),
  };
}

export function writeRunLog(
  harnessRoot: string,
  log: InitRunLog,
  summaryOptions: Omit<RunSummaryOptions, 'runLogPath' | 'summaryPath'> = {},
  finalizeOpts?: {
    projectRoot: string;
    scope: TaskScope;
    plan?: InitTaskPlan;
    frameworkRoot?: string;
    includePhase1?: boolean;
  },
): string {
  const minCtx = buildInitNextStepsMinContext({
    projectRoot: finalizeOpts?.projectRoot ?? log.project_root ?? harnessRoot,
    harnessRoot,
    scope: finalizeOpts?.scope ?? log.scope,
    log,
  });
  const scope = finalizeOpts?.scope ?? log.scope;
  const phase1Ctx =
    finalizeOpts?.includePhase1 !== false &&
    !isBlockerInitLog(log) &&
    scope === 'project' &&
    finalizeOpts?.projectRoot
      ? buildInitNextStepsPhase1Context(minCtx, {
          projectRoot: finalizeOpts.projectRoot,
          harnessRoot,
          frameworkRoot: finalizeOpts.frameworkRoot,
          plan: finalizeOpts.plan,
        })
      : undefined;
  const artifacts = writeRunArtifacts(harnessRoot, log, buildRunSummary, {
    minCtx,
    phase1Ctx: phase1Ctx
      ? {
          frameworkRoot: phase1Ctx.frameworkRoot,
          plan: phase1Ctx.plan,
        }
      : undefined,
    summaryOptions,
  });
  return artifacts.runLogPath;
}

function parseMaterializedAdaptersCsv(csv: string): string[] {
  return [
    ...new Set(
      csv
        .split(',')
        .map(s => s.trim())
        .filter(s => s.length > 0),
    ),
  ];
}

function isPathInsideRoot(root: string, target: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function assertStagingPathSafe(
  label: '--decision-file' | '--context-file',
  rawArg: string,
  resolved: string,
  harnessRoot: string,
): void {
  if (!path.isAbsolute(rawArg)) {
    failCli(
      `[init-orchestrate] ${label} 须为绝对路径（禁止相对路径，避免落入 framework/harness）。` +
        ' 请删除 harness 内残留 staging 文件，改用 OS 临时目录（<tmpdir>/framework-init-<stamp>/）。',
    );
  }
  if (isPathInsideRoot(harnessRoot, resolved)) {
    failCli(
      `[init-orchestrate] ${label} 不得落在 framework/harness 内（${resolved}）。` +
        ' 请删除该残留文件并改用绝对临时目录（<tmpdir>/framework-init-<stamp>/）。',
    );
  }
  if (!isPathInsideRoot(os.tmpdir(), resolved)) {
    process.stderr.write(
      `[init-orchestrate] warning: ${label} 不在系统临时目录（${resolved}）；` +
        ' 推荐写入 <tmpdir>/framework-init-<stamp>/。\n',
    );
  }
}

function parseArgs(argv: string[]): {
  projectRoot: string;
  harnessRoot: string;
  scope: TaskScope;
  adapter?: string;
  execute: boolean;
  emitStagingTemplate: boolean;
  smartAuto: boolean;
  decisionMode: DecisionMode;
  decisionFile?: string;
  contextFile?: string;
  materializedAdapters?: string[];
} {
  let projectRoot = process.cwd();
  let harnessRoot = path.resolve(__dirname, '..');
  let scope: TaskScope = 'project';
  let adapter: string | undefined;
  let execute = false;
  let emitStagingTemplate = false;
  let smartAuto = false;
  let decisionMode: DecisionMode = 'smart';
  let decisionFile: string | undefined;
  let contextFile: string | undefined;
  let decisionFileRaw: string | undefined;
  let contextFileRaw: string | undefined;
  let materializedAdapters: string[] | undefined;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--scope' && argv[i + 1]) {
      scope = argv[++i] as TaskScope;
    } else if (a === '--project-root' && argv[i + 1]) {
      projectRoot = path.resolve(argv[++i]);
    } else if (a === '--harness-root' && argv[i + 1]) {
      harnessRoot = path.resolve(argv[++i]);
    } else if (a === '--adapter' && argv[i + 1]) {
      adapter = argv[++i];
    } else if (a === '--execute') {
      execute = true;
    } else if (a === '--emit-staging-template') {
      emitStagingTemplate = true;
    } else if (a === '--smart-auto') {
      smartAuto = true;
      execute = true;
    } else if (a === '--materialized-adapters' && argv[i + 1]) {
      materializedAdapters = parseMaterializedAdaptersCsv(argv[++i]);
    } else if (a === '--decision-mode' && argv[i + 1]) {
      const mode = argv[++i];
      if (mode === 'smart' || mode === 'manual') decisionMode = mode;
    } else if (a === '--decision-file' && argv[i + 1]) {
      decisionFileRaw = argv[++i];
      decisionFile = path.resolve(decisionFileRaw);
    } else if (a === '--context-file' && argv[i + 1]) {
      contextFileRaw = argv[++i];
      contextFile = path.resolve(contextFileRaw);
    }
  }
  if (decisionFile && decisionFileRaw) {
    assertStagingPathSafe('--decision-file', decisionFileRaw, decisionFile, harnessRoot);
  }
  if (contextFile && contextFileRaw) {
    assertStagingPathSafe('--context-file', contextFileRaw, contextFile, harnessRoot);
  }
  return {
    projectRoot,
    harnessRoot,
    scope,
    adapter,
    execute,
    emitStagingTemplate,
    smartAuto,
    decisionMode,
    decisionFile,
    contextFile,
    materializedAdapters,
  };
}

function stripUtf8Bom(raw: string): string {
  return raw.replace(/^\uFEFF/, '');
}

export function readJsonFile<T>(filePath: string, label: '决策' | '上下文'): T {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (e) {
    throw new Error(
      `[init-orchestrate] ${label} JSON 非法：无法读取文件（${filePath}）：${(e as Error).message}`,
    );
  }
  try {
    return JSON.parse(stripUtf8Bom(raw)) as T;
  } catch (e) {
    throw new Error(
      `[init-orchestrate] ${label} JSON 非法：无法解析 JSON（${filePath}）：${(e as Error).message}`,
    );
  }
}

function failCli(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function readContextFileOptional(
  filePath: string | undefined,
  options: { allowMissing: boolean },
): Omit<InitExecutionContext, 'projectRoot' | 'harnessRoot' | 'plan'> | undefined {
  if (!filePath) return undefined;
  if (options.allowMissing && !fs.existsSync(filePath)) return undefined;
  const raw = readJsonFile<Omit<InitExecutionContext, 'projectRoot' | 'harnessRoot' | 'plan'>>(
    filePath,
    '上下文',
  );
  return stripContextReservedFields(raw) ?? undefined;
}

if (require.main === module) {
  const opts = parseArgs(process.argv);
  if (!opts.execute) {
    const rawContext = readContextFileOptional(opts.contextFile, { allowMissing: true });
    let executionContext = rawContext ? withInitContextDefaults(rawContext) : undefined;
    const cliAdapters = opts.materializedAdapters ?? [];
    if (cliAdapters.length) {
      const ctxAdapters = collectMaterializedAdapters(executionContext);
      const crossCheck = validateMaterializedAdapterSetsCrossCheck(
        cliAdapters,
        ctxAdapters,
        '--materialized-adapters',
        'context',
      );
      if (crossCheck) {
        failCli(`[init-orchestrate] ${crossCheck}`);
      }
      executionContext = injectCliMaterializedAdaptersIntoContext(executionContext, cliAdapters);
    }
    if (opts.emitStagingTemplate) {
      const planResult = prepareInitExecutionPlanWithStaleIds(
        {
          projectRoot: opts.projectRoot,
          scope: opts.scope,
          adapter: opts.adapter,
        },
        executionContext,
      );
      const template = buildInitStagingTemplate(
        planResult.plan,
        executionContext,
        opts.decisionMode,
        opts.projectRoot,
      );
      if (cliAdapters.length) {
        template.decision.materialized_adapters = cliAdapters;
      }
      console.log(JSON.stringify(template, null, 2));
    } else {
      try {
        const plan = probeInitTaskPlan({
          projectRoot: opts.projectRoot,
          scope: opts.scope,
          adapter: opts.adapter,
        });
        console.log(JSON.stringify(plan, null, 2));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        failCli(`[init-orchestrate] adapter catalog 损坏，S1 中止: ${msg}`);
      }
    }
    process.exit(0);
  }
  if (!opts.decisionFile && !opts.smartAuto) {
    const canInferSmartAuto =
      opts.materializedAdapters?.length &&
      !opts.contextFile &&
      opts.decisionMode === 'smart';
    if (canInferSmartAuto) {
      opts.smartAuto = true;
      process.stderr.write(
        '[init-orchestrate] --execute + --materialized-adapters 未指定 --smart-auto，自动启用 smart-auto 模式\n',
      );
    } else {
      process.stderr.write('[init-orchestrate] --execute 须配合 --decision-file 或 --smart-auto\n');
      process.stderr.write(
        '示例：npx ts-node scripts/init-orchestrate.ts --execute --smart-auto --scope project --project-root <repo-root> --materialized-adapters claude,generic\n',
      );
      process.stderr.write(
        '示例：npx ts-node scripts/init-orchestrate.ts --execute --decision-file <abs-temp-dir>/decision.json --context-file <abs-temp-dir>/context.json --scope project --project-root <repo-root>\n',
      );
      process.exit(1);
    }
  }
  try {
    let decision: InitRunDecision;
    let rawContext: Omit<InitExecutionContext, 'projectRoot' | 'harnessRoot' | 'plan'> | undefined;

    if (opts.smartAuto) {
      const adapters = opts.materializedAdapters ?? [];
      if (opts.scope === 'project' && !adapters.length) {
        failCli(
          '[init-orchestrate] --smart-auto（project）须配合非空 --materialized-adapters（逗号分隔）\n' +
            '示例：npx ts-node scripts/init-orchestrate.ts --execute --smart-auto --scope project --project-root <repo-root> --materialized-adapters claude,generic',
        );
      }
      const probePlan = probeInitTaskPlan({
        projectRoot: opts.projectRoot,
        scope: opts.scope,
        adapter: opts.adapter,
      });
      const staging = buildInitStagingTemplate(
        probePlan,
        undefined,
        opts.decisionMode,
        opts.projectRoot,
      );
      decision = assertDecisionStructure({
        ...staging.decision,
        materialized_adapters: adapters.length ? adapters : staging.decision.materialized_adapters,
      });
      rawContext = staging.context;
    } else {
      decision = assertDecisionStructure(readJsonFile<unknown>(opts.decisionFile!, '决策'));
      rawContext = readContextFileOptional(opts.contextFile, { allowMissing: false });
    }
    const { baseContext, crossCheckError } = deriveBaseContextForPlanning(
      stripContextReservedFields(rawContext),
      decision,
    );
    const planResult = prepareInitExecutionPlanWithStaleIds(
      {
        projectRoot: opts.projectRoot,
        scope: opts.scope,
        adapter: opts.adapter,
      },
      baseContext,
    );
    const reconciledDecision = reconcileInitRunDecisionForPlan(planResult.plan, decision, {
      staleMaterializeTaskIds: planResult.staleMaterializeTaskIds,
    });
    const auditMeta = buildRunLogAuditMeta({
      plan: planResult.plan,
      decision: reconciledDecision,
      projectRoot: opts.projectRoot,
    });
    if (crossCheckError) {
      const started = new Date().toISOString();
      const blocked = buildPreflightBlockedLog(
        planResult.plan,
        reconciledDecision,
        started,
        [
          {
            task_id: '<materialized-adapters>',
            action: 'validate',
            message: crossCheckError,
          },
        ],
        true,
        auditMeta,
      );
      writeInitRunAndPrint(blocked, opts, {
        projectRoot: opts.projectRoot,
        scope: opts.scope,
        plan: planResult.plan,
        includePhase1: false,
      });
      process.exit(1);
    }
    const finalContext = deriveContextForExecution(
      baseContext,
      planResult.plan,
      opts.projectRoot,
      normalizeDecisionMaterializedAdapters(reconciledDecision),
    );
    const preflight = preflightExecute(
      planResult.plan,
      reconciledDecision,
      finalContext,
      auditMeta,
      { projectRoot: opts.projectRoot },
    );
    if (!preflight.ok) {
      writeInitRunAndPrint(preflight.blocked, opts, {
        projectRoot: opts.projectRoot,
        scope: opts.scope,
        plan: planResult.plan,
        includePhase1: false,
      });
      process.exit(1);
    }
    const log = executeInitPlan({
      projectRoot: opts.projectRoot,
      harnessRoot: opts.harnessRoot,
      plan: planResult.plan,
      decision: reconciledDecision,
      executionContext: finalContext,
    });
    writeInitRunAndPrint(log, opts, {
      projectRoot: opts.projectRoot,
      scope: opts.scope,
      plan: planResult.plan,
      includePhase1: opts.scope === 'project',
    });
    process.exit(log.entries.some(e => e.status === 'failed') ? 1 : 0);
  } catch (e) {
    failCli((e as Error).message);
  }
}
