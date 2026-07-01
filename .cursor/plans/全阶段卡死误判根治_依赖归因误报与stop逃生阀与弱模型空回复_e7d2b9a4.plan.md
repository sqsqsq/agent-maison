---
name: 全阶段卡死误判根治 — 依赖归因误报 + Stop hook 无逃生阀 + 弱模型空回复
version: 2.4.0
overview: >
  宿主 sq 反馈（2026-06-30，maison 2.3.0，2.4.0 main 同存）：弱模型(GLM)空回复 + Stop hook 无逃生阀
  + 依赖归因误报三层根因叠加，致 agent 约 8 秒空回复死锁、永不闭环。三轮 review 收口，用户已拍板，落 2.4.0。
  **实施完成：typecheck 0 error / unit 1318 pass / fixtures 35 pass。**
todos:
  - id: p0-a-dep-extraction
    content: P0-A hvigor-runner 依赖名提取根治（真实失败行抽取 + 版本碎片黑名单 + 点分SDK白名单 + found 收紧 + 删过宽 pattern）
    status: completed
  - id: p0-b-classify-precedence
    content: P0-B 抽公共 hasDependencyResolutionFailure 门（UT 去重）+ coding 真错优先注释（P0-A 已使 found⟺真实信号，B 实质随 A 修复）
    status: completed
  - id: p1-c-hook-escape-valve
    content: P1-C Stop hook 零进展 signature + consecutive_block_count + K=max_consecutive_blocks 逃生阀(exit 0) + 动作优先文案
    status: completed
  - id: p1-c-config
    content: P1-C config.ts state_machine.max_consecutive_blocks 全链(interface/default/range/validate/normalize/merger/template/hook镜像)
    status: completed
  - id: tests
    content: 单测（依赖提取/SDK过滤/反向断言/真错归类/hook逃生阀+signature parity/T11一致性）+ UT 回归全绿
    status: completed
  - id: p2-device-testing
    content: P2 device-testing 复用公共归因器补可执行指引
    status: completed
---

# 全阶段卡死误判根治 — 依赖归因误报 + Stop hook 无逃生阀 + 弱模型空回复

> 来源：宿主工程 sq 反馈（2026-06-30，maison 2.3.0；现象在 2.4.0 main 同样存在）。
> 现场：`D:\97.log\问题反馈\sq`（image001/002 截图 + maison-diag-20260630-190731：report.txt / transcript.jsonl / hook 拷贝）。
> 宿主：WalletForHarmonyOS，feature=`financialcard-namespace-refactor`，phase=coding，模型=`maas-glm-5.1-zhipu`（GLM 弱模型）。
> 症状：用户反复"继续" → agent 约 8 秒后自动退出，永远闭不了环。
> 范围：用户要求**从根源解决 + 全阶段排查**（spec/plan/coding/review/ut/device-testing），不接受单点补丁。三层根因 A/B/C 全部 ground-truth 核实，并已逐阶段核对传播面（见 §0.5 矩阵）。
> 状态：诊断完成、证据已核实；**待用户 review 后再动手**。

---

## 0. 现场链路（用户可见症状的机制）

state（`report.txt` §state）：`verdict=FAIL`、`blocker_count=9`、`receipt.status=missing` → 阶段未闭环。

transcript 末尾逐条（`transcript.jsonl` 末 40 条）证明的循环：

```
用户「继续」 → assistant: (空 text) → harness 注入「[Your previous response had no visible output...]」
            → assistant: (空 text) → Stop hook 拦一次(exit 2，注入 40+ 行) → assistant: (空 text)
            → 再次 stop 时 stop_hook_active=true → hook 放行 → 退出
```

- 整个"8 秒" = 3~4 个**空回复往返**，模型**完全没干活**。连用户亲自问"为什么 8 秒就退出"也是空回复。
- **空回复的 token 计数实证**（transcript 末尾 6 条 assistant）：`output_tokens=0, input_tokens=0, cache_read=0, stop_reason=end_turn`。正常回合 input 应是 ~177k。`in=0/out=0` 说明 **maas-glm 代理侧直接返回了空 completion**——这是模型/代理侧故障，**根因部分在 maison 之外**（见下因果校准）。
- context 仅 16.9k/200k（8%），**排除上下文溢出**。

→ 这不是单一 bug，而是**三层根因叠加**形成的永久死锁：

| 层 | 根因 | 造成的后果 |
|----|------|-----------|
| A | 编译失败归因被**路径碎片污染**，产出物理上不可执行的 blocker | 当失败**确实源于依赖**时，把能干活的 agent 引向改 oh-package.json5 而非真正缺声明处；本案里它把真实 rollup 语法错盖成依赖未声明 |
| B | 依赖分类**近乎 100% 误报**，真实代码/构建错误被盖成"未声明依赖" | 给错修复方向 |
| C | 交互模式 Stop hook **无卡死检测/逃生阀**，且拦截文案是给强模型的 wall-of-text | 弱模型空回复被永久 nag，唯一出口 `--clear-state` 弱模型永不会执行 |

### 因果校准（两份外部 review 后修订，已逐条核实）
**C 才是消除"本案用户可见症状"的唯一对症修复；A/B 是未来收益。** ground-truth：本跑 9 个 BLOCKER 里依赖误判只占 2 个（coding_hvigor_build / coding_compile），其余是弱模型**真没干活**——`file_completeness`（19 文件缺 5，HuaweiCard/** 整块没建）+ 5× `context_exploration_*`（探索 5 文件/3 搜索 vs 要求 11/8）。**即便 A/B 修好、依赖归因变正确，这一跑仍会因这 6 个真门禁 FAIL，照样触发死锁。** 故：
- **A/B**：根治"误归因"——当失败确实是依赖时不再误导；不承诺"修了就不卡"。
- **C**：根治"卡死循环"本身——无论 FAIL 来自真门禁还是误判，都给弱模型逃生阀。这是性价比最高的一刀（phase-agnostic，一处修复覆盖全生命周期）。
- **空回复**：根在模型/代理（`in=0/out=0` 实证），**maison 改不了**；C.3 缩短文案只能减负、不能根除，**C 的 exit 0 放行才是可靠的框架侧兜底**。plan 不对"消除空回复"做过头承诺。

> 复核中剔除的一处 reviewer 臆测：cursor 提到 `diff_within_scope：376 文件 / 21 越界`，但 summary.json 的 9 个 blocker id **不含 diff_within_scope**（report.txt 里的 "376/越界" 命中均来自内嵌 transcript 的文件编辑 tool_result，非 scope blocker）。核心结论改用真实存在的 `file_completeness` + `context_exploration` 佐证，不引用该未证实细节。

---

## 0.5 全阶段排查矩阵（逐阶段 ground-truth 核对）

| 根因 | spec | plan | coding | review | ut | device-testing |
|------|:----:|:----:|:------:|:------:|:--:|:--------------:|
| **A** 依赖名垃圾提取 | N/A | N/A | ❌ **常态触发** | N/A | ⚠️ 仅真失败时**污染文案** | ✅ 不调用依赖分析 |
| **B** 误分类(依赖盖过真错) | N/A | N/A | ❌ **有** | N/A | ✅ **已修(参照实现)** | ✅ 无分类(裸日志) |
| **C** Stop hook 无逃生阀 | ✅有 | ✅有 | ✅有 | ✅有 | ✅有 | ✅有 |
| 散文裁决子串误判 | ✅清白 | ✅清白 | N/A | ✅**已修** | N/A | ✅**已修** |
| context-exploration 最小阈值 | 自适应 | 自适应 | 自适应 | 自适应 | 自适应 | N/A |

**核对结论（每格都已核实，非臆测）：**
- **A/B 当前直接覆盖 coding/ut**（两者走依赖分析）；**device-testing 当前不受误归因污染**（[check-testing.ts:1490](harness/scripts/check-testing.ts) 不调用依赖分析），要等 P2 接入公共归因器后才受益。spec/plan/review 不编译，A/B 不适用。
- **A 的源头是共享的** [hvigor-runner.ts](profiles/hmos-app/harness/hvigor-runner.ts) `extractDependencyNames` → 修一处，coding 与 ut **同时受益**。
- **B 在 ut 已经是正确实现**（[ut-host-impl.ts:519-528](profiles/hmos-app/harness/ut-host-impl.ts)：要求真实解析失败正则 `hasDependencyResolutionFailure` + ohosTest/main 归属路由），**coding 缺这层** → 修法 = 把 ut 的 gate 移植进 coding（ut 是参照样板）。
- **device-testing 对 A/B 干净**：[check-testing.ts:1490-1511](harness/scripts/check-testing.ts) 失败路径**不调用依赖分析、不产垃圾**，只给裸日志（弱点是引导偏弱，非死锁，列为 P2 增强）。
- **散文裁决子串 bug 已修**：review/testing 现用 [extractDeclaredVerdict](harness/scripts/utils/markdown-parser.ts)（声明行锚定 + 最长优先），即 sibling plan `review超时根因_..._c3f08a21` 的 P0 已落地；spec:758 `.includes` 是术语表覆盖 WARN（非 BLOCKER、非裁决提取），清白。本轮**不重复修**。
- **context-exploration 最小阈值非 bug**（诚实结论）：[exploration-strategy.ts](harness/scripts/utils/exploration-strategy.ts) 有 trivial 豁免 + L1–L4 复杂度 + 复合评分，是**自适应**门禁；宿主那 5 个 `context_exploration_*_min` blocker 对一个 19 文件/17 模块的 refactor 是合理真门禁（弱模型确实没做够探索）。它不是误判，但**会与根因 C 叠加**（弱模型满足不了 → 需要 C 的逃生阀兜底），故不单独改，靠 C 兜底。

---

## 一、根因 A（最深）— 依赖名提取把构建日志**路径碎片**当依赖名
> 传播面：coding（常态触发）+ ut（文案污染）。修 [hvigor-runner.ts](profiles/hmos-app/harness/hvigor-runner.ts) 一处两阶段同治。

### 证据（ground truth）
宿主 `summary.json` 的 `coding_hvigor_build` blocker：
```
classification=project_dependency_undeclared
未声明依赖：@1.0.0-301/oh_modules, @1.0.1/oh_modules, @14.18.3-302/oh_modules,
            @25.0.5-300/oh_modules, ... @hms-paf/ui-widget-avatar-v2, @hw-hmf/address ...
suggestion：agent 须在对应模块 oh-package.json5 补全依赖声明后重跑
```
`@1.0.0-301/oh_modules` 根本不是包名——是 `oh_modules/.ohpm/@<版本号>/oh_modules/...` 的**路径碎片**。让 agent 去 oh-package.json5 "声明 `@1.0.0-301/oh_modules`" 物理上不可能。

### 根因定位
[hvigor-runner.ts:373-382](profiles/hmos-app/harness/hvigor-runner.ts) `extractDependencyNames`：
```ts
const scopedRe = /@[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._\-\/]+)?/g;
```
**实测复刻**（喂入典型 Harmony 日志路径）输出：
```
["@1.0.0-301/oh_modules","@14.18.3-302/oh_modules","@25.0.5-300/oh_modules",
 "@hms-paf/ui-widget-avatar-v2","@hw-hmf/address"]
```
与宿主 summary.json 垃圾**完全一致**。正则对**任意 `@x/y` 子串**通吃，不区分"日志路径里出现"与"真实未解析的 import specifier"。

随后 [hvigor-runner.ts:291-297](profiles/hmos-app/harness/hvigor-runner.ts)：
```ts
for (const dep of dependencies) if (content.includes(dep)) declared.add(dep);
const missingDeclarations = dependencies.filter(dep => !declared.has(dep));
```
垃圾包名当然不在任何 oh-package.json5 里 → 全进 `missingDeclarations`。

且**无任何 SDK/系统作用域过滤**：`@ohos`/`@kit.*`/`@hms*`/`@hw*` 是 SDK 提供、**不该也不能**经 ohpm 声明，却也被算成"未声明依赖"。（核实：依赖逻辑里唯一的 `@ohos` 命中是 UT 命令拼接的 `@ohosTest`，与此无关。）

### P0-A 根治
文件：[hvigor-runner.ts](profiles/hmos-app/harness/hvigor-runner.ts)

1. **只从真实解析失败行提取 specifier**：先逐行筛出命中真实失败信号的行（`Failed to resolve OhmUrl 'X'` / `Cannot find module 'X'` / `Could not resolve 'X'`…），再从这些行的引号/OhmUrl 里抽包名；不再对全日志做 `@x/y` 通配扫描。
2. **版本碎片黑名单**：丢弃 scope 段为纯 semver、以数字开头、或等于 `oh_modules` 的伪包名（`@<semver>/oh_modules`、`@<num>...` 等）。
3. **SDK 作用域白名单——收窄到点分系统命名空间（review 修订，关键）**：只过滤 ohpm **物理上无法声明**的点分 SDK 命名空间 `@ohos.*`、`@kit.*`、`@system.*`、`@arkts.*`；**绝不**用 `@hms-*`/`@hw-*` 连字符通配过滤。
   - 核实依据：现有单测把 `@hms-network/url` 当**可声明 ohpm 依赖**写进 oh-package.json5（[coding-failure-kinds.unit.test.ts:93](harness/tests/unit/coding-failure-kinds.unit.test.ts)、[hvigor-args.unit.test.ts:378](profiles/hmos-app/harness/tests/unit/hvigor-args.unit.test.ts)）。`@hms-paf`/`@hw-hmf`/`@alipay/blueshieldsdk`/`@cfca/*`/`@dcep/*` 都是**真·第三方 ohpm 包**，通配白名单会吞掉真实缺声明、制造新漏报，并破坏现有测试。
   - 真正的根治压在 **A.1 + A.2**：只从"真实解析失败行"抽 specifier + 版本碎片黑名单，本身就不会再误抓 `@hms-paf` 这类路径碎片。白名单只是兜底点分 SDK 命名空间，可配置（denylist 可覆盖）。
4. **`found` 收紧**：[hvigor-runner.ts:316-317](profiles/hmos-app/harness/hvigor-runner.ts) `found = indicators.length>0 || dependencies.length>0` → 改为**必须命中真实失败信号**（`indicators.length>0`）；"仅提取到包名"不足以判定为依赖问题。（用户已拍板接受收紧，§六-1。）

---

## 二、根因 B — 依赖分类近乎 100% 误报，真实代码/构建错误被掩盖

### 证据
宿主 `compile_first_error`：
```
file=CardLifecycle.ets:59
message="Unexpected token (Note that you need plugins to import files that are not JavaScript)"
kind=project_dependency_undeclared
```
这条 message 是 **rollup（ArkTS 构建管线底层）的解析错误**，本质是**真实代码/构建错误**（行 59 语法或导入解析），却被盖成 `project_dependency_undeclared` → 引导 agent 去改 oh-package.json5 而不是回 CardLifecycle.ets:59 改代码。

### 根因定位
1. [hvigor-runner.ts:253-262](profiles/hmos-app/harness/hvigor-runner.ts) `PROJECT_DEPENDENCY_PATTERNS` 里混入了**过宽**的 `/oh_modules/i`（260 行）与 `/ohpm/i`（261 行）。**每个 Harmony 构建日志都含 oh_modules 路径** → `indicators` 恒非空 → `depIssue.found` 恒真。
2. [coding-host-rules.ts:1014-1086](profiles/hmos-app/harness/coding-host-rules.ts) `classifyCodingCompileFailure` **归因顺序缺陷**：依赖启发式（[:1061](profiles/hmos-app/harness/coding-host-rules.ts) `depIssue.found` → `project_dependency_missing`）**先跑**，真实代码错误兜底分支 `project_build`（[:1079](profiles/hmos-app/harness/coding-host-rules.ts)）永远轮不到。`errs`（已解析的真实 error）只在 exit 0 的 `compile_incomplete_output` 分支用过，从不用于短路依赖分类。
3. 于是只要 `missingDeclarations` 非空（被 A 的垃圾撑非空），[coding-host-rules.ts:1273-1282](profiles/hmos-app/harness/coding-host-rules.ts) 把 kind override 成 `project_dependency_undeclared`。

### 参照样板：UT 阶段已是正确实现
[ut-host-impl.ts:518-528](profiles/hmos-app/harness/ut-host-impl.ts) 已经做对了——依赖分支**额外要求** `hasDependencyResolutionFailure`（真实解析失败正则 `Failed to resolve OhmUrl|Could not resolve|Cannot find module|...`）+ `!touchesOhosTest`，并按 ohosTest / 当前模块 src/main 路由到 `ut_code` / `feature_code`。**coding 缺的就是这层 gate。** 本轮 = 把 UT 的判定结构搬到 coding，两边收敛到同一套（避免再次漂移）。

### P0-B 根治
文件：[coding-host-rules.ts](profiles/hmos-app/harness/coding-host-rules.ts) + [hvigor-runner.ts](profiles/hmos-app/harness/hvigor-runner.ts)

1. **移除过宽 pattern**：从 `PROJECT_DEPENDENCY_PATTERNS` 删 `/oh_modules/i`、`/ohpm/i`；只保留真实解析失败信号（`Failed to resolve OhmUrl` / `Cannot find module` / `Could not resolve` / `Unable to resolve` / `Module not found`）。（此项同时修 A.4 的 `found` 恒真。）
2. **真实代码错误优先（移植 UT gate）**：`classifyCodingCompileFailure` 在依赖分支**之前**先判——若 `errs` 含具体 `file:line` 且 message 属语法/解析类（rollup `Unexpected token`、ArkTS 错误码等）且**无 `hasDependencyResolutionFailure`** → 直接 `project_build`，suggestion 指向 file:line 改代码。
3. 仅在"无真实代码错误 + 命中真实依赖失败信号"时才进 dependency 分支。
4. **抽公共归因器（防再漂移）**：把 coding/ut 的"依赖 vs 真实代码错误"判定收敛到一个共享函数（建议落 hvigor-runner.ts 或新 `compile-failure-classify.ts`），coding 与 ut 各自只补阶段专属路由（ohosTest）。符合 [[goal-and-normal-mode-capability-parity]] 的"同能力单一实现"精神。

> 与 [[verify-review-claims-maison]] 一致：A/B 已用实测正则 + 宿主 summary.json + UT 参照实现三向核实，非臆测。

---

## 三、根因 C（系统性）— Stop hook 无卡死检测/逃生阀；弱模型空回复被放大

### 证据 + 定位
[check-phase-completion.mjs:504-508](agents/claude/templates/hooks/check-phase-completion.mjs)：交互模式 Stop hook **唯一**护栏是 `stop_hook_active`（单回合）→ 每个用户"继续"拦一次、放行一次。**没有任何跨回合/跨会话的"同一组 blocker 重复 N 次零进展"计数**，没有自动升级/降级。

后果：
- 唯一出口 `--clear-state`（[buildBlockReason:469-472](agents/claude/templates/hooks/check-phase-completion.mjs)）需要 agent 主动执行；弱模型只会空回复，**永远不会执行** → 永久死锁。
- 拦截文案 [buildBlockReason:440-478](agents/claude/templates/hooks/check-phase-completion.mjs) 是 **40+ 行 wall-of-text**，对 GLM 这类弱模型是负担；与"无可见输出"重试叠加，把模型推向空回复坍缩。框架本为弱模型设计，拦截文案却是给强模型读的。

### 关键 parity 缺口（goal 有、normal 没有）
goal 模式**已有**等价熔断：[goal-runner.ts:1416](harness/scripts/goal-runner.ts) `shouldHaltNoProgress({ priorBlockerSignature, currentBlockerSignature, priorArtifactSnapshot, currentArtifactSnapshot })` → 同 blocker signature + 产物快照无变化 → `halt`（`no_progress_guard`）；signature 落 [goal-runner.ts:1454](harness/scripts/goal-runner.ts)，hard stall 见 [goal-progress.ts:736](harness/scripts/utils/goal-progress.ts)。（行号为 c3f08a21/d7b1e4f2 落地后现值，见 §七 round-4。）
交互模式 Stop hook **完全没有这层**。→ 符合 [[goal-and-normal-mode-capability-parity]]：根治 = 把 goal 的"零进展熔断"移植进 normal 模式 hook。

### P1-C 根治
文件：[check-phase-completion.mjs](agents/claude/templates/hooks/check-phase-completion.mjs)
> **adapter 范围（review 修订）**：仓库当前**只有 Claude adapter 这一个 hook**（`agents/generic/.../check-phase-completion.mjs` 不存在；宿主 materialized=`[claude,generic]`，实际拦截用的就是 .claude 版）。落地只改这一处；动手前先核 adapter 清单，**不要按不存在的 generic 路径实现**。generic 若无 Stop hook 能力则无需对等。

1. **卡死 signature（review 修订：与 goal 同语义的 id 集合，排除 hook 自写字段）**：
   - signature 语义对齐 [goal-failure-classifier.ts:138 `extractBlockerSignature`](harness/scripts/utils/goal-failure-classifier.ts)（= 排序后 `blocker ids.join('|')`），叠加 `last_run_at` 作为更强的"根本没重跑 harness"信号。**不要用 `blocker_count`**——修掉 2 旧 + 引入 2 新时 count 仍是 9，会误判"零进展"；id 集合能正确识别"有变化、继续给机会"。
   - **落地约束（review-2 修订，关键）**：Stop hook 是纯 `.mjs`、**刻意不引入 ts-node**（[check-phase-completion.mjs:117 注释](agents/claude/templates/hooks/check-phase-completion.mjs)；`STATE_MACHINE_RANGES` 也是"hook 端文档同步而非 import"，见 [config.ts:583](harness/config.ts)）。故 **hook 内复刻**这段平凡逻辑（`summary.blockers.map(b=>b.id).sort().join('|')`，hook 本就已读 summary.json），**严禁 import TS 的 `extractBlockerSignature`**（消费者实例无 ts-node 会炸）。两边各一份、**用单测断言 hook signature === goal signature**（防漂移），与现有 grace/ttl 双端同步同款做法。
   - **scope 边界（review-3 记录，刻意简化非遗漏）**：goal 的 `shouldHaltNoProgress` 用 *blocker signature **+** artifact snapshot*（[goal-failure-classifier.ts:212 `artifactsProgressed`](harness/scripts/utils/goal-failure-classifier.ts)）双信号；**hook 版只取 blocker id-set + `last_run_at`**（识别"没重跑 harness 的重复 stop"，正中本案）。本轮**不引入 artifact snapshot**——那是为识别"反复重跑但产物零变化"而设，当前 scope 用不到，留作未来扩展。
   - signature **只能基于 harness 结果字段**（feature/phase/verdict/blocker ids/classification/last_run_at/summary mtime）；**严禁纳入 hook 自己写回的字段**（`updated_at`/`last_seen_at`/`session_id_recorded_at`/`consecutive_block_count`），否则每次 Stop hook 写回都会让 signature 变化 → 逃生阀永久失效。（hook 写回点：[check-phase-completion.mjs:551 maybeUpdateState](agents/claude/templates/hooks/check-phase-completion.mjs)、runner 写回 [phase-state.ts:87](harness/scripts/utils/phase-state.ts)。）
   - 比对：signature 与上次相同 → `consecutive_block_count++`；不同 → 归 1。
2. **逃生阀**：`consecutive_block_count >= K`（K=`state_machine.max_consecutive_blocks`，默认 3，hook 端非法值回落默认）时**不再 exit 2 注入 wall-of-text**，改为输出**极短、动作优先**的升级提示（≤6 行）+ **exit 0 放行**（已拍板，§六-3）：
   ```
   [Stop Hook] 本阶段已连续 N 次零进展（harness 未重跑、blocker 未减）。二选一：
     ① 真正修复后重跑： cd framework/harness && npx ts-node harness-runner.ts --phase coding --feature <f>
     ② 放弃本阶段：     cd framework/harness && npx ts-node harness-runner.ts --clear-state
   已停止重复拦截，控制权交还你/用户。
   ```
   弱模型空回复时不再被永久卡住；用户也不再反复看到"8 秒退出"。
3. **常规拦截也动作优先**：未达阈值时，把"下一步只做这一件事 + 单条命令"放最前面，wall-of-text 收尾。降低弱模型 overwhelm。（注：对 `in=0/out=0` 的代理侧空回复，此项只减负、不能根除——靠第 2 项 exit 0 兜底。）
4. **实现安全注记（review 补充，给用户吃定心丸）**：
   - 计数**在 exit 2 之前**持久化到 state，key 到 `feature+phase`；闭环 allow / verdict=PASS 时清零。
   - **exit 0 放行不改 verdict、不写 receipt**——state 仍 `verdict=FAIL / receipt=missing`，下游阶段门禁照样挡得住，**不存在"绕过闭环"风险**。逃生阀只是停止"对同一死局反复 nag"，不等于放过阶段。

---

## 四、device-testing P2 增强（非死锁，可选）

[check-testing.ts:1490-1511](harness/scripts/check-testing.ts) 的 `device_test_build` 失败只给裸日志，无归因。A 修好后，**复用同一公共归因器**给 device build 失败也加一层 ohmUrl/真实代码错误路由，让弱模型拿到"改哪个 file:line / 装哪个依赖"的可执行指引（而不是 8KB 日志尾巴）。不阻塞主线，排在 A/B/C 之后。

## 五、配套（测试 / parity / 落地）

### 测试（root 配套，防退化）
- [coding-failure-kinds.unit.test.ts](harness/tests/unit/coding-failure-kinds.unit.test.ts) 补：
  - 版本碎片 `@<semver>/oh_modules` **不入** `missingDeclarations`；
  - **点分 SDK 命名空间** `@ohos.*`/`@kit.*`/`@system.*`/`@arkts.*` 被过滤；
  - **反向断言（防过头）**：`@hms-network/url`、`@hms-paf/...`、`@hw-hmf/...`、`@alipay/...` 这类连字符 vendor 包**不被**白名单吞掉，仍可作为真实缺声明上报；
  - 真实语法错误（rollup `Unexpected token`）→ `project_build` 而非 `project_dependency_undeclared`；
  - 日志仅"提及 oh_modules 路径"不触发依赖分类（`found=false`）。
- **UT 回归（硬约束）**：抽公共归因器后，[coding-failure-kinds.unit.test.ts:88](harness/tests/unit/coding-failure-kinds.unit.test.ts) 与 [hvigor-args.unit.test.ts:376](profiles/hmos-app/harness/tests/unit/hvigor-args.unit.test.ts)（均把 `@hms-network/url` 当可声明依赖）+ UT 现有失败分类单测必须全绿——证明收敛未回退已有正确行为。
- hook 单测：连续同 signature N 次 → 第 K 次 exit 0 + 升级文案；signature 变化时计数归 1。

### parity
- normal 模式 hook 与 goal 模式（[goal-runner.ts:1416 `shouldHaltNoProgress`](harness/scripts/goal-runner.ts)）共享**同一套"零进展熔断"语义**。但 signature **不能共享代码**（hook .mjs ⊥ TS）——hook 复刻、TS 各一份，**靠 parity 单测锁一致**（同 grace/ttl 双端同步模式）。
- **先核 adapter 清单**：当前仅 `agents/claude` 有 hook；改前确认是否需在其它 adapter 落对等实现（generic 当前无该 hook，不强行新建）。
- A/B 公共归因器同时服务 coding/ut/(device-testing P2)，单一实现即全 profile 一致。

### 落地顺序（建议）
> 措辞校准（review-2）：A/B **不**解决"本案死循环"——那是 C 的活。优先级仍 P0/P1，但分工写清，别再误导成"修 A/B 就不卡"。
1. **P0-A + P0-B**（共享归因器：改 hvigor-runner + coding-host-rules，把 UT gate 收敛进公共器，一并测）— **根治"编译归因误导"**（失败确属依赖时不再引向错处），同时清掉 UT 文案污染。
2. **P1-C**（hook 逃生阀 + signature + 文案 + config）— **根治全阶段"弱模型空回复死循环"**（本案用户可见症状的唯一对症修复）。
3. 配套测试 + UT 回归全绿。
4. **P2** device-testing 归因增强。
5. 弱模型实测回归（如可在宿主侧复跑一次 coding harness 验证归因变正确、blocker 可执行）。

### P1-C 配套 config 落地清单（review-2 补充，防"只改 hook 漏改消费者"）
新增 `state_machine.max_consecutive_blocks`（默认 3）须**同步**这一串，缺一则 init/update 不回填或双端漂移：
- [config.ts:209 `StateMachineConfig`](harness/config.ts) 接口加字段 + [:577 `DEFAULT_STATE_MACHINE`](harness/config.ts) 默认值 + [:584 `STATE_MACHINE_RANGES`](harness/config.ts) 范围 + [:712/:1023 `validateStateMachine`](harness/config.ts) 校验 + **[:1037 `normalizeStateMachine`](harness/config.ts) 原样透传**（review-3：归一链漏透传 → 新字段会被丢弃，validate 都拿不到）；
- hook 内嵌默认值/范围镜像（与 `HOOK_DEFAULT_*` 同位置）+ **双端一致性单测**（对齐现有 `hook-stale-state.spec.ts` T11 grace/ttl 套路）；
- [config-field-merger.ts](harness/scripts/utils/config-field-merger.ts) / [merge-framework-config.ts](harness/scripts/merge-framework-config.ts) 合并白名单；
- [templates/framework.config.template.json](templates/framework.config.template.json) 模板回填。

> 约束遵循：不擅自切分支（落 main）；不擅自 bump 版本（[[version-bump-only-on-request]]）；本 plan 仅诊断+方案，**待 review 通过、用户通知后再动手**。

---

## 六、取舍点（用户 2026-06-30 已拍板 ✅）

1. **A.4 `found` 收紧** → ✅ **接受收紧**。依赖归因改为"日志必须命中真实解析失败信号（`Failed to resolve OhmUrl` 等）才判依赖问题"；仅提取到包名、无失败信号时回落 `project_build`（仍 FAIL 拦住，只是归因话术指向改代码）。
2. **C 逃生阀阈值 K** → ✅ **默认 3 且可配置**：`framework.config.json` 新增 `state_machine.max_consecutive_blocks`（默认 3，hook 端非法值回落默认，与 grace/ttl 同款 fallback 风格）。
3. **C 放行后语义** → ✅ **exit 0 彻底放行**：达阈值后输出极短二选一提示 + `exit 0`，把控制权交还用户；不再 exit 2，杜绝弱模型空回复被反复拉回。

> 决议已回填到 §一 P0-A.4 / §三 P1-C。落地按 §五 顺序执行。

---

## 七、外部 review 复核结论（cursor + codex，2026-06-30，逐条对 ground-truth 核实）

| # | review 意见 | 核实 | 处置 |
|---|------------|------|------|
| 1 | A/B 解不开本案的环，C 才对症 | ✅ 成立（本跑 9 blocker 中依赖误判仅 2，其余 6 是 file_completeness+context_exploration 真门禁） | **采纳** → §0 因果校准 |
| 2 | 空回复部分在模型/代理侧，非 maison | ✅ 实证（末尾空回复 `in=0/out=0/cacheR=0`） | **采纳** → §0 校准 + C.3 注记 |
| 3 | A.3 `@hms*/@hw*` 通配白名单会吞真实缺声明 | ✅ 实证（现有单测把 `@hms-network/url` 当可声明依赖） | **采纳** → A.3 收窄到点分 SDK 命名空间 + 反向断言测试 |
| 4 | C signature 用 goal 的 `extractBlockerSignature`（id 集合）非 count | ✅ 成立（goal `ids.join('|')`；count 会漏判换血式变化） | **采纳** → C.1 **对齐同语义 signature**（hook 内复刻，**非 import**，见 #8） |
| 5 | signature 必须排除 hook 自写字段（updated_at/last_seen_at…） | ✅ 成立（hook `maybeUpdateState` 每次写 last_seen_at） | **采纳** → C.1 显式排除 + 实现注记 |
| 6 | generic adapter hook 路径不存在 | ✅ 核实（仅 `agents/claude` 有 hook） | **采纳** → C/§五 删"generic 对等"，改为先核 adapter 清单 |
| 7 | exit 0 放行不绕过闭环（verdict 仍 FAIL） | ✅ 成立 | **采纳** → C.4 写明给用户定心丸 |
| — | cursor 称 `diff_within_scope：376 文件/21 越界` | ❌ **未被数据支撑**（9 个 blocker id 不含 diff_within_scope；"376/越界"命中来自内嵌 transcript 文件编辑提示） | **剔除**，核心结论改用真实 blocker 佐证 |

> 两份 review 对 A/B/C 三层根因的 ground-truth 复核结论与本 plan 一致；上述 7 项修订已并入正文。落地顺序与决策不变。

### Round-2 复核（cursor 判定"可进入实施"；codex 补 4 处落地细节，全部核实采纳）

| # | review 意见 | 核实 | 处置 |
|---|------------|------|------|
| 8 | hook 是纯 `.mjs`、刻意不引 ts-node → **不能 import** TS 的 `extractBlockerSignature`，"复用同一函数"表述危险 | ✅ 实证（hook 仅 import `node:*`；config.ts:583 已注明"hook 端文档同步而非 import"） | **采纳** → C.1 改"hook 内复刻同语义 JS + parity 单测"，§五 parity 同步 |
| 9 | §五落地顺序仍写"P0-A/B 止血 coding 永远闭不了环"，与 §0 校准打架 | ✅ 措辞自相矛盾 | **采纳** → 落地顺序改"A/B 治误归因 / C 治死循环" |
| 10 | "A/B 波及三个阶段（含 device-testing）"与"device-testing 不调用依赖分析"措辞冲突 | ✅ 成立 | **采纳** → §0.5 改"A/B 当前覆盖 coding/ut；device-testing P2 后才受益" |
| 11 | `max_consecutive_blocks` 须列全 config 落地清单（interface/default/range/validate/merger/template/双端单测） | ✅ 核实（config.ts:209/577/584/712 + merger + template 齐全） | **采纳** → §五 新增"P1-C 配套 config 落地清单" |
| — | codex"工作区暂无 P0/P1 实现代码" | ✅ 属实——**按工作流尚未动手**（等用户"开工"），非缺陷 | 无需改 plan |

> Round-2 结论：cursor 已判定可实施；codex 4 处均为落地表述/清单收紧，已并入。**plan 至此定稿，无剩余待决项。**

### Round-3 复核（cursor + codex 均判"可进入实施、无阻断意见"；各 1 条非阻断补充，已核实采纳）

| # | review 意见 | 核实 | 处置 |
|---|------------|------|------|
| 12 | config 合并链除 `validateStateMachine` 还有 `normalizeStateMachine`（config.ts:1037），新字段须在此原样透传 | ✅ 核实（`normalizeConfig:1002` 调它；不透传→归一化丢字段→validate 拿不到） | **采纳** → §五 config 清单补 `normalizeStateMachine` |
| 13 | §七旧表第 4 行"采纳→C.1 复用同函数"与 #8"不能 import、hook 内复刻"措辞冲突 | ✅ 易误读 | **采纳** → 第 4 行改"对齐同语义 signature（hook 内复刻，见 #8）" |
| — | codex 提醒：signature 叠 `last_run_at` 只识别"没重跑的重复 stop"；"反复重跑但产物零变化"才需 artifact snapshot，本轮不扩 scope | ✅ 正确（goal 用双信号，hook 刻意取子集） | **记录** → C.1 加"scope 边界"注（刻意简化非遗漏） |

> Round-3 结论：两份 review 一致判定**可进入实施、无阻断异议**；2 条非阻断补充（normalize 透传、表格措辞）+ 1 条 scope 记录已并入。**plan 三轮 review 收口，定稿。**

### Round-4 交叉影响评估（sibling plan `c3f08a21` + `d7b1e4f2` 已落地代码 vs 本 plan）

> 触发：用户提示"本地这两份 plan 改了很多代码"。逐文件核对结论：**对本 plan 无实质影响，仅行号漂移已订正。**

**改动面（已提交）**：`c3f08a21`(e371533f) = 裁决子串修复 + per-phase 超时（check-review/check-testing/goal-runner/goal-timeout[新]/goal-manifest/markdown-parser[新 `extractDeclaredVerdict`]）；`d7b1e4f2`(16a84cff+25f14f18) = phase 内 checkpoint/resume（goal-runner/goal-checkpoint[新]/context-exploration/skills\*.md）。

| 交叉维度 | 核对 | 结论 |
|---------|------|------|
| **文件冲突** | 本 plan 5 个改动目标（hvigor-runner / coding-host-rules / **check-phase-completion.mjs** / config.ts / ut-host-impl）**无一被两 plan 触及** | ✅ 零冲突，无需 rebase |
| **C 参照实现语义** | `shouldHaltNoProgress`(goal-failure-classifier.ts:247) + `extractBlockerSignature`(:138) + `artifactsProgressed`(:212) **该文件未被两 plan 改动**（最后动它的是 fidelity round1） | ✅ 移植参照原封不动 |
| **C signature 的 state 依赖** | checkpoint 写的是 `phases/<phase>/checkpoint.json`（goal 报告目录），**不碰** `.current-phase.json`；`phase-state.ts`（写状态文件）未被两 plan 改 | ✅ 我们读的状态文件 schema 不变 |
| **§0.5"裁决子串已修"** | `extractDeclaredVerdict` 正是 c3f08a21 落地物 | ✅ 我们的"已修"论断由此坐实（正强化，非冲突） |
| **§0.5"exploration 阈值非 bug"** | d7b1e4f2 改的 context-exploration.ts 是 `readContextExplorationInspection` 等**只读** helper（给 checkpoint 派生 skip-list），**未动最小阈值** | ✅ 结论不变 |
| **行号漂移** | goal-runner 因两 plan +151 行：`shouldHaltNoProgress` 1290→**1416**、`blocker_signature` 1328→**1454**、goal-progress hard_stall 733→**736** | ⚠️ **已订正**（§三、§五）；`goal-failure-classifier:138/212`、`check-testing:1490` 仍准 |
| **新增能力互补性** | c3f08a21 给 goal 加了**时间预算**熔断（goal-timeout.ts），本 plan C 给交互模式加**零进展计数**熔断 | ✅ 互补不冲突；交互模式用户自定节奏，**无需**再移植 per-phase 超时 |

> Round-4 结论：两 sibling plan 的改动**扩大**了"goal 有、normal 没有"的 parity 缺口（goal 又多了时间预算熔断），但本 plan C 的 scope（零进展 + 逃生阀）仍是正确的第一步，落地目标与设计**不受影响**，可照常按 §五 实施。

---

## 八、实施记录（2026-06-30，落 2.4.0 main）

**验收命令**：`cd harness && npm test` → **typecheck 0 error / unit 1318 pass 0 fail / fixtures 35 pass 0 fail**（overall exit 0）。

**改动文件（13 个）**：
- 代码：[hvigor-runner.ts](profiles/hmos-app/harness/hvigor-runner.ts)（A + 导出 `hasDependencyResolutionFailure`）、[coding-host-rules.ts](profiles/hmos-app/harness/coding-host-rules.ts)（B 注释）、[ut-host-impl.ts](profiles/hmos-app/harness/ut-host-impl.ts)（B 去重）、[check-phase-completion.mjs](agents/claude/templates/hooks/check-phase-completion.mjs)（C 逃生阀）、[config.ts](harness/config.ts) + [config-field-merger.ts](harness/scripts/utils/config-field-merger.ts) + [framework.config.template.json](templates/framework.config.template.json)（C config 全链）、[check-testing.ts](harness/scripts/check-testing.ts)（P2）。
- 测试：[coding-failure-kinds](harness/tests/unit/coding-failure-kinds.unit.test.ts)、[hvigor-args](profiles/hmos-app/harness/tests/unit/hvigor-args.unit.test.ts)、[hook-stale-state](harness/tests/unit/hook-stale-state.unit.test.ts)（T17–19 + T11 扩展）、[config-field-merger](harness/tests/unit/config-field-merger.unit.test.ts)、[init-update-policy](harness/tests/unit/init-update-policy.unit.test.ts)。
- 文档（review-2/codex 补齐）：[docs/overview.md](docs/overview.md)、[docs/operations/harness-runbook.md](docs/operations/harness-runbook.md) 补 `max_consecutive_blocks` + 逃生阀语义。

**实施期偏差（均已在正文/todo 交代，合理非缺陷）**：
1. **B 走"收紧 found"而非"新增语法错优先分支"**：P0-A 的 `found` 收紧后 coding `depIssue.found` ⟺ 真实解析失败信号，B 的误判随 A 一并修复；只做共享门去重 + 注释，未做整体 `compile-failure-classify.ts` 抽取（关键判据已单一实现，coding/ut 各保留阶段路由）。
2. **A.3 SDK 白名单硬编码** 4 个点分命名空间（`@ohos./@kit./@system./@arkts.`），未做可配置 denylist（plan 标为可选）。
3. **逃生阀 signature 含 `last_run_at`**，只对"没重跑 harness 的重复 stop"生效（正中本案）；"反复重跑但零进展"仍属 goal 的 artifact snapshot 范畴，本轮不扩 scope（§三 C.1 已明示）。

**两轮实施后 review（cursor + codex）结论**：均判可放行、无 P0/P1；codex 两条完整性缺口（文档同步 + must-list 覆盖）已全部补齐。
