# 项目请求与统一入口

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
| component-design | 请求、既有需求源/蓝图与缺口；现有 `check:component-blueprint`、view/draft/continue 路径 | 查看不写 canonical/revision/CU/run；局部设计到请求终点，完整设计到 CU readiness 后交还 |
| change-unit-progression | canonical CU、现有 Feature/run 事实；现有 CU 推进与 Goal prepare-run | 只选择或恢复已授权 CU，不代签部件完成 |
| component-closure | 蓝图、CU 完成证据与装配义务；`check:component-closure` | 校验部件终点；不是 CU 全绿即部件成功，只有明确写入请求才用 `--write` |
| goal-mode | 授权终点、规范化 P2 输入或已有 run；原有 `goal-runner` / `goal-phase-runtime` | 按冻结范围执行/恢复；不生成第二份阶段、豁免或完成真源 |

上述 harness 参数在 `framework/harness` 调用，global 阶段沿用 `_global` 报告，不要求 `--feature`。不带局部选择参数表示明确请求项目级校验；带选择参数只检查对应集合，未找到目标必须报告缺口。Graph 生成与 `--phase module-graph` 必须传同一组 module/package-path。显式配置文件不可读、损坏与可选知识缺失不同：前者修复来源，后者由实际职责决定是否需要补充。

来源解析复用当前 catalog/glossary/config/Graph parser 与 P1 的真实路径绑定原则，不另建快照或状态。global phase 使用 P2 resolver 的 request 终点，`requires` 所表达的资料依赖不自动启动资料生产阶段。非 phase CLI 继续用自己的 validator；项目结果不宣称 Feature completion。

## 主 Agent 与子 Skill

自然语言由主 Agent 按根入口的正式性判据解释：判类先答两问（本轮**范围** / **验收语义**），并**先查已有依据**（既有 acceptance、蓝图、catalog 与约束知识）；查到即复用，查完仍缺才只就该缺口询问。**主 Agent 的前置责任**：把本次请求接入对应执行路径。同一交付单元的下游产出必须以**已具备的上游依据和有效范围**为输入——不得边补前置边提前施工，不得要求设计追认已写好的实现。**委派不豁免你**：子 Agent 的边界是它那个 Skill 的边界，不解除你自己的前置责任。已有有效输入与证据按规则复用，缺口交回责任方。需要编译或跑测试的校验经框架执行器，不裸调工具链。显式 Skill 只授权本次职责；查看、局部设计、完整设计分别到对应终点。只读请求不因存在可补资料而写盘。设计 Skill 返回 readiness/缺口；只有用户已授权完整实现，外层才沿既有 CU 入口创建或恢复真实 attended Goal，复用 P2 范围计算、P4 coding/review 与 P5 验证。

无 Feature 的局部 review/UT/testing 使用已交付的 [request CLI](request-harness.md)，结果隔离在显式报告目录，不能伪造 Feature 或借用活跃 Feature 证据；**落笔写测试之前先跑 `--prepare-request` 确认落点与载体**。完整实现根据实际义务安排验证，未知责任保留 unresolved，不因输入可解析就宣称验收通过。

完整交付按依赖顺序发生：设计交接（admitted blueprint + ready CU）是范围候选的输入；**`--prepare-scope` 只生成候选、不冻结范围**，冻结发生在**首次阶段调用**（不建 run）或 run 出生时（建 run）。完整交付的机器接线复用 [P2 输入协议](../concepts/skill-contracts.md)：已有 CU 对应 Feature 的 `feature.yaml.execution_scope` 只承载出生前请求与来源事实候选，**由 `goal-mode-entry --prepare-scope` 生成**——主 Agent 只提供四项输入（完成终点、请求结果、明确的请求动作 `--requested-phases`、影响判断及其来源路径），绑定与指纹一律由机器经同一份 `resolveCapabilityInputs` 计算，证据类义务由 resolver 从验收分层与 fidelity SSOT 派生。同输入重跑字节不变；候选被手改后重跑只报差异，须显式 `--overwrite` 才覆盖。随后有**两个载体**可选（权威优先级：本次关联的 run > feature 冻结记录）：① 交互完整交付可以**不建 run**——直接 `harness-runner --phase <p> --feature <f>` 逐阶段跑，首次调用由机器把范围冻结进 `<features_dir>/<feature>/execution-scope.json`（与 feature.yaml 并列，机器单 writer），之后每次只读并核对候选指纹，候选被改而未经修订即 BLOCKER；② 需要无人值守或 run 级预算/恢复时，1.2 workflow 下 `goal-mode-entry --prepare-run --run-mode attended` 以**转交时 feature 的有效范围**出生（不重算候选）并登记转交，再按返回的真实 run 身份 attach。不为已全部复用的空范围创建 run。旧 run 直接恢复，不重新读取候选；默认使用 obligation-driven 1.2；旧内置定义仅供兼容恢复。

无 run 的 spec 仍必须消费原始需求：`--prepare-scope --requirement-file <path>` 会把来源文件写入候选绑定，后续 harness 可从该来源恢复并核对漂移；inline 或旧候选不保存正文，运行 spec 时须再次传同文的 `--requirement` 或 `--requirement-file`。Goal 模式始终只认冻结 manifest，拒绝这两个覆盖参数。任何路径都不另存需求快照。

范围只决定责任与写入许可，不决定阶段能否读取源码。只做 review/UT 的候选无需虚构 implementation；入口会从冻结 contracts/CU 解析现存产品源码，并按 profile 单独识别测试目标。plan 新声明的待创建文件可以先不存在，coding/UT 完成后才由后继消费门禁要求其真实字节；禁止为了让入口变绿而预先创建空文件或手工补 target/binding。

阶段证据按同一冻结范围记录源码责任：coding 的合法源码产出会推进 plan Research 的旧观察，UT 的合法测试产出不会反向污染 coding/review；越过责任边界的改动仍使原责任阶段失效。重复运行 UT 时，覆盖结论未变则保留既有 `ac-coverage.json` 字节和 `generated_at`，避免仅因运行时刻生成新的 verifier subject。

恢复时，capability 的缺失来源若已携带链内 `upstream_producer`，既有 assess/回退事务直接返回该 owner，不让无权修复的下游原样重试；没有可解析 owner 的 absent 只如实列来源和补齐动作，不自动升级为 framework bug。仅 UT 自身返修时保留仍 fresh 的 plan/coding/review；产品、契约或用户明确要求重跑造成的失效仍按实际范围执行。无新输入、修复或外部状态变化时恢复原 run 的既有无进展结论，不以同输入 fresh run 绕开。

“继续”先读当前 active run、冻结 execution_scope 和 successor/revision，不重新选择流程。新请求使用 obligation-driven；旧 run 通过内部兼容定义恢复，旧公共跳板由 UPDATE 备份清理。真实授权、策展语义、预算和外部不可逆动作继续使用既有确认点；已有授权不重复询问。**用户已授权完整交付时，走完这条链到完成终点是主 Agent 自己的事**——不把正式闭环当收尾时可再问一次的可选项，仍须询问的只有既有确认点（真实授权、策展语义、预算、外部不可逆动作、设计缺口澄清）。init-next-steps 不授予任何后继执行权。

无人值守 detach 的 launcher 会在返回前做一次有界启动确认；调用方只消费同一 JSON 的 `startup`，不因 pid/目录存在宣称健康，也不另等下一次心跳。`alive_timeout` 保留活跃 child 并如实报告尚未就绪；早退保留 `detach.log` 原因。`--attach-created`、`--resume`、manifest 与 `--run-id` 必须解析为同一 run 身份，冲突在 parent fork 前拒绝。当前 terminal cooldown 仍为保守 5 分钟：现有 runtime 没有提供可证明恢复完成的 `blockingCleared` 生产事实，因此本批不缩短、不按 mtime 绕过；错误信息给出剩余秒数。
