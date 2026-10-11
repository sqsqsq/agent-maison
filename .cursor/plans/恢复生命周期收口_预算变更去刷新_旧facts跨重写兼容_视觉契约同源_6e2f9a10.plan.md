---
name: 新运行可靠性收口 — 删除预算冗余刷新与统一视觉输出契约
version: 3.1.0
overview: >
  用户已放弃并删除宿主旧现场，后续面向新运行解决实际问题。
  本批删除预算独变触发的冗余上游刷新，统一视觉输出格式、错误诊断与 severity 提示。
  旧 facts 专用兼容和独立长回放取消；当前数据仍可能出现的事件/summary 分歧只保留最小入口回归。
  以当前 writer/checker 的目标测试和干净宿主重跑验收，与 272acb5f 的 H1 共用一次运行，不恢复 be091c。
todos:
  - id: t1-retire-budget-refresh
    content: >
      §2：删除 budget-only 全上游刷新及专用死代码，保留授权、身份 rebase、累计预算与普通恢复。
      将原测试改为当前格式下的行为验收；补一条普通 phase-only 重验造成事件/summary 分歧的入口回归，
      必要时只补既有观察/assess 接线，不实现旧 attempt 的专项只重验资格。
    status: pending
  - id: t2-stable-legacy-facts-view
    content: >
      已取消：用户已删除旧现场，本批不再开发旧 facts 中历史控制依赖的跨重写兼容或迁移。
      取消不是修复完成；现有兼容代码及已完成历史测试不因此自动删除。
    status: cancelled
  - id: t3-visual-contract
    content: >
      §3：统一现有视觉 prompt、payload validator 的 bbox/下标/JSON 契约，保留准确解析诊断与一次有界纠错。
      按路标 §2.1 补 severity 三级定义及影响依据；分级效果在干净宿主观察，不新增模型评测体系。
    status: pending
  - id: t4-continuous-recovery-replay
    content: >
      已取消：独立旧混合态/长连续回放不再实施。当前格式的提额、累计预算、普通恢复入口验证并入 t1，
      视觉格式与纠错验证并入 t3，避免重复搭建场景或重建已删除的 be091c。
    status: cancelled
  - id: t5-review-docs-and-candidate
    content: >
      §4：同步受影响的现有规格与指引，完成目标验证和有界 review；稳定后集中完成候选门禁。
      复用 1dbe4fa4 指标与观察记录，保留历史失败事实，不将旧全量结果作为本批通过证据。
    status: pending
  - id: t6-host-clean-delivery-acceptance
    content: >
      §5：用已验证发布件在确认的干净代码基线上重跑原需求，与 272acb5f 的 h1 共用一次宿主运行。
      逐项记录本批验收结果及总体指标；不要求保留旧 run，不继承其旧余额，不声称旧 run 恢复已验证。
    status: pending
---

# 新运行可靠性收口

## 1. 最新裁决与范围

2026-10-11：用户已删除旧宿主现场，决定不保留、不恢复 be091c，面向未来解决问题。本版覆盖此前依赖原现场的实施安排；文件名保留原 ID 与引用，标题和待办以本版为准。

本批保留预算恢复减负、视觉契约修正、相称验证和一次干净宿主交付。取消为旧数据新增 facts 兼容、原 attempt 专项恢复和旧现场只读/H1 回放，不重建已删除的数据，也不将取消记作完成。既有代码兼容面本批不增不删；历史旧数据问题不宣称已经修复。

历史事故仍提供设计依据：provider 调用成功但载荷格式失败；仅追加预算触发 coding/review/ut 刷新；新版 coding evidence 与旧 facts 混合后再次失效。此处是已经记录的事实，不要求旧宿主路径仍在，也不再收集它的旧 verifier、截图或预算余量。

本批未新增默认质量策略计划或动态调整协议。现有默认保真度、best_effort 与差异处置先核实、使用；新的实际差距在干净运行中确认后再决定是否需要有界变更。

## 2. t1：删除预算专用刷新，验证当前运行行为

删除 `harness/scripts/goal-phase-runtime.ts` 中的 `refreshCompletedUpstreamEvidenceDeterministic`、budget-only 调用分支、专属失败出口及仅服务该分支的 helper/import/源码断言。已有其他生产调用的 `upstream_closure_gap` 等出口保留。

合法预算变化继续由原 manifest 授权、身份 rebase、`foldBudgetLineage` / `resolveResumedBudget` 负责。仅改预算不主动刷新或改写已完成上游的 summary、evidence、receipt，不改变身份字段集合、owner/fencing 和硬预算算法。真实需求、范围、源码、环境或门禁变化沿既有检查与责任恢复处理。

复用 `goal-runner-testing-integrity` 中 e9d4b7a3 的测试，改验行为而不是强求旧刷新事件：

- 当前生产 writer 生成的新 facts/evidence 自动来源不含历史 run manifest；显式业务引用仍按原契约检查。
- 预算耗尽后经正式授权提额，继续当前未完成目标；有效上游没有额外 harness/agent 调用，累计 turns 和活跃时长不清零。
- 未授权、预算与真实内容混合变化、实际业务输入损坏仍按已有规则处置；删除仅证明旧实现存在的正则与顺序断言。

### 2.1 保留一条通用入口回归的依据与边界

“事件 PASS、磁盘 summary FAIL”并不只由预算刷新产生：普通 `harness --phase` 经 `harness/harness-runner.ts` 的 `atomicWriteJson(...summary.json)` 写报告，但不追加 goal 的 `phase_verdict`；`--revalidate` 经 `harness/scripts/utils/revalidate.ts` 调用同一路径。携带合法 run 身份的 phase-only 重验能在既有 PASS 后产生新的失败结论，无须旧版控制依赖。

因此保留**一条当前格式、自含夹具的入口回归**，与 t1 共用生产 writer/checker：先产生合法阶段完成事件，再经实际受支持的阶段重验产生当前 FAIL，验证 resume 处理这份归属当前任务的结论，不凭旧 PASS 放行或先消耗无关下游调用。不要手写 FAIL summary 来替代生产路径，也不要靠伪造身份或越过现有权威守卫构造反例。

若现有入口已正确处理，保留验证即可；若失败，仅补现有 `observeFeatureState` / `assessObservation` 与恢复入口的接线，沿已有责任方处理。此项不要求恢复旧 facts、扩大 `resumePostAgentPhases` 资格、另建只重验状态或固定恢复轮数；verifier 复用与真实内容修复分别沿现有策略。

## 3. t3：视觉输出契约与 severity 提示

责任文件为 `profiles/hmos-app/harness/visual-provider-review.ts`、`profiles/hmos-app/harness/visual-diff-check.ts`；JSON 提取复用 `harness/scripts/utils/visual-provider-invoke.ts`。保持现有协议和最终 gate 裁决，格式问题在既有 producer/consumer 中收敛。

- bbox 明确相对本次 device_screenshot 为归一化 `[x,y,width,height]`，四项为 `[0,1]` 有限数；提供合法示例，不静默转换语义不明的像素坐标。
- `must_fix_refs` 明确为本屏 must_fix 的零基索引。示例不含表达式、注释或非法 JSON；用测试 targets、run/attempt 和真实测试 hash 生成样例，通过完整 parser/validator，不绕身份绑定。
- 在既有 JSON 提取链保留原生错误、可确定的位置及有限上下文；字段错误给出路径、实际值和期望。不同解析候选的位置标清，不新增宽松解析器，也不计算 `[3 - 1]`。
- 保留一次局部纠正、同 provider/图像绑定及共享 deadline；持续 invalid 不采信，不改成 unavailable 或 PASS，不沿用失效的旧视觉结果。
- 将[路标 §2.1](../goals/效率与准确率平衡总体目标_默认基线自主交付与可调精细度及可靠恢复_a47c9d62.goal.md#21-必须稳定的底线)的 blocker/major/minor 定义写入现有 prompt，并要求 `note` 给出实际影响与定位。单张截图不可见不直接证明关键操作不可达；提示定义不能保证模型判断永远正确。此项已由用户此前路标修订授权，不新增一次许可环节。

目标测试验证格式、绑定、诊断和有界纠错；severity 判断效果在新宿主运行中观察，不新增模型语义测试矩阵或 benchmark。观察同时使用合法载荷/最终视觉产物及对应调用记录，`validation-diagnosis.json` 只覆盖非法结果，不能据此评价合法但误分级的结果。

编号引用新协议、provider 缓存、两条视觉调用路径的调度改造本批不做。复用现有记录说明实际调用次数、非法原因和结论变化，不添加持久字段或计数器。

## 4. t5：实施、review 与验证

按 [AGENTS.md](../../AGENTS.md) 的既有流程与比例要求执行。先冻结本版范围，目标验证后独立 review；后续只核已提问题和直接回归。当前文件修订不启动实现。

验证集中在本批实际改动：

1. t1 复用预算/恢复测试与一条普通 phase-only 重验入口反例；不重建旧现场或独立长回放。
2. t3 复用 visual-provider/visual-diff 相关测试，覆盖非法 bbox、引用越界、坏 JSON 与一次纠正；保留错图、错身份不采信。
3. 实施中的 typecheck 与目标测试先行；稳定后由一次 `candidate:build` 覆盖全量 unit --release、fixtures、包校验及消费者验证，不先重复跑一遍同样的全量。
4. 同步受影响的现有 OpenSpec、运维指引和可靠性观察。纯文档返修只做 plan、diff、LF 及对应文档校验。
5. 不为省测试隐藏必要的 rules 语义变化；单纯实现/提示修复不做无关 rules 改动。版本、实际门禁与预算变化均据实记录。

指标复用 [1dbe4fa4](./可靠性基线与任务集_指标口径与十三场景及基线记录_1dbe4fa4.plan.md) 的六项口径和采集脚本，另在已有观察材料中记首次可用交付耗时；旧版约 124 分钟是维护者候选验证成本，不是本批通过证据或新运行耗时承诺。

## 5. t6：干净宿主重跑，与 272acb5f 共验

本批宿主验收改为：在确认的需求实施前代码基线上安装已校验发布件，保留原始需求、参考图及必要本机配置，重新执行原需求。旧 run 不保留、不恢复；新任务以新 run、当前配置和明确预算出生，不使用旧余额，也不将新任务当作旧 run 的成功续跑。

与[任务完成可靠性总纲 272acb5f](./任务完成可靠性总纲_统一原则与恢复闭环及可靠性验收_272acb5f.plan.md) 的 `h1-host-regression-closure` 合并为一次宿主运行，逐份映射验收条件和结果。只合并实际适用的场景，不为凑覆盖人为插入失败或追加模型调用；未自然发生的预算追加由 t1 自动回归证明，不声称宿主实测了该分支。

本次核对：

- 按当前需求和现有默认/显式策略自主推进，实际达成核心功能及有效质量目标；severity 有影响依据，模型载荷可用，真实缺陷沿既有责任修复。
- 正式机器完成核验与独立产品验收一致；本次观察到的错误完成数为 0。已知能力缺口按本次新用例和现有契约披露，不把旧 TC 编号当作新任务豁免清单。
- 记录实际预算、恢复路径、agent/provider 调用、人工操作、模型/配置/环境；未执行或未知项明确标注。未取得同初始状态的旧基线时只作历史参考，不宣称受控提升比例。
- 任一共享运行成功不自动关闭其他 plan。未达成的新运行验收仍为 pending；旧 `8d4e6a21` t6 已取消，不能因本次成功改成 completed。

宿主采用仅通过正式发布件集成窗口，不从源仓复制补丁；本计划不授权清空宿主、追加预算或正式发布。取消旧现场依赖不改变这些已有边界。

## 6. 保留与取消的责任

- t2 旧 facts 专用兼容取消；不宣称旧问题已修复，不以新测试替代旧 run 恢复证明。
- t4 独立两条长回放取消；预算和视觉的必要验证分别归 t1/t3，通用事件/summary 入口反例只保留一条。
- severity 定义直接归 t3；暂不建立“默认均衡交付”新 plan，先核实现有默认策略并观察干净运行的真实差距。
- `8d4e6a21` t6 记录 cancelled；新交付责任由本 plan t6 与 272acb5f H1 共同验收，旧现场消失不通过虚标完成处理。
- 现有可靠性指标、故障裁决与阶段责任继续复用，不新增门禁、状态、注册表、外部存储或手工计数器。

## 7. 修订记录

2026-10-11：根据用户放弃旧现场、面向未来的裁决缩小范围。原方案中依赖旧 facts/旧 run 的兼容与回放待办标 cancelled；阶段状态分歧另有现行生产路径，缩为 t1 的单个入口回归。真实验收改为干净宿主共验，历史事故说明保留为设计依据。本次仅修订文档，四项实施待办 pending、两项 cancelled，未改运行时代码或执行宿主。
