# Framework 3.1.0 发布说明

**状态**：本地终验完成，待独立 review；尚未对外发布、创建或推送 tag。
**验收日期**：2026-09-04
**对比基线**：Framework 3.0.0
**本地发布件**：`dist/framework-3.1.0.zip` 与同名 `.manifest.json`；实际产物身份与终验结果见文末记录。

本版交付单 App 部件正式需求的机械闭环：部件设计 → Change Unit → 既有 Goal Mode 单并发推进 → 部件组装与覆盖核对。仓内 fixtures 与临时消费者验证只证明框架机制，不代表真实业务、设备或团队语义验收通过。

## 消费者可见变化

- **统一设计入口 `/component-design`**：创建或继续一次部件演进，按已有产物继续未完成步骤；只读与重复进入不自动升 revision，设计交接不自动施工。正式需求使用同一蓝图协议，按实际影响形成一个或多个 CU。
- **蓝图与设计准入**：适配 4+1 视图、独立质询、外部契约来源、跨视图关系、运行时数据流和合法缺口处置共同决定准入；已知缺口不能靠自报完成消失。
- **演进工作区**：蓝图位于 `<features_dir>/<blueprint_id>/blueprint/`，CU 与施工产物位于 `<features_dir>/<blueprint_id>/<change_unit_id>/`。同部件多次演进互不覆盖，跨蓝图不能满足依赖或继承完成事实。
- **连续推进与部件闭环**：CU 消费稳定 `design_refs`，ready set 从依赖、阻塞与真实完成事实派生；复用既有 Goal Mode 恢复。closure 核对需求、设计、实现、运行时边、组合证据及知识归位，单 CU 与多 CU 共用算法。
- **宿主适配接缝**：需求物化、评审发布、评审反馈保持各自方向和权责。发布件内的 `docs/operations/component-design-host-adaptation.md` 提供适配契约、样例与校验命令。
- **知识与扩展接线**：`/extension` 和 manifest 1.1 支持知识受众、声明式物化与阶段绑定；工程惯例进入蓝图、CU 和 review；组件资产发现与选型通过既有 provenance、decision 和施工契约消费。缺少输入时如实显示不可用、未知或降级。

## 升级操作

1. 把校验后的 zip 解压到消费者工程，得到 `framework/`；仅在 `framework/harness/` 安装依赖。
2. 运行 `/framework-init` UPDATE，物化统一入口并按既有备份清理流程撤下 `/app-component-blueprint` 旧跳板。
3. 新正式需求从 `/component-design` 开始；已有平铺 Feature 保持有效，无需迁移为 CU。
4. 自定义 `paths.features_dir` 且未显式配置 receipt/reports pattern 时，默认落点随 features_dir 派生。需要保留旧落点时显式配置 pattern。

Extension 1.0 继续兼容；选择 1.1 时须在 `provides.skills[]` 列全待物化 Skill。详细步骤与影响见 [MIGRATION.md](MIGRATION.md)。

## 验收边界与后续

- 本次只验 Maison 仓内机制与临时消费者，未修改真实宿主；未执行 AI 记账、借款、保单业务验收、真实设备验收或 ClaudeCode + MiniMax 交互验收。
- G8 真实宿主语义验收仍待按 M6 契约提供材料并执行；临时 fixture 的 PASS 不替代这些证据。
- Service 透镜、跨部件自动交接和真实多 CU 并发不在本版；3.2.0 已登记的后续 plan 保持原状态。

## 本轮终验记录

首轮已执行 `cd harness && npm test`：typecheck 通过、unit 4205/4205、fixtures 46/46；发布脚本测试当时为 29/29，计数修复后的最终结果为 30/30；default/release plan 门与独立 `npm run release:verify` 通过。

P1/P2/P3 已于 2026-09-04 同步规格并归档，各自的 release task 按上述结果勾选。归档后 OpenSpec strict validation 为 37/37，Enforcement 路径校验通过；已有 e4/b9 蓝图 requirement 5/5 原样保留。P1 测试的 active-change 路径在归档后实测 95/96，改为确定的归档路径并核对终态后 96/96。

第三次 `npm run release:all` 在干净提交 `a7a6054bfdab30ad125bfb34a011164c531e38d2` 上完整通过：发布 plan 门 → typecheck → unit 4205/4205 → fixtures 46/46 → pack → 同 zip verify → 同 zip 临时消费者 smoke → 提升到本地 dist。未跳过发布 plan 门，verify 内部仅复用该链前置已通过的 typecheck。

消费者 smoke 完整执行安装、harness 依赖安装、提交、CRLF clone、克隆副本依赖安装、UPDATE 覆盖、发布件自带的全局检查与 Goal 场景；9 条登记用例中 8 条实测覆盖、1 条已登记退役、零待实现。UPDATE 的 M/D/?? 状态及五种 Git 状态下的 catalog 一致性、停放/恢复、supervisor 唤醒、截断链后继、源码漂移回 coding、崩溃恢复、build 失败有限重试和 head 失配恢复均通过。退役项是宿主 SCM 忽略配置，不计作实测通过；所有宿主均为临时 fixture。

| 产物字段 | 实际结果 |
|---|---|
| zip | [framework-3.1.0.zip](dist/framework-3.1.0.zip) |
| sidecar | [framework-3.1.0.manifest.json](dist/framework-3.1.0.manifest.json) |
| 大小 | 5,768,094 bytes |
| zip SHA-256 | `26b037bedc87ecc2b82b89461970bbbed487dbb0ea739cae5d8d7a98a866295e` |
| 包内 manifest SHA-256 | `6fa658810b8b087d177d4aa7343a7f9dd0cfef2667333ffe19269cd82660d494` |
| source_commit | `a7a6054bfdab30ad125bfb34a011164c531e38d2` |
| built_at | `2026-09-04T12:13:42.368Z` |
| manifest 文件数 | 1210 |

已重新计算 zip SHA-256 并与 sidecar 比对，读取包内 manifest 确认 source_commit 与构建时 HEAD 一致；`.release-all-staging` 已不存在。最终记录提交仅更新开发文档，不改动该 zip 的发布内容。

本地完整证据见 [最终发布链日志](dist/validation-3.1.0/release-all.log)、[首轮 harness](dist/validation-3.1.0/harness-baseline.log)、[独立 release:verify](dist/validation-3.1.0/release-verify.log)、[首次发布失败](dist/validation-3.1.0/release-all-attempt-1.log)、[第二次发布失败](dist/validation-3.1.0/release-all-attempt-2.log)。

首次 `release:all` 在提交 `7105cffd` 上通过 typecheck、unit 4205/4205、fixtures 46/46，随后在打包规则测试失败：`collect: excludeRootDirs:temp count missing`。本轮移动日志后留下的空 `temp/m5/` 触发了错误的“目录存在即至少排除一个文件”断言。已将断言改为实际排除文件数一致性比较，保留 temp 排除规则与 zip 不得含 temp 的断言；新增空目录、非空目录和缺失排除规则回归，先红后绿，发布脚本测试 30/30。失败 staging 已清理，未进入消费者 smoke，也未产出正式 zip。修复后重跑完整发布链，不增加跳过门禁或续跑机制。

第二次 `release:all` 在提交 `37239f3a` 上通过同样的全量回归和 zip 校验，临时消费者安装、提交与 clone 成功，但 UPDATE 的全局 docs phase 失败，后续阶段未执行，staging 已清理。仓内 `npm run check:docs` 复现为 `doc_missing_role`：`docs/DOC_INVENTORY.yaml` 的 component-assets 条目缺必填 `role`。仅补齐该字段后，目标检查 exit 0、零 BLOCKER；未放宽 inventory schema。第三次发布链已验证修复后的完整 zip。

已观测的非阻断项：standalone docs 检查为 13 PASS、1 个 `doc_freshness` MAJOR/FAIL、零 BLOCKER、整体 PASS（exit 0），涉及 12 份文档的提交时间提示，未据此宣称文档语义已逐份核验，详见 [docs 报告](dist/validation-3.1.0/docs-report.json)；Node 输出 DEP0190 弃用告警。临时消费者第一次 npm install 的 audit 请求发生 registry 超时，npm 安装仍 exit 0，详见 [安装日志](dist/validation-3.1.0/npm-install-host.log)；本次不宣称依赖安全审计通过。
