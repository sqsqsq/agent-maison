# complex-capability-meta-model Specification

## Purpose
TBD - created by archiving change complex-capability-meta-model. Update Purpose after archive.
## Requirements
### Requirement: Parent-goal declaration validation

声明了 `parent_goal` 的 plan MUST 通过以下全部校验，任一失败即 `check-plan-version`
FAIL（default 与 release 模式同判）：

- 机器声明位置唯一：以上字段 MUST 位于 plan 的 YAML frontmatter；正文提及不构成声明、
  也不触发校验（总纲 §12 已同步裁定；实测 android plan 正文含该字段字样即为反例）；
- `parent_goal` MUST 唯一匹配一份 `.cursor/goals/*.goal.md`（frontmatter `id` 精确相等）；
  零份或多份匹配均 FAIL；
- `advances` MUST 为非空 block-list（`- item` 逐行），且每项属于该 goal 文件 §0.1 目标表
  **第一列**声明的目标 id 集——仅从表格行首列反引号 id 提取，MUST NOT 扫描全文（其它
  章节偶现的反引号 id 不得进入合法集）；表格定位失败或提取为空 MUST 报错（fail-closed）；
- `relation` ∈ {knowledge-provider, app-asset-provider, verification-provider,
  execution-trust-foundation, core}；
- `layer` ∈ {knowledge, capability-handoff, component-blueprint, change-unit,
  closure, governance}；
- `real_host_validation` MUST 为非空文本；使用 YAML 折叠/字面块（`>`/`|`）时 MUST 读取
  实际缩进正文判空，块符号本身不算内容；
- `parallel_authority_added` MUST 为 `false`——总纲 §15 不新建并行运行权威；放开须先
  修订总纲并同步本 spec；
- `goal_requires` 与 `goal_provides` MUST 显式存在：取值为行内空数组 `[]` 或非空
  block-list；条目 MUST 匹配 `^[a-z0-9]+(?:[.-][a-z0-9]+)*$`（允许版本点号，如
  `stable-3.0.0-release-baseline`）；仅做格式校验，不建注册表、不对账闭合。

八个字段均为必填：声明了 `parent_goal` 但缺失其余任一字段 MUST 按字段级诊断报错，
不做静默半校验。校验 MUST 不受版本窗口影响：`version > current` 的顺延 plan 与
allowlist plan 同样受检——实现上校验 MUST 位于扫描器 future/allowlist 提前返回之前。

#### Scenario: 合法声明通过

- **WHEN** plan 携带完整合法声明（如总计划 6f2a9d8c：parent_goal 指向 75411223 总纲、
  advances 均为 G1–G8 合法 id、relation=core、layer=governance、parallel_authority_added=false）
- **THEN** `check-plan-version` 对该 plan 的声明校验通过，无新增告警

#### Scenario: advances 含非法目标 id

- **WHEN** plan 的 advances block-list 中含 `g9-not-exist`
- **THEN** 校验 FAIL，诊断指出文件、字段 `advances` 与非法值，并列出合法 id 来源
  （goal 文件 §0.1 表格）

#### Scenario: 半声明按缺失字段报错

- **WHEN** plan 声明了 `parent_goal` 但缺 `relation`、`real_host_validation` 与
  `goal_requires`
- **THEN** 校验 FAIL，诊断逐字段列出缺失项（`goal_requires` 缺省同样计缺失，须显式 `[]`）

#### Scenario: 顺延 plan 的非法声明不得假绿

- **WHEN** 某 plan 为 `version: 3.2.0` + `deferred_to: 3.2.0`（当前窗口 3.1.0），其声明
  含非法 advances
- **THEN** default 与 release 模式均 FAIL——future plan 的提前返回不得跳过声明校验

> **Enforced by:** `scripts/check-plan-version.mjs`, `scripts/plan-version-lib.mjs`,
> `scripts/tests/check-parent-goal.unit.mjs`

### Requirement: Non-declaring plans keep zero behavior change

未声明 `parent_goal` 的 plan MUST 完全跳过父目标声明校验：不新增任何告警或失败；
legacy allowlist 与 `version`/`deferred_to` 既有语义不变。不强制所有 plan 挂靠总纲。

#### Scenario: 存量 plan 零新增告警

- **WHEN** 对全仓现存未声明 `parent_goal` 的 plan 运行 `check-plan-version`（含 release 模式）
- **THEN** 相对本 change 落地前，输出零新增 hit

> **Enforced by:** `scripts/check-plan-version.mjs`（未声明即跳过分支）,
> `scripts/tests/check-parent-goal.unit.mjs`

### Requirement: Advances are traceability, not progress

`advances` MUST 解释为非累加的追溯标签：统筹 plan 与子 plan 同时指向同一目标域不构成
重复进度；目标域（Gx）是否完成由具体子 plan 状态、OpenSpec 验收与真实宿主证据共同证明。
任何工具 MUST NOT 以 advances 计数生成目标完成度或进度报表；引入此类聚合 MUST 先修订
本 spec。

#### Scenario: 双 plan 指向同一目标域

- **WHEN** 总计划与某核心子 plan 均在 advances block-list 中声明
  `g4-component-evolution-blueprint`
- **THEN** 两者均通过声明校验，且仓库内不存在任何把 g4 记作"两份进度"的机制（扫描器
  不提供 advances 计数接口）

> **Enforced by:** `scripts/check-plan-version.mjs`（不提供任何计数/聚合接口），
> review 纪律见 `AGENTS.md` 父目标对齐声明收编节

### Requirement: Meta-model object identities and reference directions

三类对象 MUST 保持以下身份与单向引用边界，P1/P2/P3 的实现 change 以此为准入约束，
违反即 openspec review FAIL：

- **部件演进蓝图**承载**一项正式需求在当前部件内的目标态与共同决策**：MUST NOT 冒充当前
  事实真源，MUST NOT 拥有 phase 运行裁决权；当前态断言 MUST 引用代码/schema/接口/测试等
  事实来源；
- **Change Unit**：凡属某部件蓝图分解产物的单元 MUST 引用恰好一份所属蓝图，只消费显式
  `requires`、只声明显式 `provides`；**非正式维护动作**（不改变部件行为、外部契约、数据/
  NFR、运行语义或架构责任的纯文档与机械维护）MUST NOT 被要求建立蓝图或 canonical CU，它
  继续走既有轻量 Feature 路径；**存量平铺 Feature**（无 `change_unit_ref`）MUST 保持既有
  行为，MUST NOT 被自动迁移、自动转为 CU 或自动 credit completion；上述两类单元在显式归属
  某份蓝图前 MUST NOT 参与任何 Component closure 聚合；
- **Component closure** MUST 由蓝图、单元契约与既有执行完成事实（events/receipt/
  evidence）派生，MUST NOT 引入可手改完成台账或第二恢复权威；单元数量为 1 时，closure
  MUST 退化为"需求 → 蓝图稳定地址 → CU `design_refs` → 完成证据"的追溯核对，跨单元组装边
  为空集 MUST 视为合法结论而非缺项，MUST NOT 因此新增第二套 mapping schema 或第二次验收；
- 引用方向单向：CU→蓝图、closure→（蓝图+CU+完成事实）；蓝图 MUST NOT 反向依赖单元
  运行时状态。

#### Scenario: 孤儿单元不得进入部件闭环

- **WHEN** P2/P3 的实现允许一个无蓝图引用的单元参与某部件的闭环聚合
- **THEN** 该 change 违反本契约，openspec review MUST 拒绝

#### Scenario: 存量平铺 Feature 不被自动 credit

- **WHEN** 某实现把无 `change_unit_ref` 的既有平铺 Feature 自动登记为某蓝图的 CU，或把它的
  completion 计入该部件 closure 覆盖行
- **THEN** 该 change 违反本契约，openspec review MUST 拒绝；存量只能作为当前事实来源被蓝图
  消费，显式归属必须由人/设计者裁决并写出 canonical CU

#### Scenario: 单 CU 闭环不产生第二套协议

- **WHEN** 某蓝图只分解出一个 Change Unit，其 closure 需要评估
- **THEN** 实现 MUST 复用同一 closure 算法并把跨单元组装边判为空集通过，MUST NOT 引入单 CU
  专用的 mapping schema、专用状态或第二次验收入口

> **Enforced by:** 本 capability spec 作为 P1/P2/P3 change 的准入约束（review 门），
> 运行时 enforcement 随 P1/P2/P3 各自的实现 change 落地并回填引用

### Requirement: Dual entry semantics

**统一正式需求入口（2026-08-29 修订）**：每一项**正式需求** MUST 经过部件演进蓝图这一部件
内设计阶段；蓝图 MUST NOT 被定义为"复杂多单元需求才启用的可选路线"。上游输入 MUST 支持
两种形态，且两者 MUST 是同一入口的两种输入而不是两条路线：

- **本部件直供**：直接从原始需求、当前事实与人工提供的外部约束建立蓝图，MUST NOT 以"能力
  架构蓝图缺失 / G2 未建设"为由阻塞；
- **跨部件投影**：MUST 只消费人工或上游提供的投影引用——Maison MUST NOT 重新裁决其它部件
  的架构，MUST NOT 由 AI 补造缺失的外部契约（缺失时 MUST 落 open decision 或带责任方的
  blocker）。

蓝图协议 MUST 唯一：MUST NOT 引入 compact/full 档位、蓝图类型字段、升级信号或升级状态机；
内容深度 MUST 由本次演进的真实影响面派生（见「Conditional design obligations」）。

#### Scenario: 外部契约缺失不得补造

- **WHEN** 建立蓝图时 SE 尚未提供云侧同步契约
- **THEN** 蓝图对应条目为 open_decision/blocker 并标注责任方与解除条件，不出现 AI
  生成的契约内容

#### Scenario: 小型正式需求不得绕过蓝图

- **WHEN** 一项正式需求预计只需要一个 Change Unit
- **THEN** 它仍 MUST 先经过蓝图（薄蓝图 → 1 个 CU），MUST NOT 直接进入 spec/plan 或
  change-lite 施工；实现 MUST NOT 提供"小需求跳过蓝图"的合法路径

#### Scenario: 提议为蓝图新增档位被拒绝

- **WHEN** 某 change 提出为蓝图新增 compact/full 档位、蓝图类型字段或从薄到全的升级状态机
- **THEN** 该 change 违反本契约，openspec review MUST 拒绝——深度伸缩只能由条件式设计义务
  表达

> **Enforced by:** 本 capability spec 作为 P1 change（蓝图建立与调和）与
> `/component-design` 编排入口的准入约束，运行时 enforcement 随 P1 落地并回填引用

### Requirement: Authority boundaries and failure semantics

五类信息的权威位置唯一，任何新对象 MUST NOT 复制其为第二真源：当前实现=代码/schema/
接口/配置/测试；目标态与共同决策=部件演进蓝图；单元施工要求=spec/plan/contracts；
运行与完成事实=events/reducer/receipt/evidence；稳定工程知识=architecture/catalog/
conventions/长期 spec/scenarios/ADR。

证据不足 MUST 显式表达为 `unknown`/`open_decision`，MUST NOT 以貌似完整的结构掩盖
证据缺口；元模型对象的读取方对非法输入 MUST 显式失败（fail-closed），对声明为 unknown
的字段 MUST 原样保留，MUST NOT 擅自补全。

#### Scenario: 文档宣称与代码事实冲突

- **WHEN** 蓝图当前态断言与代码事实不一致
- **THEN** 以代码事实优先并显式报告冲突，不静默采信文档宣称

> **Enforced by:** 本 capability spec 作为 P1/P2/P3 change 的准入约束；声明面
> fail-closed 先例见 `scripts/check-plan-version.mjs`（goal 定位失败即报错）

### Requirement: Capability seams are three-role contracts

一个完整的能力接缝 MUST 同时定义三个角色：Service Definition（输入输出契约）、Provider
（实现）、Consumer（消费方）；只有一个角色 MUST NOT 宣称为接缝。每个接缝 MUST 以
Seam Card 记入其所属 capability spec，字段为：接缝名称 / Definition / Consumer /
Provider / required|optional / 缺失行为 / 替换与退出行为 / 权威、来源与冲突规则。
MUST NOT 为接缝新增独立文件类型或全局 manifest。

#### Scenario: 单角色不成接缝

- **WHEN** P1 引入一个设计透镜实现，但未声明其 Definition 契约与 Consumer
- **THEN** 该 change 违反本契约，openspec review MUST 拒绝

> **Enforced by:** 本 capability spec 作为 P1/P2/P3 change 的准入约束（review 门）；
> Seam Card 落位随各接缝的 capability spec

### Requirement: Provider lifecycle semantics

- required provider 缺失 MUST 形成带责任方与解除条件的结构化 blocker；
- optional provider 缺失 MUST 诚实降级或标 unknown，MUST NOT 静默按存在处理或自动 PASS；
- 权威型 provider 在同一接缝重复注册 MUST fail-closed 直接失败；允许多来源合并的接缝
  MUST 声明确定性调和规则，MUST NOT silent last-write-wins；
- provider 退出 MUST 按四类行为处置：注册/临时监听/派生缓存→完全清理；派生报告与
  ready set 等投影→失效并重新派生；蓝图/CU/决策/证据等正式产物→保留并标注来源、必要时
  标 stale/unknown、MUST NOT 静默删除；已合入代码/迁移/外部副作用→rollback/revert/补偿，
  不承诺精确复原；
- 任何 provider MUST NOT 直接修改 Goal Mode 完成事实（events/receipt/evidence）。

#### Scenario: optional 验证 provider 缺失不得假 PASS

- **WHEN** 视觉验证 provider 因宿主条件不具备而缺失，某 Change Unit 进入闭环聚合
- **THEN** 闭环结果呈现该维度的诚实降级/unknown，不得将缺失呈现为通过

#### Scenario: 权威 provider 冲突确定性失败

- **WHEN** 同一接缝出现两个权威型 provider（如两份互相矛盾的外部契约输入）
- **THEN** 消费方确定性失败并报告冲突双方，不得按注册顺序静默取后者

> **Enforced by:** 本 capability spec 作为 P1/P2/P3 change 的准入约束；机械断言由总计划
> M5 接缝断言五项承载（fixture 层）

### Requirement: Three dependency namespaces stay separate

三个依赖命名空间 MUST 保持独立：`goal_requires/goal_provides`（plan 对总纲的治理追溯）、
Change Unit 的 `requires/provides`（施工依赖）、capability seam 的依赖（provider 绑定与
消费）；三者 MUST NOT 合并为同一工作图、注册表或 schema，任何工具 MUST NOT 跨命名空间
推导依赖。

#### Scenario: 跨命名空间合图被拒绝

- **WHEN** 某 change 把 seam 依赖并入 CU `requires` 生成统一依赖 DAG
- **THEN** 该 change 违反本契约，openspec review MUST 拒绝

> **Enforced by:** 本 capability spec 作为后续 change 的准入约束；扫描器仅消费
> `goal_requires/goal_provides` 的格式面（见 Parent-goal declaration validation）

### Requirement: Host evolution seams are blueprint outputs, separate from Maison seams

宿主演进接缝 MUST 与 Maison 能力接缝保持两层分离：前者是蓝图为**宿主代码**设计的
稳定契约 / Provider / Consumer 边界，位于宿主代码内部，MUST NOT 进入 Maison 的
provider 注册面或三个依赖命名空间中的任何一个。部件演进蓝图 MUST 把"变化轴与演进
接缝决策"作为固定组成部分：**实质候选**（存在可追溯变化证据、且对边界/风险/测试/
生命周期/后续成本有实质影响）MUST 有决策卡（含"暂不建缝时的再提取条件"）；普通实现
差异 MUST NOT 逐项登记。接缝化 MUST 满足门槛之一（多真实实现或已知将增、外部系统/
设备/OS 边界、策略频变、须 fake/mock 才可测、需故障隔离/降级/灰度、独立发布或权限
边界）——门槛是进入评审的必要条件而非自动建缝；无门槛证据 MUST 保持直接实现。

获批接缝的**首次落地** MUST 为一个纵切单元（稳定契约 + 首个真实 Provider + 真实
Consumer + 契约测试），后续 Provider MAY 各自成为独立单元；MUST NOT 以空接口横向
单元形式存在。部件闭环 MUST 能机械验证：新增或替换 Provider 时稳定契约与既有
Consumer 保持不变——契约或 Consumer 必须变化时 MUST 触发蓝图调和、契约版本化或
迁移裁决，MUST NOT 作为替换混入；Provider 缺失或失败的行为 MUST 符合蓝图的显式
裁决（降级、禁用、阻塞、fail-closed 四者之一），MUST NOT 静默成功或假 PASS；
Consumer MUST NOT 绕过接缝直接依赖具体实现，且绕过 MUST 可被发现并定位。实现形态
平台中立，MUST NOT 预设动态加载或特定打包机制。

#### Scenario: 无证据抽象被拒绝

- **WHEN** AI 提出的候选不满足任何接缝化门槛（无可追溯变化证据），却被建为演进接缝
- **THEN** 该候选在进入决策卡前被驳回，保持直接实现——不进卡，也不要求记录再提取条件
  （"再提取条件"仅适用于已具备实质证据、进入评审后被人裁决暂不建缝的候选）

#### Scenario: Consumer 绕过接缝被闭环抓住

- **WHEN** 某 Consumer 绕过稳定契约直接依赖具体 Provider 实现
- **THEN** 部件闭环的绕过检查 FAIL 并定位到具体依赖

> **Enforced by:** 本 capability spec 作为 P1/P2/P3 change 的准入约束（蓝图协议 /
> CU 落地模式 / 闭环验证义务）；机械证明由总计划 M5"宿主演进接缝 fixture"承载

### Requirement: Formal requirement determination is a stated contract, not a machine score

入口 MUST 按以下唯一 SSOT 文案判定一项事项是否为正式需求：

> 有明确交付或验收责任，且拟改变部件行为、外部契约、数据/NFR、运行语义或架构责任的事项，
> 按正式需求处理；不改变这些语义的纯文档和机械维护除外。

判定 MUST 遵守三条纪律：

1. **上游权威**：上游（产品/SE/组织流程）显式把事项标为正式需求时，该分类 MUST 具有权威
   性，Maison MUST NOT 用自己的启发式把它降级为非正式维护动作；
2. **信息不足由人确认**：入口信息不足以判定时 MUST 询问人并等待确认，MUST NOT 猜测、
   MUST NOT 默认按任一侧处理；
3. **不新增机器门**：MUST NOT 为正式性判定新增 `track_scoring` 条目、新档位或机器
   BLOCKER；判定结果 MUST NOT 成为可手改的持久状态字段。

**兜底双入口**：`/spec` 与 `/change-lite` 在首次冻结施工意图处 MUST 各自识别"事项符合正式
需求判据却未经蓝图"的情形，指出应先经 `/component-design` 并给出回退入口。兜底 MUST NOT
只放在 spec 阶段（lite 轨没有 spec），MUST NOT 实现为阻断式机器门。

#### Scenario: 上游显式分类具有权威性

- **WHEN** 上游把一项事项显式标为正式需求，而本地启发式认为它只是文案调整
- **THEN** 该事项 MUST 按正式需求处理并进入蓝图入口，不得被本地判断降级

#### Scenario: 入口信息不足时询问而非猜测

- **WHEN** 事项描述不足以判断它是否改变部件行为、外部契约、数据/NFR、运行语义或架构责任
- **THEN** 入口 MUST 向人提出判定问题并等待确认，MUST NOT 自行择一继续

#### Scenario: lite 轨兜底不依赖 spec

- **WHEN** 一项符合正式需求判据的事项被直接带入 `/change-lite`
- **THEN** `/change-lite` 在首次冻结施工意图处 MUST 指出应先经 `/component-design` 并给出
  回退入口；MUST NOT 因为 lite 轨没有 spec 阶段而失去兜底

#### Scenario: 正式性判定不得变成机器档位

- **WHEN** 某 change 为正式性判定新增 `track_scoring` 评分项或阻断式 BLOCKER
- **THEN** 该 change 违反本契约，openspec review MUST 拒绝

> **Enforced by:** 本 capability spec 作为 `/component-design`、`/spec`、`/change-lite`
> 与 `templates/AGENTS.md.template` §4.0 路由的准入约束；话术落点由 t4 的发布件改动承载

### Requirement: Conditional design obligations replace entry gates

蓝图的内容深度 MUST 由**条件式设计义务**表达：义务 MUST 只在对应事实**被发现**时触发，
MUST NOT 作为进入蓝图的前置判据（三条 AND 入口门语义作废）：

- **发现多个 CU** → MUST 完成 CU 边界与关系分析（真实依赖、共享资源、可并行性、独立性）。
  只有事实要求时才生成 `requires` 与顺序约束；MUST NOT 为记录先后而伪造依赖边——优先级
  只用于选择，实际串行执行产生的先后只属于执行轨迹（与既有"允许顺序 vs 实际执行顺序"裁决
  一致）；
- **发现共享部件级设计决策** → 该决策 MUST 只在蓝图裁决一次，各 CU MUST 经 `design_refs`
  消费；MUST NOT 在多个 Feature plan 内各裁一次；
- **发现"单独绿 ≠ 整体完成"** → Component closure MUST 追加真实组装与组合证据义务；
- **安全中间态** 是单 CU 与多 CU 的**通用**义务（CU 契约既有 `safe_intermediate_state`），
  MUST NOT 挂在"≥2 CU"条件下。

未触发的义务 MUST 表达为空集/不适用的合法结论，MUST NOT 以空章节、占位节点或 `unknown`
凑齐形式。

#### Scenario: 单 CU 蓝图不因缺少依赖分析而失败

- **WHEN** 一项正式需求只分解出一个 Change Unit
- **THEN** CU 边界与关系分析义务未触发，`requires` 为空集 MUST 合法；安全中间态义务仍
  MUST 生效

#### Scenario: 为记录先后伪造依赖边被拒绝

- **WHEN** 两个 CU 之间不存在真实依赖、共享资源冲突或迁移 barrier，却被写入 `requires`
  以记录期望的执行先后
- **THEN** 该依赖边 MUST 被判为伪造并失败；顺序意图只能进入优先级与执行轨迹

#### Scenario: 共享决策只在蓝图裁决一次

- **WHEN** 多个 CU 都依赖同一个部件级设计决策（数据真源、状态 owner、外部契约或迁移顺序）
- **THEN** 该决策 MUST 在蓝图内裁决一次并由各 CU 经 `design_refs` 引用；任一 CU 的 plan
  重新裁决同一决策 MUST 失败

> **Enforced by:** 本 capability spec 作为 P1（蓝图协议）、P2（CU 依赖与设计可施工门）与
> P3（组合证据）实现 change 的准入约束

### Requirement: View applicability and evolution impact stay orthogonal

设计视图的两个维度 MUST 正交建模，MUST NOT 合并为一个枚举：

- `applicability`（**部件类型固有适用性**）MUST 保持二值 `applicable | not_applicable`；
- `evolution_impact`（**本次演进影响**）MUST 是独立字段，取值 `changed | verified_unchanged`，
  且 MUST 只由 `applicable` 视图携带。

蓝图 MUST 至少有一个 `applicable` + `changed` 视图；零 `changed` 视图即"本次不是演进"，
MUST fail-closed。`verified_unchanged` MUST 携带事实依据（证据引用与当前态引用），据此免除
target/delta 与可寻址节点义务；MUST NOT 用它掩盖真实变更。

任何把两个维度合并为三态枚举（如 `applicable | changed | not_applicable`）的方案 MUST 被
拒绝：既有消费者按字面 `applicability !== 'applicable'` 跳过视图，三态替换会让 `changed`
视图被**静默跳过**。因此本约束的实现 MUST 同步接线 schema **与**全部消费面（质询 scope 派生、
closure 义务派生、fixture），MUST NOT 只改 schema。

#### Scenario: 零 changed 视图 fail-closed

- **WHEN** 某蓝图的全部 applicable 视图都标为 `verified_unchanged`
- **THEN** 校验 MUST 失败——本次不构成演进，MUST NOT 生成 admitted 蓝图

#### Scenario: verified_unchanged 缺证据被拒绝

- **WHEN** 某 applicable 视图标为 `verified_unchanged` 却没有事实依据引用
- **THEN** 校验 MUST 失败，MUST NOT 因"未变更"而免除举证

#### Scenario: 三态合并枚举被拒绝

- **WHEN** 某 change 提出用单一三态枚举同时表达固有适用性与本次演进影响
- **THEN** 该 change 违反本契约，openspec review MUST 拒绝

> **Enforced by:** 本 capability spec 作为 P1 change 的准入约束；运行时 enforcement 由
> `harness/schemas/app-component-blueprint.schema.json`、
> `harness/scripts/utils/blueprint-views.ts`、`harness/scripts/utils/blueprint-questioning.ts`、
> `harness/scripts/utils/component-closure-obligations.ts` 承载

### Requirement: Story-class host seams stay three separate directional contracts

正式需求统一入口后，Maison 与宿主之间的三条静态接缝 MUST 各自独立建模，方向与 owner
MUST NOT 合并：

| 接缝 | 方向 | required/optional | 缺失/冲突行为 |
|---|---|---|---|
| `requirement-source-materialization` | 宿主 → Maison | 来源为宿主/外部 provider 时 required | 缺失 = 结构化 blocker；来源 hash 冲突 fail-closed |
| `blueprint-review-publication` | Maison → 宿主 | optional | 缺失 = 诚实降级 |
| `blueprint-review-feedback` | 宿主 → Maison | optional | authority 不足只能记为意见/建议 |

- `requirement-source-materialization`：宿主负责获取/脱敏/物化来源材料；Maison MUST 只消费
  **项目内可解析**的 `source_ref`、原始字节 sha256、provenance 与 authority。Maison MUST NOT
  知道内网标识、token、URL 或归档 API。

  **口径统一（单一判据）**：每项正式需求最终 MUST 形成至少一个合法 `currentScopeItem`。达成
  方式有两条，两条都合法且产出同一形状：来源来自**宿主/外部 provider** 时 MUST 走
  `requirement-source-materialization@1` 文件接缝；**直接人工、inline 或本地文件**输入时由
  blueprint builder 直接规范化为同一 `currentScopeItem`，MUST NOT 强制额外制造一份 provider
  manifest。无论哪条路径，MUST NOT 无来源、凭模型转述生成 scope item。
- `blueprint-review-publication`：输出**指定 admitted blueprint revision** 的评审投影，供宿主
  装配 Story Document / 归档件。投影 `derived_from` MUST 精确指向该 revision，内容 MUST 零新
  设计事实；宿主可在其后附加 CU/spec 等施工附件，但附件 MUST NOT 成为部件内设计的事实来源。
- `blueprint-review-feedback`：结构化评审反馈 MUST 区分**意见 / 事实补充 / 建议 / 授权裁决**
  四类。只有同时具备 authority、source revision 与明确决策语义的反馈才 MAY 进入
  `decided_with_authority`；合法反馈 MUST 经既有 reconciliation 生成**新** revision，
  MUST NOT 回写旧 revision。

publication 与 feedback 方向相反、owner 不同，MUST NOT 合并为一张 Seam Card；评审投影
renderer MUST NOT 兼任 feedback provider。

#### Scenario: publication 与 feedback 合卡被拒绝

- **WHEN** 某 change 用一张 Seam Card 同时表达"输出评审投影"与"接收评审反馈"
- **THEN** 该 change 违反本契约，openspec review MUST 拒绝

#### Scenario: authority 不足的反馈不得成为设计权威

- **WHEN** 一条评审反馈没有 authority、缺 source revision 或没有明确决策语义
- **THEN** 它 MUST 只能作为意见/建议记录，MUST NOT 进入 `decided_with_authority`，
  MUST NOT 触发 revision 递进

#### Scenario: 授权反馈生成新 revision 而非回写

- **WHEN** 一条带 authority、source revision 与明确决策语义的反馈被接受
- **THEN** 调和 MUST 生成新的蓝图 revision 并按既有规则把受影响派生结论标 stale；
  MUST NOT 原地修改被引用的旧 revision

#### Scenario: 投影试图新增设计事实被拒绝

- **WHEN** 评审投影包含 canonical 蓝图中不存在的设计事实
- **THEN** 投影校验 MUST 失败；宿主附件 MUST NOT 被当作部件内设计的事实来源

> **Enforced by:** 本 capability spec 作为 P1 change 三张接缝 Seam Card 的准入约束；
> 发布态机器契约与校验入口由 P1 change 与发布件内 schema/checker 承载

### Requirement: Design lens coverage is declared honestly per component type

部件内设计阶段 MUST 只对**已具备 design lens** 的部件类型给出设计交付。当前 MUST 只声明
`hmos-app` / App component profile 具备 design lens；对缺少 lens 的 component type，入口
MUST 返回明确的 unsupported / missing design lens 失败，MUST NOT 把 Service、Library 等
类型强行送入 App 4+1 视图后宣称已支持。

#### Scenario: 缺 lens 的部件类型诚实失败

- **WHEN** 请求为一个没有 design lens 的 component type 建立蓝图
- **THEN** 入口 MUST 返回 unsupported / missing design lens 的明确失败并说明缺什么，
  MUST NOT 生成套用 App 4+1 的蓝图

> **Enforced by:** 本 capability spec 作为 P1 change 与 `/component-design` 编排入口的准入
> 约束；lens 建设本身由各自 profile 的独立 change 承担

