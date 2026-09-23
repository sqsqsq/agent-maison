## Why

M7 之后正式需求先经蓝图与 CU，但术语↔模块映射、模块范围、架构影响三类“部件级一次裁决”仍留在 spec/plan 各写一遍；CU-bound typed 路径下对应门禁整体跳过而蓝图侧没有对应物。init 完成后的下一步建议也仍指向 spec，而不是正式需求入口 component-design。

## What Changes

- init next-steps 增 `design_entry_ready`：catalog ready 且 profile 具备 design lens 时建议 component-design，并披露 conventions / 组件索引文件是否存在；spec/plan 建议改为存量平铺 Feature / 非正式维护动作措辞。
- `profileHasDesignLens` 成为 P1 checker unsupported 判定与 init 建议的唯一同源谓词。
- 术语与模块范围进蓝图一次裁决：获准模块解析 helper、development 节点 `module` 必填、术语事实、CU touches 派生可修改模块集合（t2）。
- 架构影响迁为蓝图 decision 子类型 `architecture_impact`，plan 退出 DSL writer（t3）。
- spec/plan Skill 主流程收敛（t4）。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `init-orchestration`: next_steps 增正式需求入口建议与知识资产披露。
- `app-component-blueprint`: development 节点 `module` 必填并解析为获准模块；术语事实与确认；`architecture_impact` 决策子类型。
- `change-unit-continuous-progression`: 可修改模块集合只从 CU touches 派生（`cu_scope_matches_blueprint`）；架构影响决策施工前生效（`cu_architecture_impact_not_effective`，`dsl_other` 只 WARN）。
- `harness-gates`: CU-bound 叙述 spec/plan 的术语、scope、架构影响门禁同 id 核对蓝图投影；非 CU-bound 不变。

## Impact

影响 init next-steps、skills.index、P1 checker 入口，以及蓝图 validator、CU 投影共享校验、check-spec / check-plan 的 CU-bound 分支。不新增文件类型、注册表或状态。对在途蓝图有一处升级要求：changed development 节点须补 `module`（否则 `blueprint_node_module_missing`），已写入 MIGRATION.md 3.1.0；非 CU-bound 平铺 Feature 无迁移。
