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
    status: completed
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
    status: completed
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
    status: completed
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

## 实施记录

### t1-find-fragile-entries（completed，2026-08-12）

**结论：扫描范围内真实 fragile 入口数量 = 0**（基线 `check-skills-confirmation-ux.ts` 除外，已确认闭环）。

- 基线核对：`check-skills-confirmation-ux.ts` 已在原始文本边界归一——`readTextNormalized`
  （:33-35，读盘处经 `normalizeIntegrityTextEol`）＋导出 API `lintRegistryOptionsSchema`
  （:452）与 `lintInitSetupNoFreeText`（:339）双边界归一，不再属于待修项。
- 扫描范围实际存在：`harness/scripts/**`（含 `consumer-golden/`，见下）、`harness/*.ts`、
  `profiles/*/harness/**`（generic 仅 tests/，无生产代码；hmos-app 全量扫）、
  `agents/shared/**`、`scripts/*.mjs` 均按 plan 范围扫描；仅排除 `**/tests/**`、
  `node_modules`。
- 补扫 `harness/scripts/consumer-golden/**`（第一轮误排除，本轮已纳入）：仅
  `evaluate-bc-opencard.ts` 与 `bc-opencard.golden-contract.json` 两个文件。逐读点核对：
  contract/visual-diff/crash/summary/script-report/evidence/install-meta 均为
  `JSON.parse`（行尾无关）；sidecar 为 `.trim().slice(0,64)`（`trim` 吸收 `\r`）；
  `events.jsonl` 的 `split('\n')` + `trim()` + `JSON.parse()`（:165）经最小 LF/CRLF
  实测结果全等（`JSON.parse` 容忍行尾 `\r`、空行 `trim` 跳过、末行无换行形态一致）；
  `:542` 为 `fs.writeFileSync` 输出文本，按输出排除。**consumer-golden 无 fragile 入口。**
- 方法：自写 tokenizer 提取范围内全部含 `\n` 的正则/字符串/模板字面量（491 条去重），
  逐条沿调用链核对输入来源与解析逻辑；对边界候选（ut-file-scope frontmatter、
  git-diff approved_src_mutations 段提取、evidence-tamper `delete[^;\r\n]*must_fix`、
  no-numbered-skill 行扫描、context-exploration Code Facts 段、p0-semantic-gates
  snippet 比对、check-review 表格 cell 切分、consumer-golden events.jsonl）用最小
  LF/CRLF 输入实测等价。
- 主要误报类别（按量排序）：① 输出/消息文本拼接（`join('\n')` 生成 details 等，不解析）；
  ② `split(/\r?\n/)` 显式兼容；③ 读边界已 `.replace(/\r\n?/g,'\n')` 归一；
  ④ token 型正则（`\s*`/`[^\n]`/`[^;\r\n]` 吸收 `\r`，双侧一致）；⑤ 段提取正则的
  `\n` 前是 `\s*`/`[\s\S]*?`（CRLF 仍匹配，捕获尾部 `\r` 由后续 trim/`\s*$` 吸收）；
  ⑥ YAML/JSON 解析（行尾无关）；⑦ 自产内部产物（harness 写 LF 的 JSON/events，
  如 goal-runs/events.jsonl 属 runtime artifact 且 gitignored）与工具进程输出
  （hdc/hvigor 日志，非 git 跟踪）。
- `scripts/*.mjs` 逐脚本按**实际输入来源**核对（不依赖"dev-only"推导）：
  · `check-stale-init-refs.mjs` / `check-stale-deveco-project-guidance.mjs`：读发布内容
    文本，但读边界已 `.replace(/\r\n?/g,'\n')` 归一（:72 区 / :78）；
  · `patch-openspec-artifacts.mjs`：`patchArchiveStep` 的
    ```` ```bash\n   mv ...\n```` 正则锚 `\n`，输入是 `.cursor/`/`.codex/` 命令 md——
    仓根 `.gitattributes` 对该仓强制 `eol=lf`，checkout 必为 LF，故实际输入不可能含
    CRLF；该正则不归一也不构成当前可触发脆弱面（若未来把该脚本挪到消费者侧运行则需重估）；
  · `apply-phase-semantic-prose.mjs`：读仓内 md/yaml/ts 做 `split(/\n## /)` 段裁剪，
    输入同为 LF-enforced 仓文件；且 `\n## ` 是 `\r\n## ` 的子串，模式本身在 CRLF 下
    仍命中；
  · `phase-rename-mechanical.mjs`：`/\|\s*'prd'\s*\n/g` 前有 `\s*` 吸收 `\r`，
    且输入为仓内文件（LF-enforced）；
  · `plan-version-lib.mjs` / `version-evolve.mjs` / `revert-plan-version-bootstrap.mjs`：
    frontmatter 正则已写 `\r?\n`，显式 CRLF 兼容；
  · `verify-release-pack.mjs`：`/^[0-9a-f]{64}\n$/`（:241）是对**自产 zip 内 sidecar**
    的格式断言（pack 以 LF 写入），非外部文本解析；
  · `smoke-consumer-lifecycle.mjs`：生成 fixture 字符串为内存常量，写入→commit→
    autocrlf clone 后由发布件 harness 解析——这正是整机链的 CRLF 覆盖面，不属"解析
    侧脆弱"。
- 范围外备注（不计数）：`agents/claude/templates/hooks/**` 不在 plan 写定范围
  （`agents/shared/**`），抽查其被标注行均为输出拼接，未见同类脆弱面；如需可另开变更。
- 对 t2/t3 的影响（**t1 完成当时的历史状态**）：t1 记录完成时 t2/t3 尚为 pending，
  故当时建议"t2 保持 pending、由用户裁定 cancelled 或直接关闭"，且本 plan 因 t2/t3
  pending 阻塞发布门。后续已按用户裁定完成，见下方 t2/t3 记录。
- 验证：`node scripts/check-plan-version.mjs`、`git diff --check` 均通过；未跑全量测试。

### t2-fix-with-counterexamples（completed，2026-08-12）

按空清单完成，**未修改任何生产代码、未新增测试/归一化工具/OpenSpec change**：

- t1 待修清单为空（扫描范围内真实 fragile 入口 = 0，基线 `check-skills-confirmation-ux.ts`
  已闭环）；
- "按清单逐项收口"实际为零项——没有需要归一化的读边界；
- 没有可构造的生产缺陷反例，因此无需修改代码或新增回归测试；
- **这是任务完成，不是任务被放弃**：t2 的验收（逐项 CRLF 反例用例 → 红 → 改边界 → 绿）
  在空清单下无对象可执行，todo 标记 `completed` 而非 `cancelled`。

### t3-decide-gate-need（completed，2026-08-12）

静态接线核实（未重新执行分钟级整机 smoke，未修改任何脚本/测试）。以下事实均已逐一核对：

- `scripts/smoke-consumer-lifecycle.mjs`：
  - `stageClone`（:327-331）用 **`git -c core.autocrlf=true clone -q`**（配置挂在 clone 上，
    作用于 checkout）；
  - clone 后（:350-360）读探针 `RELEASE-MANIFEST.json`，**断言字节含 `\r\n`**
    （`raw.includes(Buffer.from('\r\n','utf-8'))`），通道未生效（纯 LF）时
    **throw fail-closed**，用例 #2 不会"没验就绿"；
  - `stageCheckGlobal`（:393-399）在 **clone 出来的消费者副本** `framework/harness` 里跑
    发布件自带的 **`npm test`（= check:global）**（执行根由 `stageDepsClone` 切到 clone，
    见 :657-659 注释与单测 :126-135 的顺序断言）；
  - `STAGES`（:661-670）顺序 =
    `install→depsHost→commit→clone→depsClone→integrity→checkGlobal→goal`，
    含 **clone → integrity → checkGlobal** 且均在 depsClone（执行根切换）之后。
- 发布流程仍实际调用该 smoke：
  - `scripts/release-all.mjs`（:79-90）：对 **staged zip（同一字节）** 跑
    `smoke-consumer-lifecycle.mjs --zip stagedZip`，通过后才 `rename` 到 dist/ 正式名
    （注释明示"smoke 通过后才允许 rename，避免 pack→verify→直接进 dist 绕过整机闭环"）；
  - `scripts/candidate-release.mjs`（:120-129）：candidate build 时对**同一字节 zip** 跑
    该 smoke，通过后才写 `manifest.candidate.complete = true` +
    `smoke_checked_at`（smoke 失败保留 complete=false）；`promote` 入口（:177-179）在
    `complete !== true` 时直接拒绝，"禁止 promote"；
  - 根 `package.json`（:16）`release:smoke-consumer` 入口仍存在。
- `harness/tests/unit/smoke-lifecycle-registry.unit.test.ts` 仍提供秒级结构守卫：注册表
  连续无空洞（含 #8）、covered 必须指向真实存在的 stage、STAGES 顺序钉死
  `install→depsHost→commit→clone→depsClone→integrity→checkGlobal→goal` 且
  clone 后切执行根、历史 .gitignore 夹具、goal-driver layout 派生边界。

**结论**：t1 未发现新的 fragile 入口；现有整机链已经覆盖 autocrlf clone 与 clone 副本上
的发布件检查（check:global 在 CRLF 化副本上真跑，且 CRLF 通道本身 fail-closed 断言）；
新增静态正则门禁只会形成重复设防和误报面；**t3 决策为"不新增门禁"**（与 plan 正文
"若确认它持续在跑，本项就缩成一行记录"一致）。未加 `.gitattributes`
全局锁 LF（消费者 git 配置不受我们控制，e5d8a2c4 T4#2 已否决同类思路）。

- 验证：`node scripts/check-plan-version.mjs`、`git diff --check` 均通过；
  `npm run release:check-plans` 已执行：整体因其他 8 个在研 plan 未完成而预期 FAIL，
  `b6d3f7a1` 已退出阻塞列表。未跑全量测试/typecheck/E2E/真实 consumer smoke。
