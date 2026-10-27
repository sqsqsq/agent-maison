# fe4512 S2 — 2026-10-26 同 run 恢复失败原件

只读来源：`D:/1.code/SimulatedWalletForHmos`，Feature 为
`doc/features/bc-openCard-2/bank-card-opening-flow`，run 为 `20261023T044016Z-fe4512`。
`sources.json` 逐文件记录来源、原始 SHA、副本 SHA 与字节数；本目录不修改历史事件或结论。

## 装配与核对

本目录是 **S1 基底上的 S2 增量**，不重复复制整个宿主工程。

1. 复制 `../20261024-fe4512-s1/` 到隔离项目根。
2. 根据 S1 的 `sources.json.files`，对 `normalization: CRLF->LF only` 的文件恢复 LF→CRLF，
   核对 `source_sha256`。其它文件原样复制。
3. 按本目录 `sources.json.files` 的 `file` 覆盖对应项目路径；同样恢复明确登记的 CRLF 并核原始 SHA。
   `evidence/*` 仅是发布件身份旁证，不复制为隔离项目的 `framework/`。
4. 隔离项目使用当前开发 framework；路径、门禁指纹、临时 Git/信任根等必要环境适配必须由回放记录，
   不写回本目录。不得改 facts 头部或先 research 补登记绕过此次根因。

`node capture.mjs --verify` 在干净检出中核对全部副本/可逆原始 SHA，以及 S1 源清单绑定；
`--verify-source` 额外只读核对仍在的宿主现场；`--capture` 才会重新采集本目录。
机器 `.log` 由根 `.gitattributes` 精确限定 binary，保留混合换行和尾空白。
新编写说明与工具为 LF；原件只对统一 CRLF 做可逆归一，不修改内容。

## 可直接核对的事实

| 事实 | 原件 |
|---|---|
| 29/30 计入预算的调用，墙钟 17,382,369 ms；manifest 30 轮/480 分钟未改 | run `progress.json` / `manifest.json` |
| plan-i28 作者 settled，`completion_observed=true` | `events.jsonl` 第 640–641 行 |
| i28 最后正式 gate 08:39:09.545→08:39:38.026，exit 0；期间 raw script report 为 PASS | `events.jsonl` 第 652/655 行；`plan/reports/script-report.json` 时间 08:39:23.925 |
| 外层 FAIL 唯一 blocker signature 是 `open_finding:acceptance_to_interface`，不是 raw gate FAIL | `events.jsonl` 第 656 行 |
| i26/i28 作者请求、两轮 format-repair 请求/输出仍在；当前计划作者输出是 i28 | run `phases/plan/plan-i*/request-e3.json`、`phases/plan-verifier-format-repair/*`、`phases/plan/agent-output.log` |
| `plan.md`、`contracts.yaml`、`use-cases.yaml` 的原始 SHA 与 S1 一致 | 两截面 `sources.json`；工具含断言 |
| WalletMain UT 26/26，含 AC-3/BD-2 OTP 状态断言；六份实现/测试原始 SHA 与原 UT evidence manifest 一致 | `ut/reports/20261024T192859Z-969/ut/*`；六个 `02-Feature/*` 原件；S1 `ut/reports/phase-evidence-manifest.json` |
| 宿主 framework 发布件 source_commit 为 fb3ef864 | `evidence/RELEASE-MANIFEST.json` |

## 不可追回与未复制的边界

- 固定 `phases/plan/prompt.md` 与 `agent-output.log` 已被 i28 覆盖；不能据当前字节声称恢复了 i26 作者输出。
- `verifier.report.75dbc…` 已由后续格式修复覆盖；保全的是采集时字节。若回放组合 S1 历史报告和 S2
  事件，必须说明组合来源，不能冒称原 S2 首轮报告。其它固定路径的早轮 raw gate 也不能由当前报告替代。
- 本 run 的 `phases/plan/harness/summary.json` 仍带 10-23 时间；i28 原 gate 使用本截面的
  `plan/reports/script-report.json` + 对应事件区间核实，不用旧 summary 猜测。
- 其它作者日志、detach、截图和设备工作目录仍留宿主；未复制无关的大目录，没有运行宿主 harness 或设备。
- S0/S1 原件继续复用；本目录保留 HALTED 历史，不构造 PASS、完成事件、回执或新预算。
