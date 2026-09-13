## 1. 分层完成与来源

- [x] 1.1 完成记录版本、范围指纹与 P1 需求/P0 来源对齐；保留真实血缘验证。
- [x] 1.2 CU expected execution/handoff 与 Component 目标覆盖同源，补组合用例。

## 2. 兼容与默认

- [x] 2.1 旧 run 版本读取、恢复与坏新记录拒绝；不改历史。
- [x] 2.2 切换新默认，退役公共 change-lite/exit，接通既有 adapter UPDATE 清理。
- [x] 2.3 更新现行入口、README、MIGRATION 与消费者交接说明。

## 3. 验收与交接

- [x] 3.1 typecheck、定向及 harness 全量、OpenSpec/plan/diff 校验；复用有效已有结果。
- [x] 3.2 候选发布件临时 consumer 验证与 npm run release:verify；不正式发布。
- [ ] 3.3 使用实际宿主材料验证 RDB/页面/多 CU/专项/恢复；缺资料保留未完成。
- [ ] 3.4 汇总发布交接与剩余条件；正式 release:all 仅在实际发版指令到来时执行。

## 实施记录（2026-09-12 至 2026-09-13）

- P6 已按批准范围提交为 32b12288；P7 实现及两项返修经用户复核通过，纳入本次提交，真实宿主与发布交接仍未完成。
- completion 1.2 增加必填 execution_scope_fingerprint，并独立核对 P2 出生范围；原件、run/attempt/events 血缘仍保留。旧 1.1 按旧合同读取，调用期候选不能替代出生证明。需求聚合与 P0 判断复用实际绑定内容，不依赖叙述文档或验收文件必须物化。
- CU expected execution、handoff 与状态展示复用同一范围来源。现代 CU 消费现有目标/提供/设计映射检查；有 Feature 执行证明但映射缺失仍不能 credit CU。Component 输入及验收义务经既有 P2→P1 来源读取，组合证据责任不因阶段缩减而消失。
- 新默认为 obligation-driven 1.2；旧 spec-driven 定义只用于兼容。旧运行依据冻结链恢复，调和、进度和 Skill 路径不依赖已退役公共桥接。change-lite 移至 skills/legacy；公共索引、commands/bridge 与选择确认点已清理，UPDATE 沿原备份路径处理，不改历史运行。
- 已更新 README、overview、MIGRATION、共享入口与配置默认/UPDATE 接线；原 P7 计划正文保持不变，仅更新 todo 状态。
- 定向验证：execution-scope 26/26（真实 prepare/attach、三阶段完成、缺映射拒绝、同蓝图两个不同 scope 的真实 CU run、组合义务、successor 及恢复）；旧运行 runtime 18/18；CU adapter 91/91；Component closure 40/40；蓝图输入 22/22；request-entry 15/15。七类 adapter 的退役桥接先备份再清理，运行历史保持原字节。
- 全量迁移首轮 4360/4480，主要失败为旧协议夹具未声明旧 workflow，以及版本读取接线。补齐版本声明与对应接线后，下一轮 4479/4482；剩余三项来自旧 CU adapter 不应额外读取新设计输入，已限定到现代范围并补验 91/91 与 26/26。fixtures 46/46，typecheck、OpenSpec 45/45、plan、diff/LF 通过。最终再次执行 cd harness && npm test 全通过：4482/4482 单测、46/46 fixtures（含 typecheck）。最终日志为 harness/reports/p7-harness-final-gate.log；当前代码未再变更。
- 最终候选：harness/reports/p7-candidate-final/framework-3.1.0.zip，SHA-256 1fca968186b33278c6d52bd4900f2928634f7bdc872b13dc53a20cb2bbd7fff8。release:verify 对同一 zip 全通过；仅按既有 candidate 模式跳过最终发布 plan 完成门禁，未运行 promote 或正式 release:all。
- 同一最终 zip 的 consumer lifecycle 全通过：8 条实际 stage 覆盖、1 条已登记退役、无待实现项。安装依赖仅在临时 consumer 的 framework/harness；包含 CRLF checkout、真实 UPDATE、恢复/回退及旧运行检查。日志：harness/reports/p7-consumer-final.log。
- 最终 candidate 的独立 review 经真实 prepare→facts/report→check CLI 通过；Feature 证据树与阶段状态字节不变。该 smoke 使用受控小样本，日志为 harness/reports/p7-candidate-request.log；不能当作真实业务审查或设备验收。

## 旧 run 恢复返修（2026-09-13）

- 仅修复本轮两项意见：P2 输入桥接保留既有 goalRunId，P1 输入解析按该 run 的 workflowForExistingRun 选择兼容协议；receipt 探针按传入 runId 读取冻结 track，真实 check-receipt 子进程复用同一兼容 workflow。
- 现有测试补齐真实出生后的旧 lite/full coding 输入解析、候选改为 full/移除 track 后的旧 lite 探针及真实 receipt CLI；同时验证无 run 身份的新调用缺少输入上下文仍拒绝、现代 scope 不受候选 lite 干扰且不能调用 exit。
- 本轮定向 50/50；最终执行 cd harness && npm test 全通过：4484/4484 单测、46/46 fixtures（含 typecheck）。日志为 harness/reports/p7-recovery-repair-gate.log。OpenSpec 45/45、plan、diff 与本轮文件 LF 检查通过；生产代码未在门禁后再变更。
- 上述候选 zip 和 consumer 日志属于本次返修前版本，不含这两处修复；发布交接前需要刷新候选。本次不重打包、不宣称真实宿主验收通过，未改计划正文或扩大实现范围。

## 未完成的真实宿主与交接条件

本轮已询问真实 App 工程和可复用材料，尚未收到路径/材料/设备信息。因此真实 RDB、页面交互、性能分层、多 CU 组合及设备验证未执行；临时 consumer 和模拟原生边界均不计真实宿主通过。需提供宿主路径、原请求、适用的蓝图/CU/acceptance、代码/测试目标、已有报告以及设备条件，才能继续 p7-real-host。p7-release-handoff 与父总纲最终整合复核保持未完成；当前候选不是正式发布件。
