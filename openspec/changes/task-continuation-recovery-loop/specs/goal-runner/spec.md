## MODIFIED Requirements

### Requirement: Headless goal runs pin an explicit adapter model

The runner SHALL accept a user-supplied `--adapter-model <id>` that is the authoritative model input for a headless run. It SHALL be replayed into every headless agent argv that actually performs work (the formal per-phase invocation and the vision canary probe), SHALL be recorded in the manifest as `adapter_model_pin: {adapter, value}` with `adapter` equal to the final effective adapter, and SHALL be echoed in dry-run plan output. The CLI value SHALL be trimmed then validated to be non-empty, at most 128 characters, and free of control characters; no model-name allowlist SHALL be introduced. The runner SHALL NOT read any adapter private configuration as a pin source, and SHALL NOT use Codex `-c model=<raw>`.

The pin MAY additionally carry `source: user | approved_alternative`. The key SHALL be written only when an approved alternative is persisted; a pin without `source` SHALL be read as a user pin. This is read semantics only: loading an existing manifest SHALL NOT write the key back and SHALL NOT change its identity digest. An explicit `--adapter-model` on the current call SHALL be treated as a user pin for that call even when it equals a stored approved-alternative value. Approved alternatives SHALL come only from `framework.local.json adapters.<adapter>.approved_models`, never from adapter private configuration.

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

#### Scenario: Legacy pin without source reads as a user pin

- **WHEN** a manifest written before this change carries `adapter_model_pin: {adapter, value}` without `source`
- **THEN** the pin SHALL be treated as user-pinned (never substituted), the file SHALL stay byte-identical, and its identity digest SHALL equal the `run_created.manifest_identity_fields` recorded at birth

### Requirement: Adapter model pin lifecycle is adjudicated at a single point

The final model pin SHALL be decided by exactly one pure function (`resolveFinalModelPin`) wired after adapter reconciliation and before manifest identity computation. Fresh, fresh-with-manifest, resume, force-resume, successor, and adapter-change authorization SHALL follow the documented matrix: a resume or manifest-bound drift requires `--override-manifest`; a resume that changes both adapter and model requires both `--override-adapter` and `--override-manifest`; `--force-resume` SHALL NOT bypass pin drift; a successor's explicit `--adapter-model` is a birth input that overrides the inherited value without `--override-manifest`, and a successor that changes adapter SHALL require `--override-adapter` with a new model. `adapter_model_pin` SHALL enter the manifest identity hash only when the key is present, so old manifests without the key remain compatible. Tampering with the pin value while stopped SHALL surface through the existing `manifest_identity_drift` path.

A successor that does not supply `--adapter-model` SHALL inherit the source pin together with its `source`; an inherited approved-alternative pin is not user-pinned and MAY be substituted again. A same-value explicit `--adapter-model` SHALL keep the stored `source` unless `--override-manifest` is supplied, in which case the source SHALL become `user`. An approved-alternative substitution SHALL rewrite only `adapter_model_pin` through the existing `manifest_identity_rebase` path with `authorized_by: approved_model_alternatives` and `changed_fields: ['adapter_model_pin']`, so later resumes SHALL NOT report it as drift. Rebase and substitution events written before the first `run_start` SHALL remain visible to every authoritative event reader (identity baseline, budget folding, tried-model collection); dry-run events SHALL NOT. For a call without explicit continuation flags, an explicit model that differs from the pin SHALL be routed by the continuation decision to a successor birth, which uses the existing successor-birth override; no whole-manifest override SHALL be implied.

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

#### Scenario: Startup substitution survives resume without drift

- **WHEN** the startup canary switched the pin from the default to an approved alternative and the run later halts and is resumed without `--override-manifest`
- **THEN** the resume SHALL NOT report `manifest_identity_drift` and SHALL continue with the substituted model

#### Scenario: Successor inherits an approved-alternative pin and may keep substituting

- **WHEN** a successor is born without `--adapter-model` from a source whose pin has `source: approved_alternative`
- **THEN** the successor pin SHALL keep the value and the source, and a later model-unsupported failure MAY substitute the next approved model

### Requirement: Canary probe hard CLI failure is a pre-phase blocker

When the vision canary probe actually executes (`decideVisionCanaryProbe` returns `action === 'probe'`), a structured hard CLI failure SHALL be classified separately from ordinary invoke failures and SHALL escalate to a run-level BLOCKER before the first formal phase. The two newly covered classes are a child spawn race and a CLI/config argument incompatibility (unknown/unexpected/unrecognized argument or config load error). The probe SHALL return a `hard_cli_failure` outcome distinct from the existing invoke/invalid outcomes; only `hard_cli_failure` SHALL block. The existing resolved-binary preflight gate SHALL be preserved unchanged and SHALL NOT be double-counted as new protection. Skip paths (cache hit, dry-run, chain without a UI phase, local override) SHALL NOT gain this protection. Ordinary quota/API errors, auth errors other than the Codex terminal-failure envelope with status 401 or 403, and invalid vision answers SHALL remain non-blocking, and the existing binary gate behavior SHALL be unchanged.

When the hard failure is "model unsupported" (the recovered Codex 400 envelope with one of its recorded phrasings) and the user has not pinned the model on this call or in the manifest, the runner SHALL first try the next untried model from `framework.local.json adapters.<adapter>.approved_models`, record the substitution, and re-probe; it SHALL block only when no alternative is available, and the halt guidance SHALL state why (user-pinned, adapter without model replay, not configured, all tried, budget exhausted) and list the tried models. Each probe SHALL be allowed `min(120 s, remaining run budget)`; when the remaining budget is already exhausted at startup the probe SHALL be skipped and the subsequent budget check SHALL halt the run.

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/goal-preflight.ts`, `harness/scripts/utils/agent-invoke.ts`, `harness/scripts/utils/vision-canary.ts`

#### Scenario: Unknown argument during an actual probe blocks the run

- **WHEN** the canary probe executes and the child exits with a nonzero code after a CLI `unknown argument` error on stderr
- **THEN** the probe SHALL return `hard_cli_failure` and the run SHALL BLOCKER-fail before the first formal phase

#### Scenario: Cache-hit skip path has no hard-failure protection

- **WHEN** the canary probe is skipped due to a fresh admissible cache
- **THEN** no probe is spawned and no hard-failure classification occurs

> 注记：本 Requirement（金丝雀硬失败前置 BLOCKER）对应 plan d7f3a9c4 的 t4，已实现——`hard_cli_failure` 分类（child spawn race / CLI·config 参数不兼容）与只在该分类上的 run 级 BLOCKER 接线均已落地；skip 路径不获得该保护，既有 binary 门禁与普通 quota/API/无效答卷语义保持不变（auth 类中，codex 终态失败信封的 401/403 自 plan 4e6fb3b6 起计入硬失败）。

#### Scenario: Codex 401 terminal envelope during a probe blocks

- **WHEN** the canary probe's Codex `turn.failed` segment carries status 401 or 403
- **THEN** the probe SHALL return `hard_cli_failure` and the run SHALL halt with `canary_cli_hard_failure` before the first formal phase

#### Scenario: Unsupported model with an approved list substitutes before blocking

- **WHEN** the probe reports the model as unsupported, the model is not user-pinned, and `approved_models` lists an untried model
- **THEN** the runner SHALL switch to that model, emit `adapter_model_substituted`, re-probe with the new model, and continue without a halt when the new model is supported

#### Scenario: Remaining budget shorter than the probe timeout bounds the probe

- **WHEN** a resumed run has less remaining wall-clock budget than 120 seconds when the probe starts
- **THEN** the probe SHALL be allowed at most the remaining budget, and once the budget is exhausted no further alternative SHALL be tried

### Requirement: Truncated-chain runs machine-verify upstream closures before starting

A run whose start_phase is not the first phase of the resolved workflow chain SHALL verify, for every upstream phase, the existence and freshness of its closure (receipt closure state, gate fingerprint, phase_closure_fingerprint staleness recomputation, and — for review — the closure attestation). Textual assertions in `manifest.requirement` SHALL NOT substitute for verification. Verification failure SHALL refuse the run and name the missing/stale phase. HALTED/PARTIAL prior runs SHALL be resumed or superseded with an audited event — either explicitly (`--resume`, `--supersede <run_id>`) or by the shared continuation decision when the same request is re-issued; they SHALL NOT be silently displaced. A `CREATION_INCOMPLETE` residue is not a HALTED/PARTIAL occupant and SHALL NOT block a replacement creation. When supersede also changes the accountability baseline, it MUST use the paired runtime-external `--rebaseline-to <exact-40hex-sha>` management command; a supervisor MUST never infer or initiate rebaseline.

Enforcement: `harness/scripts/goal-runner.ts`（preflight）, `harness/scripts/utils/phase-evidence-manifest.ts`, `harness/scripts/utils/goal-run-creation.ts`

#### Scenario: requirement text asserting upstream PASS is ignored

- **WHEN** a new run declares start_phase=ut and its manifest text claims "上游已 PASS" but spec closure inputs have since changed
- **THEN** preflight SHALL recompute staleness, judge the spec closure STALE, and refuse to start

#### Scenario: incomplete residue does not require supersede

- **WHEN** the only previous directory for the feature is a manifest-only `CREATION_INCOMPLETE` residue
- **THEN** a valid fresh run SHALL be allowed without silently classifying or superseding that residue as HALTED/PARTIAL

#### Scenario: Re-issued request supersedes a structurally terminal run with audit

- **WHEN** the latest unfinished run is structurally terminal and the same request is re-issued with a verifiable change
- **THEN** the continuation decision SHALL birth a successor that writes the existing supersede audit event for every target, without the user naming any run

### Requirement: Wall-clock budget accumulates active runtime across resume sessions

The run budget SHALL measure active execution time, not calendar span: prior activity is the sum of per-session durations partitioned by `run_start` events, where a session without `run_end` (crash/hard-kill) is conservatively credited up to one heartbeat cadence beyond its last event (capped by the next session start or the current process start — cumulative undercount SHALL be zero and per-session overcount SHALL not exceed one cadence), and dry sessions are excluded. The hard-deadline semantics (agent/harness/backoff pre-checks minus the finalize reserve) are unchanged; only the baseline becomes `sessionStart + max(0, wall − priorActive)`. Artifact-since consumers (partial-resume feed) SHALL keep the true first authoritative session start, never a synthetic time. Budget halts SHALL carry `halt_reason` and `halt_guidance` on the outcome, the `phase_halt` event and the console banner (and thus `run_end`), and the guidance SHALL name only real routes: after an authorized budget edit, the filled-in explicit `--resume <run> --override-manifest --force-resume` as the primary route; re-issuing the same request with `--override-manifest` MAY be named only as effective when the halted run is itself the contract source of the task (otherwise the successor inherits its source's budget) — never a bare restart and never a user-assembled new run.

Startup time SHALL also count: a `run_start` carrying `session_started_at` SHALL start its session at that time (never earlier than what is already counted), and a `run_end` carrying `session_started_at` that follows the session's first `run_end` (a startup that exited before `run_start`) SHALL add `[max(session_started_at, counted), ts]`. Each session SHALL expose its real active intervals, whose sum equals its active time, so interval consumers never treat non-contiguous startup time as one span. Event streams without the field SHALL compute exactly as before.

Enforcement: `harness/scripts/utils/goal-runner-phase.ts`, `harness/scripts/goal-runner.ts`, `harness/scripts/utils/await-confirm-guidance.ts`

#### Scenario: an overnight resume of a 74-minute run does not instantly halt

- **WHEN** a run consumed ~74 minutes of active time, halted, and is resumed 13 hours later with a 480-minute wall budget
- **THEN** the budget check SHALL pass and the run SHALL continue with the remaining active budget

#### Scenario: genuine exhaustion halts with visible reason and real routes

- **WHEN** accumulated active time reaches the wall budget at resume
- **THEN** the run SHALL halt with `budget_wall_clock` present on outcome/phase_halt/run_end and guidance offering, after the budget edit, the filled-in explicit `--override-manifest --force-resume` resume as the primary route, and stating that a re-issued request with `--override-manifest` takes effect only when this run is the contract source

#### Scenario: Startup probe time before run_start is counted

- **WHEN** a run spends time in the startup canary before `run_start`, or exits during startup before `run_start`
- **THEN** the prior active time read on the next resume or successor SHALL include that startup time, and a successor SHALL NOT regain the consumed probe budget

### Requirement: Formal phase invoke hard CLI/guardian failures halt before harness with zero content retry

After a formal phase agent invoke, a structural hard failure SHALL be classified by a shared pure
function that covers (a) a structured `spawn_error` fact — including child spawn races, resolved
binary short-circuits, and guardian containment establishment failures projected at the
agent-invoke boundary as `[maison-guardian]` + stable ASCII operation marker
(`CreateProcess(` / `AssignProcessToJobObject` / `ResumeThread`) with exit code 2 and never by
localized text or exit code 2 alone — and (b) CLI/config argument incompatibility, and (c) the
recovered Codex structured error envelope `status:400 + invalid_request_error + requires a newer
version of Codex`, and (d) the Codex terminal-failure envelope whose `turn.failed` segment carries status 401 or 403 (a top-level `error` segment SHALL NOT count). On a hit, the runner SHALL emit `phase_halt(adapter_cli_hard_failure)` before
spawning any gate harness, register the incident as external, and SHALL NOT consume a content
retry and SHALL NOT attribute `spec_file_exists`. Ordinary agent content failures (including exit 2
without guardian diagnostics) SHALL keep the existing harness/retry semantics.

When the hit is "model unsupported" and the model is not user-pinned, the runner SHALL try the next untried approved alternative within the same attempt before halting: no content retry is consumed, every new invoke still counts toward turns and the wall-clock budget, and no substitution SHALL be attempted once the remaining budget is exhausted. Other hard CLI failures SHALL keep the halt unchanged. The halted `phase_verdict` SHALL record `failure_kind_classified: toolchain`, a value within the `FailureKind` enumeration, and the guidance SHALL state why no substitution happened.

Enforcement: `harness/scripts/utils/vision-canary.ts`, `harness/scripts/utils/agent-invoke.ts`, `harness/scripts/goal-runner.ts`, `harness/scripts/utils/adjudication.ts`

#### Scenario: Codex 0.138 model-compatibility 400 stops after one formal invoke

- **WHEN** the formal phase invoke returns the Codex structured 400 envelope for a newer-required
  model
- **THEN** exactly one formal invoke is recorded (`agent_invoke_start` count 1), no harness is
  spawned, no content retry is consumed, and the phase halts with `adapter_cli_hard_failure`

#### Scenario: guardian CreateProcess error 5 stops before harness

- **WHEN** the guardian exits 2 with `[maison-guardian] CreateProcess(CREATE_SUSPENDED) 失败: 5 ...`
- **THEN** the invoke result carries the projected `spawn_error`
  (`maison_guardian_containment_failed`), the phase halts with `adapter_cli_hard_failure`,
  `agent_process_started` remains 0, no harness runs, and no content retry is consumed

#### Scenario: Codex 401 terminal envelope halts as a hard CLI failure

- **WHEN** the formal invoke's Codex `turn.failed` segment carries status 401
- **THEN** the phase SHALL halt with `adapter_cli_hard_failure` before any harness, with no content retry consumed

#### Scenario: Unsupported model with an approved list switches model in the same attempt

- **WHEN** the formal invoke returns the model-unsupported envelope, no model is user-pinned, and `approved_models` lists an untried model
- **THEN** the runner SHALL invoke again with that model in the same attempt, with no `phase_verdict` between the two invokes and no content retry consumed

#### Scenario: A user-pinned model is never substituted

- **WHEN** the same failure occurs while the model is pinned by `--adapter-model` on this call or by a manifest pin without `source`
- **THEN** only the pinned model SHALL be invoked and the halt guidance SHALL say the model is pinned by the user

### Requirement: Device readiness gate before agent_invoke_start

goal-runner MUST 在 capability preflight 之后、`agent_invoke_start` 之前执行**异步**设备就绪门。该门 MUST NOT 复用 `runInvokeCapabilityGate` 的同步实现与其固定 `verdict='FAIL'` + `await_human_capability_gap` 返回语义（后者装不下 boot 等待/解锁/复验，且设备不可用应走 `external_block` 而非静态 capability FAIL）。

执行范围 MUST 由 profile capability 或 `requires_device` 元数据派生，MUST NOT 永久硬编码 `phase === 'ut' || 'testing'`。

门返回三态：`READY`（注入目标后放行）、`BLOCKED`（`external_block`，无 invoke）、`AMBIGUOUS`（HALTED，无 invoke）。未取得 READY 时 MUST NOT 产生 `agent_invoke_start`。

目标 MUST 以 `{serial, targetKind, sessionId}` 经 `extraEnv` 注入子进程，MUST NOT 写入全局 `process.env`。

`BLOCKED` 时若停机事件带探针且调用方不是有人在场的会话，goal-runner MUST 先在进程内有界等待（上限取 15 分钟与剩余墙钟预算的较小者，每 30 秒探一次），探针就绪后重跑同一个就绪门；门返回 `READY` 才在**同一 attempt** 产生 `agent_invoke_start` 并继续调用，不占内容重试。"本 attempt 无 invoke" MUST 只在以下条件成立时发生：有人在场（立即交回会话）、停机不带适用探针、或等待之后仍未恢复。等待期间"未取得 READY 时 MUST NOT 产生 `agent_invoke_start`"照旧成立。

#### Scenario: 设备不可用不烧 agent 轮次
- **WHEN** 就绪门判定 BLOCKED，且有人在场、停机不带适用探针、或进程内等待之后仍未恢复
- **THEN** events.jsonl 无本 attempt 的 `agent_invoke_start`；结论走 `external_block`，非 capability FAIL

#### Scenario: 无设备需求的 phase 不触发本门
- **WHEN** phase 未声明 `requires_device`
- **THEN** 就绪门不执行，不探测设备、不启动模拟器

#### Scenario: 等待期间设备恢复后同一 attempt 继续调用
- **WHEN** 无人值守的 run 就绪门判定 BLOCKED 且停机带设备探针，设备在等待上限内恢复
- **THEN** 探针就绪后重跑就绪门得 `READY`，同一 attempt 产生 `agent_invoke_start` 并执行，事件流为一条 `condition_wait_started` 加一条 `condition_wait_ready`，不写停机事件、不占内容重试

### Requirement: Preflight before agent_invoke_start

goal-runner MUST 在每 phase 每 attempt 的 agent_invoke_start 事件之前执行共享工具链 preflight（初跑与 --resume 均重检）；探测到显式前置能力缺口（deveco_toolchain_missing / deveco_toolchain_capability_failed 类 prerequisite code）时，缺口未解除期间 MUST NOT 产生 agent_invoke_start。停机事件带探针（`capability_preflight_ready`）且调用方不是有人在场的会话时，MUST 先在进程内有界等待（上限取 15 分钟与剩余墙钟预算的较小者，每 30 秒探一次），探针就绪后重跑同一能力门，通过则在同一 attempt 继续调用、不占内容重试；只有有人在场、停机不带适用探针、或等待之后仍未恢复时，才 MUST 写 phase_halt、run_end=HALTED 与 halt_reason=await_human_capability_gap 并以非零退出（HALTED 的 run_end 带 `probe` 与 `probe_phase`）。该 halt MUST NOT 计入 CUMULATIVE_HALT_FAMILY（agent 未开跑，无累计语义）。

#### Scenario: 缺口不烧 agent 轮次
- **WHEN** phase 前置能力缺口存在且 goal-runner 启动该 phase attempt，且有人在场、停机不带适用探针、或进程内等待之后仍未恢复
- **THEN** events.jsonl 无本 attempt 的 agent_invoke_start；run_end=HALTED，halt_reason=await_human_capability_gap

#### Scenario: resume 重检
- **WHEN** 用户修好环境后 --resume，或重新发起同一请求（接续决策重新接入同一 run）
- **THEN** preflight 重检通过，attempt 正常产生 agent_invoke_start；仍缺口则再次首触 halt

#### Scenario: 运行后失败不入本通道
- **WHEN** ut/testing 运行后产生 ohos_test_sign_gap 等 failure_kind
- **THEN** 走既有 toolchain 失败分类语义，不触发 await_human_capability_gap

> **Enforced by:** `harness/scripts/goal-runner.ts`, `harness/scripts/utils/goal-runner-phase.ts`

#### Scenario: 等待期间能力恢复后同一 attempt 继续调用
- **WHEN** 无人值守的 run 在 coding 前遇能力缺口，环境在等待上限内修好
- **THEN** 探针就绪后能力门重检通过，同一 attempt 产生 agent_invoke_start 并执行，事件为一条 `condition_wait_started` 加一条 `condition_wait_ready`，不写 phase_halt、不产生 retry verdict

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

该检查 MUST 先于任何 phase 预算消耗，新开与恢复旧 run 时都执行；确认（config+local 双写）或 env 覆盖后重新发起同一请求即重检放行，
由接续决策选择恢复方式：从未正式开始过的 run（没有正式 `run_start`）走附着、在同一 run 上重检、不设冷却，显式 `--resume` 对它会被拒绝；
曾正式开始过的 run 在恢复时被本检查拦下的，修好之后重发走恢复，显式恢复也可以。单候选与已确认工程 MUST 完全不受影响（零新增交互）。

#### Scenario: 多候选未确认的 goal run 在启动阶段停止
- **WHEN** 链路含 coding/ut/testing 且解析结果 `unresolved`
- **THEN** run MUST 在首个 phase agent invocation 前 HALT（`product_selection_unresolved`）
- **AND** MUST NOT 消耗任何 phase 尝试预算，MUST NOT 进入 coding 阶段中途才停

#### Scenario: 未确认值经 idempotent 确认后放行
- **WHEN** 用户经 `record-product-selection` 或 env 显式确认 product
- **THEN** 下一次重新发起同一请求（由框架选择附着或恢复同一 run）的启动前置检查 MUST 放行（`explicit_config` / `confirmed_env`）

> **Enforced by:** `harness/scripts/goal-runner.ts`
> （`product_selection_unresolved` 启动前置检查块）,
> `harness/tests/unit/goal-runner-*.unit.test.ts`

### Requirement: Conditional early validation of declared product layers

当 phase chain 含 testing（或确需 product snapshot）时，goal-runner MUST 在 run/manifest 创建之后、**整个 run 的第一个 phase agent invocation 之前**校验 `architecture.outer_layers` 声明目录与文件系统的一致性，并复用 `computeProductSourceSnapshotDetail` 单一校验器。校验失败 MUST 写 `phase_halt` 与 `run_end=HALTED`（MUST NOT 在建 run 前裸退，否则无可监控 run 且无法表达 resume）。恢复旧 run 时本检查同样执行；重新接入 MUST 重检，修好之后重新发起同一请求，由接续决策选择恢复方式：从未正式开始过的 run 走附着、在同一 run 上重检（显式 `--resume` 因缺正式 `run_start` 会被拒绝），曾正式开始过的 run 走恢复（显式恢复也可以）。testing pre-invoke 处既有校验 MUST 保留作纵深防御。

#### Scenario: 缺目录在首个 invoke 前即暴露
- **WHEN** chain 含 testing 且声明的产品层目录不存在
- **THEN** run 建立后、spec 的 agent invocation 之前即 `run_end=HALTED`

#### Scenario: 无 testing 的链路不受影响
- **WHEN** chain 为 spec-only / plan-only / ut-only
- **THEN** 不执行该早检，不因永不访问的目录失败

#### Scenario: 修好目录后重发同一请求在同一 run 上重检
- **WHEN** 声明的产品层目录补齐后重新发起同一请求
- **THEN** 接续决策在同一 run 上重检（从未正式开始过的走附着，曾正式开始过的走恢复），早检通过后链路继续，不新建 run

## ADDED Requirements

### Requirement: Failure attribution considers every blocker before the code-regression fallback

The goal failure classifier SHALL classify an attempt as `external_block` when the summary top level or **any** blocker belongs to the deferrable external class, regardless of its position. In a round that did not time out, it SHALL classify the attempt as `framework_bug` when any blocker is a framework blocker according to the shared blocker actionability registry, the same aggregation already used for toolchain blockers; content blockers in the same round SHALL remain listed and SHALL still require repair once the framework defect is resolved. `code_regression` SHALL remain the fallback only when none of these judgements holds. Timed-out rounds SHALL keep the existing freshness decision table.

Enforcement: `harness/scripts/utils/goal-failure-classifier.ts`, `harness/scripts/goal-phase-runtime.ts`

#### Scenario: An external blocker in second position is still external

- **WHEN** a round's summary has a content blocker first and a device external blocker second, and no external meta at the top level
- **THEN** the attempt SHALL be classified `external_block`, not `code_regression`

#### Scenario: Mixed framework and content blockers halt as a framework defect

- **WHEN** a non-timed-out round reports one content blocker and one checker-crash blocker
- **THEN** the phase SHALL halt as `framework_bug` without consuming a content retry, the summary SHALL still list the content blocker, and the guidance SHALL name both

### Requirement: Probed halts wait in-process with a bound before parking

For a halt whose event carries a condition probe — device not ready, capability preflight gap, or candidate write-back unavailable (only when the write-back itself fails) — the runtime SHALL wait in-process before parking, unless the run owner is an attended session, which SHALL hand back immediately. The wait limit SHALL be `min(15 minutes, remaining wall-clock budget minus the finalize reserve)` with a 30-second poll. The probe SHALL use the same implementation the supervisor uses; a ready probe is only a hint, and the original check (device gate, capability gate, write-back transaction) SHALL confirm recovery. When the probe is ready, the runtime SHALL first check the run's frozen input bindings through the single recovery judgement (see "Probed halts reach run_end; the supervisor only relaunches and one recovery judgement picks the run"): if they are stale, the runtime SHALL NOT re-run the original check or continue in this process; it SHALL close the wait as a timeout and park at once, leaving the successor to the launch entry. Otherwise, on recovery the same attempt SHALL continue without consuming a content retry or a turn; on timeout the halt SHALL be written and the run parked as before. A design-owner halt (`probe: design_authority_projectable`) SHALL NOT wait in-process; it parks at once so that the feature lock is released. The runtime SHALL emit exactly one `condition_wait_started` and one of `condition_wait_ready` / `condition_wait_timeout`, none carrying `halt_reason`. Waiting time SHALL count through the existing session segmentation, and the per-invoke timeout, prompt text, and `timeout_escalated` value SHALL be re-clamped to the remaining budget after the wait.

Enforcement: `harness/scripts/utils/condition-wait.ts`, `harness/scripts/goal-phase-runtime.ts`, `harness/scripts/goal-supervise.ts`

#### Scenario: Capability becomes available during the wait

- **WHEN** a capability preflight gap halts coding and the capability is repaired while the runtime waits
- **THEN** the runtime SHALL emit `condition_wait_ready`, SHALL NOT write the halt, and coding SHALL execute in the same attempt without a retry verdict

#### Scenario: Attended sessions do not wait

- **WHEN** the same halt occurs under an attended session owner
- **THEN** no wait SHALL start and the halt SHALL be handed back to the session immediately

#### Scenario: A ready probe with stale frozen bindings parks instead of continuing

- **WHEN** an unattended run waits in-process on a device halt, the device recovers, and meanwhile the run's frozen derived bindings have gone stale
- **THEN** the runtime SHALL NOT re-run the device gate or invoke the phase, SHALL close the wait with `condition_wait_timeout` right after the first ready probe, and SHALL park with the probe still on the halt

### Requirement: Probed halts reach run_end; the supervisor only relaunches and one recovery judgement picks the run

When a run ends HALTED after a probed halt, `run_end` SHALL copy the halt's `probe` together with the disposition fields and record the responsible phase as `probe_phase`, including where outcome projection fills the fields. A device park that ends the run `PARTIAL` SHALL keep the probe on its parking halt event, which remains the projection source; not every parked `run_end` carries a probe. The supervisor SHALL accept a `run_end` carrying a probe as the projection source event with the same criteria as a `phase_halt`: `WAITING`, wait kind `external`, and a ready probe. The supervisor SHALL only launch `--resume` of the run it watches and SHALL make no recovery judgement itself: its own successor branch, which had no production producer, is removed, and legacy `successor_required` / `successor_start_phase` event fields SHALL be ignored. It looks only at process liveness and disposition and never raises structurally terminal or human-waiting runs. Writing any event to a run and deciding to relaunch it SHALL happen under that run's existing feature lock, released before the spawn: when the lock is held elsewhere (the run is running, or a design repair on the same blueprint holds it) the supervisor SHALL neither write nor relaunch in that round, and when the restart count changed while it waited out the backoff outside the lock (another round already relaunched) it SHALL yield that round.

Whether the original run continues or a successor is born SHALL be judged in one place, by reading the run's frozen input bindings with the existing bound-input reader (no fingerprint is relaxed): a binding that no longer reads back and that no responsible phase from the halted phase onward can re-sign is stale. Source observations without a parsed value, and handwritten artifacts that spec or plan still owns from the halted phase onward, are not checked. With no stale binding the same run continues; with a stale binding the same run cannot be re-signed, so a successor SHALL be born through the existing successor birth, superseding the halted run. Three paths SHALL consume this judgement: a plain re-issued request (the continuation decision); an explicit `--resume` without `--force` or `--supersede`, in both the foreground entry and the detach launcher, which SHALL turn into that successor birth when the continuation decision for the same call without explicit flags is a successor caused by `external_condition_ready` that targets the resumed run; and the in-process wake, which parks instead of continuing.

The restart limit SHALL stay three and SHALL NOT be reset by a successor: the count is the restarts recorded on the run plus those recorded on the unfinished runs it supersedes within the same delivery cycle, followed through audited supersede events; completed runs belong to the previous delivery cycle and are neither counted nor followed.

Enforcement: `harness/scripts/goal-phase-runtime.ts`, `harness/scripts/utils/goal-run-creation.ts`, `harness/scripts/utils/goal-supervisor.ts`, `harness/scripts/goal-supervise.ts`

#### Scenario: A parked capability halt is woken from run_end

- **WHEN** a capability halt timed out its in-process wait, the run ended HALTED, and the capability later becomes available
- **THEN** the supervisor SHALL see `run_end` as the source event, SHALL NOT restart while the probe is not ready, and SHALL spawn `--resume` of the same run once it is ready

#### Scenario: Legacy successor fields resume the same run

- **WHEN** a run from a 3.0.0 package built between 2026-08-08 and 2026-09-05 carries `successor_required` or `successor_start_phase` on its halt
- **THEN** the supervisor SHALL resume that same run under the current checks and the restart limit, and SHALL NOT start a successor or honor the old start phase

#### Scenario: A supervisor relaunch with stale bindings becomes a successor

- **WHEN** a parked design-owner halt's probe becomes ready after a repair that changed the blueprint content the run's derived bindings depend on, and the supervisor launches `--resume` of that run
- **THEN** the runner SHALL birth a successor that supersedes the halted run instead of continuing it, and the task SHALL be completed by the successor

#### Scenario: Restarts keep counting across a successor

- **WHEN** a run with recorded supervisor restarts is superseded by a successor in the same delivery cycle
- **THEN** the successor's restart count SHALL start from the inherited number, and the supervisor SHALL stop restarting once the total reaches three

### Requirement: Budget and deadline are established before startup probes

The run budget, delivery-cycle folding, session start, and wall-clock deadline SHALL be established before the first startup probe, using the same metering source. Every probe and every approved-alternative attempt SHALL consume that budget and respect the same deadline. An approved-alternative decision SHALL require a positive remaining budget. Resume and successor SHALL NOT reset consumed budget.

Enforcement: `harness/scripts/goal-phase-runtime.ts`, `harness/scripts/utils/goal-preflight.ts`, `harness/scripts/utils/goal-manifest-cli.ts`

#### Scenario: Exhausted budget stops the alternative chain

- **WHEN** the probe consumes the remaining budget while the model is still unsupported
- **THEN** no further approved model SHALL be tried and the halt guidance SHALL say the budget is exhausted and list the tried models

### Requirement: Re-issuing the same request continues the same task through one decision

A single read-only decision function SHALL run before entry selection and birth-scope resolution for the foreground, detached, and attended entries. Its inputs SHALL be the project, the feature, and the facts of this call (explicit requirement or requirement increment, explicit model, budget override, explicit `--resume` / `--attach-created` / `--supersede` / `--force`, attended). It SHALL return exactly one of:

- **fresh** — no unfinished run after the last trusted completion and the feature scope is not held by a completed run; or the latest unfinished run never formally started, this call gives a requirement increment, no run holds the scope transfer, and there is no last completion (a never-started run has no execution evidence to inherit, so it SHALL NOT serve as a contract source); birth as before, re-resolving the birth scope from the current inputs;
- **rejoin** — the latest unfinished run is not structurally terminal; resume it when it formally started, attach when it never formally started (a startup check stopped it before any `run_start`); the original checks (device, credential, product selection, canary, budget) SHALL decide whether the condition cleared, and an uncleared condition SHALL stop again with the original reason without creating a run;
- **successor** — the latest unfinished run is structurally terminal and a change exists, or this call gives an explicit different model or a requirement increment that the frozen run cannot absorb, or the latest unfinished run is not structurally terminal, its halt's probe is ready (`external_condition_ready`) and its frozen input bindings are stale, or there is no unfinished run, the scope is held by a completed run, and a change exists relative to that run (contract source and only target: the completed holder);
- **hold** — structurally terminal with no change, or, on an unattended call, a formally started HALTED/DEFERRED run still inside the 5-minute cooldown with no change (attended calls — including an explicit `--resume` of the run the decision would rejoin — and runs that never formally started SHALL NOT be subject to the cooldown; an attended call on a non-structurally-terminal run SHALL rejoin directly unless one of the successor conditions above holds, and the original responsible checks still run), or no unfinished run with the scope held by a completed run and no change (guidance: the feature is complete; state the new or changed requirement and re-issue); no run SHALL be created and no event written, and the original stop reason plus what to supply SHALL be returned.

A change SHALL be only one of seven verifiable facts: the bound requirement source changed; a related repair changed; this call gives a requirement increment; this call gives a model different from the pin; this call carries `--override-manifest` while the run manifest's budget identity has moved from its baseline; this call carries an explicit continuation flag; the latest unfinished run, not structurally terminal, is in an external wait whose halt carries a probe and that probe is ready now (`external_condition_ready`). The seventh fact is general — it applies to every probed halt, not only to design authority — SHALL use the same probe extraction and probe implementation as the supervisor and the in-process wait, and SHALL NOT hold when the probe is not ready or fails. When it holds, and this call gives neither a different model nor a requirement increment, the decision SHALL consult the single recovery judgement on the run's frozen input bindings: with no stale binding it SHALL rejoin the same run regardless of the cooldown; with a stale binding it SHALL be successor. A requirement increment SHALL be judged by full-text comparison: this call's requirement is a repeat only when it equals the run's merged requirement in full, the original request in full, or the whole block of historical increments in full; anything else, including a substring, SHALL count as an increment. When the history holds several increments, re-sending a single one of them therefore counts as an increment (one extra successor, no requirement lost). When this call's requirement is already in merged format (it carries the framework's increment marker), the marker SHALL NOT be a reason to discard content: only parts confirmed to exist SHALL be stripped — an original-request segment equal in full to the source's original request, and a leading run of whole lines equal to the source's entire history block — and everything else SHALL be appended to the source requirement as new content with a single marker; it is a repeat only when nothing remains after stripping. The foreground, detached, and attended entries and the decision SHALL derive the successor requirement through the same function. A framework release update alone SHALL NOT count, and repairing only a receipt or closure transaction (no product or contract file change) SHALL NOT count as a related repair. Explicit flags SHALL keep their existing behavior. The detached orphan guard, both birth-scope resolutions, the fresh-run continuation guard, the check inside `createGoalRun`, the terminal resume guard, and the model-pin adjudication SHALL consume the decision instead of rejecting independently; rejoin SHALL NOT require `--force-resume`. A successor SHALL take its contract source from the run holding the current scope transfer, else the last completed run, else the latest unfinished run (except when all four fresh conditions above hold: that run never formally started, this call gives a requirement increment, no run holds the scope transfer, and there is no last completion — then the decision is fresh), and SHALL supersede every unfinished, not-yet-superseded run in the delivery cycle, including startup failures, with the existing audit and identity checks. When a successor is decided and this request gives start or end phases, they SHALL be accepted only when they equal the source run's original range; otherwise the entry SHALL refuse with an explanation and SHALL NOT create a run — the successor's chain is re-resolved from its birth scope and SHALL NOT be narrowed to the requested range; re-issuing without the phase arguments proceeds. The foreground, detached, and attended entries SHALL apply the same check. On unattended calls the explicit terminal resume guard's cooldown SHALL NOT be bypassed by `--force-resume`. The attended entry SHALL return the existing run on rejoin, and on successor SHALL birth the successor and return its run id; attaching to it SHALL write the supersede audit, identity checks, budget lineage, and scope transfer, and the successor SHALL run under the original attended executor. Because the attended entry takes no model or budget-authorization input, its successors SHALL arise only from a requirement increment, a requirement-source change, a related-repair change, or a ready probe on a halt whose frozen input bindings are stale (`external_condition_ready`, which needs no requirement or file change). Real locks, identity checks, and authorization checks SHALL remain; re-issuing a request SHALL NOT be treated as authorization.

Enforcement: `harness/scripts/utils/goal-run-creation.ts`, `harness/scripts/goal-phase-runtime.ts`, `harness/scripts/goal-mode-entry.ts`

#### Scenario: A repeated request with nothing changed does not create a run

- **WHEN** an unattended script re-issues the same request against a structurally terminal run without any of the seven changes
- **THEN** the decision SHALL be hold, no run SHALL be created, no event SHALL be written, and the number of runs SHALL stay the same

#### Scenario: A fixed environment is rejoined without flags

- **WHEN** a run halted on a capability gap, the environment is repaired, and the same request is re-issued after the cooldown with no flags
- **THEN** the same run SHALL be resumed without `--force-resume`, the original capability check SHALL pass, and the phase SHALL execute

#### Scenario: An attended call is not held by the cooldown

- **WHEN** a formally started run halted on a capability gap less than five minutes ago and the attended entry re-issues the same request after the environment is repaired
- **THEN** the decision SHALL be rejoin, the original capability check SHALL run, and the phase SHALL execute without waiting for the cooldown; an unattended call at the same moment SHALL hold unless the halt carries a probe that is ready now

#### Scenario: A ready probe lets an unattended re-issue through the cooldown

- **WHEN** an unattended run halted on a design-owner blocker less than five minutes ago, the design is repaired through readiness so that the halt's probe is ready and the frozen bindings still read back, and the same request is re-issued with no flags
- **THEN** the decision SHALL be rejoin of the same run with `external_condition_ready` among the changes; an unattended re-issue before the repair, inside the cooldown and with none of the other six changes, SHALL hold, create no run and write no event; when another change holds (for example a related repair written by the in-run pointer reconciliation), on an attended call, or after the cooldown, it SHALL rejoin and the original check SHALL stop the run again for the same reason

#### Scenario: A ready probe with stale bindings births a successor

- **WHEN** the same repair changed blueprint content that the run's derived bindings depend on, and the same request is re-issued with no flags
- **THEN** the decision SHALL be successor, the successor SHALL supersede the halted run with the existing audit, and no `--supersede` SHALL be needed

#### Scenario: Part of the original requirement counts as an increment

- **WHEN** the request is re-issued with only one paragraph of the run's frozen requirement
- **THEN** the full-text comparison SHALL treat it as a requirement increment rather than as a repeat of the original

#### Scenario: Re-sending the original request or the whole increment history is a repeat

- **WHEN** the run's requirement is an original request merged with two historical increments, and the request is re-issued with the original request in full, or with both increments together in full
- **THEN** it SHALL NOT count as an increment; re-issuing only one of the two increments SHALL count as an increment

#### Scenario: A merged-format request keeps its new content on both entries

- **WHEN** a completed run holds the scope and the request is re-issued, on the attended or the unattended entry, as the old requirement plus the framework's increment section plus a new requirement
- **THEN** a successor SHALL be born whose requirement contains the new requirement with a single marker and whose birth scope is not empty; re-issuing the same content again with different line breaks SHALL count as a repeat and SHALL NOT birth another successor

#### Scenario: A successor refuses a different phase range

- **WHEN** a successor is decided for a request that names start or end phases different from the source run's original range
- **THEN** the entry SHALL refuse with an explanation and create no run; re-issuing without `--start` / `--end`, or with the original range, SHALL birth the successor

#### Scenario: The attended entry births a successor and the host attaches to it

- **WHEN** the attended `--prepare-run` is re-issued with a requirement increment against a structurally terminal run
- **THEN** it SHALL birth the successor and return its run id; attaching SHALL write the supersede audit and scope transfer and run it under the attended executor, without asking the user to switch to the unattended entry

#### Scenario: An unauthorized repeat still stops

- **WHEN** a run waits on a human authorization and the same request is re-issued without that authorization
- **THEN** the run SHALL stop again for the same reason and no new run SHALL be created

#### Scenario: A new requirement after completion starts a successor from the completed run

- **WHEN** no run is unfinished, the feature scope is held by a completed run, and the same entry is re-issued with a requirement increment and no flags
- **THEN** the decision SHALL be successor with that completed run as contract source and target, and re-issuing the original requirement unchanged SHALL hold without creating a run or writing an event

#### Scenario: A changed requirement after a never-started run starts fresh

- **WHEN** the only unfinished run never formally started, no run holds the scope transfer, there is no completion, and the same entry is re-issued with a different requirement
- **THEN** the decision SHALL be fresh, the birth scope SHALL be re-resolved from the current inputs, and the new run SHALL NOT inherit or merge the never-started run's requirement; re-issuing that run's requirement unchanged SHALL rejoin it by attaching

#### Scenario: An explicit new model after a model-incompatible halt starts a successor

- **WHEN** the latest run halted on an unsupported model and the same request is re-issued with a different `--adapter-model`
- **THEN** the decision SHALL be successor, the successor SHALL supersede the startup-failed run, and the user SHALL NOT name any run

### Requirement: Human-facing halt guidance states the four recovery facts

Guidance for a halt that needs a person SHALL let the reader find which result is affected, who can fix it, what to do to recover, and how to confirm recovery. It SHALL NOT require the user to enumerate runs or assemble continuation flags; the primary recovery SHALL be "supply the missing input and re-issue the same request", and a filled-in explicit command MAY follow as an alternative — except where a re-issued request would not continue (budget exhaustion whose halted run is not the contract source; a closure wall repaired only in its receipt or closure transaction), where the filled-in explicit command SHALL be the primary route. Where re-issuing is the primary route, the guidance SHALL state that attended calls may re-issue as soon as the input is supplied, while unattended calls wait out the 5-minute cooldown after a formally started run stops (an explicit resume included) unless the halt carries a probe that is ready. A route that edits a manifest identity field (budget, `unattended` timeouts) SHALL pair the edit with `--override-manifest` and SHALL state that this authorizes the whole manifest, so only the intended field should change. Run ids MAY appear in diagnostics. This is a content requirement, not a fixed four-section format.

Enforcement: `harness/scripts/utils/await-confirm-guidance.ts`, `harness/scripts/utils/goal-report-generator.ts`, `harness/scripts/goal-phase-runtime.ts`

#### Scenario: One sample per fault category reads the four facts

- **WHEN** guidance is rendered for one registered halt reason of each fault category
- **THEN** each text SHALL name the impact, who can fix it, how to recover, and how to confirm recovery, and SHALL NOT contain a `<run-id>` placeholder, `--supersede`, or a "new run_id" instruction

#### Scenario: A timeout-raising route carries the manifest authorization

- **WHEN** the repeated-timeout guidance tells the reader to raise `unattended.phase_timeout_seconds.<phase>`
- **THEN** its command SHALL resume the run with `--override-manifest` and the text SHALL say that this authorizes the whole manifest, so only the timeout field should change
