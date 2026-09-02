## 1. 契约先行

- [x] 1.1 本 change 的 proposal/design/spec/tasks 通过 `npm run openspec:validate`（strict + enforcement 路径）并过独立 review；通过前不动生产代码。（2026-09-02 strict 46/46；codex review PASS，P1 成对/唯一负例已补；停点 4 意见 P1 canonical 双口径→本 delta 增 MODIFIED 只改两句、P2 单独 stop_app 措辞对齐，已吸收；六轮 P1 已吸收：report-only 按 channels_resolved 而非 ok 选口径、reset identity 单一来源（安装候选 bundle + 冻结的 hypium_page_name || discoverEntryMainElement，零缓存读写；run 传同一 hypiumPageName）、reset_preamble.example 改为 `;` 分隔对象序列、parsed-zero reuse 日志明示 unknown）

## 2. A：provider 通道 id 计划期查表（plan b3d7e5a1 T2）

- [x] 2.1 `harness/scripts/utils/execution-channel.ts`：`evaluateExecutionChannelDeclaration(planMd, opts?)` 增 `registeredCapabilityIds?: ReadonlySet<string>` 与结果字段 `unknown_provider: Array<{ tc_id; provider_id }>`；provider id 与集合键均经 `normalizeCapabilityKey` 后精确相等才算已登记；未知 id 并入 `ok=false`；detail 话术"该能力不存在（capability registry 未登记），此 TC 不可能通过"+ 已登记键清单（normalize 后、字典序；空清单明示）。`parseExecutionChannel` 与 `PROVIDER_ID_RE` 不改；省略 opts 时输出逐字不变。
- [x] 2.2 `harness/scripts/check-testing.ts` `loadExecutionChannelDeclaration` 唯一注入点传入 `ctx.resolvedProfile.capabilities` 键集，使 `testing_execution_channel` 对未知 id 产出 plan_contract BLOCKER 且 `shouldRunDevicePipeline` 零设备动作；report-only 路径不被截断。
- [x] 2.3 回归：`execution-channel` 单测覆盖 unknown / registered（含 severity=SKIP）/ alias（`prd.visual_handoff`）/ 无 opts 四态 + 分隔符与大小写变体即 unknown + detail 含清单与空清单文案；check-testing 接线一条；report-only 不被截断一条；无 provider TC 计划行为不变。

## 3. D：versionCode=0 归 unknown（plan b3d7e5a1 T3）

- [x] 3.1 `profiles/hmos-app/harness/hdc-runner.ts` `parseInstalledBundleVersionFromDump`：解析到 0 → `versionCode:null` + `versionCodeUnknownReason:'parsed_zero'`，`installed` 仍按原始文本判定。
- [x] 3.2 删除 `profiles/hmos-app/harness/device-install-diag.ts` `detectInstallDowngrade` 的 `> 0` 子句与 `profiles/hmos-app/harness/providers/device-test-install.ts` `versionAllowsReuse` 的 0 特判；diag JSON `deviceVersionCode=null`，details/日志输出 `(未解析：bm dump 报 0，按 unknown)`。
- [x] 3.3 回归：解析器 0→null+reason 且 installed=true；diag kind=clear、deviceVersionCode=null、downgradeDetected=false；正整数与未安装路径行为不变。

## 4. C：受限 case 首部复位（plan b3d7e5a1 T4）

- [x] 4.1 `harness/scripts/utils/derived-hylyre-plan.ts`：`LintHylyrePlanOptions` 增 `resetIdentity?: { bundle; page_name }`；STEP-003 改为只接受 case 首部连续的 `stop_app(bundle) → start_app(bundle, page_name)`，判据只有一条：index 0 才可为 `stop_app`、index 1 才可为 `start_app`，其它任意位置出现 `start_app`/`stop_app` 根键即 STEP-003 BLOCKER（由此保证前奏成对且至多一组）；无 stop 直接 start、stop_app 后未紧跟 start_app（单独 stop）、第二组 lifecycle、中段出现、身份缺失/不一致、`resetIdentity` 不可解析均 BLOCKER；STEP-004 维持；`forbidStartApp:true` 保留为即席全禁语义。
- [x] 4.2 `harness/scripts/check-testing.ts` `collectDeviceTestStaticPlanGates`：从 `loadAppInstallCandidateMeta().bundleName` 与 `resolveHylyreToolConfig().hypium_page_name || discoverEntryMainElement()` 解析 `resetIdentity` 注入 lint；`harness/scripts/utils/hylyre-standard-derive-knowledge.ts` `buildStandardHylyreDeriveKnowledge(reset?)` 新增 `reset_preamble` 块，`allowed_step_roots` 含 `stop_app`/`start_app`，`forbidden_in_steps` 只剩 CLI 名；`derive-hylyre-plan-hint.ts` 与 check-testing 自动 hint 两入口同源注入。`clear_app` 不放行。
- [x] 4.3 文档同步：`skills/feature/device-testing/SKILL.md` Step 4.5、`skills/reference/device-testing-workflow-detail.md` 4.5.3 与失败表、`profiles/hmos-app/skills/device-testing/reference/hylyre-planned-step-fields.md` 根键说明、`profiles/hmos-app/skills/device-testing/profile-addendum.md` 执行模型。
- [x] 4.4 回归：`derived-hylyre-plan` 单测——首部合法前奏 0 违规、无 stop 直接 start BLOCKER、单独 `stop_app`（随后直接业务步骤或 case 结束）BLOCKER、首部 `stop→start→stop→start` 两组 BLOCKER、中段 BLOCKER、bundle/page_name 不一致 BLOCKER、resetIdentity 缺失 BLOCKER、即席全禁、不含 reset 的计划行为不变、NAV-002/003 与 STEP-SETUP 对前奏语义不变；`hylyre-keyset-consistency` 知识块断言更新（allowed 含二者、forbidden 只剩 CLI 名、含 `reset_preamble`）。

## 5. 回归与收口

- [x] 5.1 定向：`execution-channel`、`derived-hylyre-plan`、`hylyre-keyset-consistency`、`hylyre-planned-step-lint`、`hdc-runner`/install diag suites；typecheck。
- [x] 5.2 一次最终 `npm --prefix harness test`（typecheck + unit + fixtures）、`npm run openspec:validate`、`npm run release:verify`、`node scripts/check-plan-version.mjs`、`git diff --check` 与改动文件 LF 扫描；`MIGRATION.md` 无需变更（非 BREAKING），若实施中发现需要则补一行。（2026-09-02 留证：typecheck PASS；`npm --prefix harness test` unit 3784/3784 + fixtures 46/46；`openspec:validate` strict 46/46 + enforcement PASS；`check-plan-version` PASS；`git diff --check` 干净；改动文件 LF/无 BOM；`release:verify` 规则单测/陈旧扫描 PASS，其发布模式 plan-version 门因 3.0.0 窗口内 7 份在研 plan（6 份与本 change 无关 + b3d7e5a1 自身 T7 待收口）未完成而 FAIL——发布时收口，非本 change 缺陷；MIGRATION.md 无需变更）
- [x] 5.3 宿主条件验证（用户触发，不由实施代理发起）：重新派生的计划以 `stop_app→start_app` 开头的 case 在真机冷启后前置成立；宿主自拟 provider id 在计划期被拦并给出键清单。没有环境时如实记录"条件未验"，不阻塞 Maison 本地验收。（2026-09-02 如实记录：条件未验——宿主回灌由用户触发且与 Maison 本地收口无关，本轮未提供宿主环境；不阻塞 Maison 收口，待宿主跑时按本条核对）
- [x] 5.4 更新 plan b3d7e5a1 T2/T3/T4 状态，独立 review 收口。（2026-09-02 codex 七轮 review 收口：无 P0/P1 残留；plan 状态已更新）
