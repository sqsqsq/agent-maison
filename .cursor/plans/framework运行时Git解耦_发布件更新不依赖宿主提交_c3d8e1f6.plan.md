---
name: framework 运行时 Git 解耦 — 发布件更新不依赖宿主提交
version: 3.0.0
# 独立纠偏 plan。根因来自 2026-09-01 SimulatedWalletForHmos 的真实发布件升级：
# 新发布件本身完整有效，但宿主 HEAD 仍是旧发布件，覆盖后正常出现 M/D/??；
# harness-runner 无条件执行的 scoped Git dirty preflight 把合法升级误判为控制面污染。
#
# 本 plan 只负责 AgentMaison 源仓内的契约、实现、文档与自动化回归；不操作宿主、
# 不执行 a6c4e9f2 T8、不处理 provider per-TC/Hylyre/source，不打包、不提交、不推送。
todos:
  - id: t1-openspec-fact-correction-and-reopen
    content: T1 契约先行并纠正假完成：只修订现有 active change `openspec/changes/framework-identity-boundary`，在 proposal/design/specs/tasks 中删除 scoped Git dirty、tracked/untracked、宿主提交选择与 `framework_control_plane_dirty` 新生产语义；冻结普通 init/phase 与宿主 Git 完全解耦、强隔离与同 Windows 用户 Write/Edit 守卫两档、历史报告只读兼容、发布/明确集成边界才验包。将建立在错误 dirty 设计上的已完成 task 重新打开或改写，明确重开 2.3 并把迁移提示移到 schema/template/MIGRATION、禁止运行时 advisory；strict validate 后才改生产代码，不得另建平行 OpenSpec change。
    status: completed
  - id: t2-original-plan-d5-t6-correction
    content: T2 同步纠正原 plan `a6c4e9f2`：按用户授权修订 D5、T6、对应验收/边界/交付顺序中“降级 Git dirty 聚合、提交后过门、Git 基线变量”等错误正文；先把 frontmatter T6 从 completed 重新打开，保留 testing/Hylyre 其它已完成事实不动；本 plan 全部适用验收通过后才重新完成 T6，T8 继续 pending 且本 plan 不执行宿主回灌。
    status: completed
  - id: t3-runtime-git-verdict-removal
    content: T3 删除全部生产期 Framework Git 身份/裁决读取：`harness-runner.ts` 不再导入/调用 `runFrameworkIntegrityPreflight`；`framework-integrity.ts` 删除 child_process、Git scope/status/tracked/dirty、退役字段 advisory 与 `framework_integrity`/`framework_control_plane_dirty` 结果生产；`profiles/hmos-app/harness/visual-feedback.ts` 删除以 frameworkRoot 为 cwd 的 `git rev-parse HEAD` 与 sidecar 文本二次哈希，改为复用 package identity loader 暴露的 manifest `source_commit` 和 sidecar manifest SHA。只保留非阻断 package identity 与通用 EOL helper；不得改成永久 SKIP、不得在 init 或其它 phase 另挂 Git 检查。
    status: completed
  - id: t4-integrity-consumers-and-history-compat
    content: T4 收口 classifier/adjudication/goal/summary/guidance 消费面：当前 halt 只认现有生产者 `node_options_injection/process_injection`；旧 summary/report 中 `framework_integrity`、旧 subtype、`integrity_subtypes` 只供 renderer provenance，在 current classification/halt/retry/continuation prompt 前剥离。resume 旧 run 直接按当前发布件重验，不 halt、也不落 code_regression 指导；保留 process integrity 安全裁决。
    status: completed
  - id: t5-write-guard-config-and-consumer-docs
    content: T5 纠正文档、模板、配置与 Write/Edit 守卫说明：同 Windows 用户降级只剩合作式编辑工具守卫，明确 shell/脚本/场外进程盲区且无事后检测器；清理 agent settings/hooks/core/rules 中“查时 framework_integrity 兜底”注释；明确修订 README、docs/overview、framework-init SKILL/scan-project、framework.mdc、device-testing profile addendum、skills/README、host-harness-readiness、docs/concepts/README、DOC_INVENTORY、boundary、AGENTS/config 模板、config schema/config.ts 与 MIGRATION。保留守卫本身和 legacy 配置只读兼容，不新增 allowlist/env bypass；移除所有当前发布内容中的 submodule/vendor 双布局与 Framework HEAD/宿主提交叙事。
    status: completed
  - id: t6-delivery-boundary-and-package-identity
    content: T6 保住可信交付边界并统一 package identity：`pack-release`/`verify-release-pack`、candidate/明确集成链现有 manifest/sidecar/per-file 校验不得删弱或搬进普通 init/phase；现有 identity loader 扩展为直接解析 sidecar 中的 manifest SHA，并连同 manifest version/source_commit/built_at 供 check-init 与 visual-feedback 共用，禁止把 sidecar 文件文本再哈希或读取宿主 HEAD。全部身份只作非阻断展示，异常最多 WARN/unknown；不新增 install baseline、trust DB、sidecar 状态或运行时全量复核，也不执行实际 pack/publish。
    status: completed
  - id: t7-git-state-invariance-regressions
    content: T7 建立临时消费者回归矩阵并修正 lifecycle smoke 权威登记：以旧发布件为 Git HEAD、镜像覆盖完整有效的新发布件，真实制造 M/D/?? 且不 add/stage/commit，执行真实 `init-orchestrate UPDATE` 并从 run-log/summary 证明 `run-global-phases` 成功、catalog 无 Framework Git result；相同字节五态 verdict/identity 等价。同步 `CASE_REGISTRY`、`STAGES`、clone/context/registry 单测；全部使用临时 fixture，不操作真实宿主。
    status: completed
  - id: t8-review-records-and-migration-order
    content: T8 纠正评审记录与迁移叙事：在 `M0-M1-review-report.md` 和 `0.3-p0-guard-inventory.md` 明确撤销“updater 重铺后必须提交才可过 phase”的 by-design 结论，按事实改写 framework identity 小节与测试覆盖；同步所有当前生产注释/文档中的 dirty fallback 说法，历史 archived change/旧报告仅保留历史身份，不批量改写。
    status: completed
  - id: t9-validation-and-closeout
    content: T9 按风险比例验收并收口：先跑 active OpenSpec strict、受影响 typecheck/定向单测、临时消费者矩阵与发布内容有界文本核查，再按发布内容改动要求跑 `cd harness && npm test`；另跑 release identity 单测、plan-version、能覆盖未跟踪 plan 字节的 no-index diff/check 与 LF 检查。禁止宿主 T8、真机、Hylyre/provider 扩面、release pack/all、提交或推送；全部通过后更新本 plan 与原 plan T6/OpenSpec task 状态。
    status: completed
overview: >
  彻底删除“宿主 framework/ 的 Git dirty 状态参与 Maison init/phase 裁决”的错误设计。
  framework/ 只是 Maison 已构建并校验的发布件落盘目录；宿主是否使用 Git、是否 tracked、
  staged、committed 或 clean 都不是 Maison 契约。发布件完整性只在 Maison release verify 与
  用户明确触发的集成边界校验；普通 init/phase 只消费发布件能力，不重新证明它与宿主 HEAD
  一致。身份隔离保留 OS/sandbox/ACL/read-only 强隔离与同 Windows 用户下的合作式 Write/Edit
  守卫两档，后者诚实承认 shell/脚本/场外进程盲区，不再用事后检测伪装安全边界。
---

# framework 运行时 Git 解耦：发布件更新不依赖宿主提交（c3d8e1f6）

状态：**修复决策已冻结，待按本 plan 实施；本轮只产 plan，不实施。**

## 0. 计划身份、权责与 SSOT

本 plan 是 3.0.0 的独立纠偏载体，不替换 testing/Hylyre plan，也不创建新的 OpenSpec 身份边界 change。

| 项 | 冻结值 |
|---|---|
| plan id | `c3d8e1f6` |
| version | `3.0.0` |
| OpenSpec 唯一承载 | `openspec/changes/framework-identity-boundary` |
| 原 plan 关系 | 实施时同步纠正 `a6c4e9f2` 的 D5/T6，并重开 T6 |
| 消费者拓扑 SSOT | 根 `AGENTS.md`：Maison 发布件落到宿主 `framework/`，不是 Git submodule |
| 总设计原则 | `docs/overview.md §1.2.1`：简单优先、回退重签、协作可恢复 |
| 排除规则 SSOT | `scripts/release-excludes.json` |
| 行尾 | `.gitattributes` + `.editorconfig`，全部 LF |

优先级冻结：根 `AGENTS.md` 的发布件唯一拓扑高于历史 plan、OpenSpec、MIGRATION、review report、测试和注释中的 Git/submodule 残留。宿主提交策略不属于 Maison 契约，不得由局部实现重新引入。

## 1. 已核实事故事实

### 1.1 证据入口

本 plan 以以下只读证据为依据，不重新猜测、不在实施时重复操作真实宿主：

1. `D:/1.code/SimulatedWalletForHmos/framework/harness/reports/_global/init-orchestrate/20260901T024405Z/summary.md`
2. `D:/1.code/SimulatedWalletForHmos/framework/harness/reports/_global/init-orchestrate/20260901T024405Z/run-log.json`
3. `D:/1.code/SimulatedWalletForHmos/framework/harness/reports/_global/catalog/merged-report.md`

### 1.2 已冻结事实

| 事实 | 已核实结果 | 对修复的含义 |
|---|---:|---|
| 新发布件 manifest 文件数 | 1094 | 发布件是完整候选，不是半包 |
| missing | 0 | 落盘未缺文件 |
| per-file hash mismatch | 0 | 发布件字节与 manifest 一致 |
| manifest 与 `.sha256` | 一致 | package identity 链有效 |
| 宿主 HEAD | 旧发布件 | HEAD 与新发布件不同是正常升级前提 |
| 覆盖后 Git 状态 | 304 | 不是包损坏证据 |
| 其中 modified / deleted / untracked | 65 / 4 / 235 | 正常版本差异同时覆盖 M/D/?? |
| init 失败点 | `run-global-phases` 的 catalog | updater 已完成合法覆盖，随后 phase 自己误杀 |
| catalog 唯一 BLOCKER | `framework_integrity` / `framework_control_plane_dirty` | 首失败来自运行时 Git dirty gate |

宿主报告中 catalog 的其它 17 项 PASS、1 项业务 WARN；唯一 FAIL 是 scoped Git dirty 结果。因而这不是“发布件完整性不足后被 gate 正确拦住”，而是“合法升级字节被宿主旧 HEAD 解释成污染”。

## 2. 根因与错误设计定性

### 2.1 当前调用链

```text
用户明确覆盖完整新发布件
  → 宿主 HEAD 仍指向旧发布件
  → framework/ 正常出现 M / D / ??
  → harness-runner 每个 phase 无条件调用 runFrameworkIntegrityPreflight
  → framework-integrity.ts 对 framework scope 运行 git status
  → framework_integrity FAIL / framework_control_plane_dirty
  → catalog/init/goal summary 把合法升级裁成 BLOCKER
```

### 2.2 根因

根因不是 pathspec 太宽、runtime allowlist 不全、init 时点不对，也不是只缺 updater 标志；根因是把两个不相干的事实错误合并：

| 事实域 | 能证明什么 | 不能证明什么 |
|---|---|---|
| 发布件 manifest/sidecar/per-file 校验 | 交付包在可信边界是否完整、自洽 | 宿主何时 add/stage/commit |
| 宿主 Git status/HEAD | 宿主当前协作与版本管理状态 | 字节来自合法 updater 还是非法写入 |

Git dirty 没有来源证明能力：合法升级未提交会 FAIL，非法修改提交后可 PASS，非 Git 宿主可 SKIP。因此它同时制造假阳性和假阴性，不能构成身份边界。

### 2.3 为什么不能“仅修 init”

`runFrameworkIntegrityPreflight` 位于统一 runner 的全模式入口；把 init 例外化、把检查挪到 catalog 之后、改成 updater-running bypass，都会在其它 phase 继续用 Git 复刻同一错误。修复必须删除生产者，而不是增加分支。

## 3. 冻结的目标模型

### 3.1 Git 状态对 Maison 裁决恒为无关输入

以下变量对普通 init、catalog、glossary、docs、feature phase、goal gate 的 Maison verdict 影响必须恒为零：

1. 宿主是否为 Git 仓库；
2. `framework/` 是否 tracked；
3. staged、unstaged、untracked 的数量与组合；
4. 工作树是否 clean；
5. 用户是否提交；
6. HEAD 是否仍是旧发布件；
7. 宿主业务目录是否 dirty。

这里的“无关”不是 SKIP 语义，而是**根本没有对应 runtime check/result**。

### 3.2 完整性只在可信交付边界

| 边界 | 允许的校验 | 对普通 phase 的影响 |
|---|---|---|
| Maison `pack/release verify` | staging 文件集合、per-file hash、manifest/sidecar/zip 链 | 失败则不能成为发布件 |
| 用户明确触发的 updater/集成操作 | 对将要集成的发布件做既有包完整性校验 | 失败则不完成集成；不得转嫁为日常 phase gate |
| 普通 init/phase | 不重算整棵发布件、不比较 Git/HEAD | 零完整性裁决输入 |
| package identity 展示 | version、source commit、built_at、manifest SHA 等现有身份事实 | 只读、非阻断；异常最多 WARN/unknown |

不得为了弥补仓内 updater 边界不清晰，把 per-file 校验重新挂回 `harness-runner`、`check-init` 或任一普通 phase。

### 3.3 身份隔离两档

| 环境 | 能力 | 必须诚实承认的边界 |
|---|---|---|
| 有 OS/sandbox/ACL/read-only mount/restricted token | framework 控制面由模型外主体强制只读；updater 临时获写权 | 可证明被限制主体无法写 |
| 同一 Windows 用户、无受限 token | 只保留现有 Write/Edit/MultiEdit/NotebookEdit 合作式守卫 | shell 重定向、脚本、`node -e`、场外进程均可能改写；无法检测也无法证明 |

降级环境不再声称有“第二层查时兜底”。守卫 fail-open 或绕过时的盲区必须直接写进文档和注释，不能再造事后 detector 补齐。

### 3.4 新写入与历史读取分离

新运行不得生产：

- `framework_integrity`；
- `framework_control_plane_dirty`；
- 由 framework Git 状态导致的 `framework_integrity_block`；
- 永久 SKIP 版 `framework_integrity`。

历史报告可继续只读：

- 旧 `framework_integrity` check；
- 旧 `framework_drift`、manifest/foreign subtype；
- 旧 `integrity_subtypes` 与 goal report provenance。

历史兼容只能存在于 parser/renderer，不得作为当前 writer、重验或恢复分支的理由。

## 4. 禁止方案

实施与 review 不得引入以下任何替代物：

1. 自动提交、要求提交、建议“提交 framework 后重跑”；
2. install baseline、Git tree/ref baseline、HEAD tree 对比；
3. 普通 init/phase 的 manifest/per-file hash 全量复核；
4. trust DB、新 sidecar、新场外状态、签名基线；
5. allowlist、具名审批、环境变量/config bypass；
6. updater 正在运行标志、锁文件、租约；
7. tracked/untracked 双模式或 Git/non-Git 双裁决；
8. Git submodule、submodule/vendor 双布局；
9. 把 dirty check 政名为 package identity、provenance、freshness 或 control-plane health；
10. 每次返回 SKIP 的空壳 `framework_integrity`；
11. 借机重构无关 goal/summary、provider per-TC、Hylyre 协议/source。

## 5. 实施影响面与文件级安排

### 5.1 OpenSpec 唯一 change

| 文件 | 必须修订的内容 |
|---|---|
| `openspec/changes/framework-identity-boundary/proposal.md` | 删除“降级=guard+Git dirty”“检查 id 保留”“宿主纳入版本管理是部署变量”；改成强隔离或单一合作式编辑守卫，普通 phase 无 Git 输入 |
| `design.md` | 删除 Git scope/status/基线权衡；把本事故 1094/0/0 与 304(M/D/??) 作为反例；明确 guard 盲区不可补齐 |
| `specs/framework-integrity/spec.md` | 删除 added dirty requirement/scenarios；新增或改写为“ordinary runtime MUST NOT inspect host Git state”；保留 write guard、release manifest、package identity 非阻断与历史只读要求 |
| `specs/runtime-policy/spec.md` | anti-cheat 红线改为强隔离或合作式 Write/Edit guard；禁止 Git dirty/per-file runtime detector 进入 tier 外红线 |
| `specs/goal-runner/spec.md` | 新运行无 Git dirty integrity blocker；旧报告可读；其它真实 integrity blocker 不回归 |
| `specs/release-boundary/spec.md` | 保留 `docs/vendor/**` 排除与发布件边界，不用它替代本次 Git 解耦 |
| `tasks.md` | 重新打开/改写假完成项，按本 plan 的迁移顺序登记 |

至少重开或改写的现有 task：`1.1`、`1.2`、`2.3`、`2.4`、`3.1`、`3.2`、`3.3`、`4.1`、`5.2`、`5.3`。`2.1/2.2` 中已经正确完成的 runtime hash/sidecar 退役事实应保留，不因纠偏复活旧机制；`2.3` 必须改成“旧字段仍可解析、读取即忽略、不能解锁守卫，迁移说明只落 schema/template/MIGRATION”，不得保留“运行时一次性 advisory”的假完成；`4.2 docs/vendor` 排除不反转。`5.1` 按条件环境的诚实强隔离契约改写，不能因当前 Windows 缺环境永久制造假 pending。

### 5.2 原 plan `a6c4e9f2`

实施者已获用户明确授权修改原 plan 的这一主题，且只能改这一主题：

1. frontmatter `t6-host-maintainer-identity-isolation` 先改回 pending/in_progress；
2. D5 删除“write guard + 每任务/phase Git dirty 聚合”；
3. T6 删除 scoped Git helper、tracked/untracked、提交/基线生效描述；
4. 验收场景 13–15 改为强隔离条件项、同用户仅 guard、普通 phase 零 Git/零结果；
5. “边界与不做”明确 Git dirty 也已退场，不再称其合作式检测；
6. 交付顺序的 framework lane 改为“runtime Git/hash 都退场 + 强隔离/守卫诚实分档”；
7. T8 保持 pending，本 plan 不执行宿主回灌；
8. 本 plan 验收全部通过后，才把 T6 重新标 completed。

不得顺手改 selector、execution_channel、Hylyre 0.5.0、provider per-TC 或 T8 正文。

### 5.3 生产者

#### `harness/scripts/utils/framework-integrity.ts`

保留的现有能力：

- `loadReleaseManifest`；
- `readFrameworkPackageIdentity`；
- `buildFrameworkIdentityResult`；
- `formatFrameworkPackageIdentity`；
- 从既有 `RELEASE-MANIFEST.sha256` 直接解析出的 manifest SHA 身份字段（合法 64-hex 或 unknown，不二次哈希 sidecar 文本）；
- `normalizeIntegrityTextEol`（仍被 `check-skills-confirmation-ux.ts` 使用）；
- identity 所需最小类型与 manifest 读取。

删除的能力与依赖：

- `child_process.spawnSync`；
- `canonical-gitignore` 的 dirty-scan 专用 import；
- `gitOut`、`FrameworkGitScope`、`resolveFrameworkGitScope`；
- `isDirtyExemptPath`、`dirtyResult`；
- `runFrameworkControlPlaneDirtyCheck`、`manifestWasTracked`；
- `withRetiredFieldAdvisory`；
- `runFrameworkIntegrityPreflight`；
- `framework_integrity`/`framework_control_plane_dirty` 常量、details、suggestion；
- 所有“未提交/已提交/无基线/请提交”的生产注释与文案。

identity 注释不得再声称与 preflight 共用 parser。manifest SHA 必须由同一个 package identity loader 直接解析现有 sidecar 的 64-hex 声明值并作非阻断展示；不得哈希 sidecar 文本、遍历 `files[]` 或重算每个文件。

#### `harness/harness-runner.ts`

删除 `runFrameworkIntegrityPreflight` import 与无条件 `checks.push(...)`。不加 phase allow/deny list，不给 init 特判，不移到 capability registry、checker、goal wrapper 或 lifecycle hook。

#### `profiles/hmos-app/harness/visual-feedback.ts`

当前 `resolveFeedbackIdentity` 是第二条生产期 Framework Git 身份读取，必须与 dirty gate 同批删除：

1. 删除 `child_process.spawnSync` 与 `git rev-parse HEAD`；
2. 不再以 `frameworkRoot` 为 cwd 启动任何 Git 子进程；
3. 直接复用 `readFrameworkPackageIdentity(frameworkRoot)` 的 `version`、manifest `source_commit` 与 sidecar manifest SHA；
4. `framework_package_digest` 取 sidecar 声明的 manifest SHA 本身，不得对 sidecar 文件文本再做一层 sha256；
5. 为兼容现有 visual-feedback schema，保留 `framework_commit_sha` 字段但将其唯一来源冻结为**发布件 manifest 的 source_commit**，绝不是宿主 HEAD；不得新增第二个身份 loader；
6. identity 缺失/损坏仍为 null/unknown 的非阻断事实，不改变 visual feedback verdict。

对应 `profiles/hmos-app/harness/tests/unit/visual-feedback.unit.test.ts` 必须从“digest 或 Git commit 任一非空”反转为“发布件身份完全来自 manifest/sidecar”，并覆盖同一发布件五种 Git 环境逐字段相同。

#### 相关通用 helper

- `canonical-gitignore.ts` 继续服务 gitignore 与 runtime artifact policy；删除“供 framework-integrity 扫描”的失效注释和无生产消费者的 scan-only API 时须先确认其它 release/guard 测试用途。
- `process-integrity.ts` 的 `node_options_injection` 是独立真门禁，保留；只纠正“与 framework preflight 并列”的过期注释。

### 5.4 classifier、adjudication、goal、summary 与 guidance

| 文件/能力 | 安排 |
|---|---|
| `goal-failure-classifier.ts` | 当前 integrity 只认 `node_options_injection/process_injection`；提供 current-decision 视图剥离其它历史 integrity；`extractIntegritySubtypes` 仅供旧报告 renderer provenance |
| `adjudication.ts` | 审核 `framework_integrity_block → framework_fault` 的通用映射；因 process integrity/历史读取仍需，不得仅因 dirty 退场盲删；确保没有 Git-specific decision |
| `goal-phase-runtime.ts` | continuation 在提取 priorFailure/classify 前剥离旧 framework blocker；历史-only summary 不注入 halt/retry/code_regression prompt，直接当前重验；保留 process integrity halt |
| `await-confirm-guidance.ts` | 删除 `framework_integrity` 文件清单、dirty/提交/allowlist 恢复话术；`framework_bug` 热修也不得要求提交后续跑；如保留通用 integrity guidance，按当前 blocker 原因说话 |
| `goal-report-generator.ts` | 删除“allowlist/还原/重铺”作为通用 framework_integrity 固定散文；历史 subtype 只显示 provenance，不驱动当前处置 |
| `goal-runner-phase.ts` | `integrity_subtypes` 字段保留为历史/真实 integrity provenance，不作为 Git writer |
| summary/blocker/repair consumers | 证明新 report 不含 Git dirty check；generic blocker mapping 不因历史兼容生成新结果 |

`framework_integrity_block` 不能按名字全局删除：当前 `node_options_injection` 同样使用 `blocking_class='integrity'`。本 plan 只删除“framework Git dirty 导致该 kind”的生产路径，不扩大为 goal taxonomy 重构。

### 5.5 Write/Edit 守卫、配置与模板

| 文件 | 安排 |
|---|---|
| `agents/shared/guard-framework-write-core.mjs` | 保留路径守卫与 runtime write allow predicate；删除“Git dirty 查时兜底”“scan parity”过期说明；fail-open/非编辑工具盲区写清楚 |
| `agents/{claude,codeagent}/templates/settings.json` | 删除 Bash 写入由 framework_integrity 兜底的注释，改为诚实盲区 |
| `agents/{claude,cursor}/templates/hooks/guard-framework-write.mjs` | 删除 G2/扫描兜底注释，行为保持合作式 guard |
| `agents/shared/agent-bundle/templates/rules/framework-agent-execution.mdc` | 删除 `framework_integrity 控制面 dirty` 作为确定性检出；保留不得自改 framework 与 process injection 等真实红线 |
| `templates/AGENTS.md.template` | enforced_by 改为 OS/sandbox/ACL 强隔离或 PreToolUse 合作守卫，不列 runtime integrity 结果 |
| `harness/config.ts` | 退役 `integrity.*` 的 live 门禁注释与“由 framework-integrity 裁决”说法；为无损 UPDATE 保留结构时只标 legacy ignored，不产生 advisory/check，含旧字段配置的 normalize 结果不得影响 guard/verdict |
| `specs/framework.config.schema.json` | legacy 字段继续兼容解析、读取即忽略、不能解锁守卫；迁移说明留在 schema，不出现 scoped Git dirty/豁免 dirty，不新增 bypass |
| `templates/framework.config.template.json` | field note 改为 runtime Git/hash 均退场、旧字段无效；不暗示第二层 detector |

守卫继续以发布件 manifest 在场识别 consumer layout是现有布局探测，不得借此演化成 manifest 内容校验或 phase verdict。

### 5.6 消费者文档与事实记录

必须修订并由有界文本核查逐文件覆盖：

1. `README.md`：删除接入/缺目录/万能引导中的 `git submodule add/update`，改成获取并解压 Maison 已验证发布件；
2. `docs/overview.md`：拓扑图与部署章节只保留发布件落盘，删除 Vendor/Submodule 双模式、reports 与 submodule 分离等现行设计；
3. `skills/project/framework-init/SKILL.md`：缺 `framework/` 时只提示先集成 Maison 发布件，不得要求 submodule；
4. `skills/project/framework-init/prompts/scan-project.md`：删除 submodule/gitlink 探测，发布件存在性与 package identity 才是接入事实；
5. `agents/shared/agent-bundle/templates/rules/framework.mdc`：删除 `submodule/vendor`、已跟踪文件措辞，改为发布件控制面与 Write/Edit 守卫边界；
6. `profiles/hmos-app/skills/device-testing/profile-addendum.md`：删除 “SimulatedWalletForHmos 或 submodule”“同步 ≥ Framework HEAD”，改为集成满足要求的已验证 Maison 发布件身份；Hylyre 自身 `vendor/` 源码目录叙事不属于 framework 部署双布局，保留；
7. `skills/README.md`：consumer boundary 与 framework-init 索引不再称 submodule；
8. `skills/reference/host-harness-readiness.md`：缺发布文件时要求重新集成发布件，删除“更新子模块”和“消费者 submodule 边界”；
9. `docs/concepts/README.md`：删除不存在的 `vendoring-vs-submodule.md` 两模式入口；
10. `docs/DOC_INVENTORY.yaml`：删除 overview “引用 vendor/submodule 模式”的说明，按新的单一发布件拓扑更新 sources/update trigger；其中 docs freshness 自身使用 Git commit 时间的实现不属于宿主 framework 身份，不误删；
11. `skills/reference/consumer-framework-boundary.md`：删除所有 dirty blocker、提交/还原、Git baseline、运维扫描兜底；降级只描述编辑工具守卫及盲区；保留 scratch/、上游回灌、updater 权责；
12. `MIGRATION.md`：重写 3.0.0 控制面边界迁移；删除 `framework_integrity` 新语义；把“部署到目标工程：两种模式”收敛为发布件唯一集成，删除 Submodule 模式与 Vendor/Submodule 双布局；
13. `skills/feature/device-testing/reference/hylyre-host-preflight.md`：删除“多工程共用 framework 子模块、对齐 Git 提交”；改为各宿主集成同一已验证发布件身份；
14. `templates/AGENTS.md.template`、agent settings/hooks/core/rules：删除 runtime dirty/扫描兜底与 tracked/untracked 叙事；
15. `openspec/changes/testing-stepresult-evidence-consumption/M0-M1-review-report.md`：在 D/T6 小节明确原 scoped Git 方案已被 2026-09-01 事故推翻；撤销 §4.3“必须提交才过 phase”；更新测试套件说明；
16. `openspec/changes/testing-stepresult-evidence-consumption/0.3-p0-guard-inventory.md`：撤销同一 by-design 结论；
17. 当前生产注释、测试名中所有“查时兜底/提交后生效”叙事。

archived OpenSpec、旧报告、旧 release notes 是历史记录，不批量改写；但它们不得被当前文档引用为现行设计。面向当前消费者的发布内容中不得保留 submodule 支持叙事。

有界文本核查只扫当前发布内容集合（根 `README.md`/`MIGRATION.md` 与 `skills/specs/harness/profiles/agents/workflows/templates/docs`，排除 archived OpenSpec、旧 release notes、报告和 vendored Hylyre source），拒绝操作性的 `git submodule add/update`、`Vendor/Submodule`/`submodule/vendor` 双布局、gitlink 探测、`同步 ≥ framework HEAD`、以 tracked/commit 为 framework 生效条件；“不是/非 git submodule”的否定边界允许保留，第三方 Hylyre `vendor/` 目录的真实专名不误报。

### 5.7 测试与 fixture

重点改造/新增覆盖：

- `harness/tests/unit/framework-integrity.unit.test.ts`：删除 Git 仓/dirty gate 正向测试，保留并强化 package identity valid/corrupt/absent/manifest-SHA 非阻断测试；可按职责重命名套件，但不新建平行 identity 实现；
- `profiles/hmos-app/harness/tests/unit/visual-feedback.unit.test.ts`：删除“package digest 或 Git commit 任一存在”的宽松断言；用同一 manifest/sidecar 字节在 dirty、staged、committed、整树 untracked、非 Git 五种临时宿主逐字段比较 identity，钉死 `framework_package_digest=sidecar 声明值`、`framework_commit_sha=manifest.source_commit` 与生产代码零 framework cwd Git；
- `harness/tests/unit/goal-headless-guard.unit.test.ts`：现行 integrity 用 `node_options_injection/process_injection` 验分类；旧 `framework_integrity/framework_drift` 只验历史解析，不再冒充新 writer；
- `harness/tests/unit/guard-framework-write.unit.test.ts`：继续验证各 adapter 编辑工具拒绝与 runtime 目录放行；删掉 scan fallback 假设；新增 shell/场外不在射程的文档契约断言而非伪检测；
- `harness/tests/unit/runtime-policy.unit.test.ts`：不再把 identity-only `framework-integrity.ts` 当 runtime red-line producer；改检查真实 process/guard/其它红线与 evidence tier 零耦合；
- `harness/tests/unit/framework-config-schema.unit.test.ts`：legacy integrity 字段只读保留、不生效、不生成 runtime result；
- `harness/tests/unit/release-shipped-in-ignored-dirs.unit.test.ts`：保留跨清单发布正确性，删除“换机后 framework_integrity BLOCKER”理由，改为发布/集成边界完整性理由；
- `harness/tests/unit/init-update-policy.unit.test.ts`、`init-orchestrate-smoke`：package identity 仍呈现且不阻断；
- `scripts/smoke-consumer-lifecycle.mjs`：移除 runtime integrity stage/export；#9 在 M/D/?? 未提交状态先执行真实 `init-orchestrate UPDATE`，读取 run-log/summary 断言 `run-global-phases=executed` 与 catalog 零 Git result，再执行五态 catalog 矩阵；
- `harness/tests/unit/smoke-lifecycle-registry.unit.test.ts`：断言新升级用例存在、状态为 covered 且 `coveredBy` 指向真实 `STAGES` id；删除该 stage 或 context 接线时必须失败，并反向断言 `integrity` stage/export/reference 已清零；必要时把“coveredBy 必须命中 stage”收进 `assertCaseRegistryComplete` 本体，避免只有测试层知道约束；
- `scripts/tests/release-identity.unit.mjs`、consumer candidate binding：证明 pack/verify/integration identity 没被删弱；
- `harness/tests/run-unit.ts`：套件注册按最终文件名同步，不留死入口。

## 6. 迁移顺序

```text
T1 修订现有 framework-identity-boundary OpenSpec + 重开错误 task + strict
  → T2 原 a6c4e9f2 D5/T6 同步纠正并重开 T6
  → T3 runner 删除 preflight；framework-integrity 删除全部 Git writer
  → T4 goal/classifier/summary/guidance 做 source-sensitive 收口与历史只读兼容
  → T5 guard/config/templates/consumer docs 改成强隔离或单一合作守卫
  → T6 release/updater 边界与 package identity 非阻断回归
  → T7 临时 consumer 的事故复现 + Git 状态不变矩阵
  → T8 纠正 M0/M1/guard inventory 错误记录
  → T9 定向 → 全量 → OpenSpec/plan/diff/LF 收口
```

顺序约束：

1. 契约先改，避免实现再次按旧 spec 补回 dirty gate；
2. 原 plan T6 在生产修改前重开，禁止假完成状态跨过实施期；
3. 先删生产者，再清理消费者，避免用新 SKIP 结果维持旧分支；
4. 历史兼容最后按真实调用点保留，不能从“也许有人读”推导永久 writer；
5. T7 只用临时目录/fixture，不读取或修改真实宿主除用户已指定的三份报告证据；
6. T8 宿主回灌仍属于原 plan，必须由用户另行触发。

## 7. 回归验收矩阵

### 7.1 事故复现与 Git 状态不变性

| 编号 | 临时 fixture 前提 | 操作 | 必须结果 |
|---|---|---|---|
| A | Git HEAD 是合成旧发布件；当前候选是完整有效新发布件 | 镜像覆盖制造 M/D/??；不 add/stage/commit；执行真实 `init-orchestrate UPDATE` | run-log/summary 中 `run-global-phases` 成功，catalog 无 Framework Git result |
| B1 | 相同有效新发布件字节 | 保持 tracked dirty | 目标 phase verdict/check 集与 B2–B5 相同 |
| B2 | 相同字节 | `git add` 形成 staged | 同 B1 |
| B3 | 相同字节 | commit | 同 B1 |
| B4 | 相同字节 | framework 整树 untracked | 同 B1，不出现 SKIP 版 integrity |
| B5 | 相同字节 | 非 Git 宿主 | 同 B1，不因 git 不可用产生结果 |
| C | 任一 B 状态 | 仅宿主业务目录增加 modified/untracked | Maison phase verdict 与未 dirty 业务目录一致 |
| C2 | B1–B5 的同一发布件字节 | 生成 visual-feedback identity | version、manifest SHA、source_commit、gate fingerprint 等 Framework 身份逐字段相同；不得随宿主 HEAD 变化 |

比较口径是 Maison phase 的 verdict、blocker id/classification 与适用 check 状态；Git 本身用于其它合法 run identity/diff 功能产生的摘要字段不纳入等价比较，但不得有针对 `framework/` 的 status/ls-files/rev-parse-scope 调用。

### 7.2 生产者与报告

| 编号 | 断言 |
|---|---|
| D | `harness-runner.ts` 无 `runFrameworkIntegrityPreflight` import/call，所有 phase 自然同时生效 |
| E | `framework-integrity.ts` 无 `child_process`、Git scope/status/dirty 实现与 `framework_control_plane_dirty` writer |
| F | 普通 phase 不启动针对 framework 的 `git status` / `git ls-files` / `rev-parse --show-toplevel` 检查；生产代码也不存在以 `frameworkRoot` 为 cwd 的 `git rev-parse HEAD` 或其它 Git 子进程。其它业务 diff/run identity Git 用途不误删 |
| G | 新 script-report/summary/merged/goal report 不产 `framework_integrity` 或 Git dirty 型 `framework_integrity_block` |
| H | 旧 summary 中 `framework_integrity/framework_drift/...` 可由 renderer 显示 provenance，但 fresh/stale classify 均不返回 `framework_integrity_block`，continuation 不注入其 prompt/halt/retry，也不落 code_regression 指导 |
| H2 | 含 `integrity.allow_local_drift` / `drift_allowlist` 的旧配置仍可解析且不影响 guard/verdict；新运行零迁移 advisory、零 `framework_integrity`，失效说明只来自 schema/template/MIGRATION |

### 7.3 能力边界不回归

| 编号 | 断言 |
|---|---|
| I | Claude/Cursor/CodeAgent 的 Write/Edit 类守卫仍拒绝 framework 控制面，runtime allow path 仍通过 |
| J | 文档与诊断明确 shell/脚本/场外进程盲区，没有“查时兜底”或补偿 detector |
| K | `node_options_injection` 等真实 integrity blocker 仍按既有安全语义分类/halt；不被本次 Git 解耦误删 |
| L | pack/verify 的 manifest/sidecar/per-file/文件集合测试继续通过；candidate/明确集成身份绑定不弱化 |
| M | package identity 的 version/source_commit/built_at/manifest SHA 可展示；manifest SHA 等于 sidecar 内声明值而非 sidecar 文本哈希；缺失/损坏/不一致不成为普通 phase BLOCKER |
| N | `docs/vendor/**` 发布排除、EOL helper、canonical gitignore、runtime artifact write policy 的其它现有消费者不回归 |
| O | 发布内容有界文本核查通过：零操作性 submodule 命令、双布局、gitlink、Framework HEAD、tracked/commit 生效叙事；否定性“不是 submodule”和 Hylyre vendor 专名不误报 |
| P | lifecycle smoke 报告实际执行并列出新升级事故用例；对应 stage 缺失即 registry/单测失败，源码与输出零 runtime integrity stage/export/reference |

## 8. 验证命令与强度

### 8.1 本次“只写 plan”允许的校验

仅执行：

```text
node scripts/check-plan-version.mjs
git diff --no-index --check -- /dev/null <new-plan>  # 未跟踪文件有内容差异时 exit 1 为预期；>1 才是执行错误
新 plan 的 CRLF/LF 扫描
git diff --no-index -- /dev/null <new-plan>          # 实际读取并展示未跟踪 plan 全部字节
```

不运行产品测试、OpenSpec strict、typecheck、harness、release、宿主命令。

### 8.2 将来实施后的验收

按顺序执行：

1. `npm run openspec:validate`；
2. 受影响 typecheck 与定向 suite：package identity、visual-feedback identity、goal classifier/guidance/report、write guard、config schema、runtime policy、init identity、release identity、consumer lifecycle/registry；
3. 临时 consumer 的 A–P 回归矩阵；
4. `cd harness && npm test`（发布内容改动后的仓库 BLOCKER 门禁）；
5. `node --test scripts/tests/release-identity.unit.mjs`（不产 dist 发布件）；
6. `node scripts/check-plan-version.mjs`；
7. 发布内容 O 的有界文本核查；
8. `git diff --check` 与本批文本 LF 扫描。

本 plan 不运行 `release:pack`、`release:all`、candidate promote，不创建 dist 产物；真正发版仍走独立发布流程。

## 9. 非目标

- 不处理 provider per-TC binding；
- 不处理 Hylyre 协议、source、fixture 契约迁移；
- 不执行原 plan T8 或任何真机/宿主回灌；
- 不修改、清理、add、stage、commit 真实宿主工作区；
- 不借机重构无关 goal/summary 状态机；
- 不恢复 Git submodule、vendor/submodule 双布局；
- 不新建 OpenSpec change、trust 状态、sidecar、baseline、bypass；
- 不打包、发布、提交或推送。

## 10. 已发现的事实冲突

1. **根 `AGENTS.md` vs 原 plan D5/T6**：根规则说宿主 Git 与 Maison 无关；原 plan 却把 scoped Git dirty 保留为降级裁决，并已把 T6 标 completed。
2. **根规则 vs active OpenSpec**：proposal/design/spec/tasks 把 tracked/untracked、是否提交、Git 基线写成身份边界的一部分，且 13/14 task 已完成；这是建立在错误前提上的假完成。
3. **完整发布件事实 vs runtime verdict**：manifest 1094、missing=0、hash mismatch=0、sidecar 一致，但 catalog 仍只因 304 条 Git 状态 FAIL；当前 verdict 与包完整性事实相反。
4. **M0/M1 与 guard inventory 的 by-design 记录**：两处都明确写“updater 重铺后需真人提交才可过 phase”，直接把宿主提交策略错误升级为 Maison 契约。
5. **当前 agent settings/hooks/core**：注释声称 Bash/脚本写入会由 framework_integrity 查时兜底；删除 dirty gate 后必须改成诚实盲区，不能保留虚假覆盖。
6. **当前 `MIGRATION.md`**：一处宣称 scoped Git dirty 是 3.0.0 降级方案，另一处仍定义 Vendor/Submodule 两种部署模式；两者都与发布件唯一拓扑冲突。
7. **当前 device-testing host preflight**：仍要求多工程共用 `framework/` 子模块并对齐 Git commit，属于发布内容中的现行 submodule 残留。
8. **`framework_integrity_block` 的真实复用**：它不只承载 framework Git dirty，`node_options_injection` 也走 `blocking_class=integrity`；因此“删除所有同名 classifier/adjudication 分支”会造成直接安全回归，必须 source-sensitive 收口。
9. **package identity 与 dirty writer 共文件**：`framework-integrity.ts` 同时承载非阻断 package identity/EOL helper 与错误 Git gate；正确修复是删除文件内 Git 生产面并保留现有消费者，不是整文件删除或另建平行 identity SSOT。
10. **OpenSpec task 2.3 vs runtime advisory 退场**：task 2.3 已 completed 且承诺“读取即忽略并给一次性迁移提示”，但该提示的唯一 writer `withRetiredFieldAdvisory` 将被删除；不重开改写就会留下 strict 无法发现的假完成。
11. **第二条生产期 Git 身份读取**：`profiles/hmos-app/harness/visual-feedback.ts` 在 phase 内以 `frameworkRoot` 为 cwd 执行 `git rev-parse HEAD`，使同一发布件在 dirty/staged、commit 后和非 Git 环境产生不同身份；它还哈希 sidecar 文件文本而不是读取 sidecar 声明的 manifest SHA。
12. **发布内容残留面大于原清单**：README、overview、framework-init、scan-project、framework.mdc、device-testing addendum、skills 索引、host readiness、concepts 索引与 DOC_INVENTORY 都仍含操作性 submodule/HEAD/双布局叙事；其中 `docs/concepts/README.md` 还指向一个不存在的 `vendoring-vs-submodule.md`。
13. **smoke 权威登记可漂移**：`CASE_REGISTRY` #2 仍指向 `integrity` stage，`stageClone` 与 context export 也围绕 runtime integrity；`assertCaseRegistryComplete` 本体只检查 `coveredBy` 非空，虽然现有独立单测另查 stage id，删除/重构 stage 时仍必须同步改 registry、STAGES、下限和单测，不能让旧事故名继续假报 covered。
14. **历史 blocker 仍进入当前裁决**：仅删除 writer 不够；旧 summary 的 `blocking_class=integrity` 仍被 classifier/continuation 当成当前 halt。必须在 current-decision 视图剥离，只留 renderer。
15. **catalog 直跑不等于 init 事故出口**：#9 必须执行真实 init-orchestrate UPDATE，并验证 run-global-phases 的 run-log/summary，而不是只调用 check:catalog。
16. **guard 恢复路径职责写反**：framework-init 不下载/解包/覆盖发布件；正确顺序是 updater/集成操作先镜像发布件，随后 UPDATE 刷新宿主物化与全局 phase。

这些冲突均不改变冻结结论：运行时 Git dirty 裁决必须完全退场；任何尚未明确的集成工具细节只能在可信 updater/release 边界解决，不能把检查塞回普通 init/phase。
