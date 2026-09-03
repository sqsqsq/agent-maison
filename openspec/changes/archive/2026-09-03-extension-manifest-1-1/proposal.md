# Proposal: Extension manifest 1.1 — 实例输入的静态绑定与可验证物化

## Why

现有 `doc/extensions/manifest.yaml` 只校验 knowledge 路径存在，`provides.skills` 不参与物化，扩展 Skill 又只按单个 legacy `agent_adapter` 桥接；业务知识和宿主动作即使声明也不能在指定阶段被消费或证明。M7 已提供三条宿主接缝，但缺少一条静态、可检视、零凭据的输入通道把宿主材料送入 `/component-design`。

## What Changes

- manifest 1.1 将 knowledge 对象化为 `path/summary/audience`，保留字符串兼容；新增 `provides.mcp_actions` 与顶层 `phase_bindings`。
- 1.1 的扩展 Skill 物化改以 `provides.skills[]` 为 SSOT；1.0 保持目录驱动和零新增行为。
- knowledge 按 audience 进入 Feature phase `ai-prompt.md` 索引或 AGENTS.md 全局知识段；绑定单 Skill 的材料继续使用 `skill_assets`。
- 三个 Feature phase 槽位只在既有 prompt/check/receipt 通道接线；required produces 缺失按 MAJOR/BLOCKER 分级，optional 缺失只报告降级。
- M7 materialization/feedback produces 复用 `check:component-blueprint` 的既有接缝 validator；工具可见性只接受当前 agent 自报，不落状态。
- `/extension inspect` 从 manifest、bundle、桥接和产物纯派生 available/scheduled/evidenced，不新增 registry、台账或完成事实。
- 非法 manifest 在 bridge、Feature harness 与 receipt 三条入口统一 fail-closed，不得伪装成无 manifest/1.0；`paths.extension_dir` 复用项目相对路径守卫。
- knowledge audience 与 phase binding 只接受 active workflow 的 Feature phase（full/lite 并集）；M7 类型只认产物实际 `artifact`，`usage` 永远只是人读说明。

## Impact

- Affected specs: `instance-extension-management`（新增 capability spec）
- Affected code: extension loader/types/schema、`render-agents-md`/bridge、AGENTS template、prompt assembly、`check-extensions`、harness/check-receipt produces gate、`/extension` Skill/CLI、adapter templates、宿主适配文档与随包样例
- Compatibility: 1.0 manifest、无 manifest、无 extension 目录均保持原行为；没有 extension 的工程零副作用
- Acceptance boundary: d8 的发布完成标准是 Maison 仓内协议、入口、发布件文档、样例及正反契约链；真实宿主采用与 H1A 回灌在发布后自然发生，不阻塞 d8 或 3.1.0 Maison 发布
