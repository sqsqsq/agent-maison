---
name: 无人值守生存能力 — liveness beacon / supervisor auto-resume / 声明式 launch-liveness-wakeup
version: 3.0.0
# 版本说明：原为 3.0.0 盘点（2026-07-30）顺延 3.1.0 的能力容器 plan（非 bugfix）；
# 2026-08-02 用户拍板**改回 3.0.0 窗口**——顺延理由「不依赖宿主回归、压在 3.0.0 只会挡发布」
# 不再成立：本 plan 与 3.0.0 收尾期暴露的 goal 启动路径问题同域，且 7c4e9a2b L4.2 已把
# goal-runner 的重构窗口预留给本 plan 与 d6b1a8e3 的合并评估。
# 影响：release:check-plans 的 3.0.0 未完成 plan 由 7 条增至 8 条，本 plan 三项 todo 进发布门。
# 2026-08-02（a5f9c3e2 落地后）：本 plan **降为统一裁决内核的下游消费者，最后实施**。
# 上游 a5f9c3e2（已提交 707148e7）已建立 decide() 与统一 disposition；本 plan 的 supervisor
# **只消费 disposition，不得解释原始 halt_reason**（见 t2 与设计约束 2）。
overview: >
  承载 openspec change `goal-mode-unattended-survival` 的三项未实施能力（5.1/5.2/5.3）。
  2026-07-30 全量未完项盘点定性：这三项是**纯新增能力**（liveness beacon 反 pid 重用、
  supervisor 自动 resume + OS 计划任务、声明式 launch/liveness/wakeup 能力与
  framework.local.json 生存解析），既非 3.0.0 修复项的验收、也不依赖宿主回归——压在 3.0.0
  上只会挡发布，故整体顺延 3.1.0 窗口。**（2026-08-02 用户拍板推翻此顺延，改回 3.0.0 窗口；
  上述"顺延"表述保留为决策历史，现行窗口以 frontmatter version 为准。）**
  现状边界（诚实记录）：goal-runner 已有 per-run lock + heartbeat + detach.log + 
  `--resume`，无人值守的**基础观测**在场；缺的是"进程死了谁把它拉起来"这一层（L2 supervisor）
  与"跨回合唤醒"（L4）。当前无人值守失败的实际处置方式是人看 progress/events 后手动
  `--resume`，这在 3.0.0 是可接受的已知边界。
  **实施顺序（2026-08-02 定）**：a5f9c3e2（统一裁决内核）→ d6b1a8e3（报告/监控真值）→
  本 plan。理由：2026-08-02 宿主两起无人值守卡死中，**进程都活得好好的**，是被自己的门禁
  合法停的——先做 supervisor 等于给一个会自杀的 run 装自动复活，复活了还在同一位置再死。
  halt/recover/waiting/terminal 语义定了，supervisor 才知道该拉起谁。
todos:
  - id: t1-liveness-beacon
    content: >
      L0 liveness beacon：`liveness.json`（run 级）承载 proc_identity 四元组（pid + 进程
      创建时间 + 可执行文件 + run_id）防 pid 重用误判；探针只读、不写；反 `/F` 强杀探测
      （Windows taskkill /F 不给进程执行清理代码的机会 → beacon 只能由"下次启动对账"
      判定为陈旧，不得据此宣称 run 存活）。语义与既有 device-session.json 的四元组所有权
      判据同源（a7f2e5d1 t2 先例），**禁止另造第二套进程身份模型**。
    status: completed
  - id: t2-supervisor-auto-resume
    content: >
      L2 supervisor + OS 计划任务。
      **【2026-08-02 核心假设改写 · 上游 a5f9c3e2；codex 七轮裁决后定稿】
      supervisor 的唯一*业务处置*输入是 `run_disposition`，不解释任何事故原因**——
      但它**仍然必须读** beacon（进程是否真活）、终局状态与重试预算：这些不是业务分类。
      判据是 **beacon × run_disposition 两条正交轴**的矩阵（不合并成更大的状态枚举）：

      | beacon | run_disposition | supervisor |
      |---|---|---|
      | fresh | 任意 | 不介入（进程还活着） |
      | stale | `RESUME_READY` | resume |
      | stale | `RECOVERY_PENDING` | **resume**，继续未完成的保守恢复 |
      | stale | `WAITING(kind)` | 不拉起（拉起来还是等） |
      | stale | `TERMINAL` | 永不拉起 |

      **`stale + RECOVERY_PENDING` 必须拉起**（codex 订正本 plan 前稿的「不介入」）：
      回退已发起、coding 未跑完时进程死亡，正是本 plan 立项要解决的「进程死了谁拉起来」；
      写成不介入等于把该场景永久搁浅。「别把回退中的 run 又拉一把」由 beacon fresh 那一行
      承担，不需要靠 disposition 去表达。
      supervisor **不得**用 `testing_write_violation` / `vision_ledger_tamper` /
      `unauthorized_source_mutation` / receipt 等原因推导处置——原稿「按事件 type 扫描
      resume 拒绝判据」照做会**原地复活再死**，且每加一种 halt 就要改 supervisor 一次，
      等于在这里重建第二张分类表。
      **前置依赖（硬）**：本项要求 d6b1a8e3 t5⓪ 已落地——所有 authoritative halt/recovery
      事件都经唯一投影出口产出 `run_disposition`。a5f9c3e2 交付时只有 2 个 decide 生产
      调用点、投影只落 3 处事件，此时开工 supervisor 会对绝大多数 halt 无判据可依。
      有界重试 + 退避 + 重启计数落 events（防无限重启风暴）。Windows 侧走计划任务，
      非 Windows 显式 unsupported（与 a7f2e5d1 t6 凭据面同款诚实边界）。
    status: completed
  - id: t3-declarative-launch-liveness-wakeup
    content: >
      L1/L4 声明式能力：`launch` / `liveness` / `wakeup` 三段进 adapter 或 framework.local
      schema，生存策略由配置解析而非硬编码；跨回合唤醒（L4）供"agent 回合结束后 run 仍在
      跑"的场景把结论带回下一回合。落地前先做**能力真值探针**（各 adapter 是否真支持
      后台存活/唤醒），禁止先声明后验证——a7f2e5d1 的教训：tier 虚标要么实证要么降级。
      【2026-08-02 实施后如实降级 · codex 裁决「没有真实探针和消费者就不要勾 completed」】
      **已交付**：adapter-schema 的 survival 三段（launch/liveness/wakeup）+ 解析器
      （无 verified_by 一律降级为不支持）+ 「仓库内不得留虚标」的断言。
      **未交付**：本项的**实质**——各 adapter 的真实能力探针，以及生存策略的生产消费方
      （目前 supervisor 走的是 beacon×disposition，不读 survival 声明）。
      现状等于「有 schema 和解析函数，没有探针也没有消费者」。
      【2026-08-05 取消：被 e5d8a2c4 T3 吸收】可靠性总纲裁定：不扩建通用
      launch/liveness/wakeup 声明层，直接复用既有 supervisor + 具体 probe
      （waiting(kind, probe?) + 条件转绿自动 resume）满足本项目标。已落地的
      schema/解析器保留（无 verified_by 恒降级不支持），声明层若日后确有需要，
      须在 T3 有真实探针与消费方之后另立项。
    status: cancelled
isProject: false
---

## 来源与顺延依据

| 来源 | 原 task | 顺延理由 |
|---|---|---|
| openspec `goal-mode-unattended-survival` | 5.1 Liveness beacon | 纯新增能力，无 3.0.0 修复项依赖它 |
| 同上 | 5.2 Supervisor auto-resume + OS scheduled task | 同上；且须先有 5.1 的可信 beacon |
| 同上 | 5.3 Declarative launch/liveness/wakeup + local 生存解析（L1 基础设施 + L4 跨回合唤醒） | 同上；需 adapter 能力探针前置 |

2026-07-30 盘点结论：该 change 的三项均**未实施**（非"未回归"），保留在 3.0.0 会让
`check-plan-version --release` 永久 FAIL。原 change 的 tasks 已标注顺延指向本 plan。

## 设计约束（从既有实现继承，避免重造）

1. **进程身份判据单一**：复用 `device-session.ts` 已验证的四元组所有权模型（pid + 创建
   时间容差比对 + 可执行文件 + started_by_run），`liveness.json` 不得引入第二套。
2. **唯一业务处置输入是 `run_disposition`，不重建分类**（2026-08-02 改写；原文「按事件
   type 扫描 resume 拒绝判据」已作废。codex 七轮再订正：约束对象是**推导行为**而非字符串）：
   supervisor **不得使用 halt_reason / blocking_class 推导 restart action**；
   beacon、终局状态、重试预算仍是合法输入（非业务分类）。
   等价性断言：相同 `beacon + run_disposition + run_wait_kind + retry budget` 下，
   **任意替换原始事故原因，重启决策必须完全一致**。
   依赖边界：supervisor **不得直接 import `decide` / `lookupIncident` /
   `INCIDENT_REGISTRY`**——那会迫使它重建 IncidentFacts / AuthorityFacts /
   ExecutionContext，实际上是第二个裁决入口；只调用 d6 的统一 run-state reducer。
3. **能力先探针后声明**：L1/L4 的 adapter 能力（后台存活、唤醒）须有实证样本才入册，
   参照 c7a9e2f4 T0 探针法。
4. **Windows 优先、非 Windows 显式 unsupported**（与凭据面同口径），不做半可用实现。

## 验收方向（实施时细化）

- 单测：beacon 陈旧判定（含 pid 重用负例）；**beacon × run_disposition 全矩阵**
  （fresh 恒不介入 / stale+RESUME_READY 与 stale+RECOVERY_PENDING 均 resume /
  stale+WAITING 不拉起 / stale+TERMINAL 永不重启）；重启计数熔断；
- **等价性断言**（替代字符串扫描）：固定 beacon + run_disposition + run_wait_kind +
  retry budget，遍历替换原始 halt_reason，重启决策逐条不变；
  且 supervisor 模块不得 import decide / lookupIncident / INCIDENT_REGISTRY；
- 集成（`supervisor-kill-recovery.unit.test.ts`，**真进程真强杀**，四例）：
  ① 真子进程 + `taskkill /T /F` → beacon 原样留着仍判陈旧（反 `/F` 的核心形态）；
  ② 真子进程跑 CLI（`--dry-run`）→ 存活判 `no_op`、强杀后判 `resume`；
  ③ **非 dry-run 真拉起**（runner 用替身，见下）→ 落 `supervisor_restart` → 真 `spawn`
     → 被拉起的进程用生产同款 writer 写出**新 beacon** → 二次判定收敛为 `no_op`（不重启风暴）；
  ④ 拉起必然失败时**照样计数**，下一轮序号推进到 2（这才是「先记账再 spawn」的可观测理由——
     顺序本身外部观测不到：实测把 append 挪到 spawn 之后，③ 依然全绿）。
  边界：③ 的 runner 是替身（真 `goal-runner` 按自身 `__dirname` 解析工程，单测里真跑会写进
  框架源仓并留 detached 残留），故本项证明的是 **supervisor 侧**记账/拉起/收敛闭环。
- 宿主：一次真实无人值守 run 跨越进程死亡并自愈——**含「真 goal-runner 被拉起后能续跑」**
  （需真实工程/adapter/设备，框架侧不冒充，不在框架侧勾选）。
