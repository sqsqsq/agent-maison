原始正式需求：
# BankCard原始需求描述

> **需求名**: `bc-openCard-2`
> **创建日期**: 2026-06-10

---

## 一、需求描述

### 需求内容

本次需求内容是银行卡开卡需求，我把原始图片都归档到了本文件同级目录下。

#### 需求规格：

1.用户进入已有的添加卡片页面，之前已经开发过了。之前点击任一银行点击后，提示暂不支持，本次需求改为拉起选择卡类型半模态页面。

2.用户在全部银行页面，任一银行点击后，效果与添加银行卡页面效果一致。

3.选择卡类型半模态页面，会展示本银行支持的储蓄卡+信用卡，如果只支持储蓄卡或者信用卡则只展示一个即可。最多只能选择一种卡类型添加，选择后，下方可点击同意并继续按钮进入对应银行的选择具体卡片页面。

4.银行的选择具体卡片页面，展示该银行支持的银行卡信息，卡号只显示前四后四，但实际后台数据要按完整卡号处理。用户选择一张银行卡后，同意协议，点击下一步，拉起输入验证码半模态页面。

5.输入验证码半模态页面，拉起后默认触发一次假的短信发送，之后右侧按钮变为倒计时，用户必须输入6位验证码才能点击下一步。当前6位验证码可随意输入。倒计时归零后，右侧按钮从倒计时变成重新发送。点击后再次变为倒计时。用户输入完成验证码后，后台将完整卡数据写入RDB（本需求开始要创建卡片数据库和对应卡片数据表，将添加的卡片存入数据库中，数据库中字段至少包含卡号、卡类型[比如银行卡、交通卡、门禁卡等]、银行名称、卡类型、添加时间、开通华为支付状态、开通银联手机闪付状态、交易记录等内容），无论写入成功还是失败，将本次添加的卡片卡号（全卡号）和开卡结果带着跳转到添加结果页。

6.添加结果页是个全屏页面，没有左滑箭头，也禁止左滑事件。添加结果页根据带过来的添卡结果，展示成功或者失败状态。同时本页面只有点击完成按钮才能退出页面，并且在页面退出时，关闭当前栈中1-6的所有页面（都是本轮银行卡添卡页面）。如果本次添加是成功状态，则带着卡片卡号跳转到钱包首页（后续等银行卡详情页开发完，这里会引导跳到银行卡详情页，并携带当前卡片参数）。如果本次添加失败则仅将过程中的页面全部退出，回到最开始的添加卡片页面。

#### 页面说明：

- 1）选择卡类型半模态：页面布局完全参考'3-点击任意银行拉起添卡选卡半模态.jpg'。在添加银行卡或全部银行页面，点击某个银行后，拉起选择卡类型半模态（默认所有mock银行都支持储蓄卡和信用卡，该数据随银行数据走），上方是银行信息，然后是储蓄卡/信用卡二选一，下方有小字提示，然后是协议内容（本次默认按文本展示，不需要可点击富文本），最下方是同意并继续按钮。

- 2）选择具体卡片页面：页面布局完全参考'4-点击信用卡或储蓄卡后拉起选卡页面.jpg'。在第3步选择银行+卡类型后点击继续，跳转全屏的银行内部选卡页面，页面title就是银行名称，上方是小字提示，中间是可选择的不同卡片（每个银行，储蓄卡/信用卡，分别mock 1-2张卡数据），下方是协议（文本即可，不需要富文本），最下方是下一步。

- 3）输入验证码半模态：页面布局完全参考'5-选中某张卡片后拉起短信验证.jpg'。第4步选择具体卡片下一步后，拉起短语输入弹框，上方是小字提示（里面要展示用户手机号，从账号mock数据读），中间是输入框，左边输入右边发送按钮，用户点击发送后，需要将按钮变为60s倒计时，倒计时过程中按钮不允许再次点击。倒计时清零后，按钮重新变成再次发送，并且可再次点击。用户在短信输入框中，只能输入6位数字（需要校验），只有输入正确，下方下一步按钮才从置灰状态变为可点击。点击下一步后，则绑卡完成，进入添卡成功结果页。

- 4）添加结果页：页面布局完全参考'6-短信验证完成后结果页.jpg'。无title，全屏页面。上方根据前一个页面传递的添卡结果，控制上方图标/文案/下方小字的提示内容，然后附一张引导图片（大差不差就行了），再往下的激活nfc部分本次先不需要。最下方是完成按钮。点击完成按钮后，跳转到卡详情页。并且本次添加的卡片数据则需要写入数据库中，数据库要包含卡片的详细数据，比如卡号/类型/哪家银行/支持华为支付或银联手机闪付/交易记录，后续的卡详情等页面都是根据数据库读取卡数据并展示。有一点要注意：到了添加结果页，要屏蔽左滑事件，并且在点击完成按钮后，要把整个开卡过程中的所有开卡相关页面全部从页面栈中剔除（从添加银行卡页面开始，一直到结果页自身）。避免开卡完成后还能一直左滑看到开卡过程页面。

#### 路由规格

1. 所有页面跳转要遵循已有路由规则，相关代码参考模块画像去找，不要自由发挥或者另外写一套。
2. 测试用例要包含老代码和本轮新开发代码的页面互相跳转功能，不能导致原有路由受损。

请求终点：feature；完成上述原始需求的全部适用CU正式交付。

需求原件：doc/features/原始需求/1-2-银行卡/原始需求.md

固定blueprint_id=bc-openCard-2；产品工程根=D:\1.code\SimulatedWalletForHmos；框架根=D:\1.code\SimulatedWalletForHmos\framework。

读取 D:\1.code\SimulatedWalletForHmos\framework\skills\project\component-design\SKILL.md 及其P1工作流；执行前读取工程AGENTS、catalog/glossary/architecture和相关真实源码。

当前准确schema：D:\1.code\SimulatedWalletForHmos\framework\harness\schemas\app-component-blueprint.schema.json；D:\1.code\SimulatedWalletForHmos\framework\harness\schemas\runtime-data-flow.schema.json；D:\1.code\SimulatedWalletForHmos\framework\harness\schemas\change-unit.schema.json。读取schema原文与相关跨视图检查规则，不猜字段、不复制示例答案。

本次控制入口已核实可信原请求的原范围自主完整交付授权；这不是由运输能力、默认never/goal_mode、历史日志或Agent留痕授予的新权。

区分用户原文/人工裁决与当前技术施工范围：前者必须遵守，后者可在原需求内经设计修订重签；不把局部要求扩成全局限制。

在原需求和明确限制内修订设计，可补节点、选型、关系和必要架构决定；不降低验收，不伪造人签，不改产品源码。

原目标内常规确认依 D:\1.code\SimulatedWalletForHmos\framework\skills\reference\user-confirmation-ux.md §9 自动决议，不重复索取已授事项；真实目标/验收改变、秘密、不可逆动作与用户硬预算仍守实际授权，不以此降低质量门或伪造人签。留痕只记入当前写集内既有设计材料，不另写phase账本。

原文有不同表述时，在原需求内依据原文自身的条件或时间范围解释，保留全部本次适用要求，将有来源依据的设计决定及两方出处记入现有设计材料，再交独立质询；不改需求，不删验收，不伪称用户逐项确认。

只展开当前交付切片，复用已批准机器投影；按原P1契约声明稳定义务及真实内部/外部契约，不伪造质量结果。

本次唯一作者写集：D:\1.code\SimulatedWalletForHmos\doc\features\bc-openCard-2\blueprint。范围候选仅经现有prepare-scope命令生成。不得写产品源码、测试、framework或其它Feature/CU；不自行签机器准入、receipt、events或完成。

当前职责=author。问题：
独立质询否定 view:scenarios：需求规格1–6及路由规格分别已映射 AC-1–7，但 acceptance_criteria 用 steps/expected，参考区功能验收为空；未给出可消费的 testable、verification_steps、expected_result 等，不能视作完整验收。参考图、默认双卡类型、结果提示及新旧路由互跳需逐项保留。正文旅程为空。；由设计作者修复，原独立质询再核。
独立质询否定 view:logical：需求规格5要求完整卡号、卡片大类、银行、储蓄/信用类型、时间、两种支付状态和交易记录；BankCard及表列有对应字段，但 DTO 空、返回 SaveResult 未定义，手机号契约无可消费签名；数据库安全级别与加密仍待核实，数据清理未设计。；由设计作者修复，原独立质询再核。
独立质询否定 view:runtime：有七步概述但缺明确参数、调用者、返回及失败分支，getMockPhone 与用例 getUserProfile 不一致；结果全卡号的交接和清栈不能仅靠概述。唯一时序图把多个页面和跨层交互合并为一图，正文未展示。；由设计作者修复，原独立质询再核。
独立质询否定 flow:open-card：规格3–6覆盖单选、1–2张、前四后四、6位、60秒和保存后传全卡号；但 result payload 和导航仅概念化，缺失败时无持久标识的传递、不同入口成功/失败清栈边界、返回取消及保存过程中退出的处理；需按原文保留交接与完整清栈。；由设计作者修复，原独立质询再核。
独立质询否定 view:development：files 只列目录而非具体文件；组件缺页面职责及大部分接口，BankCard 有模型而 SaveResult、getMockPhone 接口及路由参数未定义；用例形状缺 coordinator、结构化 ui_bindings/state_model/branches，不能证明可投影施工。；由设计作者修复，原独立质询再核。
独立质询否定 relation:flow-development：关系只指 implementation；手机号由独立 AccountManager 节点承担，但流到该节点的接缝、具体调用签名和开发依赖尚未闭合；原 Phone 根路由分发涉及新页面注册，目录写集未覆盖其责任或可行替代。；由设计作者修复，原独立质询再核。
独立质询否定 app_lens:module_boundaries：catalog/glossary 将钱包页面编排归 WalletMain、账号域归 AccountManager、根导航归 Phone；Phone index 现有分发显式列举页面。新增页面如何注册及其写集/依赖未说明；不能把需求原文当现有模块事实。；由设计作者修复，原独立质询再核。
独立质询否定 app_lens:capability_seams：AccountService 现有 getUserProfile 返回脱敏邮箱；蓝图计划 getMockPhone，UC-1 却调用 getUserProfile。CardRepository 的 SaveResult 未定义；页面/根导航入口、失败处理及跨模块出口未写清。；由设计作者修复，原独立质询再核。
独立质询否定 app_lens:data_producers_consumers：需求规格5要求成功和失败都向结果页传全卡号与结果；规格6成功带卡号回首页。设计仅写 payload 和消费描述，没有两阶段交接类型、持有者和清理时机，也未说明失败无持久记录如何保留卡号。；由设计作者修复，原独立质询再核。
独立质询否定 app_lens:lifecycle_triggers：设计声明打开发送、60秒、关闭清计时器和恢复时核对倒计时，但未定义恢复依据、计时来源、回调销毁及写入中取消处理；需求要求倒计时期间不能重发。；由设计作者修复，原独立质询再核。
独立质询否定 app_lens:state_owners：概述分配 WalletMain 页面与 CardRepository，但未确定页面实例/交接边界及返回取消、结果页与首页消费后的清理；RDB 才是已提交数据真源。；由设计作者修复，原独立质询再核。
独立质询否定 app_lens:initialization：蓝图仅声明 wallet_cards.db 版本1及表列，并说施工前核实平台安全级别和加密；初始化上下文、建表及升级失败、升级兼容和具体安全配置未确定，不能称当前契约已冻结。；由设计作者修复，原独立质询再核。
独立质询否定 app_lens:publication_subscription：设计说经导航参数发送 fullCardNumber/success，但缺具体 API、接收者及成功回首页的第二次交接；Phone 根导航由 index 按页面名分发，新增页面接入方式未落实。失败同样须携带全卡号。；由设计作者修复，原独立质询再核。
独立质询否定 app_lens:ui_refresh：需求要求结果页依结果切换图文、四页面参考图片、输入及倒计时变化；设计只有概述，缺真实 UI 状态绑定、结果页分支及可消费的验收字段，且正文无图示。；由设计作者修复，原独立质询再核。
独立质询否定 app_lens:process_recovery：设计规定不恢复验证码和临时选择、以数据库为准，但未说明写入确认前后中断和启动时如何判断及用户可见恢复；不可把数据库真源原则当成已设计恢复路径。；由设计作者修复，原独立质询再核。
独立质询否定 terminology:current_scope_items：current_scope_items 涉及添加卡片页面、添加银行卡页面、全部银行、卡片大类、储蓄/信用类型和钱包首页；discovery.facts 无 term: 条目。源码显示 AddCardEntryPage、AddBankCardPage、AllBanksPage 为不同页面，应结合原文、入口链与 glossary 定义，尤其明确失败回哪一个页面，不能伪造用户确认。；由设计作者修复，原独立质询再核。

已有设计材料（先读并继续，不从零重复探索）：
D:\1.code\SimulatedWalletForHmos\doc\features\bc-openCard-2\blueprint\component-blueprint.review.md
D:\1.code\SimulatedWalletForHmos\doc\features\bc-openCard-2\blueprint\component-blueprint.yaml

前次本职责调用：20261029T005400Z-a21473/initial-design-author-i1；实际status=passed，exit=1，正常完成=true，timed_out=false。调用结束不等于本职产物完成。
原件：D:\1.code\SimulatedWalletForHmos\doc\features\bc-openCard-2\goal-runs\20261029T005400Z-a21473\phases\initial-design-author\initial-design-author-i1\agent-output.log
前次最终正文（只作线索，不是质量结论或本次授权）：
我会按 component-design 的作者职责读取现有设计依据、schema 和工程事实，补齐蓝图及必要的设计材料，并运行指定检查。当前只处理获授权的蓝图写集，后续独立质询和施工交由 runtime 推进。
已确认工程已有两个银行入口、银行数据仓库和根导航壳；本次设计需要沿用这些路径，并明确成功与失败时不同的清栈去向。接下来正在核对蓝图的实际字段约束和源码调用链。
发现一个实际设计缺口：现有账号 mock 仅提供脱敏邮箱，没有手机号字段。蓝图会明确采用账号域提供 mock 手机号的设计，并保留对现有账号调用和路由的兼容要求；这不是把邮箱当作手机号。
蓝图草稿和评审投影已生成，但首次检查发现契约、跨视图引用和 provider 接缝尚未闭合；我正在按检查器的实际规则补齐，独立质询和准入仍由 runtime 负责。
已编写 [component-blueprint.yaml](D:/1.code/SimulatedWalletForHmos/doc/features/bc-openCard-2/blueprint/component-blueprint.yaml) 并生成 [评审文档](D:/1.code/SimulatedWalletForHmos/doc/features/bc-openCard-2/blueprint/component-blueprint.review.md)。草稿覆盖了双入口、选卡、验证码、RDB、结果页和成功／失败清栈方向，也记录了现有账号 mock 没有手机号的事实。

**当前仍是未准入草稿，作者工作尚未完全收口。** 指定检查命令返回 `FAIL`：缺独立质询结果和 runtime 派生的准入结果；另有评审导读缺失警告。这两项准入阻断不能由作者自行填写。

此外，内部契约的 DTO 和映射、具体页面与参考图的对应、可施工的用例和写集仍需进一步细化；检查器未报这些项的阻断，并不代表设计深度已满足交付。尚未生成 CU 候选，也未修改产品源码或测试。作者调用结束不代表原始 Feature 已完成。

本次必须实际编写或补齐 D:\1.code\SimulatedWalletForHmos\doc\features\bc-openCard-2\blueprint\component-blueprint.yaml，不是只调查、写author-findings.md或报告尚未完成。已有发现是中间材料；完成必要定向核实后立即把本次真实设计写进schema蓝图，并按当前机器缺口继续修到本职可交接。

先完成原需求的当前切片、4+1视图、稳定义务、内部/外部契约与数据/导航/失败恢复闭环；不等另一位作者接手，不以尚待独立质询为停止写蓝图的理由。没有真实授权或必需事实时明确具体缺口，不编答案。

按原始需求与真实工程事实设计当前切片，保留本次必要契约、数据闭环及风险。内部存储契约可direction: internal，不要求制造远程API。不得自写独立questioning；机器admission由runtime派生。

蓝图位置：D:\1.code\SimulatedWalletForHmos\doc\features\bc-openCard-2\blueprint\component-blueprint.yaml；候选位置：D:\1.code\SimulatedWalletForHmos\doc\features\bc-openCard-2\blueprint\change-unit-candidates.json。候选形状为[{providerId,artifact}]，已有CU不重复创建。

实际检查命令（cwd=D:\1.code\SimulatedWalletForHmos\framework\harness）：npm run check:component-blueprint -- --project-root "D:\1.code\SimulatedWalletForHmos" --blueprint "bc-openCard-2" --write-review --json。检查仍待质询不等于任务停止，报告真实产物/问题后由runtime继续。

完成本职工作后真实报告；作者调用结束不是原始交付完成。runtime负责真实检查、独立质询、CU接受/readiness与后续施工，不要自选阶段或伪造CU身份。