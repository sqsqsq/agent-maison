---
name: goal verifier hook 串台收尾
overview: 本轮落地 hooks 串台 plan 暂缓的 Fix D：给 SubagentStop hook record-verifier-report.mjs 增加 MAISON_GOAL_HEADLESS 旁路，消除 goal 无头链下 verifier 报告/state 的目录污染、内容污染与跨会话新鲜度污染；明确把选项 3(env 精确定位)与已完成的并发/预算/挂起工作划在本轮范围之外。绑定在研版本 2.3.0(patch)。
version: 2.3.0
todos:
  - id: fixd-bypass
    content: record-verifier-report.mjs main() 加 MAISON_GOAL_HEADLESS 旁路：goalHeadless 时强制兜底目录(last-verifier-report.*)、feature/phase 内容也不取自 state(置 unknown + 标 goal_headless:true)、跳过 state 回写块；注释标注 env SSOT
    status: completed
  - id: fixd-tests
    content: 新增/扩展 hook 单测端到端驱动 record-verifier-report.mjs：用例A(旁路生效，不写X目录/不回写state/落兜底 且 fallback 内容不含旧X元数据、保留verdict/transcript/session) + 用例B(无env无回归)；接入 run-unit.ts
    status: completed
  - id: fixd-receipt-check
    content: 复核 check-receipt 闭环中立性——确认 goal 无头下 verifier 报告只落兜底不会让 check-receipt 比现状更糟(closure-neutral)；结论写进残余风险
    status: completed
  - id: fixd-verify
    content: cd harness && npm test 全 PASS + npm run release:verify 通过，hook-stale-state 不回归
    status: completed
isProject: false
---

## 版本绑定

`version: 2.3.0`（= 根 `package.json.version`，patch；不擅自 bump）。本 plan 是 [goal_模式_hooks_串台分析](.cursor/plans/goal_模式_hooks_串台分析_9c77c207.plan.md) 中 Fix D 的承接收尾。

## 背景：遗留盘点（已核实）

三个相关 plan 的 todos 现状：

- [并发与预算修复](.cursor/plans/goal-runner_并发与预算修复_bdac8ce2.plan.md)：P0–P2（递归防护 / tree-kill / feature 锁 / 预算跨 resume / 终态守卫 / 报告快照 / manifest 策略 / agent-failure）**全部 completed**。
- [close 挂起修复](.cursor/plans/goal-runner_close_挂起修复_7440c57d.plan.md)：exit-为准+grace、resume 半完成恢复、死 pid 接管、daemon 卫生（可选项）**全部 completed**。
- [hooks 串台分析](.cursor/plans/goal_模式_hooks_串台分析_9c77c207.plan.md)：Fix A/B completed；Fix C cancelled（被 Fix B 从源头取代）；**Fix D cancelled（暂缓待下轮）= 本轮唯一 actionable**。

结论：所谓「并发/预算/进程收尾类遗留」主体已落地，本轮真正要做的只有 Fix D。

## 根因（Fix D）

[record-verifier-report.mjs](agents/claude/templates/hooks/record-verifier-report.mjs) 是 `SubagentStop` hook：读 `.current-phase.json` 的 `feature/phase` 决定 verifier 报告写入目录（L272-286），并回写 `state.last_verifier_report` / `last_seen_*`（回写 `try` 块 L330-352）。它**缺少** `MAISON_GOAL_HEADLESS` 旁路（对比已落地的 [check-phase-completion.mjs:510-514](agents/claude/templates/hooks/check-phase-completion.mjs)）。

goal 无头链下，子 Claude 树携带 `MAISON_GOAL_HEADLESS=1`（由 [agent-invoke.ts spawnHeadlessChild](harness/scripts/utils/agent-invoke.ts) L519 注入，hook 子进程继承）。若启动 goal 前存在旧 state（主窗口在做 feature X），子 Claude 为 feature Y spawn 的 verifier 子 agent 触发 SubagentStop → hook 读到 X 的 state → 把 Y 的 verifier 报告写进 X 的报告目录、并回写 X 的 state，造成**跨 feature 审计链污染**。goal-runner 当轮裁决读取 fresh `summary.verdict`（receipt/closure 是 summary 中的闭环状态与 resume 语义，不由 Fix D 改变），故此污染**不影响裁决、只污染审计**。

## 本轮要做（Fix D 选项 2：env 旁路，低成本）

### 改造点 1：record-verifier-report.mjs 加 MAISON_GOAL_HEADLESS 旁路

文件 [agents/claude/templates/hooks/record-verifier-report.mjs](agents/claude/templates/hooks/record-verifier-report.mjs) `main()`（L249 起）。`goalHeadless` 须同时切断**三处**污染（仅切目录不够，Codex/Claude 共同指出）：

- 在 `stop_hook_active` 检查（L252-255）之后取 `const goalHeadless = process.env.MAISON_GOAL_HEADLESS === '1';`，注释标注 env SSOT = `framework/harness/scripts/utils/phase-state.ts → MAISON_GOAL_HEADLESS_ENV`，风格对齐 [check-phase-completion.mjs:510-514](agents/claude/templates/hooks/check-phase-completion.mjs)。
- **(a) 目录**：把 L272-286 的判定 `state && state.feature && state.phase` 收敛为 `const useStateDir = !goalHeadless && state && state.feature && state.phase;`，假时 `reportDir = framework/harness/state` 且文件名用 `last-verifier-report.{md,json}`（现有兜底分支）。
- **(b) 内容（真正漏洞，本轮必补）**：L269-270 当前 `const feature = state?.feature ?? 'unknown'; const phase = state?.phase ?? 'unknown';` 在 goalHeadless 下仍会读到旧 X 的 `feature/phase`，使兜底 MD/JSON 正文写成 `feature: X / phase: coding`——把"路径污染"降级成"兜底内容污染"。改为：`goalHeadless` 时 `feature/phase` 一律置 `'unknown'`，并在落盘**标记来源**：JSON 增加 `goal_headless: true` 字段，**MD 元数据同步加一行** `- goal_headless: true`（否则人工翻 `last-verifier-report.md` 无法区分"goal 链路产物"与"普通无 state 兜底"，一行成本）。不引入 `MAISON_GOAL_FEATURE/PHASE`（那是选项 3）。`goal_headless` 属向后兼容新增字段，JSON `schema_version` 保持 `1.0` 即可；若仓库 schema 演进约定要求，则顺手提至 `1.1`（实施时按现有 schema-lint 现状决定，不强制）。
- **(c) state 回写**：L330-352 整个回写 `try` 块加 `if (!goalHeadless && state && state.feature && state.phase)` 守卫。goal 无头下不触碰 `.current-phase.json`。**额外收益（Claude 指出）**：现 L343-345 会用 goal 链 verifier 的 `session_id` 刷新 `last_seen_session_id` / `last_seen_at`，污染交互式主窗口 Stop hook 的**跨会话新鲜度判定**；本守卫顺带堵上这第二种污染。
- 报告内容（verdict / transcript / last_assistant_text）照常落兜底文件，**仅当前这次 hook 输出可见**（覆盖语义见残余风险）；不写进任何 feature 目录、不回写 state、不伪装成 X。

### 改造点 2：单测（端到端驱动 .mjs）

新增/扩展 hook 单测，沿用 [hook-stale-state.unit.test.ts](harness/tests/unit/hook-stale-state.unit.test.ts) 的 `spawnSync('node', [HOOK_PATH], { input, env })` 端到端模式，目标 HOOK 改为 record-verifier-report.mjs：

- 用例 A（旁路生效）：fixture 含旧 state `feature=X / phase=coding` + `MAISON_GOAL_HEADLESS=1` → 断言：
  - (a) **不**写 X 的 `…/X/coding/verifier.report.md`；
  - (b) 写到 `framework/harness/state/last-verifier-report.{md,json}`；
  - (c) `.current-phase.json` 的 X state **未被** `last_verifier_report` / `last_seen_*` 污染；
  - (d) **fallback JSON/MD 内容不含旧 X 元数据**：`feature/phase` ≠ `X/coding`（为 `unknown`），JSON 带 `goal_headless: true`；
  - (e) 若 transcript 有 verdict，fallback JSON 仍**保留** `verdict / transcript_path / session_id`（旁路只改归属，不丢本次内容）。
- 用例 B（无回归）：同 fixture **不带** env → 仍按 state 写入 X 目录、回写 state（保证交互式 verifier 行为不变）。
- 接入 [harness/tests/run-unit.ts](harness/tests/run-unit.ts) 注册表。

### 改造点 3：复核 check-receipt 闭环中立性（不扩范围，仅确认）

[check-receipt.ts:307-322](harness/scripts/check-receipt.ts) 对 `verifier_subagent.report_path` 做 **BLOCKER** 校验（填了则文件须存在；没填也 BLOCKER）。需确认 Fix D 是 **closure-neutral**：

- goal 无头链下 `.current-phase.json` 被 Fix B 抑制写入 → 现状（Fix D 前）hook 本就**已**走兜底、不写标准 `verifier.report.md`；Fix D 只是把"旧 X state 残留时落 X 目录"改成"落兜底"，对 Y 的标准路径存在性**两种情况都缺失，无新增回归**。
- 复核产出：在残余风险中明确"goal 无头下 verifier 报告参与 phase closure 与否"属**既有**议题（与 Fix D 正交，候选选项 3 / 另起）。若复核发现 Fix D 反而使某 goal phase 的 check-receipt 由通过转失败，则升级为 BLOCKER 并停下与用户确认（不在本轮静默扩范围）。

### 验收

- `cd harness && npm test` 全 PASS（AGENTS.md BLOCKER）。
- `npm run release:verify` 通过（含 LF 断言）。
- 现有 `hook-stale-state.unit.test.ts` 不回归。
- check-receipt 闭环中立性结论已记录（改造点 3）。

## 本轮不做（明确划界）

- **选项 3（env 精确定位）**：在 agent-invoke spawn 时注入 `MAISON_GOAL_FEATURE/PHASE`、hook 优先用 env 定位正确报告目录，使 goal 无头下 verifier 报告仍能正确归档到 Y。跨 agent-invoke + hook 两层、复杂度高；选项 2 已消除污染（verifier 报告落兜底而非 Y 目录是可接受降级——goal 裁决不读 verifier 报告）。留未来版本。
- **并发/预算/挂起三 plan 的全部条目**：已 completed，本轮仅复核引用，不重做。
- **不改语义**：不动 goal-runner 的 phase 裁决 / 预算 / 递归防护 / 锁 / exit-为准 收尾逻辑。
- **不深挖** cursor-agent 内部后台进程行为（外部 CLI）。
- **native_goal 占位定性**：claude/codex adapter 的 `native_goal` metadata + `goal-condition` 模板仍是"看似待办"的占位（本会话已确认不做深度对接）。其定性收尾（措辞改"已评估、暂不实施"或移除 metadata）属文档/元数据层，**另起小项**，不在本 plan。

## 残余风险（已知、本轮接受）

- **兜底文件覆盖语义（措辞收敛，Codex/Claude 共同指出）**：`framework/harness/state/last-verifier-report.*` 是**全局单文件**。一次 goal run 跨多 phase 连续触发 verifier 会**互相覆盖**；不同 feature 并行 goal run（feature 锁只防同 feature 多实例，不约束跨 feature）也会互踩同一文件。所以准确表述是"**兜底保留最近一次 hook 输出**"，**非** run/feature-scoped 持久审计——不是"不丢数据"。
- **goal phase closure 前提（"对裁决无影响"需带前提）**：goal-runner 当轮裁决读取 fresh `summary.verdict`（`closure_status` / `receipt_status` 由 harness-runner 写入 summary，并在半完成 resume 恢复中使用），verifier 报告落兜底不直接影响裁决；但 receipt 的 `verifier_subagent.report_path` 受 [check-receipt.ts:307-322](harness/scripts/check-receipt.ts) BLOCKER 校验。本轮结论（见改造点 3）：Fix D **closure-neutral**——不新增回归；"goal 无头下 verifier 报告是否应参与 phase closure / 精确归档"留选项 3 或另起。
- **精确归档缺失**：goal 链内 verifier 报告不进 Y 的 `verifier.report.md`，是选项 2 的**可接受降级**；要让其按 feature/run 精确归档，需选项 3（`MAISON_GOAL_FEATURE/PHASE` env）。
- 旁路仅作用于 `MAISON_GOAL_HEADLESS=1` 的子进程树，交互式主窗口 verifier 行为完全不变。