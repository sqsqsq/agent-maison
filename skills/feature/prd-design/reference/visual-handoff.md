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

**path / 本地化资源类**（`repo_assets`、`screenshot_pack`，以及混合类中带 `path` 的条目）

- **`path`** 支持以下形态（脚本由 `resolveAuthoritativePath` 解析后以 `existsSync` 判定 **agent-reachable**，URL 不参与本地 exists）：
  1. **相对仓库根**（不以 `${`、非绝对路径）：与历史行为一致，且不得 `..` 越出仓库根。
  2. **环境根拼接**：整段 **`path` 必须以 `${`** 开头，例如 **`${UX_ROOT}/pack/v3/`**。花括号内为变量名：`${env:NAME}` 读 `process.env.NAME`，否则先查 `framework.config.json` → `prd.visual_sources.external_roots[NAME]`，再退回 `process.env.NAME`。
  3. **绝对路径 / Windows 盘符路径**：仅在 `prd.visual_sources.allow_absolute_paths === true` 时允许。
  4. **UNC 网络路径**（`\\server\share\...`）：仅在 `prd.visual_sources.allow_network_paths === true` 时允许。

**URL 类**（脚本仅校验格式，不抓取网络）：`design_tool_link`、`design_system_doc`、`portal_only`

- 每项必填非空 **`url`**：`http:` 或 `https:`。
- 建议另在正文或 `id`/注释中写明 **帧 / 版本**，以免链接歧义。

**混合类**：`figma_export_bundle`

- 每项须至少包含 **`path` 或 `url` 之一**（可并存：仓内导出 + 在线稿）。

每项可写可选 **`id`**（逻辑区域名），便于正文引用。

## PRD 驱动 + 项目级 opt-in（必读）

- **未**在 `framework.config.json` 配置 `prd` 段，且 PRD **没有**含 `ui_change` 的 yaml 块：`check-prd` **不产生** Visual Handoff 结果（云侧/库工程零噪声）。
- 已配置 `"prd": { "visual_handoff_enforcement": "strict" }` 等：对「**缺整个块**」按档位 **FAIL / WARN / SKIP**。
- PRD 已写 `ui_change: new_or_changed`（或 `copy_edits_only`）但 handoff 无效或路径不可达：**无** `prd` 段时默认 **FAIL**（声明即承诺）；若 opt-in 了 `warn` / `reachable` / `off`，按档位降级。

### `visual_handoff_enforcement` 选型

| 取值 | 缺 `ui_change` 块（仅 opt-in `prd` 后出现） | handoff 结构化错误 / 非法路径 | 结构化合法但路径不可达 |
|------|-----------------------------------------------|------------------------------|--------------------------|
| （未配置 `prd`） | 静默 | 默认 FAIL | 默认 FAIL |
| `strict` | FAIL | FAIL | FAIL |
| `warn` | WARN | WARN | WARN |
| **`reachable`**（推荐 opt-in） | WARN | WARN | WARN（`agent-reachable=false`） |
| `off` | SKIP | SKIP | SKIP |

### `doc/features/` 是否入库

与 `paths.docs_committed` 相关：默认 **`false`** 表示过程文档**不假定**进主仓；.harness / receipt 语义见 `framework/docs/visual-handoff-config-migration.md`。

## 实例配置（opt-in）

在实例根 **`framework.config.json`** **手工追加** `prd`（模板默认**不含**此段），例如：

```json
"prd": {
  "visual_handoff_enforcement": "reachable",
  "visual_sources": {
    "external_roots": { "UX_ROOT": "${env:UX_ROOT}" },
    "allow_absolute_paths": false,
    "allow_network_paths": false
  }
}
```

- 详细场景表与 checklist：`framework/skills/project/framework-init/prompts/prd-harness-options.md`。

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

## 真实工程范式（团队参考）

- **独立 UX git / 内网门户**：`path` 用 **`${UX_ROOT}/...`** 或 URL 类 `kind` + 正文明示版本号 / 归档批次。
- **NAS / UNC**：打开 `allow_network_paths`，`path` 写 UNC；CI 不可达时配合 `reachable` 档位 **WARN**。
- **Figma + 本地导出 mirror**：`figma_export_bundle` 同时给 `url`（在线）与 `path`（导出目录）。

## 示例：外部根 `${UX_ROOT}`

```yaml
ui_change: new_or_changed
visual_handoff:
  kind: screenshot_pack
  authoritative_refs:
    - id: ext_pack
      path: ${UX_ROOT}/my-feature/v3/
```
