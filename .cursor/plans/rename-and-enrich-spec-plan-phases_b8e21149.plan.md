---
name: rename-and-enrich-spec-plan-phases
overview: 把 maison 的 prd/design 两阶段重定位并改名为 spec(长期需求规格快照)/plan(短中生命周期实现计划与开发契约入口)。先用 grep inventory 驱动的纯机械改名打底，再做语义重构：spec 只提炼 story 的通用治理维度并留 extension 口子、plan 瘦身但保留三大门禁章节、澄清 plan.md 与 contracts.yaml 真源关系。走自家 OpenSpec change 立项 + 旧 id/旧路径兼容 + MIGRATION（发布版本号默认不改，semver 级别与 bump 按用户指示）。
version: 2.3.0
todos:
  - id: opsx-propose
    content: OpenSpec 立项（proposal/design/tasks + specs delta：feature-artifact-layout 寿命策略、harness-gates 追溯门禁）。立项前先写清两条边界：core spec vs profile vs extension 的收编边界；plan.md(契约草案/来源) vs contracts.yaml(机器真源)的真源关系。proposal 的『变更性质/兼容承诺』段写成条件式判定（发布级别由兼容验收决定，见§五），不预先宣称向后兼容
    status: completed
  - id: rename-inventory
    content: 改名前置：全仓 grep '\bprd\b|\bdesign\b' 生成 inventory，输出分三类避免误伤——(1)必须改名 (2)保留但需解释(openspec/changes/*/design.md、普通英文) (3)人工判断，只对(1)机械执行。显式覆盖补漏点：skills/reference/confirmation-registry.yaml 的 prd.*/design.* 确认点 id（及 SKILL 正文、adapter interaction-renderer）、trace.schema.json 的 phase 与 artifact kind 两处 enum、goal 子系统(goal-runner/goal-progress/goal-manifest default:prd/goal-mode SKILL + workflow auto_chain 与 goal_mode 阶段链，须原子同步)、agents/*/templates 模板树(phase 引用/Stop hook receipt 路径)、harness/tests/fixtures 下 INPUT/doc/features/*/prd|design 夹具、scripts/restore-requirement-design-skill.mjs 类工具脚本；旧 check id（scope_consistency_with_prd/prd_p0_coverage 等）同步成对改 spec_*
    status: completed
  - id: rename-ids-mechanical
    content: 第一个 commit=纯机械改名（零语义变更、测试全绿）：按 inventory 逐项把 prd→spec、design→plan 注销——workflow yaml、skills 目录、check 脚本、*-rules.yaml(+overlay)、prompts、paths+PHASE_SCOPED_ARTIFACTS、trace.schema 两处 enum、adapter slash、goal-runner、fixtures、docs
    status: completed
  - id: contracts-term
    content: yaml 三件套统称由『Spec』改为『机器可读契约 artifacts』（不简单叫 contracts，避免与 contracts.yaml 混淆）；docs 加术语表声明 spec 词过载：phase 的 spec vs 协议目录 specs/ vs openspec/specs/ vs spec-driven.workflow，不改目录名但写明白
    status: completed
  - id: spec-template
    content: spec 模板（原 prd-template）语义重构：从 story 提炼『通用、可验证、跨宿主成立』维度，不是大块搬入。generic 留中立骨架，hmos-app 给鸿蒙细则。收编见分类表；清洗 story 的 Android 残留/重复/标题层级
    status: completed
  - id: spec-extension-hook
    content: spec 模板末尾预留显式锚点章节『宿主扩展治理项』，并在 spec SKILL 正文写明 extension 介入路径：doc/extensions/knowledge 放章节模板 + hooks/spec/on_context_load.md 注入叠加指令 + phase_rules_overlays.spec 加宿主结构检查。一等公民档（opsx-propose 立项定死做/不做，倾向做）：manifest 的 provides.skill_assets（extension 层覆盖/增补 skill-assets 条目），作为带独立验收的子任务——schema 版本语义/loader/docs/unit/旧 manifest 兼容
    status: completed
  - id: plan-template
    content: plan 模板（原 design-template）瘦身但保留三大门禁章节：Scope 声明与继承(scope_consistency_with_prd BLOCKER)、架构影响声明 architecture_impact(活规格变更入口)、功能映射表(prd_p0/p1_coverage/mapping_to_file BLOCKER)；其余只留模块归属/文件清单/接口+数据模型签名/状态管理/路由/组件树，删除过度实现细节
    status: completed
  - id: plan-contracts-truth
    content: 澄清真源、消除双源分叉：plan.md = 契约草案/来源（ephemeral），contracts.yaml/use-cases.yaml = 机器契约真源；coding/review/UT 一律优先读 contracts.yaml。SKILL 正文与模板表述统一，不再出现『plan 剥离契约』与『plan 是 contracts 提取源』打架
    status: completed
  - id: skill-rewrite
    content: 重写 spec/plan 两个 SKILL 正文：重新定性、寿命边界、dual-read 文案。workflow schema 的可选 display_name 降级为非优先级（一次性改名后必要性下降，留着无害）
    status: completed
  - id: traceability-gate
    content: spec 的 NFR/安全/性能/DFX 指标预算写结构化 yaml；新增 spec→plan 追溯 check（每条约束在 plan/contracts 有实现项），与 prd_p0_coverage 同构
    status: completed
  - id: compat
    content: 兼容：旧 phase id prd/design 作 alias 输出 WARN(workflow/compat-loader)；旧路径 prd/PRD.md、design/design.md 走 legacy duplicate WARN；extension manifest 的 hooks/phase_rules_overlays 旧 key alias；旧 check id（prd_*/scope_consistency_with_prd 等）改 spec_* 后，实例 phase_rules_overlays 若按旧 check key 引用会静默失效——须补 check id alias 或 MIGRATION/codemod 覆盖；实例已物化 adapter 跳板(.claude/commands、.cursor/skills 按旧 skill 目录路径)升级后悬空→旧目录 stub 或 MIGRATION 重跑 render；默认产物路径变更(新 feature 落 spec/spec.md)致实例旧 CI/hook/doc 工具失效；alias 须承诺保留≥N 个 minor 窗口 + in-flight feature/goal run(.current-phase.json/receipt/goal manifest+progress 快照 旧 phase id)无缝续跑；merge-framework-config 迁移；MIGRATION.md + 一次性 codemod 迁移实例 doc/features/**
    status: completed
  - id: lifecycle-and-process-doc
    content: openspec/specs/feature-artifact-layout/spec.md 增补寿命策略（feature 闭环后 plan.md 叙述可归档降级，contracts/acceptance 永久保留）；纯流程事项(管理台配置/打点排期-SVN/翻译/TA联调/Demo)定为 checklist 或 lifecycle hook，两阶段主模板都不收
    status: completed
  - id: verify-release
    content: 验收：cd harness && npm test 全 PASS；openspec:validate；release:verify；新增夹具——带旧 phase key 的 extension manifest fixture 验证 alias 解析、旧目录结构实例 codemod dry-run、实例 adapter 跳板悬空检测、in-flight feature(旧 phase id)续跑；新旧路径/新旧 id 双跑通。发布级别由兼容验收决定（兼容面逐项有 dry-run 证据 + 双跑全过 + MIGRATION 无『消费者必须执行』步骤 → minor 弃用；任一不达 → major）。版本号默认不改（当前窗口 2.3.0），release:version bump 与 RELEASE-NOTES 仅在用户明确指示时执行
    status: completed
isProject: false
---

# prd→spec / design→plan 阶段重定位与改名

> 已确认：phase id `prd`→`spec`、`design`→`plan`；文档 `spec.md` / `plan.md`；**一次性**完成机械改名 + 语义重构 + 兼容 + MIGRATION。当前发布窗口 `2.3.0`（不顺延）；**版本号默认不改**，semver 级别与 bump 仅在用户明确指示时执行。**不**引入业务行为活规格库。
>
> 本版已纳入 Codex / Claude 两轮 review 的修正：spec 改"提炼通用维度+留口子"、plan 保留三门禁章节、改名走 grep inventory、先机械改名再语义重构、澄清 plan/contracts 真源、术语去过载。

## 一、定性


| 阶段             | 文档（叙述，人/AI 共读）                                             | 寿命                           | 机器可读契约 artifacts                              | 寿命                           |
| -------------- | ---------------------------------------------------------- | ---------------------------- | --------------------------------------------- | ---------------------------- |
| spec（原 prd）    | `doc/features/<f>/spec/spec.md`：要什么/为什么/约束/验收              | 长期归档（需求规格快照）                 | `acceptance.yaml`                             | 长期                           |
| plan（原 design） | `doc/features/<f>/plan/plan.md`：怎么改/改哪些文件/不越界（**契约草案/来源**） | ephemeral（失效点=feature 全链路闭环） | `contracts.yaml` / `use-cases.yaml`（**机器真源**） | 中生命周期（持续到 review/UT/testing） |


`architecture_impact` 是活规格变更入口，落 `doc/architecture.md` / `module-catalog.yaml`，**持久**。
**真源唯一性**：plan.md 仅作草案/来源，coding/review/UT/harness 一律以 `contracts.yaml` 为机器契约真源，避免 plan.md 与 contracts.yaml 双源分叉。

## 二、spec 模板：提炼通用维度，不是全量吸收（Codex#1/#4 + Claude#III）

核心模板只收"通用、可验证、跨宿主成立"的维度；鸿蒙/组织/业务强绑定项通过 profile addendum 或 `doc/extensions` 介入。


| story 内容            | 收进 core spec（generic 中立骨架） | profile / extension                           | 不进主模板                  |
| ------------------- | -------------------------- | --------------------------------------------- | ---------------------- |
| 需求介绍/场景/功能点         | 是                          | 可补宿主术语                                        | —                      |
| 异常分析 / 特殊模式         | 是，结构化                      | 特殊模式枚举进 hmos-app profile（游客/未成年/儿童不进 generic） | —                      |
| 安全隐私                | 是，通用风险表                    | 宿主合规细则                                        | —                      |
| 数据存储约束              | 是，约束级（加密/有效期/兼容）           | 鸿蒙存储类型细则                                      | —                      |
| 端云接口 / 外部依赖         | 是，作为需求边界                   | 具体网关/微服务规范；QPS/请求量评估走 extension               | —                      |
| 对外开放页面/接口           | 是，与安全/依赖合并去重               | deeplink 规范可扩展                                | —                      |
| 兼容性                 | 是，只留骨架小节 + yaml 块格式        | 具体自检项（Android/鸿蒙/组织私货）走 profile/extension     | —                      |
| DFX 性能/功耗/ROM/RAM   | 是，指标预算                     | 宿主指标口径                                        | —                      |
| 管理台配置排期             | 否                          | —                                             | 是（checklist/hook）      |
| 运营运维打点排期/SVN 归档     | 否                          | —                                             | 是（extension checklist） |
| 翻译回稿 / TA 联调 / Demo | 否                          | —                                             | 是（extension/checklist） |


收编进 core 的章节一律结构化为"是否涉及 + 理由 + 风险点 + 需求约束 + 验收方式 + 对应 AC"表，避免空章节堆叠。清洗 story：去 Android 残留→鸿蒙术语、合并重复（安全隐私 vs 对外开放能力）、修标题层级（`# 11.1`→`##`）、删游离行"组件ROM"。

### 宿主扩展治理口子（新增，承接"选择性收编"）

- **低成本档（协议零改动，现在就通）**：spec 模板末尾预留显式锚点章节"宿主扩展治理项"；宿主用现有三件套介入——`doc/extensions/knowledge/` 放章节模板 + `hooks/spec/on_context_load.md` 注入"叠加这些章节"的指令 + `phase_rules_overlays.spec` 加宿主自己的结构检查。在 spec SKILL 正文写明此约定。
- **一等公民档（`opsx-propose` 立项时定死：做）**：补 `profile-skill-asset` 解析链缺失的 extension 覆盖入口——把 extension manifest 的 `provides.skill_assets`（extension 层覆盖/增补 skill-assets 条目）纳入这个 breaking 窗口（本来就要动 manifest 加旧 phase key alias）。**立项即决策做/不做，不带"可选"进执行**（否则 specs delta 易返工）；作为带**独立验收**的子任务推进：manifest schema 版本语义（加可选字段=minor，但与 phase key alias 写在同一 proposal）、loader 解析、docs、unit、旧 manifest 兼容。错过本窗口，下次单独动 manifest 协议又是一轮完整兼容工作。

## 三、plan 模板瘦身的边界（Claude#II.1，事故级修正）

瘦身=删过度实现细节，但**以下三章不可删**（删了门禁全挂）：

- **Scope 声明与继承** — `scope_consistency_with_prd` 是 BLOCKER，coding 阶段 diff 越界判定也依赖它；
- **架构影响声明 `architecture_impact`** — 活规格变更入口，本计划第一节已定性"持久"；
- **功能映射表（PRD→spec 功能映射）** — `prd_p0_coverage` / `prd_p1_coverage` / `mapping_to_file` 三条 BLOCKER 追溯检查的目标端。

> 注：上列 `scope_consistency_with_prd` / `prd_p0_coverage` / `prd_p1_coverage` 等是**当前旧 check id**；机械改名阶段须同步为 `spec_`*（如 `scope_consistency_with_spec` / `spec_p0_coverage`），纳入 inventory 成对替换，避免漏改 check id。

其余保留：模块归属 / 文件清单 / 接口+数据模型签名**草案**（人读解释，落盘后以 `contracts.yaml` 为准；不写"提取源"以免与机器真源歧义）/ 状态管理 / 路由 / 组件树。

## 四、改名映射：grep inventory 驱动（Claude#II.2）

不手列映射，先生成 inventory 再逐项注销。**inventory 输出分三类**，避免 `\bdesign\b` 命中大量普通英文与 OpenSpec 常规 `design.md` 语义而误伤：(1) 必须改名（phase id / 路径 / check id / skill 目录等）；(2) 保留但需解释（如 `openspec/changes/*/design.md`、英文叙述）；(3) 人工判断。**只对第 (1) 类机械执行**。手列已发现至少五处漏点，实际更多：

- [confirmation-registry.yaml](skills/reference/confirmation-registry.yaml) 的确认点 id（`prd.feature_path`/`prd.terminology`/`prd.freeze`/`design.scope_expansion`/`design.ok_to_code`），同时散布在各 SKILL 正文与 adapter 的 interaction-renderer 规则；
- [harness/trace/trace.schema.json](harness/trace/trace.schema.json) 两处 enum：`phase` 与 artifact `kind`（`"prd"`/`"design"`）；
- `**goal` 子系统**（近期已落地并提交，全按 phase id 引用，须随改名**原子同步**，否则阶段链断）：`goal-runner.ts` 的 `PHASE_SKILL_DOCS` 映射（**一行内同时写死 phase id + skill 目录名**：`prd→skills/feature/prd-design/SKILL.md`、`design→…/requirement-design/SKILL.md`）、CLI `--start prd` 默认（两处）、`goal-manifest(.ts/.schema.yaml)` 的 `default: prd` / `start_phase`、`goal-progress.ts` 硬编码的完整 phase 列表 `['prd','design','coding',…]`、`goal-status`、`skills/project/goal-mode/SKILL.md`，以及 workflow `auto_chain` 与 goal_mode 阶段链；新增 ~1400 行 goal 单测（`goal-progress.unit.test.ts` / `goal-runner-phase.unit.test.ts`）含 phase 字面量，叠加进 fixtures 工作量；
- adapter 模板树 `agents/*/templates/`（slash 文件名只是表层，正文 phase 引用、Stop hook 读取的 receipt 路径模式都要跟）；
- `harness/tests/fixtures/` 下大量 `INPUT/doc/features/*/prd|design/`* 固定夹具（工作量大头，勿只隐在"npm test 全 PASS"里）；
- `scripts/restore-requirement-design-skill.mjs` 类按旧 skill 目录名写死的工具脚本。

常规改名映射（phase id / skill 目录 `prd-design`→`spec`、`requirement-design`→`plan`（牵连 `skill-assets.yaml` 的 key 与各 profile 同名目录，须成对替换）/ `check-prd.ts`→`check-spec.ts`、`check-design.ts`→`check-plan.ts` / `*-rules.yaml` / `verify-*.md` / [harness/config.ts](harness/config.ts) 的 `paths`+`PHASE_SCOPED_ARTIFACTS` / 路径 `prd/PRD.md`→`spec/spec.md`、`design/design.md`→`plan/plan.md`）全部纳入 inventory。

## 五、兼容策略

- 旧 phase id `prd`/`design` 作 alias → `spec`/`plan`，harness 接受并 WARN（workflow-loader / [harness/compat-loader.ts](harness/compat-loader.ts)）；
- 旧路径 `doc/features/<f>/prd/PRD.md`、`design/design.md` 走 legacy duplicate WARN，仍可读；
- extension manifest 的 `hooks`/`phase_rules_overlays` 按旧 phase id 索引 → alias 解析兼容；
- **check id 改名的静默失效**：旧 check id（如 `prd_p0_coverage`→`spec_p0_coverage`、`scope_consistency_with_prd`→`scope_consistency_with_spec`）若被实例 `phase_rules_overlays` 按旧 key 引用，改名后会**静默失效**；须补 check id alias，或在 MIGRATION/codemod 中覆盖实例 overlay 的 check key；
- **实例已物化的 adapter 跳板**：framework-init 渲染到实例 `.claude/commands/`、`.cursor/skills/` 的桥接文件按旧 skill 目录路径（`framework/skills/feature/prd-design/SKILL.md`）指向模块；skill 目录改名后这些落盘引用会悬空（alias 层管不到——文件在实例仓库、不经 harness 解析）→ 旧目录留 stub，或 MIGRATION 要求重跑 render；
- **默认产物路径变更**：alias 让旧 `prd/PRD.md` 可读，但升级后**新建** feature 落 `spec/spec.md`，实例按旧约定的 CI 脚本 / 自建 hook / 文档工具对新 feature 会失效（"旧数据可读"≠"默认行为不变"，后者按 extension-protocol-v1「改变默认合并行为」更接近 breaking）；
- **alias 寿命承诺 + in-flight 续跑**：proposal 须写明 alias 保留 ≥ N 个 minor 窗口（否则"非破坏"只是把 breaking 推迟到移除日）；并验证升级时跑到一半的 feature（`.current-phase.json`、receipt 仍是旧 phase id）能无缝续跑；**含 goal run 的持久化状态**（goal `manifest` / events 投影 / progress 快照里存的旧 phase id，resume 场景会真实触发，close 挂起修复已强化 resume 路径）也须续跑或迁移；
- `merge-framework-config` 迁移 + [MIGRATION.md](MIGRATION.md) + 一次性 codemod（`scripts/`，不进发布件）迁移实例 `doc/features/`**。

### 发布级别由兼容验收决定（不预先宣称）

不单边宣称"向后兼容"，把版本级别交给**验收**：兼容面清单（上述全部项）逐项有**自动化或 dry-run 证据** + "新旧路径 / 新旧 id 双跑"全过 + MIGRATION 中**无**"消费者必须执行"步骤 → 可按 **minor 弃用发布**；任一项不达 → **major**。alias 保留期 ≥ N 个 minor 窗口，移除时单独走 major。（版本号默认不改、bump 时机仍按用户指示。）

## 六、执行顺序（Claude#IV，倒序避免脏 diff）

1. `opsx-propose` 立项（含 core/profile/extension 边界 + plan/contracts 真源关系）；
2. **commit 1：纯机械改名**（grep inventory 驱动、零语义变更、测试全绿）；
3. **commit 2+：语义重构**（spec 提炼通用维度 + extension 口子、plan 瘦身保门禁、真源澄清、追溯门禁、术语去过载）——每个 commit 单一性质，便于回滚定位；
4. 兼容 alias + lifecycle 寿命策略 + MIGRATION + codemod；
5. 验收（版本号默认不改；`release:version` bump / RELEASE-NOTES 仅按用户明确指示）。

> **窗口冻结（流程）**：commit 1 会动数百文件，与任何并行长期分支大面积冲突。立项后**尽快完成 commit 1**，期间**冻结其它本地改动/分支**（先确认无进行中的未签库工作，如 goal-mode 已落库即可），语义重构阶段再恢复正常并行。

## 七、验收（含 review 补充项）

- `cd harness && npm test` 全 PASS；`npm run openspec:validate`；`npm run release:verify`；
- 新增夹具：带旧 phase key 的 extension manifest fixture 验证 alias 解析；旧目录结构实例 codemod **dry-run** 验证；实例 adapter 跳板悬空检测；in-flight feature / goal run（旧 phase id 持久态：current-phase / receipt / goal manifest+progress 快照）续跑；
- 全 profiles `tsc` typecheck 作机械改名安全网（漏改的 import/路径由编译门禁直接抓住）；
- 新旧路径 / 新旧 id 双跑通；
- 发布级别由兼容验收决定（见 §五）：兼容面逐项有证据 + 双跑全过 + MIGRATION 无"消费者必须执行"步骤 → minor 弃用；任一不达 → major；
- 版本号默认不改（当前窗口 2.3.0）；`npm run release:version -- bump` 与 `RELEASE-NOTES-vN.md` 仅在用户明确指示时执行。

## 八、不做项（本次明确排除）

- 业务行为活规格库（feature spec 闭环后 delta 归并到 per-capability living spec）——维持 per-feature 快照归档，命名定 `spec` 后路线留口子可顺接 OpenSpec 模型。

