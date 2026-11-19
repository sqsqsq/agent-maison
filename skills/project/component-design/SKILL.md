---

name: component-design
description: Create or continue component design using the unified request envelope. Small requests use a compact form of the same blueprint without a CU, independent questioning or review document; medium/complex handoff retains admitted design and CU readiness. Complete only the requested work; never enter the P2 selector, Goal Mode or P3 closure.
---

# Component design（创建或继续部件设计）

> **用户确认 UX**：[user-confirmation-ux.md](../../reference/user-confirmation-ux.md) · `design.formality_routing` / `spec.terminology`（术语事实确认） **P3 设计输入与职责边界**：见 [蓝图设计输入](../../../docs/concepts/blueprint-design-inputs.md)，只完成请求指定的设计工作，不自动进入施工。
> —— 统一前门先复用已有依据；只有未解决且影响正确设计/交付的语义缺口才沿适用确认点处理，不为分类格式停等；
> 其余步骤沿用被调用 Skill 各自的确认点。

**需要部件设计的请求统一经过这里，外框先按统一前门确定。** 组织侧把这个活动称为 **Story Design**；Maison 侧唯一 canonical 设计产物是**部件演进蓝图**（Component Evolution Blueprint）。

本 Skill 只编排 P1 蓝图内部工作流与 P2 设计准备段，自身不直接写 canonical CU、不启动 Goal Mode。

拆分或修订 CU 时，作者须明确选择 `design_refs`，并包含所有 touches 目标。整批活动 CU 必须认领与组装同源的必需设计义务：变更视图里的变更节点与 runtime flow、每条关系和契约、仍需交付的决定，以及每条当前需求的蓝图承载。每项至少一个责任 CU；不要求每个单元重复认领，跨 CU 的关系通常由消费方承担本侧证据。接受、修订和 readiness 会列出未认领的地址，作者据此修正候选，不能等到组装时才处理。

未变且仅供理解的依赖、消费者、相邻场景不列为本单元交付选择；但它们若已声明变更或承载当前需求，须由适当 CU 显式认领。依赖闭包仍由机器按需解析校验，不回写引用或分配负责人，也不按验收编号裁剪已选内容。已有 CU 的归属错误通过原内容修订入口处理，不能静默删引用或手改 canonical。

## 触发条件

- “新需求 / 要改这个功能 / 这个 Story 怎么做 / 建部件设计 / Story Design / 继续设计 / 查看或质询蓝图 / 调和蓝图”
- `/component-design <blueprint-id>`
- `/spec` 按统一前门核出具体设计缺口并指回本入口时

## 先读请求与已有产物

设计用户入口统一为 `/component-design`。按 `blueprint_id` 和配置的 `paths.features_dir` 读取同一演进工作区的 canonical 蓝图、已有 CU 及其引用；复用既有 resolver，不另建登记或模式字段。先明确用户本次需要的结果，再从尚未完成的步骤继续：

- 新建需要设计的需求：先消费下方统一前门；小型完成同协议短设计到本请求终点，中型/复杂才走完整蓝图、首次 CU 分解与 readiness。
- 已有草稿未 admitted：继续尚未完成的发现、设计与独立质询；用户只要求局部操作时到此结束。
- 查看、解释、检查或评审：读取当前设计，复用 P1 质询与既有 publication/feedback 接缝。
  **只读请求不修改 canonical 设计**，发现问题先报告；不得因已有蓝图就自动执行调和。
- 仅补写评审说明：读取 canonical 蓝图/CU 与已登记设计材料，按 [P1 写作指引](../../reference/app-component-blueprint-workflow.md#按评审问题写说明) 直接使用已可读的原字段，仅改表达时优先写可选 reader_guide；修改原字段属于设计修订，会使说明摘要过期，也可能改变整蓝图引用的 CU 摘要。复核后计算摘要，在 `framework/harness` 运行 `npm run check:change-unit -- --project-root <宿主根> --blueprint <blueprint-id> --readiness --json` 完成既有指针调和与文档物化，非 busy 后实际读成品，不重做产品源码发现或启动施工。发现新事实先回原设计承载，不能只写 guide。
- 仅重入、查看或重跑 checker **不增加 revision**。新事实、被接受的权威裁决或冲突解决才按
  P1 调和规则形成正式修订；意见、建议与未接受反馈不自动升 revision。下游由各自权责重新派生。
- 用户要求完成设计交接且蓝图已 admitted：0 CU 从第 3 步首次分解；已有 CU 复用并在第 4 步
  派生 readiness，**不重复创建 CU**。仅指针漂移由框架原位升版；同一未完成活动 CU 无运行或已停住时经 consumer 同 ID 内容修订，running 返回 busy；完成后新增工作或拆分/合并/迁移才新建 ID。

已有设计的局部请求不重走新需求判定或来源物化；涉及新独立请求时仍消费统一前门事实与真实来源。
局部操作不强制跑完分解和交接，不选择 CU、不启动 Goal Mode/P3。

## 先消费统一前门（第 0 步）

完整规则与判例只在 [project-entry.md](../../../docs/operations/project-entry.md)。所有产品修改先核原始请求、已有预期/设计及实际源码，在首次选路、设计写入或产品写入前，按前门例句把带路径来源的七项事实发在正常可见助手文本，再进入本档准备/准入；中型/复杂的新完整交付先取得 admitted 设计与真实 CU 准入，历史实现和七项说明不代替施工范围。不以“正式需求”标签或 Agent 手填档位决定外框；未知只补影响本次决定的事实，只有真实语义缺口才沿原确认点求解，不把分类本身变成用户停点。

用户明确升/降档、豁免或验证限制优先，须核真实 user 原文与请求关联；保留真实失败、授权及硬预算。无用户固定选择仅凭新依据双向调整，不能改说法或删除 FAIL 降档。特别简单无新增设计文件/CU，转直接 compile/架构及适用 request 能力，本 Skill 不强建蓝图。**小型只写改动点、可检验验收、已知文件及必要局部选择，保留原身份/来源；不建 CU、不派独立设计质询、不产独立评审文件。** 首次授权设计准备与同一 check/request 的核源、inline 稳定原文底稿、只读不落盘边界见 [蓝图设计输入](../../../docs/concepts/blueprint-design-inputs.md#小型请求的首次准备与消费)；首次已有 check 用 `--session-ref` 准备真实 component-design request，只有授权机器来源写入才加 `--prepare-source`，后续 `--request-file` 默认只读重验；短结构通过不冒充完整 admitted。

本节取代 M7“每项正式需求一律完整交接/不设档位”的现行适用范围，M7 历史裁决和已完成产物不改写。只使用同一蓝图协议，不恢复 lite 或新增可手填档位状态。

## 支持范围（诚实声明）

当前**只有 `hmos-app` / App component profile 具备 design lens**。为其它 component type
（Service、Library 等）建蓝图时**明确返回 unsupported / missing design lens 失败**并说明缺什么，
不得强行送入 App 4+1 后宣称已支持；lens 建设由各自 profile 的独立变更承担。

## 完整路径（中型/复杂及已有 CU；小型按第 0 步到请求设计终点）

### 1. 需求源物化（seam：requirement-source-materialization，宿主 → Maison）

宿主负责获取、脱敏并把来源材料落到**项目内**；Maison 只消费项目内可解析的 `source_ref`、
原始字节 `source_sha256`、`provenance` 与 `authority`。Maison 不知道内网标识、token、URL 或
归档 API。

```bash
cd framework/harness
npm run check:component-blueprint -- --project-root <宿主根> --blueprint <blueprint-id> \
  --materialization <物化输入.json>
```

- 契约 schema：`framework/harness/schemas/requirement-source-materialization.schema.json`
- **单一判据**：每项进入蓝图的当前需求最终必须形成**至少一个合法 `currentScopeItem`**。达成方式两条，
  都合法、产出同一形状：
  - 来源来自**宿主 / 外部 provider** → 走上面的 `requirement-source-materialization@1` 文件接缝；
  - **直接人工 / inline / 本地文件**输入 → 由蓝图 builder 直接规范化为同一 `currentScopeItem`，
    **不强制额外制造一份 provider manifest**（小正式需求不必为此多产一个 JSON）；
- 两条路径都**不得无来源、凭模型转述**生成 scope item：项目内可解析 `source_ref` + 原始字节
  hash + provenance + authority 一个都不能少；缺来源 → 结构化 blocker（带 owner 与解除条件）；
- 来源 hash 冲突（声明值 ≠ 项目内实际原始字节，或同一 `item_id` 两份不同字节）→ **fail-closed**，
  同时报告双方，禁止 last-write-wins；
- 宿主适配细则与最小示例见
  [宿主适配指南](../../../docs/operations/component-design-host-adaptation.md)。

### 2. 蓝图发现 / 设计 / 质询 / 调和 → admitted

先读项目根 AGENTS.md（Claude 为 CLAUDE.md）的「component-design 设计前知识」，按配置路径打开 catalog、glossary、architecture 及相关模块 CodeGraph；无图回源码。由需求原文 term/alias 发现的候选须带易混项、反例和关联画像，字面命中不代替消歧，无命中继续探索完整索引。大文件按原路径分批读，未读完如实说明。

**可选设计知识**：先查当前 `paths.extension_dir` 下 manifest 的 `provides.skill_assets.component-design.knowledge`；存在则按扩展根相对路径安全解析并打开（沿 extension loader 的 safeResolve，禁止逃出扩展根）。未声明才查当前 profile `skills/skill-assets.yaml` 的 `assets.component-design.knowledge`，按 [asset 协议](../../README.md#profile-skill-asset-protocol) 解析。两处均未声明＝合法无此资产，如实说明；已声明不可读须披露，不静默回退。直接调用本 Skill 也执行此步骤，不能只依赖先前物化的 AGENTS 导航。原生知识、此文件及其引用原文仍走既有事实/权威链，不另存契约副本。

调用 [P1 蓝图内部工作流](../../reference/app-component-blueprint-workflow.md) 的既有流程，含组件资产读取、live 检索、decision 与 optional provider 可用性裁决；CU design_refs 引用选型，Feature 仅投影。术语确认（`spec.terminology`，写 `term:` 事实）与架构影响决策（`architecture_impact`，一条一项）在此裁决一次，spec/plan 只投影；changed development 节点须填获准模块 `module`。
current-facts-discovery 前解析 `paths.conventions`（缺失用框架默认值）；文件存在时完整读取，只将适用条目交给既有 fact/provenance/decision 链。`conventions-knowledge` 未启用记 `available=false + not_applicable`，显式配置却不可读记 `unknown|degraded`，不得声称已消费。

编写、质询或修订时按 [P1 工作流 §2](../../reference/app-component-blueprint-workflow.md#2-写入同一蓝图) 完成 4+1、七问与设计期 acceptance/contracts/use_cases，保留术语、存储、失败/中断、幂等与质量结论；在现有 ordered_steps 写清完整调用/返回，同次生成 generated_graphs 时序图。原设计 agent 完成可渲染草稿、图、说明与摘要后，先 `check:component-blueprint --write-review --json`，再派既有独立质询先读首屏/正文答八问、后核原 scope 与来源及图文一致；正文止于“技术与追溯参考”入口，八问作答前不读同文档参考区，之后再核参考/YAML；不提前读 YAML 或继承父上下文 YAML/设计摘要，作者一轮修订后重渲，派生身份同步刷新，详见 P1 §4/§5。App lens/质询用中文（代码/API 名可保留），原设计作者同次在已有临时交回明确施工映射候选，CU 接受后原 writer 填真实身份并在授权写界发布唯一 contracts.change_unit；只有真实未决项交 plan，不为转录新增模型调用；缺图或坏图不加 readiness 门，坏时序仅 WARN 并原位说明。完整路径的深度及条件式义务按实际影响展开，外框消费统一前门，保持同一蓝图协议；未触发义务按合法空集/不适用表达，不按行数压缩设计或凑空章节。

作者从原始需求提取用户可观察结果；需求指定某个对象时，验收须区分本次对象正确与对象错误却看似成功，并连起产生、交接及消费依据，不在路由/日志暴露敏感完整值。失败返回按原文与既有路由说明本轮边界，原图沿来源交到施工/视觉验收。独立方对照原文用反例核对当前义务、观察通道和产品设计是否自洽，核上下游取得同一本次对象。测试入口、数据前置与断言强度沿既有 CU 和独立验收落实。修订只复核机器按设计变化、来源依赖及仍未关闭的阻断和未决项列出的范围，交回实际评过的条目；机器沿独立原件复用未变项，具体新证据可重开旧结论。checker 由原 owner 执行，评审读 UTF-8 结果与必要证据，不重复运行、转码或写临时结果；格式缺口局部返修，保留其它有效结论及真实否定。

### 3. 中型分解为 1 个、复杂分解为多个 canonical Change Unit（经 P2 设计准备子流程）

仅在用户要求完成设计交接且尚无 canonical CU 时进行首次分解；已有 CU 直接复用并转第 4 步。
**本 Skill 自身不写 canonical CU。** 仅调用 [P2 设计准备段](../change-unit-progression/SKILL.md)，不执行该 Skill 的施工流程。设计作者写 JSON 数组 `[{providerId, artifact}]` 到既有蓝图目录的 `<features_dir>/<blueprint_id>/blueprint/change-unit-candidates.json`（`<features_dir>` 从 `paths.features_dir` 解析）；蓝图工作区根不放临时件，材料归属见[边界细则](../../reference/consumer-framework-boundary.md#材料归属与临时文件清理)。然后在 `framework/harness` 调用公开 consumer 命令；受管运行由 runtime 消费该原接缝，`--accept-candidates` 相对路径按 `--project-root` 解析：
```bash
npm run check:change-unit -- --project-root <host> --blueprint <blueprint-id> --accept-candidates "<features_dir>/<blueprint_id>/blueprint/change-unit-candidates.json" --json
npm run check:change-unit -- --project-root <host> --blueprint <blueprint-id> --readiness --json
```

命令接受成功后立即删除本次候选文件，即使后续 readiness 未就绪或文档物化失败；拒绝时保留供修复，清理失败只提示、不撤销接受结果。已有 CU 或接受成功但未就绪时只用 `--readiness`，不重复接受。结果分别报告 accepted ids/paths、readiness/perUnit/原因、人读文档与 canonical Feature id；readiness 含既有指针调和、确定设计投影/Feature 映射与文档物化副作用；纯 status/authorityGap 仍只读。内部实现见 [`change-unit-design-preparation.ts`](../../../harness/scripts/utils/change-unit-design-preparation.ts)，宿主无需 import TS 或写交接脚本。

1. 入口 = admitted blueprint —— **canonical CU 数量为 0 是合法入口**；
2. decomposition provider / 设计者只提出**临时候选**（内存 / 临时报告）；
3. **只有 consumer validator** 可以接受候选：校验 schema、canonical identity、设计闭包、
   provenance 与来源权威后，**原子**写出中型 1 个、复杂多个 canonical `change-unit@1`。任一候选不通过即
   整批拒绝、一个字节都不落盘；
4. 重复接受 **fail-closed**：目标 canonical 路径已存在即拒绝；未完成内容修订使用独立 consumer 接点，资格/恢复见[蓝图设计输入](../../../docs/concepts/blueprint-design-inputs.md#未完成-cu-内容修订)，不直接覆盖；
5. 派生 design gate / readiness；派生前把 carry-forward 通过且内容未变的 CU 蓝图指针
   原位升到当前 revision，输出 `blueprintRefs.bumped / skipped` 及跳过原因；`blueprintRefs.busy` 有值＝另一执行者正在写入、本次未写也无 readiness 结论，等它结束后重跑，不改设计内容。既有 CU 不先跑 `check:change-unit`、直接派生；它报 `change_unit_blueprint_ref_stale` 即指这次框架自动升版，不是修 CU（不要手改 change-unit.yaml 或抄 sha256）。

一项正式需求只分解出**一个** CU 是正常正向路径，不是退化形态。

### 4. Readiness 与后续施工入口（终点）

派生全部未退役 CU（含已完成旧 CU）的设计可施工门与 readiness；原 constructable 项只读检查 canonical typed 内容，absent 列补设计责任，invalid 按原原因 blocked；用例/映射确有未决时交原责任方，不反校验蓝图或重启旧 CU；已授权的原 writer 在 CU 接受后发布确定映射，readiness 沿原 writer 准备当前缺失/等价 typed 投影与 Feature 映射，不猜归属、不覆盖冲突；纯 status/authorityGap 只读。Feature 无安全刷新依据保留旧文件，canonical 合法指针照升；真正 canonical/I/O 失败按原事务。输出设计交付结果与下一步建议：

- 施工：[`/change-unit-progression`](../change-unit-progression/SKILL.md)
- 闭环：[`/component-closure`](../component-closure/SKILL.md)

**边界（BLOCKER）**：本 Skill 自身**停在设计交接**：不进入 P2 selector、施工循环或 P3 closure，不选择 CU，也不因直接设计请求启动施工 run。用户已授权完整实现时，原始请求已由同一 Goal runtime 受管；runtime 调用本设计职责，接收真实检查、独立质询与 readiness 后继续原 P2/CU 执行；全部适用CU完成后，原root仍须达到请求实际部件终点，消费原writer正式closure与适用装配/独核证据，不用只读evaluate代签，不要求主会话先做完设计才启动后台。仅设计请求仍到自身终点结束（[入口边界](../../../docs/operations/project-entry.md)）。受管初建与修订共用作者/质询接缝，具体写界和恢复见 [design-repair-unattended.md](../../reference/design-repair-unattended.md)。

### 5. 完整设计的本地人读文档与可选宿主接入

中型/复杂完整设计的评审交付（含仅定稿蓝图、尚无 CU）默认包含同目录 `component-blueprint.review.md`，已有 canonical CU 同页展示拆分与风险验收。**本次改了 canonical 蓝图/CU 内容，结束前必须执行 `check:component-blueprint --write-review --json`**（草稿、质询写回、局部修改、新增/替代同规则）；CU 仍经既有 consumer 接受。

生成、刷新或检查文档时，按 [P1 工作流 §5](../../reference/app-component-blueprint-workflow.md#5-写作检查与本地交付) 执行写作、摘要、图与截图、独立阅读及失败恢复细则。质询前先渲染，不要求先通过含质询结果的完整准入；checker FAIL 与 `review_document` current/refreshed 分别报告，尚待质询的草稿可读，真实解析/来源 BLOCKER 仍按原规则处理。八问适用缺口须在一轮定向修订中处理，仍未解决就如实报告、不冒称阅读通过；涉及需求明示的数据交接/跳转/清栈须对照原文，无授权偏离列待确认。修订后以正常宽度读成品；无图像仍审 Mermaid 是否按界面步骤或一次跨层交互拆实现时序，总览例外限旅程/角色关系，仅字号/布局/放大未核验。第8/13节导读不遮蔽逐项取舍与当前待确认事实。readiness 与阅读效果分别报告。只读请求不落盘；缺 guide 或过期展示当前事实，生成器不代写/盖摘要。最终链接当前文档，概述变化/未决项与阅读缺口；文档失败说明未交付/过期，仅重试物化，不改变原业务结论。

- **publication（Maison → 宿主，optional）**：输出指定 admitted revision 的确定性评审投影 （同一 `component-blueprint.review.md`），供宿主装配 Story Document / 归档件。投影 `derived_from` 精确绑定蓝图与有效 CU 内容、**相对两者零新设计事实**；宿主仍可附 spec 等附件，但**附件不成为 部件内设计的事实来源**。宿主未接该接缝 → 诚实降级，不宣称已归档。校验：`--projection <path>`。
- **feedback（宿主 → Maison，optional）**：结构化评审反馈必须区分**意见 / 事实补充 / 建议 / 授权裁决**四类。只有同时具备 `authority`、`source_revision` 与明确 `decision` 语义的 `authoritative_ruling` 才能进入 `decided_with_authority`。**校验只判候选资格，不代表已被 接受**——是否接受由蓝图 write owner 裁决；被接受的事实补充与授权裁决才按既有 reconciliation 生成**新** revision，**不得回写旧 revision**；意见与建议永不触发 revision 递进。契约 schema `framework/harness/schemas/blueprint-review-feedback.schema.json`；校验：`--feedback <path>`。

## 完成边界

局部操作完成只报告本次结果及剩余缺口。小型终点为原 request 绑定的四样短设计完成，不标完整设计 admitted；随后仅在原实现授权内继续能力调用。新事实需升级时在同一路径/ID 扩完整设计、独立质询/准入后接受 CU，保留成果/基线/真实 FAIL，用户固定外框不暗中升级。在途用户减少流程/验证须回原范围修订核真实原文，不另建 request 清账。

中型/复杂完整设计交接完成 = **admitted blueprint + 中型已分解 1 个、复杂已分解多个 canonical CU + 每个 CU 建立 `design_refs` 引用 + 后续施工 readiness + 当前人读文档及链接**。

注意分层：**合法 `component-blueprint@1` 的判据不含 CU 数量**（P1 不反向依赖 P2）——
`admitted blueprint + 0 CU` 是合法状态、是设计准备子流程的入口；"完整设计交付"才要求 CU。

本结果只代表**设计阶段**完成，不代表 Change Unit 已施工或 Component closure 已成立。

真实宿主进入条件与缺失路由见 [准入与回灌契约](../../reference/real-host-admission-and-feedback.md)。
