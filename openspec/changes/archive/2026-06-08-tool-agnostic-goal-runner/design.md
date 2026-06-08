# Design: 工具无关 Goal Runner

## Context

Maison 已有 phase DAG、harness 门禁、adapter 能力声明与 `goal_mode` 类型预留，但无确定性跨 phase 编排器。Claude/Codex 原生 `/goal` 不可移植。外部阻塞（如无设备）在 harness 中判 FAIL/INCOMPLETE，禁止软通过。

## Goals / Non-Goals

**Goals:**
- 确定性 `goal-runner` 按 manifest 驱动 feature phase 链
- `goal-runs/<run-id>/` 运行证据层为 resume/审计 SSOT
- `classifyPhaseVerdict` 统一裁决；INCOMPLETE→DEFERRED 续行（非 completed）
- 第一版硬化 `claude -p`、`codex exec` headless 路径

**Non-Goals:**
- 不改 Stop hook 跨阶段推进
- 不深度集成 Codex continuation.md 内部实现
- generic/chrys headless 质量不承诺（仅模板接口）

## Decisions

1. **Runner 为 SSOT**：裁决在 `phase-transition-policy.ts`；Skill 仅为薄入口。
2. **两级校验**：check-init WARN；goal-runner preflight BLOCKER。
3. **auto_chain**：workflow DAG 推导，manifest 可覆盖；`workflow-schema.json` 显式扩字段。
4. **DEFERRED**：`dependency_policy` 白名单 `blocking_class`/`failure_kind`；最终状态 DEFERRED/PARTIAL 禁 completed。

## Risks / Trade-offs

- [弱模型质量] → 裁决靠 harness 脚本，执行建议强模型
- [headless 权限] → manifest `unattended` preflight 硬校验
- [带 DEFERRED 依赖续行] → 下游 prompt 携带 upstream deferred 清单

## Migration Plan

- 默认 `transition_policy: manual` 不变
- 消费者按需调用 `goal-runner`；无需强制迁移
