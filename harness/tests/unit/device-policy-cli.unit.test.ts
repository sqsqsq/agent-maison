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
