## Context

架构依据为docs/architecture.md与72b6f0d9的P1→P4。既有run、owner epoch、invoke_id、原始agent-events流和写入快照能够保存执行事实，无需另一运行器或会话数据库。b84未验收代码已按批准迁移表恢复，计划与原件保留。

## Goals / Non-Goals

**Goals:** P1提供工作单元执行底座；P2原位统一公共工具/当前处置/完成评估，接确定准备、增量独立核验与运行中验收收敛。

**Non-Goals:** 本阶段实施P3入口切换及旧控制退役，不运行真实宿主或P4联合验收。四阶段共用此change，后续阶段按自己的范围补齐delta与任务。

## Decisions

- 原生定位只增加provider_session_id；从对应调用原始流立即持久化，恢复先核run、adapter、projectRoot与当前权限。缺ID或权限变化重建专用上下文，公开说明恢复边界。独立核验不使用作者会话。
- WorkUnitExecutionContext原位收编阶段上下文，phase只保留里程碑/旧消费者定位含义。purpose和既有请求身份仍是职责事实；executionRole只是当前调用的派生视图。
- 用户明示时限使用manifest可选user_deadline_at，UTC绝对值只换算一次。旧budget和phase timeout不作为新执行底座调用前提；具体工具超时与owner租约仍承担各自保护。
- 原生CLI没有真实stdout/stderr增长且未观测到终态，持续达到 `max(90分钟, 既有公开单工具配置期限+45分钟检查余量)` 时，调用同一中断/进程树清理链，保留原流、合法成果和已核实SID，结果为未知/可续。当前读取既有Hvigor构建与设备UT期限：默认仍90分钟，2小时配置取165分钟，6小时配置取405分钟。框架heartbeat和lease不刷新该窗口；持续真实输出不受它的总时长限制。它只保护不透明运输的挂起，不判断P2业务进展，也不新增业务评估计数或状态。
- 观察返回原始工具流、当前快照和写入变化，调用方复用相同结果不制造新评估。中断由现有owner绑定的进程/会话执行，确认停止后才记录waiting与产物；判定何时无进展由P2唯一负责。
- 写边界从Skill I/O、profile和可信范围派生。作者可写实现与测试输入，正式完成原件/绑定输入继续显式保护，真实runner工具产物沿既有排除与writer/重建保护。独立上下文不等于原生只读：质询/canary请求原生只读并披露实际能力，正式review/格式修复保留原有有界报告及工具能力，不获得产品源码写权。

## Risks / Trade-offs

- [原生会话不支持或已失效] → 真实报告能力边界，按当前事实重建；不使用--last、不回落主会话施工。
- [Claude恢复保留旧system snapshot] → 权限改变时按新授权重建，CLI实际收窄工具集；不靠追加一句prompt撤权。
- [旧消费者仍含阶段/配额控制] → P1只提供最终结构组成，P3统一切换并删除旧控制，本change不发布双路线。
- [工具长时间静默但可能仍在运行] → 按既有公开工具期限加余量计算的窗口不是任意工具静默时长保证；超过窗口仍可能中断为未知。恢复依原调用事实和SID，不猜测工具成功/失败；已观测终态仍由原短清理宽限收口。

## Migration Plan

先完成P1定向验证、三个CLI隔离续接与官方门禁；P2接检查/完成同源，P3切入口并更新MIGRATION和现行规范，P4完成开发全链及用户安排的宿主验收。各阶段提交可审切点，不把中间状态打包给消费者。

## P2 Decisions

- readCurrentDispositionInput一次组装当前适用输入、工具结果及核验发现，resolveCurrentDisposition是唯一语义处置；currentResults直接入读，不等阶段summary/closure齐全。报告、NEXT及签发投影同一结果，原始FAIL/未执行与当前任务分开。
- check/compile复用原CLI和checker/provider；phase仅选检查族，缺省按当前适用义务，不默认全套。输入/环境/材料与结果绑定仍有效时复用原件，不重复昂贵执行。
- 同入口处理结果复用、比较资格与已有基线更新：无相关作者改动的原样工具重跑不算新评估，不推进窗口；相关改动后实际核验，或已反馈后真实作者交回的首次完整目标评估，才比较验收/已核实发现。后者由原invoke/结束事实判断，不把重复报告、旧结束事件或补验当作新机会；新的独立证据可证明进展。元数据/编号/投影重写不构成改善。
- 运行观察只读取已经完成且有效的工具/独立结果，不按token/通知次数重复执行或解析；无验收改善经P1原owner绑定取消/停止，确认后保全并可续暂停。P1首次dirty前像与gate前未恢复保护不因复用而解除。
- 确定准备复用既有schema/writer，业务未知不填PASS；独立核验复用P1唯一Q接收链，同材料FAIL/PASS均可复用但不改变真值，变化材料不得借历史PASS自动通过。P3其它消费切换只列交接。

## P3 Decisions

- 同一原请求只有一个完成协调器；root、各CU、独立request各有专用作者。同一unit作者原request/SID承载各真实检查族，phase仅为方法/工具选择及历史定位，去phaseIdx/retry/backtrack队列，不伪造缺席phase作者或PASS。
- 派发前读同次当前request、accepted report、completed/reusable结果及disposition/evaluation。已完成unknown只剩verify/wait时给具体producer/对象解除条件WAITING，同条件零调用；恢复后只补受影响检查。新独核实质反馈交原作者，元数据/重复拒修不制造比较机会。
- 新builder忽略旧budget；有效unattended无max_turns/timeout_seconds/phase_timeout_seconds，旧字段仅历史解析。显式--user-deadline-at归一到user_deadline_at；未完请求沿用，不从wall推导。取消、真实终态、公开工具期限、idle、owner/fence和写保护保留。
- assess/NEXT/status/report/progress及Feature/CU/component/release只消费现reader/resolver/evaluation，不各自采collector/派工/写状态。已有currentResults/disposition透传；局部读故障保原错误verify及其它已判定repair。历史活性/elapsed可读，但events COMPLETED不签业务完成。
- testing FAIL须真实可独立核验对象/原报告满足现资格才签诊断request；无关环境缺口不遮住可独立工作。晚到拒修原账本完整进当前material，旧request/material/prompt保留，新材料沿原writer换subject，无影响工具不重跑。不匹配行不采信也不裁掉原件。
- 初建root持续全部适用CU至原部件终点；ready-set单步或allCUCompleted不签交付。component原writer正式记录后重读校验装配/独核证据；release仍为同一处置的发布条件。
- P3实施与开发验收不等于宿主交付。P4联合宿主/设备pending，architecture现状段须开发验收成立后更新。
