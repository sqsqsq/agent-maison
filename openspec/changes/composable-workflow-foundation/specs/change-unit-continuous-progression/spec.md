## MODIFIED Requirements

### Requirement: Feature artifacts bind the exact Change Unit revision

归属 CU 的派生 Feature MUST 在机器施工契约中携带 `change_unit_ref`，至少包含 `artifact: change-unit@1`、`blueprint_id`、`component_id`、`change_unit_id`、正整数 revision 与 CU canonical YAML 原始字节 `artifact_sha256`。`contracts.yaml.change_unit` MUST 只按 canonical CU 的稳定 ID 保存施工映射：每个 `predicate_id`/`provide_id` 映射到真实 implementation/test refs，每个完整 `design_ref` 映射到 implementation/verification refs。Feature MUST NOT 复制或重新定义 CU purpose、predicate/provide 描述、verification obligation，也不得映射 canonical CU 中不存在的 ID。

适用的验收内容 SHALL 以引用方式解释 purpose、用户可见语义和目标谓词；需要补充设计时 `plan.md` SHALL 精确展开当前 delta。已有获准切片可提供完整施工投影时 MUST NOT 强制重跑 spec/plan 或生成占位文件，但上述 `contracts.yaml.change_unit` 机器映射 MUST 保持完整。CU design gate 负责 predicate/provide/design-ref/验证义务是否形成可施工设计；Feature mapping gate MUST 独立验证 canonical CU 中每个 required ID 都有具体文件/符号/测试落点且没有未知 ID。Feature 产物不得复制完整 review summary、全部 design views、全量 decisions/flows 或把 `contracts.yaml` 升级为第二蓝图。CU/派生 Feature/Goal Mode identity MUST 一致；CU revision/hash 变化后，旧 Feature mapping 即 stale。

#### Scenario: Feature projection is bound and minimal

- **WHEN** plan 阶段为 `cu-ledger-write` 生成施工产物
- **THEN** contracts 的 ID-only mappings 可精确追到 canonical CU 定义和真实文件/符号/测试，plan 解释当前 delta，且产物不复制 CU 定义或整份蓝图

#### Scenario: Feature cannot redefine a predicate

- **WHEN** contracts 为已有 `predicate_id` 复制一份不同描述，或映射一个 canonical CU 不存在的 predicate
- **THEN** Feature mapping gate 必须失败；修改定义只能发布新的 CU revision

#### Scenario: Old feature artifacts cannot satisfy a revised CU

- **WHEN** CU YAML 升至 revision 2 并改变字节 hash，而 Feature contracts/completion 仍绑定 revision 1
- **THEN** P2 必须把施工投影判为 stale，旧完成事实保留但不得满足 revision 2

> **Enforced by (P2 implementation):** `specs/artifact-schemas/contracts.schema.yaml`, `specs/artifact-schemas/use-cases.schema.yaml`, `harness/scripts/utils/change-unit-feature-projection.ts`, `harness/scripts/check-plan.ts`

### Requirement: Completion observation distinguishes absence from stale or invalid evidence

CU completion SHALL 先从 CU identity 派生 Feature identity，再独立验证真实 Goal run 的冻结执行范围、出生绑定与当前 CU 目标覆盖，解析 expected completion；MUST NOT 信任 completion artifact 自报的范围或按当前 workflow/track 重算新协议 expected chain。旧出生协议才沿既有 `resolveWorkflowSpec()`、`resolveFeatureTrack(loadFeatureTrackDecl())`、`featurePhasesFromWorkflow()` 兼容路径解析。

P2 adapter SHALL 暴露 `ABSENT|VALID|STALE|INVALID`，但不持久化该 verdict。没有 completion projection，且既有 reducer/`run_end` 权威事实未表明成功跨过 completion 生成边界时，observation MUST 为 `ABSENT/not_completed`，覆盖从未启动、active、failed、paused 或 awaiting-human；若权威终局事实已声称完成但 projection/original 缺失，observation MUST 为 `INVALID`。projection 存在时，P2 MUST 以独立验证的 expected scope（旧协议为 chain/track）调用既有 `verifyFeatureCompletion()`，并原样保留其 `VALID|STALE|INVALID` 结果。

#### Scenario: Never-run Feature is absent, not corrupt

- **WHEN** a derived Feature has no run and no completion projection
- **THEN** completion observation is `ABSENT/not_completed`, so the CU may be considered for ready derivation if all other gates pass

#### Scenario: Valid completion uses independently verified scope

- **WHEN** a completion is valid for the real run's independently verified frozen scope and current CU target coverage
- **THEN** the adapter reports `VALID` only after `verifyFeatureCompletion()` passes with those independently derived expectations

#### Scenario: Tampered or missing completed evidence is invalid

- **WHEN** a completion projection is tampered, or an authoritative terminal run claims completion but the required projection/original is missing
- **THEN** the adapter reports `INVALID`, not `ABSENT`, and the provider CU cannot satisfy downstream requires

> **Enforced by (P2 implementation):** `harness/workflow-loader.ts`, `harness/scripts/utils/feature-track.ts`, `harness/scripts/utils/runtime-policy.ts`, `harness/scripts/utils/phase-transition-policy.ts`, `harness/scripts/utils/verify-feature-completion.ts`, `harness/scripts/utils/change-unit-completion.ts`
