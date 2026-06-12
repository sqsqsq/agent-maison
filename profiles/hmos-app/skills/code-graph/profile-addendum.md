# `hmos-app` · Skill `code-graph` profile addendum

## GraphExtractor 能力

本 profile 在 `profiles/hmos-app/harness/hmos-graph-extractor.ts` 提供 `GraphExtractor`：

- **签名**：`AstAnalyzer` 扫描 `.ets` 中 class methods（`ClassName.methodName`）。
- **import 边**：行扫描 `import`。
- **call 边**：`graph-extractor-host` 模块内 `CallExpression`（跳过 `ohosTest`/`test` 目录）。

## 包路径与落盘

- 默认包路径：`catalog.modules[].layer` + `/` + `name`（如 `02-Feature/WalletHome`）。
- 落盘：`paths.module_graphs_dir` 默认 `<module>/code-graph.yaml`（与模块根 `index.ets` 同级）。

## 策展建议（hmos-app）

- core 锚点优先选：`key_exports` / `entry_file` 对应入口、domain/data 编排类方法。
- **勿**将 `ohosTest`/`test` 下测试符号标为 core。
- 签名只含 class methods；独立函数若未进 signatures，须手动核对 anchor 或扩 derived 后重跑 bootstrap。

## 资产键

| 键 | 文件 |
|----|------|
| `code_graph_template` | `templates/code-graph-template.yaml` |
| `curate_core_prompt` | `prompts/curate-core-nodes.md` |
