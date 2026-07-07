# Maintainer Changelog (dev-only)

> 由 `npm run release:changelog` 从 `.cursor/plans/*.plan.md` 自动生成。消费者向变更见 `RELEASE-NOTES-v*.md` 与 `MIGRATION.md`。

Generated: 2026-07-07 · current window: `3.0.0`

## 3.0.0

- **android 工程适配** — 在 maison 3.0.0 窗口落地 Android 工程支持：新增 android-app profile（Gradle/AGP/JUnit 工具链）与一个全新的、与 profile 正交的「workspace 拓扑」维度（single_tree / binary_deps / source_overlay），与真实工程"自下而上 AAR 分层集成"的生产构建同构，不造平行构建体系。交付物 = 1 份 master .plan.md（version/deferred_to 均为 3.0.0）+ 4 个 OpenSpec change。 [0/6 completed]
  - `android_工程适配_5e3400c3.plan.md`
- **framework 轻量化重构 — 分档工作流与验证收敛** — > [0/10 completed]
  - `framework_轻量化重构_分档工作流与验证收敛_d4a7c1e8.plan.md`

## 2.4.0

- **P0-10 — await_human_visual_confirm 确认 UX（通用引导话术机器生成 + visual-confirm CLI）** — > [4/4 completed]
  - `P0-10_await确认UX_通用引导话术与visual-confirm-CLI_b6d3e9a2.plan.md`
- **P0-9 — visual 判定持久化（build 指纹绑定）+ goal await_human_visual_confirm 分类** — > [4/4 completed]
  - `P0-9_visual判定持久化_build指纹绑定与await-human分类_e7a91b3c.plan.md`
- **adapter 候选自动化** — 把 adapter 候选清单收敛为"磁盘 agents/ 目录"单一真相：独立纯函数枚举(接 frameworkRoot)+harness 侧 join，probeInitTaskPlan 输出 adapter_catalog [{value,label,portable}] 供 agent 原样渲染；catalog 损坏即 fail-loud(OrThrow→S1 非零退出)；去掉所有写死候选与静态 ADAPTER_NAMES；门禁用稳定锚点(非行号)只扫菜单口径段；双根发布检查锁死永不漂移。 [8/8 completed]
  - `adapter_候选自动化_48356d3e.plan.md`
- **chrys + opencode adapter 接入** — 为 chrys 与 opencode 各新建一等 agent adapter（agents/chrys/、agents/opencode/）。二者均为 external_runner，物化复用同一 shared .agents bundle（AGENTS.md + .agents/skills bridge + .agents/rules，与 generic 默认 bridge 字节一致、可幂等共存），唯一差异是 headless 命令：chrys=chrys run --task <file>、opencode=opencode run --dangerously-skip-permissions（stdin prompt）。在 goal-runner headless 链路把两者都接为结构化运行器。 [8/8 completed]
  - `chrys_adapter_接入_91f6f0c8.plan.md`
- **goal-mode-bounded-monitor** — 为 goal 模式新增 bounded monitor，把阶段进度从“用户问了才读状态”改成“主 agent 在当前活跃轮次内按统一事件流主动汇报 phase verdict / 终态 / 异常”，明确跨轮次唤醒属于宿主增强，并修正 progress 已完成阶段 duration 膨胀问题。 [6/6 completed]
  - `goal-mode-bounded-monitor.plan.md`
- **goal-mode-unattended-survival** — 根治 goal 模式"过夜任务静默死亡却显示运行中"的机制性缺陷。分四层补齐——真存活（宿主无关的存活语义 + 启动后存活自校验 + 实施前一次性"会话存活探针"背书 --detach 是否真活过 Cursor 会话）、诚实化（所有退出路径写终态事件 + liveness beacon + 绝对 dead-man 硬判，死了就是 DEAD 绝不粉饰成 RUNNING）、自愈看门狗（独立单例 supervisor，带防抖/限次/INTERRUPTED-vs-HALTED 区分的有界自动续跑；敌对宿主下退守 OS 调度任务）、跨轮通知（声明式拆成正交两条：会话内加速器 in_session_accelerator 与真·跨轮唤醒 cross_turn_wakeup，绝不依赖被 --detach 切走的 runner stdout；缺失即降级"回来时补报"，新增宿主零 bespoke 代码）。承接 goal-mode-bounded-monitor 明确划在范围外的"跨轮存活/唤醒"，并已纳入独立复核提出的裂缝 A–D 补强。 [7/13 completed]
  - `goal-mode-unattended-survival.plan.md`
- **goal-mode headless 闸门自解析** — 修复 goal-mode（无人值守）在 spec 等阶段被「人工逐行确认」闸门卡死的根因：为所有阶段内人工确认闸门定义 headless 自动解析+分级留痕策略（high 自动确认 / medium·low 标 DEFERRED-review），主防御用 adapter 无关的「无进展守卫」杜绝盲目重试空耗（chrys sentinel 仅作加速器），并顺带纠正 chrys invoke 的 unattended parity 背离。在研窗口 2.4.0，不动版本号。 [10/10 completed]
  - `goal-mode_headless_闸门自解析_d27479c3.plan.md`
- **goal-mode 多adapter自愈** — 修复 goal 模式在「已物化多个 adapter、但新 clone 缺 framework.local.json」工程下的缺陷。统一 Case A/B 走一条确定性写盘路径（neutral 命名 --select-adapter），补齐「运行身份」可靠 wiring，并在 SKILL 加「门控失败即 STOP 交回用户、严禁绕过 goal-runner / 严禁自由改码」硬约束。目标在研版本 2.4.0，不动版本号。 [5/5 completed]
  - `goal-mode_多adapter自愈_1bd33e51.plan.md`
- **goal-mode 超时预算 + API 断流 全盘根治 — spec 预算畸紧 + 超时误分类 + 超时丢弃将成阶段 + headless API 断流误分类** — > [6/6 completed]
  - `goal超时预算全盘根治_spec预算畸紧与超时误分类与超时丢弃_b8f36a12.plan.md`
- **宿主homepage漂移回灌 · testing设备门禁 / HMOS资源保真 / consumer防漂移门禁** — > [10/10 completed]
  - `homepage漂移回灌_testing设备门禁与hmos资源保真_43de34da.plan.md`
- **宿主homepage视觉保真round2 · 渲染缺陷枚举门禁 / 边缘哨兵(采集层) / 渲染忠实度校验 / asset真渲染** — > [8/8 completed]
  - `homepage视觉保真round2_缺陷枚举门禁与素材分型_0694cb1e.plan.md`
- **init S4 动态下一步** — S4 下一步 finalizeInitRunLog 统一落盘；deriveInitNextSteps(log,ctx?) Phase0 仅 failure_recovery；index=能力建议 SSOT；harness 合成 recovery；ctx 可空+MinContext。 [6/6 completed]
  - `init_s4_动态下一步_0e149097.plan.md`
- **maison testing 门禁加固** — 基于 bc-openCard 实践案例，加固 AgentMaison（在研窗口 2.4.0）的 testing 阶段门禁、goal-runner 完成裁决与 ArkUI 静态规则，杜绝「真机 trace 失败/超时但 goal-report 仍 COMPLETED」的假完成，并补齐 UI 入口覆盖与 visual 回环阻断。 [9/9 completed]
  - `maison_testing_门禁加固_700f51fc.plan.md`
- **P2 — Phase 内 checkpoint/resume：重阶段超时续跑而非整阶段重来** — > [3/3 completed]
  - `phase内checkpoint_resume_重阶段续跑_d7b1e4f2.plan.md`
- **全阶段门禁根治 — 裁决提取子串 bug + 跨阶段超时预算（P0+P1）** — > [4/4 completed]
  - `review超时根因_裁决提取子串bug与超时预算根治_c3f08a21.plan.md`
- **round6 P1 批 — 结构声明台账+一致性抓手(P1-4) / drift_allowlist 权限收紧(P1-5)** — > [7/7 completed]
  - `round6-P1批_结构声明台账与drift权限收紧_c9e2a7f4.plan.md`
- **round6 收尾批 — placement 第三 FP 模式修复(P0-1) / 确定性 FAIL 弃判治理(P0-2) / 宿主 nav 热修回收(P0-3)** — > [4/4 completed]
  - `round6收尾_placement第三FP与弃判治理与nav热修回收_9d4b7e21.plan.md`
- **round7 skills/文案批 — agent 写路径 features_dir 贯通（三通道分级）+ gitignore 动态化** — > [4/4 completed]
  - `round7_skills文案与gitignore_features-dir贯通_a9c4e7f1.plan.md`
- **round7 先行批 — 路径硬编码统一治理（harness 读写路径解析层；skills/gitignore 另批）** — > [4/4 completed]
  - `round7先行_路径硬编码统一治理_7c4e9f2a.plan.md`
- **全阶段卡死误判根治 — 依赖归因误报 + Stop hook 无逃生阀 + 弱模型空回复** — > [6/6 completed]
  - `全阶段卡死误判根治_依赖归因误报与stop逃生阀与弱模型空回复_e7d2b9a4.plan.md`
- **发布件提速 — ts-node 冗余类型检查根治 + 发布编排去重 + filter 短路（v2 已纳 review）** — > [7/8 completed]
  - `发布件提速_tsnode全量类型检查冗余根治与发布编排去重_a7c3e1f9.plan.md`
- **在线高保真对照** — 在 2.4.0 窗口（framework-only，不 bump 版本）为 maison 增加「在线高保真对照」能力。复用「视觉保真结构化加固」已落地的 source_ref/authoritative_refs/ref-elements/fidelity_target 地基。两刀切：第一刀（核心）定义宿主 MCP 获取契约 fetch_fidelity + fidelity.lock.yaml 快照格式 + 每屏物化本地参考图（接入点 authoritative-ref-images 读 lock 小改、下游真消费者 visual-diff-capture/asset-acquisition 零改动吃进）+ 离线校验/降级/版本号比对 refresh；第二刀（差异化）用结构化源（Figma 类 DOM/CSS）程序化推导 ref-elements.yaml 分母 + 语义色/文案比对，喂现有 capture-completeness。抓取是 spec 阶段 agent 显式动作（调宿主 MCP，令牌缓存在宿主侧），harness check 仍只读本地、离线确定。 [7/7 completed]
  - `在线高保真对照_60d53da3.plan.md`
- **编号 skill 彻底清扫** — 在 purge_everywhere 前提下清扫死编号路径/散文引用；保留运行时活 alias（profile-skill-assets.ts）；扫描器五 kind 含钉死的 bare/range 定义与误报排除；验收为护栏 + 广撒网 + 人工签收。 [4/4 completed]
  - `编号_skill_彻底清扫_5cfd4d43.plan.md`
- **视觉保真假PASS根治与截图态对齐** — > [9/9 completed]
  - `视觉保真假PASS根治与截图态对齐_b7e3c1a9.plan.md`
- **视觉保真管线升级** — 在 agent-maison 框架中插入一条结构化"视觉 IR / UI-DSL"中间产物，并补齐资产管线、coding 强制读图、确定性视觉 parity 门禁，把"截图→散文→盲写"的单向衰减链路，改造成"截图→可机读 UI-DSL→契约→对照实现→逐项核对"的工业级管线；并本期交付最小可用的"渲染→视觉 diff→回修"闭环（option A，复用 hmos-app 既有 Hylyre 截图能力，挂在 device-testing）。 [18/18 completed]
  - `视觉保真管线升级_7e367678.plan.md`
- **视觉保真结构化加固** — 在 agent-maison 2.4.0 窗口内，按"五环短板"重排优先级——把投入从 coding 门禁（第二强环）转向真正的根因：①捕获完整性（参考图→ui-spec 逐元素强制表态、以参考图侧枚举为分母的覆盖校验）与⑤反降级治理（fidelity_target 全链路 ratchet、P0 视觉元素 defer 须人类签字）。再补④验证闭环（双向 diff 残差达标、放水点收紧）与③素材供给（三级策略 + 素材需求清单，拒绝 AI 山寨）。coding 门禁瘦身为背板。命门是严重度：pixel_1to1 下关键视觉项必须 FAIL/BLOCKER，不得做成又一堆 WARN。全程 framework-only、不 bump 版本，并用 A/B/C 三分法诚实管理预期。 [6/6 completed]
  - `视觉保真结构化加固_f4aaf66d.plan.md`
- **视觉残差闭环（M3 多模态注入 + M4 设备渲染回环）** — 补齐「视觉保真管线升级」遗留的 M3/M4 两块真实执行能力——M3 把当前仅 sidecar+markdown 链接的图片注入升级为「按 adapter 能力分级的真多模态消费」（tool_read 读图取证 / native_attach 原生附件），杜绝把图当普通文本、并对 verifier 是否真看图留可核验证据；M4 把 device-testing Step 4.6 的「agent 手填 visual-diff.json」升级为「harness 复用 Hylyre 自动导航截图 + 生成报告骨架 + 可选半定量客观下限分」，让渲染→视觉 diff→回修闭环不再纯靠人工誊写。二者同属视觉残差闭合（生产侧渲染回环 + 消费侧多模态），合并为一个 plan、分两里程碑独立可交付。 [12/12 completed]
  - `视觉残差闭环_M3多模态注入_M4设备回环_9c4f2e1a.plan.md`
- **视觉裁判可信化 · 独立布局硬门禁(P1) / pixel_1to1 P0 人确认兜底(P1) / lightweight 不豁免(P1) / warn 收紧+可执行 must_fix(P1) / 屏身份越界门禁(P1) / goal-mode 熔断+预算分流(P1) / VL 逐元素 bbox 证据链(P2)** — > [8/8 completed]
  - `视觉裁判可信化_独立布局硬门禁与VL证据链与loop熔断_a3f1c920.plan.md`
- **首页UI保真 round5 · 素材整段化根治(P0-A 烤字门禁/P0-B 原子图标/P0-C 双渲染纪律) + 采集导航闭环(P1-A 导航采集/P1-B failureKind 分流补全/P1-C 报告诚实化)** — > [6/6 completed]
  - `首页UI保真round5_素材整段化根治与采集导航闭环_e5b1c2a0.plan.md`
- **首页UI保真round6 — bbox 坐标语义门禁(P0) / 裁剪产物验真(P0) / 授权≠验真拆分(P0) / spec 完整性外部对照(P0) / coding 文案白名单+parity 升门禁(P1) / review 视觉维度(P1) / device 回环断流归因+可执行must_fix(P1)** — > [10/10 completed]
  - `首页UI保真round6_bbox语义门禁与素材验真与门禁左移_f2d8c4a6.plan.md`
- **首页素材物化断桥根治 · 占位冒充门禁(B) / resource_integrity媒体绕过(F) / 采集新鲜度(E) / 物化桥(A) / visual_diff warn屏下限(C) / pixel_1to1兜底复核(D)** — > [7/7 completed]
  - `首页素材物化断桥根治_占位冒充门禁与warn屏下限_b4e9d1c7.plan.md`

## 2.3.0

- **code-graph-skill-entrypoints** — 把已落地的 Code Graph 生成/漂移能力以「项目级 Skill + harness module-graph 门禁」的形式对用户开放，仿照 catalog-bootstrap 的分层范式（公共层定流程/契约，hmos-app 私有层定 .ets 信号与策展 prompt），并顺带把 bootstrap 对 hmos provider 的硬编码解耦到 profile-host-loader。 [7/7 completed]
  - `code-graph-skill-entrypoints_a2caa5a3.plan.md`
- **coding 依赖自动安装** — 为 AgentMaison 框架补齐"工程依赖自动安装"能力：coding 阶段真实编译因依赖未安装失败时，harness 在同一次运行内自动调用 profile 声明的 ohpm 安装 provider 并重编译，仅当安装本身失败（内网 registry / 鉴权 / 网络）才回退给用户，兑现"AI 全包"的定位。 [8/8 completed]
  - `coding_依赖自动安装_4cb12eb0.plan.md`
- **DevEco P2 profile 契约与 hmosDevice skeleton** — 承接 DevEco 双文件机制 P1 收口后的架构债（2.3.0 窗口）：personal_prerequisites 从硬编码迁到 profile 契约 SSOT；project config 的 hmosDevice 段在 schema/template/defaults/backfill 层完成同步，并收紧 toolchain schema 禁止 devEcoStudio 回流。 [5/5 completed]
  - `deveco_p2_profile契约_7c4e2a91.plan.md`
- **DevEco 路径写错文件根因** — DevEco 写回 framework.config.json 是双文件配置模型机制断裂（init 写盘有守卫、运行时无错位检测、merge 仍回退读 project、门控只验 adapter 不验 capability 前置）。源头修复须字段归属子字段级 SSOT + 读路径 fail-closed + phase→capability→prerequisite 算法 + 迁移豁免门控；层 3 fail-closed 是硬约束，其余层否则仅为提示。 [11/11 completed]
  - `deveco_路径写错文件根因_2393d7b6.plan.md`
- **doc 新鲜度整改** — 本轮 init 清旧跳板已提交，doc_freshness 仅剩 2 条 MAJOR（`extensibility.md`←`agents/README.md`、`extension-protocol-v1.md`←`MIGRATION.md`）。计划先最小同步这两份文档清零 MAJOR，再梳理 inventory 覆盖缺口与长期待写项。 [3/3 completed]
  - `doc_新鲜度整改_fa8e8c31.plan.md`
- **goal-mode adapter 门禁与命令修复** — 修复 goal-mode 入口缺失的 adapter 选择门禁与 Cursor 无头命令错误（cursor agent --print），让 adapter 选择遵循"显式指定 > framework.local.json > 引导建立"，把"命令不存在/未配置/adapter 未物化"从跑一轮后 HALT 提前到 preflight BLOCKER；并修 Windows 下 shell:false spawn .cmd 垫片的坑。绑定在研版本 2.3.0。 [8/8 completed]
  - `goal-mode_adapter_门禁与命令修复_4ff3658c.plan.md`
- **goal-mode 重命名** — MVP——宿主入口 goal-orchestration→goal-mode（全 agent）+ feature 绑定证据目录 doc/features/<feature>/goal-runs/<run-id>/；收窄 gitignore 仅增 goal-runs pattern；NL 分流 goal 优先于 batch；2.3.0 未发布窗口内用 OpenSpec change delta 修订，archive 后落到活跃 spec（非仅改名）。 [7/7 completed]
  - `goal-mode_重命名_c0b0b42e.plan.md`
- **goal 任务进度可视化** — 为 AgentMaison goal-runner 增加可信的长任务进度可视化能力：以 append-only events.jsonl 为事实源，派生原子 progress snapshot，提供 watch/JSON/Markdown 三类读侧接口，并让 goal-mode Skill 与外层工具按稳定契约展示阶段、活性、预算、阻塞和最新活动，降低长时间无头执行时的“卡死感”。绑定当前在研版本 2.3.0。 [10/10 completed]
  - `goal-progress-visualization_6a1d9c3e.plan.md`
- **goal-runner close 挂起修复** — 修复 goal-runner 在 coding 等阶段「agent 已退出但 orchestrator 永久挂起」的根因——子进程等待只监听 close 事件，被某个继承了 cursor-agent stdio 管道并存活的进程无限阻塞。核心改为持有者无关的 exit 为准 + 有界 grace + 销毁读流强制 resolve；并补 resume 半完成恢复、lock 死 pid 同机快速接管、真实子进程回归测试。绑定在研版本 2.3.0（patch）。已于 2026-06-10 实施完成（cd harness && npm test 718/718 PASS）。 [8/8 completed]
  - `goal-runner_close_挂起修复_7440c57d.plan.md`
- **goal-runner 并发与预算修复** — 从根因（无头 agent 递归自起 goal-runner + 超时不杀进程树产生僵尸 + 锁粒度错误）切断 goal-runner 的 fork-bomb 式自繁殖，再叠加预算跨 resume 持久化、终态守卫、run-scoped 报告快照等纵深防御，杜绝重复并发与 token 失控。 [9/9 completed]
  - `goal-runner_并发与预算修复_bdac8ce2.plan.md`
- **goal verifier hook 串台收尾** — 本轮落地 hooks 串台 plan 暂缓的 Fix D：给 SubagentStop hook record-verifier-report.mjs 增加 MAISON_GOAL_HEADLESS 旁路，消除 goal 无头链下 verifier 报告/state 的目录污染、内容污染与跨会话新鲜度污染；明确把选项 3(env 精确定位)与已完成的并发/预算/挂起工作划在本轮范围之外。绑定在研版本 2.3.0(patch)。 [4/4 completed]
  - `goal_verifier_hook_串台收尾_e79e3773.plan.md`
- **Goal 模式 hooks 串台修复** — 修复 goal 模式下主 Claude Code 会话与 goal-runner 拉起的无头子进程之间，因共享 `.claude/settings.json` hooks 和 `.current-phase.json` 全局单槽状态文件导致的三层交互串台问题。 [4/6 completed]
  - `goal_模式_hooks_串台分析_9c77c207.plan.md`
- **hdc 进程治理** — 用「resolveHdcExecutable 咽喉点 + 单一 hdc spawn wrapper」根治 hdc daemon 以 framework 目录为 cwd 的孤儿问题，把 daemon kill 降为可开关策略，并给 runHarnessPhase 补进程树回收。 [6/6 completed]
  - `hdc_进程治理_6576391c.plan.md`
- **Hylyre 0.2.0 适配** — 将 framework harness 与 device-testing skill 适配 Hylyre 0.2.0：修正 force-stop 语法并接通冷重启、同步 scroll_to 步骤键、接入 --failure-dir 失败诊断、增强 page save，并更新文档教 agent 使用富选择器，从而真正解开 bc-openCard 的 #1 同名按钮主阻塞。落在当前 2.3.0 开发窗口，不改版本号。 [7/7 completed]
  - `hylyre_0.2.0_适配_9bbcd7d7.plan.md`
- **hylyre 0.3.0 接入** — 接入 Hylyre 0.3.0 vendor 发布件，并从根因修复 personal setup 原子性——阶段入口内联确定性 repair（修 coding/ut/testing 的「半就绪 local」卡门禁），同时堵住 release 发布件把 vendor 移交 md 混入 zip 的漏洞。 [8/8 completed]
  - `hylyre_0.3.0_接入_052bcc86.plan.md`
- **Init 流程体验优化** — 结合多轮 review（Claude 侧 + Codex 侧 + 多轮 plan review），将 init 流程改进升级为「planner ownership + executor 结构化返回契约 + run-log telemetry + summary consumer」的闭环；覆盖 bundle 分支的三个写盘入口（syncTemplateTarget / applyInitMechanismSync / applyAgentBundleInlineSync），并修复 run-global-phases 契约、readiness cwd 安全与 S2 交互合并。 [10/10 completed]
  - `init_流程体验优化_e306e704.plan.md`
- **init 清旧跳板** — framework-init UPDATE 的 `cleanup-deprecated` 已会备份删除编号形态旧跳板（如 `3-coding`），但 SSOT 列表未覆盖 v2.3 改名前的语义跳板 `prd-design` / `requirement-design`，导致宿主物化后新旧并存。扩展清理 ID 列表、同步 S1 文案与单测，并在下次 UPDATE 自动清除。 [5/5 completed]
  - `init_清旧跳板_14833e4f.plan.md`
- **rename-and-enrich-spec-plan-phases** — 把 maison 的 prd/design 两阶段重定位并改名为 spec(长期需求规格快照)/plan(短中生命周期实现计划与开发契约入口)。先用 grep inventory 驱动的纯机械改名打底，再做语义重构：spec 只提炼 story 的通用治理维度并留 extension 口子、plan 瘦身但保留三大门禁章节、澄清 plan.md 与 contracts.yaml 真源关系。走自家 OpenSpec change 立项 + 旧 id/旧路径兼容 + MIGRATION（发布版本号默认不改，semver 级别与 bump 按用户指示）。 [13/13 completed]
  - `rename-and-enrich-spec-plan-phases_b8e21149.plan.md`
- **skill-phase 改名残留清扫** — P0 hotfix（2.3.0）：清六份 feature SKILL 的 Skill N 编号文案 + MJS release 硬门禁，解除消费者 init verify 卡死。P1 收口见顺延 plan（2.4.0）。 [4/4 completed]
  - `skill-phase_改名残留清扫_b384bc66.plan.md`
- **skill-phase 改名残留清扫 P1 收口** — P1 收口（2.3.0 同窗口）：收掉 prd/design 与剩余 Skill N 残留、修 summary.schema 等 SSOT、建 inventory/allowlist。与 P0 一并完成后再打发布件。 [6/6 completed]
  - `skill-phase_改名残留清扫_p1_收口.plan.md`
- **skill 层 scope 重构** — 按生命周期 scope 重构 framework skill 层:根 skills/ 物理分为 project/ 与 feature/ 两个命名空间、去掉所有数字前缀、将个人级 00b 降级为 reference gate,使项目级 skill(catalog-bootstrap、未来 code-graph)可无重排增长。 [12/12 completed]
  - `skill_层_scope_重构_21b8dec2.plan.md`
- **tsc 门禁加固** — 修复 graph-extractor-host.ts 的 TS2503 存量类型错误（相对 type import），新建覆盖全 profiles 的 tsconfig.typecheck.json，并把 tsc --noEmit 接入 harness npm test（开发期）与 release:verify（发布期）双重门禁，杜绝类型错误漏进发布件。 [6/6 completed]
  - `tsc_门禁加固_6520a04d.plan.md`
- **ut yaml 解析修复** — 实测确认：模拟工程 UT 失败是 ut-file-scope 裸 import yaml 在消费者布局下无法解析 harness/node_modules（非 hvigor 执行错误）。修复对齐 ts-compile 的 createRequire 范式；单测锁定解析来源；loader 带出 load_error 防误诊。 [4/4 completed]
  - `ut_yaml_解析修复_6a0407f0.plan.md`
- **工具无关 Goal 全链路** — 为 AgentMaison 实现工具无关的「goal 模式」全链路自动化（收敛 MVP + 运行证据层）：先把确定性 goal-runner 与裁决语义做硬，让任意 agent 工具都能把需求从指定起点推进到 device-testing；外部阻塞阶段标记 DEFERRED（绝不软通过），全程留痕到 goal-runs 运行证据层。原生 /goal 仅作可选加速层（第一版只做文档+metadata）。 [16/16 completed]
  - `工具无关_goal_全链路_817d44d8.plan.md`

## 2.2.0

- **code-graph-ut-evolution** — 拆成两条互相支撑、各自可验收的 change —— Track A「Code Graph 图谱索引」(仅作导航索引,用时反查 anchor,绝不作 PRD/design/coding 真源) 与 Track B「UT 可执行能力」(归档膨胀治理 + 模块级 seam/mock registry + characterization path-c + 触及 core 的需求闭环闸门)。机制主体在 framework 层,通过 GraphExtractor contract 抽象,hmos-app 仅作 profile provider;ArkTS/Hypium 特例归 hmos-app。 [6/8 completed]
  - `code-graph-ut-evolution_f8fa08ee.plan.md`
- **config 生成机制重构** — 把 framework.config.json 的生成从「AI 自由拼整文件 payload」重构为「AI 只提供结构化值 + harness 确定性 builder 从 profile 默认合成完整文件」，使 CREATE / UPDATE(overwrite) / UPDATE(keep) 三路径都保证字段完整（含 schema_version），并按 project_profile.name 做 profile-aware 补缺（generic 工程不再被补 hylyre）。 [8/8 completed]
  - `config_生成机制重构_0d66fbf2.plan.md`
- **Init Flow UX Improvements** — 基于宿主工程运行日志分析，解决两个根因级问题：(1) AGENTS/CLAUDE.md 模板渲染管线不统一导致占位符残留与摘要回退；(2) Init UPDATE context 派生管线缺失导致 agent 被迫手写 90 行冗余 payload。 [7/7 completed]
  - `init_flow_ux_improvements_9e9bc933.plan.md`
- **init runlog readiness ux** — 收紧 /framework-init "成功但有摩擦"的体验与审计：S0 依赖 readiness 机器门禁、S2 智能模式文案纠偏、run-log skip 原因 + 顶层审计字段（覆盖 preflight/dependency 两个生产者）、staging context 元数据规范、S4 下一步保守化。不改核心 task DAG / preflight 规则 / adapter decision SSOT。 [8/8 completed]
  - `init_runlog_readiness_ux_47fe0a7e.plan.md`
- **Init 流程体验优化** — 三部分优化：(A) Agent init 体验——S0 cwd、--smart-auto、S2 预览 SSOT、S4 摘要；(B) config 默认值——pypi 华为源、module_graphs_dir 模块根、reports_dir_pattern 自动注入、cross_module 大小写漂移修正；(C) 架构防护——derive 保留 paths/tools 显式配置 + MIGRATION 仅 modernize 已知旧默认，「默认值不覆盖显式配置」原则。 [13/13 completed]
  - `init_流程体验优化_4ae82896.plan.md`
- **init 编排缺口修复** — 修复宿主工程跑新版编排化 /framework-init 时暴露的 5 处偏差：adapter 物化清单未询问（加 harness 机器门禁根治）、S1 探测前未装依赖、--emit-staging-template 文档/脚本矛盾、decision/context 新 schema 缺示例、preflight 闭包对 satisfied 依赖误判。 [12/12 completed]
  - `init_编排缺口修复_8e6d397e.plan.md`

## 2.1.0

- **version evolution strategy** — 把"版本号↔plan"的语义化演进策略固化进开发仓：plan frontmatter 打 version 标签 + 集中 MAINTAINER-CHANGELOG 自动生成 + 规范文档/Cursor 规则 + 校验脚本接入 release:verify（含 release 模式硬门禁：在研 plan 必须有版本、发布时当前窗口 plan 必须完成、bump 不遗留未完成）+ 版本间变更摘要工具，全部 dev-only 不进发布件。 [7/7 completed]
  - `version_evolution_strategy_dc27f455.plan.md`

## (legacy / 未分版)

- **adapter-update-policy** — 在 adapter.yaml 引入 update_policy 字段，把 adapter templates 分成"机制代码自动覆盖（带备份）"和"用户入口需 y/n 确认"两类，解决 vendor 新 framework + UPDATE init 后实例侧 hook 等机制文件不同步导致的回归（如对方工程那次 npm test 报错）。
- **dynamic profile skill assets** — 将根 `framework/skills/**/SKILL.md` 中已失效的 `templates/` / `examples/` 相对链接改为 profile 动态资产引用；通过 profile manifest 和 docs harness 校验保证引用会按 `framework.config.json > project_profile.name` 解析到当前 profile 的真实文件。
- **explore-threshold-overhaul** — 将 explore subagent 触发逻辑从「简单计数阈值」升级为「default-on + trivial 豁免 + 复合评分」混合模型，适配大型代码库（50-100 万行）场景，并为无子 agent 能力的 adapter 提供 sequential 等价路径。
- **feature artifact archival** — 把 doc/features/<feature>/ 下的阶段主产物（PRD.md、design.md、review-report.md、test-plan.md、test-report.md）统一归档进各自的 <phase>/ 子目录，与已有的 context-exploration.md / phase-completion-receipt.md / reports/ 同住；跨阶段全局契约（acceptance.yaml、contracts.yaml 等）保持在 feature 根目录。通过在 config.ts 引入"产物→阶段"SSOT 映射 + 双读解析器实现，新布局为默认、旧扁平路径在读取侧回退兼容。
- **framework-extensibility-refactor** — |
- **framework-generalization-plan** — 把 skills/specs/harness 从钱包实例里解耦出来，在本仓库建立「framework/（通用 SSOT）+ 钱包实例」双层结构。framework 走最薄核心路线——不假设具体层级架构，只守元规则；所有配置由一个 AI 驱动的「Framework 初始化 Skill」在目标工程里交互式生成。Agent 绑定（Claude / Cursor / 通用）通过可插拔 adapter 支持，第一版覆盖 claude + cursor。元服务差异留作第二阶段增量。
- **framework-init 体检脚本化** — 把 framework-init Skill 的 11 项产物体检从"AI 自由叙述 + 自由渲染汇报表"硬化为"check-init.ts 计算 + AI 仅搬运"，并把 init 接入 harness-runner 作为第四个全局阶段，消除弱模型在 UPDATE diff 步骤上的编造空间。
- **framework-setup as prephase gate** — 将 framework-setup 从面向用户的独立命令/技能跳板下线，把"个人 setup"行为收敛为所有阶段（含 catalog/glossary）统一的前置环境检查：缺失时由阶段入口内联完成，所有 adapter 同等受益，普通使用者无需感知该命令。
- **framework-skills 通用化收口** — 将 framework/skills 下与 hmos-app profile 重叠的"模板/示例/参考/预设"全部迁出到 framework/profiles/hmos-app/skills/...，framework/skills 一侧统一改为 5 行跳板，与 3-coding 已落地的模式对齐；同时清理少量残留 HMOS 措辞，保证 framework/skills 仅承载通用产物。
- **framework-upgrade-compat-protocol** — 建立通用「框架升级兼容协议」（compat）+ context-exploration 回填工具：让存量 feature 在 framework 升级新增 BLOCKER 时可临时降级放行，同时提供回填脚本把存量正规化。**compat 状态是过程态数据，归档在 feature 自身目录**（doc/features/<feature>/compat.yaml）；framework.config.json 完全不被污染、Skill 00 零接触。
- **Framework Init 编排化重构** — 把 framework-init 从「固定11项体检+策略矩阵+批量Q」重构为「探测→harness确定性产出任务DAG→用户勾选批准计划+选枚举参数+选决策模式→按流带闸门执行→结构化摘要」的原子化任务编排模型；并把个人化配置（agent_adapter / DevEco 路径）从项目级 config 剥离到 gitignored 本地文件，将 init 拆成「项目级 init」与「个人级 setup」两条独立流程。
- **framework profile 模板化** — 将 framework 主体去鸿蒙化、抽离为「通用骨架 + 可插拔 project profile 模板」；hmos-app 作为第一个 profile（含 element-service 子分支），同步落地 generic 最小 profile 验证降级链路；framework-init 引入 profile 探测/选择/写入流程，harness 引入 capability registry 实现「具备则用、不具备则真 SKIP」。
- **Framework 发布打包** — 为 AgentMaison 建立可重复的 zip 发布流程：从仓库根读取 package.json 版本号，按 SSOT 排除规则裁剪开发/运行时垃圾，产出 `framework-<semver>.zip`（内含顶层 `framework/` 目录），供消费者解压到工程根目录。
- **Framework 拆分与演进** — |
- **Framework 闭环恢复缺口** — 这不是单纯的 agent 误读：当前 framework 在「他人更新 framework 后、新会话继续 feature」场景下**不能自动**认定已闭环。根因是闭环 SSOT（check-receipt）与运行时态（.current-phase.json / summary.json）不同步，且 init 迁移只 modernize config、不 reconcile 闭环状态。需补充 state 同步、resume 探针与 Skill 强制协议。
- **frameworkRoot 路径统一** — 在已有 `repo-layout.ts` 基础上，将 `frameworkRoot` / `frameworkRel` / `harnessRoot` 提升为运行时一等公民，贯通 CheckContext 与 config 路径解析，区分物理/逻辑路径，补齐真实 phase 烟测（含 release staging consumer fixture）与依赖隔离断言，消除 standalone 与 consumer 双布局下的路径漂移。
- **generic-init-regression-guard** — 通过收紧 Skill 00 提示词/文档措辞，并补一条回归单测，杜绝 init agent 把「harness 已有默认值」误读成「必须 STOP 手动配置」，从而误丢选中的 generic adapter。
- **Generic agent bundle** — 为 generic adapter 增加可配置 bundle 根目录（如 `.agents`）；按加载器能力分「bridge / inline」两种 skill 物化策略；shared 仅承载 bridge 薄跳板（name 与目录名一致）；strict 类 agent（Chrys）走 inline 从 framework/skills 生成完整 SKILL.md。
- **GLM改framework根因** — GLM 5.1 在真实工程写 UT 时修改 framework 源码，是「Test Double Policy 未闭合 → 门禁 TS2614 / 依赖契约误读 → AI 在消费者 submodule 选错修复层」叠加所致。实例侧应先回滚脏改；框架侧应把 Hypium MockKit 纳入一等 Test Double Policy（与 mock-plan/harness/verifier 约束），而非禁止 MockKit 或仅靠 ambient 两行补丁。
- **hmos-app HSP 形态支持** — 在 hmos-app profile 中把 HSP 提升为与 HAR 等价的一等库模块形态，贯通 Skill 0 catalog、Skill 2 design、Skill 3 coding、Skill 4 review 与 harness 检查全链路，从源头消除术语表/模块画像缺 HSP 内容的问题；framework 自身演进先以 OpenSpec change 承载。
- **hvigor 编译加速** — 把 coding/ut 阶段的 hvigor 命令切到 debug + parallel + incremental，并把硬写死的 `-p product=default` 改为基于 build-profile.json5 自动探测、framework.config.json 可覆盖。
- **Hylyre 自动升级** — 厘清当前 Hylyre 安装触发链路与版本升级缺口：Skill 6 本身不装 Hylyre，但跑 `testing` harness 会调用 `ensureHylyreReady`；现有实现在 venv 已能 import 时不会自动对齐新版 vendor。计划按你选择的策略，在 framework 源头实现「vendor 变更 → 自动 pip 升级/重装」。
- **Hylyre步骤错误根因分析** — |
- **init-gitignore-自动同步** — 在 framework 内将 `.gitignore` canonical 规则抽为 SSOT，由 `check-init` 在体检第 11 项之前幂等自动追加，消除 agent 手抄导致的 `/harness/reports/*` 类错误；并补齐 check-init 与 SKILL 5.4.5.1 之间已漂移的 5 条规则。与「快照缓存/耗时」plan 已落地部分解耦。
- **init adapter 确认差异** — 根因分析仍成立。main 上另有 AI 已合入 acceptance 分层、gitignore 机器同步、tools.hylyre 补缺，但 **未** 修 cwd 泄漏与 adapter 每轮确认。计划 Todo A1～C 仍全部 pending，仅需在 A2/A4/C 中标注与近期提交的边界。
- **init config 差异根因分析** — 分析真实工程 framework-init 后 framework.config.json 缺失/错误字段的根本原因，核心问题是 Q1=y 路径下 AI 手动生成 JSON 的可靠性不足，且 Q1.A 补缺机制被自动跳过。
- **init staging files lifecycle** — 把 decision.json / context.json 正式定义为「S2 由 agent 在 OS 临时目录生成、S3 由 harness 消费、S4 由 agent 销毁」的一次性 staging 契约；并把 S3 缺 payload 的语义从「部分写盘后任务 failed」升级为「无副作用原子 preflight + 可审计 run-log」，经 OpenSpec 提案落地。
- **init step refs audit** — framework-init 重构为 S1/S2/S3/S4 后，全仓残留两类遗留——(1) 旧 Skill 00 编号（Step 0.x / 3.5 / 5.x / §4.1.1 / §5.1 / §5.4.5 / Skill 0.3 / §0.3.x / Q1.C/Q1.A / Step 0→Step 7）；(2) 非编号的语义漂移（DevEco 路径"由 /framework-init 自动完成"等，与已迁到 personal setup 的方向冲突）。本计划以发布文件集为 SSOT 做权威枚举与三分类，再全面修正，并加一道 context-anchored 防回归校验。手工种子清单仅作起点，最终以 Phase 0 扫描为准。
- **karpathy-principles-global** — 将 Karpathy 四原则（Think Before Coding / Simplicity First / Surgical Changes / Goal-Driven Execution）作为 framework 全生命周期的底层行为规范引入，通过「行为规约 + Context Exploration 量化强化 + 全阶段 Verifier 行为审查维度」三层机制让 AI 无法再走形式。
- **merge-feature-specs-into-doc_phase9.plan.md** — 
- **OpenSpec 引入 Maison** — 在 agent-maison 仓库中引入 OpenSpec 作为框架自身变更管理与行为说明工具（非运行时 SSOT），用 OPSX 工作流驱动未来功能演进。
- **PRD 图片精度无损化** — 把"原始截图"从一次性消耗品升格为贯穿全流程的持久 SSOT，让 PRD 文字降级为图的注解、下游 verifier 直接看图，并通过结构化 visual_anchor 字段做机器级校验，根治"PRD 缩略文字一错全错"的链路衰减问题。
- **PRD 视觉保真策略** — 把「像素级版面」从 PRD 正文中解压出来：用语义化 PRD + **可插拔的视觉交接（Visual Handoff）索引**（不只一种文件格式）+ 设计/验收中的显式对照，避免仅靠 Markdown 内嵌缩略图驱动整条流水线。
- **profile-specific assets cleanup** — 系统性清理 framework 根目录 skills/specs/harness 中的 hmos-app/Harmony/ArkTS/hvigor 等具体工程形态残留：能直接删除或迁移的先处理，混合型 harness 规则通过 provider/rule-pack 抽象后下沉到 profile。
- **Reports 目录解耦重构** — 将 `framework/harness/reports/<feature>/` 迁移到 `doc/features/<feature>/` 体系内，使 framework 目录成为纯工具层，可安全地整体替换/升级而不丢失 feature 过程产物。同时对齐 OpenSpec 的"工具与产物分离"设计哲学。
- **Init config modernize + Reports 外置** — 合并「init config 未刷新」与「Reports legacy 路径」两条线：根因是 init 仅有白名单补缺（v3.2 5.1.B），缺迁移 pass 与 reports 外置的 init 内决策；在 framework/ 增加 MIGRATION_RULES + §5.1.C + Q1.C，使 WalletForHarmonyOS 等实例仅通过 framework-init UPDATE 即可 modernize config（含 reports_dir_pattern），无需手改 JSON；legacy 报告 opt-in 手动搬迁见专节。
- **root-host-decoupling-final-cleanup** — 把根 harness（check-coding / check-ut）里残留的 hvigor / DevEco / ohpm / Hypium / hmos-app 路径与诊断逻辑彻底下沉到 profile provider，并把根 framework/skills/**/SKILL.md 里所有 hmos-app / ArkUI / $r / .ets 等宿主专名一次性中性化，闭合「框架通用化、profile 解耦」最后一段差距。
- **root profile decoupling** — 继续清理根 framework 中的 hmos-app/Harmony/ArkTS/钱包域残留，把宿主细则下沉到 profile overlay/provider/addendum，让根目录只保留 profile-neutral 编排和通用契约。
- **Skill 5 融合 characterization 路径（存量/回归特征化 UT）** — |
- **Skill6 Build Install Plan** — 为 Skill 6（device-testing）增加自动打包主 HAP + 装机的完整能力，分层落在 framework 根（通用抽象）与 hmos-app profile（宿主实现）两侧；Hylyre 不负责打包/装机，只负责"包已装好后"的 UI 自动化与 Mock 测试。
- **skill6 hylyre integration** — 在 hmos-app profile 范围内，将 Hylyre 真机自动化测试能力（CLI 优先）集成进 framework Skill 6。Hylyre 侧 add-vendor-bundle change 已完成（产出 hylyre-0.1.0-py3-none-any.whl + release.manifest.json），framework 这边消费这份 wheel + 调用 `hylyre run --plan` CLI。顶层 test-plan.md 保持自然语言供人审，agent 自动派生符合 hylyre 7 列 JSON 步骤硬约束的可执行 plan 跑真机；hylyre 产出的 test-report.md / trace.json 由 agent 合成回顶层报告（直接复用 hylyre 4 状态枚举：通过 / 失败 / 阻塞 / 跳过，与 framework 现有模板天然对齐）。其他 profile 完全不受影响。
- **Skill6 Hylyre 安装与失败链** — 截图里的「请选手动/自装 Hylyre」并非 Framework 设计，而是 agent 走错入口且 harness 在到达 ensure 之前失败后的即兴话术。单机杂乱错误多为「入口混用 + 宿主环境变量/venv + framework 版本/类型缺陷」叠加，不应默认改 framework。
- **Skill6 即席真机优化** — 针对即席（ad-hoc）真机测试的三大痛点——重复探索 main ability、错误 Hylyre 步骤、app-snapshot-cache 不积累——在 framework 层新增「App 元数据 + 计划校验 + 即席编排 CLI」，并同步 Skill 6 协议，使 agent 有稳定一键路径，同时保留分步兜底。
- **Skill6 派生计划 SSOT** — 根因是 harness 把 `testing/reports/` 下「任意已存在的 hylyre 派生文件」当作真源，且只做「派生 ⊆ 顶层」校验，从不根据 `test-plan.md` 判断覆盖是否过期/不完整；烟测占位因此长期劫持执行。按你选择的策略，在 `check-testing.ts` 增加以顶层计划为 SSOT 的覆盖/新鲜度门禁（BLOCKER），并修正「选最新派生目录」的启发式。
- **Skill6 端到端自动派生** — 让 Skill 6 同时支持两种入口——feature 需求驱动 + 即席自然语言用例；并集成 app-snapshot-cache 自动维护。
- **Skill6 跨工程退化诊断** — 即席真机在新工程退化的核心不是 Hylyre 本身，也不是 framework 版本漂移（已同步），而是 warmup 失败 → 硬 exit、不写 trace.json、agent 无 SSOT 路径，导致 agent 读旧目录捏造结论。补齐 warmup 韧性、anti-fabrication 契约、设备/App 状态可观测、bootstrap 提示与 agent 规则。
- **Spec-Harness验证体系** — 在现有 6 阶段 Skill 流水线之上，引入独立的 Spec（规约）+ Harness（验证器）层，为每个阶段的产出建立机器可验证的契约和自动化验证机制。Spec/Harness 独立于 Cursor，可在任意大模型 + 任意 IDE 上运行。
- **Stop hook 跨会话 state 隔离（方案 B）** — 修复 framework/harness/state/.current-phase.json 跨会话粘滞、Stop hook 把陈旧阶段当作当前任务的设计缺陷。引入"会话边界"判据（session_id + TTL 兜底），同会话内严格保留 §5.1 拦截，跨会话静默放行+友好提示，并把"未闭环阶段"的训话式 PUA 文案改成中性引导。
- **tools.hylyre init 缺口** — 采用方案 A+B：hmos-app profile defaults 保证 CREATE 合并带入 tools.hylyre；BACKFILL_FIELDS 保证 UPDATE / 5.1.B / Q1.A 机器补缺；单测与 MIGRATION 文档同步。不采用方案 C（纯文档提示）。
- **UT v2 修正 — UseCase 去代码化，改为规约驱动** — |
- **UT 分层分工与端到端 UseCase 化** — 把业务流程升级为 UseCase 一等公民（design/coding 阶段强制产出），UT 基于 UseCase 做端到端分支覆盖，不 mock 任何 UI 符号，UI 副作用通过 state 断言、真机交互交 Skill 6，全链路门禁按分支/AC/端口三重追溯收紧。
- **UT 可测性预检 与 Mock 计划书** — 在 Skill 5 / DAG / harness 三层引入「可测性预检 + Test Double Plan + DAG 类型化 spy 引用」三套机制，从根因上解决「DAG 完整但 AI 写不出能编译的 UT」问题；分 P1/P2/P3 三阶段落地，避免一次性把存量 feature 卡死。
- **UT 真实执行 + named_handler 放宽 + 改源码门禁** — 系统性补齐 Skill 3 / Skill 5 的"真实编译 + 真实运行"出口闭环，修正 named_business_handler 对 ArkTS 类字段函数的误杀，并在 Skill 5 阶段新增"禁止 agent 擅自改业务源码"的硬门禁。
- **UT 能力深度提升** — 基于真实工程 UT 执行记录根因 + 外部审查反馈，针对弱模型（minimax 2.7）在大型 HarmonyOS 工程（60w 行 / 22 模块）中的 UT 生成可靠性做系统性提升。修订版吸收了 harness 代码验证和外部 AI 审查的 P0/P1 修正意见。
- **UX 真源可达 + 工程外解耦** — 把 check-prd 的 visual_handoff 从「项目级强制」改为「PRD 驱动 + 项目级可选 override」；移除框架默认对"本项目有 UI"的隐含假设，使 framework 能自然适配云侧/库工程等无 UX 形态；同时把 UX 真源解耦出工程根（${UX_ROOT}/绝对/UNC 路径 + reachable 判定），并明确 doc/features/ 真实工程默认不入主仓。
- **交互层架构大重构** — 将 AgentMaison 框架中散落在 skills、commands、rules、widget-options 多层的平台特判（Claude Code AskUserQuestion / Cursor AskQuestion）收敛为一套平台无关的交互协议，由 adapter 统一注入渲染策略，确保 Claude Code 场景下所有用户交互都走键盘选择。
- **全生命周期Skill体系** — 为模拟华为钱包应用设计三层架构：Skill（生成层）产出文档和代码，Spec（规约层）定义契约和验收标准，Harness（验证层）自动化检验产出是否符合规约。三层职责分离、独立演进。Spec/Harness 模型无关，可在任意大模型 + 任意 IDE 上运行。
- **即席 NL 与缓存加速** — 删除 adhoc NL translate 全链路；即席与标准 feature 统一为 derive hint → agent 写 Hylyre JSON → harness lint/执行。已对照 2026-05-20 最新代码勘校。
- **即席报告路径修复** — 即席真机 trace/report/plan-lint 的落盘目录取决于 steps-file 所在目录（adhoc-device-test.ts L312–314），是 6dcf0ba 引入的回归。修复：执行输出永远写入 doc/features/_adhoc/testing/reports/<timestamp>/hylyre/。
- **即席真机问题评估** — 勘校基准 main @ 2d74851（2026-05-21）。问题 1：cache 只认 pages/*.json（flat 扫描仍 pending）。问题 2：wait lint + NAV BLOCKER + 默认冷重启（ed82bb8）已落地；2d74851 为 dump-ui/warmup 注入 hdc PATH。touch lint / 文档冲突 / UI_RESET trace 路径 bug 仍 pending。3994e76 已移除 adhoc-step-translate，即席不再自动 NL→Hylyre 翻译。
- **即席重跑页面状态分析** — |
- **去 claude 化措辞补丁** — 把"弱模型工作流强制门"在 framework 共通资产中的 claude 特化措辞（Stop hook）改为 adapter 中立的"物理拦截层"，避免 generic / cursor adapter 用户产生"没有 Stop hook = 可豁免 BLOCKER"的反向暗示；同时把实例工程下游 CLAUDE.md 的对应几句对齐到模板，确保下次 framework-init UPDATE 不会出现假 diff。
- **取消 todo 收敛验收** — 结论不变：UT/真机分层合理，废弃手写 device-testing-todo.md，收敛到 acceptance.yaml（ut_layer + device_focus）。二次核查（HEAD b53a561 一带）确认 Hylyre/test-plan 派生 SSOT 已较完整，但 acceptance→test-plan 的 ut_layer 追溯、device_focus schema、todo 文档依赖仍未改；本计划与 overview §4.1 陈旧表述一并修正。
- **弱模型友好框架第一波改造** — 针对"弱模型下 AI 自行扩大需求范围 + ArkTS 代码跑偏"两个核心痛点，对 skills/specs/harness 三层做定向改造，并铺设 Claude Code CLI 运行时 + 异步反馈回路，最后用 home-page feature 做端到端 dry-run 验证。
- **弱模型吞字防护 / framework-init 数据驱动化** — 解决内网中低端模型在 framework init 过程中"吞字反转语义"的问题（如模板里"不要"落地成"要"）。核心思路：把能机械生成的都从 LLM 的文字流里摘出去——adapter 模板走字节级 copy，agent 入口文件走占位符替换，architecture.md 走数据驱动渲染；剩余真·AI 散文区用分区哨兵 + negation-diff verifier 兜底。
- **弱模型工作流强制门** — 用 Prompt 加固 + 完成回执 + Claude Code Hooks 三层组合，根治弱模型在阶段结束前跳过 harness 并编造"假设规则"为借口的问题，让"声称完成"必须留下真实可验证的物理凭证。
- **快照缓存与耗时报告** — 回答三个问题：① app-snapshot-cache 为空（page save CLI 错误 + 未探索）；② test-report 缺耗时汇总；③ testing 每次仍调 hvigor/装机，需在「业务源码未变」时复用已有 HAP、跳过重复打包（可选跳过装机）。
- **架构文档变更门禁收窄** — 在 framework 与 CLAUDE.md 中重新定义"架构级变更"边界，把 doc/architecture.md 从 feature 级变更日志改造为架构级契约文档——只有 DSL 结构变化、模块集合变化、模块职责大调整这三类事件才触发更新，普通 feature 需求不再被强制改架构文档。
- **根目录 reports 污染根因** — 宿主根不应出现 reports/tmp_hypium。P1 spawnHylyre → P2 污染检测（tmp 先清再快照；reports mtime/计数）双 meta + ROOT_HYLYRE_POLLUTION=1 → P3 再定 /reports/ ignore。Review 已收敛，已定稿可执行。
- **消费者验证命令系统性重构** — 消费者 npm test = check:global = catalog+glossary+docs 三全局 phase。源仓 npm test 不变（unit+fixture）。发布 sanitize 时重写 harness/package.json 的 test 脚本。
- **跨 Agent 确认 UX** — 建立「渐进增强式确认 UX」SSOT，全 Skill 0～6 确认点落地，并加静态 lint + 贡献门禁防回归（lint 只扫 Skill 文案，不验运行时对话）。不改独立 pending-confirm 产物文件。
- **阶段推进闸门排查** — 全量排查 Skill 0–6 各阶段边界是否存在「闭环后自动开下一阶段」问题；本次以默认停等 + 显式/批量授权修复已知 autopilot 漏洞，并为未来 Claude Code/Codex goal 模式全自动串联预留协议扩展点。
- **鸿蒙应用开发环境搭建** — 从零搭建 HarmonyOS NEXT 开发环境，完成开发者注册、DevEco Studio 安装、项目创建、调试证书配置，最终将 HAP 包安装到真机并支持调试运行。

