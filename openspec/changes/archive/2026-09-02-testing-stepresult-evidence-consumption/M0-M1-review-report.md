# M0 + M1 综合修复报告（plan a6c4e9f2）

- 日期：2026-08-31
- 范围：Maison M0 全部 + M1（Phase 0 契约落位、typed consumer 基座、0.3-p0 守卫整体迁移）+ T7b 第一步（vendor 接入 0.5.0）
- 关联 plan：[`testing回灌纠偏_入口可达性与首失败归因收口_a6c4e9f2`](../../../.cursor/plans/)
- 关联 change：本 change（testing）+ [`framework-identity-boundary`](../framework-identity-boundary/)（framework 身份/发布边界）
- 状态：**未提交**。未运行宿主设备动作、未打发布包、未安装 Phase 0 契约包、未改 Hylyre 源仓。

> 给 reviewer 的读法：§1 是四条根因与对应修复；§2 是逐项证据；§3 是**刻意没做**的事与原因；
> §4 是仍开放的风险；§5 是验证口径与数字。若只看一节，看 §3——那里是本轮所有"看起来该做
> 但故意没做"的决定，也是最需要被挑战的部分。

---

> **[2026-08-31 · 两轮返修，见 §7（两条 P0 + 四条 P1）与 §8（返修后 review 的四项 P1）]**
> 外部 review 指出本报告原结论过早：信封升到了 v1，**内核仍是 0.3**。我用生产代码实测全部复现，
> 随后在同一轮内修完并复验。§1–§6 写于返修之前，**凡"已收口"表述以 §7 为准**。
>
> 一句话概括当时的状态：`requireV1ForGate` 只判信封，`device-test-run` 只认 0.3 flat 步骤，
> 于是**合法 v1 被拒、混装体反而更容易被当 native**；两道 required gate 又恰好在
> `evidenceGate.native=false` 时静默 `return []`——最需要它们的时候正好没有它们。

---

## 1. 四条根因与修复

事故来源：2026-08-31 宿主 `SimulatedWalletForHmos` / `bc-openCard-1` / run `20260830T164617Z-771`
的首次 Hylyre 0.4.1 真机回灌。一次真实的根失败被放大成 70 个 BLOCKER，14 个执行 case 全部级联失败。

| # | 根因 | 修复方向 |
|---|------|----------|
| A | 静态 lint 把**不完整的 feature ui-spec 当封闭白名单** | 恢复开放世界：缺席只 WARN，静态只拦可确定错误 |
| B | 派生器拥有**自由 skip 权**，把不会做的入口塞进 `explicit_skip_tc_ids` | 执行责任上移到顶层 `execution_channel`，派生器无 skip 决策权 |
| C | `collectHylyreFailureRoutes` 把**所有非 passed 都路由**，1 根失败 → 70 条 BLOCKER | 只有实际尝试且实际失败的 step 产生 responsibility route |
| D | `framework_integrity` 用**事后 hash 代替身份隔离**，一族状态与恢复分支 | 写权限交给模型外安全主体，runtime hash 家族退场 |

A/B/D 属 M0 已实施；**C 的 v1 实现已落地并已接线**（0.3-p0 守卫整体迁移见 §2.8）。

---

## 2. 逐项修复与证据

### 2.1 A — selector 静态门恢复开放世界（T2 静态部分）

**改了什么**：[`selector-contract.ts`](../../../profiles/hmos-app/harness/selector-contract.ts)

- `by_id` / `by_text` 不在 feature ui-spec → 从 BLOCKER 降为 **provenance WARN**，允许进入 runtime；
- 保留 BLOCKER 的**只有可确定错误**：非法/缺失 `match`、ui-spec 已证明的**同屏**多映射无消歧、
  `contains` 只命中带 children 的聚合 Text/Row；
- 新增唯一一条散文外冲突判据：同一 checkpoint 结构化绑定的 `target_element_id` 与计划 `by_id`
  明确不等。**双向唯一**才成立（行只关联一个 AC × 该 AC 只有一个非空 target × case 只有一个带
  `by_id` 的 action step），任一侧不唯一即视为无绑定 —— 宁漏报，不猜。

**两处 review 纠偏**（都被既有测试打回后收紧）：

1. 我第一版把"同屏多映射"实现成"当前 screen 已知"，误伤了**单屏内多候选**（前置条件没点名 screen
   时也该是确定错误）。最终判据：`候选全部落在同一 screen && 数量 > 1`。跨屏重复且 screen 未知 →
   WARN（静态资料不足，交 runtime）。
2. AC id 词法原用本地 `/AC-\d+/`，会漏 `AC-G1` 等形态导致冲突判据静默失效。已复用
   `extractAcceptanceIdRefs` 这一词法 SSOT。

**未做**：不构建 `ui-spec ∪ acceptance ∪ contracts` 白名单并集（plan D1 明确否决）。

### 2.2 B — 执行通道与 skip 退场（T3）

**新增** [`execution-channel.ts`](../../../harness/scripts/utils/execution-channel.ts)：顶层 `test-plan.md`
每 TC 声明唯一 `execution_channel`，值域冻结 `hylyre | visual | manual | provider:<capability-id>`。

关键约束：

- 缺列 / 缺值 / 非法值 / **同 TC 多行** 一律 BLOCKER 一次性迁移，**不按用例名、优先级、步骤散文猜通道**；
  重复行即使取值相同也拒（重复本身证明不了唯一），且重复 TC 不进任何通道集合；
- 声明在**任何 build/install/Hylyre/device 动作之前**解析一次，不闭合即零设备动作，
  **也不跑"合法子集"**（那会产出半份 trace）。准入判据抽成纯函数 `shouldRunDevicePipeline`，
  测试锁的就是生产判据本身；
- 派生器只编译 `channel=hylyre` **全集**，不得新增/删除/改写通道，不再产出 `explicit_skip_tc_ids`；
  已声明通道的计划里若仍有 explicit skip → 直接 BLOCKER；
- 新增 `STEP-SETUP`：每个 hylyre case 首个 assertion 前必须有同 case 的 action。这是 D4 的结构
  最小规则，**不解析 precondition 散文、不推导跨 case screen state、不建可达性状态机**；
- `evaluateChannelDerivedCoverage`：explicit skip **不再减除缺口**；
- derived/trace/timing 精确集合只与 `channel=hylyre` 闭合，非 Hylyre TC 不再被误报"缺 trace"，
  报告总分母仍覆盖全部顶层 TC。

**fail-closed 兜底（review P0 补）**：非 Hylyre 通道被移出精确对账后，若不给裁决载体就成了新逃生口。
`testing_channel_evidence_obligation` 对 manual/visual/provider **一律 FAIL/UNVERIFIED**，理由分层写清：
manual 是冻结设计无机器 PASS 载体；visual/provider 是 **per-TC 证据绑定尚未建立**（Maison 目前没有
TC→visual target、TC→capability evidence 的机器映射）。绑定工作登记为 tasks 6.5b 未完成项。

### 2.3 C — 首失败归因（T4，已实现并已接线）

**新增** [`hylyre-failure-routing-v1.ts`](../../../harness/scripts/utils/hylyre-failure-routing-v1.ts)，基数不变式：

| 形态 | route | disposition |
|---|---|---|
| 1 failed + 4 blocked/prior_step + 1 policy skipped | **1** | 0 |
| 冻结包 `bc-opencard-1` 真数据（事故那一轮） | **1** | 0 |
| blocked/capability 根 + 2 prior_step | 0 | **1**（不按引用次数重复） |
| blocked/infrastructure 根 | 0 | **1** external |
| failed/capability | 1（自带 capability defer、零 coding） | — |
| 两个真实 failed | **2**（无 first-only 去重） | 0 |
| 只有 diagnostic、无 probe facts 的 capability cause | 0 | **0** |

wrong-screen 准入：`assertion.mismatch` 只有在同 case 存在**较小 index 且实际 passed 的 action**
时才可 `codingCandidate=true`；否则留 testing、零 coding。不从 diagnostic/precondition 猜屏幕状态。

`verifyPriorStepReferences` 复算 Schema 表达不了的跨行不变量（同 case、更小 index、目标必须是真实根、
禁链式、禁跨 case）。

**接线形态**：`checkHylyreFailureRouting` 现在产出**两类**结果——`testing_failure_routing_N`
（每个真实 failed 一条）与 `testing_cause_disposition_N`（机器证明的 blocked 根各一条，零 route）。
旧实现只有前者且把所有非 passed 都塞进去，这正是 70 个 BLOCKER 的来源。

### 2.4 D — framework 身份隔离与 runtime hash 退场（T6）

独立 change [`framework-identity-boundary`](../framework-identity-boundary/)，与本 testing change 分域，
显式 supersede archived `2026-08-12-consumer-framework-integrity-guard` / `consumer-write-guard`，
并登记与 active `runtime-policy-core` 为 **compatible 无冲突**。

> **2026-09-01 纠偏**：本节初版的 scoped Git dirty 方案已被真实发布件升级事故推翻，不再是现行设计。

最终结论：consumer per-file hash、manifest selfcheck、foreign-file、tmp hygiene、allowlist 与 scoped Git dirty/HEAD 身份读取全部从普通 init/phase 退场；新运行不生产 `framework_integrity` / `framework_control_plane_dirty`。相同发布件在 dirty、staged、committed、untracked、非 Git 宿主上必须得到相同 Maison verdict 与 package identity。

强隔离由 task sandbox/只读挂载/受限 OS token/ACL 提供；同一 Windows 用户降级环境只保留合作式 Write/Edit 守卫并承认 shell/脚本/场外进程盲区，不再声称有查时 detector。package version/source_commit/built_at/manifest SHA 只作非阻断展示；发布/明确集成边界继续验包。`docs/vendor/**` 继续移出 consumer 发布件。

### 2.5 M1 —— Phase 0 契约包与 typed consumer 基座

**契约包身份**：`harness/tests/fixtures/hylyre-contracts-0.4-p0/`，
`tree_sha256 = cc738c272324022d7ed559340e9c710f9b7f5f94aac62c5dd70042e827a21bae`，226 文件。

落在 `harness/tests/fixtures/**` 而非 vendor 下：包自称 `not_a_release: true`、无 `pyproject.toml`、
无运行时模块，明确"不得安装"；而该路径已被 `release-excludes.json` 排除，不会误入 consumer 包。
它**不碰** `vendor/hylyre/src/**`（仍是 0.4.1 运行时源）。

**交接期间三次重切，全部留痕**（`e0833814`/223 → `a047d52e`/225 → `623d6c5f`/225 → `cc738c27`/226）。
其中第一次的交接哈希对不上是我发现的真差异：用户给的是**修订前**的包，而 Hylyre 在 Phase 1 实现中
发现 `selectorSelectedV1.id` 要求非空使"纯文本匹配命中的 id-less 节点"不可表达，按 freeze rule
四件资产同批修订。因此新增 [`hylyre-contracts-freeze.unit.test.ts`](../../../harness/tests/unit/hylyre-contracts-freeze.unit.test.ts)：
按 manifest 自述算法复算 tree 指纹，**包被换掉或就地改一个字节即红**。靠人记指纹不可靠，这是实证。

**三个新模块**：

| 模块 | 职责 |
|---|---|
| [`hylyre-result-protocol.ts`](../../../harness/scripts/utils/hylyre-result-protocol.ts) | 统一 `(schema_version, result_protocol)` dispatch + D1 selector 身份判据 |
| [`hylyre-failure-routing-v1.ts`](../../../harness/scripts/utils/hylyre-failure-routing-v1.ts) | T4 基数不变式 + Q8 跨行校验 |
| [`hylyre-artifact-resolution.ts`](../../../harness/scripts/utils/hylyre-artifact-resolution.ts) | Q5 按 trace 目录解析 + 逃逸检查 + sha256 + §8.1 failure-boundary |

dispatch **三态，没有第四种静默不适用**：v1 → typed 消费；`0.3-p0`/`0.2-p4`/`0.1-p0` →
legacy-unsupported（只允许非阻断诊断）；其余 → 显式 BLOCKER。不返 `[]`、不 SKIP、不 no-op、
不回退中文 status / flat 字段 / `tool_calls` / 日志 / 退役 telemetry。

两条额外 fail-closed 是我加的：`0.4-p0` 但 root/environment 的协议声明对不上 → `unsupported`
（产出方自己不自洽比未知更危险）；legacy schema 却带 `result_protocol` → 拒绝消费（混装产物）。

### 2.5b Hylyre Phase 1（0.5.0 真实 source）交付核验与 vendor 接入

Hylyre 于 2026-08-31 交付三件发布物并 review 通过。Maison 侧先做只读核验，随后经用户授权完成 vendor 接入。

**三件发布物与 Maison 的关系**：

| 形态 | Maison 用途 |
|---|---|
| wheel `hylyre-0.5.0-py3-none-any.whl` | **用不上**。Maison 走 plain-source vendor（宿主仓禁提交二进制工件）；`profiles/*/vendor/**/*.whl` 本就在发布排除内 |
| source（309 文件，tree `351f61ab…1380`） | 已 vendor 进 `profiles/hmos-app/vendor/hylyre/`；真机执行与 T7b conformance 的载体 |
| contracts freeze（226 文件，tree `cc738c27…1bae`） | M1 的契约与 fixture 唯一真源，落在 `harness/tests/fixtures/` |

| 项 | 值 | 核验方式 |
|---|---|---|
| source 交付物 | `D:/1.code/Hylyre/dist/release-src/`（`src/`，309 文件） | per-file 309/309 相符；缺失 0；未登记 0 |
| `source.tree_sha256` | `351f61ab7c93…1380` | 按 manifest 自述算法复算一致 |
| `contracts_tree_sha256` | `cc738c272324…1bae` | 复算一致 |
| `hylyre.__version__` | `0.5.0` | 源码内确认 |
| `result_protocol` | `hylyre.step-outcome/1` | 在 `hylyre/contracts/__init__.py`、`hylyre/harness/runner.py` 声明 |

**关键证明已从预期变成实证**：fixture README 原先写的「发布件逐字携带这些契约」是一条待验断言。
现从 `src/hylyre/contracts/` 逐文件重算，**226 / 226 与已落位冻结包逐字节相同**，
只在 source / 只在 fixture / 内容不同**均为 0**，重算 tree 等于 `cc738c272324…1bae`。
即 Maison 的 M1 消费实现所对的靶子，与 0.5.0 发布件将要携带的契约是同一份字节。

核验刻意不采信 manifest 的自我声明 —— `contracts_tree_sha256` 字段本身也是被验对象。

**vendor 接入（T7b 第一步）**：`profiles/hmos-app/vendor/hylyre/` 从 0.4.1（schema 2 / 82 文件 /
tree `02f4eb63…2146` / 无 `contracts_tree_sha256`）整体替换为 0.5.0。接入后三方闭合成立：
vendored contracts 重算 = manifest 声明 = 冻结包指纹，且 226/226 与 fixture 逐字节相同。
**wheel 未引入**，实测 `classifyPath` 对误放的 wheel 返回 `include=false`。

**被覆盖的旧 vendor** 先逐文件核算并备份，随后经用户确认不需要而删除（详见 §4.5）。

接入暴露并修掉两处——都是"vendor 真的换了"才会出现的：

1. **唯一一条真正执行 vendored source 的单测**（vendor fake runner 端到端）原断言 `0.3-p0`。
   现改为断言 v1，并新增三项：产出能被 Maison 统一 dispatch 接受、每个 step 的归因都在
   `outcome` 内、不再有 flat `failure_kind`/`failure_code`。这条的价值是**证明发布件真的跑出
   v1**，而不是只有契约文档这么说；
2. `hylyre-keyset-consistency` 的版本三方比对（manifest ↔ `hylyre-planned-step-keys.ts` 头注 ↔
   `hylyre-planned-step-fields.md` 版本节）随之同步到 0.5.0。

**冻结包与发布件的分工**（reviewer 常问）：M1 的全部消费逻辑与回归**只需要冻结包**——它是契约
与 golden fixture 的真源。发布件只在三处必需：① 真机回归（T8）；② T7b 的"真实实现是否符合冻结
契约"conformance；③ 上面那条跑 vendored fake runner 的端到端单测（纯本地，不需要设备）。
wheel 则任何环节都用不上。

### 2.5c 0.3-p0 守卫整体迁移（M1 收口）

统一判据：所有 required gate 走 `requireV1ForGate()` —— **三态且没有第四种静默不适用**。
inventory §一/§二 的 12 处字面守卫 + 6 处隐式 fallback 各自 `return []` 的写法已全部消失，
逐条落点见 inventory §十。三处最危险的 fail-open：

- **G4** `testing_case_execution_completeness`：schema 不匹配就 `return []`，这道 required gate
  会**整体消失**。现在 trace 缺失 / 协议不可消费 / gate 未通过 三种情形都产 BLOCKER。
- **G5** `evaluateRuntimeSelectorGate`：同型 `return []`。旧模块已删除，替换为 v1 门。
- **F5** `if (!evidenceGate?.native) return []`（routing / selector / telemetry 三处）：
  两个 required 门改为显式 BLOCKER，telemetry 一致性诊断随过渡桥退役。

**G8 的中文 status 回落**：`evaluateHylyreRunOutcome` 原本在 schema 不是 0.3-p0 时回落读
`失败/阻塞/跳过/通过` 判 run outcome —— plan T5 第 20 条点名的 legacy fallback。现改判 dispatch。

**G10 版本门必须同批提升**（否则两者互斥）：`MIN_NATIVE_HYLYRE_VERSION` 0.4.1 → **0.5.0**、
`NATIVE_TRACE_SCHEMA_VERSION` 0.3-p0 → **0.4-p0**，新增 `NATIVE_RESULT_PROTOCOL` 判据
（root 与 environment 都必须声明且一致），`0.3-p0` 并入 `LEGACY_TRACE_SCHEMA_VERSIONS`。

**一个前置 bug**：`parseHylyreTrace` 原本**丢弃** `result_protocol`。dispatch 的两个判别键
必须都能被解析出来，否则任何 parse 之后的判别都会把合法 v1 误判成"缺协议"。已补字段并原样保留。

**删除的模块与用例**（留着就是两套协议并存）：旧 `hylyre-selector-gates.ts`（含封闭世界分支）、
旧 `hylyre-failure-routing.ts`（含 D3 的"非 passed 即路由"）、`checkNativeTelemetryConsistency`、
`loadBoundNativePlanContext`，以及三个被 v1 套件取代的用例。

**我先前把爆炸半径估高了，这里更正**：§3 早前写过"`testing-stepresult-evidence` 19 例、
`testing-trace-gates` 18 例等要整体改写"。实际切下去**只有 3 条失败**，迁移全程共处理 8 条，
**全部是 fixture 信封升级**（0.3-p0 → v1、0.4.1 → 0.5.0），没有一条是设计问题。

### 2.6 D1 selector 判据（plan 已按裁决修订）

冻结包 §6.1 规定 native provider 侧解析时，身份不可见的形态（典型 `by_text`）合法产生
`passed + resolution=not_attempted`。而 plan §2.1 原文把 `unique && candidate_count=1 && selected.id`
写成**所有** selector 成功的统一硬条件 —— 照原文实现会**误杀整片 by_text**。

裁决：契约是对的，plan 落后于契约（native 表禁止"身份不可见时报 unique"，背后是反回填原则，
与杀死 0.4.1 `selected_id=请求id` 那个病同源）。已先改 plan（9 处）与 active change（9 处）再动代码。

最终判据：

1. 成败由 `outcome` + `observation` 裁决；`selector.resolution` 是**身份事实**，不是第二个成功状态；
2. **不得**写成按 `request.kind` 的固定旁路 —— 语义取决于执行路径（native `by_id/by_key` → `unique`
   带结构化身份；native 身份不可见 → `passed + not_attempted`；resolver 自己解析文本节点 →
   `by_text` 也可 `unique`，`id=null` + `bounds≠null` 合法）；
3. `unique` 严格：`candidate_count=1`、`selected` 非空、`id`/`bounds` 至少一个非空、
   **禁止把 `request.value` 回填成 `selected.id`**；
4. `not_attempted` = 无身份证据：不改判 passed，也不给 identity credit；
5. `not_found` 是 resolver 确认零候选的事实，**通过的 absence 断言**正是该形态；
6. ui-spec miss 仍只 WARN；
7. **身份护栏**：P0 required/forbidden 的身份必须由 `by_id` 断言承载，`by_text` 的 observation
   成功不得替代身份证明 —— 防止把 identity binding 洗成文本断言。

### 2.7 Q5 / Q8

- **Q5**（artifact 相对基准）已冻结为「承载该 StepResult 的 authoritative trace 文件所在目录」，
  **不存在第二套隐含基准**。Hylyre 实测确认 producer 原先把 failure 目录挂在 `--report-out` 旁，
  两个 out 目录不同时 trace 定位不到自己的证据 —— 因此消费侧**刻意不实现任何 fallback 搜索**，
  否则会把这类 producer 回归重新盖住。测试用 `process.chdir` 到无关目录证明解析不依赖 cwd；
  七种逃逸形态全拒；capture-unavailable 分支额外要求 case `evidence=incomplete`
  （否则等于"既不取证又宣称证据完整"）。
- **Q8**（多 failed 时 prior_step 指向）已裁决为：可引用同 case 内**任意**更早的 eligible real root，
  不要求最近根；协议不引入 root-selection 状态/排序/去重。冻结包的钉死 fixture
  `prior-step-references-an-earlier-root.json` 已接进回归，断言 `referenced == min(roots) && != max(roots)`
  —— 若哪天误实现成 nearest-only，这条立刻红。

---

## 3. 刻意没做的事（最需要 review 的部分）

| # | 没做 | 原因 |
|---|------|------|
| 1 | ~~没把守卫切到新基座~~ → **已完成**（§2.5c） | 该项已不再是"没做的事"。实际爆炸半径远小于我先前的估计：只有 3 条失败、全程 8 条 fixture 信封升级，无设计问题 |
| 2 | **没实现 visual/provider 的 per-TC 证据绑定** | Maison 目前没有 TC→visual target、TC→capability evidence 的机器映射。在建立之前一律 fail-closed，而不是假装已接入、也不是把 visual 永久等同 manual。登记为 tasks 6.5b |
| 3 | ~~没动 `evaluateRuntimeSelectorGate`~~ → **已完成**：旧门删除、v1 门接线 | M0 阶段申报的"开放世界只修好一半"耦合风险已闭合：静态 WARN 与运行时不做封闭世界判定现在是同一批落地的 |
| 4 | ~~没做 vendor 接入~~ → **已完成**（§2.5b）；**T7b 其余部分与 T8 仍未做** | vendor 接入经用户授权完成。T7b 剩余：用真实 Hylyre 输出跑 real plan / fake / steps-file 关键入口 conformance + atomic/MCP/session 各一条 smoke + pre-run reject 复验（tasks 6.7b）。T8 是宿主动作，等用户单独触发 |
| 5 | **没执行 canonical `runtime-step-evidence` 的回滚** | 见 §4.1，需要 `git checkout --` 丢弃**不是我做的**未提交改动，超出授权 |
| 6 | **没改 plan 正文的其它部分** | 只改了用户明确授权的 D1 selector 判据主题（9 处）、submodule 措辞（2 处，另经授权）与 frontmatter todo status |
| 7 | **没做 6.6b：repair-candidate/summary 侧的基数复核** | routing 已换成 v1 的 route + disposition 两类产物，summary blockers 与 repair 预算需按新形状复核一遍，避免旧假设残留 |

---

## 4. 仍开放的风险与待决项

### 4.1 canonical `runtime-step-evidence` 分叉（回滚已执行）

`openspec/specs/runtime-step-evidence/spec.md` 有**未提交的手改**（在我接手前就是 `M` 状态），
两条需求被改名、第三条被整体重写，而 active delta 仍以 HEAD 的旧名做 `## MODIFIED`：

| | HEAD（`ccc51c15` 归档态） | 工作区 canonical | active delta |
|---|---|---|---|
| A | `Runtime step telemetry capability...` | 改名 → `Native runtime evidence capability...` | `MODIFIED` 用旧名 |
| B | `P0 checkpoint execution...` | 内容改写 | `MODIFIED` ✅ |
| C | `Declared support with missing or invalid evidence...` | 改名+改写 | **完全未收编** |

归档按需求名匹配，届时必撞车。已选定方案一（canonical 回滚到 HEAD、把 A/B/C 三条完整收进 delta、
沿用 HEAD 需求名、Enforcement 指向 Maison 消费侧而非 vendor python）。

**该回滚早已执行，不是待办**——写"待授权"是本报告的失实，纠正如下：canonical 现在与 HEAD
只差 **1 行**，即此前已被接受的悬空 enforcement token 删除
（`profiles/hmos-app/harness/hylyre-runtime-telemetry.py` 已不存在）。后来者请勿照旧文案重复执行。

### 4.2 硬阻断窗口（经 §7 返修后关闭）

曾经的风险：最低门提升到 `0.5.0` / `0.4-p0` 后，0.4.1 产出的 0.3-p0 trace 一律
`legacy_unsupported`，宿主 testing 硬阻断。

**该窗口的真正关闭时点是 §7 返修，而不是 vendor 接入**——写"随 vendor 接入关闭"是本节的
时间线错误，纠正如下：vendor 换成 0.5.0 之后，消费侧仍钉在 0.3 内核，合法 v1 反而一律被
native gate 拒绝，窗口当时并没有关。返修（删掉第二套步骤形状、parse boundary 接入冻结
schema + 跨行不变量）之后才真正关闭，并由那条端到端单测钉住：vendored source 的真实输出
既过 `requireV1ForGate`，也过 `evaluateHylyreNativeEvidenceGate`。

仍需 reviewer 知情的一点：宿主侧需要**重新 framework-init / 重装 Hylyre** 才能拿到 0.5.0；
在宿主完成升级前，它本地的 0.4.1 仍会产出 0.3-p0 trace 并被 required gate 显式拒绝。
这是升级动作的正常前置，不是缺陷。

### 4.3 T8 需知情的 by-design 后果

1. **已撤销**：updater 重铺后不再要求宿主提交。宿主 Git 状态与 Maison phase 无关；完整有效发布件覆盖旧 HEAD 后应直接通过适用 init/catalog 门禁；
2. `--report-reconcile-only` 跑历史 run 会吃到 `testing_execution_channel` 迁移 BLOCKER（phase 仍 FAIL），
   但只读重算**照常完整执行** —— 被拦的是设备动作，不是分析；
3. visual/provider 当前 fail-closed，意味着宿主 30 条里**只有 hylyre 通道能通过**。T8 指引必须明示：
   本轮要验证的 TC 全标 `hylyre`，标其它通道等于接受该 feature FAIL。

### 4.4 vendor 接入（已执行，保留记录）

接入前 `profiles/hmos-app/vendor/hylyre/` 是 **0.4.1**（manifest 82 文件，tree `02f4eb63…2146`，
无 `contracts_tree_sha256`），且 `src/` 下带 **28 项不是本实施会话产生的未提交改动**
（25 modified + 3 untracked，系此前 0.4.1 drop 未提交）。
**当前实况是 0.5.0**（`__version__ = 0.5.0`，manifest 309 文件）。

换成 0.5.0 source 会整体覆盖它们。按工作区纪律（禁止覆盖他人未提交改动），当时未动；
**用户已明确授权，本轮执行完毕**。替换前的旧 vendor（84 个文件，含那 28 项 `src/**` 改动的
当前内容）先备份并逐文件核算，之后经用户确认不需要而删除，核算见 §4.5。
核验按 Phase 0 收包同规格走完，结果见 §2.5b。

**vendor 接入不等于 T7b 完成**：T7b 还要求用真实 Hylyre 输出跑关键入口 conformance
（real plan / fake / steps-file）与 atomic/MCP/session 各一条 smoke，并复验 pre-run reject 的
stdout/exit/零设备/零 trace-report。已登记为 tasks 6.7b。

### 4.5 被覆盖的 0.4.1 vendor：已核算，经用户决定弃置

vendor 接入覆盖了 `profiles/hmos-app/vendor/hylyre/` 下 **30 个 git 里没有的文件内容**。
先逐文件核算，再由用户拍板处置：

| 类别 | 数量 | 能否从 git 恢复 |
|---|---:|---|
| 与 `git HEAD` 一致 | 54 | 能 |
| HEAD 有但内容不同（未提交改动） | **27** | 不能 |
| HEAD 完全没有（未跟踪文件） | **3** | 不能 |

那 3 个未跟踪文件是 `src/hylyre/api/selector_contract.py`、`src/hylyre/scenario/ledger.py`、
`src/hylyre/scenario/results.py`。与 §4.4 的「28 项」不冲突：28 是只数 `src/**` 的口径，
30 是整棵 vendor 树的口径——多出的两个是 `README.md` 与 `release.manifest.json`。

**处置**：备份先移出会话临时目录以免被自动清理，随后**用户明确答复不需要，已删除**
（2026-08-31，两份副本删净，仓库内外均无残留）。这 30 个文件属于此前那次「0.4.1 drop 未提交」；
若日后要找，从 Hylyre 源仓 0.4.1 历史取，但不保证逐字节相同。

**给 reviewer**：本节只为把「覆盖了什么、核算过没有、谁决定的」留痕，不是待办，也不是风险项。

### 4.6 已记录、不阻断的契约小差异

- `infrastructure` 细码冻结为 `transport_unavailable`，需求文写的是 `transport_failure`
  （Maison 按 domain 路由，无实现影响，但写死细码会踩空）；
- trace root 实际 `additionalProperties: true`，需求文 P0-12 说顶层默认关闭（协议对象确实关闭了，
  Maison 不依赖 root 封闭）。

---

## 5. 验证口径与结果

| 命令 | 结果 |
|---|---|
| `cd harness && npx tsc --noEmit` | PASS |
| `npx ts-node tests/run-unit.ts` | **3743 passed / 0 failed** |
| `npx ts-node tests/run-tests.ts`（fixture） | **46 / 0** |
| 生产代码残留 `schema_version === '0.3-p0'` 消费判据 | **0** |
| vendored source 自证（309 文件 per-file + tree） | PASS |
| `contracts_tree_sha256` 三方一致（vendored / manifest / 冻结包） | PASS |
| release 规则自检 + wheel 排除实测 | PASS（误放的 wheel `include=false`） |
| `npm run openspec:validate`（strict + enforcement 路径） | **45 / 45** |
| `node scripts/check-plan-version.mjs` | PASS |
| 改动文件 CRLF 扫描 | 全 LF |

本轮新增测试套件：

| 套件 | 例数 | 覆盖 |
|---|---:|---|
| `execution-channel` | 9 | 通道值域/唯一性/重复拒绝/设备准入/证据义务/STEP-SETUP/通道覆盖 |
| `framework package identity / boundary`（纠偏后重写） | 以最终 suite 为准 | 新运行零 Git/hash result、五种 Git 环境 identity/verdict 等价、legacy 只读、Write/Edit 守卫与盲区、迁移字段零 runtime advisory |
| `hylyre-contracts-freeze` | 3 | 冻结包指纹自证 |
| `hylyre-result-protocol` | 7 | dispatch 三态 + 不自洽/混装拒绝 + golden oracle + D1 判据 |
| `hylyre-failure-routing-v1` | 11 | 基数不变式 + wrong-screen 准入 + Q8 多根 |
| `hylyre-artifact-resolution` | 5 | Q5 基准/不依赖 cwd/七种逃逸/golden 扫描/§8.1 三分 |
| `hylyre-selector-gates-v1` | 6 | not_attempted 不误杀/不做封闭世界/bounds-only unique/回填冒充/absence 合法/失败不被洗白 |

**测试真的挡住过东西**：本轮有五次"改完 → 被既有测试打回 → 收紧到正确判据"，分别是设备准入
误拦 report-only、同屏歧义判据过宽、跨屏 WARN 缺失、Q8 非法引用用例写错，以及守卫迁移时
`traceObject` 底座与提升后的版本门互斥。这些不是走过场。

---

## 6. plan todo 现状（按事实）

| todo | 状态 | 说明 |
|---|---|---|
| t1 契约先行 | `in_progress` | Maison 独立部分完成；Step Outcome v1 typed 消费契约随接线收口 |
| t2 selector 静态边界 | `in_progress` | 静态与 runtime gate 均已接线；余 P0 身份护栏在 p0-semantic-gates 侧的消费 |
| t3 execution_channel | `in_progress` | 主体完成；visual/provider per-TC 绑定（6.5b）未做 |
| t4 首失败归因 | `in_progress` | v1 routing 已接线（route + cause disposition 两类产物）；余 6.6b 的 summary/repair 基数复核 |
| t5 回归矩阵 | `in_progress` | Phase 0 golden 已贯穿 dispatch/routing/selector/artifact 四套件；余 report-only 全链与 summary 基数 |
| t6 身份隔离 | `in_progress` | 降级分支已验收；强隔离分支按环境条件保持未执行 |
| t7a Phase 0 契约迁移 | `in_progress` | 落位+对账+8 问闭合+四模块基座+守卫整体迁移完成；余 summary 侧基数复核 |
| t7b 真实 source 集成 | `in_progress` | vendor 接入 0.5.0 已完成并三方闭合；余关键入口 conformance 与各入口 smoke（tasks 6.7b） |
| t8 宿主回灌 | `pending` | 用户单独触发 |

---

## 7. 返修轮（2026-08-31，外部 review 之后）

### 7.1 复现：先证明问题存在，再改

改任何一行之前，先把两条 P0 用生产代码跑出来。

| 输入 | 生产入口 | 返修前 | 返修后 |
|---|---|---|---|
| 冻结包**合法** golden `trace/valid/bc-opencard-1.json` | `evaluateHylyreNativeEvidenceGate` | `native=false / mode=unsupported / 54 reasons`，首条 `steps[0].status 值域非法：undefined` | **通过** |
| `{schema_version, result_protocol, environment, cases:[{}]}` | `requireV1ForGate` | **`ok=true`** | 拒（缺 feature/phase/outcome…） |
| 0.3 flat 步骤套 0.4-p0 信封 | `requireV1ForGate` | **`ok=true`** | 拒（`outcome` 缺必填字段） |
| trace 目录内 junction 指向外部文件 | `resolveArtifact` | **`ok=true`，文件被读出** | 拒（`escapes_trace_tree`） |
| `golden/trace/invalid-crossrow/` 13 条 | schema 校验 | **13 条全过** | 13 条全拒 |

最后一行是本轮最容易被忽略的一条：跨行不变量 JSON Schema 表达不了，只做 schema 校验就等于
给这 13 类**全部放行**。

### 7.2 P0-1：真实 v1 被生产门拒绝

根因是**第二套形状定义**——`device-test-run.ts` 自己维护了一份 0.3 flat 的
`HylyreStepResult`（顶层 `status/failure_kind/failure_code/evidence/error` + 旧 selector
三件套）和配套的手写校验器 `validateNativeStep`/`validateNativeSelector`。

修法不是补字段，是**删掉第二套定义**：类型直接复用 `hylyre-result-protocol` 的 typed view，
校验委派给 `requireV1ForGate`，本地只保留 schema 管不到且属于 Maison 期望的
`phase === 'testing'`。类型一换，编译器立刻顶出全部 0.3 消费点——
`p0-semantic-gates`（selector/observation/status 共 7 处）与
`testing-trace-gates`（blocked 步骤判定）随之迁移。

顺带发现并删除一段**在 v1 下不可达的死代码**：`p0-semantic-gates` 原有
"`candidate_count>1` 但已消歧且带 bounds 就放行"分支。冻结契约 §6.1 明确
**Schema 直接拒绝 `candidate_count>1` + 非空 `selected`**——该分支永不可能命中，
留着只会让人以为那种形态合法。v1 里消歧表达在 `request.constraints.index`，
resolver 应用谓词后回 `unique`/count=1。

另有一处解析层 bug：`parseHylyreTrace` 返回的是**投影**，会丢掉 `model_backend` 等契约必填项。
拿投影去过冻结 schema，合法 trace 会被判"缺必填字段"。改为先摊开原始文档再覆写具名字段——
**投影不得成为校验对象的裁剪器**。

### 7.3 P0-2：parse boundary 从类型断言变成真校验

原实现判完 dispatch 键就 `raw as unknown as TraceV1`。现在是三层，逐层 fail-closed：

1. dispatch 键（schema_version / result_protocol / environment 三者一致）；
2. **冻结 `output-schema.json` 运行期校验**；
3. **跨行不变量**——prior_step 根引用、CaseResult 三轴反推、run outcome、
   `candidate_count` 复算、`tool_calls` 投影、失败边界义务。

两个实现决定值得 review 盯：

**schema 从哪读。** 不能读 `harness/tests/fixtures/`——实测 `classifyPath` 对该路径返回
`include=false`（`excludeGlobs:harness/tests/**`），宿主拿到的发布件里根本没有它，
本仓能过、宿主必崩。改读随发布件下发的 vendored contracts
（实测 `include=true`，且与冻结包 fixture **同 sha256**，不构成第二事实源）。
多 profile 内容不一致时拒绝消费，而不是随便挑一份。

**跨行判据不是自拟的。** 冻结包自带可执行 oracle `contracts/reference_reducer.py::verify_trace`，
新增的 `hylyre-crossrow-verifier.ts` 是它的忠实移植，两边对同一批 golden 必须同结论。

还有一处基础设施改动：仓库原有的 `lite-json-schema.ts` 对**未实现的关键字是静默忽略**
（fail-open）。冻结 schema 大量用 `allOf/anyOf/oneOf/not/if-then/contains/propertyNames/minItems`，
直接拿来用等于假校验。除补齐这些关键字外，新增 `auditSchemaSupport()` 在**加载期静态遍历
整份 schema**，遇到未覆盖关键字直接 fail-closed——这样"契约演进引入新关键字"只会变成显式拒绝，
不会悄悄放宽门禁。实测对冻结 schema 审计结果为 **0 处未覆盖**。

### 7.4 P1：四项

| 项 | 返修前 | 返修后 |
|---|---|---|
| 责任路由门 / selector 运行时门 | `if (!evidenceGate?.native) return []` 静默消失 | 缺 trace / gate 未闭合各自产显式 BLOCKER，与已改好的 `checkHylyreCaseExecutionCompleteness` 同构 |
| `evaluateHylyreRunOutcome` | 注释写着"不再回落"，代码里 `c.status === '失败'` 那一路原样留着 | 非 v1 直接 `verdict='fail'` 且不产计数——中文 status 是派生投影，不是独立事实源 |
| Q5 artifact | `resolveArtifact`/`evaluateFailureBoundary` **生产侧零调用** | 新增 required gate `testing_artifact_integrity`：定位 + sha256 + realpath containment + §8.1 失败边界义务 |
| Q8 prior_step | `verifyPriorStepReferences` **生产侧零调用** | 已随跨行 verifier 进入 `requireV1ForGate` |

`resolveArtifact` 的头注一直写着"realpath 级复核"，实现却全是 `path.resolve`/`path.relative`
的**词法**判断。补上真 realpath 后，junction 逃逸被拒、树内正常文件仍通过。

OpenSpec 侧把 `specs/runtime-step-evidence`、`specs/harness-gates` 与 tasks 4.2 里残留的
`Hylyre 0.4.0+ / trace 0.3-p0 / failure_kind / failure_code` 统一到 0.5.0 / 0.4-p0 /
Step Outcome v1——归档会把 delta 合入 canonical，两套协议文本并存会把旧协议写进正典。

### 7.5 测试口径的根本性纠正

**这是本轮最重要的一条。** 上一轮 3743 全绿不构成任何证据：
`testing-stepresult-evidence.unit.test.ts` 的"v1 fixture"只换了外层信封、步骤仍是 0.3 flat，
它证明的恰好是**必须被拒绝**的那种输入能过门。手拼 fixture 在这里是负资产。

两项改动：

1. 该套件底座整体换成与冻结包 golden 同形的真 v1（含 `tool_calls` 按 §12 投影、
   失败用例三轴/run outcome 按冻结 reducer 自洽、失败边界用 capture-unavailable +
   `evidence=incomplete` 如实履行）；
2. 新增 `hylyre-frozen-conformance.unit.test.ts`：**断言里不出现任何手写 trace**，
   只让生产入口 `requireV1ForGate` 对冻结包 golden 三类目录给出与契约一致的裁决，
   并钉死 schema 必须来自 vendored contracts、不得来自被发布排除的 `tests/fixtures`。

**给后续实施者的硬规则**：v1 相关门禁的验收一律用冻结包 golden 或 vendored fake runner 的
真实输出。需要构造反例时，从 golden 派生并保持跨行自洽；不得手拼 trace——
上一轮就是这样把红的测成绿的。

### 7.6 返修连带查出的问题（都不是原 review 提到的）

把校验器从 fail-open 改成 fail-closed 之后，**同一类病灶在别处也被照了出来**。这几条值得单列，
因为它们说明"绿灯"在这个仓里曾经系统性地不可信：

1. **`receipt-slim` 的 summary 夹具同样是 schema-invalid**。它声明 `schema_version: '1.3'`，
   而 `summary.schema.json` 的 `allOf/if-then` 规定 1.2/1.3 必带
   `assurance` / `capability_resolutions` / `capability_resolution_contract_fingerprint` /
   `closure_status`——前三个它都没有。生产 writer 三个都写，只有夹具缺。
   讽刺的是夹具上方就写着「完整 schema 必填集（codex BLOCKER3a——测试不得把 schema-invalid
   片段固化成绿灯）」：那句话没兑现，正是因为校验器把 `allOf/if-then` **整条忽略**了。
   按 schema 补全夹具，没有放松校验器。

2. **我自己引入的一个 bug**：`parseHylyreTrace` 会产出值为 `undefined` 的自有属性
   （如 `runtime_step_telemetry`），而新写的 `additionalProperties` 检查按 `Object.keys`
   遍历，把它判成了额外字段——同一个字段于是"既缺失又多余"。`undefined` 不是 JSON 值，
   已统一按缺席处理（`required` 分支本来就是这个口径）。

3. **多份夹具声明 `verification: 'passed'`，但用例里一个断言步骤都没有**。冻结 reducer §9.2
   规定"没有参与判定的断言行"只能是 `inconclusive`——一个什么都不断言的用例本就不该算通过。
   跨行 verifier 报出来后，按事实给这些夹具补了真实断言行（派生计划同步），
   而不是把断言改松。

4. **一条单测直接把必须废止的行为钉成了正例**：
   `evaluateHylyreRunOutcome: success all pass → pass` 用的是 legacy `0.2-p4` + 中文
   `status: '通过'`。这正是 plan T5 第 20 条点名要消灭的 legacy 回落。断言已反转为
   "legacy 一律 fail 且不得产出计数"。

5. **`tool_calls` 投影改为按最终 `cases` 派生**。原来在构造时算一次，之后任何改
   `cases`/`steps` 的用例都会留下陈旧投影。夹具自洽应由构造方式保证，
   而不是靠每个用例记得手工同步。

另有一处健壮性调整：冻结 schema 的定位在显式 `frameworkRoot` 落空时，回退到从**本模块自身位置**
向上推断。这不是兜底猜测——本文件就躺在 framework 树内（宿主里是 `<host>/framework/harness/...`），
向上第一个含 `profiles/` 的目录必然是当前正在执行的这份 framework。调用方传窄不应让门禁失去判据。

### 7.7 返修后的验证结果

| 命令 / 判据 | 结果 |
|---|---|
| `npx tsc --noEmit` | PASS |
| `npx ts-node tests/run-unit.ts` | **3750 passed / 0 failed** |
| `npx ts-node tests/run-tests.ts`（fixture） | **46 / 0** |
| `openspec validate --all --strict` | **45 / 45** |
| `check-openspec-enforcement-paths` | PASS |
| `git diff --check` | PASS |
| 生产侧残留 0.3 flat Hylyre 步骤字段消费 | **0**（余下 `failure_kind` 全是 Maison 自己的 `CheckResult` 分类字段，与 Hylyre 步骤无关） |
| 冻结 schema 关键字审计未覆盖项 | **0** |
| `golden/trace/{valid,invalid,invalid-crossrow}` 经生产 `requireV1ForGate` | 11 v1 全过 / 11 全拒 / 13 全拒（legacy 那份判 `legacy_unsupported`） |

**这轮的爆炸面**：切换共触发 9 条失败，全部是夹具失真或断言编码了应废止的行为，
无一是设计问题——但和上一轮不同，这次的 9 条**本来就该红**，只是此前被 fail-open 盖住。
数量对比值得记：上一轮"全绿 3743"，这一轮先红 9 条再到 3750 全绿，
差别不在代码质量，而在校验器有没有真的在校验。

仍未做（与原 review 划的范围一致）：6.5b（visual/provider per-TC 绑定）、
6.6b（summary/repair 按新 route+disposition 形状复核基数）、
6.7b（真实 source 的关键入口 conformance + atomic/MCP/session smoke + pre-run reject 四要素复验）、
T8（宿主动作，等触发）。本轮没有碰它们。

---

## 8. 第二轮返修（针对返修后 review 的四项 P1）

复审确认两条 P0 与 Q5/Q8 主体真实修复、无新 P0，但点出四项 P1。逐条复现后全部修完。

### 8.1 P0 的 `by_id` 身份护栏此前确实没实现

`p0-semantic-gates` 只检查解析面（`selected.id === targetId` / `candidate_count`），
**从没检查过请求面**。于是两个缺口成立：`by_text` + `unique` + `selected.id` 恰好等于目标 id
可以闭合 required；`by_text` + `not_found` 可以闭合 forbidden——但"某段文字没找到"
并不等于"某个 id 不在场"。plan §139/§346 与 spec 的 Identity guardrail 都写明
required/forbidden 身份证据必须由 `by_id` 断言承载。

新增 `requestProvesIdentity`：请求 kind 必须是 `by_id` 且 `request.value` 等于目标 id，
放在解析面判定之前。补三条负例：`by_text` presence、`by_text` absence、
`by_id` 但指向别的 id——全部保持 uncovered。

**作用域必须说清**：这条限定只属于 P0 身份覆盖路径。冻结契约与 spec 同时**禁止**把
运行时 selector 门写成按 `request.kind` 的固定旁路（那里语义随执行路径走，
native `by_text` 合法地产出 `not_attempted`）。两道门判据不同，不能互相搬。

### 8.2 上一轮修 `return []` 时引入的误报

`evidenceGate` 只在 `runtimeEvidenceRequired`（存在 P0 device 交互 AC）为真时才生成。
我把三道门的 `if (!evidenceGate?.native)` 写成了"null 也算失败"，结果是
**一个没有 P0 acceptance、但确实跑了合法 v1 Hylyre case 的 feature 会平白吃三条
`unsupported_result_protocol`**。

正确口径与 `checkHylyreCaseExecutionCompleteness` 一致，现已对齐：
`evidenceGate=null` 表示"三重身份门不适用"，`evidenceGate && !evidenceGate.native` 才是失败；
trace 缺失或 `requireV1ForGate` 失败仍是 BLOCKER。新增回归同时钉三个方向：
null 不产协议失败、native=false 三门都响、trace 缺失三门都响
（后两条防止"修误报"时又退回静默 no-op）。

### 8.3 vendored fake runner 的永久测试只验了信封

那是**唯一真正执行 vendored source** 的端到端面，却只调用 `dispatchHylyreResult`——
而 dispatch 只看信封，"信封正确、内容非法"正是本轮修掉的那类产物。手工验证当时确实能过
生产两道门，但测试没锁住。现已改为永久断言真实输出同时满足
`requireV1ForGate(parsed).ok === true` 与 `evaluateHylyreNativeEvidenceGate(...).native === true`。
（该用例无 skip 守卫，python 缺失会直接失败，不存在静默跳过。）

### 8.4 active OpenSpec 仍有 flat 表述与已删文件引用

改完三处顶层 flat 表述（`role=assertion` + `status=passed` → `outcome.status` 与
`outcome.observation`；`role/status` → 完整 outcome 变体；`indexes/status/evidence` →
`index`/`outcome`/`selector`），并把 §8.1 的身份护栏写进 spec 正文与场景行。
Enforcement 里 `hylyre-selector-gates.ts` / `hylyre-failure-routing.ts`（均已删除）
改为现有的 `*-v1.ts`。

**根因值得单独记**：`check-openspec-enforcement-paths.mjs` 只扫 canonical `openspec/specs/**`，
**不扫 active delta**，所以这类残留一直隐身，归档时才会变成真实错误。我按同样口径扫了全部
185 份 delta spec 的 1000 条 Enforcement 路径：本 change 现在 0 处失效；
但发现 **另一个 active change `goal-run-birth-contract` 有 5 条指向已不存在的文件**
（`goal-in-session-driver.ts`、`goal-supervisor.ts`×2、`goal-adapter-spawn.ts`、`phase-env.ts`，
已逐个确认磁盘上没有）。

把 delta 纳入脚本扫描是对的，但需要先支持 `{a,b}.ts` 花括号展开（否则 63 条报错里绝大多数
是这种误报），并且会立刻让 `goal-run-birth-contract` 红掉——那是别人的 change。
**本轮没有改脚本，也没有动那个 change**，作为独立事项留给你决定谁来收。

### 8.5 报告自身的时间线错误

§4.2 原写"硬阻断窗口随 vendor 接入 0.5.0 关闭"。事实是 vendor 换完之后消费侧仍钉在 0.3 内核、
合法 v1 反而被拒，窗口当时并没关；真正关闭时点是 §7 返修。已按事实改写。

### 8.6 第二轮返修后的验证

| 命令 / 判据 | 结果 |
|---|---|
| `npx tsc --noEmit` | PASS |
| `npx ts-node tests/run-unit.ts` | **3752 passed / 0 failed** |
| `npx ts-node tests/run-tests.ts`（fixture） | **46 / 0** |
| `openspec validate --all --strict` | **45 / 45** |
| `check-openspec-enforcement-paths` | PASS |
| `git diff --check` | PASS |
| 本 change 的 delta Enforcement 失效路径 | **0** |
| vendored fake runner 真实输出 → `requireV1ForGate` / native gate | 均 PASS（现为永久断言） |

新增测试 2 条（by_id 身份护栏负例、evidenceGate=null 三向回归），
fake runner 端到端断言由 1 层加到 3 层。本轮零回归。

---

## 9. 6.5b / 6.6b / 6.7b

### 9.1 6.5b：visual 可绑定，provider 仍 fail-closed（有意）

6.5a 对 manual/visual/provider **一律 FAIL**，理由是没有 TC→证据的机器映射。
6.5b 只放开真正能被机器证明的那条：

**visual 可绑定**，链路全程 id 对 id、不解析散文：
TC 的结构化「关联 AC」→ acceptance checkpoint 的 `pre_screen`/`post_screen` →
`visual-diff.json` 同名 `screen_id` 的逐屏 verdict。断一段就是 unbound（仍 FAIL）。

**provider 仍 fail-closed，这是结论不是遗漏**：capability 解析记录是 **feature 级、按
capability id** 的（只有 `state`），**没有 TC 维度**；`profiles/*/harness/providers/` 下
也没有任何 provider 产出 per-TC 结果。"能力在场"不证明"该 TC 执行并通过"。
放开条件写成可实现的契约（`PROVIDER_EVIDENCE_CONTRACT`）：provider 必须产出
tc_id + 机器判定 outcome + 可复核产物引用，并与本次 run 身份绑定。

**manual 永远 fail-closed**（冻结设计）。

这是本 plan 里少见的**放松**方向，所以测试重心相反：10 条用例里 8 条是"必须仍然 FAIL"的
反例（缺关联 AC、缺 checkpoint 屏、缺产物、缺屏条目、verdict∈{warn,fail,skipped,pending,空}、
多 AC 任一缺屏、provider、manual），正例只有 1 条。

### 9.2 6.6b：查出的不是基数溢出，是缺陷身份漂移

按新形状复核后，真正的问题不在候选数量，而在**身份**：route/disposition 的 check id 原为
位置序号 `testing_failure_routing_${index+1}`，而 `item_fingerprint` 由
`(id, files, summary)` 派生——该指纹正是 goal 模式防震荡 `attempted` 集合的键
（`!attempted.has(c.item_fingerprint)`）与 `roundFingerprintOfCandidates` 的输入。

后果：同一轮里更靠前的缺陷被修掉后序号整体前移，**同一个缺陷（同 case、同 step、同 code）
在下一轮换了 id、换了指纹，于是被当成全新候选重新投递**——防震荡与"已尝试过"记账同时失效。
这是本 plan 要消灭的放大效应的账本版本。

id 改为缺陷身份式（case + step；跨行 verifier 已保证同 case 内 step index 唯一）。
回归直接钉性质而不是形态：构造两条 case 各一处失败，第二轮删掉靠前那条，断言 TC-B 的
id 与 `item_fingerprint` **跨轮完全一致**，且 id 不再是位置式。

同轮顺手修掉夹具 `failingTraceObject` 用 0.3 裸码 `assertion_mismatch` 的问题——冻结
`domainCodeAgreement` 要求 code 首段等于 domain（应为 `assertion.mismatch`）。
它一直没被发现，因为原用例只断言"结果是 FAIL"，而被 schema 拒绝也是 FAIL。**同一个陷阱第三次出现。**

### 9.3 6.7b：部分完成，一处上游缺陷阻断

新增 `hylyre-entry-conformance` 套件。

- **real plan / fake**：已由 vendor fake runner 用例端到端覆盖到生产两道门（永久断言）。
- **pre-run reject**：四要素全覆盖——结构化 stdout 载荷按冻结契约校验
  （`result_protocol`/`command_status`/`phase`/`rejection.domain=contract`/code 命名空间/path）、
  非零 exit、零 trace、零 report、输出无任何设备通道痕迹；另加一条逐份校验
  `golden/pre-run-reject/valid` 的用例，确保形状来自冻结包而非本仓自拟。

- **⚠ steps-file 入口被上游缺陷阻断，且这个缺陷本身值得上报 Hylyre**：
  `run --steps-file --use-fakes` 的 `--use-fakes` **被静默忽略**——
  `run_cmd.py::execute_steps_scenario` 的签名里根本没有 `use_fakes` 参数，内部写死
  `resolve_model_backend(..., use_fakes=False)` 并直接调 `steps_cmd.execute_run_steps` 走 Hypium。
  **实测该组合连上了真机**（`No device sn passed, using first device sn: ...` + EnvPool 初始化）。
  调用方以为自己在 fake 模式、实际驱动真机——这是静默降级，比直接报错危险得多。
  已改为源码级 pin 守住缺口（Hylyre 补上 use_fakes 后该 pin 会失败，提示接回真 conformance）；
  修复前 steps-file 的完整 conformance 只能进 T8 宿主回归。

- **atomic / MCP / session 不在本地做**：vendored CLI 只有 `run` 支持 `--use-fakes`
  （实测只命中 `run_cmd.py`），其余入口必须连真机；plan §194 本身也写明它们"不产 Maison
  正式证据"。属 T8 宿主动作，等用户触发——不用"能 import"之类的假 smoke 冒充。

### 9.4 验证

| 命令 / 判据 | 结果 |
|---|---|
| `npx tsc --noEmit` | PASS |
| `npx ts-node tests/run-unit.ts` | **3766 passed / 0 failed** |
| `npx ts-node tests/run-tests.ts`（fixture） | **46 / 0** |
| `openspec validate --all --strict` | **45 / 45** |
| `check-openspec-enforcement-paths` | PASS |
| `git diff --check` | PASS |

新增套件 2 个（`execution-channel-evidence` 10 条、`hylyre-entry-conformance` 3 条）
与 1 条缺陷身份稳定性回归；本轮零回归。

### 9.5 6.5b 返修（外部 review 查出 P0）

**§9.1 那版 6.5b 是坏的，且我自己的测试掩盖了它。** 三处错：

1. **读错路径**：拿 `featurePhaseReportsDir`（`doc/features/<f>/testing/reports`）拼
   `device-testing/device-screenshots/`，而权威文件在
   `doc/features/<f>/device-testing/device-screenshots/visual-diff.json`。
   方向上是哑弹（available 恒 false → 恒 FAIL），但等于 6.5b 完全没生效。
2. **自造弱解析器**：只读 `screen_id → verdict`，不校 schema、不看
   `evaluated_screenshot_hash` / `evaluated_build_fingerprint` / `evaluation_invalidated`。
   **这一条配上正确路径才是真逃生口**——一份手改的极简 JSON 就能把 TC 洗绿。
3. **时序错**：义务门塞在声明门里，跑在 build/device/visual capture **之前**，
   而真正的 visual diff 晚得多。它只可能消费上一轮旧产物，证明不了本轮。

**为什么没被我自己的测试发现**：正例直接手工构造 `Map<screen_id,'pass'>` 喂给绑定函数，
**绕过了生产 loader**。这和本 plan 里反复出现的 hybrid fixture 是同一个病：
测试没走生产路径，于是绿灯只证明了测试自己。

返修：路径改 `featureDir`；判据改为复用既有 `validateVisualDiffJson` /
`isStaleVisualDiffVerdict` / `isMissingEvaluatedScreenshotHash`，并要求**本轮**
`visual_diff` 门自身 PASS；义务门独立为 `checkChannelEvidenceObligation`，
由主链在 visual 之后调用。测试全部改走生产 loader，负例扩到六类
（错路径、visual 门未过、手改极简 JSON、截图 hash 失配、旧 build、缺 evaluated hash、
evaluation_invalidated、verdict 非 pass）。

改走生产校验器后立刻暴露两个夹具口径错误——`screenshot_path` 相对 **projectRoot** 解析
（不是 feature 目录），`evaluated_screenshot_hash` 是 sha256 **前 16 hex**（不是全长）。
自造 loader 永远碰不到这两条。

### 9.6 记录纠偏：6.5b 与 6.7b 不该勾完成

外部 review 指出我把两项部分完成记成了 `[x]`——这正是本轮一路在修的"虚假完成记录"，
不能自己再犯。已改：

- **6.5b 拆成三条**：`6.5b-1 visual` 完成；**`6.5b-2 provider` 未实现**
  （对所有 provider TC 固定返回 unbound，`PROVIDER_EVIDENCE_CONTRACT` 只是接口说明、
  不是证据载体，不得记成"绑定完成"；是否本版实现需用户显式决定）；
  `6.5b-3 manual` 按设计永久 fail-closed。
- **6.7b 改回未勾选**：plan 要求 real plan/fake/steps-file 完整 conformance +
  atomic/MCP/session 各一 smoke，做完才能进 T8。steps-file 被上游缺陷阻断、
  atomic/MCP/session 未执行。**把后四项搬进 T8 属 plan scope 变更，需用户显式授权，
  实施者不得自行重排。结论：6.7b 未完成，不得进入 T8。**

### 9.7 收紧与固化

**pre-run reject 断言收紧**：`status === 2`（约定码，不是"随便非零"）；
`JSON.parse(stdout.trim())` 直接成功（不再从 stdout+stderr 里"搜"JSON——日志里混一段
JSON 也能过，而调用方依赖的是"stdout 就是载荷"）；trace/report 预置**哨兵**并逐字节比对
（只证明"没新建"漏掉"被覆盖"）；设备痕迹检测加 `using first device sn` / `EnvPool`。

**两条纪律写进 active spec**，与"禁止手拼 trace fixture"并列：
① 负向用例必须断言**具体拒绝原因**，不得只断言 verdict——"只断言 FAIL"分不清
"因待测原因被拒"与"因夹具本身非法被拒"，本 change 内已因此掩盖**三份**非法夹具；
② 任何驱动 vendored CLI 的测试，注册进默认套件前必须**先源码级证明其无设备路径**。

同时把非 Hylyre 通道证据义务冻进 spec（visual 的 id 链与新鲜度复核、时序要求、
provider 的 fail-closed 与解除条件、manual 的永久 fail-closed），四条场景。

### 9.8 返修后验证

| 命令 / 判据 | 结果 |
|---|---|
| `npx tsc --noEmit` | PASS |
| `npx ts-node tests/run-unit.ts` | **3772 passed / 0 failed** |
| `npx ts-node tests/run-tests.ts`（fixture） | **46 / 0** |
| `openspec validate --all --strict` | **45 / 45** |
| `check-openspec-enforcement-paths` | PASS |
| `git diff --check` | PASS |

6.5b 套件由 10 条扩到 16 条且全部走生产路径；返修触发 1 条既有用例失败
（`execution-channel` 那条断言义务门来自声明门——正是被移走的部分），已随之改到新入口
并把"时序"这条性质一并钉住。

---

> 本段的 6.7b 阻塞已由下方 §10 的同版本修复件解除；provider 实施跟踪又于 §11 正式摘出。
> 当前 change 剩余的是 5.2 最终/T8b 收尾与 6.8/T8 宿主动作；canonical 归档与强隔离条件验收
> 仍按各自边界处理。

---

## 10. Hylyre 0.5.0 同版本修复件接入与 T5/T7b 收口（2026-09-01）

### 10.1 发布件坐标与差异面

新 plain-source manifest 与磁盘逐文件独立复算一致：309 文件、982266 bytes、
`source.tree_sha256 = 8f00a37f2fc08237e21d5523ddd77d084eac90597cd9e9a3770dc76f9924d38d`；
`contracts_tree_sha256` 仍为 `cc738c272324022d7ed559340e9c710f9b7f5f94aac62c5dd70042e827a21bae`，
226/226 与 Maison freeze fixture 逐字相同。wheel 与 contract zip 只核验、不引入 vendor。

交付说明里的“source tree SHA 与旧基线相同”与 manifest/磁盘冲突，按磁盘事实纠偏：旧 tree 是
`351f61ab…1380`，新 tree 是 `8f00a37f…d38d`。路径集合 0 增 0 删，内容恰好 5 改：
`cli/__main__.py`、`cli/commands/{run_cmd,steps_cmd}.py`、
`scenario/{runner,steps_report}.py`。差异均属于 `use_fakes` 逐层透传、纯 fake batch、
plan/steps 共用 `fake_step_outcome` 与 `use_fakes`/environment 投影；contracts 零变化。

上游仓在 clean commit `0220b5dafadbd4661ce496adc3fca6d4d71b7789`（`fix: honor fake mode for steps-file runs`），
收包前执行其零设备回归 5/0；整体复制后 vendored source 再复算 309/309、无额外文件、无 wheel、
无移交文档、无 `__pycache__`/PYC。

### 10.2 steps-file 与非关键入口

Maison 默认套件删除“缺陷仍存在”的 source pin，改为在 spawn 前静态证明：CLI 向
`execute_steps_scenario` 传 `use_fakes`；该函数继续传入 `execute_run_steps`；fake 分支在 live
session/Hypium 之前直接返回 `run_steps_fake`；纯 fake 函数不含 device/session/hdc/EnvPool 入口。
随后真实执行 `run --steps-file --use-fakes`：输出零设备痕迹，产出 0.4-p0 +
`hylyre.step-outcome/1`，通过 `requireV1ForGate` 与 native evidence gate，所有 step
`device_session=false` 且无 flat 0.3 字段。fake action 通过、离线 assertion 如实
`blocked/capability`，因此 CLI exit=1 是业务 outcome，不是 conformance 失败。

atomic / MCP / session 没有搬进 T8：同一 clean source commit 的 Phase 1 conformance 分别用
FakeUiDriver、注入 agent 与真实 FastMCP client 做端到端 smoke，实际执行 3/0。

### 10.3 T5 normal/report-only golden 全链

normal required gates 新增 4 份 vendored golden 全链：`bc-opencard-1`、blocked capability、
device death、capture-unavailable，覆盖 route/disposition 基数、attempted infrastructure、
failure-boundary 与 legacy/未知 schema fail-closed。报告侧 `all-passed` fixture 与 native binding
均改为从 vendored golden 派生宿主 identity，不再手拼 trace；真实 report-only CLI 继续证明
零 provider/device/hook、完整重算 summary/quality axes、authoritative trace 字节不变。

定向结果：`testing-stepresult-evidence` 20/0、`testing-trace-gates` 18/0、
`hylyre-entry-conformance` 3/0；Hylyre 上游 steps-file 零设备回归 5/0、atomic/MCP/session 3/0。

### 10.4 本批最终验收

| 命令 / 判据 | 结果 |
|---|---|
| `cd harness && npm test` | typecheck PASS；unit **3773/0**；fixture **46/0** |
| `npm run openspec:validate` | strict + enforcement **45/45** |
| `node scripts/check-plan-version.mjs` | PASS |
| `git diff --check` | PASS |
| 本 change / plan / 两份 README 的 CRLF 扫描 | 11 份 Markdown，CRLF **0** |

本批未打 Maison 发布包、未提交/推送、未操作宿主、未进入 T8。

---

## 11. provider per-TC scope 正式摘出（2026-09-01）

用户决定把 provider per-TC machine evidence binding 从 plan `a6c4e9f2` 与当前 OpenSpec change
正式摘出，交给独立 plan：

- plan id：`e7cecd22`；
- 路径：`.cursor/plans/provider通道per-TC机器证据绑定_当前run身份与证据闭环_e7cecd22.plan.md`；
- version：`3.0.0`，不使用 `deferred_to`；
- 后续独立 review、独立 OpenSpec、独立开发，本轮没有实施。

本次 disposition **不是功能完成**。生产事实保持不变：`provider:<capability-id>` 仍是合法声明，
但 capability resolution 只有 feature/capability 维度；“provider resolved”不能证明任何 TC 已执行通过；
现有 `testing_channel_evidence_obligation` 对缺 per-TC machine evidence 的 provider TC 继续
FAIL/UNVERIFIED。当前 change 保留这条 canonical fail-closed behavior，不加入未来 provider envelope
字段，也不再承担 provider binding 实现进度。

因此 tasks 6.5b-2 勾选的含义是“scope disposition 已完成”，不是“provider binding 已实现”。
当前 change 的未完成 task 只剩 5.2 与 6.8，a6c4e9f2 的未完成 todo 只剩 T8。
