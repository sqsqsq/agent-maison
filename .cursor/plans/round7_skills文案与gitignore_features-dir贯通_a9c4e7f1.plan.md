---
name: round7 skills/文案批 — agent 写路径 features_dir 贯通（三通道分级）+ gitignore 动态化
version: 2.4.0
# 版本说明：round7 先行批（7c4e9f2a，harness 读写路径解析）已落库（1f875c24）。
# 本批是其预清点的后继：治"根因另一半"——agent 侧写路径由 operational skills/prompts 决定，
# 这些文档硬编码 doc/features → custom features_dir 宿主"代码读 custom、agent 写 doc/features"。
# 2.4.0 窗口不 bump（用户控版本）。
overview: >
  全量摸底（rg skills/prompts/agents/specs，~260 命中 33 文件）后按**分发机制**分三通道，
  能真动态化的绝不用占位符凑合：
  【通道1·运行时替换（真动态化）】assembleAIPrompt（report-generator.ts:208-213）已有
  {feature_name}/{phase} 占位符替换机制——加一行 {features_dir} replace（relFeaturesDir(projectRoot)），
  harness/prompts/verify-*.md 的 doc/features 全部改 {features_dir} 占位符即彻底治愈
  （verify-ut 8 处 + verify-coding/testing 各2 + spec/plan/review 各1）。profile overlay
  （verify-*.overlay.md）同机制顺带生效。
  【通道2·init 模板渲染（真动态化）】template-renderer 已有 {{FEATURES_DIR}} 变量
  （AGENTS.md.template 先例在用）——architecture.md.skeleton.md（2 处，已走渲染：含
  {{PROJECT_NAME}} 等变量）直接换 {{FEATURES_DIR}}。canonical-gitignore.ts 函数化：
  CANONICAL_IGNORE_PATTERNS/IGNORE_EQUIV_PATTERNS 改为 canonicalIgnorePatterns(featuresDir)
  形态（默认参数 'doc/features' 时产出与现字面量逐条相等——零回归锚点），check-init 消费侧
  传 vars.FEATURES_DIR；custom 宿主的 reports/goal-runs/_fidelity-cache ignore 失配即根治，
  _adhoc 保持 doc/features/_adhoc 字面量（契约 scope-out，随 runtime 实际落点）。
  【通道3·verbatim 静态文档（占位符约定）】skills/*.md 与 agent-bundle rules（mdc，
  check-init 按 kind:'verbatim' 逐字复制，无渲染通道）、agents/claude/templates（verifier.md）
  只能占位符表达。约定：**真驱动**（落盘指令/写文件路径/命令样例——如 business-ut SKILL:251
  的 validate --file、spec SKILL:169 的 ui-spec 落盘、coding SKILL:176-177 资产/豁免表）改
  `<features_dir>/<feature>/…`；6 个 feature SKILL 均已有「基于 paths.features_dir 定位」
  协议段可锚定占位符语义（缺则补一句）；**读引用/示例**保留默认布局字面量（协议段已覆盖，
  避免 ~200 处全替换的噪音）；**纯历史/事故复盘/changelog** 一律不动。
  【上批 defer 的生产文案随本批】check-ut.ts:336/868/2919、check-testing.ts:2258、
  coding-visual-parity-check.ts:211、check-coding.ts:213（ctx 在手 → relFeatureFile/
  relFeaturesDir 真动态化）；compat-messages.ts 三条静态模板 → fillCompatMessage 增
  features_dir 注入（模板 {features_dir}/{feature}/compat.yaml；三个调用方 compat-loader:316 /
  context-exploration:512 / report-generator:65,72 的 projectRoot 可达性实现时逐一确认，
  拿不到的用调用方既有 rel 变量替代）。
  【范围外（硬理由）】①specs/phase-rules/*.yaml 的路径文案（spec 6/testing 5/ut/review/plan
  各1）：gate_fingerprint = phase-rules yaml 内容 hash（gate-fingerprint.ts:57）——纯文案改动
  会令宿主**全部存量回执 stale、强制全量重跑**，代价与收益完全不成比例；留待未来真语义
  改动时顺带。②specs/*.schema.yaml 示例路径（默认布局示例合法）。③.cursor/plans、fixture、
  纯历史文案。④adhoc-canonical-paths.ts（_adhoc 契约，维持先行批范围外结论）。
  【验收诚实声明】通道1/2 有机器验收（单测 + 全量绿）；通道3 无单测可验收——靠逐文件
  人工分类 + 用户/外部 AI review 复核，本批不假装给静态文档造"文案门禁"（判定"真驱动"
  机器做不到，窄判据必产 FP）。本批完成后 custom features_dir 宿主端到端贯通的最后一块
  已知短板补齐（余下为 round7 备选池其他项，与路径无关）。
todos:
  - id: e1-runtime-replace
    content: >
      E1 运行时替换通道：①assembleAIPrompt 加 {features_dir} 替换（relFeaturesDir(projectRoot)，
      与 {feature_name} 同点位 report-generator.ts:208-213）；②harness/prompts/verify-*.md
      全部 doc/features → {features_dir}（含 profiles/hmos-app/harness/prompts/*.overlay.md
      若有命中）。【cursor 提醒·占位符混用】verify-testing.md 现存 {feature_name}/<feature>/
      {feature} 三种写法混用（:58/:195）——替换目标统一为 {features_dir}/{feature_name}/…，
      同文件的 <feature>/{feature} 变体逐处排查对齐，防半替换；③上批 defer 生产文案动态化：
      check-ut.ts:336/868/2919、check-testing.ts:2258、coding-visual-parity-check.ts:211、
      check-coding.ts:213；④compat-messages.ts 模板改 {features_dir} + fillCompatMessage
      签名扩展（建议 fillCompatMessage(template, projectRoot, feature, phase) 内部
      relFeaturesDir 注入；三调用方 compat-loader:316 / context-exploration:512 /
      report-generator:65,72 的 projectRoot 可达性逐一确认）；⑤architecture.md.skeleton
      共**三份**（skills/project/framework-init/templates/ + profiles/hmos-app/doc-skeletons/ +
      profiles/generic/doc-skeletons/，cursor 摸底补正）→ 逐份确认是否走 init 渲染：走渲染的
      换 {{FEATURES_DIR}}（E1 只改模板内容，渲染接线即通道2既有机制）；不走渲染的按 E3
      占位符处理，不得只改一份。
      单测：assembleAIPrompt 产物含解析后路径不含裸 {features_dir}；fillCompatMessage
      custom dir 注入正确；默认布局输出与旧字面量等价。
    status: completed
  - id: e2-gitignore-dynamize
    content: >
      E2 canonical-gitignore 函数化：CANONICAL_IGNORE_PATTERNS / IGNORE_EQUIV_PATTERNS 改
      canonicalIgnorePatterns(featuresDir='doc/features') / ignoreEquivPatterns(featuresDir)
      函数形态（保留同名 const 导出=默认调用结果，兼容既有消费面可评估后定）。
      【_adhoc 例外（cursor 意见采纳；codex 断言示例在此项上与 ground truth 相悖，不采）】
      adhoc-canonical-paths.ts 硬编码 doc/features/_adhoc（先行批 scope-out 的独立契约），
      运行时 adhoc 产物**不随 features_dir 迁移**——gitignore 必须 ignore 文件实际落点，故
      '/doc/features/_adhoc/' 两处在 custom 态**保持字面量**；features_dir 派生的三类
      （*/*/reports/*、*/goal-runs/、*/ux-reference/_fidelity-cache/）动态化（与运行时一致：
      goal-runner/goal-manifest 读 cfg.paths.features_dir、fidelityCacheAbsPath 先行批已走
      featureFilePath、reports 回填派生自 features_dir）。若未来 adhoc 契约迁移，随迁。
      【消费面全链路（codex P1 采纳）】不止 check-init 主链路：ensureCanonicalGitignore /
      listMissingCanonicalPatterns / patternIsCovered / collectGitignoreAdvisories 整组 API
      统一吃 features_dir（内部按 projectRoot 解析或加 options），同步改造
      init-task-executor.ts:348（ensureCanonicalGitignore(ctx.projectRoot)）、check-init.ts:63-69
      常量导入、:1842 常量长度摘要、:2424 __testing 导出（inspect11）——防"custom 下只有
      某条入口生效"。
      单测双断言（codex P2 采纳，_adhoc 修正后）：①默认 canonicalIgnorePatterns() 与现
      CANONICAL_IGNORE_PATTERNS 逐条相等（零回归锚点）；②custom requirements/features 态
      生成 requirements/features/*/*/reports/* 等三类新模式、**不残留**对应 doc/features/*
      旧模式、且 /doc/features/_adhoc/ **保留字面量**。
    status: completed
  - id: e3-static-docs-placeholder
    content: >
      E3 verbatim 静态文档占位符（逐文件人工分类，真驱动才改）。
      【P0 子项·定位协议段自身（cursor 意见采纳）】六大 feature SKILL 的「Feature 归档定位
      协议」段现文案自相矛盾（"基于 paths.features_dir 精确定位 doc/features/<feature>/"——
      口头读 config、正文给死路径，agent 读到的第一条指令）：6 文件 ×1 处统一改为
      「精确定位 <features_dir>/<feature>/（默认 doc/features/<feature>/，SSOT =
      framework.config.json > paths.features_dir）」，最优先。
      【主清单】六大 feature SKILL（business-ut 42/device-testing 38/plan 35/coding 30/
      spec 25/code-review 23 命中中筛真驱动子集）、skills/project/goal-mode/SKILL.md:133、
      skills/reference/user-confirmation-ux.md:187（与 goal-runner headless-assumptions
      先行批已改的 rel 同源，须对齐动态语义）、confirmation-registry.yaml、
      consumer-framework-boundary.md、business-ut/paths/path-c-characterization.md、
      device-testing/reference/hylyre-host-preflight.md、spec/reference/ui-spec.md 与
      visual-handoff.md、code-review/templates/review-report-template.md、
      framework-init/prompts/spec-harness-options.md、agents/shared/agent-bundle/templates/
      rules/framework-agent-execution.mdc 与 framework.mdc、agents/claude/templates/agents/
      verifier.md。
      【profile 侧补入（codex P1 采纳，先行摸底漏扫 profiles/*/skills）】
      profiles/hmos-app/skills/device-testing/profile-addendum.md（9 处，含 cwd/reports 约定
      与测试报告写入——真驱动浓度高；**其中 doc/features/_adhoc/... 路径行除外**，同 E2
      契约理由保持字面量）、device-testing/templates/test-plan-template.md
      （hmos 4 + generic 3）、business-ut/templates/coverage-evidence-schema.md（3+3）、
      spec/templates/ui-spec-template.yaml（2）、plan/examples/example-plan.md（2，示例类
      倾向不改）；profiles/*/phase-rules-overlays/*.yaml（ut 23/plan 4/catalog 3，**其余
      overlay 含 spec-rules.overlay 等同判据顺手扫**——已核实 gate-fingerprint 只 hash
      specs/phase-rules 主文件、overlay **不进指纹**，文案可安全改）。
      【overlay 两类键区分（cursor 意见钉深）】overlay 里 description/suggestion 等**展示
      文案**直接按判据改；only_if_exists 等 **machine path 键**改占位符的前提是消费方支持
      替换——实现时先查其消费点：若 harness 消费侧（先行批后）按 featureFilePath/配置解析
      则值可动态表达；若消费方硬拼 projectRoot+字面值，则改键须连同消费方一起小改（加
      {features_dir} 替换）或如实记录 defer，**禁止只改 overlay 值造成写读错位**。
      分类判据：落盘/写入/运行命令/产出语境=真驱动改 <features_dir>/<feature>/…；读取/参见/
      例如=引用类不改（协议段覆盖）；历史/事故复盘=不动。每个改动文件确保存在一句
      features_dir 解析协议锚（六大 SKILL 已有）。产出「改动清单：文件×处数×分类」进实现
      记录供 review 逐条核。
    status: completed
  - id: e4-regression-and-green
    content: >
      E4 回归与收口：①新增/更新单测（E1 assembleAIPrompt 替换、fillCompatMessage 注入、
      E2 gitignore 默认逐条等价 + custom 三断言含 /doc/features/_adhoc/ 字面量保留）；
      ②rg 复扫：harness/prompts 与 agents/templates 产出通道内不得残留裸 doc/features
      硬编码（skills 正文允许——引用类保留是设计决定）；六大 SKILL 定位协议段 0 残留
      "定位 doc/features"矛盾句；③npm run typecheck + 全量 unit + fixtures 全绿；
      ④plan 勾选回填 + 实现记录——E3 无机器门禁（codex 提醒），实现记录按
      「文件 / 改动处数 / 分类（真驱动|引用类|历史类）/ 偏离原因」落表供 review 逐条核，
      等 review 后提交；发布说明措辞：本批补齐 agent 写路径侧，custom features_dir 端到端
      贯通（phase-rules yaml 文案与 _adhoc 契约除外，属已知豁免）。
    status: completed
---

# round7 skills/文案批 — 摸底清单（2026-07-07）

## 命中分布（rg doc/features，operational 文档面）

| 文件 | 命中 | 通道 |
|---|---|---|
| skills/feature/business-ut/SKILL.md | 42 | 3·占位符（筛真驱动） |
| skills/feature/device-testing/SKILL.md | 38 | 3 |
| skills/feature/plan/SKILL.md | 35 | 3 |
| skills/feature/coding/SKILL.md | 30 | 3 |
| skills/feature/spec/SKILL.md | 25 | 3 |
| skills/feature/code-review/SKILL.md | 23 | 3 |
| harness/prompts/verify-ut.md | 8 | **1·运行时替换** |
| skills/feature/spec/reference/ui-spec.md | 7 | 3 |
| specs/phase-rules/*.yaml | 14 | **范围外（fingerprint）** |
| device-testing/reference/hylyre-host-preflight.md | 5 | 3 |
| agents/claude/templates/agents/verifier.md | 5 | 3（verbatim） |
| spec/reference/visual-handoff.md | 4 | 3 |
| verify-testing/coding.md 各2、verify-spec/plan/review.md 各1 | 7 | 1 |
| user-confirmation-ux.md / goal-mode SKILL / framework-agent-execution.mdc 各2 | 6 | 3 |
| architecture.md.skeleton.md ×3（framework-init/templates + profiles/{hmos-app,generic}/doc-skeletons） | 2×3 | **2·渲染（逐份确认）** |
| specs/*.schema.yaml 示例 | 3 | 范围外 |
| 其余单命中文件 | ~6 | 3（逐个判） |

## profile 侧补入（codex P1，先行摸底漏扫 profiles/*/skills 与 overlays）

| 文件 | 命中 | 通道 |
|---|---|---|
| profiles/hmos-app/skills/device-testing/profile-addendum.md | 9 | 3（真驱动浓度高：cwd/reports/报告写入） |
| profiles/hmos-app/phase-rules-overlays/ut-rules.overlay.yaml | 23 | 3（overlay 不进 gate fingerprint——已核实 gate-fingerprint 只 hash specs/phase-rules 主文件） |
| profiles/{hmos-app,generic}/skills/device-testing/templates/test-plan-template.md | 4+3 | 3 |
| profiles/{hmos-app,generic}/skills/business-ut/templates/coverage-evidence-schema.md | 3+3 | 3 |
| profiles/hmos-app/phase-rules-overlays/{plan,catalog}-rules.overlay.yaml | 4+3 | 3 |
| profiles/hmos-app/skills/spec/templates/ui-spec-template.yaml | 2 | 3 |
| profiles/hmos-app/skills/plan/examples/example-plan.md | 2 | 3（示例类倾向不改） |

## review 裁决记录（plan review 轮）

- **_adhoc 在 gitignore custom 态**：cursor（保持 doc/features/_adhoc 字面量）与 codex（生成
  <custom>/_adhoc/）意见相悖。ground truth：adhoc-canonical-paths.ts 硬编码 doc/features/_adhoc、
  运行时产物不随 features_dir 迁移 → **采 cursor**；codex 的断言示例若照做会 ignore 一个永远
  没文件的目录、漏掉真实 adhoc 落点。
- **skeleton 三份**：cursor 属实（profiles/*/doc-skeletons/ 两份 + framework-init/templates 一份，
  先行摸底只扫了 skills 树）。
- **init 消费链**：codex/cursor 同点属实（init-task-executor:348 + check-init 常量导入/长度摘要/
  __testing），E2 已扩为整组 API。

## 生产代码随批项（上批 defer）

| 文件 | 行 | 处理 |
|---|---|---|
| harness/scripts/check-ut.ts | 336 / 868 / 2919 | relFeatureFile 动态化 |
| harness/scripts/check-testing.ts | 2258 | 同上 |
| profiles/hmos-app/harness/coding-visual-parity-check.ts | 211 | 同上 |
| harness/scripts/check-coding.ts | 213 | relFeaturesDir 动态化 |
| harness/compat-messages.ts | 11 / 24 / 30 | 模板 {features_dir} + fill 注入 |
| harness/scripts/utils/canonical-gitignore.ts | 27/28/32/33 + equiv map | 函数化（E2） |

## 关键机制事实（决定通道划分）

- report-generator.ts:208-213 已有占位符替换 → verify prompts 可真动态化（一行代码）。
- template-renderer.ts:183 已有 FEATURES_DIR 变量、AGENTS.md.template 先例在用 → 渲染通道现成。
- check-init.ts:744 agent-bundle rules 为 `kind: 'verbatim'` 逐字复制 → mdc/verifier 无渲染通道，只能占位符。
- gate-fingerprint.ts:57 指纹 = phase-rules yaml 内容 sha256 → **yaml 文案改动 = 宿主全量存量回执 stale**，本批不碰。
- 六大 feature SKILL 均已含 paths.features_dir 定位协议引用 → 占位符语义有锚。

---

## 实现记录（2026-07-07 开工，全绿收口）

**验收**：`npm run typecheck` ✓ + 全量单测 **1461 passed / 0 failed**（+3 E2 新用例）+ fixtures **35/35** + E4 rg 断言三连过（verify prompts 0 残留 / 协议段矛盾句 0 / 全仓占位路径残留 0）。phase-rules yaml 未动（fingerprint 豁免维持）。

### E1 运行时替换通道
- report-generator.ts:214 加 `{features_dir}` replace（relFeaturesDir(projectRoot)，与 {feature_name} 同点位）。
- verify-{spec,plan,coding,review,ut,testing}.md 15 处全改 `{features_dir}/{feature_name}/…`；verify-testing:58 `<feature>`、:195 `{feature}`、verify-ut:36 `<feature>` 三处变体统一为 `{feature_name}`（cursor 提醒落实）。profile overlay prompts 无命中。
- 上批 defer 生产文案动态化：check-ut:337/869/2920、check-testing:2258、coding-visual-parity-check:211（relFeatureFile）、check-coding:213（relFeaturesDir，加 import）。
- compat-messages：三模板 `doc/features/{feature}` → `{features_dir}/{feature}`；fillCompatMessage 签名扩为 (template, projectRoot, feature, phase)，顶层 import relFeaturesDir（同层 compat-loader 先例，无环）；三调用方 compat-loader:316 / context-exploration:512 / report-generator:65,72 补 projectRoot（均在作用域）。
- **skeleton 三份确认结果（E1⑤）**：write-architecture 内容由 Skill S2 注入 payload（init-task-executor:625），**无机器渲染管道**——三份 skeleton 均按 E3 占位符处理（各 2 处「由 git 与 <features_dir>/<feature>/ 承担」），不用 {{FEATURES_DIR}}。plan 原设想"走渲染换 {{FEATURES_DIR}}"经查证不成立，按 plan 预留的"不走渲染按 E3 处理"分支落地。

### E2 canonical-gitignore 函数化
- canonicalIgnorePatterns(featuresDir=doc/features) / ignoreEquivPatterns(featuresDir) / canonicalSections(featuresDir)；三条 features_dir 派生（reports/goal-runs/_fidelity-cache）动态生成；`/doc/features/_adhoc/` 字面量保留（cursor 裁决）。同名常量导出=默认调用结果（既有消费/测试兼容）。
- 全消费链：ensureCanonicalGitignore 内部 relFeaturesDir(projectRoot)（init-task-executor:348 调用方零改动）；listMissingCanonicalPatterns/patternIsCovered 加 featuresDir/equivMap 参；buildFull/AppendBlock 传导；check-init inspect11 传 relFeaturesDir(env.projectRoot) + 长度摘要改 canonicalIgnorePatterns(featuresRel).length。collectGitignoreAdvisories 核实无 features_dir 依赖（advisory 全是 framework/harness/reports 类），未改。
- 单测：默认逐条相等锚点 + custom 三断言（三类新模式生成/无旧模式残留/_adhoc 字面量保留 + equiv 键随迁）+ ensure custom 端到端（framework.config.json + clearFrameworkConfigCache + 幂等）。

### E3 verbatim 静态文档占位符 — 分类落表（codex 格式）

**【判据落地偏离（当场同步）】**plan 原判据"落盘/写入/命令语境=真驱动改；读取/参见=引用类不改"在实操中换成更客观的机器可执行判据：**占位符路径（`{feature}`/`<feature>`/`{module}`/`{module-name}`/`{module-id}`/`<f>` 等）＝操作模板 → 全改；具名路径（home-page/bank-card/demo-feature/task-demo/task-console-home）＝历史/示例 → 保留；契约路径（_adhoc）＝保留**。这是对原判据的**放宽**（引用类占位路径也一并改了）——理由：①协议段语义锚建立后正文 `<features_dir>` 与锚一致、并不更噪；②"读引用"与"写指令"在 custom 宿主下同样误导 agent；③逐行读写语境判定拉锯大且主观，占位/具名判据零歧义。

| 文件 | 改动处数 | 分类 | 备注 |
|---|---|---|---|
| 六大 feature SKILL 协议段 | 6×1-3 | 真驱动 P0 | 矛盾句根治 +「下文 <features_dir> 均指该配置值」语义锚 |
| business-ut/device-testing/plan/coding/spec/code-review SKILL 正文 | ~130 | 操作模板 | 占位路径全改；spec home-page 示例×3、device-testing _adhoc×2 保留 |
| goal-mode SKILL / user-confirmation-ux / consumer-framework-boundary / path-c-characterization | 2+2+1+2 | 操作模板 | user-confirmation-ux:187 与 goal-runner 先行批动态化对齐 |
| hylyre-host-preflight / ui-spec.md / visual-handoff.md | 3+4+1 | 操作模板 | _adhoc×2、bank-card 示例×3、my-feature 示例×2、`### doc/features/ 是否入库` 标题保留 |
| review-report-template / spec-harness-options | 2+1 | 操作模板 | |
| framework.mdc / verifier.md / record-verifier-report.mjs 注释 | 1+5+1 | 操作模板 | framework-agent-execution.mdc 2 处均 _adhoc 保留 |
| confirmation-registry.yaml:287 | 1 | 展示文案 | label 改中性"features 归档目录"（与 spec SKILL 对照文案无字面耦合，全量测试绿佐证） |
| skeleton ×3 | 3×2 | 说明引用 | 会固化进宿主 architecture.md，改占位符+默认括注 |
| profile-addendum.md（hmos device-testing） | 5 | 操作模板 | _adhoc×3、"与 doc/features/ 同级"说明保留 |
| profile templates 长尾（spec/plan/api-spec/test-plan/test-report/ut 系列 ×hmos+generic） | ~30 | 操作模板 | demo-feature/task-demo/task-console-home 具名示例保留 |
| phase-rules-overlays（ut/plan/spec/catalog/coding ×hmos） | ~35 | 声明/展示 | **machine 键消费核查（plan 红线）**：only_if_exists/log_persist/gap_notes_glob/use_cases_spec/acceptance_device_focus/sources 在 harness 生产代码**零消费**，applies_to 仅 overlay merge 传递——全部为声明/展示层，真实路径 harness 自算（先行批已动态化），无写读错位；且 overlay 不进 gate fingerprint（已核实）。coding-rules.overlay 为预清点外顺手扫到 |

### E4 断言与豁免清单
- rg 断言：harness/prompts 0 doc/features；skills 协议段 0 矛盾句；全仓（agents/skills/profiles skills+overlays/prompts）占位形态 doc/features 残留 0。
- 全仓保留白名单（复扫可复核）：协议段/模板「（默认 doc/features…）」括注、home-page/bank-card/my-feature/demo-feature/task-demo/task-console-home 具名示例、_adhoc 契约路径、profile-addendum "同级"说明、visual-handoff「是否入库」节标题。

### 实现 review 闭环（2026-07-07，cursor + codex 各一轮）

- **[codex P1 / cursor P2] check-phase-completion.mjs:523/529 stop hook 硬编码回执路径**——两家同点，codex 判定正确：hook 里是 JS 模板字符串 `doc/features/${feature}`，E4 rg 断言模式 `doc/features/\{` 匹配不到 `${`，**断言器盲区导致的实现漏口**（在 E4 承诺口径内，非 scope 外）。本批修复：仿该 hook 既有 readStateFileRelFromConfig 先例新增 readFeaturesDirFromConfig(projectRoot)（缺配置/异常回退 doc/features），buildBlockReason 加 featuresDir 参数，:523 回执目标与 :529 说明动态化，调用方 :658 接线——hook 有运行时，走真动态化而非占位符。断言口径补刀：`doc/features/\$\{` 全仓复扫 0 残留。
- **[codex P2] 4 个模板文件第 3 行 trailing whitespace**（sed 保留了原 md 硬换行尾空格，diff --check 报新行）——已清，`git diff --check` exit 0。
- **cursor P3（check-*.ts 文件头注释/JSDoc 的 doc/features）**：注释类，按 plan 范围外维持不动。
- 复跑：typecheck ✓ + 1463/1463 + fixtures 35/35 + hook 套件 20/20。

### 实现 review 第二轮闭环（2026-07-07）

- **[codex P1] hook 回执目标须尊重 paths.receipt_dir_pattern**——属实且比上轮修复更深一层：回执目录 SSOT 是 receipt_dir_pattern（harness receiptDirPath 同语义，可自定义为 …/<feature>/phases/<phase> 形态、有 feature-artifact-resolver 测试先例），仅拼 features_dir 默认结构在自定义 pattern 宿主下仍引导 agent 写错目录。修复：hook 新增 resolveReceiptRelFromConfig(projectRoot, feature, phase)（pattern 占位替换，与 config.ts:1887 receiptDirPath 同语义；无 pattern 回退 <features_dir>/<feature>/<phase>），buildBlockReason 加 receiptRel 参、:523 消费。
- **[cursor P3] hook custom 端到端用例**——落地为 hook-stale-state T20（fixture 加 pathsOverride；custom features_dir + 自定义 receipt_dir_pattern 双覆盖，断言 stderr 含 pattern 解析路径且不含默认路径）。
- 复跑：typecheck ✓ + **1464/1464**（hook 套件 21/21）+ fixtures 35/35。
