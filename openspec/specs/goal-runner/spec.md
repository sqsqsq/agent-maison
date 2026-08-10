# goal-runner Specification

## Purpose
TBD - created by archiving change tool-agnostic-goal-runner. Update Purpose after archive.
## Requirements
### Requirement: Goal runner orchestrates feature phases deterministically

The system SHALL provide `harness/scripts/goal-runner.ts` that executes an ordered list of feature phases between `start_phase` and `end_phase`, invoking the configured agent headlessly per phase with fresh context, then running `harness-runner.ts` for each phase.

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/phase-transition-policy.ts`

#### Scenario: Happy path advances through chain

- **WHEN** each phase harness returns verdict PASS
- **THEN** runner advances to the next phase until `end_phase` completes and writes goal-report with status COMPLETED

#### Scenario: External block defers and continues when allowed

- **WHEN** a phase returns verdict INCOMPLETE with deferrable `blocking_class` or `failure_kind` per `dependency_policy`
- **THEN** runner records phase as DEFERRED, continues if policy allows, and final goal status is DEFERRED or PARTIAL (never COMPLETED)

### Requirement: Goal run evidence layer

The system SHALL persist each run under `{paths.features_dir}/<feature>/goal-runs/<run-id>/` (default `doc/features/<feature>/goal-runs/<run-id>/`) with `manifest.json`, `events.jsonl`, per-phase artifacts, and final `goal-report.{md,json}`. `manifest.feature` SHALL be required for new runs.

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/goal-manifest.ts`, `harness/scripts/utils/goal-report-generator.ts`

#### Scenario: Resume requires feature or manifest

- **WHEN** user invokes goal-runner with `--resume <run-id>` without `--feature` and without `--manifest`
- **THEN** runner MUST exit non-zero with a message requiring `--feature` or `--manifest`

#### Scenario: Resume with feature loads single path

- **WHEN** user invokes goal-runner with `--resume <run-id> --feature <f>`
- **THEN** runner loads manifest from `{features_dir}/<f>/goal-runs/<run-id>/manifest.json` and continues from last incomplete phase

### Requirement: Goal runner preflight blocks invalid adapter capability

The system SHALL BLOCKER-fail preflight when `goal_capability` is missing or `unattended` contract is incomplete for the active adapter.

Enforcement: `harness/scripts/goal-runner.ts`, `agents/adapter-schema.yaml`

#### Scenario: Missing goal_capability at runner start

- **WHEN** goal-runner starts with an adapter lacking `goal_capability`
- **THEN** preflight exits non-zero before any agent invocation

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

### Requirement: Device-blocked failures reuse external_block classification

设备环境阻断（含锁屏）MUST 归入既有 `FailureKind` `external_block`，MUST NOT 落入 `code_regression`，MUST NOT 触发内容修复 retry。MUST NOT 为此新建平行分类体系。

#### Scenario: 锁屏不触发改码重试
- **WHEN** ut 因设备锁屏失败
- **THEN** goal 分类为 `external_block`，指引指向修环境而非改代码

### Requirement: Goal runner exposes a versioned reconciliation observation
The runner SHALL derive `ReconcileObservation@1` from authoritative events and process state, including phase outcomes, blocker actionability, deterministic defects, used budgets, repeated-round fingerprints, invalidatable phases, timeouts, interrupts, and API disconnects. Enforcement SHALL be implemented in a dedicated utility extracted from `harness/scripts/goal-runner.ts`.

#### Scenario: Existing action behavior is captured before rewiring
- **WHEN** boundary extraction runs against locked runner fixtures
- **THEN** emitted event, verdict, and action sequences SHALL remain unchanged

### Requirement: Headless cross-phase progression consumes assess
After boundary extraction, `harness/scripts/goal-runner.ts` SHALL select cross-phase work only through `assess@1` and SHALL invoke the recommended phase only after driver authorization and fencing checks.

#### Scenario: Assess recommends testing backtrack to coding
- **WHEN** observation contains actionable deterministic defects and assess recommends coding
- **THEN** the runner SHALL execute the existing authorized invalidation/backtrack transaction before invoking coding

### Requirement: Process-level safety guards remain enforced by the driver
Timeout handling, budgets, backoff, child cleanup, trust ledgers, pass snapshots, device gates, source-write protection, monitor, usage capture, and detached survival SHALL remain enforced by existing goal-runner utilities and MUST NOT be weakened by assess rewiring.

#### Scenario: Phase process exceeds its timeout
- **WHEN** the active child exceeds the effective timeout
- **THEN** the runner SHALL apply the existing process timeout/cleanup policy and supply the resulting fact to reconciliation

### Requirement: Detached runner honors handoff mailbox at phase boundaries
The runner SHALL poll the run-bound handoff mailbox only at safe phase boundaries, validate the current epoch, quiesce cooperatively, and release projections without deleting `run-control@1`.

#### Scenario: Session requests return from unattended mode
- **WHEN** a valid session-target handoff request is present after a phase boundary
- **THEN** the detached runner SHALL quiesce and permit the session owner to acquire the next epoch before any further phase starts

### Requirement: Loop and process fuses remain distinct
The runner SHALL treat assess fuse as a phase-boundary reconciliation result, process guards as execution safety, and monitor budgets as read-only polling limits.

#### Scenario: Monitor polling budget ends
- **WHEN** a monitor reaches its polling fuse
- **THEN** it SHALL stop polling without terminating an otherwise active detached run

### Requirement: Headless goal runs pin an explicit adapter model

The runner SHALL accept a user-supplied `--adapter-model <id>` that is the authoritative model input for a headless run. It SHALL be replayed into every headless agent argv that actually performs work (the formal per-phase invocation and the vision canary probe), SHALL be recorded in the manifest as `adapter_model_pin: {adapter, value}` with `adapter` equal to the final effective adapter, and SHALL be echoed in dry-run plan output. The CLI value SHALL be trimmed then validated to be non-empty, at most 128 characters, and free of control characters; no model-name allowlist SHALL be introduced. The runner SHALL NOT read any adapter private configuration as a pin source, and SHALL NOT use Codex `-c model=<raw>`.

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/agent-invoke.ts`, `harness/scripts/utils/goal-manifest.ts`, `harness/scripts/utils/goal-manifest-cli.ts`

#### Scenario: Replay flags carry the pinned model

- **WHEN** a run is started with `--adapter-model <id>` and the effective adapter is codex/claude/codeagent/cursor/opencode
- **THEN** the formal phase invocation and the vision canary probe argv SHALL carry the model as `--model <id>` (codex/claude/codeagent/cursor) or `-m <id>` (opencode), and the resolveHeadlessInvokePlan call used only for binary validation SHALL NOT carry it

#### Scenario: Unsupported adapter fails fast on a pin

- **WHEN** `--adapter-model` is supplied, or the loaded manifest / successor inheritance carries an `adapter_model_pin`, and the effective adapter is chrys or generic
- **THEN** the run SHALL BLOCKER-fail during single-point pin adjudication, before any manifest identity computation or plan construction

#### Scenario: No pin leaves behavior unchanged

- **WHEN** no `--adapter-model` is supplied, the loaded manifest has no `adapter_model_pin`, and no successor inheritance carries a pin
- **THEN** every adapter's argv SHALL be element-for-element identical to the pre-pin baseline and no manifest key SHALL be added

#### Scenario: Pin binds the canary receipt and its admissibility

- **WHEN** an explicit `--adapter-model` pin is present
- **THEN** the vision canary receipt SHALL record `model = pin.value`, and a canary SHALL only be admitted or skipped when its model matches the pin value; the observed model SHALL remain append-only telemetry and SHALL NOT become a pin source or participate in any policy branch

### Requirement: Adapter model pin lifecycle is adjudicated at a single point

The final model pin SHALL be decided by exactly one pure function (`resolveFinalModelPin`) wired after adapter reconciliation and before manifest identity computation. Fresh, fresh-with-manifest, resume, force-resume, successor, and adapter-change authorization SHALL follow the documented matrix: a resume or manifest-bound drift requires `--override-manifest`; a resume that changes both adapter and model requires both `--override-adapter` and `--override-manifest`; `--force-resume` SHALL NOT bypass pin drift; a successor's explicit `--adapter-model` is a birth input that overrides the inherited value without `--override-manifest`, and a successor that changes adapter SHALL require `--override-adapter` with a new model. `adapter_model_pin` SHALL enter the manifest identity hash only when the key is present, so old manifests without the key remain compatible. Tampering with the pin value while stopped SHALL surface through the existing `manifest_identity_drift` path.

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/goal-manifest-cli.ts`, `harness/scripts/utils/goal-manifest.ts`

#### Scenario: Resume with a drifted pin requires override-manifest

- **WHEN** a resume supplies `--adapter-model` differing from the frozen manifest pin (or adding a new pin) without `--override-manifest`
- **THEN** the run SHALL BLOCKER-fail during `resolveFinalModelPin`

#### Scenario: Resume replacing adapter and model requires both overrides

- **WHEN** a resume supplies `--adapter-model` while also changing the effective adapter and lacks either `--override-adapter` or `--override-manifest`
- **THEN** the run SHALL BLOCKER-fail rather than partially authorize the change

#### Scenario: Successor may override the inherited pin at birth

- **WHEN** a successor run supplies an explicit `--adapter-model` over the inherited source pin
- **THEN** the explicit value SHALL win without `--override-manifest`, and a successor that changes adapter without `--override-adapter` plus a new model SHALL BLOCKER-fail

#### Scenario: Old manifest without the pin key stays compatible

- **WHEN** loading a manifest that has no `adapter_model_pin` key
- **THEN** identity computation SHALL not add the key, resume SHALL proceed with no pin, and no drift shall be reported for the absent key

#### Scenario: Tampered pin surfaces as manifest identity drift

- **WHEN** a stopped run's `adapter_model_pin.value` is altered without touching the birth event baseline
- **THEN** the resume SHALL report `manifest_identity_drift` for the `adapter_model_pin` field

### Requirement: Canary probe hard CLI failure is a pre-phase blocker

When the vision canary probe actually executes (`decideVisionCanaryProbe` returns `action === 'probe'`), a structured hard CLI failure SHALL be classified separately from ordinary invoke failures and SHALL escalate to a run-level BLOCKER before the first formal phase. The two newly covered classes are a child spawn race and a CLI/config argument incompatibility (unknown/unexpected/unrecognized argument or config load error). The probe SHALL return a `hard_cli_failure` outcome distinct from the existing invoke/invalid outcomes; only `hard_cli_failure` SHALL block. The existing resolved-binary preflight gate SHALL be preserved unchanged and SHALL NOT be double-counted as new protection. Skip paths (cache hit, dry-run, chain without a UI phase, local override) SHALL NOT gain this protection. Ordinary quota/API/auth errors and invalid vision answers SHALL remain non-blocking, and the existing binary gate behavior SHALL be unchanged.

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/goal-preflight.ts`, `harness/scripts/utils/agent-invoke.ts`

#### Scenario: Unknown argument during an actual probe blocks the run

- **WHEN** the canary probe executes and the child exits with a nonzero code after a CLI `unknown argument` error on stderr
- **THEN** the probe SHALL return `hard_cli_failure` and the run SHALL BLOCKER-fail before the first formal phase

#### Scenario: Cache-hit skip path has no hard-failure protection

- **WHEN** the canary probe is skipped due to a fresh admissible cache
- **THEN** no probe is spawned and no hard-failure classification occurs

> 前瞻规格注记：本 Requirement（金丝雀硬失败前置 BLOCKER）对应 plan d7f3a9c4 的 t4，属 t5 **先行成文**，相关代码**尚未实现**（`hard_cli_failure` 分类、BLOCKER 接线均不存在）。实现后本段才生效。「Pin binds the canary receipt and its admissibility」Scenario（t3）已实现。

