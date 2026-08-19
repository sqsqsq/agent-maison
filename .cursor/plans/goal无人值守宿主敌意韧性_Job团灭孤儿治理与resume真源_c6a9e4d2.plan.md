---
name: goal 无人值守宿主敌意韧性 — Job 团灭、孤儿治理与 resume 真源
version: 3.0.0
todos:
  - id: t1-events-only-resume
    content: events-only resume——resume 起点/priorOutcomes 一律 `resolveResumeFromEvents`（authoritative events 回放）；`goal-report.json` 永不参与恢复决策（纯展示投影）；events 缺失/损坏 → 明确拒绝 resume（fail-closed，命名损坏物），不回退 report、不猜。terminal resume guard 的 priorStatus 同步改从有效 events 投影取（现 goal-runner.ts:4210 `priorReport?.status ?? lastRunEnd?.status` 同病）。events 重建的 outcome 携带 run_disposition/run_wait_kind 投影字段（fa0663 设备停放 WAITING 语义不得回退）。规范不新立——既有在飞 change `goal-host-replay-fixes` 已要求 resume rebuild 走 authoritative view + 损坏 fail-closed，本项是其实现欠账；补回归：陈旧 report（review halted）+ 新 events（review/ut advance）→ 起点=testing；预算与起点同源断言。
    status: completed
  - id: t2-windows-agent-containment
    content: Windows agent containment——agent 必须在执行任何用户代码前进入受控 Job（KILL_ON_JOB_CLOSE）：guardian 先 CreateJobObject+SetInformation，再 CreateProcess(CREATE_SUSPENDED) → AssignProcessToJobObject → ResumeThread，杜绝 spawn→assign 竞态（后代自动继承成员身份）。**句柄唯一所有权（冻结）：guardian 是 Job handle 的唯一长期持有者，不向 runner/agent 复制句柄；guardian 同时等待 runner 与 agent，runner 异常消失时主动关闭 Job，guardian 自身被杀由 OS 关闭其句柄（同为最后句柄→团灭）；正常收尾在 agent 完成且输出排空后关闭。**stdio 透传契约进 OpenSpec design：agent stdout/stderr 须继续抵达 runner 既有管道消费面（guardian 传承继承句柄，自身不污染 stdout）。design 还须实测证明：claude -p 在**禁 breakaway** Job 内启动与工作正常（事故现场 claude.exe 三次从宿主 Job 团灭幸存＝疑似启动期 breakaway；若其硬依赖 breakaway 须逐 adapter 实测并出对策，不得带病上线）。Windows unattended 下 containment 建立失败 → 停止本次 invoke 如实上浮（fail-closed，不 WARN 降级——设备安全域，锚 [[stability-over-total-control]] 写保护/稳定性条款）。集成验收（两场景分列）：分别硬杀 runner、硬杀 guardian，两种情况下壳及 CLI 后代全树消失。
    status: completed
  - id: t3-controlled-takeover
    content: controlled takeover 与孤儿治理（与 t2 同一所有权单位）——不新增 PID 状态文件、不枚举后代：invoke 时向 events 落 `agent_process_bound`，只绑定 **guardian（Job owner）身份**＝ManagedProcessIdentity 四元组逐字段复用（pid + OS 启动时刻严格等值 + 可执行文件绝对路径 + 第四槽位换成 guardian argv 显式携带的 `run_id/invoke_id` token），回收核验直接复用 device-session R10/三轮条款（严格等值不留容差、命令行必须含 token、取不到命令行必须拒绝）；invoke 收尾落 settled 事件。自动回收只发生在 runner/supervisor 经 liveness+run-control 确认旧 owner 确死、取得新 epoch 之后：guardian 身份严格匹配 → 终止 guardian，由 Job 关闭团灭全部后代 + `orphan_reclaimed` 事件；guardian 已不存在 → 依 t2 唯一句柄契约判定 Job 已关闭，无需回收；身份不匹配 → 不杀不阻断只警告；匹配但杀不死 → 拒绝续跑（真冲突才 halt，锚 [[auto-match-over-fail]]）。**无 Job 绑定事件的旧版 run 一律 fail-closed 提示人工清理，不猜测。**`goal-status` 保持只读：只报告未闭合 invoke 与绑定 guardian 存活性，绝不回收。goal-supervise resume 分支补受控 force：先按同一身份契约确认旧 owner 死亡再追加 `--force-resume`，owner 存活维持退避；保留 cooldown。
    status: completed
  - id: t4-host-route-spawn-hygiene
    content: 宿主路由与 spawn 卫生——runbook「存活是环境属性」段增补本次实测：Windows Claude Desktop 工具环境（工具 shell/会话后端/detached 探针 IsProcessInJob 全 true，detached:true 无法 breakaway）下 --detach 三次被延迟回收硬杀；措辞限定"本次实测的该宿主环境"，不概括"Claude Code 一律必死"。恢复路线分级：**真无人值守=Task Scheduler（goal-supervise --install-schtasks）托管**；用户自开终端启动=临时一次性路线（--detach 后关窗无碍，但无 supervisor 自愈、崩了没人拉起），不写成同级保证。指引用户可见、不自动写持久计划任务；不做运行时 Job flags 自动探测/路由（探测≠保护，containment 才是保护）。spawnHeadlessChild 与 gate-harness spawn 补 `windowsHide:true`（根除每 invoke 弹可见控制台窗+关窗杀 agent 通道）。operator_interrupt 话术改为"控制台中断类退出（Ctrl+C/关窗/conhost 终止等，可能来自操作者或宿主环境清理）"，不写死具体动作。
    status: completed
  - id: t5-regressions-closure
    content: 回归与收口——回归项：①events-only（陈旧report+新events 起点=testing、损坏 events 拒绝 resume、terminal guard events 投影）；②owner 活/死接管矩阵（活=退避、死=受控 force、guardian 身份不匹配=不杀不阻断、匹配杀不死=拒绝、无绑定事件旧 run=fail-closed）；③（Windows 本机，必须真实执行并留证，不得跳过）分别硬杀 runner/硬杀 guardian → 壳及 CLI 后代整树消失；④windowsHide 生产 spawn 选项断言；⑤supervise force 接线。验证节奏：窄返修跑目标测试；首次整体验收与最终收口跑 typecheck、`cd harness && npm test`、OpenSpec strict validate（AGENTS.md:62 收口全量门）；Windows 硬杀集成在 containment 生产逻辑稳定后及最终验收执行并留证；`release:verify` 留正式发版门禁。新 OpenSpec change 只承载 agent containment 与 supervisor takeover（t1 归 goal-host-replay-fixes 既有要求的实现回归）。
    status: completed
overview: >
  08-18 宿主（Windows Claude Desktop 工具环境，包=ca27ac09/3.0.0）回灌 bc-openCard-1 实锤四缺陷
  叠加：①宿主工具 shell 与 detached 子进程全在 Job Object 内（IsProcessInJob 实测=true，maison
  同参 detached 探针出生即 inJob；detached:true 无法请求 CREATE_BREAKAWAY_FROM_JOB）→ 三个
  supervisor（1484/40220/9784）在宿主轮次交还后的延迟回收里被静默硬杀——证据高度一致（backstop
  零事件+全 transcript/工具链排除+node 死 claude 存的选择性），但未取得目标 Job flags，终止主体
  未法证确认；②agent 进程零绑定零围栏 → supervisor 死后 claude 后代脱管野跑真机 27 分钟（spawn
  壳 33120 随 Job 死、后代 claude 30124 幸存=只登记 spawn pid 抓不到真孤儿），resume 对活孤儿
  无感知造成并发双写；③resume 起点与 terminal guard 均优先只在优雅 run_end 落盘的
  goal-report.json → 崩溃后进度回滚（review/ut PASS 闭环被丢）而预算从 events 照扣，且每次重启
  testing 再孵化新孤儿；④agent spawn 缺 windowsHide → 每 invoke 弹可见控制台窗，epoch1 review
  agent 死于控制台中断类退出（0xC000013A）。收口五项：events-only resume、Windows agent
  containment（guardian 唯一持柄+SUSPENDED 先入 Job+fail-closed）、controlled takeover（只绑
  guardian 身份+严格等值+新 epoch 后回收）、宿主路由分级与 spawn 卫生、回归矩阵。
isProject: false
---

# goal 无人值守宿主敌意韧性:Job 团灭、孤儿治理与 resume 真源(c6a9e4d2)

状态:**待 review,未开工**(v3;codex 对 v2 的二轮 review 两阻断+两调整已核实吸收——句柄唯一所有权冻结、所有权单位合并到 guardian、验证节奏分级、终端路线分级;新增 breakaway 实测要求)

## 背景与根因链(08-18 bc-openCard-1 事故)

run `20260818T035420Z-f555c2`(宿主包 = maison HEAD ca27ac09,3.0.0),一天内同一 run 四次非正常中断:

```
14:19:35 epoch1 review-i6 agent 死于 0xC000013A(控制台中断类退出;14:25 桌面 app Electron
         队列重生佐证操作者环境动作,具体动作不写死) → operator_interrupt 分类正确,优雅 HALT
15:11    epoch2 supervisor(1484,存活41m)被静默硬杀 → testing-i9 孤儿野跑真机 27 分钟
15:31    epoch3 supervisor(40220,存活2m)被静默硬杀 → review-i10 孤儿
15:40    epoch5 supervisor(9784,存活6m)被静默硬杀 → review-i11 孤儿(壳 33120 随死,
         后代 claude 30124 幸存,宿主 15:45 手动清)
每次 force-resume 都回退到 review(缺陷③),epoch2 已 PASS 闭环的 review/ut 被反复重跑,
预算却照扣(turns 6→9→10→11/30);epoch3 起跑时孤儿 testing-i9 仍在装机跑测试=并发双写。
```

硬杀归因:**证据高度一致指向宿主工具 Job Object 延迟回收,但未取得目标 Job flags,精确终止主体未法证确认**。证据链:本机工具 shell/会话后端/桌面主进程 IsProcessInJob 全=true;maison 同参 detached 探针出生即 inJob(detached ≠ breakaway);IsProcessInJob=true 本身不等于 KILL_ON_JOB_CLOSE,故不下法证结论;三次死亡均落在宿主轮次交还后的空窗且与 run 自身活动无关;runner 的 `process.on('exit')` backstop 三次零事件;钱包工程/hylyre/hypium/stop-daemon/全部 90 个会话 transcript 逐一排除;node 死、claude.exe 幸存的选择性与 Job 团灭+breakaway 相容——**该幸存同时构成 t2 的设计风险输入**(claude 疑似启动期 breakaway,禁 breakaway Job 须实测其兼容性)。

## 事实核实表(codex 三轮意见 + 本侧独立取证,逐条 ground truth)

| # | 断言(来源) | 核实 | 证据 |
|---|------|------|------|
| 1 | resume 优先陈旧 report,events 仅兜底 | ✅ | goal-runner.ts resume 分支 `if (priorReport?.phases?.length)`;report 仅 run_end 落盘 |
| 2 | terminal guard 同病(report 优先) | ✅ | goal-runner.ts:4210 `priorStatus: priorReport?.status ?? lastRunEnd?.status` |
| 3 | events-only+fail-closed 规范已存在,不应新立 | ✅ | 在飞 change goal-host-replay-fixes spec:"…resume rebuild…SHALL read through the authoritative view"+corrupt run "SHALL fail closed" |
| 4 | spawn 返回 pid=壳,壳死后代活,登记壳 pid 抓不到真孤儿 | ✅ | 宿主 transcript 07:44:44:claude 30124 的 ParentProcessId=33120;Job 死壳、claude 幸存 |
| 5 | goal-status 是只读投影,不得杀进程 | ✅ | goal-status.ts 全文无 kill 路径 |
| 6 | v1-t5 存在 spawn→assign 竞态窗口 | ✅ | 改 CREATE_SUSPENDED→assign→resume |
| 7 | IsProcessInJob=true ≠ KILL_ON_JOB_CLOSE | ✅ | 成员身份实测为真;flags 未读取;技术注:QueryInformationJobObject(NULL) 可自查,但嵌套 Job 语义含混+探测≠保护,自动探测裁掉 |
| 8 | agent spawn 缺 windowsHide | ✅ | spawnHeadlessChild 与 gate-harness spawn 均无 windowsHide |
| 9 | goal-supervise resume 分支缺 --force-resume;HALTED 被 guard 默认拒 | ✅ | goal-supervise.ts runnerArgs;checkTerminalResumeGuard |
| 10 | runbook 已成文 kill-on-close Job 宿主须 schtasks,但只在 chrys 实测 | ✅ | docs/operations/goal-mode-runbook.md「存活是环境属性」段 |
| 11 | exit backstop 存在→硬杀是 JS 不可观察 | ✅ | goal-runner.ts 尾部 `process.on('exit')`;三次零事件 |
| 12 | maison 本机单测与死亡时间重叠但被杀 PID 不符 | ✅(仅时间相关) | 单测只杀自 spawn 子树,非因果 |
| 13 | (v2 review)KILL_ON_JOB_CLOSE 只在最后一个句柄关闭时生效,v2"任一退出→关闭"语义不成立 | ✅ | Windows 语义;v2 措辞确有两种漏法(双持句柄谁死都不团灭/独持不感知 runner 死)→冻结 guardian 唯一持柄契约 |
| 14 | (v2 review)v2-t3 身份字段与 ManagedProcessIdentity 契约不对齐,后代永过不了严格匹配 | ✅ | device-session.ts:29 四元组第四槽位=profile(绝对路径 executable);:170 起命令行必须含 profile、取不到命令行必须拒绝("宁可留孤儿也不误杀")——claude 后代命令行无此类 token→合并所有权单位到 guardian,guardian argv 显式携带 run_id/invoke_id 填第四槽位 |
| 15 | (v2 review)"每轮全测与仓库验证比例规则冲突" | ⚠️ 节奏采纳,依据修正 | 全库未定位成文"验证比例规则";实际成文规则=AGENTS.md:62"改动发布内容后 npm test 必须全 PASS"(收口门)。采纳的分级节奏与之相容 |
| 16 | (v2 review)用户终端不能与 Task Scheduler 同级 | ⚠️ 分级采纳,理由修正 | codex 理由"前台且窗口保持开启"不准——detach 后关窗无碍(runbook 实测活过宿主整关);真正差距=无 supervisor 自愈,崩了没人拉起 |

## v2→v3 的裁决变化(吸收 codex 二轮 review)

1. **句柄唯一所有权冻结**(P0):guardian 唯一长期持柄,不复制;同时 wait runner+agent;runner 消失→主动关 Job,guardian 被杀→OS 关句柄;正常收尾在 agent settled+输出排空后关闭。验收增"分别硬杀 runner/guardian 两场景"。
2. **所有权单位合并**(P1):t3 只绑 guardian 身份(四元组逐字段复用,第四槽位=guardian argv 显式 run_id/invoke_id token),删除"心跳枚举后代+逐后代绑定+逐个 killProcessTree"整套平行机制;guardian 不存在=Job 已闭;旧版无绑定事件 run 一律 fail-closed 人工清理。
3. **新增 breakaway 实测要求**(本侧):claude.exe 三次幸存疑似启动期 breakaway;design 须实测 claude -p 在禁 breakaway Job 内正常工作,硬依赖则逐 adapter 出对策,不带病上线。
4. **验证节奏分级**:窄返修=目标测试;首次整体验收+最终收口=typecheck+全量+strict validate;Windows 硬杀集成在 containment 稳定后+最终验收执行留证。
5. **恢复路线分级**:Task Scheduler=真无人值守;用户终端=临时一次性(无自愈)。

## v1→v2 的裁决变化(存档)

撤 pid.json(改 events 绑定)/goal-status 绝不回收/containment 无竞态+fail-closed/撤运行时探测与自动路由/撤日志归档(后续 `phases/<phase>/invokes/<invoke_id>/` 不可变目录)/归因措辞降级/规范不新立(t1 归 goal-host-replay-fixes)。

## 交叠与依赖

- 工作树 goal-runner.ts 现有 **75 行未提交插入**(e9d4b7a3/f8c3d6a2 已终审待 commit,未触 resume 块)——本 plan 须在两者 commit 后实施。
- a7c3f9e2(他人 plan)仍挡 release 门禁。
- 宿主侧当下解法(不等本 plan):用户自开终端/一次性 schtasks 跑 force-resume;t1 未落地前 resume 仍会从 review 起步。

## 已定裁决(codex 与本 plan 一致建议;除非用户反对,按此执行)

1. **版本门:挂 3.0.0 发布阻断项**(设备安全+并发写入;与 423e5d0f R3c、a7c3f9e2 同列)。
2. **fail-closed 范围:Windows unattended 强制;attended/非 Windows 零变化**。
3. **launcher:PowerShell P/Invoke 先行**(零新增二进制);前置=句柄唯一所有权+stdio 透传契约+breakaway 实测三项在 design 落定;实测确有性能/可靠性问题再升预编译。
