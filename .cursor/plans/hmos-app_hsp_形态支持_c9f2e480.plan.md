---
name: hmos-app HSP 形态支持
overview: 在 hmos-app profile 中把 HSP 提升为与 HAR 等价的一等库模块形态，贯通 Skill 0 catalog、Skill 2 design、Skill 3 coding、Skill 4 review 与 harness 检查全链路，从源头消除术语表/模块画像缺 HSP 内容的问题；framework 自身演进先以 OpenSpec change 承载。
todos:
  - id: openspec-change
    content: 实施前以 /opsx-propose 新建 OpenSpec change 承载 HSP 形态演进并通过 openspec:validate
    status: completed
  - id: enum-ssot
    content: profile.yaml 的 catalog_allowed_module_formats 增加 HSP
    status: completed
  - id: lib-helper
    content: har-export-resolve.ts 新增并导出 isLibraryFormat(format) 判定 HAR/HSP
    status: completed
  - id: har-only-checks
    content: catalog-entry-file-har.ts / catalog-key-exports-har.ts / coding-host-rules.ts 用 isLibraryFormat 替换硬编码 'HAR'，并同步文案
    status: completed
  - id: overlays
    content: catalog-rules.overlay / coding-rules.overlay 的 format 枚举与 har_index_export/applies_to_format 描述补 HSP
    status: completed
  - id: infer-prompts
    content: infer-module-card.md / profile-addendum.md / module-card-template.yaml 增加 shared→HSP 推断分支与合法取值
    status: completed
  - id: design-skill2
    content: design-rules.overlay / Skill2 profile-addendum / design-template 的 format 文案补 HSP
    status: completed
  - id: coding-skill3
    content: Skill3 profile-addendum / coding-standards / module-scaffold / verify-coding.overlay 及 reference（arkts-pitfalls / harmony-api-guide / arkui-patterns）库模块文案补 HSP
    status: completed
  - id: review-docs
    content: Skill4 review-checklist/profile-addendum、harness-runbook、test-plan-template 同步 HSP
    status: completed
  - id: schema-docs
    content: profile-schema.yaml 与 atomic-service-roadmap.md 的形态枚举文档同步 HSP
    status: completed
  - id: tests
    content: 单测覆盖 HSP + 必做 catalog/coding 集成夹具，跑 cd harness && npm test 全绿
    status: completed
isProject: false
---

# hmos-app 增加 HSP 模块形态支持

## 背景与根因

HarmonyOS 库模块分 HAR（静态）/ HSP（动态），二者对外导出方式完全一致（`oh-package.json5 main` → `Index.ets`）。当前 hmos-app profile 只承认 `HAP / HAR / AtomicService`，导致：

- `format_value_valid`（BLOCKER）拒收 HSP → 作者被迫错标成 HAR 或漏建档
- 推断提示词无 `shared → HSP` 分支 → AI 默认把 HSP 当 HAR
- 三处 har-only 检查硬编码 `m.format === 'HAR'` → 即便正确标为 HSP 也会被静默跳过

术语表构建本身不按 format 过滤，HSP 缺失是上游 catalog 没建出 HSP 模块导致的级联结果，因此**修好 catalog 即修好 glossary**。

## 处理原则

HSP 与 HAR 在 framework 视角下**完全等价**（都是库模块、靠 Index.ets 导出、无 `assembleHap`/`TestAbility`）。统一引入一个 `isLibraryFormat(format)` 语义判定，替换散落的 `=== 'HAR'` 魔法字符串，避免后续再漏。

## 改动落点

### A. 枚举 SSOT（BLOCKER 机器校验）
- [profiles/hmos-app/profile.yaml](profiles/hmos-app/profile.yaml)：`catalog_allowed_module_formats` 增加 `HSP`。

### B. 真实过滤逻辑（让检查真正覆盖 HSP）
- [profiles/hmos-app/harness/har-export-resolve.ts](profiles/hmos-app/harness/har-export-resolve.ts)：新增并导出 `isLibraryFormat(format?: string): boolean`（命中 `HAR` / `HSP`）。**签名必须接受 `string | undefined`**——catalog 检查侧的 `ModuleCard.format` 在 [catalog-parser.ts:33](harness/scripts/utils/catalog-parser.ts) 是可选字段（`format?: string`），且 `tsconfig strict: true`，写成 `format: string` 在 `isLibraryFormat(m.format)` 处会编译不过；coding 侧的 `ContractsSpec.modules[].format`（[types.ts:183](harness/scripts/utils/types.ts)）是必填 `string`，可选签名对两个调用点都兼容。
- [profiles/hmos-app/harness/catalog-entry-file-har.ts](profiles/hmos-app/harness/catalog-entry-file-har.ts) 第 25 行：`m.format !== 'HAR'` → `!isLibraryFormat(m.format)`；PASS/详情文案 "HAR 模块" → "HAR/HSP 库模块"。
- [profiles/hmos-app/harness/catalog-key-exports-har.ts](profiles/hmos-app/harness/catalog-key-exports-har.ts) 第 55 行：同上替换 + 文案。
- [profiles/hmos-app/harness/coding-host-rules.ts](profiles/hmos-app/harness/coding-host-rules.ts) 第 280 行：`m.format === 'HAR'` → `isLibraryFormat(m.format)`；SKIP 文案 "无 HAR 格式模块" → "无 HAR/HSP 库模块"，PASS 文案同步。

### C. phase-rules overlay 描述/标注
- [profiles/hmos-app/phase-rules-overlays/catalog-rules.overlay.yaml](profiles/hmos-app/phase-rules-overlays/catalog-rules.overlay.yaml)：`format_value_valid` 的 `description` 与 `rule.allowed_values` 增加 `HSP`；`entry_file_matches_oh_package_main` 与 `key_exports_fresh_vs_index` 的 `applies_to_format: "HAR"` → 标注覆盖 `HAR/HSP`。
- [profiles/hmos-app/phase-rules-overlays/coding-rules.overlay.yaml](profiles/hmos-app/phase-rules-overlays/coding-rules.overlay.yaml)：`har_index_export` 描述 "每个 HAR 模块" → "每个 HAR / HSP 库模块"。

### D. 推断提示词（从源头让 AI 正确建出 HSP，最关键）
- [profiles/hmos-app/skills/0-catalog-bootstrap/prompts/infer-module-card.md](profiles/hmos-app/skills/0-catalog-bootstrap/prompts/infer-module-card.md)：
  - Step 3（第 47 行）`format` 判定信号改明确：`module.type` 权威来源是 `<module>/src/main/module.json5 > module.type`（**HSP = `shared`**、HAP = `entry`/`feature`、纯 HAR 通常无 `module.json5`，仅靠 `oh-package.json5`），`oh-package.json5` 只取 `name/main/dependencies`；必要时结合工程根 `build-profile.json5` 的模块条目交叉确认。映射增加 `shared → HSP`。
  - Step 4（第 63 行）："HAP 通常无 HAR 导出入口" 处补一句 HSP 与 HAR 一样有 Index.ets 导出入口。
  - `### format`（第 116-120 行）：增加 HSP 分支（动态共享库），明确"其他层为 HAR 或 HSP，以 `module.json5 > module.type`（无则 oh-package）/ build-profile 为准"。
  - `### entry_file`（第 218-221 行）：HSP 与 HAR 同样取 `oh-package.json5 main`。
- [profiles/hmos-app/skills/0-catalog-bootstrap/profile-addendum.md](profiles/hmos-app/skills/0-catalog-bootstrap/profile-addendum.md)：`format` 合法取值列表（第 36-38 行）增加 `HSP`；第 48、53 行的 `HAP/HAR` 判定说明补 HSP。
- [profiles/hmos-app/skills/0-catalog-bootstrap/templates/module-card-template.yaml](profiles/hmos-app/skills/0-catalog-bootstrap/templates/module-card-template.yaml)：`format` 注释示例补充 HSP 选项（非必填，保持文档一致）。

### E. schema / 文档一致性
- [profiles/profile-schema.yaml](profiles/profile-schema.yaml) 第 37 行：典型值描述补 `HSP`。
- [docs/atomic-service-roadmap.md](docs/atomic-service-roadmap.md)：涉及 `HAP/HAR/AtomicService` 形态枚举的描述同步加 HSP（仅文档）。
- [harness/scripts/utils/types.ts:483](harness/scripts/utils/types.ts) `catalog_allowed_module_formats` 字段注释「缺省 HAP/HAR/AtomicService」与实际 `DEFAULT_CATALOG_ALLOWED_MODULE_FORMATS = ['application','library','service','document']`（[profile-loader.ts:207](harness/profile-loader.ts)）不符——顺手改成准确描述（缺省为 generic 默认枚举，hmos-app 典型值 HAP/HAR/HSP/AtomicService 由其 profile.yaml 声明）。

### G. Skill 2 design 产物侧（review 补充 — 防止 design 阶段把 HSP 写回 HAR）
> 关键链路：coding 的 `har_index_export` 读 `contracts.yaml > modules[].format`；design 阶段写错 format 会一路错下去。
- [profiles/hmos-app/phase-rules-overlays/design-rules.overlay.yaml](profiles/hmos-app/phase-rules-overlays/design-rules.overlay.yaml) 第 116 行：模块变更摘要表 "格式（HAP/HAR）" → "格式（HAP/HAR/HSP）"。
- [profiles/hmos-app/skills/2-requirement-design/profile-addendum.md](profiles/hmos-app/skills/2-requirement-design/profile-addendum.md) 第 7 行："常见模块格式为 HAP / HAR" → 加 HSP。
- [profiles/hmos-app/skills/2-requirement-design/templates/design-template.md](profiles/hmos-app/skills/2-requirement-design/templates/design-template.md) 第 88-92 行模块表与依赖图：补一行 HSP 示例（或在格式列注明 HAR/HSP 均可），明确库模块可为 HAR 或 HSP。

### H. Skill 3 coding 指南/模板/verifier 侧（review 补充 — 防止编码阶段仍按 HAR 口径思考）
- [profiles/hmos-app/skills/3-coding/profile-addendum.md](profiles/hmos-app/skills/3-coding/profile-addendum.md) 第 3、34、39 行：`HAR/HAP`、"新增 HAR/HAP"、"各 HAR 模块 oh-package main" → 纳入 HSP（HSP 与 HAR 同样靠 Index.ets 导出）。
- [profiles/hmos-app/skills/3-coding/templates/coding-standards.md](profiles/hmos-app/skills/3-coding/templates/coding-standards.md) 第 52 行 "HAR 模块（其余）" 及 §5 "HAR 模块导出规范"：说明库模块含 HAR/HSP，导出规范一致。
- [profiles/hmos-app/skills/3-coding/templates/module-scaffold.md](profiles/hmos-app/skills/3-coding/templates/module-scaffold.md) 第 3、9 行 "新模块（HAR/HAP）"、"新建 HAR 模块"：补 HSP。
- [profiles/hmos-app/harness/prompts/verify-coding.overlay.md](profiles/hmos-app/harness/prompts/verify-coding.overlay.md) 第 7 行 "跨模块导出：HAR 模块对外 API" → "HAR/HSP 库模块"。
- Skill 3 reference 权威资产（被 [3-coding/profile-addendum.md:8](profiles/hmos-app/skills/3-coding/profile-addendum.md) 列为权威）残留 HAR-only 认知，**只改关键标题/说明，不重写所有示例**：
  - [arkts-pitfalls.md:150](profiles/hmos-app/skills/3-coding/reference/arkts-pitfalls.md)「## 7. HAR 模块必须通过 Index.ets 导出」→ "HAR/HSP 库模块"。
  - [harmony-api-guide.md:3,11](profiles/hmos-app/skills/3-coding/reference/harmony-api-guide.md) "多模块（HAR/HAP）架构"、"HAR 模块的 oh-package.json5" 小节标题/引言补 HSP。
  - [arkui-patterns.md:271,281](profiles/hmos-app/skills/3-coding/reference/arkui-patterns.md) 仅为示例注释里的模块名（"来自 xxx HAR 模块"），优先级最低，可顺手统一为"库模块"或保持不动。

### I. Skill 4 review 与 runbook / test-plan 文档同步（review 补充 — 清除旧认知）
- [profiles/hmos-app/skills/4-code-review/templates/review-checklist.md](profiles/hmos-app/skills/4-code-review/templates/review-checklist.md) 第 162-165 行 "6.3 HAR 导出" / "每个 HAR 模块有 Index.ets"：改为 HAR/HSP 库模块。
- [profiles/hmos-app/skills/4-code-review/profile-addendum.md](profiles/hmos-app/skills/4-code-review/profile-addendum.md) 第 3、22 行 "HAR 导出"：补 HSP。
- [docs/operations/harness-runbook.md](docs/operations/harness-runbook.md) 第 197 行 "HAR 模块 key_exports 与 Index.ets 漂移" → "HAR/HSP 库模块"。
- [profiles/hmos-app/skills/6-device-testing/templates/test-plan-template.md](profiles/hmos-app/skills/6-device-testing/templates/test-plan-template.md) 第 18 行 `{HAP/HAR}` → `{HAP/HAR/HSP}`。

### F. 测试（AGENTS.md BLOCKER：改发布内容后 `cd harness && npm test` 必须全 PASS）
- **单测（必做）**：扩展 [profiles/hmos-app/harness/tests/unit/har-index-export.unit.test.ts](profiles/hmos-app/harness/tests/unit/har-index-export.unit.test.ts)（或新增同目录单测）覆盖 `isLibraryFormat`，并断言 `catalog-entry-file-har` / `catalog-key-exports-har` / `coding-host-rules` 对 `format: HSP` 模块生效。
- **集成夹具（必做，由 review 升级为硬要求）**：在 check-catalog 测试链路补一例 `format: HSP` 的 catalog 夹具，端到端证明：① 过 `format_value_valid`（验证 profile.yaml SSOT → profile-loader → overlay 合并 → check-catalog 三者真正联动，不止 `isLibraryFormat` 单元行为）；② HSP 进入 `entry_file_matches_oh_package_main`；③ HSP 进入 `key_exports_fresh_vs_index`。另在 coding 链路补一例验证 HSP 进入 `har_index_export`。
- 跑 `cd harness && npm test` 确认全绿。

## 实施前置：OpenSpec 变更承载（review 补充 — framework 自身演进按 AGENTS.md 走 OpenSpec）
> 当前 [openspec/changes/](openspec/changes) 无活跃 HSP change；本 `.cursor/plans` 文件仅为工作计划，不替代 OpenSpec。
- 在落地代码前，按 `/opsx-propose` 新建一个 OpenSpec change（如 `hmos-app-hsp-module-format`），产出 `proposal.md` / `tasks.md` 及相关 spec delta，至少记录：
  - HSP 作为 hmos-app catalog `format` 合法值；
  - HSP 与 HAR 在 hmos-app profile 语义下同属 library format（等价对待）；
  - HSP 暂不引入动态包 / 运行时差异化门禁；
  - 后续若需 HSP 专属约束（首包大小、分包边界等），另开议题。
- **变更边界（review 强调，BLOCKER 级约束）**：本次范围必须锚定为「**hmos-app profile 支持 HSP library format**」，**不得**写成"通用 framework 全局支持 HSP"。spec delta 落在 [openspec/specs/harness-gates/spec.md](openspec/specs/harness-gates/spec.md)，或新建一个更贴切的 profile/module-format 能力 spec；措辞、Requirement/Scenario 均以 hmos-app 为限定主语（generic 等其他 profile 的 `catalog_allowed_module_formats` 不动）。
- `npm run openspec:validate` 通过后再进入 A–I 实施，实施完成后按 `/opsx-archive` 归档。

## 不需要改动（已确认）

- 术语表推断 [infer-glossary-term.md](profiles/hmos-app/skills/0-catalog-bootstrap/prompts/infer-glossary-term.md)：按 catalog 全量扫描、不按 format 过滤，catalog 修好后自动覆盖 HSP。
- hvigor 编译/UT：`coding_compile` 走项目级 `assembleApp`、UT 走 `genOnDeviceTestHap`，均不按模块 format 分支选 task，对 HSP 天然适用（代码中仅有注释提及 HAR/HSP，无 format 驱动逻辑）。

## 决策点（已自主选定，可调整）

- HSP 与 HAR 在 framework 内**完全等价对待**（库模块语义），不为 HSP 引入差异化规则；如未来需要区分动态分包约束，另开议题（参考 atomic-service-roadmap 的预留模式）。
- 引入 `isLibraryFormat` 共享判定而非各处内联 `['HAR','HSP'].includes()`，消除魔法字符串。