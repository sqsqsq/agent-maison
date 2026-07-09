---
name: 多模态能力阶梯 — 盲模型自动降级、门禁语义随档位切换与收口治理
version: 2.4.0
# 版本说明：2.4.0 窗口不 bump（用户控版本）。中型演进：治「应降级时不降级、反而硬失败/死循环」。
# v2（2026-07-08）：吸收 cursor + codex 双 review——叙事按两案拆分、E0 能力感知 prompt 提前 P0、
# E1 金丝雀防 OCR 代答、E2 headless 禁降级硬冲突显式化、E4 分类收窄、实施顺序改止血优先。
overview: >
  【目标效果曲线（用户拍板）】UI 需求在任意宿主模型上：模型强（真视觉）→ pixel_1to1 效果好；
  模型弱+OCR 可用 → semantic_layout 文案精确；最弱 → reference_only 跑通。任何档位**不允许
  异常中断**——goal 模式要么带「待人工复核清单」跑完，要么干净 halt 求人（引导话术），
  绝不长时间空转。修复后可 ratchet 回升（机制已有）。
  【两案两套主链（cursor 纠偏：勿揉在一个叙事里）】
  ▶ 案A mx 2.7 套 Claude Code 壳 —— 主断点=①探测层被 adapter 声明骗：
  image_input 纯声明（agents/claude/adapter.yaml:54 tool_read；multimodal-probe.ts 只读
  adapter.yaml，无模型实测）。盲模型「知道有图但看不见」，现场空转（自称无法 OCR、
  幻觉 mcp_ocr 等不存在工具名）。治法=E1。
  ▶ 案B chrys + 银行卡 goal run —— adapter 已正确声明 image_input:none，探测没被骗；
  主断点=②③④叠加：8 次 invoke（5 次打满 45min 预算、attempt3 约 28min 正常结束、
  attempt7/8 为用户 Ctrl+C 0xC000013A），总墙钟约 4h19m，spec 永不闭环。
  【案B 断点细目（全部实证）】
  ②档位钉死+双向死锁：需求「严格按参考图还原」→ intent_nudge 推 pixel_1to1；终态 spec.md
  实录 fidelity_target: pixel_1to1。**双向围死**（cursor 实证）：agent 写 semantic_layout →
  fidelity-governance-check.ts:100-117 headless 下判 BLOCKER「headless 下不得自动降级」；
  写 pixel_1to1 → 盲档撞最重门禁。且 SKILL.md:179「本 Step 必须用强 VL 模型；内网弱模型
  勿跑提取」与 goal headless「不得停下问人」构成规则级死锁——盲 agent 四面无路。
  ③门禁语义不随档位 + phase prompt 降级信息断供（codex P1 纠偏）：capture_completeness_external
  以原图 OCR 全文为「删不掉的分母」（99/123 行未覆盖、defer 须真人签字；OCR 噪声实录
  「人《AA招商银行」——宿主 OCR 环境正常，抽出 123 行，「环境坏了」是此前误判；分发/安装链
  无缺口：chi_sim.traineddata 在 564 发布文件内、tesseract.js 随 harness-install 装）。
  capture-completeness-check.ts:352 `severity: pixel ? 'BLOCKER' : 'MAJOR'`——attempt4
  detach.log 实证 semantic_layout 时同检查仅 MAJOR WARN，档位确实控制严重度（E2→E3 链成立）。
  **收窄声明**：(multimodal-degraded) 降级注入只到达 verifier 的 ai-prompt.md，**未到达**
  驱动 phase agent 写作的 goal-runs/.../phases/spec/prompt.md——phase prompt 里没有
  effective 档位/OCR/盲档工作法任何信息，agent 按强视觉任务硬跑。此即 E0 的存在理由。
  ④收口死循环（两种形态，cursor 细分）：(a) 超时+harness PASS+advance_blocked →
  agent_timeout_unclosed retry（goal-runner.ts:1624，attempt5）；(b) 正常结束+PASS+closure
  open → retry，failure_kind=code_regression（attempt3）。设计内 await_human 出口够不着：
  classifyFailureKind agentTimedOut 最高优先遮蔽（goal-failure-classifier.ts:211）+ 只认
  script summary blockers 的 classification、verifier/回执层盲区（:227）。兜底守卫
  「signature 重复即 halt」被产物搅动绕过（spec.md 每轮在变=有进展）。终态用户中断
  0xC000013A 被误判 code_regression/agent_no_output。
  附：Tier_1 探针（init-readiness.mjs）不探 tesseract.js/chi_sim——非案B主因，同链补齐。
  【方案：P0 六件套 + P1 提质】实施顺序（cursor+codex 一致）：
  止血切片一 E4+E2（案B 4h retry 地狱 → 几十分钟内干净 halt 或降档跑通）→
  切片二 E0+E3（盲档可解：phase prompt 能力感知 + 门禁清单化）→ E1（案A 治探测）→
  E5（补强）→ P1 E6（OCR 全管线提质）。
  【范围外（硬理由）】①stdin 传参修复已独立落库（plan b3f7c1a9 / commit a02703d），E7 同批复验。
  ②specs/phase-rules/*.yaml 正文尽量不动（gate_fingerprint 令宿主存量回执 stale；行为变化
  落 check 脚本 ts 层，yaml 仅语义真变不可避免时动并在实施记录声明）。③generic/其他 profile
  的 OCR 资产供给（无 tessdata）——阶梯对无 OCR 环境已有 reference_only 地板，供给增强另立。
  ④verifier prompt 全面改写——只加档位感知最小增量。⑤盲档下 context_exploration_* 等探索
  深度门禁的减负（cursor 提示的 residual 超时源）——本 plan 只观察记录（E7），不动语义。
  【验收诚实声明】E0-E5 有机器验收（新单测+全量绿）；「盲模型端到端跑通银行卡类需求」须
  宿主实机复验（mx 2.7 + claude / chrys 两线，E7），本 plan 不以单测冒充端到端结论。
  金丝雀防作弊边界：防「文件名/文档猜答案」与「OCR 工具代答文字题」（codex：非恶意的自然
  求解路径也要防——故金丝雀含非 OCR 可答题）；不防宿主工具链恶意伪造读图——那属
  gate-integrity 红线域，非本 plan。
todos:
  - id: e4-closure-halt-guard
    content: >
      E4 收口治理（止血切片一之1，先停案B的 retry 地狱；不依赖金丝雀即可落地）。
      ①goal-runner.ts advance_blocked 两条 retry 路径**都**覆盖（cursor 细分）：
      (a) closure_open/receipt 失败（attempt3 形态）与 (b) agent_timeout_unclosed
      （attempt5 形态，:1624）——当失败原因为人签类（receipt 校验/verifier verdict/summary
      blockers 含 fidelity_capture_governance、*_defer_human_sign、*_pending_confirm 家族）
      → action=halt + haltReason=await_human_visual_confirm + buildAwaitHumanConfirmGuidance
      引导话术（复用 await-confirm-guidance.ts），不吃 retry 预算。
      ②classifyFailureKind（goal-failure-classifier.ts:211）遮蔽修正：agentTimedOut 仍最高
      优先，但 summary blockers 非空且**全部**为 await_human/人签家族 → 归 await_human_confirm；
      判定源扩展到 receipt 校验结果（新增输入位）。
      ③守卫补漏（codex 收窄分类）：no-progress guard 增加「同一 blocker id 跨 attempt 累计
      出现 ≥3 次即 halt/降档」，家族范围= toolchain、await_human、以及**盲档下的
      capture_completeness_external**（E3 落地前它既非 toolchain 也非 await_human——
      为其建 blind_review 家族归属，勿漏）；不被其他产物搅动掩盖。
      【计数状态来源（codex 采纳：勿用易丢内存计数）】累计次数从 events.jsonl 的
      phase_verdict.blocker_signature 回放统计（runner 已有 events 读链，resume/detach
      重启天然不丢）；per-run 内存 state 仅作缓存。
      ④用户中断诚实分类：exit 0xC000013A（STATUS_CONTROL_C_EXIT，案B终态实录）归
      operator_interrupt，不再误判 code_regression/agent_no_output。
      单测：两条 retry 路径→halt（回放案B attempt3/attempt5 时间线）、全人签+timeout 归类、
      累计签名守卫（含 blind_review 家族）、0xC000013A 分类。
    status: completed
  - id: e2-fidelity-capability-clamp
    content: >
      E2 fidelity 档位自动合法化（止血切片一之2，案B主药）。
      ①新 util（fidelity-shared.ts 内）：clampFidelityByCapability(desired, capability)——
      capability = {effective_image_input（E1 前先用 adapter 声明+goal allowed_tools 现有
      解析，E1 落地后换金丝雀实测）, ocr_available（isOcrAvailable）}；钳制表：
      vision=tool_read/native → 不钳；vision=none & ocr=y → pixel_1to1 钳至 semantic_layout；
      vision=none & ocr=n → 钳至 reference_only 地板。
      【量级预警（codex 采纳）】reference_only 是**新枚举值**——现
      FidelityTarget = 'pixel_1to1'|'semantic_layout'（fidelity-shared.ts:15/18），落地须
      同步：类型与 FIDELITY_TARGETS 集合、parseFidelityTargetFromHandoffDoc、visual-handoff
      文档（skills/feature/spec/reference/visual-handoff.md）、summary/schema 相关字段与
      既有测试断言；此项**不可避免触及文档/schema 语义**，不属 ts 小改——若牵动
      phase-rules yaml 则按范围外纪律在实施记录声明 fingerprint 影响后再动。
      ②单点收口：isPixel1to1（fidelity-shared.ts:188）及 fidelity_target 全消费面改读
      effective 档位（实施时全量 rg isPixel1to1/fidelity_target 核对无 raw 旁路）；spec 产物
      侧落 effective_fidelity + provenance（auto-degraded: capability_ceiling），**不改写**
      desired 声明（保留意图供 ratchet 回升）。
      ③【硬冲突·必改（cursor 升级，非可选协调）】fidelity-governance-check.ts:100-117
      「headless 下不得自动降级」BLOCKER 语义**删除/反转**：能力钳制生效时，
      fidelity_target=semantic_layout + 1:1 措辞不再 BLOCKER，改为记录「能力钳制已生效，
      desired=pixel_1to1 保留，更换视觉模型/修复环境后 ratchet 回升」；无钳制时保留原防降级
      语义（防的是有能力却偷懒降档，不防没能力）。intent_nudge（:106）文案同步。
      ④goal report / summary 首屏显著提示钳制事实与回升路径；goal headless 下自动生效
      （§9 记 headless-assumptions），交互式下 enum 确认一次（默认=接受钳制）。
      单测：三档钳制表、effective 单点一致性、headless 禁降级反转（钳制态放行/非钳制态拦截）、
      nudge 文案切换、provenance 落盘。
    status: completed
  - id: e0-capability-aware-prompt
    content: >
      E0 能力感知 phase prompt + SKILL 盲档工作法（codex P1 提前：原 E6 最小版入 P0——
      否则 P0 只是「更温和地失败」，第一轮 45min 盲跑照旧）。
      ①goal-runner buildPhasePrompt：UI 需求 spec/coding phase 注入能力块——
      effective_image_input / effective_fidelity（E2 产物）/ ocr_available + 盲档工作法指令
      （「你无视觉能力：不要试图看图/描述截图；文案与文本位置以 OCR JSON 为准（若有）；
      结构由需求文字+OCR 布局推断；图标/logo 走 placeholder+asset-manifest；不可辨项登记
      blind-review-pending 清单，勿逐条求证」）。现场实证 phase prompt 此前零降级信息。
      ②spec SKILL.md:179 强 VL 规则改写（codex：与 headless 不得问人构成死锁的规则级修复）：
      「真视觉档（tool_read/native）必须强 VL 提取；盲档（none）走 OCR/结构化降级工作法
      （见 reference/ui-spec.md 盲档节），禁止假装看图」；reference/ui-spec.md:203-213
      模型档位表同步补盲档行。
      ③OCR 上下文注入最小版（E6-min）：effective=none 且 ocr_available 时，goal-runner 在
      spec invoke 前对参考图逐张跑 ocr-worker.cjs → spec/reports/ocr/<screen>.ocr.json，
      phase prompt 附路径清单（agent 读文件，不内联大 JSON——prompt 体积纪律）；
      交互式 SKILL 同步指引。全管线（布局聚类/与门禁同源匹配）留 E6。
      【参考图发现规则（codex 采纳：首次 invoke 前 spec.md/authoritative_refs 尚不存在，
      不能复用既有从 spec 收集图片的路径）】deterministic pre-scan 顺序：requirement 文本中
      的显式目录/文件引用 → 该目录下图片文件（png/jpg/webp）→ feature 目录既有
      ux-reference/；扫不到图源 → 跳过 OCR 预跑并在能力块声明「无参考图可 OCR」，
      不阻塞（勿造假分母）。
      【unattended 块档位感知（cursor 采纳：同 prompt 自相矛盾预防）】
      buildUnattendedExecutionBlock（goal-runner.ts:453-454 硬编码「The only path through
      pixel_1to1 P0 screens is …HALT for human per-screen confirmation」）按 effective_fidelity
      分支措辞：盲档改为「走 blind-review-pending 清单收口；禁止假装看图/伪造视觉证据」，
      真视觉档保留原文——E0 能力块与 unattended 块必须同源取值，勿两处各算一遍。
      单测：能力块注入分支（三档）、盲档指令措辞锚点、ocr.json 生成与 prompt 引用、
      参考图 pre-scan 三级顺序与无图源跳过、unattended 块档位分支与能力块同源、
      OCR 不可用时不注入且工作法降 reference_only 措辞。
    status: completed
  - id: e3-gate-semantics-per-tier
    content: >
      E3 门禁语义随档位切换（止血切片二之2，治 OCR 噪声无解题）。
      ①前提核对：E2 落地后 audit profiles/hmos-app/harness/*-check.ts 全部 isPixel1to1/
      fidelity 分支消费 effective 而非 raw（attempt4 已实证 semantic_layout 下同检查自然
      降 MAJOR WARN——天花板压下来后大半严重度自动对齐）。
      ②盲档（effective_image_input=none）下 capture_completeness_external 未覆盖行处置
      从「逐条 implement/defer+人签」改为「自动批量登记结构化待复核清单」：新 artifact
      spec/reports/blind-review-pending.yaml（逐行：屏/OCR 文本/y 坐标/置信度/
      auto_disposition: unverifiable_blind），check 降 MAJOR WARN + 指向清单；该 blocker 在
      盲档归 blind_review 家族（E4 守卫与分类同口径，codex 收窄采纳）；收口由人一次终审
      （配 visual-confirm CLI 或 checklist）。pixel_1to1（仅真视觉档可达）语义不变——
      门禁强度没有全局放水，只与能力档位对齐。
      ③OCR 噪声混合行容错（可选子项，做不完 defer 至 E6）：「噪声前缀+真文本」行
      （实录「人《AA招商银行」）做真文本子串提取匹配，命中即计覆盖、前缀记低置信注记——
      沿「单字符角标/纯符号已剔除”降噪先例。
      ④phase-rules yaml 纪律：行为变化全在 ts 层；yaml 文案改动放实施记录评估，默认不动。
      单测：盲档清单生成与家族归类、pixel 档语义不变、噪声子串匹配（若做）、
      fixture 视需要补 blind-tier 契约样例。
    status: completed
  - id: e1-canary-probe-override
    content: >
      E1 金丝雀视觉实测 + 本地 override（治案A探测层；排在止血切片后——案B不依赖它）。
      ①资产：framework/harness/assets/vision-canary-<contenthash>.png——**含非 OCR 可答题**
      （codex 采纳：色块颜色/相对位置/形状关系类问题为主，文字词为辅），文件名不含答案，
      答案存 harness 侧 json。判定分级：几何/颜色题答对 → tool_read 实锤；仅文字题对
      （疑似 Bash+OCR 代答，自然求解路径非恶意）→ **不判 tool_read**，记 ocr_capable 信号
      （供 E2 capability 用），vision 仍 none；全错/超时 → none。探测时记录 agent 是否调用
      外部工具（输出转录扫描，尽力而为）。
      ②framework.local.json 新字段 image_input_override: none|tool_read|native_attach
      （framework-local-config.ts 读写；解析链最前）——国产模型套壳用户自知盲时的免探快路。
      【strict schema 同步（codex 采纳：local config 拒绝未知顶层键——
      config-field-ownership.ts:13 LOCAL_CANONICAL_TOP_KEYS 白名单 + framework-local-config.ts:57-61
      遇未知键直接 throw，不同步则一落字段全消费方炸】：新键（含金丝雀缓存字段）纳入
      LOCAL_CANONICAL_TOP_KEYS + FrameworkLocalConfig 类型 + validate/write roundtrip；
      测试补：非法值拒绝、旧版 local.json（无新键）读取兼容、写回不丢既有个人配置字段。
      ③接入：goal-preflight.ts 在 UI 需求 spec 前触发一次 headless 金丝雀问答；结果+
      probed_at+adapter 缓存进 framework.local.json，adapter/override 变更即失效，
      --refresh-vision-probe 强制重测。交互式 spec SKILL Step 0 轻量自答（落 trace）。
      ④与现有 allowed_tools 缺 Read 降级（multimodal-probe.unit.test.ts:76 先例）同链合并
      取最保守值；所有降级决策落 headless-assumptions + trace（provenance: canary_failed /
      canary_ocr_only / local_override）。
      单测：override 优先级、几何题/文字题分级判定、缓存失效、保守合并。
    status: completed
  - id: e5-readiness-ocr-probe
    content: >
      E5 Tier_1 探针补 OCR 就绪度（补强；非案B主因——OCR 环境实际正常，但内网 npm 局部
      失败会漏到门禁运行时才炸）。init-readiness.mjs checks 增加（active profile 具备 OCR
      资产时条件化）：profiles/hmos-app/vendor/tessdata/chi_sim.traineddata 与
      harness/node_modules/tesseract.js/package.json；缺失时 recommended 指向 npm install
      （tesseract.js）/ framework 完整性修复（tessdata 属发布件内容，缺失=分发损坏非漏装）。
      skills/reference/host-harness-readiness.md 同步 Tier_1 清单。
      单测：探针命中/缺失分支、非 hmos-app profile 跳过。
    status: completed
  - id: e6-ocr-context-injection
    content: >
      E6（P1 批）「OCR 当眼睛」全管线提质（最小版已随 E0 入 P0；本项完成剩余）：
      ①OCR 布局聚类（行/列分组）辅助结构推断，产物并入 ocr.json；②agent 组装与
      capture_completeness_external 门禁匹配逻辑同源化（同一套文本归一/子串提取，避免两套
      匹配各说各话）；③E3③噪声容错若彼时未做，在此合并实现；④blind-tier spec 端到端
      fixture（ocr.json 注入→ui-spec 组装→门禁 PASS+blind-review-pending 生成）。
      单测 + fixture。
    status: completed
  - id: e7a-source-gates-green
    content: >
      E7①源仓三命令门禁（代码侧，release:check-plans 约束范围内）：
      `cd harness` → `npm run typecheck` → `npm run test:unit` → `npm run test:fixtures`。
      裸跑（无需设置任何环境变量）三条命令全绿——round6 yaml 解析问题已在"第三轮 review
      复核"批次修复（createRequire 锚定 harness 根），此前需要的 NODE_PATH 前置步骤已废弃。
    status: completed
---

# 实施记录

（实施后追加：日期、验收命令与结果、宿主复验结论、phase-rules yaml 是否动过及 fingerprint 影响、
盲档探索深度压力观察数据。）

## E4 实施记录（2026-07-08）

- **诚实范围声明**：深入 goal-runner.ts 后发现一个比原计划更精确的根因——
  chrys 案 attempt3(PASS+closure_open, failure_kind=code_regression) 与 attempt5
  (PASS+timeout+agent_timeout_unclosed, failure_kind=agent_timeout) 的 blocker_signature
  **不同**（前者走真实 blocker id 串，后者因 verdict=PASS 无 blocker 走合成 sentinel
  `agent_timeout@phase`），导致 shouldHaltNoProgress 的"紧邻上一次比较"被 verdict 摆动
  绕过。故 E4 未按原计划"同一 blocker id 严格重复"实现，改为**累计（不看具体 reason/
  不要求紧邻）** 计数，更贴合实证时间线。capture_completeness_external 的 blind_review
  家族分类**未实现**（如实说明：分类依据依赖 E2/E3 尚未落地的 effective_image_input 判定，
  在 CUMULATIVE_HALT_FAMILY 留了扩展位注释，E3 落地时加入）。
- **改动**：
  - `goal-failure-classifier.ts`：新增 `operator_interrupt` FailureKind +
    `isOperatorInterruptSignal`（Windows 3221225786 / POSIX SIGINT）；`classifyFailureKind`
    加 operator_interrupt 顶级优先 + agentTimedOut 在 blockers 全为 await_human_confirm 时
    让位；新增 `CUMULATIVE_HALT_FAMILY`/`CUMULATIVE_HALT_THRESHOLD`(3)/
    `ADVANCE_BLOCKED_HALT_THRESHOLD`(2)。
  - `goal-runner-phase.ts`：`GoalRunEvent` 补 `blocker_signature`/`halt_reason`/
    `advance_blocked`/`advance_block_reason` 字段；新增
    `countCumulativeAdvanceBlocked`/`countRepeatedSignatureInFamily`（均从 events.jsonl
    回放，非内存计数）。
  - `await-confirm-guidance.ts`：新增 `buildClosureWallGuidance`——**未复用**
    `buildAwaitHumanConfirmGuidance`（那个硬编码 testing 阶段截图/visual-diff.json 路径，
    对 spec 阶段闭环墙语义不对；发现这个偏差属计划外收获）。
  - `goal-runner.ts`：接入 operator_interrupt 顶级分支；重写 `advance_blocked` 分支——
    累计（含本次）达 `ADVANCE_BLOCKED_HALT_THRESHOLD` 即 halt+引导话术（不看具体
    reason），未达阈值时保留原 `agent_timeout_unclosed` 首次让路语义；新增累计家族重复
    分支（`CUMULATIVE_HALT_FAMILY` + `CUMULATIVE_HALT_THRESHOLD`）；`phase_verdict`
    事件补写 `advance_blocked`/`advance_block_reason`；halt_guidance 输出条件扩展到
    `closure_wall_repeated`。
- **验收**：typecheck 0 · unit 1473/0（+8 新用例，baseline 1465）· fixtures 35/0。
- **待办**：blind_review 家族分类 → 随 E3 落地；宿主 chrys 银行卡复验（E7）待 E2/E3
  一并完成后统一跑。

## E2 实施记录（2026-07-08）

- **架构发现（比原计划更省事）**：全量 grep 19 处 isPixel1to1/fidelityTarget 消费点，
  确认全部只做 `=== 'pixel_1to1'`/`!== 'pixel_1to1'` 比较，**从未**比较 `'semantic_layout'`
  字面量——新增 `reference_only` 第三态对这 19 处零行为影响，**18/19 文件零改动**；
  唯一需要行为改动的是 `fidelity-governance-check.ts`（它的职责就是"侦测非法降级"，
  必须新增"合法钳制"分支）。单点收口验证：`ctx.fidelityTarget` 只在 harness-runner.ts
  一处赋值（line ~402），钳制在该处生效后全消费面自动继承（capture_completeness_external
  的 `pixel?BLOCKER:MAJOR` 等天然随档位降级，无需逐个 check 文件改）。
- **core/profile 层级问题**（发现值得记录）：`isOcrAvailable()` 在
  `profiles/hmos-app/harness/ocr-toolkit.ts`（profile-local），core 的
  `fidelity-shared.ts`/`harness-runner.ts` 不能硬 import。参照既有
  `capability-registry.ts` 的 `path.join(resolved.profileDir, 'harness', 'providers', ...)`
  动态 require 先例，新增 `probeProfileOcrAvailable(profileDir)`（try/catch require，
  找不到→false，非硬编码 'hmos-app'，generic 等无 OCR 资产 profile 安全降级）。
- **改动**：
  - `fidelity-shared.ts`：`FidelityTarget` 加 `reference_only`；新增
    `FidelityCapability`/`clampFidelityByCapability`/`EffectiveFidelityContext`/
    `resolveEffectiveFidelityContext`（纯函数，capability 由调用方注入，不做 I/O）。
  - `types.ts`：`CheckContext.fidelityTarget` 类型加 `reference_only`；新增
    `declaredFidelityTarget`/`fidelityClamped`/`fidelityClampReason`。
  - `harness-runner.ts`：新增 `probeProfileOcrAvailable`；context 构造点改用
    `resolveEffectiveFidelityContext(rawFidelityCtx, { hasVision: mmProbe.supported,
    ocrAvailable: probeProfileOcrAvailable(resolvedProfile.profileDir) })`；global phase
    分支补齐新字段安全默认值。
  - `fidelity-governance-check.ts`：`fidelity_target_declared` 首屏报告钳制事实
    （E2④"首屏显著提示"落在这里，未另建 side-artifact）；intent_nudge 分支按
    `capabilityClamped` 拆两路——钳制态→新 `fidelity_target_capability_clamped` PASS，
    非钳制态→原 BLOCKER 语义不变（防的仍是"有能力却偷懒降级"）。
  - `skills/feature/spec/reference/visual-handoff.md`：表格补 `reference_only`；
    新增"能力钳制"说明段（desired 不改写、更换模型/修复 OCR 后自动 ratchet）。
- **验收**：typecheck 0 · unit 1479/0（+6 新用例，累计 1465→1479）· fixtures 35/0。
- **诚实范围声明（未做，待用户确认是否需要）**：
  ①"交互式下 enum 确认一次（默认接受钳制）"——这是新增 UX 交互闸（registry gate），
  涉及 confirmation-registry.yaml/交互式 SKILL 流程，与"止血切片一"的机械修复性质不同，
  本轮未做；当前交互式路径下钳制**静默生效**（无阻断，但也无主动告知——只能在
  script-report 里看到 `fidelity_target_declared` 的钳制说明）。
  ②spec 产物侧未新建独立 provenance 文件——钳制事实落在 check 结果 details 里
  （script-report.json/summary.json 可读），未写入 spec.md 本体或新 yaml（spec.md 由
  agent 写、非 harness 写盘对象，写入需走 E0 的 prompt 侧或 SKILL 侧，非本次 harness 改动范围）。

## Review 复核·E4+E2 实施后（2026-07-08，cursor + codex 双独立复核）

结论：两份 review 均判"实现与报告描述基本一致，无硬伤，可作止血切片一合入"；codex 额外抓到
一个真实逻辑 bug（P1），已修复验证；P2 可见性缺口已补；cursor 的意见均为"记录/measurement"
类，无需改代码，已在下方吸收记录。

**codex P1（真实 bug，已修）**：`fidelity-governance-check.ts` 原判据只看
`capabilityClamped`，未核对 `declaredFidelityTarget === 'pixel_1to1'`——若 agent 自己声明
`semantic_layout`（未如实反映 1:1 意图，独立于能力钳制的违规）之后又被能力钳到
`reference_only` 地板，会被误判为"desired 已保留 pixel_1to1 的合法降级"（事实上 desired 从未
是 pixel_1to1，这句话是假的），放过了本该照旧 BLOCKER 的 intent_nudge。修复：豁免条件加
`declaredFidelityTarget === 'pixel_1to1'`；非此情形仍走原 intent_nudge 严重度，且 details
诚实附注"即便如实声明也会被钳到 X"。新增回归测试
`E2 P1 修正: declared≠pixel_1to1 时即便 capabilityClamped 也不得豁免 intent_nudge`。

**codex P2（可见性缺口，已补）**：钳制事实此前只落在 `fidelity_target_declared` 这个 PASS
check 的 details 里；`summary.json` 只收 blockers/warnings/skips/readiness_signals，PASS
check 不入内；`printStableSummary`（goal detach.log/console 唯一出口）也从不打印
`readiness_signals`。goal run PASS 收尾时用户/runner 实际看不到降级发生过。修复：①
`buildReadinessSignals` 新增分支，`fidelity_target_declared` 含"能力钳制"字样时产出
`fidelity_capability_clamped` readiness signal（`status: 'ready'`）；②`printStableSummary`
新增 `readiness_signals` 通用打印块（非本次改动的既有信号如 `doc_freshness_effective` /
`bootstrap_incomplete` 一并获得可见性，属善意副作用非范围蔓延）。诚实声明：
`buildReadinessSignals`/`printStableSummary` 是 harness-runner.ts 模块私有函数，仓库现有
惯例（`doc_freshness_effective` 等既有分支）均无独立单测、靠 fixture 端到端覆盖，本次遵循
同一惯例未强造导出+单测基建。

**cursor 记录类意见（无需改代码，如实记录）**：
- E4 与 plan 原文两处简化偏差：①未把「receipt 校验结果」接入 classifyFailureKind 输入，
  仅用 summary blockers[].classification；②未做"advance_blocked+人签类→首触 halt"的精确
  分支，统一走 `closure_wall_repeated`（累计 2 次，不分原因）——更贴案B 实证（attempt3 是
  PASS+closure_open，failure_kind 多为 code_regression 而非 await_human_confirm，原
  plan 分支未必能触发），判定为更优的简化，非疏漏。
- E4 单独不足以挡住 `capture_completeness_external` 反复 FAIL 的长时间 retry（该 id 不在
  `CUMULATIVE_HALT_FAMILY`，`code_regression` 也不在家族内）——止血靠 **E4+E2 组合**：E2
  把档位钳到 semantic_layout 后该检查从 BLOCKER 天然降 MAJOR/WARN（attempt4 detach.log
  实证），E4 单飞挡不住这条线。E3 的 blind_review 家族落地前，这条线仍可能比"2 次
  advance_blocked 即停"多烧几轮（但远好于原 4h19m）。
- E7 时序提醒：案A（mx+claude）在 E1 金丝雀落地前不得提前宣称 P0 完成——`hasVision`
  当前仍读 `mmProbe.supported`（adapter 声明），盲模型套壳仍会被判"有视觉"。

**复核后验收**：typecheck 0 · unit 1480/0（+1 新回归用例）· fixtures 35/0。

## Review 采纳记录（2026-07-08，实施前）

- **cursor**：叙事按两案拆分（案A=断点①、案B=②③④，chrys 非探测被骗样本）；「8×45min」
  修正为「8 次 invoke、5 次打满 45min、attempt3 28min 正常、7/8 用户中断」；E2 的
  fidelity-governance-check「headless 下不得自动降级」标为硬冲突必改（发现双向死锁）；
  E4 覆盖 closure_open + agent_timeout_unclosed 两条 retry 路径；实施顺序改止血优先
  （E4+E2 为第一交付切片）；context_exploration 盲档压力入 E7 观察项。
- **codex**：P1——phase prompt 降级信息断供实证（(multimodal-degraded) 只到 verifier
  ai-prompt，未到 phases/spec/prompt.md）+ SKILL 强 VL 规则与 headless 不得问人死锁 →
  新增 E0 提前 P0（能力感知 prompt + SKILL 盲档工作法 + OCR 注入最小版）；「降级注入生效」
  表述收窄；E4 守卫分类收窄（盲档 capture_completeness_external 建 blind_review 家族，
  非 toolchain/await_human）；E1 金丝雀防 OCR 工具代答（非 OCR 几何/颜色题 + OCR-only
  判 ocr_capable 不判 tool_read）。

## Review 采纳记录·第二轮（2026-07-08，实施级补刀）

- **cursor**：①E0 补 buildUnattendedExecutionBlock 档位感知（goal-runner.ts:453-454 硬编码
  「only path through pixel_1to1…HALT for human」与能力块同 prompt 自相矛盾——盲档改
  blind-review-pending 措辞，与能力块同源取值）；②E7 补时序声明：E1 未落地案A 不得计
  P0 完成（案B 不依赖 E1）；③E0 OCR 预跑典型耗时入 E7 观察记录。
- **codex**：①E2 补量级预警：reference_only 为新枚举值（fidelity-shared.ts:15 现仅
  pixel_1to1|semantic_layout），须同步类型/parse/visual-handoff 文档/schema/测试断言，
  非 ts 小改；②E0 补参考图发现规则（首次 invoke 前 spec.md/authoritative_refs 不存在，
  deterministic pre-scan：requirement 引用目录→目录图片→ux-reference/，无图源跳过不造假）；
  ③E4 补计数状态来源：从 events.jsonl blocker_signature 回放统计，勿内存计数（resume/
  detach 重启不丢）。

## Review 采纳记录·第三轮（2026-07-08，codex 复看）

- 结论「主因链和方案基本准确，可作实施依据」；两项实施级补充均采纳：
  ①E1 local config strict schema 同步（LOCAL_CANONICAL_TOP_KEYS 白名单 +
  framework-local-config.ts:57-61 未知键 throw——已验证，不同步则字段一落全消费方炸）：
  新键纳入白名单/类型/roundtrip + 非法值/旧版兼容/写回不丢字段测试；
  ②E7 验收命令改逐条可复制形式 + Windows PowerShell NODE_PATH 语法。

## E0 实施记录（2026-07-08）

- **核心机制**：`resolvePhaseCapabilityAdvisory`（新，goal-runner.ts，已导出供测试）——
  spec/coding phase 且 UI 相关时计算 {hasVision, ocrAvailable, effectiveFidelity,
  fidelityClamped, ocrJsonPaths}；非 UI 需求 / 其余 phase 返回 null（不打扰无关 prompt）。
  UI 相关性判定：spec.md 已存在（coding 阶段必然存在；spec 重试也可能存在）→ 读真实
  `ui_change`/`fidelity_target`（权威）；否则（spec 首次 invoke）退回需求文本启发式
  （`detectUiRelevantRequirement` 宽松 UI 相关性 + `detectPixel1to1Intent` 1:1 强意图）。
  `buildCapabilityBlock`（纯函数，新导出）渲染能力块文本；`buildUnattendedExecutionBlock`
  加 capabilityAdvisory 可选参数，按 effectiveFidelity 分支"pixel_1to1 P0 唯一出路"那句话
  （cursor 原始诉求：能力块与 unattended 块必须同源取值，不得各算一遍自相矛盾）——
  两者共享同一个 advisory 对象，非分别计算。
- **OCR 预扫描（E6-min）**：`runOcrPrescanForSpec` 落 `spec/reports/ocr/<screen>.ocr.json`，
  幂等（已存在跳过，OCR 有耗时）。参考图发现 `discoverReferenceImagesForOcrPrescan`
  （fidelity-shared.ts，供 goal-runner 与未来 E3/E6 复用）。
- **踩坑记录（有价值，值得记）**：codex 提出的"参考图发现规则"实现时发现一个比预想更深的
  障碍——中文需求文本无空格分隔，"参考图在doc/features/..."里"在"与路径无缝相连，naive
  bidirectional token 正则会把中文动词一起吞进 token（resolve 到不存在的目录，测试实测
  FAIL）；反过来贪婪向后延伸又会把"...目录下"这类中文尾缀（口语描述，非路径段）一起吞掉。
  最终方案：**锚定 `relFeaturesDir()` 字面量起点**（不吃前缀 prose）+ **从最长到最短逐段
  回缩找磁盘上真实存在的最长前缀**（天然跳过"目录下"类伪路径段，不必理解中文语法）——
  比 codex 原始建议的正则方案更稳健，已用真实案例文本（bc-openCard/chrys 银行卡案的
  requirement 原文）验证。
- **core/profile 复用**：`loadProfileOcrToolkit`/`probeProfileOcrAvailable` 从 E2 阶段
  harness-runner.ts 的本地实现**移到** fidelity-shared.ts 共享导出（避免 goal-runner.ts
  重复实现同一 require-by-profileDir 逻辑），harness-runner.ts 改为 import 共享版本。
- **规则文档同步**：`SKILL.md:179` 强 VL 死规则改为按 `Visual capability advisory` 块的
  Vision YES/NO 分档；`reference/ui-spec.md` 新增"盲档工作法"小节 + 两处表格补盲档行
  （DSL↔原图校验 gate 场景表 + 推荐模型档位 K2 表）。
- **验收**：typecheck 0 · unit 1495/0（+15 新用例：fidelity-shared 5 个 + goal-headless-guard
  10 个，均用真实 adapter 声明 claude=tool_read/chrys=none 与真实 profile OCR 环境验证，
  非 mock）· fixtures 35/0。
- **诚实范围声明**：OCR 预扫描仅覆盖 `spec` 阶段首次/重试 invoke（`coding` 阶段的能力块
  会声明能力但不重新跑 OCR——coding 阶段应已能读 spec 阶段产出的 ui-spec.yaml 文本，
  OCR JSON 主要服务 spec 阶段的提取工作，这是有意的范围收窄非遗漏）。

## E3 实施记录（2026-07-08）

- **核心机制**：`capture-completeness-check.ts` 的 `checkCaptureExternalAudit` 在
  `uncovered.length > 0` 分支新增 `ctx.adapterImageInput === 'none'` 判据（盲档，与
  pixel/semantic/reference_only 具体档位无关——是"看不看得见图"而非"追不追求像素级"）：
  命中时不再走原"逐条 implement/defer+人签"BLOCKER/FAIL，改为 `writeBlindReviewPending`
  写出结构化 `spec/reports/blind-review-pending.yaml`（逐行 screen/text/y/confidence/
  `auto_disposition: unverifiable_blind`），check 本身降 `MAJOR`/`WARN`。真视觉档
  （`adapterImageInput` 非 `none`）分支完全不变（回归测试锁定：同一坏态两种 ctx 对照，
  真视觉档仍 `BLOCKER`/`FAIL`）——门禁强度没有全局放水，只与能力档位对齐。
- **重要发现（比原计划推导更深一层，值得记）**：核对 `harness-runner.ts` 的
  `summary.blockers[]` 构成（`buildSummaryBlockers` 只收 `status==='FAIL' &&
  severity==='BLOCKER'` 的 check）后确认：本次降级为 `MAJOR`/`WARN` 意味着
  `capture_completeness_external` 在盲档下**从此不再进入 `summary.blockers[]`**，
  也就**不会再让 `summary.verdict` 变成 `FAIL`**——即"script harness 本身可以在盲档下
  对这一项直接放行"，而不只是"重试更容易通过"。
  **连带结论**：E4 里预留的 `blind_review` 累计熔断家族扩展位（"为 capture_completeness_
  external 建 blind_review 家族归属"）**未启用，也不再需要**——既然该 check 在盲档下
  根本不会成为 blocker，就没有"反复出现却被产物变化冲淡"的累计熔断场景可言（那是
  BLOCKER 反复出现才有的问题）。`CUMULATIVE_HALT_FAMILY` 的注释保留原样作为文档
  （若未来某检查仍需要"盲档降级但仍是 blocker + 需累计熔断"的场景，该扩展位仍可用），
  但没有为了"用上它"而强造一个当前用不到的分类——避免过度设计。
- **③OCR 噪声混合行容错——按 plan 允许的可选子项，本轮未做，推迟至 E6**：案B 实录
  "人《AA招商银行"这类噪声前缀+真文本混合行的子串提取匹配未实现；当前盲档下这类行
  仍会计入 `uncovered`（写入 blind-review-pending.yaml 交人终审），只是不再 BLOCKER——
  对"止血"目标已经足够（不再空转/死锁），容错优化留给 E6 做（plan 原文已预先声明此为
  可选项，非遗漏）。
- **④phase-rules yaml 未动**：行为变化全部在 `capture-completeness-check.ts` 这层 ts
  代码实现，未触及 `specs/phase-rules/*.yaml`，`gate_fingerprint` 零影响，宿主存量回执
  不会因本次改动被判 stale。
- **验收**：typecheck 0 · unit 1496/0（+1 新用例，回归测试内含双 ctx 对照）· fixtures 35/0。

## E1 实施记录（2026-07-08）

- **金丝雀资产**：`vision-canary.ts`（新，core）——四色块（红/蓝/绿/黄象限）+ 中心文字
  token（`MAISON7X3Q`）的 300×300 PNG，用 jimp 生成（harness 既有依赖，无需新增）。
  文件名仅含内容哈希（`vision-canary-<hash>.png`），答案独立存
  `<hash>.answer-key.json`——已用真实渲染 + 像素采样验证四象限颜色与坐标精确匹配。
  判定分级（`classifyCanaryResponse`，纯函数）：**几何题全对**（4/4，严格无部分分——
  防"蒙对 3/4"）→ `tool_read`；**几何题未全对但 TEXT_TOKEN 命中** → `ocr_capable`
  （vision 仍 `none`，供 E2 capability 参考）；都不中/声明 `CANNOT_SEE_IMAGE`/空输出 →
  `none`。`externalToolSuspected` 尽力而为扫描 tesseract/ocr/PIL/cv2 等关键词。
- **本地 override + 缓存 schema**：`framework.local.json` 新增顶层键 `vision`
  （`config-field-ownership.ts` 白名单同步）：`image_input_override` 三值枚举 +
  `canary`（adapter/verdict/probed_at/reason，四字段全部严格校验）。旧版无 `vision`
  键的文件按向后兼容处理（不强制迁移）。
- **解析链接入**：`multimodal-probe.ts` 新增 `resolveBaseImageInput`（解析链最前：
  override > 新鲜金丝雀缓存（**adapter 匹配才算新鲜**——adapter 变更即视为过期）>
  原 adapter.yaml 声明/heuristic），`resolveGoalEffectiveImageInput`/
  `resolveContextAdapterImageInput` 改调用它——单点收口，harness check 与
  goal-runner 的 `resolvePhaseCapabilityAdvisory`（复用同一 `resolveContextAdapterImageInput`）
  同时生效，无需分别改。`readCanaryOcrCapableSignal` 供 E2 capability 消费（OR 进
  `ocrAvailable`，不替代框架自身 OCR 探测——canary 信号是补充非替代）。
- **goal-preflight 接入**：`decideVisionCanaryProbe`（纯决策，可单测：dry-run/
  非UI/无spec-coding phase/已有override/新鲜缓存 → skip；否则 → probe）与
  `runVisionCanaryProbe`（impure，真实 spawn 一次 headless agent 问答 + 写回缓存）
  分离——goal-runner.ts 在 `runGoalPreflight` 成功后调用，新增 `--refresh-vision-probe`
  CLI 强制重测。**架构决策（避免大改动风险）**：未把探测逻辑塞进 `runGoalPreflight`
  本体（那是纯同步、零 agent 调用、被广泛复用/测试的现有函数，强行改异步风险与
  改动面不成比例）——新增独立函数在其调用点之后追加调用，`runGoalPreflight` 自身
  签名/行为零改动。
- **诚实边界（验证范围声明）**：`runVisionCanaryProbe`（真实 spawn agent 那部分）
  **未在自动化测试中触发真实 agent 调用**——需要真实 CLI/账号，超出单测范畴且不应
  在编码会话中自动消耗真实 API 调用；已验证的是：①决策分支 `decideVisionCanaryProbe`
  纯函数全覆盖测试；②`classifyCanaryResponse` 判定逻辑（几何全对/部分对/仅文字对/
  盲/外部工具嫌疑）全覆盖测试，用构造的合成 agent 响应文本，非真实调用；③资产生成
  `ensureVisionCanaryAsset` 真实执行验证（写盘、幂等、像素级颜色/坐标核对）；
  ④解析链 override/缓存优先级真实读写 `framework.local.json` 验证。`runVisionCanaryProbe`
  函数体本身（agent invoke → 分类 → 写缓存的胶水代码）逻辑简单、复用既有
  `invokeAgentHeadless`/`resolveHeadlessInvokePlan`（已在其他路径测试过的基础设施），
  风险面小，但**发版前建议宿主实机跑一次真实探测**验证端到端胶水代码本身。
- **交互式自答**：SKILL.md 模型档位段补一句——交互式会话无 goal-runner 自动注入能力块
  时，agent 先用 Read 工具打开参考图具体描述内容自查，给不出具体描述即按盲档工作法；
  未建独立 CLI 探测脚本供交互式用户手动触发（真人在场核对本身就是比自动金丝雀更可信
  的信号来源，不必等自动化）。
- **验收**：typecheck 0 · unit 1525/0（+29 新用例：vision-canary 11 个 + multimodal-probe
  5 个 + framework-local-config 6 个 + goal-preflight 7 个）· fixtures 35/0。

## E5 实施记录（2026-07-08）—— P0 主链（E4/E2/E0/E3/E1/E5）全部完成

- **核心机制**：`init-readiness.mjs`（纯 Node.js，无 ts-node 依赖——Tier_1 在 ts-node
  就绪确认之前跑，不能依赖它）新增 `activeProfileHasOcrToolkit`（**存在性判据**：探测
  `profiles/<profile>/harness/ocr-toolkit.ts` 是否存在，非硬编码 'hmos-app'——其余
  profile 若未来也带 ocr-toolkit 会同样被纳入）+ `detectActiveProfileName`（纯 JSON.parse
  读 `framework.config.json > project_profile.name`，未初始化/解析失败回落默认 profile，
  不阻断 Tier_1）+ `detectProjectRootFromHarnessRoot`（复刻 repo-layout.ts 的
  standalone/consumer 判据，纯 fs+path，不 import TS 模块——避免 ts-node 循环依赖）。
  仅当 active profile 具备 OCR 工具链时才追加检查 tesseract.js/chi_sim.traineddata，
  两条缺失分别带**不同**修复指引（tesseract.js→`npm install`；tessdata→"framework
  分发不完整，需重新拉取/更新子模块，非 npm 包"）——写在 `missing[]` 条目自身文本里，
  保持返回值 shape 100% 向后兼容（未加新字段），既有 7 个测试与真实 CLI 消费方零改动。
- **验证细节（发现值得记）**：既有测试 `mkHarnessFixture` 构造的 fixture 没有
  `framework.config.json`/`profiles/`——追踪一遍确认：`detectActiveProfileName` 读不到
  config 时回落 `'hmos-app'`，但 `activeProfileHasOcrToolkit` 用这个假 profile 名去查
  一个本就不存在的路径（fixture 的 frameworkRoot 是系统临时目录），天然返回 false →
  OCR 检查被跳过——设计对这个边缘情况**碰巧因为存在性判据本身而正确**，非侥幸巧合
  （已补对应回归测试锁定该行为）。
- **验收**：typecheck 0 · unit 1530/0（+5 新用例：命中/tesseract.js缺失/tessdata缺失/
  非OCR-profile跳过/未初始化态不误判）· fixtures 35/0。

## E6 实施记录（2026-07-08）

- **核心机制（①②同源化）**：噪声过滤共享函数（`norm`/`CJK_RE`/
  `EXTERNAL_AUDIT_STATUS_BAR_BAND`/`collectAuditableOcrLines`）从
  `capture-completeness-check.ts`（门禁侧本地实现）**移到** `ocr-toolkit.ts`（profile 共享
  模块），门禁侧改 `export const collectAuditableOcrLines = collectAuditableOcrLinesShared;`
  引用同一份实现——门禁与 E0 的 `runOcrPrescanForSpec` 从此用**同一套**清洗/聚类逻辑，
  不再各算一遍。①新增 `detectColumnGroups`（行内按 x 显著 gap 拆列组，辅助 agent 判断
  "标签+数值同行"这类布局）。③新增 `extractLikelyRealTextRun`（最长连续 CJK 游程提取候选
  真文本，处理案B 实录"人《AA招商银行"这类 logo 误识别噪声前缀+真文本混合行，<2 字游程判
  噪声返回 null）——`BlindReviewPendingEntry` 新增可选 `candidate_text` 字段落此提取结果，
  帮人工复核时一眼看出"这行大概率是'招商银行'，前缀是噪声"而非要人肉重新识别整行。
- **`runOcrPrescanForSpec` 增强**：原先直接把 `ocrImageWords` 原始 words 落盘；现在同一函数
  内先经 `clusterOcrLines`（词→行聚类）→ `collectAuditableOcrLines`（同源噪声过滤）→
  逐行附加 `candidate_text`/`column_groups`（>1 组时才附加，避免噪声字段膨胀），产出的
  `ocr.json` 既保留原始 `words`（完整性/可回溯）又新增 `lines[]`（agent 可直接读的结构化
  提炼）。
- **潜伏 bug 修复（核对时发现，非本次引入）**：`fidelity-shared.ts` 的 `ProfileOcrToolkit`
  接口（E0 阶段编写）把 OCR word 的 bbox 形状声明成 `{x0,y0,x1,y1}`，但 `ocr-toolkit.ts`
  真实签名是 `{bbox:[x,y,w,h]}`——此前该接口只消费 `isOcrAvailable`/`ocrImageWords` 两个
  函数、从未访问过 word 内部字段，故一直未被触发。本次要接入 `clusterOcrLines` 等函数
  时必须改对，已修复（`ProfileOcrWordLike`/`ProfileOcrLineLike` 新类型 + `loadProfileOcrToolkit`
  扩展条件加载新函数，均为可选字段，profile 未实现时优雅降级为仅原始 words 可用）。
- **④诚实范围声明（未新建独立重量级 fixture，理由如下）**：plan 原文的"blind-tier spec
  端到端 fixture"要素——(a) ocr.json 内容正确可用、(b) 门禁在完整态 PASS、(c) 门禁在
  不完整态 WARN+写 blind-review-pending——**已被两个既有真实用例的组合覆盖**，均用同一张
  真实设备截图 `card_pack.png`（非 mock 字节）：
  1. 本批新增 `E6 OCR 预扫描产出：真实图片 → ocr.json 含聚类后 lines`
     （`goal-headless-guard.unit.test.ts`）——验证 (a)：真实跑
     `resolvePhaseCapabilityAdvisory` → `runOcrPrescanForSpec` 全链路，读回落盘的
     `ocr.json`，断言 `lines[]` 非空且含已知内容"首页"/"我的"。
  2. E3 批已有 `p0d_external_audit_blind_tier_warn_not_blocker_writes_pending_list`
     （`round6-bbox-crop-validation.unit.test.ts`）——验证 (b)(c)：同一张图，`ui-spec`
     完整态走 `checkCaptureExternalAudit` PASS；漏抽坏态在 `adapterImageInput:'none'`
     下降 WARN/MAJOR 并写出结构化 `blind-review-pending.yaml`（`unverifiable_blind`
     + entries/text 字段），真视觉档同一坏态仍 BLOCKER（回归保护，门禁强度未全局放水）。
  未额外新建 `profiles/hmos-app/harness/tests/fixtures/` 下的 `INPUT/CMD.json` 契约级
  fixture 把两步串成一条物理管线（1 产出 ocr.json → 2 消费 ocr.json 组装 ui-spec），因为
  `checkCaptureExternalAudit` 本身对截图做独立 OCR 验真（职责上不读 `runOcrPrescanForSpec`
  的 ocr.json——那份是**喂给 agent 写 spec 用的参考资料**，不是门禁的输入），两者物理上
  不在同一条数据流里，强行串起来会是为了"看起来完整"而在测试里捏造一条实际不存在的
  依赖关系，判断为过度设计。如后续 ocr.json 真被门禁消费（架构变化），届时再补物理链路
  fixture 更合适。
- **改动文件**：`profiles/hmos-app/harness/ocr-toolkit.ts`（新增共享函数）、
  `profiles/hmos-app/harness/capture-completeness-check.ts`（改引用共享函数 +
  `BlindReviewPendingEntry.candidate_text`）、
  `profiles/hmos-app/harness/tests/unit/ocr-toolkit.unit.test.ts`（+9 用例）、
  `harness/scripts/utils/fidelity-shared.ts`（`ProfileOcrToolkit` 接口扩展 + bbox 类型修复）、
  `harness/scripts/goal-runner.ts`（`runOcrPrescanForSpec` 接入聚类/候选提取）、
  `harness/tests/unit/goal-headless-guard.unit.test.ts`（+1 端到端真实 OCR 用例）。
- **验收**：typecheck 0 · unit 1498/0（+9 profile 级 ocr-toolkit 用例 +1 goal-headless-guard
  端到端用例，累计 1530→1498 系因 `--filter` 隔离已确认与本次改动无关的 pre-existing
  `profile:hmos-app:round6-bbox-crop-validation` 环境问题后重跑口径不同，详见下条）·
  fixtures 35/0。
- **环境问题（发现但非本次引入，已 spawn_task 另行跟踪）**：
  `round6-bbox-crop-validation.unit.test.ts:269` 顶层 `require('yaml')` 因
  `profiles/hmos-app/harness/` 不在 `harness/node_modules` 的祖先路径链上而恒
  `MODULE_NOT_FOUND`，导致 `npm run test:unit`（无 `--filter`）从该 suite 起整进程崩溃、
  后续 suite 结果全部丢失。用 `git stash` 回退到干净 HEAD 复现同一报错，确认与本会话
  任何改动无关（该 require 语句在更早的 round6 批次提交中已存在）。已用文件临时改名
  隔离验证：**排除该 1 个坏文件后，全量 unit 1498/0，typecheck 0，fixtures 35/0**——
  即本次 E6 改动本身零回归；坏文件已另行 spawn_task 跟踪修复，不在本次范围内处理。

## Review 复核·E6 后（2026-07-08，cursor + codex 双独立复核）

结论：两份 review 均判"大方向对，无直接破坏主流程的高优先级 blocker"；cursor 抓到 1 个
中等严重度真实口径不一致（已修）+ 2 个低severity 项（已修）+ 2 个纯观察项（不改代码，
留 E7）；codex 抓到 1 个真实 P2 缺口（已修，属"金丝雀被声明式套壳骗过"这条主线的同类
风险，值得修）+ 1 个 P3 项（核实后判定是既有框架级设计、非本 plan 引入，不在本次范围）。

**cursor 中（真实 bug，已修）**：`harness-runner.ts`（门禁钳制）与 `goal-runner.ts`
（prompt 能力块）的 `ocrAvailable` 口径不一致——前者只看 `probeProfileOcrAvailable`
（框架 OCR 环境），后者额外 OR 了金丝雀 `ocr_capable` 信号。场景：金丝雀判 `ocr_capable`
但框架 OCR 环境未就绪时，agent 被告知 `effective=semantic_layout` 且可能收到 OCR JSON
尝试，门禁却仍钳到 `reference_only`——多数情况非致命（都非 pixel_1to1）但排障时文案不
一致易困惑。修复：`fidelity-shared.ts` 新增 `resolveOcrAvailableForRun(projectRoot,
profileDir, adapterName)` 单一函数（`probeProfileOcrAvailable` OR
`readCanaryOcrCapableSignal`），`harness-runner.ts`/`goal-runner.ts` 两处改为共用同一
函数，不再各算一遍。

**cursor 低①（已修）**：`goal-failure-classifier.ts` 的 `CUMULATIVE_HALT_FAMILY` 注释仍
写"【扩展位，尚未启用】'blind_review'……待 E3 落地门禁层显式打该 classification 后加入
此集合"——E3 早已落地，但走的是另一条路（`capture_completeness_external` 命中直接降
WARN/MAJOR + 写 `blind-review-pending.yaml`，非新增 FailureKind），根本不会进入需要 halt
的重试循环，故这个扩展位其实**已确认无需启用**，非"待办中"。已改注释如实说明。

**cursor 低②（已修，最小化处理）**：plan 原文"降级决策落 headless-assumptions + trace"，
实现只缓存到 `framework.local.json`（`canary.reason` 可查，非功能缺陷，cursor 原话）——
但审计链确实少一块。`headless-assumptions.md` 按仓库既有惯例是**agent 写**的文件（headless
自动决策留痕，见 `user-confirmation-ux.md §9`），不是 harness 该越俎代庖写的产物；采用
最小修复：`buildCapabilityBlock`（goal-runner.ts）新增一条指令——`fidelityClamped` 为真时
提示 agent 把这次能力降级也算一次 headless 自动决策，记入 `headless-assumptions.md`
（复用 unattended 块已建立的路径/措辞格式，未新增 harness 写盘逻辑）。3 个既有
`buildCapabilityBlock` 单测补充断言（未钳制不应提示；钳制两态——有 OCR/无 OCR——均应提示）。

**cursor 环境项（无新动作，复核确认与本会话 E6 前一致）**：round6-bbox-crop-validation
yaml 环境问题维持之前判定，已 spawn_task 单独跟踪；cursor 复核也独立确认"排除后 1498/0"
与本 plan 实施记录一致。

**cursor 观察项（无需改代码，如实记录，留 E7）**：①金丝雀分类只读 `invoke.stdout`——若
adapter 把答案打到 stderr 可能误判 `none`，风险低，留待 E7 宿主实机观察是否真实发生；
②E1 首次 UI goal 额外 ~120s 探测成本——有缓存/override/非 UI 需求可跳过，符合 plan 预期，
E7 记录真实耗时数据即可，不需要提前优化。

**codex P2（真实 bug，同案A 风险类别，已修）**：`decideVisionCanaryProbe`
（goal-preflight.ts，先于任何 phase 跑，决定是否触发金丝雀）此前只用
`detectUiRelevantRequirement(manifest.requirement)` 判 UI 相关性；但
`resolvePhaseCapabilityAdvisory`（goal-runner.ts，每 phase 计算能力块）已经优先信
spec.md 的 `ui_change` 字段（更权威）。resume/继续 coding 场景常见 requirement 文本很短
（如"继续完成该需求"）而 spec.md 已声明 `ui_change: new_or_changed`——旧逻辑会把这种场景
误判 `not_ui_relevant` 而跳过金丝雀，让案A（mx 2.7 套壳）"假视觉"风险在 resume 场景重新
露头（探测决策与能力计算各算一遍，判据不同源）。修复：`fidelity-shared.ts` 新增
`resolveUiRelevanceForRun(projectRoot, feature, requirement)`（spec.md 存在时读 `ui_change`，
否则退回需求文本启发式——与 `resolvePhaseCapabilityAdvisory` 现有逻辑等价的独立可复用版
本），`decideVisionCanaryProbe` 改用它。**范围声明**：`resolvePhaseCapabilityAdvisory` 自身
的 if/else 未重构为调用这个新函数（它的 `desired` 计算与 `isUiRelevant` 判定共享同一次
`loadSpecMarkdown` 调用，拆开重构价值不大且有回归风险）——两处 UI 相关性判据现在**逻辑
等价**（同一新函数在别处的独立实现），但物理上仍是两份代码；如后续两者出现分岔，应回来
把 `resolvePhaseCapabilityAdvisory` 也切到共享函数。新增回归测试锁定 resume 场景。

**codex P3（复核后判定不在本次范围）**：`init-readiness.mjs` 的
`detectProjectRootFromHarnessRoot` 用 grandparent 是否含 `framework/skills` 判断
consumer/standalone，若 sibling 目录恰好存在同名结构可能误判——**核实后确认这不是
init-readiness.mjs 独有的缺陷，而是逐行复刻了 `repo-layout.ts` 的 `detectRepoLayout`
既有算法**（同一 grandparent + `framework/skills` 存在性判据，整个框架的路径解析全靠这
一份逻辑，非本 plan 引入）。若要收紧判据需要改动框架级、影响面远超本 plan 范围的核心路径
解析算法，故本次不动；如用户认为这是需要修的真实风险，应作为独立的框架级任务处理。

**复核后验收**：typecheck 0 · unit 全量（排除 1 个 pre-existing 环境坏文件）1499/0
（+1 新回归用例：codex P2 resume 场景）· fixtures 35/0。

## Review 复核·第三轮（2026-07-08，用户明确要求"影响发版门禁的必须修"）

上一轮把 round6 yaml 环境问题和 init-readiness.mjs 的 consumer/standalone 误判都判定为
"非本次范围"；本轮用户明确要求「如果有影响发版本门禁的要改好」，逼着重新审视这两项是否
真的不影响发版——结论：**round6 yaml 问题确实是真实的发版门禁阻断项**（codex 实测裸跑
`npm run test:unit` 会崩溃，须手动设 `NODE_PATH` 才过），已直接修复，不再是"留给独立
任务"的技术债；init-readiness.mjs 的误判点在这轮深挖后发现**比上轮判断更严重**——不是
"良性复刻既有设计"，而是canonical 的 `repo-layout.ts::detectRepoLayout` 本身就有一个真实
逻辑漏洞（判据只检查"grandparent 下是否存在 framework/skills"，从未验证 harnessRoot 自身
的 parent 是否就是那个 framework 目录），只是触发条件极窄（需要一个无关 sibling 目录恰好
同名）在正常 CI 发版环境里不会命中——**判定为不阻断发版**，但既然是框架级真实 bug 且修法
低风险，顺手在源头一并修掉，而非留着继续被两轮 review 反复提同一件事。

**修复①（发版门禁真实阻断，已修）**：`round6-bbox-crop-validation.unit.test.ts:269` 顶层
`require('yaml')`——`profiles/hmos-app/harness/tests/unit/` 不在 `harness/node_modules`
祖先路径链上，裸 require 恒 `MODULE_NOT_FOUND`。改用 `createRequire` 锚定
`harness/harness-runner.ts`（与 `fidelity-shared.ts`/`ui-spec-shared.ts` 加载 yaml 的既有
写法完全一致的既有先例，非新造模式），不依赖调用方目录、不需要 `NODE_PATH`。验证：裸跑
`cd harness && npm run test:unit`（unset NODE_PATH）**从崩溃变为 1541/0 全绿**。

**修复②（框架级真实 bug，触发面窄不阻断发版，顺手修掉源头而非留债）**：
`repo-layout.ts::detectRepoLayout` 原判据 `fs.existsSync(path.join(grandparent, 'framework',
'skills'))`——只问"某处是否存在"，未验证 harnessRoot 自身的 parent 就是那个 framework 目录。
改为 `path.basename(parent) === 'framework' && hasFrameworkTree(parent)`——consumer 布局下
harnessRoot 恒为 `<projectRoot>/framework/harness`，parent 目录名恒为 `'framework'`，这是
比"某处存在同名目录"更强的判据，杜绝无关 sibling 目录误判。`init-readiness.mjs` 的
`detectProjectRootFromHarnessRoot`（明确注释"复刻 repo-layout.ts"）同步应用相同修正，两处
判据重新保持一致，不再是"表面复刻、实际两套算法各自可能出错"的状态。新增回归测试：
`repo-layout.unit.test.ts`（canonical 版本）+ `init-readiness.unit.test.ts`（.mjs 镜像版本）
各补 1 例——构造"harnessRoot 真实为 standalone，但 grandparent 下恰好存在无关的
`framework/skills` 诱饵目录"场景，锁定不再误判。诱饵目录建在测试自建的隔离 wrapper 临时
目录内（非直接建在共享的 `os.tmpdir()` 下），避免污染机器上其他并发/后续测试进程的固定
路径。

**顺带（cursor 建议的非 blocker 项，成本低顺手做）**：`resolveOcrAvailableForRun` 此前只被
`harness-runner.ts`/`goal-runner.ts` 间接覆盖，无直连单测——补了 1 个直连用例（
`visual-fidelity.unit.test.ts`），锁定"profile 环境 OR 金丝雀 ocr_capable 信号（adapter
需匹配）"这个口径本身，不再只靠调用方间接兜底。

**未再改动的（复核后确认仍是合理的既有决策，无新证据推翻）**：
`resolvePhaseCapabilityAdvisory` 与 `resolveUiRelevanceForRun` 物理上仍是两份代码——cursor
本轮复核也认为"仍可接受，不需挡发版"，维持上轮判断不重构。

**验收**：typecheck 0 · unit **裸跑（unset NODE_PATH）1544/0**（不再需要排除 round6、不再
需要设置 NODE_PATH——release gate 三条命令现在开箱即绿）· fixtures 35/0。

## E7 拆分（2026-07-08，用户拍板）

codex 复核指出：代码侧门禁已全绿，但 `npm run release:check-plans --release`（`release:all`
链路里的发版门禁）仍会被本 plan 卡住——因为原 `e7-gates-green-and-host-replay` 这一个 todo
把"源仓三命令"和"宿主实机复验"揉在一起，只要还有一半是 pending，整个 todo 就非 terminal，
`version === 当前包版本（2.4.0）` 的 plan 在 release 模式下即 FAIL（`check-plan-version.mjs`
逻辑）。宿主实机复验需要真实 mx/chrys 主机操作，agent 侧做不到；plan frontmatter 又明确写
「2.4.0 窗口不 bump（用户控版本）」，版本号处置权归用户，不能擅自改 `version`/`deferred_to`
来绕过。就此询问用户如何处理，**用户选择：拆分 E7**——源仓门禁单独收口（已完成，改名
`e7a-source-gates-green`，status: completed），宿主实机复验从 plan 的 `todos:` frontmatter
中移出，改列为下方独立的人工发版前检查清单（不再是这个 plan 的 todo 项，不受
`release:check-plans` 约束）。

**宿主实机复验清单（发版前，人工执行——不受本 plan release 门禁约束，但仍是发版前应做的
事，由用户在真实宿主机上跑）**：
- **案A线**（mx 2.7 + claude adapter）：金丝雀应正确降级判定为 `none`/`ocr_capable`（不再被
  adapter 声明的假视觉骗过）；UI spec 走盲档工作法应能跑通不中断。【时序声明（cursor 采纳，
  仍有效）】E1（金丝雀实测）已落地，此前"E1 未落地则案A 不得计为 P0 完成"的限制已解除，
  案A 现在具备被正确复验的前提条件。
- **案B线**（chrys 重放银行卡需求）：应在 `semantic_layout` 档闭环，或在几十分钟内干净
  `await-human halt`（不再是原始 bug 报告里的 4h19m 死循环）；stdin 传参修复（`a02703d`）
  同批复验。
- **观察记录**（cursor 提示，只记录不动语义）：盲档下 `context_exploration_*` 等探索深度
  门禁是否仍构成 residual 超时压力；E0 OCR 预跑典型耗时（张数×单张，相对 45min 盲跑预期
  应可忽略，用真实数据说话）；金丝雀分类当前只读 `invoke.stdout`（若 adapter 把答案打到
  stderr 可能误判 `none`，风险未知，宿主复验时留意是否真实发生）。
- 复验结果建议回填本文件（新增一节记录结论），供后续 plan 立项参考；不强制在回填前完成，
  因为该清单已不再是 `release:check-plans` 的阻断项。

## P0 主链完工小结（2026-07-08）

多模态降级阶梯 plan 的 P0 六件套（E4 收口治理 → E2 档位钳制 → E0 能力感知 prompt →
E3 门禁语义随档位 → E1 金丝雀实测 → E5 Tier_1 探针）**全部实施完毕**，累计 5 次提交
（`9f65110` E4+E2、`acfdb0f` E0+E3、`b7682c2` E1、`ca8a72d` E5）。typecheck 全程 0；
unit 从 1465（stdin 修复后基线）累计到 1530（+65 新用例）；fixtures 全程 35/0。
**E6**（P1，OCR 全管线提质）随后补完，见上方 E6 实施记录（typecheck 0 · unit 全量
（排除 1 个与本 plan 无关的 pre-existing 环境坏文件后）1498/0 · fixtures 35/0）。
**E7 源仓门禁**（`e7a-source-gates-green`）已收口 completed——裸跑三命令 1544/0 全绿。
本 plan 的 `todos:` 已全部 terminal，`release:check-plans --release` 不再被本 plan 卡住。
宿主 chrys/mx 实机复验拆分为独立的人工发版前检查清单（见上方"E7 拆分"一节），不受本
plan release 门禁约束，仍需用户在宿主机执行并建议事后回填结论。
