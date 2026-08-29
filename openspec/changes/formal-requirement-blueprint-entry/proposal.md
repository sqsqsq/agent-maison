## Why

已归档的 `complex-capability-meta-model` 把部件演进蓝图定位为"复杂多单元需求才启用的可选
路线"：`Dual entry semantics` 只覆盖复杂需求的两种入口，`Meta-model object identities and
reference directions` 明文保留"独立小需求单元…允许无蓝图引用、只走单元闭环（不属于双入口）"。

该定位在真实宿主面前被证伪。宿主同事在没有蓝图可用时用 extension 造出 `/story`：上游拉料 →
只含需求投影的 design.md → 先写 spec → 再从 spec 反向装配"设计文档"。流程别扭的根因正是
**中间缺一个部件内设计权威**——正式小需求没有任何部件内设计环节，产品行为、外部契约、数据/
NFR、运行语义与架构责任的裁决只能挤进 spec 或事后从 spec 反推，形成平行设计真源。

组织现实（用户裁决）：**部件内设计环节（组织称 Story Design）对每一项正式需求都是必经的，
区别只在内容多少**。3.1.0 尚未发布，可在窗口内原位纠正（M5A 同款先例），不建兼容层。

## What Changes

- **统一正式需求入口**：把 `Dual entry semantics` 从"复杂需求双入口"改写为"**统一正式需求
  入口 + 两种上游输入形态**（跨部件投影 / 本部件直供）"。两种形态是同一入口的两种上游输入，
  不是两条路线。
- **正式需求定义入规范**：新增判定契约——"有明确交付或验收责任，且拟改变部件行为、外部
  契约、数据/NFR、运行语义或架构责任的事项，按正式需求处理；不改变这些语义的纯文档和机械
  维护除外"，并固化三条判定纪律（上游显式分类具权威性 / 信息不足由人确认不猜测 / 不新增
  track scoring 或机器 BLOCKER）。
- **条件式设计义务**：把原来的"三条 AND 入口门"降为**只在对应事实出现时触发的设计义务**：
  多 CU → CU 边界与关系分析（真实依赖、共享资源、可并行性、独立性），只有事实要求时才生成
  `requires` 与顺序约束，不得为记录先后伪造依赖边；共享部件级决策 → 蓝图裁决一次、各 CU 经
  `design_refs` 消费；"单独绿 ≠ 整体完成" → closure 追加真实组装与组合证据。安全中间态是
  单/多 CU 通用义务，不挂在 ≥2 CU 条件下。
- **applicability 与 evolution_impact 正交**：视图的"部件类型固有适用性"与"本次演进影响"是
  两个正交维度，固化为元模型级约束，禁止用三态枚举合并（会让既有按字面 `applicable` 判断的
  消费者静默跳过 changed 视图）。
- **轻量路径条目改写**：`Meta-model object identities and reference directions` 中的"独立小
  需求单元…允许无蓝图引用"改写为**非正式维护动作**与**存量平铺 Feature 的兼容表述**——存量
  不迁移、不自动转 CU、不 credit，孤儿单元仍不得进入 Component closure 聚合。
- **BREAKING（未发布窗口内原位纠正）**：正式小需求"允许绕过蓝图"的规则被撤销。3.1.0 尚未
  发布，无消费者存量，不建兼容层、不设档位、不设升级信号或升级状态机。

不做：不新增 compact/full 蓝图档位、蓝图类型字段、升级状态机；不新增 `track_scoring` 条目或
正式性判定的机器 BLOCKER；不改动本 capability 的父目标声明校验（Requirement 1–3）。

## Capabilities

### Modified Capabilities

- `complex-capability-meta-model`：入口语义从"复杂需求双入口"改为"统一正式需求入口 + 两种
  上游输入形态"；新增正式需求判定契约、条件式设计义务契约与 applicability/evolution_impact
  正交约束；轻量路径条目改写为非正式维护动作与存量兼容表述。

## Impact

- 上位约束：`.cursor/goals/复杂能力建设目标_…_75411223.goal.md`（§0/§0.1/§1/§2.2/§3/§3.2/
  §8.1/§10/§11.2/§13/§14/§15/§16 同批修订，dev-only）。
- 同批修订的未归档 change：`app-component-blueprint-and-reconciliation`（P1 协议与三条接缝）、
  `change-unit-and-continuous-progression`（P2 设计准备子流程与单 CU 路径）、
  `component-assembly-and-coverage-closure`（单 CU 退化 closure）。
- 发布件：`/component-design` 编排 Skill、`templates/AGENTS.md.template` §4.0、
  `skills/reference/real-host-admission-and-feedback.md` §1、
  `docs/operations/component-design-host-adaptation.md`。
- 不触碰：P1 tasks 6.6、P2/P3 tasks 7.5、`release-semantics.json` 的 release 收口、总计划 m5
  完成状态。
