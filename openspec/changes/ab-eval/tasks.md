# Tasks: A/B Eval

## 1. 采集基建

- [x] trace.schema.json 增可选 usage 段（含 capture_method / confidence + model_identity；proxy 不分叉 schema）
- [x] adapter-schema.yaml goal capability 增 usage_capture 枚举（缺省 none；loadGoalCapability 非法值计入 issues）
- [x] agent-invoke.ts 按声明采集 usage + model identity（`utils/usage-capture.ts` 单点：stdout_json/stderr_regex 已实现，sidecar/api 为声明位、无实现按采集失败降 proxy 且 capture_method 保真；model identity 取响应元数据非自报）；AgentInvokeResult 增 usage? 字段
- [x] goal-runner 落盘 usage 进 agent_invoke_end 事件 + best-effort 合并进本 phase trace.json（已有 usage 不覆盖）

## 2. 受控跑批

- [ ] 选定 4 类样本各 ≥1（bugfix / 单模块 / 跨文件中等 / 进行中 NL 修正）；某类不可复现须在报告显式标注缺失
- [ ] 跑批脚本：每臂独立冷启动 headless goal-runner，臂间隔离
- [ ] 指标采集：usage 或代理指标（标注 confidence）/ 轮次 / 门禁命中 / 缺陷数 / 修正样本验证转嫁与否

## 3. 报告与 gate

- [x] 对照报告模板（逐样本 + 口径声明 + gate 建议）：`harness/templates/ab-eval-report.template.md`
- [ ] 产出报告，交用户 Phase 0 gate 拍板（继续/收窄）

## 4. Verify

- [x] usage 采集单测（none/失败 → proxy、信封解析、trace 合并幂等；`usage-capture.unit.test.ts` 7 case）
- [ ] `cd harness && npm test` + `npm run openspec:validate` + `npm run release:verify`
