# 测试计划 — bank-card-opening-flow

> **模块标识**: `bank-card-opening-flow`  
> **Feature**: `cu-YmMtb3BlbkNhcmQtMgBiYW5rLWNhcmQtb3BlbmluZy1mbG93`  
> **版本**: v1.0  
> **日期**: 2026-10-24  
> **测试负责人**: goal-mode device-testing agent（run `20261023T044016Z-fe4512`）  
> **对应 spec**: `doc/features/bc-openCard-2/bank-card-opening-flow/spec/spec.md`  
> **对应设计**: `doc/features/bc-openCard-2/bank-card-opening-flow/plan/plan.md`  
> **验收 SSOT**: `doc/features/bc-openCard-2/bank-card-opening-flow/acceptance.yaml`

```yaml
test_case_flow:
  TC-001: { precondition: { kind: fresh_app, reset: stop_app+start_app } }
  TC-002: { precondition: { kind: fresh_app, reset: stop_app+start_app } }
  TC-003: { precondition: { kind: fresh_app, reset: stop_app+start_app } }
  TC-004: { precondition: { kind: fresh_app, reset: stop_app+start_app } }
  TC-005: { precondition: { kind: fresh_app, reset: stop_app+start_app } }
  TC-006: { precondition: { kind: fresh_app, reset: stop_app+start_app } }
  TC-007: { precondition: { kind: fresh_app, reset: stop_app+start_app } }
  TC-008: { precondition: { kind: fresh_app, reset: stop_app+start_app } }
  TC-009: { precondition: { kind: fresh_app, reset: stop_app+start_app } }
  TC-010: { precondition: { kind: fresh_app, reset: external_data_injection } }
  TC-011: { precondition: { kind: fresh_app, reset: external_perf_sampling } }
```

---

## 一、测试范围

### 测试模块

| 模块名 | 所属层 | 格式 | 说明 |
|---|---|---|---|
| WalletMain | 02-Feature | HAR | 双入口、卡型/卡片/OTP/结果 UI、RDB 与开卡状态 |
| AccountManager | 04-BusinessBase | HAR | OTP 提示所需 mock 手机号 |
| Phone | 01-Product | HAP | 根导航与新旧 NavDestination 装配 |

### 测试功能点

- AC-1：添加银行卡页和全部银行页进入同一卡型选择半模态。
- AC-2：候选卡数量、卡号掩码、单选和协议门禁。
- AC-3：自动 mock 发送、60 秒倒计时、重发和六位数字门禁。
- AC-4：保存成功/失败结果页及跨页参数；成功路径使用真实 RDB，失败路径保留为数据注入缺口。
- AC-5：结果页返回拦截、唯一完成动作和定向清栈。
- AC-6：钱包首页、添加卡片、添加银行卡、全部银行新旧路由回归。
- BD-1..BD-4：不完整输入、重复重发、RDB 异常、中途取消与状态清理。
- NFR-1：本地交互响应目标 300ms；当前工具无校准采样通道，如实披露。
- 四个 P0 目标屏按 `pixel_1to1` 通过阶段级 visual capture/diff 取证。

### 测试范围说明

- **包含范围**：acceptance 中全部 `ut_layer=device|both` 的 AC/BD，以及 device 侧 NFR-1；四张参考图对应屏幕。
- **排除范围**：结果页 NFC 激活区（需求明确本次不做）；系统状态栏、系统数字键盘皮肤和低置信 OCR 孤立文案按目标简报中的合法延后处理。
- **不重复范围**：纯领域计算、RDB 事务/幂等细节已由 UT 覆盖；本阶段只验证真实 UI、导航、设备行为与视觉证据。

---

## 二、测试环境

| 项目 | 要求 |
|---|---|
| 设备型号 | VDE-AL10，目标序列号 `3UJ0225321000395` |
| 系统版本 | HarmonyOS `6.1.0.135(SP8C00E120R3P7)` |
| API 版本 | API 24 |
| 屏幕分辨率 | 1320 × 2120 px，竖屏 |
| DevEco Studio | `D:/Program Files/Huawei/DevEco Studio` |
| 应用包 | `com.example.simulatedwallet` / `PhoneAbility` |
| 构建维度 | runner 冻结的 `product=default`、`buildMode=debug` |
| 自动化 | Hylyre `0.5.1`，trace `0.4-p0`，protocol `hylyre.step-outcome/1` |
| 特殊配置 | 设备策略为已登记的 existing credential；正式链路 build → install → run → visual diff |

---

## 三、测试用例清单

| 用例编号 | 用例名称 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 关联 AC | 执行通道 |
|---|---|---|---|---|---|---|---|
| TC-001 | 添加银行卡入口完成成功开卡 | 冷启动到钱包首页，mock 数据可用 | 1. 首页进入卡包与添加卡片页<br>2. 点击银行卡进入添加银行卡页<br>3. 点击招商银行打开卡型 Sheet<br>4. 选择储蓄卡并继续<br>5. 选择第一张卡、勾选协议并下一步<br>6. 输入 `123456` 并提交<br>7. 在成功结果页点击完成 | 四个新页面依次可达；候选卡仅显示掩码；成功结果页出现；完成后回钱包首页且过程页不可返回 | P0 | AC-1 / AC-2 / AC-3 / AC-4 / AC-5 / BD-1 | hylyre |
| TC-002 | 全部银行入口复用卡型 Sheet | 冷启动到钱包首页 | 1. 进入添加银行卡页并展开<br>2. 进入全部银行页<br>3. 点击招商银行<br>4. 断言卡型 Sheet 的银行名、储蓄卡、信用卡与继续按钮 | 第二入口不再提示暂不支持，展示与主入口相同的银行与卡型内容 | P0 | AC-1 / AC-6 | hylyre |
| TC-003 | 卡型 Sheet 取消后重入复位 | 冷启动到钱包首页 | 1. 从添加银行卡页打开卡型 Sheet<br>2. 选择信用卡<br>3. 点击关闭<br>4. 再次点击同一银行<br>5. 尝试直接点击继续并核对仍停留在 Sheet | 关闭丢弃未提交卡型；重入后未默认选中，继续动作不能进入选卡页 | P0 | AC-1 / BD-1 / BD-4 | hylyre |
| TC-004 | 候选卡掩码与协议组合门禁 | 冷启动到钱包首页 | 1. 进入信用卡选卡页<br>2. 核对 1–2 张候选与掩码文本<br>3. 未选择/未勾选时点击下一步<br>4. 选择候选并勾选协议后点击下一步 | 页面只显示前四后四；任一条件缺失不打开 OTP；两项齐全才打开 OTP Sheet | P0 | AC-2 / BD-1 | hylyre |
| TC-005 | OTP 自动发送与六位数字门禁 | 已进入具体卡片页 | 1. 选择卡并同意协议后打开 OTP Sheet<br>2. 核对掩码手机号和倒计时文案<br>3. 输入 `12345` 并尝试下一步<br>4. 输入 `123456` 并提交 | Sheet 出现即进入倒计时；五位数字不能提交；六位数字可提交并进入结果页 | P0 | AC-3 / BD-1 | hylyre |
| TC-006 | OTP 倒计时归零与重发 | 已进入 OTP Sheet | 1. 核对发送按钮处于倒计时不可用态<br>2. 等待倒计时归零出现“重新发送”<br>3. 点击一次重新发送<br>4. 核对重新进入倒计时 | 同一窗口没有第二次发送入口；归零后一次点击启动新的 60 秒窗口 | P0 | AC-3 / BD-2 | hylyre |
| TC-007 | OTP 关闭后重新进入清空瞬态 | 已进入 OTP Sheet | 1. 输入 `123456` 但不提交<br>2. 点击关闭<br>3. 在选卡页再次点击下一步<br>4. 核对输入框回到空占位且重新开始倒计时 | 关闭释放计时器和验证码；重入从新的自动发送与空输入开始 | P0 | AC-3 / BD-4 | hylyre |
| TC-008 | 结果页返回拦截与完成清栈 | 冷启动到钱包首页 | 1. 完成一次成功开卡到结果页<br>2. 触发系统返回并核对仍在结果页<br>3. 点击完成<br>4. 尝试返回并核对不能回到开卡过程 | 结果页无返回出口且系统返回无效；完成后成功回首页并移除本轮过程栈 | P0 | AC-5 | hylyre |
| TC-009 | 旧路由往返回归 | 冷启动到钱包首页 | 1. 首页→卡包→添加卡片→添加银行卡<br>2. 展开并进入全部银行<br>3. 返回添加银行卡页<br>4. 再返回添加卡片页 | 四个既有页面沿同一 NavPathStack 可达，返回语义与新增流程共存 | P1 | AC-6 | hylyre |
| TC-010 | RDB 失败结果页与退出 | 具备注入 RDB 创建/查询/插入失败的测试构建或数据接缝 | 1. 分别注入三类 RDB 失败<br>2. 提交合法验证码<br>3. 核对失败结果页<br>4. 点击完成并检查数据库与导航 | 失败仍携带受控结果进入失败页；UI/日志不泄漏完整卡号；无半写；完成回添加银行卡页 | P0 | AC-4 / AC-5 / BD-3 | manual:data_injection |
| TC-011 | 本地交互响应 300ms | 具备校准的设备时延采样通道 | 1. 采集卡型选择、按钮启停、本地页面跳转响应<br>2. 排除首次 RDB 初始化并核对进行中防重<br>3. 与 300ms 阈值比对 | 各本地交互目标不超过 300ms；首次 RDB 初始化期间不能重复提交 | P1 | NFR-1 | manual:perf_sampling |

### 用例统计

| 优先级 | 数量 | 说明 |
|---|---:|---|
| P0 | 9 | 8 条 Hylyre + 1 条已知数据注入缺口 |
| P1 | 2 | 1 条 Hylyre 路由回归 + 1 条性能采样缺口 |
| P2 | 0 | 无 |
| **合计** | **11** | Hylyre 9 条，known manual gap 2 条 |

### AC / BD / NFR 追溯

| 条目 | ut_layer | 覆盖用例 |
|---|---|---|
| AC-1 | both | TC-001、TC-002 |
| AC-2 | both | TC-001、TC-004 |
| AC-3 | both | TC-001、TC-005、TC-006 |
| AC-4 | both | TC-001、TC-005、TC-010 |
| AC-5 | device | TC-001、TC-008、TC-010 |
| AC-6 | both | TC-002、TC-009 |
| BD-1 | both | TC-001、TC-003、TC-004、TC-005 |
| BD-2 | both | TC-006 |
| BD-3 | both | TC-010 |
| BD-4 | both | TC-003、TC-007 |
| NFR-1 | device/both 性能项 | TC-011 |

---

## 四、测试策略

### 测试方法

- **功能与导航**：九条 Hylyre 用例均以冷重启复位，使用稳定 `id` 驱动；P0 checkpoint 由 harness 注入 native presence/absence 断言。
- **边界与恢复**：分别验证禁用门禁、关闭重入、60 秒重发窗口、返回拦截与栈清理。
- **真实持久化**：成功路径走当前生产 RDB；失败注入在现有产品/Hylyre 无安全原语，保留 `manual:data_injection`，不制造测试开关。
- **视觉保真**：四个 P0 屏由 `device-testing/visual-diff-nav.json` 导航，正式 visual capture/diff 采集截图与布局树；不把 screenshot 写进 planned steps。
- **性能**：当前驱动步骤耗时包含 UI 树刷新，不能当应用时延；NFR-1 保留 `manual:perf_sampling`，不伪造数值。

### 执行顺序

1. 静态校验顶层计划、派生覆盖和 selector 语法。
2. build → install → Hylyre 执行 TC-001..TC-009。
3. 采集四个 P0 屏并执行 `pixel_1to1` visual diff。
4. 由 harness 合成报告；manual gap 留在分母并逐条披露。

### 回归策略

- 产品修复后重跑受影响 TC；若修改共用入口、导航或 opening service，回归全部 P0 Hylyre 用例。
- 视觉 must_fix 由 runner 交回 coding；testing 阶段不修改产品源码或上游契约。

---

## 五、通过标准

| 指标 | 阈值 | 说明 |
|---|---:|---|
| P0 可执行用例通过率 | 100% | TC-001..TC-008 必须具备 completed/passed/complete native 证据 |
| P1 可执行用例通过率 | 100% | TC-009 必须通过 |
| Hylyre 总通过率 | 100% | 9/9；manual gap 不冒充通过 |
| BLOCKER 缺陷 | 0 | 功能、P0 checkpoint、视觉硬门禁均不得存在阻断 |
| known gap 披露率 | 100% | TC-010、TC-011 必须保留在分母并标明 gap_class |
| 视觉目标 | `pixel_1to1` | 四个 P0 屏无 blocker/major defect、must_fix 或确定性布局/文本命中 |

---

## 六、风险与依赖

### 已知风险

| 风险 | 影响 | 缓解措施 |
|---|---|---|
| acceptance 的成功完成 checkpoint 要求 `home_root`，当前 HomeTabPage 未暴露该 id | TC-001/TC-008 的原生 checkpoint 可能失败 | 不在 testing 修改源码；保留原 checkpoint，由机器证据交回 coding 修复 |
| 结果页使用已登记的近似占位插画 | `pixel_1to1` 可能产生 major 视觉差异 | 由 visual diff 真实裁决并形成可定位 must_fix；不以既有债务洗绿 |
| RDB 失败需数据注入 | 默认生产包无法安全触发失败页 | TC-010 标 `manual:data_injection`，不新增行为开关或测试 fast path |
| 60 秒倒计时增加单例时长 | TC-006 单例约需 65 秒 | 只保留一条真实倒计时用例；不缩短产品常量 |

### 测试依赖

- 真机在线、已解锁且无系统弹窗遮挡。
- runner 注入的 product/buildMode 与目标设备身份不变。
- Hylyre vendor、hdc、DevEco/hvigor 由正式 harness 对齐。
- 上游 review/UT closure 证据保持有效。

### 环境限制

- Hylyre 当前无校准性能采样和 RDB 失败数据注入原语；两项按 profile 已知缺口分类。
- 系统状态栏与数字键盘皮肤由系统渲染，仅按目标简报披露 best-effort 债务，不降低应用自绘区域的视觉门禁。
