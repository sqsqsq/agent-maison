## Context

Maison 的 testing 产物链已有 derive manifest、Hylyre trace、报告、summary、quality axes 和 repair candidates，但旧门禁把「应当验证什么」与「实际执行证据」混在计划/状态/临时 telemetry 中。Hylyre 冻结后的 `CaseResult.execution|verification|evidence` 与 `CaseResult.steps[]` 提供了唯一可消费的执行证据；Maison 只负责 acceptance/checkpoint coverage 与发布质量轴的裁决。

本设计受三个边界约束：不新建 sidecar/selector ledger/assertion registry/第二套 case 状态；不从日志重建 StepResult；不把 coverage 或 quality axes 下推给 Hylyre；T1/T3/T4/T5/T6 必须由版本、schema、字段三重判据门控。

## Goals / Non-Goals

**Goals:**

- 以 trace 中的 `cases[].steps[]` 作为唯一执行 evidence，保留既有 report/summary/quality axes/repair candidates 载体。
- 用计划 checkpoint requirements 对账 `CaseResult` 三轴及 StepResult `role/status`，同时覆盖 required 与 forbidden absence assertion。
- 复用现有 selector contract、derive/index/scope/within/all、failure routing、summary writer 和 phase retry/backtrack 通路。
- 在不触发设备或执行器的情况下完整重算报告消费结果，并保持 authoritative trace 字节不变。

**Non-Goals:**

- 不修改 Hylyre 本体，不实现 OCR、坐标估算、运行时 exact→contains 或 layout oracle/NFR provider。
- 不新增 phase、sidecar、ledger、registry、状态机或宿主真机回灌；不改 goal 发布权责、UT/attestation、verifier 证据链。

## Decisions

1. **证据单源。** `CaseResult.steps[]` 是 execution/verification/evidence 的落点；`tool_calls` 和 Markdown 仅为兼容投影，不能反向生成 StepResult。若原生 StepResult 在场，Maison 不消费旧 telemetry 作为替代；双在场时原生结果裁决，不一致只产生告警。
2. **coverage 留在 Maison。** Hylyre 只提供冻结三轴、StepResult role/status、selector/evidence 与 failure 分类。Maison 根据 acceptance/checkpoint 的 required/forbidden element ids 计算 coverage、quality axes 和 release verdict；action-only 或 expected 未检查不自动成为 acceptance pass。
3. **三重判据划界。** 版本从既有 `hylyre-ready.meta.json → release.manifest.json → manifest.hylyre_version` 链消费，同时验证 trace schema 与字段实际在场。任一不满足时，旧状态不能单独贡献 passed；只有既有 telemetry 完整绑定并实际证明的特定 checkpoint 才可作有限 legacy evidence。
4. **selector 两层门。** 静态授权只看 canonical ui-spec 节点集：exact 精确等值，contains 必须唯一映射或有既有消歧键；dump/cache 只能给 derive 建议或 WARN。运行期只消费 Hylyre StepResult 的 candidate count/实际消歧，不在 Maison 自动放宽 selector。
5. **报告重算复用现有链。** `--report-reconcile-only` 读取最终 trace、report、timing 和 build/install/run meta，先用现有路径、HAP 内容指纹、时间戳、feature、精确 case 集合、pipeline reused/阶段耗时与报告逐 case 耗时闭合同一最终 run，再调用现有 report/static checks 与 summary writer 完整重算；报告耗时统一采用精确整数毫秒 `Nms`（读取侧兼容合法千分位），禁止局部 patch 旧 summary、执行 provider/hook 或写新 evidence 载体。

## Risks / Trade-offs

- [Risk] 升级前的历史通过率会下降。→ 明确标记 `legacy_assertion_evidence_untrusted`，提示升级 Hylyre 后重跑，不修改历史文件。
- [Risk] 旧 telemetry 与原生步骤证据短期并存。→ 原生优先、有限字段校验与一致性 WARN，完成迁移后删除 monkey-patch。
- [Risk] 无 StepResult 的 explicit skip 无法机器归因。→ 保持 testing FAIL；只有已有 capability resolution 给出机器事实时才 defer，避免猜测 coding。
- [Risk] report-only 复用错误的最终轮元数据会污染报告。→ 读取最终 build/install/run meta 和最终 `device-test-timing`，并由规则测试禁止首轮数据回填。
