// ============================================================================
// Profile host 模块加载（根 harness 按 project_profile 动态 require）
// ============================================================================
// 约定：各 profile 在 `framework/profiles/<name>/harness/*.ts` 导出实现，
// 根目录 `check-coding` / `check-ut` / `check-testing` 只负责编排与 SSOT 读取，
// 不硬编码宿主路径、扩展名或工具链名词。
// ============================================================================

import * as path from 'path';
import type { GraphExtractor } from './graph-extractor/types';
import type { CheckContext, CheckResult } from './scripts/utils/types';
import type { FileAnalysis } from './scripts/utils/ast-analyzer';

/** ArkTS / 其它宿主下由 profile 贡献的源码后缀列表（不含点也可，调用方 normalize） */
export type ProfileCodingHost = {
  readonly sourceFileSuffixes: readonly string[];
  runStructureChecks(ctx: CheckContext, analyses: FileAnalysis[]): CheckResult[];
  runTraceabilityChecks(ctx: CheckContext): CheckResult[];
  /** 真实编译闭环（工具链与失败归因文案由 profile 承担；根 check-coding 仅编排） */
  checkCodingCompile(ctx: CheckContext): CheckResult[];
  /**
   * 可选 lint provider（C1 feature-track：lite exit 门禁派发点）。
   * 未实现 = 宿主无 lint 工具链声明——exit 侧呈现 MAJOR WARN 可见缺项，不阻断闭环。
   */
  checkCodingLint?(ctx: CheckContext): CheckResult[] | Promise<CheckResult[]>;
};

// UtHostSuggestionPaths / getUtSuggestionPaths 已退役（plan f4c8d2b7 t5）：
// 模板路径统一解析自 profiles/<profile>/skills/skill-assets.yaml（见 utils/ut-template-paths.ts），
// 不再由各 profile host impl 维护平行硬编码路径表。

export type UtFileEntry = { path: string; content: string };

export type UtFilePartition = {
  all: UtFileEntry[];
  scoped: UtFileEntry[];
  scopeSources: string[];
  scopeDiagnostics?: string[];
};

export type UtHostImpl = {
  loadUtFiles(ctx: CheckContext): UtFileEntry[];
  /** 可选：将全量 UT 文件分区为 all（编译/注册）与 scoped（追溯/命名） */
  partitionUtFiles?(ctx: CheckContext, allUtFiles: UtFileEntry[]): UtFilePartition;
  checkUtFileNaming(
    ctx: CheckContext,
    utFiles: Array<{ path: string }>,
  ): CheckResult[];
  checkUtFrameworkImport(
    ctx: CheckContext,
    utFiles: Array<{ path: string; content: string }>,
  ): CheckResult[];
  checkUtTscCompiles(
    ctx: CheckContext,
    utFiles: Array<{ path: string; content: string }>,
  ): CheckResult[];
  checkUtHvigorBuild(
    ctx: CheckContext,
    scopedUtFiles?: Array<{ path: string }>,
    /** 基线新增（本 feature 责任域）的 scoped UT 文件；用于编译顺序：feature 归属模块优先 */
    featureNewUtFiles?: Array<{ path: string }>,
  ): CheckResult[];
  checkUtHvigorTest(
    ctx: CheckContext,
    scopedUtFiles?: Array<{ path: string }>,
    /** 本 feature 责任域用例（含文件路径，供推导 module::test 身份；target 失败永不豁免） */
    targetCases?: Array<{ path: string; test: string }>,
  ): CheckResult[];
  checkTestRegistration(
    ctx: CheckContext,
    utFiles: Array<{ path: string }>,
  ): CheckResult[];
  isSuiteEntryShim(content: string): boolean;
  /** 可选：profile 额外扫描 harnessRoot 下宿主测试产物（如 ohosTest / *.test.ets） */
  collectHarnessPollutionExtras?(ctx: CheckContext): string[];
};

export type UtSourceRootResolver = (
  projectRoot: string,
  modules: ReadonlyArray<{ name: string; package_path: string }>,
) => string[];

/**
 * Best-effort 加载 `profiles/<profile>/harness/<baseName>`（无扩展名，与 Node 解析一致）。
 * 失败返回 null；最近一次 require 错误可通过 getLastProfileHarnessLoadError 读取，
 * 并向 stderr 输出一行诊断（由调用方决定 FAIL / SKIP 语义）。
 */
let lastProfileHarnessLoadError: string | undefined;

export function getLastProfileHarnessLoadError(): string | undefined {
  return lastProfileHarnessLoadError;
}

export function tryLoadProfileHarnessModule<T>(profileDir: string, baseName: string): T | null {
  try {
    lastProfileHarnessLoadError = undefined;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require(path.join(profileDir, 'harness', baseName)) as T;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    lastProfileHarnessLoadError = message;
    process.stderr.write(`[profile-host-loader] require failed: ${baseName}: ${message}\n`);
    return null;
  }
}

export function tryLoadProfileCodingHost(profileDir: string): ProfileCodingHost | null {
  const m = tryLoadProfileHarnessModule<{ profileCodingHost?: ProfileCodingHost }>(
    profileDir,
    'coding-host-rules',
  );
  const h = m?.profileCodingHost;
  if (!h || !Array.isArray(h.sourceFileSuffixes)) return null;
  if (
    typeof h.runStructureChecks !== 'function' ||
    typeof h.runTraceabilityChecks !== 'function' ||
    typeof h.checkCodingCompile !== 'function'
  ) {
    return null;
  }
  return h;
}

export function tryLoadUtHostImpl(profileDir: string): UtHostImpl | null {
  const m = tryLoadProfileHarnessModule<{ utHostImpl?: UtHostImpl }>(profileDir, 'ut-host-impl');
  const u = m?.utHostImpl;
  if (!u) return null;
  const keys: (keyof UtHostImpl)[] = [
    'loadUtFiles',
    'checkUtFileNaming',
    'checkUtFrameworkImport',
    'checkUtTscCompiles',
    'checkUtHvigorBuild',
    'checkUtHvigorTest',
    'checkTestRegistration',
    'isSuiteEntryShim',
  ];
  for (const k of keys) {
    if (typeof u[k] !== 'function') return null;
  }
  return u;
}

type GraphExtractorModule = {
  graphExtractor?: GraphExtractor;
  hmosGraphExtractor?: GraphExtractor;
};

function pickGraphExtractor(m: GraphExtractorModule | null): GraphExtractor | null {
  const g = m?.graphExtractor ?? m?.hmosGraphExtractor;
  if (!g || typeof g.extractModule !== 'function' || typeof g.profileId !== 'string') {
    return null;
  }
  return g;
}

/** Code Graph 派生层抽取（profile host impl，不经 capability registry） */
export function tryLoadGraphExtractor(profileDir: string): GraphExtractor | null {
  for (const baseName of ['graph-extractor', 'hmos-graph-extractor'] as const) {
    const g = pickGraphExtractor(
      tryLoadProfileHarnessModule<GraphExtractorModule>(profileDir, baseName),
    );
    if (g) return g;
  }
  return null;
}

/** git diff 业务源码过滤：测试工作区路径排除（正则作用于正斜杠路径） */
export function tryLoadDiffExcludeTestPathRegexes(profileDir: string): RegExp[] | null {
  const m = tryLoadProfileHarnessModule<{ diffExcludeTestPathRegexes?: RegExp[] }>(
    profileDir,
    'profile-path-conventions',
  );
  const rx = m?.diffExcludeTestPathRegexes;
  if (!Array.isArray(rx) || !rx.every(r => r instanceof RegExp)) return null;
  return rx;
}

/** Profile-owned UT path convention used by the phase write-owner resolver. */
export function tryLoadUtSourceRootResolver(profileDir: string): UtSourceRootResolver | null {
  const m = tryLoadProfileHarnessModule<{ resolveUtSourceRoots?: UtSourceRootResolver }>(
    profileDir,
    'profile-path-conventions',
  );
  return typeof m?.resolveUtSourceRoots === 'function' ? m.resolveUtSourceRoots : null;
}
