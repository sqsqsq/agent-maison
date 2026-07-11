## 1. 结构化发现（t0）

- [x] 1.1 LayoutFinding finding_id/elements（emit 定稿、桶稳定）+ B 类 bbox
- [x] 1.2 VisualDiffDefect source/must_fix_refs + schema 校验
- [x] 1.3 CheckResult.structured 进程内 payload（不进 summary blocker schema）+ normRectsOverlap 导出

## 2. 转录对账（t2）

- [x] 2.1 visual_diff_finding_transcription：finding_id 主判据/elements 次判据/bbox IoU≥0.5 回退 + hard BLOCKER 附模板 + warn 落账提醒
- [x] 2.2 must_fix 逐条锚定（must_fix_refs 引用，filler defects 不作数）
- [x] 2.3 回执窄缝收口：candidate 路径活跃即必需回执 + 覆盖扩全 P0 finalized 屏

## 3. 轮次账本与熔断（t1）

- [x] 3.1 visual-rounds-ledger 模块（base_state_hash/round_key/canonical row_hash/decision 持久化与重放/integrity 对账）
- [x] 3.2 check 侧：ledger 评估 + actionable 谓词 + awaitHumanOnly 优先 + fuse BLOCKER（仅 pixel_1to1）+ failure_kind
- [x] 3.3 runner 侧：check 后追加 + summary.visual_round 显式 schema 字段
- [x] 3.4 goal-runner：MAISON_GOAL_RUN_ID/ATTEMPT 注入（attempt=events 回放序数，跨 resume 单调）+ no_progress_fuse 首触 halt + visual_round 事件 + gate/resume integrity 对账
- [x] 3.5 单测全矩阵（去重重放/跨 attempt 熔断/resume 身份/交互态收窄/integrity 删行改行/损坏行）+ fuse e2e（duplicate 重放外层可见）

## 4. 证据源与回执（t3）

- [x] 4.1 adapter tool_event_provenance 声明 + agent-invoke 三文件分流
- [x] 4.2 证据源盘点文档 docs/operations/adapter-tool-event-provenance.md
- [x] 4.3 critic-receipt-producer（claude structured_events 解析器 + runner attestation + unread 清单 + 无解析器降级）
- [x] 4.4 check 侧 attestation 校验（手写 verified 降级 → attestation 通过解锁 candidate-pass(verified)）
- [x] 4.5 宿主复验（claude 侧完成 2026-07-11）：真实 stream-json 样本采集固化（含 tool_use/Read）+ 解析器真实 fixture 用例 + adapter.yaml 声明回填 structured_events + claudeArgv 按声明加 flags + 断流哨兵结构化信封适配（401 不误归 transient）。余：chrys/codex 事件粒度实测（恒 unverified 现状不变，不阻塞）

## 5. 静稳采样（t4）

- [x] 5.1 t4a observe-only 共享采样器（双 shot 双 dump/app 裁剪 hash/布局签名/approot identity/unstable_reason）+ 三态单测
- [x] 5.2 t4b（完成门槛=t5⑨ 真机数据，2026-07-11 bc-openCard 8 屏实测回填：app 裁剪判据 8/8 稳 vs 整图 5/8 漂移、动效屏 3 组收敛）：正式链接入（quiescenceSampling 仅 pixel_1to1 装配）+ unstable 独立 id 降档（免转录/不阻断 candidate）+ 重试参数定稿（默认 2）

## 6. 校准与回灌（t5/t6）

- [x] 6.1 layout-oracle-calibrate CLI（offline 九项 + --device 双拍实测/redump）+ calibration.json SSOT + md 投影
- [x] 6.2 review-feedback-ledger（journal 事务/feedback_id 幂等/reconciliation/FP-FN 聚合）
- [x] 6.3 visual-confirm 事务化 y/f + --overrule + snapshot 一致性 + human_issue_kind
- [ ] 6.4 宿主复验：校准已执行（2026-07-11 offline+device 双模式，calibration.json 在案）；故意打回/overrule 落账演示待真人 TTY（t9 合并）

## 7. 守恒与文档（t6b/t7）

- [x] 7.1 守恒回归：semantic_layout 零 fuse/零回执强制/actionable=false；ui_change=none 零结果；锚定门禁 pixel_1to1-only
- [x] 7.2 OpenSpec change 本体（proposal + specs/visual-diff + specs/goal-runner + tasks）
- [x] 7.3 summary.schema.json visual_round 显式字段
- [x] 7.4 SSOT 同步（device-testing-workflow-detail：熔断信号消费/同状态重跑禁令/CLI 落账协议；goal 文档：no_progress_fuse 语义）
- [x] 7.5 layout-oracle-geometry-gates 5.4 标注半关 + 校准报告 §4 诚实边界更新
