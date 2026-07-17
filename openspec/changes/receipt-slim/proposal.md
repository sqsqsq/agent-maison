# receipt-slim — 阶段回执瘦身与 base/patch 时序拆环

## Why

plan e6a3c9f4 t2（07-16 四轮外部 review 定稿）：phase-completion-receipt.md 含机器可派生内容——`script_harness` 块是 summary.json 的手抄镜像，self_check q1 重复 trace_json.path、q3 现状只查非占位路径无真 diff 对账。AI 手填徒增 token 与手误面，且"手抄镜像"本身构成半真凭证攻击面（抄对了≠跑过了）。同时坐实执行依赖环：`tryValidateReceipt`（harness-runner.ts:693）先于 `writeRunSummary`（:704）执行、summary 又内嵌 `receipt_status`（:834）——check-receipt 以 summary 为事实源时可能读到**上次 PASS 的旧 summary**。

## What Changes

- **t1 receipt 契约瘦身**：模板与 check-receipt 删除 `script_harness` 镜像块与 self_check q1/q3；receipt 只保留机器不可替代自证——agent 身份（agent_model/runtime）、claimed_completion_at/commit_sha、verifier verdict 摘录（q2）、反假设三 checkbox、testing_run_artifacts。check-receipt 直读 summary.json 作唯一机器事实源。
- **t2 base/patch 时序拆环**：writeRunSummary 拆两段——①base summary（无 receipt 依赖：feature/phase/verdict/blocker_count/gate_fingerprint/next_action 初值"未闭环/等待 receipt"+closure_status=open，**完整 schema-valid、原子写**）先落盘；②PASS 且 receipt 缺失时生成瘦身版骨架；③check-receipt 读本次 base summary；④closure patch 只更新 receipt_status/closure_status/next_action，不首建。进程中途崩溃不得留非法 JSON 或残留旧 closed 态。
- **t3 对账强度**：check-receipt 对 summary 须校验 feature/phase 精确匹配 + verdict=PASS 且 blocker_count=0 + gate_fingerprint 新鲜且属当前 run；summary 缺失不得静默忽略；canonical report path 按 feature/phase 解析。
- **t4 process-integrity SSOT 定案**：旧格式兼容期继续校验 `script_harness.command` 注入特征；新瘦身格式以 runner 侧 `runProcessIntegrityPreflight`（harness-runner.ts:566，结果天然进 checks→script-report→FAIL summary）产出的 process_integrity CheckResult 为 SSOT；**不新增 summary/trace 专用扫描**；保留直启 harness 预加载注入与 goal 继承注入两类攻击回归测试。
- **t5 兼容**：check-receipt 双格式过渡（旧格式照旧全量校验；新模板只产瘦身版）；evidence-manifest 的 receipt 规范化哈希/无环封装序零变化；Stop hook 快照消费语义不变。

显式非目标：trace.json 契约（不动）；evidence-manifest/closure-attestation 架构（不动）；receipt 骨架的自动签署（骨架永不构成闭环）。

## Capabilities

### Modified Capabilities

- `harness-gates`：check-receipt 契约（瘦身字段集、summary 直读对账、双格式兼容）；writeRunSummary base/patch 两段化。
- `feature-artifact-layout`：phase-completion-receipt.md 模板字段集变更（瘦身版）；summary.json closure 字段的 patch 语义。
