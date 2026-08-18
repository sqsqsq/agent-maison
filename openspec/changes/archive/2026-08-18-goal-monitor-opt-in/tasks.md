# Tasks

- [x] OpenSpec delta：goal-mode-skill spec REMOVED「Goal mode monitors active runs during the current turn」+ ADDED「Goal mode returns the turn after launching unattended runs」（有界启动握手 ≤30s / 超窗如实报未就绪 / 状态查询唯一 goal-status / opt-in 盯守 / 禁事件轮询四 Scenario）+ MODIFIED「Goal mode documents monitor timeout coupling」措辞限定「当调用 goal-monitor 时」；goal-runner spec 与「monitoring ≠ wakeup」条目不动
- [x] `skills/project/goal-mode/SKILL.md`：「detach 存活检查和 bounded monitor」改「detach 启动握手、进度汇报与 opt-in 盯守」；每轮汇报节补无人值守启动握手后汇报即交还轮次
- [x] `skills/reference/goal-mode-operations.md`：「监控 loop 细则」重构为「无人值守启动后的默认交还」（含 ≤30s 启动握手、汇报模板、禁事件轮询 BLOCKER）/「查进度」（唯一入口 goal-status，禁 monitor 当状态查询及原因）/「opt-in 盯守细则」（since-event 照抄、timeout 耦合、裁决轴、no-op、heartbeat、硬 liveness、跨轮接管、P1-8 熔断三阈值、chrys 空日志 BLOCKER；删 fire-and-forget 与 Cursor stdout 加速器两条；新增禁 tail detach.log 长驻桥）
- [x] `docs/operations/goal-mode-runbook.md` §运行中进度：默认语义反转为握手→汇报→交还、用户要求盯守才 monitor；命令表 goal-monitor 行标注仅 opt-in 且不得当状态查询；「按下文进入 bounded monitor」改「执行启动握手、汇报并交还轮次」
- [x] 验证：cd harness && npm test；npm run openspec:validate；npm run release:verify；归档 goal-monitor-opt-in（openspec archive）；归档后再跑 npm run openspec:validate；git diff --check