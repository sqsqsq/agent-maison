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
import { readRequestIntake } from './request-intake';

/** Read-only entry projection. The Goal runtime owns the subsequent design and CU calls. */
export function designDeliveryNextStep(input: {
  projectRoot: string; frameworkRoot: string; feature: string;
  completionTarget?: 'request' | 'feature'; requestedPhases?: string[];
  startPhase?: string; endPhase?: string; requirement?: string; requirementSourceFiles?: string[];
  sessionRef?: string;
}) {
  const { projectRoot, frameworkRoot, feature } = input;
  if (!profileHasDesignLens(loadFrameworkConfig(projectRoot).project_profile.name)) return null;
  try {
    const identity = parseChangeUnitFeatureId(feature);
    loadCanonicalChangeUnit(projectRoot, identity.blueprintId, identity.changeUnitId);
    return null;
  } catch { /* A name alone is not a canonical CU. */ }
  if (readFeatureFrozenScope(projectRoot, feature)) return null;
  let intake: ReturnType<typeof readRequestIntake> | undefined;
  try { intake = readRequestIntake({ projectRoot, frameworkRoot, sessionRef: input.sessionRef?.trim() || undefined }); } catch { /* Unavailable origin cannot authorize a direct frame; existing design/recovery remains. */ }
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
  if (intake?.control.exempt || !managed && intake?.policy.selected === 'trivial') return {
    type: 'direct_change' as const, feature,
    reason: intake.control.exempt ? '真实user已明确豁免本请求，不创建Maison设计/CU/run。' : '同源规则判定为特别简单：直接修改，不创建蓝图、CU或Feature身份。',
    materials: { requirement: intake.user.text, session_ref: intake.session_ref },
    next: intake.control.exempt ? '沿用户本请求范围继续；不扩大真实授权和硬预算。' : '同一作者继续本请求；修改后调用现有compile，按适用义务调用自动review/UT/testing request。',
    steps: intake.control.exempt ? [] : [{ command: `npm run compile -- --project-root ${JSON.stringify(projectRoot)} --session-ref ${JSON.stringify(intake.session_ref)} --json` }],
  };

  if (!managed && intake?.policy.selected === 'small') return {
    type: 'compact_design_required' as const, feature,
    reason: '同源判定为小型；在同一蓝图完成本请求设计，不创建 CU 或初始设计 Goal。',
    materials: { requirement: intake.user.text, session_ref: intake.session_ref, requirement_source_files: input.requirementSourceFiles ?? [] },
    next: '同一作者在本请求自己的 component-blueprint.yaml 写本次目标、验收 ID、已知文件和必要局部选择；同请求未完成设计原位续写。调用同一 checker 准备来源并校验，后续 review/UT 复用返回的原 request_file。',
    steps: [{ skill: 'component-design', command: `npm run check:component-blueprint -- --project-root ${JSON.stringify(projectRoot)} --blueprint <actual-blueprint-id> --session-ref ${JSON.stringify(intake.session_ref)} --prepare-source --json` }],
  };

  const file = featureTrackDeclPath(projectRoot, feature);
  const candidate = fs.existsSync(file) ? YAML.parse(fs.readFileSync(file, 'utf8'))?.execution_scope : undefined;
  const target = input.completionTarget ?? candidate?.request?.completion_target ?? 'feature';
  if (target !== 'feature') return null;
  const workflowPhases: string[] = featurePhasesFromWorkflow(resolveWorkflowSpec(projectRoot, { frameworkRoot }));
  const start = input.startPhase ? workflowPhases.indexOf(input.startPhase) : 0;
  const end = input.endPhase ? workflowPhases.indexOf(input.endPhase) + 1 : workflowPhases.length;
  const phases: string[] = input.requestedPhases ?? candidate?.request?.requested_phases ?? workflowPhases.slice(start, end);
  if (!intake && !phases.some(phase => phase === 'spec' || phase === 'plan')) return null;
  const requirementArguments = input.requirementSourceFiles?.length === 1
    ? ['--requirement-file', input.requirementSourceFiles[0]]
    : ['--requirement', input.requirement ?? ''];
  const unknown = !managed && intake?.policy.selected === 'unknown'
    ? '档位未知，按完整设计推进；如属小改，可先完整读取相关来源，把七项按下列例句发在正常可见助手文本，再调用同一入口；勿等最后总结。值和路径须按本请求实际调研替换：“Q1=否，Q2=否，Q3=否，依赖结果=否，跨部件=否，预期明确=是，做法唯一=否。依据：<已读需求相对路径>、<已读源码相对路径>。”无需等待用户或自动重调。'
    : '';
  return {
    type: 'design_preparation_required' as const, feature,
    reason: unknown + '原始完整交付应先进入同一Goal runtime受管设计；施工仍等待真实蓝图、独立质询与CU准入，候选文件不能代替初始设计。',
    materials: { requirement: input.requirement, requirement_source_files: input.requirementSourceFiles ?? [], features_dir: relFeaturesDir(projectRoot),
      ...(intake ? { session_ref: intake.session_ref } : {}) },
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
