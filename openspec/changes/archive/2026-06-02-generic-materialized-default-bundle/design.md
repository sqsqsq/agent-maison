# Design

## 行为 SSOT

- **文档**：`skills/00-framework-init/SKILL.md` S2.2 两段式（默认 `.agents`/inline 写 payload 并物化；仅用户显式非标 bundle 根才 STOP）。
- **registry**：`init.materialized_adapters` notes 说明 generic 默认零配置。
- **harness**：`resolveBundleForInitInspect` 在 `agent_adapter !== 'generic'`（含 local active claude）时回退 `.agents`/inline——不变。

## 测试

- `init-orchestrate.unit.test.ts`：plan 含 `materialize-adapter:generic`；local active claude 不进入 stale 剔除。
- `init-task-executor.unit.test.ts`：执行 `materialize-adapter:generic` 后 `.agents/skills/00-framework-init/SKILL.md` 存在。
