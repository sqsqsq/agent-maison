---
name: plan 待办 SSOT — frontmatter todos 唯一真源，正文未勾项拦截
version: 3.0.0
# 版本说明：窗口不 bump（用户控版本）。本 plan 由 2026-08-12 宿主实测复盘派生：
# dc27f455（version_evolution_strategy，2.1.0，窗口已关）交付的 check-plan-version 只解析
# frontmatter todos，正文 markdown checklist 形成注册制盲区。dc27f455 保留历史发现并指向本 plan，
# 其 2.1.0 版本不动；执行项收在本 plan（窄范围，仅治注册面，不动版本语义）。
overview: >
  发布门禁看不见正文 `- [ ]`。实测（2026-08-12，version >= 3.0.0）：9 个 plan 正文含 checklist，
  其中 5 个**无 frontmatter todos**。风险要分两类，别混：
  · **真假绿（严重）**——`d8c5f3a7`(未勾 4) 与 `e9c4a7f3`(未勾 6) 共 **10 个未注册 pending**，
    这两份 plan **完全不进发布门**；其中 `d8c5f3a7` 正是 `c4e8b1d3` Todo 5 明写要
    「复演同一次」的 plan；
  · **双账本漂移（次要）**——`423e5d0f`(1) 与 `c4e8b1d3`(2) 共 **3 个正文重复项**，
    它们**已有对应的 frontmatter pending**，故当前**不会假绿**；风险是两处账本各自漂移。
  方案（用户 2026-08-12 裁定，codex 收敛）：**frontmatter `todos:` 是唯一机器待办 SSOT**；
  当前及未来窗口的 plan **正文不得承载未完成的 `- [ ]`**，出现即在**默认校验**中失败
  （不只 release 模式），同时迁移上述 4 个含未勾项的存量 plan。
  **历史 `- [x]` 可保留**但不作为机器状态——重新打开任务时必须先在 frontmatter 登记；
  **不为形式统一去迁移那 5 份只剩纯历史 `[x]` 的 plan**（简单优先）。
  **明确不做正文 todo 解析器**——避免定义「哪些复选框算发布待办」这个歧义面，
  也避免把设计讨论里的示例复选框误当门禁项。
todos:
  - id: t1-meta-gate
    content: >
      元门禁：`check-plan-version.mjs` **默认模式**新增一条。触发范围precise如下——
      **在完成既有 version / deferred_to 合法性校验之后**，对**所有 `version >= 当前窗口`
      的 plan** 检查正文；**合法的 `deferred_to` 不构成豁免**（顺延到未来窗口的 plan
      同样受约束，否则新 plan 可以靠 deferred 绕过登记）。
      判定：正文出现任何**未勾** `- [ ]` → FAIL，提示「待办须写入 frontmatter todos
      （唯一机器 SSOT）；正文 checklist 门禁不可见」。`- [x]` 不触发；扫描范围为
      frontmatter 之后的正文。
      **不解析正文内容、不从正文推导 todo 状态**——只做注册面拦截。
      allowlist 与 pre-frontmatter allowlist 的既有豁免语义不变。
    status: completed
  - id: t2-migrate-blind-plans
    content: >
      迁移 4 个含未勾正文项的在窗 plan，两种形态各自处置：
      **形态 A（无 frontmatter todos，门禁完全不可见）**——`d8c5f3a7`(未勾 4)、
      `e9c4a7f3`(未勾 6)：按正文 checklist 补 frontmatter `todos:`，id 沿用正文既有标识
      （如 `s6-locator-host-validation`），status 与正文勾选状态**逐条对齐**，
      正文 checklist 改为非复选框列表并注明「状态以 frontmatter 为准」。
      **形态 B（已有 frontmatter todos，正文重复）**——`423e5d0f`(未勾 1)、
      `c4e8b1d3`(未勾 2)：正文 checklist 与 frontmatter **逐条核对不一致处**后，
      把正文改为非复选框列表（去重，frontmatter 为准）。
      纪律：迁移**只搬状态不改状态**——正文未勾的一律落 `pending`/`in_progress`，
      不得借迁移之机关闭任何待办；发现正文与 frontmatter 状态冲突时以**更保守**的一侧为准
      并在 plan 内登记该冲突。
    status: completed
  - id: t3-tests-and-convention
    content: >
      ① 单测放 **dev-only 的 `scripts/tests/check-plan-version.unit.mjs`**
      （门禁脚本属仓根工具链，**不得放进发布内容 `harness/`**）。覆盖**六个分支**：
      ①「在窗 plan 正文有未勾框 → 默认 FAIL」；②「只有已勾框 → PASS」；
      ③「过去窗口 plan 不受约束」；④「allowlist 项豁免语义不变」；
      ⑤ **`version: 3.1.0` + `deferred_to: 3.1.0` + 正文未勾项 → 必须 FAIL**
      （future deferred 不得豁免）；
      ⑥ **已有 frontmatter todos，但正文另有未勾 `- [ ]` → 默认模式仍 FAIL**
      （双账本漂移面，不因 frontmatter 已登记而豁免）；
      ② AGENTS.md 的 plan 约定段落成文一条：**正文不得承载未完成的 `- [ ]`；
      历史 `- [x]` 可保留但不作为机器状态；重新打开任务必须先在 frontmatter 登记**
      （含理由：门禁只认 frontmatter，正文未勾框是假绿通道）；
      ③ 迁移后复跑 `check-plan-version`（默认 + `--release`）并记录拦截数变化。
      **预期账**（其他状态不变时）：当前 10 → 迁移完成且本 plan 自身完成后 **11**
      —— 本 plan 退出 −1，`d8c5f3a7` / `e9c4a7f3` 进入 +2。
      拦截数上升是**修复生效的正向信号**，不得为压低数字而回退迁移或关闭待办。
    status: in_progress
isProject: false
---

# plan 待办 SSOT — frontmatter todos 唯一真源，正文未勾项拦截（a3e7d1c9）

状态（2026-08-12）：**t1 completed / t2 completed / t3 in_progress**。
t1 元门禁与 t2 存量迁移已实施；t3 的单测已落（9 例全绿：六个必需分支 + 三个围栏回归），
**仅剩 ② AGENTS.md 约定成文**——`AGENTS.md` 当前有 `f3a8c6d2` 的未提交改动，
为不干扰该 plan 的本地开发，本条待 f3a8c6d2 提交后补。

**开工次序**：本 plan **可独立实施**——只碰仓根 `scripts/`，与 `f3a8c6d2` 无交叉。
同批派生的另三项（`e9c4a7f3` s6-locator、`c6d8f2b4` t2b、`420a5005` run-directory-freshness）
分别与 `visual-diff-check.ts` / `visual-diff-capture.ts` / `check-testing.ts` 有交叉，
**须待 `f3a8c6d2` 提交后对新基线重新核对再开工**。

## 事实与规模（2026-08-12 实测）

`check-plan-version.mjs` 经 [plan-version-lib.mjs](scripts/plan-version-lib.mjs) 解析待办，
`out.todos.push(...)` 只在 **frontmatter** 解析循环内；正文 `- [ ]` 一概不进 `todos[]`。
于是「用 markdown checklist 记待办、frontmatter 不写 `todos:`」的 plan，即便在窗且有未完项，
`--release` 也照样放行。

扫描 `version >= 3.0.0` 且正文含 checklist 的 plan（9 个）：

| 形态 | plan | 未勾 / 已勾 |
|---|---|---|
| **A** 无 frontmatter todos | `视觉闭环二期_…_e9c4a7f3` | **6 / 10** |
| **A** | `视觉负向优化根治_…_d8c5f3a7` | **4 / 20** |
| A | `goal-fakepass-hardening_…_e3a9c5d1` | 0 / 13 |
| A | `vision-canary-probe-validity_…_c7d2e9a4` | 0 / 6 |
| A | `盲档意图自动定档_…_f6b2d9a4` | 0 / 5 |
| **B** 有 frontmatter todos | `结果级范围门禁_…_c4e8b1d3` | **2 / 3** |
| **B** | `ut存量共存_…_423e5d0f` | **1 / 47** |
| B | `场外信任状态最小化_…_b7e4d2a9` | 0 / 4 |
| B | `设备就绪与阶段完成判定_…_a7f2e5d1` | 0 / 6 |

含未勾项的 4 个要分开算，别合并成一个数：

- `d8c5f3a7`(4) + `e9c4a7f3`(6) = **10 项完全未注册**——无 frontmatter todos，
  这两份 plan 整体不进 `--release` 统计，是**真假绿面**；
- `423e5d0f`(1) + `c4e8b1d3`(2) = **3 项已有 frontmatter 对应项**——`--release` 已能看到，
  当前**不构成假绿**，风险只是正文与 frontmatter 两处账本重复与漂移。

其余 5 个当前只有已勾框，按「只拦未勾框」的判据不受影响，但一旦有人取消勾选即会被 t1
拦下——这正是期望行为。

## 为什么选元门禁而不是正文解析器

正文复选框在本仓有多种用途（设计讨论、验收清单、review 记录），要让解析器区分
「哪些算发布待办」必须新引入标记约定，等于把歧义面搬进门禁。元门禁反过来：
**不解释正文，只要求待办登记到唯一 SSOT**。同类教训——`CORE_SUITES` 显式注册表：
新套件不注册＝假绿；治法是强制注册，不是让运行器去猜哪些文件算测试。

## 边界

- 不改 `version` / `deferred_to` / allowlist 的既有语义（dc27f455 交付面不动）。
- 不为本 plan 之外的 plan 改动任何 todo 的**状态**；迁移只搬不改。
- `dc27f455`（2.1.0）只保留历史发现并指向本 plan，其版本不动。

## 验收

- `check-plan-version` 默认模式：4 个存量 plan 迁移前 FAIL、迁移后 PASS；
- `--release` 模式：迁移后拦截清单包含原先不可见的 plan（拦截数上升即为修复生效）；
- 单测六分支全绿（实际 9 例：六个必需分支 + 三个围栏回归——普通围栏、嵌套四包三、围栏后真待办）；
  `AGENTS.md` 约定成文；
- `git diff --check` 干净、EOL 为 LF。
