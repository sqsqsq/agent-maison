---
receipt_schema: "2.1"
generated_by: "harness (read-only projection; plan 07a41ec6 T4)"
feature: "demo-card"
phase: "testing"
agent_model: "codex"
agent_runtime: "codex"
claimed_completion_at: "2026-09-25T04:33:35.176Z"
claimed_completion_commit_sha: "55b3e30416057ca96b85769b48c230fcecabf941"
claimed_attempt_id: "i12"
verifier_subagent:
  invoked_via: "Task(subagent_type=verifier)"
  prompt_template: "framework/harness/prompts/verify-testing.md"
  report_path: "doc/features/demo-card/testing/reports/verifier.report.5156e27b1d9945d05e79740ce1fdedb136ff16e213339d06a52df20a91a3a41e.md"
  verdict: "PASS"
  ran_at: ""
testing_run_artifacts:
  hylyre_run_exit_code: 0
  hylyre_report_path: "doc/features/demo-card/testing/reports/20260925T043319Z-962/hylyre/test-report.md"
  hylyre_trace_path: "doc/features/demo-card/testing/reports/20260925T043319Z-962/hylyre/trace.json"
  app_snapshot_cache_dir: "doc/app-snapshot-cache"
---

# 阶段完成回执（机器投影 · schema 2.1）

> 本文件由 harness 从 summary.json、verifier 报告与真机产物投影生成，**只读**：闭环判据不读它
> （closure = base summary PASS + verifier policy 满足），改它不改变任何判定，重跑 harness / check-receipt 会重写。
> 备注、决策点、已知未解决项请写 `testing/notes.md`（不进门禁、closure、subject 与 freshness）。
