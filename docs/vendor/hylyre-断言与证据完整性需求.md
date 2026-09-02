# Hylyre 确定性验证、Selector 语义与证据完整性需求

- 提出方：Maison framework（hmos-app profile 以 vendor 方式集成 Hylyre）
- 依据版本：**hylyre 0.3.2**（下文代码坐标均以该版发布源码树 `src/hylyre/` 为准；除 B-6 的宿主原始 dump 未保留、需以复现 fixture 补证外，其余代码坐标与运行语义均经我方逐条核实）
- 实测环境：HUAWEI Pura X（VDE-AL10），OpenHarmony-6.1.1.120 / API 24，hypium 随 0.3.2 venv 安装
- 日期：2026-08-30（v3，三轮评审收口：接口补齐 evidence 轴与 failure_code 两级分类后定稿）

**一句话总纲**：Maison 是"自然语言 → 结构化测试契约"的编译器；Hylyre 是契约的**确定性执行器与取证器**；宿主产品负责提供可寻址的交互语义。**任何猜测、匹配放宽、歧义首选或无证据通过，都不得发生在正式回归执行期。**

---

## 〇、系统边界与责任分工

```
用户自然语言
    ↓
Maison：理解意图、查契约/dump、编译成结构化 TestContract（选定 match 模式、scope、唯一性要求、后置断言）
    ↓
Hylyre：按契约确定性定位、执行、断言、取证
    ↓
Maison：按 acceptance / P0 / 视觉 / NFR 门禁裁决是否完成
```

| 责任域 | Owner |
|---|---|
| "少说了几个字 / 用概括 / 用业务同义词"的意图理解 | Maison |
| exact/contains、scope、唯一性要求、后置断言的**生成** | Maison |
| 按结构化 selector 确定性定位与执行 | Hylyre |
| 零匹配、多匹配、富文本片段不可定位的**结构化诊断** | Hylyre |
| `.id()`、accessibility key、独立可点击节点等可测性 | 宿主产品 |
| 失败后重派生 / 回 coding / 回 spec 的路由 | Maison |

Hylyre 可以提供候选发现能力（探索期），但**正式回归中不得自行改写用户意图、静默放宽匹配、或从多候选中猜一个**。动态内容（金额/日期/账号）该用 exact 还是 contains 由 acceptance 意图决定，不由字符特征启发式决定——那是编译器（Maison）的职责。

## 一、实锤案例（三例，已按二轮评审修正归因）

1. **`wait_for` 假通过**。某用例断言元素 `more_mini_logo_psbc` 存在，判"通过"；三次独立 dumpLayout 确认该 id 根本不存在。
2. **toast 断言在同一链路上双向皆坏**。三条 `assert_toast` 报 `toast not found`，但"点击后立即 dumpLayout"证明 Toast 实际弹出（假阴性）；同时该实现对 `check_toast` 的**布尔返回值**不做判定，在 check_toast 返回 False 而不抛异常的环境上会**假阳性**（见 B-4）。
3. **富文本目标定位脆断**（另一宿主 2026-08-25 反馈）。目标 UI 是富文本：`Text` 内两段 `Span`——"已阅读并同意"普通段 + "银行信用卡关联还款协议"**可点击**段；组件树上通常只有单 Text 节点、text 为拼接超串。`BY.text("银行信用卡关联还款协议")` 走 native 精确路径必 miss。注意（修正）：0.3.2 并非全面不支持 contains——`touch` 的 resolver 路径默认就是 contains；真正的病是**同一 `by_text` 按操作类型走不同引擎、不同默认语义**（见 B-2），以及 contains 命中拼接节点后**点不对可点击子段**（见 B-6）。

## 二、机制定性：四个根因域

这些不是孤立 bug，是四个根因域的多处投影：

- **A. Verdict 模型不完整**：命令未抛异常即用例"通过"——执行完成、验证通过、覆盖完整、证据完整四件事被压成一个布尔。
- **B. Selector/Driver 契约不统一**：同一 `by_text` 在不同操作路径上是 exact、contains 或静默 fallback；match 枚举不校验；多候选默认取第一个；富文本子段不可寻址。
- **C. Evidence 模型不完整**：只有 success-only 的命令日志（`tool_calls`），没有完整可验真的 step result ledger——trace 无法证明实际命中了谁、点了哪里、断言了什么、expected 有没有被检查。
- **D. Capability/Error 分类缺失**："能力不支持"与"产品未出现预期结果"混成一种失败/跳过，消费方无法路由。

## 三、缺陷清单（按根因域分组，坐标均已核实）

### A 域：Verdict 模型

| # | 缺陷 | 坐标 | 后果 |
|---|---|---|---|
| A-1 | case"通过" = 全部步骤未抛异常；**纯动作序列（touch→swipe→back）无任何后置验证也通过** | `scenario/runner.py:116-133` | 无断言覆盖概念，verified pass 与 merely-completed 不可区分 |
| A-2 | 全部用例"跳过"时 outcome 判 `success` | `scenario/runner.py:38-40` | 全跳过被读作成功 |

### B 域：Selector / Driver 契约

| # | 缺陷 | 坐标 | 后果 |
|---|---|---|---|
| B-1 | `wait_for` 丢弃 `wait_for_component` 返回值（hypium 超时返回 None 不抛，docstring 明示） | `drivers/hypium/driver.py:549` | 存在断言**永真**（实锤案例 1） |
| B-2 | **同一 `by_text` 按操作分裂两套引擎/两种默认**：`touch`/`scroll_to` 走 resolver（默认 **contains**）；`wait_for`/`wait_gone`/`input`/`swipe.area`/`scroll.at` 及部分 fallback 走 hypium native（**exact**，`BY.text(val)` 不传 MatchPattern——而 hypium `BY.text(txt, mp)` 本就支持 CONTAINS 等，透传即可） | `api/selector_ops.py:50/62`（uses_resolver/uses_native_only 定义；`api/agent.py` 为调用点）、`drivers/hypium/driver.py:178`、`hypium/uidriver/by.py:133` | 同一谓词此处命中彼处 miss；规划者无从写出稳定脚本（实锤案例 3 的 miss 根源之一） |
| B-3 | `wait_gone` 丢弃 `wait_for_component_disappear` 返回值——语义**反向**（超时返回控件对象、消失才返回 None） | `drivers/hypium/driver.py:576` | 消失断言**永不失败** |
| B-4 | toast 链四连坏：①动作前未按 hypium 协议 `start_listen_toast()` 预监听；②`check_toast` 的**布尔返回被丢弃**（`_try_once` 调用后无条件 `return True`，仅异常算失败）；③内层吞异常，外层拿不到真实错误；④单次检查可阻塞整个 timeout，之后再查已错过 Toast ~2s 生命周期 | `drivers/hypium/driver.py:590-636`（`start_listen_toast` 全文零调用，已核） | 同一实现同时具备假阴（实锤案例 2）与假阳（返回 False 的环境）两种失败形态 |
| B-5 | match 枚举 fail-open：只识别 `"exact"`，**其余任何字符串（含 `starts_with`、拼写错误）静默按 contains**；且 `resolve_one` 多候选时**默认取第一个**、不报歧义 | `api/selector_resolve.py`（`_text_matches` 仅特判 exact；`resolve_one` 返回 `hits[0]`） | "exact 失败改 contains"可能从"找不到"劣化为**"点错但不报错"** |
| B-6 | 富文本子段不可寻址：Text+Span 拼接呈现为单节点+拼接文本，可点击 Span 无独立节点/bounds；现有"抬升到 clickable 祖先再点中心"的逻辑可能碰巧点中、也可能点到普通前缀，字体/换行/屏宽一变偶然成功即失效 | 组件树粒度层（`api/selector_resolve.py` 的 hit 抬升逻辑）；佐证=实锤案例 3 报错形态与 ArkUI Span 渲染模型（该宿主 dump 未留存，建议复现确认） | 协议勾选、富文本内链**整类交互**无法可靠自动化 |

### C 域：Evidence 模型

| # | 缺陷 | 坐标 | 后果 |
|---|---|---|---|
| C-1 | 无完整 step result ledger：`tool_calls` 是**成功后才追加**的命令日志——无 step index、无每步 outcome/duration、失败步骤可能不在其中、无 selector 引擎/匹配模式/候选数/命中 bounds；`CaseResult` 只有 `{status, notes}`，trace `cases[]` 只有 `{id, status}` | `scenario/runner.py`、实测 trace.json | "通过"不可事后验真——A/B 域的空断言因此潜伏 |
| C-2 | expected-check 模式不落盘：无 VLM 时"预期结果"列不自动校验**已有文档披露**、且存在显式 `--skip-assert-expected` 旗标（我方本次即使用），但 trace 不记录 `checked_vlm / disabled_by_flag / unavailable_no_vlm / empty` 中哪一种——消费方无法区分"断言通过"与"根本没断言" | `scenario/runner.py:168-171` | 弱化旗标的使用无法被产物审计（我方门禁只能靠扫命令行旗标兜底） |
| C-3 | 失败取证有（dump+截图），断言**成功**零留证 | `api/failure_diag.py` 仅失败路径 | 通过侧证据链单薄 |

### D 域：Capability / Error 分类

| # | 缺陷 | 后果 |
|---|---|---|
| D-1 | 失败/跳过不分型：assertion mismatch、no match、selector 歧义、inline target 不可寻址、能力不支持、driver/工具链故障、设备不可用、主动 skip 混在字符串 notes 里 | 消费方无法路由（"工具不支持"和"产品没出预期"都变 skip/失败）；我方门禁被迫做启发式归因 |

## 四、需求（按优先级；每条附验收）

### P0（正确性根基）

**P0-1 `wait_for`/`wait_gone` 消费底层返回值**：None/对象按各自语义判定，失败抛含 selector 与 timeout 的异常。
验收：断言不存在 id 的 wait_for 必失败；对常驻元素的 wait_gone 必失败。

**P0-2 Toast 重做为正确的行为契约**（实现方式由 Hylyre 选择）：**Toast 观察必须覆盖触发动作的时间窗口；必须判定底层真实结果（布尔返回不得丢弃、内层异常透传）；"能力不支持"与"文案未出现"必须区分**。可选实现：runner lookahead / trigger+assert 原子步骤 / 预监听（`start_listen_toast()`）/ 必要时再补 dump fallback——本需求不预设具体通道。诚实定位：当前证据首先证明的是 0.3.2 **未按 hypium 协议预监听**，尚未证明"正确预监听后仍假阴"；只有修正监听后实测仍失败，才把 dump 双通道升级为强制。
验收：真实弹出的 Toast 判通过、不弹必失败（两方向各一条回归）；检测通道与结果落盘可审计；**确定的 capability unsupported → `skipped/blocked` 且 `failure_kind=capability`；普通"文案未出现" → assertion failure，不得记 skip**。

**P0-3 引入 assertion coverage**：verified pass ≥ "执行完成 ∧ 至少一个有效断言（或已检查 expected）∧ 全部必需断言通过 ∧ 断言证据完整"。纯动作序列只能得 `execution=completed / verification=inconclusive`，**不得**冒充 verified pass。
验收：touch→swipe→back 无断言用例不再输出"通过"语义。

**P0-4 统一 selector match 契约**：所有路径（native/resolver/fake）同一套模式枚举——**P0 只要求 `exact/contains` 两值**（native 侧映射 hypium MatchPattern 透传；`starts_with/ends_with/regex` 移入 P2，两个宿主事故不需要它们）；**非法枚举值硬失败**（今天 `starts_with` 静默变 contains 必须消灭）；每次匹配的 `requested_match/effective_match/engine` 落盘。
验收：同一谓词在 touch 与 wait_for 路径结论一致；`match:"typo"`、`match:"starts_with"` 均报错而非静默 contains。

**P0-5 action 多候选 fail-closed**：正式执行中 action selector **默认 require_unique**——contains 命中多个候选即失败（报 candidates 摘要）；需要消歧时**复用既有 `index / scope / within / all` 键**，不新增 `candidate_policy` 字段。
验收：两个可命中元素时 touch 必失败并列出候选；带 `index`/`within` 消歧后通过。

**P0-6 富文本片段寻址（fail-closed，不做估算）**：能取得**真实的**独立 Span/语义 action/片段 bounds → 点击并留证；否则返回结构化 `inline_target_unresolvable`——**禁止退化为点击整段 Text/Row 中心，也不做"字符区间 × 节点 bounds 线性估算"类坐标推测**（比例字体/中文标点/字距/换行/RTL/字号任一因素都会让估算点错，且会把"明确不可寻址"劣化为"不稳定坐标点击"）。不可寻址的正道是回宿主产品补独立锚点。成功点击须以后置 anchor（如协议页元素）证明真正命中链接。OCR/字形布局定位可作**非阻断探索项**，不入本需求。
验收：样张"普通段+可点击段"——有真实片段信息时点协议段触发 onClick、点普通段不触发；不可寻址时得到 `inline_target_unresolvable` 而非任何形式的中心/估算点击。

**P0-7 verdict 三轴拆分（Hylyre 侧）**：`execution(completed|aborted|infrastructure_failed) × verification(passed|failed|inconclusive) × evidence(complete|incomplete)`；对外兼容旧"通过/失败/跳过/阻塞"作投影。**`coverage` 不在 Hylyre 轴内**——acceptance/checkpoint/P0 分层/required elements/NFR 与视觉轴只有 Maison 知道，coverage、quality axes 与 release verdict 由 Maison 基于 `steps[]` 自行计算；Hylyre 至多陈述"本 case 计划了几个 assertion、实际执行了几个"。
验收：三轴出现在 trace；旧 schema 可兼容**读取**（注意：行为结果必然变化——历史假通过会变失败，这是**有意的兼容破坏**，不承诺"零破坏"）。

### P1（可审计性）

**P1-8 完整 step result ledger（含 D 域与 evidence 轴的正式落点）**：唯一真源 `cases[].steps[]`。**下列为 schema 新增/变更字段**——既有 case identity（id / priority / ac_ref / notes）与旧"通过/失败/跳过/阻塞"兼容投影字段继续保留，实施者不得把 CaseResult 误解为只剩这几个字段。最小接口冻结如下（与 Maison 消费侧对齐，双方不得各自扩义）：

```ts
CaseResult {
  execution: "completed" | "aborted" | "infrastructure_failed";
  verification: "passed" | "failed" | "inconclusive";
  evidence: "complete" | "incomplete";          // P0-7 三轴之三——缺此字段则 Maison
                                                // 承诺消费的 evidence 轴无落点
  expected_check_mode: "checked_vlm" | "disabled_by_flag"
                     | "unavailable_no_vlm" | "empty";
  steps: StepResult[];
}
StepResult {
  index; kind;
  role: "action" | "assertion";      // assertion coverage 的唯一稳定判据——
                                     // 否则两侧各自维护"哪些 kind 算断言"的清单必然漂移
  status: "passed" | "failed" | "blocked" | "skipped";
  failure_kind?: "assertion" | "selector" | "capability" | "infrastructure";
  failure_code?:                     // 两级分类的第二级——机器字段而非注释，
    | "assertion_mismatch"           // 否则消费方仍只能解析 error 字符串做精细归责
    | "selector_not_found"
    | "selector_ambiguous"
    | "inline_target_unresolvable"
    | "capability_unsupported"
    | "device_unavailable"
    | "driver_failure";
  duration_ms;
  selector?: { engine; requested_match; effective_match; candidate_count; selected_id; bounds };
  evidence?;                         // 非 selector 型断言的通用证据落点：Toast 检测通道
                                     // 与实际文本/事件、富文本 resolution_kind 与 fragment
                                     // bounds、absence 断言取证、其余 assertion 成功证据
  error?;
}
```

消费约定：Maison 先按 `failure_kind` 做稳定大类路由，仅需精细归责时才看 `failure_code`；**不以 `error` 字符串做主路由**。`failure_kind/failure_code` 是 D 域缺陷的正式需求落点。`tool_calls` 与 Markdown 报告由 `steps[]` 派生，禁止双真源。
**P1-9 trace 记录环境**：Hylyre/Hypium 版本、selector engine、match mode、候选数与命中证据。
**P1-10 expected-check 模式显式落盘**：上表 `expected_check_mode` 四态入 trace。
**P1-11 conformance suite（非全笛卡尔积）**：core adapter contract 覆盖 native/resolver/fake 的正反例；plan、steps、CLI、MCP 四个入口**各至少一条**生产接线测试——不要求穷举全组合（取代人工审计表——一次审计会过期，套件不会）。
**P1-12 trace schema 收紧**：status 枚举、case/step 唯一性、trace/report 集合严格一致。

### P2

**P2-13** 在 P0-1/P0-4 稳定后再考虑独立的 `assert_visible/assert_gone/assert_text` 原语（先修现有 wait 语义，避免新旧两套并存）。
**P2-14** 证据文本脱敏（账号/金额等不入 trace 明文）。
**P2-15** 版本递增与迁移说明：P0 各项均为行为破坏性变更（历史通过率将下降——这是期望效果）；0.3.3 还是 0.4.0 由 Hylyre 的 0.x semver 策略定，CHANGELOG 须明示语义收紧点。
**P2-16** match 模式扩展：`starts_with / ends_with / regex`（自 P0-4 移入；引入时纳入同一枚举校验，非法值同样硬失败）。
**P2-17** OCR/字形布局级片段定位探索（自 P0-6 移出，非阻断）。

## 五、Maison 侧责任与配合（对等承诺，非"无需配合"）

- **expected 检查判定改凭产物**：我方不再从命令行旗标推断 expected 是否被检查，改为消费 `expected_check_mode`；是否继续传 `--skip-assert-expected` 由运行策略决定（无 VLM 时删除旗标也不会自动产生 expected 断言）。既有 WEAKENING_FLAGS 监控保留为兜底。
- **显式书写 match 与消歧**：P0-4/P0-5 落地后，派生计划与视觉导航配置统一显式书写 `match` 模式（动态文本 contains、功能入口 exact——由 acceptance 意图决定，不外包给执行器默认值），需要消歧时用既有 `index/scope/within/all` 键（action 默认 require_unique 是 Hylyre 契约，我方不重复声明）。
- **富文本按责任分流，不统一记 skip**：合同（ui-spec/contracts）要求独立 target 而产品未挂载 → 回 coding 补锚点；合同未定义该交互目标 → 回 spec/plan；平台确实无法暴露片段 → capability defer——三类各走既有责任路由。
- **门禁消费三轴、coverage 自算**：我方消费 Hylyre 的 `verification/evidence`（与 `failure_kind`），基于 acceptance/checkpoint 对 `steps[]` **自行计算 coverage** 与 quality axes/release verdict——Hylyre 不输出 acceptance coverage，我方也不向 Hylyre 提供 coverage 输入格式。
- **单一真源纪律**：`steps[]` 上线后我方退役自有 runtime telemetry monkey-patch，不再维护第二份 runtime 证据；以 minimum Hylyre version + trace schema + StepResult 必需字段三重判据划界，旧 0.3.2 的 `wait_for/wait_gone/toast` 型"通过"标记为不可复用证据（不删历史）。
- 本次实测所有结论我方已按证据强度重新标注，未把工具链缺陷计为应用缺陷。
