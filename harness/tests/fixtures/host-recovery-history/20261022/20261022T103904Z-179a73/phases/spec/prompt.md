# Goal run phase: spec
Feature: cu-YmMtb3BlbkNhcmQtMgBvcGVuLWNhcmQtZmxvdw
Requirement:
# BankCard原始需求描述

> **需求名**: `bc-openCard-2`
> **创建日期**: 2026-06-10

---

## 一、需求描述

### 需求内容

本次需求内容是银行卡开卡需求，我把原始图片都归档到了本文件同级目录下。

#### 需求规格：

1.用户进入已有的添加卡片页面，之前已经开发过了。之前点击任一银行点击后，提示暂不支持，本次需求改为拉起选择卡类型半模态页面。

2.用户在全部银行页面，任一银行点击后，效果与添加银行卡页面效果一致。

3.选择卡类型半模态页面，会展示本银行支持的储蓄卡+信用卡，如果只支持储蓄卡或者信用卡则只展示一个即可。最多只能选择一种卡类型添加，选择后，下方可点击同意并继续按钮进入对应银行的选择具体卡片页面。

4.银行的选择具体卡片页面，展示该银行支持的银行卡信息，卡号只显示前四后四，但实际后台数据要按完整卡号处理。用户选择一张银行卡后，同意协议，点击下一步，拉起输入验证码半模态页面。

5.输入验证码半模态页面，拉起后默认触发一次假的短信发送，之后右侧按钮变为倒计时，用户必须输入6位验证码才能点击下一步。当前6位验证码可随意输入。倒计时归零后，右侧按钮从倒计时变成重新发送。点击后再次变为倒计时。用户输入完成验证码后，后台将完整卡数据写入RDB（本需求开始要创建卡片数据库和对应卡片数据表，将添加的卡片存入数据库中，数据库中字段至少包含卡号、卡类型[比如银行卡、交通卡、门禁卡等]、银行名称、卡类型、添加时间、开通华为支付状态、开通银联手机闪付状态、交易记录等内容），无论写入成功还是失败，将本次添加的卡片卡号（全卡号）和开卡结果带着跳转到添加结果页。

6.添加结果页是个全屏页面，没有左滑箭头，也禁止左滑事件。添加结果页根据带过来的添卡结果，展示成功或者失败状态。同时本页面只有点击完成按钮才能退出页面，并且在页面退出时，关闭当前栈中1-6的所有页面（都是本轮银行卡添卡页面）。如果本次添加是成功状态，则带着卡片卡号跳转到钱包首页（后续等银行卡详情页开发完，这里会引导跳到银行卡详情页，并携带当前卡片参数）。如果本次添加失败则仅将过程中的页面全部退出，回到最开始的添加卡片页面。

#### 页面说明：

- 1）选择卡类型半模态：页面布局完全参考'3-点击任意银行拉起添卡选卡半模态.jpg'。在添加银行卡或全部银行页面，点击某个银行后，拉起选择卡类型半模态（默认所有mock银行都支持储蓄卡和信用卡，该数据随银行数据走），上方是银行信息，然后是储蓄卡/信用卡二选一，下方有小字提示，然后是协议内容（本次默认按文本展示，不需要可点击富文本），最下方是同意并继续按钮。

- 2）选择具体卡片页面：页面布局完全参考'4-点击信用卡或储蓄卡后拉起选卡页面.jpg'。在第3步选择银行+卡类型后点击继续，跳转全屏的银行内部选卡页面，页面title就是银行名称，上方是小字提示，中间是可选择的不同卡片（每个银行，储蓄卡/信用卡，分别mock 1-2张卡数据），下方是协议（文本即可，不需要富文本），最下方是下一步。

- 3）输入验证码半模态：页面布局完全参考'5-选中某张卡片后拉起短信验证.jpg'。第4步选择具体卡片下一步后，拉起短语输入弹框，上方是小字提示（里面要展示用户手机号，从账号mock数据读），中间是输入框，左边输入右边发送按钮，用户点击发送后，需要将按钮变为60s倒计时，倒计时过程中按钮不允许再次点击。倒计时清零后，按钮重新变成再次发送，并且可再次点击。用户在短信输入框中，只能输入6位数字（需要校验），只有输入正确，下方下一步按钮才从置灰状态变为可点击。点击下一步后，则绑卡完成，进入添卡成功结果页。

- 4）添加结果页：页面布局完全参考'6-短信验证完成后结果页.jpg'。无title，全屏页面。上方根据前一个页面传递的添卡结果，控制上方图标/文案/下方小字的提示内容，然后附一张引导图片（大差不差就行了），再往下的激活nfc部分本次先不需要。最下方是完成按钮。点击完成按钮后，跳转到卡详情页。并且本次添加的卡片数据则需要写入数据库中，数据库要包含卡片的详细数据，比如卡号/类型/哪家银行/支持华为支付或银联手机闪付/交易记录，后续的卡详情等页面都是根据数据库读取卡数据并展示。有一点要注意：到了添加结果页，要屏蔽左滑事件，并且在点击完成按钮后，要把整个开卡过程中的所有开卡相关页面全部从页面栈中剔除（从添加银行卡页面开始，一直到结果页自身）。避免开卡完成后还能一直左滑看到开卡过程页面。

#### 路由规格

1. 所有页面跳转要遵循已有路由规则，相关代码参考模块画像去找，不要自由发挥或者另外写一套。
2. 测试用例要包含老代码和本轮新开发代码的页面互相跳转功能，不能导致原有路由受损。
## 目标简报（goal brief）

### 判定办法

目标以当前有效的授权与明确修订为准；候选缺陷、参考图、下位产物与目标冲突时按目标裁决并留一行裁决记录，只有目标本身冲突或缺失且无法裁决时才问人。详见 framework 行为规约 skills/reference/agent-behavioral-principles.md「权威判定」。
## Visual capability advisory (auto-detected — trust this over assumptions or phase SKILL defaults)
- Vision (can read images): **NO**
- OCR assistance available: **YES**
- Selected fidelity contract (write this to fidelity_target): **pixel_1to1**
- Effective execution fidelity ceiling for this run: **pixel_1to1**
- Acceptance strictness: **best_effort** (quality gaps are recorded as visual debt: write self-reported style/layout residuals as defects (major/minor); a screen with a self-reported major is recorded as visual debt that does NOT hard-block phase progress or drive backtrack but STILL blocks release until fixed and re-verified (minor-only residuals stay disclosure); fail, blocker, deterministic signals and missing test anchors still go back to coding; do not stop to ask about them)
- Asset acquisition mode (from fidelity-intent SSOT): **approximate** — mirror this into ui-spec verbatim.
Authoritative reference images (runner-discovered — the spec MUST declare and model ALL of
them; omitting any fails verification; do not shrink this denominator):
- doc/features/原始需求/1-2-银行卡/3-点击任意银行拉起添卡选卡半模态.jpg
- doc/features/原始需求/1-2-银行卡/4-点击信用卡或储蓄卡后拉起选卡页面.jpg
- doc/features/原始需求/1-2-银行卡/5-选中某张卡片后拉起短信验证.jpg
- doc/features/原始需求/1-2-银行卡/6-短信验证完成后结果页.jpg
**Delegated visual review is active for this run** (provider: adapter=codex, model=gpt-6.1-sol).
- You still have NO vision. Everything in the blind working method below applies to you unchanged.
- After each device capture, a **read-only** reviewer with that identity looks at every target screen
  and returns structured per-screen defects + must_fix items for YOU to fix. It cannot write anything
  in this project — not source, not artifacts, not gate files, and never a human confirmation signature.
- Observation sidecars for the reference images (machine-produced context, NOT a verdict and NOT
  your own seeing — treat them exactly like OCR JSON):
  - doc/features/bc-openCard-2/open-card-flow/spec/reports/visual-observations/3-点击任意银行拉起添卡选卡半模态.visual.json
  - doc/features/bc-openCard-2/open-card-flow/spec/reports/visual-observations/4-点击信用卡或储蓄卡后拉起选卡页面.visual.json
  - doc/features/bc-openCard-2/open-card-flow/spec/reports/visual-observations/5-选中某张卡片后拉起短信验证.visual.json
  - doc/features/bc-openCard-2/open-card-flow/spec/reports/visual-observations/6-短信验证完成后结果页.visual.json
- You remain the single writer of every project artifact. Do NOT wait for the reviewer, do NOT ask for it,
  and do NOT claim you saw anything yourself. If a round produces no review, keep working blind.
**You do NOT have vision.** Do NOT pretend to look at reference images or describe their visual
content from imagination — that is fabrication and will be caught by verification. Work like this instead:
- Structure and screen layout: infer from the requirement text and any structured hints available.
- Text copy and text positions: if OCR JSON files are listed below, treat them as ground truth — copy
  text verbatim from there, do NOT invent wording.
- Icons/logos/illustrations: first reuse existing project assets as `acquisition: repo_ref` when their
  purpose is established by code/resource references. No vision does not mean no usable assets.
  Only when an asset is missing or its purpose cannot be established, use placeholder assets +
  asset-manifest.yaml and disclose the gap. Keep `verified: unverified`; reuse is NOT visual verification.
- Anything you genuinely cannot determine without seeing the image: register it in the structured
  blind-review pending list (see phase SKILL reference/ui-spec.md「盲档工作法」) instead of guessing
  or endlessly re-attempting — that is the correct way to close this out at your capability level.
OCR JSON for reference images (text + confidence + normalized bbox per word):
- doc/features/bc-openCard-2/open-card-flow/spec/reports/ocr/3-点击任意银行拉起添卡选卡半模态.ocr.json
- doc/features/bc-openCard-2/open-card-flow/spec/reports/ocr/4-点击信用卡或储蓄卡后拉起选卡页面.ocr.json
- doc/features/bc-openCard-2/open-card-flow/spec/reports/ocr/5-选中某张卡片后拉起短信验证.ocr.json
- doc/features/bc-openCard-2/open-card-flow/spec/reports/ocr/6-短信验证完成后结果页.ocr.json
## Unattended execution (headless goal-mode) (BLOCKER — overrides phase SKILL stop-and-ask)
This run is **headless / unattended**. There is **no interactive user** in this session.
- approval_mode: **never**
**BLOCKER**: You MUST NOT stop to ask the user for confirmation, clarification, or approval.
Stopping to ask the user in headless mode = **task failure** (runner will halt the goal run).
This block **overrides** every phase SKILL instruction that says "停下来等用户确认",
"不启用 auto-approve", "must wait for user", or equivalent — **including spec Step 1.5**.
For every **in-phase** confirmation gate (registry class gate/enum/matrix/artifact_checkbox):
- Resolve automatically per `skills/reference/user-confirmation-ux.md` **§9 Goal/headless**.
- Record **every** auto-decision as one JSON line in `doc/features/bc-openCard-2/open-card-flow/spec/headless-assumptions.jsonl` (machine SSOT; the ledger is an
  audit trail — it is not authorization, and a missing ledger line does not by itself veto phase closure):
  `{"decision_id":"<unique>","run_id":"<this run id>","phase":"<phase>","gate_id":"<registry id>","class":"<gate|enum|matrix|artifact_checkbox|freeform>","decision":"<what you chose, or n/a: reason>","must_review":true|false,"source":"agent","ts":"<ISO 8601>"}`
- Optionally mirror a human-readable table in `doc/features/bc-openCard-2/open-card-flow/spec/headless-assumptions.md` (projection only — never the SSOT).
- Ledger records are **not** authorization: hard quality gates cannot be lowered by fidelity/P0/review/
  behavior waivers or any confirmation receipt. Repair the owning phase, defer for a real missing capability,
  or submit a changed requirement as a correction/successor run.
- `freeform_approval` gates (scope expansion, src mutation): **conservative default** — do NOT expand scope / do NOT mutate protected src; log the deferred request as a ledger line (must_review=true).
- gap-notes `approved_src_mutations[]` entries written by an agent are SELF-REPORTED intent, NOT
  authorization: the runner three-source chain will still HALT on any protected-source change they
  "approve". Even if a gap-note claims a seam was approved, do NOT (re-)implement it — log the request
  as must_review and continue without the mutation.
- Product source after review closure is reconciled against the closure attestation: a drift is graded by
  risk and reported as a WARN naming the review it still owes (`review_closure_attestation` in testing,
  `ut_no_src_mutation` in ut) — it does not silently pass, and it is not a licence to keep editing.
  You still own the drift: fold it back into coding and re-close review, or do the graded review it names.
  Test seams MUST NOT alter user-visible flows or default behavior — a `*_FAST_PATH`-style switch
  defaulting to true is a blocker, not a workaround.
After auto-resolving gates: **continue producing phase artifacts** and run harness. Do NOT halt at confirmation gates.
**Gate-integrity red lines (BLOCKER — violations are task failure, not a path to completion):**
- NEVER write legacy quality-signature fields such as `confirmed_by`; current quality conclusions require machine evidence.
- `bbox_verified_by` / `approved_by` / `user_requirement` may only carry their narrowly defined provenance or external-authority semantics; they never override quality FAIL.
- NEVER tamper with gate artifacts (visual-diff.json / summary.json / receipts) via process injection
  (NODE_OPTIONS --require/-r/--import/--loader, .node-options, .npmrc node-options, fs monkey-patching)
  or verdict-filling/resetting scripts; never instruct the operator to set up such bypasses.
- NEVER modify the framework control plane. There is no approval field that unlocks it: integrity.drift_allowlist
  and allow_local_drift are retired and ignored on read. Found a framework bug? HALT and report it upstream.
- Deterministic detectors (node_options_injection / visual_diff_tamper_artifact / receipt command scan /
  drift approval validation) turn any attempt into BLOCKER evidence. The only path through pixel_1to1 P0
  screens is: fix deterministic signals, then produce current native/delegated machine visual evidence.
## Orchestrator constraints (BLOCKER)
- Do NOT invoke goal-runner, --resume, or --manifest; the orchestrator is already running this goal run.
- goal-runs/ evidence directory is read-only for you: do NOT write, append, or patch events.jsonl or any run artifacts.
**Phase write boundary (recorded around this invocation):**
- Current phase: `spec`. Registered paths this phase owns:
  - `doc/features/bc-openCard-2/open-card-flow/PRD.md`
  - `doc/features/bc-openCard-2/open-card-flow/acceptance.yaml`
  - `doc/features/bc-openCard-2/open-card-flow/asset-manifest.yaml`
  - `doc/features/bc-openCard-2/open-card-flow/prd/PRD.md`
  - `doc/features/bc-openCard-2/open-card-flow/prd/spec.md`
  - `doc/features/bc-openCard-2/open-card-flow/ref-elements.yaml`
  - `doc/features/bc-openCard-2/open-card-flow/spec.md`
  - `doc/features/bc-openCard-2/open-card-flow/spec/asset-manifest.yaml`
  - `doc/features/bc-openCard-2/open-card-flow/spec/context-exploration.md`
  - `doc/features/bc-openCard-2/open-card-flow/spec/headless-assumptions.jsonl`
  - `doc/features/bc-openCard-2/open-card-flow/spec/headless-assumptions.md`
  - `doc/features/bc-openCard-2/open-card-flow/spec/ref-elements.yaml`
  - `doc/features/bc-openCard-2/open-card-flow/spec/spec.md`
  - `doc/features/bc-openCard-2/open-card-flow/spec/ui-spec.yaml`
  - `doc/features/bc-openCard-2/open-card-flow/ui-spec.yaml`
- Writing a registered artifact owned by an earlier phase invalidates this invocation: the bytes are preserved as untrusted and the runner backtracks to that owner for full revalidation. Do not repair an earlier phase's artifact in place.
- Pre-existing dirty bytes are not attributed to this invocation.
- Other changes are recorded and judged by the checks that own them (scope, drift, and closure gates); they are not silently permitted.
- `goal-runs/**`, closure state, manifests, pointers, summaries, and evidence refreshes are runner-owned. Do not edit them.
Read and follow the phase skill: skills/feature/spec/SKILL.md
Skill absolute path: D:\1.code\SimulatedWalletForHmos\framework\skills\feature\spec\SKILL.md
Before writing this phase's artifacts, read the knowledge inputs below that apply to this phase.
## Knowledge inputs

动笔前读取适用原文；索引/候选不是事实确认或已读证明。维护写入须沿原授权与时点，不在 run 内擅自刷新图谱。

- `doc/module-catalog.yaml` — 模块职责、反例与易混项；完整索引可继续探索

[
  {
    "name": "AccountManager",
    "layer": "04-BusinessBase",
    "sub_layer": null,
    "format": "HAR",
    "one_liner": "跨 Feature 的账号域能力（**HAR**，仅依赖 **`CommFunc`**）：基于 **`AppStorage`** 的登录布尔、展示账号串与 **`LoginState` 枚举流水线**（含 **`LOGGING_IN`** 过渡态；枚举另含 **`LOGIN_FAILED`** 占位，当前模拟路径未触发）；**`AccountService`** 单例为唯一入口；**`login()`** 经 **`setTimeout` 模拟异步**后写入脱敏展示串（**`MaskUtil.maskPhone`**）；登录实现为可替换**模拟成功**（注释指向华为账号 Kit）。",
    "responsibilities": [
      "以 **`AccountService.getInstance()`** 懒初始化单例；首次实例化执行 **`initStorage()`**，对 **`AccountConstants`** 声明的 **`wallet_*`** 键在缺失时 **`setOrCreate`** 默认值（未登录 / 空串 / **`LoginState.NOT_LOGGED_IN`**）。",
      "**`notify(state)`** 同步 **`STORAGE_LOGIN_STATE`** 并遍历内存 **`listeners`** 广播；**`onLoginStateChanged` / `offLoginStateChanged`** 以回调引用增删（调用方须 **`off` 同一函数引用**，典型见 **`WalletMain` · `MineTabPage`**）。",
      "**`login()`**：先 **`notify(LOGGING_IN)`**，**`await` 固定间隔 `setTimeout`**（模拟网络），再以硬编码演示手机号调用 **`MaskUtil.maskPhone`**，写入 **`STORAGE_IS_LOGGED_IN` / `STORAGE_DISPLAY_ACCOUNT`**，最后 **`notify(LOGGED_IN)`** 并返回 **`UserProfile`**。",
      "**`logout()`**：清零登录与展示串并 **`notify(NOT_LOGGED_IN)`**。",
      "**`getUserProfile()`**：从 **`AppStorage`** 读取布尔与展示串组装 **`UserProfile`**（**`avatar`** 当前为 **`null`**）；**`UserProfile.accountText`** 未登录时返回展示文案「未登录」。"
    ],
    "NOT_responsible_for": [
      "不负责 **`Phone` / `WalletMain`** 的页面编排、**`pushPath`**、**`NavPathContext.attach` / `stack()`** 等导航壳；本模块只提供 **`AccountService` + AppStorage 真理** 供 UI 调用。",
      "不负责华为账号 Kit、OAuth 页面与合规弹窗；当前为 **setTimeout + 写死成功** 的演示实现，**禁止**在 PRD 中默认等同生产级 Huawei ID。",
      "不负责通用 ArkUI 组件、主题、纯 Toast；归 **`CommUI`**。",
      "不承担卡发行、支付清算等线下钱包业务；演示账号流 **≠** 生产中台。"
    ],
    "typical_business_terms": [
      "账号管理",
      "登录",
      "登出",
      "我的账号",
      "未登录"
    ],
    "easily_confused_with": [
      {
        "module": "CommFunc",
        "disambiguation": "若只讨论 **`MaskUtil.maskPhone` 等纯工具**、与「是否已登录、`LoginState`、监听回调」无关 → **CommFunc**。\n若讨论 **AppStorage 账号键、`AccountService`、登录/登出生命周期与 `UserProfile`** → **AccountManager**（本模块）。本模块可依赖 **`CommFunc`**，禁止反向依赖。\n"
      },
      {
        "module": "CommUI",
        "disambiguation": "**列表项/主题色/Toast 等可复用 UI 积木** → **CommUI**。\n**登录态写入、展示账号串、`LoginState` 订阅** → **AccountManager**（本模块）。不要在 **`CommUI`** 通用组件内嵌 **`AccountService`** 单例逻辑。\n"
      },
      {
        "module": "WalletMain",
        "disambiguation": "**`AccountService` / `UserProfile` / AppStorage 账号键 / 登录监听** → **AccountManager**（权威域）。\n**「我的」页布局与编排、金融列表占位跳转等 feature UX** → **WalletMain**；页面调用本模块 API，**真理仍在** **`AccountManager`**。\n"
      },
      {
        "module": "Phone",
        "disambiguation": "**账号模型、存储键、`login`/`logout`、`LoginState`、监听** → **AccountManager**（本模块）。\n**`PhoneAbility`、`loadContent`、根 `Navigation`/`Tabs`、`NavPathContext`、`navDestination`** → **Phone**；入口 HAP **不**复制账号域实现。\n"
      }
    ],
    "key_exports": [
      "AccountConstants",
      "LoginState",
      "UserProfile",
      "AccountService"
    ],
    "entry_file": "04-BusinessBase/AccountManager/src/main/ets/index.ets"
  },
  {
    "name": "WalletMain",
    "layer": "02-Feature",
    "sub_layer": null,
    "format": "HAR",
    "one_liner": "钱包**主 feature**（HAR）：经 **`index.ets`** 导出 `HomeTabPage`（**`@Link navPathStack`**，源码注释禁止 **`@Prop`** 以免 `pushPath` 丢句柄）、`MineTabPage`（壳层可不传入栈）及卡包/添卡 **`@Builder`**；宿主（如 **`Phone`**）以 **`HomeTabPage({ navPathStack: $navPathStack })`** 与 `@Link` 绑定同源栈并 **`pushPath`**；二级 **`NavDestination`** 内亦可 **`NavPathContext.stack().pushPath`**（依赖宿主已 **`NavPathContext.attach`**）；presentation/data 编排卡引导、宫格、轮播与 **`HomeRepository` / `MineRepository` / `CardRepository`** 等读模型，并组合 **`AccountManager` / `CommUI` / `CommFunc`**。",
    "responsibilities": [
      "对外导出 `HomeTabPage`、`MineTabPage`、`buildCardPackPage`、`buildAddCardEntryPage`，供 **`Phone`** 等宿主装配；`HomeTabPage` **必须**通过 **`@Link navPathStack`** 接收与宿主根 **`Navigation`** 同源的 `NavPathStack`（宿主侧典型写法 **`HomeTabPage({ navPathStack: $navPathStack })`**）；**禁止**用 **`@Prop`** 传递栈（注释说明用于规避真机句柄问题）。",
      "在首页路径使用传入的 **`navPathStack.pushPath`** 触发 **`CardPackPage` / `AddCardEntryPage`**（路由名与宿主 **`navDestination`** 一致）；在 **`NavDestination`** 子页（如 **`CardPackPage`**）内可使用 **`NavPathContext.stack().pushPath`** 继续导航（如进入添卡），**前提**为宿主已在根页执行 **`NavPathContext.attach`**。",
      "在 **`MineTabPage`** 集成 **`AccountService` / `UserProfile` / `LoginState`**（**`AccountManager`**）：`aboutToAppear` 注册 **`onLoginStateChanged`**，`aboutToDisappear` 调用 **`offLoginStateChanged`**；登录与档案真理仍在 **`AccountManager`**，本模块仅编排 UI 与监听。",
      "维护 **`HomeRepository` / `MineRepository` / `CardRepository`** 及 **`ServiceEntry` / `PromoInfo` / `CardCategory` / `FinanceEntry`** 等模型，支撑首页/我的/卡包/添卡 UX（当前多为本地/Mock）。",
      "在 feature 组件中组合 **`CommUI`**（如 **`ActionListItem` / `SectionCard` / `showToast`**）与 **`CardGuideSection` / `AccountCard`** 等带钱包语义的 presentation 组件；异常路径通过 **`showToast`** 提示（如首页数据不可用）。"
    ],
    "NOT_responsible_for": [
      "不负责应用级入口、**`PhoneAbility`**、根 **`Navigation` / `Tabs` / `NavPathContext.attach`**；宿主壳归 **`Phone`**，本模块 Tab 与二级 builder **消费**已挂载的导航上下文。",
      "不负责 **`AccountService`** 单例实现与 AppStorage 键语义权威定义；真理在 **`AccountManager`**。",
      "不复制 **`CommUI`** 通用设计系统实现。",
      "不承担生产级卡发行、清算、NFC/SE 等线下业务；当前偏演示，不可默认等同生产卡系统。"
    ],
    "typical_business_terms": [
      "钱包主功能",
      "卡包",
      "添卡",
      "首页",
      "我的"
    ],
    "easily_confused_with": [
      {
        "module": "AccountManager",
        "disambiguation": "若讨论 **`AccountService` / 登录与登出 / `UserProfile` / `LoginState` / AppStorage 中账号态** 的**领域服务与数据模型** → **AccountManager**（权威域）。\n若讨论**「我的」页怎么摆、和首页如何跳转、卡包/添卡流程 UI** 等**feature 内页面与路由编排** → **WalletMain**（本模块），即使代码里在「我的」调用了 `AccountService`。\n"
      },
      {
        "module": "CommUI",
        "disambiguation": "可复用、无钱包业务名状的 **ListItem/卡片容器/主题色/Toast** → **CommUI**。\n**卡引导、卡分类列表、与「卡包」强绑定的 feature 专页/区块** → **WalletMain**；可 import `CommUI`，但**业务组件与数据绑定**的归属在仓库路径 `02-Feature/WalletMain`。\n"
      },
      {
        "module": "CommFunc",
        "disambiguation": "**纯工具与日志/脱敏**、与卡包/首页/我的的**产品语义**无关 → **CommFunc**。\n与**钱包 Tab、卡种入口、服务宫格/活动与导航 `pushPath` / `NavPathContext.stack` 的业务语义**强相关 → **WalletMain**；**`NavPathContext.attach` 与全局栈宿主挂载**仍属 **`Phone` + `CommFunc`**。\n"
      },
      {
        "module": "Phone",
        "disambiguation": "**卡种/服务宫格/卡包/添卡、`pushPath` 触发点、feature 内 Repository 与用例、`NavPathContext.stack()` 在子页内的继续导航** → **WalletMain**（本模块）。\n**Entry HAP、`PhoneAbility`、`loadContent`、根 `Navigation`+双 Tab 壳、`NavPathContext.attach`、`navDestination` 注册二级 `@Builder`** → **Phone**；`Phone` 的 `pages/index` 从本模块 import 子页并传入 **`$navPathStack`** 绑定，**本模块不实现** Ability 与 HAP 壳。\n"
      }
    ],
    "key_exports": [
      "HomeTabPage",
      "MineTabPage",
      "buildCardPackPage",
      "buildAddCardEntryPage"
    ],
    "entry_file": "02-Feature/WalletMain/src/main/ets/index.ets"
  },
  {
    "name": "Phone",
    "layer": "01-Product",
    "sub_layer": null,
    "format": "HAP",
    "one_liner": "应用**入口 HAP**：`PhoneAbility` 加载 `pages/index`；根 `Index` 装配 `Navigation`+双 `Tabs`，`aboutToAppear` 中 `NavPathContext.attach`；**首页 Tab** 以 **`HomeTabPage({ navPathStack: $navPathStack })`** 传入与宿主同源栈（与 `WalletMain` 内 `@Link navPathStack` 配套），**我的 Tab** 壳层直接装载 **`MineTabPage()`**；`navDestination` 注册卡包/添卡至 `WalletMain` 的 builder；含 **`PhoneBackupAbility`（backup）**；**不实现**业务数据与账号域，仅壳与多 HAR 聚合。",
    "responsibilities": [
      "维护 `PhoneAbility`（`UIAbility`）：`onWindowStageCreate` 中 `loadContent('pages/index', …)`，生命周期节点使用 `hilog` 记录；`onCreate` 尝试设置应用级 `ColorMode`。",
      "在 `pages/index.ets` 声明 `@Entry`：`Navigation(this.navPathStack)` + 底部 `Tabs`（首页/我的）；`aboutToAppear` 调用 `NavPathContext.attach(this.navPathStack)`（`@aspect/CommFunc`）；**首页** `TabContent` 内渲染 **`HomeTabPage({ navPathStack: $navPathStack })`**，向 feature 传入与宿主一致的栈绑定；**我的** `TabContent` 内渲染 **`MineTabPage()`**（当前壳层未向其传入 `navPathStack`）；`navDestination` 将 `CardPackPage` / `AddCardEntryPage` 映射到 `@aspect/WalletMain` 的 `buildCardPackPage` / `buildAddCardEntryPage`。",
      "通过 HAP `oh-package.json5` 声明对 `WalletMain`、`AccountManager`、`CommUI`、`CommFunc` 的依赖，固定「入口壳 + feature + 基座」装配图。",
      "声明 `PhoneBackupAbility`（`BackupExtensionAbility`，`type: backup`）及 `backup_config` 元数据挂载点；具体备份策略以配置与系统契约为准。"
    ],
    "NOT_responsible_for": [
      "**不负责**首页服务宫格、活动轮播、卡包列表、我的页金融入口等**业务数据与用例**；此类归属 **`WalletMain` 的 Repository 与 feature 子页**。",
      "**不负责** `AccountService` / 登录态 / `UserProfile` 的域模型与存储；`Index` 仅消费 `WalletMain` 中已接好的「我的」页，**不**在 HAP 内复制账号领域逻辑。",
      "**不定义**可跨应用复用的通用 `ActionListItem` / 主题等；继续由 **`CommUI` / `CommFunc`** 提供，本壳只做页面级装配。",
      "不承担发布渠道、分账、真机 SE 等**渠道与合规**决策；HAP 仅持工程级配置与能力声明。"
    ],
    "typical_business_terms": [
      "主应用",
      "应用入口",
      "启屏",
      "底 Tab"
    ],
    "easily_confused_with": [
      {
        "module": "WalletMain",
        "disambiguation": "若讲 **应用 Ability、窗口与 `loadContent`、HAP 依赖声明、多 Tab 的壳层 `Navigation`、入口 `@Entry`、`NavPathContext` 挂载栈** → **Phone**（本模块）。\n若讲 **首页/我的内具体卡引导、服务宫格数据、`buildCardPackPage` 业务 UI、`HomeRepository` 等** → **WalletMain**；`Phone` 的 `Index` 只 **import 并放置** 这些 export，不承载 feature 内仓库与用例实现。\n"
      },
      {
        "module": "AccountManager",
        "disambiguation": "**入口壳、`PhoneAbility`、`Navigation`/`Tabs`、`NavPathContext.attach`、`navDestination`、HAP 级依赖聚合** → **Phone**（本模块）。\n**`AccountService`、AppStorage 账号键、`login`/`logout`、`LoginState`、`UserProfile` 真理** → **AccountManager**；本模块仅 **依赖并装载**含账号 UI 的子页，**不**在 HAP 内复制账号领域实现。\n"
      },
      {
        "module": "CommUI",
        "disambiguation": "**`PhoneAbility`、`loadContent`、根 `Navigation`/`Tabs`、`NavPathContext`、`navDestination`、HAP 装配** → **Phone**（本模块）。\n**`ActionListItem`、`SectionCard`、`CommColors`、`showToast` 等跨业务复用积木** → **CommUI**；壳层 **import** 拼装，**不在 HAP 再造一套设计系统实现**。\n"
      },
      {
        "module": "CommFunc",
        "disambiguation": "**`PhoneAbility`、`loadContent`、根壳层 `Navigation`/`Tabs`、调用 `NavPathContext.attach`、HAP 依赖聚合** → **Phone**（本模块）。\n**`Logger`、`MaskUtil`、`NavPathContext` 的实现本体**（无 Ability、无页面壳）→ **CommFunc**；本模块 **依赖并调用**其 API，**不在 HAP 重复实现**通用工具与上下文类。\n"
      }
    ],
    "key_exports": [],
    "entry_file": "01-Product/Phone/src/main/ets/phoneability/PhoneAbility.ets"
  }
]

- `doc/glossary.yaml` — 术语与 alias 候选；字面命中不替代语义消歧

[
  {
    "term": "添卡",
    "canonical_module": "WalletMain",
    "owner_layer": "02-Feature",
    "aliases": [],
    "sample_usage": "当 PRD 说「`buildAddCardEntryPage`、卡种引导/选卡入口、进入卡包前的加卡流程」时，多指**本 feature 的添卡路由与业务页**；不是 `CommUI` 里无卡种语义的通用按钮行、也不是 `AccountService` 自身的接口定义。",
    "confidence_hint": "精确命中 `WalletMain.typical_business_terms`；与 NOT 不冲突（已扫）。",
    "easily_confused_with": [
      {
        "term": "账号管理",
        "module": "AccountManager",
        "disambiguation": "若讨论 **`AccountService` / 登录与登出 / `UserProfile` / `LoginState` / AppStorage 中账号态** 的**领域服务与数据模型** → **AccountManager**（权威域）。\n若讨论**「我的」页怎么摆、和首页如何跳转、卡包/添卡流程 UI** 等**feature 内页面与路由编排** → **WalletMain**（本模块），即使代码里在「我的」调用了 `AccountService`。\n"
      },
      {
        "term": "公共 UI 组件",
        "module": "CommUI",
        "disambiguation": "可复用、无钱包业务名状的 **ListItem/卡片容器/主题色/Toast** → **CommUI**。\n**卡引导、卡分类列表、与「卡包」强绑定的 feature 专页/区块** → **WalletMain**（本模块）；可 import `CommUI`，但**业务组件与数据绑定**的归属在仓库路径 `02-Feature/WalletMain`。\n"
      },
      {
        "term": "系统功能封装",
        "module": "CommFunc",
        "disambiguation": "**纯工具与日志/脱敏**、与卡包/首页/我的的**产品语义**无关 → **CommFunc**。\n与**钱包 Tab、卡种入口、服务宫格/活动与导航**强相关 → **WalletMain**（本模块）；本 feature 在少数路径可能调用 `CommFunc`（如日志），**禁止**用 `CommFunc` 当「主功能 feature」的挡箭牌。\n"
      },
      {
        "term": "主应用",
        "module": "Phone",
        "disambiguation": "**卡种/服务宫格/卡包/添卡、feature 内 Repository 与用例** → **WalletMain**（本模块）。\n**Entry HAP、`PhoneAbility`、`loadContent`、根 `Navigation`+双 Tab 壳、HAP 级多模块依赖装配** → **Phone**；`Phone` 的 `pages/Index` 从本模块 import 子页，**本模块不实现** Ability 与 HAP 壳。\n"
      }
    ]
  },
  {
    "term": "首页",
    "canonical_module": "WalletMain",
    "owner_layer": "02-Feature",
    "aliases": [],
    "sample_usage": "当 PRD 说「`HomeTabPage` 里的服务宫格/活动/卡引导、`HomeRepository` 提供的数据、双 Tab 里偏『首页』那一屏的内容」时，多指**本 feature 的首页子页**；不是 `Phone` 的 `loadContent` 或根 `Navigation` 壳、也不是 `AccountService` 的 API 面。",
    "confidence_hint": "精确命中 `WalletMain.typical_business_terms`；与 NOT 不冲突（已扫）。",
    "easily_confused_with": [
      {
        "term": "账号管理",
        "module": "AccountManager",
        "disambiguation": "若讨论 **`AccountService` / 登录与登出 / `UserProfile` / `LoginState` / AppStorage 中账号态** 的**领域服务与数据模型** → **AccountManager**（权威域）。\n若讨论**「我的」页怎么摆、和首页如何跳转、卡包/添卡流程 UI** 等**feature 内页面与路由编排** → **WalletMain**（本模块），即使代码里在「我的」调用了 `AccountService`。\n"
      },
      {
        "term": "公共 UI 组件",
        "module": "CommUI",
        "disambiguation": "可复用、无钱包业务名状的 **ListItem/卡片容器/主题色/Toast** → **CommUI**。\n**卡引导、卡分类列表、与「卡包」强绑定的 feature 专页/区块** → **WalletMain**（本模块）；可 import `CommUI`，但**业务组件与数据绑定**的归属在仓库路径 `02-Feature/WalletMain`。\n"
      },
      {
        "term": "系统功能封装",
        "module": "CommFunc",
        "disambiguation": "**纯工具与日志/脱敏**、与卡包/首页/我的的**产品语义**无关 → **CommFunc**。\n与**钱包 Tab、卡种入口、服务宫格/活动与导航**强相关 → **WalletMain**（本模块）；本 feature 在少数路径可能调用 `CommFunc`（如日志），**禁止**用 `CommFunc` 当「主功能 feature」的挡箭牌。\n"
      },
      {
        "term": "主应用",
        "module": "Phone",
        "disambiguation": "**卡种/服务宫格/卡包/添卡、feature 内 Repository 与用例** → **WalletMain**（本模块）。\n**Entry HAP、`PhoneAbility`、`loadContent`、根 `Navigation`+双 Tab 壳、HAP 级多模块依赖装配** → **Phone**；`Phone` 的 `pages/Index` 从本模块 import 子页，**本模块不实现** Ability 与 HAP 壳。\n"
      }
    ]
  }
]

- `doc/architecture.md` — 架构背景；设计依据仍按原权威链引用
- `doc/conventions.md` — 存在时读全文；review 独立选适用项并打开范例（文件缺失 / 未启用；不声称已消费）
- `doc/component-index.yaml` — 完整组件库存；与策展按 id 联合读取并反查源码
- `doc/component-catalog.yaml` — 组件适用/不适用与易混项；不覆盖源码事实（文件缺失 / 未启用；不声称已消费）
- `framework/docs/README.md` — 框架背景索引，按当前任务跟随相关原始链接
- `framework/profiles/hmos-app/skills/README.md` — 当前 profile 知识与 Skill 资产协议
- `framework/profiles/hmos-app/skills/spec/profile-addendum.md` — 执行 spec 前阅读当前 profile 补充

# `hmos-app` · Skill `spec` profile addendum

宿主 `project_profile=hmos-app` 时，spec 常以 **HarmonyOS 应用功能**为背景（ArkUI 页面、能力与权限、多端形态等）。

描述 UI 组件时可优先使用 ArkUI 组件术语（如 `Column`、`Row`、`List`、`Tabs`、`Navigation`），但仍须以用户提供的截图/描述为准，不得凭平台惯例补需求。

## 权威资产清单

| 用途 | 路径 |
|------|------|
| 阶段规则（中立骨架 + 合并） | `framework/specs/phase-rules/spec-rules.yaml`；profile 专属补充以 `framework/profiles/hmos-app/profile.yaml` → `phase-rules-overlays` 为准（若存在与本 stage 对齐的条目） |
| Visual Handoff / `ui_change`（若启用） | `framework/skills/feature/spec/` 正文与 `prompts/` |
| UI-Spec（ui-spec.yaml） | `framework/skills/feature/spec/reference/ui-spec.md` |
| ui-spec 模板 | `` `profile-skill-asset:spec/ui_spec_template` `` |

### skill-assets.yaml 键

本 skill 的 asset 键与相对路径**唯一声明**在机器清单 `framework/profiles/hmos-app/skills/skill-assets.yaml`（`assets.spec` 段）。根 `SKILL.md` 用 `` `profile-skill-asset:spec/<键>` `` 引用，解析规则见 `framework/skills/README.md` 的 “Profile skill asset protocol”。**本 addendum 不再罗列键与路径**，以清单为单一真相（SSOT），避免散文与清单漂移。

## `generic` / 中立工程提醒

本体 Skill 正文中的示例（外层占位名、示意截图类型）均以**参考仓库**为准；实际 **Scope、`in_scope_modules`、术语映射**必须与当前实例的 `doc/module-catalog.yaml` 一致。

## Context Exploration Gate（profile 补充）

- 可选旁证：`oh-package.json5`（包名）、`build-profile.json5`（模块 `srcPath`），用于核对 Scope 与物理模块路径。
- **UI 真源**以 spec Visual Handoff / 用户截图为准；`context-exploration.md` 须能指向像素权威（`authoritative_refs` 或等价路径）。

## 视觉保真捕获（v2.4+ · pixel_1to1）

- Step 2 须按**分区扫描**产出 `spec/ref-elements.yaml`（参考图侧独立枚举；`implement | defer` 二选一）。
- `ref-elements` 中 `disposition: defer` 可在 spec Visual Handoff 块登记 `fidelity_deferrals` 作披露；pixel_1to1/P0 下它始终是未满足的 strict 义务，legacy `human_signed`/`signed_by` 不放行。
- ui-spec 须写 `must_have_elements` / `semantic_role` / `color_ref` / `icon` / `badge`；plan 阶段补 `visual-parity.yaml` 组件映射供 coding **组件级** token 绑定校验。
- `pixel_1to1` 联动产出 `spec/asset-manifest.yaml`（素材需求清单，拒绝 AI 山寨资产）。


- CodeGraph WalletMain: Cannot read properties of undefined (reading 'find')；回目标源码探索。
- CodeGraph AccountManager: Cannot read properties of undefined (reading 'find')；回目标源码探索。
- CodeGraph Phone: Cannot read properties of undefined (reading 'find')；回目标源码探索。
After producing artifacts, run harness for this phase and ensure summary.json is written.
Do NOT claim phase complete if harness verdict is INCOMPLETE or FAIL.
After this phase, only the frozen remaining chain applies: plan.

## Frozen execution scope / P1 input protocol 1.1
Completion target: feature; requested results: 完成 bc-openCard-2 的实现、业务 UT、代码检视与真机视觉/导航验收，满足蓝图 AC-1..AC-6、BD-1..BD-3、NFR-1
Frozen phase chain: spec→plan; execute only spec in this invocation.
Before substantive work, establish or adopt real facts at D:\1.code\SimulatedWalletForHmos\doc\features\bc-openCard-2\open-card-flow\context\facts.md. The first phase in this run is spec.
Preserve a validated predecessor baseline and its actual established_by; append only this phase_delta. Never invent spec/change execution.
New facts belong to the responsible Skill/checker; do not edit the frozen manifest or cancel obligations because a check failed.
acceptance-context:candidate: required; 已有验收可用
acceptance-definition:visual: unknown; pixel_1to1 定档缺视觉验收条目