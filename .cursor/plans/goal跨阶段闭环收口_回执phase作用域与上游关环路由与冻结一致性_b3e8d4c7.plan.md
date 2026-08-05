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
      **落地五项 ①–⑤（全部复用既有机器；①②③ 为原三项，④⑤ 为 review 补的时序缺口）**：
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
      mem = passSnapshotMemory.get('plan')            // { epoch, memoryDigest:{ manifestSha256, fileHashes } }
      expectedAnchor = mem                            // loader 要的是 { epoch, manifestSha256 }——须显式投影
        ? { epoch: mem.epoch, manifestSha256: mem.memoryDigest.manifestSha256 }
        : null
      ctx = loadTrustedSnapshotContext(projectRoot, feature, runId, 'plan', expectedAnchor)

      ctx.kind !== 'active'                                        → 不 spawn，走 ① 自动 replan
      expectedAnchor === null ∧ (headMac≠'ok' ∨ manifestMac≠'ok')  → 同上
      diffFrozenAgainstManifest(..., ctx.manifest) 非空             → 同上
      否则 → 用**同一个 ctx** 固定本 attempt 内存锚，spawn coding
      ```
      **两条信任路径必须收敛到同一次 loader 调用（codex P1）**：同进程由**内存锚**担保
      （传入 `expectedAnchor` 时 loader 已内建「盘上消失/退位/换代即篡改」，
      pass-snapshot.ts:919-926，所以 `kind='active'` 就意味着锚已核对，无需另写比较）；
      resume 时 `expectedAnchor` 为 null，改由**两个 MAC** 担保。两条路径消费的是
      **同一次返回的 `ctx.manifest`**——不存在「先比 head、再重新读另一份 manifest」的 TOCTOU。
      **为什么同进程分支也必须过 loader（已核实）**：`passSnapshotMemory` 只存
      `{ epoch, memoryDigest:{ manifestSha256, fileHashes } }`（goal-runner.ts:5418 /
      pass-snapshot.ts:644），**不含完整 manifest**；而 `diffFrozenAgainstManifest` 的
      **added 判定要 `manifest.watched_roots`**（pass-snapshot.ts:1029），仅凭 fileHashes
      判不出来。所以「内存锚够用、不必读盘」是错的。
      投影不是可省的写法问题（codex P2）：内存 map 存的是 `memoryDigest` 结构，
      loader 的 `expectedAnchor` 只要 `{ epoch, manifestSha256 }`，直接整体传入是类型错误。
      **仓内已有同款投影两处可照抄**：goal-runner.ts:5805（既有 pre-spawn 加载）与
      `scopeAnchorEnv`（goal-runner.ts:753）——别再写第三种形状。
      **固定内存锚时不得再读第三次盘**：直接由 ctx 折出——`epoch = ctx.head.pass_epoch`、
      `manifestSha256 = ctx.head.manifest_sha256`、`fileHashes` 由 `ctx.manifest.files` 折出，
      与 `takePassSnapshot` 产出的 memoryDigest 同构（pass-snapshot.ts:644）。
      **恢复条件必须复用 `loadTrustedSnapshotContext()`，不得手写"两个 MAC 都 ok"**
      （codex P1；已核实其 `active` 分支**本来就返回 `headMac`/`manifestMac`**，
      pass-snapshot.ts:888-899，所以这是**减法**不是加法）。只看两个 MAC 会漏掉：
      合法 MAC 的**已 supersede** 快照（state≠active）、project/feature/run/phase **绑定失配**、
      head↔manifest 的 **sha 绑定失配**、以及必需 frozen 产物的**完整性对账**——
      这些判据都已在该函数里，重写一遍只会漏。
      HMAC 恢复出的锚**必须写回 `passSnapshotMemory`**，`scopeAnchorEnv` 才会把同一个值传给
      gate——否则「preflight 读 A、gate 又读 B」是 TOCTOU。
      **③ 这一步不可省（codex P1；核实后缺口比 codex 描述的更宽）**：
      `loadTrustedSnapshotContext` 只证明「**快照本身**可信、绑定正确、存储完整」，
      它读的是快照目录里的 `manifest.json`，**从不去哈希宿主 live 的 plan.md / contracts.yaml**
      （pass-snapshot.ts:983 直接返回 active）。live 内容比对是另一个函数
      `diffFrozenAgainstManifest`（pass-snapshot.ts:995）的职责，而 goal-runner **早已 import 它**
      （goal-runner.ts:184），只是接错了时机——唯一调用点在 **post-agent** 的
      closure-only 块（goal-runner.ts:6710）。
      **更宽的一格**：那个调用点吃的是**当前 phase** 的 `trustedSnapshot`；而普通 coding
      attempt 根本没有 coding 快照（`kind='none'`），整块被跳过。**即：一次普通 coding attempt
      期间，plan 冻结面的 live 漂移在 spawn 前后都没有任何地方在比。** 所以这不只是
      「先跑一轮再发现」，而是「本来就没在比」。
      **有 diff 时不必先 restore**：`restoreFrozenFromSnapshot` 在无内存锚的 resume 面
      （tier=`resume`）可能被拒，那会把「自动回退」重新变成求人；而 replan 本来就会重出
      plan 产物并由 runner 重新签发，restore 是多余动作。直接 replan，drift 文件按 ① 作为
      **未受信上下文**交给 plan。
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
      **"不读 payload 也不会漏失效"的论证（须原样进实现注释）**——
      ~~【实施前调查结论，已被后续重构取代】仓内 `beginInvalidationTx` 只有两处调用方，
      `invalidatedPhases` 都是 `chain.slice(codingIdx, phaseIdx+1)`，都从 coding 起算~~。
      **现行版本（chip 修复后，事务入口已统一）**：生产侧一切失效事务都经
      `runInvalidationTx`（utils/invalidation-tx.ts），三个调用点的失效**下限**为
      coding / coding / plan，均不早于 plan，故从 plan 起重建**覆盖**一切可能的 journal
      （超集或相等——scope replan 自身的失效区间就是 plan→链尾，那一档是相等）。
      其中授权/漂移回退那处字面上写作 `codingIdx >= 0 ? codingIdx : 0`，像是能落到链首（spec），
      但该分支**不可达**：进入它要么是 authorized_backtrack（截断链在更早处已 halt
      `authorized_mutation_requires_full_chain`），要么是 `decide()` 判出的 recover——
      而 `chain_has_coding_review === false` 时 `backtrackBlocked` 直接拦下
      （adjudication.ts:443），不返回 recover。故执行到失效时 chain 必含 coding。
      **边界（改动即失效）**：新增调用点的下限若早于 plan，或上述 chain 守卫被放宽，
      重建下限必须同步前移，否则会漏失效。
      **重建吃回退预算**：重建走 ① 的同一条通道，`backtracksUsed++` 共用
      `DEFAULT_MAX_BACKTRACKS`。否则确定性崩溃 = 每次 resume 都重建再崩 =
      **无限自动循环**；吃预算才能在耗尽后收敛到既有等待机制。
      **预算保证只能声明到这个强度（codex P1 订正——上一稿"跨 resume 成立"是我方过度声明）**：
      `backtracksUsed` 从 events 的 `phase_backtrack_requested` 计数重建
      （goal-runner.ts:5373），而本 plan 自己已经认定 `events.jsonl` **无 MAC、agent 可写**。
      两者不能并存：agent 删旧事件即重置预算（可无限自动回退），伪造事件即提前耗尽（可致停机）。
      如实分档——
      · **同进程**：`backtracksUsed` 是**硬预算**；
      · **跨进程（resume）**：**无论是否配置 HMAC**，events 派生的预算恢复一律是
        **best-effort 恢复提示**——普通崩溃可恢复，**不具备抗 agent 篡改的保证**；
      · **HMAC 保护的是 pass-snapshot 与 vision trust 状态，不保护 events**
        （codex P2 两轮订正。第一稿"配 HMAC 后才谈得上跨进程强连续性"结论错；
        第二稿结论对但**论据错**——我写"唯一签名消费者是 pass-snapshot.ts 的 `macFor`"，
        事实是 `MAISON_HMAC_GOAL_CHECKPOINT` 同时被 `VISION_CHECKPOINT_HMAC_ENV`
        消费（goal-runner.ts:2098，另有 vision checkpoint / head / HWM 等约 10 处引用）。
        正确论据是**消费面的边界而非唯一性**：`events.jsonl` 的**写入与读取链从不使用该 HMAC**
        ——写是裸 `appendFileSync`，读是 `loadEventsJsonl` + 会话段过滤，全程无签名/验签。
        因此配了 HMAC，events 派生的预算计数照样是 best-effort）；
      · journal 崩溃恢复**本次仍在内存里消耗一次预算**，但**不宣称** events 提供可信硬上界。
      **预算计数的抗篡改连续性不在本 plan 解决**，也不为这句话新增预算账本。
      **本 plan 不解决这个问题**：要"无 HMAC 也具备抗篡改的跨进程硬预算"，客观上必须新增
      可信写者或签名计数器，与"保持简单 / HMAC 非硬门"直接冲突。它是**既有系统的共性属性**
      （重试计数、棘轮、对账期望集同样从 events 派生），不是 t5 引入的，不在 t5 里偷偷扩张。
      注：`loadAuthoritativeEvents` 的 "authoritative" 指**按会话段剔除 dry-run 的正确口径**
      （goal-runner-phase.ts:730-736），**不是密码学可信**——别被这个名字误导。
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
      **验收（codex 定稿五格 + 时序四格：负向 / 正向对照 / live 漂移 / 崩溃恢复）**：
      · coding 新发现必要文件 → **自动 replan → 新快照 → 继续 coding，run 不停**；
      · coding 直接改 live contracts → **不立即获得权限**，但触发同一个自动 replan；
      · agent 私自生成 epoch 2 → **不采信**（忽略或隔离皆可），白名单不变且**不 halt**
        ——不为凑"自动隔离"这个词额外造文件事务（codex P2，与 ③ 对齐）；
      · 改 plan.md 等 plan 独占产物 → plan 失效并自动重闭环；
      · plan 重跑后自行判定不合理 / 回退预算耗尽 / 截断链 → 走**既有**等待机制
        （不新增分类器）；
      · **无 HMAC resume（对应 ④，负向）**：plan 重新签发之前，**coding agent 调用次数必须为 0**
        ——必须用 `__testing_setInvokeAgent`（goal-runner.ts:738）做 **phase 级调用断言**。
        **不得用 `__testing_setRunHarnessPhase`**（codex P2）：它只能观测 gate/harness 有没有跑，
        证明不了 agent 没被拉起——"agent 已跑、harness 没跑"照样假绿；
      · **有效 HMAC resume（对应 ④，正向对照——缺了它上面那条负向可能全绿于错误实现）**：
        **不回退 plan**、coding 正常启动、且 **gate 收到的 plan anchor 与 preflight 固定的是同一个**
        （断锚值相等，不是只断"有锚"）。没有这格，把实现写成"所有 resume 无脑 replan"也能过；
      · **有效 HMAC 但 live 已漂移（对应 ④③，codex P1）**：快照 MAC 全 ok、`kind='active'`，
        但宿主 live `contracts.yaml` 或 `plan.md` 与冻结面不一致 → **coding agent 调用次数为 0**，
        自动回 plan。**这格必须与上一格共用同一套装置、只差 live 文件一处改动**——
        否则证明不了拦截来自 ③ 的 diff 而不是别的原因；
      · **`beginInvalidationTx` 后故障注入（对应 ⑤）**：resume **自动回 plan**，
        不产生 human waiting；且重建**计入本进程内存里的** `backtracksUsed`。
      **不新增**：注册表 / 签名服务 / 凭据配置 / 新权限系统 / 新预算面。
      **HMAC 定位最终确认**：可选加固，**不参与正常流程硬门禁**（codex 自撤前议，用户同裁）。
      **实施偏差与验收对应见文末「t5 实施偏差与边界」节。**
    status: completed
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

## t5 实施偏差与边界（2026-08-04 完工登记，禁删）

**落地形态**：新增 `harness/scripts/utils/scope-replan.ts`（两个导出：`tryScopeReplan` 回退通道、
`checkPlanAuthority` 授权检查），runner **四处**接线（启动期 journal 重建 / coding **spawn 前** /
coding **agent 返回后、harness 之前** / coding verdict 后的 scope 违规路由）。
未新增注册表、状态机、预算面、凭据配置。

**codex 第二轮 review 补齐的两处 P1（均为真缺口，本方漏做）**
1. **plan 授权检查必须在 coding 的两个边界各做一次**。原稿只做 spawn 前，于是
   coding agent 在**本轮**改掉 `plan.md` / `contracts.yaml` 后，只要 coding gate 仍 PASS
   就能带着漂移的授权面直接 advance 到 review——既有 post-agent 冻结检查只看**当前 phase**
   的 trustedSnapshot，而普通 coding attempt 没有 coding 快照（kind='none'）→ 整块被跳过。
   直接违反本 plan 的验收行「改 plan.md 等 plan 独占产物 → plan 失效并自动重闭环」。
   修法：**同一个函数、同一条 `tryScopeReplan` 路由**在 gate 之前再跑一次，不另建检测器。
   顺带把 `checkPlanAuthorityBeforeCoding` 改名 `checkPlanAuthority`——一个叫 "BeforeCoding"
   的函数在 coding 之后被调用，正是本仓反复踩的误导性命名。
2. **越界文件必须真的进 plan prompt**。原稿只把 `detail/files` 写进事件，
   `buildPhasePrompt` 没有消费方——等于本 plan 自己写的路由「affected files 作为**未受信
   上下文**交给 plan」**没有实现**。测试当时只断了 `coding→plan→coding` 的顺序，
   而集成测试里的 plan 是无条件 PASS 的 mock，恰好掩盖了"真实 plan agent 不知道为何重跑"。
   修法：新增 `buildScopeReplanContextBlock`，措辞刻意只陈述观察、显式标注
   `UNTRUSTED / not an authorization`，并明写"不得因为文件出现在上面就加进去"——
   写成指令就等于让下游给自己授权。跨 resume 从最近一条 `to_phase=plan` 的回退事件恢复，
   **无条件覆盖**（对齐 backtrackCodingContext 的 review 第 10 轮教训）。

**codex 第三轮 review 的 P1（同一条链上的最后一个洞）**
3. **不得把无签名事件原样注入 LLM prompt**。上一版从 `events.jsonl` 回放
   `reason/detail/files` 直接拼进 plan 提示词——而本 plan 自己反复认定 events **无 MAC、
   agent 可写**。于是伪造一条 `phase_backtrack_requested{to_phase:'plan'}`、在 `detail`
   里塞换行指令，就能诱导 plan 扩大 scope：**刚堵死的自我授权换了道门又回来了**。
   贴 `UNTRUSTED` 标签**不是**安全边界。
   修法（比 codex 建议更严一格）：进提示词的上下文**刻意只剩两个字段**
   `{ reason(闭集), files(经校验路径) }`，**没有自由文本**——散文 `detail` 只进事件与控制台
   （那不是 LLM 的输入面），提示词里的说明由 `reason` 查固定文案。
   **两条来源统一净化**，不分同进程/跨 resume：同进程的 `affectedFiles` 也来自
   `diffFrozenAgainstManifest` 对 watched_roots 的目录清点，**文件名由 agent 决定**，
   同样不是可直接拼进提示词的可信输入。
   路径判据：复用既有 `validateProjectRelativePath`（拒绝绝对路径/盘符/`..`/越根）
   + 字符集 `[A-Za-z0-9._\-/]`（**不放行空格、引号、反引号、反斜杠、任何控制字符**——
   换行是注入主载体）+ 单条 ≤200 字符 + 至多 20 条 + 去重；单条不合规**丢弃该条**
   而非整体作废（上下文是辅助信息，少列几条只是提示变弱，放行一条恶意串是权限面被架空）。
   `reason` 不在闭集 → `resolveScopeReplanContext` 返回 `null`，**什么都不注入提示词**
   （files 自然一并不采信——两者出自同一条伪造事件）。
   ~~初版写的是"降为 `unrecognized` 并退回固定的『请自查 git diff』"，**已被下方
   「自查瘦身」第 2 条作废**~~：在没有可信事实时发明一句新指令，仍然是让不可信事件影响 agent。
   合法路径以 ```` ```text ```` 数据围栏渲染，不可被读成 markdown 指令。
   诚实边界：含中文/空格的合法文件名会被丢弃——如实少列，不会误导 plan。

| # | 偏差 | 为什么 |
|---|---|---|
| ② | **无独立代码**——授权来源收口由 ④ 的分支结构承载（同进程=内存锚、resume=HMAC、否则自动 replan） | ② 本就是"不要做什么"（events 永不授权）。events 的权限面一行未动，写的是新的判据而不是新的授权源 |
| ③ | **无独立代码**——孤儿 generation 由 ④ 承接 | agent 私造 epoch2 → 当轮 gate FAIL → **下一次 spawn 前**预检判 `snapshot_untrusted` → 自动 replan。既不 halt 也不采信，且 agent **不会被再次拉起**（预检在 while 循环顶部、spawn 之前） |
| ① | ~~加了防震荡指纹 `seenScopeReplanFingerprints`~~ **已删（见下「自查瘦身」）** | 曾自行加过，plan 未要求；复盘认定是重复机制且会削弱自愈，连同 `scope_fingerprint` 事件字段、resume 回放、`fingerprint` 参数一并删除 |
| ⑤ | **`mac==='invalid'`（真篡改）也走自动重建**，不只 `ok_unauthenticated` | 重建不读旧 payload、只失效不授权，所以在攻击面上同样安全；而"篡改就 halt 求人"正是本条要消掉的形态。篡改事实由 `pass_snapshot_journal_untrusted` 事件如实留痕 |

**验收对应**（unit 3015/0；括号内为用例所在套件）
· ①：`t5① coding 撞冻结白名单 → 自动回退 plan…`（goal-runner-testing-integrity，真 runner 驱动）
· ④负向/正向对照/live 漂移：三格**共用同一装置、只差一处变量**（scope-replan A3/A4/A5 + integrity 三格）
· ⑤：`beginInvalidationTx 后崩溃` 故障注入（integrity）
· 调用次数断言一律用 `__testing_setInvokeAgent` 的 phase 级记录，**未用** `__testing_setRunHarnessPhase`
**变异复验**（每条都实测转红，非推断）：禁用 ④ spawn 前 → 三格 ④ 红、①⑤ 绿；
禁用 ④ **post-agent** → 只 post-agent 那格红；禁用 ⑤ → 只 ⑤ 红；禁用 ① → 只 ① 红；
关掉 live diff → 只 A5/A6 红；commit 提前到事件之前 → 只 B4 红；
**摘掉 plan prompt 交接块 → ① 与 post-agent 两格红**（证明交接不是摆设）；
**回放绕过净化器 → 注入用例红**（该用例特意让 run 停在 **plan** 而非 coding：停在 coding 时
resume 会先由 preflight 产生一份新上下文覆盖伪造的，用例就变成覆盖导致没进提示词
而非净化导致没进提示词，无法判别＝假绿）。
post-agent 那格的判别式特意不用"coding gate 次数"——没有修复时它同样只跑一次
（PASS 后直接 advance），改用 **plan gate 跑了两次**。

**自查瘦身（2026-08-04，用户问「有没有搞复杂」后复盘 + codex 同裁，两处**删掉**）**
1. **防震荡指纹整套删除**（`seenScopeReplanFingerprints` / `scope_fingerprint` 事件字段 /
   resume 回放 / `fingerprint` 参数 / 对应断言）。它**没有**解决无限循环——全局
   `DEFAULT_MAX_BACKTRACKS` 本就负责收敛；它只是叠了第二条规则「同一组 scope 文件只能
   触发一次 replan」。更糟的是**它削弱自愈**：plan 第一次没扩对时，第二次本还有机会重新
   裁决，却被指纹提前拦掉、转去注定无效的 coding retry。
   **边界**：`seenRoundFingerprints` / `seenDriftFingerprints` **不动**——那两个针对
   「完全相同的**不可修复**结果再现」，有明确 terminal 语义；scope 不足是正常演进，不是一回事。
2. **`unrecognized` 兜底块删除**，`resolveScopeReplanContext` 改为返回 `null`。
   合法生产路径只产闭集里那三个 reason；未知只能是伪造 / 损坏 / 不兼容新版事件——
   此时凭空造一句「请自查 git diff」是**在没有可信事实时发明行为**，仍然是让不可信事件
   影响了 agent。正确处理是**什么都不注入**，事件留在日志里供排障。
   同删：`'unrecognized'` 类型成员、固定文案分支、构造器分支。
   已知 reason 但零可信路径（如 journal 重建本就无文件面）→ 只留原因句，不补空围栏、不补新指令。
**净效果**：goal-runner −19 行；模块非注释行几乎持平（223 vs 225——删掉的机制换成了
「为何刻意不做」的说明，这类说明本仓要求保留）。真正的收益不在行数，而在**少一个概念、
少一个事件字段、少一条可能堵住自愈的规则**。

**已知边界**
· 预算跨进程仍是 best-effort（events 无 MAC），与 plan 内声明一致，**本 plan 不解决**；
· 顺带查实**未修**（不属 t5）：既有第二处回退调用点 goal-runner.ts:8386 **先 commit 再落
  `phase_invalidated` 事件**，与 pass-snapshot.ts:1327-1331 定下的「events 先于 commit」不变量相反——
  该窗口内二次崩溃会永久丢失失效事件。第一处（:8150）顺序正确。新模块按正确顺序实现并有专测钉住。
