import { createIdentityNeutralDigestReaders, type IdentityNeutralDigestReaders } from './identity-neutral-digest';
// ============================================================================
// phase-evidence-manifest.ts — 阶段 closure 证据快照（goal-fakepass-hardening t8）
// ============================================================================
// 事故背景（bc-openCard，memory bc-opencard-fakepass-postmortem）：截断链 run 以
// manifest.requirement 文本断言"上游已 PASS"，无任何机器可核验的阶段输入/产出血缘——
// spec closure 后改需求/acceptance 再跑下游，completion 只知道"现在是 B"，证明不了
// "spec 审过 B"。
//
// 本模块为每个 phase closure 生成 phase-evidence-manifest.json：
//   - inputs：该阶段门禁真实读取面（SSOT=spec-loader 的 REQUIRED/OPTIONAL 两表，
//     禁止在此另立手写表——rev4 手写表与 loader 实际读取面不一致的教训）+ 调用方
//     追加的运行时输入（requirement SSOT / 解引用文档 / ux-reference 清单等）；
//   - outputs：该阶段自己产出/认证的 artifact（本模块唯一的增量表，语义=产出，
//     loader 表没有这一概念）；
//   - environment：gate 指纹 / framework.config 哈希 / 激活 workflow 哈希；
//   - receipt_sha256：旧格式兼容字段，新 writer 写 null，旧值仍参与原 aggregate。
//
// 闭环由 finalizer 先准备 staged summary，再生成绑定其字节的 manifest，最后发布 summary。
// 回执是提交后的人读投影，不参与 freshness；回执与 manifest 自身不得进入证据集合。
//
// 主要消费点（不做常驻失效 DAG）：
//   - goal-runner 截断链 preflight：上游各阶段 recompute → STALE 即拒启；
//   - verify-feature-completion：全链 recompute → 任一 STALE/missing 即非 VALID。
// ============================================================================

import * as crypto from 'crypto';
import * as fs from 'fs';
import { resolveFactsAbsPath, isFactsEstablishingPhase, factsPhaseFingerprint } from './context-facts';
import { isInsideProjectRoot } from './project-relative-path';
import * as path from 'path';
import * as YAML from 'yaml';

import {
  artifactReadCandidatePaths,
  featurePhaseReportsDir,
  loadFrameworkConfig,
  receiptDirPath,
  resolveFeatureArtifact,
  featureFilePath,
  type FeaturePathOptions,
} from '../../config';
import { inferRepoLayout } from '../../repo-layout';
import { computeGateFingerprint } from './gate-fingerprint';
import {
  collectRequirementSsotPaths, computeRequirementShaFromText, listAuthoritativeGoalRuns, resolveCurrentRequirementSource,
} from './fidelity-shared';
import {
  REQUIRED_FEATURE_FILES_BY_PHASE,
  OPTIONAL_FEATURE_FILES_BY_PHASE,
} from './spec-loader';
import type { Phase } from './types';

export const PHASE_EVIDENCE_MANIFEST_FILENAME = 'phase-evidence-manifest.json';
export const PHASE_EVIDENCE_MANIFEST_SCHEMA_VERSION = '1.0';

export type EvidenceRole = 'input' | 'output' | 'both';

export interface EvidenceEntry {
  /** 项目根相对 POSIX 路径 */
  path: string;
  role: EvidenceRole;
  /** 文件不存在时为 null（诚实记录，不伪造） */
  sha256: string | null;
  exists: boolean;
  /** Only new facts entries use a phase projection; legacy entries retain byte hashes. */
  facts_phase?: string;
  /** Phase authorized by the frozen execution scope to advance this source path. */
  owner_phase?: string;
  /** plan c4e7a9b2 B2（沿 facts_phase 先例）：登记路径条目的 sha256 是身份中立摘要，不是字节哈希。 */
  identity_neutral?: typeof IDENTITY_NEUTRAL_EVIDENCE;
}

export const IDENTITY_NEUTRAL_EVIDENCE = 'ref-content@1';

/**
 * CU 派生 Feature 的登记路径 → 身份中立摘要（`identityNeutralDigest`）；undefined = 非登记路径（字节口径），
 * null = 登记路径但算不出（不能证明等价）。登记：canonical CU、Feature 目录的三份派生投影文件、CU 所属蓝图——
 * 蓝图条目在本 Feature 里只代表「本 CU 消费的权威内容」，摘要取 CU 中立视图（已展开全部消费目标，所有权引用不展开）。
 */
function identityNeutralEvidenceDigest(projectRoot: string, feature: string, absPath: string, authorityReaders?: IdentityNeutralDigestReaders): string | null | undefined {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { tryParseCuFeatureId } = require('./feature-identity') as typeof import('./feature-identity');
  const identity = tryParseCuFeatureId(feature);
  if (!identity) return undefined;
  const { identityNeutralDigest } = require('./change-unit-design-preparation') as typeof import('./change-unit-design-preparation');
  const { changeUnitPath } = require('./change-unit-path') as typeof import('./change-unit-path');
  const { componentBlueprintPath } = require('./component-blueprint-path') as typeof import('./component-blueprint-path');
  const { BLUEPRINT_PROJECTION_FILES } = require('./blueprint-skill-projection') as typeof import('./blueprint-skill-projection');
  /* eslint-enable @typescript-eslint/no-require-imports */
  authorityReaders ??= createIdentityNeutralDigestReaders();
  const target = path.resolve(absPath);
  const digestOf = (artifact: string, file: string): string | null => {
    try { return identityNeutralDigest(projectRoot, artifact, artifact === 'change-unit@1' && authorityReaders?.loadChangeUnit
      ? authorityReaders.loadChangeUnit(projectRoot, identity.blueprintId, identity.changeUnitId).changeUnit
      : authorityReaders?.readArtifact ? authorityReaders.readArtifact(file) : YAML.parse(fs.readFileSync(file, 'utf8')), authorityReaders); } catch { return null; }
  };
  const cuFile = changeUnitPath(projectRoot, identity.blueprintId, identity.changeUnitId);
  if (target === path.resolve(cuFile) || target === path.resolve(componentBlueprintPath(projectRoot, identity.blueprintId))) return digestOf('change-unit@1', cuFile);
  for (const [artifact, name] of Object.entries(BLUEPRINT_PROJECTION_FILES)) {
    if (target === path.resolve(resolveFeatureArtifact(projectRoot, feature, name).actualPath)) return digestOf(artifact, target);
  }
  return undefined;
}

export interface EvidenceEnvironment {
  /** framework package.json version（openspec 明确要求的独立字段）；不可得时 null */
  framework_version: string | null;
  /** project_profile.name（framework.config.json）；不可得时 null */
  profile: string | null;
  /** computeGateFingerprint 输出（framework 版本+门禁集内容指纹）；不可得时 null */
  gate_fingerprint: string | null;
  /** framework.config.json 内容哈希；文件缺失为 null */
  framework_config_sha256: string | null;
  /** 激活 workflow YAML 内容哈希；不可得时 null */
  workflow_sha256: string | null;
  /** codex 八轮 P0-2：闭环时"当前权威 run 的规范化 requirement 内容哈希"——recompute
   * 比对当前权威 requirement，抓"新 run 换需求但复用旧 closure"。不可得时 null。 */
  requirement_sha256: string | null;
}

export interface PhaseEvidenceManifest {
  schema_version: string;
  feature: string;
  phase: string;
  generated_at: string;
  inputs: EvidenceEntry[];
  outputs: EvidenceEntry[];
  environment: EvidenceEnvironment;
  /** 旧记录原值继续参与 aggregate；新 writer 写 null，不核对当前回执。 */
  receipt_sha256: string | null;
  /** 对 {feature,phase,inputs,outputs,environment,receipt_sha256} 稳定序列化的哈希 */
  aggregate_sha256: string;
}

/**
 * 各阶段产出面（outputs overlay）。inputs 面 SSOT 在 spec-loader，两者语义不同：
 * loader 表=门禁读什么；本表=该阶段对哪些 artifact 负责（closure 后被改即 STALE 传导）。
 * coding/ut 的源码树产出经 closure-attestation（t2）单独承载，不在文件表内——
 * 调用方通过 opts.extraOutputs 注入 attestation 路径。
 */
export const PHASE_OUTPUT_FILES_BY_PHASE: Partial<Record<Phase, string[]>> = {
  spec: ['spec.md', 'acceptance.yaml'],
  plan: ['plan.md', 'contracts.yaml'],
  coding: [],
  review: ['review-report.md'],
  ut: [],
  change: ['change.md'],
  testing: ['test-plan.md', 'test-report.md'],
};

/** spec 阶段可选产出（存在才纳入；ui-spec/use-cases 等按需产出的 artifact） */
export const PHASE_OPTIONAL_OUTPUT_FILES_BY_PHASE: Partial<Record<Phase, string[]>> = {
  plan: ['use-cases.yaml'],
};

/**
 * spec 子目录内的按需产出（resolveFeatureArtifact 不认识的相对路径形态，
 * featureFilePath 直连；存在才纳入）——codex 五轮 P1：ui-spec 是视觉门禁 SSOT，
 * closure 后被改必须传导 stale。
 */
export const PHASE_OPTIONAL_OUTPUT_RELPATHS_BY_PHASE: Partial<Record<Phase, string[]>> = {
  // P0-3（plan 7c4f2e9b，codex 二轮 must-fix#1）：补齐 spec/asset-manifest.yaml——
  // 本表是 PASS 快照 frozen deliverables 的 SSOT 之一，缺登记=该产物漏出冻结面。
  spec: ['spec/ui-spec.yaml', 'spec/ref-elements.yaml', 'spec/asset-manifest.yaml'],
  plan: ['plan/visual-parity.yaml'],
  ut: ['ut/testability-audit.md', 'ut/mock-plan.yaml', 'ut/reports/ac-coverage.json'],
};

/**
 * 阶段 reports 产出（receiptDir/reports 下；存在才纳入）——codex 五轮 P1：
 * collectCleanPassIssues 消费 summary.json 的 verdict，summary/trace 必须
 * 在 manifest 保护面内，否则闭环后把 FAIL 改 PASS 不触发 staleness。
 */
export const PHASE_REPORTS_OUTPUT_FILES = [
  'summary.json',
  'script-report.json',
  'trace.json',
  'device-test-evidence.json',
] as const;
// verifier 报告**不在**本表内，也不再动态登记（plan d2f7a9c4）：它的内容刻意不做防篡改，
// 登记字节会让 manifest 成为「改报告唯一还有机器后果」的地方。旧 manifest 里登记过的
// verifier 条目字节对账照旧生效——校验侧遍历的是 manifest 里已记录的条目，不是本表。

export interface ResolveManifestOptions {
  /** gate 的同源 compose 预览；正式 finalizer 仍从提交后的 canonical 文件读取。 */
  deviceTestEvidence?: { trace_path?: unknown };
  resolvedInputs?: import('./capability-resolution').ResolvedPhaseInputs;
  factsContext?: import('./context-facts').FactsInvocationContext;
  projectRoot: string;
  feature: string;
  phase: Phase;
  /** 运行时追加输入（绝对或项目根相对路径）：requirement SSOT、解引用文档、ux-reference 等 */
  extraInputs?: string[];
  /** 运行时追加产出（如 review 的 closure attestation 路径） */
  extraOutputs?: string[];
  /** features_dir 覆盖（单测/自定义布局） */
  featurePathOpts?: FeaturePathOptions;
  /** framework 根（gate 指纹/workflow 定位）；缺省从 projectRoot 推导 */
  frameworkRoot?: string;
  /**
   * Staged bytes whose hash must be recorded under the canonical project path.
   * Used by closure finalization so the manifest binds the final summary bytes
   * before those bytes are atomically published.
   */
  stagedOutputs?: Array<{ canonicalPath: string; sha256: string }>;
  /** 闭环时当前权威 run 的规范化 requirement 内容哈希（codex 八轮 P0-2）——check-receipt
   * 由 computeRunRequirementSha(当前 MAISON_GOAL_RUN_ID) 传入。 */
  requirementSha?: string | null;
  /** 时钟注入（单测确定性） */
  now?: () => Date;
}

export function sha256File(absPath: string): string | null {
  try {
    if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) return null;
    return crypto.createHash('sha256').update(fs.readFileSync(absPath)).digest('hex');
  } catch {
    return null;
  }
}

export function evidenceEntryMatchesCurrentFile(
  projectRoot: string,
  entry: EvidenceEntry,
  feature: string,
  authorityReaders?: IdentityNeutralDigestReaders,
): boolean {
  const absPath = path.join(projectRoot, entry.path);
  if (entry.facts_phase !== undefined) return factsEvidenceHash(absPath, entry.facts_phase) === entry.sha256;
  if (entry.identity_neutral !== undefined) {
    return entry.identity_neutral === IDENTITY_NEUTRAL_EVIDENCE && entry.sha256 !== null
      && identityNeutralEvidenceDigest(projectRoot, feature, absPath, authorityReaders) === entry.sha256;
  }
  return sha256File(absPath) === entry.sha256;
}

export interface EvidenceSemanticOptions {
  authorityReaders?: IdentityNeutralDigestReaders;
  runId?: string;
  currentRequirementSha?: string | null;
  frameworkRoot?: string;
  resolvedInputs?: import('./capability-resolution').ResolvedPhaseInputs;
  factsContext?: import('./context-facts').FactsInvocationContext;
}

function evidenceRequirementContext(projectRoot: string, feature: string, phase: string, opts: EvidenceSemanticOptions) {
  const featuresDir = (loadFrameworkConfig(projectRoot).paths?.features_dir ?? 'doc/features').replace(/\\/g, '/');
  let runId = opts.runId ?? process.env.MAISON_GOAL_RUN_ID?.trim();
  if (!runId) {
    try {
      const summary = JSON.parse(fs.readFileSync(path.join(featurePhaseReportsDir(projectRoot, feature, phase, opts.frameworkRoot), 'summary.json'), 'utf8'));
      if (summary.feature === feature && summary.phase === phase && typeof summary.run_id === 'string') runId = summary.run_id.trim();
    } catch { /* No artifact identity: retain independent authority. */ }
  }
  const source = resolveCurrentRequirementSource(projectRoot, feature, featuresDir, runId);
  const requirement = source?.kind === 'run' ? source.requirement : source?.text;
  const requirementSha = opts.currentRequirementSha !== undefined ? opts.currentRequirementSha : (requirement === undefined ? null
    : computeRequirementShaFromText(projectRoot, feature, requirement, featuresDir));
  return { featuresDir, runId, source, requirementSha };
}

function currentEvidenceRequirementSha(projectRoot: string, feature: string, manifest: PhaseEvidenceManifest, opts: EvidenceSemanticOptions = {}) {
  if (opts.currentRequirementSha !== undefined) return opts.currentRequirementSha;
  if (manifest.environment.requirement_sha256 == null) return null;
  const context = evidenceRequirementContext(projectRoot, feature, manifest.phase, opts);
  // A real run binds new evidence too; context-free standalone evidence keeps its existing contract.
  return context.source?.kind === 'run' || manifest.inputs.some(entry => /\/goal-runs\/[^/]+\/manifest\.json$/.test(entry.path))
    ? context.requirementSha : null;
}

function evidenceSemanticContext(projectRoot: string, feature: string, phase: string, opts: EvidenceSemanticOptions) {
  const { featuresDir, runId, requirementSha } = evidenceRequirementContext(projectRoot, feature, phase, opts);
  const businessPaths = new Set(collectRequirementSsotPaths(projectRoot, feature, featuresDir, { runId }).map(file => path.resolve(projectRoot, file)));
  for (const input of Object.values(opts.resolvedInputs?.values ?? {})) {
    for (const dep of input.state === 'resolved' ? input.binding.dependencies : input.attempts.flatMap(attempt => attempt.dependencies)) businessPaths.add(path.resolve(projectRoot, dep.path));
  }
  for (const file of opts.factsContext?.source_paths ?? []) businessPaths.add(path.resolve(projectRoot, file));
  try {
    const facts = YAML.parse(fs.readFileSync(resolveFactsAbsPath(projectRoot, feature), 'utf8').split(/^---\s*$/m)[1] ?? '') as { source_code_paths?: unknown };
    if (Array.isArray(facts?.source_code_paths)) for (const file of facts.source_code_paths) if (typeof file === 'string') businessPaths.add(path.resolve(projectRoot, file));
  } catch { /* Missing facts do not declare extra business sources. */ }
  try {
    const { resolveEffectiveScopeSource } = require('./goal-run-creation') as typeof import('./goal-run-creation');
    const scope = resolveEffectiveScopeSource(projectRoot, feature, runId)?.scope;
    if (scope) {
      const { resolveDependencyPath, inferLegacyProjectRoot } = require('./project-relative-path') as typeof import('./project-relative-path');
      const legacyRoot = inferLegacyProjectRoot(projectRoot, scope);
      for (const obligation of scope.obligations) for (const binding of [...obligation.basis, ...(obligation.satisfied_by ?? []).filter(ref => 'dependencies' in ref)]) {
        for (const dep of binding.dependencies) businessPaths.add(resolveDependencyPath(projectRoot, dep.path, legacyRoot));
      }
    }
  } catch { return null; }
  const controlPaths = new Set(listAuthoritativeGoalRuns(projectRoot, feature, featuresDir).runs
    .map(id => path.resolve(featureFilePath(projectRoot, feature, `goal-runs/${id}/manifest.json`, { featuresDirAbs: path.resolve(projectRoot, featuresDir) }))));
  return { requirementSha, businessPaths, controlPaths };
}

/** Old entries lack collection provenance: retire only the former collector's bounded control surface. */
export function phaseEvidenceBusinessInputs(projectRoot: string, feature: string, manifest: PhaseEvidenceManifest,
  opts: EvidenceSemanticOptions = {}): EvidenceEntry[] {
  const inputs = manifest.inputs.filter(entry => {
    if (entry.role !== 'input' || sha256File(path.join(projectRoot, entry.path)) === entry.sha256) return true;
    const { componentIndexPath } = require('../../config') as typeof import('../../config');
    if (path.resolve(projectRoot, entry.path) !== path.resolve(componentIndexPath(projectRoot))) return true;
    try {
      const { isCurrentComponentInventory } = require('./component-assets') as typeof import('./component-assets');
      // A rebuilt inventory is a projection of the source, not a new design decision.
      // Missing/corrupt/stale inventory and human curation still retain their checks.
      return !isCurrentComponentInventory(projectRoot, entry.path);
    } catch { return true; }
  });
  if (!inputs.some(entry => /\/goal-runs\/[^/]+\/manifest\.json$/.test(entry.path))) return inputs;
  const context = evidenceSemanticContext(projectRoot, feature, manifest.phase, opts);
  const now = resolveEnvironment(projectRoot, manifest.phase, opts.frameworkRoot);
  if (!context?.requirementSha || context.requirementSha !== manifest.environment.requirement_sha256
    || ['framework_version', 'gate_fingerprint', 'framework_config_sha256', 'workflow_sha256'].some(key =>
      now[key as keyof EvidenceEnvironment] !== manifest.environment[key as keyof EvidenceEnvironment])) return inputs;
  return inputs.filter(entry => entry.role !== 'input' || entry.facts_phase !== undefined || entry.identity_neutral !== undefined
    || entry.owner_phase !== undefined || !entry.exists || entry.sha256 === null
    || !context.controlPaths.has(path.resolve(projectRoot, entry.path)) || context.businessPaths.has(path.resolve(projectRoot, entry.path)));
}

/** Keep the original invocation baseline intact; consumers use this view after evidence integrity checks. */
export function factsBaselineBusinessDependencies(projectRoot: string, feature: string,
  context: import('./context-facts').FactsInvocationContext, opts: EvidenceSemanticOptions = {}): import('./capability-resolution').ResolutionDependency[] {
  const dependencies = context.baseline?.dependencies ?? [];
  if (!context.baseline) return dependencies;
  const loaded = loadPhaseEvidenceManifest(projectRoot, feature, context.baseline.established_by);
  if (!loaded?.integrityOk) return dependencies;
  const inputs = phaseEvidenceBusinessInputs(projectRoot, feature, loaded.manifest, {
    ...opts, factsContext: context, runId: opts.runId ?? ('run_id' in context.subject ? context.subject.run_id : undefined),
  });
  const retired = loaded.manifest.inputs.filter(entry => !inputs.includes(entry));
  return dependencies.filter(dep => !retired.some(entry => path.resolve(dep.path) === path.resolve(projectRoot, entry.path)
    && dep.exists === entry.exists && dep.sha256 === entry.sha256));
}

function factsEvidenceHash(absPath: string, phase: string): string | null {
  try { return factsPhaseFingerprint(fs.readFileSync(absPath, 'utf8'), phase); }
  catch { return null; }
}

function sha256Text(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf-8').digest('hex');
}

function toPosixRel(projectRoot: string, absPath: string): string {
  return path.relative(projectRoot, absPath).split(path.sep).join('/');
}

/** 稳定序列化（键排序）——aggregate 与 manifest 文件哈希的共同基础 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = sortValue((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

function computeAggregate(m: Omit<PhaseEvidenceManifest, 'aggregate_sha256' | 'generated_at' | 'schema_version'>): string {
  return sha256Text(
    stableStringify({
      feature: m.feature,
      phase: m.phase,
      inputs: m.inputs,
      outputs: m.outputs,
      environment: m.environment,
      receipt_sha256: m.receipt_sha256,
    }),
  );
}

function resolveEnvironment(
  projectRoot: string,
  phase: string,
  frameworkRoot?: string,
  requirementSha?: string | null,
): EvidenceEnvironment {
  let gateFingerprint: string | null = null;
  let workflowSha: string | null = null;
  let frameworkVersion: string | null = null;
  let profileName: string | null = null;

  const fwRoot = frameworkRoot ?? guessFrameworkRoot(projectRoot);
  if (fwRoot) {
    try {
      gateFingerprint = computeGateFingerprint(fwRoot, phase);
    } catch {
      gateFingerprint = null;
    }
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(fwRoot, 'package.json'), 'utf-8')) as { version?: string };
      frameworkVersion = pkg.version ?? null;
    } catch {
      frameworkVersion = null;
    }
  }
  try {
    const cfg = loadFrameworkConfig(projectRoot) as {
      active_workflow?: string;
      project_profile?: { name?: string };
    };
    profileName = cfg.project_profile?.name ?? null;
    if (fwRoot && cfg.active_workflow) {
      workflowSha = sha256File(path.join(fwRoot, 'workflows', `${cfg.active_workflow}.workflow.yaml`));
    }
  } catch {
    /* config 缺失字段留 null */
  }
  const configSha = sha256File(path.join(projectRoot, 'framework.config.json'));
  return {
    framework_version: frameworkVersion,
    profile: profileName,
    gate_fingerprint: gateFingerprint,
    framework_config_sha256: configSha,
    workflow_sha256: workflowSha,
    requirement_sha256: requirementSha ?? null,
  };
}

function guessFrameworkRoot(projectRoot: string): string | null {
  // 布局感知单点（consumer vs standalone）——禁止硬编码 framework/ 前缀
  //（state_file 杂散树事故教训，path-governance 元测试强制）。
  try {
    return inferRepoLayout(projectRoot).frameworkRoot;
  } catch {
    return null;
  }
}

/**
 * 解析并落哈希：inputs=loader 两表（REQUIRED role=input；OPTIONAL 存在才纳入）+
 * extraInputs；outputs=本模块 overlay 两表 + extraOutputs。同路径同时命中 → role=both。
 * 回执与 manifest 自身**禁止**出现在任何集合（防自引用环，见文件头封装序）。
 */
export function resolvePhaseEvidenceManifest(opts: ResolveManifestOptions): PhaseEvidenceManifest {
  const { projectRoot, feature, phase } = opts;
  if (opts.factsContext && !('feature' in opts.factsContext.subject)) throw new Error('Feature evidence requires Feature facts subject');
  const nowIso = (opts.now ? opts.now() : new Date()).toISOString();

  const inputNames = opts.resolvedInputs ? [] : [
    ...(REQUIRED_FEATURE_FILES_BY_PHASE[phase] ?? []),
    ...(OPTIONAL_FEATURE_FILES_BY_PHASE[phase] ?? []).filter((f) =>
      resolveFeatureArtifact(projectRoot, feature, f, opts.featurePathOpts).exists,
    ),
  ];
  const outputNames = opts.resolvedInputs ? opts.resolvedInputs.context.required_outputs : [
    ...(PHASE_OUTPUT_FILES_BY_PHASE[phase] ?? []),
    ...(PHASE_OPTIONAL_OUTPUT_FILES_BY_PHASE[phase] ?? []).filter((f) =>
      resolveFeatureArtifact(projectRoot, feature, f, opts.featurePathOpts).exists,
    ),
  ];

  const stagedHashes = new Map<string, string>();
  for (const staged of opts.stagedOutputs ?? []) {
    if (!/^[0-9a-f]{64}$/.test(staged.sha256)) {
      throw new Error(`[phase-evidence-manifest] staged output sha256 非法：${staged.canonicalPath}`);
    }
    const abs = path.isAbsolute(staged.canonicalPath)
      ? staged.canonicalPath
      : path.join(projectRoot, staged.canonicalPath);
    const rel = toPosixRel(projectRoot, abs);
    stagedHashes.set(rel, staged.sha256);
  }

  const entryMap = new Map<string, EvidenceEntry>();
  const factsPath = opts.factsContext ? resolveFactsAbsPath(projectRoot, feature, opts.factsContext) : undefined;
  const addEntry = (absPath: string, role: 'input' | 'output', ownerPhase?: string): void => {
    const rel = toPosixRel(projectRoot, absPath);
    const base = path.basename(rel);
    if (base === 'phase-completion-receipt.md' || base === PHASE_EVIDENCE_MANIFEST_FILENAME) {
      throw new Error(
        `[phase-evidence-manifest] ${base} 不得进入 inputs/outputs 集合（自引用环防线，封装序见模块头）：${rel}`,
      );
    }
    const prev = entryMap.get(rel);
    if (prev) {
      if (prev.role !== role) prev.role = 'both';
      if (ownerPhase) prev.owner_phase = ownerPhase;
      return;
    }
    const isFacts = factsPath !== undefined && path.resolve(absPath) === path.resolve(factsPath);
    const neutral = isFacts || stagedHashes.has(rel) || !fs.existsSync(absPath) ? undefined : identityNeutralEvidenceDigest(projectRoot, feature, absPath);
    const hash = isFacts ? factsEvidenceHash(absPath, String(phase)) : stagedHashes.get(rel) ?? neutral ?? sha256File(absPath);
    entryMap.set(rel, { path: rel, role, sha256: hash, exists: hash !== null, ...(isFacts ? { facts_phase: String(phase) } : {}), ...(neutral ? { identity_neutral: IDENTITY_NEUTRAL_EVIDENCE } : {}), ...(ownerPhase ? { owner_phase: ownerPhase } : {}) });
  };
  const addBoundInput = (dep: import('./capability-resolution').ResolutionDependency): void => {
    const rel = toPosixRel(projectRoot, dep.path);
    const owner = opts.factsContext?.source_owners?.[rel];
    if (owner === String(phase)) {
      addEntry(dep.path, 'output', String(phase));
      return;
    }
    if (sha256File(dep.path) !== dep.sha256 || fs.existsSync(dep.path) !== dep.exists) throw new Error(`input binding stale: ${dep.path}`);
    addEntry(dep.path, 'input', owner);
  };

  if (opts.resolvedInputs) {
    if (!('feature' in opts.resolvedInputs.context.subject) || opts.resolvedInputs.context.subject.feature !== feature || opts.resolvedInputs.phase !== String(phase)) {
      throw new Error('[phase-evidence-manifest] Feature evidence requires matching Feature invocation');
    }
    for (const value of Object.values(opts.resolvedInputs.values)) {
      const deps = value.state === 'resolved' ? value.binding.dependencies : value.attempts.flatMap(a => a.dependencies);
      for (const dep of deps) {
        if (!isInsideProjectRoot(projectRoot, dep.path) || (opts.frameworkRoot && path.resolve(opts.frameworkRoot) !== path.resolve(projectRoot) && isInsideProjectRoot(opts.frameworkRoot, dep.path))) continue;
        addBoundInput(dep);
      }
    }
  }
  if (opts.factsContext) {
    const factsPath = resolveFactsAbsPath(projectRoot, feature, opts.factsContext);
    addEntry(factsPath, isFactsEstablishingPhase(String(phase), opts.factsContext) ? 'output' : 'input');
    for (const source of opts.factsContext.source_paths) {
      const owner = opts.factsContext.source_owners?.[source];
      addEntry(path.resolve(projectRoot, source), owner === String(phase) ? 'output' : 'input', owner);
    }
    for (const [source, owner] of Object.entries(opts.factsContext.source_owners ?? {})) {
      if (owner === String(phase) && !opts.factsContext.source_paths.includes(source) && fs.existsSync(path.resolve(projectRoot, source))) {
        addEntry(path.resolve(projectRoot, source), 'output', owner);
      }
    }
    if (opts.factsContext.baseline) for (const dep of factsBaselineBusinessDependencies(projectRoot, feature, opts.factsContext, opts)) {
      const rel = toPosixRel(projectRoot, dep.path);
      if (opts.factsContext.source_owners?.[rel] === String(phase)) addEntry(dep.path, 'output', String(phase));
      else addBoundInput(dep);
    }
  }
  for (const name of inputNames) {
    addEntry(resolveFeatureArtifact(projectRoot, feature, name, opts.featurePathOpts).actualPath, 'input');
  }
  for (const p of opts.extraInputs ?? []) {
    addEntry(path.isAbsolute(p) ? p : path.join(projectRoot, p), 'input');
  }
  for (const name of outputNames) {
    addEntry(resolveFeatureArtifact(projectRoot, feature, name, opts.featurePathOpts).actualPath, 'output');
  }
  // spec 子目录按需产出（存在才纳入）
  for (const rel of opts.resolvedInputs ? [] : PHASE_OPTIONAL_OUTPUT_RELPATHS_BY_PHASE[phase] ?? []) {
    const abs = featureFilePath(projectRoot, feature, rel, opts.featurePathOpts);
    if (fs.existsSync(abs)) addEntry(abs, 'output');
  }
  // reports 产出（summary/verifier/trace 必须在保护面内，存在才纳入）。
  // 路径必须走 featurePhaseReportsDir（尊重 paths.reports_dir_pattern）——手拼
  // `receiptDir/reports` 在自定义 reports_dir_pattern 下会指向空目录，于是 summary/
  // verifier 整组悄悄落到保护面之外（review P1-4 实测：outputs 里这几项为空集）。
  const reportsDir = featurePhaseReportsDir(projectRoot, feature, String(phase), opts.frameworkRoot);
  for (const name of PHASE_REPORTS_OUTPUT_FILES) {
    const abs = path.join(reportsDir, name);
    const rel = toPosixRel(projectRoot, abs);
    if (fs.existsSync(abs) || stagedHashes.has(rel)) addEntry(abs, 'output');
  }
  // verifier 报告**不登记**（plan d2f7a9c4）。它的内容刻意不做防篡改：loader 只校验
  // subject 回显与 verdict 自洽，不验指纹。若这里仍登记它的字节，manifest 就成了「改报告
  // 唯一还有机器后果」的地方——与裁决规则自相矛盾，也会复活当初催生 subject 分区的那条
  // stale 级联。闭环采用的结论记在 summary，而 summary 在保护面内。
  // P0 runtime telemetry lives in the authoritative timestamped Hylyre trace.
  // The canonical device-test evidence points to that trace; derive the second
  // output from the existing artifact so the phase manifest binds both without
  // introducing another path registry.
  if (String(phase) === 'testing') {
    const deviceEvidence = path.join(reportsDir, 'device-test-evidence.json');
    try {
      const doc = opts.deviceTestEvidence ?? JSON.parse(fs.readFileSync(deviceEvidence, 'utf-8')) as { trace_path?: unknown };
      if (typeof doc.trace_path === 'string' && path.isAbsolute(doc.trace_path)) {
        const traceAbs = path.resolve(doc.trace_path);
        const reportsRoot = path.resolve(reportsDir);
        if (traceAbs.startsWith(reportsRoot + path.sep) && fs.existsSync(traceAbs)) {
          addEntry(traceAbs, 'output');
        }
      }
    } catch {
      // The testing gate owns malformed/missing evidence. Manifest generation
      // still records the canonical evidence file (when present) for freshness.
    }
  }
  for (const p of opts.extraOutputs ?? []) {
    addEntry(path.isAbsolute(p) ? p : path.join(projectRoot, p), 'output');
  }

  const entries = [...entryMap.values()].sort((a, b) => a.path.localeCompare(b.path));
  const inputs = entries.filter((e) => e.role !== 'output');
  const outputs = entries.filter((e) => e.role !== 'input');

  const environment = resolveEnvironment(projectRoot, phase, opts.frameworkRoot, opts.requirementSha);
  const core = { feature, phase: String(phase), inputs, outputs, environment, receipt_sha256: null };
  return {
    schema_version: PHASE_EVIDENCE_MANIFEST_SCHEMA_VERSION,
    generated_at: nowIso,
    ...core,
    aggregate_sha256: computeAggregate(core),
  };
}

/**
 * 该 phase 的 manifest 面**候选**路径全集（不看存在性，含 legacy 读回退路径）。
 *
 * 为什么需要它：`resolvePhaseEvidenceManifest` 的可选条目「存在才纳入」——文件被删后
 * 整条从 manifest 消失，只比"本轮 manifest 里有的"识别不了删除。沿用判据
 * （harness-runner `carriedMaterialStillCurrent`）用本集合判定"旧材料视图里的某个文件
 * 属不属于 manifest 面"，据此做双向核对。表沿用本模块与 spec-loader 的既有 SSOT，
 * 不另立手写表。
 *
 * reports/ 下的运行期产出**不在**集合内：由 `createRuntimeArtifactPredicate` 统一排除——
 * 与 `buildVerifierMaterialView` 是**同一条**规则，不复制第二份（codex review 三轮 medium）。
 */
export function phaseEvidenceManifestCandidatePaths(opts: {
  resolvedInputs?: import('./capability-resolution').ResolvedPhaseInputs;
  factsContext?: import('./context-facts').FactsInvocationContext;
  projectRoot: string;
  feature: string;
  phase: Phase;
  frameworkRoot?: string;
  featurePathOpts?: FeaturePathOptions;
}): Set<string> {
  const { projectRoot, feature, phase } = opts;
  if (opts.resolvedInputs && (!('feature' in opts.resolvedInputs.context.subject) || opts.resolvedInputs.context.subject.feature !== feature || opts.resolvedInputs.phase !== String(phase))) throw new Error('Feature evidence requires matching Feature invocation');
  const isRuntimeArtifact = createRuntimeArtifactPredicate({
    projectRoot,
    feature,
    phase: String(phase),
    frameworkRoot: opts.frameworkRoot,
  });
  const out = new Set<string>();
  const add = (rel: string): void => {
    if (!isRuntimeArtifact(rel)) out.add(rel);
  };
  if (opts.resolvedInputs) {
    for (const value of Object.values(opts.resolvedInputs.values)) {
      for (const dep of value.state === 'resolved' ? value.binding.dependencies : value.attempts.flatMap(a => a.dependencies)) {
        if (!isInsideProjectRoot(projectRoot, dep.path) || (opts.frameworkRoot && path.resolve(opts.frameworkRoot) !== path.resolve(projectRoot) && isInsideProjectRoot(opts.frameworkRoot, dep.path))) continue;
        add(toPosixRel(projectRoot, dep.path));
      }
    }
    for (const name of opts.resolvedInputs.context.required_outputs) add(toPosixRel(projectRoot, resolveFeatureArtifact(projectRoot, feature, name, opts.featurePathOpts).actualPath));
    if (opts.factsContext) {
      add(toPosixRel(projectRoot, resolveFactsAbsPath(projectRoot, feature, opts.factsContext)));
      for (const source of opts.factsContext.source_paths) add(toPosixRel(projectRoot, path.resolve(projectRoot, source)));
      for (const source of Object.keys(opts.factsContext.source_owners ?? {})) add(toPosixRel(projectRoot, path.resolve(projectRoot, source)));
      for (const dep of factsBaselineBusinessDependencies(projectRoot, feature, opts.factsContext, opts)) add(toPosixRel(projectRoot, dep.path));
    }
    return out;
  }
  for (const name of [
    ...(REQUIRED_FEATURE_FILES_BY_PHASE[phase] ?? []),
    ...(OPTIONAL_FEATURE_FILES_BY_PHASE[phase] ?? []),
    ...(PHASE_OUTPUT_FILES_BY_PHASE[phase] ?? []),
    ...(PHASE_OPTIONAL_OUTPUT_FILES_BY_PHASE[phase] ?? []),
  ]) {
    for (const abs of artifactReadCandidatePaths(projectRoot, feature, name, opts.featurePathOpts)) {
      add(toPosixRel(projectRoot, abs));
    }
  }
  for (const rel of PHASE_OPTIONAL_OUTPUT_RELPATHS_BY_PHASE[phase] ?? []) {
    add(toPosixRel(projectRoot, featureFilePath(projectRoot, feature, rel, opts.featurePathOpts)));
  }
  return out;
}

/**
 * manifest 面的**运行期产出排除谓词**：reports 目录（含其下全部文件）与阶段回执不属于 manifest 面。
 *
 * 唯一口径（SSOT）：材料视图的构建侧 `buildVerifierMaterialView`（verifier-material.ts）与
 * 归属判定侧 `phaseEvidenceManifestCandidatePaths` 共用本函数。两边各写一份规则的后果
 * （codex review 三轮 medium，已内存复现）：`reports_dir_pattern` 指向 phase 目录**本身**时，
 * review-report.md 在构建侧被当运行期产出排除、只能经 contextFiles 进旧视图，却被候选集认成
 * manifest 面 → 沿用判据的反向比较恒 false → 材料一字未动、仅切 balanced 也丢弃 subject，
 * strict 轮的 FAIL 否决随之落空（少否决）。
 *
 * `frameworkRoot` 惰性用于 `featurePhaseReportsDir` 的回退分支（配置有 reports_dir_pattern 时不需要）。
 */
export function createRuntimeArtifactPredicate(opts: {
  projectRoot: string;
  feature: string;
  phase: string;
  frameworkRoot?: string;
}): (relPath: string) => boolean {
  const reportsRel = toPosixRel(
    opts.projectRoot,
    featurePhaseReportsDir(opts.projectRoot, opts.feature, opts.phase, opts.frameworkRoot),
  );
  return (relPath: string): boolean =>
    relPath === reportsRel ||
    relPath.startsWith(`${reportsRel}/`) ||
    path.basename(relPath) === 'phase-completion-receipt.md';
}

export function phaseEvidenceManifestPath(projectRoot: string, feature: string, phase: string): string {
  return path.join(receiptDirPath(projectRoot, feature, phase), 'reports', PHASE_EVIDENCE_MANIFEST_FILENAME);
}

/** manifest 落盘（原子：tmp+rename）；返回 {absPath, sha256}——receipt/summary 只存这两样 */
export function writePhaseEvidenceManifest(
  projectRoot: string,
  manifest: PhaseEvidenceManifest,
): { absPath: string; sha256: string } {
  const absPath = phaseEvidenceManifestPath(projectRoot, manifest.feature, manifest.phase);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  const text = JSON.stringify(manifest, null, 2) + '\n';
  const tmp = `${absPath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text, 'utf-8');
  fs.renameSync(tmp, absPath);
  return { absPath, sha256: sha256Text(text) };
}

/** 按原记录全部字段重算 aggregate；包括旧 receipt 字段，不核对人读回执指针。 */
export function recomputeManifestAggregate(m: PhaseEvidenceManifest): string {
  return computeAggregate({
    feature: m.feature,
    phase: m.phase,
    inputs: m.inputs,
    outputs: m.outputs,
    environment: m.environment,
    receipt_sha256: m.receipt_sha256,
  });
}

function isValidEntry(e: unknown): e is EvidenceEntry {
  const o = e as EvidenceEntry;
  return !!o && typeof o.path === 'string' && o.path.length > 0
    && (o.role === 'input' || o.role === 'output' || o.role === 'both')
    && (o.sha256 === null || typeof o.sha256 === 'string')
    && typeof o.exists === 'boolean'
    && (o.facts_phase === undefined || (typeof o.facts_phase === 'string' && o.facts_phase.length > 0))
    && (o.owner_phase === undefined || (typeof o.owner_phase === 'string' && o.owner_phase.length > 0))
    && (o.identity_neutral === undefined || o.identity_neutral === IDENTITY_NEUTRAL_EVIDENCE);
}

export interface LoadedManifest {
  manifest: PhaseEvidenceManifest;
  fileSha256: string;
  /** schema 完整 且 重算 aggregate 与自报一致 */
  integrityOk: boolean;
  integrityErrors: string[];
}

export function loadPhaseEvidenceManifest(
  projectRoot: string,
  feature: string,
  phase: string,
): LoadedManifest | null {
  const absPath = phaseEvidenceManifestPath(projectRoot, feature, phase);
  if (!fs.existsSync(absPath)) return null;
  try {
    const text = fs.readFileSync(absPath, 'utf-8');
    const manifest = JSON.parse(text) as PhaseEvidenceManifest;
    const errors: string[] = [];
    if (manifest.schema_version !== PHASE_EVIDENCE_MANIFEST_SCHEMA_VERSION) {
      errors.push(`schema_version 非法：${String(manifest.schema_version)}`);
    }
    // codex 七轮 P2-1：内部身份校验——跨 feature/phase 搬运或重标 manifest 直接判 tampered。
    if (manifest.feature !== feature) errors.push(`manifest.feature 失配：${String(manifest.feature)} ≠ ${feature}`);
    if (String(manifest.phase) !== String(phase)) errors.push(`manifest.phase 失配：${String(manifest.phase)} ≠ ${phase}`);
    if (!Array.isArray(manifest.inputs) || !manifest.inputs.every(isValidEntry)) errors.push('inputs 结构非法');
    if (!Array.isArray(manifest.outputs) || !manifest.outputs.every(isValidEntry)) errors.push('outputs 结构非法');
    if (errors.length === 0 && [...manifest.inputs, ...manifest.outputs].some(entry => entry.facts_phase !== undefined && entry.facts_phase !== manifest.phase)) errors.push('facts_phase 与 manifest.phase 失配');
    if (!manifest.environment || typeof manifest.environment !== 'object') errors.push('environment 缺失');
    if (typeof manifest.aggregate_sha256 !== 'string') errors.push('aggregate_sha256 缺失');
    if (errors.length === 0 && recomputeManifestAggregate(manifest) !== manifest.aggregate_sha256) {
      errors.push('aggregate 重算失配（manifest 条目被改写）');
    }
    return { manifest, fileSha256: sha256Text(text), integrityOk: errors.length === 0, integrityErrors: errors };
  } catch {
    return null;
  }
}

export type PhaseStalenessVerdict = 'fresh' | 'stale' | 'missing' | 'tampered';

export interface PhaseStalenessResult {
  phase: string;
  verdict: PhaseStalenessVerdict;
  /** 变更/缺失的证据路径（stale 时非空）；missing/tampered 时可为空 */
  changed_paths: string[];
  /** 兼容结果字段；回执已退出 freshness，当前重算恒 false。 */
  receipt_changed: boolean;
  /** tampered/完整性问题的机器原因 */
  integrity_errors?: string[];
  /** 因上游非 fresh 被传染（自身证据可能未变） */
  propagated_from?: string;
}

/**
 * Verify an already-published manifest while one or more canonical outputs are
 * still represented by staged bytes. This is the closure crash-recovery view:
 * integrity, business inputs/outputs and environment must be current; named
 * canonical outputs are compared with their staged hashes. Receipt projections
 * and their human-readable pointers do not participate in this proof.
 */
export function verifyPhaseEvidenceManifestWithStagedOutputs(input: {
  projectRoot: string;
  feature: string;
  phase: string;
  stagedOutputs: Array<{ canonicalPath: string; sha256: string }>;
  frameworkRoot?: string;
  currentRequirementSha?: string | null;
  runId?: string;
}): PhaseStalenessResult {
  const loaded = loadPhaseEvidenceManifest(input.projectRoot, input.feature, input.phase);
  if (!loaded) {
    return { phase: input.phase, verdict: 'missing', changed_paths: [], receipt_changed: false };
  }
  if (!loaded.integrityOk) {
    return {
      phase: input.phase,
      verdict: 'tampered',
      changed_paths: [],
      receipt_changed: false,
      integrity_errors: loaded.integrityErrors,
    };
  }
  // plan 07a41ec6（codex review P0）：回执指针不再参与 partial publication 的等价证明（manifest 自证）。
  const envNow = resolveEnvironment(input.projectRoot, input.phase, input.frameworkRoot);
  const envRec = loaded.manifest.environment;
  const currentRequirementSha = currentEvidenceRequirementSha(input.projectRoot, input.feature, loaded.manifest, input);
  const envChanged: string[] = [];
  if (envNow.framework_config_sha256 !== envRec.framework_config_sha256) envChanged.push('framework_config');
  if (envNow.workflow_sha256 !== envRec.workflow_sha256) envChanged.push('workflow');
  if (envNow.gate_fingerprint !== envRec.gate_fingerprint) envChanged.push('gate_fingerprint');
  if (envNow.framework_version !== envRec.framework_version) envChanged.push('framework_version');
  if (currentRequirementSha != null) {
    if (envRec.requirement_sha256 == null) envChanged.push('requirement_unbound');
    else if (currentRequirementSha !== envRec.requirement_sha256) envChanged.push('requirement');
  }
  if (envChanged.length > 0) {
    return {
      phase: input.phase,
      verdict: 'stale',
      changed_paths: envChanged.map((item) => `<environment:${item}>`),
      receipt_changed: false,
    };
  }

  const staged = new Map(input.stagedOutputs.map((item) => [
    toPosixRel(input.projectRoot, path.resolve(item.canonicalPath)),
    item.sha256,
  ]));
  const seenStaged = new Set<string>();
  const changed = new Set<string>();
  for (const entry of [...phaseEvidenceBusinessInputs(input.projectRoot, input.feature, loaded.manifest, input), ...loaded.manifest.outputs]) {
    const stagedSha = staged.get(entry.path);
    if (stagedSha !== undefined) {
      seenStaged.add(entry.path);
      if (!entry.exists || entry.sha256 !== stagedSha) changed.add(entry.path);
    } else if (!evidenceEntryMatchesCurrentFile(input.projectRoot, entry, input.feature)) {
      changed.add(entry.path);
    }
  }
  for (const stagedPath of staged.keys()) {
    if (!seenStaged.has(stagedPath)) changed.add(stagedPath);
  }
  return changed.size > 0
    ? { phase: input.phase, verdict: 'stale', changed_paths: [...changed], receipt_changed: false }
    : { phase: input.phase, verdict: 'fresh', changed_paths: [], receipt_changed: false };
}

/**
 * 阶段输入、状态评估与完成核验共用的重算：逐阶段——
 *   ① manifest schema 完整性 + aggregate 重算（改条目留旧 aggregate → tampered，
 *      codex 五轮 P0）；
 *   ② 环境与当前需求重算；③ 同源业务输入/输出逐项核对。
 * 任一非 fresh 沿 chain 传染下游。missing=无 manifest；tampered=记录完整性失配——
 * 消费方语义：preflight 拒启、completion verify 非 VALID；本函数只报事实不定裁决。
 */
export function recomputePhaseEvidenceStaleness(
  projectRoot: string,
  feature: string,
  chain: string[],
  opts?: EvidenceSemanticOptions & { pendingOwnerPhase?: string; pendingOwnerPaths?: string[] },
): PhaseStalenessResult[] {
  opts = { ...opts, authorityReaders: opts?.authorityReaders ?? createIdentityNeutralDigestReaders() };
  const results: PhaseStalenessResult[] = [];
  let upstreamBad: string | null = null;
  const pendingOwnerPaths = new Set(opts?.pendingOwnerPaths ?? []);
  // A live checker may use its admitted owner; read-only consumers require an observed write.
  const pendingOwners = new Set<string>(opts?.pendingOwnerPhase ? [opts.pendingOwnerPhase] : []);
  const sourceTransitions = new Map<string, Array<{ phase: string; before: string | null; after: string | null }>>();
  let evidenceRunId = opts?.runId;
  if (!evidenceRunId && chain.length) {
    try { evidenceRunId = evidenceRequirementContext(projectRoot, feature, chain[0], opts ?? {}).runId; } catch { /* Independent evidence has no run authority. */ }
  }
  if (evidenceRunId) {
    try {
      const { loadGoalManifestFromRun } = require('./goal-manifest') as typeof import('./goal-manifest');
      const { loadAuthoritativeEvents } = require('./goal-runner-phase') as typeof import('./goal-runner-phase');
      const manifest = loadGoalManifestFromRun(projectRoot, evidenceRunId, { feature });
      const events = loadAuthoritativeEvents(path.resolve(projectRoot, manifest.report_dir, 'events.jsonl'));
      const { readRunBoundContracts } = require('./capability-resolution') as typeof import('./capability-resolution');
      const { loadFeatureContracts, phaseContractIndex } = require('./skill-contract') as typeof import('./skill-contract');
      const framework = opts?.frameworkRoot ?? guessFrameworkRoot(projectRoot);
      if (framework) {
        const contracts = readRunBoundContracts(projectRoot, framework, feature, evidenceRunId, opts.authorityReaders);
        const sourceOwners = new Set([...phaseContractIndex(loadFeatureContracts(framework))]
          .filter(([, contract]) => contract.phase.produces.some(output => output.kind === 'source')).map(([phase]) => phase));
        const declared = new Set(contracts.files.filter(file => contracts.modules.some(module => {
          const rel = path.relative(path.resolve(projectRoot, module.package_path), path.resolve(projectRoot, file));
          return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
        })));
        for (const event of events) {
          if (event.type !== 'phase_write_observed' || !event.phase || !sourceOwners.has(event.phase)) continue;
          const owned = (event as unknown as { owned?: Array<{ path: string; pre_sha256: string | null; post_sha256: string | null }> }).owned ?? [];
          for (const write of owned) if (declared.has(write.path)) {
            const transitions = sourceTransitions.get(write.path) ?? [];
            transitions.push({ phase: event.phase, before: write.pre_sha256, after: write.post_sha256 });
            sourceTransitions.set(write.path, transitions);
          }
        }
      }
    } catch { /* Unavailable run identity grants no additional source ownership. */ }
  }
  const ownedOutputIsCurrent = (entry: EvidenceEntry, manifestPhase: string): boolean => {
    // Old manifests may lack a resource owner. Existing authorized write events supply
    // the same fact without rewriting the historical manifest or trusting a new file hash.
    let expected = entry.sha256;
    let advanced = false;
    for (const change of sourceTransitions.get(entry.path) ?? []) {
      if (change.phase !== manifestPhase && change.before === expected) { expected = change.after; advanced = true; }
    }
    if (advanced && expected === sha256File(path.join(projectRoot, entry.path))) return true;
    if (pendingOwnerPaths.has(entry.path)) return true;
    if (!entry.owner_phase || entry.owner_phase === manifestPhase) return false;
    if (pendingOwners.has(entry.owner_phase)) return true;
    const owner = loadPhaseEvidenceManifest(projectRoot, feature, entry.owner_phase);
    // The owner validates its own result. A later failure there must not reopen an upstream
    // observation when the declared output still has the exact bytes that owner recorded.
    return !!owner?.integrityOk && owner.manifest.outputs.some(output =>
      output.path === entry.path && output.owner_phase === entry.owner_phase
      && evidenceEntryMatchesCurrentFile(projectRoot, output, feature, opts?.authorityReaders));
  };

  for (const phase of chain) {
    if (upstreamBad) {
      results.push({
        phase,
        verdict: 'stale',
        changed_paths: [],
        receipt_changed: false,
        propagated_from: upstreamBad,
      });
      continue;
    }
    const loaded = loadPhaseEvidenceManifest(projectRoot, feature, phase);
    if (!loaded) {
      results.push({ phase, verdict: 'missing', changed_paths: [], receipt_changed: false });
      upstreamBad = phase;
      continue;
    }
    // ① schema+aggregate 完整性
    if (!loaded.integrityOk) {
      results.push({
        phase,
        verdict: 'tampered',
        changed_paths: [],
        receipt_changed: false,
        integrity_errors: loaded.integrityErrors,
      });
      upstreamBad = phase;
      continue;
    }
    for (const entry of [...loaded.manifest.inputs, ...loaded.manifest.outputs]) {
      if (entry.owner_phase && pendingOwners.has(entry.owner_phase)) pendingOwnerPaths.add(entry.path);
    }
    // ② plan 07a41ec6（codex review P0）：回执指针退出证据链——manifest 的 schema/aggregate/条目哈希已自证完整性，
    //    回执是闭环后的人读投影（可被 harness 随时重生成），不再作为 freshness 锚。
    // ②b 环境重算（codex 六轮 P0-5：记录了却不重算=装饰）：config/workflow/gate 指纹/
    //    framework 版本任一变化 → stale（environment_changed）。
    const envNow = resolveEnvironment(projectRoot, phase, opts?.frameworkRoot);
    const envRec = loaded.manifest.environment;
    const currentRequirementSha = currentEvidenceRequirementSha(projectRoot, feature, loaded.manifest, opts);
    const envChanged: string[] = [];
    if (envNow.framework_config_sha256 !== envRec.framework_config_sha256) envChanged.push('framework_config');
    if (envNow.workflow_sha256 !== envRec.workflow_sha256) envChanged.push('workflow');
    if (envNow.gate_fingerprint !== envRec.gate_fingerprint) envChanged.push('gate_fingerprint');
    if (envNow.framework_version !== envRec.framework_version) envChanged.push('framework_version');
    // ②c requirement 血缘（codex 八轮 P0-2 + 九轮 P0）：当前权威 run 的规范化 requirement
    //    与本 closure 记录的不一致 → stale。**记录为 null 同样 fail-closed**（交互态闭环
    //    合法产生 null——但新 goal 从中间阶段起链时无法证明旧 closure 审的是当前需求，
    //    未绑定即 stale：`requirement_unbound`）。已绑定的 run 证据从调用/环境/产物身份
    //    取得当前需求；真正无需求上下文的交互态仍跳过比较。
    if (currentRequirementSha != null) {
      if (envRec.requirement_sha256 == null) {
        envChanged.push('requirement_unbound');
      } else if (currentRequirementSha !== envRec.requirement_sha256) {
        envChanged.push('requirement');
      }
    }
    if (envChanged.length > 0) {
      results.push({
        phase,
        verdict: 'stale',
        changed_paths: envChanged.map((c) => `<environment:${c}>`),
        receipt_changed: false,
      });
      upstreamBad = phase;
      continue;
    }
    const { manifest } = loaded;
    const changed = new Set<string>();
    for (const entry of [...phaseEvidenceBusinessInputs(projectRoot, feature, manifest, opts), ...manifest.outputs]) {
      if (!evidenceEntryMatchesCurrentFile(projectRoot, entry, feature, opts?.authorityReaders) && !ownedOutputIsCurrent(entry, phase)) changed.add(entry.path);
    }
    if (changed.size > 0) {
      results.push({ phase, verdict: 'stale', changed_paths: [...changed], receipt_changed: false });
      upstreamBad = phase;
    } else {
      results.push({ phase, verdict: 'fresh', changed_paths: [], receipt_changed: false });
    }
  }
  return results;
}
