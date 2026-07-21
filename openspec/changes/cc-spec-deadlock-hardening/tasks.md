# Tasks: cc-spec Deadlock Hardening（plan 7c4f2e9b）

## 0. P0-0 OpenSpec 与 fixture

- [x] 0.1 本 change proposal/specs/tasks + visual-capability-truth delta（任务 3.10 + normalization 条目）
- [x] 0.2 脱敏事故 fixture 入仓 `harness/tests/fixtures/cc-spec-deadlock/`（五轮精简 events / i2-PASS 产物 / i3 错键 ui-spec / stream-json canary 样卷 / MiniMax init 行 / 账本 deferred 行 / foreign-file 清单差异）
- [x] 0.3 openspec validate --all --strict 绿

## 1. P0-1 claude envelope 归一

- [x] 1.1 共享模块 `utils/claude-envelope.ts`：终态 result 白名单文本投影 / init model / image Read 事件 / API error 信封四消费收敛
- [x] 1.2 preflight canary 判卷改 stdout 归一投影；inline canary 判卷改读 agent-events.jsonl + 归一投影；归一失败维持 fail-closed
- [x] 1.3 unit：valid 答卷 / CANNOT_SEE_IMAGE / 残卷 / 多 result / 错误 result 含答题键 / stderr 插行 / 纯文本回归 / image-read 与 api-error 消费者零变化

## 2. P0-2 ui-spec schema 严格化

- [x] 2.1 存量合法键盘点 + screen/componentNode additionalProperties:false + validator allowed-keys 从 schema 派生
- [x] 2.2 未知键 did-you-mean（编辑距离≤3 / 去前缀）
- [x] 2.3 capture-completeness 文案正名 must_have_elements + affected_files 改 spec/ 实读路径（含 PHASE_SCOPED_ARTIFACTS 排查）
- [x] 2.4 三方漂移 unit（schema↔validator↔TS 类型）+ 事故错键 fixture 回归

## 3. P0-3 PASS 态冻结

- [x] 3.1 artifact-class resolver 四类（三表全消费 + asset-manifest 补齐 + 控制面逐一登记 + watched roots 导出）
- [x] 3.2 pass-snapshot 存储：manifest/head 双协议域 HMAC + 独立命名空间 + 原子写 + 内存 digest
- [x] 3.3 run 级 invalidation journal（固定路径 / tx_id / pending→heads→events→commit / resume 先恢复 / fail-closed 限 resume 路径）
- [x] 3.4 closure-only attempt 流程：prompt 注入 / 四类差异判定 / 两层信任恢复 / 违规计数 / 路径与 TOCTOU 安全
- [x] 3.5 unit 全套（信任分层 / 崩溃窗 / 多 phase 失效 / 重放拒绝 / 跨协议替换 / junction / 控制面豁免）+ e2e 回放 A

## 4. P0-4 actionability

- [x] 4.1 registry 纯函数 + CheckResult/SummaryBlockerEntry/summary.schema actionability + operator_note 字段
- [x] 4.2 迁移表（external/human-sign 族/toolchain 族/视觉二期人类门禁族）+ 外围状态机排除项
- [x] 4.3 决策梯③层插入 + timeout 四步分流 + await_human_gate_deferral / await_operator_toolchain + human_only 不入签名 + 回喂过滤
- [x] 4.4 spec_capture_gap 分类更名；组合测试（八组）+ e2e 回放 B（合成夹具）

## 5. P0-5 超时与 closure 分类

- [x] 5.1 goal-timeout 纯函数：granted_highwater + observed ratchet + completed SSOT + events 重建
- [x] 5.2 closure_kind 探针分类 total function（五态矩阵 + fresh 复用/resume 重探 + 预算二档 + closure_timeout 不回内容重试）
- [x] 5.3 显式配置 hard cap + 预算过小提示 + timeout_escalated source 字段
- [x] 5.4 unit（事故序列 67.5min 不回落 / 五态矩阵 / 边界 16-20min / wall-clock 钳制）

## 6. P1 五项

- [x] 6.1 attempt 四轴时间线报告（替换 no_progress 死模板）
- [x] 6.2 指引分级：通用指引删源码检索句 / operator_note 迁移 / 红线句 / 未知键失败附合法键清单
- [x] 6.3 goal-mode SKILL monitor 熔断话术
- [x] 6.4 adapter_model_observed 事件（共享 parser 读 events 文件；不写 manifest；receipt 顺带填 model）
- [x] 6.5 foreign-file 未触发调查 + 最小修复 + 复现 unit（若确认 invoke 后不复扫 → 升 P0 + consumer-layout E2E）

## 7. 收尾

- [x] 7.1 全量验收：typecheck 0 · unit 全绿 · fixtures 全绿 · openspec validate 全绿 · plan version check
- [ ] 7.2 宿主实测回灌（bc-openCard 重跑观测，需用户宿主环境）
