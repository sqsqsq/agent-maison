---
name: UT 存量共存 — 门禁身份模型与 hypium 真实语法对齐
version: 3.0.0
# 窗口说明：用户 2026-08-09 裁定本 plan 在 3.0.0 做完（发布门自此含本 plan）。
# 注意：发版解析器只读 frontmatter todos（正文 checkbox 不进 release 门禁）——
# R3c 以 pending todo 物化在此，挡 release 直到真机验证完成（codex 五轮 #5 实锤）。
todos:
  - id: p0-legacy-exemption-and-diagnostics
    content: P0 解除误判与遮蔽（hypium 真语法/责任域豁免/tsc WARN/设备诊断真话），已提交 b2791de5，宿主 R3b 验证通过。
    status: completed
  - id: p1-target-resolver-ratchet-verdicts
    content: P1 统一 target 解析器（targetCaseView/multiset 增量）+ suite 授权基线棘轮（module 级身份）+ 两结论面板。
    status: completed
  - id: p2-mode-entries
    content: P2 工作模式机器化（MAISON_UT_MODE/MAISON_UT_TARGETS，repair/cover_existing fail-closed + 需求门禁分流）与 skill 薄入口。
    status: completed
  - id: r3c-host-device-verification
    content: 宿主真机收尾：设备接回后解锁+用户授权卸载旧包+重跑真机执行环节，确认 hypium 用例真实运行与棘轮/两结论输出。
    status: pending
overview: >
  宿主 2.3.0 UT 实锤暴露：框架只支持"发现存量 UT 并按当前 feature 问责"，不支持存量身份。
  P0 解除 mockkit 自创语法误判/CHAR 死锁/hvigor 诊断遮蔽，tsc 在真实编译能力在场时恒 WARN、降级恒等用户确认，
  基线只认 agent 动手前锚（coding_base_sha/显式 env，fail-closed）——宿主解锁以 R3b 重跑为准；
  P1 = target/suite 简化模型（统一 target 解析器/前后快照/两结论）；P2 = 三种薄入口。
---

# UT 存量共存：门禁身份模型与 hypium 真实语法对齐（423e5d0f）

状态：**P0 已关账并提交（b2791de5）；P1/P2 已实施待 review/commit**（2026-08-08）；R3c 真机收尾确认待设备；验收场景 3/4（repair / cover_existing 实测）待宿主真实场景回灌
触发：宿主 WalletHarmony（framework 2.3.0）lifecycle-not-login feature UT 阶段两枚 BLOCKER 实锤；codex Explore 复核补充 5 条新实锤（均已对 ground truth 核实）。

---

## 一、问题陈述与定性

框架**并没有真正支持"存量 UT 开发"，只支持"发现存量 UT 并把它们纳入当前 feature 检查"**。缺少存量身份、基线状态和独立工作模式，一旦发现存量 UT 就按新需求 UT 规则重新问责——这是**类别错误**，不只是少支持一个 MockKit 正则。要建立三能力：

1. **修已有 UT**（repair_existing_ut）：分析并修复明确指定的已有失败 UT；
2. **给存量/非需求代码写 UT**（cover_existing_code）：回归网 / characterization；
3. **给需求代码写 UT**（cover_feature_change）：现行 path-a/b 全套。

当前只有第三种；path-c 勉强覆盖第二种一小部分（还强制要求日志切片，且自身有死锁，见四#5）；第一种完全没有。

## 二、现状全景：UT 门禁 × 作用域 × 谓词性质

宇宙：`loadUtFiles` = contracts.yaml `modules[]` 声明模块下**全部** `.test.ets` → all 桶（[ut-host-impl.ts:55](../../profiles/hmos-app/harness/ut-host-impl.ts)）。scoped = git working diff ∪ context 声明；无线索 fallback scoped=all（[ut-file-scope.ts:105](../../profiles/hmos-app/harness/ut-file-scope.ts)；ut-diagnostic-truth 已决定保守回退+报告原因）。

| 检查 | 桶 | 级别 | 谓词性质 | 存量风险 |
|---|---|---|---|---|
| ut_file_naming / ut_framework_import / test_registration | all | 混合 | 接近通用不变量 | 低 |
| ut_tsc_compiles | all | BLOCKER | **模拟器假设**（ets→ts 虚拟映射裸 tsc；权威应是真实 hvigor） | 中（R2 回灌） |
| ut_assertion_exists | all | BLOCKER | 接近通用 | 中低 |
| **ut_hypium_mockkit_policy** | **all** | BLOCKER | **房规 ×3 耦合（见三）** | **实锤致死** |
| mock_stub_for_async | all | BLOCKER/WARN | **谓词近永真（全文 includes 无邻近性）** | 反向：形同虚设 |
| it_name_has_ac_or_branch_tag | scoped | BLOCKER | 房规（只认 AC/BD/BRANCH 起始，**无 CHAR 豁免**） | **触碰即中招（实锤）+ path-c 死锁** |
| ut_import_whitelist / it_drives_flow | scoped | 混合 | 房规 | 触碰即中招 |
| boundaries_all_stubbed | scoped | BLOCKER | 房规命名（不认 `util.Aspect.replace`/`mockFunc`） | 中 |
| 覆盖族 + ac-coverage | scoped | 混合 | 特性追溯 | **覆盖稀释（实锤）** |
| hvigor build/test | scoped 选模块 | BLOCKER | 硬编码 task + 首败即断 + **共用日志 'w' 覆盖** | **实锤** |

## 三、根因

**缺陷 A：all 桶混入房规。** `ut_hypium_mockkit_policy` 在 all 桶（[check-ut.ts:4050](../../harness/scripts/check-ut.ts)）却带三重耦合：
- A1 **语法自创**：只认 `MockKit.mock(Class)` / `kit.mock(Class)` / `when(Class.method|var.method)`（[ut-artifact-parse.ts:305,337](../../harness/scripts/utils/ut-artifact-parse.ts)）。真实 hypium@1.0.24 是 `kit.mockFunc(obj, obj.method)` + `when(mockedFunc)(args).afterAction(...)`（宿主实读 d.ts 证实；`mockFunc` 全库零命中；单测夹具全部自创语法，从未对过真实样本）。真实用法必死于 `collectUnparsedHypiumWhenIssues`（:402），无逃生口。
- A2 **特性工件耦合**：all 桶任何文件 import MockKit → 要求本 feature mock-plan 声明（:3482）。
- A3 **契约耦合**：mockkit target_class 必须在本 feature contracts interfaces（:3515）。

**缺陷 B：触碰即全责，Git diff 被当作所有权。** 存量文件被 A 逼修 → 进 scoped → `it_name_has_ac_or_branch_tag` 逼挂本需求 AC 标签（宿主实录：存量 `mainTest` 挂 `[AC-01]`）→ ac-coverage 从 scoped 收 it 名（:4121-4126）→ **假覆盖**。修兼容性、用户本地脏改动同样会扩大 scope。

**缺陷 C：验收从没对准生产。** 门禁单测只锁自创语法夹具（[ut-artifact-parse.unit.test.ts:135](../../harness/tests/unit/ut-artifact-parse.unit.test.ts)）；模板 mockkit 示例 `expect(true)` 空转（ut-template.md:276）。

**事故链**：contracts 声明 3 模块 → 存量 Main.test.ets×3 进 all → mockkit BLOCKER → agent 改存量 → 进 scoped → AC 标签门禁 → 挂假标签 → ArkTS 编译限制 → 恢复+声明 mock-plan → 死于 A1。phone 被拖进编译集合 → `genOnDeviceTestHap` 硬编码（[hvigor-runner.ts:1708](../../profiles/hmos-app/harness/hvigor-runner.ts)）task 不存在 → 无分类诊断 → 首败即断（[ut-host-impl.ts:358](../../profiles/hmos-app/harness/ut-host-impl.ts)）遮蔽真目标模块。

## 四、问题清单（本次调研 + codex 复核，全部已对 ground truth 核实）

| # | 问题 | 锚点 | 定级 |
|---|---|---|---|
| 1 | mockkit 解析器语法自创，真实 `mockFunc`/`when(mockVar)` 必死且无逃生口 | ut-artifact-parse.ts:305-414 | **实锤 P0** |
| 2 | mockkit 政策 all 桶 + 特性工件/契约双耦合 | check-ut.ts:3470,3482,3515,4050 | **实锤 P0** |
| 3 | 触碰即全责：Git diff 被当所有权；碰过的存量按新 UT 全责 | check-ut.ts:4108-4111 | **实锤 P1** |
| 4 | 覆盖稀释：存量 it 挂标签后计入本需求 ac-coverage | check-ut.ts:4121-4126 | **实锤 P1** |
| 5 | **path-c 自死锁**：C5 要求 `[CHAR-*]`，`it_name_has_ac_or_branch_tag` 只认 AC/BD/BRANCH 起始、无 CHAR 豁免；path-c 场景无 acceptance 可挂 AC；C6 声称"需求侧规则自动 SKIP"但该检查无此逻辑 | path-c-characterization.md:25-34 / check-ut.ts:1884 | **实锤 P0**（codex） |
| 6 | **archived DAG 无归属过滤**：按模块 `test/dag/` 全量加载，旧 feature 同号 `AC-01` 可误判当前覆盖（假绿向）或破坏 characterization 判定 | check-ut.ts:304-341 | **实锤 P1**（codex） |
| 7 | **AI verifier 上下文全量**：每模块收 20 UT+10 DAG 无 scoped 过滤，语义审查历史用例；截断还可能把真 feature UT 挤出上下文 | harness-runner.ts:2206-2223 | **实锤 P1**（codex） |
| 8 | **多模块共用 `hvigor-ut-build.log` 且 `'w'` 截断**：只见最后一次调用，无法证明前面模块通过 | hvigor-runner.ts:1541,1547 + 1729 | **实锤 P0**（codex） |
| 9 | `genOnDeviceTestHap` 硬编码，task-not-found 无运行期分类诊断 | hvigor-runner.ts:1708 | **实锤 P0** |
| 10 | 编译循环首败即断，feature 归属模块可能没编译 | ut-host-impl.ts:347-359 | **实锤 P0** |
| 11 | `boundaries_all_stubbed` 不认 `util.Aspect.replace`（鸿蒙官方推荐）与 `MockKit.mockFunc` | check-ut.ts:1826-1838 | P1 |
| 12 | `mock_stub_for_async` 全文 includes 近永真，无关文件出现 "mock"+函数名即过 | check-ut.ts:1167-1170 | P2 |
| 13 | 模块级 seam registry（`ut-registry`）仅文档，harness 零消费，`registry_ref` 未接线 | module-seam-mock-registry-schema.md | P2 |
| 14 | `ut_tsc_compiles` 模拟器作为全量 BLOCKER；权威性排序缺失（真实 hvigor > 模拟 tsc；正则推断 > 只配 WARN） | ts-compile.ts | P1 原则 + R2 回灌 |
| 15 | hvigor 无运行前基线：无法区分"历史就失败/本需求新增回归/本轮修好" | — | P1（ratchet） |
| 16 | 模板 mockkit 示例空转，教的是解析器不支持的路线 | ut-template.md:266-284 | P0 随 #1 |

## 五、与 ut-diagnostic-truth 的边界

ut-diagnostic-truth（已部分落地，054fc2ae）管**"报告说真话"**：scope 可诊断、loader observation 化、证据口径显式；其 Non-Goals 明确不修"规则对存量的公平性"。本 plan 管**"规则本身公平 + 语法对真实世界"**。衔接点：其 Decision 1（feature-local 标签不是所有权键、Git diff 只是 WIP 线索）是本 plan 身份模型的概念地基，P1 直接在其上扩展，不重做诊断层。

## 六、目标模型（codex 第三轮简化版：一个 target、一个 suite、一次前后对比、两个结论、三种薄入口）

**核心原则：责任跟声明走，不跟触碰走；解析不出 ≠ 违规；真实执行 > 模拟推断。**

只需要两个集合，不建三轴/四身份对象体系：

```text
target = 本次明确负责的测试文件/用例
suite  = 真实 hvigor/Hypium 会编译、执行的整个测试模块

需求房规只检查 target；真实编译/执行检查 suite；
最终结论 = target 是否通过 + suite 是否新增回归。
```

三种工作方式只是 **target 的来源**不同，不是三套框架：

| 工作方式 | target 来源 |
|---|---|
| 修已有 UT | 用户明确指定的失败用例 |
| 给存量/本地代码写 UT | 用户明确指定的代码与新增测试（REG/CHAR 追溯，不虚构 feature AC） |
| 给需求代码写 UT | 当前 feature 声明的测试（现行 path-a/b 全套） |

Git diff / context 提及只是**发现候选**的线索，不决定责任。当前实现的 `featureNewUtFiles`（scoped − 基线已存在）是 **P0 临时 target**，P1 由统一解析器替代。

### 权威性排序（不变）

真实 hvigor/ArkTS 编译 > 模拟 tsc（P0-1 已落地：真实编译能力在场时 tsc 恒 WARN，唯一编译 BLOCKER=真实编译；ut.compile=SKIP 时 tsc 保持 FAIL 作仅存护城河）；真实 Hypium 执行 > 正则治理推断；正则解析不出 → UNRESOLVED/WARN，只对已证明违规给 BLOCKER。修已有 UT 的失败六分类与按权限修复纪律保留（framework 误判改 framework，绝不改宿主正确 UT 迁就解析器）。

## 七、实施批次（待 review 后 todo 化）

### P0 解除误判并补齐诊断（对应实锤 #1/2/5/8/9/10/16）——**代码已实施（2026-08-08，unit 3098 + fixtures 44 全绿，待 review/commit）**

**定性（codex 第二轮意见采纳）**：P0 代码解决的是"误判与遮蔽"——MockKit 真语法解析、存量豁免、CHAR 死锁、task-not-found 归因、目标模块优先且不被短路遮蔽。`genOnDeviceTestHap` 仍是 ohosTest 默认 task（不引入通用 capability 框架）；phone 若仍在 scoped 且缺 target，`ut_hvigor_build` 依然 FAIL——此时新归因会引导宿主走"补 targets"或"让存量文件退出 scope"两条正路。**宿主是否彻底解锁，以 R3 重跑为准；R3 通过前 P0 不算关账。**
- [x] 1. mockkit 解析器支持真实 hypium：`collectMockFuncVarInfo` 解析 `kit.mockFunc(obj, obj.method|Class.method)`；`when(mockVar)` 纳入 `parseWhenInnerUsage`；objVar→类名只认显式注解/`new Class()`（工厂/builder 不猜，防误归因）；治理分层 `collectUtMockkitGovernanceReport`：violations=BLOCKER / unresolved=WARN（解析不出 ≠ 违规）。夹具含宿主 Main.test.ets 实录 + hypium 文档形态（ut-artifact-parse.unit.test.ts）。
- [x] 2. mockkit 政策迁出 all 桶：只吃 feature-new 集合（scoped − 基线已存在）；豁免文件在 details 透明披露。**实施偏差（fail-closed 加严）**：基线只认 `HARNESS_DIFF_BASE_REF`/`trace.start_commit`，**不回退 HEAD**——宿主"写完 UT 先 commit 再跑 harness"场景下 HEAD 会把本轮新 UT 误判存量而放水（fixtures 实锤暴露）；无基线 = 不豁免（行为等于改造前 scoped 问责）。
- [x] 3. `it_name_has_ac_or_branch_tag` 正则加 `CHAR`；path-c C5/C6 文档与实现对齐（起始标签、按前提 SKIP 措辞）。
- [x] 4. hvigor：每模块独立日志 `hvigor-ut-build.<module>.log`（消费方全走返回值 logAbsPath，无硬编码引用；runHvigorTest 内部复用自动继承）；`detectHvigorTaskNotFound` 运行期分类（剥 ANSI）；`moduleDeclaresOhosTestTarget` 三态探测 build-profile targets（仅证据增强不硬拦截）；归因 kind `ut_module_target_unregistered` + 双选项行动指引（补 targets / 让顺带触碰的存量文件退出 scope）。
- [x] 5. 编译循环：`orderUtModulesForCompile`（feature-new 模块 → scoped 模块 → 其余，稳定排序）；task-not-found 不短路继续编其余模块，真实编译错误仍短路；报告逐模块状态表 + affected_files 全量。
- [x] 6. ut-template / mock-plan-schema 换真实 `mockFunc`/`when(mockedFn)(args).afterReturn` 示例，标注豁免与 WARN 语义。

**第二轮 review 修正（codex，2026-08-08，已实施）**：
- [x] 7. 模板示例假断言根除：`expect(true)` → 真实驱动 Flow 入口 + 三件套断言（返回值/状态迁移/边界调用计数）。
- [x] 8. unresolved 语义一致化：目标类不可判定时**方法名弱对齐不消除嫌疑**，恒 unresolved（WARN）不显示全绿；消息区分弱对齐/未声明，语义对齐交 verifier。
- [x] 9. 主 SKILL.md 追溯标签规则补 `[CHAR-*]` 例外（否则子文档修了、主 Skill 仍教 agent 虚构 AC）。
- [x] 10. plan frontmatter 补齐（version/deferred_to=3.1.0，窗口终裁权在用户；check-plan-version PASS）。

**R3 一轮回灌追加修复（2026-08-08，宿主实测实锤，已实施）**：
- [x] ~~11. `ut_tsc_compiles` 限缩到 feature 责任域~~ **superseded by #13**（P0-1 改为全量跑恒 WARN，撤掉归属切片；R2 实锤仍成立：存量 TS2749 被裸 tsc 判死、同文件真实 hvigor PASS）。
- [x] 12. `it_name_has_ac_or_branch_tag` 限缩到 feature 责任域（实锤：存量文件 git 已恢复干净，仍被 **context-exploration 提及**拉回 scoped——"提及 ≠ 归属"；标签门禁不得逼存量 it 挂本需求 AC）。
- 回灌状态：框架四项修复全部生效（mockkit 豁免/phone 退出编译集合/独立日志/目标模块 PASS）；剩余真实阻塞=设备 install version downgrade（9568263，环境问题非框架问题，处置决策在用户）。

**codex 简化轮采纳（2026-08-08 第三轮，已实施）**：
- [x] 13. **P0-1 模拟 tsc 永不做编译 BLOCKER**：`ut_tsc_compiles` 全量跑但报错降为 WARN（快速诊断），唯一编译 BLOCKER=真实编译门禁；撤掉 tsc 的 featureNew 归属切片（减法）。护栏（codex 未虑及，自补）：profile 把 ut.compile 声明 SKIP 时 tsc 是仅存护城河，保持 FAIL 不降级。fixture ut_tsc_compiles_fail 期望同步 WARN。
- [x] 14. **P0-4 版本降级只做正确分类**（经 codex code review 二连修正后定稿）：
  - 预检降级**恒 `needsConfirmation`**：UT 链没有任何卸载执行逻辑（runHvigorTest 对非 clear 一律直接返回，`HARNESS_DEVICE_TEST_UNINSTALL_BEFORE_INSTALL` 只被 testing provider 消费），selfHealable/"设 env 重跑"对 UT 是假承诺死循环；且 env 不构成用户授权证明（agent 也能设）。文案=用户手动处理设备（丢数据警示）+ 禁改 versionCode。
  - **runtime 降级路径修复**（宿主实际命中路径）：预检漏判 → hdc install 9568263 → `installDiagnosis.kind='install_downgrade'` 此前被 `classifyFailure` 压成 `device_install_failed`/`device_toolchain`（"修工具链"误导）；现映射为 `install_needs_confirmation`/`needsConfirmation`，decideNextAction 落 confirm 分支。回归单测已锁（ut-hvigor-test-failure / hdc-runner）。
  - hdc-runner 降级建议删 env 引导与"提高 versionCode"首选项。
- **已知限制（P1-1 修复目标，单测已锁）**：责任域是文件粒度——本需求在**存量文件内新增 it()** 时该文件仍整体豁免（新 it 的 MockKit/标签不被问责），存在假绿窗口；统一 target 解析器（用例级）落地前不宣称支持"存量文件内新增需求 UT"。

**codex code review 三修（2026-08-08 第四轮，已实施）**：
- [x] 15. **P0 基线锚可信化**：`computeUtFileBaseline` 曾消费 mtime 最新的 `trace.start_commit`——但那是本次 harness 启动时才记的当前 HEAD，"新增 UT → commit → 首跑 ut harness" 时已含新 UT，会把本轮新文件洗成存量（放水窗口）。现只认 agent 动手前锚：`HARNESS_DIFF_BASE_REF`（显式）→ goal run 的 `coding_base_sha`（write-once + 重放校验，ui-scope-gate 同款纪律）→ 无锚 fail-closed 全量问责。**含真实 git 仓走完整路径的集成回归**（显式锚分离新旧/无锚 fail-closed/coding_base 缺失 fail-closed）。宿主手动重跑须带 `HARNESS_DIFF_BASE_REF`（话术已更新）。
- [x] 16. **共享诊断中立化**：`diagnoseHdcInstallFailure` 被 UT/testing 共用（testing provider 有受控卸载重试通道），底层不得写死"UT 链没有自动卸载能力"；底层只报降级事实+丢数据风险+禁改 versionCode，UT 专属处置（等用户手动处理）上移 UT 聚合层 `actionFor`。
- [x] 17. **needsConfirmation ≠ 降级**：`mapInstallBlockingToUtCheckFields` 按 `downgradeDetected` 分支——元数据读取失败等预检不确定场景不再被灌卸载/丢数据/versionCode 话术。
- [x] 18. plan frontmatter overview 与正文对齐（target/suite 模型、seam registry 移出主线）。
- [x] 19. （第五轮收尾）非降级 needsConfirmation 文案修复：AppScope/app.json5 元数据异常的正解就是修元数据——指向修复+授权流程，不再"禁改配置"造成无解重跑；补 mapInstallBlockingToUtCheckFields 两态直接单测；hdc-runner 底层断言改为验证中立性（不含 "UT 链"），UT 专属话术断言移至聚合层测试；补 coding_base_sha 成功路径集成测试（真实 recordCodingBase writer 造锚）；plan "tsc 恒 WARN" 措辞加"真实编译能力在场时"限定。

### P1 三个能力——**已实施（2026-08-08，经 codex 第四轮 review 三 P0 修正后定稿，unit 3111 + fixtures 44 全绿，待 commit）**
- [x] P1-1 **统一 target 解析器**（`ut-target-resolver.ts`）：优先级=用户明确目标（`MAISON_UT_TARGETS`，可指向未在 scoped 的存量文件）> scoped 内基线判定（新建文件全责 + legacy 文件内新增 it 用例级升格）；输出 targetFiles / legacyIncrements / **targetCaseView**（新文件原样 + legacy 新增 import/it 合成条目）/ selectionReasons。**全部需求房规**（mockkit / 标签 / import 白名单 / boundaries / it_drives_flow / 覆盖族 / ac-coverage / hvigor targetItNames）统一消费 targetCaseView（codex 修正：此前只有标签/mockkit 消费增量，其余仍吃 featureNewUtFiles=增量可绕多项规则）；mockkit 增量按 **multiset 计数差**（codex 修正：集合去重会吞"基线已 mock 同方法的新增使用"）。无基线锚时行为与改造前逐字等价（fixtures 全绿佐证）。
- [x] P1-2 **suite 失败棘轮**（`ut-suite-baseline.ts`，codex 修正版）：基线是**授权工件**（编排在 agent 动手前真实采样写入，或用户确认后放置），**本轮执行不得反推基线**——首轮自动建基线会把本轮新增回归洗成历史（codex P0 实锤，已废）。无基线=不豁免任何失败（suite_health=UNKNOWN）；有基线=基线内非 target 失败豁免报 DEGRADED、基线外=回归 FAIL、**target 失败永不豁免**、基线只收紧不增长（本轮不再失败的条目自动剔除）。执行面（codex P0 修正）：用例失败**不短路**后续模块（棘轮需全量结果，半途 PASS=假绿）；豁免判定先于 exitCode（用例失败令 aa test 非零退出，不得据此绕过棘轮）；PASS 须全部选中模块真实执行（防御分支已加）。**实施偏差（如实披露）**：原案"业务源码入口快照"不做 direct 自动化——direct 首跑快照仍是 agent 动手后时点（同 trace 不可信问题）；正路=显式锚 `HARNESS_DIFF_BASE_REF`（ut_no_src_mutation 既有消费）或 goal 链 review-closure；cover_existing_code 模式文档要求显式锚，**不宣称 direct 自动区分入口前改动**。
- [x] P1-3 **两个结论**：状态面板输出 `feature_verdict: PASS|FAIL|INCOMPLETE` 与 `suite_health: HEALTHY|DEGRADED|UNKNOWN`（后者从 ut_hvigor_test details 机器行提取），不增平行 verdict。

### P2 一层薄入口——**已实施（机器化通道 + 文档，codex 修正后不再是纯文档能力）**
- [x] 工作模式机器化（codex P0 修正）：`MAISON_UT_MODE`（repair_existing_ut / cover_existing_code / 缺省 cover_feature_change）+ `MAISON_UT_TARGETS`（分号/逗号分隔目标文件路径）→ resolver 直接消费；显式目标在**全部已发现文件**中匹配（不限 scoped——repair 正需要点名未触碰的存量文件）。`[REG-*]` 标签**仅 repair/cover_existing 模式放行**（cover_feature_change 禁用——codex 实锤：全局放开会让需求 UT 借 REG 绕 AC 绑定）；`[CHAR-*]` 维持全放行（path-c 是 feature 内合法路径）。
- [x] SKILL.md 三工作模式路由 + 触发词 + `paths/path-repair-existing.md`（复现→六分类分诊→按权限修复→四类差异报告；出口=目标红转绿+suite 无新增失败，不强制 AC/DAG/mock-plan）；cover_existing_code 免先补 spec。

### codex 第四轮 review（P1/P2 实施审查，三 P0 两 P1 全部核实修复，2026-08-08）
- [x] ①（P0）mode/target 机器化接入：`MAISON_UT_MODE`/`MAISON_UT_TARGETS` → resolver（显式目标全量匹配不限 scoped）；REG 仅 repair/cover_existing 放行。
- [x] ②（P0）棘轮基线可信化：废"首轮执行自动建基线"（会把本轮回归洗成历史）；基线=授权工件；无基线不豁免；只收紧不增长。
- [x] ③（P0）多模块执行：用例失败不短路（棘轮需全量结果）；豁免判定先于 exitCode；PASS 须全部选中模块真实执行（防御分支+元门禁 suggestion）。
- [x] ④（P1）targetCaseView 合成视图（新增 import 行+新增 it 块），import 白名单/boundaries/it_drives_flow/覆盖族/ac-coverage/hvigor targetItNames 全部统一消费。
- [x] ⑤（P1）mockkit 增量 multiset 计数差（extractUtMockkitTargetsRaw），同 key 重复使用不被折叠。
- [x] ⑥（P1）P1-2 源码入口快照如实标注为实施偏差（显式锚正路），SKILL 明示 cover_existing/repair 须带 HARNESS_DIFF_BASE_REF。
- [x] ⑦ OpenSpec change 补建：`openspec/changes/ut-legacy-coexistence`（proposal/tasks/specs harness-gates 四条 Requirement），openspec:validate 53/53 PASS。
- ~~版本窗口待用户裁定~~ **已裁定（2026-08-09）**：本 plan 在 3.0.0 做完，version=3.0.0（3.0.0 发布门自此含本 plan；R3c 开放 todo 挡 release 门直到真机验证完成）。

### codex 第五轮 review（五条全部核实修复，2026-08-09）
- [x] ①repair/cover_existing 成为真实独立模式：需求工件门禁（use-cases/audit/mock-plan/DAG/acceptance 覆盖族/facts gate/upstream verdict/acceptance-yaml 结构族/mockkit 政策/mock_stub_for_async）经 `featureGate` 按模式统一 SKIP；显式目标**保持存量身份**（不进 targetCaseView 房规问责——修的就是存量用例，不得逼挂 feature 标签），但强制进编译/执行集合与棘轮"永不豁免"名单（否则修复目标可能被历史基线豁免=假修复）。
- [x] ②基线授权口径修正：读入校验 feature 绑定+条目形状（含 module）；信任模型如实声明=与 gap-notes approved_src_mutations 同级（普通授权文件+review 纪律，不做密码学防伪——顶层裁定 Stability over total control，codex 的签名回执方案据此裁剪）；删"编排采样已存在"虚承诺（writeOnce 标注为未来编排接口）。
- [x] ③失败身份含 module（`module::suite::test`）：跨模块同名 suite/test 不互相豁免；聚合层保留 perModule.module。
- [x] ④repair/cover_existing fail-closed：无可信锚 / repair 无显式目标或未命中 / cover_existing 责任域为空 → 新增 `ut_target_resolution` BLOCKER FAIL（不静默继续）；命中时 PASS 输出 selectionReasons。
- [x] ⑤R3c 物化进 frontmatter todos（发版解析器只读 frontmatter，正文 checkbox 不进 release 门——我上一轮"会正确挡住 release"是核实失误，release 输出列表里并无本 plan）；P0/P1/P2 同步物化为 completed todo。

### codex 第六轮 review（五条全部核实修复，2026-08-09）
- [x] ①显式目标**部分命中**同样 fail-closed：`explicitMatched !== explicitRequested` → FAIL（两模式通用）；repair 另要求 requested>0。此前只拦"全不中"，请求 A、B 只命中 A 会静默少修一个目标。
- [x] ②target 身份补齐模块（`module::test`，`targetCaseKey`）：此前失败身份已含 module 但 target 判定只看 test 名——模块 A 的目标用例名会把模块 B 的同名历史失败也标成 target，使其无法按基线豁免（我修 #3 时留下的对称性漏洞）。check-ut 改传 `targetCases:{path,test}[]`，模块由 package_path 归属推导。
- [x] ③基线收紧须全模块真实执行：`evaluateSuiteRatchet(allModulesExecuted)`——部分执行时"本轮未复现"可能只是没跑到，删条目=永久丢失历史失败记录。
- [x] ④非需求模式不生成/覆写 `ac-coverage.json`：追溯门禁已 SKIP 但报告仍会被 repair/REG 的 target view 重写掉原需求覆盖证据。
- [x] ⑤状态面板披露 `work_mode` + 责任域计数（含显式目标命中比）+「需求门禁：SKIP（模式不适用）」，且静态/结构 PASS 行在非需求模式标注"仅通用/安全门禁"——防止大量模式性 SKIP 被读成"通过了完整需求门禁"。

### codex 第七轮 review（三条组合场景漏洞，全部核实修复，2026-08-09）
- [x] ①基线收紧条件收严：`allModulesExecuted`（本轮选中模块跑完）不足以证明基线**涉及模块**都跑过，且 `executed && testResult` 对 `total=0` 也成立 → 未选中/零用例模块的历史失败会被永久误删。改为 `modulesWithValidResults`（本轮真跑出 total>0 的模块集合），基线涉及的每个模块都在集合内才整体收紧。
- [x] ②设备阻塞不得掩盖其他 BLOCKER：`feature_verdict=INCOMPLETE` 与 `partial_readiness` 现在都要求"设备阻塞是唯一 BLOCKER"；与 `ut_target_resolution`/标签/源码红线 FAIL 并存时判 FAIL 并列出其他阻塞项。
- [x] ③`cover_existing_code` 空转 PASS 封堵：显式目标只决定执行范围，不构成测试产出证据。**判据=新建测试文件 ∪ 存量文件内新增 it**（八轮修正：初版还认"整文件文本变化 `changedLegacyPaths`"，被 codex 驳回并采纳——改注释/空格即可蒙混，且这类变化不进 targetCaseView 受验收、失败还可能被基线豁免、面板责任域显示 0；该分支整条删除，不扩展文本 diff 模型。改写已有 it 的支持须做到"识别具体变更用例并全链路升格 target"，本轮不做）。

### 待宿主回灌
- ~~R1. phone build-profile targets 追问~~ **obsolete**：phone 已退出当前编译范围，无需再向宿主追问（task-not-found 归因与探测器已落地，下个真实撞上的场景自然验证）。
- [x] R2. 存量文件裸 tsc 实况：**已实锤**（TS2749 假错，同文件真实 hvigor PASS）→ 驱动 P0-1。
- [x] R3a. 一轮回灌完成：框架四项修复全部生效；暴露 #12 同族误伤、tsc 假错与 runtime downgrade 断链，均已修。
- [x] R3b. 反馈修正版宿主重跑**通过，P0 关账**（2026-08-08）：存量三条全部不再 FAIL（mockkit/标签豁免生效、tsc WARN+口径说明原样呈现）；ut_hvigor_build PASS（signed HAP）；唯一阻塞=ut_hvigor_test externalBlocked（设备拔线，归因/next_action/partial_readiness 全部正确，verdict=INCOMPLETE 不假 PASS）；宿主未修改任何存量/源码/配置。满足"全绿或仅剩环境项"关账条件。
- **R3c**（收尾确认，不阻塞关账）：用户回到设备旁后解锁+授权卸载旧包+重跑真机环节，确认 hypium 用例真实执行。
  —— 状态以 frontmatter `r3c-host-device-verification` 为准（当前 `pending`）；
  正文不再用复选框记待办（plan a3e7d1c9：frontmatter todos 为唯一机器 SSOT）。

## 八、移出主线（后续小变更备忘，不是本 plan 必要条件）

以下问题真实存在但不塞进主线，各自可成独立小变更：

| 项 | 备注 |
|---|---|
| archived DAG 同号过滤（原#6） | **假绿方向风险，移出后优先级最高**：旧 feature 同号 AC-01 可误判当前覆盖 |
| AI verifier 上下文 scoped 接线/截断（原#7） | 语义复核质量项，配合 P1-1 target 解析器一起做最省 |
| 模块级 seam registry 接线（原#9/13） | registry 条目须以代码符号校验，防文档反客为主 |
| `mock_stub_for_async` 邻近匹配（原#8/12） | 谓词近永真，独立小修 |
| `boundaries_all_stubbed` 认 `Aspect.replace`/`mockFunc`（原#11） | 宿主下一个带 use-cases 的 feature 会咬人，届时提级 |
| 通用设备自动恢复/自动卸载 | 不建设备状态机；P0-4 的确认化已足够 |

## 九、验收场景（P1 完成判据，共五个）

1. 存量 Main.test.ets 被 context 提及：不受需求房规问责，真实 hvigor 仍编译它。
2. 新增需求 UT：接受全部 feature 门禁并真实执行。
3. 修一个已有失败 UT：目标红转绿，其他失败不增加。
4. 给本地非需求代码写 UT：阶段开始前的源码改动是输入，阶段内新增源码改动被阻止。
5. 设备版本降级：正确等待用户确认（不归因代码、不引导卸载/改 versionCode），不假装 UT 完成，保留"编译已通过"事实。

## 十、悬置 / 不做（防膨胀）

- 不做 `impacted` 依赖分析（source symbol → impacted tests）；不做完整"真实消费者回归矩阵"（关键场景进单测即可）。
- 不做 AST 级完整 ArkTS 解析器；不做存量全量治理回填运动。
- 不做三轴/四身份对象体系（已被 target/suite 两集合替代）；`repository_health` 不单独成集合。
- 不动版本号；发布窗口用户裁定。
