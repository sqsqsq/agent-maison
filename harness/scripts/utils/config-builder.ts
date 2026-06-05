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
  resolveProfileNameFromRaw,
  sanitizeProjectConfigForInitWrite,
  type BackfillField,
} from './config-field-merger';

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
 */
export function prepareConfigWriteForTask(
  ctx: PrepareConfigWriteContext,
  _action: 'run' | 'skip' | 'overwrite' | 'keep',
): Record<string, unknown> {
  if (!ctx.configWritePayload) {
    throw new Error('prepareConfigWriteForTask：configWritePayload 缺失');
  }
  const existingConfig = readExistingConfigFromDisk(ctx.projectRoot);
  return buildProjectConfigForWrite(ctx.configWritePayload, { existingConfig });
}
