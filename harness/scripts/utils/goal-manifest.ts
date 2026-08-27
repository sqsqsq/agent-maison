/**
 * Goal manifest parser — SSOT for goal-runner CLI and
 * {features_dir}/<feature>/goal-runs/<run-id>/manifest.json
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
// M5A §4.3：逻辑 featureId → 物理相对路径唯一 SSOT（goal-runs 路径必须经它展开）
import { featureRelativePath } from './feature-identity';
import type { FeaturePhase } from './phase-transition-policy';
import {
  DEFAULT_DEPENDENCY_POLICY,
  type DependencyPolicy,
} from './phase-transition-policy';
import { isValidFidelityTarget } from './fidelity-shared';
import type { ProviderRef } from './types';

export interface GoalBudget {
  max_retries_per_phase?: number;
  max_total_turns?: number;
  wall_clock_minutes?: number;
  /**
   * P0-D（b8f36a12）：API 断流（transient_api_error）独立重试上限——与
   * max_retries_per_phase **解耦**（一次断流不吃内容重试预算），仍受
   * max_total_turns + wall_clock 兜底。计数从 events.jsonl 派生（跨 resume 不清零）。
   */
  max_transient_api_retries?: number;
}

export interface AdapterModelPin {
  /** 最终 effective adapter（resolveFinalModelPin 单点裁决后写入） */
  adapter: string;
  /** 用户显式 --adapter-model 的权威模型值 */
  value: string;
}

export const RUN_ADAPTER_PROVENANCES = [
  'user_explicit',
  'entry_declared',
  'local_config',
  'registry',
  'override',
] as const;
export type RunAdapterProvenance = (typeof RUN_ADAPTER_PROVENANCES)[number];

/**
 * plan a8e5c3f9 t6：Goal/headless 有效权限——很薄的纯解析点（非状态机、无第二份持久状态）。
 * 用户主动启动 Goal/headless 即授权 non-interactive + no approval prompt + full
 * filesystem/tool execution；adapter 只翻译该语义，不得降级。
 * 旧 manifest 的 write_mode/approval_mode 枚举仍被接受（历史 run 可 resume、原文不重写），
 * 但执行、prompt 与能力判断一律使用本函数的 effective 值；allowed_tools 是审批清单遗留
 * 字段（deprecated/ignored），不构成 effective 权限的一部分。
 * 注意：全权限=CLI/工具/OS 执行能力，不是业务裁决权——phase 权责、integrity、
 * runner-owned gate、receipt/人签、journal 收编、设备与凭据规则一概不受影响。
 */
export function effectiveHeadlessUnattended(raw?: UnattendedContract): UnattendedContract {
  return {
    ...(raw ?? ({} as UnattendedContract)),
    write_mode: 'full-access',
    approval_mode: 'never',
  };
}

export interface UnattendedContract {
  write_mode: 'workspace-write' | 'accept-edits' | 'full-access';
  approval_mode: 'never' | 'on-request' | 'always';
  max_turns?: number;
  /** 扁平全局超时（秒）；per-phase 未命中时的兜底。优先级见 utils/goal-timeout.ts。 */
  timeout_seconds?: number;
  /** 显式 per-phase 超时覆盖（秒），最高优先。缺省走 goal-timeout 内置默认表。 */
  phase_timeout_seconds?: Partial<Record<FeaturePhase, number>>;
  allowed_tools?: string[];
}

export interface GoalManifest {
  schema_version: '1.0';
  start_phase: FeaturePhase;
  end_phase: FeaturePhase;
  feature: string;
  requirement?: string;
  /**
   * plan c4e8a1f7 T2：需求来源列表（项目根相对正斜杠；项目外 source 保留绝对路径）。
   * 可选字段：旧 manifest 无键不受影响（身份哈希条件包含，见 computeManifestIdentityFields）。
   * 语义=provenance，不是需求正文——参考图发现据此做 source 直接父目录一层扫描。
   */
  requirement_source_files?: string[];
  adapter?: string;
  /** 运行身份来源（诚实化回溯）：user_explicit|entry_declared|local_config|registry|override */
  adapter_provenance?: string;
  chain_override?: FeaturePhase[];
  /** Contract-local minimum assurance by phase; labels are never compared globally. */
  minimum_assurance?: Record<string, 'degraded' | 'full'>;
  /** t6：显式档位（--fidelity；只升不降，降档属于 requirement correction） */
  fidelity?: 'pixel_1to1' | 'semantic_layout' | 'reference_only';
  /** @deprecated legacy compatibility only; readers ignore it and new CLI writers reject it. */
  fidelity_receipt?: string;
  /**
   * plan d7f3a9c4 t1/t2：显式模型钉——用户 `--adapter-model` 的权威输入，
   * 随 headless argv 回放。adapter 必须等于最终 effective adapter（由
   * resolveFinalModelPin 单点裁决）。条件入身份哈希（键在场即入，旧 manifest
   * 无键不受影响——见 computeManifestIdentityFields）。
   */
  adapter_model_pin?: AdapterModelPin;
  /**
   * 视觉委托（plan ab072691 t1⑤）：只读视觉 provider 的**冻结身份**。
   *
   * 与 adapter_model_pin 平行但**独立**：那是 primary 执行身份，这是第二个「只看图」
   * endpoint。条件入身份哈希（键在场即入，旧 manifest 无键不受影响）；resume 只认冻结值、
   * 不重读 framework.local.json；successor 随 ...inherited 继承。
   *
   * **支持资格不在 manifest 层判**——资格唯一真源是 adapter.yaml.visual_provider 完整声明
   * （adapter-catalog）。这里只做 shape 校验，刻意**不**复用 KNOWN_MODEL_PIN_ADAPTERS：
   * 那是 primary 模型钉的已知集，拿来当 provider 资格判据就是第二个平行真源。
   */
  visual_provider_pin?: ProviderRef;
  /**
   * Legacy-only：旧 manifest 可能含该字段。读取/重写时保留字节语义，但运行策略和
   * identity 均忽略；新 CLI/manifest writer 不再生成它。
   */
  allow_blind_visual?: true;
  budget: Required<GoalBudget>;
  dependency_policy: Required<DependencyPolicy>;
  unattended: UnattendedContract;
  run_id: string;
  report_dir: string;
  created_at: string;
  /**
   * visual-capability-truth S4：goal 启动前预授权的源码变更（authority_kind=
   * pre_run_manifest 的唯一合法来源）。runner 在 run_start 冻结 manifest hash，
   * 运行中补写本字段不构成授权（授权判定只引用冻结快照）。
   */
  pre_authorized_mutations?: Array<{
    id?: string;
    phase: string;
    allowed_files: string[];
    allowed_change_kind?: 'test_seam' | 'integration_glue';
    max_files: number;
    approved_by?: string;
  }>;
  /** T3 successor metadata; the audited supersede event remains the authority. */
  successor_of?: string;
  inherited_round_fingerprints?: string[];
  inherited_drift_fingerprints?: string[];
}

export interface GoalManifestParseOptions {
  projectRoot: string;
  runId?: string;
  featuresDir?: string;
  /** plan e7c2a4d8 T1b：dry-run 落保留子目录 goal-runs/.dry/<run_id>（同 run_id、
   * run 级文件零共写）；canonical 校验按 dry 口径。 */
  dryRun?: boolean;
}

export interface LoadGoalManifestFromRunOptions {
  feature: string;
  featuresDir?: string;
}

const DEFAULT_FEATURES_DIR = 'doc/features';

const DEFAULT_BUDGET: Required<GoalBudget> = {
  max_retries_per_phase: 2,
  max_total_turns: 30,
  wall_clock_minutes: 480,
  max_transient_api_retries: 3,
};

/**
 * 十轮 review P1：manifest **身份哈希**——覆盖 run 期不应变的安全相关字段
 * （start/end phase / requirement / chain / fidelity / budget / dependency / unattended /
 * pre_authorized_mutations），排除 runner 运行中合法改写的易变字段（adapter/provenance/
 * created_at）。用于 resume 时"当前规范化 hash 直接比历史冻结值"——停机期间改
 * requirement/chain/budget/allowed_tools/fidelity 等非授权字段即被发现（旧文件全文件
 * hash 会因 writeGoalManifest 重写而恒变，无法承担漂移检测）。
 */
/** 十一轮 review P1：**逐字段**身份哈希——resume 时字段级 diff（哪些字段变了），
 * 支撑"只允许本次 override 覆盖对应字段"的字段级授权（裸 --override-start 不得放行
 * requirement/budget 等无关字段的漂移）。 */
export function computeManifestIdentityFields(manifest: GoalManifest): Record<string, string> {
  const fields: Record<string, unknown> = {
    schema_version: manifest.schema_version,
    start_phase: manifest.start_phase,
    minimum_assurance: manifest.minimum_assurance ?? null,
    end_phase: manifest.end_phase,
    feature: manifest.feature,
    requirement: manifest.requirement ?? null,
    chain_override: manifest.chain_override ?? null,
    fidelity: manifest.fidelity ?? null,
    fidelity_receipt: manifest.fidelity_receipt ?? null,
    budget: manifest.budget,
    dependency_policy: manifest.dependency_policy,
    unattended: manifest.unattended,
    pre_authorized_mutations: manifest.pre_authorized_mutations ?? null,
  };
  // adapter_model_pin 条件入集——键在场即在
  // 哈希，旧 manifest 无键不受影响（凭空补默认会让既有 run resume 多出字段→误判漂移）。
  if (Object.prototype.hasOwnProperty.call(manifest, 'adapter_model_pin')) {
    fields.adapter_model_pin = manifest.adapter_model_pin ?? null;
  }
  // plan ab072691 t1⑤：visual_provider_pin 同款条件入集——键在场即在哈希，旧 manifest
  // 无键不受影响（否则既有 run resume 会凭空多出字段而误判漂移）。
  if (Object.prototype.hasOwnProperty.call(manifest, 'visual_provider_pin')) {
    fields.visual_provider_pin = manifest.visual_provider_pin ?? null;
  }
  // plan c4e8a1f7 T2：requirement_source_files 同款条件入集——键在场即在哈希（fresh
  // 由 resolveRequirementInput 来源列表写入）；旧 manifest 无键不受影响（resume 不误判漂移）。
  if (Object.prototype.hasOwnProperty.call(manifest, 'requirement_source_files')) {
    fields.requirement_source_files = manifest.requirement_source_files ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(manifest, 'successor_of')) {
    fields.successor_of = manifest.successor_of ?? null;
    fields.inherited_round_fingerprints = manifest.inherited_round_fingerprints ?? null;
    fields.inherited_drift_fingerprints = manifest.inherited_drift_fingerprints ?? null;
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = manifestIdentityFieldDigest(v);
  }
  return out;
}

/**
 * 身份字段集里**单个字段的取值指纹**。
 *
 * 存在的理由是给**消费方**用：`manifest_identity_fields` 里存的是逐字段 sha256 截断，
 * **不是原值**。任何想问"出生时这个字段是不是某个值"的代码，都必须拿本函数算出期望
 * 指纹再比，**不能拿原值去比**——那样恒不相等，且失败得毫无声息。
 *
   * 消费方必须使用 writer 的同一摘要口径，不能拿原值与指纹直接比较。
 */
export function manifestIdentityFieldDigest(value: unknown): string {
  return crypto.createHash('sha256').update(stableJson(value), 'utf-8').digest('hex').slice(0, 16);
}

export function computeManifestIdentityHash(manifest: GoalManifest): string {
  return crypto.createHash('sha256')
    .update(stableJson(computeManifestIdentityFields(manifest)), 'utf-8')
    .digest('hex');
}

/** 两组逐字段哈希间发生变化的字段名（含新增/删除键）。 */
export function diffManifestIdentityFields(
  a: Record<string, string>,
  b: Record<string, string>,
): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter(k => a[k] !== b[k]).sort();
}

/** override 旗标 → 其授权可变更的身份字段集（--override-manifest=整体替换，授权全部字段）。
 * fidelity 由 evaluateFidelityTransitionAuthorization（goal-preflight）按合法枚举和只升不降
 * 精确给出；fidelity_receipt 已退役，不获得字段授权。 */
export function overrideAuthorizedIdentityFields(argv: {
  'override-manifest'?: boolean;
  'override-start'?: boolean;
  'override-end'?: boolean;
}): 'all' | Set<string> {
  if (argv['override-manifest']) return 'all';
  const set = new Set<string>();
  if (argv['override-start']) set.add('start_phase');
  if (argv['override-end']) set.add('end_phase');
  return set;
}

/** 稳定序列化（键排序）——不引入外部依赖，避免键序影响哈希。 */
function stableJson(v: unknown): string {
  const seen = new WeakSet();
  const norm = (x: unknown): unknown => {
    if (x === null || typeof x !== 'object') return x;
    if (seen.has(x as object)) return null;
    seen.add(x as object);
    if (Array.isArray(x)) return x.map(norm);
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(x as Record<string, unknown>).sort()) {
      out[k] = norm((x as Record<string, unknown>)[k]);
    }
    return out;
  };
  return JSON.stringify(norm(v));
}

export function newRunId(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  // codex 六轮（二期）P1：秒级时间戳跨工程/feature 同秒必碰撞（checkpoint namespace、
  // supersede 引用等全局键消费）——追加 6 hex 随机后缀保全局唯一。
  const rand = crypto.randomBytes(3).toString('hex');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z-${rand}`;
}

function normalizePhase(v: unknown, fallback: FeaturePhase): FeaturePhase {
  if (typeof v !== 'string' || !v.trim()) return fallback;
  return v.trim() as FeaturePhase;
}

function mergeDependencyPolicy(raw?: Partial<DependencyPolicy>): Required<DependencyPolicy> {
  return {
    deferrable_blocking_classes:
      raw?.deferrable_blocking_classes ??
      DEFAULT_DEPENDENCY_POLICY.deferrable_blocking_classes ??
      ['externalBlocked'],
    deferrable_failure_kinds:
      raw?.deferrable_failure_kinds ??
      DEFAULT_DEPENDENCY_POLICY.deferrable_failure_kinds ??
      ['device_blocked'],
    propagate_to_downstream: raw?.propagate_to_downstream ?? true,
  };
}

function mergeBudget(raw?: GoalBudget): Required<GoalBudget> {
  return {
    max_retries_per_phase: raw?.max_retries_per_phase ?? DEFAULT_BUDGET.max_retries_per_phase,
    max_total_turns: raw?.max_total_turns ?? DEFAULT_BUDGET.max_total_turns,
    wall_clock_minutes: raw?.wall_clock_minutes ?? DEFAULT_BUDGET.wall_clock_minutes,
    max_transient_api_retries:
      raw?.max_transient_api_retries ?? DEFAULT_BUDGET.max_transient_api_retries,
  };
}

export function validateUnattendedContract(u: Partial<UnattendedContract> | undefined): string[] {
  const issues: string[] = [];
  if (!u || typeof u !== 'object') {
    issues.push('unattended 缺失');
    return issues;
  }
  const writeModes = new Set(['workspace-write', 'accept-edits', 'full-access']);
  const approvalModes = new Set(['never', 'on-request', 'always']);
  if (!u.write_mode || !writeModes.has(u.write_mode)) {
    issues.push('unattended.write_mode 必须为 workspace-write|accept-edits|full-access');
  }
  if (!u.approval_mode || !approvalModes.has(u.approval_mode)) {
    issues.push('unattended.approval_mode 必须为 never|on-request|always');
  }
  return issues;
}

/** dry-run 保留子目录名（plan e7c2a4d8 T1b）——枚举器结构性跳过，run_id 校验拒绝
 * 以 . 开头故天然不冲突。 */
export const DRY_RUNS_SUBDIR = '.dry';

/** report_dir 是否落在 .dry 保留子树（实施 round2 P1：progress 投影按此分流——dry 视图
 * 读自己的 raw 事件，普通视图走权威过滤）。run_id 拒绝 . 前缀，.dry segment 只可能是
 * 保留子树本身。 */
export function isDryReportDir(reportDir: string): boolean {
  return reportDir.replace(/\\/g, '/').split('/').includes(DRY_RUNS_SUBDIR);
}

export function resolveGoalReportDir(opts: {
  featuresDir: string;
  feature: string;
  runId: string;
  dryRun?: boolean;
}): string {
  const feature = opts.feature.trim();
  if (!feature) {
    throw new Error('[goal-manifest] feature 必填');
  }
  // M5A §4.3：物理相对路径经唯一 SSOT 展开（CU=<blueprint_id>/<change_unit_id>），
  // 绝不把编码后的逻辑 id 落进 goal-runs 目录（proof 13/14）。
  const featureRel = featureRelativePath(feature);
  const segs = opts.dryRun
    ? [opts.featuresDir.replace(/\\/g, '/'), featureRel, 'goal-runs', DRY_RUNS_SUBDIR, opts.runId]
    : [opts.featuresDir.replace(/\\/g, '/'), featureRel, 'goal-runs', opts.runId];
  return path.join(...segs).replace(/\\/g, '/');
}

/** plan e7c2a4d8 T3a：pre_authorized_mutations 输入保真——逐条 shape 校验，非法条目
 * 整单 fail-closed（不静默丢弃，修「用户写进 YAML 的预授权被静默丢掉」+ identity hash
 * 该字段恒 null 的名存实亡）。定位=意图预登记，非放行路（classifier 冻结前不构成
 * 自动 PASS，见 mutation-authorization.ts）。 */
function parsePreAuthorizedMutations(
  input: unknown,
): GoalManifest['pre_authorized_mutations'] {
  if (input === undefined || input === null) return undefined;
  if (!Array.isArray(input)) {
    throw new Error('[goal-manifest] pre_authorized_mutations 必须为数组');
  }
  const out: NonNullable<GoalManifest['pre_authorized_mutations']> = [];
  input.forEach((raw, i) => {
    const at = `pre_authorized_mutations[${i}]`;
    if (typeof raw !== 'object' || raw === null) {
      throw new Error(`[goal-manifest] ${at} 必须为对象`);
    }
    const r = raw as Record<string, unknown>;
    const phase = typeof r.phase === 'string' ? r.phase.trim() : '';
    if (!phase) throw new Error(`[goal-manifest] ${at}.phase 必填`);
    const files = Array.isArray(r.allowed_files)
      ? r.allowed_files.filter((f): f is string => typeof f === 'string' && f.trim().length > 0)
      : [];
    if (!Array.isArray(r.allowed_files) || files.length === 0 || files.length !== r.allowed_files.length) {
      throw new Error(`[goal-manifest] ${at}.allowed_files 必须为非空字符串数组`);
    }
    const kind = r.allowed_change_kind;
    if (kind !== undefined && kind !== 'test_seam' && kind !== 'integration_glue') {
      throw new Error(`[goal-manifest] ${at}.allowed_change_kind 必须为 test_seam|integration_glue`);
    }
    const maxFiles = r.max_files;
    if (typeof maxFiles !== 'number' || !Number.isInteger(maxFiles) || maxFiles <= 0) {
      throw new Error(`[goal-manifest] ${at}.max_files 必须为正整数`);
    }
    out.push({
      id: typeof r.id === 'string' ? r.id : undefined,
      phase,
      allowed_files: files.map((f) => f.trim().replace(/\\/g, '/')),
      allowed_change_kind: kind as 'test_seam' | 'integration_glue' | undefined,
      max_files: maxFiles,
      approved_by: typeof r.approved_by === 'string' ? r.approved_by : undefined,
    });
  });
  return out.length > 0 ? out : undefined;
}

function normalizeAdapterModelPin(raw: unknown): AdapterModelPin | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('[goal-manifest] adapter_model_pin 必须为对象');
  }
  const r = raw as Record<string, unknown>;
  validateAdapterModelPinValue(r.adapter, r.value);
  return { adapter: String(r.adapter).trim(), value: String(r.value).trim() };
}

/** 已知 adapter 集（model pin 形状校验的 adapter ∈ 已知集约束）。 */
const KNOWN_MODEL_PIN_ADAPTERS = new Set([
  'codex', 'claude', 'codeagent', 'cursor', 'opencode', 'chrys', 'generic',
]);

/**
 * shape 校验（**运行时**，不信任 TS 类型——JSON 解析后的不可信值须逐项检查）。
 * adapter 须为非空字符串且 ∈ 已知集；value 须为字符串、trim 后非空 ≤128 无控制字符。
 * 违规整体拒绝加载/解析。
 */
export function validateAdapterModelPinValue(adapter: unknown, value: unknown): void {
  if (typeof adapter !== 'string' || !adapter.trim()) {
    throw new Error('[goal-manifest] adapter_model_pin.adapter 必填且须为非空字符串');
  }
  const a = adapter.trim();
  if (!KNOWN_MODEL_PIN_ADAPTERS.has(a)) {
    throw new Error(
      `[goal-manifest] adapter_model_pin.adapter 不在已知集（${['codex', 'claude', 'codeagent', 'cursor', 'opencode', 'chrys', 'generic'].join('|')}）`,
    );
  }
  if (typeof value !== 'string') {
    throw new Error('[goal-manifest] adapter_model_pin.value 必填且须为字符串');
  }
  const v = value.trim();
  if (!v) {
    throw new Error('[goal-manifest] adapter_model_pin.value 必填');
  }
  if (v.length > 128) {
    throw new Error('[goal-manifest] adapter_model_pin.value 长度须 ≤128');
  }
  if (/[\u0000-\u001F\u007F]/.test(v)) {
    throw new Error('[goal-manifest] adapter_model_pin.value 不得含控制字符');
  }
}

/**
 * plan ab072691 t1⑤：visual_provider_pin shape 校验（**运行时**，不信任 TS 类型）。
 * adapter/model 均须非空字符串、trim 后 ≤128、无控制字符。
 * **刻意不校验 adapter ∈ 某个集合**：provider 支持资格的唯一真源是
 * agents/<adapter>/adapter.yaml.visual_provider 完整声明（adapter-catalog 派生），
 * manifest 层再放一份名单就是平行真源。资格不足的处置在 CLI/路由层按输入形态分流
 * （显式 CLI fail-fast / 旧 local 无人值守 WARN+blind），不是「拒绝加载 manifest」。
 */
export function validateVisualProviderPinValue(adapter: unknown, model: unknown): void {
  const check = (label: string, raw: unknown): string => {
    if (typeof raw !== 'string' || !raw.trim()) {
      throw new Error(`[goal-manifest] visual_provider_pin.${label} 必填且须为非空字符串`);
    }
    const v = raw.trim();
    if (v.length > 128) throw new Error(`[goal-manifest] visual_provider_pin.${label} 长度须 ≤128`);
    if (/[\u0000-\u001F\u007F]/.test(v)) {
      throw new Error(`[goal-manifest] visual_provider_pin.${label} 不得含控制字符`);
    }
    return v;
  };
  check('adapter', adapter);
  check('model', model);
}

function normalizeVisualProviderPin(raw: unknown): ProviderRef | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('[goal-manifest] visual_provider_pin 必须为对象');
  }
  const r = raw as Record<string, unknown>;
  validateVisualProviderPinValue(r.adapter, r.model);
  return { adapter: String(r.adapter).trim(), model: String(r.model).trim() };
}

function validateLegacyBlindVisualField(input: Record<string, unknown>): void {
  if (!Object.prototype.hasOwnProperty.call(input, 'allow_blind_visual')) return;
  if (input.allow_blind_visual !== true) {
    throw new Error('[goal-manifest] allow_blind_visual 键在场时必须为 true');
  }
}

function normalizeMinimumAssurance(raw: unknown): Record<string, 'degraded' | 'full'> | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('[goal-manifest] minimum_assurance 必须为 phase→assurance 对象');
  }
  const out: Record<string, 'degraded' | 'full'> = {};
  for (const [phase, rawAssurance] of Object.entries(raw as Record<string, unknown>)) {
    const phaseId = phase.trim();
    const assurance = typeof rawAssurance === 'string' ? rawAssurance.trim() : '';
    if (!phaseId || (assurance !== 'degraded' && assurance !== 'full')) {
      throw new Error(`[goal-manifest] minimum_assurance.${phase || '<empty>'} 必须为 degraded|full`);
    }
    out[phaseId] = assurance;
  }
  return Object.keys(out).length > 0
    ? Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)))
    : undefined;
}

/**
 * f9c2e6b4 t4：`--requirement` / `--requirement-file` 的**单一解析入口**。
 *
 * 立项事实：goal 启动指引只给 `--requirement "<string>"`，而宿主真实需求是 544 字节多行中文
 * （含 `；`、`/`、换行）。在 Windows 命令行上传这种实参既难写又易错，于是宿主 agent 每次
 * 自造 `launch-*.js` 包装器 + `*-requirement.txt` 落到 scratch/——两次 run 留下两份不同名、
 * 不同内容的需求文件，重跑旧 launcher 就会把**旧需求**带进新 run。
 *
 * 设计要点：
 *   · 与 `--requirement` **互斥**（同给即 fail-closed——两个真值来源必须有人裁决，不猜）；
 *   · 相对路径按 **projectRoot** 解析（两个入口同一口径，不依赖各自 cwd）；
 *   · **只读取内容**。防陈旧靠调用方在 fresh 时把内容冻结进 manifest，
 *     **不靠**规定文件命名或禁止复用路径——权威需求文件本就该长期复用。
 *
 * plan c4e8a1f7 T2：来源是 provenance、不是需求正文——返回 frozen text + 可选
 * `requirement_source_files[]`（项目内→项目根相对正斜杠；项目外→保留绝对路径，只读正文、
 * 不扫描其 sibling；inline → 空数组）。fresh manifest 持久化该列表并纳入身份哈希，
 * resume 只读冻结值，successor 继承并在显式 file 增量时去重追加。
 */
export interface ResolvedRequirementInput {
  text: string | undefined;
  /** 来源文件（项目根相对或绝对）；inline requirement 为空数组 */
  sources: string[];
}

export function resolveRequirementInput(input: {
  requirement?: unknown;
  requirementFile?: unknown;
  projectRoot: string;
}): ResolvedRequirementInput {
  const inline = typeof input.requirement === 'string' ? input.requirement : undefined;
  const fileRaw = typeof input.requirementFile === 'string' ? input.requirementFile.trim() : '';
  if (!fileRaw) return { text: inline, sources: [] };
  if (inline !== undefined && inline.trim().length > 0) {
    throw new Error(
      '[goal] --requirement 与 --requirement-file 互斥：两者同给时无法判定哪个是真值，' +
        '请只保留一个。',
    );
  }
  const abs = path.isAbsolute(fileRaw) ? fileRaw : path.join(input.projectRoot, fileRaw);
  if (!fs.existsSync(abs)) {
    throw new Error(`[goal] --requirement-file 指向的文件不存在：${abs}`);
  }
  const text = fs.readFileSync(abs, 'utf-8').replace(/^﻿/, '').trim();
  if (!text) {
    throw new Error(`[goal] --requirement-file 内容为空：${abs}`);
  }
  const projectRootAbs = path.resolve(input.projectRoot);
  const rel = path.relative(projectRootAbs, abs);
  const sources =
    rel && !rel.startsWith('..') && !path.isAbsolute(rel)
      ? [rel.split(path.sep).join('/')]
      : [abs];
  return { text, sources };
}

export function buildGoalManifestFromInput(
  input: Record<string, unknown>,
  opts: GoalManifestParseOptions,
): GoalManifest {
  if (Object.prototype.hasOwnProperty.call(input, 'minimum_depth_by_phase')) {
    throw new Error('[goal-manifest] minimum_depth_by_phase 已删除；请改用 minimum_assurance');
  }
  const inputRunId = typeof input.run_id === 'string' && input.run_id.trim() ? input.run_id.trim() : undefined;
  // plan e7c2a4d8 T1b：manifest.run_id 与 CLI/--detach 传入 run_id 同时在场须一致
  //（detach parent 已按其打印 run_id/report_dir，child 静默换 id 即身份分裂）。
  if (inputRunId && opts.runId && inputRunId !== opts.runId) {
    throw new Error(
      `[goal-manifest] manifest.run_id（${inputRunId}）与命令行 run_id（${opts.runId}）冲突——fail-closed`,
    );
  }
  const runId = inputRunId || opts.runId || newRunId();
  // plan e7c2a4d8 T1b：run_id 单一安全 segment——拒绝以 . 开头（保留 .dry 等结构名）
  // 与路径分隔符（防越出 goal-runs 命名空间）。
  if (runId.startsWith('.') || /[\\/]/.test(runId)) {
    throw new Error(`[goal-manifest] run_id 非法（不得以 . 开头或含路径分隔符）: ${runId}`);
  }
  const featuresDir = opts.featuresDir ?? DEFAULT_FEATURES_DIR;
  const feature = String(input.feature ?? '').trim();
  if (!feature) {
    throw new Error('[goal-manifest] feature 必填');
  }
  const canonicalReportDir = resolveGoalReportDir({ featuresDir, feature, runId, dryRun: opts.dryRun });
  const explicitReportDir =
    typeof input.report_dir === 'string' && input.report_dir.trim()
      ? input.report_dir.trim().replace(/\\/g, '/')
      : undefined;
  if (explicitReportDir && explicitReportDir !== canonicalReportDir) {
    throw new Error(
      `[goal-manifest] report_dir 必须为 feature 绑定路径: ${canonicalReportDir}（收到: ${explicitReportDir}）`,
    );
  }
  const reportDir = canonicalReportDir;

  const chainOverride = Array.isArray(input.chain_override)
    ? (input.chain_override.filter((x) => typeof x === 'string') as FeaturePhase[])
    : undefined;

  // plan f6b2d9a4 T3：fidelity/fidelity_receipt 随 parser 保留（此前静默丢弃——手写
  // manifest 的档位声明进不了路由决策层）；非法枚举 fail-closed（显式传值必须显式拒）。
  const rawFidelity = input.fidelity;
  if (rawFidelity !== undefined && rawFidelity !== null && !isValidFidelityTarget(rawFidelity)) {
    throw new Error(
      `[goal-manifest] fidelity 值非法（${String(rawFidelity)}）——须 pixel_1to1|semantic_layout|reference_only`,
    );
  }
  const rawFidelityReceipt =
    typeof input.fidelity_receipt === 'string' && input.fidelity_receipt.trim()
      ? input.fidelity_receipt.trim().replace(/\\/g, '/')
      : undefined;
  // plan d7f3a9c4 t1：---manifest 文件可携带 adapter_model_pin（fresh 由
  // resolveFinalModelPin 落键；此处仅保真解析 + shape 校验）
  const adapterModelPin = normalizeAdapterModelPin(input.adapter_model_pin);
  // plan ab072691 t1⑤：--manifest 文件可携带 visual_provider_pin（fresh 由
  // resolveFinalVisualProviderPin 落键；此处仅保真解析 + shape 校验）
  const visualProviderPin = normalizeVisualProviderPin(
    (input as Record<string, unknown>).visual_provider_pin,
  );
  // legacy input may be parsed for a clear shape error, but normalized/new manifests never re-emit
  // the retired waiver. Existing run manifests remain readable through loadGoalManifestFromRun.
  validateLegacyBlindVisualField(input);

  // plan c4e8a1f7 T2：requirement_source_files 保真解析（字符串数组；空数组/非数组
  // fail-closed——来源列表是 fresh 解析器产物，手写 manifest 混入形状错误不得静默吞）。
  let requirementSourceFiles: string[] | undefined;
  if (Object.prototype.hasOwnProperty.call(input, 'requirement_source_files')) {
    const raw = input.requirement_source_files;
    if (!Array.isArray(raw) || raw.some((x) => typeof x !== 'string' || !x.trim())) {
      throw new Error('[goal-manifest] requirement_source_files 必须为非空字符串数组');
    }
    requirementSourceFiles = raw.map((x) => String(x).trim().replace(/\\/g, '/'));
  }

  return {
    ...(rawFidelity ? { fidelity: rawFidelity as GoalManifest['fidelity'] } : {}),
    ...(rawFidelityReceipt ? { fidelity_receipt: rawFidelityReceipt } : {}),
    ...(adapterModelPin ? { adapter_model_pin: adapterModelPin } : {}),
    ...(visualProviderPin ? { visual_provider_pin: visualProviderPin } : {}),
    ...(requirementSourceFiles ? { requirement_source_files: requirementSourceFiles } : {}),
    schema_version: '1.0',
    start_phase: normalizePhase(input.start_phase, 'spec'),
    end_phase: normalizePhase(input.end_phase, 'testing'),
    feature: String(input.feature ?? '').trim(),
    requirement: typeof input.requirement === 'string' ? input.requirement : undefined,
    adapter: typeof input.adapter === 'string' ? input.adapter.trim() : undefined,
    adapter_provenance:
      typeof input.adapter_provenance === 'string' && input.adapter_provenance.trim()
        ? input.adapter_provenance.trim()
        : undefined,
    chain_override: chainOverride,
    budget: mergeBudget(input.budget as GoalBudget | undefined),
    dependency_policy: mergeDependencyPolicy(input.dependency_policy as DependencyPolicy | undefined),
    minimum_assurance: normalizeMinimumAssurance(input.minimum_assurance),
    unattended: input.unattended as UnattendedContract,
    pre_authorized_mutations: parsePreAuthorizedMutations(input.pre_authorized_mutations),
    run_id: runId,
    report_dir: reportDir,
    created_at: new Date().toISOString(),
  };
}

/**
 * e9d4b7a3 t1：successor 显式 requirement 增量的稳定分节标记（也是机器检测锚——
 * isSuccessorRepairRequirement 据此识别"本轮修复增量"是否存在；coding 侧能力块
 * 依此收紧 auto_crop 优先级，见 goal-runner buildCapabilityBlock）。
 */
export const SUCCESSOR_REQUIREMENT_INCREMENT_MARKER =
  '## 本轮修复增量 (successor requirement increment)';

/** 合并后的 requirement 是否携带显式修复增量段。 */
export function isSuccessorRepairRequirement(requirement: string | undefined | null): boolean {
  return typeof requirement === 'string' && requirement.includes(SUCCESSOR_REQUIREMENT_INCREMENT_MARKER);
}

/**
 * e9d4b7a3 t1：explicit 增量与源 requirement 合并——源正文在前、增量段在后（唯一任务
 * 真源仍是 manifest.requirement 原文，coding prompt 逐字可见两段）。源已含标记（重复
 * 合并/增量自带标记）时不二次嵌套标记段——增量直接续接在既有标记段之后，标记恒一个。
 */
export function mergeSuccessorRequirement(
  sourceRequirement: string | undefined,
  increment: string,
): string {
  const source = (sourceRequirement ?? '').trim();
  const inc = increment.trim();
  if (source.includes(SUCCESSOR_REQUIREMENT_INCREMENT_MARKER)) {
    return [source, '', inc].filter(l => l !== '').join('\n');
  }
  return [source, '', SUCCESSOR_REQUIREMENT_INCREMENT_MARKER, '', inc].filter(l => l !== '').join('\n');
}

/**
 * e9d4b7a3 t1（二轮 review P1 修正）：successor 的**显式 requirement 增量合并**不在本函数
 * 做——本函数只做合同继承（requirement 逐字继承源 run）；「是否显式提供 --requirement /
 * --requirement-file」是 CLI 输入事实，与 manifest 字段值无关（--manifest 自带不同文本
 * 不得被误判为增量）。合并由 goal-runner 在捕获显式 flag + applyManifestCliOverrides 全部
 * 完成之后调用 mergeSuccessorRequirement 一次性执行（唯一合并点）。
 */
export function inheritSuccessorManifest(
  manifest: GoalManifest,
  source: GoalManifest,
  fingerprints: {
    round: readonly string[];
    drift: readonly string[];
  },
): GoalManifest {
  const unique = (values: readonly string[]): string[] =>
    [...new Set(values.map(value => value.trim()).filter(Boolean))];
  if (manifest.feature !== source.feature) {
    throw new Error(
      `[goal-manifest] successor feature 不一致（当前=${manifest.feature}，源=${source.feature}）`,
    );
  }

  // 后继不是一个"默认 fresh manifest 再补预算"的新契约：源 manifest 才是本条
  // supersede 链的合同 SSOT。只替换新 run 的身份与明确要求的新起点；其余字段（end/
  // requirement/adapter/chain/fidelity/dependency/预授权等）全部原样继承。阶段完成态
  // 不在 manifest 中，故不会跨 run 复制；预算/无人值守深拷贝只是避免调用方后续改写源对象。
  const inherited = JSON.parse(JSON.stringify(source)) as GoalManifest;
  // adapter_model_pin 是出生持续的模型钉，successor 默认继承源 run pin（覆盖继承值须显式 --adapter-model 出生
  // 输入，由 resolveFinalModelPin 裁决）。故此处**不得剥离**，随 ...inherited 原样继承。
  // plan ab072691 t1⑤：visual_provider_pin 同理随 ...inherited 继承（出生时显式
  // --visual-adapter/--visual-model 可覆盖，由 resolveFinalVisualProviderPin 裁决）。
  // legacy allow_blind_visual 没有运行语义；successor 不复制无效历史字段。
  delete inherited.allow_blind_visual;
  // successor 换 adapter 时禁止把旧 adapter 的模型字符串回放给新 adapter——继承 pin
  // 的 adapter 若与最终 effective adapter 不一致，resolveFinalModelPin 会 BLOCKER。
  const sourceRound = source.inherited_round_fingerprints ?? [];
  const sourceDrift = source.inherited_drift_fingerprints ?? [];
  // plan c4e8a1f7 T2：successor 继承源 requirement 来源列表，并在显式 file 增量时
  // 去重追加（manifest.requirement_source_files 由 CLI 显式 --requirement-file 解析产生）。
  const sourceFiles =
    source.requirement_source_files ?? [];
  const explicitFiles = manifest.requirement_source_files ?? [];
  const mergedSourceFiles = [...new Set([...sourceFiles, ...explicitFiles])];
  return {
    ...inherited,
    start_phase: manifest.start_phase,
    run_id: manifest.run_id,
    report_dir: manifest.report_dir,
    created_at: manifest.created_at,
    successor_of: source.run_id,
    ...(mergedSourceFiles.length > 0 ? { requirement_source_files: mergedSourceFiles } : {}),
    inherited_round_fingerprints: unique([...sourceRound, ...fingerprints.round]),
    inherited_drift_fingerprints: unique([...sourceDrift, ...fingerprints.drift]),
  };
}

/**
 * 治 2.3.0 历史 manifest：legacy 扁平 timeout_seconds=3600 且无 per-phase map →
 * 视为"未显式设置"，删除该字段，使 **resume 旧 run** 走 goal-timeout 的 per-phase 默认表
 * （否则历史续跑里 review/testing 仍只有 60min，等于没修这次现场问题）。
 * 只对恰等于 legacy 默认值的扁平超时生效；用户显式设的非 3600 值保持不动。
 *
 * **仅用于 resume 旧 run（loadGoalManifestFromRun）**——不要用于 loadGoalManifestFile：
 * 用户手写 --manifest 的 3600 是显式选择，须按"扁平覆盖所有 phase"契约尊重，不可误删。
 */
const LEGACY_FLAT_TIMEOUT_SECONDS = 3600;
export function applyLegacyTimeoutMigration(manifest: GoalManifest): GoalManifest {
  const u = manifest.unattended;
  if (u && u.timeout_seconds === LEGACY_FLAT_TIMEOUT_SECONDS && !u.phase_timeout_seconds) {
    delete u.timeout_seconds;
  }
  return manifest;
}

export function loadGoalManifestFile(
  filePath: string,
  projectRoot: string,
  opts?: Pick<GoalManifestParseOptions, 'featuresDir' | 'dryRun' | 'runId'>,
): GoalManifest {
  const abs = path.isAbsolute(filePath) ? filePath : path.join(projectRoot, filePath);
  const raw = YAML.parse(fs.readFileSync(abs, 'utf-8')) as Record<string, unknown>;
  // 注意：不在此做 legacy 超时迁移——用户手写 --manifest 里的 timeout_seconds:3600
  // 是显式选择，须按"扁平覆盖所有 phase"契约尊重。迁移只针对 resume 旧 run
  // （那里的 3600 是 2.3.0 旧硬编码默认、非用户选择），见 loadGoalManifestFromRun。
  return buildGoalManifestFromInput(raw, {
    projectRoot,
    featuresDir: opts?.featuresDir,
    dryRun: opts?.dryRun,
    runId: opts?.runId,
  });
}

/**
 * plan e7c2a4d8 T1b（codex 六轮 P1-③/五轮 P1-①）：detach parent 与 main 共用的
 * 原始 run 输入单点解析——一次解析 feature / run_id / dry 形态与 CLI↔manifest 一致性。
 * feature 仅在 manifest 时 parent 不再提前拒绝；同时提供且冲突 → fail-closed。
 */
export interface RawRunInput {
  feature: string;
  /** undefined = 调用方自行 newRunId() */
  runId?: string;
  isResume: boolean;
  dryRun: boolean;
}

export function resolveRawRunInput(
  argv: Record<string, unknown>,
  projectRoot: string,
): RawRunInput {
  const dryRun = Boolean(argv['dry-run']);
  const isResume = Boolean(argv.resume);
  if (dryRun && isResume) {
    throw new Error('[goal-manifest] --dry-run 与 --resume 互斥（dry-run 无 resume 语义）');
  }
  const cliFeature = typeof argv.feature === 'string' && argv.feature.trim() ? argv.feature.trim() : undefined;
  const cliRunId =
    typeof argv['run-id'] === 'string' && (argv['run-id'] as string).trim()
      ? (argv['run-id'] as string).trim()
      : undefined;

  let manifestFeature: string | undefined;
  let manifestRunId: string | undefined;
  if (typeof argv.manifest === 'string' && argv.manifest.trim()) {
    const abs = path.isAbsolute(argv.manifest) ? argv.manifest : path.join(projectRoot, argv.manifest);
    let raw: Record<string, unknown>;
    try {
      raw = YAML.parse(fs.readFileSync(abs, 'utf-8')) as Record<string, unknown>;
    } catch (e) {
      throw new Error(`[goal-manifest] 无法读取 --manifest（${abs}）：${(e as Error).message}`);
    }
    if (raw && typeof raw === 'object') {
      manifestFeature = typeof raw.feature === 'string' && raw.feature.trim() ? raw.feature.trim() : undefined;
      manifestRunId = typeof raw.run_id === 'string' && raw.run_id.trim() ? raw.run_id.trim() : undefined;
    }
  }

  if (cliFeature && manifestFeature && cliFeature !== manifestFeature) {
    throw new Error(
      `[goal-manifest] --feature（${cliFeature}）与 manifest.feature（${manifestFeature}）冲突——fail-closed`,
    );
  }
  const feature = cliFeature ?? manifestFeature;
  if (!feature) {
    throw new Error('[goal-manifest] feature 必填（--feature 或 manifest.feature）');
  }

  if (cliRunId && manifestRunId && cliRunId !== manifestRunId) {
    throw new Error(
      `[goal-manifest] --run-id（${cliRunId}）与 manifest.run_id（${manifestRunId}）冲突——fail-closed`,
    );
  }
  // 实施 round2 P1：--resume <id> 也入身份冲突面——否则 resume id 与 manifest.run_id
  // 分裂时 parent 按 resume id 打印/加锁，随后 manifest 加载又换身份（report_dir 分裂）。
  const resumeRunId = isResume ? String(argv.resume).trim() : undefined;
  if (resumeRunId && manifestRunId && resumeRunId !== manifestRunId) {
    throw new Error(
      `[goal-manifest] --resume（${resumeRunId}）与 manifest.run_id（${manifestRunId}）冲突——fail-closed（resume 身份不得被 manifest 静默改写）`,
    );
  }
  if (resumeRunId && cliRunId && resumeRunId !== cliRunId) {
    throw new Error(
      `[goal-manifest] --resume（${resumeRunId}）与 --run-id（${cliRunId}）冲突——fail-closed`,
    );
  }
  const runId = resumeRunId ?? cliRunId ?? manifestRunId;
  return { feature, runId, isResume, dryRun };
}

/**
 * Resume 只是在既有 run 上重新取得执行身份；effective adapter 未变化时，manifest 中
 * 记录的仍应是该 run 出生时的来源。把一次 local 对账写成 `override` 会改动冻结
 * manifest 的全文件 hash，进而把 phase-evidence-manifest 全部误判为 stale。
 */
export function resolvePersistedAdapterProvenance(opts: {
  isResume: boolean;
  originalAdapter?: string;
  originalProvenance?: string;
  effectiveAdapter: string;
  decisionProvenance: RunAdapterProvenance;
}): string | undefined {
  if (opts.isResume && opts.originalAdapter === opts.effectiveAdapter) {
    return opts.originalProvenance;
  }
  return opts.decisionProvenance;
}

function serializeGoalManifest(manifest: GoalManifest): string {
  return JSON.stringify(manifest, null, 2) + '\n';
}

function serializedGoalManifestSha256(manifest: GoalManifest): string {
  return crypto.createHash('sha256').update(serializeGoalManifest(manifest), 'utf-8').digest('hex');
}

/**
 * phase evidence 的旧条目保存的是全文件 hash，无法直接迁移为字段级 hash。兼容判断只
 * 枚举 adapter_provenance（身份哈希明确排除的审计元数据）；命中意味着其它每个字节
 * 都与闭环时一致。adapter/requirement/budget 等真实字段不参与枚举，仍 fail-closed。
 */
export function goalManifestHashMatchesModuloAdapterProvenance(
  manifest: GoalManifest,
  expectedHash: string | null,
): boolean {
  if (!/^[0-9a-f]{64}$/.test(expectedHash ?? '')) return false;
  if (serializedGoalManifestSha256(manifest) === expectedHash) return true;
  const candidates: Array<RunAdapterProvenance | undefined> = [undefined, ...RUN_ADAPTER_PROVENANCES];
  return candidates.some((provenance) => {
    const candidate = { ...manifest };
    if (provenance === undefined) delete candidate.adapter_provenance;
    else candidate.adapter_provenance = provenance;
    return serializedGoalManifestSha256(candidate) === expectedHash;
  });
}

export type FrozenAdapterProvenanceRepair =
  | { repaired: false; manifest: GoalManifest }
  | { repaired: true; manifest: GoalManifest; from: 'override'; to: string | undefined };

/**
 * 3.0.0 兼容修复：旧 runner 曾在同 adapter resume 时把 `adapter_provenance` 改为
 * `override`。只在“仅还原该字段即可逐字命中首个 run_start 冻结 hash”时恢复；若
 * requirement、预算、adapter 等还有任何漂移，所有候选均不命中并保持 fail-closed。
 */
export function restoreFrozenAdapterProvenance(
  manifest: GoalManifest,
  frozenManifestHash: string | null,
): FrozenAdapterProvenanceRepair {
  if (manifest.adapter_provenance !== 'override' || !/^[0-9a-f]{64}$/.test(frozenManifestHash ?? '')) {
    return { repaired: false, manifest };
  }
  if (serializedGoalManifestSha256(manifest) === frozenManifestHash) {
    return { repaired: false, manifest };
  }

  const candidates: Array<RunAdapterProvenance | undefined> = [
    undefined,
    ...RUN_ADAPTER_PROVENANCES.filter((provenance) => provenance !== 'override'),
  ];
  const matches: Array<{ manifest: GoalManifest; provenance: string | undefined }> = [];
  for (const provenance of candidates) {
    const candidate = { ...manifest };
    if (provenance === undefined) delete candidate.adapter_provenance;
    else candidate.adapter_provenance = provenance;
    if (serializedGoalManifestSha256(candidate) === frozenManifestHash) {
      matches.push({ manifest: candidate, provenance });
    }
  }
  if (matches.length !== 1) return { repaired: false, manifest };
  return {
    repaired: true,
    manifest: matches[0].manifest,
    from: 'override',
    to: matches[0].provenance,
  };
}

export function writeGoalManifest(manifest: GoalManifest, projectRoot: string): string {
  const abs = path.join(projectRoot, manifest.report_dir, 'manifest.json');
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, serializeGoalManifest(manifest), 'utf-8');
  return abs;
}

/** Validate on-disk manifest matches canonical feature-bound evidence path (resume SSOT). */
export function validateLoadedGoalManifest(
  manifest: GoalManifest,
  opts: { featuresDir: string; feature: string; runId: string },
): void {
  const feature = opts.feature.trim();
  const runId = opts.runId.trim();
  const canonical = resolveGoalReportDir({
    featuresDir: opts.featuresDir,
    feature,
    runId,
  });
  if (manifest.feature?.trim() !== feature) {
    throw new Error(
      `[goal-manifest] manifest.feature 与请求不一致（期望 ${feature}，收到 ${manifest.feature ?? ''}）`,
    );
  }
  if (manifest.run_id !== runId) {
    throw new Error(
      `[goal-manifest] manifest.run_id 与 --resume 不一致（期望 ${runId}，收到 ${manifest.run_id ?? ''}）`,
    );
  }
  const reportDir = String(manifest.report_dir ?? '').replace(/\\/g, '/');
  if (reportDir !== canonical) {
    throw new Error(
      `[goal-manifest] manifest.report_dir 必须为 feature 绑定路径: ${canonical}（收到: ${reportDir}）`,
    );
  }
  // plan d7f3a9c4 t2：加载时 shape 校验 adapter_model_pin（adapter/value shape 违规
  // 整体拒绝加载——停机篡改应命中既有 manifest_identity_drift）。
  if (manifest.adapter_model_pin !== undefined) {
    validateAdapterModelPinValue(
      manifest.adapter_model_pin.adapter,
      manifest.adapter_model_pin.value,
    );
  }
  // plan ab072691 t1⑤：同款加载期 shape 校验（停机篡改命中既有 manifest_identity_drift）。
  if (manifest.visual_provider_pin !== undefined) {
    validateVisualProviderPinValue(
      manifest.visual_provider_pin.adapter,
      manifest.visual_provider_pin.model,
    );
  }
  if (manifest.allow_blind_visual !== undefined && manifest.allow_blind_visual !== true) {
    throw new Error('[goal-manifest] allow_blind_visual 键在场时必须为 true');
  }
}

export function loadGoalManifestFromRun(
  projectRoot: string,
  runId: string,
  opts: LoadGoalManifestFromRunOptions,
): GoalManifest {
  const feature = opts.feature?.trim();
  if (!feature) {
    throw new Error('[goal-manifest] --resume 须配 --feature 或 --manifest');
  }
  // plan e7c2a4d8 T1b：--resume 绝不解析进 .dry 命名空间（dry 无 resume 语义），
  // 且 run_id 不得携路径分隔符（防 `.dry/<id>` 形式绕入）。
  if (runId.startsWith('.') || /[\\/]/.test(runId)) {
    throw new Error(
      `[goal-manifest] --resume run_id 非法（dry-run 无 resume 语义，run_id 不得以 . 开头或含分隔符）: ${runId}`,
    );
  }
  const featuresDir = opts.featuresDir ?? DEFAULT_FEATURES_DIR;
  const abs = path.join(projectRoot, featuresDir, featureRelativePath(feature), 'goal-runs', runId, 'manifest.json');
  if (!fs.existsSync(abs)) {
    throw new Error(`[goal-manifest] 未找到 run manifest: ${abs}`);
  }
  const manifest = JSON.parse(fs.readFileSync(abs, 'utf-8')) as GoalManifest;
  validateLoadedGoalManifest(manifest, { featuresDir, feature, runId });
  return applyLegacyTimeoutMigration(manifest);
}
