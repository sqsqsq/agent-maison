import { loadFrameworkConfig, relFeaturesDir } from '../../config';
import { resolveWorkflowSpec } from '../../workflow-loader';
import { profileHasDesignLens } from './blueprint-provider-boundary';
import { loadCanonicalChangeUnit, parseChangeUnitFeatureId } from './change-unit-path';
import { readFeatureFrozenScope } from './feature-execution-scope';
import { featureTrackDeclPath } from './feature-track';
import * as fs from 'fs';
import * as YAML from 'yaml';
import { decideRunContinuation, inspectGoalRunCreation } from './goal-run-creation';
import { loadGoalManifestFromRun } from './goal-manifest';
import { featurePhasesFromWorkflow } from './phase-transition-policy';

/** Birth-time preparation only; the current main Agent still owns model/design work. */
export function designDeliveryNextStep(input: {
  projectRoot: string; frameworkRoot: string; feature: string;
  completionTarget?: 'request' | 'feature'; requestedPhases?: string[];
  startPhase?: string; endPhase?: string; requirement?: string; requirementSourceFiles?: string[];
}) {
  const { projectRoot, frameworkRoot, feature } = input;
  if (!profileHasDesignLens(loadFrameworkConfig(projectRoot).project_profile.name)) return null;
  try {
    const identity = parseChangeUnitFeatureId(feature);
    loadCanonicalChangeUnit(projectRoot, identity.blueprintId, identity.changeUnitId);
    return null;
  } catch { /* A name alone is not a canonical CU. */ }
  if (readFeatureFrozenScope(projectRoot, feature)) return null;
  const continuation = decideRunContinuation({ projectRoot, feature, call: {
    requirement: input.requirement, requirementSourceFiles: input.requirementSourceFiles,
  } });
  if (continuation.kind === 'rejoin' || continuation.kind === 'successor') {
    const manifest = loadGoalManifestFromRun(projectRoot, continuation.kind === 'rejoin' ? continuation.runId : continuation.source, { feature });
    const creation = inspectGoalRunCreation(projectRoot, manifest);
    if (creation.state === 'complete' || creation.state === 'legacy') return null;
  }
  if (continuation.kind === 'hold') return null; // Existing recovery owns this decision.
  const file = featureTrackDeclPath(projectRoot, feature);
  const candidate = fs.existsSync(file) ? YAML.parse(fs.readFileSync(file, 'utf8'))?.execution_scope : undefined;
  const target = input.completionTarget ?? candidate?.request?.completion_target ?? 'feature';
  if (target !== 'feature') return null;
  const workflowPhases: string[] = featurePhasesFromWorkflow(resolveWorkflowSpec(projectRoot, { frameworkRoot }));
  const start = input.startPhase ? workflowPhases.indexOf(input.startPhase) : 0;
  const end = input.endPhase ? workflowPhases.indexOf(input.endPhase) + 1 : workflowPhases.length;
  const phases: string[] = input.requestedPhases ?? candidate?.request?.requested_phases ?? workflowPhases.slice(start, end);
  if (!phases.some(phase => phase === 'spec' || phase === 'plan')) return null;
  const requirementArguments = input.requirementSourceFiles?.length === 1
    ? ['--requirement-file', input.requirementSourceFiles[0]]
    : ['--requirement', input.requirement ?? ''];
  return {
    type: 'design_preparation_required', feature,
    reason: '新完整 Feature 的定义职责须先由当前主 Agent 完成蓝图与 CU 交接，候选文件不能代替初始设计。',
    materials: { requirement: input.requirement, requirement_source_files: input.requirementSourceFiles ?? [], features_dir: relFeaturesDir(projectRoot) },
    next: '在同一会话执行 component-design；完整交付已授权时消费以下结果并继续，准备入口不调用模型或创建 run。',
    steps: [
      { skill: 'component-design', action: '读取原始需求及已有蓝图/准入/CU；续用既有材料，完成蓝图、独立质询与真实校验，不凭空填写 blueprint id。', command: 'npm run check:component-blueprint -- --project-root <project-root> --blueprint <actual-blueprint-id> --write-review --json' },
      { action: '无 CU 时在既有蓝图 blueprint/ 目录写 JSON 数组 [{providerId, artifact}] 临时候选，不放工作区根；命令接受成功即删除候选（readiness 未就绪也删除），拒绝时保留，清理失败只提示。已有 CU 时仅用 --readiness 重派生（含指针调和和文档物化）。', command: `npm run check:change-unit -- --project-root <project-root> --blueprint <actual-blueprint-id> --accept-candidates "${relFeaturesDir(projectRoot)}/<actual-blueprint-id>/blueprint/change-unit-candidates.json" --json`, resume_command: 'npm run check:change-unit -- --project-root <project-root> --blueprint <actual-blueprint-id> --readiness --json' },
      { skill: 'change-unit-progression', action: '按既有 ready-set/selector 选择，读取命令返回的 canonical Feature id；不跳过 CU 依赖。', command: 'npx ts-node scripts/goal-mode-entry.ts --project-root <project-root> --prepare-scope --feature <returned-feature-id> --completion-target feature --requested-results <requested-results> --requested-phases <requested-phases> <requirement-arguments>', parameters: { project_root: projectRoot, requested_phases: phases, requirement_arguments: requirementArguments, requirement_source_files: input.requirementSourceFiles ?? [] } },
      { action: 'ready 后按用户选择 attended 或 detached 启动原 Goal；设计成本沿原记录与 Goal 预算合并披露，未取得握手不能宣称后台已运行。',
        attended_command: 'npx ts-node scripts/goal-mode-entry.ts --project-root <project-root> --prepare-run --run-mode attended --feature <selected-returned-feature-id> --adapter <active-adapter> <requirement-arguments>',
        detached_command: 'npx ts-node scripts/goal-runner.ts --feature <selected-returned-feature-id> --adapter <active-adapter> <requirement-arguments> --detach',
        parameters: { requirement_arguments: requirementArguments, cwd: '所选工程的 framework/harness', feature: 'check:change-unit 返回的 canonical id，经 P2 ready-set/selector 选择', adapter: '当前主 Agent 的既有 adapter', requirement: '原需求文本；有文件时以原 --requirement-file 替代 --requirement' } },
    ],
  };
}

export class DesignDeliveryPreparationRequired extends Error {
  constructor(readonly result: NonNullable<ReturnType<typeof designDeliveryNextStep>>) { super(result.reason); }
}
