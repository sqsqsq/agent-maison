---
name: 工程惯例（conventions）— 第五类知识资产与 review 后置核对闭环
version: 3.1.0
deferred_to: 3.1.0
parent_goal: complex-capability-construction-75411223
advances:
  - g3-component-discovery-and-design-lenses
  - g4-component-evolution-blueprint
  - g6-change-unit-feature-pipeline-integration
  - g8-real-host-development-and-governance
relation: knowledge-provider
layer: knowledge
goal_requires: []
goal_provides:
  - project-conventions-knowledge
  - review-conventions-coverage
real_host_validation: >
  钱包工程只读挖掘是设计输入；本 plan 交付知识资产与 review 消费能力，真实语义效果由后续
  钱包 dogfood 验证，不能用 framework fixtures 代替，也不单独宣称部件演进蓝图完成。
parallel_authority_added: false
# 版本说明：3.0.0 发布门 = d4f8b2a6 + 7c4e9a2b 两 plan（既定，不追加）；用户已定夺
# （2026-08-03）：本 plan 归 3.1.0 窗口开发。deferred_to 满足 check-plan-version 门禁
# （codex P1-6 实锤复现后修复，O3 关闭）。
overview: >
  新增消费者工程的第五类知识资产「工程惯例（conventions）」：承载 RDB 使用方式、公共能力
  使用姿势、接口策略等横切工程实践——这类知识 architecture DSL（层与边）、module-catalog
  （单模块画像）、code-graph（符号索引）、extensions/knowledge（无锚定自由散文）四类载体
  均装不下。设计已经三方（用户/claude/codex）多轮收敛 + 钱包工程（SimulatedWalletForHmos）
  只读挖掘实证：极简后置核对路线——`paths.conventions`（默认 doc/conventions.md）弱结构
  Markdown 单文件；plan 阶段非阻塞声明；review 阶段作为独立必读输入做目标代码驱动的核对
  （非 diff 驱动）；靠 conventions-bootstrap skill 以「挖坑优先 + 符合率实测 + 人逐条 y 确认」
  策展入库。明确不做：resolver/index/结构化 applicability、content_hash/drift、ADR 目录、
  waiver 状态机、standalone review targets（独立后续 change）、新 harness phase。
todos:
  - id: t0-openspec-first
    content: >
      OpenSpec change `define-project-conventions` 先行锁定可观察语义（plan 批准后、任何
      实现之前——codex P2-8 采纳，规格先于实现）：proposal/design/specs/tasks 覆盖
      conventions 条目格式（机器可读最小集与 D2 一致：`##` 标题=id + gate 卡
      `enforcement: gate` / `gate_ref: <phase>/<rule_id>` 两行及其双端校验）/
      paths.conventions 配置链 /
      plan 声明与 contracts.conventions_applied 语义 / review 消费与覆盖台账语义（含 t4
      确定性检查清单）/ opt-in 零负担行为（D9）/ 明确排除范围（§4 全量入 out-of-scope）。
      `npm run openspec:validate`（脚本本身已含 --all --strict）通过后才允许开工 t1–t4。
    status: pending
  - id: t1-concept-and-paths
    content: >
      概念与配置位。① 配置链**全量**（codex P1-4 采纳，文件已实名核对）：
      `harness/config.ts` FrameworkPaths + DEFAULT_PATHS 新增 `conventions:
      'doc/conventions.md'`（加入 architecture_md/module_catalog/glossary 同族）+ 统一
      解析 helper `conventionsPath(projectRoot)`（对标 featuresDir/moduleGraphsDir 先例；
      **全部消费方一律经 helper 解析，t2/t3/t4 与报告标记禁止出现字面量路径**）；
      `specs/framework.config.schema.json` paths 段 + `templates/framework.config.template.json`
      默认值 + **UPDATE 回填 SSOT = `harness/scripts/utils/config-field-merger.ts` 的
      `FRAMEWORK_GENERIC_BACKFILL_FIELDS`**（`merge-framework-config.ts` 只是调用
      `getEffectiveBackfillFields()` 的 CLI 驱动，验证不改、禁止在 CLI 层加特例——
      三轮实测定案：二轮我把 grep 引用方清单误读成"文件不存在"，反向纠错了 codex，
      本轮认账）。**回填决策=显式不回填**（四轮 P2-4 取其第二案）：conventions 是
      opt-in 特性，UPDATE-keep 不写入该键、存量工程配置文件零 diff，运行时由
      DEFAULT_PATHS 默认值兜底；在 merger SSOT 处留注释说明该决定。unit：CREATE 与
      UPDATE-overwrite 按 template 含默认值 / UPDATE-keep 断言**不**写入 /
      三形态下 helper 解析结果一致；
      ② 新增框架文档 `docs/concepts/conventions.md`（术语与**条目格式的唯一 SSOT**，
      skill 模板只引用不复写；勿与消费者工程的 `doc/conventions.md` 混淆——前者是 maison
      仓里讲「什么是惯例」的概念文档，后者才是某工程的知识资产本体，同 code-graph 概念
      文档 vs 各模块 code-graph.yaml 的关系）：定义/与四类既有载体的分界表/与 code-graph
      的关系（共享「指针不复制」哲学，不共享 drift 基础设施）；
      ③ `templates/AGENTS.md.template` SSOT 表增加 conventions 行（措辞「可选资产·若存在」
      并指向 `/conventions-bootstrap` 为创建入口，防弱模型误以为必建）；
      ④ `docs/DOC_INVENTORY.yaml` 登记。配套 config 默认值 unit。
    status: pending
  - id: t2-bootstrap-skill
    content: >
      conventions-bootstrap skill（策展工作流，对标 catalog-bootstrap 交互纪律）：
      `skills/project/conventions-bootstrap/SKILL.md` + reference 详细流程 + 条目/骨架模板。
      **Step 0 骨架自建**：惯例文件不存在时由 skill 创建空骨架——**skill 侧路径解析
      协议**：读 `framework.config.json > paths.conventions`，缺失用框架默认值（对标
      features_dir 在各 SKILL 中的既有解析惯例；SKILL 正文不调用 TS helper，t1 的
      `conventionsPath()` 供 harness 侧消费——三轮 P2-4）。用户从不手写文件本体，
      只做逐条确认。六步工作流（钱包挖掘已人肉验证一遍可行）：源盘点
      （review 历史/代码归纳/既有文档收编三类证据源）→ 挖坑提取（重复 ≥2 次优先）→
      现状符合率实测（每条候选尽量配确定性探针；
      100%=established、代码分裂=待人裁决、无代码=aspirational）→ 三态分类 → 与既有门禁
      对齐（五轮 P1-1 修正：判定文本已被 DSL/coding-rules/ut-rules/profile 承载的
      **不得复制为 review 惯例**；有策展价值时只能以 D8 gate 索引卡形态入库——解释 +
      gate_ref + 范例，**入库时验证 gate_ref{phase, rule_id} 可解析到真实规则**）→
      逐条 y 确认入库（未确认绝不写入）。收编模式（adopt-by-reference）：已有 SSOT 散文只入摘要+链接。
      **增长入口**：code-review 发现重复意见时只**建议**升格为惯例，写入动作仍归本 skill
      的确认流程（review 不直接写 conventions.md，单写者）。
      注册 `skills/skills.index.yaml`；全 adapter 命令模板 + agent-bundle skills-bridge
      全量接线（对照 catalog-bootstrap/code-graph 现有接线清单逐目录核对，防 c7a9e2f4
      接线检索四盲区复发）。
    status: pending
  - id: t3-spec-plan-consumption
    content: >
      spec/plan 消费接线（非阻塞；惯例文件路径一律经 t1 helper / `paths.conventions`
      解析，禁止字面量路径——下同，codex P1-4）：① spec/SKILL.md Research Sub-Phase
      必读清单加一行惯例文件（若存在；无输出物、无门禁——满足「spec 阶段能获取到」且防 conventions
      内容漏进 spec 正文造成分叉副本）；② plan/SKILL.md 增加条件式输出节「遵循的既有惯例」
      （读全文≈≤5K token，挑适用项列 id+范例路径；不做检索/匹配/BLOCKER）；③
      plan-workflow-detail.md contracts 字段表 + `specs/artifact-schemas/contracts.schema.yaml`
      增加可选字段 `conventions_applied[]`（仅 id + planned_locations 两字段，为 review
      提供「声明 vs 实现」核对对子）。**可执行语义（三轮 P2-5 定案）**：schema 给真类型
      定义（entry required: [id, planned_locations]、planned_locations minItems: 1），
      不止文档化；planned_locations 每项=仓库相对 POSIX 路径的**文件或目录前缀**，目录
      前缀按完整路径段边界匹配（防前缀碰撞洗匹配——watched_roots 同款硬学习），禁 glob、
      禁绝对路径；「声明未兑现」判据=该前缀在目标文件集合命中 0 个文件（t4④ 确定性检查）。
      **运行时加载链（四轮 P1-1）**：schema 文件不会自动成为运行时契约——本仓 contracts
      真实加载链 = `ContractsSpec`（types.ts）+ spec-loader 归一化。须补
      `ContractsSpec.conventions_applied` 类型 + spec-loader 数组/entry/路径归一化（路径
      校验复用 `validateProjectRelativePath` + canonical 化，对标 package_path 既有防线），
      非法形状剔除并经 shape_issues → `feature_spec_shape` 结构化 BLOCKER；check-review
      只消费归一化后产物，**禁止自造第二套解析器**。loader unit 六例：非数组/缺 id/
      空 locations/绝对路径/`..`/反斜杠；
      ④ generic + hmos-app 两份 plan-template 增加条件节，并核对 plan-rules 章节完整性
      检查不把该条件节误判为缺章（开放问题 O5）。
    status: pending
  - id: t4-review-consumption
    content: >
      review 主消费闭环（本 plan 的核心交付）：① code-review/SKILL.md +
      code-review-workflow-detail.md：惯例文件存在时列为独立必读输入（不依赖 plan 是否
      声明）；核对协议写成**「目标文件集合」参数化的自足过程**（feature 模式下集合 =
      contracts.yaml>files；为后续 standalone change 铺底，本次不建 module|paths 入口）：
      适用性判断 → 符合性核对 → plan 声明一致性（conventions_applied「声明了但没做到」）
      → 范例存在性检查（适用条目必须打开 Golden Example，文件或符号文本不存在→WARN，
      不做 hash）。「仅新代码」按 D5 管辖权语义（存量违反=legacy advisory 不阻断）。
      ② 报告输出=**全量覆盖台账**（替代「共 N 条适用 M 条」单行标记——单行可伪造、
      漏选不可见，与本仓「逐条目合法≠集合完整」硬学习同构）：每条惯例 id 一行，
      判定 ∈ {PASS, VIOLATION, GATE_DELEGATED, NOT_APPLICABLE, NOT_ASSESSED}
      （适用性与符合性合并单列枚举——三轮 P1-2：纯适用性枚举让「违反→问题清单」检查
      无法机器判）+ 一句依据；VIOLATION → 问题清单条目引用惯例 id 与范例路径；
      **gate 卡条目固定填 GATE_DELEGATED**（四轮 P1-2 定案，取比 codex 更简的一案：
      rule_id 跨 phase 不唯一〔required_chapters 同名双 phase 实测〕且 review 报告先于
      本轮 check-review 生成，「照抄结果」有伪造 GATE_PASS 与时序循环两个洞；gate 挂了
      管线早被 harness 拦住，review 复读结果信息增益为零——裁决权整体留给 harness，
      台账只登记委托不宣称结果；**跨报告一致性比对明确为非目标**，防实现期长出来）。③ verifier 真实接线（codex P1-2 实锤：
      collectContextFiles 的 review 分支现只注入源码/报告/acceptance/contracts）：
      conventions 内容注入 review 上下文装配（文件存在时）+ assembleAIPrompt 装配 unit；
      verify-review.md 增加台账语义检查项（判定抽查/漏选嗅探），并**改写**检查 11
      `behavior_scope_surgical` 的「本次 feature diff」措辞为「目标文件集合 + 存量违反
      按 D5 降级」——保留其防噪音本意，不整段删除；范围语义清理做**全文件扫描**（实测
      至少三处：177 检查11 / 313 检查9 输出模板「超出 diff 的改进建议」/ 329「审查范围↔
      本次 diff」——codex 点名两处，盘点又多一处），合法提法（如消费 coding 阶段 diff
      自愈报告）入窄 allowlist。④ check-review.ts 确定性检查（最小 Markdown parser）。
      **激活真值表（三轮 P1-3，防悬空契约假通过）**：惯例文件不存在且 contracts 无
      conventions_applied 声明 → SKIP；文件不存在但声明非空 → FAIL-MAJOR（plan 声明了
      依赖、真源却缺失，不得按未启用洗白）；文件存在 → 全量检查。全量检查项：**三侧 id
      唯一性先于集合等价**（四轮 P2-3：Set 折叠重复值——惯例文件 `##` 标题重复 / 台账
      同 id 多行 / conventions_applied 重复 id 均显式 FAIL，id 是三方共同主键）/ 台账 id
      集合与惯例文件 `##` id 集合**精确集合相等**（不许子集）/ 判定值域（5 枚举）/
      VIOLATION 在问题清单有含 id 的对应条目 / conventions_applied ⊆ 惯例 id 集合 /
      每个 planned_location 按路径段边界前缀匹配命中目标文件集合 ≥1 文件 /
      **gate_ref 存在性**（五轮 P1-2 防静默失效：解析 gate 卡 `gate_ref{phase, rule_id}`，
      对 resolved phase rules 验证规则真实存在——**只验存在**，不读结果、不做跨报告
      比对，不复活时序循环）/ 台账 GATE_DELEGATED ⟺ 该 id 为 gate 卡（双向：review 卡
      不得填 GATE_DELEGATED，gate 卡不得填其它值）。
      severity=MAJOR。review-rules.yaml 登记 + fixtures 全分支（见验收方向）。
    status: pending
  - id: t5-openspec-and-closure
    content: >
      收口：① OpenSpec change 终验——实现与 t0 锁定语义逐条对账（偏差当场同步，
      Surface-plan-deviations 纪律），`npm run openspec:validate` 复跑过；
      ② goal/normal 双模式 parity 核验（消费全走 skill
      正文与 phase 检查，goal 复用同一 SKILL/harness，预期零额外机制——须实际核对 goal
      上下文装配不需单列 conventions，并在 change 里写 parity 声明）；③ 全量 unit +
      docs 一致性（DOC_INVENTORY / skills 索引 / adapter 接线清单交叉核对）；④ 维护者
      changelog 补一行。
    status: pending
isProject: false
---

## 1. 背景与问题定义

用户原始问题：在 maison 管线下开发新业务时，「本仓库的公共规约/条件/设计思路」（RDB 使用
方式与风格、分层落位、公共能力、接口使用策略）应在 spec/plan 阶段可获取并写入产物，但现有
知识载体装不下这类知识；且「如果构建新知识，如何与代码保持一致」「完全靠 AI 现场分析代码
又容易陷入混乱」。

四类既有载体为何装不下（第五类知识的存在性论证）：

| 载体 | 粒度 | 一致性机制 | 为何装不下横切工程实践 |
|---|---|---|---|
| `framework.config.json > architecture` | 层/依赖边 | 强（harness 依赖矩阵门禁） | 只有边，没有「怎么写」 |
| architecture.md | 层+模块清单 | 弱（impact 分级人工同步） | 明确禁止 feature 级内容入文 |
| module-catalog.yaml | 单模块 | 中（采集+人确认+门禁） | 惯例是横切的，切不进任何一个模块 |
| code-graph.yaml | 符号/节点 | 强（anchor+drift） | 索引「有哪些功能」，不是「用它的姿势」 |
| extensions/knowledge | 任意 | 无 | 能装，但 manifest 只做路径注册，无策展、无消费协议 |

## 2. 证据基础（钱包工程只读挖掘，2026-08-03）

挖掘产物是**设计输入**，不是钱包交付物。六条实证结论：

1. **证据源必须支持三类**：review 历史（homepage 仅 1 份报告——年轻工程语料必然稀薄）、
   代码归纳（RDB 收敛/账号态唯一读口，grep 实测 100% 符合）、既有文档收编（《多触发源
   纪要》§5 自带「Code Review 必查项」，是写好了没有家的 conventions）。
2. **符合率实测替代大半状态机之争**：一个确定性探针给出 established（100% 符合）/
   待人裁决（代码自身分裂，如 color token 双命名族——AI 无法从代码推断哪族正统，这正是
   「只有 convention 能解」的知识）/ aspirational（无代码可测）三态。
3. **三态在一个小工程里全部出现**——格式须能表达，但一个「范例：有/无/待裁决」即可，
   不需要四态生命周期状态机。
4. **去重必须是显式步骤**：4 个落选项（硬编码颜色/分层 import/UT 禁 UI 符号/文案走 $r）
   全是差点与既有门禁双源的。
5. **一致性不能指望「记得更新」**：FinancialCard 模块在钱包工程真实存在但 catalog 与
   architecture.md 均无记录——连带 y 确认流程+harness 门禁的 catalog 都会漂。
   **消费时校验（review 打开 exemplar）是主防线**，登记时纪律只是辅助。
6. **唯一重复 ≥2 次的 review 意见**（CR-002/CR-006 同形状：presentation 忽略 Repository
   已填字段自行硬编码/重建映射）验证了「挖坑优先」来源策略成立。

## 3. 设计决策记录（三方多轮收敛，review 时可逐条挑战）

| # | 决策 | 曾有的对案与裁决理由 |
|---|---|---|
| D1 | 位置=`paths.conventions`，默认 `doc/conventions.md` | codex 主张放 `<extension_dir>/knowledge/`（防新增硬编码路径）。裁决：DEFAULT_PATHS 已有 architecture_md/module_catalog/glossary 同族先例——加 paths 条目即同时满足「可配置」与「一级项目事实」；extensions 是 manifest 注册的机制目录，消费模式不同型 |
| D2 | 格式=弱结构 Markdown 单文件，**机器可读约定最小集 = `##` 标题即 id + gate 卡的 `enforcement: gate` 与 `gate_ref: <phase>/<rule_id>` 两行**（五轮 P1-2：gate_ref 须机器可验证，原「仅 `##` 是机器约定」与之矛盾故扩集；review 卡无机器字段；仍无 YAML schema）；字段：规则(MUST/SHOULD)/适用/范例(file+symbol 指针)/反例(只写伪代码形状，禁指生产文件)/仅新代码(默认是)/生效于(bootstrap 入库自动记日期)/探针(可选；存检索意图+期望结果，不存具体命令——O2 决议)/supersedes(可选) | codex 曾提七层 YAML schema+index.yaml。裁决：≤30 条上限×每条~150 字≈5K token 全量读得起，检索基础设施整套不需要；反例不指生产路径是 codex 的正确意见（修复后即 stale、AI 可能模仿反例），采纳 |
| D3 | 一致性机制=消费时范例存在性检查（文件+符号文本级，WARN），**不做** content_hash/drift | 曾拟复用 code-graph drift。核实实现后放弃：①提取器只认函数正则，class/interface/字段算不出 hash 且静默 continue（fail-open）；②review 每次全量人工复核在场，「只能触发复核」的机制边际价值为零；③文档宣称的三级分级（签名/体/消失）实现里不存在——按真实 writer 行为设计，不按文档 |
| D4 | 消费模型：review=主消费点（独立必读、目标代码驱动**非 diff 驱动**）；plan=非阻塞声明节+contracts 引用；coding=零新步骤（顺 plan 范例指针）；spec=研究清单一行 | 用户明确否决 diff 作为范围真源（review 须能独立审存量代码）；本仓 review 本就按 contracts>files 读全量源码，不用 diff——设计与现状同向 |
| D5 | 「仅新代码」=管辖权语义：基线=条目「生效于」日期（bootstrap 入库自动记）；**存量违反统一降级 legacy advisory 不阻断**，新增代码违反正常判级。**断代算法（可重复执行，三轮 P2-6 定案）**：未提交/未跟踪的行=新；`git blame` 行日期 ≥ 生效于=新；< 生效于=legacy；blame 不可用或无历史=NOT_ASSESSED→advisory 且**不得升级阻断**——不同 review 对同段代码结论一致靠此算法+「存量一律不阻断」双兜底 | 原「diff 天然只看新增行」的premise 被 D4 证伪后的重定义；同时解决老工程接入不爆炸与新老接替 supersedes 两个场景 |
| D6 | 来源策略=挖坑优先（review 重复意见/事故复盘），代码归纳只用于给条目找范例锚点，收编模式只入摘要+链接 | 「归纳代码」无法区分惯例与历史债（70% 这么写≠正确）；「从坑挖」自带规则+理由+反例三件套，且天然稀疏=没痛过的地方不立规矩 |
| D7 | 增长纪律：≤30 条软上限；判定规则已有 checker/lint 承载的**不得复制判定文本入库**，只能以 D8 gate 索引卡形态收录（卡片答「为什么有这个门禁」，checker 仍是唯一判定真源）；与既有门禁去重是 bootstrap 显式步骤 | 防止与 DSL/coding-rules/ut-rules 双源分叉；原「能 gate 的不入库」与 D8 自相矛盾（codex P1-5），按其第二案了断 |
| D8 | enforcement 两档：review（默认）/gate（卡片=三行：一句解释 + `gate_ref{phase, rule_id}` + 范例；规则判定权在 checker，卡片不复写规则文本；台账固定 GATE_DELEGATED） | codex「gate 必须指真实 rule_id」采纳并两轮推进：rule_id 跨 phase 不唯一 → 引用升级 (phase, rule_id) 二元组；结果不照抄——防伪造 GATE_PASS 与时序循环（review 报告先于本轮 check-review 生成） |
| D9 | **opt-in 零负担**：一切消费行为以惯例文件存在为开关——不存在时**运行时行为零变化**（spec/plan/review 与现状一致、check-review 按 t4④ 真值表处置）；framework-init **不**自动创建；UPDATE **不回填** `paths.conventions`（存量工程配置文件零 diff，运行时默认值兜底）；无文件工程的全部 footprint = 各 skill 文档几行条件文本 + AGENTS SSOT 表一行「可选」+ 新建工程 template 中一个 inactive 默认路径字段（四轮 P2-4 措辞修正：零负担=零行为变化，不虚称零配置存在） | 用户红线（2026-08-03 review 第 4 问定案）：conventions 非必选项，不得给原有流程增加负担 |

## 4. 明确不做（本 plan 的边界，写死防膨胀）

- resolver / index.yaml / 结构化 applicability（capabilities/layers/globs 匹配）——全量读
  即选择器；出现「读不完/常漏选」的真实信号再立项
- content_hash / drift 检查 / AST anchor provider
- ADR 独立目录、owner 字段、四态生命周期、waiver/exception schema——方向变更用条目内
  `supersedes` + 正文一段「为什么改」承载
- **standalone review targets**（`review_target: module|paths` 解析入口、输入降条件、
  NOT_ASSESSED 语义）——独立后续 change。对 codex P1-1 的部分采纳：t4 已把惯例核对协议
  写成「目标文件集合」参数化的自足过程，后续 change 只需新增 target 解析入口即可整段
  复用；但 ReviewContext 机制化/输入降条件本次不做——review 的 resume gate、上游裁决
  传播、receipt 全绑 feature 产物，条件化是大动脉手术，与 conventions 无依赖关系
- 新 harness phase（`--phase conventions` 之类）；conventions.md 格式校验脚本
- spec/plan 任何 BLOCKER 级 conventions 门禁；hooks 注入（用户明确不要 token 开销型强制）
- 自动生成条目免人确认；框架仓自产 doc/conventions.md（maison 自身不走 feature 管线，
  conventions.md 是**消费者实例产物**，框架只交付机制）
- framework-init 自动创建 conventions.md——创建唯一入口 = 用户显式跑
  `/conventions-bootstrap`（其 Step 0 自建骨架）
- 首批条目内容本身——钱包工程 dogfood 时用新 skill 产出（本次挖掘的候选清单
  【RDB 收敛/账号态唯一读口/展示字段单点填充/多触发源五条引用卡/分层 gate 三行卡/
  token 双族待拍板】作为 skill 首跑的输入素材，入库仍须走逐条 y 确认）

## 5. 开放问题（review 时定夺）

- **O1（已决，2026-08-04）**：台账确定性检查档位=**MAJOR**（激活与否按 t4④ 真值表）；
  覆盖证明=全量台账 + 最小 parser 确定性检查。
- **O2（已决，2026-08-04）**：`探针` 字段存**检索意图+期望结果**，不存具体命令
  （grep/rg 跨平台差异、Windows 宿主 coreutils 缺失风险）；执行者（bootstrap 实测/
  日后复检）自选工具。
- **O3（已决，2026-08-03）**：3.1.0 窗口，`deferred_to: 3.1.0` 已落 frontmatter，
  `check-plan-version` 复验通过。
- **O4**：命名——skill `conventions-bootstrap`、命令 `/conventions-bootstrap`、中文
  统一「惯例」；是否有更好的名字。
- **O5**：plan-template 新增「遵循的既有惯例」为**条件节**，须核对 plan-rules/check-plan
  的章节完整性检查如何对待条件节（不得把无 conventions 工程的 plan 判缺章；也不得让该节
  形同虚设）——实现时先读 plan-rules.yaml 再定接法。

## 6. 验收方向

- 机制侧：conventions 文件不存在时，spec/plan/review 行为与现状完全一致（零惊扰）；
  存在时 plan 产出声明节、review 报告产出全量覆盖台账、范例失效出 WARN。
- 门禁侧：台账确定性检查 fixtures 命中全部目标分支——台账缺一条 id FAIL / 判定值域外
  （5 枚举）FAIL / **重复 id 三侧各一负例 FAIL**（惯例标题重复/台账同 id 多行/声明重复，
  四轮 P2-3）/ conventions_applied 引用不存在的 id FAIL / VIOLATION 但问题清单无对应
  条目 FAIL / planned_location 命中 0 文件 FAIL / **无文件但 conventions_applied 非空
  FAIL（悬空契约，三轮 P1-3）** / **gate_ref 未知 phase FAIL / 未知 rule_id FAIL /
  review 卡误带 gate_ref 或误填 GATE_DELEGATED FAIL（五轮 P1-2 三负例）** /
  无文件且无声明 SKIP / 全一致 PASS；不误伤存量工程。
- verifier 接线侧（codex 补刀采纳）：内置样例（一条 RDB 惯例 + 明显违反的样例源码）断言
  ai-prompt.md 装配**包含 conventions 内容与目标源码**；台账集合等价负例在场。诚实边界：
  「AI 是否真的判出违规」属语义层，unit 不可证，由 verify-review 台账检查项 + 钱包
  dogfood 承担。
- 接线侧：六宿主命令入口 + skills 索引 + agent-bundle 桥全量一致（对照既有 skill 接线
  清单核对，出核对记录）。
- 治理侧：openspec validate --strict 过；goal/normal parity 声明落 change 文档。
- dogfood 出口（本 plan 之外的后续动作）：钱包工程用 `/conventions-bootstrap` 走一遍
  首批入库 + 下一个真实 feature 的 review 报告出现惯例核对段——那一步才回答「内容是否
  真的改变 AI 行为」。
