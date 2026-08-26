## 1. 契约冻结（t0）

- [x] 1.1 建 change `delegated-vision-provider`：proposal / design / 新能力 `delegated-vision` 与
      `agent-adapters` / `framework-local-config` / `goal-runner` / `visual-diff` 四份 delta
- [x] 1.2 `npm run openspec:validate` 通过（**通过前不得修改生产代码**）

## 2. Provider 身份与配置（t1）

- [x] 2.1 `ProviderRef {adapter, model}` 落 `utils/types.ts`（model 必填，不依赖 goal-manifest 类型）
- [x] 2.2 adapter schema 增 `visual_provider {readonly_invoke, image_transport, stdout_envelope,
      model_replay}`；`claude/codex/opencode` 三份完整声明入册；`codeagent/chrys/generic/cursor` 不声明
      （cursor 第一期因账号面受阻退出，见 7.7）
- [x] 2.3 adapter catalog 扫描该字段派生**唯一**支持列表；删除/禁止 TypeScript 白名单、模型钉 adapter
      集合交并、Claude-kernel 家族推断、文档手写名单；`goal_capability` 不参与 provider 资格
- [x] 2.4 `framework.local.json` `vision.visual_provider`：ownership 键 + vision 段解析校验 +
      写入只走 `updateLocalConfig`
- [x] 2.5 三形态入口与重选语义：普通交互态 / attended goal（local 缺失或现有 adapter unsupported →
      提示一次可重选可跳过，跳过本轮 blind 不重复问）；无人值守 WARN + 忽略 + blind
- [x] 2.6 `record-visual-provider` 个人 scope 任务 + confirmation-registry `setup.visual_provider`
      （机器写盘，agent 不手写 JSON）
- [x] 2.7 CLI 双参数 `--visual-adapter` / `--visual-model`：成对必填、归一化复用既有同款、CLI > local、
      unsupported 时 fail-fast 并列出 catalog 派生支持项
- [x] 2.8 manifest `visual_provider_pin` 条件入身份哈希 + 加载 shape 校验 + resume 读冻结值 +
      successor 继承 + 纯函数 `resolveFinalVisualProviderPin`

## 3. 三态路由与窄钳制（t2）

- [x] 3.1 `vision_mode` 派生纯函数（native / delegated / blind），preflight 派生一次、run 内不可变
- [x] 3.2 `CapabilitySnapshot` 可选键 `vision_mode` + `visual_provider`（写入者同批共享 `decision_id`）
- [x] 3.3 `FidelityCapability.reviewVision?` + `clampFidelityByCapability` 判据切换（旧调用面零改动）
- [x] 3.4 delegated 判定点传 `reviewVision: true`（phase advisory / harness-runner fidelityCtx / check-spec）
- [x] 3.5 `buildCapabilityBlock` delegated 分支 + `buildUnattendedExecutionBlock` 按 review 轴判
      pixel 可达性
- [x] 3.6 人签链与 OCR 链零改动（源码锚定回归断言）

## 4. 只读 invoke 执行器（t3）

- [x] 4.1 新模块 `utils/visual-provider-invoke.ts`：`resolveVisualProviderInvokePlan` 只构造只读
      `HeadlessInvokePlan`，不调用普通全权限 argv 构造器
- [x] 4.2 只读接线与各自 `stdout_envelope` 正文投影：已入册的 claude / codex / opencode，
      外加 `ask_mode` + `result_json` 机制（cursor 第二期复用，机制单测独立于声明）
- [x] 4.3 统一经既有 `invokeAgentHeadless` 执行；timeout 仅走 `AgentInvokeOptions.timeoutMs`；
      usage 仅消费 `AgentInvokeResult.usage`；禁第二套 spawn/timer/tree-kill/terminal/message/usage parser
- [x] 4.4 统一载荷校验：schema + 全屏覆盖 + 身份回显 + 当前图片 hash；坏/旧/不符一律 `unavailable|invalid`
- [x] 4.5 脏检查第二防线（invoke 前后 `git status --porcelain`；变脏即丢弃 + 记事件，不 revert 不 halt）
- [x] 4.6 `visual_provider_invoke` 事件 + 结构化事件流落 `<report_dir>/visual-review/<invoke_id>/`
- [x] 4.7 预算：不占 `max_total_turns` / `max_retries_per_phase`；占 wall clock；per-purpose 批次上限

## 5. spec 观察 sidecar（t4）

- [x] 5.1 `<spec reports>/visual-observations/<slug>.visual.json` 产物与形态（slug 复用 OCR 同款）
- [x] 5.2 三元复用键（`image_hash` + `provider(adapter,model)` + `protocol_version`）
- [x] 5.3 生产时机与 dispatch 对齐 OCR 预扫描（spec 产、plan/coding 只列）；单图失败不阻断、不产 check
- [x] 5.4 `CapabilityAdvisory.visualObservationPaths` + 能力块列出
- [x] 5.5 验读证据 best-effort 如实记录（无解析器即 unverified，不构成门槛）

## 6. review 评审接线（t5）

- [x] 6.1 触发点：capture 完成后、严格 `dispatchDeviceVisualDiff` 之前；非 delegated 整体跳过；
      异步显式化（同步 check 包装器不得吞 Promise）
- [x] 6.2 逐屏输入与输出合同（全屏覆盖 / defects+must_fix 锚定 / 双图 hash 回显 / pixel 追加
      `region_attest` `vl_screening`）
- [x] 6.3 合法载荷原子覆盖写 `visual-diff.json`（写前清旧、禁跨 attempt 复用）；
      `VisualDiffDefectSource` 扩展 `{producer:'visual_provider', invoke_id}` 并同步 schema/校验
- [x] 6.4 harness 确定性 verdict 映射；provider 不产 verdict、不写 `confirmed_by`
- [x] 6.5 裁决契约：合法即物化 repair candidate；**不进** `defect-review` / `repair_adjudication_pending`
- [x] 6.6 fail-open 写死：`unavailable|invalid` → `visual_diff {BLOCKER, SKIP}`，不跑严格 dispatch
- [x] 6.7 critic receipt delegated 窄分支（路径校验按 provider 事件流；受理与披露分立；不 halt）

## 7. 回归、smoke 与收口（t6）

- [x] 7.1 t1 单测矩阵（唯一支持列表 / 家族不放行 / `goal_capability` 缺失不影响资格 / 授权矩阵 /
      双旗标成对 / 三形态询问语义 / 无人值守 WARN+blind / 显式 CLI fail-fast）
- [x] 7.2 t2 单测矩阵（三态派生 / run 内不可变 / `reviewVision` 缺省逐字回归 / delegated 放行 pixel /
      blind 钳制表不变 / OCR 链零改动）
- [x] 7.3 t3 单测矩阵（各机制只读 plan golden / 全权限 argv 不可达 / 生命周期唯一性 /
      Codex 三事实消费 / 统一校验拒收矩阵 / 脏检查 / 批次上限 / 事件流落盘）
- [x] 7.4 t4 单测（三元复用键 / 单图失败不阻断 / 不产 check）
- [x] 7.5 t5 单测（fail-open 核心回归 / unverified 且合法照常回修 / 原子覆盖清旧 / 跨 attempt 拒收 /
      确定性 verdict 映射 / provenance 不触发 selfreport_integrity / receipt 双路径 / 人签零变化）
- [x] 7.6 typecheck + `cd harness && npm test` + `npm run openspec:validate`
- [~] 7.7 最小真实 invocation smoke（**用户触发**，宿主 `SimulatedWalletForHmos`，2026-08-26）
  - [x] **codex** 13/14 → 入册。argv `--ask-for-approval never exec --model gpt-5.6-sol --sandbox
        read-only --image <png> --json`，14.9s outcome=success；随机金丝雀四象限 4/4、token 逐字
        （唯一偏差 `0`→`O` 同形字，非视觉盲区）；`turn_jsonl` 投影成立；前后 porcelain 逐字节一致。
  - [x] **opencode** 16/16 → 入册。argv `run --pure -m deepseek/deepseek-v4-flash-vision-exp
        --file <png> --format json`，4.8s outcome=success；四象限 4/4 + token 逐字精确命中。
        本轮**发现并修复真缺陷**：`events_json` 投影原走 `extractJsonFinalResultText`，它拒收
        `type!=='result'` 的行，而 opencode 实际吐 `{type,timestamp,sessionID,part}` NDJSON、正文在
        `part.text` ⇒ 合法评审被误判 `invalid`。已新增 `extractOpenCodeFinalText` 按真实样本钉死。
  - [x] **claude** 16/16 → 入册（首轮卡 `OAuth session expired`，用户重登后复跑通过）。argv
        `-p --safe-mode --tools Read --allowedTools Read --disallowedTools mcp__* --model sonnet
        --output-format stream-json --verbose`，8.8s outcome=success；四象限 4/4 + token 逐字精确。
        首批**唯一** `input_provenance=verified`：有结构化验读解析器，事件流实证本轮图片确被读取。
  - [x] **cursor 退出第一期**（用户 2026-08-26 决定）。实测 argv/stdin 传输面成立（进程真实起转
        8.7s），被服务端拒于 `Named models unavailable Free plans can only use Auto`——账号档位与
        model 真实回放要求互斥。已撤 `agents/cursor/adapter.yaml` 的 `visual_provider` 块；
        `ask_mode` / `result_json` 机制留在词表内且有独立机制单测，第二期补回声明即恢复资格。
- [x] 7.7a claude `--safe-mode` 权限语义实测 + 只读单点负例对照（结论：单点成立，措辞已订正）
  - 事实一：`--safe-mode` **不含权限隔离**。`--help` 原文 "Auth, model selection, built-in tools,
    and permissions work normally."。天然 A/B：同一份 argv，用户级 `permissions.defaultMode`
    从 `bypassPermissions` 改为 `auto`，子进程 init 的 `permissionMode` 随之改变 ⇒ 该档位**穿透**
    `--safe-mode`；safe mode 只压定制面（skills 23→17、slash 64→45）。
  - 事实二：物理只读**由 `--tools Read` 单独承担，且在最坏组合下实证成立**。负例对照：显式
    `--permission-mode bypassPermissions` + 无诱导措辞命令其写文件，模型真实尝试后回报
    "I only have the `Read` tool available in this session—there's no Write, Edit, or shell tool
    provided"；目标文件未创建、`porcelain` 前后一致、事件流零写类工具调用。
    （首次负例用了带压迫感的措辞，模型识别为注入探针而直接拒绝，**遮蔽了机制层**，故改用中性
    措辞重做——这一步不可省，否则测到的是模型判断力而非只读机制。）
  - 结论：无写工具即无写路径，与 `permissionMode` 档位无关。
  - **裁决（2026-08-26，评审意见 1）：首期不补 `--permission-mode`。** 依据即上述实证——
    权限档位只决定「已有工具是否免确认」，**无法凭空增加写工具**；物理只读由工具可见性
    （`--tools Read`）保证，纵深防御不是当前正确性所需，按裁剪原则不加。
    **复检触发条件**：升级 claude CLI 锁定版本时重跑本节 smoke（若届时 `--tools` 语义或
    init 的 `tools` 回报发生变化，本裁决须重审）。
  - `agents/claude/adapter.yaml` 与 `design.md` 中「safe mode 隔离 settings/hooks」的原措辞
    已按实测订正。
- [-] 7.8 两个完整 delegated 宿主闭环 —— **用户 2026-08-26 决定取消**，改为版本发布后在宿主自然实测。
      原范围：同 adapter 异模型 / 跨 adapter 异模型，各验盲写→capture→provider 评审→物化回修→
      缺陷清零→candidate-pass→`await_human_confirm`→真人 `confirmed_by`→重跑方 PASS。
      **取消不降低 framework 发版门禁**：发版门禁本就必须独立于任何外部宿主（plan 冻结边界），
      仓内证据链完整——单测 3583/0 覆盖 fail-open / 跨 attempt 拒收 / verdict 映射 / 人签零变化，
      7.7 已用三个真实 provider 实证传输面与只读性。7.8 补的是**端到端收敛**这一层的经验证据，
      属发布后可观测项，不是正确性前提。
- [x] 7.9 三组 unsupported 反向测试（`codeagent`/`chrys`/`generic`）
- [x] 7.10 文档同步（goal-manifest schema 说明 / personal-setup-gate / goal runbook / 交互态文档；
      只说明声明规则并指向 adapter catalog，不另枚举支持名单）
- [x] 7.11 archive —— **宿主 smoke 侧门槛已满足**：7.7 三 provider 真实 invocation 全过、
      7.7a 只读单点负例对照实证成立、7.8 经用户决定取消；t7 第 8 节与最终评审均已收口。
      **归档方式**：同步 delta specs 至主规格后，由仓内固定版本 OpenSpec CLI 执行归档。
      （曾一度标为可 archive 并称「t7 另开 change 承载」，与 plan t7⑨ 冲突，已按单源原则回改。）

## 8. 启动契约：盲跑须一次显式授权（t7）

plan t7⑨ 冻结：**修订本 change**（delta 扩充 + tasks 新条目 + 决策矩阵 Scenario），**不另开
change**；本 change 的 archive 条件扩为本节单测与文档全过。下列条目未实施前 7.11 不得完成。

- [x] 8.1 统一规则：需求 UI 相关且 primary 无视觉时，进入 blind 必须持有一次明确盲跑授权；
      三形态是同一规则的三种授权载体——交互态当场「跳过并盲跑」/ attended goal 转译为
      `--allow-blind-visual` / 无人值守提前配 provider 或显式传旗标（不得两套政策）
- [x] 8.2 决策点位置：落在 **primary canary 尝试完成之后**、正式 phase 启动之前的纯决策；
      不新增生命周期、状态机或第二套 gate。`primaryHasVision` 复用既有 effective image-input
      解析链（`resolveContextAdapterImageInput`），不读本次 probeResult、不建第二套视觉真值
- [x] 8.3 优先级：`canaryHardCliFailure` 仍由既有 HALT 分支先行，不得用「缺盲跑授权」掩盖
      CLI 硬故障；`--dry-run` 只报 `would_block` WARN、不拦
- [x] 8.4 决策矩阵（冻结五分支）：非 UI 需求放行 / primary 有视觉 → native / primary 盲 +
      合法 provider → delegated / primary 盲 + 无 provider + 授权在场 → blind 放行 /
      primary 盲 + 无 provider + 无授权 → **启动 BLOCKER**（报错并列双出路）
- [x] 8.5 授权载体纪律：新增 `--allow-blind-visual` 独立旗标；不得以 `fidelity=reference_only`
      冒充授权；不得写入 `framework.local.json` 永久化
- [x] 8.6 落键与消费分离（v10 定稿）：显式收到旗标即在**身份漂移检查之前无条件**冻结
      `allow_blind_visual: true` 进 manifest（条件入身份哈希，与 `visual_provider_pin` 同点位）；
      canary 后的启动决策**只在 UI+blind+无 provider 分支消费**；不做 canary 后二次落键/
      身份 rebase/二次漂移裁决
- [x] 8.7 授权生命周期：resume 读冻结授权不重询；resume 新增授权走 `--override-manifest`；
      **successor 剥离该键**，新 run 必须重新显式传旗标（跨 run 静默授权是潜伏风险）
- [x] 8.8 启动契约与运行时降级分立：合法 provider 选定后运行中调用失败仍走 t5 既有 fail-open，
      不得因运行时故障反复停 run
- [x] 8.9 `visualProvider.state=unavailable`（配置存在但读取失败）归入矩阵的「无 provider」
      分支——读取失败不等价盲跑授权
- [x] 8.10 文档：`personal-setup-gate.md` 的「visualProvider advisory 永不影响启动」改述为
      「条件 prerequisite（goal 启动决策点生效）」；`check-personal-setup` 在缺 UI/primary
      上下文时不得全局报失败；goal runbook 与交互态文档同步三形态授权语义
- [x] 8.11 回归：五分支决策矩阵单测 / 授权冻结矩阵（无条件落键 + 条件消费）/ resume 读冻结 /
      successor 剥离断言 / 不落 local 负向断言 / `state=unavailable` 分支断言 /
      hard CLI HALT 优先于缺授权 BLOCKER / `--dry-run` `would_block` 不拦 / BLOCKER 文案含双出路
- [x] 8.12 t6 既有断言条件化复验：原「无人值守 WARN+blind」收窄为「非 UI 或授权在场时维持，
      UI 需求且无授权 → 启动 BLOCKER」；7.7 结果（调用器未改）**有效不重跑**，另补一组窄启动
      路径 smoke（无授权 BLOCKER / 加旗标落键继续 / 合法 provider 不误挡 / resume 用冻结授权）
- [x] 8.13 范围冻结：不碰 provider 调用器、review receipt、OCR、`evaluation_invalidated`、视觉 gate
