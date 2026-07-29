# Tasks — testing-generated-source-and-device-backtrack (plan d9e4b7c1 v13)

## T1 生成物分类降级

- [x] 1.1 profile 分类器 `profiles/hmos-app/harness/generated-source-classifier.ts`：
      模块根路径判据（根 build-profile.json5 `modules[].srcPath + '/BuildProfile.ets'`）、
      模板结构白名单（四常量+兼容类，模板外零语句）、四常量值与冻结配置推导逐值等值
      （HAR_VERSION=模块根 oh-package.json5 version；BUILD_MODE_NAME/DEBUG=冻结 buildMode；
      TARGET_NAME=模块 targets×applyToProducts 匹配冻结 product，无显式回落 'default'）
- [x] 1.2 goal-runner 裁决层接线：mutated diff 逐项分类（动态 require profile 分类器，
      取不到/异常 → 全部 violation fail-closed）；全降级 → `testing_generated_file_change`
      事件不 halt；混合 → violation 事件 changed 只列真违规 + `generated_changed` 单列
- [x] 1.3 attempt 配置冻结：testing attempt 开始解析 {product, buildMode}，经 env 同发
      agent（extraEnv）与 gate harness（deviceEnv 通道），直传分类器；注入点对键先
      `deleteEnvKeyCaseInsensitive` 再写唯一大写键（agent-invoke 与 runHarnessPhase 两处）
- [x] 1.4 单测（testing-integrity 脚手架 + run-unit 注册）：合法生成三文件降级不 halt
      （宿主真实内容正例）；错误常量/额外语句/removed/type-changed → violation；混合两清单；
      仅降级事件可 resume；半写文件 violation；mixed-case env 覆盖清理

## T2 正式 gate 强制安装 + evidence + 回修接入

- [x] 2.1 install provider：装机前计算 `hapSha256Full`（完整 64 hex，新增 helper，12 hex
      既有消费者不动）并随 result 回传；holder 增 installExecuted/installOk/hapSha256Full
      （installPassed 既有消费不动）
- [x] 2.2 goal-runner gate 注入：testing 的 gate harness env 增
      `HARNESS_DEVICE_TEST_FORCE_INSTALL=1`（复用既有开关）；spawn gate 前删除
      `device-test-evidence.json`（pre-delete 防伪）；deviceEnv 注入键统一大小写清理
- [x] 2.3 evidence 统一写入（check-testing 协调层，经 provider 导出的合成函数）：门槛=
      `MAISON_GOAL_GATE_HARNESS===1` + goal 身份完整 + install executed&&ok +
      deviceTestRunExecuted && hylyreTracePath 非空 + 写前复算 full sha 与装机前一致；
      trace_path 直取 holder（禁调 authoritative resolver）；schema 含 written_at
- [x] 2.4 cases 合成与归因：failure_artifacts 子句严格解析 → basename 防逃逸 → case/step
      一致 → 选中派生计划查 step 定义，缺失/多义 unjoinable；classification 四分类
      （product_actionable 三条件 / environment=结构化 RunFailureKind+install diagnosis /
      test_contract / unknown，禁扫散文）
- [x] 2.5 collector C 支路：只消费 evidence；校验 run/attempt + device_target 元组（runner
      内存直传）+ trace_path 与 resolveAuthoritativeHylyreTracePath 一致 + written_at 与
      run meta 窗口同落 harness_start~harness_end；仅 physical×product_actionable 进
      ActionableDefect（source='device_test'）；根/级联三分复用 triageCascade；指纹进既有
      roundFingerprintOf；其余进 unverified
- [x] 2.6 unverified 通路泛化：entries 增 source（visual|device_test），retry/halt 文案按
      source 分支；事件名 `unverifiable_must_fix` 保留
- [x] 2.7 单测（含 RunHarnessFn 缝扩 deviceEnv 或纯函数断言 child env）：宿主 trace fixture
      三集合精确断言（根 === {TC-001,TC-007}、级联 === {TC-002,003,004,006,008}、
      actionable === {TC-001}、注入数 === 1）；join 多义只认 failure_artifacts 指名 step；
      gate 强装（flag → reuse 跳过）；安装失败 → environment 不回 coding；身份/元组/hash/
      窗口不匹配 → unverified；agent 预写 evidence 被 pre-delete 消除；普通模式零差异；
      同集合指纹熔断

## T3 契约面与文档

- [x] 3.1 OpenSpec delta 本 change（先归档 device-readiness-and-completion——已完成）
- [x] 3.2 VISUAL_GAP_RETRY_GUIDANCE_TESTING 文案：framework harness 触发的构建生成物由
      runner 自动分类不算违规；agent 内临时覆盖 PRODUCT/BUILD_MODE 不受支持；
      device-testing SKILL / profile-addendum 同步
- [x] 3.3 hmos-app 专属 init/addendum 补宿主 .gitignore 指引（`**/BuildProfile.ets`，
      profile 级测试钉住；不进通用 canonical；注明与 T1 分类不互替）
- [x] 3.4 docs/overview.md 门禁表；MAINTAINER-CHANGELOG 经 gen-changelog 生成
- [ ] 3.5 宿主回归（后续宿主侧）：preflight（device:policy + R11 attestation 校准）→ 新开
      完整 run → 分支化事件验收（invoke 内有生成物变化才要求 generated 事件；gate 强装 →
      evidence → product_actionable(physical) → backtrack_to_coding；不看终态 COMPLETED）
