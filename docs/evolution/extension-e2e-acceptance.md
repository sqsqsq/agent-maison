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

## 2. 安装随包样例

从已解包的 `framework/harness` 用下列命令安装、检视 [design-notes](../operations/samples/design-notes/)：

```bash
npx ts-node scripts/extension.ts install ../docs/operations/samples/design-notes --project-root "<宿主根>" --json
npx ts-node scripts/extension.ts inspect design-notes --project-root "<宿主根>" --json
```

宿主登记与包内源分别位于 `doc/extensions/manifest.yaml` 和 `doc/extensions/design-notes/`。在真实设计前准备请求中核对指南和作者动作。完整请求、交回与停用步骤见 [Extension 接入协议](extension-protocol-v1.md)。

## 3. `render-agents-md` 与桥接产物

```bash
cd <repo-root> && node framework/harness/scripts/render-agents-md.mjs \
  --entry-file CLAUDE.md \
  --summary "..." \
  --out CLAUDE.md \
  --no-instance-bridge
```

使用 `--all-materialized-adapters` 时只读项目级 `materialized_adapters[]`，为所有 adapter 刷新桥接；
不读取个人 `agent_adapter`。入口只物化启用且已登记插件的 `provides.skills[]`。与内置 slash/跳板
同名时用 **`ext-` 前缀** + stderr 告警。

生成 bridge 带 ownership 标记：规范字节可覆盖/清理，标记件漂移只报告不动，无标记文件不接管。
旧版无 ownership bridge 与普通用户文件同样保持 unowned/untouched；不会自动接管或纳入后续 orphan cleanup。

## 4. 时点消费、跨 clone 准备和 M7

- `project.entry@1` 在入口物化时生成静态知识索引；Feature 知识只进入绑定阶段的作者输入。旧平铺扩展显示手工接入提示，普通请求继续。
- 用集成同一发布件的两份隔离 Git clone 验证本地产物：A 安装、启用并提交，B 首次取用生成、再次复用。A 升版后 B 保留同名旧产物，下一次使用可重建。删除产物、脚本失败后重试和隔离另一包的消费。A 删除包后 B 拉取仍保持干净，下次查看或准备时清除受管残留。含跟踪文件、手工资料或在途引用时保留。用 `git ls-files` 和 `git status` 核对。
- required produces 缺失在 before-work/before-verify 的既有 CheckResult 或 after-verify 的 receipt 门禁失败；optional 缺失只报告降级。
- `requirement-source-materialization@1` 与 `blueprint-review-feedback@1` 必须命中既有
  `check:component-blueprint --materialization/--feedback`。最小声明见
  [`../operations/samples/extension-m7-manifest.yaml`](../operations/samples/extension-m7-manifest.yaml)。
- 反例：未登记目录与非法插件清单不参与入口物化，显式扩展校验报告具体缺口。`usage` 写 M7 但实际 artifact 未识别时，检视只显示普通产物检查。

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
