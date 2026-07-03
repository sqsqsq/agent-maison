# round6 视觉保真回归夹具（plan f2d8c4a6 · P2）

来源：宿主 SimulatedWalletForHmos homepage goal-run 20260702T061511Z 的**真实坏态产物**
（用户回灌 2026-07-02，对照 `D:\1.code\对比结果\0-home-page`），vendored 为新门禁的可证伪验收基线。

## 坏态（新门禁必须 FAIL）

| 文件 | 坏在哪 | 消费门禁 |
|------|--------|---------|
| `transposed-ui-spec.yaml` | 全文档 bbox 为 [y,x,h,w] 转置语义（SSOT=[x,y,w,h]）；47 个多字文本节点 w<h 全反常；23 个 crop 资产全 `crop_confirmed_by:user_requirement` 免检 | `ui_spec_bbox_semantic`（P0-A）、`asset_crop_validation`（P0-B）、授权/验真拆位（P0-C） |
| `bad-crops/ill_card_pack_guide.png` | 204×2938 整页竖切条（bbox [0.12,0.04,0.18,0.92] 按 [x,y,w,h] 误裁），长边/短边≈14 | P0-B 条状塌缩 sanity |
| `bad-crops/icon_header_watch.png` | 纯蓝近单色块（裁到色块区，无图标内容） | P0-B 纯色/低方差 sanity |
| `bad-crops/icon_category_transit.png` | 939B 近空白小图 | P0-B 纯色/低方差 sanity |
| `source/CardGuideSection.ets.txt` | 按钮 `.width('100%')` 而 spec 声明 `width_ratio:0.28, align:end`（coding 门禁当时只 WARN） | P1-A `visual_parity_render` 升 BLOCKER（Phase 2） |
| `source/MineTabPage.ets.txt` + `source/string.json.txt` | 「金融信息」「设置与帮助」不在 spec 文本集（zone 名脑补成可见标题） | P1-A `visible_text_whitelist`（Phase 2） |
| `source/HomeTabPage-invisible-cheat.ets.txt` | Checkpoint-2 第二轮 run 实锤：`bottomTabPresence()` 透明 tab 文本×2 + 零尺寸 `sys_symbol_plus` 图——挂 spec 引用骗 presence 扫描 | `visual_parity_invisible_presence`（派生治理②） |
| `source/ServiceGridSwiper-invisible-cheat.ets.txt` | 同上：一串透明 SymbolGlyph / 三连零 Image 假 presence | `visual_parity_invisible_presence` |

## 正样本（新门禁必须 PASS，FP 校准承重）

三路来源（见 plan §四 P2）：

1. **OCR 类门禁正样本**：`../ocr/mine.png`（a3f1c920 轮 vendored 历史设备截图）配对本目录
   `mockups/mine-ref.jpg`（原始需求参考原图）。
2. **P0-A 正样本**：由 `transposed-ui-spec.yaml` 在测试运行时做确定性换轴（[y,x,h,w]→[x,y,w,h]），
   并以 `mockups/add_card.jpg` 的 **OCR 实测词框对齐**验证（防"造样本与判定逻辑同轴自洽"——
   换轴后 as-is 语义须系统性胜出，spike 实测 22:0 分离）。
3. **P0-B 正样本**：测试运行时按修正 bbox 从 `mockups/add_card.jpg` 重裁真图标 crop。

`mockups/add_card.jpg` 选型依据：OCR spike（2026-07-02）实测该屏 7/7 文本节点 decisive 判转置，
是单屏判定信号最强的 mockup；识别耗时 ~0.7s 适合单测。

注意：`*.ets.txt` / `string.json.txt` 后缀改名是为避免被仓库 lint/编译误扫，内容为宿主源码原样。
