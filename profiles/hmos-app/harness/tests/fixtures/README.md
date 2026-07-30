# Profile 契约测试数据（hmos-app）

本目录承载 **宿主 profile=hmos-app** 侧常用 Harness **fixture**（含 init / spec Visual Handoff 与 ArkTS·hvigor 契约）。

## 当前布局

两类子树，**由有无 `CMD.json` 区分**：

**契约 fixture**（含 `CMD.json`，被 `run-tests.ts` 收集为具名用例）

| 子树 | 说明 |
|------|------|
| `init/` | `check-init` 体检链路 |
| `spec/` | Visual Handoff / `check-spec` 决策表行 |
| `v2_2/` | coding / ut / named-handler 等与 hvigor·ohosTest 绑定的契约基线 |
| `v2_3/` | visual-diff / structure-mapping 契约 |
| `catalog/` · `lite/` | adapter catalog / 轻量档 |

**纯数据 fixture**（无 `CMD.json`，由 unit 用 `path.join(__dirname, '..', 'fixtures', …)` 直接读取，不参与上面的收集）

| 子树 | 说明 |
|------|------|
| `ocr/` | OCR 工具链真实图片样本 |
| `round6/` | bbox 裁剪 / 反伪造校验样本 |
| `device-attribution/` | 真机归因四类样本（脱敏 dump + 派生计划 + trace + 误判 evidence + ui-spec）。宿主产品已回退重写，**不可复采**；见该目录 README |

`project_profile=generic` 专用最小用例见：

[`profiles/generic/harness/tests/fixtures/`](../../../../generic/harness/tests/fixtures)

## 运行器

[`run-tests.ts`](../../../../../harness/tests/run-tests.ts) 合并扫描 **主干** `framework/harness/tests/fixtures/`（现多仅为说明文案）与本目录、`generic` profile 目录。同一逻辑名在两处并存会 **收集即抛错**。
