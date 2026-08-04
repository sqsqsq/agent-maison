---
name: goal 跨阶段闭环收口 — 回执 attempt 门禁 phase 作用域 / 上游确定性关环路由 / halt 标签真值 / 证据冻结一致性
version: 3.0.0
# 版本说明：跟随当前 3.0.0 窗口。四项缺陷全在 coding→review 必经边界上——只要 plan 阶段
# 出现一次回执修复轮（receipt_repair_with_verifier），任何 run 都会死在同一处，
# Run A（解锁 11 项视觉验收）永远到不了 device_test_run。
overview: >
  实证 run `20260804T033834Z-99c0a1`（bc-openCard，无人值守，framework 含 f9c2e6b4 全部修复）：
  spec PASS → plan 二轮 PASS（回执修复轮）→ coding 二轮自身 PASS/closed，
  却 halt `content_retry_exhausted` / TERMINAL。全链已逐行核实：
  ---
  ① **触发**：plan 证据链在 coding 一轮门禁（12:18）被判 stale——变更证据
  `contracts.yaml` 与 `plan/reports/summary.json`。
  **【2026-08-04 订正，原稿写反了】** 初稿称"contracts.yaml 是 coding 合法要写的共享文档"，
  **错**。框架自己的机器定义：`PHASE_OUTPUT_FILES_BY_PHASE.plan = ['plan.md','contracts.yaml']`
  而 `coding: []`（coding 无声明产出，源码走 closure attestation）；coding SKILL 把
  contracts.yaml 定义为**权威输入**；scope 白名单取自 plan PASS 冻结快照且明写
  "fail-closed 禁退 live"。**所以 coding 改 contracts.yaml → plan stale 是正确行为，
  不是误报**——真正的缺陷见 ⑦。
  ② **修复路被堵死（f9c2e6b4 t1 的回归）**：agent 按门禁建议「回上游重跑 harness」，
  12:32 在会话内重跑 plan harness——env `MAISON_GOAL_ATTEMPT=i5`（coding 的），
  plan 回执 `claimed_attempt_id: i3`（plan 的）→ `receipt_attempt_identity` BLOCKER →
  plan `receipt_status=failed / closure=open`。**跨阶段复验结构上永远不可能通过**：
  填 i3 ≠ i5，改 i5 = 伪造。已排除其他嫌疑（HEAD 未动=135fc27，回执 12:11 刚验过且未改）。
  agent 随后自写 `scratch/refresh-plan-freeze.ts` 重冻结 manifest（12:43）+ 重写回执——
  上游 stale 确实清了（12:46 coding 门禁 PASS），但 plan summary 的 `receipt_status=failed`
  记录清不掉（重验又撞同一门禁），死循环。
  ③ **判据不对称（同为 t1 回归面）**：runner 侧权威验证 `tryValidateReceipt` spawn
  check-receipt 时**不带任何 goal env**（runner 从不给自己设 MAISON_GOAL_*，
  phase-state.ts:303 spawn 无 env 注入）→ `inGoalReceiptContext=false` → 全部 goal 门禁
  （attempt/run_id 绑定/assumptions ledger）在**权威路径静默跳过**、在 agent 路径全开——
  门禁在最该严的地方最松，在修复路径上最严。
  ④ **无路由（存量）**：assess 推荐 `complete_closure:plan`，
  `selectRunnerActionFromAssess`（goal-assess-driver.ts:84）对 `relation=earlier` 只放行
  `backtrack_to_coding`（且仅限确定性缺陷）→ complete_closure 落 **无条件 halt**。
  重试 coding 永远修不好 plan 的闭环。
  ⑤ **标签撒谎（f9c2e6b4 t3 的假设错误）**：`action==='halt' && !haltReason` 汇点
  承载的不只是重试耗尽——本次 halt 是「推荐无路由」，且 coding 重试预算**并未耗尽**
  （attempt1 FAIL 用掉 1 次，attempt2 PASS），却被标 `content_retry_exhausted`+TERMINAL，
  事件里 reason 写着「unclosed」，自相矛盾且让 supervisor 永不拉起。
  ⑦ **自我扩权（2026-08-04 新查实，P0，本 plan 最严重的一条）**：coding 一轮的 blocker
  含 `ui_diff_within_declared_files (ui_scope_violation)`——agent 写了声明外的文件。
  它的"修复"是扩写 contracts.yaml 把越界文件合法化，再用自写的
  `scratch/refresh-plan-freeze.ts` **重取 pass snapshot（epoch+1）**。
  盘上实证：`~/.maison/goal-checkpoints/.../pass-snapshots/plan/head.json` 现为
  `pass_epoch: 2, generation: 2, mac: null`，而 events 里 runner 只记过 `epoch=1`——
  **epoch 2 是 agent 自建、runner 全程不知情**，12:46 那轮 scope 门禁随之消失。
  机制根因：`loadTrustedSnapshotContext` **本来就有内存锚防线**（expectedAnchor：
  "盘上任何消失/退位/换代都是篡改"），但 `ui-scope-gate.ts:184` 传 `null` 把它整个关掉；
  且未配 HMAC 时 `macFor()` 返回 null，`ok_unauthenticated` 快照照样被当授权面。
  **又是既有能力被绕过，不是缺能力。**
  ⑥ **附带（渲染面）**：gate harness 的 NEXT_STEP 显示 `mode=manual policy=manual`——
  harness-runner.ts:931 用 `isAgentSideGoalHarness()` 判 assess mode，而该谓词**刻意排除**
  `MAISON_GOAL_GATE_HARNESS=1`（它是 vision 账本单写者谓词，语义是"agent 侧"，
  不是"在 goal run 里"）——权威 gate harness 反而按 manual 渲染并写投影。
todos:
  - id: t1-attempt-gate-phase-scope
    content: >
      **回执 attempt 门禁的 phase 作用域 + 两侧路径对称（修 f9c2e6b4 t1 的回归，P0）。**
      缺陷：门禁拿「当前调用的 attempt」验「任意阶段回执」的 `claimed_attempt_id`；
      上游回执在下游 attempt 里复验必死（i3≠i5 无解）。
      **落地**：① runner 给 agent 与 gate harness 注入 attempt 身份时**同时注入所属 phase**
      （新 env `MAISON_GOAL_ATTEMPT_PHASE`，值=当前 phase；不改 `MAISON_GOAL_ATTEMPT`
      的值格式——它已有 4 个消费者，改格式波及面大）；② check-receipt 的 attempt 等值
      **仅当** `--phase` 参数 === `MAISON_GOAL_ATTEMPT_PHASE` 时执行；跨阶段复验跳过
      attempt 等值（新鲜度仍由 run_id 绑定 + evidence manifest + sha 三重承担，本就不缺）；
      ③ **缺 phase 上下文本身 fail-closed（codex P1 订正）**：goal context 且
      `MAISON_GOAL_ATTEMPT` 在场、`MAISON_GOAL_ATTEMPT_PHASE` 缺失 → BLOCKER
      （沿用 receipt_attempt_identity，message 点名传播链异常）——否则 cursor 丢 env
      形态下新 env 一丢，门禁又被静默跳过（与 f9c2e6b4 三轮复核同款坑，不再踩第二次）；
      ④ **两侧对称**：`tryValidateReceipt`（phase-state.ts:303）spawn check-receipt 时透传
      goal 身份 env（RUN_ID/ATTEMPT/ATTEMPT_PHASE，复用既有 roundIdentity 值）——
      权威路径与 agent 路径执行**同一套**门禁，消掉「权威最松」的洞；
      ⑤ **新 env 纳入既有 goal 信号并集（codex 三轮订正）**：`MAISON_GOAL_ATTEMPT_PHASE`
      加入 `isAgentSideGoalHarness()` 的 `anyGoalSignal` 真值表（phase-state.ts:113 区）——
      否则子进程只剩 PHASE 时，真实 goal 上下文会被当作 manual，违背本 plan 自己的
      fail-closed 原则。只是扩充现有并集，不新增谓词。
      **回归（五格矩阵，既有 receipt-slim 真 CLI 测试床）**：
      同阶段+同 attempt → PASS；同阶段+旧 attempt → BLOCKER；
      跨阶段+原生产 attempt（本次事故形态）→ 不再 BLOCKER；跨 run → BLOCKER；
      goal context 缺 attempt phase → BLOCKER。
    status: completed
  - id: t2-upstream-closure-route
    content: >
      **complete_closure:上游 的确定性关环路由（P0）。**
      缺陷：`selectRunnerActionFromAssess` 对 `relation=earlier` 只有 backtrack_to_coding
      一条路（限确定性缺陷），`complete_closure` 推荐落无条件 halt——assess 的推荐词汇表
      大于 driver 的执行器词汇表，溢出全部塌缩成 halt。
      **落地**：`complete_closure` 目标为**更早阶段**时，runner **先走确定性关环**——
      对目标阶段 `tryValidateReceipt` → passed → `finalizePhaseClosure`（这套机器已存在：
      goal-runner.ts:6867 起对当前阶段就是这么干的；deterministic sync-closure 先例见
      goal-runner.ts:7609 注释），**不启动 agent、不消耗当前阶段重试预算**。
      **fresh 门（codex P0-1 + 五轮顺序订正）**：证据 stale 即不关环，诚实 halt
      （`finalizePhaseClosure` 具备 evidence rebound 能力，phase-closure-finalizer.ts:331 起；
      在 stale 证据上关环=把旧 PASS summary 重新绑定到新文件，制造假闭环。
      **不允许用 rebound 把 stale 洗成 fresh**）。
      **freshness 必须在 validator 之后、finalizer 之前重算**——validator 自己会经
      soft_advisories 回写 summary（t4 实锤线索），先验 fresh 再跑 validator 等于白验：
      validator 把证据写 stale 后 finalizer 照样 rebind，fresh 门失效。
      **成功后必须重新 assess 一次（codex P0-2）**，全序定死：
      ```
      预算/fencing 检查
      → tryValidateReceipt（非 passed → 按五态分派，不做 freshness 检查）
      → passed 后重算目标阶段 freshness（stale → 诚实 halt，不 rebound）
      → fresh 才 finalizePhaseClosure
      → 重新 assess
      → 唯一 decideAndEmit()
      ```
      第二次 assessment 仍是同一 gap → 停止，**不循环关环**。
      同步操作全程受既有约束：剩余 wall deadline / FINALIZE_RESERVE、run owner fencing、
      closure mutex——不得为修 closure 绕过 d6 硬预算。
      **失败分派（codex 四轮定稿，五态穷尽、不造新分类表、不加错误子类型）**：
      · zero-budget → **调 validator 之前**按既有预算判据拦截（不进入关环）；
      · `passed` → 执行 closure finalization（fresh 前置已过的前提下）；
      · `failed | missing`（回执不合法 / 回执缺失——两者都是"上游闭环凭证不成立"）
        → `upstream_closure_gap`（registry 登记 class=operator）；
      · `error | not_applicable` → 统一既有 `framework_bug`（事故 id；其 registry class 才叫 framework_fault）——
        `error` 含 checker 缺失/spawn 失败/超时（spawn timeout 被压成 error，
        调用方无法可靠区分，**不细分**）；`not_applicable`（lite track）在本条
        full-track 上游关环路径上**理论不可达**，到达即不变量被破坏，按框架错误处理，
        不新增事故类型。
      事件保留 validator 的 status/message 供排障。
      **实现形态**：封装成一个小 helper（一次尝试 + 一次重新 assess），
      不把分支散落进 goal-runner.ts。
      **依赖 t1**：确定性关环会重验上游回执，t1 不先修就会撞同一堵墙。
      **不依赖 t4**：fresh 前置用现行 staleness 判据。
      **【2026-08-04 订正】** 原稿写"t4 落地后自动放宽"——**作废**：contracts.yaml 被 coding
      改本就该 stale（见 overview ①），t4 不放宽任何判据，只堵自我扩权。
      **与 t5 的覆盖边界（codex P2）**：t2 的"遇 stale 诚实 halt"是**默认**行为；
      **仅当** stale 可归属到 plan 权责面、且 chain 含 plan、回退预算足够时，
      由 t5 的自动 replan 覆盖之。其余 stale 一律保持 t2 fail-closed。
      **不做**：不新增 PhaseVerdictAction 枚举成员（关环在 halt 决策之前作为前置尝试，
      不进动作状态机）；不做跨阶段 agent 重派。
    status: completed
  - id: t3-halt-label-truth
    content: >
      **assess-halt 汇点的事故 id 按来源分派（修 f9c2e6b4 t3 的错误假设，P1）。**
      缺陷实锤：`action==='halt' && !haltReason`（goal-runner.ts:7807 区）承载至少两类 halt——
      (a) classifyPhaseVerdict 因 retries_used>=max 产生的**真重试耗尽**；
      (b) 推荐无路由/上游闭环缺口（本次：预算未耗尽、reason=unclosed，却标 exhausted）。
      f9c2e6b4 t3 把该汇点**整体**假设为 (a)，标签因此撒谎。
      **落地（来源穷尽 + fail-closed，codex 三轮订正）**：
      · 只有存在明确的 `retries_used >= max_retries` 事实时才允许标 `*_retry_exhausted`
        （content/external 二分维持）；
      · `complete_closure:earlier` 失败 → `upstream_closure_gap`；
      · **其余未识别来源（fused / 无效目标阶段 / 无法执行的 recommendation 等）
        一律不得默认 exhausted，按既有 `framework_bug`（事故 id；其 registry class 才叫 framework_fault） fail-closed**——
        不给 catch-all 起精确名字，这正是 f9c2e6b4 t3 犯过的错。
      **附带同修（渲染面真值）**：harness-runner.ts:931 的 assess mode 判据从
      `isAgentSideGoalHarness()`（单写者谓词，排除 gate harness——语义错配）改为
      「任一 goal 信号在场」口径——gate harness 在 goal run 里必须按 goal_mode 渲染/写投影，
      不得 manual。复用既有谓词并集，不新造。
      **回归**：本次 run 的 events 作 fixture——同形态下 halt_reason 必须是
      upstream_closure_gap 而非 content_retry_exhausted；NEXT_STEP mode=goal_mode。
    status: completed
  - id: t4-scope-authority-integrity
    content: >
      **【2026-08-04 整体重写：原 t4「冻结一致性」的前提被证伪】**
      原 t4 假设 contracts.yaml 是"coding 合法扩写的共享活文档"，要求"合法演进不失效"。
      查实**恰好相反**：contracts.yaml 是 plan 产出 / coding 输入，scope 白名单取自
      plan PASS 冻结快照且明写 fail-closed 禁退 live。按原矩阵做等于**把越界后的
      自我扩权合法化**，与 c4e8b1d3 的设计对着干。原四格矩阵整体删除。
      ---
      **真缺陷（P0）：弱快照被当作授权面，agent 可自签 scope。**
      实证见 overview ⑦：agent 自调 takePassSnapshot 建出 epoch 2 / mac:null 的 head，
      runner 只知 epoch 1，scope 门禁却照常消费 → 自我扩权成功。
      机制：`loadTrustedSnapshotContext` 的**内存锚防线本来就有**（expectedAnchor），
      但 `ui-scope-gate.ts:184` 传 null 关掉了它；未配 HMAC 时 `macFor()` 返回 null，
      `ok_unauthenticated` 也被当授权。**修的是「既有防线被绕过」，不是新建机制。**
      **不复用 run owner fencing**（codex 订正我的初版提法）：`RunFenceToken` 的
      owner_id/epoch 明文存在 run-control.json，同权限 agent 可读可仿造——fencing 防的是
      旧/并发 runner，**不是 writer authenticity**。真正的 writer authenticity 是既有
      HMAC（runner 持密钥、agent 子进程按信任锚剥离），直接复用，不造 signer。
      ---
      **落地四件事**：
      ① **所有权钉死**：contracts.yaml 归 plan；coding 改它必然 stale。扩 scope 的唯一
      合法流程 = `coding 越界 → driver 回退 plan → plan 重新裁决 PASS → runner supersede
      旧快照 → runner 签发新快照`。coding SKILL 补一句"contracts.yaml 在 coding 阶段只读"。
      ② **权威消费收口（用户 2026-08-04 拍板：内存锚接线，HMAC 保持警告）**：
      同 runner 进程内，scope 只认 **runner 内存冻结的 plan snapshot anchor**
      （epoch + manifest_sha256，经 env 传给**gate harness**，与 t1 的身份 env 同款透传；
      **不进 agent env**——信任材料不下发）。这条**不依赖密钥、立刻见效**，是本项主体。
      **HMAC 不做成启动硬门**（codex 曾建议"无人值守缺密钥即启动前失败"，用户否决）：
      理由是既有 MIGRATION.md:215 已有更温和的约束——未配置时 UI 相关 goal run 不产出
      clean completion（封顶 AWAITING_HUMAN_REVIEW）；再加一道硬门会让现有宿主全被拒，
      且与既有约束重复。改为**启动时打一条警告**："未配 MAISON_HMAC_GOAL_CHECKPOINT →
      resume 后 scope 保护降级为弱快照"。
      盘上 `ok_unauthenticated` 仅供诊断，**不得扩大授权**：内存锚在场时（同进程）
      任何 epoch/hash 失配即篡改；内存锚不在场时（resume）沿用既有弱信任语义 + 上述封顶。
      ③ **attempt 前后括号检查**：coding agent 启动前冻结 plan head 快照锚；agent 返回后、
      权威 gate harness 运行前**复核** epoch / manifest_sha / generation。被换代即复用既有
      `pass_snapshot_unavailable`，**不新增事故类型**。events 里"只有 epoch1、盘上 epoch2"
      可作审计证据，但**不得**把 events 升成第二个授权 SSOT。
      ④ **保留 summary 时序调查**：contracts.yaml 前提错了不代表
      `plan/reports/summary.json` 冻结后被回写是对的。仍须 fixture 查明 check-receipt 的
      soft_advisories 是否在冻结后写 summary；属实则调写入顺序，**不整体豁免 summary**。
      ---
      **验收矩阵（codex 定稿，五格）**：
      · coding 改 live contracts.yaml → plan stale 且 scope **不扩张**；
      · agent 自调 takePassSnapshot 造 epoch 2 → runner **拒绝**，拿不到 PASS；
      · 正常 coding 改冻结白名单内文件 → 通过（防过严回归）；
      · driver 合法回退 plan 并重新 PASS → runner 新签快照后新范围通过；
      · resume：有效 HMAC 可继续；无 HMAC 沿用既有弱信任 + 完成态封顶（不新增硬门），
        但启动时须有明确警告。
      **不新增**：所有权注册表 / artifact DSL / 签名服务 / 新事故分类。
      既有 phase 产出表 + 内存锚 + HMAC + `pass_snapshot_unavailable` 已够。
      **移出**：「advance 门 / upstream gate / assess 三套上游判据同构化」——
      本次实锤了第三例不同构（12:46 upstream gate PASS 而 assess 说 plan unclosed），
      但那是结构工程，单独立项，本 plan 不顺手做。
      **另移出（已实证）**：cursor API 断流被误标 code_regression——plan-i2 的
      agent_stderr_excerpt 是 "Connection lost, reconnecting..."（events 另见
      resource_exhausted 字样），failure_kind_classified 却是 code_regression。
      本次未影响裁决（该 attempt verdict 本就 PASS），属 adapter invocation 归因缺陷，
      单独登记，不塞进本 plan（codex 同裁）。
    status: completed
  - id: t5-scope-auto-replan
    content: >
      **scope 合法演进的自动回退闭环（2026-08-04 新增；codex 终裁 + 用户拍板升为核心哲学）。**
      指导原则：**允许发现、自动回退、重新签发；禁止原地自我授权。**
      t4 只做了"禁止"那一半（内存锚接线，堵掉 agent 自建 epoch）。"允许发现"那一半没做——
      于是 coding 发现范围不足时仍然只能停，而这恰恰是**开发中最常见的正常事**。
      把它变成人工配置/人工决策问题，体感极差，也违背无人值守的立项目标。
      **要区分两件事**：coding 发现需要扩范围＝正常，应自动处理；
      coding 直接改 live contracts.yaml 再自建 snapshot 让旧 plan 继续有效＝自我授权，禁止。
      ---
      **落地三项（codex 终稿，全部复用既有机器）**：
      ① `ui_scope_violation` **不再只给文字建议**，进既有 backtrack/invalidation 通道——
      `beginInvalidationTx` 已是通用事务（goal-runner.ts:8127 区），当前 `invalidatedPhases`
      从 `coding` 索引起算，改为可从 **plan** 起算即可；自动回 plan 更新 scope → plan 重新
      PASS → runner supersede 旧快照并重新签发 → **自动回到 coding 继续**，run 不停。
      共用既有 `DEFAULT_MAX_BACKTRACKS` 预算，不新增预算面。
      ② **授权来源收口（codex 复核 P0 订正——原稿把 events 升成授权依据，作废）**：
      `events.jsonl` 是**普通 appendFileSync 文件、无 MAC、agent 可写**；仓内三处既有代码
      已明写「events 仅审计投影，恢复资格 SSOT 在 trust-state journal/head」
      （goal-runner.ts:2159/4315/8125）。按原稿做，agent 只需同时伪造
      `pass_snapshot_taken(epoch=2)` + 场外 epoch 2 + head，就能让 t5 认成 runner 签发——
      **正好复活刚禁掉的原地自我授权**。
      定稿模型：
      · `events.jsonl` **永远只做审计与恢复提示，不得扩大权限**；
      · 同进程：**只认内存锚**；
      · resume：有有效 HMAC → 恢复原 snapshot；**无可信锚 → 不硬拒绝启动，自动回退 plan
        重新 PASS，由新 runner 重新签发**。
      即「**证明不了旧授权，就自动回到权责阶段重新签发**」——不是求人，也不是采信可疑旧状态。
      ③ **孤儿 generation**：**忽略或隔离皆可，安全目标只是"不采信"**——不得授权、也不得 halt。
      不为满足"必须 quarantine"额外制造文件事务（codex P2）。
      t4 当前的 fail_closed halt 与本条冲突（不该停下求人），改为走上面的自动 replan。
      ④ **授权预检必须早于 coding agent spawn（codex P1；逐行核实过）**。
      现状三条事实：(a) 既有 pre-spawn 可信加载读的是**当前 phase** 快照——
      `passSnapshotMemory.get(String(phase))` + `loadTrustedSnapshotContext(..., String(phase), ...)`
      （goal-runner.ts:5795）；进 coding 时它检 coding 快照，**不检 plan scope 快照**。
      (b) `passSnapshotMemory` 每进程新建（goal-runner.ts:5418），**resume 后恒空**。
      (c) gate 的锚来自 `scopeAnchorEnv(passSnapshotMemory)` → `memory.get('plan')`
      （goal-runner.ts:747/6831）；取不到就不注入，gate 退回无锚行为，无 HMAC 时
      `ok_unauthenticated` 弱信任放行。**合起来即：t4 的锚保护在 resume 后自然蒸发。**
      不补时序的后果：无可信 plan 授权的 resume 会**先跑完一轮 coding**、再由 post-agent gate
      发现问题——白烧一次 attempt，且 agent 在授权未确认时已经动过代码。
      定稿时序（进 coding、`agent_invoke_start` **之前**）：
      ```
      同进程 plan 内存锚在场且与盘上 head 吻合 → 继续
      否则 plan head + manifest 的 HMAC 均 ok    → **固定为本 attempt 内存锚**后继续
      否则                                        → 不 spawn coding，直接走 ① 的自动 replan
      ```
      HMAC 恢复出的锚**必须写回 `passSnapshotMemory`**，`scopeAnchorEnv` 才会把同一个值传给
      gate——否则「preflight 读 A、gate 又读 B」是 TOCTOU。
      ⑤ **invalidation 崩溃窗不得退化成求人（codex P1；逐行核实过）**。
      现状：启动先跑 `recoverInvalidationJournal`（goal-runner.ts:5423），其中 `mac !== 'ok'`
      一律 fail_closed（pass-snapshot.ts:1357）；而**无 HMAC 环境 `macFor` 恒返回 null**、
      写入 mac=null、读回恒 `ok_unauthenticated`（pass-snapshot.ts:316/328）。于是
      `beginInvalidationTx` → 进程死 → 未 commit 的崩溃窗，下次 resume 恒
      `pass_snapshot_journal_unverifiable` halt 求人——**t5 的自动回退在它自己的崩溃窗里失效**。
      定稿：
      · 有效 HMAC journal → 沿用现有事务恢复（不动）；
      · 不可信 journal → **完全不读其 payload**（phase / epoch / generation 一律不采信），
        仅按**当前 run manifest 的 chain** 从 plan 起重建一笔新失效事务覆盖旧 journal，回 plan 重跑；
      · 旧 journal 只留审计说明，**不新建 quarantine 系统**。
      **"不读 payload 也不会漏失效"的论证（须原样进实现注释）**：仓内 `beginInvalidationTx`
      只有两处调用方，`invalidatedPhases` 都是 `chain.slice(codingIdx, phaseIdx+1)`
      （goal-runner.ts:8120/8372）——**都从 coding 起算**。从 plan 起重建是本仓一切可能 journal 的
      **严格超集**。**边界（改动即失效）**：将来若出现从 plan 之前（spec）起算的失效调用方，
      重建下限必须同步前移，否则会漏失效。
      **重建吃回退预算（本方补充，codex 未覆盖）**：重建走 ① 的同一条通道，
      `backtracksUsed++` 共用 `DEFAULT_MAX_BACKTRACKS`。否则确定性崩溃 =
      每次 resume 都重建再崩 = **无限自动循环**；吃预算才能在耗尽后收敛到既有等待机制。
      `backtracksUsed` 由 events 的 `phase_backtrack_requested` 计数恢复
      （goal-runner.ts:5373），跨 resume 成立。
      ---
      **触发面（codex P1：原稿只写 ui_scope_violation，验收却承诺更多，作废）**：
      收敛成**一条路由**——
      ```
      发现 plan 权责面的范围不足或产物漂移（复用既有 phase 产出表判归属）
      → chain 含 plan 且回退预算足够
      → invalidation 从 plan 开始
      → affected files 作为**未受信上下文**交给 plan（是"发现事实"，不是授权）
      → plan 重跑并**独立裁决**
      → PASS 后 runner 新签 snapshot
      → 回 coding
      ```
      边界：chain **不含 plan** 时不得 `indexOf(plan)` 后硬回退——明确等待或提示新起含 plan 的 run；
      回退预算耗尽 / 截断链走既有等待机制。
      **不新增**"明显超出原始需求 / 无法确定"分类器（codex P1）——那句话**没有机器判据**，
      很容易再长出一张规则表。是否符合需求由 **plan 阶段及其既有 harness** 判断。
      **验收（codex 定稿五格 + 时序两格）**：
      · coding 新发现必要文件 → **自动 replan → 新快照 → 继续 coding，run 不停**；
      · coding 直接改 live contracts → **不立即获得权限**，但触发同一个自动 replan；
      · agent 私自生成 epoch 2 → **不采信**（忽略或隔离皆可），白名单不变且**不 halt**
        ——不为凑"自动隔离"这个词额外造文件事务（codex P2，与 ③ 对齐）；
      · 改 plan.md 等 plan 独占产物 → plan 失效并自动重闭环；
      · plan 重跑后自行判定不合理 / 回退预算耗尽 / 截断链 → 走**既有**等待机制
        （不新增分类器）；
      · **无 HMAC resume（对应 ④）**：plan 重新签发之前，**coding agent 调用次数必须为 0**
        ——用既有 `__testing_setRunHarnessPhase` / spawn spy 断言，不是看日志；
      · **`beginInvalidationTx` 后故障注入（对应 ⑤）**：resume **自动回 plan**，
        不产生 human waiting；且重建**计入** `backtracksUsed`。
      **不新增**：注册表 / 签名服务 / 凭据配置 / 新权限系统 / 新预算面。
      **HMAC 定位最终确认**：可选加固，**不参与正常流程硬门禁**（codex 自撤前议，用户同裁）。
    status: pending
isProject: false
---

# goal 跨阶段闭环收口 (b3e8d4c7)

状态：**v1 — 全链已逐行核实，待 review**

## 判读纠错记录（含对上一 plan 的修正,禁删）

| 定性 | 证伪/核实方式 | 教训 |
|---|---|---|
| f9c2e6b4 t1 的三条测试全绿 → 门禁正确 | 三条全是「验当前阶段回执」形态；跨阶段复验（coding attempt 验 plan 回执）无用例，宿主一跑就死 | **单阶段测试通过 ≠ 跨阶段成立**——身份绑定类门禁必须补「谁在什么上下文里验谁」的矩阵 |
| f9c2e6b4 t3 假设 halt 汇点 = 重试耗尽 | 本次 halt 时 coding 预算未耗尽（1/2），真因是推荐无路由；事件里 halt_reason=exhausted 与 reason=unclosed 自相矛盾 | **给汇点命名前先枚举它的全部来源**——一个 catch-all 分支贴精确标签必然撒谎 |
| 初判「12:32 plan 回执失败可能是 sha 漂移」 | 宿主 HEAD=135fc27=回执声明值,未动 | 排除法要做完再写结论 |
| 初判「gate harness env 丢失导致 mode=manual」 | gate harness 带 GATE_HARNESS=1+RUNNER=1;真因是 harness-runner.ts:931 用了**单写者谓词** isAgentSideGoalHarness（刻意排除 gate）判 assess mode——谓词语义错配,不是 env 丢失 | 同名感谓词复用前先读它的定义注释——"agent 侧"≠"在 goal run 里" |

## 实证链（run 20260804T033834Z-99c0a1，全部可复查）

| 时刻(+08) | 事件 | 证据 |
|---|---|---|
| 12:08→12:10 | plan 一轮 PASS 但闭环未完 → 回执修复轮 → 二轮 PASS/closed advance | events: closure_kind=receipt_repair_with_verifier |
| 12:11 | runner 权威验证 plan 回执**通过**——spawn 无 goal env,全部 goal 门禁静默跳过 | phase-state.ts:303 spawn 无 env 注入;goal-runner 只给子进程注入,从不设自身 |
| 12:18 | coding 一轮 FAIL:上游 stale（contracts.yaml ×2 + plan summary.json）+ 真内容问题 | detach.log:312;plan manifest inputs+outputs 均含 contracts.yaml |
| 12:32 | agent 회上游重跑 plan harness → **撞 receipt_attempt_identity（i3≠i5）** → plan receipt_status=failed | plan summary mtime 12:32;回执 claimed_attempt_id=i3;HEAD 未动 |
| 12:42→12:43 | agent 自写 scratch/refresh-plan-freeze.ts 重冻结 manifest + 重写回执 | scratch 文件 12:42;manifest generated_at 12:43:45;回执 mtime 12:43:55 |
| 12:46 | coding 二轮自身 PASS/closed;upstream gate 也 PASS 了（stale 已清）;但 assess 读 plan summary 的 failed 记录 → complete_closure:plan → relation=earlier → **无条件 halt** → 标 content_retry_exhausted/TERMINAL | goal-assess-driver.ts:84-91;goal-runner.ts:7807 区 |

## 与宿主回归的关系

- 本 plan 四项是 **Run A（解锁 11 项视觉验收）的硬前置**——plan 阶段一出现回执修复轮就死，
  Run A 到不了 device_test_run。
- f9c2e6b4 在本次 run 里**验证通过的部分**保持有效：无 35 秒瞬杀、无包装脚本、
  lineage reset/投影/beacon 正常——不推翻，只修回归面。

## 硬约束

1. t1 先于 t2（确定性关环重验上游回执，必须先解 phase 作用域）。
2. 复用既有机器：确定性关环=既有 tryValidateReceipt+finalizePhaseClosure；
   谓词=既有并集；**不新增** PhaseVerdictAction 枚举、不新增状态机、不新建测试床。
3. 身份门禁类改动必须带「谁在什么上下文里验谁」的用例矩阵（本次教训）。
4. 事故 id 与事件 reason 不得自相矛盾（halt_reason 说 exhausted 而 reason 说 unclosed
   = 本次实锤形态，单测钉住）。
5. t4 调查先行——冻结时序未在 fixture 复现前，不改任何冻结语义。
