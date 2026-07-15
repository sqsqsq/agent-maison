## Why

2026-07-13 宿主 SimulatedWalletForHmos bc-openCard 实锤事故（plan e3a9c5d1，codex 六轮 review 通过）：goal 无头链产出严重残次品（DEVICE_TEST_FAST_PATH 短路核心流程、11/18 用例 explicit_skip、UI 与 10 张参考截图零机器比对、卡包 [object Object]），但 harness/verifier/goal-report 全链绿灯。六洞：①testing 期 agent 改产品行为开关零确定性拦截；②explicit_skip 无界+通过率按已执行子集计，已执行用例在 trace"通过"但验的是 fast path；③需求「完全参考」×7 强 pixel 信号被 spec 自降 semantic_layout（runner 只检测 manifest 摘要，未解引用 SSOT 文档），全部视觉硬门禁随档位失效；④9 P0 屏视觉比对因缺 nav config 被 WARN 静默吞没；⑤must-review 留痕解析（行内正则）与 agent 实写（markdown 表格）错配，goal-report 待审清单渲染为空；⑥review「有条件通过+2 MAJOR」在 check-review 无 BLOCKER 即 PASS，goal 照常推进。更深层：截断链 run 的 COMPLETED 被读成"需求完成"，上游 PASS 仅靠 manifest 文本断言，无阶段血缘与完成凭证。

## What Changes

- **t1 结构化决议账本**：headless 自动决议 SSOT 从 markdown 改为 `headless-assumptions.jsonl`（schema 校验，goal 环境 BLOCKER），confirmation-registry 逐 gate 完整性交叉核验，md 降人读投影；账本仅留痕，不构成任何 hard-gate-lowering 授权。
- **t2 review closure attestation**：review 四件套闭环时生成 attestation，绑定 contracts hash + **全产品源码树 inventory**（profile-aware `discoverProductSourceRoots()` 五源并集 + 孤儿文件/空集两条 fail-safe）+ report/verifier hash + gate fingerprint + run 身份；testing 按 attestation 固化 inventory 对账，产品源码任何变更/attestation 缺失 → BLOCKER，无 grace window。并入 `conditional_pass_closure`：review 声明「有条件通过」且 findings 未闭环、无有效授权 receipt → verdict INCOMPLETE。
- **t3 产品行为开关扫描**：非测试源码中 `FAST_PATH/DEVICE_TEST/BYPASS/...` 类布尔常量默认 true → BLOCKER（coding+testing 双消费）；waiver 绑定 file+symbol+content hash，只降级不洗白。
- **t4 P0 结构化业务状态迁移证明**：acceptance.yaml 增 `flows`（有序 screen_id 链）与 P0 checkpoint（pre/action/post + required/forbidden 元素）；三约束（边须 P0 AC 拥有 / AC 带 requirement_ref 源片段 hash 验存 / flow=checkpoint edges 有序合成）；`acceptance.flow_contract` 确认点（首次结构化模型须真人 receipt，改动即 stale）；testing 期 `p0_semantic_coverage_integrity` 对账 trace（动作证据+后置断言+中间屏有序出现+坐标 touch hit-test 唯一命中；页面签名仅 anti-replay）。
- **t5 P0 skip/unreachable 治理**：P0 用例 skip/屏 unreachable 不可用 in-repo waiver 洗白；外部阻塞走 DEFERRED，其余 FAIL；waiver 仅降级并封顶 AWAITING_HUMAN_REVIEW；双口径（执行覆盖率+通过率）强制分列重算对账。
- **t6 保真档位收口**：runner 解引用 requirement 引用文档做意图检测；三态意图（强/ambiguous/无）；check-spec `fidelity_intent_reconciliation`（强意图 vs 声明降级 → BLOCKER）；强意图+缺视觉能力 → spec 前 `DEFERRED_CAPABILITY_MISSING`；`--fidelity` 只升不降，降档唯一通道=带外 confirmation receipt。
- **t7 视觉采集完备性**：nav config 缺失=完备性 BLOCKER（与档位脱钩，单屏门槛）；unreachable 限外部阻塞枚举+失败 trace 绑定+封顶；ux-reference 逐图建模对账，out-of-scope 须裁剪证明、需求正文引用图禁 agent 自划、多数 out-of-scope FAIL。
- **t8 阶段血缘与 feature 完成凭证**：每阶段 closure 生成 `phase_closure_fingerprint`（inputs+outputs+environment，文件集 SSOT=复用 spec-loader 表的 `resolvePhaseEvidenceManifest()`；独立 `phase-evidence-manifest.json` 无环封装）；两消费点（截断链 preflight / 完成验真）重算 staleness；clean_pass 六条件；`verify-feature-completion` 唯一验证入口（VALID|STALE|INVALID，禁止消费文件存在性/自报字段）；completion 原子写 runner-owned 目录；状态枚举去 COMPLETED 语义放大（CHAIN_SLICE_COMPLETED / AWAITING_HUMAN_REVIEW / FEATURE_INCOMPLETE / FEATURE_COMPLETED / DEFERRED_CAPABILITY_MISSING）。
- **t9 杂项**：goal-report WARN 摘要（视觉缺席/覆盖不足/证据缺失置顶）；hmos `${$r()}` Resource 插值 lint；mock 可辨识性 skill 指引。
- **t10 confirmation receipt 统一消费**：五消费点（降档/P0 waiver/conditional-review/行为开关豁免/flow_contract）单一校验 util；信任锚强制条款（预置可信 registry 取键、禁内嵌公钥、unknown issuer/key/alg 一律 INVALID、规范化全量签名、rotation/revocation）；**签发一律不在本 change**（归 runtime-policy-core；无本地/TTY 签发）；无有效 receipt → 工作继续但状态封顶 AWAITING_HUMAN_REVIEW，双模式一致。

显式非目标：receipt 签发体系（含密码学/外部通道，runtime-policy-core）；ut/testing FAIL 自动回流编排；verifier prompt 裁决逻辑；cursor SubagentStop 强制解析拉齐；常驻失效 DAG（两消费点重算）；宿主工程修复（用户重做）。

## Capabilities

### New Capabilities

- `confirmation-receipts`：hard-gate-lowering 授权的统一凭证**消费**能力（schema 校验、信任锚、绑定/过期/stale 判定、fail-closed 封顶语义）。

### Modified Capabilities

- `goal-runner`：状态枚举重构、截断链上游 closure 机器核验、feature-completion 生成与 supersede、requirement SSOT 解引用与能力前置闸、新 halt 分类（await_human_p0_skip / await_human_fidelity_tier / DEFERRED_CAPABILITY_MISSING）、决议账本 JSONL 契约注入。
- `harness-gates`：新增/改造门禁面（attestation 对账、行为开关扫描、p0_semantic_coverage_integrity、skip 治理、fidelity_intent_reconciliation、nav 完备性、conditional_pass_closure、账本 schema 校验、pass-rate 双口径）。
- `feature-artifact-layout`：新 artifacts（headless-assumptions.jsonl、phase-evidence-manifest.json、review-closure-attestation.json、feature-completion.json 及投影、skip/behavior-switch waivers、acceptance flows/checkpoint 扩展）。

## Impact

- Affected specs: confirmation-receipts（新增）、goal-runner、harness-gates、feature-artifact-layout
- Affected code: `harness/scripts/goal-runner.ts`、`harness/scripts/utils/{goal-report-generator,goal-failure-classifier,await-confirm-guidance,fidelity-shared,spec-loader,goal-preflight}.ts`、`harness/scripts/check-{spec,review,receipt,testing,coding}.ts`、新 utils `{phase-evidence-manifest,closure-attestation,behavior-switch-scan,confirmation-receipt,verify-feature-completion}.ts`、`specs/phase-rules/*.yaml`、`skills/reference/{user-confirmation-ux.md,confirmation-registry.yaml}`、`profiles/hmos-app`（$r lint）、schemas（summary/goal-report/receipt/manifest/acceptance）
- 五方协调（design.md 冲突矩阵）：critic-loop-hardening 与 layout-oracle-geometry-gates **已落地为基线**（9ad4f2b5/bb94b73e）；真并行=runtime-policy-core（仅文件级：check-receipt/goal-runner——其无凭证 scope，签发落位后继 change `confirmation-credential-issuance`，见 design §3.4）、goal-mode-unattended-survival（INTERRUPTED 与本 change 枚举正交，design §3.4b）、feature-track（t8 按 track 解析链）。
- **Breaking / MIGRATION.md**：①attestation 缺失 testing 一律 FAIL——存量 feature 首次跑新版 testing 前须补跑一次 review 闭环；②goal-report status 枚举重命名——消费方（goal-status、宿主提示语、hooks）随迁；③headless 决议账本改 JSONL——旧 md-only 兼容读取但新 run 必须产 JSONL；④P0 AC 缺结构化 checkpoint → check-spec FAIL——存量 feature 重跑 spec 时须补 flows/checkpoint。
