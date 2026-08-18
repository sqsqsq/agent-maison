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
  stopHvigorDaemon,
  isHvigorBuildSuccessful,
  type HvigorRunResult,
  type HapDiscoveryCandidate,
} from '../hvigor-runner';
import {
  resolveProductSelection,
  describeProductSelection,
  buildProductSelectionUnresolvedGuidance,
  summarizeUnresolvedCause,
  type ProductSelection,
} from '../product-selection';
import { resolveDeviceTestBuildMode } from '../testing-build-conventions';
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
  /** 全部候选 signed HAP，按稳定优先级排序（[0] 即 hapPath 所在候选）；>1 说明存在歧义 */
  candidates?: HapDiscoveryCandidate[];
  /** signed 是否可能基于上一轮 unsigned（plan d7e4b2a9 t2；纯观测，不阻断） */
  staleSuspect?: boolean;
  staleSuspectUnsignedPath?: string | null;
  staleSuspectNote?: string;
  /** t5（plan a7c3f9e2）：本次构建前单次解析的 ProductSelection（分类/报告用），unresolved 时另有 product=null */
  productSelection?: ProductSelection;
}

function writeBuildResultSummary(
  reportDir: string,
  payload: Record<string, unknown>,
): void {
  fs.mkdirSync(reportDir, { recursive: true });
  const summaryPath = path.join(reportDir, 'device-test-build.result.json');
  fs.writeFileSync(summaryPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
}

function reusedHvigorStub(reason: string): HvigorRunResult {
  return {
    executed: false,
    exitCode: 0,
    durationMs: 0,
    logExcerpt: reason,
    errors: [],
    successMarkerFound: true,
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
  const reuseDecision = evaluateDeviceTestBuildReuse({
    projectRoot: opts.projectRoot,
    // review P2：只传本次解析冻结的 product，reuse evaluator 不再二次解析。
    product: selection.product!,
    buildMode: opts.buildMode,
  });
  const resolvedProduct = selection.product!;
  const resolvedBuildMode = reuseDecision.resolvedBuildMode;
  const reportDir = featurePhaseReportsDir(opts.projectRoot, opts.feature, opts.phase, opts.frameworkRoot);

  if (reuseDecision.reuse && reuseDecision.hapPath) {
    const hvigor = reusedHvigorStub(`复用 HAP（跳过 hvigor）：${reuseDecision.reason}`);
    writeBuildResultSummary(reportDir, {
      reused: true,
      resolvedProduct,
      resolvedBuildMode,
      hapPath: reuseDecision.hapPath,
      hapMtimeMs: reuseDecision.hapMtimeMs,
      hapBuiltAt: reuseDecision.hapBuiltAt,
      inputsMaxMtimeMs: reuseDecision.inputsMaxMtimeMs,
      reuseReason: reuseDecision.reason,
      hvigorExecuted: false,
      hvigorExitCode: 0,
      hvigorDurationMs: 0,
      staleSuspect: reuseDecision.staleSuspect ?? false,
      staleSuspectUnsignedPath: reuseDecision.staleSuspectUnsignedPath ?? null,
      staleSuspectNote: reuseDecision.staleSuspectNote ?? null,
      scannedDirs: reuseDecision.scannedDirs ?? [],
      candidateCount: reuseDecision.candidates?.length ?? 0,
      productSelection: {
        product: selection.product,
        source: selection.source,
        candidates: selection.candidates,
        purpose: selection.purpose,
      },
      timestamp: new Date().toISOString(),
    });
    return {
      hvigor,
      hapPath: reuseDecision.hapPath,
      resolvedProduct,
      resolvedBuildMode,
      reused: true,
      hapMtimeMs: reuseDecision.hapMtimeMs,
      hapBuiltAt: reuseDecision.hapBuiltAt,
      inputsMaxMtimeMs: reuseDecision.inputsMaxMtimeMs,
      reuseReason: reuseDecision.reason,
      staleSuspect: reuseDecision.staleSuspect,
      staleSuspectUnsignedPath: reuseDecision.staleSuspectUnsignedPath,
      staleSuspectNote: reuseDecision.staleSuspectNote,
      scannedDirs: reuseDecision.scannedDirs,
      candidates: reuseDecision.candidates,
      productSelection: selection,
    };
  }

  // 源码比 HAP 新：先停旧 daemon，再以 buildChildEnv（含 DevEco JBR）拉起新 worker，避免 PackageHap spawn java ENOENT
  stopHvigorDaemon({
    projectRoot: opts.projectRoot,
    harnessRoot: opts.harnessRoot,
    frameworkRoot: opts.frameworkRoot,
    feature: opts.feature,
    phase: opts.phase,
  });

  const hvigor = runHvigorAssembleApp({
    projectRoot: opts.projectRoot,
    harnessRoot: opts.harnessRoot,
    frameworkRoot: opts.frameworkRoot,
    feature: opts.feature,
    phase: opts.phase,
    skipEnvVar: opts.skipEnvVar ?? 'HARNESS_SKIP_DEVICE_TEST_BUILD',
    product: resolvedProduct,
    buildMode: resolvedBuildMode,
    logBasename: 'hvigor-app-build.log',
    metaExtras: {
      daemonStoppedBeforeBuild: true,
      // t5：selection 仅作审计落盘（hvigor-*.meta.json），不做运行时传播
      productSelection: {
        product: selection.product,
        source: selection.source,
        candidates: selection.candidates,
        purpose: selection.purpose,
      },
    },
  });

  let hapPath: string | null = null;
  let hapMtimeMs: number | null = reuseDecision.hapMtimeMs;
  let hapBuiltAt: string | null = reuseDecision.hapBuiltAt;
  let scannedDirs: string[] | undefined;
  let candidates: HapDiscoveryCandidate[] | undefined;
  let staleSuspect: boolean | undefined;
  let staleSuspectUnsignedPath: string | null | undefined;
  let staleSuspectNote: string | undefined;

  // plan a7c3f9e2 t1：终态判据与 coding 出口共用 isHvigorBuildSuccessful——
  // errors[] 不参与判定（宿主非致命 `> hvigor ERROR:` 不再误杀真成功构建）。
  const ok = isDeviceTestBuildOk(hvigor);

  if (ok) {
    const discovery = discoverAppHapArtifacts(opts.projectRoot, resolvedProduct);
    scannedDirs = discovery.scannedDirs;
    candidates = discovery.candidates;
    hapPath = discovery.signedPath ?? reuseDecision.hapPath;
    if (hapPath && fs.existsSync(hapPath)) {
      try {
        hapMtimeMs = fs.statSync(hapPath).mtimeMs;
        hapBuiltAt = new Date(hapMtimeMs).toISOString();
      } catch {
        /* keep prior */
      }
      const stale = detectStaleSignedSuspect(hapPath);
      staleSuspect = stale.staleSuspect;
      staleSuspectUnsignedPath = stale.unsignedPath;
      staleSuspectNote = stale.note;
    }
  }

  try {
    writeBuildResultSummary(reportDir, {
      reused: false,
      resolvedProduct,
      resolvedBuildMode,
      hapPath,
      hapMtimeMs,
      hapBuiltAt,
      inputsMaxMtimeMs: reuseDecision.inputsMaxMtimeMs,
      reuseReason: reuseDecision.reason,
      daemonStoppedBeforeBuild: true,
      hvigorExecuted: hvigor.executed,
      hvigorExitCode: hvigor.exitCode ?? null,
      hvigorDurationMs: hvigor.durationMs,
      hvigorLogPath: hvigor.logPath ?? null,
      hvigorMetaPath: hvigor.metaPath ?? null,
      scannedDirs: scannedDirs ?? [],
      candidateCount: candidates?.length ?? 0,
      staleSuspect: staleSuspect ?? false,
      staleSuspectUnsignedPath: staleSuspectUnsignedPath ?? null,
      staleSuspectNote: staleSuspectNote ?? null,
      productSelection: {
        product: selection.product,
        source: selection.source,
        candidates: selection.candidates,
        purpose: selection.purpose,
      },
      timestamp: new Date().toISOString(),
    });
  } catch {
    /* best-effort */
  }

  return {
    hvigor,
    hapPath,
    scannedDirs,
    candidates,
    staleSuspect,
    staleSuspectUnsignedPath,
    staleSuspectNote,
    resolvedProduct,
    resolvedBuildMode,
    reused: false,
    hapMtimeMs,
    hapBuiltAt,
    inputsMaxMtimeMs: reuseDecision.inputsMaxMtimeMs,
    reuseReason: reuseDecision.reason,
    productSelection: selection,
  };
}
