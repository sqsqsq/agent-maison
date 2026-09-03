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

先用 `/extension inspect` 对账，再用 `/extension verify` 触发同一检查通道；inspect 的 JSON 与人话表
必须同时列出类型、来源、生效时机、消费者、`available|scheduled|evidenced` 和当前状态。

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

使用 `--all-materialized-adapters` 时只读项目级 `materialized_adapters[]`，为所有 adapter 刷新桥接；
不读取个人 `agent_adapter`。1.1 只物化 `provides.skills[]`，1.0 保持目录驱动。与内置 slash/跳板
同名时用 **`ext-` 前缀** + stderr 告警。

生成 bridge 带 ownership 标记：规范字节可覆盖/清理，标记件漂移只报告不动，无标记文件不接管。
旧版无 ownership bridge 与普通用户文件同样保持 unowned/untouched；不会自动接管或纳入后续 orphan cleanup。

## 4. Manifest 1.1 消费与 M7

- global knowledge 只进 AGENTS/CLAUDE；Feature phase audience 只进对应 ai-prompt 索引；1.0 不消费 knowledge。
- required produces 缺失在 before-work/before-verify 的既有 CheckResult 或 after-verify 的 receipt 门禁失败；optional 缺失只报告降级。
- `requirement-source-materialization@1` 与 `blueprint-review-feedback@1` 必须命中既有
  `check:component-blueprint --materialization/--feedback`。最小声明见
  [`../operations/samples/extension-m7-manifest.yaml`](../operations/samples/extension-m7-manifest.yaml)。
- 反例：非法 manifest 不得物化目录 rogue Skill，且普通 Feature harness/receipt 必须出现 manifest
  BLOCKER；`usage` 写 M7 但实际 artifact 未识别时，不得显示 M7 consumer。

**弱模型路径**：大文件渲染由 `/extension materialize` 的确定性 Node/TS 链落盘，避免模型手写 200+ 行入口文件。

## 5. 确认 UX（Claude adapter）

扩展 Skill 若含 BLOCKER 级确认点，须遵循 adapter **interaction-renderer** + portable 编号菜单；registry 见 [`../../skills/reference/confirmation-registry.yaml`](../../skills/reference/confirmation-registry.yaml)。

## 6. 相关源码（维护者）

- [framework/harness/scripts/utils/instance-skill-bridge.ts](../../harness/scripts/utils/instance-skill-bridge.ts)
- [framework/harness/scripts/render-agents-md.ts](../../harness/scripts/render-agents-md.ts)
- [framework/harness/extension-loader.ts](../../harness/extension-loader.ts)
- [framework/harness/hooks-dispatcher.ts](../../harness/hooks-dispatcher.ts)
- [framework/harness/scripts/utils/extension-runtime.ts](../../harness/scripts/utils/extension-runtime.ts)
- [framework/skills/project/extension/SKILL.md](../../skills/project/extension/SKILL.md)

---

## 维护同步（2026-09-03 · 3.1.0）

- **`/extension`**：init/inspect/materialize/verify 统一入口；framework-init 不再声称补 extension skeleton。
- **feature 链示例**：lifecycle hook 烟测使用 canonical phase `spec` / `plan` / `coding`（非 legacy `prd` / `design`）。
- **Claude adapter**：通过 `user_confirmation.interaction_renderer_rule` 下发 `.claude/rules/interaction-renderer.md`；扩展 Skill 确认点须登记 registry。
- **所有 adapter**：以 `materialized_adapters[]` 全量刷新；各自命令或 skills-bridge 入口的正文 SSOT 仍在 `framework/skills/`。
- 对照 [`DOC_INVENTORY.yaml`](../DOC_INVENTORY.yaml)：`instance_skill_bridge` / `extension-loader` / adapter manifest 与本文件一致。
