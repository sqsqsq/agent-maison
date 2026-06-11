# Visual Handoff / `spec` 配置 — 升级与迁移说明

本文说明 **v2.10+**（UX 真源可达）起 `framework.config.json` 中与 spec Visual Handoff 相关的**行为变更**与迁移方式。

## 行为变更摘要

1. **`spec` 段不再出现在** `framework/templates/framework.config.template.json` 的默认 skeleton 中。  
   - 云侧 / 库工程等**无 UI** 场景：无需任何事，spec 不写含 `ui_change` 的 yaml 块时，`check-spec` **不产生** Visual Handoff 检查项（零噪声）。
2. **项目级 enforcement** 仍为 **opt-in**：在实例根 `framework.config.json` **手工追加** `"spec": { ... }`。
3. **新增** `spec.visual_handoff_enforcement: reachable`（推荐用于「要跑 handoff、但 agent/CI 不一定能挂盘」的团队）。  
   - 结构化合法、路径不可达 → **WARN**（报告含 `agent-reachable=false`）。
4. **`paths.docs_committed`** 在模板中默认 **`false`**。  
   - `false`：`check-receipt` 对 Q3 只做**非占位**校验，**不要求** `doc/features/**` 路径在磁盘必然存在。  
   - `true`（如将需求文档纳入主仓的演示配置）：Q3 填报的路径须能在工作区解析为**已存在**文件。

详见：

- `framework/skills/project/framework-init/prompts/spec-harness-options.md`
- `framework/skills/feature/spec/reference/visual-handoff.md`

## v2.3：`prd` 段改名为 `spec`

- **canonical 键**：`framework.config.json` 顶层 **`spec`**（含 `visual_handoff_enforcement` / `visual_sources`）。
- **legacy `prd` 段**：loader 仍可读取并 stderr 一次弃用提示；**framework-init UPDATE** 经 `MIGRATION_RULES` 自动 **`prd` → `spec`** 并删除 `prd`。
- **整文件 overwrite**（UPDATE 选覆盖）：落盘为新模板，不再含 `prd`。

## 已有工程如何保留旧习惯

- **老 config 已含 `prd` 段**：重跑 **framework-init UPDATE**（merge 或 overwrite）会迁移为 `spec`；或手工改键名。
- **仍希望「没写 ui_change 就告警」**：在 config 追加：
  ```json
  "spec": { "visual_handoff_enforcement": "warn" }
  ```

## 新工程如何按需打开严格 Visual Handoff

1. 在 `framework.config.json` 追加 `spec`（最小示例）：
   ```json
  "spec": {
    "visual_handoff_enforcement": "reachable",
    "visual_sources": {
      "external_roots": {
        "UX_ROOT": "${env:UX_ROOT}"
      },
      "allow_absolute_paths": false,
      "allow_network_paths": false
    }
  }
  ```
2. spec 中在**独立** ` ```yaml` 块写明 `ui_change` / `visual_handoff`（见 visual-handoff.md）。
3. 开发者本机导出 `UX_ROOT` 或通过 `external_roots` 映射到 NAS/镜像目录。

## 回滚语义

去掉 `spec` 段后：仅当 spec **未**声明 `ui_change` 时 Visual Handoff 脚本项静默；若 spec **已**声明 `new_or_changed` 等，仍未履行 handoff → 默认仍 **FAIL**（声明即承诺）。若需整块软化，改用 `spec.visual_handoff_enforcement` 或为该需求改写 `ui_change`。
