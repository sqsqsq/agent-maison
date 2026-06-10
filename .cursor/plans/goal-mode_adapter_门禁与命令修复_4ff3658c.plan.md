---
name: goal-mode adapter 门禁与命令修复
overview: 修复 goal-mode 入口缺失的 adapter 选择门禁与 Cursor 无头命令错误（cursor agent --print），让 adapter 选择遵循"显式指定 > framework.local.json > 引导建立"，把"命令不存在/未配置/adapter 未物化"从跑一轮后 HALT 提前到 preflight BLOCKER；并修 Windows 下 shell:false spawn .cmd 垫片的坑。绑定在研版本 2.3.0。
version: 2.3.0
todos:
  - id: verify-host-cli
    content: 「动手前 P0 实测」宿主机跑 cursor-agent --help / agent --help 确认 primary 二进制名、-p 是否已含 write/shell、放行写盘 flag 名（--force/--yolo？）、是否支持 stdin/@file 传 prompt；where/PATHEXT 定位 .cmd vs .exe（决定 cross-spawn 还是 stdin 方案）
    status: completed
  - id: fix-cursor-headless-cmd
    content: cursorArgv 改签名收 unattended；二进制解析器 cursor-agent→agent 回落（与真实 spawn 同一套解析）；flag 按 P0 实测落（-p [+ 写盘 flag]）；agents/cursor/adapter.yaml headless_invoke 同步 + 双 SSOT 注释；新增 cursor 的 argv 单测
    status: completed
  - id: windows-spawn-fix
    content: invokeAgentHeadless（agent-invoke.ts shell:false）Windows 化——禁用 shell:true（破坏 PROMPT_ARGV_SENTINEL prompt 安全 + Node CVE-2024-27980 堵 .cmd）；首选 stdin/prompt-file 传 prompt（免新依赖、prompt 不进 shell），cross-spawn 兜底（若用则补 harness/package.json 依赖+lock+release 验收）；preflight 可解析校验与真实 spawn 同语义
    status: completed
  - id: goal-runner-preflight-adapter-aware
    content: 重写 preflight：收 projectRoot + adapter provenance（enum：argv_adapter|manifest_adapter|config_local|config_legacy|fallback）；校验 manifest.adapter ∈ materialized_adapters + 入口存在 + capability；仅 fallback 才 fallback BLOCKER（显式/manifest/resume 已物化必须放行，修
    status: completed
  - id: goal-mode-skill-precondition
    content: goal-mode/SKILL.md 前置加 Personal setup（BLOCKER）；按 check-personal-setup --ensure 的 code 分流；needs_adapter_choice 走 init-orchestrate --scope personal record-adapter（经 executionContext.activeAdapter 写 local，非仅传 --adapter，禁手写 JSON），single → --ensure 自写
    status: completed
  - id: goal-mode-user-adapter-input
    content: goal-mode/SKILL.md 解析输入加可选 adapter：显式→校验已物化+入口存在→映射 --adapter；未物化→STOP 引导 /framework-init（澄清 local.json 个人配置可写、项目产物不可写）
    status: completed
  - id: openspec-delta
    content: 写 OpenSpec change delta（goal-runner preflight + goal-mode-skill 行为契约变化，非纯文档），npm run openspec:validate PASS；实施后 archive
    status: completed
  - id: tests-docs-release
    content: 补 preflight adapter-aware 各分支 / Windows 解析 / cursorArgv 单测；更新 goal-mode-runbook；cd harness && npm test 全 PASS；若采用 cross-spawn 则验收发布件含该依赖（release:verify + install）；重新打包另跑 npm run release:verify
    status: completed
isProject: false
---

# goal-mode adapter 选择门禁 + Cursor 无头命令修复

> 版本绑定（dev-only SSOT）：`package.json.version = 2.3.0`，本 plan frontmatter `version: 2.3.0`。
> 本版已综合 Codex + Claude 两份 review 修订（见文末「Review 修订摘要」）。

## 背景

宿主工程（Windows / Cursor）跑 goal 模式时 `goal-runner` 直接 `HALTED`，根因有两层：

1. **命令名错且无法被 yaml 覆盖**：cursor 适配器配的是 `cursor agent --print`，但 `cursor` 只是 IDE 启动器（无 `agent` 子命令）；真正的无头 CLI 官方名为 `cursor-agent`（本机实测只有 `agent` 可解析，`cursor-agent` 不在 PATH）。且 cursor 属于 `KNOWN_STRUCTURED_ADAPTERS`，运行时**走 `cursorArgv` 硬编码、忽略 `adapter.yaml` 的 `headless_invoke`**（[agent-invoke.ts:22](harness/scripts/utils/agent-invoke.ts) / [:76](harness/scripts/utils/agent-invoke.ts) / [:177](harness/scripts/utils/agent-invoke.ts)），故仅改 yaml 无效。
2. **adapter 选择门禁没接到 goal-mode 入口**：`check-personal-setup --ensure` / `evaluatePersonalSetupGate` 机制完整且在 feature phase 入口是 BLOCKER（[harness-runner.ts:282-293](harness/harness-runner.ts)），但 [goal-mode/SKILL.md:27](skills/project/goal-mode/SKILL.md) 前置只列 Tier_1 + cwd，`goal-runner` preflight（[goal-runner.ts:159-171](harness/scripts/goal-runner.ts)）也不校验，导致无 `framework.local.json` 时静默回落 `generic`（[goal-runner.ts:222](harness/scripts/goal-runner.ts)）、先 spawn 错 agent，门禁要到 per-phase harness 才触发。

## 目标行为（与用户设想一致）

- 显式指定 agent → 校验该 adapter 已物化且入口存在 → `--adapter` 直传（**即使无 local.json 也放行**）。
- 未指定 → 用 `framework.local.json` 的 `agent_adapter`（local > project_legacy）。
- 非显式且两者都无（`source=fallback`）→ **进 runner 前**完成 `framework.local.json`：单一物化自动写、多物化交互选、零物化 STOP。
- 交互发生在 **SKILL（聊天层）**；`goal-runner`（无头）只做确定性 BLOCKER 兜底，不静默回落。

## 改造点

### 0. 动手前 P0 实测（todo: verify-host-cli）

凭记忆写 CLI flag 是 review 点名的高风险项，先在宿主机实测并记录到 plan「实施记录」：

- `cursor-agent --help` 与 `agent --help`：确认 **primary 二进制名**（倾向官方 `cursor-agent` 主、`agent` 回落）、`-p/--print` 是否**已包含 write/shell**（本机 `agent --help` 截图提示 "including write and shell"，则 `--force` 可能冗余）、放行写盘的确切 flag（`--force` / `--yolo` / 无）、**是否支持 stdin 或 `@file` 传 prompt**（决定改造点 2 走 stdin 方案）。
- `where agent` / `where cursor-agent` + 后缀（`.exe` vs `.cmd`/`.bat`）：决定 Windows spawn 走 **cross-spawn** 还是 **stdin/prompt-file**（见改造点 2，二者都保持 `shell:false` 语义）。

**结论未定前不写死 `--force`、不写死 primary 名、不写死 prompt 传递方式。**

### 1. 修 Cursor 无头命令（真正落点 = cursorArgv）

- [agent-invoke.ts](harness/scripts/utils/agent-invoke.ts) `cursorArgv`（当前 `cursorArgv(prompt)` 仅收 prompt，[:76](harness/scripts/utils/agent-invoke.ts)）**改签名收 `unattended`**，按 P0 实测决定是否追加写盘 flag。
- 二进制名解析器：**`cursor-agent` 优先、`agent` 回落**（与改造点 2 的真实 spawn 用**同一套**解析），PATH 不可解析返回明确错误供 preflight 用。可选：露出 binary 覆写口（因 cursor 是 KNOWN_STRUCTURED，宿主无法用 yaml 覆盖二进制名）。
- [agents/cursor/adapter.yaml:30](agents/cursor/adapter.yaml) `headless_invoke` 同步为实测命令（如 `cursor-agent -p [写盘flag] "{{PROMPT}}"`），并加注释：**双 SSOT 中 runtime 以 `cursorArgv` 结构化 argv 为准，yaml 仅供 capability 校验**。
- **新增**（非"更新"）cursor 的 argv 单测（现 [goal-runner-phase.unit.test.ts](harness/tests/unit/goal-runner-phase.unit.test.ts) 只测 claude/codex）。

### 2. Windows spawn .cmd 垫片修复（todo: windows-spawn-fix）

- 宿主是 win32，[agent-invoke.ts](harness/scripts/utils/agent-invoke.ts) `invokeAgentHeadless` 用 `spawnSync(plan.argv[0], …, { shell: false })`——Windows `CreateProcess` 找得到 `.exe` 但找不到 `.cmd/.bat` 这类 npm shim，若 `cursor-agent`/`agent`/`claude` 是 `.cmd` 垫片则改了命令名也照样 ENOENT。
- **`shell:true` 不是合法解法（删除该分支）**，两头夹击：
  1. 整套结构化 argv 设计（`PROMPT_ARGV_SENTINEL`，[agent-invoke.ts:19-20](harness/scripts/utils/agent-invoke.ts)）就是为把多行 markdown prompt（含反引号/引号/换行/`&|<>%`，见 [goal-runner.ts:136-157](harness/scripts/goal-runner.ts) 拼的 prompt）当**单个 argv 元素**安全传入；`shell:true` 会让 cmd.exe 重新解析命令行 → prompt 特殊字符断句/注入。
  2. 反过来 Node 18.20+/20.12+ 起（CVE-2024-27980 修复），带参数 spawn `.cmd/.bat` 在 `shell:false` 下直接抛错；故"PATHEXT 解析到 `.cmd` + 保持 shell:false"也被 Node 堵死。
- **干净解法（P0 实测时定，按优先级）**，两者都保持 `shell:false` 语义、prompt 安全：
  - **首选 stdin / prompt-file**：argv 不带 prompt，prompt 经 stdin 或 `@file` 传入（`prompt.md` 已落盘，[goal-runner.ts:307-309](harness/scripts/goal-runner.ts)），prompt 永不进 shell，从根上绕开 "Windows .cmd + 长 prompt" 双坑，**且不引入新依赖**（harness 现为清一色 Node 内置 `child_process`，[package.json:30-34](harness/package.json) 仅 yaml/chalk/minimist）。P0 的 `cursor-agent --help` 确认是否支持 stdin/`@file`。
  - **兜底 `cross-spawn`**（仅当 P0 实测 cursor-agent 不吃 stdin/`@file`）：内部对 Windows `.cmd` 正确转义、调用方仍 shell:false；**但属新增 runtime 依赖**——须 `harness/package.json` `dependencies` 增 `cross-spawn` + 更新 lock + 确认 `release:pack` 打进发布件 + install 验收（否则消费者在 `framework/harness` 安装时漏包，发布件运行时缺依赖）。
  - 注：[goal-runner.ts:127-129](harness/scripts/goal-runner.ts) 的 `npx.cmd`+`shell:win32` 先例**不能照搬到 prompt**——它参数全是 `--phase prd`、feature slug 这类简单 token 才安全；invokeAgentHeadless 要传多行 markdown prompt，正是 shell 不能用的原因。
- **关键**：preflight 的"二进制可解析校验"必须与真实 spawn **同一套解析语义**（参照 [goal-runner.ts:127-129](harness/scripts/goal-runner.ts) harness 的 `npx.cmd`+`shell:win32` 已知坑），避免 "preflight 放行→真跑挂" 或 "preflight 误杀"；但**不拿 `shell:true` 当合法分支**。

### 3. goal-runner preflight 改为 adapter-aware / source-aware（todo: goal-runner-preflight-adapter-aware，重写原 gate 方案）

> 修两份 review 共同点名的 **BLOCKER #1**：原方案"无条件 `evaluatePersonalSetupGate(projectRoot)`"会打死合法的显式 `--adapter` 路径——该函数不看 `manifest.adapter`，从 local/project 自行推导 active adapter（[personal-setup-gate.ts:144-148](harness/scripts/utils/personal-setup-gate.ts)），无 local 时 `source=fallback` 直接判负（[framework-local-config.ts:118-123](harness/scripts/utils/framework-local-config.ts)）。

- [goal-runner.ts](harness/scripts/goal-runner.ts) `main()` 记录 **adapter provenance（enum，非布尔）**：`argv_adapter`（`--adapter`）| `manifest_adapter`（`--manifest`/`--resume` 文件来源）| `config_local`（framework.local.json）| `config_legacy`（项目 legacy）| `fallback`（无 local 无 legacy 的 generic 回落）；`preflight` 签名加 `projectRoot` 与 `provenance`。
  - 修 **B**：`adapterExplicit = Boolean(argv.adapter)` 会把 `--manifest`/`--resume`（adapter 来自文件、`argv.adapter` 为空）误判为"非显式"，常态下若本机无 local.json（`source=fallback`）会误拦一次续跑。改用 provenance enum 后，**只有 `fallback` 才触发 fallback guard**。
- preflight 校验**目标是 `manifest.adapter` 本身**（新增 helper，复用 [personal-setup-gate.ts](harness/scripts/utils/personal-setup-gate.ts) 的 `resolveProjectMaterializedForGate`；**`adapterEntryExists`（[:105](harness/scripts/utils/personal-setup-gate.ts)）当前模块私有，实现时先 `export`**）：
  1. `manifest.adapter ∈ materialized_adapters`；
  2. 该 adapter 入口产物存在；
  3. `validateGoalCapabilityForRunner`（保留现有）。
  任一不满足 → BLOCKER（显式/manifest 未物化 → 引导 init；回落 generic 但 host 只物化 cursor → generic∉materialized → BLOCKER）。
- **fallback guard**：仅 `provenance==='fallback'` 才抛 "请先 check-personal-setup --ensure" BLOCKER；**显式 `--adapter`、`--manifest`、`--resume` 指向的 adapter 只要已物化即放行**（不依赖 SKILL 是否写过 local）。
- 二进制可解析校验（与改造点 2 同语义）；`--dry-run` 降级为 WARN。

### 4. goal-mode SKILL 前置补 personal-setup-gate（todo: goal-mode-skill-precondition）

- [goal-mode/SKILL.md:27](skills/project/goal-mode/SKILL.md) 前置加 **Personal setup（BLOCKER）**：启动 runner 前 `check-personal-setup.ts --json --ensure`，仅解析 JSON，按 `code` 分流：
  - `ok` → 继续；
  - `needs_adapter_choice` → 走 registry `setup.adapter` 交互选，**选后由 [init-orchestrate.ts](harness/scripts/init-orchestrate.ts) `--scope personal` 的 `record-adapter` 任务写 `framework.local.json`**。注意 `record-adapter` 依赖 `executionContext.activeAdapter`（[init-task-executor.ts:481-486](harness/scripts/utils/init-task-executor.ts)，缺则报错），**选中的 adapter 须经 decision/context 写入 `activeAdapter`，不能只传 `--adapter`**（`--adapter` 当前主要是 runner 的 probe hint）；**禁 agent 手写 JSON**；过程见 [personal-setup-gate.md](skills/reference/personal-setup-gate.md) S1–S3；
  - 单一物化 → `--ensure` 已确定性自写 local（[personal-setup-gate.ts:226-250](harness/scripts/utils/personal-setup-gate.ts)）；
  - `no_materialized_adapter` / `not_in_materialized` / `entry_not_materialized` → STOP 引导 `/framework-init`。
- 措辞与 feature phase SKILL（[requirement-design/SKILL.md:11](skills/feature/requirement-design/SKILL.md)）对齐；goal-mode 因含交互分支，比 feature 那句 "--ensure；仅解析 JSON" 更细。

### 5. goal-mode 面向用户的"指定 agent"输入（todo: goal-mode-user-adapter-input）

- [goal-mode/SKILL.md:21](skills/project/goal-mode/SKILL.md)「解析用户输入」加可选 `adapter`：显式（如"用 cursor 跑 goal"）→ 校验 ∈ `materialized_adapters` 且入口存在 → 映射 `--adapter`；否则回落 local 解析。未物化 → STOP 引导 init。
- **澄清边界**：写 `framework.local.json`（个人、gitignored 配置）由 `record-adapter` 完成，**属允许**；"不写项目产物"约束指 `.cursor/**`、`framework.config.json`、物化清单——二者不混为一谈。

### 6. OpenSpec 行为契约（todo: openspec-delta）

- preflight 语义与 goal-mode 前置变化属**行为契约**（非纯文档）：写 OpenSpec change delta（`openspec/changes/<id>/` 含 goal-runner / goal-mode-skill spec delta），`npm run openspec:validate` PASS；实施完成后 archive 落活跃 spec。

### 7. 测试 / 文档 / 发布（todo: tests-docs-release）

- 单测：
  - preflight adapter-aware 各分支（显式已物化放行 / **manifest|resume 已物化放行** / 显式未物化 BLOCKER / `provenance=fallback` BLOCKER / 回落 generic∉materialized BLOCKER）；
  - 二进制解析（Windows .cmd 经 cross-spawn 或 stdin / 不可解析）；
  - cursor argv（新增）。
- 文档：[goal-mode-runbook.md](docs/operations/goal-mode-runbook.md) 增"adapter 选择与 personal setup 前置"。
- 验收：`cd harness && npm test` 全 PASS；**若重新打包发布** zip，另跑 `npm run release:verify`。

## 设计决策

- **Cursor 命令名**：官方 `cursor-agent` 主、`agent` 回落（不再 `cursor agent`）；最终 flag 以 P0 实测为准。
- **preflight 不用 bare gate**：改为校验 `manifest.adapter` 本身 + provenance，从根上避免显式路径被误杀。
- **解析单一来源**：preflight 校验与真实 spawn 共用一套二进制解析（含 Windows）；**Windows 不用 `shell:true`**，**首选 stdin/prompt-file（免新依赖）**、cross-spawn 兜底。
- **交互归属**：多 adapter 选择只在 SKILL 聊天层；`goal-runner` 不交互。
- **不扩大 scope**：不动 `materialized_adapters` 物化逻辑、不动 `/framework-init`、不动其它 adapter 的 `*Argv`。

## 验收标准

- 显式 `--adapter cursor`（cursor 已物化）即使无 `framework.local.json` 也能启动，不被门禁误杀。
- 非显式且 `source=fallback` → preflight BLOCKER 明确报错；多物化经 SKILL 交互写 local 后可跑；零物化 STOP 引导 init。
- 配 cursor 真跑：实测命令（`cursor-agent`/`agent` `-p` [+写盘flag]）被正确 spawn（含 Windows `.cmd`），不再 `cursor agent --print`。
- 命令不存在/adapter 未物化 → preflight BLOCKER，**不再**跑一轮后才 HALTED。
- `cd harness && npm test` 全 PASS；`npm run openspec:validate` PASS。

## Review 修订摘要（v1 → v2）

- **[BLOCKER] preflight 重写**：原"无条件 `evaluatePersonalSetupGate(projectRoot)`"→ 改为 adapter-aware（校验 `manifest.adapter` ∈ materialized + 入口 + capability）+ provenance（仅非显式且 fallback 才拦），修复显式 `--adapter` 被误杀（Codex #4 / Claude #1）。
- **[新增] Windows spawn 修复**：`invokeAgentHeadless` 的 `shell:false` 在 win32 不认 `.cmd` 垫片，且 preflight 校验须与真实 spawn 同语义（Claude #2）。
- **Cursor 二进制**：`agent` 主 → 改 `cursor-agent` 主、`agent` 回落（Codex #2 / Claude #3）。
- **[新增] P0 实测前置**：`-p` 是否已含 write/shell、写盘 flag 名先实测再写代码（Claude #4，本机 help 截图佐证）。
- **needs_adapter_choice 写 local 路径**：明确走 `record-adapter`（`init-orchestrate --scope personal`），禁手写 JSON（Codex #5）。
- **adapter.yaml 同步 + 双 SSOT 注释**；**frontmatter 补 `version: 2.3.0`**（两份均点名）。
- **新增 OpenSpec delta**：行为契约变化（Codex 建议）。
- **措辞修正**：cursor argv 单测为"新增"非"更新"；澄清 `framework.local.json`（个人配置）非"项目产物"（Claude #5）。

### v2 → v3（第二轮 review）

- **[真实风险 A] Windows 删 `shell:true` 分支**：会破坏 `PROMPT_ARGV_SENTINEL` 的 prompt 安全（cmd.exe 重解析）；且 Node CVE-2024-27980 后 `shell:false` 带参 spawn `.cmd` 直接抛错 → PATHEXT 解法也不通。改 **cross-spawn 或 stdin/prompt-file**（Claude A）。
- **[B] provenance 扩为 enum**：`Boolean(argv.adapter)` 漏掉 `--manifest`/`--resume`（adapter 来自文件）→ 会误拦续跑；改 enum，仅 `fallback` 触发 guard（Codex P1 / Claude B）。
- **[B'] `record-adapter` 依赖 `activeAdapter`**：needs_adapter_choice 选中后须经 context 写 `executionContext.activeAdapter`，非仅传 `--adapter`（Codex P2）。
- **[C] 导出 `adapterEntryExists`**：现为模块私有，实现时先 `export`（Claude C）。
- P0 实测追加 **stdin/`@file` 支持**确认（服务于 A 的 stdin 方案）。

### v3 → v4（第三轮 review）

- **Windows 方案优先级对调**：`cross-spawn` 首选 → 改 **stdin/prompt-file 首选、cross-spawn 兜底**（Claude）。理由：harness 现为清一色 Node 内置 `child_process`，stdin 免新依赖且 prompt 永不进 shell；`npx.cmd`+`shell:win32` 先例参数是简单 token，不能照搬到多行 prompt。
- **cross-spawn 依赖说明**：若兜底采用，须补 `harness/package.json` 依赖 + lock + `release:pack` 打包 + install 验收（Codex），否则发布件运行时缺包。
