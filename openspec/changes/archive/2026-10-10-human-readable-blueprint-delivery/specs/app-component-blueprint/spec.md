## MODIFIED Requirements

### Requirement: A legal blueprint and a complete design handoff are separate bars

**合法 `component-blueprint@1`（P1 协议层）** MUST 只要求：闭集 `discovery.inputs.current_scope_items`（≥1 项，逐项带项目内可解析 `source_ref`、原始字节 `source_sha256`、provenance）+ 至少一个 `applicable` + `changed` 视图 + 必要的当前/目标/delta + 决策/缺口/关系/验证义务满足本 capability 其余条目。合法性 MUST NOT 包含 Change Unit 数量——P1 MUST NOT 反向依赖 P2。

**完整 `/component-design` 设计交付（编排层）** MUST 同时满足：蓝图 admitted + 已分解 1..N canonical `change-unit@1` + 每个 CU 建立 `design_refs` 引用 + 后续施工 readiness。该层验收由 `/component-design` 编排入口承担，MUST NOT 被写进蓝图自身的合法性判据。

因此 `admitted blueprint + 0 CU` MUST 是一个**合法状态**（P2 设计准备子流程的合法入口），而不是蓝图校验失败。

#### Scenario: An admitted blueprint with zero change units is legal

- **WHEN** 一份蓝图已通过全部 P1 校验并 admitted，但尚未分解出任何 canonical CU
- **THEN** `check:component-blueprint` 必须 PASS；CU 数量不进入蓝图合法性判据

#### Scenario: A design handoff without change units is incomplete

- **WHEN** `/component-design` 在蓝图 admitted 后返回，却没有任何 canonical CU 与 readiness
- **THEN** 编排层必须判定设计交付未完成，而不是宣称完成；该判定 MUST NOT 通过修改蓝图合法性实现

> **Enforced by (P1 implementation):** `harness/scripts/utils/component-blueprint-validator.ts`, `skills/project/component-design/SKILL.md`, `skills/project/change-unit-progression/SKILL.md`

完整设计交接 MUST 默认生成并链接蓝图同目录 component-blueprint.review.md。canonical 蓝图/CU 内容修改后 MUST 在本次调用结束前重建，覆盖草稿、质询写回与局部修改。设计者 MUST 用现有 review_summary、视图、rationale 和 CU 契约回答需求/范围、当前问题、工作方案、模块责任、选择依据、分步交付与安全中间态、风险验收七问，不新增文档 schema 或审批门禁。

#### Scenario: Draft and complete local delivery
- **WHEN** 当前 canonical 蓝图可解析但未准入，或完整设计交接完成
- **THEN** 本地投影 SHALL 可生成并如实显示准入与缺口；生成不得改变检查结论，完整交接 MUST 链接当前文档

> **Enforced by:** skills/project/component-design/SKILL.md、skills/reference/app-component-blueprint-workflow.md、harness/scripts/check-component-blueprint.ts、harness/scripts/utils/blueprint-review-projection.ts

### Requirement: Three Story-class host seams are separate directional contracts

正式需求统一经蓝图后，Maison 与宿主之间 MUST 存在三条**方向与 owner 各自独立**的静态接缝。它们照上表 Seam Card 格式冻结如下；publication 与 feedback 方向相反、owner 不同，MUST NOT 合并为一张卡，评审投影 renderer MUST NOT 兼任 feedback provider。

| Seam Card | Definition | 方向 | Consumer | Provider | required/optional | 权威与来源 | 缺失 | 替换 | 退出 | 冲突行为 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| requirement-source materialization | `{item_id,kind,source_ref,source_sha256,source_revision?,provenance{authority…}}` 的来源材料物化输入 | 宿主 → Maison | 蓝图 builder 的 `discovery.inputs.current_scope_items` | 宿主 story 类扩展（获取/脱敏/物化） | 来源为宿主/外部 provider 时 required；直接人工/inline/本地文件输入时由 builder 直接规范化为同一 currentScopeItem，不走本文件接缝 | 宿主物化后的**项目内**文件为唯一可解析来源；每项带项目相对 `source_ref`、原始字节 `source_sha256`、`provenance.evidence_strength`/`extraction_method` 与 authority；Maison MUST NOT 知道内网标识、token、URL 或归档 API，MUST NOT 把模型转述升级为来源 | required 缺失 → 结构化 blocker，带 owner/解除条件；不得凭记忆或转述补造 scope item | 保持输入契约不变；来源变化使依赖它的 P1 派生结果 stale 后重算 | 已物化文件与已收录 scope item 保留并标 stale/unknown，不删除 | 同一 `item_id` 出现两份不同 `source_sha256`，或声明 hash 与实际字节不符 → fail-closed，报告双方，禁止 last-write-wins |
| blueprint-review publication | 指定 admitted revision 的确定性评审投影（`derived_from` = artifact/component_id/blueprint_id/revision/source_fingerprint/artifact_sha256/有效 CU 内容绑定） | Maison → 宿主 | 宿主 Story Document / 归档件装配方 | Maison 确定性 review projection renderer | optional | canonical 蓝图和 CU 各保留原设计/施工职责；投影 MUST 相对两者零新设计事实，MUST NOT 反向覆盖 YAML；Maison 从 canonical CU 派生同页施工拆分；宿主可附 spec 等附件，但附件 MUST NOT 成为部件内设计的事实来源 | 宿主未接该接缝 → 外部归档诚实降级（本地文档仍默认交付），核心蓝图链不受影响，不得宣称已归档 | 投影内容契约稳定；同一蓝图/CU 来源与当前 renderer 重算字节确定性一致 | 清理投影副本；canonical YAML 与 revision 历史保留 | 投影包含 canonical 中不存在的设计事实 → 校验失败；同一 revision 出现两份内容不同的投影 → fail-closed |
| blueprint-review feedback | `{feedback_id,kind,source_revision,authority?,decision?,evidence_refs?}`，`kind` ∈ `opinion \| fact_supplement \| suggestion \| authoritative_ruling` | 宿主 → Maison | 既有 P1 reconciliation | 宿主评审系统/评审人 adapter | optional | 只有同时具备 `authority`（有权 owner 标识）、`source_revision`（指向被评审的 revision）与明确 `decision` 语义的 `authoritative_ruling` 才 MAY 进入 `decided_with_authority`；其余三类只能记为意见/事实补充/建议。批次身份（`blueprint_id` **与** `component_id`）与目标蓝图不一致 MUST fail-closed | 无反馈 → 蓝图保持当前 revision，不得自我升格 | 更换评审系统不改变四类分类与 authority 门槛 | 清理未接受反馈；已生成的 revision 与 provenance 保留 | authority 不足却声称裁决、`source_revision` 不指向已存在 revision、批次身份不一致、或试图回写旧 revision → fail-closed。intake 本身 MUST NOT 自动接受任何反馈、MUST NOT 改写任何 revision；**被接受后**，授权裁决与事实补充都落在既有 P1「新事实、权威裁决 MUST 生成新 revision」覆盖面内，MUST 经既有 reconciliation 生成**新** revision；意见与建议 MUST NOT 触发 revision 递进 |

**发布态机器契约 SSOT 与验证入口**（三者 MUST 在发布件内点名落地，MUST NOT 只存在于 dev-only OpenSpec；MUST NOT 新增顶层 CLI）：

| 接缝 | 发布件内 SSOT | 验证入口 |
|---|---|---|
| requirement-source materialization | `harness/schemas/requirement-source-materialization.schema.json`（宿主可读的镜像；**字段语义权威**是 `app-component-blueprint.schema.json#/$defs/currentScopeItem`，校验判据复用 P1 的 current-scope helper，不复制出第二套可漂移语义） | `check:component-blueprint` 既有 CLI 的材料校验模式（`--materialization <path>`）；**该模式 MUST NOT 要求 canonical blueprint 已存在**（物化在建蓝图之前）；解析复用既有 `resolveCurrentScopeSource`，不造 resolver 副本 |
| blueprint-review publication | **复用既有** `harness/schemas/app-component-blueprint.schema.json` + 确定性 `harness/scripts/utils/blueprint-review-projection.ts` renderer | `check:component-blueprint --write-review` 本地生成及既有 `derived_from`/投影一致性校验（`--projection <path>`）；MUST NOT 新建平行 publication schema |
| blueprint-review feedback | `harness/schemas/blueprint-review-feedback.schema.json`（四类分类、authority、source revision、决策语义） | reconciliation intake 校验挂 `check:component-blueprint` 既有入口（`--feedback <path>`） |

三者的随包有效/无效样例 MUST 位于发布件包含路径（`docs/operations/`），MUST NOT 放在被排除的 `harness/tests/**`，并 MUST 被仓内单测经上述**同一正式 checker** 验证正例通过、反例失败。

#### Scenario: Materialization runs before any blueprint exists

- **WHEN** 一项新的正式需求刚物化来源材料，工作区内**还没有** canonical blueprint
- **THEN** `--materialization` 模式 MUST 独立完成校验并给出结论，MUST NOT 因 `component_blueprint_missing` 前置失败——编排顺序是「物化 → 建蓝图」；`--projection` / `--feedback` / `--ref` 模式仍 MUST 要求蓝图存在

#### Scenario: Materialized source revision disagrees with its provenance

- **WHEN** 某条物化材料同时声明 `source_revision` 与 `provenance.source_revision` 且两者不一致
- **THEN** 校验 MUST 失败并同时报告两值——该判据与 P1 current-scope 校验共用同一实现，两侧不得漂移

#### Scenario: Feedback component identity disagrees

- **WHEN** 一批反馈的 `component_id` 与目标蓝图不一致
- **THEN** intake MUST fail-closed 并报告双方；该批次 MUST NOT 产出任何可进入 `decided_with_authority` 的裁决

#### Scenario: Inline requirement input needs no provider manifest

- **WHEN** 一项小型正式需求由人直接给出需求文本并落到项目内文件，没有宿主 provider 参与
- **THEN** blueprint builder MUST 可以把它直接规范化为同一 `currentScopeItem`（带项目内 `source_ref`、原始字节 hash、provenance、authority），MUST NOT 因为"没有 materialization JSON"而阻塞；该 item 仍 MUST 通过与文件接缝完全相同的 current-scope 校验

#### Scenario: Required materialization is missing

- **WHEN** 一项正式需求进入蓝图，但宿主未物化任何可解析来源材料
- **THEN** 必须形成结构化 blocker 并列出 owner 与解除条件，不得凭转述补造 `current_scope_items`

#### Scenario: Materialized source hash conflicts with actual bytes

- **WHEN** materialization 输入声明的 `source_sha256` 与项目内该文件的实际原始字节不一致
- **THEN** 校验必须 fail-closed 并同时报告声明值与实际值，不得按任一侧静默取胜

#### Scenario: Publication tries to add a design fact

- **WHEN** 评审投影包含 canonical 蓝图中不存在的设计事实
- **THEN** 投影一致性校验必须失败；宿主附件不得成为部件内设计的事实来源

#### Scenario: Feedback without authority cannot rule

- **WHEN** 一条反馈声称 `authoritative_ruling`，却缺 `authority`、缺 `source_revision` 或没有明确决策语义
- **THEN** intake 校验必须拒绝它进入 `decided_with_authority`，只能记为意见/建议

#### Scenario: Authorized feedback produces a new revision

- **WHEN** 一条合法 `authoritative_ruling` 被接受
- **THEN** 调和必须生成新的蓝图 revision 并按既有规则把受影响 P1 派生结论标 stale；试图回写被引用的旧 revision 必须失败

#### Scenario: Publication and feedback are not merged

- **WHEN** 某实现用同一个 provider 同时输出评审投影并接收评审反馈
- **THEN** 违反本契约——两条接缝方向相反、owner 不同，必须独立

> **Enforced by (P1 implementation):** `harness/schemas/requirement-source-materialization.schema.json`, `harness/schemas/blueprint-review-feedback.schema.json`, `harness/schemas/app-component-blueprint.schema.json`, `harness/scripts/check-component-blueprint.ts`, `harness/scripts/utils/blueprint-host-seams.ts`, `harness/scripts/utils/blueprint-review-projection.ts`, `docs/operations/component-design-host-adaptation.md`
