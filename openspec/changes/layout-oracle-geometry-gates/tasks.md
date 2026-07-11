## 1. 校准与规格（第一刀前置）

- [x] 1.1 t0 离线校准报告 `docs/operations/layout-oracle-calibration.md`（dump 格式/bounds 语义/.id 透传实证/三靶可判性/gate 档位决定表/真机 D1-D6 步骤）
- [x] 1.2 OpenSpec change 本体（proposal + specs/visual-diff + specs/ui-spec + tasks）

## 2. 自报降权与元门禁（t4）

- [x] 2.1 schema 1.1：reported_fidelity_score/reported_geometric_iou（legacy 1.0 映射）、evaluation_invalidated、region_attest[]、layout_dump_status；capture 新写报告标 1.1
- [x] 2.2 lowScorePass/灾难地板退出自报消费（真算不可得 → SKIP+注记）
- [x] 2.3 M1 visual_diff_selfreport_integrity（跨屏常数/抄 floor → ratchet BLOCKER；压线空 defects → WARN；collectSelfreportDegeneracy 纯函数）
- [x] 2.4 evaluation_invalidated：不触发重采、保留 confirmed_by、await_human_confirm 资格排除、未清 → BLOCKER

## 3. spec 几何合同（t6）

- [x] 3.1 STRUCTURE_LINT_FLAT_LIST_MIN 3→2 + 出口文案
- [x] 3.2 overlay P0 屏直系子节点 bbox/layout_group 至少其一 + ≥2 surface 兄弟容器 advisory
- [x] 3.3 overlay 屏参考图独立 OCR 分母比对（root bbox 可框定→ratchet，不可定→advisory；沿用 defer+真人签出口）
- [x] 3.4 ui-spec schema forbidden_overlap/protected_region（JSON schema definitions.screen + 运行时校验器 + TS 类型三落点）
- [x] 3.5 pixel_1to1 + canary tool_read + unverified → BLOCKER（ocr_capable 不算；readCanaryToolReadSignal）
- [x] 3.6 ui-spec.md 同卡分组容器指引（含异型行）

## 4. A 线 oracle（t1/t2/t3）

- [x] 4.1 locator：exact_id > unique_text > structural-lite + 覆盖率门禁（<80% B 类 SKIP）+ coding .id() lint（visual_parity_element_id_lint，观察期 WARN）
- [x] 4.2 capture 每屏 dump layout-<screen_id>.json + layout_dump_status + 跳采屏不重 dump（layoutDumpFn 注入式 + buildHylyreLayoutDumpFn + check-testing 装配）
- [x] 4.3 layout-oracle-check.ts：A-1 显式声明 BLOCKER / A-2 越界 BLOCKER / A-3 close 默认 advisory / A-4 两两扫描 advisory（上限 8）/ B 类 WARN / C 类 advisory；findings 以 check hits 报告（D3——critic 转录 defects/must_fix，harness 不写判定文件）；dump 声称 captured 却缺失/损坏 → 显式 WARN 不静默

## 5. B 线闭环（t5/t7/t9）

- [x] 5.1 region_attest 门禁：非空 + **must_have_elements 逐区域覆盖** + diff_logged 须关联 defect/must_fix
- [x] 5.2 _attest crop 物证（存在性 + 限定 _attest/ 目录 + mtime 不早于被评截图）+ critic-receipt.json 校验（任何 attest 即必需；image_inputs 覆盖 + hash 重算验真 + verified 档逐项 hash 必填）+ input_provenance 两档
- [x] 5.3 SSOT：单轮条款改写（critic 迭代+指纹熔断+candidate-pass 两档+禁提前 T2）+ 成对图 Read 强制；缺陷指纹纯函数（computeDefectFingerprint/collectDefectFingerprints/fingerprintSetsEqual）+ check details [fingerprints] 注记（两轮逐字相同=no-progress 机器可比）
- [ ] 5.4 goal-runner 原生 critic phase 与 verified 档回执（transcript 验读）——**半关（plan f7a3d9c2 / change critic-loop-hardening）**：verified 回执生产侧已关闭（runner attestation：goal-runner 审计 agent-events.jsonl 结构化验读事件后签发，check 重算 hash 验真，手写 verified 降级；无合格 adapter 时如实 unverified——见 docs/operations/adapter-tool-event-provenance.md）；**独立 critic phase（与实现者分离的 fresh context 调度/循环状态机）仍 open，另立项**

## 6. 验证

- [x] 6.1 单测：layout-oracle 纯函数套件（dump 解析/locator/A/B/C/M1 反例靶/schema 映射/attest 校验/await 资格/本地分母）+ checkVisualDiff 端到端 FAIL 用例（M1 命中/attest 无回执/覆盖缺失）+ structure lint 2 行回归
- [x] 6.2 tsc --noEmit + npm run test（unit+fixtures）+ openspec:validate 全绿
- [ ] 6.3 宿主复验（t11，真机 D1-D6 校准 + 三靶分层验收 + critic loop 演示 run 收敛/熔断验证）
