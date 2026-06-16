# Hylyre / 真机自动化工具链 —— 优化需求清单

> 来源：`bc-openCard`（银行卡开卡）真机测试期间，经 4 轮真机迭代踩到的工具链限制汇总。
> 目的：一次性提全，供 Hylyre 团队在下一版统一优化。优化完成后本 feature 的 testing 阶段继续。
>
> **测试环境**：HarmonyOS 真机 `3UJ0225327004147`，系统 `6.0.2.3` / API `6.0.2(22)`；
> Hylyre venv `.hylyre/venv`（vendor wheel 0.1.0）；被测 bundle `com.example.simulatedwallet`。
>
> **标签**：`[Hylyre-core]` = Hylyre/Hypium 运行时能力；`[Harness集成]` = framework profile 对 Hylyre 的调用层
> （`framework/profiles/hmos-app/harness/providers/device-test-run.ts`），与 Hylyre 配套但不在 wheel 内。
> 两类都列出，便于你分流。

---

## 摘要（按优先级）

| # | 优先级 | 标签 | 一句话 |
|---|--------|------|--------|
| 1 | **P0 阻塞** | Hylyre-core | 选择器只能单属性（text/type/id/key 四选一），无法区分「同文案/同类型」的多个组件（弹窗上的按钮 vs 背后页面同名按钮） |
| 2 | **P0 阻塞** | Hylyre-core | `assert_toast` / `check_toast` 在本机直接 TestError，且失败截图崩在 `NoneType`，toast 完全不可断言 |
| 3 | **P0 阻塞** | Harness集成 | 阶段跑无冷重启复位，且 `aa force-stop -b` 语法在本机失败（应 positional），跑间状态泄漏导致整轮失败 |
| 4 | P1 重要 | Hylyre-core | 缺「滚动直到目标可见再操作」能力；长列表/虚拟化里屏外项 `by_text` 找不到，手动 scroll 步数全靠猜 |
| 5 | P1 重要 | Hylyre-core | 步骤失败时不落 UI 树 / 截图，无法定位「为什么找不到」 |
| 6 | P1 重要 | Harness集成/Hylyre-core | `app page save` 退出码 2 失败，快照缓存不落盘，选择器发现（snapshot-cache）形同虚设 |
| 7 | P2 一般 | Hylyre-core | `scroll` 必须显式指定滚动容器类型；容器类型猜错（Scroll vs List）即失败，无自动探测 |

---

## 1. [Hylyre-core · P0] 选择器表达力不足：无法区分同文案/同类型的多个组件

### 问题
`touch` / `wait_for` 的选择器**只能传四者之一、且只能传一个**：`by_text` / `by_id` / `by_type` / `by_key`。
证据（vendor 源码）：`.hylyre/venv/Lib/site-packages/hylyre/api/selectors.py`

```python
def selector_kwargs_from_block(block):
    opts = [("by_text", ...), ("by_id", ...), ("by_type", ...), ("by_key", ...)]
    present = [...]
    if len(present) > 1:
        raise ValueError("pass at most one of by_text, by_id, by_type, by_key ...")
```

没有：相对位置、容器限定、索引/第 N 个、可见/可点过滤、多属性组合。

### 真实卡点（本 feature 主流程被此卡死）
开卡流程里「选卡页」与「短信验证半模态」**各有一个文案相同的「下一步」按钮**，且半模态是 `bindSheet` **盖在选卡页之上**：
- `02-Feature/WalletMain/src/main/ets/presentation/pages/BankCardSelectPage.ets:111` → `Button($r('app.string.bank_card_next'))`（="下一步"，点了开半模态）
- `02-Feature/WalletMain/src/main/ets/presentation/components/BankCardSmsSheet.ets:129` → `Button($r('app.string.bank_card_next'))`（="下一步"，提交→结果页）
- 半模态由 `BankCardSelectPage.ets:123` 的 `.bindSheet(...)` 拉起

半模态打开时组件树里**两个「下一步」并存**，`by_text:"下一步"` 命中歧义 → 提交点空 → 结果页/详情页真机无法到达（这两页源码正确但因此完全没被验证）。

> **人能一眼区分「弹窗上的下一步」和「页面上的下一步」，但当前 DSL 没有任何维度能表达这种区分**——这是本次最核心的诉求。

### 期望能力（任一/组合即可解决，建议都支持）
1. **限定到顶层弹窗/模态（最关键）**：只在当前最上层 sheet / dialog / popup 的子树里找。
   - 建议：`{"touch":{"by_text":"下一步","scope":"top_overlay"}}`（或 `"in_sheet":true` / `"window":"top"`）
2. **相对定位**：在某锚点之内 / 之下 / 之后。
   - 建议：`{"touch":{"by_text":"下一步","within":{"by_text":"短信验证"}}}`、`"below"`、`"after"`
3. **索引/第 N 个**：多命中时取第几个（0-based）。
   - 建议：`{"touch":{"by_text":"下一步","index":1}}`
4. **可见/可点/启用过滤**：只命中 `visible && clickable && enabled` 的那个（背后被遮挡/disabled 的自动排除）。
   - 建议：`{"touch":{"by_text":"下一步","enabled":true,"visible":true}}`
5. **多属性组合（AND）**：同时按 text + type（+ 上述过滤）匹配。
   - 建议：`{"touch":{"all":[{"by_text":"下一步"},{"enabled":true},{"within":{"by_type":"Sheet"}}]}}`

### 默认行为建议
即使不加新语法：**当 `by_text` 命中多个时，默认应优先命中「可见且可点击」的那个（通常即顶层弹窗的按钮），而不是报错或命中树序第一个（背后被遮挡的）。** 这一条默认值优化就能救活绝大多数 bindSheet 场景。

### 验收
半模态盖在同名按钮页面上时，用例能稳定点到半模态上的目标按钮，无需被测应用改源码加 id。

---

## 2. [Hylyre-core · P0] Toast 断言不可用：`check_toast` 直接 TestError + 失败截图 NoneType 崩溃

### 问题
`assert_toast` 步骤在本机直接报错，无法验证任何 toast。
证据（`doc/features/bc-openCard/testing/reports/device-test-run.log`，约 41–43 行）：

```
[INFO ] uidriver.check_toast(3UJ0225327004147, 暂不支持, equal, 3)
[ERROR] take screenshot on step failed. expected str, bytes or os.PathLike object, not NoneType
```

trace 内（TC-002）：`[Script-0203003] Step uidriver.check_toast(..., 暂不支持, equal, 3) result TestError!`

两个问题叠加：
- **(a)** `check_toast` 本身返回 `TestError`（疑似本 HarmonyOS 版本 toast 捕获不支持或超时机制有误）；
- **(b)** 步骤失败后的「自动截图」收到 `None` 路径 → `expected str, bytes or os.PathLike object, not NoneType` 崩溃，掩盖了真实原因。

### 影响
TC-002（P0，非银行卡 toast）、TC-013（P1，支付能力 toast）**必然失败**，与被测应用无关（应用侧 `暂不支持` 字串存在于 `string.json`）。只要用例含 toast 断言，P0 永远到不了 100%。

### 期望能力
1. 修复 (b)：失败截图前对 `None` 路径做兜底（用默认报告路径或跳过截图），**不要**让截图崩溃淹没主错误。
2. 修复 (a)：在 HarmonyOS 6.0.2(22) 上让 toast 捕获真正工作；或在不支持时**优雅降级**（返回明确的「该设备/版本不支持 toast 断言」可被用例标记为 skip 的状态，而非 TestError 整条失败）。
3. 可配置 toast 捕获窗口/轮询间隔（toast 一闪而过，给更长可调的捕获时长）。

### 验收
`{"assert_toast":{"text":"暂不支持","timeout":3}}` 在本机要么真断言成功，要么返回可被框架识别为「环境不支持→skip」的明确状态，且不再有 NoneType 截图崩溃。

---

## 3. [Harness集成 · P0] 阶段跑无冷重启复位 + `aa force-stop -b` 语法在本机失败

### 问题
两个叠加问题：

**(a) 阶段 `device_test.run` 不冷重启**：只 `aa start`，不 force-stop。
证据：`doc/features/bc-openCard/testing/reports/device-test-run.meta.json` → `"cold_restart": false`。
后果：上一轮跑完把应用留在中途页（如全部银行页），下一轮 `aa start` 只把它**拉到前台不复位**，整轮从脏状态开始 → 我手动 force-stop 前的那轮 **11/12 全挂**（连首页/银行卡/更多都找不到）。

**(b) force-stop 语法在本机错误**：provider 用的是 `-b` 形式。
证据：`framework/profiles/hmos-app/harness/providers/device-test-run.ts:434` →
```
['shell', 'aa', 'force-stop', '-b', bundle]
```
本机实测：
```
$ hdc shell aa force-stop -b com.example.simulatedwallet
error: 10104002  The application corresponding to the specified package name is not installed.
$ hdc shell aa force-stop com.example.simulatedwallet      # positional
force stop process successfully.
```
即便把 `coldRestart` 打开，`-b` 形式在本机也会静默失败 → 仍不复位。

### 期望
1. 阶段 `device_test.run` 默认（或可配置）**冷重启**：`force-stop` + `aa start`，每轮从干净首页开始；并暴露开关（如 `HARNESS_DEVICE_TEST_COLD_RESTART=1`）。
2. force-stop 改用 **positional** `aa force-stop <bundle>`（本机可用），或先探测 `-b` 失败再回退 positional。
3. force-stop 后给应用启动留稳定等待（确认主 Ability 起来再发首步）。

### 验收
连续多轮阶段跑互不污染，每轮都从应用首页开始；force-stop 在本机真实生效。

> 备注：本机当前可用的复位手法是 `hdc shell aa force-stop com.example.simulatedwallet`，我每轮手动执行作为绕过。

---

## 4. [Hylyre-core · P1] 缺「滚动直到目标可见再操作」；长列表屏外项找不到

### 问题
长列表/虚拟化容器里，目标项在屏外时 `touch by_text` 直接「Can't find component」，必须先手动 `scroll`，而 `scroll` 只能猜「方向 + 步数」，无法保证目标进入可命中范围。

### 真实卡点
全部银行页 `AllBanksPage.ets:88` 是 `List` + `AlphabetIndexer`（A-Z 索引），共 20 家银行。目标「招商银行」拼音首字母 Z、在列表**底部**。
- 先是 `scroll at {by_type:"Scroll"}` 失败（页面是 List 不是 Scroll，见 #7）；
- 改 `by_type:"List"` 后 scroll 步骤不报错，但 `招商银行` 仍 `Can't find`（滚动量不足/虚拟化未渲染）；
- 最终只能改点顶部可见的「北京银行」绕过，A-Z 索引这条（AC-4）等于没真测。

### 期望能力
1. **滚动到目标**（最关键）：在指定 scrollable 容器内自动滚动直到目标可见，再返回/操作。
   - 建议：`{"scroll_to":{"by_text":"招商银行","in":{"by_type":"List"}}}`
   - 或 touch 内联：`{"touch":{"by_text":"招商银行","scroll_into_view":{"by_type":"List"}}}`
   - （对应 Hypium uitest 的 `scrollSearch` / `scrollToTarget`，请暴露为 planned-step。）
2. 支持点击 `AlphabetIndexer` 字母实现快速定位（或文档说明其可达性）。

### 验收
不预知滚动步数，也能稳定点到长列表底部的项。

---

## 5. [Hylyre-core · P1] 步骤失败无 UI 树 / 截图，无法定位失败原因

### 问题
失败只给 `[Script-0203002] Can't find component with [BY.text('X')]`，没有当时的 UI 树或截图。是「文案不对」「在屏外」「被遮挡」「还没渲染」完全无法区分，只能反复盲跑。

### 期望能力
- 每个步骤失败时，自动把**当前 UI 树 dump**（json）+ **截图**落到本次 run 目录（如 `reports/<ts>/hylyre/failures/step-<n>.{json,png}`）。
- （依赖 #2(b)：先把失败截图的 NoneType 崩溃修了，否则这里也会崩。）
- trace 的 `cases[].notes` 里附上失败时 UI dump 的相对路径。

### 验收
看到失败即可打开当时 UI 树/截图判断根因，无需再为「为什么找不到」单独跑机。

---

## 6. [Harness集成/Hylyre-core · P1] `app page save` 失败（exit 2），快照缓存不落盘

### 问题
每轮跑完的 `app page save` 失败。
证据：`device-test-run.meta.json` → `"hylyre_page_save": {"attempted": true, "exit_code": 2, "duration_ms": 290}`。
后果：`doc/app-snapshot-cache/<bundle>/pages/` 里只有很旧的 home，新访问的页面（全部银行/各半模态/结果/详情）都没缓存。device-testing Step 4.5.2 要求「从 snapshot-cache 找稳定 selector」，缓存空了等于这步失效，只能靠读源码猜 selector。

### 期望
- 修 `app page save` 退出码 2（给出失败原因日志）；让它在每轮 run 后可靠抓取**本轮访问过的页面**结构。
- 失败时把 stderr 写进 run 目录便于排查。

### 验收
跑完后 snapshot-cache 有本轮访问页面的结构，可据此精确写 selector。

---

## 7. [Hylyre-core · P2] `scroll` 需显式指定容器类型，猜错即失败

### 问题
`scroll` 的 `at:{by_type:"..."}` 必须填对滚动容器类型；我们误填 `Scroll`（实为 `List`）直接 `Can't find component with [BY.type('Scroll')]`。

### 期望
- `scroll` 支持**自动探测**最近的可滚动祖先（不强制 `at`）；或
- 配合 #4 的 `scroll_to` 直接按目标滚动，免去指定容器类型。

### 验收
不显式指定容器类型也能滚动到目标。

---

## 附：本 feature 真机已验证到哪一步（供优化后回归参照）

优化前，用上述绕过手段（手动 force-stop 复位、List 修正、改点顶部银行、下游加等待）已真机**验证通过**：
首页 → 添卡首页 → 全部银行 → 选银行 → 选卡类型半模态 → 同意并继续 → 选卡页 → 下一步 → 短信半模态 → 输入验证码（TC-001/003/004/005/006/007/008 通过）。

**唯一真正卡死、必须靠 Hylyre 优化（#1）才能过的点**：短信半模态「下一步」与选卡页「下一步」同名歧义，导致提交点空、结果页/详情页（TC-009/010/011/013）无法到达。
toast 两条（TC-002/013）靠 #2 解决。

> Hylyre 出新版本后：重跑 `cd framework/harness && npx ts-node harness-runner.ts --phase testing --feature bc-openCard`
> （我维护的修正派生计划在 `doc/features/bc-openCard/testing/reports/20260616-rerun1/hylyre/test-plan.hylyre.md`，
> 届时可据新选择器能力把 TC-005 改回「招商银行 + A-Z 索引」、把「下一步」改为限定半模态、把 toast 断言恢复）。
