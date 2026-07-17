# Design: receipt-slim

## 执行时序（拆环核心）

```
runScriptHarness → checks → ScriptReport 落盘
  → ①writeBaseRunSummary(report)            # 无 receipt 依赖；完整 schema-valid；原子写（tmp+rename）
       next_action='fill_receipt_then_check' # 初值语义=未闭环等待 receipt
       closure_status='open'
  → ②verdict===PASS && !receiptExists → writeReceiptSkeleton()   # 瘦身版骨架；checkbox 全未勾；幂等不覆盖
  → ③receiptValidation = tryValidateReceipt()                     # check-receipt 读【本次 base summary】
  → ④patchRunSummaryClosure(receiptValidation)                    # 只 patch receipt_status/closure_status/next_action
```

- 旧实现 `receiptValidation → writeRunSummary(receiptValidation)` 的环被打断：check-receipt 的 summary 事实源永远是**本次** base（gate_fingerprint 比对天然拒绝旧 summary）。
- patch 失败 = base 留存（open/等待 receipt），诚实且 schema-valid；绝无"非法 JSON/残留 closed"中间态。

## 瘦身字段集（新格式 receipt）

保留：`feature/phase`、`agent_model/agent_runtime`、`claimed_completion_at`、`claimed_completion_commit_sha`、`verifier_subagent`（invoked_via + verdict 摘录，即旧 q2 语义）、反假设三 checkbox、`testing_run_artifacts`（testing 阶段）、evidence_manifest 指针（机器回写，既有）。
删除：`script_harness` 全块（verdict/exit_code/blocker_count/command）、`trace_json` 块（存在性由 check-receipt 直查磁盘）、self_check q1（=trace 路径）、q3（=diff 末行）。

- 格式判别：新模板 frontmatter `receipt_schema: "2.0"`；缺失该键 = 旧格式（1.x），走既有全量校验（含 command 注入扫描）。
- process-integrity：新格式下 SSOT = runner `runProcessIntegrityPreflight` 的 CheckResult（BLOCKER 时 base summary verdict 必 FAIL，闭环天然不成立）；不做第二套扫描。

## 对账强度（新格式 check-receipt 核心判据）

1. summary.json 存在且 JSON/schema 可解析——缺失/损坏 = BLOCKER（不静默）。
2. summary.feature/phase === receipt.feature/phase（canonical path 由 feature/phase 解析，防串目录）。
3. summary.verdict === 'PASS' 且 blocker_count === 0。
4. summary.gate_fingerprint 与当前 phase-rules 重算值一致（既有 stale 机制复用）——**天然拒绝旧 summary**。
5. verifier PASS / trace 磁盘存在 / manifest 生成成功等既有硬条件不变。

## 骨架（PASS-gated）

仅 `verdict===PASS && !exists(receipt)` 时写；FAIL 跑不产半真骨架。骨架含身份占位与未勾 checkbox；生成失败不阻断（best-effort，AI 可全手填）。
