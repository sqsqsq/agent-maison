---
name: version evolution strategy
overview: 把"版本号↔plan"的语义化演进策略固化进开发仓：plan frontmatter 打 version 标签 + 集中 MAINTAINER-CHANGELOG 自动生成 + 规范文档/Cursor 规则 + 校验脚本接入 release:verify（含 release 模式硬门禁：在研 plan 必须有版本、发布时当前窗口 plan 必须完成、bump 不遗留未完成）+ 版本间变更摘要工具，全部 dev-only 不进发布件。
todos:
  - id: agents-md-section
    content: 在 AGENTS.md 新增「版本演进策略」节：patch/minor/major 映射表 + 窗口生命周期 + 命令清单 + 与 RELEASE-NOTES/MIGRATION/MAINTAINER-CHANGELOG 分工（并对齐 MIGRATION.md L96 "framework 的 CHANGELOG" 语义）
    status: completed
  - id: cursor-rule
    content: 新增 .cursor/rules/version-evolution.mdc（alwaysApply），引导 agent 新建 plan 时写 version 字段并指向 AGENTS.md SSOT
    status: completed
  - id: plan-version-field
    content: "约定 plan frontmatter version（+ 可选 deferred_to，须 ===version）字段；为实施时扫描出的所有含 pending/in_progress 的在研 plan（当前约 16 个，含本 plan，以脚本扫描为准）补 version: 2.1.0 或将废弃者改 cancelled；仅把 todos 全 completed/cancelled 的历史 plan 快照进 plan-version-legacy-allowlist.json"
    status: completed
  - id: check-plan-version
    content: 实现 scripts/check-plan-version.mjs（默认模式：非 allowlist plan 须带合法 version，version>当前 当且仅当 deferred_to===version 才合法，无悬空在研 plan；--release 模式额外断言 version===当前 的 plan 无未完成 todo，version<当前 未完成即 FAIL 须 cancel），接入 verify-release-pack.mjs 用 release 模式阻断发布
    status: completed
  - id: version-evolve
    content: 实现 scripts/version-evolve.mjs：status + bump --patch/--minor/--major；bump 前跑 release 校验拒绝遗留未完成；不做 plan 版本迁移（顺延 plan 早已是未来版本，bump 后自动到站）；bump 落点低于某 plan 顺延目标时打 warning
    status: completed
  - id: gen-changelog
    content: 实现 scripts/gen-changelog.mjs：按 version 分组生成 dev-only MAINTAINER-CHANGELOG.md + --from/--to 版本差异模式
    status: completed
  - id: wire-excludes-scripts
    content: release-excludes.json 与 verify mustNotExist 加 MAINTAINER-CHANGELOG.md；package.json 加 release:version/check-plans/changelog；更新 release-checklist.md 流程
    status: completed
isProject: false
version: 2.1.0
---

# 版本演进策略固化（语义化版本 ↔ plan）

## 目标

让"版本号"与"特性/plan"强对应：当前在研版本 = 根 `package.json.version`（唯一"打开窗口"），窗口内所有新建 plan 都带该版本号；打包发布后按 patch/minor/major 规则 bump 进入下一窗口。由此可一键汇总任意两版本间的变更点。全部机制 **dev-only**，不污染消费者发布件。

## 关键设计决策（已确认现状）

- **当前在研版本 SSOT 复用** 根 [`package.json`](package.json) 的 `version`（现 `2.1.0`），[`scripts/pack-release.mjs`](scripts/pack-release.mjs) L40 已读它命名 zip。不新建版本 SSOT。
- **"已发布/已冻结 vs 进行中"零账本推导**：按发布流程（打包→发布→再 bump），任意时刻 `package.json.version` 即唯一打开窗口。三态判定：
  - `version === 当前` = 打开态（本窗口在研）。
  - `version < 当前` = 已冻结（应全完成；若仍有未完成 todo = 异常 → FAIL，须 `cancelled`）。
  - `version > 当前` = **顺延到未来窗口**，**当且仅当** 该 plan 带 `deferred_to` 且 `deferred_to === version` 时才合法；否则 FAIL（防手误写超前版本）。
  无需独立 ledger。
- **顺延语义（修正本轮反馈，解死锁）**：标 `deferred_to: X` 时**立即**把该 plan 的 `version` 置为未来目标 `X`（X = 下一个计划版本号）。于是被顺延的 plan 在打包当前 N 时已是 `version > 当前`，**天然不参与 N 的发布门禁**，无需在 bump 时再迁移。这样「发布门禁」（当前窗口完成度）与「窗口切换」（推进 `package.json.version`）成为两个互不耦合的动作，且保住「打包(N)→再 bump(N+1)」顺序。
- **dev-only 边界**：新增脚本放 `scripts/`（已被 `excludeRootDirs` 排除），`MAINTAINER-CHANGELOG.md` 加入排除清单；顶层 npm script 用 `release:` 前缀，由 `sanitizePackageJson`（[`release-pack-rules.mjs`](scripts/release-pack-rules.mjs) L141）自动剥离，避免泄漏到消费者 `package.json`。

## 改造点

### 1. plan frontmatter 新增 `version`（+ 可选 `deferred_to`）字段（约定）

- 新建 plan 的 frontmatter 增加 `version: <当前 package.json.version>`（如 `version: 2.1.0`），紧随 `name`/`overview`。
- 可选 `deferred_to: x.y.z`：本窗口未做完、要顺延到未来窗口的 plan 的**意图标记**。语义硬约束（修正本轮反馈①）：`deferred_to` **必须等于** `version`（同为顺延目标版本）；它存在的唯一作用是"合法化 `version > 当前`"（区分手误写超前版本 vs 显式跨窗口）。**不**用 `deferred_to` 记录来源——如需来源痕迹，另用独立字段 `deferred_from`，绝不混用语义。
- **legacy allowlist 收窄**：allowlist **只**纳入 todos 全 `completed`/`cancelled` 的历史 plan（真正冻结的存量）。**含 `pending`/`in_progress` todo 的在研 plan**（含本 plan 自身；数量随开发漂移，**以实施时脚本扫描为准**，不写死总 plan 数），这些**不得**进 allowlist。
- **在研 plan 强制补版本**：上述在研 plan 必须三选一——补 `version: 2.1.0`（纳入当前窗口），确属废弃则把 todos 改 `cancelled`（转入 allowlist），或标 `deferred_to: <未来版本>`（同时置 `version`）顺延。本 plan 自身一并补 `version: 2.1.0`。
- 全量文件名清单由实施时脚本扫描分流（todos 全 completed/cancelled → allowlist；含未完成 → 待补版本/顺延），不手抄。

### 2. 规范文档 SSOT —— AGENTS.md 新增「版本演进策略」节

在 [`AGENTS.md`](AGENTS.md)（dev-only）新增一节，含：
- patch/minor/major 语义映射表（bugfix→patch、中大型 plan→minor、架构重构→major）。
- 窗口生命周期：打开 → 窗口内 plan 共享版本 → `release:pack` → 写 `RELEASE-NOTES-vN` → `release:version bump` → 下一窗口。
- 命令清单（见 #5）。
- **文档分工（修正反馈④）**：明确三层——`RELEASE-NOTES-vN.md`（消费者向、人工撰写、dev-only）/ `MIGRATION.md`（发布件、破坏性变更与迁移）/ dev-only `MAINTAINER-CHANGELOG.md`（plan 派生、仅维护者速查）。同时澄清 [`MIGRATION.md` L96](MIGRATION.md) 提到的"framework 的 CHANGELOG / 发布说明"指**消费者向的 RELEASE-NOTES**，与本 dev-only `MAINTAINER-CHANGELOG.md` 不是同一物（命名特意区分，避免混淆）。

### 3. Cursor 规则 —— 引导 agent 自动打标签

新增 [`.cursor/rules/version-evolution.mdc`](.cursor/rules/version-evolution.mdc)（`alwaysApply: true`，dev-only）：
- 指示：新建 `.cursor/plans/*.plan.md` 时，frontmatter 必须写 `version: <读取 package.json.version 的当前值>`。
- bump 规则速查 + 指向 AGENTS.md 该节为 SSOT。

### 4. 校验脚本 `scripts/check-plan-version.mjs`（dev-only，双模式）

读 `package.json.version` 作当前窗口；遍历 `.cursor/plans/*.plan.md`；解析 frontmatter 的 `version`/`deferred_to`/`todos[].status`。

- **默认模式（开发期，轻量）**：不在 **legacy allowlist** 的 plan 必须含合法 semver `version`；`version > 当前` **当且仅当** 同时带 `deferred_to` 且 `deferred_to === version` 时合法（修正本轮反馈②，防 `version: 9.9.9` + `deferred_to: 2.2.0` 这类漂移），否则 FAIL；不存在"既不在 allowlist、又无 `version`、又含未完成 todo"的**悬空在研 plan**。日常可跑。
- **`--release` 模式（发布门禁，仅校验当前窗口完成度）**：在默认模式基础上额外断言——所有 `version === 当前` 的 plan **必须无未完成 todo**（全 `completed`/`cancelled`）。被顺延的 plan 因 `version > 当前` 已自动不在此集合内，**无需特例**（这正是顺延语义解死锁的效果）。
- 两道门禁职责分离：默认模式管"格式/悬空/超前合法性"，`--release` 管"当前窗口能否定版发布"，互不依赖 bump 时序。
- legacy allowlist：`scripts/plan-version-legacy-allowlist.json`（采纳时由脚本扫描，仅纳入 todos 全 completed/cancelled 的历史 plan）。
- 导出 `checkPlanVersions(mode)` + `formatPlanVersionHits()`，仿 [`check-stale-init-refs.mjs`](scripts/check-stale-init-refs.mjs) 形态，由 [`verify-release-pack.mjs`](scripts/verify-release-pack.mjs) 在 stale-init-refs 段后以 **`--release` 模式**调用并阻断发布。

### 5. 版本工具 `scripts/version-evolve.mjs`（dev-only）

- `status`：打印当前在研版本、该版本下 plan 数（区分完成/未完成）、已冻结版本列表、带 `deferred_to` 的未来窗口 plan（含目标版本）。
- `bump --patch | --minor | --major`（窗口切换，与发布门禁解耦）：
  1. **先跑 `--release` 模式校验**（复用 #4）——当前窗口尚有未完成 plan（且未顺延到未来）时**拒绝 bump**，提示先 `completed`/`cancelled` 或标 `deferred_to: <下一版本>`。
  2. 通过后改写 `package.json.version`（保留 2 空格缩进 + 末尾换行）。**不做** plan 版本迁移——被顺延的 plan 早已是未来版本号，bump 后它们的 `version === 新当前`，自然成为打开态。
  3. 可选清理：把 `version === 新当前` 的 plan 的 `deferred_to` 标注移除（已"到站"，意图标记完成使命）。
  4. **顺延目标提示（修正本轮反馈③）**：若仍存在 `version > 新当前` 的 plan（即顺延目标 ≠ 本次 bump 落点，例如 plan 标 2.2.0 但本次仅 `--patch` 到 2.1.1），打印 **warning** 列出这些 plan 与其目标版本，提醒"存在未来窗口 plan，未随本次 bump 进入当前窗口"，避免维护者误以为已到站。
  5. 打印提醒「为上一窗口补 `RELEASE-NOTES-vN` 并重生成 `MAINTAINER-CHANGELOG`」。
- 已完成的历史 plan 的 version 不回改（上一窗口已冻结）。

### 6. CHANGELOG 生成 `scripts/gen-changelog.mjs`（dev-only）

- 读全部 plan frontmatter（轻量解析 `version`/`name`/`overview`/`todos`），按 semver 降序分组，写 dev-only `MAINTAINER-CHANGELOG.md`：每条 = plan 标题 + 一句 overview + todo 完成度（completed/total）。
- diff 模式：`--from A --to B` 列出 `version ∈ (A, B]` 的 plan，即「两版本间变更点」。
- 无 version 的 legacy plan 归入末尾「(legacy / 未分版)」段。

### 7. 排除与接线

- [`scripts/release-excludes.json`](scripts/release-excludes.json) `excludeGlobs` 增加 `"MAINTAINER-CHANGELOG.md"`。
- [`verify-release-pack.mjs`](scripts/verify-release-pack.mjs) `assertZipContents` 的 `mustNotExist` 增加 `'MAINTAINER-CHANGELOG.md'`；以 `--release` 模式接入 `checkPlanVersions`。
- 根 [`package.json`](package.json) scripts 增加（均 `release:` 前缀，发布时被 sanitize 剥离）：
  - `release:version`（= `node scripts/version-evolve.mjs`）
  - `release:check-plans`（= `node scripts/check-plan-version.mjs --release`）——**脚本名带 release 即跑 release 模式**，与 checklist 一致，避免"名为 release 实跑默认模式"的歧义（修正本轮小问题）。开发期轻量默认模式直接 `node scripts/check-plan-version.mjs`（不另设 npm alias，在 AGENTS.md 注明）。
  - `release:changelog`（= `node scripts/gen-changelog.mjs`）
- 更新 [`docs/operations/release-checklist.md`](docs/operations/release-checklist.md)：在打包前插入 `npm run release:check-plans`（= `--release` 模式）+ `npm run release:changelog`，发布后插入 `npm run release:version bump --<level>`。

## 验收

- 默认模式 `node scripts/check-plan-version.mjs` 对现仓 PASS（历史完成 plan 入 allowlist，扫描出的在研 plan 已补 `version: 2.1.0`、改 cancelled 或顺延）。
- `--release` 模式：`version === 当前` 的 plan 存在未完成 todo 时 FAIL；把该 plan 标 `deferred_to: 2.2.0`（同时 `version` 置 2.2.0）后，因 `version > 当前` 不再参与门禁，`--release` 转 PASS（验证解死锁）。
- 默认模式：plan `version > 当前` 但**未**带 `deferred_to`、或 `deferred_to !== version`（如 `version: 9.9.9` + `deferred_to: 2.2.0`）时 FAIL；`deferred_to === version` 才 PASS。
- bump 落点 < 某 plan 顺延目标时（如标 2.2.0 却 `bump --patch`→2.1.1），bump 成功但打印 warning 列出该 plan 及目标版本。
- `node scripts/gen-changelog.mjs` 生成 `MAINTAINER-CHANGELOG.md`，2.1.0 段含已打标签 plan；`--from 2.0.0 --to 2.1.0` 输出正确子集。
- `node scripts/version-evolve.mjs bump --minor`：当前窗口有未完成（未顺延）plan 时拒绝；通过后 `package.json.version` 变 `2.2.0`，原 `deferred_to: 2.2.0` 的 plan 此刻 `version===当前` 成打开态（不需迁移动作）。
- `npm run release:verify` PASS（含 `--release` 模式 plan-version guard；`MAINTAINER-CHANGELOG.md` 不进 zip）。
- `cd harness && npm test` 不受影响（本改动均为 dev-only，不触发布内容）。
- sanitize 后消费者 `package.json` 不含 `release:version`/`release:check-plans`/`release:changelog`。

## 不在本次范围

- 回填全部历史已完成 plan 的精确版本号（仅快照入 allowlist；如需历史归档可后续单独提案）。**注**：含未完成 todo 的在研 plan 不在豁免内，必须补版本、`cancelled` 或 `deferred_to` 顺延（见 #1）。
- 自动从 plan 生成消费者向 `RELEASE-NOTES-vN.md`（仍人工撰写；`MAINTAINER-CHANGELOG.md` 仅作维护者速查与草稿来源）。
- git tag 自动化（保留现有手工 `Br_release_*` 习惯）。