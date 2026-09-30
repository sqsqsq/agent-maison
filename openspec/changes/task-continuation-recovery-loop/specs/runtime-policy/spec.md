## MODIFIED Requirements

### Requirement: Execution scope has one authority and preserves obligations

新协议 SHALL 区分 required / not_applicable / unknown、已有满足依据、执行可用性与完成证据；失败、manual、超时或设备离线 MUST NOT 消除义务或生成 PASS。零设备义务 SHALL 根据有效验收内容的同一分层规则判定，不强制物理 acceptance.yaml；performance 只有确需设备证明时才触发设备义务。

feature.yaml.execution_scope MUST 仅为运行前候选。完整 Feature 交付 MUST 有唯一的冻结范围权威：本次关联的 run 存在时以该 run 的**有效范围**（出生 + 已应用 scope_revised）为权威。首次执行任一 feature phase 且无任何权威时，MUST 由机器从候选冻结一次；权威缺失或损坏（有阶段报告却无任一权威，或记录声明已转入某 run 而该 run 不存在/损坏）MUST 明确报错，MUST NOT 回退候选或选边。manifest.execution_scope 与 phase_chain MUST 保持出生值并绑定出生事实，运行期消费方 MUST 读有效范围。恢复 MUST 读取有效范围；显式 runId 的 manifest 缺失/损坏 MUST NOT 回退候选。全复用只核验真实既有完成记录，不造空链假 run。

合法范围修订 MUST 在同一 run 内追加 scope_revised 完成，MUST NOT 封卷、MUST NOT 释放 owner/锁、MUST NOT 生成后继；出生记录 MUST NOT 被改写，预算与失败历史 MUST NOT 被清空。successor 只保留给失败修复型 supersede（含同任务接续决策起的后继：最新未终局 run 为结构终局且存在可核验变化，或本次显式给了与钉值不同的型号或需求增量，或没有未终局 run 而范围由已完成 run 持有且存在可核验变化）、用户显式改需求与 creation-incomplete 修复；接续后继的预算 MUST 沿交付周期折叠，MUST NOT 清零。未受影响证据只在 freshness/closure 校验通过后复用。

新协议证据策略 MUST 在有效范围内求解，strict/balanced 继续按显式配置，模式不自动降档；未知输入先补足，本次无 testing 不要求 testing trace。已有有效负面结论与真实控制约束仍有效。MUST NOT 新建第二 run 目录、场外状态或平行完成协议。feature 级冻结记录（`<features_dir>/<feature>/execution-scope.json`）是 P8 裁决的**第二载体**，MUST 由机器单 writer 写入，MUST NOT 混入 feature.yaml。

#### Scenario: Device failure preserves responsibility
- **WHEN** 当前 device-evidence 为 required 但设备离线
- **THEN** 范围保留设备义务并报告可用性缺口，不改为 not_applicable

#### Scenario: Resume ignores changed workflow defaults
- **WHEN** 新协议 run 出生后 workflow 或候选范围改变
- **THEN** 恢复 MUST 使用有效范围（出生 + 已应用 scope_revised），MUST NOT 重算候选；需要变更时由责任方在同一 run 内追加合法修订

#### Scenario: Spec discovers a new device obligation
- **WHEN** spec 的有效新验收要求新增设备验证
- **THEN** 同一 run 追加 scope_revised 并继续派发，MUST NOT 产生第二个 run_created，出生范围不被改写

#### Scenario: Request-only review cannot create feature completion
- **WHEN** 用户只要求审查指定代码
- **THEN** 使用真实专项请求与独立报告，只完成 request，不伪造 Feature、run 或 completion

> **Enforced by (planned P2/P5/P6/P7):** `harness/scripts/utils/runtime-policy.ts`、
> `harness/scripts/utils/goal-manifest.ts`、`harness/scripts/goal-mode-entry.ts`、
> `harness/scripts/utils/verify-feature-completion.ts`、`harness/scripts/check-testing.ts`。

#### Scenario: Continuation successor keeps the delivery-cycle budget
- **WHEN** 同一请求重发时接续决策因结构终局且存在变化而起后继
- **THEN** 后继 MUST 写既有 supersede 审计并承接交付周期内全部未终局 run，已消耗的预算 MUST 沿交付周期折叠计入，MUST NOT 清零

## ADDED Requirements

### Requirement: Halt reasons carry a default fault category without changing disposition

Each `INCIDENT_REGISTRY` entry MAY carry an optional `fault_category` from six values — transient or process interruption, permanently incompatible model or tool parameter, artifact / projection / machine-identity drift, requirement versus design or observation conflict, product test failure, and authority boundary (permission, secret, irreversible action, hard budget). The category SHALL be a default explanation only: `decide()` and disposition projection SHALL NOT read it, and existing classes, structural terminality, and dispositions SHALL remain the source of truth. Entries that fit no category (framework program errors, aggregate or retired reasons) SHALL leave it empty with a stated reason. The registry SHALL register `budget_turns` (same disposition as `budget_wall_clock`), `receipt_missing` (recoverable, retry the closure transaction), `legacy_run_requires_manual_cleanup` (operator), and `guardian_termination_failed` (external, not auto-retried). The registration meta-gate SHALL also scan startup-blocker call arguments and budget halt-reason assignments case-insensitively, so an unregistered reason SHALL fail it.

Enforcement: `harness/scripts/utils/adjudication.ts`, `harness/tests/unit/adjudication.unit.test.ts`

#### Scenario: Categories do not change any disposition

- **WHEN** every pre-existing registry entry is projected before and after categories are added
- **THEN** each disposition projection SHALL be identical

#### Scenario: An unregistered startup-blocker reason fails the meta-gate

- **WHEN** a startup blocker or budget halt assigns a halt reason that is not in the registry
- **THEN** the registration meta-gate SHALL report it
