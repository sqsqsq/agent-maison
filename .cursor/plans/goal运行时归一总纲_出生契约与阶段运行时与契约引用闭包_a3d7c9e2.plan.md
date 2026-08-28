---
name: goal 运行时归一总纲 — run 出生契约 · 阶段运行时统一 · 契约引用闭包（master plan）
version: 3.0.0
overview: >
  总纲目标（v4 定稿、v5 补生命周期边界、v6 封 identity-rebase 洗绿口与 rebaseline 权限
  边界、v7 终审修正实现位）：消除 goal run 创建、phase 派发和 plan 文件授权中的平行
  真源——所有运行模式共用唯一 run 出生入口（createGoalRun，含一次性 run_created 出生
  事件）和唯一 phase runtime（GoalPhaseRuntime + 模式 executor）；所有物化文件由唯一
  contracts.files 授权集合约束。三个 OpenSpec 里程碑（goal-run-birth-contract /
  goal-phase-runtime-unification / plan-contract-reference-closure）全部实施并通过跨层
  整机验收前，本 plan 不得关闭；局部止血不得冒充根治收口。起因：宿主 bc-openCard-1
  run 20260827T075557Z-acafa0 在 attended 路径 coding 阶段被 ui_diff_within_declared_files
  以 ui_scope_base_missing 挡死。根因三条（对应三里程碑）：①基线锚被实现成行为义务
  （"某派发器在首次 coding 派发前"写场外信任文件）——义务随派发器分叉必然漂移，时点绑
  phase 留两个洗绿窗口、ut-start run 无锚、场外存储违反框架红线；②框架允许执行路径与
  安全语义分叉——phase 生命周期两套，runner-owned 前置事实散落其一（出生身份事件
  run_start 同样只有 detached 有），新增模式=漏一部分安全前置条件的总类问题；③plan
  契约引用无闭包校验——resource_keys.media 引用 20 枚 logo path 不在顶层 files，缺锚
  修复后必然二次停摆。v6 修正（codex 2×P0+3×P1）：run_base_sha 为特殊 write-once 身份
  字段、排除于 manifest_identity_rebase 与 --override-manifest 的 authAll；rebaseline
  出口重定义为运行时之外的人工管理命令 --supersede <run> --rebaseline-to <40hex>（HEAD
  必须等于该 SHA；goal agent 环境按提取的 hasGoalExecutionSignal 谓词拒绝；executor/
  supervisor 永不构造；审计事件；诚实定位=CLI 管理边界而非密码学人类证明——按
  adjudication.ts:20 红线，CLI 旗标不构成 grant，不接入 AuthorityFacts）；legacy 时代
  判据机器化（run_created 在场→永不入 legacy）；创建中断残留=CREATION_INCOMPLETE 不
  参与 occupancy；owner_handoff 规范化语义正式入 canonical projection；3.1.0 legacy
  物理删除以真实 deferred plan 落账。v7 终审修正（2×P0 实现位 + 审计简化 + 契约字段）：
  run_base_sha 防线三层化——diff 必须照常报告漂移（**禁止** diff 过滤式"排除"，那是
  排除于检测）、授权评估前无条件 fail-closed、回放 rebase 事件验证出生摘要；rebaseline
  拒绝谓词不得直接复用 isAgentSideGoalHarness（gate 标记 env 即可翻转它），改为从其
  内部提取共享的 hasGoalExecutionSignal（goal 信号集合仍单一 SSOT）；rebaseline 审计
  单写者——只写新 run events，不回写旧 run（避免跨 run 写入/锁/崩溃序）；3.1.0 plan
  按 AGENTS.md 机器契约带 deferred_to。净减法裁决不变：新增抽象仅 createGoalRun 与
  GoalPhaseExecutor；真源仅 manifest.json / events.jsonl / contracts.yaml；不建任何
  测试专用 facts/豁免注册表、新 ledger、事务状态机。
todos:
  - id: m0-invariants-topology-adjudication
    content: >
      P0 · 总纲不变量冻结、OpenSpec 拓扑与重叠裁决。冻结六条总纲不变量（正文 §4）；
      `npm run openspec -- list --json` + 全文语义扫描生成重叠清单。归档拓扑定死：
      ①ut-legacy-coexistence 完成剩余收尾**先归档**，随后 goal-run-birth-contract 以
      MODIFIED requirement 修改 canonical spec（含反转「HARNESS_DIFF_BASE_REF → goal
      coding_base_sha」优先级链为「goal run → manifest.run_base_sha；非 goal → env」），
      M1 落地后重跑相关 UT baseline 回归；若真机条件暂缓其归档：M1 可开发、不得先于它
      归档，两 delta 最终合并顺序固定为旧 change → M1。②goal-runner spec:1250
      （coding-base.json 列为 trust-state 留存住户）——M1 delta 修订。③spec:642
      （HALTED/PARTIAL 占位与 --supersede 审计）——M1 rebaseline 授权延伸此 Requirement，
      不另立平行机制；同步 delta 界定 CREATION_INCOMPLETE 残留不属于占位者。④manifest
      身份机制相关 requirement（identity fields/rebase/override）——M1 delta 加入
      run_base_sha 的三层防线条款。⑤goal-mode-skill / goal-driver-handoff /
      harness-gates 等与 M2 收编相关 canonical specs 逐条记 compatible/dependency/
      conflict；host-runtime-truth、goal-host-replay-fixes 等在途 change 与 M2 时序清点。
      三 change 骨架命名冻结，各自 propose 时 strict validate。执行顺序：m0 → M1 →
      M2 与 M3 并行 → m4 → m5。
    status: in_progress
  - id: m1-goal-run-birth-contract
    content: >
      P0 · OpenSpec change `goal-run-birth-contract` 完整实施与验收。①fresh-only
      `createGoalRun`：input 解析与 run 创建分离；先解析 workflow/track/实际 chain，再
      判定是否需要 git 基线（含 coding/ut → 必需；纯 spec/plan 链可缺省）；必需而 HEAD
      不可得 → 创建 fail-closed，零 agent 派发。收编两入口现有创建面（goal-runner.ts:4139
      起；goal-mode-entry.ts:237 prepareGoalModeRun），attended/detached 一律经
      createGoalRun。②createGoalRun 事务尾写一次性 `run_created` 事件入 events.jsonl
      （manifest_identity_fields、manifest_identity_hash、run_base_sha digest）；每 run
      仅一条；顺序=先 manifest 后 run_created；新 schema run 缺该事件=创建不完整 → 不可
      attach（attended bridge 与 detached preflight 同判）；resume 不得补造。创建中断
      残留定义为 `CREATION_INCOMPLETE`：不被 supervisor 接管、不可 resume、**不构成
      spec:642 意义上的 HALTED/PARTIAL 占位者**、不阻止重新创建 run；呈现走 attach/
      resume 拒绝信息与既有 GC 报告，由既有 per-run trust GC/人工清理，零新增事务
      状态机。身份漂移消费端（goal-runner.ts:2944-2958）改为优先 run_created、legacy
      run 回退首个 run_start；run_start 保留"执行开始"语义及既有消费者。③manifest 新增
      `run_base_sha`（40-hex，消费面一次性迁移），条件入 computeManifestIdentityFields
      （键在场即入）；writeGoalManifest round-trip 保字段+重写不变量。（v7 P0-A 定形）
      **run_base_sha 是身份字段中的特殊 write-once 字段，实现为三层防线**——禁止用
      diff 过滤实现"排除"（那是排除于检测而非排除于授权）：第一层，
      diffManifestIdentityFields **必须照常报告**该字段的增/删/改；第二层，
      resolveManifestDriftDecision 在 authAll 与普通 override 授权评估**之前**对
      changedFields 含 run_base_sha 无条件 fail-closed（run_base_sha_write_once_
      violation）——--override-manifest 的 authAll（goal-runner.ts:3005-3036）对它
      无效；第三层，resolveManifestIdentityBaseline 回放历史 manifest_identity_rebase
      时防御性验证 to_fields 的 run_base_sha 摘要仍等于 run_created 出生摘要——不等或
      字段消失=事件流/运行状态损坏 fail-closed，不得静默跳过。同 run 获得不同
      run_base_sha 的唯一途径=创建显式 rebaseline 的新 run。四负例必测：base A→B +
      --override-manifest=FAIL；删除字段 + --override-manifest=FAIL；历史 rebase 事件
      含 base 变化 → 判事件流损坏；其他合法字段变更 + 对应 override=原语义不变。
      ④resume 只 load 不重解析 HEAD；停机篡改由 run_created 冻结基线比对拒绝。⑤goal
      run 只认 manifest 基线：ui-scope-gate.ts:131-146 与 ut-target-resolver.ts:109-134
      迁移到单一 resolveGoalRunBaseline；goal run 内不读 HARNESS_DIFF_BASE_REF——env
      构造点显式 scrub（既有 scrub 列表追加；父环境在场时启动告警一次；不 FAIL），env
      仅保留给非 goal 手动 harness；门禁判定语义一字不动。⑥自动 successor（successor_of
      在场）继承 lineage baseline（回溯至最早可信冻结值，含 legacy 读取，不重取 HEAD）；
      非 successor fresh run 出生重取。祖先无可信 baseline：自动 successor fail-closed；
      人工出口=**运行时之外的人工管理命令**，延伸 spec:642 既有 `--supersede
      <old-run-id>`，追加 `--rebaseline-to <exact-40hex-sha>`（不用布尔 flag——语义
      "切断旧 lineage、以此 SHA 建新基线"）。执行约束：两参数必须同时提供；当前 git
      HEAD 必须等于该 SHA（关闭决定→执行竞态）；goal agent 环境一律拒绝——（v7 P0-B
      勘误）判据**不得**直接复用 isAgentSideGoalHarness()：其语义=anyGoalSignal &&
      MAISON_GOAL_GATE_HARNESS!=='1'（phase-state.ts:166-174），agent 设 gate 标记 env
      即可翻转；改为把其内部 anyGoalSignal 并集（RUN_ID/ATTEMPT/ATTEMPT_PHASE/
      isGoalOrchestrationEnv）提取为共享谓词 `hasGoalExecutionSignal()`，rebaseline
      拒绝=hasGoalExecutionSignal()，isAgentSideGoalHarness 改写为
      hasGoalExecutionSignal() && 非正式 gate——goal 信号集合仍单一 SSOT，不新建第二张
      env 清单。负例必测：goal 信号在场 + MAISON_GOAL_GATE_HARNESS=1 + --rebaseline-to
      → 仍拒绝。attended/detached executor 与 supervisor 的参数构造路径永不产生
      --rebaseline-to。（v7 审计单写者）审计只写**新 run** 的 events.jsonl：run_created
      带 rebaseline_from_run_id；supersede 事件带 target_run_id/superseding_run_id/
      rebaseline_to 与 run_created 引用（index/hash）——**不向旧 run 的 events.jsonl
      追加任何反向事件**（旧 run 可能 HALTED/released/只读，跨 run 写入重引入锁与崩溃
      序问题）；"旧 run 被谁取代"沿既有 feature 内 run 扫描逻辑可追（双向可追=逻辑
      可追，非双文件互写）。runbook 明确要求用户在 goal runtime 外执行。诚实边界（写进
      change 与 runbook）：按 adjudication.ts:20 红线，CLI 旗标可被模型拼出、不构成
      grant——本命令定位为"运行时之外建立新问责边界的 CLI 管理命令"，环境检测只是纵深
      防护，根本边界=executor/supervisor 永不构造+准确 SHA+审计+人工管理入口；不是质量
      豁免、不接入 AuthorityFacts、不是密码学人类身份证明（要更强须可信 UI/外部秘密，
      显式超出本轮范围）；对应 adjudication.ts:16-18 既有哲学「用户可授权放弃旧
      lineage，但不能把失配事实改成不存在」。两条必测：supervisor 永不自动触发
      rebaseline；人工授权后的 superseding fresh run 真实通过占位检查并启动。⑦退役
      场外生产面：删 goal-runner.ts:6592-6621 锚定块与 coding_base_* 事件生产（历史
      events 读侧映射保留）。legacy reader 时代判据机器化——以 run_created 为时代边界：
      run_created 在场 → 永不进入 legacy reader（chain 需基线而字段缺失/非法 → FAIL）；
      run_created 不在场 → 有合法旧 run_start + 合法 legacy anchor → legacy 只读，否则
      无可信基线 FAIL；manifest 字段在场但非法 → 绝不 fallback。负例必测：新 run 有
      run_created、删除 manifest.run_base_sha、coding-base.json 在场 → 不得 fallback、
      FAIL。物理删除 reader 不在本总纲（m4 建 3.1.0 deferred plan 承接），本总纲不等
      窗口到期。⑧actionability 修正：goal-failure-classifier.ts:281-308 为
      「runtime-owned 前置事实缺失/破损」类（ui_scope_base_missing /
      ui_scope_diff_unavailable / 基线字段破损 / run_created 缺失）登记非 agent_fixable
      （复用 P0-4 注册表，禁第三套 taxonomy），核对 no-progress 签名与重试回喂。
      验收（真实 API/E2E）：两入口建 run → 同一 createGoalRun、manifest+run_created 双落
      且基线=建 run 时 HEAD；attended coding 门禁不再 ui_scope_base_missing；窗口 B 关闭
      回归；ut-start run 基线可用；非 git×消费链建 run 即拒；resume/重写字段不变；
      identity-rebase 四负例（含回放损坏）；rebaseline 双必测+HEAD 失配拒绝+goal 环境
      拒绝（含 gate 标记在场仍拒）；successor 继承断言；legacy 时代判据正反例；
      CREATION_INCOMPLETE 不占位（重建不被挡）断言；goal run 设 env 无效且被 scrub+
      告警；actionability 断言。
    status: completed
  - id: m2-goal-phase-runtime-unification
    content: >
      P0 · OpenSpec change `goal-phase-runtime-unification` 完整实施与验收（总类根治
      核心，不允许降格立项）。①薄 `GoalPhaseExecutor` 接口（输入=不可变
      PhaseExecutionContext；输出=agent 执行结果）：attended executor=宿主 stdio 回调
      （现 phase_execute_request 协议原样）、detached executor=封装现有 adapter spawn。
      ②owner/epoch CAS、assess、phase_start、receipt scaffold、前置事实准备（M1 后基线
      为出生事实；仍属 phase 级的：fidelity SSOT、visual pin、goal/gate env 注入与
      scrub、testing 期 device session/冻结配置、写边界快照归因）、gate harness、
      verdict/backtrack、resume 回放、close/closure 全入共同 runtime——模式只决定
      「如何执行 agent」。③迁移梯分任务：提取 detached executor → 接入共同 phase
      boundary → 单 phase（coding）对照 → 全 phase 迁移 → resume/handoff 对照 →
      parity 全绿后物理删除 goal-runner.ts 旧 phase loop（完成判据）。M2 单 change 多轮
      apply；双 loop 仅工作区迁移期共存——不跨 M2 archive 边界、不在双 loop 状态发版。
      ④handoff=runtime 状态迁移（detach A → fenced owner/epoch transition → attach B →
      同一 runtime 续跑），released/mailbox/takeover 统一到既有 goal-run-control/
      goal-driver-handoff 语义；supervisor 参数构造不产生 --rebaseline-to（M1⑥约束在
      runtime 侧复验）。⑤红线：不新增 run 状态文件、第二套 owner、第二套事件账本、
      第二个 adjudication；supervision 维持 process-owner-only。⑥生产纯投影
      projectCanonicalLifecycle(events)：run_created → phase_start → phase_verdict/
      phase_halt → phase_backtrack_requested → **owner_handoff{from: session|process,
      to: process|session, outcome}** → run_end（handoff 是同 run 的 owner 生命周期
      变化、非 executor 遥测，规范化语义入投影而不绑原始事件名；发生与否/方向/结果
      不得丢失）；ts/PID/owner id/invoke id/epoch 数值规范化；agent_invoke_*、stdio
      request、adapter 输出、lease telemetry 等 executor 私有事件不入投影；canonical
      事件一个不能漏。验收：attended/detached 完整 canonical projection 逐项相等（含
      双向 handoff 格）；agent 执行前 runtime-owned 前置事实全就位；缺失 runtime-owned
      evidence 归 framework corruption 不回喂 agent；旧 loop 删除+结构零项过（§6）。
    status: completed
  - id: m3-plan-contract-reference-closure
    content: >
      P0 · OpenSpec change `plan-contract-reference-closure` 完整实施与验收。
      ①contracts.yaml 唯一输入、contracts.files 文件授权 SSOT；②plan closure 时解析为
      **内存**规范化视图（零持久化 graph/第二真源文件），跨字段引用闭包校验：
      resource_keys[*].path、页面/路由注册点、导出（har_index/builder）、物化资产
      （media）等一切文件路径引用 ⊆ contracts.files；违反 → plan closure FAIL；③不提供
      「与 spec/assets 字节一致即自动豁免」第二授权通道；④expansion 唯一路径不变：回
      plan 修 contracts.files 重闭环。回归夹具：宿主实况建模（resource_keys.media 20
      logo path 不在 files → plan closure FAIL、补 files 后 PASS）。同步 plan skill/
      模板指引与 contracts schema 文档。验收：夹具红绿对；既有合法 feature 夹具不误伤。
    status: completed
  - id: m4-legacy-surface-removal
    content: >
      P1 · 旧路径删除与 legacy 隔离核销（本总纲交付「隔离+结构断言」，不含物理删除
      legacy reader）。核销清单（每项以结构断言测试固化防回潮）：场外 coding-base
      producer=0；legacy reader 仅可由「run_created 不在场」的时代判据路径到达（新 run
      结构上不可达）；goal-runner 私有 phase loop=0（M2 后）；attended driver 独立推进
      逻辑=0；executor 直调 phase gate=0；goal run 内活读 HARNESS_DIFF_BASE_REF=0；
      trace.start_commit/裸 HEAD 补锚路径=0（核销防复发）；pass-snapshot.ts 头注更新
      （trust 命名空间留存住户=per-run GC + vision 入口）。m4 完成时创建**真实 deferred
      plan 文件**（.cursor/plans/；frontmatter 按 AGENTS.md:111 机器契约：version:
      3.1.0 **且** deferred_to: 3.1.0 二者相等；待办全部放 frontmatter todos——
      check-plan-version 对 deferred plan 的正文未勾项不豁免；最小清理里程碑，不含新
      机制）：删除 legacy coding-base reader、删除 run_start 出生基线回退分支、删除
      对应兼容测试并保留迁移负面测试——待办唯一真源是 plan frontmatter，不以 runbook
      句子承载。
    status: completed
  - id: m5-matrix-incident-closure
    content: >
      P0 · 跨层整机矩阵、宿主事故复现与总纲收口。①结构验收清单逐项过（§6 十三项零/
      唯一性断言）；②模式×生命周期矩阵：attended/detached × fresh/retry/resume/handoff
      （双向）/successor 全格必测，每格断言：相同 run 出生事实（run_created 同源）、
      projectCanonicalLifecycle 投影逐项相等（含 owner_handoff 在场/方向/结果）、相同
      gate 前置事实、相同 backtrack/close 语义、resume 不换基线、自动 successor 不洗掉
      祖先提交、rebaseline 仅经运行时外人工命令（supervisor/executor 永不构造；goal
      环境拒绝含 gate 标记在场）、identity-rebase 不可触碰 run_base_sha（含回放损坏
      判定）、CREATION_INCOMPLETE 残留不占位、未声明 media 在 plan closure 被拒；
      ③宿主事故 fixture 级闭环（不动宿主工程）：attended 不再缺基线；detached 与
      attended 行为一致；20 logo 在 plan closure 被拦；runtime-owned 事实缺失不回喂
      agent；停摆 run 处置指导与实际可执行路径一致（宿主当前 run=无 legacy 锚的 HALTED
      占位者 → `--supersede acafa0 --rebaseline-to <当前 HEAD>` 人工出口真实可启动；
      M3 后该 feature 需先回 plan 补 files 重闭环——门禁正确工作，非新事故）；
      ④docs/operations/goal-mode-runbook.md 重写基线机制与停摆处置口径（含 rebaseline
      命令须在 goal runtime 外执行的要求与诚实边界）；⑤三 change 全部 validate+
      archive、全量单测+harness 自检；不 commit（review-before-commit），交付=分支
      工作区+总纲状态回填后按分支集成策略统一 cp 主干。
    status: in_progress
isProject: false
---

# goal 运行时归一总纲（a3d7c9e2）

状态：v7 · 待终审 · 未开工 · **本 plan 为总纲**——三个 OpenSpec 里程碑全部实施完成
并通过 §6 跨层整机验收前不得关闭；单里程碑完成只可将对应 todo 置 completed。

## 1. 背景与根因链

```text
07-27 ed1da476  c4e8b1d3：UI scope 门 + "首次 coding 派发前锚定"（当时仅 headless 一条路径，
                锚定内联在 goal-runner 派发循环）
08-01 753b2365  attended in-session driver 新建（executePhase 回调，绕开 runner 循环）
                ——锚定义务未被移植；phase 生命周期自此两套；run_start 出生身份事件
                同样只有 detached 发（attended 全程零 run_start）
08-24 attended-runtime-truth：宿主事故（spec 期丢 goal 身份）→ 补 attended-goal-context
                + 门禁 env 注入 ⇒ attended 门禁被激活；锚定生产仍缺 ⇒ 结构性 fail-closed
08-27 run acafa0  attended 跑到 coding：代码完成、编译过、35/44 PASS，
                ui_diff_within_declared_files=FAIL(ui_scope_base_missing) 停摆
潜伏雷        contracts.yaml resource_keys.media 引用 20 枚 logo path 不在顶层 files
                ⇒ 缺锚修复后必然 ui_scope_violation 二次停摆（plan closure 无引用闭包校验）
```

三条根因（对应三里程碑）：**结构事实被实现成行为义务**（M1）；**执行路径与安全语义
分叉**（M2）；**契约引用无闭包**（M3）。

## 2. 事实核实表

| # | 事实 | 证据 | 备注 |
|---|---|---|---|
| 1 | recordCodingBase 全库唯一生产调用点在 headless 循环 | goal-runner.ts:6596（块 6592-6621） | |
| 2 | attended 链路对锚定零命中，executePhase 直接派发 | goal-in-session-driver.ts:317 | |
| 3 | 缺锚 FAIL 先于 UI 适用面判定；goal run 内永不合法 SKIP | ui-scope-gate.ts:135-146；check-coding.ts:447-470,566 | attended 一切 coding run 均挡死 |
| 4 | 洗绿窗口 A：锚定失败不阻断派发，次轮补锚可含 agent commit | goal-runner.ts:6590-6591 | |
| 5 | 洗绿窗口 B：早阶段 commit 的 UI 文件被"首次 coding 时点 HEAD"洗出基线 | 时点语义推演 | 出生冻结关闭 |
| 6 | ut-start run 无锚 → UT 基线 available=false 全量问责 | ut-target-resolver.ts:109-134 | |
| 7 | 场外状态违反框架红线且在写边界快照面外 | pass-snapshot.ts:13-23 | |
| 8 | 两派发器共享 manifest 构建函数；冻结事实+字段级身份哈希+S4 先例齐备 | goal-manifest.ts:75-199、127-131；goal-runner.ts:4139；goal-mode-entry.ts:237 | M1 地基 |
| 9 | 「启动解析一次、unresolved 即停」先例 | goal-runner spec:1264（product selection） | |
| 10 | owner/epoch/CAS/mailbox 两路径已共用；真正分叉仅 phase loop | goal-run-control、goal-driver-handoff | M2 可行性 |
| 11 | actionability 注册表缺省「未登记→agent_fixable」，ui_scope_base_missing 未登记 | goal-failure-classifier.ts:281-308 | 红线禁修却回喂 agent |
| 12 | 宿主 contracts.yaml `resource_keys.*.media` 含 20 个 logo path（:503-543），顶层 files=27 零 media | 宿主 contracts.yaml 实测（v4 子串复核；v3 曾以缺陷正则误判） | 与 #13 合成第二颗雷 |
| 13 | resources/*/media/** 按路径判 UI 敏感（优先于 .ets 判据） | ui-scope-gate.ts:69-76 | |
| 14 | trace.start_commit/裸 HEAD 补锚今日已显式禁止 | ui-scope-gate.ts:14-15；ut-target-resolver.ts:104-106 | m4 仅核销防复发 |
| 15 | 现场：run 无锚、HEAD=1f71f38c、46 项变更全未提交 | 宿主 summary.json、git status | |
| 16 | detached 出生身份基线=首个 run_start.manifest_identity_fields；attended 全文零 run_start | goal-runner.ts:2944-2958,5202；goal-mode-entry.ts grep=0 | v5 P0-1 前提 |
| 17 | HALTED/PARTIAL 占位规则——resume 或 `--supersede <run_id>`（审计事件），不得静默顶替 | goal-runner spec:642 | v5 P0-3 前提 |
| 18 | `--override-manifest` → authAll → 任意漂移身份字段获 rebase 授权 → 出生基线被合法前移 | goal-runner.ts:3005-3036 + :2944-2958 | v6 P0-A 前提 |
| 19 | 「CLI 旗标可被模型拼出…不构成 grant」；框架已预设「用户可授权放弃旧 lineage，但不能把失配事实改成不存在」 | adjudication.ts:20-22、:16-18 | rebaseline=运行时外 CLI 管理边界 |
| 20 | **v7**：isAgentSideGoalHarness()=anyGoalSignal && MAISON_GOAL_GATE_HARNESS!=='1'——设 gate 标记 env 即返回 false | phase-state.ts:166-174 | 不可作管理命令拒绝谓词；内部 anyGoalSignal 并集是正确的提取对象 |
| 21 | **v7**：deferred plan 机器契约——`deferred_to` 必须等于 `version`；deferred plan 的正文未勾项不豁免 | AGENTS.md:111,124；scripts/tests/check-plan-version.unit.mjs ⑤ | m4 建 3.1.0 plan 时遵守（待办放 frontmatter todos） |

## 3. 裁决变化史

### v3→v4（codex review 一轮）

| 项 | v3 | v4 | 理由 |
|---|---|---|---|
| plan 定位 | Layer 1 主体，2/3 立项 | 总纲，三层必交付 | 用户明确全做；止血不冒充根治 |
| 出生入口 | buildGoalManifestFromInput | fresh-only createGoalRun | build 是共享函数不是创建事务 |
| 字段命名 | coding_base_sha | run_base_sha 一次性迁移 | 语义准确优先 |
| HARNESS_DIFF_BASE_REF | 用户显式最高优先 | goal run 只认 manifest；env 仅非 goal | goal run 内 env=agent 可控基线旁路 |
| 自动 successor | 出生重取 HEAD | 继承 lineage baseline | feature 级问责；重取洗出前代提交 |
| 闭包检验 | 测试内事实表+豁免清单 | 删除——零测试专用注册表 | 手抄事实表=平行真源同病 |
| M3 豁免通道 | 字节一致机器豁免选项 | 否决 | 字节校验是内容门禁不是授权来源 |
| M3 命名 | plan-contract-graph | plan-contract-reference-closure | 防误建持久化 graph |
| 事实 #12 | "全文零 media 引用"（错） | 修正并复核 | v3 正则漏 path: 键值行 |

### v4→v5（codex review 二轮）

| 项 | v4 | v5 | 理由 |
|---|---|---|---|
| 出生身份基线 | 只建入口+字段入哈希 | 一次性 run_created 事件；缺失=不可 attach；resume 不补造 | attended 今日零 run_start，漂移检测需独立出生摘要 |
| legacy 窗口 | 3.0.x 到期删除 | 删 producer+隔离 reader；物理删除登记 3.1.0 | v4 语义构成 3.0.0 发布死锁 |
| 无锚祖先 | "要求显式 fresh"（死路） | 既有 --supersede 通道+显式 rebaseline 授权+审计 | spec:642 占位规则拒绝普通 fresh |
| 归档拓扑 | "协调状态" | 定死：旧 change 先归档 → M1 | 说明不能代替拓扑 |
| 事件 golden | 测试选关键子集 | 生产纯投影 projectCanonicalLifecycle | 手选清单会漂移 |
| goal env 检测 | 待定 | scrub+告警一次，不 FAIL | FAIL 可被 agent 制造拒绝服务 |
| M2 分段 | 待定 | 单 change 多轮；双 loop 不跨 archive、不发版 | |

### v5→v6（codex review 三轮）

| 项 | v5 | v6 | 理由 |
|---|---|---|---|
| identity rebase | 字段入身份哈希即防篡改 | run_base_sha=write-once 身份字段：rebase 与 override authAll 双排除 | 事实 #18：authAll 是同 run 合法前移基线的现成通道 |
| rebaseline 权限 | 布尔 flag | 运行时外人工命令：--rebaseline-to <exact-40hex>+HEAD 等值+环境拒绝+永不构造+审计 | 事实 #19：CLI 旗标不构成 grant；布尔 flag 可被 agent 拼出自洗 |
| legacy 时代判据 | "缺字段的旧 manifest" | run_created 在场→永不入 legacy | "缺字段"不能证明"旧" |
| 创建中断残留 | 未定占位身份 | CREATION_INCOMPLETE 不占位不挡重建 | 防磁盘错误重演占位死锁 |
| handoff 投影 | §10 默认收入 | 正式定案 owner_handoff{from,to,outcome} | owner 生命周期变化非 executor 遥测 |
| 3.1.0 登记 | runbook 条目 | 真实 deferred plan | 待办唯一真源是 plan frontmatter |

### v6→v7（codex 终审；两处 P0 均为 v6 自身实现默认值错误）

| 项 | v6 | v7 | 理由 |
|---|---|---|---|
| write-once 实现位（P0-A） | §10 默认"diff 过滤或 replay 跳过，两处都设" | 三层防线：diff 必须照常报告漂移；授权评估前无条件 halt（resolveManifestDriftDecision）；回放 rebase 验证出生摘要（resolveManifestIdentityBaseline），失配=事件流损坏 | diff 过滤=排除于**检测**而非排除于授权——changedFields 看不见变化，系统误判"无漂移"，洗绿口反而打开 |
| 拒绝谓词（P0-B） | 复用 isAgentSideGoalHarness() | 提取其内部 anyGoalSignal 并集为 hasGoalExecutionSignal()；rebaseline 拒绝用后者；负例：gate 标记在场仍拒 | 事实 #20：原函数被 MAISON_GOAL_GATE_HARNESS=1 翻转——它区分"agent 自跑 vs 正式 gate"，不回答"是否处于 goal 执行环境"；提取后 goal 信号集合仍单一 SSOT |
| 审计双向可追 | "双向可追——默认要求"（实现位未定） | 单写者：只写新 run events（run_created.rebaseline_from_run_id + supersede{target,superseding,rebaseline_to,run_created 引用}）；不回写旧 run；双向=逻辑可追（feature 内扫描） | 旧 run 可能 HALTED/released/只读；跨 run 写入重引入锁与崩溃序问题 |
| 3.1.0 plan 字段 | version: 3.1.0 | version: 3.1.0 + deferred_to: 3.1.0（相等）；待办放 frontmatter todos | 事实 #21：AGENTS.md 机器契约；正文未勾项不豁免 |

## 4. 目标架构与总纲不变量

```text
                     createGoalRun（fresh-only，唯一出生入口）
                            │  解析 workflow/track/chain → 冻结 manifest 出生事实
                            │  （run_base_sha 条件必需；条件入身份哈希且三层防线保护）
                            │  → 一次性 run_created 事件（identity fields/hash + base digest）
                            ▼
                    Goal Phase Runtime（唯一 phase 生命周期）
                    owner/epoch · assess · prepare facts · invoke
                    executor · gates · verdict · backtrack · close
                     │                                    │
            attended executor（宿主 stdio 回调）   detached executor（adapter spawn）
                            ▼
                          gates（消费不可变 PhaseExecutionContext）
                            ▼
                contracts.files 授权闭包（plan closure 校验一切引用⊆files）
```

六条总纲不变量（m0 冻结，验收即 §6 结构清单）：
1. fresh run 创建入口唯一（createGoalRun，含一次性 run_created）；resume 只 load；
   创建中断残留=CREATION_INCOMPLETE，不参与 occupancy。
2. phase loop 唯一；attended/detached 只剩 executor 差异。
3. goal 基线权威唯一=manifest.run_base_sha：出生冻结、同 run 永不可 rebase/override
   （三层防线：漂移必被发现、发现即 halt、回放必验证）；变更基线的唯一途径=运行时外
   人工 rebaseline supersede 创建新 run；goal run 零 env 旁路。
4. 运行状态转换来源唯一=events.jsonl；不新增状态文件/owner/账本/adjudication；审计
   单写者（新 run 不回写旧 run）。
5. 文件授权来源唯一=contracts.files；零自动豁免旁路。
6. 测试只消费生产定义（createGoalRun / GoalPhaseRuntime / projectCanonicalLifecycle /
   hasGoalExecutionSignal）；零测试专用事实表/豁免注册表。

## 5. 里程碑要点与顺序

**顺序**：m0 → M1 → M2 与 M3 并行（M3 独立且小，尽早堵第二颗雷）→ m4 → m5。M2 迁移梯
每级独立对照测试；双 loop 仅工作区迁移期共存，不跨 M2 archive 边界、不在双 loop 状态
发版；旧 loop 物理删除是 M2 完成判据。

**M1 关键语义**：出生冻结四态覆盖不变；非 git×含 coding/ut 链建 run 即拒（纯文档链
允许缺省）；run_created 与 manifest 定序落盘（先 manifest 后 run_created，缺事件=不可
attach 兜底）；run_base_sha 同 run 不可变（三层防线）；legacy 以 run_created 为时代
边界隔离；rebaseline 是运行时外人工管理命令（hasGoalExecutionSignal 拒绝+HEAD 等值+
单写者审计）。

**M2 关键边界**：runtime 收编生命周期与 runtime-owned 事实准备；executor 只封装"如何
执行 agent"；supervision 维持 process-owner-only；handoff=同一 runtime 内 owner/epoch
迁移并以 owner_handoff 语义入投影。

**M3 关键边界**：校验在 plan closure 时对内存规范化视图执行；contracts.yaml 是唯一
输入也是唯一持久物；宿主 20-logo 实况进回归夹具。

## 6. 跨层整机验收（m5 执行）

**结构验收（零/唯一性断言，以测试固化）**：fresh 创建入口=1；run_created 每 run=1；
phase loop=1；goal 基线权威=manifest 唯一且同 run 不可变；状态转换来源=events 唯一；
文件授权=contracts.files 唯一；场外 coding-base producer=0；旧 detached phase loop=0；
goal run 活读 HARNESS_DIFF_BASE_REF=0；测试专用 facts/豁免注册表=0；asset 自动授权
旁路=0；executor 直调 phase gate=0；executor/supervisor 构造 --rebaseline-to=0。

**模式×生命周期矩阵**：

| 模式 | fresh | retry | resume | handoff | successor |
|---|---:|---:|---:|---:|---:|
| attended | 必测 | 必测 | 必测 | → detached | 必测 |
| detached | 必测 | 必测 | 必测 | → attended | 必测 |

每格断言：相同 run 出生事实（run_created 同源）；projectCanonicalLifecycle 投影逐项
相等（含 owner_handoff 在场/方向/结果；executor 私有事件不入投影；canonical 一个不
漏）；相同 gate 前置事实；相同 backtrack/close 语义；resume 不换基线；identity-rebase
不可触碰 run_base_sha（含回放损坏判定）；自动 successor 不洗掉祖先提交；rebaseline
仅经运行时外人工命令（含 gate 标记在场仍拒）；CREATION_INCOMPLETE 残留不占位；未声明
media 在 plan closure 被拒。

**现场事故闭环（fixture 级，不动宿主工程）**：①attended 不再缺基线；②detached 与
attended 行为一致；③20 logo 在 plan closure 被拦而非 coding 后暴露；④runtime-owned
事实缺失归 framework corruption、不回喂 agent；⑤停摆 run 处置指导与实际可执行路径
一致：宿主当前 run（无 legacy 锚的 HALTED 占位者）走 `--supersede acafa0
--rebaseline-to <当前 HEAD>` 人工出口真实可启动；M3 后该 feature 需先回 plan 把 media
补进 files 重闭环——门禁正确工作，非新事故。

## 7. 交叠与依赖

| 对象 | 关系 | 处置（m0 落账） |
|---|---|---|
| ut-legacy-coexistence（活跃） | **冲突**（env 优先级链+coding_base_sha 措辞） | 定死拓扑：它先归档 → M1 以 MODIFIED requirement 改 canonical → 重跑 UT 回归；缓归时 M1 可开发不可先归 |
| goal-runner spec:1250 | 修订（trust-state 留存住户变更） | M1 delta |
| goal-runner spec:642 | 延伸（supersede+rebaseline-to；CREATION_INCOMPLETE 非占位者） | M1 delta，不立平行机制 |
| manifest 身份 requirement | 延伸（run_base_sha 三层防线条款） | M1 delta |
| phase-state 谓词 | 提取 hasGoalExecutionSignal（isAgentSideGoalHarness 消费者语义不变） | M1 实施，b7e4d2a9 单写者谓词消费面回归 |
| goal-mode-skill / goal-driver-handoff | M2 收编相关 canonical specs | m0 逐条裁决，M2 delta 修订 |
| host-runtime-truth、goal-host-replay-fixes 等在途 | 时序依赖待清点 | m0 拓扑清单 |
| 08-24 attended-runtime-truth（已归档） | 前作：attended 身份/env 注入 | M2 收编其机制入 runtime，语义不回退 |
| 未来 3.1.0 deferred plan（m4 创建） | 承接 legacy 物理删除 | version=deferred_to=3.1.0；删 legacy reader、run_start 回退分支、兼容测试（留迁移负例） |

## 8. 非目标

- 不上密码学签名/可信 UI/外部秘密（rebaseline 诚实定位为 CLI 管理边界；"模型绝对无法
  伪造人类授权"超出本轮"简单优先"，若未来需要须另立授权机制 change）。
- 不做既有 run 的追溯补锚（出路=rebaseline supersede 或 fresh run 出生即锚）。
- 不动宿主工程、不替宿主补 contracts.files、不替宿主执行任何 run（宿主侧仅 fixture 建模）。
- 不改 UI scope / UT 基线门禁的判定语义（改的只是前置事实的生产与获取）。
- 不新增 run 状态文件、第二套 owner/事件账本/adjudication、持久化契约 graph、事务
  状态机、新 env 标记清单（goal 信号集合复用提取的 hasGoalExecutionSignal 单一 SSOT）。
- 不向旧 run 的 events.jsonl 写入任何事件（审计单写者）。
- 本总纲不物理删除 legacy reader（3.1.0 deferred plan 承接）。

## 9. 已定裁决（除非 review 反对，按此执行）

1. 字段名 `run_base_sha`；消费面一次性迁移，不留双名。
2. goal run 内 HARNESS_DIFF_BASE_REF 一律不读：env 构造点显式 scrub+启动告警一次，
   不 FAIL；非 goal 手动 harness 保留。
3. 自动 successor 继承 lineage baseline（回溯 successor_of 链至最早可信冻结值，含
   legacy 读取）；祖先不可解析 → 自动 fail-closed，人工走 rebaseline supersede。
4. legacy 只读分支以 run_created 为时代边界隔离（新 run 结构上不可达；字段在场但非法
   绝不 fallback）；物理删除由 m4 创建的 3.1.0 deferred plan 承接（version=deferred_to
   =3.1.0，待办放 frontmatter todos）。
5. M3 零自动豁免通道；expansion 唯一路径=回 plan 改 files 重闭环。
6. M2 单 change 多轮 apply；双 loop 不跨 archive 边界、不发版；旧 loop 物理删除=完成判据。
7. 三 change 命名冻结：goal-run-birth-contract / goal-phase-runtime-unification /
   plan-contract-reference-closure。
8. 出生事件 `run_created`（每 run 一条；先 manifest 后 run_created；缺事件=不可 attach；
   run_start 保留"执行开始"语义）；漂移消费端优先 run_created、legacy 回退首个 run_start。
9. rebaseline=运行时外人工管理命令：`--supersede <old-run-id> --rebaseline-to
   <exact-40hex-sha>`，两参数同供、HEAD 等值校验、goal 环境按 hasGoalExecutionSignal
   谓词拒绝（gate 标记不豁免）、executor/supervisor 永不构造；审计单写者——只写新 run
   events（run_created.rebaseline_from_run_id + supersede{target_run_id,
   superseding_run_id, rebaseline_to, run_created 引用}），不回写旧 run，双向可追=
   逻辑可追；不接入 AuthorityFacts、不构成质量豁免；CLI 归属=goal-runner 既有
   --supersede 同门。
10. 事件对照=生产 projectCanonicalLifecycle 纯投影：run_created/phase_start/
    phase_verdict/phase_halt/phase_backtrack_requested/owner_handoff{from,to,outcome}/
    run_end；不建测试手选清单。
11. 归档拓扑：ut-legacy-coexistence → M1（详 §7）。
12. run_base_sha 为特殊 write-once 身份字段，实现为三层防线：diffManifestIdentityFields
    照常报告漂移（禁止过滤式"排除"——那是排除于检测）→ resolveManifestDriftDecision
    在 authAll/override 授权评估前对含 run_base_sha 的变更无条件 fail-closed →
    resolveManifestIdentityBaseline 回放 rebase 事件时验证出生摘要，失配/字段消失=
    事件流损坏。四负例锁死。
13. CREATION_INCOMPLETE：不被 supervisor 接管、不可 resume、不算 HALTED/PARTIAL
    占位者、不挡重建；呈现走 attach/resume 拒绝信息与既有 GC 报告，不进 progress 投影；
    零事务状态机。
14. 拒绝谓词=从 isAgentSideGoalHarness 内部提取的 `hasGoalExecutionSignal()`
    （RUN_ID/ATTEMPT/ATTEMPT_PHASE/isGoalOrchestrationEnv 并集，无 gate 标记豁免）；
    isAgentSideGoalHarness 改写为 hasGoalExecutionSignal() && 非正式 gate，其既有
    消费者（b7e4d2a9 单写者谓词面）语义不变，回归覆盖。

## 10. 给 reviewer 的检查点（余留）

1. m5 宿主事故 fixture 的建模边界（复刻 manifest/contracts/events 形状 vs 复刻完整
   run 目录树）——默认前者（最小充分）。

## 实施记录（2026-08-28 · review 返修）

- 新增并实施 OpenSpec 修正 change `goal-runtime-enforcement-fixes-2`；未改写已归档历史，未新增
  manifest、ledger、状态机、授权层或平行真源。
- M1 返修：fresh run 在出生前解析 legacy fidelity 恢复所需的实际 phase chain，并将规范化
  chain 同时冻结进 manifest 与 `run_created`；modern resume/attach 只加载出生事实。出生摘要
  对 `run_base_sha` 执行存在性与值的双向一致性校验，禁止无→有、有→无和改值。
- M2 返修：attended host bridge 将 authorization、through-phase、lease 和 round 上限真实接入
  唯一 `GoalPhaseRuntime`；manual 零 invoke、batch 不越界、single-round 最多一 phase。handoff
  兼容 API 收窄为 request-only，runtime 成为唯一 transition writer；生产 `handoff_rejected`
  保留目标方向并进入 canonical lifecycle。attended runtime 不再保留第二套 stdio endpoint。
- 同轮闭环：所有 goal execution signal 下的 coding/UT/exit diff base 只信 manifest；plan contract
  closure 拒绝未消费的 file-like 字段；结构门禁改为 lifecycle/call-edge 断言；OpenSpec
  `Enforcement:` 精确路径与 glob 由 `check-openspec-enforcement-paths.mjs` 自动校验。
- 验收结果：TypeScript typecheck PASS；`npm test` 为 3614/3614 unit、44/44 fixtures；
  `npm run openspec:validate` 为 40/40 且 Enforcement 路径校验 PASS；开发期
  `node scripts/check-plan-version.mjs` PASS；`git diff --check` PASS。全量首轮曾由新增写点使用
  未注册 incident id 触发 1 条元门禁，已复用既有 `framework_integrity_block` 收敛并在第二轮
  全量中关闭。
- `npm run release:verify -- --skip-typecheck` 已执行并按设计停在 release-mode plan gate：当前
  3.0.0 窗口共有 4 个 plan 仍含未完成 todo。不得为放行而伪改状态。
- 消费者迁移：无。此次为既有出生事实、运行时边界、门禁与事件形状的缺陷修复，没有新增
  消费者配置或持久状态；对出生时缺失必要恢复 chain 的损坏 modern run，既有处置是废弃并
  新建 successor，而不是追溯迁移。
- 里程碑事实：M1、M2、M3、m4 保持 `completed`；m0 与 m5 继续 `in_progress`。唯一与本总纲
  归档拓扑直接相关的外部未完成项仍是 `ut-legacy-coexistence` 7.2 宿主真机证据，因此
  `goal-run-birth-contract` 与本总纲不得提前归档/关闭。
