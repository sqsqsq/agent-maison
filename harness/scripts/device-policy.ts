#!/usr/bin/env node
// ============================================================================
// device-policy.ts — 设备策略检查与凭据登记 CLI
//                    （openspec device-readiness-and-completion t6）
// ----------------------------------------------------------------------------
// 两个子命令：
//   --check --json   机器可读的策略状态。**由主 agent 在启动 detached runner 之前**跑；
//                    未配置时输出 device_policy_unset，交互层据此询问四选一。
//                    本命令**不读 stdin、不弹交互**（与 capability-preflight 同款纪律）。
//   --enroll         凭据登记。**必须在用户控制的真实 TTY 上运行**：口令经 TTY 隐藏
//                    输入 → 直接写入 OS 凭据库，全程不进 argv / env / pipe / agent stdin。
//
// 为什么登记不能走 agent 对话：capability-preflight 已写死"agent 对话确认不构成任何
// 授权"，且对话内容会进 transcript。口令一旦进 transcript 就等于泄漏。
// ============================================================================

import { spawnSync } from 'child_process';
import * as path from 'path';
import { detectRepoLayout } from '../repo-layout';
import { loadLocalConfig, writeLocalConfig, localConfigPath } from './utils/framework-local-config';
import {
  allocateCredentialVersion,
  credentialRefOf,
  isValidSerial,
  parseCredentialRef,
  windowsCredentialProvider,
  type CredentialIdentity,
  type CredentialProvider,
  type CredentialState,
} from './utils/device-credential-store';

interface PolicyStatus {
  configured: boolean;
  unlock_mode: 'manual' | 'credential' | null;
  emulator_fallback: 'disabled' | 'existing' | 'managed' | null;
  target_serial: string | null;
  credential_ref: string | null;
  /** 凭据当前的机器级状态（仅 credential 模式有意义）——真值取自 OS 凭据库本身 */
  credential_state: CredentialState | null;
  code: 'ok' | 'device_policy_unset';
  guidance: string;
}

function resolveProjectRoot(): string {
  const layout = detectRepoLayout(__dirname);
  return layout.projectRoot;
}

export function collectPolicyStatus(
  projectRoot: string,
  provider: CredentialProvider = windowsCredentialProvider(),
): PolicyStatus {
  const local = loadLocalConfig(projectRoot);
  const device = local?.device;
  const mode = device?.unlock?.mode ?? null;
  const fallback = device?.emulator_fallback ?? null;
  const ref = device?.unlock?.credential_ref ?? null;

  let credentialState: PolicyStatus['credential_state'] = null;
  if (mode === 'credential' && ref) {
    const id = parseCredentialRef(ref);
    credentialState = id ? provider.inspect(id).state : 'absent';
  }

  // 「已配置」= 至少显式表达过一次意图（解锁方式或模拟器降级档位）
  const configured = Boolean(mode || fallback);
  return {
    configured,
    unlock_mode: mode,
    emulator_fallback: fallback,
    target_serial: device?.target_serial ?? null,
    credential_ref: ref,
    credential_state: credentialState,
    code: configured ? 'ok' : 'device_policy_unset',
    guidance: configured
      ? '设备策略已配置'
      : [
          '本链路含需要设备的阶段，但尚未配置设备策略。请向用户询问四选一：',
          '  ① 手工解锁（人工保证设备可用；框架不碰口令）',
          '  ② 启用自动解锁 → 在**用户自己的终端**运行：npx ts-node scripts/device-policy.ts --enroll --serial <序列号>',
          '  ③ 允许模拟器降级（existing 复用已开实例 / managed 由框架起停）',
          '  ④ 本次停止',
          '注意：口令只能在真实 TTY 中输入，**绝不要**让用户把口令发到对话里。',
        ].join('\n'),
  };
}

// R5：本文件**不再**持有任何读取口令的函数。早前的实现把 SecureString 转回明文写
// stdout 由 Node 捕获，等于口令过了一次管道；留着那条路径就是留了一个违规入口，已整删。
// 现在由 `provider.promptAndWrite` 在**同一个 helper 进程内**完成提示与写入凭据库，
// 明文从键盘直达 CredWrite，Node 只收成/败。

// R4：版本分配已上移到机器级（allocateCredentialVersion）——从当前项目 local config
// 推导会让不同项目登记同一手机时撞号并覆盖同一个 CM target。此处不再自行推导。

export function enroll(projectRoot: string, serial: string): number {
  if (process.platform !== 'win32') {
    console.error('[device-policy] 非 Windows 平台暂不支持凭据托管——请用手工解锁或模拟器降级。');
    return 2;
  }
  if (!process.stdin.isTTY) {
    console.error(
      '[device-policy] 必须在**用户自己的终端**（真实 TTY）中运行——\n' +
        '  当前 stdin 非 TTY，拒绝继续。这条限制的意义：口令绝不能经由 agent 的管道输入。',
    );
    return 2;
  }
  if (!isValidSerial(serial)) {
    console.error(`[device-policy] serial 含非法字符（允许 A-Za-z0-9 . _ : -）：${serial}`);
    return 2;
  }
  // R5：**口令不经 Node**——提示与 CredWrite 在同一个 helper 进程内完成，
  // 明文既不进 stdout pipe 也不进 stdin pipe。Node 只拿到成/败。
  const provider = windowsCredentialProvider();
  const alloc = allocateCredentialVersion(serial, provider);
  if (!alloc.ok) {
    console.error(`[device-policy] 版本分配失败：${alloc.reason}`);
    return 1;
  }
  const version = alloc.version;
  const id: CredentialIdentity = { serial, version };

  const w = provider.promptAndWrite(id, `请输入设备 ${serial} 的解锁 PIN（输入不回显）`);
  if (!w.ok) {
    console.error(`[device-policy] 凭据写入失败：${w.error ?? 'unknown'}`);
    return 1;
  }

  const local = loadLocalConfig(projectRoot) ?? { schema_version: '1.0' };
  writeLocalConfig(projectRoot, {
    ...local,
    device: {
      ...local.device,
      unlock: { mode: 'credential', credential_ref: credentialRefOf(id) },
      target_serial: serial,
    },
  });
  console.log(`[device-policy] 已登记设备 ${serial} 的解锁凭据（版本 v${version}）。`);
  console.log(`  凭据存于 Windows 凭据管理器；${path.basename(localConfigPath(projectRoot))} 只记录引用，不含口令。`);
  if (version > 1) {
    console.log(`  这是轮换：旧版本 v${version - 1} 的失败锁存不影响新版本。`);
  }
  return 0;
}

/**
 * R14：写入非凭据类策略（选项 ①/③）。
 *
 * 此前只有 check/enroll，选"手工解锁"或"允许模拟器"后**没有规范化落盘路径**——
 * agent 只能手改 JSON，重检还会继续报 unset，registry → 配置 CLI → 重检的闭环断了。
 */
export function setPolicy(
  projectRoot: string,
  opts: { unlockMode?: 'manual'; emulatorFallback?: 'disabled' | 'existing' | 'managed'; emulatorProfile?: string; targetSerial?: string },
): number {
  if (!opts.unlockMode && !opts.emulatorFallback && !opts.emulatorProfile && !opts.targetSerial) {
    console.error('[device-policy] --set 需要至少一项：--manual-unlock / --emulator <档位> / --emulator-profile <AVD> / --serial <序列号>');
    return 2;
  }
  if (opts.targetSerial && !isValidSerial(opts.targetSerial)) {
    console.error(`[device-policy] serial 含非法字符：${opts.targetSerial}`);
    return 2;
  }
  const local = loadLocalConfig(projectRoot) ?? { schema_version: '1.0' };
  const device = { ...local.device };
  if (opts.unlockMode === 'manual') {
    // 选"手工解锁" = 明确表达不启用自动解锁；**不保留任何 credential_ref**
    device.unlock = { mode: 'manual' };
  }
  if (opts.emulatorFallback) device.emulator_fallback = opts.emulatorFallback;
  if (opts.emulatorProfile) device.emulator_profile = opts.emulatorProfile;
  if (opts.targetSerial) device.target_serial = opts.targetSerial;
  writeLocalConfig(projectRoot, { ...local, device });
  console.log('[device-policy] 已写入设备策略：');
  console.log(`  unlock.mode=${device.unlock?.mode ?? '(未设)'}`);
  console.log(`  emulator_fallback=${device.emulator_fallback ?? '(未设)'}`);
  if (device.emulator_profile) console.log(`  emulator_profile=${device.emulator_profile}`);
  if (device.target_serial) console.log(`  target_serial=${device.target_serial}`);
  return 0;
}

export function main(argv: string[]): number {
  const valueOf = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1]?.trim() : undefined;
  };
  // `--project-root` 与 check-personal-setup 同惯例：默认按脚本位置推导仓库根，
  // 显式传入时以传入为准（多仓/发布包布局下必需，也让进程级测试能构造真实 host）。
  const projectRoot = valueOf('--project-root') || resolveProjectRoot();
  if (argv.includes('--set')) {
    const em = valueOf('--emulator');
    if (em && !['disabled', 'existing', 'managed'].includes(em)) {
      console.error(`[device-policy] --emulator 须为 disabled|existing|managed，收到 ${em}`);
      return 2;
    }
    return setPolicy(projectRoot, {
      unlockMode: argv.includes('--manual-unlock') ? 'manual' : undefined,
      emulatorFallback: em as 'disabled' | 'existing' | 'managed' | undefined,
      emulatorProfile: valueOf('--emulator-profile'),
      targetSerial: valueOf('--serial'),
    });
  }
  if (argv.includes('--enroll')) {
    const i = argv.indexOf('--serial');
    const serial = i >= 0 ? argv[i + 1]?.trim() : '';
    if (!serial) {
      console.error('[device-policy] --enroll 需要 --serial <设备序列号>');
      return 2;
    }
    return enroll(projectRoot, serial);
  }
  const status = collectPolicyStatus(projectRoot);
  if (argv.includes('--json')) {
    // **纯 JSON 契约**（review：文档承诺"仅解析 stdout JSON"，实现却不满足）：
    //   - stdout 只有 JSON，不掺任何前缀/日志（人读信息在 `guidance` 字段里）；
    //   - **退出码一律 0**。`device_policy_unset` 是一个**正常且可预期的状态**，
    //     不是命令失败——此前返回 3，调用方（尤其 agent）很容易当成"命令挂了"
    //     而不是"读 code 去问用户"，四选一的闭环就此断掉。
    //     真正的失败（参数非法等）仍走上面的非零返回。
    process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
    return 0;
  }
  // 人读模式保留非零：在 shell 里 `code=device_policy_unset` 就该是"要你处理"的信号
  console.log(`[device-policy] code=${status.code}`);
  console.log(status.guidance);
  return status.configured ? 0 : 3;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}
