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

## 4. P8 批次 1（run 内修订与 resolver 护栏）

- [x] 4.1 D0.1：证据类义务的候选自报一律重算（unit/device 走验收分层、visual 走 fidelity SSOT）；无来源一律 `unknown`；device 裁剪须有**结构完整且有来源**的 impact 判断；`satisfied_by` 与 `obligation.basis` 冻结时经读取层核验。
- [x] 4.2 D2：合法修订在**同一 run** 追加 `scope_revised`，不封卷、不释放锁、不生成后继；`createScopeSuccessor` 与 `scope_revision_requested` 删除；有效范围 = 出生 + 按 index 应用；读取侧与写入侧共用同一组前后约束（请求边界、不得删除/降级 required）。
- [x] 4.3 全部运行期消费点改读有效范围（链、游标、终点判定、完成资格、预算、提示语与进度投影）；manifest 三字段与 run_created 身份保持出生值。
- [x] 4.4 `run_base_sha` 事件层 write-once：仅首条含 coding/ut 的修订可携带，读取侧校验三条充要条件与 40-hex。

### 批次 1 代码 review 第一轮返修记录

- 收紧点：impact 判断须有布尔/理由/非空来源；`obligation.basis` 与 `request.impact.basis` 共用同一核验函数（来源存在、项目内、摘要有效）；字节例外收成 `derive.codebase` / `derive.test-targets` 白名单；修订读取器按事件物理顺序校验（不排序）并复跑写入侧约束；基线读取器执行三条充要条件。
- 语义修正：修订可**撤销失效的 `satisfied_by`**（对应阶段回链重跑），不再被无条件补回；required 保护按 `id + kind` 判定；重算前不再因候选自报 applicability 拒绝；impact 的「继承 vs 更正」按与有效范围的实际差异判定，更正须自带新来源。
- 目标收集：`design-decision` / `acceptance-definition` 的 derive basis 不再进入 `source_paths` / `testTargets`（§5.1.1a R-目标收集），其余 kind 照收。

## 5. P8 批次 2（D0.3 生产触发 + D0.2 候选生成入口）

- [x] 5.1 D0.3：已归属 spec/plan 的候选（`category ∈ {spec,plan}` 且 `source_phase ∈ {coding,review}`）经**既有**归属链产出范围修订输入，写进磁盘 script-report.json；summary writer（PASS/FAIL 两轮可达）与闭环重算（晚到候选、`--sync-closure`）两处各接一次。不新增 check id、不动 `CHECK_ID_OWNER_REGISTRY`、不判断意图。
- [x] 5.2 D0.3 correction 出口：修正路由读**有效范围**；责任阶段在范围外时如实说明并指向两条合法入口，**不**产出会被「修订须由新事实驱动」判据拒绝的提议，也不落 `backtrack_target_absent`。
- [x] 5.3 D0.2：`goal-mode-entry --prepare-scope` 生成候选——主 Agent 只给四项输入；绑定/指纹经 `resolveCapabilityInputs` 同源计算，证据类义务由 resolver 派生；implementation 由请求动作决定；幂等（同输入字节不变、手改报差异不覆盖）；投影 + 模板化说明；动作不明确时打印既有阶段证据体检并拒绝猜测。
- [x] 5.4 AGENTS 模板与三份 Skill/文档改为四项职责 + `--prepare-scope`，清除「手写来源/指纹」表述。

### 批次 2 验收记录

- 真实归属链正反例（`standalone-coding-review.unit.test.ts`）：真实 check-coding 的 `ui_scope_violation` → plan 候选 → `design-decision` 事实（basis 逐条对应候选 files、reason 取候选 summary）→ 链变 `[plan, coding, review, ut]`；`diff_within_scope` 等点名越界产不出 spec/plan 候选、也产不出修订输入。
- 真实 review→spec 路径（路径域归属）→ `acceptance-definition` 事实；晚到候选经真实 `finalizePhaseClosure` 落进 script-report；FAIL 轮由 writer 落盘且重跑不重复。
- 撤回闭环（`execution-scope.unit.test.ts` 的 `design-gap-revert` 端到端）：plan 不扩写集 → coding 改回原字节 → 无 `input binding stale`、plan 证据仍 `fresh` 且其 manifest inputs 不含触发文件 → completion VALID。
- D0.2：候选可直接被 `--prepare-run` 冻结；绑定与 `resolveCapabilityInputs` 逐字相同；同输入重跑字节不变；手改报差异不覆盖、`--overwrite` 才写；仅验证请求无 implementation 且链为 `[review, ut]`；动作缺失时拒绝并打印阶段证据体检；NEXT_STEP 只呈现范围内义务。
