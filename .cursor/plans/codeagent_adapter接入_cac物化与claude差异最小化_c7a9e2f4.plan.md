---
name: codeagent adapter 接入——.cac 物化与 claude 差异最小化
version: 3.0.0
# 版本说明：跟随当前版本窗口 3.0.0（用户控版本，不 bump）。
overview: 新增 codeagent（Claude Code CLI 内核衍生，物化目录 .cac，headless CLI=codeagentcli）adapter。T0 六项宿主探针已全部回灌（2026-07-29），三处待定分支全部收敛到最优形态：settings.json 用 ${CODEAGENT3_PROJECT_DIR}（实证可展开）、AskUserQuestion 同名同签名（rules 共享成立）、Read 事件同构（视觉链入册）。收敛原则：只共享经实证且不含 adapter 身份/工具能力/目标目录差异的模板——共享=verifier/goal-condition/hooks/rules/AGENTS.md，分叉=settings.json+12 份 commands（身份行仿 cursor 先例）。hooks 项目根解析升级 import.meta.url 自锚+CODEAGENT3 env（cd 漂移已实证）；goal 接线 13 点闭合清单（含 keyed registry/substring dispatch 盲区与哨兵两处实采漏判修复）。
todos:
  - id: t0-host-probe
    content: "T0: 宿主探针六项（等价变量/占位符展开/cwd 漂移/$schema/AskUserQuestion/身份 env/Read 事件样本）——2026-07-29 全部回灌，结果见 T0 节"
    status: completed
  - id: t1-adapter
    content: "T1: agents/codeagent/adapter.yaml（入口 AGENTS.md；verifier/goal-condition/hooks/rules 四段 ../claude 引用；goal_capability 镜像 claude）+ templates/settings.json（${CODEAGENT3_PROJECT_DIR}、无 $schema、.cac 路径）+ templates/commands/×12 自有副本（身份行=codeagent，仿 cursor）+ 共享 interaction-renderer 文案中性化（Claude-kernel 口径，反例路径兼列 .cac）"
    status: completed
  - id: t2-hooks-hardening
    content: "T2: 三个共享 hook resolveProjectRoot 升级——env 链补 CODEAGENT3_PROJECT_DIR + import.meta.url 自锚排 payload.cwd 前 + 依赖文件级标记验真（guard-core/check-receipt 任一存在）；record-verifier-report 来源行 import.meta.url 自述；claude 正常路径行为不变"
    status: completed
  - id: t3-goal-wiring
    content: "T3: goal/headless 接线 13 点——家族谓词落 utils/types.ts；agent-invoke（candidates=codeagentcli/claudeArgv 参数化/dispatch/label/HeadlessInvokePlan.adapterName 治 substring 误猜）+ claude-envelope + sentinel（#7b 两处实采漏判修复）+ check-receipt + multimodal-probe + init-next-steps + skill-bridge 两处 manifest 化 + IMAGE_READ_PARSERS 凭实采 fixture 入册"
    status: completed
  - id: t4-registry-docs
    content: "T4: confirmation-registry options 补 codeagent + agents/README 参考表 + canonical-gitignore 增 **/.cac/settings.local.json + claude notes 修 11→12 并标注家族 SSOT + 身份键 CODEAGENT=1 回填宿主识别记录 + 文档扫尾"
    status: completed
  - id: t5-tests
    content: "T5: codeagent-adapter.unit.test.ts（commands 归一化等值 delta 白名单/settings 结构等值/无 $schema/跨目录引用存在/goal_capability 等值）+ hooks 新链用例 + agent-invoke codeagent 用例 + T3 路径接线点三用例（next-steps/legacy-cleanup/skill-bridge 多 adapter 防交叉）+ sentinel/图片事件脱敏 fixture 用例 + gitignore 用例 + run-unit.ts CORE_SUITES 注册 + npm test 全绿（unit 2700/fixtures 44）"
    status: completed
  - id: t6-host-acceptance
    content: "T6(宿主回归验收): 2026-07-30 用户决定移交用户侧——在 codeagent 宿主自行执行（PreToolUse exit2 真拒写/Stop 真拦收尾/SubagentStop 真落报告/goal 全链路/codeagentcli --version），发现问题另开 plan；本 todo 据此关闭（plan 所有者决定，非绕门禁）；hard_hook 对外声明仍以宿主实测通过为前提"
    status: cancelled
isProject: false
---

## 背景

接入新 agent 类型 **codeagent**：内核基于 Claude Code CLI 开发，物化目录 `.cac`（结构与 `.claude` 完全一致），headless CLI 为 **`codeagentcli`**，参数与 `claude -p` 等价。最初报告的两个"不兼容点"经 T0 实证后修正定性：`$schema` 实为**静默忽略**（删除属品牌/语义决策，非运行时兼容性要求）；`${CLAUDE_PROJECT_DIR}` 有等价变量 `CODEAGENT3_PROJECT_DIR`（可展开）。

**用户已拍板**（2026-07-29）：① 注册名 `codeagent`，物化目录 `.cac`；② 入口文件取 AGENTS.md（CLAUDE.md/AGENTS.md 都能读）；④ goal/headless 本期做。

**实证基础已闭合**（2026-07-29）：信封三轮实测（参数校验文案/api_retry/终局 result 同源）+ T0 六项探针全部回灌（见 T0 节）。

## Review 回灌（codex，2026-07-29）——逐条对 ground truth 核实后的裁决

| # | 意见 | 核实结论 | 裁决 |
|---|---|---|---|
| B1 | commands 100% 共享会把运行身份写成 claude | **实锤**：[goal-mode.md:10](agents/claude/templates/commands/goal-mode.md) 写死 `RESOLVED_ADAPTER：claude`（运行契约，goal-runner 对账冲突 STOP）；cursor 先例=12 份自有副本+每份身份行 | 采纳：codeagent 自建 commands ×12，归一化等值测试防漂移（T1） |
| B2 | 等价变量只解决启动，hook 内部仍读 CLAUDE_PROJECT_DIR；相对路径降级下 hard_hook 虚标 | **实锤**：三 hook 兜底链第二级 payload.cwd 随 cd 漂移（T0#2 已实证：cd .cac 后 payload_cwd/proc_cwd 双漂移） | 采纳：import.meta.url 自锚提为 T2 必做；tier 虚标问题因 T0#1b 实证占位符可展开而**自然消解**（无需降级分支） |
| H3 | AskUserQuestion unsupported 分支缺失；探针前默认 supported 乐观 | **实锤**（当时）；T0#4 已实证 supported 同签名+真实渲染 | 采纳过程改进（探针升硬前置）；结果走 supported 分支 |
| H4 | IMAGE_READ_PARSERS keyed registry 漏枚举 | **实锤**：[critic-receipt-producer.ts:65](harness/scripts/utils/critic-receipt-producer.ts) 仅 claude，注释契约"fixture 后方可入册" | 采纳：T0#6 已实采同构 fixture → T3 入册 |
| H5 | T5 混淆必要验收与悬置；"发布门禁拒 pending todo" | 结构批评成立；门禁说法**属实**——首轮驳回是错的：门禁在仓库根 [scripts/check-plan-version.mjs:91](scripts/check-plan-version.mjs)（`release:all` 第一阶段 `--release` 模式下 version===当前版本的 plan 有 open todo 即报错），首轮只 grep 了 harness/ 检索范围错误 | **全量采纳**：hooks 加固入 T2 必做；T6=**发布前 BLOCKER**（见 T6 政策段）；硬学习：驳回 review 意见前检索须覆盖仓库根 scripts/，不只 harness/ |
| M6 | skill-bridge 两处须 manifest 化 | **实锤**：[instance-skill-bridge.ts:262](harness/scripts/utils/instance-skill-bridge.ts) 写死读 agents/claude/adapter.yaml、[legacy-skill-bridge-cleanup.ts:129](harness/scripts/utils/legacy-skill-bridge-cleanup.ts) 写死 .claude/commands | 采纳（T3 #11/#12） |
| M7 | agent-invoke:1131 substring 猜 adapter，codeagentcli 误报 cursor | **实锤**：codeagentcli 不含任何已知子串 → 兜底 'cursor' | 采纳：HeadlessInvokePlan 显式携带 adapterName（T3 #5b） |
| 次 | 11→12 份 slash / T0#2 话术执行不出 / verifier 报告来源写死 / .cac/settings.local.json 未进 gitignore | 四条全实锤 | 全采纳（话术已修并执行完毕 / T2 来源自述 / T4 gitignore+notes） |

另核实：verifier.md 与 goal-condition.md 确无身份标记（grep 空），维持共享。

## 相对路径裁决（官方文档核实，维持不变）

hook cwd=触发时会话 cwd 且随 `cd` 漂移（T0#2 在 codeagent 上实证同语义）；官方明确不建议 hook command 相对路径；`$schema` 运行时零影响。**claude 侧 `${CLAUDE_PROJECT_DIR}` 与 `$schema` 保留不动**；codeagent 侧用 `${CODEAGENT3_PROJECT_DIR}`（T0#1b 实证可展开）——**用户最初的"改相对路径降差异"提议正式否决**，差异收敛改走"等价变量+单点分叉"路线。

## T0：宿主探针结果（✅ 2026-07-29 全部回灌，WalletForHarmonyOS 实机）

| # | 探针 | 结果 | 定稿决策 |
|---|---|---|---|
| 1a | 等价 project-dir 变量 | **`CODEAGENT3_PROJECT_DIR`**=工程根（正斜杠形态 `D:/...`），注入 hook 进程；另有 `CODEAGENT3_EXPERIMENTAL_AGENT_TEAMS`/`CODEAGENT3_WINDOWS_SHELL_TYPE`；无 CLAUDE_PROJECT_DIR | settings.json 变量基座 |
| 1b | `${...}` 占位符展开 | **可展开**：`${CODEAGENT3_PROJECT_DIR}` → argv 收到真实路径 | settings.json 用 `${CODEAGENT3_PROJECT_DIR}/.cac/hooks/...`，与 claude 同构同鲁棒；**tier=hard_hook 名副其实，降级分支/hook_launch_anchor 机制废弃不做** |
| 2 | cwd 漂移 | Bash `cd .cac` 后，Write 触发的 hook `payload_cwd`/`proc_cwd` **双双漂移**到 `.cac`；env 变量恒定 | 实证 T2 必要性：payload.cwd 不可作项目根依据；env+自锚双保险 |
| 3 | $schema 容忍度 | **静默忽略**（exit=0、无 stderr、正常应答） | codeagent 模板仍删 $schema（纯语义干净，非功能必需——它指向 claude 的 schema URL） |
| 4 | AskUserQuestion | **同名同签名**（questions/question/header/options/label/description/preview/multiSelect/answers/annotations/metadata 与 claude 逐字段对齐）且**真实渲染成功**（widget 出现并回收了选择） | `structured_widget: supported`；rules 共享 `../claude/templates/rules`；commands 副本 BLOCKER 行原样保留 |
| 5 | 身份 env 键 | **`CODEAGENT=1`**（Bash 子 shell 注入；对照 claude=CLAUDECODE=1）。claude 对照组同机采集确认互斥 | 回填宿主识别记录（T4） |
| 6 | Read 图片事件 | assistant 消息 `content[].{type:"tool_use",name:"Read",input.file_path}` 与 [claude 解析器](harness/scripts/utils/critic-receipt-producer.ts)锚定形状**逐字段同构**（id 形态 `call_*` 与 fork 附加的 `tool_use_result.vlDescription`/`modelID` 等扩展字段均不在解析路径，无害） | fixture 落库 → `IMAGE_READ_PARSERS` 入册（T3 #10）；视觉证据链**不降级** |

> 实采原始样本（1a/1b/2/6 的 ndjson 行）随 T5 落为 unit fixture，**入库前必须脱敏+路径归一化**：只保留白名单字段（`CODEAGENT3_PROJECT_DIR`/`CODEAGENT`/`payload_cwd`/`proc_cwd`/事件结构字段），绝对路径归一为占位路径，session_id/token/代理配置/模型名一律剔除——完整 env dump **不得**进 plan/fixture/git（codex 安全提醒，采纳）。探针宿主的 `codeagentcli --version` 本轮未采：**T6 必录**（adapter_version 机制只是非阻塞遥测，不判兼容，替代不了版本锚定——`CODEAGENT3_` 前缀带版本号，升级可能改 env/信封协议）。探针法留档：hook 探针脚本自锚写盘（import.meta.url），与 T2 生产方案同源验证。

## 设计原则

1. **共享原则**：只共享经实证、且不含 adapter 身份/工具能力/目标目录差异的模板。
   - **共享**（`../claude/templates/...` 跨目录引用，先例 codex→`../shared`）：`agents/verifier.md`、`goal-condition.md`（无身份标记）、`hooks/` ×3（T2 加固后厂商无关）、`rules/interaction-renderer.md`（T0#4 实证工具同签名；**共享前提=文案中性化**——现文本首部"Claude Code · BLOCKER"/"Claude adapter 会话级"与 :64 的 `.claude/commands/skills/` 反例带 claude 身份，改为"Claude-kernel adapter"口径、反例路径兼列 `.claude|.cac`，否则物化进 .cac/rules/ 会自相矛盾）、`AGENTS.md.template`。
   - **分叉**：`settings.json`（$schema/路径/变量）、`commands/` ×12（身份行，cursor 先例）。
2. **hooks 自锚**：项目根解析 env 优先、自锚兜底（T2），不依赖单一厂商变量。
3. **接线检索四盲区闭合**：字面量 `=== 'claude'` + keyed registry + substring dispatch + 模板身份标记/target 路径——T3 表为闭合清单。
4. **claude 侧"正常路径行为不变"**（口径按 codex 意见收紧，不再宣称字面零 diff）：hooks 链 env 恒在链首、claudeArgv 参数化缺省 'claude'、来源行自述输出不变——**运行语义零变化**；两处已知良性 diff：rules 文案中性化（Claude Code → Claude-kernel adapter）、病态实例（env 指向 framework 缺失/损坏）下 hooks 项目根选择可能不同（属修复）。

## T1：adapter 落地（探针后定稿版）

**`agents/codeagent/adapter.yaml`**：

```yaml
adapter_name: codeagent
agent_entry_file:
  template_path: templates/AGENTS.md.template
  target_path: AGENTS.md
commands:
  target_dir: .cac/commands
  template_dir: templates/commands              # 自有 ×12：身份行=codeagent
  subagents:
    target_dir: .cac/agents
    template_dir: ../claude/templates/agents    # verifier.md 共享
    update_policy: auto_overwrite
rules:
  target_dir: .cac/rules
  template_dir: ../claude/templates/rules       # 共享（前提：先中性化文案，见设计原则 1）
settings_file:
  template_path: templates/settings.json
  target_path: .cac/settings.json
  update_policy: auto_overwrite
hooks:
  target_dir: .cac/hooks
  template_dir: ../claude/templates/hooks       # 共享（T2 加固后厂商无关）
  update_policy: auto_overwrite
instance_skill_bridge:
  commands_target_dir: .cac/commands
user_confirmation:
  structured_widget: supported                  # T0#4 实证：同名同签名+真实渲染
  portable_required: true
  interaction_renderer_rule: ../claude/templates/rules/interaction-renderer.md
image_input: tool_read
goal_capability:
  mode: native_goal
  tool_event_provenance: structured_events      # T0#6+信封三轮实证
  native_goal:
    goal_condition_template: ../claude/templates/goal-condition.md
    supports_resume: false
  external_runner:
    headless_invoke: 'codeagentcli -p "{{PROMPT}}" --allowedTools Bash,Read,Write,Edit,Glob,Grep --permission-mode dontAsk'
    unattended:
      write_mode: accept-edits
      approval_mode: never
post_install_hooks: []
notes: |
  - 内核=Claude Code CLI 衍生；模板 SSOT 在 agents/claude/templates/（家族共享），
    分叉仅 settings.json（变量 ${CODEAGENT3_PROJECT_DIR}，2026-07-29 实证可展开）与
    commands ×12（身份行）。--permission-mode dontAsk 实证可用。
  - 宿主身份 env：CODEAGENT=1（Bash 子 shell）；hook 进程注入 CODEAGENT3_PROJECT_DIR。
```

**`templates/settings.json`**：claude 版三处改——删 `$schema`（T0#3 实证纯忽略，删除仅语义干净）；`.claude/hooks/`→`.cac/hooks/`；`${CLAUDE_PROJECT_DIR}`→`${CODEAGENT3_PROJECT_DIR}`。hook 结构逐项同 claude，T5 等值测试守护。

**`templates/commands/` ×12**（仿 cursor 先例）：内容=claude 对应文件，差异仅——每份头部 `> 运行身份：codeagent（薄入口……勿被同名 .claude/commands/x.md 误导）`；`goal-mode.md` 用 `RESOLVED_ADAPTER：codeagent` + 运行身份权威段（仿 [cursor/goal-mode.md:18](agents/cursor/templates/commands/goal-mode.md)）。AskUserQuestion BLOCKER 行原样保留（T0#4）。防漂移：T5 归一化等值测试（delta 白名单见 T5）。

**共享 rules 中性化**（[interaction-renderer.md](agents/claude/templates/rules/interaction-renderer.md)，本任务内完成）：标题与会话级声明 "Claude Code / Claude adapter" → "Claude-kernel adapter（claude / codeagent）"；:64 反例路径 `.claude/commands/skills/` 兼列 `.cac`。纯文案 diff，运行语义不变（claude 实例 UPDATE 时经 rules 段 `prompt_if_changed` 正常下发）。

**核对项**：`agent_entry_file.template_path` 相对 framework 根解析（[check-init.ts:584](harness/scripts/check-init.ts)）；`../` 跨目录引用先例 codex 已趟（`templateRel` path.join 归一）；`goal_condition_template` **当前属 metadata**（[goal-adapter-capability.ts:26](harness/scripts/utils/goal-adapter-capability.ts) 仅类型字段，无运行时路径解析/存在性检查——已核实），其 `../` 路径存在性由 T5 codeagent adapter unit test 验证，不顺便给 preflight 加检查。

## T2：共享 hooks 加固（必做；claude 零行为变化）

三个 hook 的 `resolveProjectRoot` 升级为**候选链+标记验真**：

```
候选序：env CLAUDE_PROJECT_DIR → env CODEAGENT3_PROJECT_DIR → import.meta.url 自锚(脚本目录/../..) → payload.cwd → process.cwd()
验真：取首个含 hooks 真实依赖标记的候选——`framework/agents/shared/guard-framework-write-core.mjs` 或
`framework/harness/scripts/check-receipt.ts` 任一存在（比裸 framework/ 目录严格：cwd 恰落在嵌套工程/fixture
时不会被宽 marker 误选；自锚排在 payload.cwd 之前——hook 物理位于 <root>/.claude|.cac/hooks/，比会话 cwd 权威）
全不中：回落现行顺序首个非空值（fail-open 语义不变）
```

- claude：env 恒在链首即中，**正常合法实例路径下行为不变**（诚实口径：env 指向 framework 缺失/损坏的病态实例时新旧选择可能不同——那是修复而非回归，不再宣称字面"零 diff"）；
- codeagent：`CODEAGENT3_PROJECT_DIR` 命中（T0#1a 实证 hook 进程有此变量）；极端情形（env 被清）由自锚兜住；
- `record-verifier-report.mjs` 报告来源行（[:245](agents/claude/templates/hooks/record-verifier-report.mjs)）改 import.meta.url 自述（claude 输出不变，codeagent 输出 `.cac/hooks/...` 真实来源）；
- 落地核对三 hook 既有 unit fixtures（fixture 工程无 framework/ 则补空目录，保证既有用例语义不变）。

## T3：goal/headless 接线（13 点闭合清单）

家族谓词落 `harness/scripts/utils/types.ts`：`CLAUDE_KERNEL_ADAPTERS = new Set(['claude','codeagent'])` + `isClaudeKernelAdapter()`。

| # | 位置 | 处置 |
|---|---|---|
| 1 | [agent-invoke.ts:41](harness/scripts/utils/agent-invoke.ts) `KNOWN_STRUCTURED_ADAPTERS` | + codeagent |
| 2 | [agent-invoke.ts:45-56](harness/scripts/utils/agent-invoke.ts) candidates 表 | + `CODEAGENT_HEADLESS_BINARY_CANDIDATES = ['codeagentcli']` |
| 3 | [agent-invoke.ts:273](harness/scripts/utils/agent-invoke.ts) `claudeArgv` | 参数化二进制名（缺省 'claude'，纯重构）；`--permission-mode dontAsk` 已实证可用 |
| 4 | [agent-invoke.ts:431](harness/scripts/utils/agent-invoke.ts) label 分支 | + 'codeagentcli' |
| 5 | [agent-invoke.ts:448](harness/scripts/utils/agent-invoke.ts) dispatch | + codeagent 分支（claudeArgv 复用 + `useStdin: true`，stdin 喂 prompt 已实证） |
| 5b | [agent-invoke.ts:1131](harness/scripts/utils/agent-invoke.ts) adapterGuess | `HeadlessInvokePlan` 增 `adapterName?: string`（defaultHeadlessInvokePlan 填充），1131 优先取之；substring 猜仅剩 custom invoke 兜底并补 codeagent 子串 |
| 6 | [claude-envelope.ts:93](harness/scripts/utils/claude-envelope.ts) 信封语义门 | `isClaudeKernelAdapter(name) && structured_events` |
| 7 | [goal-headless-sentinel.ts:191](harness/scripts/utils/goal-headless-sentinel.ts) 断流路由 | codeagent → `parseClaudeApiError`（信封三段实证同源） |
| 7b | [goal-headless-sentinel.ts:111-135](harness/scripts/utils/goal-headless-sentinel.ts) 实采漏判修复 | **a)** `error_status`/`api_error_status` 经 `Number()` 强转再判 transient 集（实采为字符串 "500"）；**b)** result 分支补回退——`is_error:true` 且状态字段缺失/非数时 `result` 文本过 `matchesTruncationHint` 且非 authentication 措辞计 transient（实采终局行无 api_error_status、文本含 `\b500\b`）。两条实采原文作 fixture；claude 同源受益 |
| 8 | [check-receipt.ts:1189](harness/scripts/check-receipt.ts) forceParse | `isClaudeKernelAdapter(adapter)` |
| 9 | [multimodal-probe.ts:154](harness/scripts/utils/multimodal-probe.ts) 读图缺省 | + codeagent → tool_read |
| 10 | [critic-receipt-producer.ts:65](harness/scripts/utils/critic-receipt-producer.ts) `IMAGE_READ_PARSERS` | T0#6 实采 fixture 同构 → `codeagent: parseClaudeImageReadEvents` 入册（注册契约"fixture 后方可入册"已满足） |
| 11 | [instance-skill-bridge.ts:261](harness/scripts/utils/instance-skill-bridge.ts) | manifest 化：`isClaudeKernelAdapter` 命中时读 `agents/${name}/adapter.yaml` 解析 commands target_dir（codeagent → `.cac/commands`） |
| 12 | [legacy-skill-bridge-cleanup.ts:129](harness/scripts/utils/legacy-skill-bridge-cleanup.ts) | + codeagent → `.cac/commands/<id>.md`（新 adapter 无遗留，现阶段恒 no-op；实现与 #11 同径） |
| 13 | [init-next-steps.ts:546](harness/scripts/utils/init-next-steps.ts) slash 提示 | codeagent 并入 slash 形态分支（entry.rel 按 adapter 解析，无硬编码） |

## T4：注册与文档

1. [confirmation-registry.yaml](skills/reference/confirmation-registry.yaml) options 追加 codeagent（label 含 `.cac`/内核/headless；与 T1 同提交防 `catalog_join` BLOCKER）；锚定段勿手写 adapter 名。
2. [agents/README.md](agents/README.md)：目录树、产物速查、多选建议、personal setup 建议、第一版列表 + Layer 3 小节（claude/codeagent 均具物理层）。
3. [claude/adapter.yaml](agents/claude/adapter.yaml) notes：标注 templates 被 codeagent 引用（家族 SSOT）+ 修正"11 份"→"12 份"（含 change-lite，既有笔误）。
4. canonical gitignore：[canonical-gitignore.ts](harness/scripts/utils/canonical-gitignore.ts) + 等价表增 `**/.cac/settings.local.json`；本仓 .gitignore 同步。
5. 身份 env 键回填：codeagent=**CODEAGENT**（对照表 claude=CLAUDECODE / cursor=CURSOR_AGENT / codex=CODEX_SHELL / opencode=OPENCODE_TERMINAL / chrys=CHRYS），写入宿主识别相关文档。
6. 文档扫尾：docs/overview.md、agents-entry-detail.md、goal-mode-runbook.md 等逐 adapter 清单按需补行。

## T5：测试

1. `codeagent-adapter.unit.test.ts`（参照 [chrys-opencode-adapter.unit.test.ts](harness/tests/unit/chrys-opencode-adapter.unit.test.ts)）：yaml 可解析/名目录一致/全部 template 路径存在（含 goal_condition_template 的 `../` 路径）；**commands 归一化等值——delta 白名单按文件显式声明**：普通 11 份仅允许 codeagent 身份行一处；`goal-mode.md` 允许身份行 + `RESOLVED_ADAPTER` 行 + 运行身份权威段三处；归一化后其余内容逐字节等于 claude 版；**实现禁止用"删除任意含 codeagent 的整段"式宽松归一**（会假绿）；**settings 结构等值**（事件/matcher 同构、command 仅差目录与变量名、无 $schema）；goal_capability 逐字段等值（除二进制名）。
2. hooks `resolveProjectRoot` 新链用例：CLAUDE env 命中（现状）/CODEAGENT3 env 命中/无 env+cwd 漂移+自锚兜住/全不中 fail-open。
3. agent-invoke 用例：codeagent plan 同构 claude（binary/flags/useStdin）；adapterName 显式携带下不再误猜 cursor；家族谓词生效面。
3b. **T3 三个路径接线点的 codeagent 分支用例**（扩展既有套件，不新建平行文件）：[init-next-steps.unit.test.ts](harness/tests/unit/init-next-steps.unit.test.ts) 增 codeagent 解析 `.cac/commands/<cmd>.md` 并渲染 `/<cmd>` slash 形态；[legacy-skill-bridge-cleanup.unit.test.ts](harness/tests/unit/legacy-skill-bridge-cleanup.unit.test.ts) 增 codeagent 生成/清理 `.cac/commands/<legacy-id>.md`；instance-skill-bridge 侧增**多 adapter 用例** `['claude','codeagent']` 各自解析到各自目录、**断言互不交叉落到对方目录**（现有用例只覆盖 claude/cursor/generic，.cac 分支写错 npm test 也会假绿）。
4. sentinel #7b + 图片事件：四条实采样本作 fixture（api_retry 字符串 status / 终局 result 文本回退 / authentication 不误报 / tool_use Read 行入册解析），**保留结构逐字、敏感值脱敏+路径归一化**（白名单口径见 T0 附注；"原文"指字段结构与类型不得手工美化——字符串 "500" 必须保持字符串）。
5. canonical-gitignore `.cac` 用例；`run-unit.ts` CORE_SUITES **显式注册**全部新套件（不注册=假绿）。
6. `cd harness && npm test` 全绿。

## T6：宿主回归验收（依赖宿主实机；探针工程 WalletForHarmonyOS 可复用）

**发布门禁政策（BLOCKER）**：本 plan `version: 3.0.0`，[check-plan-version.mjs:91](scripts/check-plan-version.mjs) 在 `release:all` 第一阶段会因 open todo 阻断发布——**这是正确行为**：T6 未完成不得随 3.0.0 发布 hard_hook 声明。T6 不得为过门禁标 cancelled；若届时无法完成，二选一——把 codeagent 的 hard_hook 声明移除/降级后再发布，或整个接入 `deferred_to` 顺延到下一版本窗口。

> **2026-07-30 修订（plan 所有者决定）**：T1-T5 实施完毕、codex 六轮 review 闭环后，用户决定**宿主验收移交用户侧**——由用户携本章验收单在 codeagent 宿主自行执行，发现问题另开 plan 回修；本 plan 的 t6 todo 据此关闭（cancelled=移交留痕，非绕门禁——决定出自 plan 所有者本人）。hard_hook 的对外声明前提不变：仍以宿主实测三项通过为准（agents/README.md Layer 3 注记保留）。

T0 证明了 hook 会加载、matcher 会触发、变量稳定，但**阻断协议等价性**尚未实证——hard_hook 档位的对外声明（README/发布说明）以本章三项完成为准，不凭"配置结构相同"提前定档（codex 意见采纳；adapter.yaml 声明本身不设闸，结构性 tier 判定维持 schema 既有语义）：

- **PreToolUse 阻断**：guard 真拦 framework 写入（exit 2 → 工具调用被拒 + stderr 回喂 agent）；
- **Stop 阻断**：真拦假完成（阶段未闭环时 Stop hook 阻止收尾）；
- **SubagentStop**：verifier 子 agent 结束时 matcher=verifier 真触发、报告真落盘（check-receipt 可引用）；
- 以上各项**cd harness 后再触发一次**，验 T2 链在漂移下命中 CODEAGENT3 env；
- goal 态：codeagentcli headless 全链路——stream-json 三文件分流入账、attestation 签发、图片验读回执产出（IMAGE_READ_PARSERS 入册后首次实跑）；
- **`codeagentcli --version` 必录**——记录到宿主验收证据及本 plan 文末**「实施记录」**小节（[plan-execution.mdc](.cursor/rules/plan-execution.mdc) 唯一许可通道，**不回写 T0 正文**）；`CODEAGENT3_` 前缀带版本号，不锚定版本则未来无法判断哪一版改了 env/信封协议（既有 adapter_version 机制只是非阻塞遥测，不做兼容判断，替代不了此记录）。

## 开放问题（全部收敛）

| # | 问题 | 结论 |
|---|---|---|
| 1 | 注册名/目录 | ✅ codeagent / `.cac` |
| 2 | 入口文件 | ✅ AGENTS.md |
| 3 | 等价变量 | ✅ `CODEAGENT3_PROJECT_DIR`，占位符可展开（实证） |
| 4 | goal/headless | ✅ 本期做，CLI=codeagentcli，`--permission-mode dontAsk` 可用（实证） |
| 5 | AskUserQuestion | ✅ 同名同签名+真实渲染（实证）→ rules 共享 |
| 6 | Read 事件 | ✅ 同构（实证）→ 视觉链入册 |

## 风险与诚实边界

- **commands 副本维护成本**：12 份与 claude 平行，T5 归一化等值测试强制同步（改 claude 模板→测试红→同步副本）；接受此成本换运行身份正确性（cursor 同款先例）。
- **fork 扩展字段**：codeagent 事件流带 `tool_use_result.vlDescription`/`modelID` 等 claude 没有的扩展字段——均不在现有解析路径上（解析器只按结构化字段取值，实采样本验证）；若未来消费这些字段须按"消费方按真实 writer schema"先采样再接。
- **探针环境局限**：实采来自单台宿主（WalletForHarmonyOS，经本地代理接第三方模型）；`CODEAGENT3_` 前缀含版本号 "3"，codeagent 大版本升级可能改名——T5 为 env 链写用例时两个变量名都覆盖，升级时按同法重探。
- **claude 侧口径**：运行语义零变化；两处良性 diff（rules 文案中性化、病态实例下 hooks 选根修复）见设计原则 4；版本号跟随 3.0.0 不 bump。
- **发布约束**：T6 未完成前本 plan open todo 会被 [check-plan-version.mjs](scripts/check-plan-version.mjs) `--release` 门禁正确阻断——届时要么完成 T6，要么移除/降级 hard_hook 声明，要么 `deferred_to` 顺延，**不得标 cancelled 过门禁**。
