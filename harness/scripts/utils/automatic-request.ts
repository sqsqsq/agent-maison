import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import * as crypto from 'crypto';
import { readRequestIntake, resolveRequestSessionReference, intakeIdentity, type RequestIntake } from './request-intake';
import { compareRequestContent, deriveContentImpact, type RequestComparison } from './content-impact';
import { standaloneReportDir } from './standalone-report-dir';
import { realProjectPath } from './project-relative-path';
import type { PreparedRequest } from './capability-resolution-entry-input';
import { prepareBlueprintSourceItems } from './blueprint-discovery';
import type { CurrentScopeItem } from './blueprint-requirement-traceability';
import type { InitialDesignGoalManifest } from './goal-manifest';
import type { ScopeUserControlSource } from './execution-scope';
import type { AcceptanceSpec } from './types';
import { collectRequestDeviceAcceptance } from './acceptance-layering';
import { componentBlueprintPath } from './component-blueprint-path';
import { loadFrameworkConfig } from '../../config';
import { loadResolvedProfile } from '../../profile-loader';
import { dispatchRequestTargetProbe } from '../../capability-registry';

/** Project original request obligations from the same acceptance and current product impact. */
export function requestTestingScope(projectRoot: string, intake: RequestIntake | undefined, acceptance: AcceptanceSpec, acceptanceIds: readonly string[], comparison?: RequestComparison) {
  const excluded = intake?.control.exempt || intake?.control.excluded.includes('testing') || false;
  const items = collectRequestDeviceAcceptance(acceptance, acceptanceIds);
  const impacts = intake ? deriveContentImpact(projectRoot, intake, comparison).filter(item => item.verification_family === 'testing') : [];
  return { excluded, items, impacts, required: !excluded && (items.length > 0 || impacts.length > 0) };
}

/** Canonical original Goal is an existing requirement source, never a second mutable request. */
export function readDesignGoalOrigin(root: string, reference: string): { manifest: InitialDesignGoalManifest; reference: string; controls: ScopeUserControlSource[] } {
  const file = realProjectPath(root, reference, 'original design Goal');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const { loadGoalRunManifestFromRun, isInitialDesignManifest } = require('./goal-manifest') as typeof import('./goal-manifest');
  const { assertGoalRunAttachable } = require('./goal-run-creation') as typeof import('./goal-run-creation');
  const manifest = loadGoalRunManifestFromRun(root, raw.run_id, { feature: raw.feature });
  if (!isInitialDesignManifest(manifest) || path.resolve(root, manifest.report_dir, 'manifest.json') !== path.resolve(file)) throw new Error('origin_request must locate the canonical original initial-design manifest');
  assertGoalRunAttachable(root, manifest);
  const { loadAuthoritativeEvents } = require('./goal-runner-phase') as typeof import('./goal-runner-phase');
  const { readAcceptedScopeUserControlSource } = require('./execution-scope') as typeof import('./execution-scope');
  const controls = loadAuthoritativeEvents(path.resolve(root, manifest.report_dir, 'events.jsonl')).flatMap(event => {
    const control = (event as unknown as Record<string, unknown>).user_control;
    if (event.type !== 'run_start' || !control) return [];
    const source = readAcceptedScopeUserControlSource(control as ScopeUserControlSource, { feature: manifest.feature, runId: manifest.run_id });
    return source ? [source] : [];
  });
  return { manifest, reference: path.relative(root, file).replace(/\\/g, '/'), controls };
}
export function applyDesignGoalControl(intake: RequestIntake, controls: readonly ScopeUserControlSource[]): RequestIntake {
  const { nativeFixedScale } = require('./request-intake') as typeof import('./request-intake');
  const { resolveDeliveryPolicy } = require('./execution-scope') as typeof import('./execution-scope');
  const control = structuredClone(intake.control);
  for (const source of controls) {
    if (source.fixed) control.fixed = nativeFixedScale(source.fixed);
    control.excluded = [...new Set([...control.excluded, ...(source.excluded ?? [])])].filter(family => !source.included?.includes(family));
    if (!control.sources.includes(source.session_ref)) control.sources.push(source.session_ref);
  }
  return { ...intake, control, policy: resolveDeliveryPolicy(intake.facts, control.fixed),
    gaps: intake.gaps };
}

export function resumeAcceptedDesignIntake(projectRoot: string, submitted: RequestIntake | undefined,
  origin: ReturnType<typeof readDesignGoalOrigin>): RequestIntake | undefined {
  if (!submitted) return undefined;
  const verified = origin.controls.find(source => source.session_ref === submitted.session_ref && source.user?.id === submitted.user?.id
    && source.user.text === submitted.user.text);
  if (!verified?.user || !submitted.session_id || typeof submitted.session_ref !== 'string') return undefined;
  const { resolveDeliveryPolicy } = require('./execution-scope') as typeof import('./execution-scope');
  const facts = Object.fromEntries(Object.keys(submitted.facts).map(key => [key,
    { value: 'unknown', reason: '继续已受理的工作流选择', sources: [] }])) as unknown as RequestIntake['facts'];
  const targets = (submitted.explicit_targets ?? []).map(file => path.relative(projectRoot, realProjectPath(projectRoot, file, 'retained explicit target')).replace(/\\/g, '/'));
  const { requestTargetFingerprint } = require('./request-intake') as typeof import('./request-intake');
  return applyDesignGoalControl({
    session_ref: verified.session_ref, session_id: submitted.session_id, user: { ...verified.user, line: submitted.user.line },
    user_messages: origin.controls.flatMap((source, index) => source.user ? [{ ...source.user, line: index + 1 }] : []),
    boundary: { origin_user_id: verified.user.id, explanation: '沿原 Goal 的已受理用户来源接续', source_line: submitted.user.line },
    control: { exempt: false, scope: 'request', excluded: [], sources: [] },
    facts, policy: resolveDeliveryPolicy(facts), baseline: submitted.baseline, explicit_targets: targets, targets,
    attribution_unknown: [], content_fingerprint: requestTargetFingerprint(projectRoot, targets), gaps: [],
  }, origin.controls);
}

function list(value: unknown): string[] {
  if (value === undefined) return [];
  const values = Array.isArray(value) ? value : [value];
  if (values.some(item => typeof item !== 'string' || !item.trim())) throw new Error('request targets must be nonempty paths');
  return values as string[];
}
function atomicJson(file: string, value: unknown): void {
  atomicText(file, JSON.stringify(value, null, 2) + '\n');
}
function atomicText(file: string, value: string): void {
  const temporary = `${file}.${process.pid}.tmp`;
  try { fs.writeFileSync(temporary, value, { flag: 'wx' }); fs.renameSync(temporary, file); }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
export type DesignPreparationWrite = (file: string, text: string) => void;
/** One synchronous checker call: retain only its request/source/canonical write preimages. */
export function createDesignPreparationWrite(): { write: DesignPreparationWrite; commit(): void; rollback(): void } {
  const originals = new Map<string, Buffer | undefined>();
  let committed = false;
  return {
    write(file, value) {
      if (committed) throw new Error('design preparation already committed');
      if (!originals.has(file)) originals.set(file, fs.existsSync(file) ? fs.readFileSync(file) : undefined);
      atomicText(file, value);
    },
    commit() { committed = true; originals.clear(); },
    rollback() {
      if (committed) return;
      for (const [file, before] of [...originals].reverse()) {
        if (before) { const temporary = `${file}.${process.pid}.rollback`; fs.writeFileSync(temporary, before); fs.renameSync(temporary, file); }
        else if (fs.existsSync(file)) fs.unlinkSync(file);
      }
      originals.clear();
    },
  };
}
export function retainRequestFailures(reportDir: string, currentRequestSha?: string): void {
  for (const name of ['summary.json', 'script-report.json']) {
    const original = path.join(reportDir, name);
    if (!fs.existsSync(original)) continue;
    const bytes = fs.readFileSync(original), prior = JSON.parse(bytes.toString('utf8'));
    if (!['FAIL', 'INCOMPLETE'].includes(prior.verdict ?? prior.summary?.verdict) && (!currentRequestSha || prior.request_sha256 === currentRequestSha)) continue;
    const retained = path.join(reportDir, name.replace('.json', `.${crypto.createHash('sha256').update(bytes).digest('hex')}.json`));
    if (!fs.existsSync(retained)) fs.copyFileSync(original, retained, fs.constants.COPYFILE_EXCL);
  }
}

export interface DesignRequestOptions {
  projectRoot: string; frameworkRoot: string; blueprintId: string;
  sessionRef?: string; requestFile?: string; reportDir?: string; targets?: string[];
  requirementSources?: string[]; readonly?: boolean;
  write?: DesignPreparationWrite;
  originRequest?: string;
}
export interface PreparedDesignRequest {
  requestFile: string; reportDir: string; intake?: RequestIntake;
  sourceRefs: string[]; currentScopeItems: CurrentScopeItem[]; originGap?: string;
}

/** Same request carrier, genuine design subject; no verification phase or Feature is invented. */
export function prepareDesignRequest(options: DesignRequestOptions): PreparedDesignRequest {
  const root = fs.realpathSync(options.projectRoot);
  const existingFile = options.requestFile ? realProjectPath(root, options.requestFile, 'design request') : undefined;
  let previous = existingFile && fs.existsSync(existingFile) ? JSON.parse(fs.readFileSync(existingFile, 'utf8')) as Record<string, unknown> : undefined;
  const publish = options.write ?? atomicText;
  let origin = options.originRequest || typeof previous?.origin_request === 'string'
    ? readDesignGoalOrigin(root, options.originRequest ?? String(previous!.origin_request)) : undefined;
  if (previous && previous.phase !== 'component-design') throw new Error('design source must be the original component-design request');
  let readonlyIntake: RequestIntake | undefined;
  if (previous && options.readonly) {
    const { prepareRequestInput } = require('./capability-resolution-entry-input') as typeof import('./capability-resolution-entry-input');
    const parsed = prepareRequestInput({ projectRoot: root, frameworkRoot: options.frameworkRoot, phase: 'component-design', requestFile: path.relative(root, existingFile!),
      reportDir: options.reportDir ?? path.relative(root, path.dirname(existingFile!)) });
    if (options.sessionRef === undefined && options.targets === undefined) readonlyIntake = parsed.intake_context;
  }
  const location = resolveRequestSessionReference(options.sessionRef ?? (previous?.intake_context as RequestIntake | undefined)?.session_ref, root);
  let intake: RequestIntake | undefined, originGap = location.gap;
  if (location.sessionRef) try {
    intake = readonlyIntake?.session_ref === location.sessionRef ? readonlyIntake : readRequestIntake({ projectRoot: root, frameworkRoot: options.frameworkRoot, sessionRef: location.sessionRef,
      explicitTargets: options.targets ?? (previous?.intake_context as RequestIntake | undefined)?.explicit_targets ?? (!previous?.intake_context ? (previous?.targets as { files?: string[] } | undefined)?.files : undefined),
      previous: previous?.intake_context as RequestIntake | undefined });
  } catch (error) { originGap = String(error); }
  const fallbackId = crypto.createHash('sha256').update(options.blueprintId).digest('hex').slice(0, 16);
  const requestedDir = options.reportDir ?? (existingFile ? path.relative(root, path.dirname(existingFile)) : `doc/reports/request/${origin ? 'goal-' + crypto.createHash('sha256').update(origin.reference).digest('hex').slice(0, 16) : intake ? intakeIdentity(intake) : 'unverified-' + fallbackId}/component-design`);
  const reportDir = standaloneReportDir(root, options.frameworkRoot, requestedDir);
  const requestFile = existingFile ?? realProjectPath(root, path.relative(root, path.join(reportDir, 'request.json')), 'design request');
  if (!previous && fs.existsSync(requestFile)) {
    previous = JSON.parse(fs.readFileSync(requestFile, 'utf8')) as Record<string, unknown>;
    if (previous.phase !== 'component-design') throw new Error('design request path belongs to another subject');
    const retained = previous.intake_context as RequestIntake | undefined;
    if (retained && !intake) throw new Error('existing design request origin cannot be replaced by an unverified request');
    if (intake && retained) {
      intake = readRequestIntake({ projectRoot: root, frameworkRoot: options.frameworkRoot, sessionRef: intake.session_ref,
        explicitTargets: options.targets ?? retained.explicit_targets,
        previous: retained });
    }
  }
  if (!origin && typeof previous?.origin_request === 'string') origin = readDesignGoalOrigin(root, previous.origin_request);
  if (origin && previous?.origin_request && previous.origin_request !== origin.reference) throw new Error('design request belongs to another original Goal');
  if (origin && !intake) {
    intake = resumeAcceptedDesignIntake(root, previous?.intake_context as RequestIntake | undefined, origin);
    if (intake) originGap = undefined;
  } else if (intake && origin) intake = applyDesignGoalControl(intake, origin.controls);
  const retained = previous?.intake_context as RequestIntake | undefined;
  if (intake?.policy.selected === 'unknown' && previous?.blueprint && retained?.policy.selected === 'small'
    && retained.session_id === intake.session_id && retained.user.id === intake.user.id) {
    intake = { ...intake, policy: { ...intake.policy, selected: 'small' } };
  }
  const sourceRefs: string[] = [];
  const sourceGaps: string[] = [];
  const nativeUsers = intake ? intake.user_messages ?? [intake.user] : [];
  const declared = options.requirementSources ?? previous?.requirement_sources as string[] | undefined
    ?? (origin ? origin.manifest.requirement_source_files?.length ? origin.manifest.requirement_source_files : [origin.reference + '#requirement'] : undefined);
  if (declared?.length) for (const source of declared) {
    const [sourcePath, ...fragment] = source.split('#');
    const file = realProjectPath(root, sourcePath, 'requirement source');
    const relative = path.relative(root, file).replace(/\\/g, '/') + (fragment.length ? '#' + fragment.join('#') : '');
    const generated = isInsideReport(reportDir, file) && path.basename(file).startsWith('user-');
    const nativeInput = generated ? nativeUsers.find(message => path.basename(file) === `user-${crypto.createHash('sha256').update(message.id + '\n' + message.text).digest('hex').slice(0, 24)}.txt`) : undefined;
    if (!options.readonly && nativeInput && !fs.existsSync(file)) { fs.mkdirSync(path.dirname(file), { recursive: true }); publish(file, nativeInput.text); }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { sourceGaps.push(`需求原始输入尚不可读：${relative}`); continue; }
    if (!options.readonly && nativeInput && fs.readFileSync(file, 'utf8') !== nativeInput.text) publish(file, nativeInput.text);
    if (generated && intake && !nativeUsers.some(message => fs.readFileSync(file, 'utf8') === message.text)) sourceGaps.push(`稳定原文与已核user不一致：${relative}`);
    else if (!generated && intake && !origin && !previous && !nativeUsers.some(user => user.text.replace(/\\/g, '/').includes(relative))) {
      sourceGaps.push(`需求文件未由本请求真实用户指向：${relative}`);
    }
    sourceRefs.push(relative);
  }
  // Preserve exact, immutable native input bytes; later user corrections add their own input,
  // whereas changing facts/targets never rewrites the requirement or hashes mutable request JSON.
  const inlineUsers = origin ? [] : sourceRefs.length ? nativeUsers.filter(message => message.id !== intake?.user.id) : nativeUsers;
  for (const message of inlineUsers) {
    const name = `user-${crypto.createHash('sha256').update(message.id + '\n' + message.text).digest('hex').slice(0, 24)}.txt`;
    const source = realProjectPath(root, path.relative(root, path.join(reportDir, name)), 'native user input');
    if (!options.readonly) { fs.mkdirSync(reportDir, { recursive: true }); if (!fs.existsSync(source) || fs.readFileSync(source, 'utf8') !== message.text) publish(source, message.text); }
    if (!fs.existsSync(source)) sourceGaps.push('稳定原文尚未准备；在同一check调用中准备来源后重验');
    else if (fs.readFileSync(source, 'utf8') !== message.text) sourceGaps.push('稳定原文被改变，应由同writer按真实user原件恢复');
    const relative = path.relative(root, source).replace(/\\/g, '/');
    if (!sourceRefs.includes(relative)) sourceRefs.push(relative);
  }
  if (sourceGaps.length) originGap = sourceGaps.join('；');
  if (!options.readonly) {
    fs.mkdirSync(reportDir, { recursive: true });
    const canonicalBlueprint = componentBlueprintPath(root, options.blueprintId);
    const designTarget = previous?.design_target ?? (!fs.existsSync(canonicalBlueprint) ? path.relative(root, canonicalBlueprint).replace(/\\/g, '/') : undefined);
    const raw = { schema_version: '1.0', phase: 'component-design', requested_result: origin?.manifest.requirement ?? intake?.user.text ?? '设计原请求来源未核',
      targets: { files: intake?.targets ?? options.targets ?? [], tests: [] }, baseline: previous?.baseline ?? { head: 'WORKTREE' },
      inputs: {}, allowed_test_writes: [], requirement_sources: sourceRefs, ...(designTarget ? { design_target: designTarget } : {}), ...(origin ? { origin_request: origin.reference } : {}),
      ...(intake ? { intake_context: intake } : { origin_gap: originGap ?? '原生用户来源未核' }), ...(previous?.blueprint ? { blueprint: previous.blueprint } : {}) };
    const old = fs.existsSync(requestFile) ? fs.readFileSync(requestFile) : undefined;
    try {
      publish(requestFile, JSON.stringify(raw, null, 2) + '\n');
      const { prepareRequestInput } = require('./capability-resolution-entry-input') as typeof import('./capability-resolution-entry-input');
      prepareRequestInput({ projectRoot: root, frameworkRoot: options.frameworkRoot, phase: 'component-design', requestFile: path.relative(root, requestFile), reportDir: path.relative(root, reportDir) });
    } catch (error) { if (old) fs.writeFileSync(requestFile, old); else if (fs.existsSync(requestFile)) fs.unlinkSync(requestFile); throw error; }
  } else if (!previous) originGap = originGap ?? '原component-design request尚不存在';
  return { requestFile, reportDir, intake, sourceRefs, currentScopeItems: prepareBlueprintSourceItems(root, sourceRefs, intake?.user.at ?? new Date().toISOString()), ...(originGap ? { originGap } : {}) };
}
function isInsideReport(root: string, file: string): boolean { const relative = path.relative(root, file); return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative); }

/** Publish only an actually validated blueprint identity into the existing design request. */
export class RequestDesignReviewRequired extends Error {}

export function bindDesignRequestBlueprint(options: { projectRoot: string; frameworkRoot: string; requestFile: string; blueprintId: string; acceptanceIds?: string[]; write?: DesignPreparationWrite }): PreparedRequest['blueprint'] {
  const prepared = prepareDesignRequest({ ...options, readonly: true });
  if (!prepared.intake || prepared.originGap) throw new Error(`blueprint binding source is unverified: ${prepared.originGap ?? 'native intake missing'}`);
  const { loadCanonicalBlueprint, resolveComponentBlueprintRef } = require('./component-blueprint-path') as typeof import('./component-blueprint-path');
  const { selectBlueprintRequestContent } = require('./blueprint-skill-projection') as typeof import('./blueprint-skill-projection');
  const loaded = loadCanonicalBlueprint(options.projectRoot, options.blueprintId);
  const blueprint = loaded.blueprint;
  const ref = { artifact: 'component-blueprint@1' as const, component_id: String(blueprint.component_id), blueprint_id: options.blueprintId,
    revision: Number(blueprint.revision), source_fingerprint: String(blueprint.source_fingerprint), artifact_sha256: loaded.artifactSha256,
    target: { kind: 'blueprint' as const, id: options.blueprintId } };
  resolveComponentBlueprintRef(options.projectRoot, ref, loaded, { requestIntake: prepared.intake, requestSourceItems: prepared.currentScopeItems });
  const content = selectBlueprintRequestContent(blueprint);
  const criteria = (content.acceptance?.criteria ?? []) as Array<{ id?: string }>;
  const available = criteria.map(criterion => criterion.id).filter((id): id is string => typeof id === 'string');
  const raw = JSON.parse(fs.readFileSync(prepared.requestFile, 'utf8'));
  const previous = raw.blueprint as PreparedRequest['blueprint'];
  const ids = options.acceptanceIds ?? previous?.acceptance_ids ?? available;
  if (!ids.length || ids.some(id => !available.includes(id))) throw new Error('blueprint request must bind actual acceptance IDs');
  const binding = { ref, acceptance_ids: [...new Set(ids)] };
  if (previous && JSON.stringify(previous) !== JSON.stringify(binding)) {
    const { prepareExplicitRequest, readRequestScriptConclusion } = require('./capability-resolution-entry-input') as typeof import('./capability-resolution-entry-input');
    try {
      const dir = path.join(prepared.reportDir, 'review');
      const review = prepareExplicitRequest({ ...options, phase: 'review',
        requestFile: path.relative(options.projectRoot, path.join(dir, 'request.json')), reportDir: path.relative(options.projectRoot, dir) });
      const conclusion = readRequestScriptConclusion(options.projectRoot, options.frameworkRoot, review);
      if (review.origin_request !== prepared.requestFile || JSON.stringify(review.blueprint) !== JSON.stringify(binding) || conclusion.summary.verdict !== 'PASS') {
        throw new Error('原 request 的 review 尚未通过当前蓝图、验收与契约');
      }
    } catch (error) { throw new RequestDesignReviewRequired(`先沿原设计 request 复核当前蓝图和原用户要求，再重签：${String(error)}`); }
  }
  (options.write ?? atomicText)(prepared.requestFile, JSON.stringify({ ...raw, blueprint: binding }, null, 2) + '\n');
  return binding;
}

/** Only the original request JSON persists intake; no entry ticket, Feature or external state. */
export function prepareAutomaticRequest(projectRoot: string, frameworkRoot: string, args: Record<string, unknown>, design?: { requestFile: string; blueprint?: PreparedRequest['blueprint']; sourceRefs: string[]; intake?: RequestIntake; requestedResult?: string; baseline?: RequestComparison }): { requestFile: string; reportDir: string } {
  if (!['review', 'ut', 'testing'].includes(String(args.phase))) throw new Error('automatic request supports review/ut/testing');
  const requestedInputs = {
    ...(typeof args.cases === 'string' ? { cases: args.cases } : {}),
    ...(args.phase === 'testing' && typeof args['test-plan'] === 'string' ? { test_plan: args['test-plan'] } : {}),
  };
  const targets = list(args.target);
  const location = resolveRequestSessionReference(typeof args['session-ref'] === 'string' ? args['session-ref'] : undefined, projectRoot);
  let intake: RequestIntake | undefined;
  let sourceGap = location.gap;
  if (location.sessionRef) try { intake = readRequestIntake({ projectRoot, frameworkRoot, sessionRef: location.sessionRef,
    explicitTargets: targets.length ? [...(design?.intake?.explicit_targets ?? []), ...targets] : design?.intake?.explicit_targets, previous: design?.intake }); }
  catch (error) { sourceGap = String(error); }
  if (!intake && design?.intake && !targets.length) intake = design.intake;
  if (!intake) {
    if (!targets.length && !list(args['test-target']).length) throw new Error('自动request需要原生 --session-ref 或局部显式 --target/--test-target；来源未核不能签完整通过');
    const phase = String(args.phase);
    const id = crypto.createHash('sha256').update(JSON.stringify([targets, list(args['test-target'])])).digest('hex').slice(0, 16);
    const reportDir = standaloneReportDir(projectRoot, frameworkRoot, typeof args['report-dir'] === 'string' ? args['report-dir'] : `doc/reports/request/local-${id}/${phase}`);
    fs.mkdirSync(reportDir, { recursive: true });
    const file = realProjectPath(projectRoot, path.relative(projectRoot, path.join(reportDir, 'request.json')), 'local request');
    const request = { schema_version: '1.0', phase, requested_result: '仅验证本次显式目标；原生用户来源、档位和完整diff归属未核',
      targets: { files: targets, tests: list(args['test-target']) }, baseline: { head: 'WORKTREE' },
      inputs: requestedInputs, allowed_test_writes: list(args['allow-test-write']),
      origin_gap: `${sourceGap ?? '客户端没有可消费的原生原件'}：结论仅覆盖显式局部目标` };
    if (fs.existsSync(file)) {
      const old = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!old.origin_gap || JSON.stringify(old.targets) !== JSON.stringify(request.targets)) throw new Error('报告目录不属于相同的局部显式目标');
    }
    const old = fs.existsSync(file) ? fs.readFileSync(file) : undefined;
    try {
      atomicJson(file, request);
      const { prepareExplicitRequest } = require('./capability-resolution-entry-input') as typeof import('./capability-resolution-entry-input');
      prepareExplicitRequest({ projectRoot, frameworkRoot, phase, requestFile: path.relative(projectRoot, file), reportDir: path.relative(projectRoot, reportDir) });
    } catch (error) { if (old) fs.writeFileSync(file, old); else if (fs.existsSync(file)) fs.unlinkSync(file); throw error; }
    return { requestFile: path.relative(projectRoot, file).replace(/\\/g, '/'), reportDir: path.relative(projectRoot, reportDir).replace(/\\/g, '/') };
  }
  const phase = String(args.phase);
  const reportDir = standaloneReportDir(projectRoot, frameworkRoot, typeof args['report-dir'] === 'string' ? args['report-dir'] : `doc/reports/request/${intakeIdentity(intake)}/${phase}`);
  const file = realProjectPath(projectRoot, path.relative(projectRoot, path.join(reportDir, 'request.json')), 'automatic request');
  let previous: Record<string, unknown> | undefined;
  if (fs.existsSync(file)) {
    previous = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!previous?.intake_context) throw new Error('自动request路径已有其它文件，不能覆盖');
    const retained = previous.intake_context as RequestIntake;
    if (design?.intake) {
      if (retained.session_id !== intake.session_id || retained.user.id !== intake.user.id) throw new Error('原request不属于本次定位的真实用户请求');
    } else intake = readRequestIntake({ projectRoot, frameworkRoot, sessionRef: intake.session_ref,
      explicitTargets: targets.length ? targets : undefined, previous: retained });
  }
  if (design?.intake) intake = { ...intake, control: design.intake.control, policy: design.intake.policy };
  // Preserve the persisted legacy carrier until a new stage result actually needs it to be rewritten.
  if (previous && design && !targets.length && !Object.keys(requestedInputs).length && !list(args['test-target']).length && !list(args['allow-test-write']).length
    && JSON.stringify(previous.blueprint) === JSON.stringify(design.blueprint)
    && previous.origin_request === path.relative(projectRoot, design.requestFile).replace(/\\/g, '/')) {
    return { requestFile: path.relative(projectRoot, file).replace(/\\/g, '/'), reportDir: path.relative(projectRoot, reportDir).replace(/\\/g, '/') };
  }
  if (intake.control.excluded.includes(phase)) throw new Error(`用户已明确排除${phase}，保留未执行，不以能力调用重加验证`);
  if (phase === 'testing' && intake.control.exempt) throw new Error('本请求已明确豁免 Maison，未执行设备测试');
  const normalize = (files: string[]) => files.map(file => path.relative(projectRoot, realProjectPath(projectRoot, file, 'test target')).replace(/\\/g, '/'));
  const originalTargets = previous?.targets as { tests?: string[] } | undefined;
  const requestedTests = list(args['test-target']);
  const allowed = normalize(list(args['allow-test-write']).length ? list(args['allow-test-write']) : (previous?.allowed_test_writes as string[] | undefined) ?? []);
  const tests = [...new Set(normalize(requestedTests.length ? requestedTests : originalTargets?.tests ?? []))];
  if (phase === 'ut' && !tests.length && allowed.length) {
    const profile = loadResolvedProfile(projectRoot, loadFrameworkConfig(projectRoot), frameworkRoot);
    const inferred = dispatchRequestTargetProbe(profile, phase, projectRoot, [], allowed, true);
    tests.push(...(inferred.caseFiles ?? allowed));
  }
  const testSet = new Set([...tests, ...allowed]);
  const request = {
    schema_version: '1.0', phase, requested_result: design?.requestedResult ?? intake.user.text,
    targets: { files: intake.targets.filter(file => !testSet.has(file)), tests },
    baseline: previous?.baseline ?? design?.baseline ?? { head: 'WORKTREE' },
    inputs: {
      ...(phase === 'testing' && design?.blueprint ? { test_plan: path.relative(projectRoot, path.join(reportDir, 'test-plan.hylyre.md')).replace(/\\/g, '/') } : {}),
      ...((previous?.inputs as Record<string, string> | undefined) ?? {}), ...requestedInputs,
    },
    allowed_test_writes: allowed,
    intake_context: intake,
    ...(design ? { origin_request: path.relative(projectRoot, design.requestFile).replace(/\\/g, '/'), blueprint: design.blueprint, requirement_sources: design.sourceRefs } : {}),
  };
  // Check path/write/baseline/carrier rules before publishing the derived request.
  const { prepareExplicitRequest } = require('./capability-resolution-entry-input') as typeof import('./capability-resolution-entry-input');
  fs.mkdirSync(reportDir, { recursive: true });
  const old = fs.existsSync(file) ? fs.readFileSync(file) : undefined;
  try {
    atomicJson(file, request);
    prepareExplicitRequest({ projectRoot, frameworkRoot, phase, requestFile: path.relative(projectRoot, file), reportDir: path.relative(projectRoot, reportDir), allowPlannedTargets: args['prepare-request'] === true });
  } catch (error) {
    if (old) fs.writeFileSync(file, old); else if (fs.existsSync(file)) fs.unlinkSync(file);
    throw error;
  }
  return { requestFile: path.relative(projectRoot, file).replace(/\\/g, '/'), reportDir: path.relative(projectRoot, reportDir).replace(/\\/g, '/') };
}

/** Reopen the verified original subject without writing a new request. */
export function readDesignVerificationRequest(projectRoot: string, frameworkRoot: string, requestFile: string, options?: { phase?: string; targets?: string[]; compile?: boolean }) {
  const file = realProjectPath(projectRoot, requestFile, 'design request');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (raw.phase !== 'component-design') throw new Error('original component-design request is required');
  const originalGoal = raw.origin_request ? readDesignGoalOrigin(projectRoot, raw.origin_request) : undefined;
  const blueprintId = raw.blueprint?.ref.blueprint_id ?? originalGoal?.manifest.feature ?? (options?.compile ? 'request-compile' : undefined);
  if (!blueprintId) throw new Error('original design request has no current design or original Goal');
  const source = prepareDesignRequest({ projectRoot, frameworkRoot, blueprintId, requestFile: path.relative(projectRoot, file), readonly: true, targets: options?.targets });
  if (options?.phase === 'testing' && source.intake?.control.excluded.includes('testing')) throw new Error('用户已明确排除testing，本次未执行');
  if (options?.phase === 'testing' && source.intake?.control.exempt) throw new Error('本请求已明确豁免 Maison，未执行设备测试');
  const { prepareRequestInput } = require('./capability-resolution-entry-input') as typeof import('./capability-resolution-entry-input');
  const prepared = prepareRequestInput({ projectRoot, frameworkRoot, phase: 'component-design', requestFile: path.relative(projectRoot, file),
    reportDir: path.relative(projectRoot, source.reportDir) });
  const nativeIntake = source.intake;
  if (!nativeIntake || source.originGap) {
    if (options?.compile) return { file, source, intake: nativeIntake, targets: prepared.targets.files, baseline: prepared.baseline, requestedResult: raw.requested_result as string };
    throw new Error(`original design source is not ready: ${source.originGap ?? 'missing native intake'}`);
  }
  if (!['small', 'trivial'].includes(nativeIntake.policy.selected)) throw new Error('non-small or existing CU work must continue through its original design/Goal responsibility');
  if (nativeIntake.policy.selected === 'small' && !raw.blueprint) throw new Error('small request must bind its actual current blueprint');
  const { resolveComponentBlueprintRef, loadCanonicalBlueprint } = require('./component-blueprint-path') as typeof import('./component-blueprint-path');
  const signed = nativeIntake.policy.selected === 'small' ? raw.blueprint as NonNullable<PreparedRequest['blueprint']> : undefined;
  let binding = signed;
  const loaded = signed && loadCanonicalBlueprint(projectRoot, signed.ref.blueprint_id);
  if (signed && loaded && options?.phase === 'review' && loaded.artifactSha256 !== signed.ref.artifact_sha256) {
    binding = { ...signed, ref: { ...signed.ref, revision: Number(loaded.blueprint.revision),
      source_fingerprint: String(loaded.blueprint.source_fingerprint), artifact_sha256: loaded.artifactSha256 } };
  }
  const resolved = binding && resolveComponentBlueprintRef(projectRoot, binding.ref, loaded || undefined, {
    requestIntake: nativeIntake, requestSourceItems: source.currentScopeItems,
  });
  const targets = [...new Set([...prepared.targets.files, ...nativeIntake.targets])].sort();
  return { file, source, intake: nativeIntake, binding, blueprint: resolved?.blueprint, targets, baseline: prepared.baseline, requestedResult: raw.requested_result as string };
}

/** Continue the original design request through the existing verification writer/provider. */
export function prepareDesignVerificationRequest(projectRoot: string, frameworkRoot: string, args: Record<string, unknown>): { requestFile: string; reportDir: string } {
  const phase = String(args.phase);
  const { file, source, intake, binding, requestedResult, baseline } = readDesignVerificationRequest(projectRoot, frameworkRoot, String(args['request-file']), { phase });
  if (!intake) throw new Error('原设计请求缺少已核实的用户来源');
  return prepareAutomaticRequest(projectRoot, frameworkRoot, { ...args,
    'session-ref': intake.session_ref, 'report-dir': typeof args['report-dir'] === 'string' ? args['report-dir'] : path.relative(projectRoot, path.join(source.reportDir, phase)) },
  { requestFile: file, blueprint: binding, sourceRefs: source.sourceRefs, intake, requestedResult, baseline });
}

/** Native author decisions plus current bytes actually read by the existing request parser. */
export function materializeAutomaticFacts(prepared: PreparedRequest, projectRoot: string, resolvedInputs?: import('./capability-resolution').ResolvedPhaseInputs): void {
  const intake = prepared.intake_context;
  if (!intake && !prepared.origin_gap) return;
  if (fs.existsSync(prepared.factsPath) && fs.readFileSync(prepared.factsPath, 'utf8').includes(`request_sha256: ${prepared.request_sha256}`)) return;
  const files = [...new Set([...prepared.bindings.filter(binding => binding.exists).map(binding => binding.path), ...Object.entries(prepared.inputs).filter(([id, file]) => id !== 'review_report' && fs.existsSync(file)).map(([, file]) => path.relative(projectRoot, file).replace(/\\/g, '/'))])];
  const parsedInputs = new Set(Object.values(resolvedInputs?.values ?? {}).flatMap(input =>
    input.state === 'resolved' ? input.binding.source_refs : []));
  const observed = files.filter(file => parsedInputs.has(file) || prepared.sourceContents.some(source => source.path === file));
  if (!observed.length) return;
  const record = { schema_version: '1.1', request_sha256: prepared.request_sha256, established_by: prepared.phase,
    ready_to_produce: files.every(file => observed.includes(file)), has_blocker_coverage_risk: false,
    source_code_paths: observed, key_inputs_read: observed, files_inspected_count: observed.length,
    searches_performed_estimate: observed.length, decisions_unlocked: intake ? Object.values(intake.facts).filter(fact => fact.value !== 'unknown').map(fact => fact.reason) : ['仅读取显式目标运行局部能力；原生用户来源未知'],
    exploration_mode: 'sequential', change_intent: 'read_only', estimated_loc_delta: 0, single_function_scope: false };
  fs.mkdirSync(path.dirname(prepared.factsPath), { recursive: true });
  fs.writeFileSync(prepared.factsPath, '---\n' + YAML.stringify(record) + '---\n## Code Facts\n| 路径 | 事实 | 影响 |\n|---|---|---|\n'
    + observed.map(file => `| ${file} | 原request parser已读取并绑定当前字节 | 机械读取不取代原作者带来源的语义调研 |`).join('\n') + '\n');
}
export function automaticRequestChecks(intake: RequestIntake | undefined, projectRoot: string, range?: RequestComparison) {
  if (!intake) return [];
  const comparison = compareRequestContent(projectRoot, range);
  const impacts = deriveContentImpact(projectRoot, intake, range, comparison);
  const complete = comparison.executed && !intake.gaps.length && !intake.source_results?.length && intake.policy.selected !== 'unknown';
  return [{ id: 'request_intake_reconciliation', category: 'structure' as const, severity: 'MINOR' as const,
    status: complete ? 'PASS' as const : 'WARN' as const,
    description: '原请求来源与内容影响提示',
    details: JSON.stringify({ policy: intake.policy, gaps: intake.gaps, attribution_unknown: intake.attribution_unknown,
      attribution_disclosures: intake.attribution_disclosures, native_result_diagnostics: intake.source_results,
      comparison_gap: comparison.error, candidate_paths: comparison.entries, examined_paths: intake.targets, content_impact: impacts }),
    structured: { intake_context: intake, content_impact: impacts },
  }];
}
