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
| M1 | spec 期 `fidelity_capability_pregate` 触发（强意图且能力缺失→`DEFERRED_CAPABILITY_MISSING`；能力具备但证据无效→FAIL/回修） | spec/reports/fidelity-intent.json + summary |
| M2 | 0 项 `acquisition: crop` 盲档违例（`blind_crop_prohibition` PASS 或素材走 asset-request） | spec summary + spec/asset-request.md |
| M3 | 0 空白/未披露关键素材（`asset_materialization_sanity` 无 brand-critical FAIL；占位均为可见语义占位） | coding summary |
| M4 | 产品组件所有权链齐全：8 屏的 P0 节点全部映射到宿主自己的产品组件（ui-spec P0 节点 → visual-parity `contract_component` → contracts.components → contracts.files），且**档位无关**（plan e6b3f8d2 t3 撤销强制 UI kit 后由本链承接盲档结构地板；运行时结构证据另由 `runtime_mount_conformance` 观察） | `visual_parity_coverage`（plan）+ `runtime_mount_conformance`（testing） |
| M5 | `render_visibility_calibrate` 零"节点在、像素不可见"命中（或命中项全部对应真实缺陷并被修复） | testing summary structured findings |
| M6 | visual-feedback.json 产出且收敛（converged/converging；stalled/regressing 须有处置记录） | device-testing/visual-feedback.json |
| M7 | summary 1.1：`quality_axes` 四轴如实（存在占位素材时 visual=UNVERIFIED、`completion_status=FUNCTIONALLY_COMPLETE_VISUAL_PENDING`、`release_readiness=BLOCKED`——**如实=通过**，谎报 COMPLETE=失败） | 各 phase summary.json |
| M8 | test-report 结论披露视觉债务（`visual_debt_disclosure` PASS）；无「达标可发布」裸奔 | test-report.md + visual-debt.md |
| M9 | 负面裁决传播：过程中任何 review「不通过」/testing「不达标」都阻断了推进（summary FAIL + 下游 upstream_verdict_gate） | 各 phase summary 时序 |
| M10 | 产物 hash/gate_fingerprint 新鲜（无 stale 豁免）；render-visibility 观察项误报记录（用于阈值/夹具校准，不触发自动升级） | receipts + visual-feedback.identity |

## 3. UX 复验与回灌

用户可对照 `D:\1.code\对比结果\1-bc-opencard` 逐屏检查 UX；发现偏差时提交 correction/successor
run，由责任阶段修复并重新生成 hash-bound 机器证据。人工观察是新一轮需求输入，不再签发
`human_visual_acceptance`，也不能把上一轮的 FAIL/UNVERIFIED 改写为 PASS。provider 缺少可靠视觉能力时
保持 capability-missing/deferred；provider 已声明支持但证据缺失、伪造、stale 或无效时必须 FAIL/重试。

## 4. 结果回灌（做完必填）

- 渲染可见性误报观察：`render_visibility_calibrate` 本轮误报数=___（回灌阈值/夹具；findings 仍经 visual-debt 阻断 release，不设自动 enforce）
- gallery 实机段：blocks 编译通过=___；维护者基线截图采集=___（P0-C 5.6 诚实边界收口）
- visual_feedback hard 信号准确率观察 → 校准信号/夹具；硬事实继续由既有 OCR 门禁承载（不升独立 BLOCKER）
- 四组对比截图归档至 `D:\1.code\对比结果\1-bc-opencard\4-盲档根治后/`（命名沿 1-8 屏矩阵）
