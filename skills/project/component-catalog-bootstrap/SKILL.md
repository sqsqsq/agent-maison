---
name: component-catalog-bootstrap
description: Discover shared UI components and curate their intent and selection guidance with individual human confirmation. Use for component inventory or incremental curation requested by a feature or user.
---

# 组件索引与台账自举

先读取有效 framework.config.json、module-catalog 与 [组件资产 SSOT](../../../docs/concepts/component-assets.md)。资产路径从 `paths.component_index/component_catalog` 解析，缺省使用框架默认值；不改宿主初始化配置。profile 必须有组件 extractor，当前仅 hmos-app。

执行前完整读取 [组件策展流程](../../reference/component-catalog-bootstrap-workflow.md) 与其中引用的 catalog-bootstrap 确认规则。**用户确认 UX**：复用 [user-confirmation-ux.md](../../reference/user-confirmation-ux.md) 的 `catalog.staging_module` 逐卡交互纪律。

1. 用户要求建库存时，运行 `cd framework/harness && npm run bootstrap:component-index -- --project-root <宿主根>`，机器索引不逐条确认。
2. 某 Feature 选到未策展候选或用户显式指定批量时，读取 index/catalog 与 live 调用点；不要求全工程盘完。
3. 用 `profile-skill-asset:component-catalog-bootstrap/component_card_template` 和 `profile-skill-asset:component-catalog-bootstrap/curate_component_prompt` 生成当前卡草稿。
4. staging→逐条 y→校验后合并；未确认不写，既有 status 不自动变更。悬空卡只报告，等人决定迁移/删除。
5. 跑既有 `--phase catalog` 并报告新增/修改/跳过/uncurated/dangling；不执行 Feature 或共享组件重构。

产物只有配置路径下的 index/catalog；staging 只是本轮待选草稿，不新增登记状态或索引统计。
