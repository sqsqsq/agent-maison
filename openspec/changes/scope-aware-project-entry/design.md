## Context

P6 §3.1–3.2 与 P4/P5 已交付；本批补齐 P6 的项目级入口及意图迁移。旧运行恢复读取保持兼容，默认工作流与公开旧入口退役由 P7 处理。

## Goals / Non-Goals

**Goals:** 真实 prepare/run CLI、目标/基线绑定、独立 request CheckContext、同一 checker 与隔离报告。

**Non-Goals:** 不创建 Feature/CU/run，不新增命令 registry、通用执行器或控制文件；不猜测测试命令，不将请求提供的报告当作执行成功。

## Decisions

1. 在现有 entry-input parser 扩展请求解析；request JSON 只包含已定稿字段。准备阶段解析 Git refs、真实路径及输入哈希，计算 request_sha256，只输出 JSON，不写控制文件。
2. CheckContext 按 subject 区分 Feature/request；旧 Feature helper 保持显式 Feature 类型默认，共享 checker 边界使用联合上下文。request 不含 feature/FeatureSpec，不读取 Feature 状态。
3. 输入复用 P1 catalog、artifact parser 与 derive provider；目标和结果路径显式传入。专业 provider 仍由安装的 profile 选择，不接受 request 命令字符串；不支持 request subject 的 provider 返回缺口，不能伪装成功。P4/P5 继续迁移专业职责与宿主实现。
4. report-dir 解析真实路径，拒绝 framework、.git、features_dir、目标源文件或其他请求的机器输出目录。报告使用既有 checks/summary 聚合与 serializer 的 request 分支，绑定本次请求和基线，不产生 Feature receipt/completion。
5. 允许写入的测试路径属于明确输出，不让获准测试编写反复改变请求身份；其实际执行内容由本轮 P1 绑定记录。其余目标/输入变化使旧 facts 绑定失效。

## Risks / Trade-offs

- provider 仍依赖 Feature 路径 → request 分支只调用明确支持 request 的现有 profile 接口；不以假 Feature 兼容，缺口如实返回并交 P4/P5 接线。
- 路径别名和目录复用 → 真实路径校验与已有 summary/script-report 的请求身份对账，准备阶段不创建状态。
- 原有 Feature helper 数量较多 → 使用同一 CheckContext 的 subject 泛型保留旧 helper 的 Feature 默认，入口显式联合，不批量修改业务逻辑。

## Migration Plan

先解析和准备，再接 checker/报告，最后真实 CLI 正反例。旧命令不变；默认 workflow 与发布迁移留 P7，正式发布须 release:verify。

## P6 剩余范围

- 项目盘点以 skills.index 与活动 workflow 为入口真源；文档仅说明各自输入、输出与停止点，不增加执行 registry。
- 全局阶段沿现有 `_global` 报告与原生 checker；CLI 的 module/term/package-path/path 收窄实际检查集合。同一 P2 resolver 计算 request 终点，不创建 Goal 或 Feature 身份。非 phase 项目操作继续使用原生 validator。
- Graph 生成/校验共用来源解析：有效 catalog 或显式源码路径；显式配置失效不当作可选缺失，保留策展节点。
- 主 Agent 按正式性与已授权终点组织职责；子 Skill 完成即交还结果，完整交付由外层基于真实 attended Goal 继续。继续读取冻结范围，不询问新任务 lite/full。
