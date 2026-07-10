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
  type HvigorRunResult,
  type HapDiscoveryCandidate,
} from '../hvigor-runner';
import { resolveDeviceTestProduct, resolveDeviceTestBuildMode } from '../testing-build-conventions';
import { evaluateDeviceTestBuildReuse } from '../device-test-build-reuse';

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

export function runDeviceTestAppBuild(opts: DeviceTestBuildOptions): DeviceTestBuildResult {
  const reuseDecision = evaluateDeviceTestBuildReuse({
    projectRoot: opts.projectRoot,
    product: opts.product,
    buildMode: opts.buildMode,
  });
  const resolvedProduct = reuseDecision.resolvedProduct;
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
    metaExtras: { daemonStoppedBeforeBuild: true },
  });

  let hapPath: string | null = null;
  let hapMtimeMs: number | null = reuseDecision.hapMtimeMs;
  let hapBuiltAt: string | null = reuseDecision.hapBuiltAt;
  let scannedDirs: string[] | undefined;
  let candidates: HapDiscoveryCandidate[] | undefined;
  let staleSuspect: boolean | undefined;
  let staleSuspectUnsignedPath: string | null | undefined;
  let staleSuspectNote: string | undefined;

  const ok =
    hvigor.executed &&
    !hvigor.timedOut &&
    hvigor.exitCode === 0 &&
    (hvigor.errors?.length ?? 0) === 0 &&
    hvigor.successMarkerFound !== false;

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
  };
}
