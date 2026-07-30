---
name: 宿主回灌三修 — 截断链预检鸡生蛋、wall-clock 活跃预算、halt 出路真实化
version: 3.0.0
# 版本说明：窗口不 bump（用户控版本）。小型 bugfix 轮：plan 7c4f2e9b 任务 7.2 宿主实测
# 回灌（2026-07-22，SimulatedWalletForHmos，bc-openCard，adapter=cursor）暴露的问题面。
# v2（2026-07-22，吸收 codex 一轮 3P0+4P1+1P2，逐条 ground-truth 核实后修订）：
# [P0-1 全采纳] 授权出路三重阻断实锤（buildGoalManifestFromInput 不复制
#   pre_authorized_mutations goal-manifest.ts:270-289 / 无 HMAC 时 pre_run_manifest 明确
#   拒绝 mutation-authorization.ts:184-192 / classifier 缺失时 receipt 合规也返回
#   unauthorized :236-249——现行 console banner「写 receipt 后 --resume」本身就在过度
#   承诺）→ T3 从「指引承载」升级为「出路真实化」。
# [P0-2 前提证伪、子项采纳] 「resume 只追加 resume 不追加 run_start」不成立——
#   goal-runner.ts:3084-3091 每次进程启动无条件追加 run_start（codex 二轮已确认此证伪）。
#   子项属实：totalTurns 计入 dry-run 幻影 invoke；firstRunStartMs 会取到 dry-run 起点。
#   → T2 统一分段纯函数 partitionExecutionSessions。
# [P0-3 全采纳] 打标≠控制面隔离 → T1 升级：dry-run 独立命名空间 + authoritative 访问器
#   全消费面扫替。
# [P1-4 采纳] phase_halt 无投影/重建消费 → T4。[P1-5 采纳] harness 真值证据丢失 → T4。
# [P1-6 采纳且加重] gap-notes 双账本分裂（check-ut.ts:833 采信 agent 自签）→ T4。
# [P1-7 采纳] finalize 预检边界 → T2。[P2-8 采纳] 7.2 措辞限定 → T5。
# v3（2026-07-22，吸收 codex 二轮 3P0+4P1，逐条 ground-truth 核实后修订）：
# [P0-a 全采纳] 裁决 fingerprint 必须进真人签名范围——mutationAuthorizationScopeHash
#   （mutation-authorization.ts:88-102）现仅绑 run_id/phase/allowed_files/
#   allowed_change_kind/max_files，仅加字段不改 hash = agent 改写 JSONL fingerprint 即可
#   借旧签名过闸（新授权绕过面）。→ T3(b) 钉死：fingerprint 进 scope hash（?? null 单一
#   定义不留双版本）+ confirmation receipt payload.object_hash 覆盖 + 规范化
#   （op+canonical path+sha256 稳定排序+domain separation）+ 缺 fingerprint 旧 receipt
#   不入裁决分支 + 签发后篡改/换内容/modified→added 负例全套。
# [P0-b 全采纳] 截断链无法回退 coding/review——goal-runner.ts:5244 chain.indexOf('coding')
#   在 ut→testing 链=-1 → backtrackToIdx=0 → to_phase=ut，drift 相对旧 review attestation
#   仍在，下轮撞 backtrack_limit（:5230）不闭环。→ T3(b) 定稿方案 1（简单安全）：
#   authorized_backtrack 仅当当前 chain 同时含 coding 与 review；截断链改 halt +
#   guidance「新起 coding→testing run 重建合法基线 + supersede 旧 run」；验收必须用
#   真实 ut→testing fixture。
# [P0-c 全采纳] goal 环境 ut_no_src_mutation BLOCKER 缺省 actionability=agent_fixable
#   （goal-failure-classifier.ts:249-256 缺省分支）→ 内容重试，且 source reconciliation
#   被 action!=='retry' 门住（goal-runner.ts:5222）跳过——「harness PASS 后 HALT」会被
#   改造成「harness FAIL 后内容重试」循环仍在。→ T4(d) 钉死：注册表显式 human_only +
#   决策梯特判首触发不派内容重试、直接进 source reconciliation 产
#   unauthorized_source_mutation halt + T3 guidance；验收断言 agent invoke 次数不增。
# [P1-d 采纳] human receipt 签发流程今日不存在——confirmation-receipt.ts:19-21 明文
#   「签发在后继 change confirmation-credential-issuance；registry 通常不存在→一切
#   INVALID 是设计行为」。→ T3(c) guidance 增「签发能力」独立轴（与 HMAC 正交）：runner
#   在 halt 时产 mutation-adjudication-request.json（canonical fingerprint+scope hash+
#   所需 action）；registry/issuer 不可用时诚实只给「还原 / 新起含 coding→review 的 run
#   重验」，不宣传 receipt 路径；registry 缺失文案断言。签发 CLI 本身列显式外部依赖，
#   本 plan 不假闭环。
# [P1-e 采纳并纠正 v2 自误] finalize 因果归因错——writeGoalReport（:5546）在 run_end
#   （:5554）与 finalize 预检（:5565）之前，宿主 4035d4 goal-report Generated=
#   2026-07-22T01:17:13.750Z 实证预算熔断轮报告已更新（缺的是 outcome reason/guidance）；
#   finalize_skipped 只影响 completion receipt 等收尾。→ 删除 v2 T2(d) finalizeDeadline
#   扩展（勿改硬预算语义），overview 归因改写；finalize_skipped 补 reason 字段保留。
# [P1-f 采纳] dry-run 身份未定义清——canonical 契约 report_dir=goal-runs/<run_id>
#   （goal-manifest.ts:254-264 失配即 throw），只改 report_dir 必被拒。→ T1(b) 改为
#   effective run_id=<base>-dry（report_dir 按同一规则派生）+ manifest 记 dry_run_of=
#   <base> + --resume <base> 不可读 dry manifest + 重复 dry-run 以会话追加语义落同
#   -dry 命名空间。
# [P1-g 采纳] events-only 重建丢 guidance——phase_halt 事件（:5297-5304）不携 guidance。
#   → T3/T2 的 halt 路径 phase_halt 事件同携 halt_guidance；T4 增「无 goal-report 仅
#   events 重建」断言。
# v4（2026-07-22，吸收 codex 三轮 3P0+3P1+1P2，逐条 ground-truth 核实后修订）：
# [P0-A 全采纳] goal 模式 ut_no_src_mutation 基线错位——check-ut.ts:748-768 从
#   HARNESS_DIFF_BASE_REF / trace.start_commit 起算 diff（含 coding 阶段全部合法业务
#   改动，宿主实测 ~36 文件），runner reconcileMutablePhaseSourceDrift
#   （goal-runner.ts:2153-2188）用 review closure attestation 基线（review 后仅 1 文件
#   漂移）——T4(d) 若照 v3 直接要求 runner 背书会把合法 coding 实现全打成 BLOCKER。
#   → T4(d) 重设计：抽共享 drift resolver（runner/check-ut 同一实现同一 decision），
#   goal 环境 ut_no_src_mutation 只裁决 review closure 之后的 UT/testing 期漂移；
#   attestation 缺失回退现行为；增「coding 36 文件合法 + review 后 1 文件漂移」回归
#   fixture。非 goal 交互模式维持 trace.start_commit 基线现语义。
# [P0-B 全采纳] -dry 物理隔离仍会污染跨 run 正式真值——四个 goal-runs/* 目录枚举
#   消费点实锤：collectRequirementIntentText（fidelity-shared.ts:256-278，全 manifest
#   requirement 入需求意图文本/hash）、collectRequirementSsotPaths（:286+，入阶段血缘）、
#   scanRunTerminalStates（verify-feature-completion.ts:516-539，「更晚未终局 run」
#   freshness）、resolvePhaseRunIds（:600-614，按最新 phase_start 选各阶段权威 run——
#   更晚的 dry-run 可被选为最新阶段证据）。→ T1(d) 新共享入口
#   listAuthoritativeGoalRuns(feature)（排除 manifest.dry_run_of / -dry 身份），扫替
#   全部 goal-runs/* 枚举点；dry run 仅进显式 audit/UI 路径。
# [P0-C 方向采纳、机制已存在] 崩溃段以段尾事件计时会漏算——但 heartbeat 事件（60s
#   cadence，LOCK_HEARTBEAT_MS goal-runner.ts:291/2484-2559，携 elapsed/turns，宿主
#   events 实测在 agent_invoke/harness 子步每分钟落盘）**就是** codex 建议的持久化活跃
#   检查点：段尾=段内最大事件 ts（heartbeat 计入）时崩溃漏算上界=1 个心跳间隔（60s/段），
#   反复崩溃每段还需付出 agent 冷启动成本，绕预算不成立。→ T2(a) 显式入 spec：段尾
#   取段内最大事件 ts（含 heartbeat）+ 验证 heartbeat 计时器覆盖 agent_invoke/harness/
#   backoff 三子步（缺口补齐）+ 「agent 调用中 hard kill、无 agent_invoke_end/run_end」
#   fixture 断言漏算 ≤1 心跳间隔 + 文档化该诚实边界。不新造 checkpoint 机制。
# [P1-D 采纳] issuerAvailable 定义不真实——registry（confirmation-receipt.ts:111）存
#   的是**验签**密钥非签发能力。→ T3(c) 拆两轴：receiptVerificationConfigured（registry
#   在且可验）/ issuanceRouteAvailable（须显式证据：已配置签发命令/服务，或已存在有效
#   receipt；不得由 registry 推断）；guidance 按后者分层。
# [P1-E 采纳（含事实澄清）] scope hash 未覆盖 source_inventory_before——属实（:88-102
#   仅五字段）；澄清：该字段已由 expectedInventoryHash 外锚校验（:108「全员必验」），
#   签入 scope 是纵深防御非唯一防线。→ T3(b) 定稿版本化 canonical scope（v2：run_id/
#   phase/source_inventory_before/allowed_files/allowed_change_kind/max_files/
#   adjudicated_fingerprint）+ 路径规范化校验（拒绝绝对路径/../重复项）。
# [P1-F 采纳（用既有机制）] 「重启或新 run」提示不准——同 run budget 已冻结（identity
#   hash 含 budget），裸重启不加预算、改 manifest 触发 identity drift；但受控 override
#   已存在（--override-manifest 字段级授权 rebase，goal-runner.ts:1431/1507）。→ T2(c)
#   guidance 定稿：「新 manifest（更新预算）新起 run；或改预算字段后以 --override-manifest
#   授权续跑」，不再出现裸「重启」。
# [P2-G 采纳] -dry 后缀保留字——buildGoalManifestFromInput/newRunId 拒绝用户 run_id
#   以 -dry 结尾（保留后缀），避免与 effective dry identity 混淆。
# v5（2026-07-22，吸收 codex 四轮 2P0+4P1，逐条核实后修订；两条属 v4 自误纠正）：
# [P0-① 全采纳（纠 v4 自误）] pre_authorized_mutations 不得成为放行路——
#   classifySourceDrift（mutation-authorization.ts:210-249）的 classifier 冻结对
#   pre_run_manifest 同样生效且**必须保持**：preauth 只绑文件/kind/数量不绑最终内容，
#   agent 可在授权文件里写任意业务逻辑（重开「业务改码伪装 test seam」旁路）。v4 的
#   T3(c)「有 HMAC 追加 preauth 重启路」与 T4(d)「preauth 覆盖同文件即 PASS」全部撤销。
#   定稿：classifier 落地前**唯一自动裁决路径 = human receipt + 当前 drift fingerprint
#   逐项精确吻合**（人裁决的就是已存在的内容）；preauth 降级为「意图预登记」（入
#   BLOCKER 提示与裁决参考，不放行、不构成 harness PASS）；T3(a) 的输入保真仍修
#   （静默丢弃是 bug）但明示非放行路。
# [P0-② 采纳] 逐段 60s 上界不封累计——N 次 hard-kill 累计漏算 ≤N×60s，且首个
#   heartbeat 前退出的段冷启动全漏。定稿保守补收：无 run_end 的段
#   end = min(下一段首 ts, 段内最大事件 ts + LOCK_HEARTBEAT_MS)（多计 ≤60s/段=安全
#   方向：预算只会更快耗尽不会被拉长）；测试补「连续多次 hard kill 累计预算不可被
#   无限延长」断言。
# [P1-③ 采纳（纠 v4 自误）] 「单一 v2 hash」与「旧 receipt 仍可验」自相矛盾——旧
#   payload.object_hash 按旧五字段算法生成，切 v2 后必失配。定稿：旧 receipt 一律
#   INVALID_SCOPE_VERSION 不进裁决（现网 registry 不存在、零兼容成本），**不留 v1
#   verifier**。
# [P1-④ 采纳] dry-run 身份漏 detach 与 stale lock 两入口——maybeLaunchDetached
#   （goal-runner.ts:2612-2670）在 child 前按 base run_id 建目录/detach.log/报
#   report_dir（--detach --dry-run 身份分裂）；resolveOrphanedIncompleteRun
#   （:2410-2428）按 lock.run_id 提示 resume（dry 崩溃后会指向 <base>-dry，与「dry
#   不可 resume」冲突）。→ T1(b) 补：resolveEffectiveRunIdentity() 在 detach parent
#   前统一调用；stale dry lock 确认失活后允许真实 run 接管 + 审计事件；测试
#   --detach --dry-run 与 dry 崩溃后新起真实 run。
# [P1-⑤ 采纳] 「存在任意有效旧 receipt」不证明签发路当下可用——issuanceRouteAvailable
#   收紧为「显式配置且探测可用的 signer command/service」；「已存在与本次 action/run/
#   scope hash 精确匹配的 receipt」是另一状态=**裁决已可用**（直接走裁决，不表述为
#   签发可用）。
# [P1-⑥ 采纳] 不全局把 ut_no_src_mutation 注册 human_only（该 id 还承载 legacy
#   fallback/stale_diff_base 等机器可修形态）——新专用 blocker id
#   goal_post_review_source_mutation_unresolved（仅 goal 环境 + review 后未授权
#   drift 精确分支发射，注册 human_only）；通用 ut_no_src_mutation 维持缺省；决策梯
#   特判改锚新 id。
# v6（2026-07-22，吸收 codex 五轮 1P0+4P1，逐条核实后修订）：
# [P0 全采纳] goal 环境 attestation 缺失不得回退现行为——v5「attestation 缺失回退
#   现行为」在 goal 模式重新引入 trace.start_commit 基线（coding 合法改动再被纳入）
#   与 gap-notes 自报授权语义，且专用 blocker 无基线可判会落回通用
#   ut_no_src_mutation→agent_fixable→内容重试。定稿：非 goal 交互模式保持现
#   fallback；goal 模式 attestation 缺失/损坏 → 发射专用
#   goal_review_closure_baseline_unavailable（human_only，fail-closed，禁止内容
#   重试，不算 run-start diff、不读 gap-notes 授权）；补「review 后 attestation
#   被删/损坏」回归测试。
# [P1-① 采纳] detach raw/effective 双加 -dry——buildDetachedChildArgv（:2591）把
#   parent 选出的 runId 以 --run-id 回传 child，parent 若传 <base>-dry 且 child 带
#   --dry-run 会二次派生 <base>-dry-dry 或被保留字规则拒绝；且 runDetachLauncher
#   （:2618）不读 --manifest，而 main 中 manifest.run_id 优先（loadGoalManifestFile
#   :2761 / buildGoalManifestFromInput input.run_id 优先已核）→ parent/child 身份可
#   分裂。定稿契约：**child 恒收 raw/base run_id**，effective id 仅用于 parent 的
#   目录/日志/输出；child 由 raw id + dry_run 经同一 resolveEffectiveRunIdentity
#   确定性派生同一 effective id；补测 --detach --dry-run --manifest。
# [P1-② 采纳] 补收公式缺 resume 边界参数契约——resolveResumedBudget 消费的
#   priorEvents 在当前 run_start 写入**之前**加载（:3027 载 → :3084 写 → :3566 用），
#   最后一个崩溃段在 priorEvents 里没有 next_session_start；写后重载又会把当前开放
#   session 计入 priorActiveMs 造成双计。定稿 API：
#   resolveResumedBudget(priorEvents, { nextSessionStartMs: sessionStartMs })——
#   priorActiveMs 只统计历史 session，sessionStartMs 仅作最后一个未闭合历史段的
#   上界（min 取值），不创建/计入当前段；补测「崩溃后 5 秒立即 resume」防重复计时。
# [P1-③ 采纳] issuanceRouteAvailable 无真实 SSOT/生产者——仓库无 signer 配置字段/
#   命令/服务协议（confirmation-receipt.ts:19、MIGRATION.md:63 签发未落地）。定稿
#   二选一取后者：**本 plan 内 issuanceRouteAvailable ≡ false**（具名常量+注释指向
#   confirmation-credential-issuance，落地时只改生产者不改 builder 契约）——guidance
#   在裁决不在场时恒走「签发不可用」分支，不留无法实现却决定文案的悬空布尔。
# [P1-④ 采纳] listAuthoritativeGoalRuns 补 featuresDirRel 形参（与
#   collectRequirementIntentText/collectRequirementSsotPaths 的 featuresDirRel
#   口径一致，不重新硬编码 doc/features）；补非默认 features_dir fixture。
# v7（2026-07-22，吸收 codex 六轮 1P0+3P1，逐条核实后修订）：
# [P0 全采纳] baseline_unavailable 的「补跑 review 后 --resume」不可达——resume 只
#   重入被 halt 的原 phase（resolveResumeState goal-runner-phase.ts:584；4035d4
#   经验实证：ut HALT 后 resume start_phase=ut），不会自动回到 review，截断链更无
#   review 可回。定稿：该 halt 为 run 终态，guidance 只指向**新起 run**——upstream
#   closure 仍 fresh 时新起 review 起点截断链（review→…→testing，重跑 review 闭环
#   即重建 attestation；preflight 的 missingAttestation 检查只对「review 在上游
#   切片」生效，review 为起点时合法）；否则新起 coding 起点 run；旧 run 走既有
#   supersede 语义。不提供当前 run 内出路；明示**不支持**从快照恢复 attestation
#   （attestation 非 pass-snapshot 保护面，本 plan 不扩）。
# [P1-① 采纳] 删 v6 漏改的旧句「attestation 缺失（review 未闭环/legacy）回退现行为」
#   ——与同段 v6 新文直接冲突（实现者可能选错分支）；改为仅限非 goal 交互模式的
#   fallback 表述。
# [P1-② 采纳] dry 判定不得单凭可写 manifest 字段——manifest.json 在 agent 可写面，
#   真实 run 被误写/篡改 dry_run_of 即从 lineage/freshness/evidence 选择中静默消失。
#   定稿结构一致性判定：目录后缀 -dry ∧ manifest.dry_run_of === 剥后缀 base id →
#   dry；两者任一不一致 → corrupt/ambiguous **fail-closed 显式报告**（不静默排除）；
#   legacy 混写目录仍走 session event 过滤，绝不把整个 base run 判成 dry。
# [P1-③ 采纳] detach 还须统一解析 feature——runDetachLauncher（:2618-2627）读
#   manifest 前强制 argv.feature（「--detach 须配 --feature」BLOCKER），feature 仅在
#   manifest 时 parent 提前拒绝而 main 本可解析。定稿：parent 与 main 共用
#   resolveRawRunInput()（一次解析 feature / raw run_id / manifest 路径与一致性；
#   CLI 与 manifest 同时提供 feature/run_id 须一致，冲突 fail-closed）；补测
#   「feature 仅在 manifest」与「CLI/manifest feature 冲突」。
# v8（2026-07-22，吸收 codex 七轮 1P0+2P1，逐条核实后修订）：
# [P0 全采纳] dry 身份异常 fail-closed 缺错误传播契约——现有消费者大量吞异常
#   （collectRequirementIntentText/collectRequirementSsotPaths 单 manifest 与外层
#   catch 均跳过（fidelity-shared.ts:264-276 已核）、scanRunTerminalStates 读取失败
#   仅记未知 run（verify-feature-completion.ts:529-538 已核）、readRunEventLines
#   失败返回空数组），listAuthoritativeGoalRuns 若只 throw 会被上层 catch 吞掉，
#   corrupt run 照旧静默移出 lineage/freshness。定稿返回与传播模型：
#   listAuthoritativeGoalRuns 返回 { runs: AuthoritativeRunRef[],
#   issues: RunIdentityIssue[] }（不 throw）；消费规则=requirement hash/closure/
#   completion/phase-lineage 等**门禁**消费者见 issues.length>0 必须 BLOCKER/INVALID
#   （fail-closed），UI/audit 消费者可显示 issue 但不得视为「无该 run」；验收从
#   **顶层入口**断言（verifyFeatureCompletion、requirement hash/截断链 preflight），
#   不只测 helper。
# [P1-① 采纳] baseline 恢复 guidance 的 freshness 判定来源钉死——attestation 可能
#   在 UT agent 改源码+删 attestation 后才丢失，启动时 fresh ≠ halt 时 fresh。定稿：
#   **halt 现场**重新调用既有 upstream closure/staleness evaluator
#   （recomputePhaseEvidenceStaleness，截断链 preflight 同款）；fresh → review-rooted
#   指引；stale/unknown/corrupt → 一律 coding-rooted；测试两态：「只删 attestation」
#   → review-rooted，「删 attestation + 改源码」→ 不得给 review-rooted。
# [P1-② 采纳] 两处旧 blocker 名残留同步——非目标段（:252）与宿主复验（:671）仍写
#   ut_no_src_mutation，而 CheckResult.id 即 blocker id（types.ts:429）非展示别名；
#   两处改 goal_post_review_source_mutation_unresolved，通用 id 只保留非 goal/legacy
#   语义（历史版本记录与事故描述中的旧名引用如实保留）。
# v9-v20（2026-07-22~23，**已整体撤销的 identity 方案——压缩决策记录**）：这十二个
#   版本在 codex 八至十四轮与自审四轮中，为治「dry 混写/崩溃残留/锁抢占」逐步建起
#   run-identity marker → trust-state identity ledger → project index → COW 双文件
#   事务 → reducer/入口表 → migration/genesis → quarantine 两阶段 → trusted lease →
#   OS process lock/process-instance identity → epoch 退役 → identity doctor →
#   primitive capability spike 的完整体系。v21 裁决：属复杂度自增循环（每修一个新增
#   机制又产生新被审面），且把「agent 能写 workspace」错误升级为「必须建安全边界」
#   ——框架本无 HMAC/broker/OS sandbox，为运行正确性问题建半套安全数据库收益成本
#   严重失衡，全套撤销。留档要点（供未来独立安全 change 参考，不构成本 plan 规范）：
#   ①「pending/垃圾态不毒化只读门禁」原则在该体系中被三次违反三次修复；②枚举消费者
#   吞异常，helper 必须返回结构化结果而非 throw；③agent 可写面字段不可承担排除判定；
#   ④凡引入新状态机必须枚举完整状态空间+崩溃窗+恢复三分支；⑤Windows 无内建
#   flock/mutex，OS 级互斥需 native dep/helper/spike 先行。详细演化过账本会话记录，
#   plan 不再承载。
# v21（2026-07-23，**范围收口回退**——用户 + codex 共同裁决：v9-v20 的 identity
#   基建属复杂度自增循环（identity ledger → ledger 被删 → project index →
#   双文件事务 → fencing 不可靠 → OS process lock → PID 复用 → process
#   instance/boot identity → epoch 退役 → doctor——每修一个新增机制又产生新
#   被审面），且把「agent 能写 workspace」错误升级成「必须建安全边界」：现框架
#   本无 HMAC/broker/OS sandbox，不具备抵御同用户恶意进程的安全模型，为运行
#   正确性问题建半套安全数据库收益成本严重失衡）：
# [回退清单] 撤销 identity ledger / project index / migration+genesis reducer /
#   reserveRunIdentity 入口表 / epoch 退役与 doctor / quarantine 两阶段事务 /
#   identity-reservation lock / trusted lease / marker claim / canonical 路径
#   resolver 体系 / comparison key / T1-0 primitive spike / IDENTITY_* 错误码
#   注册表全套设计（v9-v20 历史块保留作决策审计，不再是规范性内容）。
# [保留清单] T1 收敛为五件小事：(a) preflight 内存 requirement（be1c48 根治）；
#   (b) dry-run 落保留子目录 goal-runs/.dry/<run_id>（同 run_id、独立
#   manifest/events/lock、零共写，canonical 校验加 dry 分支）；(c)
#   loadAuthoritativeEvents 会话过滤（专治既有混写文件）；(d)
#   listAuthoritativeGoalRuns 枚举结构性跳过 .dry 与无 manifest 残留（残留按
#   既有孤儿流程，不建清理机制）；(e) 锁单点修复：同机 owner pid 存活时绝不因
#   heartbeat 超时抢占（busy + 人工处置提示），不建 native mutex/process
#   instance 机制。T2 活跃预算 / T3 授权出路 / T4 阶段真值 / T5 收口全部保留
#   原样（这四块从未膨胀）。
# [威胁模型冻结] 本 plan 只防「正常框架流程误混写」；同用户恶意进程伪造/删除
#   workspace 或 trust 文件不在范围（与框架现状一致）；PID 复用误判窗口接受。
#   更强安全边界（HMAC/broker/sandbox）属独立安全 change，绝不在本 plan 夹带。
# v22（2026-07-23，吸收 codex 十五轮 2P0+1P1+非阻断清理——收口后直接旁路修复，
#   codex 判定「修完即可停止设计 review 进入实施」）：
# [P0-1 全采纳] .dry 隔离未覆盖外部 trust 控制面——vision checkpoint 读取按
#   feature+run_id 寻址不看 report_dir（goal-runner.ts:2882
#   readVisionCheckpointMeta），commitVisionAnchors('run_start') 无 !dryRun 门
#   （:3499；宿主实证=ut2test dry 段 events 里有 vision_ledger_anchor）——同
#   run_id 的 dry-run 仍可读/写真实 run 的外部 checkpoint。定稿保持简单：dry-run
#   **完全跳过** manifest checkpoint drift 比对、reseal recovery、vision
#   head/run checkpoint/HWM 写入及一切外部 trust mutation（capability/config
#   只读可留）；不派生新 identity、不建新账本。验收=dry-run 前后整个
#   goal-checkpoints 目录与 feature vision trust 文件**逐字节不变**。
# [P0-2 全采纳] dry 崩溃后 orphan 流程仍给错误 --resume——feature lock 只记
#   run_id，resolveOrphanedIncompleteRun 固定读 goal-runs/<run_id>/events.jsonl
#   （:2419），dry 实际在 .dry/<run_id>/；per-run lock 固定
#   goal-runs/<run_id>/.runner.lock（:2464），goal-progress 同（:1174）。定稿
#   最小修法：feature lock 增 run_mode: authoritative|dry + canonical
#   report_dir 字段，**feature lock 继续共享**（同 feature 串行——不再声称所有
#   lock 独立，v21「零共写」措辞修正为「run 级文件零共写、feature 级串行锁共享」）；
#   per-run lock 路径从 canonical manifest.report_dir 派生（dry 落 .dry 子树）；
#   orphan 流程按 lock 的 run_mode/report_dir 读对应 events：stale dry owner →
#   **不提示 resume**、真实 run 按既有 stale-lock 流程直接接管；live dry owner →
#   busy；goal-progress 按 manifest.report_dir 读 per-run lock。
# [P1 全采纳] manifest-less 目录不可无条件静默忽略——二分：仅含
#   detach.log/lock/bootstrap 文件且无 events/evidence（be1c48 形态）→ orphan
#   residue 静默排除；**已有 events.jsonl/summary/phase evidence 而 manifest
#   缺失** → 曾启动的 run 被破坏，显式 corrupt blocking diagnostic（helper 不
#   throw——七轮教训：上层吞异常——返回 {runs, corruptRuns}，四类只读 gate 见
#   corruptRuns 非空 → BLOCKER/INVALID，不得静默改选其他 run）。
# [非阻断清理] 「独立 run 身份」措辞改「独立运行目录/物理命名空间」；v9-v20
#   历史压缩为决策记录（本版已做）。
# v23（2026-07-23，吸收 codex 十六轮 1P0+2P1——终局补丁，codex 表态修完即
#   Approve、不再做架构扩展）：
# [P0 全采纳] T5 残留 v21 旧 slim 段（「fully separate lock / residue never an
#   error」）与 v22 新语义（feature lock 共享/残留二分 corruptRuns）直接冲突，
#   OpenSpec delta 会自相矛盾——旧段删除，dry 隔离/枚举/残留语义以 v22 SHALL
#   段为唯一权威。
# [P1-① 全采纳] LockRecord 新增 run_mode/report_dir 需旧记录兼容（宿主升级现场
#   留有仅含 run_id/pid/hostname 的旧 lock）：新 writer 恒写新字段；reader 接受
#   旧记录并默认 goal-runs/<run_id> 读取，再用 loadAuthoritativeEvents 判别——
#   只有 dry session → 按 stale dry orphan 处置不提示 resume；存在 authoritative
#   session → 保持既有 resume 指引；无法判断 → busy/人工处置不猜。补 legacy
#   lock fixture；不做 lock schema 迁移、不建新状态机。
# [P1-② 全采纳，取推荐项] dry-run 的 config 只读约束落验收：
#   pendingAdapterWriteback 在 --override-adapter 时调 recordAdapterToLocal 无
#   !dryRun 门（goal-runner.ts:3017-3018 实核）——dry-run **禁止**
#   framework.local.json 写回与 canary cache 写入（加 !dryRun 门）；
#   framework.local.json 一并纳入 dry-run 前后逐字节不变断言。
overview: >
  【事故样本（2026-07-22 宿主回灌，D:\1.code\SimulatedWalletForHmos，框架部署与
  a6d21eb0 逐字节一致——P1-10 发布包部署已落实；证据全在宿主
  doc/features/bc-openCard/goal-runs/ 下，不搬仓，测试用仓内合成 fixture）】
  ① run 20260722T013058Z-be1c48：新起截断链 ut→testing，preflight 拒启原文
  「截断链核验无法计算当前 run 的 requirement 血缘哈希（goal-runs/20260722T013058Z-be1c48/
  manifest.json 缺失/不可读）——fail-closed，拒绝启动」。代码级实锤：preflight
  （goal-runner.ts:2938-2950）调 computeRunRequirementSha → fidelity-shared.ts:339-340
  从磁盘读 goal-runs/<run_id>/manifest.json，而 writeGoalManifest 在 goal-runner.ts:3024
  才写盘——新起截断链（!dryRun && !resume && chain[0]≠链首）必 fail-closed。宿主 workaround
  =先 dry-run（跳过核验但写 manifest）同 run_id 预埋，再真跑 → run 20260722T013500Z-ut2test
  的 events.jsonl 42 行里 dry-run 段（模拟出 ut INCOMPLETE / testing PASS / run_end
  DEFERRED）与真跑段混写；除 run_start 外事件不携 dry_run 标记，且超时棘轮/advance-blocked
  累计/budget turns/resume 重建等权威消费面全部直接吃 raw events——dry-run 污染不止面板，
  会渗入 runner 自身决策（totalTurns 已实测多计 2 个幻影 invoke，真实首轮成了 ut-i3）。
  ② run 20260721T122632Z-4035d4：07-21 全链 run 活跃总时长约 74m（69m+0+4.8m 三段，
  远小于 wall 480m），07-22 01:17 resume 时 resolveWallClockStartMs
  （goal-runner-phase.ts:392-400）取 events 首条 run_start ts（07-21 12:26）→ 日历跨度
  ~772m > wallMs → 循环首步 checkRunBudget 即熔断：resume → budget_wall_clock → 9ms 后
  run_end HALTED。死因不可见的准确归因（v3 修正）：该路径 outcome push
  （goal-runner.ts:3716-3721）不带 halt_reason，run_end 的 halt_reason 依赖
  resolveLastHaltReason(outcomes):5553 → run_end 裸 HALTED；goal-report **有**更新
  （writeGoalReport :5546 在 finalize 预检 :5565 之前；宿主该 run 报告 Generated=
  01:17:13.750 实证）但同样无 reason/guidance 可渲染；finalize_skipped 只跳过 completion
  receipt 等收尾，非报告。与求人闭环「halt→人处理→隔夜 resume」设计主路径直接矛盾：
  resume 必死，且死因不可见。
  ③ ut agent 违反 prompt 保守默认自签实施 test seam（headless-assumptions ut-003 reject
  → ut-006 implement approved seam，自引 gap-notes），unauthorized_source_mutation 门禁
  两次拦截（20260718 自签事故防护，方向正确）。但结构性分裂在于**双账本**：check-ut 的
  ut_no_src_mutation 采信 agent 自写 gap-notes approved_src_mutations[]（check-ut.ts:833，
  交互模式「真人同意后登记」语义在无头下退化为自签即过）→ harness PASS；runner 三源链
  拒绝自签 → phase_halt——同一变更 harness 说合法、runner 说违规，agent 每轮 fresh
  context 读到 gap-notes「已批准」就会重新实施，还原也止不住循环。且**当前代码没有任何
  可自动续跑的授权出路**：pre_authorized_mutations 被 buildGoalManifestFromInput 静默
  丢弃（goal-manifest.ts:270-289 未复制，宿主 identity hash 里该字段恒为 null 之哈希）；
  无 HMAC 部署下 pre_run_manifest 被明确拒绝（mutation-authorization.ts:184-192）；
  human receipt 全合规也因 change-kind 分类器未实现而固定返回 unauthorized
  （:236-249，authorized_backtrack 分支 goal-runner.ts:5229 不可达）；且即便分类器放行，
  真人 confirmation receipt 今日也签不出来（confirmation-receipt.ts:19-21：签发在后继
  change，registry 通常不存在→一切 INVALID 属设计行为）；即便签出来，宿主 ut→testing
  截断链的 backtrack 也到不了 coding/review（goal-runner.ts:5244 chain.indexOf('coding')
  =-1 → to_phase=ut，drift 相对旧 review attestation 仍在，下轮撞 backtrack_limit）
  ——现行 halt banner「写入授权 receipt 后 --resume」按今日代码照做仍会再次 HALT，
  属既有过度承诺，多重阻断须逐一拆除或诚实声明。
  投影侧还有阶段真值缺口：goal-progress 只吃 phase_verdict（goal-progress.ts:295），
  phase_halt 不落 span → 面板显示 ut PASSED/run HALTED 撕裂；rebuildOutcomesFromEvents
  同（goal-runner-phase.ts:494-524），goal-report.json 缺失时 resume 可把已 HALT 的
  phase 重建成合法 PASS；unauthorized 分支 outcome 硬编码 FAIL 且不快照 harness 证据
  （snapshotPhaseHarness 只在 advance 分支 :5317+）——UT 实测 14/14 device PASS 在报告
  里呈现为「ut FAIL / Summary —」。
  【非目标（明示边界，防 review 误判）】不放宽三源授权语义（human/runner_policy/
  pre_run_manifest 三源不增不减；RUNNER_MUTATION_POLICIES 空表不动；agent 自产
  gap-notes/自签 approved_by 依旧不构成授权）；不实现 diff 内容级 change-kind 自动分类器
  （人工裁决 receipt 是它的显式替代，分类器仍留 openspec 待办）；**不在本 plan 实现
  confirmation receipt 签发 CLI**（属后继 change confirmation-credential-issuance，
  列显式外部依赖——签发不可用时 guidance 诚实降级，不假闭环）；不做受控 chain expansion
  （截断链回退取方案 1：引导新起含 coding→review 的 run）；unauthorized_source_mutation
  不进 P0-4 actionability 注册表（7c4f2e9b v7「runner 专用安全控制流排除项」定稿——
  goal 环境专用 goal_post_review_source_mutation_unresolved /
  goal_review_closure_baseline_unavailable 的 human_only 注册是 summary blocker 侧，二者控制区
  不同）；不改 upstream closure staleness/attestation 判定；不改硬预算 deadline 语义
  （v2 finalizeDeadline 扩展已删）；不 bump 版本。
  【目标效果】新起截断链免 dry-run 预埋直接可启；dry-run 与真实 run 控制面彻底隔离
  （独立运行目录/物理命名空间），权威消费面只吃 authoritative events；隔夜 resume 按真实活跃时间
  续跑，真耗尽时 halt 的 reason/guidance 全链（outcome/run_end/phase_halt 事件/报告）
  可见；授权出路按能力真值诚实分层——全链 run + 有效裁决 receipt 可接通
  authorized_backtrack 重验，截断链/无签发能力时明确指向「新起 coding→testing run
  重建合法基线」，绝不指一条走不通的路；harness 真值/transition 分轴呈现，phase_halt
  全链投影一致，gap-notes 自签在 goal 环境不再制造 harness/runner 分裂也不再转化为
  内容重试循环。
baseline: >
  【基线=HEAD a6d21eb0（2026-07-21 19:44，plan 7c4f2e9b 全量+六轮 post-impl review）】
  代码工作区无未提交改动（仅一份无关 android plan md 改动，不触碰）。宿主框架部署与该
  HEAD 逐字节一致（抽查 pass-snapshot/goal-runner/goal-timeout/claude-envelope sha256
  相同）——本 plan 修复落库后需重新出发布包部署宿主方可生效。关键符号现行锚点（实施以
  符号定位为准）：截断链 preflight goal-runner.ts:2938-2950；writeGoalManifest 调用
  :3024；computeRunRequirementSha fidelity-shared.ts:332-360（另两处消费
  check-receipt.ts:1086、verify-feature-completion.ts:446/886 均为盘上权威 manifest
  场景，语义不动）；appendEvent goal-runner.ts:412-416；run_start 无条件追加 :3084-3091；
  resolveWallClockStartMs/resolveResumedBudget goal-runner-phase.ts:392-407；budget
  预检三路径 goal-runner.ts:3704-3723 / 3887-3900 / 4499-4506；wallDeadlineMs :3608；
  sinceMs 消费面 :3834/:3838/:4588-4595；报告生成→run_end→finalize 预检顺序
  :5546-5572；halt_guidance 附着白名单 :5446-5454；source reconciliation 门
  :5222；authorized_backtrack 分支 :5229-5294（backtrack_limit :5230、codingIdx
  :5244）；unauthorized 分支 :5296-5314；snapshotPhaseHarness advance 分支 :5317+；
  guidance builders utils/await-confirm-guidance.ts；报告渲染
  goal-report-generator.ts:392-401；goal-progress phase_verdict 消费
  goal-progress.ts:295-323；rebuildOutcomesFromEvents goal-runner-phase.ts:494-524；
  buildGoalManifestFromInput goal-manifest.ts:244-289（canonical report_dir 校验
  :254-264）；pre_authorized_mutations 字段 :64-70；receipt schema/scope hash/三源
  判定/classifier mutation-authorization.ts:26-57 / 88-102 / 105-202 / 214-260；
  confirmation receipt 信任模型与签发边界 confirmation-receipt.ts:1-45；actionability
  缺省 goal-failure-classifier.ts:249-256；gap-notes 授权消费 check-ut.ts:663/833-883、
  utils/git-diff.ts:276-300、prompts/verify-ut.md:36-37。
todos:
  # ==========================================================================
  # T1 P0 —— 截断链 preflight 鸡生蛋 + dry-run 控制面隔离（独立运行目录）
  # ==========================================================================
  - id: t1-truncated-preflight-and-dryrun-isolation
    content: >
      P0 截断链 preflight 改内存 requirement 口径；dry-run 以保留子目录物理隔离；
      枚举面结构性跳过；孤儿锁单点修复。**范围纪律（v21 收口）：威胁模型冻结为
      「防正常框架流程误混写」，不防同用户恶意进程伪造 workspace——现框架本无
      HMAC/broker/OS sandbox 安全模型，运行正确性问题不建安全数据库；v9-v20 的
      identity ledger/project index/migration reducer/epoch/doctor/native lock/
      跨文件事务全套设计撤销（历史块保留作决策审计）。**
      【行为】(a) preflight 内存口径（be1c48 事故直接根治）：fidelity-shared.ts
      抽内容级纯函数 computeRequirementShaFromText(projectRoot, feature,
      requirement, featuresDirRel)——现 computeRunRequirementSha 的 parts 组装体
      （inline requirement + deref 文档 + ux-reference 摘要）原样搬入；
      computeRunRequirementSha 变薄 wrapper，两口径**共用同一组装代码路径**
      （sha 逐字节同构，closure 记录与 preflight 重算比对语义不变）。preflight
      （goal-runner.ts:2943）改传内存 manifest.requirement；requirement 空/空白仍
      BLOCKER fail-closed。check-receipt / verify-feature-completion 的读盘
      wrapper 场景不动（盘上 manifest 是权威冻结源）。
      (b) dry-run 保留子目录隔离：dry-run 的 report_dir 固定为
      **goal-runs/.dry/<run_id>/**（run_id 不变，无后缀派生、无身份账本），
      manifest/events/progress/phases/per-run lock 全套独立落于该子树——**run 级
      文件零共写；feature 级串行锁仍共享**（v22 P0-2 措辞修正：同 feature 串行是
      设计目标，不声称所有 lock 独立）；canonical report_dir 校验
      （goal-manifest.ts:254-264）按 dry 模式接受 .dry 前缀路径；`.dry` 天然保留
      （run_id 校验拒绝以 . 开头，不冲突）；dry-run 所有事件仍全量携
      dry_run:true（appendEvent module 级 base-fields，双保险）；--resume 不接受
      .dry 下的 run（dry 无 resume 语义）。detach parent 与 main 共用
      resolveRawRunInput()（一次解析 feature / run_id / manifest 路径与一致性；
      feature 仅在 manifest 时 parent 不再提前拒绝；CLI 与 manifest 同时提供且
      冲突 → fail-closed）；--detach --dry-run 下 parent/child 由同一规则派生
      同一 .dry 路径，不再身份分裂。
      (b') 外部 trust 控制面隔离（v22 P0-1）：dry-run **完全跳过**一切外部 trust
      读写与修复——manifest checkpoint drift 比对（readVisionCheckpointMeta 按
      feature+run_id 寻址不看 report_dir，goal-runner.ts:2882）、reseal recovery、
      vision feature head/run checkpoint/HWM 写入（commitVisionAnchors 现无
      !dryRun 门，:3499；宿主实证=ut2test dry 段 events 含 vision_ledger_anchor）
      及其他 trust mutation 全部加 !dryRun 门；capability/config **只读**——
      dry-run 禁止 framework.local.json 写回（pendingAdapterWriteback →
      recordAdapterToLocal 现无 !dryRun 门，goal-runner.ts:3017-3018，v23 P1-②）
      与 canary cache 写入；不派生新 identity、不建新账本，保持简单。
      (b'') 锁与 orphan 按 report_dir 改址（v22 P0-2）：feature lock record 增
      run_mode: authoritative|dry 与 canonical report_dir 字段；per-run lock 路径
      从 canonical manifest.report_dir 派生（dry 落 .dry 子树，:2464 现固定
      goal-runs/<run_id>/ 需改）；resolveOrphanedIncompleteRun（:2419 现固定读
      goal-runs/<run_id>/events.jsonl）改按 lock 的 run_mode/report_dir 读对应
      events——stale dry owner → **不提示 --resume**（dry 无 resume 语义），
      真实 run 按既有 stale-lock 流程直接接管；live dry owner → busy（防并发）；
      goal-progress（goal-progress.ts:1174）按 manifest.report_dir 读 per-run
      lock。**旧 lock 记录兼容**（v23 P1-①，宿主升级现场）：新 writer 恒写
      run_mode/report_dir；reader 接受仅含 run_id/pid/hostname 的旧记录，默认按
      goal-runs/<run_id> 读取，再以 loadAuthoritativeEvents 判别——events 只有
      dry session → 按 stale dry orphan 处置不提示 resume；存在 authoritative
      session → 保持既有 resume 指引；无法判断 → busy/人工处置不猜；不做 lock
      schema 迁移、不建新状态机。
      (c) authoritative 访问器兜底 legacy 混写：新
      loadAuthoritativeEvents(eventsPath)（= loadEventsJsonl + 按会话段过滤
      dry-run 段，段判定复用 T2 的 partitionExecutionSessions），**全消费面
      扫替**——凡从 events 派生权威状态者（超时棘轮 priorAttemptDurationsMs、
      advance-blocked 累计、transient 重试计数、continuation cause、回退次数、
      resolveResumedBudget、rebuildOutcomesFromEvents、budget turns、报告/进度
      投影、supersede 审计、ledger 对账期望集）一律改走 authoritative；纯审计
      读取显式豁免并逐处注释。新目录布局下 dry 事件天然不进真实 run 文件，
      访问器专治既有混写文件（ut2test 形态）。
      (d) 枚举面结构性跳过 + 残留二分：新共享入口
      listAuthoritativeGoalRuns(projectRoot, feature, featuresDirRel?)
      （featuresDirRel 与既有枚举器同口径，不重新硬编码 doc/features），**不
      throw**（七轮教训：上层枚举消费者吞异常），返回 { runs, corruptRuns }——
      枚举 goal-runs/*，**结构性跳过 .dry 子树**；无 manifest.json 的目录**二分**
      （v22 P1）：仅含 detach.log/lock/bootstrap 文件且无 events/evidence
      （be1c48 形态）→ orphan residue 静默排除（不报错、不建清理机制，再次启动
      按既有 resolveOrphanedIncompleteRun 孤儿流程处置）；**已有 events.jsonl/
      summary/phase evidence 而 manifest 缺失** → 曾启动的 run 被破坏，入
      corruptRuns——requirement hash / closure / completion / phase-lineage 四类
      gate 消费者见 corruptRuns 非空必须 BLOCKER/INVALID（fail-closed，不得静默
      改选其他 run）。扫替四个既有枚举消费点
      （collectRequirementIntentText（fidelity-shared.ts:256-278）/
      collectRequirementSsotPaths（:286+）/ scanRunTerminalStates
      （verify-feature-completion.ts:516-539）/ resolvePhaseRunIds（:600-614））
      及实施时全库 grep goal-runs 枚举补全；dry run 仅进显式 audit/UI 路径。
      **不引入 ledger/index/事务/迁移——目录名即隔离边界。**
      (e) 孤儿锁单点修复：isLockStale 语义收紧——同机 lock 且 record.pid 对应
      进程**仍存活**时，无论 heartbeat 多旧一律不判 stale、不抢占（返回 busy +
      「owner 进程 <pid> 仍在运行，请人工处置」提示）；仅 pid 已消失（或既有
      跨机语义）才按现流程接管。PID 复用误判在冻结威胁模型内接受（正常流程
      窗口极小），不建 process-instance/boot-id 机制、不引入 native OS mutex。
      【验收】unit：两 sha 口径同 fixture 等值；「盘上无 manifest.json 的新起
      截断链」不再拒启（be1c48 场景复现修复）；dry-run 后同 run_id 真跑——真实
      run 目录零 dry 文件、events 零 dry-run 行、totalTurns/invoke 序号从 1 起
      （宿主 ut-i3 现象消失）；.dry resume 拒绝/canonical 校验 dry 分支各断言；
      --detach --dry-run（含 --manifest 组合、feature 仅在 manifest）parent/child
      同路径、CLI/manifest 冲突 fail-closed；枚举面断言：存在更晚 .dry run 与无
      manifest 残留目录时，需求 intent hash/阶段血缘/completion freshness/
      resolvePhaseRunIds 的权威选择均不变；loadAuthoritativeEvents 对 legacy
      混写 fixture（ut2test 形态合成）正确剔除 dry-run 段；锁修复断言：pid 存活
      + heartbeat 超阈值 → 不抢占返回 busy，pid 消失 → 现流程接管；非默认
      paths.features_dir fixture 下枚举隔离仍生效；**trust/config 零触碰断言**
      （v22 P0-1 + v23 P1-②）：dry-run 前后整个 goal-checkpoints 目录、feature
      vision trust 文件**与 framework.local.json** 逐字节不变（含 head/
      checkpoint/HWM/reseal 全家；--override-adapter --dry-run 组合不写回），
      真实 run 回归不变；**legacy lock fixture**（v23 P1-①）：旧格式 lock
      （无 run_mode/report_dir）三态判别——仅 dry session 不提示 resume、有
      authoritative session 保持既有指引、无法判断 busy；
      **dry orphan 断言**（v22 P0-2）：dry child 崩溃留 stale feature lock 后
      新起真实 run——不出现「--resume <run_id>」提示、按既有 stale 流程接管成功；
      live dry owner → busy；goal-progress 对 dry run 按 .dry 路径读到 per-run
      lock；**残留二分断言**（v22 P1）：bootstrap-only 目录（仅 detach.log/lock）
      → 静默排除零 issue；有 events/summary 无 manifest → 入 corruptRuns 且四类
      gate BLOCKER/INVALID（从顶层入口打，不只测 helper）；消费面扫替后全量
      unit 回归。
  # ==========================================================================
  # T2 P0 —— wall-clock 活跃预算（统一分段纯函数）+ budget halt 可解释性
  # ==========================================================================
    status: completed
  - id: t2-active-time-budget
    content: >
      P0 wall-clock 预算按活跃时间累计，分段/turns/起点单点产出；budget halt 补
      reason/guidance 全链可见。
      【行为】(a) goal-runner-phase.ts 新纯函数 partitionExecutionSessions(events)：
      按 run_start 切会话段（已证实 run_start 每次进程启动无条件追加含 resume 会话，
      goal-runner.ts:3084-3091 + 4035d4 实测，codex 二轮确认；防御性容错：无 run_start
      的孤儿段以 resume 事件兜底为段首），段尾 = 本段 run_end ts；**无 run_end 的段
      （崩溃/hard-kill）保守补收一个心跳周期：end = min(下一段首 ts, 段内最大事件 ts +
      LOCK_HEARTBEAT_MS)**（codex 四轮 P0-②定稿——heartbeat 事件 60s cadence
      （LOCK_HEARTBEAT_MS goal-runner.ts:291/2484-2559）是持久化活跃检查点；补收后
      每段误差方向翻转为**多计 ≤1 心跳间隔**=安全方向，预算只会更快耗尽，N 次连续
      hard-kill 的累计漏算=0，绕预算不成立；首个 heartbeat 前退出的段也被补收覆盖。
      不新造 checkpoint 机制）；段 mode = dry_run（段首 run_start.dry_run===true 或
      段内全事件携标）| authoritative。实施时验证 heartbeat 计时器覆盖 agent_invoke/
      harness/backoff 三子步（现锚 :2484 定时器），缺口补齐。**resume 边界参数契约**
      （codex 五轮 P1-②）：priorEvents 在当前 run_start 写入前加载（:3027→:3084→:3566
      时序），最后一个未闭合历史段无 next_session_start——API 定为
      resolveResumedBudget(priorEvents, { nextSessionStartMs: sessionStartMs })：
      priorActiveMs 只统计历史 session，nextSessionStartMs 仅作最后一个未闭合历史段
      补收的 min 上界，**不创建、不计入当前段**（当前段由 elapsed =
      priorActiveMs + (Date.now() − sessionStartMs) 承载，不得双计）。
      单点产出 {authoritativeEvents, priorActiveMs（Σ authoritative 段时长）,
      totalTurns（仅 authoritative 段 agent_invoke_start 计数——修 dry-run 幻影 turn）,
      firstAuthoritativeStartMs（首个非 dry-run 段起点——修 sinceMs 取到 dry-run 起点）}；
      resolveResumedBudget 改由其派生。
      (b) goal-runner 侧：sessionStartMs = Date.now()（进程起点）；预算 elapsed =
      priorActiveMs + (Date.now() - sessionStartMs)（:3707 checkRunBudget 改传此值）；
      wallDeadlineMs = sessionStartMs + max(0, wallMs - priorActiveMs)（:3608）——07-13 案
      deadline 硬上界语义（agent/harness/backoff 三路径 pre-check + FINALIZE_RESERVE
      先扣）**完全不变**，只换基点（v2 的 finalizeDeadline 扩展已删——codex 二轮 P1-e：
      goal-report 本就在 finalize 预检前生成，4035d4 报告 Generated=01:17:13.750 实证；
      finalize_skipped 只影响 completion receipt 等收尾，不需要也不应该为 HALTED 扩
      deadline）。sinceMs 消费面（:3834/:3838/:4588-4595）改用
      firstAuthoritativeStartMs（真实时间线 mtime 过滤，绝不喂合成时间——否则跨夜 resume
      丢上一段 partial 产物回喂面）。
      (c) 可解释性：三条 budget 预检路径（:3704-3723 / :3887-3900 / :4499-4506）统一补
      halt_reason（budget_wall_clock / budget_turns）+ halt_guidance（新
      buildBudgetExhaustedGuidance，await-confirm-guidance.ts 同址：说明预算计活跃时间、
      真耗尽出路=**新 manifest（更新 wall_clock_minutes / max_total_turns）新起 run；
      或修改预算字段后以 --override-manifest 字段级授权续跑**——codex 三轮 P1-F：同 run
      budget 已入 identity hash 冻结，裸「重启」不加预算且改 manifest 触发 identity
      drift，文案不得出现；override 机制既有 :1431/1507 不新造）+ console banner +
      **phase_halt 事件同携 halt_guidance**（codex 二轮 P1-g：goal-report.json 缺失走
      events-only 重建时 guidance 不得丢失）；finalize_skipped 事件补 reason 字段
      （如实说明跳过的是收尾非报告）。
      【验收】unit partitionExecutionSessions：initial run / 两次 resume / 崩溃段无
      run_end / **agent 调用中 hard kill（无 agent_invoke_end/run_end，段内有
      heartbeat）→ 保守补收后 priorActiveMs ≥ 实际活跃（不欠计）** / **连续 N 次
      hard-kill → 累计 priorActiveMs ≥ 累计实际活跃（预算不可被拉长，codex 四轮
      P0-②）** / 首个 heartbeat 前即杀 → 该段仍计入补收时长 / **崩溃后 5 秒立即
      resume → 补收段以 nextSessionStartMs 截断、无与当前段的重复计时（codex 五轮
      P1-②）** / dry-run→real / 旧日志仅
      run_start 携 dry_run / 空 events / 乱序容错；回归「隔夜 resume 活跃 74m<480m →
      budget ok 续跑」（4035d4 实况合成）；「resume 前预算已耗尽 → 立即 halt，
      outcome/run_end/phase_halt 三处携 halt_reason，goal-report 呈现 guidance 且文案
      为新 run/override 两路」；sinceMs 消费面不回退（partial 回喂 fixture）。
  # ==========================================================================
  # T3 P0 —— 授权出路真实化（输入保真 + 签名绑定的人工裁决 + 能力分层诚实 guidance）
  # ==========================================================================
    status: completed
  - id: t3-mutation-authorization-real-exit
    content: >
      P0 unauthorized_source_mutation 从「可解释」升级为「可恢复或诚实不可恢复」：
      多重阻断逐一拆除，拆不掉的如实分层。
      【行为】(a) manifest 输入保真：buildGoalManifestFromInput（goal-manifest.ts:244-289）
      复制并 shape 校验 pre_authorized_mutations（逐条 phase/allowed_files 非空/
      allowed_change_kind 枚举/max_files 正整数/approved_by；非法条目整单拒绝 fail-closed，
      不静默丢弃）——修「用户写进 YAML 的预授权被静默丢掉」（顺带修复 identity hash 该
      字段恒 null 的名存实亡）。**定位=意图预登记，非放行路**（codex 四轮 P0-①）：
      classifier 冻结（mutation-authorization.ts:210-249）对 pre_run_manifest 同样
      生效且保持——preauth 只绑文件/kind/数量不绑最终内容，classifier 落地前不构成
      自动 PASS 或 harness 放行；其作用=进 BLOCKER 提示（「该文件已预登记意图」）与
      人工裁决参考。无 HMAC 部署下 pre_run_manifest 另被三源判定拒绝
      （:184-192 语义不动——那也是对的）。
      (b) 人工裁决 receipt——签名绑定 + 回退能力判定（codex 二轮 P0-a/P0-b 定稿）：
      ① fingerprint 规范化：entries=[{op: added|modified, path: canonical posix rel,
      sha256: 内容哈希}] 稳定排序 + domain separation 前缀 + stableStringify → sha256
      （deleted 恒不可授权语义不动；op 变化即失配）。
      ② **fingerprint 进签名范围（版本化 canonical scope）**：
      mutationAuthorizationScopeHash（mutation-authorization.ts:88-102）升 v2——签入
      run_id / phase / **source_inventory_before** / allowed_files /
      allowed_change_kind / max_files / adjudicated_drift_fingerprint ?? null
      （codex 三轮 P1-E；单一 hash 定义带版本前缀，不留双实现。事实澄清：
      source_inventory_before 已由 expectedInventoryHash 外锚必验（:108），签入 scope
      属纵深防御非唯一防线）；allowed_files/fingerprint 路径**规范化校验**：仅接受
      正斜杠项目相对路径，拒绝绝对路径 / 含 .. / 重复项（fail-closed）。human 源的
      confirmation receipt payload.object_hash 绑定该 scope hash——agent 签发后改写
      JSONL 的 fingerprint/范围任一字段即哈希失配 INVALID。**旧 receipt（v1 五字段
      scope）一律 INVALID_SCOPE_VERSION 不进裁决**（codex 四轮 P1-③：旧
      payload.object_hash 按旧算法生成，切 v2 必失配——明确失效理由文案，不留 v1
      verifier；现网 registry 不存在、零兼容成本，v4「旧 hash 仍可验」表述撤销）。
      classifier 落地前**唯一自动裁决路径**（codex 四轮 P0-①）：classifySourceDrift
      仅在「有效 human receipt ∧ fingerprint 存在 ∧ 与当前 drift 逐项精确吻合」时
      返回 authorized_backtrack；pre_run_manifest / runner_policy（空表）/ 无
      fingerprint 的 receipt 一律维持 unauthorized——防「业务改码伪装 test seam」
      借 preauth 文件域旁路。
      ③ 回退能力判定（方案 1，简单安全）：runner 侧 authorized_backtrack 分支仅当
      **当前 chain 同时含 coding 与 review** 才执行原 run 回退（:5229-5294 既有机制，
      消耗回退预算）；截断链（如 ut→testing，chain.indexOf('coding')=-1，:5244 实锤
      回退只会到 chain[0]）即使裁决有效也不回退——halt_reason=
      authorized_mutation_requires_full_chain + guidance「新起 coding→testing run
      重建合法基线（coding 期实现该变更→review 重审→ut/testing 重验），旧 run 以既有
      supersede 语义废弃」。不做受控 chain expansion（非目标）。
      (c) 能力分层诚实 guidance（codex 二轮 P1-d + 三轮 P1-D：签发能力与 HMAC 是独立
      轴，且**验签配置≠签发能力**——registry（confirmation-receipt.ts:111）存的是验签
      密钥）：新 buildUnauthorizedMutationGuidance（await-confirm-guidance.ts 同址
      纯函数），输入 {manifestIdentityAuthenticated,
      receiptVerificationConfigured（trust registry 在且可验）,
      issuanceRouteAvailable（**本 plan 内 ≡ false 具名常量**——codex 五轮 P1-③：
      仓库现无 signer 配置字段/命令/服务协议（confirmation-receipt.ts:19、
      MIGRATION.md:63 签发未落地），不留无法实现却决定文案的悬空布尔；常量注释指向
      confirmation-credential-issuance，落地时只改生产者不改 builder 契约。语义上
      仍不得由 registry 存在或历史 receipt 推断，codex 四轮 P1-⑤）,
      adjudicationAlreadyAvailable（已存在与本次 action/run/scope hash
      **精确匹配**的有效 receipt——此态=裁决已可用，直接指引 --resume，非「签发可用」）,
      chainHasCodingReview} 五轴，输出**只含当下真正可走的路**：
      • 签发路可用 ∧ 全链 → 人工裁决 receipt（附 runner 生成的
      mutation-adjudication-request.json：canonical fingerprint + scope hash + 所需
      action + receipt 字段模板）→ --resume 走回退重验；
      • 签发路可用 ∧ 截断链 → 裁决后新起 coding→testing run（(b)③ 文案）；
      • 裁决已可用（存在精确匹配 receipt）→ 直接指引 --resume（全链回退重验 /
      截断链新起链，按 chainHasCodingReview 分流）；
      • 签发路不可用（registry 缺失，或仅可验签而无签发证据）→ 只给「还原后 --resume」
      或「新起 coding→testing run 在 coding 期合法实现该变更」，**明示 human receipt
      当前签发不可用**（confirmation-receipt.ts:19-21 设计行为）。
      恒有：agent 自产 gap-notes/自签不构成授权；**pre_authorized_mutations 在任何
      信任态下都只是意图预登记，classifier 落地前不构成放行路，guidance 不得将其
      列为出路**（codex 四轮 P0-①，v4 表述撤销）。runner 在 halt 时落
      mutation-adjudication-request.json（report_dir 下，含 fingerprint/scope hash），
      供未来签发或人工核对；**签发 CLI 属显式外部依赖**（confirmation-credential-issuance
      后继 change），本 plan 不实现不假闭环。console banner（goal-runner.ts:5306-5308
      手写串）改由 builder 渲染，outcome push（:5310）与 **phase_halt 事件**（:5297-5304，
      codex 二轮 P1-g）均附 halt_guidance——banner/事件/报告单 SSOT；halt_guidance 附着
      白名单（:5446-5454 枚举）改「有 guidance 即附着」。
      【验收】unit：manifest 保真（YAML→manifest 逐字段 + 非法条目 fail-closed + identity
      hash 随字段变化）；fingerprint 负例全套（签发后改 JSONL fingerprint→scope hash
      失配 INVALID / 替换文件内容→fingerprint 失配 unauthorized / modified 改
      added→失配 / 旧 receipt 无 fingerprint→不入裁决 / 绝对路径与 ..
      与重复项→规范化校验 fail-closed）；正例 fingerprint 吻合 ∧ 全链
      →authorized_backtrack；**真实 ut→testing 截断链 fixture**：裁决有效 →
      authorized_mutation_requires_full_chain halt + 新起链 guidance（不是回退也不是
      backtrack_limit）；guidance builder 五轴组合文案断言（registry 缺失、「仅可验签
      无签发证据」、「仅存在历史无关 receipt」三态文案均必现「签发不可用」；精确匹配
      receipt 态文案=裁决已可用非签发可用；**任何信任态文案均不得出现
      pre_authorized_mutations 出路**）；preauth 负例：已冻结 preauth 覆盖同文件但无
      fingerprint 吻合裁决 → 仍 unauthorized（classifier 冻结保持）；
      adjudication-request.json 落盘内容断言；INVALID_SCOPE_VERSION 旧 receipt 负例。
  # ==========================================================================
  # T4 P1 —— 阶段真值：phase_halt 投影/重建 + 证据快照前置 + gap-notes 双账本对齐
  # ==========================================================================
    status: completed
  - id: t4-phase-halt-truth-and-evidence
    content: >
      P1 halt 阶段真值全链一致：投影、重建、报告、证据、双账本、actionability 路由。
      【行为】(a) 投影：goal-progress（goal-progress.ts:295-323）增 phase_halt 消费——
      覆盖同 phase 在先的 provisional verdict（span 终态 HALTED/halted=true/ended_at），
      current phase 固定为 halt 发生 phase（面板不得显示「ut PASSED·当前 testing·run
      HALTED」撕裂）。(b) 重建：rebuildOutcomesFromEvents（goal-runner-phase.ts:494-524）
      消费 phase_halt——同 phase 的 halt 覆盖其前 phase_verdict，重建 outcome 携
      halted:true + halt_reason + halt_guidance（T2/T3 已保证事件携带）；回归
      「PASS/advance → phase_halt → run_end HALTED 且 goal-report.json 缺失 → resume
      不得跳过该 phase、guidance 不丢」。
      (c) 证据快照前置：源码漂移处置（authorized_backtrack/unauthorized 两分支）前先
      snapshotPhaseHarness（现仅 advance 分支 :5317+）；unauthorized outcome 改
      verdict=harness 真值（如 PASS）+ halted:true + halt_reason 轴分离（不再硬编码
      FAIL），并携 summary_path/report_dir——goal-report 呈现「ut: harness PASS ×
      transition HALTED × unauthorized_source_mutation」而非「ut FAIL / Summary —」。
      resume/upstream gate 消费面同步核查：halted:true 必须门住 advance 语义（verdict
      PASS 不得被当作可跳过），逐消费点回归。
      (d) gap-notes 双账本对齐 + 基线统一 + actionability 路由（codex 二轮 P0-c +
      三轮 P0-A 定稿）：**基线先行**——goal 编排环境（isGoalOrchestrationEnv）下
      ut_no_src_mutation 的漂移判定改用 **review closure attestation 基线**（与 runner
      reconcileMutablePhaseSourceDrift goal-runner.ts:2153-2188 同源），抽共享 drift
      resolver（utils 单实现，runner 与 check-ut 消费同一 decision，不各写一套）——
      只裁决 review 完成后发生的 UT/testing 期漂移；coding 阶段的合法业务改动
      （trace.start_commit 起算的全量 diff，宿主实测 ~36 文件）**不在裁决域**，否则
      按 v3 直接要求 runner 背书会把合法实现全打成 BLOCKER（check-ut.ts:748-768 现
      基线=HARNESS_DIFF_BASE_REF/trace.start_commit，与 runner 基线错位实锤）；
      attestation 缺失时的处置**按环境分流**（goal 环境 fail-closed，见下文
      baseline_unavailable 段——v6 旧句「回退现行为」已删（codex 六轮 P1-①）；仅
      **非 goal 交互模式**保持现 fallback）。在此基线上：自签 gap-notes
      approved_src_mutations[] 登记不再构成放行——review 后漂移仅当「无漂移」或
      「存在 fingerprint 精确吻合的有效 human 裁决 receipt」方可 PASS（codex 四轮
      P0-①：**已冻结 pre_authorized_mutations 覆盖同文件不构成 PASS**——preauth 不绑
      最终内容，classifier 冻结前放行=重开业务改码伪装 seam 旁路；preauth 仅进
      BLOCKER 提示作意图参考；裁决后走 backtrack 重验链，重验后新 attestation 含该
      变更、drift 自然归零），否则发射**新专用 blocker id
      goal_post_review_source_mutation_unresolved**（codex 四轮 P1-⑥：不全局改
      ut_no_src_mutation——该 id 还承载 legacy fallback/stale_diff_base 等机器可修
      形态，维持缺省；新 id 仅在 goal 环境 + review 后未授权 drift 精确分支发射，
      注册表显式 actionability: human_only，绝不落
      goal-failure-classifier.ts:249-256 的 agent_fixable 缺省——否则 harness FAIL
      会转化为内容重试循环）；**attestation 缺失/损坏（goal 环境）不回退现行为**
      （codex 五轮 P0，v5「回退现行为」表述撤销）：goal 模式下 review closure
      attestation 缺失或损坏 → 发射专用 **goal_review_closure_baseline_unavailable**
      （human_only，fail-closed）——不计算 run-start diff、不读取 gap-notes 授权、
      禁止内容重试（无基线时既判不了「review 后漂移」也不得放行，落回通用
      ut_no_src_mutation→agent_fixable 即重开内容重试循环）；非 goal 交互模式保持
      现 fallback（trace.start_commit + gap-notes 语义）。runner 侧同一盲区一并封：
      reconcileMutablePhaseSourceDrift 的「attestation 缺失 → no_drift」
      （goal-runner.ts:2159-2160）在 goal 环境改为 fail-closed（截断链 preflight 虽
      已保证起跑时在场（:2955-2956），运行中删除/损坏窗口须堵）。runner 决策梯特判：
      **两个新 id 任一**出现即短路内容重试；
      goal_post_review_source_mutation_unresolved → source reconciliation 门
      （goal-runner.ts:5222 的 action!=='retry' 条件）放宽为「action!=='retry' ∨
      存在该 blocker」→ 进 reconciliation 产 unauthorized_source_mutation halt +
      T3 guidance（同一事故一个出口，不产生 await_human 与 mutation halt 双态）；
      goal_review_closure_baseline_unavailable → **不走 reconciliation**（无基线
      可对账）→ 直接 halt（halt_reason 同名，**run 终态**）。该态 guidance（codex
      六轮 P0：resume 只重入被 halt 的原 phase——resolveResumeState
      goal-runner-phase.ts:584，4035d4 实证 ut HALT 后 resume start_phase=ut——
      「补跑 review 后 resume」在当前 run 不可达，截断链更无 review 可回）只指向
      **新起 coding 起点 run + supersede 旧 run（单一方向）**——codex 八轮 P0-①：
      review/coding 两态路由无证据源可支撑（attestation 本身在 review 闭环 evidence
      的 extraOutputs 里（check-receipt.ts:1056），staleness 重算重哈希全部
      inputs/outputs（phase-evidence-manifest.ts:622）：链含 review 则「只删」与
      「删+改码」同判 stale；链排除 review 则 review 前 evidence 无源码 inventory、
      唯一源码基线恰在被删的 attestation 里——两案均不可判），v7/v8 的 halt 现场
      staleness 定向**撤销**，取简化安全项：一律 coding 起点（spec/plan 上游是否
      fresh 由新 run 截断链 preflight 把关，stale 按 preflight 既有指引处理）。
      「受保护源码 inventory 锚」记为将来可选优化（须走 openspec change），本 plan
      不扩。不提供当前 run 内出路；明示不支持从快照恢复 attestation（非
      pass-snapshot 保护面）。非 goal 交互
      模式维持现语义（trace.start_commit 基线 + gap-notes 真人对话授权场景，诚实边界
      注明其自报性质）。重试/续跑 prompt 注入未决冲突行：「gap-notes 声称已批准，但
      runner 三源授权未命中——禁止再次实施，改走 must_review 登记」（治 fresh-context
      agent 读 gap-notes 复写循环）。
      【验收】unit：投影/重建各三态（advance→halt / retry→halt / halt 后 resume）+
      events-only 重建 guidance 保留断言；快照前置后 unauthorized fixture 报告含
      summary 链接与双轴；**基线回归 fixture「coding 改 36 文件（合法）+ review 后仅
      1 文件漂移」→ goal 环境只对 1 文件漂移发射
      goal_post_review_source_mutation_unresolved、36 文件合法实现不拦**；共享
      resolver 下 runner 与 check-ut 对同一 fixture 产出一致 decision；goal 环境自签
      gap-notes → 新 id BLOCKER（human_only）→ **agent invoke 次数不增**（断言无
      内容重试）→ reconciliation → unauthorized_source_mutation halt 事件链；
      fingerprint 吻合裁决在场 → PASS，**仅 preauth 覆盖在场 → 仍 BLOCKER**
      （codex 四轮 P0-① 负例）；**「review 后 attestation 被删/损坏」回归（codex
      五轮 P0 + 六轮 P0）：goal 环境 → goal_review_closure_baseline_unavailable
      （human_only，agent invoke 不增、不算 run-start diff、不读 gap-notes）→ 直接
      halt（run 终态），guidance 只含「新起 coding 起点 run +
      supersede」且不得出现「--resume」字样（当前 run 不可达）；**方向单一**（codex
      八轮 P0-①，两态路由无证据源已撤销）：「只删 attestation」与「删 attestation +
      改源码」两 fixture **同断言** coding 起点指引（后者尤其不得出现 review 起点）；
      runner reconcile 同态 fail-closed；非 goal 交互模式回退现行为**；
      通用 ut_no_src_mutation 的 legacy fallback/
      stale_diff_base 形态 actionability 缺省不变回归；交互模式回归不变；
      prompt 注入行断言。
  # ==========================================================================
  # T5 —— OpenSpec delta + 全量验证 + 宿主复验指引（诚实版）
  # ==========================================================================
    status: completed
  - id: t5-openspec-and-verification
    content: >
      OpenSpec + 全量验证收口 + 宿主复验。【行为】(a) 新建 openspec change
      goal-host-replay-fixes，交付物必须完整包含 proposal.md、design.md、
      specs/goal-runner/spec.md、specs/harness-gates/spec.md 与 tasks.md；tasks.md 逐项映射
      T1-T5 与验证命令，不把新实施任务追加到已接近完成的
      cc-spec-deadlock-hardening。规格 delta 明确——
      truncated-chain preflight SHALL derive requirement lineage from the in-memory
      manifest；dry-run SHALL run under the reserved goal-runs/.dry/<run_id>
      subtree（同 run_id、run 级文件零共写、feature 串行锁共享；路径于 detach
      parent 前由共享 resolveRawRunInput 单点解析，dry 不可 resume）and SHALL
      perform zero external trust mutation（checkpoint drift 比对/reseal
      recovery/vision head/checkpoint/HWM 写入全部跳过，trust 文件 byte-identical
      前后不变）；per-run locks and orphan recovery SHALL address runs by the
      canonical manifest.report_dir（feature lock 携 run_mode+report_dir；stale
      dry owner SHALL never be offered --resume and SHALL be taken over by the
      existing stale-lock flow）；authoritative
      state（events 消费面 **及** goal-runs 目录枚举面：requirement lineage /
      completion freshness / 阶段证据选择）SHALL be derived from non-dry runs
      only——enumeration SHALL structurally skip .dry，silently exclude
      bootstrap-only residue，and surface started-but-manifest-less dirs as
      corruptRuns on which the four read-only gates SHALL fail closed；wall-clock budget SHALL
      accumulate active runtime across resume sessions（run_end-less sessions SHALL
      be conservatively credited one heartbeat cadence——cumulative undercount SHALL
      be zero，预算不可经反复崩溃拉长），budget halt SHALL carry reason+guidance
      across outcome/run_end/phase_halt and the guidance SHALL name only real budget
      routes（new manifest new run / --override-manifest）；the ONLY automatic
      adjudication route while the content classifier remains pending SHALL be a
      human receipt whose versioned signed scope（v2：含 source_inventory_before 与
      drift fingerprint，路径规范化 fail-closed；v1 receipts SHALL be
      INVALID_SCOPE_VERSION）binds a fingerprint exactly matching the current
      drift——pre_authorized_mutations SHALL be intent registration only（never a
      pass/authorization route）；authorized_backtrack SHALL fire only when the
      current chain contains coding and review（truncated chains SHALL be guided to
      a fresh coding-rooted run）and credential issuance remains an explicit external
      dependency（issuance route SHALL NOT be inferred from verification registry
      presence nor from historical receipts；an exactly-matching receipt means
      adjudication-available, not issuance-available）；phase_halt SHALL override
      provisional verdicts in projection/rebuild and harness evidence SHALL be
      snapshotted before drift disposition；goal-env post-review drift SHALL be
      judged against the review-closure baseline via the shared drift resolver
      （NOT the run-start diff）and SHALL surface as the dedicated
      goal_post_review_source_mutation_unresolved blocker（human_only，no content
      retry；generic ut_no_src_mutation actionability unchanged），and a missing or
      corrupt attestation in goal env SHALL fail closed as
      goal_review_closure_baseline_unavailable（human_only，no run-start-diff
      fallback，no gap-notes authority；runner reconciliation SHALL NOT treat it as
      no_drift；recovery SHALL be a fresh coding-rooted run only——in-run resume
      cannot rebuild the attestation and no evidence source can distinguish
      attestation-only loss from source drift（two-way routing withdrawn）；a
      same-host lock whose owner pid is still alive SHALL never be preempted on
      heartbeat timeout alone（busy + operator hint instead）。The threat model
      of this change is frozen to preventing accidental co-writes by normal
      framework flows——workspace forgery by a malicious same-user process is
      explicitly out of scope（the framework has no HMAC/broker/OS-sandbox
      security model；the v9-v20 identity-ledger designs are withdrawn，recorded
      in plan history only）。（dry-run 隔离/枚举/残留语义以本段前文 SHALL 为
      唯一权威——v23 P0：旧 slim 段「fully separate lock / residue never an
      error」与 v22 语义冲突，已删。）scenarios 对应 be1c48 拒启 / ut2test 混写与双账本鞭打 / 4035d4
      隔夜 resume 秒死 / 裁决 receipt 续跑（全链）/ 截断链裁决转新起链 / 签发不可用
      诚实降级 / coding 合法改动不受 UT 门禁误伤 / preauth 在场仍不放行 /
      attestation 缺失 fail-closed（一律 coding 起点）/ crash 遗留 pending 目录
      不毒化 十形态。
      (b) 全量验证：typecheck 0 / npm test 重定向文件+显式退出码全绿（新 unit 注册
      CORE_SUITES，防静默跳过）/ npm run openspec:validate（仓库根）全绿 /
      git diff --check 干净。
      (c) 措辞修正（codex 一轮 P2-8）：本 plan 及记忆中回灌结论统一为「cursor 宿主全链
      spec/plan/review 首 attempt PASS，原故障形态未复发；claude envelope/canary/
      PASS 冻结/closure retry 路径未被触发，7.2 不据此关闭」（OpenSpec cc-spec change
      维持 29/30）。
      (d) 宿主复验指引（NL 话术，非 CLI）：部署新发布包后——「直接新起 ut→testing
      截断链（不要先 dry-run），确认能启动且报告目录无 dry 混写；隔夜后 resume 一次
      验证不再秒停且 halt 时报告有原因和出路；对 UT 测缝诉求：当前部署既无 HMAC 也无
      receipt 签发能力，预期 goal-report『需人工处置』段只给两条路——还原续跑，或按
      指引新起 coding→testing run 在 coding 期合法实现测缝并走 review 重审（认可测缝
      就走后者）；无授权时预期 ut 阶段 harness 直接以
      goal_post_review_source_mutation_unresolved BLOCKER 拦自签改码且不再空转内容
      重试，不再出现 harness PASS 又被 runner 拦的鞭打」。另提醒
      宿主当前工作区 OpenCardFlow.ets 仍处被改状态，续跑前按上述二选一处置。
      【验收】十 scenario 形态全部以仓内合成 fixture 复现（宿主 goal-runs 证据仅作
      provenance 不进测试依赖）；plan todo 全勾。
    status: completed
---

# 宿主回灌三修（plan e7c2a4d8）

正文以 frontmatter 为准。本 plan 是 plan 7c4f2e9b 任务 7.2「宿主实测回灌」的第一轮产出：
回灌显示 cursor 宿主全链 spec/plan/review 首 attempt PASS（原五连败形态未复发；claude
目标路径与 PASS 冻结机制未被触发，7.2 保持未完成）、P1-10 发布包部署已落实，同时暴露
本 plan 五个 todo 的问题面。实施前须用户 review 通过。

## 实施记录

**2026-07-23 实施完毕（v23 定稿口径，用户「开工」授权）。**

### 交付清单

- **T1a** `fidelity-shared.ts`：抽 `computeRequirementShaFromText`（parts 组装体单一实现），
  `computeRunRequirementSha` 变薄 wrapper；goal-runner 截断链 preflight 改内存口径
  （requirement 空白仍 BLOCKER；corrupt run 在场 fail-closed）。
- **T1b** `.dry/<run_id>` 保留子目录：`resolveGoalReportDir` dry 分支 + `DRY_RUNS_SUBDIR`；
  run_id 保留字校验（. 前缀/分隔符拒绝）；manifest.run_id↔CLI 冲突 fail-closed；
  `resolveRawRunInput` parent/main 共用（feature 仅在 manifest 合法）；`--resume` 拒 dry；
  detach launcher 重写（同规则派生同路径）；`appendEvent` base-fields 全量打标；
  dry+resume 互斥。
- **T1b'** trust 零触碰：vision 启动链（reseal 恢复/rekey/head/HWM/ledger 迁移）整段
  `!dryRun` 门；`commitVisionAnchors` dry no-op；manifest drift 以 absent 基线；
  adapter 写回 `!dryRun` 门。
- **T1b''** 锁改址：`LockRecord.run_mode/report_dir`；per-run lock 按 report_dir 派生；
  `resolveOrphanedIncompleteRun` 三态分流（dry 不提示 resume/legacy events 判别/
  unknown 人工处置）；goal-progress 两处按 report_dir 读锁。
- **T1c** `loadAuthoritativeEvents`/`filterAuthoritativeEvents`：goal-runner 13 个权威
  消费站点扫替（orphan 分类器/遥测显式保留 raw）。
- **T1d** `listAuthoritativeGoalRuns`/`classifyGoalRunsDir`：结构性跳过 `.dry`、残留
  二分（bootstrap-only 静默/started-manifest-less → corruptRuns 不 throw）；四枚举点
  扫替（intent/血缘/freshness/`resolvePhaseRunIds`）；completion `collectCleanPassIssues`
  ⓪ 与截断链 preflight 消费 corruptRuns fail-closed。
- **T1e** `isLockStale`：同机活 pid 永不判 stale；`formatLockBlocker` 活 owner 提示。
- **T2** `partitionExecutionSessions`（run_start 分段/崩溃段补收心跳且尾段 cap/dry 剔除/
  turns/首权威起点）+ `resolveResumedBudget(events,{nextSessionStartMs})`；goal-runner
  elapsed/wallDeadline 换活跃基点，sinceMs 保真实时间线；四条 budget halt 路径统一
  reason+guidance+banner+phase_halt 事件（`emitWallBudgetHaltGuidance`）；
  `finalize_skipped` reason；`buildBudgetExhaustedGuidance`（两真路，无裸重启）。
- **T3a** `parsePreAuthorizedMutations` 输入保真（fail-closed，意图预登记定位）。
- **T3b** scope hash v2（七字段+版本前缀）、`relPathIssues`、
  `computeDriftFingerprint`/`computeCurrentDriftFingerprint`（domain separation）、
  classify 唯一自动裁决路径（human+fingerprint 精确吻合→authorized_backtrack；
  preauth/失配恒 unauthorized）。
- **T3c** runner：`chainHasCodingReview` 门（截断链→`authorized_mutation_requires_full_chain`）、
  快照前置（outcome verdict=harness 真值+halted 轴分离）、
  `mutation-adjudication-request.json` 落盘、`buildUnauthorizedMutationGuidance`
  （五轴能力分层，`MUTATION_RECEIPT_ISSUANCE_ROUTE_AVAILABLE≡false`）、
  halt_guidance 附着白名单废除（有即附着）。
- **T4a/b** goal-progress `phase_halt` 投影（span HALTED+current 固定）+
  `rebuildOutcomesFromEvents` halt 覆盖（guidance 保留、后续 verdict 清除）。
- **T4d** check-ut goal 环境分支（review-closure 基线共享 `classifySourceDrift`；
  `goal_post_review_source_mutation_unresolved`/`goal_review_closure_baseline_unavailable`
  两专用 blocker human_only 注册；reconciliation 门放宽短路内容重试；
  `reconcileMutablePhaseSourceDrift` goalEnv `baselineUnavailable` 信号 + runner 直接
  halt coding 起点指引）；prompt gap-notes 冲突注入。
- **T5** OpenSpec change `goal-host-replay-fixes`（proposal/design/goal-runner 7 条 +
  harness-gates 1 条 delta/tasks 映射 T1-T5）；新 unit 套件 `host-replay-fixes`
  23 例注册 CORE_SUITES。

### 既有测试随新契约更新（三处，各有注释说明）

- `goal-runner-detach`：stale lock fixture 改死 pid（活 pid 永不 stale 是新契约）。
- `goal-runner-hardening`：isLockStale 活 pid 用例断言反转（TTL 抢占语义废止）。
- `mutation-backtrack`：全绿 receipt 无 fingerprint 用例改新文案断言 + 新增 fingerprint
  吻合正例/失配负例。
- `verify-feature-completion`：fixture 落真实 manifest（无 manifest+有 events=corrupt
  是新契约）；「更晚 HALTED run」期望修正（后建 run 的 manifest 本就进 requirement
  SSOT aggregate → INVALID 属七轮 P1-3 既有设计，旧 STALE 期望依赖不真实夹具）。

### 实施后 review round2 修复（codex 只读审查：1P0+4P1+1P2，逐条 ground-truth 核实全实锤后修复）

- **P0 授权拼接旁路**：classify 放行覆盖此前按全部 valid receipt 并集计算——「human 裁 A +
  preauth 盖 B」可拼成 A+B 越权放行。修复：authorized_backtrack 仅当 fingerprint 吻合的
  human 裁决 receipt 集合**独立**覆盖全部 drift 且各自配额合规（preauth/无 fingerprint
  receipt 不参与放行覆盖）；违规说明新增「不能独立覆盖」分支。
- **P1 lock 字段丢失**：tryAcquireLock 构造 record 时漏拷 run_mode/report_dir——所有新锁
  被 reader 判 legacy，T1b'' 三态分流整线失效。修复：字段随记录落盘（undefined 自然省略，
  legacy 写入面形状不变）。
- **P1 progress dry 污染仍在**：budgetBase 算而未用，投影/面板/审计尾全走 raw 事件。
  修复：projectGoalProgress 单点分流——普通 run 走 partitionExecutionSessions 权威视图
  （span/turn/run_start 基点/recent_events/终态全过滤），预算轴改活跃口径
  （Σ 历史段 + 直播段 now−段首，与 runner T2 同构）；.dry 视图保留 raw；
  buildLiveGoalStatusSnapshot tail 同视图。覆盖 goal-status/goal-monitor/runner
  flushProgress 三消费面。
- **P1 --resume↔manifest.run_id 冲突不设防**：resolveRawRunInput 补 resume↔manifest.run_id
  与 resume↔--run-id 双冲突 fail-closed；goal-runner resume+manifest 加载路传 runId 做
  第二道校验（buildGoalManifestFromInput 身份冲突拦截）。
- **P1 corruptRuns 未传播**：check-spec 新增 goal_run_identity_intact check（BLOCKER，
  intent 门前注册，覆盖全部 4 处 collectRequirementIntentText 消费面）；check-receipt
  closure 生成前显式枚举 corrupt → BLOCKER exit(1)。
- **P2 dry invoke 窗口仍读账本**：pre-invoke 快照+anchor 事件、post-harness 快照+anchor
  补 !dryRun 门（post-invoke 比对块此前已有门）；reseal/基线锚在 run_start 大门内本就覆盖。
  spec delta 同步「dry invoke 窗口零账本读+零 anchor 事件」。
- **测试**：mutation-backtrack +2（拼接负例断言「独立覆盖」/多裁决合并正例）；
  host-replay-fixes +4（lock 字段落盘含 legacy 形状、resume 冲突双路、progress 混写
  面板真值+活跃口径+.dry raw 视图、check-spec corrupt 门）。夹具修正一处：resume↔--run-id
  用例须带 feature（feature 必填检查在身份冲突之前）。

### round2 终审收口（codex：可进宿主复验；唯一 P2 验收缺口=dry trust 字节级仓内回归）

- 新增 e2e 用例「round2 P2 e2e: dry-run trust 面字节级不变」：consumer 布局临时宿主
  （framework 共享目录 junction、harness 真拷贝+node_modules junction），真实拉起
  `goal-runner --feature f1 --start spec --end spec --dry-run --adapter cursor
  --override-adapter`，全树前后 sha 对账断言：①预置文件（vision 账本种子/需求/
  checkpoint 种子/config/入口 stub）逐字节不变；②新文件仅落 goal-runs/.dry/<run_id>/；
  ③--override-adapter 不写回 framework.local.json；④.dry events 全量 dry_run:true 且
  零 vision_ledger_anchor。清理先摘 junction（rmdirSync 只删 reparse point）再递归删，
  防误删仓库真身。framework/** 写入不在射程（foreign-file 防线另有专测）。


### 验收状态

- typecheck 0 · **unit 2384/2384**（round2 +6 例，终审收口 +1 e2e）· fixtures 44/44 ·
  **openspec 43/43** · git diff --check 干净 · check-plan-version PASS。
- 悬置：tasks.md 5.3 宿主实测复验（NL 指引见 T5(d)——部署新发布包后执行）。
