## MODIFIED Requirements

### Requirement: Design preparation accepts an admitted blueprint with zero change units

P2 MUST 暴露一个**设计准备子流程**，关闭"首个 canonical CU 由谁创建"的责任空档。它 MUST 完全复用上表 `CU decomposition` Seam Card 的既有机制（provider 只产临时候选 → consumer validator 校验后写 canonical），MUST NOT 新增第二套 CU 写入机制、第二个状态机或新 CLI。

- **入口**：admitted blueprint。**初始 canonical CU 数量为 0 MUST 是合法入口**，MUST NOT 判为推进故障；推进决策 MUST 把该情形与"有 CU 但无 ready"区分开。
- **候选**：decomposition provider 或人工/Agent 设计者 MUST 只产出内存/临时报告中的候选，MUST NOT 直接写 canonical CU 或完成事实；候选 provenance MUST 只记入 extraction method，MUST NOT 自称权威。
- **接受**：只有 consumer validator MAY 接受候选，且**全仓 MUST 只有一个 canonical CU 写入实现**——单候选接受 MUST 是批量接受的 1 元包装，MUST NOT 保留第二份 provenance/schema/design-gate/落盘逻辑；设计准备段只做入口/readiness 编排并委托该唯一 consumer。它 MUST 校验 schema、canonical identity、设计闭包（设计可施工门）、provenance 与来源权威，全部通过后 MUST **原子**写出 1..N canonical `change-unit@1`：任一候选不通过即整批拒绝且一个字节都不落盘；写入中途失败 MUST 回滚本批已落盘目标。
- **重复接受 fail-closed**：目标 canonical 文件已存在时 MUST 拒绝，MUST NOT 覆盖。契约变化 MUST 走新的 `change_unit_id` + `supersedes`；蓝图升版造成的指针漂移由下一条原位升版处理，不经再接受。
- **指针原位升版**：派生 readiness 前，设计准备段 MUST 按「Reconciliation re-resolves stable targets without a semantic diff engine」执行三处蓝图指针原位升版；它 MUST 复用同一 canonical 校验与同一落盘原语（整批校验后写、中途失败回滚），MUST NOT 改动契约字段，不构成第二套写入机制。
- **终点**：派生 design gate / readiness 并返回后续施工入口。子流程 MUST **停在 selector 与 Goal Mode 执行之前**，MUST NOT 选择 CU、启动 run 或触碰 P3 closure。
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

CU 接受成功、非 busy readiness、B1 发布后 SHALL 刷新人读文档；唯一 reconcileHeldBlueprintRefs MUST 在整批 bumped 成功后持锁刷新，覆盖运行中 reconcilePointerInRun。文档失败 MUST NOT 改变 accepted/readiness/bumped/recovered 或回滚设计。结果 SHALL 汇总内部与外层生成的最终状态和实际写入路径，不把外层未重写误报未交付。

#### Scenario: Stale owner pointer retains the unit contract
- **WHEN** 蓝图已改而 CU owner 指针待升版
- **THEN** 文档 SHALL 保留 CU 自身交付、依赖、约束、中间态与阻塞项，派生模块/链接标待升版，摘要不填假值；整批调和后 SHALL 自动刷新为当前绑定

#### Scenario: Display failure does not halt construction recovery
- **WHEN** 文档写入失败或单 CU 来源不可解析
- **THEN** SHALL 保留 canonical 与原业务结论，披露来源缺口与重建入口；不得新增 halt reason

> **Enforced by:** harness/scripts/utils/change-unit-design-preparation.ts、harness/scripts/utils/design-repair-unattended.ts、harness/scripts/utils/goal-phase-runtime.ts
