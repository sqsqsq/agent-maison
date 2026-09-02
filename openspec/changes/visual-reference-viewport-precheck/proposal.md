## Why

宿主 bc-openCard-1 的参考图 expanded（高 4350）与 all_banks（高 8312）是整页拼接图，而设备视口高 2120。`profiles/hmos-app/harness/visual-diff-check.ts:1138` 的注释已承认"整页参考图 vs 单视口口径缺口"；`visual-diff-ocr-gates.ts:372-382` 用宽高比启发式判整页，`:517-523` 把纵向乱序整体降级为 uncertain。缺口被"注明"而不是被"前置拦下"：`pixel_1to1` 下像素口径静默变成结构口径，作者得不到"换一张视口尺寸参考图"的明确指令。

真实需求只有一句：不允许把 4350/8312 高的长参考图作为 2120 高单视口截图的直接像素参考。plan 见 `.cursor/plans/Maison优化项_能力查表与视口口径与case复位_b3d7e5a1.plan.md` T5；review 已否决初版的 `reference_region` + 自动 crop 体系，本 change 只做尺寸兼容性前置门。

## What Changes

- 新增参考图/viewport 尺寸兼容性前置门：复用 `readImageDimensions` 与 `resolveRefSourceImage`，在 spec（`checkFidelitySnapshotPromise` 旁，viewport 取 fidelity-lock `viewport`）与 testing（`checkVisualDiffCore` 内容比对之前，viewport 取实测截图尺寸）比较高宽比，沿用 ocr-gates 的 ×1.15 阈值迁为共享常量。
- 明显不兼容时：`pixel_1to1` → `visual_reference_viewport` FAIL（责任 spec 参考资产）且该屏从本轮 pixel/OCR 内容比对输入集合中剔除；低档位按既有 `fidelityRatchetFailOrWarn` WARN/SKIP，不静默升级为像素 PASS；lock 无 viewport 时 spec WARN 推迟到 testing。
- 修复路径是作者侧的：用既有裁图能力生成 viewport-sized 参考图并更新该 screen 的 `ref_id`；兼容后现有 pipeline 原样运行。
- 不新增 `screens[].reference_region`、自动 crop resolver、派生 crop 文件、crop hash 语义、分段、滚动拼接、多套参考真源或下游批量改造；ocr-gates 既有整页 uncertain 分支保留为防御性诊断，不删。

非 BREAKING：参考图尺寸兼容的 feature 行为逐字不变；只有本来就在用整页图冒充单视口参考的 feature 会在 `pixel_1to1` 下被点名。

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `visual-diff`: 新增一条需求——参考图与 viewport 尺寸不兼容时在内容比对前被拒绝，修复由作者提供 viewport-sized 参考图。

## Impact

- 生产实现：`profiles/hmos-app/harness/visual-diff-check.ts`、`profiles/hmos-app/harness/fidelity-snapshot-check.ts`、`profiles/hmos-app/harness/visual-diff-ocr-gates.ts`（阈值迁为共享常量）、`profiles/hmos-app/harness/image-toolkit.ts`（只复用）。
- 回归：visual-diff / fidelity-snapshot 单测用 jimp 生成尺寸已知的合成 PNG（jimp 不可用时 SKIP，与既有图像测试同款）；一次最终 harness 全量。
- 不含：任何 ui-spec 字段、reference resolver、crop 产物、visual-diff-capture 参考图解析改动、Hylyre、宿主操作。宿主条件验证（expanded/all_banks 被点名 FAIL，换图后进入原比对）由用户触发。
