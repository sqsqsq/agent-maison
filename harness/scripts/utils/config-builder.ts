// ============================================================================
// config-builder — framework.config.json 确定性写盘合成（init CREATE / UPDATE）
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';

import {
  type FrameworkConfig,
  validateFrameworkConfigWriteCandidate,
} from '../../config';
import { applyDefaults, loadProfileConfigDefaults } from '../../profile-loader';
import {
  getEffectiveBackfillFields,
  mergeBackfillFields,
  resolveProfileNameFromRaw,
  sanitizeProjectConfigForInitWrite,
  type BackfillField,
} from './config-field-merger';

/**
 * `configWritePayload` 可写白名单（plan a7c3f9e2 t2b）。
 *
 * SSOT：`skills/project/framework-init/SKILL.md` §S2.1 表格全部 7 行
 * （project_profile / project_name / architecture / materialized_adapters /
 * paths / project_scale+phases_disabled / spec）。两处必须同源，本集合并集 = 表格逐字：
 *
 *   CREATE：payload 全部 **顶层键** 须在此集合；
 *   UPDATE：payload 相对磁盘 baseline 的 **变更字段路径** 的顶层键须在此集合
 *           （未变更字段原样保留，不因不在白名单而拒绝）。
 *
 * toolchain / state_machine / tools / coding / active_workflow / schema_version 等
 * 框架机制字段**不得**经 AI payload 修改——由 builder/BACKFILL 自动注入。
 * t3 的 product 专用写入（record-product-selection）不走本白名单，属用户显式授权路径。
 */
export const CONFIG_WRITE_PAYLOAD_ALLOWED_TOP_KEYS: ReadonlySet<string> = new Set([
  'project_profile',
  'project_name',
  'architecture',
  'materialized_adapters',
  'paths',
  'project_scale',
  'phases_disabled',
  'spec',
]);

/** S2 context 子集：preflight / executor 共享写盘准备（避免 orchestrate↔executor 互引）。 */
export interface PrepareConfigWriteContext {
  projectRoot: string;
  configWritePayload?: Record<string, unknown>;
}

export interface BuildProjectConfigOptions {
  existingConfig?: Record<string, unknown> | null;
  profileName?: string;
}

function hasDottedKey(obj: unknown, dotted: string): boolean {
  const keys = dotted.split('.');
  let cur: unknown = obj;
  for (const k of keys) {
    if (!cur || typeof cur !== 'object' || Array.isArray(cur)) return false;
    if (!Object.prototype.hasOwnProperty.call(cur as Record<string, unknown>, k)) return false;
    cur = (cur as Record<string, unknown>)[k];
  }
  return true;
}

function setDottedKey(obj: Record<string, unknown>, dotted: string, value: unknown): void {
  const keys = dotted.split('.');
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    const next = cur[k];
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      cur[k] = {};
    }
    cur = cur[k] as Record<string, unknown>;
  }
  cur[keys[keys.length - 1]] =
    value !== null && typeof value === 'object'
      ? JSON.parse(JSON.stringify(value))
      : value;
}

function nestedObjectFromBackfillFields(fields: ReadonlyArray<BackfillField>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    setDottedKey(out, f.path, f.defaultValue);
  }
  return out;
}

function deepMergeRecords(
  base: Record<string, unknown>,
  overlay: Record<string, unknown>,
): Record<string, unknown> {
  const out = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
  for (const [key, value] of Object.entries(overlay)) {
    if (value === undefined) continue;
    const existing = out[key];
    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      existing !== null &&
      typeof existing === 'object' &&
      !Array.isArray(existing)
    ) {
      out[key] = deepMergeRecords(
        existing as Record<string, unknown>,
        value as Record<string, unknown>,
      );
    } else {
      out[key] = value;
    }
  }
  return out;
}

// --------------------------------------------------------------------------
// t2a（plan a7c3f9e2）：UPDATE 无损磁盘 baseline + 定点覆盖
// --------------------------------------------------------------------------
// v5 方案只堵顶层被 review 证伪（normalizeStateMachine / normalizeHvigorOptions /
// normalizeArchitecture 显式重建对象，未知叶子一律丢弃）。v6 定案：
//   UPDATE 的最终序列化基底 = 磁盘 raw 对象的**完整深拷贝**；normalizeConfig 降级为
//   **影子校验**（只验证结果合法，返回对象不得直接写盘）。
// 定点覆盖来源只有两个（逐一可枚举）：
//   (a) t2b 白名单授权的 AI payload 变更（prepareConfigWriteForTask 先做 diff 授权）；
//   (b) BACKFILL（getEffectiveBackfillFields）声明的缺失键补齐。
// 除此之外不得用归一化结果覆写磁盘原值——未知顶层及任意嵌套扩展字段默认原样保留。
// --------------------------------------------------------------------------

function deepClone<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

function hasOwn(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 输出 payload 相对 baseline 的**变更叶子路径**（点分；删除语义天然无 diff——
 * 深合并以 baseline 为底，payload 缺键即保留原值，不存在"删除磁盘内容"的写法）。
 * 变更 = payload 叶子值与 baseline 同路径叶子值不等，或该路径在 baseline 中缺失。
 */
export function diffChangedLeafPaths(
  payload: Record<string, unknown>,
  baseline: Record<string, unknown>,
): string[] {
  const out: string[] = [];
  const walk = (obj: Record<string, unknown>, base: Record<string, unknown> | undefined, prefix: string) => {
    for (const [key, value] of Object.entries(obj)) {
      const dotted = prefix ? `${prefix}.${key}` : key;
      const baseValue = base ? base[key] : undefined;
      const baseHas = base ? hasOwn(base, key) : false;
      if (isPlainObject(value)) {
        if (isPlainObject(baseValue)) {
          walk(value, baseValue, dotted);
        } else {
          // payload 是对象而 baseline 非对象（含缺失）→ 子树内每一片叶子都是新增
          collectLeafPaths(value, dotted, out);
        }
        continue;
      }
      if (!baseHas || !isDeepEqual(value, baseValue)) {
        out.push(dotted);
      }
    }
  };
  walk(payload, baseline, '');
  return out;
}

function collectLeafPaths(obj: Record<string, unknown>, prefix: string, out: string[]): void {
  for (const [key, value] of Object.entries(obj)) {
    const dotted = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(value)) collectLeafPaths(value, dotted, out);
    else out.push(dotted);
  }
}

function isDeepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** 变更路径的顶层键 ∈ 白名单 才允许；否则抛错（列出被拒字段路径与磁盘原值，不静默丢弃）。 */
export function assertConfigWriteChangesWhitelisted(
  sanitizedPayload: Record<string, unknown>,
  baseline: Record<string, unknown>,
  mode: 'create' | 'update',
): void {
  if (mode === 'create') {
    const rejected = Object.keys(sanitizedPayload).filter(
      k => !CONFIG_WRITE_PAYLOAD_ALLOWED_TOP_KEYS.has(k),
    );
    if (rejected.length > 0) {
      throw new Error(
        `[config-builder] CREATE 配置写入被拒：以下输入字段不在 configWritePayload 白名单` +
          `（SSOT：framework-init SKILL §S2.1）：${rejected.join(', ')}。` +
          `请把字段移出 configWritePayload（框架机制字段由 builder 自动注入），不得静默丢弃。`,
      );
    }
    return;
  }
  const changed = diffChangedLeafPaths(sanitizedPayload, baseline);
  const rejected = changed.filter(p => !CONFIG_WRITE_PAYLOAD_ALLOWED_TOP_KEYS.has(topSegmentOf(p)));
  if (rejected.length > 0) {
    const lines = rejected.map(p => {
      const v = readPathValue(baseline, p);
      return `  - ${p}（磁盘原值：${JSON.stringify(v)}）`;
    });
    throw new Error(
      `[config-builder] UPDATE 配置写入被拒：以下字段路径不在 configWritePayload 白名单` +
        `（SSOT：framework-init SKILL §S2.1），AI 不得越权修改：\n${lines.join('\n')}\n` +
        `未变更内容仍会从磁盘基底原样保留；请把这些字段的修改移出 configWritePayload。`,
    );
  }
}

function topSegmentOf(dotted: string): string {
  const i = dotted.indexOf('.');
  return i < 0 ? dotted : dotted.slice(0, i);
}

function readPathValue(obj: Record<string, unknown>, dotted: string): unknown {
  let cur: unknown = obj;
  for (const part of dotted.split('.')) {
    if (!isPlainObject(cur) || !hasOwn(cur, part)) return undefined;
    cur = cur[part];
  }
  return cur;
}

/** 已知大小写变体 → canonical 导出入口文件名（继承自旧 derive 的行为；写盘侧统一收口）。 */
const CANONICAL_EXPORTS_FILE_ALIASES: Record<string, string> = {
  'Index.ets': 'index.ets',
  'INDEX.ETS': 'index.ets',
  Index: 'index',
  INDEX: 'index',
};

/**
 * UPDATE 定点覆盖的第三来源——「normalize 补默认值 vs BACKFILL」差集的专用裁定项（plan 要求
 * 逐项记录，见下）：

 *   | normalizeConfig 补的字段                | BACKFILL 覆盖? | 裁定 |
 *   |----------------------------------------|----------------|------|
 *   | schema_version='1.1'                   | ✓ schema_version | 已覆盖 |
 *   | active_workflow='spec-driven'          | ✓                 | 已覆盖 |
 *   | lifecycle_hooks_enabled=true           | ✓                 | 已覆盖 |
 *   | paths.* 结构默认缺叶                   | ✓（不含 conventions） | conventions 为 opt-in，UPDATE 不自动回填，运行时默认值兜底 |
 *   | state_machine.* 4 键                   | ✓ 全部           | 已覆盖 |
 *   | tools.* / spec.* / coding.* profile 缺叶 | ✓（profile-owned）| 已覆盖 |
 *   | architecture.cross_module_exports_file 已知大小写变体 | ✗ | **保留专门覆盖**：KNOWN 变体（Index.ets/INDEX.ETS/Index/INDEX）写盘时归一为 canonical（旧 derive 既有行为，落盘单点收口） |
 *   | project_name='unknown'                 | ✗                 | 不落盘：用户必填，assertRequiredForProfile 强制存在 |
 *   | project_type（sub_variant 派生别名）    | ✗                 | 不落盘：legacy 别名，写盘 sanitizer 剥离 |
 *   | agent_adapter='generic'                | ✗                 | 不落盘：personal 字段，写盘 sanitizer 剥离 |
 *   | materialized_adapters=['generic']      | ✗                 | 不落盘：decision SSOT + project scope preflight 强制非空 |
 *   | project_profile={name}                 | ✗                 | **保留专门覆盖**：缺失时以 profileName 兜底（与 CREATE 同口径） |
 *   | architecture 缺叶（module_inner_layers / inner_dependency_direction / cross_module_exports_file） | ✗ | **保留专门覆盖**：缺失叶从 profile config-defaults 补齐（等价 normalizeArchitecture 的 fallback 语义；outer_layers 不臆造，缺失由 assertRequiredForProfile 拒绝） |
 *   | paths.agent_bundle_root / agent_bundle_skill_mode | ✗ | **保留专门覆盖**：镜像 config.ts mergeAgentBundlePathDefaults（inline→bridge 是落盘单点收口契约，见 config.ts 注释；generic 缺根补 '.agents'） |
 *
 * 全部「保留专门覆盖」项均只作用于**缺失/非法遗留**，不对既有合法值覆写——与 BACKFILL
 * 的"只补缺"纪律一致，不会把丢字段缺陷换成缺默认值缺陷。
 */
function applyUpdateCanonicalization(
  merged: Record<string, unknown>,
  profileName: string,
): void {
  const arch = merged.architecture;
  if (isPlainObject(arch)) {
    // cross_module_exports_file 已知大小写变体归一（旧 derive 的既有行为，写盘单点收口）
    const exportsFile = arch.cross_module_exports_file;
    if (typeof exportsFile === 'string' && CANONICAL_EXPORTS_FILE_ALIASES[exportsFile] !== undefined) {
      arch.cross_module_exports_file = CANONICAL_EXPORTS_FILE_ALIASES[exportsFile]!;
    }
    const defaults = loadProfileConfigDefaults(profileName).architecture;
    if (isPlainObject(defaults)) {
      for (const key of [
        'module_inner_layers',
        'inner_dependency_direction',
        'cross_module_exports_file',
      ]) {
        if (!hasOwn(arch, key) && defaults[key] !== undefined) {
          arch[key] = deepClone(defaults[key]);
        }
      }
    }
  }
  if (!isPlainObject(merged.project_profile)) {
    merged.project_profile = { name: profileName };
  }
  // paths.agent_bundle_*：与 config.ts mergeAgentBundlePathDefaults 同口径（inline→bridge
  // 为全局收口，generic 缺根补 '.agents'；非 generic 不臆造根路径）。
  if (isPlainObject(merged.paths)) {
    const paths = merged.paths;
    const mode = paths.agent_bundle_skill_mode;
    if (mode !== undefined && mode !== 'bridge') {
      paths.agent_bundle_skill_mode = 'bridge';
    }
    const isGeneric =
      Array.isArray(merged.materialized_adapters)
        ? merged.materialized_adapters.includes('generic')
        : true;
    if (isGeneric) {
      const root = paths.agent_bundle_root;
      if (typeof root !== 'string' || !root.trim()) {
        paths.agent_bundle_root = '.agents';
      }
      if (paths.agent_bundle_skill_mode === undefined) {
        paths.agent_bundle_skill_mode = 'bridge';
      }
    }
  }
}

/**
 * UPDATE 写盘候选（plan a7c3f9e2 t2a v6）：
 *   基底 = 磁盘 raw 完整深拷贝 → sanitizer（agent_adapter/project_type/devEco 剥离，
 *   显式例外，理由见 sanitizeProjectConfigForInitWrite）→ BACKFILL 补缺 →
 *   白名单 payload 定点覆盖 → 差集裁定项 → assertRequiredForProfile →
 *   validateFrameworkConfigWriteCandidate **影子校验**（非法 canonical 仍抛错，
 *   返回值不落盘）。
 *
 * 调用方须先经 assertConfigWriteChangesWhitelisted 完成 t2b 授权（本函数不再重复 diff）。
 */
export function buildUpdateConfigForWrite(
  sanitizedPayload: Record<string, unknown>,
  baseline: Record<string, unknown>,
): Record<string, unknown> {
  const payloadOverlay: Record<string, unknown> = {};
  for (const k of Object.keys(sanitizedPayload)) {
    if (CONFIG_WRITE_PAYLOAD_ALLOWED_TOP_KEYS.has(k)) {
      payloadOverlay[k] = sanitizedPayload[k];
    }
  }
  const profileName = resolveEffectiveProfileName(sanitizedPayload, { existingConfig: baseline });

  let merged = deepClone(baseline);
  merged = sanitizeProjectConfigForInitWrite(merged);
  merged = mergeBackfillFields(merged, profileName).merged;
  merged = deepMergeRecords(merged, payloadOverlay);
  applyUpdateCanonicalization(merged, profileName);
  assertRequiredForProfile(merged, profileName);
  // 影子校验：normalize + 架构/state_machine/agent-bundle 硬校验照常抛错，
  // 但**其返回值不得直接作为写盘内容**（normalize 显式重建会丢未知嵌套扩展键）。
  void validateFrameworkConfigWriteCandidate(merged as Partial<FrameworkConfig>);
  return sanitizeProjectConfigForInitWrite(merged);
}

/** inputs.project_profile.name → existingConfig → explicit option → hmos-app */
export function resolveEffectiveProfileName(
  inputs: Record<string, unknown>,
  options?: BuildProjectConfigOptions,
): string {
  const ppIn = inputs.project_profile;
  if (ppIn && typeof ppIn === 'object' && !Array.isArray(ppIn)) {
    const name = (ppIn as Record<string, unknown>).name;
    if (typeof name === 'string' && name.trim()) return name.trim();
  }
  if (options?.profileName?.trim()) return options.profileName.trim();
  if (options?.existingConfig) {
    return resolveProfileNameFromRaw(options.existingConfig);
  }
  return 'hmos-app';
}

function buildFrameworkWriteDefaults(profileName: string): Record<string, unknown> {
  return nestedObjectFromBackfillFields(getEffectiveBackfillFields(profileName));
}

export function readExistingConfigFromDisk(projectRoot: string): Record<string, unknown> | undefined {
  const cfgPath = path.join(projectRoot, 'framework.config.json');
  if (!fs.existsSync(cfgPath)) return undefined;
  try {
    const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf-8')) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/**
 * 落盘前断言：effective 结构默认叶子 + project_name + architecture 四个 DSL 顶层字段
 *（outer_layers、module_inner_layers、inner_dependency_direction、cross_module_exports_file）。
 */
export function assertRequiredForProfile(
  payload: Record<string, unknown>,
  profileName: string,
): void {
  for (const f of getEffectiveBackfillFields(profileName)) {
    if (!hasDottedKey(payload, f.path)) {
      throw new Error(`[config-builder] 落盘对象缺少结构字段: ${f.path}`);
    }
  }
  if (typeof payload.project_name !== 'string' || !payload.project_name.trim()) {
    throw new Error('[config-builder] 落盘对象缺少 project_name（须由 S2 inputs 或旧 config 提供）');
  }
  const arch = payload.architecture;
  if (!arch || typeof arch !== 'object' || Array.isArray(arch)) {
    throw new Error('[config-builder] 落盘对象缺少 architecture');
  }
  const layers = (arch as Record<string, unknown>).outer_layers;
  if (!Array.isArray(layers) || layers.length === 0) {
    throw new Error('[config-builder] architecture.outer_layers 不能为空');
  }
  const innerLayers = (arch as Record<string, unknown>).module_inner_layers;
  if (!Array.isArray(innerLayers) || innerLayers.length === 0) {
    throw new Error('[config-builder] architecture.module_inner_layers 不能为空');
  }
  const direction = (arch as Record<string, unknown>).inner_dependency_direction;
  if (typeof direction !== 'string' || !direction.trim()) {
    throw new Error('[config-builder] architecture.inner_dependency_direction 缺失');
  }
  const exportsFile = (arch as Record<string, unknown>).cross_module_exports_file;
  if (typeof exportsFile !== 'string' || !exportsFile.trim()) {
    throw new Error('[config-builder] architecture.cross_module_exports_file 缺失');
  }
}

/**
 * 确定性合成写盘 config：framework 结构默认 + profile 默认（仅作 architecture 等回退）+ inputs 优先。
 */
export function buildProjectConfigForWrite(
  inputs: Record<string, unknown>,
  options: BuildProjectConfigOptions = {},
): Record<string, unknown> {
  const profileName = resolveEffectiveProfileName(inputs, options);
  const profileDefaults = loadProfileConfigDefaults(profileName);

  let merged = buildFrameworkWriteDefaults(profileName);

  const profileStructural: Record<string, unknown> = {};
  if (profileDefaults.tools && typeof profileDefaults.tools === 'object') {
    profileStructural.tools = profileDefaults.tools;
  }
  merged = deepMergeRecords(merged, profileStructural);
  merged = deepMergeRecords(merged, inputs);

  const existing = options.existingConfig ?? undefined;
  if (existing) {
    if (
      (typeof merged.project_name !== 'string' || !String(merged.project_name).trim()) &&
      typeof existing.project_name === 'string' &&
      existing.project_name.trim()
    ) {
      merged.project_name = existing.project_name;
    }
    if (!merged.architecture && existing.architecture) {
      merged.architecture = existing.architecture;
    }
    if (!merged.project_profile && existing.project_profile) {
      merged.project_profile = existing.project_profile;
    }
  }

  if (!merged.architecture && profileDefaults.architecture) {
    merged.architecture = profileDefaults.architecture;
  }
  if (!merged.project_profile && profileDefaults.project_profile) {
    merged.project_profile = applyDefaults(
      (merged.project_profile as Record<string, unknown> | undefined) ?? {},
      profileDefaults.project_profile,
    );
  } else if (
    merged.project_profile &&
    typeof merged.project_profile === 'object' &&
    !Array.isArray(merged.project_profile)
  ) {
    const pp = merged.project_profile as Record<string, unknown>;
    if (typeof pp.name !== 'string' || !pp.name.trim()) {
      pp.name = profileName;
    }
  } else {
    merged.project_profile = { name: profileName };
  }

  const sanitized = sanitizeProjectConfigForInitWrite(merged);
  const normalized = validateFrameworkConfigWriteCandidate(sanitized as Partial<FrameworkConfig>);
  const toWrite = sanitizeProjectConfigForInitWrite(
    JSON.parse(JSON.stringify(normalized)) as Record<string, unknown>,
  );
  assertRequiredForProfile(toWrite, profileName);
  return toWrite;
}

/**
 * preflight 与 ensure-config 共用：统一读旧 config + 调 builder，保证 byte-for-byte 一致。
 *
 * 模式分流（plan a7c3f9e2 t2a/t2b）：
 *   - 磁盘无 config → CREATE：现有完整归一化流程不变（buildProjectConfigForWrite），
 *     输入字段须全部落在 t2b 白名单内；
 *   - 磁盘有 config → UPDATE：以磁盘 raw 完整深拷贝为基底做定点覆盖
 *     （buildUpdateConfigForWrite），payload 相对 baseline 的变更字段须在白名单内，
 *     normalizeConfig 仅作影子校验。
 */
export function prepareConfigWriteForTask(
  ctx: PrepareConfigWriteContext,
  _action: 'run' | 'skip' | 'overwrite' | 'keep',
): Record<string, unknown> {
  if (!ctx.configWritePayload) {
    throw new Error('prepareConfigWriteForTask：configWritePayload 缺失');
  }
  const sanitized = sanitizeProjectConfigForInitWrite(ctx.configWritePayload);
  const existingConfig = readExistingConfigFromDisk(ctx.projectRoot);
  if (!existingConfig) {
    assertConfigWriteChangesWhitelisted(sanitized, {}, 'create');
    return buildProjectConfigForWrite(sanitized, {});
  }
  assertConfigWriteChangesWhitelisted(sanitized, existingConfig, 'update');
  return buildUpdateConfigForWrite(sanitized, existingConfig);
}
