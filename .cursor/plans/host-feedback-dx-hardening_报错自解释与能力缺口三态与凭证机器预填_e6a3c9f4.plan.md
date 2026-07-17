---
name: 宿主反馈回灌(2.3.0) — 报错自解释 / 能力缺口诚实化 / receipt 瘦身
version: 3.0.0
overview: >
  背景：另一宿主用户基于 framework 2.3.0 的使用体验提出《Harness 工程分析与 Skill 化建议》
  （D:\97.log\问题反馈\07-16\；材料曾位于 07-15\，07-16 已移动）,含 5 缺陷 + 5 个 skill 提案
  + 5 条演进建议。经对 HEAD（核实时点 bd5a87e1）逐条 ground-truth 核实：verdict 子串 bug /
  context-exploration 逐阶段重复生成 / 减凭证诉求的主体已被 c3f08a21、d4a7c1e8（direct/lite/full
  分档 + facts.md 共享 + evidence_profile）、e3a9c5d1（凭证信任链）根治或架构性否决；但核实同时
  坐实了真实缺口，均与"确定性工作下沉给机器、缺口显式化而非二态"的轻量化主线同向：①门禁报错
  不自解释（source_code_paths 纯路径规则无示例、contracts 前缀错配只报"缺失"、BLOCKER 无来源
  定位、suggestion 覆盖参差）→ t1 规范化层(resolveEffectiveSuggestion 四出口一致)+factory+ratchet 三层化；②receipt 含机器可
  派生的 summary 镜像块与 q1/q3 形式自检，AI 手填徒增负担与伪造面 → t2 瘦身：删镜像字段，
  check-receipt 直读 summary，receipt 只留不可派生自证；③工具链能力只有 profile 静态二态
  （BLOCKER/SKIP），沙箱缺工具链时只能死磕（反馈用户反复失败 6+ 次）→ t3-min 本窗做"诚实
  停止"（交互态双出口话术+headless 首触 halt，不放行不绕过）；人签 waiver 放行通道因签发侧
  （confirmation-credential-issuance）未落地，已取消出窗（原 t3-full，俟排期另立 plan）；
  ④生产型子 agent 派发零指导 → t4 纪律文本；⑤hmos-app coding.lint 声明 BLOCKER 但 provider
  空缺（lite/exit 轨与修正链路真空；full 轨已有 runStructureChecks）→ t5。不新增任何 skill，
  不动凭证信任链架构，防作弊红线零降档；skill 化提案 2/3/4/5、trace+receipt 合并、
  source_code_paths 对象形态扩展明确不做（见"不做清单"）。
  【2026-07-16 增补 t6/t7】同宿主又反馈两起事故并已根因核实：A「编译环境反复不正确」——agent 绕开
  framework 探测器用 command -v 自报"沙箱无 hvigor"污染多轮凭证；该机 CLI 编译持续失败
  （00303168=sdk_component_missing，"hvigor/SDK 版本不兼容"属未经 framework 调用链验证的强推断，
  归因须证据分层）；探明事实不落盘导致跨会话重演（→t6 探针分层 cli_starts/project_compile 三态对象
  +错误码证据分层分类+local.json probe 快照+环境判定纪律）；B「hylyre 翻译偶现失能」——语法知识
  离入口 2-3 跳条件加载无已读证据、STEP 级 lint 写好未接线、文档版本漂移 0.3.0/0.3.1、教学文档处
  门禁盲区、标准路径无 step_shape_catalog 机器兜底（→t7 统一 payload builder 三入口注入机器目录
  +输出侧 lint 接线+键集实体比对门禁，知识由机器携带不赌 agent 读没读）。
  【2026-07-16 二轮双审】按 codex/cursor 意见完成正文全量同步与 t3-full 出窗处置，评审处置留档
  §八；实施以 frontmatter todos + §七顺序为准。
todos:
  - id: t1-report-self-explain
    content: "报错自解释基线【2026-07-16 codex/cursor 双审后修订】：(a) suggestion 兜底三层化（弃「静态扫描数百构造点」的脆弱方案）——①规范化层【三轮 codex 采纳：只改 merged-report 渲染面不够——summary-blockers.ts:42 原样透传 c.suggestion、report-generator 控制台失败输出（:507 一带）根本不打印 suggestion】：抽共享 resolveEffectiveSuggestion(check, phase)，在生成 ScriptReport **之前**完成 fallback 规范化（含 check id + 速查指引），使 script-report.json / summary.json / merged-report / console --failures-only **四出口一致**；②新构造强约束：新增/迁移 checker 用类型化 factory（suggestion 必填参数）；③ratchet 只作显式旧构造的渐进收紧（allowlist 只减不增），扫描范围含 harness/scripts/** 与 profiles/*/harness/**（hvigor/ArkTS/Hylyre 报错都在 profile 层），不把静态扫描当唯一安全网；(b) source_code_paths **不扩 {path,note} 对象形态**（codex 坐实 backfill-context-exploration/goal-checkpoint/exploration-strategy 等多消费点各自字符串化，扩 schema 会产 [object Object]；模板正文已有「已检视文件与原因」表格承载描述），只做：_min/_exist 报错补 suggestion 含纯路径格式示例 + harness/templates/context-exploration.md 与 facts 模板补内联示例行；(c) check-coding file_completeness 缺失文件做一次 basename 检索（限 architecture 声明的层目录），命中他处时 details 附「疑似路径前缀不一致，实际存在于：<path>」诊断（只提示不改判定）；(d) BLOCKER 来源定位【2026-07-16 二轮 codex 采纳：CheckResult 现不携带来源，report-generator 无从凭空推导】——在编排边界附加 origin：safeRun(fn, origin) 与 profile dispatch 处已有 origin 标签先例（check-coding.ts:542 'profile_coding_host_structure'），CheckResult 增可选 source 字段由边界填充；无 origin 处回退显示 check-<phase>.ts + fallback suggestion，不得让全部检查显示成同一来源；summary.json blockers[] 同步增可选 source（summary.schema.json additionalProperties:false 已坐实，必须同步 schema，向后兼容）"
    status: completed
  - id: t2-receipt-slim
    content: "receipt 瘦身（【2026-07-16 双审后重设计：从「机器预填镜像字段」改为「删除镜像字段」——更薄且规避 codex 坐实的时序/循环问题】现时序=tryValidateReceipt 先于 writeRunSummary（harness-runner.ts:693 一带），runner 预填 summary 镜像会构成 receipt↔summary 循环依赖，且在 process.exit 前预填 exit_code 不严谨）：(a) receipt 模板与 check-receipt 契约瘦身——删除 script_harness 镜像块与 q1（重复 trace_json.path）/q3（现状只查非占位路径、无真对账）形式自检，check-receipt 改为直接读 summary.json 对账（verdict/gate_fingerprint 交叉核验既有 :352-374，扩为唯一事实源）；receipt 只保留不可机器替代部分：agent 身份（agent_model/runtime）、claimed_completion_at/commit_sha、verifier verdict 摘录（q2）、反假设三 checkbox、testing_run_artifacts；(b) 兼容：check-receipt 双格式过渡期（旧格式照旧校验，新模板只产瘦身版），evidence-manifest 的 receipt 规范化哈希与无环封装序不动；(c) 最小骨架生成：仅 verdict===PASS 且 receipt 不存在时（cursor 选项 1）幂等写瘦身版骨架（feature/phase/trace 路径预填，自证字段占位、checkbox 全未勾），不预填任何 exit/verdict 类字段；骨架不构成闭环，checkbox 未签/verifier 未 PASS 照拦；(d) 契约变更走 OpenSpec change（receipt 模板/check-receipt/Stop hook 快照消费方同步）；(e) check-receipt 直读 summary 的对账强度【2026-07-16 二轮 codex 采纳】：不只确认 summary 存在——须校验 feature/phase 精确匹配 + verdict=PASS 且 blocker_count=0 + gate_fingerprint 新鲜且属当前 run，checker 按 feature/phase 解析 canonical report path，summary 缺失不得静默忽略；(f) 执行时序拍板【三轮 codex BLOCKER 采纳：现状 receiptValidation=tryValidateReceipt(:693) 先于 writeRunSummary(:704)，且 summary 内嵌 receipt_status(:834)——删镜像字段只消字段重复，不消执行依赖环】：writeRunSummary 拆两段——①base summary（**无 receipt 依赖**：feature/phase/verdict/blocker_count/gate_fingerprint 先落盘）→ ②PASS 且缺 receipt 时生成骨架 → ③check-receipt 读**本次 base summary** → ④closure patch 回填 receipt_status/closure_status/next_action；【四轮追补·实施约束（OpenSpec design/tasks 落实）】base summary 必须是**完整 schema-valid、fail-closed 的快照并原子写入**——summary.schema.json 的 next_action 为必填（:24），base 阶段即写"未闭环/等待 receipt"初值 + closure_status=open，patch 阶段只更新不首建；进程中途崩溃不得留下非法 JSON 或残留旧 closed 态；(g) 安全检查不随镜像块消失【三轮 codex P1 提出，四轮拍板定案】：check-receipt.ts:340 的 script_harness_command_injection（P0-7④ 伪签事故防线）处置——旧格式 receipt 兼容期**继续校验** script_harness.command；新瘦身格式以 **runner 侧 runProcessIntegrityPreflight 产出的 process_integrity CheckResult 为 SSOT**（harness-runner.ts:566，P0-7② 独立防线，结果天然进 checks→script-report→FAIL summary；goal 侧另有 sanitizeSpawnEnv）；**不新增 summary/trace 专用扫描**（防第二套 process-integrity 事实源）；保留两类攻击回归测试（直启 harness 预加载注入 / goal 继承注入）。夹具：旧格式回归零变化；瘦身版未签→拦、补签→PASS；与 manifest 回写幂等共存；负向——「本次 FAIL+上次 PASS summary」「旧 summary（stale fingerprint）」「其他 feature 的 summary」均须拦；注入攻击回归例保留"
    status: completed
  - id: t3-capability-gap-honest-halt
    content: "工具链能力缺口诚实化·本窗最小闭环（【2026-07-16 二轮 codex 减薄采纳：缺口发生在 phase 开始前的 preflight，无需把新状态贯穿 CheckResult→verdict→summary→evidence→completion 全链——完整状态传播矩阵移交未来 waiver plan】）：(a) 交互态：personal_prerequisites 校验失败（deveco_toolchain_missing 类）输出双出口话术——引导安装（默认）| 用户确认后**诚实停止**（记录缺口声明与用户答复，不放行、不绕过 phase，环境修好后 resume；「用户确认」仅是停止的知情记录，**不构成任何授权**；【四轮 codex 采纳】答复的采集与记录由**宿主交互层（agent 对话）**负责——harness-runner 不读 stdin、不新增任何确认 receipt，机器行为恒=输出结构化缺口+非零退出）；(b) 机器可读 preflight 出口：ensurePersonalSetup 返回稳定结构化 preflight result；harness-runner 在 process.exit 前输出/持久化结构化 HARNESS_PREFLIGHT 结果（现状 harness-runner.ts:387 一带裸 console.error+exit 1，goal 侧无从分类）；(c) headless/goal 插入点写死【三轮 codex P1 采纳：goal 链先发 agent_invoke_start(goal-runner.ts:2101 一带)再调 agent、harness 在 agent 会话内才跑——等 harness 侧 HARNESS_PREFLIGHT 时 agent 已烧一轮】：goal-runner 在**每 phase 每 attempt 的 agent_invoke_start 之前**直接调共享 preflight（初跑与 --resume 均重检）；缺口时**不产生 agent_invoke_start**，直接写 run_end=HALTED + halt_reason=await_human_capability_gap + 非零退出；harness 侧 (b) 出口仍保留（交互态消费+防御纵深）；**不进 CUMULATIVE_HALT_FAMILY**（agent 尚未开跑，无累计语义），不触碰 EvidenceValidationStatus/receipt/feature-completion 契约；(d) 边界（维持 b4e7a2c9 round2 双侧写死条款）：缺口判定只认显式前置能力码，禁止按 blocking_class=device_toolchain 泛匹配；ohos_test_sign_gap / ohos_test_hap_missing / device_tool_missing / device_install_failed 四个运行后 failure_kind 永不属于本通道；默认路径全回归零变化；(e) preflight 出口契约走 OpenSpec change"
    status: completed
  - id: t3-full-waiver-channel
    content: "【已取消出窗（2026-07-16 二轮双审 BLOCKER-2：pending 会卡 3.0.0 release:check-plans，且硬依赖的 confirmation-credential-issuance 未排期）】capability_gap_waiver 人签放行通道设计已留档正文 §三 t3-full 节（registry 签发+deferred_by_waiver 校验态+AWAITING_HUMAN_REVIEW 封顶+红线不豁免+状态传播矩阵）；俟 issuance change 排期后**另立独立 plan** 绑定该版本窗口重建，本窗不计完成度"
    status: cancelled
  - id: t4-dispatch-discipline
    content: "生产型子 agent 派发纪律 + 量化 inventory 纪律（纯文本，≤20 行增量）：skills/reference/agents-entry-detail.md §4.1 增补——framework 不禁止派发写码子 agent 但不信任其报告：派发 prompt 最低纪律（前置 Read 验证目标存在、不存在即 STOP 报告；后置自验命令；报告=实际修改文件清单+自验输出，禁模糊词）；子 agent 报告不构成任何闭环凭证，主 agent 必须 git diff 对账后才可声明完成；门禁/凭证责任不可下放给子 agent。agent-behavioral-principles.md 增一句：计数/清单类量化 inventory 须脚本命令产出并留存命令与输出（治 2.3.0 反馈「grep 43 个 namespace 实际 26 个」类事故）。遵守 skill-slim 主干行数预算（check-docs 门禁绿）"
    status: completed
  - id: t5-arkts-lint-provider
    content: "hmos-app arkts_lint provider 补齐（【2026-07-16 codex 表述修正】准确范围=**补 lite/exit 轨与修正链路的 lint 派发空缺**——full 轨 coding 已跑 runStructureChecks + arkui 静态规则（coding-host-rules.ts:1353、check-coding.ts:542），不得把反馈事故整体归因于 checkCodingLint 缺失）：profiles/hmos-app/harness/coding-host-rules.ts 实现并导出可选接口 checkCodingLint（profile-host-loader.ts:25 契约；check-exit.ts:160 与 correction-commands.ts:599 派发点已备）——复用既有高置信静态规则快速子集（不跑 hvigor 编译）；新增规则（候选：static enum 正则、同文件 dead import）**必须配真实宿主反例语料 + 明确误报预算**，逐条评审，误报超预算即降 WARN 或撤；Namespace.InnerClass 破坏类低置信项留 arkts-pitfalls.md 散文自检；复用行内豁免机制；check-exit lint 缺项 WARN 转为真实 lint 行。验收口径不承诺「减少 80% review BLOCKER」类反馈原文数字"
    status: completed
  - id: t6-toolchain-probe-truth
    content: "环境能力探针升级与事实持久化（07-16 宿主事故「编译环境反复不正确」根治，t3 的可信探测前置）：(a) 探针分层【2026-07-16 codex 命名修正：hvigorw --version 只证 CLI 能启动，不得称端到端】binary_exists → cli_starts（真跑 --version）→ project_compile 态；【三轮 codex BLOCKER 采纳：compile 态必须三值，防首次编译死锁】project_compile = **unknown | verified | capability_failed**——unknown（首次运行/缓存失效）**允许一次真实编译**，绝不判缺口不 halt（否则新工程 preflight 在首次编译前就 halt，verified 态永无机会建立）；verified 仅由 hvigor wrapper 在真实编译成功退出后写入（check-personal-setup --ensure 只能探测 binary/cli_starts，**agent 声明不得升级 compile 态**）；capability_failed 仅由可信 wrapper 记录的环境/工具链类失败写入，且 failure code+证据+invocation 指纹均新鲜时才转 t3 显式 prerequisite 缺口——**普通源码编译失败不得污染工具链能力状态**；(b) hvigor 已知错误码**证据分层**分类器（codex BLOCKER 采纳，禁止过早固化结论）：00303217=sdk_home_missing_or_invalid（非仅「未设」；提示 framework 调用链已自动派生 hvigor-runner.ts:511-528）；00303168=sdk_component_missing（中性事实）——**仅当**同时取得 SDK manifest 格式/SDK 版本/hvigor 版本证据才升级为 sdk_layout_or_version_incompatible_suspected 并给装配套 SDK/降级/IDE 编译三选一指引；依据：07-16 事故记录里 agent 全程未走 framework 调用链（其 DEVECO_SDK_HOME 用 sdk/default 与 sdk/default/openharmony，framework 派生值为 {install}/sdk，config.ts:2159），「版本不兼容」属强推断非已证结论，宿主复验须含「framework 完整调用链重测一次」；【与 b4e7a2c9 边界】00303168 类失败不得当场 defer——正确链路=hvigor wrapper 按可信环境分类写 project_compile.status=capability_failed（含 failure_code+证据+指纹，t6c）→ 下次 phase preflight 读快照、**仅当新鲜**时以 prerequisite 缺口形态进 t3 出口；诊断头部化复用 b4e7a2c9 范式，其 buildCompactDiagnosticHeader 现落 UT 专用文件 **profiles/hmos-app/harness/ut-hvigor-test-failure.ts**（2dd47438 新增，305 行聚合模块，四 failure_kind 同在此文件），t6 实施时**先抽共享 diagnostic util** 再复用（避免 hvigor-runner 反向依赖 UT 聚合模块），不另造第二套约定；(c) 环境事实持久化——framework.local.json toolchain 段增**显式建模的 probe 子对象**（framework.local.schema.json 全树 additionalProperties:false 已坐实，仿 vision.canary 先例扩 schema）：探测时间/hvigor 路径+版本/SDK manifest 指纹/binary·cli_starts 层结论 + **project_compile 显式对象【四轮 codex BLOCKER 定案，杜绝布尔残留】**：{ status: unknown|verified|capability_failed, failure_code?（sdk_component_missing 等）, evidence[], invocation_fingerprint, observed_at, expires_at }——按 invocation 维度记录：指纹至少含 module/target/task(command)/product/buildMode + build-profile.json5 hash + hvigor/SDK 相关项目配置 hash（或 mtime）+ 影响编译的依赖锁定状态，任一变化/过期即失效回 unknown；**写入权限语义固定**：check-personal-setup --ensure 只能更新 binary/cli_starts 层；hvigor wrapper 真实编译成功→写 verified；wrapper 命中可信环境分类→写 capability_failed；普通源码编译失败→status 保持 unknown（可另记 last_attempt 供人读，不进 t3）；【四轮追补·实施约束（OpenSpec design/tasks 落实）】invocation fingerprint 由**唯一共享 helper** 计算，同时供 wrapper 写入方与 personal preflight 读取方消费——禁止读写双方各自拼指纹；capability_failed 转 t3 缺口用**新显式 prerequisite code**（如 deveco_toolchain_capability_failed），**不复用**既有 deveco_toolchain_missing（其语义=安装路径缺失，personal-setup-gate.ts:95）；agent 人工探明的信息只能落 binary/CLI 层与 known_quirks（纯人读备注，永不参与 gate 通过或状态升级），**compile 态 agent 不可写**；跨会话直读；(d) 环境判定纪律（文本，与 t4 同批落点）：凡断言环境缺工具链，必须先跑 framework 探测命令（detect-deveco --json / check-personal-setup --ensure）并引用其输出，禁止凭 command -v/PATH 检查自报「沙箱无 X」——未探测=未知，不是没有；(e) local schema/探针契约变更走 OpenSpec change"
    status: completed
  - id: t7-hylyre-knowledge-chain
    content: "hylyre 翻译知识链根治（07-16 宿主偶现「不知道怎么翻译 hylyre」，六断点已核实）：(a) 机器目录注入兜底（治本，【2026-07-16 codex 覆盖面修正】事故中 agent 实际读的是 harness 失败时自动写出的 derive-hint-from-plan.json——由 check-testing.ts:1795 一带独立 payload（schema:3）生成，同样无 catalog）——抽唯一 buildStandardHylyreDerivePayload()，统一供 ①CLI derive-hylyre-plan-hint ②device_test_run 缺派生计划时的自动 hint ③coverage/stale/lint 失败后的 hint 三处入口，payload 注入 allowed_step_roots + step_shape_catalog（对齐 adhoc-derive-payload.ts:77-85），schema 3→4 升级 + 旧 schema 兼容测试；agent 翻译时手边永远有机读步骤目录，不依赖文档已读/上下文未压缩；(b) 出口校验对称——把已存在但未接线的 STEP 级 lint（lintHylyrePlanStepRules/validatePlannedStepObject，derived-hylyre-plan.ts:315-441 + hylyre-planned-step-lint.ts:39-137）接入 check-testing 标准派生计划路径（与 adhoc 同强度 BLOCKER），非法步骤键与**当前 lint 支持的非法 selector 形状**秒级拦下给指引（【2026-07-16 二轮 codex 措辞修正】hylyre-planned-step-lint.ts:39 并不能验证全部 selector 形状/类型，验收不得写成"全部非法选择器"；补全 selector schema validation 记为可选扩展），不再只在真机炸；相关缺计划/lint 失败的 suggestion 直接点名 hylyre-planned-step-fields.md 与 hint 内 catalog（cursor：门禁 suggestion 比就近提示更强）；(c) 一致性门禁【2026-07-16 二轮 codex 采纳：只比版本标签不够——三处都写同一版本号不代表字段集合一致】——**键集实体比对**：PLANNED_STEP_ROOT_KEYS（keys.ts）↔ vendor wheel 内 planned_step_keys.py 实际键集（release 门禁解 zip 提取）↔ 文档/fixture 键清单，三方集合一致才 PASS；版本标签比对仅作辅助；顺手修当前 0.3.0/0.3.1 漂移；(d) 盲区门禁——addendum 普通相对链接（reference/*.md 类）纳入 resolvable 存在性校验（profile-skill-assets.ts 扫描当前跳过 reference/ 且不查相对链接，:271/:408-460）；(e) 就近提示（辅助）——device-testing-workflow-detail 4.5.3 翻译步骤加一句「翻译前若语法不在上下文，重读 hylyre-planned-step-fields.md」"
    status: completed
  - id: gates
    content: "验收：t2/t3/t6 涉及 receipt 契约/preflight 出口/local schema——**实施前先建对应 OpenSpec change/delta spec**（codex 采纳），不是只跑 openspec:validate；cd harness && npm test 全绿 + npm run openspec:validate + npm run release:verify；行号锚点按当前 HEAD **2dd47438**（b4e7a2c9 已落地）复核（本 plan 多数引用采自 bd5a87e1/2c48e038 时点）；默认路径零回归（未触发新路径时 hmos-app 既有夹具全不变）；t1 四出口一致性断言（script-report/summary/merged-report/console 同一 suggestion）+ ratchet allowlist 基线锁定；t3-min 坏态夹具【三轮同步：只断言 preflight 形态，**不断言 CheckResult/EvidenceValidationStatus 全链**（矩阵属已出窗 t3-full）】——缺口=诚实 BLOCK/停止照旧 / goal 侧 preflight 缺口不产生 agent_invoke_start、run_end=HALTED+halt_reason=await_human_capability_gap / 结构化 HARNESS_PREFLIGHT 可被 goal 消费 / resume 重检；t2 瘦身夹具（旧格式回归零变化 / 瘦身版未签拦、补签过 / manifest 幂等共存 / base-summary→骨架→check→closure-patch 时序断言 + 三负例 + 注入回归例）；t6 探针分层与错误码证据分层夹具（00303217/00303168 样本日志→结构化诊断，无证据不得输出 incompatible 结论；unknown 态允许首次编译不 halt；**capability_failed 且指纹新鲜→转 t3 缺口；普通源码编译失败→不进 t3、status 保持 unknown**；probe 快照写读+TTL 失效回归）；t7 统一 payload 三入口夹具 + schema 3→4 兼容 + STEP lint 接线夹具（非法根键/当前 lint 支持的非法 selector 形状/禁用 CLI 键→BLOCKER 带 suggestion；合法计划零变化）+ **键集实体三方比对**门禁夹具（wheel↔keys.ts↔文档，非版本标签）；宿主实测回灌——完成后引导 2.3.0 反馈宿主升级 3.0.0 实测（与 d4a7c1e8 gates 的宿主实测联动，非本 plan 门禁）【2026-07-16 收口证据：harness npm test 全绿（typecheck+unit 2064+fixtures 44）；openspec validate --all --strict 40/40（含 t2/t3/t6 三 change 与迁出的 goal-process-e2e-fixture）；四出口一致/ratchet 基线/t3-min 缺口形态（invoke-gate 真实链夹具）/t2 瘦身 16 例/t6 探针 12 例/t7 三入口+键集比对夹具全数在 unit 套件内；行号锚点已按 HEAD 2dd47438 复核；release:verify 除 plan-version 项外全 PASS——该项属发布时点门禁（其余 7 个在窗 plan 尚有 pending todo，非本 plan 范围）；进程级 goal e2e 用户拍板不立项——由宿主工程真实需求重跑实测承载（§八 Round 5/6）；宿主实测回灌为发布后引导动作】"
    status: completed
isProject: false
---

# 宿主反馈回灌(2.3.0) — 报错自解释 / 能力缺口诚实化 / receipt 瘦身（maison 3.0.0）

> 文件名保留原始命名（hash e6a3c9f4 被 b4e7a2c9 等外部引用），标题以本行与 frontmatter `name` 为准。

## 版本绑定（BLOCKER 合规）

- 当前在研窗口 = `package.json.version` = **3.0.0**，本 plan 为在窗 plan（`version: 3.0.0`，无 `deferred_to`）。
- 体量为 minor 级修补 + 一个中型机制（t3-min），与 3.0.0 大窗口相容；发版前 todos 须全 completed / cancelled / 显式顺延（t3-full 已 cancelled，不参与完成度）。
- 与同窗 plan 的关系：**依赖 d4a7c1e8（轻量化重构，C0-C5 已完成）与 e3a9c5d1（假 PASS 根治，已提交 bd5a87e1）的既有机制，只消费不改动**；**b4e7a2c9（ut 签名缺口误归类）已落地（commit 2dd47438=当前 HEAD），本 plan 的前置依赖已满足**，互补不重叠（见 t3d）；不阻塞 android plan（5e3400c3）。

## 一、反馈来源与逐条裁定（核实时点 HEAD=bd5a87e1；当前 HEAD 已推进至 **2dd47438**（d9b4f7e2→2c48e038、b4e7a2c9→2dd47438 相继落地），实施时行号锚点须复核）

反馈文档：`D:\97.log\问题反馈\07-16\# Harness 工程分析与 Skill 化建议.md`（基于 2.3.0；现 HEAD 已隔 2.4.0→3.0.0 两个大版本。注：材料最初读取于 07-15\，07-16 已被移动至 07-16\，以文件系统现状为准）。

| # | 反馈条目 | 裁定 | HEAD 事实依据 | 落点 |
|---|---|---|---|---|
| 缺陷1 | 子 agent 报告严重失真 | **部分有效** | framework 无"生产型子 agent"概念（只承认只读 verifier/explore：agents-entry-detail.md §4.1、verifier.md tools 无写权限）；diff_within_scope / closure-attestation / evidence-manifest 以磁盘/git 为键兜住结果，但派发环节零指导 | t4 |
| 缺陷2 | spec/plan grep 计数错误（43 vs 26） | 弱有效 | behavioral-principles 已有"不确定→工具验证"，但无"量化 inventory 须脚本产出"表述 | t4（一句话） |
| 缺陷3 | 弱模型长上下文累积错误（同文件改 5+ 次） | 部分有效 | "逐文件闭环（写一个→ReadLints 零 error→再写下一个）"规约已有；但沙箱无 IDE 时 ReadLints 缺位，且 coding.lint provider 空缺 → lint 环节真空 | t5 |
| 缺陷4a | verdict 字面匹配 bug（"不通过".includes("通过")） | **已根治（过时）** | 唯一入口 extractDeclaredVerdict（markdown-parser.ts:320，最长优先扣除+歧义拒绝）+ 元门禁单测锁死全 scripts 树（verdict-extraction.unit.test.ts:143），plan c3f08a21 | 无 |
| 缺陷4b | source_code_paths 写"路径+描述"被拒且无解释 | **有效** | normalizeStringArray（context-exploration.ts:167）不支持对象形态；`_exist` 报错无 suggestion 无示例；模板无内联示例 | t1b |
| 缺陷4c | contracts.yaml 路径前缀不一致难定位 | **有效** | file_completeness（check-coding.ts:64-87）只报"N/M 缺失"，不诊断前缀错配（lite 轨 check-exit.ts:100 反而有三级回退提示） | t1c |
| 缺陷5 | 沙箱无 hvigor/lint/Hypium → 反复失败 6+ 次 | **有效（解法须改）** | 能力档 profile 静态二态（BLOCKER/SKIP，capability-registry.ts:24）；工具链缺失=deveco_toolchain_missing BLOCK+引导安装（personal-setup-gate.ts:376），无 defer 出口、headless 下无 halt 分流 | t3 |
| Skill1 | ArkTS 静态分析器 | 有效（**非 skill**） | 底座在（ast-analyzer/arkui-static-rules/coding-host-rules）；点名的四类检查未实现；arkts_lint provider 空缺退化 WARN（check-exit.ts:159-171） | t5 |
| Skill2 | Caller-Site 影响分析器 | **不做** | code-graph 单模块策展索引、call_edges 仅模块内；fan-out-scanner 仅 import 级计数。场景窄（namespace 重组特定任务）成本高；extension manifest 口已备 | 不做清单 |
| Skill3 | Harness 产物自检器 | **不做（已有等价物）** | 门禁幂等可重跑 + `--summary --failures-only` 即自检；真缺口是报错不自解释 | t1 替代 |
| Skill4 | BLOCKER 速查+修复模板 | **不做（改报错）** | 无编号体系（id 为语义字符串可 grep）；独立速查文档必然漂移；suggestion 全覆盖+来源内联更可靠 | t1a/t1d 替代 |
| Skill5 | 强校验子 agent prompt 模板 | 不做 skill（做纪律文本） | 同缺陷1 | t4 |
| 演进1 | 减凭证：trace+receipt 合并 / exploration 只首次 | **合并架构性否决；exploration 已实现；瘦身采纳（07-16 二轮定案，取代预填）** | receipt=信任链锚、trace=被保护 output，合并命中自引用环 throw（phase-evidence-manifest.ts:326-330）；facts.md per-feature 共享已落地（context-facts.ts:31）；receipt 的 summary 镜像块与 q1/q3 属机器可派生——直接删除、check-receipt 改读 summary | t2 |
| 演进2 | 修 verdict bug | 已根治（过时） | 同缺陷4a | 无 |
| 演进3 | 沙箱能力声明自动跳过 BLOCKER | **方向对、解法须改** | "自动跳过"= 重开 e3a9c5d1 刚封死的 fail-open 通道。视觉保真档的 clamp+DEFERRED+人签 receipt（fidelity-shared.ts:437-451）是概念先例，但**本窗落点=t3-min 诚实停止**（人签 waiver 放行属已出窗的 t3-full，硬依赖签发侧落地） | t3-min |
| 演进4 | harness-runner 启动子 agent 前注入校验 prompt | **架构误解** | harness-runner 不 spawn 任何 agent（文件头:18"不调用任何 AI API"）；spawner 仅 goal 链路 agent-invoke.ts | t4（文本替代） |
| 演进5 | schema 校验规则显式化+示例 | **有效** | source_code_paths 等隐式规则仍隐式，报错文案质量参差（抽查：优/良/中/差混布） | t1 |

## 二、设计原则：薄 harness 与强弱模型的平衡（对用户命题的架构回答）

**1. 分档基座已存在，且刻意不以"模型强弱"为输入。** d4a7c1e8 已落地"重量 = f(track, evidence_profile, runtime_context)"：变更风险定流程厚度（direct/lite/full），运行上下文可核验性定证据厚度（interactive×balanced 可减 verifier/trace，headless/goal 恒 strict）。**档位输入是变更风险与上下文可审计性，不是模型自报的强弱**——bc-openCard 事故证明强模型在无人值守下同样 fake-pass；出口门禁防的是激励错位，不是低智商。业界"harness 应越来越薄"的正确读法：**变薄的是方法论层（教模型怎么干活的文本），不是信任层（证明活干成了的凭证）**。强模型时代方法论文本趋近于零（skill-slim 主干+条件加载已在此方向），信任层反而因无人值守占比上升而更重要。

**2. 本 plan 的增量 = 第三个变量：环境能力缺口显式化（t3/t6）。**（07-16 二轮修订）现状能力档是 profile 静态二态，环境缺口只能死磕或换 generic 整段跳过。本窗收敛为**诚实停止**：available（真跑）| capability gap declared（preflight 结构化出口——交互态双出口话术、headless 首触 halt，不放行不绕过，修好 resume）| skipped（profile 静态声明）。弱环境（≠弱模型）从"反复失败 6+ 次"变为一次显式决策且不再烧预算；人签 waiver 放行是未来态（硬依赖 confirmation-credential-issuance，已出窗）。

**3. "薄"的可持续路径 = 确定性工作下沉给机器（t1/t2/t7）。** Anthropic 原则"确定性工作交脚本"反向应用：凡机器可派生的凭证字段不该存在于 AI 手填面（t2 直接删除 receipt 的 summary 镜像块与 q1/q3，check-receipt 改读 summary 唯一事实源）；凡门禁报错必须自带修复指引（t1 规范化层 resolveEffectiveSuggestion 在 ScriptReport 落盘前补齐、四出口一致 + factory 强约束 + ratchet 收紧存量）；凡内部工具语法必须由机器目录携带（t7）。这对强模型是减负（不用教它填表），对弱模型是护栏（表是机器管的，错不了）——**同一笔投入同时服务两端，这才是平衡的解，而不是为强弱模型各维护一套流程**。

**4. 规则总量"增必有出口"。** 本 plan 净效果：receipt 手填面结构性缩减（镜像块+q1/q3 删除）、skill 文本 +~20 行（t4）、不新增任何 skill、不新增 AI 侧必交产物；新增机器件（t1 兜底/factory、t2 骨架、t3 preflight 出口、t6 探针快照、t7 payload builder+lint 接线、t5 provider）全部为一次性成本 + 默认路径零行为变化。

## 三、各刀详细设计

### t1 · 报错自解释基线

（07-16 二轮修订，与 todo 同步）

- **(a) suggestion 兜底三层化**（四轮同步：不是渲染层）：①规范化层——共享 `resolveEffectiveSuggestion(check, phase)` 在生成 ScriptReport **之前**对缺 suggestion 的 BLOCKER 补统一 fallback（check id + 速查指引），使 script-report.json / summary.json / merged-report / console --failures-only 四出口一致（只改 merged-report 渲染面会漏 summary-blockers 透传与控制台出口）；②类型化 factory——新增/迁移 checker 强制 suggestion 必填；③ratchet——只收紧显式旧构造（allowlist 只减不增，参照 verdict 元门禁范式），扫描范围含 `harness/scripts/**` 与 `profiles/*/harness/**`。静态扫描不是唯一安全网。
- **(b) source_code_paths**：**不扩对象形态**（多消费点字符串化风险，见 §八）；只补报错 suggestion（纯路径格式示例）+ `harness/templates/context-exploration.md:17` 与 facts 模板内联示例行。
- **(c) contracts 前缀诊断**：file_completeness 对缺失文件做 basename 一次性仓内检索（限 architecture 声明的层目录，防全仓扫描开销），命中即附"疑似前缀不一致，实际存在于 X"。只加诊断信息，判定逻辑零变化。
- **(d) BLOCKER 来源**：CheckResult 增可选 `source`，由编排边界（safeRun(fn, origin)/profile dispatch，先例 check-coding.ts:542）填充；无 origin 回退 `check-<phase>.ts` + fallback suggestion；summary-blockers.ts 与 summary.schema.json 同步扩可选字段（additionalProperties:false，须显式建模，向后兼容）。

### t2 · receipt 瘦身（2026-07-16 重设计）

原"机器预填镜像字段"方案被 codex 坐实两个问题后重设计：①实际时序是 `tryValidateReceipt`（:693 一带）先于 summary 落盘——runner 预填 summary 镜像构成 receipt↔summary 循环依赖；②在 process.exit 前预填 exit_code 不严谨。**更薄的解：不预填可派生字段，而是把它们从 receipt 里删掉**——check-receipt 直接读 summary.json 作唯一事实源（verdict/gate_fingerprint 交叉核验 :352-374 既有，扩为全量），receipt 只保留机器不可替代的自证：agent 身份、claimed_completion_at/commit_sha、verifier 摘录（q2）、反假设 checkbox、testing_run_artifacts。q1（重复 trace_json.path）与 q3（现状只查非占位路径、无真 diff 对账）随镜像块一并删除。

- **执行时序（三轮 codex BLOCKER 定案——删镜像字段只消字段重复，不消执行依赖环：现状 receiptValidation(:693)→writeRunSummary(:704)→summary 内嵌 receipt_status(:834)）**：writeRunSummary 拆两段——base summary（无 receipt 依赖，feature/phase/verdict/blocker_count/gate_fingerprint 先落盘）→ PASS 且缺 receipt 时生成骨架 → check-receipt 读本次 base summary → closure patch 回填 receipt_status/closure_status/next_action。对账强度：feature/phase 精确匹配 + PASS 且 0 blocker + fingerprint 新鲜属当前 run；summary 缺失不得静默。
- **安全检查迁移**：script_harness.command 的预加载注入扫描（check-receipt.ts:340，P0-7④ 伪签事故防线）不随镜像块删除——process-integrity 观测迁移 summary/trace 侧，或证明 runner 侧全覆盖并保留攻击回归测试后方可删。
- 兼容：check-receipt 双格式过渡（旧格式照旧全量校验），evidence-manifest 的 receipt 规范化哈希/无环封装序零变化；契约变更先落 OpenSpec change。
- 最小骨架：仅 `verdict===PASS` 且 receipt 不存在时幂等生成瘦身版骨架（cursor 选项 1——FAIL 跑不留半真骨架），自证字段占位、checkbox 全未勾；骨架不构成闭环。
- 净效果比原方案更彻底：AI 手填字段从"预填后少填"变为"结构上不存在"，半真凭证攻击面同步消失。

### t3 · 工具链能力缺口诚实化（2026-07-16 拆分：本窗 t3-min + 顺延 t3-full）

**拆分动因（双审 BLOCKER）**：[confirmation-receipt.ts:19-21](harness/scripts/utils/confirmation-receipt.ts:19) 明示签发侧属后继 change `confirmation-credential-issuance`、未落地前一切校验 INVALID——原 t3 的 waiver 双选通道今天是**死入口**。且"缺能力就诚实停止、修好环境 resume"本来就是更薄、更贴根因的形态。

**t3-min（本窗，07-16 二轮 codex 减薄采纳——缺口发生在 phase 开始前的 preflight，agent 尚未开跑，无需贯穿证据链）**：
1. **交互态双出口话术**：引导安装（默认）| 用户确认后诚实停止（记录缺口声明与答复；「确认」只是停止的知情记录，**不构成授权**）——无凭证签发依赖，不放行不绕过，resume 恢复。
2. **机器可读 preflight 出口**：ensurePersonalSetup 返回结构化 preflight result；harness-runner 在 exit 前输出/持久化 HARNESS_PREFLIGHT（现状 :387 一带裸 console.error+exit 1，goal 侧无从分类）。
3. **headless/goal halt（三轮 codex 插入点定案）**：goal-runner 在每 phase 每 attempt 的 `agent_invoke_start` **之前**直接调共享 preflight（初跑与 --resume 均重检）——不等 harness 侧出口（那时 agent 已烧一轮）；缺口时不产生 agent_invoke_start，直接 run_end=HALTED + halt_reason=`await_human_capability_gap` + 非零退出；**不进 CUMULATIVE_HALT_FAMILY**（无累计语义），不触碰 CheckResult/EvidenceValidationStatus/receipt/feature-completion 任何契约。
4. **边界**（维持 b4e7a2c9 双侧写死条款）：只认显式前置能力码；四个运行后 failure_kind 永不属于本通道。

**t3-full（已取消出窗，设计留档）**：registry 签发的 `capability_gap_waiver` 放行通道 + `deferred_by_waiver` 校验态 + AWAITING_HUMAN_REVIEW 封顶 + 红线不豁免 + 完整状态传播矩阵（probe → CheckResult → verdict → summary → evidence snapshot → goal failure_kind → closure → feature completion 逐跳显式建模，新枚举不 overload 视觉专属 DEFERRED_CAPABILITY_MISSING）——硬依赖 confirmation-credential-issuance（签发侧）落地，俟排期后**另立独立 plan** 绑定该版本窗口重建；todo 已标 cancelled，不参与本窗完成度。

### t4 · 派发纪律（纯文本）

落点 agents-entry-detail.md §4.1 新小节 + behavioral-principles 一句，合计 ≤20 行，遵守 skill-slim 主干预算。核心三句：派发写码子 agent 的 prompt 最低纪律（前置 Read 验证/不存在即 STOP、后置自验、报告=实际清单+自验输出）；**子 agent 报告不构成任何闭环凭证**，主 agent git diff 对账后才可声明；门禁责任不可下放。量化 inventory 须脚本产出留痕。

### t5 · arkts_lint provider

接口契约已备（profile-host-loader.ts:25 可选 `checkCodingLint`；check-exit.ts:160、correction-commands.ts:599 两个派发点空转中）。实现：hmos-app coding-host-rules.ts 导出 checkCodingLint = 既有静态规则快速子集（不跑 hvigor）；新增规则高置信门槛逐条评审（static enum 正则可靠；dead import 需宿主样本校准误报；Namespace.InnerClass 类低置信留散文手册）。lite 轨 exit 与修正链路即刻受益；full 轨 coding 阶段结构检查已有 runStructureChecks，不重复。

## 四、明确不做清单（防范围蔓延）

| 项 | 理由 |
|---|---|
| trace + receipt 合并 | 凭证信任链架构性阻断：receipt=哈希链锚（持 manifest 指针+被规范化哈希），trace=被保护 output（字节精确哈希），合并直接命中自引用环 throw（phase-evidence-manifest.ts:326-330）；两种哈希口径不可共存一文件 |
| Caller-Site 影响分析器（skill/工具） | 场景窄（接口重组特定任务）、符号级全仓反查在 ArkTS 无 parser 下成本高误报多；宿主可经 extension manifest 自挂；plan 阶段"接口破坏点须列入 contracts"已是既有纪律 |
| BLOCKER 编号体系 + 独立速查文档 | 语义 id 已可 grep 直达源码；独立文档必然漂移（doc_freshness 历史教训）；t1a/t1d（suggestion ratchet + 来源内联）以更低维护成本覆盖同一诉求 |
| harness 机器注入子 agent prompt | harness-runner 不 spawn agent（架构事实）；交互态派发是宿主 agent 自主行为，机器注入点不存在；goal 链路整阶段执行体已有完整 prompt 组装 |
| 为强/弱模型维护两套流程或以模型身份定档 | 违背"可信的不是模型，是运行上下文+可审计出口"（d4a7c1e8 既定哲学）；模型自报强弱不可信，且同一模型在交互/无人值守下风险迥异 |
| source_code_paths 扩 {path,note} 对象形态 | 多消费点（backfill-context-exploration/goal-checkpoint/exploration-strategy 等）各自字符串化，扩 schema 产 [object Object]；描述信息已有模板正文表格承载（07-16 二轮定案） |
| 本窗做 capability waiver 放行 | 签发侧（confirmation-credential-issuance）未落地，一切校验 INVALID——做了就是死入口或假凭证通道（t3-full 已出窗） |
| 任何新 skill | 各刀全部落在 checker 文案/receipt 瘦身/preflight 出口/纪律文本/profile provider——没有一件是"教 agent 新流程"，做成 skill 只会增加加载面 |

## 五、开销评估（用户关切：不能带来更大开销）

| 刀 | 一次性成本 | 运行时开销 | 净收益 |
|---|---|---|---|
| t1 | 中（规范化层 resolveEffectiveSuggestion+factory+ratchet+文案+schema 字段） | ≈0（basename 检索限层目录） | 直接消灭"重跑→猜→重跑"来回；四出口一致；弱模型 self-serve 修复 |
| t2 | 小-中（模板/check-receipt 瘦身+双格式兼容+骨架+夹具，OpenSpec 先行） | ≈0 | receipt 手填面结构性缩减，半真凭证攻击面同步消失 |
| t3-min | 小（preflight 结构化出口+双出口话术+goal halt 消费） | 默认路径零变化 | 整类"环境缺口死循环"事故消除；headless 不再烧预算；不触碰证据链契约 |
| t4 | 极小（≤20 行文本） | +少量常驻 token | 派发失真类事故有据可循 |
| t5 | 小-中（provider 聚合+规则校准+反例语料） | lint 子集秒级 | lite/exit 轨与修正链路 lint 真空补齐；review BLOCKER 左移 |
| t6 | 中（探针分层+错误码证据分层+local.json probe 子对象 schema） | 探测期 +一次 hvigorw --version（秒级） | 整类「环境误判污染多轮凭证+跨会话重复摸索」消除；t3-min 出口有可信探测依据 |
| t7 | 小-中（统一 payload builder 三入口+已有 lint 接线+键集实体比对） | 派生提示 JSON +少量字节；STEP lint 秒级 | 「偶现失忆」机制性消除；非法步骤不再等真机才炸；键集漂移有门禁 |

## 六、宿主新增两事故（07-16）根因与根治（t6 / t7，随本 plan 一并 review）

### 事故 A：「编译环境反复不正确」→ t6

对话记录：`D:\97.log\问题反馈\07-16\编译环境反复不正确.txt`（4288 行，全程复盘）。事故链：

1. agent 用 `command -v hvigorw`（只查 PATH）自报「沙箱无 hvigor/ArkTS 编译器」，把错误结论写进多轮 receipt/trace/review 报告（"Sandbox lacks hvigor"、verifier 未跑）；
2. 用户人工点破后才发现 DevEco Studio 装在 `D:\Program Files\Huawei\DevEco Studio`——**detect-deveco.ts:64 的候选路径第一条就是它**，探测器一扫就中，但整个流程里探测器从未被调用（任务是直接指令链，不走 phase 门禁；agent 也未被要求引用机器探测）；
3. 随后 agent 手动 bash 调 hvigorw 又踩 00303217（DEVECO_SDK_HOME 未设——**framework 的 hvigor-runner.ts:511-528 早已自动派生该变量**，绕开框架调用链才会踩）；
4. 该机 CLI 编译持续失败（00303168=**sdk_component_missing**，中性事实）；agent 深挖 hvigor 源码指向 SDK 描述文件格式不匹配（sdk-pkg.json vs oh-uni-package.json），但**全程未走 framework 调用链**（其 DEVECO_SDK_HOME 取 sdk/default 与 sdk/default/openharmony，framework 派生值为 {install}/sdk，config.ts:2159）——「hvigor/SDK 版本不兼容」属强推断而非已证结论，须 framework 完整调用链复测确证（t6 宿主复验项）。无论最终归因如何，**「IDE GUI 能编、CLI 编不了」这种能力粒度，存在性探测（hasHvigor=fs.existsSync）两头都判错**；
5. 血泪探明的全部环境事实（hvigorw 路径、SDK_HOME 语义、CLI 编译失败及相关证据）不落盘，死在对话里——下个会话重演，即「反复不正确」的机制性原因。

根因分层：①环境判定无纪律（agent 可自报，探测器可被绕过）；②探针只查存在性、无 CLI 启动/真实工程编译的分层验证、无已知错误码分类；③环境事实无持久化通道。分别对应 t6(d)/(a)(b)/(c)。注：该宿主在 2.3.0，HEAD 已有的自动探测写 local.json、SDK_HOME 自动派生升级即得，但上述三缺口 HEAD 同样存在。

### 事故 B：「hylyre 翻译偶现失能」→ t7

Hylyre 是内部工具，模型训练数据里没有它——agent 的全部语法知识只能来自 framework 注入。六断点（已逐一核实文件:行号，见 t7 todo）：

| # | 断点 | 事实 |
|---|---|---|
| 1 | 语法文档离入口 2-3 跳 | SKILL.md(139 行瘦身版):13-17 条件索引 → workflow-detail:25 → addendum:101/148 相对链接 → `hylyre-planned-step-fields.md`(123 行，真正的语法教学) |
| 2 | 无「已读」证据 | 框架门禁明令禁止强制全读（docs-rules.yaml:72-80 黑名单），条件加载是否发生无任何机器可查证据 |
| 3 | 出口校验不对称 | check-testing 标准路径只跑 NAV lint（:1984）；**STEP 级 lint 已写好但从未接线**（仅即席路径在用）——非法步骤键静默过门禁，只在真机炸 |
| 4 | 版本漂移 | 教学文档/键 SSOT 标 0.3.0，vendor wheel 已是 0.3.1，无一致性校验（仅人工同步纪律） |
| 5 | 文档在门禁盲区 | fields.md 非 skill-assets 资产键，addendum 相对链接与 reference/ 目录都被 resolvable 扫描排除——缺失/断链静默 |
| 6 | 无压缩后兜底 | 即席派生 payload 注入 `allowed_step_roots`+`step_shape_catalog`（机器目录），**标准 feature 派生提示没有**；长会话压缩丢知识后无就近重读锚点也无机器兜底 |

「偶现」的解释：断点 1+2+6 叠加——某些会话 agent 恰好读了文档且上下文未压缩就正常，反之即「突然不知道怎么做」。根治主线与本 plan 设计原则同构：**知识由机器携带**（输入侧 t7a 注入步骤目录、输出侧 t7b 门禁校验），文档退为辅助——不再赌 agent 读没读。

### 与 b4e7a2c9（**已落地，commit 2dd47438=当前 HEAD**）的交互矩阵与实施顺序（2026-07-16 精读复核；四轮更新状态）

b4e7a2c9 实际落地面（2dd47438 复核）：**新增 ut-hvigor-test-failure.ts**（305 行——buildUtHvigorTestFailDetails/buildCompactDiagnosticHeader/四 failure_kind 全在此）、hvigor-runner.ts（onDeviceFailureEvidence 透传）、ut-host-impl.ts（瘦身为消费方，-84 行）、hdc-runner.ts 微调、goal-runner.ts 一行枚举词、business-ut-workflow-detail.md 话术。classifier/personal-setup-gate 零改动。t1-t4 全 completed，仅剩 t5 宿主复验（可与本 plan gates 的宿主实测回灌同车）。

| 本 plan 刀 | 交互 | 结论 |
|---|---|---|
| t3-min | 边界已双侧写死（其兼容表末行 ↔ 本 plan t3(d)，同一次 round2 对齐产物）；其 halt=运行后失败分类求人修环境，t3-min halt=运行前 preflight 缺口诚实停止（放行属已出窗的 t3-full）——两个时点两种语义，互补不冲突 | 无冲突；实施时守住"四 failure_kind 永不属于本通道" |
| t6 | **交叠最大**：同动 hvigor-runner.ts；其建立的诊断范式（≤180 首行纯函数/结构化证据透传/禁文本分类/800→300 存活测试）正是 t6(b) 要复用的地基 | **必须 b4e7a2c9 先落地，t6 基于其 HEAD 实施并复用范式**，禁止并行改同文件、禁止自造第二套 header 约定 |
| t6(d)/t4 | 其 business-ut 话术（禁自创环境故事/引用分层诊断）与 t6(d) 纪律（断言缺工具链前必须跑探测）同主题不同落点（skill 细则 vs 入口通用层） | 互补；t6(d) 实施时核对其已落话术保持口径一致 |
| t1(d) | summary-blockers.ts 增可选 source 字段 vs 其 t4⑥ 拿 buildSummaryBlockers 做 800→300 存活断言 | 纯顺序问题：t1(d) 在其测试收敛后加（可选字段不改 excerpt/截断，语义兼容） |
| t1(a) | 三层化后规范化层 fallback 覆盖全部 BLOCKER（含 profile 层）；ratchet 范围含 profiles/*/harness/**，其新增构造自带 suggestion 不会入 allowlist | 兼容；其已合入（2dd47438），ratchet 基线可锁定 |
| t2/t5/t7 | 文件零交集（receipt 骨架 / coding-host-rules / device-testing 派生链） | 无交互 |

其分析对本 plan 的正向输入：07-13「.p12 调试证书/密码 123456」自创故事事故与本 plan 事故 A 是同一行为模式的两个切面——b4e7a2c9 治「失败后诊断被埋+话术跑偏」，t6 治「失败前探测被绕+事实不落盘」，前后夹击。

## 七、已拍板决策（用户 2026-07-16 定案）

1. **t3 覆盖面**：交互态双出口 + headless/goal **两模式都做**（headless 是事故高发区）。【07-16 多轮评审后语义收敛：t3-min 诚实停止；headless 形态=goal-runner 在 agent_invoke_start 之前 preflight、缺口首触直接 run_end=HALTED（非 halt-confirm 对话）；waiver 放行属已出窗 t3-full——覆盖面决策不变，放行能力受签发依赖门控】
2. **t5 本窗口做**（3.0.0）：反馈用户的缺陷 3/Skill1 都指向它，且派发点已空转。
3. **t2 生成方式**：门禁 PASS **自动幂等生成**（零新命令）。【07-16 双审后 t2 重设计为"瘦身+最小骨架"，自动幂等生成的决策沿用于骨架】

**开工闸门**：plan 已定稿，**等用户明确下令后才开始实施**。实施顺序（2026-07-16 融合 codex/cursor 建议修订）：
1. ~~b4e7a2c9~~（**已落地 2dd47438，前置满足**——顺序从下一步起）
2. t1（缩减版）+ t4（低风险，文本+规范化层兜底）
3. t7（独立、高收益，治偶现失能；含统一 payload builder）
4. t2（重设计后的 receipt 瘦身，OpenSpec change 先行）
5. t6（可信探针+错误码证据分层+快照；基于 b4e7a2c9 落地后的 HEAD，先抽共享 diagnostic util）
6. t5（可与 t6 并行）
7. t3-min（诚实 halt/双出口；依赖 t6 可信探测）。t3-full **已取消出窗**（todo 标 cancelled，不参与 3.0.0 完成度与 release:check-plans），俟 confirmation-credential-issuance 排期后另立独立 plan 绑定该窗口

## 八、外部 review 记录（2026-07-16，codex + cursor 双独立评审；已逐条 ground-truth 核实后落盘）

codex 判"有条件通过，修订后再实施"（2 BLOCKER）；cursor 判"整体质量高，1 个硬依赖缺口"。处置全部反映在上文 todos/设计节，此处留档：

| 意见 | 来源 | 核实 | 处置 |
|---|---|---|---|
| BLOCKER：t3 依赖不存在的签发能力（confirmation-receipt 只有消费侧，签发归后继 change） | codex + cursor 一致 | **成立**（confirmation-receipt.ts:19-21 白纸黑字；openspec 无 issuance change 目录） | t3 拆分：t3-min 本窗诚实停止/halt（无签发依赖）；t3-full 顺延、硬依赖 issuance【本行处置已被 Round 2 出窗决定与 Round 3 减薄/插入点定案 supersede，以 todos 现行文本为准】 |
| BLOCKER：t6 把 00303168 过早固化为"版本不兼容"——事故记录未走 framework 调用链（agent 用 sdk/default，framework 派生 {install}/sdk，config.ts:2159） | codex | **成立**（deriveSdkHomeFromInstallPath 返回 {install}/sdk 核实；事故 4085-4092 的 hvigor 源码深挖是强推断非 framework 链验证） | t6(b) 改证据分层：00303217=sdk_home_missing_or_invalid、00303168=sdk_component_missing，有 manifest/版本证据才升 incompatible_suspected；宿主复验含 framework 链重测 |
| t3 三态未贯穿类型/执行链（CheckStatus/EvidenceValidationStatus 无 deferred；personal setup 在 report 前 exit；feature-completion 只认两类 waiver 文件） | codex | **成立**（types.ts:57、runtime-policy.ts:57、harness-runner.ts:387 一带、verify-feature-completion.ts:126 全核实） | t3(c) 增状态传播矩阵，OpenSpec change 先行 |
| DEFERRED_CAPABILITY_MISSING 语义 overload（现为视觉专属 preflight 终态） | cursor | 成立 | 新枚举 capability_gap_declared，不复用 |
| t2 时序反了（tryValidateReceipt 先于 summary 落盘）+ 镜像预填循环依赖 + exit_code 预填不严谨 | codex | **成立**（harness-runner.ts:693 一带核实） | t2 重设计：删镜像字段与 q1/q3，check-receipt 直读 summary；骨架仅 PASS 且缺失时生成 |
| t2 预填范围写宽（q2/q3 非 summary 可派生）；零变化与半真凭证风险冲突 | cursor | 成立 | 并入 t2 重设计（瘦身后问题消失；骨架 PASS-gated） |
| t7 漏事故真实入口：check-testing 自动写出的 derive-hint-from-plan.json 是独立 payload（schema:3）同样无 catalog | codex | **成立**（check-testing.ts:1795 一带核实） | t7(a) 抽唯一 buildStandardHylyreDerivePayload() 供三入口，schema 3→4+兼容测试 |
| t1 不宜扩 {path,note}（backfill/goal-checkpoint/exploration-strategy 等多消费点各自字符串化） | codex | **成立**（grep 核实 4+ 消费文件） | t1(b) 收敛为只补示例+suggestion，不扩 schema |
| t1 ratchet 只扫 harness/scripts/** 漏 profile 层；静态识别数百构造点脆弱 | codex | 成立 | t1(a) 三层化：渲染层 fallback 兜底 + 类型化 factory + ratchet 只收紧显式旧构造，范围含 profiles/*/harness/** |
| summary.schema.json / framework.local.schema.json 均 additionalProperties:false，加字段须显式扩 schema | cursor | **成立**（两 schema 核实） | t1(d)/t6(c) 已注明 |
| t5 表述过宽（full coding 已跑 runStructureChecks+arkui 规则，空缺仅 lite/exit 与修正链路） | codex + cursor 一致 | **成立**（coding-host-rules.ts:1353、check-coding.ts:542） | t5 措辞修正 + 新规则须反例语料+误报预算 + 不承诺反馈原文数字 |
| t6 probe 快照不能只有全局布尔；须绑定版本/指纹/维度+TTL | codex | 成立 | t6(c) 已按此重写 |
| buildCompactDiagnosticHeader 在 UT 专用文件，应先抽共享 util | codex | 成立（b4e7a2c9 落点确在 ut 侧） | t6(b) 注明先抽 util 再复用 |
| 素材路径"07-15 应为 07-16" | codex + cursor | 【07-16 二轮改判：**成立**】一轮时该文件确在 07-15\（本会话开头读取成功），二轮实测已只存在于 07-16\——材料被移动，以文件系统现状为准 | overview/§一 已改指 07-16 并注明移动经过 |
| ground truth 基线应从 bd5a87e1 刷到 2c48e038；实施顺序遗漏 t6/t7 | codex | 成立（HEAD 已核实 2c48e038） | gates 增锚点复核项；七节顺序已重排 |
| t2/t3/t6 应先建 OpenSpec change/delta | codex | 成立（仓内惯例一致） | gates 首条写死 |
| t4 合理保持极小；t7 是最扎实部分；哲学段作后续 DX 否决基准 | 两家 | — | 维持不动 |

### Round 2（2026-07-16，codex "有条件通过" + cursor "设计层可定稿，文档层先对齐"；均已逐条核实）

| 意见 | 来源 | 核实 | 处置 |
|---|---|---|---|
| BLOCKER：todos 已新设计但正文大量旧稿（overview/§二.2/§三 t1/§五/事故A 真因/交互矩阵/裁定表演进1），实施者可能按旧稿开工 | codex + cursor 一致 | **成立** | 正文全量同步完成（name/overview/§一/§二/§三 t1·t2·t3/§四/§五/§六 事故A·交互矩阵/§七/§八），实施以 todos+§七 为准的原则写入 overview |
| BLOCKER：t3-full 以 pending 留在 3.0.0 会卡 release:check-plans（版本窗口合规） | codex + cursor 一致 | **成立**（发布门禁要求全 completed 或显式顺延） | 取三选一之「标 cancelled+正文留档指针」：todo 已 cancelled，设计留 §三，俟 issuance 排期另立独立 plan 绑定该窗口（选项可由用户改判为拆 plan） |
| t3-min 偏重：preflight 缺口无需贯穿 CheckResult→…→feature completion；不需进 cumulative halt family | codex | **成立**（缺口发生在 agent 开跑前） | t3-min 减薄为：结构化 preflight result + HARNESS_PREFLIGHT 持久化 + goal run_end=HALTED/halt_reason=await_human_capability_gap + 非零退出；状态传播矩阵移交 t3-full 留档 |
| t1(d) checker source 无法由 report-generator 凭空推导 | codex | **成立**（CheckResult 无来源字段） | 定案：编排边界（safeRun(fn,origin)/profile dispatch）附 origin，无 origin 回退 check-<phase>.ts+fallback |
| t6 缓存指纹不够细（多模块/配置变更复用风险）；known_quirks 不得作 gate 依据 | codex | 成立 | t6(c) 指纹扩 module/target/task+build-profile.json5 hash+工程配置 hash+依赖锁定态；quirks 与机器探测严格分离 |
| t7 版本标签比对不够，应比键集实体；"非法选择器"应限定为"当前 lint 支持的形状" | codex | **成立**（hylyre-planned-step-lint.ts:39 不验全部 selector 形状） | t7(c) 改键集实体三方比对（wheel 解包提取）；t7(b) 措辞限定+selector schema 记可选扩展 |
| t2 补对账强度与负向夹具（feature/phase 匹配、PASS+0、fingerprint 新鲜；旧 summary/他 feature summary 两负例） | codex | 成立 | t2(e) 已加 |
| 素材路径复核：07-15\ 已无该文件，只在 07-16\ | codex + cursor 一致 | **成立**（文件系统实测；材料系一轮后被移动） | 全文改指 07-16，§八 一轮驳回行改判 |
| plan 标题仍含旧叙事 | cursor | 成立 | frontmatter name 改「报错自解释 / 能力缺口诚实化 / receipt 瘦身」（文件名不动，防 b4e7a2c9 侧 hash 引用断裂） |
| 「口头确认」勿被读作授权 | cursor | 成立 | t3-min(a) 写死「仅知情记录，不构成授权」 |

### Round 3（2026-07-16，codex "有条件通过（2 实现级 BLOCKER）" + cursor "无新 BLOCKER，残留小不一致"；均已逐条核实）

| 意见 | 来源 | 核实 | 处置 |
|---|---|---|---|
| BLOCKER：receipt↔summary 执行依赖环未解——删镜像字段只消字段重复；现状 receiptValidation(:693)→writeRunSummary(:704)→summary 内嵌 receipt_status(:834)，check-receipt 读 summary 可能读到旧 PASS summary | codex | **成立**（三处行号全核实） | t2(f)：writeRunSummary 拆 base summary（无 receipt 依赖先落盘）+ closure patch 两段，时序拍板 base→骨架→check（读本次 base）→patch；验收补「本次 FAIL+上次 PASS summary 不得过」等三负例 |
| BLOCKER：project_compile_verified 近布尔 → 新工程首次编译前 preflight 死锁 | codex | **成立**（逻辑推演即证） | t6(a)：三态 unknown\|verified\|capability_failed——unknown 允许一次真实编译不 halt；verified 仅 wrapper 真实成功写入、agent 声明不得升级；capability_failed 且证据+指纹新鲜才转 t3 缺口；源码编译失败不污染能力态 |
| P1：goal 链 agent_invoke_start(:2101)→invoke(:2119) 在 harness 之前——等 HARNESS_PREFLIGHT 时 agent 已烧一轮 | codex | **成立**（goal-runner 行号核实） | t3-min(c)：preflight 前移到每 phase 每 attempt 的 agent_invoke_start 之前（含 resume 重检），缺口不产生 invoke_start 直接 HALTED |
| P1：t1 fallback 只覆盖 merged-report——summary-blockers.ts:42 原样透传、console(:507 一带)不打印 suggestion | codex | **成立**（两处核实） | t1(a)①：抽 resolveEffectiveSuggestion 在 ScriptReport 生成前规范化，四出口一致 |
| P1：t2 删 script_harness 会带走 command 预加载注入扫描（check-receipt.ts:340，伪签事故防线） | codex | **成立**（P0-7④ 注释实锤） | t2(g)：process-integrity 观测迁移 summary/trace 或证明 runner 侧全覆盖+保留攻击回归测试，方可删 |
| 残留：gates 仍写「状态传播矩阵逐跳断言」（属出窗 t3-full）；t7 gates 仍写「版本一致性」 | codex + cursor 一致 | 成立 | gates 已改 preflight 断言 + 键集实体比对措辞 |
| 残留：演进3 仍把人签 waiver 写成当前正确形状；事故A#5「CLI 不兼容结论」；§七「headless halt-confirm」；版本绑定漏 cancelled；Round1 t3 行未注 supersede | codex + cursor | 成立 | 五处已同步（演进3 注本窗落点、事故A 改「编译失败及相关证据」、§七 改 preflight 直接 halt、版本绑定补 cancelled、Round1 行加 supersede 注） |
| release 模式 check-plans 当前失败系 3.0.0 各 plan 正常 pending 所致，非 t3-full cancelled 导致 | codex | 属实（开发期预期行为） | 无需处置，留档防误读 |

### Round 4（2026-07-16，codex "接近可开工（1 BLOCKER）" + cursor "通过，可下令实施"；均已逐条核实）

| 意见 | 来源 | 核实 | 处置 |
|---|---|---|---|
| BLOCKER：t6 新三态与旧布尔契约混存同一 todo（(b) project_compile_verified=false、(c) 按 invocation 维度记录仍布尔措辞、agent 经 --ensure 回写与"agent 不得升级"冲突） | codex + cursor 一致 | **成立**（grep 坐实三处残留） | t6(b)/(c) 统一为 project_compile 显式对象 {status, failure_code, evidence[], invocation_fingerprint, observed_at, expires_at}；写入权限固定四条（--ensure 只更 binary/cli 层 / wrapper 成功写 verified / wrapper 可信分类写 capability_failed / 源码失败保持 unknown 记 last_attempt）；agent 只能写 binary/CLI 层与纯人读 quirks；gates 补两断言（capability_failed 新鲜→t3；源码错误→不进 t3） |
| P1：HEAD 已推进至 2dd47438，b4e7a2c9 已落地，plan 多处仍写"未实施/开发中/先合入" | codex | **成立**（git log 核实） | 版本绑定/§一/交互矩阵/§七 顺序/gates 锚点五处更新；buildCompactDiagnosticHeader 仍在 UT 专用文件，t6"先抽共享 util"结论不变 |
| P1：t1 正文仍写"渲染层 fallback"（overview/§二/§三/§五/交互矩阵） | codex + cursor 一致 | **成立** | 五处统一为"规范化层 resolveEffectiveSuggestion，ScriptReport 落盘前补齐、四出口一致" |
| P1：t2 process-integrity 二选一应拍板——runner 已有 runProcessIntegrityPreflight（harness-runner.ts:566）进 checks→report→summary，goal 侧有 sanitizeSpawnEnv | codex | **成立**（:566 核实） | t2(g) 定案：旧格式兼容期继续校验 command；新格式以 runner 侧 process_integrity CheckResult 为 SSOT；不新增 summary/trace 专用扫描；保留直启注入+goal 继承注入两类攻击测试 |
| 小修：事故根因"无端到端验证"与探针命名不一致；t3 用户答复应由宿主交互层记录（harness 不读 stdin、不新增确认 receipt） | codex | 成立 | 事故A 改"无 CLI 启动/真实工程编译的分层验证"；t3-min(a) 补记录责任归属与机器行为恒定条款 |
| gates 开头"新状态机"措辞略宽 | cursor | 成立（非必须） | 已改"receipt 契约/preflight 出口/local schema" |
| 追补（非阻塞）：t2 base summary 须完整 schema-valid+fail-closed+原子写（next_action 必填坐实 :24，base 阶段即写"未闭环"初值）；t6 指纹须唯一共享 helper 计算+capability_failed 用新显式 code（不复用 deveco_toolchain_missing 的路径缺失语义，:95 坐实） | codex | **成立**（两处 schema/代码核实） | 已作为实施约束写入 t2(f)/t6(c)，OpenSpec design/tasks 落实 |

### Post-impl Round 1–2（2026-07-16，codex+cursor 双审；处置已落 OpenSpec 各 change tasks「v3 修订」段）

- R1 三 BLOCKER+三 CRITICAL：恢复死锁（v1 peek→v2 交替授予）/ slim 伪 summary 夹具固化错误行为 / runHvigorAssembleApp 未包 probe（cursor C1）等——全部修复，全绿。
- R2：双入口空消费（v2→v3 粘滞授予）/ source_failure 清除旧 capability_failed / config digest 扩容 / lite-json-schema 替换 required-only / worktree_digest+run_id+短 SHA / run_end 带 halt_reason——全部修复，全绿。

### Post-impl Round 3（2026-07-16，codex「2 阻断+3 高优」；逐条 ground-truth 核实后全部成立，v4 批次修复）

| 意见 | 核实 | 处置 |
|---|---|---|
| 阻断1：v3 粘滞授予=无限放行窗口（环境没修 resume 恒放行烧预算；与 OpenSpec「resume 后仍缺口→再次 halt」验收冲突，测试还把该行为固化成绿灯） | **成立**（toolchain-probe.ts:398 + 测试 :142 坐实） | **授予模型整体废弃（v4）**：preflight 纯读恒拦截 capability_failed；解除仅三条可审计路径——config/DevEco/SDK 摘要漂移自动失效 / check-personal-setup --ensure 人工 reprobe（cli 真跑 --version 可启动才降级重置 unknown；仅 CLI 层可触达，preflight 消费的 ensurePersonalSetup 无权）/ wrapper 真实编译改写。未采纳 codex 的 run/attempt lease 方案：恒拦截+人工重置以更少机构达成同一安全性质（已知 capability_failed 永不静默放行；重置=人类权威动作留审计痕，重置后 unknown 与新工程首编译同信任级），且交互态无 attempt 语义、lease 需跨 goal/交互两态铺身份管道。recovery_probe_pending 废弃（schema 留兼容），INTEGRITY_SALT 换代 v2（旧记录失配按 unknown 安全迁移） |
| 阻断2：worktree digest 可被绕——untracked 只进路径清单（同路径改内容不可见）；根级构建/门禁输入不在绑定内；测试只写假摘要未验真实 dirty | **成立**（git diff HEAD 不含 untracked 内容；status 只给路径） | untracked 经 git ls-files 枚举并逐文件哈希内容；ROOT_CONFIG_PATHSPECS（framework.config.json/build-profile.json5/oh-package*/hvigorfile.ts/hvigor）纳入 pathspec；负例改真实 dirty（真改 untracked 内容→failed、真改根配置→failed），写读两端共用同一函数天然同口径 |
| 高优3：preflight 无 invocation 维度，invocation A 的 capability_failed 拦 invocation B | **成立**（capability-preflight.ts:81 坐实） | 按 codex 备选路线「不再命名为 invocation-specific」：capability_failed 收紧为**环境级**状态（ENV_LEVEL_CAPABILITY_FAILURE_CODES 白名单三码才可写入，非白名单只进 last_attempt 人读）——环境级失败对所有 invocation 成立，全局拦截是设计而非缺陷；指纹失效判定收窄到 verified，capability_failed 的 invocation_fingerprint 仅留痕（provenance）。未做 per-fingerprint 分桶：白名单三码全是装配层失败，分桶只会让同一环境故障按 invocation 重复烧编译 |
| 高优4：lite-json-schema 的 `key in props` 走原型链，{constructor:1} 实测逃过 additionalProperties:false | **成立**（实测复现） | required/properties/additionalProperties 全改 hasOwnProperty；补 constructor/toString/__proto__（JSON.parse own key）+ required 原型键四类负例 |
| 高优5：goal run_id 校验 fail-open（currentRunId 缺失即静默跳过） | **成立**（check-receipt.ts:438 坐实） | fail-closed 三分支：goal 缺 MAISON_GOAL_RUN_ID→slim_summary_run_identity_unavailable / summary 缺 run_id→slim_summary_run_id_missing / 失配→slim_summary_run_id_mismatch（与 §10 assumptions ledger 先例对齐）；三负例断言具体 issue id |
| 附带：capability-gap 两 goal e2e 夹具未勾，不应称实施完整 | 成立 | 一直如实未勾（tasks.md + gates todo 均留 pending），措辞维持「单测层兑现，goal e2e 夹具仍欠」 |

v4 后全绿：typecheck 0 / unit 2054 / fixtures 44 / openspec 39。

### Post-impl Round 4（2026-07-16，codex「1 阻断+1 验收缺口」；逐条核实全部成立，v5 批次修复）

| 意见 | 核实 | 处置 |
|---|---|---|
| 阻断：中文 untracked 路径绕过 worktree digest——git 默认 core.quotePath=true 把非 ASCII 路径转成 `"app/\344..."` 引号八进制转义串，非 -z 实现 readFileSync 必失败 → 恒 unreadable → 内容 A→B 摘要不变（codex 实测 digest 相等） | **成立**（od -c 实测复现转义输出） | ls-files 改 `-z` + NUL 切分不 trim；git 子命令失败不再吞成常量——返回 'git-error' 哨兵，check-receipt 任一侧见哨兵即 BLOCKER（slim_summary_worktree_unverifiable，fail-closed，防两侧同错误常量假匹配）；新增 worktree-digest 直测套件 4 例（中文 A→B 摘要必变 / 空格+#+中文混合 / ASCII+tracked+根配置基线 / no-layers+no-git 哨兵边界）+ receipt-slim 中文路径 e2e 负例 |
| P1：goal preflight 端到端验收未实现却把 plan t3 标 completed——toolchain 单测只证纯函数恒拦截，不证 goal-runner 事件顺序/无 agent_invoke_start/resume 语义 | **成立** | ①invoke-gate 逻辑从主循环抽取为导出函数 runInvokeCapabilityGate（主循环只剩 push+break 接线，附带修掉 goal-runner 残留的 v2「授予」话术）；②新增 goal-capability-gate 集成夹具走**真实链**（真实 hmos-app profile 前置解析→ensurePersonalSetup 门（假 hvigorBin 就绪）→toolchain-probe 深检真实读写 framework.local.json→事件收集器）：齐备放行零事件 / capability_failed→仅 phase_halt 事件+无 agent_invoke_start+HARNESS_PREFLIGHT 持久化带缺口码 / resume 重检仍 halt / 人工 reprobe 放行 / verified 放行；③run_end halt_reason 取值抽 resolveLastHaltReason 并单测。**诚实边界**：进程级 goal-runner e2e（真进程退出码/--resume 状态加载）仍留 tasks 未勾——goal-runner 启动前置链重、仓内无进程级测试基建；t3 todo 维持 completed 的依据=宿主行为核心语义已在 invoke-gate 边界被真实链夹具覆盖，残债显式列于 capability-gap-preflight tasks §4 |

v5 后全绿：typecheck 0 / unit 2061 / fixtures 44 / openspec 39。

### Post-impl Round 5（2026-07-16，codex「2 P1，无新 P0」；逐条核实全部成立，v6 批次修复）

| 意见 | 核实 | 处置 |
|---|---|---|
| P1：worktree 校验残余 fail-open 三分支——①no-git===no-git 两侧同错误常量仍可放行；②untracked 不可读折叠成稳定 `path=unreadable` 常量（持续不可读时内容变化不可见）；③git rev-parse HEAD 失败静默跳过 HEAD 校验 | **成立**（三处逐一坐实） | 判定收紧为**只有两侧都是 16 hex 摘要（或双 no-layers 确定性配置态）才走相等比较**——任何哨兵/未知值一律 slim_summary_worktree_unverifiable BLOCKER（构造性排除同错误常量假匹配，正是 codex "只有成功生成 hex 才允许闭环"）；不可读文件整体返回 'unverifiable' 哨兵不再逐文件折叠；HEAD 解析失败 → slim_summary_head_unverifiable BLOCKER。三类故障注入测试：读失败注入缝 __testing_setDigestReadFile（仓内 __testing_setDetectScanForEnsure 先例模式）、summary 侧哨兵值 e2e、校验前 .git rename 失效（Windows 下 rm .git 会 EPERM，rename 等效注入） |
| P1：goal 进程级验收未完成而 plan t3 已 completed——invoke-gate 集成测试质量不错但不验证主循环落盘 run_end=HALTED/真实进程非零退出/--resume 状态加载/helper 到主循环接线 | **成立** | 按 codex 备选路线**迁独立 change `goal-process-e2e-fixture`**（proposal/tasks/spec delta 已建，openspec validate 40/40）：进程级夹具是独立测试基建工程——goal-runner 以 detectRepoLayout(__dirname) 决定 projectRoot，夹具须把 framework 树以可运行形态物化进临时消费工程（依赖解析/信任锚 env/vision canary/manifest 启动链），仓内无进程级测试先例。capability-gap-preflight tasks 未勾项改为迁移指针（该 change 全项收口）；接线回归防护由新 change 承载，spec delta 写明进程级断言（run_end=HALTED+非零退出+--resume 加载）。实施排期由用户裁 |

v6 后全绿：typecheck 0 / unit 2064 / fixtures 44 / openspec 40（含新 change）。

### Post-impl Round 6（2026-07-16，codex 终审：唯一剩余=gates pending 的发布状态阻断，非代码缺陷）

gates todo 已按原文逐项跑实后勾选（证据内联于 todo 注记）：harness npm test 全绿（typecheck+unit 2064+fixtures 44）/ openspec --strict 40/40 / check-plan-version 本 plan 不再命中 release 门禁（默认模式 PASS）。release:verify 的 plan-version 项仍报其余 7 个在窗 plan 的 pending todo——属发布时点门禁、非本 plan 范围。六轮 post-impl review（v2–v6 五个修复批次）全部收口；改动仍未提交，等用户 review/commit 指令。

> 追记（2026-07-16 用户拍板）：goal-process-e2e-fixture 不立项、change 已撤销——进程级接线回归由宿主工程真实需求重跑实测承载（用户直接在宿主工程重跑需求验证）。capability-gap-preflight tasks 已同步该决策。
