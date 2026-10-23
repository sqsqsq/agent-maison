## Context

实施依据为已批准 c2f7a91e plan，起点 242f6b1d，版本 3.1.0。179a73 原件只读保全，在开发副本重放 i6 入场前状态；宿主与设备不写入。

## Goals / Non-Goals

**Goals:** 退役 lite，统一真实责任与授权消费，允许有限测试兼容修补，保留有效历史写入与原 facts 基线，使可恢复任务沿既有责任闭环完成。

**Non-Goals:** 不新增 owner 注册表、持久角色/候选字段、恢复状态机、采纳协议、场外快照或预算；不改四条总原则、版本及其它计划范围；开发验证不替代联合宿主验收。

## Decisions

1. `repair-responsibility.ts::resolveRepairResponsibility` 是唯一内存责任解析入口。原始 Skill produces/verifies、artifact inventory、profile UT 根、施工绑定读取集中于此；写界只投影，候选/assess/runtime 读相同结论。剩余队列决定执行动作，不决定 owner。source_phase 不作为致因者证据，未知保持未知。
2. 类别复用 CorrectionCategory；verification 由实际产物/义务选 owner 和已有 fact kind。保留旧三类读兼容，但不据旧 coding 标签给测试写权；复用已有指纹、拒修与预算。
   逐条 `issue-verification` 可选形状增加既有 `repair_owner` 字段消费：场景是独立 verifier 已核实成因与真实修复对象，但责任在原通道丢失；收益是避免根据诊断位置或自由文本猜派。旧 issue/verdict/evidence 原样兼容，不新增候选字段。该值必须绑定原 issue、当前 subject 与原 evidence，不能覆盖目标契约/授权/保留检查；owner 与真实对象不一致须反馈原报告更正对象，不能仅填 owner 跳转。
3. coding 的现有 source/implementation 契约允许既有类型/import/数据/替身兼容修补；新增用例和断言归 UT。唯一新检查 `coding_existing_test_preserved` 比较真实前置原件与当前测试片段，不能从哈希还原字节；UT 合法更新后的前置字节不可由旧 Git baseline 替代。无法确认交 UT/披露缺口。既有报告披露修改原因，无新披露门禁。
4. requires、control_edges 和实际绑定决定上游与失效；review 与 UT 可独立消费 coding，testing 仍须两者闭合。内部交接不伪装外部阻断，不把 FAIL 改成 PASS。
5. 重开撤销质量证明但不抹历史合法写入；facts 继续绑定原建立者和基线，下游只添本阶段 delta。超界旧测试字节由真实 UT 修改或沿晚于误写的有效 manifest 核验采纳，后续越权仍使其 void。
   合法新生后继与同 run 队列重排分开：仅沿既有 successor_of 与 audited supersede，原 facts 确属直接前驱、旧基线无法有效复用且当前阶段就是新 run 不可变出生首阶段时，允许建立新 run facts。同 run、来源不符、非出生阶段均不得借此重建；旧事件/证据与累计预算不变。
6. lite 专用产物全部删除；modern 残留 track 键提示忽略；旧冻结 change/exit 链先诊断迁移，不转换 full。保留非 lite spec-driven。

## Risks / Trade-offs

- [前置原文不可取得或解析不确定] → 不授有限豁免，走既有 UT/能力缺口出口。
- [旧三类候选和 full 快照仍在使用] → 生产入口兼容读取并以相同责任上下文解释，保持原轮次身份。
- [profile/adapter 差异] → 复用既有 UT 根和解析能力，缺失能力如实披露，移除 lite adapter 入口。
- [scope 重排使 facts 建立者缺席] → 读原 invocation context/合法写入，不按当前首项重定义。

## Migration Plan

MIGRATION.md 明示 lite 移除与旧运行处理；所有当前入口停止推荐 change-lite。已完成计划与历史原件保持事实。目标测试稳定后统一执行官方 harness 全测、全部受影响 release-only 分片、OpenSpec/plan/LF 校验与实际 Claude CLI review。`release:verify` 是后续获准发版的既有门禁；本轮用户禁止打包，不执行会生成 zip 的命令。

## Open Questions

无新增待裁决；编码与统一 review 按本轮授权完成，联合宿主观察保持 pending。
