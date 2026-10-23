## MODIFIED Requirements

### Requirement: Dual entry semantics

**统一正式需求入口（2026-08-29 修订）**：每一项**正式需求** MUST 经过部件演进蓝图这一部件
内设计阶段；蓝图 MUST NOT 被定义为"复杂多单元需求才启用的可选路线"。上游输入 MUST 支持
两种形态，且两者 MUST 是同一入口的两种输入而不是两条路线：

- **本部件直供**：直接从原始需求、当前事实与人工提供的外部约束建立蓝图，MUST NOT 以"能力
  架构蓝图缺失 / G2 未建设"为由阻塞；
- **跨部件投影**：MUST 只消费人工或上游提供的投影引用——Maison MUST NOT 重新裁决其它部件
  的架构，MUST NOT 由 AI 补造缺失的外部契约（缺失时 MUST 落 open decision 或带责任方的
  blocker）。

蓝图协议 MUST 唯一：MUST NOT 引入 compact/full 档位、蓝图类型字段、升级信号或升级状态机；
内容深度 MUST 由本次演进的真实影响面派生（见「Conditional design obligations」）。

#### Scenario: 外部契约缺失不得补造

- **WHEN** 建立蓝图时 SE 尚未提供云侧同步契约
- **THEN** 蓝图对应条目为 open_decision/blocker 并标注责任方与解除条件，不出现 AI
  生成的契约内容

#### Scenario: 小型正式需求不得绕过蓝图

- **WHEN** 一项正式需求预计只需要一个 Change Unit
- **THEN** 它仍 MUST 先经过蓝图（薄蓝图 → 1 个 CU），MUST NOT 直接进入 spec/plan 施工；实现 MUST NOT 提供"小需求跳过蓝图"的合法路径

#### Scenario: 提议为蓝图新增档位被拒绝

- **WHEN** 某 change 提出为蓝图新增 compact/full 档位、蓝图类型字段或从薄到全的升级状态机
- **THEN** 该 change 违反本契约，openspec review MUST 拒绝——深度伸缩只能由条件式设计义务
  表达

> **Enforced by:** 本 capability spec 作为 P1 change（蓝图建立与调和）与
> `/component-design` 编排入口的准入约束，运行时 enforcement 随 P1 落地并回填引用

### Requirement: Formal requirement determination is a stated contract, not a machine score

入口 MUST 按以下唯一 SSOT 文案判定一项事项是否为正式需求：

> 有明确交付或验收责任，且拟改变部件行为、外部契约、数据/NFR、运行语义或架构责任的事项，
> 按正式需求处理；不改变这些语义的纯文档和机械维护除外。

判定 MUST 遵守三条纪律：

1. **上游权威**：上游（产品/SE/组织流程）显式把事项标为正式需求时，该分类 MUST 具有权威
   性，Maison MUST NOT 用自己的启发式把它降级为非正式维护动作；
2. **信息不足由人确认**：入口信息不足以判定时 MUST 询问人并等待确认，MUST NOT 猜测、
   MUST NOT 默认按任一侧处理；
3. **不新增机器门**：MUST NOT 为正式性判定新增 `track_scoring` 条目、新档位或机器
   BLOCKER；判定结果 MUST NOT 成为可手改的持久状态字段。

**全入口兜底**：统一入口与首个实际 Skill 在首次冻结施工意图处 MUST 识别事项符合正式
需求判据却未经蓝图的情形，指出应先经 `/component-design` 并给出回退入口。兜底 MUST NOT
依赖本次执行 spec；已移除 `/change-lite` 入口。MUST NOT 新增正式性评分、
持久分类字段或阻断式机器门。只设计、审查或测试的请求 MUST 在其授权终点止步，
MUST NOT 冒充完整实现交付或绕过正式实现需求的蓝图准入。

#### Scenario: 上游显式分类具有权威性

- **WHEN** 上游把一项事项显式标为正式需求，而本地启发式认为它只是文案调整
- **THEN** 该事项 MUST 按正式需求处理并进入蓝图入口，不得被本地判断降级

#### Scenario: 入口信息不足时询问而非猜测

- **WHEN** 事项描述不足以判断它是否改变部件行为、外部契约、数据/NFR、运行语义或架构责任
- **THEN** 入口 MUST 向人提出判定问题并等待确认，MUST NOT 自行择一继续

#### Scenario: 首个实际 Skill 兜底不依赖 spec

- **WHEN** 一项符合正式需求判据的事项被直接带入 coding
- **THEN** 首个实际 Skill 在首次冻结施工意图处 MUST 指出应先经 `/component-design` 并给出
  回退入口；MUST NOT 因为本次没有 spec 阶段而失去兜底

#### Scenario: 正式性判定不得变成机器档位

- **WHEN** 某 change 为正式性判定新增 `track_scoring` 评分项或阻断式 BLOCKER
- **THEN** 该 change 违反本契约，openspec review MUST 拒绝

> **Enforced by:** 本 capability spec 与父 goal §8/§9；全入口接线由动态工作流 P6 在
> `templates/AGENTS.md.template`、`skills/feature/*/SKILL.md` 和 `skills/project/*/SKILL.md` 承载。
> 当前入口按请求义务与蓝图准入执行；`/change-lite` 已退役，非 lite 旧定义不在本批删除。

