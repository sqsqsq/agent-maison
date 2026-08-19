# Delta: Complex Capability Meta-Model — 三类对象边界与父目标声明门禁

## ADDED Requirements

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

- **部件演进蓝图**承载一次复杂建设的目标态与共同决策：MUST NOT 冒充当前事实真源，
  MUST NOT 拥有 phase 运行裁决权；当前态断言 MUST 引用代码/schema/接口/测试等事实来源；
- **Change Unit**：凡属某部件蓝图分解产物的单元 MUST 引用恰好一份所属蓝图，只消费显式
  `requires`、只声明显式 `provides`；总纲 §2.2 的独立小需求单元是复杂能力闭环之外的
  既有轻量路径（不属于双入口），允许无蓝图引用、只走单元闭环——未显式归属某份蓝图前，
  MUST NOT 参与任何 Component closure 聚合；
- **Component closure** MUST 由蓝图、单元契约与既有执行完成事实（events/receipt/
  evidence）派生，MUST NOT 引入可手改完成台账或第二恢复权威；
- 引用方向单向：CU→蓝图、closure→（蓝图+CU+完成事实）；蓝图 MUST NOT 反向依赖单元
  运行时状态。

#### Scenario: 孤儿单元不得进入部件闭环

- **WHEN** P2/P3 的实现允许一个无蓝图引用的单元参与某部件的闭环聚合
- **THEN** 该 change 违反本契约，openspec review MUST 拒绝

> **Enforced by:** 本 capability spec 作为 P1/P2/P3 change 的准入约束（review 门），
> 运行时 enforcement 随 P1/P2/P3 各自的实现 change 落地并回填引用

### Requirement: Dual entry semantics

单部件大型需求 MUST 可直接从原始需求、当前事实与人工提供的外部约束建立部件演进蓝图，
MUST NOT 以"能力架构蓝图缺失/G2 未建设"为由阻塞；跨部件场景 MUST 只消费人工或上游
提供的投影引用——Maison MUST NOT 重新裁决其它部件的架构，MUST NOT 由 AI 补造缺失的
外部契约（缺失时 MUST 落 open decision 或带责任方的 blocker）。

#### Scenario: 外部契约缺失不得补造

- **WHEN** 建立蓝图时 SE 尚未提供云侧同步契约
- **THEN** 蓝图对应条目为 open_decision/blocker 并标注责任方与解除条件，不出现 AI
  生成的契约内容

> **Enforced by:** 本 capability spec 作为 P1 change（蓝图建立与调和）的准入约束，
> 运行时 enforcement 随 P1 落地并回填引用

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
