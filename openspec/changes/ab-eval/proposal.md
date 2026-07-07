# Proposal: A/B Eval — 受控收益验证（Phase 0 gate 的数据来源）

## Why

整个轻量化重构的母命题是"framework 的 token 开销有没有买到正收益"。plan（d4a7c1e8）把 Phase 0 gate 定义为方向性信号（继续/收窄），其输入是受控 A/B 对照报告——但该工作此前无 OpenSpec owner（codex scaffold review P1 坐实），会出现"C0/C1/C5 都做了、收益验证没人做"的偏差。本 change 是 Phase 0 gate 数据管线的唯一 owner。

## What Changes

- **trace usage schema**：`trace.schema.json` 增可选 `usage` 段（`input_tokens / output_tokens / tool_tokens / requests / cost_estimate`）
- **usage_capture 能力声明**：adapter goal capability 增 `usage_capture: none|stdout_json|stderr_regex|sidecar|api`；采集按声明实现（api/sidecar 优先）；`none`/采集失败只出代理指标（wall-time / tool_calls），不得承载 token 结论
- **model_identity_capture**：A/B 报告机器固化 resolved provider/model（manifest/report 记录，非 agent 自报）；拿不到 usage 或 model 身份不得声称"同模型 token 对照"
- **受控 A/B 协议**：**4 类样本必含**（简单 bugfix / 单模块 feature / 跨文件中等 / 进行中 feature 的 NL 修正——第 4 类对照臂 = old flow vs C5 flow）；某类确不可复现时报告须标注缺失，且 gate 不得声称覆盖该类收益（修正路由类缺失即不得下修正路由结论）；各臂均以 headless goal-runner 分开独立跑（不得全量顺序跑计时——缓存/warm 假象已被实测证伪）；记录 token / 轮次 / 门禁命中 / 缺陷数
- **gate 报告**：产出对照报告交用户做 Phase 0 gate（方向性信号：继续/收窄；n≤4 样本不承担最终阈值证明）

## Impact

- Affected specs: eval-protocol（新增）、agent-adapters
- Affected code: `harness/trace/trace.schema.json`、`agents/adapter-schema.yaml`（goal capability usage_capture）、`harness/scripts/utils/agent-invoke.ts`（usage 采集）、`harness/scripts/goal-runner.ts`（usage/identity 落盘）、A/B 跑批脚本与报告模板（新增）
- 依赖：C1（lite 链可跑）、C5-min（修正样本的 C5 flow 臂）
