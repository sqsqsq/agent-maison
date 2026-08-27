# Tasks

- [x] gate 减法：`requirement_ref` 收窄为 `{source_path,snippet}`，`snippet_sha256` 退役（存量忽略）；报错/建议文案同步（`p0-semantic-gates.ts`）
- [x] 骨架归责：新增 `receipt-scaffold.ts`（runner-owned 身份字段预填 + force 重建语义）；`harness-runner.ts` PASS 骨架改走共享实现；`goal-runner.ts` closure-only invoke 前重建骨架；模板与 `check-receipt.ts` 文案对齐
- [x] 单测：存量失配 `snippet_sha256` 被忽略（默认 PASS 用例钉住）+ 无该字段 PASS + 引文伪造仍 FAIL（`p0-semantic-gates.unit.test.ts`）；骨架预填/幂等/force 作废旧回执/非 goal 留空（`receipt-slim.unit.test.ts`）
- [x] OpenSpec：harness-gates MODIFIED + goal-runner ADDED（本 change）
- [x] closure-only 状态归位：由最新 `PASS + advance_blocked + retry` 裁决派生；coding/ut 无冻结面仍须刷新本轮回执身份、注入 closure-only prompt，并补判别回归
- [x] 骨架单点写入（codex 同类问题审计）：goal 态回执骨架由 runner 在**每次** invoke 前 force 写入（内容轮+closure 轮；lite/dry-run 除外），写失败 halt `receipt_scaffold_unwritable` 不启动 agent；`writeReceiptScaffold` 失败携带真实原因；harness-runner PASS-gated 首建 goal 态让位（非 goal 手动流程保留）
- [x] pass snapshot 整体退役：take/diff/restore/discard/trusted 加载/epoch+head+journal/内存锚/`pass_snapshot_unavailable` 族 halt/responsibilityRerunPending 全删；防篡改=下一轮完整 harness 重验 + closure manifest 绑当前字节；保留 coding-base 锚与 run trust GC（兼扫旧 run 快照目录）、adjudication/report 读侧历史映射；product-source-snapshot（testing 写保护）等同名异职机制不动；smoke #4 重定义为"全链零场外快照依赖"；canonical spec 四条快照 Requirement 走 REMOVED delta、Process-level guards 枚举去掉 pass snapshots
- [x] skip 机制删除（codex 收尾）：骨架每轮 force 重建后 baselineComplete 结构恒 false，"证据齐全即跳过"整链（decideSkipAgentInvoke/completion_evidence_pre_existing/skip_agent_invoke/伪造 skipped invoke）为不可达死代码——删除；completion probe 只保留"观察本轮 agent 把骨架填成完整"（canonical spec 未固化 skip，无 REMOVED delta）
