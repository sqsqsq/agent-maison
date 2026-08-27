## Why

Plan closure 当前只校验 `contracts.yaml` 字段形态，没有证明其中的文件路径引用都已被顶层 `contracts.files` 授权；例如 `resource_keys.media` 可引用二十个未声明 logo，直到 coding UI scope gate 才延迟失败。Plan 阶段必须在签发 closure 前完成文件授权闭包。

## What Changes

- `contracts.yaml` 继续作为唯一持久输入，`contracts.files` 继续作为唯一文件授权集合；closure 时仅构造内存规范化引用视图，不持久化 graph。
- 生产 parser/resolver 收集 `resource_keys[*].path`、media、页面/路由注册、HAR index/builder/export 及 contracts schema 中其他文件路径引用，并强制 `references ⊆ contracts.files`。
- 缺少授权引用时 plan closure BLOCKER FAIL；扩面唯一路径是回 plan 修改 `contracts.files` 后重新 closure。
- 禁止字节一致自动豁免、第二授权字段、测试专用事实表或 reference manifest。
- 增加 bc-openCard-1 二十 logo 形状的最小 fixture：未列入 files 时 FAIL，补入后 PASS，并复用生产解析/closure API。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `harness-gates`: plan closure 必须执行 contracts 文件引用闭包门禁。
- `feature-artifact-layout`: `contracts.files` 被明确为 contracts 内全部物化文件引用的唯一授权集合，闭包图仅为内存派生视图。

## Impact

- 影响 plan contracts parser/resolver、`harness/scripts/check-plan.ts`、contracts schema/模板、plan skill 文档与 fixtures。
- 这是 plan closure 的 fail-closed 收紧；合法 contracts 无行为变化。既有 feature 若引用未列入 `contracts.files` 的文件，需回 plan 扩充集合并重跑 closure；该消费者动作记录到 `MIGRATION.md`。
