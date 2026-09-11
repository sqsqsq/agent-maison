## 1. 范围内核与协议

- [x] 1.1 实现静态义务 provider、ExecutionScope 和唯一纯计算入口。
- [x] 1.2 接通 workflow 1.2、真实控制边与旧协议兼容；默认 workflow 不切换。

## 2. 运行与完成

- [x] 2.1 接通实际 Goal 出生/恢复、P1 输入上下文及独立范围完成校验。
- [x] 2.2 在既有 runtime 实现意图、封卷、释放执行权、后继出生与继续；保留预算和真实失败历史。
- [x] 2.3 接通 assess/revise_scope、driver、阶段指令和 CU 完成消费。

## 3. 验证

- [x] 3.1 完成规则正反例、真实 prepare CLI/attended bridge、成功/失败来源、三个中断窗口及预算回归。
- [x] 3.2 冻结实现后运行 typecheck、harness 全量、OpenSpec、plan、diff/LF 校验并更新 P2 todo。

## 验收记录（2026-09-11）

- `cd harness && npm test`：typecheck、4413 单测、46 fixtures 全部通过。
- `npm run openspec:validate`：40/40，通过 Enforcement 路径校验。
- `node scripts/check-plan-version.mjs`、`git diff --check`、本批文件 LF 检查通过。
- 新增 19 个 P2 用例覆盖纯规则、真实 prepare CLI/host bridge、完成消费、后继交接中断恢复与预算继承；checker/toolchain 使用既有隔离测试接口，真实业务宿主验证仍由 P7 负责。
- 全量发现的旧入口/dry-run 兼容回归已通过共享 scope 读取修复；同时修正 halt reason 扫描对比较式的误匹配，以及信号清理单测对进程级监听器的干扰。修复后完整门禁通过。

本 change 不发版；正式发布前仍须 mandatory `npm run release:verify`（或 release:all）。MIGRATION.md 与默认切换由 P7 负责。本次未调用 openspec update。

## P2 六项返修验收（2026-09-11）

- 出生依据保留原记录；执行产出义务的源码依据不再要求保持出生字节，结果仍由既有 baseline、写集及阶段证据验证。获准源码修改后 completion/CU 均 VALID；陈旧设计契约与复用证据反例仍拒绝。
- 输入桥接按 kind 聚合：required 优先，其次 unknown，仅全部 N/A 才得到 N/A；原 scope 的 unresolved 保留。通过真实出生记录到 P1 resolver 的顺序无关反例。
- 验收派生遵守请求职责：独立 review 不追加测试，显式 UT/testing 保持专项边界，完整交付继续派生验证；缺少判断依据保留 unit/device unknown。
- 性能验收省略与空数组同判，真实未决性能条目仍保留 unknown。
- 修订报告使用已有绝对路径，外层运行循环与 main 共用 layout 解析；宿主根、harness 目录和显式 projectRoot 均通过后继交接。
- 定向：execution-scope 23/23、capability-degradation 17/17，typecheck 通过。
- 冻结后 `cd harness && npm test`：4418 单测、46 fixtures 全通过；OpenSpec 40/40，plan、diff/LF 检查通过。六项返修收口，未扩展到 P3–P7，未进行真实业务宿主验收。

## 第 1 项输入桥接补接线（2026-09-11）

上一轮完成检查修复未覆盖 P2→P1 的 expected_bindings，本次补齐后收口：

- 提取完成检查已有的出生源码依据判定，桥接共用；仅作出生判断的源码不再传为当前输入不可变绑定，仍保留来源目标供 P1 重新解析和绑定。设计契约、验收、满足依据与复用阶段证据约束保留，P1 resolver 未修改。
- 在既有 capability-degradation 测试中串通真实出生、源码修改、P2 桥接、P1 resolver：解析当前代码成功且获得新绑定，出生记录不变；直接传旧源码绑定、修改契约或验收均 blocked，恢复契约后正常解析。
- 定向 18/18；冻结后 `cd harness && npm test`：typecheck、4419 单测、46 fixtures 全通过。OpenSpec 40/40、plan、diff/LF 检查通过。第 2–6 项不扩面，未进行真实业务宿主验收。
