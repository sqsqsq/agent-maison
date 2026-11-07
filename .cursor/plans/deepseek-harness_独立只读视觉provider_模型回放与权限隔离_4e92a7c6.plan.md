---
name: DeepSeek Harness 独立只读视觉 provider——模型回放与权限隔离
version: 3.1.0
overview: 在 8f2c6b91 的 DSH 模型绑定上补独立只读视觉能力。用调用级 overlay 验证路由覆盖顺序，沿现有模型身份和统一 invoke 接入只读权限、逐图读取及终稿校验；按日常全集和受影响目标验证收口。
todos:
  - id: t0-readonly-and-model-contract
    content: "T0：在隔离项目用较早 overlay 指向不同模型，验证最后的视觉 overlay 决定实际请求路由，并核实只读/never、工具限制、图片保留和逐图读取。"
    status: completed
  - id: t1-model-and-permission-wiring
    content: "T1：复用 8f2c6b91 的 ProviderRef、modelBinding 与公共回放链，补 DSH 视觉只读启动、最后 overlay 及必要的声明兼容；8f2c 提交后复核接口与行号。"
    status: completed
  - id: t2-final-output-projection
    content: "T2：按 §4.4 以退出码和最后 final 投影 DSH 终稿，要求本次每张输入图具有成功 read_image 证据；复用完整 stdout 和现有结果校验，不新增执行生命周期或通用验读门禁"
    status: completed
  - id: t3-regression-and-desktop-validation
    content: "T3：执行 test:daily 及按影响选取的回归和正式桌面探针；H1 使用任一已配置图像路由，优先非默认，验证模型身份、逐图读取及开发/视觉权限隔离。"
    status: in_progress
  - id: t4-declaration-and-delivery
    content: "T4：仅在必要验收成立后交付 visual_provider 声明、能力说明及 agent-adapters OpenSpec 同步，汇总改动、版本、证据与限制；不提交、不打包、不回灌宿主，不修改 6d2e9a47 和 6fd6c8c1"
    status: in_progress
---

# DeepSeek Harness 独立只读视觉 provider 实施计划

创建日期：2026-10-25。编号：`4e92a7c6`。起草基线：`main / a32ad1d0`；根 `package.json.version` 为 `3.1.0`，本计划不推进版本。

## 0. 当前阶段与执行边界

当前授权仅为编写计划；T0–T4 均未执行，收到明确开工指令后才开始。本文可独立交接，规定产品行为、依赖、验证与交付条件。

- 开工先检查最新 HEAD/status，按实际代码复核落点。基线提交只用于定位，不授权 reset、清理或覆盖其他会话改动。
- 本计划独立于首版接入 `6d2e9a47` 和交付/恢复收口 `6fd6c8c1`；不修改两份计划、不接管后者的实现或验收。共享 runbook 若已有其他会话修改，只追加本批必要内容并保留原改动。
- 本批不提交、不推送、不打包、不安装软件，不修改用户 PATH、注册表、DSH 默认配置、profile 或凭据文件；不读取或打印密钥。
- 不访问或修改宿主工程、手机，不运行完整业务需求；Maison 源仓不跑 framework-init，也不为此重新初始化已有宿主。
- 实施后的真实调用只在隔离测试目录进行，使用已安装的桌面 DSH。需要现有已配置路由和相应认证；缺失时报告缺口，不猜模型名、不改路由、不安装替代载体。
- 遵守 `docs/overview.md §1.2.1` 四条总设计原则；探针与诊断材料复用开发报告目录，不新增运行时场外状态、账本、审批流程或恢复系统。

## 1. 目标与完成边界

开发调用沿用 8f2c6b91 对前台选择的绑定、回放及既有写权限。独立视觉调用使用本次冻结的视觉 provider/model，在同一 DSH 配置下读取图片并返回结果，写权限按视觉用途收窄。

“DSH 中配置了模型”不等于任意 profile 都能使用该路由，更不等于模型支持图像输入。成功交付须同时证明：指定路由实际生效、模型能读取图片、调用权限满足只读边界，以及结果进入 Maison 现有视觉载荷/图片哈希校验链。

首版提交 `98b3f786` 和计划 `6d2e9a47` 明确排除了独立视觉 provider、主模型指定及 JSONL 解析。本批是新增能力，不将首版范围外的能力标为回归，也不将“dsh 能启动”当作全用途支持。

主开发模型的选择、续接与回放由 8f2c6b91 负责，本批仅实现视觉只读调用及其 DSH JSONL 终稿投影。通用 DSH SDK/服务、精确用量采集、独立 verifier、设备验收及发布回灌均在本批范围外。

## 2. 已核实事实与证据边界

桌面安装包调查取自 2026-10-24 至 10-25，实际版本和行为由 T0 复核。下表区分 2026-11-06 的 Maison 工作区接线与既有桌面调查。8f2c6b91 正在另一会话实施，本计划引用的接口以其提交后的源码为准。

| 事实 | 定位与影响 |
|---|---|
| 当前 DSH adapter 无 visual_provider | `agents/deepseek-harness/adapter.yaml`；接线完成后按 §6.3 登记以执行 T3，桌面验收成立后交付 |
| 视觉声明解析仍要求旗标；执行层已能携带 DSH 模型绑定 | `adapter-catalog.ts::parseVisualProviderDeclaration`、`visual-provider-invoke.ts::resolveVisualProviderInvokePlan`；差额与复用边界见 §4.1 |
| 公共启动按 adapter 强制全权限 | `agent-invoke.ts` 的 `buildAgentSpawnEnv`；当前会覆盖调用方的只读环境输入，必须按调用用途收编 |
| 视觉执行器已有只读 plan、统一 invoke 和结果投影 | `visual-provider-invoke.ts`；复用其生命周期、身份/图片校验、失败处置与工作区变化检查 |
| 安装包内 headless 版本为 0.2.1-rc.3 | `D:\Program Files\DeepSeek Harness\resources\app.asar` 内 `dsh/node_modules/@deepseek-ai/dsh-headless/package.json`；该路径为调查证据，不写死到产品解析器 |
| 支持 --patch、--json、stdin 与 read_image | 包内 `dsh/lib/bin.js`、`dsh-headless/lib/startup.js`、`dsh-tool-fs/lib/index.js`；没有本批可用的 --model 旗标依据 |
| 默认模型来自 agent-default-model 的 provider/model | 包内 `dsh-agent-default-model/lib/index.js` 与 headless driver；CLI overlay 位于 profile/home patch 之后 |
| patch 对条目的 config 整体替换 | 包内 `dsh-app-boot/lib/index.js` 的 `applyEntryPatches`；覆盖必须包含本用途所需完整配置，不能假设深合并 |
| 内置 read-only 预设是 sandbox=read-only、approval=ask | 包内 `dsh-base/cordis.patch.yml`；视觉须明确配置 read-only/never，不能只切换默认预设名称 |
| JSON 终稿为 type=final、text=正文 | 包内 `dsh-headless/lib/json-stream-BA-F3lfb.js`；终稿不受上游普通事件的长度截断，失败路径也可能输出 final |
| 驱动按最后 turn 结果决定退出码 | 包内 `dsh-headless/lib/index.js`；只有 completed 正常退出 0，不能忽略退出码或把中间 text 当完成 |
| read_image 按实际路由校验 image 输入能力 | 工具失败或模型漏读后仍可能最终 exit 0；DSH 投影须有每张输入图的成功读取证据 |
| 生产视觉评审一次传入所有目标屏的参考图和截图 | `profiles/hmos-app/harness/visual-provider-review.ts` 的 `targets.flatMap(t => [t.refAbs, t.shotAbs])`；不能以单张图可读证明整批图始终保留 |
| image-offload 会将超预算图片永久替换为文字并重试，compaction-basic 默认自动摘要较早历史 | 包内 `dsh-base/cordis.patch.yml`、`dsh-compaction-image-offload`、`dsh-compaction-basic`；这些图像丢失不进入 headless JSON 投影且调用仍可能 exit 0，视觉 patch 必须关闭两种自动降级 |

尚待 T0 证明：固定 patch 与真实保存配置的组合、headless 可见的目标路由、实际权限、最终工具面，以及读取真实图像的正常路径。DSH 工具注册支持运行时限制 API，但已查配置没有通用工具白名单开关；不得未经验证假定禁用几个条目就覆盖全部工具。

## 3. T0：只读边界与模型组合验证

### 3.1 输入、隔离和记录

复用生产 `resolveHeadlessBinary` 解析真实桌面 dsh；记录解析来源、路径、版本。视觉和开发实测项目均放在 Maison 仓库工作树之外，各自执行 `git init`，不继承父仓库状态；探针脚本和报告放在测试项目之外。项目内放置已知内容的哨兵文件、一张本地生成的随机图，以及从仓内已有或另行提供的真实截图夹具复制的图片；图片内容与预期答案不泄漏到提示词或文件名。不得为取图访问宿主或手机。

使用真实 DSH_HOME 复用已配置认证。Maison 只可比较相关配置/凭据文件的前后哈希。视觉目标可用任一对 headless 可见且已配置的图像路由，优先选非默认图像路由；只有默认 `deepseek-flash` 时也可完成 T0/H1。覆盖顺序由调用级临时 overlay 制造，用户持久默认值保持原样。

模型路由取自已有明确标识或仅含 provider/model/模态的非秘密元数据，不 dump 全配置、环境或凭据。读取日志前，在脚本内遮盖实际环境秘密及 sk- 形式值，再输出必要片段。记录实际调用、退出码、权限、路由、工具名称、图片结果和文件变化；模型口头自报不能作为路由或权限证据。

### 3.2 先验证配置与边界，再调用模型

| 验证项 | 方法 | T0 通过标准 |
|---|---|---|
| 桌面入口与配置契约 | 复核本机版本/参数及源码；经生产 binary resolver 和统一 invoke 构造探针 | 使用实际桌面入口，不猜 --model/权限旗标，不用 npm 版替代 |
| 路由可见性与覆盖顺序 | 在本次调用中先加载真实模型来源，再加临时 overlay，把默认模型设为与目标不同的可解析模型（可用纯文本 `deepseek-v4-pro`）；最后的视觉 overlay 应用已冻结的目标图像路由。检视生效配置和原生请求元数据，仅向最终目标发送看图请求 | 记录前一 overlay 的不同模型与最终请求的 provider、完整 model 值；后者须等于指定图像路由。即便目标恰是用户默认 `deepseek-flash`，也能据此排除“碰巧用了默认值”。 |
| 有效权限 | 父进程故意携带相反权限值及大小写变体；会话元数据读出 sandbox/approval | 最终恰为 read-only/never；不因父环境或保存的 full-access 值扩大权限 |
| 工具集合 | 无模型或低成本装配探针列出最终模型可用工具；核查 write/edit、bash/pwsh、PTC、子 agent/workflow、插件管理及实际启用的 MCP/扩展入口 | 只保留必要读取能力，read_image 可用；任何已启用的可写/执行入口必须被实际禁用或有已验证的只读约束 |
| 图片保留与上下文隔离 | 无模型装配核对 `image-offload.disabled=true`、`compaction-basic.config.auto=false`，以及 agent-instructions、skill-filesystem、tool-skill 均 disabled；从实际路由元数据/配置记录图片数量、字节等已声明上限，不通过试错调用模型测限 | 组合可启动且各项实际生效，不自动将已读图片替换或摘要为文字；上限无明确值时标注未知及来源，不编造数值 |
| 写入边界 | 在隔离工程测试现有文件改写、新文件写入，以及已发现的旁路；优先直接调用工具测试而非消耗模型 | 操作被拒，文件清单及内容哈希不变。git status 仅作补充，不能独自证明未写入 |
| 看图正常路径 | 小型真实调用同时读取随机图与真实截图，输出可核对的图中事实 | 路由/权限符合预期，实际读图成功，答案与图像一致，退出 0，完整最终信封可解析 |
| 用户状态 | 对相关配置及凭据比较前后哈希 | 不改默认配置和凭据；DSH 正常会话/附件/日志写入可如实记录，不能把“项目只读”说成“进程零落盘” |

T0 探针允许使用开发期临时配置/观察脚本来验证组合，经既有 `invokeAgentHeadless` 执行；这些不构成生产插件或第二套执行器。视觉探针与正式 `invokeVisualProvider` 一致，不传 containment，走非 guardian 路径；Windows 开发调用按原路径使用 guardian，不为视觉新增 containment 接线。只观察必要非秘密元数据，不绕过 DSH 的秘密环境过滤。

### 3.3 T0 出口

通过后固定：已验证版本、路由格式和已声明图片上限、只读 patch 必需条目及关闭项的生效证据、最终工具集合、认证前提和 JSON 样本，供 T1/T2 消费。真实路由未声明 image、认证不可用或安装版本能力不符时记录原始原因，不自动改选模型或将其视为视觉通过；仍可推进不依赖该能力的离线工作。

发现已启用的可写入口时，先在现有配置能力内收敛。若完成只读保证必须新增自有 DSH 插件、另造 OS 沙箱、重建用户 profile 或改变用户默认配置，则本最小方案尚未成立，应报告具体证据并修订方案后再实施这些新增范围。不得通过提示词承诺“不要写文件”、静默忽略扩展工具或降低验收来登记支持。

不承诺任意未来插件天然只读；但实际支持配置中已加载的工具不能被排除在验证之外。T0 不能只用删光用户配置的替代环境验证后声称真实配置可用。

## 4. 最小实现设计

### 4.1 复用 8f2c6b91 的模型绑定，只补视觉入口

2026-11-06 只读核对了 8f2c6b91 的未提交实现。实施前在其提交上复核下列符号、行号和参数顺序，记录实际提交号；并行修订 plan 期间由原会话维护这些代码。

| 当前接线 | 本计划如何消费 |
|---|---|
| `harness/scripts/utils/types.ts:26` 定义、`adapter-model.ts:12` 导出 `adapterModelBinding`；`ProviderRef` 已可携带 provider、model、reasoning_effort、config_source、route_identity | 沿现有视觉身份来源、冻结和恢复使用已授权的视觉路由。provider 与完整原生 model-id 分开传递，保留 model-id 自带的斜杠；视觉选择沿 `goal-manifest-cli.ts::resolveVisualProviderCliSelection` 及其公共冻结链取得来源与路由身份。 |
| `visual-provider-invoke.ts:141` 已从视觉 provider 生成 `plan.modelBinding`；`agent-invoke.ts` 解析并校验该绑定，注入本次 `MAISON_GOAL_MODEL_PIN` | DSH 视觉分支继承同一 base 和 invoke。模型身份、来源 patch、漂移校验与请求身份观察沿公共链，按实际视觉调用验证。 |
| `agent-invoke.ts:725` 的 DSH 开发 argv 先加载模型来源 patch，再加载固定 patch；`agents/deepseek-harness/headless-patch.yaml` 的 `agent-default-model` 从公共 pin 取 provider/value/reasoning_effort，但该文件也设置 danger-full-access | 视觉沿用来源层和同一取值方式，最后加载 §4.2 的只读 patch。开发用全权限 patch 不进入视觉 argv。 |

两个需要在 8f2c 提交后复核的差额直接影响 H1。当前 `adapter-model.ts::dshSourceMetadata` 与 `verifyDshModelConfig` 的最终路由对照只查 `llm-pi-ai`；默认 `deepseek-flash` 可以来自内置 `llm-deepseek`。若届时仍缺这一路径，在同一来源读取与最终配置核对中识别 DSH 原生声明，使用现有 `freezeModelPin`、route_identity 和实际请求身份校验。只配置默认图像路由是受支持的验收场景，不能要求用户再配置非默认图像模型，也不能为内置路由跳过身份核实。离线覆盖默认内置路由和已有配置路由；桌面 H1 任选其一。

`verifyDshModelConfig` 当前还固定检查全权限预设。按 §4.3 让同一公共预检按用途核对预期权限，保留既有模型和来源核对。T0 在隔离项目若遇这两项已知缺口，先落实 §4.1/§4.3 中启动该探针所需的最小共享接线，再走原入口实测；付费调用前预检必须成立。

当前视觉声明的 `model_replay` 仍强制单个旗标，`readonly_invoke` 也尚无 DSH 分支。若提交后的代码仍有此限制，只为 DSH 只读启动组合允许沿用 `modelBinding` 而省略模型旗标，保留其它组合的原校验。schema/catalog 的改动只承载确实缺少的只读启动和输出机制及上述条件兼容。删除原拟 `provider_model_config` 回放枚举、按首个斜杠另拆路由和专用环境变量协议。

### 4.2 固定视觉 patch 与调用隔离

使用固定的 `agents/deepseek-harness/visual-readonly-patch.yaml`。模型条目消费 §4.1 公共 pin，另按 T0 的实际工具面设置 read-only/never、认证和工具限制。路由值作为数据传递，运行时不生成可执行表达式或改写持久配置。

视觉 argv 沿用 `dsh --profile headless --patch <已绑定的模型来源> --patch <视觉只读 patch> --json`，T0 的对照 overlay 插在最终只读 patch 之前且只用于探针。launcher 参数、stdin prompt 与项目 cwd 沿现有契约。

patch 按整体 config 替换语义写出完整必要配置。工具模式显式选择 native，关闭已验证的不必要写入/执行入口；认证只由 DSH 自己解析。调用专用路由值须覆盖父环境同名/大小写变体，各次调用使用独立环境对象。

视觉 patch 必须包含以下关闭项，并由 T0 核对组合可启动和实际生效：

```yaml
- id: image-offload
  disabled: true
- id: compaction-basic
  config:
    auto: false
- id: agent-instructions
  disabled: true
- id: skill-filesystem
  disabled: true
- id: tool-skill
  disabled: true
```

前两项防止一次多图评审在模型调用内静默丢图；图片超预算或上下文溢出应使本轮失败，经既有 unavailable/invalid 出口处理，不自动改成文字继续得出视觉结论。后三项隔离工程入口指令和技能加载，对齐 Claude 视觉调用的 safe-mode 目的；不关闭开发调用中的对应能力。

固定 patch + 环境表达式是待 T0 验证的首选；若不成立，不自动扩大为临时配置管理系统或用户配置迁移。

### 4.3 公共启动权限收编

由 DSH 视觉只读启动分支确定一次权限意图。复用已有调用选项 `AgentInvokeOptions.readonlyInvocation` 与视觉分支身份，限于已接通只读 patch 的 DSH 视觉用途；若需随 plan 转交，仅传递该意图，避免调用方各设一个开关。其它职责仍遵循各自原有权限契约。

同一意图同时用于 `agent-invoke.ts` 的 `--dump-config` 预检环境、`adapter-model.ts::verifyDshModelConfig` 的权限期望和实际 spawn 环境。三处使用同一套有效 argv、路由绑定和子环境选择。开发路径继续核对原 `danger-full-access` 预设；视觉核对最终有效预设的 sandbox=read-only、approval=never，并在最终子环境设置唯一的 `DSH_PERMISSION_MODE=read-only`。父环境及 extraEnv 的相反值、大小写变体不得覆盖。视觉 patch 缺失或权限不符，沿现有预检失败出口在模型请求前停止。仅在确有原生只读约束的视觉调用上如实报告权限事实。

guardian 与普通 spawn 共用现有环境合成和信任锚清洗；开发及其它 adapter 的权限验证沿用原契约。

### 4.4 输出、读图失败与结果校验

终稿优先复用 `agent-invoke.ts::readInvokeFinalText` 及 `codex-terminal-events.ts::extractProviderFinalText` 已有的 DSH final 投影；视觉侧补正文有效性和逐图成功读取。若共享投影在最后一条 final 损坏时仍返回较早正文，沿既有投影补该差额并覆盖开发兼容性。逐图核对需要原始事件，沿本调用的既有 stdout 原件读取。

传输失败继续由既有 `invokeVisualProvider` 处理。DSH 不新增 completion 豁免或 terminal scanner；正常终态只依赖退出码 0 和最后一条 `type=final` 的完整、非空 `text`，不从事件流重新计算 turn_end。最后 final 为空或残缺时不能回取更早的 final；中间 text/thinking、工具正文或模型自己写出的 PASS 不代替最终信封。退出码沿 DSH“最后一轮 completed 才为 0”的契约，不重复维护一套回合完成判据。

DSH 投影以逐图成功读取为采信条件：每张输入图须在本次事件流中，由 read_image 的 `tool_call.callId`/路径与对应 `tool_result.status=completed` 配对得到成功证据。复用 `resolveInputProvenance` 的 `path.resolve(projectRoot, …)` 路径归一口径；DSH 比较时 Windows 再统一大小写，其他平台保持大小写语义。缺少任一图片的成功证据即 invalid，不能用 exit 0 或格式正确的正文洗白；同图先失败后成功仍可满足条件，无关工具错误不全局升级为失败。不再维护“失败尚未恢复”的反向状态。规则仅作用于 DSH 投影，不改变其他 provider 的 unverified 披露与受理规则；既有格式修复调用传入 `imagePaths=[]` 时无需读图证据。

`agent-invoke` 落日志时仅保留 64 KiB 字符尾部，DSH final 本身可大于该值。投影优先复用本调用已有完整 `agent-events.jsonl`；无落盘时使用既有完整内存 stdout。不得从截断片段拼造成功结果，不新增第二份输出日志或独立采集生命周期。离线覆盖长 final 和尾部损坏。

取得正文后继续使用既有 JSON 载荷、身份回显、图片哈希、逐屏 schema 与 workspace 变化检查。不改视觉失败后的阶段处置/能力策略，不新增停机原因；`input_provenance` 未具备解析证据时如实 unverified。本批不顺带承诺精确 usage 或主开发结构化工具事件能力。

## 5. 改动落点与新增机制准入

| 落点 | 必要范围 |
|---|---|
| `agents/deepseek-harness/visual-readonly-patch.yaml` | 固定视觉模型输入、只读权限和经验证的工具限制；复用保存认证 |
| `agents/deepseek-harness/adapter.yaml` | 最终登记视觉机制和适用前提；保留开发能力及未支持范围 |
| `agents/adapter-schema.yaml`、`harness/scripts/utils/adapter-catalog.ts` | 仅在仍有缺口时接 §4.1 的 DSH 声明兼容、只读启动和终稿机制；模型回放沿公共绑定 |
| `harness/scripts/utils/agent-invoke.ts`、`adapter-model.ts` | 同一视觉意图贯穿预检环境、最终权限核对和实际 spawn；公共来源读取与最终配置对照按需补内置路由，最终正文复用已有 reader |
| `harness/scripts/utils/visual-provider-invoke.ts` | 复用 base.modelBinding，补 DSH 只读 argv、最终正文及逐图成功读取投影 |
| 既有 visual-provider、deepseek-harness-adapter、agent-containment、headless-full-permission 等 suite | 只调整受影响契约并补必要反例；需要新测试文件时接既有 runner |
| DSH adapter notes、`agents/README.md`、`docs/operations/goal-mode-runbook.md` | 说明开发绑定与独立视觉绑定的来源、权限及已验证前提 |
| `openspec/specs/agent-adapters/spec.md` | T4 同步视觉 provider 条款中“第一批仅 claude/codex/opencode”的过期排他表述及 Enforcement 列表；加入本批 DSH 契约，其他 adapter 的资格仍由现行声明决定 |

ProviderRef/local/manifest/身份冻结的现有消费者默认不改；若为完成同一消费链必须调整，需先说明实际不兼容点并保持原契约，不借机增设 provider 字段。`goal-phase-runtime.ts`、交付结论/恢复模块及 `6fd6c8c1` 的实现不在本批改造范围；新代码应复用其现行入口。

| 新增或调整机制 | 具体场景 | 实际收益 |
|---|---|---|
| DSH 视觉入口消费公共模型绑定 | 视觉身份已冻结，但现有声明要求模型旗标 | 复用 8f2c 的绑定与实际请求核对，避免 DSH 默认值覆盖本次视觉选择 |
| 按用途选择权限及固定只读 patch | 同一 DSH 同时承担可写开发和只读视觉 | 视觉不能被公共全权限注入放大，开发不被错误降档 |
| DSH 视觉终稿投影及逐图成功读取判据 | final 与错误/中间输出并存，漏读或读图失败可能仍 exit 0 | 防止未读齐本轮图片或残缺内容进入视觉结论，复用原失败出口，仅约束 DSH |
| 关闭视觉调用的图片卸载、自动摘要和入口/技能加载 | 一次评审含全部目标图，自动降级会静默移除图片；工程指令/技能影响独立调用 | 保留整批图像供评审，超限诚实失败，并隔离开发上下文 |

不新增注册表、ledger、预算账本、视觉 canary、常态审批或模型 fallback；catalog 声明仍是支持资格唯一来源。

## 6. 验收标准与验证强度

### 6.1 离线回归

| 编号 | 必须覆盖的输入 | 通过标准 |
|---|---|---|
| A1 | 同一视觉绑定、含斜杠的完整 model-id、错误/缺失来源，以及较早 overlay 的不同默认模型 | 实际请求匹配冻结的视觉路由，错误沿公共校验处理；覆盖其它 provider 的旗标兼容 |
| A2 | 父环境和 extraEnv 含相反值及大小写变体；顺序运行开发和视觉；视觉 patch 缺失/未生效 | 正确视觉配置通过 dump-config 并按 read-only/never 启动；开发仍通过原全权限断言，权限被降级时预检失败；错误视觉配置在付费前 skipped，模型请求数为零；各用途路由和环境隔离 |
| A3 | exit 0 + 完整最后 final、非零退出仍有 final、仅中间 text、缺 final、最后 final 为空/残缺、长 final；无 turn_end 但其余条件满足 | 终态仅依赖退出码和最后 final，不要求 turn_end，也不因日志尾部截断误取旧结果；图像条件另按 A4 判断 |
| A4 | 逐图成功、漏一图、能力错误后 exit 0、失败后同图成功、相对/绝对路径与 Windows 大小写、无关工具错误、空图片列表格式修复 | 仅本次所有输入图都有配对成功证据才采信；缺图 invalid；恢复后成功有效，路径正确归一，不误伤无关错误及空图片列表 |
| A5 | 错误图片哈希/身份/逐屏载荷、工作区变化 | 继续由原校验链拒收；不以新解析器取代原校验 |
| A6 | 其他视觉 provider 与 DSH 开发调用 | 核实 8f2c 已接通的开发模型绑定、输出与权限，以及其它 provider 原有契约 |
| A7 | 解析固定视觉 patch 的关闭项 | 断言 image-offload.disabled=true、compaction-basic.config.auto=false，以及 agent-instructions、skill-filesystem、tool-skill 均 disabled；开发 patch 保持原行为 |

开发期按影响运行 typecheck、`npm run test:changed` 和相关目标验证。优先选择实际触及的视觉调用、DSH adapter、权限隔离和 catalog 套件，确认用例确实命中。普通 plan 收口在最终输入上执行 `npm run test:daily`，加上本节适用的专项及桌面验证；正式发布全量由发布门负责。

### 6.2 小型桌面实测

T0 用最少模型调用验证候选组合；实现后必须再经正式 `invokeVisualProvider` 入口验证，不能只复用手工 plan 探针冒充接线通过。以约三次模型调用安排整批证据：T0 一次；正式视觉入口一次；随后开发写入一次。共享同一批随机图与真实截图，图片上限只读核对不额外调用模型；失败/超时/残缺输出主要由离线夹具覆盖，不构造完整业务 Goal、并行模型探针或人为挂起。

| 编号 | 正式入口验证 | 通过标准 |
|---|---|---|
| H1 | 任选一个已配置、headless 可见的图像路由；有非默认图像路由时优先，否则可用默认 `deepseek-flash`。从正式视觉入口用该冻结身份读取随机图及真实截图 | 实际 request 的 provider/model 与目标一致，每张图有成功读取证据、答案正确、最终载荷通过原校验，用户持久配置哈希不变。覆盖顺序另由 T0 对照证明 |
| H3 | 仓库外两个隔离工程中，顺序执行一次视觉只读调用和一次开发写入调用 | 视觉走正式非 guardian 路径，实际 read-only/never，写入不可达或被拒；Windows 开发按原 guardian 路径成功写指定测试文件；路由/权限不串 |
| H4 | 真实 DSH 配置及认证复用 | 目标路由可见；凭据由 DSH 解析，相关配置/凭据哈希不变，证据不含密钥 |

两种用途使用不同的仓库外隔离项目，各自 git init，顺序运行；避免父仓库状态和开发的合法写入污染视觉工作区前后对比。项目文件检查覆盖清单与内容，不只比较 git status。真实截图只用仓内/授权夹具，不访问宿主或手机。记录调用与失败事实；缺模型、凭据或图像时明确保留验收缺口，不自动安装、配置或重复消耗模型。

### 6.3 能力登记条件

T0 组合成立且 T1/T2 接线完成后，可加入最终 adapter 声明供 T3 正式入口验证；声明本身不表示通过。T4 completed 必须以 A1–A7、H1/H3/H4、最终 test:daily 及按影响补充的目标验证结果为依据，并同步 agent-adapters 规范，不能只看 dsh exit 0。仅静态/离线通过时保持未完成，不写成桌面视觉能力已验收。

## 7. 交付物与本次计划校验

后续实施交付：最小代码/配置/测试差异、运行说明、已验证版本和载体、实际路由与权限证据、图像校验及文件变化结果、测试命令/用例数/退出码、未成立项与偏离说明。报告只引用脱敏证据；其他会话改动及两份既有 plan 保持原样。正式发版、宿主回灌、手机与业务需求验收均不由本计划自动启动。

本次修订计划，所有 todo 保持 pending。校验限于 `node scripts/check-plan-version.mjs`、本文件内容/行尾检查及改动范围核对；不跑 typecheck、单测、全量测试或 DSH 模型调用。

## 实施记录（2026-11-06）

按已提交 `83038a6b` 重核复用点，当前 HEAD 已支持 builtin official/account 路由；只补视觉只读 patch、共享 readonlyInvocation 权限选择、catalog 条件兼容及最后 final/逐图成功证据消费，不另造模型绑定或执行生命周期。桌面实际为 0.2.2-rc.1。无模型装配证明最后 overlay、read-only/never 与四个读取工具；正式默认 deepseek-flash/high 路由真实读两图成功，结果身份、哈希、观察和随机颜色核对通过。新版 file_path 消费修正后复用同一真实 stdout 回放，没有重买看图。开发在另一个隔离工程经 Windows guardian 成功写入指定文件，仍为全权限。

visual-provider 88/88、DSH adapter 9/9 及 typecheck 通过。用户本轮禁止读取任何凭据，因此未做 H4 凭据前后哈希比较，明确保留该未验证项；未读取、复制凭据或修改默认配置。图片明确上限仍未知。本轮用户已授权 main 逐项提交；最终收口全量统一用 P4 的一次 npm test，不单跑 test:daily，t3/t4 保持 in_progress 等实际结果，未声称宿主交付。见[验收记录](../../harness/reports/remaining-3.1.0-dsh-acceptance.md)。

冻结输入的首轮 test:changed 实跑 874 组，5082 通过 / 1 失败；唯一红项证明把普通 DSH 质询的请求只读误当视觉原生只读会改变既有契约。已把原生只读意图只从视觉 HeadlessInvokePlan 传递，预检、环境和 spawn 消费同一意图，普通质询继续既有快照兜底。原失败用例不改断言，定向复验 1/1 通过；继续按影响验证。

同一消费链核对发现，通用 critic 回执只接受既有已登记解析器的 verified 主张；本批不扩该注册表。已移除额外的 verified 覆盖，input_provenance 继续完全交给既有解析链，DSH 如实 unverified；本调用逐图成功配对仍独立决定正文采信，避免制造下游降级告警。

### P4 统一验收记录（2026-11-06）

P4唯一一次根目录官方全量实际覆盖1350组（含全部424个正式扩展组），6016通过/24失败、输入稳定。24条原红项完成定性、局部修复及对应定向复验；最终test:changed为101组实跑357通过/0失败、826组复用，typecheck通过、首尾快照相同。原始full报告保持FAIL，不将补测拼成全量通过；本轮不重复整轮全量或单跑test:daily。 P4另在准确旧SID上完成真实DSH短续接，仅write、未读文件而正确回忆nonce，sentinel不变。t3因官方全量未绿保持in_progress；t4因用户禁止读取凭据、H4未验保持in_progress，不虚报凭据哈希隔离已验。本次只追加记录，不改计划正文。

### 检视返修（2026-11-06）

初始化选择类型和落盘改为完整ProviderRef，复用既有视觉CLI路由解析、冻结及身份预检，失败发生在写盘之前；从正式init写盘、重新读取、无人值守选择到调用预检的回归通过。DSH结构化stdout出现末尾未完成JSON记录时，不再采信此前final；补提前截断及逐图读取成功后再截断的反例，正常长终稿和完成事件保持原契约。视觉整组修前87通过/2失败、修后89/89通过。最终影响验证与CLI复核见总报告；没有新增真实看图调用、没有读取凭据，H4与正式完整绿证明仍未覆盖，t3/t4继续in_progress。
