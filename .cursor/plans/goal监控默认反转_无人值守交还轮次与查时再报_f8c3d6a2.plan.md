---
name: goal 监控默认反转 — 无人值守交还轮次与查时再报
version: 3.0.0
todos:
  - id: t1-spec-delta
    content: OpenSpec change `goal-monitor-opt-in`：goal-mode-skill spec 反转默认（启动 unattended run 后有界启动握手≤30s→汇报→交还轮次；状态查询唯一 goal-status；bounded monitor 降为显式 opt-in）+ 新增禁事件轮询条款（握手为唯一例外）+ timeout 耦合条款限定在"实际调用 monitor 时"；goal-runner spec 的 monitor CLI 语义条目一字不动。
    status: completed
  - id: t2-skill-ops
    content: SKILL.md + goal-mode-operations.md 收口——默认路径改为"启动→有界启动握手（≤30s，只查 manifest/detach.log 增长/liveness，超窗如实报未就绪）→汇报 run_id/续查入口→结束轮次"话术模板；查进度唯一入口 goal-status（monitor 不得当状态查询）；原"监控 loop 细则"降级为 opt-in 附录（since-event/timeout 耦合/熔断三阈值保留；删 fire-and-forget 与 Cursor stdout 加速器两条，禁 tail detach.log 长驻桥）；新增 BLOCKER 禁事件轮询。
    status: completed
  - id: t3-runbook
    content: docs/operations/goal-mode-runbook.md 同步反转（§运行中进度：默认语义翻转为"启动握手→汇报→交还，用户要求盯守才 monitor"；命令表 goal-monitor 行标注仅 opt-in 盯守、不得当状态查询）。
    status: completed
  - id: t4-verify
    content: 跑 cd harness && npm test、npm run openspec:validate；发布内容（skills/docs）改动后跑 npm run release:verify；归档 change。
    status: completed
overview: >
  bc-openCard 实测证实：goal 无人值守 run 已经真后台了（--detach），但前台对话框没有后台——
  现行 goal-mode-skill spec 强制"启动 runner 后 MUST 进入 bounded monitor"，宿主 agent 忠实执行，
  轮询占死当前轮次（08-14~15 会话实锤：多次 goal-monitor + 数十处自制 sleep-10 轮询，工具等待累计
  ≈3.5h）。根因是两代设计叠加：bounded-monitor plan 用前台轮询"模拟"推送成了跨宿主默认，
  后继 unattended-survival plan 已识别该类目错误（notify_on_output 只是会话内加速器、--detach 下
  stdout 全进 detach.log、真跨轮唤醒必须靠宿主调度器）但 L4 顺延，旧默认没被撤。本 plan 只做减法：
  默认反转为"启动→有界启动握手（≤30s）→汇报→交还轮次、查时再报"，状态查询唯一入口 goal-status，
  monitor 保留为 opt-in 盯守工具（不得当状态查询），禁事件轮询；零代码改动，纯 spec+docs；不复活 L4。
isProject: false
---

# goal 监控默认反转:无人值守交还轮次与查时再报(f8c3d6a2)

状态:**待 review,未开工**(v2;一轮 codex 意见六条 + 二轮 review 三条阻断均已逐条对 ground truth 核实成立并吸收,见核实表)

## 背景与根因链

用户期望:前台把 goal 跑起来后,goal-runner 进阶段时**反向通知**前台 agent 报进度;没有推送能力的宿主就**用户自己查**。实际行为:前台 agent 反复起 cmd 跑 `goal-monitor`,占死对话框。

这不是宿主误会,是现行规格在指导它这么干,且属于**两代设计叠加**:

```
bounded-monitor(2026-08-12 归档) : 为补"phase 完成后对话侧几小时无声息",
                                    把「前台轮询」设成跨宿主默认("MUST enter bounded monitoring")
unattended-survival(后继)        : 已识别类目错误——notify_on_output 只是会话内加速器,
                                    --detach 把 stdout 切进 detach.log,真跨轮唤醒必须靠宿主调度器;
                                    但 L4 cross_turn_wakeup 顺延(todo cancelled),旧默认没撤
────────────────────────────────────────────────────────────
结果:run 真后台了(--detach),对话框没有后台
```

`goal-monitor` 从来不是反向通知通道——它是只读等待器(每 2s 读一次 events,最多等 240s,无事件 no-op 退出),退出后是否再起一段完全由前台 agent 决定;规格叫它循环,它就循环。

## codex 意见核实表(逐条 ground truth)

| # | 断言 | 核实 | 证据 |
|---|------|------|------|
| 1 | monitor = 2s 轮询 + 240s 有界等待的只读读取器 | ✅ | [goal-monitor.ts:21](harness/scripts/goal-monitor.ts:21) `DEFAULT_MAX_SECONDS=240` / `POLL_MS=2_000` |
| 2 | 旧 plan 意图=前台必须循环 monitor,fire-and-forget 仅显式 | ✅ | [goal-mode-bounded-monitor.plan.md:31](.cursor/plans/goal-mode-bounded-monitor.plan.md:31)「必须进入 bounded monitor」;:58 fire-and-forget 仅用户明确要求 |
| 3 | 现行权威 spec 仍是 MUST enter bounded monitoring | ✅ | [goal-mode-skill/spec.md:91](openspec/specs/goal-mode-skill/spec.md:91) |
| 4 | 后继 plan 已纠类目错误但 L4 被 cancelled 未落地 | ✅ | [goal-mode-unattended-survival.plan.md:161](.cursor/plans/goal-mode-unattended-survival.plan.md:161) 裂缝 A 根治段;frontmatter L4 todo `status: cancelled`(注明"顺延非放弃,cancelled 仅为过发布门禁") |
| 5 | --detach 下 GOAL_PHASE 进 detach.log,宿主收不到 | ✅ | `emitMilestone`→console.log;detach launcher spawn `stdio:[ignore,logFd,logFd]` + `detached:true` + `unref()`——**HEAD 快照在 goal-runner.ts:2993–3019,工作树因 225 行未提交插入偏移至 ~3145–3190**,锚定函数不锚定行号 |
| 6 | 宿主会话实锤:monitor 循环 + 手搓 sleep 轮询长时间占用 | ✅(量级为准) | 会话 jsonl 粗 grep(全文含工具回显、未去重):`goal-monitor.ts` 字串 9 次、`sleep 10` 36 处;与 codex 的结构化工具调用统计(37 处/≈12,836s)口径不同但量级一致——**表述取"多次 monitor、数十次自制轮询、累计 ≈3.5h"**,形如 `for i in $(seq 1 55); do grep phase_verdict events.jsonl; sleep 10` 的单段就 550s,比 monitor 的 240s 界还狠 |
| 附 | 熔断只是止血非根治 | ✅ | [goal-mode-operations.md:112](skills/reference/goal-mode-operations.md:112) P1-8 熔断(3 轮无推进/30min)是行为约束,默认值没翻;07-17 曾占用 2h05m |

**核实结论**:codex 判断成立——问题不是"monitor 有点烦",是契约把"没有宿主唤醒能力"错误补偿成了"前台持续占轮次轮询"。修法是撤默认,不是修工具。

### 二轮 review 三条阻断(v2 已吸收,逐条核实成立)

| # | 阻断意见 | 核实 | 证据与吸收 |
|---|---------|------|-----------|
| B1 | `goal-monitor --max-seconds 0` ≠ 状态查询:默认 `since-event=-1`,分类器按事件序返回**第一条** index>cursor 的 `phase_verdict`——即最早的**历史** verdict 被当新事件报出 | ✅ | [goal-monitor.ts:342](harness/scripts/goal-monitor.ts:342) `sinceEvent = argv['since-event'] ?? -1`;`__testing_classifyNotification` 顺序遍历、首个 `phase_verdict` 即返回。**吸收**:状态查询唯一入口=`goal-status`;monitor 从"目标语义/t3"里的单发查询用法中除名;L4 唤醒后消费 monitor 须自维护游标,本 plan 不宣称"天然兼容" |
| B2 | 启动存活自校验有竞态:detach launcher 建 report_dir+detach.log 后即 spawn 并退出,**manifest 由子进程稍后写**——launcher JSON 返回时 manifest 可能还不存在(宿主已实锤首次 monitor 因此失败);v1 既要求"一次 goal-status"又全面禁 sleep,没给启动就绪留合法等待 | ✅ | detach launcher 段(HEAD goal-runner.ts:2993–3019):`mkdirSync(reportDir)`→`openSync(detach.log)`→`spawn`→`unref`→打印 JSON→exit,全程不写 manifest。**吸收**:定义**有界启动握手**(见目标语义),禁令范围收窄为"等待 phase/verdict/run_end 的事件轮询" |
| B3 | "原样保留 Cursor 加速器"与本 plan 根因自相矛盾:--detach 下 runner stdout 全进 detach.log,`notify_on_output` 匹配不到任何里程碑;保留该条还可能诱导 agent 自建 `tail detach.log` 长驻桥 | ✅ | [goal-mode-operations.md:117](skills/reference/goal-mode-operations.md:117) 加速器条目明写"匹配 runner stdout";unattended-survival 裂缝 A 早已证明二者物理不相容。**吸收**:t2 平移时**删除该条**,并新增禁止 tail detach.log 长驻桥 |

## 目标语义(反转后)

| 场景 | 行为 |
|------|------|
| **有人在场(attended)** | host bridge 的 phase callback 本来就逐阶段返回结果并汇报——**不跑 monitor,零变化** |
| **无人值守(--detach)** | 启动 → 解析 launcher JSON 取 `run_id`/pid → **有界启动握手**(见下) → 汇报 run_id + 进度文件 + 续查指令 → **立即结束轮次**。这就是新默认,不再叫 fire-and-forget、也不需要用户开口 |
| **用户问"进度怎样"** | 执行**一次** `goal-status --feature <f> --run-id <id>`,现查现答,答完交还轮次。**状态查询唯一入口就是 goal-status**——不得用 `goal-monitor`(含 `--max-seconds 0`)代替:monitor 默认 `since-event=-1`,会把最早的**历史** phase_verdict 当新事件报出,与当前 snapshot 混淆(B1) |
| **用户明确说"你盯着"** | 才进入 bounded monitor loop——原细则(next_since_event 照抄/timeout 耦合 N+60s/P1-8 熔断三阈值/heartbeat 去重/硬 liveness 停 loop)**原样保留**,只是从默认降为 opt-in;Cursor stdout 加速器条目除外(B3,删除) |
| **宿主有真跨轮唤醒** | 属 L4 cross_turn_wakeup,**本 plan 不做**(维持顺延)。L4 落地时消费 monitor 必须**自维护事件游标**(持久化 since-event),本 plan 不宣称单发 monitor 天然兼容(B1) |

**有界启动握手(B2,detach 竞态的合法等待窗)**:launcher JSON 返回时 manifest 由子进程稍后才写(宿主实锤首次查询因 manifest 未落盘失败)。故启动后允许**唯一一段**有界就绪等待:硬上限 **30s**、间隔 2–5s,只检查三件事——manifest 已落盘、`detach.log` 增长、liveness(beacon/pid 存活);窗口内就绪 → 汇报并交还轮次;超窗未就绪 → **如实报"启动未就绪/未存活"并给出 detach.log 路径**,绝不回报"已启动"。

**禁事件轮询(新增 BLOCKER,范围收窄后)**:禁止的是**等待 phase / verdict / run_end 的轮询**——不得用 `sleep`/`for`/`grep events.jsonl` 等手搓循环替代 monitor 绕回前台占用(宿主实锤:agent 意识到 monitor 空转后改写手搓轮询,占用反而更失控)。等待阶段事件的唯一合法途径是 opt-in bounded monitor;不盯守就交还轮次。上述 30s 启动握手是唯一例外,且只查就绪三件事、不等任何阶段事件。

## 改动面(零代码,纯 spec + docs)

### t1:OpenSpec change `goal-monitor-opt-in`(goal-mode-skill spec delta)

- **REMOVED**:`Requirement: Goal mode monitors active runs during the current turn`([spec.md:89–103](openspec/specs/goal-mode-skill/spec.md:89))——含两个 Scenario(启动后必进 monitor / fire-and-forget 须显式)。
- **ADDED**:`Requirement: Goal mode returns the turn after launching unattended runs`——启动 unattended run 后 SHALL 执行有界启动握手(硬上限 30s,只检查 manifest 落盘/detach.log 增长/liveness,超窗 MUST 如实报启动未就绪),随后汇报 run_id/进度文件/续查指令并结束当前轮次;状态查询 SHALL 唯一使用 `goal-status`(`goal-monitor` MUST NOT 用作状态查询);bounded monitor 仅在用户明确要求盯守时进入;agent MUST NOT 用自制 sleep/poll 循环等待 phase/verdict/run_end 事件。Scenario 四个:默认握手后交还/超窗如实报未就绪/用户要求盯守才 loop/事件轮询违规。
- **MODIFIED**:`Requirement: Goal mode documents monitor timeout coupling`([spec.md:105](openspec/specs/goal-mode-skill/spec.md:105))——措辞限定为"**当调用** goal-monitor 时"(opt-in 场景),内容不变。
- **不动**:`Goal mode distinguishes monitoring from wakeup`([spec.md:116](openspec/specs/goal-mode-skill/spec.md:116))语义本来就对;goal-runner spec 的三条 monitor CLI 条目([goal-runner/spec.md:605+](openspec/specs/goal-runner/spec.md:605))是工具语义,原样保留。

### t2:SKILL.md + goal-mode-operations.md

- [SKILL.md:45](skills/project/goal-mode/SKILL.md:45):「detach 存活检查和 bounded monitor」措辞改为「detach 启动握手、进度汇报与 opt-in 盯守」;每轮汇报节补一句:无人值守启动后执行启动握手、汇报即交还轮次。
- [goal-mode-operations.md:102–123](skills/reference/goal-mode-operations.md:102)「监控 loop 细则」重构为三段:
  - **「无人值守启动后的默认交还」**(新默认,含话术模板):先执行**有界启动握手**(≤30s,间隔 2–5s,只查 manifest 落盘/detach.log 增长/liveness;超窗如实报"启动未就绪"+detach.log 路径,绝不报"已启动"),就绪后汇报:①run_id 与当前 phase;②预计耗时与依据;③续查指令 `goal-status --feature <f> --run-id <id>`;④「后台继续跑,要看进度或让我盯着随时说」→ 结束轮次。汇报模板直接复用 P1-8 现成的转出话术,只是从"熔断后才用"提为"启动即用"。
  - **「查进度」**:唯一入口 `goal-status`;明示**不得**用 `goal-monitor`(含 `--max-seconds 0`)当状态查询,并写一句为什么(默认游标 -1 会重放最早历史 verdict,B1)。
  - **「opt-in 盯守细则」**(原 loop 细则平移):since-event 照抄/timeout 耦合/裁决轴/no-op/heartbeat/硬 liveness 停 loop/跨轮次接管/P1-8 熔断三阈值/chrys 空日志 BLOCKER 原样保留。**删除两条**:①「fire-and-forget」条目(已是默认,不再是需要点名的例外);②「Cursor `notify_on_output` 加速器」条目(B3:--detach 下 runner stdout 全进 detach.log,物理上匹配不到;若未来存在非 detached、有活 stdout 的路径再按 L4 声明式设计,不在话术层保留)。**新增一句禁令**:不得自建 `tail detach.log` 之类长驻桥接进程变相恢复 stdout 监听。
  - **新增 BLOCKER 条目**:禁事件轮询(措辞见目标语义节,含启动握手唯一例外),附宿主 08-14~15 实锤一句话背景。

### t3:runbook 同步

- [goal-mode-runbook.md](docs/operations/goal-mode-runbook.md) §运行中进度(:204 起):「主 agent 启动 runner 后……默认使用 bounded monitor」(:213)反转为默认握手+交还+opt-in 盯守,与 t2 同一措辞源;命令表(:230)`goal-monitor` 行注明「仅 opt-in 盯守用;**不得当状态查询**(默认游标 -1 重放历史 verdict),状态查询用 `goal-status`」;:199「随后按下文进入 bounded monitor」改为「随后按下文执行启动握手、汇报并交还轮次」。

### t4:验证与归档

- `cd harness && npm test`、`npm run openspec:validate`;skills/docs 属发布内容,跑 `npm run release:verify`;归档 change 进 `openspec/changes/archive/`。
- 已确认**无单测锁死现行文案**(skill-contract/docs-authoring-lint 均不含 bounded/fire-and-forget/monitor 断言),预期零测试改动;若 verify 揪出隐性引用,按同语义更新。

## 非目标与边界

- **不复活 L4 cross_turn_wakeup**:真跨轮唤醒(宿主调度器 re-invoke)维持 unattended-survival 的顺延裁决,本 plan 不预埋接口。
- **不动任何代码**:goal-monitor.ts/goal-status.ts/goal-runner.ts 零改动;monitor 的 CLI 语义、goal-runner spec 条目、熔断阈值全部原样。B2 的结构性替代(launcher 打印 JSON 前先等 manifest 落盘)曾评估:能根除竞态但改动 launcher「秒退」契约与 detach 探针背书过的行为,收益(省一段 ≤30s 话术级握手)不抵重新验证成本——**不做**,如 review 组倾向结构性修法可另裁。
- **结构性阻断不可行,如实承认**:monitor 是只读 CLI,框架无法辨别"谁在什么意图下调用",也拦不住宿主 shell 里的手搓 sleep——本 plan 的约束只能是规格+话术级(与 device 章"防御性指导"同一诚实口径);结构性解法=宿主调度器托管,即 L4,顺延。
- **宿主侧生效依赖重新出包**:宿主 `framework/` 里的物化副本要等 3.0.0 包重打部署才更新(该包本就因既有缺陷待重打,本 plan 挂同一发布门,不单独出包)。

## 风险

- **回摆风险**:反转后 phase 完成"几小时无声息"正是 bounded-monitor 当年立项的动机。回应:那个动机的正解是 L4 唤醒而非前台轮询;反转后的观测面=attended 逐阶段天然汇报 + 用户随口一问现查现答 + opt-in 盯守,声息缺口只存在于"无人值守且用户不在"——此时本来就没人在看对话框。
- **旧会话惯性**:已物化旧指引的宿主会话在换包前仍会轮询;换包即止,不做兼容垫片。
