## 1. 设备命令执行事实

- [x] 1.1 `runHdc` 返回 `HdcExecFact`（`ok/out/status/signal/timedOut/errorCode`），
  `ok` 判据维持 `!error && status===0` 不放宽；**不含 `error.message`**（Node 超时 message
  携带本机绝对路径，已实测确认）。
- [x] 1.2 提取纯投影 `projectHdcExecFact`，使单测能**驱动生产判据本身**而非另写等价逻辑
  （惯例同 `hdc-runner.ts` 的 `isHdcListTargetsProbeOk`）。
- [x] 1.3 既有调用点收编（listTargets / wake / param get / dumpLayout / cat / tap），
  只用 `ok` 的调用点语义不变。
- [x] 1.4 单测：超时形态（status:null / signal:SIGTERM / code:ETIMEDOUT）与非零 status
  各自正确投影；`ok` 判据不放宽也不收紧；断言事实中不含 `error.message`。

## 2. reveal 操作策略

- [x] 2.1 新增 `REVEAL_GESTURE_POLICY`（velocity 1500 px/s + timeout 10s）、
  `UITEST_VELOCITY_RANGE`（200–40000）、`REVEAL_TIMEOUT_FLOOR_MS`，velocity 与 timeout
  同处定义并互相引用；注释记录本次真机实测数据作为依据。
- [x] 2.2 `buildRevealSwipeArgs` 提取为导出纯函数，velocity 只在此处取自策略。
- [x] 2.3 `revealLockKeypad` 增执行器注入点（缺省即生产实现），供单测观察实际使用的
  velocity 与 timeout——**不用源码正则**验证同源。
- [x] 2.4 单测只钉结构性事实：同源、合法域、下限；**刻意不做**算术相容性断言
  （旧坏组合理论值 3.07s < 5s 会被放行），不锁死常量值。

## 3. reveal 执行结果被消费

- [x] 3.1 `UnlockDeps.reveal` 由 `void` 改为返回 `RevealOutcome`；类型注释明确声明
  **类型系统不能强制调用方消费返回值**，保证写在行为契约里。
- [x] 3.2 `ensureUnlocked` 检查 reveal outcome，`ok=false` 立即零输入返回。
- [x] 3.3 行为回归：该分支之后 `snapshot` 不再增加、`settle` 为 0、`claimAndUnlock` 为 0。
- [x] 3.4 测试 stub 全面收编（bench / benchFrames / runtime-recovery deps / 内联 deps）。

## 4. reveal_failed 归因与控制流硬闸

- [x] 4.1 `UnlockFailureKind` 增第四类 `reveal_failed`，判据收窄到命令自身失败/超时；
  注释对照「按处置差异收敛、拒绝兜底类」的既有裁决说明其合理性。
- [x] 4.2 控制流硬闸：reveal 失败即返回，`unlockFailureKindOf` **职责不变、不接收**
  reveal 执行事实——失败时它根本不会被调用。
- [x] 4.3 `revealBlockedNote` 独立文案，区分 `timeout` 与 `exec_failed`，携带结构化事实；
  **完全不出现「真机校准」字样**（连「勿做真机校准」也不写，以便回归严格禁用该词）。
- [x] 4.4 「可重试」不含自动重试：同一 attempt 最多 reveal 一次。

## 5. 回归与 fixture

- [x] 5.1 ETIMEDOUT → `reveal_failed` 全链传播用例。
- [x] 5.2 reveal 失败后零 snapshot 增量 / 零 settle / 零 PIN 点击 / 凭据不烧。
- [x] 5.3 reveal 失败且后续快照恰为时钟页形态 → 仍 `reveal_failed`，note 不含「真机校准」。
- [x] 5.4 reveal 成功路径既有重采样与 `layout_unsupported` 分类不回归（既有用例覆盖）。
- [x] 5.5 `device_unlock_attempt.failure_kind` / `phase_halt.unlock_failure_kind` 投影用例。
- [x] 5.6 运行期恢复 / 恢复桥原样透传 `reveal_failed` 用例。
- [x] 5.7 变异验证：拆掉 reveal 失败早退 → 4 条目标用例全红；`timedOut` 投影改坏 →
  执行事实用例红。
- [x] 5.8 新采 dump 与既有 fixture 结构指纹比对：`clock-only` ↔ 新时钟页、
  `keypad-stable` ↔ 新 PIN 页，`diagReason` / `digits` / `lockBounds` 形态 /
  承载字段 / structuralIds **逐字段一致 ⇒ 无新形态 ⇒ 不入库**。

## 5b. 复检返修（2026-08-17 第二轮 review）

- [x] 5b.1 **P1 `errorCode` 中途丢失**：底层 `HdcExecFact` 已产出 `errorCode`，但
  `revealLockKeypad` 返回 `RevealOutcome` 时只留 `ok/timedOut/signal/status`，随后又被降成
  note 字符串——与本 change 自己的规格「执行事实随解锁结论上浮」矛盾，且 `ENOENT` 会整个
  退化成 `exec_failed + signal/status none`。修复贯通全链：
  `HdcExecFact → RevealOutcome.errorCode → UnlockOutcome.revealFact →
  UnlockAttemptFact.revealFact → device_unlock_attempt.reveal_exec`，
  并同时贯通**运行期恢复**这条路径（`RuntimeRecoveryResult.revealFact`）——宿主两次实际
  撞的是它（`ut_hvigor_test` 装机步骤内部），只修 gate 链路会漏掉真正的现场。
- [x] 5b.2 **P2 profile 恢复桥未完整透传**：`recoverAfterLockFailure` 只回
  `{recovered, note}`，把 `ensureReadyBefore` 已分好的 `failureKind` 在这一跳丢掉。
  修复为原样保留 `failureKind` + `revealFact`。
- [x] 5b.3 原 5.6 用例名称宣称覆盖「runtime recovery/bridge 消费面」，实际只调
  `ensureDeviceReadyAtRuntime`，**从未经过 profile bridge**。补一条真正 require 并调用
  `bridge.ensureReadyBefore` / `bridge.recoverAfterLockFailure` 的回归（在运行期恢复层打桩）。
- [x] 5b.4 断言补到**生产返回值**而非只测底层投影：生产 `revealLockKeypad` 返回值须带
  `ETIMEDOUT`；`ensureUnlocked` 最终结论须能取到 `ETIMEDOUT`；`ENOENT + status 127`
  须与超时可区分。
- [x] 5b.5 变异验证：`revealLockKeypad` 去掉 `errorCode` 透传 → 策略用例红；
  桥的失败出口去掉结构化字段 → bridge 用例红。

## 6. 诚实性与规格

- [x] 6.1 更正 `device-readiness-deps.ts` 中「原始 dump 仅在显式校准旗标下另行落盘」的
  失实注释（该旗标从不存在，全文件零 `writeFileSync`），并写明刻意维持不落盘的理由。
- [x] 6.2 本 change 的 `specs/goal-runner/spec.md` delta：MODIFIED「reveal 在就绪门可观测」
  （参数同源/合法域/相容性由真机证明、执行事实进入事实链、一次 attempt 一次 reveal）
  + ADDED「布局分类需要 reveal 成功证据」。
- [x] 6.3 `openspec validate` 通过。**apply 前不修改 canonical
  `openspec/specs/goal-runner/spec.md`**，合并留到 archive。

## 7. 真机验收（2026-08-17 完成，设备 3UJ0225321000395）

- [x] 7.1 由**生产 gate** 自动完成解锁：
  `runDeviceReadinessGate(buildDeviceReadinessInput(hostRoot))`，`operator_unlocked_manually: false`；
  PIN 全程留在 Credential Manager 与 helper 进程内，未进入驱动进程。
- [x] 7.2 起始态已**证明**为时钟锁屏页：`screen_lock_root_present: true` /
  `pin_container_present: false` / `keypad_diag_reason: pin_container_not_found`，
  实际等待 45000ms。该形态与宿主 run 20260817T065727Z-1896c1 两次失败时的
  `container=absent digits=0/10` **完全同形**——起点正是修复前必然误判的那一帧。
- [x] 7.3 全链通过：`device_unlock_attempt outcome=succeeded` /
  note「已用登记凭据解锁并复验」→ `device_ready target_kind=physical` →
  `credential_state` 回到 `ready`（未烧毁）；全程 12069ms。
- [x] 7.4 新记录落于
  `harness/tests/fixtures/device-lockscreen/acceptance/a4e7c2f9-live-gate-2026-08-17T110000Z/`
  （verification.json + events.jsonl），绑定四个 sha256（含 `bounded-sync-wait.ts`，
  旧记录曾刻意未纳入）。旧 `f4b2c8e6-*` 的**历史证据部分未被改写**（`source_sha256`、
  2026-07-30 的验收结论、`changed_files[].verified_sha256`）；该文件**确有修改，但仅限
  状态字段**——`superseded_by_source_change.status` 改为 `CLOSED_BY_LATER_ACCEPTANCE`
  并新增 `closed_by` 反向指针。acceptance 判据面
  （`device-lockscreen-parser.unit.test.ts` 的 `ACCEPTANCE_DIR`）改指新记录。
  记录与事件均不含 PIN、通知原文或未脱敏 UI 内容。
- [x] 7.5 **判据面锁住 t8 核心证据**（二轮 review P1）：原 acceptance 用例只断言
  「两条成功事件 + passed + serial + 无凭据材料 + 已列哈希匹配」，删掉 `start_state_proof`
  或把 `pin_container_present` 改成 true 全测照样绿。补齐断言：
  `operator_unlocked_manually=false`、起始态三项证明 + `waited_ms` 非空、
  `reveal_executed=true`、`credential_state_after=ready`、
  `source_sha256` 路径集合与四文件**精确相等**、新旧记录**互相指认**
  （新记录 `supersedes.record/closes` + 旧记录 `status=CLOSED_BY_LATER_ACCEPTANCE`
  且 `closed_by` 反指新记录）。

## 8. 复跑最终验收（真机验收后）

- [x] 8.1 `npm run openspec:validate` 39/39；`harness npm test` exit=0
  （typecheck + unit 3294/0 + fixtures 44/0）；`git diff --check` 干净。
