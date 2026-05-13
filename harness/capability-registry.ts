// ============================================================================
// Capability registry（由 project profile 驱动，供 check-*.ts 查询）
// ============================================================================

import type {
  CheckContext,
  HarnessResolvedProfile,
  CapabilityKey,
  ProfileCapabilitySpec,
  CheckResult,
} from './scripts/utils/types';
import * as path from 'path';

export function getCapability(
  resolved: HarnessResolvedProfile,
  key: CapabilityKey,
): ProfileCapabilitySpec | undefined {
  return resolved.capabilities[key];
}

/** generic 等 profile 声明 SKIP 时，脚本层应返回 SKIP 而非调用工具链 */
export function isCapabilitySkipped(resolved: HarnessResolvedProfile, key: CapabilityKey): boolean {
  const c = resolved.capabilities[key];
  return c !== undefined && c.severity === 'SKIP';
}

export function isPrdVisualHandoffSkipped(resolved: HarnessResolvedProfile): boolean {
  return isCapabilitySkipped(resolved, 'prd.visual_handoff');
}

type ProviderModule = Record<string, unknown>;

interface ProviderMetadata {
  id: string;
  capability: CapabilityKey;
  exports: readonly string[];
}

/**
 * Provider 模块 ID → `profiles/<name>/harness/providers/<file>` 基名。
 *
 * 与「profile 静态规则包」（如 `coding-host-rules` / `ut-host-impl`）不同：
 * 后者由根 `check-*` 通过 `profile-host-loader` 按模块名直接 require，
 * 不经本表的 capability provider 路径。
 */
const PROVIDER_MODULE_BY_ID: Record<string, string> = {
  hvigor: 'coding-compile',
  hvigor_ohostest: 'ut-compile',
  hvigor_hypium: 'ut-run',
  hdc: 'device-test',
  script: 'prd-visual-handoff',
};

function requireCapabilityProvider(
  resolved: HarnessResolvedProfile,
  key: CapabilityKey,
): ProviderModule {
  const capability = getCapability(resolved, key);
  if (!capability) {
    throw new Error(`[capability-registry] profile=${resolved.name} 未声明 capability ${key}`);
  }

  const provider = capability.provider?.trim();
  if (!provider || provider === 'none' || capability.severity === 'SKIP') {
    throw new Error(
      `[capability-registry] capability ${key} 在 profile=${resolved.name} 中不可执行（provider=${provider ?? 'none'}, severity=${capability.severity}）`,
    );
  }

  const moduleName = PROVIDER_MODULE_BY_ID[provider] ?? provider;
  const modulePath = path.join(resolved.profileDir, 'harness', 'providers', moduleName);
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require(modulePath) as ProviderModule & { provider?: ProviderMetadata };
  const meta = mod.provider;
  if (!meta || typeof meta !== 'object') {
    throw new Error(
      `[capability-registry] provider=${provider} 缺少 provider metadata（profile=${resolved.name}, capability=${key}）`,
    );
  }
  if (meta.id !== provider) {
    throw new Error(
      `[capability-registry] provider metadata id 不匹配：声明=${provider}, 实现=${meta.id}（profile=${resolved.name}, capability=${key}）`,
    );
  }
  if (meta.capability !== key) {
    throw new Error(
      `[capability-registry] provider metadata capability 不匹配：期望=${key}, 实现=${meta.capability}（profile=${resolved.name}, provider=${provider}）`,
    );
  }
  return mod;
}

function requireProviderFunction<T extends (...args: any[]) => any>(
  resolved: HarnessResolvedProfile,
  key: CapabilityKey,
  exportName: string,
): T {
  const mod = requireCapabilityProvider(resolved, key);
  const meta = (mod as ProviderModule & { provider?: ProviderMetadata }).provider;
  if (meta && !meta.exports.includes(exportName)) {
    throw new Error(
      `[capability-registry] provider for ${key} 未在 metadata.exports 声明 ${exportName}（profile=${resolved.name}）`,
    );
  }
  const fn = mod[exportName];
  if (typeof fn !== 'function') {
    throw new Error(
      `[capability-registry] provider for ${key} 缺少导出函数 ${exportName}（profile=${resolved.name}）`,
    );
  }
  return fn as T;
}

export function dispatchCodingCompile(
  ctx: CheckContext,
  options: Record<string, unknown>,
): any {
  const fn = requireProviderFunction(ctx.resolvedProfile, 'coding.compile', 'runHvigorAssembleApp');
  return fn(options);
}

export function dispatchUtCompile(
  ctx: CheckContext,
  options: Record<string, unknown>,
): any {
  const fn = requireProviderFunction(ctx.resolvedProfile, 'ut.compile', 'runHvigorBuild');
  return fn(options);
}

export function dispatchUtRun(
  ctx: CheckContext,
  options: Record<string, unknown>,
): any {
  const fn = requireProviderFunction(ctx.resolvedProfile, 'ut.run', 'runHvigorTest');
  return fn(options);
}

export function probeUtRunDevices(ctx: CheckContext): any {
  const fn = requireProviderFunction(ctx.resolvedProfile, 'ut.run', 'probeDevices');
  return fn();
}

export function analyzeProjectDependencyIssueViaProfile(
  ctx: CheckContext,
  result: unknown,
): any {
  const fn = requireProviderFunction(
    ctx.resolvedProfile,
    'ut.compile',
    'analyzeProjectDependencyIssue',
  );
  return fn(ctx.projectRoot, result);
}

export function analyzeCodingDependencyIssueViaProfile(
  ctx: CheckContext,
  result: unknown,
): any {
  const fn = requireProviderFunction(
    ctx.resolvedProfile,
    'coding.compile',
    'analyzeProjectDependencyIssue',
  );
  return fn(ctx.projectRoot, result);
}

export function mergeUtCompileLogForClassification(ctx: CheckContext, result: unknown): string {
  const fn = requireProviderFunction(
    ctx.resolvedProfile,
    'ut.compile',
    'mergeHvigorLogForUtClassification',
  );
  return fn(result);
}

export function looksLikeUtCompileCommandMismatch(ctx: CheckContext, log: string): boolean {
  const fn = requireProviderFunction(
    ctx.resolvedProfile,
    'ut.compile',
    'looksLikeUtHvigorCommandMismatch',
  );
  return fn(log);
}

export function dispatchPrdVisualHandoff(ctx: CheckContext, prd: string): CheckResult[] {
  const fn = requireProviderFunction<(c: CheckContext, p: string) => CheckResult[]>(
    ctx.resolvedProfile,
    'prd.visual_handoff',
    'checkVisualHandoff',
  );
  return fn(ctx, prd);
}

/**
 * Rule id 对照（fixture / 报告兼容）：
 * - `coding_compile` ≡ 原 `coding_hvigor_build`（真实编译门禁）
 * - `ut_compile` ≡ 原 `ut_hvigor_build`
 * - `ut_run` ≡ 原 `ut_hvigor_test`
 * profile 声明 `SKIP` 时脚本层对上述规则产出 `SKIP`，并顺带写入 canonical id 行（明细相同）。
 */
export const LEGACY_CODING_COMPILE_ID = 'coding_hvigor_build';
export const CANONICAL_CODING_COMPILE_ID = 'coding_compile';
export const LEGACY_UT_COMPILE_ID = 'ut_hvigor_build';
export const CANONICAL_UT_COMPILE_ID = 'ut_compile';
export const LEGACY_UT_RUN_ID = 'ut_hvigor_test';
export const CANONICAL_UT_RUN_ID = 'ut_run';
