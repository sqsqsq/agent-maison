# 实例扩展与 adapter 桥接 — 端到端验收记录

本文记录 **Framework 可演进性** 一轮改造后的手动验收要点（**非**自动化 harness 替代品）。

## 前置

- 实例根已配置 `paths.extension_dir`（默认 `doc/extensions`）、`lifecycle_hooks_enabled: true`。
- `framework/harness` 已 `npm install`。

## 1. `--phase extensions`

```bash
cd framework/harness && npx ts-node harness-runner.ts --phase extensions
```

期望：`extension_manifest_ok` 或等价 PASS；`manifest.yaml` 非法时 FAIL 且 details 含错误信息。

## 2. 带 `doc/extensions/` 的样例

本仓库演示包（钱包 SDK onboarding）包含（路径对齐 plan 白名单）：

- `manifest.yaml`（`provides.skills` / `knowledge` / `hooks`）
- `skills/wallet-sdk-onboarding/SKILL.md` 与 `reference/wallet-rpc-conventions.md`
- `knowledge/naming-taboos.md`
- `hooks/coding/pre_check.mjs` 与 `hooks/spec/on_context_load.md`

跑一次 **feature 链**上阶段（如 `spec` / `plan` / `coding`）时，lifecycle hook 应**注入片段**且不默认阻断主链（演示 hook 仅追加轻量 prompt 片段）。

## 3. `render-agents-md` 与桥接产物

```bash
cd <repo-root> && node framework/harness/scripts/render-agents-md.mjs \
  --entry-file CLAUDE.md \
  --summary "..." \
  --out CLAUDE.md \
  --no-instance-bridge
```

去掉 `--no-instance-bridge` 时：在 **claude** adapter 下应生成或更新 `.claude/commands/<bridgeId>.md`；在 **cursor** adapter 下应生成 `.cursor/skills/<bridgeId>/SKILL.md`。与内置 slash/跳板同名时 **`ext-` 前缀** + stderr 告警。

**弱模型路径（v2.8.3+）**：大文件渲染应优先 `render-agents-md.mjs`（Node 进程内落盘），避免 Write tool-call 传 200+ 行 content 失败；见 framework-init S3 adapter 物化 `tool-call retry-loop Ban`。

## 4. 确认 UX（Claude adapter）

扩展 Skill 若含 BLOCKER 级确认点，须遵循 adapter **interaction-renderer** + portable 编号菜单；registry 见 [`../../skills/reference/confirmation-registry.yaml`](../../skills/reference/confirmation-registry.yaml)。

## 5. 相关源码（维护者）

- [framework/harness/scripts/utils/instance-skill-bridge.ts](../../harness/scripts/utils/instance-skill-bridge.ts)
- [framework/harness/scripts/render-agents-md.ts](../../harness/scripts/render-agents-md.ts)
- [framework/harness/extension-loader.ts](../../harness/extension-loader.ts)
- [framework/harness/hooks-dispatcher.ts](../../harness/hooks-dispatcher.ts)

---

## 维护同步（2026-06-12 · 2.3.0）

- **`render-agents-md`**：S3 先落盘 `framework.config.json`；`render-agents-md.mjs` 为弱模型首选渲染路径。
- **feature 链示例**：lifecycle hook 烟测使用 canonical phase `spec` / `plan` / `coding`（非 legacy `prd` / `design`）。
- **Claude adapter**：通过 `user_confirmation.interaction_renderer_rule` 下发 `.claude/rules/interaction-renderer.md`；扩展 Skill 确认点须登记 registry。
- **Cursor adapter**：`instance_skill_bridge` 写入 `.cursor/skills/` 跳板；正文 SSOT 仍在 `framework/skills/`。
- 对照 [`DOC_INVENTORY.yaml`](../DOC_INVENTORY.yaml)：`instance_skill_bridge` / `extension-loader` / adapter manifest 与本文件一致。

