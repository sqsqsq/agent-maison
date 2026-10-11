## MODIFIED Requirements

### Requirement: Story-class host seams stay three separate directional contracts

正式需求统一入口后，Maison 与宿主之间的三条静态接缝 MUST 各自独立建模，方向与 owner
MUST NOT 合并：

| 接缝 | 方向 | required/optional | 缺失/冲突行为 |
|---|---|---|---|
| `requirement-source-materialization` | 宿主 → Maison | 来源为宿主/外部 provider 时 required | 缺失 = 结构化 blocker；来源 hash 冲突 fail-closed |
| `blueprint-review-publication` | Maison → 宿主 | optional | 缺失 = 诚实降级 |
| `blueprint-review-feedback` | 宿主 → Maison | optional | authority 不足只能记为意见/建议 |

- `requirement-source-materialization`：宿主负责获取/脱敏/物化来源材料；Maison MUST 只消费
  **项目内可解析**的 `source_ref`、原始字节 sha256、provenance 与 authority。Maison MUST NOT
  知道内网标识、token、URL 或归档 API。

  **口径统一（单一判据）**：每项正式需求最终 MUST 形成至少一个合法 `currentScopeItem`。达成
  方式有两条，两条都合法且产出同一形状：来源来自**宿主/外部 provider** 时 MUST 走
  `requirement-source-materialization@1` 文件接缝；**直接人工、inline 或本地文件**输入时由
  blueprint builder 直接规范化为同一 `currentScopeItem`，MUST NOT 强制额外制造一份 provider
  manifest。无论哪条路径，MUST NOT 无来源、凭模型转述生成 scope item。
- `blueprint-review-publication`：输出**指定 admitted blueprint revision** 的评审投影，供宿主
  装配 Story Document / 归档件。投影 `derived_from` MUST 精确指向该 revision，内容 MUST 相对 canonical 蓝图与 CU 零新
  设计事实；Maison 派生同页 CU 拆分，宿主仍可附 spec 等附件，但附件 MUST NOT 成为部件内设计的事实来源。
- `blueprint-review-feedback`：结构化评审反馈 MUST 区分**意见 / 事实补充 / 建议 / 授权裁决**
  四类。只有同时具备 authority、source revision 与明确决策语义的反馈才 MAY 进入
  `decided_with_authority`；合法反馈 MUST 经既有 reconciliation 生成**新** revision，
  MUST NOT 回写旧 revision。

publication 与 feedback 方向相反、owner 不同，MUST NOT 合并为一张 Seam Card；评审投影
renderer MUST NOT 兼任 feedback provider。

#### Scenario: publication 与 feedback 合卡被拒绝

- **WHEN** 某 change 用一张 Seam Card 同时表达"输出评审投影"与"接收评审反馈"
- **THEN** 该 change 违反本契约，openspec review MUST 拒绝

#### Scenario: authority 不足的反馈不得成为设计权威

- **WHEN** 一条评审反馈没有 authority、缺 source revision 或没有明确决策语义
- **THEN** 它 MUST 只能作为意见/建议记录，MUST NOT 进入 `decided_with_authority`，
  MUST NOT 触发 revision 递进

#### Scenario: 授权反馈生成新 revision 而非回写

- **WHEN** 一条带 authority、source revision 与明确决策语义的反馈被接受
- **THEN** 调和 MUST 生成新的蓝图 revision 并按既有规则把受影响派生结论标 stale；
  MUST NOT 原地修改被引用的旧 revision

#### Scenario: 投影试图新增设计事实被拒绝

- **WHEN** 评审投影包含 canonical 蓝图与 CU 中不存在的设计事实
- **THEN** 投影校验 MUST 失败；宿主附件 MUST NOT 被当作部件内设计的事实来源

> **Enforced by:** 本 capability spec 作为 P1 change 三张接缝 Seam Card 的准入约束；
> 发布态机器契约与校验入口由 P1 change 与发布件内 schema/checker 承载

默认本地交付 SHALL 由 Maison 从 canonical 蓝图与 CU 派生同页需求、方案、施工拆分和验收关注，相对两者零新事实；宿主无需自拼 CU 附件，仍可附 spec 等外部附件。草稿本地展示不宣称正式 admitted publication。投影与 feedback 的权责继续独立。

#### Scenario: CU decomposition is included by Maison
- **WHEN** 宿主接收当前设计交付
- **THEN** Maison SHALL 同页呈现有效 CU、精确替代、显式依赖、安全中间态和需求直接引用，MUST NOT 依赖宿主拼装 CU 正文或输出覆盖结论

> **Enforced by:** harness/scripts/utils/blueprint-review-projection.ts、harness/scripts/utils/blueprint-host-seams.ts、docs/operations/component-design-host-adaptation.md
