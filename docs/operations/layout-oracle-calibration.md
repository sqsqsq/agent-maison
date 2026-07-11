# Layout Oracle 校准报告（plan c6d8f2b4 t0）

> 状态：**离线校准完成（2026-07-10）；真机校准步骤已定义，随 t11 宿主复验执行**。
> 铁律（ui-spec.md）：绝对位置类度量已被真机证伪，任何新确定性抓手须先过实测校准——
> 拦不下的子信号降 advisory 或不做，不硬上 gate。本报告是 T8 各子信号 gate 档位的 SSOT 依据。

## 0. 校准样本

| 样本 | 来源 | 说明 |
|------|------|------|
| dump-ui-20260709.json（77KB，105 bounds） | 宿主 SimulatedWalletForHmos `doc/app-snapshot-cache/com.example.simulatedwallet/` | app 首页态 |
| dump-ui-20260708.json（221KB） | 同上 | 桌面/launcher 态（含系统 UI 全树） |
| dump-ui-20260521 / 20260611 / fresh-home.json | 同上 | 历史采集 |
| bc-openCard visual-diff.json（8 屏全 pass、iou 恒 0.95、7/8 抄 floor） | 宿主 feature | M1 元门禁反例靶（已固化进单测） |

## 1. 离线已确证结论

### 1.1 dump 格式（E9，全样本一致）

`schema_version: "hylyre-hypium-ui-dump-v1"`、`source: "hypium.UiTree"`。每节点
`attributes`：`bounds`（字符串 `"[x1,y1][x2,y2]"`，屏幕像素坐标）、`type`（ArkUI 组件类
Row/Column/Stack/Text/Image/SymbolGlyph/ListItem/GridItem/RelativeContainer/Navigation/
NavBar/WindowScene…）、`text`、`clickable`、`scrollable`、`id`、`key`；`children[]` 嵌套。
**没有**：背景色/圆角等样式、visibility、z-order、clip、transform。

### 1.2 bounds 语义（t0②，离线部分）

- 状态栏根 `[0,0][1320,117]`、app root `[0,117][1320,2120]`——与设备分辨率（1320×2120）
  和视觉边界吻合，**判定为视觉布局边界（layout bounds），非触控热区**（热区扩展如
  responseRegion 不会反映在 UiTree bounds；待真机步骤 D3 复核一例）。
- 树内包含**跨窗口**内容（状态栏 + app + launcher），T8 断言须先裁剪到 app 窗口子树
  （root type=`root`/首个全屏子树），避免状态栏节点参与相交判定。
- 不可见/离屏节点表达方式未知（无 visibility 字段）→ 真机步骤 D4；在此之前 A 类相交
  判定只取**两参与方 bounds 均非零面积**的对，零面积/负尺寸节点一律跳过（保守）。

### 1.3 ArkUI `.id()` 透传（t0③）——**已确证，locator 主方案可行**

- 系统组件 id/key 大量透传（`BatteryComponent-batteryIcon_Image_batteryIcon`、
  `__NavdestinationField__BackButton__Back__` 等，20260521 样本 40+ 个）。
- **宿主 app 自有组件 id 亦透传**：dump-ui-20260709.json 含 `home_header_add`、
  `promo_no_card`——即 SimulatedWallet 源码中设过 `.id()` 的组件，id 与 key 双字段同值出现。
- 结论：t1 locator 主方案（coding 门禁要求 P0 屏声明元素设 `.id(<element_id>)`）机制成立；
  fallback 匹配器（unique_text → structural）覆盖未设 id 的存量。

### 1.4 (a)(b)(c) 三靶可判性（t0④，离线部分）

| 靶 | 布局树可判性 | 结论与 gate 档位 |
|----|--------------|------------------|
| (b) X 按钮 ∩ 银行白卡 | bounds 矩形相交=纯数学，**可判**（前提：overlay 进树，见 §2） | 显式 `forbidden_overlap` 声明对 → pixel_1to1 BLOCKER；close 默认规则 advisory 起步（§1.5） |
| (a) 储蓄卡/信用卡与银行行同白卡 | **树上不可靠**：无 bg/surface 语义，"两块灰底 vs 一张白卡"仅当实现恰好用独立容器承载时才在拓扑上可分；共祖先判定有 FP（深嵌套）/FN（同容器不同底色）双向风险 | **主责=t6 spec 合同**（分组容器强制声明+overlay 元素完整性）；树侧 B 类"声明分组共最近容器"仅 WARN，永不单独 BLOCKER |
| (c) 间距失衡 | 兄弟 bounds 差可精确测量；与参考图 bbox 推导比例对照涉及 device≠mockup 换算，是被证伪度量的近亲 | **永久 advisory**，只进 defects 供 critic/人复核 |

### 1.5 close 默认规则 FP 风险（离线推演，真机 D5 复测）

overlay 关闭钮与"内容 surface"相交的合法形态：扩大触控热区（若 bounds 恰为热区）、
标题行与关闭钮同行重叠边界、overlay root 全屏 bounds 与一切相交。
→ 默认规则实现上排除祖先-后代对（containment ≠ overlap）、只比较**兄弟/旁系**叶子级
bounds，且首版 **advisory**；真机 D5 在 8 屏跑 FP 观察，零误伤才可晋级 BLOCKER。

## 2. 待真机校准项（随 t11 执行，宿主 + 连线设备）

| # | 步骤 | 判定 |
|---|------|------|
| D1 | `hylyre session start` → 按 `visual-diff-nav.json` 导航至 card_type_sheet 开启态 → `hylyre dump-ui --out <scratch>/dump-card-type-sheet.json` | 树内检索「选择卡类型/储蓄卡/信用卡/招商银行」文本节点与关闭钮（clickable 节点位于 sheet 右上）——**overlay 进树=通过**；不进树 → t2/t3 依赖布局树的子信号置 cancelled，登记 Hylyre 上游需求 |
| D2 | 同 D1 对 sms_verify overlay 复测 | 同上 |
| D3 | 对已设 `.id()` 的组件（home_header_add）设 responseRegion 扩热区后重 dump | bounds 是否随热区变化——不变=视觉边界（§1.2 判定成立） |
| D4 | 对 Visibility.Hidden/None 组件重 dump | 隐藏节点是否仍在树/bounds 表达——决定 A 类是否需可见性过滤增强 |
| D5 | close 默认规则对 bc-openCard 全 8 屏跑 FP 观察 | 零误伤 → 晋级 BLOCKER 的依据；有误伤 → 保持 advisory 并记录形态 |
| D6 | (c) 间距比例：对"OK 屏"（add_home_expanded）与"差异屏"（修复前 card_type_sheet）各测标题区-银行卡间距比例 vs ref bbox 推导值 | 观察区分度与噪声，给 tolerance 建议（当前缺省 0.25，纯 advisory 展示阈） |

## 3. Gate 档位决定表（T8 各子信号，代码同步）

| 信号 | 档位 | 升级条件 |
|------|------|----------|
| A-1 显式 `forbidden_overlap`/`protected_region` 违反 | pixel_1to1 BLOCKER（ratchet） | 即刻生效（拓扑事实、spec 显式意图） |
| A-2 控件越出屏幕 | pixel_1to1 BLOCKER（ratchet） | 即刻生效 |
| A-3 close 默认规则（overlay 关闭钮 ∩ 内容元素） | advisory（defect minor 登记） | D5 零误伤后晋级 |
| A-4 全量两两相交扫描 | advisory（观察期素材） | 永不直接 gate |
| B-1 同 layout_group 共最近容器/同行 | WARN | 观察期 FP 数据后议 |
| B-2 声明分组容器 children 共最近公共容器 | WARN | 同上 |
| B-3 ui-spec order → y 序单调 | WARN | 同上 |
| C-1 相邻兄弟间距比例 vs ref bbox 推导 | advisory（永久） | 不升级 |
| locator 覆盖率不足（<80%） | 该屏 B 类 SKIP + WARN 注记 | — |
| layout dump 缺失（pixel_1to1 P0 屏） | WARN | 视 D1/D2 结论收紧 |

## 3b. 真机校准数据（2026-07-11，SimulatedWalletForHmos / bc-openCard，8 P0 屏）

f7a3d9c2 t5⑨/⑥ 设备模式校准（calibration.json 在该 feature `device-testing/reports/`）：

- **静稳判据（t4b 依据）**：app 裁剪 hash 8/8 屏稳定；整图 hash 仅 3/8 相等（5 屏状态栏
  漂移）——"整图字节恒等真机恒假"实锤，app 裁剪判据正确；布局签名 8/8 稳定；动效屏
  （sms_verify overlay）3 组内收敛 → 静稳采样默认重试 2 定稿，t4b 已启用（仅 pixel_1to1）。
- **appRoot 选择（E9 复验）**：7/8 屏单 `type='root'` 子树（面积比 0.945，首选即中）；
  overlay+键盘场景出现**双 root**（app 窗口 + 输入法键盘窗口，键盘面积更大）——
  "首个 type=root"策略 8/8 选对，"面积最大"回退在键盘在场时会选错。**现行策略保持**；
  若未来遇到系统窗口 z 序把非 app root 排前的反例，再议按 bounds 贴合 app 区筛选。
- 注记：本轮校准 CLI 裸跑 nav（未对齐 device_test.run 的 --bundle/--page-name 启动方式），
  overlay 屏采样时 SMS sheet 未起——⑨/⑥ 判据数据不受影响；①-⑧ 逐屏语义结论须以正式
  testing 采集的 dump 为准（该 feature 尚无正式 dump，下一次 testing 轮自动产出）。

## 4. 诚实边界

- 本轮无连线设备（`hdc list targets` 空，2026-07-10），D1-D6 未执行；依赖 D1 结论的
  gate 升级（A-3→BLOCKER）一律未启用，实现按上表保守档位落地。
- (a) 类靶的自动拦截主责在 spec 合同前置（t6），树侧只做 WARN 辅助——这是设计决定，
  不是实现缺口。
- critic 回执的 `input_provenance`（f7a3d9c2 更新）：**goal 态已有诚实 verified 生产者**
  ——goal-runner 审计 agent-events.jsonl（structured_events 三文件分流的纯净事件流）中的
  图片验读记录后签发 runner attestation 回执，check 重算证据日志 hash 验真，手写 verified
  一律降级；仅对盘点合格的 adapter 生效（当前解析器仅 claude，其余恒 unverified——盘点
  SSOT 见 docs/operations/adapter-tool-event-provenance.md，真机 fixture 待宿主复验）。
  **交互态仍无信任根 → 一律如实 `unverified`**。证明力边界不变：验读记录=工具调用发生
  且输入被注入，≠模型看懂了图。
