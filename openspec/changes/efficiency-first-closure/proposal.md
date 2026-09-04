# efficiency-first-closure

## Why

宿主 SimulatedWalletForHmos / bc-openCard-1 在 2026-09-02 用 Claude 原生 `/goal` 手工推进六阶段，一个 20 行的产品修复
加测试输入修正花了 16 小时：主代理 910 轮、缓存回放 4.36 亿 token、verifier 34 次（单次 4–13 分钟）、真机 10 轮（后 7 轮
派生计划字节相同、6 轮同一 HAP）、check-receipt 41 次。本机日志复算表明撑大上下文的不是门禁，而是代理在补框架没给的
工具（411 个临时脚本：209 个处理 trace/report/timing、66 个量像素）和在读 framework 源码反推门禁判词（212 次），
这两件事同时是错误来源：11 个代理错误里 8 个是派生值失效，P0 覆盖 0/16 来自读源码得出的错误信念。

结构性放大器有四个：闭环仪式把每次改动放大成 harness → verifier → 回执 → check-receipt → 下游全部重闭；verifier
报告绑在带时间戳的 prompt 字节上，重跑一次 harness 就作废；correction 的 touched_layers 对账在 {coding, ut} 组合上
结构上不可通过，Stop hook 拦截排在逃生阀之前；真机证据绑整份 test-plan.md 的 hash，改版本号就重跑真机。

用户 2026-09-03 裁定的总原则（docs/overview.md §1.2.1 第一条"效率优先"，plan 07a41ec6 D0）：效率优先、准确率够用；
产品功能与 UX 准确性优先于过程证据完整性；缺 verifier/receipt/签名默认不阻止普通开发完成；可以不复审、可以复用、
可以带已知缺口完成，但必须诚实标注；不做 A/B，由宿主实跑回灌。

## What Changes

- **correction 硬路径删除**：删 touched_layers 对账、Stop hook 的 correction 拦截、`--correction-check`；feature correction
  不再持久化状态；三问分类只留给责任路由；adhoc 保留自己的 base_commit 状态。
- **失败前移与判词给改法**：执行通道三态 `executable / unsupported_gap / invalid_test`（gap 须机器证明、留在分母、不算
  PASS、不阻止完成）；派生期 lint 拒绝缺身份断言、by_text 抢先、不可绑 checkpoint；全部 BLOCKER 判词给到 TC/step/
  实际形状/期望形状/改法；Hylyre 已知边界按版本写进 addendum。
- **P0 身份断言由 harness 注入**：装载派生计划进 run 目录时插入精确形状的裸 by_id 断言；UX 谓词断言保留；scroll 不改 tap。
- **闭环读 summary，回执退出输入**：finalize 只读 base summary + verifier 证据 + policy；回执成为只读投影；反假设 checkbox
  与手填字段删除；agent 备注进 notes.md。
- **测试报告整份机器生成**：从 trace/timing/meta/gaps/visual-diff/visual-debt/量测/quality axes/stability 生成，结论按
  功能/交互稳定性/视觉几何/内容/样式逐轴派生；review 统计自动回写；引用与计数 lint 只作 WARN。
- **真机执行键复用与稳定性**：执行键含 HAP 摘要、run 副本派生计划、设备与显示环境、复位方式、工具链版本、flags；只在
  最新真实 attempt 同键、成功、证据完整时复用，不回捞跨 key 历史；fresh/N 轮真跑；稳定性按同键含失败轮统计。
- **verifier 每份材料一次**：subject 改为签发 request 时计算的 pre-verifier material view；材料不变复用；材料变了可不
  复审但状态为 `completed_with_prior_review` + `current_material_not_reverified`；prompt 与输出瘦身；首轮保留 UX 语义检查，
  后续只核对；可读性打磨项删除。
- **快速 revalidate 与漂移分级**：`--revalidate` 只是检查执行器；UX 源码漂移按五类风险对应一次复核；UT 改生产代码归类
  为 coding change。
- **上下文减负**：Claude `/goal` 主会话做薄 driver，每阶段一个 phase executor；与 GoalPhaseRuntime 入口互斥；禁止自建
  等待器；harness 输出加 `NEXT:` 行。
- **视觉量测只出事实**：`--measure` 产出几何事实与 geometry/content/style 三轴状态；不改 ui-spec、不覆盖 verdict、
  不等于 pixel_1to1 PASS、不解除 release block；无 provider 时 attestation/critic receipt 改 SKIP。

## Impact

- 受影响阶段：spec（checkpoint action 静态检查）、coding/review/ut（漂移分级、闭环时序）、testing（三态、注入、执行键、
  报告生成、量测）、全部阶段（回执、verifier、revalidate）。
- 破坏性变更（MIGRATION.md 须同步）：`--correction-check` / feature correction 状态删除；回执不再是闭环输入，手填字段
  与反假设 checkbox 删除（旧回执照旧读取，不再要求）；verifier subject 计算方式改变（旧 subject 报告按 grandfather
  继续有效）；test-report.md 由 harness 生成（agent 内容迁到 testing/notes.md）；新增 `--revalidate` / `--force-device` /
  `--measure`；`manual`/`provider` 用例从恒 FAIL 改为 unsupported_gap 或 invalid_test。
- 不改 goal-runner / GoalPhaseRuntime 实现；只把两入口写成互斥。
- 受影响 spec：harness-gates、correction-routing、feature-artifact-layout、visual-diff、goal-mode-skill、agent-adapters、
  runtime-policy、verdict-lattice。
