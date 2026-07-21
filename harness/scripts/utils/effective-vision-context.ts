// ============================================================================
// effective-vision-context.ts — 视觉真值三轴唯一解析器
// （visual-capability-truth S3 / P0-A；openspec vision-capability-truth spec）
// ----------------------------------------------------------------------------
// 三轴分算 + fail-closed meet（codex plan 审查四轮 P0）：能力、产物证明、有效策略是
// 三个维度，不得用单一优先级链互相覆盖——invocation_bound 只能提升 visionCapability，
// 不能解除 artifact 级 contradicted/unverified 限制，也不能解除 policy 降级。
// 降级解除仅两途：runner 显式 supersede（append-only 事件行）；或**绑定同一产物新
// hash** 的 verified attestation。
//
// 消费纪律（spec）：prompt 注入 / spec·coding·testing 各 gate / 盲档 kit 派生 /
// fidelity 判定一律经 resolveEffectiveVisionContext；禁止直读 framework.local.json
// vision 节或 ui-spec.verified 自行判级。
//
// 存储（runner/框架代码写，agent 不写）：
//   <featureDir>/vision/capability-receipt.json      invocation_bound 签发（runner）
//   <featureDir>/vision/artifact-attestations.jsonl  逐产物 attestation（append-only）
//   <featureDir>/vision/policy-downgrades.jsonl      降级/解除事件（append-only）
// ============================================================================

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { featureDir, loadFrameworkConfig } from '../../config';
import { inferRepoLayout } from '../../repo-layout';
import { computeGateFingerprint } from './gate-fingerprint';
import { loadSpecMarkdown, refElementsAbsPath } from './fidelity-shared';
import { loadLocalConfig } from './framework-local-config';
import {
  collectAuthoritativeImagePaths,
  isVisionCanaryFresh,
  probeAdapterImageInput,
} from './multimodal-probe';

export type VisionCapabilityVerdict = 'tool_read' | 'native' | 'none' | 'unknown';
export type VisionCapabilityScope = 'adapter_declared' | 'run_probed' | 'invocation_bound';
export type ArtifactAttestationVerdict = 'verified' | 'contradicted' | 'unverified';

export interface VisionCapabilityAxis {
  verdict: VisionCapabilityVerdict;
  scope: VisionCapabilityScope;
  evidence: {
    canary_probed_at?: string;
    canary_run_id?: string;
    binding_path?: 'route_equality' | 'inline_canary';
    reason: string;
  };
}

export interface ArtifactAttestationRecord {
  schema_version: '1.0';
  at: string;
  artifact_path: string;
  artifact_hash: string;
  verdict: ArtifactAttestationVerdict;
  /** evidence_gap 归 unverified，reasons 前缀 `evidence_gap:` 区分「缺证」与「未验」 */
  reasons: string[];
  source: string;
  gate_fingerprint?: string;
  invoke_id?: string;
  /** 三轮 review P0-3：verified 铸造的全链绑定（run/invoke/参考图 hash/ref-elements hash/门禁指纹） */
  binding?: {
    run_id: string;
    invoke_id: string;
    ref_elements_sha256: string | null;
    refs: Array<{ path: string; sha256: string }>;
    gate_fingerprint: string | null;
  };
}

export interface PolicyDowngradeRecord {
  schema_version: '1.0';
  at: string;
  kind: 'downgrade' | 'supersede';
  reason: string;
  artifact_path?: string;
  artifact_hash?: string;
  /** supersede 行：被解除的 downgrade 的 at（显式指名；缺省=按 artifact_path 匹配） */
  supersedes_at?: string;
  source: string;
}

export interface CapabilityReceipt {
  schema_version: '1.0';
  adapter: string;
  run_id: string;
  invoke_id: string;
  binding_path: 'route_equality' | 'inline_canary';
  verdict: Exclude<VisionCapabilityVerdict, 'unknown'>;
  provider?: string;
  model?: string;
  at: string;
}

export interface EffectiveVisionContext {
  vision_capability: VisionCapabilityAxis;
  artifact_attestation: Record<string, { verdict: ArtifactAttestationVerdict; reasons: string[] }>;
  effective_policy: {
    mode: 'visual' | 'blind_safe';
    downgrade_reasons: string[];
  };
}

// ---------------------------------------------------------------------------
// 存储路径与读写
// ---------------------------------------------------------------------------

export function visionArtifactsDir(projectRoot: string, feature: string): string {
  return path.join(featureDir(projectRoot, feature), 'vision');
}

export function capabilityReceiptPath(projectRoot: string, feature: string): string {
  return path.join(visionArtifactsDir(projectRoot, feature), 'capability-receipt.json');
}

export function artifactAttestationsPath(projectRoot: string, feature: string): string {
  return path.join(visionArtifactsDir(projectRoot, feature), 'artifact-attestations.jsonl');
}

export function policyDowngradesPath(projectRoot: string, feature: string): string {
  return path.join(visionArtifactsDir(projectRoot, feature), 'policy-downgrades.jsonl');
}

// ---------------------------------------------------------------------------
// 四轮 review P0：vision 两账本（attestations/downgrades）的行级 hash 链——
// 每行携带 seq/prev_row_hash/row_hash（row_hash=去 row_hash 字段后按写入序 stringify 的
// sha256 前 16）。读取时严格验链：缺链字段/断链/hash 失配的行按 corrupt 计（fail-closed
// 进 blind_safe），**不进 rows**——agent 手写"裸 verified/supersede 原始 JSON"由此失效。
// 链只保证 append-only 完整性（正确续链仍可被伪造）；写入者真实性由 runner 的 invoke
// 前后快照比对 + anchor 事件保证（goal-runner 侧，agent 调用窗口内任何账本变更即 halt）。
// ---------------------------------------------------------------------------

interface ChainedRow {
  seq?: number;
  prev_row_hash?: string | null;
  row_hash?: string;
}

function rowHashOf(parsedLine: Record<string, unknown>): string {
  const clone: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsedLine)) {
    if (k !== 'row_hash') clone[k] = v;
  }
  return crypto.createHash('sha256').update(JSON.stringify(clone), 'utf-8').digest('hex').slice(0, 16);
}

function readJsonl<T>(p: string): { rows: T[]; corruptLines: number } {
  if (!fs.existsSync(p)) return { rows: [], corruptLines: 0 };
  const rows: T[] = [];
  let corruptLines = 0;
  let expectSeq = 1;
  let prevHash: string | null = null;
  for (const line of fs.readFileSync(p, 'utf-8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(t) as Record<string, unknown>;
    } catch {
      // codex 实施 review P0-1c：损坏行不静默跳过——计数上抛，消费面 fail-closed
      //（append-only 账面不可信 → blind_safe，不解释成空历史）
      corruptLines++;
      continue;
    }
    const c = parsed as ChainedRow;
    const chainValid =
      c.seq === expectSeq &&
      (c.prev_row_hash ?? null) === prevHash &&
      typeof c.row_hash === 'string' &&
      c.row_hash === rowHashOf(parsed);
    if (!chainValid) {
      corruptLines++;
      continue;
    }
    expectSeq++;
    prevHash = c.row_hash!;
    rows.push(parsed as T);
  }
  return { rows, corruptLines };
}

function appendJsonl(p: string, row: object): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  // 续链：读取现有**合法**链尾（损坏尾部时从最后合法行续——后续行反正判 corrupt）
  const { rows } = readJsonl<ChainedRow>(p);
  const last = rows.length > 0 ? rows[rows.length - 1] : null;
  const chained: Record<string, unknown> = {
    ...(row as Record<string, unknown>),
    seq: (last?.seq ?? 0) + 1,
    prev_row_hash: last?.row_hash ?? null,
  };
  chained.row_hash = rowHashOf(chained);
  fs.appendFileSync(p, `${JSON.stringify(chained)}\n`, 'utf-8');
}

export function appendArtifactAttestation(
  projectRoot: string,
  feature: string,
  row: Omit<ArtifactAttestationRecord, 'schema_version' | 'at'> & { at?: string },
): ArtifactAttestationRecord {
  const full: ArtifactAttestationRecord = {
    schema_version: '1.0',
    at: row.at ?? new Date().toISOString(),
    artifact_path: row.artifact_path,
    artifact_hash: row.artifact_hash,
    verdict: row.verdict,
    reasons: row.reasons,
    source: row.source,
    ...(row.gate_fingerprint ? { gate_fingerprint: row.gate_fingerprint } : {}),
    ...(row.invoke_id ? { invoke_id: row.invoke_id } : {}),
    ...(row.binding ? { binding: row.binding } : {}),
  };
  appendJsonl(artifactAttestationsPath(projectRoot, feature), full);
  return full;
}

export function appendPolicyDowngrade(
  projectRoot: string,
  feature: string,
  row: Omit<PolicyDowngradeRecord, 'schema_version' | 'at' | 'kind'> & { at?: string },
): PolicyDowngradeRecord {
  const full: PolicyDowngradeRecord = {
    schema_version: '1.0',
    at: row.at ?? new Date().toISOString(),
    kind: 'downgrade',
    reason: row.reason,
    source: row.source,
    ...(row.artifact_path ? { artifact_path: row.artifact_path } : {}),
    ...(row.artifact_hash ? { artifact_hash: row.artifact_hash } : {}),
  };
  appendJsonl(policyDowngradesPath(projectRoot, feature), full);
  return full;
}

/** runner 显式解除（append-only；spec：supersede 必须是 runner event，不删原行） */
export function appendPolicySupersede(
  projectRoot: string,
  feature: string,
  row: { reason: string; source: string; supersedes_at?: string; artifact_path?: string; at?: string },
): PolicyDowngradeRecord {
  const full: PolicyDowngradeRecord = {
    schema_version: '1.0',
    at: row.at ?? new Date().toISOString(),
    kind: 'supersede',
    reason: row.reason,
    source: row.source,
    ...(row.artifact_path ? { artifact_path: row.artifact_path } : {}),
    ...(row.supersedes_at ? { supersedes_at: row.supersedes_at } : {}),
  };
  appendJsonl(policyDowngradesPath(projectRoot, feature), full);
  return full;
}

export function sha256File(absPath: string): string | null {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(absPath)).digest('hex');
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 三轴解析
// ---------------------------------------------------------------------------

export interface ResolveVisionContextArgs {
  projectRoot: string;
  feature: string;
  /** goal run id；缺省=交互态（run_probed 判级只认 interactive fresh canary） */
  runId?: string;
  phase?: string;
  /** 本 invocation id；capability receipt 只对绑定 invoke 有效 */
  invokeId?: string;
  /** 需要判定 attestation 的产物 hash 集 */
  artifactHashes?: string[];
  /** 运行身份 adapter（goal 态传 manifest.adapter——运行身份可与 config 不同）；缺省读 config */
  adapter?: string;
  frameworkRoot?: string;
}

function resolveCapabilityAxis(args: ResolveVisionContextArgs): VisionCapabilityAxis {
  let adapter = (args.adapter ?? '').trim();
  if (!adapter) {
    try {
      adapter = (loadFrameworkConfig(args.projectRoot).agent_adapter ?? 'generic').trim() || 'generic';
    } catch {
      adapter = 'generic'; // config 不可读 → generic 声明
    }
  }
  // 1) invocation_bound：runner 签发 receipt（invoke 精确绑定 + run 匹配）
  if (args.invokeId) {
    const p = capabilityReceiptPath(args.projectRoot, args.feature);
    if (fs.existsSync(p)) {
      try {
        const r = JSON.parse(fs.readFileSync(p, 'utf-8')) as CapabilityReceipt;
        if (
          r.schema_version === '1.0' &&
          r.invoke_id === args.invokeId &&
          (!args.runId || r.run_id === args.runId)
        ) {
          return {
            verdict: r.verdict,
            scope: 'invocation_bound',
            evidence: { binding_path: r.binding_path, reason: `runner receipt（${r.binding_path}）` },
          };
        }
      } catch {
        /* 坏 receipt 不采信 */
      }
    }
  }
  // 2) run_probed：canary fresh 且证据不跨 run
  let local: ReturnType<typeof loadLocalConfig> = null;
  try {
    local = loadLocalConfig(args.projectRoot);
  } catch {
    local = null;
  }
  const override = local?.vision?.image_input_override;
  if (override) {
    // 人工显式 override=用户信任根声明——等效实测级（不高于 run_probed）
    return {
      verdict: override === 'none' ? 'none' : override === 'native_attach' ? 'native' : 'tool_read',
      scope: 'run_probed',
      evidence: { reason: `vision.image_input_override=${override}（用户显式声明）` },
    };
  }
  const canary = local?.vision?.canary;
  if (isVisionCanaryFresh(canary, adapter)) {
    const viaGoal = (canary!.probed_via ?? 'goal') === 'goal';
    const runMatch = viaGoal ? Boolean(args.runId && canary!.run_id === args.runId) : true;
    if (runMatch) {
      return {
        verdict:
          canary!.verdict === 'tool_read' ? 'tool_read' : canary!.verdict === 'none' ? 'none' : 'unknown',
        scope: 'run_probed',
        evidence: {
          canary_probed_at: canary!.probed_at,
          ...(canary!.run_id ? { canary_run_id: canary!.run_id } : {}),
          reason: `canary ${canary!.verdict}（${canary!.probed_via ?? 'goal'}${canary!.model ? `，model=${canary!.model}` : ''}）`,
        },
      };
    }
    // run 不匹配的 goal canary：不作 run_probed 采信（run_probed 不跨 run），落声明级
  }
  // 3) adapter_declared：仅声明可能性——verdict 按声明但 scope 最低。
  // frameworkRoot 惰性解析（只有走到本分支才需要；consumer 工程布局推断失败 →
  // fail-closed 按 unknown 声明，不 throw 炸消费面）。
  try {
    const frameworkRoot = args.frameworkRoot ?? inferRepoLayout(args.projectRoot).frameworkRoot;
    const probe = probeAdapterImageInput(args.projectRoot, frameworkRoot, adapter);
    return {
      verdict: probe.imageInput === 'none' ? 'none' : probe.imageInput === 'native_attach' ? 'native' : 'tool_read',
      scope: 'adapter_declared',
      evidence: { reason: `adapter 声明（${probe.reason}）——未经实测，只授权尝试探测` },
    };
  } catch (e) {
    return {
      verdict: 'unknown',
      scope: 'adapter_declared',
      evidence: { reason: `adapter 声明不可读（${(e as Error).message}）——fail-closed unknown` },
    };
  }
}

function latestAttestationByHash(
  rows: ArtifactAttestationRecord[],
  hash: string,
): ArtifactAttestationRecord | null {
  const hits = rows.filter(r => r.artifact_hash === hash);
  return hits.length > 0 ? hits[hits.length - 1] : null;
}

// ---------------------------------------------------------------------------
// 四轮 review P1：binding 只写不验 → 消费面核对。verified 行的 binding 为**必填**，
// 且须与当前状态一致（gate fingerprint/ref-elements hash/authoritative refs 集）；
// 任一缺失/失配 → 投影为 unverified（含降级解除判定——伪造/陈旧 verified 不得抬降级）。
// ---------------------------------------------------------------------------

export interface CurrentBindingContext {
  ref_elements_sha256: string | null;
  refs: Array<{ path: string; sha256: string }>;
  gate_fingerprint: string | null;
}

/** 当前绑定上下文（铸造端与消费端同源计算——check-spec 铸 verified、resolver 验 binding、
 * 单测构造 fixture 均用本函数，防两处各算一套漂移）。 */
export function computeCurrentBindingContext(
  projectRoot: string,
  feature: string,
  frameworkRoot?: string,
): CurrentBindingContext {
  let refElementsSha: string | null = null;
  try {
    refElementsSha = sha256File(refElementsAbsPath(projectRoot, feature));
  } catch {
    refElementsSha = null;
  }
  const refs: Array<{ path: string; sha256: string }> = [];
  try {
    const specMd = loadSpecMarkdown(projectRoot, feature);
    const paths = specMd
      ? collectAuthoritativeImagePaths(projectRoot, specMd, p =>
          path.isAbsolute(p) ? p : path.resolve(projectRoot, p))
      : [];
    for (const raw of paths) {
      const abs = path.resolve(raw);
      const h = sha256File(abs);
      if (h) refs.push({ path: abs, sha256: h });
    }
  } catch {
    /* refs 保持空集（binding 验证时空集与非空集失配 → stale，fail-closed 方向） */
  }
  let gateFp: string | null = null;
  try {
    const fr = frameworkRoot ?? inferRepoLayout(projectRoot).frameworkRoot;
    gateFp = computeGateFingerprint(fr, 'spec');
  } catch {
    gateFp = null;
  }
  return { ref_elements_sha256: refElementsSha, refs, gate_fingerprint: gateFp };
}

/** verified 行的 binding 校验（空=有效）。binding 必填；gate fp/ref-elements/refs 集须与当前一致。 */
export function verifiedBindingIssues(
  rec: ArtifactAttestationRecord,
  current: CurrentBindingContext,
): string[] {
  const b = rec.binding;
  if (!b || !b.run_id || !b.invoke_id || !Array.isArray(b.refs)) return ['binding_missing'];
  const issues: string[] = [];
  if (!b.gate_fingerprint) issues.push('binding_gate_fingerprint_missing');
  else if (!current.gate_fingerprint) issues.push('binding_stale:gate_fingerprint_uncomputable');
  else if (b.gate_fingerprint !== current.gate_fingerprint) issues.push('binding_stale:gate_fingerprint');
  if ((b.ref_elements_sha256 ?? null) !== current.ref_elements_sha256) issues.push('binding_stale:ref_elements');
  const key = (r: { path: string; sha256: string }): string => `${path.resolve(r.path)}|${r.sha256}`;
  const bset = new Set(b.refs.map(key));
  const cset = new Set(current.refs.map(key));
  if (b.refs.length === 0 || bset.size !== cset.size || [...cset].some(k => !bset.has(k))) {
    issues.push('binding_stale:refs');
  }
  return issues;
}

/** 未解除的降级集合：supersede 显式指名（supersedes_at/artifact_path）或同 artifact_path
 * 出现**更新 hash 的 verified attestation**（时间晚于降级）→ 视为已解除。
 * codex 实施 review 二轮 P1：supersede 只能向后解除（s.at > d.at）——预埋/历史 supersede
 * 不得解除未来新增的降级（时间反转洗白通道）。 */
export function activeDowngrades(
  downgrades: PolicyDowngradeRecord[],
  attestations: ArtifactAttestationRecord[],
): PolicyDowngradeRecord[] {
  const supersedes = downgrades.filter(d => d.kind === 'supersede');
  return downgrades.filter(d => {
    if (d.kind !== 'downgrade') return false;
    const superseded = supersedes.some(
      s =>
        s.at > d.at &&
        ((s.supersedes_at && s.supersedes_at === d.at) ||
          (!s.supersedes_at && s.artifact_path && s.artifact_path === d.artifact_path)),
    );
    if (superseded) return false;
    if (d.artifact_path && d.artifact_hash) {
      const lifted = attestations.some(
        a =>
          a.artifact_path === d.artifact_path &&
          a.artifact_hash !== d.artifact_hash &&
          a.verdict === 'verified' &&
          a.at > d.at,
      );
      if (lifted) return false;
    }
    return true;
  });
}

/**
 * 唯一解析器（消费纪律见文件头）。三轴独立计算；effective_policy = fail-closed meet。
 */
export function resolveEffectiveVisionContext(args: ResolveVisionContextArgs): EffectiveVisionContext {
  const capability = resolveCapabilityAxis(args);

  const att = readJsonl<ArtifactAttestationRecord>(
    artifactAttestationsPath(args.projectRoot, args.feature),
  );
  const attRows = att.rows;
  // 四轮 review P1：verified 行须过 binding 验真（必填 + 与当前 gate fp/ref-elements/refs 一致）；
  // 失败投影 unverified——含降级解除面（伪造/陈旧 verified 不得抬 blind-safe）。
  let currentBinding: CurrentBindingContext | null = null;
  const bindingCtx = (): CurrentBindingContext => {
    if (!currentBinding) {
      currentBinding = computeCurrentBindingContext(args.projectRoot, args.feature, args.frameworkRoot);
    }
    return currentBinding;
  };
  const projectRow = (rec: ArtifactAttestationRecord): { verdict: ArtifactAttestationVerdict; reasons: string[] } => {
    if (rec.verdict !== 'verified') return { verdict: rec.verdict, reasons: rec.reasons };
    const issues = verifiedBindingIssues(rec, bindingCtx());
    return issues.length > 0
      ? { verdict: 'unverified', reasons: [...issues, ...rec.reasons] }
      : { verdict: 'verified', reasons: rec.reasons };
  };
  const artifact_attestation: EffectiveVisionContext['artifact_attestation'] = {};
  for (const h of args.artifactHashes ?? []) {
    const latest = latestAttestationByHash(attRows, h);
    artifact_attestation[h] = latest
      ? projectRow(latest)
      : { verdict: 'unverified', reasons: ['no_attestation_record'] };
  }

  const dg = readJsonl<PolicyDowngradeRecord>(policyDowngradesPath(args.projectRoot, args.feature));
  // 降级解除输入面同样经 binding 验真降位（demote 后 verified 才有抬降级资格）
  const attRowsForLift = attRows.map(r =>
    r.verdict === 'verified' && verifiedBindingIssues(r, bindingCtx()).length > 0
      ? { ...r, verdict: 'unverified' as ArtifactAttestationVerdict }
      : r,
  );
  const active = activeDowngrades(dg.rows, attRowsForLift);
  const downgrade_reasons: string[] = active.map(
    d => `${d.reason}${d.artifact_path ? `（${d.artifact_path}）` : ''}`,
  );
  // codex 实施 review P0-1a（fail-open 根治）：adapter_declared 只是"可能性声明"——
  // 未经任何实测不得进入 visual 路径（plan 冻结语义：adapter_declared 保守走盲档；
  // 20260718 事故正是声明被当能力）。verdict 保留声明值（供"值得跑 canary"判断），
  // policy 恒并入降级原因。
  if (capability.scope === 'adapter_declared' && capability.verdict !== 'none') {
    downgrade_reasons.push('capability_scope=adapter_declared（仅声明未实测——保守走盲档，跑 canary 后解除）');
  }
  // 能力轴 none/unknown 本身即盲——并入 meet（invocation_bound 只提升能力轴，
  // 不参与解除下面这些 artifact/policy 级原因）
  if (capability.verdict === 'none' || capability.verdict === 'unknown') {
    downgrade_reasons.push(`vision_capability=${capability.verdict}`);
  }
  // codex 实施 review P0-1c：append-only 账面存在损坏行 → 账面不可信，fail-closed
  if (att.corruptLines > 0 || dg.corruptLines > 0) {
    downgrade_reasons.push(
      `vision 账面存在损坏行（attestations=${att.corruptLines}，downgrades=${dg.corruptLines}）——不解释成空历史，须人工核查`,
    );
  }
  // codex 实施 review 二轮 P0-4：artifact 轴参与 meet（spec：higher capability SHALL NOT
  // override an artifact-level contradicted/unverified restriction）——调用方显式询问的产物
  // 集里任一 verdict≠verified 即并入降级原因；不询问产物的调用面（policy 总闸）不受影响。
  for (const [h, a] of Object.entries(artifact_attestation)) {
    if (a.verdict !== 'verified') {
      downgrade_reasons.push(
        `artifact_attestation=${a.verdict}（${h.slice(0, 12)}…：${a.reasons.slice(0, 2).join('；') || 'no reasons'}）`,
      );
    }
  }
  return {
    vision_capability: capability,
    artifact_attestation,
    effective_policy: {
      mode: downgrade_reasons.length > 0 ? 'blind_safe' : 'visual',
      downgrade_reasons,
    },
  };
}

/** 最新**原始**attestation 行（链合法行内按 hash 取最后一条；不做 binding 投影）——
 * 写入幂等判据用（verdict/reasons/canonical binding 三元比对，五轮 review P1）。 */
export function readLatestRawAttestation(
  projectRoot: string,
  feature: string,
  hash: string,
): ArtifactAttestationRecord | null {
  const att = readJsonl<ArtifactAttestationRecord>(artifactAttestationsPath(projectRoot, feature));
  return latestAttestationByHash(att.rows, hash);
}

// ---------------------------------------------------------------------------
// 五轮 review P0-3：legacy 无链账本升级迁移——上一版 framework 写出的账本行无
// seq/prev_row_hash/row_hash，严格验链会把宿主升级后打成**永久 blind_safe**。
// 安全迁移（runner 启动时调用）：
//   - 纯 legacy 文件（全部行可解析且全部无链字段）→ 原子 quarantine（改名 .legacy-<ts>.bak，
//     记录完整 sha256）+ 保守重建：downgrade 行 / contradicted attestation（限制性方向）
//     经 appender 重新落链；**verified/supersede 不自动升级**（旧账本本无 writer
//     authenticity——verified 须经当前 spec gate 重新铸造，supersede 须 runner 重新签发）；
//   - mixed（部分带链）/含不可解析行 → 不自动修复，保持现状（corrupt fail-closed）转人工；
//   - 全链文件 → no-op。
// ---------------------------------------------------------------------------

export interface LegacyLedgerMigration {
  file: string;
  action: 'none' | 'migrated' | 'manual_required';
  quarantined_as?: string;
  original_sha256?: string;
  /** 迁移凭证（六轮 P1-1）：新链文件 sha256——随受保护 checkpoint 存证（旧→新 hash 链） */
  new_sha256?: string;
  imported_rows?: number;
  dropped_rows?: number;
}

export function migrateLegacyVisionLedgers(
  projectRoot: string,
  feature: string,
): LegacyLedgerMigration[] {
  const results: LegacyLedgerMigration[] = [];
  const targets = [
    { file: 'artifact-attestations.jsonl', abs: artifactAttestationsPath(projectRoot, feature) },
    { file: 'policy-downgrades.jsonl', abs: policyDowngradesPath(projectRoot, feature) },
  ];
  for (const t of targets) {
    // 六轮 P1-1 崩溃恢复：上次迁移在两次 rename 之间中断 → canonical 缺失 + tmp 在场
    // → 完成换名；canonical 在场的陈旧 tmp → 清除。
    const tmpAbs = `${t.abs}.migrating.tmp`;
    if (fs.existsSync(tmpAbs)) {
      if (!fs.existsSync(t.abs)) fs.renameSync(tmpAbs, t.abs);
      else fs.rmSync(tmpAbs, { force: true });
    }
    if (!fs.existsSync(t.abs)) {
      results.push({ file: t.file, action: 'none' });
      continue;
    }
    const lines = fs.readFileSync(t.abs, 'utf-8').split(/\r?\n/).filter(l => l.trim());
    if (lines.length === 0) {
      results.push({ file: t.file, action: 'none' });
      continue;
    }
    let parseFailed = false;
    const parsed: Array<Record<string, unknown>> = [];
    for (const l of lines) {
      try {
        parsed.push(JSON.parse(l) as Record<string, unknown>);
      } catch {
        parseFailed = true;
        break;
      }
    }
    const chainedCount = parsed.filter(r => typeof (r as ChainedRow).row_hash === 'string').length;
    const allChained = !parseFailed && chainedCount === parsed.length;
    const allChainless = !parseFailed && chainedCount === 0;
    if (allChained) {
      results.push({ file: t.file, action: 'none' }); // 全链——无需迁移
      continue;
    }
    if (parseFailed || !allChainless) {
      // mixed / 不可解析：禁止自动修复（人工处置；读取端 corrupt fail-closed 兜底）
      results.push({ file: t.file, action: 'manual_required' });
      continue;
    }
    // 纯 legacy：**事务化**保守重建（六轮 P1-1）——先在 tmp 全量构建新链并验证，
    // 再 quarantine 原文件 + 原子换名；任一步失败原文件不动（不丢限制性历史）。
    const originalSha = crypto.createHash('sha256').update(fs.readFileSync(t.abs)).digest('hex');
    const importRows: Array<Record<string, unknown>> = [];
    for (const r of parsed) {
      if (t.file === 'policy-downgrades.jsonl') {
        if (r.kind === 'downgrade' && typeof r.reason === 'string') {
          importRows.push({
            schema_version: '1.0',
            at: typeof r.at === 'string' ? r.at : new Date().toISOString(),
            kind: 'downgrade',
            reason: `[legacy-import] ${r.reason}`,
            source: `legacy_migration(${String(r.source ?? 'unknown')})`,
            ...(typeof r.artifact_path === 'string' ? { artifact_path: r.artifact_path } : {}),
            ...(typeof r.artifact_hash === 'string' ? { artifact_hash: r.artifact_hash } : {}),
          });
        }
        // supersede 不升级（须 runner 重新签发）
      } else if (r.verdict === 'contradicted' && typeof r.artifact_path === 'string' && typeof r.artifact_hash === 'string') {
        importRows.push({
          schema_version: '1.0',
          at: typeof r.at === 'string' ? r.at : new Date().toISOString(),
          artifact_path: r.artifact_path,
          artifact_hash: r.artifact_hash,
          verdict: 'contradicted',
          reasons: Array.isArray(r.reasons) ? (r.reasons as string[]).map(String) : ['legacy_import'],
          source: `legacy_migration(${String(r.source ?? 'unknown')})`,
        });
      }
      // verified/unverified 不升级（verified 须当前 gate 重铸；unverified 缺省即未验）
    }
    // tmp 全量构建（链从 1 起算）+ fsync
    const chainLines: string[] = [];
    let prevHash: string | null = null;
    importRows.forEach((row, i) => {
      const chained: Record<string, unknown> = { ...row, seq: i + 1, prev_row_hash: prevHash };
      chained.row_hash = rowHashOf(chained);
      prevHash = chained.row_hash as string;
      chainLines.push(JSON.stringify(chained));
    });
    const content = chainLines.length > 0 ? `${chainLines.join('\n')}\n` : '';
    const fd = fs.openSync(tmpAbs, 'w');
    try {
      fs.writeSync(fd, content);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    // 验证 tmp：链完整 + 导入数一致；失败 → 原文件不动，转人工
    const check = readJsonl<ChainedRow>(tmpAbs);
    if (check.corruptLines > 0 || check.rows.length !== importRows.length) {
      fs.rmSync(tmpAbs, { force: true });
      results.push({ file: t.file, action: 'manual_required', original_sha256: originalSha });
      continue;
    }
    const backupAbs = `${t.abs}.legacy-${Date.now()}.bak`;
    fs.renameSync(t.abs, backupAbs);
    fs.renameSync(tmpAbs, t.abs);
    results.push({
      file: t.file,
      action: 'migrated',
      quarantined_as: path.basename(backupAbs),
      original_sha256: originalSha,
      new_sha256: crypto.createHash('sha256').update(fs.readFileSync(t.abs)).digest('hex'),
      imported_rows: importRows.length,
      dropped_rows: parsed.length - importRows.length,
    });
  }
  return results;
}

/** 指定 artifact hash 是否存在**未解除的账本级**降级行（写入幂等判据用——区别于
 * resolveEffectiveVisionContext 的 downgrade_reasons 字符串投影，后者含非账本原因）。 */
export function hasActiveDowngradeForArtifactHash(
  projectRoot: string,
  feature: string,
  hash: string,
): boolean {
  const att = readJsonl<ArtifactAttestationRecord>(artifactAttestationsPath(projectRoot, feature));
  const dg = readJsonl<PolicyDowngradeRecord>(policyDowngradesPath(projectRoot, feature));
  // 四轮 review P1：解除判定同样只认过 binding 验真的 verified（防伪造行抑制降级落盘）
  let ctx: CurrentBindingContext | null = null;
  const rows = att.rows.map(r => {
    if (r.verdict !== 'verified') return r;
    ctx = ctx ?? computeCurrentBindingContext(projectRoot, feature);
    return verifiedBindingIssues(r, ctx).length > 0
      ? { ...r, verdict: 'unverified' as ArtifactAttestationVerdict }
      : r;
  });
  return activeDowngrades(dg.rows, rows).some(d => d.artifact_hash === hash);
}

/** 读 capability receipt（消费面校验用；坏 JSON/schema 不符 → null 不采信）。 */
export function readCapabilityReceipt(projectRoot: string, feature: string): CapabilityReceipt | null {
  const p = capabilityReceiptPath(projectRoot, feature);
  if (!fs.existsSync(p)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf-8')) as CapabilityReceipt;
    return parsed?.schema_version === '1.0' && parsed.invoke_id && parsed.binding_path ? parsed : null;
  } catch {
    return null;
  }
}

/** runner 侧签发 invocation_bound receipt（路径 A/B 判定由调用方完成，本函数只落盘）。 */
export function writeCapabilityReceipt(
  projectRoot: string,
  feature: string,
  receipt: Omit<CapabilityReceipt, 'schema_version' | 'at'> & { at?: string },
): CapabilityReceipt {
  const full: CapabilityReceipt = {
    schema_version: '1.0',
    at: receipt.at ?? new Date().toISOString(),
    adapter: receipt.adapter,
    run_id: receipt.run_id,
    invoke_id: receipt.invoke_id,
    binding_path: receipt.binding_path,
    verdict: receipt.verdict,
    ...(receipt.provider ? { provider: receipt.provider } : {}),
    ...(receipt.model ? { model: receipt.model } : {}),
  };
  const p = capabilityReceiptPath(projectRoot, feature);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(full, null, 2)}\n`, 'utf-8');
  return full;
}
