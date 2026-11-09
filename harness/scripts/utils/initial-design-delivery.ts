import * as fs from 'fs';
import { rebindTaskModel, freezeModelPin } from './adapter-model';
import * as path from 'path';
import * as YAML from 'yaml';
import { createHash } from 'crypto';
import { stableStringify } from './phase-evidence-manifest';
import { asRecord, asRecords, ComponentBlueprintResolutionError, blueprintAuthorContent, renderBlueprintFieldResponsibilities, type BlueprintRecord, type BlueprintIssue } from './component-blueprint-model';
import { loadFrameworkConfig, relFeaturesDir, featureFilePath, featurePhaseReportsDir } from '../../config';
import { resolveWorkflowSpec } from '../../workflow-loader';
import { featurePhasesFromWorkflow } from './phase-transition-policy';
import { buildInitialDesignGoalManifest, isInitialDesignManifest, isRepeatedRequirement, deriveSuccessorRequirement,
  loadGoalRunManifestFromRun, type GoalManifest, type InitialDesignGoalManifest, type GoalBudget,
  type UnattendedContract, type AdapterModelPin, type RunAdapterProvenance } from './goal-manifest';
import { assertGoalRunAttachable, createGoalRun, decideRunContinuation, buildSupersedeAuditEvent, type RunContinuationDecision } from './goal-run-creation';
import { ensureRunControl } from './goal-run-control';
import { readLockRecord, isLockStale } from './goal-run-lock';
import { componentBlueprintPath, loadCanonicalBlueprint } from './component-blueprint-path';
import { validateComponentBlueprint } from './component-blueprint-validator';
import { enumerateCanonicalChangeUnits, asChangeUnitArtifact, deriveChangeUnitFeatureId, changeUnitPath } from './change-unit-path';
import { diagnoseBlueprintSkillAuthority, diagnoseDesignAuthority, compareAuthoritativeContent } from './blueprint-skill-projection';
import { resolveProbeFrameworkRoot } from '../../repo-layout';
import { deriveChangeUnitReadySet } from './change-unit-ready-set';
import { readChangeUnitDesignOwnership } from './change-unit-design-gate';
import { deriveChangeUnitProgressionDecision, inspectActiveChangeUnitRuns } from './change-unit-progress-loop';
import { profileHasDesignLens } from './blueprint-provider-boundary';
import { loadEventsJsonlStrict, resolveEffectiveRunEnd } from './goal-runner-phase';
import { acceptedSessionReport, readHandoffMaterial, sessionReportInputPath, sessionExecutionForInvoke, type SessionExecutionReport } from './session-execution-handoff';
import { readOriginalDeliveryActivity, readOriginalDeliveryRuns, resolveOriginalDeliveryExecution, currentOriginalDelivery, type DeliveryRunFacts } from './delivery-origin';
import { independentQuestioningBlockers } from './blueprint-questioning';
import { renderQuestioningResultInstructions } from './blueprint-questioning';
import { extractProviderFinalText } from './codex-terminal-events';
import { invocationCompleted } from './invocation-completion';
import { dispositionFacts } from './goal-failure-classifier';
import { renderDesignAuthorityBoundary, writeBackAdmission, refreshBlueprintFingerprints, questioningDependencyChanges, latestUsableDesignQuestioning } from './design-repair-unattended';
import { currentBlueprintSliceId } from './blueprint-admission';
import type { ProviderRef } from './types';
import { prepareBlueprintDesignDraft, prepareBlueprintSourceItems } from './blueprint-discovery';
import { readCurrentDispositionInput } from './verify-feature-completion';
import { resolveCurrentDisposition, type CurrentDisposition, type CurrentDispositionProblem } from './check-disposition';
import { loadCanonicalComponentClosure } from './component-closure-path';
import { validateComponentClosure } from './component-closure-validator';
import { independentVerificationContext } from './verifier-material';

/** The caller places this existing writer outside the native invocation's attribution window. */
export function prepareInitialDesignDraft(input: {
  projectRoot: string; blueprintId: string; sourceRefs: readonly string[]; observedAt: string; sourceRef?: string;
  beforeBlueprint?: string;
  architecture?: import('../../config').ArchitectureDsl;
}): { blueprintPath: string; blueprint?: BlueprintRecord; written: boolean } {
  const blueprintPath = componentBlueprintPath(input.projectRoot, input.blueprintId);
  const before = fs.existsSync(blueprintPath) ? fs.readFileSync(blueprintPath, 'utf8') : '';
  let original: BlueprintRecord | undefined;
  if (before) {
    try { original = asRecord(YAML.parse(before)); } catch { return { blueprintPath, written: false }; }
    if (!original) return { blueprintPath, written: false };
  }
  const declaredScope = asRecords(asRecord(asRecord(original?.discovery)?.inputs)?.current_scope_items);
  const blueprint = prepareBlueprintDesignDraft(original, { blueprintId: input.blueprintId,
    sourceRef: input.sourceRef ?? input.sourceRefs[0], observedAt: input.observedAt,
    // Existing scope items are authored business coverage. A run's request is context, not another requirement item.
    currentScopeItems: declaredScope.length ? [] : prepareBlueprintSourceItems(input.projectRoot, input.sourceRefs, input.observedAt) });
  let earlier = original;
  if (input.beforeBlueprint !== undefined) {
    try { earlier = asRecord(YAML.parse(input.beforeBlueprint)); } catch { earlier = undefined; }
    if (earlier?.blueprint_id === input.blueprintId) {
      for (const key of ['component_id', 'blueprint_id', 'revision']) if (earlier[key] !== undefined) blueprint[key] = earlier[key];
    }
    const priorQuestioning = asRecord(earlier?.review_summary)?.questioning;
    const review = asRecord(blueprint.review_summary);
    if (review) {
      if (priorQuestioning === undefined) delete review.questioning;
      else review.questioning = structuredClone(priorQuestioning);
    }
  }
  const questioning = asRecord(asRecord(blueprint.review_summary)?.questioning);
  if (questioning && (!earlier || stableStringify(blueprintAuthorContent(earlier)) !== stableStringify(blueprintAuthorContent(blueprint)))) {
    questioning.status = 'incomplete';
  }
  refreshBlueprintFingerprints(blueprint);
  writeBackAdmission(blueprint, { projectRoot: input.projectRoot, canonicalPath: blueprintPath, architecture: input.architecture });
  if (original && stableStringify(original) === stableStringify(blueprint)) return { blueprintPath, blueprint, written: false };
  const text = YAML.stringify(blueprint);
  if (text === before) return { blueprintPath, blueprint, written: false };
  fs.mkdirSync(path.dirname(blueprintPath), { recursive: true });
  fs.writeFileSync(blueprintPath, text);
  return { blueprintPath, blueprint, written: true };
}

export interface InitialDesignRunInput {
  projectRoot: string; frameworkRoot: string; feature: string; adapter: string; requirement: string;
  requirementSourceFiles?: string[]; runId?: string; adapterSource?: RunAdapterProvenance;
  userDeadlineAt?: string;
  supersede?: string[];
  requestedResults?: string[]; requestedPhases?: string[]; startPhase?: string; endPhase?: string;
  budget?: GoalBudget; unattended?: UnattendedContract; adapterModelPin?: AdapterModelPin; modelOverride?: boolean;
  visualProviderPin?: ProviderRef; fidelity?: GoalManifest['fidelity'];
  resolveVisualProviderPin?: (frozen?: ProviderRef, successor?: boolean) => ProviderRef | undefined;
  dependencyPolicy?: GoalManifest['dependency_policy']; minimumAssurance?: GoalManifest['minimum_assurance'];
  preAuthorizedMutations?: GoalManifest['pre_authorized_mutations'];
}

/** Definitions name available checks; work authorization comes from the original request and canonical unit. */
export function initialDesignPhasePolicy(projectRoot: string, frameworkRoot: string, manifest: InitialDesignGoalManifest): { domain: string[]; explicit: string[] } {
  const explicit = [...manifest.initial_design.requested_phases];
  const domain = featurePhasesFromWorkflow(resolveWorkflowSpec(projectRoot, { frameworkRoot }));
  const outside = explicit.filter(phase => !domain.includes(phase as typeof domain[number]));
  if (outside.length) throw new Error(`[initial-design] explicit actions outside request domain: ${outside.join(', ')}`);
  return { domain, explicit };
}

/** A comes from the same candidate that the strict birth parser consumes, never from a derived chain. */
export function initialDesignScopeActionIssues(projectRoot: string, feature: string, policy: ReturnType<typeof initialDesignPhasePolicy>): string[] {
  const input = asRecord(YAML.parse(fs.readFileSync(featureFilePath(projectRoot, feature, 'feature.yaml'), 'utf8')));
  const actions = asRecord(asRecord(input?.execution_scope)?.request)?.requested_phases;
  if (!Array.isArray(actions) || actions.some(phase => typeof phase !== 'string')) return ['scope候选缺少明确动作A，请用原prepare-scope命令整份重生成。'];
  const missing = policy.explicit.filter(phase => !actions.includes(phase));
  const outside = actions.filter(phase => !policy.domain.includes(phase));
  return [...(missing.length ? [`scope动作A漏掉原请求明确动作E：${missing.join(', ')}；不得通过新出生取消原请求。`] : []),
    ...(outside.length ? [`scope动作A越出原请求域D：${outside.join(', ')}。`] : [])];
}

export function findInitialDesignRun(input: Pick<InitialDesignRunInput, 'projectRoot' | 'feature'> & { requirement?: string; runId?: string }): InitialDesignGoalManifest | null {
  const directory = path.join(input.projectRoot, relFeaturesDir(input.projectRoot), input.feature, 'goal-runs');
  const ids = input.runId ? [input.runId] : fs.existsSync(directory)
    ? fs.readdirSync(directory, { withFileTypes: true }).filter(item => item.isDirectory() && !item.name.startsWith('.')).map(item => item.name).sort().reverse() : [];
  for (const id of ids) {
    const file = path.join(directory, id, 'manifest.json');
    if (!fs.existsSync(file)) continue;
    const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!raw || typeof raw !== 'object' || !('initial_design' in raw)) continue;
    const loaded = loadGoalRunManifestFromRun(input.projectRoot, id, { feature: input.feature });
    if (!isInitialDesignManifest(loaded)) continue;
    const manifest = currentOriginalDelivery(input.projectRoot, loaded);
    if (input.requirement && !isRepeatedRequirement(manifest.requirement, input.requirement)) {
      if (input.runId) throw new Error('[initial-design] request differs from the bound original requirement');
      continue;
    }
    assertGoalRunAttachable(input.projectRoot, manifest);
    return manifest;
  }
  return null;
}

export function prepareInitialDesignRun(input: InitialDesignRunInput): { manifest: InitialDesignGoalManifest; manifestPath: string; runDir: string; created: boolean; continuation?: RunContinuationDecision } {
  if (!input.requirement.trim()) throw new Error('[initial-design] original requirement is required before managing a new design');
  if (!profileHasDesignLens(loadFrameworkConfig(input.projectRoot).project_profile.name)) throw new Error('[initial-design] design lens unavailable');
  const prior = findInitialDesignRun({ ...input, ...(input.supersede?.length ? { runId: undefined } : {}) });
  const previous = prior ?? findInitialDesignRun({ projectRoot: input.projectRoot, feature: input.feature });
  let targets = [...new Set((input.supersede ?? []).map(id => id.trim()).filter(Boolean))];
  if (targets.length) {
    if (targets.length !== 1) throw new Error('[initial-design] --supersede must identify one original request run');
    const target = loadGoalRunManifestFromRun(input.projectRoot, targets[0], { feature: input.feature });
    if (!isInitialDesignManifest(target) || currentOriginalDelivery(input.projectRoot, target).run_id !== previous?.run_id) {
      throw new Error('[initial-design] --supersede is outside the current original request');
    }
  }
  const rejoin = prior && targets[0] !== prior.run_id ? rebindTaskModel(prior, input.adapterModelPin, input.projectRoot, input.modelOverride === true,
    input.resolveVisualProviderPin?.(prior.visual_provider_pin, false) ?? input.visualProviderPin) : prior;
  if (rejoin && targets[0] !== rejoin.run_id) {
    if (rejoin.adapter !== input.adapter) throw new Error('[initial-design] adapter differs from the bound original request');
    const runDir = path.resolve(input.projectRoot, rejoin.report_dir);
    return { manifest: rejoin, manifestPath: path.join(runDir, 'manifest.json'), runDir, created: false };
  }
  if (!prior && targets.length && targets[0] !== previous?.run_id) targets = [];
  const continuation = previous ? decideRunContinuation({ projectRoot: input.projectRoot, frameworkRoot: input.frameworkRoot, feature: input.feature,
    call: { requirement: input.requirement, requirementSourceFiles: input.requirementSourceFiles, supersede: targets } }) : undefined;
  if (continuation?.kind === 'hold') throw new Error(`[initial-design] ${continuation.guidance}`);
  const source = continuation?.kind === 'successor'
    ? loadGoalRunManifestFromRun(input.projectRoot, continuation.source, { feature: input.feature }) : previous;
  if (source && !isInitialDesignManifest(source)) throw new Error('[initial-design] original request continuation source is a construction run');
  input = { ...input, adapterModelPin: freezeModelPin(input.adapterModelPin?.source === 'frontend' && source?.adapter === input.adapter && source.adapter_model_pin
    ? source.adapter_model_pin : input.adapterModelPin, input.projectRoot),
    visualProviderPin: input.resolveVisualProviderPin?.(source?.visual_provider_pin, Boolean(source)) ?? input.visualProviderPin };
  const sourceEnd = source ? resolveEffectiveRunEnd(loadEventsJsonlStrict(path.resolve(input.projectRoot, source.report_dir, 'events.jsonl')).events) : undefined;
  const newCycle = sourceEnd?.status === 'COMPLETED';
  if (source && !newCycle && source.adapter !== input.adapter) throw new Error('[initial-design] 未完成原请求更正须保留原adapter合同；先通过既有入口处理明确的adapter变更。');
  const inheritedRuns = source && !newCycle ? readOriginalDeliveryRuns(input.projectRoot, source) : undefined;
  if (source && !newCycle && inheritedRuns) {
    const live = inheritedRuns.find(run => { const lock = readLockRecord(path.resolve(input.projectRoot, run.manifest.report_dir, '.runner.lock'));
      return lock && !isLockStale(lock); });
    if (live) throw new Error(`[initial-design] 原请求仍有实际执行进程：${live.manifest.feature}/${live.manifest.run_id}；本次更正不并行出生第二作者，原进程停止或完成后重发本次输入。`);
    const execution = resolveOriginalDeliveryExecution(input.projectRoot, source, inheritedRuns);
    if (execution.request && !acceptedSessionReport(execution.runDir, execution.request)) {
      const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;
      throw new Error(`[initial-design] 原请求仍有尚未报告的签发窗口；本次更正尚未出生，不继续已被替换的旧工作。请只报告旧调用实际已发生的结果或真实等待原因，再重发本次更正；原SHA/deadline/预算保持不变。\n`
        + `npx ts-node ${quote(path.join(input.frameworkRoot, 'harness/scripts/goal-mode-entry.ts'))} --project-root ${quote(input.projectRoot)} --framework-root ${quote(input.frameworkRoot)} --feature ${quote(source.feature)} --run-id ${quote(source.run_id)} --adapter ${quote(source.adapter ?? input.adapter)} --run-mode attended --request ${quote(path.resolve(execution.runDir, execution.request.reference.path))} --report-result ${quote('@' + sessionReportInputPath(execution.runDir, execution.request))}`);
    }
  }
  const effectiveInput = source ? { ...source, ...input,
    requirement: deriveSuccessorRequirement(source.requirement, input.requirement) ?? input.requirement,
    requirementSourceFiles: [...new Set([...(source.requirement_source_files ?? []), ...(input.requirementSourceFiles ?? [])])],
    userDeadlineAt: newCycle ? input.userDeadlineAt : source.user_deadline_at ?? input.userDeadlineAt,
    requestedPhases: input.requestedPhases ?? source.initial_design.requested_phases,
    startPhase: input.startPhase ?? source.start_phase, endPhase: input.endPhase ?? source.end_phase,
    requestedResults: input.requestedResults ?? (isRepeatedRequirement(source.requirement, input.requirement)
      ? source.initial_design.requested_results : [...new Set([...source.initial_design.requested_results, input.requirement])]),
    unattended: input.unattended ?? source.unattended, adapterModelPin: input.adapterModelPin ?? (source.adapter === input.adapter ? source.adapter_model_pin : undefined),
    visualProviderPin: input.visualProviderPin ?? source.visual_provider_pin, fidelity: input.fidelity ?? source.fidelity,
    dependencyPolicy: input.dependencyPolicy ?? source.dependency_policy, minimumAssurance: input.minimumAssurance ?? source.minimum_assurance,
    preAuthorizedMutations: input.preAuthorizedMutations ?? source.pre_authorized_mutations } : input;
  const workflow = featurePhasesFromWorkflow(resolveWorkflowSpec(input.projectRoot, { frameworkRoot: input.frameworkRoot }));
  input = effectiveInput;
  const manifest = buildInitialDesignGoalManifest({ feature: input.feature, run_id: input.runId, requirement: input.requirement,
    ...(input.userDeadlineAt ? { user_deadline_at: input.userDeadlineAt } : {}),
    ...(source ? { successor_of: source.run_id } : {}),
    ...(input.requirementSourceFiles?.length ? { requirement_source_files: input.requirementSourceFiles } : {}),
    adapter: input.adapter, ...(input.adapterSource ? { adapter_provenance: input.adapterSource } : {}),
    start_phase: input.startPhase ?? workflow[0], end_phase: input.endPhase ?? workflow.at(-1),
    initial_design: { completion_target: 'feature', requested_results: input.requestedResults ?? [input.requirement], requested_phases: input.requestedPhases ?? [] },
    unattended: input.unattended ?? { write_mode: 'full-access', approval_mode: 'never' },
    ...(input.adapterModelPin ? { adapter_model_pin: input.adapterModelPin } : {}),
    ...(input.visualProviderPin ? { visual_provider_pin: input.visualProviderPin } : {}),
    ...(input.fidelity ? { fidelity: input.fidelity } : {}),
    ...(input.dependencyPolicy ? { dependency_policy: input.dependencyPolicy } : {}),
    ...(input.minimumAssurance ? { minimum_assurance: input.minimumAssurance } : {}),
    ...(input.preAuthorizedMutations ? { pre_authorized_mutations: input.preAuthorizedMutations } : {}),
  }, { projectRoot: input.projectRoot, featuresDir: relFeaturesDir(input.projectRoot) });
  initialDesignPhasePolicy(input.projectRoot, input.frameworkRoot, manifest);
  if (source) manifest.successor_of = source.run_id;
  const born = createGoalRun({ projectRoot: input.projectRoot, manifest, chain: [], ...(continuation ? { continuation } : {}) });
  const runDir = path.resolve(input.projectRoot, manifest.report_dir);
  if (source) fs.appendFileSync(born.eventsPath, JSON.stringify({ ...buildSupersedeAuditEvent({ targetRunId: source.run_id, supersedingRunId: manifest.run_id,
    ...(newCycle ? { deliveryCycleBoundary: source.run_id } : {}) }), ts: new Date().toISOString(), run_id: manifest.run_id }) + '\n');
  ensureRunControl(runDir, manifest.run_id);
  return { manifest, manifestPath: born.manifestPath, runDir, created: true, continuation };
}

export interface InitialDesignObservation {
  kind: 'author' | 'questioning' | 'decompose' | 'scope' | 'construction';
  blueprintPath: string; candidatesPath: string; issues: string[];
  blueprintIssues?: readonly BlueprintIssue[];
  disposition?: CurrentDisposition;
  progression?: ReturnType<typeof deriveChangeUnitProgressionDecision>;
  scope?: { feature: string; candidatePath: string; command: string };
  designRepair?: { feature: string; brief: import('./design-repair-unattended').DesignRepairBriefLike };
}

/** A path name or old closure cannot establish coverage of a different frozen request. */
function requestDesignRepair(projectRoot: string, manifest: InitialDesignGoalManifest): InitialDesignObservation['designRepair'] | undefined {
  if (!manifest.successor_of) return;
  const source = loadGoalRunManifestFromRun(projectRoot, manifest.successor_of, { feature: manifest.feature });
  if (isRepeatedRequirement(source.requirement, manifest.requirement ?? '')) return;
  if (!enumerateCanonicalChangeUnits(projectRoot, manifest.feature).length) {
    let existing: BlueprintRecord | undefined;
    try { existing = loadCanonicalBlueprint(projectRoot, manifest.feature).blueprint; }
    catch (error) { if (!(error instanceof ComponentBlueprintResolutionError)) throw error; }
    if (asRecord(asRecord(existing?.review_summary)?.admission)?.status !== 'pass') return;
  }
  const code = `requirement_increment:${createHash('sha256').update(manifest.requirement ?? '').digest('hex')}`;
  const events = loadEventsJsonlStrict(path.resolve(projectRoot, manifest.report_dir, 'events.jsonl')).events;
  const published = events.some(event => event.type === 'design_authority_repair' && 'stage' in event && event.stage === 'published'
    && 'checks' in event && asRecords(event.checks).some(check => check.check === 'initial-design:requirement'
      && Array.isArray(check.codes) && check.codes.includes(code)));
  if (published) return;
  return { feature: manifest.feature, brief: { class: 'B2', items: [{ class: 'B2', check: 'initial-design:requirement', codes: [code],
    artifacts: [path.relative(projectRoot, componentBlueprintPath(projectRoot, manifest.feature))],
    basis: `原请求=${source.requirement}\n本次合并后的完整请求=${manifest.requirement}\n需求来源=${(manifest.requirement_source_files ?? []).join('、')}`,
    needs: ['逐项将新增或更正的实质内容纳入当前交付切片、稳定义务与设计，再由独立质询核实真实覆盖；仅附加来源路径或沿用旧P3结论不足以完成本次请求。已有成功CU原件保持封卷，新增工作经原consumer提出真实新CU。'] }] } };
}

/** Same write discipline as existing design repair: an author never supplies its own independent verdict. */
export function validateInitialDesignInvocation(purpose: 'author' | 'questioning', before: string, after: string): string | null {
  if (!after) return null;
  try {
    const comparable = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(comparable);
      const record = asRecord(value);
      if (!record) return value;
      const normalized = Object.fromEntries(Object.entries(record).map(([key, item]) => [key, comparable(item)]));
      const provenance = asRecord(normalized.provenance);
      const observed = provenance?.observed_at;
      // YAML serializers may change only the spelling of an explicit, valid observation instant.
      if (typeof observed === 'string' && /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])[T ](?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(observed)) {
        const time = Date.parse(observed);
        const lastDay = new Date(Date.UTC(Number(observed.slice(0, 4)), Number(observed.slice(5, 7)), 0)).getUTCDate();
        if (Number.isFinite(time) && Number(observed.slice(8, 10)) <= lastDay) provenance!.observed_at = new Date(time).toISOString();
      }
      return normalized;
    };
    const previous = before ? asRecord(YAML.parse(before)) : {};
    const current = asRecord(YAML.parse(after));
    if (!current) return null; // Original schema/parse diagnostics remain repairable author work.
    const previousReview = asRecord(previous?.review_summary);
    const currentReview = asRecord(current.review_summary);
    const previousQuestioning = previousReview?.questioning;
    const currentQuestioning = currentReview?.questioning;
    if (purpose === 'author') {
      if (stableStringify(comparable(previousQuestioning ?? null)) !== stableStringify(comparable(currentQuestioning ?? null))
        && (asRecord(currentQuestioning)?.status === 'complete' || asRecord(previousQuestioning)?.status === 'complete')) return '设计作者不得编造或改写已完成的独立质询。';
      return null;
    }
    if (previousReview) delete previousReview.questioning;
    if (currentReview) delete currentReview.questioning;
    return stableStringify(comparable(previous)) === stableStringify(comparable(current)) ? null : '独立质询修改了questioning以外的设计内容。';
  } catch { return purpose === 'questioning' ? '独立质询输出不可解析。' : null; }
}

/** Observation only; admission, candidate acceptance and P3 writes remain runtime-owned. */
export function readInitialDesignDelivery(input: { projectRoot: string; frameworkRoot?: string; manifest: InitialDesignGoalManifest;
  providerState?: 'available' | 'unavailable' | 'unknown'; questioningCurrent?: boolean; questioningResult?: BlueprintRecord | null }): InitialDesignObservation {
  const blueprintPath = componentBlueprintPath(input.projectRoot, input.manifest.feature);
  const candidatesPath = path.join(path.dirname(blueprintPath), 'change-unit-candidates.json');
  const base = { blueprintPath, candidatesPath };
  if (!fs.existsSync(blueprintPath)) return { ...base, kind: 'author', issues: ['尚无蓝图，按原始需求与真实工程事实完成当前交付切片。'] };
  try {
    const designRepair = fs.existsSync(blueprintPath) ? requestDesignRepair(input.projectRoot, input.manifest) : undefined;
    if (designRepair) return { ...base, kind: 'author', designRepair, issues: designRepair.brief.items.map(item => item.basis) };
    const loaded = loadCanonicalBlueprint(input.projectRoot, input.manifest.feature);
    if (input.questioningResult) loaded.blueprint.review_summary = { ...asRecord(loaded.blueprint.review_summary), questioning: input.questioningResult };
    // Denials are author feedback; a pass alone needs the current author-content receipt.
    if (input.questioningResult === null || input.questioningCurrent === false && !independentQuestioningBlockers(loaded.blueprint).length) {
      const questioning = asRecord(asRecord(loaded.blueprint.review_summary)?.questioning);
      if (questioning) questioning.status = 'incomplete';
    }
    writeBackAdmission(loaded.blueprint, { projectRoot: input.projectRoot, canonicalPath: blueprintPath });
    const denied = asRecord(asRecord(loaded.blueprint.review_summary)?.questioning)?.status === 'complete' ? independentQuestioningBlockers(loaded.blueprint) : [];
    const blueprintIssues = validateComponentBlueprint(loaded.blueprint, { projectRoot: input.projectRoot, canonicalPath: blueprintPath });
    const disposition = resolveCurrentDisposition(readCurrentDispositionInput({ endpoint: 'design', projectRoot: input.projectRoot,
      blueprintPath, blueprint: loaded.blueprint, blueprintIssues, questioningFindings: denied,
      phase: 'component-design', providerState: input.providerState ?? 'unknown' }));
    const state = { ...base, blueprintIssues, disposition };
    const feedback = [...blueprintIssues.filter(issue => issue.severity === 'BLOCKER').map(issue => `${issue.id} ${issue.path}: ${issue.message}`),
      ...denied.map(item => `独立质询否定 ${String(item.scope_ref)}：${String(item.question)}；${String(item.answer ?? "")}；verification_refs=${JSON.stringify(item.verification_refs ?? [])}；由设计作者修复，原独立质询再核。`)];
    const units = enumerateCanonicalChangeUnits(input.projectRoot, input.manifest.feature);
    const inspection = inspectActiveChangeUnitRuns(input.projectRoot, units.map(item => asChangeUnitArtifact(item.changeUnit)));
    if (inspection.active.length) {
      const readySet = deriveChangeUnitReadySet(input.projectRoot, input.manifest.feature);
      const progression = deriveChangeUnitProgressionDecision(readySet, inspection);
      return { ...state, kind: 'construction', progression, issues: [...feedback, ...progression.reasons] };
    }
    if (disposition.completionBlocking.some(problem => problem.action === 'repair')) return { ...state, kind: 'author', issues: feedback };
    if (disposition.completionBlocking.length) return { ...state, kind: 'questioning', issues: feedback };
    if (!units.length) return { ...state, kind: 'decompose', issues: ['已准入蓝图尚无canonical CU，提出ChangeUnitCandidate[]供原consumer原子接受。'] };
    const readySet = deriveChangeUnitReadySet(input.projectRoot, input.manifest.feature);
    const progression = deriveChangeUnitProgressionDecision(readySet, inspection);
    const ownershipIssues = readChangeUnitDesignOwnership(input.projectRoot, input.manifest.feature);
    const ownershipFindings = ownershipIssues.map(issue => ({
        check: 'plan:cu:design-basis', class: 'B2' as const, codes: [issue.id],
        artifacts: [path.relative(input.projectRoot, blueprintPath).replace(/\\/g, '/')], basis: issue.message,
        needs: ['原设计作者通过既有CU候选批次为缺失义务选择责任单元；关系/决定/契约和变更目标须明确认领，保留原请求及未变依赖边界。不得让机器补写依赖，也不得降低验收或代写完成原件。'],
      }));
    const designCandidates = readySet.units.filter(item => item.completion.state !== 'VALID'
      && (item.changeUnit === progression.selected || item.blockers.length > 0
        || item.completion.currentDisposition?.completionBlocking.some(problem => problem.owner === 'external' && problem.action === 'repair')));
    for (const candidate of designCandidates) {
      const selected = candidate.changeUnit;
      const feature = deriveChangeUnitFeatureId(selected.blueprint_id, selected.change_unit_id);
      const frameworkRoot = input.frameworkRoot ?? resolveProbeFrameworkRoot(input.projectRoot, __dirname);
      const phases = new Set(candidate.completion.currentDisposition?.completionBlocking
        .filter(problem => problem.owner === 'external' && problem.action === 'repair').map(problem => problem.source_phase ?? problem.phase));
      const findings = [...diagnoseBlueprintSkillAuthority(input.projectRoot, frameworkRoot, feature).findings, ...ownershipFindings];
      for (const phase of phases) {
        let runId: string | undefined;
        try { runId = JSON.parse(fs.readFileSync(path.join(featurePhaseReportsDir(input.projectRoot, feature, phase, frameworkRoot), 'summary.json'), 'utf8')).run_id; }
        catch { /* The shared diagnosis retains unavailable source facts as unresolved. */ }
        findings.push(...diagnoseDesignAuthority(input.projectRoot, frameworkRoot, feature, phase, runId).findings);
      }
      const diagnosis = { findings: [...new Map(findings.map(finding => [stableStringify(finding), finding])).values()] };
      if (diagnosis.findings.length) {
        const cuPath = path.relative(input.projectRoot, changeUnitPath(input.projectRoot, selected.blueprint_id, selected.change_unit_id)).replace(/\\/g, '/');
        const designRepair = { feature: diagnosis.findings.some(item => item.artifacts.includes(cuPath)) ? feature : input.manifest.feature,
          brief: { class: diagnosis.findings.some(item => item.class === 'B2') ? 'B2' as const : 'B1' as const, items: diagnosis.findings } };
        return { ...state, kind: 'author', designRepair, progression, issues: diagnosis.findings.map(item => item.basis) };
      }
    }
    if (ownershipFindings.length) return { ...state, kind: 'author', issues: ownershipIssues.map(issue => issue.message),
      designRepair: { feature: input.manifest.feature, brief: { class: 'B2', items: ownershipFindings } } };
    return { ...state, kind: 'construction', progression, issues: progression.reasons };
  } catch (error) {
    if (!(error instanceof ComponentBlueprintResolutionError)) throw error;
    return { ...base, kind: 'author', issues: [(error as Error).message] };
  }
}

export function initialDesignInvocationLabel(observation: InitialDesignObservation): string {
  return observation.scope ? `initial-design-scope-${path.basename(path.dirname(observation.scope.candidatePath))}`
    : observation.kind === 'decompose' ? 'initial-design-decomposition'
    : `initial-design-${observation.kind === 'questioning' ? 'questioning' : 'author'}`;
}

function previousDesignWork(input: { projectRoot: string; manifest: InitialDesignGoalManifest; observation: InitialDesignObservation; deliveryRuns?: readonly DeliveryRunFacts[] }): { lines: string[]; questioned: boolean; formatRepair?: boolean } {
  const directory = path.dirname(input.observation.blueprintPath);
  const files = fs.existsSync(directory) ? fs.readdirSync(directory, { withFileTypes: true })
    .filter(item => item.isFile() && /\.(md|yaml|json)$/.test(item.name)).map(item => path.join(directory, item.name)) : [];
  const parts = files.length ? [`已有设计材料${input.observation.kind === 'questioning' ? '位置（正文阅读后按核源步骤读取）' : '（先读并继续，不从零重复探索）'}：\n${files.join('\n')}`] : [];
  if (input.observation.kind === 'author' && fs.existsSync(input.observation.blueprintPath)) {
    try {
      const previous = asRecord(YAML.parse(fs.readFileSync(input.observation.blueprintPath, 'utf8')));
      const denied = previous ? independentQuestioningBlockers(previous) : [];
      if (denied.length) parts.push('已有公开质询未闭合项（历史上下文；当前有效性须由本次真实Q原件核实，以下内容不签发当前结论）：\n'
        + denied.map(item => `${String(item.scope_ref)}：${String(item.question)}\n${String(item.answer ?? '')}`).join('\n\n'));
    } catch { /* Original parse diagnostics remain in the current machine feedback. */ }
  }
  const label = initialDesignInvocationLabel(input.observation);
  const runs = input.deliveryRuns ?? readOriginalDeliveryRuns(input.projectRoot, input.manifest);
  if (input.observation.kind === 'questioning') {
    const available = runs.filter(run => run.manifest.feature === input.manifest.feature)
      .map(run => ({ run, ...latestUsableDesignQuestioning(path.resolve(input.projectRoot, run.manifest.report_dir), [label], input.projectRoot, run.events) }));
    const usable = available.filter(item => item.original).sort((a, b) => String(a.run.manifest.created_at).localeCompare(String(b.run.manifest.created_at))).at(-1);
    const previous = usable?.original;
    let actualDiff: import('./types').ContextFileEntry[] | null = null;
    let affectedDependencies: import('./capability-resolution').ResolutionDependency[] = [];
    try {
      const current = loadCanonicalBlueprint(input.projectRoot, input.manifest.feature).blueprint;
      affectedDependencies = questioningDependencyChanges(input.projectRoot, current, previous?.preSnapshot, input.observation.blueprintPath);
      if (previous) actualDiff = [{ label: '(actual blueprint changes)', content: JSON.stringify(compareAuthoritativeContent(
        blueprintAuthorContent(YAML.parse(previous.beforeBlueprint)), blueprintAuthorContent(current)), null, 2) }];
    } catch { /* Missing originals retain full first-reading context. */ }
    parts.push(...independentVerificationContext({ previousOriginal: previous
      ? { label: previous.source, kind: 'path', content: '上轮公开独立质询完整原件；读取全部结论及未闭合项。' } : null,
      actualDiff, affectedDependencies, currentEvidence: [{ label: input.observation.blueprintPath, kind: 'path', content: '当前设计与全部机器缺口；旧run基线不是上次Q前像。' }] })
      .map(entry => `${entry.label}\n${entry.content}`));
    if (usable?.result) parts.push(`前次未通过的完整质询项（历史线索，必须逐项复核，不是当前结论）：\n${JSON.stringify(asRecords(usable.result.items)
      .filter(item => item.disposition === 'blocker').map(item => ({ scope_ref: item.scope_ref, question: item.question, answer: item.answer })), null, 2)}`);
    if (available.some(item => item.unavailable)) parts.push('上次质询未交回可用对象，请按既有格式返回。');
    return { lines: parts, questioned: !!previous, formatRepair: available.some(item => item.unavailable) };
  }
  const previous = runs.filter(run => run.manifest.feature === input.manifest.feature).flatMap(run => run.events
    .filter(event => event.type === 'agent_invoke_end' && event.phase === label && event.invoke_id).map(event => ({ run, event })))
    .sort((a, b) => String(a.event.ts).localeCompare(String(b.event.ts))).at(-1);
  if (!previous) return { lines: parts, questioned: false };
  const { run, event } = previous;
  const runDir = path.resolve(input.projectRoot, run.manifest.report_dir);
  let body: string | null = null;
  let source: string;
  // Read the previous call's transport, including process -> session successors.
  if (event.handoff_report) {
    source = path.resolve(runDir, event.handoff_report.path);
    const saved = readHandoffMaterial<{ report: SessionExecutionReport; draft_outputs?: Record<string, string> }>(runDir, event.handoff_report);
    body = saved.report.details ?? null;
  } else {
    const directory = path.join(runDir, 'phases', label, event.invoke_id!);
    const events = path.join(directory, 'agent-events.jsonl');
    source = fs.existsSync(events) ? events : path.join(directory, 'agent-output.log');
    if (fs.existsSync(source)) {
      const raw = fs.readFileSync(source, 'utf8');
      body = extractProviderFinalText(raw, run.manifest.adapter);
    }
  }
  const completed = invocationCompleted({ ...event, exitCode: event.exit_code });
  parts.push(`前次本职责实际执行结果：status=${event.status ?? 'unknown'}，exit=${event.exit_code ?? 'unknown'}，正常完成=${completed}，timed_out=${event.timed_out === true}。调用结束不等于本职产物完成。\n原调用与日志按 ${path.resolve(input.projectRoot, input.manifest.report_dir, 'events.jsonl')} 及manifest既有lineage中的本职责最近记录定位；调用编号和日志路径只作审计，不构成新业务工作。\n前次最终正文（只作线索，不是质量结论或本次授权）：\n${body || '无可提取的最终正文；按磁盘材料和当前机器缺口继续，不猜上轮结果。'}`);
  return { lines: parts, questioned: false };
}

function questioningReadingInstruction(blueprintPath: string, recheck: boolean, material: unknown[]): string {
  const review = path.join(path.dirname(blueprintPath), 'component-blueprint.review.md');
  const lines = fs.existsSync(review) ? fs.readFileSync(review, 'utf8').split(/\r?\n/) : [];
  const reference = lines.findIndex(line => line === '## 技术与追溯参考');
  const range = reference > 0 ? `当前正文仅为 ${review} 第1–${reference}行；第${reference + 1}行“技术与追溯参考”起为参考区。`
    : `评审文档：${review}；正文止于“技术与追溯参考”入口。当前未定位到准确截止行，先在该现有文档定位边界，不猜测读取整篇。`;
  const verification = '正文阅读后再读取以下来源位置、当前YAML/schema及必要源码核源，按当前必答scope完成实质质询；特别核实每个gap.needed_by按真实业务属于当前切片还是受控远期，机器编号不改变原gap.status，仍不明确或原blocker未解除就否定并交作者澄清业务gap；前次结论不能代替本轮核验。';
  material.push(review, verification);
  return `${range}\n${recheck
    ? '这是修订后的独立复核：按P1 §4/§5收尾顺序，从头通读当前正文，核既有意见、修法直接影响及跨段一致性；需要依据时再定向核相关原文、事实与精确验收。不重做完整八问、全需求/全源码或架构评审，不仅看diff或凭初稿记忆。'
    : '这是首次独立阅读：先只读首屏和上述正文范围，按P1 §5逐题回答八问并定位仍看不懂之处；完成前不读参考区、YAML、需求原文或项目源码，不用作者解释替正文补全含义。'}\n${verification}`;
}

export function initialDesignAuthorInstruction(input: { projectRoot: string; frameworkRoot: string; manifest: InitialDesignGoalManifest; observation: InitialDesignObservation; autonomyAuthorized: boolean; deliveryRuns?: readonly DeliveryRunFacts[]; material?: unknown[] }): string {
  const { manifest, observation, frameworkRoot } = input;
  const questioning = observation.kind === 'questioning';
  const designRole = questioning || observation.kind === 'author';
  const prior = previousDesignWork(input);
  const readingMaterial: unknown[] = [];
  const questioningBoundary = '必须在实际独立只读上下文/独立provider执行，不写蓝图/工程文件，不继承作者私有上下文。最终只返回既有questioning形状的JSON对象；框架保留本次原件并在完成与只读核对后回填review_summary.questioning。';
  const questioningInstruction = questioning
    ? `${questioningBoundary}\n${questioningReadingInstruction(observation.blueprintPath, prior.questioned, readingMaterial)}` : undefined;
  if (questioning) readingMaterial.unshift(questioningBoundary);
  let sliceId = `${manifest.feature}:current`;
  try { sliceId = currentBlueprintSliceId(loadCanonicalBlueprint(input.projectRoot, manifest.feature).blueprint) ?? sliceId; }
  catch { /* A missing or malformed author draft still receives the machine-allocated ID. */ }
  const sources = (manifest.requirement_source_files ?? []).join('、') || `${manifest.report_dir}/manifest.json#requirement`;
  const schemas = ['app-component-blueprint.schema.json', 'runtime-data-flow.schema.json', 'change-unit.schema.json'];
  const parts = [
    ...(questioning ? ['本职终点：完成当前蓝图的真实独立质询；先读评审正文，再核来源与当前设计。'] : [
      `原始正式需求：\n${manifest.requirement}`, `请求终点：${manifest.initial_design.completion_target}；${manifest.initial_design.requested_results.filter(result => result.trim() !== (manifest.requirement ?? '').trim()).join('；') || '完成上述原始需求的全部适用CU正式交付。'}`,
    ]),
    `需求原件${questioning ? '位置（正文阅读后核源）' : ''}：${sources}`,
    `固定blueprint_id=${manifest.feature}；产品工程根=${input.projectRoot}；框架根=${frameworkRoot}。`,
    renderBlueprintFieldResponsibilities(),
    ...(observation.kind === 'author' ? [`机器分配的当前切片技术标识=${sliceId}。作者只在业务gap.needed_by引用；admission整块（含current_slice和编号）由runtime维护，作者不得写入。`] : []),
    `读取 ${path.join(frameworkRoot, 'skills/project/component-design/SKILL.md')} 及其P1工作流；${questioning ? '工程AGENTS、catalog/glossary/architecture和必要源码在正文阅读后按核源步骤读取。' : '执行前读取工程AGENTS、catalog/glossary/architecture和相关真实源码。'}`,
    `当前准确schema：${schemas.map(name => path.join(frameworkRoot, 'harness/schemas', name)).join('；')}。${questioning ? '正文阅读后核源时' : ''}读取schema原文与相关跨视图检查规则，不猜字段、不复制示例答案。`,
    ...(input.autonomyAuthorized ? [
      '本次控制入口已核实可信原请求的原范围自主完整交付授权；这不是由运输能力、默认never/goal_mode、历史日志或Agent留痕授予的新权。',
      ...(designRole ? renderDesignAuthorityBoundary(questioning ? 'questioning' : 'author') : []),
      `原目标内常规确认依 ${path.join(frameworkRoot, 'skills/reference/user-confirmation-ux.md')} §9 自动决议，不重复索取已授事项；真实目标/验收改变、秘密、不可逆动作与用户硬预算仍守实际授权，不以此降低质量门或伪造人签。留痕只记入当前写集内既有设计材料，不另写phase账本。`,
      ...(designRole ? [questioning
        ? '核对设计方基于原文条件或时间范围的解释是否忠于全部当前适用要求与证据；只有解释会改变原需求/验收，或确实无法同时满足当前适用要求时，才判定需要需求方裁决。授权不代替独立质询、检查或准入。'
        : '原文有不同表述时，在原需求内依据原文自身的条件或时间范围解释，保留全部本次适用要求，将有来源依据的设计决定及两方出处记入现有设计材料，再交独立质询；不改需求，不删验收，不伪称用户逐项确认。'] : []),
    ] : []),
    '只展开当前交付切片，复用已批准机器投影；按原P1契约声明稳定义务及真实内部/外部契约，不伪造质量结果。',
    questioning ? '本次独立质询只读；只通过结果运输返回本次JSON原件，不写蓝图或其它工程文件。'
      : `本次唯一作者写集：${observation.scope?.candidatePath ?? (observation.kind === 'decompose' ? observation.candidatesPath : path.dirname(observation.blueprintPath))}。范围候选仅经现有prepare-scope命令生成。不得写产品源码、测试、framework或其它Feature/CU；不自行签机器准入、receipt、events或完成。`,
    ...prior.lines,
    ...(observation.kind === 'author' ? [
      `本次必须实际编写或补齐 ${observation.blueprintPath}，不是只调查、写author-findings.md或报告尚未完成。已有发现是中间材料；完成必要定向核实后立即把本次真实设计写进schema蓝图，并按当前机器缺口继续修到本职可交接。`,
      '先完成原需求的当前切片、4+1视图、稳定义务、内部/外部契约与数据/导航/失败恢复闭环；不等另一位作者接手，不以尚待独立质询为停止写蓝图的理由。没有真实授权或必需事实时明确具体缺口，不编答案。',
    ] : []),
    ...(observation.scope ? [
      `本次只准备已准入真实CU ${observation.scope.feature} 的施工范围输入，不写产品/测试/蓝图/canonical CU或其它CU。`,
      `必须使用既有机器命令生成 ${observation.scope.candidatePath}，不能手写绑定或假impact。\n${observation.scope.command}`,
      `D（原阶段域）=[${initialDesignPhasePolicy(input.projectRoot, frameworkRoot, manifest).domain.join(',')}]；E（明确动作）=[${initialDesignPhasePolicy(input.projectRoot, frameworkRoot, manifest).explicit.join(',')}]。本CU动作A由你按原请求/已准入CU选择，必须保留E且只能取D内阶段。E空不等于没有交付责任；不可删显式testing，也不把域D全抄成用户明确要求。完整feature的验收、设备与视觉义务仍由原resolver全量派生，不列testing不会裁掉真实设备/视觉要求；不得因缺工具缩减原目标。`,
      'impact-behavior-change判断的是最终用户在运行产品上可见或可操作的行为变化，不等同任何内部函数、公开API或部件状态变化。true会使testing入链并要求真实设备工具链；false仍保留验收设备层、性能待定和视觉定档的真实义务。工具缺失不是选择false的理由。依据该CU真实设计、源码与验收给完整判断、理由和实际来源；未知不能默认为false，也不复制root结论。必须整份生成候选，不手改hash。完成本职输入准备后由runtime严格验证、正式出生并施工。',
    ] : []),
    ...(observation.kind === 'decompose' ? ['本次只提出新CU候选，保留全部已有canonical CU、蓝图及有效交付原件；现有CU内容修订必须交原正式设计发布事务。'] : []),
    observation.kind === 'questioning'
      ? questioningInstruction!
      : observation.kind === 'author'
        ? '按原始需求与真实工程事实设计当前切片，保留本次必要契约、数据闭环及风险。内部存储契约可direction: internal，不要求制造远程API。不得自写独立questioning；机器admission由runtime派生。'
        : '只在本次签发写集内完成前述候选或范围输入；蓝图设计缺口交原设计责任方，不自行补改蓝图，不扩大当前写集或删除真实义务。',
    ...(observation.kind === 'questioning' ? renderQuestioningResultInstructions(loadCanonicalBlueprint(input.projectRoot, manifest.feature).blueprint, 'initial-design-questioning') : []),
    `蓝图位置：${observation.blueprintPath}；候选位置：${observation.candidatesPath}。候选形状为[{providerId,artifact}]，已有CU不重复创建。`,
    `实际检查命令（cwd=${path.join(frameworkRoot, 'harness')}）：npm run check:component-blueprint -- --project-root "${input.projectRoot}" --blueprint "${manifest.feature}" ${observation.kind === 'author' ? '--write-review ' : ''}--json。检查仍待质询不等于任务停止，报告真实产物/问题后由runtime继续。`,
    '完成本职工作后真实报告；作者调用结束不是原始交付完成。runtime负责真实检查、独立质询、CU接受/readiness与后续施工，不要自选阶段或伪造CU身份。',
    `当前职责=${observation.kind}。问题：\n${observation.issues.join('\n')}`,
  ];
  // Historical prose is reading context; candidates and actual dependencies are observed separately.
  input.material?.push(...parts.filter(part => !prior.lines.includes(part)).map(part =>
    part === parts.at(-1) && observation.disposition ? dispositionFacts(observation.disposition)
      : part === questioningInstruction ? readingMaterial : part), { formatRepair: prior.formatRepair === true });
  return parts.join('\n\n');
}

export interface InitialDesignDeliveryProjection {
  kind: 'initial_design_delivery'; feature: string; run_id: string;
  status: 'RUNNING' | 'HALTED' | 'COMPLETED';
  stage: 'author' | 'questioning' | 'decompose' | 'construction';
  complete: boolean;
  halt_reason?: string;
  recovery?: Record<string, unknown>;
  current?: { feature: string; run_id?: string; phase?: string; deadline?: string };
  issues: string[];
  activity: { calls: number; active_ms: number };
  current_disposition: CurrentDisposition;
  next_action: string;
  /** Read-only cursor across this request's original and origin-bound run events. */
  event_count: number;
}

/** Root completion consumes the same design, CU and formal assembly facts as their own endpoints. */
export function readInitialDesignCompletionDisposition(input: { projectRoot: string; frameworkRoot: string; manifest: InitialDesignGoalManifest;
  observation?: InitialDesignObservation }): CurrentDisposition {
  const observed = input.observation ?? readInitialDesignDelivery(input);
  const problems: CurrentDispositionProblem[] = [...(observed.disposition?.problems ?? [])];
  if (!observed.disposition) problems.push(...resolveCurrentDisposition(readCurrentDispositionInput({ endpoint: 'design', projectRoot: input.projectRoot,
    blueprintPath: observed.blueprintPath, blueprint: undefined, blueprintIssues: observed.blueprintIssues ?? [], phase: 'component-design' })).problems);
  if (['author', 'decompose', 'scope'].includes(observed.kind) && !observed.disposition?.completionBlocking.length) problems.push({
    phase: 'component-design', id: 'execution_scope', action: 'repair', affects: 'completion', severity: 'BLOCKER', owner: 'component-design',
    detail: observed.issues.join('；') || '原请求的设计/CU工作尚未交回。', files: [path.relative(input.projectRoot, observed.blueprintPath).replace(/\\/g, '/')] });
  const ready = observed.progression?.readySet;
  for (const unit of ready?.units ?? []) {
    const feature = deriveChangeUnitFeatureId(unit.changeUnit.blueprint_id, unit.changeUnit.change_unit_id);
    const current = unit.completion.currentDisposition;
    if (current) problems.push(...current.problems.map(problem => ({ ...problem, detail: `${feature}：${problem.detail}` })));
    if (unit.completion.state !== 'VALID' && !current?.completionBlocking.length) problems.push({ phase: 'construction', id: 'required_check_conclusion',
      action: 'verify', affects: 'completion', severity: 'BLOCKER', owner: feature, detail: `${feature} completion=${unit.completion.state}：${unit.completion.reasons.join('；')}` });
  }
  if (ready?.allCompleted) {
    try {
      const original = loadCanonicalComponentClosure(input.projectRoot, input.manifest.feature);
      const closure = validateComponentClosure(original.closure, input.projectRoot, input.manifest.feature);
      if (!closure.currentDisposition) throw new Error(closure.issues.map(issue => issue.message).join('；') || '缺当前组装核验结论');
      problems.push(...closure.currentDisposition.problems);
    } catch (error) {
      problems.push({ phase: 'component-closure', id: 'required_check_conclusion', action: 'verify', affects: 'completion', severity: 'BLOCKER', owner: 'component-closure',
        detail: `原请求的正式组装原件尚不可核验：${String(error)}` });
    }
  }
  return resolveCurrentDisposition({ endpoint: 'request', phases: [], additionalProblems: problems });
}

/** One original-request projection for status/monitor/assess; none of those consumers schedule work. */
export function projectInitialDesignDelivery(input: { projectRoot: string; frameworkRoot: string; manifest: InitialDesignGoalManifest }): InitialDesignDeliveryProjection {
  const { projectRoot } = input;
  const manifest = currentOriginalDelivery(projectRoot, input.manifest);
  const runDir = path.resolve(projectRoot, manifest.report_dir);
  const events = loadEventsJsonlStrict(path.join(runDir, 'events.jsonl'));
  if (events.corruptLines.length) throw new Error('[initial-design] corrupt original request events');
  const observed = readInitialDesignDelivery({ projectRoot, frameworkRoot: input.frameworkRoot, manifest });
  const currentDisposition = readInitialDesignCompletionDisposition({ ...input, manifest, observation: observed });
  const end = resolveEffectiveRunEnd(events.events);
  const disposition = end && 'run_disposition' in end && typeof end.run_disposition === 'string' ? end.run_disposition : undefined;
  const waitKind = end && 'run_wait_kind' in end && typeof end.run_wait_kind === 'string' ? end.run_wait_kind : undefined;
  const activity = readOriginalDeliveryActivity(projectRoot, manifest)!;
  const execution = resolveOriginalDeliveryExecution(projectRoot, manifest, activity.runs);
  const pending = execution.request && !acceptedSessionReport(execution.runDir, execution.request) ? execution.request : undefined;
  const active = observed.progression?.activeRun;
  const currentInvoke = [...execution.events].reverse().find(event => event.type === 'agent_invoke_start'
    && !execution.events.some(end => end.type === 'agent_invoke_end' && end.invoke_id === event.invoke_id));
  const currentPhase = pending?.request.context.phase ?? currentInvoke?.phase;
  const executing = !!pending || !!currentInvoke || execution.control?.owner?.state === 'active';
  const complete = end?.status === 'COMPLETED' && currentDisposition.completionEligible;
  const stage = observed.kind === 'scope' || complete ? 'construction' : observed.kind;
  return { kind: 'initial_design_delivery', feature: manifest.feature, run_id: manifest.run_id,
    status: complete ? 'COMPLETED' : end?.status === 'HALTED' || end?.status === 'INTERRUPTED' ? 'HALTED' : 'RUNNING', stage, complete,
    ...(typeof end?.halt_reason === 'string' ? { halt_reason: end.halt_reason } : {}),
    ...(end && 'recovery' in end && end.recovery && typeof end.recovery === 'object' ? { recovery: end.recovery as Record<string, unknown> }
      : end && disposition ? { recovery: { run_disposition: disposition,
        ...(waitKind ? { run_wait_kind: waitKind } : {}),
        ...('halt_guidance' in end ? { halt_guidance: end.halt_guidance } : 'error' in end ? { halt_guidance: end.error } : {}) } } : {}),
    ...(executing ? { current: { feature: execution.manifest.feature, run_id: execution.manifest.run_id,
      ...(currentPhase ? { phase: String(currentPhase) } : {}), ...(pending?.request.context.user_deadline_at ? { deadline: pending.request.context.user_deadline_at } : {}) } } : {}),
    issues: currentDisposition.reasons,
    current_disposition: currentDisposition,
    activity: { calls: activity.calls, active_ms: activity.active_ms },
    next_action: complete ? 'delivery_completed' : pending ? 'execute_signed_request' : active ? 'resume_active' : stage,
    event_count: activity.events.length,
  };
}
