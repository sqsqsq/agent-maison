---
# 阶段完成回执（Phase Completion Receipt）
# 由主 agent 在阶段结束前手动填写；由 framework/harness/scripts/check-receipt.ts 与
# 实例根下发的 Stop hook 脚本解析作物理拦截依据（若有）。
#
# 全局入口 §5.1 SSOT：四条件缺一不可。
# 编造任意一项 → 反假设条款触发 → 任务失败。
#
# 输出路径：doc/features/<feature>/<phase>/phase-completion-receipt.md
# 模板路径：framework/harness/templates/phase-completion-receipt.md

feature: "<feature-name>"
phase: "<spec | plan | coding | review | ut | testing>"
agent_model: "<实际模型 id，如 minimax-2.5 / gpt-5.5 / <vendor-model-id>"
agent_runtime: "<cli-or-sdk-identifier | other>"
claimed_completion_at: "<ISO 8601, 如 2026-04-27T10:00:00+08:00>"
claimed_completion_commit_sha: "<git rev-parse HEAD 真实值>"

# ----------------------------------------------------------------------
# 1. Harness 验证（Layer 2 凭证）
# ----------------------------------------------------------------------
script_harness:
  command: "cd framework/harness && npx ts-node harness-runner.ts --phase <phase> --feature <feature>"
  exit_code: 0           # 必须为 0；非 0 = FAIL；缺省 = 反假设
  report_dir: "doc/features/<feature>/<phase>/reports"
  blocker_count: 0       # 必须为 0
  ran_at: "<ISO 8601>"

# ----------------------------------------------------------------------
# 1.5 Testing 阶段 · 真机自动化产物路径（仅 phase=testing 且 profile 未 SKIP device_test.run 时必填）
# ----------------------------------------------------------------------
testing_run_artifacts:
  hylyre_run_exit_code: 0                  # 子进程退出码；若无需执行可填 -1（与 profile SKIP 对齐时由校验脚本忽略本块）
  hylyre_report_path: "doc/features/<feature>/testing/reports/<ts>/hylyre/test-report.md"
  hylyre_trace_path:  "doc/features/<feature>/testing/reports/<ts>/hylyre/trace.json"
  app_snapshot_cache_dir: "doc/app-snapshot-cache"

# ----------------------------------------------------------------------
# 2. Verifier 子 agent（Layer 2 凭证）
# ----------------------------------------------------------------------
verifier_subagent:
  invoked_via: "Task(subagent_type=verifier)"   # 不允许 "told user to run"
  prompt_template: "framework/harness/prompts/verify-<phase>.md"
  report_path: "doc/features/<feature>/<phase>/reports/verifier.report.md"
  verdict: "PASS"        # PASS | FAIL；FAIL 即未闭环
  ran_at: "<ISO 8601>"

# ----------------------------------------------------------------------
# 3. trace.json 凭证（Layer 1 凭证，全局入口 §5）
# ----------------------------------------------------------------------
trace_json:
  path: "doc/features/<feature>/<phase>/reports/trace.json"
  exists: true           # check-receipt.ts 会真实 fs.existsSync 校验
  schema_valid: true     # 是否能被 trace.schema.json 解析

# ----------------------------------------------------------------------
# 3.5 Context Exploration Gate（与 check-* 的 context_exploration_* 对齐）
# ----------------------------------------------------------------------
context_exploration:
  summary_path: "doc/features/<feature>/<phase>/context-exploration.md"
  exists: true
  ready_to_produce: true
  has_blocker_coverage_risk: false

# ----------------------------------------------------------------------
# 4. 自检题（agent 必须自答；check-receipt.ts 会做反编造校验）
# ----------------------------------------------------------------------
self_check:
  q1_trace_json_abs_path: "<给出 trace.json 真实绝对路径；check-receipt.ts 会 fs.existsSync 校验>"
  q2_verifier_verdict_quoted: "<从 verifier_subagent.report_path 中摘录 verdict 字段原文>"
  q3_last_diff_file: "<本阶段 git diff --name-only 输出的最后一行真实文件路径>"
  q4_no_hallucinated_rule_used: true   # 必须为 true；填 false 即承认自我作弊
  q4_evidence: "<若 q4 为 true，说明本次决策没有引用全局入口 / SKILL.md 中不存在的规则；若曾自我设限，请 quote 原文行号>"
---

## 实际执行的 shell / 工具命令（最后 5 条，按时序）

> agent 必须真实回填本次阶段执行过的命令；与 trace.json 中 `tool_calls` 相互印证。

1. `<命令1>`
2. `<命令2>`
3. `<命令3>`
4. `<命令4>`
5. `<命令5>`

## 备注（可选）

> 本阶段中遇到的特别情况、与用户的关键决策点、已知尚未解决的 MAJOR/MINOR 项等。
> 不允许用本节为"跳过 BLOCKER"辩护；BLOCKER 一票否决。

- ...

## 反假设条款回顾（全局入口 §6.5）

- [ ] 我没有引用 `全局入口 Markdown` / 任一 `SKILL.md` 中**不存在**的规则作为跳过任何步骤的理由。
- [ ] 若我曾认为某规则限制了我执行某动作，我已逐字 quote 原文 + 文件路径 + 行号。
- [ ] 我没有把"我假设 / 通常这样 / 为安全起见"作为跳过 harness / verifier / 回执填写的借口。

> 三项必须全部勾选（`[x]`）；任一未勾选即视为反假设条款被触发，本回执校验 FAIL。
