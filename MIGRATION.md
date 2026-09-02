# Framework 升级与迁移说明

本文描述**实例工程**在 framework 子模块或配置演进时的预期做法。详细操作以 Skill 正文为准。


## 3.1.0：正式需求统一经部件内设计阶段（路由变化）

3.1.0 起，**部件演进蓝图从"复杂多变更单元需求才启用的可选路线"重定位为"正式需求必经的
部件内设计阶段"**（组织侧常称 Story Design）。

**什么是正式需求**：有明确交付或验收责任，且拟改变**部件行为、外部契约、数据/NFR、运行语义
或架构责任**的事项；不改变这些语义的纯文档和机械维护除外。

**变化**：

- 新增入口 Skill **`/component-design`**（`framework/skills/project/component-design/SKILL.md`）：
  需求源物化 → 正式性确认 → 蓝图 admitted → 分解 1..N 个 canonical Change Unit → 施工
  readiness。它的终点是**设计交接**，不进入选择器、不启动 Goal Mode、不做部件闭环；
- 原"三条 AND 入口门"（≥2 个 CU、共享部件级决策、单独绿≠整体完成）**不再是进不进蓝图的
  判据**，改为**条件式设计义务**——只在对应事实被发现时触发；
- 蓝图**只有一种协议**：没有 compact/full 档位、没有升级信号、没有升级状态机。内容深度由本次
  演进的真实影响面派生，小正式需求得到薄蓝图并拆出一个 Change Unit；
- 视图新增与 `applicability` **正交**的 `evolution_impact`（`changed` / `verified_unchanged`）：
  前者保持全量义务，后者须带 `unchanged_evidence` 并据此免除 target/delta 与节点义务；蓝图至少
  要有一个 `applicable` + `changed` 视图；
- `/spec` 与 `/change-lite` 在首次冻结施工意图处各加一道**非阻断**的正式性兜底复核，指回
  `/component-design`；**不新增机器 BLOCKER、不改 `track_scoring`**。

**不触发条件（原样保留）**：非正式维护动作继续走既有 L0 / L1 lite；**存量平铺 Feature 原样
有效**——不迁移、不自动转成 Change Unit、不自动 credit completion，也不会被拉进任何部件闭环
聚合。CU-bound 的 lite Feature 复用与 full 完全同一份 `contracts.yaml.change_unit` sidecar，
不需要新格式。

**宿主适配**：Maison 与宿主之间新增三条方向独立的静态接缝——
`requirement-source-materialization`（宿主 → Maison）、`blueprint-review-publication`
（Maison → 宿主）、`blueprint-review-feedback`（宿主 → Maison）。它们的方向、时点、字段、
hash、authority、失败语义、两条最小接入流程、Story 类扩展职责映射、随包样例与验证命令，见
发布件内唯一人读入口
**[`framework/docs/operations/component-design-host-adaptation.md`](docs/operations/component-design-host-adaptation.md)**。
三条接缝的校验都挂在既有 `check:component-blueprint` 上（`--materialization` /
`--projection` / `--feedback`），**没有新增顶层 CLI**。

**处置**：

1. 升级 framework 后跑一次 **`/framework-init` UPDATE**——`/component-design` 的 slash command
   与 skill 跳板是新增产物，只有重新物化 agent 产物后才会出现在实例根（`.claude/commands/`、
   `.cursor/commands/`、`.cac/commands/`、各 bundle 的 skills-bridge）。未物化时仍可直接让
   agent 读 `framework/skills/project/component-design/SKILL.md` 正文进入。
2. 进行中的普通 Feature 无需任何操作。下一项正式需求开始前，先走 `/component-design`；已归属
   某个 `blueprint_id` 的继续原演进工作区。


## 3.1.0：默认 receipt/reports 目录模式跟随 `paths.features_dir`（行为变化）

3.1.0 起，未显式配置 `receipt_dir_pattern` / `reports_dir_pattern` 时，默认模式从
`paths.features_dir` 派生（`<features_dir>/<feature>/<phase>` 与
`<features_dir>/<feature>/<phase>/reports`），不再使用固定的字面量 `doc/features/...`。

**触发条件**：实例工程满足以下**全部**条件时行为变化——

1. 自定义了 `paths.features_dir`（非默认 `doc/features`）；
2. `framework.config.json` **磁盘上未显式写入** `receipt_dir_pattern` / `reports_dir_pattern`。

> 边界按“磁盘上是否已有显式 pattern”判定（2026-08-22 更正）：**缺失 pattern 时，
> 3.1 的 normalize 与 framework-init UPDATE 的 BACKFILL 都从 `paths.features_dir` 派生**
> 默认形态；**已有显式 pattern（包括旧版本曾写入的字面量 `doc/features/...`）原样保留**。
> 因此“经过 BACKFILL 的宿主”并不豁免——若 BACKFILL 发生在自定义 features_dir 之后，
> 其派生值同样指向自定义目录。

**影响**：receipt（`phase-completion-receipt.md`）与 harness/report 产物落点从
`doc/features/<feature>/<phase>/...` 搬到 `<features_dir>/<feature>/<phase>/...`。
已闭环 receipt 若在新旧两个位置都被 harness 检查到，可能短暂出现重复/缺失提示；
重跑对应 phase harness 后收敛。

**不触发条件**（原样保留）：显式配置的 pattern 一律原样保留（只替换 `<feature>` /
`<phase>` 占位符、不搬到 features_dir 下）；默认 `doc/features` 宿主行为不变。

**处置**：若要维持旧落点，在 `framework.config.json` 显式写入
`"receipt_dir_pattern": "doc/features/<feature>/<phase>"` 与
`"reports_dir_pattern": "doc/features/<feature>/<phase>/reports"`；否则无需操作，
重跑受影响 phase 即可。

> 同一发版的演进工作区目录契约（`<features_dir>/<blueprint_id>/...`）不产生消费者迁移：
> 该路径形态此前未发布、工作树无真实存量（见 M5A plan §3）。


## 3.0.0：Skill 契约、assess 调和循环与 Goal 单写者

3.0.0 把 phase 合格性与 goal 跨阶段推进收敛为机器契约：

### contracts.yaml 文件引用闭包（Breaking）

- plan closure 现在把 contracts 中 schema 声明的文件字段解析为内存视图，并要求它们全部属于规范化后的顶层 `contracts.files`。覆盖 data model/interface/component 文件、`resource_keys` 的 `path`/`media`、`navigation.config_files`、HAR build/export 文件和 `prd_to_code_traceability[].key_files`。
- `contracts.files` 是唯一授权集合。文件已存在、与 spec asset 字节相同、由生成器产出或在其他字段出现，都不会自动获得 coding/UI scope 授权；框架也不会写 reference graph/manifest sidecar。
- 升级已有 feature 时，若 `contract_file_reference_closure` 失败，请回到 plan，把诊断中的确需交付路径逐项加入 `contracts.files`，重新生成/关闭 contracts 并重跑 plan harness。不要在 coding 阶段扩写 contracts。

#### navigation 段的 canonical 形态与 `registration_points`（Breaking，消费者需动手两处）

- **navigation 只保留 `config_files`**：3.0 canonical 的 navigation 文件字段唯一——

  ```yaml
  navigation:
    config_files:
      - 02-Feature/CardFeature/src/main/resources/base/profile/main_pages.json
      - 02-Feature/CardFeature/src/main/resources/base/profile/route_map.json
  ```

  语义是"导航注册/配置文件清单"，由真实消费者（hmos-app `page_registration`）塑形；每条路径同样必须列入 `contracts.files`。其它承载文件路径的 navigation 键——含嵌套在 `pages[]`/`routes[]` 之类容器里的形态——一律判 `unconsumed_file_field` BLOCKER。
- **删除 `registration_points`**：该字段全仓无任何消费者，不是旧形态、不做别名归一。请从 contracts.yaml 删除；若确需声明注册文件，改写为 `navigation.config_files`。
- 阶段归属：plan 闭包只裁决路径安全/规范化与 `contracts.files` 授权，**允许**声明 coding 将新建的文件；物理存在性由 coding `file_completeness` 裁决（已授权但未建 → plan PASS、coding FAIL）。同一轮里 hmos-app `page_registration` 也会如实 FAIL（不再以 SKIP 冒充成功）。

### 无人值守恢复与人签质量通行证退役（Breaking）

- `confirmed_by`、`human_confirmed`、`human_signed`、`visual-confirm` 以及 fidelity/P0 skip/
  conditional review/behavior switch/source mutation/flow contract/runtime fidelity 等旧 confirmation
  receipt 不再影响 verdict、phase advance 或 completion。旧字段和旧文件仍可读取用于审计，但新 writer
  不再生成；不要批量重写宿主历史产物。
- 旧 `AWAITING_HUMAN_REVIEW` run 仅兼容读取。恢复时会按当前机器事实重投影为责任阶段 repair、
  `DEFERRED_CAPABILITY_MISSING`、optional advisory 或明确诊断；不能通过补签/resume 把 FAIL 改成 PASS。
- strict 视觉目标缺少可用 provider 能力时在内容 agent spawn 前进入 capability defer；provider 已声明
  支持但当前 evidence 缺失、stale、伪造、乱序或错误 target 时，testing FAIL 并重跑，不能伪装成缺能力。
- P0 device flow 的 runtime fidelity 改由 hash-bound 的逐 step runtime observation 证明；旧 attestation
  receipt 无效。crop/bbox 改由 source/bbox/tool/hash 确定性复算；旧人名字段无效。
- 下游误写上游产物不会首次永久 HALT：runner 保留字节但失效旧信任，记录 owner/path/pre-post hash，
  然后通过唯一 `backtrack_to_phase` 事务回 owner 全量重验并重签。只有持续并发、不可读、预算耗尽或
  不收敛才进入精确 integrity/fuse 终止。
- `confirmed_by_user` 等普通选择字段改名为中性 `selection_status`/`selection_source`。这类菜单仍可作为
  attended UX，但不是质量凭证；无人值守运行必须从 manifest/config/默认策略得到确定结果。

1. **Summary 升级到 1.2**：phase checker 现在输出机械推导的 `assurance`、`capability_resolutions` 与 versioned closure commit。旧 summary 会被 `assess@1` 标为 `legacy_unverified`，必须重跑对应 harness，不能沿用旧 PASS 推进。
   - 存量 `1.0/1.1` 或缺 `closure_commit` 的 full-track 产物须重跑 phase harness，并让 finalizer/receipt 重新提交 closure；只手改版本号无效。
   - 缺 `assurance` 读取为 `unknown`；它不能满足 `minimum_assurance`。没有最低保证约束时仍会如实呈现，不静默猜成 `full`。
   - harness stdout 在既有 `HARNESS_SUMMARY` 块之外新增有界 `NEXT_STEP` 渲染；每个 outer invocation 最多一次。机器解析仍以 summary/JSON 文件为准，不应抓散文行。


### 3.0.0：能力裁剪与统一保证等级（Breaking）

- `summary.depth`、`quality_depth`、`missing_optional_inputs` 与 goal `minimum_depth_by_phase` 已删除。新 summary 1.2 使用 `assurance`、`capability_resolutions` 与 `capability_resolution_contract_fingerprint`；旧 summary 必须重跑，不提供双字段兼容。
- contract 的 `tiers`、`when`、`satisfies`、input 级 required/optional、`alternatives`、`normalizer` 与 `absent_effect` 已删除。迁移为 input 的有序结构化 `artifact`/`derive` sources，以及 capability 的 `tracks`、`axis`、`applicability_provider_id` 和 `on_missing`。
- `minimum_assurance` 只影响 `assess@1` 的 `insufficient_assurance`；它不能放宽 quality axes、phase closure 或 release。`pruned` 不再改写 quality axes、closure 或 release，而留在 `assurance`、`capability_resolutions` 和 assess 的 `observed.degradations`；仅 `blocked` 能触发质量/完成态收紧。`AxisResolution.reason_code` 已删除，assess degradation 的 `reason_code=capability_pruned` 保留为溯源。
- testing 的 `derive.adhoc-cases` 只读取显式 `--adhoc-cases` 输入；goal requirement 不再被隐式当作 adhoc cases。零个 case，或单个少于两步且没有 expected 的规范化 adhoc 输入，会在 resolver 中保持 `absent`，不会伪装成可满足 fail-policy capability。
- 先前 closed 的 fallback phase 也必须重跑/重新闭环：evidence 绑定项目内 applicability 依赖和每一次实际 source attempt，缺失的高优先级 artifact 后来出现会使旧 closure stale。framework contract 仅以 `capability_resolution_contract_fingerprint` 留在 summary/closure provenance，升级 framework 不会使消费者历史 feature stale。带上游 producer 指针的裁剪只有在阻塞下游 `on_missing: fail` core capability 时才形成 producer 定向的 `pruned` assess gap。
2. **Skill contract 成为运行时输入**：结构化 inputs、capabilities、produces 与 checks 由 `skills/feature/<skill>/contract.yaml` 声明；写边界与 closure 仍由既有 policy/evidence 机制负责。自定义 Skill/phase 需要在对应 Skill 目录补 contract，否则一致性门禁失败。
3. **`next.json` 是投影**：`assess@1` 从 summary/closure/evidence/goal 指纹重算 gap 与一个 recommendation；不要写脚本直接编辑 `next.json`。
4. **Goal 只有一个调和循环**：interactive 与 detached 都进入同一个 `GoalPhaseRuntime`，仅 executor transport（宿主 callback / adapter spawn）不同。runtime 独占 `assess → authorize → one phase → gate/verdict → reassess`；`goal-mode` Skill、宿主与 executor 不再维护下一阶段表或私有 gate。
5. **用户模式改为“有人在场 / 无人值守”**：明确意图不再二次确认，歧义使用 registry `goal.run_mode`；`--detach` 恒为无人值守。

Adapter 作者须按需补 root `goal_capability`：

```yaml
goal_capability:
  mode: external_runner
  in_session_reconcile: false
  phase_context_isolation: false
  supports_resume: false
  handoff: none
```

旧 adapter 可不改：缺失字段按保守默认处理，但不会获得会话内自治或 handoff。`in_session_reconcile=true` 要求 context isolation；handoff 要求 resume。

每个权威 goal run 新增：

- `run-control.json`（`run-control@1`）：持久化单调 epoch 与 process/session owner；
- 原子 handoff mailbox：只允许当前 owner 在 phase 边界消费；
- `phase_verdict.reconcile_observation` 与 `assess_recommendation`：记录调和输入和最终推荐。

所有权变化后，旧 owner 的 event/progress/manifest/phase 写入都会因 fencing 被拒绝。不要删除或重置 `run-control.json` 来“解锁”；session 过期也不会自动转移所有权。恢复应使用协作 handoff，或用户明确的 force takeover/force-resume。

既有 manifest、events、progress、trust ledger 和 `run_id` 不做格式转换；session↔detached handoff 继续使用同一账本。dry-run 不在 `.dry` 外写 `next.json`。

相关说明：[Skill 契约](docs/concepts/skill-contracts.md)、[调和循环](docs/concepts/reconcile-loop.md)、[Goal 运行手册](docs/operations/goal-mode-runbook.md)。
---

### verifier 能力化、短 request 投递与 summary 1.3（Breaking，plan a9d4e7c2）

**verifier 不再是每阶段必跑的仪式，而是按能力启用。** 一次解析 workflow 的 `verifier_prompt`
声明、feature track、evidence policy 与 adapter 的 `verifier_capability`，得到三态之一：

- `disabled`：**缺席即为零**——不生成 `ai-prompt.md`、不生成 request、summary 不写
  `verifier_subject_id` / `verifier_request` / `ai_prompt`，闭环也不要求 verifier 证据。
  lite track 的 change/coding/exit、balanced 档的非保留 phase、profile 禁用的 phase、以及
  workflow 未声明 `verifier_prompt` 的 phase 都在此列。**磁盘上残留的旧 prompt/request/report
  永远不会重新激活已关闭的能力，也不需要你去清理。**
- `enabled`：生成 `verifier.request.<subject>.json`，正常执行 verifier。
- `blocked`：policy 声明 `required` 但当前 adapter 没有登记该模式的 verifier 能力。
  **脚本门禁照常完整执行**——脚本 FAIL 如实报真实失败；脚本 PASS 才报
  `INCOMPLETE / verifier_provider_unavailable`。

**adapter 侧需要动手的一处**：`agents/<adapter>/adapter.yaml` 新增 `verifier_capability`
（`transport` / `publisher` / `modes`）。claude 与 codeagent 已随发布件登记 `interactive`。
自建 adapter 若确实具备 SubagentStop 发布链路且已实测，可照此登记；**未登记 = 无能力**，
`full × interactive` 下会被判 `blocked`（这是如实结论，不是回归）。

**投递协议改为短 request JSON（Breaking）。** 旧规则「把 `ai-prompt.md` 全文原样投递给 Task」
已删除：真实样张可达 177KB，往返有损且机器块之外零校验。新规则——

1. 跑 `harness-runner`；启用时它会打印并记录 `summary.verifier_request`；
2. 把那份 `verifier.request.<subject>.json` 的**完整 JSON 正文**作为 Task prompt 投给
   `subagent_type=verifier`（不要投 `ai-prompt.md` 全文、不要手抄或改写字段、不要前后夹带说明）；
3. verifier 按其中的 `prompt_path` 自行 Read 原件，结束时回显 `subject_id`；
4. 跑 `check-receipt.ts`；
5. 关环用 `harness-runner.ts --sync-closure --phase <phase> --feature <feature>`。

**第 5 步的口径变了**：`subject` 现在**按实际审查材料寻址**（`prompt_sha256` 直接哈希磁盘
`ai-prompt.md` 字节，没有任何 canonical 投影）。因为组装出的 prompt 内嵌时间戳与整份 script
report，**再跑一次完整 harness 会换代 subject**，刚发布的 verifier 证据随之失效。`--sync-closure`
不重跑脚本 harness、也不重发 request，正是为关环这一步存在的入口。

**summary 升级到 1.3。** `ai_prompt` / `verifier_subject_id` / `verifier_request` 成为**条件字段**
（仅 `enabled` 时在场）；`1.2` 仍可读，作为上一代闭环域。

**存量产物怎么办：**

- 已 closed 且 evidence manifest 仍 fresh 的阶段（含 1.2 代）走 grandfather，**零动作**；
- 3.0.0 生成但**未闭环**的 subject/ai-prompt 不再继续发布：只需**重跑当前 phase 的 harness**
  （分钟级）拿到新 request，再按上面五步走完即可。**不回退业务代码、不重写上游产物、
  不从 spec 重走、也不要求提交。**
- 下游发现缺陷时的正常回退不变：回责任上游改 → 重跑上游 harness/verifier/receipt →
  下游因 freshness 变 stale → 从下游继续。不清空 feature。

---

## 首选路径：初始化 Skill 的 UPDATE 模式（编排化 · S1–S4）

当实例根已存在 `framework.config.json` 时，再次执行 [`framework-init`](skills/project/framework-init/SKILL.md)（`/framework-init`）进入 **UPDATE** 模式，流程为：

| 步 | 动作 |
|----|------|
| **S1 探测** | `init-orchestrate.ts --scope project` 只读产出 `InitTaskPlan`（**零写盘**） |
| **S2 计划批准** | `init.task_plan` + `init.materialized_adapters` 多选；手动模式用 `init.task_decision`（**禁止 Q1=y**） |
| **S3 执行** | 枚举 decision JSON + context JSON（OS 临时目录绝对路径）→ `init-orchestrate --execute` → preflight + `executeInitPlan` |
| **S4 摘要** | `buildRunSummary(run-log)` |

要点：

1. **项目 config 变更**（架构 DSL、`materialized_adapters`、paths 等）在 S2 收集进 `configWritePayload`，S3 由 executor 写入。
2. **个人 `agent_adapter` 与宿主 IDE 路径**不在项目 init 配置——首次跑 catalog/spec 等阶段时 `check-personal-setup.ts --json --ensure` 内联写入个人级 `framework.local.json`（多 adapter 见 [`personal-setup-gate`](skills/reference/personal-setup-gate.mdSKILL.md)）。
3. **增删物化 adapter** 时更新 `materialized_adapters[]` 并重跑 S3；旧 adapter 目录可能残留，列给用户手工处理，**不自动强删**。

日常 framework 版本跟进应走上述 UPDATE 编排，而不是手工散落改多份文件。

---

## framework 控制面写边界（3.0.0 Breaking：runtime Git/hash 家族退场）

原先的做法是：发布件随包下发 `framework/RELEASE-MANIFEST.json`，harness 启动时逐文件 sha256 比对，漂移判 BLOCKER；随后为保护这个事后检查本身，又依次长出 manifest sidecar 自校验、外来文件扫描、真人具名 drift allowlist 与六 subtype 的 halt/恢复矩阵。

它不是安全边界：manifest、sidecar 与被校验文件同处一个可写目录，同一主体能一并修改。范围也被推到最大——2026-08-31 的直接反例：一份**不参与运行**的 vendor 移交文档只少了一个文末空行，hash 事实无误，却让 catalog、testing 与设备执行全部 BLOCKER。

**3.0.0 起改为把写权限从宿主身份拿走，并彻底删除普通运行的 Git 身份裁决**：

- **谁能写由执行环境授予**：host consumer task 对 framework 控制面**物理只读**（task sandbox / 只读挂载 / 受限 OS token + ACL），只有用户或 CI 显式启动的 updater 在升级窗口内临时可写，完成后恢复只读。env、`framework.config.json`、agent 自报身份、当前目录都可伪造，一律不构成身份。
- **无法强隔离时只保留合作式编辑工具守卫**：覆盖 Write/Edit/MultiEdit/NotebookEdit，判定异常 fail-open；shell、脚本、`node -e` 与场外进程不在射程。没有 Git/hash/manifest 查时 detector 兜底。
- **宿主 Git 完全无关**：是否为 Git 仓、tracked/staged/committed/clean、HEAD 是否仍是旧发布件均不影响 Maison init/phase verdict 或 Framework identity。

### 消费者需要动手的地方

- **新运行不再有 framework integrity 结果**：不生产 `framework_integrity`、`framework_control_plane_dirty`，也不保留永久 SKIP/PASS 空壳。旧 summary 的 `framework_drift` / foreign / manifest subtype 仍可只读展示，不批量重写。
- **`framework.config.json` 的放行字段失效**：`integrity.drift_allowlist` 与 `integrity.allow_local_drift` 可为存量配置无损读取保留，但读取即忽略、不能解锁守卫、不能影响 verdict，也不再产生运行时迁移 advisory。请在后续配置维护中删除。
- **包 hash 仍在可信边界**：Maison `release:pack`/`release:verify` 与明确 updater/集成操作保留校验；普通 phase 不读取或重算 per-file manifest。包身份（version / source_commit / built_at / sidecar 声明的 manifest SHA）继续可读，只作展示。
- **`docs/vendor/**` 不再进发布件**：它是与外部 vendor 的交接材料，不参与运行。升级后该目录不会出现在 `framework/` 下。
- **dev/source layout**（framework 自身仓，无包内 manifest）只会显示 identity unknown/SKIP，不影响其 `npm test`；不存在 runtime integrity gate。

## 顶层测试计划新增 `execution_channel`（3.0.0 Breaking）

`test-plan.md`「测试用例清单」表每条 TC 必须声明唯一**执行通道**，值域冻结为 `hylyre` | `visual` | `manual` | `provider:<capability-id>`。缺列、缺值或非法值都会让 testing FAIL，并要求一次性迁移——harness **不会**按用例名、优先级或步骤散文替你猜通道。

- **为什么**：此前派生器可以自行写 `explicit_skip_tc_ids`。静态门拒绝入口 selector 后，它没有回报"无法编译"，而是把入口 TC 挪进 skip 仍宣称覆盖完整；剩余用例的前置状态随之全部失真，设备停在首页，一整轮执行级联失败。执行责任必须由测试计划作者声明，不能由编译器自行处置。
- **派生器不再有 skip 决策权**：正式派生只编译 `channel=hylyre` 的**全集**，不得新增/删除/改写通道，也不再产出 `explicit_skip_tc_ids`（历史产物仍可读）。任一 `hylyre` case 编译失败——含"首个断言之前没有同 case 的 setup/navigation 动作"——则整份 Hylyre 计划不启动，并回报该 TC 的根因与下一责任阶段。
- **`manual` 不能关质量门**：它表示"该测试义务当前没有机器证据载体"，会持续留在分母 FAIL/UNVERIFIED，**任一 manual TC 都会让本 feature 的 testing 无法 PASS**。这是冻结设计，不是执行器缺陷；框架不提供人工确认、`confirmed_by`、质量 receipt 或 manual resume 来关闭本轮质量门。
- **对账按通道精确**：derived/trace/timing 的精确集合只与 `channel=hylyre` 闭合，visual/manual/provider 的 TC 不再被误报成"缺 trace"；报告总分母仍覆盖全部顶层 TC。
- **迁移动作**：在顶层 `test-plan.md` 用例表末尾加一列「执行通道」，逐条填写并进入 plan review。改动任一 TC 的通道都会改变计划 identity，不得在派生或回灌时静默重写。

## selector 静态门恢复开放世界语义（3.0.0）

feature ui-spec 只建模本 feature 新增的页面，首页/卡包/添加卡片等既有入口天然缺席。因此 selector **不在 ui-spec 只给 provenance WARN 并放行**，最终合法性由本轮真机 StepResult 的 selector evidence 裁决。

静态 BLOCKER 收窄为可确定错误：非法 selector/match、正式 `by_text` 缺显式 `match: exact|contains`、ui-spec 已证明的同屏多映射无消歧、`contains` 只命中带 children 的聚合 Text/Row，以及同一 acceptance checkpoint 结构化绑定的 `target_element_id` 与计划 `by_id` 明确不等。框架**不会**把 ui-spec、acceptance 与 contracts 合成第二套 canonical selector registry，也不从散文抽取目标 ID。

---

## goal 无头假 PASS 事故链根治（goal-fakepass-hardening）——四项 Breaking

> 立项动因：bc-openCard 事故（goal 无头链绿灯放行严重残次品）。openspec change
> `goal-fakepass-hardening`；plan e3a9c5d1。

1. **review closure attestation 无 grace window**：check-testing 新 BLOCKER
   `review_closure_attestation`——存量 feature 首次跑新版 testing 前**必须补跑一次
   review 闭环**（`check-receipt --phase review` 通过时自动生成
   `review/reports/review-closure-attestation.json`）。review 后任何产品源码变更（含
   contracts 未登记的新文件/新模块）→ testing FAIL，回跑 review 重审。
2. **goal run 状态枚举重命名**：成功侧不再产出裸 `COMPLETED`——新枚举
   `CHAIN_SLICE_COMPLETED`（仅链切片语义）/
   `DEFERRED_CAPABILITY_MISSING`（强 1:1 意图+缺视觉能力 preflight 终态）。feature 级完成
   只认 `verify-feature-completion`（goal-status 尾行 `feature_status=`）——旧 run 的
   `COMPLETED` 与 `AWAITING_HUMAN_REVIEW` 事件仅保留读取兼容，新 writer 不再生成。
3. **headless 决议账本改 JSONL**：goal 环境阶段闭环强制
   `<phase>/headless-assumptions.jsonl`（schema + registry 完整性 BLOCKER 校验，见
   user-confirmation-ux §9.3）；markdown 降为人读投影。
4. **P0 AC 结构化 checkpoint 强制**：存在 P0 device 交互 AC 的 feature，acceptance.yaml
   须声明 `flows`（有序屏链）与逐 AC `checkpoint`/`requirement_ref`（源片段 sha256 验存）
   ——存量 feature 重跑 spec 时须补齐（check-spec `acceptance_flow_structure` BLOCKER）。
   P0 用例 skip 继续 fail-closed：旧 `p0_skip_waiver` confirmation receipt 只读且不 gate。
   （下面这段 explicit-skip 口径已被 3.0.0 的「顶层测试计划新增 `execution_channel`」一节取代，
   仅保留为历史记录：）~~缺口属于既有 `explicit_skip_tc_ids` 登记时，
   testing 保持 FAIL，但会产出 coding repair candidate，由 goal 回退 coding 修复并重测。~~
   **3.0.0 现行口径**：新计划与派生器禁止写 `explicit_skip_tc_ids`（登记即 BLOCKER），历史登记
   仅只读诊断——保持 testing FAIL 且**零自动 coding candidate**。
   status 为空或未经登记的 trace skip 留在 testing 恢复执行；只有带机器 blocked/failed
   `capability`/`infrastructure` 事实（`outcome.cause` 或 `outcome.failure`）或
   `blocking_class` 信号的外部阻塞才走既有 DEFERRED。
   `await_human_p0_skip` 主动首触 halt 已退役，仅保留历史事件读取兼容。
   此外，每条 `ut_layer=device|both` 的 P0 AC 必须由至少一条 P0 TC 覆盖；把相关 TC
   降为 P1/P2 会由既有 `acceptance_to_test_case` 原地 BLOCKER，不得借降档退出 P0 分母。
   真机命令含 `--skip-assert-expected` 时，报告用例表仍须忠实投影 trace 的逐条状态，
   但测试结论只能声明「不达标」或「有条件达标」，不得声明「达标」。

配套：旧 confirmation receipt/trust registry/credential issuance 机制已退役；安全、法律、密钥、
付款、发布等真正外部权限仍走各自的 external authorization 边界，但不能改写质量事实。

---

## 盲宿主视觉根治（blind-visual-hardening）——四项 Breaking

> 立项动因：bc-openCard 二轮事故（盲宿主线框级 UI 全绿交付「达标可发布」）。openspec change
> `blind-visual-hardening`；plan a9d4c7e2（codex/cursor 四轮 review 定稿）。

1. **负面产品裁决从此阻断闭环与推进**：review 结论「不通过」/testing 结论「不达标」→ 该
   phase BLOCKER FAIL（`negative_verdict_closure`）；下游 phase 启动即消费上游 summary
   机器裁决（`upstream_verdict_gate`：verdict 非 PASS/blocker 未清/证据 stale → BLOCKER）。
   存量 feature 若带未闭环的「不通过」报告，重跑对应上游阶段前不得推进。四个 phase-rules
   yaml 已登记新门禁 → **gate_fingerprint 变更，存量回执按 stale 治理重跑**（预期行为）。
2. **summary schema 1.1**：新增 `report_validity`（报告合法性，独立于产品裁决）+
   `quality_axes`（functional/visual/asset/evidence 四轴对象化，harness 派生非 agent 自报）+
   `release_readiness`/`completion_status` 投影。1.0 summary 兼容读取，但**不作 1.1
   feature-completion 干净依据**（`summary_schema_current` needs_fix——须当前 gate_fingerprint
   下重跑，防历史假 PASS 重入新状态机）。visual/asset 轴 UNVERIFIED（如盲档视觉未验真）
   → `release_readiness=BLOCKED`；可靠能力缺失时投影 capability-missing/deferred，能力具备但证据
   缺失或无效时 FAIL/回修。legacy `human_visual_acceptance` 不再清偿视觉债务，用户反馈进入
   correction/successor run 并由机器证据重验。
3. **盲档素材纪律升级**：`effective_image_input=none` 时 `acquisition: crop` 须满足可信
   消费态（resolved_path + source/bbox/tool/hash provenance 并可确定性复算）否则 spec BLOCKER
   （`blind_crop_prohibition`）；物化进模块 media 的 brand-critical 素材空白/纯色/损坏 →
   coding BLOCKER **档位无关**（`asset_materialization_sanity`）；占位必须为可见语义占位
   （text_avatar/插画框/SymbolGlyph），空白 PNG 一律非法。素材缺供给走 `spec/asset-request.md`
   问人清单（registry `vision.asset_request`）。
4. **UI 需求 spec 前置意图闸扩面**：逐阶段驱动路径（非 goal preflight）同样执行档位三态
   检测（`fidelity_capability_pregate`）——强 pixel 意图+盲模型 → capability defer，出路是配置
   可用 provider 或以新 requirement/correction 改变目标；不能用 receipt 降档。含混意图按冻结输入和
   确定性默认策略解析，不再设置 `vision.blind_tier` 人签动线。

新增非 breaking 能力：视觉债务 SSOT（visual-debt.json+md，open/closed/accepted 三态审计
分立）；确定性视觉反馈（visual-feedback.json，两类信号分立，盲模型的"文本化眼睛"）；
设备渲染可见性 calibrate 观察节点（enforce 升级待实测回灌）。
宿主复验规程见 `docs/operations/blind-host-replay-runbook.md`。

> **⚠ 上述批次曾引入的「盲档可实例化 UI kit」已于 3.0.0 收口前整体撤销**，见下节。


### 3.0.0：撤销强制 Maison UI kit（Breaking，plan e6b3f8d2 t3）

**为什么撤销**：宿主 run 20260825T011950Z-eddfb2 实锤——framework 把一套具体 ArkUI 组件
实现升级成了**强制产品契约**，并要求宿主在 `framework.config.json` 里指定 vendoring 落点。
对守规 agent 这是结构性不可满足：spec 强制声明 kit block、plan 冻结的 contracts 不含 kit、
coding 只读 contracts —— 不 scaffold 就判「未物化」、scaffold 就判「越界」，双输烧尽重试预算。
**产品组件归属唯一归宿主：framework 不得规定宿主源码形态。**

1. **删除的机制**（这些能力/配置/入口不再存在）：
   - `profiles/hmos-app/ui-kit/**`（九个 ArkUI 组件模板 + block 清单）与 scaffolder、
     三段闭环 check、实例锚点模块及其单测；
   - `framework.config.json` 的 `paths` 下 **kit 目标目录配置项**与其四级解析
     （显式配置 → common 层推导 → architecture 推导 → halt）。**存量配置里该键留着无害
     （多余键不报错），但已完全不被读取，建议删除**；
   - ui-spec 组件节点的 `block` 字段（**schema 已删除：继续声明会被判非法字段**）；
   - 全部 `ui_kit_*` check id 与 `ui_kit_conformance` blocking class；
   - 真机缺陷的**锚点漂移**分类（历史 evidence 里的该分类字符串读侧仍可解析，但不再驱动回修）。
2. **selector 契约回归裸 ui-spec 节点**：测试计划的 `by_id` 必须是 ui-spec 声明的
   **组件节点 id**、`by_text` 必须与 ui-spec `text` 精确等值。`maison:<feature>:<screen>:<node>`
   实例锚点语法与其后缀契约已删除。
   **存量影响**：带 `maison:` 前缀 selector 的测试计划、以及产品代码里注入的同款元素 id，
   **须按 ui-spec 节点 id 重新生成**；不重新生成的条目会被判 `test_contract`
   （selector 无 spec 依据），不会被误判成产品缺陷。
3. **页面身份判据换源（行为等价，精度边界更明确）**：视觉采集判断「应用错页」不再靠
   `maison:` 组件 id 前缀，改为复用既有 `visual-diff-nav` 的 **screen identity 声明**：
   只取各屏 `all_of`/`any_of` 的**正向 id**、按**精确 id** 判在场（`none_of` 不作所有权
   证明——它只是「目标页禁入锚点」，不保证该锚属于本应用）。三态语义冻结：目标屏正向 id
   命中=`matched`；目标未命中但**其他已确认屏**（`proposed=false`）正向 id 命中=
   `mismatched`（确定性错页）；`proposed=true` 的未确认候选不作应用页面所有权证据。系统树
   无任何已确认 id（或工程只声明了 text/route）=`probe_failed`（证据不足，不作内容
   正证据）。**建议**：给每个 P0/golden 目标屏都配至少一个 id 锚点，否则错页只能判 probe_failed。
4. **盲档结构地板改由「产品组件所有权链」承接，并收紧为硬地板**：
   ui-spec P0 节点 → `plan/visual-parity.yaml` 的 `components[].contract_component` →
   `contracts.yaml` 的 `components[].name` → 该组件 `file` ∈ `contracts.files`。
   这三项**不受 `coding.visual_parity_enforcement=warn|reachable|off` 降级**
   （复用既有 `visual_parity_coverage`，不新增 check id）：
   - P0 节点缺 `contract_component` → BLOCKER FAIL（含 `enforcement=off`）；
   - P0 mapping 引用的组件在 `contracts.components` 中不存在 → BLOCKER FAIL
     （数组为空时自然无法满足；旧实现反而跳过存在性检查）；
   - P0 mapping 引用组件的 `file` 未列入 `contracts.files` → BLOCKER FAIL。
   非 P0 mapping 与 assets/tokens/结构相似度等**视觉质量项照旧遵守 enforcement**。
   **存量影响**：默认 `warn` 的宿主若此前只写了 P0 节点却没做组件映射，plan 阶段会开始
   BLOCKER——补齐 visual-parity/contracts 映射即可，framework 不规定组件如何实现。
5. **npm script 改名**：`ui-kit:placeholders` → **`asset:placeholders`**
   （素材占位能力保留、与 kit 解耦）；`ui-kit:scaffold` 删除。
6. **保留**：`nav_bar` / `list_row` / `sheet_scaffold` 等词继续作为 ui-spec 的**通用结构
   语义 `type`**，不绑定任何具体组件实现。


---

## Goal run 出生与基线统一（3.0.0）

- 新 run 必须同时具有 `manifest.json` 与唯一 `run_created`；manifest-only/重复或损坏出生事件
  现在判 `CREATION_INCOMPLETE`，不可 resume/attach/supervisor 接管，但不占用同 feature 的
  HALTED/PARTIAL successor 位置。
- 含 `coding`/`ut` 的 chain 在出生时冻结 `manifest.run_base_sha`。goal UI/UT 门禁不再读取
  `HARNESS_DIFF_BASE_REF`；旧 `coding-base.json` 只给没有 `run_created` 的合法 legacy run 读取。
- `run_base_sha` 同 run 不可 override/rebase。自动 successor 继承 lineage baseline；祖先无可信
  基线时须由操作者在 goal runtime 外显式执行
  `--supersede <old-run-id> --rebaseline-to <当前 exact HEAD>` 创建新问责边界。
- 旧 run 无需回填 `run_created` 或 `run_base_sha`，resume 也不会自动补造。若 legacy anchor 已损坏，
  请保留证据并走显式 rebaseline successor，不要编辑旧 manifest/events 洗白。

---

## 视觉闭环二期（visual-capability-truth）——Breaking（随切片滚动登记）

> 立项动因：20260718 宿主 goal run 首次实测——治理层全生效但能力误判/真机基建/回退编排
> 五层新缺陷。openspec change `visual-capability-truth`；plan e9c4a7f3（codex 五轮 review 冻结）。

1. **visual-diff-nav schema 2.0（S2）**：新格式 `{schema_version:"2.0", screens:{<id>:{steps,
   identity}}}`；旧顶层数组格式**兼容可读**（steps-only），写回一律 2.0。`identity` 为页面
   身份锚点（`all_of`/`any_of`/`none_of`，成员 text/id/route；最低强度=≥2 独特文本或 1 个
   强 id/route）。**pixel_1to1 的 P0 屏缺已确认 identity → `visual_diff_capture` BLOCKER
   FAIL**（`proposed: true` 的自动候选不作数——须人工核对后置 false）。迁移/候选生成：
   `cd framework/harness && npm run visual-diff-nav:migrate -- --project-root <宿主根>
   --feature <f> [--apply]`。采集顺序变更：navigate → dump uitree → identity gate →
   screenshot——身份不匹配记 `screen_identity_mismatch`，截图归档 `_mismatch/` 不进正式
   目录、不计 captured（错误页面从此进不了视觉流水线）。
2. **hylyre 中文 UTF-8 round-trip 前置（S2）**：`ensureHylyreReady` 新增真实链路中文
   round-trip（steps→hylyre parser→predicate→stdout 回读逐字符比对），失败 → device
   testing 前置 BLOCKER（toolchain 类）。spawn 链恒注入 `PYTHONUTF8=1`+
   `PYTHONIOENCODING=utf-8`（修复 Windows 下诊断日志中文变 `����` 的管道假象）。
3. **`vl_multimodal` 终签硬化（S3）**：`verified: verified / verified_method: vl_multimodal`
   从此要求信任链齐备——runner 签发的 invocation_bound capability receipt（inline canary
   路径 B）+ 参考图逐张验读回执（结构化工具事件，无解析器 adapter **结构性不可签**）+
   attestation 非 contradicted/evidence_gap；goal 态两张回执还须**属当前 invocation**
   （`MAISON_GOAL_ATTEMPT` 精确匹配——旧 attempt 的互洽回执对不可为本 attempt 产物终签）。
   存量自签 vl_multimodal 在下次 spec harness
   即被拒（出路：有 provenance 能力的 adapter 重签，或按 capability-missing/deferred 诚实投影；
   legacy `human_confirmed` 不再放行）。新增 spec 检查 `vision_output_counterevidence`（U+FFFD 等强证据 →
   BLOCKER + blind-safe 策略降级；缺证 → WARN 同样使签名失效；`source_ref` 须解析到
   已知 reference id 才算映射；**反证缺席最多记 `unverified_clean`——verified attestation
   须正向 provenance（OCR 流在场且全部 UI 文本正向匹配参考文本）+ 终签链全绑定共同铸造**，
   blind-safe 降级的解除仅认 runner supersede 事件（时间在后）或正向验证成立的新 hash
   verified）。终签消费端同步收紧：attestation 必须 verified（unverified_clean 不可签）、
   effective policy 必须 visual、两张回执 invoke **精确等于** `spec-<attempt>` 且带 **runner
   事件锚**（runner 每个 spec invocation 结束后清理并重签发回执，文件 sha256 写入 goal-run
   事件；无事件锚/hash 失配的回执一律拒——agent 伪造回执文件不再可行）、refs 回执须逐张
   覆盖**当前** authoritative 参考图（hash 核对；无参考图=无验证对象不可签）。
4. **goal 态源码变更责任链（S4，3.0.0 替代旧授权链）**：ut/testing 不拥有产品源码；
   发现实际改写时，runner 记录路径、owner 与 pre/post hash，作废本 invocation 及旧 closure，
   保留字节为未受信输入并自动 `backtrack_to_phase:coding` 全量重验。旧 confirmation receipt、
   runner policy、`manifest.pre_authorized_mutations` 或 agent 自写 `approved_by` 均不能把非 owner
   写入洗白；删除文件同样按 write violation 处理。只有重复/不稳定改写、不可读或预算/指纹
   熔断才诚实终止，人工 resume 不重置质量结论。
5. **goal 态 visual ledger 单写者（S5）**：agent 自跑 harness 不再直写
   visual-rounds ledger（写 `goal-runs/<runId>/intermediate-rounds.journal.jsonl`
   proposal——**按 goal run 隔离**，attempt 序号跨 run 重号不再互相污染；runner 顺序
   重放重算后收编；`disposition: journaled` 新枚举）；交互态直写不变。attempt 内中途
   重跑 harness 不再产生孤儿行误熔断（20260718 halt 直接触发器根治）。
6. **vision 信任状态退役（当前版本）**：
   `vision/artifact-attestations.jsonl`、`vision/policy-downgrades.jsonl` 及其 hash-chain、
   supersede、迁移、checkpoint/head/HWM、`vision_lineage` 已全部退出运行时。升级宿主
   **无需迁移或清理**；旧文件即使损坏也不会再被读取、写入或影响路由/恢复。当前视觉能力
   只看本次 probe/capability receipt，`vl_multimodal` 只核本次 capability/reference receipts
   与当次反证结果。旧文件可按普通无消费者文件人工删除。

---

## device visual-diff 缺陷枚举契约（round2）

`visual-diff.json` 每屏新增可选 `defects[]`（正向渲染缺陷枚举：`clipping`|`overlap`|`shape_mismatch`|`missing_render`|`other` + `bbox` + `severity` + `note`）与采集层自动写入的 `edge_tile_divergence`/`edge_over_threshold_tiles`。

- **pass 契约**：`verdict=pass` 屏不得含 blocker/major defect（含则 pixel_1to1 FAIL、否则 WARN）。
- **pixel_1to1 须逐屏枚举**：finalized verdict 的 `defects` 缺失（`undefined`）在 pixel_1to1 下判 **BLOCKER/FAIL**（补 `defects[]`、确无缺陷写 `[]` 即解除），与既有 `reverse_missing` 对称——**消费者旧 `visual-diff.json` 在 pixel_1to1 下会硬挂，须重跑 device-testing（采集层重写 + VL 逐屏枚举 defects）或手动补 `defects[]`**。非 pixel_1to1 不受影响。
- **边缘哨兵**：采集层对 ref/shot 算结构散度，超阈 tile 未被 `defect.bbox` 覆盖且达地板 → WARN（低置信、永不 gate）；若属误报可补对应 `missing_render` defect 的 bbox 或复核该区域。

---

## 把 framework 发布件集成到目标工程

Maison 只交付已经过 pack/release verify 的 `framework-<semver>.zip`。在目标工程根解压，得到 `<repo-root>/framework/`；升级时用新发布件镜像覆盖旧目录。不要从源仓直接挑文件复制，也不要采用第二种 Git 布局。

集成完成后，在工程根跑 **`/framework-init`**（S1–S4 编排）。mechanism 任务在 **S3 批准后**由 executor 执行。宿主的 SCM 状态与配置都不参与 init/catalog/其它 phase 裁决：init **不读取、不诊断、不创建、也不修改**宿主 `.gitignore`，也不从 SCM 历史恢复 `framework.config.json`。

| 阶段 | 做的事 |
|------|--------|
| **S1** | 只读 `InitTaskPlan`（`init-orchestrate.ts --scope project`） |
| **S2** | 确认元数据 / 架构 DSL / **`materialized_adapters` 多选**；生成 decision + context JSON |
| **S3** | executor：config merge/写入、adapter 物化、harness-install、全局 phase 等 |
| **S4** | 结构化摘要 + 提醒团队成员跑 **`check-personal-setup --json --ensure（阶段前置门控）`** |

**严禁**：

- 在 S1 探测阶段写 adapter 产物 / config（副作用仅在 S3）。
- 在项目 init 里配置 personal `agent_adapter` 或 DevEco 路径（走 setup → `framework.local.json`）。
- 用 legacy **Q1=y / Step 0.3.4** 文本协议代替 registry widget（已废弃）。
- 把 S3 `run-global-phases` 失败解释为「环境问题」跳过——全局 phase 不依赖外部工具链，失败说明发布件集成不完整、init 未完成或 framework bug。

---

## 本文件与「实例侧迁移说明」的关系

**本 `MIGRATION.md` 留在发布件 `framework/` 内**，供所有接入工程只读参考。

若初始化 Skill 在实例根生成「迁移备忘」或「与当前 config 对齐的检查清单」，那是**针对该工程当前状态**的一次性产物，**不替代**本文的通用约定；二者冲突时以 **Skill 流程 + `framework.config.json` + harness 实际校验** 为准。

---

## 版本变更记录

### 宿主运行边界真值（Windows CLI 选择 · requirement 来源 · 视觉证据可达 · CodeAgent 放行 · v3.0.0）

**适用范围**：升级到修复三次宿主 run（0.138 模型兼容 400 / guardian error 5 / inline canary 误拒签）并放行 CodeAgent 的 framework 版本。

**行为摘要（非破坏性为主，一个可选新字段）**：

1. **Windows 无头 CLI 选择真值**：解析器不再跨 PATH 目录全局偏好 `.exe`；按 `where.exe`/PATH 目录原顺序取首个明确受支持且可 spawn 的形态（`.cmd/.bat` 经 cross-spawn；无扩展名文件必须为原生 PE（MZ）头像，POSIX/ELF shim 不再仅凭存在入选）。若此前依赖“后置 `.exe` 胜出”，实际执行身份可能变化——以 `adapter_probe` 事件的 `resolved_binary` 字段为准核对。
2. **probe/invoke 同一绝对路径**：adapter version probe、视觉金丝雀与正式 phase invoke 复用同一 session 解析结果；`adapter_probe` 事件新增 `resolved_binary` / `resolved_binary_kind` / `shadowed_candidates`（诊断）。旧 CSV/报告解析器如按旧字段消费不受影响（仅新增字段）。
3. **正式 phase invoke 硬失败早停**：child spawn race、guardian containment 建立失败（CreateProcess/Assign/Resume，`[maison-guardian]` + ASCII marker 绑定投影为 `spawn_error`）、CLI/config 参数不兼容、Codex 结构化 `status=400 + invalid_request_error + requires a newer version of Codex`，命中即 `phase_halt(adapter_cli_hard_failure)`（external，零内容 retry、不跑 harness、不伪归因 `spec_file_exists`）。普通内容失败（含无 guardian 诊断的 exit 2）行为不变。
4. **`--requirement-file` 来源保留（新增可选 manifest 字段）**：fresh manifest 新增可选 `requirement_source_files`（项目根相对列表），条件纳入身份哈希；resume 只读冻结值；successor 继承并在显式 file 增量时去重追加。**旧 manifest 无该字段不受影响**（身份哈希条件包含，resume 不误判漂移）。参考图发现改为单一共享集合：需求正文显式图片 ∪ 项目内来源文件直接父目录一层图片（canonical 去重排序），仅并集为空才回退 `ux-reference/`；capability/OCR 预扫/prompt/refs receipt 生产与验证共用同一分母，spec 漏声明任一发现图片将 FAIL。
5. **fidelity-intent SSOT 可选 `requirement_source_files`**：旧 doc 缺字段按 legacy 兼容（不判 corrupt）；在场须为字符串数组。
6. **inline canary 判卷统一 SSOT**：结构化 adapter 读纯 `agent-events.jsonl` 终态、非结构化 adapter 只消费本次 invoke 的 stdout 与退出事实（不再读含 prompt echo 的混合 `agent-output.log`）；能力与可审计性分轴——`tool_event_provenance=none`（如 Codex）即使 canary=tool_read 也不得签 refs receipt/`vl_multimodal`，产物诚实写 `verified: unverified`（best-effort WARN 可继续、hard contract FAIL，门槛不降）。
7. **CodeAgent 放行**：headless 全权限支持集加入 `codeagent`（复用 `--dangerously-skip-permissions`/stdin/stream-json/Read parser）；Chrys 保持拒绝。真实 CLI flag 错误由统一 hard-CLI 早停承接。

**实例升级 checklist**：

1. 升级 framework 后重跑 goal 前，可在 dry-run 观察 `adapter_probe.resolved_binary` 确认 Windows 下实际选中的 CLI 形态与预期一致（多版本共存合法，PATH 首选项即执行身份）。
2. 若使用 `--requirement-file`，新 run 的 manifest 会多出 `requirement_source_files`；**不要手工删除**——它是参考图发现的锚点（来源文件直接父目录一层）。
3. CodeAgent 首次接入建议先 `codeagentcli --help` 记录版本，再做最短 Goal-mode smoke；如遇真实 unknown flag，请保留 stderr 证据（框架会一次停机并据实追加签名，不预猜）。
4. 旧 run `--resume` 无需迁移：无 `requirement_source_files` 字段时发现语义回退到旧两级输入（正文显式路径 + ux-reference 回退），行为不变。

### Skill 层 scope 重构（`project/` + `feature/` · 去数字前缀 · v2.3.0）

**适用范围**：升级到根 `skills/` 按生命周期 scope 分 `project/` / `feature/`、逻辑 skill-id 保持扁平 slug 的 framework 版本。

**行为摘要（BREAKING）**：

旧编号目录（编号前缀形态）已全部扁平化；现行物理 layout 为 `skills/project/{framework-init,catalog-bootstrap}` + `skills/feature/{spec,plan,coding,code-review,business-ut,device-testing}`，逻辑 skill-id 为扁平 slug。详见下方语义 alias 与 [`skills/skills.index.yaml`](skills/skills.index.yaml)。

**现行物理路径（源）**：

| scope | 路径 | 逻辑 skill-id |
|-------|------|---------------|
| project | `skills/project/framework-init/` | `framework-init` |
| project | `skills/project/catalog-bootstrap/` | `catalog-bootstrap` |
| feature | `skills/feature/spec/` … `device-testing/` | `spec` … `device-testing` |

**实例根跳板（物化目录/文件，扁平 id）**：`.cursor/skills/{framework-init,catalog-bootstrap,spec,…}/`、`.claude/commands/{spec,plan,…}.md`、`.agents/skills/{coding,…}/` 等；不再生成编号形态旧目录。

**registry `skill:` 值**：`confirmation-registry.yaml` 全部改为扁平 id；`setup.adapter` / `setup.deveco_path` 的 `skill:` 迁到虚拟 `_personal_setup`（无独立 SKILL 目录）。

**SSOT**：`skills/skills.index.yaml` + harness `resolveSkillPath(id)` 为唯一 id→物理路径解析入口。

**实例升级 checklist**：

1. 集成含本重构的 Maison 已验证发布件。
2. 工程根跑 **`/framework-init` UPDATE**（S1→S4），物化**新扁平跳板名**与 inline 链接。
3. **UPDATE init 自动清理**残留旧跳板（实例根仍使用编号形态或语义旧名 prd-design、requirement-design 等的遗留目录/文件；**不删**现行扁平跳板 spec / plan / coding 等）；删除前备份至 `.framework-backup/<timestamp>/`，可按需回滚。CREATE 模式不删除。
4. profile `skill-assets.yaml` 与扩展 skill 引用改为扁平 slug。
5. **profile 镜像路径保持扁平**：`profiles/<profile>/skills/<skill-id>/`（**不得**含 `project/` 或 `feature/` 嵌套）。

---

### Init 编排化重构（两条入口 · `materialized_adapters` + `framework.local.json`）

**适用范围**：升级到含 `init-orchestrate.ts` / `init-task-planner.ts` 的 framework 版本；实例仍用 legacy 单文件 config（含 `agent_adapter`、project 级 DevEco 路径）。

**行为摘要（BREAKING 面向实例维护者）**：

| 旧 | 新 |
|----|-----|
| 项目 init 选单个 `agent_adapter` | 项目 init 选 **`materialized_adapters[]`**（可多选 claude/cursor/generic） |
| `framework.config.json` 含 `agent_adapter` | 外迁到 **`framework.local.json`**（个人级本地配置） |
| project config 写 `toolchain.devEcoStudio.installPath` | 外迁到 **local**；hmos-app 走 **`check-personal-setup --json --ensure（阶段前置门控）`** + `setup.deveco_path` |
| Step 0.3.4 **Q1=y** 文本 | **`init.task_plan` + `init.task_decision`** widget |
| `check-init` 探测时写 gitignore | 已整体退场：init 不再读写宿主 `.gitignore`（3.0.0） |

**实例升级 checklist**：

1. 集成含编排器的 Maison 已验证发布件。
2. 工程根跑 **`/framework-init` UPDATE**（S1→S4）；S2 确认 `materialized_adapters` 覆盖团队使用的 IDE。
3. S3 应执行 **`migrate-config`**（若 planner 挂载）：自动把 legacy `agent_adapter` / DevEco 路径外迁，并在 project config 写入 `materialized_adapters`。
4. **每位开发者**跑一次 **`check-personal-setup --json --ensure（阶段前置门控）`**，确认 personal `agent_adapter`（仅能从已物化列表选）。
5. `framework.local.json` 是个人级本地配置；是否忽略它由宿主自行在 `.gitignore` 决定（Maison 不代写）。
6. 跑 feature phase 前：`getFrameworkPersonalSetupStatus().source !== 'fallback'`（harness-runner 否则 exit 1）。

**CLI 速查（工程根）**：

```bash
# S1 探测（只读）
cd framework/harness && npx ts-node scripts/init-orchestrate.ts --scope project --project-root <repo-root>

# S3 执行（decision/context 由 Skill S2 写入 OS 临时目录，须绝对路径）
cd framework/harness && npx ts-node scripts/init-orchestrate.ts --scope project --project-root <repo-root> \
  --execute --decision-file "$TMPDIR/framework-init-<stamp>/decision.json" --context-file "$TMPDIR/framework-init-<stamp>/context.json"

# 个人 setup 探测
cd framework/harness && npx ts-node scripts/init-orchestrate.ts --scope personal --project-root <repo-root>
```

**回滚**：保留 `.framework-backup/<UTC>/` 下 config 备份；删除 `framework.local.json` 不会破坏已物化的 `.claude/` / `.cursor/` 产物。

---

### Feature-phase harness 报告外置（`paths.reports_dir_pattern`）

**适用范围**：已将 instance 升级到支持 `paths.reports_dir_pattern` 的 harness；希望 feature 维度脚本报告、`trace.json`、合并报告等与 `doc/features/<feature>/` 同树的工程。

**行为摘要**：

- **`paths.reports_dir_pattern`**（占位符 `<feature>`、`<phase>`）：解析为实例根下目录；推荐默认 **`doc/features/<feature>/<phase>/reports`**。
- **未配置**：harness **回退**写入 **`framework/harness/reports/<feature>/<phase>/`**（与 `_global/` 并存）。
- **`_global` 哨兵**：`init` / `catalog` / `glossary` / `docs` / `extensions` 等全局阶段始终在 **`framework/harness/reports/_global/<phase>/`**，不参与本重写规则。

**实例 checklist**：

1. 跑 `/framework-init` UPDATE；planner 若挂 **`confirm-fields` / `migrate-config`**，在 S2 用 registry 确认；S3 执行 `merge-framework-config` 写入 `paths.reports_dir_pattern`（**非手改 JSON**）。
2. 如需忽略新报告路径，宿主可自行在 `.gitignore` 增加 **`doc/features/*/*/reports/*`**（或等价宽泛规则），并保留 `framework/harness/reports/*` 以对齐全局阶段与遗留布局；这一步由宿主自行决定，init 不代写。
3. 如有历史产物在 `framework/harness/reports/<feature>/`，可选执行下文「Legacy 报告手动迁移」专节（init **不自动搬文件**）。

#### Legacy 报告手动迁移（opt-in · init S3 之后）

> init 只 modernize config，**不搬磁盘文件**。不迁也不影响新 harness 产出路径。

**路径对照**：

| Legacy | 新路径 |
|--------|--------|
| `framework/harness/reports/<feature>/<phase>/*` | `doc/features/<feature>/<phase>/reports/*` |

**不要搬**：`framework/harness/reports/_global/**`、`.gitkeep`

**回执提醒**：若 `phase-completion-receipt.md` 的 `trace_json.path` 仍指 legacy，迁移后需改路径或重跑闭环。

**单 feature 示例（PowerShell，工程根）**：

```powershell
$feature = "hwp-channel"
$legacyRoot = "framework/harness/reports/$feature"
foreach ($phaseDir in Get-ChildItem -LiteralPath $legacyRoot -Directory -ErrorAction SilentlyContinue) {
  $phase = $phaseDir.Name
  $dest = "doc/features/$feature/$phase/reports"
  New-Item -ItemType Directory -Force -Path $dest | Out-Null
  Get-ChildItem -LiteralPath $phaseDir.FullName -Force | ForEach-Object {
    $target = Join-Path $dest $_.Name
    if (Test-Path $target) { Write-Host "skip: $target" }
    else { Move-Item $_.FullName $target }
  }
}
```

#### 一次性搬迁（Bash）

在**仓库根**执行。跳过目录 `_global`；同名目标文件已存在则打印 `skip` 不覆盖。

```bash
#!/usr/bin/env bash
set -euo pipefail
REPORTS_ROOT="${1:-framework/harness/reports}"
FEATURES_ROOT="${2:-doc/features}"

[[ -d "$REPORTS_ROOT" ]] || { echo "missing dir: $REPORTS_ROOT"; exit 1; }

shopt -s nullglob dotglob
for feature_dir in "$REPORTS_ROOT"/*; do
  [[ -d "$feature_dir" ]] || continue
  feature="$(basename "$feature_dir")"
  [[ "$feature" == "_global" ]] && continue

  for phase_dir in "$feature_dir"/*; do
    [[ -d "$phase_dir" ]] || continue
    phase="$(basename "$phase_dir")"
    dest="$FEATURES_ROOT/$feature/$phase/reports"
    mkdir -p "$dest"

    for path in "$phase_dir"/*; do
      [[ -e "$path" ]] || continue
      base="$(basename "$path")"
      if [[ -e "$dest/$base" ]]; then
        echo "skip (exists): $dest/$base"
        continue
      fi
      mv "$path" "$dest/"
    done
  done
done
shopt -u nullglob dotglob
```

#### 一次性搬迁（PowerShell）

```powershell
param(
  [string]$ReportsRoot = "framework/harness/reports",
  [string]$FeaturesRoot = "doc/features"
)
if (-not (Test-Path -LiteralPath $ReportsRoot)) { throw "missing $ReportsRoot" }

Get-ChildItem -LiteralPath $ReportsRoot -Directory | ForEach-Object {
  $feature = $_.Name
  if ($feature -eq "_global") { return }

  Get-ChildItem -LiteralPath $_.FullName -Directory | ForEach-Object {
    $phase = $_.Name
    $dest = Join-Path $FeaturesRoot $feature | Join-Path -ChildPath $phase | Join-Path -ChildPath "reports"
    New-Item -ItemType Directory -Force -Path $dest | Out-Null

    Get-ChildItem -LiteralPath $_.FullName -Force | ForEach-Object {
      $target = Join-Path $dest $_.Name
      if (Test-Path -LiteralPath $target) {
        Write-Host "skip (exists): $target"
      } else {
        Move-Item -LiteralPath $_.FullName -Destination $target
      }
    }
    if (-not (Get-ChildItem -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue)) {
      Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue
    }
  }
  $featurePath = Join-Path $ReportsRoot $feature
  if (-not (Get-ChildItem -LiteralPath $featurePath -Force -ErrorAction SilentlyContinue)) {
    Remove-Item -LiteralPath $featurePath -Force -ErrorAction SilentlyContinue
  }
}
```

**回归**：搬迁后任选 feature 跑一次 `cd framework/harness && npx ts-node harness-runner.ts --phase ut --feature <name> --summary`，确认新报告落在 `doc/features/<feature>/ut/reports/`（或与自定义 pattern 一致）。

### v2.4：framework 自带文档体系 + `--phase docs` 新鲜度门禁

**触发原因**：v2.3 之前，framework 的对外讲解材料散落在实例工程的 `doc/` 下（如 `HarmonyOS-AI研发框架全景介绍.md` / `业务级UT策划.md` 等），随 framework 演进很容易过期且与实例工程语境耦合。v2.4 把这些材料吸纳回 framework 自身，并新增"自动检查文档新鲜度"的 harness 阶段。

**新增 / 调整**：

1. **新增目录 `framework/docs/`**：framework 的对外文档统一归口于此（不是给实例工程看的 README，而是给"接入 framework 的开发者 + 跨部门同事 + 决策者"看的长期演进材料）。子目录约定：
   - `framework/docs/overview.md` — 全景介绍
   - `framework/docs/skills/<n>-<skill-name>.md` — 每个 Skill 的对外讲解（独立于 `framework/skills/<id>/SKILL.md` 的操作步骤）
   - `framework/docs/concepts/*.md` — 跨 Skill 的核心理念（如 `terminology-guarding.md`）
   - `framework/docs/operations/*.md` — 操作手册（如 `harness-runbook.md`）
   - `framework/docs/evolution/` — 占位，未来放跨大版本演进笔记

2. **新增 `framework/docs/DOC_INVENTORY.yaml`**：声明每份对外文档"关心"哪些 framework 内部资产（SKILL.md / phase-rules / harness 脚本 / agent_adapter 模板等）。

3. **新增 `--phase docs` 全局阶段**：
   - 实现：`framework/harness/scripts/check-docs.ts` + `framework/harness/scripts/utils/doc-freshness.ts`
   - 规则：`framework/specs/phase-rules/docs-rules.yaml`
   - 行为：对 inventory 中每份 doc 取 git committer date，对其 `sources[]` 也取 git committer date；任一 source 在 doc 之后改动过 → 报 MAJOR `doc_freshness`（doc 可能已过期）；source 路径在仓库内不存在 → 报 MAJOR `source_paths_resolvable`。
   - 入口：`cd framework/harness && npx ts-node harness-runner.ts --phase docs`（无 `--feature`，与 `catalog` / `glossary` 同为全局阶段）。
   - **不阻塞 CI**：docs phase 设计上不引入 BLOCKER，最高 MAJOR；目的是提醒维护者，而不是卡住业务功能开发。

4. **新增 unit 套件 `tests/unit/doc-freshness.unit.test.ts`**：覆盖 inventory schema 解析、空 sources / 缺失 git history / 多源 stale 等多条分支；接入 `tests/run-unit.ts > SUITES`，`npm test` 自动跑。

5. **`Phase` 类型扩展**：`framework/harness/scripts/utils/types.ts` 的 `Phase` 联合类型新增 `'docs'`；`isGlobalPhase` 同步认领。`harness-runner.ts > VALID_PHASES` 与 `--list` 帮助文本同步更新。

**实例侧迁移要点**：

- 若实例工程的 `doc/` 下仍存有 v2.3 之前从 framework 同步过来的总览类文档（典型文件名：`HarmonyOS-AI研发框架全景介绍.md` / `业务级UT策划.md` / `Harness全链路验证说明.md` / `自然语言到技术模块-演进路线图.md`），**应在升级到 v2.4 后删除**——它们已被 `framework/docs/` 内的对应版本取代。
- 实例工程**自有的**文档（如功能 spec、plan、test-plan、PPT 复盘材料等）**不受影响**，照常留在 `doc/` 下。
- 集成发布件时，确认 `framework/docs/`（包括 `DOC_INVENTORY.yaml`）完整在场。
- 接入 v2.4 后跑一次 `npx ts-node harness-runner.ts --phase docs` 自检；若有 MAJOR，按 [`docs/operations/harness-runbook.md`](docs/operations/harness-runbook.md) §6.4 的对照表处理。

**回归方法**：
- `cd framework/harness && npm test` —— unit 套件应包含 `doc-freshness` 子项且全 PASS。
- `npx ts-node harness-runner.ts --phase docs` —— 主路烟雾，全 PASS 或仅显示已知 MAJOR（说明哪些 doc 该刷新）。
- **与 framework-init 的关系**：完整 `/framework-init` S3 含 `harness-install` 与 `run-global-phases`（catalog / glossary / docs）。用户**无需**在完整跑完初始化后再单独记两条命令自测；只有**未走 Skill 或只做了部分步骤**时，才需要手工补跑。

### v2.3：DevEco Studio 工具链识别 + ohosTest 装机闭环

**触发原因**：v2.2 落地的 `coding_hvigor_build` / `ut_hvigor_build` / `ut_hvigor_test` 三条 BLOCKER 在现代 DevEco Studio (≥ 5.0) 环境下全部以「未找到 hvigor」FAIL —— DevEco 5.0 起不再在工程根生成 `hvigorw.bat` 包装脚本，统一从安装目录调用 hvigor。v2.2 的「先看根 wrapper、再看 PATH」查找链全断。

**升级要点（实例侧需要做的事）**：

1. **DevEco 路径改走 personal setup（编排化重构后）**
   - 形态见 [framework/harness/config.ts](harness/config.ts) `ToolchainConfig`；写入 **`framework.local.json`**（个人级本地配置），**不在** project `framework.config.json`。
   - 推荐：团队成员跑 **`check-personal-setup --json --ensure（阶段前置门控）`**（framework-initb）；hmos-app 用 registry **`setup.deveco_path`** 确认探测候选。
   - 也可手工编辑 `framework.local.json` 后跑 `cd <repo-root> && npx ts-node framework/harness/scripts/detect-deveco.ts --path "<your-path>" --json` 验证（cwd 见 [skills/reference/harness-cli-cwd.md](skills/reference/harness-cli-cwd.md)）。

2. **`coding_hvigor_build` 改为项目级 `assembleApp`**：v2.2 是按 `contracts.modules` 逐个 `assembleHap`，遇到 HAR/HSP 库模块（无 `assembleHap` task）会假阳性。v2.3 改为一次跑 `hvigor assembleApp`（项目级 hook task），覆盖所有产物。**对实例无破坏**，行为更严格而已。

3. **`ut_hvigor_build` 改用 `genOnDeviceTestHap`**：v2.2 调的 `OhosTestCompileArkTS` 是 hvigor 内部 task，CLI 直接拒收。v2.3 改为 `genOnDeviceTestHap`（对外的 hook task），同时跑 ArkTS 编译 + 装包 + 签名。**对实例无破坏**。

4. **`ut_hvigor_test` 改走 hdc + aa test**：v2.2 的 `hvigor test` 在 HAR 库模块上直接报 `TestAbility.ets does not exist`。v2.3 改为 `genOnDeviceTestHap` 出包 → `hdc install -r` → `hdc shell aa test` → 解析 hypium `OHOS_REPORT_RESULT`。**对实例的影响**：以前没跑通过 `ut_hvigor_test` 的工程，v2.3 起才真正能跑通；前提是接好真机/模拟器并配好 `installPath`。

5. **失败诊断细化**：`ut_hvigor_test` 报告 details 会标 `失败阶段：metadata / hap_not_found / install / run / no_pass`，按标签快速定位。

6. **环境变量自动注入**：`hvigor-runner.ts` 会从 `installPath` 派生并注入 `DEVECO_SDK_HOME`、`JAVA_HOME`、`<installPath>/jbr/bin` 入 PATH（已存在的用户值不覆盖）。无须实例侧再单独配。

7. **三个文档默认动作的同步**（v2.2 的 hvigor 命令样例已过时）：
   - coding Step 6.5：编码阶段编译闭环改为「跑 harness `--phase coding` 触发 `coding_hvigor_build`」，不再让 agent 手敲 `hvigorw ...`。
   - business-ut Step 7.5 / 7.6：UT 编译 / 装机闭环同样改为「跑 harness `--phase ut`」，避免 agent 拼错 `hvigor test` 命令。
   - framework-init S3：`harness-install` + `run-global-phases` 含全局 phase；DevEco 路径见 **`check-personal-setup --json --ensure（阶段前置门控）`**（00b）。

**回归方法**：
- 全套：`cd framework/harness && npm test`（条数以 `tests/run-unit.ts` + `tests/run-tests.ts` 为准）。
- 端到端：在 home-page 上跑全 6 阶段 `harness-runner.ts --feature home-page --phase X`，要求真机在线。

### v2.5：workflow、extensions 元阶段、lifecycle hooks、instance_skill_bridge（当前）

适用：已集成包含 `framework/workflows/`、`extension-loader`、`hooks-dispatcher`、`check-extensions` 与 adapter `instance_skill_bridge` 的 Maison 发布件。

**建议在实例 `framework.config.json`（UPDATE diff 确认）补齐：**

| 字段 | 说明 |
|------|------|
| `schema_version` | `"1.1"`（与 `framework/specs/framework.config.schema.json` 对齐） |
| `active_workflow` | 默认 `"spec-driven"` → `framework/workflows/spec-driven.workflow.yaml` |
| `lifecycle_hooks_enabled` | 默认 `true`；`false` 时 harness 跳过 lifecycle hook 派发 |
| `paths.extension_dir` | 默认 `"doc/extensions"` |

**升级后动作**：S3 执行补缺扩展目录骨架；在 **`<repo-root>`** 重新执行 `node framework/harness/scripts/render-agents-md.mjs ...` 刷新入口并按 adapter 生成扩展跳板 / slash（勿在 `framework/harness/` cwd 下写 `framework/harness/scripts/...` 前缀）；`cd framework/harness && npm test`。

> v3.1 起这些字段（含 `state_machine.*`、`paths.state_file` / `receipt_dir_pattern` / `docs_committed`、
> `toolchain.hvigor.*` 等）由 S3 `backfill-config` / merge-framework-config **机器化补缺合并**——见 §v3.1。

详见 [docs/concepts/extensibility.md](docs/concepts/extensibility.md) 与 [docs/evolution/extension-e2e-acceptance.md](docs/evolution/extension-e2e-acceptance.md)。

### v3.1：framework.config.json 字段级"只补缺、不覆盖"合并（merge-framework-config）

**触发原因**：v2.5 之前 framework-init §5.1 在 UPDATE 模式下只有「整文件替换 / 跳过」两档，
新版本 framework 引入新字段（如 `paths.extension_dir`、`paths.state_file`、`state_machine.*`、
`active_workflow`、`lifecycle_hooks_enabled`、`paths.docs_committed`、`toolchain.hvigor.*`）后，
老工程跑 `/framework-init` 无法机器化追平：选 Q1=y 会丢掉用户自定义的 `architecture` /
`project_name` 等字段；选 Q1=n 则新字段全漏。已观察到的真实事故：宿主工程 UPDATE 后仅补上
`project_profile` 单段，其它新字段全部缺失。

**升级后动作**（落在 framework 内，对实例**无破坏**）：

1. 新增 [scripts/utils/config-field-merger.ts](harness/scripts/utils/config-field-merger.ts)
   持有 `BACKFILL_FIELDS` 白名单（SSOT），定义"哪些字段允许在缺失时回填默认值"，
   默认值与 `harness/config.ts` 的 `DEFAULT_PATHS` / `DEFAULT_STATE_MACHINE` 单点对齐。
2. 新增 CLI 工具 [scripts/merge-framework-config.mjs](harness/scripts/merge-framework-config.mjs)：

   ```bash
   # 仅查看缺失字段与合并预览（不写盘）
   cd <repo-root> && node framework/harness/scripts/merge-framework-config.mjs --dry-run

   # 备份原文 → 字段级"只补缺、不覆盖"合并并写回
   cd <repo-root> && node framework/harness/scripts/merge-framework-config.mjs --apply
   ```

   `--apply` 会先把原 `framework.config.json` 备份到
   `<repo>/.framework-backup/<UTC>/framework.config.json`（与 adapter `auto_overwrite`
   机制同槽），再字段级合并写回。
3. `check-init.ts` 第 1 项（`inspect01`）在 POPULATED 时填充 `Inspection.missing_keys`，
   `stdout` 体检表的"诊断"列会追加一句「另有 N 个白名单字段缺失，建议跑
   `merge-framework-config.mjs --apply` 补齐」；`check-init.json` 携带完整字段路径列表。
4. **编排化后**：S1 planner / check-init 第 1 项在 POPULATED 时填充 `missing_keys`；S2 挂 `backfill-config` 任务，S3 executor 调用 merge（**取代** legacy 对话式补齐协议）。

**Framework 维护者侧**——后续若再引入新字段，**只需**：

1. 在 [harness/config.ts](harness/config.ts) `DEFAULT_PATHS` / `DEFAULT_STATE_MACHINE`（或同级常量）
   给出真实默认值；
2. 在 [scripts/utils/config-field-merger.ts](harness/scripts/utils/config-field-merger.ts) 的
   `BACKFILL_FIELDS` 数组追加一条 `{ path, defaultValue, note }`；
3. 在 [templates/framework.config.template.json](templates/framework.config.template.json) skeleton
   一并写入（保持 CREATE 模式与白名单同源）。

老工程下一次 `/framework-init` UPDATE 就会自动机器化追平，**无需**维护者再去 MIGRATION 里
逐条 checklist。

**严禁纳入 BACKFILL**（须 Skill 交互或 confirm pass）：`project_name` / `agent_adapter` /
`architecture.*`（必填）、personal DevEco 路径（**`check-personal-setup --json --ensure（阶段前置门控）`** → `framework.local.json`）、
`prd.*`（opt-in，需手工选 strict/warn/reachable/off 档位）、`atomic_service.*`（预留位）、
`paths.reports_dir_pattern`（行为级变更，经 S2 **`confirm-fields`** / registry 写入）。
legacy 顶层 `project_type` 由 **MIGRATION_RULES**（Pass 2）在 migrate-config 时 modernize。

### v3.3.2：init config 三 pass 同步（BACKFILL + MIGRATION + CONFIRM）

**适用范围**：framework 升级到含 `MIGRATION_RULES` / `CONFIRM_FIELDS` 的 harness 后，老实例
`/framework-init` UPDATE 须机器化 modernize `framework.config.json`，**不要求维护者手改 JSON**。

**三 pass 摘要**（SSOT：[config-field-merger.ts](harness/scripts/utils/config-field-merger.ts)）：

| Pass | 机制 | 典型字段 | init 入口（编排化） |
|------|------|----------|-----------|
| 1 BACKFILL | 只补缺失 key | `paths.state_file`、`state_machine.*`、`toolchain.hvigor.*` | S3 `backfill-config` |
| 2 MIGRATION | modernize 已有 key | `project_type` → `project_profile.sub_variant`；personal 外迁 | S3 `migrate-config` |
| 3 CONFIRM | 行为级变更 | （当前无；`paths.reports_dir_pattern` 已移入 BACKFILL） | — |

**`reports_dir_pattern` 默认值 SSOT**：`config.ts` → `DEFAULT_PATHS.reports_dir_pattern`（`normalizeConfig` 与 BACKFILL 自动注入；极旧磁盘 config 未配置时 `featurePhaseReportsDir` 仍回退 legacy `framework/harness/reports/`）。

1. 镜像覆盖新的 Maison 已验证发布件后跑 `/framework-init` UPDATE（S1→S4）。
2. S1 planner / check-init 查看 `missing_keys` / `migration_keys` / `confirm_keys`。
3. S2 批准 `backfill-config` / `migrate-config` / `confirm-fields` 决策。
4. S3 executor 写回 config（**非手改 JSON**）。
5. （可选）按上文「Legacy 报告手动迁移」搬迁旧报告文件。

**回归**：`cd framework/harness && npm test`（`config-field-merger` + `init-update-policy` 套件）。

**已纳入白名单（v2.x+，`tools.hylyre.*`）**：hmos-app device-testing 真机自动化配置。老实例缺
`tools` 段或缺任一子键时，`merge-framework-config.mjs --apply` 会按
`framework/harness/config.ts` 的 `DEFAULT_HYLYRE_TOOL_CONFIG` 补齐 7 个点分路径（与
`paths.state_file`、`toolchain.hvigor.*` 同级）。CREATE 模式还可由
`framework/profiles/hmos-app/config-defaults.json` 在 init 深度合并时带入整段 `tools.hylyre`。
已有 `hypium_page_name` 等定制值**不会被覆盖**。

**回归方法**：
- 单测：`cd framework/harness && npx ts-node tests/run-unit.ts`，包含
  `Suite [config-field-merger]` 10 用例 + `Suite [init-update-policy]` 的「inspect01 missing_keys」用例。
- 端到端：在缺字段的老工程上 `cd <repo-root> && node framework/harness/scripts/merge-framework-config.mjs --dry-run`
  查看缺失清单，再 `--apply` 验证写回内容（`git diff framework.config.json` 应仅新增白名单字段，
  不动 `architecture` / `project_name` 等敏感段）。

### adapter `update_policy` + `.framework-backup/`（实例侧 hooks/settings 等与 framework 对齐）

适用：已集成新的 Maison 发布件后，老实例的 Claude Code **`hooks`、`settings.json`、verifier 子 agent** 等仍停在旧版本，导致 `npm test`（hook 行为）或其它 harness 契约回归。

**行为摘要**：

- [adapter-schema.yaml](agents/adapter-schema.yaml) 各段可选 `update_policy`：`prompt_if_changed`（**缺省**）或 `auto_overwrite`。Claude adapter 已对 `hooks` / `settings_file` / `commands.subagents` 声明 **`auto_overwrite`**。
- [check-init.ts](harness/scripts/check-init.ts)：体检 **#3 逐文件展开**， stdout / `check-init.json` 中带 `update_policy` 列；`auto_overwrite` 且 POPULATED **不进入** S2 `init.task_decision`（由 S3 `sync-auto-overwrite:*` 自动对齐）。
- **编排化重构后**：机制对齐**不在** check-init PASS 时写盘；须在 S2 批准 S3 任务 `sync-auto-overwrite:*` / `materialize-adapter:<name>`，executor 备份至 `.framework-backup/<UTC>/` 后覆盖。
- `.framework-backup/` 是 init 的本地备份目录；宿主如需忽略它，自行在 `.gitignore` 登记（Maison 不代写）。

**实例 checklist**：

1. 更新 `framework/` 后在实例根重跑 **`/framework-init`** UPDATE（S1→S4），S1 只读产出最新体检表。
2. 若曾对机制文件做过**有意**本地补丁：S2 前阅 drift，或改用 patch 挂载到不会被覆盖的路径；对齐后从 `.framework-backup/<timestamp>/` 取回对比。

### v2.6：框架升级兼容协议（compat）+ context-exploration 回填

适用：framework 升级后为**既有 feature** 增加新的脚本 BLOCKER（典型：Context Exploration Gate）时，需要在**不修改**实例 `framework.config.json` / 不升全局 schema 的前提下完成过渡。

**核心原则**：

- **framework.config.json 不承载任何具体 feature 名或豁免状态**；不出现「compat 段」或 legacy feature 列表。
- **过程态落在 feature 目录**：`doc/features/<feature>/compat.yaml`（约定文件名）。删除/归档 feature 即删除 compat。
- **决策延后到撞墙**：仅当用户对某 `--feature <name> --phase <phase>` 跑 harness 失败时，报告与 suggestion 给出双路径：**回填脚本（推荐）** vs **compat 临时降级**。
- **framework-init**：零接触 compat（无 schema diff、无额外公告条目）。

**compat 行为概要**：

- harness 在写 `script-report.json` 前对 `CheckResult[]` 应用 `applyCompatDowngrade`；全局阶段（`init`/`catalog`/`glossary`/`docs`/`extensions`）与 `feature=_global` **短路**。
- 合法 compat 可将指定 `BLOCKER+FAIL` 降为 `MINOR+WARN`（并在报告增加 `compat_applied`）；`scheduled_backfill_by` 过期则注入 `compat_expired` BLOCKER。
- 字段 SSOT：`framework/specs/feature-compat.schema.yaml`；演进说明：`framework/docs/evolution/compat-protocol-v1.md`。

**回填脚本**：

```bash
cd framework/harness && npm run backfill:context -- --feature <name> --phases spec,plan,coding,review,ut [--dry-run] [--overwrite]
```

成功后若曾使用 compat，请手动删除对应 `compat.yaml`。退出码：`0` 成功，`2` 参数/门禁错误，`3` 存在已存在文件且未 `--overwrite` 的跳过项。

**回归**：`cd framework/harness && npm test`；`npx tsc --noEmit -p tsconfig.json`。

### v2.9：Karpathy 四原则全生命周期 + context-exploration schema 1.1.0

适用：framework 升级后引入 **Agent 行为规约**、Context Exploration **量化 BLOCKER**、verifier **行为审查维度**，以及 profile 级 `exploration-snippets` 宿主路径注入。

**核心变更**：

| 层级 | 资产 | 说明 |
|------|------|------|
| Layer 1 | `framework/skills/reference/agent-behavioral-principles.md` | Research First / Minimum Viable / Surgical / Verify — 各 Skill Research Sub-Phase 强制前读 |
| Layer 2 | `context-exploration.md` schema **1.1.0** | 新增 `source_code_paths` / `exploration_mode` / `decisions_unlocked` + 正文 **Code Facts** 必填段 |
| Layer 2 | `phase-rules/*.yaml` → `exploration_thresholds` | 各阶段差异化阈值（min_source_code_paths、min_code_facts、require_subagent_when_* 等） |
| Layer 2 | `context-exploration.ts` | schema 1.1.0 启用 BLOCKER 量化校验；1.0.0 仍走旧 frontmatter 关键词逻辑 |
| Layer 2 | `profiles/<profile>/harness/exploration-snippets.yaml` | 宿主必查路径 overlay（hmos-app：`.ets`、`module.json5`、`build-profile.json5` 等） |
| Layer 3 | `verify-*.md` | 新增 `behavior_research_grounded` / `behavior_minimum_viable` / `behavior_scope_surgical` / `behavior_verify_loop`；`context_exploration_sufficiency` 升为 BLOCKER |
| 流程 | spec–5 | Context Exploration Gate 升级为独立编号 **Research Sub-Phase** |
| 入口 | `AGENTS.md` / adapter rules | SSOT 表 + §3.7 Agent 行为规约 |

**向后兼容（迁移窗口）**：

- 既有 `context-exploration.md` 若 frontmatter 仍为 **`schema_version: "1.0.0"`**，harness 仅执行 v2.6 及以前的 frontmatter 关键词校验，**不强制**新字段。
- **新写入或主动升级**到 **`schema_version: "1.1.0"`** 的文件，须满足对应 phase 的 `exploration_thresholds`（yaml 未配置时 fallback 到脚本内宽松默认值）。
- 建议：新 feature 自 spec 起直接使用 1.1.0；既有 in-flight feature 可在下一 phase 升级，或继续 1.0.0 直至 feature 归档（不阻塞旧 harness PASS）。

**backfill 行为变更**：

```bash
cd framework/harness && npm run backfill:context -- --feature <name> --phases spec,plan,coding,review,ut [--dry-run] [--overwrite]
```

- 回填模板现为 **schema 1.1.0**，且 **`ready_to_produce: false`**（不再自动设 `true` 放行主产物）。
- 回填成功仅生成**待补全骨架**；须 agent 完成真实探索、填 Code Facts / source_code_paths 后手动设 `ready_to_produce: true`，再跑 harness。
- 脚本对骨架预期未过门禁时 **warn 而非 exit 2**（便于批量生成占位文件）；真正 BLOCKER 在用户/agent 跑 `--phase <phase> --feature <name>` 时触发。

**实例维护者动作**（集成新的 Maison 发布件后）：

1. 阅读 [agent-behavioral-principles.md](skills/reference/agent-behavioral-principles.md)（agent 会话级约束已写入 `AGENTS.md` §3.7）。
2. 可选：对 in-flight feature 的 `context-exploration.md` 升级到 1.1.0 并补全 Code Facts（或依赖 v2.6 compat 临时降级至过期日）。
3. hmos-app 实例：确认发布件包含 `framework/profiles/hmos-app/harness/exploration-snippets.yaml`；无需改 `framework.config.json`。
4. 重跑 `cd framework/harness && npm test`；对受影响 feature 重跑对应 `--phase` harness + verifier。

**零回归保证**：

- 未改 `framework.config.json` schema；compat 协议（v2.6）仍适用。
- verify 新增检查项不改变既有检查项语义；仅增加 fail 面。
- catalog-bootstrap / init 无额外步骤；render `/framework-init` UPDATE 可刷新 `AGENTS.md` / `.cursor/rules/framework.mdc` 中的 §3.7 引用。

**验证**：`cd framework/harness && npm test`；`npx tsc --noEmit -p tsconfig.json`。

### v2.10：exploration_strategy — default-on + 复合评分 + sequential 等价

适用：大型代码库（单模块 10 万+ LOC）下，原 `require_subagent_when_*` 单一计数阈值不足以触发深度探索。

**核心变更**：

| 机制 | 说明 |
|------|------|
| `exploration_strategy` | phase-rules 新段；与 `exploration_thresholds` 并存 |
| plan/coding **default-on** | 默认须 subagent；**L1 trivial**（rename/typo + loc<30 + 单层）可豁免 |
| spec/review/ut **scoring** | 复合评分（module_loc / scope / cross_layer / api_surface / fan_out），≥60 须 subagent |
| frontmatter 变更信号 | `change_intent` / `estimated_loc_delta` / `touches_layers` / `adds_new_exports` |
| sequential 等价 | 无 subagent 时用 `sequential`，量化阈值 × `sequential_multiplier`（默认 2.0） |
| `fan-out-scanner.ts` | 静态估算 in-scope 模块 import fan-out |

**向后兼容**：

- 无 `exploration_strategy` 段 → 回落 v2.9 `require_subagent_when_*` legacy 逻辑
- schema 1.1.0 不变；新 frontmatter 字段 optional（缺失时按非 trivial 处理）

**实例维护者**：

1. 集成发布件后确认 5 个 `phase-rules/*.yaml` 含 `exploration_strategy`
2. 新 feature 的 `context-exploration.md` 填写变更信号 frontmatter
3. plan/coding 默认 `exploration_mode: subagent`；Chrys/generic 用 sequential + 更高量化阈值

**验证**：`cd framework/harness && npm test`

### v3.2：用户确认 UX SSOT + 静态 lint

新增 [framework/skills/reference/user-confirmation-ux.md](skills/reference/user-confirmation-ux.md) 与 [confirmation-registry.yaml](skills/reference/confirmation-registry.yaml)。

**维护者约定**：新增或修改 Skill 中的用户确认步骤时：

1. 先在 `confirmation-registry.yaml` 登记 `id` / `interaction_class`；
2. Skill 正文只链 SSOT（≤10 行），使用 gate/enum/portable 编号；
3. 跑 `cd framework/harness && npm test` —— `check-docs` 阶段会执行 `check-skills-confirmation-ux` BLOCKER。

adapter 可选字段 `user_confirmation`（见 [agents/adapter-schema.yaml](agents/adapter-schema.yaml)）声明 widget 能力；chrys/codemate 等内部 agent 使用 `generic` + `structured_widget: unsupported`。

### v3.3：Claude Code AskUserQuestion（Track B+ · agents 为主）

**动机**：v3.2 在 skills 层写 portable 编号，但 Claude adapter 仅声明模糊的 `native_options`，运行时 agent 常只画 Markdown 表而不调 widget。

**framework 侧变更**（约 7～8 源文件）：

1. [agents/claude/adapter.yaml](agents/claude/adapter.yaml)：`widget_tool_hint: AskUserQuestion`；启用 `rules` → `.claude/rules/`。
2. 新建 [agents/claude/templates/rules/confirmation-ux.md](agents/claude/templates/rules/confirmation-ux.md)（SHOULD 级会话规则）。
3. [agents/claude/templates/commands/framework-init.md](agents/claude/templates/commands/framework-init.md)：`prompts` choice 前置 adapter；正文跳过 Step 0.2.5.1 表格。
4. framework-init **编排化后**：S2 用 registry `init.task_plan` / `init.materialized_adapters` / `init.task_decision`；personal setup 用 **`check-personal-setup --json --ensure（阶段前置门控）`** + `setup.*`（**已取代** legacy Step 0.3.4 / Q1=y）。

**实例维护者**（真实工程移植后）：

```text
/framework-init   # UPDATE；S1 只读体检 → S2 批准 → S3 物化/对齐 adapter 产物
check-personal-setup --json --ensure（阶段前置门控）  # 每位开发者一次；写入 framework.local.json
```

**版本依赖**：slash `prompts` frontmatter 需较新 Claude Code CLI（约 2026-02+）；旧 CLI 忽略 frontmatter 时仍靠 `.claude/rules` + framework-init BLOCKER + portable 编号。

**明确未改**：feature 六阶段 skill 正文、confirmation-registry、user-confirmation-ux 扩写、AGENTS 模板、confirmation lint。

### v3.3.1：init.adapter Widget 固定文案

**动机**：Claude Code 调 `AskUserQuestion` 时 agent 自造 option description，曾出现 `.claude/commands/skills/`（不存在）与 `(Recommended)` 标签；slash 实例未同步时同样走 agent 自由扩写路径。

**framework 侧变更**（约 8 源文件）：

1. 新建 [skills/project/framework-init/templates/adapter-widget-options.md](skills/project/framework-init/templates/adapter-widget-options.md) — 4 条固定 label + UPDATE 1/4 等价脚注 + 反模式。
2. [skills/project/framework-init/SKILL.md](skills/project/framework-init/SKILL.md) §0.2.5.1 **BLOCKER** 逐字引用 SSOT，禁止自造路径。
3. [agents/claude/templates/commands/framework-init.md](agents/claude/templates/commands/framework-init.md) frontmatter label 与 SSOT 对齐。
4. [confirmation-registry.yaml](skills/reference/confirmation-registry.yaml) `init.adapter` 增 `widget_options_ref`；`widget_hint` 改为 `AskUserQuestion | AskQuestion`。
5. [user-confirmation-ux.md](skills/reference/user-confirmation-ux.md)、[agents/README.md](agents/README.md) 反模式 / 误写警示。

**实例维护者验收**（UPDATE init，Q3 覆盖后第二轮 `/framework-init`）：

1. `.claude/commands/framework-init.md` — slash label 与 SSOT 一致，无 `.claude/commands/skills/`。
2. `.claude/rules/confirmation-ux.md` — Track B+ 规则已下发。
3. 若走 agent `AskUserQuestion`：选项 1 含 `.claude/commands`，无 `(Recommended)`；菜单下方可见 1/4 等价脚注。

**验证**：`cd framework/harness && npm test`；`npx ts-node harness-runner.ts --phase docs`。

### v3.4：Claude AskUserQuestion 全覆盖（Track B+ · feature Skills · agents-only）

**动机**：v3.3 仅 init 有 widget BLOCKER；spec / plan / coding / code-review / business-ut / device-testing 的 20 个 registry 确认点仍只有 portable 文本菜单，Claude Code 下 agent 常跳过 `AskUserQuestion`。

**framework 侧变更**（仅 `framework/agents/claude/templates/` + harness lint + 文档；**不改** `framework/skills/**`、**不改**实例 `.claude/**`）：

1. [agents/claude/templates/rules/confirmation-ux.md](agents/claude/templates/rules/confirmation-ux.md) — SHOULD → **BLOCKER**；registry 20 点索引；SSOT 链接按部署后 `.claude/rules/` 路径（`../../framework/skills/...`）。
2. 新建 [agents/claude/templates/rules/widget-options/](agents/claude/templates/rules/widget-options/)（index + skill0–6 共 8 文件）— AskUserQuestion label SSOT。
3. 8 个 Skill slash（`spec` … `glossary-bootstrap`）注入 Widget BLOCKER 段；**不改** `framework-init.md`。
4. [harness/scripts/check-skills-confirmation-ux.ts](harness/scripts/check-skills-confirmation-ux.ts) — 增量 lint Claude templates。

**实例维护者**（集成新发布件后 **自行** UPDATE init；agent 不代写 `.claude/`）：

```text
/framework-init   # UPDATE；S2 init.task_decision 覆盖 rules/commands 漂移项 → S3 物化
```

预期下发：`.claude/rules/confirmation-ux.md`、`.claude/rules/widget-options/*.md`、8 个 skill slash。

验收：confirmation-ux 含 BLOCKER；spec Step 1.5 出现 AskUserQuestion + portable 脚注；init slash 行为不变。

**验证**：`cd framework/harness && npm test`。

### v2.3：`prd`→`spec` / `design`→`plan` 阶段重定位（可选自动迁移）

**语义**：`spec` = 长期需求规格快照；`plan` = 短中生命周期实现计划（`plan.md` 为契约草案，`contracts.yaml` 为机器真源）。

**默认行为变更**（新 feature）：

| 旧 | 新 |
|----|-----|
| `doc/features/<f>/prd/PRD.md` | `doc/features/<f>/spec/spec.md` |
| `doc/features/<f>/design/design.md` | `doc/features/<f>/plan/plan.md` |
| phase id `prd` / `design` | `spec` / `plan` |
| `framework.config.json` 顶层 `"prd": { visual_handoff_* }` | `"spec": { ... }`（同字段名） |
| profile / extension capability `prd.visual_handoff` | `spec.visual_handoff` |

**`framework.config.json` `prd`→`spec` 段**：loader 短期仍读 legacy `prd` 并 WARN；**framework-init UPDATE**（merge 或 overwrite）经 `MIGRATION_RULES` 自动迁键。详见 [`docs/visual-handoff-config-migration.md`](docs/visual-handoff-config-migration.md)。

**只读 alias（≥2 minor 窗口，WARN）**：harness/goal-runner 仍接受 `--phase prd`/`design`、旧路径、旧 check id（`prd_p0_coverage` 等）、extension manifest 旧 phase key；profile/extension 中 legacy capability `prd.visual_handoff` 仍可读（规范化为 `spec.visual_handoff`）。

**`profile-skill-asset:` 旧引用**（`harness/scripts/utils/profile-skill-assets.ts` 自动规范化，无需手改 SKILL 正文）：

| 旧 skill-id | 新 canonical |
|-------------|--------------|
| `prd-design` / `1-prd-design` / `1-spec` | `spec` |
| `requirement-design` / `2-requirement-design` / `2-plan` | `plan` |

**实例根 adapter 跳板（物化目录/文件）**：UPDATE `framework-init` 的 `cleanup-deprecated` 会按 `materialized_adapters` 自动 `backup_delete` 上表所列旧 skill-id 在实例根的遗留跳板（cursor：`.cursor/skills/<id>/`；claude：`.claude/commands/<id>.md`；generic：`<agent_bundle_root>/skills/<id>/`），与编号形态旧跳板一并清理；现行扁平跳板（`spec`、`plan`、`coding` 等）不受影响。备份目录：`.framework-backup/<timestamp>/`。**勿跳过** `cleanup-deprecated`，否则 `prd-design` / `requirement-design` 等会与新版 `spec` / `plan` 并存、易误导。

| 旧 asset_key | 新 canonical |
|--------------|--------------|
| `prd_template` / `example_prd` | `spec_template` / `example_spec` |
| `design_template` / `example_design` | `plan_template` / `example_plan` |
| `examples_prd_mapping` | `examples_spec_mapping` |

**Extension `provides.skill_assets`**（`doc/extensions/manifest.yaml`，与 profile `skill-assets.yaml` 合并）：

- **结构**：`provides.skill_assets.<skill-id>.<asset_key>` → 相对 `doc/extensions/` 的文件路径（与 profile 清单字段语义一致）。
- **优先级**：extension 条目**覆盖** profile 同 `skill-id` + `asset_key`；extension **独有** key 可增补 profile 未声明的资产。
- **引用方式**：SKILL / prompt 仍写 `` `profile-skill-asset:<skill>/<key>` ``；`harness/scripts/utils/profile-skill-assets.ts` 先读 extension 绝对路径，再回退 profile 清单。`check-docs` 的 `profile_skill_assets_resolvable` 校验合并后的解析结果。
- **Schema / 实现**：[`specs/instance-extension-manifest.schema.yaml`](specs/instance-extension-manifest.schema.yaml)、[`harness/extension-loader.ts`](harness/extension-loader.ts)。

```yaml
# doc/extensions/manifest.yaml（片段）
provides:
  skill_assets:
    spec:
      spec_template: assets/host-spec-template.md
      example_spec: assets/example-spec.md
    plan:
      plan_template: assets/host-plan-template.md
```

**推荐迁移**（实例维护者，非强制）：

```bash
# 仓根（dev 工具，不进发布 zip）
node scripts/migrate-feature-phase-paths.mjs --project-root <repo> --dry-run
node scripts/migrate-feature-phase-paths.mjs --project-root <repo>
```

迁移后重跑 `framework-init` UPDATE 刷新 adapter 跳板（`.cursor/skills`、`.claude/commands` 指向 `skills/feature/spec` / `plan`）。

**已知限制（半迁 / 修订旧 feature）**：`context-exploration.md`、`trace.json`、harness `reports/` **不做** legacy `prd/`、`design/` 目录回退（与回执 `phase-completion-receipt.md` 的 `resolveReceiptFilePath` 策略不同，属刻意收窄）。典型触发：framework 升级后仍在旧目录续跑 spec/plan 并重跑 harness → BLOCKER `context_exploration_present`。处理：按报错 suggestion 执行

```bash
cd framework/harness && npm run backfill:context -- --feature <name> --phases spec,plan [--dry-run]
```

或在 canonical 目录（`doc/features/<f>/spec/`、`plan/`）手写/迁移 `context-exploration.md`。全量目录搬迁见上方 `migrate-feature-phase-paths.mjs`；半迁伴生文件需手迁或删 feature 重跑。

术语表：[`docs/concepts/phase-terminology.md`](docs/concepts/phase-terminology.md)。

### v2.2：tsc 静态扫描 + 改源码门禁 + named_handler 放宽（历史）

未在本文记录细节，可在 git log 里搜 `feat(harness): v2.2`。
