# Goal Mode 运行手册

同一原请求持续到其真实终点。执行由一个协调器选择当前可做工作；原始请求、root/CU/request 的专用作者、真实检查和独立核验共用现有 run/owner/request 原件。有人/无人只改变运输和呈现。

## 入口与原件

使用 [统一入口](project-entry.md) 和 [Goal Mode 操作命令](../../skills/reference/goal-mode-operations.md)。在实例 framework/harness 运行原 goal-mode-entry / goal-runner，不创建第二运行器或状态库。请求范围、已签发 execution_scope、现有输入绑定与原完成终点不因新会话重新选择。

有人执行领取原 request 后读取原件，使用 execute_command，经原 --report-result 交回；观察/中断也使用原返回命令。无人执行 --detach，消费返回 startup 的有界启动确认：alive_timeout 保留 child 并报告尚未就绪，早退保留 detach.log，不等另一个心跳来制造健康结论。--attach-created、--resume、manifest、--run-id 必须指向同一 run。

新完整正式请求先按原始需求进入受管设计；canonical CU 尚不存在时不造平面 Feature/scope。初始设计、真实独立质询、正式发布、CU readiness、所有适用 CU 与原部件终点由同一 root 协调器持续处理。设计 ready、select_one 或子 run 出生均不是交付。

## 当前差额与反馈

readCurrentDispositionInput 组装当前适用义务、真实工具结果和独立发现，resolveCurrentDisposition 是唯一处置。assess、NEXT、report、status、progress 与 Feature/CU/component/release 消费同一结果；瞬时 currentResults/disposition 可在本次调用透传，不另存第二完成状态。

作者负责本单元授权内的设计细化、实现与测试输入；spec/plan/coding/review/UT/testing 是方法和检查族，不是六个独立作者排队。检查沿原作者 request/owner/fence 执行，保原工具实际身份。正式报告/截图/独核/完成原件由原 producer 发布，作者不能自签。

首次适用反馈包含全部当时可判定问题。一个读取故障或环境缺口不遮住已有真实 repair；错误原文保留并成为 verify/wait 缺口。当前 unknown 不变时自然 WAITING、无新调用；具体 producer/对象条件恢复后只补受影响工具或独核，验证出的真实 must_fix 交原作者。

独核读取前次公开结论、真实 diff/依赖、当前源与完整拒修原文。作者拒修是论据而非结案；新拒修补入实际材料并更换 subject，不重跑无影响工具/作者，旧请求保留。相同有效材料复用原独核，变化材料不得借历史 PASS。

## 恢复与控制

设备执行使用最低 Hylyre 0.5.0，正式 trace schema 为 `0.4-p0`，`result_protocol` 为 `hylyre.step-outcome/1`。StepResult 从 `outcome.status` 读取状态；失败原因读取嵌套的 `outcome.failure`、`outcome.cause`、`outcome.reason`，选择器请求与实际解析分别读取 `selector.request`、`selector.resolution`。保留原 trace 与截图，不能把平面字段或工具退出码替代步骤验收。

已有 testing trace/plan/timing/meta 只需重算报告时，使用 `harness-runner --phase testing --feature <feature> --report-reconcile-only`。原 producer 读取真实执行原件并重建报告门禁，不调用设备/provider/视觉/lifecycle hook，不要求作者先写顶层 `test-report.md`；缺执行原件仍保留缺口。

普通重发先接原 active run。真实 no_progress_guard 表示可比验证已完成且验收无改善；旧重复报告、元数据变化、同条件重入不能购买新窗口。明确继续沿原 force-resume/force-takeover 与授权/owner/写保护处理；原未完用户截止不重置。

框架默认 budget/max_turns/阶段重试或回退数/总墙钟均不再控制新 run。仅显式 --user-deadline-at UTC 约束用户截止；取消、真实原生终态、具体工具期限、设备门、native stdout/stderr 静默保护和 fenced writer 保留。静默窗口为 max(90分钟, 现有公开Hvigor构建或设备UT期限+45分钟检查余量)；2小时配置对应165分钟，6小时对应405分钟。heartbeat/lease不延长该窗口；持续真实输出不受总时长限制。未确认停止/超时结果保持未知和可续，不可伪 seal。

run-control epoch 与真实 request/accepted report 防重复和旧 owner 迟报。强制接管先确认精确旧绑定停止；缺失/不可核实绑定不得扩大授权。只清理目标 owner/PID/root，保 events、run-control、manifest、requests、原生流和合法成果。没有本次真实 grant 的调用截止保持未知，不能从历史默认 timeout 猜当前截止。

## 状态与终点

活性（原调用是否运行/结束）与业务完成分开显示。events-only 历史可读并展示 elapsed/activity，但缺 manifest/原件时业务未知；读取错误不能签 PASS。calls/active_ms 是统计，不是配额。历史 budget 仅可标注历史。

Feature/CU 需要适用义务和正式完成原件；部件还需其装配及正式 closure 原件，release 使用同一事实的发布条件。全部 CU 完成或 evaluate 条件绿不代签 component：原机器 writer 正式写出、重读校验后才可使用。普通完成与发布就绪分开，未知保持未知。

## Adapter 与现场边界

Codex、Claude、DSH 只准确续接本单元原生ID；会话不存在或权限改变时重建专用上下文并披露。独核不继承作者SID。DSH使用真实headless profile/路由凭据，框架不复制秘密，不假定工具shell透传凭据。设备/PIN/安装/截图都沿原 device gate。

## DeepSeek Harness（dsh）

独立视觉使用已冻结的 `visual_provider_pin`，包含准确 provider、完整 model ID、来源和适用推理设置，沿公共模型回放与原生请求核对。先加载该模型来源，最后加载发布件内 `visual-readonly-patch.yaml`；开发继续使用 `headless-patch.yaml`，两种用途不共享权限档位。视觉固定 `read-only/never`，关闭写入、shell、PTC、子 agent/workflow、插件管理及工程入口/技能加载，最终工具面只保留必要读取；同时关闭图片卸载和自动摘要，超限如实失败。

DSH 视觉只采信退出 0 的最后一条完整 `final.text`，不要求额外的 turn_end；每张本次图片均须有 `read_image` 调用及其成功结果，能力错误、漏图和残缺终稿沿现有 unavailable/invalid 返回。身份回显、图片哈希、逐屏载荷与工作区变化继续走现有校验。

2026-11-06 实测桌面 `0.2.2-rc.1`：默认内置 `deepseek-official / deepseek-flash / high` 路由读取随机图与仓内截图成功；较早 overlay 的不同模型被最后视觉 patch 覆盖，原生会话确认只读权限，项目文件清单与哈希不变。该版 `read_image` 的参数为 `file_path`。 工具面结论以本次已验证的实际配置组合为界；模型来源若新增 MCP 或扩展工具，应重新验证组合，不承诺任意扩展自动具有只读约束。同一真实 stdout 经修正后的正式消费入口回放通过身份、图像哈希、观察载荷和随机颜色核对；没有为重算投影再次购买看图调用。随后开发在独立工程经 Windows guardian 成功写入指定文件，原生记录仍为 `danger-full-access/never`。

目标模型的图像/上下文上限未在本次可见非秘密元数据中声明，记为未知；不静默卸载图片或切换模型。凭据仅由 DSH 自己解析；本轮按用户约束未读取、复制或哈希凭据文件，因此未验证其前后哈希。DSH 正常会话、附件和日志会落盘，不宣称进程零写入。模型/认证不可用时如实披露，保留开发能力，不伪造视觉通过。实测详情见开发验收记录，不能扩称宿主业务已交付。

本手册描述开发实现；P3仍以开发定向/整合验收记录为准，P4真实联合宿主/设备验收 pending。历史CLI探针只证明其实际覆盖的启动/运输/会话能力，不证明业务交付。
