# `hmos-app` · Skill `0-catalog-bootstrap` profile addendum

从 **`oh-package.json5` / 模块目录 / `Index.ets`** 等宿主信号推导模块画像时，采用本 profile 提供的 **infer 提示与模块卡模板**。

## 权威资产清单

| 用途 | 路径 |
|------|------|
| 模块推断提示 | `framework/profiles/hmos-app/skills/0-catalog-bootstrap/prompts/` |
| 模块卡草稿模板 | `framework/profiles/hmos-app/skills/0-catalog-bootstrap/templates/module-card-template.yaml` |
| catalog 规则 overlay | `framework/profiles/hmos-app/phase-rules-overlays/catalog-rules.overlay.yaml` |
| 资产机器清单（根 SKILL 的 `profile-skill-asset:`） | `framework/profiles/hmos-app/skills/skill-assets.yaml` |

合并入 `doc/module-catalog.yaml` / `doc/glossary.yaml` 前，仍需通过 `harness-runner --phase catalog` / `--phase glossary`；**不得**在 catalog 中发明未在代码或已确认文档中出现的模块 ID。

### module-card 草稿模板（字段指引）

- 所有字段都必填（即便值为 `[]` 也要显式写出）。
- 不要臆造 `NOT_responsible_for` / `easily_confused_with`；无依据则 `[]`。
- `confirmed_by_user` 默认为 `false`；仅当用户审阅后手改为 `true` 才允许合并进 `doc/module-catalog.yaml`。
- `signals_used` 须反映真实读过的输入（architecture / README / `oh-package.json5` / 导出入口等）。

### skill-assets.yaml 键

| 键 | 相对 `skills/0-catalog-bootstrap/` |
|----|--------------------------------------|
| `examples_domain_mapping` | `examples-domain-mapping.md` |
| `examples_wallet_domain` | `examples-domain-mapping.md`（别名） |
| `module_card_template` | `templates/module-card-template.yaml` |
| `glossary_term_template` | `templates/glossary-term-template.yaml` |

### `module-card` · `format` 合法取值

下列取值与 `profile.yaml > catalog_allowed_module_formats`（及 `profile-loader.ts` 缺省兜底）对齐，**亦为** harness `format_value_valid` 的机器校验集合：

- `HAP`
- `HAR`
- `AtomicService`

在非 hmos-app profile 若要扩展枚举，请先改对应 `framework/profiles/<profile>/profile.yaml`，再回填 `infer-module-card`/`module-card-template` 提示以避免双源分叉。

## hmos-app 输入信号顺序

若正文要求“按当前 profile 的模块发现信号采集”，本 profile 使用以下顺序：

1. `doc/architecture.md` 中对应模块小节：强锚点，作为职责定义主来源。
2. `<module_path>/README.md`：辅助锚点。
3. `<module_path>/oh-package.json5`：读取 `dependencies`、`module.type`，判定模块关系与 `HAP`/`HAR`。
4. `<module_path>/Index.ets` 或 DSL 声明的导出入口：提取 top-level export，形成 `key_exports`。
5. `<module_path>/src/main/ets/` 目录树：只列目录结构，深度不超过 3。
6. 最多 3 个关键文件头部 60 行：仅用于确认职责，不通读全部源码。

`module-card` 字段填写时，`format` 由 `oh-package.json5` 的 `module.type` 映射，`entry_file` 对 HAP 通常指向 Ability 入口、对 HAR 通常指向导出入口文件。`key_exports` 来自导出入口，保留不超过 10 个代表性符号。
