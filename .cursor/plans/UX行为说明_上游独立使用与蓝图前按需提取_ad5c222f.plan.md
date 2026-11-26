---
name: UX 行为说明的独立提取与蓝图前消费
version: 3.1.0
parent_goal: complex-capability-construction-75411223
advances:
  - g3-component-discovery-and-design-lenses
relation: knowledge-provider
layer: knowledge
goal_requires:
  - host-business-input-channel
goal_provides:
  - element-linked-ux-behavior-input
real_host_validation: >-
  Claude Code、Codex、OpenCode、DSH 各独立运行一次开卡单屏短例，记录实际路由、逐图观察及产出。
  在钱包隔离宿主覆盖已有稿和缺稿两种设计输入，受管初设只要求一次，以作者首轮蓝图核对实际消费。
parallel_authority_added: false
overview: >-
  提供可单独分发的 ux-behavior-spec 实例扩展 Skill，将设计图元素、PRD 行为及验收例子关联起来。
  产品和 UX 可独立生成、核对并定稿。安装扩展的 Maison 宿主在蓝图发现前优先读取已有说明，缺项按需提取。
todos:
  - id: extension-layout
    content: 建立按能力维度组织的扩展源码、清单和安装说明，更新目录分层及主包排除规则。
    status: completed
  - id: behavior-skill
    content: 实现独立 Skill、Schema 与模板，定义逐图依据、未观察和待决语义，只补本次请求涉及的内容。
    status: completed
  - id: wallet-example
    content: 落地含 12 个验收例子的四屏及流程样例、离线静态看图页和仓内 Schema 与引用单测。
    status: completed
  - id: blueprint-consumption
    content: 接通唯一触发指引和读写目录，核对宿主首轮蓝图消费，受管初设只要求一次。
    status: in_progress
  - id: acceptance-and-delivery
    content: 完成四个本机客户端各一次独立单屏短例、发布边界和仓库验收，交付 §5.1 逐行结果及样例对照口径。
    status: completed
---

# UX 行为说明的独立提取与蓝图前消费

## 1. 要解决的问题

开卡 PRD 把同一个控件的规则分写在“需求规格”和“页面说明”里。图 3 显示两种卡，默认模拟银行又都支持两种。把两行写死也能还原这张图，换成只支持信用卡的银行才能发现错误。图里的蓝色协议文字和储蓄卡勾选态也需要分别解释。前者在本期按文本展示，后者只说明截图当时选中了储蓄卡。[开卡原始需求与四张设计图](../../harness/tests/fixtures/component-selection-handoff/dependencies/doc/features/原始需求/1-2-银行卡)

这项能力放在上游需求交接与蓝图发现之间。产品及 UX 维护用户可观察的行为，端云在开发侧把业务数据绑定到接口、字段和现有路由。新增的产品交付物回答“图上哪个元素在什么条件下会发生什么”。它给上游一份可看图校对的材料，给蓝图用例与验收同一个引用点。首版的收益用实际设计输出核对，开发提速留待对照实测。[已有实例扩展能力](extension_实例扩展注入物化与检视_d8f4b7e2.plan.md)

## 2. 放在哪里，怎样单独使用

```text
extensions/
  manifest.yaml
  skills/ux-behavior-spec/
    SKILL.md
    schema/ux-behavior.schema.json
    templates/screen.ux.yaml
    templates/flow.ux.yaml
    reference/intake.md              # 适用范围、读稿与补齐的唯一触发指引
    reference/checklist.md
    examples/bc-openCard-2/
    viewer/                          # 静态入口、单文件浏览器版 YAML 解析库及其许可
```

- 开发仓的 `extensions/` 与宿主的 `doc/extensions/` 按相同维度组织。首版只增加实际提供的 Skill，清单沿用实例扩展格式，在 `provides.skills` 声明 `ux-behavior-spec`。把仓根 `extensions` 加入 [发布排除表](../../scripts/release-excludes.json) 的 `excludeRootDirs`，并更新 [AGENTS.md](../../AGENTS.md) 的目录分层。内置 Skill 索引继续只登记随主包交付的能力。
- 可独立分发的单位是完整 Skill 目录。`SKILL.md` 给出输入、调用示例和产物，引用包内 `reference/intake.md`。模板、Schema、示例和静态看图页都按包内相对路径使用。独立调用只需项目材料与可读写文件的智能体，视觉能力决定本次能取得哪些图像事实。
- 根 manifest 的注释说明安装与设计前接入。将 Skill 按原相对路径装进宿主扩展目录，**只合并选中的声明**，保留宿主清单身份、已有的 `story` 等技能和其他配置。沿原 `verify`、`materialize` 流程为已配置的适配器更新入口。[实例扩展接入约定](../../skills/project/extension/SKILL.md)
- **读写约定**。优先读取显式提供的交接稿，否则从本次需求原件所在目录读 `*.ux.yaml`，按当前需求、屏幕 ID 和流转引用选取适用文件。独立使用时写入调用者指定的目录。受管初设的作者将推导稿写入本次已签发的蓝图目录下的 `ux/` 子目录，并在那里续用有效草稿。上游原稿保持只读。[作者写集](../../harness/scripts/utils/initial-design-delivery.ts)

## 3. 产物怎样表达行为

以开卡草稿 `format_version: "0.2"` 为底稿。屏文档以 `screen` 命名，`elements` 的键就是稳定元素 ID。流程文档用 `screens` 指向屏文件，用 `transitions` 保存跨页动作。例如 `card_type_sheet.continue_button` 引用 `open_card_picker`，该流转只定义一次所选银行、卡种和目的页。截图态与默认值分开，`return_from_picker` 可保持 `open`。

| 产物 | 内容与边界 |
|---|---|
| 每屏或每个弹层一份 `*.ux.yaml` | 以稳定屏幕 ID 和元素 ID 定位。结构化设计稿引用文件和节点，实际看过的截图可引用原图和归一化 `[x,y,w,h]`。按需写数据来源、显示与选择规则、操作条件、事件和验收例子。重复的动态列表只定义行模板。 |
| 跨页流转 | 流程涉及多屏时，另写一份流程 YAML，集中登记来源、屏幕、触发元素、目标、携带的业务数据、成功失败分支和退出范围。屏幕动作引用这条流转。单屏可以自行登记来源。 |
| 依据与待决 | 每条实质规则引用可回查的 PRD 条款、设计节点、图中区域或产品决定。区分原文明示、截图观察、合理推断和待决。图中勾选态与业务默认值分开表达，未裁定的默认值保留待决。 |
| 编号看图页 | 双击同一份静态 HTML，在浏览器中选择包含 YAML 和原图的目录或有关文件，按相对路径解析并当场画框、编号与链接。YAML 或原图变化后重新读取即可。固定版本的浏览器 YAML 解析库作为单个文件随包交付，离线使用。只有文字或未观察的元素仍显示规则与缺口，画框须有可定位且注明来源的坐标。 |
| 格式与核验 | 同一份 JSON Schema 描述屏幕和流程。仓内 `harness/tests/unit/` 用已有的 `yaml` 和 `auditSchemaSupport`、`validateLiteSchema` 验模板及五份样例，另断言实际来源、元素、流转目标与例子引用均可解析。用一个悬空引用和一个“未观察却声称读图”的反例验证能检出。校验由仓内单测承担，独立使用时可直接取随包 Schema。[仓内 Schema 校验器](../../harness/scripts/utils/lite-json-schema.ts) |

提取边界取自**本次请求涉及的屏、元素及直接受影响的条件或跨页关系**。例如只修改协议文案时，只补该元素及确受影响的依据，保留其他元素的稳定 ID 和已有裁决。清单用于发现适用的单选、授权、返回、键盘或错误条件。已确认的内容出现冲突时，保留两方依据与待决定的问题。

**读图按本次作者、逐张图判断。** 输入路径、文件名和适配器声明只说明材料或能力存在。作者实际收到图像并能定位相关事实，才可写“截图观察”。若路由不支持、工具失败或原图未送入作者上下文，在该屏的 `visual` 保留图源并写 `observation: unobserved`（未观察）。其区域与截图状态继承“未观察”，省略图上坐标和示例勾选值。保留当前作者路由，从 PRD 或可读的结构化设计节点继续提取，节点几何和变体归到设计源。两者也无依据时保留缺口。已有稿中的观察可按上游出处沿用，本次作者的读图记录仍须如实填写。

## 4. 怎样在蓝图中生效

运行时触发正文只维护在 Skill 的 `reference/intake.md`。宿主尚无设计前知识声明且没有生效的 profile 背景时，令 `provides.skill_assets.component-design.knowledge` 直接指向扩展根相对路径 `skills/ux-behavior-spec/reference/intake.md`。已有宿主知识文件时只追加一行读取该指引的指针。若当前使用 profile 回退，宿主入口同时引用原有效知识和这份指引，避免遮蔽原资料。安装注释只说明如何接指针。作者在同一会话按 §2 的位置读写。[设计前知识的读取入口](../../skills/project/component-design/SKILL.md) · [受管初设的指令与写入范围](../../harness/scripts/utils/initial-design-delivery.ts)

| 进入设计时的材料 | 蓝图发现与写作开始前的行为 |
|---|---|
| 已选装扩展，原件目录或显式输入有适用 UX 文件 | 直接读取所涉页面、流转、出处与裁决。部分可复用时只补此次请求中的缺口，推导稿遵守 §2 写集。 |
| 已选装扩展，只有原始材料 | 在当前会话按 Skill 提取。受管作者写到其蓝图目录，规则仍追溯至原始需求或设计。看不了图按 §3 的未观察路径继续，上游文件由产品侧定稿。 |
| 非 UI 需求，或宿主未选装该扩展 | 沿原设计流程处理，显式提交的文件仍可作为普通需求材料读取。缺少可选交接文件不构成停机原因。 |

蓝图把相关 `屏幕ID.元素ID` 连同业务意义带进已有用例和验收条目，跨页行为落在相应运行流程。产品元素标识可写入现有描述、步骤和来源关联，真实代码入口、设备定位与技术契约继续使用其原字段。PRD 明示的规则可直接形成验收，推断保留依据，影响当前业务承诺的待决项沿现有设计决定或缺口处理。仅在来源清单登记文件路径不足以证明已经消费。[蓝图写作与验收职责](../../skills/reference/app-component-blueprint-workflow.md)

本地正式材料可以由蓝图入口规范化。若外部需求系统作为 provider 交材料，则沿 `requirement-source-materialization@1` 保留项目内来源、来源字节及权责。M7 的校验发生在材料生成后。扩展登记和 M7 校验各有既定用途，触发提取由上表的设计前规则承担。[宿主输入适配](../../docs/operations/component-design-host-adaptation.md)

## 5. 开卡验收与交付边界

| 验什么 | 实际可观察的通过条件 |
|---|---|
| 独立使用 | 在普通目录只提供 Skill 和声明的输入，得到选卡类型、具体选卡、短信验证、结果四屏及一份流程。离线打开随包静态页并选择样例，编号能回到正确元素。改一项 YAML 后重新读取即可看到变化，未观察区域不出现推测的方框。单独提出“只改协议文案”时，输出只涉及该元素和受影响的引用。 |
| 行为提取正确 | 仅支持信用卡的银行只出现一行。切换卡种仍在半模态，两段蓝字为文本，点“同意并继续”才带所选银行和卡种进入具体选卡页。图 4 文件名的简写不覆盖正文。首次预选、点继续后半模态是否关闭、从选卡页返回的落点与选择保留，均可从对应元素查到待决状态。 |
| 跨页与数据正确 | 具体选卡页的卡号只显示前四后四。选定具体卡并同意协议后进入验证。首次模拟发送一次，60 秒倒计时内不可重发，归零后点按才再次发送。六位数字才能提交。写入成功和失败都携完整卡号进入结果页。结果页屏蔽侧滑和系统返回，点完成才清理本轮流程。本期成功携号回钱包首页，失败回“添加卡片”入口。[已有入口消歧记录](蓝图评审文档_问题导向正文与设计叙述同源交付_6b3f8c21.plan.md) |
| 宿主确实消费 | 在钱包隔离副本保留原扩展，覆盖预制 UX 与仅原材料两种输入。受管初设只要求一次，可用仅原材料验证自动提取，预制稿复用走现有直接设计入口。以每次**作者首轮实际交回的蓝图**核对“单卡只显一行”的验收、“点继续才跨页”的用例及仍然开放的返回问题，记录该作者实际使用的图文依据。若本次未读图，新提取项须保留“未观察”，沿用上游稿的观察须注明出处。首轮遗漏按未通过记录，后续质询和准入沿原流程处理。重复安装保留原清单和设计前说明。 |
| 发布边界 | 用既有发布文件分类和实际临时 zip 目录检查标准包不含仓根 `extensions/`，内置 `skills/` 正常随包。宿主扩展放在宿主的 `doc/extensions/`。实施按仓库日常验证要求执行 `npm run test:changed`，普通 plan 收口沿用 `npm run test:daily` 及上述定向验证。 |

### 5.1 四个客户端的独立单屏短例与视觉覆盖

在本机用 Claude Code、Codex、OpenCode、DSH **各独立调用一次 Skill**。四次共用同一份选卡类型屏 PRD 片段和同一张图 3 测试副本，只移动原图的勾选标记。每个客户端从空输出目录开始，提示只要求提取本屏，文件名和提示均不透露标记位置。每次交回一份该屏 UX，不提供其余三屏、预制 UX 或其他客户端的答案。四个短例止于 Skill 交回，不进入受管设计。上表的宿主验收另核蓝图消费。

- **看过图**。用本轮成功读图结果或送入当前会话的原生附件记录，连同 UX 中的选中对象和可定位区域，对照移动标记后的图 3。截图所示的选中项应与副本一致，业务默认值仍为待决。
- **未看过图**。记录实际原因，例如 DSH 路由未声明图像输入时 `read_image` 返回 `does not declare image input`。UX 应标为 `unobserved`，保留 PRD 可确定的单选、协议文本和点继续才跳页，省略截图坐标和勾选断言。实际运行并正确降级可判为产出正确。客户端未能启动时记未实测及原因，必跑项保留待验收。

验收覆盖一次真实看图和一次真实无图降级，可在上面的短例和已要求的一次受管初设中取得。验收记录沿用下表，逐行填写实际模型路由、本次图 3 是否看过及原因或证据、该客户端产物位置和正确性结论。仓内声明及以往独立视觉 provider 的成功记录仅供定位。四个必跑项在实际运行前保持“待测”，Cursor 本轮豁免，Chrys、CodeAgent、Generic 本机跑不了时记录“未实测”及原因。

| 客户端 | 仓内声明 | 单屏短例要求 | 实际模型路由 | 图 3 是否看过、原因或证据 | 单屏 UX 产出位置、是否正确 |
|---|---|---|---|---|---|
| [Claude Code](../../agents/claude/adapter.yaml) | `tool_read` | 必跑一次 | Claude.ai，`claude-opus-5-5` | 是。Read 返回图像，信用卡勾选态与区域命中。 | [首稿](../../../agent-maison-ux-behavior-spec-evidence/ad5c222f-short-cases-20261125/runs/claude/out/select_card_type.ux.yaml) 未通过入口 Schema，并拆成两行。[定向复测](../../../agent-maison-ux-behavior-spec-evidence/ad5c222f-short-cases-20261125/runs/claude-revised/out/select_card_type.ux.yaml) 通过 Schema 与单屏行为核验，附加的背景描述缺少对应元素 ID。 |
| [Codex](../../agents/codex/adapter.yaml) | 普通输入 `none`，独立 provider 有原生图片参数 | 必跑一次 | ChatGPT，`gpt-6.1-sol` | 是。原生 `--image` 附件与产物里的信用卡勾选态、区域一致。 | [单屏稿](../../../agent-maison-ux-behavior-spec-evidence/ad5c222f-short-cases-20261125/runs/codex/out/select_card_type.ux.yaml) 通过。先前两个不可用模型的入口错误另记。 |
| [OpenCode](../../agents/opencode/adapter.yaml) | 普通输入 `none`，独立 provider 有原生图片参数 | 必跑一次 | `volcengine/glm-5.3-flash` | 否。文件到达 read 工具，模型返回不支持图像输入。 | [单屏稿](../../../agent-maison-ux-behavior-spec-evidence/ad5c222f-short-cases-20261125/runs/opencode/out/bc-openCard-2.select_card_type.ux.yaml) 通过无图降级。图源已登记，未读图未用于规则依据。 |
| [DSH](../../agents/deepseek-harness/adapter.yaml) | 普通输入 `none`，独立 provider 使用图像路径 | 必跑一次，沿用现有能力 | `volcengine/deepseek-v4.1-flash` | 是。本次 `read_image` 的成功结果与信用卡勾选态、区域一致。 | [单屏稿](../../../agent-maison-ux-behavior-spec-evidence/ad5c222f-short-cases-20261125/runs/dsh/out/bc-openCard-2.card-type-sheet.ux.yaml) 通过。 |
| [Cursor](../../agents/cursor/adapter.yaml) | `multimodal: true` | 豁免 | — | 豁免 | 豁免 |
| [Chrys](../../agents/chrys/adapter.yaml) | 普通输入 `none` | 本机不可运行时记未实测 | — | 未实测，本机未找到 `chrys` | 未实测 |
| [CodeAgent](../../agents/codeagent/adapter.yaml) | `tool_read` | 本机不可运行时记未实测 | — | 未实测，本机未找到 `codeagentcli` | 未实测 |
| [Generic](../../agents/generic/adapter.yaml) | 普通输入 `none` | 本机不可运行时记未实测 | — | 未实测，本机未找到 `agent-cli` | 未实测 |

2026-11-25 的四客户端原始输入、工具证据、CLI 尝试及首稿与修订稿的区分见[本机独立验收记录](../../../agent-maison-ux-behavior-spec-evidence/ad5c222f-short-cases-20261125/records/results.md)。Codex、DSH 的首稿通过修订后的 Schema，截图状态键沿用当时 Skill 的写法。

### 5.2 后续收益评估口径

12 个公开场景直接编入五份样例的 `acceptance_examples`，给定数据、操作和可观察结果均可追到原始材料。卡种页承载 01–04（双入口与单卡、单选留屏、两段协议、点继续进入对应选卡页），具体选卡页承载 05–06（脱敏选卡、同意协议），验证码页承载 07–08（首次与重发、六位输入），结果页承载 10（结果表现及退出限制），跨页流程承载 09、11、12（写入结果与完整卡号、成功收尾、失败收尾）。本期交付样例与口径即可。实际试验时才创建结果记录。

后续两种模型各比较原材料与增加五份 YAML 的一对场次。同模型、同预算、同验收，测试方按原材料和相同的产品决定独立冻结预期，替换银行、卡号及写入结果，待决问题单列。比较首轮通过数、需求误解返工轮数、交接至验收墙钟、设计调用次数及质询阻断数。总成本计入生成、复核与更新。

本计划的交付终点是独立使用、宿主蓝图消费与发布隔离。四组完整实现对照、设备运行、推广和正式发布另行安排。缺少收益数据时维持可选安装，按已有开卡反例修订，不将试点结果推广为默认流程。

## 实施记录

**2026-11-25，正常设计入口的定向修复获准。** 钱包原发布件 `517b63fe` 的两份隔离副本均通过扩展安装、物化和重复安装核验。有预制稿时，直接作者实际读取上游稿和两张图，交回原件目录下的 Markdown，将关闭时机同时写为固定步骤和待决。仅有原材料时，受管作者首轮交回正式蓝图，覆盖单卡和点击继续，但未提取 UX，并把返回保留卡种写成确定行为。两项首次结果均保留为未通过。[首轮终端与实际稿](../../../am-ad5c222f-hostqa/evidence/wallet-host-first-author-acceptance.md)

已签请求仅含根 Skill 路径与通用读取说明。现有知识装配器能解析已配置的 `component-design.knowledge`，首次受管作者签发没有把该资产交入。获准的改动限于让正常设计入口在写作前实际取得这份已生效的知识，复用现有解析、预算、出处、蓝图位置和作者写集。扩展继续选装，未配置的请求沿原路径，质询保持独立。[原签发审计](../../../am-ad5c222f-hostqa/evidence/managed.signed-instruction-audit.json)

修订采用构建并校验的候选发布件，在新的隔离宿主对上述有稿、缺稿两种入口定向复验。按相同业务观察点核对新首轮实际交回，将新结果单列。独立单屏、原受管 run 和正式钱包现场的记录各自保留。

**2026-11-25，接线已实现，钱包定向复验待放行。** `1b375f07` 将生效知识送入受管作者的指令及签发材料，直接入口用既有蓝图检查 CLI 的只读模式取得知识原文及正式蓝图位置。`5291896c` 将根 Skill 整理到现有 150 行预算，保留首次只读动作、正式落点和待决一致性说明。文档组 18 项通过，隔离钱包只读探测返回了配置原文和正确路径，独立代码复核通过。首次钱包失败原件已封存，[归档](../../../am-ad5c222f-hostrecheck/evidence/original-first-author-failures.zip) SHA256 为 `98bd8dfdf0c849d590cfcdaa50802121cedf41c6255dcb45b2b4df1d693ab12a`。

正式门禁仍未通过。三工作进程完整日常在接线提交上为 5,668 项通过、2 项失败。根 Skill 的行数回归已定向修复。另一项为既有 P4 `a21473` 恢复回放。空闲窗口的单工作进程在 `5291896c` 再次触发同一 120 分钟用例上限，保全进度停在第 24 次调度。该次已无法放行，已停止余下重复用例。按需计划的 15 组亦含这个用例。正式候选和修订后的钱包业务首轮均未取得通过结果。[单进程超时原件](../../.codex/reports/ux-behavior-ad5c222f/w1-replay-timeout-5291896c/failure.json)

临时检查包 SHA256 为 `860c567648aabfa5d47767f1a6a1018bf5835cd77a613c934e8cc720a55395d9`。1,275 项内容哈希、主包排除及同一 zip 的仓内消费者生命周期冒烟通过。该包的检查结果与正式候选资格分别记录，尚未用于两份新钱包副本。[本机验收与检视记录](../../.codex/reports/ux-behavior-ad5c222f/验收与检视.md)

**2026-11-25 美东 19:26，钱包宿主定向复验。** 按需求方裁决，扩展专项直接使用上述已核验的 `5291896c` 检查包。两份全新的钱包副本均已完整安装同一 zip，并保留原 `story` 等扩展。原失败现场单独封存。[有稿宿主安装记录](../../../am-ad5c222f-hostrecheck/evidence/direct.integration.json) · [缺稿宿主安装记录](../../../am-ad5c222f-hostrecheck/evidence/managed.integration.json)

宿主原生命令 `/ux-behavior-spec` 由 Claude Code 从已物化桥接加载，在真实钱包材料上交回一份选卡类型屏 YAML。Schema、来源、单卡只显示一行、协议纯文本和继续动作均经核对。原图中的勾选态作为观察，业务默认值保持待定。[宿主扩展调用与核对](../../../am-ad5c222f-hostrecheck/extension-entry/evidence/result.md) · [实际产物](../../../am-ad5c222f-hostrecheck/extension-entry/out/bc-openCard-2-selectCardType.ux.yaml)

有预制稿时，正常设计首回读取三份上游稿及两张原图。单卡一行、切换留屏、点继续才带银行与卡种跨页、默认与返回待决均写入会话交回。首回没有在请求的蓝图目录写文件；同一会话补交时使用了 PRD 编号，实际写到另一蓝图目录。首回与补交分别记录。[有稿场次与实际蓝图](../../../am-ad5c222f-hostrecheck/evidence/direct-retest-summary.md)

**钱包缺稿首轮促成两次扩展返修。** 已签发知识到达首作者后，旧指引仍让作者直接写蓝图并补定返回。修订 `0ecca16c` 明确先写、再回读 UX。另起的钱包首作者在蓝图骨架尚未改动时先写出流程稿和屏幕稿，随后写出正式蓝图。回读发现屏幕 YAML 有语法错、流程来源相对路径失效，并且有一条已写死的返回与待决问题冲突。额度在文件落盘后中断，此场保留为首轮失败。[缺稿首轮、产物和具体位置](../../../am-ad5c222f-intakeqa/evidence/revised-intake-retest-summary.md)

修订 `3b78e3a9` 在现有模板示范实际写出的屏幕、范围外页面、相对来源和未决返回，在回读时实际解析已写 YAML、核对文件引用。目标套件 5 项通过。两次返修分别经实际 Claude Code CLI（`claude-opus-5-5`）检视通过。[取用指引复核](../../.codex/reports/ux-behavior-ad5c222f/claude-review-5.conclusion.json) · [模板复核](../../.codex/reports/ux-behavior-ad5c222f/claude-review-6.conclusion.json)

**2026-11-25 美东，`3b78e3a9` 钱包实测。** 钱包宿主沿用同一 `5291896c` framework 包，按需安装新版扩展。Claude 同版本额度已用尽，此次正常受管初设改用钱包支持的 Codex `gpt-6.1-sol/high`。原件目录只有需求和设计图。作者实际收到图 3、4 等原图，在 `ux-qa-managed-codex/blueprint/ux/` 先写卡种屏、目的页交接屏和流程，再写本次正式蓝图。三份稿均能解析，均通过宿主随附 Schema，来源和屏幕相对路径可打开。蓝图用元素 ID 核对银行卡种单选、单种一行、点继续携银行和卡种跨页，返回落点和选择恢复保持待决。[三份 UX 与来源核验](../../../am-ad5c222f-templateqa/evidence/managed.codex.authored-ux-validation.json) · [实际蓝图](../../../am-ad5c222f-templateqa/managed/doc/features/ux-qa-managed-codex/blueprint/component-blueprint.yaml) · [逐图回执](../../../am-ad5c222f-templateqa/evidence/managed.codex.native-image-evidence.json)

这份受管草稿将一个拟新增的仓库方法/模型字段写进了面向产品的 `data.supported_types.source`。流程稿保留从选卡页返回的分歧，未另外登记点继续当下原半模态是否关闭。[实际屏幕稿](../../../am-ad5c222f-templateqa/managed/doc/features/ux-qa-managed-codex/blueprint/ux/card-type.screen.ux.yaml) · [实际流程稿](../../../am-ad5c222f-templateqa/managed/doc/features/ux-qa-managed-codex/blueprint/ux/card-type.flow.ux.yaml)

同版宿主原生 DSH（`volcengine/deepseek-v4.1-flash`）实看图 3、4 并交回可解析的稿。首稿将点继续写成关闭半模态，两处 `copy_ref` 填成文案。单轮评审返修分开了前往选卡页和原半模态去留，保留初始选中待决，按原文明确选卡页同意协议前置；两个引用仍需产品交接复核。返修作者读过包内样例。首稿、对照与返修材料分别保存。上述场次验证取用和可追溯性，总工时或强弱模型收益仍按 §5.2 的同条件对照口径另测。[宿主原生首稿与核对](../../../am-ad5c222f-templateqa/native-out/report.md) · [一次返修的实际结果](../../../am-ad5c222f-templateqa/native-revision/report.md)

受管 Codex 首作者于美东 20:18 交回指定目录的蓝图。原生线程收到完成事件，作者回执为 `passed`，内部观察另记退出码 1 和已收齐完成信号。以上三项业务结论来自实际文件核对。原有受管缺稿失败、有稿首回和本次受管首轮分别保留。[本次受管首轮总表](../../../am-ad5c222f-templateqa/evidence/result.md) · [原有缺稿首轮](../../../am-ad5c222f-hostrecheck/evidence/managed-retest-summary.md)

本次已交付样例、对照口径、客户端记录和钱包专项验收。按需求方指定范围，验收交付状态据宿主实测记录。有稿直接入口首回未落盘、补交错用 PRD 编号，保留在蓝图消费待办的实施记录中。

产品交接副本按实测意见另行修订。同一原生 Codex 作者修正工作区写入环境后，只改外部副本的三份 UX。`supported_types` 现指当前银行支持的卡类型，继续动作携所选银行和卡种。确认当时原浮层是否关闭、从选卡页返回的落点、若回浮层是否保留选择分别为 `open`。三稿通过 Schema，六个相对来源、两个文案引用、元素与流转均能解析。受管首轮文件与原材料保留原字节。[可交给产品的卡种屏](../../../am-ad5c222f-templateqa/reviewed-handoff/doc/features/ux-qa-managed-codex/blueprint/ux/card-type.screen.ux.yaml) · [待决与流转](../../../am-ad5c222f-templateqa/reviewed-handoff/doc/features/ux-qa-managed-codex/blueprint/ux/card-type.flow.ux.yaml) · [实测复核](../../../am-ad5c222f-templateqa/evidence/reviewed-handoff.md)
