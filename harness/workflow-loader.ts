// ============================================================================
// Workflow loader — resolves framework/workflows/<name>.workflow.yaml
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import type { FrameworkConfig } from './config';
import { loadFrameworkConfig } from './config';

export interface WorkflowArtifact {
  id: string;
  scope: 'global' | 'feature';
  check?: string;
  rule?: string;
  requires: string[];
  optional_deps?: string[];
  verifier_prompt?: string;
  skill_doc?: string;
}

export interface WorkflowSpec {
  schema_version: string;
  name: string;
  description?: string;
  artifacts: WorkflowArtifact[];
}

export function loadWorkflowSpec(frameworkRoot: string, workflowName: string): WorkflowSpec {
  const stem = workflowName.trim().replace(/\.workflow\.yaml$/i, '');
  const filePath = path.join(frameworkRoot, 'workflows', `${stem}.workflow.yaml`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`[workflow-loader] 未找到 workflow 文件：${filePath}`);
  }
  const raw = YAML.parse(fs.readFileSync(filePath, 'utf-8')) as Partial<WorkflowSpec>;
  validateWorkflow(raw, filePath);
  return raw as WorkflowSpec;
}

export function resolveWorkflowSpec(
  projectRoot: string,
  opts?: { config?: FrameworkConfig; workflowOverride?: string; frameworkRoot?: string },
): WorkflowSpec {
  const cfg = opts?.config ?? loadFrameworkConfig(projectRoot);
  const name =
    (opts?.workflowOverride && opts.workflowOverride.trim()) ||
    cfg.active_workflow?.trim() ||
    'spec-driven';
  const frameworkRoot =
    (opts?.frameworkRoot && opts.frameworkRoot.trim()) || path.join(projectRoot, 'framework');
  return loadWorkflowSpec(frameworkRoot, name);
}

export function listWorkflowPhases(spec: WorkflowSpec): string[] {
  const ids = spec.artifacts.map((a) => a.id);
  const idSet = new Set(ids);
  if (idSet.size !== ids.length) {
    throw new Error('[workflow-loader] artifact id 重复');
  }

  const indegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const id of ids) {
    indegree.set(id, 0);
    adj.set(id, []);
  }

  for (const a of spec.artifacts) {
    for (const r of a.requires) {
      if (!idSet.has(r)) {
        throw new Error(`[workflow-loader] artifact "${a.id}" 依赖未知的 phase "${r}"`);
      }
      adj.get(r)!.push(a.id);
      indegree.set(a.id, (indegree.get(a.id) ?? 0) + 1);
    }
  }

  const ready = ids.filter((id) => (indegree.get(id) ?? 0) === 0);
  ready.sort();
  const out: string[] = [];

  while (ready.length > 0) {
    const u = ready.shift()!;
    out.push(u);
    for (const v of adj.get(u)!) {
      indegree.set(v, (indegree.get(v) ?? 0) - 1);
      if (indegree.get(v) === 0) {
        ready.push(v);
      }
    }
    ready.sort();
  }

  if (out.length !== ids.length) {
    throw new Error('[workflow-loader] workflow DAG 存在环');
  }
  return out;
}

export function isPhaseGlobalInWorkflow(spec: WorkflowSpec, phase: string): boolean {
  const a = spec.artifacts.find((x) => x.id === phase);
  return a?.scope === 'global';
}

export function workflowPhaseIdSet(spec: WorkflowSpec): Set<string> {
  return new Set(spec.artifacts.map((a) => a.id));
}

function validateWorkflow(raw: Partial<WorkflowSpec>, filePath: string): void {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`[workflow-loader] 非法 workflow YAML：${filePath}`);
  }
  if (raw.schema_version !== '1.0') {
    throw new Error(
      `[workflow-loader] 不支持的 schema_version="${String(raw.schema_version)}"（${filePath}）；当前仅支持 1.0`,
    );
  }
  if (!raw.name || typeof raw.name !== 'string') {
    throw new Error(`[workflow-loader] 缺少 name（${filePath}）`);
  }
  if (!Array.isArray(raw.artifacts) || raw.artifacts.length === 0) {
    throw new Error(`[workflow-loader] artifacts 必须为非空数组（${filePath}）`);
  }

  const ids = new Set<string>();
  for (const a of raw.artifacts) {
    if (!a || typeof a !== 'object') {
      throw new Error(`[workflow-loader] artifact 条目非法（${filePath}）`);
    }
    if (!a.id || typeof a.id !== 'string') {
      throw new Error(`[workflow-loader] artifact 缺少 id（${filePath}）`);
    }
    if (ids.has(a.id)) {
      throw new Error(`[workflow-loader] 重复的 artifact id "${a.id}"（${filePath}）`);
    }
    ids.add(a.id);
    if (a.scope !== 'global' && a.scope !== 'feature') {
      throw new Error(`[workflow-loader] artifact "${a.id}" scope 必须是 global|feature（${filePath}）`);
    }
    if (!Array.isArray(a.requires)) {
      throw new Error(`[workflow-loader] artifact "${a.id}" requires 必须是数组（${filePath}）`);
    }
  }

  for (const a of raw.artifacts) {
    for (const r of a.requires!) {
      if (!ids.has(r)) {
        throw new Error(`[workflow-loader] artifact "${a.id}" requires 引用未知 id "${r}"（${filePath}）`);
      }
    }
  }

  listWorkflowPhases(raw as WorkflowSpec);
}
