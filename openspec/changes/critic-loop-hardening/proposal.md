## Why

c6d8f2b4（layout-oracle）落地后，"防止相信假分数"已可靠，但"模型自动看图→发现→修→收敛"的闭环仍是 SSOT 承诺+agent 自觉，不是机器保证。codex 置信度评估（2026-07-11）+ 三方 review 六轮对账（plan f7a3d9c2 rev6）确认五缺口：G1 熔断粒度（goal 既有 shouldHaltNoProgress 是 blocker-id 粗粒度、交互态无机器熔断）；G2 verified 回执无生产者（agent-output.log 无工具事件且 stdout/stderr 混流）；G3 T8 发现→回修链路无对账（LayoutFinding 无 finding_id/elements、defect 无溯源、must_fix 无逐条锚点）；G4 采集非原子且整图 hash 恒等真机恒假；G5 校准与人工反馈无落账通道。

## What Changes

- **结构化发现（t0）**：LayoutFinding 新增 `finding_id`（emit 时定稿的稳定 id）与 `elements[]`；B 类补 bbox；defect 新增 `source{producer,finding_id,signal}` 与 `must_fix_refs[]`；check 附进程内结构化 payload（不进 summary blocker schema）。
- **转录对账门禁（t2）**：`visual_diff_finding_transcription`——T8 hard 未转录（finding_id 主判据/elements+signal 次判据/bbox IoU≥0.5 回退）→ pixel_1to1 BLOCKER 附模板；must_fix 逐条锚定（每条须被 ≥1 defect 的 must_fix_refs 引用）；candidate-pass 无论有无 attest 均须结构合法回执，回执覆盖范围扩到全部 candidate P0 finalized 屏。
- **轮次账本与指纹熔断（t1）**：`visual-rounds.ledger.jsonl`（telemetry 侧车，runner 写 check 读）；state/round 二维模型（base_state_hash 排除 fuse 自身；round_key 含跨 resume 单调的 attempt_id）；duplicate 重放持久化 decision；fuse=两有效轮指纹集非空相等 + awaitHumanOnly=false + actionable residual（结构化谓词）；归因 no_fix_attempt/ineffective_fix；新 failure_kind `no_progress_fuse` 首触即 halt；events↔ledger integrity 反向对账。
- **证据源契约与回执生产（t3）**：adapter `tool_event_provenance` 声明；structured_events 三文件分流（agent-events.jsonl/agent-stderr.log/agent-output.log 投影）；goal-runner 审计验读事件后签发 runner attestation 回执（verified 唯一合法来源；最低输入集=全部 finalized 屏截图+crops）；无合格 adapter 恒 unverified。
- **静稳采样（t4，两段）**：t4a observe-only 共享采样器（shot₁→dump₁→dump₂→shot₂，app 裁剪 hash+布局签名双稳，unstable_reason 记录），正式链不变；t4b 待 t5⑨ 真机数据回填后一次性启用（unstable 独立 id `visual_diff_layout_invariants_unstable`=capability degradation，不进 candidate-blocking、免转录）。
- **校准与回灌（t5/t6）**：`layout-oracle-calibrate` CLI（calibration.json SSOT + md 投影，九项含 appRoot 稳定性/bounds 语义素材/locator 歧义/双拍实测）；visual-confirm CLI 事务化落账 `review-feedback.ledger.jsonl`（journal 崩溃恢复+feedback_id 幂等+snapshot 一致性+--overrule）；FP 按 signal、FN 默认 unattributed+issue_kind 映射——升档评审的数据素材，非机制化升档。

显式非目标：循环状态机/独立上下文 critic phase（后继 change）；交互态 verified 回执；A/B/C 档位变更；交互态同状态重跑的自动熔断（无 attempt 身份，诚实收窄）。

## Capabilities

### New Capabilities

None（扩展既有 visual-diff 与 goal-runner 能力面）。

### Modified Capabilities

- `visual-diff`: 结构化发现字段、转录对账门禁、轮次账本与 no_progress_fuse、回执 candidate 路径触发与 runner attestation 校验、静稳采样（observe-only）、校准 CLI 与回灌台账。
- `goal-runner`: no_progress_fuse halt 分类、MAISON_GOAL_RUN_ID/ATTEMPT 轮次身份管道（attempt 跨 resume 单调）、summary.visual_round 显式 schema 字段、events↔ledger integrity 对账、runner attestation 回执生产。

## Impact

- schema：`summary.schema.json` 新可选 `visual_round`；`visual-diff.json` defects 新可选 `source`/`must_fix_refs`；新侧车 `visual-rounds.ledger.jsonl`、`review-feedback.ledger.jsonl`、`calibration.json`（均 features 目录，telemetry/标注性质，非判定文件——tamper-scan 红线外）。
- runtime：`harness/scripts/utils/{visual-rounds-ledger,review-feedback-ledger,critic-receipt-producer,goal-failure-classifier,goal-runner-phase,agent-invoke,goal-adapter-capability}.ts`、`harness/{harness-runner,scripts/visual-confirm,scripts/layout-oracle-calibrate}.ts`、`profiles/hmos-app/harness/{layout-oracle-check,visual-diff-check,quiescence-sampling,layout-oracle-calibrate}.ts`。
- 文档：`docs/operations/adapter-tool-event-provenance.md`（证据源盘点 SSOT）；`skills/reference/device-testing-workflow-detail.md`（熔断信号消费/同状态重跑禁令/CLI 落账协议）；OpenSpec layout-oracle-geometry-gates 的 5.4 只**半关**（verified 回执生产侧关闭，独立 critic phase 侧 open）。
