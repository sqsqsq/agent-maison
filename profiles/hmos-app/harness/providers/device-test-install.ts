/**
 * device_test.install → provider `hdc_app`
 */
import * as fs from 'fs';
import * as path from 'path';
import type { CapabilityProvider } from './types';
import { installHap, probeDevices, type DeviceProbeResult, type HdcInstallResult } from '../hdc-runner';

export const provider: CapabilityProvider = {
  id: 'hdc_app',
  capability: 'device_test.install',
  exports: ['installDeviceTestApp'],
};

export interface DeviceTestInstallOptions {
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

  const install = installHap(opts.hapPath);
  const lines: string[] = [];
  lines.push(`[hap] ${opts.hapPath}`);
  lines.push(`[device] hdcPresent=${probe.hdcPresent} available=${probe.available} targets=${probe.targets.join(',')}`);
  lines.push(install.output);

  let logPath: string | undefined;
  try {
    const reportDir = path.join(opts.harnessRoot, 'reports', opts.feature, opts.phase);
    fs.mkdirSync(reportDir, { recursive: true });
    const logAbs = path.join(reportDir, 'hdc-app-install.log');
    fs.writeFileSync(logAbs, lines.join('\n'), 'utf-8');
    logPath = path.relative(process.cwd(), logAbs).replace(/\\/g, '/');

    const metaAbs = path.join(reportDir, 'device-test-install.meta.json');
    fs.writeFileSync(
      metaAbs,
      JSON.stringify(
        {
          ok: install.ok,
          exitCode: install.exitCode,
          hapPath: opts.hapPath,
          durationMs: install.durationMs,
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

  if (!install.ok) {
    const diagnosis = install.diagnosis;
    errors.push({
      message: diagnosis
        ? `${diagnosis.summary}\n修复建议：${diagnosis.suggestion}`
        : `hdc install 失败（exit=${install.exitCode}）。`,
    });
  }

  return {
    executed: true,
    probe,
    install,
    ok: install.ok,
    logPath,
    errors,
  };
}
