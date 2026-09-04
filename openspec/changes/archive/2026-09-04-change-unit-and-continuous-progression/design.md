## Context

P0 已冻结三类对象的身份和单向引用：Change Unit（CU）必须引用恰好一份所属部件蓝图，Component closure 才能在 P3 聚合蓝图、CU 和既有执行事实。P1 已实现 `component-blueprint@1` canonical YAML、稳定 `component_blueprint_ref`、完整性校验和 blueprint/view/node/relation/flow/decision/contract target resolver，并明确 P1 不拥有 P2 ready set 或 P3 closure 状态。

现有 Feature 流水线已经以 `spec.md`、`acceptance.yaml`、`plan.md`、`contracts.yaml`、条件式 `use-cases.yaml` 承载单次施工，以 Goal Mode manifest/events/reducer/receipt/evidence/`feature-completion.json` 承载运行与完成事实。P2 必须在这些能力之间增加最小的 CU 施工和连续推进层，但不能把蓝图、Feature 产物和运行事实合成一张新账本。

本设计受总纲 §3.3、§4.3–§4.5、§7、§8、§11.2–§11.3 及总计划 §6.3 约束。首期真实宿主是 AI 记账 App；framework fixture 只证明机械语义，不能冒充真实宿主验收。

## Goals / Non-Goals

**Goals:**

- 固定 `change-unit@1` 最小契约、确定性路径、单蓝图归属、来源 provenance 和单射 Feature 施工绑定。
- 让 `design_refs` 通过 P1 resolver 消费当前 delta 的真实设计切片，并在进入 Goal Mode 前完成设计可施工校验。
- 只用 CU `requires/provides`、结构化 blocker、蓝图当前身份和既有 Goal Mode 事实派生 ready set。
- 以稳定选序、默认单并发和无持久协调状态的薄循环连续执行多个 CU。
- 以稳定 design ref 消费运行时 flow，并把具体运行时施工事实留在既有 Feature `contracts.state_management`。
- 让蓝图或 CU revision 变化时，下游自行失效并重派生，同时保留既有完成历史。

**Non-Goals:**

- 不实现 P3 Component closure、跨部件 Capability E2E closure 或任何 closure 状态。
- 不一次性实现总纲列出的 contract/runtime/migration/order/verification/write-conflict/decision 全关系 schema；P2 首版只有已有消费者的 `requires/provides` 严格前置和结构化 blocker。
- 不新增通用 DAG executor、图数据库、全局 CU registry、可编辑 ready queue、跨单元 ledger、锁、常驻 daemon 或第二恢复目录。
- 不修改 Goal Mode 对一个 Feature 内 phase、失败、暂停、恢复和完成事实的权威。
- 不强制独立小 Feature 创建蓝图或进入复杂能力聚合。
- 不预设宿主使用 Store、EventBus、Repository、DI、动态插件或特定平台模块形态。

## Decisions

### Decision 1: CU 是演进工作区内的独立 canonical artifact，与其 Feature 施工目录合一

> 2026-08-21 修订（M5A 演进工作区纠偏，总纲 §3.2/§5.3 裁决）：蓝图是一次演进的设计权威而非部件单例，
> 原 `<project_root>/blueprint/component/<component_id>/change-units/<change_unit_id>.yaml` 路径与以
> `component_id` 为键的 Feature identity 编码已废止并硬切，不保留兼容读取；下文为修订后的规则。

归属蓝图的 CU 使用唯一确定性路径，位于该次演进的工作区内：

```text
<features_dir>/<blueprint_id>/<change_unit_id>/change-unit.yaml
```

`<features_dir>` 即 `paths.features_dir`（默认 `doc/features`），经既有配置解析；文件名固定为 `change-unit.yaml`，
目录名即 `change_unit_id`，该目录同时就是该 CU 派生 Feature 的施工目录（phase-scoped 产物、contracts、goal-runs
等与 CU 契约同目录内聚）。`blueprint_id` 与 `change_unit_id` 都只允许安全单路径段，`change_unit_id` 不得为保留名
`blueprint`。loader 只按给定 `(blueprint_id, change_unit_id)` 解析精确路径；需要装载一个蓝图的单元集合时，只枚举
同一工作区下含 `change-unit.yaml` 的子目录（跳过 `blueprint/`），按目录名排序，并校验 YAML `change_unit_id` 等于
目录名；不读取旧根路径，不扫描 legacy 或仓库其它目录，另一 `blueprint_id` 工作区（含同一 `component_id` 的前次
演进）的 CU 不进入集合。该目录集合是正式 CU 产物，不是完成台账或选择队列；蓝图 YAML 不反向登记 CU，从而保持
CU→蓝图的单向引用。CLI `check-change-unit` 与 Skill 命令以 `--blueprint <blueprint_id> --unit <change_unit_id>`
定位，`component_id` 只作所有权核验。

根对象至少包含：

```yaml
artifact: change-unit@1
blueprint_id: ledger-evolution
component_id: ledger-app
change_unit_id: cu-ledger-write-mainline
revision: 1
priority: 10
component_blueprint_ref: <component_blueprint_ref targeting blueprint ledger-evolution>
provenance:
  source_kind: blueprint
  source_ref: <features_dir>/ledger-evolution/blueprint/component-blueprint.yaml#blueprint:ledger-evolution
  observed_at: 2026-08-19T00:00:00Z
  evidence_strength: authoritative
  extraction_method: consumer-validated-cu-decomposition
purpose: ...
preconditions: []
requires: []
provides: [{ provide_id: ledger-write-mainline@1 }]
design_refs: [<component_blueprint_ref targeting runtime flow ledger-write>]
touches: [{ owner: LedgerRepository, design_ref: <development node ref> }]
preserved_invariants: [{ invariant_id: ledger-entry-idempotent, evidence_refs: [<test ref>] }]
target_predicates: [{ predicate_id: ledger-write-observable, description: <observable outcome> }]
verification_refs: [contract-test:ledger-write]
safe_intermediate_state: ...
blockers: []
```

根对象不允许 `execution.feature_id`、`status`、`ready`、`completed` 或 P3 closure 字段。`component_blueprint_ref` 必须 target blueprint；尚未完成 CU 的所有 `design_refs` 必须与当前 owner ref 的 component/blueprint/revision/`source_fingerprint`/`artifact_sha256` 完全一致。`provenance` 复用 P1 的 `source_kind/source_ref/source_revision?/observed_at/evidence_strength/extraction_method` 结构，记录正式 CU 所依据的蓝图/权威事实：`source_ref` 必须是 owner blueprint 的 canonical ref，或已由该 P1 blueprint 收录的来源；若 CU 声称 `authoritative`，外部来源还必须位于 P1 的 authoritative provenance 覆盖下。Provider 名称只能出现在 extraction method，不能成为权威来源。

逻辑 Feature identity 不由作者填写，而由 consumer 以 `cu-` + `base64url(UTF-8(blueprint_id + "\0" + change_unit_id))` 确定性派生；它是 events/receipt/reports/manifest 引用的全局键。其物理施工目录是 `<features_dir>/<blueprint_id>/<change_unit_id>`（CU YAML 所在目录），逻辑 identity→物理路径只经 `feature-artifact-layout` 规定的唯一 Feature 路径 SSOT 解析，P2 不自行拼接。安全单路径段不含 NUL，base64url 对输入字节可逆，因此该映射对 `(blueprint_id, change_unit_id)` 单射；不同工作区可复用同一 `change_unit_id` 而逻辑键与物理路径均不冲突。以 `cu-` 开头但 payload 非法的 identity fail-closed，不回退为平铺 Feature。schema 拒绝任何 Feature id override。CU 目录与 Feature 目录合一后，绑定判定为：只含 `change-unit.yaml` → `available`；含部分 phase-scoped 产物、尚无 `contracts.yaml` → `in_progress`（合法施工中）；含 `contracts.yaml` → 核对 `change_unit_ref` 得 `matched`/`conflict`；工作区子目录有施工产物却缺 `change-unit.yaml` → 孤儿，fail-closed；`conflict`/孤儿下 identity gate 不接管目录。Feature 侧使用 `change_unit_ref`（artifact、blueprint_id、component_id、change_unit_id、revision、CU YAML 原始字节 `artifact_sha256`）绑定当前施工 revision；CU 文件不在自身内容里自报自哈希。

备选方案是在蓝图根内嵌 `change_units`。该方案会使 P1 蓝图开始拥有 P2 状态并让每次单元修订重写蓝图，因此拒绝。另一方案是新增全局 CU manifest/registry；它会形成平行枚举真源，也拒绝。

### Decision 2: `requires/provides` 使用显式来源的精确匹配，不建设完整关系注册表

首版 `provides[]` 每项拥有部件内稳定 `provide_id`；`requires[]` 必须同时声明精确 `provide_id` 和 `from_change_unit_id`。analyzer 不做名称相似、类型推断或跨命名空间匹配：provider CU 必须真实声明同一 `provide_id`，其派生 Feature completion 经既有验证入口返回 `VALID`，且全部历史 design target 在当前蓝图仍可解析并获准，该 require 才满足。已有外部契约、当前代码事实或人工裁决属于 precondition/design ref/probe，不伪装为另一个 CU 的 provides。

`blockers[]` 表达仍未解除的条件，至少包含 blocker id、影响门槛、责任方、原因、解除条件和事实来源；机器可观测条件必须带 probe，只有需要人类判断/授权的 blocker 才可省略 probe。`file_exists` probe 的 `ref` 必须通过既有 project-relative path 校验，工程外文件不得解除 blocker。blocker 是否仍成立由 probe/权威输入重算，不接受 `resolved: true` 自报。需要移除已经解除的人类 blocker 时，依据权威证据发布新 CU revision，而不是维护状态账本。

备选方案是先实现六类关系及 `depends_on` DAG。真实 P2 消费点只需要严格施工前置和 blocker，完整模型会提前固化无消费者字段，因此拒绝。

### Decision 3: 设计可施工门由 P1 稳定地址及其闭包派生

对尚未完成的 CU，校验顺序固定为：CU schema/identity → canonical path → 单蓝图归属 → P1 当前 blueprint schema/identity → 逐个 `design_ref` 解析 → 当前 delta 的引用闭包 → disposition/blocker → Feature 施工投影。

引用闭包不是“至少填一个 ref”的计数门。它从 CU 的 target predicates、touches 和显式 design roots 出发，复用蓝图 stable address index 与 cross-view/runtime links，要求：

- 每个 touches 模块/写集能回到相关 development node；
- 每个被改变节点的 design basis relation/decision/contract 可解析；
- 关键 scenario 步骤能贯穿相关 logical/runtime/development 及适用 deployment 节点；
- 涉及 runtime flow 时，flow 及其条件式所需 owner、producer/consumer、恢复和验证地址进入同一施工切片；
- 引用的当前设计不得为 unknown、open decision、blocker 或无权威依据的未准入结论。

只有闭包实际涉及的当前 CU 未决项阻塞；其它远期单元的 open decision 只要保留 owner/needed-by，不阻塞当前单元。若施工中发现新事实推翻蓝图，门返回 reconcile 指令，不允许 Feature plan 用 TBD 或模型常识补齐。

备选方案是要求每个 CU 引用全部 4+1 视图。它会制造无关引用和形式主义，无法证明当前 delta，因此拒绝。

### Decision 4: CU 定义设计义务，Feature 只保存 ID-only 施工映射

CU 是 predicate、provide、design ref 及 verification obligation 的定义权威。设计可施工门只证明这些义务构成有界、安全、已准入的 delta；它不要求 CU 在 Feature 尚未规划时虚构文件、符号或测试落点。

`contracts.yaml` 增加机器可校验的 `change_unit` 区段，只绑定 `change_unit_ref`，并按 canonical CU 中已存在的 ID 保存施工映射：`predicate_mappings[]` 将 `predicate_id` 映射到 implementation/test refs，`provide_mappings[]` 将 `provide_id` 映射到 implementation/test refs，`design_ref_mappings[]` 将完整稳定 `design_ref` 映射到 implementation/verification refs。Feature 不得复制 purpose、predicate/provide 描述、verification obligation 或重新定义同名 ID；checker 必须从 canonical CU 读取定义，并在 plan/coding/review 阶段验证每个 required ID 恰有合法落点、不得出现未知 ID。

`spec.md`/`acceptance.yaml` 以引用方式解释 CU purpose、目标谓词和用户可见语义；`plan.md` 以人读表格/时序解释本单元 delta。Feature completion 已对 `contracts.yaml` 等产物做哈希绑定；P2 再校验其中的 `change_unit_ref`，从而让旧 completion 只满足它实际施工的 CU revision。

Goal Mode 不增加新的 manifest 身份字段。薄推进入口向既有 runner 传入确定性的 requirement 文本，内容只包含 CU canonical path、`change_unit_ref`、蓝图 ref 和“必须从 formal artifact 读取正文”的指令；Goal Mode 仍产生原有 manifest/events/evidence。

备选方案是复制完整蓝图进 Feature 目录，或让 Goal Mode manifest 变成 CU 状态真源；两者都会形成双真值，因此拒绝。

### Decision 5: 运行时细节只有一份施工真源，use-case/DAG 义务机械派生

CU 只保存 P1 flow/node/relation/decision/contract 的稳定 `design_refs`，不增加 `runtime_flow_slices`，也不复制 trigger、mutation、publication、subscription、consumer 等运行时细节。Feature 的既有 `contracts.state_management` 继续作为施工阶段运行时事实唯一权威；其条目通过 `design_ref_mappings` 追到 P1 稳定地址，并映射真实 owner、文件/符号和验证。P2 同源扩展现有 contracts schema/type/loader/checker，不创建第二个 runtime section。

对 CU-bound Feature，`use_cases_required` 不接受 authored boolean，而从 canonical CU/蓝图 refs、acceptance 与 `contracts.state_management` 机械派生。存在下列任一事实即必须生成 `use-cases.yaml`：至少两个有序用户/系统/外部步骤；失败、重试、恢复或补偿分支；同一状态有两个及以上消费者；生命周期/后台/定时/外部触发要求重建、恢复或新鲜度调和。`dag_required` 独立派生：当 `ut_layer` 为 `unit|both` 的目标跨至少两个有序实现/边界步骤、含分支/恢复/补偿，或运行时传播涉及多个 consumer 时，必须生成 ephemeral flow DAG；若 use-case 已必需且这些 unit/both 条件成立，DAG 必须链接相应 use-case/branch。简单单步、无分支、无共享消费者、无生命周期恢复的路径可沿用直接 UT tag/AC coverage。

只读/首次加载流不得伪造 mutation 或订阅；一旦权威施工事实声明 mutation，publication/invalidation 必须能追到受影响 consumer；声明 subscription 时必须有当前快照/replay 与 cleanup；后台或外部写入必须有持久化/恢复裁决。use-case/DAG 是施工与测试投影，不得反向重定义 `contracts.state_management` 或 P1 flow。若蓝图表明本 CU 首次建立或重构共享运行时主链，同一纵切 CU 必须包含权威来源/持久化、状态 owner、传播语义、至少一个真实 consumer 与可执行验证；空 Store/EventBus 横切不具备安全中间态。

### Decision 6: completion adapter 区分未执行与损坏，ready set 仍是纯派生

P2 先按 Decision 1 派生 Feature identity，再复用既有权威链解析 completion 预期：`resolveWorkflowSpec()` 读取 workflow SSOT，`resolveFeatureTrack(loadFeatureTrackDecl())` 解析 expected track，`featurePhasesFromWorkflow()` 解析 expected chain。P2 不信任 completion 内自报的 chain/track。

completion observation 是四态适配层而不是新状态账本：不存在 completion projection 且没有权威终局 run 声称已跨过 completion 生成边界时为 `ABSENT`（即 `not_completed`，覆盖从未执行、仍活动、失败或暂停）；不存在 projection 但权威终局 run 已声称完成时为 `INVALID`；projection 存在时调用 `verifyFeatureCompletion()` 并原样保留 `VALID|STALE|INVALID`。因此“尚未执行”不会被误报为损坏，“完成证据缺失/篡改”也不会降级为未完成。

`deriveChangeUnitProgression()` 每次从有效 CU artifacts、当前 canonical blueprint 身份、blocker probes、派生 Feature 的既有 Goal Mode run 状态和该四态 observation 重建结果。一个尚未完成 CU 进入 execution ready set 必须同时满足：

1. 当前 CU 的 completion observation 为 `ABSENT`，或为 `STALE` 且当前 CU/design/Feature mapping 已重新校验、明确需要重执行；`INVALID` 必须先修复证据完整性；
2. 设计可施工门通过；
3. 每个显式 requires 的 provider CU 已有匹配 revision 的 `VALID` completion；
4. 不存在影响 design/execution 门的活动 blocker；
5. 没有同一 `blueprint_id` 工作区内仍在运行或需要恢复的权威 Goal run。

返回值包含 ready candidates、每个非 ready 单元的可解释原因、活动 blocker 和下一动作；可生成报告，但报告是可丢弃 projection，删除后可完全重建。CU 内的 `ready: true`、Feature 自报 done、文件存在性或 Markdown 结论一律不消费。

### Decision 7: 对严格前置投影做有界环检与静默停滞检测

由显式 `requires.from_change_unit_id` 形成的 execution-precedence 投影必须无环。首版用确定性 DFS/SCC 识别环并报告完整成员和边；不对冲突、验证或描述性关系的概念并集做环检。发现环后不给任何环内 CU ready 资格，输出“冻结契约/提供可信 seed 或 fake、声明协调、合并为组合 CU”的修订建议；P2 不新增 `cycle_protocol` registry。

每个未完成目标必须能追到至少一个 ready CU 或合法结构化 blocker。若无 active Goal run、无 ready CU、无合法 blocker，但仍有未满足 target predicate，返回 `silent_progress_stall` BLOCKER，不把空 ready set 当作完成或 P3 closure。

### Decision 8: 选序确定、执行单并发，实际顺序不污染依赖

`priority` 是选择提示，不是依赖。selector 先按较小整数 priority，再按 `change_unit_id` Unicode code-point 升序稳定选出一个候选。一次决策最多返回一个 `selected`；ready set 保留其它候选且不创建它们之间的边。

薄推进循环的状态机只有派生动作：`resume_active | select_one | blocked | ready_for_component_closure`。它通过注入的既有 Goal Mode 调用入口执行选中 Feature；调用结束后必须重新读取 completion 和蓝图/CU hashes，再派生下一步。即使 caller 返回 `completed`，当前 CU completion 仍须已成为 `VALID`；否则立即以 no-progress blocker 停止，不得再次选择同一 CU。Goal Mode 失败、暂停或待人工时循环停止并返回现有 run 的恢复动作，不启动第二个 CU。中断后重新调用即可从既有事实恢复，无需 P2 checkpoint。

首版不承诺两个独立协调者并发竞争时的分布式互斥；使用者是单个主 Agent/进程。出现真实多 writer 需求前不增加锁或全局 owner。

### Decision 9: 首期 carry-forward 只做当前稳定地址重解析

蓝图 revision/`source_fingerprint`/`artifact_sha256` 任一变化，尚未完成 CU 的 blueprint binding 立即 stale，必须重绑当前蓝图、升 CU revision 或明确 supersede；P1 不回写任何 P2 状态。CU YAML 改变则 Feature `contracts.yaml.change_unit_ref` 和旧 completion 不再匹配，P2 重新派生。

已完成 CU 保留原始 CU 文件、蓝图 refs、Feature contracts、Goal Mode events/receipt/evidence 与 completion，永不改回 pending，也不原位升 revision。首期不假设 P1 提供 semantic diff、`invalidates` 或 decision-flip 判定；P2 只从历史 CU 的每个稳定 design target `kind/id/view_id?` 构造当前 blueprint ref，并交给当前 P1 resolver/admission 重新校验。只有全部历史 target 在当前有效蓝图中仍可解析且仍获准（不存在 unknown、open decision 或 blocker）时，整个 CU 的 completed provides 才 carry forward；carry-forward 与 requires/provides 对账都只在同一 `blueprint_id` 工作区内进行，另一 `blueprint_id`（含同一 `component_id` 的前次演进）的历史 CU 永不参与——新演进依赖前次成果只能经 P1 discovery 从当前代码与归位真源重新发现（总纲 §5.3，2026-08-21）。任一 target 缺失、被替换而原 ID 不再解析、变为 unknown/open decision/blocker，或当前蓝图/相关设计未准入时，历史 provides 不参与依赖满足，未来 CU 阻塞并路由 P1 调和。该首期判定全有或全无、每次可重建，不写迁移台账，也不建设语义 diff 引擎。若新事实要求纠正，必须创建新的 `change_unit_id`，可用 `revises`/`supersedes` 指向旧 `change_unit_ref`；只有尚未实施 CU 可以在蓝图调和后原位升 revision。P2 不创建或修改 P3 closure。

### Decision 10: 宿主演进接缝首次落地必须是纵切 CU

当 `design_refs` 指向 P1 中裁决为建立接缝、且尚未落地的变化轴 decision 时，首个 CU 必须同时映射稳定契约、首个真实 Provider、真实 Consumer 和契约测试四类 target predicate/verification。后续 Provider 可以是独立 CU，但必须继续引用该权威 decision，并通过精确 `requires.from_change_unit_id + provide_id` 消费已落地稳定契约；前置 CU 必须引用同一 decision，且该 `provide_id` 必须由其 contract predicate 单独绑定，不能拿所有 predicates 共用的整单元 outcome 冒充稳定契约。P2 不得以 priority 或 Consumer/Provider 描述字符串推断“首个/后续”关系；若契约或 Consumer 必须改变，该 delta 必须由当前获准 design/decision refs 明示，否则路由蓝图调和/版本化。

### Decision 11: 可替换能力只设三张 Seam Card，首期静态接线

P2 的稳定内核是 CU schema/ref、design gate、ready/blocker 语义、Feature/Goal Mode 消费入口和完成事实权威。可替换 provider 仅为拆分策略、关系分析器和选序策略；它们的 Seam Card 写入 capability spec。首期每处只有一个静态内置实现，不新增 plugin loader/registry。拆分 provider 可缺失并允许人工/Agent 直接提交合法 CU；Provider 只返回内存/临时报告中的候选，consumer 校验 schema、设计闭包、provenance 和来源权威后才原子写入 canonical CU。Provider 退出清理未接受候选，不删除已接受 CU；关系分析器和 selector 对自动连续推进是 required，缺失时形成 blocker，不能假 PASS。

## Risks / Trade-offs

- **[CU 内容仍可能漏报未来实际写集]** → 入场时用 touches→development node 与设计闭包检查；施工后由 coding/review 对真实 diff、owner 和 `design_refs` 再核，发现偏离即回 spec/蓝图调和。
- **[只实现 requires/provides 会暂时表达不了复杂迁移/组合验证]** → 真实案例先用明确 blocker 阻塞对应门槛；出现明确消费者后再按总纲类型规则扩展，不把优先级或临时顺序伪装成依赖。
- **[无跨进程锁存在双启动竞态]** → 3.1.0 明确单主 Agent/进程；每次启动前读取 active Goal runs，真实宿主证明需要多 writer 后再单独立项。
- **[蓝图频繁修订使未实施 CU stale]** → stale 是安全行为；只重派生未实施单元，已完成事实保持不变并用修正单元承接。
- **[Feature projection 可能演化成第二蓝图]** → schema 只允许当前 CU refs、映射和施工字段，checker 禁止复制 review summary/完整 design views/全量 flow。
- **[fixture 连续推进不等于真实宿主可用]** → P2 framework 验收与 AI 记账真实单元证据分开声明；没有真实宿主只宣称机械闭环。

## Migration Plan

1. 新增 `change-unit@1` schema、最小 loader/ref/validator 和 fixture，不修改既有 Feature 默认路径。
2. 接入 P1 resolver 与设计闭包门；此时只做 dry validation，不启动 Goal Mode。
3. 同源扩展既有 Feature contracts/template/type/checkers 与相关 Skill，使有 `change_unit_ref` 的 Feature 校验 ID-only 施工映射、`contracts.state_management` 和机械派生的 use-case/DAG 义务；无该 ref 的既有 Feature 行为不变。
4. 增加纯派生 ready/blocker/cycle/selection 内核、四态 completion adapter 和静态 provider 候选接线。
5. 通过注入的 fake Goal Mode 先完成三单元集成 fixture，再接既有 runner 入口验证 workflow/track-derived expected chain、失败、恢复与 completion。
6. 在 AI 记账真实蓝图材料到位后选择首个纵向 CU 验证语义；未到位时不声称宿主通过。

回滚时可移除 P2 Skill、schema/checker 与投影字段；既有无 CU Feature 不受影响。已经产生的蓝图、CU 和 Goal Mode 事实保留在仓内，不静默删除；Feature 仍可按既有路径独立核验。

## Open Questions

- P2 的 framework 语义没有待裁决开放问题。首个 AI 记账 CU 的具体名称、写集、priority 和真实 Goal Mode adapter 由宿主蓝图及材料决定；材料何时到位是执行安排，不改变本协议。
