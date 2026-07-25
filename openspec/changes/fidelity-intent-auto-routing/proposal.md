# fidelity-intent-auto-routing

## Why

2026-07-24 宿主实测（bc 银行卡需求）：需求原话「结构/颜色/布局尽量一致；没有高保真，素材从截图裁剪」被三态意图检测判为「含混」→ `await_human_fidelity_tier` 阻塞求人选档；用户选档后 `--fidelity` 在 fresh CLI 路径被静默丢弃（parser 本身也不保留 fidelity 字段），宿主被迫强化需求措辞绕行。用户裁决（产品哲学）：**非关键冲突不给用户返回失败——框架按用户描述自动匹配能力内最合适方案并透明记录；halt 只留真冲突。**

## What Changes

- 三态意图（strong/ambiguous/none）替换为**三正交轴**：质量目标 desired_fidelity（含 `pixel_1to1` 等规范枚举字面量识别、否定优先、显式枚举>推断）、验收严格度 acceptance_strictness（best_effort 缺省/hard 须视觉邻域措辞）、素材策略 asset_acquisition_mode（需求输入首产；ui-spec 仅投影）。
- **三段式路由**：inferred（文本推导，ratchet 锚）→ selected（只升不降；有效降档 receipt 才许降）→ effective（既有 `clampFidelityByCapability` 三档钳制）。`await_human_fidelity_tier` 删除；唯一阻塞形态=selected=pixel ∧ hard ∧ clamp 降档 → DEFERRED。
- **两谓词拆分**：执行类逻辑读 `isPixelExecutionTarget`（effective=pixel）；严重度抬升/真人确认/completion 封顶读 `isHardPixelContract`（effective=pixel ∧ hard）。确定性完整性错误不经谓词、恒 BLOCKER。
- `fidelity-intent.json` 为三轴唯一 SSOT（initializer 首产：goal=goal-runner preflight；phase-driven=spec Skill Step 1 经 `fidelity-intent-init` CLI）；capability-snapshot 同源；check-spec pregate 降为复核。
- fidelity 输入三路径全生效：parser 保留并校验 `fidelity`/`fidelity_receipt`；fresh CLI 送入 parser；override+transition 校验不再以 `argv.manifest` 为条件。
- 盲档 crop 免 c3 条目级预确认：仅限「本 invocation provider 确认执行 + 严格生产者 verified + hash/bbox 绑定复验有效」；真人确认降为终验收/翻案角色；verified 生产者语义不降。

本 change 取代 goal-fakepass-hardening / blind-visual-hardening 两 change 中「ambiguous+参考图+盲 → await_human_fidelity_tier 阻塞」的历史行为（该两 change 保留为历史记录，不回改）。

## Capabilities

- `goal-runner`：三段式路由 preflight、输入三路径、initializer。
- `harness-gates`：pregate 复核、两谓词、blind-crop 机器验真免 c3。
- `feature-artifact-layout`：fidelity-intent.json / capability-snapshot.json 产物契约。
- `agent-adapters`：phase 入口 initializer 唯一所有权（薄入口只透传）。

## Impact

不变式：desired/inferred ratchet 不被回写；「声称 pixel 已达成」仍须人确认；视觉债务/completion 诚实记账不动；crop verified 生产者语义不降。plan：`.cursor/plans/盲档意图自动定档_自声明识别与非关键冲突不阻塞_f6b2d9a4.plan.md`（v7）。
