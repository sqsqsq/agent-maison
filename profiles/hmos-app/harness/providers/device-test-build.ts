/**
 * device_test.build → provider `hvigor_app`
 */
import * as fs from 'fs';
import * as path from 'path';
import { featurePhaseReportsDir } from '../../../../harness/config';
import type { CapabilityProvider } from './types';
import { runHvigorAssembleApp, findAppSignedHap, type HvigorRunResult } from '../hvigor-runner';
import { resolveDeviceTestProduct, resolveDeviceTestBuildMode } from '../testing-build-conventions';

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
}

export function runDeviceTestAppBuild(opts: DeviceTestBuildOptions): DeviceTestBuildResult {
  const resolvedProduct = resolveDeviceTestProduct(opts.projectRoot, opts.product);
  const resolvedBuildMode = resolveDeviceTestBuildMode(opts.buildMode);

  const hvigor = runHvigorAssembleApp({
    projectRoot: opts.projectRoot,
    harnessRoot: opts.harnessRoot,
    feature: opts.feature,
    phase: opts.phase,
    skipEnvVar: opts.skipEnvVar ?? 'HARNESS_SKIP_DEVICE_TEST_BUILD',
    product: resolvedProduct,
    buildMode: resolvedBuildMode,
    logBasename: 'hvigor-app-build.log',
  });

  let hapPath: string | null = null;
  const ok =
    hvigor.executed &&
    !hvigor.timedOut &&
    hvigor.exitCode === 0 &&
    (hvigor.errors?.length ?? 0) === 0 &&
    hvigor.successMarkerFound !== false;

  if (ok) {
    hapPath = findAppSignedHap(opts.projectRoot, resolvedProduct);
  }

  try {
    const reportDir = featurePhaseReportsDir(opts.projectRoot, opts.feature, opts.phase);
    fs.mkdirSync(reportDir, { recursive: true });
    const summaryPath = path.join(reportDir, 'device-test-build.result.json');
    fs.writeFileSync(
      summaryPath,
      JSON.stringify(
        {
          resolvedProduct,
          resolvedBuildMode,
          hapPath,
          hvigorExitCode: hvigor.exitCode ?? null,
          hvigorLogPath: hvigor.logPath ?? null,
          hvigorMetaPath: hvigor.metaPath ?? null,
          timestamp: new Date().toISOString(),
        },
        null,
        2,
      ),
      'utf-8',
    );
  } catch {
    /* best-effort */
  }

  return { hvigor, hapPath, resolvedProduct, resolvedBuildMode };
}
