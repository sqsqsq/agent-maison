---
# 阶段完成回执（Phase Completion Receipt · 瘦身格式 2.0，openspec receipt-slim）
# 由主 agent 在阶段结束前填写；check-receipt.ts 与 Stop hook（若有）解析作物理拦截依据。
#
# 2.0 与旧格式的区别：机器事实（harness verdict/blocker/门禁指纹/trace 存在性）不再手抄——
# check-receipt 直读本次 harness base summary（doc/features/<feature>/<phase>/reports/summary.json）
# 与磁盘做对账；本回执只承载机器不可替代的自证。编造任意一项 → 反假设条款触发 → 任务失败。
#
# 闭环判据（全局入口 §5.1 不变）：harness PASS（由 summary 直读证明）+ verifier PASS +
# 本回执校验通过。harness 在 verdict=PASS 时会自动生成本骨架（自证字段仍须真实填写）。
#
# 回执 stale 治理（自动）：summary 内的门禁集指纹由 harness 机器写入；framework 升级后
# check-receipt 指纹重算失配 → 本回执自动失效（gate_fingerprint_stale），须重跑 harness。

receipt_schema: "2.0"
feature: "<feature-name>"
phase: "<spec | plan | coding | review | ut | testing>"
agent_model: "<实际模型 id，如 minimax-2.5 / gpt-5.5 / <vendor-model-id>>"
agent_runtime: "<cli-or-sdk-identifier | other>"
claimed_completion_at: "<ISO 8601, 如 2026-04-27T10:00:00+08:00>"
claimed_completion_commit_sha: "<git rev-parse HEAD 真实值>"
# 本回执属于哪一次 attempt 的唯一凭据。goal 模式下由 runner 在骨架中**预填**（closure
# attempt 开始前会重写为当前轮次身份，如 "i3"）——**agent 不得修改本字段**：goal 态
# check-receipt 与 runner 身份精确等值校验，手改/抄旧值即 FAIL（抄旧回执还会让完成观测
# 把上一轮旧声明当本轮完成，实证 run 20260803T103413Z-3f72a8：coding 连续两次 attempt
# 各只活 35 秒）。非 goal（人工）模式保持留空即可。
claimed_attempt_id: ""

# ----------------------------------------------------------------------
# 1. Verifier 子 agent（**兼容投影 · 已退出裁决权威**）
# ----------------------------------------------------------------------
# plan e5b8c3f7：verifier 的机器真源是
#   doc/features/<feature>/<phase>/reports/verifier.report.<subject>.json
# （按 subject 分区；当前是哪一份由 summary.verifier_subject_id 决定）
# 由 SubagentStop hook 在三重身份等值绑定后发布（invocation subject == 终态块回显
# == summary.verifier_subject_id）。check-receipt 真验真：feature/phase 匹配、agent
# 身份在场、subject 现值、结构合法、verdict 与 BLOCKER 计数一致——**本块手填什么都
# 不改变判定**。填错只会得到一条 MAJOR 提示，填对也不能让不合格的报告通过。
#
# 本块保留至少一个 minor 窗口，供存量回执解析不断裂；新回执照填即可（如实抄机器事实）。
# 让 verifier 报告出现的正确路径：主 agent 用 Task 触发 subagent_type=verifier，
# prompt = 该阶段 reports/ai-prompt.md **全文原样投递**（含 verifier 证据身份机器块）。
verifier_subagent:
  invoked_via: "Task(subagent_type=verifier)"   # 兼容投影；不允许 "told user to run"
  prompt_template: "framework/harness/prompts/verify-<phase>.md"
  report_path: "doc/features/<feature>/<phase>/reports/verifier.report.<subject>.json"
  verdict: "PASS"        # 兼容投影：如实抄 verifier.report.json 的 verdict
  ran_at: "<ISO 8601>"

# ----------------------------------------------------------------------
# 1.5 Testing 阶段 · 真机自动化产物路径（仅 phase=testing 且 profile 未 SKIP device_test.run 时必填）
# ----------------------------------------------------------------------
testing_run_artifacts:
  hylyre_run_exit_code: 0                  # 子进程退出码；若无需执行可填 -1（与 profile SKIP 对齐时由校验脚本忽略本块）
  hylyre_report_path: "doc/features/<feature>/testing/reports/<ts>/hylyre/test-report.md"
  hylyre_trace_path:  "doc/features/<feature>/testing/reports/<ts>/hylyre/trace.json"
  app_snapshot_cache_dir: "doc/app-snapshot-cache"
---

## 备注（可选）

> 本阶段中遇到的特别情况、与用户的关键决策点、已知尚未解决的 MAJOR/MINOR 项等。
> 不允许用本节为"跳过 BLOCKER"辩护；BLOCKER 一票否决。

- ...

## 反假设条款回顾（全局入口 §6.5）

- [ ] 我没有引用 `全局入口 Markdown` / 任一 `SKILL.md` 中**不存在**的规则作为跳过任何步骤的理由。
- [ ] 若我曾认为某规则限制了我执行某动作，我已逐字 quote 原文 + 文件路径 + 行号。
- [ ] 我没有把"我假设 / 通常这样 / 为安全起见"作为跳过 harness / verifier / 回执填写的借口。

> 三项必须全部勾选（`[x]`）；任一未勾选即视为反假设条款被触发，本回执校验 FAIL。
