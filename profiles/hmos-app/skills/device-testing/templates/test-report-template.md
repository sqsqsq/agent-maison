# 测试报告 — {module-name}

> **模块标识**: `{module-name}`
> **版本**: v1.0
> **日期**: {date}
> **测试执行人**: {tester}
> **对应测试计划**: `<features_dir>/{module-name}/testing/test-plan.md`

---

## 一、测试概览

| 项目 | 内容 |
|------|------|
| 测试模块 | {module-name} |
| 测试日期 | {date} |
| 测试环境 | {设备型号}, HarmonyOS {版本}, API {版本号} |
| 执行人 | {tester} |
| 用例总数 | {N} |
| 执行用例数 | {N} |
| 跳过用例数 | {N} |

### 真机流水线耗时

> 数据来源：`<features_dir>/{module-name}/testing/reports/device-test-timing.json`（harness 在 `device_test.run` 成功后写入）。
> 耗时统一填写精确整数毫秒 `Nms`（如 `1234ms`）；已进入 trace/timing 的跳过或阻塞 case 填 `0ms`，`—` 用于未进入 trace/timing 的非 Hylyre 通道用例或历史 legacy explicit skip（合计行占位见下一条）。
> 「合计（脚本统计）」行按 `pipeline.total_harness_ms` 填写；该值为 `null`（当前 writer 恒为 null）时填 `—`，不得自行把各阶段相加——对账把加总值判为「应为无数据占位」。

| 阶段 | 耗时 | 说明 |
|------|------|------|
| 打包 (hvigor) | {build_duration_ms} | {build_reused_note}; `reused={build_reused}` |
| 装机 (hdc) | {install_duration_ms} | {install_reused_note}; `reused={install_reused}` |
| Hylyre 自动化 | {hylyre_run_duration_ms} | 含设备预启动 |
| 快照写入 (page save) | {page_save_duration_ms} | 非致命 |
| **合计（脚本统计）** | **{pipeline_total_ms}** | harness 各阶段之和 |

| 元数据 | 值 |
|--------|-----|
| HAP 落盘时间 (hapBuiltAt) | {hap_built_at} |
| 本次 harness 跑 build 门禁时刻 | {harness_build_ran_at} |

---

## 二、测试执行结果

| 用例编号 | 用例名称 | 优先级 | 执行状态 | 耗时 | 备注 |
|----------|---------|--------|---------|------|------|
| TC-001 | {用例名称} | P0 | 通过 | {duration_ms} | |
| TC-002 | {用例名称} | P0 | 失败 | {duration_ms} | 关联 DEF-001 |
| TC-003 | {用例名称} | P1 | 通过 | {duration_ms} | |
| TC-004 | {用例名称} | P1 | 阻塞 | {duration_ms} | 依赖 TC-002 修复 |
| ... | ... | ... | ... | ... | ... |

> **备注列填写规则**（真机自动化集成）：「失败」填关联缺陷编号（如 `DEF-001`）；「阻塞」填阻塞原因（如真机断连、依赖未修复）；「跳过」填跳过原因（工具链自报，或 agent 标注「缺少稳定 selector，需补 plan.md / contracts.yaml」）。
> 执行结果表的耗时列填写最终 run 的精确整数毫秒 `Nms`；不要用四舍五入的秒数替代。

---

## 三、缺陷清单

> 若所有用例全部通过，本章节可注明"无缺陷"。

| 缺陷编号 | 关联用例 | 严重程度 | 描述 | 状态 |
|----------|---------|---------|------|------|
| DEF-001 | TC-002 | MAJOR | {缺陷的具体描述：操作步骤 + 实际结果 + 期望结果} | 待修复 |
| ... | ... | ... | ... | ... |

### 缺陷统计

| 严重程度 | 数量 | 待修复 | 已修复 | 已关闭 | 延期处理 |
|---------|------|--------|--------|--------|---------|
| BLOCKER | N | N | N | N | N |
| MAJOR | N | N | N | N | N |
| MINOR | N | N | N | N | N |
| **合计** | **N** | **N** | **N** | **N** | **N** |

### 逐信号复核（defect-review，**存在 actionable 视觉信号时必填**）

> 本块只提供 agent 诊断说明，不具备否决机器证据的权力。producer 判定为 actionable 且证据合同
> 有效的结构化视觉信号会直接物化 repair candidate；合法 provider defect 同样直接回修。
> producer uncertain/provider invalid 表示证据不足，由 required/optional 质量轴投影 FAIL、defer 或 advisory。
> **signal 必须精确填该 defect 的稳定指纹**（`screen|class|element|bbox_bucket[|producer#finding_id]`，
> 可从 visual-diff.json 的 defects 条目复制的结构键），不填屏名/指令文本（防同屏多缺陷歧义）。
> 用户交付后的 UX 反馈应作为 correction/successor run 输入，不回写当前 run 的 verdict。
> 格式（fenced 块，**逐信号一条**，禁止 inline 注释）：

```defect-review
- signal: add_card_home_collapsed|shape_mismatch|hc_page_title|0.1,0.2,0.3,0.4
  verdict: confirmed
  rationale: 截图/证据核对后确认为真缺陷
- signal: add_card_home_collapsed|overlap|hc_bank_row|0.5,0.6,0.7,0.8
  verdict: disputed
  rationale: OCR 混淆/口径错配，非真缺陷
```

---

## 四、通过率统计

| 优先级 | 总用例 | 通过 | 失败 | 阻塞 | 跳过 | 通过率 | 达标阈值 | 是否达标 |
|--------|--------|------|------|------|------|--------|---------|---------|
| P0 | N | N | N | N | N | XX% | 100% | ✅/❌ |
| P1 | N | N | N | N | N | XX% | ≥ 95% | ✅/❌ |
| P2 | N | N | N | N | N | XX% | — | — |
| **总计** | **N** | **N** | **N** | **N** | **N** | **XX%** | **≥ 90%** | **✅/❌** |

---

## 五、结论

> harness 只解析下方"测试结论"声明行，且须**恰好填一个**裁决词。可选值（三选一）：达标、有条件达标、不达标。声明行留多个或不填 = 歧义/缺失 → harness 判 FAIL。

**测试结论**: <填写单一裁决，删除本占位>

<结论说明>

**判定依据**:
- P0 通过率: XX%（阈值 100%）
- P1 通过率: XX%（阈值 ≥ 95%）
- 总体通过率: XX%（阈值 ≥ 90%）
- BLOCKER 缺陷: N 个

**下一步建议**（按上方测试结论执行）:
- 若结论为"不达标"：修复所有 BLOCKER 和 P0 失败用例后重新测试
- 若结论为"有条件达标"：修复 MAJOR 缺陷后建议回归测试，或经团队评审后可发布
- 若结论为"达标"：功能模块验收完成，可发布
