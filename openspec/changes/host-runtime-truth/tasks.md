# Tasks — host-runtime-truth（plan c4e8a1f7）

- [x] **T1a**：`headless-binary-resolve.ts` 重写（顺序取首个可 spawn 形态、MZ/PE 探测、
  shadowed 诊断）；`agent-invoke.ts` 注入 pre-resolved binary + cross-spawn 版探测 +
  guardian 失败投影；`vision-canary.ts` 抽共享硬失败分类 + Codex 400 签名；
  `goal-preflight.ts` 返回 session binary；`goal-runner.ts` 三处复用 + 正式 invoke
  硬失败早停（`adapter_cli_hard_failure`，external）+ `adapter_probe` 增补字段；
  `adjudication.ts` 注册 incident。
- [x] **T1b**：删除 `assertAdapterHeadlessFullPermission` 的 codeagent 拒绝分支；
  `agents/codeagent/adapter.yaml` 注释同步；`headless-full-permission` 测试更新；
  确认 codeagent/chrys-opencode adapter 测试无残留拒绝断言。
- [x] **T2**：`goal-manifest.ts` `resolveRequirementInput` 返回 text+sources、manifest 字段、
  身份哈希条件包含、successor 去重追加；goal-mode-entry/fidelity-intent-init 透传；
  `fidelity-shared.ts` 共享发现集合 + SSOT 可选字段；capability-resolution 依赖；
  goal-runner OCR 预扫/prompt authoritative paths/refs receipt 生产改共享集合；
  `critic-receipt-producer.ts` 验证分母改共享集合；spec-visual-handoff-check 分母复核。
- [x] **T3**：goal-runner inline canary 签发点统一 `resolveCanaryCacheDecision`（structured
  读 events、非结构化读 `invoke.stdout`）；buildCapabilityBlock/closure 块按 provenance
  分轴；`skills/feature/spec/SKILL.md` 自检口径同步；retry guidance 文案核对。
- [x] **T4**：新增 `host-runtime-truth.unit.test.ts`（解析/投影/400/判卷/集合矩阵）；
  更新 `headless-full-permission`、`goal-canary-hard-cli-d7f3a9c4`、`headless-binary-resolve`、
  `capability-degradation` 等既有套；entry-input/SSOT shape 回归；runner 集成回归
  （0.138 400 冻结与 guardian error 5 冻结：`formal_invoke_attempts=1`、`harness=0`、
  `content_retry=0`；`guardian_attempts=1`、`agent_process_started=0`）。
- [x] **返修轮（评审 P0/P1/P2，两轮）**：P0 `--requirement-file` fresh/supersede 来源落盘断桥
  （goal-runner 构造字面量 + applyManifestCliOverrides + schema.yaml + H2/H3 集成回归）；
  P1 phase-driven SSOT 来源读取与当前 requirement 优先；P1 分母检查收进既有 Visual
  Handoff 门禁（featureDir/fail-closed/去 bmp）；P1 `hasVision ∧ structured_events`
  分轴（resolveClosureReadRequirement 纯函数 + D2 四象限回归 + spec-ui-spec-check
  可达处置）；P1 formalInvoke banner 不压签名；P1 manifest override 来源随 requirement
  替换（H4 集成回归）；P2 非 Windows PATH walk 语义、shadowed 聚合与同目录 PATHEXT
  诊断、inaccessible bare 不可 spawn。
- [x] **宿主回灌与收口**：`cd harness && npm test`、`npm run openspec:validate`、
  `node scripts/check-plan-version.mjs`、`git diff --check`（整批收口只跑一次）；
  打包后 bounded 宿主验证（Codex 复放第三次事故路径；CodeAgent `--help`/version +
  最短 Goal-mode smoke）；本 change 不打包、不发布（release 门禁留发布阶段）。
  - 2026-09-03 收口：仓内部分（npm test / openspec:validate / check-plan-version / git diff --check）随 3.0.0 收口批统跑；打包后宿主验证 —— 用户 2026-09-03 裁决：3.0.0 窗口不再执行宿主回归，按完成登记。