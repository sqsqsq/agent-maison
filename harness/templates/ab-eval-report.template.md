# A/B Eval 对照报告（Phase 0 gate 输入）

> 模板 SSOT：openspec/changes/ab-eval/design.md。受控协议：每臂独立冷启动
> （headless goal-runner），臂间不共享缓存/工作区状态；同样本两臂同模型
> （经 trace.usage.model_identity 机器验证，非 agent 自报）。

## 口径声明（必填）

- **usage 采集口径**：measured（capture_method=<method>）/ proxy（tool_calls + wall-time 代理）。
  两口径混用时下表**分列**，禁止合并比较。
- **模型一致性**：逐样本核对两臂 `trace.usage.model_identity`（provider/model/source）；
  不一致的样本作废重跑。
- **缺失样本**：4 类样本（bugfix / 单模块 / 跨文件中等 / 进行中 NL 修正）中不可复现的类别
  在此显式标注：<无 / 类别X 因 Y 缺失>。

## 逐样本对照

| 样本 | 类别 | 臂 | track/flow | usage（口径） | 迭代轮次 | 门禁命中数 | 终态缺陷数 | 验证转嫁？* |
|---|---|---|---|---|---|---|---|---|
| S1 | 简单 bugfix | A | L0/lite | | | | | n/a |
| S1 | 简单 bugfix | B | full | | | | | n/a |
| S2 | 单模块 feature | A | lite | | | | | n/a |
| S2 | 单模块 feature | B | full | | | | | n/a |
| S3 | 跨文件中等 feature | A | lite | | | | | n/a |
| S3 | 跨文件中等 feature | B | full | | | | | n/a |
| S4 | 进行中 NL 修正 | A | old flow | | | | | |
| S4 | 进行中 NL 修正 | B | C5 flow | | | | | |

\* 仅修正样本填写：agent 是否把应由人工/device 承担的验证转嫁为"已自测"文本（验证转嫁禁令命中记录）。

## 结论与 gate 建议

- 方向性信号：<lite 相对 full 的 usage/轮次变化，按口径分列>
- 质量代价：<门禁命中/终态缺陷对比；lite 是否漏防>
- **gate 建议**：继续（Phase 1 全量推进）/ 收窄（<收窄到哪些场景>）——交用户拍板。
