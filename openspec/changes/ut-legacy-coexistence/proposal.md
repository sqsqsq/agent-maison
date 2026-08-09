## Why

宿主实锤（WalletHarmony 2.3.0，feature lifecycle-not-login）：框架只支持"发现存量 UT 并按当前 feature 问责"，不支持存量身份。mockkit 门禁的受支持语法是自创的（真实 hypium API 为 `kit.mockFunc(obj, obj.method)` + `when(mockedFn)(...)`），任何真实存量用法必死且无逃生口；存量文件被 contracts 模块扫入 all 桶后倒逼当前 feature 的 mock-plan/contracts 登记；被触碰/被 context 提及即按新 UT 全责（存量 it 被逼挂假 AC 标签造成假覆盖）；模拟 tsc 对存量产生真实 hvigor 不报的假错并以 BLOCKER 拦人；设备版本降级被标 selfHealable 引导 agent 自我授权破坏性卸载。

## What Changes

- MockKit 解析器支持真实 hypium API（`mockFunc`/`when(mockedFn)`），治理结论分层：已证明违规=FAIL、静态解析不出=WARN（解析不出 ≠ 违规，方法名弱对齐不消除嫌疑）。
- 统一 target 责任域解析：基线只认 agent 动手前锚（`HARNESS_DIFF_BASE_REF` → goal run `coding_base_sha`，绝不消费 trace.start_commit/裸 HEAD——其记录时点在 agent 之后）；无可信锚 fail-closed 全量问责。新建文件全责；存量文件基线已有内容豁免；存量文件内**新增** import/it/mock 用法按用例级升格（合成视图 + mockkit multiset 计数差），全部需求房规统一消费同一 target-case 视图。
- 工作模式机器化：`MAISON_UT_MODE`（repair_existing_ut / cover_existing_code）+ `MAISON_UT_TARGETS`（显式目标，可点名未触碰的存量文件）；`[REG-*]` 标签仅这两种模式放行，`[CHAR-*]` 解除 path-c 自死锁。
- 模拟 tsc 在真实编译能力在场时恒 WARN（唯一编译 BLOCKER=真实编译门禁）；`ut.compile=SKIP` 时保持 FAIL 作仅存护城河。
- suite 失败棘轮：基线是授权工件（编排 pre-agent 采样或用户确认放置），本轮执行不得反推基线；无基线不豁免；基线内非 target 历史失败豁免并报 `suite_health=DEGRADED`；target 失败永不豁免；基线只收紧不增长。用例失败不短路后续模块，豁免判定先于 exitCode，PASS 须全部选中模块真实执行。
- 状态面板两结论分离：`feature_verdict`（PASS/FAIL/INCOMPLETE）与 `suite_health`（HEALTHY/DEGRADED/UNKNOWN）。
- hvigor：每模块独立日志；`Task ... was not found` 运行期分类 + build-profile targets 三态探测；feature 归属模块优先编译且 task-not-found 不短路其余模块。
- 设备版本降级恒 needsConfirmation（UT 链无卸载执行力，env 不构成用户授权）；底层 hdc 诊断保持场景中立（testing 链有受控卸载通道），UT 专属处置在 UT 聚合层；非降级的预检不确定不灌卸载/versionCode 话术。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `harness-gates`: UT 需求房规只问责本 feature 责任域（可信前置基线锚 + 用例级归属）；模拟诊断不得越过真实工具链成为编译 BLOCKER；suite 历史失败经授权基线棘轮豁免且不得由本轮执行反推；破坏性设备处置必须交还用户确认。

## Impact

- 影响 Phase 5 business-UT：`harness/scripts/check-ut.ts`、`harness/scripts/utils/{ut-target-resolver,ut-suite-baseline,ut-artifact-parse,git-diff}.ts`、`harness/profile-host-loader.ts`、hmos-app 的 `{ut-host-impl,hvigor-runner,hdc-runner,device-install-diag,ut-hvigor-test-failure}.ts`、business-ut skill 文档与模板。
- 不改变 canonical 产物路径或 schema；新增可选环境变量（`MAISON_UT_MODE`/`MAISON_UT_TARGETS`）与授权工件 `suite-failure-baseline.json`，均为 opt-in，消费者无迁移动作，`MIGRATION.md` 无需更新。
- 存量误伤类行为（mockkit/标签/tsc 对存量 BLOCKER）收敛为豁免或 WARN；这是错误分类修复，不是门禁降级——新增内容与新文件同等问责，无锚场景保持改造前全量问责。
