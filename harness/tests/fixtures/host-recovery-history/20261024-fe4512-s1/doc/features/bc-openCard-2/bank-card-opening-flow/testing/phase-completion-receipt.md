---
receipt_schema: "2.1"
generated_by: "harness (read-only projection; plan 07a41ec6 T4)"
feature: "cu-YmMtb3BlbkNhcmQtMgBiYW5rLWNhcmQtb3BlbmluZy1mbG93"
phase: "testing"
agent_model: "codex"
agent_runtime: "codex"
claimed_completion_at: "2026-10-24T19:51:46.620Z"
claimed_completion_commit_sha: "9b37cce3281566e6d20f5071dc502866d976ebe3"
claimed_attempt_id: "i25"
verifier_subagent:
  invoked_via: "Task(subagent_type=verifier)"
  prompt_template: "framework/harness/prompts/verify-testing.md"
  report_path: "doc/features/bc-openCard-2/bank-card-opening-flow/testing/reports/verifier.report.0239fd96ea0d20220adf3b07da4359e2bb1016ec955414eba1e03f1523fe8f1c.md"
  verdict: "PASS"
  ran_at: ""
testing_run_artifacts:
  hylyre_run_exit_code: 0
  hylyre_report_path: "doc/features/bc-openCard-2/bank-card-opening-flow/testing/reports/20261024T194450Z-003/hylyre/test-report.md"
  hylyre_trace_path: "doc/features/bc-openCard-2/bank-card-opening-flow/testing/reports/20261024T194450Z-003/hylyre/trace.json"
  app_snapshot_cache_dir: "doc/app-snapshot-cache"
---

# 阶段完成回执（机器投影 · schema 2.1）

> 本文件由 harness 从 summary.json、verifier 报告与真机产物投影生成，**只读**：闭环判据不读它
> （closure = base summary PASS + verifier policy 满足），改它不改变任何判定，重跑 harness / check-receipt 会重写。
> 备注、决策点、已知未解决项请写 `testing/notes.md`（不进门禁、closure、subject 与 freshness）。
