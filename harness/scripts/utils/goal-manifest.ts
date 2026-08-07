/**
 * Goal manifest parser — SSOT for goal-runner CLI and
 * {features_dir}/<feature>/goal-runs/<run-id>/manifest.json
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import type { FeaturePhase } from './phase-transition-policy';
import {
  DEFAULT_DEPENDENCY_POLICY,
  type DependencyPolicy,
} from './phase-transition-policy';
import { isValidFidelityTarget } from './fidelity-shared';

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
  adapter?: string;
  /** 运行身份来源（诚实化回溯）：user_explicit|entry_declared|local_config|registry|override */
  adapter_provenance?: string;
  chain_override?: FeaturePhase[];
  /** Contract-local minimum assurance by phase; labels are never compared globally. */
  minimum_assurance?: Record<string, 'degraded' | 'full'>;
  /** t6：预授权档位（--fidelity；只升不降，降档须 fidelity_receipt 校验通过） */
  fidelity?: 'pixel_1to1' | 'semantic_layout' | 'reference_only';
  /** t6：降档 confirmation receipt 文件（项目根相对）；flag 本身不构成授权 */
  fidelity_receipt?: string;
  budget: Required<GoalBudget>;
  dependency_policy: Required<DependencyPolicy>;
  unattended: UnattendedContract;
  /**
   * plan a5f9c3e2 t3①：vision lineage 处置意图。**是 recovery intent，不是 authority**
   * ——CLI 旗标可被模型拼出、无 key 部署下 manifest 整链在 agent 可写面，故本字段
   * 绝不进 AuthorityFacts.grants。其安全性由「仅 fresh 可选 + 断裂显式记事件 +
   * 禁止声称历史连续性 + 全链重验」保证：危险的不是 reset 本身，是静默的 reset。
   *
   * 唯一入口 CLI `--vision-lineage=reset`；缺省 continue；**resume 显式携带该旗标**直接拒绝
   * （出生 manifest 里的 reset 不再据此拒绝——e5d8a2c4 T1③）；运行中不得自动升级为 reset。
   *
   * **旧 manifest 兼容**：文档中无该键时行为按 `continue`，且身份字段集**不注入该键**
   * （见 computeManifestIdentityFields）——否则既有 run resume 会多出一个身份字段而误判漂移。
   */
  vision_lineage?: 'continue' | 'reset';
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
  // plan a5f9c3e2 t3①：vision_lineage **仅在文档中实际存在该键时**入身份字段集。
  // 凭空给旧 manifest 补默认值会让既有 run resume 多出一个字段 → 误判漂移。
  // 键在场即入哈希，故停机期间被补写仍会被既有 drift 检测发现（安全性不打折）。
  if (Object.prototype.hasOwnProperty.call(manifest, 'vision_lineage')) {
    fields.vision_lineage = manifest.vision_lineage ?? null;
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
 * 这不是假设：`resolveBirthVisionLineage` 初版正是拿 `=== 'reset'` 去比哈希，生产上
 * 恒 false（＝出生 reset 续做永不触发），却因为测试夹具**手写了原值**而全绿，
 * 穿过了四轮 review。对应本仓硬学习"消费方须按真实 writer 的 schema 造夹具"。
 * 抽成同一个函数即消除了"两处各写一遍哈希口径"的漂移面。
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
 * 十三轮 review P0-1：fidelity/fidelity_receipt 字段授权**不在本函数**——由
 * evaluateFidelityTransitionAuthorization（goal-preflight）在枚举+降档 receipt 验真通过后
 * 精确给出（十二轮的 fidelityApplied 搭车授权会放行 resume 绕过降档凭证验证的路径）。 */
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
  const segs = opts.dryRun
    ? [opts.featuresDir.replace(/\\/g, '/'), feature, 'goal-runs', DRY_RUNS_SUBDIR, opts.runId]
    : [opts.featuresDir.replace(/\\/g, '/'), feature, 'goal-runs', opts.runId];
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
 */
export function resolveRequirementInput(input: {
  requirement?: unknown;
  requirementFile?: unknown;
  projectRoot: string;
}): string | undefined {
  const inline = typeof input.requirement === 'string' ? input.requirement : undefined;
  const fileRaw = typeof input.requirementFile === 'string' ? input.requirementFile.trim() : '';
  if (!fileRaw) return inline;
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
  return text;
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
  // t3①：仅在输入显式给出该键时写入（缺省不落键——旧 manifest 兼容与身份字段集同源约束）
  const rawLineage = input.vision_lineage;
  if (rawLineage !== undefined && rawLineage !== 'continue' && rawLineage !== 'reset') {
    throw new Error(
      `[goal-manifest] vision_lineage 值非法（${String(rawLineage)}）——须 continue|reset`,
    );
  }

  return {
    ...(rawFidelity ? { fidelity: rawFidelity as GoalManifest['fidelity'] } : {}),
    ...(rawFidelityReceipt ? { fidelity_receipt: rawFidelityReceipt } : {}),
    ...(rawLineage !== undefined ? { vision_lineage: rawLineage } : {}),
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
 * 治 2.3.0 历史 manifest：legacy 扁平 timeout_seconds=3600 且无 per-phase map →
 * 视为"未显式设置"，删除该字段，使 **resume 旧 run** 走 goal-timeout 的 per-phase 默认表
 * （否则历史续跑里 review/testing 仍只有 60min，等于没修这次现场问题）。
 * 只对恰等于 legacy 默认值的扁平超时生效；用户显式设的非 3600 值保持不动。
 *
 * **仅用于 resume 旧 run（loadGoalManifestFromRun）**——不要用于 loadGoalManifestFile：
 * 用户手写 --manifest 的 3600 是显式选择，须按"扁平覆盖所有 phase"契约尊重，不可误删。
 */
const LEGACY_FLAT_TIMEOUT_SECONDS = 3600;
/**
 * plan a5f9c3e2 t3①：lineage 意图解析（唯一读取点）。缺键 → `continue`。
 * 注意：**读到 `reset` 只表示「已声明放弃历史连续性」这一 recovery intent**，
 * 不表示任何授权；调用方仍须按 fresh-only + 断裂记事件 + 禁连续性主张 + 全链重验落地。
 */
export function resolveVisionLineage(manifest: Pick<GoalManifest, 'vision_lineage'>): 'continue' | 'reset' {
  return manifest.vision_lineage === 'reset' ? 'reset' : 'continue';
}

/**
 * 【已删除 · e5d8a2c4 T1③，2026-08-05】`visionLineageResumeIssue()`
 *
 * 它按 manifest 的**出生字段**在启动期硬拒 resume，分不清两件完全不同的事：
 * ① 出生时声明 reset、**已在启动时消费完毕**（quarantine + lineage_discontinuity +
 *    新链三件套齐备后 `lineage_reset_committed`），其后阶段全 PASS；
 * ② 跑到一半往 manifest 里塞 reset，想把已建立的链一笔勾销。
 * manifest 是 run 的出生记录，reset 键**永远留在里面**，于是 ① 被 ② 的防线连坐——
 * 任何声明过 reset 的 run 遇设备锁屏/超时/崩溃即**结构性不可 resume**
 * （`--force-resume` 也无效）。2026-08-05 宿主实锤：PARTIAL 停放后框架自己的停放话术
 * 让人 resume，自己的启动门拒绝 resume。
 *
 * 删除而非重写，因为它想防的 ② **已被两道现成的门覆盖**：
 * · `computeManifestIdentityFields` 把 `vision_lineage` 计入 manifest 身份字段
 *   （停机期被补写会被 events 出生基线的 drift 检测发现——T2 5a 收口后基线由 events
 *   承载，MAC 已整体退役）；
 * · 执行判据只认**出生冻结值**（resolveBirthVisionLineage——中途补写拿不到出生值；
 *   decide 对失配本身恒 recover，见 5a-1，不再有 terminal 分支）。
 * 一件事三道门、其中一道分不清合法与非法——收敛回前两道。
 * 命令行 `--vision-lineage` **显式旗标**在 resume 上的拒绝**保留**（goal-runner.ts）——
 * 那才是真的"中途升级"；出生 manifest 里的 reset 不再据此拒绝。
 */

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

export function writeGoalManifest(manifest: GoalManifest, projectRoot: string): string {
  const abs = path.join(projectRoot, manifest.report_dir, 'manifest.json');
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
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
  const abs = path.join(projectRoot, featuresDir, feature, 'goal-runs', runId, 'manifest.json');
  if (!fs.existsSync(abs)) {
    throw new Error(`[goal-manifest] 未找到 run manifest: ${abs}`);
  }
  const manifest = JSON.parse(fs.readFileSync(abs, 'utf-8')) as GoalManifest;
  validateLoadedGoalManifest(manifest, { featuresDir, feature, runId });
  return applyLegacyTimeoutMigration(manifest);
}
