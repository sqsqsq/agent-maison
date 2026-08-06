---
name: goal 报告与监控真值 — 失败归因一致性 / monitor stale 误报 / 硬预算与证据卫生集成断言
version: 3.0.0
# 版本说明：原为 3.0.0 盘点（2026-07-30）顺延 3.1.0；四项同属"goal 对自身状态的表述是否准确"。
# 2026-08-02 用户拍板**改回 3.0.0 窗口**（与 a4f7e2b1 同批）——本 plan 自己就写明 ①② 是
# 「框架侧可查证的真问题（不依赖宿主）」，顺延的唯一理由是与 ③④ 共用验收面；现改为同窗口内做完。
# 同时恢复 7c4e9a2b L4.2 的前提：goal-runner 重构窗口留给 a4f7e2b1 与本 plan 的**合并评估**，
# 两者现同属 3.0.0，合并评估可在本窗口内进行。
# 影响：release:check-plans 的 3.0.0 未完成 plan 由 8 条增至 9 条，本 plan 四项 todo 进发布门。
# 2026-08-02（a5f9c3e2 落地后）：本 plan **降为统一裁决内核的下游消费者**，实施顺序
# a5f9c3e2（已提交 707148e7）→ 本 plan → a4f7e2b1。新增 t5（消费统一 disposition），
# 并订正「与决策层完全正交」的旧表述——t2 不正交（见下）。
overview: >
  承载三项 3.0.0 未完 + 一项 2026-07-29 宿主回归新发现，共同主题=**goal 报告/监控的自我
  表述真值**：① goal 侧 failure_kind 与 d9e4b7c1 的 case 归因不一致（新发现实锤：宿主
  run 20260729T123155Z-0c5411 的 testing 被判 failure_kind_classified=code_regression，
  而 device-test-evidence 里 5 条全是 test_contract=测试自造 selector——报告把"测试问题"
  说成"代码回归"，会把排查引向改产品）；② d9b4f7e2 diagnosis-residual（goal-monitor stale
  误报的 replay fixture 定位，两候选根因待证）；③④ goal-timeout 7.3b/7.5b 硬预算与证据
  卫生的**集成**断言（单测覆盖不到"三路径总时长 ≤ wall + grace"这类跨进程性质；上游
  7.3b 原文是"需 goal run **实跑或** runner 集成测试床"，2026-08-03 订正为宿主受控实跑
  优先，见 t3）。
  定性：①② 是**框架侧可查证的真问题**（不依赖宿主），③④ 需要集成级证据。前两项本可
  在 3.0.0 修，但它们与 ③④ 共用同一套"goal 状态表述"的验收面，合并做能一次把报告真值
  这条线收干净，故整体顺延 3.1.0。**（2026-08-02 用户拍板推翻顺延，改回 3.0.0 窗口；上述
  "顺延"表述保留为决策历史，现行窗口以 frontmatter version 为准。合并做的理由不变——四项
  仍在同一窗口内一次收口。）**
todos:
  - id: t1-failure-kind-consistency
    content: >
      失败归因一致性（2026-07-29 宿主回归新发现）：当 device-test-evidence 的 cases 全为
      test_contract / environment 等**非产品缺陷**分类时，goal 侧 failure_kind 不得输出
      code_regression。落地：classifyFailureKind 增 evidence 归因输入（有 evidence 且
      product_actionable 为空 → 归 test_contract / external 类），goal-report 与 halt 文案
      同步；无 evidence 时行为不变（fail-open 到既有分类，不因新输入缺失而改判）。
      实锤引用：run 20260729T123155Z-0c5411 的 phase testing —— report 写 code_regression，
      evidence 写 5×test_contract，两者矛盾且报告口径误导。
      【已拆回 3.0 · 2026-07-30】本项为已实锤的当前报告口径错误（evidence 全 test_contract 而 failure_kind=code_regression），不该与未来集成测试床捆绑延期——移交 3.0 小修合集 plan f4b2c8e6 t1 承载。本 plan 保留 t2/t3/t4（monitor stale 定位 + 硬预算/证据卫生集成断言）。
    status: cancelled
  - id: t2-monitor-stale-false-alarm
    content: >
      d9b4f7e2 diagnosis-residual：goal-monitor stale 误报的 replay fixture 定位。两候选
      根因（plan 原文已列）：(a) 调用侧 `--since-event 0` 导致历史事件重复消费；
      (b) monitor 历史 verdict 未标 superseded 使旧结论参与判定。**先做 replay fixture
      复现再改代码**（不复现不改——这是本仓一贯做法）；修完补 fixture 回归。
    status: completed
  - id: t3-wall-budget-integration-assertions
    content: >
      goal-timeout 7.3b 硬预算集成断言：双侧 zero-budget 禁 spawn / backoff 终局 /
      finalize_skipped / **"agent + harness + backoff 三路径总时长 ≤ wall +
      resolveKillGraceMs()"**。这条不等式是跨进程性质，单测装不下——端到端以**宿主受控
      goal run 为首选**，runner 集成测试床仅作宿主长期不可用时的替代路线（详见下方路线
      订正）。grace 必须继续由四常量同源派生
      （DEFAULT_CHILD_SETTLE_GRACE_MS 等），禁在测试里另造脱钩常量。
      【2026-08-02 实施后如实降级 · codex 裁决「不得用局部单测冒充完成」】
      **已交付**（tests/unit/goal-budget-integration.unit.test.ts）：agent 路径的真跨进程
      不等式（真子进程 + 真实小超时，非 mock 时钟）；grace 四常量同源断言且四常量均须为正；
      zero-budget / backoff 终局（在其真实所在层 goal-timeout.canAffordBackoff）；
      finalize_skipped 的 pre-check 边界与预留常量为正。
      **未交付**：三路径**聚合**不等式——它要求真正驱动整个 goal-runner。故本项
      **保持未完成**，不以局部断言充数。
      【路线订正 · 2026-08-03，codex 复核】此前把选项写成「建 runner fixture 或缩减验收」
      是**漏读上游**：openspec `goal-timeout-hardwall-hardening` tasks 7.3b 原文为
      「端到端验收需 goal run **实跑或** runner 集成测试床」。二选一里的第一条被丢了。
      **首选宿主受控实跑**——已有 6 项宿主回归待批量执行，本项边际成本接近零；
      建假 adapter + 假 harness + manifest/锁/vision-trust 全套 fixture 成本与 flaky
      风险都高，**仅作宿主长期不可用时的替代路线**。两条路线都**不缩减验收**。
      宿主证据要求：必须是**受控故障场景**（普通成功 run 不算数），一至数个 run 覆盖
      agent 超时 / harness 超时 / backoff 装不进剩余预算，并证明三者共用同一 deadline。
      **时间口径（2026-08-03 codex 复核订正，此前写错）**：wall 预算自 plan e7c2a4d8 T2
      起是**活跃时间累计**，不是日历跨度——`resolveResumedBudget` /
      `partitionExecutionSessions`（goal-runner-phase.ts:311/522）按权威执行会话分段求和，
      隔夜等待与无人值守停顿**不消耗预算**（4035d4 事故的修复）。故不等式是：
      `Σ 权威执行会话活跃时长 ≤ wall + resolveKillGraceMs()`。
      含 resume 的 run 完全可能 `首个 run_start → 最终 run_end > wall` 而行为正确，
      **不得据此判超预算**；仅 fresh、无 resume 的单进程 run 可等价用该次
      `run_start → run_end` 计算。
      zero-budget / backoff 终局 / grace 四常量派生 / finalize pre-check 已由上列单测在其
      真实所在层覆盖，宿主不必重复证明。
      【2026-08-05 移交：归 e5d8a2c4 T4 关系面】可靠性总纲裁定：三路径聚合不等式
      归 **candidate 宿主 evaluator** 承接（真实时间性质在真实宿主受控 run 上验），
      不进 CI smoke。验收判据（上方不等式与口径）随移交继续有效，本 plan 不再追踪。
    status: cancelled
  - id: t4-evidence-hygiene-integration
    content: >
      goal-timeout 7.5b 证据卫生集成断言："kill 后 agent-output.log 字节不变"。runner 已
      无任何写该文件的代码路径（kill 诊断走 agent_invoke_end 事件字段），但**独立断言**
      需要集成级证据才能证明（进程被杀那一刻的落盘状态）。
    status: completed
  - id: t5-unified-run-disposition
    content: >
      **【2026-08-02 新增 · 上游 a5f9c3e2；codex 七轮裁决后定稿】统一投影的生产面 +
      单 run-state reducer。**
      ⓪ **生产前置（t5 能成立的必要条件，不是 scope 膨胀）**：所有 authoritative
      halt/recovery 事件必须经**唯一 adjudication 投影出口**（`runDispositionFields()`）
      落盘 `run_disposition`；`WAITING` 同时落 `run_wait_kind`。
      **⓪-b 四态必须是 total function（codex 七轮 P0）**——只覆盖 halt/recovery 不够：
      普通 run 在**首个事故发生前**进程死亡时 events 里根本没有投影，supervisor 仍无判据；
      且旧 run 曾 `WAITING`、条件修好后成功 `--resume`，若无清除规则 reducer 会一直读到
      那条陈旧 WAITING。初始化与清除规则（不是新抽象，只是把四态补成全函数）：
        · accepted `run_start` / `resume` → 当前态置 `RESUME_READY`
        · 后续 adjudication 投影**覆盖**它
        · reducer 取**最新 authoritative 投影**
        · `run_end` 终局优先（终态一旦落定不被更早的投影翻回）
      report / monitor / supervisor **一律不得回读原始事故原因补算**。
      元门禁覆盖面须含 **goal-runner + session driver（goal-mode-entry /
      goal-in-session-driver）+ delegated halt producers（如 device-readiness-gate）**——
      任何 halt 无投影即红。
      现状（a5f9c3e2 交付时）：`decide()` 仅 2 个生产调用点、投影只落 3 处事件，
      其余 halt **不产投影**；注册表覆盖已在 a5f9c3e2 收口后扩到全 scripts 树（含 session driver 与 delegated producer），
      但「注册」≠「产投影」，本项补的正是后者。
      ① 单一 run-state reducer：`goal-progress.ts` 现独立从事件类型 + liveness 推导
      `HALTED/STALLED/RUNNING`——**它是本项主要收编点**；monitor 只消费该投影。
      **禁止**在 report/monitor 里按 halt_reason / blocking_class 再判事故类型。
      ② 一致性断言（**codex 订正：不得把 disposition 与 liveness 合并成更大的状态枚举**，
      否则产生无谓的笛卡尔积状态机）：`RECOVERY_PENDING` **不得被解释为终局 HALTED**；
      但 beacon 陈旧时，允许**同时如实展示** `run_disposition=RECOVERY_PENDING` 与
      `liveness=STALLED`（两条正交轴各说各的事实）。
      `WAITING(human)` 与 `WAITING(external)` 须可区分展示（等人 ≠ 等环境）。
      ③ **承接 lineage 断裂的报告展示**：a5f9c3e2 只负责写 `lineage_discontinuity` /
      `lineage_reset_committed` 事件并禁止连续性主张，**展示层归本 plan**——最终报告须
      明确呈现「本 run 已 reset lineage、历史连续性已撤销、新 lineage 已全链验证」，
      且**不得**出现任何「连续性得以保持」口径。
      ④ **收编 report 侧既有事故表**：`goal-report-generator.ts` 现有 20 处
      `halt_reason === …` 文案树，已经是一张报告侧分类表。改法：状态与 next action 全部
      来自 `run_disposition`；诊断文字优先直接渲染生产端已有的 `halt_guidance`；
      无 guidance 时退化为通用 `halted (<halt_reason>)`；attempt 时间线不再按 halt_reason
      正则筛选，改为对 halted phase 一律尝试生成、有数据才展示。
      ⑤ 最终状态投影的验证随 ⓪-b reducer 单测落地（**2026-08-03 订正**：原文写"复用
      t3/t4 的集成测试床"，该测试床从未存在也不需要——见文末"为什么合并"的订正）。
    status: completed
isProject: false
---

## 来源与顺延依据

| 来源 | 原 task | 状态定性 |
|---|---|---|
| **2026-07-29 宿主回归新发现** | failure_kind 与 case 归因不一致 | 新增：报告口径误导（code_regression vs test_contract） |
| plan `d9b4f7e2` | diagnosis-residual（monitor stale 误报定位） | 框架侧可查证，不依赖宿主 |
| openspec `goal-timeout-hardwall-hardening` | 7.3b 硬预算集成断言 | 需集成级证据；宿主受控实跑优先（见 t3） |
| 同上 | 7.5b 证据卫生集成断言 | 已完成（t4） |
| **plan `a5f9c3e2`（已提交 707148e7）** | t5 消费统一 disposition + lineage 断裂展示 | 上游落地后新增：决策层已产出四态投影，报告/监控必须同源理解 |

## 为什么合并（而非把 t1/t2 塞进 3.0.0）

t1/t2 确实可以在 3.0.0 做，但它们与 t3/t4 验的是同一件事的四个侧面：**goal 报告出的
状态是不是真的**。
- t1：失败**类型**说得对不对；
- t2：stale **判定**说得对不对；
- t3：预算**边界**声明得对不对；
- t4：证据**完整性**声称得对不对。

四项共用一套报告断言口径，分两批做会让口径漂移。
**（2026-08-03 订正）** 原文此处还写着"共用一套集成测试床（可控 agent/harness/时钟）"——
该前提已废：t1 已拆走、t2/t4/t5 全部由单测在其真实所在层落地，t3 改走宿主受控实跑优先，
四项从未、也不需要共用测试床。

## 硬约束

1. **t1 fail-open**：无 evidence 时归因行为**与现状完全一致**，不得因新输入缺失改判——
   否则普通模式/旧产物链路被牵连（d9e4b7c1 的同款纪律）。
2. **t2 先复现后改**：replay fixture 复现不出来就不改代码。
3. **t3 grace 同源**：验收不等式里的 grace 必须由既有四常量派生，禁造脱钩常量（否则
   不等式不是真上界）。
4. **t5 不得重建分类（行为约束，非字符串扫描）**（codex 七轮订正：原「源码不得出现
   halt_reason 字面量」过于粗暴——report 合法需要显示原始原因）：
   report / monitor / supervisor **不得使用 halt_reason / blocking_class 推导
   `run_disposition`、run status、next_action 或 restart action**；允许原样透传用于
   诊断展示。等价性断言：相同 `liveness + run_disposition + run_wait_kind + retry budget`
   下，**任意替换原始事故原因，控制结果必须完全一致**。
   依赖边界：下游消费方**不得直接 import `decide` / `lookupIncident` /
   `INCIDENT_REGISTRY`**，只调用统一 run-state reducer。
   **真正要防的就是下游各建一张分类表**——一旦重建，「同一事故三处说法不同」会以新形态回来。
5. **t2 依赖 t5**：monitor stale 判定须在统一状态面上做；先按旧状态面修完会在 t5 落地时
   再改一遍（且可能把 RECOVERY_PENDING 误判成 stale）。

## 验收方向

- t1：宿主 run 20260729T123155Z-0c5411 的 evidence 作 fixture，断言 failure_kind 不再是
  code_regression；无 evidence 的旧形态断言归因不变；
- t2：replay fixture 复现误报 → 修 → 同 fixture 转绿；
- t3/t4：四条断言（zero-budget / backoff 终局 / finalize_skipped / 总时长不等式）
  + kill 后日志字节不变。**（2026-08-03 订正）** 前三条与日志字节已由单测在其真实所在层
  交付（t4 completed）；只剩**总时长聚合不等式**待宿主受控实跑，且口径为
  「Σ 权威执行会话活跃时长 ≤ wall + grace」——**不是日历跨度**（见 t3）；
- t5⓪：元门禁——goal-runner / session driver / delegated producer 三处产出的任一 halt
  事件缺 `run_disposition` 即红（与 a5f9c3e2「halt_reason 未注册即红」同款，扫描域同宽）；
- t5⓪-b **全函数断言**：①只含 `run_start` 的 events（尚未发生任何事故）→ reducer 必须
  给出 `RESUME_READY` 而非 undefined；②`WAITING` → 成功 `resume` → reducer 不得仍报
  WAITING；③`run_end` 之后任何更早投影都不得翻转终局；
- t5①②：以含 `RECOVERY_PENDING` / `WAITING(human)` / `WAITING(external)` / `TERMINAL`
  四态 × beacon fresh/stale 的 events 作 fixture，断言 report 与 monitor 的呈现与
  `run_disposition` 逐条一致，且 `RECOVERY_PENDING + stale` 同时如实显示两轴、
  不被折叠成终局 HALTED；
- t5③：含 `lineage_discontinuity` 的 run 报告必须显示连续性已撤销，全文无「连续性保持」口径；
- t5④ **等价性断言**（替代字符串扫描）：固定 `liveness + run_disposition + run_wait_kind
  + retry budget`，遍历替换原始 halt_reason，report/monitor 的 status 与 next_action
  必须逐字不变；下游模块不得 import decide / lookupIncident / INCIDENT_REGISTRY。
