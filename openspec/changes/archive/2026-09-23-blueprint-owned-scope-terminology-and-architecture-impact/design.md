## Context

实施 plan a3c7e9d1（`.cursor/plans/复杂能力建设3.1_蓝图承接spec与plan部件级裁决与framework-init交接_a3c7e9d1.plan.md`）。复用 P1 fact/provenance/decision 协议、P3 投影链与既有 init_next_steps 机制，不开新协议。

## Goals / Non-Goals

**Goals:** init 交接到 component-design；术语、模块范围、架构影响在蓝图一次裁决，spec/plan 只投影并核对。

**Non-Goals:** 不建 registry、不登记 blueprint_id、init 不读蓝图；不新增时点字段或档位；非 CU-bound 平铺 Feature 流程不迁移（只统一 DSL 写路径）。

## Decisions

1. `design_entry_ready` 是 `INDEX_CAPABILITY_WHEN` 新增一值，kind optional，不带 `workflow_artifact`（lint 拒绝）；成立条件 = catalog ready ∧ `profileHasDesignLens(project_profile.name)`。`findFirstLaunchableFeatureArtifact` 不改。
2. `profileHasDesignLens` 放在 `blueprint-provider-boundary.ts`（app-design-lens provider 所在处），当前仅 `hmos-app`。P1 checker `checkCanonicalComponentBlueprint` 在加载蓝图前按该谓词返回 `blueprint_design_lens_unsupported`（沿既有 `ComponentBlueprintResolutionError` → CLI 结构化 FAIL 出口）。
3. 知识资产披露复用 `relConventions` / `relComponentIndex` + 文件存在性，只追加一行文字，不生成步骤、不阻断、不新增 readiness 类型。
4. t2/t3 设计见 plan §4.2–4.3：`resolveAdmittedModules` 三处同源、可修改模块集合只从 CU touches 派生、检查落在共享 `validateChangeUnitFeatureProjection`、`architecture_impact` 一条决策一个变化项。

## Risks / Trade-offs

- P1 unsupported 只接在 checker 入口；admission/设计准备内部直接调用 validator 的路径不重复判定（generic profile 到不了蓝图入口）。
- 前蓝图 materialization-only 模式不加载蓝图、不做 lens 判定；lens 缺失在第一次蓝图检查时报告。

## Migration Plan

t1 独立先交付；t2 开工前本 change 已建立；t5 收口时 `npm run openspec:validate` 通过，归档待用户裁决。消费者迁移：在途蓝图的 changed development 节点补 `module`（MIGRATION.md 3.1.0）。

## Open Questions

无新增产品裁决。
