# 设备策略门控（需设备阶段的入口前置）

链路含**需要设备的阶段**时（由 profile 的 `device_capabilities` 声明，hmos-app 是 `ut` 与
`testing`），进入该阶段之前必须确认设备策略。**goal 与普通模式同一契约**——两种模式下
用户都不该自己去猜"为什么设备用不了、有没有别的办法"。

## 为什么是前置而不是运行期处理

设备就绪门排在 `agent_invoke_start` 之前：未取得 READY 就不调 agent，agent 便根本不会
进入"发现锁屏后自行处置"的场景。2026-07-28 的事故里，agent 正是在那个场景下对用户真机
枚举了 10 组常见 PIN，导致设备被锁定。

**结构性阻断 > 行为禁令**：框架拦不住 agent 按绝对路径调 `hdc`，能做的是不产生调用时机。
因此策略必须**在起阶段之前**确认——尤其 goal 的 detached runner 结构上无法弹交互，
错过这个窗口就只能一路 BLOCKED。

## 探测（BLOCKER）

```bash
cd framework/harness && npx ts-node scripts/device-policy.ts --check --json
```

**直接调脚本，不要走 `npm run`**——npm 会在 stdout 里插 banner（`> harness@1.0.0 …`），
JSON 就没法直接 parse 了。这与 [personal-setup-gate](personal-setup-gate.md) 同惯例。

**仅解析 stdout JSON**（稳定字段：`configured`, `code`, `unlock_mode`, `emulator_fallback`,
`target_serial`, `credential_ref`, `credential_state`, `guidance`）。

**退出码契约**（两段判定，缺一不可）：

1. **退出码 0 且 stdout 是合法 JSON** → 探测正常完成，**一切看 `code` 字段**。
   `device_policy_unset` 属于正常结果，不是命令失败——见到它就去问用户，别当成挂了。
2. **退出码非零，或 stdout 不是合法 JSON** → **执行失败，必须停止**并把原因交回用户。
   典型场景：`framework.local.json` 损坏（实测 `exit=1` 且 stdout 为空）、路径/权限问题。
   这种情况**绝不能**忽略退出码继续往下走。

| `code` | 行为 |
|--------|------|
| `ok` | 已配置 → 继续本阶段 |
| `device_policy_unset` | **必须先问用户四选一**（见下），落盘后重跑确认 `code=ok` |

## 四选一（registry `setup.device_policy`）

| 选项 | 含义 | 谁来执行 |
|------|------|----------|
| ① 手工解锁 | 人保证设备可用；框架永不碰口令 | agent 自跑 `npm run device:set -- --manual-unlock` |
| ② 启用自动解锁 | 用户在**自己终端**登记凭据 | **用户**，见下方红线 |
| ③ 允许模拟器降级 | 用真机之外的设备兜底 | agent 自跑，但**须先追问档位**，见下 |
| ④ 本次停止 | 属本次运行结果，**不持久化** | **不执行任何命令**，直接停止本次运行 |

多设备时补 `--serial <序列号>`；否则就绪门判 AMBIGUOUS 停止求人，**不赌"第一个"**。

### 选 ③ 时必须追问档位（不得默认 managed）

「允许降级」**不等于**「同意框架主动拉起并托管模拟器」——后者会 spawn 进程、会在收尾
时 kill 进程，是另一个量级的授权。必须把两档摊开让用户选：

| 档位 | 框架会做什么 | 落盘命令 |
|------|-------------|----------|
| `existing` | **只复用**用户已经开着的实例；**绝不启动、绝不关闭** | `npm run device:set -- --emulator existing` |
| `managed` | 由框架**启动**模拟器，并在收尾时**回收**（只回收本 run 启动的那个） | `npm run device:set -- --emulator managed --emulator-profile "<AVD 名>"` |

选 `managed` 还须**再确认具体的 emulator profile（AVD 名）**：未配置时框架明确报"本 profile
未提供模拟器托管能力"，而**不会**拿一个猜出来的 AVD 名去启动别的模拟器。

## 选 ② 时的红线

把这条命令**交给用户在他自己的终端里跑**，agent 不得代跑：

```bash
cd framework/harness && npm run device:enroll -- --serial <设备序列号>
```

> - **绝不要让用户把 PIN 发到对话里**，也绝不要代为输入。口令进对话即等于进 transcript。
> - PIN 只能在真实 TTY 隐藏输入（非 TTY 时 CLI 直接拒绝），全程不进 argv/env/pipe。
> - 框架只使用用户登记的那一个凭据，**无候选集、无重试**。
> - **任何一次解锁失败即机器级烧毁该凭据版本**，此后所有 goal / 项目 / 并发进程都不再
>   尝试；唯一出路是重新登记（生成新版本）。这是防"反复试错把手机锁死"的止损设计。

用户跑完后**重跑上面那条探测命令**（`npx ts-node scripts/device-policy.ts --check --json`，
同样不要走 `npm run`）确认 `code=ok` 再继续。

## 阶段执行中遇到设备不可用

就绪门/运行期恢复判定为外部阻断时，harness 会产出
`blocking_class=externalBlocked` + `failure_kind=device_blocked`，指引指向**人解锁设备**。
此时**不要**改产品代码，也**不要**尝试自行解锁——按指引请人处理后重跑本阶段即可。
