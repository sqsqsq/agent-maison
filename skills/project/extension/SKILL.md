---
name: extension
description: 管理实例侧 doc/extensions：初始化、检视、添加声明、全 adapter 物化、校验与调整。用于接入业务 Skill、知识、hooks、capability、phase rule overlay、skill assets、MCP action 与 Feature phase binding。
---

# Extension（实例扩展管理）

| 注入面 | 生效时机 | 强制力 |
|---|---|---|
| extension skill | 用户 `/<bridgeId>` 或 AGENTS.md 路由 | agent 侧 |
| hooks `.md` / `.mjs` | harness run 的 8 个内部事件；fragment 下一轮可见 | `.mjs` 失败进入 CheckResult |
| phase_rules_overlays | phase 规则合并时 | harness 强制 |
| capabilities | 能力裁决 / 降级时 | harness 强制 |
| skill_assets | 对应 Skill 消费时 | harness 强制 |
| knowledge（audience 路由） | phase → ai-prompt 索引；global → AGENTS.md | 文本指令 + inspect 证据 |
| phase_bindings 三槽位 | Feature phase 动笔前 / 校验前 / 校验后关环前 | 文本指令或既有 check / receipt 门禁 |
| mcp_actions | 绑定槽位内由 agent 调用，produces 落项目内 | 产物校验进入既有 CheckResult |
| story 类接入（M7 三接缝） | `/component-design` 前产出 materialization，之后消费 publication / 产出 feedback | `check:component-blueprint --materialization/--feedback` fail-closed |

强度只认三档：`available`（声明与入口可用）、`scheduled`（已绑定时机）、`evidenced`（有可验证产物或检查结果）。`trace.tool_calls` 仅是审计线索，不单独证明完成。

## 入口与意图

`/extension` 不暴露一组需要记忆的子命令。先根据用户原话归入一个意图，再调用同一确定性 CLI：

```bash
cd framework/harness
npx ts-node scripts/extension.ts --project-root <宿主工程根> --action <init|inspect|materialize|verify> --json
```

- `init`：仅补齐缺失 skeleton；已有文件不覆盖。
- `inspect`：首屏展示 manifest、bundle、桥接和产物的纯派生表；不写状态。
- `add` / `bind`：编辑 `doc/extensions/manifest.yaml` 与其引用的项目内文件，然后立即 `verify`。
- `materialize`：只读项目级 `materialized_adapters[]`，全量幂等刷新桥接与 AGENTS/CLAUDE 入口；不读个人 `agent_adapter`。
- `verify`：运行 CLI，并再跑 `npx ts-node harness-runner.ts --phase extensions --feature _global`。
- `adjust`：根据 inspect / verify 的精确 finding 修改唯一真源，再 materialize；不直接修生成物。

## add / bind 纪律

1. 先 `inspect`，确认已有 manifest 与目录事实。
2. 只写 manifest 支持的域：`skills`、`knowledge`、`hooks`、`capabilities`、`skill_assets`、`phase_rules_overlays`、`mcp_actions`、`phase_bindings`。
3. 新增 Skill 时同时创建 `skills/<id>/SKILL.md` 并在 `provides.skills[]` 声明；1.1 起未声明目录不物化。
4. `phase_bindings` 只管 Feature phases，只有 `before_phase_work`、`before_phase_verify`、`after_phase_verify_before_close`；没有 `before_component_design`。设计前置输入由扩展 Skill 自身流程承载。
   phase 名必须来自 active workflow 的 Feature scope（full/lite 并集）；global phase 与拼错的 slug 都会失败。
5. 绑定 唯一设计入口 `/component-design` 的知识使用现有 `skill_assets`，不发明 audience。
6. 每次编辑后 `verify`，通过后再 `materialize` 并复查 `inspect`。

## MCP 与 M7 红线

- 宿主负责调用 MCP、认证、脱敏与落盘；Maison 只验证仓内 `produces`。manifest 不写 server、URL、token、登录配置，也不安装 MCP server。
- `usage` 只写人读操作说明，不参与 artifact 类型判断；只有产物实际 `artifact` 被识别并通过既有 validator，inspect 才显示 M7 consumer/evidenced。
- 调用 action 前由当前 agent 检查 `tool` 是否可见，并把本轮结果通过 inspect 的 `--tool-visible <action-id>` / `--tool-missing <action-id>` 参数展示；该值不落盘，数据源固定标为 `agent_self_report`。
- `requirement-source-materialization@1` 与 `blueprint-review-feedback@1` 必须复用 `check:component-blueprint --materialization/--feedback`；publication 只消费确定性投影。
- 不碰 Goal Mode events / receipt / evidence，不新增完成裁决入口，不代签用户授权，不把 agent 自报工具可见性当机器证据。
- 不修改或接管宿主 Story extension；这里只提供 Maison 输入协议和桥接入口。

## 生成物保护

扩展 bridge 带 ownership 标记。只有“标记存在且内容仍等于规范渲染”的文件可覆盖或清理；标记内容漂移只报告不动；无标记文件不接管。`manifest.yaml` 与扩展 Skill 源始终是 SSOT。
