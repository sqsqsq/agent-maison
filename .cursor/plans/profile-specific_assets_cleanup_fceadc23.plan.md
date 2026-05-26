---
name: profile-specific assets cleanup
overview: 系统性清理 framework 根目录 skills/specs/harness 中的 hmos-app/Harmony/ArkTS/hvigor 等具体工程形态残留：能直接删除或迁移的先处理，混合型 harness 规则通过 provider/rule-pack 抽象后下沉到 profile。
todos:
  - id: delete-skill-shims
    content: 删除 framework/skills 下已迁至 hmos-app profile 的 profile-specific 跳板与旧 wallet preset
    status: completed
  - id: neutralize-skill-docs
    content: 中性化 framework/skills 各阶段正文中的 Harmony/ArkTS/钱包域示例，并把细节补到 hmos-app addendum
    status: completed
  - id: move-spec-prompt-overlays
    content: 将 PRD/Design 中 ArkUI/NavDestination 规则与 verifier 语义迁入 hmos-app overlay
    status: completed
  - id: split-harness-providers
    content: 把 check-prd/check-coding/check-ut/check-catalog 中 hmos-app 具体规则拆到 profile harness provider/rule-pack
    status: completed
  - id: profile-unit-tests
    content: 迁移 hdc/hvigor/HAR 等单测到 profile 测试套件，并让根 unit runner 支持 profile suite discovery
    status: completed
  - id: verify-cleanup
    content: 重跑 framework 单测与全局/feature harness，确认根 framework 不再含 profile-specific 资产
    status: completed
isProject: false
---

# Profile-Specific Assets Cleanup

## 盘点结论

确认还有违反设计原则的残留，分三类处理：

- **A 类：可直接移出/删除的 profile-specific 跳板或文件**
  - [framework/skills/3-coding/reference/arkts-pitfalls.md](framework/skills/3-coding/reference/arkts-pitfalls.md)
  - [framework/skills/3-coding/reference/arkui-patterns.md](framework/skills/3-coding/reference/arkui-patterns.md)
  - [framework/skills/3-coding/reference/harmony-api-guide.md](framework/skills/3-coding/reference/harmony-api-guide.md)
  - [framework/skills/3-coding/templates/coding-standards.md](framework/skills/3-coding/templates/coding-standards.md)
  - [framework/skills/3-coding/templates/module-scaffold.md](framework/skills/3-coding/templates/module-scaffold.md)
  - 已迁正文但还留在 `framework/skills` 的 hmos-app 模板跳板：PRD/design/review/device-testing/catalog-bootstrap 相关跳板文件。
  - [framework/skills/00-framework-init/templates/preset-wallet-5-layer.sample.json](framework/skills/00-framework-init/templates/preset-wallet-5-layer.sample.json)，当前仍存在，且文件名含 `wallet`。

- **B 类：framework 根文件可保留，但必须中性化**
  - [framework/skills/00-framework-init/SKILL.md](framework/skills/00-framework-init/SKILL.md)：移除 “HarmonyOS 工程架构顾问”、DevEco/hvigor/hdc 配置步骤、`.ets` 探测、`atomic_service -> element-service` 等具体叙述，改为读取 profile addendum。
  - [framework/skills/00-framework-init/prompts/scan-project.md](framework/skills/00-framework-init/prompts/scan-project.md) 与 [framework/skills/00-framework-init/prompts/architecture-presets.md](framework/skills/00-framework-init/prompts/architecture-presets.md)：只保留通用扫描/预设机制，hmos-app 签名和 5 层 preset 说明迁到 profile。
  - [framework/skills/0-catalog-bootstrap/SKILL.md](framework/skills/0-catalog-bootstrap/SKILL.md)、[framework/skills/1-prd-design/SKILL.md](framework/skills/1-prd-design/SKILL.md)、[framework/skills/2-requirement-design/SKILL.md](framework/skills/2-requirement-design/SKILL.md)、[framework/skills/3-coding/SKILL.md](framework/skills/3-coding/SKILL.md)、[framework/skills/5-business-ut/SKILL.md](framework/skills/5-business-ut/SKILL.md)：替换钱包域、ArkUI、NavDestination、ohosTest、`.ets` 示例为 profile-neutral 占位或指向 profile addendum。
  - [framework/harness/schemas/summary.schema.json](framework/harness/schemas/summary.schema.json)：`$id` 仍是 `simulated-wallet-for-hmos.local`，应改为 framework-neutral。

- **C 类：harness/specs 需要抽象后下沉到 profile**
  - [framework/specs/phase-rules/prd-rules.yaml](framework/specs/phase-rules/prd-rules.yaml)：`ui_component_terminology` 的 ArkUI 规则迁到 [framework/profiles/hmos-app/phase-rules-overlays/prd-rules.overlay.yaml](framework/profiles/hmos-app/phase-rules-overlays/prd-rules.overlay.yaml)。
  - [framework/harness/prompts/verify-prd.md](framework/harness/prompts/verify-prd.md) 和 [framework/harness/prompts/verify-design.md](framework/harness/prompts/verify-design.md)：ArkUI/NavDestination 语义迁到 profile prompt overlay，根 prompt 保持通用。
  - [framework/harness/scripts/hmos-app/prd-visual-handoff-check.ts](framework/harness/scripts/hmos-app/prd-visual-handoff-check.ts)：迁到 hmos-app profile provider 内，根 [framework/harness/scripts/check-prd.ts](framework/harness/scripts/check-prd.ts) 通过 capability registry 调度。
  - [framework/harness/scripts/check-coding.ts](framework/harness/scripts/check-coding.ts)：拆出 HAR/HAP、oh-package、build-profile、main_pages、route_map、`.ets`、`$r`、hvigor 编译等 hmos-app 规则到 profile rule provider。
  - [framework/harness/scripts/check-ut.ts](framework/harness/scripts/check-ut.ts)：保留 DAG/mock-plan 中性逻辑，将 `src/ohosTest`、`*.test.ets`、Hypium、ArkUI 禁入、hvigor/hdc 运行等迁到 hmos-app provider。
  - [framework/harness/scripts/check-catalog.ts](framework/harness/scripts/check-catalog.ts)：将 HAR `key_exports` 与 `index.ets` 出口同步检查迁为 hmos-app catalog provider。
  - 根 unit runner 中的 hmos-app 单测迁到 profile 测试套件：`hdc-runner.unit.test.ts`、`hvigor-args.unit.test.ts`、`detect-product.unit.test.ts`、`har-index-export.unit.test.ts`。

## 实施策略

1. **先删跳板和显性文件名污染**
   - 删除 `framework/skills` 下已迁到 profile 的 hmos-app 跳板。
   - 删除或迁移 `preset-wallet-5-layer.sample.json`；若 profile 已有 [framework/profiles/hmos-app/skills/00-framework-init/templates/preset-5-layer.sample.json](framework/profiles/hmos-app/skills/00-framework-init/templates/preset-5-layer.sample.json)，根目录直接删除旧 wallet preset。

2. **中性化 skills 正文**
   - 根 `SKILL.md` 只描述阶段流程、SSOT、profile addendum 加载规则。
   - 将所有具体示例改为 `<module>`、`<profile-format>`、`<source-ext>`、`<test-runner>` 等占位。
   - hmos-app 具体说明补到对应 [framework/profiles/hmos-app/skills](framework/profiles/hmos-app/skills) 的 `profile-addendum.md`、模板或参考文件。

3. **拆分 phase rules 与 verifier prompts**
   - 根 [framework/specs/phase-rules](framework/specs/phase-rules) 只保留 profile-neutral 检查项。
   - ArkUI/NavDestination 等规则移入 hmos-app overlays。
   - 根 verify prompt 保持语义审查骨架；profile overlay 承载 ArkUI/Harmony 语义补充。

4. **profile 化 harness provider**
   - 为 coding/ut/catalog/prd 扩展 provider 或 rule-pack 调度接口。
   - 根 `check-*.ts` 只做通用编排、读 contracts、聚合结果。
   - hmos-app provider 实现 HAR/HAP、hvigor、hdc、Hypium、ArkUI、资源与页面注册等细则。

5. **迁移单测与验证链路**
   - 根 `run-unit.ts` 拆成 core suite + profile suite discovery。
   - hmos-app 工具链单测迁入 [framework/profiles/hmos-app/harness/tests](framework/profiles/hmos-app/harness/tests)。
   - 重跑 `framework/harness npm test`、`--phase docs/catalog/glossary/init`、以及 `home-page` 的 `prd/design/coding/review/testing`；`ut` 仍受设备连接影响。

## 保留但标注为兼容的例外

- [framework/harness/profile-loader.ts](framework/harness/profile-loader.ts) 和 [framework/harness/capability-registry.ts](framework/harness/capability-registry.ts) 可以留在根目录，因为职责是 profile 加载和 capability 分发；但其中 `hmos-app` 默认 fallback、`hvigor` provider id 映射应逐步外部化。
- [framework/harness/config.ts](framework/harness/config.ts) 中 `project_type=atomic_service` legacy alias、hmos-app 默认 DSL、DevEco 配置属于更大兼容面，建议放在第二阶段处理，避免一次性破坏现有实例。