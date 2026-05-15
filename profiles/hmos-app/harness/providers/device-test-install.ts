/**
 * device_test.install → provider `hdc_app`
 */
import * as fs from 'fs';
import * as path from 'path';
import { featurePhaseReportsDir } from '../../../../harness/config';
import type { CapabilityProvider } from './types';
import {
  installHap,
  probeDevices,
  runHdcShellBmDump,
  parseInstalledBundleVersionFromDump,
  loadAppInstallCandidateMeta,
  uninstallBundleViaBm,
  type DeviceProbeResult,
  type HdcInstallResult,
} from '../hdc-runner';

export const provider: CapabilityProvider = {
  id: 'hdc_app',
  capability: 'device_test.install',
  exports: ['installDeviceTestApp'],
};

export interface DeviceTestInstallOptions {
  /** 工程根（读取 AppScope/app.json5 做版本预检） */
  projectRoot: string;
  harnessRoot: string;
  feature: string;
  phase: string;
  hapPath: string;
  skipEnvVar?: string;
}

export interface DeviceTestInstallResult {
  executed: boolean;
  skippedByEnv?: boolean;
  probe: DeviceProbeResult;
  install?: HdcInstallResult;
  ok: boolean;
  logPath?: string;
  errors: Array<{ message: string }>;
}

function envTruthy(name: string): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function writeInstallArtifacts(
  opts: DeviceTestInstallOptions,
  payload: {
    logLines: string[];
    ok: boolean;
    install?: HdcInstallResult;
    bundleName: string;
    candidateVersionCode: number | null;
    candidateVersionName?: string;
    bmDumpExitCode: number;
    deviceInstalledProbe: boolean;
    deviceVersionCodeParsed: number | null;
    deviceParseAmbiguous: boolean;
    downgradeDetected: boolean;
    downgradeBlocked: boolean;
    uninstallAttempted: boolean;
    keepUserData: boolean;
  },
): string | undefined {
  try {
    const reportDir = featurePhaseReportsDir(opts.projectRoot, opts.feature, opts.phase);
    fs.mkdirSync(reportDir, { recursive: true });
    const logAbs = path.join(reportDir, 'hdc-app-install.log');
    fs.writeFileSync(logAbs, payload.logLines.join('\n\n'), 'utf-8');
    const logPath = path.relative(process.cwd(), logAbs).replace(/\\/g, '/');

    const metaAbs = path.join(reportDir, 'device-test-install.meta.json');
    fs.writeFileSync(
      metaAbs,
      JSON.stringify(
        {
          ok: payload.ok,
          exitCode: payload.install?.exitCode ?? null,
          durationMs: payload.install?.durationMs ?? null,
          hapPath: opts.hapPath,
          bundleName: payload.bundleName,
          candidateVersionCode: payload.candidateVersionCode,
          candidateVersionName: payload.candidateVersionName ?? null,
          bmDumpExitCode: payload.bmDumpExitCode,
          deviceInstalledProbe: payload.deviceInstalledProbe,
          deviceVersionCodeParsed: payload.deviceVersionCodeParsed,
          deviceParseAmbiguous: payload.deviceParseAmbiguous,
          downgradeDetected: payload.downgradeDetected,
          downgradeBlocked: payload.downgradeBlocked,
          uninstallAttempted: payload.uninstallAttempted,
          uninstallKeepUserData: payload.keepUserData,
          installDiagnosisKind: payload.install?.diagnosis?.kind ?? null,
          timestamp: new Date().toISOString(),
        },
        null,
        2,
      ),
      'utf-8',
    );
    return logPath;
  } catch {
    return undefined;
  }
}

export function installDeviceTestApp(opts: DeviceTestInstallOptions): DeviceTestInstallResult {
  const skipEnv = opts.skipEnvVar ?? 'HARNESS_SKIP_DEVICE_TEST_INSTALL';
  const errors: Array<{ message: string }> = [];

  if (process.env[skipEnv]) {
    return {
      executed: false,
      skippedByEnv: true,
      probe: probeDevices(),
      ok: false,
      errors: [{ message: `环境变量 ${skipEnv} 已设置；不允许作为 testing 阶段出口，请去掉后重跑。` }],
    };
  }

  const probe = probeDevices();
  if (!probe.hdcPresent) {
    return {
      executed: false,
      probe,
      ok: false,
      errors: [{ message: '未找到 hdc（HarmonyOS Device Connector）。请将 DevEco SDK toolchains 加入 PATH。' }],
    };
  }
  if (!probe.available) {
    return {
      executed: false,
      probe,
      ok: false,
      errors: [
        {
          message:
            '无在线设备或模拟器（hdc list targets 为空）。请先连接真机/模拟器后再跑 testing harness。',
        },
      ],
    };
  }

  if (!opts.hapPath?.trim() || !fs.existsSync(opts.hapPath)) {
    return {
      executed: false,
      probe,
      ok: false,
      errors: [{ message: `HAP 不存在或路径无效：${opts.hapPath ?? '(空)'}` }],
    };
  }

  const uninstallBefore = envTruthy('HARNESS_DEVICE_TEST_UNINSTALL_BEFORE_INSTALL');
  const keepUserData = envTruthy('HARNESS_DEVICE_TEST_UNINSTALL_KEEP_DATA');

  let candidate: ReturnType<typeof loadAppInstallCandidateMeta>;
  try {
    candidate = loadAppInstallCandidateMeta(opts.projectRoot);
  } catch (e) {
    return {
      executed: false,
      probe,
      ok: false,
      errors: [{ message: `读取应用版本元数据失败：${(e as Error).message}` }],
    };
  }

  const bmDump = runHdcShellBmDump(candidate.bundleName);
  const installedParse = parseInstalledBundleVersionFromDump(bmDump.output);

  const devVc = installedParse.versionCode;
  const candVc = candidate.versionCode;

  const downgradeDetected =
    candVc !== null && installedParse.installed && devVc !== null && devVc > candVc;

  const logLines: string[] = [];
  logLines.push(`[hap] ${opts.hapPath}`);
  logLines.push(`[device] hdcPresent=${probe.hdcPresent} available=${probe.available} targets=${probe.targets.join(',')}`);
  logLines.push(
    `[candidate] bundle=${candidate.bundleName} versionCode=${candVc === null ? '(未声明)' : String(candVc)} versionName=${candidate.versionName ?? '(无)'}`,
  );
  logLines.push(
    `[bm_dump] exit=${bmDump.exitCode} installed=${installedParse.installed} deviceVersionCode=${devVc === null ? '(未解析)' : String(devVc)} ambiguous=${Boolean(installedParse.ambiguous)}`,
  );
  logLines.push('[bm_dump_raw]', bmDump.output.slice(0, 50_000));

  let uninstallAttempted = false;

  const runUninstallOnce = (): void => {
    if (!uninstallBefore || uninstallAttempted) {
      return;
    }
    uninstallAttempted = true;
    const ur = uninstallBundleViaBm(candidate.bundleName, { keepUserData });
    logLines.push(
      `$ hdc shell bm uninstall -n ${candidate.bundleName}${keepUserData ? ' -k' : ''}\nexit=${ur.exitCode}\n${ur.output}`,
    );
  };

  let install: HdcInstallResult | undefined;
  let ok = false;
  let downgradeBlocked = false;

  if (downgradeDetected && !uninstallBefore) {
    downgradeBlocked = true;
    errors.push({
      message: [
        'device_test.install：检测到设备上已安装版本高于本次待装包（降级场景）。',
        `  bundleName=${candidate.bundleName}`,
        `  设备端 versionCode=${devVc}（解析自 bm dump），工程 AppScope/app.json5 versionCode=${candVc}。`,
        '可选处理方式：',
        '  1) 提高 app.json5 的 versionCode 后重新编译再打 HAP；',
        `  2) 手动卸载设备应用：hdc shell bm uninstall -n ${candidate.bundleName}；`,
        '  3) 自动化卸载重装（慎用，可能丢失数据）：设置 HARNESS_DEVICE_TEST_UNINSTALL_BEFORE_INSTALL=1（需保留用户数据时再加 HARNESS_DEVICE_TEST_UNINSTALL_KEEP_DATA=1）后重跑 testing harness。',
      ].join('\n'),
    });
    ok = false;
  } else {
    if (downgradeDetected && uninstallBefore) {
      runUninstallOnce();
    }

    install = installHap(opts.hapPath);
    logLines.push(install.output);

    if (!install.ok && uninstallBefore && !uninstallAttempted) {
      runUninstallOnce();
      install = installHap(opts.hapPath);
      logLines.push(install.output);
    }

    ok = Boolean(install?.ok);
    if (install && !install.ok) {
      const diagnosis = install.diagnosis;
      errors.push({
        message: diagnosis
          ? `${diagnosis.summary}\n修复建议：${diagnosis.suggestion}`
          : `hdc install 失败（exit=${install.exitCode}）。`,
      });
    }
  }

  const logPath = writeInstallArtifacts(opts, {
    logLines,
    ok,
    install,
    bundleName: candidate.bundleName,
    candidateVersionCode: candVc,
    candidateVersionName: candidate.versionName,
    bmDumpExitCode: bmDump.exitCode,
    deviceInstalledProbe: installedParse.installed,
    deviceVersionCodeParsed: devVc,
    deviceParseAmbiguous: Boolean(installedParse.ambiguous),
    downgradeDetected,
    downgradeBlocked,
    uninstallAttempted,
    keepUserData,
  });

  return {
    executed: true,
    probe,
    install,
    ok,
    logPath,
    errors,
  };
}
