// transpile-only-env.ts — 让本进程及其 spawn 的子进程（继承 env）走 ts-node transpile-only。
//
// 类型安全由独立的 typecheck / typecheck:test 步骤把关（见 .cursor/plans 的 a7c3e1f9 P0/P1）；
// 此处只是跳过 ts-node 运行时的冗余全量类型检查，不改运行语义。
//
// ⚠️ 必须作为 run-unit.ts / run-tests.ts 的**第一个 import**：ES import 会被 hoist，
// 若把赋值写在其它 import 之后，未必先于某个 import 的 load 期副作用生效。用「副作用模块 + 首位导入」
// 保证这行最先执行，从而所有 per-case spawn 出的子进程都能继承到该 env。
//
// `??=` 保留外部显式覆盖：需临时对某次运行开全量类型检查时，先设 TS_NODE_TRANSPILE_ONLY=0 即可。
process.env.TS_NODE_TRANSPILE_ONLY ??= '1';
