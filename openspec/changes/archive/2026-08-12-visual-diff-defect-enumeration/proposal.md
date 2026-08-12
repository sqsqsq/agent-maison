## Why

device visual-diff 的保真仲裁是「单一全局自评分 fidelity_score + 直方图客观背板 score_floor」。实测 SimulatedWalletForHmos/homepage round1：6 屏全 verdict=pass(0.88–0.93)，而截图有宫格图标裁切、更多服务轮播叠帧、卡包插图压标题、按钮形态偏差等肉眼必现缺陷——直方图对结构差异近乎无判别力（坏图 score_floor 仍 0.94–1.0），全局自评分把局部缺陷洗掉。门禁对「实现有但渲染错」这一维度无表达，agent 可在 0.9/pass 处合法闭环。

## What Changes

- **正向缺陷枚举 `defects[]`**：visual-diff.json 每屏新增 `defects[]`（`class`: clipping|overlap|shape_mismatch|missing_render|other + 可选 `bbox` + `severity` + `note`）。verdict=pass 屏含 blocker/major defect → 与 lowScorePass 同级（pixel_1to1 经 fidelity ratchet FAIL，否则 WARN）。device-testing rubric 要求逐屏枚举、pass 须 `defects` 为空。
- **向后兼容契约（D11）**：pixel_1to1 下 finalized verdict 的 `defects===undefined` → ratchet WARN 逼逐屏枚举（可为 `[]`），与既有 `reverse_missing` 对称；非 pixel_1to1 旧 consumer json 无该字段不受影响。
- **采集层边缘哨兵**：visual-diff.json 新增 `edge_tile_divergence` / `edge_over_threshold_tiles`（采集层结构化 z-MAD 算出）。check 经 tile 网格与 `defect.bbox` 坐标对账：超阈 tile 未被覆盖且数量达地板(暂定 5) → WARN（低置信、永不 gate；吸收 ~3 tile 拉伸 FP 地板）。

## Capabilities

### New Capabilities

None（扩展既有 `device_test.visual_diff` 契约）。

### Modified Capabilities

- `device-visual-diff`: visual-diff.json schema 扩展 `defects[]` / `edge_*` 字段 + pass 契约（pass 须 defects 为空）。

## Impact

- schema：visual-diff.json 每屏新增 `defects[]` / `edge_tile_divergence` / `edge_over_threshold_tiles`（均可选；旧 json 兼容，pixel_1to1 下 defects 缺失会 WARN 逼填）。
- runtime：`profiles/hmos-app/harness/{visual-diff-check, visual-diff-capture, image-toolkit, image-jimp-worker}`。
- rubric：`skills/feature/device-testing/SKILL.md` visual-diff 步骤。
- 测试：`harness/tests/unit/visual-defect-enum.unit.test.ts`（schema / 坐标对账 / FP-safe 合成端到端）。
- MIGRATION.md：消费者旧 visual-diff.json 在 pixel_1to1 下首次跑 device-testing 会被要求逐屏补 `defects[]`（可为 `[]`）。
