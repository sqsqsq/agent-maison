# Goal 模式运行手册（维护者 / agent 参考）

> **宿主入口 SSOT**：[goal-mode/SKILL.md](../../skills/project/goal-mode/SKILL.md)（slash `/goal-mode` 或自然语言「目标模式 / 全自动」；**禁止**要求用户手跑 harness）。
> 裁决 SSOT：[phase-transition-policy.ts](../../harness/scripts/utils/phase-transition-policy.ts)（`goal_mode` **优先于** `batch_authorized`）

## 概述

`GoalPhaseRuntime` 是 Maison 工具无关的唯一 phase 生命周期：按 workflow 派生 chain，统一负责 owner/epoch、assess、attempt、runtime facts、receipt/gate、verdict、回退与封口。`goal-runner` 只是 detached CLI/process shell；有人在场与无人值守仅在 executor transport（宿主回调 / adapter spawn）上不同。运行证据落在 `doc/features/<feature>/goal-runs/<run-id>/`。

## 3.0 调和模型：一个循环、两个运行方式

interactive session 与 detached `goal-runner` 现在共用：

- 冻结的 `PhaseExecutionContext`（run/workflow/track/chain/phase/attempt/owner fence/baseline）；
- 同一个 `GoalPhaseRuntime` 生命周期与 owner 前后 fence；
- 生产纯函数 `projectCanonicalLifecycle(events)` 的规范投影（executor/stdio/lease 遥测不入投影）。

```text
assess@1 → GoalPhaseRuntime authorize/guard → executor transport → gate/verdict → reassess
```

`assess@1` 是唯一跨 phase 推荐源；`GoalPhaseRuntime` 保留 timeout、预算/backoff、cleanup、pass-snapshot、device、source-write、trust、monitor、usage 与 detach 存活等 guard。executor 只传输 phase 调用。详见 [reconcile-loop.md](../concepts/reconcile-loop.md)。

用户只选择：

| 运行方式 | 行为 |
|---|---|
| 有人在场 | 自动推进；遇到 human-only waiting item 立即询问 |
| 无人值守 | 自动推进；waiting item 停放，run 可 detach/resume |

明确自然语言意图直接映射；歧义走 registry `goal.run_mode`；CLI `--detach` 恒为无人值守。菜单不得出现 `in-session`、`headless` 或 capability tier。

### Adapter capability 与降级

adapter root `goal_capability` 新增：

- `in_session_reconcile`
- `phase_context_isolation`
- `supports_resume`
- `handoff: none | to_detached | bidirectional`

in-session 自治必须同时声明 reconcile 与 phase context isolation；缺失时降级为手动 harness+assess。无人值守仍要求 external runner preflight。handoff 还要求 resume 能力。

### Run control 与 handoff

每个权威 run 持久化 `run-control.json`（`run-control@1`）。`current_epoch` 单调递增且 owner 释放后保留；所有 assess、phase invoke、harness/finalizer、event/progress/manifest 写入与终态发布都须通过 fencing。

非 orphan 的 session 与 detached process 切换使用原子 mailbox。requester 只写 request；当前 owner 在 phase verdict 边界写 `handoff_requested`、quiesce、释放；新 owner 以 `epoch+1` CAS 后写 `handoff_accepted`。两者继续使用同一 `run_id` 和 events ledger。仅 `orphaned_session` 可由用户显式授权 force takeover；supervisor 永不得触发该例外。

原生 Claude/Codex `/goal` 仅为可选加速层；闭环裁决以 harness `summary.json` + runner 为准。

## 宿主怎么用（产品面）

| 入口 | 说明 |
|------|------|
| `/goal-mode <feature> [需求]` | Claude slash（路由到 Skill） |
| 自然语言 | 「目标模式 / 全自动 / 无人值守全自动」→ agent 读 goal-mode Skill |
| Codex/Cursor/generic | skills-bridge 跳板（skill id `goal-mode`）→ 完整 Skill |

「全链路 / 从 spec 到真机」等属于 **batch_authorized**（对话内多 phase），不是 goal 模式触发词。

用户**不**直接执行 `goal-runner`；主 agent 按 Skill 内「Agent 必须执行」自跑。

## 维护者 / CI 调试（非宿主默认路径）

```bash
cd framework/harness && npx ts-node scripts/goal-runner.ts \
  --feature <feature-slug> \
  --requirement "需求描述" \
  --adapter claude \
  --dry-run
```

去掉 `--dry-run` 前须确认 `unattended` 契约（manifest 或 adapter `goal_capability.external_runner.unattended`）。

续跑：`--resume <run-id> --feature <feature-slug>`（或 `--manifest <path>`）。

证据：`doc/features/<feature>/goal-runs/<run-id>/manifest.json`、`events.jsonl`、`goal-report.{md,json}`。

### Run 出生与 diff 基线

新 run 统一由 `createGoalRun` 创建：先写 `manifest.json`，再写且仅写一条
`run_created`。只有这两项完整存在，attended bridge、detached runner、supervisor 和
recent-run 投影才会把它当成可运行实例。仅有 manifest、事件损坏或 `run_created` 重复均为
`CREATION_INCOMPLETE`：不可 attach/resume，也不构成同 feature 的 HALTED/PARTIAL 占位者；
检查既有 GC 报告后人工清理残留即可，不会自动补造出生事件。

实际 chain 含 `coding` 或 `ut` 时，出生必须把当时 exact Git HEAD 冻结为
`manifest.run_base_sha`；取不到 HEAD 就在零 agent 派发前拒绝创建。goal 内 UI/UT diff
只认该字段，忽略并从子进程环境剥离 `HARNESS_DIFF_BASE_REF`。没有 `run_created` 的旧 run
仍可只读旧 `run_start + coding-base`；一旦 `run_created` 在场便永不回退旧锚。

`run_base_sha` 是 write-once 身份：同 run 的 `--override-manifest`、identity rebase 和 resume
均不能改写。自动 successor 继承 lineage 的最早可信基线，不重新读取 HEAD。确需放弃旧
lineage 时，只能由操作者在 goal runtime 外运行：

```bash
cd framework/harness && npx ts-node scripts/goal-runner.ts \
  --feature <feature-slug> --requirement "<新问责需求>" --adapter <adapter> \
  --supersede <old-run-id> --rebaseline-to <当前-exact-40hex-HEAD> --detach
```

两个参数必须同时提供，`--rebaseline-to` 必须等于执行瞬间 HEAD；goal execution env
（即使带 `MAISON_GOAL_GATE_HARNESS=1`）一律拒绝。审计只追加到新 run：
`run_created.rebaseline_from_run_id` 与 `supersede` 的 target/superseding/base/event 引用；
不回写旧 run。这个管理命令建立新的问责边界，不是质量豁免，也不构成密码学真人证明。

### Runtime-owned blocker 与契约扩展

`run_base_sha` 缺失、损坏或与出生摘要不一致属于 runtime-owned framework blocker：runtime
必须在 executor 前停止，且 actionability 归 operator/toolchain，不得把“补锚”“改 manifest”或
重试同一 prompt 回喂给 agent。现代 run 不允许用 `trace.start_commit`、当前裸 HEAD 或
`coding-base.json` 临时补救；旧 reader 只服务没有 `run_created` 的迁移期 run。

plan closure 会把 `resource_keys[*].path`、`media`、页面/路由注册点以及 HAR build/export
路径统一解析，并要求每个文件引用都已列入 `contracts.files`。例如 contracts 引用了 20 枚
logo、但顶层 `files` 未声明时，应回到 plan 扩充 `contracts.files` 并重新 closure；不得在
coding 后绕过 UI scope、按字节一致自动授权或另建 asset 豁免表。`contracts.yaml` 始终是唯一
持久输入，closure 只产生内存规范化视图。

## 状态语义（goal-fakepass-hardening 后）

| 最终状态 | 含义 |
|----------|------|
| `CHAIN_SLICE_COMPLETED` | **本 run 的链切片**全 PASS——不等于需求完成；feature 级只认 `verify-feature-completion`（goal-status 尾行 `feature_status=`） |
| `AWAITING_HUMAN_REVIEW` | legacy 读取兼容；新 run 不再写出。旧质量人签等待在恢复时按当前机器事实重投影为 repair、capability defer、optional advisory 或诊断，不能靠签名 resume |
| `DEFERRED_CAPABILITY_MISSING` | 当前 provider/profile 缺少冻结需求所需能力（含 strict 视觉或 P0 runtime step telemetry）；配置可用能力后重跑/恢复，不能用 fidelity receipt 降低目标 |
| `DEFERRED` | 到达 end 但存在外部阻塞未闭环 |
| `PARTIAL` | 中途停止或未到 end 且有 DEFERRED |
| `HALTED` | 预算/收敛熔断、完整性持续不稳定、真正外部权限边界或 framework defect 等诚实终止；可修质量 FAIL 走责任阶段重跑，P0 skip/档位/视觉证据不得靠 waiver 放行 |
| `COMPLETED` | legacy（旧 run 事件读取兼容），新 run 不再写出 |

**任何 run 级状态 ≠ 需求完成**：feature 完成唯一判据 = `verify-feature-completion`
返回 `VALID`（重算全链 clean_pass/血缘/attestation/supersede 审计；伪造/缩链/世界后变
分别判 INVALID/STALE）。截断链 run（`--start` 非链首）启动前会机器核验上游各阶段
closure（phase-evidence-manifest staleness + review attestation），manifest 文本断言不作数。
废弃 HALTED 旧 run 用 `--supersede <run_id>`（写审计事件，completion 只认经审计的 supersede）；
只有需要切断旧 diff lineage 时才同时使用上节的 `--rebaseline-to`。

**DEFERRED ≠ 完成**：不得宣称 UT/真机已闭环。

## Adapter 选择与 personal setup（goal 入口）

**运行身份权威 = `framework.local.json agent_adapter`（SSOT）**。解析阶梯（用户显式 > 跳板/入口声明 > registry 交互，**永不默认 claude/cursor**）只产 `requestedAdapter`；effective 以合法 local 为准——`requestedAdapter` 仅在「首启无 local」或 `--override-adapter` 时才生效。goal-runner 在写 manifest 到盘前对账：`--adapter` 与合法 local 冲突 → **BLOCKER STOP**（不静默覆盖、不写 manifest），除非 `--override-adapter`（按请求回写 local 并留痕）。manifest 记 `adapter_provenance`（user_explicit|entry_declared|local_config|registry|override）供回溯。

`adapter_provenance` 记录 run **出生时**的 adapter 来源：resume 的 effective adapter 未变化时，
即使本次需要 `--override-adapter` 对账 local，也保留出生值，不改冻结 manifest。3.0.0 曾有旧
runner 把该字段改成 `override`，造成 phase evidence 全文件 hash 假 stale；兼容读取只在两份
manifest 除 `adapter_provenance` 外逐字一致时视为 fresh，requirement、adapter、预算等任何
真实字段变化仍 fail-closed。

1. goal-mode Skill 启动 runner **前**跑 `check-personal-setup.ts --json --ensure --select-adapter <requested>`（见 [personal-setup-gate.md](../../skills/reference/personal-setup-gate.md)）；用返回的 `activeAdapter` 作 `--adapter`。
2. 多 adapter 且 local 未设 → `needs_adapter_choice` → registry `setup.adapter` → `init-orchestrate --scope personal` → `record-adapter`（写 `framework.local.json`，非项目产物）。
3. **`adapter_conflict`**（local 已记录 X、本次请求 Y≠X）→ 默认尊重 X；确要换 Y：永久走 `record-adapter`，本次即时换加 goal-runner `--override-adapter`。
4. 双缺（无 requested、local 也无合法 `agent_adapter`）→ preflight/reconcile BLOCKER，**永不默认**。

### 排障：adapter 误选（如 cursor 记录却跑成 claude）

根因（2026-06 宿主实测）：旧链路把 agent 的 `--adapter` 猜测置于 local SSOT 之上（`argv.adapter ?? cfg.agent_adapter`），`--adapter` 一来又 `delete('agent_adapter')` 跳过 local 校验，且 `check-personal-setup` 静默吞掉 select≠既有 的冲突 → agent 猜的 claude 一路覆盖了你记录的 cursor。现已根治：local 权威化（reconcileRunAdapter）+ `adapter_conflict` 码 + manifest 前置对账（冲突不写 manifest）。

- **触发面（Cursor）· G6 已修**：根因是多 adapter 同名产物（`.cursor/skills`·`.claude/commands`·`.codex/skills` 都有 goal-mode）+ cursor 原 `commands: null`（无 `.cursor/commands` 产物）→ Cursor runtime 误读同名 `.claude/commands/goal-mode.md`(claude) 当 `/goal-mode`。G6 已给 cursor 生成 `.cursor/commands/goal-mode.md`（`RESOLVED_ADAPTER: cursor`），让 Cursor 的 Command 通道解析到 cursor 产物。**范围**：只修 goal-mode（唯一携带运行身份的 slash）；其它同名命令路由到 adapter 无关 skill、无误路由。
- **Cursor 手工验证项（仓内证不了）**：`.cursor/commands/goal-mode.md` 存在且内容 `RESOLVED_ADAPTER: cursor`（仓内单测已锁）；但「Cursor 是否优先读 `.cursor/commands/` 而非 `.claude/commands/`」属 Cursor 产品行为——须在 Cursor 里实测：Settings → Commands 看 `/goal-mode` 指向 `.cursor/commands/`，必要时禁用/移除 `.claude/commands/goal-mode.md`。**无论 Cursor 行为如何，G1/G2 仍是硬兜底**（错 adapter 会被 goal-runner STOP）。
- **恢复**：① 核对 `framework.local.json agent_adapter` 确是你要的；② 重跑（冲突会被 STOP 并提示）；③ 真要换：本次用 `--override-adapter`，永久用 `record-adapter`。

## 视觉金丝雀缓存（`framework.local.json vision.canary`）与升级模型

UI 相关 goal 首跑会真实探测一次 adapter 的读图能力（几何/颜色四题），结果缓存进
`vision.canary`（个人级本地配置）。**升级 framework 时不要删 `framework.local.json`**
——删除会连 `agent_adapter`/DevEco 路径一并丢掉；缓存有完整的自动生命周期
（plan c7d2e9a4）：

- **协议版本自愈**：缓存带 `probe_version`；framework 升级改了探测协议后旧缓存自动判
  stale，下一次 UI goal 重探原位覆写——用户零操作；
- **TTL 分层**：goal 来源 `tool_read` 7 天、`none/ocr_capable` 24 小时（模型路由/额度/
  权限会静默变，不永久采信）；interactive 来源恒 24 小时；
- **探测失败不落缓存**：invoke 失败（非零退出/超时/静默被杀）或输出非有效答卷
  （空输出/额度错误文本/prompt 回显/残卷）一律不写盘——盘上有新鲜缓存则沿用
  （stale-if-error，runner 日志如实注明），否则本次 run 回退 adapter 声明路径、下次自动重探；
- **强制重探**：换模型/账号后想立即刷新，goal-runner 加 `--refresh-vision-probe`
  （自然语言对 agent 说「强制刷新视觉探测」即映射此 flag）；或手删 `vision.canary` 节点
  （只删该节点，勿删整个 local 文件）；
- **模型钉绑定（`--adapter-model`）**：pinned run 的 canary receipt 记 pin 模型值，采信/跳过
  须 run + 模型同时命中（resume 改 pin 同 run_id 的旧模型缓存、并发窗口切走模型的旧缓存
  都会自动失效重探）；未 pin 的 run receipt 仍记 `unknown`、采信行为与现状一致。

## 两级校验

- **check-init**：`goal_capability` 缺失仅 WARN
- **goal-runner 运行身份对账（写 manifest 前）**：`reconcileRunAdapter` 以 `framework.local.json agent_adapter` 为权威——`--adapter` 与合法 local 冲突 / 双缺 / `--override-adapter` 无 requested → BLOCKER STOP（不写 manifest）；override 经 `recordAdapterToLocal` 回写留痕
- **goal-runner preflight**：`manifest.adapter` ∈ materialized + 入口产物 + `goal_capability`/`unattended` + **provenance**（仅 `fallback` 拦 personal setup）+ 无头 CLI 可解析（`--dry-run` 降级 WARN）

## Headless 路径（MVP 硬化）

**全权限契约（plan a8e5c3f9）**：用户主动启动 Goal/headless 即授权 agent 无人值守全权限执行
（non-interactive + no approval prompt + full filesystem/tool execution）；adapter 只把该语义翻译成
自家 CLI 参数，不得降级。全权限=执行能力，不是业务裁决权——phase 权责、integrity、runner-owned
gate、receipt/人签、设备与凭据规则不变；agent 自跑 harness 只是快速反馈，runner 的正式 gate 仍是
唯一裁决真源。headless 下**无须也不应**再为单个命令（npx/npm/node/hvigor/hdc…）做预批准。

- Claude：`claude -p --dangerously-skip-permissions`（结构化 argv，不经 shell tokenize；不再用
  `--permission-mode dontAsk`——那是"不询问、未批准即拒绝"而非 bypass，也不再传 `--allowedTools`。
  2026-08-17 宿主实跑验收：该 argv 组合下真实执行 `npx ts-node --version` 成功、`permission_denials=[]`）
- CodeAgent：**当前不支持 Goal/headless**——argv 与 Claude 共用（`codeagentcli -p
  --dangerously-skip-permissions`），但该 bypass 旗标在 codeagentcli 上未经宿主实测（2026-07-29 家族
  等价实证只覆盖旧旗标集），preflight 以 `adapter_headless_permission_unsupported` 明确拒绝。解锁路径：
  宿主跑 `codeagentcli --help` 确认旗标存在并实跑一条 shell 命令，然后删除 agent-invoke.ts
  `assertAdapterHeadlessFullPermission` 的 codeagent 分支（argv 无须再改）。宿主身份 env=`CODEAGENT=1`，
  hook 进程注入 `CODEAGENT3_PROJECT_DIR`
- Codex：`codex --ask-for-approval never exec --sandbox danger-full-access`（恒定，不随 manifest 摇摆；
  审批旗标为**顶层旗标**，必须放 `exec` 之前）
- Cursor：`cursor-agent`（回落 `agent`）`-p --force --trust`（恒定）+ prompt stdin。**禁止**
  `cursor agent --print`。Windows `.cmd` 垫片经 **cross-spawn** spawn（`harness` 依赖 `cross-spawn`）。
- Chrys：**当前不支持 Goal/headless**——其非交互全权限（bypass）参数未经宿主核实，preflight 以
  `adapter_headless_permission_unsupported` 明确拒绝（不静默以未知/残权限启动）。解锁路径：宿主跑
  `chrys run --help` 把等价旗标带回来，接入 agent-invoke.ts 与 agents/chrys/adapter.yaml。
  （原调用形态存档：`chrys run --task <PROMPT_FILE> -C <PROJECT_ROOT> --agent Code --json`；文件传
  prompt；CLI 在 PATH 或 `%LOCALAPPDATA%\chrys\bin`；无流式输出；退出码 0/1(stderr JSON)/124/130。）
- OpenCode：`opencode run --dangerously-skip-permissions --dir <PROJECT_ROOT>` + **stdin 灌 prompt**（**勿用 `-p`**，其为 `--password`）。前置：`npm i -g opencode-ai`，bin 名 `opencode`；模型/凭据由 opencode config/auth 提供，先手跑 `opencode run "hi"` 验证。**skill 落 opencode 自有原生目录 `.opencode/skill/<id>/SKILL.md`**（opencode 长期稳定的主 skill 目录，兼容当前版本及传统原生目录；不依赖较新的 `.agents` 外部 skill 发现）。`AGENTS.md` 仍在项目根（opencode 原生读为 instructions）。opencode **自动加载的只有** `AGENTS.md` + `.opencode/{skill,skills}/**/SKILL.md`；`.opencode/rules/*` 不自动加载（引用可达，非有效规则入口），maison 不碰用户 `.opencode/opencode.json`。默认开关全开（勿设 `OPENCODE_DISABLE_PROJECT_CONFIG` 等禁用 bundle 的 env）。Windows `.cmd` 经 cross-spawn。

**模型钉（`--adapter-model <id>`）**：并发多窗口跑不同模型、或要钉住本 run 模型时，启动 goal run 传 `--adapter-model`，该值是**权威输入**并随 headless argv 回放（codex/claude/codeagent/cursor 用 `--model <id>`，opencode 用 `-m <id>`），写入 manifest `adapter_model_pin`。`chrys`/`generic` **不支持**（传了即 BLOCKER fail-fast）。CLI、loaded manifest、successor 继承**均无 pin** 时 = 现状零变化；pinned run 的 resume 不传 flag 仍继承并回放冻结 pin。**仅 headless/unattended（含 `--detach`）；有人在场 in-session 不适用**。

**只读视觉 provider（`--visual-adapter <a> --visual-model <id>`，plan ab072691）**：主模型无视觉时，
可为本 run 指定**第二个只读 endpoint**——它只看图产逐屏结构化评审，物理上不写工程；正式产物唯一写者
仍是主模型。两个旗标**成对必填**，单给任一即 fail-fast；值写入 manifest `visual_provider_pin` 并条件
进身份哈希，resume 只认冻结值（不重读个人配置），successor 出生输入可覆盖。优先级 **CLI > manifest
冻结值 > 个人级 `framework.local.json` 的 `vision.visual_provider`**。

**视觉能力不足不再使用人工盲跑 waiver**：`--allow-blind-visual` 已删除，新 manifest 不写
`allow_blind_visual`；旧字段只读兼容但无运行语义。运行策略只由冻结 requirement 的目标/严格度和
当前 capability facts 决定：`pixel_1to1 + hard` 等必需视觉能力不足时，在 content invoke 前投影
`DEFERRED_CAPABILITY_MISSING`；非 strict、非发布必需的视觉证据按既有 advisory/UNVERIFIED 策略继续。
配置合法 provider 后，新 run 可直接使用；当前 run 若要变更冻结 provider pin，仍按既有
`--visual-adapter` + `--visual-model` 与 manifest override 规则处理。

- **支持哪些 adapter 由 adapter catalog 派生**——运行时扫 `agents/<adapter>/adapter.yaml` 的
  `visual_provider` 完整声明；本文**不另写一份名单**（要看当前支持项，跑一次带不支持 adapter 的
  `--visual-adapter`，错误会列出）。
- 显式传了**不受支持**的 adapter → 启动处 BLOCKER fail-fast 并列出支持项；框架**不自动改选**、
  **不在多个 provider 之间 fallback**。
- 无人值守读到已失效/不可读的旧 local 配置 → WARN + 忽略；后续 requirement/capability preflight
  决定 defer 或按 advisory 继续，不询问、不自动改选。
- provider 调用失败/载荷不可信时：本轮视觉反馈降级为盲档，`visual_diff` 出 `{BLOCKER, SKIP}`，
  required 轴保持 FAIL/UNVERIFIED 并重试或 defer，optional 轴才可 advisory；不得伪造 PASS。
- 当前 attempt/hash/identity 绑定的 deterministic/native/delegated 机器证据直接决定视觉轴，
  不再要求真人逐屏签名。

```bash
# 只读视觉 provider 示例（主模型盲 + 第二个能看图的 endpoint）
cd framework/harness && npx ts-node scripts/goal-runner.ts \
  --feature <feature-slug> --requirement "需求" --adapter codex --adapter-model <coding-model> \
  --visual-adapter claude --visual-model <vision-model> --detach
```

```bash
# Chrys dry-run 示例
cd framework/harness && npx ts-node scripts/goal-runner.ts \
  --feature <feature-slug> --requirement "需求" --adapter chrys --dry-run

# OpenCode dry-run 示例
cd framework/harness && npx ts-node scripts/goal-runner.ts \
  --feature <feature-slug> --requirement "需求" --adapter opencode --dry-run
```

### 无人值守存活：`is_background` ≠ 活过会话（survival-first · 概念纠正）

宿主的"后台启动"（Cursor `is_background` / Claude Code `run_in_background`）只让 agent **立即拿回控制权**，进程仍是**会话内子进程**——宿主会话结束 / 活跃 agent 轮次收尾即被回收（2026-06 实测：`is_background` 直挂的 run 在轮次收尾被杀，`progress.json` 长期显示"运行中的尸体"）。**"拿回控制权" ≠ "活过我的会话"。**

故**无人值守一律用真 `--detach`**（真 OS 脱离：`detached:true`+`unref()`+stdio 落 `detach.log`），实测能**活过 Cursor 完全关闭再重开**。宿主有后台模式可叠加用来不阻塞 launcher，但**存活靠 `--detach`，不靠 `is_background`**。启动后须**存活自校验**（`detach.log` 增长 + `goal-status` 活性正常），没起就如实报"启动未存活"，不要假报"已在后台跑"。

**存活是环境属性**：会**整组/整树杀**进程的敌对宿主（部分公司沙箱 / CI；Node `detached:true` 不设 `CREATE_BREAKAWAY_FROM_JOB`，挡不住 `taskkill /T` / kill-on-close Job）下 `--detach` 也保不住，须用 OS 调度任务（cron / Windows Task Scheduler）托管 run。下面 chrys / opencode 是"阻塞型宿主"的具体落地。

**本次实测（2026-08-18，Windows Claude Desktop 工具环境；措辞仅限定该宿主环境，不概括"Claude Code 一律必死"）**：工具 shell、会话后端、detached 探针的 `IsProcessInJob` 全部为 `true`，且 `detached:true` 无法请求 breakaway——该环境下 `--detach` 的 runner 三次在宿主轮次交还后的延迟回收中被硬杀（无部分退出钩子足迹，进程整体消失）。教训：**只要宿主进程在 kill-on-close Job Object 里，--detach 就是临时存活；真无人值守必须脱离该宿主进程的生命周期**。

### 恢复路线分级（真无人值守 ≠ 用户终端临跑）

| 路线 | 级别 | 说明 |
|------|------|------|
| **Task Scheduler（推荐，真无人值守）** | `goal-supervise --install-schtasks --feature <f> --every-minutes 5` | OS 计划任务独立于宿主会话/进程树；supervisor 自愈（run 崩溃/被杀后按 beacon×run_disposition 决策自动 `--resume`，且在有 Job 守卫下确认旧 owner 死亡后才受控拉起）。**显式手动执行才安装**，框架绝不自动写持久计划任务；`goal-supervise --uninstall-schtasks --feature <f>` 卸载 |
| **用户自开终端 `--detach`** | 一次性临时路线 | 当前终端/宿主会话内能活（关闭启动窗口无碍），但**无 supervisor 自愈——run 崩了没人拉起**，宿主整树清理时也会被杀。适合"我看着这一轮 / 短任务"的临时场景，不写成与 Task Scheduler 同级保证 |

不做 **Job flags 运行时自动探测或自动路由**（探测≠保护；containment 才是保护）——宿主环境是否 kill-on-close 一律由上面这条人工分级决定，不自动判。

### 从无后台能力的宿主 shell 启动（chrys / opencode TUI 等）→ 必须 `--detach`

当**编排 agent 自己**（如 chrys TUI 的内置 shell 工具）去启动 goal-runner，而该 shell **仅阻塞、有超时上限、无后台模式**时：直接跑会秒级超时 → runner 变孤儿后台续跑 → agent 误判超时又重复起 run → 子进程互杀（chrys 实测）。**加 `--detach`**：

```bash
cd framework/harness && npx ts-node scripts/goal-runner.ts \
  --feature <feature-slug> --requirement "需求" --adapter chrys --detach
```

- launcher **秒级 fork 后台 child 并打印一行 JSON**（`{detached, run_id, report_dir, log, pid}`）后 `exit 0`；宿主 shell 拿到干净 0 退出码立即返回，**不触发超时杀树**。
- child 的 stdio 重定向到 `report_dir/detach.log`，**不继承宿主 shell 的管道**（否则宿主 `communicate()`/阻塞读会一直等到 child 关 pipe，反而拖到超时杀树）。
- 解析 launcher JSON 取 `run_id`，随后按下文执行启动握手、汇报并交还轮次；`--detach` 同样兼容 `--resume <run-id> --feature <f> --detach`。
- 适用前提（实测，chrys `foundation/platform/process.py`）：宿主 shell 用 `CREATE_NEW_CONSOLE` 而非 kill-on-close Job Object，且**仅在超时/取消时杀树**——故 launcher 干净退出即可让 detach 存活。

**监控口径（chrys/opencode 无流式）**：`phases/<phase>/agent-output.log` 在 phase 结束前**恒为空**——活性**只**看 `goal-status` / `progress.json` / events 心跳（每 ~60s 一拍），**禁止** tail `agent-output.log` 判断卡死。

## 运行中进度（progress / monitor 契约）

事实源：`events.jsonl`（append-only）。派生快照：`progress.json` / `progress.md`（可重建）。

```bash
cd framework/harness && npx ts-node scripts/goal-status.ts \
  --feature <feature-slug> --run-id latest --json
```

主 agent 启动 runner 后，默认执行**有界启动握手**（硬上限 ≤30s，间隔 2–5s，只检查 manifest 落盘 / `detach.log` 增长 / liveness；按结果分类汇报——有可信终态/等待态证据就报真实状态，非终态且进程健康报「已启动」，超窗但进程仍活着报「尚未就绪，进程仍存活」，仅进程确实死亡且无结束证据才报「未存活」），就绪后汇报 `run_id`、进度路径、续查命令并**结束当前轮次**——这是默认，不需要用户开口「后台跑」，也不进入 monitor（禁止用 `sleep`/`for`/`grep events.jsonl` 等自制循环等待 phase/verdict/run_end 事件；启动握手是唯一例外）。仅当用户明确要求盯守时才进入 bounded monitor：

```bash
cd framework/harness && npx ts-node scripts/goal-monitor.ts \
  --feature <feature-slug> --run-id <run-id|latest> \
  --since-event <last-seen-event-index> \
  --max-seconds 240 --markdown
```

调用 `goal-monitor --max-seconds N` 时（仅在 opt-in 盯守实际调用时适用），宿主 shell/tool timeout 必须显式设置为 `> N`（建议 `N + 60s`；`--max-seconds 240` 时至少 300s）。不要依赖 Claude Code Bash 等宿主工具的默认 timeout；若宿主无法提升 timeout，就把 `N` 降到安全值。

| 入口 | 用途 |
|------|------|
| `progress.json` | IDE/插件/CI 文件 watch |
| `goal-status --json` | 无法直接解析路径时的命令契约；**实时重算** liveness + `generated_at` 新鲜度降级 |
| `goal-status --markdown` | agent 向用户汇报 |
| `goal-status --watch` | **仅供人在终端**；agent 勿跑常驻 watch；可加 `--max-ticks N` 限制轮询次数（测试/脚本用） |
| `goal-monitor --markdown/json` | **仅 opt-in 盯守用**；边沿触发、最多等待 `--max-seconds`、输出一次通知后退出。**不得当状态查询**（默认游标 -1 会重放最早历史 verdict）——状态查询唯一入口是 `goal-status` |

**新鲜度降级**：非终态快照若 `generated_at` 超过 heartbeat 间隔 2–3 倍，不得信任 raw `status: RUNNING`（后台 terminal 随 IDE 会话回收会留下谎报）。终态快照（`COMPLETED`/`DEFERRED`/`PARTIAL`/`HALTED`）不降级。

`goal-monitor` 是纯读取器：它不启动、不续跑、不杀掉、不修改 goal-runner；被宿主 timeout 杀掉无副作用，下一轮可重新调用。它的通知事件包括 `phase_verdict`、`run_end`、硬 liveness 异常，以及低频 ACTIVE heartbeat 摘要。heartbeat 摘要按事件时间累计 `SOFT_STALL_MS = 10min` 判断并去重，不按本次 monitor 调用等待时长判断。

跨轮次接管：若主 agent 轮次中断，新轮 agent 应从 run 目录重新读取 `events.jsonl` / `goal-status` 推导当前状态和最近 verdict；不要假设内存里的 `last_seen` 仍可靠。第一版 framework 脚本不提供跨轮次聊天唤醒；真正 push/wakeup 属于宿主或 adapter 增强（如 Claude `ScheduleWakeup` / cron 等宿主调度能力）。

**不要**把 `agent-output.log` 正文或 runner stdout 日志当协议；stdout 里程碑行 `GOAL_PHASE` / `GOAL_RUN` 是受维护的轻契约和可选加速器，不是通知 SSOT，且仅限**当前轮次、非 detached、stdout 仍由宿主持有**的路径（`--detach` 下 runner stdout 已全部重定向进 `detach.log`）。

## Headless 阶段内闸门（§9）

goal-runner 向每个 phase agent 注入 **Unattended execution** 块（SSOT：[user-confirmation-ux.md §9](../../skills/reference/user-confirmation-ux.md)）：

- 阶段内确认闸门（术语 `[x]`、ui-spec verified、enum/gate 等）**自动解析 + 留痕** `doc/features/<feature>/<phase>/headless-assumptions.md`。
- glossary 命中 → high 自动解析；新术语 → medium/low + legacy `must_review` 审计标记（goal-report 顶部清单，不参与门禁）。
- `freeform_approval`（scope 扩展、改源码）→ **保守默认**（不扩 / 不改），记录推迟请求。

### 防御纵深（盲目重试）

| 机制 | 行为 |
|------|------|
| **无进展守卫** | 同一 phase 连续 attempt：`deterministic_gate_or_artifact_missing` + 相同 blocker 签名 + 产物 delta 零（存在性/内容 hash，**非 mtime**）→ 立即 HALT |
| **指纹级熔断（f7a3d9c2）** | testing 视觉迭代：check 比对 `visual-rounds.ledger.jsonl`，连续两有效轮缺陷指纹集相等且仍有 loop-actionable 残差 → `failure_kind=no_progress_fuse` **首触即 HALT**（不烧重试预算；归因 `no_fix_attempt`/`ineffective_fix` 在 blocker details；duplicate 重放保证 agent 自跑首检的 fuse 外层 gate 仍可见）。与旧 `no_progress_visual_gap`（blocker-id 粗粒度签名熔断）并存：fuse 更细更先触发，signature 熔断留作兜底 |
| **账本完整性（f7a3d9c2）** | testing gate/resume 启动时 events↔ledger 反向对账：期望行缺失/被改（含 decision）→ `visual_ledger_integrity` HALT——删账本行绕不过熔断，损坏不解释成空历史（运行时一致性防护，非密码学防篡改） |
| **chrys sentinel** | `agent-output.log` 逐行 JSON 命中 `code=headless_interaction_required` → 立即 HALT + `agent_interaction_required` 事件 |
| **重试上下文** | 产物缺失类失败不注入「先 revert」话术；仅 `code_regression` 保留 revert-first。testing 的可信根失败非空且全为 `test_contract` 时，后置精修并跨 retry/`--resume` 恢复该分类，prompt 只检查 selector、ui-spec、测试锚点或 runner 契约，禁止据此修改产品源码 |

events 字段：`failure_kind_classified`、`blocker_signature`、`halt_reason`、`interaction_question`；f7a3d9c2 新增 `visual_round`（loop_id/visual_attempt/row_hash/disposition/fused——账本回执，integrity 对账期望集）与 `critic_receipt_produced`。轮次身份：runner 对 agent 与 gate 双注入 `MAISON_GOAL_RUN_ID`/`MAISON_GOAL_ATTEMPT`（attempt=events 回放的 invocation 序数，跨 `--resume` 单调，绝不用 phase 内 retries 计数）。

## 宿主侧实机冒烟（chrys，跨机器）

本仓开发机可能无 chrys；以下步骤须在 **真 chrys 宿主**（如 HarmonyOSDemo + framework）执行，结果回填 plan 实施记录。

```bash
# 0. Tier_1 + personal setup（goal-mode Skill 前置）
cd framework/harness && node ../scripts/init-readiness.mjs
npx ts-node scripts/check-personal-setup.ts --json --ensure --select-adapter chrys --project-root <repo-root>

# 1. 核实 chrys 非交互 flag（Layer C）
chrys run --help   # 记录是否有 bypass/非交互 flag，反馈维护者

# 2. 仅 spec 单 phase 冒烟
npx ts-node scripts/goal-runner.ts \
  --feature <feature-slug> \
  --requirement "<需求摘要>" \
  --adapter chrys \
  --start spec --end spec \
  --detach

# 3. 验收（run 结束后）
# - agent-output.log 无 headless_interaction_required
# - doc/features/<f>/spec/spec.md 存在且含 section 0 [x] + 正文
# - spec/reports/summary.json verdict=PASS
# - doc/features/<f>/spec/headless-assumptions.md 含 must-review 清单（如有 medium/low 术语）
npx ts-node scripts/goal-status.ts --feature <f> --run-id <run-id> --markdown
```

失败时查 `goal-runs/<run-id>/goal-report.md` 的「外部输入或权限」段与 `events.jsonl` 的 `agent_interaction_required`；仅真实外部前置条件允许停放，质量问题不得由人工确认放行。
