---
name: 文本读入口 EOL 归一 — 手写解析的 CRLF 脆弱面收口
version: 3.0.0
# 版本说明：**用户 2026-08-06 裁定挂入 3.0.0 窗口开发**——本 plan 因此是本窗口的
# 发布必做项（release:check-plans 会把未完成 todo 计入阻塞，属预期）。
# 起因：e5d8a2c4 T4 整机链首跑抓到 autocrlf clone 下 check:global 44 BLOCKER，
# 第一处已在 e5d8a2c4 第六批闭环；本 plan 处理"还有没有别的"。
todos:
  - id: t1-find-fragile-entries
    content: >
      **只做一件事：找出真正 fragile 的生产入口，并给出 CRLF 反例。**
      判据不是"源码里有 `\n`"——那会把大半无害的也算进来（`split('\n')` 后逐行
      `.trim()`，`\r` 被 trim 掉；`/\n\s*key:/` 的 `\s` 也吃得掉 `\r`）。
      **真正脆弱的只有一类：模式要求 `\n` 紧跟在某个 token 之后**，CRLF 下那个位置
      是 `\r`，于是恒不匹配（如 `/\n    options:\n/`、`indexOf('key:\n')`）。
      **扫描范围写死**（否则验收无锚）：`harness/scripts/**`、`harness/*.ts`、
      `profiles/*/harness/**`、`agents/shared/**`、`scripts/*.mjs`；
      **排除** `**/tests/**`、`node_modules`。
      **入口才算数**：该处解析的文本必须来自**可能被 autocrlf 改写的盘上文件**；
      纯内存字符串、二进制、已归一的内部产物不计。
      **验收**：每条 fragile 都附一个能让它误判的最小 CRLF 输入。
      **没有反例的不许标 fragile**——否则清单注水（与"逐条目合法≠集合完整"同款）。
      **不做**：不出"84 处全表"，不改任何代码。
    status: pending
  - id: t2-fix-with-counterexamples
    content: >
      **按 t1 的清单逐个收口，在"拥有原始文本的那个边界"归一。**
      规则很小，不要推广成教条（codex 第八批 P2 订正我的初稿）：
      · 归一点＝**该模块自己拿到未经处理文本的地方**（读盘处；若导出 API 直接接收
        外部文本，则该 API 入口也归一）。**内部函数不重复归一。**
      · **不强制统一 import `normalizeIntegrityTextEol`**：它在
        `framework-integrity.ts`，而该模块反向依赖 `canonical-gitignore`、
        `fidelity-shared`——让底层解析模块反导它会成环。
        若 t1 证明共享需求确实多，**再**抽一个无依赖的叶子工具；只有一两处就地写。
      · 归一语义统一为 `text.replace(/\r\n?/g, '\n')`（CRLF 与孤立 CR 均归 LF），
        与 `normalizeReleaseTextEol` 同口径——**口径统一，不等于必须共用同一个函数**。
      **验收（逐项）**：先写 t1 的 CRLF 反例用例 → 红 → 改边界 → 绿。
      变异**只许打在生产代码上**（打在测试文件自己身上＝自证循环，本仓已实锤作废过一次），
      且每条变异**先跑 typecheck 再跑用例**，确认红是"命中目标分支"而非编译错误
      （同一个坑本仓已踩三次）。
      **不做**：不把手写解析重构成真 YAML/Markdown 解析器——那是另一件事，
      收益与风险单独评估（"非阻塞顺便实现"是 plan 膨胀之源，四次实锤）。
    status: pending
  - id: t3-decide-gate-need
    content: >
      **先回答一个问题，再决定要不要做事：整机链已经能抓住这类 bug 吗？**
      已知答案倾向"能"——e5d8a2c4 T4 的 `autocrlf clone → checkGlobal` 正是这么抓到
      第一处的（44 BLOCKER）。若确认它持续在跑，**本项就缩成一行记录，不新增任何门禁**：
      有了系统级防线还叠源码正则门禁属重复设防，且正则门禁必然误报。
      仅当 t1 发现 fragile 面广、且整机链覆盖不到那些入口（例如只在特定 phase 才走到），
      才考虑补最小手段，并须写明"为什么整机链不够"。
      **不做**：不加 `.gitattributes` 全局锁 LF——消费者的 git 配置不受我们控制
      （e5d8a2c4 T4#2 已否决过同类思路）。
    status: pending
isProject: false
---

# 文本读入口 EOL 归一：手写解析的 CRLF 脆弱面收口

## 为什么有这个 plan

2026-08-06，e5d8a2c4 的 T4 整机 smoke 第一次真正跑通（发布件 → 带历史 gitignore
的临时宿主 → commit → `git -c core.autocrlf=true clone` → 在**换机副本**上跑发布件
自带的 `check:global`），当场红：

| 副本 | `check:global` |
|---|---|
| 宿主副本（LF） | **18/18 PASS** |
| autocrlf clone 副本（CRLF） | **61 项 / 44 BLOCKER** |

同一份 zip、同一份代码，只差一次 checkout。根因是
`check-skills-confirmation-ux.ts` 的手写正则锚死在 `\n` 上：
`/\n    options:\n/` 在 CRLF 下遇到的是 `options:\r\n`，恒不匹配。

**该处已在 e5d8a2c4 第六批修复并落回归用例。** 本 plan 处理的是"还有没有别的"。
`core.autocrlf=true` 是 Windows 常见默认，消费者换机 clone 后就会撞上。

## 本 plan 的自我克制（初稿被 codex 驳回的地方，记着别再犯）

初稿写成了"全库 84 处大普查 + 统一 import 同一个归一函数 + 两层归一教条 +
写进工程惯例文档 + 新增静态门禁"。三条问题：

1. **84 处是 grep 命中数，不是缺陷数。** 大半无害，把它们列进表只会让清单注水。
   改成"只找有反例的入口"。
2. **"所有地方 import `normalizeIntegrityTextEol`"会成环**——它所在的
   `framework-integrity.ts` 反向依赖 `canonical-gitignore` / `fidelity-shared`。
   规则应是"口径统一"，不是"共用同一个函数"。
3. **"两层归一"是那一个文件的正确解，不是普适规则。** 第二层之所以需要，是因为
   `lintRegistryOptionsSchema` 是**导出 API 且直接接收外部文本**；内部函数没这问题。

同理，t3 的默认答案是**不新增门禁**：整机链已经证明能抓住这类 bug。

## 与 e5d8a2c4 的关系

- e5d8a2c4 T4#2：**sidecar 自检**的 CRLF 假失败（完整性锚点层）——已闭环。
- e5d8a2c4 第六批：**本类别的第一个实例**（`check-skills-confirmation-ux.ts`）——已闭环。
- 本 plan：这一类的**其余部分**（如果还有）。

## 发布窗口

**3.0.0（用户 2026-08-06 裁定）。** 本 plan 因此是本窗口的发布必做项：
`release:check-plans` 会把未完成 todo 计入阻塞，与 `e5d8a2c4` 等同窗口 plan 同待遇。

顺带记一条门禁机制（曾在本文件上踩过）：`check-plan-version` **只看 `version` +
未完成 todo，不认 `status: draft`**，且扫的是**磁盘文件**（未跟踪也照扫）。
`version > 当前` 时还**必须** `deferred_to === version`
（`scripts/check-plan-version.mjs:74`）。即"待批准"没有专门的表达位——
要么挂本窗口（＝承诺），要么挂下一窗口并写 `deferred_to`。
