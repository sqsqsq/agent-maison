# `framework/harness/tests/fixtures/`（说明入口）

此处**不再放置**含 `INPUT/` + `CMD.json` 的 Harness 契约用例——它们已迁至 profile 自有目录：

| Profile | 目录 |
|---------|------|
| `hmos-app` | `framework/profiles/hmos-app/harness/tests/fixtures/`（`init/`、`prd/`、`v2_2/`） |
| `generic` | `framework/profiles/generic/harness/tests/fixtures/`（如 `profile_generic/`） |

`visual_handoff/` 仅存 **Markdown 索引**（无 fixture 三件套）。

扫描与去重：`framework/harness/tests/run-tests.ts`（合并上述根与本目录）。
