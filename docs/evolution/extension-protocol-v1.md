# Extension 接入协议

实例扩展由本地来源包、宿主管理选择和实际消费者共同决定。发布件中的管理入口负责安装、启停、校验及项目入口物化。宿主在 `framework/harness` 安装运行依赖后，从该目录运行本文的命令。例子使用默认扩展根 `doc/extensions`，宿主可用 `paths.extension_dir` 指定其他项目相对目录。

## 1. 包怎么组织，每个字段写了会发生什么？

一个来源目录提供一个插件。插件 ID 与绑定 ID 应随升级保持稳定。安装后，扩展根的 `manifest.yaml` 记录宿主选择；每个 `<插件ID>/manifest.yaml` 保存同名插件的提供方声明。一个包可同时提供多个 Skill。下面是随包可直接安装的 [design-notes](../operations/samples/design-notes/) 示例，含一条知识和一个作者动作。

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
schema_version: "2.0"
kind: plugin
name: design-notes
version: "1.0.0"
description: 设计前核对需求与待确认问题。
provides:
  skills: [design-notes]
bindings:
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

`ref` 文件、脚本、`cwd` 和 `outputs` 都以插件根为基准。`MAISON_EXTENSION_ROOT` 指向当前插件目录。宿主的导入指纹以插件相对路径记录，MCP 产物和显式项目级输出以宿主工程根为基准。路径使用 `/` 并须落在声明的边界内。普通 Skill 连同随附资源也可直接安装，裸来源根须有有效 `SKILL.md`，安装时生成包清单并公布手动入口。

### 宿主清单

由管理入口生成和维护。空根的内容为 `schema_version: "2.0"`、`kind: host`、`plugins: {}`。表中记录安装来源、团队开关、绑定选择和导入文件归属。

<!-- BEGIN GENERATED host-fields -->
| 字段路径 | 必填 | 默认 | 运行效果 |
| --- | --- | --- | --- |
| `schema_version` | 是 | — | 宿主清单协议版本。 |
| `kind` | 是 | — | 标记顶层安装登记。 |
| `plugins` | 是 | — | 每个键对应同名插件目录。仅登记的包参与运行。 |
| `plugins.<插件ID>.source` | 是 | — | 用于核对重装与升级的本地来源身份。 |
| `plugins.<插件ID>.enabled` | 是 | — | 宿主的整包开关。 |
| `plugins.<插件ID>.bindings` | 是 | — | 宿主对各绑定的开关。重装保留已有选择。 |
| `plugins.<插件ID>.files` | 是 | — | 受管导入文件的插件相对路径与 SHA-256。退出时用于核对所有权。 |
| `plugins.<插件ID>.in_place` | 可选 | — | 就地登记自有包。卸载时保留来源文件。 |
| `plugins.<插件ID>.binding_overrides` | 可选 | — | 宿主保存的按绑定时点覆盖，取代提供方的 at 和 phase。 |
| `plugins.<插件ID>.binding_overrides.<绑定ID>.at` | 是 | — | 校验通过的版本化时点 ID。 |
| `plugins.<插件ID>.binding_overrides.<绑定ID>.phase` | Feature 和 harness 时点必填，项目时点省略 | — | 当前 workflow 中选定的阶段。 |
<!-- END GENERATED host-fields -->

### 插件清单

提供方在包内维护 `kind: plugin` 清单。宿主自有包也用同一结构。字段表由 [扩展清单 schema](../../specs/instance-extension-manifest.schema.yaml) 生成。

<!-- BEGIN GENERATED plugin-fields -->
| 字段路径 | 必填 | 默认 | 运行效果 |
| --- | --- | --- | --- |
| `schema_version` | 是 | — | 提供方清单协议版本。 |
| `kind` | 是 | — | 标记插件目录内的提供方声明。 |
| `name` | 是 | — | 稳定的插件 ID。安装后与目录名及宿主登记键一致。 |
| `version` | 是 | — | 由提供方维护的包版本，用于核对升级与本地产物就绪。 |
| `description` | 可选 | — | 面向读者的能力简介。 |
| `framework_compat` | 可选 | — | 向读者描述适用的框架版本范围。 |
| `provides` | 可选 | — | 手动 Skill 及既有消费者可用的资源。 |
| `provides.skills` | 可选 | — | 手动 Skill ID 列表。每项指向本包的 skills/<Skill ID>/SKILL.md。 |
| `provides.mcp_actions` | 可选 | — | 声明宿主角色调用的 MCP 工具及产物。连接与凭据由宿主管理。 |
| `provides.mcp_actions.<动作ID>.tool` | 是 | — | 宿主 agent 可见的工具 ID。 |
| `provides.mcp_actions.<动作ID>.required` | 是 | — | 影响既有消费者是否要求产物。 |
| `provides.mcp_actions.<动作ID>.severity` | 可选 | `"MAJOR"` | 所需产物缺失时由既有消费者使用的严重级别。 |
| `provides.mcp_actions.<动作ID>.produces` | 是 | — | 要核对的宿主工程根相对产物路径。 |
| `provides.mcp_actions.<动作ID>.usage` | 是 | — | 面向作者的工具使用说明。 |
| `provides.capabilities` | 可选 | — | 将键映射到原 harness capability registry 的本地 provider 和严重级别。 |
| `provides.capabilities.<能力键>.provider` | 是 | — | 插件根相对的 capability provider 路径。 |
| `provides.capabilities.<能力键>.severity` | 是 | — | 原 capability 检查使用的严重级别。 |
| `provides.phase_rules_overlays` | 可选 | — | 为指定阶段追加本包规则 YAML。值为插件根相对路径。 |
| `provides.skill_assets` | 可选 | — | 按 Skill 与资源键指定插件根相对路径，覆盖 profile 同键资源。 |
| `bindings` | 可选 | — | 稳定的绑定 ID 与其自动投递声明。 |
| `bindings.<绑定ID>.at` | 是 | — | 使用时点表中已发布且带版本的 ID。 |
| `bindings.<绑定ID>.phase` | Feature 和 harness 时点必填，项目时点省略 | — | 使用当前 workflow 中的有效阶段。 |
| `bindings.<绑定ID>.kind` | 是 | — | 按时点选择知识或动作。 |
| `bindings.<绑定ID>.ref` | 是 | — | 知识和 lifecycle hook 填插件根相对路径。作者 Skill 或 checker MCP 贡献填对应 ID。 |
| `bindings.<绑定ID>.summary` | 可选 | — | 显示在知识索引中的摘要。 |
| `bindings.<绑定ID>.enabled_by_default` | 可选 | `false` | 插件首装并启用时采用的绑定开关。 |
| `bindings.<绑定ID>.required` | 可选 | `false` | 选中后资源不可用时，在实际消费者处报告依赖缺口。 |
| `activation` | 可选 | — | 由提供方定义准备、显式启用和退出的步骤。 |
| `activation.steps` | 是 | — | 启用按声明顺序运行，退出按逆序撤回。 |
| `activation.steps[].id` | 是 | — | 插件内唯一的稳定步骤 ID。 |
| `activation.steps[].cwd` | 是 | — | 插件相对工作目录。用 “.” 表示插件根。 |
| `activation.steps[].run` | 是 | — | 可执行程序及参数数组。 |
| `activation.steps[].scope` | 是 | — | local 是可重复生成的本机包内文件。repo 由维护者显式执行与退出，适用于共享文件或非文件效果。 |
| `activation.steps[].outputs` | 是 | — | 本步独占的插件相对输出。local 必须声明输出，非文件效果填空数组。 |
| `activation.steps[].ready` | 是 | — | 声明如何判断本工作区产物或效果已就绪。两种写法选一。 |
| `activation.steps[].ready.version_file` | 与 check 二选一 | — | 插件相对 JSON 产物路径。指定版本字段的值须等于插件 version。 |
| `activation.steps[].ready.version_field` | 可选 | `"plugin_version"` | 使用 version_file 时可选的顶层 JSON 键。 |
| `activation.steps[].ready.check` | 与 version_file 二选一 | — | 只读检查程序及参数。退出码 0 表示当前版本所需效果已就绪。 |
| `activation.steps[].project_outputs` | 仅 repo 可选 | — | 显式 repo 步骤管理的宿主工程相对输出，须位于扩展根以外。 |
| `activation.steps[].undo` | repo 步骤必填 | — | 显式退出时运行的可重复命令，只撤销当前实例效果。 |
<!-- END GENERATED plugin-fields -->

## 2. 能注入哪些时机？

版本化时点、资源和实际消费者来自随包的 [lifecycle hooks schema](../../specs/lifecycle-hooks-schema.yaml)。先对目标宿主运行 `extension inspect` 或 `extension inspect --json`，即使没有扩展也可以查完整时点。Feature 和 harness 的阶段以宿主当前 workflow 为准，Feature 时点要求实际的 Feature 阶段。

<!-- BEGIN GENERATED supported-timings -->
| 时点 ID | 实际触发时刻 | 范围与阶段 | 消费者 | 资源 |
| --- | --- | --- | --- | --- |
| `project.entry@1` | 物化项目入口时生成供项目维护者和作者阅读的随仓知识索引。 | 项目，省略 `phase` | AGENTS.md / CLAUDE.md | `knowledge_file` |
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

表中的资源种类对应清单的 `kind` 和 `ref`。`knowledge_file` 与 `hook_markdown` 用 `kind: knowledge`，`ref` 填插件根相对路径。`skill`、`mcp` 和 `hook_script` 用 `kind: action`，`ref` 分别填 Skill ID、MCP 动作 ID 或插件根相对的 `.mjs` 路径。

`project.entry@1` 在入口物化时为已启用的静态知识生成可随仓阅读的项目相对链接。需要逐 clone 生成的本地产物可绑定到实际发出准备请求的消费者。

普通检查末尾依次发出 `pre_verifier → on_context_load → post_verifier → post_phase`，随后才判断是否签发 verifier 请求。

宿主可以为已装绑定保存时点选择。例如，来源按 `feature.before_phase_work@1 / coding` 投递，宿主可执行 `extension enable wallet-rules guide --phase review` 改为评审阶段。也可同时指定 `--at feature.before_phase_work@1 --phase review`。项目级时点省略 `--phase`。已有启用结果完好时，改选阶段只改变后续投递。升级后已存选择失效时，检视会点名受影响绑定，宿主可重新选择。

## 3. 谁消费知识和动作，怎么交回？

设计前知识会以内联正文或项目相对回读路径送给当前蓝图作者。收到路径的作者应打开原件。设计前动作发送 Skill 路径及本次授权的写入目录。作者按 Skill 说明和请求约束执行，交付仍在原蓝图请求中。Feature 动笔时点由当前 Feature 作者使用，MCP 声明产物沿各时点的 checker 或收口检查验证。宿主 agent 自行检查工具是否可见并负责认证、执行和脱敏。Hook 的 `.mjs` 接收 stdin JSON context，stdout 返回 JSON，例如 `{"ok":true,"promptFragments":["核对记录"]}`。Hook Markdown 与脚本片段由实际组装的 verifier 提示消费。

在原作者交回中，每条实际参与的绑定各写一行，行首用 `extension-result:`，后接 JSON 对象。正文中的代码块展示两行原始内容，实际回执不加代码围栏或项目符号。

```text
extension-result: {"ability":"design-notes","binding":"guide","status":"read","artifacts":["doc/extensions/design-notes/knowledge/design-notes/guide.md"],"reason":"已读取指南。"}
extension-result: {"ability":"design-notes","binding":"note","status":"generated","artifacts":["doc/features/demo/blueprint/notes.md"],"reason":"已写入并回读本次核对记录。"}
```

`ability` 与 `binding` 使用本次发放的 ID。`status` 使用 `read`、`reused`、`generated`、`skipped` 或 `failed`。`artifacts` 填确已使用或生成的宿主根相对路径，无产物填写 `[]`。`reason` 说明实际动作、业务结果或具体缺口。准备输出列出本次已发放的输入，原签发请求及实际交回提供消费证据。由 checker 消费的贡献使用原 checker 报告。

## 4. 生命周期里谁执行，怎样退出？

| 宿主管理命令 | 实际效果 |
| --- | --- |
| `install <本地目录> [插件ID]` | 校验来源包并导入同名插件目录。首装按提供方默认选择启用，裸 Skill 首装公布手动入口。加 `--no-enable` 暂缓启用。 |
| `enable <插件ID> [绑定ID]` | 整包启用按步骤确认效果，再公布入口和选定绑定。指定绑定时保存单条选择，整包关闭时需另行启用整包。 |
| `disable <插件ID> [绑定ID]` | 停止目标的新投递。整包撤下手动入口并按逆序退出，单条保留其他选择及共用依赖。 |
| `install <同一来源>` | 同版本、同内容复用并保留选择。同版本来源内容变化时先由提供方升版。升版先预检和退出旧效果，再替换并按原整包开关启用，新绑定等待宿主选择。 |
| `uninstall <插件ID>` | 停止新投递并退出，按归属和指纹清理受管副本及入口。宿主改写、自有来源及已交付业务产物保留。 |
| `inspect [插件ID]` | 查看团队选择、磁盘就绪、在途占用和请求证据。此操作可清理已删除包的本地残留。 |

受管作者仍占用原签发资源时，停用、卸载或升级返回请求 ID 和待清理状态，原资源保留到交回。交回后重试回执中的原命令。安装新版记录提交前的替换失败会尝试恢复旧版，提交后启用失败时保留新版并报告原因。

### 逐 clone 的本地准备

把可重建的专属文件声明为 `scope: local`。以下示例将指南原文移入 `skills/design-notes/material.md`，生成格式为 JSON 的指南，把示例 `guide` 绑定的 `ref` 同步改为 `knowledge/index.json`。

```yaml
activation:
  steps:
    - id: build-guide
      cwd: skills/design-notes
      scope: local
      run: [node, build-guide.mjs]
      outputs: [knowledge/index.json]
      ready:
        version_file: knowledge/index.json
```

把脚本存成 `skills/design-notes/build-guide.mjs`。

```javascript
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.env.MAISON_EXTENSION_ROOT;
mkdirSync(join(root, 'knowledge'), { recursive: true });
writeFileSync(join(root, 'knowledge/index.json'), JSON.stringify({
  plugin_version: process.env.MAISON_EXTENSION_VERSION,
  guide: readFileSync('material.md', 'utf8'),
}, null, 2));
```

正式请求在交给消费者前核对本次选中的插件。所有必需产物存在且就绪时复用；缺失、同名旧版或缺少版本依据时，清理该步独占的本地产物、执行声明并复查。同一工作区的准备共用并发保护。步骤失败时，本次相关插件停止投递，其他插件继续，后续请求可再试。团队开关维持原选择。

`ready.version_file` 读取插件相对 JSON 文件。顶层版本字段应在完整生成成功后写入，值须匹配插件清单中的 `version`。默认字段为 `plugin_version`。已有索引使用其他键时，例如 `generatedByVersion`，可声明 `ready: { version_file: knowledge/index.json, version_field: generatedByVersion }`。

也可用 `ready.check` 声明只读的程序和参数数组，退出码 0 表示当前所需产物就绪。比如 npm 的本机依赖按锁文件和安装结果检查，`npm ci --cache ./.npm-cache` 步骤在 `outputs` 中列出工作目录的 `node_modules` 和 `.npm-cache`。纯静态资源引用已随包提供的原件。

### 显式效果与 Git 归属

维护者通过安装和启用入口授权成品包。命令运行前会展示步骤，JSON 模式将预告写到 stderr。涉及共享文件、非文件或项目级效果时，用 `scope: repo`，提供就绪检查以及只撤销当前实例效果的可重复 `undo`。包内输出用 `outputs`，扩展根外的项目相对输出用 `project_outputs`。这些效果由维护者显式执行和退出。脚本可用 `MAISON_EXTENSION_PROJECT_ROOT` 和 `MAISON_EXTENSION_INSTANCE_ID` 定位其宿主及实例。由裸 Skill 描述提议的命令需先展示参数、工作目录、产物及退出方式，得到对具体提议的确认后写入清单并启用。

提交宿主登记、插件清单、源文件、锁文件、共享产物和扩展根 `.gitignore`。管理入口维护忽略文件的框架段，宿主可保留自己的规则。已跟踪文件、来源和宿主手工资料受保护。其他 clone 拉到整包停用后，下次正式准备会撤下无在途占用的受管本地产物。插件被删除后，本地产物仍受忽略。已删除包只剩可识别的受管忽略文件时，下次管理操作（含查看）或正式准备请求会清理目录并报告结果。含跟踪文件、手工资料、宿主改写或有效在途引用的目录保留。

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

再次准备应撤下两条绑定，旧笔记仍在。动态版本可以移走一份本地产物，再发一次正式准备请求核对是否恢复。只读校验报告当前状态，查看还可报告残留目录清理。检视中的 `available`、`scheduled` 和 `evidenced` 分别表示资源可用、配置已调度和已有实际证据。

## 版本与存量接入

框架 3.1.0 使用按包的 `schema_version: "2.0"`，宿主和插件分别用 `kind: host` 与 `kind: plugin`。扩展清单、workflow DAG 和 lifecycle hooks 的版本各自演进。3.0.0 的平铺 1.0 以及早期内测清单遇到新发布件时提示按需手工接入。维护者自行选择存量资源的插件边界，按 [迁移说明](../../MIGRATION.md) 留存旧入口资料并建立新根。

[管理 Skill](../../skills/project/extension/SKILL.md) · [扩展概念](../concepts/extensibility.md)
