# Design: A/B Eval

## usage schema（trace.schema.json 可选段）

```json
"usage": {
  "input_tokens": 123456,             // confidence=proxy 时 token 字段可为 null / 缺省
  "output_tokens": 23456, "tool_tokens": 3456,
  "requests": 42, "cost_estimate": 1.23,
  "capture_method": "api",            // 与 adapter usage_capture 声明一致
  "confidence": "measured"            // measured | proxy
}
```

`capture_method: none`/采集失败 → `confidence: proxy`：token 字段可 null/缺省，**不新增 proxy 专用字段**——代理指标复用 trace 顶层 `tool_calls` 与 `started_at`/`ended_at` 推导 wall-time（schema 不因 proxy 分叉），报告只允许基于该口径表述。

## usage_capture（adapter goal capability）

`agents/adapter-schema.yaml` goal capability 增枚举字段 `usage_capture: none|stdout_json|stderr_regex|sidecar|api`（缺省 none）。`agent-invoke.ts` 按声明实现采集并回填 `AgentInvokeResult.usage?`；goal-runner 落盘进 trace。model identity 同路径机器固化（resolved provider/model 来自调用配置/响应元数据，非 agent 文本自报）。

## 受控协议

- 样本 4 类：简单 bugfix（L0/lite 对照）、单模块 feature（lite vs full）、跨文件中等 feature（lite vs full）、进行中 feature NL 修正（old flow vs C5 flow）。
- 每臂独立冷启动跑（headless goal-runner），臂间不共享缓存/工作区状态；同样本两臂同模型（经 model_identity_capture 验证）。
- 指标：usage（或代理指标，标注 confidence）、迭代轮次、门禁命中数、终态缺陷数、修正样本另记"验证是否转嫁"。
- 报告：逐样本对照表 + 口径声明（measured/proxy 混用时分列）+ gate 建议（继续/收窄），交用户拍板。

## 位次

Phase 0 尾（依赖 C1 lite 链 + C5-min）；报告是 Phase 0 gate 的输入，也为 C3 主干预算与 C2 verifier 保留集提供第一份校准数据。
