// init-sync-telemetry.ts — init 写盘 telemetry 类型与聚合（planner ownership → run-log）

import type { InitTaskPlan } from './init-task-planner';

export type SyncTemplateEffect = 'created' | 'updated' | 'unchanged' | 'delegated';

export interface SyncTemplateResult {
  targetRel: string;
  effect: SyncTemplateEffect;
}

export interface FileEffects {
  created: number;
  updated: number;
  unchanged: number;
  delegated: number;
}

export interface InitTaskExecutionResult {
  message: string;
  file_effects?: FileEffects;
  file_results?: SyncTemplateResult[];
}

export function normalizeTargetRel(targetRel: string): string {
  return targetRel.replace(/\\/g, '/');
}

/** 从 plan 收集 per-file / sync-auto-overwrite 任务的 target_path ownership */
export function buildOwnedByTaskSet(plan: InitTaskPlan): Set<string> {
  const owned = new Set<string>();
  for (const task of plan.tasks) {
    if (
      task.id === 'materialize-entry-file' ||
      task.id.startsWith('materialize-adapter-file:') ||
      task.id.startsWith('sync-auto-overwrite:')
    ) {
      const rel = task.target_path ?? task.id.split(':').slice(1).join(':');
      if (rel?.trim()) owned.add(normalizeTargetRel(rel.trim()));
    }
  }
  return owned;
}

export function aggregateFileEffects(results: readonly SyncTemplateResult[]): FileEffects {
  const effects: FileEffects = { created: 0, updated: 0, unchanged: 0, delegated: 0 };
  for (const r of results) {
    effects[r.effect]++;
  }
  return effects;
}

export function mergeFileEffects(a: FileEffects, b: FileEffects): FileEffects {
  return {
    created: a.created + b.created,
    updated: a.updated + b.updated,
    unchanged: a.unchanged + b.unchanged,
    delegated: a.delegated + b.delegated,
  };
}

export function formatFileEffectsCounts(effects: FileEffects): string {
  return `created ${effects.created} / updated ${effects.updated} / unchanged ${effects.unchanged} / delegated ${effects.delegated}`;
}

export function formatBundleSyncMessage(adapterName: string, effects: FileEffects): string {
  return `同步 adapter ${adapterName}：${formatFileEffectsCounts(effects)}`;
}
