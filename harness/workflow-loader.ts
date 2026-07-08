// ============================================================================
// Workflow loader — resolves framework/workflows/<name>.workflow.yaml
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import type { FrameworkConfig } from './config';
import { loadFrameworkConfig } from './config';
import { inferRepoLayout } from './repo-layout';

export interface WorkflowArtifact {
  id: string;
  scope: 'global' | 'feature';
  check?: string;
  rule?: string;
  requires: string[];
  optional_deps?: string[];
  verifier_prompt?: string;
  skill_doc?: string;
  /** 1.1：feature phase 分轨成员资格；缺省 ["full"]（lite 须显式）；global 不得声明。 */
  tracks?: string[];
  /** 1.1：分轨依赖覆写；track 成员的 requires 引用轨外 feature phase 时必须声明（禁止隐式降空）。 */
  requires_by_track?: Record<string, string[]>;
}

export type WorkflowTransitionPolicy = 'manual' | 'batch_authorized' | 'goal_mode';

export interface WorkflowSpec {
  schema_version: string;
  name: string;
  description?: string;
  transition_policy?: WorkflowTransitionPolicy;
  auto_chain?: string[];
  /** 1.1：分轨显式链；存在非 full 轨专属 phase 时必须声明对应键（不做隐式推导）。 */
  auto_chain_by_track?: Record<string, string[]>;
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
    (opts?.frameworkRoot && opts.frameworkRoot.trim()) ||
    inferRepoLayout(projectRoot).frameworkRoot;
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
  const isV11 = raw.schema_version === '1.1';
  if (raw.schema_version !== '1.0' && !isV11) {
    throw new Error(
      `[workflow-loader] 不支持的 schema_version="${String(raw.schema_version)}"（${filePath}）；当前支持 1.0 / 1.1`,
    );
  }
  if (!raw.name || typeof raw.name !== 'string') {
    throw new Error(`[workflow-loader] 缺少 name（${filePath}）`);
  }
  if (!Array.isArray(raw.artifacts) || raw.artifacts.length === 0) {
    throw new Error(`[workflow-loader] artifacts 必须为非空数组（${filePath}）`);
  }

  if (raw.transition_policy !== undefined) {
    const allowed = new Set(['manual', 'batch_authorized', 'goal_mode']);
    if (!allowed.has(raw.transition_policy)) {
      throw new Error(
        `[workflow-loader] transition_policy 非法 "${String(raw.transition_policy)}"（${filePath}）`,
      );
    }
  }

  if (raw.auto_chain !== undefined) {
    if (!Array.isArray(raw.auto_chain) || raw.auto_chain.some((p) => typeof p !== 'string')) {
      throw new Error(`[workflow-loader] auto_chain 必须为字符串数组（${filePath}）`);
    }
  }

  if (raw.auto_chain_by_track !== undefined) {
    if (typeof raw.auto_chain_by_track !== 'object' || raw.auto_chain_by_track === null) {
      throw new Error(`[workflow-loader] auto_chain_by_track 必须为对象（${filePath}）`);
    }
    for (const [t, chain] of Object.entries(raw.auto_chain_by_track)) {
      if (!Array.isArray(chain) || chain.some((p) => typeof p !== 'string')) {
        throw new Error(`[workflow-loader] auto_chain_by_track.${t} 必须为字符串数组（${filePath}）`);
      }
    }
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

  validateTrackDeclarations(raw as WorkflowSpec, isV11, filePath);

  listWorkflowPhases(raw as WorkflowSpec);
}

// ---------------------------------------------------------------------------
// 1.1 分轨校验（plan d4a7c1e8 C1：lite 成员/链/依赖必须显式，禁止隐式推导）
// ---------------------------------------------------------------------------

const KNOWN_TRACKS = new Set(['full', 'lite']);

function artifactBelongsToTrack(a: WorkflowArtifact, track: string): boolean {
  if (a.scope === 'global') return true;
  return (a.tracks ?? ['full']).includes(track);
}

function validateTrackDeclarations(spec: WorkflowSpec, isV11: boolean, filePath: string): void {
  const hasTrackFields =
    spec.auto_chain_by_track !== undefined ||
    spec.artifacts.some((a) => a.tracks !== undefined || a.requires_by_track !== undefined);

  if (!isV11) {
    if (hasTrackFields) {
      throw new Error(
        `[workflow-loader] tracks / requires_by_track / auto_chain_by_track 仅 schema_version 1.1 可用（${filePath}）`,
      );
    }
    return;
  }

  const byId = new Map(spec.artifacts.map((a) => [a.id, a]));

  for (const a of spec.artifacts) {
    if (a.tracks !== undefined) {
      if (a.scope === 'global') {
        throw new Error(
          `[workflow-loader] global phase "${a.id}" 不得声明 tracks（global 对全 track 适用）（${filePath}）`,
        );
      }
      if (
        !Array.isArray(a.tracks) ||
        a.tracks.length === 0 ||
        a.tracks.some((t) => typeof t !== 'string' || !KNOWN_TRACKS.has(t))
      ) {
        throw new Error(`[workflow-loader] phase "${a.id}" tracks 非法（仅 full|lite）（${filePath}）`);
      }
    }
    if (a.requires_by_track !== undefined) {
      for (const [t, reqs] of Object.entries(a.requires_by_track)) {
        if (!KNOWN_TRACKS.has(t)) {
          throw new Error(
            `[workflow-loader] phase "${a.id}" requires_by_track 含未知 track "${t}"（${filePath}）`,
          );
        }
        if (!artifactBelongsToTrack(a, t)) {
          throw new Error(
            `[workflow-loader] phase "${a.id}" 不属于 track "${t}"，不得为其声明 requires_by_track（${filePath}）`,
          );
        }
        if (!Array.isArray(reqs) || reqs.some((r) => typeof r !== 'string')) {
          throw new Error(
            `[workflow-loader] phase "${a.id}" requires_by_track.${t} 必须为字符串数组（${filePath}）`,
          );
        }
        for (const r of reqs) {
          const ra = byId.get(r);
          if (!ra) {
            throw new Error(
              `[workflow-loader] phase "${a.id}" requires_by_track.${t} 引用未知 id "${r}"（${filePath}）`,
            );
          }
          if (ra.scope === 'feature' && !artifactBelongsToTrack(ra, t)) {
            throw new Error(
              `[workflow-loader] phase "${a.id}" requires_by_track.${t} 引用轨外 feature phase "${r}"（${filePath}）`,
            );
          }
        }
      }
    }
  }

  for (const t of Object.keys(spec.auto_chain_by_track ?? {})) {
    if (!KNOWN_TRACKS.has(t)) {
      throw new Error(`[workflow-loader] auto_chain_by_track 含未知 track "${t}"（${filePath}）`);
    }
  }

  // 非 full 轨（有显式成员声明的）逐轨校验
  const nonFullTracks = new Set<string>();
  for (const a of spec.artifacts) {
    for (const t of a.tracks ?? []) {
      if (t !== 'full') nonFullTracks.add(t);
    }
  }

  for (const t of nonFullTracks) {
    // 1) 成员 plain requires 引用轨外 feature phase 且未覆写 → FAIL（禁止隐式降空）
    for (const a of spec.artifacts) {
      if (a.scope !== 'feature' || !artifactBelongsToTrack(a, t)) continue;
      if (a.requires_by_track?.[t]) continue;
      for (const r of a.requires) {
        const ra = byId.get(r);
        if (ra && ra.scope === 'feature' && !artifactBelongsToTrack(ra, t)) {
          throw new Error(
            `[workflow-loader] phase "${a.id}" 在 track "${t}" 下 requires 引用轨外 phase "${r}"，` +
              `须显式声明 requires_by_track.${t}（${filePath}）`,
          );
        }
      }
    }

    // 2) 显式链强制存在
    const chain = spec.auto_chain_by_track?.[t];
    if (!chain || chain.length === 0) {
      throw new Error(
        `[workflow-loader] 存在 track "${t}" 专属 phase，但缺 auto_chain_by_track.${t}（不做隐式推导）（${filePath}）`,
      );
    }

    // 3) 链成员合法 + 链与有效依赖互洽（依赖须在链中先于自身）
    for (let i = 0; i < chain.length; i++) {
      const pa = byId.get(chain[i]);
      if (!pa || pa.scope !== 'feature' || !artifactBelongsToTrack(pa, t)) {
        throw new Error(
          `[workflow-loader] auto_chain_by_track.${t} 含非本轨 feature phase "${chain[i]}"（${filePath}）`,
        );
      }
      const reqs = pa.requires_by_track?.[t] ?? pa.requires;
      for (const r of reqs) {
        const ra = byId.get(r);
        if (!ra || ra.scope !== 'feature') continue;
        const j = chain.indexOf(r);
        if (j < 0 || j >= i) {
          throw new Error(
            `[workflow-loader] auto_chain_by_track.${t}："${chain[i]}" 依赖 "${r}" 须在链中先于它（${filePath}）`,
          );
        }
      }
    }
  }
}
