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
| `install <本地目录> [插件ID]` | 从这个目录安装 UX 行为说明 | 导入、校验并刷新项目入口。成品包按来源默认选择启用，裸 Skill 首装只公布手动入口。要先安装可加 `--no-enable`。 |
| `enable <插件ID> [绑定ID]` | 以后让蓝图在缺稿时自动提取 UX | 示例对应 `enable ux-behavior-spec fill-missing`。省略绑定 ID 启用整包及其步骤。选定绑定可用 `--at <时点ID>` 与 `--phase <阶段>` 保存宿主选择。 |
| `disable <插件ID> [绑定ID]` | 以后关闭自动提取，保留手动 UX | 示例对应 `disable ux-behavior-spec fill-missing`。省略绑定 ID 时停用整包的手动和自动参与。 |
| `uninstall <插件ID>` | 卸掉已装的 UX | 停止新调度，退出启用效果并清理有归属的副本。在途时立即返回待清理回执。 |
| `inspect [插件ID]` | 现在能在哪儿用 | 不指定插件时列出目标发布件全部时点，即使宿主尚无扩展。展示实际绑定、启用结果、漂移和待清理。用户问上次时加 `--request <请求ID或项目相对请求路径>`。 |

裸入口展示当前检视和常用说法。插件译名先用检视解析成稳定 ID。作用范围、插件和本地来源明确时，直接调用对应 CLI。一次性「这次别提取」交给本次作者准备，不调用项目级 `disable`。

每个带清单的本地包提供一个插件。安装写入 `paths.extension_dir/<插件ID>/`，宿主选择与导入指纹记录在扩展根的 `kind: host` 清单。插件的 `kind: plugin` 清单声明包版本、Skill、绑定和步骤。裸目录须有有效的根 `SKILL.md`，初装时生成包清单并公布手动入口。同源重装保留团队选择，新绑定待显式选择。安装回执报告已登记的入口、选择和待决定事项。

旧版平铺根会提示「旧版扩展未加载，请按需手工整理后重新接入」。普通业务继续。接入前先留存旧目录，或配置一个干净的新根，并由维护者确定各包资源。[旧版接入步骤](../../../MIGRATION.md#310-实例扩展按插件组织与手工接入)

正式调用会先准备所用插件。需要的本地产物若缺失或过期，按包清单执行可重复的文件生成并核对就绪；单包失败仅影响本轮相关投递。共享文件及非文件效果由维护者显式执行和退出。管理入口（含查看）或正式准备会报告并清理已删除插件留下的受管忽略文件。有在途引用、跟踪文件或手工资料时保留目录。

停用、卸载和替换已安装资源的升级会检查受管蓝图或 CU 作者的已签发请求。原请求仍在运行或保有签发执行窗时，立即返回已停止目标的新调度、当前占用 ID 和待重试的原命令。回执发出后原请求仍可使用安装副本。交回后重试同一命令完成清理。已结束或锁失效的记录只提示原因及签发请求路径。直接会话沿原非受管边界，从原会话交回查询结果。

检视区分 `available`（依赖具备）、`scheduled`（按支持时点绑定）和 `evidenced`（真实交付或检查的证据）。用户问实际参与时核对对应请求交付、交回和产物。旧稿存在仅供定位。纯文案直修按该原请求交付。

## 维护操作及手写声明

- `init / materialize / verify` 可用原 `--action` 参数。初始化为干净的根补齐骨架，物化按项目 `materialized_adapters[]` 刷新生成入口。校验也由 `harness-runner.ts --phase extensions --feature _global` 消费。
- 修改自有包时，在包清单的 `bindings.<绑定ID>` 维护时点，并按需要升版。项目常驻知识用 `project.entry@1`，设计前输入用 `component-design.before_discovery@1`，Feature 和 harness 时点按有效阶段选择。[Extension 接入协议](../../../docs/evolution/extension-protocol-v1.md)
- 根项目入口与分流见 [project-entry](../../../docs/operations/project-entry.md)。

### 按描述接入裸 Skill 或静态资源

1. 检视目标发布件、已装插件和来源说明。为静态输入拟定资源、`at`、`phase`、实际消费者和出处。例如「评审作者读指南」使用 `feature.before_phase_work@1 / review`。用户已授权时可维护包清单并通过管理入口选择该绑定。
2. 涉及命令时，展示步骤、顺序、`run`、`undo`、参数、工作目录、`scope`、产物和就绪依据。得到对具体提议的明确确认后，才在包清单的 `activation.steps` 写入并从正式 `enable` 执行。尚待确认时保留手动入口并报告提议。修改已生效的步骤前，先通过 `disable` 完成旧效果退出。
3. 已确认的声明写入插件清单，团队选择留在宿主清单。维护后运行 `verify` 和 `materialize`。回执报告入口、已登记项和实际命令结果。

## MCP 与 M7 红线

- 宿主负责调用 MCP、认证、脱敏与落盘；Maison 只验证仓内 `produces`。manifest 不写 server、URL、token、登录配置，也不安装 MCP server。
- `usage` 只写人读操作说明，不参与 artifact 类型判断；只有产物实际 `artifact` 被识别并通过既有 validator，inspect 才显示 M7 consumer/evidenced。
- 调用 action 前由当前 agent 检查 `tool` 是否可见，并把本轮结果通过 inspect 的 `--tool-visible <action-id>` / `--tool-missing <action-id>` 参数展示；该值不落盘，数据源固定标为 `agent_self_report`。
- `requirement-source-materialization@1` 与 `blueprint-review-feedback@1` 必须复用 `check:component-blueprint --materialization/--feedback`；publication 只消费确定性投影。
- 不碰 Goal Mode events / receipt / evidence，不新增完成裁决入口，不代签用户授权，不把 agent 自报工具可见性当机器证据。
- 不修改或接管宿主 Story extension；这里只提供 Maison 输入协议和桥接入口。

## 生成物保护

扩展 bridge 按 ownership 标记和上次生成指纹处理。当前内容仍匹配时可刷新或清理。已改写或宿主自有文件保留并报告。以插件清单和 Skill 原件核对派生入口。
