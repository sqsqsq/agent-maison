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
  /** t6：预授权档位（--fidelity；只升不降，降档须 fidelity_receipt 校验通过） */
  fidelity?: 'pixel_1to1' | 'semantic_layout' | 'reference_only';
  /** t6：降档 confirmation receipt 文件（项目根相对）；flag 本身不构成授权 */
  fidelity_receipt?: string;
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
}

export interface GoalManifestParseOptions {
  projectRoot: string;
  runId?: string;
  featuresDir?: string;
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
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = crypto.createHash('sha256').update(stableJson(v), 'utf-8').digest('hex').slice(0, 16);
  }
  return out;
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

export function resolveGoalReportDir(opts: {
  featuresDir: string;
  feature: string;
  runId: string;
}): string {
  const feature = opts.feature.trim();
  if (!feature) {
    throw new Error('[goal-manifest] feature 必填');
  }
  return path
    .join(opts.featuresDir.replace(/\\/g, '/'), feature, 'goal-runs', opts.runId)
    .replace(/\\/g, '/');
}

export function buildGoalManifestFromInput(
  input: Record<string, unknown>,
  opts: GoalManifestParseOptions,
): GoalManifest {
  const runId = (typeof input.run_id === 'string' && input.run_id.trim()) || opts.runId || newRunId();
  const featuresDir = opts.featuresDir ?? DEFAULT_FEATURES_DIR;
  const feature = String(input.feature ?? '').trim();
  if (!feature) {
    throw new Error('[goal-manifest] feature 必填');
  }
  const canonicalReportDir = resolveGoalReportDir({ featuresDir, feature, runId });
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

  return {
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
    unattended: input.unattended as UnattendedContract,
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
  opts?: Pick<GoalManifestParseOptions, 'featuresDir'>,
): GoalManifest {
  const abs = path.isAbsolute(filePath) ? filePath : path.join(projectRoot, filePath);
  const raw = YAML.parse(fs.readFileSync(abs, 'utf-8')) as Record<string, unknown>;
  // 注意：不在此做 legacy 超时迁移——用户手写 --manifest 里的 timeout_seconds:3600
  // 是显式选择，须按"扁平覆盖所有 phase"契约尊重。迁移只针对 resume 旧 run
  // （那里的 3600 是 2.3.0 旧硬编码默认、非用户选择），见 loadGoalManifestFromRun。
  return buildGoalManifestFromInput(raw, {
    projectRoot,
    featuresDir: opts?.featuresDir,
  });
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
  const featuresDir = opts.featuresDir ?? DEFAULT_FEATURES_DIR;
  const abs = path.join(projectRoot, featuresDir, feature, 'goal-runs', runId, 'manifest.json');
  if (!fs.existsSync(abs)) {
    throw new Error(`[goal-manifest] 未找到 run manifest: ${abs}`);
  }
  const manifest = JSON.parse(fs.readFileSync(abs, 'utf-8')) as GoalManifest;
  validateLoadedGoalManifest(manifest, { featuresDir, feature, runId });
  return applyLegacyTimeoutMigration(manifest);
}
