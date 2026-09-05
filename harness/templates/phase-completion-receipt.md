---
# 阶段完成回执（Phase Completion Receipt · 机器投影 schema 2.1，plan 07a41ec6 T4 / openspec efficiency-first-closure）
#
# 本文件由 harness 生成，**只读**：agent 不填任何字段。closure 直读 base summary、script verdict 与
# verifier policy；回执不是闭环输入，也不进 evidence manifest 的 freshness——改它不改变任何判定，
# `summary.closure_status=closed` 提交后才 best-effort 生成；生成失败只 WARN。备注、决策点、已知未解决项写 `<phase>/notes.md`。
#
# 字段来源：feature/phase = CLI；agent_model/agent_runtime = adapter 与环境；claimed_completion_at = 生成时刻；
# claimed_completion_commit_sha = summary.source_commit_sha；claimed_attempt_id = closure 上下文投影（非 goal 留空）；
# verifier_subagent = summary.verifier_report 指向的 verifier.report.<subject>.md；
# testing_run_artifacts（仅 testing）= 权威 run 目录的 trace/report 与 app 快照缓存目录。

receipt_schema: "2.1"
generated_by: "harness (read-only projection; plan 07a41ec6 T4)"
feature: "<feature-name>"
phase: "<spec | plan | coding | review | ut | testing>"
agent_model: "<adapter 或环境声明的模型 id>"
agent_runtime: "<adapter>"
claimed_completion_at: "<ISO 8601，生成时刻>"
claimed_completion_commit_sha: "<summary.source_commit_sha>"
claimed_attempt_id: ""
verifier_subagent:
  invoked_via: "Task(subagent_type=verifier)"
  prompt_template: "framework/harness/prompts/verify-<phase>.md"
  report_path: "<summary.verifier_report，即 doc/features/<feature>/<phase>/reports/verifier.report.<subject>.md 或空>"
  verdict: "<PASS | FAIL | 空>"
  ran_at: ""
testing_run_artifacts:
  hylyre_run_exit_code: 0
  hylyre_report_path: "<权威 run 的 hylyre/test-report.md>"
  hylyre_trace_path: "<权威 run 的 hylyre/trace.json>"
  app_snapshot_cache_dir: "doc/app-snapshot-cache"
---

# 阶段完成回执（机器投影 · schema 2.1）

> 本文件由 harness 从 summary.json、verifier 报告与真机产物投影生成，**只读**：闭环判据不读它
> （closure = base summary PASS + verifier policy 满足），改它不改变任何判定，重跑 harness / check-receipt 会重写。
> 备注、决策点、已知未解决项请写 `<phase>/notes.md`（不进门禁、closure、subject 与 freshness）。
