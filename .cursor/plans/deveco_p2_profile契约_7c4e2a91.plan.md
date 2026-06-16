---
name: DevEco P2 profile 契约与 hmosDevice skeleton
version: 2.3.0
overview: 承接 DevEco 双文件机制 P1 收口后的架构债（2.3.0 窗口）：personal_prerequisites 从硬编码迁到 profile 契约 SSOT；project config 的 hmosDevice 段在 schema/template/defaults/backfill 层完成同步，并收紧 toolchain schema 禁止 devEcoStudio 回流。
todos:
  - id: profile-personal-prerequisites-ssot
    content: profile-schema.yaml + types.ts + profile-loader 声明/解析 personal_prerequisites（capability key → prerequisite）；phase-personal-prerequisites 删 CAPABILITY_PREREQUISITES 硬编码、保留 phase→候选 capability + isCapabilitySkipped
    status: pending
  - id: hmos-device-schema-tighten
    content: framework.config.schema.json toolchain.additionalProperties 收紧或显式禁止 devEcoStudio；与 runtime normalize 一致
    status: pending
  - id: hmos-device-skeleton-defaults
    content: framework.config.template.json + profiles/hmos-app/config-defaults.json 补 toolchain.hmosDevice 可选骨架与 field_notes
    status: pending
  - id: hmos-device-backfill-policy
    content: 明确 config-field-merger 是否 backfill hmosDevice（默认静默值 vs 仅 migrate/文档）；与 template 对齐
    status: pending
  - id: p2-docs-and-tests
    content: docs/profiles/hmos-app-harness-toolchain 补 hmosDevice 调优说明；单测 profile prerequisites 解析 + schema 断言
    status: pending
isProject: false
---

# DevEco 配置机制 P2 — profile 契约与 hmosDevice skeleton

## 背景

[P1 机制闭环](deveco_路径写错文件根因_2393d7b6.plan.md) 已落地 fail-closed、错位 gate、migrate、release 扫描、`--ensure --phase` 修复通道。

Review 剩余 **P2** 两项本 plan 承接，**不**重复 P1 范围。

## P2-1 — `personal_prerequisites` profile 契约化

### 现状

[`phase-personal-prerequisites.ts`](harness/scripts/utils/phase-personal-prerequisites.ts) 硬编码 `PHASE_CAPABILITY_MAP` / `CAPABILITY_PREREQUISITES`。

### 目标

| 层 | 变更 |
|----|------|
| [`profiles/profile-schema.yaml`](profiles/profile-schema.yaml) | 文档块 `personal_prerequisites`（capability key → prerequisite id 列表）；声明合法 capability / prerequisite id |
| [`harness/scripts/utils/types.ts`](harness/scripts/utils/types.ts) | `ProfileYamlStub.personal_prerequisites` 类型 |
| [`harness/profile-loader.ts`](harness/profile-loader.ts) | 解析进 `HarnessResolvedProfile`；**未知 capability 或 prerequisite id → throw fail-fast** |
| `profiles/hmos-app/profile.yaml` | 声明 deveco 绑定（与现硬编码表等价） |
| `profiles/generic/profile.yaml` | **显式**空 `personal_prerequisites: {}`（禁止隐式默认） |
| `phase-personal-prerequisites.ts` | **仅**读 resolved profile 的 capability→prerequisite 表；**删除** `CAPABILITY_PREREQUISITES` TS fallback；**保留** `PHASE_CAPABILITY_MAP`（或等价）phase→候选 capability + `isCapabilitySkipped` 过滤 |

### YAML 形状（SSOT）

**key 必须是 capability key**（与 `capability-registry` / `isCapabilitySkipped` 对齐），**不是** phase 名。粗粒度 phase 无法表达「`coding.compile` SKIP 但 `coding.lint` BLOCKER 时不应要求 deveco」。

```yaml
personal_prerequisites:
  coding.compile: [deveco_toolchain]
  ut.compile: [deveco_toolchain]
  ut.run: [deveco_toolchain]
  device_test.build: [deveco_toolchain]
  device_test.install: [deveco_toolchain]
  device_test.run: [deveco_toolchain]
```

- key = `CapabilityKey`（如 `coding.compile`、`device_test.run`）
- value = `PersonalPrerequisiteId[]`（`agent_adapter` 由框架隐式追加；profile 仅声明额外项如 `deveco_toolchain`）
- loader 校验：capability / prerequisite 须在 schema 登记表中，否则启动即失败

### 解析流程（与 P1 行为等价）

`resolvePhasePersonalPrerequisites(phase, resolved)` 保留 **框架级** phase→capability 候选表（`PHASE_CAPABILITY_MAP` 等价逻辑，可留在 TS 或迁到 workflow SSOT，**不**放进 profile yaml）：

1. 由 phase 列出候选 capability keys（如 `coding` → `['coding.compile']`）
2. 对每个 key：`isCapabilitySkipped(resolved, key)` 为 true → 跳过
3. 否则从 `resolved.personal_prerequisites[key]` 读取 prerequisite 列表并 union
4. 始终 union `agent_adapter`

profile yaml **只**承载 capability→prerequisite 绑定；SKIP 语义仍由 `capabilities` severity 驱动。

### 验收

- hmos-app：`coding.compile` / `ut.*` / `device_test.*` 非 SKIP → `deveco_toolchain` 需求与 P1 一致
- 某 capability SKIP、同 phase 其他 capability 非 SKIP → 仅非 SKIP 项贡献 prerequisite（单测覆盖）
- generic profile 显式空绑定 → 不要求 deveco（**无** TS prerequisite fallback 兜底）
- 新增 profile 可通过 yaml 声明 capability 级绑定，无需改 `CAPABILITY_PREREQUISITES` 硬编码表
- profile-loader 单测：未知 capability / prerequisite id throw

## P2-2 — `hmosDevice` project 契约同步

### 现状

- runtime + migrate 已支持 `toolchain.hmosDevice.*`
- [`framework.config.schema.json`](specs/framework.config.schema.json) 已加 `hmosDevice`，但 `toolchain.additionalProperties: true` 仍允许 `devEcoStudio`
- template / config-defaults / BACKFILL 无 hmosDevice 骨架

### 目标

1. **Schema 收紧**：`toolchain` 仅允许 `hmosDevice` / `hvigor` / `preferredProduct`（`additionalProperties: false` 或 JSON Schema `not` 禁 `devEcoStudio`）
2. **Template**：[`templates/framework.config.template.json`](templates/framework.config.template.json) 加可选 `toolchain.hmosDevice` 注释段（killHdc / aaTestTimeoutMs / testRunner）
3. **Defaults**：[`profiles/hmos-app/config-defaults.json`](profiles/hmos-app/config-defaults.json) 是否含静默默认 — 与产品语义对齐（建议 opt-in 空对象或文档-only，不强制 backfill）
4. **BACKFILL 策略**：在 [`config-field-merger.ts`](harness/scripts/utils/config-field-merger.ts) 明确「不 backfill personal devEco；hmosDevice 仅 migrate 迁入或用户 opt-in」

### 验收

- `release:verify` + schema 单测：project schema 不再描述可写 `devEcoStudio`
- 新 init 工程 template 可见 hmosDevice 调优键归属
- legacy migrate 行为不变（P1 单测仍绿）

## 实施顺序

1. profile prerequisites SSOT（loader + yaml + 改 phase-personal-prerequisites）
2. schema 收紧 + template/defaults
3. 文档 + 单测
4. `cd harness && npm test` + `npm run release:verify`

## 与版本窗口

绑定 `package.json` `version: 2.3.0`（与 P1 同窗口）；发布前 `release:check-plans` 须本 plan todo 全完成或经用户明确选择后再顺延。
