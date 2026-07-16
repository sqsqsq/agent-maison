---
name: goal 超时重试冷启动回喂失效 + 门禁 ?? [] 崩溃类 + framework_integrity 拉锯 全盘根治
version: 3.0.0
# 版本说明：随当前 3.0.0 版本窗口，用户控版本不 bump。
# rev2：codex + cursor 双审第一轮吸收（P1-5 升 P0-5 弃 start_commit 二分改一律 halt /
# P0-1 continuationReason / P0-3 复用 failure_kind 通道 / P0-4 effective_timeout_ms +
# wall 钳制 / P0-2 清单制 / P1-6 模板修正 / P1-7 spike / P1-8 先定位 / 证据措辞收敛）。
# rev3：双审第二轮 3 阻断项 + 事实校准全采纳——
# ①P0-5 分类收窄：blocking_class==='integrity' 家族实含 framework_drift /
# framework_foreign_file / framework_manifest_corrupt / framework_manifest_empty（+
# framework_manifest_selfcheck 独立 id，framework-integrity.ts:429-525 对码实锤），补救
# 方式互异（drift→allowlist/还原/回灌；foreign→清理；manifest 坏/空→重装发布件）——统一
# kind 定名 framework_integrity_block、保留原 failure_kind 为 subtype 驱动分补救文案，
# 全 subtype 一律首触 halt（cursor 同向）；②超时掩盖例外改 freshness 条件化：复用现成
# resolved.stale_summary（i7 事件 stale_summary:false 实锤）——agentTimedOut &&
# !stale_summary && integrity/framework_bug blocker 在场 → 按确定性 blocker halt，不再
# 让 timeout 无条件压过（rev2"不镜像"决策被此更优方案替代，i7 形态可当轮即拦、省掉 i8
# 白跑）；③P0-4 hard wall 补全链路：runHarnessPhase 现无 timeout（createChildSettleWaiter
# (child,{}) 对码实锤）——agent 停在 deadline 后 harness 仍可无限跑；公式弃
# wallRemaining+KILL_GRACE（grace 双重计入，超支可达 2×grace）改 deadline 制；
# ④P0-1 continuation 拆维度：process_resume 是进程形态、与失败原因正交——改
# {cause, process_resumed} 结构；⑤P0-2 来源归属校准：asset-manifest-check.ts:43/89/113、
# asset-acquisition.ts:96、asset-crop-validation.ts:254/331 读的是 ui-spec.yaml.assets
# （非 asset-manifest.yaml）、asset-crop-validation.ts:179 读 asset-crop-vl.yaml.entries
# ——inventory 改"源 artifact→loader→字段→consumer"表格制；⑥杂项校准：spec 实为
# 5×45m 超时+第 6 次 43.8m 自然完成 / ?? [] 计数易变改"约 42x、实施时 inventory 脚本出
# 准数" / start_commit 校准为"phase 级 trace 的 baseline SHA（agent 写入）" / P1-7 拆
# 静态能力（output_delivery 进 adapter-schema/adapter 配置）与运行时信息（adapter_version
# 由 --version 动态探测进 run event，不硬编码 adapter.yaml）/ 口径统一"四层根因、五个
# P0 工程项"。
# rev4（终版候选）：codex 第三轮 2 必补 + 2 收口全采纳——
# ①integrity subtype 补全为 **6 项**并支持**多值**：framework_manifest_tampered
# （framework-integrity.ts:214/:247 两路径）与 framework_manifest_sidecar_missing（:231）
# 对码实锤；sidecar_missing 明写"per-file/外来文件校验照常执行"→ 与 drift/foreign **可
# 共存**；extractBlockingMeta（goal-runner.ts:377）只取顶层/首个 blocker 会丢其余类型
# → 改 integrity_subtypes: string[] 全 blocker 收集去重，透传 phase_verdict/halt
# guidance/GoalPhaseOutcome/goal report；补救矩阵增 tampered（从发布件恢复/重铺，禁手工
# 重算——与源码 suggestion 一致）与 sidecar_missing（framework-init UPDATE 恢复，禁
# agent 手工补写）两行 + 三类共存组合测试；②hard wall 补齐全部等待/收尾路径：transient
# backoff 的 sleepMs 无条件等 5/15/45s（goal-runner.ts:2448 实锤）→ backoff 钳制到
# deadline-reserve、剩余不足直接 budget_wall_clock 不再 sleep；harness timeout 用
# max(0, deadline-now-FINALIZE_RESERVE)（不吃原始 remaining）；runHarnessPhase 返回
# {exitCode, timedOut} 结构化结果（区分门禁真失败与 wall 树杀）；harness 超时 →
# harness_end{timed_out:true} + 直接 budget_wall_clock、不读可能半写的 summary；run_end
# （:2528）后仍有 completion receipt 生成（:2532+）→ 钉死核算口径：验收以**进程退出**
# 计总时长，run_end 后收尾全部纳入 FINALIZE_RESERVE、超则跳过 best-effort 收尾（receipt
# 生成本就"失败只记录不改终局"）；③continuation 派生收敛到"当前 phase 最近一次
# attempt"：resume 到全新 phase（无历史 invoke）→ null 不注入；有 invoke 无 verdict →
# unknown；有 terminal verdict → 用该 attempt 的 cause——**不做全 phase 历史按超时优先
# 扫描**（旧 timeout 不得盖过更新的 content failure），cause 优先级仅用于同一 attempt
# 内多信号并存；④kill 注记**不写 agent-output.log**（该文件是 interaction sentinel
# :1957 / critic receipt outputHash :1982 / output bytes 的证据源，追加 runner 文本=
# 污染证据+消灭"0 字节"事实）→ 改写入 agent_invoke_end 事件字段 {kill_reason,
# effective_timeout_ms, output_bytes, output_delivery}；chrys --version 探测限每 run
# 一次+短超时+结果缓存。
# rev5（终审定稿）：codex 第四轮 1 P0 + 3 收紧全采纳——
# ①Windows tree-kill 有界化（P0 阻断）：killProcessTree 的 win32 分支用 spawnSync
# taskkill，源码自注"blocks the event loop — awaitPromiseWithTimeout cannot interrupt
# a hung taskkill"（agent-invoke.ts:545 实锤）——taskkill 一卡，agent/harness 两条 hard
# wall 全部失界、KILL_GRACE 不构成真实上界。改异步 spawn/execFile + taskkill 子进程
# 自身有界等待 + 超时返回 kill_process_tree_timeout；agent 与 harness 共用同一 bounded
# kill；增"taskkill 永不退出"stub 测试断言 runner 仍在 grace 内退出。KILL_GRACE 不在
# goal-timeout.ts 另造独立常量——真实 termination 契约已有 DEFAULT_FORCE_SETTLE_AFTER_
# KILL_MS=5s / DEFAULT_KILL_PROCESS_TREE_WAIT_MS=10s / DEFAULT_KILL_INFLIGHT_DRAIN_MS=1s
# （agent-invoke.ts:62-71），wall 验收 grace 与实际 kill/settle 参数同源单 SSOT；
# ②zero-budget 禁 spawn：invokeAgent 的 timer 语义是 timeoutMs>0 才启用（agent-invoke.
# ts:788 实锤，传 0=关闭超时）——harness 启动判据改 availableForHarnessMs=(deadline-now-
# FINALIZE_RESERVE)≤0 → 不 spawn 直接 budget_wall_clock，绝不把 0 传给 timer；
# ③integrity_subtypes 读 classification 并过滤：SummaryJson blocker 字段实为
# {blocking_class, classification}、无 failure_kind（goal-runner.ts:214-221 实锤）——
# 收集式定稿为 blockers.filter(b=>b.blocking_class==='integrity').map(b=>b.
# classification).filter(nonEmpty)，旧 summary 兼容回落顶层 failure_kind；
# ④freshness 混装矩阵写死决策表（integrity 优先于混装回落，all-framework_bug 须
# blockers.length>0 防空数组 .every() 真空真值），开放问题 3 收窄为仅 framework_bug
# 混装扩 flip（integrity 已定 any-flip，不在其列）。
# rev6（终稿）：codex 第五轮 1 必补 + 2 契约精度全采纳——
# ①resume 状态窗口补全：真实事件序 invoke_start→invoke_end(:1932)→harness_start(:2006)
# →harness_end→phase_verdict(:2327)；runner 崩在 harness/verdict 段时 invoke 已闭合、
# findUnclosedAgentInvokeStart（goal-runner-phase.ts:574 按 start↔end 配对）返回 null
# ——rev5 三态规则漏此窗口。改五态 attempt 窗口表：无 start→null / 有 start 无 end→
# unknown / end(timed_out=true) 无 verdict→agent_timeout（可恢复真因，不丢成 unknown）/
# end 正常无 verdict→unknown（崩于 harness/verdict）/ 有 verdict→用其 classified cause；
# harness_start/end 与 phase_verdict 事件补 invoke_id，旧日志按事件顺序分窗 fallback；
# ②bounded taskkill 必须**结束 helper**而非仅放弃等待（存活 helper 持有 pipe/handle 会
# 阻止 Node 退出）：execFile('taskkill.exe',args,{shell:false,windowsHide:true})、超时
# 主动 kill helper + 销毁 stdio/监听 + 返回 kill_process_tree_timeout；测试断言 runner
# 实际退出、无活跃 helper handle；resolveKillGraceMs() 派生清单补漏
# DEFAULT_CHILD_SETTLE_GRACE_MS=3s（agent-invoke.ts:62）——grace 从完整 termination
# state machine 派生取保守上界；③integrity 顶层 fallback 加过滤：须
# summary.blocking_class==='integrity' && isNonEmptyString(summary.failure_kind) 才回填，
# 防无合格 integrity blocker 的内容类顶层 failure_kind 被误塞。
# rev7（正式定稿）：codex 第六轮唯一 P0 采纳——agent 零预算禁启动（与 harness 对称）：
# rev6 公式 max(0, deadline-now-reserve) 会产出 0，而 invoke timer 语义 timeoutMs>0
# 才启用（agent-invoke.ts:788）、checkRunBudget 只查原始 wall（goal-runner.ts:1724）
# ——"原始 remaining=30s、reserve=60s"时 agent 会**无超时**启动，与已修的 harness
# zero-budget 完全同构。改为构建 prompt/写 agent_invoke_start 前先判
# availableForAgentMs≤0 → 不构建不调用、直接 budget_wall_clock 终局；
# effectiveAgentTimeoutMs=min(baseOrBoosted, availableForAgentMs) 恒>0、调用 adapter
# 前断言；agent/harness 两条 zero-budget no-spawn 对称断言入测试。顺手：P0-1 五态
# 窗口的两个崩溃段用例（end timeout 无 verdict / end 正常无 verdict）显式补进 §九
# 正式测试计划（正文验收此前已有，防实施漏测）。
# rev8（实施偏离记录，2026-07-15，实施后四轮复审沉淀）：
# 【偏离①·硬上界范围收窄】§五"进程总时长 ≤ wall + resolveKillGraceMs()（四路径全覆盖）"
# 实施为：硬上界=agent/harness/backoff 三路径；run_end 后收尾（completion receipt 等）
# 定性为 pre-check 拦截的 best-effort（finalize_skipped 前置跳过 + finalize_overrun 越界
# 留痕）。原因（Node 物理事实，复审第三/四轮 codex 确认）：收尾是同步 fs 工作，同步挂起
# 时进程内 timer/watchdog 均不运行——不上 worker/child 隔离就不存在可执行的硬 bound，
# 而 worker 化 receipt 生成是独立量级重构 → 列开放问题 5，本 change 不做。OpenSpec
# spec/proposal/tasks 已按此口径同步（四处文档单一口径）。
# 【偏离②·续作块"已耗时"语义】P0-1.6 的"已耗时"实施为"本 phase 此前各 attempt 累计
# 耗时"（per-invoke 预算下本次 attempt 起点耗时恒 0，累计值才有信息量）。
# 【偏离③·P0-2 落地形态】逐点位替换实施为 loader 归一化（ui-spec/spec-loader 双入口
# + 嵌套集合 + 三层深验证）+ 主门禁结构化 FAIL（shape:/feature_spec_shape）——语义等价
# 且防漏，inventory 对码表在 OpenSpec design.md。
# 【状态如实】§九 单测=组件级全绿；集成断言（双侧 zero-budget/backoff 终局/硬 wall
# 不等式/日志卫生）在 OpenSpec tasks 7.3b/7.5b 持续开放，待实机回灌或集成测试床。
overview: >
  宿主 bc-openCard（chrys goal-mode，2026-07-13，run 20260713T031029Z）spec 阶段 5 次
  ~45m 超时被杀 + 第 6 次 43.8m 自然完成、plan 4 attempts 事故深挖结论：四层根因、五个
  P0 工程项——(1) agent_timeout/transient_api_error 重试跳过 retries++，而 prompt 回喂
  开关是 retries>0，超时重试永远拿零上下文冷 prompt（b8f36a12 的 checkpoint/续作机制被
  整体短路，HEAD 仍未修）；(2) 门禁脚本 `?? []` 对非数组真值不兜底，agent 产 YAML 形状
  偏差直接 TypeError→[Harness 内部错误] BLOCKER，agent 误当自身问题反复修；宿主当场修的
  7 文件从未回灌源仓、还被 goal agent 依回喂话术回滚；(3) 宿主（用户批准）修 framework
  发布件 vs framework_integrity 门禁拉锯——code_regression 回喂话术"revert first"指挥
  goal agent 回滚宿主真修复，烧 2h+；(4) agent_timeout 不在 CUMULATIVE_HALT_FAMILY、FAIL
  签名每轮互异，连续超时零熔断，烧到 wall 超支（限 585m 实跑 612m）才停。
  现场：D:\97.log\问题反馈\07-15\（两目录=同一 run 两个时点快照，前者 events 为后者严格前缀）。
  待用户 review 后动手；实施时另立独立 OpenSpec change，不并入 goal-fakepass-hardening。
todos:
  - id: diagnosis-mainchain
    content: 主链诊断（events/detach/宿主对话/源码对码，四根因 ground-truth 核实；codex+cursor 两轮双审确认）
    status: completed
  - id: diagnosis-residual
    content: 残留诊断：goal-monitor stale 误报 replay fixture 定位（调用侧 --since-event 0 vs monitor 历史 verdict 未标 superseded 两候选）+ chrys 输出行为 spike（P1-7）
    status: pending
  - id: p0-5-integrity-halt
    content: P0-5（实施第 1 位）framework_integrity_block 统一 kind + integrity_subtypes 多值收集（6 subtype）分补救文案，integrity 家族一律首触 halt；超时掩盖以 stale_summary freshness 条件化
    status: completed
  - id: p0-3-framework-bug-kind
    content: P0-3（实施第 2 位）[Harness 内部错误] 复用 failure_kind/blocking_class 通道升 framework_bug——首触 halt + freshness 条件化超时例外
    status: completed
  - id: p0-1-continuation
    content: P0-1（实施第 3 位）continuation {cause, process_resumed} 双维度（五态 attempt 窗口表；resume 全新 phase → null；harness/verdict 事件补 invoke_id）+ 超时/断流/resume 回喂四缺口修复
    status: completed
  - id: p0-2-asarray-sweep
    content: P0-2（实施第 4 位）agent 可写 YAML 形状防崩溃——"源 artifact→loader→字段→consumer"inventory 表 + asArray + 形状 FAIL 配对 + fixture 矩阵
    status: completed
  - id: p0-4-timeout-fuse
    content: P0-4（实施第 5 位，依赖 P0-1 同批或之后）连续超时熔断 + 升档 + wall deadline 制全链路硬预算（agent/harness/backoff/收尾四路径全覆盖，harness 结构化超时结果，Windows bounded tree-kill，agent+harness 双侧 zero-budget 禁 spawn，grace 与 termination 契约同源）+ effective_timeout_ms 单一事实源
    status: completed
  - id: p1-6-host-channel
    content: P1-6（实施第 6 位）宿主修 framework 正规通道引导 + framework.config.template.json 过期 integrity field_notes 修正
    status: completed
  - id: p1-7-observability-spike
    content: P1-7（spike）chrys 输出行为核实——output_delivery 静态能力进 adapter-schema/adapter 配置；adapter_version 每 run 一次短超时动态探测进 run event；kill 诊断走 agent_invoke_end 事件字段（不污染 agent-output.log）
    status: pending
  - id: p1-8-attribution-noise
    content: P1-8 归因/提示噪声（PASS 事件不输出 failure_kind_classified / facts.md 门禁报错带模板；stale 项待 diagnosis-residual 定位后再定方案）
    status: completed
  - id: tests
    content: 单测：continuation 双维度回归（含 resume 全新 phase → null）/ freshness 决策表逐行 + integrity_subtypes 收集式（classification 字段+过滤+回落）+ subtype 共存组合 / 形状 fixtures 矩阵 / 连续超时熔断 events 回放 / wall deadline 四路径（进程退出口径，taskkill 永不退出 stub，zero-budget 不 spawn，grace 同源断言）/ effective_timeout_ms 旧日志 fallback / agent-output.log 不被 runner 写入
    status: completed
---

# goal 超时重试冷启动 + 门禁崩溃类 + integrity 拉锯 全盘根治（rev7 正式定稿）

- **Plan ID**: d9b4f7e2
- **状态**: 主链诊断完成（双审六轮确认）；rev7 已吸收第六轮唯一 P0（agent 零预算禁
  启动，与 harness zero-budget 对称）+ 测试计划补漏（五态窗口崩溃段用例显式化）；
  codex 判定补完即正式定稿、架构与 scope 不再调整——**待用户开工令**。
  实施时另立独立 OpenSpec change（不并入 goal-fakepass-hardening）。
- **来源**: 宿主 bc-openCard（chrys adapter，goal-mode，2026-07-13 反馈，07-15 取证）。
  现场 `D:\97.log\问题反馈\07-15\chrys在spec阶段一直超时\`（spec 期快照，~07:15Z）与
  `D:\97.log\问题反馈\07-15\chrys plan报错\`（run 结束后快照）——**同一 run
  `20260713T031029Z` 的两个时点**（manifest 哈希一致，前者 279 行 events 是后者 698 行的
  严格前缀，双审复核确认）。
- **原则**: goal/交互双模式能力拉齐；fail-closed 不放松；不改用户显式 override 契约；
  **agent 不得对 framework 发布件做任何自动写操作（含"回滚"）**；**确定性 integrity/
  framework_bug 证据（summary 新鲜时）优先于超时归因**（rev3 起）。
- **协调**: 与 e3a9c5d1（已落 bd5a87e1）互补不重叠——本 plan 不动 E4 已落地的
  advance_blocked/家族累计逻辑，只补它没覆盖的洞（见 §0.5）。

## 0. 现场链路（ground truth，events.jsonl 全量回放）

| 阶段 | invoke | 时长 | timed_out | verdict → action | 备注 |
|---|---|---|---|---|---|
| spec | i1 | 2700.8s | ✅ kill | FAIL → retry | 14 blocker（含 facts/章节/表格） |
| spec | i2 | 2700.9s | ✅ kill | FAIL → retry | 签名与 i1 不同 |
| spec | i3 | 2700.8s | ✅ kill | **PASS** → retry | `advance_blocked: agent_timeout_unclosed` |
| spec | i4 | 2700.8s | ✅ kill | FAIL → retry | 签名=`context_exploration_facts_parse`（**i3 修好的 facts.md 被改坏**） |
| spec | i5 | 2700.8s | ✅ kill | FAIL → retry | 签名=facts schema/established_by/scope 三项 |
| spec | i6 | 2625.9s（43.8m） | ❌ 自然结束 | PASS → advance | **离 2700s 预算仅差 75s**；且发生在宿主修完门禁 bug 之后 |
| plan | i7 | 5400.9s | ✅ kill | FAIL → retry | 8 blocker，含 `framework_integrity` **7 处漂移**；classified=**agent_timeout**（超时盖住 meta=framework_drift，**事件 stale_summary:false——summary 是新鲜的，见 P0-5 freshness**） |
| plan | i8 | 2049.9s | ❌ | FAIL → retry | classified=code_regression；7 漂移未动 + `visual_parity_coverage` **门禁自身 TypeError 崩溃**（plan-visual-parity-check.ts:142） |
| plan | i9 | 4041.9s | ❌ | FAIL → retry | classified=code_regression；还剩 1 处漂移（agent 回滚了宿主 6 个修复） |
| plan | i10 | 1963.7s | ❌ | PASS → advance | agent 自述 "Reverted prior attempt's framework drift" |
| coding | i11/i12 | 3895s/1200s | ❌ | FAIL→retry / PASS→advance | 正常内容重试 |
| review | i13 | 1926s | ❌ | PASS → advance | **启动于 wall ~580m 处** |
| ut | — | — | — | `budget_wall_clock` → **run HALTED** | wall 限 585m，实跑 612m（03:10→13:22，见 P0-4） |

**归因精确化**："revert first" 回喂话术实际作用于 **i9/i10 的 prompt**（分别源自 i8/i9 的
code_regression verdict）；i7 verdict 被超时盖为 agent_timeout、retries 未增，故 **i8 拿的
是冷 prompt、对 7 处漂移毫不知情**（白跑 34m 的直接原因）。rev3 补：i7 的 summary 新鲜
（stale_summary:false）且含 integrity blocker——freshness 条件化后该轮即可 halt，i8 整轮
可省。

**决定性佐证（rev2/rev3 措辞收敛）**：
- goal-report.json：spec `retries: 0`（实际 6 次 invoke）、plan `retries: 2`（实际 4 次）
  ——`agent_timeout` 重试**不递增 retries** 的铁证；
- **两个快照中的最终 spec prompt.md 均为 5862B 冷启动模板、无任何回喂段落**（i6 与 i4
  时点各一份直接证据）；其余四次为源码路径推断（`isPhaseContinuation=retries>0` 恒 false
  → 构造分支必然相同）——**强推断而非文件比对实证**（prompt.md 每轮覆盖写）。对照组：
  plan i10 的 prompt **有** `## Prior attempt failure (retry context)` 段（i8/i9 是内容
  FAIL、正常递增 retries）——同一管线一半活一半死，定位精确；
- 宿主对话（`chrys-plan报错.txt`）：spec 卡到 i5 时宿主 agent 诊断出
  `ui_spec_structure`/`asset_acquisition` 门禁 TypeError 崩溃（`asset-manifest-check.ts:89`
  行号与源仓完全一致）。**授权范围差异（如实记录）**：用户批准的是修"这两个 harness bug"
  （原话"需要"），宿主 agent 随后**自主扩大**为 7 文件/8 处同模式批量清扫——正规通道
  缺失（P1-6）与授权粒度失控两问题并存；
- 被杀 attempt 的 `agent-output.log` 为 0 字节（spec 期快照 + heartbeat
  `agent_output_bytes:0` 且 mtime 恒为 invoke 起点，实证）；**成功 attempt 结束时一次性
  写入结果 JSON**（plan i10 终态 1355B 实证）——"恒 0 字节"仅限被杀路径，chrys `--json`
  缓冲判断待 P1-7 spike 核实。

## 0.5 与已落地防线的边界（避免重复建设）

bd5a87e1（e3a9c5d1 E4）已在位：`operator_interrupt` 首触 halt、
`CUMULATIVE_HALT_FAMILY={toolchain, await_human_confirm, await_human_p0_skip}` 累计熔断、
`ADVANCE_BLOCKED_HALT_THRESHOLD=2`、超时掩盖 await_human_confirm 例外。**它们治不了本案主链**：
- 累计熔断按 `blocker_signature` 计数且家族不含 `agent_timeout`——本案 i1/i2/i4/i5 签名
  互异，连续超时零命中；spec 仅 1 次 advance_blocked（i3），距阈值 2 差一次
  （[goal-runner.ts:2270-2291](harness/scripts/goal-runner.ts)、
  [goal-failure-classifier.ts:153-163](harness/scripts/utils/goal-failure-classifier.ts)）；
- 冷启动回喂缺陷（P0-1）与门禁崩溃类（P0-2/3）完全在 E4 范围之外。

## 实施顺序

1. **P0-5** framework_integrity_block 一律 halt（含 freshness 条件化）——先封破坏性回滚；
2. **P0-3** framework_bug 结构化归因 + 首触 halt；
3. **P0-1** continuation 双维度 / 超时回喂修复；
4. **P0-2** YAML 形状防崩溃 + fixture 矩阵；
5. **P0-4** 动态 timeout、progress 同步、wall deadline 全链路（**依赖 P0-1 同批或之后**）；
6. **P1-6 / P1-7 / P1-8** 文档、可观测性 spike、提示噪声。

## 一、P0-5 framework_integrity_block：统一 kind + subtype 补救 + freshness（rev4 六值多选）

### 定位与历轮方案演进
- 本案 i8/i9 的 `failure_kind_classified=code_regression`（meta 实为 framework_drift），
  buildPhasePrompt 走 [goal-runner.ts:950-957](harness/scripts/goal-runner.ts) 通用
  "revert first" 分支——**回滚掉的是宿主（用户批准）的真修复**；
- rev1 "start_commit 二分"已废（双审证伪：phase 级 trace 由 agent 在 i7 中期 08:33Z 才
  建立；**start_commit 语义校准（rev3）：它是该 phase 首次 harness 的 baseline SHA、
  agent 写入，不是 runner 权威的 run 起点记录**——check-ut.ts:659 即按此消费）；
- rev2 "blocking_class==='integrity' 一律归 framework_drift_block"被 codex 指出**分类
  过宽**；rev3 列了 4 subtype，**rev4 对码补全为 6**
  （[framework-integrity.ts](harness/scripts/utils/framework-integrity.ts)）：
  `framework_drift`（:499/:503）、`framework_foreign_file`（:521/:525）、
  `framework_manifest_corrupt`（:429）、`framework_manifest_empty`（:444）、
  **`framework_manifest_tampered`**（:214 sidecar 被 symlink 顶替 / :247 manifest-sidecar
  hash 不符，两路径同 kind）、**`framework_manifest_sidecar_missing`**（:231）；
- **多 subtype 可共存**（rev4）：sidecar_missing 分支明写"per-file/外来文件校验照常执行
  供诊断"——同一 summary 可同时出现 sidecar_missing + drift + foreign_file；而现有
  `extractBlockingMeta`（[goal-runner.ts:377-388](harness/scripts/goal-runner.ts)）只取
  summary 顶层或**第一个** blocker 的 meta，单值 subtype 必丢信息。

### 根治（rev4 定稿）
1. `classifyFailureKind`：blocker `blocking_class==='integrity'` → 统一 runner 侧 kind
   **`framework_integrity_block`**；**subtype 改多值**，收集式定稿（rev5，字段名对码
   校准——SummaryJson blocker 实为 `{blocking_class, classification}`、**无
   failure_kind 字段**，[goal-runner.ts:214-221](harness/scripts/goal-runner.ts)；
   check 层 failure_kind 经 buildSummaryBlockers 落到 blocker.classification）：
   ```
   integrity_subtypes = summary.blockers
     ?.filter(b => b.blocking_class === 'integrity')
     .map(b => b.classification)
     .filter(isNonEmptyString)   // 去重后
   ```
   **必须按 blocking_class 过滤**（否则内容 blocker 的 classification 混入 subtype）；
   旧 summary 兼容回落同样带过滤（rev6——否则无合格 integrity blocker、顶层却是内容类
   failure_kind 的 summary 会被误塞）：
   ```
   if (integritySubtypes.length === 0
       && summary.blocking_class === 'integrity'
       && isNonEmptyString(summary.failure_kind)) {
     integritySubtypes.push(summary.failure_kind);
   }
   ```透传到 phase_verdict 事件、
   halt guidance、GoalPhaseOutcome/goal report 与测试断言四处（修 extractBlockingMeta
   首个截断的局限，仅对 integrity 路径扩展、不动其余 kind 的既有 meta 语义；命名映射
   注释写死：check 层 failure_kind 6 值 → blocker.classification →
   runner kind=framework_integrity_block[integrity_subtypes]）；
2. runner 侧 `framework_integrity_block` **全 subtype 一律首触 halt**（cursor 同向：
   "integrity 家族全 halt"入代码注释），guidance 按 subtype 拼装（多 subtype 共存时
   逐条列出、修复顺序按下表自上而下——manifest 层不可信时先恢复锚点再谈 per-file）：
   - `framework_manifest_tampered`：**从发布件恢复 manifest/sidecar 或 framework-init
     UPDATE 重铺，禁止手工重算**（与源码 :251-253 suggestion 一致——manifest 失锚时
     drift allowlist 不适用）；
   - `framework_manifest_sidecar_missing`：**framework-init UPDATE 重铺恢复 sidecar，
     禁止 agent 手工补写**（与源码 :233 suggestion 一致）；
   - `framework_manifest_corrupt` / `framework_manifest_empty`：重装或从发布包恢复
     `RELEASE-MANIFEST.json`（allowlist 无效，明示）；
   - `framework_drift`：真人具名审批 `integrity.drift_allowlist {path, rationale,
     approved_by}` / 人工还原发布件 / 回灌源仓重发布，附漂移文件清单；
   - `framework_foreign_file`：清理外来文件或真人 allowlist，附清单；
   - 未知 subtype：兜底"人工核查 framework 完整性"；
3. buildPhasePrompt 不为该 kind 提供任何"修复指引"——**goal agent 对 framework 发布件的
   自动写操作（含回滚）全面禁止**，与 prompt 既有红线对齐；
4. **超时掩盖 freshness 决策表（rev5 写死，本表为 P0-3/P0-5 共同 SSOT，实现与测试
   均以此为准）**：复用现成 `resolved.stale_summary`（[goal-runner.ts](harness/scripts/goal-runner.ts)
   已计算、事件已落盘，i7 实测 false；freshness 由 summary mtime vs invoke 起点判定，
   既有机制、非新造）——

   | timedOut | stale | blocker 组成 | 归因 |
   |---|---|---|---|
   | 是 | 是 | 任意 | `agent_timeout`（旧 summary 证据不可信） |
   | 是 | 否 | **含任意 integrity** | `framework_integrity_block`（integrity 优先于一切混装回落——framework 完整性问题不被内容 blocker 掩盖；i7 形态当轮即拦，i8 白跑可省） |
   | 是 | 否 | **非空且全部** framework_bug | `framework_bug`（"全部"条件必须含 `blockers.length > 0`——空数组 `.every()` 真空真值防误判） |
   | 是 | 否 | framework_bug + content 混装 | `agent_timeout`（依赖 P0-2 收敛，见 P0-3.3） |
   | 是 | 否 | 纯 content | `agent_timeout` |

   非超时轮（timedOut=否）按常规归因：integrity 在场 → framework_integrity_block；
   全 framework_bug → framework_bug；否则走既有 meta/id 归因；
5. **不做自动回滚**：恢复"本 run 产生的漂移自动还原"的前置条件是 run-start/attempt-start
   framework 哈希快照 + 可信 writer provenance——记入开放问题，本 plan 不实现。

## 二、P0-3 [Harness 内部错误] 升一等归因（复用既有通道 + freshness）

### 定位
- 各 check-\*.ts 的 `safeRun`（[check-spec.ts:919-936](harness/scripts/check-spec.ts)、
  check-plan.ts:837、check-review.ts:804、check-coding.ts:486、check-ut.ts:3299）把
  程序员错误升为 BLOCKER FAIL——fail-closed 正确，但 classifier 无对应 kind，落
  `code_regression` → "revert first" 话术让 agent 修不存在于自己产物里的问题。

### 根治
1. `safeRun` 程序员错误路径置 **`failure_kind: 'framework_bug'` +
   `blocking_class: 'framework_internal'`**——CheckResult 已有两字段
   （[types.ts:422-424](harness/scripts/utils/types.ts)）、summary blocker schema 已收
   `classification`/`blocking_class`（[summary.schema.json:142-143](harness/schemas/summary.schema.json)），
   **零 schema 变更**；
2. `FailureKind` 增 `framework_bug`；`classifyFailureKind` 检查 blocker
   `classification==='framework_bug'`（优先级：agent 级信号之后、meta/id 归因之前）；
3. **超时掩盖例外以 P0-5.4 freshness 决策表为唯一 SSOT（rev5）**：本项对应表中
   "非空且全部 framework_bug → framework_bug"行（**"全部"必须含 `blockers.length > 0`**，
   防空数组 `.every()` 真空真值）与"framework_bug + content 混装 → agent_timeout"行。
   **混装缺口如实声明**：超时 + 内容 blocker + framework_bug 混装（本案 i4/i5 形态）仍归
   agent_timeout——依赖 P0-2 收敛（TypeError 变结构化 FAIL 后混装集合缩小），不预扩掩盖
   例外；**注意 integrity 不适用本回落**（含任意 integrity 即 framework_integrity_block，
   见决策表第 2 行）；依赖关系写入代码注释与测试用例名；
4. runner 侧 `framework_bug` 首触即 halt，guidance："门禁脚本自身异常（非你的产物问题）
   ——请人工将缺陷回灌 agent-maison 源仓；agent 不得修改 framework 发布件，也不要继续
   改产物绕过"；附异常 checker id + 栈首行；merged-report suggestion 同步（双模式拉齐）。

## 三、P0-1 continuation 双维度 + 回喂四缺口（rev4 派生收敛到最近 attempt）

### 定位（对码实锤，双审确认）
- [goal-runner.ts:2449-2454](harness/scripts/goal-runner.ts)：`agent_timeout` 与
  `transient_api_error` 不走 `retries++`；
- [goal-runner.ts:1797-1811](harness/scripts/goal-runner.ts)：
  `isPhaseContinuation = retries > 0 || (argv.resume && ...)` 同时闸住 `priorFailure`
  注入与 `partialResumeArtifacts`/`resumeSkipLines`（:1827-1840）——超时/断流重试
  三件套全不注入，checkpoint 每轮落盘从未被同进程消费。

### 根治（rev3：{cause, process_resumed} 双维度，替代 rev2 单 enum）
文件：[goal-runner.ts](harness/scripts/goal-runner.ts)
1. **continuation 结构体**（codex 采纳——process_resume 是进程形态、与上次失败原因
   正交，单 enum 会让 "--resume 且上次超时" 场景再次丢真因）：
   ```
   continuation: {
     cause: 'agent_timeout' | 'transient_api_error' | 'content_retry' | 'unknown';
     process_resumed: boolean;   // 本轮是否经 --resume 跨进程恢复
   } | null                      // null = 干净首跑
   ```
   **派生收敛到"当前 phase 最近一次 attempt 窗口"（rev6 五态定稿——rev5 三态漏了
   "invoke 已闭合但 attempt 未形成 verdict"：真实事件序为 invoke_start →
   invoke_end(:1932) → harness_start(:2006) → harness_end → phase_verdict(:2327)，
   runner 崩在 harness/verdict 段时
   [findUnclosedAgentInvokeStart](harness/scripts/utils/goal-runner-phase.ts:574)
   按 start↔end 配对返回 null）；不做全 phase 历史按超时优先扫描**（否则旧 timeout
   会盖过更新的 content failure）：

   | 当前 phase 最近 attempt 窗口状态 | continuation cause |
   |---|---|
   | 无任何历史 `agent_invoke_start`（如上一 phase 完成后 --resume 进入全新 phase） | `null`（不注入） |
   | 有 start、无 `agent_invoke_end` | `unknown`（崩于 agent 段） |
   | 有 end 且 `timed_out=true`、无 `phase_verdict` | **`agent_timeout`**（真因已在 end 事件里，不丢成 unknown） |
   | 有 end 正常、无 `phase_verdict` | `unknown`（崩于 harness/verdict 段） |
   | 有 `phase_verdict` | 用该 verdict 的 classified cause |

   配套：`harness_start`/`harness_end`/`phase_verdict` 事件**补 `invoke_id`**（attempt
   窗口按 id 精确切分）；旧日志无 invoke_id 时按事件顺序分窗 fallback；
   cause 优先级 `agent_timeout > transient_api_error > content_retry` **仅用于同一
   attempt 内多信号并存**（如 timed_out 与断流哨兵同时命中），不跨 attempt 使用；
   来源三层：in-memory 上轮信号（同进程）→ events.jsonl 按上述规则回放（跨进程兜底）
   → checkpoint.json `timed_out`（--resume 首轮佐证）；`isPhaseContinuation` 由
   `continuation !== null` 派生——**与 retries（吃不吃 max_retries 配额）彻底解耦**，
   P0-B.5/P0-D 免配额语义一行不动；
2. **缺口 a（PASS+timeout 无回喂路径）**：`priorFailure` 现仅在上轮 verdict=FAIL/INCOMPLETE
   注入——上轮 PASS+timeout（i3→i4 形态）时既无 priorFailure 也无续作块。修：
   `cause==='agent_timeout'` 时**即便上轮 PASS 也输出超时续作块**（partial 清单为空也
   输出块头与预算提示——空清单本身就是信息：产物在但 receipt/closure 未完）；
3. **缺口 b（--resume 后 priorFailureKind 丢失）**：checkpoint `timed_out=true` →
   `cause='agent_timeout'` 且 priorFailureKind 同步（与同进程 :1814-1815 对齐），不再
   从 summary 重算成 code_regression 错向"revert first"；
4. **缺口 c（断流误标 TIMED OUT）**：续作块标题按 cause 分文案（TIMED OUT /
   API CONNECTION DROPPED）；`process_resumed=true` 时块内加一句"进程曾中断重启，
   partial 状态以磁盘为准"；
5. 保守门控保留：`cause==='content_retry'` 时 priorFailure 仍仅在 FAIL/INCOMPLETE 注入；
6. 超时/断流续作块注入**本 phase 有效预算与已耗时**（取 P0-4 的 effectiveTimeoutMs，
   计算先于 buildPhasePrompt——见 P0-4.6）。

### 验收
- 同进程超时重试（retries=0）→ prompt 含 TIMED OUT 块 + partial 清单 + skip-lines；
- **PASS summary + timeout** → 仍输出续作块（含空 partial 变体）；
- **跨进程 --resume × 上次超时** → cause=agent_timeout + process_resumed=true、块头正确
  （rev3 新增：resume 不得掩盖真因）；
- **跨进程 --resume × 上次 content FAIL** → cause=content_retry + process_resumed=true；
- **--resume 进入全新 phase（无历史 invoke）→ continuation=null、零注入**（rev4 新增）；
- 有 start 无 end → cause=unknown（崩于 agent 段）；
- **end 带 timed_out=true、无 verdict → cause=agent_timeout**（rev6 新增：timeout end
  后、verdict 前崩溃——真因不丢成 unknown）；
- **end 正常、无 verdict → cause=unknown**（rev6 新增：agent 结束后、harness 中崩溃）；
- transient_api_error → 块头为断流文案、不写 TIMED OUT；
- 干净首跑 → 零注入（防回归）。

## 四、P0-2 agent 可写 YAML 形状防崩溃（inventory 表格制，rev3 归属校准）

### 定位（rev3 来源归属修正）
`??` 只兜 null/undefined；agent 产 YAML 字段为**非数组真值**时迭代/`.filter`/`.map`
崩溃。实锤三处：`ui_spec_structure`（"object is not iterable"——对应 `{}` 类形状；
`for..of ""` 不抛，宿主对话中 `""` 归因系其口误，历史坏值未保留、不作取证事实）、
`asset_acquisition`（[asset-manifest-check.ts:89](profiles/hmos-app/harness/asset-manifest-check.ts)
行号与宿主诊断一致）、`visual_parity_coverage`
（[plan-visual-parity-check.ts:142](profiles/hmos-app/harness/plan-visual-parity-check.ts)，
plan-i8 harness 报告原文）。

**范围口径**：`?? []` 全仓（harness/ + profiles/）约 42x 处命中（**数字易变，实施首步由
inventory 脚本生成准数**），混有 regex match、Map 取值、内部可信结构——改**清单制**，
且 rev3 校准来源归属（rev2 把 ui-spec 消费点误归 asset-manifest.yaml）：

| 源 artifact（agent 可写） | loader | 字段 | consumer/checker（已知点位） |
|---|---|---|---|
| `ui-spec.yaml` | loadUiSpecFile | `assets` | spec-ui-spec-check.ts、**asset-manifest-check.ts:43/89/113**、**asset-acquisition.ts:96**、**asset-crop-validation.ts:254/331** |
| `ui-spec.yaml` | loadUiSpecFile | `screens[]`/`root.children` 递归/`global_elements[].texts`/`must_have_elements` | capture-completeness-check.ts（~15 处）、fidelity-governance-check.ts:210 |
| `visual-parity.yaml` | plan-visual-parity 内部 loader | `mappings.assets/tokens/components` | plan-visual-parity-check.ts 全组（:120-160） |
| `asset-crop-vl.yaml` | loadCropVlEntries | `entries` | asset-crop-validation.ts:179 |
| `contracts.yaml` | spec-loader | `modules`/`components`/`module_dependencies`/`prd_to_code_traceability[].key_files` | coding-host-rules.ts 多处 |
| `acceptance.yaml` / `use-cases.yaml` | spec-loader | `use_cases[].ui_bindings[].user_actions` 等 | named-handler.ts:64-103 |

实施首步以 loader 读取面为 SSOT 对码补全该表入 OpenSpec change（上表为已核实起点，
不拍脑袋）；batch 2（内部结构：layout tree、graph extractor 等）**不在本 plan**。

### 根治
1. 新增共享工具 `asArray<T>(v): T[]`；按 inventory 表逐点替换 `x ?? []` → `asArray(x)`；
2. **asArray 不得静默洗形状**：asArray 只防 crash；每个点位所在 checker 须有配套形状
   校验（schema 校验或就地 `Array.isArray` 分支）产出**结构化 FAIL**（期望形状 + 最小
   合法样例）——"传了 `{}` 却安静 PASS"视为实现缺陷，fixture 矩阵显式断言该情形 FAIL；
3. fixture 矩阵：`{}` / `""` / 嵌套 dict / YAML 解析 null 四类形状 × inventory 表 checker，
   断言零 throw、结构化 FAIL、details 含期望形状。

## 五、P0-4 连续超时熔断 + 升档 + wall deadline 全链路硬预算（rev4 四路径全覆盖）

### 定位（rev3 新增 harness 无超时实锤）
- [goal-runner.ts:2288-2291](harness/scripts/goal-runner.ts)：超时 FAIL → 无条件 retry
  无计数；签名基 guard 对超时天然失效；
- **脑裂实锤**：[goal-progress.ts:716](harness/scripts/utils/goal-progress.ts)
  `phaseTimeoutMs = resolvePhaseTimeoutMs(stallPhase, manifest)` 静态解析——runner 升档
  后 progress/goal-status/dead-man 仍按旧值判 STALLED；
- **硬 wall 双缺口**：①`checkRunBudget`（[goal-runner.ts:1724](harness/scripts/goal-runner.ts)）
  仅在 attempt 启动前检查——review 于 ~580m 启动后跑满 32m（限 585m 实跑 612m）；
  ②**`runHarnessPhase()` 无 timeout**（[goal-runner.ts:425-480](harness/scripts/goal-runner.ts)
  `createChildSettleWaiter(child, {})` 空 options，对码实锤）——即便 agent 停在
  deadline，harness 仍可无限运行，"超支 ≤ grace"在 rev2 方案下**不可保证**（codex）。

### 根治（rev3 deadline 制，替代 rev2 `wallRemaining + KILL_GRACE` 公式——grace 双重
计入会放大预算，超支可达 2×grace）
1. **连续超时计数**：events.jsonl 回放"本 phase 自上次非超时 verdict 以来连续
   `agent_timeout` 次数"（含 PASS+unclosed 型），签名无关；
2. **升档一次**：连续第 2 次超时后，下一 attempt 基础 timeout ×1.5（仅默认表派生值参与；
   显式 override 不动）；
3. **wall deadline 制（全链路）**：
   ```
   wallDeadlineMs = wallClockStartMs + wallClockBudgetMs

   // agent 零预算禁启动（rev7，与 harness 对称——rev6 的 max(0,…) 会把 0 漏给
   // adapter，而 invoke timer 语义 timeoutMs>0 才启用（agent-invoke.ts:788）、
   // checkRunBudget 只查原始 wall（:1724）："原始 remaining=30s、reserve=60s"时
   // agent 会无超时启动）。判定先于 buildPhasePrompt 与 agent_invoke_start：
   availableForAgentMs = wallDeadlineMs - now - FINALIZE_RESERVE_MS
   if (availableForAgentMs <= 0) → 不构建 prompt、不写 agent_invoke_start、
                                    不调 adapter，直接 budget_wall_clock 终局
   effectiveAgentTimeoutMs = min(baseOrBoostedTimeoutMs, availableForAgentMs)
   // 恒 > 0；调用 adapter 前断言 effectiveAgentTimeoutMs > 0
   ```
   - **KILL_GRACE 与真实 termination 契约同源单 SSOT（rev5，替代 rev4"在
     goal-timeout.ts 另造常量"；rev6 补全派生清单）**：termination 契约已实存于
     [agent-invoke.ts:62-71](harness/scripts/utils/agent-invoke.ts)——
     `DEFAULT_CHILD_SETTLE_GRACE_MS=3s`（rev5 曾漏列）/
     `DEFAULT_FORCE_SETTLE_AFTER_KILL_MS=5s` / `DEFAULT_KILL_PROCESS_TREE_WAIT_MS=10s` /
     `DEFAULT_KILL_INFLIGHT_DRAIN_MS=1s`。wall 验收用的 grace 由**完整 termination
     state machine 取保守上界派生**（导出聚合函数 `resolveKillGraceMs()`，
     goal-timeout.ts 只 re-export/消费，不另定义脱钩数值；实施时对齐实际 settle 路径
     的串行/并行关系后取上界，四常量缺一不可）；`FINALIZE_RESERVE_MS` 为新常量（预留
     checkpoint/report/snapshot 收尾）；grace **只用于 kill/收尾核算，不加进 agent 预算**；
   - **Windows tree-kill 有界化（rev5 P0 阻断；rev6 收紧为"结束 helper"而非"放弃
     等待"——存活 helper 持有 pipe/handle 仍会阻止 Node 进程退出）**：
     [killProcessTree](harness/scripts/utils/agent-invoke.ts:538) win32 分支现用
     `spawnSync('taskkill', …)`，源码自注 :545"blocks the event loop —
     awaitPromiseWithTimeout cannot interrupt a hung taskkill"——taskkill 一卡，
     agent/harness 两条 hard wall 全部失界，KILL_GRACE 不构成真实上界。改：
     ①`execFile('taskkill.exe', args, { shell: false, windowsHide: true })`**异步**执行
     （不走 shell，路径/参数不过 cmd 解析）；②helper 自身设有界等待（上限取
     DEFAULT_KILL_PROCESS_TREE_WAIT_MS）；③超时后**主动结束 taskkill helper**
     （helper.kill）+ **销毁/关闭其 stdio 与事件监听**，再返回
     `kill_error: 'kill_process_tree_timeout'`（kill 转 best-effort 观测，与 :68 注释
     既有语义一致）；④**agent 与 harness 共用同一 bounded kill 实现**；⑤stub 测试
     "taskkill 永不退出"→ 除断言 Promise 按时返回外，**还须断言 runner 进程实际退出、
     无活跃 helper handle**；
   - agent 结束后、**启动 harness 前**再查预算（rev5 收紧判据——invoke timer 语义是
     `timeoutMs > 0` 才启用，[agent-invoke.ts:788](harness/scripts/utils/agent-invoke.ts)
     实锤，**传 0 = 关闭超时**，绝不可把 0 交给 timer）：
     ```
     availableForHarnessMs = wallDeadlineMs - now - FINALIZE_RESERVE_MS
     if (availableForHarnessMs <= 0) → 不 spawn harness，直接 budget_wall_clock 终局
     else → harnessTimeoutMs = availableForHarnessMs
     ```
     （判据是**扣除 reserve 后**的值——"原始 remaining>0 但扣 reserve 后 ≤0"也不 spawn，
     不产半份 harness 证据）；**`runHarnessPhase()` 返回结构化结果
     `{exitCode, timedOut}`**（现签名只回 number，exitCode=1 无法区分门禁真失败与
     wall 树杀）；超时路径：bounded 树杀 → 写 `harness_end {timed_out: true}` →
     **直接 `budget_wall_clock` 终局，不读取/归因可能只写了一半的 summary**
     （半份证据比无证据更毒）；
   - **transient backoff 钳制（rev4，第四条等待路径）**：现
     [goal-runner.ts:2448](harness/scripts/goal-runner.ts) `sleepMs(backoffMs)` 无条件
     等 5/15/45s、wall 只在下一轮才查——wall 只剩 2s 也会先睡 45s。改
     `effectiveBackoffMs = min(configuredBackoffMs, max(0, wallDeadlineMs - now -
     FINALIZE_RESERVE_MS))`；剩余不足 → 不 sleep，直接 `budget_wall_clock`；
   - **终局收尾核算口径（rev4 钉死）**：`run_end`（[goal-runner.ts:2528](harness/scripts/goal-runner.ts)）
     之后仍有 completion receipt 等后置工作（:2532+）——验收"总时长"以**进程退出**为准；
     run_end 语义不动（标记链路终局），run_end 后全部收尾必须在 FINALIZE_RESERVE 内
     完成，超预留则**跳过 best-effort 收尾**（receipt 生成本就"失败只记录、不改变 run
     终局"，:2530 注释既有契约）并事件留痕 `finalize_skipped`；
   - 验收标准："**进程总时长** ≤ wall 限 + `resolveKillGraceMs()`"（agent + harness +
     backoff + 收尾四路径全覆盖；grace 由真实 termination 契约派生，含 Windows bounded
     kill——否则该不等式无真实上界），本案 27m 超支形态在回放测试中不再可能；
4. **effective_timeout_ms 单一事实源**：`GoalRunEvent` 增可选 `effective_timeout_ms?:
   number`；**计算先于 `buildPhasePrompt()`**，同一个值传 prompt（P0-1.6 预算提示）、
   `agent_invoke_start` 事件、adapter invoke timeoutMs、progress——
   progress/goal-status/dead-man/liveness **优先读最近 invoke 事件该字段**、manifest
   解析仅作旧日志/无事件 fallback（**旧 events.jsonl 无此字段的 fallback 路径单测**，
   codex）；
5. **熔断求人**：升档后再超时（连续第 3 次）→ halt，`halt_reason=agent_timeout_repeated`，
   guidance 三选一（调 `phase_timeout_seconds.<phase>` / 拆需求 / 查 adapter 环境）+
   各 attempt 实际时长表；
6. **依赖与反事实**：本项**必须与 P0-1 同批或之后落地**——反事实推演：若单独先上，
   本案会在 spec-i3 熔断求人（早于宿主热修的 i6），把"最终能过"的路径提前拦断；
   P0-1（真续作）+ P0-2（门禁不再崩）落地后，"连续 3 次超时仍不收敛"才真正成为值得
   求人的信号。

## 六、P1-6 宿主侧修 framework 的正规通道引导

### 根治（NL 指引类，按 [[host-side-nl-only]] 口径写话术）
1. AGENTS.md 模板 + framework 写保护 skill reference（e8f5a2c7 产物）增
   "修改 framework/ 发布件前必读"：发现框架 bug → 上报回灌源仓优先；确需本地热修 →
   **真人**在 `integrity.drift_allowlist` 添加 `{path, rationale, approved_by}` 后再改；
   goal run 进行中 → 先停 run 或明示接受 run 内 integrity halt（呼应 P0-5）；
2. **修正过期模板文案**：
   [framework.config.template.json:48](templates/framework.config.template.json) 的
   integrity field_notes 仍推荐 `allow_local_drift: true` 与**字符串数组** allowlist——
   与 runtime 具名审批收权（{path, rationale, approved_by}，agent 自加无效）不一致，
   照抄即产出无效配置。同步改为结构化审批示例 + "真人具名"红线；
   framework-integrity.ts 的 FAIL suggestion 补"goal run 并发场景先停 run"一句；
3. 授权粒度提示：批量修改 framework 文件超出用户单点批准范围时应回问（本案宿主把
   "修 2 个 bug"扩成 7 文件清扫）——写入宿主侧 skill 话术，不做机器强制（无可靠边界）。

## 七、P1-7 chrys 可观测性 spike（rev4 证据卫生）

### 现状与边界
- 本机无 chrys；[agents/chrys/adapter.yaml:31](agents/chrys/adapter.yaml)
  `chrys run --task ... --json` 与现场"被杀 attempt 0 字节/成功 attempt 终态一次性 JSON"
  一致但未经宿主端核实（adapter.yaml 自注亦称待核实）。

### 内容（rev3 落位校准）
1. **spike 任务**（挂 diagnosis-residual）：请宿主执行 `chrys run --help` +
   `chrys --version` 回传；
2. **静态能力**：`output_delivery: streaming | buffered | unknown` 进
   [agents/adapter-schema.yaml](agents/adapter-schema.yaml) 与各 adapter 配置（缺省
   unknown）——它是 adapter 的稳定能力声明，归属配置层；
3. **运行时信息**：`adapter_version` 由 `--version` 动态探测，记入 run event/manifest
   diagnostics——**不硬编码进 adapter.yaml**（版本随宿主环境漂移，写死必腐烂）；
   **探测卫生（rev4）**：每 run 一次、短超时（~5s）、结果缓存复用，探测失败记
   unknown、不阻塞 run（版本探测自己不许卡 attempt）；
4. **kill 诊断不写 agent-output.log（rev4 反转，codex 采纳）**：该文件是三处证据源——
   interaction sentinel 解析（[goal-runner.ts:1957](harness/scripts/goal-runner.ts)）、
   critic receipt 的 outputHash（:1982）、heartbeat output bytes——追加 runner 文本
   =污染 agent 原始输出证据 + 消灭"0 字节"这一事实本身。改为：
   `agent_invoke_end` 事件增字段 `{kill_reason: 'agent_timeout'|…,
   effective_timeout_ms, output_bytes, output_delivery}`（timed_out/kill_attempted
   已有）；需要人读长诊断时另写 `runner-diagnostics.log`，**agent-output.log 保持
   agent 原始输出、runner 永不写入**（单测断言）；
5. `output_delivery: buffered/unknown` 时 goal-mode 文档明示"断流哨兵对该 adapter
   可能失效，断流表现为整 attempt 超时"。

## 八、P1-8 归因/提示噪声（stale 项待定位）

1. **PASS 事件不输出 `failure_kind_classified`**（已核实，可直接做）：
   [goal-runner.ts:2337](harness/scripts/goal-runner.ts) 无条件写入，本案 advance 事件
   全带 `code_regression`——verdict=PASS 且 action=advance 时省略；
2. **facts.md schema 门禁报错带模板**（已核实，可直接做）：
   [context-facts.ts:136-147](harness/scripts/utils/context-facts.ts) 要求
   `schema_version: "1.0"`，与 context-exploration.md 的 1.0.0/1.1.0
   （[context-exploration.ts:28](harness/scripts/utils/context-exploration.ts)）双版本体系
   弱模型必踩（本案 i4/i5 实证）。不动版本值，FAIL details 升级为期望值 + 最小合法
   frontmatter 模板 + "与 context-exploration.md 版本号是两套"提示；`established_by` 同款；
3. **monitor stale 误报：先 replay 定位再定方案**（rev1 summary-mtime 方案已撤回）。
   现场证据：宿主每轮调用均为 `goal-monitor.ts ... --since-event 0`（游标从未推进）；
   progress 在新 `agent_invoke_start` 后应已投影 AGENT_RUNNING。两候选根因未分：
   (a) 调用侧未推进 since-event 致历史 verdict 重放；(b) monitor 输出历史 verdict 未标注
   "已被后续 invoke supersede"。diagnosis-residual 用现场 events 做 replay fixture 分辨后，
   再决定修调用侧话术（bounded-monitor skill 指引）还是 monitor 输出侧（supersede 标注），
   或两者。

## 九、测试计划（rev4 扩充）

- **goal-runner 单测（P0-1）**：continuation 双维度矩阵——同进程超时 / PASS+timeout
  （含空 partial）/ 跨进程 resume × 上次超时（cause 不得被 process_resume 掩盖）/
  跨进程 resume × 上次 content FAIL / **resume 进入全新 phase → continuation=null
  零注入** / 五态窗口逐态：有 start 无 end → unknown、**end 带 timed_out=true 无
  verdict → agent_timeout（timeout end 后 verdict 前崩溃，真因不丢）**、**end 正常无
  verdict → unknown（agent end 后 harness 中崩溃）**（rev7 显式入正式计划，防实施
  漏测）/ **最新 attempt 优先**（旧 timeout 不得盖过更新的 content FAIL）/
  transient 断流块头 / 干净首跑零注入；
- **goal-runner 单测（P0-4）**：连续超时计数（events 回放，FAIL/PASS+unclosed 混排）、
  升档一次、第 3 次 halt、`effective_timeout_ms` 事件写入与**旧日志无字段 fallback**、
  progress 读 invoke 事件优先于 manifest（脑裂回归）、**wall deadline 四路径**（agent
  钳制 / **agent 启动判据 `availableForAgentMs ≤ 0` 不构建 prompt、不写
  agent_invoke_start、不调 adapter、直接 budget_wall_clock——含"原始 remaining>0 但扣
  reserve 后 ≤0"变体、"effectiveAgentTimeoutMs===0 永不传给 adapter"断言（rev7）** /
  harness 启动判据 `availableForHarnessMs ≤ 0` 不 spawn——**含同款变体与"绝不把 0 传给
  timer"断言；agent/harness 两条 zero-budget no-spawn 对称断言** / harness timeout+bounded
  tree-kill+`{exitCode, timedOut}` 结构化结果+不读半写 summary / **backoff 钳制与剩余
  不足不 sleep 直接终局**）、**"taskkill 永不退出"stub → 除 Promise 按时返回外还断言
  runner 进程实际退出、无活跃 helper handle**（rev5 P0/rev6 收紧）、**"进程总时长 ≤
  wall 限 + resolveKillGraceMs()"进程退出口径**、run_end 后收尾超预留
  `finalize_skipped` 留痕、**grace 与 termination 契约同源断言**（resolveKillGraceMs
  派生自 agent-invoke 全部四个 DEFAULT_*——含 CHILD_SETTLE_GRACE——不允许脱钩常量/
  漏项）、FINALIZE_RESERVE_MS 常量契约；
- **classifier 单测（P0-3/P0-5）**：framework_bug 归因（classification 通道）、
  framework_integrity_block 各 subtype（**6 值**）归因与 guidance 分文案、
  **integrity_subtypes 收集式**（`blocking_class==='integrity'` 过滤 + 读
  `classification` 字段 + 非 integrity blocker 的 classification 不得混入 + 旧 summary
  顶层 failure_kind 回落；"sidecar_missing + drift + foreign_file 三类共存"组合用例
  ——全部收集、guidance 按修复顺序逐条列出、不丢项）、**freshness 决策表逐行用例**
  （P0-5.4 五行表 SSOT：stale→agent_timeout / fresh+含 integrity→integrity_block
  （integrity+content 混装也归 integrity_block，不回落 timeout）/ fresh+非空全
  framework_bug→framework_bug（**空 blockers 数组不得触发**，防 `.every()` 真空真值）/
  fresh+framework_bug 混 content→agent_timeout（用例名标注"依赖 P0-2 收敛"）/
  fresh+纯 content→agent_timeout）；
- **证据卫生（P1-7）**：kill 路径后 agent-output.log 字节数不变（runner 永不写入）、
  `agent_invoke_end` 含 kill_reason/effective_timeout_ms/output_bytes、`--version`
  探测超时不阻塞 attempt；
- **profiles harness fixtures（P0-2）**：四类形状 × inventory 表 checker——零 throw、
  结构化 FAIL、details 含期望形状；显式断言"非法形状不得静默 PASS"；
- **回归**：goal-timeout 默认表/地板/wall 派生单测不动；E4 既有单测全绿；summary
  round-trip 无 schema 变更（P0-3/P0-5 复用字段前提验证）。
- 单测跑法沿用 ts-node（[[critic-loop-plan-f7a3d9c2-status]]）。

## 十、不做与开放问题（rev3 更新）

- **不做**：framework 漂移自动回滚（前置条件：run-start/attempt-start framework 哈希
  快照 + 可信 writer provenance，量级另立 plan）；
- **不做**：per-phase 预算按需求规模自动伸缩（P0-4 升档+熔断以更便宜方式覆盖）；
  默认表数值本轮不动；
- **不做**：宿主与 goal run 并发写盘互斥（P1-6 话术 + P0-5 halt 已封本案路径，留观察）；
- **开放问题 1**：升档系数 1.5 与次数是否 per-phase 差异化——先统一，回灌数据后调；
- **开放问题 2**：framework_bug halt 是否附带降级 SKIP 让链路继续——倾向不做
  （fail-closed；SKIP 常态化=门禁失明），存档；
- **开放问题 3（rev5 收窄）**：**仅限 framework_bug** 的混装场景是否扩大 flip
  （"any framework_bug 即 flip"）——待 P0-2 落地后看混装残余量再定，不预做；
  **integrity 不在其列**（决策表已定 any-integrity 即 framework_integrity_block，
  fresh 时不论混装与否）；
- **开放问题 4（rev3 新增）**：FINALIZE_RESERVE_MS 取值（checkpoint/report/snapshot
  收尾实测耗时分布未采样）——实施时先取保守常量（建议 60s）+ 事件记录实际收尾耗时，
  回灌数据后调；
- **开放问题 5（rev8 新增，偏离①的完全体）**：run_end 后收尾 worker/child 隔离——
  把 completion receipt 等同步 fs 收尾挪进可 kill 的子进程，使"进程总时长 ≤ wall +
  grace"对收尾也成为可执行硬 bound（同步挂起时进程内 watchdog 不运行，进程内无解）。
  独立量级重构，另立 plan。
