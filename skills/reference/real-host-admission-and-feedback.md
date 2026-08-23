# 真实宿主准入与回灌契约（Real-host admission & feedback contract）

> 本文回答两个问题：真实宿主（消费者工程）的复杂需求**能不能进**、进了之后**问题怎么回流**。
> 与 [host-harness-readiness.md](./host-harness-readiness.md)（"harness 能不能跑"）平级互补：
> 那篇是工具链前置，本文是复杂需求准入与缺口回流契约。
>
> 适用框架版本：3.1+（部件演进工作区 `<features_dir>/<blueprint_id>/`；`<features_dir>` 默认
> `doc/features`，经框架解析）。

<!-- 设计来源（maintainer 视角，非运行时依赖）：总计划 §8 真实宿主准入与节奏、
总纲 §10 真实宿主驱动、§11.2 稳定内核与 provider 接缝语义。正文自包含，不引用 dev-only 文件。 -->

## 1. 适用范围与边界

**什么时候必须走本契约**：宿主工程里出现单次 spec/plan 无法承载的 App 单部件大型需求，且该
部件**准备建立或已经进入**演进工作区 `<features_dir>/<blueprint_id>/`（演进工作区由
[app-component-blueprint Skill](../project/app-component-blueprint/SKILL.md) 建立）。
此时每个施工单元（Change Unit，下称 CU）进入、推进、闭环、回流，都按本文执行。

**作用域包含 pre-CU 蓝图准入**：在部件蓝图尚未建立、需求准备进入蓝图时，同样先按 §2 准入清单
逐项核对。缺失项**只有在输入足以形成合法蓝图时**才在首次蓝图创建时写入 `decisions_and_gaps`；
输入不足以形成合法蓝图（仓库/访问/构建不可用）时，直接按 §3 第三级 halt 并报告、不落盘。蓝图
Skill 的入口链接（[app-component-blueprint](../project/app-component-blueprint/SKILL.md)）
指向本契约，即为此意。

**与普通 Feature 的边界**：没有 `change_unit_ref` 的普通 Feature 走各自既有 Skill 与流程，不经过
本契约。只有进入部件演进工作区、以 canonical CU 为施工单元的单元才在本契约范围内。

**与 H1 的边界**：本文是真实宿主验证的**入口契约**，本身不执行验证、不产出任何宿主语义 PASS。
AI 记账等真实宿主验证（H1 批次 1）以本文为入口开展；宿主是否真的"能进、能回流"，只能由真实
宿主验证的事实回答，不能由本文的存在回答。

## 2. CU 级准入最小输入清单

进入某个真实 CU 前，要求其依赖的机制层已就绪，且与该单元相关的材料就绪。逐项写明**谁提供**、
**缺了算什么**——缺了不算失败，按 §3 路由：

| 输入 | 谁提供 | 缺失时 |
|------|--------|--------|
| 可访问的真实 App 仓库、入口与构建方式 | 宿主工程 / 用户 | 尚不能形成 canonical artifact → 当前入口 halt 并报告（不创建持久化对象） |
| 当前需求切片及可确认的验收意图 | 用户 / SE | 记为输入缺口 → §3 上游路由（蓝图开放问题/缺口，带 owner、解除条件） |
| SE 相关的外部契约、全局不变量、App 责任 | SE | 未完整时，当前单元所需消费语义须已形成明确需求/提案并由有权 owner 裁决；**需求/提案 ≠ 已冻结契约**，见 §5 |
| 当前代码、数据、接口、测试事实可发现 | Agent 按发现纪律自行核实 | 分阶段判（见 §3 第 1 级）：蓝图可形成但 CU 不可形成 → 记蓝图 gap；连蓝图都无法形成（仓库/访问/构建不可用）→ halt 并报告 |
| 仓内及已登记的工程惯例 / 参考实现 | Agent 自行发现 | 不存在参考实现本身**不阻塞**，见 §4 |
| 当前单元引用的蓝图设计切片已合法 disposition、相关 blocker 已解除且达设计可施工门 | P1 蓝图及其质询/准入结果 | 未达门 → 在 P1 内继续，不带着未解除 blocker 进 P2 |
| UI 单元的高保真与页面验收口径 | 宿主 UI 资产 / 视觉流程 | 缺 → §3 路由；**不因其它远期页面高保真未到，阻塞已具备条件的非 UI 单元** |
| 外部事件场景的模拟注入 / 测试数据 / 可信 contract fake | 宿主工程 / SE | 缺且为必要输入 → §3 路由 |

## 3. 缺失输入的三级路由

缺失输入按**所处阶段**落三级，不为记录 blocker 先造 CU、不复制 P1 的 gap、不新建持久化对象
类型：

1. **蓝图设计 / 外部权责问题，或 pre-CU 阶段的输入缺口**（外部契约未裁决、产品语义未定、风险未接受、UI 高保真/测试数据/contract fake 未到、事实不可发现）→ 记入蓝图
   `decisions_and_gaps` 的既有 `gaps[]` 条目（**字段列全**：`gap_id`、
   `status`（`open_decision` 或 `blocker`）、`owner`、`needed_by`、`unlock_condition`、
   `provenance`——按既有 P1 schema 校验通过，两种 status 均不得缺字段）：
   - `open_decision`：需裁决但未定；
   - `blocker`：已阻施工。
   当前切片依赖的 unknown 必须 blocker；远期开放问题至少带 owner、needed-by 与解除条件。
   事实不可发现时保持 unknown/blocker 或 halt，不得在不可发现事实下继续推进施工；
   **区分按当前阶段所需 artifact 是否可形成**：蓝图可形成但 CU 不可形成 → 记 P1 gap；
   只有连蓝图都无法形成（仓库/访问/构建不可用）才走第三级 halt。
2. **已存在 canonical CU 的 design / execution 阻断** → 记入该 CU 的 `blockers[]`（既有字段：
   `blocker_id`、`gate`（design|execution，影响门槛）、`owner`（责任方）、`reason`（原因）、
   `unlock_condition`（解除条件）、`observation`、`source_refs`（事实来源））。规则与
   [change-unit-validator.ts](../../harness/scripts/utils/change-unit-validator.ts) 既有校验一致：
   - `observation: machine` 的 blocker **必须声明 `probe`**（可重算的事实来源）；
   - `observation: human` 可无 probe，但**必须声明 `authority_ref` 与 `source_revision`**；
   - 不得写 `resolved: true` 自报解除——活动性只能由 probe/权威事实重算。
3. **尚不能形成 canonical artifact 的仓库 / 访问 / 构建问题** → 当前入口（Skill/CLI）halt 并
   report，**不创建任何持久化对象**；问题解除后从原入口重进。

## 4. 参考实现与跨仓依赖

- 仓内及已登记的工程惯例 / 参考实现由 Agent **自行发现**（代码、architecture/catalog/
  conventions 等知识资产），不作为准入阻塞。
- 只有当前设计**明确依赖某个跨仓权威实现或兼容基座**时，才由 SE/用户提供可解析定位。
- 已声明依赖但**无法访问** → 按所处阶段沿 §3 三级路由：蓝图已存在则记蓝图
  `decisions_and_gaps` blocker；canonical CU 已存在则记该 CU `blockers[]`；只有尚不能形成
  canonical artifact 时才 halt 并报告。
- **不存在参考实现本身不阻塞**——没有先例不是缺口。

## 5. SE 人工契约输入口径

- 已有权威契约（`contract_id` → operation → request/response DTO → mapping → error /
  idempotency / NFR 链）：**只引用并校验**，逐段解析项目内 `source_ref` 指向的权威文件/fragment
  并真实比对；来源缺失或语义不同即 blocker。
- 缺失时：只形成**消费需求/提案**（蓝图 `gaps[]` 条目：`open_decision` / `blocker`，字段列全
  `owner`、`needed_by`、`unlock_condition`、`provenance`），**不得把
  Maison 提案冒充已批准契约**；"需求/提案 ≠ 已冻结契约"，Maison 不替云侧/授权 owner 裁决。
- 契约链形状与既有表述见 [app-component-blueprint Skill](../project/app-component-blueprint/SKILL.md)
  的 SE 契约消费段，此处不复制。

## 6. 三批宿主目标与证据口径（自包含）

### 批次 1：AI 记账——证明"能用"

最低证据（逐项留下可复核产物，不画静态模型代替）：

- **一份真实 App 部件演进蓝图**：具备可共同评审的摘要、适配 4+1 设计视图、cross-view 信息与
  决策/缺口；`logical`/`runtime`/`development`/`scenarios` 必须成立，`deployment` 根据 App
  进程、后台任务/系统扩展、本地存储、云端运行边界和平台约束作**有证据的适用性裁决**；
- **独立设计质询至少完成一次真实 frontier 探索**：发现非表面缺口须得到合法 disposition，
  确无实质缺口须形成有证据的结论——不得以空报告冒充质询；SE、开发、测试对蓝图完成**一次
  共同评审**，真实权责问题以成包方式裁决或保留为有 owner/门槛的 blocker；
- **多个存在真实依赖的 Change Unit**（非人为拆小的演示任务）；
- **至少一次基于实施新事实的受控蓝图调和**；
- **单元级与部件级闭环均通过**（P2 完成事实 + P3 component closure）；
- **真实构建、测试、界面及适用时的真机证据**；
- **发现的 framework 缺口已回灌并有回归防线**（§7）；
- **稳定知识归位**（architecture/catalog/conventions/ADR 等）。

八条必须真实验证的运行时场景——每条写"**证据长什么样、落在哪个既有产物**"：

| # | 场景 | 证据长什么样（落在哪） |
|---|------|------------------------|
| 1 | 冷启动 / 恢复 | 启动/恢复加载路径明确"查什么、由谁加载、结果归谁持有"，覆盖有数据/无数据/失败/过期——落在承载该场景的既有 CU phase 的 reports（script-report.json/trace）+ evidence identity + 蓝图 review 投影与 closure 覆盖行 |
| 2 | 后台自动写入 | 后台/系统事件写入在 UI 或原进程不存活时，仍有持久化事实与恢复/调和路径（不只依赖内存通知）——落在承载该场景的既有 CU phase 的 reports（script-report.json/trace）+ evidence identity + closure 覆盖行与真机/恢复验证（写入后的消费端传播见 #4） |
| 3 | 晚订阅 | 晚加入的 consumer 能获得当前快照，订阅离开后释放监听/缓存、不留孤儿状态——落在承载该场景的既有 CU phase 的 reports（script-report.json/trace）+ evidence identity + closure 覆盖行与适用时 UI/真机验证 |
| 4 | 多页面刷新 | 任一写入（手动/后台/闪控球）发生后，受影响的首页/分析/列表/详情等 consumer 按蓝图裁决经发布/失效/重查获得新状态，不依赖重启或人工刷新——落在承载该场景的既有 CU phase 的 reports（script-report.json/trace）+ evidence identity + closure 覆盖行 |
| 5 | 分类修改 | 改明细又影响聚合的写操作追到权威写入、派生数据失效/重算与全部受影响 consumer——落在承载该场景的既有 CU phase 的 reports（script-report.json/trace）+ evidence identity + 蓝图权威写入裁决与 closure 覆盖行 |
| 6 | 重复事件 | 重复/乱序/恢复重放不重复入账——落在承载该场景的既有 CU phase 的 reports（script-report.json/trace）+ evidence identity + closure 覆盖行 |
| 7 | 进程重建 | 进程被杀后，内存中的后台事件/状态按既定策略恢复、补偿、禁用或 fail-closed，**不静默成功**——落在承载该场景的既有 CU phase 的 reports（script-report.json/trace）+ evidence identity + closure 覆盖行与真机重启验证 |
| 8 | 账号隔离 | 账号切换或账号级设置不串用上一账号状态——落在承载该场景的既有 CU phase 的 reports（script-report.json/trace）+ evidence identity + closure 覆盖行与真机验证 |

> 表中每条场景的"落在哪"必须绑定**具体既有产物**：相关 CU 发生该场景的 phase 的 `reports/`
> （script-report.json / trace）、受保护的 evidence identity（phase evidence manifest + receipt
> + VALID completion 绑定），并进入对应 component closure 覆盖行；不得以"幂等证据""生命周期
> 证据"等类别名代替具体产物。每条场景是**不同的可证伪主张**，相互不得重复（#4 证新状态传播，
> #6 证幂等去重）。
>
> 这是验收场景，**不预定**宿主采用 Store / EventBus / 数据库订阅 / Repository / DI / 双向绑定
> 框架；实现形态由真实代码与平台约束裁决。正式单元顺序由真实蓝图派生，本文不预定施工队列。
> UI 表单局部草稿可局部双向绑定；共享业务状态的变更必须经过蓝图指定的 command/write owner。

### 批次 2：借款——证明"能复用"

观察指标（沿真实材料记录，不预设结论）：

- 材料确认到第一单元出厂的时间；
- 蓝图、工程惯例、组件、测试步骤和模拟能力的**真实复用**；
- 相似能力新增所需人时与调试时长；
- 是否仍大量依赖人手把 AI 从错误设计中拉回。

第二个消费者出现前，不为"数据导入、AI 建议、提醒"等相似名称预建公共单元；只有契约稳定、
有真实消费者且自身可独立验证时，才抽取公共能力。

### 批次 3：保单——证明"可复制"

观察指标（沿真实材料记录，不预设结论）：

- 第三次是否仍能沿同一套方法进入、推进和闭环；
- 人工决策点、验收往返和晚期缺陷是否下降；
- 已形成资产是否减少重复实现；
- 单人执行承载量是否明显提升（接近 2–3 倍由实测决定，不预设）。

## 7. 缺口回流路径

宿主发现问题时，**先分类，再回流**：

1. **框架缺陷**（framework 版本/门禁/脚本问题）→ 走
   [consumer-framework-boundary.md](./consumer-framework-boundary.md) 的**上报回灌源仓**通道：
   带上 harness 报告的完整栈/漂移清单，**不本地热修**；等不及需本地热修时，由**真人**在
   `integrity.drift_allowlist` 逐路径具名审批（agent 不得自改后自批）。源仓侧以 OpenSpec
   change + 回归防线沿原建设链修复。
2. **输入缺口**（契约未裁决、产品语义未定、测试数据缺失）→ 回 SE / 产品 owner，落点按 §3
   （蓝图 `decisions_and_gaps` / CU `blockers[]` / 当前入口 halt 报告）。
3. **宿主问题**（宿主工程自身的 bug / 环境问题）→ 回宿主，按宿主既有缺陷流程处理。

**话术与预期回报**：缺口不是你的错，但**不回流就是你的负债**。把问题带完整栈/漂移清单报回
对应通道，你会得到：框架问题在源仓被修复并随新发布件回来；输入缺口被有权 owner 裁决并解除
blocker；宿主问题回到宿主责任方。缺口处理未完成前，不要用本地 hack 绕门禁——那只会把
真修复拖回被漂移判定的循环。

## 8. provider 自然事件记录

- 宿主期**自然发生**的 provider 事件（缺失降级、替换、退出）及其**真实代价**（如条件不具备时
  的降级、人工契约被自动交接替换）→ 记入**事件实际发生阶段**的既有 report/evidence（该 phase
  的 reports 目录 / 证据清单），作为真实宿主证据的一部分。
- **closure 只按既有 obligation 派生引用，不手改、不充当通用事件容器**：`provider_observations`
  仅承载三类证据 adapter——`automated-construction-evidence`、`ui-device-visual-evidence`、
  `human-acceptance-risk`；provider 退出使派生投影 stale 但不清除正式产物事实。
- **未自然发生的类型不阻塞宿主完成声明**——机械行为（缺失/替换/退出/冲突）由框架 fixture /
  接缝断言承担，宿主只记录自然事件，不为验收人为制造场景。

## 9. 材料未到位的诚实口径

- **不造假宿主**：没有真实工程就不宣称宿主验证。
- **不伪造语义 PASS**：缺材料就路由/缺口标记，不把"契约固化完成"误报为"宿主验证完成"。
- **不阻塞机械能力发布**：3.1.0 机械闭环发布不依赖真实宿主材料到位。
- 发布说明标注 **"G8 语义验收待完成"**（见随版发布说明/迁移文档）。

## 10. H1 完成声明的最低证据（自包含）

真实宿主批次 1 达到可声明"宿主验证完成"时，须同时具备：

1. 一份**真实原始需求及可追溯来源**（含当前事实与既有约束的可追溯来源）；
2. 一份真实蓝图（该部件演进蓝图），与 SE / 开发 / 测试**共同评审**；
3. **至少一次真实质询 frontier**（发现缺口的合法 disposition，或确无实质缺口的有证据结论）；
4. **多个存在真实依赖的 CU**；
5. **至少一次受控调和**（基于实施新事实）；
6. **单元级与部件级闭环均通过**；
7. **真实构建、运行、测试、界面及适用时的真机/环境证据**；
8. **缺口回灌与回归防线**：真实宿主运行中**发现的** framework 缺口已回灌源仓并有回归防线（§7）；
   未发现框架缺口时，此项不构成完成门槛（不人为制造缺陷）——其余八项仍需齐备（第 1–7、9 项）。
9. **稳定知识归位**（架构/目录/惯例/ADR 落地）。

九项齐备（发现框架缺口时）或八项齐备（未发现时）才能声明批次 1 完成；缺任何一项，如实
标记待完成项并说明阻塞点（§3 路由）。
