# efficiency-first-closure — Design

## 决策

1. **闭环时序**：harness PASS → base summary 落盘 → 若 policy 要求则签发 verifier request → verifier 返回后由薄 driver
   调一次轻量 finalize（只读 summary + 已发布报告 + policy，不重跑 harness/编译/设备）→ closure。verifier 为
   advisory/disabled 时 harness 直接 closure。回执不再是输入或 Stop 判据：summary 提交后才 best-effort 生成只读投影，
   失败只 WARN；legacy 回执隔离只读兼容；`check-receipt` CLI 保留为 summary/verifier/policy 复核与 finalize 入口。
2. **verifier subject = pre-verifier material view**：在 Step 4 签发 request 时计算，材料 = phase 实际输入文件哈希（复用
   spec-loader REQUIRED/OPTIONAL 表与 manifest 的哈希函数）+ 主产物哈希 + verifier 实际读取的源码/trace/visual/机器报告
   哈希 + phase rule 哈希 + prompt 模板哈希 + gate_fingerprint；排除 verifier report、summary 运行字段、receipt、ai-prompt
   生成时间、merged report。不复用 finalize 后的 manifest aggregate（含 summary 与 report，会成环），不新增落盘 manifest。
3. **执行通道三态**：固定无原语 manual 类别与 inactive/SKIP provider 为 `unsupported_gap`；裸/未知 manual、未登记 provider、
   active 但无 per-TC producer 的 provider 为跑机前 `invalid_test`。gap 留在原始分母，五数输出。
4. **身份断言注入**：装载 run 副本时对同一 checkpoint 的每次合法触发分别注入；注入与运行期消费共用步骤区间，
   截止于下次同目标触发或更早的 back/home/应用复位，不跨区间借断言。区间内裸 by_id 幂等复用，完整导航与 UX 断言保留；
   只有目标映射本身不能唯一确定等真实歧义才 invalid_test，并点名候选 step/缺少的 selector 信息，不建议删除或拆开重复导航。
5. **执行键**：HAP 摘要 + run 副本派生计划摘要 + 设备身份/显示环境 + reset mode + 工具链版本 + flags；只复用最新一条
   带 execution-key 的真实 attempt（同键、成功、证据完整）；不回捞跨 key 历史；`--force-device` 是唯一逃生口。
6. **报告生成**：testing 的 writer 消费 trace/timing/meta/gaps/visual-diff/visual-debt/measure/quality axes/stability，
   输出必须能被既有解析器逐格读回；agent 观察进 notes.md；review 统计由 checker 自动回写。
7. **revalidate**：按 stale 输入运行必要检查，PASS 即 finalize，结果标 script_revalidated / semantic_not_reverified；
   不生成产物、不要求回执、不默认重跑 verifier。
8. **phase executor**：Claude 原生 `/goal` 路径主会话是薄 driver，每阶段一个 executor；与 GoalPhaseRuntime 入口互斥，
   goal-mode-skill spec 同步为两入口。

## 兼容性

- 旧 summary（1.2 及更早）与旧 subject 的 verifier 报告按既有 grandfather 规则继续有效；新 subject 只对新 run 生效。
- 旧回执文件继续可读；缺回执不再阻断。
- `manual`/`provider` 用例的旧报告行照旧读取；三态只影响新 run 的裁决与投影。
- profile 影响：hmos-app 的 test-report-template、profile-addendum、layout-oracle/visual-diff 检查；generic profile 只
  受通用 harness 变更影响。adapter 影响：Claude adapter 新增 phase-executor 模板；其余 adapter 不变。
- 不新增 receipt、签名、人工确认、状态机、第二套阶段推进 owner；公共 CLI 只新增三个。
