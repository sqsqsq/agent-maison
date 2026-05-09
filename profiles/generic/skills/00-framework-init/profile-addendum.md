# `generic` · Skill `00-framework-init` profile addendum

初始化时以 **最小 `architecture` + `paths` + `project_profile.name: generic`** 为常见目标；**不**强写 DevEco/hvigor 路径，除非用户显式要落文档型宿主仍带 toolchain 占位。

`render-agents-md.mjs` 会从 `framework/profiles/generic/templates/agents-md/*.partial.md` 注入入口 Markdown 的 SSOT 行与 §3.4 说明；升级 framework 后若增删阶段禁用，需同步核对 `profile.yaml` 与 harness **fixture** 期望。

**文档骨架**：`doc/architecture.md` / `module-catalog.yaml` 的 MISSING 档位可优先拷贝 `framework/profiles/generic/doc-skeletons/`（与同目录 `module-catalog.skeleton.yaml`）。
