---
name: HMOS 构建闭环补修 — 产物复用真实、执行同源与恢复收口
version: 3.1.0
overview: >-
  围绕宿主签名静默失败反馈，一次完成三项补修：消除旧包和错误构建维度复用假绿，
  收编探针与真实构建的启动解析和环境，移除构建失败的一刀切人工停止出口。
  复用现有 provider、报告、产物摘要和持续执行内核；保留正常增量构建与真实权限。
  不建设构建配方、daemon 环境状态、学习系统或新的请求入口，不操作真实宿主和设备。
todos:
  - id: t1-artifact-and-reuse
    content: 按 §3 修正主应用与 ohosTest 产物发现、配对验证及主应用复用；既有成功构建记录绑定当前包并实际核对 product/buildMode，覆盖正式 testing、即席安装和 UT，删除旧包兜底及未经检查的一致性宣称。
    status: completed
  - id: t2-invocation-and-environment
    content: 按 §4 收编探针与构建的启动解析、环境和 Windows 引用；仅主应用打包装机改用 no-daemon 并保留增量能力，UT 沿用现行策略；不改 Java 选择优先级，如实记录 JAVA_HOME、PATH 解析的 Java 与执行参数，删除虚假的 daemon 停止成功记录。
    status: completed
  - id: t3-recovery-and-feedback
    content: 按 §5 将可调查构建失败与签名验证缺口交回现有统一处置，清理自动归外部与交互 HARD STOP；保留真实外部等待和写界，反馈贯通原日志、产物及环境事实。
    status: completed
  - id: t4-contracts-and-guidance
    content: 按 §6 同步受影响 OpenSpec、HMOS 工具链文档及 coding/business-ut/device-testing 指引，修正过时测试预期，不改历史计划、request 已安装版本语义或扩展知识协议。
    status: completed
  - id: t5-integrated-acceptance
    content: 按 §7 完成生产调用链定向回归、每轮 test:changed、一次计划收口 npm test 及相关规范/计划校验；三项整体完成、统一验收交接，不设分项交付停点，不以隔离结果宣称真实宿主签名服务根因或发布完成。
    status: completed
---

# HMOS 构建闭环补修

## 1. 目标、依据与事实边界

本计划落实 2026-11-03 讨论收敛的三项范围：**产物与复用不假绿、执行事实同源、恢复归现有内核**。
优先实施产物修复，但三项一次完成、统一验收，不设中途交付或分项提交要求。

依据：

- 原始反馈：`temp/问题反馈/11-02/maison-feedback-hvigor-sign-2026-11-03.md`。报告对应
  `3.0.0 / 1d82b276` 发布件；当前开发窗口为根 `package.json.version = 3.1.0`。
- [现行架构](../../docs/architecture.md) 的 I1/I3/I5/I10：持续作者解题，工具产出事实，
  同一处置决定当前未完项；模式不改变权限和完成语义，局部故障不自动停止全部工作。
- [持续执行变更](../../openspec/changes/completion-driven-execution/design.md)：本计划接入已有
  工作单元作者及完成协调器，不恢复 phase 作者队列，不另建构建排障循环。
- [四条总原则](../../docs/overview.md#121-四条总设计原则)：以最小机制修复已证实问题，
  复用仍有效证据，验证与实际风险相称。

已核实的问题：

| 位置 | 当前问题与实际后果 |
|---|---|
| `providers/device-test-build.ts` | exit 0 后扫描仍可选中旧 signed，且有 `discovery.signedPath ?? reuseDecision.hapPath` 兜底；旧 signed 对应较新 unsigned 仅警告，可能安装旧代码 |
| `device-test-build-reuse.ts` | 仅凭源码/HAP 时间决定复用，未对照旧包的 buildMode；product 只是发现排序，却宣称 product/buildMode 一致 |
| `hvigor-runner.ts` / `hdc-runner.ts` | 主应用和 ohosTest 均有跨 product 扫描退路；UT 的 signed/unsigned 可以分别选中不同文件，不能直接拿来做配对验证 |
| `personal-setup-gate.ts` | 探针直接执行 wrapper，未复用真实构建的入口和环境；Windows 含空格路径的未正确引用已隔离复现失败 |
| `hvigor-runner.ts` / build provider | 有效旧 JAVA_HOME 与 PATH 首位 JBR 可能不同；stop-daemon 结果被丢弃却记录 `daemonStoppedBeforeBuild: true` |
| `coding-host-rules.ts` / UT 指引 | 环境矛盾重跑后直接引导外部处置、签名缺口交互 HARD STOP，未先按实际写权与可修性交共同内核处理 |

现有能力必须保留：即席已有 `--install-current-build` 并复用同一 build/install provider；
request testing 运行手机已装版本，不在本批自动加入打包装机。正式 testing 原本已经检查
signed 缺失；本批修复其旧包漏洞和诊断断流，不把现状描述成完全没有门禁。

报告所示宿主签名脚本未传播失败可以解释 Hvigor 假成功；400 是否由旧 daemon 或凭据环境
差异造成仍是推测。此次修复不得依赖该假说，不把更换 Java 后一次成功写成确定根因。

## 2. 范围与授权

实施范围为 Maison 开发仓的相关 HMOS provider、共享执行接线、现行指引、规格及定向测试。
测试用隔离工程与可控进程，不读取真实凭据、不联系签名服务、不安装真实设备应用。
不修改真实宿主 `signature/sign.js`、`hvigorfile.ts`、签名配置或 `framework/` 发布件。

宿主脚本确有缺陷时，反馈需指出位置、原因和所需修复；是否可写由当前工作单元实际授权决定。
在授权内可继续修复，越出写域则走现有责任/范围修订；不按文件类别自动授权，也不一律重新问用户。
已有授权的凭据通道可以正常使用，缺少凭据或权限不得猜测、索取秘密输出或自行创建签名身份。

明确不做：

- 按次传参 CLI、新的 request build/install 接线、任意 shell/非 Hvigor 构建入口及构建配方协议。
- daemon 环境摘要登记、后台 daemon 管理器、新恢复状态机、错误注册表或学习轮次/预算。
- Java 版本/选择优先级调整、统一覆盖 JAVA_HOME 与 PATH、扩大 UT 出包的 no-daemon 使用范围。
- 构建知识沉淀、extension manifest/knowledge 写入、conventions 更新、私有记忆或场外状态。
- 重写 Hvigor、自定义签名协议适配、全宿主形态承诺、全量缓存清空、跨 Feature 构建记录搜索。
- 专门为产物属性检查新增模型核验会话；确定性检查由工具完成。
- 发版、打包、提交和真实宿主/设备操作；这些不是本计划实施的自动授权。

## 3. 产物与复用契约

### 3.1 构建结果与产物结果分开

保留 `isHvigorBuildSuccessful` 的进程级职责：执行完成、未超时、退出码与所需成功标记。
不恢复“日志出现 ERROR 就失败”的旧误判。需安装的构建在此之外检查产物；有效产物不能
覆盖非零退出/超时，进程成功也不能覆盖产物缺失、陈旧或目标错误。

coding 纯编译与 HAR 等不新增必须存在 signed HAP 的要求。所有缺口沿已有结果/诊断表达，
不新增独立完成算法。`check-testing`、即席安装和 UT 安装前消费同一适用产物结论。
未通过产物验证的候选只保留在诊断中，不作为可安装路径下传。

### 3.2 目标归属与配对

1. 生产调用一次解析并传递明确 product；主应用与 ohosTest 安装候选必须属于该 product。
   不允许所选 product 无产物时回退其他 product。保留诊断枚举能力，但枚举不是采用依据。
2. 依据现有工程配置、目录解析与夹具核清 product 和 target 层。支持已存在的
   `build/<product>/outputs/default`、`outputs/<target>` 与 UT `outputs/ohosTest`；
   不要求所有目录名都等于 product，不通过扩散扫描猜测未知布局。
3. 对实际采用的 signed，在同模块、同输出目录按同 basename 找对应 unsigned。
   `discoverOhosTestArtifacts` 中任意找到的 unsigned 可用于缺包诊断，不得冒充已选 signed 的输入。
4. signed 早于对应 unsigned：不采用，说明配对路径和时间，反馈“签名产物陈旧/未更新”；
   不据此猜测签名服务根因。signed 缺失：目标产物缺失。
5. unsigned 配对缺失、文件不可读或 stat 失败：说明“缺少配对验证依据/读取失败”，
   本项不能 PASS，不等价于“签名失败”或“需要人工处理”。由 §5 决定后续动作。
6. signed 不早于对应 unsigned：本项未发现陈旧；仍须满足进程、目标与复用条件。
   这是陈旧检查，不声称仅凭 mtime 证明源码内容与签名因果关系。

不要求 signed 晚于本次构建启动时间。源码 mtime 变化只意味着需重新验证；内容未变或变更
不影响目标时，Hvigor 可以合法 UP-TO-DATE。两个包都旧而目标、执行和配对检查成立时应通过。

### 3.3 复用必须绑定当前包和构建维度

复用只读当前调用对应报告目录中的既有 `device-test-build.result.json`，在覆盖它之前读取。
复用依据需同时满足：

- 原记录来自一次可采用的成功构建/有效复用，且记录的 product/buildMode 与本次实际请求一致；
- 原记录路径对应当前候选，且内容摘要与磁盘文件一致；复用现有
  `build-fingerprint.ts::computeHapSha256Full`，仅在原结果文件中补必要字段，不另建 manifest；
- 既有源码新鲜度条件及 §3.2 的当前产物检查均通过。

旧记录缺少必要字段、没有记录、摘要不符、路径/维度不符、读取失败时，均视为**不能直接复用**，
执行正常构建。不给旧记录补猜测值，不跨 Feature 扫描或复制记录，不以该缓存缺口直接停止任务。
用户在 IDE 中覆盖同一路径的包后，旧 debug 记录不得为新的 release 包提供复用证明。

构建后重新发现并验证产物，删除 `?? reuseDecision.hapPath` 等退回旧路径的逻辑；
通过后才记录可供后续复用的产物与实际构建维度。失败或验证缺口不能写成可复用成功记录。
复用成功时保留原有效事实，不能靠本次请求参数重标一个未经验证的旧包。

修正“product/buildMode 一致”等理由，只描述实际检查。无跨 Feature 记录会增加一次 Hvigor
调用，允许由其增量构建吸收；本批不新增全局缓存。该记录不是全工程输入完备性或防篡改证明，
不顺带扩成构建依赖图系统。

### 3.4 消费链

主应用：`runDeviceTestAppBuild` → 正式 `check-testing` / `installCurrentBuildForAdhoc`
→ 既有安装 provider。共享修复不得仅在正式 gate 增加判断而放过即席路径。

UT：`runHvigorBuild` / `runHvigorTest` → `discoverOhosTestArtifacts` / `runOnDeviceUt`。
检查其安装前产物结论及同调用有效出包复用，不将主应用报告路径或 debug/release 套到
`buildMode=test` 的 UT 语义。保留无 signed 时的既有分层诊断，但不得跨 product 或错配文件放行。

## 4. 同源调用、Java 与 daemon

### 4.1 探针复用执行解析

`recordEnsureProbeBestEffort` 不再独立拼 wrapper 命令。复用真实构建已有的 spawn plan 解析、
有效环境构造和 Windows 参数引用；探针仍只运行 `--version`，不顺带构建、安装依赖或操作设备。
尊重已有显式 driver/入口配置，不强制所有宿主只用 Node；同一配置下探针和构建选择一致。
探针失败保留错误与调用事实，不能用旧 `cli_starts=false` 直接增加新的入口硬门禁。

继续区分 binary、CLI 可启动和实际构建能力；不把探针通过写成构建 verified。
保留既有配置变化、有效重探测、真实构建结果和过期处理，不新增解除令牌或状态。

### 4.2 有效环境

复用现有环境构造，保持 Node/Hvigor、SDK 和 Java 的选择优先级，不修改系统环境。
本批保留有效 JAVA_HOME 与前插 DevEco JBR 的现行行为；两者不一致时如实披露，不能
为追求一致而把报告宿主按 PATH 调用的 JBR 换成 JDK 8，也不能反向强制覆盖 JAVA_HOME。
Java 兼容性与优先级调整不属于本批；签名 400 的修复不以某一 Java 版本为前提。
复用现有信任锚环境剥离，不能为诊断恢复被剥离的内部材料。

元数据记录实际执行入口、cwd、参数、有效 SDK/JAVA_HOME、在本次子进程 PATH 下解析的
首个 Java 路径及解析来源、daemon 参数、退出/超时/启动失败和日志落点。JAVA_HOME 与
PATH 解析结果分别记录，不合并成一个含糊的“实际 Java”；解析不到时明确未知。
区分工具解析值与签名子进程的已观测执行，不凭路径存在宣称版本兼容；不打印整个环境、
凭据值或带秘密的签名参数。

### 4.3 仅主应用打包装机改用 no-daemon

主应用打包装机使用已有 `--no-daemon` 能力，覆盖正式和即席消费者。
UT 测试包生成与纯 compile 沿用现行 daemon 解析和已有恢复策略；已有 goal 上下文
求得 no-daemon 的行为也保持，不反向强制 UT 启用 daemon。本批无 UT daemon 环境过期
的实证，不扩大冷启动范围；UT 仍完整纳入 §3 的产物验证修复。

现有 `forceNoDaemon` 在参数装配中还会连带关闭 incremental，不能直接将其作为主应用
打包的默认而无意关闭增量。通过现有参数装配中的最小内部接线明确 daemon=false，
保留正常 parallel/incremental 选项；既有针对特定失败的重试策略另按原责任保留。
不新增公开 CLI 参数或配方协议。

去掉此链不再需要的 stop-daemon 前置动作与写死成功记录；仅当无其他调用者时清理死 helper。
如仍有必要停止动作，其结果必须真实表达。`--no-daemon` 记录为本次实际执行参数，
不声称观测了外部/旧 daemon 的环境，不为旧记录倒填“已停”。

## 5. 反馈与恢复归现有内核

可保留有明确依据的一次无 daemon 构建事务重试及既有确定性依赖恢复；重试未成功之后，
不能仅因错误类别叫“环境不一致”就宣告“不再启动 agent”。检查分类、blocking_class、
suggestion 和实际处置消费者要一并核对，不能只改提示文字而继续机械 wait。

通过现有 `readCurrentDispositionInput` / `resolveCurrentDisposition` 及责任解析表达：

| 实际事实 | 处理 |
|---|---|
| 当前作者有权调查/修复的构建配置、脚本、产物或实现问题 | 反馈同一作者，继续合法工作，不重新派阶段作者 |
| 信息不足、配对缺失或原因未明 | 保留验证缺口，提供具体调查对象；不签 PASS，不凭分类码断言外部条件 |
| 已确认缺凭据、账号权限、外部服务或必须扩大写域 | 沿现有授权/条件等待处理，不无限重试；独立工作继续 |
| checker/runtime 故障 | 框架验证缺口交维护方，宿主作者不改 framework；保全成果，补受影响检查 |

移除 UT 指引的交互 HARD STOP 与按模式禁止合法修复；保留禁止猜密码、造证书、编环境故事、
绕过设备门和写界的约束。无人值守不获得额外权限，也不新增构建重试次数/总时长配额。

失败反馈至少能看到：未满足的目标、已选维度、实际命令与有效环境选择、候选/配对路径、
相关错误片段和原日志路径、已尝试恢复及结果。缺包分支不能只留下“请先修复 build”。
继续保存 Hvigor stdout/stderr；宿主未转发的签名子进程输出如实说明不可见，不能伪造。
诊断器作为线索，不独立决定整体完成或把 400 强行解释成 JDK/daemon 根因。

## 6. 修改面与规范同步

| 修改面 | 本批责任 |
|---|---|
| `profiles/hmos-app/harness/hvigor-runner.ts`、`device-test-build-reuse.ts`、`providers/device-test-build.ts` | 目标产物、配对、复用、参数/环境及元数据 |
| `profiles/hmos-app/harness/hdc-runner.ts`、相关 UT 调用者 | ohosTest 同 product 配对及安装前检查、诊断传播 |
| `harness/scripts/check-testing.ts`、`utils/adhoc-repair-diagnosis.ts` | 消费共享产物结论，拒绝无有效路径安装，保留原用途 |
| `harness/scripts/utils/personal-setup-gate.ts`、profile `toolchain-probe.ts` | 探针调用同源及原能力事实语义 |
| profile `coding-host-rules.ts`、实际 disposition/责任消费者 | 清除错误自动外部归因，复用现有恢复 |
| coding/business-ut/device-testing 现行指引、`docs/profiles/hmos-app-harness-toolchain.md` | 同步入口、签名诊断、写权、复用及恢复说明 |
| 受影响 OpenSpec、profile/harness 定向测试 | 经仓内固定 CLI 维护对应变更/规格，删除与新行为冲突的旧预期 |

具体同步 `harness-gates`、`framework-local-config` 及本链实际涉及的恢复规范，按当前变更
归属维护，不复制现行 runtime 架构、不改历史 plan 正文。使用既有检查项承接产物要求，
不新增 BLOCKER id/停机原因来绕开既有责任；若字段需扩展，只补原报告必要事实。

新增验证的收益均对应 §1 事故/反例：陈旧检查防旧包装机、维度与内容绑定防错误变体复用、
配对未知防无法验证仍假绿。无需建立额外治理门禁。既有工作区的其它未提交修改不归本批接管。

## 7. 验收与交付

优先使用真实生产函数和可控 spawn 的隔离夹具；不以源码字符串断言替代产物采用、调用参数
或恢复结果检查，不为了验证时间戳等确定事实启动模型会话。

| 场景 | 必须观察的结果 |
|---|---|
| exit 0 + BUILD SUCCESSFUL，但新 unsigned 对应旧 signed | 正式 testing、即席和 UT 适用链拒绝采用/安装，保留原日志与配对诊断 |
| 只有 unsigned / 找不到 signed | 不退回构建前路径，报告目标产物缺失 |
| signed 存在但无对应 unsigned，或读取失败 | 配对依据未知，不默认 PASS、不直接定性签名服务失败或人工等待 |
| 正常增量；源码仅时间变化但内容不变 | 触发必要真实构建后允许 UP-TO-DATE 旧包，不要求产物晚于启动时间 |
| 所选 product 无包但其他 product 有包 | 不跨 product 采用；合法 outputs/default/target 与 ohosTest 布局不误伤 |
| 同输出目录存在其他 basename unsigned | 不错配；UT 多模块诊断不串包 |
| debug 记录被 release 请求使用 | 不直接复用，真实构建；报告不虚称维度一致 |
| IDE 覆盖同路径包、旧记录仍在 | 摘要不匹配触发构建；缺记录/旧记录字段不足同样回构建 |
| 当前记录、包、维度和源码条件均有效 | 可复用；不为报告重写重复执行构建 |
| 非零退出/超时但磁盘有包；非致命 ERROR 但完整成功 | 前者不能借包通过；后者不因 ERROR 文本单独失败 |
| Windows 含空格 DevEco 路径、合法 wrapper/Node 配置 | 探针与构建解析一致且可启动；错误路径保留真实失败 |
| 有效旧 JAVA_HOME / JBR 回退 | 保持现行选择，分别记录 JAVA_HOME 与子进程 PATH 解析的首个 Java；差异/未知如实表达，不改全局环境、不输出秘密 |
| 主应用打包装机 | 参数含 no-daemon，正常增量仍启用；不出现虚构的 daemonStoppedBeforeBuild |
| UT 出包与纯 compile 的 daemon 策略 | 现行配置、goal 上下文与已有恢复行为不变，不因本批统一强制冷启动；UT 产物检查仍生效 |
| 可修错误在局部重试后仍失败 | 同一处置交合法作者，未知不假绿；已确认外部条件、越权反例仍正确等待 |
| request testing / 纯 compile | 不自动替换手机已装版本；纯编译不新增 signed HAP 要求 |

开发每轮执行 `npm run test:changed` 并通过必选项；生产逻辑变更执行 typecheck 与目标测试，
复用同轮有效结果。三项及规范同步完成后执行一次 `npm test` 完整全量作为本 plan 收口；
运行 `node scripts/check-plan-version.mjs`、受影响 OpenSpec 的仓内校验及 `git diff --check`。
窄文案返修只核 diff/对应文档校验，不重复无新增信息的全量测试。

交付条件：frontmatter 全部 todo 按事实完成，目标反例和完整门禁通过；说明实际修改、
测试结果和限制。不得仅凭加了字段、改了提示或测试桩返回 PASS 宣称调用链已修复。
开发验收不等于发布或真实宿主交付：没有运行原签名服务/真机的事实必须披露。
后续真实宿主与设备观察沿既有联合验收安排，不为本批新增独立宿主试验工程、模型学习验收
或未获授权的设备动作；不得把开发夹具说成 400 根因已经查明。

## 实施记录（2026-11-06）

本批实现已于 `cf66a837` 提交。按现行 AGENTS.md，普通 plan 以 `npm run test:daily` 日常全集及本批必要验证收口。本批专项回归与 CLI 复核结果见[验收记录](../../harness/reports/58d7a3c2/acceptance.md)。测试治理提交 `240c75dd` 的候选在父提交 `886cbef5` 之上完成日常全集，918 组、5,352 通过、0 失败，受测输入包含本批实现。据此完成本 plan 验收。正式全量留在发布门执行。见[主干候选验收记录](../../harness/reports/6a2f8c91/main-candidate-acceptance.md)。
