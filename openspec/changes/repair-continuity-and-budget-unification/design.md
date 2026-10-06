## Context

本 change 对应 3.1.0 plan `返修接续与资源预算归一_视觉裁决同源_6c1e8b4a`，基线 `4a87b7db`。
2026-10-05 只读宿主审计证明三类故障；源码确认 runtime completed 与 attempted 把进程结算当返修完成，四条回退链与 adjudication 使用固定 2，
provider writer 任何 must_fix 都映射 fail，而 gate 拒证/collector 丢弃 minor 的结论不一致。原则与范围以 `AGENTS.md`、`docs/overview.md §1.2.1` 和该 plan 为准。

## Goals / Non-Goals

**Goals:**

- 中断返修保留已有候选与原始相关输入，在原 run/repair window 继续；静态 PASS 不代替指定任务完成。
- 用同周期总调用/活跃时长约束真实工作，取消固定两次回退的硬停机资格，公开入口可重评旧 backtrack_limit-only。
- 以现有视觉有效视图和 gate 产物统一授权、severity、保真消费，minor 可披露，真实 blocker 可修复，缺证可恢复。

**Non-Goals:**

不改变完整 attempt 后 signal one-shot、拒修/反驳或其它熔断；不刷新预算或扩授权；不改可信完成周期边界。
不做网络看门狗、宿主覆盖 schema/TC-007、真机提速、提交/打包/宿主运行；不另造状态机、协议、注册表或场外档案。

## Decisions

### 1. 按原返修窗口区分结算、完整尝试与验证解决

当前 invocation 的完成按 invoke_id 精确判断；返修窗口完成从既有事件回放任一次完整 owner 调用或当轮全部成立拒修，二者不混用。
runtime 在现有 agent_invoke_end 上与 terminal_failure_observed 并列写可选 completion_observed，按当前 invoke_id 精确读取自己的 end；旧 end 缺字段先读同一 invoke 的 phase_verdict.completion_observed/agent_failed。无对应 verdict 且 exit 非零、无 timeout/失败终态才记 unknown，仅在返修窗有界重跑 owner。完成观测＋清理非零＋gate 前崩溃可据 end validation-only 并计 attempted；timeout/turn.failed 回 owner。
normal terminal/completion observed 保持完成含义；窗口没有完整 owner 调用或当轮全部成立拒修时，timeout/API/工具/unknown interruption 保持未完成，普通 compile/static PASS 不能消掉它。窗口外旧格式保留原 validation-only 资格，先重验 gate，不补造调用完成。
同进程续作、completed、signal attempted、resume invalidation/validation-only 和 advance 共同消费，native/provider/legacy 不因无 signal@1 而漏掉。
中断恢复不发新的产品 backtrack，只计真实新的阶段调用与活跃时长。timeout 沿现有连续 timeout/未完成 advance/阶段重试，已识别 transient 沿回放的 transientRetriesUsed/max_transient_api_retries，unknown/其它执行失败沿现有阶段恢复上限；普通 PASS 事实不能让未完成 work 的 retry 跳过这些计数，不新增 pending-window 预算。旧错误 completed/PASS 在未封卷窗口按实际 invocation 重评，旧事件不改。
历史只重评最新未被后续 request 替代的窗口；相关 invalidation 切开旧完成事实。窗口已有完整调用的事实不因后续重试中断消失，保持同进程与 resume 一致。

拒绝仅移除 transient 分支的 `verdict !== PASS`：它覆盖不了 timeout、native 与 attempted/resume，且会误重跑真实完成的清理非零。
实际调用完成只证明 owner 尝试结束；当轮全部成立拒修走既有 declined 出口。既有 no-op/one-shot 与后续独立验证保持，不存在单独的“目标证明免执行”通道，源码变化也不证明产品修好。
完整 signal attempt 之后的 one-shot 保持，修的只是中断结算冒充完整尝试。

### 2. 删除固定次数硬资格，沿既有资源折叠限制工作

从 legacy fidelity、scope replan、owner write recovery、普通 repair 与 adjudication 结构 facts 撤固定 2；次数保留事件诊断与 transaction 序号。
总调用/总活跃时长继续消费 `foldBudgetLineage` 与 session partition，同任务 successor 或 correction 文案不刷新资源。
现有相关输入＋缺陷集合的 no-progress、完整 signal one-shot、拒修、越权及 bounded retry 全部保持。
unknown 快照、legacy/provider 候选、scope replan 没有其它现行熔断时只受剩余总调用/活跃时长约束，最坏可耗尽剩余硬预算；不保留隐藏常量或另造收敛。
拒绝调大 2 或引入动态回退额度：它们保留重复预算面和换 run 的停机动机。删除已无生产用途的 max 参数/常量，旧字段仅历史解释。

### 3. 旧停机在当前裁决/接续边界重评

只处理当前交付周期中未完成、未被承接且有原硬资源余量的 backtrack_limit-only run；身份/范围/owner、其它真实终局仍沿原入口核验，不另加必须最新一项的资格限制。
由当前裁决规则给出同一重评结论，普通重发、显式 resume（前台/detach）、attended prepare 与 supervisor 使用它；保留原事件字节与旧账本。
不在 run-state reducer 下游复制新的 halt_reason 分类表，不全局擦除历史 TERMINAL，不将真实预算耗尽或无进展伪装成旧政策。
本批不新增旧 backtrack_limit 专用 validation-only 效率优化。
拒绝只更改 incident registry：现有明确 TERMINAL 已在事件中，公开入口仍可能提前拒绝，必须走到同一生产恢复边界证明可达。

### 4. 原始视觉意见留存，有效裁决一处消费

扩已有 `effectiveScreens` 的授权过滤与 severity/保真消费，writer 使用同语义的候选 verdict，最终 gate 仍核证据/覆盖/机器信号。
minor fully anchored must_fix 只披露；soft 自报/provider major 沿现有降级债务；hard major/T8 major/blocker 保持现行 ratchet 与修复；
未结构化 legacy、mixed refs、重复 screen、未知锚定和独立确定性失败保守处理。原 payload/source/hash/must_fix 不删，provider 永不产 verdict。
writer 对 minor-only 和 soft 可降级屏产 warn 候选，保留 pass 候选 defects 为空的规约；warn 的证据资格仍取同一有效裁决，不开 minor blocking debt。
gate hits/channel evidence、collector、visual-debt/report 共用有效视图或本 run/attempt 的现有 structured 物化；runtime 不复制档位规则。
拒绝仅 writer fail→warn：must_fix 的独立拒证还在。缺 screenshot/build/coverage/receipt 是 testing 补证，不冒充产品通过或凭不可信意见改源码。

## Risks / Trade-offs

- [旧日志缺少明确终态或相关输入] → 旧终态用同 invoke verdict fallback，缺失时只在返修窗有界续作；unknown 快照/legacy/provider/scope 无其它熔断时可耗尽剩余硬预算，不迁移或清账。
- [历史显式 TERMINAL 在不同入口残留] → 公开入口反例必须走真实函数，覆盖普通/显式/attended/supervisor，不只测 helper。
- [severity 投影压掉其它失败] → mixed refs、T8/placement、重复屏、legacy unanchored、缺证独立反例；minor 只消除其自身产品否决。
- [取消固定上限延长运行] → 同周期 hard turn/active-time 始终兜底，完整 one-shot 和既有 no-progress 仍有效。
- [网络持续 Reconnecting] → 本批不解决早停；运行仍消耗硬时长，交付明确披露。

## Migration Plan

无强制宿主文件迁移。消费新发布件后按当前规则接续已有未完成 run；旧事件、decline、snapshot 与资源账本保留。
`MIGRATION.md`/Skill/运维说明删除固定两次硬额度与靠 requirement increment 刷机会的指导。回滚通过上一发布件完成，不改宿主历史记录。
progress/report 不再展示回退 Budget x/2；progress/supervisor 的当前接续消费保留，report 只保留已实现的历史诊断输出，不增加展示协议。迁移说明披露 unknown 最坏资源消耗及 soft provider major 从回 coding 变按档位债务/阻断发布的实际行为变化。
本批只产 Maison 源码与规格，不执行发布/部署。真实 H1 由用户验证，机器测试不关闭 H1。

## Open Questions

共享窗口判据的安放位置、旧 terminal 重评接口、视觉 structured 是否确需新增可选字段，在实施时选现有调用链的最小方案；行为边界已冻结在 plan/规格。
完整 attempt one-shot 的长期演进、网络看门狗和局部真机反馈均为后续非阻断议题，不纳本批实现。
