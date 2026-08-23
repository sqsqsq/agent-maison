---
name: resume 验证优先 — 停等后先重验、不再无条件重调 agent
version: 3.0.0
todos:
  - id: t1-resume-revalidate-before-reinvoke
    content: resume 验证优先——具有 `WAITING` 投影的停等后 `--resume` 先重验现有产物，不再无条件重调 agent。①问题：`resolveResumeState`（goal-runner-phase.ts:902）在 `last.halted` 时把 startIndex 退回该 phase 并丢弃其 outcome，主循环随即重新 `agent_invoke_start`；而"跳过 invoke、直接走验证边界"的机器**已存在**（`resumePostAgentPhases`，goal-runner.ts:4725 装载 / :5127 消费，`retries===0` 且消费即删），只是仅由 `applyInvalidationsToResume` 从 backtrack/invalidated 事件派生（:2556 `postAgentPhases.add`），普通 `phase_halt` 不覆盖。②**资格判据 = 既有投影 + 事件形状**：最新 `phase_halt.run_disposition === 'WAITING'` ∧ 该 phase 最新执行事件是有效 `agent_process_settled`（带 `invoke_id`，非 `timed_out`/`kill_reason=agent_timeout`）∧ 同一 invoke 之后已有 `harness_end` ∧ halt 位于该 harness 之后 ∧ 其后无更新的 `agent_invoke_start`/`agent_process_settled`/`phase_verdict`。判据只消费既有 `run_disposition` 投影（仓库明令下游只读它、不得按 halt_reason 重新分类）与事件形状事实（"agent 工作做到哪一步"），不是第二张分类表；**禁止用 `INCIDENT_REGISTRY.class` 作判据**——class 表达责任归属而非"agent 是否已完成"，且 operator 类含 8 条 `structurally_terminal`，按 class 切分会把结构终态纳入重验资格。③**本 change 的边界（严格限定）**：只决定"是否派生 validation-only 资格"，**不修改 TERMINAL/manual resume 契约**——`TERMINAL`/`RECOVERY_PENDING` 投影仅断言"不派生 validation-only"，其原有终态语义与恢复行为（含 `checkTerminalResumeGuard` 允许的 `--force-resume` 人工选择）完全不变；缺投影或事件窗口不完整同样只是"不派生资格"，保持现有 resume 行为原样。④行为：取得资格则 resume 直接进 gate harness → PASS 走既有唯一 closure owner 收工；gate FAIL 或仍 pending → 落回既有路径（调 agent 重试 / 原样再停等）。**零新事件、零新状态、零新账本**，复用既有 `resumePostAgentPhases` 机器。⑤反例矩阵（逐条须有回归，一律只断言"不进入 `resumePostAgentPhases`"、不规定其后是否重新 invoke agent）：settled 之后出现 FAIL `phase_verdict`、出现更新的 `agent_invoke_start`、settled 带 timeout/kill、settled 缺 `invoke_id`、halt 缺 `run_disposition` 投影、halt 投影为 `TERMINAL`/`RECOVERY_PENDING`。
    status: completed
  - id: t2-1c95e3-sequence-regression
    content: 1c95e3 事件序列回归（一条，聚焦）——用既有注入式 goal-runner 集成框架断言完整 resume 控制流：`settled → harness_end → phase_halt(WAITING) → run_end` → `--resume` → **无新 `agent_invoke_start`** → 复用原 invoke identity → **恰好一次 gate harness** → PASS 收工或原样快速再停等。落点 `goal-runner-testing-integrity`（或 `goal-host-replay-fixes`）既有 suite，**不需要真机、不新增 golden 产物、不扩 `golden-bc-opencard`**（后者负责产品事故产物/保真决策回放，不是通用 resume 状态机）。**不重复既有覆盖**：`《添加银行卡` 精确包含与 structured payload 真实落盘已在 `adjudicated-repair-loop`；pending 时 summary/next 不关环已在 `M2-1`；人签正反例已在 `M2-3b`/`M2-3c`；M1 one-shot 与 no-op 已在 `R-8`——一律不再新增。
    status: completed
  - id: t3-delta-and-closure
    content: OpenSpec delta 与收口——①t1 改变 resume 行为语义，须补 `specs/goal-runner/spec.md` delta（ADDED「WAITING-projected halts revalidate before re-invoking the agent」或 MODIFIED 既有 resume requirement）：SHALL 消费 `run_disposition` 投影与事件形状、SHALL NOT 按 halt_reason/incident class 重新分类、**本 change SHALL NOT 为非 `WAITING` 投影派生 validation-only eligibility**（既有终态与人工 resume 契约不在本 change 变更范围）；strict validate 过门。t2 属测试资产，不产 delta。②既有契约不回归断言：`resolveResumeState` 的前缀规则与 `WAITING(external)` 重新入队语义（e5d8a2c4 / codex 第九批 P0 订正）不得破坏；`checkTerminalResumeGuard` 的 cooldown/`--force-resume` 语义不得改动；goal-runner 禁直调 `classifyPhaseVerdict`；`phase_verdict` 仅 boundary 发；halt_reason 全注册；supervisor 只读 `run_disposition`；gate 模式下 harness-runner 不自行关环（d6afee4）。③验证节奏：窄返修=目标测试；收口=typecheck + `cd harness && npm test` + `openspec validate --strict`；`release:verify` 只留正式发版门禁。
    status: completed
overview: >
  08-22/08-23 宿主 run 1c95e3（候选包 ee13bbf = 6c5b100 + d6afee4 closure 修复 + OCR 聚合行修复）
  两段合计 2h58m，agent 占 96.6%（review 31m/gate 5s、ut 28m/gate 49s、testing-i3 62m/gate 2m47s、
  resume testing-i4 51m/gate 2m41s）。其中 resume 的 51 分钟是**纯废**：它通过既不是 agent 干了
  什么，也**未发生 visual-confirm 人签**（三屏 confirmed_by 全 undefined），而是框架换包后那 3 条
  假 uncertain 信号在 producer 侧不再产生；i3 留下的产物本就三屏 pass / must_fix 0，本次在新框架
  上**实际重验即 PASS**（gate harness 实测 2m41s）。agent 那 51 分钟做了 4 轮真机、2 次 verifier、
  重写 test-report，重新推导出同一结论。根因：resolveResumeState 在 halted 时把 phase 退回并丢弃
  outcome，主循环无条件重调 agent；而"跳过 invoke 直接走验证边界"的机器（resumePostAgentPhases）
  已存在，只覆盖 backtrack 崩溃窗口。本 change 只做两件：t1 resume 验证优先（资格判据=既有
  run_disposition 投影 + 事件形状，**不用 incident class**；且严格限定为"是否派生 validation-only
  资格"，不修改 TERMINAL/manual resume 契约）、t2 一条聚焦的 1c95e3 事件序列回归（不扩 golden、
  不需真机、不重复既有覆盖）。归因经本侧独立核验 + codex 三轮复盘交叉一致；预期 t1 省约 48 分钟
  （约 27%），review/ut 的 59 分钟、goal 模式单一 harness owner、M3 设备 execute/validate 分离
  各自另立，不叠进本 change。
isProject: false
---

# resume 验证优先：停等后先重验、不再无条件重调 agent（b5f1d9c3）

状态：**已终审（v3），已实施**（t1/t2/t3 完成；两轮 review 意见已吸收：P1 反例矩阵只断言"不进入 resumePostAgentPhases"、边界严格限定为"是否派生 validation-only 资格"；二轮 review P1 补 halt 后更新的 backtrack/invalidation 窗口优先、t2 改无人签真实事故回归）

## 背景与根因链（08-22/08-23 · run 1c95e3）

```
08/22 14:37:41  run_start（chain=review,ut,testing）
       14:37→15:08  review-i1   agent 31m  → gate 5s   → PASS
       15:08→15:36  ut-i2       agent 28m  → gate 49s  → PASS
       15:37→16:39  testing-i3  agent 62m  → gate 2m47s
       16:42:12     phase_halt repair_adjudication_pending（3 条假 uncertain）→ WAITING/human
08/23 07:48:12  resume（start_index=2, start_phase=testing）
       07:48:24     agent_invoke_start testing-i4     ← 无条件重调，问题所在
       07:48→08:39  agent 51m：4 轮真机（886/959/569/318）+ 2 次 verifier + 重写 test-report
       08:39→08:42  runner gate harness 2m41s（自身又重建、重装、跑第 5 轮真机 052）
       08:42:38     testing PASS → run_end AWAITING_HUMAN_REVIEW
```

resume 通过的真实原因：**框架变了**，不是 agent、也不是人。核验依据：三屏 `confirmed_by` 全 undefined（未发生 visual-confirm 人签）；i3 产物三屏 pass / must_fix 0。若 resume 直接走验证边界，gate harness 一轮（2m41s）即 PASS 收工。

## 事实核实表（本侧独立取证 + codex 三轮复盘，逐条 ground truth）

| # | 断言（来源） | 核实 | 证据 |
|---|------|------|------|
| 1 | resume 对 halted phase 无条件重调 agent | ✅ | `resolveResumeState`（goal-runner-phase.ts:902）：`last.halted` → `startIndex=chain.indexOf(last.phase)` + `priorOutcomes.slice(0,-1)`；主循环随即 invoke |
| 2 | 验证边界机器已存在，但只覆盖 backtrack 窗口 | ✅ | `resumePostAgentPhases` goal-runner.ts:4725 装载 / :5127 消费（`retries===0` 且消费即删）；来源仅 `applyInvalidationsToResume` :2556（backtrack/invalidated 事件） |
| 3 | 本次 resume 未发生 visual-confirm 人签 | ✅ | visual-diff.json 三屏 `confirmed_by=undefined` |
| 4 | i3 产物已 PASS，本次在新框架上实际重验即 PASS | ✅ | visual-diff.json 三屏 verdict=pass、must_fix=0；resume 后 gate 2m41s 即 PASS |
| 5 | resume 期间新增 5 个真机执行轮 | ✅ | testing/reports 下 886/959/569/318（agent 侧 4 轮）+ 052（runner gate 1 轮）；.hypium-workdir 新增 10 个执行目录 |
| 6 | gate harness 自身会重建/重装/跑真机 | ✅ | 08:39:58 device-test-build → 08:40:00 hdc-app-install → 08:40:02 hylyre-ready → 052 轮；故"只重验"≈3 分钟且仍碰设备（execute/validate 分离属 M3） |
| 7 | agent 时间占比 96.6%，确定性门禁极快 | ✅ | agent 172m vs gate 合计约 6m22s |
| 8 | review/ut 的耗时本 change 碰不到 | ✅ | review 31m（零真机、gate 5s）、ut 28m（gate 49s）合计 59m=33% agent 时间；驱动是交付物体量（review-report 69KB / test-report 75KB / ut verifier 39KB） |
| 9 | 人工恢复当前实现读取的是：`visual-diff.json` 屏条目 `confirmed_by` + `isHumanVerified` 谓词 | ✅ | `humanConfirmedScreens`（goal-runner.ts:1645）函数体只读该字段，不读 ledger；ledger 不参与授权判断 |
| 10 | **`INCIDENT_REGISTRY.class` 不可用作重验资格判据** | ✅ | class 表达责任归属，非"agent 是否已完成"；operator 类中 8 条为 `structurally_terminal`（authorized_mutation_requires_full_chain / testing_write_violation / visual_ledger_integrity / content_retry_exhausted / budget_wall_clock / no_progress_fuse / closure_wall_repeated / in_session_reconcile_fused），按 class 切分既过宽（把结构终态纳入资格）又漏判（external/framework_fault 在环境或框架更新后反而最适合重验） |
| 11 | v1 提议的 t2 内容**已被既有测试覆盖**，属重复扩面 | ✅ | `《添加银行卡` 与 structured payload 落盘 → `adjudicated-repair-loop`；pending 时 summary/next 不关环 → `M2-1`（:2546）；人签正反例 → `M2-3b`（:2681）/`M2-3c`（:2714）；M1 one-shot 与 no-op → `R-8`（:1391） |
| 12 | `structurally_terminal` 只约束"是否存在可接受的未来输入使本 run 继续"，不禁止人工 resume | ✅ | adjudication.ts `IncidentSpec.structurally_terminal` 注释明写"判据不是「有没有人工动作」"；`checkTerminalResumeGuard`（goal-runner-phase.ts:668）对 HALTED/DEFERRED 在 cooldown 后经 `--force-resume` 或 `blockingCleared` 放行——故本 change **不得**把"结构终态不可复活"写成新契约 |
| 13 | agent 自跑 harness 与 runner gate 是平行执行面 | ✅ | device-testing/SKILL.md Step 4.5 要求 agent 触发 `harness-runner --phase testing`；runner 随后必跑正式 gate（本次 i4 期间 agent 4 轮 + runner 1 轮）——**另立，不在本 change** |

## v2→v3 的裁决变化（吸收 review 2 P1 + 2 条文字清理）

1. **边界严格限定，不重定义 TERMINAL/manual resume 契约**（P1-1）：v2 把六条反例写成"不得跳过 agent"、delta 写成"结构终态不得复活"，等于把本 change 从"决定是否进入 validation-only"扩大为"修改终态与人工 resume 契约"——而 `structurally_terminal` 只约束自动恢复，`checkTerminalResumeGuard` 明确允许 `--force-resume` 作为人的选择（事实 #12）。v3：反例矩阵一律只断言"不进入 `resumePostAgentPhases`"，不规定其后是否重新 invoke agent；缺投影/窗口不完整同样只是"不派生资格"，保持现有 resume 行为；delta 措辞改为"本 change SHALL NOT 为非 `WAITING` 投影派生 validation-only eligibility"。
2. **删除「已知缺口」整节**（P1-2）：该节把当前单证模型描述为"squash 时未经复审的回退"并另立"全框架 visual-confirm 权威模型"——既不属本次提速范围，历史归因亦不准确（单一 `confirmed_by + isHumanVerified` 是此前认定 receipt/双证过度复杂后明确裁回、并继续经过 review 的结果）。v3：整节删除；事实 #9 只陈述"当前实现读取什么"，不作安全性评价；「明确另立」第 ⑥ 项删除。将来若出现 agent 实际伪签的事故证据，再按新证据独立立项，本 plan 不预埋。
3. **文字清理**：t1 开头"`operator` 类停等"改为"具有 `WAITING` 投影的停等"（与正文判据一致）；删除 golden 行数的一切引用（t2 已不动它）；文件名去掉"golden回放"，与裁剪后范围一致。

## v1→v2 的裁决变化（存档）

资格判据从 `INCIDENT_REGISTRY.class === 'operator'` 改判为"既有 `run_disposition` 投影 + 事件形状"（class 语义误用，且会把 8 条结构终态纳入资格，其中 `closure_wall_repeated` 属另立的 M4 范围）；t2 从"golden 扩容含人签双证释放/M1 one-shot/no-op"裁成一条聚焦的 1c95e3 事件序列回归（既有测试已覆盖，属重复扩面；且"人签双证"是回潮已撤销的契约）。

## 交叠与依赖

- **不并入 M4（closure/预算小 change）**：M4 三项（receipt runner-owned 机械化、`closure_wall_repeated` 恢复、预算派生显式化）与本 change 无数据依赖。
- **既有契约保留**：`resolveResumeState` 的前缀规则与 `WAITING(external)` 重新入队语义不得破坏；`checkTerminalResumeGuard` 语义不动；只许一张分类表（adjudication SSOT，下游只读 `run_disposition`）；gate 模式下 harness-runner 不自行关环（d6afee4）。
- **明确另立、不叠进本 change**：①goal 模式单一 harness owner（收益大，但须先补"结构化失败回喂 agent"，否则 gate FAIL 率上升反而更慢，待 t1 实测收益后单排）；②review/ut 交付物体量（59m/33%，属阶段交付物 altitude）；③M3 设备 execute/validate 分离与增量修复环；④review 阶段越权改产品源码的 write guard 提前（1c95e3 第二次复现）；⑤TC-018 口径。
- **宿主侧当下处置**：run 1c95e3 已 `AWAITING_HUMAN_REVIEW`（宿主产品验收态，对 Maison 回归无意义），**不再续跑**；后续 Maison 迭代默认走注入式集成测试，真机只保留最后一次端到端抽查且不要求完成人工视觉验收。

## 提交与集成顺序

沿用既有约束（Br_release_3.0.0 上做完全部调整与测试再统一 cherry-pick 主干）：

```
Br_release_3.0.0
  … ee13bbf（已在链上）
  → OpenSpec delta（resume 行为语义）
  → t1 resume 验证优先
  → t2 1c95e3 事件序列回归
  → t3 收口 + OpenSpec 归档
```

每里程碑独立可 `cherry-pick -x`；不跨里程碑混改。

## 已定裁决（v3；除非用户反对，按此执行）

1. **资格判据 = 既有 `run_disposition` 投影 + 事件形状**，禁止用 incident class 或任何对 halt_reason 的再分类。
2. **边界严格限定**：本 change 只决定"是否派生 validation-only 资格"；非 `WAITING` 投影、缺投影、窗口不完整一律只是"不派生资格"，既有终态语义与人工 `--resume` 契约原样不动。
3. **验证优先是 fail-safe**：gate 是唯一裁决者，PASS 即收工、FAIL 即落回既有路径调 agent；"什么都没变"退化为约 3 分钟快速停等，严格优于现状。
4. **零新机制**：不新增事件类型、状态机、账本、receipt；复用 `resumePostAgentPhases`。
5. **不重复既有覆盖**：t2 只加一条聚焦事件序列回归；`golden-bc-opencard` 保持其产品事故回放定位不被稀释。
6. **收益预期摆正**：t1 省约 48 分钟（约 27%）；不得宣称把 3 小时压到 20 分钟——review/ut 的 59 分钟与 goal 模式单一 owner 各自另立解决。

## 实施记录（2026-08-24）

- t1：新增纯函数 `deriveHaltValidationOnlyEligibility`（goal-runner.ts，与 applyInvalidationsToResume
  同文件）——判据 = 最新 phase_halt.run_disposition==='WAITING' ∧ 该 phase 最新执行事件是有效
  settled（带 invoke_id、非 timed_out/kill）∧ 同 invoke 后、halt 前已有 harness_end ∧ settled 后
  无更新执行事件 ∧ **halt 后无更新的 phase_backtrack_requested/phase_invalidated（新窗口优先，
  资格交回既有 invalidation 回放）**；resume 装载点并入 resumePostAgentPhases +
  resumePostAgentAttemptIds（复用原 settled invoke 身份）。零新事件/状态/账本；
  checkTerminalResumeGuard 与人工 resume 契约未动。
- t2：集成回归（goal-runner-testing-integrity）——首 run uncertain 停等 → **无人签**（1c95e3
  真实事实）+ 插入同 invoke settled（测试宿主非 win32 模拟）→ resume（cooldown 回拨 +
  --force-resume 显式确认，与 R-8 同手法）→ 第二次 gate clean（producer 不再产 uncertain）→
  无新 testing agent_invoke_start、gate harness 恰好一次且复用原 invoke_id、无人签 PASS 收工。
- t3：OpenSpec delta（resume-revalidate-before-reinvoke change，specs/goal-runner ADDED）；
  tasks/proposal/design 成文。
- 验证：typecheck 0；goal-runner-repair-convergence 23/23；goal-runner-testing-integrity 52/52；
  （全量 + strict validate 记录于收口处）
