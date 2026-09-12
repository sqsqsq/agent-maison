// ============================================================================
// capability-resolution.ts — deterministic pre-check capability resolver
// ============================================================================

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { auditSchemaSupport, validateLiteSchema } from './lite-json-schema';
import { stableStringify } from './phase-evidence-manifest';
import { validateProjectRelativePath } from './project-relative-path';
import { SpecLoader } from './spec-loader';
import { loadWorkflowSpec } from '../../workflow-loader';
import { deriveBlueprintSkillInput } from './blueprint-skill-projection';
import { artifactReadCandidatePaths, catalogPath, featureFilePath, loadFrameworkConfig } from '../../config';
import type { CheckResult } from './types';
import { normalizeDeviceTestCases } from './device-test-case-kernel';
import {
  ASSURANCE_RANK,
  contractFingerprint,
  loadArtifactInventory,
  loadFeatureContracts,
  phaseContractIndex,
  type Assurance,
  type ContractCapability,
  type ContractInput,
  type ContractInputSource,
  type FeatureTrackName,
  type PhaseContract,
  type SkillContract,
} from './skill-contract';
import {
  collectIntentTextWithPhaseFallback,
  fidelityIntentSsotPath,
  loadFidelityIntentSsotState,
  resolveRequirementReferenceImages,
} from './fidelity-shared';
import { featureRelativePath } from './feature-identity';

export type InputResolutionState = 'resolved' | 'absent' | 'invalid' | 'not_applicable';
export type CapabilityResolutionState = 'resolved' | 'pruned' | 'blocked' | 'not_applicable';

export interface ResolutionDependency {
  /** Absolute path; missing candidates are deliberately retained for stale detection. */
  path: string;
  exists: boolean;
  sha256: string | null;
  role: 'applicability' | 'artifact' | 'derive';
}

export interface SourceAttempt {
  kind: 'artifact' | 'derive';
  source: string;
  state: InputResolutionState;
  dependencies: ResolutionDependency[];
  /** Contract-declared upstream phase that produces an artifact attempt, if any. */
  upstream_producer?: string;
  detail?: string;
}

export interface InputResolution {
  id: string;
  state: InputResolutionState;
  selected_source: string | null;
  selected_source_fingerprint: string | null;
  attempts: SourceAttempt[];
  binding?: InputBinding;
}

export interface InputBinding {
  input_id: string;
  source: ContractInputSource;
  dependencies: ResolutionDependency[];
  source_refs: string[];
  content_fingerprint: string;
}

export type ResolvedInput<T = unknown> =
  | { state: 'resolved'; value: T; binding: InputBinding }
  | { state: 'absent' | 'invalid'; attempts: SourceAttempt[]; detail: string };

/** P2/P6 supply verified invocation facts; this is not another persisted scope. */
export interface PhaseInputContext {
  schema_version: '1.1';
  subject: { feature: string } | { request_sha256: string };
  obligations: Record<string, 'required' | 'not_applicable' | 'unknown'>;
  required_outputs: string[];
  expected_bindings?: InputBinding[];
  invalidated_sources?: Record<string, string>;
}

export interface ResolvedPhaseInputs {
  context: PhaseInputContext;
  phase: string;
  values: Record<string, ResolvedInput>;
  artifacts: Record<string, unknown>;
}

export interface CapabilityResolution {
  id: string;
  axis: ContractCapability['axis'];
  active: boolean;
  state: CapabilityResolutionState;
  on_missing: ContractCapability['on_missing'];
  applicability_provider_id: string | null;
  applicability_dependencies: ResolutionDependency[];
  applicability_detail?: string;
  inputs: InputResolution[];
}

export interface CapabilityResolutionReport {
  schema_version: '1.0';
  phase: string;
  feature: string;
  track: FeatureTrackName;
  contract_fingerprint: string;
  capabilities: CapabilityResolution[];
  assurance: Assurance;
  /** Every actual source attempt through resolved/invalid termination. */
  source_attempt_dependencies: ResolutionDependency[];
}

export interface CapabilityResolutionOptions {
  frameworkRoot: string;
  projectRoot: string;
  feature?: string;
  phase: string;
  track: FeatureTrackName;
  /** Goal/entry input is normalized before resolution; resolver never asks interactively. */
  requirement?: string;
  /** plan c4e8a1f7 T2：需求来源列表（goal manifest 冻结值；derive.visual-reference 的
   * source 直接父目录扫描输入——同一共享发现集合，杜绝第二套分母）。 */
  requirementSourceFiles?: string[];
  adhocCases?: string;
  inputContext?: PhaseInputContext;
  /** Explicit bounded source targets from the normalized P6 request. */
  testTargets?: string[];
  /** Only populated by the explicit request parser, never copied from request JSON. */
  request?: import('./capability-resolution-entry-input').PreparedRequest;
}

interface ProviderResult {
  state: InputResolutionState;
  dependencies: ResolutionDependency[];
  detail?: string;
  value?: unknown;
  artifacts?: Record<string, unknown>;
}

interface ApplicabilityResult {
  applicable: boolean;
  invalid?: boolean;
  dependencies: ResolutionDependency[];
  detail?: string;
}

function sha256File(filePath: string): string | null {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  } catch {
    return null;
  }
}

function dependency(filePath: string, role: ResolutionDependency['role']): ResolutionDependency {
  const exists = fs.existsSync(filePath);
  return { path: path.resolve(filePath), exists, sha256: exists ? sha256File(filePath) : null, role };
}

function stableFingerprint(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function dedupeDependencies(entries: ResolutionDependency[]): ResolutionDependency[] {
  const byPath = new Map<string, ResolutionDependency>();
  for (const entry of entries) byPath.set(`${entry.role}:${entry.path}`, entry);
  return [...byPath.values()].sort((a, b) => `${a.role}:${a.path}`.localeCompare(`${b.role}:${b.path}`));
}

function resolveArtifact(
  frameworkRoot: string,
  projectRoot: string,
  feature: string | undefined,
  source: Extract<ContractInputSource, { kind: 'artifact' }>,
  modern = false,
  explicitPath?: string,
  subject?: PhaseInputContext['subject'],
): ProviderResult {
  const inventory = loadArtifactInventory(frameworkRoot);
  const registered = inventory.artifacts.find((artifact) => artifact.id === source.artifact);
  if (!registered) return { state: 'invalid', dependencies: [], detail: `unregistered artifact ${source.artifact}` };
  const candidates = explicitPath ? [explicitPath] : feature === undefined ? [] : registered.paths.flatMap((relativePath) => {
    const fromRegistry = artifactReadCandidatePaths(projectRoot, feature, relativePath);
    const direct = featureFilePath(projectRoot, feature, relativePath);
    return [...new Set([...fromRegistry, direct])];
  });
  const dependencies: ResolutionDependency[] = [];
  for (const candidate of candidates) {
    const dep = dependency(candidate, 'artifact');
    dependencies.push(dep);
    if (modern && dep.exists) break;
  }
  if (!modern) dependencies.splice(0, dependencies.length, ...dedupeDependencies(dependencies));
  const selected = dependencies.find((entry) => entry.exists);
  if (!selected) return { state: 'absent', dependencies, detail: `${source.artifact} missing` };
  if (selected.sha256 === null) {
    return { state: 'invalid', dependencies, detail: `${source.artifact} is not a readable file: ${selected.path}` };
  }
  if (modern) {
    try {
      const raw = fs.readFileSync(selected.path, 'utf8');
      let artifacts: Record<string, unknown> | undefined;
      let value = /\.ya?ml$|\.json$/i.test(selected.path) ? YAML.parse(raw) : raw;
      if (typeof value?.source === 'string' && /^derive\.blueprint-(acceptance|contracts):/.test(value.source)) {
        const sourceFeature = feature ?? (typeof value.feature === 'string' ? value.feature : undefined);
        if (sourceFeature === undefined) return { state: 'invalid', dependencies, detail: 'blueprint projection requires its explicit source subject' };
        const kind = value.source.startsWith('derive.blueprint-acceptance:') ? 'acceptance' : 'contracts';
        const projected = deriveBlueprintSkillInput(projectRoot, sourceFeature, frameworkRoot, kind);
        dependencies.push(...projected.dependencies);
        if (projected.state !== 'resolved' || stableStringify(value) !== stableStringify(projected.artifacts?.[source.artifact])) return { state: 'invalid', dependencies, detail: projected.detail ?? 'blueprint projection stale; return to design owner' };
        artifacts = projected.artifacts;
      }
      const schema = YAML.parse(fs.readFileSync(path.join(frameworkRoot, 'specs/artifact-schemas', registered.schema), 'utf8'));
      const supported = auditSchemaSupport(Object.fromEntries(Object.entries(schema).filter(([key]) => !key.startsWith('x-'))));
      if (supported.length) throw new Error(`unsupported artifact schema: ${JSON.stringify(supported)}`);
      const issues = validateLiteSchema(value, schema);
      if (issues.length || value === undefined || value === null || value === '') {
        return { state: 'invalid', dependencies, detail: JSON.stringify(issues.length ? issues : ['empty content']) };
      }
      if (['acceptance@1', 'contracts@1', 'use-cases@1'].includes(source.artifact)) {
        if (feature === undefined && !subject) throw new Error('request subject required');
        const resolved: ResolvedPhaseInputs = {
          context: { schema_version: '1.1', subject: subject ?? { feature: feature! }, obligations: {}, required_outputs: [] },
          phase: '', values: {}, artifacts: { [source.artifact]: value },
        };
        const loader = new SpecLoader(projectRoot, undefined, undefined, frameworkRoot);
        const parsed = feature === undefined ? loader.loadRequestArtifacts(resolved) : loader.loadFeatureSpec(feature, resolved);
        if (parsed.shape_issues?.length) return { state: 'invalid', dependencies, detail: parsed.shape_issues.join('; ') };
        value = source.artifact === 'acceptance@1' ? parsed.acceptance : source.artifact === 'contracts@1' ? parsed.contracts : parsed.useCases;
      }
      return { state: 'resolved', dependencies, value, artifacts, detail: selected.path };
    } catch (error) { return { state: 'invalid', dependencies, detail: String(error) }; }
  }
  return { state: 'resolved', dependencies, detail: selected.path };
}

function sourceTreeDependency(projectRoot: string): ResolutionDependency[] {
  // The configured module catalog is the stable, bounded input for source-target derivation.
  // A repository root directory is intentionally not hashed as a pseudo-source artifact.
  return [dependency(catalogPath(projectRoot), 'derive')];
}

function resolveDerive(
  projectRoot: string,
  feature: string | undefined,
  source: Extract<ContractInputSource, { kind: 'derive' }>,
  options: CapabilityResolutionOptions,
): ProviderResult {
  if (options.request && (source.provider_id === 'derive.codebase' || source.provider_id === 'derive.test-targets')) {
    const names = source.provider_id === 'derive.test-targets' ? options.request.targets.tests : options.request.targets.files;
    const value = options.request.sourceContents.filter(file => names.includes(file.path));
    const dependencies = options.request.baseline.head === 'WORKTREE' ? value.map(file => dependency(path.resolve(projectRoot, file.path), 'derive')) : [];
    return value.length ? { state: 'resolved', dependencies, value } : { state: 'absent', dependencies, detail: 'requested source targets absent' };
  }
  if (source.provider_id === 'derive.blueprint-acceptance' || source.provider_id === 'derive.blueprint-contracts') {
    if (feature === undefined) return { state: 'absent', dependencies: [], detail: 'request has no blueprint Feature' };
    return deriveBlueprintSkillInput(projectRoot, feature, options.frameworkRoot, source.provider_id === 'derive.blueprint-acceptance' ? 'acceptance' : 'contracts');
  }
  if (options.inputContext) {
    if (source.provider_id === 'derive.requirement') {
      return options.requirement?.trim()
        ? { state: 'resolved', dependencies: [], value: options.requirement.trim() }
        : { state: 'absent', dependencies: [], detail: 'explicit invocation requirement missing' };
    }
    if (source.provider_id === 'derive.test-targets' || source.provider_id === 'derive.codebase') {
      const targets = options.testTargets;
      if (!targets?.length) return { state: 'absent', dependencies: [], detail: 'explicit source targets missing' };
      let safeTargets: string[];
      try { safeTargets = targets.map(target => validateProjectRelativePath(projectRoot, target, 'source target')); }
      catch (error) { return { state: 'invalid', dependencies: [], detail: String(error) }; }
      const deps = safeTargets.map(target => dependency(path.resolve(projectRoot, target), 'derive'));
      const unreadable = deps.find(dep => dep.exists && !dep.sha256);
      if (unreadable) return { state: 'invalid', dependencies: deps, detail: 'source target unreadable: ' + unreadable.path };
      const missing = deps.find(dep => !dep.exists);
      if (missing) return { state: 'absent', dependencies: deps, detail: 'source target missing: ' + missing.path };
      return { state: 'resolved', dependencies: deps, value: targets.map((target, i) => ({ path: target, content: fs.readFileSync(deps[i].path, 'utf8') })) };
    }
    if (source.provider_id === 'derive.visual-reference' && !feature) {
      return { state: 'absent', dependencies: [], detail: 'request visual references require an explicit provider input' };
    }
    if (source.provider_id === 'derive.visual-reference' && !options.requirement?.trim()) return { state: 'absent', dependencies: [], detail: 'explicit visual requirement missing' };
  }
  if (source.provider_id === 'derive.adhoc-cases') {
      const deps: ResolutionDependency[] = [];
      const raw = options.adhocCases?.trim();
      if (!raw) {
        return { state: 'absent', dependencies: deps, detail: 'normalized adhoc cases unavailable' };
      }
      // The phase resolver and ad-hoc driver share one deterministic case boundary.
      // Never treat arbitrary non-empty text as an executable device-test input.
      const normalized = normalizeDeviceTestCases({ mode: 'adhoc', natural_language: raw });
      const onlyCase = normalized.cases[0];
      // Capability fallback accepts only a minimally actionable explicit adhoc input.
      // Keep this guard here: the shared kernel also serves the direct adhoc tool,
      // whose single TC-001/no-expected representation remains valid for that flow.
      if (
        normalized.cases.length === 0
        || (normalized.cases.length === 1 && onlyCase.steps.length < 2 && !onlyCase.expected.trim())
      ) {
        return {
          state: 'absent',
          dependencies: deps,
          detail: `adhoc_cases_insufficient:${stableFingerprint(normalized).slice(0, 16)}`,
        };
      }
      if (normalized.issues.length > 0) {
        return {
          state: 'invalid',
          dependencies: deps,
          detail: `adhoc_cases_invalid:${stableFingerprint(normalized).slice(0, 16)}`,
        };
      }
      return {
        state: 'resolved',
        dependencies: deps,
        value: normalized.cases,
        detail: `adhoc_cases:${stableFingerprint(normalized.cases).slice(0, 16)}`,
      };
    }
  if (feature === undefined) return { state: 'absent', dependencies: [], detail: 'derive source requires Feature context' };
  switch (source.provider_id) {
    case 'derive.codebase': {
      const deps = sourceTreeDependency(projectRoot);
      return fs.existsSync(projectRoot)
        ? { state: 'resolved', dependencies: deps, detail: 'project_root' }
        : { state: 'absent', dependencies: deps, detail: 'project root missing' };
    }
    case 'derive.requirement': {
      if (options.requirement?.trim()) {
        // Goal requirement is separately identity- and closure-bound by its canonical
        // manifest. Do not fingerprint an unrelated change.md fallback candidate.
        return {
          state: 'resolved',
          dependencies: [],
          detail: `goal_requirement:${stableFingerprint(options.requirement.trim()).slice(0, 16)}`,
        };
      }
      // plan c8e5b3f1 t1：阶段驱动路径——fidelity-intent SSOT 是本路径唯一权威需求来源。
      // SSOT 段判据：state==='valid' 且 requirement_provenance==='explicit_cli' 且
      // execution_identity 等于当前阶段身份（phase:<feature>:spec，不跨身份导入历史 goal 残留
      // 决策）。intent_fallback / 缺字段旧版 SSOT / corrupt / 跨身份一律**不解锁**，继续落
      // 到 change.md（legacy）。corrupt 按 absent 继续、不升 invalid、不抢 fidelity 门禁裁决权。
      // **只在 spec 阶段启用**（review P1）：lite 的 change 阶段也用 derive.requirement，但必须
      // 保持纯 change.md 分支零变化——否则创建 spec SSOT 会让语义未变的 change closure 被判 stale。
      const change = featureFilePath(projectRoot, feature, 'change.md');
      if (options.phase === 'spec') {
        const ssotState = loadFidelityIntentSsotState(projectRoot, feature);
        const ssot = ssotState.state === 'valid' ? ssotState.doc : null;
        const ssotPath = fidelityIntentSsotPath(projectRoot, feature);
        // 身份口径：reader 用 phase:<feature>:<options.phase>（唯一 writer 硬编码 phase:<feature>:spec）。
        // 目前仅 spec 生成显式匹配身份；若将来给其它 phase 加 derive.requirement，须先对齐 writer
        // 身份口径，勿在此静默扩匹配。
        const expectedIdentity = `phase:${feature}:${options.phase}`;
        if (
          ssot &&
          ssot.requirement_provenance === 'explicit_cli' &&
          ssot.execution_identity === expectedIdentity
        ) {
          // ④ 该段依赖**只绑 fidelity-intent.json 本身**（真实 path + sha256）——需求变更 → 重跑
          // Step 1 → initializer 重新签发 → 文件哈希变 → 旧 closure 经既有
          // capabilityResolutionEvidenceInputs → productionEvidence 链自然 stale。不记源文件路径、
          // 不存第二份 sha、不做实时验源。
          return {
            state: 'resolved',
            dependencies: [dependency(ssotPath, 'derive')],
            detail: `fidelity_intent_ssot:${ssotPath}`,
          };
        }
        // review P1：spec 的 fallback/absent 分支**无条件**绑定 SSOT 路径（missing/corrupt 也以
        // exists:false 记录，符合 openspec "freshness binds all actual attempts…absent paths with
        // exists:false"）——否则"先经 change.md 形成旧 closure，再签发 explicit_cli SSOT"时旧
        // closure 因从未记录 fidelity-intent.json 而永久 fresh。goal 分支（上方 options.requirement
        // 非空）仍返回空 deps，不含此处绑定。
        const deps = dedupeDependencies([
          dependency(ssotPath, 'derive'),
          dependency(change, 'derive'),
        ]);
        if (fs.existsSync(change)) {
          return { state: 'resolved', dependencies: deps, detail: change };
        }
        // ⑤ 失败话术：三段全 absent 时 detail 机器可读且可行动（列出已尝试三段与关键路径，给两条
        // 修复路径），不写"框架缺陷"。
        return {
          state: 'absent',
          dependencies: deps,
          detail:
            'requirement 来源缺失：已尝试 ① goal manifest ② fidelity-intent SSOT（explicit_cli+身份匹配）' +
            `（${ssotPath}）③ change.md（legacy）均无可解析需求。修复路径：goal 模式经 manifest 提供需求；` +
            '手动阶段驱动模式带需求文本重跑 Step 1：`fidelity-intent-init --feature ' +
            '<feature> --requirement "<需求文本>"`（或 `--requirement-file <path>`）。',
        };
      }
      // 非 spec（lite change 等）：保留既有纯 change.md 分支（逐元素零变化——SSOT 不加载、不匹配、
      // 不绑定，spec SSOT 的创建/变化不得影响 change closure 的新鲜度判定）。
      const deps = [dependency(change, 'derive')];
      return fs.existsSync(change)
        ? { state: 'resolved', dependencies: deps, detail: change }
        : { state: 'absent', dependencies: deps, detail: 'goal requirement/change.md missing' };
    }
    // plan f3a8c6d2 t5a（plan c4e8a1f7 T2 收口）：pixel_1to1 意图但一张参考图都取不到＝**输入缺失**，走既有
    // capability input unresolved 通道（readiness/next_action/assess/merged-report 四处投影
    // 自动获得），不另产 CheckResult、不另造 pregate。
    // 事故（bc-openCard）：需求把参考图指向不存在的 ux-reference/（实际十张图在别处），
    // spec 空手写 ui-spec → 下游判 evidence_gap → 按盲档跑两天。第一张多米诺就在这里。
    case 'derive.visual-reference': {
      const featuresDirRel =
        (loadFrameworkConfig(projectRoot).paths?.features_dir ?? 'doc/features').replace(/\\/g, '/');
      const intentText = collectIntentTextWithPhaseFallback(projectRoot, feature, featuresDirRel);
      // plan c4e8a1f7 T2（评审 P1 修复）：**当前 requirement 恒为优先输入**——普通 inline
      // goal 的 `options.requirement` 来自 entry input（当前 run manifest 冻结值），不再
      // 退回"全部历史 run requirement 聚合"（可能混入旧图片；宿主实锤混入形态）。
      // 仅当 options.requirement 缺失（如阶段驱动无显式需求）才 fallback 宽泛意图文本。
      const reqInput = options.requirement?.trim() ? options.requirement : intentText;
      // sources 解析（评审 P1 修复）：① entry input 显式携带（goal 路径）；② 为空时从
      // **身份匹配**的 fidelity-intent SSOT 读取（phase-driven 路径——fidelity-intent-init
      // 已写入 requirement_source_files，此处是"只写不读"断桥的读侧）；③ 都缺 → 空。
      let sources = options.requirementSourceFiles;
      if (!sources || sources.length === 0) {
        const ssotState = loadFidelityIntentSsotState(projectRoot, feature);
        const ssot = ssotState.state === 'valid' ? ssotState.doc : null;
        const expectedIdentity = `phase:${feature}:${options.phase}`;
        if (
          ssot &&
          ssot.requirement_provenance === 'explicit_cli' &&
          ssot.execution_identity === expectedIdentity &&
          ssot.requirement_source_files &&
          ssot.requirement_source_files.length > 0
        ) {
          sources = ssot.requirement_source_files;
        }
      }
      // 单一路径消费共享发现集合（正文显式 ∪ source 直接父目录一层；仅空集回退
      // ux-reference）——与 OCR 预扫/phase prompt/refs receipt 生产验证同一分母。
      const refs = resolveRequirementReferenceImages(projectRoot, feature, reqInput, {
        ...(sources && sources.length > 0 ? { requirementSourceFiles: sources } : {}),
      });
      // 依赖只绑**真实图片文件**（换图/删图 → 既有 stale 链自然重算）。不绑 ux-reference/
      // 目录本身：证据 manifest 的 hasher 只认 isFile()，目录会被永久记成 exists:false，
      // 图补齐后也不变——那是误导性诊断，不是新鲜度信号。缺图时 capability 直接 blocked、
      // 根本形不成 closure，无需靠依赖失效来恢复，故 absent 分支不记依赖（与
      // derive.requirement 的 goal 分支同形）。本项不加任何回升驱动器。
      if (refs.length > 0) {
        const deps = dedupeDependencies(
          refs.slice(0, 20).map((r) => dependency(path.isAbsolute(r) ? r : path.join(projectRoot, r), 'derive')),
        );
        return { state: 'resolved', dependencies: deps, value: refs, detail: `reference_images:${refs.length}` };
      }
      return {
        state: 'absent',
        dependencies: [],
        detail:
          'fidelity 意图为 pixel_1to1，但一张参考图都取不到——像素级比对没有基准，' +
          '继续跑只会产出无视觉证据的 ui-spec，随后被下游判 evidence_gap 并按盲档降级。' +
          `已查：需求文本中锚定 ${featuresDirRel}/${featureRelativePath(feature)} 的显式路径引用、以及回退目录 ` +
          `${featuresDirRel}/${featureRelativePath(feature)}/ux-reference/，均无图片文件。修复路径：` +
          '① 把参考图放到该 feature 的 ux-reference/ 下，或在需求文本里写明它们的真实目录' +
          '（发现器认需求中锚定 features_dir 的显式路径）；② 若本特性确实没有参考图，' +
          '把 fidelity 意图改为 semantic_layout/reference_only 后重新初始化 SSOT，' +
          '不要在无基准时声称 pixel_1to1。补齐后重跑 spec 阶段即恢复。',
      };
    }
    case 'derive.test-targets': {
      const deps = sourceTreeDependency(projectRoot);
      return deps.every((entry) => entry.exists)
        ? { state: 'resolved', dependencies: deps, detail: 'module catalog target derivation' }
        : { state: 'absent', dependencies: deps, detail: 'module catalog missing' };
    }

  }
}

/** Re-read a selected source using the same P1 parsers/providers and binding contract. */
export function readBoundInput(options: CapabilityResolutionOptions, binding: InputBinding): unknown {
  const result = binding.source.kind === 'derive' ? resolveDerive(options.projectRoot, options.feature, binding.source, options)
    : resolveArtifact(options.frameworkRoot, options.projectRoot, options.feature, binding.source, true, options.request?.inputs[binding.input_id], options.inputContext?.subject);
  const matches = (left: ResolutionDependency, right: ResolutionDependency): boolean => stableStringify(left) === stableStringify(right);
  if (result.state !== 'resolved' || result.value === undefined
    || binding.dependencies.some(dep => !matches(dep, dependency(dep.path, dep.role)))
    || result.dependencies.some(dep => !binding.dependencies.some(bound => matches(dep, bound)))
    || crypto.createHash('sha256').update(stableStringify(result.value)).digest('hex') !== binding.content_fingerprint) {
    throw new Error(`input binding stale; return to scope owner: ${result.detail ?? binding.input_id}`);
  }
  return result.value;
}

function resolveApplicability(
  capability: ContractCapability,
  options: CapabilityResolutionOptions,
): ApplicabilityResult {
  if (options.inputContext) {
    const states = (capability.obligation_kinds ?? []).map(kind => options.inputContext!.obligations[kind] ?? 'unknown');
    if (states.includes('unknown')) return { applicable: true, invalid: true, dependencies: [], detail: 'obligation applicability unknown: ' + capability.obligation_kinds?.filter((_, i) => states[i] === 'unknown').join(', ') };
    if (states.length) return { applicable: states.includes('required'), dependencies: [] };
    if (!capability.applicability_provider_id) return { applicable: true, dependencies: [] };
  }
  if (options.feature === undefined) return { applicable: false, dependencies: [], detail: 'request applicability is selected at the explicit entry' };
  if (!options.inputContext && !capability.tracks.includes(options.track)) return { applicable: false, dependencies: [], detail: 'track excluded' };
  const provider = capability.applicability_provider_id ?? 'applicability.always';
  if (provider === 'applicability.always') return { applicable: true, dependencies: [] };
  // plan f3a8c6d2 t5a：仅当 fidelity SSOT 已定档 pixel_1to1 时才要求参考图基准。
  // SSOT 未签发/未定档/非 pixel 一律 not_applicable——语义布局与仅参考档本就不需要像素基准，
  // 也不得让"SSOT 还没建"退化成阻塞（那会打破既有"零询问自动定档"）。
  if (provider === 'applicability.pixel_fidelity') {
    const ssotPath = fidelityIntentSsotPath(options.projectRoot, options.feature);
    const dependencies = [dependency(ssotPath, 'applicability')];
    const state = loadFidelityIntentSsotState(options.projectRoot, options.feature);
    if (state.state !== 'valid') {
      return { applicable: false, dependencies, detail: `fidelity ssot ${state.state}` };
    }
    return state.doc.selected_fidelity === 'pixel_1to1'
      ? { applicable: true, dependencies, detail: 'selected_fidelity=pixel_1to1' }
      : { applicable: false, dependencies, detail: `selected_fidelity=${state.doc.selected_fidelity}` };
  }
  // UI is independently decided before any capability input. A missing spec is unknown,
  // therefore still applicable and later pruned by its declared input; explicit non-UI
  // metadata is the only NOT_APPLICABLE route.
  const candidates = artifactReadCandidatePaths(options.projectRoot, options.feature, 'spec.md');
  const dependencies = dedupeDependencies(candidates.map((candidate) => dependency(candidate, 'applicability')));
  const selected = dependencies.find((entry) => entry.exists);
  if (!selected) return { applicable: true, dependencies, detail: 'ui applicability unknown' };
  let text: string;
  try {
    text = fs.readFileSync(selected.path, 'utf8');
  } catch (error) {
    return {
      applicable: true,
      invalid: true,
      dependencies,
      detail: `ui applicability input unreadable: ${(error as Error).message}`,
    };
  }
  if (/\bui_change\s*:\s*false\b/i.test(text) || /\bui[_ -]?change\s*[:：]\s*否/i.test(text)) {
    return { applicable: false, dependencies, detail: 'explicit non-ui requirement' };
  }
  return { applicable: true, dependencies, detail: 'ui requirement or unknown' };
}

function resolveInput(
  input: ContractInput,
  options: CapabilityResolutionOptions,
  artifactProducers: ReadonlyMap<string, string>,
  resolved?: ResolvedPhaseInputs,
): InputResolution {
  const attempts: SourceAttempt[] = [];
  for (const source of input.sources) {
    const sourceId = source.kind === 'artifact' ? source.artifact : source.provider_id;
    const invalidation = options.inputContext?.invalidated_sources?.[sourceId];
    let result: ProviderResult = invalidation ? { state: 'invalid', dependencies: [], detail: invalidation }
      : source.kind === 'artifact'
        ? !options.feature && resolved && !options.request?.inputs[input.id] ? { state: 'absent', dependencies: [], detail: 'request has no Feature artifact' }
          : resolveArtifact(options.frameworkRoot, options.projectRoot, options.feature, source, !!resolved, options.request?.inputs[input.id], options.inputContext?.subject)
        : resolveDerive(options.projectRoot, options.feature, source, options);
    if (resolved && result.state === 'resolved' && result.value === undefined) {
      result = { ...result, state: 'invalid', detail: 'provider returned no consumable content' };
    }
    const attempt: SourceAttempt = {
      kind: source.kind,
      source: source.kind === 'artifact' ? source.artifact : source.provider_id,
      state: result.state,
      dependencies: result.dependencies,
      ...(source.kind === 'artifact' && artifactProducers.has(source.artifact)
        ? { upstream_producer: artifactProducers.get(source.artifact)! }
        : {}),
      ...(result.detail ? { detail: result.detail } : {}),
    };
    attempts.push(attempt);
    let binding: InputBinding | undefined;
    if (result.state === 'resolved' && resolved) {
      binding = { input_id: input.id, source, dependencies: dedupeDependencies(attempts.flatMap(attempt => attempt.dependencies)),
        source_refs: result.dependencies.filter(d => d.exists).map(d => path.relative(options.projectRoot, d.path).replace(/\\/g, '/')),
        content_fingerprint: crypto.createHash('sha256').update(stableStringify(result.value)).digest('hex') };
      const expected = options.inputContext?.expected_bindings?.find(b => b.input_id === input.id);
      if (expected && stableStringify(expected) !== stableStringify(binding)) {
        result = { ...result, state: 'invalid', detail: 'input binding stale; return to scope owner' };
        attempt.state = 'invalid'; attempt.detail = result.detail;
      } else {
        resolved.values[input.id] = { state: 'resolved', value: result.value, binding };
        if (source.kind === 'artifact') resolved.artifacts[source.artifact] = result.value;
        if (source.kind === 'derive' && source.provider_id.startsWith('derive.blueprint-')) {
          const artifact = source.provider_id === 'derive.blueprint-acceptance' ? 'acceptance@1' : 'contracts@1';
          resolved.artifacts[artifact] = result.value;
        }
        if (result.artifacts?.['use-cases@1']) resolved.artifacts['use-cases@1'] = result.artifacts['use-cases@1'];
      }
    }
    if (result.state === 'resolved') {
      return {
        id: input.id,
        state: 'resolved',
        selected_source: attempt.source,
        selected_source_fingerprint: binding?.content_fingerprint ?? stableFingerprint(attempt),
        ...(binding ? { binding } : {}),
        attempts,
      };
    }
    if (result.state === 'invalid' || result.state === 'not_applicable') {
      if (resolved) resolved.values[input.id] = { state: 'invalid', attempts, detail: result.detail ?? 'invalid input' };
      return { id: input.id, state: result.state, selected_source: null, selected_source_fingerprint: null, attempts };
    }
  }
  if (resolved && options.inputContext?.expected_bindings?.some(binding => binding.input_id === input.id)) {
    const detail = 'input binding stale: previously bound input is absent';
    if (attempts.length) attempts[attempts.length - 1].detail = detail;
    resolved.values[input.id] = { state: 'invalid', attempts, detail };
    return { id: input.id, state: 'invalid', selected_source: null, selected_source_fingerprint: null, attempts };
  }
  if (resolved) resolved.values[input.id] = { state: 'absent', attempts, detail: attempts.at(-1)?.detail ?? 'missing input' };
  return { id: input.id, state: 'absent', selected_source: null, selected_source_fingerprint: null, attempts };
}

function resolveCapability(
  capability: ContractCapability,
  phase: PhaseContract,
  options: CapabilityResolutionOptions,
  artifactProducers: ReadonlyMap<string, string>,
  resolve: (input: ContractInput) => InputResolution,
): CapabilityResolution {
  const applicability = resolveApplicability(capability, options);
  if (applicability.invalid) {
    return {
      id: capability.id,
      axis: capability.axis,
      active: true,
      state: 'blocked',
      on_missing: capability.on_missing,
      applicability_provider_id: capability.applicability_provider_id ?? 'applicability.always',
      applicability_dependencies: applicability.dependencies,
      ...(options.inputContext && applicability.detail ? { applicability_detail: applicability.detail } : {}),
      inputs: [],
    };
  }
  if (!applicability.applicable) {
    return {
      id: capability.id,
      axis: capability.axis,
      active: false,
      state: 'not_applicable',
      on_missing: capability.on_missing,
      applicability_provider_id: capability.applicability_provider_id ?? 'applicability.always',
      applicability_dependencies: applicability.dependencies,
      ...(options.inputContext && applicability.detail ? { applicability_detail: applicability.detail } : {}),
      inputs: [],
    };
  }
  const byId = new Map(phase.inputs.map((input) => [input.id, input]));
  const inputs = capability.inputs.map((inputId) => resolve(byId.get(inputId)!));
  const hasInvalid = inputs.some((input) => input.state === 'invalid' || input.state === 'not_applicable');
  const hasAbsent = inputs.some((input) => input.state === 'absent');
  const state: CapabilityResolutionState = hasInvalid
    ? 'blocked'
    : hasAbsent
      ? capability.on_missing === 'fail' || (options.inputContext && capability.obligation_kinds?.some(kind => options.inputContext!.obligations[kind] === 'required')) ? 'blocked' : 'pruned'
      : 'resolved';
  return {
    id: capability.id,
    axis: capability.axis,
    active: true,
    state,
    on_missing: capability.on_missing,
    applicability_provider_id: capability.applicability_provider_id ?? 'applicability.always',
    applicability_dependencies: applicability.dependencies,
    inputs,
  };
}

function artifactProducerMap(contracts: readonly SkillContract[]): Map<string, string> {
  const producers = new Map<string, string>();
  for (const contract of contracts) {
    for (const [phase, declaration] of Object.entries(contract.phases)) {
      for (const output of declaration.produces) {
        if (typeof output.artifact !== 'string') continue;
        // The static consistency gate proves that a consumer has a reachable producer.
        // Keep its phase pointer here so assess can target the smallest upstream repair.
        if (!producers.has(output.artifact)) producers.set(output.artifact, phase);
      }
    }
  }
  return producers;
}
/**
 * Resolve exactly once before checker execution. The report is immutable input to all
 * later projections; runtime build/install/run outcomes intentionally do not enter it.
 */
export function resolveCapabilityReport(options: CapabilityResolutionOptions): CapabilityResolutionReport {
  return resolveCapabilityInputs(options).report;
}

/** P6 selects explicit inputs from the existing phase catalog; P4/P5 own professional applicability. */
export function resolveRequestInputs(projectRoot: string, frameworkRoot: string, request: import('./capability-resolution-entry-input').PreparedRequest): ResolvedPhaseInputs {
  const phase = phaseContractIndex(loadFeatureContracts(frameworkRoot)).get(request.phase)!.phase;
  const inputContext: PhaseInputContext = { schema_version: '1.1', subject: { request_sha256: request.request_sha256 }, obligations: {}, required_outputs: [] };
  const resolved: ResolvedPhaseInputs = { phase: request.phase, context: inputContext, values: {}, artifacts: {} };
  const selected = phase.inputs.filter(input => request.inputs[input.id] !== undefined
    || (request.targets.files.length > 0 && input.sources.some(source => source.kind === 'derive' && source.provider_id === 'derive.codebase'))
    || (request.targets.tests.length > 0 && input.sources.some(source => source.kind === 'derive' && source.provider_id === 'derive.test-targets')));
  if (request.phase === 'review') selected.push({ id: 'review_report', sources: [{ kind: 'artifact', artifact: 'review-report@1' }] });
  for (const item of selected) {
    let input = item;
    let adhocCases: string | undefined;
    if (request.phase === 'testing' && item.id === 'cases') {
      input = { ...item, sources: item.sources.filter(source => source.kind === 'derive' && source.provider_id === 'derive.adhoc-cases') };
      if (request.inputs.cases && fs.existsSync(request.inputs.cases)) adhocCases = fs.readFileSync(request.inputs.cases, 'utf8');
    }
    resolveInput(input, { projectRoot, frameworkRoot, phase: request.phase, track: 'full', inputContext, request, requirement: request.requested_result, adhocCases }, new Map(), resolved);
    if (adhocCases && resolved.values[item.id]?.state === 'resolved') {
      const value = resolved.values[item.id];
      if (value.state === 'resolved') {
        value.binding.dependencies.push(dependency(request.inputs.cases, 'artifact'));
        value.binding.source_refs.push(path.relative(projectRoot, request.inputs.cases).replace(/\\/g, '/'));
      }
    }
  }
  return resolved;
}

export function resolveCapabilityInputs(options: CapabilityResolutionOptions): { report: CapabilityResolutionReport; inputs?: ResolvedPhaseInputs } {
  if (options.feature === undefined) throw new Error('use resolveRequestInputs for a request subject');
  const contracts = loadFeatureContracts(options.frameworkRoot);
  const indexed = phaseContractIndex(contracts).get(options.phase);
  if (!indexed) throw new Error(`[capability-resolution] phase 无 contract：${options.phase}`);
  // P3 migrates design contracts before P7 switches the default workflow. Legacy
  // workflow callers retain the old untyped execution path; scoped calls still
  // require their explicit P1 invocation and cannot fall back here.
  const legacyDesign = !options.inputContext && ['spec', 'plan'].includes(options.phase)
    && indexed.contract.schema_version === '1.1'
    && loadWorkflowSpec(options.frameworkRoot, loadFrameworkConfig(options.projectRoot).active_workflow ?? 'spec-driven').schema_version !== '1.2';
  if (!legacyDesign && (indexed.contract.schema_version === '1.1') !== !!options.inputContext) {
    throw new Error('[capability-resolution] contract/invocation schema mismatch');
  }
  const inputs: ResolvedPhaseInputs | undefined = options.inputContext
    ? { context: structuredClone(options.inputContext), phase: options.phase, values: {}, artifacts: {} } : undefined;
  if (inputs) {
    const subject = inputs.context.subject;
    if (('feature' in subject ? subject.feature !== options.feature : !!options.feature || !/^[0-9a-f]{64}$/.test(subject.request_sha256))) {
      throw new Error('[capability-resolution] invocation subject mismatch');
    }
  }
  const artifactProducers = artifactProducerMap(contracts);
  const cache = new Map<string, InputResolution>();
  const resolve = (input: ContractInput): InputResolution => {
    if (!cache.has(input.id)) cache.set(input.id, resolveInput(input, options, artifactProducers, inputs));
    return cache.get(input.id)!;
  };
  const capabilities = indexed.phase.capabilities.filter(capability => !legacyDesign || !['capability_plan_existing_design', 'capability_spec_existing_acceptance'].includes(capability.id)).map((capability) =>
    resolveCapability(legacyDesign ? { ...capability, tracks: ['full'] } : capability, indexed.phase, options, artifactProducers, resolve));
  if (inputs && options.feature) {
    const inventory = loadArtifactInventory(options.frameworkRoot);
    for (const name of inputs.context.required_outputs) {
      const output = inventory.artifacts.find(entry => entry.paths.includes(name));
      if (!output || !indexed.phase.produces.some(p => p.artifact === output.id)) {
        throw new Error(`undeclared phase output: ${name}`);
      }
    }
  }
  const sourceAttemptDependencies = dedupeDependencies(capabilities.flatMap((capability) => [
    ...capability.applicability_dependencies,
    ...capability.inputs.flatMap((input) => input.attempts.flatMap((attempt) => attempt.dependencies)),
  ]));
  const assurance: Assurance = capabilities.some((capability) => capability.state === 'blocked')
    ? 'blocked'
    : capabilities.some((capability) => capability.state === 'pruned')
      ? 'degraded'
      : 'full';
  const report: CapabilityResolutionReport = {
    schema_version: '1.0',
    phase: options.phase,
    feature: options.feature,
    track: options.track,
    contract_fingerprint: contractFingerprint(indexed.contract),
    capabilities,
    assurance,
    source_attempt_dependencies: sourceAttemptDependencies,
  };
  if (inputs) {
    const freeze = (value: unknown): void => {
      if (!value || typeof value !== 'object' || Object.isFrozen(value)) return;
      for (const child of Object.values(value)) freeze(child);
      Object.freeze(value);
    };
    freeze(report);
    freeze(inputs);
  }
  return { report, inputs };
}

/**
 * Materialize the immutable pre-check report as the capability-owned CheckResult
 * entries. These are protocol checks, not checker-local input-policy mirrors: a
 * non-resolved capability deliberately emits no check and is projected by the
 * report adapter instead.
 */
export function capabilityResolutionChecks(report: CapabilityResolutionReport): CheckResult[] {
  return report.capabilities
    .filter((capability) => capability.active && capability.state === 'resolved')
    .map((capability): CheckResult => ({
      id: capability.id,
      category: 'structure',
      description: `capability input contract resolved (${capability.id})`,
      severity: 'MINOR',
      status: 'PASS',
      details: `axis=${capability.axis}; all declared pre-check inputs resolved`,
      source: 'capability-resolution.ts',
    }));
}
export function assertCapabilityConsumption(
  report: CapabilityResolutionReport,
  checks: readonly CheckResult[],
): void {
  const byCapabilityId = new Map(report.capabilities.map((capability) => [capability.id, capability]));
  for (const capability of report.capabilities) {
    const matching = checks.filter((check) => check.id === capability.id);
    const expected = capability.active && capability.state === 'resolved' ? 1 : 0;
    if (matching.length !== expected) {
      throw new Error(
        `[capability-resolution] capability=${capability.id} state=${capability.state} expected CheckResult=${expected}, actual=${matching.length}`,
      );
    }
  }
  for (const check of checks) {
    const capability = byCapabilityId.get(check.id);
    if (!capability) continue;
    if (!capability.active || capability.state !== 'resolved') {
      throw new Error(`[capability-resolution] non-resolved capability ${check.id} 不得生成 CheckResult`);
    }
  }
}

export function capabilityResolutionExtraInputs(report: CapabilityResolutionReport): string[] {
  return report.source_attempt_dependencies.map((dependency) => dependency.path);
}

export function capabilityResolutionAssurance(report: CapabilityResolutionReport): Assurance {
  // Keep the comparison table live and make accidental enum additions fail visibly.
  if (!(report.assurance in ASSURANCE_RANK)) throw new Error(`[capability-resolution] 非法 assurance ${report.assurance}`);
  return report.assurance;
}

// ============================================================================
// plan c8e5b3f1 t2：blocked capability 可诊断投影的数据源（pre-check fact，不产 CheckResult）
// ============================================================================

/** 单个 blocked capability 面向诊断的确定性事实（readiness signal / merged-report / assess 共用）。 */
export interface BlockedCapabilityFact {
  capability: string;
  axis: ContractCapability['axis'];
  /** applicability invalid 导致的 blocked（无普通 input attempt）时非空，供诊断不静默漏项 */
  applicability_provider: string | null;
  applicability_dependencies: ResolutionDependency[];
  /** 未解析（absent/invalid/not_applicable）的 input attempt 明细，按 input id + source 稳定排序 */
  unresolved: Array<{
    input: string;
    source: string;
    detail?: string;
    upstream_producer?: string;
    dependencies: ResolutionDependency[];
  }>;
}

/**
 * 从报告确定性提取 active ∧ blocked 的能力事实（t2 投影的唯一数据源，跨 readiness/merged-report
 * 复用）。**不**含 requirement 专属修复话术——那些只存在于 derive.requirement 自己的 attempt.detail
 * 里，由消费方原样转述，防止通用投影夹带专属建议。applicability invalid 的 blocked（inputs 为空）
 * 仍产出 fact，只展示 capability/applicability provider/dependency，不整项静默漏掉。
 */
export function collectBlockedCapabilityFacts(
  report: Pick<CapabilityResolutionReport, 'capabilities'>,
): BlockedCapabilityFact[] {
  const facts: BlockedCapabilityFact[] = [];
  for (const capability of report.capabilities) {
    if (!capability.active || capability.state !== 'blocked') continue;
    const unresolved: BlockedCapabilityFact['unresolved'] = [];
    // defensive：宽松输入（assess 的 capabilityEntries）可能缺 inputs——按空处理，不 TypeError。
    const inputs = Array.isArray(capability.inputs) ? capability.inputs : [];
    for (const input of inputs) {
      const attempts = Array.isArray(input.attempts) ? input.attempts : [];
      for (const attempt of attempts) {
        if (!attempt || typeof attempt !== 'object') continue;
        if (attempt.state !== 'absent' && attempt.state !== 'invalid' && attempt.state !== 'not_applicable') continue;
        unresolved.push({
          input: input.id,
          source: attempt.source,
          ...(attempt.detail ? { detail: attempt.detail } : {}),
          ...(attempt.upstream_producer ? { upstream_producer: attempt.upstream_producer } : {}),
          dependencies: Array.isArray(attempt.dependencies) ? attempt.dependencies : [],
        });
      }
    }
    unresolved.sort((a, b) => `${a.input}|${a.source}`.localeCompare(`${b.input}|${b.source}`));
    facts.push({
      capability: capability.id,
      axis: capability.axis,
      applicability_provider: capability.applicability_provider_id ?? null,
      applicability_dependencies: Array.isArray(capability.applicability_dependencies) ? capability.applicability_dependencies : [],
      unresolved,
    });
  }
  facts.sort((a, b) => a.capability.localeCompare(b.capability));
  return facts;
}
