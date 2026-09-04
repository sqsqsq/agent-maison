# `hmos-app` · Skill `device-testing` profile addendum

真机 / 设备侧验证默认面向 **OpenHarmony / HarmonyOS 设备或模拟器、hdc Hypium / 装机 HAP**。测试步骤描述应可操作、可复述。

## device-testing · 主应用打包与装机（hmos-app）

与 **`coding.compile`** 类似，`testing` 阶段可由脚本 harness 触发 **`device_test.build`**（hvigor，产出 **`reports/<feature>/testing/hvigor-app-build.log`**）及 **`device_test.install`**（`hdc install -r`，日志 **`hdc-app-install.log`**）。能力与 **`profile.yaml > capabilities`** 对齐：`hvigor_app` / `hdc_app`。

- **产物指纹**：成功时在 **`reports/<feature>/testing/device-test-build.result.json`** 写入 `resolvedProduct`、`resolvedBuildMode`、`hapPath`、`hapBuiltAt`、`reused` 等字段。
- **HAP 落盘路径**：hvigor 产出在 **`<模块 srcPath>/build/<segment>/outputs/<outputsDir>/*-signed.hap`**——`segment`/`outputsDir` **不保证等于 `default`**，实测常见与 `product` 名相同（如 `01-Product/Phone/build/product/outputs/product/Phone-product-signed.hap`）。产物发现（`discoverAppHapArtifacts`）会枚举全部 `build/*/outputs/*` 目录并按四级确定性排序键（segment → modules 声明序 → outputs 子目录 → 文件名）选出首选候选，不再硬编码 `outputs/default`。**不会**复制到 `reports/`；`device-test-build.result.json` 的 `hapPath` 为绝对路径索引，`scannedDirs`/`candidateCount` 记录本轮实际扫描/命中情况。
- **构建复用**：当 **业务源码 mtime ≤ 已有 HAP mtime** 且 product/buildMode 一致时，**跳过 hvigor**（`reused: true`，门禁仍 PASS）。`timestamp` 为本次跑门禁时刻，**不是** HAP 生成时间——以资源管理器中 HAP 修改时间或 `hapBuiltAt` 为准。
- **交互默认值**：见 **`framework/profiles/hmos-app/harness/testing-build-conventions.ts`**（导出 **`listAvailableProducts`**、**`describeDeviceTestHarnessEnvHints`** 等）。
- **可选构建矩阵**：通过环境变量覆盖：`HARNESS_DEVICE_TEST_PRODUCT`、`HARNESS_DEVICE_TEST_BUILD_MODE`（`debug`|`release`）。不要用 **`HARNESS_SKIP_DEVICE_TEST_BUILD` / `HARNESS_SKIP_DEVICE_TEST_INSTALL`** 作为出口——testing harness 会判 **FAIL**。**goal 模式下禁止 agent 临时覆盖这两个变量**（plan d9e4b7c1）：runner 在 attempt 开始已冻结 {product, buildMode} 并注入环境（agent 与外层 gate 同源），覆盖会让 hvigor 生成物（模块根 `BuildProfile.ets`）与冻结配置不符、被写保护判违规。
- **goal 正式 gate 强装与 evidence**（plan d9e4b7c1）：goal 模式的外层 testing gate 会注入 `HARNESS_DEVICE_TEST_FORCE_INSTALL=1`（强制 `hdc install -r`，装机复用只保留给 agent 自检与普通模式）并在 build→install→run 全部完成后由 check-testing 协调层统一写 **`reports/<feature>/testing/device-test-evidence.json`**（覆盖式、当前轮专属：goal 身份 + 设备元组 + 完整 HAP sha256 + `written_at` + 结构化 cases 四分类）。goal-runner 只消费该 evidence 驱动 testing→coding 回修（仅 `target_kind=physical` 且 `classification=product_actionable|product_state`）；agent 自检产物仅供参考、runner 在 spawn gate 前会删除旧 evidence——**不要手写该文件**。
- **强制重编**：`HARNESS_DEVICE_TEST_FORCE_BUILD=1` 时始终执行 hvigor。
- **真编译前停 daemon**：源码新于 HAP、需执行 hvigor 时，harness 会先 **`hvigor --stop-daemon`** 再 assemble，并注入 DevEco **JBR** 到子进程 `Path`（避免旧 daemon worker 在 PackageHap 阶段 `spawn java ENOENT`）。复用 HAP（`reused: true`）时不调 hvigor，亦不停 daemon。

打包语义依赖宿主 **`framework.local.json > toolchain.devEcoStudio`** / **`toolchain.hvigor`** 配置（与 coding 门禁同源）；装机语义依赖 **`hdc` 可执行并在 PATH**。

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
| `HARNESS_DEVICE_TEST_FORCE_BUILD` | 设为 `1` 时禁止构建复用，强制执行 hvigor。 |
| `HARNESS_DEVICE_TEST_FORCE_INSTALL` | 设为 `1` 时禁止装机复用，强制执行 `hdc install -r`。 |

默认 **不** 自动卸载（避免误删数据）。device-testing Step 1.5 仍要求 agent 与用户对齐 **product/buildMode**；上述变量由 agent 在降级/冲突场景下向用户解释后再选用。

**装机复用**：当 build 已复用、HAP 文件指纹未变且设备已装同 bundle/versionCode 时，可 **跳过 hdc install**（`device-test-install.meta.json` → `reused: true`）。

详细单行清单亦可调用宿主 **`describeDeviceTestHarnessEnvHints()`**（[`testing-build-conventions.ts`](framework/profiles/hmos-app/harness/testing-build-conventions.ts)）。

## 权威资产清单

| 用途 | 路径 |
|------|------|
| Profile 能力与阶段覆盖 | `framework/profiles/hmos-app/profile.yaml`（`capabilities`、`phases_disabled` 等） |
| hdc/hvigor 实现侧 | `framework/profiles/hmos-app/harness/`（runner 经由 `framework/harness` shim） |
| device-testing 打包维度 / env 提示 | `framework/profiles/hmos-app/harness/testing-build-conventions.ts` |

上游 **验收 SSOT** 为 `acceptance.yaml`（`ut_layer` + `device_focus`）；device-testing 从其中 **过滤 `ut_layer∈{device,both}`** 派生 `test-plan.md`。**`test-plan.md` 为执行层唯一用例清单权威**（与下文 hylyre 派生 SSOT 一致）。已废弃 `device-testing-todo.md` 交接物（见 [acceptance-layering.md](../../../../docs/concepts/acceptance-layering.md)）。

### skill-assets.yaml 键

本 skill 的 asset 键与相对路径**唯一声明**在机器清单 `framework/profiles/hmos-app/skills/skill-assets.yaml`（`assets.device-testing` 段）。根 `SKILL.md` 用 `` `profile-skill-asset:device-testing/<键>` `` 引用，解析规则见 `framework/skills/README.md` 的 “Profile skill asset protocol”。**本 addendum 不再罗列键与路径**，以清单为单一真相（SSOT），避免散文与清单漂移。

---

## device-testing · 真机自动化（Hylyre · hmos-app）

本节是 **`device_test.run` capability** 的宿主 SSOT：与 **`device_test.build` / `device_test.install`** 串接顺序为 **build → install → run**；脚本 harness 在 `testing` 阶段按此顺序触发。

### 能力概述

- **`profile.yaml`** 将 **`device_test.run`** 声明为 **provider: hylyre**（与 `framework/profiles/hmos-app/harness/providers/device-test-run.ts` 对齐）。
- **vendor**：`framework/profiles/hmos-app/vendor/hylyre/` 入库**明文源码树 `src/`** + `release.manifest.json`（schema 2；wheel 已退役不再入库，harness 代码仍兼容 legacy wheel 布局——参见该目录 `README.md` 同步流程）。
- **隔离环境**：默认在仓库根 **`.hylyre/venv`**（`framework.config.json > tools.hylyre.venv_dir`）；由 runner **自动** `python -m venv` + `pip install <发布件> "hylyre[device,mcp]"`（可选 `--extra-index-url`，**追加**索引不覆盖用户 `~/.pip/pip.conf`）。源码树安装时 runner 先把 `src/` 按 manifest 清单拷到 `.hylyre/build-src/` 临时副本再交给 pip（防 in-tree build 污染 vendor）。
- **ensure 触发点**：**非** device-testing 入口独立步骤；**agent 在 device-testing Step 7 自跑 `testing` harness** 时，在 **`device_test.run`** 前自动调用 **`ensureHylyreReady`**（build → install → ensure → run）。**用户不直接执行 harness 脚本**；重试亦用自然语言调起 device-testing，由 agent 自跑（见 `.cursor/rules/framework-agent-execution.mdc`）。
- **vendor 自动对齐**：覆盖 `vendor/hylyre/` 下 Maison 源码发布件 `src/` + `release.manifest.json` 后，**用户只需用自然语言重新发起 device-testing 真机测试**；agent 自跑 testing harness 时，默认 venv 会按 manifest 版本与源码 `tree_sha256`（按声明清单复算）自动 **`pip install --upgrade`**，并在 venv 内写入 **`.hylyre-vendor-fingerprint.json`**（`artifact_kind=source`）；**通常无需手删 `.hylyre/venv`**。运行时代码仍可读取外部 legacy wheel 布局，但 wheel 不属于 Maison 交付前置。
- **首次安装 / 升级**：默认 **600s** `pip` 超时（`HARNESS_HYLYRE_PIP_TIMEOUT_MS` 可覆盖）；传递依赖含 **hypium** 设备栈与 **opencv-python** 等，见控制台进度输出。
- **自检**：首次安装或**本次发生 vendor 对齐升级**后（`doctor_first_run: true`）执行 **`python -m hylyre doctor`**，日志落在 `<features_dir>/<feature>/testing/reports/hylyre-doctor.log`；`hylyre-ready.meta.json` 含 `installFingerprint` / `vendorSyncReason`。
- **环境覆盖**：`HYLYRE_PYTHON`（指定已就绪解释器）、`HYLYRE_HOME`（指定已有 venv 根目录）可跳过默认 venv 管理；**`HYLYRE_PYTHON` 不会自动升级**——若与 vendor manifest 版本不一致则 harness **BLOCKER**，需在该环境手动升级或取消该变量。
- **即席入口**：`npm run adhoc-device-test`（device-testing Step 4.B）同样在 run 前 **`ensureHylyreReady`**；**勿**使用 `harness-runner --feature _adhoc`。
- **单机 ensure 失败诊断**：[hylyre-host-preflight.md](../../../../skills/feature/device-testing/reference/hylyre-host-preflight.md)（agent 按日志处理宿主因素，不要求用户 pip）。

### 已知边界（按当前 Hylyre 版本与 capability 判定，plan 07a41ec6 T2）

宿主 bc-openCard-1 2026-09-02 回归里，下面每一条都是代理跑完真机、读 framework 源码后才撞出来的。写在这里的目的是**计划期就绕开**，不是永久事实——版本或 capability 变了以此表为准更新，判断不得来自记忆。

| 边界 | 现状（Hylyre 0.5.x / 当前 profile） | 计划期怎么做 |
|------|------------------------------------|------------|
| `wait_for` 超时 | **超时 = 失败**（driver 观测语义 `assertion.mismatch`），不是异常；裸 `{"wait_for":{"by_id":…,"timeout":N}}` 就是有断言力的身份断言 | 不要为"防假绿"加 `visible:true`——那会把 request.kind 变成 composite，身份门不认；身份断言由 harness 注入，谓词断言另写一步 |
| `scroll_to` 方向 | 只向下滚动 | 多锚点 `scroll_to` 必须严格自顶向下排列 |
| `assert_toast` | 当前版本不可用（恒失败） | Toast 用 `{"wait_for":{"by_text":"…","match":"exact","timeout":N}}` |
| 步骤耗时 | driver / UI 树刷新开销未校准，同一 `touch` 实测 0.3–1.8s，不能当应用时延 | ≤ 秒级的时延类 NFR 无测量通道 → `manual:perf_sampling`（unsupported_gap，留分母披露） |
| 帧率 / 内存 | 当前 capability 无采样通道 | `manual:perf_sampling` / `manual:memory_sampling` |
| 系统设置类前置（大字号/深色/RTL） | 切换系统设置在被测应用之外，无步骤原语 | `manual:system_settings` |
| 资源变体 / 数据注入 / 外部前置 | 需另构 HAP 或注入仓储 | `manual:resource_variant` / `manual:data_injection` / `manual:external_precondition` |
| `manual`（裸） / 未知 gap / 未登记 `provider:<id>` | 未证明缺口或声明非法 → **invalid_test**，跑机前必修 | 写已知 `manual:<gap_class>`，或改 hylyre / visual |
| inactive/SKIP `provider:<id>` | **unsupported_gap**（留分母、不算 PASS） | 保留需求并在报告披露 |
| active 但无 per-TC producer 的 `provider:<id>` | 当前 3.0.0 为 **invalid_test**，跑机前必修 | 改现有可执行通道；真正接入 producer 后再使用 provider |
| 长参考图 | 参考图高于视口时像素口径不成立（`visual_reference_viewport` 前置门） | 按锚点拆成多个视口尺寸的 screen，各自裁图 + nav 末步 `scroll_to` |
| `capture_completeness` | 全局口径：ref element id 出现在任一 ui-spec 节点或 must_have 即算，不按屏 | 长图拆屏时不必逐屏重复声明 |
| P0 checkpoint 绑定 | `action.type` 必须是 tap/touch/click/input/swipe/scroll；`scroll`/`swipe` 在 trace 里 selector 为 null，经其后的身份断言（post-state）绑定 | `assert_visible` 类改为指定触发动作，要看见的元素进 required_element_ids |

### hypium 临时目录（`tmp_hypium/`）

- **来源**：Hylyre 传递依赖 **hypium** 在进程 **cwd** 下创建 `./tmp_hypium`（UI 树 `*_tmp_uitree.json`、截图等），非本仓库业务代码。
- **Framework 行为**（`hylyre-spawn.ts` / `device-test-run.ts`）：所有 `python -m hylyre …` 子进程（含 `doctor` / `run` / `dump-ui` / `app page save` / `session start`）的 **cwd** 统一为 `<features_dir>/<feature>/testing/reports/.hypium-workdir`，故 `tmp_hypium` 落在 **`…/reports/.hypium-workdir/tmp_hypium/`**（即 feature 报告目录内，不落工程根）；段首 **best-effort 清理** 工程根遗留 `<repo>/tmp_hypium/`。
- **污染检测**：ensure/run 结束写入 `hylyre-ready.meta.json` / `device-test-run.meta.json` 的 `root_pollution`；stderr/log 锚点 `ROOT_HYLYRE_POLLUTION=1`（非 BLOCKER，`check-testing` WARN）。
- **cwd 隔离是唯一机制**（Maison 不再代写宿主忽略规则，故没有 ignore 层兜底）；**勿**把工程根 `/reports/` 当作 harness 报告目录。

### App 快照缓存（`doc/app-snapshot-cache/`）

- 默认根目录与 `doc/features/` **同级**，跨 feature 共享；宿主如需忽略该目录，请自行在 `.gitignore` 中登记（Maison 不代写）。
- Runner 在子进程环境中设置 **`HYLYRE_APP_STORE_DIR=<绝对路径>`**；**不要**对 `run --plan` 传入 `--store-dir`（CLI 不接受）。
- **`hylyre run --plan`** 本身不消费该目录；**`hylyre app page save/load/find`** 与 **`hylyre find`** 在派生/探索阶段使用缓存。

### 顶层 test-plan.md → 派生执行计划

- **派生路径**：`<features_dir>/<feature>/testing/reports/<timestamp>/hylyre/test-plan.hylyre.md`
- **硬性约束**（与 Hylyre `agent-plan-a` 一致）：
  - 锚点标题：**`## 测试用例清单`**（或 `### …`）
  - 表头 **7 列** 固定顺序：`用例编号 | 用例名称 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 关联 AC`
  - **测试步骤**列：每条逻辑步骤为 **单行 JSON**；多条以 **`;` / `；`** 分隔；**禁止 `<br/>`**；列内禁止未转义 `|`
  - JSON 根键以 Hylyre `planned_step_keys` 为准（含 `action` / `touch` / `input` / `swipe` / `scroll` / **`scroll_to`** / **`back`** / `home` / `wait_for` / `assert_toast` 等；以 vendor 源码树 `src/hylyre/api/planned_step_keys.py` 为 SSOT）
- **selector 查找顺序与真值边界（开放世界）**：`contracts.yaml` → `plan.md` → `doc/app-snapshot-cache/<bundle>/` → 设备 dump；后两级只发现候选。正式 `by_text` 必须显式写 `match: exact|contains`，且该选择由 acceptance 意图决定，禁止按数字/日期等字符特征启发式放宽、禁止运行时 fallback。**feature ui-spec 只建模本 feature 新增页面**，首页/卡包/添加卡片等既有入口天然缺席：selector 不在 ui-spec 只给 `SELECTOR-SPEC-001` provenance **WARN 并放行**，最终真值是本轮 native StepResult 的 selector evidence。静态 BLOCKER 只保留可确定错误（非法 selector/match、缺显式 `match`、ui-spec 已证明的同屏多映射无消歧、`contains` 只命中带 children 的聚合 Text/Row、同一 checkpoint 结构化 `target_element_id` ≠ 计划 `by_id`）。`derive-hylyre-plan-hint.selector_contract.entries[]` 只提供 canonical 节点**查询**，不是白名单；不得把 ui-spec ∪ acceptance ∪ contracts 合成第二套 registry。**没有可靠 selector 时不能改成跳过**：`channel=hylyre` 的 case 编译不了就整份 Hylyre 计划不启动，并回报该 TC 根因与下一责任阶段。
- **富选择器（Hylyre 0.2+）**：同名文案/同类型多组件（如 bindSheet 半模态「下一步」 vs 背后页面「下一步」）优先用 `scope:"top_overlay"`、`within`/`below`/`above`、`all`、`index`、`visible`/`enabled` 等（详见 [hylyre-planned-step-fields.md](reference/hylyre-planned-step-fields.md)）；`by_text` 无论是否带富字段都必须显式 `match`，勿仅写裸 `by_text` 碰运气。
- **长列表**：屏外项用 **`scroll_to`** 或 touch 内 `scroll_into_view`，勿盲猜 `scroll` 步数。Hylyre 0.3+ `scroll_to` 对已在屏目标先匹配再滚。
- **单行 JSON 约束**：每步一个 JSON 对象；`touch` / `input` / `scroll` / `swipe` / `action` 等形态以 Hylyre `agent-plan-a` 为准。多条步骤用 **`;` 或 `；`** 串联，**禁止** HTML 换行与未转义 `|`。模板示例中的 Markdown 反引号包裹仅为可读性；若运行时提示 **「非 JSON」**，请使用**无反引号**的纯 JSON 填入表格单元格（与已验证可解析的烟测格一致）。
- **示例**（仅形态示意，字段名以 Hylyre 版本为准）：
  - 点击（正式派生）：`{"touch":{"by_text":"确认","match":"exact"}}` 或按 acceptance 意图使用 `"match":"contains"`
  - 点击（派生 plan 表格，Hylyre agent-plan-a 形态）：以 vendor `hylyre-planned-step-fields.md` 为准
  - 输入（0.3+ 一步式，仅 placeholder 的验证码框）：`{"input":{"by_type":"TextInput","scope":"top_overlay","text":"123456"}}`
  - 输入（legacy / by_id）：`{"input":{"by_id":"username_field","text":"demo"}}`
  - 返回：`{"back":{}}` 或 `{"action":{"type":"back"}}`

### 单会话导航纪律（`hylyre run --plan`）

- **执行模型**：整条派生计划共享一次设备会话；harness 在计划开头预启一次；**用例之间不会自动清栈**。需要已知起始态的 case 在**首部**写恰好一组 `{"stop_app":{"bundle":B}}; {"start_app":{"bundle":B,"page_name":P}}`（B/P 逐字取 derive hint 的 `reset_preamble`，与 harness 预启同源，不得自拟；不得用 `clear_app`；其它位置一律 STEP-003 BLOCKER，整份计划不启动）。
- **Nav 子页回 Tab**：必须用 `{"back":{}}` 或 `{"back":{"mode":"swipe","side":"RIGHT"}}`（Hypium `press_back` / `swipe_to_back`）。**禁止**用无 `area` / `at` / `scroll_target` 的 `swipe RIGHT`/`LEFT` 代替系统/Nav 返回（那是内容区滑动，无法 pop `NavPathStack`）。
- **进入子页的 TC**：预期含「进入××页」时，若后续仍有要求「已在首页 Tab」的用例，本 TC 末步建议 `{"back":{}}` teardown，或让后续 TC 首步为 `back`。
- **派生前必读**：`derive-hint-from-plan.json` 中每条 `test_cases[].navigation_hint`（`suggested_preamble_steps` / `forbidden_patterns`）。
- **Harness 门禁**：`check-testing` 对派生表执行 **NAV-001/002/003** 静态 lint；失败时 `coverage_reason=invalid_derived_steps`，须在新 `testing/reports/<timestamp>/hylyre/` **重新派生**，勿手改旧目录下的 `test-plan.hylyre.md`。

### `hylyre dump-ui` 与快照缓存

- 当契约/设计里没有可靠 selector 时，在设备已连接、`HYLYRE_APP_STORE_DIR` 已指向 **`doc/app-snapshot-cache/`** 的前提下，用 **`hylyre dump-ui`**（及同类探索子命令，以 Hylyre `--help` 为准）抓取当前屏结构；dump 结果**仅是候选**，既不授权静态 PASS，也不因此成为 canonical 真值：回写 `plan.md` / `contracts.yaml` 时按真实来源补，禁止把运行时实现原样抄成真值。一次历史真机命中同样不构成静态真值——每轮以本轮 StepResult selector evidence 为准。
- **`hylyre run` 结束后自动快照**：`device_test.run` 在 **`hylyre run --plan …` 返回后** 会再执行 **`python -m hylyre app page save <BUNDLE> <PAGE_NAME> [--ability …] [--device-sn …]`**（**位置参数**，无 `--bundle`）。默认 page slug **`home`**；环境变量优先级：**`HARNESS_HYLYRE_PAGE_SAVE_NAMES`**（逗号分隔，多名）> **`HARNESS_HYLYRE_PAGE_SAVE_NAME`**（旧单名）> `home`。写入 **`doc/app-snapshot-cache/<bundle>/pages/<slug>.json`**。该步骤**失败不会**把本次 `run` 判为失败；stderr 全文见 phase 级 **`reports/<feature>/testing/hylyre-page-save.log`**，结构化摘要见 **`device-test-run.meta.json` → `hylyre_page_save`**（含 `names[]` 明细）。
- **步骤失败诊断（Hylyre 0.2+）**：`hylyre run` 传 **`--failure-dir <reportOutDir>/failures`**（与本轮 `test-report.md` 同目录下的 `failures/`），失败步骤自动落 UI dump + 截图；路径写入 **`device-test-run.meta.json` → `failure_dir`**。
- **冷重启（Hylyre 0.2+ / testing 阶段）**：默认 **`tools.hylyre.cold_restart_before_run: true`**（`aa force-stop` positional + `aa start`）；可用 **`HARNESS_DEVICE_TEST_COLD_RESTART=0/1`** 覆盖。即席默认仍见 Step 4.B `ADHOC_COLD_RESTART`。
- **Cache layout SSOT**：derive/warmup/selector_hints 扫描 **`pages/*.json`**，并 **兼容** bundle 根目录 legacy flat layout（排除 `app-meta.json`、`dump-ui-*`、`*summary*`）。官方 pipeline **只写** `pages/`；若 derive stderr **`ADHOC_CACHE_LAYOUT_MISMATCH=1`**，表示根目录有 page-like JSON 但 `pages/` 为空——**禁止 agent Write 根目录 JSON 替代 page save**；应修 page save 或手动迁入 `pages/`。
- **超时**：环境变量 **`HARNESS_HYLYRE_PAGE_SAVE_TIMEOUT_MS`**（毫秒，仅数字；默认 **60000**）覆盖 `spawnSync` 对 `app page save` 的等待上限。

### plan 派生缺失时的结构化提示

- 若尚未落盘 **`…/testing/reports/<timestamp>/hylyre/test-plan.hylyre.md`** 就跑 **`testing` harness**，脚本 **`check-testing.ts`** 会 **FAIL**，并写入 **`<features_dir>/<feature>/testing/reports/derive-hint-from-plan.json`**（schema 4）：顶层用例行 + **`navigation_hint`** + 可选 **`lint_violations`**，以及**机读步骤目录**（`allowed_step_roots` / `step_shape_catalog` / `canonical_format`——翻译步骤以此为准，不依赖已读语法文档），便于下一轮 Agent 派生。
- **SSOT 覆盖门禁（execution_channel）**：顶层 **`test-plan.md`** 为唯一用例清单权威，且每条 TC 声明唯一 **`execution_channel`**（`hylyre | visual | manual:<gap_class> | provider:<capability-id>`）。**`testing/reports/*/hylyre/test-plan.hylyre.md`** 中声明的 TC（表格「用例编号」列）必须与顶层 `channel=hylyre` 的集合**完全相等**——缺失 missing FAIL、多出 extra FAIL。含「烟测占位」等标记的派生文件视为**无效**，不参与选中。未执行的顶层 TC（包括 P1/P2）不能让 testing 通过；只有机器证明的 known manual gap 或 inactive/SKIP provider 可记 `unsupported_gap`，其余非法写法在任何设备动作前失败。
- **派生器没有 skip 决策权（BLOCKER）**：正式派生计划**禁止**写 `explicit_skip_tc_ids`（frontmatter 与 `derive-manifest.json` 同禁），登记本身即 BLOCKER。某条 `channel=hylyre` 的 TC 写不成可靠 Hylyre JSON 时，**整份 Hylyre 计划不启动**，回报该 TC 根因与下一责任阶段，交回顶层计划作者改通道或补入口定义——不得降级成跳过。
  - **legacy（只读兼容，禁止复制）**：历史产物里的 `explicit_skip_tc_ids` 仍可被解析，仅用于诊断旧 run；它**不贡献 PASS**、**不产 coding candidate**，等同「未执行」保持 testing FAIL，也不得按 TC 名称或报告散文投 coding。新计划/新派生器一律不写。
- **选派生文件**：在 `testing/reports` 多个子目录并存时，按各 `test-plan.hylyre.md` 的 **mtime 从新到旧** 试用，**跳过占位**，首个有效者即为本次 `hylyre run` 输入。勿依赖目录名字典序。
- **新鲜度**：若顶层 **`test-plan.md`** 的 mtime **新于**选中的派生文件，脚本 **BLOCKER**（`coverage_reason=stale`），须重派生或更新派生文件。
- **派生入口 CLI**：先运行 `cd framework/harness && npm run derive-hylyre-plan-hint -- --feature <feature>`，默认输出 stdout 并把源 TC 基线写到 canonical testing reports 下 `derive-hint-from-plan.json`，然后再生成派生计划；不需要先跑 harness 失败。`--out <path>` 保留给显式导出，正式派生使用默认 canonical 路径。

### 即席模式（`_adhoc`）

- **Derive**（不跑机）：schema 4 含 `steps_file_contract`、`step_shape_catalog`、可选 `steps_file_minimal_example`（非 SSOT）、`observation_steps`、`cache_layout_expected`（`pages/<slug>.json`）、`cache_layout_mismatch`。
- **写前 lint**：`npm run lint-adhoc-steps -- --file <path>`（`--normalize` 可 unwrap 常见格式错误）。**STEP-TOUCH** 拦截 `touch.selector` 嵌套；**STEP-002** 禁 `start_app` / `dump_ui`。
- **Agent 纪律（BLOCKER）**：**禁止**向 `framework/harness/` Write 即席 steps / trace / report / plan-lint；steps 写到 **`doc/features/_adhoc/testing/staging/test-steps.json`**（`steps_file_contract.recommended_write_path`）。**禁止**向 `doc/app-snapshot-cache/<bundle>/` **根目录** Write page 结构 JSON；cache 仅由 **`hylyre app page save`** / warmup 写入 `pages/`。page save 失败时读 `ADHOC_PAGE_SAVE_EXIT` / `device-test-run.meta.json`，**勿**自行 Write 替代。
- **执行协议（Step 4.B）**：derive（`adhoc-device-test --steps` 写 `derive-adhoc-last.json`）→ 读 contract → 手写 staging **`test-steps.json`**（观察 NL **不进** steps）→ **`lint-adhoc-steps`** → **`adhoc-device-test --steps-file`** → 成功后 **`--dump-ui-only`** + **`summarize-adhoc-dump`**。执行报告目录：**`doc/features/_adhoc/testing/reports/<timestamp>/hylyre/`**（stderr **`ADHOC_HYLYRE_RUN_DIR=`** / **`ADHOC_TRACE_FILE=`**）。
- **执行**：`adhoc-device-test --bundle <id> --plan …` / `--steps-file …`；**默认冷重启**（`ADHOC_COLD_RESTART=1`）；`--continue-session` 保留 Nav 栈；`--dump-ui-only`；`--observe-ui`；`--skip-page-save`。Python/Hypium 子进程 spawn 前 harness 会将 **`framework.local.json` → `toolchain.devEcoStudio.installPath` 推导的 toolchains** prepend 到 `PATH`（与 Node 侧 `resolveHdcExecutableSync` 同源）；CLI 子进程未继承用户 PATH 时仍应能找到 `hdc`。
- **重跑**：前次 trace `outcome≠success` 且用 `--continue-session` 时 stderr `ADHOC_UI_RESET_RECOMMENDED=1`（读固定 **`device-test-run.meta.json`** 的 `trace_summary.outcome`，非本次新 timestamp trace）；`device-test-run.meta.json` / trace `artifacts` 含 `last_step_index`、`ui_reset_hint`。
- **汇总**：`npm run summarize-adhoc-dump -- --file <dump-ui.json>` → `ADHOC_SUMMARY_JSON=`。
- **App 元数据**：`doc/app-snapshot-cache/<bundle>/app-meta.json`（`mainAbility`、`source`）；外部 bundle 可配 `framework.config.json → tools.hylyre.bundle_abilities`。
- **Plan lint 规则 ID**：正式 feature 派生计划为 STEP-001~007 + NAV-001~003 + **STEP-WAIT-SECONDS**；即席 **`--plan`** 时 STEP 与 **NAV 违规均 BLOCKER**（写 `plan-lint.json`）；`--steps-file` 不跑 NAV。
- **Planned step 字段 SSOT**：[hylyre-planned-step-fields.md](reference/hylyre-planned-step-fields.md)（含 `wait.seconds` vs `wait_for.timeout` 对照）。
- 占位目录 **`doc/features/_adhoc/`**；不要求 `harness-runner testing --feature _adhoc` 文档门禁。

#### Hylyre 报错对照（即席）

| 现象 | 处理 |
|------|------|
| 非 JSON + 提示 action 包装 | 去掉步骤列反引号；用 direct `{"touch":…}` |
| plan 失败、steps-file 成功 | agent 修正 plan 或改用 `--steps-file` |
| `wait requires seconds` | 改用 `{"wait":{"seconds":N}}`；勿在 `wait` 内写 `timeout` |
| STEP-002 禁止 dump_ui | 导航 run 后用 `--dump-ui-only` |
| `Unsupported touch payload` / STEP-TOUCH | 改用 `{"touch":{"by_text":"…"}}`（勿嵌套 `selector`）；写前 `lint-adhoc-steps` |
| 重跑找不到首页控件 | 默认已冷重启；若 `--continue-session` 见 `ADHOC_UI_RESET_RECOMMENDED=1` → 去掉 continue-session |

模板：**[test-plan-hylyre-template.md](templates/test-plan-hylyre-template.md)**（步骤列为裸 JSON）

### 参考图与视口尺寸（`visual_reference_viewport` 前置门）

- `device_test.visual_diff` 在任何 pixel/OCR 内容比对**之前**比对每屏参考图与实测截图的高宽比（阈值 ×1.15）。整页拼接参考图（如 4350/8312 高对 2120 视口）不构成单视口的合法像素参考：`pixel_1to1` 下独立 **BLOCKER FAIL**，低档位 WARN，且该屏被剔出本轮内容比对。出路由 spec 作者建模：长页按锚点拆成多个 screen，每段一个 viewport 尺寸的 `ref_id` 裁图，`visual-diff-nav.json` 中该段 nav 末步 `scroll_to` 锚点元素（选对齐确定的元素，如列表项）；像素路径的前提：每段 nav 从已知状态出发，且滚动落点已证明可重复（至少两个冷启动轮次的中/尾 checkpoint 落点一致；`scroll_to` 目标可见即返回，不对齐坐标）；无法证明的段落不放 `pixel_1to1` 屏，继续 FAIL。不属于像素验收范围的段落须排除在 `pixel_1to1` 屏之外、由功能/结构 AC 覆盖——没有屏级/段级 fidelity 档位。harness 不做自动 crop / 分段 / 拼接，也不按参考图改写 viewport。

### 报告合成与 native evidence（Step 5）

- Hylyre 子目录产出 **`test-report.md`（5 章节）** 与 **`trace.json`（cases[]）**。正式 testing 的最低消费契约为 Hylyre `0.5.0`、trace `schema_version=0.4-p0`、`result_protocol=hylyre.step-outcome/1`（Step Outcome v1，trace 顶层与 `environment` 两处都必须一致）；每个 CaseResult 必须带 `execution`/`verification`/`evidence`/`expected_check_mode`/`steps[]`，每个 StepResult 必须带 `index`/`kind`/`role`/`duration_ms`/`device_session`/`outcome`/`selector`/`artifacts`/`diagnostic`/`extensions`。**状态位于 `outcome.status`（`passed|failed|blocked|skipped` 四态判别式）**：`passed` 带 `observation`、`failed` 带 `failure{domain,code,facts}`、`blocked` 带 `cause`、`skipped` 带 `reason`；selector 位于 `selector.request`/`selector.resolution`。`CaseResult.status` 的中文枚举只是兼容投影，**不得用于任何裁决**。native trace 还须经 `trace.artifacts.plan` 与既有 run/identity receipt 绑定实际 derived plan、top plan、trace 路径/SHA，并逐项核对 StepResult count/index/kind（唯一尾部 `expected_check` 除外）。
- `ensureHylyreReady` 成功后会写 `hylyre-ready.meta.json`；P0 gate 对账 `release.manifest.json` → ready 的 installed/manifest version → `trace.environment.hylyre_version`，并要求 trace 顶层与 environment 的 schema 都为 `0.4-p0`、protocol 都为 `hylyre.step-outcome/1`。任一版本/schema/protocol/字段事实缺失时，旧 case `status=通过` 不得冒充 `verification=passed`，默认升级 Hylyre 后重跑；历史文件不删除。
- Harness 在 **`device_test.run` 成功后** 写入 **`reports/<feature>/testing/device-test-timing.json`**（流水线各阶段 ms + 各 TC 耗时）。schema `0.4-p0` 时各 TC 耗时直接汇总 `CaseResult.steps[].duration_ms`，`step_count` 等于 ledger 行数；只有 legacy schema 才使用旧日志 `cost:` 分配。
- **报告由 harness 整份生成**：使用同一权威 run 的 trace/timing/meta、视觉证据与 stability 生成 `testing/test-report.md` 的状态、耗时、统计与逐轴结论。Agent 只读结果，补充观察写 `testing/notes.md`，不手工回填表格或计算结论。P0 覆盖仍按 checkpoint 与 StepResult 机器事实对账，中文 `CaseResult.status` 仅为兼容投影。
- 已执行失败只消费 nested `outcome.failure`：`outcome.status=failed` 且 `failure.domain=assertion`、`failure.code=assertion.mismatch` 才可能进入既有 coding candidate（还须同 case 存在较小 index 且 `outcome.status=passed` 的 action，否则留 testing）；`failure.domain=selector` 先重派生/补消歧，`failure.domain=capability` 走 capability defer，`failure.domain=infrastructure` 走 external/toolchain。**未尝试的步骤不生成 failure route**：`outcome.status=blocked` 读 `outcome.cause`——`cause.type=capability` 只投影 1 次 capability defer、`cause.type=infrastructure` 只投影 1 次 external/toolchain、`cause.type=prior_step` 零 route 零 disposition；`outcome.status=skipped` 读 `outcome.reason`，`reason.type=policy` 不产生 capability defer。禁止读 flat `status`/`failure_kind`/`failure_code`/`evidence.executed` 重建成败。rich-text 的 coding/spec/plan owner 接入既有 repair-candidate writer；无 StepResult 的未执行项保持 testing FAIL、零自动 coding；不从 TC 名称、AC、notes 或报告散文猜原因。
- native StepResult 在场时只认 native；旧 runtime telemetry 不再被新 run producer 调用，历史 telemetry 仅用于具体 checkpoint 的有限兼容或 native/legacy 一致性 WARN，不合成 CaseResult/StepResult 第二真源。
- 非 `channel=hylyre` 的 TC 不进派生计划；known manual gap / inactive provider 的 `unsupported_gap` 留分母、不算 PASS，披露后可完成；其余非法声明在跑机前判 `invalid_test`，不得用「跳过」冒充已覆盖。
- **Toast 等能力不可用**：`blocked` 还是 `failed` 由 Hylyre 按冻结 builder 判定表的 **attempted 事实**决定——dispatch **之前**能力探针已证明缺失 → `outcome.status=blocked` + `cause.type=capability`（`cause.code` 如 `capability.unsupported`/`capability.not_configured`，须带 `facts.probe_status/probe_source`）；已 dispatch **之后**才返回不支持 → `outcome.status=failed` + `failure.domain=capability`、`failure.code=capability.unsupported`。Maison 只消费这两处 nested 事实：blocked 投 capability defer（0 route），failed 产 1 条自带 capability defer 的 route；两者都是 **0 coding candidate**。**不得**再写 flat `failure_kind=capability`，只有 `diagnostic` 散文而无 `facts` 的能力声明**不能**驱动 defer，也不得把能力缺失改写成人工 skip 或应用 coding 缺陷。
- **同键复用与 `--force-device`**（plan 07a41ec6 T6）：真机执行键 = HAP 摘要 + 注入后派生计划 + 设备/显示环境 + 复位方式 + 工具链版本 + flags；同键最近一次成功且证据完整的 run 直接复用（只重算报告与门禁，`device_test_run.structured.reused_by_execution_key=true`），更晚失败不被更早成功覆盖；用户要 fresh 或 N 轮稳定性时加 `--force-device`。每个 run 目录落 `execution-key.json`，稳定性按同键分组（含失败轮）写 `reports/stability.json`。
- **视觉量测 `--measure --feature <feature> [--screen <id>]`**（plan 07a41ec6 T10）：对 ui-spec 声明元素输出 bounds/间距/重叠/与参考图差值（px 与按 360vp 设计宽估算的 vp）/取色，写 `device-screenshots/measure-<screen>.json` 并把量测事实补进 visual-diff.json 的 defects[].note；只测量不裁决，不改 ui-spec，不改 verdict。
- **报告重算**：run 已有 trace 时，直接执行 `--report-reconcile-only --phase testing --feature <feature>`，由 harness 重生成顶层报告并重算 report/static checks、summary、quality axes 与既有 repair candidates；不要求 agent 预先写报告，零 hvigor/hdc/Hylyre/设备/视觉采集/可执行 lifecycle hook 调用，authoritative trace 字节不变。

### 环境变量（摘要）

| 变量 | 含义 |
|------|------|
| `HYLYRE_APP_STORE_DIR` | 由 harness 注入（绝对路径），指向快照根目录 |
| `HARNESS_HDC_EXE` / `HDC_EXE` | hdc 可执行文件**绝对路径**（Claude Code CLI 等子进程 PATH 不含 toolchains 时推荐显式设置） |
| `HYLYRE_PYTHON` / `HYLYRE_HOME` | 用户可选覆盖解释器 / venv |
| `HARNESS_HDC_TARGET` | 透传设备序列号（`--device-sn`） |
| `HARNESS_HYLYRE_RUN_TIMEOUT_MS` | 覆盖 `run` 默认 30 分钟超时 |
| `HARNESS_HYLYRE_PAGE_SAVE_TIMEOUT_MS` | `hylyre app page save`（run 后自动快照）等待上限，默认 60000ms |
| `HARNESS_HYLYRE_PAGE_SAVE_NAMES` | run 后按逗号分隔的 page slug 列表逐个 `app page save`（优先于 `HARNESS_HYLYRE_PAGE_SAVE_NAME`） |
| `HARNESS_HYLYRE_PAGE_SAVE_NAME` | 单 page slug（旧；多名时用 `HARNESS_HYLYRE_PAGE_SAVE_NAMES`） |
| `HARNESS_DEVICE_TEST_COLD_RESTART` | `1`/`0` 覆盖 `tools.hylyre.cold_restart_before_run`（testing 阶段跑前 force-stop + aa start） |
| `HARNESS_HYLYRE_PIP_TIMEOUT_MS` | 覆盖首次 `pip install` 默认 600s |

### 故障转移

- **hypium / opencv 无法下载**：优先在用户 **`~/.pip/pip.conf`** 配置可达的 **index-url**；或将 `framework.config.json > tools.hylyre.pypi_extra_index_url` 指到内网/华为源；framework 使用的 **`--extra-index-url`** 为追加，与已有 **index-url** 不冲突。
- **导入失败 / pip 对齐失败**：优先检查 `hylyre-doctor.log` 与 `hylyre-ready.meta.json`；**请 agent 用自然语言重新执行 device-testing 闭环**（ensure 会尝试 vendor 对齐）；仍无法恢复时 agent 可删 `.hylyre/venv` 后再自跑 Step 7（兜底，非用户手跑 harness）。
- **真机断连**：`hdc list targets`、重连；trace 中可出现 **阻塞** 状态。
- **selector 不可靠**：`hylyre dump-ui` 探索界面 → 回写 design/contracts。

### 应用工程同步 framework（WalletForHarmonyOS 等）

- **SSOT**：应用工程集成的 Maison 发布件为 harness / device-testing 源码；须使用包含所需能力的已验证发布版本（含 `lint-adhoc-steps`、默认冷重启、`mergeEnvWithHdcOnPath`、flat cache 扫描、`STEP-TOUCH` 等），不以宿主 HEAD/commit 判断版本。
- **同步后**：在应用工程根执行 framework-init render（或手动复制 `.cursor/rules/framework-agent-execution.mdc`、device-testing 跳板）；重跑 `npm run adhoc-device-test -- --bundle <id> --steps "…"` 刷新 `derive-adhoc-last.json`（schema 4 + `cache_layout_*`）。
- **Cache**：若 stderr `ADHOC_CACHE_LAYOUT_MISMATCH=1`，将根目录 page JSON 迁入 `pages/` 或修 page save；**勿** agent Write 根目录替代。
