---
name: Codex verifier 模板收编 — 宿主手写 toml 纳入 framework 管理、由 verifier.md 生成、只读仅为角色默认值
overview: >
  宿主 `.codex/agents/verifier.toml` 是 2026-05-25 宿主提交 66eb7dfd（Cursor 会话手写）带入的，
  framework 的 codex adapter 自 06-08 建立起从未有过 agents 模板，也没有任何生成 toml 的逻辑；两份宿主
  （SimulatedWalletForHmos / -br）内容相同，全部停在 5 月契约（自读 verify-<phase>.md 与 phase-rules、
  旧产物路径、Markdown 表、无终态块、无非法 request 处置）。09-07 在主宿主做只读冒烟（codex exec、真实
  spawn_agent 起 agent_role=verifier 子线程）：过期 toml 下仍回合规终态块，parseResultBlock 解析为
  subject 回显 / PASS / blocker 0——能过是因为 request 的 prompt_path 指向的 ai-prompt.md 自带契约，
  模型把两套指令调和了；代价是子代理按旧指令多读了 verify-testing.md、overlay、testing-rules.yaml。
  修法：codex adapter 新增 agents 模板 `templates/agents/verifier.toml`，**由** claude 的 verifier.md
  **生成**（一个渲染函数 + npm 同步命令 + 等值 unit test 守护，不做第二份手维护正文）；frontmatter 的
  `tools: Read, Glob, Grep` 映射为角色文件的 `sandbox_mode = "read-only"`，但它**只是角色默认值**——
  Codex 在 spawn_agent 时先套角色配置、再用父线程的实时权限覆盖，Maison goal 的父进程是
  danger-full-access，本轮不提供物理只读；adapter-schema 增顶层 `subagents`（无 slash 的 adapter 用），
  check-init 在 commands 块之外读顶层或 commands.subagents 二选一；auto_overwrite 让 UPDATE 备份后覆盖
  宿主手写版，生成与覆盖行为在临时工程用真实执行入口验证。hooks 能力经核实**不做**（见 D5）。
version: 3.0.0
todos:
  - id: cvt-plan-review
    content: 施工图待用户评审（09-07 用户裁定：plan 评审不走循环，Fable 直接写、用户评审；开发+检视走循环）。第 1 轮评审两处修订 + 一处实施提醒已落盘（§8）。评审通过后先提交 plan 基线再开工（B07 教训）。
    status: pending
  - id: cvt-render
    content: 按 D1 新增 harness/scripts/utils/codex-agent-toml.ts：renderCodexAgentToml(md) 解析 verifier.md frontmatter（name/description/tools）与正文，输出 TOML（literal 多行字符串 '''，含 ''' 或 name≠verifier 或 tools 越出只读集合时抛错；tools 只读集合 → `sandbox_mode = "read-only"` 角色默认值 + 注明父线程覆盖）；CLI 入口 harness/scripts/sync-codex-agent-templates.ts + npm script sync:codex-agents；生成并提交 agents/codex/templates/agents/verifier.toml。
    status: pending
  - id: cvt-schema-init
    content: 按 D2 adapter-schema.yaml 新增顶层 subagents（字段同 commands.subagents，二选一、顶层优先）；check-init.ts 把子代理模板收集移到 `if (cfg.commands …)` 块之外，读 cfg.subagents ?? cfg.commands?.subagents；codex adapter.yaml 加 subagents 块（target_dir .codex/agents、update_policy auto_overwrite）并改掉"历史 init 曾误物化"注释；claude/codeagent 不动。
    status: pending
  - id: cvt-tests
    content: 按 §6 新增 harness/tests/unit/codex-adapter-verifier-template.unit.test.ts（V1 等值/漂移、V2 转义与结构、V3a–V3c 临时工程真实执行入口：首次生成 / 旧 toml 备份后覆盖并幂等 / planner 产出同步任务、V4 二选一一致性）；adapter-catalog-consistency 补 codex 断言。
    status: pending
  - id: cvt-docs-spec
    content: 按 D6 更新 agents/README.md 两张矩阵的 codex 行与 verifier 段、agents/codex/adapter.yaml notes（含 D5 两行）；新增 openspec change codex-verifier-subagent-template（agent-adapters ADDED requirement：模板存在、由渲染函数生成、等值测试守护、只读为角色默认值而非保证；schema 位置 MODIFIED/ADDED）；MIGRATION.md 3.0.x 一节。
    status: pending
  - id: cvt-local-acceptance
    content: V1–V6 目标测试全绿；收尾一次 `cd harness && npm test` + `npm run openspec:validate` + 发布件校验（toml 入包）；codex review ≤3 轮后按 §4 提交边界提交。
    status: pending
  - id: cvt-host-acceptance
    content: 宿主验收（§7）：集成候选件 → framework-init UPDATE 覆盖 .codex/agents/verifier.toml（S3 run-log 记同步与备份）→ 同款只读冒烟：终态块 + 子线程不再读 verify-<phase>.md / phase-rules。触发方式按用户当时授权。
    status: pending
---

# 施工图

原则 SSOT：[overview §1.2.1](../../docs/overview.md#121-四条总设计原则)（效率优先、简单优先、裁剪/减法）。本 plan 独立于六阶段重构总计划 [9c6e2a41](pipeline_master_9c6e2a41.plan.md)，不占其批次；修的是 adapter 物化面，不是 goal 流水线。

**血缘**：verifier 调用契约的现状来自 [d2f7a9c4](verifier证据链裁剪_删hook发布与身份绑定_报告即真源_d2f7a9c4.plan.md)（报告即真源、`verifier_subagent` 布尔）与 [3a7f9c12](pipeline_b01_verifier_repair_3a7f9c12.plan.md)（产品失败诊断轮）；两者都只改了 claude 侧的 verifier.md 与共享规则，codex 侧的"审查员是谁"从来没有 framework 产物。codeagent 用 `template_dir: ../claude/templates/agents` 跨目录共享（plan c7a9e2f4），codex 因格式不同（TOML）走不了同一条路，这是本 plan 要补的唯一机制。adapter 退役清理来自今日 9eb3d293（已登记 codex 的两个残留 hook，本 plan 不重复）。

**证据门槛**：每条 D 以「源码位置 + 可复现输入」为前提。宿主 toml 来源以宿主 git 历史为准；Codex CLI 行为以本机 0.153.4 的 `features list` 与本地源码克隆（2026-06-09）为准，克隆早于安装版本的部分只用于字段名与调用顺序，行为以冒烟实测为准。

## 1. 问题边界

| 编号 | 已确认事实 | 证据 |
|---|---|---|
| F01 | 宿主 `.codex/agents/verifier.toml` 由宿主提交 66eb7dfd（2026-05-25，Co-authored-by Cursor）带入，同批还有 `.codex/hooks.json` 与两个 Claude hook 脚本副本。本仓 codex adapter 首次提交是 150b5a0b（2026-06-08），只有 adapter.yaml / goal-condition.md / rules；`git log --all --diff-filter=A -- 'agents/**' \| grep toml` 为空 | 宿主 `git log -- .codex`；本仓 git 历史 |
| F02 | 两份宿主的 toml 内容相同（只差 EOL），全部是 5 月契约：输入为 feature/phase/script_report_path 参数、自读 `verify-<phase>.md` 与 `phase-rules/<phase>-rules.yaml`、产物路径写死 `doc/features/<feature>/PRD.md` 等旧命名、输出 Markdown 表加"BLOCKER FAIL 数"、无终态块、无非法 request 处置、无工具限制 | `diff` 两宿主 toml；对照 [verifier.md](../../agents/claude/templates/agents/verifier.md) |
| F03 | 当前 verifier.md 自 05-25 起改了 10 次（+113/−93 行）：08-29 短 request、09-05 调用方写报告 + 回显 subject_id、09-06 产品失败诊断轮。闭环侧 check-receipt 只认三条：报告在、终态块 subject 等于 `summary.verifier_subject_id`、verdict 与 blocker_count 一致 | `git log -- agents/claude/templates/agents/verifier.md`；[verifier-evidence.ts:254](../../harness/scripts/utils/verifier-evidence.ts:254) |
| F04 | **过期 toml 今天没有打断闭环**。09-07 17:12 主宿主只读冒烟（`codex --ask-for-approval never exec --sandbox read-only --json`，prompt 走 stdin，request = bc-openCard-1/testing 的 d3d50c0f…）：Codex 会话日志证实起了 `agent_role=verifier` 子线程（父线程 01a07b23）；回复末尾恰好一个终态块，`parseResultBlock` 解析为 subject 回显 / PASS / blocker 0，与 Claude 15:35 对同一 subject 的报告一致；宿主 `git status --porcelain` 前后一致。耗时 5 分 11 秒，输入 158,829（缓存 136,576）、输出 2,642。**该冒烟的父进程是 read-only，子线程的只读不能归因于 toml**（见 F13） | scratchpad `verifier-smoke.jsonl` / `codex-verifier-report.md`；`~/.codex/sessions/2026/09/07/rollout-*-01a07b24-*.jsonl` |
| F05 | 能过的原因与代价：request 的 `prompt_path` 指向的 ai-prompt.md 第 4700 行起自带终态块契约（7 份 verify-*.md 都有），模型把 toml 旧指令与之调和。子线程按旧 toml 额外读了 `framework/harness/prompts/verify-testing.md`（2 次）、`verify-testing.overlay.md`、`phase-rules/testing-rules.yaml`——verifier.md 明令不读（ai-prompt.md 已是装配结果，且可能带 profile overlay），每阶段都在白花 | 子线程 rollout 的 tool 参数路径统计 |
| F06 | Codex agent 文件的机制：`.codex/agents/*.toml` 由 `discover_agent_roles_in_dir(config_folder.join("agents"))` 发现；解析后摘掉 `name` / `description` / `nickname_candidates`，**其余键作为该角色的 config 层**（`developer_instructions` 必填非空，`sandbox_mode` / `model` 等 config.toml 键同样可写）。本机 0.153.4 `features list`：`multi_agent stable true` | codex 源 `core/src/config/agent_roles.rs`（发现 :76，解析 :296–312，必填校验 :360–377）；`config/src/config_toml.rs:692` AgentRoleToml |
| F07 | 物化机制现状：check-init 只在 `if (cfg.commands && typeof cfg.commands === 'object')` 块内从 `cfg.commands.subagents` 收集子代理模板（整目录 verbatim、按 update_policy），codex 的 `commands: null` 进不了这个块；schema 把 subagents 定义在 commands 之下且 commands.target_dir/template_dir 非可选。`commands.subagents` 的读者只有 check-init 一处；`commands?.target_dir` 的两处读者都已判空 | [check-init.ts:672–690](../../harness/scripts/check-init.ts:672)；[adapter-schema.yaml:83](../../agents/adapter-schema.yaml:83)；`grep -rn "commands\.subagents\|commands?\.target_dir"` |
| F08 | `auto_overwrite` 的真实执行链：S1 体检第 3 项按 templateFiles 逐文件产出 inspection → planner 对 `update_policy=auto_overwrite` 产 `sync-auto-overwrite:<target>` 任务、其余产 `materialize-adapter-file:<target>` → executor 调 `applyInitMechanismSync(projectRoot, adapter, { includeTargets })`：目标缺失则写入，存在且不同则先备份到 `.framework-backup/<UTC>/` 再覆盖，返回 `file_results` / `backupRelDir`；首次物化由 `materialize-adapter:<name>` 整包写盘。既有 unit test 已用临时工程 + 真实入口验证 claude 的 settings.json / hooks 同步 | [init-task-planner.ts:193–224](../../harness/scripts/utils/init-task-planner.ts:193)；[init-task-executor.ts:728–745](../../harness/scripts/utils/init-task-executor.ts:728)；[check-init.ts:1911–1935](../../harness/scripts/check-init.ts:1911)；[init-task-executor.unit.test.ts:928](../../harness/tests/unit/init-task-executor.unit.test.ts:928)、:777 |
| F09 | 发布件打包按 include-unless-excluded 规则，`agents/**` 整目录入包（现 manifest 含 `agents/claude/templates/agents/verifier.md`），`.toml` 不在排除名单 | [release-pack-rules.mjs:112–132](../../scripts/release-pack-rules.mjs:112)；`dist/framework-3.0.0.manifest.json` |
| F10 | verifier.md 正文无反斜杠、无 `'''`、无 `"""`；frontmatter description 单行、无单引号——可整段放进 TOML literal 多行字符串，零转义 | `grep -c` 统计 |
| F11 | codex adapter.yaml 注释"历史 init 曾误物化 Claude Stop/SubagentStop 协议脚本"与 F01 不符：是宿主手工提交带入，不是 init。清理逻辑只看路径不看来源，结论不受影响，但注释要改 | [codex/adapter.yaml:87](../../agents/codex/adapter.yaml:87) |
| F12 | Codex hooks 现状（供 D5 裁决）：0.153.4 `hooks stable true`；读项目层 `.codex/hooks.json` 与用户层 `~/.codex/hooks.json`，事件 10 个含 PreToolUse / Stop / SubagentStart / SubagentStop；JSON 形状与 Claude settings.json 的 hooks 段同形（Codex 自带从 `.claude` 迁移 hooks 的功能）；Stop 载荷含 `stop_hook_active`，阻断用 `decision:block`；PreToolUse 载荷 `tool_name` / `tool_input`，编辑工具名 `apply_patch`，拒绝用 `permissionDecision:deny`；**项目层 hooks 须 trusted 才执行**（`HookTrustStatus::Untrusted` 跳过），`codex exec` 有 `--bypass-hook-trust`。-br 宿主 `.codex/hooks.json` 的 Stop 注册用绝对路径指向**主宿主**的 5 月版脚本（v2.4，按 payload.cwd 解析根、无连续阻断逃生阀），主宿主的是 `{"hooks":{}}` | codex 源 `hooks/src/lib.rs` HOOK_EVENT_NAMES、`events/stop.rs:31`、`events/pre_tool_use.rs:31–34`、`app-server/src/config/external_agent_config.rs:360`、`core/src/session/tests.rs:9846`；两宿主 hooks.json |
| F13 | **角色文件的 sandbox_mode 只是默认值，spawn 时被父线程实时权限覆盖**：spawn 处理先 `apply_role_to_config(&mut config, role_name)`，紧接着 `apply_spawn_agent_runtime_overrides(&mut config, turn)`，后者把父 turn 的 `approval_policy`、`approvals_reviewer`、`shell_environment_policy` 与 `permission_profile` 直接写进子配置。Maison goal 的 codex 父进程恒为 `--sandbox danger-full-access`，所以 goal 路径下的 verifier 子线程是全权限，与 toml 写什么无关。09-07 冒烟父进程是 read-only，子线程只读由此而来（评审第 1 轮 P1） | codex 源 `core/src/tools/handlers/multi_agents/spawn.rs:111,122`、`multi_agents_common.rs:254–278`；[agent-invoke.ts:358](../../harness/scripts/utils/agent-invoke.ts:358) |

## 2. 非目标

- **不做** Codex 的 phase-executor 等价物：codex goal 走 external_runner（`codex exec` 进程本身就是阶段执行者），phase-executor 是 Claude 原生 /goal 薄 driver 的配套。
- **不做** codex 的 Stop hook 与写守卫（D5 记录裁决与复检触发）。
- **不做** verifier 子线程的物理只读隔离（F13）：不在 Maison 侧新造 spawn 前降权、不改 goal 父进程权限；只读靠 developer_instructions 硬性规则，与 5 月以来的实际状态一致。
- **不动** claude / codeagent 的 subagents 声明位置与模板（零 churn）；**不动** verifier.md 正文。
- **不做** 通用的"任意 md → 任意 adapter 格式"渲染框架；只有一个函数、一个输入、一个输出。
- **不做** Codex 侧 `model` 钉定（verifier.md 也没钉）。
- **不重复** 9eb3d293 已登记的 codex 残留 hook 清理；-br 宿主那条跨仓库 Stop 注册由它在 UPDATE 时摘除。
- **不改**宿主任何文件；宿主验收只读（§7）。

## 3. 决策纪要

### D0：保留的真源

verifier 的**正文真源仍是** `agents/claude/templates/agents/verifier.md`（claude-kernel 家族 SSOT，plan c7a9e2f4）。codex 的 toml 是它的**派生物**，提交进仓库但由脚本生成、由测试守护等值——任何人改了 verifier.md 而没重跑同步，unit test 立刻红。终态块契约的真源仍在 `harness/prompts/verify-*.md` → ai-prompt.md（F05），toml 只负责"审查员是谁、按 request 工作、默认只读"。

### D1：渲染函数 + 同步命令 + 派生文件（唯一的新代码）

新增 `harness/scripts/utils/codex-agent-toml.ts`：

```ts
export function renderCodexAgentToml(markdown: string): string
```

- 解析 frontmatter：`name`（必须为 `verifier`，否则抛错——本 plan 不承诺泛化）、`description`（单行）、`tools`（逗号分隔）。正文 = frontmatter 之后全部内容，EOL 归一为 LF，尾部恰好一个换行。
- `tools` ⊆ {Read, Glob, Grep} 时映射 `sandbox_mode = "read-only"`；出现其它工具名抛错（"verifier 只读集合已变，映射需人工重审"）——不猜、不静默降级。
- 输出固定骨架（顺序即文件顺序）：

```toml
# 生成文件：由 agents/claude/templates/agents/verifier.md 渲染（cd harness && npm run sync:codex-agents），勿手改。
# 等值由 harness/tests/unit/codex-adapter-verifier-template.unit.test.ts 守护（plan 7b2e9d4c）。
name = "verifier"
description = '''<frontmatter description 原文>'''
# verifier.md 的 tools: Read, Glob, Grep → 角色默认沙箱 read-only。
# 仅为默认值：Codex spawn_agent 会用父线程实时权限覆盖（goal 父进程为 danger-full-access），
# 不写盘的约束由下方 developer_instructions 的硬性规则承担（plan 7b2e9d4c D3）。
sandbox_mode = "read-only"
developer_instructions = '''
<verifier.md 正文原文>
'''
```

- 字符串一律用 TOML **literal** 多行 `'''`（无转义规则）；渲染前断言 description 与正文都不含 `'''`，含则抛错（F10 现状为零）。不引入 TOML 依赖（harness 无此依赖，F10 说明无需）。
- CLI 入口 `harness/scripts/sync-codex-agent-templates.ts`：读 verifier.md → 渲染 → 写 `agents/codex/templates/agents/verifier.toml`（LF）；`harness/package.json` 加 `"sync:codex-agents": "ts-node scripts/sync-codex-agent-templates.ts"`。
- 首次生成的 toml 随本 plan 提交。

放弃的方案：① init 时动态渲染（新增 templateFiles `kind`、planner/executor 都要认，改动面大，且宿主 UPDATE 前看不到产物）；② 只写等值测试、人肉同步（TOML 边界靠人记，第一次改 verifier.md 就会漏）；③ 手维护第二份正文（双源，正是本次事故的形态）。

### D2：schema 顶层 `subagents` + check-init 在 commands 块之外二选一收集

- `agents/adapter-schema.yaml` 新增顶层可选字段 `subagents`，字段与 `commands.subagents` 完全相同（target_dir / template_dir / update_policy），描述写明："无 slash 命令面的 adapter 在顶层声明；`commands.subagents` 是历史位置，语义相同；**同一 adapter 不得两处同时声明**（unit test 钉）"。`commands` 的描述补一句指向。
- [check-init.ts:672–690](../../harness/scripts/check-init.ts:672)：把子代理模板的 `collectDir` 调用**移出** `if (cfg.commands && typeof cfg.commands === 'object')` 块，放在其后：

```ts
const subagents = cfg.subagents
  ?? (cfg.commands && typeof cfg.commands === 'object' ? cfg.commands.subagents : undefined);
if (subagents && subagents.template_dir && subagents.target_dir) {
  collectDir(subagents.template_dir, subagents.target_dir,
    cfg.subagents ? 'subagents.template_dir' : 'commands.subagents.template_dir',
    parseUpdatePolicy(subagents.update_policy));
}
```

  只在原位置换成二选一表达式是不够的——`commands: null` 的 codex 根本进不了那个块（评审第 1 轮实施提醒）。`fieldLabel` 按来源区分，供 S1 探测表逐文件覆盖与 V3c 断言。`AdapterConfig` 类型加可选 `subagents`。
- `agents/codex/adapter.yaml`：新增

```yaml
subagents:
  target_dir: .codex/agents
  template_dir: templates/agents               # verifier.toml 由 claude verifier.md 渲染（plan 7b2e9d4c D1）
  update_policy: auto_overwrite                # 协议级子 agent 配置，与 claude 同款
```

  并把 F11 那句注释改为"宿主曾于 2026-05-25 手工提交（Cursor 会话）带入 Claude Stop/SubagentStop 协议脚本副本；先清旧注册再备份删除脚本"。`verifier_subagent: true` 的入册凭据补一行 09-07 冒烟（F04）。
- claude / codeagent 保持 `commands.subagents`，不动。

放弃的方案：给 codex 写 `commands: { subagents }` 而无 target_dir（违反 schema 字段类型，且"commands"对无 slash 的 adapter 是错名）；把三个 adapter 一起搬到顶层（多改两份 yaml 与相关测试，没有换来任何行为）。

### D3：`sandbox_mode = "read-only"` 只是角色默认值，实际权限随父线程

Claude 侧 `tools: Read, Glob, Grep` 是工具可见性；Codex 角色文件没有等价的工具白名单键，但它是一层 config（F06），`sandbox_mode` 可写。**它不构成隔离**：spawn 时父线程的实时权限覆盖角色配置（F13），goal 路径下父进程是 danger-full-access，子线程随之全权限。09-07 冒烟的子线程只读来自父进程 read-only，不是 toml 的功劳。

**决定**：仍写 `sandbox_mode = "read-only"`，定位为"角色默认值 + 意图声明"，文件内注释与 §5 都如实写明父线程覆盖；不写盘的实际约束由 developer_instructions 的硬性规则 1 承担（与 5 月以来的真实状态一致，宿主已在此状态下跑完多个 feature）。本轮**不**新造隔离机制、**不**改 goal 父进程权限、**不**在规格里写"物理只读"字样。

复检触发：若将来要物理只读，只有两条路——Codex 提供角色级不可覆盖的权限，或 Maison 在 spawn 前以只读父进程另起 verifier；届时按正式父进程权限（danger-full-access）做验证，不再拿只读父进程的冒烟当证据。

### D4：不做"非法 request 兜底"的 codex 专属话术

冒烟证明 codex 子代理按 request → prompt_path 工作（F04），verifier.md 里已有"收到的不是纯 request JSON 时照常审查但声明不可入闭环"一节，随正文一起进 toml。不再为 codex 另写话术。

### D5：hooks 能力——核实后不做（两项）

| 项 | 裁决 | 依据 | 放弃的准确性 | 复检触发 |
|---|---|---|---|---|
| Stop hook（check-phase-completion） | **不做** | goal 主路径是 `codex exec`，闭环由 harness + check-receipt 判；d2f7a9c4 刚删掉"hook 发布才算数"链路；项目层 hooks 还要过 trust 门槛（F12），宿主多一个信任动作或 exec 多一个旗标 | 交互式 codex 会话里"假完成"只有 rules 软约束，没有物理拦截 | 宿主出现一次 codex 交互会话把未闭环阶段报成完成的事故 |
| 写守卫（guard-framework-write） | **暂缓** | 技术上可行：走 cursor 的 `hooks_config` 结构化 upsert（`.codex/hooks.json` 是宿主共享文件，不能整文件覆盖），matcher `apply_patch`，判定核心复用 `framework/agents/shared/guard-framework-write-core.mjs`，只需薄壳解析 patch 文本里的路径。但目前没有 codex 改写 `framework/` 的事故记录 | codex 会话写只读发布件只有 rules 约束 | 宿主出现一次 codex 写入 `framework/` 的事故（porcelain 或 release:verify 抓到） |

两项都登记在 codex adapter.yaml notes（一行各），不另开待办。-br 宿主那条指向主宿主脚本的 Stop 注册（F12）由 9eb3d293 的 `hook_configs: [hooks.json]` 在 UPDATE 时摘除，本 plan 不重复。

### D6：规格与文档同步

- `agents/README.md`：两张矩阵的 codex 行补 `.codex/agents/verifier.toml`（生成物）；§"verifier 子代理声明"补一句"codex 的审查员人设由 claude verifier.md 渲染，只读仅为角色默认值"；目录树补 `codex/templates/agents/`。
- openspec change `codex-verifier-subagent-template`：`specs/agent-adapters/spec.md` **ADDED**「The Codex adapter ships a verifier subagent template rendered from the Claude verifier template」（SHALL exist、SHALL be rendered by `renderCodexAgentToml`、equivalence SHALL be test-enforced、SHALL declare read-only sandbox **as the role default only** and SHALL NOT be described as an isolation guarantee；scenario：UPDATE 备份后覆盖手写版 / verifier.md 改动未同步则 unit test FAIL）；**MODIFIED**「adapter subagent templates may be declared at adapter top level」（若现有 requirement 未提位置则为 ADDED，实施时 grep 定）。Enforcement 列 `agents/adapter-schema.yaml`、`agents/codex/adapter.yaml`、`harness/scripts/check-init.ts`、`harness/scripts/utils/codex-agent-toml.ts`。proposal/tasks 按 adhoc-device-entry-gate 同款结构。
- `MIGRATION.md` 3.0.x 一节：「Codex verifier 子代理模板收编」——UPDATE 起 `.codex/agents/verifier.toml` 由 framework 模板自动对齐（auto_overwrite，旧文件备份到 `.framework-backup/<stamp>/`）；宿主手写版被覆盖是预期行为；行为差异：verifier 按 request/prompt_path 契约工作、不再自读 verify-<phase>.md；`sandbox_mode` 只是角色默认值，goal 下子线程权限随父进程；宿主不应再手改该文件，要改人设改 verifier.md 并重新发布。

### D7：核实后不改（四项）

1. `verifier_subagent: true` 的语义与位置不变（只登记"能起子代理"，与模板无关；schema :426 明令不得由"有 subagents 模板目录"推断）。
2. codeagent 的跨目录共享方式不变。
3. 9eb3d293 的 deprecated_artifacts 不加 `agents/verifier.toml`：它现在是受管模板，不是退役物。
4. `harness/prompts/verify-*.md` 与 ai-prompt 装配不变。

## 4. 文件与提交边界

| 提交 | 文件 |
|---|---|
| 0 `docs(plan): Codex verifier 模板收编施工图（plan 7b2e9d4c）` | 本 plan（评审通过后先提交基线） |
| 1 `feat(adapters): codex verifier 子代理模板由 claude verifier.md 渲染 + 顶层 subagents 声明（plan 7b2e9d4c D1/D2/D3）` | `harness/scripts/utils/codex-agent-toml.ts`、`harness/scripts/sync-codex-agent-templates.ts`、`harness/package.json`、`agents/codex/templates/agents/verifier.toml`（生成）、`agents/codex/adapter.yaml`、`agents/adapter-schema.yaml`、`harness/scripts/check-init.ts`、`harness/tests/unit/codex-adapter-verifier-template.unit.test.ts`、`harness/tests/unit/adapter-catalog-consistency.unit.test.ts` |
| 2 `docs(adapters): codex verifier 模板与 hooks 裁决同步规格、README、MIGRATION（plan 7b2e9d4c D5/D6）` | `agents/README.md`、`openspec/changes/codex-verifier-subagent-template/**`、`MIGRATION.md`、本 plan 实施记录 |

提交 1/2 须在 codex review 通过后再打（[先 review 再提交]），不署名；不跑宿主。

## 5. 接受的准确性边界（放弃的准确性）

1. **toml 是提交进仓库的派生物，不是 init 时渲染**：verifier.md 改动后必须重跑同步命令；漏跑由 unit test 抓，不由运行时抓。换来 init/planner/executor 零改动。
2. **没有物理只读**：`sandbox_mode = "read-only"` 只是角色默认值，spawn 时被父线程实时权限覆盖（F13）；goal 下 verifier 子线程是 danger-full-access，"不写盘"靠 developer_instructions 的硬性规则。与 Claude 侧"看不到写工具"不等价。本轮不新造隔离（D3）。
3. **不做 Stop hook**：codex 交互会话的"假完成"只有软约束（D5）。
4. **宿主手写 toml 被无提示覆盖**（auto_overwrite）：宿主若曾在 toml 里加过自己的话术会丢（有备份）。MIGRATION 写明。
5. **冒烟只做了一次、一个阶段（testing）、且父进程只读**：结论"过期 toml 仍能过"是单样本；本 plan 的动机不依赖它（多读三份文件、旧路径、无非法 request 处置都是静态可见的差异）。
6. **生成与覆盖行为在临时工程用真实执行入口验证（V3a–V3c），宿主真实 UPDATE 仍是宿主验收项**：前者证明机制正确，后者证明宿主环境（trusted、备份目录、S3 run-log）没有意外。

## 6. 验收用例

| 编号 | 用例 | 判据 |
|---|---|---|
| V1 | 等值 / 漂移（`codex-adapter-verifier-template.unit.test.ts`） | `renderCodexAgentToml(read(verifier.md))` 与磁盘上 `agents/codex/templates/agents/verifier.toml`（EOL 归一后）逐字节相等；把 verifier.md 正文改一个字符再渲染 → 与磁盘不等（证明测试真的在比正文，不是只比骨架） |
| V2 | 转义与结构 | 渲染结果：`name = "verifier"`、`sandbox_mode = "read-only"` 且其上一行注释含"默认值"与"父线程"字样、`description = '''…'''` 恰为 frontmatter 原文、`developer_instructions = '''` 与 `'''` 之间恰为正文原文；正文或 description 含 `'''` 时抛错；`tools` 含 `Write` 时抛错；frontmatter `name` ≠ verifier 时抛错；输出以 LF 结尾且无 CRLF |
| V3a | **首次生成**（临时工程 + 真实执行入口，复用 [init-task-executor.unit.test.ts:777](../../harness/tests/unit/init-task-executor.unit.test.ts:777) 的写法） | `mkTmp()` 写 `framework.config.json`（`materialized_adapters: ['codex']`），**不预置** `.codex/agents/verifier.toml`；`executeInitTask({ id: 'materialize-adapter:codex', … }, 'run', ctx)` 后：`.codex/agents/verifier.toml` 存在且与 `agents/codex/templates/agents/verifier.toml` 逐字节相等；`file_results` 含该 targetRel 且 effect 为 created；无 `.framework-backup/` 目录 |
| V3b | **旧 toml 备份后覆盖 + 幂等**（同 :928 的写法） | 预置 5 月契约内容（取 F02 片段）到 `.codex/agents/verifier.toml`；`executeInitTask({ id: 'sync-auto-overwrite:.codex/agents/verifier.toml', category: 'adapter-template-sync', … }, 'run', ctx)` 后：文件与模板逐字节相等；`file_results[0].targetRel` 为该路径且 effect 为 updated；返回 `message` 含"备份"；`.framework-backup/<stamp>/.codex/agents/verifier.toml` 存在且逐字节等于预置的旧内容。**再执行一次**：文件不变、effect 为 unchanged、`.framework-backup/` 下不新增目录 |
| V3c | **planner 真的会产出这条任务**（复用 `adapter-catalog-consistency` 对 `probeInitTaskPlan` 的用法） | 临时工程（`materialized_adapters: ['codex']`）预置旧 toml → `probeInitTaskPlan` 的任务表含 `sync-auto-overwrite:.codex/agents/verifier.toml`（`params.update_policy = 'auto_overwrite'`），且**不含** `materialize-adapter-file:.codex/agents/verifier.toml`；不预置时同样含 sync 任务（缺失即写入）。同时 `__testing.loadAdapter('codex').templateFiles` 该条目 `kind: 'verbatim'`、`origin` 以 `subagents.template_dir/` 开头；`loadAdapter('claude')` / `('codeagent')` 的 verifier.md / phase-executor.md 条目不变（origin 仍 `commands.subagents.template_dir/…`） |
| V4 | 二选一一致性（扩 `adapter-catalog-consistency`） | 遍历 `agents/*/adapter.yaml`：不存在同时声明顶层 `subagents` 与 `commands.subagents` 的 adapter；codex 顶层 `subagents.update_policy === 'auto_overwrite'`；codex `commands === null` 保持 |
| V5 | 发布件 | `npm run candidate:build`（或既有 release:verify 路径）后 manifest 含 `agents/codex/templates/agents/verifier.toml`；`scripts/verify-release-pack.mjs` 通过 |
| V6 | openspec | `npm run openspec:validate` 全 PASS |

宿主验收（§7）不入本表。

## 7. 命令与完成判据

开发期间按变更跑目标检查，不重复全量：

```bash
cd harness && npm run typecheck
```

```bash
cd harness && npx ts-node --transpile-only tests/run-unit.ts codex-adapter-verifier-template
```

收尾**一次**全量（含 typecheck、unit、fixtures）+ openspec + LF 扫描（node 扫，按 07a41ec6 惯例）：

```bash
cd harness && npm test
```

```bash
npm run openspec:validate
```

**宿主验收**（本 plan 完成判据之外；触发方式按用户当时授权——09-07 用户已对"verifier 冒烟"授权过一次，正式验收前再确认一次）：

1. 集成候选件 → `framework-init` UPDATE → 观察 S3 run-log 记录 `.codex/agents/verifier.toml` 自动对齐且备份目录含旧文件；`diff` 宿主文件与发布件模板逐字节相等。
2. 同款只读冒烟（scratchpad `verifier-smoke-prompt.txt` 的做法：`codex --ask-for-approval never exec --sandbox read-only --json < prompt`，request 取当时最新的 `verifier.request.<subject>.json`）：回复末尾恰好一个终态块且 `parseResultBlock` 成功；宿主 porcelain 前后一致。
3. 子线程 rollout（`~/.codex/sessions/<date>/rollout-*-<child>.jsonl`，`agent_role=verifier`）：**不再**出现 `verify-<phase>.md` / `phase-rules` 读取——这是新 toml 生效的直接证据。不再把"子线程沙箱为 read-only"当验收项（F13：只读父进程下必然成立，证明不了 toml）。

**完成 = V1–V6 全绿（含 V3a–V3c）+ 一次全量 `npm test` 全绿 + 提交 1/2 经 codex review 通过并落盘。** 宿主验收结果回灌 §8。

## 8. 修订记录

### 2026-09-07：施工图（未评审、未实施、未提交）

依据 09-07 会话：宿主 toml 来源核实（F01）、两宿主对比（F02）、主宿主只读冒烟（F04/F05）、Codex 0.153.4 hooks/multi_agent 能力核实（F06/F12）。hooks 裁决为 Stop 不做、写守卫暂缓（D5）。

### 2026-09-07：评审第 1 轮（两处修订 + 一处实施提醒，全部采纳）

- **P1 只读沙箱钉定不成立**：Codex spawn 先套角色配置再用父线程实时权限覆盖（`apply_role_to_config` → `apply_spawn_agent_runtime_overrides`，写入 approval_policy 与 permission_profile），goal 父进程是 danger-full-access；只读父进程的冒烟证明不了 toml。→ 新增 F13；D3 改为"角色默认值 + 意图声明，不构成隔离，本轮不新造隔离机制"；标题、overview、toml 内注释、D6 规格措辞（不得写成保证）、§5-2、§7-3 同步修正；文件名从"只读沙箱钉定"改为"verifier.md派生"。
- **P2 本地验收只证清单有文件**：原 V3 只看 `loadAdapter().templateFiles`，生成与覆盖全在完成判据之外。→ 拆为 V3a（`materialize-adapter:codex` 首次生成）、V3b（`sync-auto-overwrite:<target>` 旧 toml 备份后覆盖 + 幂等）、V3c（`probeInitTaskPlan` 产出同步任务 + 清单条目），全部在临时工程用真实执行入口跑，复用 init-task-executor.unit.test.ts :777 / :928 与 adapter-catalog-consistency 的既有写法；完成判据明写含 V3a–V3c；§5 新增第 6 条说明本地验证与宿主验收的分工。
- **实施提醒（D2）**：子代理模板收集必须移出 `if (cfg.commands …)` 块，`commands: null` 的 codex 才进得去；只在原位置换二选一表达式无效。→ D2 改为块外收集并给出代码形态；F07 补写块的条件。
