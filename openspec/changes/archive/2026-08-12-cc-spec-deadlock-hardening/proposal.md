## Why

2026-07-17 宿主实测事故（HarmonyOSDemo，claudecode CLI 2.1.212，实际模型 MiniMax-M2.7，goal-mode headless，run 20260717T082925Z）：bc-openCard spec 阶段 5 次 attempt 后 `no_progress_agent_timeout` HALT，且产物被改坏。五环相扣：① spec-i2 harness 全门禁 PASS 仅因 `agent_timeout_unclosed` 被整轮重试，i3 冷启动重写把 `must_have_elements` 写成 `must_have`，PASS 态被毁且无保护；② ui-spec schema screen/componentNode 均 `additionalProperties:true` 静默放行错键，门禁报错文案自写「ui-spec/must_have」教错字段名，affected_files 给 feature 根路径而实读 `spec/ref-elements.yaml`；③ `capture_completeness_external` 在无头下只剩「defer+真人签字」出路却无人可签，agent 依规程记账 `must_review=true` 但重试环不消费账本，按 `code_regression` 盲重试；④ 超时预算不吸取实测（i3 已证完整一遍需 49.6min 且曾获授 67.5min，i4/i5 仍回落 45min）；⑤ halt 文案「连续超时且产物零进展」双分句失实。另有独立实锤：claude adapter 恒注入 `--output-format stream-json`，而 preflight/inline 两条 canary 判卷路径用行锚定 `^KEY=value$` 扫原始输出——NDJSON 信封内答卷永远判不过，叠加「adapter_declared 保守盲档」，真 Claude 宿主被永久锁盲。plan 7c4f2e9b（codex×10 + cursor×3 轮 review 收敛，终审 Approve）。

## What Changes

- **PASS 态冻结（goal-runner）**：`verdict=PASS && advance_blocked` 时按 artifact-class resolver（frozen_deliverable / mutable_closure / mutable_control_plane / derived，消费 phase-evidence-manifest 全部三张产出表 + 视觉二期控制面逐一登记）对 frozen 集做 runner-owned 快照（trust-state 独立命名空间 `pass-snapshots/<phase>/<epoch>/`）；协议域拆分为不可变 `pass_snapshot_manifest` 与可变 `pass_snapshot_head`（仅 active/superseded 两态）；信任分两层（同进程内存 digest 即可恢复 / resume 须 HMAC 验签，未配 HMAC 只 halt 不恢复）；closure-only attempt 改产物 → violation + 按信任层恢复 + `ADVANCE_BLOCKED_HALT_THRESHOLD` 封顶。
- **失效事务（goal-runner）**：run 级全局 invalidation journal（固定路径 `pass-snapshots/invalidation.json`，独立 kind，tx_id/state/cause_phase/invalidated_phases/old_head_hashes/target_generations）；顺序 pending → 全部 heads/tombstones → 幂等 `phase_invalidated` 事件（按 (tx_id,phase) 去重）→ commit；resume 先恢复 journal 再读任何 head；journal 不可验证 → fail-closed halt。
- **canary 结构化归一（作为 visual-capability-truth 的 delta，任务 3.10）**：共享 claude envelope 解析模块（终态 result 白名单：type=result && subtype=success && !is_error && string），preflight 解析 invoke.stdout、inline 解析 agent-events.jsonl，收敛既有 image-read / api-error 解析点。
- **blocker actionability（harness-gates + goal-runner）**：summary blocker 增标量 `actionability`（agent_fixable/human_only/toolchain_blocked），单一注册表纯函数（goal-failure-classifier 就近，复用既有 toolchain 判定）供 summary 映射 / 重试回喂 / 报告三方消费；决策梯唯一插入位（安全终态 → transient API → actionability 聚合 → 内容重试 → closure 路由）；timeout 分流四步（integrity → ∃toolchain → 全 human_only → agent_timeout）；新 halt_reason `await_human_gate_deferral` / `await_operator_toolchain`；human_only 不入 no-progress 签名。
- **ui-spec schema 严格化（harness-gates）**：screen/componentNode `additionalProperties:false` + 未知键 did-you-mean；capture-completeness 文案正名 `must_have_elements`、affected_files 改 `spec/` 实读路径。
- **超时预算与 closure 分类（goal-runner）**：effective = max(base, granted_highwater, 1.2×completed)（completed := agent exit_code===0 && !timed_out，events 重建）；closure_kind 由只读 receipt 探针在 ReceiptValidation 五态全集上 total function 判定（error → closure_probe_error/framework_bug HALT；not_applicable+blocked → closure_state_invariant HALT）；closure-only 预算按 closure_kind 二档。
- **报告诚实化（goal-runner）**：attempt 四正交轴时间线（termination × harness verdict × transition × artifact delta）替换死模板；门禁指引分级（agent 只收产物级动作，framework 内部话术移 `operator_note`）；append-only `adapter_model_observed` telemetry 事件（不写冻结 manifest）。

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `goal-runner`: PASS 快照冻结与 closure-only、invalidation journal 事务、actionability 决策梯与 timeout 四步分流、超时高水位棘轮、closure_kind 探针分类、四轴 attempt 报告、adapter model telemetry。
- `harness-gates`: summary blocker actionability 注册表、ui-spec schema 严格化 + did-you-mean、capture-completeness 文案/路径正名、门禁指引受众分级（operator_note）。

## Impact

- 影响 runtime：`harness/scripts/goal-runner.ts`（快照/journal/决策梯/超时/报告）、`harness/scripts/utils/goal-timeout.ts`、`goal-failure-classifier.ts`（actionability 注册表）、`summary-blockers.ts`、`types.ts`（CheckResult.actionability）、`phase-evidence-manifest.ts`（asset-manifest 补齐 + watched roots）、`goal-report-generator.ts`（四轴/求人引导）、`report-generator.ts`（通用指引文案）、新增 `utils/claude-envelope.ts` 与 `utils/pass-snapshot.ts`。
- 影响 profile：`profiles/hmos-app/harness/capture-completeness-check.ts`（文案/路径/actionability 标注）、`ui-spec-schema-validate.ts`、`harness/schemas/ui-spec.schema.json`、`harness/schemas/summary.schema.json`（actionability + operator_note）。
- 影响 canary：`vision-canary.ts` / `goal-preflight.ts` / `critic-receipt-producer.ts` / goal-headless-sentinel（共享 envelope 模块接入，行为=visual-capability-truth 任务 3.10）。
- 测试：仓内脱敏事故 fixture（`harness/tests/fixtures/cc-spec-deadlock/`），e2e 回放 A（i2 PASS 保全）/ B（合成夹具求人）双轨；决策梯组合、快照信任分层、journal 崩溃窗、跨协议替换、closure 五态矩阵等 unit。
- 兼容：actionability 缺省 agent_fixable（未标注 blocker 行为不变）；schema 收紧前对存量合法键全库盘点登记；head/manifest/journal 为新增文件不影响既有 vision checkpoint 链。
