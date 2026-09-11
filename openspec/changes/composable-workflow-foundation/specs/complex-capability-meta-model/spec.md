## MODIFIED Requirements

### Requirement: Meta-model object identities and reference directions

三类对象 MUST 保持以下身份与单向引用边界，P1/P2/P3 的实现 change 以此为准入约束，
违反即 openspec review FAIL：

- **部件演进蓝图**承载**一项正式需求在当前部件内的目标态与共同决策**：MUST NOT 冒充当前
  事实真源，MUST NOT 拥有 phase 运行裁决权；当前态断言 MUST 引用代码/schema/接口/测试等
  事实来源；
- **Change Unit**：凡属某部件蓝图分解产物的单元 MUST 引用恰好一份所属蓝图，只消费显式
  `requires`、只声明显式 `provides`；**非正式维护动作**（不改变部件行为、外部契约、数据/
  NFR、运行语义或架构责任的纯文档与机械维护）MUST NOT 被要求建立蓝图或 canonical CU，它
  按请求终点与真实输入独立执行，不强造 Feature/CU/run；**存量平铺 Feature**（无 `change_unit_ref`）MUST 保持既有
  行为，MUST NOT 被自动迁移、自动转为 CU 或自动 credit completion；上述两类单元在显式归属
  某份蓝图前 MUST NOT 参与任何 Component closure 聚合；
- **Component closure** MUST 由蓝图、单元契约与既有执行完成事实（events/receipt/
  evidence）派生，MUST NOT 引入可手改完成台账或第二恢复权威；单元数量为 1 时，closure
  MUST 退化为"需求 → 蓝图稳定地址 → CU `design_refs` → 完成证据"的追溯核对，跨单元组装边
  为空集 MUST 视为合法结论而非缺项，MUST NOT 因此新增第二套 mapping schema 或第二次验收；
- 引用方向单向：CU→蓝图、closure→（蓝图+CU+完成事实）；蓝图 MUST NOT 反向依赖单元
  运行时状态。

#### Scenario: 孤儿单元不得进入部件闭环

- **WHEN** P2/P3 的实现允许一个无蓝图引用的单元参与某部件的闭环聚合
- **THEN** 该 change 违反本契约，openspec review MUST 拒绝

#### Scenario: 存量平铺 Feature 不被自动 credit

- **WHEN** 某实现把无 `change_unit_ref` 的既有平铺 Feature 自动登记为某蓝图的 CU，或把它的
  completion 计入该部件 closure 覆盖行
- **THEN** 该 change 违反本契约，openspec review MUST 拒绝；存量只能作为当前事实来源被蓝图
  消费，显式归属必须由人/设计者裁决并写出 canonical CU

#### Scenario: 单 CU 闭环不产生第二套协议

- **WHEN** 某蓝图只分解出一个 Change Unit，其 closure 需要评估
- **THEN** 实现 MUST 复用同一 closure 算法并把跨单元组装边判为空集通过，MUST NOT 引入单 CU
  专用的 mapping schema、专用状态或第二次验收入口

> **Enforced by:** 本 capability spec 作为 P1/P2/P3 change 的准入约束（review 门），
> 运行时 enforcement 随 P1/P2/P3 各自的实现 change 落地并回填引用

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
依赖本次执行 spec；旧 `/change-lite` 入口在兼容期保持同一纪律。MUST NOT 新增正式性评分、
持久分类字段或阻断式机器门。只设计、审查或测试的请求 MUST 在其授权终点止步，
MUST NOT 冒充完整实现交付或绕过正式实现需求的蓝图准入。

#### Scenario: 上游显式分类具有权威性

- **WHEN** 上游把一项事项显式标为正式需求，而本地启发式认为它只是文案调整
- **THEN** 该事项 MUST 按正式需求处理并进入蓝图入口，不得被本地判断降级

#### Scenario: 入口信息不足时询问而非猜测

- **WHEN** 事项描述不足以判断它是否改变部件行为、外部契约、数据/NFR、运行语义或架构责任
- **THEN** 入口 MUST 向人提出判定问题并等待确认，MUST NOT 自行择一继续

#### Scenario: 首个实际 Skill 兜底不依赖 spec

- **WHEN** 一项符合正式需求判据的事项被直接带入 coding（或旧协议 `/change-lite`）
- **THEN** 首个实际 Skill 在首次冻结施工意图处 MUST 指出应先经 `/component-design` 并给出
  回退入口；MUST NOT 因为本次没有 spec 阶段而失去兜底

#### Scenario: 正式性判定不得变成机器档位

- **WHEN** 某 change 为正式性判定新增 `track_scoring` 评分项或阻断式 BLOCKER
- **THEN** 该 change 违反本契约，openspec review MUST 拒绝

> **Enforced by:** 本 capability spec 与父 goal §8/§9；全入口接线由动态工作流 P6 在
> `templates/AGENTS.md.template`、`skills/feature/*/SKILL.md` 和 `skills/project/*/SKILL.md` 承载。
> 旧 `/spec`、`/change-lite` 兜底在兼容期保留；g1 不宣称入口已切换。

## ADDED Requirements

### Requirement: Applicable construction obligations preserve layered completion

蓝图 MUST 保持正式需求目标与共同决策权威，CU MUST 保持当前切片与目标谓词；spec/plan 只补本次未满足的验收/施工设计义务。已有合法完整内容可经施工投影承接，MUST NOT 为阶段形式重写共同设计或生成空文件。信息/格式承接 MUST NOT 代替真实授权与先行控制事实。

独立 Skill 完成只表示请求职责完成；Feature 完成 MUST 由同一有效范围、适用目标与既有真实运行证据验证，不以末段名称或阶段自报完成判定。CU MUST 只消费独立验证的 VALID completion 和当前 CU 映射；Component closure MUST 继续检查共同决策、目标覆盖与真实组装义务；跨部件能力完成仍归上游。合法无蓝图维护/专项入口 MUST NOT 被强造蓝图、Code Graph 或 CU。

#### Scenario: Different units have different phase scopes
- **WHEN** 同蓝图的两个 CU 分别是内部逻辑修复和页面交互
- **THEN** 两者 MUST 可采用不同执行范围，部件闭环仍检查真实组装与组合证据

#### Scenario: Design-only request stops at design
- **WHEN** 用户只授权设计，尚未请求实现
- **THEN** 设计结果 MUST 不自动创建施工 run 或被解释为 Feature/CU 已交付

> **Enforced by:** 父 goal §8/§9 与本规范；后续动态工作流 P2/P3/P7 在
> `harness/scripts/utils/verify-feature-completion.ts`、
> `harness/scripts/utils/change-unit-completion.ts` 和
> `harness/scripts/utils/component-closure-obligations.ts` 接线。
