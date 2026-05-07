# Visual Handoff / `prd` 配置 — 升级与迁移说明

本文说明 **v2.10+**（UX 真源可达）起 `framework.config.json` 中与 PRD Visual Handoff 相关的**行为变更**与迁移方式。

## 行为变更摘要

1. **`prd` 段不再出现在** `framework/templates/framework.config.template.json` 的默认 skeleton 中。  
   - 云侧 / 库工程等**无 UI** 场景：无需任何事，PRD 不写含 `ui_change` 的 yaml 块时，`check-prd` **不产生** Visual Handoff 检查项（零噪声）。
2. **项目级 enforcement** 仍为 **opt-in**：在实例根 `framework.config.json` **手工追加** `"prd": { ... }`。
3. **新增** `prd.visual_handoff_enforcement: reachable`（推荐用于「要跑 handoff、但 agent/CI 不一定能挂盘」的团队）。  
   - 结构化合法、路径不可达 → **WARN**（报告含 `agent-reachable=false`）。
4. **`paths.docs_committed`** 在模板中默认 **`false`**。  
   - `false`：`check-receipt` 对 Q3 只做**非占位**校验，**不要求** `doc/features/**` 路径在磁盘必然存在。  
   - `true`（如本仓库 sim-wallet 演示）：Q3 填报的路径须能在工作区解析为**已存在**文件。

详见：

- `framework/skills/00-framework-init/prompts/prd-harness-options.md`
- `framework/skills/1-prd-design/reference/visual-handoff.md`

## 已有工程如何保留旧习惯

- **老 config 已含 `prd` 段**：`framework-init` **UPDATE** 模式应**保留**用户整条 `prd`，不要静默删除。档位枚举含 `strict` | `warn` | `reachable` | `off`。
- **仍希望「没写 ui_change 就告警」**：在 config 追加：
  ```json
  "prd": { "visual_handoff_enforcement": "warn" }
  ```

## 新工程如何按需打开严格 Visual Handoff

1. 在 `framework.config.json` 追加 `prd`（最小示例）：
   ```json
  "prd": {
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
2. PRD 中在**独立** ` ```yaml` 块写明 `ui_change` / `visual_handoff`（见 visual-handoff.md）。
3. 开发者本机导出 `UX_ROOT` 或通过 `external_roots` 映射到 NAS/镜像目录。

## 回滚语义

去掉 `prd` 段后：仅当 PRD **未**声明 `ui_change` 时 Visual Handoff 脚本项静默；若 PRD **已**声明 `new_or_changed` 等，仍未履行 handoff → 默认仍 **FAIL**（声明即承诺）。若需整块软化，改用 `prd.visual_handoff_enforcement` 或为该需求改写 `ui_change`。
