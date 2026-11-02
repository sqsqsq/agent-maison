# 项目请求与统一入口

具备 design lens 的新正式完整交付（非 canonical CU、含 spec/plan 定义职责、无有效 run/冻结范围）从原始需求开始进入同一 Goal runtime。尚无 feature.yaml/蓝图/CU 时，prepare-run/fresh runner 出生受管初始设计段；它不伪造施工 Feature/scope、基线或阶段链。`--prepare-scope` 只投影当前入口，不为不存在的 CU 写平面候选。runtime 持续派发作者、真实独立质询、检查、原 CU consumer/readiness，再由 P2 选择/恢复正常 CU；不以打印步骤、作者正常退出或设计 ready 提前收尾。会话与后台在相同授权、能力、事实和控制边界下同处置，仅运输/呈现不同。仅设计、generic、单职责 request、普通维护和合法存量恢复保留原终点；已有蓝图/CU 下的 plan 映射补充仍归 plan。

入口 ID 和路径只查 [skills.index](../../skills/skills.index.yaml)，phase/checker 查活动 workflow。下表是职责说明，不是第二份路由或执行配置。项目动作使用现有 CLI 参数，不创建 invocation 文件、Feature、CU 或 Goal 来承载无关操作。

| Skill / global phase | 本次输入与原生入口 | 产出与停止点 |
|---|---|---|
| framework-init / init | 现有 config、安装版本、选中 adapters；`init-orchestrate.ts` | 只完成明确安装/更新/配置；UPDATE 保留无关知识，next-steps 是建议 |
| catalog-bootstrap / catalog | 请求模块、当前源码与已有 catalog；`harness-runner.ts --phase catalog --module <name>` | 合并该模块画像，保留其他条目；不继续 glossary/Graph |
| catalog-bootstrap / glossary | 请求词条、上下文、已有术语与 semantic owner；`--phase glossary --term <term>`（可按 `--module` 选择） | 合并选中词条；跨条目消歧仍校验，不要求整个 catalog 完整 |
| code-graph / module-graph | 模块源码、有效 catalog 或显式 package-path；`bootstrap-code-graph.ts --project-root <root> --module <name> [--package-path <path>]` | 只刷新该模块 derived、保留 nodes；仅策展请求进入策展确认，完成不启动 UT |
| docs（无独立 Skill） | 文档 inventory、请求路径及已登记 source；`--phase docs --path <inventory-path-or-directory>` | 校验选中文档存在、来源与 freshness；不创建 Feature 或补全部文档 |
| extension / extensions | 现有 manifest、动作及 bindings；`extension.ts --project-root <root> --action inspect\|init\|materialize\|verify` | 仅完成该动作；verify 使用现有 extensions checker，不安装 MCP/凭据、不改发布件源码 |
| conventions-bootstrap | 当前候选约定、来源和策展授权；现有 Skill staging/合并流程 | 本次约定策展；未授权语义规则不提升为组织规则 |
| component-catalog-bootstrap | 源码索引、部件卡与使用边界；`bootstrap:component-index` 及原有策展检查 | 本次索引/知识增量；不自动批准依赖关系 |
| component-design | 请求、既有需求源/蓝图与缺口；现有 `check:component-blueprint`、view/draft/continue 路径 | 查看不写 canonical/revision/CU/run；直接设计到请求终点或 CU readiness，完整交付 runtime 调用后按原授权继续 |
| change-unit-progression | canonical CU、现有 Feature/run 事实；现有 CU 推进与 Goal prepare-run | 只选择或恢复已授权 CU，不代签部件完成 |
| component-closure | 蓝图、CU 完成证据与装配义务；`check:component-closure` | 校验部件终点；不是 CU 全绿即部件成功，独立闭环请求写入需已有授权；完整交付由root经原机器writer正式record并重读校验 |
| goal-mode | 原始正式需求、规范化 P2 输入或已有 run；原有 `goal-runner` / `goal-phase-runtime` | 无 CU 时受管设计，准入后按真实范围执行/恢复；不生成第二份阶段、豁免或完成真源 |

上述 harness 参数在 `framework/harness` 调用，global 阶段沿用 `_global` 报告，不要求 `--feature`。不带局部选择参数表示明确请求项目级校验；带选择参数只检查对应集合，未找到目标必须报告缺口。Graph 生成与 `--phase module-graph` 必须传同一组 module/package-path。显式配置文件不可读、损坏与可选知识缺失不同：前者修复来源，后者由实际职责决定是否需要补充。

来源解析复用当前 catalog/glossary/config/Graph parser 与 P1 的真实路径绑定原则，不另建快照或状态。global phase 使用 P2 resolver 的 request 终点，`requires` 所表达的资料依赖不自动启动资料生产阶段。非 phase CLI 继续用自己的 validator；项目结果不宣称 Feature completion。

## 主 Agent 与子 Skill

自然语言由主 Agent 按根入口的正式性判据解释：判类先答两问（本轮**范围** / **验收语义**），并**先查已有依据**（既有 acceptance、蓝图、catalog 与约束知识）；仅对无法据证解决且影响交付的真实缺口沿原确认契约澄清。**主 Agent 的前置责任**：把本次请求接入对应执行路径。同一交付单元的下游产出必须以**已具备的上游依据和有效范围**为输入——不得边补前置边提前施工，不得要求设计追认已写好的实现。已有有效输入与证据按规则复用，缺口交回责任方。主 Agent 提供原请求、来源、影响输入与可信授权；正式完整交付的设计与后续推进由同一 runtime 负责，不在主会话临场手拼 CU/phase。直接显式 Skill 只授权本次职责，查看、局部设计与完整设计各止于本身终点；只读请求不因可补资料而落盘。需要编译或测试时经框架执行器。

**委派不豁免你**：子 Agent 的边界是它那个 Skill 的边界，不解除你自己的前置责任。读代码、看截图与查依据等准备可并行，依赖未满足时不得提前施工。恢复已有任务先接回原 active run、有效范围和仍有效证据，不因委派或新会话重新选择流程；局部 review/UT/testing 仍按下述请求终点执行，不借专项请求拆散正式交付义务。

无 Feature 的局部 review/UT/testing 先按请求终点使用对应 Skill 的共享方法：只审查、解释或设计用例直接交付结果，不要求 request/facts/报告；实际写/跑测试或要求 checker 校验报告时使用 [request CLI](request-harness.md)，结果隔离在显式报告目录，不能伪造 Feature 或借用活跃 Feature 证据；**落笔写测试之前先跑 `--prepare-request` 确认落点与载体**。完整实现根据实际义务安排验证，未知责任保留 unresolved，不因输入可解析就宣称验收通过。

完整交付按依赖顺序发生：原始正式请求先受管，runtime 完成初始设计/质询/准入与 CU readiness；真实 CU 的 admitted 设计才是施工范围候选输入。主 Agent 只提供原完成终点、请求结果、明确动作 `--requested-phases`、影响判断与来源；机器经同一 `resolveCapabilityInputs` 派生义务/绑定，CU 影响按各自真实事实核定，不机械套用 root 的全局布尔值。具备真实 CU 施工输入时，`--prepare-scope` 只生成候选、不冻结范围，不为不存在的 CU 写候选；正常 CU 的施工范围在 run 出生时冻结。会话由 `goal-mode-entry --prepare-run --run-mode attended` 创建/接回，再以 `--next` 领取、读取原件、执行并按返回的 `--report-result` 命令上报；无人值守沿 `goal-runner --detach`。全部可命令适配器共用 GoalPhaseRuntime；普通作者始终使用本工作单元专用上下文；原生会话失效时按当前事实重建并披露，必需独立 verifier/质询保持真实独立。旧无 run 有效范围正式转交，已有 active 优先恢复，不起并行 run；不为全复用空范围造施工 run，不新增无 run/manual_fallback 完整交付。默认 obligation-driven 1.2，旧定义只供恢复。

单独 spec/plan 设计止于原职责，需求文件沿既有来源绑定读取；无 Goal 的 CU 单阶段动笔前用 `prepare-blueprint-design --phase spec|plan` 只导出本阶段，已有内容和冲突保护不变，Goal 已准备的不重复调用。无 run 的只读检查与旧范围/完成读取保持兼容，不能据此签发新的 Feature 完成。Goal 只认冻结 manifest，阶段命令不以 `--requirement` 或 `--requirement-file` 覆盖它；不另存平行需求快照。

范围只决定责任与写入许可，不决定阶段能否读取源码。只做 review/UT 的候选无需虚构 implementation；入口会从冻结 contracts/CU 解析现存产品源码，并按 profile 单独识别测试目标。plan 新声明的待创建文件可以先不存在，coding/UT 完成后才由后继消费门禁要求其真实字节；禁止为了让入口变绿而预先创建空文件或手工补 target/binding。

阶段证据按同一冻结范围记录源码责任：coding 的合法源码产出会推进 plan Research 的旧观察，UT 的合法测试产出不会反向污染 coding/review；越过责任边界的改动仍使原责任阶段失效。重复运行 UT 时，覆盖结论未变则保留既有 `ac-coverage.json` 字节和 `generated_at`，避免仅因运行时刻生成新的 verifier subject。

恢复时，capability 的缺失来源若已携带链内 `upstream_producer`，既有 assess/回退事务直接返回该 owner，不让无权修复的下游原样重试；没有可解析 owner 的 absent 只如实列来源和补齐动作，不自动升级为 framework bug。仅 UT 自身返修时保留仍 fresh 的 plan/coding/review；产品、契约或用户明确要求重跑造成的失效仍按实际范围执行。无新输入、修复或外部状态变化时恢复原 run 的既有无进展结论，不以同输入 fresh run 绕开。在途修正仍用 `--revalidate` 做机械重验（它不签发完成）；**明确要求已完成 Feature 正式重新交付时**在同一 feature 上以 `goal-runner --supersede <完成 run>` 起后继：出生范围由框架按当前输入重派生、既往阶段证据经同一核验复用，只跑未覆盖义务的责任阶段，新完成落在后继 run 目录、旧完成原件保留；feature 载体（无 run 完成）没有 run 可 supersede，先追加范围修订再起新 run。改动已提交进仓库的，起后继时把基线重设为当前提交；未提交的沿用源 run 基线。测试用例一律由后继的 UT 阶段以新增测试文件或新增用例产出（同字节重写不算覆盖），框架不把基线里已有的测试算作本轮覆盖证据。

“继续”先读当前 active run、冻结 execution_scope 和 successor/revision，不重新选择流程。普通维护直接按请求范围完成，不跑 correction-init；恢复明确既有预期、未改变验收/契约且不需新设计决定的普通 bug 修复也属于维护；已完成 Feature 的此类维护不自动创建后继 run。新正式请求使用 obligation-driven；旧 run 通过内部兼容定义恢复，旧公共跳板由 UPDATE 备份清理。真实授权、策展语义、未获授权的限制调整和外部不可逆动作继续使用既有确认点；已有授权不重复询问。完整交付已授权就持续到原终点，真实授权/实质验收变化、秘密、不可逆动作、硬预算和明确禁止仍沿原边界。init-next-steps 不授予任何后继执行权。

无人值守 detach 的 launcher 会在返回前做一次有界启动确认；调用方只消费同一 JSON 的 `startup`，不因 pid/目录存在宣称健康，也不另等下一次心跳。`alive_timeout` 保留活跃 child 并如实报告尚未就绪；早退保留 `detach.log` 原因。`--attach-created`、`--resume`、manifest 与 `--run-id` 必须解析为同一 run 身份，冲突在 parent fork 前拒绝。当前 terminal cooldown 仍为保守 5 分钟：现有 runtime 没有提供可证明恢复完成的 `blockingCleared` 生产事实，因此本批不缩短、不按 mtime 绕过；错误信息给出剩余秒数。

新run无框架默认总调用、阶段重试/回退或总墙钟配额；旧budget/timeout仅历史读取，不提额续跑。用户明示截止使用 `--user-deadline-at` 的UTC绝对值，未完任务接回不重置；具体工具期限、取消、原生输出静默保护与owner/fence仍有效。

已授权完整交付的初始设计与设计修订由同一 runtime 交原设计职责推进，含草稿、真实独立质询、检查、发布与必要重绑；attended 由本次 `--authorize-autonomy` 传递可信原请求全权判断，detached 保留用户选择无人值守完整交付的既有授权来源。主 Agent 负责最初判类与输入/授权，不在运行中手拼 CU/phase；plan/coding 不就地扩权。未授权事项、实质目标/验收变化、真实秘密、不可逆外部动作、用户总预算及明确禁止仍按实际授权处理。

原请求的合法需求/来源、adapter、模型与视觉钉、fidelity、明确用户截止和真实授权传给正常CU run，不能用CU合成短文覆盖。delivery_origin只定位原请求；activity统计实际调用与活跃时间，不是额度。runChangeUnitProgression一次只提供当前ready-set事实步，完整原请求由同一root持续选择全部适用CU。root按原终点读取同一design/CU/component当前事实；全部CU完成不等于部件完成，正式component closure仍须原producer记录并重读校验，缺装配/独核原件保具体WAITING。P4真实联合宿主验收仍pending。
