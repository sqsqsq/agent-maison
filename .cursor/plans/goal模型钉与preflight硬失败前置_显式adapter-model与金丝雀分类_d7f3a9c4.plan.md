---
name: goal 模型钉（显式 --adapter-model）+ 金丝雀 CLI 硬失败前置
version: 3.0.0
# 版本说明：跟随当前版本窗口 3.0.0。从事故修复 plan c9f4e7a2 移出的平台级加固。
# 前置依赖：c9f4e7a2 四件套先落地（同改 agent-invoke.ts；t4 以 c9 t2 修后 argv 为
# 失败分类基线）。实施顺序：t5（OpenSpec 成文）→ t1 → t2 → t3 → t4 → 末尾 validate。
overview: >
  v6 按 codex 六轮 review 收敛（身份谓词 run 必查/模型按 pin 追加、两类调用方两条
  规则、三条子进程传播路径、pin 单点裁决、t4 与既有 binary 门禁划界）。
  域 A（t1-t3）：goal headless 模型钉。竞态事实：六个 argv 构造器全不传模型，goal
  无人值守每 phase 全新 spawn 现读各家共享配置——并发交互窗口切模型污染运行中 run
  （codex config.toml、cursor cli-config.json 全局单值、claude settings/.claude.json
  均实锤；opencode 仅证默认源、竞态未证实）。第一版走最小显式路径：**只接受用户
  显式 `--adapter-model <id>`**，不扫描各家私有配置（两坑已证伪：codex 读项目级
  .codex/config.toml 致用户级快照钉错值、`-c model=<raw>` TOML 类型陷阱），不把
  CLI 自报当权威来源。pin 必须**同时贯穿正式 phase 与 preflight 金丝雀**，并进入
  金丝雀 receipt 身份与采信谓词，否则 resume 改 pin 后仍会采信旧模型缓存。
  未传 flag = 现状，逐元素零变化。
  域 B（t4）：金丝雀 CLI 硬失败前置 BLOCKER——**不是通用 preflight 加固，也不重复
  既有 binary 门禁**（resolved binary 不可 spawn 已由 runGoalPreflight 在金丝雀
  决策前普遍阻断）；新增部分仅限金丝雀真的执行时（decideVisionCanaryProbe.action
  === 'probe'）捕获 child spawn race 与 CLI/config 参数不兼容。
todos:
  - id: t5-openspec-delta
    content: >
      【先行】OpenSpec 最小 delta——模型 pin 是新的显式运行合同，须先成文再实现
      （codex review 三轮：spec 不应最后补）。在 goal-runner 能力下新增
      Requirement，明确：① 用户显式 `--adapter-model` pin 是**权威输入**，参与
      argv 回放；② observed model 仍是 append-only telemetry，SHALL NOT 成为 pin
      来源、SHALL NOT 参与任何 policy 分支（与既有 cc-spec-deadlock-hardening 的
      "Observed adapter model is append-only telemetry" Requirement 并存不冲突）；
      ③ pin 纳入 manifest identity，条件在场、旧 manifest 兼容；④ fresh/resume/
      successor 的授权旗标规则（见 t2）；⑤ **pin 与金丝雀 receipt 绑定**——pin 在场
      时金丝雀 receipt 记录 pin.value 且采信须模型匹配，这是"用户权威 pin 与实测
      receipt 绑定"，不是拿 observed telemetry 参与策略；⑥ 无 pin 时行为逐元素
      不变；⑦ chrys/generic 不支持时 fail-fast。金丝雀硬失败分类（t4）同步补场景：
      仅 action==='probe' 路径生效、只有 hard_cli_failure 升 BLOCKER、既有 binary
      门禁不变。
    status: completed
  - id: t1-explicit-adapter-model-pin
    content: >
      显式模型钉：CLI → manifest → **全部 headless 调用点**回放。
      ① goal-runner CLI 新增 `--adapter-model <id>`（仅 headless runner 链路；
      in-session attended 由宿主会话自跑不适用，文档写明）。值处理：先 trim，再
      校验非空、长度 ≤128、无控制字符；**不做模型名白名单**（格式责任在用户，
      CLI fail-fast）。
      ② manifest 新字段 adapter_model_pin: {adapter, value}——adapter 必须等于最终
      effective adapter（见 t2 单点裁决）。dry-run 在 plan 输出回显 pin。
      ③ 回放覆盖面（codex review 三轮/四轮：逐个调用点写死，不留"等等"）——
      仓库现存 `resolveHeadlessInvokePlan` 调用共三处，逐一定性：
      （a）正式 phase 调用（goal-runner）→ **必须带 pin**；
      （b）`runVisionCanaryProbe` 的 headless 调用（goal-preflight.ts L386）→
      **必须带 pin**（金丝雀身份绑定的前提，见 t3）；
      （c）`runGoalPreflight` 内 L232 的 plan 构造 → **刻意不带 pin**：它只用于
      `validateHeadlessBinaryForPlan`（binary gate，只校验 argv[0] 可否 spawn，
      与后续 flag 无关），不实际 spawn；且 chrys/generic 的"不支持 pin"错误在
      **更早**的 `resolveFinalModelPin()`（t2 单点裁决，位于 adapter reconcile 后）
      即 fail-fast 退出，根本走不到此处。单测须断言这两点（该调用不含 model 旗标；
      chrys/generic + pin 的 BLOCKER 发生在 preflight 之前）。
      任一（a）（b）漏传即视为缺陷（单测逐点断言）。
      ④ 各家旗标：codex `codex --ask-for-approval <p> exec --model <v> --sandbox
      <m>`（位置随 c9 t2 修正后形态）；claude 与 codeagent 共用 claudeArgv 追加
      `--model <v>`（**同一函数、仅 binary 不同**——生产代码 agent-invoke.ts L470
      已 claudeArgv(…, 'codeagentcli')，单测 codeagent-adapter L278 已
      deepStrictEqual 断言 argv 对称，runbook L140 声明 flags 全套等价）；
      cursor `--model <v>`；opencode `-m <v>`。第一版支持
      **codex | claude | codeagent | cursor | opencode** 五家。模型值**禁止**走
      codex `-c model=<raw>`（TOML 裸值类型陷阱实锤）。
      ⑤ 仅 chrys | generic 无回放缝：传了 flag 即 fail-fast 拒绝并明说；拒绝点在
      t2 的 `resolveFinalModelPin()`（adapter reconcile 后、preflight 之前），
      不留到构造 plan 时才炸。
      ⑥ 文档：runbook 与 goal-mode SKILL 补用法一句"并发多窗口跑不同模型时，启动
      goal run 传 --adapter-model 钉住本 run 模型"，注明 chrys/generic 不支持。
      单测：flag 校验正反例（trim/空/超长/控制字符）；五家回放形态逐元素；
      **codeagent argv == claude argv 仅 argv[0] 不同**（带 pin 与不带 pin 各断言
      一次）；chrys/generic fail-fast；**金丝雀调用点与正式 phase 调用点各自断言
      pin 已注入**；无 pin 时各家 argv 与现状逐元素一致；dry-run 回显。
    status: completed
  - id: t2-pin-lifecycle-single-adjudication
    content: >
      pin 生命周期——**单点裁决 + 写死旗标**（codex review 三轮：现有流程无法直接
      照 v2 文字实现）。
      落点（关键）：现有 `validateManifestCliOverrides`（goal-manifest-cli.ts L25）
      在无 `--manifest` 时直接 return，**覆盖不到 `--resume <run-id>`**；最终
      adapter 要到 `reconcileRunAdapter`（goal-runner.ts L3912-3918）后才确定；
      successor 继承发生在此前，易把 fresh pin 覆盖掉。因此：**在 adapter
      reconcile 之后、身份哈希计算之前，用一个小纯函数 `resolveFinalModelPin()`
      一次性裁决最终 pin**，禁止在多处散落修改。该纯函数输入=（CLI 值、manifest
      既有 pin、successor 继承 pin、effective adapter、override 旗标集），
      输出=（final pin | BLOCKER 原因）。
      规则（逐条写死，实现即照此分支）：
      - **fresh 普通启动**：直接接受 `--adapter-model`；
      - **fresh + `--manifest`**：与 manifest pin 同值幂等；**新增或不同值须
        `--override-manifest`**（与 --adapter/--requirement 同档处理）；
      - **resume / force-resume**：不传=用 manifest 冻结 pin；同值幂等；不同值
        **必须 `--override-manifest`**（pin 非 start/end 字段，
        `--override-start`/`--override-end` 不授权它）；`--force-resume` 本身
        **不绕过** pin drift；
      - **adapter 变了但 pin.adapter 未同步** → BLOCKER；
      - **resume 同时换 adapter 与模型** → `--override-adapter` 与
        `--override-manifest` **两个都必须有**；
      - **successor**：默认继承源 run pin；出生时显式 `--adapter-model` 是**新 run
        的出生输入**，可覆盖继承值且**不要求 `--override-manifest`**；successor
        换 adapter 须 `--adapter <new> --override-adapter --adapter-model
        <new-model>`，**禁止**把旧 adapter 的模型字符串回放到新 adapter。
      完整性：adapter_model_pin 按 vision_lineage 同款条件纳入身份哈希
      （computeManifestIdentityFields L128-154：hasOwnProperty 在场即入，旧
      manifest 无键不受影响）；validateLoadedGoalManifest（L745）增 shape 校验
      （adapter ∈ 已知集、value 非空 ≤128 无控制字符，违规整体拒绝加载）；停机期间
      改 value 不更新出生基线 → 命中既有 manifest_identity_drift（字段入哈希后
      自动获得，不新建机制）。successor 继承与 vision_lineage"一次性出生指令、
      克隆时剥离"语义**相反**，buildSuccessorManifest L520-524 注释须写明防误剥。
      单测：上述每条规则各一用例（含 override 旗标组合正反例）、纯函数在 reconcile
      后被调用一次的接线断言、条件纳入（有/无键两态哈希集合差）、篡改拒绝命中目标
      分支、旧 manifest 无键兼容。**身份字段夹具必须由真实 writer 生成，不得手写
      原值冒充哈希**。
    status: completed
  - id: t3-pin-canary-binding-and-telemetry
    content: >
      pin 与金丝雀身份绑定 + 自报 telemetry 复用（codex review 三轮 P1#3）。
      【绑定，真实漏洞修复】现状：金丝雀 receipt 写死 `model: 'unknown'`
      （goal-preflight.ts L419，注释理由是"adapter 层无法证明实际模型路由"）；
      采信谓词 `canaryAdmissibleForRun`（effective-vision-context.ts L291-299）
      只比较 probed_via 与 run_id，**不比较模型**。由此两个真实漏洞：
      ① resume 改了 pin 但 run_id 未变 → 仍采信旧模型产出的 canary；
      ② pinned goal 可能采信另一个交互模型产生的 interactive canary
      （viaGoal=false 分支直接放行）。
      修法：pin 在场时金丝雀 receipt 写 `model = pin.value`（pin 在场时"无法证明
      模型路由"的前提不再成立——模型是用户显式指定并已回放进 argv）；采信判定加
      模型匹配：**pin 在场时 canary.model 必须等于 pin.value 才可采信/跳过**；
      无 pin 时完全保持现状（不比较 model，receipt 仍记 'unknown'）。
      **执行身份谓词必须覆盖全部消费面**（codex review 四轮：v3 只接了两把尺子，
      其余消费者会绕过模型校验）。真实失败路径：旧 canary 模型不匹配 → 正确触发
      重探 → 重探遇 auth/quota（按 t4 非硬失败、不阻断、不写盘）→ 下列消费者仍按
      **adapter-only** 的 `isVisionCanaryFresh(canary, adapter)` 采信旧缓存 →
      污染 OCR/fidelity/门禁。现存消费面（全部实锤）：
      - multimodal-probe.ts L206（resolveBaseImageInput → image_input）
      - multimodal-probe.ts L237（readCanaryOcrCapableSignal → OCR）
      - multimodal-probe.ts L251（readCanaryToolReadSignal → tool_read）
      - goal-runner.ts L4184（LKG 日志判定）
      - profiles/hmos-app spec-ui-spec-check.ts L448（pixel_1to1 门禁升级，
        经 readCanaryToolReadSignal 间接消费）
      修法（codex 四轮/五轮：**不得把身份塞进新鲜度谓词，且身份必须含 runId**）：
      - `isVisionCanaryFresh` **保持不动**（它只判新鲜度：adapter/probe_version/
        TTL/时钟；multimodal-probe L57）；执行身份判定仍归
        `canaryAdmissibleForRun`（effective-vision-context L288-289 注释明确
        "两者关注点分离"）。既有架构分离不得破坏。
      - 新增**一个身份谓词**（run 必查、模型按 pin 追加）：
        `canaryAdmissibleForExecution(canary, {runId, modelPin}) =
        canaryAdmissibleForRun(canary, {runId}) &&
        (!modelPin || canary.model === modelPin)`。
      - **两类调用方用两条明确规则**（codex 六轮纠错：v5 的单一公式
        `fresh && (!pin || …)` 在无 pin 时会退化成只剩 `fresh`，若中央判定也用它，
        等于**删掉这两处现有的 `canaryAdmissibleForRun` 检查**，直接重新引入
        07-24 跨 run 缓存事故——这是削弱不是加固）：
        · **中央两处**（`decideVisionCanaryProbe` 要不要重探 / 三轴 resolver 能不能
          采信）：**始终**用 `fresh && canaryAdmissibleForExecution`——无 pin 时
          自然退化为现状的 `fresh && canaryAdmissibleForRun`，行为不变；
        · **五处既有旁路**（image_input / OCR / tool_read / LKG / profile 门禁）：
          用 `fresh && (!modelPin || canaryAdmissibleForExecution)`——无 pin 时
          退化为 `fresh`，与现状逐分支一致；pin 在场时才追加 `{runId, modelPin}`
          全套身份检查。
      - **身份必须是 `{runId, modelPin}` 二元**，只比模型不够：
        R1/model-M 产出 canary → R2/model-M 采信谓词发现 run 不同→重探 →
        重探遇 auth/quota（非硬失败、不写盘）→ 若身份只比 model，五处旁路会因
        adapter+model 全同而**重新采信 R1 的跨 run 缓存**，违反
        openspec visual-capability-truth "run_probed SHALL NOT cross runs"
        （spec.md L18）。
      - **无 pin 时不扩大 scope**：五处旁路保持现状（仍只 `isVisionCanaryFresh`）——
        "无 pin 下旁路跨 run 采信"属既有行为，归 visual-capability-truth change 的
        消费面收口（tasks 3.8）处理，本 plan 不抢；但**中央两处的既有 run 绑定
        一步都不能少**。
      - 两把尺子仍须合一：中央两处共用同一身份谓词——07-24 bc-openCard 事故正是
        "新到不必再探 + 旧到不能采信"打架致盲（effective-vision-context
        L266-275 载明）。
      【子进程传播，三条路径逐一接线】（codex 五轮：v4 只写 profile extraEnv 太窄）
      pin 在 manifest，而消费者散在多个子进程。沿用**既有 `MAISON_GOAL_RUN_ID`
      的注入模式**（不写全局状态、随身份一起走），只新增一个 model-pin env：
      - ① agent 调用的 `extraEnv`（goal-runner L5957 附近）；
      - ② gate harness 的 `gateInjectedEnv`（goal-runner L953——已注入
        MAISON_GOAL_RUN_ID/ATTEMPT/ATTEMPT_PHASE，同处追加）；
      - ③ `check-receipt` 独立子进程 env（phase-state.ts L331 的 `goalIdentity`
        分支，同款三键处同追加）。
      对应**真实消费者**（均经 `resolveContextAdapterImageInput` 读 canary，当前
      只传 adapter）：harness-runner.ts L556、check-receipt.ts L1220，以及
      profiles/hmos-app spec-ui-spec-check.ts L448。三者都须能取到 {runId, pin}
      并走上述组合函数；**取不到 pin 即按无 pin 处理（现状语义），不得臆造**。
      注入键遵守既有纪律：先清大小写变体再写唯一键（goal-runner L950-952 注释所载
      Windows 混写教训）。
      【telemetry，复用不新建】goal-runner.ts L6006-6023 已实现
      `adapter_model_observed` append-only 事件（条件 tool_event_provenance===
      'structured_events'，经 parseClaudeInitModel 解析 init）；本 todo 只加：
      pin 存在时把既有 observedModel 与 pin 比对，失配 emit 告警注记
      （pin_verify_mismatch，投影到 goal-report）。严格边界——只告警；不 halt；
      不改 manifest；不改 phase verdict；不改 capability/fidelity 路由；不把自报
      升格为权威（权威永远是用户显式 pin）。与既有 spec Requirement 语义一致。
      adapter 覆盖诚实声明：claude 的 init.model 已实证可解析；codeagent 事件流的
      `modelID` 是 tool_use_result 扩展字段（c7a9e2f4 L229 明确"不在现有解析
      路径"，单测夹具实采为空串），**与 init.model 不是同一字段**——codeagent 自报
      能否解析须按真实 writer schema 采样确认后才声明支持，未确认前不猜字段位置。
      （codeagent 的 `--model` **回放**在 t1 直接支持，与自报核验是两件事。）
      单测：pin 在场时 receipt 记 pin.value；模型不匹配的 canary 不被采信且触发
      重探（同一谓词在重探判定与采信判定两处各断言一次）；interactive canary 在
      pin 在场且模型不符时不采信；**五处消费面逐一断言 pin-aware**（image_input /
      OCR / tool_read / LKG / profile 门禁）；无 pin 时 receipt 与全部消费面行为
      与现状逐分支一致；pin 与自报一致→无告警，失配→有告警且 verdict/manifest/
      路由均不变。
      **端到端必测两例（codex 四轮/五轮各指定一条失败路径）**：
      ① **模型失配**跨 pin：旧 canary model≠pin → 触发重探 → 重探以非硬失败
      （auth/quota）告终、不写盘 → 断言旧缓存不影响任何路由或门禁；
      ② **同模型、跨 run**：R1 与 R2 同 model 但 runId 不同 → 采信谓词因 runId
      不符触发重探 → 重探同样非硬失败不写盘 → 断言 R1 缓存**仍不得**被五处旁路
      采信（这条正是"身份只比 model 不够"的回归锁）。
      两例都逐项断言 image_input / OCR / tool_read / fidelity / pixel_1to1 门禁；
      **不是纯函数测试，须走真实消费链路**（含子进程 env 传播：断言三条注入路径
      各自把 {runId, pin} 送达对应消费者）。
    status: completed
  - id: t4-canary-hard-failure-blocker
    content: >
      金丝雀 CLI 硬失败前置 BLOCKER——**作用域双重收窄**（codex review 三轮 P2#5）。
      ① 与既有门禁划清界限：`resolved binary 不可 spawn` **已由 runGoalPreflight
      在金丝雀决策前普遍 BLOCKER**（goal-preflight.ts L239 validateHeadlessBinaryForPlan），
      **保留不动、不重复实现、不在本 todo 记为新增保护**。本 todo 新增的只有两类：
      （a）金丝雀实际调用中的 **child spawn race**（binary 检查通过但 spawn 时失败）；
      （b）**CLI/config 参数不兼容**（unknown argument / config 加载失败）。
      ② 仅当 decideVisionCanaryProbe 返回 action==='probe' 时生效；缓存命中、
      dry-run、chain 无 UI phase、有 local override 等 skip 路径**不具备该保护**
      （如实记录，不新增探测调用）。这不是通用 preflight 加固。
      ③ spawn error 结构化（v1 写"已有事实只须消费"不准确）：agent-invoke.ts L192
      现在 `child.on('error', () => { exitCode = 1; … })` **丢弃了错误对象**。须新增
      结构化字段 spawn_error?: {code?: string; message: string}；resolvedBinary
      短路路径与真实 child error 产生**同一种**结构化事实，不得靠 stderr 猜 spawn
      failure。
      ④ stderr 签名收窄（`^error:` / `^Usage:` 单独出现会误判认证、额度、模型服务
      错误）。硬失败须**同时**满足：nonzero exit + 非 timeout + 非 silent kill +
      无有效 stdout + stderr 命中显式枚举签名（`unknown argument`、
      `unexpected argument`、`unrecognized option`、`Error loading config`）；
      `Usage:` 只能作为上述参数错误的**辅助**特征，不能单独触发。不发明"快速退出
      N 秒"时间阈值。正则纪律：行首锚定、逐行限长、禁 `[^\n]*` 前缀、禁全文
      stringify。
      ⑤ 分类结构化：runVisionCanaryProbe 返回
      `hard_cli_failure | invoke_failed_not_cached | invalid_not_cached |
      valid_cached`；**只有 hard_cli_failure 接入 run 级 BLOCKER**（走既有 BLOCKER
      通道，halt_guidance 附 stderr 头部摘要 + "CLI/adapter 兼容性问题，非需求
      代码"定性），其余语义与现状完全一致。
      单测/集成：**必须实际命中 action==='probe' 后的 child/CLI 失败**（集成路径，
      不能只直接调用分类纯函数）；child spawn error → hard_cli_failure；
      unknown argument → hard_cli_failure；config load error → hard_cli_failure；
      普通额度/API/auth 错误**不**升 BLOCKER；无效视觉答卷仍非阻断；缓存跳过路径
      不调用分类；既有 binary 门禁路径行为不变（回归断言）；10KB 长行 stderr 夹具
      无回溯灾难。
    status: completed
isProject: false
---

# goal 模型钉（显式）+ 金丝雀硬失败前置 (d7f3a9c4)

状态：**v6 — codex 六轮 review 修正（身份谓词两条调用规则，杜绝无 pin 时退化掉中央 run 绑定）后，待 review**

## codex 三轮 review 处置表（2026-08-09，逐条核实）

| 意见 | 核实结论 | 处置 |
|---|---|---|
| P1 pin 未绑定金丝雀实际模型与缓存身份 | **实锤两个漏洞**：goal-preflight L419 写死 `model:'unknown'`；canaryAdmissibleForRun L291-299 只比 probed_via+run_id 不比 model → resume 改 pin 同 run_id 仍采信旧缓存；interactive canary（viaGoal=false）直接放行 | 采纳，t3 新增绑定；并加"两把尺子必须合一"约束（07-24 事故前车之鉴） |
| P1 pin 生命周期缺可实现的单点裁决 | **实锤**：validateManifestCliOverrides L25 无 `--manifest` 即 return，覆盖不到 `--resume`；reconcileRunAdapter L3912-3918 后才定 adapter | 采纳，t2 改为 reconcile 后、身份哈希前的单点纯函数 `resolveFinalModelPin()`；六条规则+successor 三态逐条写死 |
| P2 t4 不应把既有 binary 门禁算作新增 | **实锤**：runGoalPreflight L239 已在金丝雀决策前 validateHeadlessBinaryForPlan | 采纳，t4 划清界限：既有门禁保留不动，新增仅 child spawn race + CLI/config 不兼容；验收须走真实 probe 集成路径 |
| P2 编号与顺序残留 | 属实（overview"域 B（t3）"、版本说明"t3 基线"、c9 移出表指向、家数表述） | 全部机械修正；实施顺序改 t5→t1→t2→t3→t4→validate |
| codeagent 已改对、非 goal 写回路径已纳入 c9 t1 | 确认 | 保持 |

## codex 四轮 review 处置表（2026-08-09）

| 意见 | 核实结论 | 处置 |
|---|---|---|
| P1 模型绑定只覆盖两把尺子，其他消费面绕过校验 | **实锤**：`isVisionCanaryFresh(canary, adapter)` 是 adapter-only 判据，被 multimodal-probe L206/L237/L251、goal-runner L4184、spec-ui-spec-check L448（经 readCanaryToolReadSignal）直接消费，均不经 canaryAdmissibleForRun。失败路径成立：模型失配→重探→重探非硬失败不写盘→上述消费者仍采信旧缓存 | 采纳，t3 改为"可选 pin-aware 执行身份谓词 + 全部 goal 消费面共用"，补 profile 侧 extraEnv 接线，加端到端失败路径必测 |
| P2 "全部 headless 调用点"漏一处 | **实锤**：runGoalPreflight L232 另有一次 resolveHeadlessInvokePlan | 采纳，t1 三处调用点逐一定性：(a)(b) 带 pin，(c) 刻意不带（仅 binary gate）+ 断言 chrys/generic 的 BLOCKER 在 resolveFinalModelPin 更早发生 |

## codex 五轮 review 处置表（2026-08-09）

| 意见 | 核实结论 | 处置 |
|---|---|---|
| P1 不该把模型身份塞进新鲜度谓词，且身份漏 runId | **实锤三点**：multimodal-probe L57 只判新鲜度；effective-vision-context L288-289 注释明写"两者关注点分离"；openspec visual-capability-truth spec L18 `run_probed SHALL NOT cross runs`。失败路径成立：同模型跨 run 时只比 model 挡不住 | 采纳，`isVisionCanaryFresh` 保持不动；新增薄组合函数，pin 在场时身份=`{runId, modelPin}` 并复用 `canaryAdmissibleForRun`；无 pin 逐分支保持现状（不抢 visual-capability-truth 的消费面收口 scope）；端到端补"同模型跨 run"一例 |
| P1 pin 传播路径与消费者不完整 | **全部实锤**：三条子进程路径（agent extraEnv L5957 / gateInjectedEnv L953 / phase-state L331 check-receipt spawn）+ 两个真实消费者（harness-runner L556、check-receipt L1220，均经 resolveContextAdapterImageInput 只传 adapter） | 采纳，t3 明列三条注入路径与三个消费者；沿用既有 `MAISON_GOAL_RUN_ID` 模式只加 model-pin env；遵守"先清大小写变体"注入纪律；取不到 pin 按无 pin 处理 |
| P2 c9 机械旧口径 | 属实（v7/四处/全库 grep 共 5 处） | c9 已统一为 v9 / 8 处 / 发布运行时路径 grep；历史处置表保留旧口径作为记录 |

## codex 六轮 review 处置表（2026-08-09）

| 意见 | 核实结论 | 处置 |
|---|---|---|
| P1 组合公式在无 pin 时丢掉中央的 run 绑定 | **成立，是真实逻辑错误**：v5 公式 `fresh && (!pin \|\| …)` 在 pin 缺席时退化为只剩 `fresh`；而正文又要求中央两处共用它 → 等于删掉三轴 resolver 与重探判定现有的 `canaryAdmissibleForRun`，重新引入 07-24 跨 run 事故。我从"旁路视角"写的公式套到中央判定上成了削弱 | 采纳 codex 方案：独立身份谓词 `canaryAdmissibleForExecution`（run 必查 + modelPin 在场时追加模型匹配）；**中央两处始终调用**、**五处旁路仅 pin 在场时追加**；验收补"无 pin 时中央仍拒跨 run 缓存"的回归断言 |
| P3 机械残留（d7 overview v3、硬约束编号重复 5/6） | 属实 | 已修：overview→v6、硬约束编号顺延为 1-12 |
| （随 P2）c9 零输入态漏 `burned` | 属实 | c9 统一语义补 `burned`；宣称"已烧毁"收紧为"权威状态读到 burned"或"本次 burn 成功"二选一 |

## 背景与竞态事实（c9f4e7a2 采证固化，勿重采）

| adapter | 默认模型源（每次 spawn 现读） | 竞态 | 回放旗标（help 实证） | 自报核验 |
|---|---|---|---|---|
| codex | 项目 `.codex/config.toml` > 用户 config.toml（项目级加载探针实锤） | 实锤（用户实景） | `exec --model` | 未实证 |
| cursor | cli-config.json 全局单值 selectedModel（实采 composer-2.5） | 实锤（最重，跨项目全局） | `--model` | 未实证 |
| claude | settings.json 顶层 model + .claude.json 项目条目 | 实锤（/model 持久化） | `--model` | **init.model 已实证并已接入 telemetry** |
| codeagent | claude fork，argv 对称已固化 | 同 claude 家族 | `--model`（复用 claudeArgv，自动获得） | 未确认（modelID ≠ init.model，须采样） |
| opencode | opencode.json 顶层 model | **未证实**（仅证默认源） | `-m` | 未实证 |
| chrys / generic | 未装 / 占位 | — | **无缝 → fail-fast** | — |

## 为什么第一版是显式 flag（选型固化，防将来重走弯路）

| 方案 | 结论 |
|---|---|
| 显式 `--adapter-model <id>` | **采用**。零猜测、零私有配置耦合；用户实景（并发窗口跑不同模型）本来就明确知道要钉什么 |
| 启动时快照各家配置文件 | 弃。两坑实锤：codex 读项目级 `.codex/config.toml`（只读用户级会钉错值）；各家配置形态 TOML/JSON/JSONC/sqlite 逐家有界解析=复杂度黑洞 |
| CLI 自报当权威来源 | 弃。自报是运行结果不是用户意图；既有 spec 已规定 observed model 不得进 policy 分支。降级为一致性告警 |
| `-c model=<raw>` 回放（codex） | 弃。TOML 裸值类型陷阱实锤（`model=true` → boolean → config 加载失败） |

## 硬约束

1. **前置依赖与顺序**：c9f4e7a2 四件套先落地（同改 agent-invoke.ts；t4 以 c9 t2
   修后 argv 为失败分类基线）。本 plan 内顺序 **t5（spec 成文）→ t1 → t2 → t3 →
   t4 → 末尾 validate**；域 A（t1-t3）与域 B（t4）可分别提交。
2. **显式优先、零猜测**：不读任何 adapter 私有配置；自报不当权威；未确认的字段
   语义不猜（codeagent modelID）。
3. **无 pin 零变化**：不传 flag 时全部 adapter argv、金丝雀 receipt 与采信行为
   与现状逐元素/逐分支一致，无新日志噪音。
4. **pin 贯穿全部调用点与消费面**：正式 phase 与金丝雀调用共用同一 pin
   （runGoalPreflight 的 binary-gate 构造刻意除外并断言）；重探判定、采信判定与
   **五处金丝雀消费面**（image_input / OCR / tool_read / LKG / profile 门禁）
   共用同一身份谓词（防 07-24 两尺打架复发，防旧缓存绕道流入策略）。
5. **不破坏既有关注点分离**：`isVisionCanaryFresh`=新鲜度、
   `canaryAdmissibleForRun`=执行身份，两者职责不合并；pin 相关判定只出现在新增的
   `canaryAdmissibleForExecution` 里。pin 在场时身份=`{runId, modelPin}` 二元。
6. **加固不得变削弱**：中央两处（重探判定/三轴 resolver）**始终**带 run 绑定，
   无 pin 时等价现状；只有五处旁路才用 `!modelPin ||` 短路保持零变化。任何让
   中央判定在无 pin 时丢掉 `canaryAdmissibleForRun` 的写法都是回归。
7. **不扩大 scope**：无 pin 时五处旁路逐分支等价现状；"无 pin 下旁路跨 run 采信"
   属既有行为，归 visual-capability-truth change 的消费面收口，本 plan 不抢。
8. **claude/codeagent 对称不破**：继续复用同一 argv 构造函数，只允许 binary 不同；
   带 pin 与不带 pin 都要有对称性断言。
9. **单点裁决**：final pin 只在 `resolveFinalModelPin()` 一处产生，位置在 adapter
   reconcile 之后、身份哈希之前；禁止散落修改。
10. **测试须命中目标分支**：resume 各规则、successor 三态、篡改 drift、告警不 halt、
    模型不匹配触发重探、缓存跳过不分类、答卷无效仍非阻断——每条直接断言；身份字段
    夹具由真实 writer 生成；t4 走真实 `action='probe'` 集成路径。
11. **正则纪律**：t4 签名显式枚举、行首锚定、逐行限长；10KB 长行夹具必测。
12. **不发明新机制**：身份哈希/加载校验/drift/preflight BLOCKER/telemetry 事件/
    既有 binary 门禁 全走既有通道。

## 明确不做

- 自动配置快照 / effective-model resolver（选型表已裁）。
- 新建模型自报解析器（既有 adapter_model_observed 已实现，只复用）。
- codeagent modelID 字段消费（未采样确认前不接）。
- opencode `--variant`、模型名白名单校验、registry 交互式问模型。
- 通用 preflight 错误分类（t4 只覆盖金丝雀 probe 路径的两类新增）。
- 重复实现 resolved-binary 门禁（既有 runGoalPreflight 已覆盖）。
- "快速退出 N 秒"时间阈值（精确签名已足够）。
- in-session attended goal 模型语义（无竞态；非 goal 交互会话不引入 pin）。
- framework.local.json 持久化默认模型字段（显式 flag 已覆盖实景）。

## 验收

- `npm run openspec:validate` 通过（t5 先行成文，末尾复验）；
  `node scripts/check-plan-version.mjs` 通过。
- 单测全绿（`cd harness && npm test`）：t1-t4 各清单用例 + 无 pin 现状逐元素回归；
  codeagent/claude 对称性断言（带 pin 与不带 pin 各一）；pin 注入覆盖正式 phase
  与金丝雀两个调用点。
- t3：pin 在场时金丝雀 receipt 记 pin.value；模型不匹配 → 不采信且触发重探
  （重探判定与采信判定用同一身份谓词，两处各断言）；interactive canary 模型不符
  时不采信；**五处消费面逐一走 `!modelPin ||` 规则**；**三条子进程注入路径**各自
  送达 {runId, pin} 的断言；**端到端两例**（① 模型失配、② 同模型跨 run；均为重探
  非硬失败不写盘 → 旧缓存不影响 image_input/OCR/tool_read/fidelity/pixel_1to1
  门禁）；`isVisionCanaryFresh` 签名与行为未被改动（关注点分离回归断言）；
  **无 pin 回归双断言**：中央两处仍执行 `canaryAdmissibleForRun`（跨 run 缓存
  仍被拒——防 v5 公式的退化回归），五处旁路行为与现状逐分支一致。
- t4：在**真实 action='probe' 集成路径**上，child spawn race 与 unknown-argument /
  config-load-error 升 hard_cli_failure → 首个正式 phase 前 BLOCKER；auth/额度类
  不误升；缓存跳过路径无该保护（如实记录）；既有 binary 门禁行为零变化；视觉档位
  语义零变化。
- 宿主侧（不阻塞本仓提交）：`--adapter-model` 启动 codex goal run → 另窗交互切
  模型 → 后续 phase 模型不漂；claude 家同场景验证 pin_verify_mismatch 告警通道
  （一致时静默、人为失配时有注记且 verdict 不变）。
- 文档：runbook/SKILL 用法句存在，chrys/generic 不支持有一行说明。
