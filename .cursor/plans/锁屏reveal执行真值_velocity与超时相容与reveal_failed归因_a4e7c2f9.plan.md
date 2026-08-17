---
name: 锁屏 reveal 执行真值 — velocity/timeout 相容 / 执行事实不丢 / reveal_failed 归因（lockscreen-reveal-execution-truth）
version: 3.0.0
# 版本说明：本 plan 纳入当前 3.0.0 窗口，完成后随本版发布（pending todos 进入 3.0.0 发布门）。
overview: >
  宿主 run 20260817T065727Z-1896c1 在 ut-i21（closure 轮装机）与 testing-i23
  （device_test_install）两次撞同一形态：
  `unlock_blocked:layout_unsupported:pin_container_not_found（零输入；container=absent
  digits=0/10 hidden_skipped=false）`，诊断文案断言「锁屏布局与当前适配不符——须真机
  校准（原地重试无意义）」。2026-08-17 在真机 3UJ0225321000395 上完成四组受控复现，
  证明**该归因错误：布局识别器与 PIN_CONTAINER_ID 完全正确，无需任何校准**。

  实证链（四组，均以生产函数 parseLockScreenTree 解析真机 dump，非合成树；
  dump 一律 `hdc file recv` 取回，不走 PowerShell 管道）：
  ① 时钟页（reveal 前）→ keypadDiag `pin_container_not_found` / containerFound:false /
     found:0 —— 与宿主失败文案**逐字一致**，即该文案是「时钟页」的指纹，不是「布局不认识」；
  ② 生产同款 swipe 参数、**不限超时** → 耗时 5.20s，PIN 页出现，keypadDiag `ok` /
     containerFound:true / found:10 / digits `0123456789`，几何校验通过；
  ③ 生产同款 `spawnSync(timeout:5000)` → elapsedMs 5014、ok:false、signal:SIGTERM、
     error `spawnSync hdc ETIMEDOUT`，随后 dump 回到 `pin_container_not_found` ——
     **故障 100% 复现**；
  ④ 同一 swipe 改 velocity=1500（wake 前置齐全）→ 1153ms、ok:true，keypadDiag `ok` /
     found:10 —— 提速修复实测有效。

  根因：revealLockKeypad（device-readiness-deps.ts:598）写死 velocity=300 px/s；该机
  锁屏 lockBounds=[0,117][1320,2120]，按 0.78→0.32 公式滑动距离 921px；同一行给 runHdc
  的超时写死 5_000ms，spawnSync 到点 SIGTERM 终止 hdc 进程，命令未完成即被中止，
  锁屏页停留/回弹在时钟页。**两个耦合的魔法数分散在两处、从未被核对相容**。

  注意理论值与实测值的差距本身就是本 plan 的一条依据：按 921/300 理论应为 3.07s
  （< 5s，"看起来相容"），真机实际 5.2s。**故任何基于 distance/velocity 的理论相容性
  断言都会给旧的坏组合放行**，相容性只能由真机验收证明（见 t2）。

  该误报能长期存活的原因是执行事实全链丢失：runHdc（:49）只回 {ok,out}，丢弃
  status/signal/error；revealLockKeypad 返回 void，连那个 ok 都无人消费；于是
  ETIMEDOUT+SIGTERM 这一事实在证据链上完全不存在，helper（device-unlock-helper.ts:218）
  只能拿「reveal 之后仍是时钟页」的快照去分类，必然落进 layout_unsupported。

  三处曾被写入分析、经核实**证伪或需限定**的结论（记录以防复发）：
  · 「首轮 succeeded 只可能是设备当时没锁」——**错**。宿主 events.jsonl 首条
    device_unlock_attempt note 为「已用登记凭据解锁并复验」，首轮确实输入 PIN 并成功。
    正解：首帧已停在 PIN 页时 completeKeypad 直接命中十键，**根本不执行 reveal**。
  · 「凡需执行 reveal 的场景必然失败」——**需限定**，准确表述为：在该设备、当前固件、
    当前 lockBounds 与 300px/s + 5s 参数组合下，需从时钟页执行 reveal 的路径稳定失败。
    不得泛化到所有设备与所有 reveal 场景。
  · 「现有单测全靠合成树、无真机锁屏 fixture」——**错**。
    harness/tests/fixtures/device-lockscreen 已有 **三份真机**（clock-only /
    clock-with-face-hint / keypad-stable）**+ 一份合成**（mixed-clock-and-partial）
    fixture，由生产 parser 驱动（device-lockscreen-parser.unit.test.ts:69）。
  另：本 plan 早期稿曾称"滑动在 96% 处被腰斩"——**该推断已删除**。5.2s 总耗时含进程
  启动与通信开销，5s 超时只能证明命令未完成即被终止，不能反推手势实际执行进度。

  本 plan 性质：设备命令**执行真值**的窄补丁 —— 让 reveal 的成败进入证据链，让分类
  建立在证据之上。不扩机制、不新增等待状态机、不新增运行期采集能力、不加自动重试。
  范围冻结：b3f7d9a2（设备策略真值/入口门/serial 统一）不受本 plan 影响、不得重开；
  PIN 布局识别器与 PIN_CONTAINER_ID **确认无缺陷，本 plan 不动**。
todos:
  - id: t1-runhdc-execution-fact
    content: >
      runHdc（device-readiness-deps.ts:49）返回**结构化、脱敏的执行事实**而非
      {ok,out}：至少含 ok / status / signal / timedOut / errorCode（error.code，
      如 ETIMEDOUT），不得携带任何 UI 原文或 stdout 正文之外的设备内容。
      ok 判据维持现状（!error && status===0）不放宽，只是不再把失败**原因**丢掉。
      既有全部调用点按新形态收编（listTargets / wake / dumpLayout / tap / reveal 等），
      不留 any 或宽松解构；调用点若只用 ok，保持原语义不动。
      单测对准生产：以可控执行器注入 timedOut 与非零 status 两种失败，断言投影字段
      齐备、且各调用点下游行为与改前一致（本 todo 只加事实、不改判定）。
    status: completed
  - id: t2-reveal-operation-policy
    content: >
      reveal 的 velocity 与 timeout **收编为同一处 reveal 操作策略**，杜绝两个魔法数
      各写各的。采用实测有充分余量的固定组合 velocity=1500 px/s + timeout=10_000ms
      （实测 1500 → 1153ms，余量约 8.7 倍）。
      **明确不做**按理论距离精算超时：真实 hdc 耗时含显著进程启动/通信开销，理论值
      与实测值差距达 1.7 倍（3.07s vs 5.2s）——精算是把偶然耗时当保证（同类错误在
      e5d8a2c4 T3#3「dump 耗时即间隔」上已犯过一次，已作废）。
      单测范围（**刻意不测数值相容性**，那正是会放行旧坏组合的假绿）：
      ① velocity 与 timeout 来自同一策略对象，reveal 实现内不存在独立字面量；
      ② velocity 落在设备端 `uitest uiInput` 合法域（200–40000 px/s）；
      ③ timeout 有明确下限且不低于该下限。
      **不写**「velocity 或 timeout 任一侧被改动测试必红」——不同参数组合可能同样合法，
      测试不锁死具体常量值。真正的参数相容性由 t8 真机验收证明。
    status: completed
  - id: t3-reveal-typed-outcome
    content: >
      UnlockDeps.reveal 由 `void` 改为返回 typed outcome（至少 { ok, timedOut,
      signal?, status? }，脱敏），使执行事实**可用**。
      **不得宣称类型系统能强制调用方消费返回值**——TS 对同步函数返回值无此能力
      （早期稿的「类型层面强制」是错的；e5d8a2c4 T3#3 能强制的是**接口字段必填**，
      与返回值消费不是一回事）。改为**行为契约 + 行为测试**：
      ensureUnlocked 必须检查 reveal outcome，`ok=false` 时立即返回 reveal_failed。
      行为测试须证明该分支之后：snapshot 调用次数不再增加、settle 调用次数为 0、
      provider.claimAndUnlock 调用次数为 0（正证据计数形态，不用排除法）。
      本 todo **只改 reveal 这一条边**：wake/tap/snapshot 签名不在范围内，不得顺手泛化。
    status: completed
  - id: t4-reveal-failed-kind
    content: >
      UnlockFailureKind 新增第四类 `reveal_failed`，判据收窄：仅当 reveal 命令自身
      执行失败/超时才归入。
      新增合理性（对照 e5d8a2c4 T3#2「按处置差异收敛、拒绝兜底类」的既有裁决）：
      其处置与三类均不同 —— 设备命令/超时问题，下一步是排查 hdc/设备连通性，
      既非重新登记凭据、非等 UI settle、更非真机校准。
      **控制流即硬闸**（比参数化分类器更简单、真源唯一）：
        reveal ├─ failed    → 立即零输入返回 reveal_failed（不进重采样循环）
               └─ succeeded → 重采样 → unlockFailureKindOf(snapshot)
      **unlockFailureKindOf 保持原职责不变**，继续只对「reveal 成功后的 UI 快照」
      分类——不得把 reveal 执行事实作为入参塞进去，那会把设备命令状态重新耦合进
      布局分类器。reveal 失败时它根本不会被调用，layout_unsupported 自然产不出来。
      「可重试」语义同步收窄，避免被读成加重试循环：同一 attempt **最多 reveal 一次**，
      不得因 reveal_failed 在同一 attempt 内自动重复 swipe；「可重试」仅指人工排查
      HDC/设备连通性后经新 invocation 或 --resume 再试。
      文案：reveal_failed 的 hint 说「设备命令未完成（超时/被中止）」，绝不出现
      「须真机校准」。
    status: completed
  - id: t5-regression-and-fixture
    content: >
      回归全部对准生产接线（禁纯函数绕过生产路径造假绿）：
      ① ETIMEDOUT → reveal_failed 的全链传播；
      ② reveal 失败后**零 snapshot 增量 / 零 settle / 零 PIN 点击**（见 t3 计数断言）；
      ③ reveal 失败后**绝不产出 layout_unsupported**：即便后续快照恰为时钟页形态，
         结论必须是 reveal_failed；
      ④ reveal **成功**路径上，既有重采样与 layout_unsupported 分类**不回归**。
      每条做变异验证：改坏生产对应判据，用例必须红。
      fixture 处置（**脱敏规则必须复用既有纪律，不得自创**）：
      按 harness/tests/fixtures/device-lockscreen/README.md 的白名单——
      **保留** 树结构 / id / text / originalText / bounds / type / enabled / visible /
      clickable / checkable / checked / selected / key（`originalText`/`text` 是
      collectDigitKeysWithDiag 的数字判据本体，:543-546，**删了 fixture 就废**）；
      **剔除** 运行时 id、应用身份、样式几何冗余、状态栏/通知/灵动岛整棵子树。
      必须执行 README 记载的**判据保真自检**（脱敏前后逐项比对：lockRoot 在场 /
      text 单数字集 / originalText 单数字集 / 人脸提示在场 / numKeyBoard 计数，
      任一不等即 FAIL）——该自检曾实际拦住一次误伤（宽泛 Clock 正则误剪 sl_clock）。
      新 dump 与既有 fixture **无结构/OS 版本差异时不重复入库**，仅在本 plan 记录结论。
    status: completed
  - id: t6-honest-comment
    content: >
      修掉失实注释：device-readiness-deps.ts:498 声称「原始 dump 仅在显式校准旗标下
      另行落盘」——该旗标在代码中**不存在**（全文件零 writeFileSync），锁屏 dump
      用完即弃。改为如实陈述当前行为。
      **明确不做**运行期自动落原始 dump：原始锁屏树含通知/UI 文本（隐私面），
      且根因修复不依赖新增状态；若将来确需采集，另做显式、脱敏、用户触发的校准能力。
    status: completed
  - id: t7-openspec-change
    content: >
      建立 OpenSpec change（当前 `openspec list` 中尚无本条目）：
      openspec/changes/lockscreen-reveal-execution-truth/
        proposal.md / design.md / tasks.md / specs/goal-runner/spec.md
      规格以 **delta** 表达（首句 MUST，措辞按 openspec 校验口径）：
      ① reveal 命令执行结果必须进入解锁事实链；
      ② 只有 reveal 成功后，后续快照才允许产生 layout_unsupported；
      ③ reveal 失败必须零输入并归为 reveal_failed；
      ④ 同一 attempt 最多执行一次 reveal。
      **apply 阶段不得直接修改 canonical openspec/specs/goal-runner/spec.md**，
      canonical 合并留到 archive。本 todo 验收含 `npm run openspec:validate`。
    status: completed
  - id: t8-live-acceptance
    content: >
      真机验收——**由生产 gate 自动完成解锁，不得用人工解锁替代**。
      授权模型澄清（早期稿写「须用户本人执行因涉 PIN 输入」是错的）：用户登记凭据后，
      生产 readiness gate 本就经 Credential Manager 自动使用凭据；agent 只触发生产
      gate，既不读取也不手工输入 PIN。用户只负责物理前置（确认设备可用于测试），
      **不得要求用户把 PIN 提供给 agent**。
      调用面沿用既有验收先例：runDeviceReadinessGate(buildDeviceReadinessInput(hostRoot))。
      起始态必须**证明**而非声明（旧记录 precondition 只写「suspend immediately before」，
      而 2026-08-17 实测 suspend 后 3s 不触发自动锁定、45s 才锁——只做 suspend 不足以
      保证进入锁屏）：记录唤醒后首帧 dump 中 ScreenLockRootComponent 在场**且**
      PIN 容器不在场（即真正的时钟页），并记录实际等待时长。
      全链断言：reveal 成功 → 识别十键 → 输入 → 复验解锁 → device_unlock_attempt
      事件落账（note「已用登记凭据解锁并复验」）→ 凭据状态回到 ready。
      落**新的 acceptance 记录**（不得只在汇报中声称 PASS），绑定本次相关源码 sha256，
      至少含 device-readiness-deps.ts / device-unlock-helper.ts / device-readiness-gate.ts
      / bounded-sync-wait.ts（后者是旧记录 new_dependencies_not_covered 明确列出、
      刻意未纳入的解锁链实际依赖，本次须一并纳入）。
      新记录须明确 supersede 或关闭既有
      acceptance/f4b2c8e6-live-gate-2026-07-30T064556Z/verification.json 的
      `PENDING_REAL_DEVICE_REVERIFICATION`；**旧记录的 source_sha256 不得重写**
      （重写等于伪造真机证据，该纪律由旧记录自身载明）。
      记录不得包含 PIN、通知原文或任何未脱敏 UI 内容。
    status: completed
  - id: t9-final-acceptance
    content: >
      最终验收：
        npm run openspec:validate
        cd harness && npm test
        git diff --check
      并运行直接受影响的目标测试，覆盖：
      ① runHdc 对 timeout / 非零 status / signal / errorCode 的投影；
      ② reveal_failed 全链传播；
      ③ reveal 失败后零 snapshot 增量 / 零 settle / 零 PIN 点击；
      ④ reveal 成功后既有重采样与 layout_unsupported 分类不回归；
      ⑤ readiness gate 的 device_unlock_attempt.failure_kind=reveal_failed 结构化投影；
      ⑥ runtime recovery / device-recovery-bridge 原样透传 reveal_failed。
    status: completed
---
