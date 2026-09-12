## 1. 合同与消费

- [x] 1.1 按 P4 修订 coding/review contracts、Skill、phase rules 和 verifier。
- [x] 1.2 coding 接入解析设计、冻结写集与首阶段 facts，保留原生编译和 CU 检查。
- [x] 1.3 review 接入组合设计与专项请求，保留基线、内容和 Feature attestation 边界。

## 2. 验收

- [x] 2.1 补充真实施工输入、越界/缺失/漂移及独立 review 用例，核对既有回退与未完成义务。
- [x] 2.2 运行 typecheck、目标测试、harness 全量、OpenSpec 与 plan/diff/LF 校验，更新状态与实施记录。

正式发布前 mandatory `npm run release:verify`（或 release:all）。本批不发布，默认切换与 MIGRATION.md 汇总归 P7。未调用 openspec update。

## 实施记录（2026-09-12）

- 前置 P6 专项入口段已单独提交为 `ca8cb82c`。本 change 仅实施 P4，P5 测试义务与原生 provider、P6 其余项、P7 默认迁移和真实宿主验收未提前实施。
- coding/review contracts 升为 1.1，消除现代 coding full/lite 能力分轨与 review 无条件 coding 控制前提。旧 workflow 调用保留窄兼容；现行默认 workflow 不提前切换。
- coding 模块/文件检查和 UI 写集门复用既有 run baseline 与 P1 绑定契约，phase-write-boundary 同步消费，缺 plan.md 不丢失授权来源。编译、引用闭包、分层与 CU 专业检查保留。
- review 使用实际解析的代码目标和设计/验收；组合实现缺必需对照资料仍失败。专项复用同一 CLI、内容检查、惯例核对与隔离报告；Feature attestation 仍走原路径。
- coding/review 的 CU `planned:` 实现引用在落地阶段读取真实文件/符号，不要求 coding 修改冻结契约；缺文件/符号仍失败。UT/testing 的 planned 规则未改。
- Skill 与 verifier 明确首阶段 facts、蓝图/runtime/组件资产逐项对照、设计归因回退和请求终点。既有 P1 prompt collector 已注入 typed 内容，无另建上下文或完成记录。
- 定向通过：standalone-coding-review 3/3（真实出生、修改源码、桥接、原生 TypeScript 编译、已提交越界文件、未授权 UI 资源、契约漂移、缺必需设计）；blueprint-skill-projection 21/21（新增派生/物化到 coding/review 与 verifier 材料、CU sidecar/真实目标）；request-entry 15/15；phase-write-boundary 8/8；skill-contract 8/8；capability-degradation 18/18。typecheck、OpenSpec 43/43、plan/diff 检查通过。
- 全量 `npm test` 的 typecheck 通过；单测首轮 4457/4458，唯一失败为 coding Skill 未明确保留“建立阶段”的文案断言。仅补回量化/探索适用说明后，context-facts 21/21 复验通过；其余 4457 条结果复用，随后 test:fixtures 46/46 通过。日志分别为 `harness/reports/p4-harness-validation.log`、`p4-facts-recheck.log`、`p4-fixtures.log`。未因纯文字返修重复全量单测，未将首轮记录写成一次全绿。
- P4 plan 四项 todo 与本 change 五项任务已完成，定稿计划正文未改写。尚未提交 P4；下一交接为 P5，真实 RDB/设备宿主结论由 P7 汇总。

## 两项局部返修（2026-09-12）

- 组合 Feature review 在现有 P2→P1 桥接处，将 run baseline 的实际变更与冻结 contracts.files 求交，补入出生来源未包含的新增实现。P1 code、facts source_paths 和既有报告覆盖检查消费同一集合；专项 request 仍只读取明确指定的目标。
- UI capability 复用已明确的 visual-evidence=N/A；use_cases 复用 P3 已解析的 use-cases@1 与生产输入依赖，绑定重读仍核验依赖和内容指纹。真实缺失、非法输入与其他增强缺失继续沿原有 blocked/pruned 规则处理。
- 新增“出生授权新文件→coding 创建并提交→真实桥接→输入/facts/报告覆盖”用例；旧文件报告遗漏新实现时失败。专项 CLI 用例明确核对目录内其他文件不被加入目标。蓝图派生/物化用例增加 N/A、use_cases resolved 和绑定重读断言。
- 定向通过：施工/审查 4/4、蓝图输入 21/21、专项 CLI 15/15、能力降级 18/18；typecheck、OpenSpec 43/43、plan/diff/LF 检查通过。本轮 `cd harness && npm test` 全通过：4459 单测、46 fixtures，日志为 `harness/reports/p4-repair-harness-validation.log`；两项返修与验收已收口。
- 不修订计划正文，不修改设计阶段写归因诊断，不涉及 P5；未提交代码。
