/**
 * device_test.build → provider `hvigor_app`
 */
import * as fs from 'fs';
import * as path from 'path';
import { featurePhaseReportsDir } from '../../../../harness/config';
import type { CapabilityProvider } from './types';
import {
  runHvigorAssembleApp,
  findAppSignedHap,
  stopHvigorDaemon,
  type HvigorRunResult,
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
  const reportDir = featurePhaseReportsDir(opts.projectRoot, opts.feature, opts.phase);

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
    };
  }

  // 源码比 HAP 新：先停旧 daemon，再以 buildChildEnv（含 DevEco JBR）拉起新 worker，避免 PackageHap spawn java ENOENT
  stopHvigorDaemon({
    projectRoot: opts.projectRoot,
    harnessRoot: opts.harnessRoot,
    feature: opts.feature,
    phase: opts.phase,
  });

  const hvigor = runHvigorAssembleApp({
    projectRoot: opts.projectRoot,
    harnessRoot: opts.harnessRoot,
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

  const ok =
    hvigor.executed &&
    !hvigor.timedOut &&
    hvigor.exitCode === 0 &&
    (hvigor.errors?.length ?? 0) === 0 &&
    hvigor.successMarkerFound !== false;

  if (ok) {
    hapPath = findAppSignedHap(opts.projectRoot, resolvedProduct) ?? reuseDecision.hapPath;
    if (hapPath && fs.existsSync(hapPath)) {
      try {
        hapMtimeMs = fs.statSync(hapPath).mtimeMs;
        hapBuiltAt = new Date(hapMtimeMs).toISOString();
      } catch {
        /* keep prior */
      }
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
      timestamp: new Date().toISOString(),
    });
  } catch {
    /* best-effort */
  }

  return {
    hvigor,
    hapPath,
    resolvedProduct,
    resolvedBuildMode,
    reused: false,
    hapMtimeMs,
    hapBuiltAt,
    inputsMaxMtimeMs: reuseDecision.inputsMaxMtimeMs,
    reuseReason: reuseDecision.reason,
  };
}
