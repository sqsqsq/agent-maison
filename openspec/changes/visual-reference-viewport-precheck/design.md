## Context

visual 链路里已经有三样东西：读图片尺寸的 `readImageDimensions`（`image-toolkit.ts`）、按 `ref_id` 解析参考图的 `resolveRefSourceImage`（`authoritative-ref-images.ts`）、以及 ocr-gates 里"ref 高宽比 > 截图 ×1.15 即整页"的启发式。缺的不是能力，是把判定放到内容比对**之前**并给出明确裁决，而不是在比对之后把结论降级成 uncertain。

viewport 在两个阶段的来源不同：spec 阶段只有 fidelity-lock 的 `viewport{w,h,dpr}`（`fidelity-lock-shared.ts:43`），可能未声明；testing 阶段有实测截图尺寸。两阶段共用同一判据函数。

## Goals / Non-Goals

**Goals**

- 整页参考图在 `pixel_1to1` 下被明确 FAIL 并点名屏与尺寸，且该屏不再用原始长图产出 pixel/OCR 内容结论。
- 低档位按既有 ratchet WARN/SKIP，不静默升级为像素 PASS。
- 尺寸兼容的 feature 行为逐字不变；作者换图并更新 `ref_id` 后 pipeline 原样运行。

**Non-Goals**

- 不新增 `screens[].reference_region`、自动 crop resolver、派生 crop 文件与新 hash 语义。
- 不做自动分段、滚动拼接、多套 reference 真源、按参考图尺寸改写 viewport。
- 不改 visual-diff-capture 的参考图解析、不改 ui-spec schema、不改 layout oracle。
- 不删 ocr-gates 既有整页 uncertain 分支（保留为防御性诊断，不为缩小旧代码扩大 diff）。
- 不操作宿主。

## Decisions

1. **只做尺寸兼容性检查。** 判据 = `refH/refW > (viewportH/viewportW) × 1.15`，阈值从 ocr-gates 迁为共享常量，两处同源。不引入像素级对齐或区域映射。
2. **责任归 spec 参考资产。** 不兼容不是产品缺陷、不是能力缺失：不路由 coding、不 defer、不落 uncertain。修复路径是作者用既有裁图能力产出 viewport-sized 参考图并更新 `ref_id`——没有第二套参考真源。
3. **不兼容屏从内容比对输入集合剔除。** 在 `checkVisualDiffCore` 内容比对之前算出不兼容屏集合，后续 pixel/OCR 内容门只消费兼容屏，并在 details 点名被剔除的屏；不是在结果上打标签。
4. **spec 阶段无 viewport 时 WARN 明示推迟。** 不 PASS-by-silence；testing 用实测截图尺寸再判一次。
5. **低档位走既有 `fidelityRatchetFailOrWarn`。** 不新增档位语义。
6. **兼容时零结果。** 参考图尺寸兼容的屏不产生任何 `visual_reference_viewport` 结果（不新增一条 PASS），spec 与 testing 两处都返回空——否则 summary/check 集合会变化，与"兼容 feature 行为逐字不变"的验收冲突。只有不兼容（FAIL/WARN/SKIP）与 lock 无 viewport 的推迟 WARN 才产出结果。

## Risks / Trade-offs

- [Risk] ×1.15 阈值对轻微高于视口的参考图（如带状态栏差异）可能误判。→ 阈值沿用 ocr-gates 已在宿主上用过的值；宿主实证是 2.05× 与 3.9×，远超阈值；误判时作者仍可用同一修复路径解决，且低档位只 WARN。
- [Risk] 剔除不兼容屏会让 P0 覆盖门（capture completeness）在 `pixel_1to1` 下同时 FAIL。→ 这是期望行为：整页图本来就不构成该屏的合法参考；两条 FAIL 指向同一修复。

## Migration

无消费者迁移。已在用整页参考图的 feature 会在 `pixel_1to1` 下收到 `visual_reference_viewport` FAIL 与换图指引。
