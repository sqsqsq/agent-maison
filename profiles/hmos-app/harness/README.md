# hmos-app / harness

实现文件包括 `hvigor-runner.ts`、`hdc-runner.ts`、AST、`named-handler`、`detect-deveco`、`ts-compile`、`providers/*`；由 `framework/harness/scripts/utils/*` 下的 **re-export shim** 或 capability registry 转发，保证既有 `import './utils/hvigor-runner'` 路径稳定。

**契约回归 fixture**：位于 [`tests/fixtures/`](tests/fixtures/)（`init/`、`prd/`、`v2_2/`）；`generic` 专用条目在 [`../generic/harness/tests/fixtures/`](../generic/harness/tests/fixtures)。说明类文案可仍放在 [`framework/harness/tests/fixtures/`](../../../harness/tests/fixtures)。`run-tests.ts` **三扫描根**合并；逻辑名重复会直接抛错。

`ts-compile.ts` 位于本 profile 目录；`utils/ts-compile.ts` 仅作 shim。Visual Handoff 的脚本守门通过 `prd.visual_handoff` capability gate 控制。
