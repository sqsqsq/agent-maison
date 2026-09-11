## Context

实施依据是动态工作流总纲 91c4e7a2 的 g1、§4–§9，以及父 goal 75411223 的权责边界。本次执行已评审方案，不重新设计 P1–P7。
OpenSpec 是可读行为约束；发布态真源仍为 specs/workflows/harness。新协议条款是待接线合同，g1 完成不等于动态能力上线。

## Goals / Non-Goals

**Goals:** 通过完整 requirement delta 同步六份现行规范，修订父 goal §8/§9，并完成规范和 plan 校验。

**Non-Goals:** 不改 P1–P7 生产实现、已定稿 plan 正文、历史 archive、公开入口或发布件，不提前完成宿主验收。

## Decisions

1. 在原 requirement 内替换固定链的权威语义，不另建规范域或只追加一个与原文矛盾的旁路。旧协议规则明确收窄为兼容规则。
2. 保留信息/格式/控制依赖区分、正式需求蓝图准入、必要 CU 机器映射和 Feature/CU/Component/跨部件完成边界。减少阶段不降低交付责任。
3. 运行范围沿现有 Feature 候选与 Goal manifest 冻结路径；新事实由责任方裁决、前驱封卷交接、后继重签。四项接线约束分别保留：交互 Feature 真实 run；首 Skill 建立 facts；新范围后继交接；无 Feature 专项请求与独立报告。
4. 本次将 delta 同步到现行 specs 供后续 change 基于新语义工作；保留本 change 的完整 delta 供追溯，暂不归档。归档时不得用本 delta 覆盖后续子 change 的新增修订。

## Risks / Trade-offs

- 规范先于生产实现 → 每份受影响现行规范注明落地状态，已有 enforcement 路径是后续接线位置，不能据此宣称验收通过。
- 子 plan 重复拥有行为 → 本 change 只拥有共同边界；结构、版本号、CLI 和机械场景由下表所列 change 维护。
- 旧 run 被新默认解释 → 依出生协议隔离 reader，旧字段缺失不得解释成零义务；默认公开切换统一归 P7。

## Migration Plan

| 后续 owner | Change | 交接内容 |
|---|---|---|
| P1 | composable-skill-inputs | 输入矩阵、contract/resolver、SpecLoader/evidence/facts |
| P2 | obligation-execution-scope | 义务范围、run 冻结、assess、completion/resume、后继交接 |
| P3 | blueprint-backed-skill-design | 验收和施工投影、设计责任 |
| P4 | standalone-coding-review | coding/review checker 与证据 |
| P5 | obligation-scoped-verification | UT/设备/视觉、零设备正反例与既有 R8 回归 |
| P6 | scope-aware-project-entry | 全项目入口、专项 CLI 与报告、adapter |
| P7 | dynamic-workflow-closure-migration | CU/Component、旧 run、MIGRATION.md、公开切换、宿主验收 |

顺序沿总纲：P1 → P2 → P3 → P6 §3.1–3.2 → P4 → P5 → P6 其余 → P7。profile 决定执行支持、adapter 决定调用能力，均不取消业务义务；本次无 profile/adapter 发布变化。
本次仅文档可逆修改；不运行部署、安装或发布门。正式发布时仍必须执行 `npm run release:verify`（或包含它的 `release:all`）；发布内容改变时必须执行 `cd harness && npm test`。这两项不属于本次 g1 完成条件，遵守总纲 §11 的验证范围。

## Open Questions

无新增阻断问题。真实宿主资料与执行证明由 P7 收口，不能用本次规范校验替代。
