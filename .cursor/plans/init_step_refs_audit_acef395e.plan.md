---
name: init step refs audit
overview: framework-init 重构为 S1/S2/S3/S4 后，全仓残留两类遗留——(1) 旧 Skill 00 编号（Step 0.x / 3.5 / 5.x / §4.1.1 / §5.1 / §5.4.5 / Skill 0.3 / §0.3.x / Q1.C/Q1.A / Step 0→Step 7）；(2) 非编号的语义漂移（DevEco 路径"由 /framework-init 自动完成"等，与已迁到 personal setup 的方向冲突）。本计划以发布文件集为 SSOT 做权威枚举与三分类，再全面修正，并加一道 context-anchored 防回归校验。手工种子清单仅作起点，最终以 Phase 0 扫描为准。
todos:
  - id: enumerate-ssot
    content: 以 release-excludes.json 发布文件集为 SSOT，按"全口径模式"枚举全部候选并逐条三分类（must-fix / legal / legacy-allowlist）——权威清单，A 节种子仅起点
    status: completed
  - id: fix-readme-entry
    content: 修 README.md 入口话术 Step 0→Step 7 / Step 0~7 / Step 0.1 / Step 0.2.5（高优，用户直接贴给 agent）
    status: completed
  - id: fix-init-context-refs
    content: 修 init 语境引用（adapter.yaml / agents-README / harness-cli-cwd / host-harness-readiness / skills-README）
    status: completed
  - id: fix-skill-crossrefs
    content: 修 skills 1/2/3/4/6 的 'init Skill Step 1.5' 交叉引用 → S2.1
    status: completed
  - id: fix-specs-harness-init-num
    content: 修 specs/phase-rules/init-rules.yaml 与 harness 注释里的 'Skill 0.3 / SKILL 0.3.x / §5.1 / Step 5.2 / Q1.C/Q1.A / §5.4.5.x' 编号
    status: completed
  - id: fix-semantic-deveco
    content: 修非编号语义漂移——DevEco/installPath/toolchain "由 /framework-init 自动完成" → personal setup（MIGRATION L34 / overview L397 / template L31 等）
    status: completed
  - id: fix-templates-addendums
    content: 修 framework.config.template.json / AGENTS.md.template / extension-skeleton README / generic+hmos profile-addendum 的旧编号（hmos 改动最大）
    status: completed
  - id: fix-docs-evolution-migration
    content: 修 docs/overview.md + docs/evolution 两处 + MIGRATION.md 现在时句，保留纯历史/legacy 行
    status: completed
  - id: add-guard
    content: 新增 scripts/check-stale-init-refs.mjs（全口径 context-anchored 模式 + allowlist），由 verify-release-pack.mjs 调用；避免 package.json 泄漏
    status: completed
  - id: verify
    content: 跑 npm run release:verify 与 cd harness && npm test（=test:unit && test:fixtures）验收；并确认 sanitized 消费者 check:global 行为
    status: completed
isProject: false
---

## 背景与核心判别（BLOCKER：避免误改）

存在**三套独立编号**，必须严格区分。**误伤风险极高**——仓内大量 `Step 3.5 / 5.x` 属于下游技能自身步骤：

1. **Skill 00 旧编号（遗留，本轮目标）**：init 语境（`Skill 00` / `SKILL 00` / `init Skill` / `framework-init` / `根 SKILL`）下的各种编号。包含**不含 "Step" 字样**的形态——本轮新识别：
   - `Step 0.x / 3.5 / 4.1 / 5.x / 5.4.5.x`、`§4.1.1 / §5.1 / §5.4.5 / §5.4.6`
   - `Skill 0.3 / SKILL 0.3.x / §0.3.x`（旧 init "阶段 0.3 体检表" 编号）
   - `Q1.C / Q1.A`（旧 init 子问题标签；现走 registry `init.task_decision` / CONFIRM pass）
   - `Step 0 → Step 7 / Step 0 ~ 7 / Step 0 到 7`（README 入口话术）
   新 [`skills/00-framework-init/SKILL.md`](skills/00-framework-init/SKILL.md) 已是 `S1 探测 / S2 计划批准 / S3 执行 / S4 摘要`，无任何小数子步与 §编号，故上述全部失效。
2. **生成入口区段号（合法，禁止改）**：[`templates/AGENTS.md.template`](templates/AGENTS.md.template) 实际含 `§3.4 / §4.1 / §5.1 / §5.1.1 / §6`。所有「全局入口/AGENTS.md/CLAUDE.md §X」均指渲染出的入口文件，当前有效。
3. **下游技能自身步骤号（合法，禁止改）**：catalog（Skill 0）自身 `§5.1`、`Phase A/B Step`、`Step 5.1/5.2/5.4/3.5`；coding（Skill 3）自身 `Step 3.5: 业务编排`；`infer-module-card.md` 自身 `Step 3.5/3.6`；PRD/UT/review/device 各自的 `Step 1.5/1.6`。

**另有一类无法靠编号识别的「语义漂移」**（必须人工判定，guard 无法兜）：把**已迁到 personal setup**（`framework.local.json`）的 DevEco/`installPath`/toolchain 路径配置，仍描述为"由项目 init / `/framework-init` 自动完成"。

新→旧锚点映射（修复时统一采用）：
- `Step 0.1 / Step 1（Git 快照）` → `S1.1`
- `Step 0.2.5 / adapter 选定` → `S2.2`（语义变更：默认由 template 写入，**非**用户选字符串）
- `Step 0.3 / 0.3.x / Skill 0.3 体检表` → `S1 探测`（check-init 11 项体检仍在，去掉 "0.3" 阶段号）
- `Step 3.5 / §5.1（config 写盘/merge）` / `Q1.C/Q1.A` → `S2 决策（CONFIRM pass）` / `S3 执行`
- `§4.1.1 / Step 4.1（render-agents-md）` → `S3 执行（adapter 物化）`
- `Step 5.2 / 5.4.6 / §5.4.5（doc 骨架/扩展骨架/gitignore canonical）` → `S3 执行（executor ensure-gitignore / 物化任务）`
- `Step 5.5（npm install）` → `S3 执行（harness-install）`
- `Step 5.6 / DevEco installPath` → personal setup（[`skills/00b-framework-setup`](skills/00b-framework-setup/SKILL.md) / profile-addendum / registry `setup.deveco_path`）

---

## Phase 0 — 发布范围 SSOT 全口径枚举（先做，BLOCKER）

**教训**：前两版手工 grep 反复漏项（`Skill 0.3`、`Q1.C`、`Step 0→Step 7`、DevEco 语义等）。**A 节种子清单不视为完备**；最终以本阶段扫描产出的权威清单为准。

- **SSOT = 发布内容**，由 [`scripts/release-excludes.json`](scripts/release-excludes.json) 定义。**排除**（不进 zip，仅 dev-only/legacy）：`.cursor` `.claude` `.codex` `openspec` `scripts` 根目录、`RELEASE-NOTES-v*.md`、`AGENTS.md`、`harness/tests/**`。**纳入**：`skills/ specs/ harness/(非 tests) profiles/ agents/ workflows/ templates/ docs/`、`README.md`、`MIGRATION.md`、根 `package.json`。
- **全口径模式**（对纳入集扫描）：
  - init 前缀邻近 + 编号：`(Skill|SKILL)\s*00\s*(§|Step)\s*\d`
  - 无 "Step" 旧编号：`(Skill|SKILL)\s*0\.3`、`§\s*0\.3`、`init\s+Skill\s+Step\s*\d`、`init\s+Step\s*0\.`
  - 子问题标签：`Q1\.[A-Z]`
  - gitignore 区段：`(SKILL|根\s*SKILL)\s*5\.4\.5`
  - 入口话术（含 `Step 0 ~ 7` 无第二个 "Step"、全/半角波浪号、`Step 0 到 7`）：`Step\s*0\s*(?:→|->|~|～|-|—|－|至|到)\s*(?:Step\s*)?7`
  - **不**用裸 `Step\s*\d\.\d`（会误伤 catalog/coding/device 自身步骤）。
- **语义漂移**（人工，无正则）：搜 `installPath` / `devEcoStudio` / `toolchain` 邻近 `/framework-init` / `Skill 00` / `自动完成`，逐条判 must-fix。
- 逐条标注 **must-fix / legal / legacy-allowlist**，该清单同时作为 Phase E guard 的 allowlist 初始来源。
- **当前已知命中文件（28 个，含本地改动后）**：skills/1-6 SKILL、skills/0-catalog SKILL、skills/README、skills/00-framework-init/prompts/workflow-selection.md、README.md、MIGRATION.md、docs/overview、docs/evolution ×2、host-harness-readiness、harness-cli-cwd、templates ×2、specs/phase-rules/init-rules.yaml、profile-addendum ×2、extension-skeleton/README、harness `config.ts`/`check-init.ts`/`merge-framework-config.ts`/`config-field-merger.ts`/`canonical-gitignore.ts`/`check-skills-confirmation-ux.ts`（+ 排除项 RELEASE-NOTES、harness/tests）。

## 执行策略（因当前脏工作区 · BLOCKER）

1. **先跑 baseline**：实施前先 `cd harness && npm test` 记录当前红/绿（本地 `feature-artifact-archival` 已改 `config.ts` / `spec-loader.ts` / 多个 `check-*` / unit tests / fixtures）。若已红，记录"基线未验证"，**避免把 feature-artifact 的失败误判为本计划所致**。
2. **Phase 0 以当前文件系统为准**生成命中清单，**不套用本计划旧行号**。
3. **逐文件最小补丁**：只替换 stale init 引用字符串，**禁止整段/整文件文本替换**（这些文件本地已有 feature-artifact 改动，整替会冲掉）。

---

> **行号已漂移（2026-06-02）**：本地 `feature-artifact-archival` 改动（PRD.md→prd/ 等，触及 skills/1-6 SKILL、catalog SKILL、docs/overview、多个 harness check 脚本、harness/config.ts 等）已使下列行号部分失准。**行号仅参考，一律以 Phase 0 重扫结果为准**。该改动还**新引入**了发布内容里的 init 旧编号（见 `harness/config.ts` Q1.C），印证 Phase 0 兜底的必要性。

## A. 现行编号遗留（must-fix · 已知种子，非完备）

- **README 入口话术（高优，用户直接贴给 agent）**：[`README.md`](README.md) L88、L96、L115（`Step 0 → Step 7` / `Step 0 ~ 7` / `Step 0 到 7` 等）→ `S1 → S4`；L94（`Step 0.2.5`，语义变）；L100（`Step 0.1` → `S1.1`）；L142（`Step 5.5` → `S3 harness-install`）。
- [`agents/generic/adapter.yaml`](agents/generic/adapter.yaml) L31：`init Step 0.2.5 由用户选定` → 「默认由 template/默认值写入（S2.2）；仅非标 bundle 根须手动编辑 config 后重跑」（截图所指那条，编号+语义双改）。
- [`agents/README.md`](agents/README.md) L81：`Step 0.3 体检第 3 项` → `S1 探测任务表`。
- [`skills/reference/harness-cli-cwd.md`](skills/reference/harness-cli-cwd.md) L22/L78/L79/L80/L82：`Step 0.3.0`、`Skill 00 §4.1.1`、`Skill 00 §5.1`、`Skill 00 Step 1`、`Skill 00 Step 5.6` → 按映射改。
- 5 个下游 SKILL profile 回落交叉引用（均 L30）：[`skills/1-prd-design/SKILL.md`](skills/1-prd-design/SKILL.md)、[`skills/2-requirement-design/SKILL.md`](skills/2-requirement-design/SKILL.md)、[`skills/3-coding/SKILL.md`](skills/3-coding/SKILL.md)、[`skills/4-code-review/SKILL.md`](skills/4-code-review/SKILL.md)、[`skills/6-device-testing/SKILL.md`](skills/6-device-testing/SKILL.md)：`见 init Skill Step 1.5` → `见 init Skill S2.1`。
- [`skills/README.md`](skills/README.md) L18：`Skill 00 Step 5.5`（×2）→ `S3 harness-install`。
- **specs/harness 旧 init 编号**：
  - [`specs/phase-rules/init-rules.yaml`](specs/phase-rules/init-rules.yaml) L2/L4：`framework-init Skill 0.3 产物体检` / `Skill 0.3 体检表` → 去 "0.3"，改 `framework-init S1 探测体检（check-init 11 项）`。
  - [`harness/scripts/check-init.ts`](harness/scripts/check-init.ts)（**约 10 处，Phase 0 全收**）：`Skill 0.3 体检表` / `SKILL 0.3.2/0.3.3` / `§0.3.4.1` / `Skill 00 §5.1` / `Step 5.2` / `Q1.A/Q1.C` / diagnosis `Step 5.5`（≈L4/L12/L13/L78/L85/L881/L1101/L1119/L1191/L1740/L1906/L2000/L2281/L2284）。
  - [`harness/config.ts`](harness/config.ts) L501/L505（**本地改动新引入** `Q1.C` 注释）→ `S2 决策（CONFIRM pass）`。
  - [`harness/scripts/merge-framework-config.ts`](harness/scripts/merge-framework-config.ts) L8/L96/L212（`Skill 00 Q1.C`）→ `S2 决策（CONFIRM pass / --confirm-* flag）`。
  - [`harness/scripts/utils/config-field-merger.ts`](harness/scripts/utils/config-field-merger.ts) L5（`§5.1`）、L17/L118/L414（`Q1.C`）→ S 编号 / 去 Q1 标签。
  - [`harness/scripts/utils/canonical-gitignore.ts`](harness/scripts/utils/canonical-gitignore.ts) L2/L8/L31（`SKILL 00 §5.4.5` / `SKILL 5.4.5.1/5.4.5.2`）→ 指向 executor `ensure-gitignore`，去 §编号。
  - **功能性（非注释）**：[`harness/scripts/check-skills-confirmation-ux.ts`](harness/scripts/check-skills-confirmation-ux.ts) L569 `content.includes('§0.3.4')` 特判 framework-init SKILL——新 SKILL 已无 `§0.3.4`，该 `if` 分支变死逻辑，framework-init SKILL 会落入通用 `else if` 的 SSOT-link 闸门。**须 review 逻辑**（确认新 SKILL 已链 `user-confirmation-ux.md` 不致误报，并清理死分支），不能仅 allowlist 掉 L568 注释。
  - 测试侧（**发布排除，dev-only**）：[`harness/tests/unit/config-field-merger.unit.test.ts`](harness/tests/unit/config-field-merger.unit.test.ts) L87/L322/L335 含 `Q1.C` 用例名；改标签后须保持 `npm test` 绿。
- [`skills/reference/host-harness-readiness.md`](skills/reference/host-harness-readiness.md) L59：`Step 5.6` → personal setup。
- [`templates/framework.config.template.json`](templates/framework.config.template.json) L28（`Q1.C` 现在时）、L31（`Skill 00 Step 5.6` + DevEco 语义，见 A2）。
- [`templates/AGENTS.md.template`](templates/AGENTS.md.template) L37（`Skill 00 Step 5.5`）、L147（`SKILL 00 §5.4.6`）。
- [`skills/00-framework-init/templates/extension-skeleton/README.md`](skills/00-framework-init/templates/extension-skeleton/README.md) L3：`Skill 00 · Step 5.4.6`。
- profile-addendum：
  - [`profiles/generic/skills/00-framework-init/profile-addendum.md`](profiles/generic/skills/00-framework-init/profile-addendum.md) L9（`Step 5.6（根 SKILL）`）。
  - [`profiles/hmos-app/skills/00-framework-init/profile-addendum.md`](profiles/hmos-app/skills/00-framework-init/profile-addendum.md)（**改动量最大**）：L23/L25/L29 及 §5.6.1–5.6.5 段大量 `Step 5.6 / 3.5 / §4.1.1 / Step 6 / Step 7 / §5.4.5`；本地小节去 init 编号、改 personal-setup 语境。（附带：5.6.4 旧规则名 `coding_hvigor_build/ut_hvigor_build/ut_hvigor_test` → canonical `coding_compile/ut_compile/ut_run`，可选。）
- docs/evolution：[`docs/evolution/extension-e2e-acceptance.md`](docs/evolution/extension-e2e-acceptance.md) L41/L58（`Step 4.1` / `Step 3.5`）；[`docs/evolution/extension-protocol-v1.md`](docs/evolution/extension-protocol-v1.md) L30（`Step 4.1`）。

## A2. 非编号语义漂移（must-fix · DevEco/toolchain 归属）

把已迁到 personal setup（`framework.local.json`）的路径配置仍归给项目 init / `/framework-init`：

- [`MIGRATION.md`](MIGRATION.md) L34：`...配 toolchain.devEcoStudio.installPath ... 全部由 Skill 00 内部完成` → 拆出 DevEco 路径归 personal setup（阶段 `--ensure`）。
- [`docs/overview.md`](docs/overview.md) L397：`DevEco 路径配置 ... 由 /framework-init Skill 自动完成` → 同上。
- [`templates/framework.config.template.json`](templates/framework.config.template.json) L31：`devEcoStudio.installPath 需要按 Skill 00 Step 5.6 经用户确认后写入` → personal setup。
- [`profiles/hmos-app/harness/detect-deveco.ts`](profiles/hmos-app/harness/detect-deveco.ts) L5：`framework-init Skill 在写 framework.config.json > toolchain.devEcoStudio 之前调用本脚本` → personal setup（`framework.local.json`）。

## B. 历史/发布文档现在时句（按选择修；纯历史保留）

- [`docs/overview.md`](docs/overview.md) L645（`SKILL Step 3.5 整文件落盘` → `S3`）。
- [`MIGRATION.md`](MIGRATION.md) L366（`Skill 00 Step 5.4.6`）、L369（`Skill 00 §5.1.A`）→ 改 S 编号；L375（`v2.5 之前 Skill 00 §5.1`）属历史回顾，**保留**。

## C. 保留（纯历史/legacy 映射或被排除目录，禁止改）

- [`MIGRATION.md`](MIGRATION.md) L73/L131/L403/L599/L600/L652（明确标注 legacy Step 0.3.4 / Q1=y / Q1.A / 0.2.5.1 的迁移映射；L403 `取代 legacy Q1.A` 会被 guard 命中 → 须入 allowlist）。
- 被发布排除（消费者看不到 → dev-only allowlist）：`.cursor/plans/**`、[`RELEASE-NOTES-v1.0.md`](RELEASE-NOTES-v1.0.md)、`openspec/changes/archive/**`。
- ~~check-skills-confirmation-ux.ts L568~~ **移出 C**：L568 注释与 L569 `§0.3.4` 死逻辑绑定，改由 A 节「功能性」条目一并 review（不再当作纯历史保留）。
- [`docs/overview.md`](docs/overview.md) L171（演进表历史行 `Step 0.3.4`）。

## D. 明确不可动清单（合法编号 · guard 须 allowlist）

- 「全局入口/AGENTS.md/CLAUDE.md §3.4/§4.1/§5.1/§5.1.1/§6/§6.5」全部引用。
- catalog（Skill 0）自身：[`skills/0-catalog-bootstrap/SKILL.md`](skills/0-catalog-bootstrap/SKILL.md) L50/L129/L300（`Step 5.1/5.2/5.4/3.5`）、`§5.1`、`Phase A/B Step`、`Step 1.5/2.5/4.5`；`infer-module-card.md` L48/L147/L151（`Step 3.5/3.6`）；glossary prompt `Step 1.x`。
- coding（Skill 3）自身：[`skills/3-coding/SKILL.md`](skills/3-coding/SKILL.md) L107/L203（`Step 3.5: 业务编排`）。
- PRD/UT/review/device 各自 `Step 1.5/1.6`；[`skills/reference/confirmation-registry.yaml`](skills/reference/confirmation-registry.yaml) 的 `skill_step` 值。
- [`docs/overview.md`](docs/overview.md) L155（PRD `Step 1.5`）、L163（全局入口 §）。

## E. 防回归校验（新增，全口径 context-anchored）

- 新增 dev 脚本 `scripts/check-stale-init-refs.mjs`：
  - **扫描范围**：仅 Phase 0 发布纳入集。
  - **检测模式**：用 Phase 0「全口径模式」全套正则（init 前缀编号 + `Skill 0.3` + `§0.3` + `Q1.[A-Z]` + `SKILL 5.4.5` + `Step 0→/到/~ Step 7`）；**不**用裸 `Step \d.\d`。
  - **局限**：A2 语义漂移无法正则化 → 不进 guard，仅靠 Phase 0 人工分类把关（在计划/PR 说明里注明）。
  - **allowlist 由 Phase 0 实际命中生成，非手写几行**：跑全口径扫描后，把判定为 legal/legacy 的真实命中（如 [`MIGRATION.md`](MIGRATION.md) L403 `取代 legacy Q1.A`、[`check-skills-confirmation-ux.ts`](harness/scripts/check-skills-confirmation-ux.ts) 附近 `§0.3.4` 历史/反模式说明）逐条登记为 allowlist（文件:行 或文件级）；命中即跳过。
  - 命中（非 allowlist）即列「文件:行」并 `exit 1`。
- **接入与 package.json 泄漏规避**：脚本置于 `scripts/`（已被 `excludeRootDirs` 排除），由 [`scripts/verify-release-pack.mjs`](scripts/verify-release-pack.mjs)（`release:verify`）**直接调用**；**不**新增裸 `check:init-refs` 顶层 npm script（否则进消费者 `package.json` 成悬空脚本）。如需独立 dev 入口，命名 `release:check-init-refs`，由 `sanitizePackageJson` 的 `release:*` 规则自动剥离（[`scripts/release-pack-rules.mjs`](scripts/release-pack-rules.mjs) L141）。

## 验收

- Phase 0 权威清单三分类完成，must-fix（含 A2 语义）全部修掉。
- 开发侧：`cd harness && npm test` 全 PASS（注意：harness `test = test:unit && test:fixtures`，**不等于** `check:global`）。
- `npm run release:verify` PASS（含新 guard，allowlist 外零命中）；该流程同时校验 sanitize 后**消费者** `package.json` 的 `test = check:global`（`check:catalog && check:glossary && check:docs`）行为。
- 复核 D 节合法编号未被误改（catalog/coding 自身 `Step 3.5/5.x`、全局入口 `§` 原样）。
