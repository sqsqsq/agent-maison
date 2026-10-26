<!-- maison:generated:test-report v1 -->
# 测试报告 — cu-YmMtb3BlbkNhcmQtMgBiYW5rLWNhcmQtb3BlbmluZy1mbG93

> **模块标识**: `cu-YmMtb3BlbkNhcmQtMgBiYW5rLWNhcmQtb3BlbmluZy1mbG93`
> **版本**: harness-generated 2026-10-24T19:44:51.836Z
> **日期**: 2026-10-24T19:44:51.836Z
> **测试执行人**: harness（机器生成；agent 观察见 testing/notes.md）
> **对应测试计划**: `doc/features/bc-openCard-2/bank-card-opening-flow/testing/test-plan.md`
> **权威 run**: `doc/features/bc-openCard-2/bank-card-opening-flow/testing/reports/20261024T194450Z-003/hylyre/trace.json`（trace sha256 c9b11e8f64a89f9f）

> 本文件由 harness 从 trace / timing / meta / gaps / visual-diff / visual-debt / measure / stability 整份生成，重跑 harness 或 `--report-reconcile-only` 会重写；请勿手改，观察与决策写 `testing/notes.md`。

---

## 一、测试概览

| 项目 | 内容 |
|------|------|
| 测试模块 | cu-YmMtb3BlbkNhcmQtMgBiYW5rLWNhcmQtb3BlbmluZy1mbG93 |
| 测试日期 | 2026-10-24T19:44:51.836Z |
| 测试环境 | hylyre 0.5.1, hypium 6.1.0.210 |
| 执行人 | harness（机器生成） |
| 用例总数 | 11 |
| 执行用例数 | 9 |
| 跳过用例数 | 2 |

### 真机流水线耗时

> 数据来源：device-test-timing.json（harness 在 device_test.run 成功后写入）；耗时为精确整数毫秒，`—` 表示无数据。

| 阶段 | 耗时 | 说明 |
|------|------|------|
| 打包 (hvigor) | 0ms | 复用既有 HAP; `reused=true` |
| 装机 (hdc) | 0ms | 复用已装版本; `reused=true` |
| Hylyre 自动化 | 215999ms | 含设备预启动 |
| 快照写入 (page save) | 6574ms | 非致命 |
| **合计（脚本统计）** | **—** | harness 各阶段之和（writer 为 null 时为 —） |

| 元数据 | 值 |
|--------|-----|
| HAP 落盘时间 (hapBuiltAt) | 2026-10-24T19:31:01.498Z |
| 本次 harness 跑 build 门禁时刻 | 2026-10-24T19:50:57.147Z |

---

## 二、测试执行结果

| 用例编号 | 用例名称 | 优先级 | 执行状态 | 耗时 | 备注 |
|----------|---------|--------|---------|------|------|
| TC-001 | 添加银行卡入口完成成功开卡 | P0 | 通过 | 25366ms |  |
| TC-002 | 全部银行入口复用卡型 Sheet | P0 | 通过 | 24754ms |  |
| TC-003 | 卡型 Sheet 取消后重入复位 | P0 | 通过 | 9483ms |  |
| TC-004 | 候选卡掩码与协议组合门禁 | P0 | 通过 | 11117ms |  |
| TC-005 | OTP 自动发送与六位数字门禁 | P0 | 通过 | 16166ms |  |
| TC-006 | OTP 倒计时归零与重发 | P0 | 通过 | 72256ms |  |
| TC-007 | OTP 关闭后重新进入清空瞬态 | P0 | 通过 | 17348ms |  |
| TC-008 | 结果页返回拦截与完成清栈 | P0 | 通过 | 17031ms |  |
| TC-009 | 旧路由往返回归 | P1 | 通过 | 15225ms |  |
| TC-010 | RDB 失败结果页与退出 | P0 | 跳过 | — | unsupported_gap:data_injection（留分母、不算通过） |
| TC-011 | 本地交互响应 300ms | P1 | 跳过 | — | unsupported_gap:perf_sampling（留分母、不算通过） |

> **断言披露**：显式断言 127/127 通过，自然语言预期跳过 9 条。

> **弱化旗标披露**：本轮真机执行命令含 --skip-assert-expected——只跳过上述 9 条自然语言预期（这部分未验证、非验收通过）；显式断言照常执行并按结果计入。

### 稳定性（同执行键跨轮）

| 用例编号 | 同键轮数 | 一致轮数 | 首个分歧 step |
|----------|---------|---------|--------------|
| TC-001 | 1 | 1 | — |
| TC-002 | 1 | 1 | — |
| TC-003 | 1 | 1 | — |
| TC-004 | 1 | 1 | — |
| TC-005 | 1 | 1 | — |
| TC-006 | 1 | 1 | — |
| TC-007 | 1 | 1 | — |
| TC-008 | 1 | 1 | — |
| TC-009 | 1 | 1 | — |

---

## 三、缺陷清单

| 缺陷编号 | 关联用例 | 严重程度 | 描述 | 状态 |
|----------|---------|---------|------|------|
| DEF-V001 | TC-001, TC-004, TC-005, TC-006, TC-007 | MINOR | 视觉 warn：屏 bank_card_selection，defects=5，must_fix=5；The first candidate's bank logo is visibly larger than the reference, approximately 96 versus 70 pixels at comparable image widths; its number text is also larger. This changes row proportions. Two candidates and different mock card numbers are permitted and are not defects. | 待修复 |
| DEF-V002 |  | MINOR | 视觉 warn：屏 card_type_sheet__overlay__card_type_overlay_root，defects=10，must_fix=6；The sheet begins around 45% of screen height versus 39% in the reference. This shifts its header and card list downward and leaves the continue action close to the bottom gesture area. All content is visible here; the screenshot does not establish that the action is unreachable. | 待修复 |
| DEF-V003 |  | MINOR | 视觉 warn：屏 card_type_sheet__overlay__card_type_sheet_panel，defects=10，must_fix=6；The panel starts around 45% of screen height rather than the reference's 39%, shortening the sheet and pushing its contents toward the bottom. Visibility is preserved; unreachable controls cannot be inferred from this image. | 待修复 |
| DEF-V004 |  | MINOR | 视觉 warn：屏 otp_verification_sheet__overlay__otp_overlay_root，defects=4，must_fix=3；The instruction starts at roughly 4% of screen width rather than the reference's 7% and uses smaller text. This changes the content hierarchy and wrapping. The panel's lower absolute position coincides with the absent keyboard; this image alone does not prove faulty keyboard avoidance or focus behavior. | 待修复 |
| DEF-V005 |  | MINOR | 视觉 warn：屏 otp_verification_sheet__overlay__otp_sheet_panel，defects=4，must_fix=3；The instruction has smaller text and approximately half the reference's horizontal inset. It remains readable. The keyboard is absent in this capture, so the panel's absolute vertical displacement is not independently classified as a layout defect. | 待修复 |
| DEF-V006 | TC-001, TC-008, TC-010 | MINOR | 视觉 warn：屏 opening_result_success，defects=5，must_fix=3；The success icon is lower, larger and a more saturated green than the reference: its top is around 19.5% of screen height instead of 14.6%. Success remains immediately understandable. | 待修复 |

### 缺陷统计

| 严重程度 | 数量 | 待修复 | 已修复 | 已关闭 | 延期处理 |
|---------|------|--------|--------|--------|---------|
| BLOCKER | 0 | 0 | 0 | 0 | 0 |
| MAJOR | 0 | 0 | 0 | 0 | 0 |
| MINOR | 6 | 6 | 0 | 0 | 0 |
| **合计** | **6** | **6** | **0** | **0** | **0** |

---

## 四、通过率统计

| 优先级 | 总用例 | 通过 | 失败 | 阻塞 | 跳过 | 通过率 | 达标阈值 | 是否达标 |
|--------|--------|------|------|------|------|--------|---------|---------|
| P0 | 9 | 8 | 0 | 0 | 1（含 gap 1） | 88.9% | 100% | ❌ |
| P1 | 2 | 1 | 0 | 0 | 1（含 gap 1） | 50% | ≥ 95% | ❌ |
| **总计** | **11** | **9** | **0** | **0** | **2（含 gap 2）** | **81.8%** | **≥ 90%** | **❌** |

> 通过率 = 通过 / 总用例；unsupported_gap 留在总用例分母、不计入通过（P0 五数口径见 summary.json p0_coverage_integrity.structured）。

---

## 五、结论

**测试结论**: 有条件达标

**按轴结论**（确定性派生）:
- 功能：PASS（hylyre 9/9 通过，失败 0，阻塞 0，trace.outcome=success；显式断言 127/127 通过，自然语言预期跳过 9 条）
- 交互稳定性：UNKNOWN（9 条用例有同键多轮数据）
- 视觉几何：UNKNOWN（visual-diff.json 6 屏：bank_card_selection=warn、card_type_sheet__overlay__card_type_overlay_root=warn、card_type_sheet__overlay__card_type_sheet_panel=warn、otp_verification_sheet__overlay__otp_overlay_root=warn、otp_verification_sheet__overlay__otp_sheet_panel=warn、opening_result_success=warn）
- 视觉内容：CHECKED
- 视觉样式：CHECKED
- 已知缺口：6 项
  - TC-010[manual:data_injection]
  - TC-011[manual:perf_sampling]
  - 视觉债务 open=6, accepted=0（visual-debt.md）
  - 视觉几何 UNKNOWN
  - 交互稳定性 UNKNOWN（同执行键真实执行不足 2 轮，单轮不构成稳定性证据）
  - 弱化旗标 --skip-assert-expected：自然语言预期跳过 9 条（未验证）；显式断言 127 条通过；结论不以「达标」签发
- 总体：COMPLETE_WITH_GAPS

**判定依据**:
- P0 通过率: 88.9%（阈值 100%）
- P1 通过率: 50%（阈值 ≥ 95%）
- 总体通过率: 81.8%（阈值 ≥ 90%）
- BLOCKER 缺陷: 0 个
- 视觉债务 6 条未清偿（open=6, accepted=0；SSOT=visual-debt.json / summary.quality_axes），功能达标与视觉验真是两根轴

**下一步建议**:
- 功能完成可推进；已知缺口按条目在需求/spec 登记并披露，视觉缺口不阻止功能完成但阻断 release_readiness。
