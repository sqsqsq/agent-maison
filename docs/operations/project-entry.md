# 项目请求与统一入口

入口 ID 和路径只查 [skills.index](../../skills/skills.index.yaml)，phase/checker 查活动 workflow。下表是职责说明，不是第二份路由或执行配置。项目动作使用现有 CLI 参数，不创建 invocation 文件、Feature、CU 或 Goal 来承载无关操作。

| Skill / global phase | 本次输入与原生入口 | 产出与停止点 |
|---|---|---|
| framework-init / init | 现有 config、安装版本、选中 adapters；`init-orchestrate.ts` | 只完成明确安装/更新/配置；UPDATE 保留无关知识，next-steps 是建议 |
| catalog-bootstrap / catalog | 请求模块、当前源码与已有 catalog；`harness-runner.ts --phase catalog --module <name>` | 合并该模块画像，保留其他条目；不继续 glossary/Graph |
| catalog-bootstrap / glossary | 请求词条、上下文、已有术语与 semantic owner；`--phase glossary --term <term>`（可按 `--module` 选择） | 合并选中词条；跨条目消歧仍校验，不要求整个 catalog 完整 |
| code-graph / module-graph | 模块源码、有效 catalog 或显式 package-path；`bootstrap-code-graph.ts --project-root <root> --module <name> [--package-path <path>]` | 只刷新该模块 derived、保留 nodes；仅策展请求进入策展确认，完成不启动 UT |
| docs（无独立 Skill） | 文档 inventory、请求路径及已登记 source；`--phase docs --path <inventory-path-or-directory>` | 校验选中文档存在、来源与 freshness；不创建 Feature 或补全部文档 |
| extension / extensions | 现有 manifest、动作及 bindings；`extension.ts --project-root <root> --action inspect\|init\|materialize\|verify` | 仅完成该动作；verify 使用现有 extensions checker，不安装 MCP/凭据、不改发布件源码 |
| conventions-bootstrap | 当前候选约定、来源和策展授权；现有 Skill staging/合并流程 | 本次约定策展；未授权语义规则不提升为组织规则 |
| component-catalog-bootstrap | 源码索引、部件卡与使用边界；`bootstrap:component-index` 及原有策展检查 | 本次索引/知识增量；不自动批准依赖关系 |
| component-design | 请求、既有需求源/蓝图与缺口；现有 `check:component-blueprint`、view/draft/continue 路径 | 查看不写 canonical/revision/CU/run；局部设计到请求终点，完整设计到 CU readiness 后交还 |
| change-unit-progression | canonical CU、现有 Feature/run 事实；现有 CU 推进与 Goal prepare-run | 只选择或恢复已授权 CU，不代签部件完成 |
| component-closure | 蓝图、CU 完成证据与装配义务；`check:component-closure` | 校验部件终点；不是 CU 全绿即部件成功，只有明确写入请求才用 `--write` |
| goal-mode | 授权终点、规范化 P2 输入或已有 run；原有 `goal-runner` / `goal-phase-runtime` | 按冻结范围执行/恢复；不生成第二份阶段、豁免或完成真源 |

上述 harness 参数在 `framework/harness` 调用，global 阶段沿用 `_global` 报告，不要求 `--feature`。不带局部选择参数表示明确请求项目级校验；带选择参数只检查对应集合，未找到目标必须报告缺口。Graph 生成与 `--phase module-graph` 必须传同一组 module/package-path。显式配置文件不可读、损坏与可选知识缺失不同：前者修复来源，后者由实际职责决定是否需要补充。

来源解析复用当前 catalog/glossary/config/Graph parser 与 P1 的真实路径绑定原则，不另建快照或状态。global phase 使用 P2 resolver 的 request 终点，`requires` 所表达的资料依赖不自动启动资料生产阶段。非 phase CLI 继续用自己的 validator；项目结果不宣称 Feature completion。

## 主 Agent 与子 Skill

自然语言由主 Agent 按根入口的正式性判据解释。显式 Skill 只授权本次职责；查看、局部设计、完整设计分别到对应终点。只读请求不因存在可补资料而写盘。设计 Skill 返回 readiness/缺口；只有用户已授权完整实现，外层才沿既有 CU 入口创建或恢复真实 attended Goal，复用 P2 范围计算、P4 coding/review 与 P5 验证。

无 Feature 的局部 review/UT/testing 使用已交付的 [request CLI](request-harness.md)，结果隔离在显式报告目录，不能伪造 Feature 或借用活跃 Feature 证据。完整实现根据实际义务安排验证，未知责任保留 unresolved，不因输入可解析就宣称验收通过。

完整交付的机器接线复用 [P2 输入协议](../concepts/skill-contracts.md)：已有 CU 对应 Feature 的 `feature.yaml.execution_scope` 只承载出生前请求与来源事实候选；1.2 workflow 下，`goal-mode-entry --prepare-run --run-mode attended` 经现有 resolver 计算并冻结范围，再按返回的真实 run 身份 attach。不得手写已满足义务或运行结果，也不为已全部复用的空范围创建 run。旧 run 直接恢复，不重新读取候选；默认使用 obligation-driven 1.2；旧内置定义仅供兼容恢复。

“继续”先读当前 active run、冻结 execution_scope 和 successor/revision，不重新选择流程。新请求使用 obligation-driven；旧 run 通过内部兼容定义恢复，旧公共跳板由 UPDATE 备份清理。真实授权、策展语义、预算和外部不可逆动作继续使用既有确认点；已有授权不重复询问。init-next-steps 不授予任何后继执行权。
