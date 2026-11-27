---
name: extension
description: 从本地目录安装、启用、停用、卸载或检视实例扩展。支持手动 Skill、设计前知识与动作、Feature 贡献、hooks 和 M7 接缝。
---

# Extension（实例扩展管理）

通过当前 Agent 的项目命令、Skill 或根项目指引进入。具名命令和用户同义说法共用以下操作。当前项目的配置与原请求写权继续生效。

在宿主的 `framework/harness` 工作目录中调用：

```bash
npx ts-node scripts/extension.ts <操作及其参数> --project-root "<宿主工程根>" --json
```

| 具名操作 | 用户说法示例 | 处理 |
| --- | --- | --- |
| `install <本地目录> [能力ID]` | 从这个目录安装 UX 行为说明 | 导入、校验并刷新项目入口。成品包按来源默认选择启用，裸 Skill 首装只公布手动入口。要先安装可加 `--no-enable`。 |
| `enable <能力ID> [绑定ID]` | 以后让蓝图在缺稿时自动提取 UX | 示例对应 `enable ux-behavior-spec fill-missing`。省略绑定 ID 启用整项能力及其步骤。选定绑定可用 `--at <时点ID>` 与 `--phase <阶段>` 保存宿主选择。 |
| `disable <能力ID> [绑定ID]` | 以后关闭自动提取，保留手动 UX | 示例对应 `disable ux-behavior-spec fill-missing`。省略绑定 ID 时停用整项的手动和自动参与。 |
| `uninstall <能力ID>` | 卸掉已装的 UX | 停止新调度，退出启用效果并清理有归属的副本。在途时立即返回待清理回执。 |
| `inspect [能力ID]` | 现在能在哪儿用 | 不指定能力时列出目标发布件全部时点，即使宿主尚无扩展。展示实际绑定、启用结果、漂移和待清理。用户问上次时加 `--request <请求ID或项目相对请求路径>`。 |

裸入口展示当前检视和常用说法。能力译名先用检视解析成稳定 ID。作用范围、能力和本地来源明确时，直接调用对应 CLI。一次性「这次别提取」交给本次作者准备，不调用项目级 `disable`。

安装读取本地来源。带清单的来源使用声明的流程，裸目录须有有效的根 `SKILL.md`。安装会导入随附资源并跳过 `.git` 元数据，首次只公布手动入口，扩展命令执行数为零。宿主选择写入 `paths.extension_dir/manifest.yaml`。同源重装沿用已有开关和已接受声明，新出现的自动绑定待显式选择。安装回执列出入口、绑定、保留文件、实际启用结果及待决定的建议。

旧 1.0 清单迁移时，安装回执列出实际删除的宿主字段和实际忽略的来源字段，包含原清单中存在的 `phase_bindings`、`provides.mcp_actions`。迁移保持这些旧声明原有的不参与语义。

停用、卸载和替换已安装资源的升级会检查受管蓝图或 CU 作者的已签发请求。原请求仍在运行或保有签发执行窗时，立即返回已停止目标的新调度、当前占用 ID 和待重试的原命令。回执发出后原请求仍可使用安装副本。交回后重试同一命令完成清理。已结束或锁失效的记录只提示原因及签发请求路径。直接会话沿原非受管边界，从原会话交回查询结果。

检视区分 `available`（依赖具备）、`scheduled`（按支持时点绑定）和 `evidenced`（真实交付或检查的证据）。用户问实际参与时核对对应请求交付、交回和产物。旧稿存在仅供定位。纯文案直修按该原请求交付。

## 维护操作及手写声明

- `init / materialize / verify` 仍可用原 `--action` 参数。初始化仅补缺失；物化按项目 `materialized_adapters[]` 刷新生成入口；校验也由 `harness-runner.ts --phase extensions --feature _global` 消费。
- 手工维护时先检视，编辑清单和它引用的项目内资源，再校验和物化。现有 Feature phase bindings、knowledge、hooks、MCP actions、capabilities 和 skill assets 继续按原消费方工作。
- 新设计前贡献可绑定 `component-design.before_discovery@1`。旧 `provides.skill_assets.component-design.knowledge` 沿用 extension 优先于 profile 的规则。发布件支持的时点、许可资源、诊断和验收口径见 [Extension 接入协议](../../../docs/evolution/extension-protocol-v1.md)。
- 根项目入口与分流见 [project-entry](../../../docs/operations/project-entry.md)。

### 按描述接入裸 Skill 或静态资源

1. 先检视目标发布件、已装能力和来源说明。拟定要写入宿主 `paths.extension_dir/manifest.yaml` 的变更。静态提议写明能力、资源、`at`、`phase`、实际消费者与说明的出处。例如用户要求评审作者读指南，则提议 `feature.before_phase_work@1 / review`。用户已明确授权的选择可应用；只由提供方描述提出的自动参与作为建议交回。
2. 涉及命令时，展示具体步骤、顺序、`run`、`undo`、参数、工作目录和产物。先取得用户对该具体提议的明确确认，再写入可执行声明并从正式 `enable` 执行。普通安装请求、来源文档中的命令和仅显示提议均属于待确认。无退出依据、用户拒绝或未答复时，保留手动入口并记录待决定项，扩展命令执行数保持为零。更新正在生效的启用步骤前，先经 `disable` 完成旧效果退出，使旧命令和归属可用至退出完成。
3. 在 `bindings.<能力ID>.<绑定ID>` 写入获准的静态声明，对已安装能力用管理入口启用对应绑定。获准的步骤写入同一份 2.1 清单 `activation.<能力ID>.steps`，先保存获准的绑定选择，再用整项 `enable` 执行。手工维护后运行 `verify` 和 `materialize`。命令由管理入口预告并执行。回执列出手动入口、已写入项、命令实际结果和待决定项。同源重装保留已接受的选择。

## MCP 与 M7 红线

- 宿主负责调用 MCP、认证、脱敏与落盘；Maison 只验证仓内 `produces`。manifest 不写 server、URL、token、登录配置，也不安装 MCP server。
- `usage` 只写人读操作说明，不参与 artifact 类型判断；只有产物实际 `artifact` 被识别并通过既有 validator，inspect 才显示 M7 consumer/evidenced。
- 调用 action 前由当前 agent 检查 `tool` 是否可见，并把本轮结果通过 inspect 的 `--tool-visible <action-id>` / `--tool-missing <action-id>` 参数展示；该值不落盘，数据源固定标为 `agent_self_report`。
- `requirement-source-materialization@1` 与 `blueprint-review-feedback@1` 必须复用 `check:component-blueprint --materialization/--feedback`；publication 只消费确定性投影。
- 不碰 Goal Mode events / receipt / evidence，不新增完成裁决入口，不代签用户授权，不把 agent 自报工具可见性当机器证据。
- 不修改或接管宿主 Story extension；这里只提供 Maison 输入协议和桥接入口。

## 生成物保护

扩展 bridge 按 ownership 标记和上次生成指纹处理。当前内容仍匹配时可刷新或清理。已改写或宿主自有文件保留并报告。`manifest.yaml` 与扩展 Skill 源始终是 SSOT。
