# Delta: Goal Runner — 设备就绪门 / 完成观测 / 声明前移 / 模拟器托管

## ADDED Requirements

### Requirement: Device readiness gate before agent_invoke_start

goal-runner MUST 在 capability preflight 之后、`agent_invoke_start` 之前执行**异步**设备就绪门。该门 MUST NOT 复用 `runInvokeCapabilityGate` 的同步实现与其固定 `verdict='FAIL'` + `await_human_capability_gap` 返回语义（后者装不下 boot 等待/解锁/复验，且设备不可用应走 `external_block` 而非静态 capability FAIL）。

执行范围 MUST 由 profile capability 或 `requires_device` 元数据派生，MUST NOT 永久硬编码 `phase === 'ut' || 'testing'`。

门返回三态：`READY`（注入目标后放行）、`BLOCKED`（`external_block`，无 invoke）、`AMBIGUOUS`（HALTED，无 invoke）。未取得 READY 时 MUST NOT 产生 `agent_invoke_start`。

目标 MUST 以 `{serial, targetKind, sessionId}` 经 `extraEnv` 注入子进程，MUST NOT 写入全局 `process.env`。

#### Scenario: 设备不可用不烧 agent 轮次
- **WHEN** 就绪门判定 BLOCKED
- **THEN** events.jsonl 无本 attempt 的 `agent_invoke_start`；结论走 `external_block`，非 capability FAIL

#### Scenario: 无设备需求的 phase 不触发本门
- **WHEN** phase 未声明 `requires_device`
- **THEN** 就绪门不执行，不探测设备、不启动模拟器

### Requirement: Device target immutability within an attempt

`agent_invoke_start` 之后，本 attempt 的 `{serial, target_kind}` MUST 冻结。运行期锁屏 MUST 只允许在**同一 serial** 上恢复并重试原操作一次；恢复失败时当前 attempt MUST 判 INCOMPLETE/`external_block`。切换到模拟器 MUST 只发生在下一 attempt 或 `--resume`，并从阶段起点重跑。

#### Scenario: 禁止真机跑一半热切模拟器
- **WHEN** 运行期真机恢复失败且模拟器策略启用
- **THEN** 当前 attempt 结束为 INCOMPLETE；模拟器仅在下一 attempt 由就绪门选择

### Requirement: In-invocation completion observation

goal-runner MUST 在 agent 等待期间运行完成观测，与进程 settle / hard timeout / silent watchdog 竞争。判据 MUST 为纯只读 receipt validator（MUST NOT 启动会写盘的 CLI）叠加**本 attempt 新鲜度**：invoke 前记录证据基线，只认本次调用后"不完整→完整"的跃迁；若调用前证据已完整，MUST 跳过本次调用而非启动后立即终止。

分层约束：通用进程层只负责 timer/race/kill，完成判据 MUST 由 goal-runner 以 `completionProbe` 回调与绝对 `deadlineMs` 注入，通用进程层 MUST NOT 依赖 receipt schema。

收口动作：证据完成后 MUST 等待最多 5 秒自然退出，仍存活则 tree-kill 本次 agent invocation。该结局 MUST 记为 `completion_observed=true`、`timed_out=false`，且 MUST NOT 归为 `agent_failed`。收口 MUST NOT 终止 runner 托管的模拟器。

validator 遇半写入/解析错误 MUST 视为本轮未完成并在下轮重试，MUST NOT 转判 completion、MUST NOT 终止 agent。

#### Scenario: 证据完成即收口
- **WHEN** receipt 四条件在本 attempt 内由不完整变为完整，而 agent 进程仍未退出
- **THEN** 等待自然退出至多 5 秒后终止该 invocation，记 `completion_observed`，phase 走既有 gate 流程

#### Scenario: 旧 attempt 遗留证据不误判
- **WHEN** invoke 前证据已完整（retry 遗留）
- **THEN** 跳过本次 agent 调用，不产生"启动后立即终止"

### Requirement: Managed emulator session lifecycle

模拟器 MUST 由 runner 起停并置于 detached 独立进程组，MUST NOT 成为 agent 进程的子进程。会话 MUST 记入 `<report_dir>/device-session.json`（pid + 启动时间 + 可执行文件 + profile 四元组、目标 serial、`started_by_run`、启动状态）。

回收 MUST 只针对本 run 启动的实例：用户既有实例可作为 target，但 MUST NOT 被关闭。所有权 MUST 由四元组确认以防 PID 重用。

清理语义 MUST 诚实收窄：正常退出与 SIGINT/SIGTERM 时清理；runner 崩溃后 MUST NOT 假装自清，改由下次启动或 `--resume` 依 `device-session.json` 对账进行有界回收。

`target_kind` MUST 由正面证据判定——本 run 启动或可关联既有 Emulator profile/process 的 serial 判 `emulator`，经已验证 HDC 属性组合确认判 `physical`，其余判 `unknown`。MUST NOT 使用"不是已知模拟器故为真机"的反向推断。

#### Scenario: 崩溃残留由后续 run 对账回收
- **WHEN** runner 崩溃留下托管模拟器
- **THEN** 下次启动/`--resume` 依 session 文件确认所有权后有界回收；用户自起实例不受影响

### Requirement: Conditional early validation of declared product layers

当 phase chain 含 testing（或确需 product snapshot）时，goal-runner MUST 在 run/manifest 创建之后、**整个 run 的第一个 phase agent invocation 之前**校验 `architecture.outer_layers` 声明目录与文件系统的一致性，并复用 `computeProductSourceSnapshotDetail` 单一校验器。校验失败 MUST 写 `phase_halt` 与 `run_end=HALTED`（MUST NOT 在建 run 前裸退，否则无可监控 run 且无法表达 resume）。`--resume` MUST 重检。testing pre-invoke 处既有校验 MUST 保留作纵深防御。

#### Scenario: 缺目录在首个 invoke 前即暴露
- **WHEN** chain 含 testing 且声明的产品层目录不存在
- **THEN** run 建立后、spec 的 agent invocation 之前即 `run_end=HALTED`

#### Scenario: 无 testing 的链路不受影响
- **WHEN** chain 为 spec-only / plan-only / ut-only
- **THEN** 不执行该早检，不因永不访问的目录失败

## MODIFIED Requirements

### Requirement: Device-blocked failures reuse external_block classification

设备环境阻断（含锁屏）MUST 归入既有 `FailureKind` `external_block`，MUST NOT 落入 `code_regression`，MUST NOT 触发内容修复 retry。MUST NOT 为此新建平行分类体系。

#### Scenario: 锁屏不触发改码重试
- **WHEN** ut 因设备锁屏失败
- **THEN** goal 分类为 `external_block`，指引指向修环境而非改代码
