# 模块脚手架占位 · `generic` profile

`generic` 不假定宿主目录形态（无固定 `HAR/HAP`、`oh-package`、`src/main/ets` 等）。

拆分模块时请：

1. 在 `framework.config.json` 与 `doc/architecture.md` 中声明模块名与外层 id。
2. 在 Skill 3 的宿主 profile addendum（如切换到 `hmos-app`）中查阅真实目录模板与脚手架样例。
3. 将设计契约写入 `contracts.yaml`，实现路径必须与契约一致。
