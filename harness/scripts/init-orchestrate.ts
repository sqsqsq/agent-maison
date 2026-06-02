// ============================================================================
// init-orchestrate.ts — enum decision JSON 执行 + run-log + 摘要
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';

import { validateFrameworkConfigWriteCandidate, type FrameworkConfig } from '../config';
import { sanitizeProjectConfigForInitWrite } from './utils/config-field-merger';
import {
  executeInitTask,
  type InitExecutionContext,
} from './utils/init-task-executor';
import {
  type InitTask,
  type InitTaskPlan,
  prepareInitExecutionPlanWithStaleIds,
  probeInitTaskPlan,
  type TaskScope,
} from './utils/init-task-planner';

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
}

export interface InitRunLogEntry {
  task_id: string;
  action: string;
  status: 'executed' | 'skipped' | 'failed';
  message: string;
}

export interface InitRunLog {
  schema_version: '1.0';
  scope: TaskScope;
  started_at: string;
  finished_at: string;
  decision_mode: DecisionMode;
  entries: InitRunLogEntry[];
}


const VALID_ACTIONS = new Set(['run', 'skip', 'overwrite', 'keep']);
const VALID_SCOPES = new Set<TaskScope>(['project', 'personal']);
const VALID_DECISION_MODES = new Set<DecisionMode>(['smart', 'manual']);

const DOC_PAYLOAD_KEY_BY_TASK: Record<
  string,
  keyof NonNullable<InitExecutionContext['docWritePayload']>
> = {
  'write-architecture': 'architecture_md',
  'ensure-catalog': 'module_catalog',
  'ensure-glossary': 'glossary_yaml',
  'ensure-glossary-seed': 'glossary_seed',
};

/** 决策 JSON 结构 + 枚举守卫（JSON.parse 成功后立即调用） */
export function assertDecisionStructure(raw: unknown): InitRunDecision {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('[init-orchestrate] 决策 JSON 非法：根须为对象');
  }
  const o = raw as Record<string, unknown>;
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
  return {
    schema_version: '1.0',
    scope: o.scope as TaskScope,
    decision_mode: o.decision_mode as DecisionMode,
    plan_generated_at: o.plan_generated_at,
    tasks,
  };
}

function checkWriteTaskPayload(
  task: InitTask,
  action: TaskDecision['action'],
  context?: Omit<InitExecutionContext, 'projectRoot' | 'harnessRoot' | 'plan'>,
): string | null {
  if (action === 'skip' || action === 'keep') return null;

  if (task.id === 'ensure-config') {
    if (!context?.configWritePayload) {
      return 'ensure-config：context.configWritePayload 缺失；须由 Skill S2 注入 JSON，或在 S2 决策 skip';
    }
    try {
      validateFrameworkConfigWriteCandidate(
        context.configWritePayload as Partial<FrameworkConfig>,
      );
      sanitizeProjectConfigForInitWrite(context.configWritePayload);
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

function buildPreflightBlockedLog(
  plan: InitTaskPlan,
  decision: InitRunDecision,
  startedAt: string,
  violations: Array<{ task_id: string; action: string; message: string }>,
  decisionValidationFailed: boolean,
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
  };
}

/** S3 执行前无副作用 preflight；失败返回 blocked run-log（零项目业务/机制写盘） */
export function preflightExecute(
  plan: InitTaskPlan,
  decision: InitRunDecision,
  context?: Omit<InitExecutionContext, 'projectRoot' | 'harnessRoot' | 'plan'>,
): { ok: true } | { ok: false; blocked: InitRunLog } {
  const started = new Date().toISOString();
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
    const msg = checkWriteTaskPayload(task, action, context);
    if (msg) {
      violations.push({ task_id: task.id, action, message: msg });
    }
  }

  if (violations.length > 0) {
    return {
      ok: false,
      blocked: buildPreflightBlockedLog(plan, decision, started, violations, false),
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
    decision.tasks.filter(d => d.action === 'skip' || d.action === 'keep').map(d => d.task_id),
  );
  for (const task of plan.tasks) {
    if (skipIds.has(task.id)) continue;
    for (const dep of task.deps) {
      if (skipIds.has(dep)) {
        return { ok: false, error: `依赖闭包违反：${task.id} 依赖 ${dep} 但 ${dep} 被跳过` };
      }
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
    if (task.status === 'satisfied') return 'skip';
    if (task.status === 'drift') return 'overwrite';
    return 'run';
  }
  if (task.default_action === 'skip') return 'skip';
  if (taskRequiresExplicitManualDecision(task)) {
    throw new Error(`[init-orchestrate] manual 模式缺少显式决策：${task.id}`);
  }
  return 'run';
}

export function buildRunSummary(log: InitRunLog): string {
  const lines: string[] = [
    `# Framework Init 执行摘要`,
    ``,
    `- scope: ${log.scope}`,
    `- decision_mode: ${log.decision_mode}`,
    `- started: ${log.started_at}`,
    `- finished: ${log.finished_at}`,
    ``,
    `| task_id | action | status | message |`,
    `|---------|--------|--------|---------|`,
  ];
  for (const e of log.entries) {
    lines.push(`| ${e.task_id} | ${e.action} | ${e.status} | ${e.message.replace(/\|/g, '\\|')} |`);
  }
  const executed = log.entries.filter(e => e.status === 'executed').length;
  const skipped = log.entries.filter(e => e.status === 'skipped').length;
  const failed = log.entries.filter(e => e.status === 'failed').length;
  lines.push('');
  lines.push(`合计：executed=${executed} skipped=${skipped} failed=${failed}`);
  return lines.join('\n');
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
    projectRoot: options.projectRoot,
    harnessRoot: options.harnessRoot,
    plan: options.plan,
    ...(options.executionContext ?? {}),
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
      });
      continue;
    }

    if (action === 'skip' || action === 'keep') {
      entries.push({
        task_id: task.id,
        action,
        status: 'skipped',
        message: action === 'keep' ? '保留当前磁盘内容' : '用户/智能模式跳过',
      });
      continue;
    }

    try {
      const message = executeInitTask(task, action, ctx);
      entries.push({
        task_id: task.id,
        action,
        status: 'executed',
        message,
      });
    } catch (e) {
      failedIds.add(task.id);
      entries.push({
        task_id: task.id,
        action,
        status: 'failed',
        message: (e as Error).message,
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
  };
}

export function writeRunLog(harnessRoot: string, log: InitRunLog): string {
  const stamp = log.started_at.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const dir = path.join(harnessRoot, 'reports', '_global', 'init-orchestrate', stamp);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'run-log.json');
  fs.writeFileSync(file, JSON.stringify(log, null, 2), 'utf-8');
  const summary = buildRunSummary(log);
  fs.writeFileSync(path.join(dir, 'summary.md'), `${summary}\n`, 'utf-8');
  return file;
}

function parseArgs(argv: string[]): {
  projectRoot: string;
  harnessRoot: string;
  scope: TaskScope;
  adapter?: string;
  execute: boolean;
  decisionFile?: string;
  contextFile?: string;
} {
  let projectRoot = process.cwd();
  let harnessRoot = path.resolve(__dirname, '..');
  let scope: TaskScope = 'project';
  let adapter: string | undefined;
  let execute = false;
  let decisionFile: string | undefined;
  let contextFile: string | undefined;
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
    } else if (a === '--decision-file' && argv[i + 1]) {
      decisionFile = path.resolve(argv[++i]);
    } else if (a === '--context-file' && argv[i + 1]) {
      contextFile = path.resolve(argv[++i]);
    }
  }
  return { projectRoot, harnessRoot, scope, adapter, execute, decisionFile, contextFile };
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

if (require.main === module) {
  const opts = parseArgs(process.argv);
  if (!opts.execute) {
    const plan = probeInitTaskPlan({
      projectRoot: opts.projectRoot,
      scope: opts.scope,
      adapter: opts.adapter,
    });
    console.log(JSON.stringify(plan, null, 2));
    process.exit(0);
  }
  if (!opts.decisionFile) {
    process.stderr.write('[init-orchestrate] --execute 须配合 --decision-file\n');
    process.exit(1);
  }
  try {
    const decision = assertDecisionStructure(readJsonFile<unknown>(opts.decisionFile, '决策'));
    const executionContext = opts.contextFile
      ? readJsonFile<Omit<InitExecutionContext, 'projectRoot' | 'harnessRoot' | 'plan'>>(
          opts.contextFile,
          '上下文',
        )
      : undefined;
    const planResult = prepareInitExecutionPlanWithStaleIds(
      {
        projectRoot: opts.projectRoot,
        scope: opts.scope,
        adapter: opts.adapter,
      },
      executionContext,
    );
    const reconciledDecision = reconcileInitRunDecisionForPlan(planResult.plan, decision, {
      staleMaterializeTaskIds: planResult.staleMaterializeTaskIds,
    });
    const preflight = preflightExecute(planResult.plan, reconciledDecision, executionContext);
    if (!preflight.ok) {
      const logPath = writeRunLog(opts.harnessRoot, preflight.blocked);
      process.stdout.write(`${buildRunSummary(preflight.blocked)}\n`);
      process.stderr.write(`[init-orchestrate] run-log: ${logPath}\n`);
      process.exit(1);
    }
    const log = executeInitPlan({
      projectRoot: opts.projectRoot,
      harnessRoot: opts.harnessRoot,
      plan: planResult.plan,
      decision: reconciledDecision,
      executionContext,
    });
    const logPath = writeRunLog(opts.harnessRoot, log);
    process.stdout.write(`${buildRunSummary(log)}\n`);
    process.stderr.write(`[init-orchestrate] run-log: ${logPath}\n`);
    process.exit(log.entries.some(e => e.status === 'failed') ? 1 : 0);
  } catch (e) {
    failCli((e as Error).message);
  }
}
