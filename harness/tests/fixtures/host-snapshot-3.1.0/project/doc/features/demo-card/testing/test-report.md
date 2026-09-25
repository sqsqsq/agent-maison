<!-- maison:generated:test-report v1 -->
# 测试报告 — demo-card

> **模块标识**: `demo-card`
> **版本**: harness-generated 2026-09-25T04:33:18.969Z
> **日期**: 2026-09-25T04:33:18.969Z
> **测试执行人**: harness（机器生成；agent 观察见 testing/notes.md）
> **对应测试计划**: `doc/features/demo-card/testing/test-plan.md`
> **权威 run**: `doc/features/demo-card/testing/reports/20260925T043319Z-962/hylyre/trace.json`（trace sha256 ef1149813a0fb8ca）

> 本文件由 harness 从 trace / timing / meta / gaps / visual-diff / visual-debt / measure / stability 整份生成，重跑 harness 或 `--report-reconcile-only` 会重写；请勿手改，观察与决策写 `testing/notes.md`。

---

## 一、测试概览

| 项目 | 内容 |
|------|------|
| 测试模块 | demo-card |
| 测试日期 | 2026-09-25T04:33:18.969Z |
| 测试环境 | hylyre 0.5.1, hypium 5.0.7.200 |
| 执行人 | harness（机器生成） |
| 用例总数 | 2 |
| 执行用例数 | 2 |
| 跳过用例数 | 0 |

### 真机流水线耗时

> 数据来源：device-test-timing.json（harness 在 device_test.run 成功后写入）；耗时为精确整数毫秒，`—` 表示无数据。

| 阶段 | 耗时 | 说明 |
|------|------|------|
| 打包 (hvigor) | — | 本轮构建; `reused=false` |
| 装机 (hdc) | — | 本轮安装; `reused=false` |
| Hylyre 自动化 | 1000ms | 含设备预启动 |
| 快照写入 (page save) | — | 非致命 |
| **合计（脚本统计）** | **—** | harness 各阶段之和（writer 为 null 时为 —） |

| 元数据 | 值 |
|--------|-----|
| HAP 落盘时间 (hapBuiltAt) | — |
| 本次 harness 跑 build 门禁时刻 | — |

---

## 二、测试执行结果

| 用例编号 | 用例名称 | 优先级 | 执行状态 | 耗时 | 备注 |
|----------|---------|--------|---------|------|------|
| TC-001 | 开卡入口 | P0 | 通过 | 20ms |  |
| TC-002 | 银行列表展示 | P1 | 通过 | 20ms |  |

### 稳定性（同执行键跨轮）

| 用例编号 | 同键轮数 | 一致轮数 | 首个分歧 step |
|----------|---------|---------|--------------|
| TC-001 | 1 | 1 | — |
| TC-002 | 1 | 1 | — |

---

## 三、缺陷清单

无缺陷：所有已执行用例全部通过，视觉屏无 fail/warn。

### 缺陷统计

| 严重程度 | 数量 | 待修复 | 已修复 | 已关闭 | 延期处理 |
|---------|------|--------|--------|--------|---------|
| BLOCKER | 0 | 0 | 0 | 0 | 0 |
| MAJOR | 0 | 0 | 0 | 0 | 0 |
| MINOR | 0 | 0 | 0 | 0 | 0 |
| **合计** | **0** | **0** | **0** | **0** | **0** |

---

## 四、通过率统计

| 优先级 | 总用例 | 通过 | 失败 | 阻塞 | 跳过 | 通过率 | 达标阈值 | 是否达标 |
|--------|--------|------|------|------|------|--------|---------|---------|
| P0 | 1 | 1 | 0 | 0 | 0 | 100% | 100% | ✅ |
| P1 | 1 | 1 | 0 | 0 | 0 | 100% | ≥ 95% | ✅ |
| **总计** | **2** | **2** | **0** | **0** | **0** | **100%** | **≥ 90%** | **✅** |

> 通过率 = 通过 / 总用例；unsupported_gap 留在总用例分母、不计入通过（P0 五数口径见 summary.json p0_coverage_integrity.structured）。

---

## 五、结论

**测试结论**: 有条件达标

**按轴结论**（确定性派生）:
- 功能：PASS（hylyre 2/2 通过，失败 0，阻塞 0，trace.outcome=success）
- 交互稳定性：UNKNOWN（2 条用例有同键多轮数据）
- 视觉几何：UNKNOWN（无 visual-diff.json）
- 视觉内容：UNKNOWN
- 视觉样式：UNKNOWN
- 已知缺口：3 项
  - 视觉几何 UNKNOWN
  - 视觉内容/样式 UNKNOWN（无 provider 复核）
  - 交互稳定性 UNKNOWN（同执行键真实执行不足 2 轮，单轮不构成稳定性证据）
- 总体：COMPLETE_WITH_GAPS

**判定依据**:
- P0 通过率: 100%（阈值 100%）
- P1 通过率: 100%（阈值 ≥ 95%）
- 总体通过率: 100%（阈值 ≥ 90%）
- BLOCKER 缺陷: 0 个
- 视觉债务 0 条

**下一步建议**:
- 功能完成可推进；已知缺口按条目在需求/spec 登记并披露，视觉缺口不阻止功能完成但阻断 release_readiness。
