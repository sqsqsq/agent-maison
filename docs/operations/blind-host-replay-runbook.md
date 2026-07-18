# 盲宿主受控重放 Runbook — bc-openCard（blind-visual-hardening P1-G）

> 目的：在 **minimax 2.7 / claudecodeli** 盲宿主上重放 bc-openCard，验收 blind-visual-hardening
> 全链效果。执行人=用户（实机+宿主环境）；本 runbook 由 framework 侧备齐全部物料与判据。
> 对比基线：`D:\1.code\对比结果\1-bc-opencard`（0-原始需求 8 屏 / 1-优化前 VL / 2-优化后 VL / 3-盲宿主一轮成品）。

## 0. 前置硬条件（cursor 三轮，缺一不可归因）

| # | 条件 | 判据 |
|---|------|------|
| 1 | **新 framework 发布包**（含 blind-visual-hardening 全部改动） | 记录 `framework/RELEASE-MANIFEST.sha256` 的 sha256 → 填入下表"包 digest"；与源仓本 change 合入后构建的发布件一致 |
| 2 | 宿主 adapter 视觉判定 | `framework.local.json` vision 判定=none（或金丝雀实测 none）；不设 image_input_override |
| 3 | 需求物料 | 原始需求文本 + 8 张设计截图放 `doc/features/原始需求/1-银行卡/`（同一轮事故物料，不改写） |
| 4 | 设备固定 | HUAWEI EMA-AL00（或同型），分辨率/字体缩放/深浅色/状态栏状态记录在案；验证码/银行/卡片 mock 数据与首轮一致 |

复验记录头（执行时填写）：

```yaml
replay_run:
  date: 
  framework_package_digest: 
  host_model: minimax-2.7 (via claudecodeli)   # 以工具链记录为准，不信 agent 自报
  device: 
  resolution: 
  font_scale: 
```

## 1. 8 屏固定矩阵（screen_id + variant；facts.md「7 张」系记录错误，以 8 屏为准）

| # | screen_id | variant | 参考图 |
|---|-----------|---------|--------|
| 1 | add_card_home_collapsed | default | 1-银行卡添卡首页.jpg |
| 2 | add_card_home_expanded | default | 1-2-银行卡添卡首页点击更多.jpg |
| 3 | all_banks | default | 2-银行卡添卡全部银行页.jpg |
| 4 | card_type_modal | debit_selected | 3-点击任意银行拉起添卡选卡半模态.jpg |
| 5 | card_selection | first_selected | 4-点击信用卡或储蓄卡后拉起选卡页面.jpg |
| 6 | sms_verification | countdown_active | 5-选中某张卡片后拉起短信验证.jpg |
| 7 | add_card_result | success | 6-短信验证完成后结果页.jpg |
| 8 | card_detail | default | 7.卡详情页面.jpg |

同状态同数据同区域前后比较；任何屏缺采按 nav 完备性 BLOCKER 处理（不许静默缩分母）。

## 2. 机器验收清单（全部由 harness 产物判定，不信自报）

| # | 判据 | 证据源 |
|---|------|--------|
| M1 | spec 期 `fidelity_capability_pregate` 触发（强意图→DEFERRED 或人工定档 receipt 留痕） | spec/reports/fidelity-intent.json + summary |
| M2 | 0 项 `acquisition: crop` 盲档违例（`blind_crop_prohibition` PASS 或素材走 asset-request） | spec summary + spec/asset-request.md |
| M3 | 0 空白/未披露关键素材（`asset_materialization_sanity` 无 brand-critical FAIL；占位均为可见语义占位） | coding summary |
| M4 | 基准结构齐全：8 屏声明的 nav_bar/list_card_container/sheet_scaffold/primary_button 等语义容器三段闭环全绿（声明→源码锚点→uitree） | `ui_kit_source_conformance` + `ui_kit_runtime_conformance` |
| M5 | `render_visibility_calibrate` 零"节点在、像素不可见"命中（或命中项全部对应真实缺陷并被修复） | testing summary structured findings |
| M6 | visual-feedback.json 产出且收敛（converged/converging；stalled/regressing 须有处置记录） | device-testing/visual-feedback.json |
| M7 | summary 1.1：`quality_axes` 四轴如实（存在占位素材时 visual=UNVERIFIED、`completion_status=FUNCTIONALLY_COMPLETE_VISUAL_PENDING`、`release_readiness=BLOCKED`——**如实=通过**，谎报 COMPLETE=失败） | 各 phase summary.json |
| M8 | test-report 结论披露视觉债务（`visual_debt_disclosure` PASS）；无「达标可发布」裸奔 | test-report.md + visual-debt.md |
| M9 | 负面裁决传播：过程中任何 review「不通过」/testing「不达标」都阻断了推进（summary FAIL + 下游 upstream_verdict_gate） | 各 phase summary 时序 |
| M10 | 产物 hash/gate_fingerprint 新鲜（无 stale 豁免）；calibrate 观察项零误报记录（P0-B enforce 升级判据之一） | receipts + visual-feedback.identity |

## 3. 人工验收（rubric receipt，阈值冻结不许事后调）

1. 对照 `D:\1.code\对比结果\1-bc-opencard` 逐屏打分四维（container/hierarchy/density/state_color，1-5）。
2. 写 `doc/features/bc-openCard/device-testing/visual-acceptance.json`：

```json
{
  "rubric_version": "r1-frozen",
  "rubric": { "container": 0, "hierarchy": 0, "density": 0, "state_color": 0 },
  "screens": [
    { "screen_id": "add_card_home_collapsed", "variant": "default", "reference_sha256": "<ref>", "actual_sha256": "<shot>" }
  ],
  "accepted_debt_ids": [],
  "signed_by": "<真名>"
}
```

3. 经带外体系签发 `human_visual_acceptance` receipt（object_hash=该 json 文件字节 sha256）落
   `visual-acceptance.receipt.json`，重跑 testing harness 消费。
4. 冻结规则（r1-frozen）：每维 ≥4 通过；任一维=3 必须在 accepted_debt_ids 显式接受对应债务；
   出现 1-2 分不得通过（修复重评）。**首轮预期**：盲宿主大概率走"显式接受残余债务"（brand
   素材占位等），这是诚实交付；receipt 只能清主观项——空白素材/证据缺失类确定性 FAIL 会被拒清。

## 4. 结果回灌（做完必填）

- calibrate 误报观察：`render_visibility_calibrate` 本轮误报数=___（连续两轮 0 → 触发 P0-B enforce 升 BLOCKER 落地）
- gallery 实机段：blocks 编译通过=___；维护者基线截图采集=___（P0-C 5.6 诚实边界收口）
- visual_feedback hard 信号准确率观察 → 决定是否升独立 BLOCKER（P1-E 7.2 阻断承载再评估）
- 四组对比截图归档至 `D:\1.code\对比结果\1-bc-opencard\4-盲档根治后/`（命名沿 1-8 屏矩阵）
