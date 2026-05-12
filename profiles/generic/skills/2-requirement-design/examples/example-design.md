# Demo 控制台 — 技术设计（`generic` 中性示例节选）

> 演示 `design.md` 与契约段落如何组织；路径、模块名、外层 id **必须**与当前工程 DSL 对齐。

## Scope 声明与继承（示意）

参见 `` `profile-skill-asset:2-requirement-design/design_template` `` 中的 YAML 脚手架；此处略。

## 模块与依赖示意

- `TaskFeature`：`features` 外层，负责任务草稿 UI 与本地状态机占位
- `PlatformCore`：`platform` 外层，封装远端 API Client（模拟实现可先放在 `features` 内，按 scope 决定）

完整 contracts / 页面分解表请在你的真实 feature 目录中展开；本示例不绑定具体文件名或宿主扩展名。
