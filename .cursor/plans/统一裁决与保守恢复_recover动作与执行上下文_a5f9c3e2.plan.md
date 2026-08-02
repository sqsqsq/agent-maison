---
name: 统一裁决与保守恢复 — recover 动作 / 动态执行上下文 / 两事故闭环
version: 3.0.0
# 版本说明：跟随当前 3.0.0 窗口（不 bump）。
# 稿次：v1 主张「签发端缺失=共同根因」已对码证伪 → v2 重写 → v3 按 codex 二轮 review 做
# 5 点语义修正 + 砍旁支 scope → v4 按 codex 三轮 review 补 4 个契约细节 → v5 按 codex 四轮
# review 补 AuthorityFacts 与三条分层铁律 → **v6（本稿）按 codex 五轮 review 修 P0：
# `vision_lineage=reset` 不得由可伪造 manifest 升级为 authority grant，改为 recovery
# intent（断裂显式记录 + 禁连续性主张）；grants 只装已验证项；terminal 判据措辞放宽为
# 「未来输入或外部状态变化」 → **v6.1 定稿：recover 准绳措辞订正为「不跳过必要验证、
# 也不伪造保证」（原「不降低任何保证」不准确——reset 确实放弃连续性主张，只是显式撤销
# 而非隐瞒）**。签发端移出本 plan、延后独立立项。
# 【定稿】codex 五轮 review 已撤回 head/checkpoint/HWM 扩展建议并认可本稿；
# 不再加结构、不再扩 scope。lineage 断裂的**报告展示**归 d6b1a8e3；真实性继续沿用既有
# HMAC / 弱信任封顶机制，本 plan 不重建真实性体系。
# 影响：release:check-plans 的 3.0.0 未完成 plan +1；a4f7e2b1 降为下游后总数不变。
overview: >
  立项事实（2026-08-02 宿主 bc-openCard 两次无人值守 run 实锤）：
  ① run 20260801T145522Z-16408e —— 未进 spec 即 INTERRUPTED，vision feature_head 失配
  （场外 head 记着 7/29 旧 run 世代 23，仓库 vision/ 已被人为清空）；
  ② run 20260801T153654Z-e00cba —— ut 期 agent 加测试接缝改产品源码，
  unauthorized_source_mutation 求 human receipt 而 HALT。
  **根因：框架没有把「接受风险」与「通过回退重建可信度」分开。**
  两事故各有一条**不跳过必要验证、也不伪造保证**的恢复路（vision **显式撤销历史连续性
  主张**后建新 lineage 全链重验；
  ut drift 失效 coding closure 及其后阶段、回退 coding、把 diff 当未受信候选完整重走），
  都无需人签；框架却把它们与「直接接受变更、跳过重审」这一真正降低保证的动作合并成同一
  决策，统一要求 human receipt——而 human receipt 全仓无签发端（11 种 action / 0 可签发）。
  **恢复执行机制其实已经建成**：失效事务（beginInvalidationTx/commitInvalidationTx）、
  共用回退预算 DEFAULT_MAX_BACKTRACKS、roundFingerprint 熔断、从 coding 起算的
  invalidatedPhases 切片（goal-runner.ts:7509-7546）。缺的不是执行器，是**决策代数里的
  recover 动作**——现有出口只有 advance/retry/halt，无人值守下 halt 即死。
  本 plan 只做四件事：统一事实与动态执行上下文 → 单一 decide() → 通用 recover executor →
  闭环两个真实事故。**不顺手重构历史调用点**（codex 二轮：旁支 scope 已砍，见「移出范围」）。
todos:
  - id: t1-execution-context-and-facts
    content: >
      **统一事实 + 动态执行上下文**。
      ① `ExecutionContext { orchestration: direct|goal; owner_kind: session|process;
      can_prompt_now: boolean; invocation: fresh|resume }`——`can_prompt_now` **来自当前
      run-control owner，不冻结进 manifest**（goal 支持同一 run 在 session↔detached 间
      mailbox handoff，goal-handoff.ts:17/204 已确认 owner_kind 动态切换；冻进 manifest
      identity hash 会让合法 handoff 变成 drift）。manifest 只冻结**用户授权边界**
      （用户启动时声明了什么），不冻结「现在能不能问人」。
      ② 门禁输出环境无关的 `IncidentFacts`：只陈述事实（发生了什么漂移/哪些文件/基线是
      什么），不产动作、不产话术、不读 env。
      ③ 普通模式与 goal 模式**允许不同事实采集器**（普通 ut 用 trace.start_commit，goal 用
      review closure attestation），但归一成同一 `SourceDriftFacts`——两个 provider 产出
      同一种事实，**不删任何数据源**。
      ④ **`AuthorityFacts` 契约 —— 只装已验证的 grant（codex 五轮 P0 收紧）**：
      `{ grants: VerifiedAuthorityGrant[] }`，
      `VerifiedAuthorityGrant = { action: string; source: 'live_operator' | 'verified_receipt'; binding: string }`
      （`binding` = 该授权锚定的对象，如 receipt object_hash）。
      **CLI 旗标 / manifest 字段 / 自然语言一律只是 authority verifier 的输入，
      不得直接成为 grant**——框架既有明文规则：「CLI 旗标可被模型拼出，不构成人工授权」
      （goal-runner.ts:4351）、「无 key 部署下 manifest 文件 + `run_start` 冻结事件整链
      在 agent 可写面，不构成机器可信授权」（goal-runner.ts:3094、
      mutation-authorization.ts:266）。
      本 plan 实际只需：**ut 保守回退不需要任何 authority**（不跳过验证、不伪造保证）；
      **vision reset 亦不进 grants**（改为 recovery intent，见 t3①）；
      **直接接受风险**继续消费既有 verified authority（不变，本 plan 不新增该路）。
      ⑤ **三条铁律边界**（写进类型注释与单测）：
      **(a) `IncidentFacts` 不能产生授权**；
      **(b) `AuthorityFacts` 不能修改或覆盖事实**；
      **(c) `can_prompt_now` 只表示当前能否询问，不代表已获得授权**。
      这三条正面回答立项时的原始质疑「场外数据凭什么比用户指令优先」：**场外 head 只是
      事实证据，本身不具授权优先级；用户声明可以授权「放弃旧 lineage」，但不能把「失配
      这一事实」改成不存在**——两者不在同一层，不存在谁压过谁。
      ⑥ **只删两事故路径必需的那处** env 反推：check-receipt.ts:229
      `can_prompt_user: !isGoalOrchestrationEnv()`（把 goal 有人在场误判成无人）。
      其余 13 处历史调用点**不在本 plan**（见「移出范围」）；改为加 lint 拦住**新增**
      gate 直接读 goal env，存量按 legacy 豁免清单登记、逐步收敛。
    status: completed
  - id: t2-single-adjudicator-with-recover
    content: >
      **单一裁决函数 + IncidentClass + recover 动作**。
      `decide(facts, authority, context) → continue | recover(action) | waiting(kind) | terminal`
      —— **recover 是本 plan 的核心补缺**：proceed|park|halt 只是给现困境换名。
      **IncidentClass 的 SSOT 位置（codex 三轮 P1 订正）**：**不扩展**
      `BlockerActionability`（agent_fixable|human_only|toolchain_blocked，
      goal-failure-classifier.ts:239）——其维度是「谁能修 blocker」，且已被 goal-runner
      回喂过滤/停车（:667-671）、决策梯③层（:6862）、summary-blockers、report-generator
      广泛消费，硬扩会造成歧义。
      既有 `'automatic' | 'human' | 'external' | 'unknown'`（assess.ts:55/71）**不是**
      状态转移维度（v3 稿此说法不准）——它只是 `blockers[].actionability` 的**观测投影**，
      由 goal-reconcile-observation.ts:33 的**私有正则函数**（无 export，
      `/external|device|environment|api/i` 等）生成。
      正确形态：**把该观测字段升级为独立 canonical `IncidentClass`；统一 mapper 归属
      裁决内核（唯一产地/SSOT），reconcile observation 只消费并投影结果、不再自行分类**
      ——否则分类 SSOT 仍藏在观测层。mapper 以显式注册表取代正则，补 `framework_fault`，
      保留 `unknown` 作 fail-safe。
      **6 条误分类只映射不改行为**（codex 二轮：行为订正移出本 plan）：
      pass_snapshot_* / pre_invoke_snapshot_failed / closure_finalization_failed /
      goal_review_closure_baseline_unavailable 先映射到**保持现行行为**的类，并在注册表
      标注 `suspected_misclassified: true`；行为订正归后续 plan（先复现后改）。
      映射须全覆盖以支撑 t4 元门禁——**映射完整 ≠ 行为改动**，这是两件事。
      **等待态单一表达（codex 三轮 P0）**：`waiting(wait_kind: 'human' | 'external')`，
      **不得**同时存在 `WAITING_OPERATOR` 与 external deferred 两套表达。
      **`deferred` 不可直接等同于「等人」**——assess.ts:252 `isDeferredSummary` 把
      **任意 `verdict==='INCOMPLETE'`** 都判 deferred，还含 externalBlocked/device_blocked，
      语义是「外部条件未满足或工作未完成」。因此 park 的落地是：decide 产出
      `waiting(kind)` 为准，**deferred 作为下游投影之一**（保持既有 resolve_deferred /
      completion_status 行为不变），而不是把 waiting 直接映射成 deferred。
      **WAITING 与 TERMINAL 判据**：当前 run 将来还能继续 → `waiting`；
      当前 run **结构上永远无法继续** → `terminal`。
      判据的可操作口径（codex 五轮订正：设备/环境恢复未必是人工动作）：
      **是否存在明确的、可接受的未来输入或外部状态变化，使当前 run 能继续**——
      有则 waiting（等 receipt / 设备就绪 / 环境恢复），无则 terminal
      （`resume + lineage mismatch`、截断链无法回退、回退预算耗尽或同 fingerprint 重现）。
    status: completed
  - id: t3-two-incident-closure
    content: >
      **两个真实事故闭环**（本 plan 验收本体；两条都不需要 signer）。
      ① **vision lineage** —— 新增 manifest 字段 `vision_lineage: 'continue' | 'reset'`
      （codex 二轮 P0：「启动期用户声明」太模糊，不得从自然语言或 fresh 自动推断）。
      **唯一输入入口（codex 三轮 P1）**：CLI `--vision-lineage=reset`，**仅 fresh run 可用**；
      不从需求文本/自然语言推断，不从 `fresh` 自动升级。
      五条规则：缺省 `continue`；只有 fresh run 可选 `reset`；resume 携 `reset` 直接拒绝；
      字段进 manifest identity 字段集与既有 **`run_start`** 事件（goal-runner.ts:4340，
      真名非 run_started，且已在 head 校验 :4558 之前写入——直接复用，不新造事件）；
      运行中不得自动升级为 reset。
      **旧 manifest 兼容（codex 三轮 P1）**：`computeManifestIdentityFields`
      （goal-manifest.ts:111）是**固定字段表**，凭空给旧 manifest 补默认值会让既有 run
      resume 时多出一个身份字段 → 误判漂移。规则：新 manifest **恒显式写入**
      `continue|reset`；**文档中无该键的旧 manifest 行为按 `continue`，且计算身份字段集时
      不得注入该键**（键在场即入哈希，故停机期间被人补写仍会被既有 drift 检测发现）。
      **`reset` 是 recovery intent，不是 authority（codex 五轮 P0——v5 稿把它当
      `source=manifest` 的 grant，等于重开「agent 自签授权」洞：agent 删账本 → 自己加
      `--vision-lineage=reset` → manifest 包装成 grant → 抛弃旧 head，正是 fake-PASS
      防护堵过的路）**。改为六条规则：
      (1) `--vision-lineage=reset` 仍只允许 fresh run；
      (2) **不进入 `AuthorityFacts.grants`**；
      (3) 执行 quarantine → 记录旧 hash → 建立新 lineage → **全链重验**；
      (4) 事件显式记录 `lineage_discontinuity`（含旧/新 hash、原因、run_id）；
      (5) **最终结论只能声称「新 lineage 已全链验证」，不得声称「历史连续性得以保持」**；
      (6) 真正「接受风险并维持原保证声明」的动作，才要求 verified authority。
      安全论证：危险的从来不是 reset 本身，是**静默的** reset。断裂被响亮记录且连续性
      主张被禁止后，agent 即便自行触发 reset 也一无所获——旧 FAIL 不会被洗白，
      只会被标记为「链在此处断开」。该形态与框架既有「弱 ack 允许推进但终态封顶」
      （goal-runner.ts:4351-4353）是同一范式，不新造信任模型。
      行为：`resume + lineage mismatch` → **`terminal`**（绝不冒充连续，现有 fail-closed
      语义不动）；`fresh + vision_lineage=reset` → `recover(reset_lineage)`。
      **quarantine 生命周期闭合**（codex 二轮 P0：v2 稿「改名留痕不销毁」与「场外不得成为
      档案库」自相矛盾）——改为**事务性**：reset 前临时改名（供事务失败回滚）→ 新 lineage
      head 写入并验证成功后**删除旧场外实体** → 旧 hash/新 hash/原因/run_id 写进
      **repo 内事件**。留痕保留可验证证据，不永久保存场外文件本体（对齐 b7e4d2a9
      「成功封卷即删」）。
      同时补该族 guidance builder——goal-runner.ts:4563 feature head 失配现为**裸 throw
      无 builder**；铁律照 await-confirm-guidance：只列当下真正可走的路。
      ② **ut 改码 drift** —— 检测到 drift → 不当作 ut 合法输出 → **失效旧 coding closure
      及其后的 review/ut/testing**（codex 二轮 P1：现有实现本就从 coding 起算，
      goal-runner.ts:7510 `chain.slice(codingIdx, phaseIdx+1)`；v2 稿写「失效 review/ut/
      testing」会与实现矛盾，报告里出现「旧 coding 已通过」+「携未受信 diff 重跑」并存）
      → `recover(backtrack_to_coding)` → 携未受信 diff 重走 coding/review/ut/testing →
      有界（共用 DEFAULT_MAX_BACKTRACKS + roundFingerprint 熔断），**耗尽或同 fingerprint
      重现即 `terminal`**（与 t2 判据、验收口径一致；run 内无从调整该常量）。
      **实现纪律（codex 二轮 P0 订正 v2 稿措辞）**：**不是「解锁 authorized_backtrack」**。
      v2 稿称 goal-runner.ts:7614 `adjudicationAlreadyAvailable:false` 是封锁开关——**错**，
      那只是 guidance builder 的入参；真正的闸是 classifySourceDrift 的分类结果。正确做法：
      **复用执行机制**（失效事务 / 回退预算 / phase 回退执行器），**不复用授权语义**——
      新路径不产 `matched_receipts`（goal-runner.ts:7540 该字段属授权通道）、不标 authorized，
      决策原因记为 `untrusted_source_drift_revalidation`。
      **边界**：截断链（chain 不含 coding/review，如 --start ut）结构上无法回退 →
      **`terminal`**（须新起 coding 起点 run）——沿用现有
      `authorized_mutation_requires_full_chain` 语义，不新造。
    status: completed
  - id: t4-consistency-and-projection
    content: >
      **一致性与投影（定义 + 自证，不改消费方）**。
      ① 一致性（**codex 三轮 P1 订正**：v3 稿要求「三种模式 IncidentFacts 逐字段相同」
      与「允许不同 baseline provider」自相矛盾——provenance/baseline 类型天然不同）。
      改为两条可同时成立的契约：
      **(a) 相同原始证据 → 相同 canonical facts**（同一份 drift 证据经任一 provider
      规范化后 canonical 部分逐字段相等；`provenance` / `baseline_kind` 等来源字段
      **允许不同**，不入等值断言）；
      **(b) 相同 facts + authority + context → 相同决定**。
      要一致的是 **schema 与裁决规则**，不是强迫证据来源伪装成一样。
      ② 全覆盖：任一 incident 未映射到 IncidentClass → 单测失败（沿用本仓显式注册表先例；
      新套件须注册进 CORE_SUITES，不注册=假绿）。
      ③ lint：**新增** gate 直接读 `isGoalOrchestrationEnv` / `isGoalHeadlessEnv` /
      `process.env.MAISON_GOAL*` 即红；存量按 legacy 豁免清单登记。
      ④ **定义并发布统一 disposition**：`RESUME_READY | RECOVERY_PENDING |
      WAITING(wait_kind: human|external) | TERMINAL`，由 decide 单点产出并落 events。
      等待态只此一种表达（不再另设 WAITING_OPERATOR 与 external deferred 两套）。
      **本 plan 只负责定义 + 断言 decide 侧正确**；report / monitor / supervisor 的消费方
      改造**移出本 plan**，分别归 d6b1a8e3 与 a4f7e2b1（codex 二轮：不顺手改三类消费者）。
      ⑤ 单测须真正命中目标分支（本仓硬学习：改 state 不重算 MAC 只测了坏 MAC 分支）。
    status: completed
isProject: false
---

## 根因订正史（v1 → v6）

| 稿次 | 主张 | 结局 |
|---|---|---|
| v1 | 共同根因 = 人类授权链缺产端（11 action / 0 可签发） | **证伪**：恢复执行机制已建成，只是决策代数缺 recover |
| v1 | 前移预授权须绑内容 fingerprint | **自相矛盾**：fingerprint 只能事后算（mutation-authorization.ts:296） |
| v1 | reachability 冻进 manifest 身份哈希 | **真 bug**：owner_kind 同 run 内 session↔process 切换，冻结使合法 handoff 变 drift |
| v1 | 25 门禁 × 3 档 = 75 格裁决表 | **过度建设** |
| v2 | 7614 `adjudicationAlreadyAvailable:false` 是封锁开关 | **不准确**：那只是 guidance builder 入参，真闸在 classifySourceDrift |
| v2 | ut 回退失效 review/ut/testing | **与实现矛盾**：现有实现从 coding 起算（:7510） |
| v2 | quarantine 改名留痕不销毁 | **与场外红线冲突**：无删除时点即成档案库 → 改事务性 |
| v2 | 四类扩展 BlockerActionability | **维度错配** → 独立 canonical IncidentClass |
| v3 | 既有 `automatic\|human\|external\|unknown` 是「状态转移维度」 | **不准确**：只是观测投影，由私有正则生成（无 export）→ SSOT 须归裁决内核 |
| v3 | park 回落既有 deferred 通道 | **语义错配**：`isDeferredSummary` 把任意 INCOMPLETE 判 deferred（assess.ts:252），不是「等人」 |
| v3 | 三种上下文 IncidentFacts 逐字段相同 | **自相矛盾**：与「允许不同 baseline provider」冲突 → 拆成两条契约 |
| v3 | vision_lineage 只定义字段 | **缺输入入口与旧 manifest 兼容**：固定字段表补默认值会让既有 run resume 误判漂移 |
| v4 | 模型图出现 `AuthorityFacts` 但无定义 | **契约缺口** → t1④ 补最小契约 + t1⑤ 三条分层铁律 |
| v4 | 回退震荡熔断为 wait | **违反自身判据**：`DEFAULT_MAX_BACKTRACKS` 是硬常量、GoalBudget 无对应字段，run 内无人工动作可解 → 改判 terminal |
| v4 | 事件名写作 `run_started` | **真名是 `run_start`**（goal-runner.ts:4340，且已在 head 校验前写入）——复用不新造 |
| v5 | `vision_lineage=reset` 作 `source=manifest` 的 authority grant | **重开「agent 自签授权」洞**：旗标可被模型拼出（:4351）、manifest+run_start 在 agent 可写面（:3094）→ 改为 recovery intent，不进 grants |
| v5 | terminal 判据写「人工动作」 | 设备/环境恢复未必是人工动作 → 改为「明确可接受的未来输入或外部状态变化」 |

签发端缺口本身**是真的**（全仓无签发命令、trust registry 无 bootstrap、
await-confirm-guidance.ts:112 硬编码 false、被 4 个 change 推迟至今），但它是独立 backlog，
不是本两事故的必经解。顺序：**先减少需要签字的事情，再建签字系统。**

## 立项证据链（逐条已对码核实）

| # | 事实 | 位置 |
|---|---|---|
| 1 | 恢复执行机制已建成：失效事务 + 共用预算 + 指纹熔断 + 从 coding 起算切片 | `goal-runner.ts:7509-7546`、`:7712` |
| 2 | 但只有携 human 裁决 receipt 才进得去 | `mutation-authorization.ts:296` → `authorized_backtrack` |
| 3 | 该通道深度绑授权语义，不可裸复用 | `goal-runner.ts:7540` `matched_receipts` |
| 4 | 11 种 receipt action 全有验签、零签发；registry 无 bootstrap | `confirmation-receipt.ts:59/141`；`harness/package.json` |
| 5 | 启动期 11 条 fail-closed 全在 vision 锚族，4563 裸 throw 无 builder | `goal-runner.ts:4414–4712` |
| 6 | owner_kind 同 run 内动态切换 | `goal-handoff.ts:17/204`；`goal-mode/SKILL.md:42` |
| 7 | 唯一算过求人谓词的地方算错了 | `check-receipt.ts:229` |
| 8 | 观测层已有 actionability 投影，但由**私有正则**猜 blocking_class 生成（无 export） | `goal-reconcile-observation.ts:33`；`assess.ts:55/71` |
| 9 | BlockerActionability 消费面广、维度是「谁能修」 | `goal-runner.ts:667-671/6862`；`summary-blockers.ts:44` |
| 10 | `deferred` 语义 ≠「等人」：任意 INCOMPLETE 亦判 deferred，故只能作下游投影 | `assess.ts:252`；`goal-mode/SKILL.md:56` |
| 11 | 正确样板已存在（预登记→机器消费） | `device-credential-store.ts`；宿主 run e00cba 实证 |

## 模型：三种模式的差异不是 run 的身份

本质轴是**人的应答延迟**，但它是当前 owner 的动态能力，不是不可变身份：

```
同一个 run
  session owner  → can_prompt_now = true
  handoff ↓
  process owner  → can_prompt_now = false
  handoff ↓
  session owner  → can_prompt_now = true
```

设计律：**任何只有人能决定的门禁，若在 run 中途才第一次开口问，无人值守下就是必死。**
正解**不是**把授权前移（v1 已证伪不可行），而是：**先判这件事是否根本不需要人**——
能靠保守恢复重建可信度的，一律 recover，不进求人通道。

最终决策形态：

```
IncidentFacts + AuthorityFacts + ExecutionContext
                    │
                    ▼
                 decide()
                    │
   continue | recover(action) | waiting(kind) | terminal
```

## 硬约束

1. **recover ≠ 放行**：recover 的准绳是**不跳过必要验证、也不伪造保证**——不是「不降低
   任何保证」（措辞订正：`reset` 确实**放弃**历史连续性这一主张，只是显式撤销而非隐瞒；
   ut 回退亦以完整重验换回可信度，而非声称原保证仍然成立）。
   「直接接受变更跳过重审」永远属
   operator 类。两者在 decide 里必须是不同分支，且 recover 路径不得产出授权语义字段。
2. **`vision_lineage=reset` 五规则 + 唯一入口 + 旧 manifest 兼容**（见 t3①）：缺省
   continue / 仅 fresh 可选 / resume 携 reset 直接拒绝 / 进 identity 字段集 + `run_start` /
   运行中不得自动升级；唯一入口 `--vision-lineage=reset`；**旧 manifest 缺该键时按 continue
   且不得注入该键入身份字段集**（否则既有 run resume 误判漂移）。
2b. **等待/终止判据单一**：`waiting(wait_kind: human|external)` 是唯一等待表达；
   口径=**是否存在明确、可接受的未来输入或外部状态变化使本 run 能继续**（未必是人工
   动作）。有 → waiting（等 receipt/设备就绪/环境恢复）；
   无 → terminal（`resume + lineage mismatch`、截断链无法回退、回退预算耗尽或同
   fingerprint 重现——`DEFAULT_MAX_BACKTRACKS` 是硬常量，run 内无从调整）。
   **`deferred` 不等同于等人**（assess.ts:252 把任意 INCOMPLETE 判 deferred），
   只作下游投影，不作 decide 的输入或同义词。
2c. **授权与事实分层**（t1⑤三铁律）：facts 不产授权 / authority 不改事实 /
   `can_prompt_now` 不等于已授权。场外锚是事实证据，无授权优先级。
2d. **`AuthorityFacts.grants` 只装已验证 grant**：CLI 旗标 / manifest 字段 / 自然语言
   一律只是 verifier 输入（框架明文：旗标可被模型拼出、无 key 时 manifest+run_start
   在 agent 可写面）。`vision_lineage=reset` 是 **recovery intent 不是 authority**，
   不进 grants；其安全性由「断裂显式记录 + 禁止连续性主张 + 全链重验」保证。
3. **quarantine 事务闭合**：临时改名 → 新 lineage 验证成功后删除场外实体 → 证据入 repo
   内事件。不在 `~/.maison` 永久积累备份（b7e4d2a9 场外红线）。
4. **不得放宽 fake-PASS 防护**：3.0.0 无头假 PASS 事故链每条闸门改造后须仍成立；
   视觉账本单写者、账本不可被 agent 改写等红线不动。
5. **不造第二套模型，但真值与投影分清**：**`IncidentClass` 由裁决内核持有，
   reconcile actionability 只是兼容投影；`waiting(kind)` 是裁决真值，`deferred` 只是下游
   兼容投影**。回退用既有失效事务/预算/执行器；进程身份判据继续单一。
6. **两 provider 归一，不删数据源**。
7. **映射完整 ≠ 行为改动**：6 条疑似误分类本 plan 只映射 + 标注，不改行为。

## 移出本 plan 的范围（codex 二轮采纳）

| 项 | 去向 |
|---|---|
| 6 条失败类型的**行为**重分类 | 后续独立 plan（先复现后改）；本 plan 只映射 + 标注 |
| 13 处存量 env 反推调用点清理 | legacy 豁免清单登记，逐步收敛；本 plan 只删 check-receipt.ts:229 + 加新增拦截 lint |
| report / monitor / supervisor 消费方改造 | 分归 d6b1a8e3 与 a4f7e2b1；本 plan 只定义并发布 disposition |
| confirmation-credential-issuance（signer） | 独立延后立项；只服务「接受风险」，不参与保守恢复 |

## 验收方向

- **立项两现象直验**（主验收）：以宿主 run `20260801T145522Z-16408e` 与
  `20260801T153654Z-e00cba` 的现场状态作 fixture——前者 `fresh + --vision-lineage=reset`
  走通 reset_lineage 并全链重验（`resume + mismatch` 判 terminal；`resume + reset` 拒绝）；
  后者在无人值守下自动 `recover(backtrack_to_coding)` 完成重验，**全程无 human receipt**，
  且事件中**不出现 matched_receipts/authorized 语义**。
- **一致性直验（两条契约）**：(a) 同一份原始 drift 证据经 direct provider 与 goal
  provider 规范化后，**canonical facts 逐字段相等**（provenance/baseline_kind 允许不同，
  不入断言）；(b) 相同 facts + authority + context → decide 输出相同。
- **旧 manifest 兼容**：无 `vision_lineage` 键的既有 run resume，身份字段集与冻结值
  逐字段相等（不得因新字段出现漂移）；补写该键后 resume 被 drift 检测拦下。
- **分层铁律**：单测锁死 facts 不产授权 / authority 不改事实 / `can_prompt_now=true`
  单独不足以放行任何需授权动作。
- **reset 不可伪装成连续（负例断言）**：构造「agent 自行加 `--vision-lineage=reset`」
  场景——run 可继续（保守恢复不被卡死），但 (a) `AuthorityFacts.grants` 为空、
  (b) 事件必含 `lineage_discontinuity`、(c) 最终报告**不得出现任何历史连续性主张**。
  即 agent 触发 reset **一无所获**：旧 FAIL 不被洗白，只被标记为链在此处断开。
- **元门禁自证**：新增未映射 incident → 单测红；新增 gate 读 goal env → lint 红。
- **quarantine 事务**：reset 中途崩溃可回滚；成功后场外无残留实体，repo 内事件含新旧 hash。
- **有界性**：回退震荡（同 roundFingerprint 重现）与回退预算耗尽均熔断为 **`terminal`**
  ——`DEFAULT_MAX_BACKTRACKS` 是 phase-transition-policy.ts:391 的**硬常量**、`GoalBudget`
  无对应字段，run 内**无任何人工动作可解**，按判据即结构上无法继续；话术给「检查原因后
  新开 run」，**不新增 override-budget / 人工解熔机制**。
- **回归**：unit 全绿；`check-plan-version --release`；普通模式行为与改造前逐项等值
  （fail-open 纪律——无新输入不改判）。

## 与既有 plan 的关系（实施顺序）

```
1. 本 plan   统一事实 + decide() + recover executor + 两事故闭环
        ↓
2. d6b1a8e3  消费统一 disposition：reducer / 报告一致性 / 硬预算断言（不再自行分类事故）
        ↓
3. a4f7e2b1  心跳 / 进程续命 / 声明式唤醒：按 disposition 决定恢复或停车（不解释原始 halt_reason）
        ↓
4. signer    可选、最后；只服务「接受风险」，不参与保守恢复
```

| plan | 处置 | 理由 |
|---|---|---|
| `d6b1a8e3` | **降为下游消费者**（另承接 lineage reset 的报告展示） | 最终报告须明确展示「lineage 已 reset / 历史连续性已撤销」——本 plan 只负责写 `lineage_discontinuity` 事件与禁止连续性主张，**展示层归 d6**；此外 t3 硬预算、t4 证据卫生基本正交；**t2 monitor stale 不正交**——引入 RECOVERY_PENDING / WAITING(kind) 后 monitor 与 report 必须从同一 reducer 理解新状态，否则决策层说「正在恢复」而 monitor 显示 HALTED。其集成测试床复用于验证 disposition 投影 |
| `a4f7e2b1` | **最后实施，须改核心假设** | 现稿 supervisor 按原始 halt_reason 判断能否重启（t2），会原地复活再死。改为**只消费统一 disposition**——supervisor 不应理解 vision_ledger_tamper、testing_write_violation、receipt 等业务原因 |
| `confirmation-credential-issuance` | **独立延后立项** | 先做完 recover 收敛，再盘点「移除过度求人后仍真正降低保证」的剩余 action（如 human_visual_acceptance 真人逐屏看图无回退替代品），只为最小子集建 signer |
