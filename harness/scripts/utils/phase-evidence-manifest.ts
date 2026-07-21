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
//   - receipt_sha256：**规范化**回执哈希。
//
// 无环封装序（openspec design §3.1，固定不留实现自由度）：
//   1. reports 与 receipt 正文先完成；
//   2. receipt 规范化（剔除 evidence_manifest / evidence_manifest_sha256 /
//      phase_closure_fingerprint 指针行）后取 hash；
//   3. 生成本 manifest（inputs+outputs+规范化 receipt hash），manifest 不 hash 自身；
//   4. receipt/summary 只保存 manifest 路径 + manifest sha256；
//   5. verify 侧先重算 manifest 所列物证 hash，再校验 manifest sha256——单向链无环。
//   为此 outputs 集合**强制排除**回执与 manifest 自身（拼进来即 throw，防实现者回环）。
//
// 消费点（两处，不做常驻失效 DAG）：
//   - goal-runner 截断链 preflight：上游各阶段 recompute → STALE 即拒启；
//   - verify-feature-completion：全链 recompute → 任一 STALE/missing 即非 VALID。
// ============================================================================

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import {
  loadFrameworkConfig,
  receiptDirPath,
  resolveFeatureArtifact,
  featureFilePath,
  type FeaturePathOptions,
} from '../../config';
import { inferRepoLayout } from '../../repo-layout';
import { computeGateFingerprint } from './gate-fingerprint';
import {
  REQUIRED_FEATURE_FILES_BY_PHASE,
  OPTIONAL_FEATURE_FILES_BY_PHASE,
} from './spec-loader';
import type { Phase } from './types';

export const PHASE_EVIDENCE_MANIFEST_FILENAME = 'phase-evidence-manifest.json';
export const PHASE_EVIDENCE_MANIFEST_SCHEMA_VERSION = '1.0';

/** 回执中指向 manifest 的指针键（规范化时剔除；receipt 写入侧与本表同源） */
export const RECEIPT_MANIFEST_POINTER_KEYS = [
  'evidence_manifest',
  'evidence_manifest_sha256',
  'phase_closure_fingerprint',
] as const;

export type EvidenceRole = 'input' | 'output' | 'both';

export interface EvidenceEntry {
  /** 项目根相对 POSIX 路径 */
  path: string;
  role: EvidenceRole;
  /** 文件不存在时为 null（诚实记录，不伪造） */
  sha256: string | null;
  exists: boolean;
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
  /** 规范化回执哈希；回执不存在为 null（如非 receipt 阶段） */
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
  testing: ['test-plan.md', 'test-report.md'],
};

/** spec 阶段可选产出（存在才纳入；ui-spec/use-cases 等按需产出的 artifact） */
export const PHASE_OPTIONAL_OUTPUT_FILES_BY_PHASE: Partial<Record<Phase, string[]>> = {
  spec: ['use-cases.yaml'],
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
};

/**
 * 阶段 reports 产出（receiptDir/reports 下；存在才纳入）——codex 五轮 P1：
 * collectCleanPassIssues 消费 summary.json 的 verdict，summary/verifier/trace 必须
 * 在 manifest 保护面内，否则闭环后把 FAIL 改 PASS 不触发 staleness。
 */
export const PHASE_REPORTS_OUTPUT_FILES = ['summary.json', 'verifier.report.md', 'trace.json'] as const;

export interface ResolveManifestOptions {
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

function sha256Text(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf-8').digest('hex');
}

function toPosixRel(projectRoot: string, absPath: string): string {
  return path.relative(projectRoot, absPath).split(path.sep).join('/');
}

/**
 * 回执规范化：整行剔除 manifest 指针键（含缩进的 YAML 子键形态），统一换行，
 * **并归一尾部空行**——writeReceiptManifestPointer 的空行分隔符在剔指针后会残留为
 * 尾部空行，若参与 hash 则"刚生成即 stale"（codex 六轮 P0-1 实测复现）。
 * 契约：receipt 写入侧新增指针字段必须同步进 RECEIPT_MANIFEST_POINTER_KEYS；
 * 单测用**生产 writer** 覆盖"写指针前后规范化哈希不变"。
 */
export function canonicalizeReceiptContent(content: string): string {
  const keyAlt = RECEIPT_MANIFEST_POINTER_KEYS.join('|');
  const pointerLine = new RegExp(`^\\s*(${keyAlt})\\s*:.*$`);
  const lines = content
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => !pointerLine.test(line));
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
  return lines.join('\n');
}

export function receiptPathForPhase(
  projectRoot: string,
  feature: string,
  phase: string,
  opts?: FeaturePathOptions,
): string {
  return featureFilePath(projectRoot, feature, path.join(phase, 'phase-completion-receipt.md'), opts);
}

export function computeCanonicalReceiptSha256(
  projectRoot: string,
  feature: string,
  phase: string,
  opts?: FeaturePathOptions,
): string | null {
  const p = receiptPathForPhase(projectRoot, feature, phase, opts);
  if (!fs.existsSync(p)) return null;
  return sha256Text(canonicalizeReceiptContent(fs.readFileSync(p, 'utf-8')));
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
  const nowIso = (opts.now ? opts.now() : new Date()).toISOString();

  const inputNames = [
    ...(REQUIRED_FEATURE_FILES_BY_PHASE[phase] ?? []),
    ...(OPTIONAL_FEATURE_FILES_BY_PHASE[phase] ?? []).filter((f) =>
      resolveFeatureArtifact(projectRoot, feature, f, opts.featurePathOpts).exists,
    ),
  ];
  const outputNames = [
    ...(PHASE_OUTPUT_FILES_BY_PHASE[phase] ?? []),
    ...(PHASE_OPTIONAL_OUTPUT_FILES_BY_PHASE[phase] ?? []).filter((f) =>
      resolveFeatureArtifact(projectRoot, feature, f, opts.featurePathOpts).exists,
    ),
  ];

  const entryMap = new Map<string, EvidenceEntry>();
  const addEntry = (absPath: string, role: 'input' | 'output'): void => {
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
      return;
    }
    const hash = sha256File(absPath);
    entryMap.set(rel, { path: rel, role, sha256: hash, exists: hash !== null });
  };

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
  for (const rel of PHASE_OPTIONAL_OUTPUT_RELPATHS_BY_PHASE[phase] ?? []) {
    const abs = featureFilePath(projectRoot, feature, rel, opts.featurePathOpts);
    if (fs.existsSync(abs)) addEntry(abs, 'output');
  }
  // reports 产出（summary/verifier/trace 必须在保护面内，存在才纳入）
  const reportsDir = path.join(receiptDirPath(projectRoot, feature, String(phase)), 'reports');
  for (const name of PHASE_REPORTS_OUTPUT_FILES) {
    const abs = path.join(reportsDir, name);
    if (fs.existsSync(abs)) addEntry(abs, 'output');
  }
  for (const p of opts.extraOutputs ?? []) {
    addEntry(path.isAbsolute(p) ? p : path.join(projectRoot, p), 'output');
  }

  const entries = [...entryMap.values()].sort((a, b) => a.path.localeCompare(b.path));
  const inputs = entries.filter((e) => e.role !== 'output');
  const outputs = entries.filter((e) => e.role !== 'input');

  const environment = resolveEnvironment(projectRoot, phase, opts.frameworkRoot, opts.requirementSha);
  const receiptSha = computeCanonicalReceiptSha256(projectRoot, feature, phase, opts.featurePathOpts);

  const core = { feature, phase: String(phase), inputs, outputs, environment, receipt_sha256: receiptSha };
  return {
    schema_version: PHASE_EVIDENCE_MANIFEST_SCHEMA_VERSION,
    generated_at: nowIso,
    ...core,
    aggregate_sha256: computeAggregate(core),
  };
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

/** manifest 自身的 aggregate 重算（tamper 检测：codex 五轮 P0——改 entry 保留旧
 * aggregate 会洗白 stale；aggregate 可被同步伪造，最终锚是 receipt 指针→completion，
 * 本重算拦"改条目没改 aggregate"的低成本篡改层） */
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
    && typeof o.exists === 'boolean';
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

/** 回执中记录的 manifest 指针值（evidence_manifest_sha256）——staleness 的外部锚。
 * 取**最后一次**赋值（写入侧为替换式，此处再兜一层防历史残留行）。 */
export function readReceiptManifestPointer(
  projectRoot: string,
  feature: string,
  phase: string,
  opts?: FeaturePathOptions,
): string | null {
  const p = receiptPathForPhase(projectRoot, feature, phase, opts);
  if (!fs.existsSync(p)) return null;
  const re = /^\s*evidence_manifest_sha256\s*:\s*["']?([0-9a-f]{64})["']?\s*$/gm;
  let last: string | null = null;
  let m: RegExpExecArray | null;
  const content = fs.readFileSync(p, 'utf-8');
  while ((m = re.exec(content)) !== null) last = m[1];
  return last;
}

/**
 * 封装序第 4 步：把 manifest 指针写进回执——**替换式**（先剔除既有指针行再追加），
 * 重跑 check-receipt 幂等，不产生多份陈旧指针。指针行在规范化时被剔除，
 * 写入前后回执规范化哈希不变（单测锁）。
 */
export function writeReceiptManifestPointer(
  projectRoot: string,
  feature: string,
  phase: string,
  manifestRelPath: string,
  manifestSha256: string,
  opts?: FeaturePathOptions,
): void {
  const p = receiptPathForPhase(projectRoot, feature, phase, opts);
  if (!fs.existsSync(p)) {
    throw new Error(`[phase-evidence-manifest] 回执不存在，无法写指针：${p}`);
  }
  const keyAlt = RECEIPT_MANIFEST_POINTER_KEYS.join('|');
  const pointerLine = new RegExp(`^\\s*(${keyAlt})\\s*:.*$`);
  const kept = fs
    .readFileSync(p, 'utf-8')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => !pointerLine.test(line));
  while (kept.length > 0 && kept[kept.length - 1].trim() === '') kept.pop();
  kept.push('', `evidence_manifest: "${manifestRelPath}"`, `evidence_manifest_sha256: "${manifestSha256}"`, '');
  fs.writeFileSync(p, kept.join('\n'), 'utf-8');
}

export type PhaseStalenessVerdict = 'fresh' | 'stale' | 'missing' | 'tampered';

export interface PhaseStalenessResult {
  phase: string;
  verdict: PhaseStalenessVerdict;
  /** 变更/缺失的证据路径（stale 时非空）；missing/tampered 时可为空 */
  changed_paths: string[];
  /** 规范化回执哈希失配 */
  receipt_changed: boolean;
  /** tampered/完整性问题的机器原因 */
  integrity_errors?: string[];
  /** 因上游非 fresh 被传染（自身证据可能未变） */
  propagated_from?: string;
}

/**
 * 两消费点共用的重算：逐阶段——
 *   ① manifest schema 完整性 + aggregate 重算（改条目留旧 aggregate → tampered，
 *      codex 五轮 P0）；
 *   ② 回执指针锚：回执记录的 evidence_manifest_sha256 须等于 manifest 当前文件哈希
 *      （改写 manifest 同步改 aggregate 的高成本篡改在此被回执→completion 链拴住）；
 *   ③ inputs+outputs 逐文件重算 vs 条目哈希；④ 回执规范化哈希 vs 记录值。
 * 任一非 fresh 沿 chain 传染下游。missing=无 manifest；tampered=完整性/指针断裂——
 * 消费方语义：preflight 拒启、completion verify 非 VALID；本函数只报事实不定裁决。
 */
export function recomputePhaseEvidenceStaleness(
  projectRoot: string,
  feature: string,
  chain: string[],
  opts?: { currentRequirementSha?: string | null },
): PhaseStalenessResult[] {
  const results: PhaseStalenessResult[] = [];
  let upstreamBad: string | null = null;

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
    // ② 回执指针锚：manifest 存在则回执**必须**有指针且一致——缺指针=fail-closed
    //   （codex 六轮 P0-5：null 当兼容旧现场是 fail-open；真旧现场根本没有 manifest，
    //    走上面的 'missing' 分支）。
    const pointer = readReceiptManifestPointer(projectRoot, feature, phase);
    if (pointer === null || pointer !== loaded.fileSha256) {
      results.push({
        phase,
        verdict: 'tampered',
        changed_paths: [],
        receipt_changed: false,
        integrity_errors: [
          pointer === null
            ? '回执缺 evidence_manifest_sha256 指针（manifest 存在时指针为闭环必备——缺失即证据链断裂）'
            : '回执 evidence_manifest_sha256 与 manifest 当前文件哈希失配（manifest 被整体改写）',
        ],
      });
      upstreamBad = phase;
      continue;
    }
    // ②b 环境重算（codex 六轮 P0-5：记录了却不重算=装饰）：config/workflow/gate 指纹/
    //    framework 版本任一变化 → stale（environment_changed）。
    const envNow = resolveEnvironment(projectRoot, phase);
    const envRec = loaded.manifest.environment;
    const envChanged: string[] = [];
    if (envNow.framework_config_sha256 !== envRec.framework_config_sha256) envChanged.push('framework_config');
    if (envNow.workflow_sha256 !== envRec.workflow_sha256) envChanged.push('workflow');
    if (envNow.gate_fingerprint !== envRec.gate_fingerprint) envChanged.push('gate_fingerprint');
    if (envNow.framework_version !== envRec.framework_version) envChanged.push('framework_version');
    // ②c requirement 血缘（codex 八轮 P0-2 + 九轮 P0）：当前权威 run 的规范化 requirement
    //    与本 closure 记录的不一致 → stale。**记录为 null 同样 fail-closed**（交互态闭环
    //    合法产生 null——但新 goal 从中间阶段起链时无法证明旧 closure 审的是当前需求，
    //    未绑定即 stale：`requirement_unbound`）。opts.currentRequirementSha 未提供
    //    （交互态消费）则跳过比较。
    if (opts?.currentRequirementSha != null) {
      if (envRec.requirement_sha256 == null) {
        envChanged.push('requirement_unbound');
      } else if (opts.currentRequirementSha !== envRec.requirement_sha256) {
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
    const changed: string[] = [];
    for (const entry of [...manifest.inputs, ...manifest.outputs]) {
      const current = sha256File(path.join(projectRoot, entry.path));
      if (current !== entry.sha256) changed.push(entry.path);
    }
    const currentReceipt = computeCanonicalReceiptSha256(projectRoot, feature, phase);
    const receiptChanged = currentReceipt !== manifest.receipt_sha256;
    if (changed.length > 0 || receiptChanged) {
      results.push({ phase, verdict: 'stale', changed_paths: changed, receipt_changed: receiptChanged });
      upstreamBad = phase;
    } else {
      results.push({ phase, verdict: 'fresh', changed_paths: [], receipt_changed: false });
    }
  }
  return results;
}
