// ============================================================================
// device-policy-cli.unit.test.ts — 策略检查/登记 CLI 的授权边界
//                                  （openspec ... t6）
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { collectPolicyStatus, enroll, setPolicy } from '../../scripts/device-policy';
import { clearFrameworkConfigCache } from '../../config';
import { FakeCredentialProvider } from '../helpers/fake-credential-provider';
import type { UnitCaseResult } from '../run-unit';

const tmpRoots: string[] = [];

function run(results: UnitCaseResult[], name: string, fn: () => void): void {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, error: (err as Error).stack ?? (err as Error).message });
  }
}
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}
function assertEq<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function hostWith(device?: unknown): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'device-policy-'));
  tmpRoots.push(root);
  fs.writeFileSync(
    path.join(root, 'framework.config.json'),
    JSON.stringify({ schema_version: '1.1', project_name: 'T' }),
    'utf-8',
  );
  fs.writeFileSync(
    path.join(root, 'framework.local.json'),
    JSON.stringify({ schema_version: '1.0', agent_adapter: 'cursor', ...(device ? { device } : {}) }),
    'utf-8',
  );
  clearFrameworkConfigCache();
  return root;
}

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];
  try {

  run(results, '未配置 → device_policy_unset + 四选一指引（供主 agent 在起 runner 前询问）', () => {
    const s = collectPolicyStatus(hostWith());
    assertEq(s.configured, false, '未配置');
    assertEq(s.code, 'device_policy_unset', 'code');
    assert(s.guidance.includes('四选一'), '须给出四选一');
    assert(s.guidance.includes('手工解锁'), '选项①');
    assert(s.guidance.includes('--enroll'), '选项②须指向 TTY 登记');
    assert(s.guidance.includes('模拟器降级'), '选项③');
    assert(s.guidance.includes('本次停止'), '选项④');
    // **关键**：必须明确禁止把口令发到对话里
    assert(
      s.guidance.includes('绝不要') && s.guidance.includes('对话'),
      `须显式禁止口令进对话：${s.guidance}`,
    );
  });

  run(results, '选了「手工解锁」也算已配置 → 不再重复询问', () => {
    const s = collectPolicyStatus(hostWith({ unlock: { mode: 'manual' } }));
    assertEq(s.configured, true, 'manual 也是明确表达');
    assertEq(s.code, 'ok', '不再报 unset');
    assertEq(s.unlock_mode, 'manual', 'mode 透出');
    assertEq(s.credential_state, null, 'manual 无凭据状态');
  });

  run(results, '只允许模拟器降级（不启用自动解锁）也算已配置', () => {
    const s = collectPolicyStatus(hostWith({ emulator_fallback: 'managed' }));
    assertEq(s.configured, true, '模拟器档位也是明确表达');
    assertEq(s.emulator_fallback, 'managed', 'fallback 透出');
    assertEq(s.unlock_mode, null, '未启用自动解锁');
  });

  run(results, 'credential 模式透出凭据状态（burned 时人能一眼看到要重新登记）', () => {
    const root = hostWith({
      unlock: { mode: 'credential', credential_ref: 'maison/device/PHONE-1/v3' },
    });
    const id = { serial: 'PHONE-1', version: 3 };

    // 尚未登记 → absent
    const empty = new FakeCredentialProvider();
    const s0 = collectPolicyStatus(root, empty);
    assertEq(s0.unlock_mode, 'credential', 'mode');
    assertEq(s0.credential_ref, 'maison/device/PHONE-1/v3', 'ref 透出（opaque，不含口令）');
    assertEq(s0.credential_state, 'absent', '尚无凭据 → absent');

    // 已登记 → ready
    const ready = new FakeCredentialProvider();
    ready.seedReady(id, '123456');
    assertEq(collectPolicyStatus(root, ready).credential_state, 'ready', '已登记 → ready');

    // 失败烧毁 → burned（这正是"要重新登记"的信号）
    ready.burnCredential(id, '口令错误');
    const burned = collectPolicyStatus(root, ready);
    assertEq(burned.credential_state, 'burned', '烧毁 → burned');

    // 状态输出里绝不能出现口令字样，也不能泄露 blob 内容
    assert(!/pin|password|passcode/i.test(JSON.stringify(burned)), 'CLI 输出不得含口令字段');
    assert(!/123456/.test(JSON.stringify(burned)), 'CLI 输出不得含口令内容');
  });

  run(results, '**非 TTY 拒绝登记**（口令绝不能经 agent 管道输入）', () => {
    const root = hostWith();
    const origIsTty = process.stdin.isTTY;
    try {
      Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
      const code = enroll(root, 'PHONE-1');
      assert(code !== 0, `非 TTY 必须拒绝，实得 exit=${code}`);
      // 拒绝后不得留下任何配置痕迹
      const local = JSON.parse(
        fs.readFileSync(path.join(root, 'framework.local.json'), 'utf-8'),
      ) as { device?: unknown };
      assertEq(local.device, undefined, '拒绝时不得写入任何 device 配置');
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', { value: origIsTty, configurable: true });
    }
  });

  run(results, 'R14：①/③ 有规范化落盘路径 —— setPolicy 写完后 check 立即 ok（闭环成立）', () => {
    // 选①手工解锁
    const rootA = hostWith();
    assertEq(collectPolicyStatus(rootA).code, 'device_policy_unset', '初始未配置');
    assertEq(setPolicy(rootA, { unlockMode: 'manual' }), 0, 'setPolicy 应成功');
    clearFrameworkConfigCache();
    const a = collectPolicyStatus(rootA);
    assertEq(a.code, 'ok', '写完后重检须 ok（此前只能手改 JSON，重检仍报 unset）');
    assertEq(a.unlock_mode, 'manual', 'mode 落盘');

    // 选③模拟器降级
    const rootB = hostWith();
    assertEq(
      setPolicy(rootB, { emulatorFallback: 'managed', emulatorProfile: 'Pura 90', targetSerial: 'PHONE-9' }),
      0,
      'setPolicy 应成功',
    );
    clearFrameworkConfigCache();
    const b = collectPolicyStatus(rootB);
    assertEq(b.code, 'ok', '写完后重检须 ok');
    assertEq(b.emulator_fallback, 'managed', 'fallback 落盘');
    assertEq(b.target_serial, 'PHONE-9', 'serial 落盘');

    // 空调用与非法 serial 拒绝
    assert(setPolicy(hostWith(), {}) !== 0, '无任何项须拒绝');
    assert(setPolicy(hostWith(), { targetSerial: "bad'; evil" }) !== 0, '非法 serial 须拒绝');

    // 手工解锁**不得**残留 credential_ref
    const rootC = hostWith({ unlock: { mode: 'credential', credential_ref: 'maison/device/X/v1' } });
    assertEq(setPolicy(rootC, { unlockMode: 'manual' }), 0, 'setPolicy 应成功');
    clearFrameworkConfigCache();
    assertEq(collectPolicyStatus(rootC).credential_ref, null, '切回手工解锁须清掉凭据引用');
  });

  run(results, '源码契约：口令只从 TTY 隐藏输入读取，不接受 argv/env 传入', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', 'scripts', 'device-policy.ts'),
      'utf-8',
    );
    // R5：登记走 provider.promptAndWrite —— 提示与 CredWrite 在同一 helper 进程内完成，
    // 本文件不得再持有任何"读回明文"的路径
    assert(/promptAndWrite\(/.test(src), '登记须走 promptAndWrite（口令不出 helper 进程）');
    assert(!/PtrToStringAuto/.test(src), '不得把 SecureString 转明文回传 Node');
    assert(/process\.stdin\.isTTY/.test(src), '须校验真实 TTY');
    // 不得存在 --pin / --secret 之类的 argv 入口
    assert(!/--pin\b|--secret\b|--password\b/.test(src), '不得提供 argv 传口令的入口');
    assert(!/process\.env\.[A-Z_]*(PIN|PASSWORD|SECRET)/.test(src), '不得从 env 读口令');
    // R4：版本必须由**机器级**分配器给出（不得从当前项目 local config 推导——
    // 那样两个项目登记同一手机都会得 v1 并覆盖同一个 CM target）
    assert(/allocateCredentialVersion\(serial, provider\)/.test(src), '版本须由机器级分配器给出');
    assert(!/nextVersionFor/.test(src), '不得保留按项目推导版本的旧路径');
    // serial 须先过字符集校验再进 PowerShell target
    assert(/isValidSerial\(serial\)/.test(src), 'serial 须校验字符集');
  });

  return results;
  } finally {
    clearFrameworkConfigCache();
    for (const r of tmpRoots) {
      try { fs.rmSync(r, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  }
}
