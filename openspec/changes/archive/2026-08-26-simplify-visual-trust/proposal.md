## Why

Maison 把“模型能否看图”“产物是否可信”“跨轮策略降级”耦合成了持久化信任系统。实际宿主运行证明，这套系统会让一个尚未完成证明的 `ui-spec.yaml` 反向抹掉已经实测通过的视觉能力，并关闭下一轮重新证明的入口；复杂度没有提高交付质量，反而制造自锁、误诊和不可恢复失败。

## What Changes

- **BREAKING**：视觉路由只消费本次 run/invocation 的模型能力事实；产物证明、历史降级和账本状态不得参与 `hasVision`、fidelity clamp 或 prompt 能力声明。
- **BREAKING**：退役 `artifact-attestations.jsonl`、`policy-downgrades.jsonl` 及其 supersede、迁移、hash-chain、checkpoint/head/HWM 保护链；旧文件保留在宿主盘上但不再读取、写入或要求迁移。
- 保留当次 capability receipt 与 reference-read receipt；`vl_multimodal` 只依据当前 invocation 的两份 runner 回执及当次反证检查判定。
- `vision_output_counterevidence` 保持无状态：冲突直接 FAIL，证据缺口直接 WARN；不再把检查结果写成跨轮策略状态。
- requirement hash 仅绑定用户输入和初始化时已存在的显式需求源，不再吸收 spec 运行中创建的目标产物；明确排除 feature 自身 `ux-reference` 生成文档。
- retry 在 summary 缺失或解析前失败时直接携带本轮 harness 错误摘要，避免把产物语法错误泛化成 `code_regression`。
- agent 产出的 `contracts.yaml`、`acceptance.yaml`、`use-cases.yaml` 即使 YAML 语法损坏，也在本轮转成结构化 `feature_spec_shape` FAIL，不再让 harness 以 exit 2 提前死亡。
- ui-spec schema 收编框架盲档工作法实际使用的 token 占位来源和 asset fallback 说明字段，消除“框架教写、框架又判非法”的噪音。
- capability prompt 明确区分 `selected_fidelity` 与 `effective_fidelity`，`fidelity_target` 始终投影 selected，避免 agent 按 clamp 值改写需求合同。

## Capabilities

### New Capabilities

- `visual-capability-routing`: 定义只依赖当前调用事实的最小视觉能力模型，以及当前调用内的无状态产物校验。

### Modified Capabilities

- `goal-runner`: 删除视觉账本控制面和策略反向致盲，修正 retry 错误传递与 fidelity prompt 契约。
- `feature-artifact-layout`: 视觉运行产物收缩为当前 capability/reference receipts，不再要求 append-only attestation/policy ledgers。
- `harness-gates`: 视觉反证门禁改为无状态判定，最终多模态签名不再依赖历史 attestation 账本。

## Impact

- 主要影响 `harness/scripts/goal-runner.ts`、`goal-preflight.ts`、`effective-vision-context.ts`、`check-spec.ts`、hmos profile 视觉门禁及相关单测。
- 消费者无需手工迁移；旧视觉账本会成为无人消费的遗留文件，可选择删除。`MIGRATION.md` 需说明旧账本不再参与路由或恢复。
- 当前未归档的 `visual-capability-truth` 变更中与三轴 fail-closed meet、跨轮账本和 trust-anchor 相关的未完成任务将被本变更取代，不再继续加固。
