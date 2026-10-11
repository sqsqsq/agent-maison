## Why

宿主正式设计只交付机器 YAML，评审者无法直接理解整体方案与 CU 施工拆分；现有可读投影没有默认生成与修订同步入口。落实已批准 plan 7c2e9a41，让设计交接默认包含可重建的完整人读文档。

## What Changes

- 复用蓝图同目录 `component-blueprint.review.md`，展示蓝图与 canonical CU 的已有设计事实、需求追溯、替代关系和来源缺口。
- 在既有 CLI 增加 `--write-review`，生成与 publication 校验使用同一收集和渲染链；草稿可生成，生成不改变检查结论。
- 拆分接受、readiness、持锁整批指针调和及 B1 发布后自动刷新；独立汇总整个尝试的文档结果，展示失败不改变业务结论。
- 设计 Skill 同步写作要求、七问自检及内容修改后重建规则；本地默认交付与可选宿主 publication 分开。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `app-component-blueprint`: 默认人读交付、草稿展示、同源生成与重建诊断。
- `complex-capability-meta-model`: Maison 从蓝图和 canonical CU 派生同页设计交付件，宿主无需自拼 CU 附件。
- `change-unit-continuous-progression`: CU 契约展示与来源绑定，以及接受、readiness 和持锁调和后的可恢复刷新。

## Impact

影响 P1 设计交接、P2 设计准备和 B1 自动修复展示链；不改变施工授权、准入、readiness 或 recovered 判定。修改 renderer、CLI、共享 CU 工具、Skill、消费者文档、样例及目标测试，不新增依赖。MIGRATION.md 说明旧格式只需重建，canonical revision 无需修改。真实宿主验收单独保留，不用 fixture 或样稿替代。
