## 1. 实施

- [x] 1.1 目标简报组装与渲染，四个注入点与 verifier 材料摘要分量（plan 33784ed1 t1）。
- [x] 1.2 拒修与反驳状态的回放函数及四处消费点，拒修依据带给裁判（t2）。
- [x] 1.3 `unexpected_render` 类别、按方向授权、provider 载荷贯通、review 多做核对（t3）。
- [x] 1.3a `visual-diff` 规范增量：缺陷类别枚举与字段约束同步 `unexpected_render`（codex 实现 review 首轮必须修复项）。
- [x] 1.4 清理被替代的旧指引与过时文档，场景断言（t4）。

## 2. 验收

- [x] 2.1 typecheck、目标套件、`npm run openspec:validate`、`node scripts/check-plan-version.mjs`。
- [ ] 2.2 全量 harness 测试（由调度方收口时单独跑）。

归档随发布流程，不在本 change 的实施批内。
