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

The system SHALL BLOCKER-fail preflight when `goal_capability` is missing, `unattended` contract is incomplete, `manifest.adapter` is not materialized, adapter entry artifacts are missing, headless CLI is not resolvable, or adapter provenance is `fallback` (no personal setup and no explicit/manifest adapter source).

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/goal-preflight.ts`, `agents/adapter-schema.yaml`

#### Scenario: Missing goal_capability at runner start

- **WHEN** goal-runner starts with an adapter lacking `goal_capability`
- **THEN** preflight exits non-zero before any agent invocation

#### Scenario: Explicit adapter bypasses fallback personal-setup guard

- **WHEN** user invokes goal-runner with `--adapter cursor`, cursor is in `materialized_adapters`, and entry artifacts exist, without `framework.local.json`
- **THEN** preflight passes and runner may start (headless CLI resolvability still enforced)

#### Scenario: Fallback provenance blocks without personal setup

- **WHEN** goal-runner starts without `--adapter`/`--manifest`/`--resume`, no `framework.local.json`, and provenance resolves to `fallback`
- **THEN** preflight exits non-zero with guidance to run `check-personal-setup --ensure`

#### Scenario: Manifest resume provenance not blocked by missing local

- **WHEN** user invokes goal-runner with `--resume <run-id> --feature <f>` and manifest.adapter is materialized
- **THEN** preflight does not fail solely because `framework.local.json` is absent

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

Timeout handling, budgets, backoff, child cleanup, trust ledgers, device gates, source-write protection, monitor, usage capture, and detached survival SHALL remain enforced by existing goal-runner utilities and MUST NOT be weakened by assess rewiring.

#### Scenario: Phase process exceeds its timeout

- **WHEN** the active child exceeds the effective timeout
- **THEN** the runner SHALL apply the existing process timeout/cleanup policy and supply the resulting fact to reconciliation

### Requirement: Detached runner honors handoff mailbox at phase boundaries

The runner SHALL poll the run-bound handoff mailbox only at safe phase boundaries, validate the current epoch, quiesce cooperatively, and release projections without deleting `run-control@1`. For non-orphan owners, session↔process conversion MUST use this mailbox handoff. Only an `orphaned_session` MAY bypass mailbox handoff after explicit user authorization by using the existing `--force-resume` / `forceTakeoverRunOwner` epoch takeover; automated supervision MUST NOT trigger this exception.

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/goal-run-control.ts`, `skills/project/goal-mode/SKILL.md`

#### Scenario: Session requests return from unattended mode

- **WHEN** a valid session-target handoff request is present after a phase boundary
- **THEN** the detached runner SHALL quiesce and permit the session owner to acquire the next epoch before any further phase starts

#### Scenario: User explicitly takes over an orphaned session as a process

- **WHEN** the session lease has expired into `orphaned_session` and the user authorizes `--force-resume --detach`
- **THEN** `forceTakeoverRunOwner` SHALL acquire `epoch+1` for the process without requiring a mailbox request, and the supervisor SHALL remain uninvolved

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

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/goal-preflight.ts`, `harness/scripts/utils/agent-invoke.ts`, `harness/scripts/utils/vision-canary.ts`

#### Scenario: Unknown argument during an actual probe blocks the run

- **WHEN** the canary probe executes and the child exits with a nonzero code after a CLI `unknown argument` error on stderr
- **THEN** the probe SHALL return `hard_cli_failure` and the run SHALL BLOCKER-fail before the first formal phase

#### Scenario: Cache-hit skip path has no hard-failure protection

- **WHEN** the canary probe is skipped due to a fresh admissible cache
- **THEN** no probe is spawned and no hard-failure classification occurs

> 注记：本 Requirement（金丝雀硬失败前置 BLOCKER）对应 plan d7f3a9c4 的 t4，已实现——`hard_cli_failure` 分类（child spawn race / CLI·config 参数不兼容）与只在该分类上的 run 级 BLOCKER 接线均已落地；skip 路径不获得该保护，既有 binary 门禁与普通 auth/quota/API/无效答卷语义保持不变。

### Requirement: Fidelity routing is a three-stage formula with auto-tiering and a single genuine-conflict halt

The runner SHALL derive fidelity routing as `inferred` requirement intent → `selected = resolveRequestedFidelity(inferred, manifest.fidelity)` → `effective = clampFidelityByCapability(selected, capability_snapshot)`. Explicit fidelity may hold or raise but MUST NOT lower frozen inferred intent, and no downgrade receipt or signer state SHALL be consulted. The capability snapshot SHALL contain only current execution capability and MUST NOT include artifact/history policy state. Acceptance strictness remains separate. A required selected fidelity that current native/delegated capability cannot satisfy SHALL project `DEFERRED_CAPABILITY_MISSING` before a content invocation. Prompts SHALL keep selected target and effective execution ceiling distinct.

Enforcement: `harness/scripts/utils/goal-preflight.ts`, `harness/scripts/utils/fidelity-shared.ts`, `harness/scripts/goal-runner.ts`

#### Scenario: a receipt cannot downgrade selected fidelity

- **WHEN** inferred intent is hard pixel, manifest requests semantic layout, and a legacy downgrade receipt exists
- **THEN** selected SHALL remain pixel and the run SHALL use capable execution or defer; the receipt SHALL be ignored

### Requirement: Fidelity input reaches routing through all three entry paths

`buildGoalManifestFromInput` SHALL preserve and validate the explicit `fidelity` upgrade input across fresh CLI, hand-written manifest, and resume paths. Legacy `fidelity_receipt` fields MAY parse for compatibility but MUST NOT enter identity decisions beyond byte/hash compatibility and MUST NOT authorize lowering. A successor SHALL derive its target from the new frozen requirement/input, not inherit a prior downgrade authorization.

Enforcement: `harness/scripts/utils/goal-manifest.ts`, `harness/scripts/goal-runner.ts`, `harness/scripts/utils/goal-preflight.ts`

#### Scenario: fresh and resume paths agree without a receipt

- **WHEN** a fresh run explicitly raises fidelity and is later resumed
- **THEN** both paths SHALL use the same frozen selected target without consulting a receipt

### Requirement: Build-generated source files are classified, not treated as violations

goal-runner 在 testing 阶段 invoke 前后快照 diff 的消费处（violation 裁决时刻，早于receipt/journal/gate）MUST 将变更逐项交由 profile 生成物分类器判定。三判据全中的条目MUST 降级为 `testing_generated_file_change` 事件（透明记录文件清单），MUST NOT halt、MUST NOT 进入 run 终止态（`--resume` 不受影响）：

1. 路径等于根 build-profile.json5 某 `modules[].srcPath + '/BuildProfile.ets'`（模块根，
   任意嵌套目录 MUST NOT 进入例外）；
2. 变化类型仅 added/modified（removed/type-changed MUST 维持 violation）；
3. 盘上现内容为合法 hvigor 模板结构（模板外零多余语句）且四常量值与 attempt 冻结配置
   推导结果逐值一致。

混合场景（真违规与生成物并存）MUST 维持 violation 与 halt，violation 事件的 `changed`
MUST 只列真违规，生成物 MUST 单列 `generated_changed` 字段。分类器不可用或判定异常时
MUST 全部按 violation 处理（fail-closed）。快照采集范围与算法 MUST NOT 因此改变。

#### Scenario: hvigor 合法重写模块根 BuildProfile.ets
- **WHEN** testing invoke 内 harness 构建重写三个模块根的 BuildProfile.ets，内容与冻结
  配置推导一致
- **THEN** 记 `testing_generated_file_change` 事件，不 halt，receipt/journal/gate 照常，
  同 run 后续 `--resume` 不被拒绝

#### Scenario: 篡改的 BuildProfile.ets 仍是违规
- **WHEN** 变更文件含模板外语句，或常量值与冻结配置推导不符，或文件被删除/变类型
- **THEN** 维持 `testing_write_violation` 终止态语义

### Requirement: Device-test build configuration is frozen per attempt

goal-runner MUST 在 testing attempt 开始时解析并冻结 {product, buildMode}，并经环境变量`HARNESS_DEVICE_TEST_PRODUCT`/`HARNESS_DEVICE_TEST_BUILD_MODE` 同发 agent 与 gate harness、直传生成物分类器（三方同源）。注入前 MUST 对目标键执行大小写无关清理后只写唯一大写键。agent 在其子进程内临时覆盖这两个变量属不受支持行为；生成物与冻结值不符MUST 判 violation（fail-closed）。

#### Scenario: agent 内临时覆盖不导致分类漂移
- **WHEN** agent 子进程内以不同 buildMode 触发构建，生成物常量与冻结配置不符
- **THEN** 分类器按冻结配置判定为 violation，不采用 agent 侧环境值

### Requirement: Device-test defects join the existing backtrack loop

`ActionableDefect.source` MUST 支持 `'device_test'`。goal-runner 的缺陷收集 MUST 只消费正式 gate 写出的 `device-test-evidence.json`，且 MUST 在 spawn gate harness 之前删除该文件（窗口内单写者防伪）。消费前 MUST 校验：goal_run_id/attempt_id 与当前精确相等；device_target 与当前 attempt 冻结设备元组精确相等（由 runner 内存直传，MUST NOT 从事件反推）；install_executed 与 install_ok 为真；trace_path 与权威 trace resolver 结果一致；`written_at`（collector 唯一时间裁决字段，文件 mtime 仅诊断）与 run meta 的run_started_at/run_ended_at 同落本 attempt 的 harness_start~harness_end 窗口。

仅 `device_target.target_kind === 'physical'` 且 `classification === 'product_actionable'`
的 case MUST 进入 ActionableDefect 走既有 `backtrack_to_coding` 与 roundFingerprint
无进展熔断；根/级联三分 MUST 复用 test_case_flow triage，级联 case MUST NOT 产生缺陷；
其余（emulator/unknown、environment/test_contract/unknown 分类、evidence 在场但任一
校验不满足）MUST 进入 unverified 通路；evidence 文件缺失 MUST 视为本轮无 device_test
信号（不产生缺陷也不产生 unverified——正式 gate 未达写入门槛时 run 门禁本身已 FAIL，
由既有重试路径接管；旧 trace/旧产物因此天然不驱动回修）。unverified entries MUST 携带
source（visual|device_test），retry/halt 指引 MUST 按 source 分支；事件类型名
`unverifiable_must_fix` MUST 保持不变。

#### Scenario: 真机 spec 锚点缺失自动回修
- **WHEN** 正式 gate evidence 中某根故障 case 分类为 product_actionable 且
  target_kind=physical，全部身份校验通过
- **THEN** 生成 source='device_test' 的 ActionableDefect，runner 回退 coding 并注入缺陷

#### Scenario: 身份或设备不匹配不驱动回修
- **WHEN** evidence 的 run/attempt/device_target/trace/时间窗任一与当前 attempt 不符，
  或 target_kind 非 physical
- **THEN** 相关 case 进入 unverified 通路（retry 引导重采，耗尽 halt），不回退 coding

### Requirement: Integrity blockers classify as framework_integrity_block and halt on first touch

Framework release-tree integrity blockers (manifest corruption/tamper, foreign framework files, unreadable framework state) SHALL remain `framework_integrity_block` and halt on first touch without automated reverts. An invocation-scoped write to an owner-resolvable feature artifact or protected product/test source SHALL NOT be folded into that permanent framework-integrity halt: it SHALL emit `phase_write_violation`, invalidate invocation/owner/downstream trust, preserve bytes as untrusted, and automatically use `backtrack_to_phase` for full owner revalidation. Persistent concurrent mutation, unreadable/corrupt feature bytes, repeated identical violations, absent targets, and exhausted budgets SHALL terminate through existing integrity/fuse semantics.

Enforcement: `harness/scripts/utils/goal-failure-classifier.ts`, `harness/scripts/goal-runner.ts`

#### Scenario: Host hotfix drift is not auto-reverted

- **WHEN** a plan-phase harness run reports 7 drifted framework files (host-applied fixes) with a fresh summary
- **THEN** the run SHALL halt with `framework_integrity_block` and per-subtype guidance instead of feeding a "revert first" retry prompt to the goal agent

#### Scenario: Coexisting subtypes are all surfaced

- **WHEN** a summary contains `framework_manifest_sidecar_missing`, `framework_drift`, and `framework_foreign_file` blockers simultaneously
- **THEN** `integrity_subtypes` SHALL contain all three values and the halt guidance SHALL list each remediation in repair order (manifest anchor first)

#### Scenario: downstream feature write recovers

- **WHEN** plan changes spec-owned acceptance bytes once and the bytes are stable/readable
- **THEN** the runner SHALL invalidate trust and backtrack spec instead of first-touch permanent HALT

### Requirement: Timeout attribution follows the freshness decision table

For a timed-out attempt the classifier SHALL apply, in order: stale summary → `agent_timeout`; fresh summary containing any integrity blocker → `framework_integrity_block`; fresh summary with a non-empty blocker set consisting entirely of `framework_bug` → `framework_bug`; otherwise (mixed or content-only) → `agent_timeout`. The all-framework_bug branch SHALL require `blockers.length > 0`.

Enforcement: `harness/scripts/utils/goal-failure-classifier.ts`

#### Scenario: Fresh integrity evidence is not masked by timeout

- **WHEN** an attempt is tree-killed at its timeout budget and the post-kill harness summary (stale_summary=false) contains a framework_drift blocker
- **THEN** classification SHALL be `framework_integrity_block` (halt) rather than `agent_timeout` (free retry)

### Requirement: Retry prompts carry continuation context decoupled from the content-retry budget

The runner SHALL derive continuation from the current phase's most recent attempt window independently of the retries counter. Whenever continuation is non-null, the prompt SHALL include prior-failure evidence matched to the cause. If the harness did not produce a readable summary, the runner SHALL include a bounded excerpt of the current attempt's harness error output and SHALL classify a parser/schema/artifact load failure as an artifact/gate failure rather than defaulting to `code_regression`. `harness_start`/`harness_end`/`phase_verdict` events SHALL carry `invoke_id`; legacy logs without it SHALL be windowed by event order.

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/goal-runner-phase.ts`

#### Scenario: YAML parse failure reaches the next attempt

- **WHEN** a spec harness exits before summary generation with `BLOCK_AS_IMPLICIT_KEY`
- **THEN** the next prompt includes that error and affected artifact context instead of generic source-code rollback guidance

#### Scenario: Resume into a fresh phase injects nothing

- **WHEN** the runner restarts with --resume and the current phase has no historical agent_invoke_start
- **THEN** continuation SHALL be null and the prompt SHALL contain no continuation blocks

### Requirement: Wall-clock budget is a hard deadline across all paths

The runner SHALL enforce `wallDeadlineMs = wallClockStartMs + wallClockBudgetMs` across agent invokes, harness runs, and transient backoff sleeps. Both agent and harness SHALL NOT be started when `deadline - now - FINALIZE_RESERVE_MS <= 0` (a computed timeout of 0 must never reach a timer, since 0 disables it); a backoff sleep SHALL NOT be started when the remaining budget cannot fit the configured backoff (terminate with `budget_wall_clock` instead of sleeping a truncated remainder). Windows process-tree kill SHALL be asynchronous and bounded (execFile taskkill.exe without shell, bounded wait, helper killed and stdio destroyed on timeout, `kill_process_tree_timeout` reported), and any kill on the agent/harness paths SHALL be paired with `armForceSettleAfterKill` so a failed kill still settles within the force-settle window. The kill grace used in the acceptance bound SHALL be derived from the actual termination contract constants (all four: child settle grace, force settle after kill, kill tree wait, inflight drain) via a single `resolveKillGraceMs()`. On the agent/harness/backoff paths, total runtime SHALL NOT exceed the wall limit plus `resolveKillGraceMs()`.

Post-run_end finalization (completion receipt etc.) is **pre-check-gated best-effort**, not part of the hard bound: it consists of synchronous filesystem work for which no in-process executable bound exists (a sync hang also blocks any in-process watchdog; hard-killing mid-write corrupts receipts; moving it to a killable worker process is the only true bound and is deliberately out of scope — recorded as plan d9b4f7e2 open item 5 / rev8 deviation ①). It SHALL be skipped entirely (`finalize_skipped`) when the deadline has already passed before it starts, and any overrun of an already-started finalization SHALL be recorded honestly via a `finalize_overrun` event carrying the finalization duration (feeding FINALIZE_RESERVE_MS calibration).

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/goal-timeout.ts`, `harness/scripts/utils/agent-invoke.ts`

#### Scenario: Zero effective budget prevents agent start

- **WHEN** raw wall remaining is positive but `deadline - now - FINALIZE_RESERVE_MS <= 0`
- **THEN** the runner SHALL NOT build a prompt, write agent_invoke_start, or invoke the adapter, and SHALL end the run with `budget_wall_clock`

#### Scenario: Hung taskkill cannot unbound the wall

- **WHEN** the taskkill helper never exits during a tree-kill
- **THEN** the bounded kill SHALL terminate the helper, release its handles, report `kill_process_tree_timeout`, and the runner SHALL still exit within the derived grace

### Requirement: Consecutive timeouts escalate once then halt

The runner SHALL count consecutive `agent_timeout` outcomes per phase from the events log (signature-independent, including PASS+unclosed). After the second consecutive timeout the next attempt's base timeout SHALL be escalated ×1.5 (default-table-derived values only; explicit overrides untouched). A third consecutive timeout SHALL halt with `agent_timeout_repeated` and guidance including per-attempt durations. The effective timeout of every attempt SHALL be computed before prompt construction and recorded as `effective_timeout_ms` on `agent_invoke_start`; progress/status/dead-man consumers SHALL prefer the event value over manifest re-resolution (manifest as legacy fallback).

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/goal-timeout.ts`, `harness/scripts/utils/goal-progress.ts`

#### Scenario: Escalated attempt is not reported stalled

- **WHEN** the runner escalates an attempt's timeout to 1.5× the default
- **THEN** progress liveness SHALL judge staleness against the event-recorded effective timeout, not the manifest-derived base value

### Requirement: Dead runs never project as RUNNING

The liveness projection SHALL detect a terminated-but-incomplete run from the event stream alone, independent of lock presence, so a run whose orchestrator died can never project as `RUNNING`. A `harness_start` with no following `harness_end`/`phase_verdict` past the phase timeout SHALL be a hard stall, and silence beyond `DEAD_MAN_FACTOR × phase_timeout` (a live runner heartbeats ~every 60s) SHALL be a hard stall.

Enforcement: `harness/scripts/utils/goal-progress.ts`

#### Scenario: Dangling harness_start with cleaned locks does not project RUNNING

- **WHEN** `events.jsonl` ends with `agent_invoke_end` then a `harness_start` with no later `harness_end`/`phase_verdict`, no lock is present, and the last event is hours old
- **THEN** projection SHALL report a non-`RUNNING` status (`STALLED`) and liveness `STALLED`, not `RUNNING`/`soft_quiet_window`

#### Scenario: Absolute dead-man catches lock-independent silence

- **WHEN** the run has no terminal `run_end` and the last activity is older than `DEAD_MAN_FACTOR × phase_timeout`
- **THEN** projection SHALL report a hard stall regardless of whether any lock file exists

#### Scenario: Live harness window is not a false stall

- **WHEN** a `harness_start` is within the phase timeout and heartbeat events are fresh
- **THEN** projection SHALL keep the run `RUNNING` and MUST NOT report a stall

### Requirement: Abnormal exit writes a terminal event

On any abnormal termination (catchable signal, uncaught exception, or process exit), the runner SHALL write `run_end{status:"INTERRUPTED"}` to `events.jsonl` synchronously and idempotently before releasing locks, so an interrupted run is never silent. A normal terminal `run_end` SHALL suppress the interrupted event. The projection SHALL treat `INTERRUPTED` as a terminal status and SHALL NOT apply freshness degradation to it.

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/goal-progress.ts`

#### Scenario: Signal writes INTERRUPTED before async cleanup

- **WHEN** the runner receives a catchable signal (`SIGINT`/`SIGBREAK`) or crashes mid-run
- **THEN** `run_end{status:"INTERRUPTED"}` SHALL be appended (via `appendFileSync`) before any asynchronous tree-kill, and only once even if multiple exit hooks fire

#### Scenario: INTERRUPTED projects as terminal

- **WHEN** `events.jsonl` contains a `run_end{status:"INTERRUPTED"}`
- **THEN** projection SHALL report status `INTERRUPTED` and liveness `DONE`, and freshness degradation SHALL be a no-op

#### Scenario: Windows SIGBREAK is registered

- **WHEN** running on Windows where `SIGTERM` is not catchable
- **THEN** the runner SHALL register `SIGBREAK` (Ctrl-Break / console close) so a graceful host signal still writes the terminal event

### Requirement: Closure-only attempts are classified by a receipt-probe total function and budgeted by closure kind

The closure path taken after a blocked PASS SHALL be chosen by a deterministic function over the full `ReceiptValidation` status set obtained from the read-only receipt probe (never mapped from `advance_block_reason`, which stays telemetry-only): `passed` → `deterministic_recheck` (runner performs receipt state sync/closure without invoking an agent); `missing`/`failed` → `receipt_repair_with_verifier` (agent attempt using the phase's full current effective timeout — no invented shorter verifier budget); `error` → immediate HALT classified `closure_probe_error`/framework-bug semantics without invoking an agent; `not_applicable` while still advance-blocked → immediate HALT `closure_state_invariant`. Fresh attempts SHALL reuse the receipt validation already obtained in the control flow; resume re-probes with the subprocess timeout bounded by remaining wall clock and the finalize reserve. Closure-only timeout SHALL surface as closure timeout for human disposition, never re-entering content retries.

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/goal-timeout.ts`

#### Scenario: probe error is a framework fault, not an agent repair job

- **WHEN** the receipt probe itself fails to execute (script missing, spawn failure)
- **THEN** the run SHALL halt with `closure_probe_error` and no agent SHALL be invoked to "repair" the receipt

### Requirement: Timeout budget ratchets on granted high-water and observed completions

The per-attempt agent timeout SHALL be `max(base, granted_highwater, ceil(1.2 × max_completed_duration))`, where `granted_highwater` is the highest effective timeout ever granted to the phase and a completed duration is an invocation with `exit_code === 0 && timed_out !== true`; both SHALL be rebuilt from events on resume. Explicit host-configured phase timeouts remain a hard cap the ratchet cannot exceed, but when observed completions approach or exceed the explicit value the report SHALL state that the configured budget appears too small. `timeout_escalated` events SHALL record their source (`consecutive_timeouts` | `granted_highwater` | `observed_ratchet`). All budgets remain clamped by wall clock and the finalize reserve.

Enforcement: `harness/scripts/utils/goal-timeout.ts`, `harness/scripts/goal-runner.ts`

#### Scenario: the incident's i4 no longer falls back to the base budget

- **WHEN** attempts time out twice, escalation grants 67.5 minutes, and the third attempt completes at 49.6 minutes with exit 0 but fails content gates
- **THEN** the next attempt's budget SHALL be 67.5 minutes (granted high-water), not the 45-minute base

### Requirement: Blocker actionability joins the decision ladder at a single position and splits timeouts in four steps

Aggregated blocker actionability SHALL enter the decision ladder after safety terminals and transient API handling, before content retry/no-progress and closure routing. Toolchain or genuine external blockers SHALL use their existing operator/external defer path. Agent-fixable blockers SHALL retry or produce trusted responsible-phase repair candidates. Quality blockers MUST NOT be classified `human_only`, parked for a signature, or routed to `await_human_gate_deferral`; required evidence gaps SHALL remain FAIL/UNVERIFIED or capability-missing according to whether capability was available. Timed-out attempts SHALL preserve the same distinction. Agent-written assumptions remain report-only and never authorize a transition.

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/goal-failure-classifier.ts`

#### Scenario: timeout plus toolchain-only blockers goes to the operator, not another blind retry

- **WHEN** an attempt times out and the fresh summary's only BLOCKER is the OCR-toolchain-unavailable gate
- **THEN** the run SHALL halt `await_operator_toolchain` instead of classifying `agent_timeout` and burning another content retry

#### Scenario: unsigned quality item no longer exists

- **WHEN** machine evidence for a required quality obligation is missing
- **THEN** the outcome SHALL be repair/evidence FAIL or capability defer, never `await_human_gate_deferral`

### Requirement: Attempt reporting uses four orthogonal axes

Halt reporting for no-progress-family reasons SHALL be synthesized from per-attempt records on four orthogonal axes — agent termination (timeout/exit0/error) × harness verdict (PASS/FAIL/unavailable) × transition (advanced/advance_blocked/halted/retried) × artifact delta (changed/unchanged/restored) — rendered as a per-attempt timeline; summaries SHALL NOT present overlapping axes as mutually exclusive counts.

Enforcement: `harness/scripts/utils/goal-report-generator.ts`, `harness/scripts/goal-runner.ts`

#### Scenario: the incident's i2 is reported on both axes instead of miscounted

- **WHEN** an attempt both timed out and produced a harness PASS blocked from advancing
- **THEN** the timeline SHALL show `timeout × PASS × advance_blocked` for that attempt and totals SHALL reconcile with the number of attempts

### Requirement: Observed adapter model is append-only telemetry

After each invocation the runner MAY parse the structured events file's init record through the shared envelope parser and append an `adapter_model_observed` event (`phase`, `invoke_id`, `adapter`, `model`, `source`); it SHALL NOT rewrite the frozen manifest or the pre-run `adapter_probe` event, SHALL NOT mint capability receipts for telemetry, and the observed model SHALL NOT feed vision-capability truth or any policy branch. Reports project the latest observation.

Enforcement: `harness/scripts/goal-runner.ts`

#### Scenario: the incident's MiniMax identity becomes visible without touching trust surfaces

- **WHEN** the events file's init record reports `"model":"MiniMax-M2.7"`
- **THEN** an `adapter_model_observed` event SHALL carry it while the manifest bytes and capability routing stay unchanged

### Requirement: Preflight before agent_invoke_start

goal-runner MUST 在每 phase 每 attempt 的 agent_invoke_start 事件之前执行共享工具链 preflight（初跑与 --resume 均重检）；探测到显式前置能力缺口（deveco_toolchain_missing / deveco_toolchain_capability_failed 类 prerequisite code）时 MUST NOT 产生 agent_invoke_start，MUST 直接写 run_end=HALTED 与 halt_reason=await_human_capability_gap 并以非零退出。该 halt MUST NOT 计入 CUMULATIVE_HALT_FAMILY（agent 未开跑，无累计语义）。

#### Scenario: 缺口不烧 agent 轮次
- **WHEN** phase 前置能力缺口存在且 goal-runner 启动该 phase attempt
- **THEN** events.jsonl 无本 attempt 的 agent_invoke_start；run_end=HALTED，halt_reason=await_human_capability_gap

#### Scenario: resume 重检
- **WHEN** 用户修好环境后 --resume
- **THEN** preflight 重检通过，attempt 正常产生 agent_invoke_start；仍缺口则再次首触 halt

#### Scenario: 运行后失败不入本通道
- **WHEN** ut/testing 运行后产生 ohos_test_sign_gap 等 failure_kind
- **THEN** 走既有 toolchain 失败分类语义，不触发 await_human_capability_gap

> **Enforced by:** `harness/scripts/goal-runner.ts`, `harness/scripts/utils/goal-runner-phase.ts`

### Requirement: Goal monitor provides bounded notification reads

The system SHALL provide `harness/scripts/goal-monitor.ts` as a read-only bounded monitor over goal run evidence. The monitor MUST read existing run evidence and live progress projection without starting, resuming, killing, or mutating a goal run.

Enforcement: `harness/scripts/goal-monitor.ts`, `harness/scripts/utils/goal-progress.ts`

#### Scenario: Phase verdict produces notification

- **WHEN** `events.jsonl` contains a `phase_verdict` event after the supplied `--since-event` cursor
- **THEN** `goal-monitor --markdown` SHALL emit one agent-facing notification containing the phase, verdict/action, current run status, next phase when available, and evidence paths

#### Scenario: Bounded timeout is no-op

- **WHEN** no notification-worthy event appears before `--max-seconds`
- **THEN** `goal-monitor` SHALL exit successfully with a no-op result and MUST NOT alter any goal run files

#### Scenario: Monitor timeout is harmless

- **WHEN** a host shell or tool kills `goal-monitor` before it returns
- **THEN** the goal run SHALL remain unaffected because the monitor is read-only

### Requirement: Goal monitor uses stable event cursors

The system SHALL define `event_index` as the zero-based line index in `events.jsonl`. `goal-monitor --since-event <n>` SHALL only edge-notify on events with index greater than `<n>`, while still using the complete event stream to compute current status.

Enforcement: `harness/scripts/goal-monitor.ts`, `harness/scripts/utils/goal-progress.ts`

#### Scenario: Since-event filters old verdicts

- **WHEN** a run contains prior `phase_verdict` events at or before `--since-event`
- **THEN** `goal-monitor` MUST NOT emit those old verdicts as new edge notifications

#### Scenario: Cross-turn recovery summarizes current state

- **WHEN** an agent resumes monitoring without reliable in-memory `last_seen`
- **THEN** the monitor SHALL allow the agent to rebuild current state and recent verdicts from `events.jsonl` and live projection without requiring a persisted notified marker

### Requirement: Heartbeat notifications are throttled by event time

The system SHALL treat ACTIVE heartbeat summaries as notification-worthy only when the run has had no phase-changing event for at least `SOFT_STALL_MS = 10min` according to event/live snapshot timestamps, not according to the duration of the current monitor invocation.

Enforcement: `harness/scripts/goal-monitor.ts`, `harness/scripts/utils/goal-progress.ts`

#### Scenario: Short monitor does not trigger heartbeat by itself

- **WHEN** `goal-monitor --max-seconds 240` waits for a running phase with no phase verdict
- **THEN** the 240 second local wait alone MUST NOT produce a heartbeat notification unless the event-time threshold is already crossed

#### Scenario: Same-phase heartbeat deduplicates

- **WHEN** multiple monitor calls observe the same phase after a low-frequency heartbeat summary was already emitted for the same status window
- **THEN** subsequent calls MUST NOT emit duplicate heartbeat summaries unless the threshold boundary or material status summary changes

### Requirement: Hard liveness anomalies edge-notify once

The system SHALL surface hard liveness anomalies (`STALLED`, `ORPHAN_SUSPECTED`) as `goal-monitor` notifications, but MUST edge-trigger them: a given anomaly SHALL be emitted only when new evidence (a higher `event_index`) has appeared past `--since-event`. An orphaned or hard-stalled run whose event stream is frozen MUST NOT re-emit an identical liveness notification on every monitor call; subsequent calls SHALL fall through to the bounded no-op.

Enforcement: `harness/scripts/goal-monitor.ts`

#### Scenario: Stalled run notifies once then deduplicates

- **WHEN** a run is `STALLED`/`ORPHAN_SUSPECTED` with no newer events and the agent passes the previously returned `event_index` back as `--since-event`
- **THEN** the first call SHALL emit a `liveness` notification and a subsequent call with no newer events SHALL return a bounded no-op instead of repeating it

### Requirement: Completed phase durations stop at completion

The system SHALL project completed phase durations using an `ended_at` timestamp rather than current time. Normal `ended_at` SHALL come from the phase `phase_verdict.ts`; legacy or recovery gaps MAY fall back to the next phase `phase_start.ts` or `run_end.ts`.

Enforcement: `harness/scripts/utils/goal-progress.ts`

#### Scenario: Passed phase duration remains stable

- **WHEN** a phase has a `phase_start` and subsequent `phase_verdict`
- **THEN** `goal-status` and `goal-monitor` projections SHALL report that phase duration as `phase_verdict.ts - phase_start.ts`, regardless of the current time

#### Scenario: Running phase duration still grows

- **WHEN** the current phase has started but has not ended
- **THEN** progress projection SHALL continue reporting duration as current time minus the phase start time

### Requirement: Cursor headless invoke uses cursor-agent or agent with positional prompt

The system SHALL invoke Cursor goal phases via `cursor-agent` (fallback `agent`) with `-p`, passing the phase prompt as a positional argv element; it SHALL NOT use `cursor agent --print`. On Windows `.cmd` shims it SHALL use `cross-spawn` for spawn.

Enforcement: `harness/scripts/utils/agent-invoke.ts`, `agents/cursor/adapter.yaml`, `harness/package.json`

#### Scenario: Cursor plan uses positional prompt in argv

- **WHEN** goal-runner resolves headless plan for adapter `cursor`
- **THEN** invoke plan passes prompt as the final argv element (not via shell string concatenation)

#### Scenario: Headless CLI PATH check for structured adapters

- **WHEN** goal-runner preflight runs for adapter `claude`, `codex`, or `cursor`
- **THEN** preflight BLOCKER-fails if the headless binary is not resolvable on PATH

### Requirement: No non-final status carries bare COMPLETED semantics

The run-level status enum SHALL distinguish `CHAIN_SLICE_COMPLETED` (this run's phase slice succeeded), `FEATURE_INCOMPLETE`, and `FEATURE_COMPLETED`; legacy `AWAITING_HUMAN_REVIEW` values MAY be read for diagnostics but MUST NOT be newly produced from quality state. `FEATURE_COMPLETED` SHALL appear only when `verify-feature-completion` returns VALID. A truncated-chain run's report SHALL state the covered slice explicitly and point to the feature-level verdict.

Enforcement: `harness/scripts/utils/goal-report-generator.ts`, `harness/scripts/goal-{runner,status}.ts`, goal-report schema

#### Scenario: truncated chain success does not read as feature completion

- **WHEN** a run with chain [ut, testing] finishes green while spec/plan/coding/review closures predate it
- **THEN** its status SHALL be CHAIN_SLICE_COMPLETED with an explicit slice annotation, and feature status SHALL come only from verify-feature-completion

### Requirement: Truncated-chain runs machine-verify upstream closures before starting

A run whose start_phase is not the first phase of the resolved workflow chain SHALL verify, for every upstream phase, the existence and freshness of its closure (receipt closure state, gate fingerprint, phase_closure_fingerprint staleness recomputation, and — for review — the closure attestation). Textual assertions in `manifest.requirement` SHALL NOT substitute for verification. Verification failure SHALL refuse the run and name the missing/stale phase. HALTED/PARTIAL prior runs SHALL be resumed or explicitly superseded via `--supersede <run_id>` (audited event); they SHALL NOT be silently displaced.

Enforcement: `harness/scripts/goal-runner.ts`（preflight）, `harness/scripts/utils/phase-evidence-manifest.ts`

#### Scenario: requirement text asserting upstream PASS is ignored

- **WHEN** a new run declares start_phase=ut and its manifest text claims "上游已 PASS" but spec closure inputs have since changed
- **THEN** preflight SHALL recompute staleness, judge the spec closure STALE, and refuse to start

### Requirement: Feature completion is generated only from clean lineage and verified only through one entry point

`feature-completion.json` SHALL be generated only when every phase in the resolved chain is closed and fresh, each phase-advance matrix permits progression, every applicable `required_for_release` quality axis is PASS through `projectReleaseReadiness`, no trusted open BLOCKER/MAJOR or unexecuted P0 remains, and all recovery/backtrack transactions are committed. For P0 device flows, current runtime step evidence bound to feature, acceptance flows, derived plan, HAP/source, trace, run, attempt, device, and provider identity is mandatory. Flow truth SHALL come from spec-owned hash-bound acceptance evidence. Human receipt files, P0/fidelity/behavior/review waivers, `confirmed_by`, accepted debt, assumptions-ledger `must_review`, manual resume, and legacy runtime attestation MUST NOT satisfy any condition.

The completion original remains runner-owned and atomic with a feature projection. `verify-feature-completion` remains the sole consumer and SHALL recompute artifact/requirement/source/review/runtime/evidence-manifest hashes, run-event lineage, current workflow track/chain, quality projections, and absence of newer incomplete/terminal runs. Missing or malformed run/attempt identity fails closed. Legacy completion lineage that relied on a human quality key SHALL be recomputed from current machine evidence and MUST NOT remain valid by receipt presence.

Enforcement: `harness/scripts/utils/verify-feature-completion.ts`, `harness/scripts/goal-runner.ts`, `harness/scripts/utils/quality-axes.ts`, `harness/scripts/utils/device-test-evidence-shared.ts`

#### Scenario: P0 completion uses runtime observations

- **WHEN** every phase is fresh and all required axes pass but a P0 device flow lacks current step observations
- **THEN** completion SHALL not be generated, regardless of a legacy runtime-fidelity receipt

#### Scenario: all machine obligations close completion

- **WHEN** the resolved chain, required axes, open-defect checks, and P0 runtime/visual evidence all verify under current identities
- **THEN** completion SHALL be generated without any user signature

### Requirement: Fidelity intent is detected from the dereferenced requirement SSOT with a capability pre-gate

Before phase prompting, the runner SHALL detect intent from the inline manifest requirement plus bounded, frozen source documents that existed at initialization. Generated feature outputs SHALL not enter requirement identity. Strong required visual intent without capable current execution SHALL yield `DEFERRED_CAPABILITY_MISSING`. Manifest fidelity remains upgrade-only; no downgrade receipt is valid. Ambiguous wording SHALL follow deterministic policy/frozen input and MUST NOT create an `await_human_fidelity_tier` gate.

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/fidelity-shared.ts`, `harness/scripts/utils/goal-preflight.ts`

#### Scenario: generated README cannot stale intent

- **WHEN** the requirement tells spec to create `doc/features/<feature>/ux-reference/README.md` and that file is created during spec
- **THEN** the frozen requirement identity SHALL remain stable and no human fidelity decision SHALL be requested

### Requirement: Headless auto-decisions are recorded in a schema-validated JSONL ledger

The unattended prompt MAY record deterministic/default decisions in `<phase>/headless-assumptions.jsonl` for audit, with markdown as a human projection. Ledger `must_review` and user-like source strings SHALL be legacy/report-only and MUST NOT cap run status, advance a phase, authorize a gate change, or block completion. A decision requiring genuine external authority SHALL be represented by the existing external prerequisite state, while a quality uncertainty SHALL remain repair, UNVERIFIED/FAIL, optional advisory, or capability defer.

Enforcement: `harness/scripts/goal-runner.ts`（prompt 契约）, `harness/scripts/utils/goal-report-generator.ts`, `harness/scripts/check-receipt.ts`（schema/registry 校验，见 harness-gates）

#### Scenario: historical must-review does not pause a run

- **WHEN** a legacy assumptions ledger has unresolved `must_review=true` rows
- **THEN** they SHALL appear in diagnostics only and current machine gates SHALL determine the run outcome

### Requirement: Trusted device evidence refines testing failure attribution

goal-runner SHALL 在 testing collector 完成既有 run/session/target 绑定校验与 `test_case_flow` 根因裁决后，使用非空可信根失败分类精修本 attempt 的 failure kind。仅当基础分类为 `code_regression` 且全部可信根失败均为 `test_contract` 时，最终分类 MUST 为 `test_contract`；缺失、绑定失败、空集或混合分类 MUST NOT 触发精修。该值 SHALL 用于 blocker signature、`phase_verdict.failure_kind_classified`、goal report 与后续 prompt。

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/goal-runner-phase.ts`, `harness/scripts/utils/goal-failure-classifier.ts`

#### Scenario: 全部可信根失败属于测试契约

- **WHEN** testing 基础分类为 `code_regression`，且 collector 验证后的非空根失败全部分类为 `test_contract`
- **THEN** phase verdict 与 goal report 的 `failure_kind_classified` 为 `test_contract`
- **AND** runner 不注入修改或回滚产品源码的话术

#### Scenario: 证据不可信或分类混合时保持保守归因

- **WHEN** device evidence 绑定失败、根失败集合为空，或可信根失败同时包含 `test_contract` 与其他分类
- **THEN** runner 保持基础 failure kind，不以该 evidence 精修为 `test_contract`

### Requirement: Test-contract attribution survives retry and resume

goal-runner SHALL 把精修后的 `test_contract` 持久化到事件，并在同进程 retry 和 `--resume` 时从最新适用的 `phase_verdict.failure_kind_classified` 恢复。恢复后的 testing prompt MUST 指向 selector、ui-spec、测试锚点或 runner 契约，MUST NOT 指示修改产品源码。该分类 MUST NOT 新增 signature halt、累计 halt 或 backtrack-to-coding 策略。

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/goal-runner-phase.ts`, `harness/scripts/utils/goal-failure-classifier.ts`

#### Scenario: 同进程 retry 保持测试契约归因

- **WHEN** testing attempt 以 `test_contract` 失败并进入同进程下一 attempt
- **THEN** continuation 恢复 `test_contract` 且 prompt 不含产品源码回滚/修改指令

#### Scenario: Resume 保持测试契约归因

- **WHEN** runner 以 `--resume` 恢复一个最新 testing verdict 为 `test_contract` 的 run
- **THEN** 首个恢复 attempt 继续使用 `test_contract` prompt
- **AND** 不因该分类产生 `backtrack_to_coding` 或 `phase_backtrack_started`

### Requirement: Locked HarmonyOS devices use one bounded keypad reveal

设备就绪门的自动解锁 SHALL 固定执行 `wake → snapshot → reveal at most once → fresh snapshot → validate → input → verify`。只有当第一快照确认同一设备处于锁屏、无明确冷却且没有完整可信 PIN 键盘时才执行一次非秘密上滑；reveal 后 MUST 重新读取同源快照，MUST NOT 复用旧快照或以 sleep/多轮盲手势替代状态迁移。

Enforcement: `harness/scripts/utils/device-unlock-helper.ts`, `harness/scripts/utils/device-readiness-deps.ts`, `profiles/hmos-app/harness/device-recovery-bridge.ts`

#### Scenario: 时钟态经一次 reveal 展示 PIN 键盘

- **WHEN** wake 后快照确认锁屏、冷却状态为 `not_cooldown`，但 PIN 键盘不完整
- **THEN** helper 执行一次 reveal 并重新取快照
- **AND** 只有新快照通过全部 PIN 校验后才输入登记凭据

#### Scenario: Reveal 后仍不可信则零输入

- **WHEN** reveal 后快照仍缺键、重复数字、几何异常、锁屏身份不明，或冷却状态为 `cooldown`/`ambiguous`
- **THEN** helper 不输入任何凭据并返回稳定的阻塞 rule id

### Requirement: PIN and cooldown parsing are scoped and privacy-safe

HarmonyOS 锁屏 parser MUST 只在 `Digital_PSD_Input_Tip` 容器内识别 PIN 数字键，单键值 SHALL 优先读取 `originalText` 并在其为空时读取 `text`，且完整键盘 MUST 同时满足 0–9 唯一、bounds 有效和三列四行几何约束。时钟数字与 `numKeyBoard` 字母提示层 MUST NOT 成为 PIN 键。

冷却判定 MUST 只读取认证/Bouncer 子树并返回 `cooldown | not_cooldown | ambiguous`；通知子树和人脸识别失败提示 MUST NOT 造成冷却。任何 unlock outcome 及其在 `device_unlock_attempt`、`device_ready.notes`、`phase_halt.notes` 的投影 MUST NOT 包含 UI 原文、通知内容或凭据。

Enforcement: `harness/scripts/utils/device-readiness-deps.ts`, `harness/scripts/utils/device-unlock-helper.ts`, `harness/scripts/utils/device-readiness-gate.ts`

#### Scenario: 真机键盘 fixture 只产生十个可信键

- **WHEN** parser 读取脱敏真机 stable-keypad fixture
- **THEN** 识别结果恰含唯一 0–9 及其真实坐标
- **AND** `numKeyBoard` 的 ABC/DEF 等提示节点被忽略

#### Scenario: 时钟与人脸提示不触发输入或冷却

- **WHEN** parser 读取仅含锁屏时钟数字或人脸识别失败“重试”提示的 fixture
- **THEN** keypad 为空且 cooldown 为 `not_cooldown`

#### Scenario: 通知可疑词不泄露到任一事件出口

- **WHEN** 通知子树含 retry、disabled 或其他冷却相似词
- **THEN** 该文本不影响冷却判定
- **AND** `device_unlock_attempt`、`device_ready.notes` 与 `phase_halt.notes` 均不包含通知原文

### Requirement: Successful reveal is observable at the readiness gate

设备就绪门 SHALL 在同一次真实锁屏恢复中记录成功的 `device_unlock_attempt`，随后仅在复验设备已解锁时记录 `device_ready` 并允许 agent invocation。

reveal 手势的 velocity 与其命令超时 MUST 出自**同一处操作策略**，MUST NOT 是分散的独立字面量；velocity MUST 落在 HarmonyOS `uitest uiInput swipe` 的合法域内，超时 MUST 不低于既定下限。二者是否**相容**（手势能在超时内真正完成）MUST 由真机验收证明，MUST NOT 依赖 distance/velocity 的理论时长断言——事故组合（300 px/s + 5s）的理论值 3.07s 小于其超时却在真机上稳定耗时 5.2s，理论断言会放行它。

reveal 命令的执行结果 MUST 进入解锁事实链：设备命令执行事实 MUST 携带 `status`、`signal`、`timedOut` 与枚举化 `errorCode`，MUST NOT 只保留成败布尔。该事实 MUST NOT 携带 `error.message`（含本机绝对路径）、UI 原文、通知内容或凭据。

同一次 unlock attempt MUST 最多执行一次 reveal；reveal 失败 MUST NOT 在同一 attempt 内触发自动重滑。

Enforcement: `harness/scripts/utils/device-readiness-gate.ts`, `harness/scripts/utils/device-readiness-deps.ts`

#### Scenario: 真机自动 reveal 并解锁成功

- **WHEN** 已登记凭据的受支持真机从时钟锁屏态进入设备就绪门，自动 reveal 后识别到可信 PIN 键盘并解锁
- **THEN** 本次 gate 事件包含 `device_unlock_attempt` 且 outcome 为 `succeeded`
- **AND** 后续 `device_ready` 为 PASS，目标 serial 保持不变

#### Scenario: reveal 命令超时被终止

- **WHEN** reveal 手势命令未在其超时内完成并被信号终止
- **THEN** 执行事实记录 `timedOut` 与 `errorCode`，且该事实随解锁结论上浮
- **AND** 本次 attempt 不再发出第二次 reveal

### Requirement: Layout classification requires evidence that reveal succeeded

`layout_unsupported` MUST 只在 reveal **成功**之后、由其后的 UI 快照产生。reveal 未成功时，解锁链 MUST 立即以零输入退出并归因为 `reveal_failed`，MUST NOT 取用 reveal 之后的任何快照做布局结论，MUST NOT 进入重采样窗口。

`reveal_failed` 的判据 MUST 收窄为「reveal 命令自身执行失败或超时」，MUST NOT 吸纳凭据不可用、UI 未稳定或布局不支持等既有形态。其处置指向排查 hdc/设备连通性，MUST NOT 指向真机布局校准——该类归因及其在 `device_unlock_attempt`、`phase_halt` 的投影 MUST NOT 出现「真机校准」类指引。

`reveal_failed` 路径 MUST 为零输入：MUST NOT 发生任何 PIN 点击，MUST NOT 烧毁凭据版本。

Enforcement: `harness/scripts/utils/device-unlock-helper.ts`, `harness/scripts/utils/device-readiness-deps.ts`

#### Scenario: reveal 失败后快照恰为时钟页形态

- **WHEN** reveal 命令被超时终止，其后的 UI 快照呈现 `pin_container_not_found`（容器缺席、识别到 0 个数字键）
- **THEN** 解锁结论为 `reveal_failed` 而非 `layout_unsupported`
- **AND** note 不含「真机校准」指引，且未发生任何 PIN 点击

#### Scenario: reveal 成功后容器持续缺席

- **WHEN** reveal 成功执行，但跑满有界重采样窗口后 PIN 容器仍未出现
- **THEN** 解锁结论仍为 `layout_unsupported`，既有有界观察行为不变

#### Scenario: 归因原样贯通到消费面

- **WHEN** 解锁链以 `reveal_failed` 结束
- **THEN** `device_unlock_attempt.failure_kind` 与 `phase_halt.unlock_failure_kind` 均为 `reveal_failed`
- **AND** 运行期恢复与 profile 侧恢复桥原样透传该归因，不将其压平为处置枚举

### Requirement: Repair candidates carry signal-level identity and converge by cumulative one-shot accounting

Visual actionable defects SHALL be projected into repair candidates at **signal granularity** — one candidate per defect/finding — with identity `sha256(computeDefectFingerprint(screen, defect))`, reusing the existing stable per-defect fingerprint (`screen|class|element|bbox_bucket[|producer#finding_id]`) and the existing `defect.must_fix_refs` association to resolve text-only `must_fix` entries; no per-screen aggregate identity (it drifts whenever the defect set or the build changes, making recurrence undetectable) and no new parallel identity or association structure. "Identity" is a concept name only: the sole stored field remains `item_fingerprint`. Each signal-level candidate SHALL carry `identity_schema: 'signal@1'`; candidates without the marker are legacy check-domain candidates — usable for diagnostics and existing routing, but **excluded from the convergence accounting and the no-op rule below**, which apply to `signal@1` candidates only.

Convergence SHALL follow the **cumulative one-shot rule**, derived entirely from existing authoritative events with no new ledger file. Candidate identities are read from `phase_backtrack_requested.candidates[]`, but a requested batch joins `attempted` **only once the target phase has actually executed in that backtrack window** — evidenced by a subsequent `agent_process_settled` or `phase_verdict` event for the target phase; a request with no such evidence (crash before the target phase ran) SHALL NOT count as attempted, preserving the existing crash/resume contract that request-only candidates are restored and executed. `eligible` = current open identities minus `attempted`. When `eligible` is non-empty the runner SHALL backtrack for the eligible identities only; when `eligible` is empty it SHALL retain `repair_not_converging` as a bounded terminal/fuse and list the machine evidence. Same-run manual resume MUST NOT clear attempted identities, reset the fingerprint, change the quality conclusion, or create eligibility. Only new machine evidence producing a new identity, or a successor run with new identity/budget, can continue. Because `attempted` is cumulative, an identity whose executed repair failed SHALL NOT regain eligibility when a different identity triggers a later backtrack.

Backtrack events SHALL keep the existing vocabulary — `phase_backtrack_requested`, `phase_backtrack_started`, `phase_backtrack_completed` — with no new event types or transaction state machine: whether the target phase actually executed is read from the existing `agent_process_settled`/`phase_verdict` events; `phase_backtrack_completed` SHALL be emitted only after the backtrack actually completes (never before the target phase runs) and SHALL be emitted on all backtrack paths.

After the backtrack target phase's agent settles, the runner SHALL compare the invocation pre/post product-source snapshots (the existing filesystem-hash snapshot that explicitly tolerates pre-existing dirty worktrees; git-diff emptiness is forbidden as a criterion). Equal snapshots mean the repair was a no-op: the runner SHALL NOT re-run downstream phases, SHALL fold the driving identities into `attempted` (the target phase did execute), and SHALL halt via the empty-eligible rule, recording `phase_backtrack_completed` with `result: 'noop'` — a zero-change repair proves the fix ineffective, not the candidates resolved, so existing downstream closures SHALL NOT be reused to continue the chain. An unverifiable snapshot is fail-closed: fall back to the current full cascade, never guess.

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/repair-candidates.ts`, `harness/scripts/utils/assess.ts`, `harness/scripts/utils/adjudication.ts`, `profiles/hmos-app/harness/visual-diff-check.ts`

#### Scenario: a crash after request but before the target phase keeps candidates eligible

- **WHEN** a backtrack for identity A is requested and the run crashes before the target phase produced any `agent_process_settled`/`phase_verdict` event in that window
- **THEN** on resume A is not in `attempted`, remains eligible, and the restored backtrack carries A's candidate into the target phase per the existing crash/resume contract

#### Scenario: a crash after the target phase settled still counts as attempted

- **WHEN** the backtrack target phase settled (its `agent_process_settled`/`phase_verdict` is on the event log) and the run crashes before `phase_backtrack_completed`
- **THEN** on resume the driving identities are in `attempted` and SHALL NOT drive another automatic repair; if they are still open and nothing else is eligible the run halts `repair_not_converging`

#### Scenario: an attempted identity cannot regain eligibility through alternation

- **WHEN** identity A drove an executed backtrack whose repair failed to eliminate it, a later round's new identity C drives another backtrack, and the round after that has A open again
- **THEN** A remains in `attempted` and only identities outside `attempted` are eligible; with none, the run halts `repair_not_converging` naming A's cross-round evidence

#### Scenario: zero-change repair stops the loop without new event types

- **WHEN** a backtrack re-runs coding and the pre/post product-source snapshots are identical
- **THEN** downstream phases are not re-run, the driving identities join `attempted`, and the run emits `phase_backtrack_completed` with `result: 'noop'` before halting `repair_not_converging`

### Requirement: Visual signals are adjudicated before candidate materialization

Visual signals SHALL be classified and validated before candidate materialization. A deterministic producer signal whose applicability/evidence contract passes SHALL materialize directly as a trusted machine repair candidate even when the primary agent disputes or omits it. A current delegated-provider payload that passes identity/hash/schema validation SHALL materialize through its existing provider path. Producer uncertainty or invalid/unreliable provider evidence SHALL not create a candidate: required quality stays FAIL/UNVERIFIED or capability-deferred and optional quality may remain advisory. The runner MUST NOT write `repair_adjudication_pending`, await `visual-confirm`, consume `confirmed_by`, or use human judgment as a third authority. Visual-round integrity and convergence events SHALL still be recorded before disposition.

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/repair-candidates.ts`, `profiles/hmos-app/harness/visual-diff-check.ts`, `harness/scripts/utils/assess.ts`, `harness/scripts/utils/adjudication.ts`, `harness/scripts/utils/visual-provider-invoke.ts`

#### Scenario: deterministic signal survives agent dispute

- **WHEN** a current deterministic layout invariant produces an applicable FAIL and the agent disputes it without independent machine counterevidence
- **THEN** the signal SHALL materialize a repair candidate and no human adjudication halt SHALL occur

#### Scenario: uncertain required evidence remains unclosed

- **WHEN** a producer cannot reliably compare a required signal
- **THEN** the required axis SHALL remain unclosed or capability-deferred without finalizing PASS or entering WAITING(human)

### Requirement: WAITING-projected halts revalidate before re-invoking the agent

Legacy event streams whose latest halt projects `WAITING` MAY use the existing validation-only resume optimization only to re-run machine gates against unchanged settled invocation evidence. That optimization MUST NOT clear a repair fuse, accept a receipt/signature, or turn an unchanged quality result into PASS. New quality failures SHALL not emit WAITING projections; genuine external prerequisite states retain their existing resume eligibility. Any newer invalidation/backtrack window takes priority.

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/adjudication.ts`

#### Scenario: legacy waiting visual halt revalidates but does not pass by resume

- **WHEN** a legacy visual WAITING halt is resumed with no new machine evidence
- **THEN** the gate MAY run without another agent invocation but SHALL reproduce the current FAIL/UNVERIFIED/defer result rather than release it

### Requirement: Supervisor respects run-control owner responsibility

The feature supervisor SHALL load and validate the selected run's `run-control@1` before entering the existing beacon × `run_disposition` decision core. Missing or corrupt control MUST fail closed. A handoff mailbox is conclusively complete only when the exported canonical handoff validator accepts its full shape, its run identity matches the selected run, and its status is `accepted` or `rejected`; valid pending/consumed, malformed, unknown, or mismatched mailboxes MUST be no-ops. Every session-owner state (`active`, `quiescing`, `released`, `orphaned_session`) MUST return without spawning and without appending run events. Only a process owner SHALL enter the existing decision core, and run terminality MUST remain derived solely from `run_disposition`, never from owner state or open-invocation counts.

Enforcement: `harness/scripts/goal-supervise.ts`, `harness/scripts/utils/goal-supervisor.ts`, `harness/scripts/utils/goal-run-control.ts`

#### Scenario: Released attended run remains attachable

- **WHEN** a run has `owner.kind=session`, `owner.state=released`, and its latest disposition is not terminal
- **THEN** a supervisor one-shot SHALL neither spawn a process nor append an event, and the attended bridge MAY reattach through normal owner CAS

#### Scenario: Orphaned session requires an operator

- **WHEN** a run has `owner.kind=session` and `owner.state=orphaned_session`
- **THEN** the supervisor MUST NOT add `--force-resume`, spawn, or write an event; only a user-authorized takeover MAY proceed

#### Scenario: Released process wakes through the existing core

- **WHEN** a process-owned released run projects external `WAITING` and its same-source condition probe becomes ready
- **THEN** the supervisor SHALL reach the existing decision core and resume according to that core without deriving terminality from `released`

#### Scenario: Malformed complete-looking mailbox fails closed

- **WHEN** a process-owned run contains a mailbox such as `{"status":"accepted"}` or a canonical-looking record bound to another run
- **THEN** the supervisor SHALL neither enter the recovery core nor spawn or append an event

### Requirement: Detached launcher resolves framework runtime independently of consumer cwd

The detached goal launcher SHALL resolve its TypeScript preload module to an absolute framework-owned path before starting the child with the consumer project as its working directory. Consumer project roots MUST NOT be required to install framework runtime dependencies.

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/goal-supervise.ts`

#### Scenario: Supervisor resume starts from project root

- **WHEN** the supervisor spawns a detached resume with `cwd` equal to the consumer project root
- **THEN** the detached child SHALL load the framework TypeScript runtime and remain alive without resolving `ts-node/register/transpile-only` from the consumer root

### Requirement: Adapter terminal contracts close FAIL turns; absent contracts fall back to timeout honestly

When an adapter declares a machine-readable terminal event contract, the invoke layer SHALL consume
it and recognize **exactly two terminal states**. A `completed` terminal event SHALL set
`completion_observed` and enter the existing grace/kill settlement (mutually exclusive with the hard
timeout: hitting completion SHALL cancel the hard timeout). A `failed` terminal event SHALL set a
distinct `terminal_failure_observed` fact, SHALL NOT set `completion_observed`, SHALL NOT cancel the
hard wall-clock backstop, and SHALL normalize a zero exit code to non-zero so that
`agentFailed = exitCode !== 0 && completionObserved !== true` still reports failure.
Terminal failure SHALL take precedence over a completion probe in either arrival order: after a
failure, the probe cannot establish completion; if failure arrives after the probe canceled the hard
timeout, the invoke layer SHALL revoke completion and restore the backstop at its original deadline.
The final invoke result SHALL never report both closure facts as true.

Any other event — including a top-level `error` event — is **diagnostic only**: it SHALL be recorded
as an excerpt on `agent_invoke_end` and SHALL NOT set `completion_observed`, SHALL NOT trigger
settlement or kill, and SHALL NOT feed the API-disconnect sentinel, the failure classifier, or retry
adjudication. Adapters without a terminal contract SHALL rely on natural exit plus the hard timeout;
no substitute signal SHALL be synthesized from receipts, silence, or output volume.

Enforcement: `harness/scripts/utils/codex-terminal-events.ts`, `harness/scripts/utils/agent-invoke.ts`,
`harness/scripts/goal-runner.ts`

#### Scenario: failure terminal event followed by a zero exit code

- **WHEN** the adapter emits its `failed` terminal event and the process then exits with code 0
- **THEN** the invoke result SHALL report `terminal_failure_observed`, SHALL NOT report
  `completion_observed`, SHALL NOT report `timed_out`, and SHALL surface a non-zero exit code

#### Scenario: a mid-turn error event is followed by a successful completion

- **WHEN** a top-level `error` event is emitted and the same turn later emits its `completed`
  terminal event
- **THEN** the run SHALL NOT kill the process on the `error`, SHALL close the invocation on the
  `completed` event with `completion_observed`, and SHALL record the error only as an
  `agent_invoke_end` diagnostic excerpt

#### Scenario: completion probe fires before the failure terminal event

- **WHEN** the completion probe first establishes completion and the same invocation later emits
  its `failed` terminal event
- **THEN** terminal failure SHALL revoke probe completion, restore the hard timeout at its original
  deadline, and the phase verdict SHALL report `agent_failed=true`

#### Scenario: failure terminal event arrives before a completion probe match

- **WHEN** the invocation emits its `failed` terminal event and the completion probe later matches
  during settlement grace
- **THEN** the probe SHALL NOT establish completion, and the phase verdict SHALL report
  `agent_failed=true`

#### Scenario: an adapter with no terminal contract produces the same stream

- **WHEN** an adapter that declares no terminal contract emits output resembling another adapter's
  terminal events
- **THEN** the run SHALL NOT derive any closure fact from it and SHALL fall back to natural exit plus
  hard timeout

### Requirement: Terminal event evidence does not upgrade tool-call provenance

Consuming an adapter's terminal event stream SHALL NOT change that adapter's
`tool_event_provenance`. A structured terminal/usage stream on stdout is evidence that a turn ended
and how many tokens it consumed — it is **not** evidence that a tool call happened or that an image
input was injected. The adapter SHALL remain absent from the critic image-read parser registry and
SHALL NOT be issued a verified critic receipt on the strength of terminal events, and no new adapter
capability field SHALL be introduced for terminal parsing (per-adapter argv plus parser suffices).

Enforcement: `agents/codex/adapter.yaml`, `harness/scripts/utils/agent-invoke.ts`,
`harness/scripts/utils/critic-receipt-producer.ts`, `docs/operations/adapter-tool-event-provenance.md`

#### Scenario: terminal flag added without provenance upgrade

- **WHEN** the adapter's argv gains its terminal-event flag
- **THEN** `tool_event_provenance` SHALL remain `none`, the critic parser registry SHALL NOT gain the
  adapter, and no verified receipt SHALL be produced for it

### Requirement: The completion probe is a PASS-shaped closure accelerator, not a FAIL closer

The phase completion probe SHALL keep its four evidence conditions (receipt structure, summary
identity, receipt status passed, closure closed) **unchanged**. Because a genuine FAIL receipt is by
design a skeleton, the probe is structurally unable to fire on FAIL turns; this is correct behavior
and SHALL NOT be relaxed — relaxing it would both close out half-finished work and kill agents that
are still self-correcting within the attempt. Closure for FAIL turns is the responsibility of the
adapter terminal contract. The probe SHALL continue to answer two separate questions that SHALL NOT
be merged: whether the evidence is complete, and whether that complete evidence belongs to the
current invocation.

Enforcement: `harness/scripts/utils/phase-completion-probe.ts`

#### Scenario: a FAIL turn finishes with a skeleton receipt

- **WHEN** an attempt ends with a genuine FAIL and the phase receipt is still the runner-written
  skeleton
- **THEN** the probe SHALL NOT fire, and closure SHALL come from the adapter terminal contract or
  the hard timeout — not from a loosened evidence condition

### Requirement: Liveness separates the work plane from the control plane

Liveness SHALL NOT let runner-authored heartbeats mask an agent that has stopped producing output.
When (a) an unclosed agent invocation exists, (b) the agent output log has not changed within the
soft-stall window, and (c) **this run's own** `adapter_probe` event declares `output_delivery` as
streaming, the run SHALL project the existing `SUSPECTED_STALL` liveness state. The declaration
SHALL be read from the run's recorded events, never re-interpreted from the current adapter
manifest, and a missing or unrecognized value SHALL be treated as unknown. Buffered and unknown
delivery SHALL NOT be downgraded, because their logs may legitimately stay silent. The progress
projection SHALL report the work-plane stall duration, in both the default status text and Markdown,
only while all three conditions hold; otherwise `agent_output_stalled_ms` SHALL be null and no stall
line SHALL be rendered. The duration is computed as now minus the agent output log mtime — it SHALL
NOT reuse the control-plane activity age, which includes heartbeats. This
projection is observation only: it SHALL NOT kill, recover, or retry, and SHALL NOT introduce a new
liveness state or a second reducer.

Enforcement: `harness/scripts/utils/goal-progress.ts`

#### Scenario: streaming adapter goes silent while heartbeats continue

- **WHEN** the agent output log has been unchanged past the soft-stall window, heartbeats are still
  being written, and the run's `adapter_probe` declared streaming delivery
- **THEN** liveness SHALL be `SUSPECTED_STALL` and the progress projection SHALL state how many
  minutes the agent output has been stalled

#### Scenario: buffered or undeclared delivery

- **WHEN** the same silence occurs but the run's `adapter_probe` declared buffered delivery, or
  declared nothing at all
- **THEN** liveness SHALL NOT be downgraded on that basis, `agent_output_stalled_ms` SHALL be null,
  and the status renderers SHALL NOT describe the agent output as stalled

#### Scenario: the invocation has already closed

- **WHEN** an old agent output log exceeds the soft-stall window but no unclosed invocation exists
- **THEN** `agent_output_stalled_ms` SHALL be null and the status renderers SHALL NOT describe the
  agent output as stalled

### Requirement: Timeout guidance states the transport and quality axes side by side

Retry guidance SHALL NOT assert that a timed-out attempt was "not a content failure" when the
harness for that **same invocation** already recorded a `FAIL` or `INCOMPLETE` verdict. The two axes
are orthogonal and both SHALL be stated: the transport fact (wall-clock timeout, partial artifacts on
disk, do not redo exploration) and the quality fact (the recorded verdict and its failure kind, whose
blocker evidence is real content feedback). The quality fact SHALL be scoped to the latest invocation
window only, so that an earlier attempt's stale failure is never presented as current. When the same
invocation produced no such verdict, the existing pure-timeout wording SHALL be preserved unchanged.
This requirement changes prompt wording only — no classifier, verdict, or retry-budget semantics.

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/goal-runner-phase.ts`

#### Scenario: timed-out attempt whose harness recorded a content FAIL

- **WHEN** one invocation window contains `agent_invoke_end.timed_out=true` and a subsequent
  `phase_verdict` with `FAIL`/`INCOMPLETE` plus a harness failure kind
- **THEN** the retry prompt SHALL present both axes and SHALL NOT claim the attempt was not a content
  failure

#### Scenario: pure timeout with no verdict for that invocation

- **WHEN** the previous attempt timed out and no `FAIL`/`INCOMPLETE` verdict exists for that
  invocation window
- **THEN** the existing pure-timeout wording SHALL be used verbatim

### Requirement: The visual provider identity is a paired CLI input, frozen in the manifest, adjudicated at one point

The goal runner SHALL accept `--visual-adapter` and `--visual-model` as a **pair**: supplying one
without the other SHALL fail fast. Both values SHALL be normalized and validated the same way the
existing explicit model pin CLI value is (trim, non-empty, bounded length, no control characters, no
model-name whitelist). CLI input SHALL take precedence over the personal local configuration.

An accepted provider identity SHALL be frozen into the manifest as
`visual_provider_pin: {adapter, model}`. That key SHALL enter the manifest identity hash
**conditionally on key presence**, exactly like the existing conditional identity fields, so older
manifests without the key are unaffected on resume. Manifest loading SHALL validate the shape. A
resume SHALL read the frozen value and SHALL NOT re-read the local configuration; a successor SHALL
inherit it with the other inherited fields.

The frozen identity SHALL reach the gate process on **every** execution path that has a manifest —
the detached runner and the attended session entry alike — through one shared injection helper. The
gate falls back to the personal configuration only when no frozen identity was injected; an attended
path that skips the injection would let a mid-run edit of the personal configuration swap the run's
visual endpoint, which is exactly what freezing exists to prevent.

A single pure function SHALL adjudicate the final provider pin, using a rule subset aligned with the
existing model-pin adjudicator: a fresh run accepts the CLI value; a resume with a differing value
requires `--override-manifest`; a successor's birth input may override the inherited value without
that flag.

The primary and the provider MAY be the same adapter with different models, and MAY be different
adapters. A provider identical to the primary endpoint SHALL NOT be an error — it is merely redundant
advisory information, since `native` mode does not call a provider at all.

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/goal-manifest.ts`,
`harness/scripts/utils/goal-manifest-cli.ts`

#### Scenario: a lone flag fails fast

- **WHEN** the runner is started with `--visual-adapter` but no `--visual-model`
- **THEN** the run SHALL fail fast before any phase invocation with a message naming the missing flag

#### Scenario: an attended run keeps the frozen endpoint after a local edit

- **WHEN** an attended run's manifest froze a provider and the personal configuration is edited to a
  different provider before a gate round
- **THEN** the gate SHALL use the frozen manifest identity, not the edited personal configuration

#### Scenario: resume does not re-read personal configuration

- **WHEN** a run with a frozen `visual_provider_pin` is resumed after the local configuration changed
- **THEN** the run SHALL use the frozen pin, and changing it SHALL require the explicit override flag

### Requirement: Legacy blind visual authorization is ignored

New CLI and manifest writers MUST NOT produce `--allow-blind-visual` or `allow_blind_visual`. A legacy
manifest MAY retain the field for byte/hash compatibility, but the launch and quality gates SHALL
ignore it. UI work that requires visual evidence SHALL use current native/delegated capability or
project `DEFERRED_CAPABILITY_MISSING`; optional non-strict visual evidence follows the existing
advisory policy. A user flag or manual resume cannot authorize an evidence gap.

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/goal-mode-entry.ts`,
`harness/scripts/utils/goal-manifest.ts`, `harness/scripts/utils/goal-manifest-cli.ts`,
`harness/scripts/utils/goal-preflight.ts`

#### Scenario: legacy authorization grants no quality effect

- **WHEN** a UI-related legacy manifest carries `allow_blind_visual: true` but required visual capability is unavailable
- **THEN** the run SHALL defer as capability-missing and SHALL NOT advance because of the legacy key

### Requirement: An unsupported visual provider selection responds by input shape and never substitutes silently

The response to a provider adapter that is absent from the catalog-derived support list SHALL depend
only on how the selection arrived and on whether visual evidence is required by the existing quality
policy:

- **Ordinary interactive use** — on the first UI-related phase, when the local configuration is
  missing a provider **or** its adapter is unsupported, the framework MAY ask once for
  `adapter` + `model`, presenting the catalog-derived support list and allowing a reselection. A skip
  is ordinary input, not authorization to waive evidence: required visual evidence SHALL project
  capability-missing, while truly optional visual evidence follows the existing advisory policy.
  The framework SHALL NOT persist or re-ask the skipped selection in that round.
- **Attended goal creation** — the same condition and the same selection/reselection flow apply
  before the manifest is created. A valid selection is written to the local configuration and then
  frozen into the manifest. Skipping SHALL NOT write `--allow-blind-visual`, `allow_blind_visual`, or
  any equivalent quality authorization; required/optional evidence follows the same policy above.
- **Unattended** — the framework SHALL NOT ask. A stale local configuration naming an unsupported
  adapter SHALL produce a warning and SHALL be ignored. A non-UI run MAY continue. For UI-related
  work, unavailable required visual capability SHALL project capability-missing and optional visual
  evidence follows advisory policy. Legacy frozen blind authorization is ignored. A missing
  configuration follows the same matrix.
- **Explicit CLI** — `--visual-adapter` naming an unsupported adapter SHALL fail fast, and the error
  SHALL list the catalog-derived support list. Silently ignoring an explicit user input is forbidden.

In no case SHALL the framework substitute a different provider automatically, fall back between
providers, or recommend one implicitly by selecting it.

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/check-personal-setup.ts`,
`harness/scripts/init-orchestrate.ts`, `harness/scripts/utils/adapter-catalog.ts`

#### Scenario: an existing unsupported selection is re-offered once without creating a waiver

- **WHEN** an interactive session finds a local configuration naming an unsupported provider adapter
- **THEN** the user SHALL be prompted once with the support list and the option to skip, and a skip
  SHALL NOT create a visual-quality waiver; required evidence projects capability-missing and truly
  optional evidence remains advisory without a second prompt in that round

#### Scenario: unattended stale selection obeys the shared launch matrix

- **WHEN** an unattended run reads a local configuration naming an unsupported provider adapter
- **THEN** the run SHALL warn and ignore the configuration; non-UI work continues, optional visual
  evidence follows advisory policy, and required visual capability projects capability-missing

#### Scenario: no automatic substitution

- **WHEN** any of the above paths rejects a provider selection
- **THEN** the framework SHALL NOT select another adapter on the user's behalf and SHALL NOT retry the
  round against a different provider

### Requirement: Trusted repair candidates are a single shared fact in the phase summary

The harness SHALL project trusted actionable defects into `summary.repair_candidates[]` as the single machine-derived fact consumed by goal, batch, and manual drivers. Review candidates require structurally valid current reports and item-level verifier evidence; a conditional-review receipt or accepted-risk statement MUST NOT suppress them. Check-derived ownership SHALL prefer registered machine check/failure-kind mapping over affected-path fallback; underivable/mixed ownership produces no trusted candidate. Testing device/visual evidence SHALL be merged into the same field only after its existing identity/freshness verification. Failure to persist candidates remains fail-closed. Agent prose MUST NOT self-declare ownership or create a candidate.

Enforcement: `harness/scripts/utils/repair-candidates.ts`, `harness/harness-runner.ts`, `harness/prompts/verify-review.md`, `harness/scripts/utils/quality-axes.ts`

#### Scenario: three verified review MAJORs become coding-owned candidates

- **WHEN** a review report concludes 有条件通过 with open MAJORs CR-001/002/003 over product source files, and the verifier's issue-verification block confirms each one
- **THEN** the review summary carries three coding-owned repair candidates with distinct item fingerprints, and the round fingerprint differs from any prior round's set

#### Scenario: a hallucinated finding cannot drive a code change

- **WHEN** an open MAJOR is absent from the verifier's issue-verification block, marked refuted/unclear, or the report itself fails validity
- **THEN** no candidate is produced for it and the phase falls back to the existing in-phase retry/halt behavior

#### Scenario: signed conditional review still produces candidates

- **WHEN** current item-level evidence verifies open MAJOR findings and a legacy conditional authorization exists
- **THEN** the findings SHALL remain repair candidates and route to their responsible phase

### Requirement: Assess routes repair candidates to the responsible phase via strict workflow mapping

Assess SHALL map repair-candidate ownership through the current resolved workflow/track, returning no phantom phase and no chain-head fallback. Multiple owners target the most-upstream real phase while retaining the grouped facts. Goal and unattended batch execution SHALL automatically authorize any in-chain earlier target through the single `backtrack_to_phase` branch, existing invalidation transaction, budget, and fingerprint fuse. Manual UI MAY display the routing but MUST NOT require confirmation to preserve quality. A target absent from the actual chain remains `backtrack_target_absent`. Old phase-specific execution branches and dead recommendation actions MUST NOT coexist.

Enforcement: `harness/scripts/utils/assess.ts`, `harness/scripts/utils/correction-routing.ts`, `harness/scripts/utils/goal-assess-driver.ts`, `harness/scripts/goal-runner.ts`, `harness/scripts/utils/goal-in-session-driver.ts`, `harness/scripts/utils/assess-renderer.ts`

#### Scenario: review candidates backtrack to coding instead of retrying review

- **WHEN** review fails with three coding-owned candidates and the goal chain includes coding
- **THEN** assess recommends `rerun_phase:coding` with `backtrack_to_phase`, the driver authorizes it, and the runner backtracks with the candidate list injected into the next coding prompt — no `rerun_phase:review` retry burn

#### Scenario: a lite-track spec candidate maps to change, not a phantom phase

- **WHEN** a spec-owned candidate arises on a lite-track chain `change/coding/exit`
- **THEN** assess targets `change`; on a custom chain lacking any mapped node the recommendation carries a null phase and the runner halts `backtrack_target_absent`

#### Scenario: plan-owned defect from testing backtracks automatically

- **WHEN** testing emits a trusted plan-owned candidate and plan is earlier in the actual chain
- **THEN** assess/driver/runner SHALL execute one `backtrack_to_phase:plan` transaction without human authorization

#### Scenario: a stale verifier artifact cannot qualify a reused issue id

- **WHEN** the previous round's `verifier.report.md` confirms `CR-001`, but the current report's `CR-001` describes a different defect — whether an unrelated one, or one sharing a generic phrase with the old evidence (both mention 「状态机错误」)
- **THEN** the evidence binding fails in both cases, no candidate is produced, and the phase stays in review for re-verification

#### Scenario: a crash between backtrack and re-execution keeps the handoff

- **WHEN** the runner emits `phase_backtrack_requested` with candidates and then crashes before the target phase runs
- **THEN** resume replays the event and the target phase's prompt still carries its own candidates; a later non-repair backtrack clears them instead of leaking them forward

### Requirement: Receipt identity fields are runner-owned

The phase-completion receipt scaffold SHALL be generated with `feature`, `phase` and — under goal orchestration — `claimed_attempt_id` pre-filled from the runner/harness attempt identity (`i<totalTurns>`); agents MUST NOT be required to copy machine-known identity values from the environment or derive them from progress files. Under goal orchestration the runner SHALL be the **single scaffold writer**: before **every** real agent invocation (content and closure attempts alike; lite track and dry-run excluded) it SHALL force-regenerate the unfilled scaffold carrying the upcoming attempt identity, invalidating the previous attempt's receipt so a stale complete receipt cannot satisfy completion observation for the new attempt — and so the agent sees the scaffold from the content attempt onward, allowing closure to complete within the same attempt (testing no longer necessarily burns a second on-device gate pass). A scaffold write failure SHALL halt before starting the agent (`receipt_scaffold_unwritable`, external/probe semantics) with the real path and I/O error — it MUST NOT be swallowed, because a surviving stale-identity receipt deterministically reproduces the `receipt_attempt_identity` closure wall. The harness-side PASS-gated skeleton generation SHALL stand down under goal orchestration (goal attempt env present → no write) and remains only for non-goal manual flows. Closure-only state SHALL be derived from the latest authoritative phase verdict (`PASS` + `advance_blocked` + `action=retry`): phases such as coding/ut with no frozen deliverable surface still get the current invocation identity and closure-only prompt. A later halt/invalidation or non-closure verdict clears that state. The strict goal-mode equality between `claimed_attempt_id` and the runner attempt identity SHALL remain unchanged (no `"3"`/`"i3"` aliasing); non-goal manual flows keep the empty-field and timestamp-freshness behavior.

Enforcement: `harness/scripts/utils/receipt-scaffold.ts`, `harness/harness-runner.ts`, `harness/scripts/goal-runner.ts`, `harness/scripts/check-receipt.ts`, `harness/scripts/utils/adjudication.ts`

#### Scenario: a closure attempt no longer dies on a copied identity

- **WHEN** closure-only attempt `i3` starts after attempt `i2` failed receipt validation
- **THEN** the scaffold on disk already carries `claimed_attempt_id: "i3"` and the agent only fills self-attestation fields; the run reaches normal closure without `closure_wall_repeated`

#### Scenario: a stale complete receipt does not complete a new attempt

- **WHEN** a further closure attempt `i4` begins while a filled receipt claiming `i3` exists
- **THEN** the runner regenerates the unfilled scaffold with `claimed_attempt_id: "i4"` and completion observation does not treat the `i3` receipt as current

#### Scenario: a phase without a frozen surface still gets a closure identity

- **WHEN** coding attempt `i4` reaches PASS but closure remains open
- **THEN** attempt `i5` is still classified closure-only from the `i4` verdict, its prompt says to perform closure only, and the runner force-regenerates the scaffold with `claimed_attempt_id: "i5"`

#### Scenario: an unwritable scaffold stops the attempt instead of reviving the identity wall

- **WHEN** the runner cannot write the receipt scaffold before an invocation (read-only directory, missing template, or file lock)
- **THEN** the run halts `receipt_scaffold_unwritable` reporting the real path and error, the agent is never started, and no attempt budget is burned

### Requirement: Spec closure-only prompts mandate read-only visual re-evidencing

For spec closure-only attempts the runner prompt SHALL state that FROZEN applies to artifacts, not to read-only evidencing, and SHALL list every authoritative reference image (derived from the spec visual handoff) with an instruction to read each one during the current invocation — because the `vl_multimodal` final sign-off is invocation-bound and MUST NOT be relaxed or satisfied by reusing a previous invocation's refs receipt. Modifying artifacts remains forbidden.

Enforcement: `harness/scripts/goal-runner.ts`（`buildClosureVisualEvidenceBlock`）, `harness/scripts/check-spec.ts`（gate 判定不变）

#### Scenario: a closure-only attempt can pass the invocation-bound visual sign-off

- **WHEN** a spec closure-only attempt starts with 10 authoritative reference images and the agent follows the prompt's read-only evidencing list
- **THEN** the refs receipt for this invocation is complete and `ui_spec_fidelity_gate` no longer fails structurally on the closure attempt

### Requirement: Run end-state classification uses the executed slice; the assumptions ledger never gates it

Run end-state classification SHALL evaluate the actually executed chain slice, while feature completion evaluates the full chain. Assumptions-ledger rows and human-signature artifacts SHALL never gate either result. Current quality issues SHALL project only as repair/incomplete, capability-missing/deferred, optional advisory, genuine external prerequisite, or precise terminal/fuse outcomes through existing projectors.

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/verify-feature-completion.ts`

#### Scenario: spec-only clean run has no signature cap

- **WHEN** a spec-only run closes its executed slice and only legacy human-signature items remain
- **THEN** the run SHALL classify from current machine gates and SHALL not become `AWAITING_HUMAN_REVIEW`

#### Scenario: historical must_review entries do not cap the end state

- **WHEN** the cross-run ledger accumulates dozens of `must_review` entries from prior runs
- **THEN** they appear in the goal report only; clean-pass classification emits no `no_pending_must_review` issue and completion generation is not blocked

### Requirement: Downstream-start runs must not rewrite spec-owned frozen decision files

A downstream-start run SHALL read and reuse upstream frozen decision files byte-for-byte. If requirement/fidelity identity differs, files are corrupt/missing where required, or upstream closure is stale, the runner SHALL produce the total earlier-gap disposition: return to the actual owner through `backtrack_to_phase` when the resolved chain/run can execute it, otherwise surface `backtrack_target_absent` with a successor/full-chain route. A hard capability conflict still defers using in-memory capability facts. The runner MUST NOT rewrite upstream files, emit a dead `rerun_phase:*` recommendation, or classify a known owner gap as `framework_bug`.

Enforcement: `harness/scripts/utils/goal-preflight.ts`, `harness/scripts/goal-runner.ts`, `harness/scripts/utils/assess.ts`

#### Scenario: plan start observes stale spec

- **WHEN** a run starts at plan and the spec closure is stale while the effective workflow permits a spec backtrack
- **THEN** the runner SHALL invalidate downstream state and execute spec backtracking rather than halt with only `rerun_phase:spec` guidance

### Requirement: Segmented-start eligibility is closure-only; pass snapshots never gate downstream phases

For any `--start X`, start eligibility SHALL be judged solely by the freshness of all in-repo phase closures upstream of X (the truncated-chain preflight's evidence-staleness recomputation) — no cross-run snapshot search, no snapshot derivation for other runs, no per-phase snapshot or authorization layer for review/ut/testing. The coding plan-authority check SHALL judge the plan closure directly via the same evidence-staleness recomputation (manifest integrity + receipt pointer + frozen-surface file hashes + environment): fresh → authorized; stale → the existing live-drift replan path (changed paths named); missing/tampered → closure-untrusted replan. The coding UI-scope whitelist SHALL be read from the on-disk `contracts.yaml` only after its current hash matches the hash frozen in the plan phase-evidence-manifest (receipt-pointer-anchored); a mismatch is live drift handled by the existing stale/replan disposition — the snapshot-anchor env channel is retired. Deleting the goal-checkpoints temporary cache SHALL NOT affect legitimate segmented starts. When a run ends HALTED on a structurally-sensitive incident, the `run_end` event SHALL carry the disposition already computed at the `phase_halt` production site (replayed from events), never a second `decide()` nor a write-layer fabrication. The downstream-start fidelity-reuse note SHALL be printed to the run log.

Enforcement: `harness/scripts/utils/scope-replan.ts`（`checkPlanAuthority`）, `harness/scripts/utils/ui-scope-gate.ts`, `harness/scripts/goal-runner.ts`, `harness/scripts/utils/phase-evidence-manifest.ts`

#### Scenario: a fresh coding-start run passes the plan authority gate without executing plan

- **WHEN** run A closed plan cleanly and run B starts fresh with `--start coding --end testing`, with the goal-checkpoints cache absent
- **THEN** `checkPlanAuthority` judges the plan closure fresh and returns ok, coding starts normally

#### Scenario: genuine contracts drift is still caught

- **WHEN** `contracts.yaml` on disk no longer matches the hash frozen in the plan evidence manifest
- **THEN** the plan-authority check reports live drift naming the file (existing replan path) and the UI-scope gate refuses to read the drifted whitelist

#### Scenario: a halted run's terminal event carries its disposition

- **WHEN** a run halts on a structurally-sensitive incident (e.g. `receipt_scaffold_unwritable`)
- **THEN** the `run_end` event carries the `run_disposition` computed at the halt production site, and the write-layer guard has nothing to refuse

### Requirement: The pass-snapshot mechanism is retired; PASS artifacts are protected by full re-verification

The per-run PASS frozen-snapshot mechanism (take/diff/restore/discard, trusted-context loading, epoch/head/journal, memory anchors, the `pass_snapshot_unavailable` / snapshot-flavored `pre_invoke_snapshot_failed` halt family, and the responsibility-rerun pending state) SHALL be removed and MUST NOT be reintroduced as workflow state, authorization, or start eligibility. PASS-artifact tamper protection SHALL rest on the facts that already exist: a closure attempt that breaks an artifact fails the next full harness re-verification; an edit that still passes re-earns every gate on the current bytes; and the phase closure manifest always binds the current bytes — the closure-only prompt keeps its "do not rewrite artifacts" instruction as guidance. Invalidation (backtrack/replan) SHALL be complete with the atomic `phase_backtrack_requested` event alone — no cache demotion side effects. The retained residents of the trust-state namespace are the coding base anchor (`coding-base.json`, the UI-scope diff baseRef — unrelated to snapshots) and per-run trust-state GC (`deleteRunTrustState`, which also sweeps legacy snapshot directories from older runs). Read-side incident mappings for historical ledgers MAY keep the retired incident ids. Independent mechanisms that share similar names SHALL NOT be removed: review closure source attestation, UT product-source immutability, testing invoke-boundary source write-protection (`product-source-snapshot`), and the device readiness gate.

Enforcement: `harness/scripts/utils/pass-snapshot.ts`, `harness/scripts/goal-runner.ts`, `harness/scripts/utils/scope-replan.ts`, `harness/scripts/utils/goal-runner-phase.ts`, `harness/scripts/utils/phase-completion-probe.ts`

#### Scenario: a legitimate UT PASS with no optional artifacts no longer trips an invariant

- **WHEN** a `repair_existing_ut` run reaches UT PASS with closure open and none of the optional UT artifacts on disk
- **THEN** the closure retry proceeds normally — there is no frozen-surface resolution, no "non-empty registry but zero deliverables" invariant halt

#### Scenario: a closure attempt that edits a PASS artifact is caught by re-verification, not by a snapshot

- **WHEN** a closure-only attempt modifies a previously passing artifact in a way that breaks a gate
- **THEN** the phase's next full harness run fails on the current bytes and the run takes the normal content-retry path — no snapshot diff, no restore, no cache-discard halt

### Requirement: Goal startup MUST resolve product selection once and halt on unresolved

goal run MUST 在**整个 run 的第一个 phase agent invocation 之前**（与
`declared_product_layer_missing` 同一时点模式，`--resume` 同样经过）MUST 解析一次 product
selection——当且仅当链路含需 product 的 phase（coding.compile / ut.* / device_test.*
任一非 skip）。解析按 profile 能力入口（profile 侧 `resolveProductSelection`），profile
不可用时跳过（generic 等无构建语义 profile 不受影响）。

解析结果 `unresolved`（构建形态无法确定——**四种原因**：`multi_candidate_unconfirmed`
多候选且 config 值未确认 / `no_build_profile` build-profile.json5 缺失 / `empty_products`
存在但未声明 app.products / `unparseable_build_profile` 无法解析；后三者**无真实候选**，
MUST NOT 以虚构 `default` 冒充 `sole_candidate`）
MUST 转既有 `phase_halt` 通道（不新建停止机制）：
`phase_halt{ phase: chain[0], halt_reason: 'product_selection_unresolved', verdict: 'FAIL' }`
+ `run_end{HALTED}` + 退出非零，halt_guidance MUST 含全部候选与统一确认引导
（`init.product_selection` / `record-product-selection` CLI / `HARNESS_DEVICE_TEST_PRODUCT`
env 三条路径）。

该检查 MUST 先于任何 phase 预算消耗；确认（config+local 双写）或 env 覆盖后 `--resume`
重检即放行。单候选与已确认工程 MUST 完全不受影响（零新增交互）。

#### Scenario: 多候选未确认的 goal run 在启动阶段停止
- **WHEN** 链路含 coding/ut/testing 且解析结果 `unresolved`
- **THEN** run MUST 在首个 phase agent invocation 前 HALT（`product_selection_unresolved`）
- **AND** MUST NOT 消耗任何 phase 尝试预算，MUST NOT 进入 coding 阶段中途才停

#### Scenario: 未确认值经 idempotent 确认后放行
- **WHEN** 用户经 `record-product-selection` 或 env 显式确认 product
- **THEN** 下一次 `--resume` 的启动前置检查 MUST 放行（`explicit_config` / `confirmed_env`）

> **Enforced by:** `harness/scripts/goal-runner.ts`
> （`product_selection_unresolved` 启动前置检查块）,
> `harness/tests/unit/goal-runner-*.unit.test.ts`

### Requirement: Windows headless agent invokes run inside a kill-on-close Job under a single-owner guardian

On Windows, a real (non-dry-run) headless agent invoke SHALL be launched by the PowerShell guardian
(`agent-guardian.ps1`, P/Invoke; zero added binaries) in this order: create the Job object with
`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` set, create the agent process suspended, assign it to the Job,
and only then resume it — there SHALL be no window in which the agent can execute user code outside
the Job. The guardian SHALL be the only long-lived holder of the Job handle (no handle copy to the
runner or the agent), SHALL wait on both the runner (SYNCHRONIZE) and the agent: a vanished runner
triggers `TerminateJobObject`, a killed guardian lets the OS close its handle (the last one → whole-
tree kill), and a normal finish closes the Job after the agent exits (residual descendants killed).
Agent stdout/stderr/stdin SHALL be inherited handle-wise so the runner's existing consumption pipes
keep working; the guardian SHALL never write to the agent's stdout. On Windows unattended the
failure to establish containment SHALL fail the invoke closed (no WARN-and-continue), and an
invoke whose guardian identity cannot be fully verified (process identity, executable, argv token)
SHALL also fail closed. Non-Windows / attended / dry-run behavior stays unchanged.

Enforcement: `harness/scripts/utils/agent-guardian.ps1`, `harness/scripts/utils/agent-containment.ts`,
`harness/scripts/utils/agent-invoke.ts`, `harness/scripts/goal-runner.ts`

#### Scenario: a hard-killed runner cannot leave an uncontained agent tree

- **WHEN** the runner process is hard-killed while the agent is running
- **THEN** the agent tree SHALL be terminated (guardian closes the Job; OS kill-on-close covers a
  killed guardian), leaving no surviving shell or CLI descendants

#### Scenario: containment setup failure on Windows unattended stops the invoke

- **WHEN** the guardian cannot create the Job, assign the suspended process, or resolve the agent
  binary
- **THEN** the invoke SHALL fail closed (non-zero exit, no agent resume, diagnostic on stderr), and
  the runner SHALL NOT continue as if the agent was contained

### Requirement: Controlled guardian takeover is identity-bound, event-sourced, and never guessed

Each Windows invoke SHALL record `agent_process_bound` (the guardian's ManagedProcessIdentity tuple:
pid, OS start time for strict equality, absolute executable path, and the explicit `run_id/invoke_id`
token carried in the guardian argv) and a closing `agent_process_settled` event. Resuming a run SHALL
reconcile unclosed bounds against a read-only process probe: a vanished guardian SHALL be treated as
Job-already-closed (no reclamation needed); a strictly matching live guardian SHALL be reclaimed only
after the old owner is confirmed dead and a new epoch is in effect, by terminating the guardian alone
so the Job closes and kills all descendants (no per-process tree kill), emitting `orphan_reclaimed`;
an identity mismatch or unverifiable command line SHALL be warned about without killing or blocking;
a matching guardian that cannot be terminated SHALL block the resume. A run with invoke history but
no `agent_process_bound` events at all (pre-3.0 legacy run) SHALL fail closed with a manual-cleanup
prompt. `goal-status` SHALL remain read-only: it may report unclosed invokes and guardian liveness
but SHALL never reclaim. `goal-supervise` SHALL keep backing off while the old owner (guardian) is
alive, SHALL refuse to raise legacy runs, and SHALL append `--force-resume` only after confirming the
old owner is dead (guardian gone), preserving the runner-side cooldown semantics.

Enforcement: `harness/scripts/utils/goal-containment-reconcile.ts`, `harness/scripts/goal-runner.ts`,
`harness/scripts/goal-supervise.ts`, `harness/scripts/utils/goal-progress.ts`

#### Scenario: resume on a legacy run without any bind events refuses safely

- **WHEN** a resume is attempted on a run whose events contain `agent_invoke_start` rows but no
  `agent_process_bound`
- **THEN** the runner SHALL refuse with a manual-cleanup BLOCKER (no guessing, no auto-reclaim) and
  the supervisor SHALL NOT auto-raise it

#### Scenario: a strictly matching leftover guardian is reclaimed as a unit

- **WHEN** a resume finds an unclosed bound whose guardian probe matches pid/start-time/executable
  and whose command line contains the recorded token, while the old owner is dead
- **THEN** the runner SHALL terminate that guardian only, rely on the Job close to kill the whole
  tree, confirm the guardian vanished, and record `orphan_reclaimed`

#### Scenario: status stays read-only

- **WHEN** a run has an unclosed bound and the operator runs `goal-status`
- **THEN** the snapshot SHALL report the unclosed invoke and guardian liveness and SHALL perform no
  reclamation side effect

### Requirement: Visual round identity is injected and monotonic across resume

The goal runner SHALL inject `MAISON_GOAL_RUN_ID` and `MAISON_GOAL_ATTEMPT` into both the agent invocation environment and the harness gate environment so the agent's in-session harness run and the outer gate share one round identity. The attempt id SHALL be the run-scoped invocation ordinal restored from events.jsonl (totalTurns mechanism) — never the per-phase retry counter (`retries + 1` resets on --resume, colliding with old round keys and replaying an unfused decision over what should be a no_fix_attempt second round). Hard constraints: same invocation → same id everywhere; any next invocation (retry, detach recovery, --resume) → different id; crash recovery never reuses an id (the ordinal counts already-persisted invoke-start events). The invoke_id SHALL derive from this ordinal, not from the wall clock alone.

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/{agent-invoke,goal-runner-phase}.ts`

#### Scenario: resume produces a fresh attempt id

- **WHEN** a run is interrupted after attempt i3 and resumed with unchanged evaluation state
- **THEN** the next invocation SHALL carry an id greater than i3 and the unchanged state SHALL fuse as no_fix_attempt instead of being deduplicated

### Requirement: no_progress_fuse halts on first touch without burning retries

`no_progress_fuse` SHALL be a first-class failure kind: classified from the blocker classification channel before the visual_diff id-prefix bucketing (the fuse blocker id starts with visual_diff and would otherwise be absorbed into visual_gap), halting on first touch with halt reason `no_progress_fuse` and never entering content retry accounting. The pre-existing coarse visual-gap signature halt SHALL remain as a backstop with its distinct halt reason; no human-confirmation path SHALL release either fuse in the same run.

Enforcement: `harness/scripts/utils/goal-failure-classifier.ts`, `harness/scripts/goal-runner.ts`

#### Scenario: fuse classification wins over prefix bucketing

- **WHEN** the testing summary carries a blocker with classification no_progress_fuse among other visual_diff blockers
- **THEN** classifyFailureKind SHALL return no_progress_fuse and the runner SHALL halt immediately

### Requirement: Ledger receipts round-trip through summary and events with integrity reconciliation

The harness runner SHALL append the evaluated round to the ledger after checks and return a receipt through the explicitly declared `summary.visual_round {loop_id, attempt?, row_hash?, disposition, decision?}` schema field (summary.json is additionalProperties:false — no bare injection); duplicate dispositions SHALL still carry the replayed decision. The goal runner SHALL persist the receipt as a `visual_round` event and, at each testing gate and on resume, reconcile events-expected row hashes against the ledger **unconditionally** (an empty expected set is precisely the main-path failure shape and never skips the check). The expected set SHALL include row hashes from **duplicate** dispositions (the dominant path is agent-side append followed by a gate duplicate — the duplicate's row_hash is that ledger row). Missing rows, modified rows (decision edits included — row hash recomputation), stale orphan rows, corrupt lines inside the goal loop, and duplicated row hashes SHALL halt as `visual_ledger_integrity`; pending adoption is limited to the **single most recent testing-phase invocation** that has started but not yet committed a visual_round event (non-testing invocations never qualify — they would stay pending forever and lend their attempt ids to orphan rows), and every adopted row SHALL immediately be committed back as a recovery visual_round event so the attempt stops being pending and the row enters the next expected set. A ledger append failure SHALL surface as `disposition: append_failed` (no row_hash) and halt immediately — the runner SHALL NOT proceed on a receipt that claims persistence that did not happen. Ledger corruption or deletion SHALL NOT be read as empty history. This is runtime consistency protection over agent-writable files, not cryptographic tamper-proofing — stated as such.

Enforcement: `harness/harness-runner.ts`, `harness/scripts/goal-runner.ts`, `harness/scripts/utils/visual-rounds-ledger.ts`, `harness/schemas/summary.schema.json`

#### Scenario: deleting a ledger row halts the run

- **WHEN** events.jsonl expects a row hash that is absent from the ledger at the next gate
- **THEN** the runner SHALL halt with visual_ledger_integrity instead of re-evaluating from an empty ledger

### Requirement: Runner-attested receipts are produced only from declared structured events

Adapters SHALL declare `tool_event_provenance: none | structured_events | session_transcript` (default none =永远 unverified). With structured_events the invocation layer SHALL split three files — `agent-events.jsonl` (stdout only, clean NDJSON), `agent-stderr.log`, and the unchanged mixed human-readable `agent-output.log` (existing sentinel/heartbeat/no-output consumers untouched). After the testing invocation the goal runner SHALL audit image-read tool events from the events file using a registered structured parser only (no text-regex guessing) and produce the critic receipt: verified iff every finalized screen's evaluated screenshot and every paired attest crop has a read record; otherwise unverified with unread lists; the receipt carries the runner attestation bound to agent-events.jsonl. Adapters without a registered parser SHALL degrade honestly (no production, unverified stands). Read-event evidence proves invocation and input injection, not model cognition.

Enforcement: `harness/scripts/utils/{goal-adapter-capability,agent-invoke,critic-receipt-producer}.ts`, `harness/scripts/goal-runner.ts`, `docs/operations/adapter-tool-event-provenance.md`

#### Scenario: stderr cannot corrupt the evidence stream

- **WHEN** the CLI writes NDJSON events to stdout while stderr emits diagnostics mid-line
- **THEN** agent-events.jsonl SHALL contain only the stdout stream and the attestation SHALL bind to it, not to the mixed log
