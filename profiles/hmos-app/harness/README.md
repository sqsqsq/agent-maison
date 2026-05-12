# hmos-app / harness

详细排障、hvigor/hdc 命令与调优：**见** [`../../../docs/profiles/hmos-app-harness-toolchain.md`](../../../docs/profiles/hmos-app-harness-toolchain.md) 与 [`../../../docs/operations/harness-runbook.md`](../../../docs/operations/harness-runbook.md)。

实现文件包括 `hvigor-runner.ts`、`hdc-runner.ts`、AST、`named-handler`、`detect-deveco`、`ts-compile`、`providers/*`；其中 `named-handler` 由根 `scripts/utils/named-handler.ts` 按 `project_profile` **动态加载**本目录实现，其它工具可在 `scripts/utils/` 保留稳定 shim。

**契约回归 fixture**：位于 [`tests/fixtures/`](tests/fixtures/)（`init/`、`prd/`、`v2_2/`）；`generic` 专用条目在 [`../generic/harness/tests/fixtures/`](../generic/harness/tests/fixtures)。说明类文案可仍放在 [`framework/harness/tests/fixtures/`](../../../harness/tests/fixtures)。`run-tests.ts` **三扫描根**合并；逻辑名重复会直接抛错。

`ts-compile.ts` 位于本 profile 目录；`utils/ts-compile.ts` 仅作 shim。Visual Handoff 的脚本守门通过 `prd.visual_handoff` capability gate 控制。
