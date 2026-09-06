---
name: 六阶段重构 B06 提纲 — 四主格差异验收与发布就绪
overview: 复用前五批C-U实跑，补Claude非goal及Codex goal/非goal真实差异；codeagent/attended仅回放fixture，不要求缺席工具实测。
version: 3.0.0
todos:
  - id: b06-detail-from-host-evidence
    content: 依据B01至B05宿主证据细化差异格、实际入口、版本/模型、命令和缺口；不重新规划或重跑已有效的C-U验收。
    status: pending
  - id: b06-core-four-cells
    content: 复用C-U，用户触发C-N/X-U/X-N真实差异验收，覆盖六阶段公共契约、verifier/视觉/回修/收口。
    status: pending
  - id: b06-secondary-fixtures
    content: codeagent的K-N/K-U/K-A及C-A/X-A用静态/生产函数/录制回放/fixture覆盖，K-A明确manual回退，不新增能力或实测义务。
    status: pending
  - id: b06-integration-handoff
    content: 实施方准备校验candidate和精确集成/物化/运行说明，由用户触发或明确委托；不得自动改主宿主framework或入口。
    status: pending
  - id: b06-record-impact-gaps
    content: 从已有日志记录逐批目标/重复调用/真实差异与缺口，区分实测/回放/fixture，复用d2f7a9c4有效宿主证据。
    status: pending
  - id: b06-release-readiness
    content: 完成必要全量/OpenSpec/plan校验、候选件用户验收、迁移说明与evaluator准备，真实完成后收口总plan，不把正式发布设为前置。
    status: pending
---

# B06滚动提纲

总plan：[9c6e2a41](pipeline_master_9c6e2a41.plan.md)。前批均已有C-U宿主反馈，本批只补差异、完成发布就绪，不等此批才首次上宿主。

## 核心四格

| 格 | 实际工作 |
|---|---|
| C-U | 复用B01至B05实际goal回归与至少一条公共六阶段贯穿链；新增生产变化才补对应验证 |
| C-N | 用户触发Claude非goal：当前Task调用、报告写入、无goal身份、Stop辅助与manual/batch授权 |
| X-U | 用户触发Codex goal：exec JSONL、已确认verifier能力、视觉/审计区别、负面回修与收口 |
| X-N | 用户触发Codex非goal：当前Task协议、无hook依赖、材料验证与正式harness闭环 |

公共六阶段契约通过生产集成参数化覆盖；真实差异以同一HMOS产品基线和有效构建/材料复用，避免每格重新开发同一需求。不得仅凭adapter.yaml声明把差异格标实测通过。

## 补充覆盖

K-N/K-U/K-A与C-A/X-A仅静态、生产函数、录制回放或fixture。codeagent本机缺席实跑条件不阻止本轮范围收口；其manual回退不叫自治支持。attended的callback/身份/waiting/无stdout用生产bridge fixture验证，明确未实测。

原生/goal及goal-mode元数据只核当前实际入口，不新增支持。Codex已确认verifier能力不因缺Claude hook被撤销；不再推断Task API不存在。

## 用户触发的宿主边界

实施方先完成候选件、版本/内容说明和逐条可执行命令。替换D:/1.code/SimulatedWalletForHmos的framework、物化.claude/.cac/.codex、启动真实goal或设备运行，均由用户触发或明确委托；“实施此plan”不自动授权这些主宿主变更。

优先隔离验收副本，保留用户现有工作；即使用户授权集成也不得热修改候选zip解压后的framework源码。验证发现框架缺陷回开发仓修，重新构建候选件，再由用户触发下一轮。

## 验收与发布就绪

复用 [candidate-release](../../scripts/candidate-release.mjs)：candidate:build完成测试/pack/verify；用户集成同一zip并触发consumer golden evaluator。真实结果写入已有报告，记录adapter/模式/覆盖阶段、版本/模型可得性、证据路径、实测或fixture等级及缺口。

核心四格须有真实差异结论；补充格未真测明确披露，不伪造支持。无主格实测条件时保留对应todo，不以回放替代真实要求。收益从已有events/build/UT/device日志提取，不建设A/B或新基准系统。

发布内容验收遵守AGENTS，复用有效全量结果，纯文案返修不重复全测。实施及用户宿主验收完成后才勾各批和总里程碑；随后用户按既有candidate:promote与evaluator报告提升同一zip、补全局plan门禁。不为过门禁提前勾完成，不把正式promote作为plan完成之前的循环前置。本计划完成只表示候选件验收和发布就绪。
