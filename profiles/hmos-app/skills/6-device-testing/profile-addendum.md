# `hmos-app` · Skill `6-device-testing` profile addendum

真机 / 设备侧验证默认面向 **OpenHarmony / HarmonyOS 设备或模拟器、hdc Hypium / 装机 HAP**。测试步骤描述应可操作、可复述。

## Skill 6 · 主应用打包与装机（hmos-app）

与 **`coding.compile`** 类似，`testing` 阶段可由脚本 harness 触发 **`device_test.build`**（hvigor，产出 **`reports/<feature>/testing/hvigor-app-build.log`**）及 **`device_test.install`**（`hdc install -r`，日志 **`hdc-app-install.log`**）。能力与 **`profile.yaml > capabilities`** 对齐：`hvigor_app` / `hdc_app`。

- **产物指纹**：成功时在 **`reports/<feature>/testing/device-test-build.result.json`** 写入 `resolvedProduct`、`resolvedBuildMode`、`hapPath` 等字段。
- **交互默认值**：见 **`framework/profiles/hmos-app/harness/testing-build-conventions.ts`**（导出 **`listAvailableProducts`**、**`describeDeviceTestHarnessEnvHints`** 等）。
- **可选构建矩阵**：通过环境变量覆盖：`HARNESS_DEVICE_TEST_PRODUCT`、`HARNESS_DEVICE_TEST_BUILD_MODE`（`debug`|`release`）。不要用 **`HARNESS_SKIP_DEVICE_TEST_BUILD` / `HARNESS_SKIP_DEVICE_TEST_INSTALL`** 作为出口——testing harness 会判 **FAIL**。

打包语义依赖宿主 **`toolchain.devEcoStudio`/`hvigor`** 配置（与 coding 门禁同源）；装机语义依赖 **`hdc` 可执行并在 PATH**。

### 装机：版本预检、降级与冲突（脚本 harness）

`device_test.install` 会在 **`hdc install -r`** 之前读取工程 **`AppScope/app.json5`** 的 **`bundleName` / `versionCode`（可选）**，并对设备执行 **`hdc shell bm dump -n <bundleName>`**，尽力解析设备端 **`versionCode`**（输出格式随 API 版本可能为 JSON 或混排文本）。解析不确定时**不会**仅凭猜测阻断装机，完整原始输出写入 **`reports/<feature>/testing/hdc-app-install.log`**，结构化摘要见 **`device-test-install.meta.json`**。

| 场景 | 默认行为 |
|------|----------|
| 设备上 **未安装** 该 bundle | 直接尝试 install。 |
| 设备 **`versionCode` 高于** 工程声明的候选 `versionCode` | **FAIL**（降级）：报告中给出提高 `versionCode`、手动 `bm uninstall`、或启用下方自动化卸载变量的说明。 |
| 工程 **未声明 `versionCode`** | 跳过数值型降级预检，仍执行 install；日志会标注候选版本缺失。 |
| **`hdc install` 失败** | 对合并日志做启发式分类（降级 / 签名 / 冲突 / 通用），**中文摘要 + 修复建议**写入 harness 检查明细与日志。 |

**环境变量（非交互；由用户在 Shell / CI 或 agent 说明）**

| 变量 | 含义 |
|------|------|
| `HARNESS_HDC_TARGET` | 多设备时指定序列号，所有 `hdc` 子命令（含 `bm dump` / `install` / `uninstall`）前置 `-t`。 |
| `HARNESS_DEVICE_TEST_UNINSTALL_BEFORE_INSTALL` | 设为 `1` / `true` / `yes` 时：若预检判定降级，则先 **`bm uninstall`** 再装；若首次 install 失败且尚未卸载过，则卸载后 **再试一次** install。 |
| `HARNESS_DEVICE_TEST_UNINSTALL_KEEP_DATA` | 与上一变量同时启用时，`bm uninstall` 使用 **`-k`** 保留用户数据。 |

默认 **不** 自动卸载（避免误删数据）。Skill 6 Step 1.5 仍要求 agent 与用户对齐 **product/buildMode**；上述变量由 agent 在降级/冲突场景下向用户解释后再选用。

详细单行清单亦可调用宿主 **`describeDeviceTestHarnessEnvHints()`**（[`testing-build-conventions.ts`](framework/profiles/hmos-app/harness/testing-build-conventions.ts)）。

## 权威资产清单

| 用途 | 路径 |
|------|------|
| Profile 能力与阶段覆盖 | `framework/profiles/hmos-app/profile.yaml`（`capabilities`、`phases_disabled` 等） |
| hdc/hvigor 实现侧 | `framework/profiles/hmos-app/harness/`（runner 经由 `framework/harness` shim） |
| Skill 6 打包维度 / env 提示 | `framework/profiles/hmos-app/harness/testing-build-conventions.ts` |

上游 **Skill 5** 产物 `device-testing-todo.md` 在宿主侧常为 **Hypium DAG + 打桩契约**的补充清单；计划/报告仍以 AC/BD 与 todo 为第一来源。

### skill-assets.yaml 键

| 键 | 相对 `skills/6-device-testing/` |
|----|-----------------------------------|
| `test_plan_template` | `templates/test-plan-template.md` |
| `test_plan_hylyre_template` | `templates/test-plan-hylyre-template.md` |
| `test_report_template` | `templates/test-report-template.md` |

---

## Skill 6 · 真机自动化（Hylyre · hmos-app）

本节是 **`device_test.run` capability** 的宿主 SSOT：与 **`device_test.build` / `device_test.install`** 串接顺序为 **build → install → run**；脚本 harness 在 `testing` 阶段按此顺序触发。

### 能力概述

- **`profile.yaml`** 将 **`device_test.run`** 声明为 **provider: hylyre**（与 `framework/profiles/hmos-app/harness/providers/device-test-run.ts` 对齐）。
- **vendor**：`framework/profiles/hmos-app/vendor/hylyre/` 入库 **hylyre-*.whl** + `release.manifest.json`（参见该目录 `README.md` 同步流程）。
- **隔离环境**：默认在仓库根 **`.hylyre/venv`**（`framework.config.json > tools.hylyre.venv_dir`）；由 runner **自动** `python -m venv` + `pip install <wheel> "hylyre[device,mcp]"`（可选 `--extra-index-url`，**追加**索引不覆盖用户 `~/.pip/pip.conf`）。
- **ensure 触发点**：**非** Skill 6 入口独立步骤；**agent 在 Skill 6 Step 7 自跑 `testing` harness** 时，在 **`device_test.run`** 前自动调用 **`ensureHylyreReady`**（build → install → ensure → run）。**用户不直接执行 harness 脚本**；重试亦用自然语言调起 Skill 6，由 agent 自跑（见 `.cursor/rules/framework-agent-execution.mdc`）。
- **vendor 自动对齐**：覆盖 `vendor/hylyre/` 下 wheel + `release.manifest.json` 后，**用户只需用自然语言重新发起 Skill 6 真机测试**；agent 自跑 testing harness 时，默认 venv 会按 manifest 版本与 wheel sha256 自动 **`pip install --upgrade`**（无 install fingerprint 或 sha256 变化时亦会重装），并在 venv 内写入 **`.hylyre-vendor-fingerprint.json`**；**通常无需手删 `.hylyre/venv`**。
- **首次安装 / 升级**：默认 **600s** `pip` 超时（`HARNESS_HYLYRE_PIP_TIMEOUT_MS` 可覆盖）；传递依赖含 **hypium** 设备栈与 **opencv-python** 等，见控制台进度输出。
- **自检**：首次安装或**本次发生 vendor 对齐升级**后（`doctor_first_run: true`）执行 **`python -m hylyre doctor`**，日志落在 `doc/features/<feature>/testing/reports/hylyre-doctor.log`；`hylyre-ready.meta.json` 含 `installFingerprint` / `vendorSyncReason`。
- **环境覆盖**：`HYLYRE_PYTHON`（指定已就绪解释器）、`HYLYRE_HOME`（指定已有 venv 根目录）可跳过默认 venv 管理；**`HYLYRE_PYTHON` 不会自动升级**——若与 vendor manifest 版本不一致则 harness **BLOCKER**，需在该环境手动升级或取消该变量。

### App 快照缓存（`doc/app-snapshot-cache/`）

- 默认根目录与 `doc/features/` **同级**，跨 feature 共享；**`.gitignore`** 忽略该目录（由 framework-init 写入）。
- Runner 在子进程环境中设置 **`HYLYRE_APP_STORE_DIR=<绝对路径>`**；**不要**对 `run --plan` 传入 `--store-dir`（CLI 不接受）。
- **`hylyre run --plan`** 本身不消费该目录；**`hylyre app page save/load/find`** 与 **`hylyre find`** 在派生/探索阶段使用缓存。

### 顶层 test-plan.md → 派生执行计划

- **派生路径**：`doc/features/<feature>/testing/reports/<timestamp>/hylyre/test-plan.hylyre.md`
- **硬性约束**（与 Hylyre `agent-plan-a` 一致）：
  - 锚点标题：**`## 测试用例清单`**（或 `### …`）
  - 表头 **7 列** 固定顺序：`用例编号 | 用例名称 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 关联 AC`
  - **测试步骤**列：每条逻辑步骤为 **单行 JSON**；多条以 **`;` / `；`** 分隔；**禁止 `<br/>`**；列内禁止未转义 `|`
  - JSON 根键以 Hylyre `planned_step_keys` 为准（含 `action` / `touch` / `input` / `swipe` / `scroll` / **`back`** / `home` / `wait_for` / `assert_toast` 等；以 vendor wheel 内 `hylyre/api/planned_step_keys.py` 为 SSOT）
- **selector 查找顺序**：`contracts.yaml` → `design.md` → `doc/app-snapshot-cache/<bundle>/` 探索结果 → 仍无稳定 selector 则 **该 TC 不写入派生计划**，在顶层 **test-report.md** 标为 **跳过**（备注说明需补契约/设计）。
- **单行 JSON 约束**：每步一个 JSON 对象；`touch` / `input` / `scroll` / `swipe` / `action` 等形态以 Hylyre `agent-plan-a` 为准。多条步骤用 **`;` 或 `；`** 串联，**禁止** HTML 换行与未转义 `|`。模板示例中的 Markdown 反引号包裹仅为可读性；若运行时提示 **「非 JSON」**，请使用**无反引号**的纯 JSON 填入表格单元格（与已验证可解析的烟测格一致）。
- **示例**（仅形态示意，字段名以 Hylyre 版本为准）：
  - 点击：`{"touch":{"selector":{"text":"确认"}}}`
  - 输入：`{"input":{"selector":{"type":"id","value":"username_field"},"text":"demo"}}`
  - 返回：`{"back":{}}` 或 `{"action":{"type":"back"}}`

### 单会话导航纪律（`hylyre run --plan`）

- **执行模型**：整条派生计划共享一次设备会话；仅在计划开头 `start_app` 一次；**用例之间不会自动清栈**。
- **Nav 子页回 Tab**：必须用 `{"back":{}}` 或 `{"back":{"mode":"swipe","side":"RIGHT"}}`（Hypium `press_back` / `swipe_to_back`）。**禁止**用无 `area` / `at` / `scroll_target` 的 `swipe RIGHT`/`LEFT` 代替系统/Nav 返回（那是内容区滑动，无法 pop `NavPathStack`）。
- **进入子页的 TC**：预期含「进入××页」时，若后续仍有要求「已在首页 Tab」的用例，本 TC 末步建议 `{"back":{}}` teardown，或让后续 TC 首步为 `back`。
- **派生前必读**：`derive-hint-from-plan.json` 中每条 `test_cases[].navigation_hint`（`suggested_preamble_steps` / `forbidden_patterns`）。
- **Harness 门禁**：`check-testing` 对派生表执行 **NAV-001/002/003** 静态 lint；失败时 `coverage_reason=invalid_derived_steps`，须在新 `testing/reports/<timestamp>/hylyre/` **重新派生**，勿手改旧目录下的 `test-plan.hylyre.md`。

### `hylyre dump-ui` 与快照缓存

- 当契约/设计里没有可靠 selector 时，在设备已连接、`HYLYRE_APP_STORE_DIR` 已指向 **`doc/app-snapshot-cache/`** 的前提下，用 **`hylyre dump-ui`**（及同类探索子命令，以 Hylyre `--help` 为准）抓取当前屏结构；将可复用的 selector **回写** `design.md` / `contracts.yaml` 后再派生。
- **`hylyre run` 结束后自动快照**：`device_test.run` 在 **`hylyre run --plan …` 成功返回后** 会再执行一次 **`hylyre app page save --bundle <bundleName>`**（透传 `--device-sn`），把当前页写入快照根目录，供下一轮 `find` / 派生使用。该步骤**失败不会**把本次 `run` 判为失败；详情见同目录 **`device-test-run.log`** 与 **`device-test-run.meta.json`** 的 **`hylyre_page_save`** 字段。
- **超时**：环境变量 **`HARNESS_HYLYRE_PAGE_SAVE_TIMEOUT_MS`**（毫秒，仅数字；默认 **60000**）覆盖 `spawnSync` 对 `app page save` 的等待上限。

### plan 派生缺失时的结构化提示

- 若尚未落盘 **`…/testing/reports/<timestamp>/hylyre/test-plan.hylyre.md`** 就跑 **`testing` harness**，脚本 **`check-testing.ts`** 会 **FAIL**，并写入 **`doc/features/<feature>/testing/reports/derive-hint-from-plan.json`**（schema 3）：顶层用例行 + **`navigation_hint`** + 可选 **`lint_violations`**，便于下一轮 Agent 派生。
- **SSOT 覆盖门禁（v2）**：顶层 **`test-plan.md`** 为唯一用例清单权威；**`testing/reports/*/hylyre/test-plan.hylyre.md`** 中声明的 TC（表格「用例编号」列）并上 **显式跳过登记** 必须完整覆盖顶层全部 `TC-xxx`。含「烟测占位」等标记的派生文件视为**无效**，不参与选中。
- **显式跳过登记**（无法写成可靠 Hylyre JSON 的用例）：在派生 **`test-plan.hylyre.md`** 的 **YAML frontmatter** 中写 `explicit_skip_tc_ids: [TC-010, …]`，或在同目录 **`derive-manifest.json`** 写 `{ "explicit_skip_tc_ids": ["TC-010"] }`（可两项合并去重）。须在 Step 5 **test-report.md** 对应用例标 **跳过** 并说明原因。
- **选派生文件**：在 `testing/reports` 多个子目录并存时，按各 `test-plan.hylyre.md` 的 **mtime 从新到旧** 试用，**跳过占位**，首个有效者即为本次 `hylyre run` 输入。勿依赖目录名字典序。
- **新鲜度**：若顶层 **`test-plan.md`** 的 mtime **新于**选中的派生文件，脚本 **BLOCKER**（`coverage_reason=stale`），须重派生或更新派生文件。
- **只读抽取 CLI**（不写入 feature 目录，默认 stdout）：`cd framework/harness && npm run derive-hylyre-plan-hint -- --feature <feature>`；可选 `--out <path>` 写文件。

### 即席模式（`_adhoc`）

- 占位目录 **`doc/features/_adhoc/`**（仓库 **`.gitignore`** 通常忽略），用于「不绑正式 feature」的当场跑机；派生计划路径形如 **`doc/features/_adhoc/testing/reports/<timestamp>/hylyre/test-plan.hylyre.md`**。不要求 `harness-runner testing --feature _adhoc` 整套文档门禁通过；协议见 Skill 6 正文 **Step 4.B**。

模板：**[test-plan-hylyre-template.md](templates/test-plan-hylyre-template.md)**

### 报告合成（Step 5）

- Hylyre 子目录产出 **`test-report.md`（5 章节）** 与 **`trace.json`（cases[]）**。
- Agent 将 **cases[].status** 与顶层计划对齐合并到 **`doc/features/<feature>/test-report.md`**：状态枚举 **通过 / 失败 / 阻塞 / 跳过**；结论 **达标 / 有条件达标 / 不达标**（与现有模板一致）。
- 未进入派生计划的 TC 在顶层报告中 **跳过**，备注示例：缺少稳定 selector，需补 design.md / contracts.yaml。

### 环境变量（摘要）

| 变量 | 含义 |
|------|------|
| `HYLYRE_APP_STORE_DIR` | 由 harness 注入（绝对路径），指向快照根目录 |
| `HYLYRE_PYTHON` / `HYLYRE_HOME` | 用户可选覆盖解释器 / venv |
| `HARNESS_HDC_TARGET` | 透传设备序列号（`--device-sn`） |
| `HARNESS_HYLYRE_RUN_TIMEOUT_MS` | 覆盖 `run` 默认 30 分钟超时 |
| `HARNESS_HYLYRE_PAGE_SAVE_TIMEOUT_MS` | `hylyre app page save`（run 后自动快照）等待上限，默认 60000ms |
| `HARNESS_HYLYRE_PIP_TIMEOUT_MS` | 覆盖首次 `pip install` 默认 600s |

### 故障转移

- **hypium / opencv 无法下载**：优先在用户 **`~/.pip/pip.conf`** 配置可达的 **index-url**；或将 `framework.config.json > tools.hylyre.pypi_extra_index_url` 指到内网/华为源；framework 使用的 **`--extra-index-url`** 为追加，与已有 **index-url** 不冲突。
- **导入失败 / pip 对齐失败**：优先检查 `hylyre-doctor.log` 与 `hylyre-ready.meta.json`；**请 agent 用自然语言重新执行 Skill 6 闭环**（ensure 会尝试 vendor 对齐）；仍无法恢复时 agent 可删 `.hylyre/venv` 后再自跑 Step 7（兜底，非用户手跑 harness）。
- **真机断连**：`hdc list targets`、重连；trace 中可出现 **阻塞** 状态。
- **selector 不可靠**：`hylyre dump-ui` 探索界面 → 回写 design/contracts。
