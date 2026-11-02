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
