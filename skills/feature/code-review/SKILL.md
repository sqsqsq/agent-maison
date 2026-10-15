# Code Review Skill (`code-review`)

审查当前 diff、提交或指定文件；无需 Feature。默认只审不改，报告问题的触发条件、影响和文件依据。

## 按请求终点进入

| 请求 | 输入与执行 | 终点 |
|---|---|---|
| 普通审查、解释代码 | 确定目标文件与比较基线，读取下方共享方法和适用项目知识 | 在对话交付发现及覆盖说明；不创建 request、facts 或报告模板 |
| 用户要求持久且经 checker 校验的报告 | 用 [request CLI](../../../docs/operations/request-harness.md)，`targets.files` 点名目标；先 `--prepare-request`，再 Research、写报告、执行同一命令 | 只写显式 report-dir；如实呈现结构检查和审查结论 |
| 正式 Feature/CU review | 先完整读 [正式前置](../../reference/code-review-workflow-detail.md#正式-featurecu-前置) 与 [正式阶段](../../reference/code-review-workflow-detail.md#正式-featurecu-阶段) 再执行，消费绑定契约与写范围 | 按原 required 证据闭环，不自动追加 UT/testing |

已有正式交付责任继续用对应 Feature 路径。纯审查不要求 DevEco、设备、全局 setup、需求号或六章报告。
正式阶段的**闭环停等**按 [用户确认 UX](../../reference/user-confirmation-ux.md) 的 `review.ok_to_ut` / `phase.next_step` 与已有授权裁决；独立请求到本次审查终点结束。
request/正式调用的输入身份与 facts 按 [输入契约](../../../docs/concepts/skill-contracts.md#facts-11) 解析；不自行补造身份。

## 共享审查方法

读取 [共享审查方法](../../reference/code-review-workflow-detail.md#共享审查方法)：确定范围 → 阅读目标和调用链 → 按适用维度核查 → 给出有依据的发现。
独立请求和正式阶段使用同一方法；契约、验收、视觉报告等只在本次适用时加作对照。
只解释代码时读取相关代码并解释行为与依据，到解释终点结束，不扩展成整轮审查。

- 按需读架构、module catalog、术语和当前 profile；`paths.conventions` 存在时读全文并打开适用范例，核对方式见同页「工程惯例核对」。无知识文件就读代码，不为开始审查先建知识资产。
- 审查 ArkTS/资源/导出等宿主特有代码时，加载 `framework/profiles/<project_profile.name>/skills/code-review/profile-addendum.md`。
- 缺少设计依据、未执行编译或未上设备的部分明确写为未验证；不从实现反推要求，不宣称机器或视觉验证通过。
- 用户仅要求 review 时不得改产品或测试；已授权同时修复时，在该授权范围内继续，并说明改动与适用验证。审查不自动扩展到其它职责。

## 输出

按影响排序列发现，每项给具体触发、影响、文件位置与最小修复建议；无发现时说明已读范围和验证缺口。
普通 review 不强制编号表、统计或落盘；用户要求存文件时保存本次结论，只有要求 checker 校验才采用现有报告模板和 request 通道。
机器报告使用 [review-report-template.md](templates/review-report-template.md)，章节/统计检查通过不代表语义必然正确。
宿主内置 `/review` 的路由由宿主决定；Maison 显式入口为 `/code-review`，自然语言是否选中以实际调用为准。
