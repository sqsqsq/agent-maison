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
| `install <本地目录> [能力ID]` | 从这个目录安装 UX 行为说明 | 初始化缺失骨架，导入选中能力，校验并刷新项目已接入的入口。展示手动入口、自动绑定及不可用原因。 |
| `enable <能力ID> [绑定ID]` | 以后让蓝图在缺稿时自动提取 UX | 示例对应 `enable ux-behavior-spec fill-missing`。省略绑定 ID 启用整项能力。 |
| `disable <能力ID> [绑定ID]` | 以后关闭自动提取，保留手动 UX | 示例对应 `disable ux-behavior-spec fill-missing`。省略绑定 ID 时停用整项的手动和自动参与。 |
| `uninstall <能力ID>` | 卸掉已装的 UX | 卸载仍在使用原签发资源的请求须等待原请求交回。返回请求 ID 和保留路径。 |
| `inspect [能力ID]` | 现在能在哪儿用 | 只读展示当前可用性、绑定时点、入口和缺口。用户问上次时加 `--request <请求ID或项目相对请求路径>`，读本次真实原件并说明证据缺口。 |

裸入口展示当前检视和常用说法。能力译名先用检视解析成稳定 ID。作用范围、能力和本地来源明确时，直接调用对应 CLI。一次性「这次别提取」交给本次作者准备，不调用项目级 `disable`。

安装读取含清单的本地目录。宿主持久选择统一写入 `paths.extension_dir/manifest.yaml`。重装保留既有宿主开关，新出现的自动绑定保持关闭并列出供选择。同名宿主文件、已修改副本和项目手写资料按结果说明保留。扩展后续执行读取已安装资源。

检视区分 `available`（依赖具备）、`scheduled`（按支持时点绑定）和 `evidenced`（真实交付或检查的证据）。用户问实际参与时核对对应请求交付、交回和产物。旧稿存在仅供定位。纯文案直修按该原请求交付。

## 维护操作及手写声明

- `init / materialize / verify` 仍可用原 `--action` 参数。初始化仅补缺失；物化按项目 `materialized_adapters[]` 刷新生成入口；校验也由 `harness-runner.ts --phase extensions --feature _global` 消费。
- 手工维护时先检视，编辑清单和它引用的项目内资源，再校验和物化。现有 Feature phase bindings、knowledge、hooks、MCP actions、capabilities 和 skill assets 继续按原消费方工作。
- 新设计前贡献可绑定 `component-design.before_discovery@1`。旧 `provides.skill_assets.component-design.knowledge` 沿用 extension 优先于 profile 的规则。发布件支持的时点、许可资源、诊断和验收口径见 [实例扩展协议](../../../docs/evolution/extension-protocol-v1.md)。
- 根项目入口与分流见 [project-entry](../../../docs/operations/project-entry.md)。

## MCP 与 M7 红线

- 宿主负责调用 MCP、认证、脱敏与落盘；Maison 只验证仓内 `produces`。manifest 不写 server、URL、token、登录配置，也不安装 MCP server。
- `usage` 只写人读操作说明，不参与 artifact 类型判断；只有产物实际 `artifact` 被识别并通过既有 validator，inspect 才显示 M7 consumer/evidenced。
- 调用 action 前由当前 agent 检查 `tool` 是否可见，并把本轮结果通过 inspect 的 `--tool-visible <action-id>` / `--tool-missing <action-id>` 参数展示；该值不落盘，数据源固定标为 `agent_self_report`。
- `requirement-source-materialization@1` 与 `blueprint-review-feedback@1` 必须复用 `check:component-blueprint --materialization/--feedback`；publication 只消费确定性投影。
- 不碰 Goal Mode events / receipt / evidence，不新增完成裁决入口，不代签用户授权，不把 agent 自报工具可见性当机器证据。
- 不修改或接管宿主 Story extension；这里只提供 Maison 输入协议和桥接入口。

## 生成物保护

扩展 bridge 按 ownership 标记和上次生成指纹处理。当前内容仍匹配时可刷新或清理。已改写或宿主自有文件保留并报告。`manifest.yaml` 与扩展 Skill 源始终是 SSOT。
