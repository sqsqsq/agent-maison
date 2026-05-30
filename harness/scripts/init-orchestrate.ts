// ============================================================================
// init-orchestrate.ts — enum decision JSON 执行 + run-log + 摘要
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';

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
  const decision = JSON.parse(fs.readFileSync(opts.decisionFile, 'utf-8')) as InitRunDecision;
  const executionContext = opts.contextFile
    ? (JSON.parse(fs.readFileSync(opts.contextFile, 'utf-8')) as Omit<
        InitExecutionContext,
        'projectRoot' | 'harnessRoot' | 'plan'
      >)
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
}
