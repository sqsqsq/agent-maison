---
name: 盲档视觉委托 — 单写者与只读视觉 provider 协作（delegated vision）
version: 3.0.0
todos:
  - id: t0-openspec-first
    content: "P0 · OpenSpec 先行——契约冻结在代码之前，范围沿用 v4 的裁剪边界。建 change `delegated-vision-provider` 并过 `npm run openspec:validate` 后方可动实现代码。change 承载：①三态路由 native/delegated/blind（delegated=静态资格判定，无 provider canary）与窄钳制（reviewVision 可选字段）；②provider 身份（ProviderRef {adapter, model} 必填、manifest 冻结、三形态配置入口）；③**机制 adapter 通用、首批支持固定为 claude/codex/cursor/opencode**，资格与支持列表唯一从 `agents/<adapter>/adapter.yaml.visual_provider` 的完整声明派生，禁止 TypeScript 白名单、adapter 家族推断或手写文档列表形成平行真源；`codeagent/chrys/generic` 首批不声明、不可作为 provider；④unsupported 行为冻结：普通交互态首次配置与 attended goal 创建 manifest 前均提示四个支持项并允许重选，跳过则本轮 blind 且不重复询问；无人值守读到旧 local unsupported 配置时 WARN、忽略并 blind 继续；显式 CLI `--visual-adapter` unsupported 时 fail-fast 并列出四项；不自动改选 Claude、不在多个 provider 间 fallback；⑤四 adapter 独立只读 invoke + 各自 stdout envelope 投影 + stdout-only 同调用校验；⑥**修订 goal-runner spec:936 裁决 requirement 的最小 delta**：provider 评审缺陷是独立的 critic candidate 源——**合法即物化回修、非法即丢弃降级，不进入感知信号的 defect-review/repair_adjudication_pending 停等管线**（该管线原样服务 producer 感知信号）；⑦receipt delegated 形态如实披露（非物化门槛）。核心不变量一句话入 spec：**provider 不能写工程；不能用旧的或坏的 provider 结果制造 PASS；provider 故障只降级本轮视觉反馈，不阻断开发循环。**同步产物：goal-manifest schema 文档、personal-setup-gate.md、goal runbook、交互态文档；文档只说明声明规则并指向 adapter catalog，不另枚举支持名单。宿主 smoke 全过前不 archive。"
    status: completed
  - id: t1-provider-identity-config
    content: "P0 · Provider 身份与配置层（最小形态）。**①共享类型**：`ProviderRef {adapter: string; model: string}` 落 utils/types.ts（model 必填——冻结具体 endpoint；不依赖 goal-manifest 类型）。**②个人级配置**：framework.local.json `vision.visual_provider {adapter, model}`——config-field-ownership.ts:21 LOCAL_VISION_KEYS 加 'visual_provider'；解析校验落 framework-local-config.ts vision 段（:277-384）；写入只走 updateLocalConfig（:520-541，两起段抹除事故先例）。**③三形态最小入口与重选语义**：(a) 普通交互态：首次 UI 相关 phase 且 **local 缺失或现有 adapter 不在 catalog 支持列表**时可选询问一次 adapter+model（复用 personal setup 门控范式：init-orchestrate --scope personal 新任务 `record-visual-provider` 机器写盘 + confirmation-registry `setup.visual_provider`，agent 不手写 JSON——personal-setup-gate.md 既有纪律）；已有 unsupported local 也必须进入同一提示：`adapter <name> 暂未接入视觉 provider。首批支持：claude、codex、cursor、opencode。请重新选择，或跳过并以 blind 模式继续。`，用户跳过即继续 blind、本轮不重复问；(b) attended goal：创建 manifest 前复用同一条件（local 缺失或现有 adapter unsupported）与配置/重选流程，合法选择写 local 后冻结进 manifest，跳过仍可启动 blind run；(c) 无人值守：不询问，读取旧 local 命中 unsupported 时 WARN、忽略该配置并以 blind 继续，不能停 run；没有配置同样 blind（v9 注：此为 v7 已实施历史语义——t7 启动矩阵将其收窄为『UI 需求且无授权 → 启动 BLOCKER；非 UI 或授权在场维持本条』）。**④CLI 双参数**（用户裁决③）：goal-runner.ts minimist string 数组（:3702-3713）加 'visual-adapter'/'visual-model'，help :3737 旁，归一化复用 normalizeAdapterModelCliValue 同款（goal-manifest-cli.ts:91-110）；两旗标成对，单给任一 fail-fast；优先级 CLI > local；本次显式 `--visual-adapter` 命中 unsupported 必须 fail-fast 并列出 catalog 派生的四个支持项，禁止静默忽略。**⑤manifest 冻结**：`visual_provider_pin?: ProviderRef` 条件入身份哈希（computeManifestIdentityFields :180-182「键在场即入」）；加载 shape 校验；resume 读冻结值不重读 local；successor 随 ...inherited 继承；授权纯函数 `resolveFinalVisualProviderPin`（规则子集对齐 resolveFinalModelPin :161：fresh 接受/resume 异值须 --override-manifest/successor 出生输入可覆盖）。**⑥资格与支持列表唯一真源**：扩展 adapter schema，`visual_provider` 完整声明定稿为 `{readonly_invoke, image_transport, stdout_envelope, model_replay}`；运行时由 adapter catalog 扫描该字段派生支持项，**完整声明本身就是 provider 支持与运行资格，普通 Goal/headless 的 `goal_capability` 不参与 provider 资格判定**；首批只给 `claude/codex/cursor/opencode` 声明，`codeagent/chrys/generic` 均不声明。删除/禁止中心 `KNOWN_MODEL_PIN_ADAPTERS` 交集、排除集合、Claude-kernel 家族推断和独立文档白名单；support help/提示/校验均消费同一 catalog 结果。provider 不要求物化（goal-preflight.ts:392 金丝雀先例）。primary≡provider 同 endpoint 不设错误（native 时天然不用），仅冗余 advisory；绝不自动换成 Claude 或 fallback 到其他 provider。"
    status: completed
  - id: t2-vision-mode-and-clamp
    content: "P0 · 三态路由与窄钳制——delegated 放行 pixel_1to1（用户裁决①）；**无 provider canary，真实调用即探测**（评审 2）。**①vision_mode 派生纯函数**：native = primary hasVision（现状三层解析链 resolveContextAdapterImageInput，**primary canary 机制零改动**）；delegated = !primary hasVision && visual_provider 配置在场 && t1⑥ 静态资格通过；blind = 其余。preflight 派生一次冻结、run 内不可变；**provider 每次调用的成败只决定『本轮视觉反馈是否采信』，不反向改写 vision_mode、能力真值或 manifest**（effective-vision-context.ts:4-5 既有纪律）。**②snapshot**：CapabilitySnapshot（fidelity-shared.ts:937-987）扩展可选键 `vision_mode` + `visual_provider?: {adapter, model}`——旧 snapshot 无键=现状语义；写入者 goal-preflight.ts:624-632 同批共享 decision_id。**③窄钳制（评审 2：不全局改名）**：FidelityCapability（fidelity-shared.ts:600-605）**保留 hasVision 字段与语义**（=primary 是否有视觉），新增**可选** `reviewVision?: boolean`；clampFidelityByCapability(:623-637) 内 `const review = capability.reviewVision ?? capability.hasVision`，钳制判据从 hasVision 换为 review——**旧调用面零改动**（不传 reviewVision 行为逐字不变），唯 delegated 判定点（resolvePhaseCapabilityAdvisory goal-runner.ts:2472-2474、harness-runner fidelityCtx 装配、check-spec.ts:197）传 reviewVision=true；效果：native/delegated 不钳（pixel_1to1 放行），blind 钳制表逐字不变。防假 PASS 不靠事前探测，靠 t5 的结果校验 + 既有 VISUAL_PENDING 投影 + pixel_1to1 人签三层兜底。**④prompt 能力块**：buildCapabilityBlock（goal-runner.ts:1134-1242）delegated 分支——盲档块（:1188-1239）基础上明示：你无视觉；只读视觉审查器 (adapter, model) 将在截图后对每屏产结构化评审并回给你修复；参考图旁有 .visual.json 观察 sidecar；正式产物唯一写者仍是你。buildUnattendedExecutionBlock（:1244-1317）pixelReachable(:1257) 按 review 轴判。**⑤人签零改动**：visual_diff_human_confirm_required（visual-diff-check.ts:1602-1617）isHumanVerified 原样；provider 永不写 confirmed_by。**⑥OCR 链零改动**（评审 2）：无 provider canary 即无 ocr_capable 污染源，resolveOcrAvailableForRun（fidelity-shared.ts:1413-1420）、tessdata、全部既有 OCR 门禁不触碰。"
    status: completed
  - id: t3-readonly-invoke-executor
    content: "P0 · Provider 只读 invoke 执行器——物理只读是首期唯一硬边界之一（评审 2）。现行普通 headless argv 恒全权限（claude `--dangerously-skip-permissions` agent-invoke.ts:329、codex `--sandbox danger-full-access` :358、cursor `--force --trust` :373、opencode `--dangerously-skip-permissions` opencodeHeadlessPlan），不得复用。新模块 utils/visual-provider-invoke.ts 只做 provider adapter wrapper：**①`resolveVisualProviderInvokePlan` 仅构造独立只读 `HeadlessInvokePlan`**：消费 t1⑥ catalog 中 `visual_provider {readonly_invoke, image_transport, stdout_envelope, model_replay}` 声明，不调用普通全权限 claudeArgv/codexArgv/cursorHeadlessPlan/opencodeHeadlessPlan；所有真实调用随后统一进入既有 `invokeAgentHeadless(plan, cwd, opts)`，`stdout_envelope` 只负责选择既有 terminalEventParser/usageCapture 与调用后正文投影。视觉 provider **不得重写或旁路 child spawn、timeout/tree-kill、terminal failure 优先仲裁、stdout/stderr 汇集或 usage 回填生命周期**，不得直接再调 `deriveInvokeUsage`；分钟级 provider timeout 通过既有 `AgentInvokeOptions.timeoutMs` 注入。四份声明须经真实 smoke 后入册，缺失/不完整即不具资格。model 必须真实进入各 CLI 的 `--model/-m`，图片直接使用工程内真实路径（无暂存复制）。**②四 adapter 确定接线**：(a) `claude`：锁定版本使用 `-p --safe-mode --tools Read --allowedTools Read --disallowedTools mcp__*`；`--safe-mode` 隔离 `.claude/settings.json`、CLAUDE.md、skills、plugins、hooks、MCP、custom commands/agents 等工程定制，`--tools Read` 从模型上下文移除全部非 Read 内建工具，`mcp__*` 再显式拒绝 MCP 工具；禁止 `--dangerously-skip-permissions`。prompt 明列真实图片路径由 Read 读取；`--model <pin>`；保留 `--output-format stream-json --verbose`，复用 `claude-envelope.ts`/既有 Claude stream-json final result 与事件投影；若锁定版本不支持或实测 `--safe-mode` 未完成该隔离，则该声明不得入册，不退回工程默认配置启动。(b) `codex`：只独立构造 `HeadlessInvokePlan`（`adapterName:'codex'`，argv=`codex --ask-for-approval never exec --model <pin> --sandbox read-only --image <path> --json`；顶层 approval 与 `exec --model … --sandbox …` 顺序继承 e6 已验证形态），绝不复用普通 `codexArgv` 的 danger-full-access；随后交给 `invokeAgentHeadless` 统一处理 child 生命周期、timeout、`turn.failed` 优先仲裁和 usage 回填。`createCodexTerminalScanner` **只负责** `turn.completed/turn.failed` 终态；provider 仅在 `AgentInvokeResult.completion_observed===true && terminal_failure_observed!==true` 时调用既有 `extractCodexAgentMessageText(result.stdout)` 投影正文，返回 null 仍判 invalid；usage 只消费 `AgentInvokeResult.usage`，不直接调用 `deriveInvokeUsage`。相对 e6 只新增只读 plan、原生 `--image` 与统一 provider 载荷校验，禁止第二套 spawn/timeout/terminal/message/usage parser。(c) `cursor`：`cursor-agent|agent -p --mode ask --model <pin> --output-format json`，禁止 `--force`；prompt 明列图片真实路径，由 Ask 模式的 Read 读图；只解析 JSON 的确定性 final result（不把增量/工具事件当正文）。(d) `opencode`：以 `OPENCODE_PERMISSION` inline JSON 将 edit/bash 及其他非只读工具置 deny（只放行 read/glob/grep），配合全局 `--pure`；`run -m <pin> --file <path> --format json` 原生附图；解析 raw JSON events 并新增 OpenCode final-result 投影。**③各 adapter 先取得统一 `AgentInvokeResult`，再按自身 `stdout_envelope` 投影正文；usage 一律直接消费 result.usage；随后做统一 schema + 身份回显 `{run_id?, attempt_id?, image_hashes[]}` 逐字/hash 校验**。空/坏 envelope、CLI 缺失、超时、terminal failure、模型不支持图片、非 JSON/schema 坏、身份/hash 不符均令本轮 outcome=unavailable|invalid，provider 写盘产物一律不采信，开发循环按 t5 继续。Codex/Cursor/OpenCode 没有可信图片工具事件时 receipt 如实 unverified，不影响合法载荷用于回修。**④脏检查第二防线**：invoke 前后工程 `git status --porcelain` 对比，变脏 → 本轮结果丢弃 + events 记录，不自动 revert、不 halt。**⑤events**：`visual_provider_invoke` 事件（{provider, purpose, image_hashes, outcome: success|unavailable|invalid, duration_ms, invoke_id}，adapter_probe :4948-4960 同族）；可得的 invoke 结构化事件流落 `<report_dir>/visual-review/<invoke_id>/agent-events.jsonl`（receipt 证据披露用，t5④；无可信读图事件仍标 unverified）。**⑥预算**：不占 max_total_turns/max_retries；占 wall_clock；计入 `AgentInvokeResult.usage`；per-purpose 批次上限（spec_observation ≤ 参考图数且单 run 封顶；review 每 attempt 一批）；分钟级独立 timeout 复用 `invokeAgentHeadless`，不另建计时器、不吃 phase timeout 表。官方契约锚点：Claude safe-mode/tools/stream-json `https://code.claude.com/docs/en/cli-usage`，Cursor Ask/JSON 输出 `https://prod.cursor.com/docs/cli/using`，OpenCode permission/CLI `https://dev.opencode.ai/docs/permissions/` 与 `https://dev.opencode.ai/docs/cli/`；实现前仍以锁定版本本机 help+真实 smoke 复核。"
    status: completed
  - id: t4-spec-observation-sidecar
    content: "P1 · spec 期视觉观察 sidecar（用户裁决②：进首期）。**①产物**：`<spec reports>/visual-observations/<slug>.visual.json`（与 ocr/<slug>.ocr.json 平行，slug 复用 sanitizeOcrPrescanSlug 同款 goal-runner.ts:2363-2367）。**②形态**：{schema_version, protocol_version, source_image（回指，:2396-2399 同款理由）, image_hash, provider: {adapter, model}, observations: [{region, fact}]}；地位=ocr.json 逐字对齐：best-effort 上下文、非门禁产物、不产 check、单图失败不阻断其余（:2402-2404 同款）、生产失败整体不阻断 spec（对应图无 sidecar 而已）。**③复用键**：image_hash + provider (adapter, model) + protocol_version 齐等才复用，否则重产（防换 endpoint/升协议后沿用旧观察）。**④生产时机**：vision_mode=delegated 且 phase=spec 时经 t3 executor（purpose='spec_observation'）；dispatch 对齐 OCR 预扫描（:2478-2482）：spec 生产、plan/coding 只列已有。**⑤prompt 接线**：CapabilityAdvisory（goal-runner.ts:1104-1127）加 `visualObservationPaths`，buildCapabilityBlock 列出（:1229-1238 同款形态）。**⑥验读证据 best-effort**（评审 2 降级）：provider adapter ∈ IMAGE_READ_PARSERS（critic-receipt-producer.ts:68-75）时如实记录验读事实供披露，无解析器如实 unverified——**不构成任何门槛**。"
    status: completed
  - id: t5-review-mustfix-gate
    content: "P0 · review 评审接线——**结果 fail-closed、循环 fail-open**（评审 2 核心）。**①触发点**：check-testing checker.check 内、capture（:2947→:3015）完成后、dispatchDeviceVisualDiff（:3547）之前；vision_mode≠delegated 整体跳过；**异步显式化**——safeRun（check-testing.ts:3340-3353）是同步函数不能包 Promise，provider 调用点显式 await（链路 async 化）或同步 spawn；交互态读 local config、goal 态经 env 注入冻结 pin（MAISON_GOAL_MODEL_PIN_ENV 链同款 phase-state.ts:98/:106-111 新增 provider 变量）。**②输入**：逐屏 {参考图, 实机截图, screen_id, ui-spec 目标节点摘要, 双图 sha256, run_id?, attempt_id?}（工程真实路径）。**③输出合同**：完整逐屏覆盖全部目标屏，每屏 {screen_id, defects[]（class/severity/element?/note，绑定 must_fix_refs 锚定）, must_fix[], 双图 hash 回显}；pixel_1to1 追加 region_attest[]（method='vl_screening'，RegionAttestEntry :117-132 既有形态——非新机制，candidate-pass 既有 gate 要求使然）；**空输出/漏屏/重复屏/坏 JSON/hash 不符 = 本轮未审查（invalid）**，绝不等价「无缺陷」。**④写入与 provenance**：合法载荷经**原子覆盖**写入 visual-diff.json 逐屏 must_fix/defects（tmp+rename；**写入前清掉旧 provider 结果，禁止跨 attempt 复用**——评审 2）；harness 确定性映射逐屏 verdict（must_fix 空→pass 候选、非空→fail），provider 不产 verdict、「能否推进」唯一归 gate；VisualDiffDefectSource（visual-diff-check.ts:93-97 现仅 T8）扩展定稿形态 `{producer:'visual_provider', invoke_id}`（同步 schema/校验，selfreport_integrity :1353 不误判 provider 写入；稳定 finding 身份层**不做**——评审 2 降后续加固）；永不写 confirmed_by。critic receipt **如实披露非门槛**：delegated 下写 receipt（adapter/model=provider 真实值，input_provenance 有解析器且事件可证=verified 否则 unverified，证据路径=t3④ 独立事件流），visual_diff_critic_receipt 路径校验（:1836-1886）加窄分支（receipt.adapter≠primary 时期望路径按 provider 事件流），**CapabilityReceipt.provider 字段（string，effective-vision-context.ts:41）不挪用**；**受理与披露分立（评审 3）**：采信唯一判据=③ 的载荷同调用校验——`input_provenance='unverified'`（无解析器 adapter 如 codex/cursor/opencode 做 provider）且载荷结构/身份/当前图片 hash 合法 → **结果照常用于回修**，仅如实披露证据等级；无效仅指载荷校验失败（缺失/坏 JSON/漏屏/身份不符/hash 不符/旧 attempt）；receipt 任何情况不造成 halt 或 repair_adjudication_pending。**⑤裁决契约（评审 2 简化）**：合法 provider 输出 = **可直接回修的 critic candidate（非绝对真值）**——直接物化 repair candidate 驱动 primary 修复，不要求盲 primary defect-review 复核（伪制衡），也**不进 producer 感知信号的 repair_adjudication_pending 停等管线**（spec:936 管线原样服务 T8 感知信号）；**无效输出 = 丢弃 + events 记录 + 本轮按 blind 语义继续，接线写死（评审 3 P0）**：provider unavailable/invalid 时**不对 pending 屏执行严格 dispatchDeviceVisualDiff**——若照常执行，P0 屏 pending / 全屏 pending 在 uiChange=new_or_changed 下 = BLOCKER FAIL（visual-diff-check.ts:1296-1304、:1307-1317）挡死 phase，与 fail-open 相反——改为返回既有 `visual_diff` CheckResult **{severity: 'BLOCKER', status: 'SKIP'}**（capture/nav/device 等确定性检查结果照常保留）；该 SKIP 走既有链自动成为诚实出口：非 MINOR 的 SKIP → visual-debt `needs_human` 债务（visual-debt.ts:163-172）→ 债务把 visual 投影 UNVERIFIED、release BLOCKED（harness-runner.ts:1391-1435 countBlockingDebt）→ SKIP 非 FAIL，phase 照常推进——**开发循环 PASS / visual UNVERIFIED / release VISUAL_PENDING 三态同时成立**；**不 halt、不停等、不新增 check id/状态/质量轴**（评审 2 裁剪维持）；误报兜底=no_progress_fuse（:2610）+ 人签通道（visual-confirm）既有双层。**⑥盲档回退**：vision_mode=blind 时本条不激活，e6 后盲档链原样。"
    status: completed
  - id: t6-regression-smoke-closeout
    content: "回归与收口。**单测/fixture 矩阵**：t1（adapter catalog 是唯一支持列表；只有 claude/codex/cursor/opencode 四份完整声明被派生，codeagent 即使同 Claude 内核也不得家族放行；**完整 visual_provider 声明在 goal_capability 缺失/失效时仍保持 provider 资格**；授权矩阵 fresh/resume/successor；双旗标成对；record-visual-provider 走 updateLocalConfig；普通交互与 attended goal 在 local 缺失、已有 supported、已有 unsupported 三态下分别询问一次/不问/提示重选一次，unsupported 跳过后本轮 blind 且不重复问；无人值守旧 local unsupported：非 UI 需求或授权在场 WARN+blind、UI 需求且无授权 → 启动 BLOCKER（t7 矩阵）；显式 CLI unsupported fail-fast 且错误列四项）；t2（三态派生矩阵——含资格不足落 blind；vision_mode run 内不可变——invoke 失败后 snapshot/mode 零变化；reviewVision 缺省=hasVision 旧调用面逐字回归；delegated+pixel_1to1 不钳新断言；blind 钳制表不变；OCR 链零改动断言）；t3（四 adapter readonly `HeadlessInvokePlan` golden：model flag 真实回放、图片 transport、普通全权限 argv 不可达、各自 envelope/final-result 投影；**所有 provider plan 都只经 `invokeAgentHeadless` 执行，visual-provider-invoke 不得自建 spawn/timeout/tree-kill/terminal/usage 生命周期，timeout 仅走 AgentInvokeOptions.timeoutMs，usage 仅消费 AgentInvokeResult.usage**；Claude argv 必含 safe-mode+Read-only 工具集合，缺 safe-mode 或锁定版本不支持即不得入册；Codex 复用 e6 分层回归：`completion_observed=true && terminal_failure_observed!==true` 方可调用 `extractCodexAgentMessageText(stdout)`，completion 缺失/terminal failure/正文 null 均拒收，usage 与 invoke result 同源；统一校验拒绝非 JSON/schema 坏/身份不符/hash 不符/超时；CLI 缺失/模型拒图=unavailable；脏检查丢弃不 revert；批次上限；事件流落盘）；t4（三元复用键；单图失败不阻断；不产 check）；t5（**fail-open 核心回归：provider invalid/unavailable 时产 visual_diff {BLOCKER, SKIP} 而非严格 dispatch 的 BLOCKER FAIL、phase 照常推进、SKIP 经 visual-debt needs_human 投影 release VISUAL_PENDING、不产 adjudication_pending**；unverified receipt 且载荷合法=照常回修不丢弃；合法载荷物化 candidate 驱动回修；原子覆盖+清旧+跨 attempt 拒收；确定性 verdict 映射；DefectSource 新 provenance 不触发 selfreport_integrity；receipt 窄分支路径校验——native 现状回归+delegated 新路径；人签链零变化；safeRun 无 Promise）。**四 adapter 最小真实 invocation smoke（每个 provider 各一次，不做 4×4）**：使用锁定版本真实 CLI/model，逐一证明 model 参数真实回放、至少一张工程真实图片确实进入模型、调用确经 `invokeAgentHeadless` 且其 completion/failure/usage 事实被消费、invoke 前后工程未被修改、stdout 正确投影、合法 JSON/当前 hash 被统一校验接收；**Claude smoke 在工程真实 `.claude/settings.json` 注册 Stop/PreToolUse hook（用可观察 sentinel 证明是否触发）的条件下执行，provider 不得触发这些 hook 或额外 hook 进程**；另以受控坏载荷或拒图验证 unavailable|invalid 只使本轮 provider 失效并走既有 fail-open。**两个完整 delegated 宿主闭环**（各用新 run_id）：(A) 同 adapter 不同模型，如 Claude M1 primary + Claude M2 provider；(B) 跨 adapter 不同模型，如 Codex primary + Claude provider。两者均验盲写→capture→provider 评审→物化回修→provider 缺陷清零→candidate-pass→**gate=await_human_confirm**（visual-diff-check.ts:2619-2628，无人签时 gate 不是 PASS）→真人 confirmed_by→**重跑 gate 方 PASS**；Cursor/OpenCode 不各跑昂贵完整 UI 闭环，其真实 invocation smoke + 统一 executor 单测证明接线。**三组 unsupported 反向测试**（每组覆盖 codeagent/chrys/generic）：普通交互与 attended goal 对已有 unsupported local 均提示重选/可跳过 blind（跳过=当次盲跑授权）；无人值守旧 local：非 UI 或持 `--allow-blind-visual` 时 WARN+blind、UI 需求且无授权时启动 BLOCKER（t7 矩阵）；显式 CLI fail-fast 并列四个支持项；全程禁止自动替换为 Claude 或 provider fallback。**全量**：cd harness && npm test + npm run openspec:validate。**验收语义写死**：一次 run = 1 primary + 1 visual endpoint，只覆盖 (A,M1)+(A,M2) 与 (A,M1)+(B,M2)，非 provider 池/canary/自动 fallback。**开工依赖**：e6b3f8d2 宿主 smoke、关联 OpenSpec 收口与 t7 全部完成且相关 plan/代码串行本地提交；本视觉委托 plan 也先单独提交，确认 `git status` 干净后方可进入 t0。是否 push 与宿主 smoke 均保持用户触发，不由实施 agent 擅自执行。**诚实边界**：delegated 消除人工逐轮看图与盲档一刀切降档；不承诺 provider 评审等效人眼；provider 恒失败的 run 与现状盲档等价（经既有 VISUAL_PENDING 投影，零新状态）。smoke 全过后 t0 change 方可 archive。"
    status: in_progress
  - id: t7-blind-launch-consent
    content: "P0 · 启动契约修正——盲跑须一次显式授权，三形态同构（用户裁决⑤ + codex 评审 4）。**修正对象**：v3 冻结的『无人值守缺 provider → WARN+blind 静默继续』使 attended 与无人值守行为不同构，且 UI 需求下盲跑价值低（明知缺关键能力硬跑烧预算，bc-openCard 同构）。**①统一规则（唯一契约）**：需求 UI 相关且 primary 无视觉时，进入 blind 必须持有一次明确的盲跑授权；三形态是同一规则的三种授权载体：(a) 普通交互态——用户当场选择『跳过并盲跑』即本次授权（只授权当前操作，下次 UI 需求仍询问，不落任何持久化）；(b) attended goal——会话层把用户的跳过转译为 `--allow-blind-visual` 启动参数传入；(c) 无人值守——提前配置 provider，或显式传 `--allow-blind-visual`。**②决策点位置（codex 修正二 + v9 P1 校准）**：不塞进 canary 之前的 personal setup prerequisite 集合；拦截决策落在 **primary canary 尝试完成之后**、正式 phase 启动之前的**纯决策**——不新增生命周期、状态机或第二套 gate，从用户视角仍属同一『启动 setup 阶段』。`primaryHasVision` **不得**直接读本次 probeResult、不得新增第二套视觉真值——**复用既有 effective image-input 解析链**（resolveContextAdapterImageInput：用户 override → 可采信 canary 缓存 → adapter 声明回退，multimodal-probe.ts:278）在 canary 尝试后的时点取值（canary 真跑过则缓存已最新；dry-run／local override／有效缓存／非 UI chain 跳过探测与探测失败回退声明均为该链既有语义，t7 不改判定来源）。**优先级**：`canaryHardCliFailure` 仍由既有 HALT 分支（goal-runner.ts:4422-4439）**先行**处理，t7 不得用『缺盲跑授权』掩盖 CLI 硬故障；**--dry-run 只报告 `would_block` WARN、不拦**（dry-run 不进入正式 phase）。**③决策矩阵（冻结）**：非 UI 需求（resolveUiRelevanceForRun，goal-preflight.ts:317 金丝雀同款判定）→ 不检查 provider，放行；primary 有视觉（既有 effective 解析链判定）→ native 放行；primary 盲 + 合法 provider（catalog 支持列表 + visual_provider_pin）→ delegated 放行；primary 盲 + 无 provider + 授权在场 → blind 放行（视觉债务/VISUAL_PENDING 照旧）；primary 盲 + 无 provider + 无授权 → **启动 BLOCKER**：报错并列双出路（record-visual-provider 配置 provider，或 --allow-blind-visual 显式盲跑），run 不进入 phase。**④授权载体纪律（v10 定稿：无条件落键 + 条件消费，一次授权=一个 run）**：新 CLI 旗标 `--allow-blind-visual`——独立旗标，**不得**以 fidelity=reference_only 冒充授权（两个语义），**不得**写入 framework.local.json 永久化。**落键与消费分离（v10 P0 修正——v9 的『仅 blind 分支才落键』与『漂移检查前落键』时序上无法同时成立：漂移检查（goal-runner.ts:4414 段）在 canary（:4532 段）之前，落键时尚不知道分支；把漂移检查挪到 canary 后也不可行——canary 会 spawn 调用并可能写 local，身份检查必须先于一切副作用）**：显式收到旗标即在**身份漂移检查之前无条件**冻结 `allow_blind_visual: true` 进 manifest（条件入身份哈希『键在场即入』，与 visual_provider_pin 同点位——否则首跑落键、resume 误判漂移）；canary 后的启动决策**只在 UI+blind+无 provider 分支消费**该字段；native/delegated 下它只是『用户对本 run 给过盲跑授权』的冻结事实，**不影响路由**——授权语义绑定 run 而非分支（run 内环境退化到 blind 时按已给授权放行，正是『一次授权=一个 run』的本义）；**不做** canary 后二次落键、身份 rebase 或第二次漂移裁决。**resume（同一 run）**：读冻结授权、不重复要求旗标；旧 manifest 无该键而 resume 想新增授权 → 复用 `--override-manifest`（授权字段矩阵对齐 pin 范式：fresh 直接接受／fresh+--manifest 与既有值冲突须 --override-manifest／resume 同值幂等）；**successor 默认不继承**——inheritSuccessorManifest 时**剥离**该键，新 run 必须重新显式传旗标（跨 run 静默授权才是真正的潜伏风险；且只有正向旗标、继承的 true 无法覆盖回 false，剥离是唯一自洽形态）。**⑤启动契约与运行时降级分立**（v4『冻结与调用结果分立』延伸到启动面）：本条只管启动前配置缺口；合法 provider 选定后运行中调用失败仍走 t5 既有 fail-open（不采信本轮/循环继续/UNVERIFIED/BLOCKED），**不得**因运行时故障反复停 run。**⑥文档**：personal-setup-gate.md 的『visualProvider advisory 永不影响启动』改述为『条件 prerequisite（goal 启动决策点生效）』；check-personal-setup 在缺 UI/primary 上下文时**不得**全局报失败（它无从判定 UI 相关性，其 advisory 层保持现状——BLOCKER 只在 goal-runner canary 后决策点产生）；goal runbook 与交互态文档同步三形态授权语义；**`visualProvider.state=unavailable`（local 配置存在但读取失败）进③矩阵的『无 provider』分支**——配置读取失败不等价盲跑授权：交互态提示『修复配置或显式盲跑』双出路，无人值守 UI 需求且无授权照样 BLOCKER（advisory 现行该态 shouldPrompt=false 的定义同步修订）。**⑦范围冻结**：不碰 provider 调用器、review receipt、OCR、evaluation_invalidated、视觉 gate。**⑧回归**：决策矩阵五分支单测（非 UI／native／delegated／blind+授权／blind 无授权 BLOCKER）；授权冻结矩阵——**无条件落键+条件消费**（带旗标即漂移检查前落键；native/delegated 下键在场但不影响路由、唯 UI+blind+无 provider 分支消费）、resume 读冻结不重询、resume 新增授权须 --override-manifest、**successor 剥离断言**（继承后无该键、须重传旗标）；三形态同构断言（同一规则三载体）；--allow-blind-visual 不落 local 负向断言；`state=unavailable` 进『无 provider』分支断言（交互双出路／无人值守 UI 无授权 BLOCKER）；hard CLI HALT 优先于缺授权 BLOCKER 断言；--dry-run `would_block` WARN 不拦断言；BLOCKER 文案含双出路。**⑨OpenSpec**：修订当前 change delegated-vision-provider（delta 扩充 + tasks 新条目 + 决策矩阵 Scenario），不另开 change；archive 条件扩为本条单测与文档全过。**与宿主 smoke 的关系（v9 收窄表述）**：7.7（四 adapter invocation，调用器未改）与 7.8（delegated 完整闭环，provider 评审证据链未改）结果完整有效、不重跑；t7 实施后**补一组窄启动路径 smoke**：UI+盲+无 provider+无授权 → phase 前 BLOCKER／加 `--allow-blind-visual` → manifest 正确落键并继续／合法 provider → 不被新判断误挡／resume → 使用冻结授权不再要求旗标；unsupported 反向断言随 t6 修订复验。工作区影响按事实表述：宿主 smoke 以独立消费者工程为 project root 时不受本仓 plan 修改影响，若以本仓为 root 则脏工作区检测会看到该修改，不笼统称零影响。"
    status: pending
overview: >
  宿主现实：常见配置是「强编码模型无多模态 + 多模态模型编码弱」。现行框架一次 goal run
  只绑定一个 (adapter, model_pin) 执行身份，主模型盲即整 run 盲档。本 plan 引入只读视觉
  provider（显式 (adapter, model) 第二 endpoint）：单写者不变，provider 经独立只读 argv
  在 capture 后对逐屏出结构化评审，合法结果直接物化回修候选驱动 primary 修复。治理原则
  （评审 2 收敛）：对 provider 结果 fail-closed——不可信就不采信；对开发循环 fail-open——
  provider 坏了就降级本轮视觉反馈按 blind 继续，release 保持 VISUAL_PENDING，绝不
  halt/停等。无 provider canary（真实调用即探测）、无暂存复制（物理只读靠 argv）、无新
  UNVERIFIED 载体（复用既有投影）。硬边界只有一条：provider 不能写工程，不能用旧/坏结果
  制造 PASS。支持同 adapter 多模型与跨 adapter 组合（1 primary + 1 visual endpoint）。
  用户三裁决：delegated 放行 pixel_1to1 且人签保留、sidecar 进首期、CLI 双参数。
  机制保持 adapter 通用，首批仅 claude/codex/opencode（支持列表从 adapter 声明派生；
  cursor 原在首批，2026-08-26 tasks 7.7 实测其免费档不可指定模型、与 model 真实回放互斥，
  经用户决定退出第一期，机制 ask_mode/result_json 留词表待第二期）。
  OpenSpec 先行（t0），依赖 e6b3f8d2 完整实施、验收并串行提交后实施。
  v8 增补启动契约（t7）：UI 需求且 primary 盲时，无 provider 亦无显式盲跑授权
  （交互态当场跳过 / --allow-blind-visual）→ 启动 BLOCKER 指引配置——三形态同一规则，
  决策在 primary canary 尝试之后（复用既有能力解析链）；授权一次一 run（successor 不继承）；
  运行时 provider 故障仍走既有 fail-open，两层分立。
isProject: false
---

# 盲档视觉委托：单写者与只读视觉 provider 协作（ab072691）

状态：**v10（评审意见 6 已吸收，2026-08-26；t0-t5 已按 v7 实施并提交）**

当前进度（2026-08-26 收口）：
- **t6 宿主 smoke 已完成**——tasks 7.7 三 provider（claude / codex / opencode）真实 invocation
  全过并入册；cursor 经用户决定退出第一期；7.7a 只读单点负例对照实证成立。
- **tasks 7.8**（两个完整 delegated 宿主闭环）经用户裁决**取消**，改为发布后自行实测；
  端到端收敛这层证据因此空缺，如实记录于文末实施记录，不得当已证引用。
- **t7（盲跑授权契约）仍 pending，且仍属本 change**（见下方 t7⑨ 冻结决定：不另开 change、
  archive 条件扩为 t7 单测与文档全过）⇒ **本 change 暂不 archive**。

## 1. 立项背景与目标形态

```text
宿主多模型现实：强编码模型（如 codex 路由）无多模态；多模态模型编码弱
  → 现行单身份架构：run 绑定唯一 (adapter, model_pin)
     · hasVision 单布尔 → clampFidelityByCapability 一刀切
     · 主模型盲 → 整 run 盲档 → pixel_1to1 被钳 → 语义评审环节空缺
  → 目标形态（三态路由）：
     primary 有视觉                    → native     现状链零变化
     primary 盲 + provider 配置且合格  → delegated  盲写 + 只读评审（本 plan 新增）
     其余                              → blind      现状盲档（最后地板）
  → 每轮协作（fail-closed 结果 × fail-open 循环）：
     provider 成功且结果合法 → 写入 must_fix/defects → 物化候选 → primary 回修
     provider 不可用/超时/坏 JSON/hash 不符 → 丢弃本轮结果 → 按 blind 语义继续
       → release 保持 VISUAL_PENDING → 不 halt、不进 repair_adjudication_pending
```

首期唯一硬边界：**provider 不能写工程，也不能用旧的或坏的结果制造 PASS。**其余问题全部
局部降级，不挡 primary 继续编码、构建、测试。修复原则（对齐 e6「一个问题一个权威」）：
产物写者唯一归 primary；「能否推进」唯一归 gate；provider 是有证据要求的视觉检查工具，
不是第二个 goal agent——无 owner、无 phase 状态机、无 closure；调用失败不反向改写能力
真值；没有可信 provider 的路径诚实落盲档。

## 2. 已核实事实

| # | 事实 | 证据 |
|---|---|---|
| 1 | run 执行身份单槽：manifest.adapter + adapter_model_pin；resolveFinalModelPin 单点裁决；model flag 已按 adapter 参数化回放，chrys/generic 无回放旗标 fail-fast | goal-manifest.ts:74-126、:102；goal-manifest-cli.ts:161、:183-194；goal-runner.ts:4068-4078；agent-invoke.ts:317-458 |
| 2 | 能力消费单轴：resolvePhaseCapabilityAdvisory hasVision；clampFidelityByCapability 单布尔；CapabilitySnapshot（vision.verdict boolean）goal-preflight 写入与 intent SSOT 同批共享 decision_id | goal-runner.ts:2417-2508；fidelity-shared.ts:600-637、:937-987；goal-preflight.ts:624-632；harness-runner.ts:731；check-spec.ts:197 |
| 3 | 盲档 prompt 与 OCR 预扫描形态：能力块盲档段；OCR 产物 `<spec reports>/ocr/<slug>.ocr.json`、source_image 回指、单图失败不阻断、spec 产 plan/coding 列 | goal-runner.ts:1134-1242（:1188-1239）、:2355-2373、:2396-2404、:2478-2482 |
| 4 | **现行普通 headless invoke 恒全权限**：claude `--dangerously-skip-permissions`、codex `--sandbox danger-full-access`、cursor `--force --trust`、opencode `--dangerously-skip-permissions`——复用给 provider 即名义只读实际全权限 | agent-invoke.ts:314-374、:464-484 |
| 5 | 视觉证据链落点：VisualDiffScreenEntry 逐屏 must_fix（string[]）/defects/confirmed_by/evaluated_screenshot_hash；candidate-pass 全要件=defects 完整枚举 + must_fix_refs 锚定 + P0 pass 屏 region_attest + 有效 critic receipt + 全屏覆盖；capture 与 check 同一 checker.check 内序贯 | visual-diff-check.ts:198、:100-114、:117-132、:217、:210；check-testing.ts:2846-2860、:2947、:3015、:3469-3548 |
| 6 | DefectSource 现仅 `{producer:'T8', finding_id, signal}`——provider 写入需扩展定稿 provenance 并同步 schema/校验 | visual-diff-check.ts:93-97 |
| 7 | critic receipt 证据路径精确锁死 primary testing（全路径等值 + critic_run_id 绑定 `<run>-<attempt>` + 按 receipt.adapter 复核验读）——delegated receipt 需窄分支分流期望路径 | visual-diff-check.ts:1836-1886；签发侧 goal-runner.ts:6621-6744 |
| 8 | **感知信号裁决管线**（spec:936）：producer T8 信号须 defect-review 复核，unreviewed → repair_adjudication_pending 停等——provider 后于 primary 运行必然 unreviewed；v3 契约：provider 缺陷不进该管线（独立 critic candidate 源，合法即物化、非法即丢弃） | openspec/specs/goal-runner/spec.md:936-946；goal-runner.ts:7120-7186 |
| 9 | 质量轴只消费 CheckResult/capability 投影；visual UNVERIFIED 不阻断 phase 只阻断 release；VISUAL_PENDING=FUNCTIONALLY_COMPLETE_VISUAL_PENDING——provider 失败的诚实出口已存在，零新载体 | quality-axes.ts:211-226、:88-105、:168-173、:362-372 |
| 10 | 能力真值反写禁令既有：「不得反向改写模型能力」；CapabilityReceipt.provider 是 string（canary 采集语义）不得挪用 | effective-vision-context.ts:4-5、:34-44（:41） |
| 11 | safeRun 是同步函数（`fn: () => CheckResult[]`）——不能包 Promise | check-testing.ts:3340-3353 |
| 12 | personal setup 机器写盘范式已备：--ensure 确定性自写 + record-adapter 任务 + confirmation-registry——record-visual-provider 全套对齐 | skills/reference/personal-setup-gate.md:1-59 |
| 13 | local config 写入纪律：updateLocalConfig 唯一无损写回；两起手写 merge 段抹除事故 | framework-local-config.ts:520-541 |
| 14 | OCR 混合点存在（resolveOcrAvailableForRun = 本地工具链 ∨ canary ocr_capable）——v3 无 provider canary 即无污染源，**OCR 链零改动**；tessdata 承载烤字/bbox/文本门禁不可删 | fidelity-shared.ts:1413-1420；capture-completeness-check.ts:425 |
| 15 | 轮次熔断与人签既有：visual-rounds round_key/no_progress_fuse；confirmed_by 事务两件套 + isHumanVerified 自动化身份不算 | visual-rounds-ledger.ts:1-60；visual-diff-check.ts:2610、:1602-1617；visual-confirm.ts:102-121、:448-474 |
| 16 | 执行身份 env 注入链模板：MAISON_GOAL_MODEL_PIN_ENV 定义/注入/消费三面 | phase-state.ts:98、:106-111；goal-runner.ts:973、:6238-6248；agent-invoke.ts:1026；harness-runner.ts:187 |
| 17 | CLI 定义与归一化落点；adapter_probe 事件字面量形态 | goal-runner.ts:3701-3721、:3737、:3799-3807、:4940-4960；goal-manifest-cli.ts:91-110 |
| 18 | provider 不依赖物化：金丝雀即 runner 直 invoke 先例 | goal-preflight.ts:392；agents/README.md:70-73 |
| 19 | 用户三裁决（2026-08-25）：①delegated 放行 pixel_1to1 + 人签保留；②sidecar 进首期；③CLI 双参数 | 本 plan 立项对话 |
| 20 | **严格 dispatch 对 pending 屏的现行判定**：P0 屏 pending / 全屏 pending 且 uiChange=new_or_changed → visual_diff BLOCKER FAIL——provider 失败后照常 dispatch 会挡死 phase，fail-open 须以 {BLOCKER, SKIP} 替代 | visual-diff-check.ts:1296-1304、:1307-1317 |
| 21 | **SKIP→债务→release 链**：非 MINOR 的 SKIP → needs_human 债务 → visual 投影 UNVERIFIED、release BLOCKED（countBlockingDebt）；SKIP 非 FAIL 不挡 phase 推进 | visual-debt.ts:163-172；harness-runner.ts:1391-1435 |
| 22 | **人签顺序契约**：缺陷清零后 awaitHumanOnly → failure_kind='await_human_confirm'（gate 非 PASS），真人 confirmed_by 后重跑方 PASS | visual-diff-check.ts:2619-2628 |
| 23 | Claude 的工具集合限制与工程定制加载是两个控制面；本仓 adapter 会物化 `.claude/settings.json` 及 Stop/PreToolUse hooks，本机锁定 CLI 的 `--safe-mode` 明确禁用 CLAUDE.md、skills、plugins、hooks、MCP 等定制 | `claude --help`；agents/claude/adapter.yaml:28-45；Claude CLI reference |
| 24 | e6 的 Codex 生命周期是分层复用而非单 scanner 全包：invokeAgentHeadless 负责 child/timeout/failure 优先与 usage 回填；createCodexTerminalScanner 只判 completed/failed；extractCodexAgentMessageText 投影正文；deriveInvokeUsage 在 invoke 内回填 AgentInvokeResult.usage | agent-invoke.ts:904-943、:1483、:1505-1530；codex-terminal-events.ts:125-180、:206-231；usage-capture.ts:149-169 |

## 3. 明确裁剪

- **无 provider canary**（评审 2）：真实 review/sidecar 调用本身即能力探测；primary canary 机制零改动；不做 canaries[] 多槽化。
- **无 OCR 分轴改造**（评审 2）：无 provider canary 即无污染源；tessdata 与全部 OCR 门禁零触碰。
- **不全局重命名 hasVision**（评审 2）：保留其 primary 语义，仅加可选 `reviewVision?`，旧调用面零改动。
- **无暂存图片复制**（评审 2）：物理只读靠 readonly argv，直接读工程原图，receipt 路径天然一致。
- **无稳定 finding 身份层/输出载荷签名**（评审 2 降后续加固）：首期采信=同调用校验（stdout+schema+身份+hash 回显）+ 原子覆盖 + 调用前清旧 + 禁跨 attempt 复用。
- **无新 UNVERIFIED check 载体/质量状态机**（评审 2）：provider 失败复用既有 blind/VISUAL_PENDING 投影。
- **provider 失败不进 repair_adjudication_pending**（评审 2）：只意味着本轮结果不能用于自动回修，不停机求人；不 halt、不改 90min timeout、3/30 预算语义。
- **首期单 provider**：一次 run = 1 primary + 1 visual endpoint；机制 adapter 通用，但首批只由 `claude/codex/cursor/opencode` 四份 `adapter.yaml.visual_provider` 声明入册；非 provider 池/自动 fallback；不自动推荐或替换。
- **codeagent/chrys/generic 首批不具 provider 资格**；不做家族推断。无完整 `visual_provider` 声明的 adapter 同样无资格（交互态提示重选/可跳过，旧 local 在无人值守 WARN+blind，显式 CLI fail-fast）。
- **不按 phase 切控制权**；无 provider 的 owner/状态机/closure/第二 gate。
- **人签判据零改动**；provider 输出不构成人签；pixel_1to1 终签保留。
- **不自动 revert** provider 弄脏的工作区（检测+丢弃+记录）。
- **spec sidecar 不产 check**（best-effort 上下文）。
- **不进 e6b3f8d2**：独立 plan；e6 完整实施、验收并串行提交后，以其 Codex terminal/usage parser、UI kit 撤销、页面身份与产品组件硬地板为稳定基线开工。

## 4. 实施与提交边界

```text
依赖：e6b3f8d2 完整实施、验收并串行提交后开工（复用 Codex JSONL terminal/usage parser；
      强制 kit 撤销 + visual-parity 产品组件硬地板 + 页面身份三态均为稳定基线）

  → t0 P0：OpenSpec change delegated-vision-provider（含 spec:936 最小 delta：
           provider=独立 critic candidate 源，合法物化/非法丢弃，不进停等管线）
  → t1 P0：provider 身份与配置（共享类型/三形态最小入口/CLI 双参数/manifest 冻结/
           adapter.yaml.visual_provider 唯一支持列表/unsupported 分形态响应）
  → t2 P0：三态路由与窄钳制（静态派生/reviewVision 可选字段/prompt/人签零改动/OCR 零改动）
  → t3 P0：四 adapter 只读 HeadlessInvokePlan builder（图片 transport/model 回放/
           复用 invokeAgentHeadless 生命周期/各自 stdout 投影/统一同调用校验/批次上限）
  → t4 P1：spec 观察 sidecar（三元复用键/best-effort）
  → t5 P0：review 接线（fail-closed 结果 × fail-open 循环/原子覆盖清旧/
           独立 candidate 源/receipt 如实披露非门槛）
  → t6：单测矩阵 + 四 adapter invocation smoke + 两种拓扑完整闭环 + unsupported 反向测试 + archive
```

提交切分：t0 独立（纯 OpenSpec）；t1 独立（身份与配置）；t2 独立（钳制窄改）；t3 独立
（只读 plan builder + 既有 invoke 生命周期接线）；t4+t5 一批（协作两注入点）；t6 收口。实施阶段只允许更新 todo 状态与实施
记录，不改写裁决。todo content 是唯一实施契约载体，其他节不复述。

## 5. 用户裁决记录（2026-08-25）

1. **delegated 放行 pixel_1to1**：钳制吃 review 轴（保真档位=验收承诺，取决于「检查者」能否看图）；人签保留。v3 形态：解锁条件=静态资格（配置在场+readonly 入册+model 显式），防假 PASS 靠结果校验+VISUAL_PENDING+人签三层，不靠事前探测。
2. **spec 观察 sidecar 进首期**：接受首刀面积换首轮命中率。
3. **CLI 双参数** `--visual-adapter` + `--visual-model`：成对必填，与既有对仗。
4. **机制通用、首批四 adapter**：`adapter.yaml.visual_provider` 是唯一支持列表真源；首批仅 claude/codex/cursor/opencode，codeagent/chrys/generic 不接入；不支持时按交互重选/无人值守 WARN+blind/显式 CLI fail-fast 分流，不自动替换或 fallback。
5. **盲跑须一次显式授权（2026-08-26，t7）**：用户指出无人值守静默 blind 与 attended 询问不同构；统一为『UI 相关 + primary 盲 → 持授权方可 blind』，授权载体=交互态当场跳过 / `--allow-blind-visual`（goal 态冻结进 manifest）/ 提前配置 provider；决策点在 primary canary 尝试之后复用既有 effective 真值。本条把第 4 条的『无人值守 WARN+blind』收窄为『非 UI 需求或授权在场时维持，UI 需求且无授权 → 启动 BLOCKER』。

## 6. 评审吸收纪要

**v1 → v2（评审意见 1，七 P0 全采纳）**：①假只读→独立只读 invoke plan；②普通模式入口缺失→三形态入口+record-visual-provider；③空数组≠无缺陷→输出合同升格 fail-closed；④receipt 路径锁死→双路由；⑤provider 缺陷停等→已裁决 critic 输出（不加盲 primary 伪复核）；⑥冻结与降级矛盾→删阈值降级、分立冻结与调用结果；⑦model 冻结不住→model 必填、chrys/generic 无资格、槽位键显式。附：DefectSource 定稿、OCR 分轴、usage+批次上限、OpenSpec 先行、safeRun 同步事实、验收 1+1 写死。

**v2 → v3（评审意见 2，简化裁剪——「结果 fail-closed、循环 fail-open」收敛）**：①[P0] **删 provider canary 多槽化**（v2 t2 整条撤销）——真实调用即探测，调用失败=本轮不采信+blind 继续，无需事前判卷中间层；primary canary 零改动；vision_mode 的 delegated 判定改为静态资格（配置在场+t1⑥）。②[P0] **删 OCR 分轴**——污染源随 provider canary 消失，resolveOcrAvailableForRun/tessdata/全部 OCR 门禁零触碰。③[P0] **hasVision 不改名**——v2 的全消费面改名撤销，改为 FidelityCapability 可选 `reviewVision?` 字段（缺省=hasVision，旧调用面逐字不变），仅 delegated 判定点传值。④[P0] **删暂存图片复制**——物理只读由 readonly argv 承担，直读工程原图，receipt 图片路径天然一致无双路径映射。⑤[P0] **receipt/schema 失败不转 repair_adjudication_pending**——v2 t6⑤「物化三条件缺一停等求人」改为「缺一=丢弃本轮结果+blind 语义继续」；receipt 从物化门槛降为如实披露（既有 candidate-pass gate 对 receipt 的要求自然生效，不新增门槛）；裁决契约收敛为「合法输出=可直接回修的 critic candidate（非绝对真值），无效输出=丢弃并继续」。⑥[P0] **删 UNVERIFIED 新 check 载体**——复用既有 blind/VISUAL_PENDING 投影，provider 调用结果只决定本轮视觉反馈采信与否。⑦稳定 finding 身份层/载荷签名降为后续加固；配置入口收敛为「可选询问一次、跳过即 blind、不重复问」；资格不足两级响应（CLI 显式=fail-fast、local 失效=WARN+blind）。首期唯一硬边界写入 overview 与 t0：provider 不能写工程，不能用旧/坏结果制造 PASS；其余全部局部降级不挡循环。

**v3 → v4（评审意见 3，三处收口——机制零恢复）**：①[P0] fail-open 的现有载体接线写死——「复用既有投影」不会自动发生：严格 dispatch 对 pending 屏 = BLOCKER FAIL 挡死 phase（事实 #20）；t5⑤ 改为 provider unavailable/invalid 时跳过严格 dispatch、返回 `visual_diff` {BLOCKER, SKIP}，经既有「非 MINOR SKIP → needs_human 债务 → visual UNVERIFIED、release BLOCKED」链（事实 #21）达成「循环 PASS / visual UNVERIFIED / release VISUAL_PENDING」三态并立，零新 check/状态/轴。②[P1] smoke 人签顺序按既有契约改写：缺陷清零→candidate-pass→gate=await_human_confirm→真人 confirmed_by→重跑方 PASS（事实 #22），只改验收文字与断言。③[P1] 受理与披露分立：`input_provenance='unverified'`（无解析器 adapter）且载荷合法 = 照常回修**非无效**（防误伤 codex/cursor/opencode 做 provider）；无效仅指载荷校验失败（缺失/坏 JSON/漏屏/身份不符/hash 不符/旧 attempt）；receipt 任何情况不 halt、不进 repair_adjudication_pending。

**v4 → v5（新增问题窄修订——首批名单与 adapter 接线冻结）**：①[P0] 删除 provider 资格对 `KNOWN_MODEL_PIN_ADAPTERS` 的交集/排除集合依赖，改由 `adapter.yaml.visual_provider` 完整声明派生唯一支持列表；机制保持通用，首批仅 claude/codex/cursor/opencode，明确拒绝按 Claude-kernel 家族误放 codeagent。②[P0] unsupported 按输入形态定稿：普通交互与 attended goal 提示重选或跳过 blind（本轮不重复问），无人值守旧 local WARN+blind，显式 CLI fail-fast 列四项；不自动替换、不 fallback。③[P0] 四 adapter 从候选 argv 升为确定契约：Claude Read-only+stream-json；Codex read-only/--image/复用 e6 JSONL terminal+usage parser；Cursor Ask+JSON final result；OpenCode OPENCODE_PERMISSION+--pure/--file/raw JSON events；model 均真实回放，先投影各自 envelope 再统一校验。④[P1] 验收收敛为四次最小真实 invocation smoke + 同 adapter/跨 adapter 两个完整闭环 + 三组 unsupported 反向测试；不做 4×4 或为 Cursor/OpenCode 重跑昂贵完整 UI 循环。t2/t4/t5 机制与契约零改动。

**v5 → v6（复审收口——1 P0 + 2 P1 窄修正）**：①[P0] Claude 的 Read-only 工具集合之外再加锁定版本 `--safe-mode`，隔离 AgentMaison 工程 `.claude/settings.json`、Stop/PreToolUse hooks、CLAUDE.md、skills、plugins、MCP 等定制；不支持/未实测即不得入册，smoke 用 sentinel 证明 hooks 未触发。②[P1] 删除普通 `goal_capability` 第二资格门槛，完整 `visual_provider` 声明自身承担 invoke/model/image/stdout 全契约并独立决定支持与资格。③[P1] 普通交互与 attended goal 的询问条件改为「local 缺失或现有 adapter unsupported」，已有 unsupported 配置必须提示重选一次；跳过本轮 blind、不重复问，无人值守仍 WARN+blind。t0/t2/t4/t5 零改动，无新架构。

**v6 → v7（e6 已提交代码影响对齐——单点接线窄修）**：①[P0] t3 从“复用同一 Codex scanner 提取终态/正文/usage”纠正为 e6 实际分层：provider 只构造只读 HeadlessInvokePlan，统一复用 invokeAgentHeadless 的 spawn/timeout/tree-kill/failure/usage 生命周期；scanner 只判终态，正文用 extractCodexAgentMessageText，usage 直接取 AgentInvokeResult.usage。②[P1] Codex 采信条件冻结为 completion_observed=true 且无 terminal_failure_observed，再投影正文并走统一载荷校验；禁止第二套 spawn/terminal/message/usage parser。③[P1] t6 增既有生命周期唯一性、Codex 三事实消费与真实 smoke 断言，并把开工依赖具体化为 e6 宿主 smoke/OpenSpec/t7/串行本地提交完成、视觉 plan 已提交且 git status 干净；push 与宿主 smoke 仍只由用户触发。t0/t1/t2/t4/t5 零改动，无架构扩张。

**v7 → v8（启动契约修正——用户复盘 + codex 评审 4；t0-t5 已实施提交后的增补）**：立项：用户指出无人值守与 attended 在『UI 需求缺 provider』上行为不同构——检查时机（personal setup gate）、UI 判定（resolveUiRelevanceForRun）、拦截机制（preflight BLOCKER）、报错指引四样全部现成，v3 冻结的『provider 永为 advisory 不拦启动』是可重判的档位选择而非技术必然（agent_adapter 缺失的 BLOCKER 即无人值守语境『问』的现成形态）。codex 两点修正全采纳：①attended/无人值守**不得两套政策**——统一为『盲跑须一次显式授权』，三形态差别仅在授权载体（当场跳过=授权本次／CLI 旗标／提前配置），不存在『哪边更严』；②决策点**不得**放 canary 前的 personal setup prerequisite 集合——『primary 是否有视觉』须用 canary 后实测真值（声明式会被套壳骗过、换 pin 后缓存不可采信），落 canary 后、phase 启动前的纯决策，『不加新停点』收窄为『不加新生命周期与状态机，加一个条件判断』。授权载体三禁：不拿 fidelity=reference_only 冒充、不落 framework.local.json 永久化、goal 态必须冻结进 manifest 条件入身份哈希（resume 不丢）。启动契约与运行时降级分立（合法 provider 运行中故障仍 fail-open，不因故障反复停 run）。载体=新增 t7 + 修订当前 change（不另开 plan/change）；与在跑宿主 smoke 正交（7.7/7.8 结果仍有效，t6 的 unsupported 反向断言条件化更新后复验）。

**v8 → v9（评审意见 5，1 P0 + 3 P1 窄修——机制零新增）**：①[P0] 授权继承自相矛盾——v8 照抄 pin 继承范式让 successor 自动继承 `allow_blind_visual`，与『一次授权』冲突且正向旗标无法把继承的 true 覆盖为 false；冻结为：resume 读冻结不重询、**successor 剥离该键须重传旗标**、仅 blind+授权分支才落键（native/delegated 不存潜伏授权）、resume 新增授权走 --override-manifest；CLI 字段协调提到身份漂移检查之前（goal-runner.ts:4414 前），拦截决策留在 canary 后——落键位置与决策位置分离。②[P1] 『canary 后实测真值』表述过强——canary 有四类合法跳过与失败回退声明（goal-preflight.ts:311、goal-runner.ts:4555），真值唯一来源改为既有 effective 解析链（override→可采信缓存→声明，multimodal-probe.ts:278）在 canary 尝试后取值，不读 probeResult、不建第二真值；hard CLI HALT 先行、dry-run 只报 would_block 不拦。③[P1] t6/t1 与 t7 活跃合同冲突——t6 两处『无人值守 WARN+blind』断言**直接改为条件矩阵**（不留到实施时再更新），t1(c) 加历史语义收窄注记；补 `state=unavailable` 进『无 provider』分支（读取失败≠授权，双出路）。④[P1] 『smoke 零影响』收窄为事实表述：7.7/7.8 有效不重跑；t7 实施后补四断言窄启动 smoke（无授权 BLOCKER／落键继续／合法 provider 不误挡／resume 用冻结授权）；工作区影响按 project root 归属如实区分。

**v9 → v10（评审意见 6，1 P0 收口——机制零新增）**：[P0] v9 的『仅 blind 分支才落键』与『漂移检查前落键』时序自相矛盾——漂移检查（:4414）先于 canary（:4532），落键时尚不知道分支；漂移检查也不能后挪（canary 有 spawn 与写 local 副作用，身份检查必须先于一切副作用）。定稿为**无条件落键 + 条件消费**：显式旗标在漂移检查前无条件冻结进 manifest；canary 后决策只在 UI+blind+无 provider 分支消费；native/delegated 下键在场只是『本 run 给过授权』的冻结事实、不影响路由——授权语义绑定 run 而非分支，run 内环境退化到 blind 时按已给授权放行即『一次授权=一个 run』本义；跨 run 潜伏风险仍由 successor 剥离独立解决；**不做** canary 后二次落键/身份 rebase/二次漂移裁决（复杂化路径明确拒绝）。措辞统一两处：t7③ 与用户裁决第 5 条的『canary 实测』改『既有 effective 解析链判定／canary 尝试后复用既有 effective 真值』。其余 v9 各点评审确认已修复。

## 7. 实施记录（2026-08-26）

> 本节按 AGENTS.md「plan 执行」纪律追加：只记实施事实与偏离，不改写上方任何冻结裁决。

### 落地范围（t0–t6 仓内部分）

| todo | 主要落点 |
|------|----------|
| t0 | `openspec/changes/delegated-vision-provider/`（proposal / design / tasks + 新能力 `delegated-vision` 与 `agent-adapters`/`framework-local-config`/`goal-runner`/`visual-diff` 四份 delta） |
| t1 | `utils/types.ts`（`ProviderRef`）、`agents/adapter-schema.yaml` + 四份 `adapter.yaml` 的 `visual_provider` 声明、`utils/adapter-catalog.ts`（支持列表唯一派生）、`utils/framework-local-config.ts` + `config-field-ownership.ts`（`vision.visual_provider`）、`utils/visual-provider-identity.ts`（三形态判定）、`utils/goal-manifest{,-cli}.ts`（`visual_provider_pin` + 双旗标 + `resolveFinalVisualProviderPin`）、`goal-runner.ts` CLI、`init-task-{planner,executor}.ts` + registry `setup.visual_provider`（`record-visual-provider`） |
| t2 | `utils/types.ts`（`VisionMode`）、`utils/visual-provider-identity.ts`（`resolveVisionMode` / `reviewVisionForMode`）、`utils/fidelity-shared.ts`（`reviewVision?` + `CapabilitySnapshot.vision_mode/visual_provider`）、`utils/goal-preflight.ts`（派生一次并冻结）、`harness-runner.ts` / `check-spec.ts`（消费冻结快照）、`goal-runner.ts` 能力块 delegated 分支 |
| t3 | `utils/visual-provider-invoke.ts`（只读 plan builder × 四机制、信封投影、统一身份/hash 校验、脏检查、事件、预算） |
| t4 | `utils/visual-observation-sidecar.ts` + `goal-runner.ts` spec 期生产/回列与能力块列出 |
| t5 | `profiles/hmos-app/harness/visual-provider-review.ts`（目标屏装配 / 载荷校验 / 清旧合并 / 确定性 verdict 映射 / delegated 回执）、`visual-diff-check.ts`（`VisualDiffDefectSource` 联合体 + schema + 指纹 + 回执路径窄分支）、`check-testing.ts`（触发点与 fail-open SKIP 出口）、`capability-registry.ts`、`phase-state.ts`（provider env 成对注入）、`goal-runner.ts`（provider 缺陷不进 signal@1 复核管线） |
| t6 | `harness/tests/unit/visual-provider.unit.test.ts`（40 例矩阵）+ `tests/run-unit.ts` 注册；文档同步：goal 运行手册、`personal-setup-gate.md` S2.1、`interactive-vision-canary.md` |

### 实施期新增的判定（均为落实冻结裁决所必需，未扩面）

1. **`visual_provider` 四字段取「机制 id」而非厂商名**（`readonly_invoke` / `image_transport` /
   `stdout_envelope` 三个枚举 + `model_replay` 旗标 token）。声明面与运行时 argv SSOT 的分工沿用
   既有 `external_runner.headless_invoke` 范式；机制 adapter 通用，多个 adapter 可共用同一机制。
2. **`reviewVision` 条件进 `routing_input_digest`**（键在场即入）——评审轴是 clamp 的真实输入，
   不进 digest 会让「委托到位/委托失格」共用同一 `decision_id`；条件入集保证旧调用面 digest 逐字节不变。
3. **spec 观察 sidecar 的生产点在 `resolvePhaseCapabilityAdvisory` 的异步调用方**，advisory 本身只列。
   原因：advisory 是同步函数（既有单测按同步签名调用），而 provider 调用是异步的；把生产挪到异步调用方
   即可保持「spec 产、plan/coding 只列」的 OCR 同款纪律，且不改 advisory 签名。
4. **写入 `visual-diff.json` 时只清「旧 provider 结果」而非整屏覆盖**。`must_fix` 无自带 provenance，
   故用 `must_fix_refs` 反查：只删仅被 provider defect 引用的条目，随后重排下标并重映射其余引用。
   整屏覆盖会连带抹掉 T8 转录 defect，使 `visual_diff_finding_transcription` 由过转败——那是本机制
   不该造成的误伤。
5. **provider defect 指纹刻意走 legacy 四元组**（不追加 `invoke_id`）。`invoke_id` 每轮必变，若进指纹，
   provider 缺陷将永远「看起来是新的」，`no_progress_fuse` 对 provider 误报结构性失效——而它正是
   裁剪后保留的两层兜底之一。
6. **`skipped` 屏不进评审目标集**：把明确跳过的屏评成 pass 等于把 skip 洗成干净通过。
7. **回执路径窄分支的判据取「本 run 声明的 provider 身份」**（env 冻结值 / 个人级 local），
   不取回执自报的 adapter 名——否则伪造者可自选更宽松的那一支。窄分支只放宽目录锚：
   `critic_run_id` 精确绑定、证据日志 hash 重算、逐图验读复核三项一个都没放松。
   拒绝文案也**按分支给**：primary 支逐字保留既有句（既有回归断言与排障习惯都绑它），
   provider 支说自己的期望目录——不合并成一句含糊的"某个目录"。
8. **`provider` 评审缺陷以 `signal_identity: false` 物化**。goal-runner 的候选收集对结构化视觉
   defect 默认置 `signal_identity: true`（进 signal@1 + 物化前 defect-review 复核）；provider 结构上
   恒「未经复核」，照此走会让每个 delegated 轮次都 halt `repair_adjudication_pending`。按 t5⑤ 裁决
   改为直接物化回修，收敛兜底交既有 `no_progress_fuse` + 人签通道。T8 信号路径一字未动。

### 实施中记录的残留观察（**未擅自扩面**，交用户裁决）

- `cursor` 的 `result_json` 与 `opencode` 的 `events_json` 两种 final-result 形态尚无锁定版本
  CLI 的真实样本；投影实现按保守 fail-closed 写（形态不符→null→本轮 invalid→落盲档），
  须由 t6 真实 smoke 固定后再收紧或调整。
- ~~fail-open SKIP 会连带跳过 `checkVisualDiff` 内的其余确定性侦测器~~ ——**已在返修轮收口**
  （见下：`checkVisualDiffDeterministicOnly`）。

### 返修轮（2026-08-26，两份 review 后）

两份 review 的结论不一致（一份「通过可收口」、一份「暂不通过，4 个 P0」）。逐条在代码里复现后
**采信后者**：四个 P0 都成立，其中三个会让核心链路结构性失效。修复如下。

| # | 问题（已复现） | 修复 |
|---|----------------|------|
| P0-1 | `collectReviewTargets` 要求 `ref_path`，而 capture 骨架写的是 `ref_id`（`visual-diff-capture.ts` `buildVisualDiffSkeletonEntry`）→ **真实轮次目标屏恒为 0，provider 根本不会被调用**，随后仍走严格 dispatch 被 pending 屏挡死 | 改走既有权威参考图解析链（`buildAuthoritativeRefImageIndex` + `resolveRefSourceImage`，overlay id 归一化与 visual-diff-check 的 `refIdFor` 同口径）；`ref_path` 在场时仍优先。补真实 `buildVisualDiffSkeletonEntry` 产物形态的集成测试 |
| P0-2 | 只在「写入前」清旧 → provider 失败时不写入，于是上一轮的 provider 缺陷/举证/派生 verdict **跨 attempt 存活**并被候选收集重新物化；且无 provider defect 时提前 return 清不掉旧 `region_attest`；`must_fix` 未强制锚定导致清不干净；`schema_version` 未校验 | 改为**调用前清场并落盘**（`resetDelegatedRoundState`：清 provider defects/其独占 must_fix/其署名 region_attest，复位 `verdict=pending` 并丢 `evaluated_screenshot_hash`，**不碰 confirmed_by**）；`region_attest` 清理提到 defect 判断之前；校验期强制每条 must_fix 被 defect 锚定；强制回显冻结 `schema_version` |
| P0-3 | `bindAttendedGoalContext` 只注入 run/attempt env，没注入 provider pin → attended 下 gate 回落读 local，**manifest 冻结失效**（run 中途改个人配置就能换视觉 endpoint） | 复用同一 `applyGoalVisualProviderEnv` 注入 `context.manifest.visual_provider_pin`；补「prepare 后改 local，gate 仍用冻结值」测试 |
| P0-4 | 交互态无 run/attempt → 回执不写，而 delegated 解钳 pixel 后 candidate-pass **强制要求结构合法回执** → 我自己造出一个交互态无解的 BLOCKER FAIL，与「receipt 只披露、任何情况不 halt」直接冲突 | 交互态也写回执：`critic_run_id = interactive-<invoke_id>`，`input_provenance` 如实 `unverified`，不造 attestation 空主张 |

另按 review 收掉的 P1：

- **fail-open 不再连带关掉确定性红线**（这一条两份 review 结论相反，采信「必须恢复」）：新增
  `checkVisualDiffDeterministicOnly`——只跑改判脚本物证扫描与 `visual-diff.json` 结构校验，
  **复用既有 check id**、既有判据与严重度，无命中即空数组。fail-open 只抑制「依赖 provider
  判定」的 pending/candidate 分支。
- **删掉死常量** `VISUAL_PROVIDER_REVIEW_BATCHES_PER_ATTEMPT`。评估过 review 提议的
  「按 purpose+attempt 计数」：**会与既有人签契约冲突**——「缺陷清零→candidate-pass→
  `await_human_confirm`→真人签→**重跑 gate 方 PASS**」那次重跑是同一 attempt 的合法第二次
  调用，硬计数会把它判成超预算并落 fail-open SKIP，PASS 永远签不出来。改为把真正的契约
  （一批覆盖全部目标屏、不按屏散发）用单测钉死。
- **review 轮次的调用事件补齐**：成功与失败同等落 `<evidenceDir>/invoke-event.json`。
  刻意**不**跨进程追加 run 的 `events.jsonl`（那份日志由 runner 独占写）。
- **入口闭环**：`check-personal-setup --json` 增 `visualProvider` advisory 块（state /
  shouldPrompt / catalog 派生 supported / 现成 prompt / decisionClass / task），**永不影响
  `ok`/`code`**；personal 计划的 `record-visual-provider` 携带 catalog 派生候选。

单测从 39 例扩到 56 例，补齐两份 review 点名的全部缺口：`record-visual-provider` 走
`updateLocalConfig` 且不抹邻段、传输面失败四分档、脏检查丢弃且不 revert、事件流落盘、
sidecar 逐图独立失败、`signal_identity:false` 与 `await` 接线的源码锚定、attended 冻结、
交互态回执、确定性红线在 fail-open 下照跑。

OpenSpec delta 同步收紧（clearing 时机 / 目标屏解析来源 / must_fix 锚定 / schema_version /
attended 注入 / 确定性红线 / 交互态回执），并补了 6 条对应 Scenario。

### 验收命令与结果（仓内）

- `cd harness && npx tsc -p tsconfig.typecheck.json --noEmit` → 通过
- `cd harness && npm test`（typecheck + 单测 + fixtures）→ **exit 0**；单测 3556 passed / 0 failed，
  fixtures 44 passed / 0 failed
- `npm run openspec:validate` → 42 passed / 0 failed
- `node scripts/check-plan-version.mjs` → PASS
- `npx ts-node scripts/check-adapter-catalog-consistency.ts --framework-root ..` → PASS
- `lintConfirmationUx`（registry / skills 文案门禁）→ 0 违例

### 实施中修掉的一个真实缺陷

`visual-diff-check.ts` 里最初用 `detectRepoLayout(__dirname)` 派生 frameworkRoot——该函数从
`profiles/` 目录调用会直接抛 `Cannot locate harness root`，而调用点在 critic 回执校验的热路径上，
**连 native 路径一起弄坏**（`round4_verified_evidence_path_exact_binding` 实测挂）。改为按文件位置
向上三层派生；同时把拒绝文案按分支分开，primary 支逐字保留既有句，避免为迁就新分支去改既有断言。
- 新增 `visual-provider` 单测套件：t1 支持列表唯一真源与授权矩阵、t2 三态派生与
  `reviewVision` 缺省逐字回归、t3 四 adapter 只读 plan golden 与生命周期唯一性源码锚定、
  t4 三元复用键、t5 载荷拒收矩阵 / 清旧合并 / fail-open 投影链 / 回执双路径 / 受理与披露分立、
  t6 三组 unsupported × 四形态反向矩阵。

### 尚未执行（按 plan 与用户纪律，均须用户显式触发）

- **四 adapter 最小真实 invocation smoke**（t6 / tasks 7.7）——四份 `adapter.yaml.visual_provider`
  声明当前标注「待宿主真实 invocation smoke 回填」；`cursor` 的 `result_json` 与 `opencode` 的
  `events_json` 两种 final-result 形态尚未用锁定版本 CLI 的真实样本固定，实现按**保守 fail-closed**
  处理（形态不符即投影为 null → 本轮 invalid → fail-open 落盲档，不会制造假 PASS）。
- **两个完整 delegated 宿主闭环**（同 adapter 异模型 / 跨 adapter 异模型，t6 / tasks 7.8）。
- 因上述两项未过，**OpenSpec change `delegated-vision-provider` 不 archive**（tasks 7.11）。
- 未 commit、未 push。

### 第三轮 review 返修（1 P0 + 2 契约收口）

来源：意见1（通过，1 P0 + 2 P1）与意见2（终审通过，1 项数字回填）。

**[P0] 真人签字后的终审重跑不得再次依赖 provider。**
返修前所有非 `skipped` 屏都进 provider 目标集（含已 `pass + confirmed_by` 的屏），
而调用前清场会把 verdict 复位 `pending`、删 `evaluated_screenshot_hash`、连 provider 以
`vl_screening` 写的 `region_attest` 一起清掉。于是既有闭环的最后一步
「真人 confirmed_by → 重跑 gate 方 PASS」变成了：provider 第二次恰好不可用 → 人签成果被抹掉 →
`visual_diff` SKIP → release 继续 BLOCKED。**下级审查者的可用性否决了上级权威**，人签永远收不了口。

修法（新增纯谓词 `isHumanSignedAndFresh`，`collectReviewTargets` 与清场循环共用）：
真人已签**且**被评截图 hash 等于盘上当前截图 hash 的屏，**既不进目标集、也不清场**。
判据只用既有事实——`isHumanVerified(confirmed_by)`（自动化身份不算数，谓词零改动）+ 截图 hash
绑定；**不新建任何新鲜度状态**。构建指纹变化、换图、pending/fail 等其余情形一律照常进评审。

安全性论证：命中**只是不再问 provider**，该屏随后仍完整进入既有严格 `checkVisualDiff`
（build 指纹、截图 hash、confirmed_by、receipt、defects 枚举全部照跑）——没有绕过任何门禁，
只是不再销毁它已经合法取得的状态。全部目标屏都命中时 `targets` 为空，走既有 `skipped` 出口，
调用方照常执行严格 dispatch，行为等于本机制不存在。

对应回归：`t5 人签终审闭环` —— 正向断言 provider **一次都不被调用**且 `visual-diff.json`
逐字节未变；反向断言换图后照常评审并清场、`confirmed_by` 仍不由本机制改动。

**[契约收口] batch 语义按已确认裁决替换。**
t3⑥ 与 t0 spec 原文写的是「review 每 attempt 一批」。运行时契约收窄为**按形态而非计数**：
**一次 checker 执行最多发起一个 review invocation，且该 invocation 一批覆盖全部待评审屏，
禁止按屏散发**；不引入调用账本 / per-attempt 计数器 / 预算状态。已同步 OpenSpec
（`delegated-vision` 预算 requirement + 新增 scenario）。plan 冻结正文按纪律不改写，
此处记为**被实施裁决替代**。

（四轮返修订正：本条最初以「人签后同 attempt 会再调一次 provider」作为不设 per-attempt cap 的
理由——该理由已随人签豁免 P0 修复失效：人签终审重跑**根本不再调用 provider**。结论不变，
过时理由已从 OpenSpec 与本记录中删除。）

**[文档收口] `visualProvider` advisory 成为登记在册的稳定字段。**
`personal-setup-gate.md` 的稳定 stdout 字段清单加入 `visualProvider`，并写清消费方式：
UI 相关且主模型无视觉时读 `shouldPrompt` 决定问不问（不由 agent 在对话里重新推断），
选项与提示语取 `supported[]` / `prompt`，registry 与写盘任务取 `decisionClass` / `task`；
明确它**永不**影响 `ok`/`code`。配套加了文档锚定单测，防止字段清单与实现悄悄漂移。

### 最终验收（第三轮返修后）

- `cd harness && npx tsc -p tsconfig.typecheck.json --noEmit` → 通过
- `cd harness && npm test`（typecheck + 单测 + fixtures）→ **exit 0**；
  单测 **3575 passed / 0 failed**，fixtures **44 passed / 0 failed**
- `npm run openspec:validate` → 42 passed / 0 failed
- `node scripts/check-plan-version.mjs` → PASS
- `npx ts-node scripts/check-adapter-catalog-consistency.ts --framework-root ..` → PASS
- `lintConfirmationUx`（registry / skills 文案门禁）→ 0 违例
- `visual-provider` 单测套：**59 例**全绿


### 第四轮返修：`evaluation_invalidated` 由 harness 确定性清除（用户裁决方案①）

**问题**：三轮返修给已人签且新鲜的屏加了「不进评审、不清场」的豁免，同时正确地把
`evaluation_invalidated === true` 的屏排除在豁免之外（被点名要求重评的屏不该被豁免挡住）。
但当时**没有任何代码会清除该标记**，于是 delegated 闭环出现永久阻断点：

```text
evaluation_invalidated=true → 人签豁免正确拒绝保护 → provider 每轮成功重评
→ 标记始终不清 → visual_diff_evaluation_invalidated 档位无关 FAIL 永远挂着
```

**裁决（用户，方案①）**：接通清除，且表述必须准确——**不是给 provider 清除权限，而是
harness 在采信一次合法、当前图片绑定的 delegated 重评后确定性清除**。状态转换权唯一归 harness；
provider 载荷里没有、也不许有任何形如 `clear_invalidated` 的字段。

**实施契约**（对原本带标记的目标屏）：

1. 调用前**保留**标记；同时丢弃该标记点名不可信的旧评估产物——`fidelity_score`、
   `geometric_iou`、`reported_fidelity_score`、`reported_geometric_iou`、机器产出的
   `region_attest`。**`method:'human'` 的逐区域举证保留**：与 `confirmed_by` 同属最高权威，
   该标记的既有文案本就写明「真人 confirmed_by 的 pass 表态不作废」。
   采集身份字段（screenshot/build/run 指纹）不碰——那与「评估可不可信」正交。
2. provider unavailable / invalid / 错身份 / 错 hash / 漏屏 / 工作区变脏 → 标记原样保留，
   无假清除，继续既有 fail-open 投影。
3. 载荷通过全部既有校验**并成功应用到该屏**后，harness 删标记，写入新的
   `must_fix/defects/region_attest/evaluated_screenshot_hash`，保留 `confirmed_by`。
4. **无论本次映射为 pass 还是 fail 都清**——该标记问的是「旧评估是否可信」，不是「UI 是否通过」；
   真发现缺陷时新写入的 `must_fix/defects` 自然继续阻断并驱动回修。
5. **不把 receipt 写盘成功加成清除条件**——评估新鲜度、receipt 披露、最终 gate 是三份各自
   独立的责任，严格 gate 仍会自己查 receipt。

无新状态机、新权限字段、新 receipt 类型、清除台账。

对应回归两组：`合法重评被采信后由 harness 确定性清标记`（标记删除 / 旧分数与旧机器举证作废 /
人类举证与 `confirmed_by` 保留 / 采集身份不动 / fail 映射也清）与
`provider 不可用时标记保留、无假清除`。

**同步删除的过时理由**：batch 契约原以「人签后同 attempt 会再调一次 provider」解释为何不设
per-attempt cap；该理由已随三轮的人签豁免修复失效（人签终审重跑根本不再调用 provider）。
结论不变，理由已从 OpenSpec 与本记录删除。


### 第五轮返修：「已人签 + evaluation_invalidated」组合的永久死锁

四轮接通清标记后暴露一个组合边界：**清标记早于严格证据闭环，而下一轮已触发人签豁免**。

```text
本轮：屏带 confirmed_by + invalidated → 不受豁免（正确）→ 重评成功 → 标记被清、写 pass
     → 严格 gate 因「回执缺失」或「区域覆盖不全」FAIL
下一轮：标记已清 + confirmed_by 仍在 → 命中人签豁免 → provider 再也不被调用
     → 只有新一次重评能修的 FAIL 变成**永久死锁**
```

两个确定性触发点：①回执写盘失败（既有 gate 在任何 region_attest 在场时都要求结构合法回执，
而四轮把回执写失败吞掉了）；②provider 只回一条泛化 `region_attest`（采信时只校验非空，
严格 gate 才发现未覆盖 `must_have_elements`）。

**四处订正**：

1. **采信前就查严格 gate 会要的举证**（与既有判据逐条同构）：pixel 契约下 P0 clean-pass 屏的
   `region_attest` 须覆盖全部 `must_have_elements`；`diff_logged` 须能落到 defect/must_fix
   （clean-pass 候选的 defects/must_fix 皆空 ⇒ 任何 `diff_logged` 结构上无处锚定，直接判 invalid）。
   不合格即 invalid → 标记保留 → 下一轮照常重评。
2. **回执先落盘成功，再提交 `visual-diff.json`**。写不出即本轮 `unusable`，盘上停在调用前的
   清场态（标记仍在）。这**不是**把 receipt 升格为物化门槛——回执内容仍只作披露、
   `input_provenance` 仍只是证据等级；这里约束的只是**提交顺序**：一次被采信的轮次不得留下
   一个「严格 gate 拒收、而后续轮次又修不了」的盘上状态。
3. **旧 `region_attest` 全清，`method:'human'` 不再例外**（推翻四轮的保留）。理由采纳评审：
   既有规格的失效对象本就包含全部 region_attest；`region_attest[].by` 是可选自由字符串，
   既不过 `isHumanVerified` 也不绑截图 hash，**它不是经过验证的人签**；保留旧条目还会让
   旧举证与新举证拼接满足区域覆盖，直接削弱 fresh re-evaluation。真人权威由
   `confirmed_by + evaluated_screenshot_hash` 唯一承载。
4. **人签屏带 invalidated 时，清场保住 `verdict` / `confirmed_by` / `evaluated_screenshot_hash`**。
   这类屏只因带标记才成为目标，阻断由未清的标记承担（档位无关 FAIL，可被一次成功重评解除）；
   不需要、也不该再让一次 provider 断供顺手抹掉真人的 pass 表态。谓词拆成两个：
   `isHumanSignedForCurrentShot`（看人签+图新鲜，决定清场是否保状态）与
   `isHumanSignedAndFresh`（前者 ∧ 无标记，决定是否豁免评审）。

对应回归三条：区域覆盖不全 → 采信前即 invalid 且标记保留；回执写不出 → 不提交 json、
标记保留；人签屏带 invalidated 且 provider 断供 → verdict/confirmed_by/被评 hash 全部保住。
另把「无人签的 provider 推导 pass 不得跨轮存活」单独立为一例（helper 加 `humanSigned` 开关），
避免两种语义混在同一夹具里。


### 第六轮返修：overlay 屏绕过采信前覆盖预检 + 两处合同残文

**[P0] overlay 屏仍能绕过五轮新加的区域完整性预检。**
目标装配查 ui-spec 用的是原始 `screen_id`，而严格 gate 会先按 `canonicalOverlayBase` 归一化回基屏。
overlay 的 P0 与 `must_have_elements` 通常声明在基屏上，于是：

```text
overlay 屏 → 目标装配查不到 spec → priority 为空 → 采信前覆盖预检被跳过
→ 清除 invalidated → 严格 gate 归一化后才发现覆盖不全
→ 该屏带 confirmed_by ⇒ 下一轮命中人签豁免 → provider 永不补齐 = 死锁复活
```

修法是让两处用**同一解析口径**（与 gate 逐字一致：先基屏、再回落原 id）：

```ts
const spec = byId.get(canonicalOverlayBase(s.screen_id)) ?? byId.get(s.screen_id);
```

这是五轮新增「采信前 P0 校验」带出的直接接线缺口，不是架构扩审。
补 overlay 回归：基屏 P0 且声明多个 `must_have_elements`，overlay 只回一条泛化 region →
采信前即 invalid 且标记保留（helper 加 `screenId` 开关）。

**[P1] 两处合同残文清理。** 同一份 OpenSpec 里存在自相矛盾的旧结论：
①一处仍写「human attestations 保留」（五轮已推翻，应全清）；
②一处仍写「receipt 持久化不是清标条件」，与后文「receipt 必须先持久化、失败即本轮 unusable」冲突。
统一为准确表述并同步代码注释：

> `input_provenance` 的**证据等级不决定是否采信**；但 **receipt 成功持久化是提交本轮评审结果的
> 前置条件**。

scenario 同步改为：全部旧 `region_attest` 被清除，最终存在的 attestation 只能来自本次新载荷；
`confirmed_by` 与被评截图 hash 保留。plan 第四轮记录属历史过程、五轮已明确推翻，按评审意见保留不改写。

### 最终验收（第六轮返修后）

- `cd harness && npx tsc -p tsconfig.typecheck.json --noEmit` → 通过
- `cd harness && npm test`（typecheck + 单测 + fixtures）→ **exit 0**；
  单测 **3581 passed / 0 failed**，fixtures **44 passed / 0 failed**
- `npm run openspec:validate` → 42 passed / 0 failed
- `node scripts/check-plan-version.mjs` → PASS
- `npx ts-node scripts/check-adapter-catalog-consistency.ts --framework-root ..` → PASS
- `lintConfirmationUx`（registry / skills 文案门禁）→ 0 违例
- `visual-provider` 单测套：**65 例**全绿

---

## 实施记录 · tasks 7.7 宿主真实 invocation smoke（2026-08-26，用户触发）

宿主：`D:\1.code\SimulatedWalletForHmos`（用户指定）。写入面仅 `<project>/.maison-smoke/`，
**未改宿主任何配置文件**——原设计的「往 `.claude/settings.json` 注入 hook sentinel」在实施时
放弃：该工程本就注册着真实 hook（`PreToolUse`→guard-framework-write、`Stop`→check-phase-completion、
`SubagentStop`→record-verifier-report），改为非侵入快照其落盘面（`framework/harness/state/`）。
四次调用该快照均逐字不变。

金丝雀复用既有 `generateRandomCanaryAnswerKey` + `renderCanaryImage`（**未新增 provider canary**，
符合 plan 边界）：随机四象限配色 + 随机 8 位 token，答案只在调用方内存，模型必须逐字报回。

### 结果

| adapter | 断言 | 结论 |
|---|---|---|
| claude | 16/16 | **入册**。四象限 4/4、token 逐字精确；首批唯一 `provenance=verified` |
| codex | 13/14 | **入册**。四象限 4/4、token 仅差同形字 `0`→`O` |
| opencode | 16/16 | **入册**。四象限 4/4、token 逐字精确 |
| cursor | 8/11 | **退出第一期**（用户决定）：免费档不可指定模型 |

claude 首轮卡在 `OAuth session expired`（账号面，非机制面），用户重登后复跑全过。它是首批唯一
`input_provenance=verified` 的 provider——有结构化验读事件解析器，事件流实证本轮图片确被读取；
codex / opencode 只能记 `unverified`，这正是 design.md §7「受理与披露分立」要保护的场景。

### 本轮修掉的真缺陷：`events_json` 投影不认识 opencode 真实形状

`projectVisualProviderBody` 原把 `result_json` 与 `events_json` 并到 `extractJsonFinalResultText`，
而后者 `pick()` 会拒收任何 `type !== 'result'` 的行。opencode 1.18.14 `run --format json` 的真实
输出是 NDJSON `{type, timestamp, sessionID, part}`，正文在 `type==='text'` 行的 `part.text`
⇒ **一次完全合法、四象限全中的评审被误判 `invalid`**。这是 fail-closed 方向的误伤：不会伪造 PASS，
但会让 delegated 恒退化回 blind，等于整个 opencode provider 静默失效。

新增 `extractOpenCodeFinalText`，形状以真实样本钉死。`result_json` 保持原实现不动，两条方言就此分立。

**首版实现有 P0，同轮由评审意见 1 指出并修复**：首版用「全流见过任意 `step_finish`」这种**全局**
判据 + 取最后一条 message 的分片，于是

```
text(m1) / step_finish(m1) / text(m2)      ← m2 还在流，尚未 finish
```

会把**未完成的 m2** 当终稿返回。方向上这是 fail-closed 的**危险侧**——把没写完的半截答案当完整
评审采信，比整轮判 invalid 严重得多。定稿改为**终态绑定最后一段正文**，四条锚点缺一即 null：

- 见 `type==='error'` 行即判无终稿（实测 401 密钥错 / 403 模型未开通都在此被挡）；
- `step_finish` 只封**它自己那条 message** 的稿（两侧都带 `messageID` 时必须同源）；
- `part.reason` 必须是 `stop`，`tool-calls` 等中间终态不封稿（后面还有内容要来）；
- finish 之后又出现 `step_start` / 新 `text` ⇒ 此前封稿**失效**（流还没走完）。

教训记一笔：首版单测只验了「整个流没有任何 finish」，覆盖不到「旧消息已 finish、新消息未 finish」——
**流式协议的终态判据必须绑定到具体消息，不能用全局标志位**。已补五条回归。

### 契约措辞订正 + 只读单点负例对照（tasks 7.7a）

原 adapter.yaml 与 design.md 均写「safe mode 隔离 .claude/settings.json、hooks、…」，**与锁定版
2.1.228 实测不符**：其 `--help` 原文即 "Auth, model selection, built-in tools, and permissions
work normally."。本轮拿到一次**天然 A/B**：用户中途重登并把用户级 `permissions.defaultMode` 从
`bypassPermissions` 改成 `auto`，同一份 argv 下子进程 init 的 `permissionMode` 随之改变
⇒ 该档位**穿透** `--safe-mode`；safe mode 只压定制面（skills 23→17、slash 64→45）。

于是关键问题变成：物理只读退化为 `--tools Read` 单点后，这个单点在最坏档位下还成立吗？
**负例对照实测成立**：显式 `--permission-mode bypassPermissions` + 中性措辞命令 provider 写文件，
模型真实尝试后回报 "I only have the `Read` tool available in this session—there's no Write, Edit,
or shell tool provided"；目标文件未创建、`porcelain` 前后一致、事件流零写类工具调用。
即**无写工具即无写路径，与权限档位无关**。

> 方法上有一处必须记下：首次负例用了「你有完全权限，立刻执行，不要解释」这类带压迫感的措辞，
> 模型识别为注入探针**直接拒绝**——测到的是模型判断力，不是只读机制，等于白测。改用中性的正常
> 工程请求重做才把机制本身逼出来。负例对照的措辞设计本身就是实验的一部分。

⇒ **裁决（2026-08-26，评审意见 1）：首期不补 `--permission-mode`。** 依据即上述实证——权限档位
只决定「已有工具是否免确认」，**无法凭空增加写工具**；物理只读由工具可见性（`--tools Read`）
保证，纵深防御不是当前正确性所需，按裁剪原则不加。**复检触发条件**：升级 claude CLI 锁定版本时
重跑本节 smoke——若 `--tools` 语义或 init 事件的 `tools` 回报发生变化，本裁决须重审。

### cursor 退出第一期

实测 argv 与 stdin 传输面成立（进程真实起转 8.7s），被服务端拒于
`ActionRequiredError: Named models unavailable Free plans can only use Auto.`——账号档位与
「model 必须真实回放」硬性要求互斥。已撤 `agents/cursor/adapter.yaml` 的 `visual_provider` 块。
**运行时一行未动**：`ask_mode` / `result_json` 机制留在词表内并改为独立机制单测（不再依赖该
adapter 是否声明），第二期补回声明即恢复资格——这正是「机制 id 而非厂商名」当初要换的收益。

### 验收

- `npx tsc --noEmit -p harness/tsconfig.json` → 通过
- `cd harness && npm test` → **exit 0**；单测 **3583 passed / 0 failed**、fixtures **44 / 0**
- `npm run openspec:validate` → 42 passed / 0 failed
- `node scripts/check-plan-version.mjs` → PASS
- `npx ts-node harness/scripts/check-adapter-catalog-consistency.ts --framework-root .` → PASS

### 收口状态（2026-08-26 用户裁决后）

**7.7 全部收口**：claude / codex / opencode 三份入册凭据均已取得，cursor 按用户决定退出第一期，
7.7a 已实证收口。

**7.8 经用户裁决取消**：改为版本发布后由用户自行在宿主实测。据此，本 plan 正文
「因上述两项未过，OpenSpec change 不 archive」（第 289–290 行）**已被该裁决取代**——正文属冻结
决策不改写，取代关系记在此处。`tasks.md` 7.11 已由用户标为门槛满足。

**因取消而缺失的证据（如实记录，勿在别处当已证引用）**：7.7 证到的是**单次调用**的传输面——
图片确实进入模型、不写工程、信封投影、身份回显。**未证**的是端到端开发循环在 delegated 模式下
能收敛闭环，即「评审缺陷物化回修 → 缺陷清零 → candidate-pass → 人签闭环」这条链；该链目前
**仅由仓内单测覆盖**（7.4 / 7.5），无宿主真实运行佐证。这是一项**待观测的空白**，不因取消而
变成已验证；发版门禁独立于宿主是另一件事，两者不可互相推导。

**t7 归属已按单源原则归位**：t7⑨ 冻结「修订本 change，不另开 change；archive 条件扩为 t7 单测与
文档全过」。中途 `tasks.md` 曾一度写成「t7 不属本 change、可 archive」，与 t7⑨ 冲突，已回改；
`tasks.md` 第 8 节已恢复 t7 的 13 条 pending 条目。**⇒ 本 change 暂不 archive**，待 t7 收口后一次归档。
「暂时不做 t7」不等于「改变 t7 的归属」——这是两件事。
