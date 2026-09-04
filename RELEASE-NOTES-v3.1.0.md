# Framework 3.1.0 发布说明

**状态**：本地发布收口，待独立 review；尚未对外发布或推送 tag。
**验收日期**：2026-09-04
**对比基线**：Framework 3.0.0
**发布件目标**：`dist/framework-3.1.0.zip` 与同名 `.manifest.json`；实际产物身份与终验结果见文末记录。

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

已执行 `cd harness && npm test`：typecheck 通过、unit 4205/4205、fixtures 46/46；发布脚本测试 29/29；default/release plan 门与 `npm run release:verify` 通过。

P1/P2/P3 已于 2026-09-04 同步规格并归档，各自的 release task 按上述结果勾选。归档后 OpenSpec strict validation 为 37/37，Enforcement 路径校验通过；已有 e4/b9 蓝图 requirement 5/5 原样保留。P1 测试的 active-change 路径在归档后实测 95/96，改为确定的归档路径并核对终态后 96/96。

完整 `release:all`（含同 zip 临时消费者 smoke）将在干净的本地收口提交上执行；该链未完成前，不宣称发布件终验通过。最终产物与结果将在执行后追加。
