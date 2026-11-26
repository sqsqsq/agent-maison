---
name: ux-behavior-spec
description: 从设计截图、结构化设计稿和 PRD 提取、更新或核对元素级 UX 行为说明（*.ux.yaml）。用于交接界面数据、条件、操作、跨页流转和验收例子，以及只改某个控件或复用已有交接稿的请求。
---

# UX 行为说明

提供本次涉及的 PRD 或设计、已有 UX 交接稿（如有）和独立使用时的输出目录。只有文字也可提取有依据的行为。

> 用 ux-behavior-spec 读取 `需求.md` 和 `选卡.png`，只写选卡类型屏，把一份 `*.ux.yaml` 放到 `handoff/`。区分图片选中态和业务默认值。
>
> 用 ux-behavior-spec 更新 `handoff/选卡.ux.yaml` 中的协议文案，只改协议元素及确受影响的引用。

1. 读 [intake.md](reference/intake.md) 确定范围、已有稿、作者读图和写入位置。
2. 按需参照[屏幕模板](templates/screen.ux.yaml)、[流程模板](templates/flow.ux.yaml)及 [Schema](schema/ux-behavior.schema.json)。每屏或弹层一份文档，稳定标识为 `屏幕ID.元素ID`。动态列表或选项组只用一个元素，以 `items_from` 指向该组数据，并用 `row` 定义共用行模板。多屏关系由流程文档定义一次，屏幕入口与跨页动作引用流转 ID。只交一屏时，可用 `entry.trigger` 和 `entry.evidence` 写业务入口，在元素动作中直接写有依据的目的页面和携带数据。
3. 每条实质规则关联可回查的依据。用 `evidence` 指向来源 ID，或用 `来源ID:条款、行号或节点` 精确定位。可定位的截图区域用 `bbox`，结构化设计节点用 `design`；合理推断标 `status: inferred`，未定决策标 `status: open` 并保留问题与依据。可观察的验收示例写清给定数据、操作和预期结果。
4. 只核对请求涉及的部分。可用[核对清单](reference/checklist.md)和[静态看图页](viewer/index.html)查看规则、证据与编号。交回文件、读图情况和影响本次交付的待决项，产品与 UX 可在上游核对并定稿。

[开卡样例](examples/bc-openCard-2/bc-openCard-2.flow.ux.yaml)演示完整的四屏、一份流程和测试例子。
