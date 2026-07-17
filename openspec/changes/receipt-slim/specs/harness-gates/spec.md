# Delta: Harness Gates — receipt 瘦身与 base/patch 时序

## ADDED Requirements

### Requirement: Base summary is receipt-independent and atomic

writeRunSummary MUST 拆为 base 与 closure patch 两段：base summary MUST 不依赖任何 receipt 校验结果、MUST 为完整 schema-valid 快照（next_action 以"未闭环/等待 receipt"初值填充、closure_status=open）、MUST 原子写入；closure patch MUST 只更新 receipt_status/closure_status/next_action，MUST NOT 首建文件。进程在 patch 前中断时，磁盘上 MUST 仍是合法 open 态 summary。

#### Scenario: patch 前崩溃
- **WHEN** base summary 已写、closure patch 未执行时进程终止
- **THEN** summary.json 通过 schema 校验且 closure_status=open，不残留旧 closed 态

> **Enforced by:** `harness/harness-runner.ts`

### Requirement: check-receipt reads current-run base summary

新格式（receipt_schema 2.0）下 check-receipt MUST 以本次 base summary 为唯一机器事实源：MUST 校验 feature/phase 精确匹配、verdict=PASS 且 blocker_count=0、gate_fingerprint 与当前门禁集重算一致；summary 缺失或不可解析 MUST 产 BLOCKER（禁止静默）。

#### Scenario: 旧 PASS summary 冒充
- **WHEN** 本次 harness FAIL（base summary verdict=FAIL）而磁盘存在上次 PASS 的旧 summary
- **THEN** check-receipt 以本次 base 为准判 FAIL；伪造 gate_fingerprint 的旧件因指纹重算不一致被拒

#### Scenario: 他 feature summary 串目录
- **WHEN** receipt 声明 feature=A 而 canonical path 下 summary.feature=B
- **THEN** check-receipt BLOCKER（feature/phase 精确匹配失败）

> **Enforced by:** `harness/scripts/check-receipt.ts`

### Requirement: Slim receipt keeps only non-derivable self-attestation

新模板 MUST 删除 script_harness 镜像块、trace_json 块、self_check q1/q3；MUST 保留 agent 身份、claimed_completion_at/commit_sha、verifier 摘录、反假设 checkbox、testing_run_artifacts。骨架 MUST 仅在 verdict=PASS 且 receipt 缺失时幂等生成，checkbox 全未勾，且 MUST NOT 构成闭环。

#### Scenario: 骨架未签不闭环
- **WHEN** runner 生成瘦身骨架而 agent 未勾反假设 checkbox
- **THEN** check-receipt FAIL，phase 不闭环；agent 补签后 PASS

> **Enforced by:** `harness/templates/phase-completion-receipt.md`, `harness/scripts/check-receipt.ts`

### Requirement: Process-integrity SSOT stays runner-side

新格式下预加载注入检测 SSOT MUST 为 runner 的 runProcessIntegrityPreflight CheckResult（BLOCKER 时 base summary 必 FAIL）；MUST NOT 新增 summary/trace 专用扫描；旧格式 receipt 兼容期 MUST 继续执行 script_harness.command 注入特征校验。

#### Scenario: 直启 harness 预加载注入
- **WHEN** NODE_OPTIONS 携带 --require 预加载启动 harness
- **THEN** process_integrity BLOCKER → base summary FAIL → 闭环不成立（不依赖 receipt 层扫描）

> **Enforced by:** `harness/harness-runner.ts`, `harness/scripts/utils/process-integrity.ts`, `harness/scripts/check-receipt.ts`
