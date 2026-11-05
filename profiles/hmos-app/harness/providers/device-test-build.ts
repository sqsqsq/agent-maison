/**
 * device_test.build → provider `hvigor_app`
 */
import * as fs from 'fs';
import * as path from 'path';
import { featurePhaseReportsDir } from '../../../../harness/config';
import type { CapabilityProvider } from './types';
import {
  runHvigorAssembleApp,
  discoverAppHapArtifacts,
  detectStaleSignedSuspect,
  isHvigorBuildSuccessful,
  type HvigorRunResult,
  type HapDiscoveryCandidate,
} from '../hvigor-runner';
import {
  resolveProductSelection,
  buildProductSelectionUnresolvedGuidance,
  summarizeUnresolvedCause,
  type ProductSelection,
} from '../product-selection';
import { computeHapSha256Full } from '../build-fingerprint';
import { evaluateDeviceTestBuildReuse } from '../device-test-build-reuse';
// plan d8c5f3a7 T4 接线：构建**当刻**把源码快照绑定到 HAP——抓 self-revert 的关键一环

export const provider: CapabilityProvider = {
  id: 'hvigor_app',
  capability: 'device_test.build',
  exports: ['runDeviceTestAppBuild'],
};

export interface DeviceTestBuildOptions {
  projectRoot: string;
  harnessRoot: string;
  frameworkRoot?: string;
  feature: string;
  phase: string;
  product?: string;
  buildMode?: 'debug' | 'release';
  skipEnvVar?: string;
}

export interface DeviceTestBuildResult {
  hvigor: HvigorRunResult;
  hapPath: string | null;
  resolvedProduct: string;
  resolvedBuildMode: 'debug' | 'release';
  reused?: boolean;
  hapMtimeMs?: number | null;
  hapBuiltAt?: string | null;
  inputsMaxMtimeMs?: number;
  reuseReason?: string;
  /** 实际扫描过的 outputs 目录（plan d7e4b2a9 t1；命中/未命中都记录，供 FAIL 文案列出） */
  scannedDirs?: string[];
  /** 所选 product 的诊断候选，按稳定优先级排序；未通过验证时 hapPath 仍为 null。 */
  candidates?: HapDiscoveryCandidate[];
  /** 配对 unsigned 比 signed 新时，不采用 signed。 */
  staleSuspect?: boolean;
  staleSuspectUnsignedPath?: string | null;
  staleSuspectNote?: string;
  /** t5（plan a7c3f9e2）：本次构建前单次解析的 ProductSelection（分类/报告用），unresolved 时另有 product=null */
  productSelection?: ProductSelection;
  artifactValidation?: ReturnType<typeof detectStaleSignedSuspect>;
  hapSha256Full?: string | null;
}

function writeBuildResultSummary(
  reportDir: string,
  payload: Record<string, unknown>,
): void {
  fs.mkdirSync(reportDir, { recursive: true });
  const summaryPath = path.join(reportDir, 'device-test-build.result.json');
  fs.writeFileSync(summaryPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
}

function reusedHvigorStub(reason: string, prior: Record<string, unknown> = {}): HvigorRunResult {
  return {
    executed: false,
    exitCode: 0,
    durationMs: 0,
    logExcerpt: reason,
    errors: [],
    successMarkerFound: true,
    command: typeof prior.hvigorCommand === 'string' ? prior.hvigorCommand : undefined,
    logPath: typeof prior.hvigorLogPath === 'string' ? prior.hvigorLogPath : undefined,
    metaPath: typeof prior.hvigorMetaPath === 'string' ? prior.hvigorMetaPath : undefined,
    environment: prior.environment as HvigorRunResult['environment'],
  };
}

/** unresolved 阻断桩：exitCode=1 + 引导文案 → 上游（check-testing 门禁）按 FAIL 报告，不崩溃。 */
function unresolvedHvigorStub(selection: ProductSelection): HvigorRunResult {
  const guidance = buildProductSelectionUnresolvedGuidance(selection);
  return {
    executed: false,
    exitCode: 1,
    durationMs: 0,
    logExcerpt: `[product-selection unresolved]\n${guidance}`,
    errors: [{ message: summarizeUnresolvedCause(selection) }],
  };
}

/**
 * device-testing 出口的构建成功判据（导出供 t1(f) 生产路径回归：**真实出口函数**，
 * 与 coding/ut/check-testing 共用 isHvigorBuildSuccessful）。
 */
export function isDeviceTestBuildOk(res: HvigorRunResult): boolean {
  return isHvigorBuildSuccessful(res);
}

export function runDeviceTestAppBuild(opts: DeviceTestBuildOptions): DeviceTestBuildResult {
  // review P1（第二轮）：env 显式跳过必须在**任何解析/复用/HAP 扫描/daemon 操作之前**
  // 短路为 skippedByEnv 失败——否则 unresolved 会让位给 skip，selection.product=null
  // 空 product 扫到任意旧 HAP 即可 reuse:true，被 check-testing 判 PASS，
  // 重新引入"未确认编译形态却通过"的核心事故。
  const skipEnvVar = opts.skipEnvVar ?? 'HARNESS_SKIP_DEVICE_TEST_BUILD';
  if (process.env[skipEnvVar]) {
    const hvigor: HvigorRunResult = {
      executed: false,
      skippedByEnv: true,
      durationMs: 0,
      logExcerpt: `[skipped] env ${skipEnvVar}=${process.env[skipEnvVar]}`,
      errors: [],
    };
    return {
      hvigor,
      hapPath: null,
      resolvedProduct: '(skipped-by-env)',
      resolvedBuildMode: opts.buildMode ?? 'debug',
    };
  }

  // t5（plan a7c3f9e2 ⑤）：本作用域内只解析一次（purpose=device_test，读
  // HARNESS_DEVICE_TEST_PRODUCT env = confirmed_env，含 goal 冻结注入）；同一对象贯穿
  // 构建参数、复用判定、result 审计与 metaExtras 落盘（metaExtras 仅审计，不做运行时 carrier）。
  const selection = resolveProductSelection({
    projectRoot: opts.projectRoot,
    purpose: 'device_test',
    explicitProduct: opts.product,
  });
  if (selection.source === 'unresolved') {
    const hvigor = unresolvedHvigorStub(selection);
    try {
      writeBuildResultSummary(
        featurePhaseReportsDir(opts.projectRoot, opts.feature, opts.phase, opts.frameworkRoot),
        {
          reused: false,
          resolvedProduct: '(unresolved)',
          resolvedBuildMode: opts.buildMode ?? 'debug',
          hapPath: null,
          hvigorExecuted: false,
          hvigorExitCode: 1,
          hvigorDurationMs: 0,
          productSelection: {
            product: null,
            source: 'unresolved',
            candidates: selection.candidates,
            purpose: selection.purpose,
          },
          rejected: 'product_selection_unresolved',
          timestamp: new Date().toISOString(),
        },
      );
    } catch {
      /* best-effort */
    }
    return {
      hvigor,
      hapPath: null,
      resolvedProduct: '(unresolved)',
      resolvedBuildMode: opts.buildMode ?? 'debug',
      productSelection: selection,
    };
  }
  const reportDir = featurePhaseReportsDir(opts.projectRoot, opts.feature, opts.phase, opts.frameworkRoot);
  const reuseDecision = evaluateDeviceTestBuildReuse({
    projectRoot: opts.projectRoot,
    product: selection.product!,
    buildMode: opts.buildMode,
    reportDir,
  });
  const resolvedProduct = selection.product!;
  const resolvedBuildMode = reuseDecision.resolvedBuildMode;
  const hvigor = reuseDecision.reuse
    ? reusedHvigorStub(`复用 HAP（跳过 hvigor）：${reuseDecision.reason}`, reuseDecision.priorResult)
    : runHvigorAssembleApp({
        projectRoot: opts.projectRoot, harnessRoot: opts.harnessRoot, frameworkRoot: opts.frameworkRoot,
        feature: opts.feature, phase: opts.phase, skipEnvVar,
        product: resolvedProduct, buildMode: resolvedBuildMode,
        daemon: false,
        freezeDimensions: true,
        logBasename: 'hvigor-app-build.log',
        metaExtras: { productSelection: selection },
      });
  // 构建后重新发现；不能回退到构建前路径。增量 UP-TO-DATE 无需晚于启动时间。
  const discovery = discoverAppHapArtifacts(opts.projectRoot, resolvedProduct);
  const artifactValidation = discovery.signedPath ? detectStaleSignedSuspect(discovery.signedPath) : undefined;
  const processOk = reuseDecision.reuse || isDeviceTestBuildOk(hvigor);
  let hapPath = processOk && artifactValidation?.status === 'valid' ? discovery.signedPath : null;
  const hapSha256Full = hapPath ? computeHapSha256Full(hapPath) : null;
  if (!hapSha256Full) hapPath = null;
  const hapMtimeMs = artifactValidation?.signedMtimeMs ?? null;
  const hapBuiltAt = hapMtimeMs === null ? null : new Date(hapMtimeMs).toISOString();
  if (!hapPath) {
    const note = !processOk ? 'Hvigor 进程未通过，磁盘候选不能覆盖退出/超时/成功标记失败' : artifactValidation?.note ?? (discovery.signedPath
      ? 'signed HAP 内容摘要读取失败'
      : `所选 product=${resolvedProduct} 未发现 signed 主 HAP`);
    hvigor.diagnostics = [...(hvigor.diagnostics ?? []), note];
  }
  const result: DeviceTestBuildResult = {
    hvigor, hapPath, resolvedProduct, resolvedBuildMode, reused: reuseDecision.reuse,
    hapMtimeMs, hapBuiltAt, hapSha256Full: hapPath ? hapSha256Full : null,
    inputsMaxMtimeMs: reuseDecision.inputsMaxMtimeMs, reuseReason: reuseDecision.reason,
    scannedDirs: discovery.scannedDirs, candidates: discovery.candidates, productSelection: selection,
    artifactValidation,
    staleSuspect: artifactValidation?.staleSuspect,
    staleSuspectUnsignedPath: artifactValidation?.unsignedPath,
    staleSuspectNote: artifactValidation?.note,
  };
  try {
    writeBuildResultSummary(reportDir, {
      ...result, hvigor: undefined,
      buildSucceeded: Boolean(hapPath),
      hvigorExecuted: hvigor.executed, hvigorExitCode: hvigor.exitCode ?? null,
      hvigorDurationMs: hvigor.durationMs, hvigorLogPath: hvigor.logPath ?? null,
      hvigorMetaPath: hvigor.metaPath ?? null, environment: hvigor.environment,
      hvigorCommand: hvigor.command ?? null,
      candidateCount: discovery.candidates.length,
      timestamp: new Date().toISOString(),
    });
  } catch { /* best-effort：报告不可写只会使后续调用重新构建 */ }
  return result;
}
