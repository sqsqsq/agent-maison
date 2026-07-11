## Why

宿主 bc-openCard（pixel_1to1 最严档）device-testing 视觉回环 8 屏全 pass 收口后，人工逐页检视仍立刻发现三类几何/结构缺陷（半模态同卡结构错误、关闭钮与银行区域重叠、间距失衡）。根因（plan c6d8f2b4，五条盘上证据）：①管线无任何运行时几何确定性信号（T1/T5/P1-C 全是 OCR 文本信号）；②`geometric_iou`/`fidelity_score` 纯 VL 自报且无诚实性元门禁——实证 8 屏 iou 恒等 0.95、7/8 屏 fidelity 逐位抄 score_floor、灾难地板消费自报值等于假保障；③spec 几何合同对 overlay 屏失守（2 行 list 低于 lint 阈值、银行行整个未建模）；④Hylyre dump-ui 已采但 bounds 从未被消费；⑤SSOT 明文"MVP 单轮+人工决定迭代"，评审无成对图入模证据要求、评审者与实现者同上下文自审。

## What Changes

- **主线 A（确定性 oracle）**：采图时同步 dump 运行时布局树（`layout-<screen_id>.json`，与 screenshot_hash/build 指纹同键绑定）；新确定性信号 T8 `visual_diff_layout_invariants`——A 类 forbidden-overlap 拓扑（硬 gate 只吃显式 `forbidden_overlap`/`protected_region` 声明+越界；close 默认规则 advisory 起步）、B 类 spec 派生结构（WARN 起步）、C 类间距比例（永久 advisory）；ui-spec↔运行时节点 locator 协议（exact_id > unique_text > structural，覆盖率不足该屏 B 类 SKIP+WARN）。
- **自报度量降权**：`fidelity_score`/`geometric_iou` 更名 `reported_*`（legacy 读入映射），零 gate 权重；灾难地板/低分 pass 等一切消费自报值的门禁改为真算值可得才启用、否则 SKIP+注记；新元门禁 M1 `visual_diff_selfreport_integrity` 拦退化模式（跨屏常数/逐位抄 floor → pixel_1to1 BLOCKER；压线空 defects → WARN）。
- **评估/采集双新鲜度解耦**：`evaluation_invalidated` 标记只失效评估（critic 重评 reported_*/region_attest），不触发设备重采、不作废真人 confirmed_by。
- **举证结构化（主线 B）**：pixel_1to1 P0 pass 屏 defects=[] 须附 `region_attest[]`（逐区域 checked 声明+method+evidence）；paired_crop_compare 条目须有 `_attest/` 并排 crop 物证与 critic 回执（`critic-receipt.json`：prompt hash/image_inputs[]+hash/input_provenance）；交互态无法证明注入 → `input_provenance: unverified` 如实标注（不宣称已证明看图），防线由 SSOT"写 verdict 前须逐屏 Read crop"承担。
- **critic 迭代闭环**：SSOT 回修条款从"MVP 单轮+人工决定是否再迭代"改为"独立 critic → must_fix → coding → 重采重判自动迭代至 candidate-pass 或熔断（no-progress 指纹化判据）"；candidate-pass 两档位（verified/unverified）；candidate-pass 前禁止发起 T2 批量确认；T2 语义不变、时点后移为批量终审。
- **spec 几何合同收紧**：STRUCTURE_LINT_FLAT_LIST_MIN 3→2；overlay P0 屏直系子节点须 bbox/layout_group 至少其一；overlay 屏参考图单独 OCR 分母比对；ui-spec 新增 `forbidden_overlap`/`protected_region`；pixel_1to1+真视觉在位（canary tool_read）下 verified=unverified 升 BLOCKER。

## Capabilities

### New Capabilities

None（扩展既有 `device_test.visual_diff` 与 spec/coding 门禁面）。

### Modified Capabilities

- `visual-diff`: schema 1.0→1.1（reported_* 更名、region_attest[]、evaluation_invalidated、layout_dump_status）；T8/M1 新信号；attest/receipt 证据校验；candidate-pass 语义。
- `ui-spec`: screens[] 新增 forbidden_overlap/protected_region；结构 lint 阈值与 overlay 合同收紧。

## Impact

- schema：`visual-diff.json` 1.1（legacy 1.0 读入兼容：fidelity_score/geometric_iou 映射 reported_*；M1 对 legacy 文件照常判）；`ui-spec.schema.json` 新字段；新 `critic-receipt.json`（features 目录，严禁落宿主 framework/ 树内——e8f5a2c7 G2 管辖域）。
- runtime：`profiles/hmos-app/harness/{visual-diff-check, visual-diff-capture, layout-oracle-check(新), capture-completeness-check, spec-ui-spec-check, coding-visual-parity-check}`、`harness/scripts/utils/adhoc-dump-ui`。
- rubric/SSOT：`skills/reference/device-testing-workflow-detail.md` Step 4.6（成对图举证/critic 分离/迭代与熔断/candidate-pass）；`skills/feature/spec/reference/ui-spec.md`（同卡分组指引）。
- 校准 SSOT：`docs/operations/layout-oracle-calibration.md`——T8 各子信号 gate 档位以其决定表为准；真机校准项（D1-D6）随宿主复验执行，未通过校准的子信号不硬 gate。
- 测试：`profiles/hmos-app/harness/tests/unit/{layout-oracle, selfreport-integrity, region-attest}.unit.test.ts` 等。
