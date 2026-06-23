// ============================================================================
// skills-index-init-steps.ts — init_next_steps 类型、lint、index 条目展开
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import YAML from 'yaml';

import { loadWorkflowSpec, type WorkflowSpec } from '../../workflow-loader';
import { loadSkillsIndex, type SkillIndex, type SkillIndexEntry } from './resolve-skill-path';

export const INDEX_CAPABILITY_WHEN = [
  'catalog_empty',
  'glossary_empty',
  'graph_gap',
  'feature_ready',
  'always_optional',
] as const;

export type IndexCapabilityWhen = (typeof INDEX_CAPABILITY_WHEN)[number];

export const FORBIDDEN_INDEX_WHEN = ['failure_recovery', 'init_rerun'] as const;

export type InitNextStepKind = 'required' | 'optional';

export interface InitNextStepInvoke {
  neutral: string;
  command_id: string;
  param_hint?: string | null;
  availability_note?: string;
}

export interface SkillIndexInitNextStep {
  step_id: string;
  when: string;
  kind: InitNextStepKind;
  priority: number;
  workflow_artifact?: string;
  invoke: InitNextStepInvoke;
}

export interface ExpandedInitNextStepDef {
  enclosingSkillId: string;
  step: SkillIndexInitNextStep;
}

export interface SkillIndexEntryWithInitSteps extends SkillIndexEntry {
  init_next_steps?: SkillIndexInitNextStep[];
}

export interface SkillsIndexLintHit {
  id: string;
  message: string;
  skillId?: string;
  stepId?: string;
}

const WHEN_KIND_MAP: Record<IndexCapabilityWhen, InitNextStepKind> = {
  catalog_empty: 'optional',
  glossary_empty: 'optional',
  graph_gap: 'optional',
  feature_ready: 'optional',
  always_optional: 'optional',
};

const MUST_WORKFLOW_ARTIFACT_WHEN = new Set<IndexCapabilityWhen>(['graph_gap', 'feature_ready']);

export function parseSkillsIndexRaw(text: string): SkillIndex & { skills: SkillIndexEntryWithInitSteps[] } {
  return YAML.parse(text) as SkillIndex & { skills: SkillIndexEntryWithInitSteps[] };
}

export function listExpandedInitNextStepDefs(index: SkillIndex): ExpandedInitNextStepDef[] {
  const out: ExpandedInitNextStepDef[] = [];
  for (const entry of (index as { skills: SkillIndexEntryWithInitSteps[] }).skills) {
    for (const step of entry.init_next_steps ?? []) {
      out.push({ enclosingSkillId: entry.id, step });
    }
  }
  return out;
}

function collectWorkflowArtifactIds(frameworkDir: string): Set<string> {
  const wfDir = path.join(frameworkDir, 'workflows');
  const ids = new Set<string>();
  if (!fs.existsSync(wfDir)) return ids;
  for (const fn of fs.readdirSync(wfDir)) {
    if (!fn.endsWith('.workflow.yaml')) continue;
    const spec = loadWorkflowSpec(frameworkDir, fn.replace(/\.workflow\.yaml$/i, ''));
    for (const a of spec.artifacts) ids.add(a.id);
  }
  return ids;
}

export function lintSkillsIndexInitNextSteps(frameworkDir: string): SkillsIndexLintHit[] {
  const hits: SkillsIndexLintHit[] = [];
  const abs = path.join(frameworkDir, 'skills', 'skills.index.yaml');
  if (!fs.existsSync(abs)) {
    return [{ id: 'missing_index', message: 'skills.index.yaml 不存在' }];
  }
  const index = loadSkillsIndex(frameworkDir, true) as SkillIndex & {
    skills: SkillIndexEntryWithInitSteps[];
  };
  const workflowArtifactIds = collectWorkflowArtifactIds(frameworkDir);
  const artifactOwners = new Map<string, { skillId: string; stepId: string }>();

  for (const entry of index.skills) {
    const steps = entry.init_next_steps ?? [];
    const stepIds = new Set<string>();
    for (const step of steps) {
      if (stepIds.has(step.step_id)) {
        hits.push({
          id: 'duplicate_step_id',
          message: `skill ${entry.id} 内 step_id 重复: ${step.step_id}`,
          skillId: entry.id,
          stepId: step.step_id,
        });
      }
      stepIds.add(step.step_id);

      if ((FORBIDDEN_INDEX_WHEN as readonly string[]).includes(step.when)) {
        hits.push({
          id: 'forbidden_when',
          message: `index 禁止 when=${step.when}（recovery 由 harness 合成）`,
          skillId: entry.id,
          stepId: step.step_id,
        });
      }

      if (!(INDEX_CAPABILITY_WHEN as readonly string[]).includes(step.when)) {
        hits.push({
          id: 'unknown_when',
          message: `未知 when=${step.when}`,
          skillId: entry.id,
          stepId: step.step_id,
        });
        continue;
      }

      const expectedKind = WHEN_KIND_MAP[step.when as IndexCapabilityWhen];
      if (step.kind !== expectedKind) {
        hits.push({
          id: 'when_kind_mismatch',
          message: `when=${step.when} 须 kind=${expectedKind}，实际 ${step.kind}`,
          skillId: entry.id,
          stepId: step.step_id,
        });
      }

      if (MUST_WORKFLOW_ARTIFACT_WHEN.has(step.when as IndexCapabilityWhen) && !step.workflow_artifact) {
        hits.push({
          id: 'missing_workflow_artifact',
          message: `when=${step.when} 必须带 workflow_artifact`,
          skillId: entry.id,
          stepId: step.step_id,
        });
      }

      if (step.workflow_artifact) {
        if (!workflowArtifactIds.has(step.workflow_artifact)) {
          hits.push({
            id: 'invalid_workflow_artifact',
            message: `workflow_artifact=${step.workflow_artifact} 不在 workflows/*.workflow.yaml`,
            skillId: entry.id,
            stepId: step.step_id,
          });
        }
        const prev = artifactOwners.get(step.workflow_artifact);
        if (prev) {
          hits.push({
            id: 'ambiguous_workflow_artifact',
            message: `workflow_artifact=${step.workflow_artifact} 已被 ${prev.skillId}/${prev.stepId} 声明，与 ${entry.id}/${step.step_id} 冲突`,
            skillId: entry.id,
            stepId: step.step_id,
          });
        } else {
          artifactOwners.set(step.workflow_artifact, { skillId: entry.id, stepId: step.step_id });
        }
      }

      if (!step.invoke?.neutral || !step.invoke?.command_id) {
        hits.push({
          id: 'missing_invoke',
          message: 'invoke.neutral 与 invoke.command_id 必填',
          skillId: entry.id,
          stepId: step.step_id,
        });
      }

      if (typeof step.priority !== 'number' || Number.isNaN(step.priority)) {
        hits.push({
          id: 'invalid_priority',
          message: 'priority 须为数字',
          skillId: entry.id,
          stepId: step.step_id,
        });
      }
    }
  }

  return hits;
}

export function findIndexStepByWorkflowArtifact(
  index: SkillIndex,
  when: 'feature_ready' | 'graph_gap',
  workflowArtifactId: string,
): ExpandedInitNextStepDef | undefined {
  for (const entry of (index as { skills: SkillIndexEntryWithInitSteps[] }).skills) {
    for (const step of entry.init_next_steps ?? []) {
      if (step.when === when && step.workflow_artifact === workflowArtifactId) {
        return { enclosingSkillId: entry.id, step };
      }
    }
  }
  return undefined;
}

export function loadDefaultWorkflowSpec(frameworkDir: string): WorkflowSpec {
  return loadWorkflowSpec(frameworkDir, 'spec-driven');
}
