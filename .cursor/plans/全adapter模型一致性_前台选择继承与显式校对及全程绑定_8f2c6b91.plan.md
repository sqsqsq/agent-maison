---
name: 全 adapter 模型一致性——前台选择继承、显式校对与全程绑定
version: 3.1.0
overview: >
  修复前台已选模型与 Goal 专用上下文使用不同 provider/model 的授权缺口。
  复用现有模型 pin、manifest、执行上下文和调用生命周期，启动前解析用户意图并固定完整路由，
  在框架派发、重试与恢复中显式回放并核对，后台使用与前台相同的模型相关配置；
  无法确认时保全等待，不回落到后台独有的默认或替代模型。
todos:
  - id: verify-adapter-model-contracts
    content: 核对全部 adapter 的启动轮请求配置、模型目录、精确回放、原生续接和请求身份观察契约；以无付费请求的 dump-config 验证 DSH 前台模型来源配置层在 headless 生效，缺凭据复用既有硬失败识别，不新增预检。
    status: completed
  - id: resolve-and-freeze-selection
    content: 前台 agent 对照模型清单校对显式输入，框架只精确匹配正式 ID 或继承启动轮请求配置，将完整路由和相关推理设置收编到既有模型 pin；补齐有人在场、后台和旧 run 接续。
    status: completed
  - id: replay-and-enforce-every-invoke
    content: 收编各 adapter 的启动、配置、环境和原生 resume，在框架派发前约束模型，以同类原生记录字段逐字核对并处置漂移；对齐前后台模型相关配置，保留前台原本存在的原生辅助调用行为。
    status: completed
  - id: preserve-recovery-and-authorization
    content: 初设接回、CU 交接、待执行请求、原生会话与能力探针复用同一份完整模型身份。覆盖重试、恢复、后继及显式改选，删除 approved_models 自动替代路径，旧配置提示一次并忽略。
    status: completed
  - id: regress-incident-and-adapters
    content: 在隔离夹具复现宿主模型偏差，验证各 adapter 的名称校对、调用及恢复。新增自动化回归纳入日常域。开发运行 test:changed，普通计划收口运行 test:daily 和按影响补充的目标验证。
    status: completed
  - id: align-contract-and-delivery
    content: 同步发布指引、adapter 声明、报告和相应 OpenSpec 行为；报告实际能力及未验证项，完成修复交付，不混入质询循环或独立视觉 provider 的实施。
    status: completed
---

# 全 adapter 模型一致性

首稿创建于 2026-11-04（America/New_York）。2026-11-06 修订后的计划基线为 `main / 240c75dd`，开发窗口为 `3.1.0`。本计划的六项实施工作均待开发。

## 1. 事故与责任边界

用户报告：在 DSH 前台主动选用火山路由的 DeepSeek 模型，Goal 后台却使用官方模型，叠加设计质询循环，一夜费用约 100 美元。费用为用户报告，未访问账单，也不以调用次数推算金额。

宿主：`D:/1.code/SimulatedWalletForHmos`。
前台会话：`session-5871bdcc-6a84-444b-9bf1-762009a8773f`。
Goal：`doc/features/bc-openCard-2/goal-runs/20261104T050636Z-5eb635`。

只读核对 DSH 原始 `session.v4.jsonl.zstd` 中的结构化字段，得到：

| 来源 | provider | model | 其他事实 |
| --- | --- | --- | --- |
| 前台 `request/header.data.header.config`、`request/context` 及 101 条 assistant source | `volcengine` | `volcengine/deepseek-v4.1-flash` | 已确认真实请求路由，不依赖模型口头自报 |
| 后台作者 `session-92d74248-3de8-4de0-9d69-9eafe7ab4d82` | `deepseek-official` | `deepseek-flash` | 请求配置 `reasoningEffort=high`；273 条 assistant source 同路由 |
| 抽查质询 `session-a061dfca-d0f2-4556-a82c-5f2c37e6ed86`（i10） | `deepseek-official` | `deepseek-flash` | 请求配置 `reasoningEffort=high`；37 条 assistant source 同路由 |

原始会话位于 `C:/Users/shengqsq/.dsh/sessions/--D-1.code-SimulatedWalletForHmos--/<session-id>/`。日志采用串联 Zstandard 帧；只解首帧只能得到 session header，不足以核实模型。调查仅输出 provider/model/推理设置及必要计数，未输出请求正文或凭据。

该 Goal 的 `manifest.json` 没有 `adapter_model_pin`。调查时 `events.jsonl` 有 172 条 `agent_invoke_start`：1 次设计作者、171 次质询；其中包含失败启动，不能解释为 172 次成功模型请求。抽查两个后台原生会话足以证明模型偏差，但不能据此声称已逐一核对全部 172 次调用或其费用。

同一 manifest 另有 `visual_provider_pin={adapter: codex, model: gpt-6.1-sol}`。这是已存在的独立视觉身份事实，不据此推断本次执行过视觉调用或新增授权；实现须保留已授权的独立角色选择，不能把主模型修复变成覆盖其他模型选择。

本轮 Claude 检视补充了模型来源的配置事实：`llm-pi-ai.providers.volcengine` 的 `baseURL`、`apiKeyEnv` 及模型 `contextWindow/input` 声明只在 `~/.dsh/profiles/desktop/cordis.patch.yml`；原有 headless `--dump-config` 中没有 `volcengine`。因此只回放两个字符串仍不能运行这条路由，还必须让前台模型来源定义在 headless 生效。后台按前台模型来源声明的方式取凭据，框架不读取、不复制密钥。检视提供的实测表明，缺凭据时 DSH 启动后约 2 秒报 `dsh: MISSING_CREDENTIAL` 退出且零模型请求，后台直调路径已接入硬失败识别。两种运输的验收见 A1。上述新增事实来自本轮检视，实施前按实际安装版本复核。desktop profile 由 Electron 独占，不能直接通过 CLI 启动它来替代 headless。

### 已确认的框架缺口

1. `agents/deepseek-harness/adapter.yaml` 把 headless 默认模型交给 DSH 配置，并明确拒绝主模型指定。`goal-manifest-cli.ts::modelPinUnsupported` 把 DSH 列为不支持；无 pin 则允许启动。对应测试固化了这项旧行为。
2. `agent-invoke.ts::defaultHeadlessInvokePlan` 的 DSH 分支不消费 `modelPin`，使用固定 headless patch；该 patch 未绑定模型。前台原生会话的选择没有进入新 headless 会话。
3. 公共 `adapter_model_pin` 可选；支持 `--model/-m` 的 adapter 也不能因此保证继承前台选择。`normalizeAdapterModelCliValue` 只做字符串形状检查，没有模型名校对。
4. `claude-envelope.ts::resolvePinVerifyMismatch` 和 `GoalPhaseRuntime` 现行调用点仅产生事后告警，不阻止后续运行；这与本次要求的模型授权边界不符。

前三项直接造成实际路由失控；第四项是本次全 adapter 要求必须收编的公共缺口。历史 `d7f3a9c4` 的“显式 pin、无 pin 保持旧行为、observed 只告警”是旧范围，不能继续作为满足本次新要求的依据。

初设质询修复已在 `72c01ee4` 进入主干，`886cbef5` 接入了按冻结业务输入去重的派发判据，`240c75dd` 补修了初设恢复。此次在这些路径上验证模型绑定，原计划各自负责质询和业务进展的验收。

## 2. 目标与范围

模型选择属于用户授权。框架派发的各职责必须使用已确定的完整主模型身份，后台使用与前台相同的模型相关配置。普通主执行职责默认继承发起启动命令那一轮前台请求的配置；任务中明确指定模型时，先校对再覆盖该任务默认选择。模型不可用、认证失败或上下文不足都不授权框架换模型。

覆盖 `deepseek-harness`、`claude`、`codeagent`、`codex`、`cursor`、`opencode`、`chrys`、`generic/custom` 的能力判定和调用边界；不得把无法提供一致性保证的 adapter 当作兼容豁免。支持哪种原生能力依实际版本证据，不编造通用 `--model` 参数。

覆盖初始设计作者、独立质询、设计返修、施工作者、核验与核验格式修复、能力探针、框架调用的子执行上下文，以及普通/后台两种运输。独立视觉或其他角色已有明确用户授权时，可使用各自模型，但同样须显式绑定并按该角色校验，不能因配置存在就临时扩展模型授权。独立 review 指上下文独立，不天然要求模型不同。CLI/工具在前台同样会做的原生辅助调用保留原行为，不强制换成主模型，也不额外禁用；只对齐后台独有、与前台不同的模型默认值。

本批不新增美元账本、默认轮数上限、动态价格系统、模型推荐器或第二套恢复循环。无进展与用户截止继续由现有机制处理；不把这些措施当作模型一致性的替代品。

## 3. 唯一选择与名称校对

### 3.1 新请求的选择顺序

1. 本次任务明确指定的模型及其适用职责。
2. 未显式指定时，准确前台会话发起启动命令那一轮请求所用的模型及相关推理设置。
3. 两者都无法取得时，保持可恢复等待并说明缺哪项，不能用 profile/home/环境中的 headless 默认值补齐。

“前台当前选择”统一指发起启动命令那一轮请求的配置，不指其后的 UI 状态。名称识别与校对由前台 agent 在现有需求入口对照实际模型清单完成，输出正式原生 ID 交机器调用链；框架仅做精确匹配并列出候选，不实现模糊匹配。保留用户原话用于解释，后续阶段不能反复从自然语言猜模型。仅在用户语义确实指定模型时处理，业务文档中提及某模型不构成运行模型指令。

前台来源必须绑定准确 session、项目与启动轮请求，优先消费宿主公开的请求配置或工具上下文；不能读取“最近会话”、从目录推测或相信模型自称身份。只有 `lastUsed` 而无法关联该轮请求时，不足以证明启动选择；启动后 UI 新选但尚未发出请求的值不改变已启动任务。读取能力不足时请求用户明确型号；这项交互解决缺失授权，不是每次执行都确认。

纯 CLI 新启动没有前台会话时，须有明确模型输入。前台选择确定、且不需要名称消歧的正常任务直接启动，不新增例行确认。

### 3.2 校对规则

模型清单来自该 adapter、当前 provider 路由下可用的非秘密元数据或本机明确配置；不另建全局名单、别名映射表、编辑距离算法或模糊匹配机制。

- 前台 agent 对照清单把缩写、错字或原生别名校对为完整正式 ID，启动摘要显示原输入与最终选择。实际清单能唯一确定用户意图时直接校对；有歧义时列出最少必要候选请用户确定。
- 框架只接收正式 ID 并精确匹配；不匹配时返回清单中的正式候选供前台处理，不自行猜测、排序选中或尝试调用候选模型。
- 无匹配、清单不可读或请求模型在 headless 不可见时，不试发付费请求猜型号，不回落到默认。可用原生精确指定契约证明正式 ID 有效时无需额外目录请求；否则保留具体缺口。
- 冻结后不再做别名等价归一；比较同一类原生记录字段中的完整值，不以“同系列”“Flash”“同厂家”判等，也不把 provider 展示名与路由 ID 混为一谈。

### 3.3 冻结内容与真源

复用 `GoalManifest.adapter_model_pin` 作为主模型唯一真源，在其内部最小扩展表达不足的结构；`WorkUnitExecutionContext`、child env、argv/config、报告都是它的传输或投影，不另造 selection manifest、全局状态或场外账本。

在执行上下文中，完整原生模型 ID、provider 和适用的推理设置统一投影到既有 `WorkUnitExecutionContext.adapterModel`，不另加平行字段。基线中的两个比较点都消费这一个投影：`goal-phase-runtime.ts:4212` 的 `model: value.adapterModel` 用于冻结输入去重，`goal-phase-executor.ts:221` 的 `previous.adapterModel !== context.adapterModel` 用于判断能否复用原生会话。两处都按完整身份的值比较，即使从请求原件重新反序列化，同一绑定也应相等。只有 provider 变化时，两处均须识别到变化。

身份至少涵盖 adapter 所需的 provider 路由和完整原生模型 ID；存在实际可选且影响执行/计费的推理设置时一并继承或明确指定。provider 路由区分账户/endpoint 的，保持既有配置中的路由身份；模型来源定义继续使用原生配置真源，不把整份配置或密钥复制进 manifest。无法暴露的服务商内部模型路由不声称已验证。

DSH 本次真实身份是两个独立字符串：`provider=volcengine`、`model=volcengine/deepseek-v4.1-flash`。model 自身含 `/`；不得把 UI 展示名盲拆为 `provider=volcengine, model=deepseek-v4.1-flash`。只有 adapter 明确规定编码方式时才能解析合成字符串，必须可无损往返。

DSH 回放还须让前台 profile 的模型来源定义在 headless 同样生效，包含 `llm-pi-ai.providers.volcengine` 的 `baseURL`、`apiKeyEnv` 和模型 `contextWindow/input` 等原生声明。只冻结 provider/model 字符串不构成完成；缺来源会不可解析，缺上下文/输入声明会改变压缩与输入处理行为。复用前台自身配置层，按 §4.1 装配、检查，不另存一套 provider 定义。

旧 `{adapter,value,source?}` pin 继续可读，不在读取时重写旧身份哈希。新字段确有需要时同步既有 schema/身份比较及测试，消费链统一解析；不并行保留两个可修改的模型真源。前台继承的型号与显式指定同样属于用户选择，不能被标为可自由替代的默认值。

## 4. 启动与调用边界

### 4.1 按实际 adapter 契约接线

| adapter | 已有基础 | 本批须补证和接线 |
| --- | --- | --- |
| DSH | 固定 headless patch、stdin、准确 SID 续接、统一 invoke | 继承启动轮完整选择并复用前台 profile 的模型来源配置层，放在框架权限补丁之前；付费前以 headless `--dump-config` 证明 provider、模型及 `baseURL/apiKeyEnv/contextWindow/input` 生效；按前台来源声明取凭据，缺失复用既有硬失败识别；核对续接行为及请求路由元数据 |
| Claude / CodeAgent | `--model`、stream-json、Claude init model 解析 | 取得启动轮完整原生 ID 和 provider 配置；对齐后台独有模型默认值，保留前台原有的小模型辅助调用；在最早同类原生记录上核对而不是整个调用结束后告警 |
| Codex | `exec --model`、现有会话与模型 pin 传输 | 前台实际选择、provider/推理设置、精确 resume 的覆盖语义及原生身份来源 |
| Cursor | headless `--model` | 前台与 CLI 型号可用性、Auto 与具体模型的区别、可用身份来源；前台 Auto 无确定模型时不能伪装严格绑定 |
| OpenCode | `run -m` | 准确 session 的 provider/model、配置与续接优先级、原生调用身份核对 |
| Chrys / generic / custom | 自有启动或模板 | 明确声明并验证取得/回放/约束完整模型的能力；能力缺失时在模型请求前等待，不能原样无 pin 透传 |

先检查本机安装版本与无模型请求的最终装配；上游源码或旧探针只作为线索，不能替代当前安装版本。DSH 继续启动 headless，以实际 CLI 支持的配置叠加方式加载前台 profile 自己的配置层，再施加框架权限补丁和本次模型绑定；前台层不能覆盖框架权限。desktop profile 由 Electron 独占，禁止用 CLI 直接启动 `desktop`。不改用户持久默认，不用全局 `process.env` 存当前选择，不创建逐次临时配置管理系统。

DSH 在任何付费请求前用最终组合的 headless `--dump-config` 检查 provider 可见及上述模型来源声明与前台一致；保存设置可能覆盖 patch 时，以最终有效值为准，不仅检查 YAML 字面内容。只提取必要非秘密字段用于比较和报告，不输出或落盘完整配置 dump。

后台按前台模型来源声明的方式取凭据，框架不读取、不复制密钥。缺凭据时由 DSH 原生 `MISSING_CREDENTIAL` 退出，由 `vision-canary.ts::resolveInvokeHardCliFailure` 识别并经当前运输交回，同一调用当场停下。该出口的提示改为“所选模型来源要求的密钥”，保留“保存到同一 DSH_HOME 的 DSH 模型设置，或配置到启动 Goal 的环境/DSH_HOME/.env 后重跑”的补救方式，不写死具体变量名、不回落其他路由。

### 4.2 每次派发的共同约束

1. 从当前职责的冻结选择生成 `HeadlessInvokePlan`，无完整绑定或无法精确回放时，不进入模型请求。shell preview/prompt 中写了模型不算回放。
2. 显式参数或受支持的配置覆盖必须能约束原生请求；父环境大小写变体、旧 pin、profile 默认值、native resume 的旧选择不能覆盖本次选择。沿用现有统一 env 合成与清理，两个并行/连续调用不得串模型。
3. 对框架派发职责的主模型，在最早可用的同一类原生记录字段上逐字比较完整 provider/model 及相关设置；请求配置与请求配置比，不能将请求 ID、响应展示名或原生辅助调用的模型混比。无法取得同类字段时如实标为未知，不构造等价关系；继续复用现有 stdout/会话解析和进程生命周期，不新建旁路执行器。
4. 已证明不一致时，立即走现有取消/进程回收和可恢复等待；不再派后续调用、不自动换模型，也不把这次产出签为该授权模型下的合格交回。记录期望、观察值、调用身份与解除条件；保护已有产物，不自动回滚业务文件。
5. “用户选择是什么”与“实际执行是否遵守”职责分开。原生观察不能反向改写用户 pin，但可以证明违反授权；撤销现行“真实失配也只能告警”的策略。模型生成的文字仍不能作为身份或裁决证据。

后台使用与前台相同的模型相关配置，只有后台独有、与前台不同的默认值必须对齐；工具在前台同样会做的原生子 agent、摘要等辅助调用不另行约束。Claude 前台原本用小模型完成的子任务，后台保留同样行为，不强钉主模型增加费用，也不因本计划禁用必要能力。当前 DSH headless 只有 `agent-default-model` 一项模型配置，子 agent 没有单独的模型设置，不为它虚构配置。框架另行派发的作者、质询等仍各自使用已确定的主模型，调用内多轮主模型请求也须保持绑定；原生辅助调用按本段检查配置一致性，不纳入主模型逐字失配判断。

### 4.3 能力与保证的边界

“传了参数”“启动回报一致”“请求路由受约束”分别记录，不互相替代。付费前优先依据可验证的最终配置与原生精确指定契约阻止误路由；只有付费响应后才暴露模型的接口，事后核对无法追溯阻止已发生的费用，不能宣称零误扣保证。缺少足以约束调用的能力时不发请求，给出具体不支持项；这是一致的默认规则，不新增模式开关。

框架保证自身选择、原生配置和可观察请求身份一致；对于服务商未公开的内部别名转发/实际权重，不能声称独立验证过。模型自称、猜测价格或响应风格都不补足这一证据。

## 5. 恢复、改选与兼容

- 重试、断线重连、精确原生 resume、无原生 resume 的上下文重建和自动 successor，均沿用原职责冻结选择。模型配置默认值发生变化不触发换模型。
- 目标模型限流、认证不可用、额度不足或模型下线时，按既有外部条件保全等待；删除 `approved_models` 的自动替代执行路径，不通过新 run 刷新授权。旧配置读取时每次启动仅提示一次该字段已停用并忽略，不因废弃值校验失败阻断启动。
- 用户后续明确为该任务换模型时，前台 agent 校对正式 ID，框架在既有授权/manifest 转换入口精确匹配并绑定，再恢复未完成工作；保留有效成果。启动后仅改变 UI 选择不自动改变既有任务，新的任务改选指令才进入上述转换，不混用新旧值。
- 旧 run 无 pin 可以只读查看；继续执行前须补齐明确选择，不能把“过去碰巧用过的后台默认模型”当用户意图，也不能复用未绑定模型的待执行请求。接续应复用现有授权入口，不迫使丢弃整个 run。
- 旧 run 有 pin 按其旧格式解析并检查是否可回放；需要扩展信息时补足后再执行。恢复读取本身不静默更改旧 manifest 或身份摘要。
- 模型已经无歧义且可执行的正常路径，不反复确认；只有缺失选择、实际歧义或任务模型变更的授权不足才等待用户。

接回落实到三个现有调用点。

1. 有人在场的 `goal-mode-entry --prepare-run` 目前从输入 manifest 接收 pin。后台的 `GoalPhaseRuntime.run` 命中既有初设时会在新建分支的 pin 裁决之前直接接回，`prepareInitialDesignRun` 的接回分支只校验 adapter。两个入口都应在决定继续执行前区分任务显式改选、沿用已有绑定和旧 run 补绑。CU 通过 `delivery_origin` 继承原请求，已创建的 CU 及其已签发、尚未执行的请求也要和当前授权核对。已接受的交回仍可读取，已经启动的调用先按现有 owner 观察或结清，只有尚未执行且绑定失效的请求需要重新签发。
2. `prepareExecutionContext` 将 §3.3 的模型投影作为 `workInput.material` 之外的执行条件。接续决策 `decideRunContinuation` 同样按完整身份识别授权改选。相同绑定的重试仍受原去重规则约束。
3. 同一 run 的会话金丝雀交回和 `canaryAdmissibleForExecution` 的能力缓存也按完整绑定决定能否复用。旧材料只能证明模型名时，只重取本次确实需要的模型能力证据。原业务成果及其已完成检查按原有规则复用。

### 保留与裁剪

| 项目 | 本批处置 |
| --- | --- |
| 既有 pin/manifest、精确 SID 续接、统一 invoke/env、等待与恢复 | 保留并补接线；不新建平行真源 |
| 前台原生辅助模型行为、已明确授权的独立角色选择 | 保留；仅对齐后台独有的模型配置差异 |
| `approved_models` 获准替代 | 删除生产替代决策、轮换/重探及专属配置校验和引导；旧字段仅提示一次并忽略，移除或改写相关测试，不保留不可达执行分支 |
| 历史 `approved_alternative` 来源及替代事件 | 只读兼容，不回写旧摘要；恢复前按本次规则确定选择，不据旧来源继续替代 |
| “不一致只告警” | 撤销；同类原生字段的真实主模型失配走现有取消与恢复出口 |
| “DSH/chrys/generic 免指定模型” | 撤销；无法继承或精确绑定时等待，不无绑定透传 |
| “不指定模型时沿用旧行为” | 撤销；先继承启动轮选择，缺失时等待，不取后台默认 |
| 运行期别名等价归一、框架模糊匹配 | 不实现；前台完成校对，冻结完整原生 ID 后精确比较 |

## 6. 场景收益与改动落点

| 必要调整 | 已发生或明确要求的场景 | 实际收益 |
| --- | --- | --- |
| 主模型绑定从可选输入变成每次调用前提 | 前台火山模型、后台官方模型 | 不以错误 provider 继续产生费用 |
| pin 最小扩展完整路由与相关设置 | model ID 自含 provider 前缀，后台另有 high | 保持可无损回放，避免名称近似掩盖实际差异 |
| 前台校对、框架精确匹配 | 用户明确提出缩写/错字 | 不把错字送进 CLI 后再悄悄用默认模型，不新建模糊匹配机制 |
| DSH 前台模型来源配置层复用 | 火山来源只在 desktop 配置，headless 缺 provider | 确认来源可解析、上下文/输入声明一致；凭据沿来源声明获取，缺失复用既有硬失败出口，不新增检查 |
| 失配及时取消及保全等待 | 现有 warning-only 允许继续 | 停止扩大已知错路由损失，可从原任务恢复 |
| 原生能力不足不无绑定启动 | DSH/Chrys/generic 的旧豁免 | 所有 adapter 遵守同一授权标准 |

优先修改现有落点：

- `goal-mode-entry.ts`、`goal-phase-runtime.ts`、`initial-design-delivery.ts`、`goal-run-creation.ts` 与现有 manifest 解析支撑 §5 的入口及接回。模型校对结果在 detach 启动进程交接前捕获，后台子进程消费同一选择。
- `framework-local-config.ts` 及现有配置说明/校验：停用 `adapters.<adapter>.approved_models` 的执行消费和专属校验，保留一次兼容提示，不新增持久告警状态。
- `goal-phase-executor.ts`、`session-execution-handoff.ts`、`phase-state.ts`：两运输与专用上下文传递；所有调用职责和延后执行均消费同一选择。
- `agent-invoke.ts` 在 `withInvocationAuthorization`、`withProviderSession` 处理后才执行最终命令，验证须覆盖这一实际组合。模型核对复用 stdout 的逐条结构化事件和已有取消入口。冷恢复需要核对既有调用时，可读该调用的纯 `agent-events.jsonl` 或准确 SID 的原生请求记录。`readInvokeFinalText` 用于交回业务正文，`result.stdout` 只保留末尾 64 KiB，长调用不能靠这两者找首个模型事件。
- 现有 visual/verifier/canary 调用点：职责身份边界和遗漏接线，复用各自身份源，不重写视觉功能。
- DSH 缺凭据沿用 `resolveInvokeHardCliFailure` 和 §4.1 的通用提示。有人在场的 `runGoalExecutionAction` 当前将原生结果投影为 `status/phase/details`，仅有 stderr 时可能只留下退出码。A1 须经这个正式入口验证，必要时在原始 stderr 还可用时复用同一分类并传递其处置。同步旧文案断言，沿用已有停机与补救方式。
- 相应 unit/fixture、Goal Skill/runbook、adapter 文档与 `openspec/specs/{agent-adapters,goal-runner,goal-mode-skill,goal-driver-handoff}`：行为与实现一致。
- 裁剪替代模型时同步 `specs/framework.local.schema.json`、`await-confirm-guidance.ts` 和 `openspec/changes/task-continuation-recovery-loop` 中尚存的 `approved_models` 的冲突条款。保留历史身份和替代事件的读取。

如既有能力声明确实表达不了回放方式，只做承载本次必要语义的最小扩展，不新增模型注册表、授权服务、租约或签名层。停机原因和检查 ID 如需新增，按现有 registry 要求登记；不把过程证据文件损坏一律升级成新硬门禁。

## 7. 验收

| 编号 | 输入/触发 | 必须成立的结果 |
| --- | --- | --- |
| A1 | 火山 provider 仅存在于前台 desktop 配置层，后台默认保留官方路由；事故夹具的来源声明为 `apiKeyEnv=VOLC_API_KEY`，分别提供与缺少该凭据 | 后台直调与有人在场的 execute 均通过 headless 加载前台配置层并在其后施加框架权限补丁，不启动 desktop profile；付费前 `--dump-config` 证明火山来源及 `baseURL/apiKeyEnv/contextWindow/input` 与前台一致；缺凭据时 DSH 报 `MISSING_CREDENTIAL`，经既有硬失败识别当场停、零模型请求，通用提示保留 DSH 模型设置或启动环境的补救方式；凭据由原生来源正常取得时作者与质询使用完整火山路由，用户配置/凭据不被改写或复制 |
| A2 | 任务显式指定不同于前台的合法模型 | 先校对并可见地确定任务模型；各职责、两运输、重试/恢复保持该选择 |
| A3 | 精确 ID、原生别名、含斜杠 ID、缩写、错字、跨 provider 同名 | 前台 agent 对照清单校对成正式 ID，歧义列候选请用户确定；框架仅精确匹配、未匹配返回正式候选且零模型请求；不实现模糊匹配，不截断 ID |
| A4 | 缺前台身份、无法关联启动轮的旧 lastUsed、启动后仅 UI 改选、Auto、不支持模型回放 | 只认启动轮请求配置；缺事实时可恢复等待，不暗用默认；后续单独 UI 改选不影响原任务 |
| A5 | 父环境残值/大小写冲突、home/profile 覆盖、连续和并行不同选择 | 最终有效路由符合每次选择，无串值；原有权限及凭据清理不回退 |
| A6 | 同类原生请求字段中的主模型失配，包括首个模型事件后还有超过 64 KiB 输出，以及后续主模型轮次切换 | 在首个可判定失配的事件上取消，两种运输均保留失败或等待事实。冷恢复和终稿投影不能把该次调用签为通过。原生辅助模型按前台配置运行 |
| A7 | 前台别名已校对为正式 ID、模型不可用/限流/认证失败；旧 approved_models 存在（含无效形状） | 正式 ID 沿同类记录字段精确匹配；失败不替代、不试探候选；废弃配置提示一次并忽略，不触发旧校验阻断或重探 |
| A8 | 旧无 pin 的初设接回并转 CU。固定业务输入、模型 ID 和推理设置，只授权更换 provider。另测仅改推理设置，以及相同绑定的重试、resume 和 successor | 仅换 provider 时，派发去重将授权改选识别为新条件，原生会话选择排除旧 provider 的 SID。仅改推理设置时同理。未执行的旧请求和旧绑定的探针结果不能代替新授权，已接受的有效成果保留。完整绑定相同且无其他新条件时，维持原去重与恢复行为 |
| A9 | 框架独立质询/核验/格式修复/视觉；Claude 前台使用小模型的原生子任务；DSH 子 agent | 框架派发职责和多轮主模型请求保持各自绑定；原生辅助行为与前台一致，不强换主模型、不禁用；只对齐后台独有默认值，DSH 不新增不存在的子 agent 模型设置 |
| A10 | 全 adapter 矩阵与两种运输 | 支持项有实际版本证据；不支持项在付费前明确等待；不以缺 CLI 为理由跳过离线边界验证 |

事故回放只取 A1 的必要脱敏字段。模型来源缺失、名称未确定和 DSH 缺凭据的反例应产生零模型请求。A6 单独覆盖原生事件才暴露的偏差，验收在该事件处取消、没有后续派发，并保留此前已可能发生的调用事实。

真实收费 smoke 在确定准确路由和明确小额/次数边界后才做；不得先用默认模型试错。没有真实 smoke 的 adapter 如实标注验证缺口，不能把 argv 单测说成全部实机通过。最终交付须区分已实现、已离线验证、已实机验证与当前原生不支持。

开发每轮运行 `npm run test:changed`。本计划新增的自动化用例按现行分级登记到日常域，由 `npm run test:daily` 实际执行。复用 `daily-design-journey` 已有的初设→CU 签发链和 `daily-recovery-journey` 的受控运输恢复用例，由公共夹具通过正式入口提供测试模型，核对实际请求原件。模型参数与原生失败的断言复用现有 adapter/pin/canary 套件的日常用例组。普通计划收口运行一次 `npm run test:daily`（含 typecheck）及本批必要验证。`npm test` 完整全量属于正式发版门禁。

## 8. 依赖与交付边界

截至开工前复核，前序运行时与测试改动已提交到 `main / 240c75dd`，可以从该基线开发。实施前按最新 HEAD 和工作区差异区分本计划与其他在研文档。

`e2a4145e` 的质询修复独立验收；`4e92a7c6` 仍是独立视觉 provider 计划。本计划生效后，“主开发仍使用 DSH 默认模型”不再是后续新增代码可保持的产品要求，实施时同步现行说明并协调该计划衔接；不为本批擅改旧计划正文或接管其全部实现。

本计划不指定实施者、检视者或执行模型。计划文件、代码、验证记录各自承担职责。
本轮只落本计划；未修改生产代码、宿主、DSH 配置或凭据，未启动付费模型调用。实现、实机验收、提交和发布的完成状态必须分别如实报告；消费者只通过已构建并验证的发布件更新，不手改宿主 `framework/`。
