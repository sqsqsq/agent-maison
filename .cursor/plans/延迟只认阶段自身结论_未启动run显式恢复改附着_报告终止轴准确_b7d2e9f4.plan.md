---
name: 延迟只认阶段自身结论 — 未启动 run 的显式恢复改附着与报告终止轴准确
version: 3.1.0
overview: >
  基于 2026-10-07 开卡宿主第四轮（候选包 5acd53e2，从 09-28 公共起点，run 20260928T043051Z-be091c）的只读取证：
  testing 一轮同时含产品缺陷与视觉 provider 不可用（宿主 claude CLI OAuth 过期）时，assess 把 testing 的 FAIL 摘要判成"延迟"，
  回退修完 coding→review→ut 全 PASS 后对尚未到达的 testing 给出 resolve_deferred，驱动器无执行语义、兜底 framework_bug 停机两次，
  链无法自动走到 testing 复跑。另修两处准确性：显式 --resume 指向从未正式开始的 run 被拒绝并给出"人工核查"误导、detach 父进程只见 alive_timeout；
  agent 完成后被宽限 tree-kill 的 invoke 在报告里标 error / exit=1 告警。全部是减法与接线：延迟只认阶段自身结论（INCOMPLETE / completion_status=deferred），
  尚未到达的阶段只前进不"解决"，显式恢复对未启动 run 按同一接续决策改附着，报告终止轴按完成事实标注。不新增停机原因、状态、字段、注册表或门禁。
todos:
  - id: t1-deferred-semantics-and-driver-advance
    content: >
      §3.1：assess.ts isDeferredSummary 去掉 blockers 的 externalBlocked/external_block/device_blocked 扫描，只认 verdict=INCOMPLETE 或 completion_status=deferred；
      hasInputBlockedCapability 不动。§3.2：goal-assess-driver.ts selectRunnerActionFromAssess 的 resolve_deferred 分支先算 targetRelation，目标在当前阶段之后（later）返回 advance；
      带 defer_* runner_action 与 upstream 情形保持原样。单测：按宿主 be091c 形状（coding/review/ut PASS，testing FAIL+externalBlocked blocker，当前 ut PASS）
      经 observeFeatureState / assessObservation / selectRunnerActionFromAssess 三段断言 deferred=false、gap=failed、recommendation=rerun_phase testing、action=advance；
      INCOMPLETE 上游延迟仍 resolve_deferred + defer_external_and_halt；下游 deferred=true（INCOMPLETE）→ advance 而非 halt。
    status: completed
  - id: t2-explicit-resume-attaches
    content: >
      §3.3：goal-phase-runtime.ts 显式接续段（resumeTurnsIntoSuccessor 之后）增加同一接续决策的第二种改写：plainContinuation 为 rejoin 且 started=false 且 runId 与 --resume 目标相同时，
      只去掉 --resume，保留用户给的 --force-resume（explicitTakeover 在改写之后读取，orphaned_session 只靠显式接管才能拿回 owner），改为 --attach-created 同一 run；
      detach 父进程照旧透传原始参数，由子进程在同一段改写，父进程以子进程写出的 run_start 握手；attended 入口（goal-mode-entry 已按 hasExecutionStart 选 --attach-created）不改。
      6577 拒绝文案区分"只有出生事件、无正式开始"与"真源损坏"。
      回归：run_created + 启动期 HALTED（canary_cli_hard_failure）且无 run_start 的 run 目录，带 --resume 发起（前台与 detach 各一）→ 附着并正常 run_start；
      同形 run + 过期 session owner + --resume --force-resume → 接管成功并 run_start；events 真缺失/损坏仍拒绝；对已开始的 run 的 --resume 行为不变（冷却 / 接回 / 起后继三例）。
    status: completed
  - id: t3-report-termination-accuracy
    content: >
      §3.4：goal-report-generator.ts 四轴时间线的 termination 轴与 goal-phase-runtime.ts buildAgentWarn 消费已归一的 completion_observed（agent-invoke 只在 exit=0 或完成后清理 kill 时才置它）：
      这类 invoke 的 termination 显示为 completed（cleanup，exit=N）、不出 exit=N 告警；timeout、真实失败、silent_killed 的诊断一律保留；事件字段与 agentFailed 语义不变。
      单测：exit=1 + completion_observed → 无 WARN、时间线 completed；exit=1 无 completion（terminal failure）→ 维持 error/WARN。
    status: completed
  - id: t4-verify-docs-metrics
    content: >
      §4：typecheck 与目标套件；冻结后调度在隔离工作树跑 harness/npm test 与受影响 release-only 链路；MIGRATION 三句；goal-mode-runbook 的恢复指引同步；
      OpenSpec change（goal-runner delta：延迟定义、未到达阶段不解决、显式恢复对未启动 run 的改写、报告终止轴）；§5 第四轮基线与三轮对照写入 scripts/reliability/observations；
      plan 扫描、OpenSpec strict、diff --check、LF。
    status: completed
---

# 延迟只认阶段自身结论 — 未启动 run 的显式恢复改附着与报告终止轴准确

## 1. 边界与事实

### 1.1 来源

- 宿主第四轮：候选包 `dist/candidates/framework-3.1.0-candidate.zip`（源 5acd53e2），宿主从 `dist/reliability-baseline/host-initial-state-20260928` 恢复后由宿主 AI 无人值守发起。
- 真源：`doc/features/bc-openCard-2/open-card-flow-v2/goal-runs/20260928T043051Z-be091c/{events.jsonl,detach.log,goal-report.md}`、`open-card-flow-v2/next.json`、`open-card-flow-v2/testing/reports/{summary.json,script-report.json}`（宿主盘面，只读）。
- 对照数据：`dist/reliability-baseline/host-old-package-run-20261003`、`host-run3-98434b6f-20261007` 内的 goal-runs 事件（§5）。

### 1.2 事实链（UTC）

1. 10-07 15:0x：宿主 AI 对 be091c（09-28 出生，事件只有 `run_created` + 启动期 `phase_halt/run_end canary_cli_hard_failure`，**无 `run_start`**）带 `--resume` 发起。子进程在 `goal-phase-runtime.ts:6572-6581` 拒绝："--resume 需要 events 含有效 authoritative run_start … 处置：人工核查 run 目录（非本 run 的 events / 文件被整体替换/清空）"，只写进 detach.log；父进程报 `alive_timeout`。宿主 AI 改为普通发起，按接续决策附着成功（15:13:25 `run_start`）。
2. coding FAIL（`context_exploration_facts_source_stale`）→ 重试 PASS → review FAIL → 回退 coding（CR-003/004）→ coding FAIL（同 blocker）→ 重试 PASS → review PASS → ut PASS → testing（16:47–17:04）。
3. testing 结论 FAIL，summary 8 个 BLOCKER 并存两类事实：产品缺陷 `testing_failure_routing_TC-004_s11 / TC-005_s11`（owner=coding，sms_next 被遮挡的老问题）；视觉轴 `visual_diff` 为 `blocking_class=externalBlocked, failure_kind=capability_missing`，原因 "provider 观测到失败终态：result.failed: Failed to authenticate: OAuth session expired and could not be refreshed"（`check-testing.ts:5786-5797` 的 DEFERRED_CAPABILITY_MISSING 投影）。`p0_coverage_integrity`、`p0_semantic_coverage_integrity`、`testing_channel_evidence_obligation` 三项同时含 TC-004/005 的真实失败与 TC-007/AC-8 的视觉缺席（混合来源）；`testing_run_status` 只在 script-report 里、已被 summary 聚合去重。`classifyFailureKind` 的聚合策略把混合原因压成单标签 `external_block`（事件 `failure_kind_classified=external_block`），但 assess 候选分支先行，正确回退 coding（`backtrack_to_phase`）。
4. 回退后 coding（coding-i21 模型容量错误 + 断流，`terminal_failure_observed`，agent_failed 重试一次后 PASS）→ review PASS → ut PASS（18:16:01）。assess 观察：coding/review/ut 当前 PASS；testing 的旧摘要 verdict=FAIL、closure=open，但 `isDeferredSummary`（`assess.ts:326-334`）因 blockers 里有 externalBlocked 判 **deferred=true** → gap `deferred: verdict=FAIL`（`assess.ts:705-707`）→ `resolve_deferred` phase=testing；`recommendationForGap`（`assess.ts:805-827`）只给上游 gap 配 runner_action，下游 gap 无 runner_action → `selectRunnerActionFromAssess`（`goal-assess-driver.ts:61-72`）返回 `halt` → runner 汇点（`goal-phase-runtime.ts:10785-10830`）无 haltReason → `resolveAssessHaltIncident`（`goal-failure-classifier.ts:220-240`）fail-closed 成 `framework_bug`；事件 `phase_halt ut framework_bug "[gap 属于 testing 阶段，非当前 ut] deferred: verdict=FAIL"`，`run_end HALTED WAITING external`。
5. 18:21 宿主 AI `--resume`（无变化，但距停机 5 m 32 s 已过默认 5 分钟冷却）→ ut 复跑（agent 61 s，复用有效闭环证据）PASS → 同一停机再现（18:23:49）。宿主 AI 停止。
6. 已用调度脚本在生产代码上复现（`assessObservation` + `selectRunnerActionFromAssess` + `resolveAssessHaltIncident`）：`recommendation=resolve_deferred testing`、`runner action=halt`、`halt incident=framework_bug`。

### 1.3 本轮不算框架问题、但要记着的

- 视觉 provider（`framework.local.json` vision.visual_provider = claude/claude-opus-5）在宿主机已登出：`claude auth status` → `loggedIn=false`。maison 把它判成 DEFERRED_CAPABILITY_MISSING / externalBlocked 是正确的；下一轮 testing 前需人工重新登录，否则视觉轴继续缺席（§6 E）。
- codex CLI 0.153.4 在 `turn.completed` 后不自行退出（stderr 还有 "failed to install system skills: 拒绝访问 (os error 5)"、"failed to refresh available models: timeout"），`agent-invoke.ts:1323-1330` 的 5 s 宽限后 tree-kill；本轮 12/13 次 invoke 为 exit=1 + completion_observed=true + kill_attempted=true（余下 coding-i21 是真实终态失败：模型容量 + 断流，无 completion、未 kill，随后按 agent_failed 重试），harness 全部按新鲜 summary 裁决，未影响结论。只影响报告标注（问题 D）。
- 宿主 AI 把"human 处置"类拒绝当成可自行绕过的问题继续发起，属正确行为；不要求宿主改做法。

## 2. 问题定性与准入

| 编号 | 定性 | 影响指标 | 放过的后果（类别） |
|---|---|---|---|
| A 阶段结论与 blocker 判定不一致：FAIL 摘要只要含一个 externalBlocked blocker 就被 assess 当成"延迟"，与 `classifyPhaseVerdict` 只对 INCOMPLETE 延迟的 SSOT（`phase-transition-policy.ts:337-345`）和共享 `resolveVerdictFromChecks` 的"唯一外部阻断才 INCOMPLETE"（`report-generator.ts:752` 起）不一致 | 机制一致性缺陷（修复是局部判断收窄） | 成功率、效率、准确率 | ④ 已承诺的自动恢复确定性失败：修完回退后链停在 ut，复跑只会再停 |
| B 下游推荐缺少执行映射：驱动器对"尚未到达的延迟阶段"无动作，兜底 framework_bug，disposition 写成"等待外部"。它独立覆盖真正 INCOMPLETE 的下游阶段，不是 A 修后的冗余 | 机制一致性缺陷（修复是接线） | 成功率、效率、准确率 | ④ 同上；文案把读者引向"框架坏了 / 等外部"，宿主 AI 无从恢复。A/B 在本轮共同造成同一组两次停机，按一组事故计 |
| C 显式 `--resume` 指向从未正式开始的 run：显式决策固定 `started=true`（`goal-run-creation.ts:976`），6577 处按"真源损坏"拒绝，指引"人工核查"；detach 父进程只见 alive_timeout | 入口遗漏（a2f7c9e4 §3.3 统一接续决策时漏掉的分支） | 效率、准确率 | 零调用的发起尝试 1 次 + 误导指引；宿主 AI 靠自己绕过 |
| D 完成后被宽限 kill 的 invoke 在 goal-report 里标 `error × PASS` 与 "agent WARN exit=1" | 展示问题 | 准确率（不提升任务成功率） | 报告失真（本轮 3 条时间线 + 1 条 WARN） |

准入两问：本 plan 不新增阻断检查、停机原因、登记字段、注册表条目、路由、状态或协议；A/B/C 是把既有判断收窄到既有 SSOT，D 是报告消费既有事件字段。场景＝本轮真实事故（be091c 两次假停机、一次零调用启动、报告失真），收益＝§5 的验收指标。

## 3. 设计

### 3.1 延迟只认阶段自身结论（t1）

`assess.ts isDeferredSummary`：返回 `verdict === 'INCOMPLETE' || completion_status === 'deferred'`，删除对 blockers 的 externalBlocked / external_block / device_blocked 扫描。理由：延迟是"阶段没能得出结论、允许下游先走、最后回来解决"的阶段级事实，由 runner 预检（`goal-phase-runtime.ts:1144/7649`）与 check-ut 唯一阻断规则写出 INCOMPLETE；一个 FAIL 摘要带着产品缺陷再加一个外部 blocker，是"失败且另有外部条件缺席"，回到该阶段复跑时外部条件自然被重新评估。`hasInputBlockedCapability` 保留其"外部 blocker 优先于本地 blocked"分支（它只在 INCOMPLETE 时才会被问到）。

影响面：`deferred` 只在 assess 的 gap 分类与 `producerOwnedInputGap` 跳过里消费；runner 的延迟执行路径（`defer_external_*`）来自 phase outcome，不读此字段。现有用例（`assess.unit.test` P2-T5 / "FAIL and DEFERRED remain distinct"、`blocked-capability-projection` t2 三例、`goal-assess-driver` 延迟例）全部用 INCOMPLETE 或 completion_status，不变。

### 3.2 尚未到达的阶段只前进（t1）

`goal-assess-driver.ts selectRunnerActionFromAssess`：`resolve_deferred` 分支保留 `defer_external_*` 透传；否则计算 `targetRelation`，`later` → `advance`（与 `rerun_phase`/`run_phase` 的下游语义一致，runner 随后按链序进入该阶段复跑）；其余（same / earlier / invalid）仍 `halt`。assess 文本不改（`resolve_deferred: deferred: verdict=INCOMPLETE` 对下游 INCOMPLETE 阶段仍是准确描述："它延迟过，下一步就是去跑它"）。

3.1 修根因，3.2 堵第二道口：即便将来某个 producer 真写出下游 INCOMPLETE（例如回退越过了一个延迟阶段），链也只会前进，不会兜底成 framework_bug。

### 3.3 显式恢复对未启动 run 改附着（t2）

`goal-phase-runtime.ts` 显式接续段（5171 行 `resumeTurnsIntoSuccessor` 之后、`explicitContinuation` 之前）：

- 当 `argv.resume` 且 `plainContinuation.kind === 'rejoin' && plainContinuation.started === false && plainContinuation.runId === String(argv.resume).trim()`：`delete argv.resume; attachCreatedRunId = argv['attach-created'] = runId`，**保留 `--force-resume`**（`forceResume` 在 5591 行、改写之后才读取，并进入 5735 行的 `explicitTakeover`；未启动 run 的 session owner 过期成 orphaned_session 时只有显式接管才能拿回 owner，删掉它会让改附着后停在 owner busy）。日志 "`--resume <id>` 改为附着（该 run 尚未正式开始；同一恢复判断）"。这是 a2f7c9e4 §3.3"显式旗标只确定目标、资格取同一决策"的第二种改写，与 9c3d7e1a 的"改起后继"并列。
- detach 父进程在 5047 行 `runDetachLauncher` 处已返回，不经过这一段：父进程照旧透传原始 `--resume`，子进程在这一段改写；父进程等待的是同 run 新写出的 `run_start`，子进程附着成功即握手，不需要父进程提前改写。attended 入口（`goal-mode-entry.ts:373` 已按 hasExecutionStart 选 `--attach-created`）不改，其回归只验证附着成功，不要求出现改写日志。
- hold / successor / 目标不是最新可接回 run / events 损坏等情形不满足条件，不改附着。改附着后不进入仅限 `argv.resume` 的 terminal guard，与既有 attach 语义一致。
- 6577 拒绝保留给真源损坏：文案改为区分两种情况——"只有出生事件、未正式开始：直接以普通方式发起或 --attach-created 接入"与"文件被替换/清空：人工核查"。
- 不碰 `checkTerminalResumeGuard`、冷却与预算；附着后 run_start 照常由既有路径写出。

### 3.4 报告终止轴按完成事实（t3）

- 依据：`agent-invoke.ts:1429` 只在 `exitCode === 0` 或已触发完成后清理 kill 时才置 `completion_observed=true`，自然 exit≠0 不会带此字段（`codex-terminal-closure.unit.test.ts:320` 已覆盖四种 adapter 的反例），所以报告直接消费这个已归一字段，不新建终止分类。
- `goal-report-generator.ts:229`：`termination = timed_out ? 'timeout' : exit_code === 0 ? 'exit0' : completion_observed ? 'completed（cleanup，exit=N）' : 'error'`，保留进程事实；`timeouts / contentFails` 计数口径不变（contentFails 看 harness verdict）。
- `goal-phase-runtime.ts:4513-4526 buildAgentWarn`：入参增加 `completion_observed`；只抑制 `exitCode !== 0 && completion_observed && !timed_out && !silent_killed` 这一种完成后清理的退出码噪声；timeout、真实失败、历史 `silent_killed` 的诊断一律保留。
- events 字段、`agentFailed = exitCode!==0 && !completionObserved` 语义、phase_verdict 的 `agent_stderr_excerpt` 均不变。测试复用既有生产终止用例，加报告消费断言。

## 4. 验证

### 4.1 目标套件（每批）

`cd harness && npm run typecheck`；`npx ts-node tests/run-unit.ts --filter assess`、`goal-assess-driver`、`blocked-capability-projection`、`phase-transition-policy`、`goal-runner-policy`、`goal-run-birth-contract`、`host-runtime-truth`、`goal-phase-runtime`、`goal-report`、`check-disposition`、`adjudication`；`npm run openspec:validate`；`node scripts/check-plan-version.mjs`。

### 4.2 结果矩阵（真实生产入口与真实产物，不手写结论）

| 场景 | 入口 | 期望 |
|---|---|---|
| be091c 形状：coding/review/ut 当前 PASS，testing 旧摘要 FAIL + externalBlocked blocker + coding 候选，当前 ut PASS | `observeFeatureState`（临时 feature 目录写入与宿主同形 summary.json）→ `assessObservation` → `selectRunnerActionFromAssess` | testing `deferred=false`、gap `failed`、recommendation `rerun_phase testing`、action `advance`；不再 `framework_bug` |
| 上游 INCOMPLETE 延迟（P2-T5 / goal-assess-driver 既有例） | 同上 | `resolve_deferred` + `defer_external_and_halt`，不变 |
| 下游 INCOMPLETE 延迟（coding PASS，review INCOMPLETE deferred=true，当前 coding PASS） | `assessObservation` + driver | `resolve_deferred review`、action `advance` |
| run 目录只有 `run_created` + 启动期 `phase_halt/run_end`，带 `--resume` 发起（前台与 detach 各一） | 生产 runtime（既有 host-runtime-truth / birth-contract 夹具风格） | 日志"改为附着"、写出 `run_start`、detach 父进程握手成功；无 run_start 且 events 缺失/损坏的拒绝不变 |
| 同形 run + 过期 session owner（orphaned_session）+ `--resume --force-resume` | 同上 | 改附着后保留显式接管，拿回 owner 并写出 `run_start`；不带 `--force-resume` 时维持既有拒绝 |
| attended 入口对同形 run | `goal-mode-entry` | 按既有 hasExecutionStart 选 `--attach-created`，附着成功（不要求改写日志） |
| 已开始的 run 带 `--resume` | 同上 | 行为与改动前一致（冷却 / 接回 / 起后继三例回归） |
| invoke exit=1 + completion_observed（完成后清理 kill）；exit=1 无 completion（coding-i21 形状的终态失败） | goal-report 生成 | 前者 `completed（cleanup，exit=1） × PASS`、无 WARN；后者 `error`、WARN 保留 |

宿主验收 H1（用户批准后）：宿主继续 be091c（重新登录 claude 后普通发起 → 接回 → ut 复跑 PASS → 自动进入 testing），事件里不再出现 ut 的 `framework_bug`。

### 4.3 收口

冻结后调度在隔离工作树跑 `harness && npm test`、fixtures、design-authority-repair、real-chain、lifecycle-evolution、reliability-scenarios；diff --check；LF；openspec validate。

## 5. 指标口径与本轮基线

口径同 a2f7c9e4 §5（效率：run_start→run_end 墙钟、阶段调用、可避免等待、零调用的发起尝试、宿主 AI 额外动作；成功率：无人介入达成 / 卡住点；准确率：陈述与事实矛盾数）。三轮同起点（09-28 归档）只作描述性对照，不据此宣称框架速度或成功概率；旧两轮的 run / 调用数由调度方从归档 events 统计（`dist/reliability-baseline/host-old-package-run-20261003`、`host-run3-98434b6f-20261007`），98434b6f 列混合了完整重跑与 10-06 继续模式（a2f7c9e4 登记的继续模式基线是 10 次调用、1 h 49 m）：

| | 旧包（10-02） | 98434b6f（10-04 起，含 10-06 继续模式） | 5acd53e2（10-07，本轮） |
|---|---|---|---|
| run 数 / 执行会话 / 调用 | 5 / 6 / 30 | 4 / 5 / 22 | 1 既有 run / 2 / 13（无新出生 run） |
| 墙钟 | 16:09→21:50（5 h 41 m） | 10-04 15:53→10-06 16:43（跨两天，期间人工介入） | 15:13:25→18:23:49（3 h 10 m 24 s，其中停机间隔 5 m 52 s，两段运行合计约 3 h 4 m 32 s） |
| 回退 / 重试 | 2 回退 + 3 次 backtrack_limit、1 次指纹重复 | 1 回退 + backtrack_limit×2、budget_turns×2 | 2 回退（review→coding、testing→coding）、重试 3 次（全部 coding：facts 过期 ×2、模型容量/断流 ×1） |
| 结果 | 未完成（INCOMPLETE） | CHAIN_SLICE_COMPLETED（COMPLETE_WITH_P0_GAPS） | 未完成：ut PASS 后同一组假停机 ×2，testing 未复跑 |
| 零调用的发起尝试 | 0 | 1（d6d31d budget_turns） | 1（显式 --resume 被拒） |
| 宿主 AI 额外动作 | 多次（切 provider、改 manifest） | 手改 manifest 2、修正文件 2 | 2（改普通发起；假停机后 resume） |
| 准确率失真 | — | 1 矛盾 + 3 失真（a2f7c9e4 已修） | 一组假停机（framework_bug / 等待外部，出现 2 次）、resume 拒绝指引 1 条、报告 `error × PASS` 3 条 + WARN 1 条；混合原因被压成单标签 `external_block`（聚合策略的真实结果，不计失真） |

本 plan 验收目标：同形场景下假停机 0、显式恢复未启动 run 的失败发起 0、报告 `error`/WARN 失真 0；修后宿主继续本 run 应直接进入 testing 复跑（H1）。

## 6. 不做与边界

- **E：testing 只剩外部阻断时仍按 FAIL 重试（顺延）**。共享 `resolveVerdictFromChecks`（`report-generator.ts:752` 起）已对 UT 设备、testing 装机、coding 构建环境、capability-missing 的"唯一外部阻断"投影 INCOMPLETE；缺口在于派生检查与聚合检查（`p0_coverage_integrity`、`p0_semantic_coverage_integrity`、`testing_channel_evidence_obligation`、`testing_run_status`）仍贡献普通 BLOCKER，破坏"全部阻断均为外部"的条件，于是 provider 不可用的一轮 verdict=FAIL → 既有 FAIL 重试（上限 2 次，每次约 15–20 min）→ `external_retry_exhausted`。本轮没有发生；触发条件是"产品问题已消除、外部条件仍未恢复且没有其他优先分支"。顺延原因：现有上限未被绕过、代价有界；若要并入，最小且不易误判的做法是沿现有逐 TC / AC 评估结果传播外部原因（复用 `ChannelEvidenceBinding.repair_owner` 与既有外部分类），只有某检查的**全部失败来源**都是已确认的外部缺席才给它标外部阻塞，聚合检查还要确认没有独立的文档缺失 / 关键 SKIP，最终仍由共享 `resolveVerdictFromChecks` 裁决；**不能按检查 id 整组豁免、不能匹配 details 文案**（本轮 `p0_*` 两项同时含 TC-004/005 真实失败与 TC-007 视觉缺席，就是反例）。
- `classifyFailureKind` 对混合轮（产品缺陷 + 外部 blocker）把混合原因压成单标签 `external_block`（`goal-failure-classifier.ts:654`，聚合策略的真实结果）：本轮只影响事件标签与报告处置文案，路由由候选分支决定；不改。
- 宿主侧 claude CLI 登录、codex CLI 退出挂起：宿主环境事实，不在框架内处理。
- 不动冷却、预算、候选路由、check-disposition 基线、INCIDENT_REGISTRY。

## 7. Review 记录

### 7.1 codex 首轮（2026-10-08）：1 条必须修复，已采纳

- 必须修复（④）：同 run 改附着时不得删除 `--force-resume`（explicitTakeover 在改写后读取；orphaned_session 只靠显式接管）→ §3.3 改为只删 `--resume`，补"未启动 run + 过期 owner + 显式接管"回归。
- 非阻断（均采纳）：detach 父进程在 5047 行已返回，由子进程改写、父进程透传原参并以 run_start 握手（§3.3 改述，plan 原文"父子同一处改写"不准确）；E 的定性修正为"派生 / 聚合检查贡献普通 BLOCKER 破坏唯一外部条件"，顺延并记下最小做法（§6）；取证数字修正：完成后 kill 12/13、coding-i21 为模型容量 + 断流的终态失败、重试 3 次全在 coding、review 是回退、墙钟 3 h 10 m 24 s 含停机间隔 5 m 52 s、summary 8 个 blocker 不含 `testing_run_status`、第二次 resume 是过了 5 分钟冷却而非"终局原因非冷却类"（§1.2、§1.3、§5）；A/B 计一组事故，D 不宣称成功率，混合轮单标签称"压缩"不称"虚假"（§2、§5、§6）。
- 已核实：§3.1 收窄安全（仓内确有 FAIL+externalBlocked producer，但无路径依赖 assess 改判 deferred；goal-progress / supervisor 读事件折叠的 disposition，不读该字段）；§3.2 只改 driver（assess 单填 runner_action 无效）；§3.3 对 be091c 的 plain 决策确为 rejoin/started=false，canary 停机是 WAITING/external 非结构终局；§3.4 消费已归一的 completion_observed 不会洗白自然非零退出。

### 7.2 codex 第二轮（2026-10-08）：通过

首轮 1 条必须修复与 4 条建议均确认落入 plan，无新增意见、无撤回；plan 正文 §1–§7 自此冻结，实施只改 frontmatter 的 todo status 与 §8。

## 8. 实施记录

### 批一（t1–t4）— 2026-10-08

#### t1（已完成）

- `harness/scripts/utils/assess.ts:326-333` `isDeferredSummary` 收窄为 `verdict === 'INCOMPLETE' || completion_status === 'deferred'`，删除 blockers 扫描并注释理由；`hasInputBlockedCapability` 未动。
- `harness/scripts/utils/goal-assess-driver.ts:72-73` `resolve_deferred` 分支：`defer_external_*` 透传不变；否则 `targetRelation === 'later'` → `advance`，其余仍 `halt`。
- 测试（放进既有 `harness/tests/unit/goal-assess-driver.unit.test.ts`，未新开文件）：
  - `b7d2e9f4 be091c: testing FAIL + externalBlocked blocker is failed (not deferred) and the chain advances after ut PASS`：临时 feature 目录写六阶段 summary（testing FAIL + `visual_diff` externalBlocked/capability_missing blocker + 两条 coding `repair_candidates`，closure open），经 `observeFeatureState` → `assessObservation`（reconcile 当前 ut PASS、active、invalidatable coding/review/ut）→ `selectRunnerActionFromAssess`，断言 testing `deferred=false`、gap `failed`、`rerun_phase testing`、action `advance`（不是 halt，故不会进入 `resolveAssessHaltIncident`）。偏离说明：上游 PASS 阶段的 `closure` 在送入 assess 前直接置 `closed`——闭环提交与 evidence 新鲜度不是本例对象，按盘面写全会让 assess 先报 spec/plan 的 unclosed gap；放弃的准确性：本例不验证上游闭环从盘面读出（既有 assess 套件已覆盖）。
  - `b7d2e9f4 downstream INCOMPLETE deferred phase: resolve_deferred review maps to advance, not halt`：其余阶段 PASS 已闭环，review INCOMPLETE/deferred，当前 coding PASS → `resolve_deferred review` + driver `advance`。
  - 上游 INCOMPLETE 延迟既有例（goal-assess-driver `assess preserves DEFERRED propagation action…`、assess `P2-T5 external defer wins…`、`FAIL and DEFERRED remain distinct`、blocked-capability-projection t2 三例）不变并通过。
- 反向变异（做完 `cp` 还原，sha256 与变异前一致：assess.ts `fab3c829…62dc`、goal-assess-driver.ts `e6451fe5…94ff`）：
  - 把 `isDeferredSummary` 恢复 blockers 扫描 → `be091c` 例变红（11/12）。
  - 去掉 driver 的 `later → advance` → `downstream INCOMPLETE` 例变红（11/12）。
- 目标套件：`goal-assess-driver` 12/0；`--filter assess`（含 goal-assess-driver、assess、feature-assessment）55/0；`blocked-capability-projection` 22/0；`phase-transition-policy` 14/0；`goal-runner-policy` 26/0。

#### t2（已完成）

- `harness/scripts/goal-phase-runtime.ts:5179-5189`（行号为 t3 改动后）：`resumeTurnsIntoSuccessor` 段之后、`explicitContinuation` 之前加改写——`argv.resume` 且 `plainContinuation` 为 `rejoin`、`started === false`、`runId` 与 `--resume` 目标相同 → 打印 `--resume <id> 改为附着（该 run 尚未正式开始；同一恢复判断）`，`delete argv.resume`，`attachCreatedRunId = argv['attach-created'] = runId`；`--force-resume` 保留。互斥检查（`--attach-created 与 --resume 互斥`，约 5031 行）在改写之前且只看原始参数，不会误触；detach 父进程（5047 行返回）、attended 入口未改。
- `harness/scripts/goal-phase-runtime.ts:6589-6599`：缺 authoritative `run_start` 的拒绝文案按 events 是否含 `run_created` 区分"只有出生事件、未正式开始：普通方式重新发起或 `--attach-created <id>`"与"文件被替换 / 清空：人工核查"。拒绝本身与 missing / 损坏 / 空文件三条拒绝不变。
- 测试（放进既有 `harness/tests/unit/goal-runner-testing-integrity.unit.test.ts`：该套件已有 A13"金丝雀启动期停机、无 run_start"夹具与前台 / detach / attended 三入口驱动，比 host-runtime-truth / birth-contract 更贴近；未新开文件）：
  - `b7d2e9f4 §3.3 foreground：显式 --resume 指向只有出生事件的 run → 改为附着同一 run 并正式开始…` PASS：日志含"改为附着"、不新建 run、写出 `run_start`、执行 spec。
  - `b7d2e9f4 §3.3 detach：…` PASS：同上，另断言子进程 argv 仍带原始 `--resume`（父进程透传、子进程改写），父进程 launcher JSON `startup.state ∈ {ready, terminal}`。
  - `b7d2e9f4 §3.3 orphaned_session：…` PASS：以生产 `casAcquireRunOwner` 写下 1 ms 租约的 session owner；不带 `--force-resume` → `run-control owner busy`、无 `run_start`、owner 已标 `orphaned_session`；带 `--force-resume` → 改附着后显式接管、写出 `run_start` 并执行。
  - 既有用例改动：`goal-product-preflight` 的"返修 2(a)"原先先断言"`--resume` 对无 run_start 的 run 被拒"——该行为按本 plan 翻转为附着，删去这段负向断言（用例名同步去掉"--resume 被拒"），其余"确认后重新发起同一请求"断言不变；正向断言由上面三例承担。放弃的准确性：该夹具（product_selection_unresolved 启动期停机）不再单独验证 `--resume` 路径，同形覆盖改由金丝雀夹具承担。
- 反向变异（在 t3 改动之前做，`cp` 还原，sha256 `2d15e1b4…bc61` 与变异前一致）：①改写块里加 `delete argv['force-resume']` → orphaned_session 例变红（0/1）；②改写条件恒假 → 三例全红（0/3），detach 父进程 JSON 复现宿主的 `startup.state=alive_timeout`。
- 回归：`goal-run-birth-contract` 36/0、`host-runtime-truth` 25/0、`goal-phase-runtime` 22/0、`goal-product-preflight` 3/0、`goal-runner-detach` 14/0、`host-replay-fixes` 36/0（含 events 缺失 / 损坏 / 空 fail-closed 用例）、`goal-run-control` 8/0；`goal-runner-testing-integrity` 以 `TESTING_INTEGRITY_ONLY` 选跑已开始 run 的 `--resume` 冷却（`a2f7c9e4 §3.3` 两例）、接回（`a2f7c9e4 授权预算一次生效` 三入口）、attended 附着（`P3 t5 A12/A14 attended`，有人在场入口对未开始 run 一律 `--attach-created`）与 `P3 t5 A13` 五例，11/0。起后继例（`design-authority-repair` S15-wake，release-only）未在本批单跑，留给调度方收口全量。

#### t3（已完成）

- `harness/scripts/utils/goal-report-generator.ts:210-211`：`AttemptAxisEventLike` 加可选 `completion_observed`；`:231-233` termination = `timed_out ? 'timeout' : exit_code === 0 ? 'exit0' : completion_observed ? 'completed（cleanup，exit=N）' : 'error'`；timeouts / contentFails / passBlocked 计数口径不变。
- `harness/scripts/goal-phase-runtime.ts:4514-4530` `buildAgentWarn`：入参加 `completion_observed?`，只在 `completion_observed && !timed_out && !silent_killed` 时（且已排除 exit=0 正常路径）返回 undefined。唯一调用点（10574 行）传入的 `invoke` 已带 `completion_observed`，调用处无需改动。偏离说明：为在测试里直接断言，`buildAgentWarn` 改为 `export`（只加导出，无签名 / 行为面变化）。
- 测试（放进既有 `harness/tests/unit/attempt-axes-timeline.unit.test.ts`）：`axes: exit=1 + completion_observed → completed（cleanup，exit=1）且无 WARN；exit=1 无 completion → error + WARN` PASS——同时断言计数口径不变、timeout / silent_killed 即使带 completion 仍告警。套件 3/0。
- 注意：plan §4.1 的 `--filter goal-report` 不匹配任何套件 id，`run-unit` 会退化为全量加载并按用例名过滤（相当于跑全量）；本批起跑后发现即停止（已确认无残留进程），改为按引用 `goal-report-generator` 的套件 id 跑：`goal-runner-phase`、`goal-runner-policy`、`repair-continuity`、`adjudication`（结果见收口）。

#### t4（已完成，收口验证见下）

- `MIGRATION.md:5-13`：新增"3.1.0：延迟只认阶段结论、显式恢复未启动 run 改附着、报告终止轴（plan b7d2e9f4）"节，三条（延迟定义收窄 + 未到达阶段前进；显式 `--resume` 对未启动 run 改附着、`--force-resume` 保留、拒绝文案区分；报告终止轴 completed 标签与 WARN 抑制范围）。
- `docs/operations/goal-mode-runbook.md:109`：把"这种 run 显式 `--resume` 会被拒"改为"对这种 run 显式 `--resume` 等同附着（同一恢复判断，`--force-resume` 照常保留）"。
- OpenSpec change `openspec/changes/deferred-is-phase-conclusion-and-explicit-resume-attaches/`：`proposal.md`、`tasks.md`、`.openspec.yaml`；`specs/goal-runner/spec.md` ADDED 三条（阶段延迟只认自身结论、未到达的延迟阶段前进、显式恢复未启动 run 改附着）+ MODIFIED "Attempt reporting uses four orthogonal axes"。偏离说明：另加 `specs/harness-gates/spec.md` MODIFIED "Blocked capabilities project deterministically…"——该需求原文"explicit external/device/deferred blockers SHALL keep deferred"与 §3.1 冲突，须同步限定为 INCOMPLETE 摘要（另补一条 FAIL 不延迟的场景）；显式恢复用 ADDED 而非 MODIFIED "Re-issuing the same request…"，因后者正被未归档的 `effective-budget-completion-and-repair-diagnosis` 改写，避免两个 change 争同一条原文。
- `scripts/reliability/observations/b7d2e9f4-host-start0928-5acd53e2.json`：照 a2f7c9e4 记录结构写第四轮（数字取 §1.2 / §5，事件序号未逐条核对、`related_events` 留空并在 `source` 说明）；`scripts/reliability/README.md:90-91` 登记一段。

#### 收口验证（本批，全部日志先落文件再取结论）

- `cd harness && npm run typecheck`：EXIT 0（t3 改动后最后一次）。
- t3 相关套件：`attempt-axes-timeline` 3/0、`codex-terminal-closure` 52/0、`check-disposition` 30/0、`adjudication`（按 id 子串匹配）60/0、`goal-runner-phase` 37/0、`goal-runner-policy` 26/0、`repair-continuity` 14/0。t1、t2 套件结果见上两节（t2 回归在 t3 改动前跑；t3 只动 `buildAgentWarn` 与报告时间线，未重跑 t2 套件）。
- `npm run openspec:validate`：56 passed / 0 failed（含本 change）。
- `node scripts/check-plan-version.mjs`：PASS（mode=default，current=3.1.0）。
- `git diff --check`：干净；node 扫描 18 个改动 / 新增文件 CRLF 0，新增文件行尾空白 0，观察记录 JSON 可解析。
- 未做（交调度方，返修 r1 后仍然）：全量 `cd harness && npm test` 与 release-only 链路（design-authority-repair 含"显式 --resume 改起后继"S15-wake、real-chain、lifecycle-evolution、reliability-scenarios）；宿主验收 H1 待用户批准。

### 返修 r1（codex 实现 review）— 2026-10-08

- 必须修复（④）：改附着后丢失仅由 `--manifest` 提供的 feature。`--resume <run> --manifest <该 run 的 manifest.json>` 不带 `--feature` 时，附着分支用 `String(argv.feature)` 得到 `"undefined"`，加载错误路径、写不出 `run_start`（前台与 detach 子进程都受影响；plain 重发 → 附着同一潜在问题）。
  - 修复：`harness/scripts/goal-phase-runtime.ts:5238-5241` 附着分支改用 `rawRunInput.feature`（5229 行已由 `resolveRawRunInput` 解析，与 resume 分支同源）。不改接续决策、不加机制。
  - 夹具：`goal-runner-testing-integrity` 的 `runGoalRuntimeChain` 加可选 `resumeOmitFeature`（resume 时不补 `--feature`），默认行为不变。
  - 新用例（扩展既有 §3.3 前台 / detach 循环）：`b7d2e9f4 §3.3 foreground（仅 --manifest 提供 feature）：…`、`b7d2e9f4 §3.3 detach（仅 --manifest 提供 feature）：…`，均 PASS——同 run 写出 `run_start`、执行 spec，detach 父进程 `startup.state ∈ {ready, terminal}`。
  - 反向变异：附着分支改回 `String(argv.feature)` → 两新例变红（0/2；detach 父进程 `startup.state=alive_timeout`）；`cp` 还原，sha256 `34708a2a…5788` 与变异前一致。
- 非阻断建议（只改文字）：change 的 `specs/goal-runner/spec.md` 把"FAIL 是 failed gap"限定为"未显式设置 `completion_status=deferred` 的 FAIL"；`specs/harness-gates/spec.md` 对应一句与 FAIL 场景的 WHEN 同步加同一限定。

### 评审与收口（调度方）— 2026-10-08

- codex 实现 review r1：1 条必须修复（④：改附着分支取 String(argv.feature)，--resume --manifest 不带 --feature 时丢 feature、写不出 run_start）→ 返修 r1 改用 rawRunInput.feature 并补仅 manifest 的前台 / detach 两例；1 条文字建议（goal-runner / harness-gates delta 的 FAIL 规则限定为未显式 completion_status=deferred）已落实。
- codex 实现 review r2：通过，无遗留；验证边界：detach 回归经 spawn 测试缝在进程内调用子入口（覆盖参数传递、附着与握手逻辑），不是真实 OS 子进程。
- 全量收口：隔离工作树 D:/1.code/am-c3（5acd53e2 + 本批 + 返修 r1，与主工作区 tracked diff 逐字节一致）跑 closure11；结果见下一条记录。
- closure11 结果（am-c3，最终代码）：typecheck EXIT 0；unit 5174/0；fixtures 46/0；design-authority-repair 38/0；real-chain 14/0；lifecycle-evolution 14/0；reliability-scenarios 44/0。全绿；未提交，待用户批准；宿主验收 H1 待用户批准后执行。
