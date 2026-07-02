---
name: goal-mode 超时预算 + API 断流 全盘根治 — spec 预算畸紧 + 超时误分类 + 超时丢弃将成阶段 + headless API 断流误分类
version: 2.4.0
overview: >
  宿主 bc-openCard（goal-mode，07-01）两类失败一并根治：(1) chrys 跑 spec verifier 反复 15 分钟超时循环——
  非 chrys 硬顶，而是 maison 自己在 spec 默认 900s 预算处 tree-kill；(2) claude 跑 spec 时 headless `claude -p`
  API 连接中途断开（"Connection closed mid-response"）致 spec.md 写不出，attempt1 竟 exit 0，被误分类成
  deterministic_gate → no_progress_guard halt，真因被吞、下游 AI 臆造"缺 API key"。四层跨阶段根因
  （预算地板 / 超时误分类 / 超时丢弃 / API 断流误分类）共用同一套 FailureKind+verdict 管线，一并根治。待 review 后动手。
todos:
  - id: diagnosis
    content: goal-mode 超时全盘诊断（spec 现场 + 全阶段影响矩阵，已 ground-truth 核实）
    status: completed
  - id: p0-a-budget-floor
    content: P0-A per-phase 预算按 goal 闭环成本(verifier子agent+receipt)重定 + MIN 地板常量(仅兜底默认表/豁免显式override) + adapter 悬空 timeout 收口
    status: completed
  - id: p0-b-timeout-failurekind
    content: P0-B 超时升为一等 FailureKind + 诚实归因 + agent_timeout 专用 signature(修空 signature 逃逸) + 有进展脱离内容重试预算(与 D 对称)
    status: completed
  - id: p0-c-timeout-unclosed
    content: P0-C 超时但闭环实已完成时放行 advance；超时有进展与零进展分流（不再无谓烧满重试预算）
    status: completed
  - id: p0-d-transient-api-error
    content: P0-D headless API 断流升为一等 FailureKind(transient_api_error)——扫 agent-output.log 断流哨兵(不靠 exit code) + backoff 重试 + 诚实归因(堵下游"缺 API key"臆造) + 有进展 resume
    status: completed
  - id: tests
    content: goal-headless-sentinel / goal-failure-classifier / goal-runner-phase 单测 + 全阶段预算地板回归 + API 断流分类/backoff/耗尽 halt
    status: completed
---

# goal-mode 超时预算 + API 断流 全盘根治 — spec 预算畸紧 + 超时误分类 + 超时丢弃 + headless API 断流误分类

> 来源：宿主 bc-openCard（goal-mode，2026-07-01 反馈），**两类失败**：
> - **超时类（chrys adapter）**：现场 `D:\97.log\问题反馈\07-01\maison-goal-diag-20260701-172646.zip`。spec verifier 反复 ~15 分钟超时 → pass→retry→timeout→循环；同事判断为"chrys 单次调用 15 分钟上限"并手动跳阶段。**诊断结论：非 chrys 限制，是 maison 自己在 spec 默认 900s 预算处 tree-kill。**
> - **API 断流类（claude adapter）**：现场 `doc/features/bc-openCard/goal-runs/20260701T085057Z/`。headless `claude -p` 跑 spec 到写 `spec.md` 那步时 API 连接中途断开，`agent-output.log` 仅 81 字节 = `API Error: Connection closed mid-response`。**attempt1 竟 exit 0** → 被误分类 deterministic_gate(spec_file_exists) → attempt2 同 signature → `no_progress_guard` halt。真因被吞，下游 AI 拿不到信号、臆造"缺 API key / env 丢失 / 0字节"（[[verify-review-claims-maison]]：全被 ground-truth 证伪——env 继承正常、dontAsk 有效可写盘、cross-spawn 在位、claude 实跑 38s/12m）。
> 范围：用户要求**全盘**——四层跨阶段根因 A/B/C/D 全部 ground-truth 核实。B（超时）与 D（API 断流）**同属"agent 级基建失败被误分类"**，共用 FailureKind+verdict 管线，一并治。
> 状态：诊断完成、证据已核实；**待用户 review 后再动手**。

---

## 0. 现场链路（ground truth，来自 events.jsonl）

spec 阶段 5 次 agent 调用（`agent_invoke_end.duration_ms` / `timed_out`）：

| attempt | 时长 | timed_out | kill_attempted | phase_verdict |
|---|---|---|---|---|
| 1 | **901s** | ✅ | ✅ | retry FAIL |
| 2 | **901s** | ✅ | ✅ | retry FAIL |
| 3 | **901s** | ✅ | ✅ | **halt** `agent_timeout_unclosed` |
| 4（run2 resume） | **901s** | ✅ | ✅ | retry PASS |
| 5（run2 resume） | **611s** | ❌ 自然结束 | ❌ | **advance** ✅ |

对照：紧接的 **plan 阶段跑 3364s（56m）、未超时、一次过**（budget 5400s/90m）。

**决定性判据**：4 次被杀全部卡在 **~901s = 900s 预算 + tree-kill 开销**，事件明写 `timed_out:true, kill_attempted:true, kill_exit_code:0`；唯一 611s 自然结束的那次直接 advance。`command:"chrys run …"`——chrys 只是被调起的执行器，**超时与杀进程是 maison 干的**（[goal-runner.ts:1267](harness/scripts/goal-runner.ts) 传 `timeoutMs=resolvePhaseTimeoutMs(spec)`；tree-kill 在 SIGTERM handler）。

**旁证（系统没全坏）**：`phases/spec/checkpoint.json` 显示 resume 累积了全部 14 文件探索（`stage:reporting, inspected_file_count:14`），blocker 逐轮递减（signature：5 项 → 2 项 → 0）。断点续跑生效、阶段最终收敛——只是每次被 900s 砍断，耗 4×15m 空砍 ≈ 1 小时才熬过 spec。manifest.unattended **无** timeout_seconds/phase_timeout_seconds → spec 走默认表 900s，无覆盖。

---

## 0.5 全阶段影响矩阵（回答"其他阶段是否有同类问题"）

| 根因 | spec | plan | coding | review | ut | testing |
|------|:----:|:----:|:------:|:------:|:--:|:-------:|
| **A** 预算 < goal 闭环成本(verifier子agent+receipt) | ❌ **已爆(900s)** | ✅ 5400 足 | ⚠️ 5400 大项目临界 | ✅ 7200 | ⚠️ **3600 偏紧(compile+hypium+verifier)** | ✅ 7200 |
| **B** 超时被折进 `code_regression` 盲重试 | ✅有 | ✅有 | ✅有 | ✅有 | ✅有 | ✅有（**代码注释已记 testing 177m 空转病灶**）|
| **C** 超时丢弃将成阶段 / 烧满重试 | ✅有 | ✅有 | ✅有 | ✅有 | ✅有 | ✅有 |
| **D** headless API 断流(exit 0/1)误分类 + 无诚实归因 | ❌ **已爆(claude spec)** | ✅有 | ✅有 | ✅有 | ✅有 | ✅有 |

**核对结论**：
- **A（预算地板）**：spec 是**已确诊**的畸紧项（900s，全阶段最紧，比 ut 还紧 4×）。**根因是"spec 轻"这个普通交互模式假设漏进了 goal 模式**——goal 模式每个 feature 阶段都要 harness + **verifier 子 agent（经 Task 工具在阶段预算内跑，见 spec/SKILL.md:381-386）** + receipt 四条件闭环，spec 一点不轻。其余阶段预算更宽，但**同一地板逻辑**：`ut=3600` 带 compile+hypium+verifier，大项目临界；`coding=5400` 真编译+verifier 大项目临界。故需按 goal 闭环成本**重定全表 + 立最小地板常量**，而非只补 spec。
- **B / C（超时下游处理）**：**phase-agnostic**，对全 6 阶段一视同仁。代码注释 [goal-failure-classifier.ts:24-25](harness/scripts/utils/goal-failure-classifier.ts) 已自记"homepage testing 3 次/177 分钟空转，两次 timeout/FAIL 全归 code_regression 盲重试"——**同类问题在 testing 早已发生**，T6 只治了 toolchain/capture/visual，**没治 timeout 本身**。修 B/C 一次覆盖所有阶段。
- **D（API 断流误分类）**：**phase-agnostic** 且**独立于超时**——任何阶段的 headless agent 只要 API 连接中途断开都会触发。与 B 的关键差别：超时有结构化信号 `invoke.timed_out`，而 **API 断流在 attempt1 是 `exit 0`、既不 timed_out 也不 silent_killed，现有分类器完全抓不到**（[classifyFailureKind:158-177](harness/scripts/utils/goal-failure-classifier.ts) 只读 summary blocker）→ 落 deterministic_gate/code_regression。**必须新增"扫 agent-output.log 断流串"这条独立检测路径**，靠 exit code 无解。此坑对所有 6 阶段成立，spec 只是本次先爆的那个。

---

## 一、根因 A — per-phase 预算未计入 goal 闭环成本（verifier 子 agent + receipt）

### 定位
[goal-timeout.ts:30-37](harness/scripts/utils/goal-timeout.ts) 默认表 + 注释"spec 轻、plan/coding 中、review/testing 重、ut 中"：
```
spec: 900/*15m*/, plan: 5400/*90m*/, coding: 5400, review: 7200, ut: 3600/*60m*/, testing: 7200
```
这套 taxonomy 来自 sibling plan `c3f08a21`（review 超时根因），按**普通模式阶段体量**估的，**没把 goal 模式的"verifier 子 agent 在阶段预算内跑 + receipt 闭环"算进去**。spec 的 verifier 子 agent（本身一次完整 agent 调用）+ 14 文件探索 + 10 章 spec.md + receipt，实测需 611–900s+，而它拿的是全表最紧的 900s、零裕量。

### 悬空旋钮（确认删除）
各 [adapter.yaml](agents/chrys/adapter.yaml) `goal_capability.external_runner.unattended.timeout_seconds: 3600`（6 个 adapter 全有）是 **2.3.0 遗留的死旋钮**，确认删除。核实链：
- goal-runner 默认 manifest 的 `unattended` 是**硬编码**（[goal-runner.ts:924-931](harness/scripts/goal-runner.ts) 只写 write_mode/approval_mode/max_turns，**不读 adapter**）；`GoalCapabilityExternal` 类型虽含 `unattended`，但**全仓无任何代码读 `external_runner.unattended.timeout_seconds`**（`headless_invoke` 命令模板也无 timeout 参数）。→ 不合并、不解析、不注入命令。
- 更关键：`timeout_seconds=3600` **正是** c3f08a21 从 2.3.0 全局 3600 迁到 per-phase 表时写的迁移目标——[goal-manifest.ts:192](harness/scripts/utils/goal-manifest.ts) `if (u.timeout_seconds === LEGACY_FLAT_TIMEOUT_SECONDS(3600) && !u.phase_timeout_seconds) delete u.timeout_seconds`。即便它漏进 manifest 也会被迁移逻辑 strip 掉。
- → "看着像单次调用 60m 上限、实际零效果"的误导旋钮，是同事误判来源之一。**删除，不保留**（无 schema/测试强制其存在；`UnattendedContract.timeout_seconds` 仍为可选，用户手写 manifest 想全局覆盖仍可用）。

### P0-A 根治
文件：[goal-timeout.ts](harness/scripts/utils/goal-timeout.ts)（+ adapter.yaml 收口）
1. **立最小地板常量** `MIN_PHASE_TIMEOUT_SECONDS`（建议 1800s/30m）——任何 feature 阶段预算不得低于"能容纳一次 verifier 子 agent + receipt 闭环"的地板。**地板只兜底"默认表派生值"，不覆盖用户任何显式 override**（§七.2 收口 codex）：[resolvePhaseTimeoutSeconds:55-68](harness/scripts/utils/goal-timeout.ts) 有**两条**显式路径——`phase_timeout_seconds[phase]`(:60) **与**扁平 `timeout_seconds`(:63)，**两者都豁免地板、尊重原值**（低于地板时 **WARN"低于建议地板，goal 闭环可能被砍断"，不静默抬升**）；地板只对末端"走默认表"的返回值 `Math.max(tableDefault, MIN)`。否则破坏显式 override 契约。
2. **按 goal 闭环成本重定默认表**（用户已拍板，§六）：
   - `spec: 900 → 2700`（45m）——verifier 子 agent 主导，主体工作轻但闭环重。
   - `ut: 3600 → 5400`（90m）——compile + hypium + verifier，与 coding 同量级。
   - plan/coding/review/testing 维持（数据/体量支持）。
3. **删除 6 个 adapter.yaml 的悬空 `timeout_seconds: 3600`**（见上"悬空旋钮"）+ 文档指向 `phase_timeout_seconds` 作为唯一 per-phase 覆盖入口。
4. wall_clock 地板随之自动上抬（[resolveWallClockMinutes](harness/scripts/utils/goal-timeout.ts) = max(configured, Σ链路per-phase + 30m buffer)），无需手改，但需回归 wall 派生单测。

---

## 二、根因 B — 超时被折进 `code_regression`，盲重试且不诚实（全阶段）

### 定位
[goal-failure-classifier.ts:15-20](harness/scripts/utils/goal-failure-classifier.ts) `FailureKind` 无 `timeout` 成员；[classifyFailureKind:158-177](harness/scripts/utils/goal-failure-classifier.ts) 仅按 **summary 里的 blocker id** 归因，**完全不看 `invoke.timed_out`**。超时 attempt 的 blocker（context_exploration_* 等）→ 落 `code_regression`（[:177](harness/scripts/utils/goal-failure-classifier.ts) 兜底）。诊断中每条 phase_verdict 的 `failure_kind_classified` 全是 `code_regression`，真实原因却是 `timed_out`。

后果：`code_regression` **不在** [SIGNATURE_HALT_KINDS:74](harness/scripts/utils/goal-failure-classifier.ts)（"永不 guard-halt、偏好重试"）→ 超时一路盲重试到 `max_retries_per_phase`。且归因不诚实，排障者看不到"是超时"。**代码注释 [:24-25](harness/scripts/utils/goal-failure-classifier.ts) 已自记 testing 同类空转病灶**。

### P0-B 根治
文件：[goal-failure-classifier.ts](harness/scripts/utils/goal-failure-classifier.ts) + [goal-runner.ts](harness/scripts/goal-runner.ts)
1. `FailureKind` 增 `agent_timeout` 成员；`classifyFailureKind` 接受 `agentTimedOut` 信号，**超时优先于 blocker 归因**（`timed_out=true` → `agent_timeout`）。
2. 归因诚实化：phase_verdict / 报告里显示 `agent_timeout`（附实际时长 vs 预算），不再谎称 code_regression。
3. **构造 agent_timeout 专用 signature**（§七.3 收口 codex）：PASS+timeout 常无普通 blocker → signature 为空，而 [shouldHaltNoProgress:261](harness/scripts/utils/goal-failure-classifier.ts) `if (!priorBlockerSignature) return false` 会**恒不触发**熔断。故为 `agent_timeout` 造不依赖普通 blocker 的专用 signature（如 `agent_timeout@<phase>`），否则下方"零进展超时熔断"落不了地。
4. 重试/熔断语义：超时**有进展**（signature 变小 / 产物 fresh）→ resume 续作；超时**零进展**（同专用 signature + 无产物变化）→ 进 SIGNATURE_HALT_KINDS 熔断，别再盲烧预算。与 §三 联动。
5. **有进展脱离内容重试预算（§七.1 收口，与 D 对称）**：`agent_timeout`+有进展的 resume **不吃 `max_retries_per_phase`**（内容重试配额是给"改码回归"的），只受 `wall_clock` + `max_total_turns` 兜底——与 D 的 `max_transient_api_retries` 解耦策略统一，根除 062613Z"必须人工 resume 重置计数才熬过"的病灶。基建失败(agent_timeout|transient_api_error)+有进展 → resume，独立于内容重试预算。

---

## 三、根因 C — 超时丢弃将成阶段 / 无谓烧满重试（全阶段）

### 定位
[goal-runner-phase.ts:56-74](harness/scripts/utils/goal-runner-phase.ts) `resolveClosureAdvanceBlock`：`verdict=PASS` 且 `closureStatus!=='closed'` 且 `agentTimedOut` → block `agent_timeout_unclosed`。诊断 attempt 3 即此路径（harness PASS 但 agent 被杀、receipt 未写完 → halt）。**每次超时都烧掉一整个 attempt 预算**，spec 因此 4×15m。

### P0-C 根治
1. **闭环实已完成即放行**：超时但 `harness=PASS + receipt 已 passed + closureStatus=closed` → advance（[:66](harness/scripts/utils/goal-runner-phase.ts) 已有 closed 放行；确保 receipt 落盘后 closureStatus 能被及时判定为 closed，避免"写完了却因 timeout 标记被拦"）。
2. 与 P0-B 联动：超时**有进展**→ 续作（resume）；**零进展**→ 熔断求人，不再无谓 retry。
3. （配合 A）预算给足后超时本身变罕见，B/C 是"即便超时也别把进展丢了/别盲烧"的系统兜底。

---

## 三·五、根因 D — headless agent API 断流被误分类 + 无诚实归因（全阶段）

### 现场链路（ground truth，claude adapter，run 20260701T085057Z）

`doc/features/bc-openCard/goal-runs/20260701T085057Z/events.jsonl`：

| attempt | 时长 | exit_code | timed_out | kill_attempted | phase_verdict |
|---|---|---|---|---|---|
| 1 | **38s** | **0** | ❌ | ❌ | retry FAIL，`agent_failed:false`，`failure_kind_classified:deterministic_gate_or_artifact_missing`，`blocker_signature:spec_file_exists` |
| 2 | **712s（11.9m）** | **1** | ❌ | ❌ | **halt** `no_progress_guard`，`agent_failed:true`，同 signature |

- `phases/spec/agent-output.log` = **81 字节**，内容整条即：`API Error: Connection closed mid-response. The response above may be incomplete.`
- `phases/spec/` 已产出 `context-exploration.md`(5544B) + `headless-assumptions.md`(6831B)，**独缺 `spec.md`**——agent 探索/确认门都做完了，偏偏写 spec.md 那次 API 响应断流。
- **决定性判据**：attempt1 `exit 0` 但无产物 + 日志是 claude 自己的 API 层错误串；`kill_attempted:false`（非 maison tree-kill，纯 API/网络断）。国内网络 + 新版 spec 让 agent 干的活更多、会话更长 → 断流概率被放大。

**验伪记录（免得再有人重走弯路）**：下游 AI 报的"缺 API key / 子进程 env 丢失 / 0字节"逐条被 ground-truth 证伪——env 完整继承（[agent-invoke.ts:595](harness/scripts/utils/agent-invoke.ts) `{...process.env}`）、`--permission-mode dontAsk` 有效可写盘（隔离实测 `dontAsk=>True`）、cross-spawn 在框架 harness 在位、claude 实际正常 spawn 并跑了 38s/12m。真因唯一：**API 连接中途断开**。

### 定位

1. **检测缺失**：[classifyFailureKind:158-177](harness/scripts/utils/goal-failure-classifier.ts) 只按 summary 的 blocker id 归因，**既不看 `invoke.timed_out` 也不看 `agent-output.log` 内容**。API 断流的 attempt `exit 0/1`、blocker 是派生的 `spec_file_exists` → 落 `deterministic_gate_or_artifact_missing`。与 B（超时）不同，**API 断流连结构化信号都没有**（非 timed_out/非 silent_killed），靠 exit code 一律漏判。
2. **误熔断**：`deterministic_gate_or_artifact_missing` ∈ [SIGNATURE_HALT_KINDS:74](harness/scripts/utils/goal-failure-classifier.ts) → attempt2 同 signature + 无产物变化 → `shouldHaltNoProgress` 命中 → `no_progress_guard` halt。**把"网络抖动应重试"误判成"卡死应求人"**，且盲目立即重试（无 backoff）等于对着抖动的连接猛捶。
3. **归因不诚实**：`phase_verdict` / summary / 报告里只有 `spec_file_exists` 与 `no_progress_guard`，**没有一处提到 API 断流**。下游排障 AI（及人）拿不到真因 → 臆造。这是本案**最大的实际伤害**：一个网络问题被系统包装成"框架/需求问题"。
4. **已有可复用件**：[goal-headless-sentinel.ts](harness/scripts/utils/goal-headless-sentinel.ts) 的 `parseHeadlessInteractionSentinel` 已确立"扫 agent-output.log 找哨兵"的范式；goal-runner 也已在 [:1296](harness/scripts/goal-runner.ts) 调它。D 只是加一个平行哨兵。

### P0-D 根治

文件：[goal-headless-sentinel.ts](harness/scripts/utils/goal-headless-sentinel.ts) + [goal-failure-classifier.ts](harness/scripts/utils/goal-failure-classifier.ts) + [goal-runner.ts](harness/scripts/goal-runner.ts)

1. **断流哨兵 = adapter 感知 + 锚定 CLI 错误信封（不是裸 grep 全文）**（三家 review 一致的成败点）：`goal-headless-sentinel.ts` 增 `parseHeadlessApiError(outputLogPath, adapter)`。**放弃"扫全文找通用网络词"**——`agent-output.log` 装的是 agent 最终 result 文本，一个"银行卡开卡"spec 的正常产出天然会讨论 `HTTP 500 / ECONNRESET / 连接超时 / terminated`（E1 网络异常就在验收场景里），裸子串必高误报，把真失败阶段误判成断流去 backoff、掩盖真 blocker。改为按 adapter 分组、锚定 **CLI 自己吐的错误信封**：
   - **claude（纯文本）**：命中**行首** `^API Error:` 且伴随截断信封特征（如 `The response above may be incomplete` / `Connection closed mid-response`），**且该错误主导日志**（出现在尾部/日志无有效 result payload）——本案 81 字节整条即错误串，正是典型。不匹配"正常 result 正文里夹了个 500"。
   - **chrys（JSON envelope）**：断流表现为结构化错误字段或非零退出 + 残缺 JSON，claude 式纯文本串在 chrys 根本不出现——须走 JSON 字段/截断解析，**不能用同一字符串哨兵**（否则 chrys 上漏判）。
   - **codex/cursor/opencode**：各 CLI 断流吐法不同，先各自定义信封或留 TODO，**不承诺跨 adapter 通用**。
   - **关键**：非空信封命中**不依赖 exit code**（本案 attempt1 是 `exit 0`）；返回 `{ code:'transient_api_error', matchedLine, lineIndex }`。
2. **0 字节 ≠ transient（改判 §六-8，防误吞 spawn/EINVAL/弱模型空回复）**：0 字节日志**不默认判断流**——它同样可能是 **Windows `.cmd` spawn EINVAL**（本会话实测过）、preflight/权限失败、或**弱模型空回复**（后者是 sibling [[全阶段卡死误判根治…e7d2b9a4]] 逃生阀的地盘，已落地 commit 2c4c6668，归 transient 会与之互踩）。仅当 **preflight 已过 + 无 spawn error + 无 toolchain 信号 + `duration_ms` 极短** 时列为 `agent_no_output`（新增 FailureKind，非 transient）。
   - **goal 模式处置（收口 cursor/codex）**：e7d2b9a4 逃生阀是 **normal 模式 Stop hook 专属，goal 无头没有那个 hook**——故 goal 里 `agent_no_output` **不能"交逃生阀"**。定口径：**诚实归因（报告写"agent 空产出，疑似 spawn/权限/弱模型，非 API 断流"）+ halt 求人**，**不 backoff、不盲重试、不冒充 transient_api_error**。（与 transient 的差别就在这：断流才 backoff 续跑，空产出直接 halt 让人查。）主检测路径永远是"非空信封命中"，0 字节只是保守兜底分支。
3. **升为一等 FailureKind + 显式哨兵优先级**：`FailureKind` 增 `transient_api_error`；`classifyFailureKind` 接受 `agentApiError` 信号，优先于 blocker 归因。goal-runner 已有 [interaction sentinel:1296](harness/scripts/goal-runner.ts)，两个 log 哨兵不能抢控制权，**定死优先级**：`agent_timeout`（runner tree-kill 确定性事实）> `headless_interaction_required`（既有）> `transient_api_error` > summary/blocker classifier。
4. **重试 = backoff，且受全局预算兜底**：`transient_api_error` **不进** `SIGNATURE_HALT_KINDS`；指数 backoff `5s→15s→45s`；**sleep 前**发独立事件 `transient_api_retry_scheduled`（否则用户仍看着像"卡住"）。独立上限 `max_transient_api_retries=3`，与 `max_retries_per_phase` **解耦**，但**仍受 `max_total_turns` + `wall_clock` 兜底**（backoff sleep 计入 wall_clock），避免无人值守被一条烂连接无限拖长。落点需同步：`GoalBudget` / 默认 manifest / manifest schema / progress/report。耗尽 → halt `transient_api_error_exhausted`。
   - **计数须从 events.jsonl 派生，非内存变量（收口 codex）**：与 `max_retries_per_phase` 同理，若 transient 计数只存内存，用户 `continue`/`--resume` 后计数清零 → 回到"每次继续几秒后又断/又重试"的老坑。改为按 `report_dir` 下本 phase 的 `transient_api_retry_scheduled`/`phase_verdict(transient)` 事件**派生当前 transient 次数**（复用现有 `loadEventsJsonl` 范式，与 P2 checkpoint 从盘上派生同源）。
   - **注意（写进报告给用户）**：backoff 修不了断掉的 TCP，只买到"几次自动重试 + 诚实归因"，网络长会话必断的场景仍需换代理/交互跑。
5. **有进展则 resume 续作**：断流常发生在阶段中后段（本案 context-exploration.md/headless-assumptions.md 已落盘）→ 复用 P0-C/已有 checkpoint-resume，重试 prompt 注入"上次 API 流中断，基于已有 artifacts 继续、勿从零重做探索"（[buildPhasePrompt](harness/scripts/goal-runner.ts) 已支持 partial 续作块），别把 5.5KB 探索白扔、也别叫 agent 去"修 spec.md 缺失"。
6. **诚实归因（堵臆造，本案最高价值）**：`phase_verdict` 加 `failure_kind:'transient_api_error'` + `api_error_excerpt`（信封命中行）；summary/goal 报告显式写：**"headless agent 与模型 API 连接中断（非框架/需求/代码问题），已退避重试 N 次；建议检查网络/代理稳定性或增大重试上限"**。目标：任何下游 AI/人一眼见真因，不再有"缺 API key"式臆造空间。

---

## 四、配套（测试）

- [goal-timeout.unit.test.ts](harness/tests/unit/goal-timeout.unit.test.ts)（c3f08a21 已建）扩：MIN 地板生效、重定后各阶段值、wall 派生随之上抬、adapter 悬空 timeout 收口后行为。
- **（§七.2）地板豁免显式 override（两条路径）**：默认表派生值 < MIN → 抬到 MIN；用户显式 `phase_timeout_seconds:{spec:600}` **和**显式扁平 `timeout_seconds:600` → **均保留 600 + WARN**，不被 Math.max 抬升。
- goal-failure-classifier 单测：`timed_out=true` → `agent_timeout`（优先于 blocker）；零进展超时进 halt kinds、有进展不进。
- **（§七.3）agent_timeout 专用 signature**：PASS+timeout 无普通 blocker（空 blocker signature）→ 仍生成 `agent_timeout@<phase>` signature；同专用 signature 重复 + 无产物 → `shouldHaltNoProgress` 触发 halt（反向：不再因空 signature 短路逃逸）。
- goal-runner-phase 单测：超时 + 闭环 closed → advance；超时 + 闭环 open → block(agent_timeout)；有进展/零进展分流。
- **（§七.1）B/D 预算对称**：`agent_timeout`+有进展 resume **不递增 `max_retries_per_phase` 计数**（仅 wall_clock/max_total_turns 兜底）；断言 062613Z 式"attempt3 因内容重试预算耗尽 halt"不再复现。
- 全阶段预算地板回归：断言 6 阶段默认值均 ≥ MIN。
- **（D）goal-headless-sentinel 单测（重点在防误报）**：claude 信封命中 `^API Error: … Connection closed mid-response`（含本案 81 字节原文，exit 0 也命中）；**反向断言（成败点）**：一份真实"银行卡"spec/coding 正文里含 `HTTP 500 / ECONNRESET / 连接超时 / terminated`（当 result payload 正常落地）**不得**误判 transient；**adapter 感知**：claude 字符串哨兵喂给 chrys 路径应不命中（走 JSON 解析）；**EINVAL 不误判**：0 字节 + spawn error（EINVAL）→ 判 spawn 失败/preflight，**非** transient。
- **（D）goal-failure-classifier 单测**：`agentApiError=true` → `transient_api_error`（优先于 blocker id，即便 blocker 是 spec_file_exists）；`transient_api_error` ∉ SIGNATURE_HALT_KINDS；哨兵优先级 `agent_timeout > headless_interaction_required > transient_api_error > blocker`；`agent_no_output`（0字节）不落 transient。
- **（D）goal-runner-phase 单测**：`transient_api_error` → 未达上限 retry（sleep 前发 `transient_api_retry_scheduled`）、达 `max_transient_api_retries` → halt `transient_api_error_exhausted`；transient 重试仍扣 `max_total_turns`/wall_clock（含 backoff sleep）；有 partial 产物时注入"基于已有 artifacts 续作"块；phase_verdict 含 `api_error_excerpt`。
- **（D）transient 计数跨 resume 不清零**：events.jsonl 已有 2 条 `transient_api_retry_scheduled` → `continue`/`--resume` 后派生计数=2（非 0），第 3 次断流即达上限 halt，不回到"每次续几秒又断"老坑。
- **（D）`agent_no_output` goal 模式处置**：0 字节 + preflight 过 + 无 spawn error → `agent_no_output` → **halt + 诚实归因，不 backoff、不冒充 transient**；反向：0 字节 + spawn EINVAL → 判 spawn 失败（非 agent_no_output、非 transient）。

---

## 五、落地顺序（建议）
1. **P0-A**（预算地板 + 重定表 + adapter 收口）—— 直接消除本案 spec 死循环，覆盖 ut/coding 临界风险。
2. **P0-B**（超时一等 FailureKind + 诚实归因 + 熔断语义）—— 全阶段超时不再盲重试/谎报。
3. **P0-C**（超时不丢进展 / 分流）—— 系统兜底。
4. **P0-D**（API 断流一等 FailureKind + 断流哨兵 + backoff 重试 + 诚实归因）—— 与 B 共用管线，B 落地后顺手加 D 分支，改动最省。
5. 配套单测（含 D 三组）+ 全阶段地板回归。
6. 立即 workaround（无需改码）：
   - 超时：goal manifest `unattended.phase_timeout_seconds: { spec: 2700 }`（[goal-timeout.ts:60](harness/scripts/utils/goal-timeout.ts) 优先级最高）。
   - API 断流：**修不了断掉的连接**——先换更稳的网络/代理重跑；断流多发时可先手动 `/spec` 交互跑（断了立刻可见、可续），网络稳后再上无人值守。

> 约束遵循：不擅自切分支（落 main）；不擅自 bump 版本（[[version-bump-only-on-request]]，落 2.4.0 窗口）；改动一律回既有 SSOT（goal-headless-sentinel / goal-failure-classifier / goal-runner），**不新建平行文件**（[[merge-not-new-files]]）；本 plan 仅诊断+方案，**待 review 通过、用户通知后再动手**。同 [[goal-and-normal-mode-capability-parity]]：B/D 均为 goal 侧无人值守治理，普通模式有真人在环（断流/超时当场可见可续），不需对等。

---

## 六、取舍点（用户 2026-07-01 已拍板 ✅）
1. **重定预算值** → ✅ 按推荐：`spec 900→2700`(45m)、`ut 3600→5400`(90m)、plan/coding/review/testing 维持。
2. **MIN 地板常量** → ✅ 按推荐：`MIN_PHASE_TIMEOUT_SECONDS = 1800`(30m)，**仅对"默认表派生值"硬地板**（`Math.max(tableDefault, MIN)`）；**用户显式 override（per-phase 或扁平 timeout_seconds）豁免地板**，见 §七.2 / P0-A.1。
3. **adapter 悬空 `timeout_seconds`** → ✅ **删除**（核实为 2.3.0 死旋钮，且正是 [goal-manifest.ts:192](harness/scripts/utils/goal-manifest.ts) 迁移要 strip 的值；无保留必要）。删 6 个 adapter.yaml + 文档指向 `phase_timeout_seconds`。
4. **超时零进展熔断** → ✅ **直接熔断反馈**：`agent_timeout` + 同 signature + 无产物变化 → 立即 halt 求人（不再用 max_retries 兜着空转）；超时**有进展**仍走 resume 续作。

### D 相关（用户 2026-07-01 已拍板 ✅）
5. **backoff 退避表** → ✅ 按推荐 `5s → 15s → 45s`（指数）。
6. **`max_transient_api_retries`** → ✅ **3**，与 `max_retries_per_phase` **解耦**（一次断流不吃正常重试预算）。
7. **B/D 并存优先级** → ✅ **`agent_timeout` 优先**（runner tree-kill 是确定性事实；断流串可能是被杀连带产生）。
8. **空日志(0字节)判别** → ✅ **改判已复核确认（用户 2026-07-01）**：0 字节**不默认判 transient**——本会话实测的 Windows `.cmd` spawn **EINVAL** 恰好也是"0字节+极短+exit≠0"，且 0 字节还可能是**弱模型空回复**（sibling [[全阶段卡死误判根治…e7d2b9a4]] 逃生阀地盘，已落地 commit 2c4c6668，归 transient 会互踩）。定案：0 字节 → 新增 `agent_no_output`（非 transient、不 backoff），仅在 preflight 已过 + 无 spawn error + 无 toolchain 信号时列疑似。处置分模式：**normal 模式归既有逃生阀；goal 无头无该 Stop hook → 只做诚实归因 + halt 求人**（见 P0-D.2）。**主检测走非空信封命中**（见 P0-D.1/.2）。

---

## 七、review 越界到已拍板 A/B/C 的三点（用户 2026-07-01 裁决：✅ 全部纳入本轮）

> 三家 review 有几条打到了 A/B/C（你 07-01 已拍板）。按 [[verify-review-claims-maison]] 逐条核实后如实列出。用户裁决**一并修**——已折入各自归属节，本节留作核实记录。

1. **B/D 重试预算不对称（cursor 提）→ ✅ 纳入，折入 [§二 P0-B.5]**：D 给了独立 `max_transient_api_retries` 且脱离 `max_retries_per_phase`；但 B（`agent_timeout`+有进展）仍吃 `max_retries_per_phase`。
   - **核实（含对我上一轮"核实"的自我纠错）**：cursor 因果**成立**，是我上轮反驳错了。复核 [goal-runner.ts:1432-1438](harness/scripts/goal-runner.ts)：`advance_blocked` 时 `if (retries < max_retries_per_phase) action='retry'; else action='halt'`——**halt vs retry 的闸门就是 `max_retries_per_phase`**；`agent_timeout_unclosed` 只是 `advance_block_reason`/`haltReason` **字段**（为何被 block 的标签），不是"终止"本身。attempt3(run1) 因预算耗尽 halt、attempt4(run2 重置计数) 同 closure-block 条件却 `action:retry` 正是反证。**"halt_reason 字段" ≠ "为何终止"，是两层**——我上轮把它俩混为一谈，特此改正（[[verify-review-claims-maison]] 对自己也生效）。
   - **设计对称性成立**：**已落 P0-B.5**：基建失败(agent_timeout|transient_api_error)+有进展 → resume，受 wall_clock/max_total_turns 兜底、独立于内容重试预算。
2. **P0-A `Math.max(resolved, MIN)` 会压掉用户显式更低的 timeout（codex 提）→ ✅ 纳入，折入 [§一 P0-A.1]**：硬地板 1800s 若无条件 `Math.max`，用户显式配 `phase_timeout_seconds:{spec:600}` 也会被抬到 1800，破坏显式 override 契约。
   - **核实**：属实——`resolvePhaseTimeoutSeconds` 末端硬 `Math.max` 会覆盖显式值。**已落 P0-A.1**：地板只兜底默认表派生值；显式 override 尊重原值，低于地板时 WARN 而非静默抬升。
3. **`agent_timeout` 的空 signature 逃不出 no-progress guard（codex 提）→ ✅ 纳入，折入 [§二 P0-B.3]**：PASS+timeout 常无 blocker → signature 为空；[shouldHaltNoProgress:261] `if (!priorBlockerSignature) return false` 恒不触发 halt。
   - **核实**：属实——空 signature 直接短路返回 false。**已落 P0-B.3**：为 `agent_timeout` 造专用 signature `agent_timeout@<phase>`，不依赖普通 blocker，否则"零进展超时熔断"（§六-4）落不了地。
