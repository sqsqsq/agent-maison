# Hylyre 0.5.1 CLI 选项穿透与静默忽略根治需求

- 提出方：Maison framework（hmos-app profile 以 source vendor 方式集成 Hylyre）
- 目标版本：**Hylyre 0.5.1**
- 问题基线：**Hylyre 0.5.0**（`source.tree_sha256 = 8f00a37f2fc08237e21d5523ddd77d084eac90597cd9e9a3770dc76f9924d38d`，309 文件）
- 冻结契约：**`contracts_tree_sha256 = cc738c272324022d7ed559340e9c710f9b7f5f94aac62c5dd70042e827a21bae`（本次仅允许因 §四 P2 (a) 新增 golden 而变更，其余字节零变化；见指纹条款）**
- 目标结果协议：**`hylyre.step-outcome/1`（不变）**
- 目标 trace schema：**`0.4-p0`（不变）**
- 关联需求：`docs/vendor/hylyre-0.5.0-执行观测与结果反馈协议重构需求.md`
- 关联历史需求：`docs/vendor/hylyre-断言与证据完整性需求.md`、`docs/vendor/hylyre-0.4.1-结构化Selector身份脱敏修复需求.md`
- 真实回灌：SimulatedWalletForHmos / `bc-openCard-1` / run `20260901T173347Z-253`
- 日期：2026-09-02

## 一、结论与优先级

0.5.0 交付的 Step Outcome Protocol v1 本身没有被本需求推翻。本次暴露的是 **CLI 层的选项穿透缺陷**：`hylyre run` 把 20 个选项声明在同一个共享 callback 上（`cli/__main__.py:179-293`），再由三条执行路径——plan、steps report、steps 非 report（`--steps` 与 `--steps-file` 在 `:308-320` 合流）——各自手工挑选转发；任何一条路径漏转，调用方都得不到任何提示。

### P0-1 `run --plan` 声明 `--on-fail` 但静默忽略

`hylyre run --plan` 的 help 中包含 `--on-fail`，并向调用方承诺 `abort|skip` 两种语义，但 plan 路径根本没有把该值传下去。plan 模式本身没有任何 on-fail 语义：case 内根失败后，后续步骤记 `blocked/prior_step`，随后继续执行下一个 case（`scenario/runner.py:311-333`、`:361-411`）。`--on-fail` 传任何值都不改变这一行为；传入非法值（例如 `--on-fail bogus`）同样被静默吞掉，连 steps 路径已有的 `on_fail must be abort or skip` 校验都不会触发。

**这是第二个"选项声明了、单一路径不穿透"的同类缺陷。** 第一个是 `run --steps-file --use-fakes`——声明了 fake 模式却仍去连第一台真实设备（`cli/commands/steps_cmd.py:169-171` 的注释保留了这段历史），已由 0.5.0 修复件修掉。同一类缺陷在同一个 callback 上出现第二次，说明它不是笔误，是缺少机制。

### P0-2 结构性：建立"选项所有权"矩阵，杀掉这一类

本需求的主诉求不是把 `on_fail` 补进 plan 路径，而是要求 Hylyre 为 `run` 的每个声明选项登记**默认值与支持路径**，并用一条与 Typer 实际声明集合对账的 conformance 断言：任何"非默认有效值落入不支持路径"都必须响亮拒绝，任何未登记的声明选项都必须让测试自动变红。杀掉这一类，而不是杀掉这一个。

该矩阵由 Hylyre 上游仓库维护和运行；Maison 只对发布件做消费边界 smoke（§八）。

同一次扫描中已发现若干疑似同类候选（§2.3），Hylyre 必须逐条裁定归属，而不是只修 `on_fail`。

### P1 发布纪律：本次必须发 0.5.1

Maison 记录：0.5.0 的首个交付件因 `--steps-file --use-fakes` 缺陷，在接入前即被**同版本**修复件替换；Maison 实际接入的是修复件（commit `b69ce0eb` "接入 0.5.0 修复件"，tree `8f00a37f…`）。本次是第三次触碰同一版本号，**不得再以 0.5.0 同版本替换**。Maison 以 `source.tree_sha256` 绑定发布件，同版本不同 tree 会直接破坏版本链对账。

### P2 golden 与 fake runner 缺 by_id presence 通过态

冻结契约包没有一份 `by_id` presence 通过态的 golden，fake runner 离线也产不出；Maison 的 P0 绑定门因此只能靠 golden 片段拼接夹具。要求新增一份 shared-session 完整 case golden 与 FakeUiDriver 可配置 presence，并冻结"仅因新增 golden 变更指纹"的例外条款。详见 §四 P2。

## 二、复现证据

以下行号引自 Maison 当前 vendored source（`profiles/hmos-app/vendor/hylyre/src/`，tree `8f00a37f…`）。

### 2.1 声明处

`cli/__main__.py:206-210`：

```python
    on_fail: str = typer.Option(
        "abort",
        "--on-fail",
        help="abort: stop on first error; skip: record error and continue.",
    ),
```

该选项声明在 `run` 的共享 callback `run_plan_batch` 上（`@run_app.callback(invoke_without_command=True)`，`:179`），因此 `hylyre run --help` 对 plan / steps 呈现同一份 help，`--on-fail` 及其 `abort|skip` 承诺对 plan 模式同样可见。

### 2.2 各执行路径的实际穿透

| 执行路径 | 调用点 | `on_fail` |
| --- | --- | --- |
| steps report 模式 | `cli/__main__.py:356-373` → `run_cmd.execute_steps_scenario(...)` | 传递（`:369`） |
| steps 非 report 模式 | `cli/__main__.py:385-397` → `steps_cmd.execute_run_steps(...)` | 传递（`:391`） |
| **plan 模式** | `cli/__main__.py:436-452` → `run_cmd.run_scenario(...)` | **未传递** |

`:436-452` 的完整调用参数为 `plan / feature / report_out / trace_out / use_fakes / device_sn / bundle / page_name / wait_time / mock_port / lyrebird_url / mock_group / skip_assert_expected / model_backend / failure_dir`——`on_fail` 不在其中。

下游签名同样无处承接：

- `cli/commands/run_cmd.py:346-364` `def run_scenario(...)` 参数表无 `on_fail`；
- `scenario/runner.py:278-292` `async def run_plan_on_agent(...)` 参数表无 `on_fail`。

对照 steps 路径，`cli/commands/steps_cmd.py:30-34` 存在校验：

```python
def _normalize_on_fail(raw: str) -> str:
    s = raw.strip().lower()
    if s in ("abort", "skip"):
        return s
    raise ValueError("on_fail must be abort or skip")
```

该校验只在 steps 路径生效。plan 路径既不消费值，也不校验值。

### 2.3 同一次扫描发现的疑似同类候选

除 `on_fail` 外，以下组合同样存在"声明可见但该路径未转发"的形态，均可静态确认。Hylyre 必须在所有权矩阵中逐条裁定归属，**不接受维持现状的静默**：

| 选项（声明行） | 未消费的路径 | 证据 |
| --- | --- | --- |
| `--session`（`:219`） | plan | `:436-452` 调用无 `session` |
| `--out`（`:213`） | plan、steps report | 仅 `:402-405`（steps 非 report）写出；`:356-373`、`:436-452` 均不消费 |
| `--mock-group`（`:275`） | steps report、steps 非 report | `:356-373`、`:385-397` 调用无 `mock_group` |
| `--skip-assert-expected`（`:280`） | steps report、steps 非 report | 同上，无 `skip_assert_expected` |
| `--model-backend`（`:285`） | steps 非 report | `:385-397` 调用无 `model_backend` |

另有一条**结构性**路径：callback 在 `:297-298` 以 `if ctx.invoked_subcommand is not None: return` 提前返回。这意味着 `hylyre run --on-fail skip tap --json ...` 这类写法中，callback 上的 **20 个选项全部被接受后静默丢弃**。`run` 下共 17 个真实子命令：6 个直接注册（`action / tap / input / swipe / scroll / start-app`，`:455-651`）与 11 个动态注册（`cli/tier_a_run_commands.py:13-24` 的 10 个 tier-A 命令加 `:90` 的 `start-app-step`）。各子命令各自声明自己的选项（例如 `--session` 在 `:468 / :496 / :524 / :556` 各声明一次），与 callback 不共享，但 callback 选项在子命令调用形态下的静默丢弃仍属于本需求要根治的同一类。

Maison 不预判其中哪些是缺陷。本条的要求是：裁定结果必须落在 §四 P0-2 的所有权表里成为断言，并在交付报告中给出最终归属摘要，而不是留在口头结论中。

### 2.4 行为后果

调用方（含 Maison harness、人工排障、任何按 help 编写的脚本）在 plan 模式下写 `--on-fail skip`，得到的是与不传该选项完全相同的 run，且没有任何 stdout/stderr/trace 信号提示该选项被丢弃。Maison 在 run `20260901T173347Z-253` 的排障中据此发现该缺陷；上文静态证据独立于该 run 成立。

这类缺陷的危害不在于某一次 run 结果不对，而在于**调用方对执行语义的认知与实际执行不一致，且不可观测**——与 0.5.0 要根治的"信封正确、内容非法"属于同一族。

## 三、根因

不是某一行漏写，而是三条结构性成因叠加：

1. **选项声明与选项消费在不同层**。选项在 `run` 的共享 callback 上全局声明一次，消费发生在三条互不相交的分支里，编译期/类型层没有任何东西把两者绑在一起。
2. **穿透是手工的**。每条路径手工列举要转发哪些参数，新增路径或新增选项时，遗漏是默认行为，不是异常行为。
3. **没有契约测试保证每条路径都"消费或拒绝"**。vendored source tree 不含测试；Maison 侧的 entry-conformance 覆盖的是 Step Outcome 语义与 pre-run reject 四要素，不覆盖"CLI 声明面 → 执行面"的完整性。Maison 记录中两次同类缺陷都是在真实 run 中被发现的，不是被任何自动化捕获的。

结论：只补 plan 路径的 `on_fail` 不构成修复，只是把第三次撞见推迟到下一个选项。

## 四、必须实现的契约

### P0-1 plan 模式下的 `--on-fail` 必须响亮

**冻结最小方案：保留共享选项、修 help、非默认值拒绝。** 不拆 callback、不从 plan help 面移除选项。

**拒绝规则。** plan 模式收到**有效值非默认**的 `--on-fail`（即 `abort` 以外的任何值，含 `skip` 与非法值）时，必须在**接触设备之前**响亮拒绝并以非零码退出。

判定以**有效值**为准：`--on-fail abort`（无论显式传入还是取默认）在 plan 模式下属于 **default-compatible**（定义见 P0-2），照常执行，与不传该选项行为一致。不要求区分参数来源，不得为此引入 typer 层的参数来源探测。

**拒绝形态：CLI usage error。** stderr 单行明确信息（须点名 `--on-fail` 与 `--plan` 不兼容）、`exit=2`、零设备调用、不创建 `--report-out` / `--trace-out`、stdout 为空。与 callback 上既有的 `Cannot combine --plan with --steps/--steps-file.`（`:301-305`）同形。

**help 必须同步修正。** 当前 `:209` 的文案 `abort: stop on first error; skip: record error and continue.` 对 plan 模式是虚假承诺。修正后的 help 必须写明：`abort|skip` 只适用于 `--steps/--steps-file`；`--plan` 仅接受默认 `abort`，其它值为 usage error。

**明确排除 pre-run reject 机器协议形态。** 0.5.0 冻结的 `pre_run_reject` 要求 `rejection.code` 取自封闭枚举 `preRunRejectCode`（`contract.empty_case / invalid_step / invalid_selector / invalid_match`，`contracts/output-schema.json:1299-1307`）。该文件位于 manifest 的 contracts 清单内（`release.manifest.json:1311-1313`），扩枚举即修改 `output-schema.json`，而本需求要求 schema 字节零变化（P2 指纹条款只放行新增 golden，不放行 schema / spec / 判定表改动）；复用既有四个值中的任何一个又与"CLI 选项冲突"的语义不符。因此 usage error 是本需求内**唯一**可行形态。

**明确禁止的做法**：把 steps 的 `skip` 语义搬进 plan。0.5.0 已冻结——plan 内根失败后，同 case 后续步骤记 `blocked` + `cause.type=prior_step`。在 plan 内实现"记录错误并继续执行"会直接破坏该账本语义，把本应 `blocked/prior_step` 的后缀步骤变成实际执行过的独立结果；Maison 的 failure routing 依赖该冻结语义（`harness/tests/unit/hylyre-failure-routing-v1.unit.test.ts:80-96` prior_step 不重复投影、`:129-136` 多个真实 failed 各自一条 route），会随之失真。**本需求不请求该能力，Hylyre 不得顺手实现。**

### P0-2 选项所有权矩阵

**所有权表。** 为 `run` callback 的每个声明选项登记：

- 默认值；
- 支持路径集合 ⊆ `{plan, steps_report, steps_raw, subcommand}`。

**四类归属。** 对每个"选项 × 路径 × 有效值"组合，归属恰好为下列之一：

- **consumed**：该路径在支持集合内，值真实到达执行层并改变行为——以行为差异或调用边界 spy 证明，不接受"参数出现在调用里"这种形式检查；
- **default-compatible**：该路径不在支持集合内，但有效值等于登记默认值——允许通过，不探测参数来源。`plan × on_fail=abort` 即属此类；子命令前显式传 `--wait-time 1.0` 等同理；
- **rejected**：该路径不在支持集合内，且有效值不等于默认值——必须 usage error、`exit=2`、零设备；
- **invisible**：该选项在该路径的 CLI 声明面不可见（typer 直接报 unknown option）——登记本身即断言其不可见。

任何落不进四类的组合——即"声明可见、非默认值、不消费、也不拒绝"——**测试即失败**。

**与 Typer 实际声明集合对账。** 测试必须从 Typer/Click 的 command model 读取 `run` callback 当前实际声明的选项集合，断言其与所有权表的键集**完全相等**。新增第 21 个 callback 选项而忘记登记时，测试自动变红；表中登记了已删除的选项时同样变红。

**实现形态（约束，不是建议）。** 不手写 20×17 物理用例：

1. 一个参数化循环覆盖全部"不支持路径 × 非默认值"，断言 usage error；
2. 支持路径用行为差异或调用边界 spy 证明值真实到达；
3. 17 个 `run` 子命令各自声明的选项做参数化 direct-binding 检查，证明子命令面不存在"共享声明、手工穿透"结构；
4. 全部零设备。

**范围。** 所有权表必须裁定 §2.3 全部候选（含 `--out`）与子命令调用路径（`:297-298`）的归属，并在交付报告中给出最终归属摘要。

**位置。** 矩阵测试与 fixture 留在 Hylyre 上游仓库维护运行，不要求随 source 发布件交付；发布件内 `src/hylyre/contracts/` 除 P2 (a) 新增 golden 外**不得新增或修改任何文件**——该目录受 `contracts_tree_sha256` 保护，唯一例外见 P2 指纹条款。

### P2 golden 与 fake runner 缺 by_id presence 通过态

**事实。** 冻结契约包 `golden/trace/valid/` 共 12 份，没有任何一步是 `by_id` 请求的 presence 断言通过态：唯一的 presence passed 步骤是 `all-passed.json` TC-OK-1 step 1，其 `selector=null`；其余 valid golden 的 `wait_for` 一律 `blocked`。`run --plan --use-fakes` 离线时同样产不出：`wait_for` 只落 `blocked` + `cause.type=capability` / `capability.not_configured`（`capability_id=fake.ui_observation`），`selector` 全 `null`，其后的 `wait_gone` 顺势 `blocked/prior_step`。

**后果。** Maison 的 P0 绑定门（plan 步骤 `by_id` 字面绑定 checkpoint 元素 → native `selector.request.kind=by_id ∧ request.value==element id ∧ resolution.state=unique ∧ candidate_count=1 ∧ selected.id==element id`；forbidden 为 `not_found ∧ candidate_count=0 ∧ selected=null`）离线拿不到一份逐字 golden 正例。当前只能用 **contract-composed fixture**——信封与 case 逐字取 `all-passed.json`、步骤逐字取 golden step/selector fixture 拼接，先过生产 `requireV1ForGate`（冻结 Schema + 跨行 verifier）与 native evidence gate 才作夹具——见 `harness/tests/unit/testing-stepresult-evidence.unit.test.ts:1144-1160`。拼接体合法，但它不是上游冻结的单份 golden，Maison 无法用"逐字相等"钉住它。

**要求 (a)：新增一份 shared-session 完整 case golden。** `golden/trace/valid/` 新增一份 v1 trace（建议名 `shared-session-by-id-presence-absence.json`），单 case、`execution=completed / verification=passed / evidence=complete`，步骤恰为：

1. `by_id` action（`touch`）：`outcome=passed`，`resolution.state=unique / candidate_count=1 / selected.id==request.value`；
2. `by_id` presence 断言（`wait_for`）：`outcome=passed`，`observation.assertion_type=presence / matched=true / facts.observed_present=true`，`resolution.state=unique / candidate_count=1 / selected.id==request.value`；
3. `by_id` absence 断言（`wait_gone`）：`outcome=passed`，`observation.assertion_type=absence / facts.observed_present=false`，`resolution.state=not_found / candidate_count=0 / selected=null`。

`tool_calls` 为 steps[] 的投影；整份文件必须通过 `reference_reducer.py::verify_trace` 与 `output-schema.json`，并作为 valid golden 进入既有 golden 全集断言。这恰是 Maison 绑定门消费的形状，不多不少；不要求 expected_check、不要求 artifacts。

**要求 (b)：FakeUiDriver 支持可配置 presence。** `run --plan --use-fakes` 离线时允许调用方声明"哪些 id 在场"（fake fixture 文件或等价配置，形态由 Hylyre 定）：声明在场的 `by_id` → `wait_for` passed 且 `resolution=unique/1/selected.id`；未声明的 `by_id` → `wait_gone` passed 且 `resolution=not_found/0/null`；不提供配置时保持当前 `blocked/capability.not_configured` 行为不变。该配置若以 `run` 选项承载，必须登记进 P0-2 的所有权表并接受同一矩阵断言——不得再出现"声明了、某路径静默忽略"。

**指纹条款（本需求唯一的指纹例外；文首、P0-1、P0-2、§五、§七、§八、§九 均已显式引用本条）。** 新增 golden 文件会改变 `contracts_tree_sha256`。本需求**允许且仅允许**因新增 golden 文件而变更该指纹：`output-schema.json`、`step-outcome-v1.md`、`builder-decision-table.md`、`report-sections.yaml`、`reference_reducer.py` 及全部既有 golden **字节零变化**；交付附 contracts 目录差异清单（只增、不改、不删）与新指纹值；Maison 侧随之更新 `harness/tests/fixtures/hylyre-contracts-0.4-p0/` 冻结包与 `contracts_tree_sha256` pin。若 Hylyre 选择不在 0.5.1 交付 (a)，则指纹维持 `cc738c27…` 不变，本条款不生效，(a)(b) 顺延并在交付报告中说明。

**Maison 联调。** (a) 到位后，Maison 用逐字 golden 替换 contract-composed 拼接夹具（保留拼接路径作为"上游缺形状时"的兜底说明，不再作正例）；(b) 到位后，`testing-stepresult-evidence` 的 vendor fake runner 用例增加一条"声明在场 id → 离线 passed 且过两道生产门"。

## 五、非目标

本需求不要求，且明确禁止顺手实现：

- **不新增 case-level teardown 状态机**。Maison 侧先用既有 `stop_app` / `start_app` 做受限 reset；不够用时另提需求，不在本次夹带。
- **不改 Step Outcome 协议、trace schema、spec、判定表、reducer 与既有 golden**。contracts 目录仅允许 P2 (a) 只增不改不删（见指纹条款），未交付 (a) 时 `contracts_tree_sha256` 仍为 `cc738c272324022d7ed559340e9c710f9b7f5f94aac62c5dd70042e827a21bae`。P0-1 已据此（schema 零变化）排除 pre-run reject 形态；P0-2 已据此禁止向 `contracts/` 添加 P2 (a) 以外的任何文件。
- **不在 plan 内实现 `skip` 执行语义**（见 P0-1）。
- **不动 selector 协议与隐私脱敏边界**。
- **不拆共享 callback、不重构 CLI 参数体系**。P0-1 已冻结为"保留共享选项、修 help、非默认值拒绝"；P0-2 要求的是所有权断言，不是把 typer callback 推倒重写。
- **不要求 Hylyre 向 Maison 交付测试源码、fixture 或独立测试包**。Maison 只验证发布件的消费边界（§八）。
- **不新增 Maison 侧消费面变更**。修复后 Maison 的解析、gate、routing 均不需改动。

## 六、Conformance 回归矩阵

全部零设备。

### 6.1 P0-1 直接回归

1. `run --plan ... --on-fail skip` → usage error：stderr 单行点名 `--on-fail`/`--plan`、`exit=2`、零设备调用、不创建 report/trace、stdout 空。
2. `run --plan ... --on-fail bogus` → 同上拒绝路径，不得被当作合法值静默接受。
3. **fake 下逐字节一致**：`run --plan <P> --use-fakes --on-fail abort` 与 `run --plan <P> --use-fakes`（同一 plan、同一输出路径）产出的 report 与 trace **逐字节一致**。该要求只限 `--use-fakes`；真机 `duration_ms` 等本来就会变化，不做逐字节比较。
4. `run --plan ... --use-fakes`（不传）→ 照常执行，作为 3 的对照基线。
5. `run --help` 输出含修正后的 `--on-fail` 文案：`abort|skip` 限 `--steps/--steps-file`、`--plan` 仅接受默认 `abort`。

### 6.2 `on_fail` 既有语义不回退

6. `run --steps ... --on-fail abort|skip` → 语义不变，与 0.5.0 基线一致。
7. `run --steps-file ... --on-fail abort|skip` → 语义不变。
8. `run --steps-file ... --on-fail bogus` → 仍由 `_normalize_on_fail` 拒绝，行为不变。
9. steps report 模式 `--on-fail` 语义不变。
10. MCP / session 路径的 `on_fail` 语义不变（`mcp/server.py:555-638`、`session/daemon.py:107-117` 现有传递不得被本次改动波及）。

### 6.3 P0-2 所有权矩阵

11. **声明集合对账**：从 Typer/Click command model 读取的 `run` callback 选项集合与所有权表键集完全相等。
12. **参数化拒绝**：全部"不支持路径 × 非默认值"组合 → usage error、`exit=2`、零设备。
13. **default-compatible 放行**：全部"不支持路径 × 默认等价值"组合 → 照常执行，行为与不传一致。
14. **支持路径到达**：全部"支持路径 × 非默认值"组合 → 行为差异或调用边界 spy 证明值真实到达。
15. **负例自检（自动化，不改生产源码）**：二选一或两者皆做——(a) 构造一份缺项/错误归属的所有权 fixture，断言对账 validator 失败；(b) monkeypatch 一个 dispatch spy 使其不消费某参数，断言"支持路径到达"用例失败。不要求开发者手改生产代码、跑测试、再恢复。
16. `--use-fakes` × steps 非 report 的既有修复在矩阵中有对应条目（防止 0.5.0 修复件被后续改动回退）。
17. **子命令调用路径**：`run --on-fail skip tap --json ...`（及任一 callback 选项 × 任一子命令）按四类归属被显式断言，非默认值不得静默丢弃；子命令自身选项的 direct-binding 参数化检查全绿。

### 6.4 既有套件不回退

18. 0.5.0 的 builder / Schema / reducer / verifier 全量 conformance 复跑全绿。
19. 发布关键入口（real plan / fake / steps-file）与 atomic / MCP / session 每入口 smoke 复跑全绿。

## 七、版本与发布要求

### 7.1 必须发布 Hylyre 0.5.1

- `pyproject.toml` / `hylyre.__version__ = 0.5.1`；
- `result_protocol` 保持 `hylyre.step-outcome/1`，trace schema 保持 `0.4-p0`；
- `release.manifest.json` 更新 `hylyre_version`、`source.tree_sha256`、`source.file_count`、`source.total_bytes` 与逐文件清单（path / size / sha256）；
- `release.manifest.json` 的 `contracts_tree_sha256`：**允许且仅允许因 P2 (a) 新增 golden 文件而变更**——schema / spec / 判定表 / reducer / 既有 golden 字节零变化，交付附 contracts 目录差异清单（只增、不改、不删）与新指纹值，Maison 随之更新冻结 fixture 与 pin；未交付 P2 (a) 时保持 `cc738c27…` 不变并显式声明"契约包本次未变更"；
- 逐文件 changelist：本次改动/新增/删除的每个文件及其原因；
- `src/README.md` 的「当前阶段」段落记录本次修复与 `--on-fail` help 语义修正；上游仓库若维护 CHANGELOG 则同步记录，并在交付报告中说明记录位置（当前 vendored tree 内无 CHANGELOG 文件）；
- 发布件内 `src/hylyre/contracts/` 除 P2 (a) 的新增 golden 外无任何新增或修改文件。

**不得以 0.5.0 同版本替换。** 理由见 §一 P1。

### 7.2 source 发布

发布形态不变：plain-source vendor，无需 wheel；package-data 内协议文档 / Schema / builder 判定表 / 既有 golden fixtures 逐字保持（P2 (a) 只增不改）。所有权矩阵测试留在上游仓库，不要求随发布件交付。

## 八、Maison 联调验收

Maison 只验证发布件的实际消费边界，不复跑 Hylyre 的完整所有权矩阵。收到 0.5.1 后 Maison 执行：

1. **版本链三方一致**：`hylyre.__version__`、`pyproject.toml` version、`release.manifest.json` 的 `hylyre_version` 三者均为 `0.5.1`；`source.tree_sha256` 与实际解压 tree 按 manifest 声明算法重算值一致。
2. **契约逐字节比对**：vendored `src/hylyre/contracts/` 与冻结契约包逐字节比对，除交付报告声明的 P2 (a) 新增 golden 外必须逐字节相等；重算 `contracts_tree_sha256` 须等于交付报告声明值（未交付 (a) 时即 `cc738c27…`）。任何未声明的差异即退回。
3. **P0-1 拒绝**：`plan + --on-fail skip` → `exit=2`、零设备、零 report/trace、stdout 空。
4. **P0-1 放行**：`plan + --use-fakes`（默认 `abort`）正常产出 v1 trace，且与 `plan + --use-fakes + --on-fail abort` 逐字节一致。
5. **steps-file + use-fakes 不回归**。
6. **既有 Maison 入口回归全绿**：`harness/tests/unit/hylyre-entry-conformance.unit.test.ts`（pre-run reject 四要素、steps-file + fake）与 `harness/tests/unit/testing-stepresult-evidence.unit.test.ts` 的 vendor fake runner 用例（real plan + fake 经 `requireV1ForGate` 与 native evidence gate 两道生产门）。
7. **Maison 侧消费面零改动确认**：解析、gate、routing、telemetry 均未因本次升级需要修改；若发现需要修改，说明本次改动超出范围，退回讨论。

## 九、Hylyre 交付报告要求

1. 根因分析与改动文件清单（逐文件，含改动原因）；
2. P0-1 的 stderr 文案与修正后的 `--on-fail` help 文案最终稿；
3. P0-2 所有权矩阵结果：**测试命令、passed/failed 数量、结论、失败清单**，以及 §2.3 全部候选（含 `--out`）与子命令调用路径的**最终归属摘要**；负例自检（§6.3-15）的结论。不要求展开全部组合的归属表；
4. §六 其余 conformance 条目的执行结果；
5. 版本号、`release.manifest.json` 新 `source.tree_sha256` / file_count / total_bytes、以及 `contracts_tree_sha256` 的显式声明：未变更（`cc738c27…`），或因 P2 (a) 变更的新值 + 只增差异清单；
6. README / CHANGELOG 的记录位置；
7. 是否存在偏离：任何未按本需求实现、或实现范围超出本需求的部分，逐条列出并说明理由。

## 附：登记不实施

以下一项本次**只登记，不要求 Hylyre 在 0.5.1 中实施**：

### 附-1 `infrastructure.transport_unavailable` 与 Maison 需求文的命名差异

Hylyre 0.5.0 冻结契约中：

- `failure.code`（`failed` 侧）使用 `infrastructure.transport_failure`（`output-schema.json:197-213`）；
- `cause.code`（`blocked` 侧）使用 `infrastructure.transport_unavailable`（`:269-276`）。

Maison 的 `docs/vendor/hylyre-0.5.0-执行观测与结果反馈协议重构需求.md:562-574` 只列举了 `transport_failure`，未区分 cause 侧的 `transport_unavailable`。

**以已冻结契约为准，Hylyre 不需要改任何代码。** Maison 侧回头同步自己的需求文，消除文档与契约的名称落差。此条登记在案，仅为避免后续对账时被当成实现偏离。

（关于 trace root `additionalProperties`：`output-schema.json` 顶层虽为 `true`（`:1452`），但 `0.4-p0` 的 if/then 分支已显式 `additionalProperties: false`（`:101`），v1 root 是封闭的；顶层 `true` 只作用于 legacy/default 分支。不存在需要确认的意图问题，不登记。）
