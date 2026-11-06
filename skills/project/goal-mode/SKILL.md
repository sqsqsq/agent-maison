# Goal 模式（同一完成协调器）

正式完整交付从原始需求进入唯一 `GoalPhaseRuntime`：设计单元形成蓝图及适用 CU，各施工单元完成授权工作，必要组装和部件义务也按原请求核验。作者退出、蓝图准入、CU ready、子 run 出生或单项工具 PASS 都不是原请求完成。维护、单独设计、review/UT/testing 与纯编译保留各自终点，见 [统一入口](../../../docs/operations/project-entry.md)。

本 Skill 只选择呈现与运输、转交原请求和可信授权。当前输入、全部未完项、责任、解除条件与完成/发布结论由同一个 `readCurrentDispositionInput → resolveCurrentDisposition` 链产生；`assess`、NEXT、状态和报告只是投影，不再推荐阶段作者队列。

## 两种呈现，一个执行循环

- **有人在场**：主会话展示进度、转交插话和真实授权，启动返回的执行命令；业务工作始终由本单元专用作者上下文完成。
- **无人值守**：同一单元、授权、作者上下文与完成规则，使用后台运输和通知。需要人处理的真实条件保全为可恢复等待。

明确的“我会看着”或“后台继续 / --detach”直接映射，不重复确认；歧义才按 [goal.run_mode](../../reference/confirmation-registry.yaml) 澄清。主会话不接管施工，不因 adapter 缺原生 resume 就假称不能执行：能按准确 SID 续接就续接，不能时依当前原件重建专用上下文并披露边界，禁止 `--last`。必需质询/核验始终用真实独立上下文。

## 请求与授权

提供原需求/来源、Feature 或原请求身份、请求终点与结果、adapter 和可信授权。`--requested-phases` 仅表达明确请求的方法/检查族，不是阶段派工顺序或写权。输入/绑定/技术 ID 由入口派生，不手填机器字段。

可通过 `--user-deadline-at <UTC时间>` 明示截止；只归一一次到 `user_deadline_at`，resume 不重置或自动延长。新运行没有 token、调用次数、每阶段重试或默认总墙钟配额；旧 budget/phase-timeout 数字仅历史读取，不能转成用户截止，也不能靠提额或新 run 刷新机会。调用数和耗时只作事后统计。

用户已授权的原范围内工作持续推进，不反复确认。目标/验收实质变化、扩范围、共享契约/设计、真实秘密、不可逆动作和明确禁止仍沿真实权责边界处理；主 Agent 的日志、never 或模式名不自授权限。设计修订回原设计单元，经独立核验、正式发布与必要重绑后接回施工，不由 CU 原地洗白。


## 模型选择与费用授权

前台 agent 先判断用户是否在本次任务中明确指定运行模型（业务正文提及模型不算）。对照当前 adapter/provider 的实际模型清单校对缩写、错字或原生别名为正式完整 ID；唯一时直接校对，歧义才列候选请用户确定。启动摘要显示原输入和最终正式 ID、provider、推理设置。框架只精确匹配正式 ID，不模糊匹配、不试发候选。

显式选择通过 manifest 的 `adapter_model_pin: {adapter,value,provider?,reasoning_effort?,config_source?,route_identity?}` 或 `--adapter-model <完整ID> --adapter-provider <路由> [--adapter-reasoning <设置>] [--adapter-model-config <原生配置路径>]` 转交。模型 ID 中的斜杠保持原样。没有显式选择时，DSH 启动器从当前前台 agent shell 的 `DSH_SESSION_ID`、`DSH_HOME`、`DSH_PROFILE_DIR` 定位准确会话，读取启动时最后一个 `request/header`，自动继承本轮正在使用的配置；不要求 agent 猜测 seq。模型来源为该实际 profile 的 `cordis.patch.yml`，不默认取 desktop。`--frontend-request-file <准确原件> --frontend-session-id <准确SID> --frontend-request-id <请求ID>` 保留为显式覆盖手段，另传准确模型来源；Codex 请求 ID 为 turn_id。不能取得准确原件时，请用户明确型号及路由，保全等待；不得从 lastUsed、最近会话、模型自称或后台默认值补齐。

DSH 的非秘密来源声明摘要冻结在同一 pin 的 `route_identity`；每次派发将实际最终配置与该身份核对，同路径 endpoint 变化也须经原授权入口改选。补绑前须在锁内核对既有 manifest 身份漂移，模型补绑不授权改变截止时间或其它任务字段。历史 `approved_alternative` 仅可读，不能作为继续执行的授权。

profile 未声明的 DSH 内置 `deepseek-official`、`deepseek-account` 按实际 DSH 版本、provider、完整 model 和生效的非秘密 endpoint 冻结同一 `route_identity`，无需虚构 `llm-pi-ai.providers` 配置；调用前仍核对版本、最终模型选择和原生请求。已在 profile 声明的路由继续按非秘密声明核对。detach 子进程直接消费父进程捕获的完整 pin，不因原始模型参数仍在 argv 中而重新冻结。

自动捕获的前台选择只在新任务出生或旧任务缺 pin 时绑定；已有任务及其业务后继沿用原 pin，UI 换模型或推理档位不构成任务改选。先完成这项接续裁决，再冻结实际需要绑定的前台来源；无需使用的 UI 选择不可阻断原任务接回。

显式视觉 CLI 选择可补充 `--visual-provider <路由> --visual-reasoning <设置> --visual-model-config <原生配置路径>`。省略这些扩展时，只从已授权的同 adapter 视觉 pin 或个人视觉配置补齐；不得继承主模型路由。无法补齐时等待，不冻结不可执行的半份身份。

视觉选择在新建、接回和后继出生时都走既有授权裁决；接回时主模型和视觉改选由同一锁内转换落盘，不能成功返回却遗留旧视觉 pin。OpenCode 前台导出与 `--adapter-model-config` 组合只用于定位来源，可直接继承 `model.variant`，不要求重复提供 `--adapter-model`。

主模型唯一真源是 manifest.adapter_model_pin。作者、质询、核验、格式修复、重试与恢复均消费自己的冻结绑定。仅 UI 改选不改变任务；任务明确改选沿既有 --override-manifest 入口，保留成果，重新签发尚未执行的旧绑定请求，排除旧 provider/推理设置的 SID 和能力缓存。原生辅助小模型保留前台原行为。

配置来源随绑定回放：DSH 使用实际 `DSH_HOME/profiles/<profile>/cordis.patch.yml`，Codex 使用实际 `CODEX_HOME/config.toml`，Claude 使用实际 `CLAUDE_CONFIG_DIR/settings.json`，OpenCode 当前使用实际 `<home>/.config/opencode` 目录。框架只传递路径和非秘密模型元数据，凭据由原生工具读取；来源不能准确确定时等待。OpenCode 的额外配置覆盖层、Cursor 的独立 provider/推理覆盖、以及尚不能精确冻结的原生扩展选择不能无绑定启动。

已授权独立视觉继续使用 `visual_provider_pin`，可在原有 `adapter/model` 中补充相同的 `provider/reasoning_effort/config_source` 元数据。它的模型、路由与只读约束独立回放，不改成主模型；旧二字段格式仍可读取，需要补足可回放信息时经原授权入口补齐。原生别名先校对到目录返回的正式 ID；不要移除上下文等附加要求来绕过不支持项。

DSH 以 headless 启动，先加载前台模型来源配置层，再施加框架权限及模型补丁。付费前以最终 --dump-config 核对 provider/model、baseURL/apiKeyEnv/contextWindow/input。凭据由 DSH 原生读取，框架不复制凭据；MISSING_CREDENTIAL 按既有硬失败交回。approved_models 已停用，每次启动提示一次后忽略任何旧值，不自动替代、不重探候选。

当前原生能力不足或无法准确回放时，在付费前等待；实际同类原生主模型字段失配时立即取消并停止后续派发。启动参数、配置核对和请求身份观察分别报告；只有响应后可见的身份不能保证此前零误扣。

## 唯一协调循环

1. 读取原目标、合法成果、真实调用和当前有效证据，一次汇总全部可判定未完项。
2. 专用作者在授权内解决设计细化、实现与测试源；Skill 和 phase 是方法/里程碑，单元内不轮流购买不同阶段作者。
3. 作者可自检；协调器只补缺失或受影响的真实检查、构建、UT、设备/视觉及独立核验。工具族复用原 unit request 与 owner/fence，不伪造同名 phase 作者出生或 PASS。
4. 真实缺陷和全部反馈送回同一作者；原样结果复读不制造新机会。已完成调用及无关有效证据复用；实质输入、验收或依赖变化才补受影响部分。
5. 需补证/条件的部分点明原 producer、对象与解除条件，继续所有独立可做工作。未知不当产品失败，也不签通过。反馈已送达且真实交回/完整核验仍无改善时，共同 I10 中断保全并可续暂停；不新增次数上限。
6. 当前终点全部适用义务和正式原件成立才签完成；发布就绪另投影。视觉/资源债务可披露而发布仍 BLOCKED，不能因此让作者反复空转。

检查工具内部的具体 timeout、真实 native 输出卡死清理、用户取消/截止、独立上下文、写保护、owner/fence 和原件绑定继续生效。作者可写实现/测试输入，不写正式结果、截图、PASS 或完成记录。

## 启动、观察与恢复

1. 先读 [host-harness-readiness](../../reference/host-harness-readiness.md)、[harness-cli-cwd](../../reference/harness-cli-cwd.md) 与 [personal-setup-gate](../../reference/personal-setup-gate.md)，采用实际 activeAdapter。
2. 需要设备时走 [device-policy-gate](../../reference/device-policy-gate.md)；绝不要让用户把 PIN 发到对话里。PIN 只能由用户在真实 TTY 登记，不代输或猜解锁。`code=device_policy_unset` 才询问配置；非 JSON/命令失败保留真实错误，不冒充未配置。
3. UI 任务按 [interactive-vision-canary](../../reference/interactive-vision-canary.md) 读取实际图像能力；缓存 SKIP、盲能力或 provider 缺失都不能伪造视觉通过。
4. 有人在场由 `goal-mode-entry --prepare-run --run-mode attended` 创建/接回，随后 `--next / --report-result`。只执行返回的 `execute_command`，用同一 `observe_command` 观察、`interrupt_command` 停止准确 owner 绑定；不手拼 token、SID 或权限。后台由 `goal-runner --detach` 运输同一请求/结果。

重复 execute/report 幂等，报告 `passed` 只是本次真实调用结果，正常退出/hook 放行也不裁决交付。未知外部任务先等待真实交回/退出或受控回收事实，不伪造 end；租约过期不证明已停止。条件恢复或用户明确继续后由公共入口接原请求，只补受影响部分；同条件自动重入不重复执行。已完成请求默认只读状态，不能因升级重新开工。

发现 framework 问题：不改消费者 `framework/` 发布件；登记具体问题与影响，继续所有不依赖它的授权工作，必需缺口交协调器保全等待，不命令整单 HALT。依赖只在 `framework/harness` 安装，不能在宿主根安装 runtime。

## 汇报

报告原请求/工作单元、实际作者/工具/独核调用、当前未完项和解除条件、下一原生执行请求、run 与原件路径。作者已结束、检查未完、等待条件和业务完成分别说明。`activity` 的调用/耗时不是额度或完成率；只读状态不偷偷写 next/cache。

后台 launcher 的有界启动握手区分 ready/terminal/alive_timeout/failed，pid/目录不是健康证明；alive_timeout 不表示失败或允许杀进程。完整交付已授权时持续跟踪原请求，Stop hook/原生 Goal/进程退出只触发共同协调器。不要把已授权命令推给用户，也不另建轮询或私有 phase 循环。具体命令见 [goal-mode-operations](../../reference/goal-mode-operations.md)。
