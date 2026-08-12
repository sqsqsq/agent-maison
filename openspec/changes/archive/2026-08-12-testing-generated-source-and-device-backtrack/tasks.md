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
- [x] 3.5 宿主回归（✅ 2026-07-29 run `20260729T123155Z-0c5411`，SimulatedWalletForHmos 真机
      3UJ0225321000395）：
      · **生成物分类**：`testing_generated_file_change`（invoke_id=testing-i3）降级 4 个模块根
        BuildProfile.ets（02-Feature/FinancialCard、04-BusinessBase/AccountManager、
        05-SystemBase/CommFunc、05-SystemBase/CommUI），带冻结 product=default/build_mode=debug；
        **全 run 零 `testing_write_violation`** —— 07-28 原事故形态（同类文件致 run 终止）已消除；
      · **gate 强装 + evidence**：`device-test-evidence.json` 写出，schema 1.0、
        goal_run_id/attempt_id 齐备、device_target={serial, physical, testing-i5}、
        hap_sha256_full 64 hex、install_executed=install_ok=true（强装生效、reuse 被跳过）、
        written_at 在 harness 窗口内；
      · **归因完整性**：trace 5 失败（TC-006/007/008/010/011）与 evidence cases 集合完全一致
        （零漏项，join 链工作正常）；分类全部落 test_contract。**⚠ 该分类结果已被后续核查
        证伪为误判**——TC-010/011 的 dump 里 `sheet_scaffold-next` 实际**存在**且
        `enabled=false`，测试等的是 `enabled:true` 谓词（该谓词被解析器丢弃），属"元素在、
        状态不对"而非"测试自造 selector"。**d9 的机制交付（join/身份/白名单/集合一致性）
        验收通过；归因判据的精度问题移交 plan e3c7d95f**（详见残留二）。by_text 侧
        （`查看全部` vs spec `查看全部银行`/`查看全部 (6)`）确为测试文案不精确，
        test_contract 判定对。
      · R11 physical attestation 在该机型**通过**（target_kind=physical，非 unknown）。
      **残留一（已知边界）**：product_actionable → backtrack_to_coding 真机通路本轮未触达
      （见残留二：真缺陷被 test_contract 掩盖了）；该通路由单测覆盖（device-test-backtrack +
      testing-integrity T2-2 全链 E2E）。
      **残留二（本轮回归新发现的 P0 缺口，超出 d9 范围 → 已建 plan e3c7d95f）**——
      定性经两轮纠错后定稿（前两版均被证伪，教训见 e3c7d95f 的"判读纠错记录"）：
      · **误判链三环**：① 派生步骤解析**丢弃谓词**——派生计划写
        `{"wait_for":{"by_id":"maison:...:sheet_scaffold-next","enabled":true,...}}`，
        解析后只留 selector/scope，evidence 里 `enabled:true` 不见了；② 分类器只做
        selector 字面比对，**不看 dump 里元素实际状态**——TC-010/011 的 dump 里该元素
        **存在**且 `enabled=false`（selector 正确、元素在场、状态不满足），却被判
        test_contract（测试自造）不回 coding；③ runtime 锚点 semantic 段与 ui-spec node
        无规范化互认（产品 `sheet_scaffold-next` vs spec `sms_next_btn`；同屏
        `sms_input` 却与 spec 同名——脚手架命名部分对齐部分漂移）。
      · **定性纠正（勿再写错）**：`maison:` 前缀是 framework 自己的 ui-kit 实例语义锚点
        （ui-kit-anchors.ts 的设计契约，解决 ArkUI uitree 展开与重复行 id 不唯一），
        产品渲染锚点是**正确行为**；**此前"产品系统性偏离 spec"与"产品缺 sms_next_btn"
        两个定性均已被证伪**（后者错在以单帧 TC-006 dump 推全局——那帧是键盘展开/Sheet
        被裁剪的树）。
      · **附带**：`isValidAnchor` 要求五段而真机全四段，且该函数在生产代码零消费
        （契约存在但无人执行）；unverified 集合无无进展熔断（i3/i4/i5 完全相同 5 条，
        白烧 130 分钟真机）；回喂 reason 未给正确 node（agent 三轮没修对）。
      · **DEF-001/002 性质已判定（✅ 2026-07-30 人工采证）**：真机手动输入 123456 后
        `sheet_scaffold-next` **仍不可点击** ⇒ 排除 (a) Hylyre input 未触发 ArkUI onChange
        的工具侧假设，定性为 **(b) 产品侧缺陷**（双向绑定/enabled 联动）。这同时反证
        `test_contract` 判定掩盖了一个真产品缺陷——即残留二的机制缺口在真机上确有后果。
        **宿主处置（2026-07-30 用户决定）**：产品代码**全部回退重写**，不单修该缺陷；故本
        缺陷的价值从"待修项"转为**归因逻辑的黄金样本**（性质已确证 + dump 证据完整 +
        形态清晰），由 plan e3c7d95f 落 fixture 后单测锁住四种分类——重写后的产品大概率
        不再产生同形态失败，本轮 dump 是唯一历史样本。
