# Extension 接入协议

实例扩展由本地来源包、宿主管理选择和实际消费者共同决定。发布件中的管理入口负责安装、启停、校验及项目入口物化。宿主在 `framework/harness` 安装运行依赖后，从该目录运行本文的命令。例子使用默认扩展根 `doc/extensions`，宿主可用 `paths.extension_dir` 指定其他项目相对目录。

## 1. 包怎么组织，每个字段写了会发生什么？

带 `manifest.yaml` 的本地来源可以声明一个或多个能力。能力 ID 与绑定 ID 应随升级保持稳定。下面是随包可直接安装的 [design-notes](../operations/samples/design-notes/) 示例，含一条知识和一个作者动作。

```text
design-notes/
├── manifest.yaml
├── knowledge/
│   └── design-notes/
│       └── guide.md
└── skills/
    └── design-notes/
        └── SKILL.md
```

`manifest.yaml`

```yaml
schema_version: "2.1"
name: design-notes
version: "1.0.0"
description: 设计前核对需求与待确认问题。
provides:
  skills: [design-notes]
bindings:
  design-notes:
    guide:
      at: component-design.before_discovery@1
      kind: knowledge
      ref: knowledge/design-notes/guide.md
      enabled_by_default: true
    note:
      at: component-design.before_discovery@1
      kind: action
      ref: design-notes
      enabled_by_default: true
```

`knowledge/design-notes/guide.md`

```markdown
# 设计前核对指南

从需求原件摘出可验收的约束，每条保留来源位置。另列可能改变设计的待确认问题，说明它影响的决定。
```

`skills/design-notes/SKILL.md`

```markdown
---
name: design-notes
description: 在允许写入的蓝图目录中记录设计前核对结果。
---

# 设计前核对记录

在设计前动作中使用本次送达的核对指南和需求原件。获得当前蓝图目录的写入授权后，向该目录下的 `notes.md` 写入两节“可验收的约束”和“待确认的问题”。已有合适笔记可回读复用，有未经授权的现有内容时保留原件并写明冲突。

回读笔记，核对每条约束的来源位置及待确认问题所影响的设计决定。按实际结果在原作者交回中记录产物路径。缺少需求原件或写入授权时记录 `skipped` 及原因。
```

清单相对路径使用扩展根，安装归属和 MCP 产物使用宿主工程根。使用 `/` 分隔各段，路径须在相应目录内。普通 Skill 及随附资源也可以直接交付，一个有有效 `SKILL.md` 的裸目录首次安装只公布手动入口。同一来源重装保留宿主已接受的声明。

字段表由随包的 [扩展清单 schema](../../specs/instance-extension-manifest.schema.yaml) 生成。必填性针对所属条目，版本列给出字段起点。

<!-- BEGIN GENERATED manifest-fields -->
| 字段路径 | 版本起点 | 填写方 | 必填 | 默认 | 运行效果 |
| --- | --- | --- | --- | --- | --- |
| `schema_version` | 1.0+ | 来源或宿主 | 是 | — | 选择字段的解析协议。动态步骤和宿主时点覆盖使用 2.1。 |
| `name` | 1.0+ | 来源或宿主 | 是 | — | 声明来源身份。在 1.1 中须为小写 slug。 |
| `version` | 1.0+ | 来源或宿主 | 可选 | — | 标明包版本，供管理端记录与核对重装、升级。 |
| `description` | 1.0+ | 来源或宿主 | 可选 | — | 面向读者的能力简介，仅供说明。 |
| `framework_compat` | 1.0+ | 来源或宿主 | 可选 | — | 以 semver 范围描述适用框架版本，仅供说明。 |
| `provides` | 1.0+ | 来源或宿主 | 可选 | — | 声明手动技能及既有消费者可用的资源。 |
| `provides.skills` | 1.0+ | 来源或宿主 | 可选 | — | 手动入口的逻辑 Skill ID，指向扩展根的 skills/<id>/SKILL.md，1.0 入口按目录发现。 |
| `provides.knowledge` | 1.0+ | 来源或宿主 | 可选 | — | 1.0 字符串只登记文件。1.1 起，字符串进入所有 Feature 阶段的动态索引， 对象按 audience 投递。2.0 起可用 audience none 保留旧路径的登记。 |
| `provides.knowledge[].path` | 1.1 | 来源或宿主 | 是 | — | 扩展根相对知识路径。 |
| `provides.knowledge[].summary` | 1.1 | 来源或宿主 | audience 非 none 时必填 | — | 显示在投递索引中的摘要。 |
| `provides.knowledge[].audience` | 1.1 | 来源或宿主 | 是 | — | global 进入项目入口，非空阶段数组进入对应 Feature 作者索引，none 仅保留文件登记（2.0 起）。 |
| `provides.hooks` | 1.0+ | 来源或宿主 | 可选 | — | 兼容写法。按阶段和事件列出扩展根相对的 .md 或 .mjs，由原 harness 消费。 |
| `provides.capabilities` | 1.0+ | 来源或宿主 | 可选 | — | 将键映射到原 harness capability registry 的本地 provider 和严重级别。 |
| `provides.capabilities.<能力键>.provider` | 1.0+ | 来源或宿主 | 是 | — | 扩展根相对的 capability provider 路径。 |
| `provides.capabilities.<能力键>.severity` | 1.0+ | 来源或宿主 | 是 | — | 原 capability 检查使用的严重级别。 |
| `provides.phase_rules_overlays` | 1.0+ | 来源或宿主 | 可选 | — | 为指定阶段追加扩展根内的规则 YAML，由原规则合并器读取。 |
| `provides.skill_assets` | 1.0+ | 来源或宿主 | 可选 | — | 按 Skill 与资源键指定扩展根相对路径，覆盖 profile 同键资源。 |
| `provides.mcp_actions` | 1.1 | 来源或宿主 | 可选 | — | 供宿主角色调用的 MCP 工具与产物。连接与凭据由宿主管理。 |
| `provides.mcp_actions.<动作ID>.tool` | 1.1 | 来源或宿主 | 是 | — | 宿主 agent 看到的工具 ID。 |
| `provides.mcp_actions.<动作ID>.required` | 1.1 | 来源或宿主 | 是 | — | 声明当前消费者是否要求产物。 |
| `provides.mcp_actions.<动作ID>.severity` | 1.1 | 来源或宿主 | 可选 | `"MAJOR"` | 所需产物不满足时原消费者使用的严重级别。 |
| `provides.mcp_actions.<动作ID>.produces` | 1.1 | 来源或宿主 | 是 | — | 要核对的宿主工程根相对产物路径。 |
| `provides.mcp_actions.<动作ID>.usage` | 1.1 | 来源或宿主 | 是 | — | 面向作者的工具用法说明。 |
| `phase_bindings` | 1.1 | 来源或宿主 | 可选 | — | Feature 旧式绑定，按阶段和兼容槽位选择。可选槽位与消费约束见下文。 |
| `phase_bindings.<阶段>.before_phase_work` | 1.1 | 来源或宿主 | 可选 | — | 动笔前将兼容资源交给 Feature 作者，原 checker 检查 MCP 声明产物。 |
| `phase_bindings.<阶段>.before_phase_work[].kind` | 1.1 | 来源或宿主 | 是 | — | 兼容绑定资源类别。 |
| `phase_bindings.<阶段>.before_phase_work[].ref` | 1.1 | 来源或宿主 | 是 | — | 对应的知识路径、Skill 或 MCP 动作 ID。 |
| `phase_bindings.<阶段>.before_phase_verify` | 1.1 | 来源或宿主 | 可选 | — | 由原 Feature checker 核对 MCP 声明产物。 |
| `phase_bindings.<阶段>.before_phase_verify[].kind` | 1.1 | 来源或宿主 | 是 | — | 兼容绑定资源类别。 |
| `phase_bindings.<阶段>.before_phase_verify[].ref` | 1.1 | 来源或宿主 | 是 | — | 对应的知识路径、Skill 或 MCP 动作 ID。 |
| `phase_bindings.<阶段>.after_phase_verify_before_close` | 1.1 | 来源或宿主 | 可选 | — | 由原收口检查核对 MCP 声明产物。 |
| `phase_bindings.<阶段>.after_phase_verify_before_close[].kind` | 1.1 | 来源或宿主 | 是 | — | 兼容绑定资源类别。 |
| `phase_bindings.<阶段>.after_phase_verify_before_close[].ref` | 1.1 | 来源或宿主 | 是 | — | 对应的知识路径、Skill 或 MCP 动作 ID。 |
| `bindings` | 2.0 | 来源或宿主 | 可选 | — | 将能力 ID 和稳定绑定 ID 映射到一条自动投递声明。 |
| `bindings.<能力ID>.<绑定ID>.at` | 2.0 | 来源或宿主 | 是 | — | 使用已发布且带版本的时点 ID，见时点表。 |
| `bindings.<能力ID>.<绑定ID>.kind` | 2.0 | 来源或宿主 | 是 | — | 按时点选择知识或动作。 |
| `bindings.<能力ID>.<绑定ID>.ref` | 2.0 | 来源或宿主 | 是 | — | 知识和生命周期 hook 使用扩展根相对路径。作者 Skill 或 checker MCP 贡献填对应的 ID。 |
| `bindings.<能力ID>.<绑定ID>.phase` | 2.0 | 来源或宿主 | Feature、harness 时点必填，项目时点省略 | — | 选择当前 workflow 中有效的阶段。 |
| `bindings.<能力ID>.<绑定ID>.enabled_by_default` | 2.0 | 来源或宿主 | 可选 | `false` | 成品包首装且启用整项时采用的自动绑定开关。 |
| `bindings.<能力ID>.<绑定ID>.required` | 2.0 | 来源或宿主 | 可选 | `false` | 选择该绑定后资源不可用时，在实际消费者处报告依赖缺口。 |
| `activation` | 2.1 | 来源或宿主 | 可选 | — | 能力启用的有序步骤。宿主也可在明确确认命令后维护同一声明。 |
| `activation.<能力ID>.steps` | 2.1 | 来源或宿主 | 是 | — | 启用按顺序运行，退出按逆序撤回。所有步骤及生效资源通过校验后才开放调度。 |
| `activation.<能力ID>.steps[].id` | 2.1 | 来源或宿主 | 是 | — | 同一能力内唯一的稳定步骤 ID。 |
| `activation.<能力ID>.steps[].cwd` | 2.1 | 来源或宿主 | 是 | — | 扩展根相对工作目录，使用 skills/<能力ID> 或其子目录。 |
| `activation.<能力ID>.steps[].run` | 2.1 | 来源或宿主 | 是 | — | 启用时运行的可执行程序及参数数组。 |
| `activation.<能力ID>.steps[].outputs` | 2.1 | 来源或宿主 | 是 | — | 本步独占创建的扩展根相对文件或目录。没有文件产物时填空数组。 |
| `activation.<能力ID>.steps[].undo` | 2.1 | 来源或宿主 | 产生非文件效果时必填 | — | 补偿或停用时运行的可重复命令，必须只撤销当前实例的效果。 |
| `installations` | 2.0 | 宿主 | 可选 | — | 管理入口持久化的宿主选择、归属与实际启停结果，键为能力 ID。来源包的该字段不参与安装。 |
| `installations.<能力ID>.source` | 2.0 | 宿主 | 是 | — | 能力的安装来源身份。 |
| `installations.<能力ID>.version` | 2.0 | 宿主 | 可选 | — | 已导入来源包的版本。 |
| `installations.<能力ID>.enabled` | 2.0 | 宿主 | 是 | — | 宿主整项开关，动态能力还需启用结果才能参与。 |
| `installations.<能力ID>.bindings` | 2.0 | 宿主 | 是 | — | 各绑定的宿主开关，重装保留已有选择。 |
| `installations.<能力ID>.files` | 2.0 | 宿主 | 是 | — | 导入副本的宿主根相对路径与 SHA-256，用于核对所有权。 |
| `installations.<能力ID>.in_place` | 2.0 | 宿主 | 可选 | — | 原始文件在扩展目录就地管理，卸载时保留原件。 |
| `installations.<能力ID>.binding_overrides` | 2.1 | 宿主 | 可选 | — | 按绑定 ID 保存宿主选择的时点，取代来源绑定的 at 和 phase。 |
| `installations.<能力ID>.binding_overrides.<绑定ID>.at` | 2.1 | 宿主 | 是 | — | 校验通过的版本化时点 ID。 |
| `installations.<能力ID>.binding_overrides.<绑定ID>.phase` | 2.1 | 宿主 | Feature、harness 时点必填，项目时点省略 | — | 当前 workflow 下选定的阶段。 |
| `installations.<能力ID>.pending_cleanup` | 2.0 | 宿主 | 可选 | — | 已停止目标的新调度，等待当前请求交回或清理重试。由框架管理。 |
| `installations.<能力ID>.pending_cleanup.operation` | 2.0 | 宿主 | 是 | — | 待完成的管理操作。 |
| `installations.<能力ID>.pending_cleanup.binding` | 2.0 | 宿主 | 可选 | — | 单条待退出绑定，缺省为整项。 |
| `installations.<能力ID>.pending_cleanup.command` | 2.0 | 宿主 | 是 | — | 待重试的原操作参数，从操作名开始。 |
| `installations.<能力ID>.pending_cleanup.restore_enabled` | 2.0 | 宿主 | 可选 | — | 升级保留的原整项开关。 |
| `installations.<能力ID>.pending_cleanup.replacement` | 2.0 | 宿主 | 可选 | — | 升级替换中的暂存定位和前后指纹，用于恢复尚未提交的文件替换。 |
| `installations.<能力ID>.activation_result` | 2.1 | 宿主 | 可选 | — | 本次实例、输入指纹、步骤结果、生成指纹及失败或补偿残留，由框架管理。 |
<!-- END GENERATED manifest-fields -->

## 2. 能注入哪些时机？

版本化时点、资源和实际消费者来自随包的 [lifecycle hooks schema](../../specs/lifecycle-hooks-schema.yaml)。先对目标宿主运行 `extension inspect` 或 `extension inspect --json`，即使没有扩展也可以查完整时点。Feature 和 harness 的阶段以宿主当前 workflow 为准，Feature 时点要求实际的 Feature 阶段。

<!-- BEGIN GENERATED supported-timings -->
| 时点 ID | 实际触发时刻 | 范围与阶段 | 消费者 | 资源 |
| --- | --- | --- | --- | --- |
| `feature.before_phase_work@1` | Feature 作者动笔前准备输入，已声明 MCP 的产物随后由原 harness 检查。 | Feature，填有效 `phase` | Feature 作者 / harness checker | `knowledge_file`、`skill`、`mcp` |
| `feature.before_phase_verify@1` | 普通 Feature checker 运行前，由原 harness 检查 MCP 的声明产物。 | Feature，填有效 `phase` | Feature harness checker | `mcp` |
| `feature.after_phase_verify_before_close@1` | Feature 检查后、收口前，由原 receipt gate 检查 MCP 的声明产物。 | Feature，填有效 `phase` | check-receipt | `mcp` |
| `component-design.before_discovery@1` | 绑定蓝图、需求来源和写入范围后，P1 事实发现与首次设计写作前。 | 项目，省略 `phase` | component-design 作者（直接或受管入口） | `knowledge_file`、`skill` |
| `harness.pre_phase@1` | 普通检查分支开始时，阶段状态写为 running 之后。 | harness，填有效 `phase` | `hook_markdown`：本轮实际组装的 verifier 提示；`hook_script`：harness checker（脚本结果）；本轮实际组装的 verifier 提示（片段） | `hook_markdown`、`hook_script` |
| `harness.pre_check@1` | 普通检查开始时，在 checker 及其扩展产物检查之前。 | harness，填有效 `phase` | `hook_markdown`：本轮实际组装的 verifier 提示；`hook_script`：harness checker（脚本结果）；本轮实际组装的 verifier 提示（片段） | `hook_markdown`、`hook_script` |
| `harness.post_check@1` | 阶段 checker 结束后，违规分类之前。 | harness，填有效 `phase` | `hook_markdown`：本轮实际组装的 verifier 提示；`hook_script`：harness checker（脚本结果）；本轮实际组装的 verifier 提示（片段） | `hook_markdown`、`hook_script` |
| `harness.on_violation@1` | 按普通检查分支已分类的 BLOCKER 或 MAJOR 违规逐项触发。 | harness，填有效 `phase` | `hook_markdown`：本轮实际组装的 verifier 提示；`hook_script`：harness checker（脚本结果）；本轮实际组装的 verifier 提示（片段） | `hook_markdown`、`hook_script` |
| `harness.pre_verifier@1` | 检查末尾第一个收尾事件，在判断是否签发验证请求之前。 | harness，填有效 `phase` | `hook_markdown`：本轮实际组装的 verifier 提示；`hook_script`：harness checker（脚本结果）；本轮实际组装的 verifier 提示（片段） | `hook_markdown`、`hook_script` |
| `harness.on_context_load@1` | 检查末尾，位于 pre_verifier 和 post_verifier 之间，在判断是否签发验证请求之前。 | harness，填有效 `phase` | `hook_markdown`：本轮实际组装的 verifier 提示；`hook_script`：harness checker（脚本结果）；本轮实际组装的 verifier 提示（片段） | `hook_markdown`、`hook_script` |
| `harness.post_verifier@1` | 检查末尾，位于 on_context_load 和 post_phase 之间，尚未判断是否签发验证请求。 | harness，填有效 `phase` | `hook_markdown`：本轮实际组装的 verifier 提示；`hook_script`：harness checker（脚本结果）；本轮实际组装的 verifier 提示（片段） | `hook_markdown`、`hook_script` |
| `harness.post_phase@1` | 检查末尾最后一个收尾事件，在报告落盘和判断是否签发验证请求之前。 | harness，填有效 `phase` | `hook_markdown`：本轮实际组装的 verifier 提示；`hook_script`：harness checker（脚本结果）；本轮实际组装的 verifier 提示（片段） | `hook_markdown`、`hook_script` |
<!-- END GENERATED supported-timings -->

表中的资源种类对应清单的 `kind` 和 `ref`。`knowledge_file` 与 `hook_markdown` 用 `kind: knowledge`，`ref` 填扩展根相对路径。`skill`、`mcp` 和 `hook_script` 用 `kind: action`，`ref` 分别填 Skill ID、MCP 动作 ID 或扩展根相对的 `.mjs` 路径。

普通检查末尾依次发出 `pre_verifier → on_context_load → post_verifier → post_phase`，随后才判断是否签发 verifier 请求。

宿主可以为已装绑定保存时点选择。例如，来源按 `feature.before_phase_work@1 / coding` 投递，宿主可执行 `extension enable wallet-rules guide --phase review` 改为评审阶段。也可同时指定 `--at feature.before_phase_work@1 --phase review`。项目级时点省略 `--phase`。已有启用结果完好时，改选阶段只改变后续投递。升级后已存选择失效时，检视会点名受影响绑定，宿主可重新选择。

## 3. 谁消费知识和动作，怎么交回？

设计前知识会以内联正文或项目相对回读路径送给当前蓝图作者。收到路径的作者应打开原件。设计前动作发送 Skill 路径及本次授权的写入目录。作者按 Skill 说明和请求约束执行，交付仍在原蓝图请求中。Feature 动笔时点由当前 Feature 作者使用，MCP 声明产物沿各时点的 checker 或收口检查验证。宿主 agent 自行检查工具是否可见并负责认证、执行和脱敏。Hook 的 `.mjs` 接收 stdin JSON context，stdout 返回 JSON，例如 `{"ok":true,"promptFragments":["核对记录"]}`。Hook Markdown 与脚本片段由实际组装的 verifier 提示消费。

在原作者交回中，每条实际参与的绑定各写一行，行首用 `extension-result:`，后接 JSON 对象。正文中的代码块展示两行原始内容，实际回执不加代码围栏或项目符号。

```text
extension-result: {"ability":"design-notes","binding":"guide","status":"read","artifacts":["doc/extensions/knowledge/design-notes/guide.md"],"reason":"已读取指南。"}
extension-result: {"ability":"design-notes","binding":"note","status":"generated","artifacts":["doc/features/demo/blueprint/notes.md"],"reason":"已写入并回读本次核对记录。"}
```

`ability` 与 `binding` 使用本次发放的 ID。`status` 使用 `read`、`reused`、`generated`、`skipped` 或 `failed`。`artifacts` 填确已使用或生成的宿主根相对路径，无产物填写 `[]`。`reason` 说明实际动作、业务结果或具体缺口。准备输出列出本次已发放的输入，原签发请求及实际交回提供消费证据。由 checker 消费的贡献使用原 checker 报告。

## 4. 生命周期里谁执行，怎样退出？

| 宿主管理命令 | 实际效果 |
| --- | --- |
| `install <本地目录> [能力ID]` | 校验并导入成品包，首装按来源默认选择执行整项启用。裸 Skill 首装公布手动入口。加 `--no-enable` 先安装并暂缓启用。 |
| `enable <能力ID> [绑定ID]` | 整项启用按顺序完成步骤并确认效果，再公布入口和选定绑定。指定绑定时保存单条选择，整项已关闭时仍需另行启用整项。已有完好效果会复用。 |
| `disable <能力ID> [绑定ID]` | 关闭目标的新调度。整项同时撤下手动入口并逆序退出自有效果，单条保留其他选择与共用依赖。 |
| `install <同一来源>` | 同版同内容保留选择并复用。替换版本前先预检，再退出旧能力、替换安装资源并启用新版。原来已停用的能力继续停用，新增自动绑定等待选择。 |
| `uninstall <能力ID>` | 先关闭新调度并退出自有效果，再按指纹和归属清理独占安装副本与生成入口。宿主改写、来源原件、共享资源和已交付业务产物保留。 |

受管作者仍占用原签发资源时，相关停用、卸载或升级会返回请求 ID 和待清理状态，原资源仍可用。交回后重试回执里的同一命令；清理成功后才完成退出。已结束或锁失效的请求仅提示，直接会话沿现有非受管边界。待清理期间可用 `inspect` 查看当前占用。安装新版记录提交前的替换失败会尝试恢复旧版；提交后启用失败时保留新版安装，撤回此次启用效果。

### 声明动态步骤

动态步骤用清单 `2.1` 的 `activation.<能力ID>.steps`。例如，若要让上面示例从 `skills/design-notes/material.md` 生成指南，把原有 `guide.md` 内容移入该原料，并加入以下声明。

```yaml
activation:
  design-notes:
    steps:
      - id: build-guide
        cwd: skills/design-notes
        run: [node, build-guide.mjs]
        outputs: [knowledge/design-notes/guide.md]
```

把脚本存成 `skills/design-notes/build-guide.mjs`。

```javascript
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const guide = join(process.env.MAISON_EXTENSION_ROOT, 'knowledge/design-notes/guide.md');
mkdirSync(dirname(guide), { recursive: true });
copyFileSync('material.md', guide);
```

命令使用明确的程序和参数数组。工作目录在 `skills/<能力ID>` 树中，输出声明为该能力独占的 `skills/<能力ID>/` 或 `knowledge/<能力ID>/` 中的文件或目录。安装时可引用尚待生成的声明输出。步骤成功且实际引用可解析后才投递。脚本可用 `MAISON_EXTENSION_ROOT` 定位扩展工作根，用 `MAISON_EXTENSION_PROJECT_ROOT` 定位宿主工程，用 `MAISON_EXTENSION_INSTANCE_ID` 标记本次启用实例。生成物不随包带入。

使用 npm 时，随包提供包清单、锁文件和需要的安装源，在能力自身目录执行 `npm ci --cache ./.npm-cache`，在 `outputs` 列出专属依赖目录和缓存目录。需要登记等非文件效果时，预备可重复执行的 `undo` 命令，按实例 ID 只撤销对应记录。只读校验可声明空 `outputs`。保留退出所需的源脚本，并将生成物单独列在 `outputs` 中。

正式包的命令将于运行前展示，包括能力、版本、实际工作目录、按序命令和声明产物。JSON 模式预告在 stderr，stdout 留给最终回执。维护者通过管理入口授权成品包启用。由描述提议出的命令须先展示具体 `run`、`undo`、参数、工作目录和产物并取得用户明确确认，之后才写入清单并启用。未确认时保留手动入口。受管后台作者可检视和校验，由宿主管理入口执行任何持久开关和命令。

框架在每步前后比较受管项目路径，校验写入落在能力私有目录及声明输出内。项目快照沿用排除项，包括 `node_modules` 和部分构建目录。声明依赖树仍由管理操作核验。项目外写入超出快照覆盖范围。步骤失败时先补偿失败步骤，再逆序撤回前序效果。把独占生成物声明为 `outputs`，框架可按生成指纹撤回。对越界新增的普通文件，命令可在独占创建后输出一行 `extension-created: {"path":"项目相对路径","postSha256":"文件SHA-256","instance_id":"本次实例ID"}`。只有快照核实步前不存在且文件内容仍匹配时，框架才清理该新增文件。对已存在文件的越界改写或删除，回执给出路径、变更和步前指纹，维护者可据此从版本库或副本恢复。宿主改写、归属不明或待补偿的残留会保留并报告。

## 5. 怎么自己验证？

准备一个已初始化、集成目标发布件的宿主。在宿主新建一份需求原件 `design-notes-requirement.md`，例如写明“订单查询页须显示最近三条订单，排序以提交时间倒序；离线能否展示历史订单待确认”。下列命令从宿主的 `framework/harness` 执行，把 `<宿主根>` 换成宿主绝对路径。可用上面的独立来源目录替换命令中的随包样例。

```bash
npx ts-node scripts/extension.ts inspect --project-root "<宿主根>" --json
npx ts-node scripts/extension.ts install "../docs/operations/samples/design-notes" --no-enable --project-root "<宿主根>" --json
npx ts-node scripts/extension.ts enable design-notes --project-root "<宿主根>" --json
npm run check:component-blueprint -- --project-root "<宿主根>" --blueprint demo --requirement-source design-notes-requirement.md --prepare-design --json
```

首次检视应列出宿主支持的时点。只安装回执显示已安装未启用。启用后，准备输出的 `extension_preparation.bindings` 应含 `guide` 和 `note`，知识正文在 `knowledge` 中，超出内联预算时提供回读路径。

在宿主 Agent 中发起 `/component-design demo`，说明「请以 `design-notes-requirement.md` 为需求原件创建蓝图，授权在 `demo` 的蓝图目录写入首稿和本次核对记录」。若客户端仅提供自然语言入口，请它按 `component-design` Skill 执行相同请求。直接作者按正常入口取得准备结果，受管作者读取正式签发的同一输入。验收时核对笔记中的约束来源、离线问题，以及作者原交回中上文两条 `extension-result`。持有已签发受管请求 ID 时，用 `extension inspect design-notes --request "<请求ID>" --json` 查询交付和已取得的交回证据。

```bash
npx ts-node scripts/extension.ts disable design-notes --project-root "<宿主根>" --json
npm run check:component-blueprint -- --project-root "<宿主根>" --blueprint demo --requirement-source design-notes-requirement.md --prepare-design --json
```

再次准备应撤下两条绑定，旧笔记仍在。动态版本还可在启用后移走一份本次生成物，并用 `inspect` 确认漂移、受影响绑定和修复入口。只读 `verify` 也会报告漂移。运行 `enable` 恢复缺项后，再核对下一次准备交付。检视分别呈现支持时点、宿主当前选择和请求证据。`available`、`scheduled` 和 `evidenced` 分别表示资源可用、配置已调度和已有实际证据。

## 版本史

扩展清单、workflow DAG 和 lifecycle hooks 的 `schema_version` 独立演进。框架 3.1.0 发布件继续读取以下扩展清单版本。

- **1.0** 按目录发现 Skill，知识字符串仅保留文件索引。
- **1.1** 按 `provides.skills` 物化入口，知识按 audience 投递，并支持 `provides.mcp_actions` 和三个 Feature 槽位。字符串知识进入各 Feature 阶段索引。
- **2.0** 加入带时点的独立绑定及宿主安装选择，保留原有知识、hooks、MCP 和规则的兼容消费者。新宿主骨架沿用 2.0。
- **2.1** 增加可撤回启用、宿主绑定覆盖和启用结果。旧静态扩展无需补步骤。目标发布件须支持相应格式才导入或写入新版能力。宿主选择、原有手写资料和已签发请求继续有效。

[管理 Skill](../../skills/project/extension/SKILL.md) · [迁移说明](../../MIGRATION.md) · [扩展概念](../concepts/extensibility.md)
