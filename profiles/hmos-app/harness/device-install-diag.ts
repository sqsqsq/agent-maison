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

  // plan 423e5d0f P0-4（codex review 二连修正）：卸载是破坏性动作（清除该应用在设备上的
  // 用户数据，钱包类=卡片/凭据），且 **UT 链没有任何卸载执行逻辑**（runHvigorTest 对非
  // clear 预检一律直接返回；HARNESS_DEVICE_TEST_UNINSTALL_BEFORE_INSTALL 只被 testing
  // provider 消费）。因此本诊断对降级**恒 needsConfirmation**：不给 selfHealable 假承诺
  // （会死循环），也不把 env 当授权证明（agent 同样能设置）。用户手动处理设备后重跑。
  if (downgradeDetected) {
    return {
      kind: 'needsConfirmation',
      details:
        `检测到版本降级：设备 versionCode=${devVc} > 候选 ${candVc}，安装会被拒绝。\n` +
        `处置需用户手动完成（agent 不得自行执行，UT 链没有自动卸载能力）：\n` +
        `  a) 用户自行卸载设备上的该应用后重跑：⚠️ 卸载会清除该应用在设备上的全部用户数据（钱包类=卡片/凭据）；\n` +
        `  b) 或换测试机后重跑。\n` +
        `不要为绕过而提高 app.versionCode：受源码改动门禁约束，且治标不治本（下轮仍会撞）。`,
      nextAction: 'user_resolve_device_downgrade_then_rerun',
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

export function writeInstallDiagJson(
  projectRoot: string,
  feature: string,
  phase: string,
  frameworkRoot: string | undefined,
  diag: InstallBlockingDiagnosis,
  fileName: 'ut-install-diag.json' | 'testing-install-diag.json' = 'ut-install-diag.json',
): string | null {
  try {
    const reportDir = featurePhaseReportsDir(projectRoot, feature, phase, frameworkRoot);
    fs.mkdirSync(reportDir, { recursive: true });
    const outPath = path.join(reportDir, fileName);
    fs.writeFileSync(outPath, JSON.stringify(diag, null, 2), 'utf-8');
    return outPath;
  } catch {
    return null;
  }
}

/** @deprecated use writeInstallDiagJson */
export function writeUtInstallDiagJson(
  projectRoot: string,
  feature: string,
  phase: string,
  frameworkRoot: string | undefined,
  diag: InstallBlockingDiagnosis,
): string | null {
  return writeInstallDiagJson(projectRoot, feature, phase, frameworkRoot, diag, 'ut-install-diag.json');
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
      // UT 链的降级诊断已恒 needsConfirmation，本分支仅为类型完整性保留（不应到达）。
      return {
        failure_kind: 'install_downgrade_self_healable',
        blocking_class: 'selfHealable',
        suggestion: '按 ut-install-diag.json 诊断处理后重跑。',
      };
    case 'needsConfirmation':
      // needsConfirmation ≠ 版本降级：还覆盖元数据读取失败等预检不确定场景，
      // 卸载/丢数据/versionCode 话术只适用于确凿的降级（downgradeDetected）。
      return diag.downgradeDetected
        ? {
            failure_kind: 'install_needs_confirmation',
            blocking_class: 'needsConfirmation',
            suggestion:
              '向用户展示 ut-install-diag.json 诊断并等待用户手动处理设备（卸载会清除设备上该应用的用户数据，UT 链无自动卸载能力）；' +
              '不要自行卸载或提高 app.versionCode。模块编译已通过的事实保留在报告中。',
          }
        : {
            failure_kind: 'install_needs_confirmation',
            blocking_class: 'needsConfirmation',
            suggestion:
              '装机预检不确定（见 ut-install-diag.json，常见为 AppScope/app.json5 缺失、解析失败或 bundleName 无效）：' +
              '核对并修复 AppScope/app.json5 元数据后重跑；如需修改工程配置，按源码变更授权流程处理（gap-notes approved_src_mutations）。无需卸载设备应用。',
          };
    default:
      return {
        failure_kind: 'install_blocked',
        blocking_class: diag.kind,
        suggestion: '查阅 ut-install-diag.json 后重跑。',
      };
  }
}

export function buildInstallBlockingCheckDetails(
  diag: InstallBlockingDiagnosis,
  diagFileName: 'ut-install-diag.json' | 'testing-install-diag.json',
): string {
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
  lines.push(`详见 <features_dir>/<feature>/*/reports/${diagFileName}（features_dir 默认 doc/features，见 framework.config.json）`);
  return lines.join('\n');
}

/** @deprecated use buildInstallBlockingCheckDetails */
export function buildUtInstallBlockingCheckDetails(diag: InstallBlockingDiagnosis): string {
  return buildInstallBlockingCheckDetails(diag, 'ut-install-diag.json');
}

export function mapInstallBlockingToTestingCheckFields(diag: InstallBlockingDiagnosis): {
  failure_kind: string;
  blocking_class: string;
  suggestion: string;
} {
  const base = mapInstallBlockingToUtCheckFields(diag);
  if (diag.kind === 'externalBlocked') {
    return {
      ...base,
      suggestion:
        '接入真机/模拟器后重跑；summary.next_action=device_ready_then_rerun_testing；不允许宣称 testing 阶段完成。',
    };
  }
  return base;
}
