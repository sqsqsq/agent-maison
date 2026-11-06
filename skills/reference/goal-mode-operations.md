# Goal Mode 运维细则

设备准备沿同一 [device-policy-gate](device-policy-gate.md) 自跑。自动确认弹窗/解锁只限实际出现的弹窗及已登记策略允许的动作；不得绕过设备锁或传递执行权限，PIN 不在对话获取或代输。
仅当框架实际尝试输入后执行/复验失败，才按设备门规则烧毁该凭据版本；探测、未执行或环境故障不得冒充密码失败。

执行契约见 [goal-mode Skill](../project/goal-mode/SKILL.md)，当前事实见 assess/status；本页只说明原有入口与恢复操作。命令由 Agent 执行，不把可恢复的框架故障转成用户手工命令。

## 可执行命令（从实例工程的 framework/harness 目录运行）

有人/无人执行复用同一完成协调器和各工作单元专用作者：

- 有人在场：goal-mode-entry.ts --prepare-run --run-mode attended，然后按返回的 --next / --report-result 命令领取和交回真实请求。读取原件并执行返回的 execute_command；observe_command / interrupt_command 只观察或中断该精确请求。
- 无人值守：goal-runner.ts --feature <feature> --requirement-file <已有需求文件> --detach；使用返回的 startup 结果核启动，不以 pid/目录存在冒充健康。
- 原授权全权执行由入口明确传递 --authorize-autonomy；日志、never 配置和 Agent 自写说明不构成授权。
- 仅当用户明示绝对截止时传 --user-deadline-at <UTC ISO-8601>。接回未完任务沿用原截止，不因重启、后继或换运输重置。
- 公开 check/compile 按适用义务调用；--phase 选择工具检查族，不能要求先生成同名作者或旧阶段闭环。普通只读 assess 默认不写 next.json；显式需要投影才传 --write。

原 SID 只从该调用真实结构化流取得：Codex exec resume <准确ID>、Claude --resume <准确ID>、DSH --session-id <准确ID>。不猜 latest/last，不把 root/CU 或独核串入同一原生上下文。SID 缺失/失效或权限改变时，用当前原请求、输入、成果与反馈重建本单元专用上下文并披露，不能回主会话代施工。

## 停机后继续

重新发起原请求会先读原 active run、当前范围和真实结果。未知条件未变时保持同一等待，不新增作者、工具、run 或事件；实际 producer/对象/授权条件恢复后重新接入原 run，只补受影响部分。不能把 meta mtime、时间经过或取消终态当业务改善。

真实 no_progress_guard 的相同差额保持暂停；明确继续使用原入口的 --force-resume 或受管会话 --force-takeover，仍须真实授权、原生停止确认、owner/fencing、写保护和原用户截止。已完成交付的新需求或明确重新交付按现 successor/范围修订契约处理，不用新目录洗掉失败。

run-control.json 的 epoch、原 request、invoke_id、accepted report 与进程绑定仍是原恢复依据。只对精确 owner/PID/root 中断；不能碰其它任务、伪写 native end 或把未确认 quiesce 算结束。手工改 events、正式报告、manifest 身份或证据不构成恢复。

## 活性与工具期限

框架无默认作者总时长/总调用额度。真实用户截止和取消继续生效；具体构建、设备 UT、provider 操作保留公开期限。原生调用无真实 stdout/stderr 增长且未观测终态时，静默窗口为 max(90分钟, 现有公开单工具期限+45分钟检查余量)。heartbeat/续租不刷新它；持续真实输出不受该窗口的总时长限制。中断保留未知、原流、成果和准确 SID，不能判产品失败或完成。

具体工具已观测终态后沿原有短清理宽限确认退出。长任务用原生异步等待/观察，不以一层 shell 包一层来改变取消身份。进度显示实际 calls/active_ms、当前活性与当前处置；费用未知保未知，不把历史预算剩余额度展示为当前授权。

## 设备、凭据和 adapter

先读取 adapter/config/profile 实际能力和当前可信模型钉；可用性、可解析与业务验收通过分别报告。能力缺口交原 producer，继续不依赖它的授权工作；确无可做工作才等待。Claude/Codex/DSH 都经相同 executor 和 containment，独立质询/核验保持真实独立。

设备安装、真机测试/截图和 PIN 由既有 device readiness/credential gate 处理。不能自行猜密码、绕门、重置设备或复制秘密。DSH 使用同一 DSH_HOME 中真实 headless 路由的已保存凭据或正式环境来源；子工具可能过滤 KEY/PASSWORD/SECRET/TOKEN，不假设它会透传。框架不读取或复制凭据；缺凭据按真实外部条件恢复。模型与视觉 provider 只用当前 adapter 支持的明确钉值，不编造替代能力。

框架 HALT/报错说明本次原件与影响；授权工作仍由共同协调器继续。缺正式完成、部件装配或 release 证据时保持具体未完项，不能以全部 CU 绿、作者退出0或六检查族 PASS 代签原终点。

## 模型选择与费用授权

前台 agent 先判断用户是否在本次任务中明确指定运行模型（业务正文提及模型不算）。对照当前 adapter/provider 的实际模型清单校对缩写、错字或原生别名为正式完整 ID；唯一时直接校对，歧义才列候选请用户确定。启动摘要显示原输入和最终正式 ID、provider、推理设置。框架只精确匹配正式 ID，不模糊匹配、不试发候选。

显式选择通过 manifest 的 `adapter_model_pin: {adapter,value,provider?,reasoning_effort?,config_source?,route_identity?}` 或 `--adapter-model <完整ID> --adapter-provider <路由> [--adapter-reasoning <设置>] [--adapter-model-config <原生配置路径>]` 转交。模型 ID 中的斜杠保持原样。DSH 无显式模型参数时，从前台 agent shell 的 `DSH_SESSION_ID/DSH_HOME/DSH_PROFILE_DIR` 自动定位准确会话，复用启动时最后一个 `request/header` 及实际 profile 的 `cordis.patch.yml`；不要求人工猜测 seq，不默认取 desktop。三个 `--frontend-request-*` 参数保留为覆盖手段，原生配置来源须准确；Codex 请求 ID 为 turn_id。缺准确来源时保全等待，不从 lastUsed、最近会话、模型自称或后台默认值补齐。

DSH 非秘密来源声明摘要保存在既有 pin 的 `route_identity`，最终 dump-config 必须与它一致；同路径 endpoint 改变也不可静默接受。补绑在锁内重读 manifest，既有截止时间等身份漂移须先处置；本次只授权模型字段。历史替代来源不授权新调用。独立视觉 CLI 可使用 `--visual-provider/--visual-reasoning/--visual-model-config`，缺省仅继承已授权的同 adapter 视觉配置；观察 sidecar 与评审回执按完整绑定复用，保留原调用身份。

DSH 内置 `deepseek-official/deepseek-account` 未在 profile 声明时，以实际 DSH 版本、provider、model 和生效的非秘密 endpoint 计算同一 pin 的路由身份；原生选择、版本与请求核对仍生效。profile 自定义路由继续核对来源声明。detach 子进程保留父进程已经捕获的 pin，当前配置只供核对，不重新授权 endpoint。视觉新建/接回统一裁决，显式改选可在同一锁内与主 pin 一起更新；OpenCode 的前台导出配置目录是来源定位参数，不是要求重复型号的改选参数。

前台自动捕获仅供新任务或无 pin 的旧任务绑定；已有任务接回及业务后继保持原 pin，不以 UI 改选触发换模型或起后继。仅在接续裁决确认需要绑定时冻结该来源，忽略无需使用的前台选择。

主模型唯一真源是 manifest.adapter_model_pin。作者、质询、核验、格式修复、重试与恢复均消费自己的冻结绑定。仅 UI 改选不改变任务；任务明确改选沿既有 --override-manifest 入口，保留成果，重新签发尚未执行的旧绑定请求，排除旧 provider/推理设置的 SID 和能力缓存。原生辅助小模型保留前台原行为。

DSH 以 headless 启动，先加载前台模型来源配置层，再施加框架权限及模型补丁。付费前以最终 --dump-config 核对 provider/model、baseURL/apiKeyEnv/contextWindow/input。凭据由 DSH 原生读取，框架不复制凭据；MISSING_CREDENTIAL 按既有硬失败交回。approved_models 已停用，每次启动提示一次后忽略任何旧值，不自动替代、不重探候选。

当前原生能力不足或无法准确回放时，在付费前等待；实际同类原生主模型字段失配时立即取消并停止后续派发。启动参数、配置核对和请求身份观察分别报告；只有响应后可见的身份不能保证此前零误扣。

原生来源路径约定：DSH 为 `DSH_HOME/profiles/<profile>/cordis.patch.yml`，Codex 为 `CODEX_HOME/config.toml`，Claude 为 `CLAUDE_CONFIG_DIR/settings.json`，OpenCode 当前为 `<home>/.config/opencode`。OpenCode 可从准确 session 的原生 export JSON 读取指定消息 ID 的 provider/model/variant；需同时提供前台原生配置目录。额外配置层无法准确绑定时先等待。独立视觉 pin 可在原有 `adapter/model` 中补充 `provider/reasoning_effort/config_source`，运输复用同一组字段，不继承主模型的路由。
