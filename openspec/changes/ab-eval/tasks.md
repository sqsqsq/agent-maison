# Tasks: A/B Eval

## 1. 采集基建

- [ ] trace.schema.json 增可选 usage 段（含 capture_method / confidence）
- [ ] adapter-schema.yaml goal capability 增 usage_capture 枚举（缺省 none）
- [ ] agent-invoke.ts 按声明采集 usage + model identity（api/sidecar 优先）；AgentInvokeResult 增 usage? 字段
- [ ] goal-runner 落盘 usage + resolved provider/model 进 trace/report

## 2. 受控跑批

- [ ] 选定 4 类样本各 ≥1（bugfix / 单模块 / 跨文件中等 / 进行中 NL 修正）；某类不可复现须在报告显式标注缺失
- [ ] 跑批脚本：每臂独立冷启动 headless goal-runner，臂间隔离
- [ ] 指标采集：usage 或代理指标（标注 confidence）/ 轮次 / 门禁命中 / 缺陷数 / 修正样本验证转嫁与否

## 3. 报告与 gate

- [ ] 对照报告模板（逐样本 + 口径声明 + gate 建议）
- [ ] 产出报告，交用户 Phase 0 gate 拍板（继续/收窄）

## 4. Verify

- [ ] usage 采集单测（none/失败 → proxy 且报告降级表述）
- [ ] `cd harness && npm test` + `npm run openspec:validate` + `npm run release:verify`
