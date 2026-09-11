---
name: 动态工作流总纲 — 全阶段 Skill 独立组合与义务驱动编排
version: 3.1.0
parent_goal: complex-capability-construction-75411223
advances:
  - g1-meta-model-and-boundary
  - g4-component-evolution-blueprint
  - g6-change-unit-feature-pipeline-integration
  - g7-component-assembly-and-coverage-closure
  - g8-real-host-development-and-governance
relation: core
layer: governance
goal_requires:
  - component-blueprint-to-closure-mechanical-loop
  - conditional-design-obligations
goal_provides:
  - obligation-driven-composable-workflow
real_host_validation: >
  用集成 Maison 发布件的真实 App 宿主验证 RDB 修复、页面交互、仅设计、单独审查、
  单独测试及同蓝图不同 CU 的不同执行范围；同时验证项目知识维护。
  机械验收与真实宿主验收分开记录；材料未到位不得宣称语义闭环。
parallel_authority_added: false
overview: >
  复用既有蓝图、CU、Skill contract、workflow、assess 与 Goal runtime，把按 track 固定阶段
  推进改为按请求终点、未满足义务和有效事实生成执行范围，覆盖全部 Feature 与项目级阶段，
  保留真实输入、权责、证据和发布件集成边界，以七份分解 plan 渐进落地。
todos:
  - id: g1-normative-alignment
    content: >
      实施启动时建立 composable-workflow-foundation OpenSpec change，按本纲修订现行
      complex-capability-meta-model、workflow-tracks、skill-contracts、runtime-policy 等
      规范及父总纲 §8/§9 的固定阶段口径；保留正式需求蓝图准入与分层完成边界。
      本项只拥有跨 plan 的规范对齐，各子 plan 自己维护所辖行为 delta，不改历史归档。
    status: completed
  - id: g2-integration-review
    content: >
      七份子 plan 完成后按本纲 §10 的端到端矩阵复核接口拼接与责任覆盖；
      复用各 plan 最近有效测试和 P7 宿主报告，不再另跑一套重复验收；
      明确所有阶段覆盖、旧路径处置与未完成宿主项，按事实收口。
    status: pending
---

# 动态工作流总纲

> 编写日期：2026-09-10；基线：main / package.json.version=3.1.0。
> 本文件与七份子 plan 是待实施方案；计划文件已写出不代表运行能力已交付。
> 用户授权范围：编写总纲和完整分解计划。本轮不修改生产实现、既有定稿 plan 或父 goal 正文。
> 父目标：[复杂能力建设总纲](../goals/复杂能力建设目标_能力架构蓝图到部件演进与变更单元闭环_75411223.goal.md)。
> 需求来源：[动态阶段编排 R1–R8](../requirement/需求_按任务义务自动确定执行范围_动态阶段编排.md)。

## 1. 问题背景与历史设计

早期 [5ec9b7fe](framework-extensibility-refactor_5ec9b7fe.plan.md) 已要求裁剪、重排 Skill，
以 workflow YAML 替代硬编码 phase。它解决的是宿主选定流程的可配置性。
[d4a7c1e8](framework_轻量化重构_分档工作流与验证收敛_d4a7c1e8.plan.md) 将差异放到 Feature，
采用 lite/full 显式链；决策 19 为确定性禁止隐式推导。
[7c4e9a2b](skill契约化与调和循环_7c4e9a2b.plan.md) 进一步建立 Skill contract 与 assess，
要求实现独立、以产物接口协作，但 assess 仍对照既定 DAG/track 查缺口。

用户一直期望：每个 Skill 可单独完成其职责，Workflow 可以按任务灵活组合。
目前的具体断点是：蓝图已经按真实影响确定设计义务，CU 进入 Feature 后却仍套固定链。
“零设备义务的 RDB 改动被要求进入 testing”是首个现场症状，修复范围必须覆盖全部阶段。

2026-09-10 代码核对：

| 位置 | 当前事实 | 本次必须改变的关系 |
|---|---|---|
| workflows/spec-driven.workflow.yaml | full 六段，lite 三段；有全局阶段 | 预设顺序不能自动成为本次全部义务 |
| runtime-policy.ts / phase-transition-policy.ts | 按 track 拓扑与显式链校验，缺 required phase 报错 | 信息依赖可由合法输入满足；真实控制约束仍保留 |
| skills/feature/*/contract.yaml | 输入来源与 capability 已声明，适用性多由 track/UI 决定 | 由请求、义务与实际输入决定适用性 |
| spec-loader.ts | REQUIRED/OPTIONAL_FEATURE_FILES_BY_PHASE 是固定文件表，且被证据读取面复用 | 同步改产物要求与真实读取面，不能只删存在性门 |
| check-contract-consistency.ts | artifact 输入要求存在 DAG 可达 producer | 区分“可生成这种产物”和“本次必须执行生成者” |
| assess.ts | 先取 workflow/track 全阶段再检查 summary | 消费本次已确定范围 |
| goal-manifest.ts | 已有冻结 phase_chain、身份绑定与恢复机制 | 在现有 manifest 扩展范围，不新建 run 状态系统 |
| change-unit-completion.ts | 预期完成链仍按 workflow/track 重算 | 消费独立验证的执行范围及 CU 目标覆盖 |
| check-testing.ts | R8 已实现纯 unit TC BLOCKER 与设备前短路 | 保留，原需求的旧行号/旧 MINOR 描述仅作历史背景 |

现场原话与推断继续按需求文档区分；没有真实宿主 acceptance/test-plan/报告时，
不得补写“已核实事故全链”。本纲使用已核实的框架机制作为设计依据。

## 2. 最终目标与非目标

最终行为：

1. 用户说明目标及终点，系统按任务给出范围与理由；不要求选择 lite/full 或入口仪式。
2. 所有 Skill 可在满足真实输入与授权时独立调用，也能参与组合；单独完成不冒充整体完成。
3. 已有事实能够承接信息义务，不强制重跑其历史生产阶段，不生成占位计划或空报告。
4. 事实不完整时只补影响当前判断/执行的缺口；未知不当不存在，也不强迫全阶段先行施工。
5. 执行、建议、恢复、验证和完成使用同一有效范围；失败不能反向消除义务。
6. 设计已获准的不同 CU 可走不同内部流程；部件级组装义务仍由 Component closure 负责。
7. 保留输入验证、真实授权、回退重签、证据分层及发布件集成契约。

不建设通用图执行器、独立 AI 分类器、新插件加载器、跨 CU 状态中心、额外场外状态、
A/B 系统、每任务 workflow 文件或另一套证据账本。默认单 CU 并发不变。
不为本需求建设新 Service/Library lens；现有 unsupported 必须如实呈现。

## 3. 架构与职责

~~~mermaid
flowchart TB
  request[用户目标与授权终点] --> design[正式需求：部件蓝图]
  design --> cu[CU：当前切片与目标谓词]
  cu --> scope[执行范围解析：义务与有效事实]
  request -->|合法维护或专项操作| scope
  scope --> skill[按需 Skill 调用]
  skill --> check[Harness 与现有证据]
  check --> assess[assess：剩余缺口与下一动作]
  assess -->|继续或返修| skill
  assess -->|新设计事实| design
  assess -->|可信 CU 完成| outer[部件推进与组合闭环]
  outer -->|后继单元| cu
~~~

| 对象 | 权威内容 | 不承担 |
|---|---|---|
| 代码/schema/接口/测试 | 当前事实 | 未被授权的目标语义 |
| 蓝图 | 正式需求在部件内的目标态、共同决策、适用性与引用 | phase 执行状态 |
| CU | 当前施工切片、requires/provides、target_predicates、design_refs | 随意改蓝图或记录手工 done |
| Skill contract | 本职责的输入、结果、适用条件和验证接口 | 独立决定整项任务下一阶段 |
| workflow/runtime-policy | 能力组合规则、真实顺序与范围解析 | 复制蓝图设计或真实运行结果 |
| assess | 依据范围与证据派生资格、缺口和推荐 | 创造授权、每轮重新做语义规划 |
| driver/runtime | 使用授权上下文执行、停放、恢复、回退 | 重建一套阶段推荐规则 |
| completion/closure | 由范围、目标与证据判定完成 | 信任 Skill 自报完成 |

Skill 是可组合职责包，不要求一个 Skill 对应一个 Agent 或进程。
复用现有主 Agent、adapter、profile/provider。独立质询仍按既有隔离要求执行。
profile 决定如何编译/测试，adapter 决定如何调用宿主 AI，不能决定某项业务义务不存在。

保留两层编排：CU 间依赖与 ready set；CU 内 Skill 执行依赖。
Code Graph、蓝图关系、CU requires/provides、能力 provider 依赖、plan 治理标签不合并成万能图。

## 4. 全阶段覆盖与独立完成边界

| 能力/阶段 | 独立任务最小目标 | 组合时输入与触发 | 完成边界 |
|---|---|---|---|
| spec | 澄清指定行为与验收缺口 | 请求与获准设计切片、未满足验收义务 | 相关验收明确，不能声称实现完成 |
| plan | 决定指定施工问题 | 已明确行为、当前代码、获准设计；新接口/数据/顺序等缺口 | 当前设计可施工 |
| coding | 实现明确 delta | 目标、写集、不变量、必要契约与真实授权 | 实现及所需原生检查完成 |
| review | 审查指定代码/diff | 代码与审查范围；对照契约按本次审查目标适用 | 已请求审查覆盖与问题报告 |
| ut | 执行/补充指定单元证据 | 测试目标或有效验收、代码与 toolchain | 请求内测试与证据，不冒充全验收覆盖 |
| testing | 指定设备/集成/视觉验证 | 有效用例意图、可运行目标与设备义务 | 所需设备结果与真实证据 |
| change / exit | 旧 lite run 恢复 | 仅兼容旧出生记录；新任务职责迁入以上能力 | 旧闭环仍可读，新任务不走此轨 |
| init | 初始化或更新 Maison 集成 | 显式安装/更新目标、发布件、config/adapter | 集成可用，不连带 bootstrap 全工程 |
| catalog / glossary | 更新指定模块画像或术语 | 当前代码与知识/术语责任方 | 请求范围知识正确 |
| module-graph | 建立/刷新指定模块索引 | 当前事实及实际需要的模块上下文 | 索引与来源一致 |
| docs / extensions | 文档检查或扩展管理 | 目标路径/manifest/既有规则 | 相应检查或变更完成 |
| conventions / component-catalog | 策展指定知识/共享组件 | 既有知识与用户裁决边界 | 本次策展完成 |
| component-design | 新建设计、查看、质询或调和 | 正式需求与当前蓝图 | 局部操作或设计交接，按请求止步 |
| change-unit-progression / component-closure / goal-mode | 推进、闭环或运行协调 | 各自既有权威输入 | 保持项目/部件/CU 分层 |

project Skill 不必变成 Feature phase，目录/索引里没有的 Skill 不为表格对称而新增。
“全部覆盖”包含共享读写、辅助 CLI、verifier、hook 快照与输出消费者，不仅修改 SKILL.md。

## 5. 输入承接原则

详细结构由 P1 唯一维护，本纲冻结以下语义：

- 信息依赖：必须知道什么；格式依赖：工具必须读到什么结构；控制依赖：什么操作/裁决必须先发生。
- 前两者可由有效旧产物或合法等价内容满足；控制依赖只能由真实发生且仍有效的前置事实满足。
- sources 保留 artifact / derive 两种；通过静态已有 provider 集扩展具体来源，不新增自由文本表达式。
- resolved 必须携带可消费内容与真实来源；只有 refs 而解析不到验收/契约字段不得满足。
- absent 可尝试下一来源；invalid 不得被后备来源掩盖；显式新事实冲突先回责任方处理。
- 代码可证明现状或 characterization，不得自动变成用户期望、外部合同或获准设计。
- 确定性投影只能提取、转换、映射已明确内容；缺目标预期/错误语义/边界必须由责任 Skill 补齐。
- 缺失但本次必需的 capability 仍 blocked；可选缺失保留诚实降级；不适用与降级不混同。
- 省阶段不等于省掉必需机器契约。例如 CU contracts.change_unit 映射仍须完整，不能另造简化协议。

## 6. 义务与执行范围

详细结构、持久化与修订由 P2 唯一维护。基本区分：

| 维度 | 取值/来源 | 含义 |
|---|---|---|
| 适用性 | required / not_applicable / unknown | 本次是否存在责任 |
| 已有满足依据 | 输入绑定或有效证据引用，运行时核验 | 是否还要执行产生者 |
| 执行可用性 | 既有 profile/toolchain/设备结果 | 能否执行，不改变适用性 |
| 完成 | 既有 reports/events/evidence + 覆盖检查 | 不能靠范围记录里手填 satisfied |

执行范围冻结请求终点、义务、输入绑定与顺序，不冻结未来未知的事实。
spec 完成带来新验收时，只重新解析相关后继；范围需变时走现有 correction/backtrack/successor。
当前任务只要求讨论/审查/测试时，不自动扩展为完整 Feature。
新正式实现需求仍先走蓝图；“代码修复很小”不能成为绕过正式性判据的理由。

R1 至少覆盖：验收澄清、设计决策、实现、审查、单元证据、设备证据、视觉证据；
P6 补足项目级职责。用户显式只做 review/UT/testing 本身构成对应义务，
不要求本次一定有 coding diff。

零设备判定使用“有效验收内容”，允许等价蓝图投影通过同一分层校验，不强制物理 acceptance.yaml。
无蓝图的合法入口不强造蓝图/Code Graph；以对该范围足够的实际事实承接。
performance 项按是否真实需要设备证明判定；只有“含 performance”不能一律强制跑机。
这两点是对需求 R1/R7 字面歧义的明确收敛，P5 必须给正反例。

## 7. 存储、权威与恢复

不新增 execution-scope.json 或第二 run 目录。完整 Feature 交付统一使用真实 Goal 身份：

- feature.yaml.execution_scope 只保存运行前候选输入；它与阶段报告不能独立生成 Feature completion。
- completion_target=feature 在执行首个阶段前，交互方式也经现有 goal-mode-entry 的
  --prepare-run / attended attach 创建并使用 in-session Goal 身份；无人值守沿既有 detached 入口。
  manifest.execution_scope 是运行范围权威，phase_chain 为同值投影。
- run 出生可一次消费 Feature 候选；出生后只读 run 的冻结版本，不与候选双向同步。
  真实 phase_start、attempt、run_end、receipt 和原件落点契约继续由现有 runtime 产生并核验。
  adapter 缺所需 transport 时报告能力缺口，不能降成无 run 施工后自报 VALID completion。
  发现已有活跃 run，复用既有识别结果进入恢复。
- modern resume 不从当前 workflow/track 重算；有 runId 却 manifest 缺失/损坏时不得回退读 Feature。
- 新事实要求修订已冻结 run 时，按 P2 §6.1–6.3 的边界交接协议封卷、释放 owner/锁，
  再由同一 runtime 后继创建函数签发新范围；既有继承函数须显式支持允许改写的范围字段，
  不能仅改新起点。后继身份写入既有事件，普通“继续”沿该关系恢复；不原地修改 manifest。
- 不需要持久恢复的只读/project 单次任务只持有本次调用上下文和既有结果，不为此造 Feature。
- 历史记录不补写新的默认字段；旧协议 reader 保持旧语义，禁止将“旧字段缺失”解释为零义务。

无 Feature 的专项 review/UT/testing 使用 P6 §3.1 的真实 harness CLI 请求合同与独立报告目录，
只报告 request 结果，不创建虚假 Feature 或完成凭证。首次事实调查由 P1 §6.1 接管：
首个实际 Skill 的 Research/上下文收集步骤建立或承接 facts，不能固定要求先 spec/change。
候选输入、运行冻结与专项报告各守边界，同一次运行没有两个可写范围权威。

## 8. 计划分解、依赖与提交边界

| plan | 唯一负责 | 前置 |
|---|---|---|
| [P1 输入契约](动态工作流_P1_输入契约与事实承接_a6d3b8f1.plan.md) | 输入数据结构、来源解析、消费者注入、静态契约一致性 | 本纲规范对齐 |
| [P2 动态编排](动态工作流_P2_执行范围与运行时统一编排_b7e4c9a2.plan.md) | 义务规则、范围冻结、assess/driver、单任务完成范围与恢复 | P1 |
| [P3 需求设计](动态工作流_P3_需求设计与蓝图施工投影_c8f5d1b3.plan.md) | spec/plan/蓝图等价输入与施工投影 | P1；运行接线依赖 P2 |
| [P4 实现审查](动态工作流_P4_实现与审查独立闭环_d9a6e2c4.plan.md) | coding/review 独立运行、真实控制依赖与证据 | P1–P3、P6 专项 CLI 段 |
| [P5 UT/testing](动态工作流_P5_单元与设备验证按义务执行_e1b7f3d5.plan.md) | 单元/设备/视觉职责、R7 与 R8 兼容 | P1–P4、P6 专项 CLI 段 |
| [P6 项目与入口](动态工作流_P6_项目级能力与统一用户入口_f2c8a4e6.plan.md) | 全部项目级能力、用户意图入口、Skill 索引与 adapter 暴露 | P1/P2；全链联调依赖 P3–P5 |
| [P7 闭环迁移](动态工作流_P7_分层完成判定与兼容迁移及宿主验收_a3d9b5f7.plan.md) | CU/Component 聚合、在途兼容、公开切换与真实宿主验收 | P1–P6 |

每个子 plan 的 todos 是自己的唯一任务状态；总纲不复制子 plan 的 completed/pending。
本纲只拥有跨领域规范对齐与最终整合复核。

建议施工顺序：P1 → P2 → P3 → P6 专项 CLI/上下文段（§3.1–3.2）→ P4 → P5 → P6 其余 → P7。
P6 的该段只依赖 P1/P2，先交付入口与共享报告路径；P4/P5 负责各自 checker 接线，
P6 最后做完整 adapter smoke。不把入口推到消费者验收之后，避免互相等待。
P2 必须从第一批就具备与新范围相匹配的 completion/resume 机械闭环；
P7 不承担给前面补造完成模型。P5 完成后即可用候选发布件做首个 RDB 宿主实跑，
P7 的迁移清单和宿主资料准备可提前阅读执行，不等待最后才发现环境缺口。

中间提交可增加 reader、纯计算与夹具，但不得向用户暴露“动态已启用、checker 仍强制旧文件”的半成品。
schema 版本负责区分新旧协议，不加长期 feature flag、模式菜单或按阶段长期双栈。
新默认切换由 P7 在全部消费面连通后完成；旧 run 只保留窄兼容 reader。

## 9. OpenSpec、现行规范与历史

原需求与本批计划的追溯：

| 需求 | 主 owner | 必须协同的消费面 |
|---|---|---|
| R1 义务谓词表 | P2 | P1 输入有效性、P3/P5 行为与验证事实、P6 项目职责 |
| R2 统一入口 | P2/P6 | 蓝图工作单元之后的完整实现入口与独立调用入口 |
| R3 下游输入契约 | P1/P3 | P4/P5/P6 checker、真实控制依赖与必要机器投影 |
| R4 范围稳定复用与同源完成 | P2 | P7 CU/Component 与全部 verifier/报告消费者 |
| R5 新事实局部修订 | P2 | P3 设计责任、P4 实现发现、P5 验证反例 |
| R6 用户呈现与 change-lite 退役 | P6/P7 | 索引、adapter、确认点、旧 run 兼容 |
| R7 零设备义务不进 testing | P5 | P2 范围与完成、P3 验收投影、P7 宿主验证 |
| R8 设备前纯 unit TC 护栏 | P5 | 既有 main 实现回归，不重复立项重写 |

需求 §9 的六个开放问题在本批已给出方案：末段不是完成标准（P2/P7）；
语义判断由已有 AI 阅读形成、程序检查可确定事实（P2）；合法无蓝图入口不补造蓝图（P6）；
track 仅保留旧协议兼容（P7）；Feature 与 run 按执行上下文选择唯一权威（§7/P2）；
在途任务依出生协议恢复、新任务使用动态范围（P7）。实施中若有具体反例推翻这些方案，
先记录反例及受影响合同，再修订计划，不能静默在代码内建立另一种语义。

实施时按所属 plan 创建小型 OpenSpec change，参见各 plan 建议名。
现行 specs 通过 delta 修订；归档 change、历史已完成 plan 不作为新行为 SSOT，也不重写。
父总纲与 docs/overview 的权责原则不变；父总纲里固定六阶段和无条件 plan 产物措辞，
在总纲 g1 中明确调整为“适用义务与施工投影”，不能让新实现违背仍生效的正文。

旧 track、必需文件表、phase DAG 规则的处置必须逐项区分：
仍适用的真实约束保留；新协议中已被收编的逻辑删除；旧协议读取需要的逻辑缩到兼容边界。
禁止一边保留旧权威，一边添加一套“更灵活”的旁路。

## 10. 端到端验收矩阵

| 场景 | 关键结果 | owner |
|---|---|---|
| 已有有效验收与设计的纯逻辑修复 | coding/review/ut；无空 spec/plan/testing 产物 | P3/P4/P5 |
| 正式新行为但验收缺口 | 蓝图准入后调用 spec，后继未知局部补足 | P2/P3 |
| coding 发现需改公共接口 | 回责任设计阶段；新范围重签；未受影响事实可复用 | P2/P3/P4 |
| 只 review 现有代码 | 独立报告，不启动 coding，不生成 Feature completion | P4 |
| 只运行指定 UT | 不强造完整 acceptance，不冒充全部验收覆盖 | P5 |
| 有设备义务而无 spec 阶段 | testing 从合法承接内容追溯并完成 | P1/P3/P5 |
| 单元层 AC/BD 且无设备 NFR/行为影响 | ut 末段；reconcile-only 不要求 trace | P5 |
| 验收分层缺失/来源无效 | unknown/blocked，先补依据，零误裁剪 | P1/P2/P5 |
| performance 可由单元基准证明 | 可不进设备测试；真实性能真机项仍进入 | P5 |
| testing 失败/设备离线/manual | 范围不缩减，不洗成 N/A 或 PASS | P2/P5 |
| 同蓝图两个 CU：内部修复与页面交互 | 各自范围不同；真实组装义务仍被检查 | P7 |
| 仅设计、查看蓝图、更新 catalog/Graph | 在请求终点结束，不创建不必要 CU/run | P6 |
| 旧 lite/full 活跃 run 与新请求并存 | 旧协议恢复，新任务动态；不跨 run 借假完成 | P7 |
| 当前配置/模型改变后恢复 | 沿冻结范围，不重新选阶段 | P2/P7 |
| 交互完整交付 coding→review→ut | 真实 in-session run 血缘，completion VALID，CU 正常消费 | P2/P7 |
| 新 Feature 无 facts 且直接 coding | coding 前建立真实 facts，不回补 spec/change | P1/P4 |
| spec 后才确定设备义务 | 前驱封卷释放锁、后继自动启动，恢复不重复创建/执行 | P2/P7 |
| 无 Feature 的 review/UT CLI | 明确目标/基线/报告落点，同一 checker，零活跃 Feature 证据写入 | P6/P4/P5 |
| fork workflow 或 extension 增加职责 | 声明可解析；未知职责不默认为可跳过 | P1/P2/P6 |

## 11. 验证与收口纪律

计划编写只运行 node scripts/check-plan-version.mjs、相关 Markdown/链接/LF 检查；
不为文档新增运行单测。实施涉及发布内容时按仓规运行 cd harness && npm test（含 typecheck）。
现行 OpenSpec 变化运行 npm run openspec:validate。只改 plan 状态的后续轮次只做 plan 校验。
真实发布才执行发布门；不因写计划运行 release:all，也不提前安装到宿主。

测试优先覆盖真实数据流：完整/缺失/非法来源、等价投影、独立调用、组合闭环、
新事实回退、失败不裁剪、恢复与旧协议。不得只断言 implementation 返回自身常量。
宿主验收直接验证结果、调用过的阶段、未产生的占位材料和未调用的设备，
不要求全新追踪平台或 A/B；复用现有报告与 events 即可。

## 12. 外部实践与本项目取舍

- [Anthropic：Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)：
  使用简单可组合流程，在需要时引入动态分解；本项目采用 AI 理解任务、脚本处理确定规则。
- [Anthropic：Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)
  与 [OpenAI：Skills](https://developers.openai.com/codex/skills)：按需加载职责与资源，
  支持同一 Agent 组合多个 Skill；不要求每个 Skill 启动一个进程。
- [OpenAI：Orchestration and handoffs](https://developers.openai.com/api/docs/guides/agents/orchestration)：
  明确协调者与专家的控制权；Maison 复用既有主 Agent/assess/driver 分工。
- [Anthropic：Managed Agents](https://www.anthropic.com/engineering/managed-agents)：
  会话事实、harness 与执行环境分责；借鉴边界，不迁入云托管平台或替换当前 adapter。

以上是架构依据，不是两家公司为 Maison 提供的现成义务协议，也不构成新依赖引入理由。

## 13. 父目标对齐七问

推进 G1/G4/G6/G7/G8；责任位于设计到单元执行与分层闭环的接合处。
输入真源和输出消费者见 §3；新增内容仅进入既有 contract/workflow/feature/manifest，
不建状态中心或索引。来源引用、运行冻结和派生完成分责避免双真值。
真实宿主依据见 §10。若某项拟增机制不能解决现存输入耦合、错误推进或完成遗漏，
删除该机制；不得以“审计更完美”为理由继续扩张总纲。
