# Tasks — agent containment and takeover（plan c6a9e4d2 t2/t3）

## 1. Guardian（Windows containment）

- [x] 1.1 `agent-guardian.ps1`：CreateJobObject + KILL_ON_JOB_CLOSE → CreateProcess(CREATE_SUSPENDED) → AssignProcessToJobObject → ResumeThread（无 spawn→assign 竞态；assign 失败杀挂起进程 fail-closed）
- [x] 1.2 句柄唯一所有权：guardian 唯一长期持 Job handle；同时等 runner（SYNCHRONIZE）+agent；runner 消失→TerminateJobObject；guardian 被杀→OS 关句柄=团灭；正常收尾=agent 退出后 guardian 退出（Job 关杀残留）
- [x] 1.3 stdio 透传：STARTF_USESTDHANDLES 继承 stdin/stdout/stderr；成功路径零输出；失败诊断 stderr `[maison-guardian]` 前缀
- [x] 1.4 绝对路径化（binary/cmd.exe 经 where.exe / SystemDirectory 解析——本机无路径 appname 被宿主安全面拦截的实测校准）+ UTF-8 BOM + PS5.1 uint 返回语义化封装
- [x] 1.5 退出码协议：0=agent 成功；1=参数；2=containment 建立失败；3=runner 消失

## 2. Node 接线

- [x] 2.1 `agent-containment.ts`：装帧（Token 明文 argv / AgentJson Base64(UTF-16LE) 往返 / 平台门 / 脚本齐备检查）
- [x] 2.2 `agent-invoke.ts`：guardian 分支 spawn（child.pid=guardian；kill 语义兼容）；containment 不可用→失败桩 fail-closed；非 win32/attended/dry 零变化 + windowsHide
- [x] 2.3 `goal-runner.ts`：containment 上下文注入；onActiveChild 绑定四元组→`agent_process_bound`（身份不可得/缺 token 立即团灭+fail-closed 覆盖 invoke）；invoke 收尾 `agent_process_settled`

## 3. 受控接管

- [x] 3.1 `goal-containment-reconcile.ts`：未闭合绑定扫描 / legacy 判据 / 矩阵分类（gone / alive_matching / identity_unverifiable）/ 单进程终止 + 杀后确认（不给 killProcessTree 开新口子）
- [x] 3.2 goal-runner resume 对账：legacy BLOCKER（人工清理）、guardian_gone 放行、alive_matching→terminate+awaitGone+`orphan_reclaimed`、杀不死 BLOCKER、身份不匹配警告
- [x] 3.3 goal-supervise：owner_alive 退避不拉起 / legacy 不拉起 / guardian_gone 才追加 `--force-resume`（受控 force，cooldown 保留在 runner）
- [x] 3.4 goal-progress/goal-status：guardian 只读投影（未闭合数 + 绑定 + 存活性；无回收副作用）

## 4. 文档与验证

- [x] 4.1 新 OpenSpec change `agent-containment-and-takeover`（spec/design/proposal/tasks；句柄所有权/stdio/breakaway/接管矩阵成文）
- [x] 4.2 单元测试 `agent-containment.unit.test`（13 例）注册 CORE_SUITES；goal-progress guardian 投影用例；host-replay-fixes 无回归
- [x] 4.3 runbook 恢复路线分级（Task Scheduler=真无人值守 / 用户终端=一次性）+ 宿主实测限定措辞 + 不自动装计划任务 + 无运行时探测
- [x] 4.4 Windows 硬杀实测（两场景）+ claude -p 禁 breakaway Job 实测（Design §5）
- [x] 4.5 收口：typecheck 0 / unit 2371 全 PASS / fixtures 44/44 / OpenSpec strict validate 40/40（2026-08-18）
- [x] 4.6 一轮 review 修订（2026-08-19）：P0-1 逐一对账全部未闭合+orphan_reclaimed 闭合+status 全量投影 / P0-2 身份有界重试+杀后复验+未消失不落 settled 阻断续跑 / P1-3 统一受控 force+行为测试 / P1-4 legacy 收窄+force 显式确认 / P1-5 concludeStartupBlocker 收口 / P1-6 runner handle 前置 / P1-7 quoting 收归 Node 单点+cmd 转义 / P1-8 空 events+无 run_start fail-closed / P1-9 LF / P2 裁 TerminateJobMembers —— 复验：typecheck 0 / unit 2374 全 PASS / fixtures 44/44 / openspec 40/40 / A·B 两场景硬杀 0 残留复验通过
- [x] 4.7 二轮 review 修订（2026-08-19）：P0 死亡判定剥离 CIM（独立 PID existence 通道 `pidExists`/`awaitGuardianGone` 改道/绑定失败同步 taskkill+复验/真实活进程行为测试）；P1 cmd shim **解包到 direct**（`unpackCmdShim` exe+node 两形态，其它 fail-closed；删 cmd 转义堆叠；真实 guardian argv 回显无损测试；where.exe 补 windowsHide）—— 复验：typecheck 0 / agent-containment 18/18 / 受影响 6 套件全绿 / fixtures 44/44 / openspec 40/40
- [x] 4.8 三轮 review 修订（2026-08-19）：P0 `pidExists` 失败语义（spawnSync 启动失败/超时返回 error/status=null 不抛异常→显式判存疑；status=0/1 均属查询正常完成，stdout 精确匹配 pid 判存在；执行器测试接缝 `__testing_setPidProbeExecutor`）—— 活进程+探针失败/超时用例；**4.8 宿主级未知项闭环**：根因=console 类 agent 无控制台挂起→guardian 等待超 8s 被宿主清杀；修复=guardian 为 agent 创建**隐藏控制台**（CREATE_NEW_CONSOLE+SW_HIDE）；复验矩阵（纯异步驱动）：cmd echo 452ms / ps echo 1017ms / claude --version（shim 解包 direct）exit 0 / 30s 心跳 agent 贯穿存活+正常收尾 exit 0 / CLOSE 事件正常 —— 复验：typecheck 0 / agent-containment 20/20 / fixtures 44/44 / openspec 40/40
- [x] 4.9 四轮 review 修订（2026-08-19）：P0 `pidExists` **显式 ABSENT 契约**——status=1 无法区分「PID 不存在」与「脚本执行失败」（同形：status=1+空 stdout）；改用 `[System.Diagnostics.Process]::GetProcessById` + 仅捕获 ArgumentException 输出 `ABSENT`（其它异常 exit 2）；Node 侧**只有** status=0 且 stdout 精确 `ABSENT` 才返回 false，空/畸形/PRESENT/任意非零全部保守存疑 —— 真实通道验证：不存在→false / 活进程→true / 杀后→false；typecheck 0 / agent-containment 20/20（含 ABSENT 契约 7 断言）