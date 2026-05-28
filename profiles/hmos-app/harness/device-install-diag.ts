/**
 * 公共设备安装诊断（UT / testing 共用第一波：版本探测 + blocking 分类）。
 */
import * as fs from 'fs';
import * as path from 'path';
import { featurePhaseReportsDir } from '../../../harness/config';
import {
  loadAppInstallCandidateMeta,
  parseInstalledBundleVersionFromDump,
  probeDevices,
  runHdcShellBmDump,
  type AppInstallCandidateMeta,
} from './hdc-runner';

export type InstallBlockingKind = 'clear' | 'selfHealable' | 'needsConfirmation' | 'externalBlocked';

export interface InstallBlockingDiagnosis {
  kind: InstallBlockingKind;
  details: string;
  partialReadinessReason?: 'compile_passed_device_blocked';
  nextAction?: string;
  bundleName?: string;
  candidateVersionCode?: number | null;
  deviceVersionCode?: number | null;
  downgradeDetected?: boolean;
  hdcPresent?: boolean;
  deviceAvailable?: boolean;
}

function envTruthy(name: string): boolean {
  const v = (process.env[name] ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

export function detectInstallDowngrade(
  candidateVersionCode: number | null,
  installed: { installed: boolean; versionCode: number | null },
): boolean {
  return (
    candidateVersionCode !== null &&
    installed.installed &&
    installed.versionCode !== null &&
    installed.versionCode > 0 &&
    installed.versionCode > candidateVersionCode
  );
}

export function diagnoseInstallBlocking(projectRoot: string): InstallBlockingDiagnosis {
  const probe = probeDevices();
  if (!probe.hdcPresent) {
    return {
      kind: 'externalBlocked',
      details: '未找到 hdc（HarmonyOS Device Connector）。请将 DevEco SDK toolchains 加入 PATH。',
      partialReadinessReason: 'compile_passed_device_blocked',
      nextAction: 'device_ready_then_rerun_ut',
      hdcPresent: false,
      deviceAvailable: false,
    };
  }
  if (!probe.available) {
    return {
      kind: 'externalBlocked',
      details: `无在线设备或模拟器（hdc list targets 为空：${probe.raw || '(空)'}）`,
      partialReadinessReason: 'compile_passed_device_blocked',
      nextAction: 'device_ready_then_rerun_ut',
      hdcPresent: true,
      deviceAvailable: false,
    };
  }

  let candidate: AppInstallCandidateMeta;
  try {
    candidate = loadAppInstallCandidateMeta(projectRoot);
  } catch (e) {
    return {
      kind: 'needsConfirmation',
      details: `读取应用版本元数据失败：${(e as Error).message}`,
      hdcPresent: true,
      deviceAvailable: true,
    };
  }

  const bmDump = runHdcShellBmDump(candidate.bundleName);
  const installedParse = parseInstalledBundleVersionFromDump(bmDump.output);
  const devVc = installedParse.versionCode;
  const candVc = candidate.versionCode;

  const downgradeDetected = detectInstallDowngrade(candVc, installedParse);

  if (downgradeDetected && !envTruthy('HARNESS_DEVICE_TEST_UNINSTALL_BEFORE_INSTALL')) {
    return {
      kind: 'selfHealable',
      details:
        `检测到版本降级：设备 versionCode=${devVc} > 候选 ${candVc}。` +
        `设置 HARNESS_DEVICE_TEST_UNINSTALL_BEFORE_INSTALL=1 后重跑可尝试自愈。`,
      nextAction: 'set_HARNESS_DEVICE_TEST_UNINSTALL_BEFORE_INSTALL_then_rerun',
      bundleName: candidate.bundleName,
      candidateVersionCode: candVc,
      deviceVersionCode: devVc,
      downgradeDetected: true,
      hdcPresent: true,
      deviceAvailable: true,
    };
  }

  if (downgradeDetected) {
    return {
      kind: 'needsConfirmation',
      details:
        `版本降级已检测（device=${devVc}, candidate=${candVc}），需用户确认是否卸载重装或提升 versionCode。`,
      bundleName: candidate.bundleName,
      candidateVersionCode: candVc,
      deviceVersionCode: devVc,
      downgradeDetected: true,
      hdcPresent: true,
      deviceAvailable: true,
    };
  }

  return {
    kind: 'clear',
    details: '设备与版本预检通过（或无阻塞性版本冲突）。',
    bundleName: candidate.bundleName,
    candidateVersionCode: candVc,
    deviceVersionCode: devVc,
    downgradeDetected: false,
    hdcPresent: true,
    deviceAvailable: true,
  };
}

export function writeUtInstallDiagJson(
  projectRoot: string,
  feature: string,
  phase: string,
  frameworkRoot: string | undefined,
  diag: InstallBlockingDiagnosis,
): string | null {
  try {
    const reportDir = featurePhaseReportsDir(projectRoot, feature, phase, frameworkRoot);
    fs.mkdirSync(reportDir, { recursive: true });
    const outPath = path.join(reportDir, 'ut-install-diag.json');
    fs.writeFileSync(outPath, JSON.stringify(diag, null, 2), 'utf-8');
    return outPath;
  } catch {
    return null;
  }
}

/** 将 diagnoseInstallBlocking 结果映射为 ut_hvigor_test CheckResult 机器可读字段 */
export function mapInstallBlockingToUtCheckFields(diag: InstallBlockingDiagnosis): {
  failure_kind: string;
  blocking_class: string;
  suggestion: string;
} {
  switch (diag.kind) {
    case 'externalBlocked':
      return {
        failure_kind: 'device_blocked',
        blocking_class: 'externalBlocked',
        suggestion:
          diag.nextAction === 'device_ready_then_rerun_ut'
            ? '接入真机/模拟器后重跑；summary.next_action=device_ready_then_rerun_ut；不允许宣称 UT 阶段完成。'
            : '修复设备环境后重跑 UT harness。',
      };
    case 'selfHealable':
      return {
        failure_kind: 'install_downgrade_self_healable',
        blocking_class: 'selfHealable',
        suggestion:
          '设置 HARNESS_DEVICE_TEST_UNINSTALL_BEFORE_INSTALL=1 后重跑 harness（详见 ut-install-diag.json）。',
      };
    case 'needsConfirmation':
      return {
        failure_kind: 'install_needs_confirmation',
        blocking_class: 'needsConfirmation',
        suggestion:
          '向用户展示 ut-install-diag.json 诊断，确认卸载重装或提升 versionCode 后重跑。',
      };
    default:
      return {
        failure_kind: 'install_blocked',
        blocking_class: diag.kind,
        suggestion: '查阅 ut-install-diag.json 后重跑。',
      };
  }
}

export function buildUtInstallBlockingCheckDetails(diag: InstallBlockingDiagnosis): string {
  const lines = [
    `装机预检阻塞（blockingKind=${diag.kind}）`,
    diag.details,
  ];
  if (diag.partialReadinessReason) {
    lines.push(`partial_readiness: ${diag.partialReadinessReason}`);
  }
  if (diag.nextAction) {
    lines.push(`next_action: ${diag.nextAction}`);
  }
  if (diag.bundleName) {
    lines.push(`bundleName=${diag.bundleName} deviceVc=${diag.deviceVersionCode} candidateVc=${diag.candidateVersionCode}`);
  }
  lines.push('详见 doc/features/<feature>/ut/reports/ut-install-diag.json');
  return lines.join('\n');
}
