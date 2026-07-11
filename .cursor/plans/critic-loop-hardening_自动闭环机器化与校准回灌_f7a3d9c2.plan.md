---
name: critic 闭环基础设施加固 — 结构化发现 + 熔断账本 + 回执生产 + 静稳采样 + 校准回灌
version: 3.0.0
# 版本说明：随当前 3.0.0 版本窗口，用户控版本不 bump。
# 前置：plan c6d8f2b4（layout-oracle）rev10 已落地——本 plan 基线=rev10 后代码树
# （rev10：isRoundFingerprintable=计数门"任一屏 must_fix 条数>defects 条数即无资格"，
#   错向安全侧；注释明确把逐条对账留给本 plan t2）。
# 立项动因：codex 置信度评估（2026-07-11）→ 初版 → 三方 review 三轮（rev2/rev3/rev4，
# 均 2026-07-11）。rev4 变化：①t1 轮次模型重构（state_hash 与 round 身份分离——rev3 的
# 轮次键会把跨 attempt 的不变状态永久去重，no_fix_attempt 永远熔不断，codex 阻断项）；
# ②交互态 fuse 诚实收窄（无 attempt 身份 → 同状态重跑不判，只熔"状态变了指纹没变"）；
# ③t4a 提为共享采样器且 flag 隔离（t5 复用，正式链保持旧行为至 t4b 一次性切换）；
# ④t6 FN 归因收窄（系统级 unattributed + human_issue_kind 枚举映射，不宣称按 signal
# 直接归因 FN）；⑤t6b③ 回执触发条件与 t2③ 对齐（跟 candidate 路径，不跟 attest）；
# ⑥summary 回传 row_hash 走显式 schema 字段 visual_round（不裸塞 additionalProperties:
# false 的 summary）。
# rev5 变化（codex 第四轮，两个同源阻断——fuse 裁决是轮次属性、不是执行副作用）：
# ①账本行持久化 decision，duplicate 时**重放裁决**（否则 agent 自跑首检 fuse 落行后，
# 外层 goal-runner gate 撞同 round_key 被判 duplicate no-op，负责 halt 的外层永远
# 看不到 fuse）；②fuse 触发面收窄为结构化谓词 has_actionable_visual_residual 且
# awaitHumanOnly 优先（human_confirm_required 本身是 visual_diff FAIL、candidate-pass
# 可留 minor defects 指纹非空——前缀判断会把"只差人签"抢成 no_progress）；
# ③state_hash 改 base_state_hash（排除 fuse 自身与派生聚合 hit，防反馈环）；
# ④row_hash=sha256(canonicalJson(去 row_hash 行))，canonical 序列化显式规定。
# rev6 变化（codex 第五轮，最后一个阻断+一个钉缝）：①attempt_id 必须跨 --resume 单调
# 唯一——不得用 phase 内 retries+1（resume 时 `let retries = 0` 重置 → 撞旧 round_key
# 被重放 fused=false 吞掉本应的 no_fix_attempt 第二轮）；改用本次 agent invocation 的
# 唯一 invoke_id（agent_invoke_start 落盘后确定），备选=events 回放的全局 invoke 序数
# （totalTurns 同源恢复机制）；②row_hash 补反向校验消费者（goal gate/resume 启动时从
# events 重建期望行集与 ledger 对账，缺行/改行/decision 被改 → integrity FAIL；ledger
# 损坏不得解释成"历史为空"）+ 诚实边界（运行时一致性防护，非对协同篡改双文件的密码学
# 防护）。
# 事实裁定（rev4 更正）：关于 isRoundFingerprintable 的两轮争议双方各对各的快照——
# codex 评 rev9（>0 && ===0，部分转录确实可通过），cursor 评 rev10（计数门已挡"must_fix
# 多于 defects"）。以最终快照 rev10 为准：计数门已挡漏纹轮；**剩余缝=条数凑平但错配**
# （2 条 must_fix + 2 条无关 filler defects 仍 fingerprintable → 熔断吃错配数据），
# t2② 的 must_fix_refs 逐条锚定堵的是这条缝。
overview: >
  【定位（rev2 收窄，三方 review 定调）】本 plan **不新建循环调度器**：不实现独立上下文
  critic/fixer 双 agent、不实现 capture→critic→coding→rebuild→recapture 的状态机调度。
  循环的发起与推进仍由既有机制承载（交互态 SSOT 指令 + goal 态 phase FAIL→retry）。
  本 plan 保证的是四件确定性的事：**转了能被机器观测**（结构化发现+轮次账本）、
  **卡住能被机器熔断**（指纹级 no-progress fuse，与既有粗粒度 signature 熔断整合）、
  **证据能被机器签发与对账**（runner attestation 回执 + T8/must_fix 转录对账）、
  **人工反馈能被机器落账回灌**（visual-confirm CLI 原生 ledger + 校准报告）。
  循环状态机（codex 建议）显式列为后继 plan——本期交付的结构化 findings/账本/回执
  正是它的前置物料，先有料再建机。
  【问题（五缺口）】
  G1 熔断粒度与覆盖缺口——goal 态已有 shouldHaltNoProgress 的 blocker-id 粗熔断，
  缺**指纹级**比对与交互态信号；轮次身份需 state 与 attempt 二维分离（rev4）：
  同 attempt 双写要去重，跨 attempt 的同状态恰恰是要熔断的 no_fix_attempt，不可混谈；
  G2 verified 回执无生产者——claude headless 纯文本无工具记录且 stdout/stderr 混流，
  各 adapter 结构化事件能力参差，须先盘点立契约（结构化事件独立文件）再条件实装；
  G3 T8 发现→回修链路无对账——LayoutFinding 缺 finding_id/elements、defect 缺溯源与
  must_fix 锚点；rev10 计数门后剩余缝=凑数 filler defects 错配（见头注事实裁定）；
  G4 采集非原子 + 判据风险——整图 hash 恒等真机几乎恒假；单 dump 证不了布局稳；
  unstable 沿用原 id 会阻断 candidate-pass 与"避免错位假阳"自相矛盾；
  G5 校准与回灌无机制——D1-D6 人工清单、FN/FP 无落账通道；落账所有者=visual-confirm
  CLI（崩溃可恢复事务）；FN 只能系统级归因，按 signal 归因须经 human_issue_kind 映射。
  【方案】G1→t0 结构化发现 + t1 state/round 二维账本与指纹熔断；G2→t3a 盘点立契约 +
  t3b runner attestation（覆盖全部 P0 finalized 屏截图+crops）；G3→t0 数据结构 + t2
  逐条锚定对账；G4→t4 静稳采样（共享采样器、双 shot 双 dump、unstable 独立 id、flag
  隔离两段上线）；G5→t5 校准 CLI（calibration.json SSOT）+ t6 事务化回灌台账。
  【实施序（rev4，codex 修订：t4a 采样器先于 t5，防两套协议分叉）】t0 → t2 → t1 →
  t3a → **t4a（observe-only 共享采样器，calibration flag 隔离）** → (t5 含⑨ 复用采样器
  ∥ t6) → **中期宿主触点：t5⑨ 实测数据** → t4b（一次性启用新状态语义+降档定参）→
  t3b → t6b/t7/t8 → t9（最终宿主验收）。
  【显式非目标】①循环状态机 / 独立上下文 critic phase 不在本期（后继 plan；OpenSpec
  5.4 只半关）；②不承诺取消 T2 人工终审；③交互态 verified 回执不在本期；④不改 A/B/C
  gate 档位——t5/t6 产出升档评审的数据素材，规则参数待数据累积后由人定；
  ⑤交互态**同状态重跑不自动熔断**（rev4 诚实收窄：无 attempt 身份，幂等吞重跑；交互态
  fuse 只覆盖"状态变了指纹没变"=ineffective_fix；原地重跑仍靠 SSOT 约束）。
  【验收】①fuse 演示：goal 态构造跨 attempt 同状态 → no_fix_attempt 熔断；构造重建后
  同指纹 → ineffective_fix 熔断；同 attempt 双写去重且 **duplicate 重放裁决**（agent
  自跑首检 fuse → 外层 gate 仍得到 no_progress_fuse 并 halt，codex 指定 e2e）；
  candidate-pass+minor defects+只差人签的屏不被 fuse 抢走（awaitHumanOnly 优先 e2e）；②t3a 盘点
  结论落档 + 合格 adapter 的 verified 回执演示（伪造 attestation 被拒）；③T8 hard 未
  转录 / must_fix 漏锚定 → BLOCKER（e2e）；④静稳采样三态 + unstable 独立 id 不阻断
  candidate-pass + t4a flag 隔离下正式链行为不变（单测）+ 双拍实测数据在校准报告；
  ⑤宿主一句话触发校准 → calibration.json+md 落盘；⑥visual-confirm 打回/认可/overrule →
  ledger 事务落账、崩溃恢复 reconciliation（e2e）；⑦低档守恒回归零新增；⑧tsc/全量
  unit+fixtures/openspec 全绿；⑨宿主复验合并执行 c6d8f2b4-t11 与本 plan 验收。
todos:
  - id: t0-structured-findings
    content: >
      【G3 前置·数据结构先行】
      ①LayoutFinding 扩展：新增 finding_id 与 elements: string[]（结构化元素引用，替代
      note 散文内嵌）；B 类（B1/B2/B3）尽力补 bbox（可定位节点 union；不可定位留空注记）。
      **finding_id 稳定性约束**：id=`hash(screen_id|signal|elements|bbox_bucket)` 前缀，
      emit 时 elements 必须已最终填好、禁止先空后补（否则跨轮 id 漂，对账全废）；B 类
      无 bbox 时以 signal+elements 构 id。单测锁死：同发现两轮同 id、bbox 桶内抖动不变
      id、elements 顺序无关。
      ②VisualDiffDefect 扩展：可选 source {producer: 'T8', finding_id, signal}（T8 转录
      溯源锚点）+ 可选 must_fix_refs: number[]（该屏 must_fix 数组下标——回修指令逐条
      结构化锚点，t2② 消费）。schema 校验同步（可选字段，legacy 兼容）。
      ③check 结构化返回：checkVisualDiff 附结构化 payload（当轮 fingerprints[]、T8
      findings[]（含 finding_id）、hit ids）供 t1 runner 账本与 goal-runner 消费，禁止
      下游从 details 文本正则抠 [fingerprints]。边界：structured payload 仅进程内传递
      （CheckResult 可选字段），**不裸进 summary.json**——需要回传的字段走 t1⑤ 的显式
      schema 字段 visual_round；需要持久化的经账本侧车落盘。
      ④normRectsOverlap 导出（t2 复用）。
    status: completed
  - id: t2-transcription-audit
    content: >
      【G3】转录对账门禁 `visual_diff_finding_transcription`。
      ①T8 hard 命中须有对应 defect：主判据=defect.source.finding_id 精确对账（t0）；
      次判据=elements 交集非空且 signal 语义类一致；bbox 相交仅作 legacy 回退且收紧
      （IoU≥0.5）。hard 未转录 → pixel_1to1 BLOCKER"发现未落账"，details 附可照抄的
      defect 模板 JSON（含 source 字段）。warn 未转录 → WARN（T8 warn 本身已在
      CANDIDATE_BLOCKING_WARN_IDS 阻断 candidate-pass，本 WARN 是落账提醒不另加阻断）。
      t4 的 unstable 独立 id（visual_diff_layout_invariants_unstable）命中不要求转录。
      ②**must_fix 逐条锚定（rev4 理由更正——针对 rev10 计数门的剩余缝）**：rev10 的
      isRoundFingerprintable 计数门已挡"must_fix 条数多于 defects"的漏纹轮（错向安全侧，
      推迟熔断）；剩余缝=**条数凑平但错配**（2 条 must_fix + 2 条无关 filler defects 仍
      fingerprintable → 熔断吃错配数据）。本条堵之：pixel_1to1 P0 屏每条 must_fix 须被
      ≥1 个 defect 的 must_fix_refs 引用（t0②），未引用 → BLOCKER"第 i 条回修指令未
      结构化锚定"。不升级 must_fix 本体 schema（string[] 消费面太广），锚定放 defect 侧。
      计数门保持 rev10 语义作熔断资格门（本 audit 是完整对账，资格门是必要条件近似，
      两层各司其职——与 rev10 代码注释的分工声明一致）。
      ③**回执窄缝收口**：candidate-pass 收窄（awaitHumanOnly）在 pixel_1to1 下追加前提
      "结构合法 critic 回执存在"——无论 region_attest 是否存在；check 的
      uncovered-screenshot 校验从 attestScreens 扩到**全部 candidate P0 finalized 屏**
      （与 t3b 生产侧输入集完全一致）。
      单测：finding_id 对账三态/elements 次判据/bbox IoU 边界/filler defects 错配 FAIL/
      全锚定 PASS/minor-defect 绕行被拒/unstable id 免转录。
    status: completed
  - id: t1-round-ledger-fuse
    content: >
      【G1】state/round 二维轮次账本 + 指纹级熔断（rev4 二维轮次模型；rev5 补两个同源
      阻断修正——fuse 裁决是**轮次的属性**而非执行的副作用：①duplicate 须重放裁决，
      ②触发面收窄且让位 T2 求人路径）。
      ①概念分离：
      `base_state_hash = hash(build_fingerprint, screens_hash, defect_fingerprints,
      source_fail_hit_ids, fingerprintable)`——**source_fail_hit_ids=计算 fuse 之前的
      base hit id 集**，显式排除 visual_diff_no_progress_fuse 自身与 testing_run_status
      等派生聚合 hit（rev5：否则首跑加 fuse 后外层重算 hash 变化、撞不上同 round_key，
      形成反馈环）；
      `round_key = (loop_id, attempt_id, base_state_hash)`（轮次身份）。
      **attempt_id 必须跨 --resume 单调唯一（rev6 阻断修正）**：goal 态取本次 agent
      invocation 的唯一 invoke_id（在 agent_invoke_start 事件落盘后确定；备选=从
      events.jsonl 回放的全局 invoke 序数，totalTurns 同源恢复机制）——**禁止用 phase
      内 retries+1**（goal-runner 每次进 phase `let retries = 0`，resume 后序号归 1、
      撞旧 round_key 被重放 fused=false，rev4 专修的跨 attempt 同状态熔断在 resume
      边界失效）。三条硬约束：同一次 agent invocation 的内部 harness 自跑与外层 gate
      拿到**同一个** attempt_id；下一次 invocation（普通 retry / detach 恢复 /
      --resume）ID 必不同；崩溃恢复不重用旧 ID。经 MAISON_GOAL_ATTEMPT env 载运。
      **实施注意（终审遗留，非阻断）**：现有 invoke_id 实现是 `${phase}-${Date.now()}`
      ——落码时升级为 run-scoped 持久序号或 UUID，不得只依赖系统时钟满足"崩溃恢复
      不重用"。
      交互态**无可靠 attempt 身份 → 诚实收窄**（不引入 CLI token）：交互态只记录不同
      base_state_hash（同状态重跑幂等吞、不判），no_fix_attempt 自动熔断仅 goal 态可靠；
      交互态 fuse 只覆盖"状态变了指纹没变"（ineffective_fix——rebuild/重采后
      base_state_hash 必变，无需 attempt 身份即可比）。不得用 harness invocation id
      充当 attempt（普通重复执行会被误判新轮次）。
      ②账本 `device-testing/reports/visual-rounds.ledger.jsonl`（telemetry 侧车）：每行
      {schema_version, at, loop_id, goal_run_id?, attempt_id?, base_state_hash,
      build_fingerprint, screens_hash, defect_fingerprints[], source_fail_hit_ids[],
      fingerprintable, decision, row_hash}。**decision 持久化本轮裁决（rev5）**：
      {fused: boolean, failure_kind?: 'no_progress_fuse', attribution?:
      'no_fix_attempt'|'ineffective_fix', residual_fingerprints?: string[]}。
      **row_hash = sha256(canonicalJson(去 row_hash 后的行))**——canonical 序列化显式
      规定（字段序固定、数组排序、无换行/缩进参与），防序列化差异对账失败。loop_id：
      goal 态=goal run_id；交互态=feature+首次采集世代 id。
      ③读写时序与去重/追加/**重放**规则（check 只读判定、runner 在 check 后写）：
      算 round_key →
      a) **已存在同 round_key 行 → 不追加，重放该行 decision**（rev5 关键修正：
      attempt N 的 agent 自跑检出 fuse 并落行后，外层 goal-runner gate 撞同 round_key
      ——必须重放 fused=true 使外层同样得到 no_progress_fuse 并 halt，而非判 duplicate
      no-op（否则真正负责 halt 的外层永远看不到 fuse）；fused=false 的轮重放 false，
      人工重复执行 fused 轮持续看到 fuse，不会"跑第二次反而消失"）；
      b) 不存在 → 与同 loop_id 最后一有效行（fingerprintable=true）比较 → 算出
      decision → **连同 decision 追加** → 返回 decision。比较绝不跨 loop_id。
      读取端跳过崩溃半行并 WARN。
      ④熔断条件（rev5 收窄触发面；裁决优先级：**candidate-pass/await_human_confirm
      优先于 fuse**——仅当 awaitHumanOnly=false 才计算 fuse）：两轮指纹集非空且相等 +
      awaitHumanOnly=false + 本轮存在 **actionable visual residual**（结构化谓词
      has_actionable_visual_residual，非前缀判断）→ `visual_diff_no_progress_fuse`
      pixel_1to1 BLOCKER。actionable=真正要求进入 coding/critic 下一轮的残差：
      must_fix 非空 / fail 或需修 warn 屏 / 未解决 T8 hard、M1 blocking 命中 / 其他
      显式登记为 loop-actionable 的信号；**排除**：visual_diff_human_confirm_required
      （T2 求人路径——它本身是 visual_diff FAIL，candidate-pass 可留 minor defects 使
      指纹非空，前缀判断会让 fuse 混入 failHitsOnly、掀翻 awaitHumanOnly 全称条件，把
      "只差人签"误归 no_progress）、visual_diff_layout_invariants_unstable、layout/OCR
      capability degradation、纯聚合 hit、仅允许保留的 minor defects；receipt/provenance
      缺口归 evidence repair 类，不入 UI defect fuse。
      ⑤归因（build 指纹只做归因不做门槛）：两轮 build 不同 → ineffective_fix（修了没用
      ——homepage 经典空转，指引"停止迭代、halt 求人+残差清单"）；build 相同（跨 attempt
      同状态或仅重采）→ no_fix_attempt（跑了没修，指引"先改码重建"）。
      ⑥failure_kind 路由：fuse 命中（**含 duplicate 重放**）→
      finalResult.failure_kind='no_progress_fuse'；classifyFailureKind 新增分支（优先于
      isVisualGapBlockerId 前缀归类）；goal-runner 首触即 halt（不烧重试预算，不入
      SIGNATURE_HALT_KINDS）。与既有 shouldHaltNoProgress 的关系：visual_gap 粗熔断
      保留为兜底，fuse 更细更先触发，halt 原因分别为 no_progress_fuse /
      no_progress_visual_gap。
      ⑦run-id 管道与 schema 显式字段：goal-runner 在 agent spawn 与 harness gate spawn
      均注入 MAISON_GOAL_RUN_ID / MAISON_GOAL_ATTEMPT（现仅 MAISON_GOAL_RUNNER=1；
      attempt 值按①在 agent_invoke_start 落盘后生成，同 invocation 两处 spawn 共用）；
      summary 回传走**显式声明字段** `summary.visual_round?: {loop_id, attempt?,
      row_hash?, disposition: 'appended'|'duplicate', decision?}`——**disposition=
      duplicate 时同样回传重放后的 decision/failure_kind（rev5）**；HarnessRunSummary
      类型 + summary.schema.json 同步加可选字段（顶层 additionalProperties:false，
      不裸塞）；goal-runner 把 row_hash 写入 events.jsonl。
      **row_hash 反向校验消费者（rev6 钉缝——只写不验=虚设）**：goal gate 与 resume
      启动时从 events.jsonl 重建本 run 的期望行 hash 集，与 ledger 中同 loop_id 行逐项
      对账——缺行/改行（含 decision 被改）/重复 hash/意外替换 → integrity FAIL（goal
      halt 求人）；**ledger 损坏/缺失不得解释成"历史为空"**（否则删账本即可绕过 fuse）。
      **pending 行语义（终审遗留，非阻断）**：允许一个"当前 invocation 已写 ledger、
      外层尚未把 hash 提交到 events"的 pending 行——以 agent_invoke_start.invoke_id
      识别，外层 gate 成功后提交；resume 遇到 orphan pending 行 → 显式 adopt/reconcile
      或 integrity halt，不得误判为普通未知行。
      交互态无 events 参照，保留账本行数回退 → WARN 注记。诚实边界：events 与 ledger
      均在 agent 可写工作区，此为**运行时一致性防护**，非对"协同篡改两个文件"的密码学
      防护，不做 hash 链。
      ⑧交互态 SSOT 同步：见到 fuse 信号即停止改措辞重试，转人；同状态原地重跑不受机器
      熔断覆盖（非目标⑤），SSOT 明文禁止。
      单测：同 attempt 双写去重且 duplicate 重放 decision（fused=false/true 两态）/
      跨 attempt 同状态追加并熔断（no_fix_attempt）/重建同指纹熔断（ineffective_fix）/
      交互态同状态吞、状态变后可熔/candidate-pass+minor defects+只差人签不被 fuse 抢走
      （awaitHumanOnly 优先）/unstable 与 capability degradation 不计入 actionable/
      base_state_hash 排除 fuse 自身（首跑加 fuse 后外层仍命中同 round_key）/canonical
      row_hash 稳定性（字段序/数组序无关）/空集与不可指纹轮不比较/跨 loop_id 隔离/
      损坏行容错/visual_round schema（duplicate 带 decision）/路由/
      **resume 身份（rev6，codex 指定）**：attempt A 写 fused=false → 模拟进程退出 →
      从 events resume → 状态不变 → 新 attempt_id ≠ A → 追加第二轮并触发
      no_fix_attempt/**账本完整性（rev6）**：删除上一轮账本行 → integrity FAIL；
      修改既有行 decision → integrity FAIL（不解释成空历史）。
      **e2e（rev5，codex 指定场景）**：agent 自跑首次触发 fuse → 外层 gate duplicate →
      外层仍得到 no_progress_fuse 并 halt。
    status: completed
  - id: t3a-provenance-inventory
    content: >
      【G2 前置·证据源盘点立契约】
      ①adapter 能力声明：workflows adapter 契约新增 tool_event_provenance:
      none | structured_events | session_transcript（默认 none=恒 unverified）。
      ②结构化事件独立文件：合格 adapter 的 invoke 落盘改三文件——agent-events.jsonl
      （仅结构化 stdout，NDJSON 纯净）、agent-stderr.log（分流）、agent-output.log
      （人读混合投影，兼容既有消费者：哨兵/心跳/no-output 判定不动）。现状 stdout+stderr
      混写一个流（agent-invoke.ts:664-682）——attestation 必须绑定 agent-events.jsonl。
      ③逐 adapter 盘点并留真实日志 fixture：claude（session transcript vs
      `--output-format stream-json --verbose` 二选一并写明理由——后者须逐个回归
      b8f36a12 日志消费链，消费者继续读 agent-output.log 投影可控）；codex（exec 事件流
      是否记录 view_image/读图；codex 无 Read 工具，cat 图片≠视觉注入）；cursor/opencode
      （headless 输出是否含工具事件）；chrys（--json 信封）。结论落
      `docs/operations/adapter-tool-event-provenance.md`。
      ④解析器契约：只接受 CLI 产生的结构化事件，禁止从普通文本正则猜测 Read；每个合格
      adapter 配真实日志 fixture 单测。
      ⑤诚实边界：验读记录=「工具调用发生过」，≠「模型看懂了图」——SSOT/校准报告 §4
      措辞与 verified 语义一致。预期首期合格者大概率仅 claude + chrys，其余恒 unverified。
    status: completed
  - id: t3b-goal-verified-receipt
    content: >
      【G2】goal 态 verified 回执生产者（仅对 t3a 盘点合格的 adapter 实装；无合格者 →
      如实降级为"契约+fixture+解析器框架"，verified 生产延后并在校准报告 §4 记录）。
      ①goal-runner testing 阶段结束后，从 agent-events.jsonl（或 session transcript，按
      t3a 结论）提取图片读取工具事件；**verified 最低输入集（与 t2③ 校验范围完全一致）**：
      全部 pixel_1to1 P0 finalized 屏的被评截图 +（有 paired attest 时）全部 crops 均有
      验读记录 → runner 生成/覆盖 critic-receipt.json：input_provenance=verified、
      image_inputs 逐项带现算 hash、来源标 runner_transcript_audit。部分缺失 → 保持
      unverified 并记 unread_screenshots[]/unread_crops[]（check 层对 unread 的 paired
      attest 判 BLOCKER）。**生产触发条件（rev4 与 t2③ 对齐）**：跟 pixel_1to1 P0
      finalized candidate 路径走，与是否存在 attest/T8 finding 无关。
      ②防伪段 runner attestation（完整性绑定，非密码学签名）：回执带 {goal_run_id,
      evidence_log_path（=agent-events.jsonl）, evidence_log_hash}；check 重算比对——
      agent 手写 verified 缺 attestation/hash 不符即拒。agent 会话内自跑 harness 时回执
      仍为 unverified 档，合法。
      ③交互态不变（unverified + SSOT Read 强制）。
      单测/fixture：合格 adapter 真实事件日志→verified/部分缺失→unverified+unread 清单/
      伪造 attestation 被拒/无 attest 的 candidate 路径照常生产/无合格 adapter 降级路径。
    status: completed
  - id: t4-quiescence-sampling
    content: >
      【G4】静稳采样（quiescence sampling；共享采样器 + flag 隔离两段上线——rev4 按
      codex 修订：t4a 先于 t5 落采样器，t5 复用，防两套协议分叉）。
      ①协议（双 dump）：`shot₁ → dump₁ → dump₂ → shot₂`。判据（双稳）：**图像稳**=
      shot₁/shot₂ 的 app 窗口裁剪区（appRect 来自 dump，裁掉状态栏/系统区）hash 一致
      ——两 shot 括住两次 dump；**布局稳**=dump₁/dump₂ 规范化布局签名（节点 type/id/
      bounds 规范化序列化 hash）相等，且两 dump 的 appRoot/screen identity 一致。任一
      不稳 → 重试整组（默认 2 次，参数待 t5⑨ 实测校定）；仍不稳 →
      layout_dump_status='unstable'（枚举扩展），记录 unstable_reason
      （image_drift | layout_drift | approot_drift | both）与前后 hash、时间戳、attempt。
      dump₂ 为 T8 消费的最终 dump、shot₂ 为最终截图。
      ②unstable 降档走独立 id：unstable 屏的 T8 命中一律以
      `visual_diff_layout_invariants_unstable` 发出（hard/warn 均降为该 id 的 WARN），
      定义为 capability-degradation：不进 CANDIDATE_BLOCKING_WARN_IDS、不要求 t2 转录、
      T2 批量确认消息明示真人复核。A/B/C 不豁免 A 类（过渡态下 A 类同样瞬时误报）。
      ③**两段实施（rev4 明确中间态语义，codex 点）**：
      t4a=**observe-only 共享采样器**——独立模块（t5 校准 CLI 与正式采集链复用同一实现），
      仅在 calibration/feature flag 下运行；**正式 testing 链保持旧行为**（单 shot 单
      dump、T8 原门禁照跑，unstable 概念不生效），不产生中间态歧义；
      t4b=t5⑨ 宿主实测数据回填后**一次性启用**新状态语义（双采协议进正式链、unstable
      判定+独立 id 降档、重试参数与判据细节定稿）。**完成门槛（终审确认）**：t5⑨
      双拍/双 dump 真机数据未到手前，t4b 不得标完成、不得启用正式降档。
      ④成本诚实：每组 2 shot+2 dump；默认重试 2 → 最坏 3 组=每屏 6 shot+6 dump；
      仅 pixel_1to1 生效，t6b 守恒表按此口径。
      单测：稳定/一次抖动后稳定/持续不稳定三态 + 裁剪区判据 + 布局签名判据 +
      approot_drift + unstable 独立 id 不阻断 candidate-pass + flag 关闭时正式链行为
      逐字节不变（守恒断言）。
    status: completed
  - id: t5-calibrate-cli
    content: >
      【G5a】校准自动化 `layout-oracle-calibrate`（框架 CLI + skill 话术入口；**复用
      t4a 共享采样器**，不自造第二套采样协议）：对 ui-spec P0 屏逐屏（复用 nav 配置导航）
      执行采样，产出 **calibration.json（SSOT）+ layout-oracle-calibration.report.md
      （纯投影）**，逐项标注 automated_conclusion vs needs_human。项目：
      ①overlay 进树检测（sheet 开启态 dump 检索声明文本节点，D1/D2）；
      ②.id() 覆盖率统计（exact_id 命中率；responseRegion 对照留人工，D3 半自动）；
      ③bounds 卫生统计（零面积/越界/负坐标计数，D4 部分）；
      ④close 默认规则干跑（advisory 命中清单=FP 素材，D5）；
      ⑤C1 间距比例分布（D6 素材）；
      ⑥appRoot 选择稳定性（多屏多次 dump 的 appRoot type/面积分布——type='root' 首子树
      假设的真机验证）；
      ⑦bounds 语义抽查素材（可交互元素 bounds 反裁截图并排图，供人判"视觉边界 vs 触控
      热区"，needs_human）；
      ⑧locator 歧义统计（duplicate id/duplicate text 命中数）；
      ⑨**双拍/双 dump 稳定性实测（t4b 前置，中期宿主触点、不等 t9）**：每屏跑 t4a
      采样器，报全图 hash / app 区裁剪 hash / 规范化布局签名三口径稳定率——t4b 判据与
      重试参数以此校定。
      CLI 显式触发、不挂阶段链；宿主触发话术写进 device-testing reference。产出供人做
      gate 升档判断，CLI 不改档位。
    status: completed
  - id: t6-feedback-ledger
    content: >
      【G5b】终审回灌台账（所有者=visual-confirm CLI，崩溃可恢复事务）。
      ①`review-feedback.ledger.jsonl`（append-only）：真人 y（认可）/f（打回，输入原因）
      时落 {schema_version, at, feedback_id, feature, screen, human_verdict:
      approve|reject, reason, human_issue_kind?, build_fingerprint, screenshot_hash,
      oracle_version, machine_signals_snapshot}。
      ②崩溃可恢复事务：生成稳定 feedback_id → 写 pending journal → 原子替换
      visual-diff.json → append ledger（含 feedback_id）→ journal 标 committed/删除；
      CLI 启动 reconciliation（发现 pending journal → 按 feedback_id 幂等补账或回滚
      提示），feedback_id 幂等去重。
      ③snapshot 一致性校验：machine_signals_snapshot 采集时校验其 build_fingerprint/
      screenshot_hash/oracle_version 与**当前待确认屏**完全一致，不一致拒绝落账并提示
      重跑 harness——不能直接消费"最新报告"。
      ④overrule 入口：CLI 新增 --overrule <screen> <signal> 模式——真人对信号已报缺陷
      判"不是问题"时落 {human_verdict: overrule, signal/finding_id, reason}（FP 样本，
      signal 明确、可直接按信号归因）。
      ⑤**FN 归因收窄（rev4，codex 点）**：reject 且 snapshot 全绿 → 默认记
      **unattributed_fn（系统级视觉漏检）**——所有信号都绿时程序无法知道"谁本应发现"，
      不宣称按 signal 归因 FN。可选增强：f 打回时让真人选结构化 human_issue_kind
      （geometry_overlap | text_placement | missing_render | visual_style | other），
      程序按固定映射表折算到预期 detector family（T8/placement/OCR/critic）再计 FN
      ——人描述**问题类别**，归因仍由程序完成（区别于让人自填 signals_that_missed）。
      FP 按 signal 直接归因（overrule 自带 signal）。校准报告消费 ledger 出
      FP（按 signal）/FN（系统级 + 按 family 的映射估计）两张表。
      ⑥升档定位：计数表是升档评审的数据素材；规则参数（样本量 N、跨页面/设备覆盖、
      FN 上限、oracle_version 变化 → 历史样本失效标注）待数据累积后由人定，本期不写死、
      不宣称机制化。agent 不承担转录义务；goal 态 halt 后真人同样走 CLI。
      单测/e2e：y/f/overrule 落账/journal 崩溃恢复三断点/feedback_id 幂等/snapshot
      不一致拒绝/unattributed_fn 默认与 issue_kind 映射/append-only。
    status: completed
  - id: t6b-lightweight-conservation
    content: >
      【轻量化守恒（断言口径=「相对现状零新增」）】全部新增能力显式档位化并以守恒测试
      锁死，不侵蚀 d4a7c1e8 分档体系：
      ①t4 静稳采样（最坏每屏 6 shot+6 dump）仅 pixel_1to1 生效，且 t4b 启用前正式链
      行为不变（t4a flag 隔离）；
      ②t1 轮次账本仅 visual loop 活跃时追加——条件跟 UI_CHANGE_REQUIRES_UI_SPEC 集合走
      （含 copy_edits_only），单条 jsonl 级成本；
      ③t2 转录对账只在 T8/must_fix 产物存在时运行；**回执强制（t2③/t3b）跟 pixel_1to1
      candidate 路径走，与 attest/T8 是否存在无关**（rev4 修正：rev3 的"仅有 attest 才
      跑"与 t2③ 矛盾、会重新打开无 attest 生产缺口——低档位仍零接触：semantic_layout/
      lite/none 无 candidate 路径）；
      ④t5 校准 CLI 显式触发，不挂阶段链；
      ⑤SSOT 增量段落带「pixel_1to1」档位前缀（C3b 主干行数上限 lint 不得超）。
      **守恒回归测试**：semantic_layout 特性 + lite 轨特性 + ui_change=none 特性各走一遍
      testing 链——断言零**新增** BLOCKER、零**新增**设备调用、零**新增**必填产物。
      现状基线：layout dump 今天对 semantic_layout full 轨屏本来就采，不得断言"dump 不
      发生"；semantic_layout 不得出现的新增项=静稳双采、fuse BLOCKER、回执强制。
      与 goal-parity 同型，防未来门禁悄悄漏档。
    status: completed
  - id: t7-specs-and-docs
    content: >
      OpenSpec 增量（对 layout-oracle-geometry-gates 追加或新 change：structured
      findings（finding_id 稳定性契约）/state-round 二维账本与 no_progress_fuse（去重/
      追加/**重放**规则、decision 持久化、has_actionable_visual_residual 谓词与
      await-human 优先级、base_state_hash 排除项、canonical row_hash、attempt 身份跨
      resume 单调唯一契约、events↔ledger integrity 对账语义、交互态收窄语义）/
      transcription audit（finding_id 对账 + must_fix
      逐条锚定 + 与 rev10 计数门的分工）/runner attestation 回执（candidate 路径触发、
      最低输入集）/quiescence sampling（双 dump 判据、unstable 独立 id 的
      capability-degradation 语义、flag 两段上线）/校准 CLI 双产物/回灌 ledger（事务、
      snapshot 一致性、unattributed_fn 与 issue_kind 映射）的行为规格）。
      **summary schema 显式增量**：HarnessRunSummary + summary.schema.json 加可选
      visual_round 字段（t1⑥）——schema 任务显式列出，不隐含在实现里。
      **OpenSpec 5.4 标注半关**：verified 回执生产侧由 t3 关闭，独立 critic phase 侧
      如实 open、指向后继 plan。SSOT 同步（device-testing-workflow-detail：熔断信号
      消费、交互态同状态重跑禁令、CLI 落账协议、静稳语义；goal 文档：no_progress_fuse
      halt 语义、MAISON_GOAL_RUN_ID/ATTEMPT 管道）+ 校准报告 §4 诚实边界更新。
    status: completed
  - id: t8-tests-green
    content: >
      单测/fixtures：t0 结构化字段与 finding_id 稳定性/t1 二维轮次模型全矩阵（同 attempt
      去重与 duplicate 裁决重放、跨 attempt 同状态熔断、awaitHumanOnly 优先于 fuse、
      actionable residual 谓词、交互态收窄、visual_round schema 含 decision）/t2 逐条锚定与
      filler 错配与窄缝收口/t3 各 adapter fixture 与 attestation 防伪与三文件分流/
      t4 静稳三态与独立 id 与 flag 隔离守恒/t6 事务恢复与 snapshot 校验与 FN 归因收窄/
      t6b 守恒断言/校准 CLI 对固化 dump fixture 的 calibration.json 生成；既有全量
      unit+fixtures 不破；tsc --noEmit + npm run test + openspec:validate 全绿。
    status: completed
  - id: t9-host-e2e
    content: >
      宿主端到端验收（合并执行 c6d8f2b4-t11 + 本 plan 验收，用户以话术驱动宿主 agent；
      t5⑨ 是中期宿主触点、先于 t4b 与本项）：
      ①一句话触发 layout-oracle-calibrate → calibration.json+md 落盘，重点核 ⑥appRoot/
      ⑦bounds 语义素材（⑨已在中期完成并回填 t4b）；
      ②bc-openCard 复验三靶（沿用 c6d8f2b4 分层验收）；
      ③goal 演示 run：构造跨 attempt 同状态 → no_fix_attempt 熔断；构造重建后同指纹 →
      ineffective_fix 熔断；同 attempt 双写去重且 duplicate 重放裁决（agent 自跑首检
      fuse → 外层 gate 仍 halt 为 no_progress_fuse）；candidate-pass 只差人签的屏不被
      fuse 抢走（halt 原因保持 await_human_visual_confirm）；**中断后 --resume 同状态 →
      新 attempt_id 追加第二轮并熔断 no_fix_attempt（rev6）**；events.jsonl 与账本
      row_hash 对账一致（手工删一行账本 → integrity FAIL 演示）；
      ④按 t3a 盘点结论演示 verified 回执签发（或如实记录降级路径生效）；
      ⑤终审故意打回一屏（选 human_issue_kind）+ overrule 一个信号 → ledger 两类样本
      落账、校准报告 FP/FN 表出数；中断 CLI 验证 reconciliation 恢复；
      ⑥未达项如实登记；gate 升档决策留待 ledger 数据累积，本期不动档位。
    status: pending
---

# 三方 review 对账（2026-07-11，立项依据；基线=c6d8f2b4 rev10）

## 初版 codex 置信度评估对账（沿用，两处修正）

| codex 判断 | 对账结论 | 去向 |
|---|---|---|
| 独立 critic 自动迭代未实现 | **半成立**——循环调度器/独立 critic phase 确实无代码；但"熔断无代码"不实：goal-runner 已有 shouldHaltNoProgress 的 visual_gap signature 粗熔断（codex 与初版 plan 均漏看） | 指纹熔断→t1；调度器→**显式非目标，后继 plan** |
| region_attest 未校验逐区域覆盖 | 已过时（rev7 修） | 无需处理 |
| 无 receipt 可进 candidate-pass(unverified) | **大体过时**——余一条窄缝：每屏塞 minor defect 可绕过 attest→绕过回执 | t2③ 收口 |
| receipt hash 未重算 | 已过时（rev7/rev8 修） | 无需处理 |
| dump=captured 缺失/损坏静默跳过 | 已过时（rev7 修） | 无需处理 |
| T8 真机 oracle 未复验 | 成立 | t5 自动化子集 + t9 |
| 采集时序非原子 | 成立 | t4（判据经 rev2/rev3 两轮重设计） |
| 结构规则 FP 未跨页校准 | 成立 | t5 素材 + t6 台账 |
| T8 finding 只进文本 | 成立（且缺结构化字段） | t0 + t2 |
| 自报降权/M1/解耦/canary/schema 较可靠 | 同意（不动） | — |

## 第一轮三方 review 发现 → rev2 吸收清单

| 发现（提出方） | rev2 处置 |
|---|---|
| 「自动闭环机器化」口径超卖，无循环状态机（三方一致） | plan 更名收窄；状态机列非目标+后继 plan（codex 建议本期加状态机，cursor/claude 建议收窄——采后者：先料后机。由用户终裁） |
| goal 已有 signature 粗熔断被漏看（claude） | 对账表修正；t1 写明两机制关系 |
| t1 双写误触发/build 门槛反向/空集真空（claude/codex） | 幂等+归因化+三前提（rev3/rev4 继续演进） |
| 账本可删改/缺 run 隔离/崩溃半行（claude/codex） | loop_id/row_hash 对账/读取容错 |
| agent-output.log 无工具记录（claude/codex） | t3 拆盘点+条件实装 |
| verified 须覆盖被评截图（codex） | t3b 最低输入集 |
| "签发"→runner attestation（codex）；验读≠看懂（cursor） | 更名+诚实边界 |
| 整图 hash 恒等真机恒假（cursor） | t4 改裁剪+布局签名（rev3 补双 dump） |
| unstable 保 A 类无依据（codex/claude） | T8 全体降档（rev3 改独立 id） |
| 成本口径不实（codex） | 修正（rev3 定为 6 shot+6 dump） |
| LayoutFinding 缺结构化字段（codex/claude）；bbox 对账过宽（codex/cursor） | t0 + t2 finding_id 主判据 |
| must_fix 不转录逃逸 fuse（claude） | t2 结构化强制（rev3 逐条锚定；rev4 理由按 rev10 更正） |
| 回灌所有者=visual-confirm CLI（codex）；"人工原话 WARN"不可判定（claude）；FN/FP 不能自填（codex） | t6 重设计 |
| 升档规则无可执行定义（codex/cursor） | 降格为数据素材 |
| t5 漏 appRoot/bounds/歧义/一致性；只出 md（codex） | t5⑥⑦⑧⑨ + calibration.json |
| 守恒断言与现状矛盾；copy_edits_only（claude） | 口径改"相对现状零新增" |
| check 结构化返回（cursor）；normRectsOverlap 未导出（claude） | t0③④ |

## 第二轮三方 review（rev2 → rev3）吸收清单

| 发现（提出方，级别） | rev3 处置 |
|---|---|
| 静稳协议单 dump 证不了布局稳（codex，阻断） | t4 改 shot₁→dump₁→dump₂→shot₂；成本 6 shot+6 dump |
| unstable 原 id WARN 仍阻断 candidate-pass（codex，阻断） | 独立 id visual_diff_layout_invariants_unstable=capability-degradation |
| 账本读写时序/loop 隔离/run-id 管道（codex 阻断；cursor 钉缝1） | 显式算法+loop_id 限定+MAISON_GOAL_RUN_ID/ATTEMPT+row_hash 回传 |
| must_fix 部分转录逃逸（codex 阻断） | t2② must_fix_refs 逐条锚定 |
| receipt 生产/校验范围不一致（codex） | 统一为全部 P0 finalized 屏截图+crops |
| 结构化事件不能与 stderr 混流（codex；已核实混写） | t3a 三文件分流 |
| visual-confirm"同一事务"超卖；snapshot 不能吃"最新报告"（codex） | 崩溃可恢复事务+一致性校验 |
| t4 参数依赖 t5⑨ 但排在 t9（codex/cursor） | t4a/t4b 两段+中期宿主触点 |
| finding_id emit 定稿（cursor）；structured 不进 summary（cursor）；D7 措辞（cursor） | t0①③+关系节措辞 |

## 第三轮三方 review（rev3 → rev4）吸收清单

| 发现（提出方，级别） | rev4 处置 |
|---|---|
| 轮次键 (loop_id,build,screens) 把跨 attempt 不变状态永久去重——no_fix_attempt 永远熔不断；critic 只改 defects 的新评估也被吞（codex，阻断） | t1① state_hash 与 round_key 二维分离：state_hash 含 defect_fingerprints/fail_hit_ids/fingerprintable；round_key=(loop_id, attempt_id, state_hash)；MAISON_GOAL_ATTEMPT 纳入 round key；同 attempt 去重、跨 attempt 同状态追加并熔断 |
| 交互态无可靠 attempt 身份，二选一：显式 token 或诚实收窄（codex，阻断项内） | 取**收窄**：交互态只记不同 state_hash，no_fix_attempt 自动熔断仅 goal 态可靠，交互态 fuse 只覆盖 ineffective_fix；原地重跑靠 SSOT 禁令。列入非目标⑤ |
| t5⑨ 需要与 t4a 相同协议，先 t5 后 t4a 会分叉两套采样（codex） | 实施序改 t4a（observe-only 共享采样器，flag 隔离）→ t5 复用 → 宿主实测 → t4b 一次性启用；t4a 期间正式链行为不变 |
| t4a"只记不判"中间态歧义：unstable 屏此时按什么门禁（codex） | t4③ 明确：t4a 仅 calibration/feature flag 下运行，正式链保持旧行为（单采+T8 原门禁），t4b 一次性切换 |
| FN 全绿时程序无法按 signal 归因（codex） | t6⑤ 默认 unattributed_fn；可选 human_issue_kind 枚举→程序映射 detector family；FP 仍按 signal（overrule 自带） |
| t6b③"回执只在 attest/T8 存在时跑"与 t2③ 矛盾，重开无 attest 生产缺口（codex/cursor 同点） | t6b③ 改"跟 pixel_1to1 candidate 路径走，与 attest/T8 无关"；t3b① 同步写明生产触发条件 |
| summary 回传 row_hash 会撞 additionalProperties:false（codex/cursor 同点） | t1⑥ 显式 schema 字段 summary.visual_round{loop_id, attempt?, row_hash?, disposition}；t7 列为显式 schema 任务 |
| 头注事实裁定与代码相反（cursor；引 rev10 计数门与单测） | 裁定更正：codex 评 rev9、cursor 评 rev10，各对各的快照；以 rev10 为准——计数门已挡漏纹轮，t2② 堵的是"条数凑平但错配（filler defects）"剩余缝；基线注释同步 rev10 |

## 第四轮 codex review（rev4 → rev5）吸收清单

| 发现（级别） | rev5 处置 |
|---|---|
| duplicate 去重把首次 fuse 对外层抹掉：attempt N agent 自跑检出 fuse 落行 → 外层 gate 撞同 round_key 判 duplicate no-op → 负责 halt 的 goal-runner 永远看不到 fuse（阻断） | t1② 账本行持久化 decision{fused, failure_kind?, attribution?, residual_fingerprints?}；t1③a duplicate 时**重放该行 decision**（fused 两态均重放，人工重复执行 fused 轮持续见 fuse）；t1⑦ summary.visual_round 在 disposition=duplicate 时同样回传 decision；e2e 指定场景入 t1/验收① |
| "visual_diff 家族 FAIL"过宽抢走 T2 求人路径：human_confirm_required 本身是 visual_diff FAIL、candidate-pass 可留 minor defects 使指纹非空 → fuse 混入 failHitsOnly → awaitHumanOnly 全称条件被掀翻，"只差人签"误归 no_progress（阻断） | t1④ 触发面改结构化谓词 has_actionable_visual_residual（must_fix/需修 verdict/未解决 T8 hard、M1 blocking），排除 human_confirm_required、unstable、capability degradation、纯聚合 hit、允许保留的 minor defects；receipt/provenance 缺口归 evidence repair；裁决优先级显式化：仅 awaitHumanOnly=false 才计算 fuse |
| state_hash 含 fuse 自身会成反馈环：首跑加 fuse → 外层重算 hash 变化 → 撞不上同 round_key（钉死项） | t1① 改 base_state_hash + source_fail_hit_ids（计算 fuse 前的 base hit 集，排除 fuse 自身与 testing_run_status 等派生聚合 hit）+ 单测锁死 |
| row_hash 未定义序列化口径，不同实现对账失败（钉死项） | t1② row_hash=sha256(canonicalJson(去 row_hash 行))，字段序固定/数组排序/无换行参与 |

## 第五轮 codex review（rev5 → rev6）吸收清单

| 发现（级别） | rev6 处置 |
|---|---|
| MAISON_GOAL_ATTEMPT 未定义生成/恢复方式：若取 phase 内 retries+1，--resume 后 `let retries = 0` 重置（goal-runner.ts:1527）→ resume 首轮 attempt 又=1 → 同状态撞旧 round_key 被重放 fused=false → 本应的 no_fix_attempt 第二轮被吞，rev4 修复在 resume 边界失效（阻断） | t1① attempt_id=本次 agent invocation 唯一 invoke_id（agent_invoke_start 落盘后确定；备选=events 回放全局 invoke 序数，totalTurns 同源）；三条硬约束（同 invocation 内 harness 与外层 gate 同 ID/任何下一次 invocation 必不同/崩溃恢复不重用）；codex 指定 resume 单测入 t1 |
| row_hash 只写不验=虚设；且 ledger 损坏若解释成"历史为空"可删账本绕过 fuse（钉缝） | t1⑦ 反向校验消费者：goal gate/resume 启动从 events 重建期望行集与 ledger 对账，缺行/改行（含 decision）/重复/替换 → integrity FAIL（halt 求人）；损坏≠空历史；交互态保留行数回退 WARN；诚实边界：运行时一致性防护，非对协同篡改双文件的密码学防护；删行/改 decision 两个单测入 t1 |

## 终审（rev6，2026-07-11）：codex **通过，建议批准实施**；cursor 已于 rev3 后放行

终审确认全部阻断闭合；三个非阻断遗留已钉入对应 todo：
①invoke_id 现实现为 `${phase}-${Date.now()}`，落码升级 run-scoped 持久序号/UUID，
不得只靠系统时钟（→t1①）；②row-hash 对账允许 pending 行（invocation 已写 ledger、
外层未提交 events），orphan pending 显式 adopt/reconcile 或 integrity halt（→t1⑦）；
③t5⑨ 真机数据到手前 t4b 不得标完成/启用降档（→t4③ 完成门槛）。

# 设计要点

## 口径与命名（为什么本期不建循环状态机）

codex 的 t0-visual-loop-state-machine 建议（loop 状态迁移/critic 与 fixer 双 fresh
context/唯一裁决点）方向正确，但它依赖：结构化 findings（t0）、可信轮次账本（t1）、
可对账的转录链（t2）、可验证的 critic 调用证据（t3）——全部是本 plan 的交付物。先建
状态机=在散文和自觉之上编排。故本期定位**基础设施加固**，状态机立后继 plan（届时
OpenSpec 5.4 的 critic phase 侧一并关闭）。一切文档措辞用"熔断/对账/签发/可观测"，
不用"机器保证循环会转"。

## 与既有 goal 熔断机制的关系（t1 的关键背景）

goal-runner 既有三层：①shouldHaltNoProgress——visual_gap 同 blocker-id signature 连续
两 attempt 重复 → halt（no_progress_visual_gap）；②CUMULATIVE_HALT_FAMILY 跨 attempt
累计熔断；③await_human_confirm 等首触即 halt 的 classification 通道。t1 的指纹 fuse
是第④层：粒度最细（残差级）、由 check 产出 BLOCKER 并走 classification 通道首触即
halt。①保留为兜底不删；halt 原因可区分。

## 轮次模型：state 与 round 二维分离 + 裁决重放（t1 的核心，rev4 重构、rev5 补全）

rev3 的教训：把「状态」当「轮次」会顾此失彼——同 attempt 内 agent 自跑+runner 闸门是
**同一轮的重复执行**（必须去重），跨 attempt 的同状态恰恰是**要熔断的 no_fix_attempt**
（必须追加比较）。故分离：base_state_hash（评估状态身份，含 build/screens/指纹/
source_fail_hit_ids/资格——**取计算 fuse 之前的 base hit 集**，排除 fuse 自身与派生
聚合 hit，防"加了 fuse → hash 变 → 撞不上同轮"的反馈环）与 round_key（loop_id +
attempt_id + base_state_hash）。goal 态 attempt_id=invocation 唯一 invoke_id 经
MAISON_GOAL_ATTEMPT 载运（rev6：**必须跨 --resume 单调唯一**——phase 内 retries+1 在
resume 时归零，会让同状态撞旧 round_key 被重放 fused=false、吞掉本应熔断的第二轮；
invoke_id 在 agent_invoke_start 落盘后确定，天然满足"同 invocation 共用、跨
invocation 必不同、崩溃恢复不重用"）；交互态无可靠 attempt 身份 → 诚实收窄：同状态
重跑幂等吞掉（不判 no_fix_attempt），fuse 只覆盖"状态变了指纹没变"（ineffective_fix）。
build 指纹只回答"有没有重建"（归因），不回答"该不该熔断"。

rev5 的教训（codex 第四轮）：**fuse 裁决是轮次的属性，不是某次执行的副作用**。去重
去掉的只能是"重复计算"，不能连裁决一起吞——账本行持久化 decision，duplicate 命中时
重放该行裁决（agent 自跑首检 fuse → 外层 gate 重放 fused=true → goal-runner 稳定
halt）。同理，fuse 的触发面必须让位于设计内求人时刻：candidate-pass/await_human_confirm
优先于 fuse（仅 awaitHumanOnly=false 才计算），actionable residual 用结构化谓词而非
visual_diff 前缀——human_confirm_required 本身就是 visual_diff FAIL，candidate-pass
允许保留 minor defects（指纹非空），前缀判断会把"只差人签"抢成 no_progress。

## verified 回执的信任链（t3）

信任根=goal-runner 自身（宿主 framework 完整性由 e8f5a2c7 守护）：runner 读**纯净结构化
事件文件 agent-events.jsonl**（三文件分流，stderr 不再污染 NDJSON）→ 提取图片读取记录
→ 生成回执并附 runner attestation（goal_run_id + 事件文件 hash 的完整性绑定，非密码学
签名）。生产触发与校验范围同一口径：pixel_1to1 P0 finalized candidate 路径，全部屏
截图 +（有 attest 时）crops。证明力边界：证明「工具调用发生过且输入被注入」，不证明
「模型看懂了图」。交互态维持 unverified + SSOT Read 强制。

## 静稳采样判据（t4：双 dump + 独立 id + flag 两段上线）

弃用整图字节恒等（状态栏秒级元素真机恒假）。协议 shot₁→dump₁→dump₂→shot₂：图像稳
（app 裁剪区，两 shot 括住两 dump）+ 布局稳（两 dump 规范化签名相等、appRoot 一致）。
已知残余局限（如实记录）：A→B→A 状态往返、裁剪区外变化影响布局的边角情形——静稳是
**启发式**。unstable 走独立 id 的 capability-degradation WARN（不阻断 candidate-pass、
不入转录对账、T2 消息明示真人）。上线路径：t4a 共享采样器 flag 隔离 observe-only
（正式链行为不变，t5 复用同一实现），宿主实测回填后 t4b 一次性切换——不存在"半启用"
中间态。

## 回灌台账所有者与事务性（t6）

反馈落账的可信度排序：真人 TTY 工具事务写入 > runner 机器盖戳 > agent 转录。
visual-confirm CLI 已是 T2 的既有真人通道，落账内聚其中。「事务」的诚实定义=崩溃可
恢复（journal + feedback_id 幂等 + 启动 reconciliation）。snapshot 落账前校验与待确认
屏的 build/hash/oracle_version 一致。FN 归因诚实边界：全绿漏检默认 unattributed_fn
（系统级）；按信号族统计须经真人 human_issue_kind → 程序映射，不让人直接指认信号。
ledger 为 append-only jsonl，oracle_version 支撑"oracle 代码变了→历史样本失效"。

## 轻量化守恒（与 d4a7c1e8 的关系）

三层结构性保障：轨道隔离（L0/L1 不进重链）、档位隔离（重机械只落 pixel_1to1——回执
强制跟 candidate 路径而非 attest 存在性，低档位无 candidate 路径天然零接触）、守恒
测试锁死（t6b，断言口径=相对现状零新增）。成本增量如实记账：pixel_1to1 屏静稳采样
最坏 6 shot+6 dump/屏（默认参数，待 t5⑨ 校定）；账本/对账/回执为文件级零设备成本。
净减重项不变：分数必填契约已废除、逐页找人改收敛后一次批量终审。

## 账本与判定文件的红线切分（t1/t6 共用）

tamper-scan 红线保护**判定产物**（verdict/分数/签字）且只扫脚本文件，jsonl/yaml 侧车
不会误伤（已核实 evidence-tamper-scan.ts 判据）。两账本均为 telemetry/标注侧车：
visual-rounds 由 harness-runner 追加（机器盖戳，row_hash 经 summary.visual_round 显式
字段回传 goal events.jsonl，goal gate/resume 启动时**反向对账**——缺行/改行 →
integrity FAIL，损坏≠空历史）、review-feedback 由 visual-confirm CLI 追加（真人事务），
不含判定字段，check 只读消费。诚实边界：events 与 ledger 均在 agent 可写工作区，
对账是运行时一致性防护，不是对"协同篡改两个文件"的密码学防护。

## 与 c6d8f2b4 的关系

纯增量：不改 A/B/C 档位、不改 reported_*/M1/attest 语义；t0 扩展 LayoutFinding/defect
结构（可选字段，legacy 兼容）；t2 对账消费 T8 findings 并与 rev10 计数门分工（资格门=
必要条件近似，audit=完整对账——与 rev10 代码注释的声明一致）；t1 消费 rev10 指纹纯
函数。c6d8f2b4 的 **D7 熔断侧由 t1 覆盖**（D7 整段的 critic 五案集成不由本 plan 关闭）；
D9（goal verified 生产者）由 t3 按盘点结论关闭或如实降级；t9 合并执行其 t11。

# 实施记录

## 2026-07-11 rev6 实施（一次会话完成 t0→t8；t9 与 t4b 依计划留待宿主触点）

**验证基线**：tsc --noEmit 干净；unit **1836 passed / 0 failed**（基线 1799，新增 37）；
fixtures 44/44；openspec validate 34/34（含新 change critic-loop-hardening）。

**落点清单**（按实施序）：
- t0：`layout-oracle-check.ts`（finding_id/elements/emit 统一入口/B 类 bbox/
  computeLayoutFindingId+layoutBBoxBucket 导出）；`visual-diff-check.ts`（defect
  source/must_fix_refs schema 校验、normRectsOverlap 导出、结构化 payload
  VisualDiffStructuredPayload）；`types.ts`（CheckResult.structured，注明不进 summary）。
- t2：`visual_diff_finding_transcription`（finding_id 主判据/elements+signal 次判据/
  IoU≥0.5 回退/hard BLOCKER 附模板/warn 落账提醒/must_fix 逐条锚定）；回执窄缝收口
  （candidatePathActive 触发回执必需 + uncovered 扩全 candidate P0 屏）。
- t1：新模块 `harness/scripts/utils/visual-rounds-ledger.ts`（canonicalJson/row_hash/
  base_state_hash/evaluateVisualRound 去重-重放-比较-归因/appendVisualRound/
  reconcileLedgerWithEvents）；check 侧 fuse hit+failure_kind（awaitHumanOnly 先算、
  actionable 谓词 pixel_1to1 门控）；harness-runner consumeVisualRoundPayload（check 后
  追加+summary.visual_round）；summary.schema.json visual_round $defs；goal-runner：
  attempt=`i<totalTurns>`（events 回放序数，invoke_id 同步弃纯时钟）、双 spawn env 注入、
  no_progress_fuse 首触 halt 分支、visual_round 事件、gate/resume integrity 对账
  （visual_ledger_integrity halt）；classifyFailureKind 新分支（先于 visual_gap 前缀）。
- t3a：goal_capability.tool_event_provenance 契约；agent-invoke 三文件分流
  （agent-events.jsonl/agent-stderr.log/agent-output.log 投影不变）；盘点 SSOT
  `docs/operations/adapter-tool-event-provenance.md`（claude 选 stream-json 路线，
  全 adapter 默认 none——声明回填待宿主实测）。
- t3b：新模块 `critic-receipt-producer.ts`（claude 解析器 parseClaudeImageReadEvents、
  runner attestation、unread 清单、无解析器/无事件降级）；goal-runner testing 后置生产
  （harness gate 前落盘）；check 侧 attestation 校验替代 rev10 一律降级——
  candidate-pass(verified) 由 attestation 通过解锁。
- t4a：新模块 `quiescence-sampling.ts`（shot₁→dump₁→dump₂→shot₂、app 裁剪 hash
  （jimp crop，不可用退整图并注记口径）、normalizedLayoutSignature（文本免疫）、
  approotIdentity、unstable_reason 四值、执行失败与判据不稳区分）。observe-only：
  正式采集链零改动，唯一消费者=t5 CLI。
- t5：`profiles/.../layout-oracle-calibrate.ts`（九项+ledger FP/FN 表；calibration.json
  SSOT+md 投影；逐项 automated_conclusion/needs_human 标注）+ CLI
  `harness/scripts/layout-oracle-calibrate.ts`（offline 默认；--device --python 走
  hylyre 采样/redump）+ npm script。
- t6：新模块 `review-feedback-ledger.ts`（append-only jsonl/journal 三断点崩溃恢复/
  feedback_id 幂等/FP-FN 聚合含 issue_kind 映射与 oracle_version 失效标注）；
  visual-confirm 改造（启动 reconciliation、逐决定事务落账、snapshot 一致性拒绝、
  --overrule --signal、打回问 issue_kind、署名入账）。
- t6b：守恒 e2e（semantic_layout 零 fuse/actionable=false/零回执强制；ui_change=none
  零结果；锚定门禁 pixel_1to1-only）。
- t7：OpenSpec change `critic-loop-hardening`（proposal+specs/visual-diff 7 条
  +specs/goal-runner 4 条+tasks）；SSOT（device-testing-workflow-detail 熔断机器化段+
  回灌台账段）；goal runbook（fuse/integrity/轮次身份）；layout-oracle-geometry-gates
  5.4 半关标注；校准报告 §4 更新。
- t8：新单测 5 套 37 例（visual-rounds-ledger 全矩阵 12/review-feedback-ledger 6/
  critic-receipt-producer 4/quiescence-sampling 7/structured-findings 5）+
  visual-fidelity 3 个 f7a3 e2e（fuse 两轮+duplicate 重放/锚定/守恒）+ 1 个旧测随
  t3b 语义同步（rev10 一律降级 → attestation 判据）。

**如实偏差与待宿主项**（surface-plan-deviations 纪律）：
1. **t4b 未实施**（按计划：完成门槛=t5⑨ 真机双拍数据未到手；unstable 独立 id 的降档
   判定与 CANDIDATE_BLOCKING 排除已在 spec/t2 免转录逻辑中预留，正式链接入待 t4b）。
2. **t3a 真实日志 fixture 未获取**：claude 解析器 fixture 为**格式精确的合成样本**
   （测试文件内已注明）；真机 stream-json 采集、chrys/codex 事件粒度实测、adapter.yaml
   声明回填均入盘点文档"待宿主复验"清单（t9 合并）。当前全 adapter 默认
   tool_event_provenance=none → 生产链零行为变化，verified 生产在宿主声明后才激活。
3. **goal-runner 循环内接线未做进程级集成测试**（本环境无 headless adapter 可拉起
   goal run）：halt 分支/env 注入/事件写入经 tsc+模块级单测覆盖，端到端归 t9 ③。
4. t5 --device 模式的 hylyre python 解析取显式 --python/env（不复用 testing ready 探测
   ——CLI 独立触发时无 ready 上下文），已写入 CLI 帮助与 SSOT 话术。

**t9（宿主端到端验收，待用户驱动）**：①校准 CLI 触发（offline 先行，--device 补 ⑥⑨）；
②bc-openCard 三靶复验；③goal 演示 run（fuse 三态+duplicate 重放+resume 身份+integrity
删行演示）；④claude stream-json 真日志固化 fixture+adapter 声明回填 → verified 回执
演示；⑤终审打回/overrule 落账+FP/FN 表出数；⑥未达项如实登记。

## 2026-07-11 宿主触点执行（SimulatedWalletForHmos / bc-openCard）+ t4b 落地

**宿主同步**：用户手动同步 framework（与实现逐字节一致）；integrity preflight PASS。

**t9①/t5⑨ 校准实测（已完成）**：offline+device 双模式各跑一次，calibration.json/md 在
`doc/features/bc-openCard/device-testing/reports/`。⑨ 关键数据（8 P0 屏）：
- **app 裁剪判据 8/8 稳定；整图 hash 仅 3/8 相等**（5 屏状态栏漂移）——rev3"弃整图恒等、
  用 app 裁剪"的判据重设计被真机数据实锤；
- 布局签名 8/8 稳定；动效屏（sms_verify overlay）3 组收敛——默认重试 2 恰好够；
- **⑥ appRoot 真机结论**：7/8 屏单 type='root' 子树（面积比 0.945）；overlay 屏出现
  **双 root**（app 窗口 + 输入法键盘窗口，后者面积更大）——"首个 type=root"策略 8/8 选对
  app 窗口，"面积最大"回退在键盘在场时会选错。现行策略保持，结论记入校准报告；
- 校准导航保真度注记：CLI 裸跑 nav（无 --bundle/--page-name），overlay 屏采样时 SMS
  sheet 未起、键盘在场——⑨ 判据数据不受影响，但 ①-⑧ 逐屏语义分析须以正式 testing
  采集（nav 与 device_test.run 对齐）的 dump 为准。

**t4b（门槛解除后实施）**：quiescence 采样接入正式采集链（acquireScreenArtifacts 统一
取材入口，`quiescenceSampling` 仅 pixel_1to1 装配、与 layoutDumpFn 同守卫）；
layout_dump_status 枚举 +'unstable'+`layout_dump_unstable_reason`；T8 对 unstable 屏
全体降档走独立 id `visual_diff_layout_invariants_unstable`（capability degradation：
不进 candidate-blocking、免 t2 转录、A 类不豁免）；probe/records 落 `_quiescence/`
侧车；重试参数定稿默认 2。新增单测：采集三态+守恒（flag 关闭每屏 1 shot 零侧车）+
unstable 降档 e2e。OpenSpec 静稳 requirement 由 observe-only 改写为 enabled 语义。

**t9④/B1 claude 采样（完成）**：初采两份 401 样本（环境发现：宿主 `claude -p` headless
鉴权失效，用户已修复）；修复后实采成功样本（tool_use/Read 真机截图 + 准确描述——模型
真读到图）。收尾五件：①真实 fixture 固化（tests/unit/fixtures/claude-agent-events.
real.jsonl）+ 解析器真实样本用例；②claudeArgv 按 `tool_event_provenance:
structured_events` 声明加 `--output-format stream-json --verbose`（声明传导经
resolveHeadlessInvokePlan）；③agents/claude/adapter.yaml 声明回填——**verified 回执
生产链正式激活**；④断流哨兵适配 stream-json 结构化信封（api_retry/result 事件；
401/403 鉴权不归 transient——初采即 401 实锤该保护必要性）+ 单测；⑤盘点文档 claude
行结案。401 的意外收获：鉴权失败样本证明了"401 误归 transient 会盲 backoff 空转"
是真实风险，哨兵按 status 码过滤的设计被前置验证。

**仍待宿主/用户**：③goal fuse 演示 run（烧 token+设备时间，待用户拍板时机）；
⑤visual-confirm 真人 TTY 终审/overrule 落账演示；chrys/codex 事件粒度实测；②三靶复验
（依赖下一次正式 testing 采集产出带 finding_id 的 T8 命中）。

## 2026-07-11 实现后 review-fix 轮（codex 6P1+2P2 / cursor Critical+5I，全部核实成立并修复）

**Critical/P1-1（integrity 主路径空转，两家同点）**：期望集只收 appended 事件，而主路径
（agent 自跑 append → 外层 gate 恒 duplicate）只产 duplicate 事件 → 期望恒空 → 对账整段
被 `length>0` 前置跳过——"删账本绕 fuse"防护失效。修：期望集纳入一切携 row_hash 的
visual_round（duplicate 的 hash 就是账本行）；对账**无条件执行**；pending 收养收窄为
"已 start、未 commit"的 invocation（collectUncommittedVisualAttemptIds）；goal 对账
fail-closed 新增 corrupt_lines 与 duplicate_row_hash 两类完整性失败。
**P1-2（append 失败仍宣称成功）**：commitVisualRound 落盘失败 → disposition=
append_failed（无 row_hash），schema/types 扩枚举，goal-runner 见之立即 halt
visual_ledger_integrity（末轮无下次对账兜底，不得放行）。
**P1-3（无资格基线污染熔断）**：指纹资格=rev10 计数门 && 转录对账净
（transcriptionDirty 透传）；行持久化 actionable_residual/await_human_only 且二者进
base_state_hash；比较基线须 fingerprintable && actionable && !awaitHuman（legacy 行不作基线）。
**P1-4（verified 可手工伪造）**：attestation 校验加固——证据文件必须为
agent-events.jsonl、goal env 在场时 goal_run_id/critic_run_id 须绑定当前 run、
**check 侧用注册解析器重解析证据日志逐项复核 image_inputs 的验读事件**（"某文件 hash
未变"≠"本轮 critic 读过这些图"）；无解析器的 adapter 不采信。边界注记：output_hash
为生产侧证据，gate 语境外不重算。
**P1-5（journal 路径穿越）**：reconcile 须传按 feature 派生的期望路径，journal 自述
路径不符 → 丢弃不写盘（防构造 journal 诱导真人启动时覆盖任意 JSON）+ 负例单测。
**P1-6（坏 dump 误归 unstable）**：采样器对"dump 执行成功但不可解析"返回 error
（采集失败），不再落 approot_drift 走降档继续 candidate 路径。
**P2-1/I-4（snapshot 只收 T8 + overrule 任意串）**：snapshot 合并报告级 base FAIL hit
（防机器已发现仍计 FN）；--overrule 的 signal 须真实存在于当前快照，否则拒绝。
**P2-2（bbox 消账缺类别）**：IoU 回退追加 signalExpectedClasses 语义类一致约束。
**I-1（交互态跨会话误熔）**：交互 loop_id 加 ui-spec 内容指纹世代（spec 变更自动开新
世代）。**I-2**：region_attest 移出 LOOP_ACTIONABLE（evidence repair 不入 fuse）。
**I-5（RUN_ID 无 ATTEMPT 静默吞熔断）**：身份不完整 → 如实跳过账本评估+注记，不误判
不误吞。**Minor**：采样器头注随 t4b 启用改写。
验证：**unit 1844（+4 负例）/ fixtures 44 / openspec 34 全绿**；两份 spec delta 按新
语义修订。

### 轮3（codex 3P1+2P2，全部核实成立并修复）

**P1（pending 永生）**：收养白名单三重收窄——仅 testing 阶段 invocation、仅"已 start
未 commit"、仅最后一个；收养的行立即补写 recovery visual_round 事件（进下次期望集、
关闭 pending 身份）。**P1（verified 交互态越权）**：verified 仅 goal gate 语境采信
（RUN_ID+ATTEMPT 双在场）；critic_run_id 精确=`<run>-<attempt>`（弃 startsWith）；
证据路径须落当前 run 报告目录（basename 相同的旧目录文件不作数）；交互态一律如实
unverified（与非目标③一致）。**P1（WARN 身份不进状态）**：source_warn_ids
（candidate-blocking WARN hit id + 未转录 warn finding_id）进账本行与 base_state_hash
——WARN 从 A 变 B 不再重放旧 decision；未转录的 candidate-blocking WARN 使本轮失去
熔断资格（错向安全侧）。**P2（snapshot 报告级误归屏）**：snapshot 分 per-screen hits
（T8 stable/unstable 按 screen_id 归屏）与 report_level_hits（OCR/placement/M1 单独
记录不冒充屏归属）；FN"全绿"要求两集皆空；报告级信号可 overrule 但归因到信号不绑屏。
**P2（交互态 append_failed exit 0）**：harness-runner 对 append_failed 直接 exit 1
（ledger 是熔断/校准的持久化基础，交互态同样 fail-closed）。
验证：**unit 1845 / fixtures 44 / openspec 34 全绿**；specs 同步。
**宿主 framework 需按最终状态再同步一次。**

### 轮4（codex 1P1+1P2，全部核实成立并修复）

**P1（已转录 T8 finding 身份在熔断指纹中丢失）**：核实成立——熔断比较只吃
defect_fingerprints（ledger evaluateVisualRound），而旧指纹=class|element|0.1桶三元组
过粗（多个 T8 signal 映射同 class，B 类全归 shape_mismatch）；WARN 转录后 finding_id
既不在 source_warn_ids（只收未转录）也不在指纹 → "修掉 A、冒出同元素同桶的 B"撞同
指纹误熔断。修：computeDefectFingerprint 对带 source 的 defect 追加
`|producer#finding_id` 尾段（finding_id=hash(screen|signal|elements|桶)，天然区分
signal/元素集）——统一覆盖 FAIL/WARN 转录发现（codex 的"统一处理"）；legacy 无 source
defect（VL 自报）保持旧四元组；新旧格式跨轮必不相等 → 熔断推迟一轮错向安全侧，账本
零迁移。**P2（evidence 路径子串绑定）**：核实成立——includes(run_id) 父目录/兄弟目录
名含 run_id 片段即可通过。修：收紧为期望全路径精确等值
`<featureDir>/goal-runs/<run_id>/phases/testing/agent-events.jsonl`（回执只在 testing
阶段由 runner 签发 → 期望路径唯一可推导；path.resolve 等值，非子串/非子树）。
测试：t9 指纹用例扩展（同桶不同 finding_id 互异/同 finding_id 抖动稳定/跨格式不等）；
新增 round4_verified_evidence_path_exact_binding e2e（decoy 子串路径拒 + canonical
路径全链走通=生效档位 verified——顺带首次覆盖 attestation 校验成功路径）。
codex 同轮明示的信任边界（output_hash 不由 checker 重算=有意接受的 producer-side
evidence）spec 已有该 Boundary 句，无需改动。
验证：**unit 1846 / fixtures 44 / openspec 34 全绿**（注意：unit 须按仓内口径
`npm run test:unit`（ts-node）跑——tsx 会向 execArgv 注入 loader 触发 P0-7 进程注入
自检的环境性误报）。
**宿主 framework 需按最终状态再同步一次。**
