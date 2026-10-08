# 测试计划 — bc-openCard-2/open-card-flow-v2

> **模块标识**: `bc-openCard-2/open-card-flow-v2`
> **版本**: v1.0
> **日期**: 2026-10-08
> **测试负责人**: goal-mode device-testing agent（run `20260928T043051Z-be091c`）
> **对应 spec**: `doc/features/bc-openCard-2/open-card-flow-v2/spec/spec.md`
> **对应设计**: `doc/features/bc-openCard-2/open-card-flow-v2/plan/plan.md`
> **验收 SSOT**: `doc/features/bc-openCard-2/open-card-flow-v2/acceptance.yaml`

```yaml
test_case_flow:
  TC-001: { precondition: { kind: fresh_app, reset: stop_app+start_app } }
  TC-002: { precondition: { kind: fresh_app, reset: stop_app+start_app } }
  TC-003: { precondition: { kind: fresh_app, reset: stop_app+start_app } }
  TC-004: { precondition: { kind: fresh_app, reset: stop_app+start_app } }
  TC-005: { precondition: { kind: fresh_app, reset: stop_app+start_app } }
  TC-006: { precondition: { kind: fresh_app, reset: stop_app+start_app } }
  TC-007: { precondition: { kind: fresh_app, reset: visual_navigation } }
  TC-008: { precondition: { kind: fresh_app, reset: external_perf_sampling } }
  TC-009: { precondition: { kind: fresh_app, reset: external_perf_sampling } }
  TC-010: { precondition: { kind: fresh_app, reset: external_data_injection } }
```

## 一、测试范围

### 测试模块

| 模块名 | 所属层 | 格式 | 说明 |
|--------|--------|------|------|
| WalletMain | 02-Feature | HAR | 开卡入口、卡类型/具体卡/短信 UI、RDB 编排、结果页与钱包首页 |
| AccountManager | 04-BusinessBase | HAR | 验证码半模态使用的 mock 手机号 |
| Phone | 01-Product | HAP | 根 Navigation 与新旧页面 destination 注册 |

### 测试功能点

基于 `acceptance.yaml` 按 `ut_layer ∈ {device, both}` 过滤：

- AC-1（P0）：添加银行卡页与全部银行页点击银行均拉起同一银行的卡类型半模态。
- AC-3（P0，both 的 UI 侧）：具体卡选择后拉起短信半模态，六位数字门禁改变“下一步”可用态。
- AC-6（P0）：结果页消费系统返回，“完成”按成功结果清栈；成功回钱包首页，失败回添加银行卡页。
- AC-7（P0）：CardPack→AddCardEntry→AddBankCard→AllBanks 老路由及返回链正常。
- AC-8（P0）：四个新增界面执行真机截图、布局树采集与 `pixel_1to1` 视觉门禁。
- NFR-1 / NFR-2：保留 300ms UI 反馈与 500ms RDB 插入要求；当前工具无稳定性能采样原语，登记已知缺口。

### 测试范围说明

- **包含范围**：上述 5 条 device/both AC、两个入口、完整成功路径、失败结果页分支登记、结果页返回/清栈、老路由回归、四屏视觉证据与两项性能要求。
- **排除范围**：AC-2、AC-4、AC-5、BD-1..BD-4 均为 `ut_layer=unit`，已由 business-ut 覆盖；失败结果页需要 RDB 故障注入，按 `manual:data_injection` 登记为已知缺口，本阶段不新增产品测试开关。

## 二、测试环境

| 项目 | 要求 |
|------|------|
| 设备型号 | VDE-AL10 物理设备，序列号 `3UJ0225321000395` |
| 系统版本 | HarmonyOS `6.1.0.135(SP8C00E120R3P7)`；最终以本轮 trace 的 environment 为准 |
| API 版本 | API 24；最终以本轮 trace 的 environment 为准 |
| 屏幕分辨率 | 1320 × 2120 px，竖屏 |
| DevEco Studio 版本 | `framework.local.json` 当前已就绪的 DevEco Studio toolchain |
| 应用包 | bundle `com.example.simulatedwallet`，ability `PhoneAbility`；`product=default`、`buildMode=debug` 由当前 goal attempt 冻结 |
| 自动化工具 | Hylyre 0.5.x；trace schema `0.4-p0` / protocol `hylyre.step-outcome/1` |
| 特殊配置 | 设备解锁策略 `credential`；build→install→run 与视觉采集均由 testing harness 执行 |

## 三、测试用例清单

| 用例编号 | 用例名称 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 关联 AC | 执行通道 |
|----------|---------|---------|---------|---------|--------|---------|----------|
| TC-001 | 老路由链进入添加银行卡页 | 应用冷启动至首页 | 1. 点击“添加管理卡片”进入卡包<br>2. 点击卡包“添加卡片”行<br>3. 点击“银行卡”行<br>4. 断言添加银行卡页标题与招商银行行可见 | `col_page_title` 与 `col_row_cmb` 可见，CardPack→AddCardEntry→AddBankCard 路由可达 | P0 | AC-7 | hylyre |
| TC-002 | 添加银行卡页拉起卡类型半模态 | 应用冷启动至首页 | 1. 经老路由进入添加银行卡页<br>2. 点击 `col_row_cmb`<br>3. 断言半模态标题、银行名称、储蓄卡、信用卡与继续按钮可见 | `cts_title`、`cts_bank`、`cts_debit`、`cts_credit`、`cts_continue` 可见且银行为招商银行 | P0 | AC-1 | hylyre |
| TC-003 | 全部银行页拉起相同卡类型半模态 | 应用冷启动至首页 | 1. 进入添加银行卡页并点击“更多”<br>2. 滚动到“查看全部银行”并进入全部银行页<br>3. 点击招商银行行<br>4. 断言同一卡类型半模态与银行名称可见 | `ab_page_title` 可达；点击 `ab_row_cmb` 后 `cts_title`、`cts_bank` 可见且银行为招商银行 | P0 | AC-1 | hylyre |
| TC-004 | 六位验证码门禁提交 | 应用冷启动至首页 | 1. 进入卡类型半模态并继续<br>2. 选择第一张候选卡并同意协议<br>3. 点击具体卡页“下一步”<br>4. 断言短信半模态与“秒后重试”可见，等待归零后“重新发送”出现；点击重发并断言再次倒计时<br>5. 输入五位数字并关闭键盘<br>6. 点击短信“下一步”并断言仍停留在短信半模态、结果页不存在<br>7. 补足六位、关闭键盘并点击“下一步”，断言进入结果页 | `sms_title`、`sms_input`、`sms_resend` 可见；归零可重发且重发后再次倒计时；五位时点击不提交，六位时提交并进入 `result_root` | P0 | AC-3 | hylyre |
| TC-005 | 成功结果页禁止返回并完成清栈 | 应用冷启动至首页 | 1. 完成银行、卡类型、具体卡、协议与六位验证码选择并提交<br>2. 断言结果页“添卡成功”可见<br>3. 先触发系统返回再触发侧滑返回，每次断言仍在结果页<br>4. 点击“完成”<br>5. 断言钱包首页可见且流程页不可见，再打开卡包并返回，断言仍回首页 | 两种返回事件均被消费；`result_done` 后回钱包首页，`result_root` 消失，再次导航返回不恢复开卡流程 | P0 | AC-6 | hylyre |
| TC-006 | 老路由进入全部银行并逐级返回 | 应用冷启动至首页 | 1. 经 CardPack→AddCardEntry→AddBankCard 进入添加银行卡页<br>2. 展开并进入 AllBanks<br>3. 依次返回 AddBankCard、AddCardEntry、CardPack<br>4. 逐屏断言标题/入口锚点 | `ab_page_title`、`exp_page_title`、`ac_bank_card_row`、`cp_add_card_btn` 依次可见，老路由返回链未受损 | P0 | AC-7 | hylyre |
| TC-007 | 四个新增界面视觉保真 | 最新 debug HAP 已安装且四个状态可导航到达 | 1. 采集 card_type_sheet、bank_card_selection、sms_verification_sheet、add_card_result 截图与布局树<br>2. 与四张权威参考图逐屏双向 diff<br>3. 执行几何量测与确定性视觉门禁 | 四个 P0 屏身份正确；无 blocker/major defect、must_fix 或 reverse_missing；当前截图 hash 与 HAP 指纹绑定 | P0 | AC-8 | visual |
| TC-008 | 点击到可见状态变化不超过 300ms | 物理设备运行最新 debug HAP | 采集银行点击到半模态可见、继续到具体卡页可见、下一步到短信半模态可见的稳定响应耗时 | 各交互响应耗时均 ≤300ms | P1 | AC-1 / NFR-1 | manual:perf_sampling |
| TC-009 | 单次 RDB 插入不超过 500ms | 可隔离一次本地 cards 表插入 | 采集一次完整银行卡记录插入耗时并与阈值比对 | 单次 RDB 插入耗时 ≤500ms | P1 | AC-4 / NFR-2 | manual:perf_sampling |
| TC-010 | 失败结果页完成后回添加银行卡页 | 可隔离一次 RDB 写入失败 | 1. 注入一次 cards 表保存失败<br>2. 完成银行、卡类型、具体卡、协议与六位验证码选择并提交<br>3. 断言失败结果页可见且系统返回仍被消费<br>4. 点击“完成”并断言回到添加银行卡页 | 保存失败时进入失败结果页；返回事件被消费；`result_done` 后回 `col_page_title`，流程页被移除 | P0 | AC-6 / BD-4 | manual:data_injection |

> `hylyre` 用例集合固定为 TC-001..TC-006；派生器必须完整编译，禁止 `explicit_skip_tc_ids`。
> TC-007 由视觉证据链按 AC-8 checkpoint 绑定；TC-008/009 是 profile 明示无稳定原语的
> `manual:perf_sampling`，TC-010 是无无损数据注入原语的 `manual:data_injection`；三者记为
> `unsupported_gap`，留在分母且不算 PASS，不以人工确认洗绿。

### 用例统计

| 优先级 | 数量 | 说明 |
|--------|------|------|
| P0 | 8 | 6 条 Hylyre 功能/路由用例 + 1 条 visual 用例 + 1 条数据注入缺口 |
| P1 | 2 | 2 条性能 `unsupported_gap` |
| P2 | 0 | 无 |
| **合计** | **10** | 可执行 7，已知缺口 3 |

### AC / BD / NFR 追溯

| 验收条目 | ut_layer | 覆盖用例 |
|---|---|---|
| AC-1 | device | TC-002、TC-003 |
| AC-3 | both | TC-004（UI 侧） |
| AC-6 | device | TC-005、TC-010 |
| AC-7 | device | TC-001、TC-006 |
| AC-8 | device | TC-007 |
| AC-2 / AC-4 / AC-5 / BD-1..BD-4 | unit | unit 侧不进本计划，business-ut 已覆盖；BD-4 的结果页 device 侧由 TC-010 登记缺口 |
| NFR-1 / NFR-2 | device | TC-008（关联 AC-1）、TC-009（关联 AC-4）；均为 unsupported_gap，保留要求并披露 |

## 四、测试策略

### 测试方法

- **功能与路由**：Hylyre 在每个 case 首部按 derive hint 的 `reset_preamble` 冷复位，动作后用 `.id()` 锚点断言页面身份。
- **输入门禁**：TC-004 通过五位时点击后仍停留短信半模态、补足六位后进入结果页验证真实行为；避免依赖设备 UI 树不稳定的 `enabled` 属性。
- **视觉保真**：`device_test.visual_diff` 对 ui-spec 的四个 P0 屏采图、抓布局树并执行 `pixel_1to1` 门禁；不把 screenshot 写成 Hylyre planned step。
- **性能/数据注入**：当前 Hylyre 动作耗时含驱动/UI 树开销，不能证明 300ms/500ms 应用阈值；也没有不改变产品默认行为的 RDB 失败注入原语，按 profile 固定 gap class 如实披露。

### 执行顺序

1. 静态校验测试计划、执行通道与派生计划。
2. build→install 后执行 TC-001..TC-006。
3. 采集四屏视觉证据并执行 TC-007 绑定。
4. 报告 TC-008/009/TC-010 的 `unsupported_gap`，不伪造性能数值或故障注入结果。

### 回归策略

- selector 或导航失败先在 testing 重新派生；真实 assertion mismatch 交由 runner 定向回 coding。
- 视觉 must_fix 由 runner 回退 coding，完成 review→ut 后再重跑 testing；testing 本轮不改产品源码。

## 五、通过标准

| 指标 | 阈值 | 说明 |
|------|------|------|
| P0 可执行用例通过率 | 100% | TC-001..TC-007 均需当前机器证据通过 |
| P0 已知缺口披露率 | 100% | TC-010 数据注入缺口须出现在机器报告 |
| P1 可执行用例通过率 | 100% | 当前无 P1 可执行通道；TC-008/009 为已知 gap |
| 总体真实通过率 | ≥70% | 分母 10（含 gap），可执行 7 条全部通过时为 70.0% |
| BLOCKER 缺陷 | 0 | 不允许功能、路由或视觉 BLOCKER |
| 已知缺口披露率 | 100% | 两条性能 gap 与一条数据注入 gap 均须出现在机器报告 |

## 六、风险与依赖

### 已知风险

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| 结果页会真实写入本地 RDB | 重跑会遇到同一卡号 | Repository 使用 REPLACE；每轮仍核对 UI/导航结果，不清用户数据 |
| 首页和部分老页面缺少专用根 id | 首步 selector 依赖资源文案 | 使用 exact 文案发现入口，进入新页后立即改用 `.id()` 身份断言 |
| 四张参考图可能与 1320×2120 视口比例不一致 | `visual_reference_viewport` 会 fail-closed | 由 harness 先做视口校验；不裁图、不手改判定，失败交回 spec/coding owner |
| 性能阈值低于自动化驱动开销 | 无法形成可信数值 | TC-008/009 固定为 `manual:perf_sampling`，带缺口完成，不降低质量结论 |
| RDB 失败分支需要故障注入 | 当前无不改默认行为的注入原语 | TC-010 固定为 `manual:data_injection`，带缺口完成，不新增测试开关 |

### 测试依赖

- 当前 run 已闭环的 coding、review、business-ut 证据。
- 物理设备在线、credential 解锁策略可用、DevEco/hvigor/hdc 已配置。
- Hylyre vendor 与视觉 provider 由 harness 自动对齐；所有报告由 harness 生成。

### 环境限制

- 不新增 `*_FAST_PATH`、跳过短信、故障注入等改变默认行为的测试开关。
- `manual:perf_sampling` / `manual:data_injection` 留在总分母且不算 PASS；完成状态必须显式携带 gap。
- 测试失败只通过结构化证据路由，不从用例名称或报告散文猜测产品责任。
