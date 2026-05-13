# Hypium / ohosTest · `verify-ut` 语义补充

合并阅读主 prompt 时额外关注：

1. **UI 禁入**与主文一致：以 `ut_import_whitelist` 为准；常见需避免 import 的符号包括 `@Component`、`struct`、`NavPathStack`、`showToast`、`$r`、`$rawfile`、`AppStorage`、`LocalStorage`、`@kit.ArkUI`、`@kit.ArkGraphics` 等。
2. `@ohos/hypium`、`describe`/`it` 结构及 **禁止 UI import**（与 `check-ut` 白名单一致）。
3. `use-cases.yaml` ↔ DAG ↔ UT 的 **branch / AC** 对齐与命名标签 `[AC-*]` / `[BRANCH-*]`。
4. mock-plan Spy/Fake **类型化表达式** (`as Type` / `new`) 是否满足脚本粗校验意图。
