# business-ut · path-repair · 修复已有 UT（repair_existing_ut）

> 主 SKILL.md 路由：用户明确指定"修某些已有失败 UT"（触发词：修存量 UT / 存量测试挂了 /
> 修复失败用例 / UT 红了帮我看）→ 本路径。target = 用户指定的失败用例，不新增需求工件。

## 出口条件（与 cover_feature_change 不同）

- 目标用例红转绿；
- suite 其他既有失败**不增加**（`suite_health` 棘轮：历史失败豁免但报告，新增失败即回归）；
- **不强制** AC/DAG/mock-plan/coverage-evidence——修复不是需求交付，不得为过门禁补造需求工件。

## Step R1 — 复现

真实工具链跑目标模块（编译 + 装机执行），拿到失败用例的原始输出。**不允许**只凭模拟
tsc / 正则推断定性（权威性排序：真实编译/执行 > 一切静态模拟）。

## Step R2 — 六分类分诊

| 分类 | 判据 | 处置权限 |
|---|---|---|
| test_code_defect | 用例自身断言/打桩/时序错误 | 允许修改目标 UT |
| production_behavior_defect | 业务行为与用例预期不符且预期正确 | **停手**：回 coding/review 或取得用户授权（约束 #12 HARD STOP） |
| framework_gate_compat | harness 门禁误判（真实工具链通过而门禁红） | **修 framework，绝不改写正确的 UT 迁就解析器**；向用户报告 |
| toolchain_project_config | hvigor/签名/build-profile 等工程配置形态问题 | 按诊断指引处理；改配置走源码变更授权流程 |
| device_environment | 设备离线/锁屏/版本降级等 | 等用户处理环境；不归因代码，不自行卸载 |
| unknown | 无法定性 | 贴完整证据请用户裁定 |

## Step R3 — 修复与验证

只动分类允许的对象；改完真实重跑目标用例 → 目标模块 suite。

## Step R4 — 四类差异报告

- `fixed_existing`：本次修好的既有失败；
- `new_regression`：本次引入的新失败（必须清零才算完成）；
- `pre_existing_unchanged`：仍在基线内的无关历史失败（豁免但列出）；
- `not_executed / infrastructure_blocked`：因环境未真实执行的部分（如实报告，不假 PASS）。

## Harness 口径

- 跑 harness 时设 `MAISON_UT_MODE=repair_existing_ut` + `MAISON_UT_TARGETS=<目标文件相对路径>`
  （分号/逗号分隔；显式目标可点名未被触碰的存量文件）+ `HARNESS_DIFF_BASE_REF=<动手前 commit>`；
  **fail-closed**：三者缺一（无锚 / 无目标 / 目标路径未命中）→ `ut_target_resolution` 直接 FAIL，
  不会静默继续（防止目标为空时真正要修的失败被历史基线豁免）；
- 本模式下需求工件门禁（use-cases/audit/mock-plan/DAG/acceptance 覆盖族）按模式 SKIP——
  修复不是需求交付；源码红线、真实编译/执行、UI 禁入、棘轮照常；
- 修复的用例是存量身份（基线已存在），不要求挂本 feature AC 标签；显式目标文件的**全部**
  用例自动进入棘轮"永不豁免"名单——修的就是它们，历史基线不得把修复目标豁免掉；
- 若修复需要新增辅助用例，用 `[REG-<主题>]` 起始标签（回归网，不虚构 AC；仅本模式与
  cover_existing_code 放行）；
- `suite-failure-baseline.json`（feature 的 ut reports 目录）承载棘轮基线：**用户授权工件**
  （信任模型与 gap-notes approved_src_mutations 同级：普通授权文件 + review 纪律）——
  由用户确认已知历史失败后放置（条目须含 module/suite/test，feature 字段须匹配）；
  **agent 不得自行创建**，本轮执行不得反推；无基线时不豁免任何失败；
  基线只收紧不增长（本轮不再失败的条目自动剔除）。
