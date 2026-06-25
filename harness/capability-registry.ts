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
import { normalizeCapabilityKey } from './scripts/utils/capability-alias';
import * as path from 'path';

export function getCapability(
  resolved: HarnessResolvedProfile,
  key: CapabilityKey | string,
): ProfileCapabilitySpec | undefined {
  const canon = normalizeCapabilityKey(String(key));
  return resolved.capabilities[canon];
}

/** generic 等 profile 声明 SKIP 时，脚本层应返回 SKIP 而非调用工具链 */
export function isCapabilitySkipped(resolved: HarnessResolvedProfile, key: CapabilityKey): boolean {
  const c = resolved.capabilities[key];
  return c !== undefined && c.severity === 'SKIP';
}

/** coding.deps_install 是否可执行（profile 声明 provider 且非 SKIP） */
export function isDepsInstallExecutable(resolved: HarnessResolvedProfile): boolean {
  const c = getCapability(resolved, 'coding.deps_install');
  if (!c || c.severity === 'SKIP') return false;
  const provider = c.provider?.trim();
  return Boolean(provider && provider !== 'none');
}

export function isSpecVisualHandoffSkipped(resolved: HarnessResolvedProfile): boolean {
  return isCapabilitySkipped(resolved, 'spec.visual_handoff');
}

export function isSpecUiSpecSkipped(resolved: HarnessResolvedProfile): boolean {
  return isCapabilitySkipped(resolved, 'spec.ui_spec');
}

export function isSpecAssetAcquisitionSkipped(resolved: HarnessResolvedProfile): boolean {
  return isCapabilitySkipped(resolved, 'spec.asset_acquisition');
}

export function isCodingVisualParitySkipped(resolved: HarnessResolvedProfile): boolean {
  return isCapabilitySkipped(resolved, 'coding.visual_parity');
}

export function isPlanVisualParitySkipped(resolved: HarnessResolvedProfile): boolean {
  return isCapabilitySkipped(resolved, 'plan.visual_parity');
}

export function isDeviceVisualDiffSkipped(resolved: HarnessResolvedProfile): boolean {
  return isCapabilitySkipped(resolved, 'device_test.visual_diff');
}

/** @deprecated v2.3 起改用 `isSpecVisualHandoffSkipped` */
export const isPrdVisualHandoffSkipped = isSpecVisualHandoffSkipped;

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
  ohpm: 'deps-install',
  hvigor: 'coding-compile',
  hvigor_ohostest: 'ut-compile',
  hvigor_hypium: 'ut-run',
  hvigor_app: 'device-test-build',
  hdc: 'device-test',
  hdc_app: 'device-test-install',
  hylyre: 'device-test-run',
  script: 'spec-visual-handoff',
  script_ui_spec: 'spec-ui-spec',
  script_visual_parity: 'coding-visual-parity',
  script_visual_parity_plan: 'plan-visual-parity',
  script_asset_acquisition: 'spec-asset-acquisition',
  hylyre_visual_diff: 'device-test-visual-diff',
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

export function dispatchDepsInstall(
  ctx: CheckContext,
  options: Record<string, unknown>,
): any {
  const fn = requireProviderFunction(ctx.resolvedProfile, 'coding.deps_install', 'installProjectDeps');
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
  return fn(ctx.projectRoot, result, ctx.frameworkRoot);
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
  return fn(ctx.projectRoot, result, ctx.frameworkRoot);
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

export function dispatchSpecVisualHandoff(ctx: CheckContext, specMarkdown: string): CheckResult[] {
  const fn = requireProviderFunction<(c: CheckContext, p: string) => CheckResult[]>(
    ctx.resolvedProfile,
    'spec.visual_handoff',
    'checkVisualHandoff',
  );
  const govFn = requireProviderFunction<(c: CheckContext, p: string) => CheckResult[]>(
    ctx.resolvedProfile,
    'spec.visual_handoff',
    'checkFidelityGovernance',
  );
  const snapFn = requireProviderFunction<(c: CheckContext, p: string) => CheckResult[]>(
    ctx.resolvedProfile,
    'spec.visual_handoff',
    'checkFidelitySnapshotPromise',
  );
  const structFn = requireProviderFunction<(c: CheckContext, p: string) => CheckResult[]>(
    ctx.resolvedProfile,
    'spec.visual_handoff',
    'checkStructuredRefElements',
  );
  const lockConflictFn = requireProviderFunction<(c: CheckContext, p: string) => CheckResult[]>(
    ctx.resolvedProfile,
    'spec.visual_handoff',
    'checkAuthoritativeRefLockConflicts',
  );
  // checkStructuredRefElements 注入 ctx.refElementsManifest；须在本 dispatch 完成后再跑 dispatchSpecUiSpec
  // （capture-completeness 同 run 优先读内存 manifest，调序则退化为只读磁盘 ref-elements.yaml）。
  return [
    ...fn(ctx, specMarkdown),
    ...govFn(ctx, specMarkdown),
    ...snapFn(ctx, specMarkdown),
    ...structFn(ctx, specMarkdown),
    ...lockConflictFn(ctx, specMarkdown),
  ];
}

export function dispatchSpecUiSpec(ctx: CheckContext, specMarkdown: string): CheckResult[] {
  const fn = requireProviderFunction<(c: CheckContext, p: string) => CheckResult[]>(
    ctx.resolvedProfile,
    'spec.ui_spec',
    'checkUiSpecStructure',
  );
  const gateFn = requireProviderFunction<(c: CheckContext, p: string) => CheckResult[]>(
    ctx.resolvedProfile,
    'spec.ui_spec',
    'checkUiSpecFidelityGate',
  );
  const captureFn = requireProviderFunction<(c: CheckContext, p: string) => CheckResult[]>(
    ctx.resolvedProfile,
    'spec.ui_spec',
    'checkCaptureCompleteness',
  );
  // 消费 dispatchSpecVisualHandoff 注入的 ctx.refElementsManifest（structured 第二刀）；须在其之后派发。
  return [...fn(ctx, specMarkdown), ...gateFn(ctx, specMarkdown), ...captureFn(ctx, specMarkdown)];
}

export function dispatchSpecAssetAcquisition(ctx: CheckContext): CheckResult[] {
  const fn = requireProviderFunction<(c: CheckContext) => CheckResult[]>(
    ctx.resolvedProfile,
    'spec.asset_acquisition',
    'checkAssetAcquisition',
  );
  const manifestFn = requireProviderFunction<(c: CheckContext) => CheckResult[]>(
    ctx.resolvedProfile,
    'spec.asset_acquisition',
    'checkAssetManifest',
  );
  return [...fn(ctx), ...manifestFn(ctx)];
}

export function dispatchCodingVisualParity(ctx: CheckContext): CheckResult[] {
  const fn = requireProviderFunction<(c: CheckContext) => CheckResult[]>(
    ctx.resolvedProfile,
    'coding.visual_parity',
    'checkVisualParity',
  );
  return fn(ctx);
}

export function dispatchPlanVisualParity(ctx: CheckContext): CheckResult[] {
  const fn = requireProviderFunction<(c: CheckContext) => CheckResult[]>(
    ctx.resolvedProfile,
    'plan.visual_parity',
    'checkVisualParityCoverage',
  );
  return fn(ctx);
}

export function dispatchDeviceVisualDiff(ctx: CheckContext): CheckResult[] {
  const fn = requireProviderFunction<(c: CheckContext) => CheckResult[]>(
    ctx.resolvedProfile,
    'device_test.visual_diff',
    'checkVisualDiff',
  );
  return fn(ctx);
}

/** @deprecated v2.3 起改用 `dispatchSpecVisualHandoff` */
export const dispatchPrdVisualHandoff = dispatchSpecVisualHandoff;

export function dispatchDeviceTestBuild(
  ctx: CheckContext,
  options: Record<string, unknown>,
): unknown {
  const fn = requireProviderFunction(ctx.resolvedProfile, 'device_test.build', 'runDeviceTestAppBuild');
  return fn(options);
}

export function dispatchDeviceTestInstall(
  ctx: CheckContext,
  options: Record<string, unknown>,
): unknown {
  const fn = requireProviderFunction(ctx.resolvedProfile, 'device_test.install', 'installDeviceTestApp');
  return fn(options);
}

export function dispatchDeviceTestEnsureReady(
  ctx: CheckContext,
  options: Record<string, unknown>,
): unknown {
  const fn = requireProviderFunction(ctx.resolvedProfile, 'device_test.run', 'ensureHylyreReady');
  return fn(options);
}

export function dispatchDeviceTestRun(
  ctx: CheckContext,
  options: Record<string, unknown>,
): unknown {
  const fn = requireProviderFunction(ctx.resolvedProfile, 'device_test.run', 'runHylyreDeviceTest');
  return fn(options);
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
