---
name: codeagent adapter 接入——.cac 物化与 claude 差异最小化
version: 3.0.0
# 版本说明：跟随当前版本窗口 3.0.0（用户控版本，不 bump）。
overview: 新增 codeagent（Claude Code CLI 内核衍生 agent，物化目录 .cac，headless CLI=codeagentcli 与 claude -p 等价）adapter：除 settings.json 单文件分叉外，commands/agents/rules/hooks/goal-condition 模板 100% 跨目录引用 claude adapter；goal/headless 本期接入（claude-kernel 家族谓词收敛 9 处 === 'claude' 散点）；claude 侧 ${CLAUDE_PROJECT_DIR} 经官方文档核实不可改相对路径（hook cwd 随会话 cd 漂移，改了=Layer 3 三 hook 静默失效），codeagent 侧优先探针等价变量、相对路径仅作降级并记录诚实边界。
todos:
  - id: t0-host-probe
    content: "T0: 宿主探针（对 codeagent 宿主的话术+预期回报）——等价 project-dir 变量/hook cwd 漂移语义/$schema 容忍度/AskUserQuestion/ambient env 标识/headless 错误信封文案"
    status: pending
  - id: t1-adapter
    content: "T1: agents/codeagent/adapter.yaml（入口 AGENTS.md；五段模板全 ../claude 引用；goal_capability 全量镜像 claude）+ 唯一分叉文件 templates/settings.json（无 $schema、.cac 路径、按 T0 定变量或相对路径降级）"
    status: pending
  - id: t2-goal-wiring
    content: "T2: goal/headless 接线——claude-kernel 家族谓词落 utils/types.ts；agent-invoke（candidates=codeagentcli/claudeArgv 参数化/dispatch/label）+ claude-envelope + goal-headless-sentinel + check-receipt forceParse + multimodal-probe + init-next-steps + instance-skill-bridge/legacy-cleanup 共 9 处逐点适配；#7b 实采回灌修复 error_status 字符串型漏判（实采样本原文作 fixture）"
    status: pending
  - id: t3-registry-docs
    content: "T3: confirmation-registry.yaml options 补 codeagent + agents/README.md 参考表五处 + claude adapter.yaml notes 标注 claude-kernel 家族模板 SSOT + 入口文件类文档扫尾"
    status: pending
  - id: t4-tests
    content: "T4: 新增 codeagent-adapter.unit.test.ts（跨目录引用可解析/settings 与 claude 结构等价守护/无 $schema）+ agent-invoke 侧 codeagent headless plan 用例 + run-unit.ts CORE_SUITES 显式注册 + cd harness && npm test 全绿"
    status: pending
  - id: t5-deferred
    content: "T5(悬置): hooks 兜底链插入 codeagent 等价 env（T0 探到后）/ 宿主实测回灌（goal 全链路真跑 + API 断流信封文案校准 + Stop/guard 硬门禁实拦验证）"
    status: pending
isProject: false
---

## 背景

接入新 agent 类型 **codeagent**：内核基于 Claude Code CLI 开发，物化目录 `.cac`（结构与 `.claude` 完全一致），headless CLI 为 **`codeagentcli`**，参数与 `claude -p` 基本完全等价。已知不兼容点：不认识 `$schema`（claude-code-settings 的 schema URL）；不认识 `${CLAUDE_PROJECT_DIR}` 等 Claude 注入变量。

**用户已拍板**（2026-07-29）：① 注册名用全称 `codeagent`，物化目录 `.cac`；② 入口说明文件 CLAUDE.md / AGENTS.md 都能读；④ goal/headless 本期要做，CLI=`codeagentcli`。③（等价变量）见 T0 说明——不需要用户回答，探针自答。

## 先回答核心问题：相对路径能不能用？

**已向 Claude Code 官方文档核实**（hooks.md / hooks-guide.md / settings.md，claude-code-guide 代理查证）：

| 事实 | 出处结论 |
|---|---|
| hook command 的 cwd = **hook 触发时会话当前工作目录**，会随 Bash 工具 `cd` 漂移（有 CwdChanged 事件） | hooks.md "run in the current working directory of the Claude Code session at the time the hook fires" |
| `${CLAUDE_PROJECT_DIR}` 恒指项目根，且作为 env 注入 hook 子进程 | hooks.md "Path Placeholders" |
| 官方**明确不建议** hook command 写相对路径："Relative paths are resolved relative to the current cwd, which may vary during a session" | hooks.md "Relative Paths vs. Absolute Paths" |
| `$schema` 对运行时**零影响**，纯编辑器福利（自动补全/校验），未知字段被忽略 | settings.md |
| hook stdin payload 恒含 `cwd` 字段（=触发时会话 cwd） | hooks.md "Common Input Fields" |

**裁决：claude 侧不改相对路径。** maison 工作流里 agent 高频 `cd harness && npm ...`（Bash 持久 shell，cwd 停在 harness/）；相对路径写法下，此后触发的三个 hook（PreToolUse guard / Stop 假完成拦截 / SubagentStop verifier 落地）node 找不到脚本 → 非 0 非 2 退出 → 按协议是 non-blocking error → **Layer 3 物理门整体静默失效**，且没有任何报错会阻断 agent。为省一行变量把最硬的门变成"一次 cd 就绕过"，不划算。

**差异最小化换个收敛点**：不追求"两边 settings.json 逐字节相同"，而是收敛为——**settings.json 是唯一分叉文件（39 行），其余全部产物 100% 共享 claude 模板**。framework-init 零新机制（跨目录 template 引用已有先例）。

**codeagent 侧的 settings.json 变量**分两级：
- **优先**：T0 探针确认 codeagent 是否注入等价变量（内核是 Claude Code fork，`CLAUDE_*` env 大概率被机械重命名而非删除，如 `CAC_PROJECT_DIR` 之类）→ 有则用等价变量，与 claude 同等鲁棒；
- **降级**：确认无等价变量 → 用相对路径 `node ".cac/hooks/x.mjs"`，并在 adapter notes + README 记录已知限制：**须在工程根启动 codeagent；会话 cd 漂移后 hook 失效（fail-open）**，兜底=Layer 2 check-receipt + G2 framework_integrity 查时扫描（与 guard hook 既有诚实边界同构）。

> **③"等价变量"是什么意思**（补充解释）：Claude Code 启动 hook 子进程时会额外塞一个环境变量 `CLAUDE_PROJECT_DIR=<工程根绝对路径>`，settings.json 里的 `${CLAUDE_PROJECT_DIR}` 占位符引用的就是它。codeagent 既然是 fork，很可能只是把这个变量**改了名**（而不是删掉）——如果能探出它的新名字，`.cac/settings.json` 就能用 `${新名字}` 写出与 claude 同等鲁棒的绝对路径。这事不用你回答，T0 探针第 1 条会实测出来。

## 设计原则

1. **单文件分叉**：codeagent 与 claude 的全部差异压进 `agents/codeagent/templates/settings.json` 一个文件；commands（11 份 slash）/ agents（verifier.md）/ rules（interaction-renderer.md）/ hooks（3 份 .mjs）/ goal-condition.md 全部跨目录引用 `../claude/templates/...`，**零复制**。先例：codex/chrys/opencode 的 `skill_bridge.template_dir: ../shared/agent-bundle/templates/skills-bridge`（[codex/adapter.yaml:15](agents/codex/adapter.yaml)）；check-init 用 `path.join(adapterDir, tpl)` 解析，`..` 天然支持（[check-init.ts:674](harness/scripts/check-init.ts)）。
2. **hooks 脚本零改动**：三个 hook 的项目根解析已是 `CLAUDE_PROJECT_DIR ?? payload.cwd ?? process.cwd()` 兜底链（[guard-framework-write.mjs:41](agents/claude/templates/hooks/guard-framework-write.mjs)、[check-phase-completion.mjs:99](agents/claude/templates/hooks/check-phase-completion.mjs)、[record-verifier-report.mjs:67](agents/claude/templates/hooks/record-verifier-report.mjs)），codeagent 下 env 缺失自动落 `payload.cwd`。模板内其余 `.claude` 字样均为注释/报告文案，无功能性硬编码（已全量 grep 核实）。
3. **不动 claude 现有行为**：`${CLAUDE_PROJECT_DIR}` 保留、`$schema` 保留（运行时无影响，编辑器福利没理由丢）。
4. **goal 接入走"家族谓词"不走散点 ||**：全库 `=== 'claude'` 仅 9 处（已枚举，见 T2 表），语义各不同——统一引入 `CLAUDE_KERNEL_ADAPTERS = {claude, codeagent}` 谓词，逐点判断该不该收编，**禁止无脑替换**（硬学习：枚举完整状态空间）。
5. **enforcement tier 自动对齐**：codeagent 声明 settings_file+hooks 后，`resolveEnforcementTier` 自动判 `hard_hook`（[runtime-policy.ts:340](harness/scripts/utils/runtime-policy.ts)），与 claude 同档，无需改代码。

## T0：宿主探针（与 T1 并行，回报回灌后 settings.json 定稿）

按「宿主工程指引=话术+预期回报」惯例，把下面这段话术交给 **codeagent 宿主会话** 执行，回报贴回来：

> 请在一个已有 `.cac` 的测试工程里做 5 件事并逐条回报：
> 1. **等价变量**：在 `.cac/settings.json` 里注册一个 PreToolUse hook，command 为 `node -e "console.error(JSON.stringify(process.env))"`，触发一次工具调用，把 stderr 里所有含 PROJECT / DIR / CAC / CODEAGENT / CLAUDE 字样的 env 键值贴出来——回报：是否存在指向工程根的注入变量及其准确名字；并确认 command 字符串里 `${变量名}` 占位符是否会被展开。
> 2. **cwd 漂移**：先用你的 shell 工具 `cd` 进一个子目录，再触发上述 hook，把 hook 收到的 stdin payload 里的 `cwd` 字段和 `process.cwd()` 各是什么贴出来——回报：两值是否跟随 cd 漂移。
> 3. **$schema 容忍度**：settings.json 顶层带 `"$schema": "https://json.schemastore.org/claude-code-settings.json"` 时你是报错、警告还是忽略——回报：三选一+原文。
> 4. **确认 widget**：你是否有 AskUserQuestion（或同名结构化提问）工具——回报：工具名或"无"。
> 5. **身份标识**：从你的 shell 工具执行 `node -e "console.log(JSON.stringify(process.env))"`，贴出能唯一识别"当前宿主是 codeagent"的 env 键（对照：claude=CLAUDECODE / cursor=CURSOR_AGENT / codex=CODEX_SHELL）——回报：键名。
>    信封已全程实证（2026-07-29 三轮实测，无需再采）：① 参数校验报错文案与 claude CLI 逐字相同，`-p/--print` 支持 stdin 喂 prompt（maison agent-invoke 正走 stdin 路径）；② 断网下吐 `{"type":"system","subtype":"api_retry","error_status":"500","error":"server_error"}` NDJSON 流，与 claude 结构化信封形状逐字段一致；③ 重试耗尽终局行 `{"type":"result","subtype":"success","is_error":true,...}` 无 `api_error_status` 字段、错误在 `result` 文本。②③ 各暴露一处现行哨兵漏判，修复见 T2 #7b（实采原文作 fixture）。

回报回灌决定：settings.json 变量写法（等价 env vs 相对路径降级）、user_confirmation 定档、sentinel 信封文案是否需要 codeagent 专属锚点（T5）。**探针未回前按默认假设推进到可 review 状态，不 halt**（默认：变量=相对路径降级、widget=supported、信封=与 claude 同文案）。

## T1：adapter 落地

**新增 `agents/codeagent/adapter.yaml`**（要点，非全文）：

```yaml
adapter_name: codeagent          # 与目录名一致（adapter-catalog 硬校验）
agent_entry_file:
  template_path: templates/AGENTS.md.template   # 共享模板
  target_path: AGENTS.md   # 已拍板"两个都能读"→选 AGENTS.md：与 cursor/codex/chrys/opencode
                           # 同名字节一致可共存（README 既有先例）；与 claude 并存时两文件
                           # 内容同源、各归各 adapter 管，卸载归属清晰
commands:
  target_dir: .cac/commands
  template_dir: ../claude/templates/commands     # 11 份 slash 全共享
  subagents:
    target_dir: .cac/agents
    template_dir: ../claude/templates/agents     # verifier.md 共享
    update_policy: auto_overwrite
rules:
  target_dir: .cac/rules
  template_dir: ../claude/templates/rules        # interaction-renderer.md 共享
settings_file:
  template_path: templates/settings.json         # ★ 唯一 codeagent 自有文件
  target_path: .cac/settings.json
  update_policy: auto_overwrite
hooks:
  target_dir: .cac/hooks
  template_dir: ../claude/templates/hooks        # 3 份 .mjs 共享，零改动
  update_policy: auto_overwrite
instance_skill_bridge:
  commands_target_dir: .cac/commands
user_confirmation:
  structured_widget: supported                   # 按 T0 回报定档；unsupported 则退 portable
  portable_required: true
  interaction_renderer_rule: ../claude/templates/rules/interaction-renderer.md
image_input: tool_read
goal_capability:                                 # 全量镜像 claude（CLI 等价，仅二进制名不同）
  mode: native_goal
  tool_event_provenance: structured_events       # stream-json 事件流，同 claude
  native_goal:
    goal_condition_template: ../claude/templates/goal-condition.md
    supports_resume: false
  external_runner:
    # 声明性；运行时 SSOT = agent-invoke.ts（prompt 走 STDIN，Windows cmd 截断铁律同 claude）
    headless_invoke: 'codeagentcli -p "{{PROMPT}}" --allowedTools Bash,Read,Write,Edit,Glob,Grep --permission-mode dontAsk'
    unattended:
      write_mode: accept-edits
      approval_mode: never
post_install_hooks: []
notes: |
  - 内核=Claude Code CLI 衍生（headless CLI=codeagentcli，参数与 claude -p 等价）；模板 SSOT 在
    agents/claude/templates/（claude-kernel 家族共享），本 adapter 仅 settings.json 分叉：
    无 $schema、路径 .cac/、变量按宿主实测。
  - <若走相对路径降级> 已知限制：须在工程根启动；会话 cd 漂移后 hooks fail-open，
    兜底=Layer 2 check-receipt + G2 framework_integrity 扫描。
```

**新增 `agents/codeagent/templates/settings.json`**：以 claude 版为基（[settings.json](agents/claude/templates/settings.json)），三处差异——删 `$schema` 行；`.claude/hooks/` → `.cac/hooks/`；`${CLAUDE_PROJECT_DIR}/` → 等价变量或删除（相对路径降级）。hook 结构（PreToolUse matcher `Write|Edit|MultiEdit|NotebookEdit` / Stop `*` / SubagentStop `verifier`）与 claude 逐项相同，由 T4 等价性测试守护。

**核对项**：`agent_entry_file.template_path` 相对 framework 根解析（与其它字段相对 adapter 目录不同，[check-init.ts:584](harness/scripts/check-init.ts)）；跨目录引用在 check-init 的 `templateRel` 展示会被 path.join 归一为 `agents/claude/templates/...`，确认 UPDATE 体检/物化任务表对此无排异（先例 codex 已趟过 `../shared`，`../claude` 是同机制）；`goal_capability.native_goal.goal_condition_template` 的 `../` 引用是否被 goal-runner preflight 正确解析（同 path.join 机制，落地时验证）。

## T2：goal/headless 接线（claude-kernel 家族谓词）

**谓词落点**：`harness/scripts/utils/types.ts`（既有共享底座、被各 utils 引用、无循环依赖风险）新增：

```ts
/** Claude Code 内核家族：CLI 参数/stream-json 信封/slash 机制同源（codeagent=fork，二进制 codeagentcli） */
export const CLAUDE_KERNEL_ADAPTERS: ReadonlySet<string> = new Set(['claude', 'codeagent']);
export function isClaudeKernelAdapter(name: string): boolean { return CLAUDE_KERNEL_ADAPTERS.has(name); }
```

全库 `=== 'claude'` 共 **9 处**（已枚举核实），逐点裁决：

| # | 位置 | 语义 | 处置 |
|---|---|---|---|
| 1 | [agent-invoke.ts:41](harness/scripts/utils/agent-invoke.ts) `KNOWN_STRUCTURED_ADAPTERS` | tool_event_provenance 合法 adapter 集 | + `codeagent` |
| 2 | [agent-invoke.ts:45-56](harness/scripts/utils/agent-invoke.ts) binary candidates 表 | headless 二进制解析 | 新增 `CODEAGENT_HEADLESS_BINARY_CANDIDATES = ['codeagentcli']` 并入 `STRUCTURED_BINARY_CANDIDATES` |
| 3 | [agent-invoke.ts:273](harness/scripts/utils/agent-invoke.ts) `claudeArgv` | argv[0] 硬编码 `'claude'` | 参数化二进制名（缺省 'claude'），codeagent 复用全套 flags（`-p --allowedTools … --output-format stream-json --verbose --permission-mode`） |
| 4 | [agent-invoke.ts:431](harness/scripts/utils/agent-invoke.ts) 自定义 invoke 的 label 分支 | 显示标签 | + `'codeagentcli'` |
| 5 | [agent-invoke.ts:448](harness/scripts/utils/agent-invoke.ts) `defaultHeadlessInvokePlan` dispatch | 内置 headless 方案 | + codeagent 分支：claudeArgv('codeagentcli', …) + attachResolvedBinary(CODEAGENT_…, 'codeagentcli -p …')，`useStdin: true`（Windows cmd shim 截断铁律同 claude） |
| 6 | [claude-envelope.ts:93](harness/scripts/utils/claude-envelope.ts) 信封语义门 | stream-json 行级信封是否适用 | 改 `isClaudeKernelAdapter(name) && structured_events` |
| 7 | [goal-headless-sentinel.ts:191](harness/scripts/utils/goal-headless-sentinel.ts) API 断流解析路由 | 断流哨兵 adapter 感知 | codeagent → `parseClaudeApiError`。**信封形状已获实测证实**（2026-07-29 断网实采）：`{"type":"system","subtype":"api_retry","error_status":"500","error":"server_error"}` 与锚定形状逐字段一致（type/subtype/字段名全同）→ 结构化路径零改动复用成立 |
| 7b | [goal-headless-sentinel.ts:111-135](harness/scripts/utils/goal-headless-sentinel.ts) 结构化信封两分支 vs 真实 writer schema | **实采样本暴露的两处真实漏判**（消费方须按真实 writer schema 硬学习；2026-07-29 断网全程实采）：① api_retry 行 `error_status` 是**字符串 "500"**，现行只认 `typeof === 'number'`，回退条件 `error:"server_error"` 不匹配 API_TRUNCATION_HINTS 任何一条 → 漏判；② 重试耗尽终局行 `{"type":"result","subtype":"success","is_error":true,...}` **根本不带 `api_error_status` 字段**，错误全在 `result` 文本（`"API Error: 500 Unable to connect. Is the computer able to access the url?…"`）→ result 分支同样漏判；文本路径 `^API Error` 行首锚定对 NDJSON 行也恒不中。两处齐漏 = 断流退化为整 attempt 干等超时（本次实采 CLI 重试即耗了 ~7 分钟） | 修复两条：**a)** `error_status` / `api_error_status` 经 `Number()` 强转后进 `STREAM_JSON_TRANSIENT_STATUS` 判定（NaN 不计）；**b)** result 分支补真实 schema 回退——`is_error:true` 且 `api_error_status` 缺失/非数时，`typeof result === 'string' && matchesTruncationHint(result) && !/authentication/i.test(result)` 计 transient（实采文本含 `\b500\b`，既有 hint 可命中）。unit 用例以两条实采样本**原文逐字**作 fixture（api_retry 行 + result 终局行）。对 claude 同样生效——同源内核同一 writer，属修潜在漏判，非行为回归 |
| 8 | [check-receipt.ts:1189](harness/scripts/check-receipt.ts) `forceParse: adapter === 'claude'` | 回执校验强制解析事件流 | 改 `isClaudeKernelAdapter(adapter)` |
| 9 | [multimodal-probe.ts:154](harness/scripts/utils/multimodal-probe.ts) 读图档位缺省 | image_input 缺省推断 | + codeagent → `tool_read`（与 adapter.yaml 声明一致） |
| 附 | [init-next-steps.ts:546](harness/scripts/utils/init-next-steps.ts) slash 提示文案 | next-steps 渲染 `/command` 形态 | codeagent 并入 slash 形态分支（文案目录名取实际 entry.rel，无硬编码 .claude，核实后收编） |
| 附 | [instance-skill-bridge.ts:261](harness/scripts/utils/instance-skill-bridge.ts)、[legacy-skill-bridge-cleanup.ts:129](harness/scripts/utils/legacy-skill-bridge-cleanup.ts) | 扩展 skill 桥/旧跳板清理的 commands 形态分支 | 逐点核实语义后并入家族谓词（桥目录取 adapter.yaml `instance_skill_bridge.commands_target_dir`，应无 .claude 硬编码；若有则先修硬编码再收编） |

> 处置原则：能走谓词的走谓词；**语义不属于"内核家族"的（如文案、目录名）绝不顺手收编**——逐点核实后再动，避免"非阻塞顺便实现"膨胀。

## T3：注册与文档

1. **[confirmation-registry.yaml](skills/reference/confirmation-registry.yaml)** `init.materialized_adapters.options` 追加（与 T1 同一提交，否则 `catalog_join` BLOCKER 红灯）：
   ```yaml
   - value: codeagent
     label: "codeagent — 物化 AGENTS.md + .cac/ 产物（Claude Code 内核；hooks 硬门禁；headless = codeagentcli -p）"
     portable: "codeagent"
   ```
   锚点门禁自动把它带进 S1 `adapter_catalog` 菜单，**勿**在任何 `adapter-candidates` 锚定段手写 adapter 名（catalog gate 拦 ≥2 硬编码）。
2. **[agents/README.md](agents/README.md)** 参考表五处：目录约定树、产物速查表、`materialized_adapters` 多选建议、personal setup 建议行、第一版 adapter 列表 + Layer 3 小节改为"claude / codeagent 均具 settings_file+hooks 物理层"。
3. **[claude/adapter.yaml](agents/claude/adapter.yaml)** notes 加一句：templates/ 同时被 codeagent adapter 跨目录引用（claude-kernel 家族 SSOT），改动 commands/hooks/rules/goal-condition 模板时两 adapter 同时生效。
4. **文档扫尾**：grep 列出"逐 adapter 入口文件/产物/goal 能力"的其余文档（docs/overview.md、skills/reference/agents-entry-detail.md、docs/operations/goal-mode-runbook.md 等）按需补行；不改锚定段。

## T4：测试

1. 新增 `harness/tests/unit/codeagent-adapter.unit.test.ts`（模式参照 [chrys-opencode-adapter.unit.test.ts](harness/tests/unit/chrys-opencode-adapter.unit.test.ts)）：
   - adapter.yaml 可解析、adapter_name=目录名、五段跨目录 template 路径真实存在；
   - **settings 等价性守护**：解析 claude/codeagent 两份 settings.json，断言 hook 事件集/matcher/条目数逐项相同，command 仅相差 `.claude→.cac` 与变量前缀，codeagent 无 `$schema` 键——防两 adapter 日后漂移；
   - goal_capability 与 claude 逐字段等价（除 headless_invoke 二进制名）。
2. **agent-invoke 用例**：`defaultHeadlessInvokePlan('codeagent', …)` 断言 argv[0] 解析自 codeagentcli 候选、`-p`/`--output-format stream-json`/`--permission-mode` 与 claude 同构、`useStdin: true`；`KNOWN_STRUCTURED_ADAPTERS`/信封门/sentinel 路由含 codeagent（家族谓词生效）。
3. **`run-unit.ts` CORE_SUITES 显式注册**新套件（硬学习：不注册=假绿）。
4. `cd harness && npm test` 全绿（含 adapter-catalog 一致性门、check-init 模板存在性门）。

## T5：悬置项（显式，不在本 plan 闭环）

- **hooks 兜底链加固（可选）**：T0 探到等价 env 后，三个 hook 的 `resolveProjectRoot` 兜底链插入该变量（一行/文件；claude 侧行为不变）。
- **宿主实测回灌**：codeagent 实机跑一轮 coding phase + goal 全链路（codeagentcli headless 真跑、stream-json 事件流入账、attestation 签发），验证 Stop hook 真拦假完成、guard 真拦 framework 写入；API 断流信封文案按 T0 第 5 条回报校准 sentinel；相对路径降级方案则额外验证 cd 漂移后的 fail-open 行为与 G2 兜底。

## 开放问题（已收敛）

| # | 问题 | 结论 |
|---|---|---|
| 1 | adapter 注册名 | ✅ `codeagent`（用户拍板）；`.cac` 只出现在 target 路径 |
| 2 | 入口文件 | 用户拍板"都能读"→ 取 **AGENTS.md**（与非 claude 家族同名共存先例；与 claude 并存时各归各管。若你更想用 CLAUDE.md 说一声，改动即一行） |
| 3 | 等价 project-dir 变量 | 无需用户回答；T0 探针第 1 条实测，未回前按相对路径降级推进 |
| 4 | goal/headless | ✅ 本期做（用户拍板：CLI=codeagentcli，与 claude -p 等价），见 T2 |

## 风险与诚实边界

- **相对路径降级方案的真实代价**（若 T0 确认无等价变量）：codeagent 会话内一次 `cd` 即令后续 hooks 静默 fail-open——Layer 3 对 codeagent 从"物理拦截"降为"工程根启动约定下的物理拦截"，Layer 2/G2 仍在。此边界写进 adapter notes 与 README，不粉饰。
- **信封形状已全程实证**：参数校验文案、api_retry 事件、重试耗尽终局 result 事件三段均实采确认与 claude 同源（2026-07-29）——"fork 未改文案/形状"不再是假设。仅纯文本（非 stream-json）模式的 `API Error` 行未单独采（低风险：goal 恒走 structured_events）。实采同时暴露现行哨兵两处真实漏判（字符串 error_status / 终局行无 api_error_status），已列 T2 #7b 修复，claude 同源受益。
- **跨目录引用的耦合**：claude 模板改动即刻影响 codeagent（这正是收敛目的），T4 等价性测试+claude notes 双向声明来管理；若未来两内核分叉加大，届时再泵到 `agents/shared/claude-kernel/`，本期不预设（简单优先）。
- **不改 claude 行为**：本 plan 对既有 claude 实例产物零 diff；`claudeArgv` 参数化属纯重构（缺省 'claude'，既有单测守护）；版本号不动。
