---
name: Hylyre 0.2.0 适配
version: 2.3.0
overview: "将 framework harness 与 device-testing skill 适配 Hylyre 0.2.0：修正 force-stop 语法并接通冷重启、同步 scroll_to 步骤键、接入 --failure-dir 失败诊断、增强 page save，并更新文档教 agent 使用富选择器，从而真正解开 bc-openCard 的 #1 同名按钮主阻塞。落在当前 2.3.0 开发窗口，不改版本号。"
todos:
  - id: forcestop-cold
    content: device-test-run.ts force-stop 去 -b 改 positional；新增 cold_restart_before_run 配置(config.ts/config-defaults.json/template)并在 check-testing.ts dispatchDeviceTestRun 接通 coldRestart(env HARNESS_DEVICE_TEST_COLD_RESTART 优先)
    status: completed
  - id: scroll-to-key
    content: hylyre-planned-step-keys.ts 增 scroll_to 根键并更新版本注释；放宽 hylyre-planned-step-lint.ts 的 wait_for hasSelector 以识别富选择器(all/within/scope/by_key/by_type)
    status: completed
  - id: failure-dir
    content: runHylyreDeviceTest 为 plan 与 steps-file 两路追加 --failure-dir，并写入 meta
    status: completed
  - id: page-save
    content: tryHylyreAppPageSaveAfterRun 支持页面名列表(HARNESS_HYLYRE_PAGE_SAVE_NAMES)，逐个 save，stderr+exit 归档 hylyre-page-save.log，meta 保留聚合 duration_ms 兼容 timing 并加 names 明细数组
    status: completed
  - id: docs
    content: 仅更新 profile/hmos-app 文档(hylyre-planned-step-fields.md 0.2.0+富选择器+scroll_to+toast、profile-addendum.md)；根 SKILL.md 不新增 Hylyre 0.2.0 细节，仅按 §7 修正 profile 路径
    status: completed
  - id: skill-path-fix
    content: 既有结构 bug 一并修——根 skill(device-testing/coding/code-review/business-ut) profile 路径去掉误带的 feature/；并在 migrate-skill-prose.mjs PROFILE_PATH_FIXES 补三种占位符(<project_profile.name>/<project_profile>/<profile>)及 framework/ 与非 framework/ 前缀映射防回归；rg 验收零命中
    status: completed
  - id: tests
    content: 扩展 lint 单测覆盖 scroll_to/富选择器；复核 force-stop 相关测试；cd harness && npm test 全绿
    status: completed
isProject: false
---

## Hylyre 0.2.0 适配（开发窗口 version: 2.3.0，不 bump）

> 依据：直接读取 `hylyre-0.2.0-py3-none-any.whl` 内源码（CLI / `selector_resolve.py` / `hdc_cli.py`）核对，非仅凭 handoff 文档。SSOT 见 [`downstream-harness-requests.md`](profiles/hmos-app/vendor/hylyre/downstream-harness-requests.md) 与 [`hylyre-optimization-requests.md`](profiles/hmos-app/vendor/hylyre/hylyre-optimization-requests.md)。

### 1. force-stop 语法修正 + 冷重启接通（#3）

- [`device-test-run.ts`](profiles/hmos-app/harness/providers/device-test-run.ts) `runAaForceStop`（约 429-441 行）：去掉 `-b`，改 positional `['shell','aa','force-stop', bundle]`（0.2.0 底层 `hdc_cli.force_stop` 即 positional），并更新函数上方注释。
- **deviceSn 一致性（一并修）**：`runAaForceStop` 与 `runAaStartPreflight`（约 443 行）目前接收 `deviceSn` 形参却只用 [`hdcTargetPrefix()`](profiles/hmos-app/harness/hdc-runner.ts)（仅读 `HARNESS_HDC_TARGET`）。当 `runHylyreDeviceTest({ deviceSn })` 传入显式序列号（非 env）时，force-stop/aa start 会打到默认设备、而 hylyre run 用 `--device-sn` 指定设备 → 串设备风险。改为：这两条 hdc 命令的目标优先用入参 `deviceSn`（`['-t', deviceSn]`），无入参再回退 `hdcTargetPrefix()`。
- 新增配置项 `cold_restart_before_run: boolean`（默认 `true`）：
  - [`harness/config.ts`](harness/config.ts) `HylyreToolConfig`（约 225 行）+ `DEFAULT_HYLYRE_TOOL_CONFIG`（约 2028 行）+ `resolveHylyreToolConfig`（约 2040 行）解析（沿用既有 hylyre 配置都在此的模式）。
  - [`config-defaults.json`](profiles/hmos-app/config-defaults.json) `tools.hylyre` 加键。
  - [`templates/framework.config.template.json`](templates/framework.config.template.json)：`tools.hylyre` 块（约 100-107 行）加键，并在第 36 行 `tools.hylyre` 描述串的字段枚举里追加 `cold_restart_before_run`。
  - **架构护栏（BLOCKER）**：**禁止**把该键加到 [`profiles/generic/config-defaults.json`](profiles/generic/config-defaults.json)（其本就无 `tools.hylyre`）。backfill 白名单按 `loadProfileConfigDefaults` 自动派生，generic 不得获得 hylyre 字段，否则破坏分层并挂 `config-field-merger` 的「generic 无 hylyre 字段」断言。
- phase testing 接通：[`check-testing.ts`](harness/scripts/check-testing.ts) 的 `dispatchDeviceTestRun`（约 1909 行）调用补 `coldRestart`，取值优先级 `HARNESS_DEVICE_TEST_COLD_RESTART`（`1/0`）> `cfg.cold_restart_before_run`。`runHylyreDeviceTest` 已支持 `coldRestart` 入参与 meta 字段，无需改其逻辑。
- 因白名单从 config-defaults 自动派生，加键后还需在 [`config-field-merger.unit.test.ts`](harness/tests/unit/config-field-merger.unit.test.ts)（约 62-68、172-178 两处显式预期列表）补 `tools.hylyre.cold_restart_before_run` 以保持一致（派生类断言 line 127/134 自洽，无需改）。

### 2. 同步 scroll_to 步骤键 + lint 放宽富选择器（#4/#7/#1）

- [`hylyre-planned-step-keys.ts`](harness/scripts/utils/hylyre-planned-step-keys.ts)：`PLANNED_STEP_ROOT_KEYS` 增 `scroll_to`（与 0.2.0 `planned_step_keys.py` 对齐），头注释由 `vendor 0.1.0` 改为 `0.2.0`。
- **修正（关键缺口）**：`touch` 块内富选择器不被拦没问题，但 [`hylyre-planned-step-lint.ts`](harness/scripts/utils/hylyre-planned-step-lint.ts) 对 `wait_for`（约 96-114 行）的 `hasSelector` 当前只认 `selector`/`by_text`/`by_id`，会**误拦** `{"wait_for":{"all":[...]}}`、`{"wait_for":{"scope":"top_overlay",...}}` 乃至单独 `by_key`/`by_type`。需放宽：识别 `by_key`/`by_type` 与富选择器字段（`all`/`within`/`scope`/`below`/`above`/`after`/`before`/`index`），任一即视为有 selector。`scroll_to` 新根键的子字段（`by_text`/`in` 等）只需根键放行。
- **实施提示**：把"是否含选择器/富选择器字段"抽成单一 helper（如 `hasSelectorLikeFields(block)`），供 `wait_for` 判断与后续潜在校验复用，避免把富选择器字段名散落在多处判断里。

### 3. 失败诊断 --failure-dir（#5 / #2b）

- [`device-test-run.ts`](profiles/hmos-app/harness/providers/device-test-run.ts) `runHylyreDeviceTest`：组装 `hylyreArgv` 时（plan 与 steps-file 两条路径）追加 `--failure-dir`；0.2.0 `failure_diag.capture_step_failure` 会落 UI dump + 截图且对 None 路径兜底（修了旧版 NoneType 崩溃）。在 `device-test-run.meta.json` 记录 `failure_dir`。
- **落点（关键）**：必须用 **`path.join(path.dirname(opts.reportOutPath), 'failures')`**，**不要**用 `reportsBase`。因为 `resolveHylyreRuntimeWorkDir` 的 `reportsBase` 是 **phase 级公共目录**（`doc/features/<feature>/testing/reports`），而本轮 hylyre 派生计划 / `test-report.md` / `trace.json` 都在 **`reports/<timestamp>/hylyre/`**（见 [`check-testing.ts`](harness/scripts/check-testing.ts) 第 1904-1918 行，`reportOutPath = <hylyreOutDir>/test-report.md`）。用 `reportOutPath.parent/failures` 可使 phase 跑与 adhoc/steps-file 各自跟随自己的 run 目录，且与 0.2.0 CLI 默认（未传 `--failure-dir` 且有 `--report-out` 时取 `report_out.parent/failures`）一致。

### 4. page save 增强（#6 进阶）

- [`device-test-page-save.ts`](profiles/hmos-app/harness/device-test-page-save.ts)：argv 已是 positional `app page save BUNDLE NAME`（正确，0.2.0 未变），保留。
- [`device-test-run.ts`](profiles/hmos-app/harness/providers/device-test-run.ts) `tryHylyreAppPageSaveAfterRun`：支持页面名**列表**，逐个 save、失败不静默；每次 stderr 全文 + exit code 归档到独立 `hylyre-page-save.log`。利用 0.2.0 单设备自动选取与分阶段 stderr。
- **日志落点（明确决定）**：`hylyre-page-save.log` 写在 **phase 级 `reportsBase`**（与同辈 harness 侧日志 `device-test-run.log` / `device-test-run.meta.json` 一致；它们本就是 phase 级），**不**随 §3 的 run 级 `--failure-dir`。理由：page save 是 harness 侧调用，按 harness 日志惯例归 phase 级；per-run 追踪由 meta `hylyre_page_save.names` 明细（每项 `{name, exit_code, duration_ms}`）保证。
- **env 优先级（保留旧单名兼容）**：`HARNESS_HYLYRE_PAGE_SAVE_NAMES`（逗号分隔，新）> `HARNESS_HYLYRE_PAGE_SAVE_NAME`（旧单名，[`device-test-page-save.ts`](profiles/hmos-app/harness/device-test-page-save.ts) 第 5-10 行 `resolveHylyrePageSaveSlug` 现有）> 默认 `home`。旧单名 env **不得退化**；相应补 [`device-test-page-save-args.unit.test.ts`](profiles/hmos-app/harness/tests/unit/device-test-page-save-args.unit.test.ts)（约 27 行）覆盖。
- **兼容性约束（关键缺口）**：meta `hylyre_page_save` 在保留顶层聚合 `attempted`/`exit_code`/`duration_ms`（多名时 `duration_ms`=总耗时、`exit_code`=首个非 0 或 0）基础上，新增 `names` 明细数组（每项 `{name, exit_code, duration_ms}`）。这样 [`device-test-timings.ts`](profiles/hmos-app/harness/device-test-timings.ts)（约 127-130 读 `hylyre_page_save.duration_ms`）不退化、无需改动（可选：顺带让 timing 读 names 求和）。

### 5. profile/hmos-app 文档（#1 富选择器 + scroll_to + #2a toast）

> 架构原则：Hylyre 是鸿蒙 app/元服务专用工具，其 0.2.0 具体 DSL 一律落在 **profile/hmos-app**。根 [`SKILL.md`](skills/feature/device-testing/SKILL.md) 对 Hylyre 细节采用委托式引用（第 220 行「示例见 profile addendum」、第 232 行「以 `planned_step_keys` 为准…见 profile addendum」），并以「generic / `device_test.run` SKIP 跳过 §4.5」做通用回退。本次**不在根 SKILL 新增任何 Hylyre 具体字段**——`scroll_to` 自动被「以 `planned_step_keys` 为准」覆盖。

- [`hylyre-planned-step-fields.md`](profiles/hmos-app/skills/device-testing/reference/hylyre-planned-step-fields.md)：版本标记 0.1.0→0.2.0、修复指向已删除 `hylyre-0.1.0-*.whl` 的坏链；新增「富选择器」节（`scope:"top_overlay"`、`within/below/above/after/before`、`all`、`index`、`visible/clickable/enabled`，及 `by_text` 默认 `visible:true`）；新增 `scroll_to` 与 touch 内 `scroll_into_view` 形态；toast 降级说明。
- [`profile-addendum.md`](profiles/hmos-app/skills/device-testing/profile-addendum.md)：选择器查找/书写小节补富选择器优先用法（同名按钮限定顶层 sheet）、`scroll_to` 长列表用法、page-save 多名环境变量与失败日志、`--failure-dir` 失败产物位置；toast 在本机不支持时按「跳过 + 备注」处理而非硬失败。
- 根 [`skills/feature/device-testing/SKILL.md`](skills/feature/device-testing/SKILL.md)：**不新增任何 Hylyre 0.2.0 细节**。注意其委托并非完全正确——既有 (a) 第 208/232 行残留 Hylyre/HarmonyOS 具体说法（hylyre smoke / toast / page save），(b) 第 28/125/139/303 行 profile 路径误带 `feature/`（见下方 §7 一并修）。这两类属既有问题；本次只保证「根 skill 不继续新增 Hylyre 耦合」，(a) 的去耦合下沉另开 plan。

### 6. 测试与验收（BLOCKER）

- 扩展 [`hylyre-planned-step-lint.unit.test.ts`](harness/tests/unit/hylyre-planned-step-lint.unit.test.ts)：`scroll_to` 作为合法根键通过；富选择器 touch 块不被误拒；**`wait_for` 富选择器（`all`/`within`/`scope`/`by_key`/`by_type`）通过、仅 duration/timeout 仍被 STEP-WAIT 拦**。
- 更新 [`config-field-merger.unit.test.ts`](harness/tests/unit/config-field-merger.unit.test.ts) 两处显式预期列表加 `tools.hylyre.cold_restart_before_run`。
- 复核引用 `force-stop -b` 的既有单测/快照（如有）改为 positional；`device-test-page-save-args.unit.test.ts` 应仍通过。
- 验收：`cd harness && npm test` 全 PASS（AGENTS.md 开发验收门禁）。

### 7. 既有结构 bug：根 skill profile 路径误带 `feature/`（与 0.2.0 无关，一并修）

根因：扁平 `profiles/<name>/skills/<skill>/` 为规范（[`README.md`](README.md) 第 34 行 + [`scripts/migrate-skill-prose.mjs`](scripts/migrate-skill-prose.mjs) 第 40-45 行 `PROFILE_PATH_FIXES` 即去 `feature/`）。但该脚本只匹配具体 profile 名（`hmos-app`/`generic`），**漏了 SKILL 正文用的 `<project_profile.name>` / `<project_profile>` 占位符形式**，导致占位符路径仍带 `feature/`，agent 照此读会落空。

- 修正以下根 skill 中 **profile 路径**（仅 `profiles/<…>/skills/feature/<skill>/` → `profiles/<…>/skills/<skill>/`；**不动**根 skill 自身位于 `skills/feature/<skill>/` 的相对链接如 `../../../README.md`）：
  - [`skills/feature/device-testing/SKILL.md`](skills/feature/device-testing/SKILL.md)：第 28、125、139、303 行
  - [`skills/feature/coding/SKILL.md`](skills/feature/coding/SKILL.md)：第 28、46、234、509 行
  - [`skills/feature/code-review/SKILL.md`](skills/feature/code-review/SKILL.md)：第 28、133 行
  - [`skills/feature/business-ut/SKILL.md`](skills/feature/business-ut/SKILL.md)：第 28 行
- 根因加固：在 [`scripts/migrate-skill-prose.mjs`](scripts/migrate-skill-prose.mjs) `PROFILE_PATH_FIXES` 补**全部三种占位符变体** —— `<project_profile.name>`（如 coding/SKILL 28/46）、`<project_profile>`（coding/SKILL 234）、`<profile>`（coding/SKILL 509），且**同时覆盖 `framework/` 前缀与非 `framework/` 前缀**两种形式（即 `framework/profiles/<X>/skills/feature/` 与 `profiles/<X>/skills/feature/` → 去 `feature/`），避免未来再生成时回归。
- 验收：全仓 `rg "profiles/[^ )\`]*skills/(feature|project)/"` 在 `skills/**/*.md` 下零命中；抽查改后路径确实存在对应 `profiles/hmos-app/skills/<skill>/profile-addendum.md`。
- 范围说明：本节是纯文档/脚本路径修正，**不**改任何 skill 的语义与流程；与 Hylyre 0.2.0 适配解耦，可独立验收。

### 架构合规排查（避免新增代码破坏既有分层）

逐一核对本次每处改动的层级落点，确认**不引入新的跨层泄漏**：

- **profile 层（正确）**：`device-test-run.ts` / `device-test-page-save.ts` / `device-test-timings.ts` / `config-defaults.json`（hmos）/ `profile-addendum.md` / `reference/*` — 均在 `profiles/hmos-app/`，Hylyre 专用内容落 profile，符合预期。
- **沿用既有 hmos-in-generic 模式（不扩大）**：
  - [`harness/config.ts`](harness/config.ts) `HylyreToolConfig`、[`check-testing.ts`](harness/scripts/check-testing.ts)（已 import `resolveHylyreToolConfig` 并 dispatch）、[`hylyre-planned-step-keys.ts`](harness/scripts/utils/hylyre-planned-step-keys.ts) / [`hylyre-planned-step-lint.ts`](harness/scripts/utils/hylyre-planned-step-lint.ts) 都是 Hylyre 专用但**历史上即位于通用 harness**。本次仅在既有文件就地最小扩展（加字段 / 加根键 / 放宽判断），**不新建** generic 侧 Hylyre 抽象、**不新增**对这些文件的额外耦合点。
  - `hylyre-planned-step-keys.ts` 作为 wheel `planned_step_keys.py` 的 lint SSOT 镜像，`scroll_to` 必须就地同步（无法委托给 profile）。
- **通用层零新增 Hylyre 内容**：根 [`SKILL.md`](skills/feature/device-testing/SKILL.md) 不新增任何 Hylyre 0.2.0 细节（见第 5 节）。§7 对根 skill 的改动仅为**通用路径修正**（去 `feature/`），不含 Hylyre 语义，属解耦的既有 bug 修复。
- **明确禁止项（BLOCKER）**：不改 `profiles/generic/config-defaults.json`；不把 Hylyre DSL 具体形态写进根 SKILL；不为本次新增把 Hylyre 逻辑下沉/上浮造成的大范围迁移（既有耦合的重构另开 plan）。

### 范围说明

- 本次只动 framework 开发仓内 harness + skill/文档；不改 vendor wheel / `release.manifest.json`（用户已同步）。
- 富选择器（#1）主要是 Hylyre runtime 能力，靠文档让 agent/派生使用即可解开 bc-openCard 同名「下一步」主阻塞；harness 侧仅需 `wait_for` lint 放宽（避免误拦富选择器），touch 块本就不被拦。
- 不进行任何版本号 bump（遵守版本演进 BLOCKER）。