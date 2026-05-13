# `generic` · Skill `6-device-testing` profile addendum

`generic` 往往**禁用**真机/hdc 类 harness 子检查或整阶段；测试计划与报告仍可按 **AC/BD 与文字验收**组织，但**不要**假设存在可执行的 Hypium 用例或 HAP 安装路径。

若需恢复设备侧验证，应切换至带 `capabilities` 的宿主 profile（如 `hmos-app`）并补齐 toolchain 配置。
