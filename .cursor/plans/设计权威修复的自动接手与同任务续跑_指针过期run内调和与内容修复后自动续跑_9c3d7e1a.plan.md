---
name: 设计权威修复的自动接手与同任务续跑 — 指针过期在 run 内调和、内容修复后自动续跑（重新接入或自动后继）（总纲 272acb5f 的 P4 t5 残留）
version: 3.1.0
overview: >
  总纲 272acb5f 的补充子 plan。P4 的 t5 承诺"结果依据类的失败必须有可执行的责任方恢复出口"，返修后设计权威在链内
  无法兑现的情形只做到"首次即停、说明指向设计 owner"，处置为等外部：设计 owner 不会被派去修，修好后也不会自动续跑
  （codex 最终评审第二轮；总纲 §14 更正四）。本 plan 把它做成闭环。
  取证（scratchpad design-owner-takeover-facts.md，HEAD cc4d5139）：设计权威无效只有两类根因。A 类是蓝图指针过期
  ——蓝图升到更高的已准入 revision、CU 还指着旧的，既有调和器 reconcileChangeUnitBlueprintRefs 能确定性修好，不涉及
  设计判断；B 类是蓝图或 CU 的内容本身坏了、未决、未准入、有冲突，要改设计内容，现行规范要求新事实或权威裁决，
  其中一部分在既有授权内就能修，另一部分需要新的产品选择。今天两类被压成同一个 invalid 加一段文本；停机事件不带探针，supervisor 不会唤醒；修好后
  重发同一请求虽能重新接入同一 run，但无人值守有 5 分钟冷却且改蓝图不算"变化"；蓝图内容变了之后 run 冻结的派生
  绑定会失效，失效的绑定不会自动进入重签。宿主证据：B 类真实停机 1 次（97af3f，人修蓝图后被两个后继取代，任务至今
  未完成），A 类会话级停顿 1 次（已由 3a6a72d2 改路由）。
  ---
  三条主线：①把两类根因在源头区分开，不解析文本。②A 类在同一 run 内由框架调用既有调和器修好、原地重评当前阶段；
  调和器入口加两层锁（蓝图锁 + 受影响 feature 的锁）作写入所有权边界；不新增停机原因、状态、CLI 或第二套写入机制，只把调和器的调用位置扩到
  goal 运行时，并修订对应规范。③B 类先分成两种：B1 在既有授权内、依据明确的修复（内容形状坏了、引用过期等），
  由设计责任方接手——有人在场时停机说明直接交给会话里的设计 owner 照 /component-design 修、修完重发；B2 需要
  新的产品选择、扩大范围或缺少事实的，停等有权者。两种都给停机挂探针并**停放时释放 run 锁**：修好后 supervisor
  自动唤醒；重发或唤醒时由运行时同一处判断——绑定仍有效则重新接入同一 run 重评，派生绑定已失效则自动从停机 run
  起后继，都不需要操作者拼命令。④无人值守时 B1 由框架派设计修复自动接手（t6，用户 2026-09-30 裁定并入本 plan）：
  预授权写在 framework.local.json；整个尝试在两层锁内；agent 只改隔离草稿（只含蓝图文件），运行时在 run 内派两次链外 adapter 调用
  ——编写修复、隔离上下文的独立质询（草稿里的旧质询先作废）——对草稿做真实校验、机器派生并写回准入，通过后由运行时作单写者发布，再走
  加锁的 readiness 与探针，通过才续跑；发布前失败丢弃草稿、不发布（越界写入走既有违规处置，只检测不承诺还原），发布后不回滚、
  探针不通过记未恢复并按新状态停机披露。每个停机签名只试一次（attempted 落盘后才派发，恢复与后继按 events 回放判重；
  未取得锁、未派发的竞争退出不消耗这次机会）。B2 永不派发。
todos:
  - id: t1-reason-split
    content: >
      批一 §3：区分两类根因。deriveBlueprintSkillInput 的 invalid 带结构化原因（至少区分指针过期与其它），
      检查结果经既有 structured 通道携带；plan 阶段指针过期改走 reconcile 路线并带 repair_owner external；
      删除按错误码字符串猜路线的不可达分支。
    status: completed
  - id: t2-in-run-reconcile
    content: >
      批一 §4：A 类 run 内自动调和。决策梯在设计 owner 停机之前先判"是否指针过期的调和候选"，是则经加了两层锁（蓝图锁 +
      受影响 feature 的锁，竞争即退出）的唯一入口调用既有 reconcileChangeUnitBlueprintRefs；本 CU 升版即原地重评当前阶段并记事件，本 CU 被跳过或失败
      落回既有停机，兄弟 CU 的跳过只披露。修订 OpenSpec change-unit-continuous-progression 的调用位置条款。
      真实链路验证：先出生冻结旧绑定、再注入升版，同一 run 完成。
    status: completed
  - id: t3-probe-and-rejoin
    content: >
      批二 §5：B 类的分工与修好后自动续跑。停机事件带 B1/B2 分类与修复简报；停放时释放 run 锁；新增探针
      design_authority_projectable（只读重跑投影/校验）；supervisor 唤醒；运行时恢复入口一处判断"原 run 继续还是
      起后继"，普通重发、supervisor resume、进程内唤醒都消费它；接续决策把"停机所挂探针已就绪"作为一种变化越过冷却。
      真实链路验证：重接入、自动后继、supervisor 唤醒且绑定已失效三支都正确完成；设计 owner 经真实 readiness 入口修。
    status: completed
  - id: t4-scenarios
    content: >
      批二 §6：场景 S14（A 类 run 内调和）与 S15（B 类停机 → 修好 → 自动续跑，含 supervisor 唤醒分支）进
      reliability-scenarios 套件并登记基线；S4 保持原期望；六项指标复跑。
    status: completed
  - id: t5-docs-spec-closure
    content: >
      批三 §7：手册、MIGRATION、OpenSpec 增量；总纲 §14 记录。P4 plan t5 的关闭按 §7 的唯一口径：本 plan t1–t6 全部
      验收通过。
    status: completed
  - id: t6-unattended-b1-takeover
    content: >
      批三 §5.5：无人值守时 B1 由框架派设计修复自动接手。预授权键 design_repair.unattended_b1；整个尝试在两层锁内；
      agent 只改隔离草稿；run 内派编写修复与独立质询两次链外 adapter 调用（草稿旧质询先作废）；对草稿真实校验、机器派生并写回准入
      （从 validateBlueprintAdmission 提取派生函数）；运行时作单写者原子发布；加锁 readiness、探针通过后走同一恢复
      判断续跑。发布前失败丢弃草稿；草稿外越界走既有违规处置（只检测）；发布后不回滚、探针不通过记未恢复。attempted 落盘后才派发，恢复与后继回放判重，竞争退出不消耗机会；
      B2 永不派发。无人值守修复子契约文档；OpenSpec 与 schema 增量；场景 S16 与七个反例。
    status: completed
---

## 1. 目标与冻结范围

目标：设计权威在链内无法兑现时，能自动修的自动修；在既有授权内能由设计责任方修的，交责任方接手（有人在场交会话里的设计 owner，无人值守由框架派设计修复）、修好后自动续跑；只有需要新的产品选择或缺少事实（真缺授权）、或另一执行者正在写入（竞争退出）时才停等。

本 plan 完整承接 P4 t5 的承诺：A 类自动修、B 类修后自动续跑、B1 在两种运行方式下都有责任方接手（t6 由用户 2026-09-30 裁定并入）。

冻结范围：

- 触发面只有两处：`checkAuthoritativeContentAligned` 的无效分支；CU 施工投影里走 `reconcile_blueprint` 路线的检查。
- 不改任何检查的判定逻辑，不改 admission 的派生规则，不改调和器的跳过条件。
- 不新增停机原因、run 状态、CLI、第二套 CU 写入机制。新增只有：一个探针名、一种"变化"事实、一种纯记录事件（§4.3）、调和器入口的锁作用域（复用既有锁实现，§4.2）、停机事件里的 B1/B2 分类与修复简报字段（§5.0）、一个预授权配置键 `design_repair.unattended_b1`、一条 run 内派发路线（隔离草稿 → 两次链外调用 → 机器裁决 → 单写者发布）、事件的 `content_repair` 动作与 `attempted` 记账阶段、一份无人值守修复子契约文档（§5.5）。
- 无人值守派发只限 B1；B2 永不派发；agent 不得自报准入、不得写质询结果给自己的修订。

## 2. 现状事实（取证 2026-09-30，HEAD cc4d5139）

| 事实 | 位置 |
|---|---|
| invalid 的原因只是 `String(error)`，没有原因码 | `blueprint-skill-projection.ts:284` |
| A 类由 `validateChangeUnit` 报 `change_unit_blueprint_ref_stale`（route reconcile），调和器 `reconcileChangeUnitBlueprintRefs` 是写盘的库函数：枚举同一蓝图下全部 CU，逐个升版或跳过，整批校验后写、中途失败按旧字节回滚，有确定的跳过条件；它自身没有跨进程互斥 | `change-unit-validator.ts:126-142`；`change-unit-design-preparation.ts:302-375, 433` |
| 蓝图内容变化后，run 冻结的派生绑定按内容指纹判 stale，解析器把输入置为 invalid；范围修订的生产者要求输入已解析且无未披露的 FAIL——所以 stale 绑定不会自动进入范围重签 | `capability-resolution.ts:692-699`；`blueprint-skill-projection.ts:43` |
| goal 运行时持有 feature 锁；接续决策可从未终局的 run 起后继（承接、在出生时重新解析绑定） | `goal-phase-runtime.ts:4019-4024`；`goal-run-creation.ts:771-796` |
| plan 阶段的指针过期经 `resolveChangeUnitRef` 落成 `change_unit_invalid` / `repair_feature_mapping`，不带 `repair_owner:'external'`，进不了设计 owner 出口；`code.includes('blueprint')` 那条 reconcile 分支实际不可达 | `change-unit-path.ts:193-201`；`change-unit-feature-projection.ts:625-632` |
| goal 运行时不调用任何设计侧写入器 | `change-unit-design-preparation.ts:473/511`、`prepare-blueprint-design.ts:10` 是仅有的调用点 |
| 设计 owner 停机以 `execution_scope_unresolved` 落 WAITING/external，事件不带 probe；supervisor 只唤醒带 probe 的外部等待；探针只有 5 种 | `goal-phase-runtime.ts:9559-9586`；`goal-supervisor.ts:77-110`；`condition-wait.ts:29-56` |
| 修好后重发同一请求会重新接入同一 run（隐式 rejoin 绕过 `--force-resume`）；无人值守且无"变化"时 5 分钟冷却；改蓝图不算六种变化之一 | `goal-run-creation.ts:607-614, 809-827`；`goal-phase-runtime.ts:6277` |
| 规范：原位升版只由设计准备段这一个 writer 执行、升版后由 successor 补 uncovered 义务；设计准备子流程停在 Goal Mode 之前 | `openspec/specs/change-unit-continuous-progression/spec.md:304, 390-391` |
| 规范与技能：蓝图内容修订需新事实或权威裁决；component-design 不进 Goal Mode；admission 由机器派生不可自报；没有条款授权 goal agent 改蓝图或 CU | `app-component-blueprint/spec.md:460, 535, 601`；`component-design/SKILL.md:34-35, 121-122`；`blueprint-admission.ts:70-72` |
| 已有"预授权 + run 内自动改身份 + 续跑"的范式：型号获准替代 | `goal-phase-runtime.ts:5783-5790` |
| A 类升版后同一 run 的冻结输入绑定按身份中立摘要比较，原则上不失效；B 类内容变化会让派生绑定报 stale，手写产物转漂移由链内重写——这条全链没有跑验证 | `capability-resolution.ts:537-586`；`blueprint-skill-projection.ts:43-105` |
| 宿主：B 类真实停机 1 次（97af3f，人修蓝图 → 两次 `--supersede`，任务未完成）；A 类会话级停顿 1 次；其余相关检查 0 次 | `scripts/tests/fixtures/reliability/20260924T135354Z-97af3f/events.jsonl:22-23`；`b2d7f4e9.plan.md:1558` |

## 3. 区分两类根因（t1）

- `deriveBlueprintSkillInput` 的 `invalid` 结果增加结构化原因：`reason: 'blueprint_ref_stale' | 'other'`，来自 `validateChangeUnit` 的 issue code，不解析 detail 文本。`checkAuthoritativeContentAligned` 把它放进检查结果既有的 `structured` 字段（`kind: 'design_authority', reason`）。
- CU 施工投影：`resolveChangeUnitRef` 失败的路线直接取验证器 issue 的 `route`（`change_unit_blueprint_ref_stale` → `reconcile_blueprint`），删除 `code.includes('blueprint')` 的猜测分支。plan 阶段的指针过期因此带上 `repair_owner: 'external'` 与同一 `structured`。
- 判别函数：`pointerStaleCandidate(projectRoot, feature)`，只读，复用 `loadCanonicalChangeUnit` + `validateChangeUnit`，当且仅当 BLOCKER 只有 `change_unit_blueprint_ref_stale` 时为真。它的含义是"仅发现指针过期、可以尝试机械调和"，不是"纯指针问题"：新蓝图内容坏了或 carry-forward 会失败的情况在这一步看不出来，由调和器的跳过条件与调和后的重评兜住，不另造一套预检。运行时与探针共用它。

## 4. A 类：run 内自动调和（t2）

### 4.1 位置与动作

决策梯在现有设计 owner 分支之前加一条：`designOwnerBlockers` 非空且 `pointerStaleCandidate` 为真 →

1. 调用 `reconcileChangeUnitBlueprintRefs(projectRoot, blueprintId)`（同一个 writer 函数，不复制逻辑）；
2. 成败按**本 CU** 判：本 CU 被升版、或已是当前身份 → 记事件，`driverGuardAction = 'retry'`，当前阶段原地重评（重新调用阶段执行者，再过门）。同一蓝图下其它 CU 的跳过只披露在事件里，不因此停机；
3. 本 CU 被跳过或调和抛错 → 落回既有设计 owner 停机，说明附上跳过原因（调和器自带的原因文案）。

### 4.2 前提与守卫

- 同一 run 的冻结输入绑定在指针升版后仍有效（身份中立摘要）——先做探针式真实测试（§8 A3）。若不成立，本条改为"调和后按 §5.3 的判据起后继续跑"；不得放宽绑定校验。
- **写入所有权边界**：调和器的写集是整个蓝图——它枚举同一 `blueprint_id` 下全部 CU，改 canonical CU 与各 feature 下的带戳投影 / contracts.yaml。要挡住的竞争有两种：两个调和器并发；调和器与某个 feature 正在跑的阶段写入（agent 在 plan 阶段写 contracts.yaml，只持该 feature 的 run 锁）。所以互斥放在调和器唯一入口上，两层都复用既有 `goal-run-lock` 的锁原语，不新增第二套锁实现：
  1. **蓝图级锁**（锁文件放该蓝图的工作区下）：串行化调和器本身，从枚举、读取、校验、写出到回滚全程持有；
  2. **受影响 feature 的锁**：调和器在读取之前，对本批写集涉及的每个 feature 取它既有的 feature 锁——调用方已持有的（goal 运行时对本 feature）由调用方把锁记录借给调和器并继续持有，不再调 `tryAcquireLock`（它不支持同 owner 重入）；其它 feature 的锁能取到才继续；任一取不到（别的 run 正在跑或别的会话持有）即**竞争退出**，一个字节不写。
  这样调和器的整批写入与各 feature 的阶段写入共享同一个互斥边界。竞争退出时：runtime 不等待，落回既有设计 owner 停机并在说明里写明"另一执行者正在写入，竞争解除后重发同一请求即可，不需要改设计内容"；readiness 报"忙"退出。设计准备段的 readiness 与 goal 运行时都经这一个入口。调和器自身的原子替换与回滚不作为并发安全的依据。
  代价：同一蓝图下多个 feature 同时在跑时，A 类的 run 内调和会经常竞争退出、退化为停机；本版接受这个保守边界，不宣称并发场景也能自动闭环，也不保证锁释放后自动续跑（需重发请求或 supervisor 探针唤醒）。
- 框架自己的写入不经 agent 写边界；阶段写边界对 canonical CU 与 feature 下 contracts.yaml 的记账要如实（这两份文件的 owned 记录来自框架动作，不是 agent 写入）。
- 每次 run 内调和计一轮，不豁免内容重试预算；调和后重评仍失败的，走既有的当前阶段修复与无进展守卫。

### 4.3 事件

新增一种纯记录事件 `design_authority_repair`（字段：phase、blueprint_id、action: 'pointer_reconcile' | 'content_repair'、bumped、skipped、reason；content_repair 另带 outcome、失败步骤、涉及文件、新 revision，见 §5.5），供归因与报告解释"这一轮是框架做了设计侧修复"，不参与裁决；不借用带型号授权语义的 `manifest_identity_rebase`。goal 报告渲染这条事件。准入两问：改善的场景是宿主 A 类会话级停顿与 S3 那类蓝图升版；事件本身的收益是动作可归因、报告可解释——调和功能的收益（升版后正在跑的 run 不再停下等人）归 §4.1。

### 4.4 规范修订

OpenSpec `change-unit-continuous-progression`：

- `:304` 原位升版的执行位置由"只由设计准备段"改为"由同一个 writer 函数执行；调用位置有两处：设计准备段（派生 readiness 前）与 goal 运行时（本 run 的门报告指针过期的调和候选时）；写入前取蓝图锁与受影响 feature 的锁，竞争即退出"。writer 仍唯一。
- `:390-391` 保留"设计准备子流程停在 Goal Mode 之前"；补一句：goal 运行时内的调和不是设计准备子流程，只做指针原位升版，不做候选接受、不选 CU、不触碰 closure。
- "升版后由 successor 补 uncovered 义务"保留为完成后升版的路径；run 内调和是运行中升版，续跑在同一 run。

## 5. B 类：责任方接手与修好后自动续跑（t3）

### 5.0 B1 与 B2 的分工

规范要求蓝图修订依据新事实、权威裁决或冲突解决，并不是每一处内容修改都要新增一次人的授权。按既有 issue code 与路线把 B 类分成两种，停机事件与说明都带上分类和修复简报（哪个产物、哪条检查、依据是什么）：

| 类 | 判据（取自既有 issue code，实施时按取证清单 §1、§2 列全，codex 逐条评审。"拿不准归 B2"与"既有授权内、依据明确"连用：形状错误本身不证明可直接修，像 `change_unit_schema_invalid`、`change_unit_design_ref_unresolvable` 这类混合原因码，只有能依据既有权威恢复的才算 B1，缺写集、缺决策依据或缺明确替代目标的归 B2） | 谁接手 |
|---|---|---|
| B1 在既有授权内、依据明确 | 内容形状坏了（机器结构写成文本、schema 不合法、缺必填字段）；引用指向已改名或已升版的目标；投影规范化报形状问题 | 设计责任方。有人在场：停机说明直接交给会话里的设计 owner，照 `/component-design` 在既有授权内修好、经真实 readiness 入口调和、重发同一请求。无人值守：有预授权时由框架派设计修复自动接手（§5.5）；没有预授权则停等 |
| B2 需要新的产品选择、扩大范围或缺少事实 | 未决决策、blocker 或 unknown 在设计闭包内；contract 缺权威来源；架构影响未裁决；依赖边或 DSL 冲突 | 停等有权者；说明写清缺什么 |

### 5.1 探针

`condition-wait.ts` 新增一支 `design_authority_projectable`：只读地重跑 `deriveBlueprintSkillInput(…, 'pure')`（对 A1 门）与 CU 施工投影的 reconcile 子集（对 CU 门），停机时记录的每一条设计 owner 阻断都不再是 BLOCKER 才算就绪（混合阻断逐条查）。"就绪"只表示可以重试，不代表绑定有效或业务验收通过。设计 owner 停机事件带 `probe: 'design_authority_projectable'` 与 `probe_phase`，字段沿用既有形状；探针的选取复用 supervisor 现有的"当前有效 WAITING(external) 的探针"提取逻辑，不另写一份。

### 5.2 停等策略（默认设计）

- 设计 owner 类停机**不做进程内等待**，一律立即停放并释放本 run 的 feature 锁：修复要经 readiness 调和，而调和要取这把锁（§4.2），持锁等待会让修复入口竞争退出。设备类等待不受影响，仍按 P3。
- 无人值守 / detached：停放后 supervisor（已安装时）按既有节奏探针唤醒并 resume。supervisor 每 run 的重启上限沿用（3 次）、不重置：唤醒是有界的，耗尽后不再自动恢复，说明里写明。
- 有人在场：停放并给出说明；设计 owner 在会话里修好后重发同一请求即续跑。

### 5.3 修好之后怎么续跑

- 接续决策新增第七种变化事实 `external_condition_ready`：最新未终局 run 的停机带 probe 且探针现在就绪。通用，不只为设计权威——任何带探针的外部等待修好后重发都越过冷却；其它六种变化事实的判定不变。
- **"原 run 继续还是起后继"由运行时的恢复入口一处判断**，三条路都消费它：普通重发（隐式接续）、supervisor 的 `--resume`（显式 resume 今天跳过隐式接续分流，这里要接上）、进程内探针唤醒（今天只 recheck、不经出生入口）。supervisor 只负责拉起进程，不做判断。判断按事实，不新造"重新冻结绑定"的机制：
  - run 冻结的输入绑定仍有效（用既有 `readBoundInput` 只读核一遍）→ **重新接入同一 run**，当前阶段按新权威重评；手写产物的 A1 门转成漂移分支，由 spec/plan 在链内按权威改写，再经既有的范围修订重签。
  - 派生绑定已 stale（蓝图内容变了）→ 同一 run 无法重签（解析器把输入置为 invalid，修订生产者不产出）。此时**从停机的 run 自动起后继**：复用既有的后继出生（承接停机 run、出生时重新解析绑定、按当前输入重生成候选范围），不需要操作者拼 `--supersede`。任务身份是交付周期，后继属于同一任务。
- 两条路都不算完成本 plan 的承诺，除非 §8 的 B2 用真实链路证明"停机 → 修 → 重发 → 任务正确完成"。证明不成立的部分不能只记成代价：不能续跑的情形保留停机与说明，P4 的 t5 保持未完成。

### 5.4 不做

- 无人值守时不派发 B2：需要新的产品选择、扩大范围或缺少事实的修复没有授权来源，停等有权者。
- 不让 agent 自报准入、不让编写修复的 agent 给自己的修订写质询结果。

### 5.5 无人值守的 B1 自动接手（t6）

**前提**（四个同时成立才派发，否则按 §5.2 停等）：无人值守 / detached 运行；停机分类为 B1；`framework.local.json` 有预授权 `design_repair.unattended_b1: true`（个人级配置，对照 `adapters.<adapter>.approved_models` 的范式，schema 同步；缺省 false）；本次停机签名尚未尝试过（记账见下"尝试记账"）。

**写入所有权与提交边界**：整个尝试从读取修复基线到发布或放弃，都在 §4.2 的两层锁之内（蓝图锁 + 受影响 feature 的锁，runtime 对本 feature 的锁按 owner 借用），取锁范围是该蓝图下**全部** canonical CU 的 feature 锁（发布后全部 CU 都待写），锁内调和沿用 §4.2 的写集守卫；取不到锁即不派发、按 §5.2 停等，这种竞争退出不写 attempted、不消耗该签名的修复机会。agent **只在隔离草稿工作区**里改：runtime 只把 canonical 蓝图文件复制到 run 目录下的临时工作区（同目录的 closure 与评审投影不动），两次调用的写边界都只是这个草稿；运行时在发布前不写 canonical。提交边界 = 发布。发布前失败 → 丢弃草稿、不发布；agent 越界改了草稿之外的文件（含 canonical）只能检测、不承诺还原，按第 2 步处置。发布后不回滚：发布成功不等于修复成功，后续失败按新的 B 状态停机并披露。

**步骤**（都在当前 run 内、当前 adapter 与已钉型号下；两次调用都是链外直接调 adapter，先例是视觉金丝雀与视觉 provider 旁路，不经阶段执行器）：

1. 取锁；记事件 `design_authority_repair`（`action: content_repair`, `stage: attempted`, 签名），**落盘成功后**才进入第 2 步；复制 canonical 蓝图文件到草稿工作区，记下基线字节。
2. **编写修复调用**：提示词 = 修复简报（哪个产物、哪条检查、依据）+ 无人值守修复子契约（新文档 `skills/reference/design-repair-unattended.md`：只能做 B1 类修复、只依据既有事实、不得改任何决策、不得扩范围、不得改 revision 与修订依据（由运行时登记，见第 4 步）、不得写 `review_summary.admission`、不得写质询结果）+ 写边界（只允许草稿工作区）。用既有的调用前后写归因快照与求差核对草稿之外的改动；快照覆盖实际影响本次授权、产品和验收的宿主文件——features 目录（含 canonical 蓝图与全部 CU）、产品源码、根配置、个人配置 `framework.local.json`、需求与契约等输入文件；不为"整个工程"扫描依赖、缓存和构建目录；必需快照不可验证时不得当作干净继续，尝试失败。草稿之外任何改动 → 尝试失败、丢弃草稿、不发布，并走**既有的越界写入违规处置**（证据作废、回退；链内无法回退时走既有违规停机），不降为普通的设计等待；这是检测，不承诺自动还原，被改的文件由操作者的版本控制恢复，事件披露路径与哈希。草稿里出现 `review_summary.admission` 或质询结果的改动 → 视为自报，尝试失败。
3. **独立质询调用**：编写调用通过第 2 步核对后，运行时先把草稿里的旧质询结果整份作废（只处理草稿，canonical 历史保留；目的是不让旧结论冒充本次复审，不是为了制造一次 blocker→pass）。然后发起与编写调用隔离的第二次独立进程，输入只有草稿、结构化证据包与已登记外部输入（规范"独立质询"要求），按既有必答范围产出完整的质询结果写进草稿；未变更视图仍可用规范已有的 `verified_unchanged` 表达（须核实不变声明及依据）。质询 provider 启动失败、超时、非正常退出，或正常退出但没有合法新结果 → 尝试失败，不沿用旧报告、不伪造报告。
4. **机器裁决（对草稿对象）**：真实 `validateComponentBlueprint(value, context)` 直接接收解析后的草稿对象，`context` 仍用**真实宿主根**与 canonical 路径——蓝图引用的需求、合同、模块目录等权威材料按宿主只读解析，草稿里只有蓝图本身；不复制工程、不另建解析器、不把草稿目录当 projectRoot（否则合法修复会因找不到 `requirements/…`、`contracts/…` 被拒）；准入由机器**写回**：把现有 `validateBlueprintAdmission` 里"按 checker 结果算期望值"的部分提取成一个派生函数（校验器改为调用它再比对），runtime 用它把 `review_summary.admission` 写进草稿；再校验一次必须无 BLOCKER。新 revision 号与修订依据（失败检查 id、预授权键）由 runtime 登记在蓝图既有的根 `provenance` 中，不新增字段；既有派生结论按既有规则标 stale、保留原输入版本，只有本次实际重算的结果绑定新 revision，不得批量改版本冒充重算。
5. **发布**：由 runtime 作为单写者，在锁内先复核 canonical 蓝图字节仍等于第 1 步的基线（不等即尝试失败、不发布——两层锁约束不了所有手工写入者），再把草稿蓝图文件以 temp→rename 原子替换 canonical 蓝图文件。rename 成功即发布边界，此后任何失败都不回滚蓝图。
6. 发布后在同一锁内跑 §4.2 的调和器（CU 指针升到新 revision）→ 释放锁 → 探针 → 通过则记事件（`stage: published`）并走 §5.3 的同一恢复判断续跑。调和器跳过、抛错或自行回滚 → 如实记为"已发布 rev N、调和未完成"，不落入草稿失败分支；探针不通过 → 记未恢复。两者都不回滚发布，按新的 B 状态停机，事件与说明披露"已发布 rev N、卡在哪一步"。运行中的探针与停放后的探针共用同一判定：运行中显式传入本次阻断，停放后从停机事件读取。

**尝试记账**：`design_authority_repair` 事件不参与质量裁决，但**参与次数统计**——派发前先写 `attempted`（落盘成功后才调用 adapter），恢复入口与后继出生按既有 events 回放（后继沿用 `collectSupersededAncestorEvents` 的承接方式）读到同一签名的 attempted 即不再派发。签名只由 feature、责任阶段与停机时设计 owner 阻断的检查 id 和原因码组成，不含 run_id、时间或草稿版本，后继不能借这些变化绕过判重；发布后的新 B 状态签名相同的不再派发。取不到锁、前提不成立等未派发的退出不写 attempted。不新增平行账本。

**预算**：两次调用各受剩余墙钟约束；沿用既有调用事件计数，以不属于阶段链的用途标识区分两次调用（不登记新阶段），实际启动一次计一次，运行中计数与事件回放同步；第一次调用后剩余次数或墙钟不足不得启动第二次。整个尝试计一轮；不重置任何预算。

**事件**：§4.3 的记录事件 `design_authority_repair`，`action: 'pointer_reconcile' | 'content_repair'`；content_repair 带 `stage: attempted | published | failed`、失败步骤、涉及文件、新 revision。

**授权语义**：预授权由人写在配置里，与型号获准替代同构——不是 agent 原地自我授权；修复只限既有授权内的 B1；准入与质询仍由机器和隔离上下文裁决；agent 不被授权碰 canonical（越界只能检测，见第 2 步）。B2 与无预授权的 B1 保持停等。

**准入两问**：改善的场景是无人值守 / supervisor 驱动的 run 遇到 B1（宿主至今没有 B1 类的真实停机，97af3f 属 B2，这一条没有事故依据，收益按可靠性口径与用户裁定写）；收益是无人值守下 B1 不再等人。新增：一个配置键、一条 run 内派发路线、事件的一个 action 值与记账阶段、一份子契约文档、一个从校验器提取的准入派生函数。

## 6. 场景（t4）

| 场景 | 前提 | 期望 |
|---|---|---|
| S14 A 类 run 内调和 | 快照宿主；**先真实出生 run 并冻结旧绑定**，再把蓝图升到 admitted revision 并写 derived_results（不调调和器）；run 走到 plan 阶段的门 | 同一 run 内框架调和、当前阶段重评通过、任务正确完成，操作者动作 0 |
| S14 反例一 | 同上，但本 CU 会被调和器跳过（三处指针不一致） | 停机交设计 owner，说明含跳过原因；不宣称完成 |
| S14 反例二 | 同上，本 CU 升版成功、同蓝图下兄弟 CU 被跳过 | 本 run 续跑并完成；兄弟 CU 的跳过只披露 |
| S15 B1 修后续跑（绑定仍有效） | 现有无效例造出停机（无人值守）；停机事件分类为 B1、锁已释放；测试代替设计 owner 在既有授权内修蓝图，**经真实 readiness 入口**调和（干预记为设计修复，不记 product_decision）；冷却期内重发同一请求，不带任何强制旗标，不回拨事件时间 | 重新接入同一 run_id，当前阶段重评，链内重写后正确完成 |
| S15 B1 修后续跑（派生绑定已 stale） | 同上，但修复改变了派生绑定所依赖的蓝图内容 | 自动从停机 run 起后继并正确完成 |
| S15 supervisor 分支（绑定已 stale） | 同上，无人值守停放；以生产 CLI 跑一轮 supervisor | 探针就绪即拉起；运行时判定绑定 stale → 起后继；验到后继完成，不只验 spawn |
| S15 B2 | 造出需要产品决策的无效（设计闭包内有未决决策） | 停机事件分类为 B2、说明写清缺什么；测试代替有权者裁决（记 product_decision）后重发 → 正确完成 |
| S15 反例 | 未修蓝图就重发 | 保持停止，不新建 run；探针未就绪不越过冷却 |
| S16 无人值守 B1 自动接手 | 无人值守；预授权开启；B1 停机；假 adapter 分别扮演编写修复（在草稿里产出合法修复内容，由 runtime 升版）与独立质询（产出覆盖结果）；真实校验、真实准入派生与写回、真实发布、真实加锁 readiness、真实探针与恢复判断 | 修复后绑定仍有效的宿主上同一 run 续跑并正确完成，操作者动作 0；事件含 attempted → published 与新 revision；草稿旧质询作废后机器派生的准入未过、独立质询重新生成后机器派生为 pass（canonical 原本可以是 pass，历史保留） |
| S16 绑定失效支 | 同上，但修复改变了派生绑定所依赖的蓝图内容 | 发布后停放；supervisor 实际拉起后继并完成时才计操作者动作 0；未启用 supervisor 或未实际拉起时需重发，如实计人工动作 |
| S16 反例一 | 无预授权 | 停等，不派发 |
| S16 反例二 | 编写调用改了草稿之外的文件（含覆盖工程里已有文件、个人配置、需求或契约）；必需快照不可验证 | 不发布；走既有违规处置，不降为设计等待；事件披露路径与哈希；不承诺自动还原（"不发布"与"未发生越界改写"是两个断言） |
| S16 反例三 | 修复后准入不通过 / 质询 provider 不可用或正常退出但无合法新结果 / 草稿里自报了 admission | 不发布，丢弃草稿，停等，事件披露失败步骤；不伪造质询报告 |
| S16 反例四 | B2 停机且预授权开启 | 不派发 |
| S16 反例五 | 同一签名第二次停机；以及 attempted 之后进程中断、resume、起后继 | 都不再派发 |
| S16 反例六 | 两个 feature 的真实 run 同时触发同一蓝图的修复 | 取不到锁的一方不派发、停放，不消耗该签名的修复机会；两方可能都退出停放，需人工重发一次（计入人工动作）；任何一方不得覆盖另一方的写入；某一方发布成功后，另一方重发时探针已就绪即续跑 |
| S16 反例七 | 发布成功、随后调和未完成或探针不通过 | 不回滚发布；记未恢复（发布成功不等于修复成功），按新的 B 状态停机，事件披露已发布 rev 与卡点 |

场景的驱动层用真实 harness、真实绑定校验、真实重签与完成检查；测试只替代 agent 的产出，不替代任何裁决；不用默认带 `--force` 的启动方式。S4 两支保持原期望。六项指标复跑，新数字进登记表新字段，不覆盖已有字段。

## 7. 文档与规范（t5）

- `docs/operations/goal-mode-runbook.md`：设计权威故障的两类处理与"修好后重发即续跑"。
- MIGRATION：P4 节归因条目改为如实（A 类自动调和；B 类停等、探针唤醒；`external_condition_ready` 越过冷却）。
- OpenSpec：`check-disposition-single-verdict` 的 goal-runner 增量改写"首次即停"那条；`change-unit-continuous-progression` 按 §4.4；`task-continuation-recovery-loop` 补第七种变化事实。
- OpenSpec 另加：`app-component-blueprint` 增量——预授权的无人值守 B1 修复作为合法修订来源（限 B1、旧质询作废后独立质询重跑、准入机器派生、发布前失败不发布、越界只检测）；`framework.local.schema.json` 增 `design_repair.unattended_b1`；goal-runner 增量写派发路线与一次尝试规则。
- `skills/project/component-design/SKILL.md` 的边界措辞由"不进 Goal Mode"改为"设计阶段不启动 run；无人值守修复子契约见 reference"，遵守行数预算（原地替换，不加行）。
- P4 plan t5 的关闭条件（全文唯一口径）：本 plan 的 t1–t6 全部验收通过（A2、B2、D1 成立）。关闭时记录写在 P4 §16；总纲 §14 记录。

## 8. 验收

| 编号 | 验收 | 证明什么 |
|---|---|---|
| A1 | invalid 带结构化原因；plan 阶段指针过期带 external 与同一 structured 并实际进入设计 owner 出口；猜测分支已删；反向变异转红 | 两类分得开、不靠文本 |
| A2 | S14 走真实公开入口：先出生并冻结旧绑定、再注入升版；同一 run 完成，操作者 0；本 CU 被跳过时落回停机；兄弟 CU 跳过不停机 | A 类闭环，且不绕过跳过条件 |
| A3 | 冻结输入绑定在指针升版后仍有效的真实证据（探针式测试先行）；不成立则按 §4.2 改口并在 A2 里改为起后继 | 不靠放宽校验走通 |
| A4 | 写入所有权：蓝图锁 + 受影响 feature 锁覆盖调和器整批写集，且与阶段写入共享边界。交错反例——某 feature 的 run 正持锁跑 plan 阶段写 contracts，readiness 调和必须竞争退出、不得用旧快照覆盖或回滚掉新写入；兄弟 feature 反例——run 内调和遇到兄弟 feature 被另一 run 持锁时竞争退出，不覆盖其投影；owner 复用——goal 运行时对本 feature 已持锁时调和可进行；竞争退出时 runtime 落回停机并说明、readiness 报忙 | 不会丢写 |
| B1 | 探针只读；混合阻断逐条查；停机事件带 probe、B1/B2 分类与修复简报；停放时 feature 锁已释放（设计 owner 经真实 readiness 入口能取到锁）；重启上限不重置 | 修好后能被唤醒，修复入口不被自己挡住 |
| B2 | S15 三支走真实入口：停机 → 修 → 冷却期内不带旗标重发或 supervisor 拉起 → 任务正确完成（重新接入、自动后继、supervisor 唤醒且绑定 stale 各一支）；未修则保持停止 | B 类闭环，且不假完成 |
| B3 | `external_condition_ready` 只在探针就绪时成立；其它六种变化事实的判定不变；不回拨事件时间；显式 `--resume` 与进程内唤醒也经同一恢复判断（反向变异：绕过判断则 stale 绑定下错误地继续原 run，转红） | 冷却只被真实恢复越过；三条路一处判断 |
| B4 | B1/B2 分类表逐条对应既有 issue code，未列入的默认 B2；B2 说明写清缺什么 | 不把需要决策的问题伪装成可自动修 |
| D1 | S16 走真实入口：无人值守 + 预授权 + B1 → 草稿里两次隔离调用 → 真实校验、准入派生与写回、发布、加锁 readiness、探针 → 同一任务正确完成，操作者 0（绑定仍有效的宿主）；草稿旧质询作废后机器派生的准入未过，独立质询重新生成后机器派生为 pass——证明没有沿用旧结论冒充本次复审，不以制造 blocker→pass 为目的；绑定失效支只有 supervisor 实际拉起后继并完成时才计操作者 0 | 无人值守 B1 闭环 |
| D2 | 七个反例各自成立：无预授权不派发；草稿外改动（覆盖范围见 §5.5 第 2 步）与必需快照不可验证时不发布并走既有违规处置；准入不过、质询不可用或无合法新结果、自报 admission 时不发布且不伪造；B2 不派发；同签名在中断、resume、后继后都只试一次，竞争退出不消耗机会；两个真实 run 竞争时任何一方不覆盖另一方（可能都需人工重发一次）；发布后失败不回滚且记未恢复 | 派发有界、运行时发布前不写 canonical、发布后状态如实 |
| D3 | 准入由提取出的派生函数写回，校验器与它同源；agent 自报 `review_summary.admission` 被拒；质询结果不由编写调用产出（两次调用的提示词与写归因分离可证） | 不自我授权 |
| D5 | 同一合法蓝图内容，在 canonical 位置与在草稿对象上（真实宿主根作 context）校验结果一致；用真实夹具证明草稿校验不因找不到宿主里的需求/合同文件而误报 | 草稿校验与发布后一致 |
| D4 | 预授权键缺省关闭（只有布尔 true 开启）；schema 与个人配置读写往返；两次调用按实际启动计次并受墙钟约束，不重置预算；整个尝试在两层锁内 | 边界与预算 |

每条运行时判定做反向变异。测试用真实生产者的产出与真实入口，不手写事件或归档；设计 owner 的修复经真实 readiness 入口，不直接改文件绕过锁；S16 里只有 adapter 的两次调用由假 adapter 代替，校验、准入、锁、探针、恢复判断全部真实。A2、B2、D1 任一不成立，P4 的 t5 不得关闭。

## 9. 裁决记录

- 用户 2026-09-30 裁定：无人值守时 B1 由设计 agent 自动接手要做，并入本 plan（t6，§5.5），不另立 plan。
- 用户 2026-10-01 裁定 t6 落点三项（窄修订 §5.5、§6、§8 及直接相关文字，见 §14）：① D1 按真实场景——canonical 原本可以是 pass，草稿旧质询作废、独立质询重新生成、机器重新派生准入，目的是防止沿用旧结论冒充本次复审；② 草稿外改动按授权、产品、验收的实际输入覆盖检查，快照不可验证不得当干净，违规走既有处置，只检测不承诺还原；③ 并发保留竞争即退出，两个 run 可能都停放需重发一次，不新增锁交接协议，未派发的竞争退出不消耗修复机会、人工重发如实计人工动作。另定两个口径：发布成功不等于修复成功；绑定失效分支只有 supervisor 实际拉起后继并完成时才能宣称操作者动作为 0。
- §4.4 的规范修订、§5.2 的停等策略、§5.5 的预授权键与派发路线是本 plan 的默认设计，随 plan 一并批准，不另设确认。

## 10. 保留、裁剪、不做

| 保留 | 裁剪 | 不做 |
|---|---|---|
| 调和器及其全部跳过条件 | 猜错误码字符串的路线分支 | 新停机原因、状态、CLI |
| 设计 owner 停机与说明；独立质询与机器准入 | — | 无人值守派发 B2；agent 自报准入或自写质询 |
| 冷却机制（只被真实恢复越过） | — | 放宽绑定、指纹、admission；修复循环（每签名一次） |

## 11. 放弃的准确性与已知代价

1. 宿主上这两类故障各只出现过 1 次，收益按场景与既有事故说明，不做频率承诺。
2. B2 仍需有权者动手；本 plan 消除的是"修好之后"的人工动作（手工 `--resume --force-resume` 或 `--supersede`）与"该谁修、修什么"的判断。有人在场时 B1 由会话里的设计 owner 按说明接手，这一步的自动化效果只能在真实 agent 层（H1）看到；无人值守时 B1 的自动修复质量同样只能在真实 agent 层看到，确定性层只证明"合法修复能被机器接受并续跑、非法草稿不发布（越界改写按既有违规处置，不承诺还原）"。派生绑定失效时后继仍会重跑责任阶段，只是由框架自动起、按当前输入只补缺口。
7. 无人值守 B1 修复在宿主上没有事故依据（97af3f 属 B2）；预授权缺省关闭，开启是用户的决定。
3. supervisor 是用户手动启用的；未启用时无人值守的续跑依赖重发请求。
4. §5.3 的续跑若在真实链路上有断点，保留停机与说明，P4 的 t5 保持未完成；不为走通而放宽校验，也不把断点记成代价了事。
5. 探针"就绪"只代表可以重试；重评仍可能因别的内容问题失败，那时走既有的当前阶段修复与无进展守卫。
6. 并发代价：同一蓝图下多个 feature 同时开跑时，A 类 run 内调和会因竞争退出而退化为停机；不保证锁释放后自动续跑，需重发请求或 supervisor 探针唤醒。t6 同理：两个 run 同时触发同一蓝图的修复时可能都不派发、都停放，需人工重发一次（计入人工动作）。

## 12. 风险

- run 内调和与会话内 `/component-design` 并发、与兄弟 feature 正在跑的 run 并发：靠 §4.2 的两层锁隔离（两个入口共用；竞争即退出），A4 的反例守住；接线做不到与阶段写入共享边界时本 plan 不得实施 A 类。
- 唤醒是有界的：supervisor 重启上限 3 次且不重置，耗尽后不再自动恢复，需人介入；说明里写明。
- 无人值守修复在发布前运行时只写草稿；发布只替换蓝图文件一份（temp→rename），rename 失败时 canonical 保持原字节；发布后的调和、探针失败不回滚、记未恢复。草稿之外的越界写入只能检测不能还原，交既有违规处置。
- 编写修复与独立质询若被同一 adapter 会话串联（上下文未隔离），质询就不独立：两次调用必须是独立进程、不同提示词，验收 D3 用写归因与提示词内容证明。

## 13. 实施顺序与验证

1. 批一：t1、t2（A3 的探针式真实测试与 A4 的所有权边界核实先行；A3 不成立即按 §4.2 改口后再实施，A4 不成立则 A 类不实施）。
2. 批二：t3、t4（S14、S15）。
3. 批三：t6、t5（S16、文档、规范、schema；P4 t5 关闭）。
3. 每批 codex 实现 review 到通过；实施者只跑直接相关套件；全量、real-chain、lifecycle-evolution、reliability-scenarios 由调度者收口各跑一次。

## 14. Review 记录

### 用户裁定与 t6 落点窄修订（2026-10-01）

开工前取证（`dist/t6-facts.md`）与 codex 落点预审发现 §5.5 有几处与现有代码接不上，其中三项会改变验收口径。用户裁定见 §9 第二条，并授权窄修订 §5.5、§6、§8 及直接相关的摘要、待办和规范文字。本次修订：D1 的准入观测改为"草稿旧质询作废 → 机器派生未过 → 独立质询重生成 → 机器派生 pass"；草稿只含蓝图文件、发布只替换蓝图文件、发布前复核基线字节；草稿外改动的快照覆盖范围与"不可验证不当干净"、违规走既有处置；取锁范围为全部 CU、竞争退出不消耗机会；签名组成与 attempted 先落盘；调用计次口径；修订依据登记在根 provenance、派生结论标 stale 不改版本；发布后调和未完成与探针失败如实记未恢复；运行中与停放后的探针共用判定；S16 增加绑定失效支、反例六改为如实的竞争限制。其余实施细节（R3 映射修法、R8 配置接线、R10、R12 测试回调等）按预审结论在实施中处理，不改正文。

### codex 首轮（2026-09-30，gpt-6-astra，xhigh）

暂不通过，4 项必修，全部采纳：
1. 派生绑定 stale 不会自动进入范围重签（解析器置 invalid、修订生产者要求输入已解析）——§5.3 改为按绑定有效性分流：有效则重新接入，stale 则自动从停机 run 起后继；断点不得记成代价收口，A2/B2 不成立则 P4 t5 不关。
2. 调和器枚举同蓝图全部 CU，整批 `skipped` 不能作停机判据——§4.1 改为按本 CU 判，兄弟 CU 的跳过只披露，加反例。
3. 同函数、幂等、原子不证明并发安全——§4.2 加写入所有权边界：run 内调和在 run 锁内执行，readiness 在活跃 goal run 存在时拒绝（复用既有锁与规范 :212），新增验收 A4。
4. 公开入口不等于真实绑定恢复链——§6、§8 改为：先出生冻结旧绑定再注入升版；plan 阶段实际路由；真实 harness/绑定/重签/完成检查；冷却期内无人值守重发不带强制旗标、不回拨事件时间；supervisor 验到子 run 完成。
非阻断建议采纳：判别函数改名为"调和候选"并补反例；探针复用 supervisor 的提取逻辑、混合阻断逐条查；唤醒有界（重启上限不重置）；新事件纯记录不借用 `manifest_identity_rebase`；C1 口径收窄；删"纯函数"说法；裁决项 2、3 并入默认设计。

### codex 二轮（2026-09-30）

R1、R2、R4 关闭。R3 未闭环：feature 级 run 锁盖不住调和器的整蓝图写集，readiness 直接调调和器，规范 :212 约束的是 execution-ready 不是写入互斥；反例是 readiness 检查过后 run 写 contracts、调和器再用旧快照覆盖或回滚。
采纳：互斥改到调和器唯一入口上的蓝图级锁（复用既有锁原语），从枚举到回滚全程持有，两个调用方都经它；锁被持有时 runtime 落回停机、readiness 报忙；A4 补交错反例与兄弟 feature 反例。文字残留（overview 的"同一 run"、t2 的"纯指针过期"、§11 的"消除后继重跑"）已统一到正文口径。

### codex 三轮（2026-09-30）

R3 仍未闭环：蓝图级锁只串行化调和器本身，正常 plan 阶段的 contracts 写入只持 feature 锁，readiness 持蓝图锁读旧 contracts → agent 写新版 → 调和器按旧快照写出或回滚的交错仍成立。
采纳：§4.2 改为两层锁——蓝图锁串行化调和器，调和器再对本批写集涉及的每个 feature 取既有 feature 锁（调用方已持有的按 owner 复用，取不到即竞争退出、一个字节不写），使整批写入与阶段写入共享同一互斥边界；A4 反例按此改写。文字：标题"同一 run"改"自动续跑（重新接入或自动后继）"，§4.4"纯指针过期"改"调和候选"，§1/C1 写明新增的锁作用域复用既有实现。

### codex 九轮（2026-09-30，用户转来）

八轮四项关闭。1 项 P1：草稿目录不能当校验器的 projectRoot——蓝图引用的需求、合同、模块目录都在宿主里，以草稿为根跑真实校验器得 18 个 BLOCKER，合法修复会在发布前被拒。采纳：§5.5 第 4 步改为校验草稿**对象**、context 用真实宿主根与 canonical 路径（`validateComponentBlueprint(value, context)` 已支持）；新增验收 D5（同一合法内容在 canonical 与草稿上校验结果一致）。

### codex 八轮（2026-09-30，用户转来，针对并入的 t6）

四项修订全部采纳：
1. [P1] 编写与回滚未纳入写入互斥——整个尝试（读取基线到发布/放弃）纳入 §4.2 两层锁，取不到锁不派发；加反例六（两次修复交错，失败方不覆盖成功方）。
2. [P1] "越界一律还原"没有还原依据；readiness 成功后再失败只回滚蓝图会留下不一致——改为 agent 只改隔离草稿工作区，提交边界 = 发布：发布前失败丢弃草稿、canonical 无变化；发布由 runtime 作单写者在锁内原子替换（仅此一步保留旧字节）；发布后不回滚，按新 B 状态停机披露；草稿外越界只检测、走既有违规路径。加反例二（覆盖工程已有文件）、反例七（发布后探针失败）。
3. [P2] "每签名一次"缺跨恢复记账——派发前写 `design_authority_repair` 的 `attempted`，恢复入口与后继出生按既有 events 回放判重；事件不参与质量裁决但参与次数统计；反例五扩到中断、resume、后继。
4. [P2] 机器准入只校验不写回——从 `validateBlueprintAdmission` 提取派生函数，校验器与 runtime 同源，runtime 把准入写进草稿；验收要求"旧 blocker → 修复后合法 pass"。
文字残留同步：overview 的"无人值守没有授权来源"、C1 的新增项清单。

### 用户裁定与 t6 并入（2026-09-30）

用户裁定 t6（无人值守 B1 自动接手）要做，并入本 plan，不另立。新增 §5.5：预授权键 `design_repair.unattended_b1`、run 内两次链外 adapter 调用（编写修复 + 隔离的独立质询）、真实校验与机器准入、加锁 readiness、探针、同一恢复判断续跑；失败按字节快照还原并回到停等；每签名一次；B2 永不派发。S16 与五个反例、验收 D1–D4、§1/§7/§9/§10/§11/§12/§13 同步。P4 t5 的关闭条件改为本 plan t1–t6 全部验收通过。用户将另行让 codex 评审。

### codex 七轮（2026-09-30）

**通过**，无必修、无建议、无撤回：关闭条件已统一，t6 的 cancelled 语义（转交≠验收完成）与 AGENTS.md 一致。plan 交用户批准。

### codex 六轮（2026-09-30）

前两项修订闭环；B1/B2 原则成立、逐 code 表留实施验收。1 项 P2：关闭条件不一致（§7 仍写"t2、t3 通过后关闭"，t6 把"转交新 plan"记成 cancelled 却没说 P4 的状态）。采纳：§7 定为唯一口径——本 plan 验收通过，且 t6 被用户明确取消或承接 plan 已验收通过；仅转交不算完成；overview、t5、t6、§9 同步。非阻断建议采纳：§5.0 注明混合原因码只有能依据既有权威恢复才算 B1。

### codex 五轮（2026-09-30，用户转来）

三项修订，全部采纳：
1. [P1] 自动后继的分流没接到 supervisor（固定发 `--resume`）与进程内唤醒（只 recheck）——§5.3 改为运行时恢复入口一处判断"原 run 继续还是起后继"，普通重发、supervisor resume、进程内唤醒都消费它，supervisor 只拉起进程；S15 加"supervisor 唤醒且绑定已 stale"一支，B3 加反向变异。
2. [P1] B 类进程内等待持有 feature 锁，而修复要经 readiness 取同一把锁——§5.2 改为设计 owner 类停机不做进程内等待，立即停放并释放锁；设备类等待不变；验收要求设计 owner 经真实 readiness 入口修。
3. [P2] "B 类全部没有授权来源"过强——§5.0 拆成 B1（既有授权内、依据明确，交设计责任方接手；有人在场时会话里的设计 owner 照说明修）与 B2（需要产品选择、扩大范围或缺少事实，停等有权者）；停机事件带分类与修复简报；S15 的 B1 干预不记 product_decision；本 plan 明确为部分交付，无人值守 B1 自动接手列为 t6 待用户裁决，P4 t5 在 t6 裁定前不关。

### codex 四轮（2026-09-30）

**通过**，无必修。R3 关闭：两层锁让整批调和与阶段写入共享互斥边界；owner 复用须由调用方把锁记录借给调和器（`tryAcquireLock` 不支持同 owner 重入）。并发时 A 类会经常退化为停机，接受为本版保守边界，不宣称并发场景自动闭环。非阻断建议已采纳：摘要与 t2 写"两层锁"；§1 补竞争退出例外；C1 改"限制新增机制"；§11 补并发代价与"不保证锁释放后自动续跑"；忙提示改为"竞争解除后重发即可，不需要改设计内容"。

## 15. 实施记录

### 批一（t1、t2）— 2026-09-30，实施完，待 codex 实现评审

**前置验证（§13 第 1 条）**

- A3 成立：真 harness 写出的 run 冻结的 `acceptance` / `contracts` 绑定，在蓝图纯身份升版并经调和器原位升版后，逐条经生产 `readBoundInput` 复读仍有效；只升蓝图不调和时 `contracts` 绑定读不回来（探针对失效敏感）。`codebase` 绑定升版前后都读不回来（run 自己写过源码，与本项无关），断言只比较升版前后是否一致。§4.1 按原设计实施，没有走 §4.2 的退路。
- A4 成立：goal 运行时整个 run 期间持有本 feature 的 `goal-runs/.feature.lock`（含 agent 调用窗口），调和器取同一把锁即与阶段写入共享边界。只对 goal run 成立——不经 goal-runner 的手工阶段执行不持这把锁，不在本边界内（已知上限，未处理）。

**改动文件**

- `harness/scripts/utils/blueprint-skill-projection.ts`：invalid 结果带 `reason`（`blueprint_ref_stale` / `other`，取自 `validateChangeUnit` 的 issue id）；`authoritativeContentDrift` 透传；`checkAuthoritativeContentAligned` 无效分支带 `structured: { kind: 'design_authority', reason }`。
- `harness/scripts/utils/change-unit-path.ts`：`ChangeUnitResolutionError` 在 `change_unit_invalid` 时携带验证器原始 issue；新增 `BLUEPRINT_REF_STALE_ISSUE` 与只读判别 `pointerStaleCandidate`。
- `harness/scripts/utils/change-unit-feature-projection.ts`：`resolveChangeUnitRef` 失败的路线取验证器 issue 的 `route`（阻断项全是 `reconcile_blueprint` 才回设计 owner），删除 `code.includes('blueprint')` 分支；reconcile 路线的检查带同一 `structured`。
- `harness/scripts/utils/change-unit-design-preparation.ts`：`reconcileChangeUnitBlueprintRefs` 入口加两层锁（工作区根下 `.blueprint-reconcile.lock` + 本批可能写到的每个 feature 的既有 feature 锁，支持调用方借锁），取不到即返回 `busy`、一个字节不写；原函数体改名 `reconcileUnderLocks`，逻辑未动；`deriveDesignPreparationReadiness` 遇 `busy` 报 `ready: false` 且不派生结论。
- `harness/scripts/goal-phase-runtime.ts`：决策梯在设计 owner 分支之前加一条（设计 owner 阻断 + 内容重试预算未尽 + 调和候选 → `reconcilePointerInRun`，本 CU 修好则 `retry`）；没修好时停机说明附原因；发 `design_authority_repair` 事件。
- `harness/scripts/utils/goal-report-generator.ts`：阶段表渲染 `design_authority_repair`。
- `harness/tests/unit/design-authority-repair.unit.test.ts`（新）、`harness/tests/run-unit.ts`（登记套件 `design-authority-repair`，release-only）。
- `openspec/changes/check-disposition-single-verdict/specs/change-unit-continuous-progression/spec.md`（新）：§4.4 的两条 MODIFIED Requirement。

**验证结果**

- `design-authority-repair` 7/0（真 harness、公开入口 `--supersede` 出生、真实门产出）：A3 探针；A1 原因区分；A4 锁（函数级，真实锁原语）；A2 主线——run 出生并冻结绑定后蓝图升版，plan 的真实门报指针过期，同一 run 内调和、plan 只多一轮，run 以 `CHAIN_SLICE_COMPLETED` 结束，`assessFeature` 判完成且完成记录属于该 run，全程只出生一个 run；A2 反例一（本 CU 被跳过 → 停机，说明含跳过原因，不完成）；A2 反例二（兄弟 CU 被跳过 → 本 run 完成，跳过只在事件里）；A4 兄弟 feature 反例（兄弟 feature 被持锁 → 竞争退出、CU 字节全不变、停机说明含"竞争解除后重发即可"）。A4 交错反例并在 A2 主线里：run 持锁跑 plan 时另一会话调 readiness，报忙且 CU 与 contracts 字节不变。
- 反向变异 9 条全部转红并已按原字节还原（还原前后 `git diff` 逐字节相同）：路线恒为映射修复；不写原因码；判别函数恒 false；成败按整批判；忽略本 CU 被跳过；不取 feature 锁；不取蓝图锁；运行时不借锁；运行时忽略竞争退出。
- 直接相关套件：blueprint-skill-projection 23/0、change-unit-progression 97/0、component-design-handoff 30/0、check-disposition 11/0、check-disposition-consumers 19/0、successor-exit 24/0、feature-assessment 15/0、phase-evidence-manifest 25/0、component-closure 45/0、adjudication 60/0、component-blueprint 97/0。`npm run typecheck` 通过；`npm run openspec:validate` 52/0。
- 未跑：全量、real-chain、lifecycle-evolution、reliability-scenarios、金样（按约定留收口）。

**准入两问（本批新增的字段）**

- 调和结果的 `busy`：场景是 §4.2 的两种并发（readiness 与正在跑的阶段写入、兄弟 feature 的 run）；收益是调用方能把"竞争"与"设计内容问题"分开，停机说明据此写"不需要改设计内容"。
- 事件的 `outcome`（见偏离 4）：场景同 §4.3；收益是报告与归因不用从 `reason` 文本判断这次调和成没成。
- 其余（`reason` / `structured`、事件本身、锁作用域）已在 plan §3、§4.2、§4.3 答过。没有新增停机原因、状态、路由、CLI 或阻断检查。

**偏离**

1. §6 反例一的跳过条件换了。plan 举的"三处指针不一致"到不了调和器：那种 CU 在验证器里另有 `change_unit_blueprint_identity_mismatch` 等阻断项，不是调和候选，直接走既有停机（A1 用例里断言了这一点）。反例一改用"新蓝图里本 CU 的设计闭包有未决项，carry-forward 不过"，这是候选为真时本 CU 被跳过的可达情形。"三处指针不一致"用在反例二的兄弟 CU 上。
2. 升版的注入时机是 plan 首轮 agent 窗口内（测试替身在这一刻写蓝图，模拟另一会话的设计 owner），不是两个阶段之间——驱动层的阶段间回调只在 host-bridge 形态接线。写归因把这次蓝图写入记为该轮的未归属观察，不影响裁决。
3. 被测 run 是 `--supersede` 真实出生的后继，不是 fresh run：快照宿主上只有完成后演进能让 spec、plan 同时进出生链（为此首次升版同时改了进投影的验收与施工契约授权文件）。出生这一步属前提，不计入故障后的操作者动作。
4. `design_authority_repair` 的 `pointer_reconcile` 也带 `outcome`（`reconciled` / `not_reconciled`），且调和没修好时同样发事件；plan §4.3 只给 `content_repair` 列了 `outcome`。
5. 内容重试预算用尽时不做调和，直接走既有停机（§4.2"计一轮，不豁免预算"的落法）。
6. OpenSpec 增量放进既有 change `check-disposition-single-verdict`，没有另开 change。同一 change 里 goal-runner 的"首次即停"那条留到 t5 改写，这期间它对 A 类的描述与实现不一致。
7. 新建了一个测试文件与套件（而不是并进 lifecycle-evolution）：要能单独 `--filter` 跑，不带上 lifecycle-evolution 的 14 条。套件内有一个只供本地迭代的环境变量 `DESIGN_AUTHORITY_REPAIR_ONLY`（按用例名前缀筛选）。

**放弃的准确性**

- 取锁范围是"owner 指针不等于当前蓝图身份的全部 CU"，含随后会被调和器跳过的——宁多勿少，竞争退出会比严格写集多。
- 重评那一轮的提示词仍带上一轮的阻断文本（验证器原文已写"框架自动，不要手改"），没有另加"框架已调和"的说明。
- 假 agent 不会对提示词作出反应，真实 agent 在重评轮的表现只能在宿主层看到。
- readiness 报忙复用 `ready: false` + `nextEntry: 'component-design'`，没有新增取值；调用方靠 `blueprintRefs.busy` 区分。技能文档对"忙"的说明留到 t5。

### 批一返修（codex 实现评审首轮，1 项 P1）— 2026-09-30

**意见**：取锁范围与实际写集来自两次读取。调和器先按第一次读到的蓝图确定要取哪些 feature 锁，取锁后又重新读取 CU 与蓝图确定写集；蓝图在两次读取之间升版时，写集会多出没持锁的 CU，调和器按自己保存的旧字节覆盖正在跑的阶段写出的 contracts。核实属实（蓝图文件本身不受这两层锁保护，任何设计会话都能在中间升版）。

**修复**（`harness/scripts/utils/change-unit-design-preparation.ts`）：写集确定之后、任何写出之前，核对每个待写 CU 都在已持锁范围内；出现范围外的 CU 即竞争退出，一个字节不写，返回 `busy` 并点名是哪个 CU。没有新增锁、字段或状态——复用已有的 `busy` 出口。写集与写出用的是同一次读取的数据（同一份 `pending`），守卫之后不再扩大写入目标。

**新增用例**：`A4 两次读取之间蓝图升版`——真实宿主快照 + 真实锁原语。plan 持本 feature 的锁，第一次读取时本 CU 指针未过期、不在取锁范围；调和器为兄弟 feature 落锁文件的那一刻，蓝图升版、plan 写出新版 contracts。断言：调和竞争退出且点名本 CU，全部 CU 字节不变，plan 的新写入逐字节保留，plan 的锁仍在，调和器自己取的锁已释放；plan 放锁后重试照常升版且 plan 新增的内容仍在。交错点靠拦截一次锁文件创建实现，只在测试里，生产代码没有加测试缝。

**验证**：反向变异第 10 条（去掉守卫）转红，复现评审描述的现象（本 CU 在 plan 持锁下被升版），已按原字节还原。`design-authority-repair` 8/0（含原 7 条真链用例）；调和器的直接消费方 component-design-handoff 30/0、change-unit-progression 97/0、successor-exit 24/0、check-disposition-consumers 19/0、phase-evidence-manifest 25/0、component-closure 45/0、feature-assessment 15/0；typecheck 通过；`openspec:validate` 52/0。

**OpenSpec**：`change-unit-continuous-progression` 增量补一句——取锁之后写集里出现未持锁的 Feature 同样竞争退出；新增对应场景。

### 批二（t3、t4）— 2026-09-30，实施完，待 codex 实现评审

**验收结论（§8）**

- B1 成立：探针只读（探测前后蓝图、CU、run 事件、acceptance 字节不变，不留锁）；混合阻断逐条查（plan 门两条阻断，只修一条仍未就绪）；停机事件带 `probe`、分类与修复简报，`run_end` 同源带 `probe` / `probe_phase`；停放后 feature 锁已释放，设计 owner 经真实 `deriveDesignPreparationReadiness` 取到锁并调和；supervisor 重启次数在起后继后仍累计。
- B2 成立：重新接入同一 run、自动后继、supervisor 拉起且绑定已失效，三支都走公开入口、真 harness，任务由最终 run 正确完成；未修就重发保持停止、不新建 run、不写事件。全程在冷却期内，没有回拨事件时间，没有带 `--force` / `--resume` / `--supersede`（supervisor 一支的 `--resume` 是 supervisor 自己发出的）。
- B3 成立：`external_condition_ready` 只在探针就绪时成立；显式换型号仍按原判据起后继；显式 `--resume`（supervisor 经 detach、操作者前台）与进程内唤醒都消费同一判断，三处各有一条反向变异转红。
- B4 成立：分类表逐条列出既有原因码，未列入、空集、B1 与 B2 混合一律 B2；B2 的停机说明写出缺什么。

**改动文件**

- `harness/scripts/utils/blueprint-skill-projection.ts`：invalid 结果带 `codes`（验证器 / 解析器 / 设计门的既有 issue code；投影自身的抛错点各给一个 code）；`checkAuthoritativeContentAligned` 的 `structured` 带 `codes`；文件末尾新增唯一分类表 `DESIGN_AUTHORITY_CLASS_ROWS`、`classifyDesignAuthorityCodes`、只读重跑 `diagnoseDesignAuthority`。
- `harness/scripts/utils/change-unit-feature-projection.ts`：reconcile 路线检查的 `structured` 带 `codes`（CU 未过门时是验证器原始 code，其余是本条 issue 的 id）。
- `harness/scripts/utils/condition-wait.ts`：探针 `design_authority_projectable`（读停机事件里记录的检查 id，重跑 `diagnoseDesignAuthority`，记录的每一条都不再阻断才就绪）；`recheck` 可返回 `'park'`，立即按超时收尾。
- `harness/scripts/utils/goal-supervisor.ts`：导出 `externalWaitingProbe`（supervisor 唤醒与接续决策共用同一提取）；`superviseRun` 收 `inheritedRestarts`。
- `harness/scripts/goal-supervise.ts`：`inheritedSupervisorRestarts`——沿本 run 审计过的 supersede 目标往回，累加同一交付周期内被承接 run 上的重启次数。
- `harness/scripts/utils/capability-resolution-entry-input.ts`：把"本阶段仍持有该 artifact 的改写权"提成共享谓词 `phaseOwnsDesignOutput`（原闭包改为调用它，行为不变）。
- `harness/scripts/utils/goal-run-creation.ts`：第七种变化 `external_condition_ready`；唯一恢复判断 `staleFrozenBindings`；`decideRunContinuation` 在探针就绪时消费它（绑定有效 → 重新接入并越过冷却；失效 → 走既有的 `successor()`）。
- `harness/scripts/goal-phase-runtime.ts`：设计 owner 停机事件带 `probe: 'design_authority_projectable'` 与 `design_authority`（分类 + 简报）；停机说明带分类、简报与"修好后重发即续跑"；`designRepairBrief`；显式 `--resume` 在前台入口与 detach launcher 两处接上同一判断（`resumeTurnsIntoSuccessor`）；进程内探针唤醒在重查前先过同一判断，绑定失效即停放；接续决策的探针执行者与进程内等待同源（`conditionWait.runProbe`）。
- `harness/tests/unit/design-authority-repair.unit.test.ts`：S15 流程函数（`s15RejoinFlow` / `s15StaleFlow` / `s15AuthorityFlow`）与 7 条新用例；S14 驱动导出（`s14Run`），批一三条 A2 用例改为调用它；批一 A1 用例的 `structured` 断言随 `codes` 字段更新。
- `harness/tests/unit/reliability-scenarios.unit.test.ts`、`harness/tests/fixtures/reliability-scenarios/registry.json`：S14（3 支）、S15（5 支）登记与实测；`runAll` 支持只供本地用的 `RELIABILITY_SCENARIOS_ONLY`。
- `harness/tests/unit/goal-runner-testing-integrity.unit.test.ts`：测试驱动的恢复形态 argv 也尊重 `noAutoForce`（原先恒带 `--force`；没有既有调用方同时传 `resume` 与 `noAutoForce`）。

**验证结果**

- `design-authority-repair` 全套 15/0（批一 8 条 + 本批 7 条，真 harness、公开入口）。本批 7 条：`B4-table`；`B1-mixed`（plan 门的两条阻断由真实检查产出、经真实 summary 写入器落盘、真实运行时裁决，门的执行用假 harness）；`S15-rejoin`；`S15-successor`；`S15-supervisor`；`S15-authority`；`S15-wake`。
- `reliability-scenarios` 只跑 S14、S15：13/0（5 条自检 + 8 个分支）。S14 三支：run 内调和完成（操作者动作 0）、本 CU 被跳过时停机、兄弟 CU 被跳过仍完成。S15 五支：重新接入、未修保持停止、自动后继、supervisor 拉起后自动后继、B2 裁决后完成。八个分支的期望全部达成。
- 六项指标（只含这 8 个任务，`scripts/reliability-metrics.mjs --scenario-results`）：正确自主完成 6/8（两个反例按期望不完成）；可恢复故障自动恢复 2/2；操作者动作 7、产品决定 4；错误完成 0；恢复成本逐任务已记（S14 两支约 8.7–8.9 秒、1 次调用；S15 重新接入与 B2 约 10 秒、1 次调用；两支自动后继约 50–53 秒、4 次调用）；重复稳定性未测。数字写在登记表新字段 `metrics_9c3d7e1a`，各分支实测写在新分支自己的 `baseline`；既有字段未动（写入脚本核对过既有 13 个场景序列化前后相同）。
- 反向变异 13 条全部转红并按原字节还原（每条还原前后 `git diff` 的 sha256 相同）：探针只查第一条记录的阻断；停机事件不带探针；分类"任一 B1 即 B1"；未登记原因码默认 B1；探针未就绪也算变化；接续决策绕过恢复判断（结果是在失效绑定上重新接入、退出码 1）；进程内唤醒绕过恢复判断（设备门被重查放行 3 次）；前台显式 `--resume` 绕过判断；supervisor 拉起的 `--resume` 绕过判断；停放时不释放锁（readiness 报忙）；起后继后重启次数清零；恢复判断不排除链内可重签的手写产物（全手写宿主被误判成起后继）；停机整体分类"任一 B1 即 B1"。
- 直接相关套件：blueprint-skill-projection 23/0、check-disposition 11/0、check-disposition-consumers 19/0、adjudication 60/0、goal-supervisor 29/0、supervisor-kill-recovery 4/0、successor-exit 24/0、goal-park-resume 3/0、agent-containment 21/0、capability-degradation 21/0、goal-run-birth-contract 29/0、component-design-handoff 30/0、change-unit-progression 97/0、phase-evidence-manifest 25/0、feature-assessment 15/0、goal-runner-testing-integrity 111/0。`npm run typecheck` 通过。
- 未跑：全量、real-chain、lifecycle-evolution、金样、reliability-scenarios 的既有 13 个场景（含 S4 两支）——按约定留收口。S4 的代码与登记一个字没动。

**准入两问（本批新增的字段与取值）**

- 检查结果 `structured.codes` 与投影抛错点的 12 个原因码（`authority_*`）：场景是 S15 的分类（§5.0 要求不解析文本）；收益是运行时、探针与 t6 能按同一张表判 B1 / B2。这些抛错点原先只有文本，没有 code 就只能全部归 B2，连 plan 自己举的"机器结构写成文本"都分不出来。
- 停机事件的 `probe` / `design_authority`、第七种变化、探针名：plan §5.0–§5.3 已答。
- `recheck` 的 `'park'` 返回值：场景是 §5.3 的进程内唤醒且绑定已失效；收益是不在失效的绑定上继续，也不空等到 15 分钟上限。
- `inheritedRestarts`：场景是 §5.2 / §12 "重启上限不重置"；收益是探针与门判断不一致时，"拉起 → 起后继 → 再停"不会因为每个后继从 0 计数而无界循环。
- 没有新增停机原因、run 状态、CLI、阻断检查或路由。两个环境变量只在测试里。

**偏离**

1. B1 的范围比 §5.0 表格窄。按表头"混合原因码只有能依据既有权威恢复的才算 B1"落到代码上，只按原因码判时分不出"能不能依据既有权威恢复"，所以 `change_unit_schema_invalid`、缺必填字段类、`change_unit_design_ref_unresolvable` 一律归 B2。B1 只有两个（返修后）：机器内容写成一段文字、蓝图里的 CU 映射指向本 CU 的旧 revision；投影规范化形状问题返修时改归 B2。
2. 指针过期盖住内容问题时归 B2。蓝图升版后本 CU 被调和器跳过（或调和竞争退出）时，检查报出的原因码是 `change_unit_blueprint_ref_stale`，底下真正的内容问题在这一步看不到（§3 明确不另造预检）。表里把它归 B2，说明附调和器的跳过原因。S15 的 B2 一支走的就是这条路。
3. "绑定仍有效"的判据是 `staleFrozenBindings`：run 有效范围里读不回来、且从停机阶段起没有责任阶段能重签的绑定才算失效。没有解析值的源码观察（run 自己会写源码）不核；spec / plan 仍持有改写权的手写 artifact 不核（与阶段输入解析同一谓词）。后果：全手写宿主上修好后总是重新接入；起后继只发生在蓝图派生的绑定（`derive.blueprint-*`）或责任阶段已不在剩余链里的绑定上。
4. S15 "派生绑定已 stale"与 supervisor 两支不是"同上"的宿主。它们用派生施工契约形状（acceptance 手写、contracts / use-cases 不落盘），并且是 run 出生之后蓝图才被写坏（出生时蓝图无效的话派生绑定冻结不出来）。停机前框架先做了一次 run 内指针调和。
5. 自动后继的合同来源沿用既有规则：当前持有范围转交的 run，没有转交记录时取上一次完成的 run。快照宿主没有转交记录，所以后继的 `successor_of` 是上一次完成的 run，停机的 run 由后继审计承接（`supersede` 事件）。plan 写的"从停机的 run 起后继"在有转交记录的宿主上才字面成立。
6. 重发用的是任务原请求的起止（上一次完成的 run 的起止），不是停机 run 自己的起止。既有规则（4e6fb3b6 批三 R3）只容忍与合同来源相同的起止；带着停机 run 的起止重发、又要起后继时会被拒绝并提示去掉起止。这条规则本批没动。
7. 进程内唤醒遇到绑定失效时是停放，不是在进程内起后继。后继出生只在启动入口；停机事件带着探针，下一次重发或 supervisor 拉起时由入口起后继。
8. "停放时释放锁"没有新增代码。设计 owner 分支本来就不做进程内等待，run 收尾的 `finally` 释放锁；本批只保证不给它加等待，并用用例和一条变异守住。
9. 重启上限按"本 run + 同一交付周期内被它承接的 run"累计，实现在 `goal-supervise.ts`（读 supersede 审计事件），不是改决策核的计数函数。
10. 现有规范有三处暂时落后于实现，本批按约定没改，留 t5：`task-continuation-recovery-loop` 的 goal-runner 增量写"supervisor 只恢复同一个 run、每个 run 最多重启三次"（supervisor 仍只发 `--resume`，但 runner 入口可能改起后继，次数改为跨承接累计）；同一份写"进程内探针恢复后同一轮继续"（绑定失效时改为停放）；变化事实仍写六种。批一偏离 6 提到的"首次即停"那条同样留 t5。
11. `B1-mixed` 用例里 plan 门的执行用假 harness，两条阻断由真实检查产出并经真实 summary 写入器落盘。这样省掉一条真链（plan 阶段要同时造出两条阻断，还得先让 spec 真实过门）；真 harness 下的停机、探针与续跑由 S15 各支覆盖。
12. 六项指标只对本批 8 个任务算了一次；全部场景的复跑留收口。登记表的说明文字没有改（那是已有字段），口径写在新字段 `metrics_9c3d7e1a.note` 里。

**放弃的准确性**

- （返修后更正）探针按生产检查同一条输入解析路径重评；重评不了即未就绪，不再把"没查到"当成"已消除"。
- 分类只看原因码。同一个码下"其实能依据既有权威修"的情形会被归到 B2，结果是该交设计 owner 直接修的问题被说成要等有权者。（返修后更正）反方向在返修前会发生：原先的三个 B1 码里混着缺内容、缺替代目标、指向另一个 CU 的情形；返修后 B1 的两个码各自由抛错点的事实保证有原文或唯一替代目标。
- 接续决策现在会在重发时跑一次停机所挂的探针（设备、能力、存储、设计权威）。探针是只读的，但设备探针有耗时；没有做缓存。
- 起后继后的 supervisor 重启计数只沿 supersede 审计事件回溯，审计事件缺失的旧 run 不计。
- 假 agent 不会读停机说明；"设计 owner 看到 B1 简报后照着修"这一步只能在真实 agent 层验证。
- detach launcher 那一处的判断没有单独的变异（它与子进程入口用同一个谓词，单独去掉 launcher 这一处时子进程仍会改判，只是 launcher 打印的 run id 对不上）；`'park'` 的提前收尾也没有单独变异（去掉后结果相同，只是多等到上限）。

**未解决**

- 偏离 6：宿主若带着停机 run 自己的起止重发且需要起后继，会被既有起止校验拒绝。要不要放宽需要另行裁定。
- 变异"停放时不释放锁"会让测试进程挂住（锁心跳定时器不清），那次是手工结束进程后还原的。这是变异本身的副作用，不是产品问题；以后重做这条变异要单独跑并准备结束进程。
- t5（手册、MIGRATION、OpenSpec）与 t6 未做。

### 批二返修（codex 实现评审首轮）— 2026-09-30

三项必修都已处理；codex 接受的七处取舍未动。

**意见 1（P1）：探针在重评不了时把"没查到"当成"已消除"**

- 修法：`diagnoseDesignAuthority` 改走生产检查同一条输入解析路径（`resolveCapabilityResolutionEntryInput` → `resolveCapabilityInputs` → `SpecLoader.loadFeatureSpec(feature, inputs)`，与 harness-runner 相同），只来自派生输入的施工契约也看得到；唯一的差别是不带 run 冻结的期望绑定（绑定是否仍有效由 `staleFrozenBindings` 另判）。返回值多一个 `unevaluable`：输入解析抛错，或门的对象解析不出来（spec 的 acceptance / CU 门的 contracts）时给出原因。探针遇到 `unevaluable` 一律未就绪。没有新状态、缓存或第二套解析器。
- 取证中的一个事实：派生施工契约宿主上，设计在 coding 阶段被写坏时，生产链路给出的不是设计 owner 停机，而是阶段调用前的 `upstream_closure_gap`（等人）——不在本 plan §1 冻结的两处触发面内。所以"派生施工契约上的设计停机"由真实生产者能造出来的只有 spec 阶段的 A1 停机；混合阻断要在 plan 阶段才有，而派生施工契约宿主的出生链不含 plan，这个组合造不出来。
- 反例（真实生产者）：`S15-successor` 与 `S15-supervisor` 两支在派生施工契约宿主的停机上新增——未修时对 spec 探针未就绪；对依赖施工契约的阶段（coding）探针给出"无法重评"、未就绪（修复前这里返回就绪）；未修时 supervisor 跑一轮不拉起、停机 run 上没有 `supervisor_restart`；修好后才就绪。混合阻断"只修一条仍未就绪"保留在 `B1-mixed`（全手写宿主，现已改为真 harness）。

**意见 2（P2）：三个 B1 原因码是混合语义**

- 修法：在原抛错点按事实给不同的码——
  - 内容是一段非空文字 → `authority_content_not_machine_structure`（B1，有原文可依）；`null`、数字、空串、数组等 → 新码 `authority_content_missing`（B2，缺内容）。
  - `authority_projection_shape_invalid` 整体改归 B2：规范化报出的形状问题是一组文本，其中缺必填路径、路径越界这类没有确定替代值，只凭这个码分不开。
  - 蓝图里的 CU 映射引用与当前 CU 是同一个 CU（artifact / component / blueprint / change_unit 四键相同，只差 revision 或字节）→ `authority_cu_mapping_stale`（B1）；否则 → 新码 `authority_cu_mapping_conflict`（B2，归属冲突）。
  - B1 现在只有两个码。准入两问沿用批二"`structured.codes` 与投影抛错点原因码"那一条：这是既有失败点的诊断细分，没有新增失败判据。
- 反例（真实投影生产者，新用例 `B4-codes`）：内容为 `null` / 数字 / 空串 → B2；施工契约缺 `modules[].package_path` → B2；映射引用指向另一个 CU → B2。正例：整段内容写成文字、映射引用指向本 CU 旧 revision → B1。

**意见 3（P2）：B3 的证据口径**

- `S15-wake`：不再手写 `phase_halt` 与 outcome。注入点仍是既有的设备门缝，但里面调用的是真实 `runDeviceReadinessGate`，只把它读设备状态的 deps 换成替身（先不在线，等待期间上线且未锁屏）；探针用真实的 `evaluateDeviceReadinessProbe` 对同一份替身状态求值。改写时发现原先的替身探针若抛错会让用例靠"等到上限"通过，现在加了一条断言：探针就绪后应立即停放（探测次数不超过 3）。
- `B1-mixed`：第二处修复（去掉越界模块）改为先取 feature 锁再写、写完释放，并断言取得到锁。用例同时改成真 harness（与 S14 同一驱动：run 真实出生、spec 真实过门，plan 首轮窗口内蓝图被写坏、plan 的 agent 写进越界模块）——改走生产输入解析后，假 harness 夹具里事实基线没有真实建立，生产路径在那里解析不了。
- 随之改动的一处断言：`B1-mixed` 的现场里框架的 run 内调和改过 contracts.yaml，既有的 `related_repair_changed` 已让重发重新接入，所以这里不再断言"保持停止"，改为断言探针未就绪时决策里不出现 `external_condition_ready`；"冷却期内保持停止"的真实链路证据在 `S15-rejoin` 的未修重发一步，没有变。

**顺手项**

- supervisor 用例的表述改准确：测试重放的是同一恢复形态（`--resume <run> --force-resume --detach`，不带 `--force`），驱动层另带测试宿主需要的 `--foreground-ok` 与 `--ack-unverified-ledgers`。没有改成按捕获参数原样重放——驱动层的 argv 由它自己拼，改它要动共享测试驱动。
- 重复探测没有做：supervisor、detach launcher、子进程入口各探一次，launcher 改判时决策算两遍。要复用得把决策结果穿过三个函数签名，改动不小，记入放弃的准确性。

**改动文件**

- `harness/scripts/utils/blueprint-skill-projection.ts`：两处抛错点细分原因码；分类表三行调整；`diagnoseDesignAuthority` 改走生产输入解析并返回 `DesignAuthorityDiagnosis`。
- `harness/scripts/utils/condition-wait.ts`：探针把 run id 传给诊断；`unevaluable` → 未就绪。
- `harness/scripts/goal-phase-runtime.ts`：`designRepairBrief` 传 run id；诊断不可用时打一行告警并按"原因码未登记"归 B2。
- `harness/tests/unit/design-authority-repair.unit.test.ts`：新增 `B4-codes`；`B4-table`、`B1-mixed`、`S15-wake`、`s15StaleFlow` 按上文修改；`runWithStalePointerAtPlan` 多一个 `afterPlanWrites` 选项。

**验证**

- 反向变异 8 条全部转红并按原字节还原（还原前后 `git diff` 的 sha256 相同）：门重评不了也当成已消除（派生宿主上对 coding 返回就绪）；`null` / 数字也算写成文字；指向另一个 CU 也算映射过期；形状问题仍归 B1；探针只查第一条记录的阻断；探针未就绪也算变化；进程内唤醒绕过恢复判断（真实设备门被重查 3 次）；前台显式 `--resume` 绕过判断。"停放时不释放锁"按要求没有重做。
- `design-authority-repair` 全套 16/0（16 条）；`reliability-scenarios` 只跑 S14、S15：13/0（5 条自检 + 8 个分支），八个分支期望全部达成（登记表的 `baseline` 与 `metrics_9c3d7e1a` 仍是批二那次的实测，没有改写）。
- 直接相关套件：blueprint-skill-projection 23/0、check-disposition 11/0、check-disposition-consumers 19/0、adjudication 60/0、goal-supervisor 29/0、supervisor-kill-recovery 4/0、successor-exit 24/0、component-design-handoff 30/0、change-unit-progression 97/0、capability-degradation 21/0。`npm run typecheck` 通过。
- 未跑：全量、real-chain、lifecycle-evolution、金样、reliability-scenarios 的既有 13 个场景。

**对批二记录的更正**

- 偏离 1 里"B1 只有三个"已改为两个（见上）。
- 放弃的准确性第 1 条（探针读盘上文件、会提前判就绪）已不成立，改为：探针按生产输入路径重评，重评不了即未就绪。
- 放弃的准确性第 2 条里"反方向不会发生"不成立，已改写：修复前确实可能把缺内容、缺替代目标的问题说成可直接修；修复后 B1 的两个码各自由抛错点的事实保证有原文或唯一替代目标。

**另记（不在本次返修范围，未处理）**

- run 内指针调和改写 contracts.yaml 之后，如果该 run 随后停机，既有的"相关修复已变化"判定会把框架自己的这次改写当成变化，重发同一请求时不受冷却约束地重新接入（随后按原因再停）。这是批一 run 内调和与 4e6fb3b6 变化判定之间的相互作用，可能产生重复接入，次数未证明限于一轮（基线取最近的写入观察，后续调用没有字节变化时不一定更新基线）；不绕过原检查、不扩大授权，预算照常累计并受门限约束，不影响结论。

### 批二评审结论（codex 两轮）— 2026-10-01

首轮暂不通过（3 项必修，见上节）；确认轮**通过**：三项必修关闭，无新增阻断。codex 撤回两条过宽的验收要求（不要求在派生宿主上构造生产链到不了的 plan 混合停机；不要求 `B1-mixed` 在其它合法变化已成立时仍断言保持停止）。非阻断建议采纳一条：上面"另记"一段的表述已按其意见改准。调度者独立复跑 `design-authority-repair`（返修前）15/0。

### 批三 t5（前四项行为的文档与规范）— 2026-10-01

只覆盖 t1–t4 已实现的行为；只改文档与规范，没有动任何 `.ts` / `.json` 与测试。t5 的 status 保持 `pending`（t6 相关部分未做）。

**改动文件**

- `docs/operations/goal-mode-runbook.md`：新增一节「设计权威出问题时」（A 类 run 内调和、B 类停机的 B1 / B2 与修复简报、修好后重发即续跑的两条路、未修重发的结果、supervisor 唤醒与上限、readiness 报忙的含义）；「停机之后怎么继续」的变化事实六种改七种并补第 7 条，无人值守冷却那一条按"探针就绪即越过"改准；「进程内等待」补两条（探针就绪但绑定失效时停放；设计权威停机不做进程内等待）；「supervisor 的适用范围」改为"只负责拉起、由 runner 同一处判断继续还是起后继，重启上限 3 次按任务累计、起后继不清零"；「已知代价」同步（七种变化；重发时会跑一次探针、设备探针有耗时无缓存）。
- `MIGRATION.md`：P4 节"设计权威本身有问题时"一条改写为两类处理 + `external_condition_ready` 越过冷却 + supervisor 上限按任务累计 + readiness 报忙；其余条目未动、未重排。
- `openspec/changes/check-disposition-single-verdict/specs/goal-runner/spec.md`：「首次即停」那条改写并改名为 `Failures owned by the design owner are reconciled in the run or stop on first occurrence`——先判调和候选并在 run 内调和（记 `design_authority_repair`），其余首次即停；停机带 `design_authority`（分类与简报，B1 恰两个原因码）、探针、停放释放锁；场景由 2 个增到 6 个。Enforcement 补 `change-unit-path.ts`、`condition-wait.ts`。
- `openspec/changes/task-continuation-recovery-loop/specs/goal-runner/spec.md`：变化事实六种改七种并写明第七种的判据与"有效则重新接入、失效则起后继"；「Probed halts reach run_end…」一条改名并改写为"supervisor 只拉起 `--resume`，原 run 继续还是起后继由一处判断，三条路都消费它；重启上限 3 次沿承接关系累计"；「Probed halts wait in-process…」补"探针就绪但绑定失效时停放，由启动入口起后继"与"设计 owner 停机不做进程内等待"；新增 5 个场景。Enforcement 补 `goal-run-creation.ts`。
- `skills/project/component-design/SKILL.md`：第 110 行原地补一句 `blueprintRefs.busy` 的读法，行数不变（边界措辞没动，留 t6 之后）。
- `openspec/changes/check-disposition-single-verdict/specs/change-unit-continuous-progression/spec.md`：逐条对过现行实现（两层锁、借锁、取锁后写集守卫、`busy`、成败按本 CU、计入内容重试预算、readiness 报忙不派生结论），一致，未改。

**验证**

- `npm run openspec:validate`：52 passed / 0 failed；Enforcement 路径检查 PASS。
- `node scripts/check-plan-version.mjs`：PASS。
- `cd harness && npm run check:docs`（含 SKILL.md 行数预算）：Verdict PASS，阻断 0；15 项里 1 项 MAJOR FAIL `doc_freshness`（13 份文档的源文件提交时间晚于文档，按 git 提交时间算，本次改动未提交、不在其内，属既有状态）。
- 行尾：`git ls-files --eol` 复核本次动过的文件均为 `w/lf`。
- 没有跑 harness 单测（本次不改代码）。

**偏离**

1. 两条 OpenSpec Requirement 改了标题（原标题写的是"首次即停"与"supervisor 只恢复同一个 run"，与改写后的内容相反）。两条都在各自 change 的 ADDED 节里，主规范里还没有同名条目；两个 change 的 proposal / tasks 没有按标题引用它们。
2. `task-continuation-recovery-loop` 里除批二记录点名的三处外，另改了两处同源的落后表述：场景「An attended call is not held by the cooldown」里"无人值守的调用此刻保持停止"补上"除非停机所挂探针已就绪"（该场景的能力缺口停机本身带探针）；「Human-facing halt guidance…」里无人值守等冷却的那句补同一例外。
3. 手册里除新增一节外，还改了既有四处与第七种变化、supervisor 行为直接矛盾的句子（见改动文件）。不改的话同一份手册里会有互相矛盾的说法。
4. 手册与 MIGRATION 把 B1 的两个原因码写了出来（任务书要求数字与代码一致）；B2 只按类别概括，没有逐码列出，完整清单以 `DESIGN_AUTHORITY_CLASS_ROWS` 为准。
5. `skills/project/change-unit-progression/SKILL.md` 没改：它只说"直接派生 readiness"，没有"结果怎么读"的说明；报忙的读法只加在 component-design 输出 `blueprintRefs` 的那一行。

**放弃的准确性**

- 手册写"未修就重发：冷却期内保持停止"。有一种情形不是这样：停机前框架做过 run 内指针调和并改写了 contracts.yaml 时，既有的"相关修复已变化"会让重发直接重新接入再停（批二返修"另记"那条），手册没有展开这条相互作用。
- 手册把六个探针名归成四类来讲（设备就绪类含设备、凭据、adapter 能力三个探针名），没有逐个列名。
- 规范里"绑定是否失效"的判据按 `staleFrozenBindings` 的现行口径概括成一句，两类不核的对象（无解析值的源码观察、spec / plan 仍持有改写权的手写产物）写了，具体谓词名没有写进规范。

**留给 t6 之后补**

- OpenSpec `app-component-blueprint` 增量（预授权的无人值守 B1 修复作为合法修订来源）；goal-runner 增量里的派发路线、一次尝试规则、`content_repair` 动作与 `attempted` 记账。
- `framework.local.schema.json` 的 `design_repair.unattended_b1`；`skills/reference/design-repair-unattended.md`。
- `skills/project/component-design/SKILL.md` 的边界措辞（"不进 Goal Mode"→"设计阶段不启动 run；无人值守修复子契约见 reference"）。
- 手册与 MIGRATION 里"无人值守时 B1 由框架自动接手"的说明（现在两处都只写了设计 owner 修）。
- P4 plan t5 的关闭记录（P4 §16）与总纲 §14 记录；本 plan t5 的 status。

### 批三 t5 返修（codex 首轮）— 2026-10-01

codex 暂不通过，4 项文档契约问题。逐条对过代码，四条都属实，全部采纳；只改文字，没有改实现，没有扩到 t6。

1. **"未修就重发必定保持停止"缺条件**（属实：`goal-run-creation.ts` 的保持停止要求无人值守、正式开始过、HALTED / DEFERRED、冷却期内、且没有任何变化事实）。手册「修好之后」第 3 条改为：探针没就绪只是第七种变化不成立；列出保持停止的全部条件，以及会重新接入并重新执行当前阶段的三种情况（有人在场、过了冷却、其它变化成立——点名 run 内调和改写 contracts.yaml 引起的相关修复变化）。`task-continuation-recovery-loop` 的对应场景补"无人值守、冷却期内、其余六种变化都没有"的前提与反面。MIGRATION 同步一句。上一节"放弃的准确性"第 1 条因此不再成立。
2. **有人在场入口的后继来源仍写旧三种**（属实：`goal-mode-entry.ts` 的 `--prepare-run` 以 `attended: true` 走共享决策，探针就绪且绑定失效同样进后继分支）。手册两处、规范三处改准：后继的枚举补"非结构终局、探针就绪且冻结绑定失效"；"有人在场直接重新接入"限定为"除非后继条件成立"；`SHALL arise only` 的清单补第四种。
3. **锁释放不保证 supervisor 唤醒**（属实：对方只放锁、没替本 CU 升版时旧指针阻断仍在，探针不就绪）。手册 A 类"竞争退出"一条改为：竞争解除后重发同一请求；只有别的调和已把本 CU 指针升好、探针就绪时 supervisor 才可能唤醒。MIGRATION 同步半句。
4. **"启用 supervisor 后不用重发"漏了 session owner**（属实：`goal-supervise.ts` 对 `owner.kind=session` 一律 `no_op`，主规范 goal-runner 已有此条）。手册「设计权威出问题时」与「supervisor 的适用范围」、MIGRATION 都限定为 owner 是进程的无人值守 run；owner 是会话的 run 由会话重新发起同一请求接入。适用范围的"不拉起"清单另补 run-control 缺失或损坏、owner 正在收尾或交接未完成。

**改动文件**：`docs/operations/goal-mode-runbook.md`、`MIGRATION.md`、`openspec/changes/task-continuation-recovery-loop/specs/goal-runner/spec.md`。`check-disposition-single-verdict` 的两份增量、`component-design/SKILL.md` 未再动。

**验证**：`npm run openspec:validate` 52 passed / 0 failed，Enforcement 路径 PASS；`node scripts/check-plan-version.mjs` PASS；`cd harness && npm run check:docs` Verdict PASS、阻断 0（`doc_freshness` 同上一节）；行尾复核全部 `w/lf`。

**偏离**：supervisor 的 session owner 边界没有再写进 `task-continuation-recovery-loop` 的增量——主规范 `openspec/specs/goal-runner/spec.md` 已有这条 Requirement，增量里那条没有与它矛盾的表述。

### 批三 t5（前四项行为）评审结论（codex 两轮）— 2026-10-01

首轮暂不通过（4 项文档契约问题，见上节）；确认轮**通过**：四项关闭，无新增阻断、无非阻断建议。codex 撤回"必须在接续增量中再次写入 session owner 边界"的要求（主规范已有该约束）。t5 余下部分（t6 相关的规范、schema、子契约文档、SKILL 边界措辞、P4 t5 关闭记录）待 t6 实现后做。

### 批三 t6（无人值守 B1 自动接手）— 2026-10-01，实施完，待 codex 实现评审

按任务书实施（落点取证 `dist/t6-facts.md`、裁定草案 `dist/t6-rulings-draft.md`、codex 预审，以及 §9 第二条的用户口径）。实施第一步先核实 K4：新用例 `R3 映射过期的修法`（真实快照 + 真实调和 + 真实投影）证实把蓝图里的 `contracts.change_unit.change_unit_ref` 改指当前 CU 后，发布后的调和把 CU 再升一版、投影再报 `authority_cu_mapping_stale`；删掉这条可省略的引用、由投影填入当前引用，调和后不再报映射问题、其余映射保留——分类表说明与子契约按"删掉引用"写。

**验收结论（§8 D1–D5，§6 S16 与反例）**

- D1 成立：S16 主线（全手写宿主，冻结绑定修复后仍有效）——预授权 + spec 的真实门报 B1 → 两层锁内依次派编写、独立质询两次链外调用 → 草稿旧质询整份作废后机器派生准入为 `blocker`、质询重新产出后派生为 `pass`（canonical 原本就是 pass，历史保留）→ 真实校验、发布 rev+1、同一锁内调和、探针 → 同一 run 原地重评 spec（`FAIL:retry → PASS`）并由这个 run 正确完成，没有停机、没有新 run，操作者动作 0。绑定失效支（派生施工契约宿主，修法补全了施工契约写集）：发布、调和、探针都过，但冻结绑定失效 → 不在本 run 继续，停放（探针已就绪）；生产 supervisor 实际拉起、恢复入口起后继并完成 → 操作者动作 0；未经 supervisor 时重发同一请求才起后继 → 如实计人工动作 1。
- D2 七个反例各自成立：
  - 反例一：无预授权（c1）、预授权写成字符串 `"true"`（c1b）都不派发；有人在场（会话 owner，c1c）也不派发。
  - 反例二：编写调用改了需求、契约、个人配置（c2）→ 不发布，落既有 `phase_write_violation` 并走既有违规停机出口 `backtrack_target_absent`（不挂探针，不降为设计等待），事件披露路径与前后哈希；被改文件保持改后的样子（只检测、不还原，"不发布"与"未发生越界改写"分开断言）。调用后快照不可验证（c2b）同样走这个出口。
  - 反例三：质询非正常退出（c3a）、正常退出但没有结果（c3b）、编写自报准入（c3c）、修复后准入派生不过（c3d）→ 都不发布、草稿丢弃、canonical 字节与质询历史不变，事件披露失败步骤，停在设计 owner 出口并说明"已用掉唯一一次机会"。预算（c3e）：编写之后剩余调用次数不足 → 不启动质询，`agent_invoke_start` 恰为实际启动的 2 次。
  - 反例四：B2 + 预授权（c4）不派发。
  - 反例五：同一签名——冷却期过后操作者显式 `--resume` 让同一 run 再次停在同一签名、以及 `--supersede` 起后继，都不再派发（c3a 后半）；attempted 在编写调用进行中已在 events 里（主线断言 `attemptedBeforeInvoke`）。
  - 反例六：两个真实 run（c6）——兄弟 CU（ledger-summary）的 run 跑在 worker 线程里、停在 spec 的 agent 调用中持有自己的 feature 锁；本 run 派发时取不到两层锁 → 不派发、没有 attempted、停放并说明竞争；兄弟 run 放行后取到锁、派发并发布；本 run 冷却期内重发时探针已就绪 → 重新接入同一 run 并完成（计一次人工重发）；蓝图只发布一次。
  - 反例七：发布后探针不过（c7a，修法把内容写成空）→ 不回滚，`published` 事件 `outcome=unrecovered`、`failed_step=probe`，停机按发布后的新状态（B2）分类并披露"已发布 rev N、探针未通过"；发布后调和未完成（c7b，本 CU 被调和器跳过）→ 不回滚、不落入草稿失败分支，披露"已发布 rev N、调和未完成"。
- D3 成立：准入由提取出的 `deriveBlueprintAdmission` 派生并写回，校验器改为调用同一函数再比对；编写调用前后 `review_summary.questioning` 与 `admission` 不得变（c3c 反例），质询调用只能改质询结果（运行时比对其余内容）；两次调用是两次独立的 adapter 调用（不同 invoke、不同用途标识），质询提示词只含草稿、必答范围与不变视图依据，不含编写方的修复简报（主线断言）；质询方标识 `design-repair-questioning`，不等于编写方。
- D4 成立：`design_repair.unattended_b1` 只有布尔 `true` 开启（framework-local-config 新用例 + c1b）；白名单、读盘抄值、schema 已接；既有局部写回（`updateLocalConfig`）后键仍在。两次调用沿用 `agent_invoke_start` / `end` 计次（`phase` 为用途标识 `design-repair-author` / `design-repair-questioning`），每次调用前查剩余次数与墙钟（c3e）；整个尝试在两层锁内（编写调用进行中蓝图锁与全部 CU 的 feature 锁都在，主线断言）。
- D5 成立：同一合法蓝图在 canonical 位置与草稿对象（真实宿主根作 context）上校验结果逐条相同；反例：以草稿目录为根得 18 个 BLOCKER。

**改动文件**

- `harness/scripts/utils/design-repair-unattended.ts`（新）：一次尝试的编排（取锁 → attempted → 只复制蓝图文件的草稿 → 编写 → 草稿外核对 → 作废旧质询、登记 revision 与修订依据、旧派生结论标 stale、派生并写回准入 → 质询 → 再派生、真实校验 → 复核 canonical 基线 → temp→rename 发布 → 同一锁内调和 → 放锁 → 探针）；停机签名与 attempted 判重。
- `harness/scripts/goal-phase-runtime.ts`：决策梯在 A 类分支之后加派发分支（四个前提）与越界违规分支；B1 分类前移、与停机分支共用；链外调用包装（计次、墙钟、guardian 收容与中断杀进程）；`bindGuardianOrKill` 从阶段调用里提出来两处共用；多持的锁登记进 `releaseAllLocks`；停机说明附修复结果。
- `harness/scripts/utils/change-unit-design-preparation.ts`：取锁段提成 `acquireBlueprintWriteLocks`、锁内调和 `reconcileHeldBlueprintRefs`（消费实际取得的锁集合、保留写集守卫），调和入口改为调用二者。
- `harness/scripts/utils/blueprint-admission.ts`：`deriveBlueprintAdmission`；`component-blueprint-validator.ts`：`validateComponentBlueprintUpstream`。
- `harness/scripts/utils/condition-wait.ts`：探针判定提成 `probeDesignAuthorityRecovered`（停放后读停机事件、运行中显式传入）。
- `harness/scripts/utils/phase-write-boundary.ts`：快照函数可选 `runtimeExcluded`（给出时取代按目录名排除运行时路径的通用规则）。
- `harness/scripts/utils/framework-local-config.ts`、`config-field-ownership.ts`、`specs/framework.local.schema.json`：预授权键。
- `harness/scripts/utils/blueprint-skill-projection.ts`：`authority_cu_mapping_stale` 的修法说明。
- `harness/scripts/utils/goal-report-generator.ts`：渲染 content_repair 的阶段、rev 与结果。
- `harness/scripts/utils/goal-progress.ts`：停滞判定跳过带用途标识的调用结束事件。
- `skills/reference/design-repair-unattended.md`（新）：无人值守修复子契约。
- 测试：`design-authority-repair.unit.test.ts`（R3、D5、S16 主线与两支、c1–c7 共 19 个新用例；`haltAfterBirthAtSpec` 加一个可选参数）、`goal-runner-testing-integrity.unit.test.ts`（驱动加 `onOutOfChain`）、`framework-local-config.unit.test.ts`（1 个新用例）、`reliability-scenarios.unit.test.ts` 与 `fixtures/reliability-scenarios/registry.json`（S16 四支与新字段 `metrics_9c3d7e1a_t6`）。

**验证结果**

- `npm run typecheck`（harness）通过。
- `design-authority-repair` 整套 35/0（分 12 块跑，每块不超过 10 分钟）：批一、批二既有 16 条全部仍通过；新增 19 条。
- `reliability-scenarios` 只跑 S16：9/0（5 条自检 + 4 个分支），四支期望全部达成。六项指标（4 个任务，`metrics_9c3d7e1a_t6`）：正确自主完成 3/4（反例按期望不完成）；可恢复故障自动恢复 2/3（重发支计人工）；操作者动作 1、产品决定 0；错误完成 0；恢复成本逐任务已记；重复稳定性未测。既有字段与其它场景一字未动（写入脚本核对）。
- 相关套件：framework-local-config 25/0、config-field-merger 30/0、phase-write-boundary 9/0、component-blueprint 97/0、component-assets 46/0、component-closure 45/0、adjudication 60/0、check-disposition（含 consumers）30/0、blueprint-skill-projection 23/0、goal-progress 57/0、component-design-handoff 30/0、change-unit-progression 97/0、agent-containment 21/0、goal-supervisor 29/0、goal-park-resume 3/0、supervisor-kill-recovery 4/0、goal-headless-guard 135/0、feature-assessment 15/0、phase-evidence-manifest 25/0、successor-exit 24/0、goal-runner-testing-integrity 111/0。
- `npm run check:docs`：Verdict PASS（`doc_freshness` 同前，属既有状态）；`skills/reference/` 没有行数预算检查。
- 反向变异 25 条全部转红并按原字节还原（每条还原后文件 sha256 与 `git diff` 整体哈希都与变异前相同）：预授权只要 truthy 即开；B2 也派发；有人在场也派发；无视 attempted；attempted 移到编写调用之后；取锁范围为空；忽略草稿外改动；快照不可验证当干净；接受自报准入；保留旧质询；质询无结果也接受；准入取作者自报；跳过发布前校验；调和失败当已恢复；跳过探针；忽略失效绑定；越界当设计等待；去掉调用前预算检查；竞争退出也记 attempted；运行中探针不传本次阻断；运行时不借本 feature 锁。批一的四条锁变异在重构后重做：不取 feature 锁、不取蓝图锁、A 类运行时不借锁、去掉写集守卫——全部转红。
- 未跑：全量、real-chain、lifecycle-evolution、金样、reliability-scenarios 的既有场景（留收口）。

**准入两问（本批新增）**

- plan §5.5 已答：预授权键、派发路线、事件的 `content_repair` 动作与 `attempted` 阶段、子契约文档、准入派生函数。
- `capturePhaseInvocationSnapshot` 的 `runtimeExcluded`：场景是用户裁定②（草稿外改动按授权、产品、验收的实际输入覆盖，既有排除会漏掉 `goal-runs` / `reports` / `context` 下的输入）；收益是链外调用的核对只排除列明的运行时写入。阶段调用不传，行为不变。
- 事件里的记录字段：`agent_invoke_start` / `end` 的 `chain_phase`、`purpose`；`content_repair` 的 `signature`、`checks`、`preauthorization`、`failed_step`、`files`、`new_revision`、`outcome`、`admission_after_invalidation` / `admission_after_questioning`、`review_projection_stale`；`phase_write_violation.violation` 的新取值 `outside_design_repair_draft`。场景：签名判重、D1 / D3 的证据、发布后状态披露；收益：恢复入口能判重、评审能从事件看出机器派生与失败步骤。都不参与质量裁决（`signature` / `stage` 参与次数统计，plan 已写）。
- 没有新增停机原因、run 状态、路由、CLI 或阻断检查（停机原因 `backtrack_target_absent`、`execution_scope_unresolved` 都是既有登记）。

**偏离**

1. 越界写入的处置一律走既有违规停机出口 `backtrack_target_absent`，不回退到被改产物的责任阶段：链外调用自己没有责任阶段可回退（即使被改的文件归链内某阶段，也停机，由后继全量重验）。事件 `phase_write_violation` 的 `phase` 是用途标识。
2. 调用后快照不可验证也走这个违规出口（与反例二同一行的期望）；调用前就不可验证时还没派出调用，只判尝试失败、落设计 owner 停机。
3. 草稿外核对的覆盖范围取工程根下全部顶层条目（依赖、缓存、构建目录按快照既有规则排除），比用户列出的清单宽（为了不漏 `src`、`doc` 里的术语与架构等验收输入）；必要运行时写入排除只有两项：本 run 目录（草稿、调用日志、事件、进度、beacon、run 锁）与本 feature 锁文件（心跳）。
4. 修订依据写进根 `provenance` 的既有键：`source_kind=design_repair_unattended`、`source_ref=framework.local.json#design_repair.unattended_b1`、`source_revision=revision-<旧>`、`observed_at`、`extraction_method=unattended_b1_repair:<检查[原因码]>`；整段换成新对象（夹具里根 provenance 是 YAML 锚点，原地改会连带改掉所有别名节点）。
5. 编写调用改了 `revision` 或根 `provenance` 不判失败，运行时直接覆盖登记（子契约仍禁止）；只有准入与质询结果按自报判失败。
6. 显式 `--resume` 对 HALTED run 有 5 分钟冷却，`--force` 也不越过；反例五的"同一 run 第二次停机"用例等冷却过去再 resume（该用例约 6 分钟）。"attempted 之后进程中断"没有真的杀进程：证据是编写调用进行中 attempted 已落盘，判重读的是同一份 events。
7. c3e（预算）与 c1c（有人在场）用兄弟 CU 的 fresh run 构造：后继的预算继承源 run 且按交付周期累计，出生期给的预算不生效；本 CU 的后继经 host bridge 出生时，快照里历史绝对路径的影响依据不可用。兄弟 CU 的运行范围经生产 `prepareFeatureScopeCandidate`（`--prepare-scope` 同一函数）准备。
8. 反例六只构造了"一方持锁时另一方竞争退出、随后另一方发布"的交错；"两方都退出停放"的交错没有构造（plan 写的是"可能"）。兄弟 run 跑在同一进程的 worker 线程里（goal 运行时与测试缝是模块级状态，线程之间互相隔离；文件锁的持有者 pid 相同且存活即视为他人持有）。
9. 已发布但未恢复时，停机简报按发布后的新状态重新分类（c7a 由 B1 变成 B2）；绑定失效停放时，停机说明首行沿用"设计权威在本 run 内无法修复，已停止"，下一行写明"已发布并调和、冻结绑定失效、已停放、由恢复入口起后继"。
10. `goal-progress` 的停滞判定跳过带用途标识的调用结束事件——这是按取证清单 §2.5 逐个核对后唯一需要排除的读者（链外调用后面没有阶段 verdict，超时时会被误判停滞）；其余读者按 `phase` 过滤或按 `invoke_id` 配对，不受影响。
11. 测试驱动的 `onOutOfChain` 只接 `design-repair-*` 的调用，且先于 `failExecutorFor` 生效；不传时链外调用照旧返回默认结果。

**放弃的准确性**

- 覆盖范围是整个工程顶层：调用期间别的 feature 的并发 run（或 agent 工具自己）写了工程里的文件，也会判成本次越界、违规停机（误报方向）；本 run 目录内的改动（如 manifest.json）不在核对范围。
- 发布前不重跑原失败的那道投影门（R2）：合法但没修好的蓝图会被发布并用掉本签名唯一一次机会（c7a 即此情形，事件与说明如实披露）。
- 发布前复核 canonical 基线字节、多持的锁登记进 `releaseAllLocks` 与信号处理：没有测试、也没有变异（前者的窗口只在运行时自身处理的毫秒级区间，调用期间的改动已由草稿外核对覆盖；后者要真杀进程）。
- guardian 绑定失败且未证明消失时，只判本次尝试失败，没有改走 `agent_containment_unresolved` 停机。
- 评审投影 `component-blueprint.review.md` 发布后过期，只在事件 `review_projection_stale` 里披露，不重生成。
- 签名不含蓝图字节：同一检查同一原因码在蓝图改过之后再出现也不再派发（按 plan"发布后的新 B 状态签名相同的不再派发"）。
- 恢复成本指标低估：两次链外调用发生在本轮 `phase_verdict` 之前，采集器从 verdict 起计，每个派发过的任务少计 2 次调用与它们的耗时（已写进 `metrics_9c3d7e1a_t6.note`）。
- 假 adapter 不读提示词；真实 agent 的修复质量、是否守子契约只能在宿主层看到。

**未解决**

- 手册 `docs/operations/goal-mode-runbook.md` 现有一句把 `authority_cu_mapping_stale` 的修法写成"改指当前 CU"，与 K4 的核实结果相反；按约定留 t5 后半改。

**留给 t5 后半的文档要点**

- 手册与 MIGRATION：无人值守时 B1 由框架自动接手（预授权键、只限 B1、一次尝试、草稿与两次调用、发布前失败不发布、越界走违规停机且不还原、发布后不回滚、绑定失效时停放并由 supervisor / 重发起后继）；`authority_cu_mapping_stale` 的修法改为"删掉可省略的引用"；`readiness` 报忙以外新增"取不到两层锁、未派发、不消耗机会"的说明。
- OpenSpec：`app-component-blueprint` 增量（预授权的无人值守 B1 修复作为合法修订来源：旧质询整份作废后独立质询重跑、准入机器派生写回、修订依据在根 provenance、派生结论标 stale）；goal-runner 增量（派发点、四个前提、签名与 attempted 判重、链外调用计次与用途标识、越界走 `backtrack_target_absent`、发布后未恢复按新状态停机）；`framework-local-config` 增量（`design_repair.unattended_b1`）；`change-unit-continuous-progression` 补"取锁段可由无人值守修复以全部 CU 为范围调用、锁内调和消费实际取得的锁集合"。
- `skills/project/component-design/SKILL.md` 边界措辞（"不进 Goal Mode" → "设计阶段不启动 run；无人值守修复子契约见 reference"，原地替换、不加行）并链到 `skills/reference/design-repair-unattended.md`。
- P4 plan t5 的关闭记录（P4 §16）与总纲 §14；本 plan t5 的 status。

### 批三 t5 后半（t6 相关的文档与规范）— 2026-10-01

只改文档与规范，没有动任何 `.ts` / `.json`、测试与 schema（`specs/framework.local.schema.json` 是 t6 改的，未动）。写的是 t6 当前代码的行为；t6 的 codex 实现评审与本节并行，返修若改了行为需再对一遍（见文末清单）。P4 t5 关闭记录、总纲 §14、本 plan t5 的 status 不在本节范围，留调度者在 t6 评审通过后做。

**改动文件**

- `docs/operations/goal-mode-runbook.md`：「设计权威出问题时」B1 行改正 `authority_cu_mapping_stale` 的修法（删掉可省略的 `contracts.change_unit.change_unit_ref`、由投影按当前 CU 填入，不改指当前 CU），"谁来修"补无人值守预授权分支；B 类开头"第一次遇到就停"补例外；新增一节「无人值守时 B1 由框架自动接手（需预授权）」：开启方式与取值（只有布尔 true）、派发的五个条件（四个前提 + 该阶段内容重试未用完）、签名口径与跨 resume / 后继只试一次、七步流程（取锁不到不派发不消耗机会、attempted 先落盘、草稿位置、作废旧质询与 provenance 登记、独立质询、发布前复核基线、同锁调和与同一探针）、预算、五种结果与操作者动作的对照表、五条注意（两 run 竞争可能都停放需重发一次、核对范围与并发误报、评审投影过期、发布前不重跑原门、签名不含蓝图内容）。
- `MIGRATION.md`：3.1.0「阶段结论与退出码同源」（P4）节"设计权威本身有问题时"一条下新增一个子条目：默认关闭、开启方式、开启后的流程与边界、`authority_cu_mapping_stale` 修法。其余条目未动。
- `openspec/changes/check-disposition-single-verdict/specs/app-component-blueprint/spec.md`（新增该 capability 的增量）：ADDED「A pre-authorized unattended B1 repair is a legitimate revision source」，4 个场景。
- `openspec/changes/check-disposition-single-verdict/specs/goal-runner/spec.md`：设计 owner 那条 Requirement 的"其余情形首次即停"补一句例外；ADDED「An unattended B1 halt is repaired once by the framework under pre-authorization」（派发点、四个前提、签名与 attempted 判重、两层锁与竞争不消耗、链外调用计次与用途标识与墙钟、草稿外核对与违规出口、四种结果口径、事件），6 个场景。
- `openspec/changes/task-continuation-recovery-loop/specs/framework-local-config/spec.md`：ADDED「Unattended B1 design repair is pre-authorized in personal settings」，2 个场景。
- `openspec/changes/check-disposition-single-verdict/specs/change-unit-continuous-progression/spec.md`：MODIFIED 的调和 Requirement 补一段"取锁段与锁内调和可分开调用、取锁范围由调用方指定、锁内调和消费实际取得的锁集合、写集守卫照常"，加 1 个场景。
- `skills/project/component-design/SKILL.md`：第 121–122 行边界原地替换为"设计阶段不启动 run …；goal run 无人值守时框架派出的 B1 修复不走本 Skill，子契约见 design-repair-unattended.md"，行数仍 150。

**验证**

- `npm run openspec:validate`：52 passed / 0 failed；Enforcement 路径检查 PASS。
- `node scripts/check-plan-version.mjs`：PASS。
- `cd harness && npm run check:docs`：Verdict PASS、阻断 0；15 项中 1 项 MAJOR FAIL `doc_freshness`（同一批 13 份文档，按 git 提交时间算，属既有状态）。
- 行尾：本节动过的文件经 node 检查均无 CRLF，`git ls-files --eol` 复核为 `w/lf`。
- 未跑 harness 单测（本次不改代码）。

**偏离**

1. `app-component-blueprint` 增量放在 `check-disposition-single-verdict`，没有放进 `blueprint-backed-skill-design`：后者是 P3 投影的 change，proposal 写明"不实现 P4–P7 业务接线"；本 plan 其余增量（goal-runner、change-unit-continuous-progression）都在 `check-disposition-single-verdict`，放一起便于一次归档。
2. `framework-local-config` 的预授权键按任务书放进 `task-continuation-recovery-loop` 既有的同名增量（与 `approved_models` 同一种个人级授权，挨着写）；这使本 plan 的增量分在两个 change 里（批三 t5 前半已有先例）。
3. 两个 change 的 `proposal.md` 的 Capabilities 清单没有补 `app-component-blueprint` / `framework-local-config` / `change-unit-continuous-progression`（批一新增 CU 增量时也没补），validate 不要求；放弃的准确性：proposal 的能力清单比实际增量少。
4. SKILL.md 只改了 BLOCKER 边界那一处；frontmatter description 的 "Never enter … Goal Mode" 与第 16 行"不启动 Goal Mode"对本 Skill 仍然成立（无人值守修复不经本 Skill），没改。原文"不进入 Goal Mode 施工循环"改成"不进入施工循环"。
5. 手册把"该阶段内容重试次数还没用完"列为派发条件之一（代码在四个前提之前先判这一条）；plan §5.5 只写了四个前提。

**若 t6 返修改了行为，文档要跟着改的位置**

- 预授权取值（只有布尔 true、非对象丢弃）：手册新节开头、MIGRATION 子条目、framework-local-config 增量。
- 派发条件（owner 为进程、整体 B1、内容重试预算、签名口径与祖先回放）：手册"什么时候派发"、goal-runner 增量第一、二段与场景二、三。
- 取锁范围（全部 CU）与竞争不写 attempted：手册第 1 步与"注意"第 1 条、goal-runner 增量第三段与场景四、change-unit-continuous-progression 增量新段与场景。
- 草稿位置、只复制蓝图文件、provenance 的五个键：手册第 3、4 步，app-component-blueprint 增量。
- 自报判据（只看 admission 与 questioning；revision / provenance 被覆盖不判失败）：手册结果表、app-component-blueprint 增量第一条。
- 草稿外核对范围与排除项、调用前 / 后不可核实的不同出口、违规出口 `backtrack_target_absent` 与 `outside_design_repair_draft`：手册结果表与"注意"第 2 条、goal-runner 增量第五段与场景五。
- 发布后结果口径（绑定失效停放、未恢复按新状态重分类、不回滚、`review_projection_stale`）：手册结果表与"注意"第 3、4 条、MIGRATION 子条目、goal-runner 增量结果清单与场景六、app-component-blueprint 增量最后一条。
- 计次与用途标识（`design-repair-author` / `design-repair-questioning`、`chain_phase`、`purpose`、停滞判定跳过）：手册"预算"、goal-runner 增量第四段。
- `authority_cu_mapping_stale` 的修法：手册 B1 行、MIGRATION 子条目（与子契约、分类表同源）。

### 批三 t6 返修（codex 首轮）— 2026-10-01

codex 实现评审首轮暂不通过，4 项必修。逐条对过代码，四条都属实，全部修复；没有新增停机原因、状态、账本或锁协议。

**1（P1）本 run 目录整体豁免，漏掉判重与预算的输入**——属实：快照排除了整个 run 目录，`events.jsonl`、`manifest.json`、`run-control.json` 都不核，调用删掉本次 attempted 与调用起始事件后快照仍判干净。

- 修法（`design-repair-unattended.ts`、`phase-write-boundary.ts`）：快照函数改为两组前缀——`ownedPrefixes` = 本任务的蓝图工作区（canonical 蓝图、全部 CU、本 run 与祖先 run 的事件 / manifest / run-control），其下不套用通用的运行时目录排除；`runtimeExcluded` 只列调用期间运行时自己会写的路径：草稿目录、两次调用的日志目录、`progress.json` / `progress.md`、`liveness.json`、本 feature 锁。`events.jsonl` 单独核：调用前的字节一个不改，追加的每一行只能是心跳或本次调用自己（`phase` = 用途标识）的起止 / 收容事件；不成立即按越界处置，并把调用前有、现在缺的行原样补回文件末尾。**（确认轮更正：补到末尾会改变会话分段，且漏掉本次调用自己写的起始事件、不修补祖先 run 的事件；已改为工作区内全部事件文件按整文件期望值核对并写回，见「批三 t6 返修（codex 确认轮）」。）**
- 反例：新用例 `S16-r1`——质询调用删掉本次 attempted 与编写调用的起始事件、且不给结果 → 检出 `events.jsonl` 越界、走 `backtrack_target_absent`；attempted 与两次调用起始都已补回（确认轮改为整文件写回，用例同步改写）；`--supersede` 起的后继不再派发。`S16-c2` 扩充：本 run 的 `manifest.json`、祖先 run 的 `events.jsonl`、本 run 事件里追加一条伪造的阶段结论，都检出。`S16-r3`：编写调用进行中等过本 run 真实的 60 秒心跳（事件追加、beacon、进度、锁），修复照常发布并完成。

**2（P1）guardian 未证明消失被降成普通修复失败**——属实（`goal-phase-runtime.ts` 链外调用包装把 `stillAlive` 压成说明文字）。

- 修法：绑定失败且未证明消失时，与阶段调用同一处置——不落 `agent_invoke_end` / `settled`（留给恢复对账），返回 `containmentUnresolved`；编排抛出后不再核对、不发布、不启动下一次调用；决策梯新增一支走既有 `agent_containment_unresolved` 停机（`decide` 投影，不挂设计探针）。已证明消失时仍按普通尝试失败收口。
- 反例：`S16-r2`（真实子进程 + 只让对它的 taskkill 失败，身份与存活探测走真实系统调用）→ `agent_containment_unresolved`、无探针、未发布、没有质询调用、编写调用无 `invoke_end`；`S16-r2b`（真实子进程、命令行不含身份 token、taskkill 成功）→ 普通尝试失败、设计 owner 停机（带探针）、子进程已结束。

**3（P2）无关 run 的正常写入被判越界**——属实（给 `runtimeExcluded` 时整体替换了通用排除）。

- 修法：同第 1 项——蓝图工作区以外仍按通用规则排除别的 run 的运行时输出（`goal-runs` / `reports` / `context` 与阶段状态文件），工作区内照查。
- 反例：`S16-r3`——编写调用进行中另一 feature（demo-card）的 run 取锁刷新、追加心跳事件、写 beacon 与进度、刷新 `next.json` → 修复照常发布并完成；需求、契约、个人配置及工作区内的实际输入被改仍拒绝（`S16-c2`）。

**4（P2）取锁中途抛异常不放已取的锁**——属实（共享取锁段提取后的回归，批一的调和入口也受影响）。

- 修法（`change-unit-design-preparation.ts`）：取锁段在异常出口先放掉本次已取得的锁再抛原异常，借来的锁不放；只为取锁而新建的空目录在异常时也删掉。
- 反例：`S16-r4`——第二把 feature 锁注入一次 `EACCES` → 原异常抛出、自取的蓝图锁与 feature 锁全部释放、借来的锁仍在、同进程重试成功。

**其它**

- 子契约 `skills/reference/design-repair-unattended.md`：禁止项的措辞与实际行为对齐——改 `revision` / 根 `provenance` 会被框架覆盖、不作数；改准入、改质询结果、写草稿外文件（新增：本 run 的事件与 manifest）才使本次修复作废；改决定、扩范围框架不逐条比对，但通不过校验就不发布。
- 非阻断建议采纳一条：`S16-c8`——质询调用之后、发布之前另一写入者改了 canonical 蓝图 → 基线复核不等、不发布，canonical 保持别处写入的字节。"rename 后缺 published 事件"与"信号释放多持锁"没有补（前者要在 rename 与写事件之间杀进程，后者要真杀进程）。
- 对批三 t6 记录的更正：偏离 6 后半句改为"中断覆盖只是落盘顺序与恢复判重接线的证据，没有实测进程中断"；偏离 3 的核对范围以本节为准（不再是"全部顶层条目、只排除本 run 与本 feature 锁"）。

**改动文件**：`harness/scripts/utils/design-repair-unattended.ts`、`harness/scripts/utils/phase-write-boundary.ts`、`harness/scripts/utils/change-unit-design-preparation.ts`、`harness/scripts/goal-phase-runtime.ts`、`skills/reference/design-repair-unattended.md`、`harness/tests/unit/design-authority-repair.unit.test.ts`（新增 S16-r1 / r2 / r2b / r3 / r4 / c8，扩充 c2，假 adapter 可异步）、`harness/tests/unit/goal-runner-testing-integrity.unit.test.ts`（`onOutOfChain` 可异步、可报告子进程 pid）。

**验证**

- `npm run typecheck`（harness）与全量 `tsc --noEmit -p .` 通过。
- `design-authority-repair` 整套 41/0（原 35 条 + 本轮新增 6 条，分 12 块跑，每块不超过 10 分钟）。
- 直接相关套件：phase-write-boundary 9/0、adjudication 60/0、change-unit-progression 97/0、component-design-handoff 30/0、component-closure 45/0、check-disposition（含 consumers）30/0、goal-runner-testing-integrity 111/0。
- 反向变异 11 条全部转红并按原字节还原（还原后文件 sha256 与 `git diff` 整体哈希不变）：事件前缀不核（S16-r1 红）；追加行不核类型（S16-c2 红）；不补回缺行（S16-r1 红）；工作区不再豁免通用排除（S16-c2 红）；工作区外也不套通用排除（S16-r3 红）；本 run 的 beacon 不列入运行时写入（S16-r3 红）；运行时把未证明消失当普通失败（S16-r2 红）；决策梯去掉收容停机分支（S16-r2 红）；编排忽略收容未证明（S16-r2 红）；取锁异常不放锁（S16-r4 红）；去掉发布前基线复核（S16-c8 红）。
- 行尾：改动文件全部 `w/lf`。
- 未跑：全量、real-chain、lifecycle-evolution、金样、reliability-scenarios（本轮没有改动 S16 的流程函数与登记）。

**偏离**

1. 判重仍只认 `attempted`：曾考虑"任一阶段的同签名事件都算"作纵深防御，但测不出来（要让补回失败），没有保留。
2. `events.jsonl` 被删改时把缺的原行补回——这是运行时对自己事件文件的修补，不是还原工程文件；工程文件仍只检测、不还原。（确认轮已改为整文件期望值写回，补回到末尾不再使用。）
3. 进程收容的反例用真实子进程，`S16-r2` 只把对它的 taskkill 替换成失败（替身"结束不了的进程"），身份与存活探测是真实系统调用；只在 Windows 上跑（收容只在 Windows 启用），其它平台跳过并打印说明。

**放弃的准确性**

- 追加行只按类型与用途标识核：调用追加一条形状合法的心跳或本次调用的起止事件不会被判越界（预算方向只会多算）。
- 工作区以外别的 feature 的 run 写产品源码仍会判越界（误报方向，同批三 t6 记录）。

### 批三 t5 后半：按 t6 返修对齐 — 2026-10-01

按上节四项返修逐处对照代码（`design-repair-unattended.ts`、`goal-phase-runtime.ts`、`change-unit-design-preparation.ts`）与子契约改文字，只改文档与规范。

**改动**

- `docs/operations/goal-mode-runbook.md`「无人值守时 B1 由框架自动接手」：第 1 步补"取锁中途出错时放掉本次已取的锁，借来的不动"；第 4 步补"编写调用改 `revision` / 根 `provenance` 直接被覆盖、不算失败"；结果表越界一行补"含本 run 与祖先 run 的事件、manifest、run-control"与 `events.jsonl` 缺行补回（工程文件仍只检测不还原）；结果表新增一行"子进程没能证明已结束 → `agent_containment_unresolved`、不挂设计探针、不发布、不启动下一次调用；证明已结束只算普通发布前失败"；"注意"第 2 条按新核对范围重写（工作区全查、只排除调用期间运行时自己写的五类路径、`events.jsonl` 只许追加心跳或本次调用事件、工作区外别的 run 的运行时输出照常排除、产品源码等仍可能误报）。
- `MIGRATION.md` P4 子条目：越界范围补工作区内的运行记录与 `events.jsonl` 补回；补收容未证明的停机口径。
- `openspec/changes/check-disposition-single-verdict/specs/goal-runner/spec.md`：草稿外核对一段按新范围与 `events.jsonl` 规则重写；新增收容未证明一段与取锁异常放锁一句；结果清单"发布前失败"限定为"其它"；场景"写出草稿外"补 manifest、祖先事件、伪造阶段结论；新增 3 个场景（事件被删检出并补回、正常运行时写入不算越界、收容未证明停机）。
- `openspec/changes/check-disposition-single-verdict/specs/app-component-blueprint/spec.md`：第一条补"revision / 根 provenance 由运行时覆盖不导致失败；改决策、扩范围不逐条比对但通不过校验即不发布"（与子契约同口径）；越界一条补"含本 run 的事件与 manifest"并指向 goal-runner 的核对范围。
- `openspec/changes/check-disposition-single-verdict/specs/change-unit-continuous-progression/spec.md`：取锁段补"中途抛异常先放自取的锁再抛原异常"。
- `framework-local-config` 增量、`component-design/SKILL.md` 不受返修影响，未动。

**验证**：`npm run openspec:validate` 52 passed / 0 failed、Enforcement 路径 PASS；`node scripts/check-plan-version.mjs` PASS；`cd harness && npm run check:docs` Verdict PASS、阻断 0（`doc_freshness` 同前，既有）；行尾复核全部 `w/lf`。

**偏离**

- 收容未证明时给操作者的动作写成"按停机说明确认残留的 agent 进程已结束，再重发同一请求"——运行时的停机说明只写"旧 agent 仍可能在野，halt 阻断续跑"，没有明确的下一步；本句是按既有收容停机的含义概括的，恢复对账的细节没有展开。
- "工作区"在手册里按代码写成"本蓝图的工作区（canonical 蓝图、全部 CU、本 run 与祖先 run 的运行记录）"；代码的前缀是整个蓝图工作区目录，同蓝图下兄弟 CU 的 run 记录也在其中（修复期间它们的 feature 锁都由本 run 持有），手册没有单独点出。

### 批三 t5 后半返修（codex 首轮，第一步）— 2026-10-01

codex 对 t5 后半文档暂不通过，4 项 P2（原文 `codex-9c3d7e1a-t5b-r1.out`）。按调度分两步：第 1 项（核对范围与事件恢复规则）、第 2 项（"无法核对"不保证有 `phase_write_violation`）对应的段落等 t6 第二轮返修落地后按最终代码一次改，本步没有动这些段落。本步做第 3、4 项与三条非阻断建议，先对照代码确认属实。

**第 3 项（属实）**：`design-repair-unattended.ts` 写回根 `provenance` 时先展开作者的对象，只覆盖 `source_kind`、`source_ref`、`source_revision`、`observed_at`、`extraction_method` 五个字段；`evidence_strength` 等其余字段保留，并受 `blueprint-provenance.ts` 校验（缺失或不在四个合法值内即 BLOCKER）。改：手册第 4 步与 `app-component-blueprint` 增量第一条改为"`revision` 与这五个字段被覆盖，其余字段保留并照常校验"，删掉"整段 provenance 改了不作数、不导致失败"；增量里登记字段补上 `observed_at`，凑齐五个。子契约 `skills/reference/design-repair-unattended.md` 第 15 行（"你写的值会被框架直接覆盖，不作数"，对象是 `revision` 与整段根 `provenance`）有同样的问题，归 t6 实施者，未改。

**第 4 项（属实）**：锁内调和仍可能跳过本 CU；即使升版成功，t6 还要探针就绪、冻结绑定有效才原地重评（`goal-phase-runtime.ts` 派发分支）。改 `change-unit-continuous-progression` 增量：运行中升版那段的"原地重评"限定为 A 类指针调和，并写明无人值守 B1 修复发布后的调和按 `goal-runner` 的结果规则判；新场景改为"锁内调和照常执行、保留既有跳过条件，之后 run 怎么走由 goal-runner 判"。

**非阻断建议（三条全采纳）**

- 手册结果表收容一行：写明是本手册的建议（停机说明里没有下一步），重发仍走既有恢复入口与未收尾调用的对账。
- 手册结果表绑定失效一行：引用前文 supervisor 的条件（owner 是进程、没有进行中的交接、同一任务自动拉起未满 3 次），只有实际拉起后继并完成才算操作者没有动作。
- `check-disposition-single-verdict/proposal.md` 的 Modified Capabilities 补齐：`goal-runner` 补本 plan 两项、新增 `change-unit-continuous-progression`（两条 MODIFIED）与 `app-component-blueprint`。对「批三 t5 后半」偏离 3 的更正：`task-continuation-recovery-loop` 的 proposal 在 Impact 的规范清单里已列 `framework-local-config`，不是漏列；漏列的只有 `check-disposition-single-verdict` 的 proposal，本步已补。

**改动文件**：`docs/operations/goal-mode-runbook.md`、`openspec/changes/check-disposition-single-verdict/specs/app-component-blueprint/spec.md`、`openspec/changes/check-disposition-single-verdict/specs/change-unit-continuous-progression/spec.md`、`openspec/changes/check-disposition-single-verdict/proposal.md`。

**验证**：`npm run openspec:validate` 52 passed / 0 failed、Enforcement 路径 PASS；`node scripts/check-plan-version.mjs` PASS；`cd harness && npm run check:docs` Verdict PASS、阻断 0（`doc_freshness` 同前 13 份，既有）；行尾复核全部 `w/lf`。

**另记（未改，超出本步范围）**：批一写的 `change-unit-continuous-progression` 增量里，两条 MODIFIED（「Reconciliation re-resolves stable targets…」「Design preparation accepts an admitted blueprint with zero change units」）都没有带上主规范该条末尾的 `> **Enforced by (P2 implementation):** …` 一行；归档时按 MODIFIED 整条替换，会把这两行丢掉。

### 批三 t6 返修（codex 确认轮）— 2026-10-01

codex 确认轮：原第 2、4 项关闭；第 1 项未闭环（A、B），第 3 项消除误报但引入漏查（C）。三条对过代码都属实，按调度者裁定的方向修（不再在"补回到末尾"上打补丁）。

**A（P1）本次调用删掉自己的起始事件不报**——属实：调用前的事件字节在 `invoke()` 之前读，本次 `agent_invoke_start` 在 `invoke()` 里才写；只删它时前缀完整、剩下的 `agent_invoke_end` 又属允许追加的类型。
**B（P1）补到末尾改变会话归属、祖先事件不修补**——属实：权威读取按 `run_start` 的文件下标分段，删掉 `run_start` 再补到末尾，前面的 attempted 与调用起止落到首段之前被滤掉；祖先 run 的事件只有哈希检测。

- 修法（A、B 一并）：整文件期望值重建。
  - 运行时唯一的事件发射口 `appendEvent`（`goal-phase-runtime.ts`）加一个录制挂钩：调用期间运行时写出的每一行（文件、原样字节）都记下，不按事件类型猜。
  - 编排（`design-repair-unattended.ts`）在调用前记下蓝图工作区里全部 run 事件文件（本 run、祖先 run、兄弟 CU 的 run）的完整字节；调用后期望值 = 调用前字节 + 运行时本次写到该文件的行（原顺序），没有写入的文件期望值 = 调用前字节。实际不等于期望 → 记一条变化（走既有违规出口），并把该文件整文件写回期望值。这是运行时自己的记录文件，不是工程文件；工程文件仍只检测不还原。
  - 删掉上一轮的"只追加核对 + 缺行补到末尾"（`checkEventsAppendOnly`）。事件文件不再进快照，由期望值核对单独负责。
- 反例（验收直接看生产 reducer：`loadAuthoritativeEvents` + `foldBudgetLineage` + `resolveResumedBudget` 与 `designRepairAttempted`，resume 与后继两条回放）：
  - `S16-r1a`：编写调用只删本次写出的起始事件 → 检出（只报事件文件）、走 `backtrack_target_absent`；写回后 resume 与后继的回放都判 attempted 已有，调用计数都是 2（spec + 编写）。
  - `S16-r1`（改写）：质询调用删掉 `run_start`、attempted、编写与本次调用的起始，并删掉祖先 run 的一条调用起始 → 两份事件文件都检出；祖先 run 写回后与删改前逐字节相同，本 run 以删改前字节为前缀；resume 与后继回放 attempted 都在、调用计数都是 3；实际 `--supersede` 起的后继不派发。

**C（P2）工作区外被本任务引用的输入漏查**——属实：蓝图的契约 / 需求来源允许指向 `context/`、`reports/` 等项目内路径并实际读取，而这些目录在工作区外按通用规则整段不核。

- 修法：实际引用输入优先于目录名排除。
  - 把投影里既有的 `source_ref` 收集（原 `deriveBlueprintSkillInput` 内的 `collectSources`）提成导出函数 `blueprintSourceRefFiles`（`blueprint-skill-projection.ts`），投影依赖与修复保护集合共用，没有另写解析器。
  - 快照函数加 `includeFiles`（`phase-write-boundary.ts`）：列出的文件即使所在目录按通用规则不遍历也逐个核；无关 run 的运行时输出照旧排除。
  - 编写调用核基线蓝图的引用；质询调用核基线与草稿引用的并集。编写调用新引用了调用前没核到的文件（位于通常排除目录）→ 调用期间是否被改无从核实，不当作干净继续，走违规出口。
- 反例：`S16-c2` 扩充——蓝图的契约来源改指 `context/ledger-api.yaml`（与原契约文件同内容，校验照常通过），编写调用只改它的注释 → 检出；`S16-r5`（新）——编写调用把一个来源改指 `context/` 下调用前没核到的文件并改它 → 不发布、走违规出口。`S16-r3`（另一 feature 的 run 正常心跳）照常通过。

**其它**

- 子契约 `skills/reference/design-repair-unattended.md`：根 provenance 的说法改准——`revision` 与 `source_kind` / `source_ref` / `source_revision` / `observed_at` / `extraction_method` 五个字段由框架覆盖，其余字段（如 `evidence_strength`）保留并照常校验、改坏则不发布；越界写入一条补"蓝图 `source_ref` 引用的任何文件（即使在 `context/`、`reports/` 下）"与"本 run 与历史 run 的事件"，并写明事件文件由框架写回、工程文件不还原。
- 上一节（批三 t6 返修 codex 首轮）里"缺行补回到末尾"的三处说法已加更正注记。

**改动文件**：`harness/scripts/goal-phase-runtime.ts`、`harness/scripts/utils/design-repair-unattended.ts`、`harness/scripts/utils/phase-write-boundary.ts`、`harness/scripts/utils/blueprint-skill-projection.ts`、`skills/reference/design-repair-unattended.md`、`harness/tests/unit/design-authority-repair.unit.test.ts`（新增 S16-r1a、S16-r5，改写 S16-r1，扩充 S16-c2，新增回放辅助 `replayedBudget`）。

**验证**

- `npm run typecheck`（harness）与全量 `tsc --noEmit -p .` 通过。
- `design-authority-repair` 整套 43/0（分 12 块跑）。
- 直接相关套件：blueprint-skill-projection 23/0、phase-write-boundary 9/0、goal-runner-testing-integrity 111/0。
- 反向变异 8 条全部转红并按原字节还原：期望值不含运行时本次写出的行（主线红）；不写回（S16-r1 红）；不核事件文件（S16-r1a 红）；只核本 run 的事件文件（S16-r1 红：祖先未写回）；发射口不录制（主线红）；快照忽略 `includeFiles`（S16-c2 红）；编排不传引用文件（S16-c2 红）；不查新引用（S16-r5 红）。
- 行尾：改动文件全部 `w/lf`。
- 未跑：全量、real-chain、lifecycle-evolution、金样、reliability-scenarios。

**偏离**

1. 编写调用新引用调用前没核到的文件时按"无从核实"走违规出口（与快照不可验证同一处置），而不是放过；代价是合法地新引用一个位于 `context/` 等目录、且没被改的文件也会被拒（误报方向）。
2. 收容未证明消失（原第 2 项，已关闭）时不做事件期望值核对——子进程可能仍在写，核对没有意义；那条路径直接走 `agent_containment_unresolved`。

**放弃的准确性**

- 引用集合只认蓝图里的 `source_ref`；按配置读取的固定文件（术语表、模块目录、conventions）不在引用集合里，它们若位于通常排除的目录仍不核（目前都在 `doc/` 下，照常被核）。
- 事件期望值只覆盖调用开始时蓝图工作区里已有的事件文件；调用中新建的事件文件按工作区照查的快照规则报"新增"。

### 批三 t5 后半返修（codex 首轮，第二步）— 2026-10-01

t6 确认轮返修落地后，按最终代码改 codex 首轮第 1、2 项（核对范围与事件恢复规则；"核对不了"不保证有 `phase_write_violation`）。逐条对过 `design-repair-unattended.ts`（`workspaceEventFiles`、`restoreEventFiles`、`guarded` 与新引用检查）、`goal-phase-runtime.ts` 违规分支（`violationFacts` 非空才发 `phase_write_violation`）与收容分支、`phase-write-boundary.ts` 的 `includeFiles`、`blueprint-skill-projection.ts` 的 `blueprintSourceRefFiles`。上一版"只许追加心跳 / 本次调用事件、缺行补回"的说法已在全部文档与规范里清掉（全文检索确认）。

**改动**

- `docs/operations/goal-mode-runbook.md` 结果表：原"改了草稿之外的文件或无法核对"一行拆成两行——"检出具体改动"（有带路径与哈希的 `phase_write_violation`；工程文件只检测不还原；工作区里各 run 的事件文件整份写回"调用前字节 + 框架本次写入的行"）与"核对不了"（调用后快照不可验证、编写调用新引用了调用前没核对的文件；同样 `backtrack_target_absent`，不一定有违规事件与路径清单，以失败原因和停机事件为准；合法新引用也会被拒）；收容一行补"不做草稿外核对与事件文件核对"。"注意"第 2 条重写为三块：蓝图工作区（含本 run、祖先 run、兄弟 CU 的 run 记录）全查及排除项；事件文件按期望值核对、任何差异整份写回；被引用输入逐个核（编写核基线引用，质询核基线与草稿引用的并集）；工作区外别的 run 的运行时输出照常排除。
- `MIGRATION.md` P4 子条目：越界范围补被引用输入与工作区各 run 的运行记录；补"无从核实"两种情形；事件文件改为整份写回；写明只有检出具体改动才有带路径与哈希的违规事件；收容一句补"不做核对"。
- `openspec/changes/check-disposition-single-verdict/specs/goal-runner/spec.md`：原第五段拆成三段（核对范围含被引用输入；事件文件期望值与整文件写回；违规的三种来源与"只有检出具体改动才发 `phase_write_violation`"）；收容段补"快照与事件文件都不核"；场景"写出草稿外"去掉"快照不可验证"、补 `context/` 下被引用文件；新增场景"无从核实也是违规、不承诺路径清单"；"事件被删后补回"改为"整文件写回"（删 `run_start`、attempted、本次起始与祖先一行，两份文件都写回，resume 与后继回放都找得到 attempted）；收容场景补"不做核对"；Enforcement 补 `blueprint-skill-projection.ts`。
- `openspec/changes/check-disposition-single-verdict/specs/app-component-blueprint/spec.md` 越界一条：补被引用文件与工作区各 run 的运行记录、补"无从核实"，事件文件整文件写回指向 goal-runner。

**验证**：`npm run openspec:validate` 52 passed / 0 failed、Enforcement 路径 PASS；`node scripts/check-plan-version.mjs` PASS；`cd harness && npm run check:docs` Verdict PASS、阻断 0（`doc_freshness` 同前 13 份，既有）；行尾复核全部 `w/lf`。

**偏离 / 放弃的准确性**

- 子契约第 18 行写"被改的运行记录（事件文件）由框架写回调用前的样子"，而代码写回的是"调用前字节 + 框架本次写入的行"；手册写的是后者。子契约归 t6 实施者，未改。
- 手册没有列出调用中新建事件文件的处理（按工作区快照报"新增"），也没有列"按配置读取的固定文件不在引用集合"这条放弃的准确性；两者都只在 t6 记录里。

### 批三 t6 返修（codex 第三轮）— 2026-10-01

codex 第三轮：确认轮的整文件期望值写回引入回归——修复调用期间，同蓝图兄弟 CU 的 supervisor 对它的 run 做检查或重启，经 `goal-supervise.ts` 的 `appendSupervisorEvent` 直接追加该 run 的 `events.jsonl`（`supervisor_observation` / `supervisor_restart` / `supervisor_restart_spawned`），不经 `appendEvent` 录制挂钩，也不取修复持有的 feature 锁；修复把这些合法追加判成越界、按调用前字节写回（重启记账丢失、修复作废）。对过代码属实。按调度者裁定修：supervisor 对某个 run 写事件 / 拉起与该 run 所属 feature 的既有 feature 锁互斥。

**修法**（`harness/scripts/goal-supervise.ts`，只用既有锁原语 `tryAcquireLock` / `releaseLock`，不新增锁实现、不新增停机原因）

- supervisor 里直接写 `events.jsonl` 的点共五处（`supervisor_observation` 三处、`supervisor_restart`、`supervisor_restart_spawned`），全部只经 `appendSupervisorEvent`。
- 写事件与决定拉起都在锁内：属主门（run-control）通过后先锁外判一次只为拿退避值、睡退避（最长 10 分钟，持锁睡会挡住人工 resume 与同蓝图修复）；然后取该 feature 的 `.feature.lock`（与修复、runner 同一把锁，同一路径 `goal-runs/.feature.lock`）。取不到 = 有人持有（run 在跑，或同蓝图的设计修复正持锁）→ 本轮 no_op，不写、不拉起。取到后在锁内重读事件重判；观察事件与 `supervisor_restart` 都在锁内写；放锁后再 spawn（子进程自己取锁）；`finally` 幂等放锁（锁已放或已被子进程取走时 ownerId 不同，不动）。锁记录不带 `run_id`（与修复取锁一致），supervisor 崩在锁内时下一个取锁者按既有 stale 规则接管、不会被孤儿检测当成某个 run 的残留。
- 锁内重判若要求退避而重启序号与锁外那次不同（睡的期间另一轮 supervisor 已拉起过）→ 本轮 no_op，让给下一轮（不补睡、不持锁睡）。
- 删掉 `supervisor_restart_spawned`：它在 spawn 之后、锁外写，纳入互斥就得持锁 spawn，与"放锁后再 spawn"冲突；生产无消费方，子进程 pid 由 runner 自己的 beacon 与事件记录，控制台日志仍打印 pid。

**supervisor 新增的 no_op 条件（文档侧需补）**：①该 feature 的锁被持有（run 在跑或同蓝图的设计修复进行中）；②退避期间重启序号已变。另：拉起后不再落 `supervisor_restart_spawned`。

**测试**

- `design-authority-repair` 新增 `S16-r6`：兄弟 CU 先 fresh 出生、无预授权 → 真实门报 B1 停放；之后预授权、本 CU 后继出生派发修复；编写调用进行中以生产 CLI（`__testing_main`）跑一轮 supervisor 处理兄弟 CU 的停放 run（探针注入就绪，代表与蓝图无关的等待条件）→ 修复持有兄弟 CU 的 feature 锁，supervisor 本轮 no_op、兄弟 run 事件逐字节不变、不拉起；修复发布 recovered、无 `phase_write_violation`、本 run 完成；修复结束后下一轮实际拉起 `--resume <兄弟 run> --force-resume --detach`，兄弟 run 的 `supervisor_restart` 序号为 `[1]`。
- `goal-supervisor` 新增一例：同一停放 run 上，测试进程持 feature 锁时 supervisor 不写、不拉起；放锁后第 1 次拉起，spawn 时锁已放、之后不留锁；第 2 次需退避 30s，睡的期间另一轮记下第 2 次重启 → 锁内重判序号已变 → 不拉起、不重复记账（序号 `[1,2]`）。该套件的 `superviseOnce` 辅助顺带记录 spawn 时锁文件是否存在。
- `supervisor-kill-recovery`：真拉起用例原先用 `supervisor_restart_spawned` 取子进程 pid 并断言它晚于 `supervisor_restart`；改为取被拉起进程自己写的 `stub_runner_started`（同一 pid），断言"意图事件早于被拉起进程的事件"，并断言不再出现 `supervisor_restart_spawned`。

**改动文件**：`harness/scripts/goal-supervise.ts`、`harness/tests/unit/design-authority-repair.unit.test.ts`、`harness/tests/unit/goal-supervisor.unit.test.ts`、`harness/tests/unit/supervisor-kill-recovery.unit.test.ts`。

**验证**

- `npm run typecheck`（harness）与 `tsc --noEmit -p .` 通过。
- 目标用例与直接相关套件：`design-authority-repair` 的 S16-r6 1/0、S16 主线 1/0、S15-supervisor 1/0、S16-stale-supervisor 1/0；`goal-supervisor` 30/0；`supervisor-kill-recovery` 4/0；`goal-park-resume` 3/0；`agent-containment`（经 `__testing_main` 走受控 force 行为面）21/0；`reliability-scenarios` 只跑 S9（生产 supervisor 经 driver 唤醒设备停放）7/0。
- 反向变异 4 条全部转红并按原字节还原（含 git diff 整体哈希核对）：supervisor 不取锁 → S16-r6 红，失败形态正是 codex 所述（supervisor 写了兄弟 run 的 `supervisor_restart`，修复判"编写调用改了草稿之外的文件：…/events.jsonl"、不发布）；同一变异在 goal-supervisor 新例红（锁被持有时仍拉起）；去掉锁内序号复核 → 新例红（退避期间序号已变仍拉起）；放锁前 spawn → 新例红（spawn 时锁仍在）。
- 行尾：4 个改动文件全部 LF。
- 未跑：全量、real-chain、lifecycle-evolution、金样、reliability-scenarios 其余场景、design-authority-repair 其余用例（本轮只改 supervisor，修复编排未动）。

**偏离 / 放弃的准确性**

1. 锁外判一次、锁内再判一次：条件探针每轮最多跑两次（原来一次）。放弃的是每轮的探针开销。
2. 退避在锁外睡：睡完锁内重判若序号对不上就让给下一轮（多等一个计划任务周期），而不是在锁内补睡。
3. `supervisor_restart_spawned` 删除：事件流里不再有"supervisor 拉起的子进程 pid"这一条；要查 pid 看 runner 自己的 beacon / 事件或 supervisor 控制台日志。
4. `S16-r6` 两轮 supervisor 的探针都是注入的"就绪"：真实探针在修复进行中必然未就绪（蓝图还坏着），本就不会写事件；需要覆盖的正是兄弟 run 等的是与蓝图无关的条件、此刻就绪的情形。修复之后兄弟 run 自己的验收（夹具从本 CU 抄来）与新蓝图对不上，真实探针仍报 `authority_predicate_acceptance_unmapped`，所以第二轮沿用同一注入前提。

### 批三 t5 后半：最后补充 — 2026-10-01

t5 后半文档 codex 确认轮通过（四项关闭、无新增阻断）后补两处。

- 手册「无人值守时 B1 由框架自动接手」注意第 2 条：事件文件一块限定为调用开始时已有的事件文件（整份写回）；调用中新建的事件文件按工作区快照报新增、不自动还原（与 goal-runner 增量的限定对齐）。固定配置文件不在引用集合那点按 codex 判断不写。
- t6 第三轮 supervisor 互斥（goal-supervise.ts）：手册「supervisor 的适用范围」新增一条"本轮暂不拉起、下一轮再看"：feature 锁被别人持有（run 在跑或同蓝图设计修复进行中）、退避期间重启序号已变时本轮让出；写事件与决定拉起都在锁内、拉起前放锁。task-continuation-recovery-loop 的 goal-runner 增量里 supervisor 那条 Requirement 同步一句。MIGRATION 没有 supervisor 的不拉起清单，未改。supervisor_restart_spawned 在 docs、openspec、skills、specs、MIGRATION 中都没有出现，无需改。

**改动文件**：docs/operations/goal-mode-runbook.md、openspec/changes/task-continuation-recovery-loop/specs/goal-runner/spec.md。

**验证**：npm run openspec:validate 52 passed / 0 failed、Enforcement 路径 PASS；node scripts/check-plan-version.mjs PASS；cd harness && npm run check:docs Verdict PASS、阻断 0（doc_freshness 同前 13 份，既有）；行尾全部 w/lf。

### 批三评审结论（codex）— 2026-10-01

- **t6 实现**：四轮。首轮暂不通过（4 项：本 run 目录整体豁免、收容未证明消失降为普通失败、无关 run 写入误报、取锁异常不放锁）；确认轮关闭 2、4，余下三项（本次调用起始事件可删、缺行补到末尾改变会话归属与祖先不修补、工作区外被引用输入漏查）由调度者裁定改为"整文件期望值重建 + 被引用输入优先于目录排除"；第三轮 A/B/C 关闭，新增 1 项 P1 直接回归（supervisor 直接写事件被整文件写回覆盖）；第四轮**通过**，无新增阻断。偏离与放弃全部被接受。非阻断建议一条照录：S16-r6 的"实际拉起"应读作"进入生产 spawn 分支并核对参数"（spawn 由替身记录，真实子进程启动由 supervisor-kill-recovery 覆盖）。
- **t5 后半（t6 相关文档与规范）**：首轮暂不通过（4 项 P2 文档契约）；分两步返修后确认轮**通过**；最后两句补充（事件文件只写回调用开始时已有的、supervisor 新增两条不拉起条件）已落。
- **t5 前半**此前两轮通过（见上）。t5、t6 至此标 completed；收口全量见下一节。

### 收口全量（2026-10-01）

在主工作区对最终代码跑一次（快照为无引用提交 `9ac7fc6b`，树 `57886a79`；跑完后工作区树哈希不变，测试未留残留）：

| 项 | 结果 |
|---|---|
| typecheck | 通过 |
| unit 全量（含 consumer-golden 金样） | 5025/0 |
| fixtures | 46/0 |
| design-authority-repair | 44/0 |
| real-chain（含 real-chain-seams） | 14/0 |
| lifecycle-evolution | 14/0 |
| reliability-scenarios | 44/0 |
| openspec:validate | 52/0 |
| check-plan-version | PASS |

场景结论：S4 两支保持原期望（对齐支 correct_completion；反例支 HALTED/no_progress_guard、未宣称完成）；S14 三支、S15 五支、S16 各支均达成登记的期望。
同日此前的提前全量（批二通过时的快照）只证明那一刻的代码，16 个失败经核实全部是隔离工作树的环境问题（依赖目录用链接、缺本地未跟踪的 harness/framework），在主工作区重跑全过；本节的全量才是最终代码的收口依据。

验收结论：A1–A4、B1–B4、D1–D5 成立（A2、B2、D1 均由真实入口与真实生产者证明）。按 §7 的唯一口径，P4（plan f7045213）的 t5 关闭，记录写在 P4 §16；总纲 §14 同步记录。

### t6 重新打开（2026-10-02）

用户转来 codex 一项 P1（真实授权边界）：编写调用之后只比对了准入与质询两个字段，草稿里与本次 B1 修复无关的决策与授权写集（例如另一处 `contracts.files`）被扩大后照样通过通用校验并发布，扩大的写集进入 canonical 且不回滚。调度者核实属实（`design-repair-unattended.ts` 编写调用之后只有 admission / questioning 两项与基线比对）。绑定失效正例也是靠"修验收时新增施工文件"触发的，没有守住这条边界。
t6 与依赖它的 t5 改回 in_progress；上节"收口全量"不再是最终代码的依据，修复后重跑。

### 批三 t6 返修（codex 第五轮：授权边界）— 2026-10-02

codex P1（真实授权边界），调度者核实属实：编写调用之后只把 `review_summary.admission` / `questioning` 与基线比对，随后靠通用蓝图校验发布。替身编写者在修验收格式（`authority_content_not_machine_structure`）的同时给 `contracts.files` 加 `LedgerSourceSeam.ts`，准入 pass、发布、调和、recovered，扩大的写集进了 canonical。原"绑定失效"正例（`s16StaleFlow`）也靠"修验收时新增施工文件"触发，没守住这条边界。按调度者裁定修（不建通用语义 diff）。

**修法**

- B1 发现项带位置（`blueprint-skill-projection.ts`）：投影抛错点给出 `DesignAuthorityLocation`（`blueprint_id`、design_ref 目标的 `kind` / `view_id` / `id`、目标下的字段点分路径），经既有结构化原因通道一路带出——`deriveBlueprintSkillInput` 的 invalid 结果 `locations` → `authoritativeContentDrift` → `checkAuthoritativeContentAligned` 的 `structured.locations` → `diagnoseDesignAuthority` 的 `DesignAuthorityFinding.locations` → 停机简报（`designRepairBrief` 原样带上，停机事件的 `design_authority.items` 随之多出 `locations`）。不解析文本。
  - `authority_content_not_machine_structure`：本 CU 所选 design_ref 目标里 `acceptance` / `contracts` / `use_cases` 三个字段中所有写成文字的位置（见偏离 1）。
  - `authority_cu_mapping_stale`：本 CU 所选目标里带 `contracts.change_unit.change_unit_ref` 的位置，字段 `contracts.change_unit.change_unit_ref`。
- 编写调用之后的授权边界（`design-repair-unattended.ts` 的 `outOfScopePaths`）：在自报检查（准入、质询，保留）之后，把草稿副本里允许不同的位置还原成基线值——本次发现项定位到的字段子树（映射过期只在草稿删掉了那条引用时还原，改成别的值不算）、运行时随后覆盖的 `revision`、根 `provenance` 五个登记键、`derived_results`——再与基线整份按同一 canonical 序列化口径比；剩下的差异逐个列成点分路径。非空 → 尝试失败（`failed_step: author_scope`）、丢弃草稿、不发布，按"其它发布前失败"收口（canonical 未变、设计 owner 停机，不走越界违规出口），失败事件的 `reason` 写明越权路径。
- 质询调用之后只允许质询结果变化：既有约束（`strip` 后整份比对），确认未动。
- 编写提示词每条简报写明"只许改的位置"；子契约 `skills/reference/design-repair-unattended.md` 补"只改简报定位到的位置、别处有差异即作废"，并把"内容问题不逐条比对"改为"被允许的字段内部内容是否忠于原文不做机器比对，由独立质询把关"。

**测试**（`design-authority-repair.unit.test.ts`）

- 新增 `S16-r7`（codex 复现）：编写方按原意修好验收结构，同时给同一节点 `contracts.files` 加 `LedgerSourceSeam.ts` → `author_scope` 失败、不发布、canonical 字节与出生前相同、无 `phase_write_violation`、停在设计 owner 出口、不派质询；失败原因只列 `design_views[0].nodes[0].contracts.files`（不含被授权的验收）；编写提示词含"只许改的位置：node:…ledger-domain.acceptance"。
- `B4-codes` 扩充：真实投影给出的位置（文字 → `acceptance`；映射过期 → `contracts.change_unit.change_unit_ref`，目标与 CU 的 design_ref 目标一致）；`outOfScopePaths` 对映射过期：删掉引用在授权内，改指别的值越权，删掉同时扩写集越权。
- 绑定失效正例改写（`s16StaleFlow`，reliability-scenarios 的 S16 两支直接复用它）：同一节点的验收与施工契约都写成文字，施工契约原文写明授权写集另含 `LedgerSourceSeam.ts`；编写方按原文把两处改回机器结构，施工契约因此与旧绑定内容不同 → 发布 recovered、绑定失效停放、supervisor / 重发起后继完成，不靠扩大写集。`registry.json` 的 S16 `coverage_note` 与 supervisor 支 `premise` 同步改述。
- 受授权边界影响的两例改造：
  - `S16-c3d`（准入派生不过）：原来靠编写调用改 `source_fingerprint`，现在那属越权、在边界就被拒（`S16-r7` 同类）；改由质询结果缺必答范围触发，仍走 `validation`、`admission_after_questioning=blocker`。
  - `S16-c7b`（发布后调和未完成）：原来靠编写调用改 `knowledge_state` 让调和器跳过本 CU，现在那属越权；授权内的改动改不出这种蓝图，改为在质询调用期间把锁内调和换成"跳过本 CU"的替身（只此一次），发布后分支的处置断言不变。

**验证**

- `npm run typecheck`（harness）与 `tsc --noEmit -p .` 通过。
- `design-authority-repair` 整套 45/0（13 块，含新增 S16-r6、S16-r7）。首轮 A1 一例因 `structured` 多出 `locations` 红（直接回归，断言改为带位置），复跑该块 10/0。
- 直接相关套件：blueprint-skill-projection 23/0、check-disposition-consumers 19/0、successor-exit 24/0、component-design-handoff 30/0；reliability-scenarios 只跑 S16：9/0（S16 四支：主线、无预授权、绑定失效 supervisor 支、重发支）。
- 反向变异 4 条全部转红并按原字节还原（含 git diff 整体哈希核对）：放宽比对（编写之后不核授权边界）→ S16-r7 红（扩大的写集被发布）；投影不给文字位置 → S16 主线与 B4-codes 红（合法修复被拒）；映射过期允许任意改写 → B4-codes 红；文字位置只取抛错字段 → S16-stale-resend 红（施工契约文字改不了）。
- 行尾：5 个改动文件全部 LF。
- 未跑：全量、real-chain、lifecycle-evolution、金样、reliability-scenarios 其余场景。

**偏离 / 放弃的准确性**

1. 文字位置不只取抛错的那个字段：`authority_content_not_machine_structure` 的位置覆盖本 CU 所选目标里三个机器内容字段中所有写成文字的。理由：同一类缺陷、同一原文依据；spec 的投影只合并验收，若只定位抛错字段，同一节点写成文字的施工契约要等 plan 再停一次、再派一次修复。放弃的准确性：spec 停机的这次修复也被允许改写成文字的施工契约（仍只限写成文字的那几个字段）。
2. 被允许的字段内部，内容是否忠于原文仍不做机器比对（由独立质询把关）——调度者裁定第 3 条。
3. `S16-c7b` 的"调和器跳过本 CU"改由替身给出：授权边界之后，编写调用改不出让真实调和器跳过本 CU 的蓝图（跳过条件是目标节点的 `knowledge_state` / 处置等定位之外的字段）；该分支仍是防御性兜底，断言的是发布后不回滚、如实记未恢复。
4. 位置里的目标若不在本次修复的蓝图（`blueprint_id` 不同）或在基线 / 草稿里解析不到，就不放行任何差异（按越权报）。

### 批三 t5 后半：补 t6 授权边界 — 2026-10-02

按「批三 t6 返修（codex 第五轮：授权边界）」与代码（`outOfScopePaths`、`author_scope`、简报项 `locations`）补文档与规范；子契约未动。

- 手册：流程第 3 步补"只许改本次 B1 发现项定位到的位置"（文字类 / 映射过期两种位置；框架覆盖的 `revision`、根 provenance 五键、`derived_results` 不算越权）；结果表新增"编写越权"一行（`author_scope`、列越权路径、设计 owner 出口、不走越界违规）；"注意"补一条"被允许字段内部是否忠于原文不做机器比对、由独立质询把关"；B 类停机简报字段补 `locations`。
- goal-runner 增量（check-disposition-single-verdict）：派发路线条款补位置检查与 `author_scope` 出口；停机简报项补 `locations`；新增场景"合法修好验收结构但同时扩大另一处 contracts.files → 不发布"。
- app-component-blueprint 增量：修订来源条款补"只限 B1 发现项定位到的位置"、越权处置与"字段内部忠实度由质询把关"；删去原"改决策、扩范围不逐条比对"一句（与新行为相反）。
- MIGRATION P4 子条目边界补一句。

**改动文件**：`docs/operations/goal-mode-runbook.md`、`MIGRATION.md`、`openspec/changes/check-disposition-single-verdict/specs/goal-runner/spec.md`、`openspec/changes/check-disposition-single-verdict/specs/app-component-blueprint/spec.md`。

**验证**：openspec:validate 52 passed / 0 failed、Enforcement 路径 PASS；check-plan-version PASS；check:docs Verdict PASS、阻断 0（doc_freshness 同前 13 份，既有）；行尾全部 w/lf。

### 第五轮（授权边界）评审结论与调度者补改 — 2026-10-02

codex 确认**通过**，原 P1 关闭：允许位置只来自机器诊断，比对覆盖整份蓝图其余内容，映射过期只认删除；绑定失效正例与 S16 两支不再依赖未授权扩写集；S16-c3d、c7b 的改造仍证明各自的处置分支。实施者的偏离（本 CU 所选目标里所有写成文字的同类字段都给位置）裁定为仍在 B1 授权内。
非阻断建议一条已由调度者直接落实：`derived_results` 原先取草稿里的值再标 stale，作者对记录的删改会被保留，与"运行时覆盖"的说法不符；改为只从基线派生（`design-repair-unattended.ts`，一处）。冒烟 S16 主线、S16-stale-resend、S16-r7 共 3/0；完整验证并入收口重跑。
收口重跑在最终代码上进行（快照为无引用提交 `293515b5`，树 `17741c8d`），并同时产出全部场景的六项指标。

### 收口重跑（授权边界修复之后，2026-10-02）

在主工作区对最终代码跑一次（快照为无引用提交 `293515b5`，树 `17741c8d`；跑完后与快照相比只多了本节之前追加的 plan 记录）：

| 项 | 结果 |
|---|---|
| typecheck | 通过 |
| unit 全量（含 consumer-golden 金样） | 5025/0 |
| fixtures | 46/0 |
| design-authority-repair | 45/0 |
| real-chain（含 real-chain-seams） | 14/0 |
| lifecycle-evolution | 14/0 |
| reliability-scenarios | 44/0 |
| openspec:validate | 52/0 |
| check-plan-version | PASS |

六项指标（全部 36 个任务，S10 两支是函数级预判不计）：正确自主完成 24/36、自动恢复 9/15、人工救场 27（另有产品决策 7）、错误完成 0；重复运行稳定性未测。数字与对照见总纲 §14「更正五的闭环」。
指标表"记录与当前义务"一列有 16 个任务显示"无法评估"（assessFeature 找不到 workflow 文件）：这些是运行时链夹具的临时宿主没有带流程配置，采集器的既有局限——已提交的登记表里同样的记录有 55 处——不是本次引入；这些任务的结论按独立验收给出，不受影响。

验收结论：A1–A4、B1–B4、D1–D5 成立（A2、B2、D1 由真实入口与真实生产者证明）；t5、t6 再次标 completed。P4 t5 与总纲 p4 同步关闭。
