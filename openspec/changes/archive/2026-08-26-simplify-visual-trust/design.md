## Context

当前视觉链同时维护 capability receipt、reference receipt、artifact attestation、policy downgrade、supersede、两份 hash-chain ledger，以及围绕 ledger 的 checkpoint/head/HWM。路由初始化又把 `effective_policy` 合入 `hasVision`，导致“产物未证明”被解释成“模型不能看图”。bc-openCard 运行证明这不是边缘情况：首轮产物只要在 gate 之前解析失败，下一轮就被永久送入 blind 路径。

## Goals / Non-Goals

**Goals:**

- 把视觉路由还原成一个布尔事实：当前 run/invocation 是否有可信图像输入能力。
- 把产物质量还原成当次检查结果，不跨 attempt 建状态机。
- 删除视觉账本及其保护、迁移、恢复代码，而不是为自锁增加新豁免。
- 让 requirement identity 在一次 spec 执行期间稳定。
- 让 retry 直接看到本轮 harness 的真实致命错误。

**Non-Goals:**

- 不降低 `vision_output_counterevidence`、capture completeness、schema、fidelity intent 等内容质量门禁。
- 不删除通用 goal checkpoint、pass snapshot、manifest identity、source mutation protection；这些不是视觉自锁的必要组成。
- 不自动删除消费者磁盘上的旧 ledger 文件；停止消费即可完成兼容迁移。

## Decisions

### 1. 能力与产物完全单向

`hasVision` 仅由 adapter image-input probe 与当前 run/invocation canary receipt 得出。`ui-spec.yaml` 是否存在、是否 verified、是否有文本缺证，均不得改变 capability snapshot、prompt Vision 或 fidelity clamp。

替代方案是给 `blind_safe` 增加“重试豁免”或“可重新签发”状态；拒绝该方案，因为它保留循环依赖和跨轮状态机。

### 2. 删除视觉状态账本，保留当前调用回执

保留：

- `vision/capability-receipt.json`：证明当前调用能看图；
- `vision/spec-refs-receipt.json`：证明当前调用实际读取了哪些参考图。

删除：

- `artifact-attestations.jsonl`；
- `policy-downgrades.jsonl`；
- supersede、legacy migration、ledger hash chain；
- goal-runner 对上述文件的 anchor、tamper、checkpoint/head/HWM 维护。

最终 `vl_multimodal` 判定直接合取“当前 capability receipt 有效、当前 refs receipt 完整、当次 counterevidence 无 contradiction”。evidence gap 保持 WARN，不产生持久化副作用。

### 3. requirement hash 使用冻结输入集

哈希包含 manifest 内联 requirement，以及初始化时已经存在且被明确引用的需求源文件。位于当前 feature 输出目录下、在 requirement 中作为交付目标出现的路径不解引用；`ux-reference` 生成文档不计入 requirement identity。参考图片集合继续由专门的 reference receipt/gate 绑定，不混入 requirement 文本身份。

### 4. selected/effective 两个字段在 prompt 中明确命名

`fidelity_target` 投影 `selected_fidelity`；`effective_fidelity` 只描述当前执行上限。agent 不得把 clamp 结果回写为需求档位。这样门禁和 prompt 使用同一词义，不再靠括号解释。

### 5. retry 从本轮 detach 输出提取小段错误

当 harness 没生成可读 summary 时，runner 从本轮 harness 起止位置提取最后一段非空 stderr/log，限制长度后直接放入 `priorFailure`，并归为 artifact/gate failure；不新增错误数据库或第二套分类器。

### 6. agent YAML 语法错误在 loader 边界降为结构化失败

`SpecLoader` 对 feature 根的 `contracts.yaml`、`acceptance.yaml`、`use-cases.yaml` 统一捕获 YAML 解析异常，把文件名、错误码与行列写入现有 `shape_issues`，并将该文件按不可用处理。这样同轮仍能生成 summary，复用既有 `feature_spec_shape` BLOCKER，不再依赖下一 attempt 的 fatal-output 补救。

### 7. schema 接受盲档工作法的诚实占位元数据

token 允许 `placeholder:boolean` 与 `value_source:string`；asset 允许 `blind_fallback_reason:string`，并允许未获授权时 `crop_confirmed_by:null`。这些字段只描述占位/未确认事实，不构成视觉证明或裁剪授权。其他宿主自造字段继续由 strict schema 拒绝。

## Risks / Trade-offs

- [旧账本不再提供跨轮反篡改] → 视觉产物仍由当前 schema、refs receipt、counterevidence 和最终 gate 验证；删除的是会影响未来路由的持久状态，不是内容校验。
- [非结构化 adapter 无法签 `vl_multimodal`] → 如实保持 unverified/WARN；能力探测仍可让模型继续读图并修产物，不再因此自锁。
- [删除 goal-runner 账本分支可能影响恢复测试] → 用目标单测锁定“当前 capability 可重复证明、旧 ledger 完全无影响”，再跑全量 harness。

## Migration Plan

1. 先让所有路由和 gate 停止消费两份 ledger。
2. 删除 ledger 写入、anchor、迁移和 checkpoint/head/HWM 分支。
3. 收缩 `effective-vision-context.ts` 为当前 capability receipt 解析器；保留文件名以减少消费者升级成本。
4. 更新规格、技能说明、MIGRATION.md 与测试。
5. 旧宿主无需清理即可运行；可选删除 `<feature>/vision/*attestations*.jsonl` 与 `policy-downgrades.jsonl`。

回滚仅需恢复上一 framework；旧 ledger 未被自动删除，因此不存在数据迁移回滚。

## Open Questions

无。若未来确需跨轮产物信誉，应先证明当次无状态 gate 无法满足，再以独立功能提案评估；本变更不预留扩展状态机。
