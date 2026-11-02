import { loadFrameworkConfig, relFeaturesDir } from '../../config';
import { resolveWorkflowSpec } from '../../workflow-loader';
import { profileHasDesignLens } from './blueprint-provider-boundary';
import { loadCanonicalChangeUnit, parseChangeUnitFeatureId } from './change-unit-path';
import { readFeatureFrozenScope } from './feature-execution-scope';
import { featureTrackDeclPath } from './feature-track';
import * as fs from 'fs';
import * as YAML from 'yaml';
import { decideRunContinuation, inspectGoalRunCreation } from './goal-run-creation';
import { loadGoalRunManifestFromRun, isInitialDesignManifest } from './goal-manifest';
import { featurePhasesFromWorkflow } from './phase-transition-policy';

/** Read-only entry projection. The Goal runtime owns the subsequent design and CU calls. */
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
  const { findInitialDesignRun } = require('./initial-design-delivery') as typeof import('./initial-design-delivery');
  const managed = findInitialDesignRun({ projectRoot, feature, requirement: input.requirement });
  const continuation = managed ? null : decideRunContinuation({ projectRoot, frameworkRoot, feature, call: {
    requirement: input.requirement, requirementSourceFiles: input.requirementSourceFiles,
  } });
  if (continuation?.kind === 'rejoin' || continuation?.kind === 'successor') {
    const manifest = loadGoalRunManifestFromRun(projectRoot, continuation.kind === 'rejoin' ? continuation.runId : continuation.source, { feature });
    const creation = inspectGoalRunCreation(projectRoot, manifest);
    if (!isInitialDesignManifest(manifest) && (creation.state === 'complete' || creation.state === 'legacy')) return null;
  }
  if (continuation?.kind === 'hold') return null; // Existing recovery owns this decision.
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
    reason: '原始完整交付应先进入同一Goal runtime受管设计；施工仍等待真实蓝图、独立质询与CU准入，候选文件不能代替初始设计。',
    materials: { requirement: input.requirement, requirement_source_files: input.requirementSourceFiles ?? [], features_dir: relFeaturesDir(projectRoot) },
    next: '以原请求调用既有prepare-run/next或goal-runner启动同一runtime，持续到原终点。prepare-scope本次只投影入口、不写平面候选；以下设计及CU步骤由runtime消费，不交回主Agent手工串接。',
    steps: [
      { skill: 'component-design', action: 'runtime签发受控作者请求，读取原始需求及已有蓝图/准入/CU；续用既有材料，完成蓝图、真实独立质询与校验，不凭空填写CU身份。', command: 'npm run check:component-blueprint -- --project-root <project-root> --blueprint <actual-blueprint-id> --write-review --json' },
      { action: '无 CU 时在既有蓝图 blueprint/ 目录写 JSON 数组 [{providerId, artifact}] 临时候选，不放工作区根；命令接受成功即删除候选（readiness 未就绪也删除），拒绝时保留，清理失败只提示。已有 CU 时仅用 --readiness 重派生（含指针调和和文档物化）。', command: `npm run check:change-unit -- --project-root <project-root> --blueprint <actual-blueprint-id> --accept-candidates "${relFeaturesDir(projectRoot)}/<actual-blueprint-id>/blueprint/change-unit-candidates.json" --json`, resume_command: 'npm run check:change-unit -- --project-root <project-root> --blueprint <actual-blueprint-id> --readiness --json' },
      { skill: 'change-unit-progression', action: '按既有 ready-set/selector 选择，读取命令返回的 canonical Feature id；不跳过 CU 依赖。', command: 'npx ts-node scripts/goal-mode-entry.ts --project-root <project-root> --prepare-scope --feature <returned-feature-id> --completion-target feature --requested-results <requested-results> --requested-phases <requested-phases> <requirement-arguments>', parameters: { project_root: projectRoot, requested_phases: phases, requirement_arguments: requirementArguments, requirement_source_files: input.requirementSourceFiles ?? [] } },
      { action: '同一runtime在原运输下启动/恢复正常CU；设计与施工成本沿原请求累计，未取得握手不能宣称后台已运行。',
        attended_command: 'npx ts-node scripts/goal-mode-entry.ts --project-root <project-root> --prepare-run --run-mode attended --feature <selected-returned-feature-id> --adapter <active-adapter> <requirement-arguments>',
        detached_command: 'npx ts-node scripts/goal-runner.ts --feature <selected-returned-feature-id> --adapter <active-adapter> <requirement-arguments> --detach',
        parameters: { requirement_arguments: requirementArguments, cwd: '所选工程的 framework/harness', feature: 'check:change-unit 返回的 canonical id，经 P2 ready-set/selector 选择', adapter: '原请求已绑定的 adapter', requirement: '原需求文本；有文件时以原 --requirement-file 替代 --requirement' } },
    ],
  };
}

export class DesignDeliveryPreparationRequired extends Error {
  constructor(readonly result: NonNullable<ReturnType<typeof designDeliveryNextStep>>) { super(result.reason); }
}
