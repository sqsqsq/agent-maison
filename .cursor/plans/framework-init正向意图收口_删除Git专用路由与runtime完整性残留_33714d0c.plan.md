---
name: framework-init 正向意图收口 — 删除 Git 专用路由与 init 宿主 SCM 耦合
version: 3.0.0
# 2026-09-01 同一 Codex task 真实回归证明：发布件与 init 内核均正常，后续普通任务没有
# 再运行 init，却重播了上一轮 S4。直接故障是 current-turn 结果污染；同时
# a49772ad/d47e2ea6 引入的 Git 专用自然语言 taxonomy，以及本次同批清理的历史遗留
# init Git config 恢复与宿主 .gitignore 管理，均违反发布件唯一拓扑和宿主 SCM 无关契约。
# 本 plan 冻结后续实施方案；
# 旧 plan d3a7f1c8 已在上一轮清理为撤回记录。本轮不改生产/Skill/模板/OpenSpec/宿主，
# 不运行产品测试、framework-init 或打包，不提交推送。
todos:
  - id: t1-contract-and-openspec-convergence
    content: T1 契约与 OpenSpec 收口：继续修订唯一 active change `openspec/changes/framework-identity-boundary` 的 proposal/design/tasks，并新增 delta `specs/harness-gates/spec.md`、`specs/init-orchestration/spec.md`，修订 change 内 `specs/framework-integrity/spec.md`；明确删除 inspection #11、ensure-gitignore/ensureCanonicalGitignore、canonical host `.gitignore`、committed config 恢复与 canonical-gitignore policy consumer。framework-init 的纯正向入口、真实 S1 continuation、取消、误加载零副作用和 current-turn S4 作用域只落 init-orchestration delta，不混入 identity requirement；不改 archived changes、不新建平行 change。`33714d0c` 是唯一当前 SSOT，`d3a7f1c8` 只留撤回记录，`c3d8e1f6` 保持正确 runtime 基线；strict 通过后才改生产内容。
    status: completed
  - id: t2-remove-init-host-scm-coupling-and-audit-runtime-baseline
    content: T2 删除 init 宿主 SCM 耦合并审计 c3 runtime baseline：删除历史遗留 `show-last-committed-framework-config.mjs` 及 Skill/cwd 文档调用；从 check-init/planner/executor/orchestrate 契约中删除 `.gitignore` inspection、`ensure-gitignore` task、`ensureCanonicalGitignore` writer 与宿主 Git 配置诊断，删除 `canonical-gitignore.ts` 的宿主规则/等价/advisory 面；仅把仍有真实消费者的 `RuntimeArtifactPolicy` loader/matcher 原位迁成 Git 中性 helper，并继续以 `specs/runtime-artifact-policy.json` 为唯一真源。现有宿主 `.gitignore` 不迁移、不删除；同时 audit 普通 init/phase 仍不生产 `framework_integrity`、`framework_control_plane_dirty`、Git 派生 `framework_integrity_block` 或永久空壳，且不误删 package identity/EOL、process integrity、历史 renderer 与业务 Git evidence。
    status: completed
  - id: t3-simplify-framework-init-positive-entry
    content: T3 简化 framework-init 纯正向入口：把 `skills/skills.index.yaml` description 收敛为显式选择/调用、首次接入发布件、创建/补齐/迁移 config、集成新发布件后刷新 config/adapters/materialized artifacts 的正向范围，禁止 Git/SCM/status/diff/add/stage/commit/push 等负向 discovery 词；canonical 删除所有 route/result enum、旧 route label、普通任务分类、自然语言 route 表/parser/专用锚点和“先 X 再 init”编排，只保留明确正向入口、当前真实 S1 的合法批准、明确取消及原 Tier_1→S4/S2 gate。普通请求不选择、不读取、不经过该 Skill；若客户端/模型误加载，则零 init 副作用退出，不创建生产 router/state，Skill 行数预算不提高。
    status: completed
  - id: t4-clean-entry-surfaces-and-docs
    content: T4 清理 commands/bridge/AGENTS/docs：让 shared bridge 与 Claude/CodeAgent/Cursor command frontmatter 机械等于正向 index description；显式 command 只进入 canonical init 流程，删除普通任务 handoff/classification 文案。AGENTS/README 明确普通请求按主 Agent 正常路径处理，不把 framework-init 设为全局 router/preflight/public gate，并删除 Git 专用枚举/优先级；同步 harness-cli-cwd、init-rules、staging 示例、overview、MIGRATION、release checklist、profile addendum、personal/local config 与 runtime 输出文档中的 committed config、ensure-gitignore、自动 gitignored 承诺。所有 adapter 继续共享同一平台中性 canonical，既有宿主 SCM 内容不由 Maison 清理。
    status: completed
  - id: t5-rewrite-overfit-tests
    content: T5 删除/重写过度测试：将 `framework-init-routing-contract` 改为最小 entry-contract suite，删除 `ROUTING_CASES`、route/result enum、自然语言关键词分类函数/表与 AGENTS Git taxonomy 断言；精确验证正向 description、显式 init、真实 S1 后合法批准、明确取消、误加载时零 readiness/S1/planner/harness/结果副作用且不追问是否执行 init、行数预算与全 adapter 物化。普通请求不得作为 framework-init 正常输入 fixture；“先 X 再 init”不进入 framework-init suite，内部测试只证明 Skill 没有 X 的 route/label/状态，顺序理解属于主 Agent 契约且不是本 plan 的额外验收任务。同步删除 canonical-gitignore writer suite/runner 注册和 init ensure-gitignore 断言；guard/release 测试改读 Git 中性 runtime-artifact-policy helper，smoke 删除 framework-init 自动管理宿主 `.gitignore` 的 case/stage 接线但保留 c3 upgradeOverlay 五态不变性及其它真实 Git/run evidence。
    status: completed
  - id: t6-current-turn-result-isolation
    content: T6 增加 current-turn 结果隔离回归：canonical/commands 明确 S4 只证明生成它的 turn/run；下一条用户消息后旧 S1/plan/run-log/summary/S4 不得成为当前完成结果；无本 turn 新 init run 不得宣称本轮 init 完成；task title、历史 Skill 选择与 prior S4 不自动续入。加入同一 task 两轮 test-only transcript：A 明确调用 init 并产生真实 S4，B 为普通请求且记录 `framework-init selected/read/invoked=false`、无新 report，由主 Agent 正常处理；另以独立误加载 fixture 只断言零 init 副作用退出。不得让 B 先进入 Skill 再返回，不建立 router、nonce/token/租约/route DB/外部 baseline，静态测试明确不冒充真实客户端选择行为。
    status: completed
  - id: t7-targeted-and-full-validation
    content: T7 定向与全量验收：OpenSpec strict 后运行 typecheck、entry/adapter/init/check-init/guard/release-boundary/smoke-registry/framework-identity/history-compat 定向 suites，逐项复现纯正向 init、合法 S2、取消、误加载零副作用、普通请求不选择/读取/经过 Skill、两轮结果隔离、init 零宿主 Git 读写及 c3 退役 writer 零回归；验证 change 归档后不会留下 base requirement 要求已删除 task/writer。随后按发布内容改动门禁运行 `cd harness && npm test`、release identity 非打包单测、plan-version、受影响发布内容有界文本核查、diff/LF。不得用“全绿”代替事故断言，不运行 release pack/all、真实宿主或业务 provider/Hylyre 扩面。
    status: completed
overview: >
  framework-init 仅由明确正向 init 意图或当前尚未完成的真实 S1 continuation 触发，不是全局
  请求 router、preflight 或 public gate。普通请求不选择、不读取、不经过该 Skill；若客户端或
  模型误加载，则零 init 副作用退出，由主 Agent 继续正常任务。同步删除 init 对 committed
  config 与宿主 .gitignore 的读写，并钉死 S4 的 turn/run 作用域。发布/明确集成边界、非阻断
  package identity、Write/Edit 守卫、强隔离、process integrity、历史兼容及业务 Git evidence 保留。
---

# framework-init 正向意图收口：删除 Git 专用路由与 init 宿主 SCM 耦合（33714d0c）

状态：**待实施；本轮只编写 plan，未实施任何代码或宿主操作。**

## 0. Plan 身份、授权与规范谱系

| 项 | 冻结值 |
|---|---|
| plan id | `33714d0c` |
| version | `3.0.0`（读取自根 `package.json`） |
| 开发仓 | `D:/1.code/agent-maison-br` |
| active OpenSpec 唯一承载 | `openspec/changes/framework-identity-boundary` |
| 正确历史基线 | `c3d8e1f6` / `e4711d0e`：普通 runtime Framework Git/hash 裁决已退场 |
| 已撤回的旧 plan | `d3a7f1c8` 已同步清理为简短撤回记录；原规范正文、任务、fixture 与验收均已删除 |
| 历史 commits | `a49772ad` / `d47e2ea6` 保留为不可变提交历史；不做 rebase/filter-branch/force-push |
| 消费者拓扑 | Maison 已构建并校验的发布件落到宿主 `framework/`；不是 submodule |
| 本轮唯一允许写入 | 本 plan；`d3a7f1c8` 撤回记录保持只读不变 |
| 本轮禁止 | 生产、Skill、模板、OpenSpec、宿主修改；产品测试；framework-init；打包；Git add/commit/push |

规范优先级冻结如下：

1. 根 `AGENTS.md` 的发布件唯一拓扑、宿主 SCM 无关边界与三条总设计原则；
2. 本 plan 的新纠偏结论；
3. T1 修订后的唯一 active OpenSpec change；
4. `c3d8e1f6` 仅作为已完成 runtime 退场基线；
5. `d3a7f1c8` 仅记录“原方案已撤回”的事实，不再包含或承载设计、实现、fixture、验收规则。

本 plan 是当前唯一 framework-init 意图纠偏规范。`d3a7f1c8` 已在上一轮按用户授权同步清理；不得再向其追加任务、恢复原机制、保留旧 route label 作为兼容别名，或另建 OpenSpec change 维持两套模型。

当前开发工作区已有大量与本主题无关的未提交改动；本轮只修订本 plan，`d3a7f1c8` 保持上一轮撤回内容不变，其它路径均未触碰。未来实施者须以当时工作树为准避让用户改动，不得借本 plan 清理、覆盖或暂存无关路径。

### 0.1 旧 plan 同步撤回已在上一轮完成

`framework-init误触发纠偏_Git-SCM-L0路由与Skill意图早退_d3a7f1c8.plan.md` 现只保留：原事故、两轮专用路由属于错误修复、方案撤回、当前由本 plan 接管。其 frontmatter 已收敛为单一 `cancelled` 撤回记录，正文不再提供任何可执行设计或验收依据。

## 1. 已冻结的真实事实与事故边界

### 1.1 发布件没有装错

只读核验对象：`D:/1.code/SimulatedWalletForHmos/framework`。

| 证据 | 已核实结果 |
|---|---|
| `RELEASE-MANIFEST.json.version` | `3.0.0` |
| `source_commit` | `d47e2ea65c878120f4e3d8bbff2084ce27298663` |
| manifest 文件数 | `1094` |
| missing | `0` |
| hash mismatch | `0` |
| sidecar 声明 | `54d13bcc145f2f5469fe49a81a0a29fc583df8121725e3212f2c15df229735b9` |
| manifest 实际 SHA256 | 与 sidecar 逐字相同 |
| canonical/index/AGENTS/bridge/三个 command | 均在 manifest 中且逐文件 hash 匹配 |

因此事故不是发布件覆盖失败、旧 bridge 残留或宿主装错版本。不得把修复做成 updater flag、重新验包、runtime hash 或 host Git baseline。

### 1.2 唯一真实 init run 来自显式 init 与合法批准

真实 task：

- thread id：`01a019b4-2f73-7a41-834e-04994cf04684`
- title：`Run framework initialization`
- 显式 init turn：`01a05ced-5e72-7db3-8aaf-e3dbcf97c59b`
- S2 批准 turn：`01a05cef-8736-7430-bb73-e3317d3cad98`
- 唯一报告目录：`D:/1.code/SimulatedWalletForHmos/framework/harness/reports/_global/init-orchestrate/20260901T122648Z/`

该 run 的事实：

- `started_at=2026-09-01T12:26:48.642Z`；`finished_at=2026-09-01T12:27:01.333Z`；
- `mode=update`、`decision_mode=smart`；
- `executed=14`、`skipped=6`、`failed=0`；
- `run-global-phases` 完成 catalog/glossary/docs；
- 当时仍执行了 `ensure-gitignore`，结果为 `canonical 已齐备`。

这次 S4 是上一轮真实 init 的正确结果，只能归属于产生它的 run/turn。

### 1.3 下一轮普通任务没有再次运行 init

事故 turn：`01a05cf0-318d-7f11-b39d-f753386826a9`。

用户消息是“整理下framework及其衍生物并提交，不相关的别动”。Agent 首条 commentary 已正确说“按 Git 提交主动作，不再运行 framework-init”，但随后：

- 该 turn 没有任何工具调用；
- init report 根目录仍只有 `20260901T122648Z`，没有第二个 run-log/summary；
- 没有产生 Git commit；
- 后续 commentary 与 final 却逐字重播上一轮 `14 executed / 6 skipped / 0 failed` 和同一报告路径。

最新截图 `1-照片-1.jpg` 展示的正是该历史 S4 重播，而不是新 init 结果。

### 1.4 根因分层

直接故障：**同一 task 的历史 S4/current-turn 结果污染**。Agent 已正确识别最新任务，却把前一 turn 的完成结果当成当前 turn 结果。

同时存在的错误设计：`a49772ad`/`d47e2ea6` 把 framework-init 扩成 Git/SCM 自然语言分类器：

- discovery description 主动放入 Git/SCM/status/diff/add/stage/commit/push；
- canonical 建立 Git-only 优先级、10 行输入/route 表与两个 Git route label；
- AGENTS/README/commands/bridge 复制 Git handoff；
- unit test 解析 route 表并维护第二份 `ROUTING_CASES`。

这套设计没有造成第二次 init 执行，但它仍违反职责边界并扩大 Skill 被普通任务命中的风险，必须与 current-turn 修复同批删除。

与这两轮 taxonomy 提交相互独立、但本 plan 同批清理的，是更早形成的存量宿主 SCM 耦合：

- `show-last-committed-framework-config.mjs` 由 `062f7dbf`（2026-05-18）引入；
- `canonical-gitignore.ts` 由 `dd2dd717`（2026-05-20）引入；
- planner 的 `ensure-gitignore` task 由 `ab83de8f`（2026-05-30）引入。

因此后两类机制不是 `a49772ad`/`d47e2ea6` 的事故产物；它们只是同样违反当前发布件/宿主 SCM 权责边界，故在本纠偏中一起退场。后续考古与 OpenSpec 不得把“taxonomy 回滚”和“历史存量 SCM 耦合清理”混写成同一提交谱系。

## 2. 正确目标模型：纯正向入口，不是全局路由

核心契约：

> framework-init 仅由明确正向 init 意图或当前真实 S1 continuation 触发，不是全局请求路由。普通请求不选择、不读取、不经过该 Skill。若 Skill 被客户端/模型误加载，则零副作用退出；普通任务仍由主 Agent 负责。

### 2.1 正常入口

framework-init 只在以下事实之一成立时开始或继续：

1. 用户明确选择或调用 framework-init；
2. 用户明确要求首次接入 Maison 发布件；
3. 用户明确要求创建、补齐或迁移 `framework.config.json`；
4. 用户明确要求集成新发布件后刷新 config/adapters/materialized artifacts；
5. 当前对话存在尚未完成的真实 S1 `InitTaskPlan`，用户给出合法 plan/adapters 批准，且最新消息未取消或切换任务。

明确取消只终止当前尚未完成的 init，不生成 S3/S4。取消同时包含其它任务时，framework-init 只停止自身；其它任务始终由主 Agent 处理，不进入 Skill 的分类或编排。

### 2.2 普通请求不经过 Skill

普通问题、代码修改、review、文档、版本控制及其它任务均由主 Agent 按正常路径处理：

- 不选择 framework-init；
- 不读取 canonical Skill；
- 不运行任何 init applicability preflight/public gate；
- 不要求 framework-init 解释、分类、命名或交还该任务。

“先完成 X，再执行 framework-init”同样由主 Agent 理解顺序：主 Agent 先完成 X，到明确 init 动作时才调用 framework-init。Skill 不知道 X 是什么，不为 X 创建 label、fixture 或状态。

### 2.3 误加载兜底不是正式路由

如果客户端或模型已经错误加载 framework-init，而最新消息不满足 §2.1：

- 不运行 readiness、S1、planner、harness 或任何 init 工具；
- 不生成、复述或链接 init 结果；
- 不解释、分类或接管普通任务；
- 不追问是否执行 init，也不要求用户换一种话术重新调用；
- 立即停止 Skill 自身，普通任务仍由主 Agent 正常处理。

该兜底不命名、不枚举、不落 route 表，也不作为普通请求的正式输入路径。不得新增 router 函数、状态机、config/env key、持久会话状态、nonce/token/租约/route DB。S1→S4、registry enum、adapter 多选、smart/manual、config merge、cleanup、global phases 等 init 内核保持原样，除明确删除的 Git 特例。

## 3. Current-turn 结果隔离契约

### 3.1 作用域

1. S4 只证明其 `run_log` 中 `started_at/finished_at/project_root` 对应的那次 S3 run；
2. 用户发送下一条消息后，旧 `InitTaskPlan`、run-log、summary 与 S4 只可作为历史上下文，不是当前完成结果；
3. 唯一例外是尚未完成的真实 S1 可作为合法 S2 批准上下文，但当前 turn 必须实际新建 S3 run 后才能产生新的 S4；
4. 当前 turn 没有新增 init run/report，就不得说“本轮 init 已完成”、复述旧计数或把旧报告列为本轮产物；
5. framework-init 已完成后，下一条普通消息由主 Agent 正常处理，Skill 不被选择、读取或调用；
6. task title、历史 Skill chip/command、prior S4 不自动续入 init；commentary、工具动作与 final 必须共同反映当前 turn 的真实工作，不能重播历史结果。

### 3.2 简单实现边界

这是 canonical/command 的 turn-local 结果约束，不是新增 runtime 状态协议或普通任务入口：

- 使用对话中已经存在的“最新用户消息、当前 turn 是否执行了新 S3、当前 turn 是否得到新 run-log”事实；
- 不写磁盘状态，不修改 init run-log schema，不给报告加 token；
- 不把报告目录扫描变成生产路由器；报告存在性只在 Maison 内部 init fixture 中作为结果证据；
- 不让防历史重播演化成“所有跨 turn 都不能继续”——合法 S2 continuation 仍保留。

## 4. 契约与 OpenSpec 收口（T1）

只修订 `openspec/changes/framework-identity-boundary`。不得直接改 current base specs 来掩盖 delta 缺口，也不得另建 change。

| 文件 | 必须修订的内容 |
|---|---|
| `proposal.md` | 在已有 runtime Git/hash 退场基础上补充纯正向 init 入口、误加载零副作用、current-turn 结果隔离与宿主 SCM 配置退场；记录 122648Z 单 run + 下一 turn 零工具却重播 S4 的反例 |
| `design.md` | 冻结“普通请求不选择/读取/经过 Skill”、正向 description、误加载仅退出、无 router/state 与 `.gitignore` 权责决定；“先 X 再 init”归主 Agent，不进入 Skill 设计 |
| `specs/harness-gates/spec.md`（新增 delta） | 以 REMOVED/MODIFIED 明确删除 current base 的 inspection #11、`ensure-gitignore`、`ensureCanonicalGitignore`、canonical init `.gitignore` patterns 及相应 probe/体检要求；不得用新 inspection 或兼容 SKIP 替代 |
| `specs/init-orchestration/spec.md`（新增 delta） | 以 REMOVED/MODIFIED 删除 `ensure-gitignore` task/writer 及 preflight 对 `.gitignore` 的机制边界；删除从 Git 历史恢复 config。正向入口、真实 S1 continuation、明确取消、误加载零副作用和 S4 turn/run 作用域全部落在此 delta |
| `specs/framework-integrity/spec.md`（修订 change 现有 delta） | 删除 `canonical-gitignore.ts` 作为 runtime artifact policy consumer；policy 只服务仍存在的 Write/Edit guard、release/package 边界及 Git 中性 helper。只保留 release/package identity、Write/Edit guard、普通 runtime Git/hash 不变量与历史兼容，不承载 framework-init 普通请求规则 |
| `specs/runtime-policy/spec.md` | 明确 runtime-artifact policy 只描述 Maison 输出/守卫路径，不再派生宿主 Git 配置或补偿 detector |
| `specs/goal-runner/spec.md` | audit-only：process integrity 与历史 renderer 契约保持，不因本次 init 入口收口扩面 |
| `specs/release-boundary/spec.md` | 保留 pack/verify、manifest/sidecar 与发布件文件集合；宿主 Git 收编不属于 release 完成条件 |
| `tasks.md` | 追加上述三个 spec delta 与实现/测试清理 task，或仅重开真实被新事实推翻的条目；既有 c3 完成事实不伪造为 pending |

T1 完成必须同时证明：

1. active change strict 通过；
2. delta 语义足以保证该 change 归档后，base `harness-gates` / `init-orchestration` / `framework-integrity` 不再要求任何已删除 inspection、task、writer 或 policy consumer；
3. framework-init 正向入口、真实 S1 continuation、取消、误加载退出与 current-turn S4 作用域只在 init-orchestration delta 定义，不混写成 framework identity requirement；
4. framework-integrity 只保留 release/package identity、Write/Edit guard、runtime Git/hash 不变量与历史兼容；
5. archived OpenSpec changes 原件未修改，且没有平行 active change。

验收不能只看“strict 绿”；必须逐条对照 current base 中现存的旧要求，确认 REMOVED/MODIFIED delta 在 archive merge 后会真正消除它们。

## 5. 删除 init 宿主 SCM 耦合并审计 c3 runtime baseline（T2）

### 5.1 删除 committed config 恢复支线

删除：

- `harness/scripts/show-last-committed-framework-config.mjs`；
- canonical S1.1 中“config MISSING 且为 git 仓时读取 HEAD 快照”；
- `skills/reference/harness-cli-cwd.md` 的该脚本入口；
- 当前发布内容、测试或注释中对 `recovered_framework_config` / `HEAD:framework.config.json` 的现行引用。

收口后 config 输入只有当前磁盘 config、模板/backfill/migration 和 S2 用户批准 payload。磁盘缺失按 CREATE/迁移契约处理；不得从任意 SCM 历史、stash、index 或 ref 猜测 Maison config。

### 5.2 删除 `ensure-gitignore` 整条主链

生产调用链必须同时退役：

| 当前位置 | 删除动作 |
|---|---|
| `check-init.ts` | 删除 canonical-gitignore imports、`inspect11`、11 项计数/strategy、`gitignore_sync` 与 `__testing` exports；probe 不再读宿主 `.gitignore` |
| `init-task-planner.ts` | 删除不可跳过 `ensure-gitignore` mechanism task；更新“纯只读探测”注释 |
| `init-task-executor.ts` | 删除 import 与 `case 'ensure-gitignore'` writer |
| `init-orchestrate.ts` / staging 示例 | task plan、decision、run-log/summary 中自然不再出现该 task；不新增兼容 SKIP entry |
| `canonical-gitignore.ts` | 删除 host ignore patterns、equivalence、advisory、parse/ensure writer 与环境 bypass；通用 policy helper 迁出后删除该文件 |

Maison 不删除现有宿主 `.gitignore` 的任何行，也不提供自动反向迁移；那些字节属于宿主。新 init 只是不再读取、诊断或修改它。

### 5.3 保留真实的 runtime artifact policy 能力

`specs/runtime-artifact-policy.json` 仍是以下能力的 SSOT：

- framework runtime write-allow / shipped-file deny 边界；
- release pack/verify 对 ignored runtime directories 内 shipped files 的文件集合保护；
- 测试对共享 glob 语义的机械一致性。

把当前 `canonical-gitignore.ts` 内仍有真实消费者的 `RuntimeArtifactPolicy` 类型、loader 与 `matchesPolicyPattern` 移到 Git 中性的 `harness/scripts/utils/runtime-artifact-policy.ts`；这只是移动既有 reader，不新增状态或第二份清单。`agents/shared/guard-framework-write-core.mjs` 继续读取同一 JSON；相关测试从“三方 gitignore/guard/integrity”改成“policy SSOT ↔ guard/release consumer”。

同步修正 `specs/runtime-artifact-policy.json` 的 `_comment` / `_comment_shipped`：删除 canonical-gitignore、extra-file scan、宿主跟踪与 `!` 规则叙事，只描述仍存在的守卫、发布文件和输出边界。

### 5.4 输出卫生不再借宿主 Git 承载

删除自动 Git 配置不等于删除合法 runtime 输出：

- `framework/harness/{node_modules,dist,reports,state,...}` 继续按 runtime policy 与各 writer 的路径契约落在 Maison 自有目录；
- `doc/*-staging`、feature reports/goal-runs、app snapshot、`.framework-backup`、`scratch/` 等继续由各自产生者/清理器负责，不以是否被忽略决定正确性；
- `framework.local.json` 继续是 personal/local config，但 Maison 不再承诺或代写“gitignored”；宿主是否纳入 SCM 由宿主决定；
- 本 plan 不借机迁移 local config、不新增场外状态类型，也不创建另一套 ignore 文件。

必须同步清理现行“由 framework-init 自动忽略”的文档与注释，包括但不限于：

- `skills/reference/{host-harness-readiness,personal-setup-gate,goal-mode-operations,harness-cli-cwd}.md`；
- `agents/README.md`、`skills/project/framework-init/SKILL.md`、`skills/project/framework-init/templates/staging-schema-example.md`；
- `profiles/hmos-app/skills/framework-init/profile-addendum.md` 的宿主 `.gitignore` 追加段及对应测试；
- `profiles/hmos-app/skills/device-testing/profile-addendum.md`、相关 runtime output 注释；
- `specs/phase-rules/init-rules.yaml`、`docs/overview.md`、`docs/operations/release-checklist.md`、`MIGRATION.md`；
- smoke 与 tests 中声称 framework-init/canonical Git 配置是发布正确性前提的说明。

### 5.5 c3 baseline 只 audit，不重复实现

必须保留：

- `framework-integrity.ts` 的 manifest/package identity reader、sidecar 声明值读取、非阻断展示与 `normalizeIntegrityTextEol`；
- `harness-runner.ts` 当前没有 `runFrameworkIntegrityPreflight`；
- pack/release verify、candidate/明确集成边界的 manifest/sidecar/per-file 校验；
- `node_options_injection/process_injection` 当前真实 integrity halt；
- 历史 `framework_integrity`/subtype 的 parser/renderer provenance；
- Write/Edit 合作守卫、OS/sandbox/ACL/read-only 强隔离及盲区说明；
- 普通业务 diff、scope、UT mutation、run identity 等 Git evidence。

反向验收采用 source-sensitive 口径：新 writer/result 必须为零，但不能对 `framework_integrity_block` 或历史字符串做全仓零命中，因为它们仍承载 process integrity 与历史读取。

## 6. 简化正向入口（T3）

### 6.1 Description SSOT

`skills/skills.index.yaml` 继续是机器 description 唯一 SSOT。建议语义为：

> 用于显式选择或调用 framework-init、首次接入 Maison 发布件、创建/补齐/迁移 framework.config，以及集成新发布件后刷新 config、adapters 与 materialized artifacts。

具体文字可在实施时压缩，但必须满足：

- 只含正向适用范围；
- 不含 `Git`、`SCM`、`status`、`diff`、`add`、`stage`、`commit`、`push`；
- shared bridge 与三个 checked-in command 的 frontmatter 逐字相等；
- dynamic bridge/materializer 继续复用既有 index loader，不恢复 literal map/frontmatter parser。

### 6.2 Canonical 结构

删除现有：

- Git-only priority 与普通任务执行细节；
- `exit_init_continue_git_l0`、`git_l0_then_framework_init`；
- `framework-init-routing-contract:start/end` 及 10 行自然语言表；
- 任何 route/result 名称集合、枚举、parser 或 expected-label fixture；
- staged/unstaged/push 授权等当前任务细节；
- framework-init 对“先 X、再 init”的顺序编排；
- “仅出现某些负向关键词”式排除闭集。

canonical 顶部只声明 §2.1 的正向入口、真实 S1 continuation 与明确取消。误加载兜底用一段无名称的零副作用退出约束表达，且位于前置声明、Tier_1 readiness、S1 与任何 harness 命令之前；它不是全局请求 gate，也不列普通任务种类。

原 init 内核必须保持：显式调用进入 Tier_1→S1；真实 S1 后合法批准继续；S3 仍须 S2；纯取消退出；CREATE/UPDATE、adapter registry、smart/manual、staging、S4 动态 next steps 不变。

canonical 当前为 260 行上限；删除旧表后有自然余量。实施不得提高 `docs-rules.yaml` 预算，也不得用新增 reference 复制另一套路由契约。普通请求不因包含 framework 名词而成为 canonical fixture；防误选主要依赖纯正向 description，误加载退出只兜底客户端/模型错误选择。

## 7. 清理入口、AGENTS 与文档（T4）

| 文件/面 | 改造要求 |
|---|---|
| shared bridge | 只保留正向 description + canonical 链接；无普通任务 handoff/classification |
| Claude/CodeAgent/Cursor commands | 只作为用户明确调用的薄入口，读取 canonical 后进入 Tier_1→S1；不承担普通请求分流。若命令上下文被错误加载，服从 canonical 的无名称零副作用退出 |
| `templates/AGENTS.md.template` | L0 行恢复通用 direct 描述；删除 Git 动作枚举、Git-only priority、push/staging handoff；明确 normal routing 由主 Agent 负责，framework-init 不是全局 preflight/public gate |
| `skills/README.md` | 只摘要正向适用范围；普通请求不选择、不读取、不经过 framework-init，不把“交还任务”写成 Skill 能力 |
| Codex/Cursor bridges | `.codex/skills`、`.cursor/skills` 共享 canonical；Cursor command+bridge 双入口继续覆盖 |
| Chrys/Generic/OpenCode | `.agents` / `.opencode/skill` bridge 继续由同一 index/canonical 物化；OpenCode slash 不分叉 |

AGENTS 模板当前 110 行、预算 120；canonical 当前 260 行、预算 260。两个预算均不得提高。删除多余 taxonomy 后应保持或降低行数，而不是用腾出的空间建立新的普通任务枚举。

## 8. 删除/重写过度测试（T5）

### 8.1 Entry contract suite

将 `harness/tests/unit/framework-init-routing-contract.unit.test.ts` 重命名/重写为职责更窄的 `framework-init-entry-contract.unit.test.ts`，并同步 `harness/tests/run-unit.ts`：

1. 删除 `ROUTING_CASES`、`routingRows()`、自然语言 route 表解析与旧 anchor；
2. description 只含正向动作，严格拒绝八个负向 discovery token；
3. canonical 不含 route/result enum、自然语言 route 表、parser、expected-label 集合或普通任务 taxonomy；
4. 显式选择/调用与四类明确 init 动作进入原 Tier_1→S1；
5. 当前尚未完成的真实 S1 后合法 plan/adapters 批准继续 S2→S3；无 S1 的裸批准不触发；
6. 明确取消停止未完成 init，且零 S3/report；
7. 独立误加载 fixture 只验证零 readiness/S1/planner/harness、零 init 结果且不追问是否执行 init；不把普通请求登记为 Skill 的正常输入案例；
8. “先 X 再 init”不进入 framework-init suite；内部测试只证明 Skill 没有 X 的 route/label/状态，顺序理解属于主 Agent 契约且不是本 plan 的额外验收任务；
9. 保留 actual adapter materialization，一次覆盖 Codex、Claude、CodeAgent、Cursor 双入口、Chrys、Generic、OpenCode；
10. 反向证明生产代码没有 route map/parser/state/config/env key，且 canonical/AGENTS 行数预算不提高。

测试可以读取真实 canonical/index/commands/bridge 并做精确文本断言，但不得用关键词函数推断自然语言 route，不得让 fixture 被生产代码读取，也不得声称静态测试能证明客户端一定不会误选 Skill。

### 8.2 Init Git 特例测试退场

删除或改写：

- `canonical-gitignore.unit.test.ts` 及 suite 注册；通用 policy/guard/release 断言迁到对应职责 suite；
- `init-task-executor.unit.test.ts` 的 ensure-gitignore writer 用例；
- `init-orchestrate.unit.test.ts` / smoke 中 task、preflight、run-log、文件创建断言；
- `init-orchestrate-smoke.unit.test.ts` 的 plan 含 ensure-gitignore 与 inspection #11 断言；
- `template-renderer.unit.test.ts` 的 AGENTS Git L0 枚举断言；
- profile addendum 中宿主 `.gitignore` 指引及对应 unit；
- lifecycle smoke 的 canonical Gitignore evaluator、历史宽规则 fixture、`depsHost`（若唯一职责是跑 writer）和 case #1 Git 收编语义。

smoke 调整不得删除 `upgradeOverlay`：它是 `c3d8e1f6` 的正确事故回归，使用 Git 只为构造 dirty/staged/committed/non-Git 五态并证明 Maison verdict 不变，不是 framework-init 分类器。若 smoke 仍需忽略 test-only `node_modules` 才能合成 commit，须由 fixture 自己的最小测试基础设施负责并明确不来自 Maison/init；不得恢复 canonical host writer。

## 9. Current-turn 两轮回归（T6）

### 9.1 Test-only fixture

建立一个最小同 task 两轮主 Agent transcript fixture，不把 Turn B 送入 framework-init：

| turn | fixture 事实 | 必须断言 |
|---|---|---|
| A | 显式 init + 合法 S2，产生唯一新 run-log/summary 与 S4 | S4 可报告该 run |
| B | 新用户消息为普通任务；`framework-init selected/read/invoked=false`；工具记录无 init；report 集合无增量 | 主 Agent 正常处理 B；禁止输出 A 的计数、报告路径或“本轮 init 完成” |

该 fixture 只表示主 Agent 层的选择与结果事实；framework-init suite 不读取 Turn B 文本，也不为它生成 label。另建一个独立的误加载防御 fixture：模拟 Skill 已被错误装入上下文，只断言 canonical 在任何 init 命令前零副作用停止，不断言普通任务类别或后续执行结果。

另保留一个实际 init run artifact builder/summary 单测，证明 `buildRunSummary` 本身仍只总结传入 log，不能把模型跨 turn 行为错误归因给 init 内核。

### 9.2 机器证明边界

内部静态/单元测试能证明：

- Maison 发布了纯正向 description、误加载零副作用与 turn-local S4 文本；
- 所有 adapter 拿到同一 canonical；
- init 生产代码没有 Git route/state；
- 两轮主 Agent fixture 明确 Turn B 未选择/读取/调用 Skill，且 current-turn 契约没被文案回归删除。

内部测试不能证明：

- Desktop/Codex/Claude/Cursor 一定按该文本正确处理任意自然语言；
- 客户端一定不会为普通请求误选或预加载 framework-init；
- 模型不会在真实长上下文中再次重播历史消息；
- task title 或 UI Skill 上下文的实际客户端选择算法。

这些是已知证明边界，不是本 plan 的未完成任务，也不要求 Maison coder 交付宿主复验步骤。测试名称与完成说明必须诚实限定为 Maison 已发布文本、物化字节和内部 fixture 的证明。

## 10. 定向与全量验收（T7）

### 10.1 事故级验收矩阵

| ID | 场景 | 必须结果 |
|---|---|---|
| A | 显式选择/调用 framework-init | 进入 Tier_1→S1；不二次澄清；S3 仍等 S2 |
| B | 本对话真实 S1 后合法 plan/adapters 批准 | 继续 S2→S3；新建本轮 S3 run 后才可 S4 |
| C | 明确取消尚未完成 init | 停止 init；零 S3/report；不产生普通任务分类 |
| D | 普通请求 | 主 Agent 正常处理，framework-init 不被选择、读取或调用 |
| E | Skill 被客户端/模型误加载且无正向 init 意图 | 在任何 init 命令前零副作用停止；不解释/分类普通任务 |
| F | 主 Agent 收到“先 X，再 framework-init” | 先完成 X；到明确 init 动作时才调用 Skill，framework-init 不感知 X |
| G | Turn A 已 S4，Turn B 为普通请求且没有新 run | Turn B 未选择/读取/调用 Skill；零旧 S4 重播、零“本轮 init 完成”，final 只报告 B |
| H | config MISSING | 只按当前磁盘/CREATE/S2 契约；不读 Git 历史 |
| I | init S1/S3 | 不读、诊断、创建或修改宿主 `.gitignore`；plan/log 无 ensure-gitignore |
| J | 普通 phase/init fresh report | 零 `framework_integrity` / `framework_control_plane_dirty` / Git 派生 blocker 或空壳 |
| K | process injection 与旧报告 | 当前 process integrity 仍 halt；旧 framework subtype 仍可显示但不进入当前裁决 |
| L | release/package identity | pack/verify 源码与非阻断 identity 能力仍在；不执行实际 pack |
| M | 全 adapter 物化 | 七类入口共享同一正向 description/canonical，Cursor 双入口不漏 |
| N | OpenSpec archive projection | harness-gates/init-orchestration/framework-integrity base 投影不再要求已删除 inspection/task/writer/policy consumer；archived changes 未改 |

### 10.2 将来实施的命令顺序

1. `npm run openspec:validate`；
2. `cd harness && npm run typecheck`；
3. `cd harness && npx ts-node --transpile-only tests/run-unit.ts --filter framework-init-entry-contract`；
4. 定向运行 `init-orchestrate-smoke`；
5. 定向运行 `init-orchestrate`；
6. 定向运行 `init-task-executor`；
7. 定向运行 `template-renderer`；
8. 定向运行 `generic-bundle`、`chrys-opencode-adapter` 等受影响 adapter suites；
9. 定向运行 `guard-framework-write`；
10. 定向运行 `release-shipped-in-ignored-dirs`；
11. 定向运行 `framework-integrity`；
12. 定向运行 `goal-headless-guard`；
13. 定向运行 `smoke-lifecycle-registry`；
14. `cd harness && npm test`；
15. `node --test scripts/tests/release-identity.unit.mjs`（非打包单测）；
16. `node scripts/check-plan-version.mjs`；
17. 受影响发布内容的有界文本/调用点核查；
18. `git diff --check` 与本批文本 CR/LF 扫描。

T7 只负责 Maison 内部验证。完成不要求、也不得由 coder 执行：

- `candidate:build`；
- `release:pack` / `release:all` / `release:smoke-consumer`；
- 宿主安装或操作 `SimulatedWalletForHmos`；
- 真实 Codex/Claude/Cursor/OpenCode 回归；
- 宿主 report、turn、工具调用记录或用户截图。

有界核查至少拒绝：

- framework-init description 中八个负向 discovery token；
- 旧两个 route label、Git-only、10 行 route anchor/`ROUTING_CASES`；任何 route/result enum、parser 或普通任务 expected-label fixture；
- `show-last-committed-framework-config` / `recovered_framework_config` 现行调用；
- init/check-init/planner/executor 中 `ensure-gitignore` / `ensureCanonicalGitignore` / host `.gitignore` writer；
- canonical-gitignore 作为 guard/release/runtime identity 消费者；
- 新 `framework_integrity` / `framework_control_plane_dirty` writer 或永远 SKIP/PASS 空壳。

OpenSpec 有界核查还必须读取 current base 与 change delta 的合并语义，确认 `harness-gates`、`init-orchestration`、`framework-integrity` 三个 capability 在 archive 后不会残留相反 requirement；仅检查 change 文件存在或 strict exit code 不足以验收。

不得以全仓禁止 `git diff`、`framework_integrity_block` 或历史 subtype 字符串的方式验收，否则会误删合法业务 evidence、process integrity 与历史兼容。

本实施不运行 `candidate:build`、`release:pack`、`release:all`、`release:smoke-consumer` 的真实 pack 链，不产 dist，也不触碰真实宿主。smoke 源码改动由结构单测和后续独立发布门禁接力验证。

### 10.3 完成定义

本 plan 仅以 Maison 内部结果判定完成。以下十四项必须全部成立：

1. 唯一 active OpenSpec change 修订完成且 strict PASS；
2. base specs 的 archive projection 不再要求已删除机制；
3. `show-last-committed-framework-config.mjs` 及现行调用已删除；
4. `ensure-gitignore`、`ensureCanonicalGitignore` 与 inspection #11 已删除，且无兼容空壳；
5. canonical-gitignore host writer 已删除，通用 policy reader/matcher 已迁到 Git 中性 helper；
6. framework-init description 只含明确正向入口；
7. Maison 发布契约明确普通请求不选择、不读取、不经过 framework-init；
8. Skill 误加载只执行无名称、零 init 副作用退出；
9. route/result enum、自然语言 route 表、parser 与 Git taxonomy 已全部删除；
10. current-turn S4 契约已发布，并由 Maison 内部静态断言与 fixture 保护；
11. 所有 adapter 的 description、canonical 与显式入口物化一致；
12. package identity、release verify、Write/Edit guard、强隔离、process integrity、历史兼容和业务 Git evidence 均未回归；
13. T7 定向 suites 与 `cd harness && npm test` 全部通过；
14. plan-version、有界核查、diff 与 LF 检查全部通过。

真实客户端是否误选 Skill、模型是否在长上下文中重播历史 S4，以及用户后续 candidate/release/宿主回归结果，均不属于上述完成条件，也不阻断 T1–T7 收口。

实施期间 frontmatter 只登记 T1–T7；十四项完成条件全部成立后，七个 todo 才能全部标为 `completed`，不得用新增 todo 替代已删除的 T8。

## 11. 明确非目标

- 不重构 init planner/executor 的其它业务逻辑；只删除 committed-config 与 ensure-gitignore 特例；
- 不修改 provider、Hylyre、per-TC、goal 业务；
- 不删除与 Framework 身份无关的业务 Git diff/scope/UT mutation/run identity evidence；
- 不创建生产 NL router、route service、state machine；
- 不创建 baseline、manifest runtime state、trust DB、新 sidecar、token、nonce 或租约；
- 不弱化 pack/release verify、candidate/明确集成边界；
- 不删除 Write/Edit 守卫、强隔离、process integrity 或历史报告读取；
- 不迁移/清理真实宿主 `.gitignore`，不操作 `SimulatedWalletForHmos`，不运行真实 framework-init；
- 不运行 `candidate:build`、`release:pack`、`release:all` 或 `release:smoke-consumer`；
- 不 Git add/commit/push，不打包或发布。

本 plan 完成后的职责归属明确如下：

- 用户负责后续 candidate/release 打包；
- 用户负责把发布件安装到宿主 `framework/`；
- 用户负责真实 Codex/Claude/Cursor/OpenCode 回归；
- 用户负责收集宿主 turn、截图、run-log 与提交结果；
- 上述用户侧工作不属于 Maison coder，也不阻断本 plan 的 T1–T7 完成。

## 12. 本轮 plan-only 自检

本轮只允许并应执行：

1. `node scripts/check-plan-version.mjs`；
2. 新 plan `git diff --no-index --check`；
3. 旧撤回 plan 定向 `git diff --check`；
4. 两份 plan CR=0、以 LF 结尾；
5. 新 plan frontmatter 恰有 T1–T7 七个 `pending` todo；
6. 旧 plan 恰有一个 `cancelled` 撤回记录；
7. 两份正文均无未登记 `- [ ]`；
8. 本 plan 与旧撤回 plan 之外没有本轮新增修改。

不运行 OpenSpec、typecheck、unit/fixture/harness、framework-init、宿主命令、打包或任何 Git 写操作。
