# 20261024 fe4512 S1 — 最终收尾截图（只读副本）

plan `交付结论与调用恢复收口_全消费者同源与双运输一致_6fd6c8c1` t1 保全的**第二个时间截面**。
S0（10-23 旧 `framework_bug` 停机、旧 plan verifier 发现）沿用同目录上一级的
`20261023/20261023T044016Z-fe4512/`，本目录**不重复复制** S0 字节。

## 现场与身份

- 宿主根：`D:/1.code/SimulatedWalletForHmos`（只读复制，未清理、未回写）。
- run：`goal-runs/20261023T044016Z-fe4512`（10-23 创建，10-24 接续同一 run；无新 run、无预算重置）。
- canonical Feature：`cu-YmMtb3BlbkNhcmQtMgBiYW5rLWNhcmQtb3BlbmluZy1mbG93`。
- Feature 目录：`doc/features/bc-openCard-2/bank-card-opening-flow`。
- 采集方式与逐文件来源/哈希：见 `sources.json`（`node capture.mjs --verify` 可核对副本与现场一致）。

## 这一截面证明什么

| 事实 | 原件位置 |
|---|---|
| 六阶段 PASS/closed；testing `COMPLETE_WITH_P0_GAPS`、visual `UNVERIFIED`、release `BLOCKED` | 各 `phases/<phase>/harness/summary.json`、`phases/<phase>/reports/phase-evidence-manifest.json` |
| run 收尾为 `PARTIAL`、无 Feature completion | `goal-report.json`、`events.jsonl`（`run_end`） |
| 旧 guidance 仍指向已修复的 review-i21→coding | `goal-report.json` / `next.json` / `progress.json` |
| 两组 testing 自检与正式 gate 同执行键重复设备执行 | `testing/reports/20261024T1736*/`、`.../173847*/`、`.../184311*/`、`.../185039*/` 的 `execution-key.json` + `trace.json` + `frozen.device-test-run.meta.json` + `test-plan.hylyre.md`（正式 gate binding 读取的派生计划） |
| i15 最后自检与正式 gate 的完整原失败 | `testing/reports/20261024T174757Z-893/`、`.../175459Z-004/`（2026-10-25 补齐原 trace/report/派生计划/冻结 meta 与 timing） |
| 旧失败运行绑定的原顶层计划 | `testing/test-plan.before-tc003.md`；从宿主 testing 的真实 `Get-Content` 命令输出保全，SHA 精确匹配原 `artifact_binding.test_plan_sha256=c7bec927…`；来源日志与提取规则登记于 `sources.json` |
| 最后一轮正式 gate 43.567 s 成功执行事实已复用 | `testing/reports/20261024T194450Z-003/`、`.../193106Z-353/` |
| UT 成功复用与包键变化但未被证实为无效重跑 | `ut/reports/*/ut/execution-key.json`、失败轮 `20261024T170825Z-490` 冻结件 |
| 复用阶段仍有已核实发现（CR-004 为 best-effort 视觉债务，属披露而非完成阻断） | `review/review-report.md`、`visual-debt.json` |

登记的 ETS、JSON5、`.gitignore` 和执行 trace/report 等普通文本原件如含 CRLF，副本依仓库约定仅转 LF；
`sources.json` 同时记录原始 `source_sha256`、副本 `sha256` 与 `normalization`。已归一的原件均为统一
CRLF，隔离回放可用 LF→CRLF 精确还原并核对原始哈希，以保持既有冻结绑定。冻结的 `.log` 机器原件
可能混合 CRLF 与 LF，由根 `.gitattributes` 限定本目录按 binary 保全原始字节与 SHA，不作行尾归一；
原件尾空白也原样保留。运行结果、步骤和断言均未改动。

本目录是**证据**，不是断言：历史缺陷仍是缺陷，没有合成任何事件、PASS 或 completion。
`capture.mjs` 只复制、不生成结论；`--verify` 只核对字节。

## 未复制的原件（缺口登记）

- `detach.log`（539 KB）与 6 个 `phases/*/agent-output.log`（约 7 MB）：调用次数/时长/失败结果已在
  `events.jsonl` 与 `prompt.md` 中，日志本身不参与判定；现场保留未清理。
- `testing/failures`（17.3 MB）、`testing/reports/.hypium-workdir`（2.7 MB）与各轮截图：不是证据
  manifest 的输入/输出，复制会引入与判定无关的大文件。
- 上表两轮 43.567 s gate 之外的中间轮次只保留 `execution-key.json`；其 trace 留在宿主。
- 宿主现场仍在，按 plan §7 等用户安排接续；本目录不用于发布件。

## 开发期回放约定

- 本目录即 S1 的 `projectRoot` 形态：`recomputePhaseEvidenceStaleness(...)` 对六阶段全部 `fresh`
  （framework root 用当前源码仓，`framework_version=3.1.0`、gate 指纹与 \(environment\) 记录一致）。
- 复核必须走生产入口（`readCurrentDispositionInput` / `resolveCurrentDisposition` /
  `shouldGenerateFeatureCompletion` / `generateFeatureCompletion` / `assessFeature` /
  `resolveCurrentScopeView` / CU 完成与展示消费者）；不得手填 PASS、PARTIAL 解释或跳过生成。
- S1 的预期是：普通 Feature 完成成立、visual/P0 债务披露、release 仍 `BLOCKED`；
  已有有效作者/设备执行事实不重跑，确需的正式 gate 核验仍执行。
- 任何以 S1 修好后的字节替代 S0 输入，或把 S1 已失效的旧发现强加给 S0 的用法都不成立。
