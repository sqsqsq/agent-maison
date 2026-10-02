## MODIFIED Requirements

### Requirement: Reconciliation re-resolves stable targets without a semantic diff engine

蓝图 revision、`source_fingerprint` 或 `artifact_sha256` 变化时，CU 的旧 blueprint binding/design gate/ready projection MUST stale；CU revision/hash 变化时，旧 Feature projection MUST stale。下游 SHALL 从新 identity 自行重新派生，P1 MUST NOT 创建、修改或移除 P2 ready set。

CU 身份规则：`change-unit.yaml` 契约字段（`provides`、`requires`、`target_predicates`、`touches` 的 owner 与 design_ref target 地址、`preserved_invariants`、`design_refs` 的 target 地址）不变即同一 CU，已完成与未完成 CU 同规则：

| 变化 | 处置 |
|---|---|
| 补证据、机械修复、验收/文案/蓝图输入变化，契约字段不变 | 同一 CU；评估入口给出的 uncovered 义务由 successor 按责任阶段补齐 |
| 蓝图升 admitted revision，且 carry-forward 通过 | 原位升版：三处身份指针（`component_blueprint_ref`、`design_refs[]`、`touches[].design_ref`）的 revision / `source_fingerprint` / `artifact_sha256` 改为当前蓝图值，CU `revision + 1`，`change_unit_id` 与契约字段不变 |
| carry-forward 失败 | 不升版；历史 provides 不满足依赖，路由 `reconcile_blueprint` 回 P1 调和或新建 CU |
| 契约字段变化 | 新 `change_unit_id` 并以 `supersedes` 引用旧 `change_unit_ref` |

carry-forward SHALL 以历史 refs 的每个稳定 target `kind/id/view_id?` 构造当前 blueprint ref，并只复用当前 P1 resolver/admission：仅当全部 target 在当前有效蓝图中仍可解析且仍获准、无 unknown/open decision/blocker 时通过，整个 CU 的历史 provides 才 carry forward；carry-forward 只在同一 `blueprint_id` 内跨 revision 生效，另一 `blueprint_id` 工作区的历史 CU MUST NOT 参与任何 carry-forward 或依赖满足。任一 target 缺失、因替换而原 ID 不再解析、当前 disposition 为 unknown/open decision/blocker，或蓝图/相关设计未准入时，历史 provides MUST NOT 满足依赖，未来 CU MUST 阻塞并回到 P1 调和。

原位升版 MUST 由同一个 writer 函数执行，writer 仍唯一；调用位置有两处：设计准备段（派生 readiness 前），与 goal 运行时（本 run 的门报告指针过期的调和候选时——本 CU 的 canonical 校验阻断项只有"蓝图已升到更高 admitted revision"）。writer 在读取之前 MUST 先取该蓝图的调和锁，再对本批可能写到的每个 Feature 取它既有的 Feature 锁（调用方已持有的由调用方借给 writer）；任一取不到即竞争退出，MUST NOT 写任何字节，结果 MUST 向调用方说明是竞争而不是设计内容问题。写集 MUST 在取锁之后确定，且写出 MUST 只发生在已持锁的 Feature 上：取锁之后蓝图或 CU 又有变化、写集里出现未持锁的 Feature 时，同样竞争退出。三处指针身份本就不一致的 CU 属契约变化，MUST 跳过；待写 CU MUST 先过 canonical 全量校验，任一失败整批不落盘；结果（升版与跳过及原因）MUST 对调用方可见，重复执行 MUST 无变化。精确引用解析器 MUST NOT 为此放宽。

取锁段与锁内调和 MAY 分开调用，供需要在调和前先在同一把锁里写入的写入方使用（目前是 goal 运行时的无人值守 B1 修复：取锁后发布蓝图、再在锁内调和）。两层锁仍只有一个取锁段：取锁范围（要取哪些 CU 的 Feature 锁）由调用方指定——调和入口取"本批可能写到的 CU"，无人值守修复取该蓝图下全部 canonical CU（发布后全部 CU 都待写）；借锁、任一取不到即放掉已取的锁并竞争退出的规则不变；取锁中途抛异常时 MUST 先放掉本次自己取得的锁（借来的不放）再抛出原异常。锁内调和 MUST 消费实际取得的锁集合，并在自己的读取里重新确定写集；写集里出现不在已持锁集合内的 CU 时 MUST 竞争退出、一个字节不写。放锁由取锁方负责，借来的锁不放。

完成后升版：原位升版后 Feature 的 `change_unit_ref` 与 CU 不再一致，评估入口 SHALL 把它判为 plan 义务 uncovered（binding），由 successor 只补 uncovered 义务的责任阶段。运行中升版（A 类指针调和，即上文 goal 运行时对调和候选的调用）：goal 运行时在本 run 内调和后，成败 MUST 按本 run 的 CU 判——本 CU 被升版或已是当前身份时，当前阶段 SHALL 在同一 run 内原地重评并计入该阶段的内容重试预算；本 CU 被跳过、竞争退出或调和失败时，run SHALL 落回既有的设计 owner 停机并在说明里给出原因；同一蓝图下其它 CU 的跳过只披露，MUST NOT 让本 run 停机。无人值守 B1 修复发布后的锁内调和不适用这条原地重评规则：本 run 是否原地重评、停放或由恢复入口起后继，按 `goal-runner` 中该修复的结果规则判（本 CU 升版之外还要求探针就绪、冻结绑定仍有效）。已完成 CU 的 Goal Mode events/receipt/evidence/completion MUST 保留，MUST NOT 因重新规划改回 pending。

首期判定 MUST 是全有或全无的地址/准入重校验，不得假设 P1 存在 semantic diff、`invalidates` 或 decision-flip 引擎，也不得新增此类 registry/ledger。结果 MUST 可从正式产物和当前蓝图重建。`revises` 仅供旧数据读取，MUST NOT 再生成，也不承载任何行为。P2 MUST NOT 创建或修改 P3 closure 状态。

#### Scenario: Every historical target still resolves and remains admitted

- **WHEN** 蓝图升 revision 后，已完成 CU 的全部历史 target ID 在当前有效蓝图仍可解析且仍获准
- **THEN** 该 CU 的 provides 可整体 carry forward，同时保留完成事实

#### Scenario: Blueprint bump with every target resolving re-points the completed CU in place

- **WHEN** 蓝图升 admitted revision，已完成 CU 的全部 target 仍解析且获准，契约字段未变
- **THEN** 设计准备段把该 CU 三处指针原位升到当前蓝图、revision 加一、`change_unit_id` 不变；评估入口判 plan 义务 uncovered，successor 只补 uncovered 义务，不新建 CU、不重走全链

#### Scenario: Contract field change requires a new change unit id

- **WHEN** CU 的 touches 新增模块或其它契约字段变化
- **THEN** 原位升版 MUST NOT 接手；同一路径的候选 MUST 被拒绝，修正以新 `change_unit_id` + `supersedes` 表达，旧 CU 及其完成记录保留

#### Scenario: Missing or unresolved historical target returns to P1

- **WHEN** 任一历史 target ID 缺失/被替换，或当前对象为 unknown、open decision、blocker 或未准入
- **THEN** 该 CU 不升版、字节不变，结果列出跳过原因；其 provides 不满足未来依赖，相关推进阻塞并请求 P1 调和；P2 不猜测语义等价

#### Scenario: A blueprint bump during a run is reconciled inside that run

- **WHEN** 一个 goal run 已出生并冻结输入绑定，其后蓝图升到更高的 admitted revision，本 run 某阶段的门因本 CU 指针过期而失败
- **THEN** goal 运行时在两层锁内调用同一个 writer 原位升版，记录一条设计侧修复事件，当前阶段在同一 run 内重评并继续；不新建 run，不需要操作者动作

#### Scenario: The run's own unit is skipped by the writer

- **WHEN** 运行中的调和里本 run 的 CU 因 carry-forward 不通过等原因被 writer 跳过
- **THEN** 当前阶段不重评，run 以既有的设计 owner 停机结束，说明里含 writer 给出的跳过原因；该 CU 字节不变

#### Scenario: A sibling unit skipped by the writer does not stop the run

- **WHEN** 运行中的调和里本 run 的 CU 升版成功，而同一蓝图下另一个 CU 被 writer 跳过
- **THEN** 本 run 继续并可完成；兄弟 CU 的跳过及原因只出现在设计侧修复事件里

#### Scenario: Reconciliation exits without writing when another executor holds a lock

- **WHEN** writer 取不到蓝图调和锁，或本批可能写到的某个 Feature 的锁正被另一个 run 或会话持有
- **THEN** writer 一个字节不写并报告竞争；设计准备段的 readiness 报忙且不派生结论；goal 运行时落回设计 owner 停机，说明写明竞争解除后重发同一请求即可、不需要改设计内容

#### Scenario: A blueprint bump between lock acquisition and write does not widen the write set

- **WHEN** writer 已按当时的蓝图取完锁，随后蓝图升版，使一个正被某个 run 持锁的 Feature 的 CU 变成待升版
- **THEN** writer 一个字节不写并报告竞争；该 run 在此期间写出的产物保持原样

#### Scenario: A writer takes the locks first and reconciles inside them

- **WHEN** 无人值守 B1 修复以该蓝图下全部 canonical CU 为范围取到两层锁（借入本 run 已持有的 Feature 锁），在锁内发布新 revision 后调用锁内调和
- **THEN** 锁内调和照常执行、保留既有跳过条件（本 CU 也可能被跳过），只写已持锁的 Feature；整个过程中别的执行者取不到这些锁；取锁时任一锁取不到则修复不派发、一个字节不写；调和结果之后 run 怎么走由 `goal-runner` 判

> **Enforced by (P2 implementation):** `harness/scripts/utils/change-unit-reconciliation.ts`, `harness/scripts/utils/change-unit-design-preparation.ts`, `harness/scripts/utils/change-unit-ready-set.ts`, `harness/scripts/utils/component-blueprint-path.ts`, `harness/scripts/goal-phase-runtime.ts`

### Requirement: Design preparation accepts an admitted blueprint with zero change units

P2 MUST 暴露一个**设计准备子流程**，关闭"首个 canonical CU 由谁创建"的责任空档。它 MUST 完全复用上表 `CU decomposition` Seam Card 的既有机制（provider 只产临时候选 → consumer validator 校验后写 canonical），MUST NOT 新增第二套 CU 写入机制、第二个状态机或新 CLI。

- **入口**：admitted blueprint。**初始 canonical CU 数量为 0 MUST 是合法入口**，MUST NOT 判为推进故障；推进决策 MUST 把该情形与"有 CU 但无 ready"区分开。
- **候选**：decomposition provider 或人工/Agent 设计者 MUST 只产出内存/临时报告中的候选，MUST NOT 直接写 canonical CU 或完成事实；候选 provenance MUST 只记入 extraction method，MUST NOT 自称权威。
- **接受**：只有 consumer validator MAY 接受候选，且**全仓 MUST 只有一个 canonical CU 写入实现**——单候选接受 MUST 是批量接受的 1 元包装，MUST NOT 保留第二份 provenance/schema/design-gate/落盘逻辑；设计准备段只做入口/readiness 编排并委托该唯一 consumer。它 MUST 校验 schema、canonical identity、设计闭包（设计可施工门）、provenance 与来源权威，全部通过后 MUST **原子**写出 1..N canonical `change-unit@1`：任一候选不通过即整批拒绝且一个字节都不落盘；写入中途失败 MUST 回滚本批已落盘目标。
- **重复接受 fail-closed**：目标 canonical 文件已存在时 MUST 拒绝，MUST NOT 覆盖。契约变化 MUST 走新的 `change_unit_id` + `supersedes`；蓝图升版造成的指针漂移由下一条原位升版处理，不经再接受。
- **指针原位升版**：派生 readiness 前，设计准备段 MUST 按「Reconciliation re-resolves stable targets without a semantic diff engine」执行三处蓝图指针原位升版；它 MUST 复用同一 canonical 校验与同一落盘原语（整批校验后写、中途失败回滚），MUST NOT 改动契约字段，不构成第二套写入机制。writer 竞争退出时 readiness MUST 报忙并不派生结论。
- **终点**：派生 design gate / readiness 并返回后续施工入口。子流程 MUST **停在 selector 与 Goal Mode 执行之前**，MUST NOT 选择 CU、启动 run 或触碰 P3 closure。goal 运行时内的指针调和不是设计准备子流程：它只做指针原位升版，MUST NOT 接受候选、选择 CU 或触碰 closure。
- **施工段前提不放宽**：selector 与 Goal Mode 施工段 MUST 仍要求至少一个 canonical CU；设计准备段的入口放宽 MUST NOT 传导到施工段。

#### Scenario: Admitted blueprint with zero CUs enters design preparation

- **WHEN** 工作区有 admitted blueprint 但还没有任何 `change-unit.yaml`
- **THEN** 推进决策返回"需要设计准备"而不是 blocked 故障，且不选择任何 CU、不启动 Goal Mode

#### Scenario: A rejected candidate writes nothing

- **WHEN** 一批候选中任意一个未通过 schema、identity、设计闭包或 provenance 校验
- **THEN** 整批被拒绝，工作区内一个 canonical CU 文件都不产生

#### Scenario: A valid batch is written atomically

- **WHEN** 一批 N 个候选全部通过 consumer validator
- **THEN** N 个 canonical `change-unit@1` 一次性写出，随后可被既有枚举与 design gate 读取

#### Scenario: Single and batch acceptance share one writer

- **WHEN** 分别经单候选入口与批量入口接受候选
- **THEN** 两者 MUST 走同一 consumer 校验与落盘原语；provenance、canonical schema/identity、设计闭包门与原子写出 MUST NOT 存在第二份实现

#### Scenario: Accepting the same candidate twice fails closed

- **WHEN** 某候选的目标 canonical 路径已存在已接受的 CU
- **THEN** 接受必须失败并定位该路径，已有 canonical CU 与其 provenance 保持不变

#### Scenario: Construction still requires at least one CU

- **WHEN** 设计准备段尚未写出任何 canonical CU，调用方试图进入 selector 或 Goal Mode
- **THEN** 施工段入口必须拒绝并说明至少需要一个 canonical CU

> **Enforced by (P2 implementation):** `harness/scripts/utils/change-unit-design-preparation.ts`, `harness/scripts/utils/change-unit-provider-boundary.ts`, `harness/scripts/utils/change-unit-progress-loop.ts`, `skills/project/change-unit-progression/SKILL.md`, `skills/project/component-design/SKILL.md`
