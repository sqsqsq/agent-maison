P3现行解释：本change入口诉求与保真契约保留；旧phase冷派工、总预算与只到allCU的终点方案由completion-driven-execution收编替换。现root持续到原真实部件终点，作者专用会话、独核和正式writer分责，显式用户截止/取消及真实工具保护有效；原实施记录不代表P4宿主验收。

## Context

当前初始设计在 Goal 出生前交回主会话；已有设计修订、独立质询、CU consumer/P2 循环与正式完成读取可以复用。本批按 f3b8e6a1 最新批准范围接线，遵守 `docs/overview.md §1.2.1` 四原则，不重写已完成历史计划。

## Goals / Non-Goals

**Goals:** 原始正式完整请求从空特性目录开始受管；作者返回后据真实检查继续返修/质询/准入；单/多 CU 自动接续，保持原需求、授权、预算与恢复连续。原请求终点为全部适用 CU 正式完成，部件闭环只读检查一次并披露。余下输入修复仅含未冻结候选过时重算和新 root 阶段动作正确保存。

**Non-Goals:** 不扩建 Service/Library lens；不扩大仅设计、维护、只读或单职责权限；不新建外层调度器、请求登记表、交接状态/消耗账本；不做未开工 child 输入纠错、历史 root 阶段 override 迁移、额外阶段域组合、P3 自动收口/自动修复或 native 逐例解析扩展。不改变原 P3/UT/Feature 验收，不提交、打包或操作真实宿主/设备。

## Decisions

1. **复用原 Goal manifest/events 与同一 runtime。** `initial_design` 只保存尚不能派生 CU scope 的不可变请求输入，原始需求/来源、模型视觉钉及预算等仍在原字段。工作区路径键不冒充 canonical CU，初建没有施工 scope、基线或伪造 phase PASS；正常 Feature 契约不放宽。只删除入口早退仍无法诚实表达无 CU 的受管请求，因此需要该输入变体。
2. **初建与修订共用现有责任链。** 沿同一调用、快照、next/report 或 headless transport、独立质询、原检查与发布接缝，仅在真实基线/revision 差异处分支。runtime 调用原准入派生而不让作者填绿；缺质询先派真实独立方，格式/设计缺口定向返作者。直接设计请求仍止于自身终点。
3. **正常 child 出生是唯一交接事实。** 复用 P2 ready-set/selector/progress-loop；CU run 保持自身身份，选用不可变 `delivery_origin: {feature, run_id}` 绑定原请求，键在场进入原身份校验。该字段无 owner/授权/进度含义；不新增 root handoff 事件或 active-child 文件。root 与 child 作者窗口不重叠，报告或重入从真实出生/完成事实恢复。
4. **原请求输入与预算只有一处真源。** child 继承原需求/来源、adapter、模型视觉钉、fidelity、超时及原限制；各 CU 影响按实际 CU 事实判断。有效预算按 root 出生/合法调整核定，child 出生预算不授予提额权。扩展原 lineage reader 以 `(feature, run_id)` 去重，按真实 invoke 累计，逐 run 解析后合并活动区间，避免嵌套双计。
5. **原请求终点与部件检查分开。** child 完成后自动返 P2；全部适用 CU 正式完成有效即到本批原请求终点。随后仅按原部件闭环口径只读检查一次并如实披露，不自动派修、写出、收口或把失败改为 PASS；本请求完成不冒称部件闭环通过。完成后同请求重入重读原 CU 完成事实返回原结果；新实质要求走既有更正。
6. **候选和新出生输入只修原责任。** 设计修订后，尚无该 CU 的 child 且无冻结范围时，过时 scope 候选交原 scope 作者沿返回的 `--prepare-scope --overwrite` 整份重生成，不能仅换指纹或挪用旧判断；新候选仍经同一严格出生解析。新 root 的明确动作只取真实输入，未给不注入默认六阶段或 coding；原起止边界、真实 workflow 和预算含义保持，不反推为用户逐段要求。已出生或冻结的旧记录不进入新增纠错通道。

## Risks / Trade-offs

- 无 CU 时误放宽产品写界 → 原设计快照/写界限制只允许指定设计产物，施工必须等真实准入和正常 scope。
- 跨 Feature 交接丢输入、授权或预算 → child 正常出生绑定 origin，恢复读取原始合法字段与可信控制授权；总额度/消耗不因切段或后继重置。
- 作者退出、child 自报或旧终态误绿 → 原检查、completion/P2 当前输入重读，状态显示实际工作；部件检查原结论单独披露，不让原请求完成冒充 P3 PASS。
- adapter 缺隔离/后台能力 → 普通作者可主上下文并披露，必需质询/verifier 真实独立；后台仅按原 preflight/握手报告，不虚加 YAML 能力。

## Migration Plan

通过既有发布件集成与 framework-init UPDATE 刷新现行入口、Skill 和共享 adapter 模板。MIGRATION 明确替代“初始设计先留主会话”的旧策略。无 origin 的旧 run 保持原身份语义，不补默认或改历史事件；有效蓝图/CU/run/证据继续复用。本批 Node t7 实验停止作废，保全原件但不作验收，t7 仍未完成；真实模型链交用户安排宿主干净环境重跑。开发组合、真实 CLI 与真实宿主/设备证据分层，未覆盖如实保留。

## Open Questions

无新增产品决策。公开命令/返回字段以本批实际实现为准，不新增用户 flag 或宿主回调。
