# Visual Handoff（视觉交接）— PRD 机器可读块

本文档约定 PRD.md 中与 **脚本 Harness** (`check-prd.ts`) 对齐的 Visual Handoff 写法。背景与设计取舍以各 feature 的 PRD / 设计文档或团队纪要为 SSOT。

## 放哪里

在 **任意** ` ```yaml ` 代码块中声明，且该块 YAML **根对象须含 `ui_change` 字段**（与「Scope 声明」里的 yaml 块**分块书写**，二者互不影响）。

推荐位置：`Scope 声明` 之后、`最小改动原则` 或正文之前。

## 字段

### `ui_change`（必填）

| 取值 | 含义 |
|------|------|
| `none` | 不涉及 UI 或已由其他流程处理；**不要求** `visual_handoff` |
| `reuse_only` | 复用既有界面；**不要求** authoritative 资源 |
| `impl_out_of_band` | UI 已在主线外落地，本文档只做行为/验收；不要求 refs |
| `new_or_changed` | 有新版面或改版；需提供 `visual_handoff` |
| `copy_edits_only` | 仅改文案/资源等轻量变动；需提供 `visual_handoff` |

### `visual_handoff`（当 `ui_change` 为 `new_or_changed` 或 `copy_edits_only` 时必填）

| 字段 | 说明 |
|------|------|
| `kind` | 见下文 |
| `authoritative_refs` | 数组；每项至少包含定位信息（见各 kind） |

### `kind` 与每条 `authoritative_refs` 元素

**path 类**（要求在仓库内可打开，脚本会验存在性）：`repo_assets`、`screenshot_pack`

- 每项必填非空 **`path`**：相对仓库根的正斜杠路径。

**URL 类**（脚本仅校验格式，不抓取网络）：`design_tool_link`、`design_system_doc`、`portal_only`

- 每项必填非空 **`url`**：`http:` 或 `https:`。
- 建议另在正文或 `id`/注释中写明 **帧 / 版本**，以免链接歧义。

**混合类**：`figma_export_bundle`

- 每项须至少包含 **`path` 或 `url` 之一**（可并存：仓内导出 + 在线稿）。

每项可写可选 **`id`**（逻辑区域名），便于正文引用。

## 实例配置

实例根 `framework.config.json`：

```json
"prd": {
  "visual_handoff_enforcement": "strict"
}
```

- `strict`：`new_or_changed` 缺少合法 handoff → **FAIL**
- `warn`：同类问题仅 **WARN**（未声明本段时 Harness 对该项默认等价于 warn）
- `off`：不跑 Visual Handoff 脚本检查

## CLI 逃生

```bash
npx ts-node harness-runner.ts --phase prd --feature xxx --skip-visual-handoff
```

建议设置环境变量 `HARNESS_SKIP_VISUAL_HANDOFF_REASON` 写一句审计说明（会写入脚本报告）。

## 示例：`repo_assets`

```yaml
ui_change: new_or_changed
visual_handoff:
  kind: repo_assets
  authoritative_refs:
    - id: home_tab_overview
      path: doc/features/my-feature/ux-reference/README.md
```

Markdown 插图仍可保留，但 **以对 `path`/URL 的声明为准**，不以缩略图为权威。
