## Why

P1 已提供可校验、可稳定寻址的 App 部件蓝图，但 AgentMaison 仍不能把蓝图中的近期设计切片变成可独立施工的 Change Unit，也不能从真实完成事实派生下一步可执行集合。若直接把多个 Feature 排成手工队列，`design_refs`、依赖语义和 Goal Mode 完成事实会脱节，并容易形成第二套跨单元状态权威。

现在进入 P2，是为了在 Component closure 之前锁定最小 Change Unit 契约、设计可施工门、ready/blocker 派生和默认单并发连续推进，让现有 Feature/Goal Mode 精确执行一个有界单元，同时保留蓝图调和与后续关系演进空间。

## What Changes

- 新增归属复杂能力蓝图的 Change Unit canonical artifact 与校验契约；每个单元引用恰好一份蓝图，声明 `purpose`、`preconditions`、`requires`、`provides`、`touches`/所有权、`preserved_invariants`、`target_predicates`、`verification_refs`、`safe_intermediate_state`、统一 `design_refs` 和复用 P1 结构的 `provenance`。拆分 Provider 只生成临时候选，消费者校验通过后才写 canonical CU。
- 复用 P1 `component_blueprint_ref` resolver 校验 `design_refs`，允许引用 blueprint、view/node、relation、flow、decision、contract 等稳定设计切片；引用的 revision、`source_fingerprint` 或 `artifact_sha256` 不匹配时 fail-closed 并重新派生，不复制蓝图正文或新增 per-view refs。
- 建立当前单元“设计可施工”门：只要求引用实际 delta 涉及的适用视图、跨视图关系、关键 scenario、运行时 flow、决策与外部契约；当前单元相关的未决项阻塞，远期有 owner/needed-by 的 open decision 不阻塞。
- 为每个 CU 确定性、单射地派生唯一 Feature identity；Feature `contracts.yaml` 只按 CU 中已有的 predicate/provide/design-ref ID 映射真实文件、符号与测试，禁止复制或重新定义 CU 内容。CU 负责设计可施工，Feature 负责具体施工映射完整性。
- `contracts.state_management` 继续作为 Feature 施工阶段运行时事实的唯一权威；CU 只保存 P1 runtime flow/design 的稳定引用，不复制 trigger、mutation、publication、subscription 或 consumer 细节。`use-cases.yaml` 与 UT flow DAG 的必需性从多步顺序、失败恢复、共享状态多消费者、生命周期恢复及 unit/both 验证范围等权威事实机械派生，不接受 authored boolean。
- 从 CU `requires/provides`、结构化 blocker、蓝图当前 revision/fingerprint 与既有 Goal Mode events/receipt/evidence 派生 gate-specific ready set；ready set 只是可选择投影，不是并发授权、可编辑队列或完成台账。
- 首版只实现真实消费所需的 `requires/provides` 前置关系和结构化 blocker；不因上位模型列出六类关系就预建完整关系注册表、通用 DAG executor 或图数据库。若严格 execution-precedence 出现环或所有未完成目标均无 ready 单元且无合法 blocker，则确定性失败并给出协调/合并/契约冻结出口。
- 建立薄的部件推进循环：按显式优先级与稳定 tie-break 从 ready set 选择一个 Change Unit，调用既有 Goal Mode 执行确定性派生的 Feature；expected track/chain 从既有 workflow/track SSOT 解析，并将完成观察区分为 `ABSENT`、`VALID`、`STALE`、`INVALID`。失败、暂停、恢复和 completion 仍由现有 Goal Mode 负责，实际选序不回写成依赖。
- 固化滚动细化与首期历史语义：只把当前/近期单元细化到可施工；新事实先调和蓝图，再重算未实施单元与派生投影；已完成单元仅在其全部历史稳定 design target 于当前有效蓝图仍可解析且仍获准时 carry forward，任一缺失、替换、unknown、open decision 或 blocker 都使依赖回到 P1 调和。首期不建设语义 diff/`invalidates` 引擎，也不改写完成历史。
- 固化宿主演进接缝首次落地模式：稳定契约、首个真实 Provider、真实 Consumer 与契约测试必须位于同一纵切 CU；空接口、空 Store/EventBus 等无真实消费者的横向单元不得取得施工或完成资格。
- 增加正反 fixture 与 Goal Mode 集成测试，覆盖三个有前置关系的单元连续推进、多候选只选一个、悬空/过期 `design_refs`、当前未决项、运行时施工断边、无安全中间态、依赖环、伪 ready、自报完成、失败/恢复与首次接缝纵切。
- 本 change 不实施 Component closure/P3，不创建跨单元 ledger、常驻 daemon、锁、第二恢复目录或动态 provider 系统，也不把独立小 Feature 强制纳入蓝图闭环。

## Capabilities

### New Capabilities

- `change-unit-continuous-progression`: Change Unit 最小契约、蓝图设计切片消费、设计可施工门、ready/blocker 派生、Feature ID-only 施工映射、既有 Goal Mode 单并发连续推进与滚动重派生。

### Modified Capabilities

- `feature-artifact-layout`: 为 CU-bound Feature 增加 ID-only 施工映射，并明确 `contracts.state_management` 是 Feature 运行时施工事实的唯一权威。
- `ut-flow-dag-evidence`: 为 CU-bound Feature 增加从权威施工事实机械派生 `use-cases.yaml`/UT flow DAG 必需性的门禁。

## Impact

- 设计/规格层：新增 P2 capability spec、设计与实施任务，并新增带完整 `parent_goal` 声明的 3.1.0 P2 子 plan。
- 后续实施面：预计增加 Change Unit schema/loader/checker、ready/blocker 派生器、Feature 施工映射门和薄推进入口；复用 P1 蓝图 resolver/provenance、既有 artifact schema/loader、workflow/track resolver、Goal Mode manifest/events/receipt/evidence 与恢复链，并同源扩展现有 Feature template/type/checker。
- 既有 Feature 路径：无蓝图归属的独立小需求继续走既有单元闭环，不参与 Component closure；因此本 change 不构成消费者 breaking migration，不要求修改 `MIGRATION.md`。
- 验收边界：P2 实施阶段运行专项 unit/fixtures、Goal Mode 集成测试、OpenSpec strict validate、default plan 扫描与受影响 harness；整仓 release 门继续由总计划 m5/MG 承担。
