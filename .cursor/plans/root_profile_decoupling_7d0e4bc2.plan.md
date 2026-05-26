---
name: root profile decoupling
overview: 继续清理根 framework 中的 hmos-app/Harmony/ArkTS/钱包域残留，把宿主细则下沉到 profile overlay/provider/addendum，让根目录只保留 profile-neutral 编排和通用契约。
todos:
  - id: define-provider-boundaries
    content: 定义 coding/ut/testing/profile-paths 的 provider 边界与 registry 调度方式
    status: completed
  - id: split-coding-rules
    content: 将 check-coding.ts 中 hmos-app 规则拆到 profile provider，根脚本保留通用编排
    status: completed
  - id: split-ut-rules
    content: 将 check-ut.ts 中 ohosTest/Hypium/hvigor/hdc 规则拆到 profile provider
    status: completed
  - id: neutralize-root-skills
    content: 中性化根 framework/skills 文档并把钱包/ArkUI/DevEco 示例迁入 hmos-app addendum/examples
    status: completed
  - id: neutralize-specs-utils
    content: 中性化根 phase-rules 注释与通用 utils 中的 profile-specific 默认值
    status: completed
  - id: add-regression-tests
    content: 补 generic 与 hmos-app provider 回归测试，覆盖 SKIP 与行为兼容
    status: completed
  - id: verify-decoupling
    content: 运行 unit/fixture 测试并做根目录 profile-specific residue scan
    status: completed
isProject: false
---

# Root Profile Decoupling Plan

## 目标

把根目录 [framework/skills](e:\1.code\SimulatedWalletForHmos\framework\skills)、[framework/specs](e:\1.code\SimulatedWalletForHmos\framework\specs)、[framework/harness/scripts](e:\1.code\SimulatedWalletForHmos\framework\harness\scripts) 中仍然绑定 `hmos-app`、Harmony、ArkTS、hvigor、ohosTest、钱包示例的内容继续下沉到 [framework/profiles/hmos-app](e:\1.code\SimulatedWalletForHmos\framework\profiles\hmos-app)。

## 现状依据

- 根 Skill 文档仍有示例污染：
  - [framework/skills/0-catalog-bootstrap/SKILL.md](e:\1.code\SimulatedWalletForHmos\framework\skills\0-catalog-bootstrap\SKILL.md) 仍有 `WalletMain` / `CardManager` / 卡聚合示例。
  - [framework/skills/1-prd-design/SKILL.md](e:\1.code\SimulatedWalletForHmos\framework\skills\1-prd-design\SKILL.md) 仍用卡中心、添卡入口、Fake NavPathStack / spy showToast 示例。
  - [framework/skills/2-requirement-design/SKILL.md](e:\1.code\SimulatedWalletForHmos\framework\skills\2-requirement-design\SKILL.md) 仍有 `build-profile.json5`、`WalletMain`、`CommUI`、`$r()`、`Index.ets` 等样例。
  - [framework/skills/5-business-ut/SKILL.md](e:\1.code\SimulatedWalletForHmos\framework\skills\5-business-ut\SKILL.md) 仍有 `card_opening`、`CardOpenFlow`、`@ohos/hypium`、`ohosTest`、`List.test.ets` 示例。
  - [framework/skills/00-framework-init/SKILL.md](e:\1.code\SimulatedWalletForHmos\framework\skills\00-framework-init\SKILL.md) 仍承担 DevEco/hvigor 探测与推荐 `hmos-app` 的逻辑说明，需要拆成中立初始化 + profile 探测 addendum。
- 根 harness 仍有宿主逻辑：
  - [framework/harness/scripts/check-coding.ts](e:\1.code\SimulatedWalletForHmos\framework\harness\scripts\check-coding.ts) 仍直接处理 `.ets`、`$r()`、`HAR`、`build-profile.json5`、`oh-package.json5`、`main_pages.json`、hvigor 编译等规则。
  - [framework/harness/scripts/check-ut.ts](e:\1.code\SimulatedWalletForHmos\framework\harness\scripts\check-ut.ts) 已把 UI 禁入表移到 profile，但 `ohosTest`、hvigor、Hypium/hdc 链路与路径扫描仍在根脚本中。
  - [framework/harness/scripts/utils/git-diff.ts](e:\1.code\SimulatedWalletForHmos\framework\harness\scripts\utils\git-diff.ts) 仍硬编码排除 `/src/ohosTest/`。
  - [framework/harness/scripts/check-testing.ts](e:\1.code\SimulatedWalletForHmos\framework\harness\scripts\check-testing.ts) 仍有 `HarmonyOS` 默认字段。
- 根 phase-rules 注释仍引用宿主名词：
  - [framework/specs/phase-rules/coding-rules.yaml](e:\1.code\SimulatedWalletForHmos\framework\specs\phase-rules\coding-rules.yaml)、[framework/specs/phase-rules/ut-rules.yaml](e:\1.code\SimulatedWalletForHmos\framework\specs\phase-rules\ut-rules.yaml)、[framework/specs/phase-rules/catalog-rules.yaml](e:\1.code\SimulatedWalletForHmos\framework\specs\phase-rules\catalog-rules.yaml)、[framework/specs/phase-rules/design-rules.yaml](e:\1.code\SimulatedWalletForHmos\framework\specs\phase-rules\design-rules.yaml) 的注释仍直接点名 Harmony/ArkTS/HAR/HAP。

## 实施方案

1. **先定义 profile provider 边界**
   - 在 [framework/profiles/hmos-app/harness](e:\1.code\SimulatedWalletForHmos\framework\profiles\hmos-app\harness) 新增/整理 provider：`coding-rules-hmos.ts`、`ut-toolchain-hmos.ts`、`profile-paths.ts` 或等价拆分。
   - 根 [framework/harness/capability-registry.ts](e:\1.code\SimulatedWalletForHmos\framework\harness\capability-registry.ts) 只负责按 capability/rule id 调度，不再知道 HAR/HAP、ohosTest、hvigor 的具体路径与文案。

2. **拆 `check-coding.ts` 的 hmos-app 规则**
   - 将 `.ets` 文件筛选、资源 `$r()` 完整性、HAR 导出入口、模块注册、oh-package 依赖、页面注册、命名规范、hvigor 诊断文案迁到 profile provider。
   - 根 [framework/harness/scripts/check-coding.ts](e:\1.code\SimulatedWalletForHmos\framework\harness\scripts\check-coding.ts) 保留：读取 contracts、通用文件存在性、通用架构分层/依赖、diff scope、traceability 聚合、provider 结果合并。
   - 已存在的 [framework/profiles/hmos-app/harness/har-export-resolve.ts](e:\1.code\SimulatedWalletForHmos\framework\profiles\hmos-app\harness\har-export-resolve.ts) 可作为第一块 provider 化资产继续扩展。

3. **拆 `check-ut.ts` 的 hmos-app 工具链规则**
   - 将 ohosTest 目录发现、Hypium import/注册、hvigor compile/run、hdc 设备执行、测试产物路径、命令 mismatch 归因迁到 hmos-app provider。
   - 根 [framework/harness/scripts/check-ut.ts](e:\1.code\SimulatedWalletForHmos\framework\harness\scripts\check-ut.ts) 保留 DAG、mock-plan、acceptance 覆盖、命名业务入口、testability-audit 等 profile-neutral 逻辑。
   - 已存在的 [framework/profiles/hmos-app/harness/ut-ui-import-ban.ts](e:\1.code\SimulatedWalletForHmos\framework\profiles\hmos-app\harness\ut-ui-import-ban.ts) 继续作为 UT profile rule-pack 的一部分。

4. **中性化根 Skill 文档，示例迁 profile**
   - 根 [framework/skills](e:\1.code\SimulatedWalletForHmos\framework\skills) 只保留流程、SSOT、phase boundary、contracts schema、profile addendum 加载规则。
   - 将钱包域示例与 ArkUI/DevEco/Hypium 示例搬到对应 profile addendum 或 examples：
     - [framework/profiles/hmos-app/skills/0-catalog-bootstrap](e:\1.code\SimulatedWalletForHmos\framework\profiles\hmos-app\skills\0-catalog-bootstrap)
     - [framework/profiles/hmos-app/skills/1-prd-design](e:\1.code\SimulatedWalletForHmos\framework\profiles\hmos-app\skills\1-prd-design)
     - [framework/profiles/hmos-app/skills/2-requirement-design](e:\1.code\SimulatedWalletForHmos\framework\profiles\hmos-app\skills\2-requirement-design)
     - [framework/profiles/hmos-app/skills/5-business-ut](e:\1.code\SimulatedWalletForHmos\framework\profiles\hmos-app\skills\5-business-ut)
   - 根文档中的示例统一改成 `<FeatureModule>`、`<BusinessCapability>`、`<source-ext>`、`<test-runner>`、`<profile-test-root>`。

5. **中性化 specs 与通用 utils 注释/默认值**
   - 根 [framework/specs/phase-rules](e:\1.code\SimulatedWalletForHmos\framework\specs\phase-rules) 注释改为 “宿主工具链/资源/模块格式细则在 profile overlay”。
   - 将 [framework/harness/scripts/utils/git-diff.ts](e:\1.code\SimulatedWalletForHmos\framework\harness\scripts\utils\git-diff.ts) 的测试目录排除改为从 profile 配置读取，hmos-app 配置为 `src/ohosTest`。
   - 将 [framework/harness/scripts/check-testing.ts](e:\1.code\SimulatedWalletForHmos\framework\harness\scripts\check-testing.ts) 的 `HarmonyOS` 默认值改为 profile 默认或中性占位。

6. **补充回归测试**
   - 为 generic profile 增加单测/fixture：确认未声明 `har_index_export` / `ut_import_whitelist` / hvigor capability 时根脚本 SKIP 或不加载 hmos provider。
   - 为 hmos-app profile 增加 provider 单测：HAR 入口、资源 key、页面注册、ohosTest 发现、UT 工具链命令仍保持原行为。
   - 保留当前 [framework/harness/tests/run-unit.ts](e:\1.code\SimulatedWalletForHmos\framework\harness\tests\run-unit.ts) profile suite discovery 机制。

7. **验证与收敛**
   - 跑 `cd framework/harness ; npm run test:unit`。
   - 跑 `cd framework/harness ; npm run test`，覆盖 fixture 回归。
   - 针对根目录做 residue scan：`framework/skills`、`framework/specs`、`framework/harness/scripts` 不应再出现未标注为“profile example / compatibility shim”的 hmos-app/Harmony/ArkTS/hvigor/ohosTest/钱包域术语。
   - 对允许保留的兼容 shim 写明注释：例如 [framework/harness/scripts/utils/hvigor-runner.ts](e:\1.code\SimulatedWalletForHmos\framework\harness\scripts\utils\hvigor-runner.ts) 与 [framework/harness/scripts/utils/hdc-runner.ts](e:\1.code\SimulatedWalletForHmos\framework\harness\scripts\utils\hdc-runner.ts) 若暂不删除，必须标注为旧导入兼容入口。

## 边界与不做

- 不改 plan 文件本身。
- 不在本轮处理 [framework/harness/config.ts](e:\1.code\SimulatedWalletForHmos\framework\harness\config.ts) 中较大的 legacy 默认 DSL / `project_type` alias 清理，除非实现 provider 配置时必须触碰最小字段。
- 不删除 hmos-app 功能，只把它从根目录下沉到 [framework/profiles/hmos-app](e:\1.code\SimulatedWalletForHmos\framework\profiles\hmos-app)。