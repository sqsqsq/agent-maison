# `device-attribution/` — 真机归因四类样本（plan e3c7d95f p0a/p0b/p0c）

2026-07-29 宿主真机 testing 的**五条失败**及其上下文全套落盘产物，脱敏后入库。
消费方是 `profiles/hmos-app/harness/device-test-evidence.ts`（`parseDerivedPlanSteps` /
分类器 / 锚点反解），由 profile 侧 unit 直接读取，不参与契约三件套扫描。

## 为什么必须入库

宿主产品代码 2026-07-30 起**全部回退重写**。重写后真机大概率再也造不出
`enabled=false` 的 `sheet_scaffold-next` 场景，本轮 dump 是**唯一历史样本**。
plan e3c7d95f 因此写明「**fixture 化优先于宿主回归**」——先有单测锁住分类，再跑真机。

## 采集出处

| 项 | 值 |
|---|---|
| goal run | `20260729T123155Z-0c5411`，attempt `i5` |
| 宿主 | SimulatedWalletForHmos / feature `bc-openCard` |
| 设备 | HarmonyOS 真机 `3UJ0225321000395`（`target_kind=physical`） |
| 原始目录 | 宿主 git 内 `doc/features/bc-openCard/testing/reports/20260729T223800Z/hylyre/`（非临时目录） |
| 派生计划版本 | test-plan v1.0.8（2026-07-29） |

## 文件

| 文件 | 原始 | 是什么 |
|---|---|---|
| `sms-verify-next-clipped.json` | 333KB → 62KB | sms_verify 半模态帧，**目标按钮不在此帧**（键盘展开/Sheet 被裁剪） |
| `sms-verify-next-disabled.json` | 220KB → 28KB | 同一屏另一时刻，**目标按钮在且 `enabled=false`** |
| `test-plan.hylyre.md` | 4.8KB 原样 | 派生执行计划全文——`enabled`×4 / `within`×2 / `scope`×5 / `timeout`×21 |
| `trace.json` | 12KB 原样* | 权威失败清单（join 对账）+ `tool_calls.planned_json` 谓词第二来源 |
| `device-test-evidence.misclassified.json` | 4.8KB* | **本轮的误判结果**——5 条全 `test_contract`，作为回归基线的反面 |
| `ui-spec.yaml` | 15KB 原样 | spec 侧真值（「三查」第③查、p0c 反解对齐） |

\* 仅把宿主绝对路径改为仓内相对路径，其余内容原样。

> **「原样」= 内容原样，不是字节原样**：`test-plan.hylyre.md` / `trace.json` / `ui-spec.yaml`
> 三个文件的行尾按仓库 `.gitattributes`（`* text=auto eol=lf`）从 CRLF 规范化为 LF。
> 若要与宿主原件做 hash 比对，须先统一行尾。

`blocks.json` 不在此处——它是 framework 自有件，已在
[profiles/hmos-app/ui-kit/blocks.json](../../../ui-kit/blocks.json)
（`MaisonBottomSheetScaffold.semantic_node = "sheet_scaffold"`，
`required_children = [sheet_header, close_button, content_slot, primary_action_slot]`）。

## 五条失败的真实映射（**ground truth，以此为准**）

步骤索引 0-based，取自 dump 文件名（`TC-xxx-step-N.json`），已与 `test-plan.hylyre.md`
逐条核对：

| case | 失败步骤 | selector（含谓词） | 用的 dump | 目标在**该帧**？ |
|---|---|---|---|---|
| TC-006 | 5 `wait_for` | `by_id ...sms_verify:sheet_scaffold-next` + **`enabled:true`** | clipped | ✗ 不在 |
| TC-007 | 17 `wait_for` | 同上 | clipped（≡TC-006） | ✗ 不在 |
| TC-008 | 1 `touch` | `by_id ...add_success-done` | clipped（≡TC-006） | ✗，且整个 add_success 屏都不在 |
| TC-010 | 2 `touch` | `by_text 查看全部` + **`within {by_id ...card_pack_with_cards:list_card_container}`** | disabled | within 容器不在此屏 |
| TC-011 | 0 `touch` | 同上 | disabled（≡TC-010） | 同上 |

**去重依据（已实测）**：`TC-007-step-17` 与 `TC-008-step-1` **字节相同**；
`TC-006-step-5` 仅与它们差状态栏时钟（10:58 vs 10:59），**脱敏后三棵树完全相同**；
`TC-010-step-2` 与 `TC-011-step-0` 字节相同。故只留 2 个文件，不留 5 份重复。
（三个"不同"的失败共用同一帧，本身就是一条事实。）

> ### ⚠ 勘误：plan e3c7d95f「证据 B」把 case 挂错了
>
> plan 写「TC-010/011 的 dump 里 `sheet_scaffold-next` 存在且 `enabled=false` ⇒ 应归
> `product_state` 而非 `test_contract`」。**前半句对、后半句的归属错**：TC-010/011 的失败
> selector 是 `查看全部`，不是那个按钮——按钮只是**顺带在场**。
>
> 真正 selector = `sheet_scaffold-next` 的是 **TC-006/007**，而它们自己的帧里该按钮
> **不在**。所以「元素在、状态不对」这个结论**跨帧才成立**，在 TC-006/007 各自的
> dump 上单独看不出来。codex 用 TC-010/011 证伪「产品缺元素」是对的（产品确实渲染了它）；
> 但由此推导 TC-010/011 该归 `product_state` 是错的。

## 每个 fixture 必须锁住的期望

### `sms-verify-next-clipped.json` —— **p0b 的陷阱帧（最重要）**

在场（8 个锚点，全 `enabled=true`）：`sheet_scaffold` / `-header` / `-close` / `-content`
/ `sms_input` / `-input` / `-countdown` / `card_select:list_card_container`。
**不在场**：`sheet_scaffold-next`、`-next-label`、`-primary-action`、任何 `add_success-*`、
`card_pack_with_cards:*`、文本 `查看全部`、文本 `下一步`。

**这一帧会让 p0b 现设计的 `product_actionable` 三条件全部满足**：

1. spec 锚点推导 expected screen = `sms_verify` ✓
2. dump 命中该屏他锚点（`sheet_scaffold-header` 等 7 个）✓
3. 仅目标精确形态缺失 ✓

⇒ 判 `product_actionable` ⇒ 回 coding 说「产品缺 `sms_next_btn`」——**这正是人工判读第二轮
犯过的错，会被自动化原样复现**。

**故本 fixture 的断言方向是「必须不判 product_actionable」**：跨 case 证据
（`sms-verify-next-disabled.json`）证明产品**渲染了**该按钮，真性质是
`product_state`（`enabled=false`）。p0b 的落地条件必须体现 plan 自己写的「三查」第②条
——「跨**全部相关 case** 的 dump」，而不是只看当前 case 那一帧。

TC-008 走同一帧但方向不同：期望屏是 `add_success`，dump 是 `sms_verify`，
**expected screen 判据即不满足** ⇒ 应归级联/环境，同样**不得** `product_actionable`。
这条验证 expected-screen 前置守卫有效。

### `sms-verify-next-disabled.json` —— `product_state` 正例 + 跨帧证据

`sheet_scaffold-next` **在场**、`enabled=false`；同层 `-primary-action`、`-next-label`
在且 `enabled=true`；同屏 `sms_input` 系列全 `enabled=true`（对照，证明不是整屏禁用）。
另有非 namespaced 的 `next_step_btn`（`enabled=true`，属另一屏残留）——用于验证反解不串味。

TC-010/011 侧：文本 `查看全部` **0 命中**、`card_pack_with_cards` **0 命中**。
spec 的真实文案是 `查看全部银行`（`expanded_view_all_link`）与 `查看全部 (6)`
（`pack_view_all_cards`）⇒ `test_contract`（测试文案不精确）**判定对**；但
`within` 容器整体缺失 ⇒ 同时是级联。**两个原因不能互相吞掉**——evidence 现在只写了
「selector 无 spec 依据」，把 `within` 丢了（p0a 的丢谓词问题在 `within` 上同样成立）。

### 一条待核实的强线索（**不是结论**，交 p0a/p0b 实现时验）

TC-010 的失败步骤是 **2**，说明步骤 **1**（`wait_for by_id
...card_pack_with_cards:list_card_container`）**通过了**。但同一帧 dump 里
`card_pack_with_cards` **一次都没出现**，只有 `card_select:list_card_container`
——两者的 node 段同名（`list_card_container`），screen 段不同。

⇒ 强怀疑 **selector 匹配不是整锚点精确匹配**（后缀/子串命中了另一屏的同名容器），
于是 `wait_for` 假通过、`within` 作用域的 touch 才失败。TC-011 的第一步就是那个 touch
（无前置 wait_for）、立刻失败，与此一致。

**未核实**（没读执行器源码，不下定性——这批数据我已经错判过两轮）。
本 fixture 恰好可判：树里有 `card_select:list_card_container`、**没有**
`card_pack_with_cards:list_card_container`，写一条「整锚点精确匹配不得命中异屏同名容器」
的断言即可证实或证伪。

## 脱敏说明

**保留**（判据 + 结构必需）：树结构、`id`、`key`、`text`、`originalText`、`bounds`、
`type`、`enabled`、`visible`、`clickable`、`checkable`、`checked`、`selected`、
`scrollable`、`longClickable`、`focused`；外层信封 `schema_version` / `source` /
`_hylyre_hints` 原样（消费方要能按真实产物形状解析）。

**剔除**：运行时 id（`hashcode` / `accessibilityId` / `hostWindowId` / `displayId` /
`hierarchy`）、应用身份（`bundleName` / `abilityName` / `pagePath`）、样式与几何冗余
（`backgroundColor` / `backgroundImage` / `blur` / `opacity` / `origBounds` / `zIndex` /
`clip` / `hitTestBehavior` / `description` / `hint`）；状态栏 / 通知 / 灵动岛整棵子树。

**判据优先剪枝**（生成器内置，防误伤）：子树含 `maison:` / `next_step_btn` /
`sheet_scaffold` / `list_card_container` / `TextInput` / 关键文案（`下一步`、`查看全部`、
`短信验证`、`验证码`、`招商银行`、`请选择要添加的银行卡`）任一，**一律不剪**。

> `_hylyre_hints.scrollable_containers` 里留了一个 `origBounds`——那是键盘容器
> (`left_symbols_list`) 的几何，属真实信封内容、无隐私成分，不剪。

## 隐私边界

**有意保留、并非泄露**：

| 值 | 为什么保留 |
|---|---|
| `serial = 3UJ0225321000395` | `physical` 白名单判据的一部分；且已在仓内多份 plan/openspec 在案 |
| `session_id = testing-i5` | goal run 内部 invoke 身份（**不是**对话 session），身份绑定判据 |
| `input.text = 123456` / `000000` | demo 钱包 app 的**模拟**短信验证码，非任何真实凭据 |

**从未采集**：设备 PIN（人工采证时明确不输入）。
**已剔净**（复扫 0 命中）：绝对路径、用户名、邮箱、应用身份、运行时 id、通知/状态栏、
对话身份字段（`user_email` / `transcript_path` / `conversation_id`）、token 形态串。
截图（`*.png`）**未入库**——含通知栏，且判据全在 JSON 里。

## 生成器自检（必须保留的纪律）

fixture 由脱敏脚本生成，脚本内置**判据保真逐项比对**，脱敏前后必须完全一致：

- `maison:*` 与 `next_step_btn` 的 **id → enabled 映射**（逐键等值）
- 关键文案集合
- `TextInput` 节点计数

任一项不等即 FAIL。上一批 fixture（`harness/tests/fixtures/device-lockscreen/`）的同款自检
**实际拦住过一次误伤**（宽泛 `/Clock/` 正则剪掉了产品自己的容器）。
若将来重采或调白名单，**务必保留此自检**——否则"看起来对"的 fixture 可能已经丢了判据。
