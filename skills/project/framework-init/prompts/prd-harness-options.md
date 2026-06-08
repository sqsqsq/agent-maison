# PRD Harness：`prd` 段与 Visual Handoff（**opt-in** 高级文档）

> **受众**：本文件面向 **含 UI 形态、且希望脚本级约束 Visual Handoff** 的工程维护者。  
> **云侧 / 库 / 纯后端**工程可**整段跳过**——默认模板**不写** `prd` 段；PRD 不出现 `ui_change` yaml 块时 `check-prd` **不产生** Visual Handoff 噪声。

配置位置：实例根 **`framework.config.json`**（**手工追加** `"prd": { ... }`，见 [framework/templates/framework.config.template.json](../../../../templates/framework.config.template.json) 的 `$schema_docs.field_notes.prd_opt_in_note`）。

---

## 什么样的工程值得 opt-in？

自检（任一条为真即可考虑追加 `prd`）：

- [ ] 需求以**界面改版 / 新屏**为主，且必须把**高保真真源**链路写进 PRD。
- [ ] 多角色协作（设计 / 产品 / 开发），需要 harness **统一守门** authoritative_refs。
- [ ] UX 真源在**工程外**（独立 git、NAS、Figma 导出目录），需要通过 `${UX_ROOT}` 或 UNC 仍可追溯。
- [ ] CI / agent 环境**不一定挂载** UX 目录，希望在不可达时**降级 WARN** 而非直接 FAIL。

若全部为否：保持 **无 `prd` 段**即可。

---

## `visual_handoff_enforcement` 档位

取值：`strict` | `warn` | **`reachable`** | `off`。

| 取值 | PRD **无** `ui_change` 块（整块缺失） | `new_or_changed` 已声明但结构化 handoff **不合法** | 结构化合法，`path` **不可达**（本机不存在） |
|------|----------------------------------------|-----------------------------------------------------|---------------------------------------------|
| **（未配置 `prd`）** | **静默**（无检查项） | **FAIL** | **FAIL** |
| **`strict`** | **FAIL** | **FAIL** | **FAIL** |
| **`warn`** | WARN | WARN | WARN |
| **`reachable`**（opt-in **推荐**） | WARN | WARN | **WARN**，报告注明 `agent-reachable=false`，便于人工/NAS 环境复验 |
| **`off`** | SKIP Visual Handoff 脚本项 | SKIP | SKIP |

**CLI 逃生**（不替代配置）：`harness-runner.ts --skip-visual-handoff`；建议设 `HARNESS_SKIP_VISUAL_HANDOFF_REASON`。

---

## `visual_sources`（可选）

与 **`path`** 解析相关（见 [../../../feature/prd-design/reference/visual-handoff.md](../../../feature/prd-design/reference/visual-handoff.md)）：

```json
"visual_sources": {
  "external_roots": {
    "UX_ROOT": "${env:UX_ROOT}"
  },
  "allow_absolute_paths": false,
  "allow_network_paths": false
}
```

---

## `paths.docs_committed`（与收据 Q3）

- 默认 **`false`**：`doc/features/**` **不假定**入主仓；完成回执 Q3 不得保留模板占位，但**不要求**路径在磁盘必存在。
- **`true`**（演示仓）：Q3 填写的路径须在工程根解析后 **exists**。详见 `framework/docs/visual-handoff-config-migration.md`。

---

## framework-init 对齐说明

**CREATE**：不再在 Step 2 追问 `prd.visual_handoff_enforcement`；按模板生成 config 后，由维护者按需手工追加 `prd`。  
**UPDATE**：老工程已含 `prd` → **保留**整条；档位枚举如上（含 **`reachable`**）。
