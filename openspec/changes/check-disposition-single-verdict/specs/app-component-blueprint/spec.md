## ADDED Requirements

### Requirement: A pre-authorized unattended B1 repair is a legitimate revision source

除新事实、权威裁决与冲突解决外，蓝图正式修订的来源还包括**预授权的无人值守 B1 修复**：goal 运行时在无人值守 run 的设计 owner 停机整体为 B1、且个人配置 `design_repair.unattended_b1` 为布尔 `true` 时派出的一次修复（派发前提与次数见 `goal-runner`）。这类修订 MUST 只改正既有授权内、依据明确的 B1 问题（`authority_content_not_machine_structure`、`authority_cu_mapping_stale`），MUST NOT 改任何决策、扩大范围或补新事实；编写调用 MUST 只改本次 B1 发现项定位到的位置（停机简报 `items[].locations`）：文字类是本 CU 所选设计目标里被写成文字的 `acceptance` / `contracts` / `use_cases` 字段，映射过期只许删掉 `contracts.change_unit.change_unit_ref`；运行时随后覆盖的 `revision`、根 `provenance` 五个登记字段与 `derived_results` 不算越权。改了别处 MUST 作废本次修复、丢弃草稿、不发布（canonical 不变），失败步骤 `author_scope` 并列出越权路径；被允许字段内部的改写是否忠于原文不做机器比对，由独立质询把关；B2 与未预授权的 B1 MUST NOT 以此形成修订。修订规则：

- 编写只发生在 run 目录下的草稿里，运行时只把 canonical 蓝图文件复制过去（同目录的 closure 与评审投影不复制）；发布前运行时 MUST NOT 写 canonical。编写调用 MUST NOT 写 `review_summary.admission` 或 `review_summary.questioning`，与基线不同即按自报处理、本次修复作废；编写调用写的 `revision` 与根 `provenance` 中运行时登记的五个字段（见下）由运行时覆盖；根 `provenance` 的其余字段（如 `evidence_strength`）保留编写调用的值并照常接受校验；通不过校验或准入即不发布；
- 编写调用通过核对后，运行时 MUST 作废草稿里整份旧质询结果（canonical 历史不动），再由与编写隔离的独立质询调用按既有必答范围重新产出（输入只有草稿、结构化证据包与已登记外部输入；未变更视图仍可用 `verified_unchanged`），且该调用只能改质询结果；质询方标识 MUST 与编写方不同。质询调用启动失败、非正常退出，或正常退出但没有合法新结果时 MUST NOT 发布，MUST NOT 沿用旧报告或伪造报告；
- 准入 MUST 由与校验器同源的派生函数从校验结果派生，由运行时写回草稿的 `review_summary.admission`（校验器调用同一函数再比对）；作废旧质询后与新质询产出后各派生一次，作者写入的准入不被采信；
- 新 revision（旧值 + 1）与修订依据 MUST 由运行时登记在蓝图既有的根 `provenance`：`source_kind: design_repair_unattended`、`source_ref` 指向预授权键、`source_revision` 指向旧 revision、`observed_at` 为登记时间、`extraction_method` 列出被修的检查与原因码（这五个字段由运行时覆盖写入，根 `provenance` 其余字段保留）；不新增字段。既有 P1 派生结论 MUST 按既有调和规则标 `stale` 并保留原输入 revision，MUST NOT 批量改版本冒充重算；
- 发布前 MUST 对将要发布的那份字节的解析结果做真实校验，`context` 用真实宿主根与 canonical 路径（草稿目录不作 projectRoot）；有 BLOCKER 或准入不是 `pass` 即不发布。发布前任何失败 MUST 丢弃草稿，canonical 字节不变。发布是单文件 temp→rename，rename 前 MUST 复核 canonical 字节仍等于复制时的基线，不等即不发布；
- 编写或质询调用改了草稿之外的文件（含蓝图 `source_ref` 引用的文件——即使在 `context/`、`reports/` 下，以及蓝图工作区里各 run 的事件、manifest 等运行记录），或改动无从核实（含编写调用让蓝图新引用了调用前没核对的文件）时 MUST NOT 发布，按既有越界写入违规处置（核对范围与事件文件的整文件写回见 `goal-runner`）；对工程文件这是检测，不承诺还原；
- rename 成功即发布边界，此后任何失败 MUST NOT 回滚蓝图；发布成功不等于修复成功。同目录的评审投影 `component-blueprint.review.md` 随之过期，只披露、不自动重生成。

Enforcement: `harness/scripts/utils/design-repair-unattended.ts`, `harness/scripts/utils/blueprint-admission.ts`, `harness/scripts/utils/component-blueprint-validator.ts`, `skills/reference/design-repair-unattended.md`

#### Scenario: An admitted blueprint is re-questioned instead of carrying its old conclusion

- **WHEN** canonical 蓝图原本准入为 `pass`，无人值守 B1 修复的编写调用在草稿里修好了一处 B1 问题
- **THEN** 运行时作废草稿里的旧质询后机器派生的准入不是 `pass`，独立质询重新产出后派生为 `pass` 才发布；发布的 revision 为旧值 + 1，根 `provenance` 记修订依据，canonical 的旧质询历史保留

#### Scenario: A self-reported admission voids the repair

- **WHEN** 编写调用在草稿里改了 `review_summary.admission` 或 `review_summary.questioning`
- **THEN** 本次修复作废，草稿丢弃，canonical 字节不变

#### Scenario: Questioning that yields no result does not publish

- **WHEN** 独立质询调用非正常退出，或正常退出但草稿里没有质询结果
- **THEN** 不发布、不沿用旧报告、不伪造报告，canonical 字节与质询历史不变

#### Scenario: The draft is validated against the real host

- **WHEN** 同一份合法蓝图分别在 canonical 位置与作为草稿对象（真实宿主根作 context）上校验
- **THEN** 两者结果一致；草稿校验不因找不到宿主里的需求或契约文件而误报
