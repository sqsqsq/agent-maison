---
name: DeepSeek Harness adapter 接入——基础物化与 Goal 无头执行
version: 3.1.0
overview: 新增 deepseek-harness adapter，复用共享入口、技能薄跳板、个人设置及现有 Goal runner；首版使用 dsh 默认模型和文本输出，以物化、隔离接口探针、真实阶段调用及离线回归验证接入，不增加模型钉、JSONL 解析或宿主故障注入。用户于 2026-10-20 明确无需完成整项业务需求，取消业务全链验收。
todos:
  - id: t0-host-contract
    content: "T0：在隔离目录完成 P0–P3 低成本接口探针，确认版本/help、stdin/cwd、有效权限（含 Web 已保存非 full-access 默认值）和环境凭据正常路径；按实测确定权限注入或明确使用前提"
    status: completed
  - id: t1-materialization
    content: "T1：新增 deepseek-harness adapter 与 registry 文案；复用共享入口、.dsh/skills 内置及实例跳板和 portable 交互；CREATE/UPDATE、个人选择、共存与退役清理用现有链和离线回归覆盖"
    status: completed
  - id: t2-headless-invoke
    content: "T2：接入 dsh 结构化启动、session binary 解析、stdin/cwd 和统一环境注入；复用 Windows containment、preflight、超时及恢复；仅在 T0 证明必要且有效时使用权限 patch，不改用户持久配置"
    status: completed
  - id: t3-model-pin
    content: "T3：首版明确不支持模型钉与自动替代模型；在 resolveFinalModelPin 和 decideModelAlternative 复用现有不支持出口，补 CLI/manifest/恢复与替代路径的离线拒绝用例及使用说明"
    status: completed
  - id: t4-output-outcome
    content: "T4：沿用 dsh 默认 stdout 终稿、stderr 推理/诊断和退出码；不启用 --json、不新增解析器；usage_capture=none，以离线夹具核对生产调用链的成功/非零退出/诊断与超时处理"
    status: completed
  - id: t5-tests-docs
    content: "T5：注册 DSH 目标测试，更新 adapter notes、agents/README、Goal runbook 与相关能力说明，补扩展技能命名限制；完成目标测试与一次 harness npm test 全量验收"
    status: completed
  - id: t6-real-host
    content: "T6：原整项业务 Goal 验收已由用户于 2026-10-20 取消；已停止 bc-openCard-2 业务进程与自动跟进，保留设计资料。取消不表示业务验收通过；已取得的接入证据由 T7 汇总"
    status: cancelled
  - id: t7-delivery
    content: "T7：接入收口——复用上一轮 5500 单测 + 46 fixtures 全量结果、既有 r2 ZIP 内容校验；T10 已采纳用户提供的存储认证成功 review 证据，本轮补 T12 Unicode 读取修复与定向验证；正式发布仍遵守全局窗口门禁"
    status: completed
  - id: t8-desktop-shim
    content: "T8：最小通用化 exe/node shim 解包，保留固定参数、按 cmd 语义展开 dp0，字面环境经过统一清洗；Electron 夹具通过正式 invoke+guardian，npm 回归保持通过"
    status: completed
  - id: t9-missing-credential
    content: "T9：只接入已采样的非零退出 + 行首 dsh: MISSING_CREDENTIAL:，复用外部硬失败分类；正式 runner 用例证明不占内容重试且总调用/时长仍记账"
    status: completed
  - id: t10-desktop-probe
    content: "T10：桌面启动/权限及工具写入已通过；用户提供的 2026-10-20 review 已验证保存 DEEPSEEK_API_KEY 后，移除进程环境 DEEPSEEK_API_KEY/VOLC_API_KEY/DSH_HOME、PATH 无 dsh，安装记录兜底 → 生产 invoke+containment 成功 exit 0 / OK，无 dsh: 诊断，凭据哈希一致。本轮复用证据，不重跑模型"
    status: completed
  - id: t11-repair-validation
    content: "T11：typecheck 通过；定向 DSH adapter 8/8、agent-containment 23/23、hard-cli 26/26；一次 npm test 全量 5496 单测 + 46 fixtures 全通过。桌面 PATH 未发现，P1/P2 未执行；未安装、未提交/推送、未改 PATH、未触碰宿主"
    status: completed
  - id: t12-desktop-discovery
    content: "T12：仅 Windows dsh 在 PATH/known-dirs 未命中时，用 PowerShell Registry provider 只读查询官方卸载记录并以 UTF-8 输出 JSON；保留读取注入口、HKCU 优先、shim 存在才采用、失败回 null；覆盖中文 InstallLocation 和既有四类离线用例"
    status: completed
  - id: t13-stored-credentials
    content: "T13：固定 headless-patch.yaml 已合并权限和官方存储认证三行，引用/指引/路由及优先级说明已同步；typecheck、受影响 70 项及一次 npm test（5500 单测 + 46 fixtures）全通过。保存凭据成功路径已由 T10 的 review 证据闭合"
    status: completed
isProject: false
---

# DeepSeek Harness adapter 接入实施计划

创建日期：2026-10-20。计划编号：`6d2e9a47`。当前窗口为根 `package.json.version = 3.1.0`，本计划不推进版本。本文已按本轮 review 修订范围，原模型固定、JSONL 解析和宿主故障矩阵不再是实施任务。

## 1. 目标、责任与完成边界

新增官方 DeepSeek Harness 的独立 adapter：**标识 `deepseek-harness`，显示名 DeepSeek Harness，执行二进制 `dsh`**。不将其与 DeepSeek 模型 provider 混为一体，不新增别名配置。

交付同时包含两项：

1. **基础物化可用**：通过 `/framework-init` 选择新 adapter；DSH 能发现 Maison 内置技能及符合其命名约定的实例扩展；个人选择、UPDATE、共存和清理沿现有机制运行。
2. **外部 Goal/headless 可用**：现有 Goal runner 能在满足无人值守前提的环境中调用 DSH 默认模型；以真实阶段调用验证接线，失败、超时、恢复、授权、范围和预算沿既有机制处理。本次接入不承担银行卡需求的完整业务交付。

adapter 只负责入口映射与宿主调用差异；Maison 继续拥有阶段、验收、ledger、预算和恢复；DSH 拥有默认模型选择、工具执行和原生会话。DSH 进程成功不等于 Maison 阶段通过，最终结论仍由既有 harness/assess/receipt 链形成。

消费者 `framework/` 是 **Maison 发布件解压目录**。依赖只安装在 `framework/harness`；不使用 submodule 拓扑，不在消费者根安装 framework runtime，也不把 DSH 加成 Maison runtime 依赖。

首版不做模型 pin、自动替代模型、JSONL 方言解析、精确用量采集、Cordis 插件、ACP/SDK 服务、第二套调度器、专属 verifier、视觉 provider、结构化 widget、原生会话恢复映射、跨回合唤醒或新增场外状态。需要模型 pin 时另按真实需求立项。

## 2. 事实依据与证据边界

上游分析基于官方快照 `687f282e8625c6b8d11ff58211a90524be2e4317`，不代替实际安装版本验证。本机已安装桌面版 `0.2.1-rc.2`，随包 shim 为 `D:\Program Files\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd`。用户已通过「应用 → 管理 dsh 命令… → 安装」注册，用户 PATH 已含该 bin 目录，新进程的统一 resolver 已确认命中；HKCU 卸载记录 `1bf39983-50d0-5fe0-9ef4-cece76f67c5e` 的 InstallLocation 为 `D:\Program Files\DeepSeek Harness`。上一轮 P0–P3 和业务阶段实跑均使用自行安装在 `.codex/reports/dsh-probe/runtime` 的 npm 版 `0.2.1-rc.2`，不能冒充桌面版验证。本轮不安装软件、不改 PATH/注册表/凭据文件，不用 npm 版代替桌面实测。

| 已核对事实 | 本批决策 | 来源 |
|---|---|---|
| 默认加载 AGENTS.md、CLAUDE.md；相同内容按组去重 | 复用共享 AGENTS.md；共存主要用离线测试，真实宿主仅观察实际启用的组合 | [agent-instructions](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/context/agent-instructions/README.md) |
| 发现项目 `.dsh/skills`、`.agents/skills`，要求合法技能名 | 使用自有 `.dsh/skills`；说明命名限制，不改全局 slug 规则 | [skill-filesystem](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/skill/skill-filesystem/README.md) |
| 默认 headless 接收 stdin；最终 completed 退出 0，其他结局退出 1；终稿到 stdout，推理和诊断到 stderr | 使用文本模式和现有退出码判据，不增加 JSONL 校验层 | [headless](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/bundle/headless/README.md) |
| 新会话默认权限取 `config.defaultPreset.get() ?? inferredDefault`；设置参与默认选择 | 环境变量只证明兜底输入，必须测试 Web 已保存设置；不预设 patch 能覆盖 | [permission-presets 源码](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/interaction/permission-presets/src/index.ts) |
| headless 默认关闭存储认证；官方支持以 patch 启用 credentials/authorization/deepseek-account | 固定 patch 启用 DSH 自身存储；保存值优先于环境及 .env，不由 Maison 提取秘密 | [headless credentials](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/bundle/headless/README.md#credentials) |
| Maison 的 adapter_model 可选；已有不支持模型 pin/替代的出口 | DSH 首版复用拒绝出口，用户在 DSH 自身配置默认模型 | `skills/project/goal-mode/SKILL.md`、`goal-manifest-cli.ts` |

**权限尚未核实的部分**：目标安装版本中，Web 保存值如何作用于 headless、环境变量和 patch 能否覆盖，均以 P2 实测为准。源码中的缺省选择顺序足以要求覆盖该场景，不能据此宣称所有版本必然失败，也不能把“可能覆盖”写成已经解决。

安装/升级按宿主既有授权执行，init 不自动安装 DSH。若目标版本缺少必需能力，记录版本差异和可用前提，不能猜测旗标或伪称完整支持。

## 3. 复用方案

### 3.1 物化与个人选择

`agents/deepseek-harness/adapter.yaml` 按现有 schema 声明：

| 字段 | 方案 |
|---|---|
| `agent_entry_file` | `template_path: templates/AGENTS.md.template`，`target_path: AGENTS.md` |
| `commands` | `null`；使用原生技能入口 |
| `skill_bridge` | `target_dir: .dsh/skills`，`template_dir: ../shared/agent-bundle/templates/skills-bridge` |
| `rules` | `.dsh/rules`，复用 shared rules；明确为按需引用文档，不宣称 DSH 自动加载 `.mdc` |
| `user_confirmation` | `structured_widget: unsupported`、`portable_required: true`；引用现有 generic portable renderer，不新建同文副本 |
| `instance_skill_bridge` | 不重复声明目录；现有解析器回落到 `skill_bridge.target_dir` |
| `post_install_hooks` | `[]`；不修改用户 DSH profile/home 配置 |

在 `confirmation-registry.yaml` 的 `init.materialized_adapters.options` 增加 value/label/portable。磁盘 adapter + registry join 仍是候选来源，不在 Skill 菜单中新增硬编码列表。

复用 check-init、init planner/executor、render-agents-md、instance-skill-bridge 和 legacy cleanup。`goal-mode` 特殊跳板走现有生成器，运行身份仍由 local-first 个人设置解析，不在共享模板写死 adapter。

generic/Claude/OpenCode 与 DSH 的共存组合由离线物化测试覆盖；真实宿主只观察已经使用的组合，不为验收额外安装或物化其他 agent。共享入口遵循既有 ownership，专属技能目录互不覆盖。AGENTS.md/CLAUDE.md 的重复加载本身不阻断，只有实际指令冲突、关键规则不可见或错误身份路由才修对应消费点。

**实例扩展命名限制**：DSH 技能名须匹配 `^[a-z0-9]+(?:-[a-z0-9]+)*$`。现有 `sanitizeBridgeSlug` 允许大写和下划线，不能保证产物符合 DSH 要求；不合规扩展可能只留下警告而不进入 catalog。在 adapter notes 和 runbook 明确要求使用小写 kebab-case；本批不改共享 slug 算法、不静默重命名既有扩展、不新增阻断检查。

### 3.2 Goal 能力声明

经接口探针、离线回归和真实阶段调用验证接线后声明 `goal_capability.mode: external_runner`，`external_runner.unattended` 为 `write_mode: full-access`、`approval_mode: never`。运行时启动 SSOT 为 agent-invoke；YAML 同步实际行为和使用前提，不能仅靠声明证明有效权限。

不声明 `in_session_reconcile`、`phase_context_isolation`、adapter 原生 `supports_resume`、`handoff` 或 `survival.*`。Maison 的既有 detached Goal 恢复继续使用 ledger，每次 phase/attempt 新开 DSH 会话，不传 DSH `--session-id`。该恢复路径由离线生产链回归覆盖，本轮不要求故意中断宿主来认证。

`image_input: none`、`tool_event_provenance: none`、`usage_capture: none`；不登记 visual_provider 或 verifier_subagent。保留既有能力缺失说明，不为 DSH 特设业务验收豁免。`output_delivery` 按默认模式实际观测填写，区分 stderr 推理流和 stdout 终稿；无足够证据则维持 unknown，不增加专门挂起实验。

### 3.3 启动、权限与使用前提

增加 `dsh` binary candidates，复用 resolveSessionBinary、Windows shim/exe 解析、cross-spawn 和 guardian containment。`HeadlessInvokePlan.adapterName` 明确为 `deepseek-harness`，诊断不掉入 agent-cli 或 Cursor 兜底。

Windows 候选名恰为 dsh 且 PATH/既有 known-dirs 未命中时，仅在 `resolveHeadlessBinary` 中只读启动 `powershell.exe -NoProfile -NonInteractive`（shell:false）。Registry provider 的 Get-ItemProperty 按 HKCU、HKLM 查询 `Software\Microsoft\Windows\CurrentVersion\Uninstall\*`，筛选 DisplayName 以 DeepSeek Harness 开头的项，只以 UTF-8 JSON 输出 DisplayName/InstallLocation，避免 reg.exe 的 OEM 代码页损坏中文路径。从 InstallLocation 拼接官方 `resources/runtime/cli/bin/dsh.cmd`；实际文件存在才采用 kind=cmd。保留读取注入口；查询/解析失败或文件不存在返回原 null/提示，不猜安装目录、不修改环境和注册表、不在三个调用入口重复实现。

默认启动为 **`dsh --profile headless`**，prompt 走 stdin，cwd 为显式消费者根；不加 `--json`。不使用 shell 拼接、prompt argv、PowerShell 环境赋值字符串或 `npx latest`。

权限实施按 P2 结果选择最小可用路径：

1. 在统一 spawn 环境边界为 DSH 注入 `DSH_PERMISSION_MODE=danger-full-access`，验证缺省情况下的新会话有效 full-access + never。
2. **单独覆盖 Web“设置→通用→权限”已保存 workspace-write 等非 full-access 默认值的情形**，确认该保存值在目标 headless 版本中的作用，不能用相反 profile 缺省替代。仅当环境变量不足时，再在同一隔离探针验证官方 patch 是否有效；不预设 patch 优先级高于保存设置。
3. 环境注入已满足契约就不实现 patch。只有 P2 证明权限 patch **必要且有效**时，才接入最小调用级配置；否则将 DSH 需预先配置有效 full-access/never 写为与凭据并列的使用前提，不新增设置检测器、停机原因、自动重配或第二套权限状态。
4. 使用前提必须给出经目标版本验证的配置方法，并重新跑正常路径证明有效。不能把“已写前提”当作无人值守已通过，也不能宣称支持未经验证的配置组合。

DSH 专属环境只在 `buildAgentSpawnEnv` 所在公共启动边界按显式 adapter 身份注入；复用大小写去重、信任锚剥离、HEADLESS 定档。guardian 和普通 spawn 使用同一最终环境；phase、修复、恢复调用方不各自拼环境。

P2 已证明固定权限 patch 必要且有效；本轮将其重命名为发布件内的 `agents/deepseek-harness/headless-patch.yaml`，保留 permission.defaultPreset，并增加 credentials、authorization、deepseek-account 三项 disabled:false。复用同一个只读 `--patch`，不生成临时配置或读取/复制凭据，不改用户持久设置。

runbook 在同一段列清实际版本、headless 有效权限、凭据和默认模型前提：在同一 DSH_HOME 的桌面版/Web 模型设置中保存 headless 实际模型/provider 路由所需 key；启用存储不等于同步桌面默认模型。优先级为保存凭据、启动环境、工作目录 .env、DSH_HOME/.env。用户也可使用这些环境来源；Maison 不读/复制/打印凭据、不 dump 全量环境/配置、不覆盖 profile、home patch 或 .env。缺凭据提示先引导模型设置。首次启动由 DSH 自行初始化 profile 属上游行为，应说明。

### 3.4 首版模型边界

`--adapter-model` 是可选能力，本批不实现模型固定或自动替代。无 pin 时使用 DSH 已配置默认模型，不把默认值写成 Maison 已冻结的模型承诺；用户要换模型时在 DSH 自身配置。

在 `resolveFinalModelPin` 现有 chrys/generic 不支持分支加入 deepseek-harness：CLI 显式 pin、manifest 中已有/继承 pin，以及 resume/successor 带入的 pin，均沿既有出口清晰拒绝，不能静默忽略。

同步核对 `decideModelAlternative` 的相同不支持分支，使获准替代清单也不能触发 DSH 模型切换。两条消费路径使用一致判定，不新增能力注册表。沿现有解析顺序核对 `goal-manifest.ts` 的已知 adapter 形状校验；如为获得一致错误提示需要登记名称，仅表示形状已知，不表示支持 pin，最终仍须拒绝。

保留原有换 adapter/manifest 授权规则，不为本次接入重设计 successor。补正常无 pin 运行和所有不支持入口的离线测试，并同步 Goal Skill/runbook 的不支持说明。删除 provider/model 新格式、模型 overlay、H7 非法模型宿主实验与模型回放实现任务。

### 3.5 文本输出、失败与预算

依赖已核对的 DSH 默认模式退出码契约：正常完成退出 0，驱动失败/中止/错误退出 1；stdout 为终稿，stderr 含实时推理与 `dsh: <code>: <message>` 等诊断。直接复用现有 invoke 结果、日志、超时、settle 和失败恢复。

不新增 `deepseek-harness-envelope.ts`，不要求 JSON final/turn_end 二次验真，不做跨 chunk/64 KiB 尾部协议解析，不从正文 PASS/FAIL 猜测调用结论。DSH 不注册终态事件解析器或额外 completion 观测，现有基于业务闭环证据的通用完成机制保留。

在实际生产调用链补离线用例：退出 0 且 stderr 有推理不判失败；非零退出保留失败与原始诊断；spawn 失败/超时按既有结果处理。已有 CLI 硬失败分类在非零退出时按行首签名判断，不把 stderr 非空当失败，也不新写扫描推理正文的故障正则。若 `dsh:` 的特定诊断确需接入既有分类，只依据具体样本修原分类点，不新增通用解析层或人为宿主失败实验。

`usage_capture: none`，沿既有 proxy/null 用量口径，不做精确统计。硬预算仍由现有 turn/retry/wall-clock 和 ledger/events 派生；恢复或新 DSH session 不重置 Maison run 预算。失败/超时/恢复以离线夹具和受控子进程测试覆盖共享生产路径，不复制 runner 状态机。

## 4. 改动落点

路径相对仓库根；核对项无实际缺陷时不修改实现。

| 落点 | 范围 |
|---|---|
| `agents/deepseek-harness/adapter.yaml` | 新增声明、共享模板引用和版本/权限/命名限制 |
| `skills/reference/confirmation-registry.yaml` | 候选文案 |
| `harness/scripts/utils/agent-invoke.ts` | dsh candidates/plan/显式身份和统一环境注入，复用既有输出/退出处理 |
| `harness/scripts/utils/agent-containment.ts` | 桌面 Electron shim 的固定参数、字面环境及 dp0 展开；不写 DSH 安装路径特例 |
| `harness/scripts/utils/headless-binary-resolve.ts` | Windows dsh 在 PATH/known-dirs 均未命中后只读查询官方安装记录；仍未发现时复用菜单提示 |
| `agents/deepseek-harness/headless-patch.yaml` | 固定权限 patch 重命名并启用官方存储认证三项，同步全部运行引用 |
| `harness/scripts/utils/vision-canary.ts` | 将已采样的 MISSING_CREDENTIAL 精确签名接入现有硬失败分类，避免内容误重试 |
| `harness/scripts/init-orchestrate.ts` | 已修复 UPDATE 新增 adapter 时 decision/context 清单未同步，复用既有同步函数 |
| `skills/project/goal-mode/SKILL.md` | 已将无人值守前提表述为 external runner preflight；resume/handoff 仅约束跨载体交接 |
| `goal-manifest-cli.ts`，必要时 `goal-manifest.ts` | pin 与自动替代均不支持；形状解析与错误提示一致 |
| `goal-preflight.ts`、`goal-phase-runtime.ts`、`goal-adapter-capability.ts` | 核对正式、修复及恢复调用方复用同一启动路径，只补必要接线 |
| check-init、init planner/executor、render-agents-md、instance-skill-bridge、legacy cleanup、init-next-steps、个人 setup | 预期声明驱动即可复用，以离线回归确认物化与身份闭合 |
| `harness/tests/unit/deepseek-harness-adapter.unit.test.ts`（新）、相关 suite 与 `tests/run-unit.ts` | 注册目标测试；复用文本 stderr/退出码 fixture 和共享子进程测试，不新增 JSONL 套件 |
| agents/README、根 README、Goal runbook、Goal Skill、必要的 adapter-schema 说明 | 同步首版支持范围、使用前提、扩展命名与未验证范围 |

不修改 usage-capture 或通用 slug 规则，不新增模型/用量/JSONL 注册层。对 keyed registry、adapter 名比较和路径假设做一次有范围核对，不扩展为全仓重构。

## 5. 新增机制准入

| 必要新增 | 真实场景与收益 | 边界 |
|---|---|---|
| adapter 与 catalog 文案 | 用户在 DSH 发现 Maison 入口并选择个人执行器 | 复用现有物化/选择，不增加安装器 |
| dsh 启动及环境注入 | 无人值守执行需要正确二进制、stdin、cwd 与权限 | 单一启动边界，不增加 runner |
| 首版模型能力拒绝 | 有人传入 pin/替代清单时，不能声称固定成功却仍用默认模型 | 复用现有拒绝出口，无新门禁机制 |
| 权限 patch（条件项） | 仅 P2 证明环境不足且 patch 有效时，解决已证实配置冲突 | 不预建；无效就明确使用前提，不继续堆机制 |
| 官方安装记录兜底 | DeepSeek Harness 桌面版用户无需手动注册命令或重启已有程序即可定位随包 CLI | 仅统一 resolver 的 Windows dsh 最后兜底；只读 HKCU/HKLM，不猜路径 |
| headless 存储认证 patch | DeepSeek Harness 桌面版用户复用已保存的路由凭据，不因工具 shell 过滤 KEY 而必然缺凭据 | 仅启用上游组件，Maison 不提取秘密；保留实际模型路由及 DSH_HOME 前提 |

不新增每次运行的宿主认证、版本证书、权限检测或状态注册。必要的失败映射复用已有 disposition/incident；不为缺少精确用量、重复入口或未运行的可选实验增加阻断。

## 6. 收窄后的验证安排

用户于 2026-10-20 进一步收窄验收：**只验证 DSH 接入，不要求完整业务交付**。复用少量隔离接口探针、新发布件物化和已经发生的真实阶段调用；不再启动或恢复完整银行卡任务，不增加故障注入和重复验证。

### 6.1 T0：隔离接口探针

隔离目录/配置只用于廉价接口确认；不污染用户真实项目、Web 设置或凭据。涉及保存设置时使用隔离 DSH home/profile，并确认与 Web 保存路径同源；不以直接修改一个无效配置键冒充覆盖。

| 编号 | 动作 | 验收标准 |
|---|---|---|
| P0 版本/help | 记录实际 dsh 路径、版本、安装来源及 profile；查看 help | 目标版本支持 headless/stdin；区分 GUI 与 CLI 版本；不要求 JSONL 或模型旗标 |
| P1 stdin/cwd | 在隔离目录通过公共调用路径发送一个短文本任务，检查 cwd 与输入 | stdin 完整、cwd 正确，Windows 解析/启动可用；长输入、中文/空格路径、引号边界主要由离线子进程用例覆盖 |
| P2 有效权限（原 H4） | 比较无保存设置与 **Web 已保存非 full-access 默认值**两种新会话；验证环境注入，必要时比较 patch | 记录真实有效 sandbox/approval；确定环境、有效 patch 或使用前提之一；按最终方案验证 full-access + never 正常执行，不预设 patch 胜出 |
| P3 凭据正常路径 | 通过启动环境提供有效凭据完成一次正常调用，可与 P1/P2 合并 | headless 可执行、无需 GUI 登录；记录不含 key/token，不构造失效凭据或非法模型 |

P2 的设置比较仅是本批权限接口的针对性探针，不扩成故障注入矩阵。只在隔离范围验证必要工具操作，不借 full-access 测试任意宿主路径。探针结果按目标版本记录，不要求每次运行重复探针。

本轮 T10 合并桌面小探针：新进程经 PATH 解析桌面 shim 并以正式 invokeAgentHeadless+containment 验证 stdin/cwd；另一进程只删除自身 PATH 的 dsh 目录，验证安装记录解析到同一 shim（不调用模型）。凭据探针仅移除自身 DEEPSEEK_API_KEY，使用真实 DSH_HOME、隔离 cwd，完成一次简单写入并确认有效 danger-full-access/never。总计 2–3 次模型调用；每次前后只计算凭据文件哈希，变化立即停止汇报。使用 DSH credentials.describe 的 configured/source 元数据核对实际路由来源，不获取值；不能把清掉环境变量后的成功误当作排除了 home .env。不会修改用户凭据、PATH、注册表或任何宿主。

### 6.2 已取得的宿主接入证据与业务验收取消

新包已在指定宿主完成 UPDATE、个人设置及内置/实例技能物化。真实 DSH 主任务读取需求、生成设计和 CU，并启动 Maison Goal；凭据环境修复后，同一 run 继续执行 spec 并进入 plan，证明启动与阶段接线已实际运行。

同时发现使用边界：DSH 原生 subprocess 会过滤含 KEY/PASSWORD/SECRET/TOKEN 的环境变量，因此主 DSH 有凭据不代表其工具 shell 启动的外层 Goal runner 也有。本轮固定 patch 启用 DSH 自身保存认证，可复用同一 DSH_HOME 内对应路由的保存凭据；未保存时仍需实际启动环境或 DSH 原生 .env 来源。不开上游过滤旁路，不从注册表或凭据文件提取秘密，不输出密钥，也不宣称环境凭据自动跨工具 shell 透传。

用户明确指出完整银行卡交付超出接入目标后，已删除自动跟进并停止主 DSH、Goal 及相关子进程。业务编码尚未开始，现有设计资料保留；运行记录属于中断现场，不写成 completed 或业务 PASS。本次停止是用户收窄范围，不是故障注入测试。

原 H0–H10 全项通过、整项需求闭环及未使用的共存组合均不再作为接入发布条件；离线失败/超时/恢复用例继续保留，未实测部分如实披露。

### 6.3 离线测试必须经过生产路径

- 物化/catalog/setup：候选完整，CREATE/UPDATE 幂等、实例扩展、用户文件保护、清理、共享入口 ownership、多 adapter 共存；DSH 命名限制作为说明，既有共享行为不变。
- 启动：调用真实 plan 构造与 spawn/environment 边界，用受控本地子进程验证 stdin、cwd、Windows shim/guardian、环境清洗、adapter 诊断及失败返回；不只断言一个未接线 helper。
- 模型边界：无 pin 正常；CLI/manifest/恢复/继承 pin 拒绝；替代清单走 adapter_unsupported，不修改冻结模型或绕过授权。
- 输出与恢复：文本成功、stderr 推理、非零退出及 `dsh:` 诊断、spawn 失败、超时回收；用已有 runner 测试入口验证共享恢复与预算连续性，复用仍有效的测试，不重建另一套恢复协议。
- 只有 T0 选定权限 patch 后才增加对应的最小配置/文件生命周期用例；未采用则无此实现和测试任务。

脱敏样本、日志和结果沿既有测试 fixtures/宿主报告目录保存，记录版本、命令、退出码、预期/实际和证据路径即可，不新增证书、签名或哈希链。

## 7. 实施顺序与验证命令

T0 与基础物化/离线用例可独立推进；T2 权限行为以 T0 结果落定；T3/T4 完成最小接线；T5 完成自动化验证；T7 汇总既有宿主接入证据并收口。T6 的整项业务验收已按用户裁决取消，不作为隐藏待办恢复执行。

开发中按实际改动运行 `npm --prefix harness run typecheck` 与受影响 suite，例如 `npm --prefix harness run test:unit -- --filter deepseek-harness`，确认实际选中用例，不把 0 用例当通过。

最终发布内容验收运行一次 `cd harness && npm test`（包含 typecheck、unit、fixtures），之后复用仍有效的结果。用 `npm run release:verify -- --skip-typecheck` 检查发布件，确认新 adapter/运行模块、LF 与开发文件排除正确。正式发版沿既有 release:all，本计划不自动发布或升级宿主。

上一轮 T12/T13 实现已通过完整 npm test。本轮仅修 T12 编码并采纳 review 的 T10 成功证据，按用户要求运行 typecheck、headless-binary-resolve 与 deepseek-harness-adapter 两个 suite，并做一次真实注册表读取/解析，不调用模型。复用上一轮 5500 单测 + 46 fixtures 结果，不重跑全量、不打包、不跑完整业务需求。

## 8. 收口与版本责任

完成依据为：首版实现与离线回归通过，P0–P3 的接口/前提明确且正常路径通过，物化及真实阶段调用验证了接线，能力说明如实，候选模式的发布件内容校验通过。**不以完整业务需求、故障注入、未使用的共存组合、模型 pin 或 JSONL 能力作为完成条件。**

当前保留 `version: 3.1.0`，不再等待 bc-openCard-2 整单交付。桌面 shim、缺凭据分类、安装发现和存储认证属于本次接入返修，T8–T13 按事实完成后才收口；不得把桌面环境认证成功宣称为保存凭据成功。其它 plan 的未完成项和正式发布门禁不变，本轮不推进版本、promote、提交或推送。

缺宿主或凭据时保持相关 todo pending/in_progress，只报告具体缺口并继续独立工作。不把被本轮明确删除的实验继续挂为隐形待办，也不将宿主未观察的恢复宣称为认证通过。

本轮 review 处置：第 1/2 条必须修复已纳入权限探针和收窄验收；第 3/4 条非阻断建议本轮采纳，模型 pin 与 JSONL 解析移出首版；第 5 条落实到 adapter notes/runbook 的命名说明。后续只核这些意见和返修直接回归，修复闭合即收口，不扩大首版。

## 实施记录（2026-10-20，桌面发现与保存认证）

- 两项实现已落在统一 resolver 和固定 headless-patch.yaml；没有调用方分叉或凭据读取器。离线测试覆盖 PATH 优先、HKCU/HKLM 回落、缺失文件/错配记录及非 Windows；生产 plan 校验四行 patch。
- 桌面 0.2.1-rc.2：P1 经 PATH → invokeAgentHeadless → guardian，exit 0，stdin/cwd 通过；新会话 danger-full-access + never。进程内排除 dsh bin 后，同一 shim 由官方安装记录命中；禁用该兜底则 null。没有修改持久 PATH 或注册表。
- P1 实际默认路由 deepseek-official / deepseek-flash，DEEPSEEK_API_KEY 的 source=env。桌面 profile 选用 volcengine / deepseek-v4.1-flash；因此 P2 以探针专用 patch 选择已有桌面路由，同时移除自身 DEEPSEEK_API_KEY/VOLC_API_KEY，未改变用户默认模型或产品能力。
- P2 describe(VOLC_API_KEY) 为 configured=false，实际调用 exit 1 / MISSING_CREDENTIAL，未执行工具写入；有效权限仍为 danger-full-access + never。P3 保留原启动环境、使用相同火山路由，describe 为 configured=true / source=env，工具写入成功且 exit 0；用户既有 DSH 配置可用，不能将 P2 结果概括为用户未配置。三次调用前后凭据文件 SHA-256 均为 e5d547c2e6ac556570fc3b1f6b4f3219684829363f7d908025273cc6bf805355；仅计算哈希，未查看/输出内容，未改写文件。当时存储认证成功路径未完成；后续成功证据见下方收尾记录，不能把旧结论继续作为当前缺口。
- 偏离说明：P2/P3 因桌面/headless 路由不同增加探针专用非秘密模型/provider 配置与只读元数据观察器，均仅保存在开发仓忽略目录，不进入发布件；没有增加产品模型钉或自动同步模型。总计三次 headless 调用（两次成功、一次缺凭据失败），不再调用模型，不碰任何宿主。
- 桌面证据：`.codex/reports/dsh-desktop/registry.json`、`p1-result.json`、`p2-result.json`、`p3-result.json`；仅保存脱敏日志和非秘密元数据。
- 验证：开发 typecheck 通过；受影响 suite 为 deepseek-harness-adapter 8/8、agent-containment 23/23、goal-canary-hard-cli-d7f3a9c4 26/26、headless-binary-resolve 13/13。收口一次 `cd harness && npm test`：typecheck、5500 单测、46 fixtures 全通过，unit 墙钟 705.156 秒。日志 `.codex/reports/dsh-desktop/full-test.log`；plan 默认校验、git diff --check 与 LF 检查通过。
- 本轮文件：本 plan；agents/README.md、agents/deepseek-harness/adapter.yaml、headless-patch.yaml（原 headless-permissions.yaml）；docs/operations/goal-mode-runbook.md；harness/scripts/utils 下的 headless-binary-resolve.ts、agent-invoke.ts、vision-canary.ts；harness/tests/unit 下的 headless-binary-resolve、deepseek-harness-adapter、goal-canary-hard-cli-d7f3a9c4 三个 suite。其余既有改动未扩大。
- 未建分支、未提交/推送、未安装软件、未打包、未修改持久 PATH/注册表/凭据文件，未读写任何宿主工程；全程在 main，未混入业务需求实现。

## 收尾记录（2026-10-20，T12 编码与 T10 证据闭合）

- 用户提供的 review 证据：已在 DSH 模型设置保存 key；`~/.dsh/.credentials.yaml` 的 refs 中存在 DEEPSEEK_API_KEY，review 只核结构、未查看值。本轮不再读取该文件或调用模型。
- 2026-10-20 review 探针移除了自身环境的 DEEPSEEK_API_KEY、VOLC_API_KEY、DSH_HOME，且 PATH 没有 dsh；由 T12 安装记录兜底解析到桌面 dsh.cmd，使用真实默认 DSH_HOME、隔离 cwd，经生产 resolveHeadlessInvokePlan + invokeAgentHeadless 且 containment 打开，结果 exit 0、stdout 为 OK、无 dsh: 诊断、凭据文件前后哈希一致。采纳该证据关闭 T10；不冒称为本轮重新实测。
- T12 编码修复用系统 PowerShell 的 Unicode Registry provider 替换 reg.exe OEM 文本读取，以 UTF-8 JSON 传回；保留统一 resolver 的触发条件、优先级、shim 存在检查与失败兜底。读取注入口仍为 readUninstallRegistry；没有新增依赖或注册表写入。
- 与原 plan 的差异：只读载体由 reg.exe 改为 PowerShell；T10 复用用户提供的 review 实跑结果；本轮按用户明确要求不跑全量，复用上一轮 5500 单测 + 46 fixtures 通过结果。正式发版门禁留到发布时执行。
- 本轮验证：`npm --prefix harness run typecheck` 通过；明确选中 headless-binary-resolve（14/14）与 deepseek-harness-adapter（8/8）。新增用例名为「DSH 安装记录：中文 InstallLocation 指向存在的中文目录和 dsh.cmd」，保留既有优先级/失败/非 Windows 回归。
- 真实读取：同一验证进程调用生产读取函数查询 HKLM、HKCU；HKLM 为零匹配项，HKCU 命中 DeepSeek Harness 0.2.1-rc.2，两者输出中的 U+FFFD 均为 0。仅隔离验证进程的 PATH 后，统一 resolver 由 HKCU 解析到 `D:\Program Files\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd`，kind=cmd；模型调用数为 0。记录位于 `.codex/reports/dsh-desktop/registry-encoding-result.json`。
- T7、T10 均 completed；全 plan 为 13 项 completed、T6 一项 cancelled，无 pending/in_progress。本轮仅改 resolver、对应单测、adapter notes、runbook 与本 plan，未改持久 PATH、注册表、凭据文件或宿主，未建分支/提交/推送/安装软件。
