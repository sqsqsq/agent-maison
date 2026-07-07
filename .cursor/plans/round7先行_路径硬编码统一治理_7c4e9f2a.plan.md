---
name: round7 先行批 — 路径硬编码统一治理（harness 读写路径解析层；skills/gitignore 另批）
version: 2.4.0
# 版本说明：用户拍板（2026-07-07）round7 其余项暂不做，仅此项先行——不依赖宿主数据，
# 做完后再打发布件。2.4.0 窗口不 bump（用户控版本）。
overview: >
  背景：codex 在子批A/子批B review 中两度附带发现——framework 与 profile harness 内
  大量历史硬编码 doc/features，自定义 paths.features_dir 的宿主会在多处先断（门禁读不到
  ui-spec/spec.md/acceptance 等 → 静默失效或误报缺失）。属既有债非近批引入；子批B 已就
  台账链路（structure-ledger + coding-visual-parity-check 入口）修了两处并留下先例模式，
  本批把剩余生产代码一次收敛。
  全量摸底结论（rg 路径构造类命中，注释/纯示意文案不计）：病根主体在**共享 helper**——
  harness/scripts/utils/ui-spec-shared.ts 的 uiSpecAbsPath/uiSpecRelPath/visualParityAbsPath
  三函数硬编码 doc/features，被 15+ 文件消费（visual-diff-check/capture、
  capture-completeness、asset-manifest-check、asset-crop-validation、asset-acquisition、
  ui-spec-bbox-semantic、structured-ref-elements、spec-ui-spec-check、static-fidelity-score、
  fidelity-governance-check、plan-visual-parity-check、check-testing、fidelity-lock-shared、
  harness-runner 等）——改 helper 即一次性治愈大面；其余为 framework/profile 两层散点。
  改法统一走 config.ts 的 featureDir/relFeatureFile/featuresDirPath（尊重 paths.features_dir；
  scripts/utils 已有 28 文件 import config 的先例，无循环依赖；实现时仍须确认 config.ts
  不反向依赖被改文件，若有环改函数体内惰性解析）。
  范围外（显式声明，防 review 扯皮）：①adhoc-canonical-paths.ts 的 _adhoc 路径——独立契约
  （STEPS_FILE_CONTRACT 有字面量契约测试+skill 文案联动），单独批次；②canonical-gitignore.ts
  的 doc/features/* ignore 模式——custom 宿主 ignore 失配真实存在（reports/goal-runs/
  _fidelity-cache 会漏进宿主 git），但 CANONICAL_IGNORE_PATTERNS 与 IGNORE_EQUIV_PATTERNS
  是超大字面量映射、动态化牵动 canonical-gitignore.unit.test 全部字面量契约断言，属 init
  链路独立子系统，defer 到 skills 批一并做（见下「根因闭环边界」）；③fan-out-scanner 的
  doc/module-catalog.yaml、adhoc-dump-ui 的 doc/app-snapshot-cache——非 features_dir 范畴；
  ④测试 fixture 的默认布局字面量（默认 features_dir 仍为 doc/features，行为等价，不动）；
  ⑤注释与纯示意文案。
  门禁语义说明：本批为路径解析 bugfix，不新增/不改任何门禁语义与判据，phase-rules yaml
  不动；默认布局宿主零行为变化（以全量既有测试绿佐证），自定义 features_dir 宿主的
  **harness 读写路径**从"多处先断"变为全链路可达。
  【根因闭环边界（诚实声明，两轮 review 共识补入）】本批只治 **harness 生产代码**的路径
  解析；agent 侧的**写路径**仍由 operational skills/prompts 决定，而这些文件（coding/
  spec/business-ut/goal-mode SKILL、user-confirmation-ux、verify-review.md 等）大量直接
  写 doc/features 且**真驱动 agent 落盘/跑命令**（实锤：spec SKILL:169 落 ui-spec.yaml、
  business-ut SKILL:251 命令样例 --file doc/features/.../testability-audit.md、coding
  SKILL:176-177 资产/白名单路径）。故在 skills 批完成前，**custom features_dir 宿主端到端
  仍不通**（agent 按 skill 写 doc/features、harness 按 config 读 custom_dir）——本批不声称
  端到端闭环，只声称 harness 读写侧正确。skills 层性质与本批不同（静态文档无法插值，只能
  改为「<features_dir>/<feature>/…，默认 doc/features/<feature>/…」占位符表达，靠 agent 读
  config 替换；且需逐文件分类真驱动/纯历史示意，无单测可验收）。
  【scope 已定·2026-07-07 用户拍板 A】harness 先行独立发版，skills+gitignore **不并入本批**、
  紧随下一子批——本批边界即 harness 生产代码读写路径解析，做完全绿即可打发布件。
todos:
  - id: a-shared-helpers
    content: >
      A 共享 helper 收敛（根治面）：①ui-spec-shared.ts:168-178 三函数
      uiSpecAbsPath/uiSpecRelPath/visualParityAbsPath 改走 featureDir/relFeatureFile
      （签名不变，projectRoot 已在参）；②fidelity-shared.ts:217（spec.md）/:250
      （ref-elements.yaml）/:254（asset-manifest.yaml）；③fidelity-lock-shared.ts:59
      （_fidelity-cache 目录）；④acceptance-layering.ts:34（acceptance.yaml rel）/:42
      （device-testing-todo.md）；⑤coverage-evidence.ts:36/:40、ac-coverage-report.ts:106/:142
      （ut reports 路径）。实现前先查 config.ts 是否反向 import 上述文件（防环），有环则
      函数体内惰性解析。
    status: completed
  - id: b-framework-callsites
    content: >
      B framework 入口散点：①harness-runner.ts:1242 直接 path.join 硬编码（同函数 :1245
      已在用 uiSpecRelPath，双轨并存）→ 改用 uiSpecAbsPath；②check-testing.ts:2098、
      check-review.ts:724 的 spec.md 读取 → featureDir/relFeatureFile（若 A② 后
      fidelity-shared 已有 spec.md helper 则直接复用，避免第三套口径）；
      ③goal-runner.ts:423 与 goal-report-generator.ts:201 的
      headless-assumptions.md rel 路径（进 prompt 指导 agent 写文件 + 报告引用——custom
      宿主下 agent 按文案写 doc/features 而消费方按 features_dir 读，产物落错树）→
      relFeatureFile；④harness-runner.ts:1097/1102（feature 解析失败的 description/suggestion
      诊断文案）、:1468（历史 verdict/report 路径 console.log 提示）——生产诊断文案，custom
      宿主误导，与 C⑨ 同属文案类，占位符化或 relFeatureFile 动态化（codex P3 附带发现）。
    status: completed
  - id: c-profile-callsites
    content: >
      C profile 散点（profiles/hmos-app/harness）：①asset-crop-validation.ts
      :169/:209/:447（spec/reports 报告路径）、:322（spec.md）、:274/:369（assets 回退
      rel 路径模板）；②asset-acquisition.ts:56（spec.md）/:98（assets 回退 rel）；
      ③asset-manifest-check.ts:74（spec.md）；④plan-visual-parity-check.ts:41
      （visual-parity.yaml rel，可直接换 A① 治好的 helper）/:44（spec.md）；
      ⑤fidelity-governance-check.ts:193（asset-manifest 路径，换 A② helper）；
      ⑥visual-parity-backstop.ts:932（visible-text-exemptions.yaml）；
      ⑦ut-file-scope.ts:39-40（context-exploration.md 候选）；⑧evidence-tamper-scan.ts:61
      默认参数 featuresDir='doc/features' 收紧——默认改为函数体内 featuresDirPath(projectRoot)
      解析，杜绝"调用方漏传即回退硬编码"（现唯一生产调用方 visual-diff-check.ts:728 已传
      配置值，子批A 修的；此处治的是默认值火药桶本身）；⑨spec-ui-spec-check.ts:92 与
      device-install-diag.ts:218 的 suggestion/诊断输出文案（agent/用户可见，custom 宿主
      误导）——文案类，用 relFeatureFile 动态化或占位符表达。凡"指导 agent 写文件"的
      suggestion 文案中的 doc/features 字面量随所在文件顺手动态化（如
      coding-visual-parity-check.ts:211 的 visible-text-exemptions 登记指引），纯示意文案不动。
    status: completed
  - id: d-regression-and-green
    content: >
      D 回归测试与全量绿：①新增单测（沿用 structure-ledger.unit.test 的
      framework.config.json + clearFrameworkConfigCache 先例）——custom features_dir 下
      uiSpecAbsPath/uiSpecRelPath/visualParityAbsPath、fidelity-shared 三 helper、
      acceptance-layering、coverage-evidence/ac-coverage-report 解析正确；默认布局（无
      framework.config.json）回落 doc/features；②**生产入口级**用例（≥2，防"helper 修好、
      入口仍断"——子批B codex round3 教训：checkVisualParity 入口自己的硬编码让门禁在
      custom 目录下提前 return）：(a) custom features_dir 下 spec-ui-spec-check（或
      visual-diff-check）走完整 check 入口能读到 ui-spec；(b) harness-runner bundle 注入
      用例——:1242 是喂给 agent 的 prompt 上下文来源，custom 目录下若仍硬编码 agent 根本
      看不到 ui-spec，须验 bundle 注入路径随 features_dir 走；附注 visual-diff-check.ts:599
      的 ui-spec 读取（P0-9 已治该文件 spec.md/report 路径，ui-spec 仍走 uiSpecAbsPath）随
      A① 一并治好、用例覆盖；③**收尾兜底扫（codex P3）**：全仓 rg "doc/features" 人审一遍，
      把生产诊断/suggestion 类同类误导项一并动态化（本批已知项已入清单，兜底扫防漏），
      纯历史说明/事故复盘/注释/fixture/skills（下一批）不动；④npm run typecheck + 全量 unit
      + fixtures 全绿；⑤plan 勾选回填，等 review 提交，提交后打发布件（发版时机用户控制）。
    status: completed
---

# round7 先行批 — 路径硬编码统一治理

## 摸底清单（2026-07-07，rg 全仓路径构造类命中）

### 病根主体：共享 helper（改一处治多处）

| 文件 | 行 | 内容 |
|---|---|---|
| harness/scripts/utils/ui-spec-shared.ts | 168-178 | uiSpecAbsPath / uiSpecRelPath / visualParityAbsPath 三函数硬编码，15+ 消费文件全部被动中毒 |
| harness/scripts/utils/fidelity-shared.ts | 217 / 250 / 254 | spec.md / ref-elements.yaml / asset-manifest.yaml |
| harness/scripts/utils/fidelity-lock-shared.ts | 59 | _fidelity-cache 目录 |
| harness/scripts/utils/acceptance-layering.ts | 34 / 42 | acceptance.yaml / device-testing-todo.md |
| harness/scripts/utils/coverage-evidence.ts | 36 / 40 | ut/reports/flow-dag、coverage-evidence.json |
| harness/scripts/utils/ac-coverage-report.ts | 106 / 142 | ut/reports/ac-coverage.json 及其目录 |

### framework 入口散点

| 文件 | 行 | 内容 |
|---|---|---|
| harness/harness-runner.ts | 1242 | ui-spec 绝对路径（:1245 同函数已用 uiSpecRelPath，双轨） |
| harness/scripts/check-testing.ts | 2098 | spec.md |
| harness/scripts/check-review.ts | 724 | spec.md |
| harness/scripts/goal-runner.ts | 423 | headless-assumptions.md rel（prompt 指导 agent 写文件） |
| harness/scripts/utils/goal-report-generator.ts | 201 | 同上（报告引用侧） |

### profile 散点（profiles/hmos-app/harness）

| 文件 | 行 | 内容 |
|---|---|---|
| asset-crop-validation.ts | 169/209/274/322/369/447 | 报告路径×3、spec.md、assets 回退 rel×2 |
| asset-acquisition.ts | 56 / 98 | spec.md、assets 回退 rel |
| asset-manifest-check.ts | 74 | spec.md |
| plan-visual-parity-check.ts | 41 / 44 | visual-parity.yaml rel、spec.md |
| fidelity-governance-check.ts | 193 | asset-manifest 路径 |
| visual-parity-backstop.ts | 932 | visible-text-exemptions.yaml |
| ut-file-scope.ts | 39-40 | context-exploration.md 候选 |
| evidence-tamper-scan.ts | 61 | 默认参数 'doc/features'（调用方已传对，默认值是火药桶） |
| spec-ui-spec-check.ts | 92 | suggestion 文案「产出 doc/features/…/ui-spec.yaml」（agent 可见） |
| device-install-diag.ts | 218 | 诊断输出「详见 doc/features/…/reports」（用户/agent 可见） |

### 已治（先例，不在本批）

- structure-ledger.ts、coding-visual-parity-check.ts —— 子批B 已修（featureDir 模式 + custom 目录生产入口集成测试）。
- visual-diff-check.ts:728 tamper 扫描调用 —— 子批A 已传 featuresDirPath。

### 下一批预清点：operational skills / prompts（根因另一半，agent 写路径）

> 两轮 review 共识：不治这层则 custom 宿主端到端不通。列此表供 skills 批开工用；本批不动。
> 改法：占位符表达「`<features_dir>/<feature>/…`，默认 `doc/features/<feature>/…`」，逐文件分类「真驱动写文件/跑命令」vs「纯历史说明/事故复盘/架构示意」，仅前者改。

| 文件 | 行（示例）| 性质 |
|---|---|---|
| skills/feature/spec/SKILL.md | 169 | 落盘 ui-spec.yaml / ref-elements.yaml 路径（真驱动） |
| skills/feature/coding/SKILL.md | 15 / 176 / 177 | 定位协议 + 资产 crop 源路径 + visible-text-exemptions 落盘（真驱动） |
| skills/feature/business-ut/SKILL.md | 161 / 251-252 | context-exploration 落盘 + validate 命令 --file 样例（真驱动跑命令） |
| skills/project/goal-mode/SKILL.md | 133 | goal-runs 证据路径（读引用） |
| skills/reference/user-confirmation-ux.md | 187 | headless-assumptions 路径（与 goal-runner:423 同源） |
| harness/prompts/verify-review.md | 多处 | review 阶段路径引用 |
| skills/feature/code-review、device-testing SKILL.md | 多处 | 复核/测试路径引用 |
| harness/scripts/utils/canonical-gitignore.ts | 27/28/32/33 + IGNORE_EQUIV | .gitignore 模式失配（custom 宿主 reports/goal-runs 漏进 git）；动态化牵动契约测试，与 skills 批一并做 |
| harness/scripts/check-ut.ts | 336 / 868 / 2919 | DAG/gap-notes/mock-plan `<feature>` 指令文案（指导 agent 写文件） |
| harness/scripts/check-testing.ts | 2258 | hypium workdir `<feature>` 提示文案 |
| profiles/hmos-app/harness/coding-visual-parity-check.ts | 211 | visible-text-exemptions 登记 `<feature>` 指引文案 |
| harness/compat-messages.ts | 11 / 24 / 30 | compat.yaml `{feature}` 静态消息模板（无 ctx，需 fillCompatMessage 层注入或占位符） |
| harness/scripts/check-coding.ts | 213 | docs_committed 说明里的 `doc/features/**` glob 注解 |

> 上表末 5 项由本批**兜底扫（D③）新增发现**：均为 `<feature>`/`{feature}` 占位符指令/说明文案（agent-facing，与 skills 同性质），非具体解析路径——按本批诚实边界归入 skills/文案 批统一占位符化（`<features_dir>/<feature>/…`）。本批已修的 device-install-diag:218 与 spec-ui-spec-check:92 属 plan C 明列项故先行。

### 范围外（声明）

- adhoc-canonical-paths.ts（_adhoc 独立契约，字面量契约测试 + skill 文案联动，单独批）
- fan-out-scanner.ts 的 doc/module-catalog.yaml、adhoc-dump-ui.ts 的 doc/app-snapshot-cache（非 features_dir 范畴）
- config 默认值/回退（DEFAULT_CONFIG.features_dir、`cfg.paths.features_dir ?? 'doc/features'` 等——定义/读取默认，正确）
- 测试 fixture 默认布局字面量、注释与纯示意文案

---

## 实现记录（2026-07-07 开工，全绿收口）

**验收**：`npm run typecheck` ✓ + 全量单测 **1458 passed / 0 failed**（+3 新增 path-governance）+ fixtures **35/35**。不改任何门禁语义、phase-rules yaml 未动；默认布局宿主零行为变化（全量既有测试佐证）。

**A 共享 helper（根治面）**：ui-spec-shared（uiSpecAbsPath/uiSpecRelPath/visualParityAbsPath）、fidelity-shared（loadSpecMarkdown/refElementsAbsPath/assetManifestAbsPath）、fidelity-lock-shared（fidelityCacheAbsPath）、acceptance-layering（acceptanceYamlRel/Path、legacyDeviceTestingTodoPath）、coverage-evidence（ephemeralFlowDagRel/coverageEvidenceRel/…Dir）、ac-coverage-report（acCoverageReportPath/writeAcCoverageReport）全部改走 featureFilePath/relFeatureFile。防环确认：config 仅 import fs/path/profile-loader/repo-layout，不反向依赖被改文件。

**签名级联**（rel 函数原缺 projectRoot）：acceptanceYamlRel、ephemeralFlowDagRel、coverageEvidenceRel 加 projectRoot 参数，调用方 check-acceptance:33、check-ut:2306 同步。

**B framework 入口**：harness-runner:1242（bundle 注入 ui-spec 改 uiSpecAbsPath）、check-testing:2098 与 check-review:724（spec.md 复用 loadSpecMarkdown/featureFilePath）、harness-runner:1097/1102/1468（诊断文案复用 featuresRel/relFeaturesDir）。

**偏差①（已同步）**：goal-runner headless-assumptions 双侧闭环需要 projectRoot——`buildUnattendedExecutionBlock` 与 `buildPhasePrompt` **加 projectRoot 参数**（buildPhasePrompt 是 export、10 处测试调用同步补参，用 FRAMEWORK_ROOT 占位；生产调用 :1335 传真实 projectRoot）。goal-report-generator:201 消费侧同改 relFeatureFile。这是 plan B③ 的必要落地，非计划外扩张。

**C profile 散点**：asset-crop-validation（6 处）、asset-acquisition（2）、asset-manifest-check（1）、plan-visual-parity-check（2）、fidelity-governance-check（:193 复用 assetManifestAbsPath）、visual-parity-backstop（:932）、ut-file-scope（:39-40）、spec-ui-spec-check（:92 用作用域内 uiSpecRel）、device-install-diag（:218 占位符）全部改走 config helper。

**偏差②（已同步）**：evidence-tamper-scan `collectVisualDiffTamperArtifacts` 默认参数 `featuresDir='doc/features'` → `featuresDir?: string`，函数体内缺省解析 featuresDirPath(projectRoot)——**火药桶拆除**（调用方漏传不再回退硬编码）。round6-antiforgery 的 `tamper_scan_respects_custom_features_dir` 断言随之反转（默认扫也命中自定义目录，1 而非 0），记为**预期行为改进**，注释已更。

**D③ 兜底扫**：全仓 rg "doc/features" 人审。修具体 `${ctx.feature}` 诊断：compat-loader:315/343（复用 relCompat）、check-ut:1000/1021（relFeatureFile）。`<feature>`/`{feature}` 占位符指令文案 5 项归 skills/文案 批（见上表）。config 默认值/回退、canonical-gitignore、adhoc、注释不动。

**D①②新增测试**：harness/tests/unit/path-governance.unit.test.ts（run-unit 注册）——① 全 A helper 自定义 features_dir 解析正确；② 默认布局回落 doc/features；③ 生产入口 checkVisualFidelityReview 在自定义目录读到 spec.md（防"helper 修好、入口仍断"）。另 structure-ledger 的 checkVisualParity 生产入口用例经本批 loadSpecMarkdown 一并覆盖。

**偏差③（cursor review · 已同步）**：plan D②(b) 期望的 harness-runner bundle 注入专用单测**未直接补**——:1242 所在 `collectContextFiles` 是 harness-runner 内部私有函数，而 harness-runner.ts:1518 `main().catch()` **无 `require.main===module` 守卫、导入即自执行 CLI**，单测导入会触发 main 副作用，不可安全直测。为一个低风险覆盖缺口给 CLI 主入口加守卫/抽模块属过度改造、超出本批（路径治理）范围。实际覆盖：:1242 注入行 = `uiSpecAbsPath` + existsSync + push `uiSpecRelPath`，这两个 helper 的自定义目录解析已被 path-governance 单测确定性验证，注入行本身平凡。cursor 亦评为 low / 不阻塞发版。若后续单独治理 harness-runner 入口可测性（加 require.main 守卫），再补此专用用例。
