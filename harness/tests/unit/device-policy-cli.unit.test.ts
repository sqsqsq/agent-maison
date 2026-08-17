// ============================================================================
// device-policy-cli.unit.test.ts — 策略检查/登记 CLI 的授权边界
//                                  （openspec ... t6）
// ============================================================================

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { collectPolicyStatus, enroll, setPolicy, rebind } from '../../scripts/device-policy';
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
    assertEq(s.code, 'ok', 'managed 是可用降级路径');
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

    // 状态输出不得泄露口令。**口径分两层**（b3f7d9a2 t1 收窄）：
    //   ① 结构化字段（除人读 guidance 外的全部）不得出现 pin/password/passcode
    //      这类字段名或取值——这是"输出结构里夹带秘密"的真实风险面；
    //   ② 口令**内容**在整个输出（含 guidance）里任何地方都不得出现。
    // 旧断言把 ①扩到整个 JSON，会误伤 guidance 里"绝不要让用户把口令发到对话里 /
    // 无需重输 PIN"这类**指引正文**（unset 态必然带四选一文案）。
    const { guidance: _guidance, ...structured } = burned;
    assert(
      !/pin|password|passcode/i.test(JSON.stringify(structured)),
      `结构化字段不得含口令字段/取值：${JSON.stringify(structured)}`,
    );
    assert(!/123456/.test(JSON.stringify(burned)), 'CLI 输出（含 guidance）不得含口令内容');
  });

  // ==========================================================================
  // b3f7d9a2 t1：`code` 必须反映**凭据真值**，不能只看"表达过意图"
  //
  // 事故（2026-08-17 另一台宿主）：mode=credential 但凭据库里那条凭据根本不可用，
  // 旧判定 `configured = Boolean(mode || fallback)` 照报 `code=ok`，gate 判定表只
  // 分支 code → agent 按契约"已配置"就不问用户，普通模式 UT 一路撞到锁屏。
  // 下面每条都对旧判定必红。
  // ==========================================================================

  run(results, 't1 credential + 凭据不可用（absent/burned/unsupported）→ code=unset（旧判定报 ok，本条必红）', () => {
    const root = hostWith({
      unlock: { mode: 'credential', credential_ref: 'maison/device/PHONE-1/v3' },
    });
    const id = { serial: 'PHONE-1', version: 3 };

    // absent（未登记，或跨机拷贝后凭据留在原机）
    const absent = collectPolicyStatus(root, new FakeCredentialProvider());
    assertEq(absent.credential_state, 'absent', 'state 透出 absent');
    assertEq(absent.code, 'device_policy_unset', 'absent 必须触发四选一');
    assertEq(absent.configured, true, 'configured 仍是"表达过意图"（与 code 解耦）');
    assert(absent.guidance.includes('四选一'), 'unset 须带四选一');
    assert(absent.guidance.includes('--rebind'), 'absent 须提示可 rebind 复用已登记凭据');

    // burned
    const burnedProvider = new FakeCredentialProvider();
    burnedProvider.burnCredential(id, '口令错误');
    const burned = collectPolicyStatus(root, burnedProvider);
    assertEq(burned.credential_state, 'burned', 'state 透出 burned');
    assertEq(burned.code, 'device_policy_unset', 'burned 必须触发四选一');
    assert(burned.guidance.includes('重新登记'), 'burned 指引须指向重新登记');
    assert(burned.guidance.includes('墓碑'), 'burned 须说明墓碑不可用');

    // unsupported（形态不受支持）
    const unsupportedProvider = new FakeCredentialProvider();
    unsupportedProvider.blobs.set('MaisonDeviceUnlock:PHONE-1:v3', 'abcd');
    const unsupported = collectPolicyStatus(root, unsupportedProvider);
    assertEq(unsupported.credential_state, 'unsupported', 'state 透出 unsupported');
    assertEq(unsupported.code, 'device_policy_unset', 'unsupported 必须触发四选一');
    assert(unsupported.guidance.includes('数字 PIN'), 'unsupported 须说明受支持形态');
  });

  run(results, 't1 credential 但 credential_ref 缺失 / 非法 → code=unset 且优先指引 rebind', () => {
    // ref 整段缺失（白名单 merge 抹引用的历史事故形态）
    const missing = collectPolicyStatus(hostWith({ unlock: { mode: 'credential' } }), new FakeCredentialProvider());
    assertEq(missing.credential_ref, null, 'ref 缺失');
    assertEq(missing.credential_state, null, '无 ref 时不查凭据库');
    assertEq(missing.code, 'device_policy_unset', 'ref 缺失必须触发四选一');
    assert(missing.guidance.includes('credential_ref 缺失'), '须点名 ref 缺失');
    assert(missing.guidance.includes('--rebind'), '须优先指引 rebind（凭据本体可能还在）');

    // ref 非法（手改配置写坏）→ 指不到任何凭据，与未登记同处置
    const bad = collectPolicyStatus(
      hostWith({ unlock: { mode: 'credential', credential_ref: 'not-a-ref' } }),
      new FakeCredentialProvider(),
    );
    assertEq(bad.credential_state, 'absent', '非法 ref → absent');
    assertEq(bad.code, 'device_policy_unset', '非法 ref 必须触发四选一');
  });

  run(results, 't1 ready → ok；in_flight → ok 但指引"勿立即重登记"（不是"可用"的承诺）', () => {
    const root = hostWith({
      unlock: { mode: 'credential', credential_ref: 'maison/device/PHONE-1/v3' },
    });
    const id = { serial: 'PHONE-1', version: 3 };

    const ready = new FakeCredentialProvider();
    ready.seedReady(id, '123456');
    const okStatus = collectPolicyStatus(root, ready);
    assertEq(okStatus.code, 'ok', 'ready → ok');
    assertEq(okStatus.guidance, '设备策略已配置', 'ready 用简短确认文案');

    const inflight = new FakeCredentialProvider();
    inflight.seedClaim(id, 'aaaaaaaaaaaaaaaa', '123456');
    const inflightStatus = collectPolicyStatus(root, inflight);
    assertEq(inflightStatus.credential_state, 'in_flight', 'state 透出 in_flight');
    assertEq(inflightStatus.code, 'ok', 'in_flight 不触发重新选择策略（重登记会隐式回退不到旧版本）');
    assert(inflightStatus.guidance.includes('in_flight'), 'in_flight 须说明当前形态');
    assert(
      inflightStatus.guidance.includes('不要') && inflightStatus.guidance.includes('重新登记'),
      `in_flight 须明确不要重新登记：${inflightStatus.guidance}`,
    );
    assert(inflightStatus.guidance.includes('不要立即'), 'in_flight 须说"不要**立即**重登记"');
    // 崩在临界区遗留的 claim 是**持久**状态（device-credential-store 文件头：claim 里的口令
    // 永远用不上，等价 disabled，解除只有重新登记新版本一条路）。只说"稍后重试"会让用户
    // 永久卡住——guidance 必须给出这条出路。
    assert(
      inflightStatus.guidance.includes('持续') && inflightStatus.guidance.includes('不会'),
      `in_flight 须说明持续存在的遗留 claim 不会自行恢复：${inflightStatus.guidance}`,
    );
    assert(inflightStatus.guidance.includes('device:enroll'), 'in_flight 须给出登记新版本这条唯一出路');
    assert(!/123456/.test(JSON.stringify(inflightStatus)), 'in_flight 输出不得泄露 claim 里的口令');
  });

  run(results, 't1 fallback 仅 existing|managed 算可用：disabled 不得掩盖坏凭据，也不得单独算已配置', () => {
    // disabled 单独存在 → 表达过意图但无可用路径
    const onlyDisabled = collectPolicyStatus(hostWith({ emulator_fallback: 'disabled' }));
    assertEq(onlyDisabled.configured, true, 'disabled 也是表达过意图');
    assertEq(onlyDisabled.code, 'device_policy_unset', 'disabled 不构成可用设备路径（旧判定报 ok）');
    assert(onlyDisabled.guidance.includes('disabled'), '须点名 disabled 不算可用路径');

    // 坏凭据 + disabled → 仍 unset
    const badCredDisabled = collectPolicyStatus(
      hostWith({
        unlock: { mode: 'credential', credential_ref: 'maison/device/PHONE-1/v3' },
        emulator_fallback: 'disabled',
      }),
      new FakeCredentialProvider(),
    );
    assertEq(badCredDisabled.code, 'device_policy_unset', 'disabled 不得掩盖 absent 凭据');

    // 坏凭据 + existing → ok（模拟器是真的能走的路）
    const badCredExisting = collectPolicyStatus(
      hostWith({
        unlock: { mode: 'credential', credential_ref: 'maison/device/PHONE-1/v3' },
        emulator_fallback: 'existing',
      }),
      new FakeCredentialProvider(),
    );
    assertEq(badCredExisting.code, 'ok', '已授权模拟器降级 → 有可用路径');
    assertEq(badCredExisting.credential_state, 'absent', '凭据状态仍如实透出');

    // 坏凭据 + managed → ok
    const badCredManaged = collectPolicyStatus(
      hostWith({
        unlock: { mode: 'credential', credential_ref: 'maison/device/PHONE-1/v3' },
        emulator_fallback: 'managed',
      }),
      new FakeCredentialProvider(),
    );
    assertEq(badCredManaged.code, 'ok', 'managed 同样是可用路径');
  });

  run(results, 't1 凭据库不可读 → **抛出执行失败**，既不 ok 也不 unset（不得误导重新登记）', () => {
    const root = hostWith({
      unlock: { mode: 'credential', credential_ref: 'maison/device/PHONE-1/v3' },
    });
    const broken = new FakeCredentialProvider({ inspectError: 'cred vault unreachable' });
    let thrown: Error | null = null;
    try {
      collectPolicyStatus(root, broken);
    } catch (e) {
      thrown = e as Error;
    }
    assert(thrown !== null, '凭据库不可读须抛出（走执行失败通道），不得返回任何 code');
    assert(/凭据库不可读/.test(thrown!.message), `须报告 provider 错误：${thrown!.message}`);
    assert(/cred vault unreachable/.test(thrown!.message), '须带上 provider 原始错误');
    assert(
      /不是.*未配置|不要据此重新登记/.test(thrown!.message),
      `须明确这不是"未配置"、不要据此重新登记：${thrown!.message}`,
    );
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

  run(results, 't1 device:set 经 updateLocalConfig 无损：写 emulator 档位不丢 device.unlock.credential_ref + vision + toolchain', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'device-policy-'));
    tmpRoots.push(root);
    fs.writeFileSync(
      path.join(root, 'framework.config.json'),
      JSON.stringify({ schema_version: '1.1', project_name: 'T' }),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(root, 'framework.local.json'),
      JSON.stringify({
        schema_version: '1.0',
        agent_adapter: 'cursor',
        vision: { image_input_override: 'native_attach' },
        toolchain: { devEcoStudio: { installPath: 'C:/DevEco' } },
        device: { unlock: { mode: 'credential', credential_ref: 'maison/device/PHONE-1/v3' }, target_serial: 'PHONE-1' },
      }),
      'utf-8',
    );
    clearFrameworkConfigCache();
    assertEq(setPolicy(root, { emulatorFallback: 'managed' }), 0, 'setPolicy 应成功');
    clearFrameworkConfigCache();
    const local = JSON.parse(
      fs.readFileSync(path.join(root, 'framework.local.json'), 'utf-8'),
    ) as {
      device?: { unlock?: { mode?: string; credential_ref?: string }; emulator_fallback?: string; target_serial?: string };
      vision?: { image_input_override?: string };
      toolchain?: { devEcoStudio?: { installPath?: string } };
    };
    assertEq(local.device?.unlock?.mode, 'credential', 'device.unlock.mode 应保留');
    assertEq(local.device?.unlock?.credential_ref, 'maison/device/PHONE-1/v3', 'credential_ref 应原样保留（本次事故根因）');
    assertEq(local.device?.target_serial, 'PHONE-1', 'target_serial 应保留');
    assertEq(local.device?.emulator_fallback, 'managed', 'emulator_fallback 落盘');
    assertEq(local.vision?.image_input_override, 'native_attach', 'vision 应保留');
    assertEq(local.toolchain?.devEcoStudio?.installPath, 'C:/DevEco', 'toolchain 应保留');
  });

  run(results, 't4 device:rebind ready 成功写回（经 updateLocalConfig，其余字段不丢）', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'device-policy-'));
    tmpRoots.push(root);
    fs.writeFileSync(
      path.join(root, 'framework.config.json'),
      JSON.stringify({ schema_version: '1.1', project_name: 'T' }),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(root, 'framework.local.json'),
      JSON.stringify({
        schema_version: '1.0',
        agent_adapter: 'cursor',
        vision: { image_input_override: 'native_attach' },
        toolchain: { devEcoStudio: { installPath: 'C:/DevEco' } },
        device: { unlock: { mode: 'manual' }, target_serial: 'OLD' },
      }),
      'utf-8',
    );
    clearFrameworkConfigCache();
    const provider = new FakeCredentialProvider();
    provider.seedReady({ serial: 'PHONE-1', version: 3 }, '123456');
    assertEq(rebind(root, 'PHONE-1', '3', provider), 0, 'ready 应放行');
    clearFrameworkConfigCache();
    const local = JSON.parse(
      fs.readFileSync(path.join(root, 'framework.local.json'), 'utf-8'),
    ) as {
      device?: { unlock?: { mode?: string; credential_ref?: string }; target_serial?: string };
      vision?: { image_input_override?: string };
      toolchain?: { devEcoStudio?: { installPath?: string } };
    };
    assertEq(local.device?.unlock?.mode, 'credential', 'mode 须改为 credential');
    assertEq(local.device?.unlock?.credential_ref, 'maison/device/PHONE-1/v3', 'credential_ref 须写回');
    assertEq(local.device?.target_serial, 'PHONE-1', 'target_serial 须写回');
    assertEq(local.vision?.image_input_override, 'native_attach', 'vision 须保留（updateLocalConfig 无损）');
    assertEq(local.toolchain?.devEcoStudio?.installPath, 'C:/DevEco', 'toolchain 须保留');
  });

  run(results, 't4 device:rebind 五个拒绝分支（burned / in_flight / unsupported / absent 无 error / absent 有 error）', () => {
    const root = hostWith();
    const id = { serial: 'PHONE-1', version: 3 };
    const errs: string[] = [];
    const origErr = console.error;
    console.error = (m: unknown) => { errs.push(String(m)); };
    try {
      // burned
      const burned = new FakeCredentialProvider();
      burned.burnCredential(id, '口令错误');
      assertEq(rebind(root, 'PHONE-1', '3', burned) !== 0, true, 'burned 须拒绝');
      assert(errs.join('\n').includes('重新登记'), 'burned 指引须指向重新登记');

      // in_flight（上次崩在临界区遗留 claim）
      errs.length = 0;
      const inflight = new FakeCredentialProvider();
      inflight.seedClaim(id, 'aaaaaaaaaaaaaaaa', '123456');
      assertEq(rebind(root, 'PHONE-1', '3', inflight) !== 0, true, 'in_flight 须拒绝');
      assert(errs.join('\n').includes('稍后重试'), 'in_flight 指引须先稍后重试，不得默认立即重登记');
      // 但**不得只写"稍后重试"**：崩在临界区遗留的 claim 是持久状态、不会自愈
      //（device-credential-store 文件头），只说重试会让用户永久等待。三处文案须一致：
      // collectPolicyStatus 的 guidance、本 rebind 出口、device-policy-gate.md。
      assert(
        errs.join('\n').includes('持续存在') && errs.join('\n').includes('device:enroll'),
        `in_flight 须同时给出"持续存在则登记新版本"这条唯一出路：${errs.join('\n')}`,
      );

      // unsupported
      errs.length = 0;
      const unsupported = new FakeCredentialProvider();
      unsupported.blobs.set('MaisonDeviceUnlock:PHONE-1:v3', 'abcd');
      assertEq(rebind(root, 'PHONE-1', '3', unsupported) !== 0, true, 'unsupported 须拒绝');

      // absent 无 error
      errs.length = 0;
      const absent = new FakeCredentialProvider();
      assertEq(rebind(root, 'PHONE-1', '3', absent) !== 0, true, 'absent 无 error 须拒绝');

      // absent 有 error（provider 不可读）
      errs.length = 0;
      const absentErr = new FakeCredentialProvider({ inspectError: 'cred vault unreachable' });
      assertEq(rebind(root, 'PHONE-1', '3', absentErr) !== 0, true, 'absent 有 error 须拒绝');
      assert(errs.join('\n').includes('凭据库不可读'), 'absent 有 error 须原样报告不可读，而非 unsupported');
    } finally {
      console.error = origErr;
    }

    // 所有拒绝分支都不得写盘（引用保持原样）
    clearFrameworkConfigCache();
    const local = JSON.parse(
      fs.readFileSync(path.join(root, 'framework.local.json'), 'utf-8'),
    ) as { device?: unknown };
    assertEq(local.device, undefined, '拒绝分支不得写入任何 device 配置');
  });

  run(results, 't4 device:rebind 参数校验：serial 不合规 / 缺 version / version 非正整数', () => {
    const root = hostWith();
    const provider = new FakeCredentialProvider();
    assertEq(rebind(root, "bad'; inj", '3', provider) !== 0, true, 'serial 含非法字符须拒绝');
    assertEq(rebind(root, 'PHONE-1', '', provider) !== 0, true, '缺 version 须拒绝');
    assertEq(rebind(root, 'PHONE-1', '0', provider) !== 0, true, 'version 0 须拒绝');
    assertEq(rebind(root, 'PHONE-1', '-2', provider) !== 0, true, 'version 负数须拒绝');
    assertEq(rebind(root, 'PHONE-1', '1.5', provider) !== 0, true, 'version 小数须拒绝');
    assertEq(rebind(root, 'PHONE-1', 'abc', provider) !== 0, true, 'version 非数字须拒绝');
  });

  run(results, 't4 **进程级**：--rebind 缺参/非法参数 → 非零退出 + version 来源提示（不触碰凭据库）', () => {
    const root = hostWith();
    const script = path.join(__dirname, '..', '..', 'scripts', 'device-policy.ts');
    // 缺 --version → 非零 + 提示 version 来源与禁止枚举说明
    const r1 = spawnSync(
      process.execPath,
      ['-r', 'ts-node/register/transpile-only', script, '--rebind', '--serial', 'PHONE-1', '--project-root', root],
      { encoding: 'utf-8', cwd: path.join(__dirname, '..', '..'), timeout: 60_000, env: { ...process.env, TS_NODE_TRANSPILE_ONLY: 'true' } },
    );
    assertEq(r1.status, 2, '缺 --version 须非零退出（实得 ' + r1.status + '）');
    assert(/MaisonDeviceUnlock/.test(r1.stderr ?? ''), '缺参时应提示 version 来源（凭据管理器 target 名）');
    assert(/#burned/.test(r1.stderr ?? ''), '应提示 `#burned` 墓碑不可用');
    // 非法 serial → 非零
    const r2 = spawnSync(
      process.execPath,
      ['-r', 'ts-node/register/transpile-only', script, '--rebind', '--serial', "bad'; inj", '--version', '3', '--project-root', root],
      { encoding: 'utf-8', cwd: path.join(__dirname, '..', '..'), timeout: 60_000, env: { ...process.env, TS_NODE_TRANSPILE_ONLY: 'true' } },
    );
    assertEq(r2.status, 2, '非法 serial 须非零退出（实得 ' + r2.status + '）');
  });

  run(results, '**进程级**：--check --json 的 stdout 可直接 JSON.parse，退出码恒 0', () => {
    // review：文档承诺"仅解析 stdout JSON"，但此前 ① `npm run` 会往 stdout 插 banner，
    // ② 未配置时退出码是 3 —— agent 很可能当成"命令失败"，而不是读 code 去问用户，
    // 四选一的闭环就此断掉。这条用**真实子进程**验证契约，不是查文档关键词。
    const root = hostWith(); // 未配置状态
    const script = path.join(__dirname, '..', '..', 'scripts', 'device-policy.ts');
    const r = spawnSync(
      process.execPath,
      ['-r', 'ts-node/register/transpile-only', script, '--check', '--json', '--project-root', root],
      {
        encoding: 'utf-8',
        cwd: path.join(__dirname, '..', '..'),
        timeout: 60_000,
        env: { ...process.env, TS_NODE_TRANSPILE_ONLY: 'true' },
      },
    );
    assertEq(r.error, undefined, `子进程不应报错：${r.error?.message}`);
    // ① stdout 必须是**纯 JSON**——一个字符的前缀都不能有
    let parsed: { code?: string; guidance?: string } | null = null;
    try {
      parsed = JSON.parse(r.stdout ?? '') as { code?: string; guidance?: string };
    } catch (e) {
      throw new Error(
        `stdout 必须可直接 JSON.parse（${(e as Error).message}）。实际前 200 字符：\n${(r.stdout ?? '').slice(0, 200)}`,
      );
    }
    assert(typeof parsed?.code === 'string', `须有 code 字段：${JSON.stringify(parsed).slice(0, 200)}`);
    // ② 退出码恒 0：device_policy_unset 是正常状态，不是命令失败
    assertEq(
      r.status,
      0,
      `--json 模式退出码必须恒 0（实得 ${r.status}，code=${parsed?.code}）——` +
        '非零会让调用方误判成"命令挂了"而不去读 code 问用户',
    );
    // ③ 人读信息在 guidance 字段里，不得另走 stdout
    assert(typeof parsed?.guidance === 'string' && parsed.guidance.length > 0, '人读指引须在 guidance 字段');
  });

  run(results, '**进程级**：已配置时同样 code=ok + 退出码 0（两态一致）', () => {
    const root = hostWith({ unlock: { mode: 'manual' } });
    const script = path.join(__dirname, '..', '..', 'scripts', 'device-policy.ts');
    const r = spawnSync(
      process.execPath,
      ['-r', 'ts-node/register/transpile-only', script, '--check', '--json', '--project-root', root],
      {
        encoding: 'utf-8',
        cwd: path.join(__dirname, '..', '..'),
        timeout: 60_000,
        env: { ...process.env, TS_NODE_TRANSPILE_ONLY: 'true' },
      },
    );
    const parsed = JSON.parse(r.stdout ?? '') as { code?: string; configured?: boolean };
    assertEq(parsed.code, 'ok', '已配置须 code=ok');
    assertEq(parsed.configured, true, 'configured 须 true');
    assertEq(r.status, 0, '已配置同样 0');
  });

  run(results, '**进程级**：配置损坏 → 非零退出 + stdout 非合法 JSON（执行失败必须可辨认）', () => {
    // review：文档若写成"退出码恒 0、不看退出码"就太绝对了——真实执行错误
    //（framework.local.json 损坏等）仍会非零。契约是**两段**判定：
    //   ① 0 且 stdout 合法 JSON → 看 code；② 否则 = 执行失败必须停止。
    // 这条给第 ② 段代码背书，防文档再次说一套。
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'device-policy-corrupt-'));
    tmpRoots.push(root);
    fs.writeFileSync(
      path.join(root, 'framework.config.json'),
      JSON.stringify({ schema_version: '1.1', project_name: 'T' }),
      'utf-8',
    );
    fs.writeFileSync(path.join(root, 'framework.local.json'), '{ not json', 'utf-8');
    const script = path.join(__dirname, '..', '..', 'scripts', 'device-policy.ts');
    const r = spawnSync(
      process.execPath,
      ['-r', 'ts-node/register/transpile-only', script, '--check', '--json', '--project-root', root],
      {
        encoding: 'utf-8',
        cwd: path.join(__dirname, '..', '..'),
        timeout: 60_000,
        env: { ...process.env, TS_NODE_TRANSPILE_ONLY: 'true' },
      },
    );
    assert(r.status !== 0, `配置损坏必须非零退出（实得 ${r.status}）——否则调用方无从分辨执行失败`);
    let parseable = true;
    try {
      JSON.parse(r.stdout ?? '');
    } catch {
      parseable = false;
    }
    assertEq(parseable, false, '执行失败时 stdout 不得是合法 JSON（不能让调用方误当正常结果）');
    assert(
      /framework\.local\.json|JSON/i.test(r.stderr ?? ''),
      `失败原因须进 stderr 供人排查：${(r.stderr ?? '').slice(0, 200)}`,
    );
  });

  run(results, 't1 **进程级**：坏凭据下 JSON 与人读模式一致（configured=true 但 code=unset → 人读 exit 3）', () => {
    // 事故形态：code 与 configured 解耦后，人读退出码若仍看 configured 就会
    // 在坏凭据下静默 exit 0——shell 里等于"没事"，与 --json 的 code 自相矛盾。
    const root = hostWith({
      // 指向一条**不存在**的凭据（真机凭据库里不会有 PHONE-NOPE），
      // 用真实 windowsCredentialProvider 走进程级路径：非 Windows 平台
      // provider.available() 为 false，inspect 会带 error → 走执行失败通道，
      // 故这条只在 Windows 上断言 unset，其余平台断言"执行失败"形态。
      unlock: { mode: 'credential', credential_ref: 'maison/device/PHONE-NOPE/v1' },
    });
    const script = path.join(__dirname, '..', '..', 'scripts', 'device-policy.ts');
    const spawn = (args: string[]) =>
      spawnSync(
        process.execPath,
        ['-r', 'ts-node/register/transpile-only', script, ...args, '--project-root', root],
        { encoding: 'utf-8', cwd: path.join(__dirname, '..', '..'), timeout: 60_000, env: { ...process.env, TS_NODE_TRANSPILE_ONLY: 'true' } },
      );

    const json = spawn(['--check', '--json']);
    const human = spawn(['--check']);

    if (process.platform === 'win32') {
      const parsed = JSON.parse(json.stdout ?? '') as { code?: string; configured?: boolean };
      assertEq(json.status, 0, '正常态（含 unset）--json 退出码 0');
      assertEq(parsed.code, 'device_policy_unset', '不存在的凭据 → unset');
      assertEq(parsed.configured, true, 'configured 仍表示"表达过意图"');
      assertEq(human.status, 3, `人读模式须以 code 为准 → exit 3（实得 ${human.status}）`);
      assert(/device_policy_unset/.test(human.stdout ?? ''), '人读须打印 code');
    } else {
      // 非 Windows：provider 不可用 → inspect 带 error → 执行失败通道
      assert(json.status !== 0, `非 Windows 凭据库不可读须非零（实得 ${json.status}）`);
      let parseable = true;
      try { JSON.parse(json.stdout ?? ''); } catch { parseable = false; }
      assertEq(parseable, false, '执行失败时 stdout 不得是合法 JSON');
      assert(human.status !== 0, '人读模式同样非零');
    }
  });

  run(results, 't1 **进程级**：凭据库不可读 → 非零退出 + stdout 无 JSON + stderr 说明"不是未配置"', () => {
    // 用非 Windows 平台的等价形态无法在 win32 上构造真实 provider 故障，
    // 因此这条走 collectPolicyStatus 的注入点在上面的单元用例里覆盖；
    // 进程级这条只钉住"抛出后 main 的出口形态"——用损坏配置触发同一条 catch。
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'device-policy-fail-'));
    tmpRoots.push(root);
    fs.writeFileSync(
      path.join(root, 'framework.config.json'),
      JSON.stringify({ schema_version: '1.1', project_name: 'T' }),
      'utf-8',
    );
    fs.writeFileSync(path.join(root, 'framework.local.json'), '{ broken', 'utf-8');
    const script = path.join(__dirname, '..', '..', 'scripts', 'device-policy.ts');
    const r = spawnSync(
      process.execPath,
      ['-r', 'ts-node/register/transpile-only', script, '--check', '--json', '--project-root', root],
      { encoding: 'utf-8', cwd: path.join(__dirname, '..', '..'), timeout: 60_000, env: { ...process.env, TS_NODE_TRANSPILE_ONLY: 'true' } },
    );
    assert(r.status !== 0, `执行失败须非零（实得 ${r.status}）`);
    assertEq((r.stdout ?? '').trim(), '', '执行失败时 stdout 须为空（不得输出半个 JSON）');
    assert(
      !/at\s+\w+\s+\(/.test(r.stderr ?? ''),
      `失败原因须是人读消息而非裸栈：${(r.stderr ?? '').slice(0, 200)}`,
    );
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
