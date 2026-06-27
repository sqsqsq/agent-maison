## 1. defects 枚举契约

- [x] 1.1 `VisualDiffDefect` 类型 + schema 校验（class/severity/note/bbox(4 数∈[0,1])）
- [x] 1.2 门禁：pass 屏 blocker/major defect → ratchet FAIL/WARN（与 lowScorePass 同级）
- [x] 1.3 D11：pixel_1to1 `defects===undefined` → WARN 逼填（与 reverse_missing 对称；非 pixel_1to1 旧 json 不受影响）
- [x] 1.4 device-testing SKILL rubric 接 defects 枚举（4 类 + pass 须空 + 边缘哨兵说明）

## 2. 采集层边缘哨兵

- [x] 2.1 image-jimp-worker `edge-tile`（结构化 z-MAD + 拉伸整页对齐）+ image-toolkit 封装/常量
- [x] 2.2 visual-diff-capture `resolveEdgeSentinel` 写 `edge_tile_divergence`/`edge_over_threshold_tiles`
- [x] 2.3 check 坐标对账（EDGE_TILE 网格 ↔ defect.bbox 求交）+ 最小未覆盖地板（吸收 FP，WARN-only）
- [x] 2.4 F4 reconcile（合成 FP 探针证 stretch 3 < letterbox 8）；**地板=5 暂定，待修好的 home 回灌再校准**

## 3. 验证与文档

- [x] 3.1 单测 visual-defect-enum（schema / 坐标对账含覆盖夹具 / FP-safe 合成端到端，15 例）
- [x] 3.2 coding-rules overlay 登记 check id（visual_parity_render/asset_render/variant_decl、arkui_clip_overlap_risk）
- [x] 3.3 MIGRATION.md 消费者条目（旧 json pixel_1to1 须补 defects[]）
- [x] 3.4 `cd harness && npm test` 全 PASS（1177 unit + 35 fixtures）
