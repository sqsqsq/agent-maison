# Goal 模式运行手册（维护者 / agent 参考）

> **宿主入口 SSOT**：[goal-mode/SKILL.md](../../skills/project/goal-mode/SKILL.md)（slash `/goal-mode` 或自然语言「目标模式 / 全自动」；**禁止**要求用户手跑 harness）。
> 裁决 SSOT：[phase-transition-policy.ts](../../harness/scripts/utils/phase-transition-policy.ts)（`goal_mode` **优先于** `batch_authorized`）

## 概述

`GoalPhaseRuntime` 是 Maison 工具无关的唯一 phase 生命周期：按 workflow 派生 chain，统一负责 owner/epoch、assess、attempt、runtime facts、receipt/gate、verdict、回退与封口。`goal-runner` 只是 detached CLI/process shell；有人在场与无人值守仅在 executor transport（宿主回调 / adapter spawn）上不同。运行证据落在 `doc/features/<feature>/goal-runs/<run-id>/`。

## 3.0 调和模型：一个循环、两个运行方式

interactive session 与 detached `goal-runner` 现在共用：

- 冻结的 `PhaseExecutionContext`（run/workflow/track/chain/phase/attempt/owner fence/baseline）；
- 同一个 `GoalPhaseRuntime` 生命周期与 owner 前后 fence；
- 生产纯函数 `projectCanonicalLifecycle(events)` 的规范投影（executor/stdio/lease 遥测不入投影）。

```text
assess@1 → GoalPhaseRuntime authorize/guard → executor transport → gate/verdict → reassess
```

`assess@1` 是唯一跨 phase 推荐源；`GoalPhaseRuntime` 保留 timeout、预算/backoff、cleanup、pass-snapshot、device、source-write、trust、monitor、usage 与 detach 存活等 guard。executor 只传输 phase 调用。详见 [reconcile-loop.md](../concepts/reconcile-loop.md)。

用户只选择：

| 运行方式 | 行为 |
|---|---|
| 有人在场 | 自动推进；遇到 human-only waiting item 立即询问 |
| 无人值守 | 自动推进；waiting item 停放，run 可 detach/resume |

明确自然语言意图直接映射；歧义走 registry `goal.run_mode`；CLI `--detach` 恒为无人值守。菜单不得出现 `in-session`、`headless` 或 capability tier。

### Adapter capability 与降级

adapter root `goal_capability` 新增：

- `in_session_reconcile`
- `phase_context_isolation`
- `supports_resume`
- `handoff: none | to_detached | bidirectional`

in-session 自治必须同时声明 reconcile 与 phase context isolation；缺失时降级为手动 harness+assess。无人值守仍要求 external runner preflight。handoff 还要求 resume 能力。

### Run control 与 handoff

每个权威 run 持久化 `run-control.json`（`run-control@1`）。`current_epoch` 单调递增且 owner 释放后保留；所有 assess、phase invoke、harness/finalizer、event/progress/manifest 写入与终态发布都须通过 fencing。

非 orphan 的 session 与 detached process 切换使用原子 mailbox。requester 只写 request；当前 owner 在 phase verdict 边界写 `handoff_requested`、quiesce、释放；新 owner 以 `epoch+1` CAS 后写 `handoff_accepted`。两者继续使用同一 `run_id` 和 events ledger。仅 `orphaned_session` 可由用户显式授权 force takeover；supervisor 永不得触发该例外。

原生 Claude/Codex `/goal` 仅为可选加速层；闭环裁决以 harness `summary.json` + runner 为准。

## 宿主怎么用（产品面）

| 入口 | 说明 |
|------|------|
| `/goal-mode <feature> [需求]` | Claude slash（路由到 Skill） |
| 自然语言 | 「目标模式 / 全自动 / 无人值守全自动」→ agent 读 goal-mode Skill |
| Codex/Cursor/generic | skills-bridge 跳板（skill id `goal-mode`）→ 完整 Skill |

「全链路 / 从 spec 到真机」等属于 **batch_authorized**（对话内多 phase），不是 goal 模式触发词。

用户**不**直接执行 `goal-runner`；主 agent 按 Skill 内「Agent 必须执行」自跑。

## 停机之后怎么继续（同任务接续，plan 4e6fb3b6 §7）

run 停下来之后，补上缺的那样东西，再**重新发起同一请求**就行：对 agent 说同一句话，或重跑同一条启动命令。
不用找 run id，也不用拼 `--resume`、`--supersede`、`--force-resume`。前台、`--detach`、有人在场三个入口走同一个判断
（`decideRunContinuation`）。

框架看这个 feature 上最新一个还没结束的 run，给出四种结果之一：

| 结果 | 什么时候 | 会发生什么 |
|---|---|---|
| 新开 | 上一次完成之后没有没结束的 run（且范围不在某个已完成 run 手里，见下）；或最新那个 run 从未正式开始过、本次需求内容不同、而范围不在任何 run 手里也没有上一次完成（见下） | 照常出生新 run，出生范围按当前输入重新解析 |
| 重新接入 | 最新那个 run 还能原地继续（不是结构终局） | 回到这个 run：正式开始过的走恢复，从未正式开始过的（启动检查就停下）走附着。条件解除没有，仍由原来的检查判断（设备、凭据、产品选择、金丝雀、预算）；没解除就以原来的原因再停一次，**不新建 run** |
| 起后继 | 最新那个 run 是结构终局，且本次带来了变化 | 出生一个后继，承接所有没结束、没被承接的 run（含启动就失败的）；预算按交付周期累计，不清零。本次请求带了起止阶段（`--start`/`--end`）时：与来源 run 的原始起止相同则照常；不同则明确拒绝并说明、不新建 run（后继不按本次起止缩窄范围）——去掉起止参数重发即可。三个入口同一判据 |
| 保持停止 | 结构终局且什么都没变；或无人值守的调用、正式开始过的 run 停下不到 5 分钟且什么都没变 | 不新建 run、不写事件；打印原来的停止原因和"补上什么就能继续" |

"变化"只认七种能核对的事实：

1. run 绑定的需求来源文件变了；
2. 本 run 报告的相关文件有了修复；
3. 本次请求带了新的需求内容（按全文比较）。只有三种算重复、不算增量：与 run 里合并后的需求全文相同、与最初那次请求的全文相同、与整个历史增量块的全文相同；
   其余一律算增量。所以重发原请求、或原样重发完整的历史增量都不算；但历史里有多段增量时单独重发其中一段会被当成增量（多起一次后继，需求不会丢）。
   本次文本若已是合并格式（带框架的"本轮修复增量"标记），框架只去掉能确认已有的部分——与原请求全文相同的原请求段、开头按整行与整个历史增量块相同的那一截——
   其余都当新增接到后继需求末尾，标记只保留一个；去掉之后什么都不剩才算重复。有人在场与无人值守两个入口得出的后继需求相同；
4. 本次显式给了与当前钉值不同的型号（`--adapter-model`）；
5. 有权者改了 run manifest 的预算，并在本次带 `--override-manifest` 授权；
6. 本次带了显式的 `--resume`、`--attach-created`、`--supersede` 或 `--force`；
7. 最新那个没结束的 run 停在带探针的外部等待上，而探针现在就绪（`external_condition_ready`）。探针有四类：设备就绪（设备、凭据、adapter 能力）、
   能力预检、候选写回、设计权威。它对所有带探针的停机都适用：条件修好后重发即越过冷却。探针没就绪、或探针自己出错，都不算变化。
   探针就绪时框架还会核一遍 run 冻结的输入绑定：仍有效就重新接入同一 run；已失效（同一 run 无法重签）就自动起后继并承接它。

补充：

- 最新那个 run 还能原地继续，但本次显式给了新型号或新需求内容：也起后继。原 run 的型号和需求是冻结的，原地接入会丢掉你的输入。
  例外（结构终局与否都适用）：这个 run 从未正式开始过（没有任何执行证据可继承）、本次需求内容不同，且范围没转交给任何 run、也没有上一次完成可作合同来源时，
  按**新开**处理——多半是改了需求重新准备，出生范围按当前输入（含刚生成的范围候选）重新解析；那个没开始的 run 不被承接，下一次完成之后自然移出交付周期。
  只换型号时照旧起后继（需求没变，来源冻结的请求仍是本次请求）。
- 重新接入不需要 `--force-resume`。5 分钟冷却只在"什么都没变"时生效，只对正式开始过的 run，而且只对**无人值守**的调用：
  - 有人在场的调用不设冷却：非结构终局的 run 直接重新接入，原来的责任检查照常执行，补好条件即可立即重发
    （两种情况不是重新接入而是起后继：本次带了新需求内容；停机所挂探针已就绪而冻结的输入绑定已失效）；
    对"决策会重新接入的那个 run"的显式 `--resume` 同样不等；
  - 从未正式开始过的 run（新 run 在金丝雀、产品选择、产品层目录等启动检查就停下）重发即附着、由原检查立刻重检，不等冷却，
    这种 run 显式 `--resume` 会被拒；产品选择与产品层目录检查在恢复旧 run 时也会执行，曾正式开始过的 run 被它们拦下，
    修好之后按正式开始过的 run 处理（重发走恢复，显式恢复也可以）。统一的说法是"修好之后重新发起同一请求，由框架选择恢复方式"；
  - 无人值守的调用：停机带探针且修好后探针已就绪的，算第 7 种变化，可以立即重发。停机不带探针的（补授权、人工确认这类）、
    或探针还没就绪的，不在七种变化里，正式开始过的 run 停下不到 5 分钟时要等冷却过去再发（说明里写剩余秒数）。
    `--force-resume` 也不能越过这段冷却：冷却期内显式 `--resume … --force-resume` 同样被拒。
- **重新发起不等于授权**。设备策略、凭据登记、人审闸门、scope 扩展确认照旧要人做；没做，重复请求只会再停下，run 数量不增加。
- 有人在场入口（`goal-mode-entry --prepare-run`）判到重新接入时返回既有 run，照常以它的 run id attach；判到起后继时由 prepare-run
  出生后继并返回它的 run id，宿主照常附着——附着时补写承接审计、身份核对、预算血缘与范围转交，后继在原来的有人在场执行者之下运行。
  这个入口没有型号与预算授权的输入，能触发的后继来自四种情况：需求增量、需求来源变化、相关修复变化，
  以及停机所挂探针已就绪而 run 冻结的输入绑定已失效（第 7 种变化，不要求需求或文件有变）。
- 三个显式旗标仍然可用、行为不变：`--resume <run-id>`（结构终局仍要 `--force-resume`；无人值守的调用在冷却期内带了也会被拒）、`--supersede <run-id>`、`--force`。
- 起后继会删掉被承接 run 的场外信任状态（run 目录和事件保留），其中可能有本来能原地恢复的 run。
- 框架发布件更新本身**不算变化**：run 没记出生时的框架指纹。宿主升级框架后要继续一个结构终局的任务，需要带显式旗标或其它变化。
- 功能已经完成之后再提需求：没有没结束的 run、且 feature 范围由一个已完成的 run 持有时，本次带来变化（通常是请求里写明的新增或变更需求）就
  **自动从这个已完成的 run 起后继**（审计、身份核对、范围转交登记照旧）；原样重发同一需求则保持停止，说明"这个功能已经完成；要修改或追加内容，
  请在请求里写明新增或变更的需求后重新发起"。显式 `--supersede <完成 run>` 照旧可用。范围不在已完成 run 手里时，"新开"行为不变。
- 预算耗尽后：首选按停机说明改 run manifest 的预算，再显式续跑本 run（`--resume <run> --override-manifest --force-resume`，说明里已填好 run id）。
  "改预算后带 `--override-manifest` 重新发起同一请求"只在这个 run 本身就是该任务的合同来源时有效（同一 feature 没有更早的完成、范围也没转交给别的 run）；
  否则起出来的后继沿用来源 run 的旧预算。
- 闭环墙（`closure_wall_repeated`，结构终局）：只修了回执或闭环事务、产品与契约文件没变时不算变化，重发会保持停止——用停机说明里的显式续跑命令。
  只有相关产品或契约文件确有改动时，重发才会起后继。

## 设计权威出问题时（蓝图 / Change Unit，plan 9c3d7e1a）

run 在某个阶段的门上发现：问题不在手写产物，而在设计权威本身（蓝图或 canonical Change Unit）。这时当前阶段的 agent 修不了，
框架按两类处理。手写产物只是没对齐一份有效的权威（漂移）不属于这里，仍由当前阶段修复并重试。

### A 类：CU 指针还指着旧的蓝图 revision —— 框架自己修

蓝图已升到更高的已准入 revision，CU 还指着旧的，而且这是 CU 唯一的阻断项（`change_unit_blueprint_ref_stale`）。

- **会发生什么**：框架在同一个 run 里把 CU 指针原位升到当前蓝图（和 `/component-design` readiness 用的是同一个写入函数），
  当前阶段原地重评。不新建 run，不需要你做任何事。
- **怎么看出来**：事件流多一条 `design_authority_repair`（`action: pointer_reconcile`，`outcome` 为 `reconciled` 或
  `not_reconciled`，带升版与跳过的 CU 及原因），goal 报告的阶段表会显示这一行。这条事件只作记录，不参与裁决。
- **预算**：重评算该阶段的一轮内容重试；该阶段的内容重试次数已用完时不再调和，直接按下面的 B 类停机。
- **没修好时**：落回 B 类停机，说明里写明原因，两种情况要分开看——
  - 本 CU 被调和跳过（例如新蓝图里它的设计闭包有未决项）：需要设计 owner 处理，说明附跳过原因；
  - 竞争退出（说明写"另一执行者正在写入，竞争解除后重发同一请求即可，不需要改设计内容"）：同一蓝图下另一个 feature 的 run
    或另一次调和正占着锁。等它结束后**重发同一请求**即可，不要去改蓝图或 CU。同一蓝图下多个 feature 同时在跑时这种情况会常见；
    锁释放后框架不会自己续跑：对方只是放了锁、没有替本 CU 升版时，旧指针的阻断还在，探针不就绪，supervisor 也不会拉起。
    所以竞争解除后要**重发同一请求**（按「停机之后怎么继续」的规则接入，接入后框架再调和一次）。只有别的调和（另一个 run
    或一次 readiness）已经把本 CU 的指针升好、探针就绪时，已启用的 supervisor 才可能自动唤醒（还要满足下面 supervisor 的条件）。
- 同一蓝图下**别的** CU 被跳过不影响本 run，只在事件里披露。

### B 类：设计内容本身要改 —— 停机交设计 owner，修好后自动续跑

其余情形第一次遇到就停（停机原因 `execution_scope_unresolved`），不在当前阶段反复重试（无人值守且已预授权的 B1 先由框架自动修一次，
见「无人值守时 B1 由框架自动接手」）。run 立即停放并**释放 feature 锁**
（设计 owner 修完要经 readiness 调和，调和要取这把锁），不做进程内等待。

停机说明（和 `phase_halt` 事件的 `design_authority` 字段）带分类与修复简报——哪条检查、原因码、要改哪个产物、定位到蓝图的哪个位置（`locations`）、依据、缺什么：

| 分类 | 含义 | 谁来修 |
|---|---|---|
| **B1** | 在既有授权内、依据明确，改正不需要新的设计决定。目前只有两个原因码：蓝图里的机器内容被写成了一段文字（`authority_content_not_machine_structure`，按原文含义改回机器结构）；蓝图里的 CU 映射指向本 CU 的旧 revision（`authority_cu_mapping_stale`，删掉这条可省略的 `contracts.change_unit.change_unit_ref`、由投影按当前 CU 填入，其余映射保留；不要改指当前 CU——蓝图一升版 CU 跟着升版，引用会立刻再过期） | 有人在场：设计 owner 照 `/component-design` 直接修。无人值守且已预授权：框架先自动修一次（见「无人值守时 B1 由框架自动接手」） |
| **B2** | 其余全部：缺内容、归属或内容冲突、未决决策、缺权威来源、扩大范围、CU 或蓝图未过校验等；没登记的原因码、B1 与 B2 混在一起时也算 B2 | 有权者先裁决或补事实，说明里写清缺什么 |

**修好之后**：

1. 修复要经 `/component-design` 的 readiness（它会把 CU 指针升版并刷新派生投影），不要只手改文件。
2. **重新发起同一请求**。不用任何旗标，冷却期内也可以——停机挂着探针 `design_authority_projectable`，探针就绪就是上节的第 7 种变化。
   - run 冻结的输入绑定仍有效 → 重新接入**同一个 run**，当前阶段按新权威重评；
   - 由蓝图派生的绑定已失效（蓝图内容变了，同一 run 无法重签）→ 框架**自动起后继**并承接停机的 run，仍是同一个任务，
     不需要你拼 `--supersede`；
   - 这次重发带了起止阶段（`--start` / `--end`）又需要起后继时，照上节规则：与来源 run 的原始起止不同会被拒绝，去掉起止重发即可。
3. **还没修好就重发**：探针没就绪，只是第 7 种变化不成立，其余照「停机之后怎么继续」的规则判，不新建 run，但不一定"保持停止"：
   - 保持停止（不写事件、不重新执行）要同时满足：无人值守的调用、run 正式开始过、停下不到 5 分钟、其它六种变化一样都没有；
   - 否则会重新接入这个 run、重新执行当前阶段，再以原来的原因停一次（会消耗调用次数与预算）：有人在场的调用（不设冷却）、
     过了冷却、或有其它变化成立。常见的一种其它变化：停机前框架做过 run 内指针调和并改写了 contracts.yaml，
     这算"相关文件有了修复"，重发会立即接入。本次带了新需求内容或新型号时按上节规则起后继。
4. 探针"就绪"只表示可以重试：停机时记录的每一条设计阻断都不再拦（只修了其中一条不算；这道门此刻重评不了也不算）。
   重评仍可能因别的内容问题失败，那时走当前阶段的正常修复与重试。

**已启用 supervisor 时**：只对无人值守的 run（run 的 owner 是进程，且没有进行中的交接）——探针就绪后它自动拉起，不用重发。
拉起之后是原 run 继续还是起后继，由 runner 的同一处判断决定。
自动拉起有上限：同一任务最多 3 次，**起后继之后继续累计、不清零**；用完后不再自动恢复，需要你重发同一请求。
有人在场的 run（owner 是会话）supervisor 一律不拉起，即使它已停放、探针已就绪：修好后在会话里重新发起同一请求接入。
没启用 supervisor 时，无人值守的续跑也靠重发请求。

### 无人值守时 B1 由框架自动接手（需预授权）

默认关闭。只有你在个人配置 `framework.local.json` 里写了预授权，框架才会在无人值守的 run 遇到 B1 停机时先自己派一次设计修复，
修好就接着跑：

```json
{ "design_repair": { "unattended_b1": true } }
```

只有布尔 `true` 算开启；字符串 `"true"`、`1`、缺失、`design_repair` 不是对象、个人配置读不出来，一律按未授权。
这是你事先给的授权（和获准替代型号同一种性质），agent 不能自己打开。

**什么时候派发**（同时满足才派，否则照上面的 B 类停机）：

- run 无人值守（owner 是进程）。有人在场（owner 是会话）不派发，停机交给会话里的设计 owner；
- 这次停机整体是 B1（每一条设计阻断都是 B1）。B2、B1 与 B2 混在一起都不派发；
- 已预授权；
- 同一个停机签名还没试过。签名 = feature + 停在哪个阶段 + 设计阻断的检查 id 与原因码，不含 run id 和时间。框架从本 run
  和被它承接的 run 的事件里查：`--resume`、起后继、进程中断后再遇到都算同一个签名，**每个签名只试一次**；
- 该阶段的内容重试次数还没用完（整次尝试算一轮内容重试）。

**会发生什么**（都在当前 run 里，用当前 adapter 和已钉的型号）：

1. 取锁：蓝图锁，加上这个蓝图下**全部** CU 的 feature 锁（本 run 自己那把借用）。取不到就不派发、不写记录、**不消耗这次机会**，
   照 B 类停机，说明里写明是竞争。取锁中途出错时，本次已取到的锁当场放掉（借来的那把不动）。
2. 先记一条 `design_authority_repair`（`action: content_repair`，`stage: attempted`，带签名），落盘成功才往下走。
3. 只把蓝图文件复制到 run 目录下的草稿（`<run 目录>/design-repair/component-blueprint.yaml`），派一次"编写修复"调用：
   只许改草稿，按 [无人值守修复子契约](../../skills/reference/design-repair-unattended.md) 修；而且草稿里只许改本次 B1 发现项定位到的位置
   （停机事件 `design_authority.items[].locations`）：文字类是本 CU 所选设计目标里被写成文字的 `acceptance` / `contracts` / `use_cases`
   字段，映射过期只许删掉 `contracts.change_unit.change_unit_ref`。框架随后覆盖的 `revision`、根 `provenance` 五个登记字段与
   `derived_results` 不算越权。
4. 框架作废草稿里的整份旧质询结果，登记新 revision 与修订依据（写在蓝图根 `provenance`，`source_kind: design_repair_unattended`；
   框架覆盖的只有 `revision` 和根 `provenance` 里的这五个字段：`source_kind`、`source_ref`、`source_revision`、`observed_at`、
   `extraction_method`；根 `provenance` 的其余字段（如 `evidence_strength`）保留编写调用写下的值，照常校验，删掉或改成非法值会让校验不过），
   把既有派生结论标 stale，按校验结果派生并写回准入（这时还过不了）。
5. 再派一次与编写隔离的"独立质询"调用，只许改草稿里的质询结果；框架再派生准入并做完整校验，通过才发布。
6. 发布：先确认 canonical 蓝图在这期间没被别处改过，再把草稿原子替换上去（只换蓝图这一个文件）；随后在同一把锁里调和 CU 指针，
   放锁，用停机时同一个探针判定原来那道门。
7. 探针就绪、run 冻结的输入绑定仍有效 → 同一 run 原地重评当前阶段，接着跑，不需要你做任何事。

**预算**：两次调用照常计入调用次数，各受剩余墙钟限制；编写之后剩余次数或墙钟不够，就不启动质询（尝试失败）。不重置任何预算。
事件里这两次调用的 `phase` 是用途标识 `design-repair-author` / `design-repair-questioning`，不是阶段名。

**结果与你要做的事**：

| 结果 | 框架怎么处理 | 你要做什么 |
|---|---|---|
| 修好，绑定仍有效 | 同一 run 继续；事件 `stage: published`、`outcome: recovered` | 不用做 |
| 修好，但冻结绑定已失效（修复改了派生绑定依赖的蓝图内容） | 停放（探针已就绪），说明写"已发布并调和、冻结绑定失效" | supervisor 满足前文「已启用 supervisor 时」的条件（run 的 owner 是进程、没有进行中的交接、同一任务自动拉起未满 3 次）才会拉起，拉起后由恢复入口起后继；只有它实际拉起了后继并完成，才算你没有动作。其余情况重发同一请求，框架自动起后继 |
| 发布前失败：编写或质询调用失败 / 未启动、质询没产出结果、编写调用改了准入或质询结果（自报）、修复后校验或准入不过、调用前无法核对工程文件、canonical 被别处改了 | 丢弃草稿、不发布，canonical 不变；事件 `stage: failed` 带失败步骤；照 B 类停机，说明写明已用掉唯一一次机会 | 照上面「修好之后」人工修，再重发 |
| 编写越权：草稿里改了发现项定位之外的蓝图内容（例如另一处 `contracts.files`、决策、其它节点） | 修复作废、丢弃草稿、不发布，canonical 不变；事件 `stage: failed`、失败步骤 `author_scope`，原因里列出越权路径；照 B 类停机（设计 owner 出口），说明写明已用掉唯一一次机会。草稿之外没有被写，所以不走越界违规停机 | 照上面「修好之后」人工修，再重发 |
| 发布后没恢复：调和没把本 CU 升到新 revision，或探针仍不就绪 | **不回滚**，蓝图已是新 revision；事件 `stage: published`、`outcome: unrecovered` 带卡住的步骤；按发布后的新状态重新分类再停机（可能变成 B2） | 看新 revision 改了什么、还差什么，照 B 类处理。发布成功不等于修复成功 |
| 检出调用改了草稿之外的文件（核对范围见下面"注意"第 2 条） | 修复作废、不发布；记 `phase_write_violation`，列出路径与前后哈希；以既有违规停机 `backtrack_target_absent` 终止本 run。工程文件**只检测、不还原**；唯一的例外是蓝图工作区里各 run 的事件文件：框架把它整份写回应有的内容（调用前的字节加上框架这次自己写入的行），判重、预算与会话分段的回放因此和没被改过一样 | 用版本控制核对并恢复被改的工程文件，再 `--supersede <本 run id>` 起后继 |
| 核对不了：调用之后的快照无法验证，或编写调用让蓝图新引用了一个调用前没核对过的文件（位于 `context/`、`reports/` 这类通常不核的目录） | 同样不发布，以 `backtrack_target_absent` 终止本 run。这时**不一定**有 `phase_write_violation`，也不一定有路径与哈希清单：只有同时检出了具体改动（例如某个事件文件被改）才有；以停机说明里的失败原因和停机事件为准。合法地新引用这类文件也会被拒（宁可误报） | 同上；没有路径清单时按停机说明的原因自行核对工程文件 |
| 调用的子进程没能证明已经结束（Windows 上进程收容失败） | 不做草稿外核对和事件文件核对、不发布、不启动下一次调用；以既有停机 `agent_containment_unresolved` 终止本 run，不挂设计探针（旧进程可能还在写）；本签名已记 attempted | 本手册的建议（停机说明里没有写下一步）：先确认那个修复调用残留的 agent 进程已结束，再重发同一请求；重发仍走既有的恢复入口与未收尾调用的对账，不会因为这里而放宽。本签名不会再自动修。能证明进程已结束时，只算普通的发布前失败 |

**注意**：

- 两个 feature 的 run 同时撞上同一蓝图的修复：取不到锁的一方不派发、停放，不消耗机会；两方可能都停放，这时需要你重发一次
  （算人工动作）。一方发布成功后，另一方重发时探针已就绪即续跑。
- 草稿之外的核对覆盖整个工程顶层（依赖、缓存、构建目录除外），分三块：
  - **蓝图工作区**（canonical 蓝图、全部 CU，以及其下所有 run——本 run、祖先 run、兄弟 CU 的 run——的 manifest、run-control 等）
    全部照查，只排除调用期间框架自己会写的路径：草稿、两次调用的日志目录、本 run 的 `progress.json` / `progress.md` /
    `liveness.json`、本 feature 的锁。
  - **事件文件**（调用开始时工作区里已有的各 run 的 `events.jsonl`）单独核：调用后必须恰好等于"调用前的字节 + 框架这次自己写入的行"
    （按原顺序）；框架没写的文件必须一字不变。任何删、改、插、补都算越界，并按上表整份写回。调用中新建的事件文件不在此列：
    按工作区快照报"新增"，不自动还原。
  - **被引用的输入**：蓝图 `source_ref` 引用的文件即使在 `context/`、`reports/` 这类通常不核的目录里也逐个核。编写调用核基线蓝图
    引用的文件，质询调用核基线与草稿引用的并集。
  工作区以外，别的 run 的运行时输出（`goal-runs` / `reports` / `context` 下的运行记录与阶段状态文件，被引用的除外）照常排除，
  不算越界；但调用期间别的 run 改了产品源码、需求等工程文件，仍会被当成本次越界，所以同一工程上并发跑多个 run 时可能误报。
- 发布后同目录的评审投影 `component-blueprint.review.md` 不会重新生成（事件标 `review_projection_stale: true`）；要给宿主看，
  按 `/component-design` 第 5 步重新输出评审投影。
- 被允许改的那个字段内部，改写是否忠于原文框架不做机器比对，由独立质询把关；通不过校验或准入照样不发布。
- 发布前不重跑原来那道门：修法本身合法但没修好时也会发布并用掉这次机会，随后按"发布后没恢复"处理。
- 签名不含蓝图内容：同一检查同一原因码在蓝图改过之后再出现，也不再派发。

### readiness 报"忙"是什么意思

`/component-design` 派生 readiness 时，如果调和取不到锁，结果是 `ready: false` 且 `blueprintRefs.busy` 有说明，**不给出任何 readiness 结论**。
它的意思是"另一个执行者（某个正在跑的 goal run，或另一次调和）正在写入"，不是设计有问题：一个字节都没写，等对方结束后重跑 readiness 即可，
不需要改设计内容。B 类停机的 run 已经放锁，所以修复它不会被它自己挡住。

## 维护者 / CI 调试（非宿主默认路径）

```bash
cd framework/harness && npx ts-node scripts/goal-runner.ts \
  --feature <feature-slug> \
  --requirement "需求描述" \
  --adapter claude \
  --dry-run
```

去掉 `--dry-run` 前须确认 `unattended` 契约（manifest 或 adapter `goal_capability.external_runner.unattended`）。

续跑：重跑同一条命令即可（见上节「停机之后怎么继续」）；显式 `--resume <run-id> --feature <feature-slug>`（或 `--manifest <path>`）仍可用。

证据：`doc/features/<feature>/goal-runs/<run-id>/manifest.json`、`events.jsonl`、`goal-report.{md,json}`。

### Run 出生与 diff 基线

新 run 统一由 `createGoalRun` 创建：先写 `manifest.json`，再写且仅写一条
`run_created`。只有这两项完整存在，attended bridge、detached runner、supervisor 和
recent-run 投影才会把它当成可运行实例。仅有 manifest、事件损坏或 `run_created` 重复均为
`CREATION_INCOMPLETE`：不可 attach/resume，也不构成同 feature 的 HALTED/PARTIAL 占位者；
检查既有 GC 报告后人工清理残留即可，不会自动补造出生事件。

实际 chain 含 `coding` 或 `ut` 时，出生必须把当时 exact Git HEAD 冻结为
`manifest.run_base_sha`；取不到 HEAD 就在零 agent 派发前拒绝创建。goal 内 UI/UT diff
只认该字段，忽略并从子进程环境剥离 `HARNESS_DIFF_BASE_REF`。没有 `run_created` 的旧 run
仍可只读旧 `run_start + coding-base`；一旦 `run_created` 在场便永不回退旧锚。

`run_base_sha` 是 write-once 身份：同 run 的 `--override-manifest`、identity rebase 和 resume
均不能改写。自动 successor 继承 lineage 的最早可信基线，不重新读取 HEAD。确需放弃旧
lineage 时，只能由操作者在 goal runtime 外运行：

```bash
cd framework/harness && npx ts-node scripts/goal-runner.ts \
  --feature <feature-slug> --requirement "<新问责需求>" --adapter <adapter> \
  --supersede <old-run-id> --rebaseline-to <当前-exact-40hex-HEAD> --detach
```

两个参数必须同时提供，`--rebaseline-to` 必须等于执行瞬间 HEAD；goal execution env
（即使带 `MAISON_GOAL_GATE_HARNESS=1`）一律拒绝。审计只追加到新 run：
`run_created.rebaseline_from_run_id` 与 `supersede` 的 target/superseding/base/event 引用；
不回写旧 run。这个管理命令建立新的问责边界，不是质量豁免，也不构成密码学真人证明。

### Runtime-owned blocker 与契约扩展

`run_base_sha` 缺失、损坏或与出生摘要不一致属于 runtime-owned framework blocker：runtime
必须在 executor 前停止，且 actionability 归 operator/toolchain，不得把“补锚”“改 manifest”或
重试同一 prompt 回喂给 agent。现代 run 不允许用 `trace.start_commit`、当前裸 HEAD 或
`coding-base.json` 临时补救；旧 reader 只服务没有 `run_created` 的迁移期 run。

plan closure 会把 `resource_keys[*].path`、`media`、页面/路由注册点以及 HAR build/export
路径统一解析，并要求每个文件引用都已列入 `contracts.files`。例如 contracts 引用了 20 枚
logo、但顶层 `files` 未声明时，应回到 plan 扩充 `contracts.files` 并重新 closure；不得在
coding 后绕过 UI scope、按字节一致自动授权或另建 asset 豁免表。`contracts.yaml` 始终是唯一
持久输入，closure 只产生内存规范化视图。

## 状态语义（goal-fakepass-hardening 后）

| 最终状态 | 含义 |
|----------|------|
| `CHAIN_SLICE_COMPLETED` | **本 run 的链切片**全 PASS——不等于需求完成；feature 级只认 `verify-feature-completion`（goal-status 尾行 `feature_status=`） |
| `AWAITING_HUMAN_REVIEW` | legacy 读取兼容；新 run 不再写出。旧质量人签等待在恢复时按当前机器事实重投影为 repair、capability defer、optional advisory 或诊断，不能靠签名 resume |
| `DEFERRED_CAPABILITY_MISSING` | 当前 provider/profile 缺少冻结需求所需能力（含 strict 视觉或 P0 native CaseResult.steps[]）；配置可用能力后重跑/恢复，不能用 fidelity receipt 降低目标 |
| `DEFERRED` | 到达 end 但存在外部阻塞未闭环 |
| `PARTIAL` | 中途停止或未到 end 且有 DEFERRED |
| `HALTED` | 预算/收敛熔断、完整性持续不稳定、真正外部权限边界或 framework defect 等诚实终止；可修质量 FAIL 走责任阶段重跑，P0 skip/档位/视觉证据不得靠 waiver 放行 |
| `COMPLETED` | legacy（旧 run 事件读取兼容），新 run 不再写出 |

**任何 run 级状态 ≠ 需求完成**：feature 完成唯一判据 = `assessFeature`（feature-assessment）
返回 `complete`（记录可信 + 义务逐条覆盖 + 无 blocking；伪造/缩链判记录 broken，世界后变
判对应义务 uncovered）。截断链 run（`--start` 非链首）启动前会机器核验上游各阶段
closure（phase-evidence-manifest staleness + review attestation），manifest 文本断言不作数。
结构终局的 HALTED run 由重新发起请求时的接续决策在有变化时起后继承接（写审计事件，completion 只认经审计的 supersede），显式 `--supersede <run_id>` 仍可用；
只有需要切断旧 diff lineage 时才同时使用上节的 `--rebaseline-to`。completed 源 run 的 successor 重算范围（只跑未覆盖义务的责任阶段）。

**DEFERRED ≠ 完成**：不得宣称 UT/真机已闭环。

## Testing evidence 与报告重算（testing-stepresult-evidence-consumption）

- testing 不得把旧 case 状态当作 `verification=passed`；无 `CaseResult.steps[]` 的未执行 case 保持 testing FAIL，不按 TC 名称或报告散文自动投 coding。只有既有 capability resolution 给出 provider 缺失的机器事实时，才走 capability defer。历史产物里的 `explicit_skip_tc_ids` 只作只读诊断，与「未执行」同等对待——不贡献 PASS、不产 coding candidate，新计划与派生器禁止写入。
- testing 只消费 authoritative trace 的 `CaseResult.steps[]`；Maison 根据 acceptance/checkpoint 自算 coverage。最低契约为 Hylyre `0.5.0`、trace `schema_version=0.4-p0`、`result_protocol=hylyre.step-outcome/1`（Step Outcome v1），并需通过 release manifest → ready meta → trace environment 版本链与必需字段门禁。native trace 同时绑定实际 derived plan、top plan、trace 路径/SHA，并核对 StepResult count/index/kind；`execution`、`verification`、`evidence`、`expected_check_mode` 与 StepResult 的 `outcome` 是机器消费字段：状态读 `outcome.status`，失败事实读 `outcome.failure.domain/code/facts`，blocked 原因读 `outcome.cause`，skipped 原因读 `outcome.reason`，selector 读 `selector.request`/`selector.resolution`；flat `status`/`failure_kind`/`failure_code` 已退役，也不从 `diagnostic` 文本重建。
- 顶层 `test-plan.md` 每条 TC 声明唯一 `execution_channel`（`hylyre|visual|manual:<gap_class>|provider:<capability-id>`）；known manual gap / inactive provider 才是 `unsupported_gap`，裸/未知 manual、未登记或 active 无 producer 的 provider 在跑机前 `invalid_test`。派生器只编译 `channel=hylyre` 的精确集合，不得新增/删除/改写通道。责任路由只消费实际执行且 `outcome.status=failed` 的步骤；`blocked/capability` 与 `blocked/infrastructure` 各投影 1 次 disposition 而非伪造 failure route，`blocked/prior_step` 与 `skipped/policy` 零 route 零 defer。
- native StepResult 在场时不再调用旧 runtime telemetry monkey-patch；历史 telemetry 仅作具体 checkpoint 的有限兼容或一致性 WARN，不得合成第二套 CaseResult/StepResult 状态。goal 仍保留 run/attempt/HAP/device identity binding。
- run 已产 trace 后即可执行 `--report-reconcile-only --phase testing --feature <feature>`（harness 自己生成报告，**不要求** agent 预先写好顶层 `test-report.md`）。该模式只读最终 trace、test-plan、`device-test-timing.json` 与 build/install/run meta，完整重算既有 report/static checks、summary、quality axes 与 repair candidates；不调用 hvigor、hdc、Hylyre、设备或视觉采集，也不修改 trace 字节。
- 报告必须保留 skip 并计入正确分母（P1/P2 的未执行 case 也不能绕过 testing FAIL），使用最终 build/install reused 状态、最终 timing，并回填每个 case duration；native timing 直接汇总 StepResult duration，legacy 才回退日志算法；不得把首轮真编或旧轮数据写成最终执行轮数据。

## Adapter 选择与 personal setup（goal 入口）

**运行身份权威 = `framework.local.json agent_adapter`（SSOT）**。解析阶梯（用户显式 > 跳板/入口声明 > registry 交互，**永不默认 claude/cursor**）只产 `requestedAdapter`；effective 以合法 local 为准——`requestedAdapter` 仅在「首启无 local」或 `--override-adapter` 时才生效。goal-runner 在写 manifest 到盘前对账：`--adapter` 与合法 local 冲突 → **BLOCKER STOP**（不静默覆盖、不写 manifest），除非 `--override-adapter`（按请求回写 local 并留痕）。manifest 记 `adapter_provenance`（user_explicit|entry_declared|local_config|registry|override）供回溯。

`adapter_provenance` 记录 run **出生时**的 adapter 来源：resume 的 effective adapter 未变化时，
即使本次需要 `--override-adapter` 对账 local，也保留出生值，不改冻结 manifest。3.0.0 曾有旧
runner 把该字段改成 `override`，造成 phase evidence 全文件 hash 假 stale；兼容读取只在两份
manifest 除 `adapter_provenance` 外逐字一致时视为 fresh，requirement、adapter、预算等任何
真实字段变化仍 fail-closed。

1. goal-mode Skill 启动 runner **前**跑 `check-personal-setup.ts --json --ensure --select-adapter <requested>`（见 [personal-setup-gate.md](../../skills/reference/personal-setup-gate.md)）；用返回的 `activeAdapter` 作 `--adapter`。
2. 多 adapter 且 local 未设 → `needs_adapter_choice` → registry `setup.adapter` → `init-orchestrate --scope personal` → `record-adapter`（写 `framework.local.json`，非项目产物）。
3. **`adapter_conflict`**（local 已记录 X、本次请求 Y≠X）→ 默认尊重 X；确要换 Y：永久走 `record-adapter`，本次即时换加 goal-runner `--override-adapter`。
4. 双缺（无 requested、local 也无合法 `agent_adapter`）→ preflight/reconcile BLOCKER，**永不默认**。

### 排障：adapter 误选（如 cursor 记录却跑成 claude）

根因（2026-06 宿主实测）：旧链路把 agent 的 `--adapter` 猜测置于 local SSOT 之上（`argv.adapter ?? cfg.agent_adapter`），`--adapter` 一来又 `delete('agent_adapter')` 跳过 local 校验，且 `check-personal-setup` 静默吞掉 select≠既有 的冲突 → agent 猜的 claude 一路覆盖了你记录的 cursor。现已根治：local 权威化（reconcileRunAdapter）+ `adapter_conflict` 码 + manifest 前置对账（冲突不写 manifest）。

- **触发面（Cursor）· G6 已修**：根因是多 adapter 同名产物（`.cursor/skills`·`.claude/commands`·`.codex/skills` 都有 goal-mode）+ cursor 原 `commands: null`（无 `.cursor/commands` 产物）→ Cursor runtime 误读同名 `.claude/commands/goal-mode.md`(claude) 当 `/goal-mode`。G6 已给 cursor 生成 `.cursor/commands/goal-mode.md`（`RESOLVED_ADAPTER: cursor`），让 Cursor 的 Command 通道解析到 cursor 产物。**范围**：只修 goal-mode（唯一携带运行身份的 slash）；其它同名命令路由到 adapter 无关 skill、无误路由。
- **Cursor 手工验证项（仓内证不了）**：`.cursor/commands/goal-mode.md` 存在且内容 `RESOLVED_ADAPTER: cursor`（仓内单测已锁）；但「Cursor 是否优先读 `.cursor/commands/` 而非 `.claude/commands/`」属 Cursor 产品行为——须在 Cursor 里实测：Settings → Commands 看 `/goal-mode` 指向 `.cursor/commands/`，必要时禁用/移除 `.claude/commands/goal-mode.md`。**无论 Cursor 行为如何，G1/G2 仍是硬兜底**（错 adapter 会被 goal-runner STOP）。
- **恢复**：① 核对 `framework.local.json agent_adapter` 确是你要的；② 重跑（冲突会被 STOP 并提示）；③ 真要换：本次用 `--override-adapter`，永久用 `record-adapter`。

## 视觉金丝雀缓存（`framework.local.json vision.canary`）与升级模型

UI 相关 goal 首跑会真实探测一次 adapter 的读图能力（几何/颜色四题），结果缓存进
`vision.canary`（个人级本地配置）。**升级 framework 时不要删 `framework.local.json`**
——删除会连 `agent_adapter`/DevEco 路径一并丢掉；缓存有完整的自动生命周期
（plan c7d2e9a4）：

- **协议版本自愈**：缓存带 `probe_version`；framework 升级改了探测协议后旧缓存自动判
  stale，下一次 UI goal 重探原位覆写——用户零操作；
- **TTL 分层**：goal 来源 `tool_read` 7 天、`none/ocr_capable` 24 小时（模型路由/额度/
  权限会静默变，不永久采信）；interactive 来源恒 24 小时；
- **探测失败不落缓存**：invoke 失败（非零退出/超时/静默被杀）或输出非有效答卷
  （空输出/额度错误文本/prompt 回显/残卷）一律不写盘——盘上有新鲜缓存则沿用
  （stale-if-error，runner 日志如实注明），否则本次 run 回退 adapter 声明路径、下次自动重探；
- **强制重探**：换模型/账号后想立即刷新，goal-runner 加 `--refresh-vision-probe`
  （自然语言对 agent 说「强制刷新视觉探测」即映射此 flag）；或手删 `vision.canary` 节点
  （只删该节点，勿删整个 local 文件）；
- **模型钉绑定（`--adapter-model`）**：pinned run 的 canary receipt 记 pin 模型值，采信/跳过
  须 run + 模型同时命中（resume 改 pin 同 run_id 的旧模型缓存、并发窗口切走模型的旧缓存
  都会自动失效重探）；未 pin 的 run receipt 仍记 `unknown`、采信行为与现状一致。

## 两级校验

- **check-init**：`goal_capability` 缺失仅 WARN
- **goal-runner 运行身份对账（写 manifest 前）**：`reconcileRunAdapter` 以 `framework.local.json agent_adapter` 为权威——`--adapter` 与合法 local 冲突 / 双缺 / `--override-adapter` 无 requested → BLOCKER STOP（不写 manifest）；override 经 `recordAdapterToLocal` 回写留痕
- **goal-runner preflight**：`manifest.adapter` ∈ materialized + 入口产物 + `goal_capability`/`unattended` + **provenance**（仅 `fallback` 拦 personal setup）+ 无头 CLI 可解析（`--dry-run` 降级 WARN）

## Headless 路径（MVP 硬化）

**全权限契约（plan a8e5c3f9）**：用户主动启动 Goal/headless 即授权 agent 无人值守全权限执行
（non-interactive + no approval prompt + full filesystem/tool execution）；adapter 只把该语义翻译成
自家 CLI 参数，不得降级。全权限=执行能力，不是业务裁决权——phase 权责、integrity、runner-owned
gate、receipt/人签、设备与凭据规则不变；agent 自跑 harness 只是快速反馈，runner 的正式 gate 仍是
唯一裁决真源。headless 下**无须也不应**再为单个命令（npx/npm/node/hvigor/hdc…）做预批准。

- Claude：`claude -p --dangerously-skip-permissions`（结构化 argv，不经 shell tokenize；不再用
  `--permission-mode dontAsk`——那是"不询问、未批准即拒绝"而非 bypass，也不再传 `--allowedTools`。
  2026-08-17 宿主实跑验收：该 argv 组合下真实执行 `npx ts-node --version` 成功、`permission_denials=[]`）
- CodeAgent：**当前不支持 Goal/headless**——argv 与 Claude 共用（`codeagentcli -p
  --dangerously-skip-permissions`），但该 bypass 旗标在 codeagentcli 上未经宿主实测（2026-07-29 家族
  等价实证只覆盖旧旗标集），preflight 以 `adapter_headless_permission_unsupported` 明确拒绝。解锁路径：
  宿主跑 `codeagentcli --help` 确认旗标存在并实跑一条 shell 命令，然后删除 agent-invoke.ts
  `assertAdapterHeadlessFullPermission` 的 codeagent 分支（argv 无须再改）。宿主身份 env=`CODEAGENT=1`，
  hook 进程注入 `CODEAGENT3_PROJECT_DIR`
- Codex：`codex --ask-for-approval never exec --sandbox danger-full-access`（恒定，不随 manifest 摇摆；
  审批旗标为**顶层旗标**，必须放 `exec` 之前）
- Cursor：`cursor-agent`（回落 `agent`）`-p --force --trust`（恒定）+ prompt stdin。**禁止**
  `cursor agent --print`。Windows `.cmd` 垫片经 **cross-spawn** spawn（`harness` 依赖 `cross-spawn`）。
- Chrys：**当前不支持 Goal/headless**——其非交互全权限（bypass）参数未经宿主核实，preflight 以
  `adapter_headless_permission_unsupported` 明确拒绝（不静默以未知/残权限启动）。解锁路径：宿主跑
  `chrys run --help` 把等价旗标带回来，接入 agent-invoke.ts 与 agents/chrys/adapter.yaml。
  （原调用形态存档：`chrys run --task <PROMPT_FILE> -C <PROJECT_ROOT> --agent Code --json`；文件传
  prompt；CLI 在 PATH 或 `%LOCALAPPDATA%\chrys\bin`；无流式输出；退出码 0/1(stderr JSON)/124/130。）
- OpenCode：`opencode run --dangerously-skip-permissions --dir <PROJECT_ROOT>` + **stdin 灌 prompt**（**勿用 `-p`**，其为 `--password`）。前置：`npm i -g opencode-ai`，bin 名 `opencode`；模型/凭据由 opencode config/auth 提供，先手跑 `opencode run "hi"` 验证。**skill 落 opencode 自有原生目录 `.opencode/skill/<id>/SKILL.md`**（opencode 长期稳定的主 skill 目录，兼容当前版本及传统原生目录；不依赖较新的 `.agents` 外部 skill 发现）。`AGENTS.md` 仍在项目根（opencode 原生读为 instructions）。opencode **自动加载的只有** `AGENTS.md` + `.opencode/{skill,skills}/**/SKILL.md`；`.opencode/rules/*` 不自动加载（引用可达，非有效规则入口），maison 不碰用户 `.opencode/opencode.json`。默认开关全开（勿设 `OPENCODE_DISABLE_PROJECT_CONFIG` 等禁用 bundle 的 env）。Windows `.cmd` 经 cross-spawn。

**模型钉（`--adapter-model <id>`）**：并发多窗口跑不同模型、或要钉住本 run 模型时，启动 goal run 传 `--adapter-model`，该值是**权威输入**并随 headless argv 回放（codex/claude/codeagent/cursor 用 `--model <id>`，opencode 用 `-m <id>`），写入 manifest `adapter_model_pin`。`chrys`/`generic` **不支持**（传了即 BLOCKER fail-fast）。CLI、loaded manifest、successor 继承**均无 pin** 时 = 现状零变化；pinned run 的 resume 不传 flag 仍继承并回放冻结 pin。**仅 headless/unattended（含 `--detach`）；有人在场 in-session 不适用**。

### 获准替代型号（`framework.local.json adapters.<adapter>.approved_models`，plan 4e6fb3b6 §6）

型号不受支持时，框架可以换成你事先批准的型号接着做。没配置就不换，行为和以前一样。写在个人级 `framework.local.json`：

```json
{ "adapters": { "codex": { "approved_models": ["<型号A>", "<型号B>"] } } }
```

- 按你给的顺序试；去首尾空白、去重。值写错（不是字符串数组、有空串、超 128 字符、含控制字符）按没配置处理并给出提示。
- **什么时候换**：金丝雀或正式调用判为"模型不受支持"时，取清单里下一个没试过的型号，写事件、重探金丝雀、继续。
  不占阶段的内容重试次数。目前只认 codex 400 信封的两种实采措辞；其它 CLI 硬失败（参数不识别、认证失败等）不换。
- **不换的情况**：型号是你显式钉的（`--adapter-model`，包括本次调用显式给的、以及没有来源记录的旧钉值）；adapter 没有型号回放
  （chrys / generic）；清单为空或都试过；预算已尽。这时照旧停机，说明写清原因并列出试过的型号。你显式钉的型号永远不会被换。
- **留痕**：每次换型号写 `adapter_model_substituted`（from / to / 已试列表），以及只授权 `adapter_model_pin` 这一个字段的
  `manifest_identity_rebase`（`authorized_by: approved_model_alternatives`）。manifest 钉值记 `source: approved_alternative`；
  后继继承钉值时连同来源一起继承，来源是替代的不算你钉死，再不受支持还能接着换。钉值变了，旧的金丝雀缓存不再采信，会重探。
- **预算**：替代和每次探测都算墙钟预算、受同一截止时刻约束。单次金丝雀最多 120 秒，剩余额度更少时按剩余额度；
  预算尽了不再试下一个。恢复和后继不重置已用额度。
- **代价**：换型号会改变成本和产出质量。它只在你配置了清单时发生，每次都有事件可查。

**只读视觉 provider（`--visual-adapter <a> --visual-model <id>`，plan ab072691）**：主模型无视觉时，
可为本 run 指定**第二个只读 endpoint**——它只看图产逐屏结构化评审，物理上不写工程；正式产物唯一写者
仍是主模型。两个旗标**成对必填**，单给任一即 fail-fast；值写入 manifest `visual_provider_pin` 并条件
进身份哈希，resume 只认冻结值（不重读个人配置），successor 出生输入可覆盖。优先级 **CLI > manifest
冻结值 > 个人级 `framework.local.json` 的 `vision.visual_provider`**。

**视觉能力不足不再使用人工盲跑 waiver**：`--allow-blind-visual` 已删除，新 manifest 不写
`allow_blind_visual`；旧字段只读兼容但无运行语义。运行策略只由冻结 requirement 的目标/严格度和
当前 capability facts 决定：`pixel_1to1 + hard` 等必需视觉能力不足时，在 content invoke 前投影
`DEFERRED_CAPABILITY_MISSING`；非 strict、非发布必需的视觉证据按既有 advisory/UNVERIFIED 策略继续。
配置合法 provider 后，新 run 可直接使用；当前 run 若要变更冻结 provider pin，仍按既有
`--visual-adapter` + `--visual-model` 与 manifest override 规则处理。

- **支持哪些 adapter 由 adapter catalog 派生**——运行时扫 `agents/<adapter>/adapter.yaml` 的
  `visual_provider` 完整声明；本文**不另写一份名单**（要看当前支持项，跑一次带不支持 adapter 的
  `--visual-adapter`，错误会列出）。
- 显式传了**不受支持**的 adapter → 启动处 BLOCKER fail-fast 并列出支持项；框架**不自动改选**、
  **不在多个 provider 之间 fallback**。
- 无人值守读到已失效/不可读的旧 local 配置 → WARN + 忽略；后续 requirement/capability preflight
  决定 defer 或按 advisory 继续，不询问、不自动改选。
- provider 调用失败/载荷不可信时：本轮视觉反馈降级为盲档，`visual_diff` 出 `{BLOCKER, SKIP}`，
  required 轴保持 FAIL/UNVERIFIED 并重试或 defer，optional 轴才可 advisory；不得伪造 PASS。
- 当前 attempt/hash/identity 绑定的 deterministic/native/delegated 机器证据直接决定视觉轴，
  不再要求真人逐屏签名。

```bash
# 只读视觉 provider 示例（主模型盲 + 第二个能看图的 endpoint）
cd framework/harness && npx ts-node scripts/goal-runner.ts \
  --feature <feature-slug> --requirement "需求" --adapter codex --adapter-model <coding-model> \
  --visual-adapter claude --visual-model <vision-model> --detach
```

```bash
# Chrys dry-run 示例
cd framework/harness && npx ts-node scripts/goal-runner.ts \
  --feature <feature-slug> --requirement "需求" --adapter chrys --dry-run

# OpenCode dry-run 示例
cd framework/harness && npx ts-node scripts/goal-runner.ts \
  --feature <feature-slug> --requirement "需求" --adapter opencode --dry-run
```

### 无人值守存活：`is_background` ≠ 活过会话（survival-first · 概念纠正）

宿主的"后台启动"（Cursor `is_background` / Claude Code `run_in_background`）只让 agent **立即拿回控制权**，进程仍是**会话内子进程**——宿主会话结束 / 活跃 agent 轮次收尾即被回收（2026-06 实测：`is_background` 直挂的 run 在轮次收尾被杀，`progress.json` 长期显示"运行中的尸体"）。**"拿回控制权" ≠ "活过我的会话"。**

故**无人值守一律用真 `--detach`**（真 OS 脱离：`detached:true`+`unref()`+stdio 落 `detach.log`），实测能**活过 Cursor 完全关闭再重开**。宿主有后台模式可叠加用来不阻塞 launcher，但**存活靠 `--detach`，不靠 `is_background`**。启动与存活结果以 launcher 返回的 `startup` 为准，调用方不追加握手：`failed` 报启动失败，其余三态按真实状态汇报。

**存活是环境属性**：会**整组/整树杀**进程的敌对宿主（部分公司沙箱 / CI；Node `detached:true` 不设 `CREATE_BREAKAWAY_FROM_JOB`，挡不住 `taskkill /T` / kill-on-close Job）下 `--detach` 也保不住，须用 OS 调度任务（cron / Windows Task Scheduler）托管 run。下面 chrys / opencode 是"阻塞型宿主"的具体落地。

**本次实测（2026-08-18，Windows Claude Desktop 工具环境；措辞仅限定该宿主环境，不概括"Claude Code 一律必死"）**：工具 shell、会话后端、detached 探针的 `IsProcessInJob` 全部为 `true`，且 `detached:true` 无法请求 breakaway——该环境下 `--detach` 的 runner 三次在宿主轮次交还后的延迟回收中被硬杀（无部分退出钩子足迹，进程整体消失）。教训：**只要宿主进程在 kill-on-close Job Object 里，--detach 就是临时存活；真无人值守必须脱离该宿主进程的生命周期**。

### 恢复路线分级（真无人值守 ≠ 用户终端临跑）

| 路线 | 级别 | 说明 |
|------|------|------|
| **Task Scheduler（推荐，真无人值守）** | `goal-supervise --install-schtasks --feature <f> --every-minutes 5` | OS 计划任务独立于宿主会话/进程树；supervisor 自愈（run 崩溃/被杀后按 beacon×run_disposition 决策自动 `--resume`，且在有 Job 守卫下确认旧 owner 死亡后才受控拉起）。**显式手动执行才安装**，框架绝不自动写持久计划任务；`goal-supervise --uninstall-schtasks --feature <f>` 卸载 |
| **用户自开终端 `--detach`** | 一次性临时路线 | 当前终端/宿主会话内能活（关闭启动窗口无碍），但**无 supervisor 自愈——run 崩了没人拉起**，宿主整树清理时也会被杀。适合"我看着这一轮 / 短任务"的临时场景，不写成与 Task Scheduler 同级保证 |

不做 **Job flags 运行时自动探测或自动路由**（探测≠保护；containment 才是保护）——宿主环境是否 kill-on-close 一律由上面这条人工分级决定，不自动判。

### 进程内等待（带探针的停机，plan 4e6fb3b6 §5）

有三种停机会先在进程里等一会，再停放：设备未就绪（设备 / 凭据探针）、能力预检缺口（`capability_preflight_ready`）、
候选写回不可用（`storage_ready`，只在写回本身出错时）。

- 最多等 15 分钟，且不超过剩余墙钟预算；每 30 秒探一次。探针就绪后由原来的检查（设备门、能力门、写回事务）确认，
  确认通过就在同一个 attempt 里接着跑，不占内容重试。
- 等到上限还没好，就照原来的方式停放，supervisor 据探针判断能不能唤醒：
  - 以 HALTED 收尾的 run（如能力预检缺口），`run_end` 带 `probe` 和 `probe_phase`；
  - 设备停放的 run 可能以 PARTIAL 收尾，这时 `run_end` 不带探针，探针留在停放那条停机事件上，supervisor 照旧从那条事件读。
- 有人在场（session owner）不等，立即交回会话。
- 探针就绪后、交原检查确认之前，框架先核 run 冻结的输入绑定：已失效就不在本进程里继续，立即停放（按超时收尾）；
  下一次重发或 supervisor 拉起时由启动入口起后继。
- 设计权威停机（见「设计权威出问题时」）也带探针，但不做这种等待：立即停放并释放 feature 锁。
- 事件：开始时一条 `condition_wait_started`；收尾时 `condition_wait_ready`（恢复）或 `condition_wait_timeout`（超时）二选一，只有一条。
- 代价：等待时间算进墙钟预算。设备长时间不可用时，会吃掉一部分本可用于修复的时间。

### supervisor 的适用范围

- **不默认启用**，框架也不会自动安装计划任务。只有你手动运行 `goal-supervise`（Windows 可用上表的 `--install-schtasks`）才有；
  `--detach` 不带它。
- 只看两件事：进程是否还活着、run 的处置状态。不做业务裁决。
- 会拉起：进程已死且状态可续跑；或在等外部条件、带探针且探针已就绪（来源可以是停机事件，也可以是带探针的 `run_end`）。
  它只负责拉起（发出的始终是对这个 run 的 `--resume`），自己不做判断；被拉起的 runner 用和"重新发起同一请求"相同的那一处判断
  决定：冻结的输入绑定仍有效就继续这个 run，探针就绪但绑定已失效就改为起后继并承接它。
- 不拉起：结构终局、等人的 run；owner 是会话的 run（有人在场，任何状态，含已停放且探针就绪——只能由会话重新接入或操作者接管）；
  run-control 缺失或损坏、owner 正在收尾或交接未完成的 run。
- 本轮暂不拉起、下一轮再看（不写事件）：该 feature 的锁被别人持有——run 正在跑，或同蓝图的无人值守设计修复正在进行
  （supervisor 写事件和决定拉起都要先取这把锁，拉起前放锁）；退避等待期间另一轮 supervisor 已经拉起过（重启序号变了），本轮让出。
- 重启上限 3 次（退避 30 秒起翻倍，最多 10 分钟），按任务累计：本 run 加上同一交付周期内
  被它承接的 run 上已记的次数，起后继不清零；已完成的 run 属于上一个交付周期，不计。用完后不再自动恢复。
- 进程崩溃后的无人自动拉起**仍要你手动启用 supervisor**；没启用时，重新发起同一请求即重新接入（算一次人工操作）。

**迁移说明（旧 run 带 `successor_required`）**：2026-08-08～09-05 之间打的 3.0.0 包可能在停机事件里写
`successor_required` 或 `successor_start_phase`。supervisor 不再按它们起后继，而是恢复同一个 run，旧的起点字段不再生效；
恢复仍受当前的各项检查和重启上限（3 次）约束。要换起点或放弃旧 run，按「停机之后怎么继续」重新发起请求，或显式 `--supersede`。

### 已知代价（plan 4e6fb3b6 §12）

- cursor 与 opencode 的瞬时错误（限流、服务端 5xx）识别不出，按既有路径处理；codex 的 401 / 403 / 429 / 5xx 没有真实样本，
  按 400 信封形状加状态码识别，实际形态不同时同样落回既有路径。
- 框架发布件更新本身不算"变化"（见「停机之后怎么继续」）。
- 起后继会删掉被承接 run 的场外信任状态。
- 补了授权、做了人工确认这类事不算七种变化（停机带探针且探针已就绪的除外）：无人值守的调用在正式开始过的 run 停下不到 5 分钟时要等冷却过去再重发（`--force-resume` 也不能越过）；有人在场的调用不等。
- 重发时框架会跑一次停机所挂的探针（只读）。设备探针有耗时，没有做缓存。
- 启动期被恢复守卫或冷却拒绝（显式 `--resume` 时）、或启动期未处理异常退出时，这次启动的耗时（含至多一轮金丝雀探测）不计入预算。

### 从无后台能力的宿主 shell 启动（chrys / opencode TUI 等）→ 必须 `--detach`

当**编排 agent 自己**（如 chrys TUI 的内置 shell 工具）去启动 goal-runner，而该 shell **仅阻塞、有超时上限、无后台模式**时：直接跑会秒级超时 → runner 变孤儿后台续跑 → agent 误判超时又重复起 run → 子进程互杀（chrys 实测）。**加 `--detach`**：

```bash
cd framework/harness && npx ts-node scripts/goal-runner.ts \
  --feature <feature-slug> --requirement "需求" --adapter chrys --detach
```

- launcher fork 后台 child，完成自身有界启动确认后打印一行 JSON（`{detached, run_id, report_dir, log, pid, startup}`）；`startup=failed` 时非零退出，其余状态干净返回，**不等待任务终局**。
- child 的 stdio 重定向到 `report_dir/detach.log`，**不继承宿主 shell 的管道**（否则宿主 `communicate()`/阻塞读会一直等到 child 关 pipe，反而拖到超时杀树）。
- 解析 launcher JSON 取 `run_id` 与 `startup`，按 `ready` / `terminal` / `alive_timeout` / `failed` 准确汇报后交还轮次；调用方不再重复握手。`--detach` 同样兼容 `--resume <run-id> --feature <f> --detach`。
- 适用前提（实测，chrys `foundation/platform/process.py`）：宿主 shell 用 `CREATE_NEW_CONSOLE` 而非 kill-on-close Job Object，且**仅在超时/取消时杀树**——故 launcher 干净退出即可让 detach 存活。

**监控口径（chrys/opencode 无流式）**：`phases/<phase>/agent-output.log` 在 phase 结束前**恒为空**——活性**只**看 `goal-status` / `progress.json` / events 心跳（每 ~60s 一拍），**禁止** tail `agent-output.log` 判断卡死。

## 运行中进度（progress / monitor 契约）

事实源：`events.jsonl`（append-only）。派生快照：`progress.json` / `progress.md`（可重建）。

```bash
cd framework/harness && npx ts-node scripts/goal-status.ts \
  --feature <feature-slug> --run-id latest --json
```

launcher 已使用 manifest、本次新增 events、liveness 与 progress 完成**有界启动确认**；主 agent 只消费返回 JSON 的 `startup` 四态并汇报 `run_id`、进度路径和续查命令，然后**结束当前轮次**。不得再用 `sleep` / `for` / `grep events.jsonl` 重复握手或等待 phase/verdict/run_end；仅当用户明确要求盯守时才进入 bounded monitor：

```bash
cd framework/harness && npx ts-node scripts/goal-monitor.ts \
  --feature <feature-slug> --run-id <run-id|latest> \
  --since-event <last-seen-event-index> \
  --max-seconds 240 --markdown
```

调用 `goal-monitor --max-seconds N` 时（仅在 opt-in 盯守实际调用时适用），宿主 shell/tool timeout 必须显式设置为 `> N`（建议 `N + 60s`；`--max-seconds 240` 时至少 300s）。不要依赖 Claude Code Bash 等宿主工具的默认 timeout；若宿主无法提升 timeout，就把 `N` 降到安全值。

| 入口 | 用途 |
|------|------|
| `progress.json` | IDE/插件/CI 文件 watch |
| `goal-status --json` | 无法直接解析路径时的命令契约；**实时重算** liveness + `generated_at` 新鲜度降级 |
| `goal-status --markdown` | agent 向用户汇报 |
| `goal-status --watch` | **仅供人在终端**；agent 勿跑常驻 watch；可加 `--max-ticks N` 限制轮询次数（测试/脚本用） |
| `goal-monitor --markdown/json` | **仅 opt-in 盯守用**；边沿触发、最多等待 `--max-seconds`、输出一次通知后退出。**不得当状态查询**（默认游标 -1 会重放最早历史 verdict）——状态查询唯一入口是 `goal-status` |

**新鲜度降级**：非终态快照若 `generated_at` 超过 heartbeat 间隔 2–3 倍，不得信任 raw `status: RUNNING`（后台 terminal 随 IDE 会话回收会留下谎报）。终态快照（`COMPLETED`/`DEFERRED`/`PARTIAL`/`HALTED`）不降级。

`goal-monitor` 是纯读取器：它不启动、不续跑、不杀掉、不修改 goal-runner；被宿主 timeout 杀掉无副作用，下一轮可重新调用。它的通知事件包括 `phase_verdict`、`run_end`、硬 liveness 异常，以及低频 ACTIVE heartbeat 摘要。heartbeat 摘要按事件时间累计 `SOFT_STALL_MS = 10min` 判断并去重，不按本次 monitor 调用等待时长判断。

跨轮次接管：若主 agent 轮次中断，新轮 agent 应从 run 目录重新读取 `events.jsonl` / `goal-status` 推导当前状态和最近 verdict；不要假设内存里的 `last_seen` 仍可靠。第一版 framework 脚本不提供跨轮次聊天唤醒；真正 push/wakeup 属于宿主或 adapter 增强（如 Claude `ScheduleWakeup` / cron 等宿主调度能力）。

**不要**把 `agent-output.log` 正文或 runner stdout 日志当协议；stdout 里程碑行 `GOAL_PHASE` / `GOAL_RUN` 是受维护的轻契约和可选加速器，不是通知 SSOT，且仅限**当前轮次、非 detached、stdout 仍由宿主持有**的路径（`--detach` 下 runner stdout 已全部重定向进 `detach.log`）。

## Headless 阶段内闸门（§9）

goal-runner 向每个 phase agent 注入 **Unattended execution** 块（SSOT：[user-confirmation-ux.md §9](../../skills/reference/user-confirmation-ux.md)）：

- 阶段内确认闸门（术语 `[x]`、ui-spec verified、enum/gate 等）**自动解析 + 留痕** `doc/features/<feature>/<phase>/headless-assumptions.md`。
- glossary 命中 → high 自动解析；新术语 → medium/low + legacy `must_review` 审计标记（goal-report 顶部清单，不参与门禁）。
- `freeform_approval`（scope 扩展、改源码）→ **保守默认**（不扩 / 不改），记录推迟请求。

### 防御纵深（盲目重试）

| 机制 | 行为 |
|------|------|
| **无进展守卫** | 同一 phase 连续 attempt：`deterministic_gate_or_artifact_missing` + 相同 blocker 签名 + 产物 delta 零（存在性/内容 hash，**非 mtime**）→ 立即 HALT |
| **指纹级熔断（f7a3d9c2）** | testing 视觉迭代：check 比对 `visual-rounds.ledger.jsonl`，连续两有效轮缺陷指纹集相等且仍有 loop-actionable 残差 → `failure_kind=no_progress_fuse` **首触即 HALT**（不烧重试预算；归因 `no_fix_attempt`/`ineffective_fix` 在 blocker details；duplicate 重放保证 agent 自跑首检的 fuse 外层 gate 仍可见）。与旧 `no_progress_visual_gap`（blocker-id 粗粒度签名熔断）并存：fuse 更细更先触发，signature 熔断留作兜底 |
| **账本完整性（f7a3d9c2）** | testing gate/resume 启动时 events↔ledger 反向对账：期望行缺失/被改（含 decision）→ `visual_ledger_integrity` HALT——删账本行绕不过熔断，损坏不解释成空历史（运行时一致性防护，非密码学防篡改） |
| **chrys sentinel** | `agent-output.log` 逐行 JSON 命中 `code=headless_interaction_required` → 立即 HALT + `agent_interaction_required` 事件 |
| **重试上下文** | 产物缺失类失败不注入「先 revert」话术；仅 `code_regression` 保留 revert-first。testing 的可信根失败非空且全为 `test_contract` 时，后置精修并跨 retry/`--resume` 恢复该分类，prompt 只检查 selector、ui-spec、测试锚点或 runner 契约，禁止据此修改产品源码 |

events 字段：`failure_kind_classified`、`blocker_signature`、`halt_reason`、`interaction_question`；f7a3d9c2 新增 `visual_round`（loop_id/visual_attempt/row_hash/disposition/fused——账本回执，integrity 对账期望集）与 `critic_receipt_produced`。轮次身份：runner 对 agent 与 gate 双注入 `MAISON_GOAL_RUN_ID`/`MAISON_GOAL_ATTEMPT`（attempt=events 回放的 invocation 序数，跨 `--resume` 单调，绝不用 phase 内 retries 计数）。

## 宿主侧实机冒烟（chrys，跨机器）

本仓开发机可能无 chrys；以下步骤须在 **真 chrys 宿主**（如 HarmonyOSDemo + framework）执行，结果回填 plan 实施记录。

```bash
# 0. Tier_1 + personal setup（goal-mode Skill 前置）
cd framework/harness && node ../scripts/init-readiness.mjs
npx ts-node scripts/check-personal-setup.ts --json --ensure --select-adapter chrys --project-root <repo-root>

# 1. 核实 chrys 非交互 flag（Layer C）
chrys run --help   # 记录是否有 bypass/非交互 flag，反馈维护者

# 2. 仅 spec 单 phase 冒烟
npx ts-node scripts/goal-runner.ts \
  --feature <feature-slug> \
  --requirement "<需求摘要>" \
  --adapter chrys \
  --start spec --end spec \
  --detach

# 3. 验收（run 结束后）
# - agent-output.log 无 headless_interaction_required
# - doc/features/<f>/spec/spec.md 存在且含 section 0 [x] + 正文
# - spec/reports/summary.json verdict=PASS
# - doc/features/<f>/spec/headless-assumptions.md 含 must-review 清单（如有 medium/low 术语）
npx ts-node scripts/goal-status.ts --feature <f> --run-id <run-id> --markdown
```

失败时查 `goal-runs/<run-id>/goal-report.md` 的「外部输入或权限」段与 `events.jsonl` 的 `agent_interaction_required`；仅真实外部前置条件允许停放，质量问题不得由人工确认放行。
