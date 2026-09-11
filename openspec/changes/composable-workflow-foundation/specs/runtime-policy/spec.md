## MODIFIED Requirements

### Requirement: evidence_profile config knob

`framework.config.json` MAY 声明顶层 `evidence_profile: strict|balanced`；缺省 MUST 为 strict 且行为与引入前逐一等值。`minimal` MUST NOT 是合法 config 值——它只能是旧协议 lite track 的求解结果，MUST NOT 因新请求阶段较少而自动求得。

#### Scenario: 缺省零变化
- **WHEN** 消费者 config 未声明 evidence_profile
- **THEN** 全部凭证按 strict（现状）求解，既有夹具零回归

#### Scenario: 全局声明 minimal 被拒
- **WHEN** config 写入 `evidence_profile: "minimal"`
- **THEN** config 校验 FAIL

> **Enforced by:** `specs/framework.config.schema.json`, `harness/config.ts`

### Requirement: Evidence matrix resolution

旧协议的 `resolveEvidencePolicy` MUST 按矩阵求解：full×strict verifier/trace/exploration required、receipt not_applicable；full×balanced（**由 config 显式声明，任意 mode 生效**）verifier 仅 {spec, coding} required（保留集默认写死，config 字段未接线）、receipt not_applicable、trace optional、exploration required；lite resolved=minimal——verifier off、receipt not_applicable、exit 脚本门禁 required。

降档 MUST 只由 `config.evidence_profile` 触发，`ctx.mode` MUST NOT 参与求解：缺省（无该字段 / 显式 strict）时 interactive、headless、goal 三态输出逐一等值于 strict，声明 balanced 时三态输出同样逐一相同。`resolveProfileLabel` MUST 与 `resolveEvidencePolicy` 同判——档位标签写进 `evidence_policy_snapshot.profile_resolved` 与控制台，标签说 strict 而求解按 balanced 走会让宿主读到与实际不符的档位。

balanced 下两根轴的降档范围 MUST 分别陈述，不得合并成同一个 phase 集合：`verifier` 按保留集分流，故 plan / review / ut / testing 四个 feature phase 关闭；`trace` 无条件降 optional，对**全部六个** feature phase 生效，**含仍要求 verifier 的 spec / coding**。

`verifier=off` MUST 只免除"要求提供"，MUST NOT 免除已经存在的负面结论：当前 subject 已有一份验真通过（subject 回显匹配、verdict 与 blocker_count 自洽）且 verdict ≠ PASS 的 verifier 报告时，闭环 MUST 仍否决。报告缺席或为 PASS 时才是零要求。

Enforcement: `harness/scripts/utils/runtime-policy.ts`, `harness/harness-runner.ts`, `harness/scripts/check-receipt.ts`, `harness/config.ts`

#### Scenario: balanced 跳过 review 阶段 verifier

- **WHEN** full + balanced 下求解 review phase（interactive 或 goal 均可）
- **THEN** verifier=off、receipt=not_applicable、trace=optional、exploration=required，脚本门禁不受影响

#### Scenario: goal-mode 同样按声明的 balanced 求解

- **WHEN** goal-runner 驱动同一 feature 且 config 声明 `evidence_profile: balanced`
- **THEN** 求解结果与 interactive×balanced 逐一相同——保留集外 verifier=off、六个 feature phase 的 trace=optional，`profile_resolved` 记 `balanced`

#### Scenario: 保留阶段的 verifier 与 trace 范围不相等

- **WHEN** full + balanced 下求解 spec 或 coding phase
- **THEN** verifier=required 的同时 trace=optional——两根轴的降档范围 SHALL NOT 被当成同一个集合

#### Scenario: 关轴不免除已有的负面结论

- **WHEN** verifier 解析为 off，但当前 subject 已有一份验真通过的 verifier 报告且 verdict ≠ PASS
- **THEN** summary MUST 保留该 subject 与报告落点、证据状态记 `fail`，check-receipt MUST 仍记 `verifier_not_pass` BLOCKER；脚本门禁 PASS SHALL NOT 构成放行

### Requirement: Resolved phase chains expose ownership inputs without becoming an owner registry

Runtime policy SHALL expose the validated execution scope's phase set and order (legacy full/lite/custom chains only under their birth protocol) to the phase write-boundary resolver. Artifact ownership SHALL still come from phase-contract `produces` plus artifact/evidence resolvers, and source ownership SHALL still come from coding scope and profile-specific UT/testing resolvers. Runtime policy MUST NOT add a path-owner manifest, hard-code the canonical six phases, or grant a custom phase source ownership merely because it exists in the chain.

Enforcement: `harness/scripts/utils/runtime-policy.ts`, `harness/scripts/utils/skill-contract.ts`, `harness/scripts/utils/phase-write-boundary.ts`

#### Scenario: lite workflow derives only its real nodes

- **WHEN** the active chain is `change → coding → exit`
- **THEN** owner/backtrack resolution SHALL use only those nodes and SHALL NOT invent spec, plan, review, UT, or testing targets

### Requirement: Runtime phase set derives from workflow

合法能力集合与本次执行集合 MUST 分开：workflow 声明可用能力，本次范围决定需要执行哪些能力；新协议恢复只使用 run 的冻结范围，MUST NOT 从当前 workflow/track 重算。

所有运行时组件（harness-runner、check-receipt、phase-transition-policy、trace 校验、goal-runner/monitor/status、compat/backfill/exploration 工具）MUST 从 active workflow 的 `artifacts[]` 解析合法 feature phase 集，MUST NOT 各自持有 `spec|plan|coding|review|ut|testing` 硬编码枚举。

#### Scenario: workflow 新增 phase 后运行时全链认可
- **WHEN** workflow YAML 声明新 phase id（如 `change`/`exit`）且 harness 各入口以该 phase 运行
- **THEN** check-receipt、transition-policy、trace 校验与 goal-runner 均接受该 phase，不出现"runner 放行、其它组件拒绝"的 split-brain

> **Enforced by:** `harness/scripts/utils/runtime-policy.ts`, `harness/scripts/check-receipt.ts`, `harness/scripts/utils/phase-transition-policy.ts`

### Requirement: Pure policy resolver set

旧协议兼容 policy 模块 MUST 保留核心纯函数 `classifyRequestRoute()`、`resolveFeatureTrack()`、`resolveEvidencePolicy()`、`resolvePhaseChain()`；判定集合可由后续 change 在同一模块扩展（C5 增 `resolveCorrectionTarget` / `classifyCorrection` / `resolveEnforcementTier`），扩展 MUST 同守纯函数与 default 等值不变式；`resolveEvidencePolicy` MUST NOT 执行文件 I/O（`provided` 属校验层事实，不在 policy 输出枚举内），输出限于 `required|optional|off|not_applicable`。

Enforcement: `harness/scripts/utils/runtime-policy.ts`

#### Scenario: 未声明降档时 headless/goal 仍 strict

- **WHEN** `runtimeContext.mode` 为 `headless` 或 `goal`，且 config **未**声明 `evidence_profile: balanced`
- **THEN** `resolveEvidencePolicy` 按 strict 求解——verifier=required、trace=required、exploration=required、**receipt=not_applicable**（strict 从来不是"全 required"）

#### Scenario: default 态与现状等值

- **WHEN** 无 feature.yaml、config 无 evidence 段、track 缺省 full
- **THEN** interactive、headless、goal 三态的求解结果逐一相同且与收编前硬编码行为等值

### Requirement: Stop hook policy snapshot fail-safe

harness-runner MUST 将 policy 快照（含 `policy_schema_version`、evidence 档位与本次范围绑定；旧协议含 track）写入 `.current-phase.json`；下发 Stop hook MUST 只读快照、MUST NOT import harness 模块或独立求解义务。新协议快照缺失、版本不符或解析失败时 MUST 拒绝放行并报告恢复缺口，MUST NOT 回退构造 full 链；旧协议保持 full+strict 的 fail-safe。

#### Scenario: 快照缺失时 fail-closed
- **WHEN** 旧协议 Stop hook 读取 `.current-phase.json` 无 policy 快照字段（旧 state 或 runner 未写成功）
- **THEN** hook 按 full+strict 判定（宁可多设防），不静默放行

> **Enforced by:** `agents/claude/templates/hooks/check-phase-completion.mjs`, `harness/harness-runner.ts`

## ADDED Requirements

### Requirement: Execution scope has one authority and preserves obligations

新协议 SHALL 区分 required / not_applicable / unknown、已有满足依据、执行可用性与完成证据；失败、manual、超时或设备离线 MUST NOT 消除义务或生成 PASS。零设备义务 SHALL 根据有效验收内容的同一分层规则判定，不强制物理 acceptance.yaml；performance 只有确需设备证明时才触发设备义务。

feature.yaml.execution_scope MUST 仅为运行前候选。完整 Feature 交付在首阶段前 MUST 经现有 goal-mode-entry prepare/attended attach 或 detached 入口建立真实 run；manifest.execution_scope MUST 是运行权威，phase_chain 为同值投影并绑定出生事实。恢复 MUST 读取冻结范围；显式 runId 的 manifest 缺失/损坏 MUST NOT 回退候选。全复用只核验真实既有完成记录，不造空链假 run。

范围变更 MUST 回责任方，沿既有 correction/backtrack/successor 重新签发；前驱封卷、释放 owner/锁后由同一 runtime 创建后继并记录恢复关系，MUST NOT 原地修改 manifest 或清空预算/失败历史。未受影响证据只在 freshness/closure 校验通过后复用。

新协议证据策略 MUST 在有效范围内求解，strict/balanced 继续按显式配置，模式不自动降档；未知输入先补足，本次无 testing 不要求 testing trace。已有有效负面结论与真实控制约束仍有效。MUST NOT 新建 execution-scope.json、第二 run 目录、场外状态或平行完成协议。

#### Scenario: Device failure preserves responsibility
- **WHEN** 当前 device-evidence 为 required 但设备离线
- **THEN** 范围保留设备义务并报告可用性缺口，不改为 not_applicable

#### Scenario: Resume ignores changed workflow defaults
- **WHEN** 新协议 run 出生后 workflow 或候选范围改变
- **THEN** 恢复 MUST 使用原冻结范围；需要变更时经责任方重签后继

#### Scenario: Spec discovers a new device obligation
- **WHEN** spec 的有效新验收要求新增设备验证
- **THEN** 先封卷交接再创建绑定新范围的后继，普通继续沿既有后继关系恢复，不重写原 run

#### Scenario: Request-only review cannot create feature completion
- **WHEN** 用户只要求审查指定代码
- **THEN** 使用真实专项请求与独立报告，只完成 request，不伪造 Feature、run 或 completion

> **Enforced by (planned P2/P5/P6/P7):** `harness/scripts/utils/runtime-policy.ts`、
> `harness/scripts/utils/goal-manifest.ts`、`harness/scripts/goal-mode-entry.ts`、
> `harness/scripts/utils/verify-feature-completion.ts`、`harness/scripts/check-testing.ts`。
