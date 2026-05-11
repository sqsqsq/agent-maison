### `ui_component_terminology`（ArkUI）

当 Spec 含 `semantic_checks.ui_component_terminology` 时，对检查 5 额外要求：

1. 阅读「页面/界面描述」中组件表或段落里的 **类型/控件** 表述。
2. 优先期望 **ArkUI** 组件名：`Column`、`Row`、`List`、`Tabs`、`Navigation`、`Swiper`、`Text`、`Image`、`Button` 等。
3. 若大篇幅使用泛化 HTML/CSS 词汇且无法映射到 ArkUI 等价物 → **WARN**（不要因非 ArkUI 栈而 FAIL，除非 PRD 已自相声明为 ArkUI 工程却全文 HTML 术语）。
