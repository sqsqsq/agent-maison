## Why

P1 已能产出可稳定寻址、可调和的 App 部件蓝图，P2 已能把获准设计切片落实为 Change Unit 并沿现有 Goal Mode 连续推进；但多个 CU 各自完成仍不能证明目标、跨视图设计、运行时数据流、迁移、NFR 与组合行为已经完整组装。P3 需要建立可重建、不可自报的 Component closure，机械暴露剩余缺口，同时不越权宣称跨部件能力完成。

## What Changes

- 新增 `component-closure@1` 派生投影与确定性路径 `<features_dir>/<blueprint_id>/blueprint/component-closure.yaml`（2026-08-21 M5A 修订：随蓝图归入演进工作区，以 `blueprint_id` 为键，原 `blueprint/component/<component_id>/` 根路径废止硬切），绑定一份精确的 `component_blueprint_ref`、canonical CU 集、派生 Feature identity、四态 completion observation、carry-forward verdict、施工映射和现有证据；既有 CLI 的 `--write` 入口按 evaluate→原子写 YAML→raw hash→派生 Markdown→重校验生成首份产物，投影可删除重建，不是完成台账或恢复权威。
- 收紧 P1 discovery traceability：在既有 `discovery.inputs` 内形成 current-scope 稳定输入清单，当前范围的原始需求、目标、不变量和高风险必须以稳定 ID、可解析来源及蓝图稳定地址映射与该清单一一闭合；只有输入清单及其 source/provenance/revision/hash 进入 `source_fingerprint`，设计映射由 blueprint revision/`artifact_sha256` 和 P3 `input_fingerprint` 捕获，不新增 fingerprint。P3 不建设通用 PRD 解析器或来源注册表。
- 从蓝图与 CU 契约机械派生 coverage obligations，覆盖需求/目标谓词、不变量、高风险、设计决策、适用 4+1 视图节点、跨视图关系、关键 scenario、外部契约、迁移/NFR、requires/provides、临时资产去留和宿主演进接缝；作者不能用自报布尔值减少义务。
- 建立从 obligation 到 owner CU/组合 owner、Feature plan/contracts/实现、适当验证层级、可信 evidence identity 与实际结果的机械派生；YAML 只物化完整 row，checker 逐字段重算，无法唯一派生时返回上游修复，不允许 closure 作者补选。
- 逐边重建 runtime 数据闭环，验证 trigger、initial load、state owner、mutation、publication/invalidation、subscription、consumer/UI refresh、failure/recovery 的施工 owner、传播闭合和分层证据；CU 单独全绿但组合后断链仍失败。
- 复用 P2 exact dependencies、completion verifier 和 carry-forward：只有合法 canonical CU、有效设计引用与可信 completion/carry-forward 才参与 closure；孤儿 Feature、无蓝图 CU、自报 done、STALE/INVALID 证据或悬空 provide 不能放行。
- 冻结 P1 `human_decision: establish_seam|keep_direct`，P2/P3 只对 `establish_seam` 执行纵切、Provider 与四项接缝验证；`keep_direct` 保留再提取条件但不被接缝门误挡。
- 输出确定性 closure verdict 与结构化 gap/frontier，定位 obligation、稳定设计地址、owner、证据缺口、责任方和修复路由；最终裁决由聚合规则产生，任何单一验证 provider 不得自行宣布 PASS。
- 证据 provider 只通过 provider-neutral observation 协议报告稳定内核预先选定、按 obligation 区分并经既有 verifier 复核的精确 evidence identity；文件、symbol 与 hash 只形成待验证 identity，只有同 Feature/phase 的 canonical `script-report.json` 存在精确 PASS check、绑定同一文件，并处于 fresh phase-evidence-manifest/receipt/completion 链内时才能成为 current observation。同 Feature 的任意 observation、completion hash、截图文件名或布尔值不能覆盖其它义务。canonical input enumeration 属于稳定内核，不是可替换 Provider；required 缺失形成 blocker，optional 缺失诚实降级，重复权威或冲突 fail-closed。
- 稳定知识只以可解析引用证明已归位到 architecture/catalog/conventions/spec/scenarios/ADR 等既有真源；closure 不复制其正文，也不修改 P1 蓝图、P2 ready set、Goal Mode events/receipt/evidence 或 P3 之外的状态。
- 增加正反 fixtures，覆盖原始来源缺失或未映射、owner/evidence 调换、蓝图设计未消费、跨视图断链、runtime 断边、requires/provides 悬空、迁移/NFR/组合证据缺失、证据 stale/invalid、`keep_direct` 不误挡、Provider 替换/缺失/绕过和 optional 验证降级。
- 本 change 不实现 Capability E2E closure，不新增 registry、执行账本、checkpoint、动态插件运行时、通用图执行器、锁、daemon 或第二权威。

## Capabilities

### New Capabilities

- `component-assembly-coverage-closure`: Component closure 的输入绑定、机械义务派生、跨视图与 runtime 覆盖对账、组合证据、宿主演进接缝验证、结构化缺口及 provider 生命周期契约。

### Modified Capabilities

- `app-component-blueprint`: 将当前范围需求/目标/不变量/高风险的稳定来源与蓝图地址映射纳入 discovery traceability；`source_fingerprint` 只绑定来源输入，mapping 变化仍由 revision/`artifact_sha256` 表达；同时把演进裁决冻结为 `establish_seam|keep_direct`。
- `change-unit-continuous-progression`: 仅对 P1 明确裁决为 `establish_seam` 的 evolution candidate 执行首次纵切和后续 Provider exact dependency 规则；`keep_direct` 使用普通 CU/dependency 语义。

## Impact

- 设计/规格层：新增 P3 capability spec、设计、实施任务及带完整父目标声明的 3.1.0 P3 子 plan，并携带 P1 traceability/evolution、P2 seam 判定的窄 delta spec。
- 后续实施面：预计增加 closure schema/loader/validator、coverage obligation/index 投影、跨视图/runtime/组合检查器、现有 completion/evidence 适配与团队评审 projection；复用 P1 stable-address resolver、P2 CU loader/completion/carry-forward、现有 Feature artifact loader 和 Goal Mode evidence verifier。
- 兼容性：P1/P2 尚未归档发布，本次只收紧其在研 artifact/fixture 和门禁，不构成已发布消费者 breaking migration，不要求修改 `MIGRATION.md`；无 `change_unit_ref` 的独立小 Feature 继续不参与 Component closure。
- 验收边界：P3 framework fixtures 只证明机械闭环；AI 记账真实宿主仍需真实多 CU、构建/运行/恢复及适用 UI/设备/人工证据才能形成语义验收。本 change 不归档 P1/P2，也不执行总计划 m5/MG 的 release 门。
