# 组件策展流程

字段只读 [组件资产 SSOT](../../docs/concepts/component-assets.md)，交互确认与编辑/跳过/退出、既有条目保护细则完整复用 [catalog-bootstrap-workflow.md Phase A Step 3–6](catalog-bootstrap-workflow.md)。组件条目以稳定 ID 替代模块名；不复写一套确认纪律。

1. 读 index，并读取同 ID 的 catalog 卡，区分新增与更新；打开定义文件与 live 调用点。借助用途/意图/易混项选择真正相关候选，不持久化调用计数。
2. 候选 staging 放在已配置 component_catalog 同目录的 `component-catalog-staging.yaml`，形状为 `schema_version: '1.0'` + `components`，只含当前待确认卡。展示用途、适用/不适用、易混组件、状态和 golden 范例。
3. 只有本轮用户对该卡回答 y，才调用生成器合并模式：`npm run bootstrap:component-index -- --project-root <宿主根> --merge-staging <staging路径> --confirmed-id '<稳定ID>'`。多个逐一确认的卡可重复 `--confirmed-id`。确认参数来自本轮人类回复，不能由 AI 预填以绕过确认。
4. 合并器先验证卡片形状、ID/易混引用存在性和逐条确认，失败不写。成功后按既有流程清理该 staging 草稿，再跑 `--phase catalog`。策展 status 只允许随人确认变更。
5. 日常重扫导致的 dangling 或 golden 缺失只报告；不得静默改名、迁移、删卡或降 legacy。互链修改涉及另一张卡时也需对该卡确认。未策展只触发按需增量，不阻塞开发。
