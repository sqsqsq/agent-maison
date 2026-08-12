# Design — goal-fakepass-hardening

> SSOT：`.cursor/plans/goal-fakepass-hardening_无头假PASS事故链根治_e3a9c5d1.plan.md`（rev6，
> codex 六轮 review 通过）。本文只沉淀 OpenSpec 层需要的三块：信任边界总图、五方冲突矩阵、
> 关键实现决策（无环封装序/文件集 SSOT/状态机）。

## 1. 信任边界总图

事故的本质是"agent 可写的自报产物被当成判定依据"。本 change 把可信链拆为五段，各段
责任边界与诚实边界如下：

| 段 | 机制 | 能证明什么 | 不能证明什么（诚实边界） |
|----|------|-----------|------------------------|
| 需求解释 | flows/checkpoint 三约束 + requirement_ref 验存 + flow_contract receipt | 结构化模型与需求引文可追溯、变更即 stale | AC 集语义完整性（由真人 receipt 收口） |
| 源码快照 | closure attestation + 全树 inventory + 双 fail-safe | review 后产品源码零变更 | 并行 feature 修改会误伤（接受：集成现实应重审） |
| 运行时证据 | 状态迁移证明 + hit-test + 有序链 + anti-replay 签名 + 物证 | trace 走过了声明的屏序与元素 | 模型认知（读图证据仅证输入注入，沿用 critic-loop 表述） |
| 阶段血缘 | phase_closure_fingerprint（inputs+outputs+env）+ 两消费点重算 | closure 时看到/产出的确是这些字节 | 常驻监控（不做 DAG 守护，消费点才判 stale） |
| 完成凭证 | verify-feature-completion 唯一入口 + runner-owned 原件 | 全链 clean_pass 且血缘连续 | 文件防篡改（靠重算否定伪造，非密码学） |
| 授权 | confirmation receipt 统一消费 + 信任锚 | 授权来自预置可信签发方 | 签发侧安全（归 runtime-policy-core） |

fail-closed 总原则：任何一段证据缺失/失配 → 状态封顶（AWAITING_HUMAN_REVIEW /
DEFERRED / FAIL），绝不静默降级为 WARN 后放行——洞 ③④⑤ 的共同形状就是"缺证据被
WARN 吞掉"。

## 2. 五方冲突矩阵（2026-07-13 盘点）

| change | 状态 | 共改面 | 冲突性质与排批 |
|--------|------|--------|---------------|
| critic-loop-hardening | **已落地**（9ad4f2b5，change 未归档） | goal-runner、goal-failure-classifier、check-testing visual 面、summary schema | 非并行冲突，是**基线**：t4 物证/round 身份直接复用其 MAISON_GOAL_RUN_ID/ATTEMPT 与 ledger 先例；failure_kind 新增沿其 classifier 注册模式 |
| layout-oracle-geometry-gates | **已落地**（bb94b73e，change 未归档） | visual-diff-check/capture、layout dump、check-testing、ui-spec schema | 基线：t4b checkpoint 物证与 hit-test 消费其 layout-dump 链（不重复造）；t7 nav 改造落在其 visual_diff_capture 区段之上 |
| runtime-policy-core | 未落地 | check-receipt.ts、goal-runner/status/monitor、harness-runner | **真并行，但仅文件级**。⚠️ 立项时对码修正：其实际 scope=evidence policy 纯函数化+phase 枚举收编（兼容不变式"输出与现状逐一等值"的**纯重构**），其 "receipt" 指阶段回执 policy 档位——**不含带外确认凭证/签发**。plan 与 codex review 曾假定签发归它，与 ground truth 不符；不向纯重构 change 塞凭证密码学。本 change 的 check-receipt 改动收敛为独立函数以缩文件冲突面 |
| goal-mode-unattended-survival | 未落地 | goal-runner.ts、goal-progress.ts、runbook、SKILL | **真并行**。状态枚举（t8）与其终态投影（INTERRUPTED 等）同域：枚举定义单点放共享 types，命名与其对齐后各自消费；实施前核对其 tasks 进度，若其先行则 rebase 其上 |
| feature-track | 未落地 | workflow-loader、harness-runner、confirmation-registry.yaml | **真并行但低烈度**。t8 完成链解析优先消费其 loadFeatureTrack API；其未落地时先用现有 resolveWorkflowSpec 并留单点接缝；confirmation-registry 双方均 append 条目（flow_contract vs change-lite），append-only 合并 |

排批结论：基座（阶段 3）不依赖三个并行方可先行；t10 schema 需与 runtime-policy-core
共评审后冻结；t8 状态枚举与 goal-mode-unattended-survival 对齐命名后实现。

## 3. 关键实现决策

### 3.1 phase-evidence-manifest 无环封装序（固定，不留实现自由度）

1. 所有 reports 与 receipt 正文先完成；
2. receipt 规范化（**排除** `phase_closure_fingerprint` / manifest pointer 字段）后取 hash；
3. 生成独立 `phase-evidence-manifest.json`（inputs + outputs + 规范化 receipt hash），
   manifest **不 hash 自身**；
4. receipt/summary 只保存 manifest 路径 + manifest sha256；
5. verify 侧先重算 manifest 所列物证 hash，再校验 manifest sha256——单向链无环。

### 3.2 evidence 文件集 SSOT

`resolvePhaseEvidenceManifest()` 复用/扩展 `spec-loader.ts` 的 REQUIRED/OPTIONAL 表
（spec-loader.ts:80-88），外加各阶段 outputs 与 t2 源码 inventory 引用。**禁止**在 t8
维护第二张手写文件表——rev4 手写表与 loader 实际读取面不一致的教训。

### 3.3 状态机

```
run 级:   RUNNING → CHAIN_SLICE_COMPLETED | HALTED | DEFERRED | PARTIAL
                  → AWAITING_HUMAN_REVIEW（存在待人工事项时的封顶投影）
preflight: DEFERRED_CAPABILITY_MISSING（强 pixel 意图+缺视觉能力，spec 前）
feature 级: FEATURE_INCOMPLETE → FEATURE_COMPLETED（仅 verify-feature-completion=VALID）
```

clean_pass（逐 phase）= verdict PASS ∧ 无 pending must-review ∧ 无 P0 waiver ∧
无档位钳制封顶 ∧ 非 DEFERRED/PARTIAL/INCOMPLETE ∧ closure 源码血缘一致 ∧
（适用时）flow_contract receipt 有效。

### 3.4 receipt 信任锚（消费侧强制条款）与签发归属修正

receipt 必含 `receipt_id/issuer_id/key_id/alg/payload_schema_version` 并绑定
run_id/feature/action/object_hash/expiry；签名覆盖规范化 payload 全体；验证公钥只取
预置可信 registry 配置，**禁内嵌公钥**；unknown issuer/key/alg 一律 INVALID；MAC 仅限
验证密钥对 agent 不可读的部署形态；支持 rotation/revocation。
回归用例：agent 自生成密钥自签+附内嵌公钥 → INVALID。

**签发归属（立项时修正）**：runtime-policy-core 无凭证 scope（见 §2）。签发落位于
**独立后继 change `confirmation-credential-issuance`**（round7 P0-8 带外确认线，
fidelity-shared.ts:146 自注的"彻底解"），须满足本 spec 的信任锚条款（外部通道、agent
不可自签、可验签名/MAC）。**本 change 的 confirmation-receipts spec 即消费契约 SSOT**，
后继签发方向其对齐。签发落地前无任何 receipt 可通过校验——fail-closed 封顶语义即设计
行为（含 P0 flow/降档/waiver 的 feature 停在 AWAITING_HUMAN_REVIEW），非缺陷。

### 3.4b 状态枚举对齐（任务 1.4 结论）

goal-mode-unattended-survival 新增 `INTERRUPTED`（异常退出终态，写于 run_end 事件）——
与本 change 的成功侧枚举**正交**。合并后 run 级全集：
`RUNNING → CHAIN_SLICE_COMPLETED | HALTED | DEFERRED | PARTIAL | INTERRUPTED`，
`AWAITING_HUMAN_REVIEW` 为封顶投影、`DEFERRED_CAPABILITY_MISSING` 为 preflight 终态；
feature 级 `FEATURE_INCOMPLETE | FEATURE_COMPLETED`。枚举定义单点放共享 types，
两 change 各自消费；无命名冲突，无需互相等待。

### 3.5 事故 fixture

bc-openCard 现场固化为回归夹具（只读引用宿主采样）：fast path trace（缺中间屏）、
10 P0 skip 报告、双格式 md 账本、「完全参考」需求文档 vs manifest 摘要、有条件通过
review 报告、run1-HALTED+run2 截断链 events、手工伪造 completion。每个 P0 门禁至少
一条事故派生用例。
