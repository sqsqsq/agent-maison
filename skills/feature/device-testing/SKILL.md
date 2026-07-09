# 真机测试 Skill (`device-testing`)

> **用户确认 UX**：[user-confirmation-ux.md](../../reference/user-confirmation-ux.md) · `testing.module_name` / `testing.packaging` / `testing.plan_confirm` / `phase.next_step`。

## 前置

本工程须先完成 [`framework-init`](../../project/framework-init/SKILL.md)：`framework.config.json` 与 **paths**/**`architecture` 段**已由初始化写入或与之一致。

**Harness 运行时前置**：满足 [Host harness readiness · Tier_1](../../reference/host-harness-readiness.md) 与 [Shell cwd 契约](../../reference/harness-cli-cwd.md)；宿主打包/装机/设备工具链以本 Skill 的 profile addendum（Tier_2）为 SSOT。**Personal setup（BLOCKER）**：[personal-setup-gate](../../reference/personal-setup-gate.md)：`check-personal-setup.ts --json --ensure`；仅解析 JSON。**视觉能力自测（UI 相关需求·交互式）**：personal-setup `ok` 后按 [interactive-vision-canary](../../reference/interactive-vision-canary.md) 后台跑自测卷判卷 CLI（防死锁编排逐步照做）。

**Feature 归档定位协议**（本阶段是消费者）：先基于 `paths.features_dir` 精确定位 `<features_dir>/<feature>/`；只有精确目录是正式 feature，同名归档/前缀条目只是旁证。**跨会话 Resume Gate（BLOCKER，AGENTS §5.2）**：receipt 可能已存在时须先自跑 `check-receipt.ts`；exit 0 → 已闭环，**停等 `phase.next_step`**。展示输入矩阵（spec/plan/acceptance/contracts(可选)/use-cases(可选)/test-plan(本阶段产出)）；legacy `device-testing-todo.md` 存在仅 WARN 迁移提示，不得作 SSOT；输入缺失回上游补齐。

## 条件加载索引

- 存在 `framework/profiles/<project_profile.name>/skills/device-testing/profile-addendum.md` 时先读（宿主 toolchain/打包装机/设备探测细则）。
- **Step 1.5 打包装机协议 / Step 4.5 Hylyre 派生计划全套 / Step 4.B 即席模式全套 / Step 4.6 视觉 diff 回环（含全部事故派生判裁规则）/ Step 5.1 trace 回填 / Step 6 自检完整清单**：完整读 [device-testing-workflow-detail.md](../../reference/device-testing-workflow-detail.md)。
- `` `profile-skill-asset:<skill>/<asset_key>` `` 按 [Profile skill asset protocol](../../README.md#profile-skill-asset-protocol) 解析。

## 概述

按当前 `project_profile` 自适配的设备/系统测试工程师：基于 acceptance 标准与 Spec 契约生成测试计划，执行后产出标准化测试报告。流水线**第六环（最终环）**，上游 business-ut 的 DAG 和 UT 代码，输出是功能模块质量交付的最终把关。

## 触发条件

"真机测试"、"设备测试"、"测试计划"、"写测试报告"、"生成测试报告"、"系统测试"、"功能测试"、"验收测试"、"测试方案"、"编写测试用例"。

### 模式分支：标准 feature vs 即席（ad-hoc）

| 模式 | 典型输入 | 是否走 `<features_dir>/<正式 feature>/` |
|------|----------|----------------------------------------|
| **标准** | 「对 `home-page` 做真机测试」、已存在需求目录 | ✅ 须存在 spec/plan/acceptance，按 Step 1-7 与 `harness-runner --phase testing --feature <名>` 闭环 |
| **即席** | 仅描述 bundle id + 自然语言操作步骤，不指向本仓库某 feature | ❌ 不消费需求目录；用占位目录名 `_adhoc`（详见 reference Step 4.B） |

**即席识别启发**：用户给出 `com.xxx.yyy` 类 bundle 字符串且步骤像「打开应用→点某按钮→…」；或未提供与本仓库已有目录匹配的 feature 名，且核心诉求是「当场跑一遍 UI 流程」而非「完成某需求的 testing 阶段门禁」。

## 核心理念

**从 `acceptance.yaml`（`ut_layer` + `device_focus`）派生 test-plan → Hylyre/真机执行 → 结构化报告 → Harness 验证闭环**。business-ut 验证 UseCase/state/port 的业务逻辑正确性；真机测试验证**端到端用户体验**。AC/BD 按 `ut_layer∈{unit,device,both}` 分层：`unit` 已由 UT 覆盖本 Skill 不重复；`device` 须由本 Skill 真机覆盖；`both` UT 覆盖业务侧，本 Skill 补做 UI 侧（Toast/跳转/渲染/交互）。真机要点以 `acceptance.yaml` 的 `device_focus` 为 SSOT（spec 阶段写入）；business-ut 可选产出 `ut/reports/ac-coverage.json`，**非** SSOT。

## 输入

| 输入项 | 必需 | 说明 |
|--------|------|------|
| 功能模块名 | ✅ | 定位文件 |
| spec.md / plan.md | ✅ | 需求基准/实现计划 |
| acceptance.yaml | ✅ | 验收 SSOT（含 ut_layer/device_focus），**test-plan 派生来源** |
| use-cases.yaml / contracts.yaml / doc/architecture.md | ⬜ | 了解 UT 已覆盖分支/模块边界/架构全貌 |
| review-report.md | ⬜ | 可选，确认代码已通过 Review |

**缺 device_focus**：对 `ut_layer∈{device,both}` 的 AC/BD，提示回 spec 阶段补全（`acceptance_device_focus_present` BLOCKER）。**缺 acceptance.yaml**：提示先运行 spec 阶段。

## 流程骨架

1. **Step 1 收集测试上下文**：确认模块名（`testing.module_name`：`1=确认` `2=修改`）；读 acceptance/spec/plan/use-cases(若有)/contracts(若有)/architecture(若有)；按 ut_layer 统计范围展示给用户（device AC 数/both AC 数/unit AC 数/边界场景/非功能性需求）。**Context Facts Gate（BLOCKER，C4）**：追加 `<features_dir>/<feature>/context/facts.md` 的 `## phase_delta: testing` 节（无新增事实写 "none"）。
2. **Step 1.5 打包与装机**（`device_test.build`/`device_test.install` 为 BLOCKER 时，详见 reference）：读宿主 addendum → `testing.packaging` 确认 product/buildMode → 经 `dispatchDeviceTestBuild`/`dispatchDeviceTestInstall` 产出装机 → 与文档门禁顺序对齐。
3. **Step 2 生成测试计划**：模板 `templates/test-plan-template.md`，**须含 6 章节**：测试范围/测试环境/测试用例清单(表格：编号/名称/前置条件/测试步骤/预期结果/优先级/关联 AC)/测试策略/通过标准/风险与依赖。**用例生成规则**（v2 ut_layer 感知）：每条 device AC → 至少 1 条用例（步骤来自 device_focus）；每条 both AC → 至少 1 条用例，关注点限定 UI 层；`criteria` P0/P1 各生成 1 条、P2 可选；`boundaries` 每个边界场景 1 条；`performance` 每个指标 1 条验证用例；`ut_layer=unit` 不再生成。用例编号 `TC-{NNN}`；步骤须明确可重复；预期结果须可观察可验证；追溯字段另记 `linked_flow`/`linked_branch`/`ut_layer`。
4. **Step 3 用户确认测试计划**：`testing.plan_confirm`：`1=确认` `2=修改`。
5. **Step 4 归档**：`<features_dir>/{module-name}/testing/test-plan.md`。
6. **Step 4.5 真机自动化派生可执行计划**（`device_test.run` 为 BLOCKER 时，详见 reference）：解析 TC 表 → 按 contracts/plan/snapshot-cache/设备连线四级优先级发现 selector → 译为 Hylyre JSON（裸单行、canonical 直接根键、禁 start_app/dump_ui 根键）→ 裁决与跳过登记 → 落盘 `test-plan.hylyre.md` 到 `testing/reports/<timestamp>/hylyre/` → 触发 `harness-runner --phase testing`。
7. **Step 4.B 即席模式**（详见 reference）：Derive hint（不跑机）→ Agent 写 `doc/features/_adhoc/testing/staging/test-steps.json` 并 lint → 执行 `adhoc-device-test`（默认冷重启）→ 观察汇总决策树 → 不写 receipt/verifier，交付 trace.json cases 摘要。
8. **Step 4.6 视觉 diff 回环**（`ui_change=new_or_changed` 时，详见 reference）：唯一直接像素对图阶段；MVP 覆盖顶层屏+固化 nav 配置到达深层屏/overlay；P0 屏无论 lightweight 与否必须采集评估；执行时先断言屏身份(E3)再双向 diff(正向/反向+G3 样式核对+defects 枚举)；产出 `visual-diff.json`(唯一结构化真源)+自动生成 `visual-diff.md`(请勿手改)；`pixel_1to1` 下 T1/T2/T4/T5/P1-C 等多项确定性信号任一命中即 BLOCKER；**T2 主背靠**——P0 pass 屏须真人 `confirmed_by` 签字；**禁止弃判**——确定性 fail 信号必须当场 verdict=fail+写 must_fix+本轮重修重判，不得以"要真人签字"为由留 pending；判定持久化绑定截图 hash+build 指纹，改码重装才失效重判。
9. **Step 5 生成测试报告**（`testing` harness PASS 且 trace.json 已写出后）：模板 `templates/test-report-template.md`；Step 5.1 自 trace 回填执行状态（详见 reference）；填充测试概览/执行结果/缺陷清单/通过率统计/结论 5 章节；结论判定：P0=100%且总体≥阈值→达标，P0=100%但总体<阈值→有条件达标，P0<100%→不达标。即席模式无强求写 test-report.md。
10. **Step 6 质量门禁自检**：测试计划 11 项 + 测试报告 8 项（完整清单详见 reference）；不通过定位后自动修正重检。
11. **Step 7 Harness 验证门禁**：见下方门禁清单表。

## 门禁清单表

| 检查类型 | 检查内容 | 严重级别 |
|----------|---------|---------|
| 真机构包/装机（可选宿主 BLOCKER） | profile `device_test.build`/`device_test.install` | BLOCKER / SKIP |
| 真机自动化（profile capability） | `device_test.run` 消费派生用例产出 report+trace | BLOCKER / SKIP |
| 测试计划必需章节 / 用例清单表格格式 | 6 章节齐全 / 表头 7 列齐全 | BLOCKER |
| 用例优先级值域 / 测试环境定义 | 仅 P0-P3 / 含设备+系统版本+API 版本 | MAJOR |
| 通过标准定义 / AC 追溯覆盖 | 含量化阈值 / P0/P1 AC 全覆盖 | BLOCKER |
| BD 追溯覆盖 | 边界场景已覆盖 | MAJOR |
| 报告必需章节 / 执行结果表格 / 通过率统计 / 结论一致性 / 计划-报告一致性 | 齐全/状态值合法/含各优先级通过率/结论与数据匹配/用例编号一致 | BLOCKER |

```bash
cd framework/harness && npx ts-node harness-runner.ts --phase testing --feature {module-name} --summary --failures-only
```

优先读 `summary.json`，`testing_run_status.can_claim_done` 须为 `YES` 才能宣称阶段完成。

**AI Harness**：主动通过 Task 工具触发 `subagent_type: verifier`（全局入口 §4.1 明示授权），prompt 模板 `framework/harness/prompts/verify-testing.md`（测试用例完整性/步骤可重复性/预期结果具体性/NFR 覆盖/缺陷严重程度一致性/通过标准与结论一致性）。

## 阶段闭环判定（全局入口 §5.1，四条件缺一不可）

> **标准 feature 模式**适用下文四条件。**即席（`_adhoc`）模式**不宣称「某需求 testing 阶段闭环」：不写 receipt、不强求 `harness-runner testing --feature _adhoc` PASS、不要求 verifier；以交付 trace.json 摘要为主。

1. `<features_dir>/<feature>/testing/reports/trace.json` 真实存在；2. 脚本 harness 退出码 0、零 BLOCKER；3. verifier verdict=PASS；4. 完成回执经 `check-receipt.ts` 校验通过。四项全满足后真机测试阶段完成（**最终环**）。

**闭环停等（BLOCKER）**：须 **`phase.next_step`** 汇报交付摘要并停等；**禁止**因"流水线已走完"而自动开其它 Skill。若测试报告结论为"不达标"，开发者需修复代码后重新执行 coding → code-review → business-ut → device-testing。

## 输出规范

| 产出 | 路径 |
|------|------|
| 测试计划 | `<features_dir>/{module-name}/testing/test-plan.md` |
| 测试报告 | `<features_dir>/{module-name}/testing/test-report.md` |

Markdown 格式，用例清单/执行结果用表格；用例编号 `TC-{NNN}`；缺陷编号 `DEF-{NNN}`。

## 约束与注意事项

1. AC 追溯强制：每条用例须关联 acceptance.yaml 中的 AC/BD 编号（推荐同标注 `ut_layer`/`linked_flow`/`linked_branch`）。
2. 分层分工：`ut_layer=unit` 不出现在本 Skill 测试计划中；`device`/`both` 才是本 Skill 范围。
3. 按 `ut_layer∈{device,both}` 与 `device_focus` 生成/更新 test-plan，勿再维护 `device-testing-todo.md`。
4. 测试计划先行，经用户确认后再据执行结果生成测试报告。
5. 步骤须足够详细可重复；预期结果须可观察可测量，禁止"正常显示"等模糊描述。
6. 模拟应用适配：预期结果基于模拟数据实际值而非真实后端返回值。
7. 测试计划与测试报告是独立文档，分别在不同时间点产出。
8. 中文输出；P0 优先，资源有限时优先覆盖 P0 AC。
9. Harness 验证闭环：agent 必须自跑 Step 7 + 主动触发 verifier；确保零 BLOCKER+verifier PASS+完成回执通过后才认为阶段完成。
10. 不修改源码：生成测试文档时不应修改任何业务代码或 UT 代码。

## 关联文件

| 类型 | 路径 |
|------|------|
| 详细流程 | [reference/device-testing-workflow-detail.md](../../reference/device-testing-workflow-detail.md) |
| 阶段级规约 | `framework/specs/phase-rules/testing-rules.yaml` |
| 脚本 Harness | `framework/harness/scripts/check-testing.ts` |
| 派生提示 JSON | `<features_dir>/<feature>/testing/reports/derive-hint-from-plan.json` |
| 顶层计划结构化抽取 CLI | `cd framework/harness && npm run derive-hylyre-plan-hint -- --feature <feature>` |
| AI Harness Prompt | `framework/harness/prompts/verify-testing.md` |
| 测试计划/报告模板 | `` `profile-skill-asset:device-testing/test_plan_template` `` / `` `profile-skill-asset:device-testing/test_report_template` `` |

## 下游消费者

| 消费者 | 消费的产出 | 用途 |
|--------|-----------|------|
| **开发者** | test-report.md | 按缺陷清单修复代码 |
| **产品经理** | test-report.md | 确认功能验收达标 |
| **Harness（验证层）** | test-plan.md + test-report.md | 脚本/AI 验证文档质量 |

## Slash/trace 约定

通过 `/device-testing` 或等价快捷入口触发时，须在阶段结束时产出 trace 凭证：`<features_dir>/<feature>/testing/reports/<timestamp>/<model>-devtest/trace.json`（Schema：[trace.schema.json](../../../../harness/trace/trace.schema.json)，`phase: testing`）；同目录 `gap-notes.md`（模板 [gap-notes.template.md](../../../../harness/trace/gap-notes.template.md)）。
