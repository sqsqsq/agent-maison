# `element-service`（元服务）sub-variant

- **父 profile**：`hmos-app`。与标准 App **共用同一套 hvigor/hdc harness 与子树**。
- **当前行为**：与本 profile 的差异化规则仍以 [framework/docs/atomic-service-roadmap.md](../../docs/atomic-service-roadmap.md) 为路线图；在未落地独立 check 之前，可将未来仅对元服务生效的补充条款放在本目录下的 `phase-rules-overlays/*.overlay.yaml`，由 `profile-loader` 在 `project_profile.sub_variant=element-service` 时第二层合并。
- **配置**：在 `framework.config.json` 使用 `"project_profile": { "name": "hmos-app", "sub_variant": "element-service" }`。Legacy：`project_type: atomic_service` 仍会推导为该组合并打印 deprecation advisory。
