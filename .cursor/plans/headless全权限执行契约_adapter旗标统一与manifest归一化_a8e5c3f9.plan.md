---
name: 统一 headless adapter 全权限执行契约 — 旗标映射与 manifest 归一化（headless-full-permission-contract）
version: 3.0.0
# 版本说明：本 plan 纳入当前 3.0.0 窗口，完成后随本版发布（pending todos 进入 3.0.0 发布门）。
overview: >
  宿主实锤（run cb1583 ut 阶段）：phase agent 按 prompt 要求自跑 UT harness
  （npx ts-node …），Claude headless 以 --permission-mode dontAsk 启动、npx 未被预批准
  → permission_denied。agent 只能盲猜修复→退出→runner 跑正式 gate→烧一个 retry，
  三个 content retry 被迅速耗尽——权限拒绝是 retry 消耗的直接放大器。
  产品契约（核心定义，已裁定）：用户主动启动 Goal/headless，就代表授权 agent 进行
  non-interactive、no approval prompt、full filesystem/tool execution 的无人值守执行；
  adapter 只负责把这一统一语义翻译为自己的 CLI 参数，不得降级为 workspace-write、
  acceptEdits 或 dontAsk。全权限=CLI/工具/OS 执行权限，不是业务裁决权或信任材料写入
  权：phase 权责、source/framework integrity、runner-owned gate、receipt/人签、
  journal 收编、污染轮次终止、设备与凭据安全规则全部不动。现有「agent 自跑 harness
  快速反馈 + runner 再跑正式 gate（唯一裁决真源）」双层关系已足够，不建设：harness
  专用命令白名单、npx 专用授权、自检 wrapper、adapter 各自窄 allowlist、第三套自检
  通道——那些只修当前命令，换 npm/node/hvigor/hdc 还会复发。
  当前各 adapter 权限语义不一致（agent-invoke.ts 实测现状）：
  · claude/codeagent（claudeArgv :301）：approval never→--permission-mode dontAsk
  （「不询问、未批准即拒绝」，非 bypass），否则 acceptEdits；--allowedTools 兼任审批面，
  且经 MAISON_GOAL_ALLOWED_TOOLS 环境变量（phase-state.ts:89、goal-runner.ts:969）
  流入 multimodal-probe（:449）参与多模态能力判断——「缺 Read」会触发 image input
  降级，属隐性消费；
  · codex（codexArgv :330）：--ask-for-approval never|on-request +
  --sandbox danger-full-access|workspace-write 随 manifest 摇摆；
  · cursor（:356）：仅 approval never 才加 --force --trust；
  · opencode（:411）：恒 --dangerously-skip-permissions（唯一符合目标语义）；
  · chrys（:392）：chrys run --task … -C … --agent Code --json，无任何权限映射；
  · manifest/探针默认值三处均不符合统一的 full-access + never，且彼此不一致（不得
  统称 on-request）：goal-mode-entry.ts:233 = workspace-write + on-request；
  goal-runner.ts:3201（fresh 入口）= workspace-write + never；
  multimodal-probe.ts:468（本地默认）= workspace-write + never——与「无人值守
  headless」自相矛盾。
  实施范围明确包含发布件同步：agents/{claude,codeagent,codex,cursor,opencode,chrys,
  generic}/adapter.yaml 及必要的 adapter schema/runbook——headless_invoke 示例、
  external_runner.unattended 默认、注释 notes 与运行时代码权限语义一致；不能只改
  agent-invoke.ts，否则声明仍教 dontAsk/allowedTools/workspace-write，形成声明与
  运行时双口径。
  最终验收（九条）：① claude/codeagent headless 能执行 prompt 要求的
  npx ts-node …harness-runner.ts，不再 permission denied；② codex 恒
  approval never + danger-full-access；③ cursor/opencode/chrys 等内建 adapter 具备
  等价全权限语义，不能满足的 adapter 明确不支持；④ 新 Goal manifest 默认
  full-access + never；⑤ 旧 manifest 可 resume，但旧权限字段不再降低实际 headless
  权限；⑥ allowed_tools 不再形成隐性审批或 Read 能力降级；⑦ agent 自跑 harness 后
  runner 仍执行正式 gate，正式 gate 仍是唯一裁决真源；⑧ adapter.yaml、运行时代码、
  prompt、runbook 与测试对权限语义一致；⑨ receipt、人签、journal、integrity、阶段
  权责与设备安全边界未被削弱。
todos:
  - id: t1-claude-codeagent-bypass
    content: >
      claudeArgv（claude 与 codeagent 共用，仅 binary 不同）明确裁决、无备选：
      · 使用 --dangerously-skip-permissions；
      · 删除 --permission-mode dontAsk/acceptEdits 分支；
      · 从 argv 删除 --allowedTools（它是审批清单，不得再描述为工具可用性声明；
      bypass 下保留只会延续错误抽象）；
      · 保留 -p、stdin prompt、stream-json/verbose、model pin 现有行为；
      · claude 与 codeagentcli 都做 CLI 探针，确认 bypass 与现有参数组合兼容
      （沿 c7a9e2f4 宿主实证纪律）。
      manifest 的 allowed_tools 字段暂时兼容保留，但标记 deprecated/ignored，不再影响：
      claude/codeagent argv、shell/Read 等工具审批、Goal 多模态能力判断、
      MAISON_GOAL_ALLOWED_TOOLS 环境变量、以及「缺 Read」触发的 image input 降级——
      同步清理 goal-runner.ts:969 的 env 注入与 multimodal-probe.ts:449 的消费，
      避免口头说不消费、运行时仍降级。
      单测：headless invoke plan 快照含 bypass 旗标、不含 --permission-mode 与
      --allowedTools；多模态探针不再因 allowed_tools 缺 Read 而降级。
    status: completed
  - id: t2-codex-fixed-full
    content: >
      codexArgv 固定化：codex --ask-for-approval never exec --sandbox
      danger-full-access。--ask-for-approval 保持在 exec 前（顶层旗标，沿 c9f4e7a2 t2
      教训）；不再读取 manifest 的 write_mode/approval_mode 决定 argv；model pin 位置
      保持现有已验证顺序（exec --model <v> --sandbox <m>）。
      单测：对不同旧 unattended 输入，最终 argv 全部相同。
    status: completed
  - id: t3-cursor-always-trust
    content: >
      cursorHeadlessPlan 恒加 --force --trust（删除 approval_mode==='never' 条件），
      保持 stdin prompt 与 model pin 行为。单测同步。
    status: completed
  - id: t4-opencode-pin
    content: >
      opencode 保持现状（恒 --dangerously-skip-permissions），仅补回归单测钉住该旗标，
      不增加新逻辑。
    status: completed
  - id: t5-chrys-and-adapter-contract
    content: >
      chrys：先核实实际 CLI——存在 bypass/full-permission 参数或默认行为→接入映射并
      用宿主探针证明；确认无法提供无人值守全权限执行→明确标为不支持 Maison
      Goal/headless（preflight 命名硬失败，进 halt 详情），不得静默以残权限启动。
      generic/custom 契约同步明确：Maison 内建、已知 CLI 的 adapter 由框架维护全权限
      映射；custom external_runner.headless_invoke 的契约=「adapter 提供方给出的
      non-interactive full-permission 启动命令」——Maison 不猜第三方 CLI 的 flag、
      不加命令白名单、不新增审批层，也不新增通用权限 attestation schema（headless_invoke
      本身就是 adapter 对启动命令负责的契约入口）；generic adapter 文档写明该契约；
      经核实无法满足的 adapter 不得一边宣称支持 Goal/headless 一边受限运行。
      单测：不支持路径的 preflight 硬失败形态。
    status: completed
  - id: t6-effective-headless-contract
    content: >
      统一归一化入口（很薄的纯解析点，不是状态机、无第二份持久状态）：
      effectiveHeadlessUnattended = { write_mode: 'full-access',
      approval_mode: 'never' }。
      · Goal/headless 所有运行时消费者（argv、prompt、preflight、多模态判断）统一
      使用 effective 值——权限字段当前同时流向这四处，只在各 adapter 散落硬编码会
      形成新双口径；
      · 新 manifest 默认写 full-access + never，**两个生成入口都改**：
      goal-mode-entry.ts:233 与 goal-runner.ts:3201（fresh Goal CLI），并覆盖
      multimodal-probe.ts:468 的本地默认；
      · 旧 manifest 枚举继续接受（历史 run 可 resume），原文不重写，但执行、prompt
      与能力判断统一用 effective 值；
      · allowed_tools 不构成 effective 权限的一部分。
      审计可见性：复用现有 adapter_probe / agent_invoke_start 事件，增加
      effective_write_mode / effective_approval_mode（或等价字段），让旧 manifest 写
      workspace-write 而实际全权限时排障不被误导；不新增只服务本项的独立事件账本。
      单测：旧 manifest（workspace-write/on-request）载入后 invoke plan 已归一化；
      两个生成入口的新 manifest 值断言；探针路径同契约；事件含 effective 字段。
    status: completed
  - id: t7-adapter-yaml-sync
    content: >
      发布件声明同步（防声明与运行时双口径）：更新
      agents/{claude,codeagent,codex,cursor,opencode,chrys,generic}/adapter.yaml 及
      必要的 adapter schema/runbook——headless_invoke 示例改为全权限形态、
      external_runner.unattended 默认改 full-access + never、注释与 notes 不再教
      dontAsk/allowedTools/workspace-write；chrys 按 t5 核实结果写「支持（参数）」或
      「不支持 headless」。宿主指引保持话术+预期回报形态（不是 CLI 命令）：headless
      即全权限、无须也不应再为单个命令做预批准。
      验证：现有 adapter manifest 校验/夹具套件同步更新后全绿。
    status: completed
  - id: t8-boundaries-and-tests
    content: >
      边界与验证（不为既有不变量复制新机制或新测试框架）：
      · 修改受影响的 adapter invoke、manifest、preflight、多模态与 prompt 单测；
      更新现有断言中对 workspace-write/dontAsk/allowedTools 的旧预期；
      · 复用已有 integrity、receipt、journal、device credential 测试证明无直接回归
      （agent 能改的东西变多 ≠ runner 认账的东西变多）；
      · agent 自跑 harness 与 runner 正式 gate 的双层关系写进注释与宿主指引：自跑=
      快速反馈，runner gate=唯一裁决真源，自跑结果不进任何判定；
      · 发布内容修改完成后按仓库门禁运行：typecheck、受影响单测、
      cd harness && npm test 全量。
    status: completed
---

## 实施记录（2026-08-17）

全部 8 todo 已实施。新增单测套件 `headless-full-permission`（10 例）已注册 CORE_SUITES；
受影响既有套件 goal-runner-policy(25)/goal-model-pin(29)/codeagent-adapter(11)/
multimodal-probe(18)/chrys-opencode-adapter(18)/goal-preflight(36)/headless-binary-resolve(9)/
claude-envelope(13) 全绿；typecheck 通过；goal-mode-runbook Headless 节同步改写。

**实施偏差（对照 plan）**：
- t1 CLI 探针（2026-08-17 复检 P1 后修正）：
  · claude **宿主实跑验收完成**——以生产完整 argv 形态
  `claude -p --output-format stream-json --verbose --dangerously-skip-permissions`
  真实执行 `npx ts-node --version`（即 cb1583 事故里被 dontAsk 拒绝的命令类型），
  返回 v10.9.2、`permissionMode=bypassPermissions`、`permission_denials=[]`；
  · codeagentcli 本机无 CLI 无法探针——**按复检裁定不以家族推定宣称支持**，与 chrys
  同待遇「未核实即拒绝」：preflight 以 adapter_headless_permission_unsupported 硬失败
  （dry-run 降 WARN），adapter.yaml/runbook 写明解锁路径（宿主 `codeagentcli --help`
  确认旗标 + 实跑一条 shell 命令 → 删 assertAdapterHeadlessFullPermission 的 codeagent
  分支即接入，argv 无须再改）。**这是行为变化：核实前 codeagent 无法再作 goal
  headless 宿主**。
- t5 chrys：本机 PATH 无 chrys，两分支（有旗标接入/确认无→标不支持）均不可判——落为
  第三态「未核实即拒绝」：preflight 以 adapter_headless_permission_unsupported 硬失败
  （dry-run 降 WARN，与 binary 检查同待遇），adapter.yaml/runbook 写明解锁路径
  （宿主 `chrys run --help` 核实后接入）。**这是行为变化：核实前 chrys 无法再作 goal
  headless 宿主**。
- t6 审计字段落在 adapter_probe（每 run 一次）而非 agent_invoke_start（每 attempt 一次）
  ——权限 per-run 恒定，选事件基数小的，复用现有事件不加账本。
- t1 清理隐性消费时保留了 resolveGoalEffectiveImageInput/resolveContextAdapterImageInput
  函数名（语义=resolveBaseImageInput）以稳住调用面；parseGoalAllowedToolsFromEnv 与
  MAISON_GOAL_ALLOWED_TOOLS_ENV 常量彻底删除。

**宿主待验项**（对应验收①③；claude 的 npx 实跑已在本机完成，见上）：
1. codeagent：宿主跑 `codeagentcli --help` 确认 `--dangerously-skip-permissions` 存在并
   实跑一条 shell 命令 → 删 assertAdapterHeadlessFullPermission 的 codeagent 分支接入；
   核实前 preflight 明确拒绝（非静默降级）。
2. chrys：宿主跑 `chrys run --help` 回带非交互/权限旗标输出，决定接入或维持不支持。
3. （可选加固）宿主真实 goal run 全链复跑一次 ut→testing，确认 phase agent 自跑
   harness 全程零 permission_denied——本机探针已覆盖单命令层。

**复检返修记录（2026-08-17 第二轮）**：按复检意见 1/2 落地——codeagent 转「未核实即
拒绝」（agent-invoke.ts + adapter.yaml + runbook + headless-full-permission 单测同步）；
goal-preflight 套件补两条**行为级**测试（chrys/codeagent 非 dry-run 抛
adapter_headless_permission_unsupported、dry-run 只 WARN），替代原源码 include 断言的
单薄覆盖（该断言保留作接线哨兵）。
