---
name: spec 阶段闭环阻断根治（需求 provenance + blocked 可诊断投影）
version: 3.0.0
# 版本说明：跟随当前版本窗口 3.0.0（用户 08-10 裁定"放在 3.0.0 解决"）。
# 已发的 3.0.0 包（08-08 构建）带此缺陷，修完走既有发布流程重出包，版本号听用户。
# 实施顺序：t1 → t2 → t3。
overview: >
  宿主实锤（SimulatedWalletForHmos，08-10）：**fresh** 手动执行 `/spec` 走 L2 完整流程
  （无 goal run 身份、且 feature 下没有遗留/升档来的 `change.md`）时，script-report
  39 项 33 PASS/3 WARN/3 SKIP、0 BLOCKER/0 FAIL，summary.verdict 仍是 INCOMPLETE，
  check-receipt 以 `slim_summary_not_pass` 拒绝闭环，重跑多少次都一样。本仓 HEAD
  实测复现：capability_spec_requirement blocked → functional 轴 UNVERIFIED →
  projected INCOMPLETE / release BLOCKED。
  根因是**声明与实现不匹配**：contract 声明 spec 需要 requirement 且 `on_missing: fail`，
  而 provider `derive.requirement` 只认 goal 入参与 lite 轨 `change.md`——阶段驱动的
  手动入口拿不到用户需求，却被判成"需求真的缺失"。
  域 A（t1）：**扩展既有 fidelity-intent SSOT**（不新建平行状态）——加一个
  `requirement_provenance` 字段记录"这次的需求是不是用户显式给的"，provider 认它作为
  阶段驱动路径的来源。需求变了就重跑 Step 1 由 initializer 重新签发 SSOT，旧 closure
  因该文件变化自然 stale（既有 closure 血缘已消费 attempt dependencies），**不做**源文件
  路径追踪、双重哈希、实时验源那套防篡改式完备。
  域 B（t2）：blocked **保持是 pre-check fact，不产 CheckResult**（既有契约不动），
  改为把已有 `capability_resolutions` 投影到 agent 真正读的面：readiness_signals +
  next_action + assess 既有 failed gap 的 detail + merged-report 明细。顺带修 `quality_axes_projection_mismatch`
  在此场景的必然误报（用投影前后的因果标量归因，真派生缺陷仍照报）。
  域 C（t3）：补测试盲区（现有 spec 用例全部显式传 requirement=goal 模式）+ OpenSpec
  只 ADDED 成文 + 文档 + 宿主热修回撤指引。
todos:
  - id: t1-requirement-provenance
    content: >
      给既有 fidelity-intent SSOT 加需求 provenance，让阶段驱动路径有一个真来源。
      【现状事实】`capability-resolution.ts:167-181` 只有两个分支：`options.requirement`
      与 `change.md`；而 `options.requirement` 的唯一注入口是
      `capability-resolution-entry-input.ts:29-36` 的 `goalRunId` ←
      `harness-runner.ts:697` 的 `MAISON_GOAL_RUN_ID`。手动 `/spec` 三者全空 → absent。
      【为什么复用 SSOT 而不新建文件】`spec/reports/fidelity-intent.json`
      （`fidelity-shared.ts:782-802`）已经具备：唯一 writer、`execution_identity`、
      `requirement_sha256`、tmp+rename 原子重建、`missing/corrupt/valid` 三态恢复语义、
      以及 spec Step 1 的明确所有权。再建一个 `requirement-input.json` 就是平行机制。
      【改动】
      ① `FidelityIntentSsot` 增**可选**字段
         `requirement_provenance?: 'goal_manifest' | 'explicit_cli' | 'intent_fallback'`。
         writer 从此永远写；**字段缺失** = 旧版 doc，按 legacy 兼容（不判 corrupt、也不解锁）；
         **字段在场但枚举非法** → 判 corrupt（半写/篡改不得被当 legacy 混过去）——这样
         "不 bump `FIDELITY_INTENT_SCHEMA_VERSION`"才自洽。
      ①' **裁决放在共享 initializer 的入参层**（已核实：`fidelity-intent-init.ts:8` 原话
         "goal 模式不走本 CLI——goal-runner preflight 在 agent invoke 前调用同一 initializer"，
         把 `goal_manifest` 判定写在该 CLI 里**永远不会执行**）。最小做法：共享
         `FidelityRoutingInitInput`（goal-preflight.ts:563-580）增**必填**字段
         `requirementProvenance: 'goal_manifest' | 'explicit_cli' | 'intent_fallback'`；
         writer **必须写该值**，**不提供默认值、不看环境变量猜**——由 TypeScript 必填参数
         负责防漏接（漏传即编译不过），**不新建层、不加 adapter、不为 initializer 入参
         增加额外运行时校验**（与①的"loader 遇非法枚举判 corrupt"不矛盾：那是**读盘侧**
         对既有 SSOT 的完整性判定，这里说的是**入参侧**不再叠一层校验）：
         · `fidelity-intent-init.ts:84`（phase CLI）→ 只可能传 `explicit_cli`（收到显式
           非空需求）或 `intent_fallback`（只能靠 `collectIntentTextWithPhaseFallback` 兜到）；
           **该 CLI 不得判断或写入 `goal_manifest`**；
         · `goal-preflight.ts:675`（goal preflight）→ `goal_manifest`；
         · `goal-runner.ts:2087`（vision policy 收紧重建，见 :4957 注释）→ `goal_manifest`。
         d7f3a9c4 t3 加的 `modelPin?`（:577-578）保持不动，两者在**同一个 input 里并列**。
         直接调 initializer 的既有单测夹具补上对应 provenance（必填参数即防线）。
      ② `fidelity-intent-init.ts` 增 `--requirement-file`，与 `--requirement` 走**同一个**
         `resolveRequirementInput`（`goal-manifest.ts:451`：已有互斥 fail-closed +
         projectRoot 相对路径解析 + **仅 file 分支**的空内容拒绝 :470-472），不新写解析。
         **注意（codex 三轮实测，我 v4 写错过）：inline 分支在 :458 直接 `return inline`
         —— 不 trim、不查空**，所以 `--requirement ""` / `--requirement "   "` 会原样返回。
         因此判定口径写死：**只有解析结果 `trim()` 非空才算 `explicit_cli`**；显式传了
         空/纯空白 → **CLI fail-fast**（与 file 分支空内容同款处置，不静默降级成
         `intent_fallback` 后借 README/spec 文本解锁）。
         **做法：在 `fidelity-intent-init.ts` 里加一个局部预检，共享 resolver 一行不改**
         （已核实：resolver 的互斥判定是 `inline !== undefined && inline.trim().length > 0`
         （:459），所以 `--requirement "   " --requirement-file valid.txt` 既不互斥也不报空、
         会静默采用 file）。顺序固定为：
         ① 本 CLI 先看原始 flag——用户**显式给了** `--requirement` 但 trim 后为空 → fail-fast
           （即便同时给了有效 `--requirement-file`，也不许 file 分支把这个显式空值盖过去）；
         ② 再交给 `resolveRequirementInput` 做既有的互斥 / 读文件 / 空文件判定。
         **不修改 `resolveRequirementInput` 的既有语义**，也不把这条预检扩到其它 CLI 或
         goal manifest 行为；只补对应回归测试。
      ③ `derive.requirement` 候选顺序：
         goal manifest → **fidelity-intent SSOT** → `change.md`（legacy）。
         SSOT 段判据：`state==='valid'` **且** `requirement_provenance==='explicit_cli'`
         **且** `execution_identity` 等于当前阶段身份（`phase:<feature>:spec`，不跨身份
         导入历史 goal 的残留决策）→ resolved；
         `intent_fallback` / 字段缺失（旧版 SSOT）→ **不接受**，按 absent 继续
         （**不**判 corrupt——加固不得把老工程判成损坏）；
         `state==='corrupt'` → 按 absent 继续（**不**升 invalid，不抢 fidelity 门禁的裁决权）。
      ④ 该段 dependency **只绑 `fidelity-intent.json` 本身**（真实 path + sha256）。
         需求变更 → 重跑 Step 1 → initializer 重新签发 SSOT → 文件哈希变 → 旧 closure
         自然 stale（`phase-closure-finalizer.ts:87-137` 的 `capabilityResolutionEvidenceInputs`
         已在收集 `capability_resolutions[].inputs[].attempts[].dependencies[].path`，
         :186-189 纳入 `productionEvidence().extraInputs`）。**不**记源文件路径、
         **不**存第二份 sha、**不**做实时验源。
      ⑤ 旧 SSOT 不需要迁移也不会死锁：`phaseInitDecision`（fidelity-intent-init.ts:33-51）
         只在 `activeGoalMatch`（有活跃 goal run 且 identity 相符）时才 `reuse`，
         阶段驱动路径恒返回 `init`（"phase-owned 一律幂等重算"）——手动重跑 Step 1
         就会把缺字段的老 doc 重新签发掉。**不写任何回填逻辑**。
      【失败话术】三段全 absent 时 detail 须机器可读且可行动：列出已尝试的三段与关键
      路径，并给两条修复路径（goal 模式经 manifest；手动模式带需求文本重跑 Step 1 的
      `fidelity-intent-init --requirement(-file)`）。不写"框架缺陷"。
      【零变化边界】goal 路径逐元素不变（分支 ① 的空 deps 与 `goal_requirement:<fp16>`
      detail 形态不动）；`change.md` 分支不动，**含"full 轨遗留 change.md 也照样 resolved"
      这一既有行为**（历史 lite 或 L1 升档 feature 正靠它闭环，收紧＝把当前能过的宿主
      打挂，见「明确不做」）。
    status: completed
  - id: t2-blocked-projection-and-causal-mismatch
    content: >
      blocked 可诊断化——**不动领域模型**，只投影已有事实。
      【不做什么，先写死】blocked capability **仍然不产 CheckResult**：
      `capability-resolution.ts:400-412`（只有 resolved 产 check）与
      `assertCapabilityConsumption`（:413-434 的双射）**一行不改**；
      `quality-axes.ts:180-184` 的轴映射不改；check 计数语义不改；
      openspec 既有"pruned/blocked/not-applicable 无 CheckResult"条款不改。
      v3 的 `SKIP`+`BLOCKER` 伪检查方案作废——那是为了"报告里有一行"去改领域模型。
      【失灵一：没人告诉 agent 原因】summary 里其实已经有
      `capability_resolutions`（`harness-runner.ts:1420`），但没有任何一处把它翻译成
      "为什么 INCOMPLETE / 该做什么"。改为投影到 agent 真正读的三处
      （agent 侧循环读 `summary.json`，见 `skills/reference/coding-workflow-detail.md:57`、
      `agents-entry-detail.md:128-129`）。
      **投影必须是全 phase 通用的**（codex 三轮收口）：blocked 可发生在任何 capability，
      通用 signal / next_action / assess gap detail 只展示 **capability id、input id、attempt 来源
      与路径**；requirement 专属的"goal 经 manifest / 手动重跑 Step 1"两条建议只能出现在
      `derive.requirement` 这个 provider 自己的 `detail` 里，不得写进通用投影文案。
      · `readiness_signals` 追加 `capability_input_unresolved`（`status: 'incomplete'`，
        message = capability / input / 已尝试来源，具体修复话术来自该 input 的 attempt detail；
        可选 `source_check` 带 capability id）。**schema 无需改动**（已核 08-11：
        `summary.schema.json` 的 `$defs.readiness_signal` 允许 `{id,status,message,source_check?}`、
        status 枚举含 `incomplete`；`next_action` 是自由字符串无枚举）。
        与既有 `capability_resolution_contract` **不是一回事**：那是 `resolveCapabilityReport`
        抛错时产出的 BLOCKER FAIL check（contract 声明本身坏了，本来就可见）；本信号覆盖的是
        "contract 正常、输入没解析"这条今天完全不可见的路径。
      · `next_action` 新增 `resolve_capability_inputs_then_rerun`（已核无撞名：现存 12 个
        取值里没有 capability 相关的）；
      · `assess` 侧（**按现有结构做，零 schema 扩展**）：现代码 `AssessGap` 只有
        `{phase, kind, detail}`（assess.ts:143-147），`AssessRecommendation.action` 是 7 值
        闭合联合（:149-163），`reason` 由 `kind: detail` 组装（:580），renderer 只渲染
        `action[:phase]` 与 `reason`（assess-renderer.ts:36-44）；而 `verdict !== 'PASS'` 时
        assess **今天已经**产出 `{kind:'failed', detail:'verdict=INCOMPLETE'}`（:546-547），
        `failed → rerun_phase` 也已由 `classifyPhaseVerdict` 固定
        （phase-transition-policy.ts:307-310）。
        所以最小实现只有一件事：**当当前 phase 因 blocked capability 非 PASS、且相关 input
        attempts 均无 `upstream_producer` 时，把这条既有 `failed` gap 的 detail 从泛化的
        `verdict=INCOMPLETE` 丰富为**——capability id、input id、attempt 的 source/path/detail，
        以及"补齐该输入后重跑当前 phase"。`recommendation.action` **保持既有 `rerun_phase`**；
        `reason` 因 `kind: detail` 的既有组装自然带上同一份信息；`assess-renderer.ts` **不改**。
        **不新增**：assess schema 字段 / `owner` / `steps` / gap kind / observed 数组 /
        新 artifact / renderer 新协议。
        `assess.ts:276-333` 的"上游 pruned 传播"（靠 `upstream_producer`）保持不动——derive
        型缺失没有 producer，本来就不该走那条路。
        assess 通用层只转述 capability/input/attempt；requirement 专属修复话术仍只放在
        `derive.requirement` 的 provider detail 里。
      · `merged-report.md` 增一段 blocked capability 明细（人读面，非门禁）。
      【失灵二：mismatch 必然误报】`harness-runner.ts:1377-1390` 把
      `projected_verdict !== report.summary.verdict` 一律当"框架派生缺陷，请回灌源仓"。
      legacy verdict 由 `resolveVerdictFromChecks` 只看 checks 派生、结构上看不见
      capability；projected 含 capability 投影。只要出现 blocked 且无 BLOCKER FAIL，
      两者**必然**不等 → 每次都打这条误导信号（宿主 agent 正是照它去翻 framework 源码）。
      改（因果归因，**不需要深拷贝**——`projectPhaseAdvanceVerdict`
      （quality-axes.ts:327-344）是纯函数，`applyCapabilityResolutionProjection` 原地改
      axes，前后各调一次即得两个标量）：
      ```
      pre  = projectPhaseAdvanceVerdict(axes, …)          // 投影前
      { hasBlocked } = applyCapabilityResolutionProjection(axes, …)
      rawPost = projectPhaseAdvanceVerdict(axes, …)
      post = hasBlocked && rawPost === 'PASS' ? 'INCOMPLETE' : rawPost   // 顶层钳制
      ```
      **`post` 必须是含钳制的最终值**（codex 三轮 P1#2，已核实）：
      `ADVANCE_UNVERIFIED_BLOCKING` 里 visual/asset 的 UNVERIFIED **不**阻断推进
      （quality-axes.ts:162-167），所以 blocked 的是 visual/asset capability 时纯函数仍
      返回 `PASS`；真正保证"任意 blocked ≥ INCOMPLETE"的是 :410 的
      `hasBlocked && projected==='PASS'` 钳制。若拿未钳制的 `rawPost` 做因果比较，
      visual/asset blocked 会得到 `post===legacy===PASS` → 误判成"与 capability 无关" →
      误报照旧发生。（该场景可达：`hasInvalid` 一律 blocked，与 `on_missing` 无关，
      见 :331；applicability invalid 亦然，见 :303-313。）
      **仅当 `pre === legacy` 且 `post !== legacy`** 时差异归 capability → 不报 mismatch，
      落 `capability_input_unresolved`；`pre !== legacy` → 真派生缺陷，**照旧报**
      `quality_axes_projection_mismatch`（blocked 在场也要报）。更严侧落盘逻辑不动。
      【失灵三：next_action 指错】现状 `decideNextAction`（:1570-1621）读 pre-projection 的
      `report.summary.verdict`；capability 驱动的 INCOMPLETE 下 legacy=PASS，于是一路走到
      :1607 的 readiness 分支 → `complete_readiness_warnings_then_continue`，把 agent 直接
      推到那条误报上。
      改：**不要整体换 effectiveVerdict**（:1577 的 INCOMPLETE 分支按 phase 返回
      `device_ready_then_rerun_*`，换了以后 capability 驱动的 spec INCOMPLETE 会拿到
      `device_ready_then_rerun_ut`，比现状更离谱）：
      · :1577 保持读 legacy 并补注释写明其真实语义="device-external 阻塞"（legacy 变
        INCOMPLETE 的唯一路径就是那三条 `areBlockersOnly*External` 例外）；
      · 新动作插在 **blocker 分类链（:1580-1601）与 run_status（:1604）之后、
        readiness（:1607）之前**，且**位置不算保证、必须写成显式前置条件**
        （codex 三轮 P1#3，已核实：:1580-1601 全是 `classification === …` 具名判断，
        未知 classification 的 FAIL blocker 与独立 BLOCKER SKIP 都会穿过去）：
        ```
        blockers.length === 0
        && blockingSkips.length === 0
        && !runStatuses.some(s => s.can_claim_done === false)
        && capabilityBlocked
        ```
        三项缺一不可——真实 blocker/SKIP/run-status 在场时一律不给 capability 动作；
      · :1610/:1613 的 `PASS` 判定改用 effective verdict（capability blocked 时
        effective≠PASS，不得再落 `run_verifier_then_receipt`）。
      【发现的既有瑕疵，本 plan 不动】具名 blocker 链之后没有"通用 blocker 兜底"，于是
      **今天**就存在：未知 classification 的 blocker + 任一 incomplete readiness signal →
      返回 `complete_readiness_warnings_then_continue` 而非 `fix_blockers_then_rerun`
      （:1607 早于 :1620）。codex 建议补通用兜底——**属既有行为改动、超出本缺陷**，
      记录在此待用户裁定，本 plan 只保证新动作不加剧它（靠上面的三项前置条件）。
    status: pending
  - id: t3-tests-openspec-docs
    content: >
      测试盲区收口 + 成文 + 文档 + 宿主回撤。
      【盲区事实】`capability-degradation.unit.test.ts:111-127` 两条 spec 用例**全都显式传
      `requirement`**（goal 模式），阶段驱动路径一条没有——这就是缺陷能发出去的原因。
      【t1 单测】无 goalRunId + track=full + phase=spec；**SSOT 夹具必须由真实 writer
      `fidelity-intent-init` 产出**，不手写 JSON 冒充：
      ① goal manifest 在场 → resolved 且 deps 仍为空（现状逐元素锁）；
      ② `--requirement` / `--requirement-file` 跑过 Step 1 → SSOT `explicit_cli` →
        resolved，且该 input 的 attempt deps 含 `fidelity-intent.json` 的真实 path+sha256；
      ③ **反例组**：只跑 Step 1 但不给需求（走 `intent_fallback`）→ **不解锁**；
        **`--requirement ""` 与 `--requirement "   "` → CLI fail-fast**（不得落
        `explicit_cli`、不得借宽泛文本解锁；这条对准 `resolveRequirementInput` inline 分支
        不 trim 不查空的实测事实）；
        旧版 SSOT（无 `requirement_provenance` 字段）→ **不解锁且不判 corrupt**；
        字段在场但枚举非法（如 `'cli'`）→ **判 corrupt**；
        `execution_identity` 是历史 goal run 而非当前 `phase:<feature>:spec` → **不解锁**；
        SSOT `corrupt` → 按 absent 继续且不升 invalid；
        feature 根只有 `README.md` / 空 `.md` / 调查笔记 / `spec/spec.md` → 都**不解锁**
        （宽泛文本不再是来源，反例锁防将来又被"顺便"加回来）；
      ④ `change.md` 现状不变——**含 full 轨遗留 `change.md` 仍 resolved 的回归锁**；
      ⑤ 三段全无 → blocked，detail 含三段来源与两条修复路径；
      ⑥ `resolveRequirementInput` 互斥 fail-closed 在新入口生效（复用断言，不新写解析）；
        **并补组合例 `--requirement "   " --requirement-file valid.txt` → fail-fast**
        （resolver 自身在此组合下会静默采用 file，:459；必须由本 CLI 的局部预检拦下，
        共享 resolver 不改）；
      ⑥' **provenance 三调用点接线断言**：phase CLI 传 `explicit_cli`/`intent_fallback`、
        `goal-preflight.ts:675` 与 `goal-runner.ts:2087` 各传 `goal_manifest`；
        必填字段导致漏接编译不过（类型层断言 + 三处调用各一例）；
      ⑦ **血缘回归**：带需求跑 Step 1 → 闭环 → 改需求重跑 Step 1（SSOT 重新签发）→
        断言旧 closure 因 `fidelity-intent.json` 变化而 stale（走既有
        `capabilityResolutionEvidenceInputs` → `productionEvidence` 链，不新增机制）。
      【t2 单测】blocked 时：`readiness_signals` 含 `capability_input_unresolved` 且
      **不含** `quality_axes_projection_mismatch`；`next_action ===
      'resolve_capability_inputs_then_rerun'`；assess 的既有 `failed` gap detail 含 capability/input/attempt
      且 recommendation 仍为 `rerun_phase`；**assess 四条断言**：gap.kind 仍为 `failed`、
      `recommendation.action` 仍为 `rerun_phase`、gap.detail 与 recommendation.reason 含
      capability + input + 修复动作、`AssessResult` shape **逐字段不新增**；
      merged-report 有 blocked 明细；
      **契约零变化断言**：blocked 仍产出 0 条 CheckResult、`assertCapabilityConsumption`
      行为不变、checks 计数与 legacy verdict / blocker_count / fail_count 逐项不变；
      **因果归因四例**：(a) 纯 functional blocked（`pre===legacy`）→ 不报 mismatch；
      (b) **blocked 的是 visual / asset capability**（纯函数返回 PASS、靠钳制才 INCOMPLETE）
      → 仍正确归因、不报 mismatch（这条直接锁 `post` 必须含钳制；夹具用 `invalid` 输入
      造 blocked，因为现存 visual capability 都是 `on_missing: prune`）；
      (c) blocked + 人造独立投影缺陷（`pre!==legacy`）→ **仍报** mismatch（真缺陷不得被吞）；
      (d) 无 blocked 的人造 mismatch → 照报；
      **next_action 前置条件五例**：真实具名 blocker + blocked 同在 → 返回真实 blocker 动作；
      **未知 classification 的 FAIL blocker + blocked** → **不**返回 capability 动作；
      **独立 BLOCKER SKIP + blocked** → **不**返回 capability 动作；
      `can_claim_done=false` + blocked → 返回 run_status 动作；
      device-external legacy INCOMPLETE → 仍返回 `device_ready_then_rerun_*`；
      （另：纯 capability blocked → capability 动作。）
      【端到端·走生产接线】临时工程真跑 `harness-runner` spec 阶段（**不设**
      `MAISON_GOAL_RUN_ID`）：
      · 正例：带需求文本跑 Step 1 → `summary.verdict==='PASS'` 且 `check-receipt` exit 0；
      · 反例：**不带 requirement 跑 Step 1**（落一份**合法**的 `intent_fallback` SSOT）→
        `harness-runner` → requirement capability blocked → INCOMPLETE + 诊断三件齐备
        （readiness signal / next_action / assess gap detail）+ check-receipt 仍以
        `slim_summary_not_pass` 拒绝（保护未被削弱）。
        **反例绝不能用"删掉 SSOT"制造**（codex 三轮，已核实）：UI 相关 feature 缺 SSOT 会先被
        `checkFidelityCapabilityPregate`（check-spec.ts:228-233）判 BLOCKER FAIL → 顶层
        FAIL，测不到"合法 SSOT 但非显式需求 → blocked → INCOMPLETE"这条目标路径；
        用 `intent_fallback` 反而直接验中本次新增的 provenance 边界。
      【回归】goal 模式 spec 逐元素不变；lite 轨 change 阶段不变；其它 phase 的既有
      blocked 场景（ut 缺 acceptance）除新增 readiness/next_action/assess 投影外不变。
      【OpenSpec】**只 ADDED，不改既有条款**（blocked-无-CheckResult 那条保持原样）。步骤：
      ① `npm run openspec -- archive "fidelity-intent-auto-routing" --yes`（tasks 11/11）；
      ② `npm run openspec -- archive "capability-degradation-model" --yes`（tasks 25/25）；
         **必须走仓内固定版本**（AGENTS.md:76 是 BLOCKER）；`-y/--yes` 已实测存在于
         `archive --help`，形态与 `.cursor/commands/opsx-archive.md:69` 一致；本次要合并
         delta spec，故**不**带 `--skip-specs`；
      ③ 新建 change（如 `spec-requirement-provenance`），只 ADDED 两条：
         · phase initializer 的显式需求 provenance——阶段驱动路径的 requirement SHALL 来自
           带 `explicit_cli` provenance 且身份匹配的 fidelity-intent SSOT；provenance SHALL
           由 initializer 入参在**每个**调用点显式提供；SHALL NOT 接受宽泛意图文本
           （README/笔记/`spec.md`）或阶段自产物；
         · blocked capability 的可诊断投影——SHALL 经 readiness signal / next_action /
           assess gap detail 表达，且 SHALL NOT 产出 CheckResult（与既有条款一致而非冲突）；
           capability 合法造成的 projected/legacy 差异 SHALL NOT 被报成框架派生缺陷；
      ④ `npm run openspec:validate`（strict）与 `node scripts/check-plan-version.mjs` 通过。
      【文档】spec SKILL 步骤 1 把 `--requirement(-file)` 的因果写明（不给需求文本 →
      spec 阶段无法闭环，别让 agent 去猜）；`docs/concepts/skill-contracts.md` 的 derive
      provider 说明补来源表；goal-mode runbook 一句话说明 goal 路径零变化。
      【宿主回撤】给宿主一段话术：上游修复后把 `contract.yaml` 的 `on_missing` 改回
      `fail`、删掉 `framework.config.json > integrity.drift_allowlist` 里那条具名审批
      （他们走的通道本身是对的），并说明手动 L2 起步须带需求文本跑 Step 1。
      【发布】修完走既有发布流程重出包（打包/校验/manifest 都是脚本自己的事，本 plan
      不写发布工程）。版本号听用户，不擅自 bump。
    status: pending
isProject: false
---

# spec 阶段闭环阻断根治（c8e5b3f1）

状态：**v8 — 简单优先收敛，可开工**

> **d7f3a9c4 落地影响复核（2026-08-11）**：三个提交（27ddaad7 / 3183c189 / 3f4bdc9c）共触及
> 20+ 文件；**与本 plan 有交集的是** `harness-runner.ts`、`fidelity-shared.ts`、
> `goal-manifest.ts`，以及 t1 要接线的 `goal-preflight.ts` / `goal-runner.ts`
> ——后两个 d7 也改过（`modelPin` 相关），但与本 plan 的 provenance 语义**兼容**：
> 新字段与 `modelPin` 在同一个 input 里并列，互不干涉。就本 plan 依赖的语义看
> **只挪行号、无冲突**：harness-runner 的 diff 里没有任何一行触及 `decideNextAction` /
> `projected_verdict` / `readinessSignals`；fidelity-shared 只加了 OCR 金丝雀的 identity 入参；
> goal-manifest 的 +81 行是 `adapter_model_pin` 校验，`resolveRequirementInput`
> （:451/:458/:470-472）逐行不变。本 plan 与 d7f3a9c4 **无依赖关系**，可独立推进。
> 锚点位移：`harness-runner.ts` 后段 +5（1372→1377 等）、前段 +5（687→692）、
> `assertCapabilityConsumption` 418→413；全文已改并用脚本复验 15 个关键锚点精确命中。

## 现场（宿主实锤 + 本仓复现）

| 观测项 | 宿主实际值 | 本仓 HEAD 复现 |
|---|---|---|
| script-report | 39 项：33 PASS / 3 WARN / 3 SKIP | — |
| BLOCKER / FAIL | 0 / 0 | 0 / 0 |
| capability | （summary 里有，无人翻译） | `capability_spec_requirement: blocked`（`on_missing=fail`） |
| functional 轴 | UNVERIFIED | UNVERIFIED |
| summary.verdict | INCOMPLETE | projected INCOMPLETE / release BLOCKED |
| check-receipt | BLOCKER `slim_summary_not_pass` | 同（要求 PASS） |
| readiness_signals | 1 条 `quality_axes_projection_mismatch`（"疑似缺陷回归源头"） | 结构上必然触发 |

影响面：**goal 模式不受影响**；**lite 轨不受影响**；**遗留/升档 feature 意外不受影响**
（历史 lite 留下的 `change.md` 会让 full 轨也 resolved——这就是"有的宿主能过"的原因）；
**fresh 手动 `/spec` 走 L2 必然阻断**（无 goal 身份 + 无 `change.md`），新 feature 全部命中。
已发的 3.0.0 包（08-08 构建）带此缺陷。

## 根因链（逐条已核实）

| 步 | 位置 | 事实 |
|---|---|---|
| ① 声明 | `skills/feature/spec/contract.yaml:8,11` | spec 要 `requirement`，唯一来源 `derive.requirement`，`on_missing: fail` |
| ② 实现 | `capability-resolution.ts:167-181` | provider 只认 `options.requirement` 与 `change.md` |
| ②' 注入 | `capability-resolution-entry-input.ts:29-36` / `harness-runner.ts:692,697` | `options.requirement` 唯一来源是 `goalRunId`←`MAISON_GOAL_RUN_ID` |
| ③ blocked | `capability-resolution.ts:331-335` | absent + `on_missing==='fail'` → blocked（`invalid` 输入与 applicability invalid 则无视 `on_missing` 一律 blocked，:303-313） |
| ④ 放大 | `quality-axes.ts:380-395,410-412` | axis → UNVERIFIED；顶层由 `hasBlocked` 钳制成 INCOMPLETE（visual/asset 的 UNVERIFIED 本身不阻断推进，:162-167）；release BLOCKED |
| ⑤ 拒闭环 | `check-receipt.ts:515-521` | `slim_summary_not_pass`（含 INCOMPLETE 不放行） |

**缺陷精确唯一**：扫全部 7 个 feature contract，full track 里所有 `on_missing: fail` 的
capability 依赖的都是流水线自产 artifact 或 `derive.codebase`（恒可解），**`spec` 是唯一
一个 fail 依赖 `derive.requirement` 的**。修面很窄。

**同类缺口修过一次**：`check-spec.ts:115-119` 注释明写 `collectRequirementIntentText`
只读 goal-run manifest、阶段驱动路径恒空串"正是覆盖缺口的实体"，于是那里补了
`collectIntentTextWithPhaseFallback`。goal-only 需求来源这个 bug class 在 fidelity intent
通道已被识别，capability-resolution 漏了。但**不能照抄它的来源集合**——那套宽泛扫描
服务于意图检测，不具备"权威需求"语义（见选型表）。

**agent 空转的直接机制**：blocked 按设计不产 CheckResult（这条设计正确，不改），而
summary 里的 `capability_resolutions` 没有任何消费方把它翻译成原因与动作；
`quality_axes_projection_mismatch` 又必然误报成"框架派生缺陷请回灌源仓"；
`next_action` 读 pre-projection verdict，把 agent 精确推到那条误报上。t2 修后两者、
并补齐投影，不动前者。

## 选型（固化，防将来重走）

| 方案 | 结论 |
|---|---|
| **扩展既有 fidelity-intent SSOT 的 `requirement_provenance`** | **采用（v4）**。SSOT 已有唯一 writer / 阶段身份 / 需求哈希 / 原子重建 / 三态恢复；只加一个字段，零平行状态 |
| 新建 `spec/reports/requirement-input.json` canonical 记录（v3 方案） | **作废**。与 fidelity SSOT 职责重叠＝平行机制；正文+源路径+双 sha+实时验源属防篡改式完备，超出本缺陷所需 |
| 源文件路径追踪 + 持续验源 + sha 漂移判 invalid（v3） | **作废**。`--requirement-file` 是输入入口不是长期 SSOT；需求变了重跑 Step 1 由 initializer 重新签发，旧 closure 自然 stale（"允许发现、自动回退、重新签发"） |
| `on_missing` 改 `prune`（宿主热修口径） | 弃（仅宿主临时止血）。需求真缺失时静默剪枝，废掉 spec 最该守的那条 |
| provider 硬编码 `RR/prd.md`/`SR/design.md`/`AR/design.md` | 弃。全仓无此声明（`inventory.yaml` 需求类只有 `change@1`），是宿主目录约定 |
| 扫 feature 根 `*.md`/`*.txt` 当来源（v2 方案） | 弃。空文件/README/笔记都能解锁 `on_missing: fail` |
| 接受 `spec/spec.md` 或 `intent_fallback` 文本当来源 | 弃。自产物/意图文本冒充输入＝偷偷废掉门禁 |
| blocked 产 `SKIP`+`BLOCKER` 伪 CheckResult（v3 方案） | **作废**。为"报告里有一行"去改双射/轴映射/计数语义/已完成 OpenSpec 条款＝为展示改领域模型。投影既有 capability report 即可 |
| 归档 + MODIFIED 既有"blocked 无 CheckResult"条款（v3） | **作废**（随上一行）。改为只 ADDED，与既有条款一致 |
| 深拷贝 axes 求投影前后值（v3） | **作废**。`projectPhaseAdvanceVerdict` 是纯函数、投影原地改 axes，前后各调一次即得标量 |

## 硬约束

1. **保护不降级**：`on_missing: fail` 不动；三段来源全无时仍然 blocked、仍然拒闭环。
2. **零平行机制**：需求 provenance 只落在既有 fidelity SSOT；不新建文件、不新建 writer。
3. **领域模型不动**：blocked 不产 CheckResult；双射、轴映射、check 计数、legacy verdict
   派生、既有 OpenSpec 条款一律不改。
4. **可诊断走既有出口**：readiness_signals + next_action + assess（+merged-report 人读面），
   都是 agent 已在读的面（`summary.json` 是 agent 侧 SSOT）。
5. **只认显式非空需求**：`explicit_cli` provenance（**解析结果 trim 非空**）+ 阶段身份匹配
   才解锁；显式空值 CLI fail-fast；`intent_fallback`、缺字段旧 SSOT、跨身份残留一律不解锁，
   且不得把老工程判成 corrupt；字段在场枚举非法则判 corrupt。
6. **归因必须因果且用最终值**：仅 `pre===legacy && post!==legacy` 归 capability，其中
   `post` **必须含 `hasBlocked` 顶层钳制**（否则 visual/asset blocked 会漏判）；
   `pre!==legacy` 的真派生缺陷必须照报（含 blocked 在场时）。
7. **真实 blocker 优先靠显式前置条件，不靠分支位置**：capability 动作要求
   `blockers.length===0 && blockingSkips.length===0 && 无 can_claim_done===false`；
   :1577 的 legacy 语义不得换成 effective。
8. **通用投影不夹带专属话术**：blocked 投影对全 phase 通用，只展示 capability/input/attempt；
   requirement 的两条修复建议只住在 `derive.requirement` 的 provider detail 里。
9. **血缘复用不新建**：只把 `fidelity-intent.json` 绑进 attempt deps，靠既有
   `capabilityResolutionEvidenceInputs` → `productionEvidence` 生效；不接线新东西。
10. **goal / lite / 遗留 feature 零变化**：goal 分支空 deps 与 detail 形态不动；
    `change.md` 对 full 轨仍可解。
11. **验收对准生产接线**：E2E 真跑 `harness-runner` + `check-receipt`；SSOT 夹具由真实
    writer `fidelity-intent-init` 产出，不手写 JSON；**反例不得靠删 SSOT 制造**（见 t3）。
12. **仓内 CLI（AGENTS.md:76 BLOCKER）**：openspec 一律走 `npm run openspec -- …`，
    禁止依赖全局 `openspec`。
13. **不擅自 bump 版本**：plan 归 3.0.0 窗口；发布走既有脚本流程，plan 不写发布工程。

## 明确不做

- 不改 `on_missing` 语义或 contract 声明强度（宿主热修口径不进上游）。
- **不把 `change.md` 收紧成仅 lite 可解**：它对 full 轨可解是既有行为，遗留/升档 feature
  正靠它闭环；收紧＝把当前能过的宿主打挂，属独立议题。
- 不扫 feature 根/子目录找需求文档；宿主的 `RR/prd.md` 这类真源经
  `--requirement-file` 或需求文本内的引用进入 SSOT 的 `requirement_sha256` 计算。
- 不注册 `requirement@1` artifact、不动 `specs/artifact-schemas/inventory.yaml`。
- 不给 blocked capability 造 CheckResult；不改双射/轴映射/计数语义。
- 不做源文件持续验源、不存第二份 sha、不建防篡改链（corrupt → 重跑 initializer 即恢复）。
- 不写旧 SSOT 回填逻辑（阶段驱动路径本就每次 `init`）。
- 不 bump fidelity SSOT 的 `FIDELITY_INTENT_SCHEMA_VERSION`——新字段可选、缺失即"非
  explicit_cli"，不触发 corrupt；**若实施时发现 schema 校验必须收紧才自洽，回来先与
  用户确认再动**。
- 不接线 `capabilityResolutionExtraInputs`（那只是闲置 helper；真正在用的是
  `capabilityResolutionEvidenceInputs`，已接线）。
- **不改共享 `resolveRequirementInput` 的既有语义**（空值预检只做在 `fidelity-intent-init`
  这一个 CLI 里，不扩到其它入口或 goal manifest 行为）。
- **不扩 assess**：不新增 schema 字段 / `owner` / `steps` / gap kind / observed 数组 /
  新 artifact / renderer 新协议；沿用 `failed` gap 与 `rerun_phase`。
- **不为 provenance 新建层**：只在既有共享 `FidelityRoutingInitInput` 加一个必填字段，
  不加 adapter、不加运行时校验、不加环境变量猜测、不落新状态文件。
- 不在本 plan 内改 goal halt 分类、不动 assess 渲染结构。

## 验收

- `cd harness && npm test` 全绿；`node scripts/check-plan-version.mjs`、
  `npm run openspec:validate` 通过。
- t1：七项单测清单逐条命中（含 5 条反例锁与"重签 SSOT 使旧 closure stale"的血缘回归）。
- t2：`readiness_signals` 含 `capability_input_unresolved` 且不含 `projection_mismatch`；
  `next_action==='resolve_capability_inputs_then_rerun'`；assess 的既有 `failed` gap detail 含
  capability / input / attempt，`recommendation.action` 仍为 `rerun_phase`；
  merged-report 有明细；投影文案通用（不含 requirement 专属建议）；**契约零变化断言**
  （blocked 仍 0 条 CheckResult、双射行为不变、legacy verdict / blocker_count / fail_count 不变）；
  **因果归因四例**（functional blocked / visual-asset blocked 靠钳制 / blocked+独立缺陷仍报 /
  无 blocked 人造 mismatch 照报）+ **next_action 前置条件五例**（具名 blocker / 未知
  classification blocker / 独立 BLOCKER SKIP / `can_claim_done=false` / device-external）。
- E2E（生产接线）：无 `MAISON_GOAL_RUN_ID` 手动跑 spec，带需求文本跑 Step 1 → summary
  PASS 且 `check-receipt` exit 0；**不带 requirement 跑 Step 1**（合法 `intent_fallback`
  SSOT）→ INCOMPLETE + 诊断三件套 + check-receipt 仍拒（**不用删 SSOT 制造反例**）。
- 回归：goal 模式 spec、lite 轨 change、其它 phase 既有 blocked 场景（ut 缺 acceptance）
  除新增投影外逐分支不变。
- 文档：spec SKILL 步骤 1 写明"不给需求文本 → spec 无法闭环"的因果与 `--requirement(-file)`
  用法；`docs/concepts/skill-contracts.md` 有 derive 来源表。
- 交付宿主：回撤指引（`on_missing` 改回 `fail` + 删 allowlist 条目 + 手动 L2 起步须带需求
  文本跑 Step 1）。

---

## 实施记录（t1，2026-08-11）

**范围**：本批只做 t1（requirement provenance）。t2（blocked 投影/mismatch 归因/next_action）与 t3 的 t2 部分顺延到批 2；t3 的 t1 部分（单测/OpenSpec/docs）已随本批完成。

**改动**：
- `fidelity-shared.ts`：`FidelityIntentSsot` 增可选 `requirement_provenance`；loader 缺字段=legacy、枚举非法=corrupt；`writeFidelityIntentSsot` 必写入参（不 bump schema）。
- `goal-preflight.ts`：`FidelityRoutingInitInput` 增必填 `requirementProvenance`；`evaluateFidelityTierPreflight` 传 `goal_manifest`。
- `goal-runner.ts`：vision policy 收紧重建传 `goal_manifest`。
- `fidelity-intent-init.ts`：增 `--requirement-file`（共享 `resolveRequirementInput`）+ 局部空值预检（`--requirement ""`/空白 fail-fast）；只传 `explicit_cli`/`intent_fallback`。
- `capability-resolution.ts`：`derive.requirement` 插入 SSOT 段（valid∧explicit_cli∧身份匹配），依赖只绑 fidelity-intent.json path+sha；三段全无的 detail 列来源+两条修复路径。
- 单测 `tests/unit/spec-requirement-provenance.unit.test.ts`（14 例），注册进 run-unit.ts。

**验收命令**：
- `cd harness && npm test` → typecheck 绿 + unit **3192/0**（基线 3178，+14）+ fixtures **44/44**。
- `node scripts/check-plan-version.mjs` → PASS。
- `npm run openspec:validate` → 53 passed / 0 failed。
- E2E（真实 harness-runner + fidelity-intent-init，不设 MAISON_GOAL_RUN_ID）：带需求 Step 1 → summary **PASS** / `capability_spec_requirement` **resolved**（fidelity-intent.json path+sha 绑定）；不带需求 Step 1（intent_fallback）→ summary **INCOMPLETE** / capability **blocked** / requirement **absent**；check-receipt 经 `slim_summary_not_pass` 拒非 PASS。

**偏离说明**：
- OpenSpec 归档 `capability-degradation-model` 失败（MODIFIED header 「Summary 1.2 distinguishes verified closure, assurance, and capability provenance」在当前 `openspec/specs/harness-gates/spec.md` 中已改名为「…verified closure and quality depth」，:212）——属**预先存在**的归档 header 失配，与本批改动无关，openspec:validate 不受影响；留给 t3 全量归档时处理。`fidelity-intent-auto-routing` 已成功归档。
- 未擅自 bump 版本；未建分支；未改既有 openspec 条款（只新增 change）。

**Review 修复（2026-08-11，双 reviewer 意见）**：
- [P1 生产，已修] change.md fallback / absent 分支**无条件**绑定 SSOT 路径（missing/corrupt 以 exists:false 记录）——否则"先经 change.md 形成旧 closure，再签发 explicit_cli SSOT"时旧 closure 永久 fresh。goal 分支仍空 deps。t1-④ 更新为断言 SSOT 路径绑定 + exists:false；t1-⑦ 改为断言"change.md 先形成 → 重签 SSOT → 绑定由 exists:false 翻转 exists:true"（输入级）。
- [P1 测试隔离，已修] CLI spawn 测试不再用固定 `--feature demo`（会写真实仓根 doc/features/demo/）——改用唯一 feature 名并在 finally 精确清理真实输出。
- [P3 文档，已修] openspec proposal 的 plan 文件名改为当前 `spec阶段闭环阻断根治_需求来源阶段驱动回退与blocked可诊断化_c8e5b3f1.plan.md`。
- [P2-1 接线断言，已修] 由源码正则扫描改为**行为断言**：调 `evaluateFidelityTierPreflight` 读回 SSOT `requirement_provenance==='goal_manifest'`；initializer 产 explicit_cli / intent_fallback；CLI 有效 case 落盘 explicit_cli。
- [P2-2 血缘回归] 完整"真产 closure → 重签 → stale 翻转"断言（走 capabilityResolutionEvidenceInputs → productionEvidence 全链）**顺延批 2**（需 evidence-manifest + receipt 链夹具）。
- [P2-3 E2E 落成可重跑用例] 与批 2 的诊断三件套断言同一处，**顺延批 2**。
- 小提示已处理：provider 注释写明 reader(writer 硬编码 :spec) 身份口径不对称、目前仅 spec 产匹配身份。
- 复验：`cd harness && npm test` typecheck 绿 + unit 3192/0 + fixtures 44/44；`check-plan-version` PASS；`openspec:validate` 53/0；测试后 `doc/features` 无泄漏。

**Review 3 修复（2026-08-11，双 reviewer 二轮）**：
- [P1·回归，已修] SSOT 的加载/匹配/依赖**只在 `options.phase === 'spec'` 启用**（capability-resolution.ts `derive.requirement`）——lite change 阶段保留纯 change.md 分支零变化（否则创建 spec SSOT 会让语义未变的 change closure 判 stale，违反 plan lite/change.md 零变化边界）。新增 t1-④' lite change 回归锁（SSOT 存在也不影响 change deps）。
- [P2·测试路径，已修] CLI 清理路径改用 `detectRepoLayout(__dirname).projectRoot`（与 CLI 内部同源，standalone/consumer 双布局正确；原 FRAMEWORK_ROOT 在 consumer 会清错到 <root>/framework/doc/...）。
- [P2-1·goal-runner 覆盖，已修] 第三个调用点 `resolvePhaseCapabilityAdvisory`（vision policy 收紧重建）加行为断言：造 capability snapshot vision.verdict=true + live 盲 → 触发收紧重建 → 读回 SSOT = goal_manifest。
- [P2-2·CLI intent_fallback，已修] t1-⑥ 补一次不带 requirement 的 CLI 调用 → 读回落盘 = intent_fallback（证明"CLI 在无需求时选 intent_fallback"，而非仅 writer 持久化给定值）。
- [P2-3·E2E 落成用例] 与批 2 的诊断三件套断言同一处，**顺延批 2**。
- 意见1 已**收回**"批 2 建专属 closure/receipt 全链夹具"要求：phase-closure-finalizer 既有测试已证"missing dependency → 进入 closure → 文件出现 → stale"，本批 t1-⑦ 证 provider 输出缺失 SSOT dependency——两者组合已够，保持简单。
- 复验：`cd harness && npm test` typecheck 绿 + unit **3193/0**（+1 lite change 回归）+ fixtures 44/44；`check-plan-version` PASS；`openspec:validate` 53/0；测试后 `doc/features` 无泄漏。

**Review 4 修复（2026-08-11）**：
- [P2·测试假阳性，已修] goal-runner 行为断言补 `execution_identity==='r-prov-runner'`（旧 SSOT 是 r-prov-goal）——仅凭 provenance=goal_manifest 会被前置 evaluateFidelityTierPreflight 写的旧 SSOT 误通过；现在能确证第三个调用点确实重签了 SSOT。
- [P3·文档同步，已修] openspec tasks.md 单测计数 14→15 例、验收 unit 3192→3193，并补 lite change 回归锁说明。
- 复验：`cd harness && npm test` typecheck 绿 + unit **3193/0** + fixtures 44/44；`check-plan-version` PASS；`openspec:validate` 53/0；测试后 `doc/features` 无增量（仅预存 demo-feature）。