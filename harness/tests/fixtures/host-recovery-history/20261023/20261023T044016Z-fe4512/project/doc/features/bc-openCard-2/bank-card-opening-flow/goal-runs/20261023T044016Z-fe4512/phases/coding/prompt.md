# Goal run phase: coding
Feature: cu-YmMtb3BlbkNhcmQtMgBiYW5rLWNhcmQtb3BlbmluZy1mbG93
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

### 明确不做

需求原文里明确写了不要或本次不做的内容同样是排除项，即使尚未登记。
- 参考图元素 result_nfc_panel：「再往下的激活nfc部分本次先不需要」

### 本次延后

以下是 spec 登记的本次延后及债务，不是用户原文排除；理由和登记正当性仍须依当前目标核验。
- card_type_status_bar（ref_card_type_sheet）：系统状态栏；非应用自绘，保留为 best-effort 视觉债务（来源 doc/features/bc-openCard-2/bank-card-opening-flow/spec/ref-elements.yaml）
- selection_status_bar（ref_bank_card_selection）：系统状态栏；非应用自绘，保留为 best-effort 视觉债务（来源 doc/features/bc-openCard-2/bank-card-opening-flow/spec/ref-elements.yaml）
- otp_status_bar（ref_otp_verification_sheet）：系统状态栏；非应用自绘，保留为 best-effort 视觉债务（来源 doc/features/bc-openCard-2/bank-card-opening-flow/spec/ref-elements.yaml）
- otp_system_numeric_keyboard（ref_otp_verification_sheet）：系统数字键盘由输入类型触发；不由应用绘制，保留为 best-effort 视觉债务（来源 doc/features/bc-openCard-2/bank-card-opening-flow/spec/ref-elements.yaml）
- result_status_bar（ref_opening_result_success）：系统状态栏；非应用自绘，保留为 best-effort 视觉债务（来源 doc/features/bc-openCard-2/bank-card-opening-flow/spec/ref-elements.yaml）
- result_ocr_uncertain_copy（ref_opening_result_success）「回中加」：OCR 低置信孤立文本，reviewer 观察判定为插画区域而非可靠产品文案；留待有视觉能力复核（来源 doc/features/bc-openCard-2/bank-card-opening-flow/spec/ref-elements.yaml）
有效范围已明确而审查意见相反：更正 review 报告，不派扩大范围的 coding 返修；实现违约由 coding 恢复契约。只有登记错误、定义缺口或目标需要改变时回原设计/spec 责任方。
合法延后按当前严格度披露债务与发布状态；不豁免真实功能、数据或关键交互缺陷。

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
  - doc/features/bc-openCard-2/bank-card-opening-flow/spec/reports/visual-observations/3-点击任意银行拉起添卡选卡半模态.visual.json
  - doc/features/bc-openCard-2/bank-card-opening-flow/spec/reports/visual-observations/4-点击信用卡或储蓄卡后拉起选卡页面.visual.json
  - doc/features/bc-openCard-2/bank-card-opening-flow/spec/reports/visual-observations/5-选中某张卡片后拉起短信验证.visual.json
  - doc/features/bc-openCard-2/bank-card-opening-flow/spec/reports/visual-observations/6-短信验证完成后结果页.visual.json
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
- doc/features/bc-openCard-2/bank-card-opening-flow/spec/reports/ocr/3-点击任意银行拉起添卡选卡半模态.ocr.json
- doc/features/bc-openCard-2/bank-card-opening-flow/spec/reports/ocr/4-点击信用卡或储蓄卡后拉起选卡页面.ocr.json
- doc/features/bc-openCard-2/bank-card-opening-flow/spec/reports/ocr/5-选中某张卡片后拉起短信验证.ocr.json
- doc/features/bc-openCard-2/bank-card-opening-flow/spec/reports/ocr/6-短信验证完成后结果页.ocr.json
## Unattended execution (headless goal-mode) (BLOCKER — overrides phase SKILL stop-and-ask)
This run is **headless / unattended**. There is **no interactive user** in this session.
- approval_mode: **never**
**BLOCKER**: You MUST NOT stop to ask the user for confirmation, clarification, or approval.
Stopping to ask the user in headless mode = **task failure** (runner will halt the goal run).
This block **overrides** every phase SKILL instruction that says "停下来等用户确认",
"不启用 auto-approve", "must wait for user", or equivalent — **including spec Step 1.5**.
For every **in-phase** confirmation gate (registry class gate/enum/matrix/artifact_checkbox):
- Resolve automatically per `skills/reference/user-confirmation-ux.md` **§9 Goal/headless**.
- Record **every** auto-decision as one JSON line in `doc/features/bc-openCard-2/bank-card-opening-flow/coding/headless-assumptions.jsonl` (machine SSOT; the ledger is an
  audit trail — it is not authorization, and a missing ledger line does not by itself veto phase closure):
  `{"decision_id":"<unique>","run_id":"<this run id>","phase":"<phase>","gate_id":"<registry id>","class":"<gate|enum|matrix|artifact_checkbox|freeform>","decision":"<what you chose, or n/a: reason>","must_review":true|false,"source":"agent","ts":"<ISO 8601>"}`
- Optionally mirror a human-readable table in `doc/features/bc-openCard-2/bank-card-opening-flow/coding/headless-assumptions.md` (projection only — never the SSOT).
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
- Current phase: `coding`. Registered paths this phase owns:
  - `01-Product/Phone/**`
  - `02-Feature/FinancialCard/**`
  - `02-Feature/WalletMain/**`
  - `04-BusinessBase/AccountManager/**`
  - `05-SystemBase/CommFunc/**`
  - `05-SystemBase/CommUI/**`
  - `doc/features/bc-openCard-2/bank-card-opening-flow/coding/context-exploration.md`
  - `doc/features/bc-openCard-2/bank-card-opening-flow/coding/headless-assumptions.jsonl`
  - `doc/features/bc-openCard-2/bank-card-opening-flow/coding/headless-assumptions.md`
  - `doc/features/bc-openCard-2/bank-card-opening-flow/coding/upstream-issues.md`
- Writing a registered artifact owned by another phase invalidates this invocation: the bytes are preserved as untrusted and the runner directs recovery to that owner. Outstanding current-phase obligations still require valid proof before completion. Do not repair another phase's artifact in place.
- Pre-existing dirty bytes are not attributed to this invocation.
- Other changes are recorded and judged by the checks that own them (scope, drift, and closure gates); they are not silently permitted.
- Finite compatibility repair: existing test imports/types/data/doubles directly broken by this implementation may be repaired only while coding_existing_test_preserved confirms real pre-repair originals and unchanged existing cases/assertions, with no new test/assertion/skip. New or changed test logic belongs to UT. In the existing coding report list each changed test datum/double, the actual edit and its implementation-related reason; review verifies the actual diff. A preservation PASS is not a business-cause explanation or a test PASS.
- `goal-runs/**`, closure state, manifests, pointers, summaries, and evidence refreshes are runner-owned. Do not edit them.
Read and follow the phase skill: skills/feature/coding/SKILL.md
Skill absolute path: D:\1.code\SimulatedWalletForHmos\framework\skills\feature\coding\SKILL.md
Before writing this phase's artifacts, read the knowledge inputs below that apply to this phase.
## Knowledge inputs

动笔前读取适用原文；索引/候选不是事实确认或已读证明。维护写入须沿原授权与时点，不在 run 内擅自刷新图谱。

- `doc/module-catalog.yaml` — 模块职责、反例与易混项；完整索引可继续探索；候选画像过大，按原路径读取相关模块
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
- `framework/profiles/hmos-app/skills/coding/profile-addendum.md` — 执行 coding 前阅读当前 profile 补充

# `hmos-app` · Skill `coding` profile addendum

本工程 `project_profile=hmos-app` 时，编码阶段以 **ArkTS / ArkUI** 为默认宿主形态，并启用 DevEco / hvigor / `.ets` / HAR-HSP-HAP 等资源与模块约定。

## 权威资产清单

| 用途 | 资产引用（解析见 `framework/skills/README.md` 的 “Profile skill asset protocol”） |
|------|------|
| ArkTS 弱模型易错点 | `` `profile-skill-asset:coding/arkts_pitfalls` `` |
| ArkUI 模式速查 | `` `profile-skill-asset:coding/arkui_patterns` `` |
| API 指引 | `` `profile-skill-asset:coding/harmony_api_guide` `` |
| 编码规范全文 | `` `profile-skill-asset:coding/coding_standards` `` |
| 模块脚手架 | `` `profile-skill-asset:coding/module_scaffold` `` |

### skill-assets.yaml 键

本 skill 的 asset 键与相对路径**唯一声明**在机器清单 `framework/profiles/hmos-app/skills/skill-assets.yaml`（`assets.coding` 段）。根 `SKILL.md` 用 `` `profile-skill-asset:coding/<键>` `` 引用，解析规则见 `framework/skills/README.md` 的 “Profile skill asset protocol”。**本 addendum 不再罗列键与路径**，以清单为单一真相（SSOT），避免散文与清单漂移。

`framework/skills/feature/coding/` 下同名路径为**跳板**（仅指针），勿在跳板内追加条款。

## Harness 与 toolchain

- **真实编译 / UT / 真机**相关能力由 `framework/profiles/hmos-app/profile.yaml` → `capabilities` 与 `phase-rules-overlays` 声明；脚本层见 `framework/harness/capability-registry.ts`。
- **hvigor / hdc** 实现位于 `framework/profiles/hmos-app/harness/`（`framework/harness/scripts/utils/*-runner` 为 re-export shim）。
- 写 `.ets` 文件前，先按变更类型阅读 `arkts-pitfalls.md` 相关条目；尤其关注 `@State` 初始化、`$r()` 资源引用、`ForEach keyGenerator`、`Router vs NavPathStack`、HAR `Index.ets` 导出。
- 模块配置与依赖通常落在 `build-profile.json5` / `oh-package.json5` / `module.json5`；新增 HAP/HAR/HSP 或调整依赖时必须与 `contracts.yaml`、`doc/architecture.md` 和 `framework.config.json` 对齐。
- 跨模块导出入口文件名由 `architecture.cross_module_exports_file` 声明（以 `framework.config.json` 为准，默认 `index.ets`）；**物理路径**以各模块 `oh-package.json5` → `main` 为准，不固定为 `src/main/ets/`。

## ArkUI 视觉 parity（ui-spec → 资源）

- **色值 token**：ui-spec `tokens.*.value` → `$r('app.color.<snake_key>')`（`brand.cmb` → `brand_cmb`）
- **媒体资产**：ui-spec `assets[].key` → `$r('app.media.<key>')`。**物理落地**：`acquisition: crop` 非 placeholder 的资产，须把 `resolved_path`（`doc/.../spec/assets/<key>.<ext>` 真裁图）**复制**进引用模块 `<module>/src/main/resources/base/media/<key>.<ext>`；**禁** 1×1/纯色占位冒充、**禁** 工程根 `media/` 目录。`contracts.resource_keys[].path` 仅作契约记录、**不是** ArkUI 渲染解析路径（解析恒为模块 `resources/base/media`）。门禁：`visual_parity_asset_materialized`（pixel_1to1→BLOCKER 校验真图）；`$r()` 资源引用合法性以真实编译（`coding_compile`）为唯一真源。
- **素材=原子叶子视觉，禁双渲染（round5 P0-A/P0-C 承重）**：`assets` 的图**只作原子插画/单图标的叶子 `Image`**。**绝不**把"整段界面"裁成一张背景大图再贴——卡包区标题/副标题/「添加管理卡片」按钮、空态"暂无非本机卡片"文案、更多服务标题/副标题、底部 tab（首页·我的，含图标）一律**真实 ArkUI 组件**渲染，**不得依赖大图里烤的那份**。若发现某 asset 图内含标题/按钮/文案/tab（整段），说明它是坏的大图：停下按 P0-A 回退重裁成原子插画，**不得**"贴大图 + 又搭真实组件"（会双渲染/烤字，正是 CardGuideSection 卡包区两遍、ManageNonLocalSheet 空态文字两遍、PromoSwiper 灰盒+叠字的根因）。品牌/彩色图标（银行卡/交通卡/门禁/证件/宫格/tab）用 `$r('app.media.<icon_key>')` 真图，**禁** `sys.symbol.*` 冒充（门禁 `visual_parity_icon_substitution` BLOCKER；确需系统单色图标才用 `sys.symbol`）。
- **文案**：ui-spec 节点 `text` 逐字落入 `resources/base/element/string.json`
- 脚本守门：`coding.visual_parity`（含 `visual_parity_asset_baked_text` 烤字门禁 / `visual_parity_icon_substitution` 图标替代门禁）+ `static_fidelity_score`（ΔE / 文案 / 资产 / 结构）


编码前探索须覆盖：**`build-profile.json5` / `oh-package.json5` / 涉及模块的 `module.json5`**；**页面注册**（`main_pages.json`、`route_map.json` 等，以工程实际为准）、**资源目录**（`src/main/resources`）与 **各 HAR/HSP 库模块 oh-package `main` 指向的导出入口文件**（或 DSL 声明的 `cross_module_exports_file`）中与本轮改动相关的条目。真实工程 layout 以 oh-package main 为准；虚拟工程示例中的 `src/main/ets/` 仅为一种合法布局。

## 与中立骨架的关系

- `framework/specs/phase-rules/coding-rules.yaml` 仅保留 **profile 中立骨架**；鸿蒙细则由 `framework/profiles/hmos-app/phase-rules-overlays/coding-rules.overlay.yaml` 合并补齐。

## 业务编排（形态 B/C 与 A 的方法体）禁用 import（BLOCKER）

下列符号 **不得** 出现在业务编排源文件的 import 中（含仅类型引用），即便仅用于类型亦然：

```
@Component, @Entry, @Preview, @Builder, @State, @Prop, @Link（形态 A 仅允许用于 struct 自身 UI 状态声明，不得流入业务方法内的数据模型）
NavPathStack, NavDestination, NavPathInfo from @kit.ArkUI
$r, $rawfile, getUIContext, getContext, UIContext, PromptAction
AppStorage, LocalStorage
showToast, Toast 等 Toast 辅助函数
```

> **形态 A（Page 命名方法）**：方法可读写 `this.xxx`（struct 状态），但方法体内调用的下层函数与传入 data 层的参数须为**普通数据模型**；Toast / 路由 / 弹框等 UI 副作用在返回后由 UI 层翻译（如 `@Watch`）。

## 路由与页面注册

- 产品壳（如 `Phone`）中的 `Navigation` 需注册各功能模块的 **`NavDestination`** 页面。
- 使用系统路由表时，在对应模块 `resources/base/profile/` 下维护 **`route_map.json`**。
- 新增页面须同步 **`main_pages.json`**、字符串 / 颜色等资源，与设计 `contracts.yaml` 一致。

### 示例（仅在 hmos-app 下）

根 SKILL 中为保持 profile-neutral 已删去的具体形态，在此保留速查：

- **页面注册与资源清单**：常见涉及 `main_pages.json`、`route_map.json`、各 `resources/base/element/*.json` 等（以模块实际路径为准）。
- **壳入口**：产品壳常见使用 `@Entry` 装饰的入口组件 + Feature 侧路由页。
- **资源引用**：字符串等常见写法如 `$r('app.string.xxx')`，须与资源定义一致。


- `02-Feature/WalletMain/code-graph.yaml` — 相关模块节点导航，core 只高亮；无图/无命中回源码 02-Feature/WalletMain（文件缺失 / 未启用；不声称已消费）
- `04-BusinessBase/AccountManager/code-graph.yaml` — 相关模块节点导航，core 只高亮；无图/无命中回源码 04-BusinessBase/AccountManager（文件缺失 / 未启用；不声称已消费）
- `01-Product/Phone/code-graph.yaml` — 相关模块节点导航，core 只高亮；无图/无命中回源码 01-Product/Phone（文件缺失 / 未启用；不声称已消费）
- 02-Feature/WalletMain/code-graph.yaml 不存在；回源码探索 02-Feature/WalletMain，不自动建图。
- 04-BusinessBase/AccountManager/code-graph.yaml 不存在；回源码探索 04-BusinessBase/AccountManager，不自动建图。
- 01-Product/Phone/code-graph.yaml 不存在；回源码探索 01-Product/Phone，不自动建图。
After producing artifacts, run harness for this phase and ensure summary.json is written.
Do NOT claim phase complete if harness verdict is INCOMPLETE or FAIL.
After this phase, only the frozen remaining chain applies: review→ut→testing.

## Frozen execution scope / P1 input protocol 1.1
Completion target: feature; requested results: 从原始需求和参考图完成 bc-openCard-2 的开发、测试与验收闭环
Frozen phase chain: coding→review→ut→testing; execute only coding in this invocation.
Before substantive work, establish or adopt real facts at D:\1.code\SimulatedWalletForHmos\doc\features\bc-openCard-2\bank-card-opening-flow\context\facts.md. Preserve any validated original baseline and its establishing phase; a reordered remaining queue does not redefine its owner.
Preserve a validated predecessor baseline and its actual established_by; append only this phase_delta. Never invent spec/change execution.
New facts belong to the responsible Skill/checker; do not edit the frozen manifest or cancel obligations because a check failed.
implementation:request: required; 本次请求包含改代码
## Validated facts baseline
Preserve the baseline body and its original identity. For current owned source targets within this phase's write boundary, registering each changed or newly created source in a path | fact | impact table in ## phase_delta: coding is recommended; missing exact rows disclose weaker traceability and do not block the phase. Prefer project-relative paths; equivalent absolute paths, backslashes, ./ and repeated same-phase sections are recognized. Existing unexplored targets and requirement/contracts/config or unauthorized-source drift remain strict. Do not rewrite the baseline, even when this run starts at or backtracks to coding.
