1. 写 `.ets` 文件**前**先扫一眼 [arkts-pitfalls.md（profile）](framework/profiles/hmos-app/skills/3-coding/reference/arkts-pitfalls.md) 相关条目（其它 `project_profile` 以其 addendum / 宿主约定为准）。
2. **逐文件闭环**：写一个文件 → 立刻 `ReadLints` → 零 error 才能写下一个。**严禁批量生成多文件后再统一 lint**。
3. 不允许出现 `any`、硬编码字符串、未定义资源 key、以及在跨模块导出入口文件（由实例 `architecture.cross_module_exports_file` 指定文件名）中遗漏本应导出的符号。
