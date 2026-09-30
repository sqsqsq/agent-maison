## 1. 实施

- [x] 1.1 停机原因故障类别入册、补登四个原因、元门禁补扫、停机说明内容要求（plan 4e6fb3b6 t1）。
- [x] 1.2 归因修正与 codex 信封按状态码区分（t2）。
- [x] 1.3 进程内有界等待、探针贯通到 `run_end`、supervisor 接受并删除后继分支（t3）。
- [x] 1.4 获准替代模型、钉值来源、预算提前建立与启动期耗时计入（t4）。
- [ ] 1.5 同任务接续决策与全部入口的消费（t5，由批三实施者收口）。
- [x] 1.6 运维手册、goal 模式指引与停机说明文字改为"补上缺的输入后重新发起同一请求"（t6 §9）。

## 2. 验收

- [x] 2.1 `npm run openspec:validate`、docs-authoring-lint、doc-freshness。
- [ ] 2.2 reliability-scenarios、release-only 套件与全量 harness 测试（由调度方收口时单独跑）。

归档随发布流程，不在本 change 内执行。

归档注意（2026-09-29 核实）：本变更对 runtime-policy「Execution scope has one authority and preserves obligations」出 MODIFIED，
基线是当前主规范。`composable-workflow-foundation` 以 ADDED 带着同名需求，其块文本与当前主规范逐字相同——即该增量已同步进主规范、
只是变更目录未归档。按既有归档流程：`composable-workflow-foundation` 归档时它的这条 ADDED 会与主规范里已存在的同名需求冲突，
其增量若已全部同步应以 `openspec archive <id> --skip-specs` 归档，不得再用 ADDED 覆盖本变更 MODIFIED 之后的文本；
本变更正常归档（应用规范），两者先后不影响结果。
