# TESTING 阶段验证报告 — cu-YmMtb3BlbkNhcmQtMgBiYW5rLWNhcmQtb3BlbmluZy1mbG93

> 生成时间: 2026-10-24T19:51:29.943Z
> 保证等级: full
> 能力解析: 3 项

## 一、脚本 Harness 检查结果

| 指标 | 值 |
|------|-----|
| 总检查项 | 61 |
| PASS | 56 |
| FAIL | 0 |
| WARN | 4 |
| SKIP | 1 |
| BLOCKER 数 | 0 |
| **裁定** | **PASS** |

### 警告项

- ℹ️ **derived_selector_contract**: [SELECTOR-SPEC-001] 共 84 个 canonical selector 问题：
  - TC-001 step 2 by_text=添加管理卡片: by_text 未映射到当前 feature ui-spec text（开放世界：既有入口/前置页面通常不重复建模）；静态放行，最终由本轮 native selector evidence 裁决
  - TC-001 step 3 by_id=cp_page_title: by_id 不在当前 feature ui-spec（开放世界：既有入口/前置页面通常不重复建模）；静态放行，最终由本轮 native selector evidence 裁决
  - TC-001 step 4 by_id=cp_add_card_btn: by_id 不在当前 feature ui-spec（开放世界：既有入口/前置页面通常不重复建模）；静态放行，最终由本轮 native selector evidence 裁决
  - TC-001 step 5 by_id=ac_page_title: by_id 不在当前 feature ui-spec（开放世界：既有入口/前置页面通常不重复建模）；静态放行，最终由本轮 native selector evidence 裁决
  - TC-001 step 6 by_id=ac_bank_card_row: by_id 不在当前 feature ui-spec（开放世界：既有入口/前置页面通常不重复建模）；静态放行，最终由本轮 native selector evidence 裁决
  - TC-001 step 7 by_id=col_page_title: by_id 不在当前 feature ui-spec（开放世界：既有入口/前置页面通常不重复建模）；静态放行，最终由本轮 native selector evidence 裁决
  - TC-001 step 8 by_id=col_row_cmb: by_id 不在当前 feature ui-spec（开放世界：既有入口/前置页面通常不重复建模）；静态放行，最终由本轮 native selector evidence 裁决
  - TC-001 step 45 by_id=home_root: by_id 不在当前 feature ui-spec（开放世界：既有入口/前置页面通常不重复建模）；静态放行，最终由本轮 native selector evidence 裁决
  - TC-002 step 2 by_text=添加管理卡片: by_text 未映射到当前 feature ui-spec text（开放世界：既有入口/前置页面通常不重复建模）；静态放行，最终由本轮 native selector evidence 裁决
  - TC-002 step 3 by_id=cp_page_title: by_id 不在当前 feature ui-spec（开放世界：既有入口/前置页面通常不重复建模）；静态放行，最终由本轮 native selector evidence 裁决
  - TC-002 step 4 by_id=cp_add_card_btn: by_id 不在当前 feature ui-spec（开放世界：既有入口/前置页面通常不重复建模）；静态放行，最终由本轮 native selector evidence 裁决
  - TC-002 step 5 by_id=ac_page_title: by_id 不在当前 feature ui-spec（开放世界：既有入口/前置页面通常不重复建模）；静态放行，最终由本轮 native selector evidence 裁决
- ⚠️ **test_case_to_acceptance**: 1 条测试用例未关联 AC/BD 编号：
  - TC-011
- ⚠️ **visual_diff**: screens=6；pass=0；warn=6；fail=0；skipped=0；pending=0；must_fix=26；p0=6；defects=38
[provenance] critic 回执生效档位=unverified（交互态无法从外部证明图片注入——不宣称"已证明看图"；防线=SSOT 强制写 verdict 前逐屏 Read crop）
[fingerprints] ineligible（本轮整体不参与熔断比较）：capture_not_run：本轮未执行视觉采集（build/install/run 或静态门禁提前返回），旧视觉状态不得参与熔断
【按档位降级（fidelity=pixel_1to1、acceptance_strictness=best_effort，非硬像素契约）】以下屏的 must_fix / major 缺陷为自报样式残差，记视觉债务、不驱动回退（仍阻断发布）：bank_card_selection(shape_mismatch@selection_next_btn), card_type_sheet__overlay__card_type_overlay_root(other@card_type_sheet_panel,other@card_type_bank_row,other@card_type_continue_btn), card_type_sheet__overlay__card_type_sheet_panel(other@card_type_sheet_panel,other@card_type_bank_row,other@card_type_continue_btn), otp_verification_sheet__overlay__otp_overlay_root(other@otp_next_btn), otp_verification_sheet__overlay__otp_sheet_panel(other@otp_next_btn), opening_result_success(other@result_guide_illustration)
边缘哨兵：超阈 tile 有结构差异但未被 defect.bbox 登记，VL 须复核区域：bank_card_selection[7,0 7,1 7,2 7,3 7,4 7,5]
【t2 hard 命中被降级】T8 hard 命中转录为 minor（机器确定性证据不得降级）：card_type_sheet__overlay__card_type_overlay_root[A1_protected_region#ce22df03d2e971ec], card_type_sheet__overlay__card_type_sheet_panel[A1_protected_region#5a30a0d2481c27fb]——severity 至少 major
【t2 落账提醒】T8 warn 命中未转录 defects（终判前须落账或以 defect 记录处置结论）：otp_verification_sheet__overlay__otp_overlay_root[B3_order_inverted#0e507cfab37497f9], otp_verification_sheet__overlay__otp_sheet_panel[B3_order_inverted#11b0f42e7c002577]
【T8 布局不变量违反（运行时布局树确定性证据，VL pass 不可推翻、禁止弃判）】card_type_sheet__overlay__card_type_overlay_root[A1_protected_region#ce22df03d2e971ec] bbox=[0.0364,0.4214,0.9273,0.0839]: 保护区 [card_type_sheet_close] 被可交互控件「col_row_citic」侵入（{"x1":48,"y1":961,"x2":1272,"y2":1129}）——移出保护区或调整布局 | card_type_sheet__overlay__card_type_sheet_panel[A1_protected_region#5a30a0d2481c27fb] bbox=[0.0364,0.4214,0.9273,0.0839]: 保护区 [card_type_sheet_close] 被可交互控件「col_row_citic」侵入（{"x1":48,"y1":961,"x2":1272,"y2":1129}）——移出保护区或调整布局
【T8 布局结构观测（WARN 档，档位见 layout-oracle-calibration.md）】bank_card_selection[B2_group_container_missing#963efe857d8a9a51] bbox=[0.0409,0.1348,0.9182,0.4079]: 声明分组容器 [bank_card_selection_root]（bg_color=color.page_bg）的子元素 selection_hint/selection_card_container/selection_agreement_check/selection_agreement/selection_next_btn 运行时无共同子容器（最近公共祖先≈页面根）——疑似被实现为独立块而非同卡 | bank_card_selection[B3_order_inverted#f43ddb76359d2ac0] bbox=[0.0515,0.3719,0.9076,0.0689]: [selection_agreement_check]（order=3）与 [selection_agreement]（order=4）运行时纵向顺序颠倒（y=876 vs 862） | card_type_sheet__overlay__card_type_overlay_root[B2_group_container_missing#09991a0da942d2d5] bbox=[0.0364,0.0185,0.9273,0.2157]: 声明分组容器 [card_type_background_page]（bg_color=color.page_bg）的子元素 background_add_bank_title/background_search_bank 运行时无共同子容器（最近公共祖先≈页面根）——疑似被实现为独立块而非同卡 | card_type_sheet__overlay__card_type_overlay_root[B3_order_inverted#3af5585b71343481] bbox=[0.0364,0.4488,0.9273,0.0539]: [card_type_sheet_title]（order=0）与 [card_type_sheet_close]（order=1）运行时纵向顺序颠倒（y=1035 vs 1016） | card_type_sheet__overlay__card_type_sheet_panel[B2_group_container_missing#b25ebbbfe91772e3] bbox=[0.0364,0.0185,0.9273,0.2157]: 声明分组容器 [card_type_background_page]（bg_color=color.page_bg）的子元素 background_add_bank_title/background_search_bank 运行时无共同子容器（最近公共祖先≈页面根）——疑似被实现为独立块而非同卡 | card_type_sheet__overlay__card_type_sheet_panel[B3_order_inverted#efc063214eff7edc] bbox=[0.0364,0.4488,0.9273,0.0539]: [card_type_sheet_title]（order=0）与 [card_type_sheet_close]（order=1）运行时纵向顺序颠倒（y=1035 vs 1016） …共 9 处
≥2 屏共享 screenshot_hash（疑似 Tab 未切换/重复采集，至少一屏为错图）：a8c6fbd6dfdd4211:card_type_sheet__overlay__card_type_overlay_root+card_type_sheet__overlay__card_type_sheet_panel
文本块观测 per-element 素材（advisory，VL 终判须折算进 screens[].must_fix；不直接阻断）：card_type_sheet__overlay__card_type_overlay_root: 「添加银行卡」参考图可见、实测截图未识别到——检查是否缺渲染/被遮挡/文案改写（大字体行 OCR 漏识别亦可能，修复后以新截图重验）；「免输卡号添卡    支持 100」参考图可见、实测截图未识别到——检查是否缺渲染/被遮挡/文案改写（大字体行 OCR 漏识别亦可能，修复后以新截图重验）；「搜索银行    搜索」参考图可见、实测截图未识别到——检查是否缺渲染/被遮挡/文案改写（大字体行 OCR 漏识别亦可能，修复后以新截图重验）；「招商银行」参考图可见、实测截图未识别到——检查是否缺渲染/被遮挡/文案改写（大字体行 OCR 漏识别亦可能，修复后以新截图重验） | card_type_sheet__overlay__card_type_sheet_panel: 「添加银行卡」参考图可见、实测截图未识别到——检查是否缺渲染/被遮挡/文案改写（大字体行 OCR 漏识别亦可能，修复后以新截图重验）；「免输卡号添卡    支持 100」参考图可见、实测截图未识别到——检查是否缺渲染/被遮挡/文案改写（大字体行 OCR 漏识别亦可能，修复后以新截图重验）；「搜索银行    搜索」参考图可见、实测截图未识别到——检查是否缺渲染/被遮挡/文案改写（大字体行 OCR 漏识别亦可能，修复后以新截图重验）；「招商银行」参考图可见、实测截图未识别到——检查是否缺渲染/被遮挡/文案改写（大字体行 OCR 漏识别亦可能，修复后以新截图重验） | otp_verification_sheet__overlay__otp_overlay_root: 「55 秒后重试」参考图可见、实测截图未识别到——检查是否缺渲染/被遮挡/文案改写（大字体行 OCR 漏识别亦可能，修复后以新截图重验） | otp_verification_sheet__overlay__otp_sheet_panel: 「55 秒后重试」参考图可见、实测截图未识别到——检查是否缺渲染/被遮挡/文案改写（大字体行 OCR 漏识别亦可能，修复后以新截图重验）
- ⚠️ **visual_feedback**: 【视觉反馈】硬不变量 4 项（声明文案设备侧缺失）+ advisory 12 项；收敛=stalled：
  - [bank_card_selection] 参考图文本「《招商银行」设备侧缺失（ui-spec 声明文案——硬不变量）
  - [bank_card_selection] 参考图文本「侨同意并阅读《云内付App一键绑卡用户授权协议)》、《招商银行信」设备侧缺失（ui-spec 声明文案——硬不变量）
  - [bank_card_selection] 参考图文本「用卡快捷支付服务协议》，授权云闪付获得您在本行银行卡号等信」设备侧缺失（ui-spec 声明文案——硬不变量）
  - [bank_card_selection] 参考图文本「息。」设备侧缺失（ui-spec 声明文案——硬不变量）
（阻断承载：文本存在性 BLOCKER 归既有 OCR 门禁；本条为修复输入 SSOT——见 visual-feedback.md）

## 二、AI Harness 语义验证

> AI Harness prompt 已生成，请将以下文件发送给任意 AI 模型执行验证：
> `..\..\doc\features\bc-openCard-2\bank-card-opening-flow\testing\reports\ai-prompt.md`

## 三、最终裁定

**PASS** — 脚本 Harness 未发现 BLOCKER 失败。注意：脚本 PASS 不代表阶段闭环完成，仍必须继续执行 verifier 语义验证并填写 completion receipt。
