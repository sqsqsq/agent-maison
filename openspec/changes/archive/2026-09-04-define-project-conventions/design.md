## Context

Maison 已有 P1 蓝图、Feature contracts、review verifier、provider/provenance、projection 与 phase gate，但消费者工程没有一类专门承载横切“怎么写”知识的资产。现有 P1 设计已把 `convention` 作为稳定知识来源等级，却没有可用性 Seam Card、配置路径、CU 声明或 review 覆盖闭环。本 change 只扩展这些既有链路；Maison 自身不生成消费者内容，也不修改宿主工程。

## Goals / Non-Goals

**Goals:**

- 以单个 opt-in Markdown 文件承载少量、人工策展的工程惯例，并提供唯一写入 skill。
- 让同一惯例 id 经 P1 `discovery.facts`/provenance、CU `contracts.conventions_applied` 到 review 全量台账可确定性核对。
- 保持无惯例文件消费者的 spec/plan/review 运行时行为不变，并让 P1 对未启用或不可读状态诚实表达。
- 复用现有 config loader、P1 provider validator、projection renderer、Feature spec loader、review prompt/context/checker 与 adapter/skill 索引。

**Non-Goals:**

- 不建立 resolver、index、结构化 applicability、hash/drift、AST anchor、ADR 目录、owner/waiver/lifecycle 状态机或自动生成器。
- 不新增蓝图专用字段、publication schema、provider registry、harness phase、standalone review target、hook 或 BLOCKER 级 conventions gate。
- 不自动创建或回填消费者惯例文件，不包含首批业务惯例内容，不修改 App blueprint schema。

## Decisions

### 1. 单文件弱结构资产与路径复用

`FrameworkPaths`/`DEFAULT_PATHS` 增加 `conventions: doc/conventions.md`，harness 消费统一走 `conventionsPath(projectRoot)`；skills 按既有约定读取 `framework.config.json > paths.conventions`，缺失时使用相同默认值。新建配置模板包含默认键，但 UPDATE-keep 的 generic backfill SSOT 明确排除该 opt-in 键。

条目格式只在 `docs/concepts/conventions.md` 定义：每个 `## <id>` 是主键；review 卡无机器字段；gate 卡包含 `enforcement: gate` 与 `gate_ref: <phase>/<rule_id>`。其余规则、适用范围、范例、反例、生效日期、探针与 supersedes 为人读内容。选择 Markdown 而不是 YAML schema，是因为预期软上限 30 条、每次可完整读取，新增 resolver/schema 会形成第二套策展系统。

### 2. 唯一写入入口复用 skill 接线

`/conventions-bootstrap` 对标既有 catalog bootstrap：文件不存在时建空骨架，盘点 review/事故、代码与既有文档，优先重复问题，以探针测符合率，区分 established/待裁决/aspirational，与现有 gate 去重后逐条请求 `y` 确认。已有 checker 的判定文本不得复制；只允许解释、真实 `gate_ref` 与范例组成的索引卡。review 只能建议升格，不能直接写文件。

六类 adapter 命令、skills index 与 agent-bundle bridge 复用现有清单；不新增命令 registry。

### 3. P1 复用 provider/provenance/projection

既有静态 provider 规则表增加 `conventions-knowledge` optional 卡，冻结 authority/source rule，卡片必须在蓝图 `providers[]` 中。默认路径无文件且未显式配置表示未启用，`available: false` 且 `missing_disposition: not_applicable`；显式配置但不可读只能是 `unknown|degraded`。文件可读时，P1 必读全文，仅把适用 id 写为既有 `discovery.facts`，`source_kind: convention`、`source_ref: <configured-path>#<id>`、`evidence_strength: authoritative`；视图/decision 继续用既有 provenance/verification refs。

同一 review projection renderer 从 canonical facts/provenance 派生“采用的惯例”列表，`--projection` 继续验证零新事实。没有新 schema 或反向写入。

### 4. CU 声明复用 Feature contracts loader

`contracts.conventions_applied[]` 每项仅含唯一 `id` 与非空 `planned_locations`。location 是 canonical 的项目相对 POSIX 文件路径或目录前缀，按完整路径段边界匹配，禁止 glob、绝对路径、`..` 与反斜杠。schema、`ContractsSpec` 与 `SpecLoader` 是同一加载链；非法形状由既有 `shape_issues → feature_spec_shape` BLOCKER 报告，`check-review` 只消费规范化结果，不重解析原 YAML。

plan 只在文件存在时输出条件节；有所引蓝图时声明集合必须覆盖蓝图实际采用且命中本 CU scope 的惯例。spec research 只做一行兜底必读，不复制正文。

### 5. Review 在既有 verifier/checker 中完成后置核对

review context 在惯例文件存在时注入全文，并按 `contracts.files` 定义的目标文件集合执行：适用性、符合性、CU 声明一致性、蓝图一致性、Golden Example 存在性。报告对惯例文件每个 id 恰有一行，判定为 `PASS|VIOLATION|GATE_DELEGATED|NOT_APPLICABLE|NOT_ASSESSED`；gate 卡必须且只能用 `GATE_DELEGATED`，不复制本轮 gate 结果。VIOLATION 的问题条目包含 id 与范例路径。

仅新代码以条目生效日和 `git blame` 判定：未跟踪/未提交行或 blame 日期不早于生效日为新；更早为 legacy advisory；无法 blame 为 `NOT_ASSESSED` advisory，不能升级阻断。

`check-review` 使用最小 Markdown 读取，先检查三侧 id 唯一，再检查台账与文件 id 精确集合相等、枚举、VIOLATION 问题引用、声明子集、蓝图贯穿、planned location 段边界命中、`gate_ref` 对 resolved phase rules 的存在性，以及 gate/判定双向关系。缺文件且无声明 SKIP；缺文件但声明非空 FAIL-MAJOR；文件存在时全检。它不比较跨报告 gate 结果。

### 6. Goal/normal parity 不加特殊接线

normal 与 goal 模式共用同一 phase skills、Feature loader、review context/checker 和 P1 checker；goal 上下文装配无需新增 conventions 状态或分支。因此两种模式的输入、判据、严重级别和降级语义相同。

磁盘核验：`harness/scripts/goal-phase-runtime.ts` 的 `PHASE_SKILL_REL.review` 指向同一 `skills/feature/code-review/SKILL.md`，phase prompt 要求读取该文件，`runHarnessPhase` 仍调用同一 `harness-runner.ts --phase review`。P1 两入口也共用 `check-component-blueprint.ts`；无需在 goal prompt 中单列 conventions。

## Risks / Trade-offs

- [Markdown 人读字段可能漂移] → 机器只承诺 id、gate 类型/ref 与 review 台账；消费时打开范例，失效只 WARN。
- [存量工程首次启用暴露大量旧违反] → 生效日 + blame 将存量统一降为 advisory，无法断代不得阻断。
- [路径前缀误匹配] → 统一 canonical POSIX 路径并按完整段边界匹配。
- [gate 卡静默指向失效规则] → bootstrap 与 review 都按 `(phase, rule_id)` 对 resolved rules 验存在，不复制判定文本或结果。
- [多个链路出现平行解析] → config 只经 helper，contracts 只经 `SpecLoader`，projection 只经现有 renderer，review checker 只解析惯例 Markdown/报告所需最小字段。

## Migration Plan

这是 opt-in、向后兼容的发布件增量。新建消费者配置可看到 inactive 默认路径；既有配置 UPDATE-keep 不回填且不会创建文件。回滚只需移除发布件增量；消费者已创建的 `doc/conventions.md` 是宿主知识资产，不由 Maison 自动删除。无需修改 `MIGRATION.md`。

## Open Questions

无。命名沿用 plan 已批准的 `conventions` / `/conventions-bootstrap`；条件式 plan 节通过运行时文件存在性激活，不进入无文件工程的章节完整性门。

## Implementation deviations（2026-09-04）

- UPDATE-overwrite 已由此前的无损配置改造改为 raw baseline + 授权 payload + backfill，normalize 仅影子校验（`config-builder.ts:buildUpdateConfigForWrite`）。因此保留 UPDATE keep/overwrite 均不自动补 `paths.conventions`；CREATE 写默认键，三者 helper 结果一致。显式 payload 指定路径仍正常保存。不增加 builder/CLI 写盘特例。
- 实际 skill 路径为 `skills/feature/*`，详细 reference 复用 `skills/reference/`。AGENTS 新行沿既有模板变量链增加 `CONVENTIONS_PATH`，确保自定义路径准确。
- 已启用惯例的 review context 沿同一 collector 读取全部 contracts 目标文件，去掉该分支原有 `.ets` 限制与 30 文件截断；未启用分支保持原行为。无新 parser/registry/phase。
- 六宿主接线核对：Claude `.claude/commands`、CodeAgent `.cac/commands`、Cursor `.cursor/commands` 使用三个路由模板；Cursor/Chrys/Codex/OpenCode 由同一 shared skill bridge 分别物化到原生目录，generic bundle 也复用该 bridge。

## Bounded review corrections

本轮只处理三项阻断：P1 使用既有 `extractHeadings` 校验配置文件中的真实惯例 id，并要求节点/decision 的惯例 provenance 或指向配置文件的 verification ref 对应同一 convention fact；provider 直接读文件，仅 ENOENT 且未显式配置表示未启用，其余失读保留 unknown/degraded；`SpecLoader.collectSourceFiles` 的无扩展名过滤分支完整保留 UTF-8 文本，对 NUL/非法 UTF-8 的资源只返回路径引用，不把解码乱码注入 prompt。已有 `.ets` 调用分支保持原行为。

未修改 contracts 额外键策略，未扩展 projection/review 的 facts 消费协议，未新增 schema、registry、状态或依赖。新增反例及合法自定义路径贯穿均调用生产函数；真实钱包 dogfood 仍非本轮前置条件。
