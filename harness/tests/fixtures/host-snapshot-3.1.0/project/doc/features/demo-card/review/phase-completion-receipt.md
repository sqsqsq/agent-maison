---
receipt_schema: "2.1"
generated_by: "harness (read-only projection; plan 07a41ec6 T4)"
feature: "demo-card"
phase: "review"
agent_model: "codex"
agent_runtime: "codex"
claimed_completion_at: "2026-09-25T04:32:55.936Z"
claimed_completion_commit_sha: "55b3e30416057ca96b85769b48c230fcecabf941"
claimed_attempt_id: "i8"
verifier_subagent:
  invoked_via: "Task(subagent_type=verifier)"
  prompt_template: "framework/harness/prompts/verify-review.md"
  report_path: "doc/features/demo-card/review/reports/verifier.report.890b9296fb825308def2c0aca79ea43a9768ebc73653c5cd767c4e08593cf64a.md"
  verdict: "PASS"
  ran_at: ""
---

# 阶段完成回执（机器投影 · schema 2.1）

> 本文件由 harness 从 summary.json、verifier 报告与真机产物投影生成，**只读**：闭环判据不读它
> （closure = base summary PASS + verifier policy 满足），改它不改变任何判定，重跑 harness / check-receipt 会重写。
> 备注、决策点、已知未解决项请写 `review/notes.md`（不进门禁、closure、subject 与 freshness）。
