# 架构 DSL — 手动编辑指引（非对话问卷）

> **BLOCKER**：init/setup **禁止**在对话中收集 `architecture` 字段（外层 id、`can_depend_on`、子层列表、模块名字符串等）。
> 预设 A/B 不满足时，**STOP** init 写盘，由维护者**手工编辑** `framework.config.json` 后重跑 `/framework-init`（UPDATE）。

## 允许路径（四选一）

1. **预设 A/B** — registry `init.architecture_preset` → `preset_5_layer` / `preset_minimal_3`（见 [architecture-presets.md](../prompts/architecture-presets.md)）。
2. **探测快照** — S1 扫描 + 已有磁盘 `architecture`（UPDATE / recovered config），经 `init.intra_layer_deps` gate/matrix 确认同层策略。
3. **跳过本轮 architecture 变更** — S2 决策 skip 相关 config 任务（仅当磁盘已有合法 DSL）。
4. **手动编辑** — 本指引；编辑完成后重跑 init，**不得**在 chat 里逐字段问答。

## 编辑步骤

1. 复制参考 JSON：
   - [preset-minimal-3-layer.sample.json](./preset-minimal-3-layer.sample.json)
   - 或 profile 资产 `` `profile-skill-asset:00-framework-init/preset_5_layer_sample` ``
   - 或 [framework.config.template.json](../../../templates/framework.config.template.json) 中的 `architecture` 段
2. 在实例根编辑 `framework.config.json` 的 `architecture` 对象（含 `outer_layers`、`module_inner_layers` 等）。
3. 本地校验：`cd framework/harness && npx ts-node -e "const {loadFrameworkConfig}=require('./config'); loadFrameworkConfig('<repo-root>');"`（须无 `validateArchitectureDsl` 抛错）。
4. 重跑 `/framework-init`（UPDATE）；S2 用 `init.architecture_preset=keep_existing` + `init.intra_layer_deps` 确认同层策略。

## 禁止（反模式）

- ❌ 对话「问卷」收集 `id` / `members_pattern_or_list` / 字符串数组
- ❌ 「完全自定义」分支在 chat 里拼装 JSON
- ❌ 选 `sublayer` 后在对话追问子层 id 列表（须在 JSON 中写好 `sublayers[]` 后再 init）
