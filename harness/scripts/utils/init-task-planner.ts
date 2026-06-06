// ============================================================================
// init-task-planner.ts — readonly probe → InitTaskPlan DAG (SSOT)
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';

import {
  loadFrameworkConfigWithSources,
  type FrameworkConfigWithSources,
} from '../../config';
import {
  runInitProbe,
  type Inspection,
  inspectionsForInit034Prompt,
  type InitMode,
} from '../check-init';

export type TaskScope = 'project' | 'personal';
export type TaskStatus = 'satisfied' | 'needed' | 'drift' | 'skippable';
export type TaskDefaultAction = 'run' | 'skip' | 'prompt';

export interface InitTask {
  id: string;
  title: string;
  category: string;
  scope: TaskScope;
  deps: string[];
  status: TaskStatus;
  default_action: TaskDefaultAction;
  skippable: boolean;
  allowed_actions: Array<'run' | 'skip' | 'overwrite' | 'keep'>;
  decision_class?: string;
  params?: Record<string, unknown>;
  inspection_index?: number;
  target_path?: string;
}

export interface InitTaskPlan {
  schema_version: '1.0';
  scope: TaskScope;
  mode: InitMode;
  generated_at: string;
  tasks: InitTask[];
}

function inspectionToStatus(ins: Inspection): TaskStatus {
  if (ins.status === 'MISSING') return 'needed';
  if (ins.index === 1 && ins.config_user_required_gap) return 'needed';
  if (ins.status === 'EMPTY') return 'satisfied';
  return 'drift';
}

function ensureConfigTaskFields(ins: Inspection): Pick<
  InitTask,
  'status' | 'default_action' | 'skippable' | 'allowed_actions' | 'decision_class'
> {
  if (ins.config_user_required_gap) {
    return {
      status: 'needed',
      default_action: 'prompt',
      skippable: false,
      allowed_actions: ['overwrite'],
      decision_class: 'init.task_decision',
    };
  }
  return {
    status: ins.status === 'MISSING' ? 'needed' : ins.status === 'POPULATED' ? 'drift' : 'satisfied',
    default_action: ins.status === 'MISSING' ? 'run' : ins.status === 'POPULATED' ? 'prompt' : 'skip',
    skippable: ins.status !== 'MISSING',
    allowed_actions: ins.status === 'POPULATED' ? ['overwrite', 'keep'] : ['run', 'skip'],
    decision_class: ins.status === 'POPULATED' ? 'init.task_decision' : undefined,
  };
}

function buildProjectTasks(
  inspections: Inspection[],
  mode: InitMode,
  materializedAdapters: string[],
): InitTask[] {
  const tasks: InitTask[] = [];
  const add = (t: InitTask) => tasks.push(t);

  const ins1 = inspections.find(i => i.index === 1);
  if (ins1) {
    const cfgFields = ensureConfigTaskFields(ins1);
    add({
      id: 'ensure-config',
      title: 'framework.config.json',
      category: 'config',
      scope: 'project',
      deps: [],
      ...cfgFields,
      inspection_index: 1,
      target_path: ins1.target_path,
    });
  }

  if (mode === 'update' && ins1) {
    if ((ins1.missing_keys?.length ?? 0) > 0) {
      add({
        id: 'backfill-config',
        title: '字段级补缺 merge-framework-config',
        category: 'config',
        scope: 'project',
        deps: ['ensure-config'],
        status: 'needed',
        default_action: 'run',
        skippable: true,
        allowed_actions: ['run', 'skip'],
      });
    }
    if ((ins1.migration_keys?.length ?? 0) > 0) {
      add({
        id: 'migrate-config',
        title: 'config 迁移规则（含 personal 外迁）',
        category: 'config',
        scope: 'project',
        deps: ['ensure-config'],
        status: 'needed',
        default_action: 'run',
        skippable: false,
        allowed_actions: ['run'],
      });
    }
    if ((ins1.confirm_keys?.length ?? 0) > 0) {
      add({
        id: 'confirm-fields',
        title: '行为级 confirm 字段',
        category: 'config',
        scope: 'project',
        deps: ['ensure-config'],
        status: 'needed',
        default_action: 'prompt',
        skippable: true,
        allowed_actions: ['run', 'skip'],
        decision_class: 'init.task_decision',
      });
    }
  }

  for (const ins of inspections.filter(i => i.index === 2)) {
    add({
      id: 'materialize-entry-file',
      title: ins.target_path,
      category: 'adapter-entry',
      scope: 'project',
      deps: ['ensure-config'],
      status: inspectionToStatus(ins),
      default_action: ins.status === 'POPULATED' ? 'prompt' : ins.status === 'MISSING' ? 'run' : 'skip',
      skippable: ins.status !== 'MISSING',
      allowed_actions: ins.status === 'POPULATED' ? ['overwrite', 'keep'] : ['run', 'skip'],
      decision_class: ins.status === 'POPULATED' ? 'init.task_decision' : undefined,
      inspection_index: 2,
      target_path: ins.target_path,
    });
  }

  for (const ins of inspections.filter(i => i.index === 3)) {
    const policy = ins.update_policy ?? 'prompt_if_changed';
    if (policy === 'auto_overwrite') {
      add({
        id: `sync-auto-overwrite:${ins.target_path}`,
        title: ins.target_path,
        category: 'adapter-template-sync',
        scope: 'project',
        deps: ['ensure-config'],
        status: inspectionToStatus(ins),
        default_action: 'run',
        skippable: false,
        allowed_actions: ['run'],
        inspection_index: 3,
        target_path: ins.target_path,
        params: { update_policy: 'auto_overwrite' },
      });
    } else {
      add({
        id: `materialize-adapter-file:${ins.target_path}`,
        title: ins.target_path,
        category: 'adapter-template',
        scope: 'project',
        deps: ['ensure-config'],
        status: inspectionToStatus(ins),
        default_action: ins.status === 'POPULATED' ? 'prompt' : ins.status === 'MISSING' ? 'run' : 'skip',
        skippable: ins.status !== 'MISSING',
        allowed_actions: ins.status === 'POPULATED' ? ['overwrite', 'keep'] : ['run', 'skip'],
        decision_class: ins.status === 'POPULATED' ? 'init.task_decision' : undefined,
        inspection_index: 3,
        target_path: ins.target_path,
      });
    }
  }

  for (const task of buildMaterializeAdapterTasks(materializedAdapters)) {
    add(task);
  }

  const docIndices = [4, 5, 6, 7, 8];
  for (const idx of docIndices) {
    const ins = inspections.find(i => i.index === idx);
    if (!ins) continue;
    const idMap: Record<number, string> = {
      4: 'write-architecture',
      5: 'ensure-catalog',
      6: 'ensure-glossary',
      7: 'ensure-glossary-seed',
      8: 'ensure-features-dir',
    };
    add({
      id: idMap[idx]!,
      title: ins.target_path,
      category: 'docs',
      scope: 'project',
      deps: ['ensure-config'],
      status: inspectionToStatus(ins),
      default_action: ins.status === 'MISSING' ? 'run' : 'skip',
      skippable: true,
      allowed_actions: ['run', 'skip'],
      inspection_index: idx,
      target_path: ins.target_path,
    });
  }

  add({
    id: 'ensure-gitignore',
    title: '.gitignore canonical patterns',
    category: 'mechanism',
    scope: 'project',
    deps: [],
    status: 'needed',
    default_action: 'run',
    skippable: false,
    allowed_actions: ['run'],
  });

  add({
    id: 'cleanup-deprecated',
    title: 'deprecated adapter artifacts backup_delete',
    category: 'mechanism',
    scope: 'project',
    deps: ['ensure-config'],
    status: mode === 'update' ? 'needed' : 'satisfied',
    default_action: mode === 'update' ? 'run' : 'skip',
    skippable: true,
    allowed_actions: ['run', 'skip'],
  });

  const ins9 = inspections.find(i => i.index === 9);
  add({
    id: 'harness-install',
    title: 'framework/harness npm install',
    category: 'mechanism',
    scope: 'project',
    deps: [],
    status: ins9?.status === 'MISSING' ? 'needed' : 'satisfied',
    default_action: ins9?.status === 'MISSING' ? 'run' : 'skip',
    skippable: true,
    allowed_actions: ['run', 'skip'],
    inspection_index: 9,
  });

  add({
    id: 'run-global-phases',
    title: 'catalog / glossary / docs 全局 phase',
    category: 'verify',
    scope: 'project',
    deps: ['harness-install', 'ensure-config'],
    status: 'needed',
    default_action: 'run',
    skippable: false,
    allowed_actions: ['run'],
  });

  return tasks;
}

function buildPersonalTasks(materializedAdapters: string[]): InitTask[] {
  return [
    {
      id: 'assert-active-adapter-materialized',
      title: '只读校验 active adapter 产物已物化',
      category: 'personal',
      scope: 'personal',
      deps: [],
      status: 'needed',
      default_action: 'run',
      skippable: false,
      allowed_actions: ['run'],
    },
    {
      id: 'record-adapter',
      title: '选择 active adapter（framework.local.json）',
      category: 'personal',
      scope: 'personal',
      deps: ['assert-active-adapter-materialized'],
      status: 'needed',
      default_action: 'prompt',
      skippable: false,
      allowed_actions: ['run'],
      decision_class: 'setup.adapter',
      params: { materialized_adapters: materializedAdapters },
    },
    {
      id: 'detect-deveco',
      title: '探测 DevEco 安装路径候选',
      category: 'personal',
      scope: 'personal',
      deps: ['record-adapter'],
      status: 'needed',
      default_action: 'prompt',
      skippable: true,
      allowed_actions: ['run', 'skip'],
      decision_class: 'setup.deveco_path',
    },
    {
      id: 'record-deveco-path',
      title: '记录 DevEco 路径到 framework.local.json',
      category: 'personal',
      scope: 'personal',
      deps: ['detect-deveco'],
      status: 'needed',
      default_action: 'run',
      skippable: true,
      allowed_actions: ['run', 'skip'],
    },
  ];
}

export interface PlanProbeOptions {
  projectRoot: string;
  scope: TaskScope;
  adapter?: string;
}

/** 项目 init 探测/物化 adapter hint：禁止 personal local 覆盖 */
export function resolveProjectInitAdapterHint(
  sources: FrameworkConfigWithSources,
  cliAdapter?: string,
): string {
  const fromCli = cliAdapter?.trim();
  if (fromCli) return fromCli;

  const raw = sources.projectRaw;
  const fromMaterialized = Array.isArray(raw?.materialized_adapters)
    ? raw!.materialized_adapters.filter((a): a is string => typeof a === 'string' && a.trim().length > 0)
    : [];
  if (fromMaterialized.length > 0) return fromMaterialized[0]!.trim();

  const legacy =
    typeof raw?.agent_adapter === 'string' ? raw.agent_adapter.trim() : '';
  if (legacy) return legacy;

  return 'generic';
}

/** 项目级 materialized_adapters（不含 local merge） */
export function resolveProjectMaterializedAdapters(
  sources: FrameworkConfigWithSources,
  adapterHint: string,
): string[] {
  const raw = sources.projectRaw;
  const fromProject = Array.isArray(raw?.materialized_adapters)
    ? raw!.materialized_adapters.filter((a): a is string => typeof a === 'string' && a.trim().length > 0)
    : [];
  if (fromProject.length > 0) return fromProject.map(a => a.trim());
  return [adapterHint];
}

function buildMaterializeAdapterTasks(materializedAdapters: string[]): InitTask[] {
  const seen = new Set<string>();
  const out: InitTask[] = [];
  for (const raw of materializedAdapters) {
    const adapterName = raw.trim();
    if (!adapterName || seen.has(adapterName)) continue;
    seen.add(adapterName);
    out.push({
      id: `materialize-adapter:${adapterName}`,
      title: `同步已选 adapter bundle: ${adapterName}（幂等）`,
      category: 'adapter-bundle',
      scope: 'project',
      deps: ['ensure-config'],
      status: 'needed',
      default_action: 'run',
      skippable: false,
      allowed_actions: ['run'],
      params: { adapter: adapterName },
    });
  }
  return out;
}

/** S2 context / configWritePayload 中的 materialized_adapters（S3 执行 SSOT） */
export function resolveMaterializedAdaptersFromExecutionContext(
  ctx?: Partial<{ materializedAdapters?: string[]; configWritePayload?: Record<string, unknown> }>,
): string[] | undefined {
  if (!ctx) return undefined;
  const fromCtx = (ctx.materializedAdapters ?? []).filter(
    (a): a is string => typeof a === 'string' && a.trim().length > 0,
  );
  if (fromCtx.length > 0) return fromCtx.map(a => a.trim());

  const payload = ctx.configWritePayload?.materialized_adapters;
  if (Array.isArray(payload)) {
    const fromPayload = payload.filter(
      (a): a is string => typeof a === 'string' && a.trim().length > 0,
    );
    if (fromPayload.length > 0) return fromPayload.map(a => a.trim());
  }
  return undefined;
}

/** 用 S2 选定的 adapter 清单替换 plan 中的 materialize-adapter:* 任务 */
export function applyMaterializedAdaptersToProjectPlan(
  plan: InitTaskPlan,
  materializedAdapters: string[],
): InitTaskPlan {
  if (plan.scope !== 'project') return plan;
  const bundleTasks = buildMaterializeAdapterTasks(materializedAdapters);
  if (bundleTasks.length === 0) return plan;

  const withoutBundle = plan.tasks.filter(t => !t.id.startsWith('materialize-adapter:'));
  const insertBeforeIdx = withoutBundle.findIndex(
    t => t.id.startsWith('write-architecture') || t.id === 'harness-install' || t.category === 'docs',
  );
  const idx = insertBeforeIdx >= 0 ? insertBeforeIdx : withoutBundle.length;
  return {
    ...plan,
    tasks: [
      ...withoutBundle.slice(0, idx),
      ...bundleTasks,
      ...withoutBundle.slice(idx),
    ],
  };
}

function materializeAdapterTaskIds(plan: InitTaskPlan): string[] {
  return plan.tasks
    .filter(t => t.id.startsWith('materialize-adapter:'))
    .map(t => t.id);
}

export interface PrepareInitExecutionPlanResult {
  plan: InitTaskPlan;
  /** S1 probe 有、S3 执行 plan 无的 materialize-adapter:*（仅这些可从 decision 剥离） */
  staleMaterializeTaskIds: string[];
}

/**
 * S3 执行专用：probe 保持只读；若 context 含 S2 materialized 选择则增强 plan，并返回 stale 物化 task 白名单。
 */
export function prepareInitExecutionPlanWithStaleIds(
  options: PlanProbeOptions,
  executionContext?: Partial<{ materializedAdapters?: string[]; configWritePayload?: Record<string, unknown> }>,
): PrepareInitExecutionPlanResult {
  if (options.scope !== 'project') {
    return { plan: probeInitTaskPlan(options), staleMaterializeTaskIds: [] };
  }

  const adapters = resolveMaterializedAdaptersFromExecutionContext(executionContext);
  if (!adapters?.length) {
    return { plan: probeInitTaskPlan(options), staleMaterializeTaskIds: [] };
  }

  const s1Plan = probeInitTaskPlan(options);
  const configPath = path.join(options.projectRoot, 'framework.config.json');
  const probeOptions: PlanProbeOptions = { ...options };
  if (!fs.existsSync(configPath) && adapters[0]) {
    probeOptions.adapter = adapters[0];
  }

  const probedForExec = probeInitTaskPlan(probeOptions);
  const plan = applyMaterializedAdaptersToProjectPlan(probedForExec, adapters);
  const s3Ids = new Set(materializeAdapterTaskIds(plan));
  const staleMaterializeTaskIds = materializeAdapterTaskIds(s1Plan).filter(id => !s3Ids.has(id));

  return { plan, staleMaterializeTaskIds };
}

/**
 * S3 执行专用：probe 保持只读；若 context 含 S2 materialized 选择则增强 plan。
 * CREATE（磁盘尚无 config）时用首个选定 adapter 作为 probe hint，避免默认 generic。
 */
export function prepareInitExecutionPlan(
  options: PlanProbeOptions,
  executionContext?: Partial<{ materializedAdapters?: string[]; configWritePayload?: Record<string, unknown> }>,
): InitTaskPlan {
  return prepareInitExecutionPlanWithStaleIds(options, executionContext).plan;
}

/** 纯只读探测：不调用 ensureCanonicalGitignore / mechanism sync / deprecated cleanup */
export function probeInitTaskPlan(options: PlanProbeOptions): InitTaskPlan {
  const { projectRoot, scope } = options;
  const cfgSources = loadFrameworkConfigWithSources(projectRoot);
  const adapterHint =
    scope === 'personal'
      ? options.adapter?.trim() ||
        cfgSources.config.agent_adapter ||
        (typeof cfgSources.projectRaw?.agent_adapter === 'string'
          ? cfgSources.projectRaw.agent_adapter.trim()
          : '') ||
        'generic'
      : resolveProjectInitAdapterHint(cfgSources, options.adapter);

  const probe = runInitProbe({ projectRoot, adapterHint });
  const { mode, inspections } = probe;

  const materialized =
    scope === 'personal'
      ? cfgSources.config.materialized_adapters?.length
        ? cfgSources.config.materialized_adapters
        : [adapterHint]
      : resolveProjectMaterializedAdapters(cfgSources, adapterHint);

  const tasks =
    scope === 'personal'
      ? buildPersonalTasks(materialized)
      : buildProjectTasks(inspections, mode, materialized);

  return {
    schema_version: '1.0',
    scope,
    mode,
    generated_at: new Date().toISOString(),
    tasks,
  };
}

export function planTasksNeedingPrompt(plan: InitTaskPlan): InitTask[] {
  return plan.tasks.filter(t => t.default_action === 'prompt' || t.status === 'drift');
}

export { inspectionsForInit034Prompt };
