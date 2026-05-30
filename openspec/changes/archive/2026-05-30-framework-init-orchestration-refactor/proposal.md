# Proposal: Framework Init 编排化重构

## Why

现有 framework-init 采用固定 11 项体检 + 策略矩阵 + 批量 Q1=y 文本协议，弱模型易退化为自由文本交互；且 check-init 在探测阶段即有写盘副作用，个人化配置（agent_adapter / DevEco 路径）混在项目级 config 中，无法支撑「集成者一次 init、团队成员各自 setup」的真实工作流。

## What Changes

- **BREAKING**: `framework.config.json` 移除 `agent_adapter` 与 `toolchain.devEcoStudio`；新增 `materialized_adapters: string[]`（项目级物化清单）
- **BREAKING**: 新增 gitignored `framework.local.json`（个人 active adapter + DevEco installPath）
- **BREAKING**: framework-init 从固定 Step 0.3.x 流水线改为 S1 探测 / S2 计划批准 / S3 执行 / S4 摘要 四步编排
- 新增 harness 确定性编排器：`init-task-planner.ts`（纯只读探测 → 任务 DAG JSON）+ `init-orchestrate.ts`（枚举 decision JSON 执行 + run-log 摘要）
- 探测阶段零写盘；`.gitignore` / deprecated cleanup / auto_overwrite sync 下沉为批准后 DAG 任务
- 拆分两条入口：项目级 init + 个人级 setup（`00b-framework-setup`）；setup 只读校验已物化 adapter，不写项目产物
- init/setup 交互禁自由输入；下线 `init.populated_diff` 的 Q1=y 文本协议
- `loadFrameworkConfigWithSources()` + 三入口 fallback 检测（harness-runner / Skill bootstrap / adapter command）

## Capabilities

### New Capabilities

- `init-orchestration`: harness 任务 DAG 探测、计划、枚举决策执行、run-log 摘要
- `framework-local-config`: 个人级 framework.local.json schema、merge、来源状态、外迁迁移

### Modified Capabilities

- `harness-gates`: check-init 探测纯只读；副作用任务化；init-orchestrate 门禁
- `agent-adapters`: materialized_adapters 多选物化；提交产物不吃 local active adapter

## Impact

- Affected: `harness/config.ts`, `harness/scripts/check-init.ts`, `harness/scripts/utils/config-field-merger.ts`, `specs/framework.config.schema.json`, `skills/00-framework-init/SKILL.md`, `skills/reference/confirmation-registry.yaml`, `agents/*/templates/commands/`, `profiles/**/00-framework-init/profile-addendum.md`
- Migration: UPDATE init 自动外迁个人字段到 `framework.local.json`；老 Q1=y 协议下线
- Consumer: 集成者跑项目 init；团队成员 clone 后跑个人 setup
