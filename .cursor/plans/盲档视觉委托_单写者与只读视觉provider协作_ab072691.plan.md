---
name: 盲档视觉委托 — 单写者与只读视觉 provider 协作（delegated vision）
version: 3.0.0
todos:
  - id: t0-openspec-first
    content: "P0 · OpenSpec 先行——契约冻结在代码之前，范围沿用 v4 的裁剪边界。建 change `delegated-vision-provider` 并过 `npm run openspec:validate` 后方可动实现代码。change 承载：①三态路由 native/delegated/blind（delegated=静态资格判定，无 provider canary）与窄钳制（reviewVision 可选字段）；②provider 身份（ProviderRef {adapter, model} 必填、manifest 冻结、三形态配置入口）；③**机制 adapter 通用、首批支持固定为 claude/codex/cursor/opencode**，资格与支持列表唯一从 `agents/<adapter>/adapter.yaml.visual_provider` 的完整声明派生，禁止 TypeScript 白名单、adapter 家族推断或手写文档列表形成平行真源；`codeagent/chrys/generic` 首批不声明、不可作为 provider；④unsupported 行为冻结：普通交互态首次配置与 attended goal 创建 manifest 前均提示四个支持项并允许重选，跳过则本轮 blind 且不重复询问；无人值守读到旧 local unsupported 配置时 WARN、忽略并 blind 继续；显式 CLI `--visual-adapter` unsupported 时 fail-fast 并列出四项；不自动改选 Claude、不在多个 provider 间 fallback；⑤四 adapter 独立只读 invoke + 各自 stdout envelope 投影 + stdout-only 同调用校验；⑥**修订 goal-runner spec:936 裁决 requirement 的最小 delta**：provider 评审缺陷是独立的 critic candidate 源——**合法即物化回修、非法即丢弃降级，不进入感知信号的 defect-review/repair_adjudication_pending 停等管线**（该管线原样服务 producer 感知信号）；⑦receipt delegated 形态如实披露（非物化门槛）。核心不变量一句话入 spec：**provider 不能写工程；不能用旧的或坏的 provider 结果制造 PASS；provider 故障只降级本轮视觉反馈，不阻断开发循环。**同步产物：goal-manifest schema 文档、personal-setup-gate.md、goal runbook、交互态文档；文档只说明声明规则并指向 adapter catalog，不另枚举支持名单。宿主 smoke 全过前不 archive。"
    status: pending
  - id: t1-provider-identity-config
    content: "P0 · Provider 身份与配置层（最小形态）。**①共享类型**：`ProviderRef {adapter: string; model: string}` 落 utils/types.ts（model 必填——冻结具体 endpoint；不依赖 goal-manifest 类型）。**②个人级配置**：framework.local.json `vision.visual_provider {adapter, model}`——config-field-ownership.ts:21 LOCAL_VISION_KEYS 加 'visual_provider'；解析校验落 framework-local-config.ts vision 段（:277-384）；写入只走 updateLocalConfig（:520-541，两起段抹除事故先例）。**③三形态最小入口与重选语义**：(a) 普通交互态：首次 UI 相关 phase 且 **local 缺失或现有 adapter 不在 catalog 支持列表**时可选询问一次 adapter+model（复用 personal setup 门控范式：init-orchestrate --scope personal 新任务 `record-visual-provider` 机器写盘 + confirmation-registry `setup.visual_provider`，agent 不手写 JSON——personal-setup-gate.md 既有纪律）；已有 unsupported local 也必须进入同一提示：`adapter <name> 暂未接入视觉 provider。首批支持：claude、codex、cursor、opencode。请重新选择，或跳过并以 blind 模式继续。`，用户跳过即继续 blind、本轮不重复问；(b) attended goal：创建 manifest 前复用同一条件（local 缺失或现有 adapter unsupported）与配置/重选流程，合法选择写 local 后冻结进 manifest，跳过仍可启动 blind run；(c) 无人值守：不询问，读取旧 local 命中 unsupported 时 WARN、忽略该配置并以 blind 继续，不能停 run；没有配置同样 blind。**④CLI 双参数**（用户裁决③）：goal-runner.ts minimist string 数组（:3702-3713）加 'visual-adapter'/'visual-model'，help :3737 旁，归一化复用 normalizeAdapterModelCliValue 同款（goal-manifest-cli.ts:91-110）；两旗标成对，单给任一 fail-fast；优先级 CLI > local；本次显式 `--visual-adapter` 命中 unsupported 必须 fail-fast 并列出 catalog 派生的四个支持项，禁止静默忽略。**⑤manifest 冻结**：`visual_provider_pin?: ProviderRef` 条件入身份哈希（computeManifestIdentityFields :180-182「键在场即入」）；加载 shape 校验；resume 读冻结值不重读 local；successor 随 ...inherited 继承；授权纯函数 `resolveFinalVisualProviderPin`（规则子集对齐 resolveFinalModelPin :161：fresh 接受/resume 异值须 --override-manifest/successor 出生输入可覆盖）。**⑥资格与支持列表唯一真源**：扩展 adapter schema，`visual_provider` 完整声明定稿为 `{readonly_invoke, image_transport, stdout_envelope, model_replay}`；运行时由 adapter catalog 扫描该字段派生支持项，**完整声明本身就是 provider 支持与运行资格，普通 Goal/headless 的 `goal_capability` 不参与 provider 资格判定**；首批只给 `claude/codex/cursor/opencode` 声明，`codeagent/chrys/generic` 均不声明。删除/禁止中心 `KNOWN_MODEL_PIN_ADAPTERS` 交集、排除集合、Claude-kernel 家族推断和独立文档白名单；support help/提示/校验均消费同一 catalog 结果。provider 不要求物化（goal-preflight.ts:392 金丝雀先例）。primary≡provider 同 endpoint 不设错误（native 时天然不用），仅冗余 advisory；绝不自动换成 Claude 或 fallback 到其他 provider。"
    status: pending
  - id: t2-vision-mode-and-clamp
    content: "P0 · 三态路由与窄钳制——delegated 放行 pixel_1to1（用户裁决①）；**无 provider canary，真实调用即探测**（评审 2）。**①vision_mode 派生纯函数**：native = primary hasVision（现状三层解析链 resolveContextAdapterImageInput，**primary canary 机制零改动**）；delegated = !primary hasVision && visual_provider 配置在场 && t1⑥ 静态资格通过；blind = 其余。preflight 派生一次冻结、run 内不可变；**provider 每次调用的成败只决定『本轮视觉反馈是否采信』，不反向改写 vision_mode、能力真值或 manifest**（effective-vision-context.ts:4-5 既有纪律）。**②snapshot**：CapabilitySnapshot（fidelity-shared.ts:937-987）扩展可选键 `vision_mode` + `visual_provider?: {adapter, model}`——旧 snapshot 无键=现状语义；写入者 goal-preflight.ts:624-632 同批共享 decision_id。**③窄钳制（评审 2：不全局改名）**：FidelityCapability（fidelity-shared.ts:600-605）**保留 hasVision 字段与语义**（=primary 是否有视觉），新增**可选** `reviewVision?: boolean`；clampFidelityByCapability(:623-637) 内 `const review = capability.reviewVision ?? capability.hasVision`，钳制判据从 hasVision 换为 review——**旧调用面零改动**（不传 reviewVision 行为逐字不变），唯 delegated 判定点（resolvePhaseCapabilityAdvisory goal-runner.ts:2472-2474、harness-runner fidelityCtx 装配、check-spec.ts:197）传 reviewVision=true；效果：native/delegated 不钳（pixel_1to1 放行），blind 钳制表逐字不变。防假 PASS 不靠事前探测，靠 t5 的结果校验 + 既有 VISUAL_PENDING 投影 + pixel_1to1 人签三层兜底。**④prompt 能力块**：buildCapabilityBlock（goal-runner.ts:1134-1242）delegated 分支——盲档块（:1188-1239）基础上明示：你无视觉；只读视觉审查器 (adapter, model) 将在截图后对每屏产结构化评审并回给你修复；参考图旁有 .visual.json 观察 sidecar；正式产物唯一写者仍是你。buildUnattendedExecutionBlock（:1244-1317）pixelReachable(:1257) 按 review 轴判。**⑤人签零改动**：visual_diff_human_confirm_required（visual-diff-check.ts:1602-1617）isHumanVerified 原样；provider 永不写 confirmed_by。**⑥OCR 链零改动**（评审 2）：无 provider canary 即无 ocr_capable 污染源，resolveOcrAvailableForRun（fidelity-shared.ts:1413-1420）、tessdata、全部既有 OCR 门禁不触碰。"
    status: pending
  - id: t3-readonly-invoke-executor
    content: "P0 · Provider 只读 invoke 执行器——物理只读是首期唯一硬边界之一（评审 2）。现行普通 headless argv 恒全权限（claude `--dangerously-skip-permissions` agent-invoke.ts:329、codex `--sandbox danger-full-access` :358、cursor `--force --trust` :373、opencode `--dangerously-skip-permissions` opencodeHeadlessPlan），不得复用。新模块 utils/visual-provider-invoke.ts 只做 provider adapter wrapper：**①`resolveVisualProviderInvokePlan` 仅构造独立只读 `HeadlessInvokePlan`**：消费 t1⑥ catalog 中 `visual_provider {readonly_invoke, image_transport, stdout_envelope, model_replay}` 声明，不调用普通全权限 claudeArgv/codexArgv/cursorHeadlessPlan/opencodeHeadlessPlan；所有真实调用随后统一进入既有 `invokeAgentHeadless(plan, cwd, opts)`，`stdout_envelope` 只负责选择既有 terminalEventParser/usageCapture 与调用后正文投影。视觉 provider **不得重写或旁路 child spawn、timeout/tree-kill、terminal failure 优先仲裁、stdout/stderr 汇集或 usage 回填生命周期**，不得直接再调 `deriveInvokeUsage`；分钟级 provider timeout 通过既有 `AgentInvokeOptions.timeoutMs` 注入。四份声明须经真实 smoke 后入册，缺失/不完整即不具资格。model 必须真实进入各 CLI 的 `--model/-m`，图片直接使用工程内真实路径（无暂存复制）。**②四 adapter 确定接线**：(a) `claude`：锁定版本使用 `-p --safe-mode --tools Read --allowedTools Read --disallowedTools mcp__*`；`--safe-mode` 隔离 `.claude/settings.json`、CLAUDE.md、skills、plugins、hooks、MCP、custom commands/agents 等工程定制，`--tools Read` 从模型上下文移除全部非 Read 内建工具，`mcp__*` 再显式拒绝 MCP 工具；禁止 `--dangerously-skip-permissions`。prompt 明列真实图片路径由 Read 读取；`--model <pin>`；保留 `--output-format stream-json --verbose`，复用 `claude-envelope.ts`/既有 Claude stream-json final result 与事件投影；若锁定版本不支持或实测 `--safe-mode` 未完成该隔离，则该声明不得入册，不退回工程默认配置启动。(b) `codex`：只独立构造 `HeadlessInvokePlan`（`adapterName:'codex'`，argv=`codex --ask-for-approval never exec --model <pin> --sandbox read-only --image <path> --json`；顶层 approval 与 `exec --model … --sandbox …` 顺序继承 e6 已验证形态），绝不复用普通 `codexArgv` 的 danger-full-access；随后交给 `invokeAgentHeadless` 统一处理 child 生命周期、timeout、`turn.failed` 优先仲裁和 usage 回填。`createCodexTerminalScanner` **只负责** `turn.completed/turn.failed` 终态；provider 仅在 `AgentInvokeResult.completion_observed===true && terminal_failure_observed!==true` 时调用既有 `extractCodexAgentMessageText(result.stdout)` 投影正文，返回 null 仍判 invalid；usage 只消费 `AgentInvokeResult.usage`，不直接调用 `deriveInvokeUsage`。相对 e6 只新增只读 plan、原生 `--image` 与统一 provider 载荷校验，禁止第二套 spawn/timeout/terminal/message/usage parser。(c) `cursor`：`cursor-agent|agent -p --mode ask --model <pin> --output-format json`，禁止 `--force`；prompt 明列图片真实路径，由 Ask 模式的 Read 读图；只解析 JSON 的确定性 final result（不把增量/工具事件当正文）。(d) `opencode`：以 `OPENCODE_PERMISSION` inline JSON 将 edit/bash 及其他非只读工具置 deny（只放行 read/glob/grep），配合全局 `--pure`；`run -m <pin> --file <path> --format json` 原生附图；解析 raw JSON events 并新增 OpenCode final-result 投影。**③各 adapter 先取得统一 `AgentInvokeResult`，再按自身 `stdout_envelope` 投影正文；usage 一律直接消费 result.usage；随后做统一 schema + 身份回显 `{run_id?, attempt_id?, image_hashes[]}` 逐字/hash 校验**。空/坏 envelope、CLI 缺失、超时、terminal failure、模型不支持图片、非 JSON/schema 坏、身份/hash 不符均令本轮 outcome=unavailable|invalid，provider 写盘产物一律不采信，开发循环按 t5 继续。Codex/Cursor/OpenCode 没有可信图片工具事件时 receipt 如实 unverified，不影响合法载荷用于回修。**④脏检查第二防线**：invoke 前后工程 `git status --porcelain` 对比，变脏 → 本轮结果丢弃 + events 记录，不自动 revert、不 halt。**⑤events**：`visual_provider_invoke` 事件（{provider, purpose, image_hashes, outcome: success|unavailable|invalid, duration_ms, invoke_id}，adapter_probe :4948-4960 同族）；可得的 invoke 结构化事件流落 `<report_dir>/visual-review/<invoke_id>/agent-events.jsonl`（receipt 证据披露用，t5④；无可信读图事件仍标 unverified）。**⑥预算**：不占 max_total_turns/max_retries；占 wall_clock；计入 `AgentInvokeResult.usage`；per-purpose 批次上限（spec_observation ≤ 参考图数且单 run 封顶；review 每 attempt 一批）；分钟级独立 timeout 复用 `invokeAgentHeadless`，不另建计时器、不吃 phase timeout 表。官方契约锚点：Claude safe-mode/tools/stream-json `https://code.claude.com/docs/en/cli-usage`，Cursor Ask/JSON 输出 `https://prod.cursor.com/docs/cli/using`，OpenCode permission/CLI `https://dev.opencode.ai/docs/permissions/` 与 `https://dev.opencode.ai/docs/cli/`；实现前仍以锁定版本本机 help+真实 smoke 复核。"
    status: pending
  - id: t4-spec-observation-sidecar
    content: "P1 · spec 期视觉观察 sidecar（用户裁决②：进首期）。**①产物**：`<spec reports>/visual-observations/<slug>.visual.json`（与 ocr/<slug>.ocr.json 平行，slug 复用 sanitizeOcrPrescanSlug 同款 goal-runner.ts:2363-2367）。**②形态**：{schema_version, protocol_version, source_image（回指，:2396-2399 同款理由）, image_hash, provider: {adapter, model}, observations: [{region, fact}]}；地位=ocr.json 逐字对齐：best-effort 上下文、非门禁产物、不产 check、单图失败不阻断其余（:2402-2404 同款）、生产失败整体不阻断 spec（对应图无 sidecar 而已）。**③复用键**：image_hash + provider (adapter, model) + protocol_version 齐等才复用，否则重产（防换 endpoint/升协议后沿用旧观察）。**④生产时机**：vision_mode=delegated 且 phase=spec 时经 t3 executor（purpose='spec_observation'）；dispatch 对齐 OCR 预扫描（:2478-2482）：spec 生产、plan/coding 只列已有。**⑤prompt 接线**：CapabilityAdvisory（goal-runner.ts:1104-1127）加 `visualObservationPaths`，buildCapabilityBlock 列出（:1229-1238 同款形态）。**⑥验读证据 best-effort**（评审 2 降级）：provider adapter ∈ IMAGE_READ_PARSERS（critic-receipt-producer.ts:68-75）时如实记录验读事实供披露，无解析器如实 unverified——**不构成任何门槛**。"
    status: pending
  - id: t5-review-mustfix-gate
    content: "P0 · review 评审接线——**结果 fail-closed、循环 fail-open**（评审 2 核心）。**①触发点**：check-testing checker.check 内、capture（:2947→:3015）完成后、dispatchDeviceVisualDiff（:3547）之前；vision_mode≠delegated 整体跳过；**异步显式化**——safeRun（check-testing.ts:3340-3353）是同步函数不能包 Promise，provider 调用点显式 await（链路 async 化）或同步 spawn；交互态读 local config、goal 态经 env 注入冻结 pin（MAISON_GOAL_MODEL_PIN_ENV 链同款 phase-state.ts:98/:106-111 新增 provider 变量）。**②输入**：逐屏 {参考图, 实机截图, screen_id, ui-spec 目标节点摘要, 双图 sha256, run_id?, attempt_id?}（工程真实路径）。**③输出合同**：完整逐屏覆盖全部目标屏，每屏 {screen_id, defects[]（class/severity/element?/note，绑定 must_fix_refs 锚定）, must_fix[], 双图 hash 回显}；pixel_1to1 追加 region_attest[]（method='vl_screening'，RegionAttestEntry :117-132 既有形态——非新机制，candidate-pass 既有 gate 要求使然）；**空输出/漏屏/重复屏/坏 JSON/hash 不符 = 本轮未审查（invalid）**，绝不等价「无缺陷」。**④写入与 provenance**：合法载荷经**原子覆盖**写入 visual-diff.json 逐屏 must_fix/defects（tmp+rename；**写入前清掉旧 provider 结果，禁止跨 attempt 复用**——评审 2）；harness 确定性映射逐屏 verdict（must_fix 空→pass 候选、非空→fail），provider 不产 verdict、「能否推进」唯一归 gate；VisualDiffDefectSource（visual-diff-check.ts:93-97 现仅 T8）扩展定稿形态 `{producer:'visual_provider', invoke_id}`（同步 schema/校验，selfreport_integrity :1353 不误判 provider 写入；稳定 finding 身份层**不做**——评审 2 降后续加固）；永不写 confirmed_by。critic receipt **如实披露非门槛**：delegated 下写 receipt（adapter/model=provider 真实值，input_provenance 有解析器且事件可证=verified 否则 unverified，证据路径=t3④ 独立事件流），visual_diff_critic_receipt 路径校验（:1836-1886）加窄分支（receipt.adapter≠primary 时期望路径按 provider 事件流），**CapabilityReceipt.provider 字段（string，effective-vision-context.ts:41）不挪用**；**受理与披露分立（评审 3）**：采信唯一判据=③ 的载荷同调用校验——`input_provenance='unverified'`（无解析器 adapter 如 codex/cursor/opencode 做 provider）且载荷结构/身份/当前图片 hash 合法 → **结果照常用于回修**，仅如实披露证据等级；无效仅指载荷校验失败（缺失/坏 JSON/漏屏/身份不符/hash 不符/旧 attempt）；receipt 任何情况不造成 halt 或 repair_adjudication_pending。**⑤裁决契约（评审 2 简化）**：合法 provider 输出 = **可直接回修的 critic candidate（非绝对真值）**——直接物化 repair candidate 驱动 primary 修复，不要求盲 primary defect-review 复核（伪制衡），也**不进 producer 感知信号的 repair_adjudication_pending 停等管线**（spec:936 管线原样服务 T8 感知信号）；**无效输出 = 丢弃 + events 记录 + 本轮按 blind 语义继续，接线写死（评审 3 P0）**：provider unavailable/invalid 时**不对 pending 屏执行严格 dispatchDeviceVisualDiff**——若照常执行，P0 屏 pending / 全屏 pending 在 uiChange=new_or_changed 下 = BLOCKER FAIL（visual-diff-check.ts:1296-1304、:1307-1317）挡死 phase，与 fail-open 相反——改为返回既有 `visual_diff` CheckResult **{severity: 'BLOCKER', status: 'SKIP'}**（capture/nav/device 等确定性检查结果照常保留）；该 SKIP 走既有链自动成为诚实出口：非 MINOR 的 SKIP → visual-debt `needs_human` 债务（visual-debt.ts:163-172）→ 债务把 visual 投影 UNVERIFIED、release BLOCKED（harness-runner.ts:1391-1435 countBlockingDebt）→ SKIP 非 FAIL，phase 照常推进——**开发循环 PASS / visual UNVERIFIED / release VISUAL_PENDING 三态同时成立**；**不 halt、不停等、不新增 check id/状态/质量轴**（评审 2 裁剪维持）；误报兜底=no_progress_fuse（:2610）+ 人签通道（visual-confirm）既有双层。**⑥盲档回退**：vision_mode=blind 时本条不激活，e6 后盲档链原样。"
    status: pending
  - id: t6-regression-smoke-closeout
    content: "回归与收口。**单测/fixture 矩阵**：t1（adapter catalog 是唯一支持列表；只有 claude/codex/cursor/opencode 四份完整声明被派生，codeagent 即使同 Claude 内核也不得家族放行；**完整 visual_provider 声明在 goal_capability 缺失/失效时仍保持 provider 资格**；授权矩阵 fresh/resume/successor；双旗标成对；record-visual-provider 走 updateLocalConfig；普通交互与 attended goal 在 local 缺失、已有 supported、已有 unsupported 三态下分别询问一次/不问/提示重选一次，unsupported 跳过后本轮 blind 且不重复问；无人值守旧 local unsupported WARN+blind；显式 CLI unsupported fail-fast 且错误列四项）；t2（三态派生矩阵——含资格不足落 blind；vision_mode run 内不可变——invoke 失败后 snapshot/mode 零变化；reviewVision 缺省=hasVision 旧调用面逐字回归；delegated+pixel_1to1 不钳新断言；blind 钳制表不变；OCR 链零改动断言）；t3（四 adapter readonly `HeadlessInvokePlan` golden：model flag 真实回放、图片 transport、普通全权限 argv 不可达、各自 envelope/final-result 投影；**所有 provider plan 都只经 `invokeAgentHeadless` 执行，visual-provider-invoke 不得自建 spawn/timeout/tree-kill/terminal/usage 生命周期，timeout 仅走 AgentInvokeOptions.timeoutMs，usage 仅消费 AgentInvokeResult.usage**；Claude argv 必含 safe-mode+Read-only 工具集合，缺 safe-mode 或锁定版本不支持即不得入册；Codex 复用 e6 分层回归：`completion_observed=true && terminal_failure_observed!==true` 方可调用 `extractCodexAgentMessageText(stdout)`，completion 缺失/terminal failure/正文 null 均拒收，usage 与 invoke result 同源；统一校验拒绝非 JSON/schema 坏/身份不符/hash 不符/超时；CLI 缺失/模型拒图=unavailable；脏检查丢弃不 revert；批次上限；事件流落盘）；t4（三元复用键；单图失败不阻断；不产 check）；t5（**fail-open 核心回归：provider invalid/unavailable 时产 visual_diff {BLOCKER, SKIP} 而非严格 dispatch 的 BLOCKER FAIL、phase 照常推进、SKIP 经 visual-debt needs_human 投影 release VISUAL_PENDING、不产 adjudication_pending**；unverified receipt 且载荷合法=照常回修不丢弃；合法载荷物化 candidate 驱动回修；原子覆盖+清旧+跨 attempt 拒收；确定性 verdict 映射；DefectSource 新 provenance 不触发 selfreport_integrity；receipt 窄分支路径校验——native 现状回归+delegated 新路径；人签链零变化；safeRun 无 Promise）。**四 adapter 最小真实 invocation smoke（每个 provider 各一次，不做 4×4）**：使用锁定版本真实 CLI/model，逐一证明 model 参数真实回放、至少一张工程真实图片确实进入模型、调用确经 `invokeAgentHeadless` 且其 completion/failure/usage 事实被消费、invoke 前后工程未被修改、stdout 正确投影、合法 JSON/当前 hash 被统一校验接收；**Claude smoke 在工程真实 `.claude/settings.json` 注册 Stop/PreToolUse hook（用可观察 sentinel 证明是否触发）的条件下执行，provider 不得触发这些 hook 或额外 hook 进程**；另以受控坏载荷或拒图验证 unavailable|invalid 只使本轮 provider 失效并走既有 fail-open。**两个完整 delegated 宿主闭环**（各用新 run_id）：(A) 同 adapter 不同模型，如 Claude M1 primary + Claude M2 provider；(B) 跨 adapter 不同模型，如 Codex primary + Claude provider。两者均验盲写→capture→provider 评审→物化回修→provider 缺陷清零→candidate-pass→**gate=await_human_confirm**（visual-diff-check.ts:2619-2628，无人签时 gate 不是 PASS）→真人 confirmed_by→**重跑 gate 方 PASS**；Cursor/OpenCode 不各跑昂贵完整 UI 闭环，其真实 invocation smoke + 统一 executor 单测证明接线。**三组 unsupported 反向测试**（每组覆盖 codeagent/chrys/generic）：普通交互与 attended goal 对已有 unsupported local 均提示重选/可跳过 blind；无人值守旧 local WARN+blind；显式 CLI fail-fast 并列四个支持项；全程禁止自动替换为 Claude 或 provider fallback。**全量**：cd harness && npm test + npm run openspec:validate。**验收语义写死**：一次 run = 1 primary + 1 visual endpoint，只覆盖 (A,M1)+(A,M2) 与 (A,M1)+(B,M2)，非 provider 池/canary/自动 fallback。**开工依赖**：e6b3f8d2 宿主 smoke、关联 OpenSpec 收口与 t7 全部完成且相关 plan/代码串行本地提交；本视觉委托 plan 也先单独提交，确认 `git status` 干净后方可进入 t0。是否 push 与宿主 smoke 均保持用户触发，不由实施 agent 擅自执行。**诚实边界**：delegated 消除人工逐轮看图与盲档一刀切降档；不承诺 provider 评审等效人眼；provider 恒失败的 run 与现状盲档等价（经既有 VISUAL_PENDING 投影，零新状态）。smoke 全过后 t0 change 方可 archive。"
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
  机制保持 adapter 通用，首批仅 claude/codex/cursor/opencode（支持列表从 adapter 声明派生）。
  OpenSpec 先行（t0），依赖 e6b3f8d2 完整实施、验收并串行提交后实施。
isProject: false
---

# 盲档视觉委托：单写者与只读视觉 provider 协作（ab072691）

状态：**v7（e6 invoke 生命周期复用边界已对齐，2026-08-25，待复审）**

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

## 6. 评审吸收纪要

**v1 → v2（评审意见 1，七 P0 全采纳）**：①假只读→独立只读 invoke plan；②普通模式入口缺失→三形态入口+record-visual-provider；③空数组≠无缺陷→输出合同升格 fail-closed；④receipt 路径锁死→双路由；⑤provider 缺陷停等→已裁决 critic 输出（不加盲 primary 伪复核）；⑥冻结与降级矛盾→删阈值降级、分立冻结与调用结果；⑦model 冻结不住→model 必填、chrys/generic 无资格、槽位键显式。附：DefectSource 定稿、OCR 分轴、usage+批次上限、OpenSpec 先行、safeRun 同步事实、验收 1+1 写死。

**v2 → v3（评审意见 2，简化裁剪——「结果 fail-closed、循环 fail-open」收敛）**：①[P0] **删 provider canary 多槽化**（v2 t2 整条撤销）——真实调用即探测，调用失败=本轮不采信+blind 继续，无需事前判卷中间层；primary canary 零改动；vision_mode 的 delegated 判定改为静态资格（配置在场+t1⑥）。②[P0] **删 OCR 分轴**——污染源随 provider canary 消失，resolveOcrAvailableForRun/tessdata/全部 OCR 门禁零触碰。③[P0] **hasVision 不改名**——v2 的全消费面改名撤销，改为 FidelityCapability 可选 `reviewVision?` 字段（缺省=hasVision，旧调用面逐字不变），仅 delegated 判定点传值。④[P0] **删暂存图片复制**——物理只读由 readonly argv 承担，直读工程原图，receipt 图片路径天然一致无双路径映射。⑤[P0] **receipt/schema 失败不转 repair_adjudication_pending**——v2 t6⑤「物化三条件缺一停等求人」改为「缺一=丢弃本轮结果+blind 语义继续」；receipt 从物化门槛降为如实披露（既有 candidate-pass gate 对 receipt 的要求自然生效，不新增门槛）；裁决契约收敛为「合法输出=可直接回修的 critic candidate（非绝对真值），无效输出=丢弃并继续」。⑥[P0] **删 UNVERIFIED 新 check 载体**——复用既有 blind/VISUAL_PENDING 投影，provider 调用结果只决定本轮视觉反馈采信与否。⑦稳定 finding 身份层/载荷签名降为后续加固；配置入口收敛为「可选询问一次、跳过即 blind、不重复问」；资格不足两级响应（CLI 显式=fail-fast、local 失效=WARN+blind）。首期唯一硬边界写入 overview 与 t0：provider 不能写工程，不能用旧/坏结果制造 PASS；其余全部局部降级不挡循环。

**v3 → v4（评审意见 3，三处收口——机制零恢复）**：①[P0] fail-open 的现有载体接线写死——「复用既有投影」不会自动发生：严格 dispatch 对 pending 屏 = BLOCKER FAIL 挡死 phase（事实 #20）；t5⑤ 改为 provider unavailable/invalid 时跳过严格 dispatch、返回 `visual_diff` {BLOCKER, SKIP}，经既有「非 MINOR SKIP → needs_human 债务 → visual UNVERIFIED、release BLOCKED」链（事实 #21）达成「循环 PASS / visual UNVERIFIED / release VISUAL_PENDING」三态并立，零新 check/状态/轴。②[P1] smoke 人签顺序按既有契约改写：缺陷清零→candidate-pass→gate=await_human_confirm→真人 confirmed_by→重跑方 PASS（事实 #22），只改验收文字与断言。③[P1] 受理与披露分立：`input_provenance='unverified'`（无解析器 adapter）且载荷合法 = 照常回修**非无效**（防误伤 codex/cursor/opencode 做 provider）；无效仅指载荷校验失败（缺失/坏 JSON/漏屏/身份不符/hash 不符/旧 attempt）；receipt 任何情况不 halt、不进 repair_adjudication_pending。

**v4 → v5（新增问题窄修订——首批名单与 adapter 接线冻结）**：①[P0] 删除 provider 资格对 `KNOWN_MODEL_PIN_ADAPTERS` 的交集/排除集合依赖，改由 `adapter.yaml.visual_provider` 完整声明派生唯一支持列表；机制保持通用，首批仅 claude/codex/cursor/opencode，明确拒绝按 Claude-kernel 家族误放 codeagent。②[P0] unsupported 按输入形态定稿：普通交互与 attended goal 提示重选或跳过 blind（本轮不重复问），无人值守旧 local WARN+blind，显式 CLI fail-fast 列四项；不自动替换、不 fallback。③[P0] 四 adapter 从候选 argv 升为确定契约：Claude Read-only+stream-json；Codex read-only/--image/复用 e6 JSONL terminal+usage parser；Cursor Ask+JSON final result；OpenCode OPENCODE_PERMISSION+--pure/--file/raw JSON events；model 均真实回放，先投影各自 envelope 再统一校验。④[P1] 验收收敛为四次最小真实 invocation smoke + 同 adapter/跨 adapter 两个完整闭环 + 三组 unsupported 反向测试；不做 4×4 或为 Cursor/OpenCode 重跑昂贵完整 UI 循环。t2/t4/t5 机制与契约零改动。

**v5 → v6（复审收口——1 P0 + 2 P1 窄修正）**：①[P0] Claude 的 Read-only 工具集合之外再加锁定版本 `--safe-mode`，隔离 AgentMaison 工程 `.claude/settings.json`、Stop/PreToolUse hooks、CLAUDE.md、skills、plugins、MCP 等定制；不支持/未实测即不得入册，smoke 用 sentinel 证明 hooks 未触发。②[P1] 删除普通 `goal_capability` 第二资格门槛，完整 `visual_provider` 声明自身承担 invoke/model/image/stdout 全契约并独立决定支持与资格。③[P1] 普通交互与 attended goal 的询问条件改为「local 缺失或现有 adapter unsupported」，已有 unsupported 配置必须提示重选一次；跳过本轮 blind、不重复问，无人值守仍 WARN+blind。t0/t2/t4/t5 零改动，无新架构。

**v6 → v7（e6 已提交代码影响对齐——单点接线窄修）**：①[P0] t3 从“复用同一 Codex scanner 提取终态/正文/usage”纠正为 e6 实际分层：provider 只构造只读 HeadlessInvokePlan，统一复用 invokeAgentHeadless 的 spawn/timeout/tree-kill/failure/usage 生命周期；scanner 只判终态，正文用 extractCodexAgentMessageText，usage 直接取 AgentInvokeResult.usage。②[P1] Codex 采信条件冻结为 completion_observed=true 且无 terminal_failure_observed，再投影正文并走统一载荷校验；禁止第二套 spawn/terminal/message/usage parser。③[P1] t6 增既有生命周期唯一性、Codex 三事实消费与真实 smoke 断言，并把开工依赖具体化为 e6 宿主 smoke/OpenSpec/t7/串行本地提交完成、视觉 plan 已提交且 git status 干净；push 与宿主 smoke 仍只由用户触发。t0/t1/t2/t4/t5 零改动，无架构扩张。
