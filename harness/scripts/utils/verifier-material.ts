// ============================================================================
// verifier-material.ts — verifier subject 的「审前材料视图」（plan 07a41ec6 T7 /
// openspec efficiency-first-closure「Verifier runs once per material」）
// ----------------------------------------------------------------------------
// 此前 subject 直接哈希 ai-prompt.md 字节：模板里的 {timestamp} 让每次 harness 重跑都换代，
// 宿主 2026-09-02 回归 34 次 verifier 里绝大多数审的是同一批材料。现在 subject 按
// **verifier 实际要审的材料**寻址：
//   · phase 输入/产物文件（spec-loader REQUIRED/OPTIONAL 表，经 evidence manifest 解析）；
//   · verifier 会读的上下文文件（源码 / 用例 / 图片，即 collectContextFiles 的实体文件）；
//   · phase 规则文本、prompt 模板（含 overlay）、gate 指纹；
//   · 脚本报告的 `<id>=<status>/<severity>` 投影（细节文案含时间戳/路径，不入材料）。
// 明确排除：ai-prompt.md 自身、reports/ 下的运行期产物（summary / verifier 报告 / merged-report /
// script-report）、回执；**例外**：verifier 必读的运行期证据（testing 最新真机 run 的 trace.json、
// visual-diff.json）由 runner 以路径条目送进 contextFiles，因此仍在材料内（codex review）。材料未变 → 同 subject → 既有报告直接复用；
// 材料变化后公开历史报告作为复核基线；受影响内容须独立核验，不能由旧 PASS 关闭。
// ============================================================================

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import { createRuntimeArtifactPredicate, resolvePhaseEvidenceManifest, loadPhaseEvidenceManifest, evidenceEntryMatchesCurrentFile, identityNeutralEvidenceDigest,
  PHASE_OUTPUT_FILES_BY_PHASE, PHASE_OPTIONAL_OUTPUT_FILES_BY_PHASE, PHASE_OPTIONAL_OUTPUT_RELPATHS_BY_PHASE } from './phase-evidence-manifest';
import type { ContextFileEntry, Phase } from './types';
import type { ResolvedPhaseInputs } from './capability-resolution';
import type { FactsInvocationContext } from './context-facts';
import { factsPhaseFingerprint, resolveFactsAbsPath } from './context-facts';
import { stableStringify } from './phase-evidence-manifest';
import { isInsideProjectRoot, validateProjectRelativePath } from './project-relative-path';
import { createIdentityNeutralDigestReaders, type IdentityNeutralDigestReaders } from './identity-neutral-digest';
import type { VerifierEvidence } from './verifier-evidence';
import type { PhaseRepairIssues } from './repair-candidates';
import type { ResolutionDependency } from './capability-resolution';
import * as YAML from 'yaml';
import { asRecord, blueprintAuthorContent } from './component-blueprint-model';

/** The profile supplies the native filename; a missing reader never guesses an evidence anchor. */
export function currentAcceptanceExecutionKeyMatcher(input: { projectRoot: string; frameworkRoot?: string }): (file: string) => boolean {
  try {
    const { loadFrameworkConfig } = require('../../config') as typeof import('../../config');
    const { loadResolvedProfile } = require('../../profile-loader') as typeof import('../../profile-loader');
    const profile = loadResolvedProfile(input.projectRoot, loadFrameworkConfig(input.projectRoot), input.frameworkRoot);
    if (!['.ts', '.js'].some(ext => fs.existsSync(path.join(profile.profileDir, 'harness', `execution-key${ext}`)))) return () => false;
    const { tryLoadProfileHarnessModule } = require('../../profile-host-loader') as typeof import('../../profile-host-loader');
    const filename = tryLoadProfileHarnessModule<{ EXECUTION_KEY_FILE?: string }>(profile.profileDir, 'execution-key')?.EXECUTION_KEY_FILE;
    if (typeof filename === 'string' && filename.length) return file => file.endsWith(`/ut/${filename}`);
  } catch { /* No native naming fact means no native anchor. */ }
  return () => false;
}

/** Read-only evidence selection, shared by the phase entry and the original verifier producer. */
export type CurrentAcceptanceEvidenceInput = Pick<BuildVerifierMaterialInput,
  'projectRoot' | 'feature' | 'phase' | 'frameworkRoot' | 'runId' | 'factsContext' | 'resolvedInputs'> & {
  subjectId?: string | null;
  phaseIssues?: import('./repair-candidates').PhaseRepairIssues | null;
  authorityReaders?: IdentityNeutralDigestReaders;
};

/** Actual test sources and the existing weakening check are evidence for independent judgment, not a sufficiency verdict. */
export function collectTestStrengthContext(input: CurrentAcceptanceEvidenceInput): ContextFileEntry[] {
  const out: ContextFileEntry[] = [];
  const subject = input.factsContext?.subject;
  const runId = input.runId ?? (subject && 'run_id' in subject ? subject.run_id : undefined);
  try {
    const { loadFrameworkConfig } = require('../../config') as typeof import('../../config');
    const { loadResolvedProfile } = require('../../profile-loader') as typeof import('../../profile-loader');
    const { SpecLoader } = require('./spec-loader') as typeof import('./spec-loader');
    const { implementationFiles } = require('./diff-scope') as typeof import('./diff-scope');
    const { partitionConstructionFiles, codingTestPreservation } = require('./repair-responsibility') as typeof import('./repair-responsibility');
    const { loadCoverageEvidence } = require('./coverage-evidence') as typeof import('./coverage-evidence');
    const profile = loadResolvedProfile(input.projectRoot, loadFrameworkConfig(input.projectRoot), input.frameworkRoot);
    const spec = new SpecLoader(input.projectRoot, undefined, undefined, input.frameworkRoot).loadFeatureSpec(input.feature, input.resolvedInputs);
    const contracts = spec.contracts ?? { files: [], modules: [] };
    const planned = implementationFiles(input.projectRoot, input.feature, contracts, runId);
    const coverage = loadCoverageEvidence(input.projectRoot, input.feature);
    const manifest = loadPhaseEvidenceManifest(input.projectRoot, input.feature, 'ut');
    const explicitTests = Object.values(input.resolvedInputs?.values ?? {}).flatMap(value => value.state === 'resolved'
      && value.binding.source.kind === 'derive' && value.binding.source.provider_id === 'derive.test-targets' ? value.binding.source_refs : []);
    const safeReference = (file: string): string | null => {
      try {
        const normalized = validateProjectRelativePath(input.projectRoot, file, 'test strength evidence');
        const abs = path.resolve(input.projectRoot, normalized);
        if (fs.existsSync(abs) && !isInsideProjectRoot(fs.realpathSync(input.projectRoot), fs.realpathSync(abs))) throw new Error('symlink escapes project');
        return normalized;
      } catch (error) { out.push({ label: '(test source reference gap)', content: `${file}：${(error as Error).message}` }); return null; }
    };
    const candidates = [...new Set([...planned, ...(manifest?.manifest.outputs.map(entry => entry.path) ?? []),
      ...(coverage?.feature === input.feature ? (coverage.mappings ?? []).map(mapping => mapping.evidence_ref).filter((file): file is string => !!file) : [])])];
    const safeCandidates = candidates.map(safeReference).filter((file): file is string => file !== null);
    const tests = [...new Set([...partitionConstructionFiles(input.projectRoot, profile.profileDir, { ...contracts, files: safeCandidates }).tests,
      ...explicitTests.map(safeReference).filter((file): file is string => file !== null)])];
    const applicable = [...(spec.acceptance?.criteria ?? []), ...(spec.acceptance?.boundaries ?? [])].filter(item => item.ut_layer === 'unit' || item.ut_layer === 'both');
    if (!tests.length && !applicable.length && input.resolvedInputs?.context.obligations['unit-evidence'] !== 'required') return [];
    out.push({ label: '(test strength and applicable acceptance)', content: JSON.stringify({ acceptance: applicable, mappings: coverage?.feature === input.feature ? coverage.mappings : [],
      guidance: '独立核验逐项读取真实用例、断言、失败路径与mock边界；标签/映射/工具PASS不是充分性结论。缺执行原件保留未知；设计里程碑不以尚未执行的未来测试冒充设计失败。' }, null, 2) });
    const sources = partitionConstructionFiles(input.projectRoot, profile.profileDir, { ...contracts, files: planned }).implementation;
    for (const file of [...new Set([...tests, ...sources])]) {
      const abs = path.resolve(input.projectRoot, file);
      if (!isInsideProjectRoot(input.projectRoot, abs)) continue;
      try {
        if (!isInsideProjectRoot(fs.realpathSync(input.projectRoot), fs.realpathSync(abs))) continue;
        out.push({ label: toPosixRel(input.projectRoot, abs), kind: 'path', content: 'Read当前完整源码及实际调用链；不能只凭coverage标签判充分。' });
      } catch { out.push({ label: '(test source unavailable)', content: file }); }
    }
    if (runId && tests.length) {
      const { loadLineageRunEvents } = require('./goal-run-creation') as typeof import('./goal-run-creation');
      const targets = new Set(tests);
      const writes = loadLineageRunEvents(input.projectRoot, input.feature, runId).flatMap(event => {
        if (event.type !== 'phase_write_observed' && event.type !== 'phase_write_violation') return [];
        const rows = event as unknown as { phase?: string; invoke_id?: string; owned?: Array<{ path: string }>; observations?: Array<{ path: string }>; violations?: Array<{ path: string }> };
        const owned = rows.owned?.filter(row => targets.has(row.path)) ?? [], observations = rows.observations?.filter(row => targets.has(row.path)) ?? [];
        const violations = rows.violations?.filter(row => targets.has(row.path)) ?? [];
        return owned.length || observations.length || violations.length ? [{ phase: rows.phase, invoke_id: rows.invoke_id, owned, observations, violations }] : [];
      });
      if (writes.length) out.push({ label: '(test invocation write attribution)', content: JSON.stringify(writes, null, 2) });
    }
    for (const file of tests) {
      const preservation = codingTestPreservation({ projectRoot: input.projectRoot, feature: input.feature, file, runId });
      out.push({ label: `(existing assertion evidence: ${file})`, content: JSON.stringify({ file, preserved: preservation.preserved, reason: preservation.reason }) });
      if (preservation.beforeText !== undefined) out.push({ label: `(verified pre-write test original: ${file})`, content: preservation.beforeText });
    }
    if (!tests.length) out.push({ label: '(test strength evidence gap)', content: '当前适用验收尚无可读取的绑定测试源码；不能以空映射或自写PASS关闭测试充分性。' });
  } catch (error) { out.push({ label: '(test strength evidence gap)', content: `材料暂不可读：${(error as Error).message}；保留未验证，不推断PASS。` }); }
  return out;
}

export function collectCurrentAcceptanceEvidence(input: CurrentAcceptanceEvidenceInput): ContextFileEntry[] {
  const entries = [...collectTestStrengthContext(input), ...collectNativeAcceptanceEvidence(input)];
  return entries.length ? [{ label: '(current acceptance evidence)', content: '本次材料选择已完成；下列源码与真实原件供独立核验，缺执行仍保持未知。' },
    ...new Map(entries.map(entry => [entry.label + '\0' + entry.content, entry])).values()] : [];
}

function collectNativeAcceptanceEvidence(input: CurrentAcceptanceEvidenceInput): ContextFileEntry[] {
  const { projectRoot, feature, phase } = input;
  const { featurePhaseReportsDir, featureFilePath, artifactReadCandidatePaths, loadFrameworkConfig } = require('../../config') as typeof import('../../config');
  const reports = featurePhaseReportsDir(projectRoot, feature, phase, input.frameworkRoot);
  let subject = input.subjectId;
  if (subject === undefined) {
    try { subject = JSON.parse(fs.readFileSync(path.join(reports, 'summary.json'), 'utf8')).verifier_subject_id; } catch { /* No previous subject. */ }
  }
  const material = subject ? readVerifierMaterialOrNull(reports, subject) : null;
  const factsSubject = input.factsContext?.subject;
  const runId = input.runId ?? (factsSubject && 'run_id' in factsSubject ? factsSubject.run_id : undefined);
  const { readPhaseRepairIssues, verifierSemanticChecks } = require('./repair-candidates') as typeof import('./repair-candidates');
  const issues = input.phaseIssues === undefined ? readPhaseRepairIssues(projectRoot, feature, phase,
    { frameworkRoot: input.frameworkRoot, subjectId: subject, runId }) : input.phaseIssues;
  const scopeIds = new Set((issues ? verifierSemanticChecks(issues.reportText, phase, feature) : []).flatMap(finding =>
    finding.status === 'FAIL' && ['MAJOR', 'BLOCKER'].includes(String(finding.severity)) && Array.isArray(finding.acceptance_ids)
      ? finding.acceptance_ids.filter((id): id is string => typeof id === 'string') : []));
  try {
    const { SpecLoader } = require('./spec-loader') as typeof import('./spec-loader');
    const acceptance = new SpecLoader(projectRoot, undefined, undefined, input.frameworkRoot).loadFeatureSpec(feature, input.resolvedInputs).acceptance;
    for (const item of [...(acceptance?.criteria ?? []), ...(acceptance?.boundaries ?? [])]) {
      if (item.ut_layer === 'unit' || item.ut_layer === 'both') scopeIds.add(item.id);
    }
  } catch { /* The current tool results retain missing acceptance as a verification gap. */ }
  const utReports = featurePhaseReportsDir(projectRoot, feature, 'ut', input.frameworkRoot);
  const nativePrefix = toPosixRel(projectRoot, utReports) + '/';
  const isExecutionKey = currentAcceptanceExecutionKeyMatcher(input);
  const anchors = material?.files.filter(file => file.path.startsWith(nativePrefix) && isExecutionKey(file.path)) ?? [];
  if (!scopeIds.size && !anchors.length) return [];
  const read = (file: string): ContextFileEntry | null => {
    const abs = path.resolve(projectRoot, file);
    try {
      if (!isInsideProjectRoot(projectRoot, abs) || !isInsideProjectRoot(fs.realpathSync(projectRoot), fs.realpathSync(abs))) return null;
      const content = fs.readFileSync(abs, 'utf8');
      return content.length > 64_000 ? { label: toPosixRel(projectRoot, abs), kind: 'path', content: `${fs.statSync(abs).size} bytes; read the bound original evidence at this path` }
        : { label: toPosixRel(projectRoot, abs), content };
    } catch { return null; }
  };
  let priorEntries: ContextFileEntry[] = [];
  try {
    const { loadResolvedProfile } = require('../../profile-loader') as typeof import('../../profile-loader');
    const profile = loadResolvedProfile(projectRoot, loadFrameworkConfig(projectRoot), input.frameworkRoot);
    // Native formats belong to the profile. Profiles without this reader retain ordinary unknown/verification semantics.
    if (!['.ts', '.js'].some(ext => fs.existsSync(path.join(profile.profileDir, 'harness', `execution-key${ext}`)))) return [];
    const { tryLoadProfileHarnessModule } = require('../../profile-host-loader') as typeof import('../../profile-host-loader');
    const native = tryLoadProfileHarnessModule<typeof import('../../../profiles/hmos-app/harness/execution-key')>(profile.profileDir, 'execution-key');
    if (!native?.listExecutionKeyRuns || !native.isExecutionRecordReusable || !native.utFrozenRunArtifacts || !native.utExecutionModules) return [];
    const host = tryLoadProfileHarnessModule<Pick<typeof import('../../../profiles/hmos-app/harness/ut-host-impl'),
      'utExecutionConfigFiles' | 'utAcceptanceSourcePaths' | 'currentUtExecutionInputs'>>(profile.profileDir, 'ut-host-impl');
    if (!host?.utExecutionConfigFiles || !host.utAcceptanceSourcePaths || !host.currentUtExecutionInputs) return [];
    const currentExecutionInputs = (record: import('../../../profiles/hmos-app/harness/execution-key').ExecutionKeyRecord, modules: string[]): boolean => {
      const current = host.currentUtExecutionInputs(projectRoot, modules);
      if (!current || record.inputs?.profile !== profile.name
        || native.computeExecutionKey(record.inputs) !== record.execution_key) return false;
      return current.tool_config_sha256 === record.inputs.tool_config_sha256 && JSON.stringify(current.flags) === JSON.stringify(record.inputs.flags);
    };
    const executionConfigFiles = host.utExecutionConfigFiles;
    const unavailable = (reason: string): ContextFileEntry[] => [...priorEntries,
      ...executionConfigFiles
        .map(read).filter((entry): entry is ContextFileEntry => entry !== null),
      { label: '(current acceptance evidence)', content: `旧发现的验收反证当前不可复用：${reason}。以上冻结件仅为历史依据，由原独立 verifier 核对具体缺口；不据此宣称验收已满足。` }];
    let unavailableReason: string | undefined;
    const fallback = (): ContextFileEntry[] => unavailableReason ? unavailable(unavailableReason) : priorEntries;
    const latest = native.listExecutionKeyRuns(utReports, 'ut')[0];
    const ownedArtifacts = new Set([
      ...[...PHASE_OUTPUT_FILES_BY_PHASE[phase as Phase] ?? [], ...PHASE_OPTIONAL_OUTPUT_FILES_BY_PHASE[phase as Phase] ?? []]
        .flatMap(name => artifactReadCandidatePaths(projectRoot, feature, name)).map(file => toPosixRel(projectRoot, file)),
      ...(PHASE_OPTIONAL_OUTPUT_RELPATHS_BY_PHASE[phase as Phase] ?? []).map(file => toPosixRel(projectRoot, featureFilePath(projectRoot, feature, file))),
    ]);
    const anchoredSourcePaths = new Set(host.utAcceptanceSourcePaths(material?.files.map(file => file.path) ?? []));
    const anchoredSources = material?.files.filter(file => anchoredSourcePaths.has(file.path) && !file.path.startsWith(nativePrefix)
      || ownedArtifacts.has(file.path) || executionConfigFiles.includes(file.path)) ?? [];
    // Closing the finding must not remove its counterevidence or bind a later routine test run into the plan.
    for (const anchor of anchors) {
      const recordFile = read(anchor.path);
      priorEntries = [...anchoredSources.map(file => file.path), ...material!.files.filter(file =>
        file.path.startsWith(path.posix.dirname(anchor.path) + '/')).map(file => file.path)]
        .map(read).filter((entry): entry is ContextFileEntry => entry !== null);
      if (!recordFile || sha256FileOrNull(path.resolve(projectRoot, anchor.path)) !== anchor.sha256) { unavailableReason = '原材料绑定的执行键缺失或字节变化'; continue; }
      let record: import('../../../profiles/hmos-app/harness/execution-key').ExecutionKeyRecord;
      try { record = JSON.parse(recordFile.content); if (!Array.isArray(record.frozen_files)) throw new Error('invalid frozen files'); }
      catch { unavailableReason = '原材料绑定的执行键不可解析'; continue; }
      const modules = native.utExecutionModules(record);
      const frozenPaths = (record.frozen_files ?? []).map((name: string) => path.posix.join(path.posix.dirname(anchor.path), name));
      if (!frozenPaths.every((file: string) => material?.files.some(entry => entry.path === file
        && entry.sha256 === sha256FileOrNull(path.resolve(projectRoot, file))))) { unavailableReason = '原材料绑定的冻结执行原件缺失或字节变化'; continue; }
      if (!currentExecutionInputs(record, modules)) { unavailableReason = '原执行键的当前配置、工具链或执行 flags 已变化或无法确认'; continue; }
      if (!modules.length || !native.isExecutionRecordReusable(record, path.dirname(path.resolve(projectRoot, anchor.path)),
        { executionKey: record.execution_key, artifacts: native.utFrozenRunArtifacts(modules) }).ok) continue;
      priorEntries = [...anchoredSources.map(file => file.path), anchor.path,
        ...record.frozen_files.map((name: string) => path.posix.join(path.posix.dirname(anchor.path), name))].map(read).filter((entry): entry is ContextFileEntry => entry !== null);
      if (latest && latest.record.execution_key === record.execution_key && latest.record.outcome === 'failed') {
        priorEntries.push(...[native.EXECUTION_KEY_FILE, ...(latest.record.frozen_files ?? [])]
          .map(name => read(toPosixRel(projectRoot, path.join(latest.runDir, name))))
          .filter((entry): entry is ContextFileEntry => entry !== null));
        break;
      }
      if (anchoredSources.every(file => verifierMaterialFileMatchesCurrent({ projectRoot, feature, material: material!, file: file.path, authorityReaders: input.authorityReaders }))) {
        const paths = [...anchoredSources.map(file => file.path), anchor.path,
          ...record.frozen_files.map((name: string) => path.posix.join(path.posix.dirname(anchor.path), name))];
        const entries = paths.map(read);
        if (entries.every((entry): entry is ContextFileEntry => entry !== null)) return entries;
      }
    }
    if (!latest) return fallback();
    const manifest = loadPhaseEvidenceManifest(projectRoot, feature, 'ut');
    if (!manifest?.integrityOk) return fallback();
    const bound = [...manifest.manifest.inputs, ...manifest.manifest.outputs];
    const { loadCoverageEvidence } = require('./coverage-evidence') as typeof import('./coverage-evidence');
    const coverage = loadCoverageEvidence(projectRoot, feature);
    const tests = scopeIds.size ? coverage?.feature === feature ? [...new Set((coverage.mappings ?? [])
      .filter(mapping => scopeIds.has(mapping.scope_id) && mapping.evidence_source === 'ut_tags')
      .map(mapping => mapping.evidence_ref).filter((file): file is string => !!file))] : []
      : manifest.manifest.outputs.filter(entry => entry.owner_phase === 'ut' && anchoredSources.some(file => file.path === entry.path)).map(entry => entry.path);
    if (!tests.length) return fallback();
    if (tests.some(file => !bound.some(entry => entry.path === file && evidenceEntryMatchesCurrentFile(projectRoot, entry, feature, input.authorityReaders)))) return fallback();
    const modules = native.utExecutionModules(latest.record);
    if (!currentExecutionInputs(latest.record, modules)) return anchors.length ? unavailable(unavailableReason ?? '当前执行输入未覆盖旧冻结证据') : [];
    if (!modules.length || !native.isExecutionRecordReusable(latest.record, latest.runDir,
      { executionKey: latest.record.execution_key, artifacts: native.utFrozenRunArtifacts(modules) }).ok) return fallback();
    // Include the actual assertions and bound production call chain; a tag or success label is only a locator.
    const sourcePaths = new Set(host.utAcceptanceSourcePaths(bound.map(entry => entry.path), tests));
    const sourceEntries = bound.filter(entry => sourcePaths.has(entry.path));
    if (!sourceEntries.length || sourceEntries.some(entry => !evidenceEntryMatchesCurrentFile(projectRoot, entry, feature, input.authorityReaders))) return fallback();
    const paths = [...anchoredSources.filter(entry => ownedArtifacts.has(entry.path) || executionConfigFiles.includes(entry.path)).map(entry => entry.path),
      ...sourceEntries.map(entry => entry.path), toPosixRel(projectRoot, path.join(latest.runDir, native.EXECUTION_KEY_FILE)),
      ...(latest.record.frozen_files ?? []).map(name => toPosixRel(projectRoot, path.join(latest.runDir, name)))];
    const entries = [...new Set(paths)].map(read);
    return entries.every((entry): entry is ContextFileEntry => entry !== null) ? entries : fallback();
  } catch { return priorEntries; }
}

export const VERIFIER_MATERIAL_SCHEMA = 'maison-verifier-material@2';

export interface VerifierMaterialFile {
  /** 仓根相对 posix 路径 */
  path: string;
  /** 按 material.schema 的业务/身份中立投影计算摘要；普通文件用原字节，不存在为 null。 */
  sha256: string | null;
}

export interface VerifierMaterialView {
  schema: string;
  feature: string;
  phase: string;
  gate_fingerprint: string | null;
  phase_rule_sha256: string;
  template_sha256: string;
  /** 脚本报告投影：`<id>=<status>/<severity>`，排序 */
  script_checks: string[];
  /** lifecycle hook fragments（装配进 prompt 的实例/profile 片段）哈希；无片段为空串 */
  lifecycle_sha256: string;
  /** 实例扩展输入（manifest 1.1 knowledge 索引 / 阶段绑定 / mcp usage，装配进 prompt 尾部）哈希；无则空串 */
  extension_sha256: string;
  /**
   * 目标简报（plan 33784ed1 §3.4，装配进 prompt 尾部的渲染文本）哈希；无简报为空串。
   * 空串时不进 computeMaterialSha256——material_sha256 与引入本分量之前逐字节相同。
   */
  goal_brief_sha256?: string;
  /** 按路径排序的材料文件 */
  files: VerifierMaterialFile[];
  material_sha256: string;
  input_bindings_sha256?: string;
}

function sha256Text(text: string): string {
  return crypto.createHash('sha256').update(text.replace(/\r\n/g, '\n'), 'utf-8').digest('hex');
}

function sha256FileOrNull(abs: string): string | null {
  try {
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;
    return crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
  } catch {
    return null;
  }
}

/** One versioned file projection for both material production and consumption. */
export function verifierMaterialFileHash(input: { projectRoot: string; feature: string; file: string; phase?: string; factsContext?: FactsInvocationContext;
  schema?: string; authorityReaders?: IdentityNeutralDigestReaders }): string | null {
  const abs = path.resolve(input.projectRoot, input.file);
  if (input.phase) {
    const manifest = input.factsContext ? undefined : loadPhaseEvidenceManifest(input.projectRoot, input.feature, input.phase);
    const facts = input.factsContext ? path.resolve(resolveFactsAbsPath(input.projectRoot, input.feature, input.factsContext)) === abs
      : manifest?.integrityOk && [...manifest.manifest.inputs, ...manifest.manifest.outputs].some(entry =>
        entry.facts_phase === input.phase && path.resolve(input.projectRoot, entry.path) === abs);
    if (facts) {
      try { return factsPhaseFingerprint(fs.readFileSync(abs, 'utf8'), input.phase); }
      catch { return null; }
    }
  }
  if ((input.schema ?? VERIFIER_MATERIAL_SCHEMA) === VERIFIER_MATERIAL_SCHEMA && /\.(?:ya?ml|json)$/i.test(abs)) try {
    const value = asRecord(YAML.parse(fs.readFileSync(abs, 'utf8')));
    if (value?.artifact === 'component-blueprint@1') {
      const scoped = identityNeutralEvidenceDigest(input.projectRoot, input.feature, abs, input.authorityReaders);
      return scoped === undefined ? sha256Text(stableStringify(blueprintAuthorContent(value, true))) : scoped;
    }
    if (value?.feature === input.feature && typeof value.run_id === 'string' && typeof value.report_dir === 'string') {
      const { loadGoalRunManifestFromRun, computeManifestIdentityFields } = require('./goal-manifest') as typeof import('./goal-manifest');
      const manifest = loadGoalRunManifestFromRun(input.projectRoot, value.run_id, { feature: input.feature });
      const canonical = path.resolve(input.projectRoot, manifest.report_dir, 'manifest.json');
      if (canonical === abs) {
        const { loadAuthoritativeEvents } = require('./goal-runner-phase') as typeof import('./goal-runner-phase');
        const events = loadAuthoritativeEvents(path.join(path.dirname(canonical), 'events.jsonl'));
        if (events.some(event => event.type === 'run_created' || event.type === 'run_start')) {
          const identity = computeManifestIdentityFields(manifest);
          delete identity.budget; // Resource control still uses the full identity; it is not review material.
          return sha256Text(stableStringify(identity));
        }
      }
    }
  } catch { /* Original loaders diagnose invalid content; an unreadable file remains absent below. */ }
  return identityNeutralEvidenceDigest(input.projectRoot, input.feature, abs, input.authorityReaders) ?? sha256FileOrNull(abs);
}

/** Old @2 blueprint entries used the whole author view; unchanged content is still a proof. */
function unchangedLegacyBlueprintMaterial(projectRoot: string, file: string, recorded: string | null): boolean {
  if (!recorded) return false;
  try {
    const value = asRecord(YAML.parse(fs.readFileSync(path.resolve(projectRoot, file), 'utf8')));
    return value?.artifact === 'component-blueprint@1'
      && sha256Text(stableStringify(blueprintAuthorContent(value, true))) === recorded;
  } catch { return false; }
}

export function verifierMaterialFileMatchesCurrent(input: { projectRoot: string; feature: string; material: VerifierMaterialView; file: string; authorityReaders?: IdentityNeutralDigestReaders }): boolean {
  const recorded = input.material.files.find(file => file.path === input.file);
  // @1 explicitly stored raw context/diagnosis originals beside manifest projections.
  // Exact original bytes are a historical compatibility proof; @2 never chooses this recipe.
  if (recorded && input.material.schema === 'maison-verifier-material@1'
    && sha256FileOrNull(path.resolve(input.projectRoot, input.file)) === recorded.sha256) return true;
  return !!recorded && (verifierMaterialFileHash({ ...input, phase: input.material.phase, schema: input.material.schema }) === recorded.sha256
    || input.material.schema === VERIFIER_MATERIAL_SCHEMA && unchangedLegacyBlueprintMaterial(input.projectRoot, input.file, recorded.sha256));
}

function toPosixRel(root: string, abs: string): string {
  return path.relative(root, abs).replace(/\\/g, '/');
}

/** 材料指纹：字段顺序固定，不依赖 JSON 键序。 */
export function computeMaterialSha256(view: Omit<VerifierMaterialView, 'material_sha256'>): string {
  return sha256Text(
    [
      view.schema,
      `feature=${view.feature}`,
      `phase=${view.phase}`,
      `gate_fingerprint=${view.gate_fingerprint ?? '<absent>'}`,
      `phase_rule_sha256=${view.phase_rule_sha256}`,
      `template_sha256=${view.template_sha256}`,
      `lifecycle_sha256=${view.lifecycle_sha256 ?? ''}`,
      `extension_sha256=${view.extension_sha256 ?? ''}`,
      ...(view.input_bindings_sha256 ? [`input_bindings_sha256=${view.input_bindings_sha256}`] : []),
      ...(view.goal_brief_sha256 ? [`goal_brief_sha256=${view.goal_brief_sha256}`] : []),
      ...view.script_checks.map(c => `check=${c}`),
      ...view.files.map(f => `file=${f.path} sha256=${f.sha256 ?? '<absent>'}`),
    ].join('\n'),
  );
}

export interface BuildVerifierMaterialInput {
  /** Existing invocation identity, read-only context; not a material/request field. */
  runId?: string;
  deviceTestEvidence?: { trace_path?: unknown };
  resolvedInputs?: ResolvedPhaseInputs;
  factsContext?: FactsInvocationContext;
  projectRoot: string;
  feature: string;
  phase: string;
  frameworkRoot?: string;
  gateFingerprint: string | null;
  /** 装配进 prompt 的 phase 规则文本（YAML.stringify(phaseRule)） */
  phaseRuleText: string;
  /** 装配所用模板文本（含 profile overlay） */
  templateText: string;
  checks: ReadonlyArray<{ id: string; status: string; severity: string; details?: string; affected_files?: readonly string[] }>;
  contextFiles: ReadonlyArray<ContextFileEntry>;
  /** 装配进 prompt 的 lifecycle hook fragments（实例 / profile / framework） */
  lifecycleFragments?: ReadonlyArray<string>;
  /** 装配进 prompt 尾部的实例扩展输入（formatExtensionPhasePrompt 输出） */
  extensionInstructions?: string;
  /** 装配进 prompt 尾部的目标简报渲染文本（renderGoalBrief 输出） */
  goalBriefText?: string;
}

function legacyInputBindingsSha256(inputs: ResolvedPhaseInputs): string {
  return sha256Text(stableStringify(Object.entries(inputs.values).map(([id, value]) => [id, value.state === 'resolved' ? value.binding : value])));
}

/** The selected semantic value and real dependency identities are the binding, not an incidental raw YAML envelope. */
function reviewInputBindingsSha256(projectRoot: string, inputs: ResolvedPhaseInputs): string {
  const relative = (file: string): string => {
    const abs = path.resolve(projectRoot, file);
    return isInsideProjectRoot(projectRoot, abs) ? toPosixRel(projectRoot, abs) : file;
  };
  return sha256Text(stableStringify(Object.entries(inputs.values).sort(([a], [b]) => a.localeCompare(b)).map(([id, value]) => {
    if (value.state !== 'resolved') return [id, { state: value.state, sources: value.attempts.map(attempt => ({ kind: attempt.kind, source: attempt.source,
      state: attempt.state, dependencies: attempt.dependencies.map(dependency => ({ path: relative(dependency.path), exists: dependency.exists, role: dependency.role })) })) }];
    const blueprint = asRecord(value.value);
    return [id, { state: value.state, input_id: value.binding.input_id, source: value.binding.source,
      content_fingerprint: blueprint?.artifact === 'component-blueprint@1'
        ? sha256Text(stableStringify(blueprintAuthorContent(blueprint, true))) : value.binding.content_fingerprint,
      source_refs: value.binding.source_refs.map(relative).sort(),
      dependencies: value.binding.dependencies.map(dependency => ({ path: relative(dependency.path), exists: dependency.exists, role: dependency.role }))
        .sort((a, b) => a.path.localeCompare(b.path) || a.role.localeCompare(b.role)) }];
  })));
}

/** The independent strength judgment covers the complete comparison and actual pre-write facts, not just current bytes. */
function testStrengthFactSha256(input: BuildVerifierMaterialInput, check: BuildVerifierMaterialInput['checks'][number]): string | null {
  if (check.id !== 'coding_existing_test_preserved' || !check.affected_files?.length) return null;
  const { codingTestPreservation } = require('./repair-responsibility') as typeof import('./repair-responsibility');
  const subject = input.factsContext?.subject;
  const runId = input.runId ?? (subject && 'run_id' in subject ? subject.run_id : undefined);
  const files = [...new Set(check.affected_files)].sort();
  const originals = files.map(file => {
    const original = codingTestPreservation({ projectRoot: input.projectRoot, feature: input.feature, runId, file });
    return { file, preserved: original.preserved, reason: original.reason,
      before_sha256: original.beforeText === undefined ? null : sha256Text(original.beforeText) };
  });
  const writes = new Set<string>();
  if (runId) {
    const { loadLineageRunEvents } = require('./goal-run-creation') as typeof import('./goal-run-creation');
    for (const event of loadLineageRunEvents(input.projectRoot, input.feature, runId)) {
      if (event.type !== 'phase_write_observed' && event.type !== 'phase_write_violation') continue;
      const facts = event as unknown as { owned?: Array<{ path: string; how?: unknown; pre_sha256?: unknown; post_sha256?: unknown }>;
        observations?: Array<{ path: string; how?: unknown; pre_sha256?: unknown; post_sha256?: unknown }>;
        violations?: Array<{ path: string; how?: unknown; pre_sha256?: unknown; post_sha256?: unknown }> };
      for (const kind of ['owned', 'observations', 'violations'] as const) for (const row of facts[kind] ?? []) {
        if (files.includes(row.path)) writes.add(stableStringify({ producer: event.phase, kind, path: row.path, how: row.how,
          pre_sha256: row.pre_sha256 ?? null, post_sha256: row.post_sha256 ?? null }));
      }
    }
  }
  return sha256Text(stableStringify({ details: check.details ?? '', files, originals, writes: [...writes].sort() }));
}

export function buildVerifierMaterialView(input: BuildVerifierMaterialInput): VerifierMaterialView {
  const { projectRoot, feature, phase } = input;
  const files = new Map<string, string | null>();
  const authorityReaders = createIdentityNeutralDigestReaders();
  // 排除规则与 `phaseEvidenceManifestCandidatePaths`（沿用判据的"属不属 manifest 面"判定）
  // 共用同一个谓词——两边分叉会让自定义 reports_dir_pattern 下的沿用判据恒失配（codex 三轮 medium）。
  const isRuntimeArtifact = createRuntimeArtifactPredicate({ projectRoot, feature, phase, frameworkRoot: input.frameworkRoot });

  try {
    const manifest = resolvePhaseEvidenceManifest({
      resolvedInputs: input.resolvedInputs,
      factsContext: input.factsContext,
      projectRoot,
      feature,
      phase: phase as Phase,
      frameworkRoot: input.frameworkRoot,
      deviceTestEvidence: input.deviceTestEvidence,
    });
    for (const entry of [...manifest.inputs, ...manifest.outputs]) {
      if (isRuntimeArtifact(entry.path)) continue;
      files.set(entry.path, verifierMaterialFileHash({ projectRoot, feature, phase, factsContext: input.factsContext, file: entry.path, authorityReaders }));
    }
  } catch (error) {
    if (input.resolvedInputs) throw error;
    /* manifest 解析失败（无 frameworkRoot 等）→ 只按上下文文件寻址 */
  }

  const isExecutionKey = currentAcceptanceExecutionKeyMatcher(input);
  const acceptanceEvidence = input.contextFiles.some(file => isExecutionKey(file.label) || file.label === '(current acceptance evidence)')
    ? [] : collectCurrentAcceptanceEvidence(input);
  for (const cf of [...input.contextFiles, ...acceptanceEvidence]) {
    const abs = cf.imagePath
      ? cf.imagePath
      : cf.label && !cf.label.startsWith('(') && !path.isAbsolute(cf.label)
        ? path.join(projectRoot, cf.label)
        : null;
    if (!abs) continue;
    const rel = toPosixRel(projectRoot, abs);
    // contextFiles 是 verifier 实际读取面：显式送进来的运行期证据（trace / visual-diff）不受 reports/ 排除规则限制
    if (files.has(rel)) continue;
    const sha = verifierMaterialFileHash({ projectRoot, feature, phase, factsContext: input.factsContext, file: rel, authorityReaders });
    if (sha !== null) files.set(rel, sha);
  }

  // Diagnosis reads the proposal's concrete text, which may exceed the CU-neutral consumption view.
  if (phase === 'coding' || phase === 'ut') {
    const { readPhaseRepairIssues } = require('./repair-candidates') as typeof import('./repair-candidates');
    const diagnosis = readPhaseRepairIssues(projectRoot, feature, phase);
    if (diagnosis?.rows.length) for (const file of [diagnosis.reportPath, ...diagnosis.evidenceFiles.map(entry => entry.label)]) {
      const sha = verifierMaterialFileHash({ projectRoot, feature, phase, factsContext: input.factsContext, file, authorityReaders });
      if (sha !== null) files.set(file, sha);
    }
  }

  const base = {
    schema: VERIFIER_MATERIAL_SCHEMA,
    ...(input.resolvedInputs ? { input_bindings_sha256: reviewInputBindingsSha256(projectRoot, input.resolvedInputs) } : {}),
    feature,
    phase,
    gate_fingerprint: input.gateFingerprint,
    phase_rule_sha256: sha256Text(input.phaseRuleText),
    template_sha256: sha256Text(input.templateText),
    lifecycle_sha256: input.lifecycleFragments && input.lifecycleFragments.length > 0 ? sha256Text(input.lifecycleFragments.join('\n---\n')) : '',
    extension_sha256: input.extensionInstructions ? sha256Text(input.extensionInstructions) : '',
    goal_brief_sha256: input.goalBriefText ? sha256Text(input.goalBriefText) : '',
    script_checks: input.checks.map(c => {
      const strength = testStrengthFactSha256(input, c);
      return `${c.id}=${c.status}/${c.severity}${strength ? ` facts=${strength}` : ''}`;
    }).sort(),
    files: [...files.entries()].map(([p, sha256]) => ({ path: p, sha256 })).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
  };
  return { ...base, material_sha256: computeMaterialSha256(base) };
}

/** 材料视图按 subject 分区落盘（与 request / report 同目录）。 */
export function verifierMaterialFilename(subjectId: string): string {
  if (!/^[0-9a-f]{64}$/.test(subjectId)) {
    throw new Error(`[verifier-material] 非法 subject id：${JSON.stringify(subjectId)}`);
  }
  return `verifier.material.${subjectId}.json`;
}

export function writeVerifierMaterial(reportsDir: string, subjectId: string, view: VerifierMaterialView): string {
  const abs = path.join(reportsDir, verifierMaterialFilename(subjectId));
  fs.mkdirSync(reportsDir, { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(view, null, 2)}\n`, 'utf-8');
  return abs;
}

export function readVerifierMaterialOrNull(reportsDir: string, subjectId: string): VerifierMaterialView | null {
  try {
    const abs = path.join(reportsDir, verifierMaterialFilename(subjectId));
    if (!fs.existsSync(abs)) return null;
    const parsed = JSON.parse(fs.readFileSync(abs, 'utf-8')) as VerifierMaterialView;
    return parsed && [VERIFIER_MATERIAL_SCHEMA, 'maison-verifier-material@1'].includes(parsed.schema)
      && typeof parsed.feature === 'string' && typeof parsed.phase === 'string'
      && typeof parsed.phase_rule_sha256 === 'string' && typeof parsed.template_sha256 === 'string'
      && /^[0-9a-f]{64}$/.test(parsed.material_sha256)
      && Array.isArray(parsed.script_checks) && parsed.script_checks.every(check => typeof check === 'string')
      && Array.isArray(parsed.files) && parsed.files.every(file => file && typeof file.path === 'string'
        && (file.sha256 === null || /^[0-9a-f]{64}$/.test(file.sha256))) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * 两份材料视图的差异（人读列表，写进 summary.verifier_closure.current_material_not_reverified）。
 * 上一份缺失时无法逐项对账，如实写「(prior material manifest unavailable)」。
 */
export function diffVerifierMaterial(prev: VerifierMaterialView | null, curr: VerifierMaterialView | null): string[] {
  if (!prev || !curr) return ['(prior material manifest unavailable)'];
  const out: string[] = [];
  if (prev.schema !== curr.schema) out.push('review_material_schema');
  if (prev.gate_fingerprint !== curr.gate_fingerprint) out.push('gate_fingerprint');
  if (prev.phase_rule_sha256 !== curr.phase_rule_sha256) out.push('phase_rules');
  if (prev.template_sha256 !== curr.template_sha256) out.push('verifier_prompt_template');
  if ((prev.lifecycle_sha256 ?? '') !== (curr.lifecycle_sha256 ?? '')) out.push('lifecycle_hook_fragments');
  if ((prev.extension_sha256 ?? '') !== (curr.extension_sha256 ?? '')) out.push('extension_instructions');
  if ((prev.goal_brief_sha256 ?? '') !== (curr.goal_brief_sha256 ?? '')) out.push('goal_brief');
  if ((prev.input_bindings_sha256 ?? '') !== (curr.input_bindings_sha256 ?? '')) out.push('input_bindings');
  if (prev.script_checks.join('\n') !== curr.script_checks.join('\n')) out.push('script_report_checks');
  const prevFiles = new Map(prev.files.map(f => [f.path, f.sha256]));
  const currFiles = new Map(curr.files.map(f => [f.path, f.sha256]));
  for (const [p, sha] of currFiles) {
    if (!prevFiles.has(p)) out.push(`+${p}`);
    else if (prevFiles.get(p) !== sha) out.push(p);
  }
  for (const p of prevFiles.keys()) if (!currFiles.has(p)) out.push(`-${p}`);
  return out;
}

/** A format migration is reusable only where the old binding still proves the same current bytes/content. */
export function verifierMaterialsEquivalent(previous: VerifierMaterialView | null, current: VerifierMaterialView | null, projectRoot?: string, resolvedInputs?: ResolvedPhaseInputs): boolean {
  if (!previous || !current || previous.feature !== current.feature || previous.phase !== current.phase) return false;
  let previousBindings = previous.input_bindings_sha256;
  if (previousBindings !== current.input_bindings_sha256 && projectRoot && resolvedInputs
    && previous.schema === 'maison-verifier-material@1' && current.schema === VERIFIER_MATERIAL_SCHEMA
    && previousBindings === legacyInputBindingsSha256(resolvedInputs)
    && current.input_bindings_sha256 === reviewInputBindingsSha256(projectRoot, resolvedInputs)) previousBindings = current.input_bindings_sha256;
  if (diffVerifierMaterial({ ...previous, schema: current.schema, input_bindings_sha256: previousBindings, files: [] }, { ...current, files: [] }).length) return false;
  const oldFiles = new Map(previous.files.map(file => [file.path, file.sha256]));
  if (oldFiles.size !== current.files.length) return false;
  return current.files.every(file => {
    if (!oldFiles.has(file.path)) return false;
    const before = oldFiles.get(file.path);
    if (before === file.sha256) return true;
    if (!projectRoot || current.schema !== VERIFIER_MATERIAL_SCHEMA || !before) return false;
    const abs = path.resolve(projectRoot, file.path);
    const unchanged = previous.schema === 'maison-verifier-material@1' ? sha256FileOrNull(abs) === before
      : previous.schema === VERIFIER_MATERIAL_SCHEMA && unchangedLegacyBlueprintMaterial(projectRoot, file.path, before);
    return isInsideProjectRoot(projectRoot, abs) && unchanged
      && verifierMaterialFileHash({ projectRoot, feature: current.feature, phase: current.phase, file: file.path, schema: current.schema }) === file.sha256;
  });
}

/** Public review context is a prompt supplement, never another material manifest or completion verdict. */
export function independentVerificationContext(input: {
  previousReport?: VerifierEvidence | null;
  previousMaterial?: VerifierMaterialView | null;
  currentMaterial?: VerifierMaterialView | null;
  /** A real public Q original, when Q has P1 before.yaml/pre_snapshot instead of a verifier material manifest. */
  previousOriginal?: ContextFileEntry | null;
  actualDiff: readonly ContextFileEntry[] | null;
  openFindings?: PhaseRepairIssues | null;
  affectedDependencies?: readonly ResolutionDependency[];
  currentEvidence?: readonly ContextFileEntry[];
  declineContext?: readonly ContextFileEntry[];
  testStrengthCheck?: { id: string; details?: string; affected_files?: readonly string[] };
}): ContextFileEntry[] {
  const verifierBaseline = !!input.previousReport && !!input.previousMaterial && !!input.currentMaterial
    && input.previousReport.feature === input.currentMaterial.feature && input.previousReport.phase === input.currentMaterial.phase
    && input.previousMaterial.feature === input.currentMaterial.feature && input.previousMaterial.phase === input.currentMaterial.phase;
  const completeBaseline = input.actualDiff !== null && (verifierBaseline || !input.previousReport && !!input.previousOriginal);
  const out: ContextFileEntry[] = [{ label: '(independent verification scope)', content: completeBaseline
    ? '本次按公开前次原件及真实材料变化增量复核。逐项保留无关的有效结论，重评受影响的验收、契约、依赖和发现；作者摘要不是变更范围依据。'
    : '缺可信前次公开报告、材料或真实差异原件；本次完整核验当前适用材料，明确缺口。不得用作者摘要或 HEAD 冒充上次真实字节。' }];
  if (input.previousReport) out.push({ label: input.previousReport.md_path_rel, kind: 'path', content:
    `上轮公开核验原件，subject=${input.previousReport.subject_id}，verdict=${input.previousReport.verdict}。Read完整正文与尚未关闭的问题；历史PASS不是当前受影响材料已通过的证明。` });
  if (input.previousOriginal) out.push(input.previousOriginal);
  if (input.previousMaterial && input.currentMaterial) out.push({ label: '(actual material changes)', content: diffVerifierMaterial(input.previousMaterial, input.currentMaterial).join('\n') || '审查材料未变；复用当前subject的有效结果，FAIL仍是FAIL，不因重复读取产生新的评估。' });
  if (input.openFindings) {
    out.push({ label: '(open verification findings)', content: JSON.stringify(input.openFindings.rows, null, 2) });
    out.push(...input.openFindings.evidenceFiles);
    if (input.openFindings.diagnostics?.length) out.push({ label: '(verification reference gaps)', content: input.openFindings.diagnostics.join('\n') });
  }
  if (input.affectedDependencies?.length) out.push({ label: '(affected contract dependencies)', content: JSON.stringify(input.affectedDependencies, null, 2) });
  out.push(...(input.actualDiff ?? []), ...(input.currentEvidence ?? []), ...(input.declineContext ?? []));
  out.push({ label: '(independent acceptance and refusal review)', content:
    '核验验收→用例→真实断言、失败路径及mock与产品真值的关系。来源/覆盖标签和工具绿灯不证明断言充分。对结构化拒修逐项核原依据与反证，以原issue-verification返回confirmed/refuted/unclear；拒修本身不关闭问题。正文中的实质否定不能被总结PASS覆盖。' });
  if (input.testStrengthCheck?.affected_files?.length) out.push({ label: '(current test strength verification)', content: JSON.stringify(input.testStrengthCheck, null, 2)
    + '\n在原issue-verification块以issue=coding_existing_test_preserved返回逐项裁决，evidence须包含全部当前文件与完整原details（可用YAML block scalar保留多行）。confirmed表示当前删弱/跳过致原验收不足；refuted表示已核实合理加强或真实重签后的期望且覆盖充分，不否认原文本差异；unclear/缺原件保留未知。即使文本原样保留，也须核外部fixture/data/mock是否弱化真值。' });
  return out;
}
