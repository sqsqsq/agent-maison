---
name: extension — 实例扩展注入、物化与检视（实例扩展管理 project skill）
version: 3.1.0
parent_goal: complex-capability-construction-75411223
advances:
  - g8-real-host-development-and-governance
relation: knowledge-provider
layer: knowledge
goal_requires:
  - stable-3.0.0-release-baseline
goal_provides:
  - instance-extension-injection-dx
  - host-business-input-channel
real_host_validation: >
  本 plan 是宿主准入的 DX 前置能力，不宣称推进 P0–P3 核心闭环；语义验收 =
  AI 记账宿主批次中，SE 契约/业务知识/MCP action 经 /extension 注入并在
  /component-design（M7 三接缝）与 spec/plan/coding 中被真实消费（inspect 可展示证据），
  而非仅 fixture 变绿。
parallel_authority_added: false
# 版本说明：归 3.1.0 窗口；不构成 P0–P3 能力前置。2026-09-03 用户裁决：随 3.1.0 必交付、
# 不得 deferred_to 顺延（总计划 §6.7，三 provider 中最先实施）；补入 M7 使用模式（§11）。
overview: >
  实例侧 doc/extensions 协议当前存在三处「声明了不生效」的漂移（knowledge 零消费、
  provides.skills 零消费、extension skill 桥接恒按 generic 兜底物化）与一处文档虚假宣称
  （framework-init S3 从未实现 skeleton 补全）。本 plan 新增 skills/project/extension
  管理 skill（单一对话入口 + 确定性 CLI 底座），分两批交付：批次一修漂移、补全多
  adapter 物化与纯派生检视，不改任何 phase 完成语义；批次二以 OpenSpec 升级 manifest
  1.1（knowledge audience / mcp_actions / phase_bindings 三槽位），把「注入 → 指定时机
  → 全 adapter 可用 → 有证据地使用」接成完整闭环，并补入 M7 使用模式（2026-09-03，§11）：
  宿主 extension skill 获取/脱敏上游材料 → 产出 requirement-source-materialization@1 → 调用
  /component-design → 消费 blueprint publication → 必要时提交 blueprint-review-feedback。
  Maison 自身保持零插件运行时。
todos:
  - id: t1-materialize-cli
    content: >
      批次一·物化底座：extension skill 桥接以项目级 materialized_adapters[] 为目标全量
      幂等刷新（render-agents-md 加 --all-materialized-adapters，或等价确定性 CLI，D4）；
      修复 agent_adapter 外迁后恒 generic 兜底的错误物化；生成物 ownership 标记与三态
      清理纪律（标记且内容等于规范渲染→可覆盖/清理；标记但内容漂移→报告不动；无标记
      →不碰）；AGENTS.md 实例扩展段同步重渲染。
    status: completed
  - id: t2-inspect-verify
    content: >
      批次一·检视与对账：inspect 输出（机器 JSON + 人话表）从 manifest/bundle/桥接产物
      纯派生，逐项展示类型/来源/生效时机/消费者/当前状态（消费者列须能说明相关扩展
      产物将被 /component-design 或 M7 三条 seam 之一消费，§11），并如实标注「knowledge 当前
      零消费（待 t7）」；对账检查（目录 vs manifest 漂移、桥接缺失/过期/孤儿、坏引用）
      并入既有 check-extensions 通道（批次一为报告级，不阻断），不建平行检查框架。
    status: completed
  - id: t3-skeleton-drift
    content: >
      批次一·skeleton 漂移收敛：extension skeleton 的创建/修复职责归 /extension init
      承载（模板迁至 skill 附属目录或原地引用，D1）；framework-init 侧修正
      extension-skeleton README 的虚假宣称（S3 从未实现补全），改为指路 /extension；
      init 执行链零 extension 引用的现状经 D1 裁决后对齐（补任务或维持不做）。
    status: completed
  - id: t4-skill-entry
    content: >
      批次一·/extension SKILL 本体：skills/project/extension/SKILL.md + skills.index.yaml
      注册 + 内置跳板物化接线（各 adapter 获得 /extension 入口）；单一对话入口内含
      init/inspect/add/materialize/verify/adjust 意图分支，动作全部委派 t1/t2 确定性 CLI；
      首屏为「注入面 × 生效时机 × 强制力」人话速查表（含 §3「story 类接入（M7）」行）；
      add 分支引导写 manifest 六域并
      自动跑 verify；红线（不碰凭据、不装 MCP server、不代签授权）写入 SKILL。
    status: completed
  - id: t5-parent-plan-link
    content: >
      批次一·蓝图挂接：向总计划 6f2a9d8c §7 provider 表增加一行、§4 依赖图增加
      optional provider 节点（挂 M6/H1A 材料线，不进 P0–P3 主链）；本 plan frontmatter
      父目标声明作为 P0 校验器的首个非 core 真实样例留档。
    status: completed
  - id: t6-openspec-manifest-1-1
    content: >
      批次二·协议先行：OpenSpec change 定义 manifest schema 1.1——knowledge 条目对象化
      （path/summary/audience，旧纯字符串兼容）、mcp_actions（tool/required/produces/usage，
      无 server 接线字段；produces 可声明 M7 接缝文件——`requirement-source-materialization@1`
      / `blueprint-review-feedback@1`——其校验复用既有 `check:component-blueprint
      --materialization/--feedback`，manifest 不含 server/URL/token/登录配置）、phase_bindings
      （仅 before_phase_work / before_phase_verify / after_phase_verify_before_close 三槽位，
      无 post-close；**只管 Feature phases，不新增 before_component_design 槽位**——
      /component-design 的前置输入由 extension skill 自身流程承载，§11）；required/optional 缺失语义、
      produces 未生成的失败分级、1.0 兼容读取零行为变化；物化 SSOT 由目录驱动切
      manifest 驱动的切换节奏在本 change 一并锁定（D3）。
    status: completed
  - id: t7-knowledge-consumer
    content: >
      批次二·knowledge 消费接线：按 audience 路由——phase 绑定条目在对应 phase 的
      ai-prompt.md 动态渲染索引行（现读 manifest，零维护）；audience:global 条目进
      AGENTS.md 实例知识段（随 t1 刷新命令更新）；旧式纯字符串兼容为全 phase 索引行、
      不进 AGENTS.md；绑定到 /component-design 或 app-component-blueprint 的知识走既有单
      Skill `skill_assets` 路径（不新发明 audience 值，§11）；t2 inspect 的「零消费」标注随之消除。
    status: completed
  - id: t8-phase-bindings
    content: >
      批次二·phase_bindings 执行接线：三槽位按强制力诚实分级——before_phase_work 为
      文本指令注入（静态可见面方案 D2）+ produces 产物兜底校验；before_phase_verify /
      after_phase_verify_before_close 由 harness 在既有 check / receipt 门禁通道内校验
      produces（required 缺失按声明分级，进现有 CheckResult，不新增裁决入口）；
      inspect 增加三强度状态派生（available / scheduled / evidenced）。
    status: completed
  - id: t9-mcp-actions
    content: >
      批次二·mcp_actions 接线：声明+绑定+produces 产物校验（产物进既有 evidence 链；produces
      为 M7 接缝文件时由既有 check:component-blueprint 的 --materialization/--feedback 模式校验，
      不建第二套校验，§11）；
      工具可见性检查实现为 agent 侧自查步骤（SKILL 流程），inspect 报告显式标注该项
      数据来源为 agent 自报；不物化 MCP、不管理 server/凭据/IDE 配置，配置指导以人话
      话术输出（fetch_fidelity 先例同款分工：宿主执行、仓内产物、Maison 验证）。
    status: completed
  - id: t10-m7-story-pattern-handoff
    content: >
      批次二·M7 使用模式交接（2026-09-03，§11）：① 宿主适配指南
      `docs/operations/component-design-host-adaptation.md` §7 补「用 extension 承载三条
      接缝」一节：extension skill 承担获取/脱敏/落盘与 publication 投影装配，
      `mcp_actions.produces` 产出 materialization / feedback 文件；② 随包样例
      `docs/operations/samples/` 增一份最小 `manifest.yaml` 片段（skills + mcp_actions.produces
      指向 M7 接缝文件），入包路径与 M7 样例同侧，不进 fixtures；③ 仓内 fixture 链：manifest
      声明 → produces 落盘 → `check:component-blueprint --materialization` PASS，改坏
      `source_sha256` → FAIL；feedback 同理；`/extension inspect` 对该产物列出消费者
      `/component-design` 与接缝名；④ 不修改模拟钱包 Story extension，只交付 Maison 协议、
      入口、示例与交接说明。
    status: completed
isProject: false
---

# extension — 实例扩展注入、物化与检视

> 状态：待 review。本文固化 2026-08-15 三轮讨论 + codex 外部意见核实后的全部共识；2026-09-03 按用户
> 裁决修订为 3.1.0 必交付（三 provider 中最先实施）并补入 M7 使用模式（§11）。
> 讨论共识以本文为准；与讨论记录冲突处以本文明示裁决为准。

## 1. 计划定位

新同学面对 `doc/extensions/` 时的三个真实问题：

1. **不知道怎么把业务信息接进来**——skill 怎么加、什么时候生效，hooks 怎么挂、在哪生效，知识怎么注入、如何确保被使用，全无操作型指导；
2. **多 adapter 物化只能手动**——实例已物化多个 adapter 后新增 extension skill，没有"为所有 adapter 重新桥接"的入口；
3. **过程时机无表达**——想在 spec（同理 plan/coding）动笔前拉前置信息、验证后做后置动作（含 MCP），现有协议没有对应语义。

本 plan 交付一个 project skill `/extension`（实例扩展管理）+ 确定性 CLI 底座 + 一次窄协议升级，
让「用户添加扩展 → 指定生效时机 → 全 adapter 可用 → 验证确实生效」成为一条有支持的路径。

**不是什么**：不是 plugin 运行时（总纲 §11.2 明确禁止 loader/注册表/动态发现——本 plan
只操作既有静态声明协议）；不是宿主演进接缝（§11.3 属宿主代码内部，两层永不合并）；
不进 3.1.0 P0–P3 核心路径（provider 纪律见总计划 §7）。

## 2. 现状事实清单（全部经代码核实，2026-08-15）

| # | 事实 | 证据 | 后果 |
|---|------|------|------|
| F1 | `knowledgePaths` 零生产消费者——loader 只校验存在性 | [extension-loader.ts:168](../../harness/extension-loader.ts)；全仓 grep 仅 loader/types/unit test | manifest 声明 knowledge = 永不生效 |
| F2 | `provides.skills` 零生产消费者；物化走目录扫描 | [instance-skill-bridge.ts:71](../../harness/scripts/utils/instance-skill-bridge.ts) `scanExtensionSkills` 直接扫 `skills/*/SKILL.md` | 声明与物化两套路径，manifest skills 域装饰性 |
| F3 | extension 桥接恒按 generic 兜底物化 | [render-agents-md.ts:152-156](../../harness/scripts/render-agents-md.ts) 读 `config.agent_adapter ?? 'generic'`；而该字段已外迁 personal（[config-field-merger.ts:393](../../harness/scripts/utils/config-field-merger.ts)、822 禁止回填），项目 config 中不存在 | 升级后实例的 extension 桥接产物落错 adapter |
| F4 | framework-init 从未实现 skeleton 补全 | [init-task-executor.ts:408-428](../../harness/scripts/utils/init-task-executor.ts) 全局阶段仅 catalog/glossary/docs；init 执行链 grep 零 extension 引用；而 [extension-skeleton README](../../skills/project/framework-init/templates/extension-skeleton/README.md) 宣称"S3 补全" | 文档虚假宣称 |
| F5 | hooks 8 事件全接线但语义是 harness 内部事件 | [harness-runner.ts:705-754](../../harness/harness-runner.ts)；`pre_phase` 触发于跑 check 时，prompt fragment 进 ai-prompt.md 下一轮可见 | "spec 动笔前"无对应槽位；用户按字面理解必踩坑 |
| F6 | `provides.capabilities` 是 harness capability provider，与 MCP tool 语义不同 | [extension-loader.ts:228-270](../../harness/extension-loader.ts)、capability-registry | MCP 不得混入该域 |

可用现状（保持不动）：hooks `.md`（prompt fragment）/`.mjs`（stdin JSON 子进程，extension 源失败默认 MAJOR）、
phase_rules_overlays、capabilities 覆盖、skill_assets、manifest 全有或全无纪律与路径越界防护。

## 3. 目标形态（用户视角）

单一入口 `/extension`，对话式意图分支（不暴露七个子命令）：

```text
/extension            → 首屏：注入面速查表 + 当前 inspect 摘要
/extension <说人话>    → 意图路由：init | inspect | add | bind | materialize | verify | adjust
```

**注入面 × 生效时机 × 强制力速查表**（SKILL 首屏内容，同时是问题 1 的答案）：

| 注入面 | 生效时机 | 强制力 | 批次 |
|---|---|---|---|
| extension skill | 用户 `/<bridgeId>` 或 agent 按 AGENTS.md 路由 | agent 侧 | 现有+t1 修物化 |
| hooks `.md`/`.mjs` | 每次 harness run 按 8 事件；fragment 下一轮可见 | `.mjs` 失败→MAJOR CheckResult | 现有 |
| phase_rules_overlays | 该 phase 规则合并时 | harness 强制 | 现有 |
| capabilities | 能力裁决/降级 | harness 强制 | 现有 |
| skill_assets | per-skill 资产消费面 | harness 强制 | 现有 |
| knowledge（audience 路由） | phase → ai-prompt 索引；global → AGENTS.md | 文本指令 + inspect 证据 | t7 |
| phase_bindings 三槽位 | 见 §5 | 分级：文本指令 / harness 门禁 | t8 |
| mcp_actions | 绑定槽位内由 agent 调用；produces 落盘 | 产物校验（harness） | t9 |
| story 类接入（M7 三接缝） | extension skill 在 /component-design 之前产出 materialization、之后消费 publication / 产出 feedback | 接缝校验 fail-closed（check:component-blueprint --materialization/--feedback） | t10 |

**三强度模型**（inspect 状态列的语义，防"登记了=生效了"的错觉）：

1. **available** —— 内容存在、manifest 合法、桥接/工具可达；
2. **scheduled** —— 已绑定到某 phase 时机；
3. **evidenced** —— 执行产生了可验证产物或检查结果（produces 文件、输出引用、hook result）。

`trace.tool_calls` 仅作审计线索，不单独作为强完成证据。

## 4. 已裁决事项（讨论定案，review 时不再重开）

| # | 裁决 |
|---|------|
| R1 | 名字 `extension`（单数），路径 `skills/project/extension/`，与 `--phase extensions` 字面错开 |
| R2 | 只有 skill 做 adapter 物化；目标恒为项目级 `materialized_adapters[]`，禁读 personal `agent_adapter` |
| R3 | MCP 只做 action contract（tool/required/produces/usage）：不物化、不装 server、不碰凭据/登录态/IDE 配置文件；配置指导=人话话术 |
| R4 | 后置动作首版止步 `after_phase_verify_before_close`；不做权威性 post-close（闭环后失败无法诚实撤销完成事实） |
| R5 | knowledge 带 `audience` 作用域；仅显式 `global` 进 AGENTS.md；phase 绑定走该 phase ai-prompt 动态索引；绑定单个 skill 的知识路由到既有 `skill_assets`，不新发明 |
| R6 | 两批实施；批次二协议升级先立 OpenSpec change 再动发布内容 |
| R7 | 版本 3.1.0 窗口、独立 plan、`parent_goal` 挂总纲 `advances: g8`、不进 P0–P3 门禁；总计划挂接=§7 表 + §4 图（2026-09-03 起由"optional provider"改为 3.1.0 release 前置：M7 → d8 → m5，总计划 §6.7；t5 所写的挂接口径由此覆盖） |
| R8 | 用户入口收敛为一个对话式 `/extension`；确定性动作全部下沉 CLI（framework-init 的 SKILL+orchestrate 同款分层） |
| R9 | 桥接产物是派生物；`doc/extensions/manifest.yaml` 与 skill 源文件是 SSOT；生成物带 ownership 标记，清理三态纪律（见 t1） |
| R10 | 检视/对账并入既有 check-extensions 通道与现有 CheckResult 投影，不建平行检查框架、不落新台账文件 |

## 5. phase_bindings 三槽位（批次二核心语义）

不复用 `pre_phase/post_phase`（它们是 harness 内部事件，F5）；新增窄槽位表达 **agent 工作生命周期**：

```yaml
phase_bindings:
  spec:
    before_phase_work:                 # 动笔（进入研究/产出）之前
      - kind: knowledge
        ref: customer-domain
      - kind: mcp
        ref: fetch-customer-context
    before_phase_verify:               # 产物已生成、跑 harness/verifier 之前
      - kind: skill
        ref: normalize-business-spec
    after_phase_verify_before_close:   # 验证通过后、写完成回执之前
      - kind: mcp
        ref: publish-spec
```

**强制力诚实分级**（写进协议与 SKILL，不许含糊）：

| 槽位 | 执行体 | 机器强制手段 |
|---|---|---|
| before_phase_work | agent（文本指令，harness 不在动笔前运行） | 无法强制执行本身；靠 produces 产物兜底校验（check 时查，required 缺失按分级 FAIL） |
| before_phase_verify | agent | harness check 入口校验 produces |
| after_phase_verify_before_close | agent | 既有 receipt 门禁通道校验 produces |

失败语义：`required: true` 的绑定项 produces 缺失 → 既有 CheckResult 通道 FAIL（severity 遵从
lifecycle-hooks 先例：extension 源默认 MAJOR，协议允许声明升 BLOCKER）；optional 缺失 → 降级记录进
报告，不得静默按存在处理。现有 hooks 8 事件继续服务 check/verifier 周边，两套生命周期不混。

**不新增 `before_component_design` 槽位**（2026-09-03，§11）：三槽位只管 Feature phases。
/component-design 属设计阶段而非 Feature phase，其前置输入由宿主 extension skill 自身流程产出
（用户显式 `/<bridgeId>` 或按 AGENTS.md 路由触发），不进入 phase_bindings。

## 6. mcp_actions（批次二）

```yaml
provides:
  mcp_actions:
    fetch-customer-context:
      tool: customer.fetch_context     # 宿主 IDE 已配置的 MCP tool id
      required: true
      produces:
        - doc/context/customer-context.json
      usage: spec 动笔前拉取客户上下文；产物供 spec 引用
```

分工沿 [fetch_fidelity 先例](../../docs/operations/fidelity-fetch-mcp-contract.md)：**宿主执行、仓内产物、
Maison 验证**。manifest 无 server 接线字段（command/url 一律不进协议）；server 配置、token、登录态归宿主，
`/extension` 只输出配置指导话术。工具可见性 = agent 侧自查步骤，inspect 对该项标注"agent 自报"。
produces 落盘文件进既有 evidence 链（复用现有登记机制，不新建证据类型）。

M7 接缝产物同样只是 produces 文件：例如 `produces: [doc/requirements/<name>.materialization.json]`
（artifact 固定 `requirement-source-materialization@1`）或 `doc/reviews/<name>.feedback.json`
（`blueprint-review-feedback@1`），由既有 `check:component-blueprint --materialization/--feedback`
校验；manifest 不承载 server、URL、token 或登录配置（§11）。

## 7. 批次边界与验收

### 批次一（t1–t5）：修漂移，不改 phase 完成语义

- t1 物化：多 adapter 幂等刷新、F3 修复、ownership 三态、AGENTS.md 扩展段同步；
- t2 检视：inspect 纯派生 + 对账进 check-extensions（报告级）；F1/F2 如实展示；
- t3 skeleton：D1 裁决后归位，文档止虚假宣称；
- t4 SKILL 本体与注册；t5 总计划挂接。

验收：unit（物化幂等/三态清理/对账/F3 回归——fixture 断言桥接产物落全部 materialized_adapters）、
`cd harness && npm test` 全绿、`npm run openspec:validate` 不涉及、手动 dogfood（fixture 实例工程演练
add→materialize→inspect 全链）。批次一不触碰 harness-runner 阶段判定路径。

### 批次二（t6–t10）：OpenSpec 先行的窄协议升级

- t6 change 锁协议与失败语义（含 D3 SSOT 切换节奏）；t7 knowledge 双消费面；t8 三槽位+三强度；t9 mcp_actions；t10 M7 使用模式交接（§11）。

验收：OpenSpec strict validate；audience 路由 unit（phase 过滤/global/1.0 兼容零行为变化）；三槽位正反
fixture（required/optional × produces 有无 → 分级正确；after_phase_verify_before_close 失败可挡回执）；
mcp produces 进 evidence 的正反例；M7 接缝产物链正反例与 inspect 消费者说明（t10③）；inspect 三强度派生正确。真实宿主证据按 frontmatter
`real_host_validation` 口径，随 AI 记账批次自然发生，不人为造场景。

## 8. 与蓝图/既有机制的边界（红线）

1. **零插件运行时**：不建 loader/注册表/插件包分发/动态发现/运行时插件状态（总纲 §11.2）；本 plan 全部为静态声明 + 确定性 CLI；
2. **不建第二台账**：inspect/verify 纯派生自 manifest/bundle/产物/既有 CheckResult，不落新状态文件；
3. **不碰完成事实**：extension 任何内容不得直接修改 Goal Mode events/receipt/evidence；t8 校验走既有门禁通道，不新增裁决入口；
4. **三命名空间不混**：extension 声明依赖不与 Change Unit `requires/provides`、`goal_requires/goal_provides` 合并成图；
5. **不是宿主演进接缝**：§11.3 属宿主代码内部架构，本机制是 Maison 输入通道，两层永不合并；
6. **兼容**：manifest 1.0 实例零行为变化；无 manifest/无目录依旧空 bundle 零副作用；
7. **不修改宿主 story extension**：M7 使用模式只交付 Maison 侧协议、入口、示例与交接说明；接缝校验复用 check:component-blueprint，不建第二套校验、不新增生命周期槽位（§11）。

## 9. 风险与控制

| 风险 | 控制 |
|---|---|
| 批次二协议膨胀（槽位/域越加越多） | 只做三槽位 + 两新域；新增槽位/域须真实宿主反例立项 |
| AGENTS.md 被扩展内容污染 | 仅 audience:global 与 phase 绑定提示行（D2 裁决）可进；其余一律动态 ai-prompt |
| 物化清理误删人工产物 | 三态纪律：无标记不碰、有标记内容漂移只报告；删除动作列清单过用户 |
| 对账与 check-extensions 形成双检查 | R10：对账逻辑并入 check-extensions 本体，inspect 只做展示派生 |
| bindings 校验与 b8 完整性域拉锯 | 校验只进现有 CheckResult/receipt 通道；不改 receipt schema、不新增授权面 |
| "绑定了=执行了"错觉 | 三强度模型 + 槽位强制力表写进 SKILL 首屏与 inspect 输出 |

## 10. 留给 review 的裁决点

| # | 裁决点 | 我的推荐 |
|---|---|---|
| D1 | skeleton 补全归属：a) framework-init 补 init 任务；b) 归 /extension init，framework-init 文档改口指路 | **b**——单一职责，init 不再加重；模板随 skill 走 |
| D2 | before_phase_work 的静态可见面：是否在 AGENTS.md 阶段路由段渲染绑定提示行（每 phase 至多数行） | **是**——AGENTS.md 本就描述各阶段怎么走，且这是"动笔前可见"唯一可靠静态面；量控在提示行级 |
| D3 | 物化 SSOT 切换节奏：批次一目录驱动+漂移报告，批次二切 manifest 驱动（未声明不物化） | 按此节奏——兼容不破现状，切换随 t6 协议一并生效 |
| D4 | 物化 CLI 形态：render-agents-md 加 `--all-materialized-adapters` vs 独立新 CLI | **加 flag 复用**——AGENTS.md 渲染与桥接本就同源；entry 参数自 adapter.yaml 派生 |

## 11. 与 M7 三条接缝的接线（2026-09-03 修订）

> 用户裁决（2026-09-03）：本 plan 随 3.1.0 必交付、不顺延，三 provider 中最先实施；补入
> M7 使用模式。**运行时输入 optional ≠ 版本交付 optional**——某个工程没有 extension 是合法的
> "未启用"，不是本 plan 可以不交付的理由。

**为什么**：M7 让上游材料、评审投影与反馈有了三条方向独立的接缝，但 Maison 侧还缺一条"宿主
怎样用既有 extension 机制把材料真正送进来、再把投影拿出去"的路径。本 plan 就是这条真实输入
通道；没有它，上游材料、业务知识和扩展能力进不了蓝图。

**使用模式**：

```text
宿主 extension skill（provides.skills）
  → 获取/脱敏上游材料并落到项目内
  → mcp_actions.produces 产出 requirement-source-materialization@1 文件
  → 调用 /component-design（校验：check:component-blueprint --materialization）
  → 消费 blueprint publication 投影（component-blueprint.review.md）装配 Story Document
  → 必要时 mcp_actions.produces 产出 blueprint-review-feedback@1 文件（--feedback 校验）
```

**最小原则**：

- 复用现有 extension skill、`provides.skills`、`skill_assets`、`knowledge` 与
  `mcp_actions.produces`（t6 定义的 1.1 协议域）；不新增 `before_component_design` 生命周期
  槽位——`phase_bindings` 三槽位仍只管 Feature phases；/component-design 属设计阶段，前置
  动作由 extension skill 自身流程承载；
- 绑定到 /component-design 或 app-component-blueprint 的知识复用既有单 Skill `skill_assets` /
  extension skill 路径，不新发明 audience 值；
- `mcp_actions` 可以产出 M7 materialization / feedback 文件，但 manifest 不得包含 server、URL、
  token 或登录配置（R3）；接缝校验复用既有 `check:component-blueprint`，不建第二套校验；
- `/extension inspect` 应能说明相关扩展产物将被 /component-design 或三条 M7 seam 消费
  （消费者列，t2）；
- 不修改模拟钱包 Story extension；只交付 Maison 协议、入口、示例（随包 manifest 片段样例）
  与交接说明（宿主适配指南 §7 补 extension 承载方式）——t10。

**验收**：manifest 声明 → produces 落盘 → 接缝校验 PASS/FAIL 正反例 + inspect 消费者说明
（t10③）；只证明 manifest 合法不算通过。

**新增 schema / 状态 / phase / registry / 平行真源**：没有（manifest 1.1 是 t6 既定的协议升级，
本节不再加域、不加槽位）。

## 12. 实施记录（2026-09-03）

### 12.1 完成内容

1. t1：`render-agents-md --all-materialized-adapters` 只读项目级 `materialized_adapters[]`；扩展 bridge 全 adapter 幂等刷新，带 ownership 标记并落实“规范件可覆盖/清理、漂移件报告不动、无标记不接管”三态；AGENTS/CLAUDE 扩展段同步渲染。
2. t2：新增 `/extension inspect` 的 JSON 与人话表；类型/来源/时机/消费者/available|scheduled|evidenced/状态均从 manifest、bundle、桥接与产物派生；目录/manifest 与 bridge 漂移进入既有 `check-extensions` 的 MINOR 报告级 CheckResult。
3. t3：skeleton 真源迁至 `skills/project/extension/templates/extension-skeleton/`；framework-init 旧目录只留 `/extension init` 指路，init 执行链继续零 extension 任务。
4. t4：新增 `/extension` Skill 的 init/inspect/add/bind/materialize/verify/adjust 意图路由、首屏速查与安全红线；skills index、Cursor/Claude/CodeAgent command 模板及共享 skills-bridge 完成接线，覆盖六个非 generic adapter。
5. t6：建立 OpenSpec change `extension-manifest-1-1`；manifest 1.1 支持 knowledge `{path,summary,audience}`、`mcp_actions` 与三个 Feature phase binding 槽位，拒绝连接/凭据字段；1.0、无 manifest、无目录保持兼容。
6. t7：global knowledge 进入 AGENTS/CLAUDE；phase audience 与 1.1 legacy 字符串按规则进入对应 ai-prompt 动态索引；before-work 绑定在 AGENTS 每 phase 至多一行提示。
7. t8：before-work/before-verify produces 进入既有 harness CheckResult；after-verify-before-close 进入既有 check-receipt；required 按 MAJOR/BLOCKER 失败，optional 缺失 SKIP 降级；未改 receipt schema 或完成事实。
8. t9：MCP 仅声明宿主执行与仓内 produces；工具可见性仅当前 agent 自报并标 `agent_self_report`；普通产物与 M7 产物均进既有 CheckResult/evidence 链。
9. t10：materialization/feedback 复用 `check-component-blueprint` 的正式实现；宿主适配 §7.1、随包 `extension-m7-manifest.yaml`、正反 fixture 链与 inspect 消费者说明均落地；未修改任何宿主 Story extension。

### 12.2 改动文件

- 协议/运行时：`specs/instance-extension-manifest.schema.yaml`；`harness/extension-loader.ts`、`harness/harness-runner.ts`、`harness/scripts/{extension,check-extensions,check-receipt,render-agents-md}.ts`、`harness/scripts/utils/{extension-inspect,extension-runtime,instance-skill-bridge,report-generator,template-renderer,types}.ts`。
- Skill/adapter：`skills/project/extension/**`、`skills/skills.index.yaml`、`skills/README.md`、`skills/project/framework-init/prompts/workflow-selection.md`、`skills/project/framework-init/templates/extension-skeleton/**`（旧模板迁出，只留 README 指路）、`templates/AGENTS.md.template`、`agents/{README,adapter-schema}.yaml|md`、`agents/{claude,cursor,codeagent}/templates/commands/extension.md`、`agents/shared/agent-bundle/templates/skills-bridge/extension/SKILL.md`、`agents/{claude,cursor,generic}/adapter.yaml`。
- 文档：`README.md`、`MIGRATION.md`、`docs/{DOC_INVENTORY.yaml,overview.md}`、`docs/concepts/extensibility.md`、`docs/evolution/{extension-protocol-v1,extension-e2e-acceptance}.md`、`docs/operations/{harness-runbook,component-design-host-adaptation}.md`、`docs/operations/samples/extension-m7-manifest.yaml`、`MAINTAINER-CHANGELOG.md`。
- 测试：`harness/tests/run-unit.ts`、`harness/tests/unit/{adapter-bridge,extension-loader,extension-management,extension-runtime,hooks-dispatcher,resolve-skill-path,codeagent-adapter}.unit.test.ts`。
- OpenSpec：`openspec/changes/extension-manifest-1-1/{.openspec.yaml,proposal.md,design.md,tasks.md,specs/instance-extension-management/spec.md}`；本 plan 仅更新 todo status 并追加本节。

### 12.3 验证结果

- `cd harness && npm test`：exit 0；typecheck PASS；unit **4106 passed / 0 failed**；fixtures **46 passed / 0 failed**。
- extension/M7/adapter/docs 目标复核：**79 passed / 0 failed**，exit 0。
- `npm run openspec:validate`：**35 passed / 0 failed**，exit 0；canonical Enforcement 路径检查 PASS。
- `node scripts/check-plan-version.mjs`：default mode PASS，exit 0。
- `npm run release:check-plans`：exit 1，精确剩余 **3 项**（总计划、e4、b9 未完成）；d8 已不在失败清单，符合总调度后续顺序。
- `git diff --check`：exit 0。
- EOL：37 个已跟踪改动文件均 `i/lf w/lf`；20 个新增文件扫描 `CR=0`。未触碰 `harness/tests/fixtures/component-blueprint/release-semantics.json`、e4/b9 plan、三个既有未归档 change 的 6.6/7.5 条目或任何宿主工程。

### 12.4 变异自证

1. 临时摘掉 `/extension materialize` 向 bridge 传递 1.1 `declaredSkillIds`：`extension-management` 精确在“1.1 must be manifest-driven”变红，exit 1；原样恢复后 4 passed / 0 failed，exit 0。
2. 临时旁路 `requirement-source-materialization@1` 的既有 validator：M7 hash 反例不再产生 `materialization_source_hash_mismatch`，`extension-runtime` 精确变红，exit 1；原样恢复后 4 passed / 0 failed，exit 0。

### 12.5 与 plan 的偏离

无。adapter 接线按仓内真实拓扑落为 3 份 command 模板（Cursor/Claude/CodeAgent）+ 共享 skills-bridge（Codex/Chrys/OpenCode，并由 Cursor/generic 复用），覆盖全部 adapter；未给 `commands: null` 的 adapter 造无效目录。

### 12.6 待裁决问题

无。

### 12.7 未做 / 留账

- 未人为制造真实宿主事件；frontmatter `real_host_validation` 所述 AI 记账宿主消费证据按总计划随真实批次自然发生。
- 未归档 `extension-manifest-1-1` OpenSpec change，留给总调度 review 后统一归档。
- 未 commit；按任务书停在工作区，等待用户明确提交授权。

### 12.8 Review 返修记录（2026-09-03）

1. **非法 manifest fail-closed**：新增 `extensionSkillIdsForBridge` 三态判定；无 manifest/合法 1.0 才目录驱动，合法 1.1 严格按 `provides.skills[]`，任何非法 manifest 选择零 Skill。`render-agents-md` 写入口文件前先校验；普通 Feature harness 与 check-receipt 通过 `checkExtensionManifest` 把同一 loader 诊断投影为 BLOCKER。组合反例“非法 1.1 + rogue 目录 Skill + required binding”同时证明零注入与 Feature BLOCKER。
2. **extension_dir 越界写闭合**：loader、`/extension init`、materialize 与 bridge 扫描统一复用 `validateProjectRelativePath`；`../outside`、`/absolute`、`C:/outside` 均拒绝，合法 `my/extensions` 通过，越界目标零写入。
3. **active workflow phase 真值**：knowledge audience 与 phase_bindings 改从 active workflow 解析 Feature scope，按 full/lite 并集校验；`specc`、`component-design`、`catalog` 与自定义 global phase 均失败，自定义 Feature phase及默认 full/lite phases 通过；workflow 无法解析 fail-closed。`formatExtensionPhasePrompt` 对 global phase 返回空串。
4. **旧 bridge 自动接管**：无 ownership 标记但逐字节等于旧版规范渲染的文件，inspect 记 `stale`，首次 materialize 补标记并计入 `filesWritten`；其它无标记用户文件继续 `untouched`。`MIGRATION.md` 已补迁移说明。
5. **M7 诚实性**：删除 `usage.includes(...)` 类型猜测；`usage` 永远只供人读。只有产物实际 `artifact` 被识别且既有 validator 通过，inspect 才显示 `/component-design` seam consumer/evidenced。`usage` 写 M7 但内容为 `{}` 时只按普通 produces，通过显式 `--materialization` 仍命中原 validator FAIL。随包 `extension-m7-manifest.yaml` 已在临时工程配 stub Skill 与真实正例产物通过 loader，并由 inspect 派生两条 seam consumer。
6. **接线级真 spawn**：在 `check-receipt-policy` 真实子进程夹具加入 after-close required produces 缺失，issue id 含 `extension_produces_`；在 `e2e-spec-requirement-closure` 临时 consumer 真 spawn `harness-runner.ts --phase spec`，before-verify required produces 缺失进入 script-report CheckResult FAIL。非法 manifest 的 runner/receipt 真 spawn 也分别命中 `extension_manifest_manifest_unknown_field_*` BLOCKER。
7. **文档与收口**：`workflow-selection.md` 与 `agents-entry-detail.md` 的旧 S3 skeleton 权威说法已清零，统一指向 `/extension init`；`MAINTAINER-CHANGELOG.md` 已恢复为 HEAD 字节，留给 m5 的 `release:changelog`。首轮为满足 `entry_template_budget` 删除的 `AGENTS.md.template`“Framework 使用说明”快速索引行在此补记；Skill 索引仍保留，功能入口未丢失。
8. **验收边界冲突处置**：未改 plan 前文 `real_host_validation`（任务书与 review 均规定 plan 前文不可改）。改在现有 OpenSpec proposal/spec/design 明确：d8 完成标准是 Maison 仓内协议、入口、发布件文档、样例及正反契约链；真实宿主采用与总计划 H1A 回灌发布后自然发生，不阻塞 d8 或 3.1.0 Maison 发布。

**返修验证**：

- `cd harness && npm test`：exit 0；typecheck PASS；unit **4119 passed / 0 failed**；fixtures **46 passed / 0 failed**。
- 目标复核：extension 核心 **37/37**、check-receipt 真 spawn **11/11**、harness-runner 临时 consumer 真 spawn **6/6**，合计 **54/54**。
- 接线变异自证：摘掉 check-receipt after-close 接线后，新增用例由 expected failed 变为 got passed，suite exit 1；恢复后 11/11。摘掉 harness-runner before-verify 接线后，新增用例观察到 harness 放行并单点变红，suite exit 1；恢复后 6/6。
- `npm run openspec:validate`：**35 passed / 0 failed**，exit 0；OpenSpec `extension-manifest-1-1` 9/9 completed。
- `node scripts/check-plan-version.mjs`：PASS，exit 0；`git diff --check`：PASS，exit 0。
- `npm run release:check-plans`：exit 1，仍仅总计划、e4、b9 三项，d8 不在失败清单。
- EOL：39 个已跟踪改动文件全部 `i/lf w/lf`；20 个新增文件 `CR=0`。
- 未新增 registry、状态、phase、生命周期槽位或产物类型；未修改 package version、宿主工程、e4/b9 plan、M7 模拟钱包 extension 或禁止触碰的 release-semantics fixture；未 commit。

### 12.9 Review 二次返修记录（2026-09-03）

最新 review 撤回上一轮“旧 bridge 自动接管”要求，本轮按冻结红线做纯减法：删除 `withoutOwnership()`、safeWrite 自动补 ownership 分支及 inspect 的旧规范字节 `stale` 特判。现在任何无 ownership 文件一律由 inspect 标为 `unowned`，materialize 一律计入 `untouchedFiles` 并保持原字节；它不会进入未来 orphan cleanup。未新增 `--adopt` 或其它迁移入口。

同步删除 MIGRATION、`/extension` Skill、extension-e2e 文档与 OpenSpec 中的自动接管例外；OpenSpec design 明确“任何无 ownership 文件都不接管、不清理”。§12.8 第 4 条是上一轮已执行但现被撤回的历史记录，以本节为最终结论，遵守实施记录只追加、不改前文的纪律。

原“自动接管正例”已替换为反向回归：构造一个无标记且逐字节等于旧版规范渲染的 bridge，断言 inspect=`unowned`、materialize=`untouched`、`filesWritten` 不含该路径且文件字节不变。`adapter-bridge` **8/8 PASS**。

**最终验证**：`cd harness && npm test` exit 0，typecheck PASS、unit **4119 passed / 0 failed**、fixtures **46 passed / 0 failed**；`npm run openspec:validate` **35/35 PASS**；默认 plan gate 与 `git diff --check` PASS；39 个已跟踪改动文件均 `i/lf w/lf`，20 个新增文件 `CR=0`；`MAINTAINER-CHANGELOG.md` 与 HEAD 无 diff。release plan gate 仍仅剩总计划、e4、b9 三项。未 commit，未归档 OpenSpec。
