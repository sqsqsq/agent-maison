# Tasks — turn-closure-and-liveness-truth（plan e6b3f8d2）

> 本 change 只承载 terminal 收口 / codex adapter 声明 / liveness / 超时话术四项。
> **强制 Maison UI kit 的撤销不在此** —— 那是在研 change `blind-visual-hardening` 的
> d3 撤回：其 kit capability 从未进过 base specs，故在原 change 内直接删 delta，
> **不在这里叠一份删除 delta**。

## 1. T1 · Codex terminal 收口（P0）

- [x] 1.1 真实样本采集：本机 `codex-cli 0.149.0` 实跑 `codex exec --json` 三份落 fixture
      （`turn.completed` / `turn.failed`+顶层 `error` / item 级错误后仍 `turn.completed`），
      另由两份真实样本的**原始行拼接**出「顶层 error → 后续 turn.completed」序列；
      采法与脱敏范围记 `harness/tests/unit/fixtures/codex-terminal-README.md`。
- [x] 1.2 `agents/codex/adapter.yaml`：`output_delivery: streaming` + `usage_capture: stdout_json`；
      `tool_event_provenance` 保持缺省 `none`（注释写明理由）；**不新增** terminal 能力字段。
- [x] 1.3 新增 `codex-terminal-events.ts`：单行分类纯函数 + 跨 chunk 行缓冲扫描器；
      只认两终态；顶层 `error` 仅诊断；item 级错误一律 other；诊断摘要条数/长度双封顶。
- [x] 1.4 `agent-invoke.ts`：`codexArgv` 尾部独立追加 `--json`；stdout chunk 直喂扫描器；
      completion/terminal failure 走单一仲裁入口（R8 settle grace 原语复用），failure 双顺序优先；
      probe 已取消 hard timeout 后遇 failure，按原 deadline 恢复；exit 0 规范化非零；
      结果增 `terminal_failure_observed` / `terminal_error_excerpt`。
- [x] 1.5 删除 silent watchdog **生产链**（常量/选项/定时器/kill reason）；
      `silent_killed?` 字段保留供读侧兼容历史事件；源码锚定回归钉死写侧零残留。
- [x] 1.6 `goal-runner.ts`：`agent_invoke_end` 增补两个 terminal 字段（`GoalRunEvent` 同步）。
- [x] 1.7 探针**文档归位**（判据零改动）+ `docs/operations/adapter-tool-event-provenance.md`
      codex 行改写（`--json` 只提供 terminal/usage，provenance 恒 none）。
- [x] 1.8 连带修复：codex stdout 转 JSONL 后金丝雀/inline 判卷须先做信封投影
      （新增 `extractCodexAgentMessageText` + `resolveCanaryStdoutEnvelope`，两处判卷同源接入）。

## 2. T2 · 活性分离工作面与控制面（P1）

- [x] 2.1 `goal-progress.ts`：新增纯函数 `resolveRunOutputDelivery`（读**本 run 事件**，
      缺失/非法一律 unknown）；三合取降级到既有枚举 `SUSPECTED_STALL`（只从 ACTIVE/QUIET 抬）。
- [x] 2.2 snapshot 增 `agent_output_stalled_ms`；默认/Markdown 查进度独立成行「agent 输出已停滞
      X 分钟」，**不复用**含 heartbeat 的 `seconds_since_activity`；字段/说明同样只在三合取
      成立时出现，buffered/unknown/已闭合 invoke 为 null 且不渲染。

## 3. T3 · 超时话术两轴并陈（P1）

- [x] 3.1 新增纯函数 `findLatestInvokeHarnessFailure`（窗口分法与 `deriveContinuationFromEvents`
      同源，只认同 invoke 的新鲜 FAIL/INCOMPLETE）。
- [x] 3.2 `buildPhasePrompt` 两处超时话术改两轴并陈；**纯超时文案一字不改**。

## 4. 回归与验收

- [x] 4.1 `codex-terminal-closure.unit.test.ts`：真实 fixture 逐行分类 + 半行分块（1/3/7/17/64/4096
      字节）+ error→completed 不早杀 + probe 竞争 + argv/能力声明断言 + usage 直读 +
      **受控 fixture 驱动的真子进程 E2E**（completed 后钉住→秒级收口 / failed+exit 0→规范化非零 /
      error 稍后 completed→不提前 kill / probe→failed 恢复原 hard deadline / failed→probe 不洗白 /
      两序 phase event 均 `agent_failed=true` / 非 codex adapter 不启用解析器）。
- [x] 4.2 liveness 5 例（fake clock 固定时钟）：降级正例 + buffered/unknown/缺声明三态豁免 +
      三合取缺一不降且字段为 null + 读源断言 + 默认 CLI/Markdown 查进度渲染口径。
- [x] 4.3 超时话术 3 例：窗口判据五态 + 并陈形态 + 纯超时不变。
- [x] 4.4 全量：`cd harness && npm test`（typecheck + unit + fixtures）与 `npm run openspec:validate`。
- [x] 4.5 **宿主 smoke**（补充集成证据，非发布依赖）：新 run_id 全新 run（不 resume 既有 halt
      run），验证宿主 argv 含 `--json`、无 kit 物化/双输、产品组件所有权链可闭环；真实 codex
      `turn.completed` + 非 null `usage` 由仓内真实捕获 fixture、生产 argv 实跑与受控子进程 E2E
      独立覆盖，`turn.failed` 分流继续用真实捕获 fixture 驱动（不赌真实模型 FAIL）。发布与归档
      不依赖外部宿主可用性。

## 5. 诚实边界（不得在报告里夸大）

本 change 消除的是 **FAIL turn 的 ~60 分钟收口空等**与**活性/话术遮蔽**，
**不承诺缩短 spec/plan/coding 的单 turn 推理时长**（宿主实测 spec 36min / plan 33min /
coding 30min，属另一问题，本轮不处理）。
