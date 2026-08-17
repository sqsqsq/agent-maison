## Why

宿主 run `20260817T065727Z-1896c1` 在 ut-i21（closure 轮装机）与 testing-i23
（`device_test_install`）两次撞同一形态并停机等人：

```
unlock_blocked:layout_unsupported:pin_container_not_found
（零输入；container=absent digits=0/10 hidden_skipped=false；
锁屏布局与当前适配不符（有界重采样窗口耗尽仍未识别）——须真机校准）
```

2026-08-17 在真机 `3UJ0225321000395` 上完成四组受控复现，证明**该归因错误，锁屏 parser 与
`Digital_PSD_Input_Tip` 容器 id 完全正确，无需任何校准**：

| 实验 | swipe 耗时 | spawnSync 结果 | 生产 parser 的 keypadDiag |
|---|---|---|---|
| 时钟页（reveal 前） | — | — | `pin_container_not_found` · found:0 |
| 生产同款参数，**不限超时** | 5.20s | ok | **`ok` · found:10 · `0123456789`** |
| 生产同款 `spawnSync(timeout:5000)` | 5014ms | **SIGTERM / ETIMEDOUT** | **`pin_container_not_found` · found:0** |
| 同参数改 velocity=1500 | 1.15s | ok | **`ok` · found:10** |

根因是**两个耦合的魔法数分散在两处、从未被核对相容**：`revealLockKeypad` 写死
velocity=300 px/s，该机 `lockBounds` 高 2003px ⇒ 按 0.78→0.32 滑 921px，真机实测需 5.2s；
同一函数给 `runHdc` 的超时写死 5_000ms，`spawnSync` 到点 SIGTERM 终止 hdc，滑动未完成，
页面停在时钟页。

误报之所以能长期存活，是因为**执行事实全链丢失**：`runHdc` 只回 `{ok,out}`，丢弃
status/signal/error；`revealLockKeypad` 返回 `void`，连那个 ok 都无人消费。于是
「命令被超时砍断」在证据链上完全不存在，helper 只能拿 reveal **之后**的快照去分类——
那当然还是时钟页，于是必然落进 `layout_unsupported`。

既有 canonical 规格只要求「reveal 手势参数 MUST 传递合法值」——300 px/s 恰好合法
（`uitest` 合法域 200–40000），该口径放行了这个坏组合。

## What Changes

- `runHdc` 返回**结构化脱敏执行事实**（`ok/out/status/signal/timedOut/errorCode`）。
  `ok` 判据不放宽；**不含 `error.message`**（Node 超时 message 携带本机绝对路径）。
- reveal 的 velocity 与 timeout 收编为**同一处操作策略** `REVEAL_GESTURE_POLICY`
  （1500 px/s + 10s；实测 1153ms，余量约 8.7 倍）。
- `UnlockDeps.reveal` 由 `void` 改为返回 typed outcome，`ensureUnlocked` **必须消费它**：
  未成功即**立即零输入返回**，不进入重采样窗口、不再取样。
- `UnlockFailureKind` 增设第四类 `reveal_failed`，判据收窄到「reveal 命令自身失败/超时」。
- **控制流即硬闸**：reveal 失败时 `unlockFailureKindOf` 根本不会被调用，
  `layout_unsupported` 在结构上产不出来。分类器职责不变，**不接收** reveal 执行事实。
- 该类文案**完全不出现「真机校准」字样**（回归用例严格禁止该词出现在本类 note 中）。

## Capabilities

### New Capabilities

无新能力。新增的 `reveal_failed` 是既有 `UnlockFailureKind` 闭集的第四个成员，
符合该枚举既有的「按处置差异收敛」裁决（其下一步是排查 hdc/设备连通性，与重新登记凭据、
等 UI 稳定、真机校准布局三者都不同），不是被驳回过的兜底类。不新增等待状态机、
不新增配置字段、不新增运行期采集能力。

### Modified Capabilities

- `goal-runner`：reveal 在就绪门的可观测性口径由「参数合法」收紧为「参数相容且执行结果
  进入事实链」；新增「无 reveal 成功证据即不得产出 `layout_unsupported`」的分类前置。

## Impact

- 代码：`harness/scripts/utils/device-readiness-deps.ts`、
  `harness/scripts/utils/device-unlock-helper.ts`。
- 消费面无破坏性变更：`failureKind` 本就是可选闭集字段，
  `device_unlock_attempt.failure_kind`、`phase_halt.unlock_failure_kind`、
  运行期恢复与 `device-recovery-bridge` 均原样透传新成员。
- 行为收紧（属错误分类修复，不是兼容降级）：此前 reveal 失败会被误报成
  `layout_unsupported` 并指引「须真机校准」，现在如实报 `reveal_failed`
  并指向 hdc/设备连通性。
- **不做**运行期自动落原始锁屏 dump：原始树含通知与 UI 文本（隐私面），且根因修复不依赖它；
  同批只更正该处失实注释（代码中从来没有它宣称的「显式校准旗标」）。
- fixture：新采 dump 与既有 `clock-only` / `keypad-stable` 的**结构指纹逐字段一致**
  （lockRoot、PIN 容器 id、承载字段 `originalText`、`lockBounds` 形态、structuralIds 集合），
  **无新形态 ⇒ 不重复入库**。
- 真机复验欠账：本次直接改动解锁链核心，已按既有纪律刷新验收 fixture 的 `current_sha256`
  并保留 `PENDING_REAL_DEVICE_REVERIFICATION`（`verified_sha256` 不改）；新验收须从真正的
  时钟锁屏态起步跑通全链，并把 `bounded-sync-wait.ts` 纳入新 `source_sha256`。
