---
name: 发布件提速 — ts-node 冗余类型检查根治 + 发布编排去重 + filter 短路（v2 已纳 review）
version: 2.4.0
overview: >
  用户反馈"打个发布件前后十几分钟"。逐步实测拆解：脚本纯计算 ≈ 2 分钟，十几分钟的大头是 agent 把测试丢后台 +
  3 分钟粗轮询放大了墙钟。脚本侧统一根因：ts-node 在多条执行路径上重复做全量类型检查（顶层 test:unit/test:fixtures、
  release:verify 的 npx ts-node ×4、init-orchestrate/goal-progress 每 case spawn 的 ts-node 子进程 N 次），而
  typecheck(tsc --noEmit) 已是独立把关步骤。经 cursor/codex 两轮 review + 本轮受控复测校准后定稿：
  (1) 类型安全对 tests 目录**并非零损失**——tsconfig.typecheck.json 排除了 tests，需补 test-inclusive typecheck 才真零损失；
  (2) 收益按受控 A/B 复测重估——init-orchestrate 21.5s→10.9s、goal-progress 8.6s→4.1s（**减半，非归零**，剩余是
  per-case 子进程启动固定开销）；visual-fidelity 是 `node -e` 跑 Jimp、**不吃 TS_NODE**，从 ts-node 归因拆出另议；
  (3) 落地改 env 单杠杆（主进程 flag + 子进程继承 env），一处覆盖所有子进程；(4) 发布聚合固定为 pack→verify --zip。
  脚本去冗余省 ~40s，真正把"十几分钟"打下来的是 P4 前台单命令不再后台粗轮询。不触 harness-runner 生产运行时，
  goal 与普通模式 gate 能力零影响。待 review 后动手。
todos:
  - id: diagnosis
    content: 发布链路逐步实测 + 受控 A/B 复测（证伪初诊假象数据，见 §0/§7）+ 统一根因定位
    status: completed
  - id: p0-transpile-lever
    content: P0 transpile-only 单杠杆——顶层 test:unit/test:fixtures 加 --transpile-only（主进程）+ run-unit/run-tests 首个 import `tests/utils/transpile-only-env`（spawn 前设 env，子进程继承，一处覆盖所有 per-case 子进程）；强约束 typecheck 先跑
    status: completed
  - id: p1-typecheck-tests-coverage
    content: P1 让 typecheck 覆盖 tests（改 tsconfig.typecheck.json：去 `**/tests/**` exclude、加 `**/fixtures/**`）——偏离 plan 原案（独立 tsconfig.test.json），因实测合并进一个 program 仅 ~4s（独立 ~9s）；真零损失（注入测试文件类型错误已验证被抓）
    status: completed
  - id: p2-release-verify-dedup
    content: P2 release:verify 4 个 npx ts-node 加 --transpile-only；typecheck 加 --skip-typecheck；verify 加 --zip <path>+--manifest 校验已 pack 产物，不再自 pack→extract
    status: completed
  - id: p3-filter-shortcircuit
    content: P3 filter 双语义——抽 selectSuites 到 tests/utils/select-suites.ts（避开 run-unit main 副作用）+ 单测 run-unit-filter（4/4 PASS）+ 注册；suite-id 命中短路（实测 --filter agent-invoke-settle 2.1s），否则回退 case-name
    status: completed
  - id: p4-release-aggregate
    content: P4 新增 scripts/release-all.mjs 前台串联 check-plans→typecheck(一次)→test→pack(staging)→verify(--skip-typecheck --zip)→promote 到 dist（失败不残留）；AGENTS.md runbook 更新去后台粗轮询
    status: completed
  - id: p5-visual-fidelity-optional
    content: P5（可选/降级）visual-fidelity 的 `node -e` Jimp PNG 生成子进程优化——本轮不做（与 ts-node transpile 无关，收益 ~7s，风险另评）
    status: cancelled
  - id: tests
    content: 回归——干净 npm test 1399+35 全 PASS（typecheck 含 tests fail-fast 已验证）；filter 双语义单测 run-unit-filter 4/4；未加计时软门禁（避免脆弱，改由 runbook 约束）
    status: completed
---

# 发布件提速 — ts-node 冗余类型检查根治 + 发布编排去重 + filter 短路（v2）

> 来源：用户反馈"为什么现在打个发布件这么长时间，前后十几分钟，有没有优化空间"。
> 状态：诊断 + 受控复测完成，已纳 cursor/codex 两轮 review（§7 逐条核实记录）；**待用户 review 后再动手**。
> 关联记忆：[[verify-review-claims-maison]]（本轮 review 逐条对 ground-truth 核实，证伪了自己的初诊数据）、[[goal-and-normal-mode-capability-parity]]（测试/发布基建，不触 gate 能力）、[[surface-plan-deviations-immediately]]。

---

## 0. 实测基线（ground truth，Windows 本机）

发布链路 = `release:check-plans` → `npm test`(= `typecheck && test:unit && test:fixtures`) → `release:verify` → `release:pack`。

| 步骤 | 实测 | 备注 |
|---|---|---|
| `release:check-plans` | ~2s | 快 |
| `npm test` → `typecheck` (tsc --noEmit) | 2.6s | 全量类型检查，快 |
| `npm test` → **`test:unit`** | **74s** | ⬅ 最大头 |
| `npm test` → `test:fixtures` | 19s | 35 fixture |
| `release:verify` | ~20–30s | 内含**又一次** typecheck + 4× `npx ts-node` 冷启 + 打 zip 到 temp 再解压重扫 |
| `release:pack` (zip lvl9) | 1.8s | zip 本身不慢 |

**纯计算 ≈ 2 分钟。** 十几分钟墙钟差额 = agent 把测试丢后台 + `Waited 3m` 粒度轮询（截图佐证）。**⇒ 脚本优化只能省那 ~2min 里的一部分；真正把"十几分钟"打下来的是 P4 编排层不再后台粗轮询。此框架不可夸大脚本收益。**

### 0.1 受控 A/B 复测（校准收益，替代不可信的初诊全量数据）

> ⚠️ 初诊用"全量顺序跑 + 逐 suite 计时"得到 init-orchestrate/goal-progress/visual-fidelity 在 transpile 下"<1.5s"——经 codex 质疑后做**单独受控 A/B 复测**，证明那是全量顺序跑的缓存/warm 假象。**以下受控数据为准**（[[verify-review-claims-maison]] 硬学习：性能归因必须单独 A/B，不能信全量顺序 per-item 计时）。

对 3 个热点 suite 各拆 `require`(主进程编译) 与 `runAll`(执行含子进程)，在 `TS_NODE_TRANSPILE_ONLY` off/on 下各测：

| suite | require | runAll (off) | runAll (on) | 子进程 transpile 收益 | 剩余耗时性质 |
|---|---:|---:|---:|---:|---|
| **visual-fidelity** | 0.4s | 7.40s | **7.37s** | **≈0** | `node -e` 跑 Jimp，**不吃 TS_NODE**；OCR/PNG 生成本身 |
| init-orchestrate | 0.3s | 21.54s | **10.94s** | ~10.6s | 剩 10.9s = 71 case × ts-node 子进程**启动固定开销** |
| goal-progress | 0.1s | 8.57s | **4.05s** | ~4.5s | 剩 4.0s = 47 case × 子进程启动开销 |

顶层实测：`test:unit` 74s（默认）→ **53.5s**（`TS_NODE_TRANSPILE_ONLY=1` env，主+子进程都 transpile）；`test:fixtures` 19s→16s。

**诚实结论**：
- transpile-only 让 init-orchestrate/goal-progress **减半**（子进程不再全量类型检查），但**剩余启动固定开销砍不掉**（归零需把 per-case 子进程改 in-process，属高风险重构，见 §4 Rejected）。
- **visual-fidelity 与 ts-node transpile 无关**，从本根因拆出，单列 P5 可选另治。
- 顶层 53.5s 的收益里，~15s 来自子进程 transpile（必须让子进程也 transpile，见 §3），其余来自主进程编译加速。

---

## 1. 统一根因 + 类型安全的真实边界

**根因**：类型检查散落在多条 ts-node 执行路径上重复做，而 `typecheck`(tsc --noEmit) 已是独立把关步骤。`--transpile-only` 只跳过类型检查、不改运行语义。

| 冗余点 | 次数 | 归属 |
|---|---|---|
| test:unit / test:fixtures 主进程 | 2 | P0 |
| init-orchestrate/goal-progress per-case ts-node 子进程 | N（71+47） | P0（靠继承 env） |
| release:verify 内 `npm run typecheck` | 1（与 npm test 重复） | P2/P4 |
| release:verify 内 `npx ts-node` × 4 | 4 | P2 |

**⚠️ 类型安全并非"对一切零损失"（review 核心修正）**：`tsconfig.typecheck.json:13` 显式 `exclude: ["**/tests/**"]`——typecheck **不覆盖** `run-unit.ts`/`run-tests.ts`/`*.unit.test.ts`。目前测试文件的类型检查**唯一发生地**就是 test:unit 全量 ts-node 那次。一旦 P0 改 transpile，**测试文件的类型错误将无人拦截**。
- 对**被跑的源码**（scripts/、harness/**，在 typecheck include 内）：零损失成立。
- 对**测试文件自身**：不成立。测试文件 dev-only、不进发布件，但不能叫"纯冗余"。
- **对策（P1，采纳 cursor 方案 A）**：加 `tsconfig.test.json`（extends 主 config，`include` 含 tests），在 `npm test` 与 `release:all` 各跑一次 `tsc --noEmit -p tsconfig.test.json`——**真零损失**，成本仅一个 tsconfig + 链路一步。

---

## 2. 分层治理

### P0 — transpile-only 单杠杆（主进程 flag + 子进程继承 env）

**为什么是"单杠杆"而非纯 CLI flag**（review 修正）：codex 实测 `node ts-node/dist/bin.js --transpile-only -e "process.env.TS_NODE_TRANSPILE_ONLY"` 输出 `<unset>`——**父进程 CLI flag 不传子进程**。故仅给顶层 script 加 `--transpile-only` 只加速主进程，init-orchestrate/goal-progress 的子进程（另起 node）不受益（大头拿不到）。§0.1 的 53.5s 是用 **env** 测的（子进程继承 env 才 transpile）。

**改动**（零新依赖、跨平台）：
1. `harness/package.json`：`test:unit`/`test:fixtures` 加 `--transpile-only`（主进程）。
2. `run-unit.ts`/`run-tests.ts` 让**所有** per-case 子进程（继承 env）走 transpile：`process.env.TS_NODE_TRANSPILE_ONLY ??= '1';`（`??=` 保留外部显式覆盖）。**关键落地细节（cursor 提醒）**：ES `import` 被 hoist，写在 import 之后的赋值未必先于某 import 的 load 期副作用生效——故做成独立副作用模块 `tests/utils/transpile-only-env.ts`（内容仅这一行），在 run-unit/run-tests 的**第一个 import** 位置 `import './utils/transpile-only-env';` 引入，保证最先执行。一处覆盖所有 spawn helper，**无需逐个改 init-orchestrate/goal-progress**。（本仓 spawn 均在 case 函数体内、非 load 期，现状已安全；此写法是防御性加固。）
3. `test` 顺序 `typecheck && test:unit && test:fixtures` 保持，加注释锁定（typecheck 先跑是类型安全前提）。

> 备选：加 `cross-env` 依赖用 `cross-env TS_NODE_TRANSPILE_ONLY=1 ts-node ...` 一个开关覆盖主+子（cursor/codex 均提）。**否决**：为省一处代码引入运行时依赖不划算；现方案（flag+顶部 env）零依赖已达同效。

**验收**：`test:unit` 74s→~53s；init-orchestrate/goal-progress runAll 减半（受控口径 21.5→10.9 / 8.6→4.1）；故意注入源码类型错误 → `npm test` 在 typecheck 步 fail-fast。

### P1 — 补 test-inclusive typecheck（填平 tests 覆盖缺口）

新增 `harness/tsconfig.test.json`（extends 主 config），`test` 脚本改为
`typecheck && typecheck:test && test:unit && test:fixtures`（或合并成一次覆盖全部的 typecheck）；`release:all` 同跑。

**include 必须覆盖 profile 单测（codex 提醒）**：`run-unit.ts` 动态发现 `profiles/*/harness/tests/unit/*.unit.test.ts`，这些测试文件现也靠非 transpile 的 ts-node 顺手类型检查，transpile 后会漏。故 include 写全：
```jsonc
"include": ["./tests/**/*.ts", "../profiles/*/harness/tests/**/*.ts"]
```
（codex 已用临时 tsconfig 按此范围实测 `tsc --noEmit` 当前能过——不是大改，只是把"真零损失"的覆盖范围写准。）

**验收**：故意在某 `*.unit.test.ts` 写类型错误 → `npm test` 在 typecheck 阶段 fail（transpile 不再吞测试文件类型错）。

### P2 — release:verify 去冗余（`verify-release-pack.mjs`）

1. 4 个 `npx ts-node scripts/check-*.ts`（:252/:261/:341/:350，catalog + skills-index × source+extracted）加 `--transpile-only`（typecheck 已在本脚本最前 :242-248 兜过）。
2. `npm run typecheck`（:243）加 `--skip-typecheck` 开关：默认仍跑（单独调用安全），聚合链路（P4）传入去重。
3. **verify 复用已 pack 产物**：新增 `--zip <path> --manifest <path>`，让 verify 直接解压+断言外部 zip，不再自 `packRelease`→extract。**注意 sidecar 依赖**（cursor 提）：`assertInZipManifest(frameworkRoot, manifestPath)` 需 dist sidecar `framework-<v>.manifest.json`，`--zip` 模式须一并接收/推导该路径喂入。无参调用保持现自包含行为不变。

**验收**：`release:verify --zip dist/framework-<v>.zip --manifest dist/framework-<v>.manifest.json` 对既有产物过全部断言；无参调用行为不变。

### P3 — run-unit filter 加 suite 短路（保 case-name 老语义）

**定位**：`run-unit.ts:185` 现语义是 **case-name 过滤**（`all.filter(r => r.name.includes(filter))`，示例 `--filter parseHypium`），但先 `runAll()` 跑满所有 case 再过滤显示——`--filter __nonexistent__` 仍跑满 74s。`run-tests.ts:47-52` **已在 target 层短路**（按 fixtureDisplayName/路径），无此 bug——仅核对不动。

**改动**（双语义，不破坏老用法，cursor/codex 一致建议）：
- filter 命中任一 `suite.id.includes(filter)` → **只跑这些 suite**（跳过其余 suite 的 require+runAll），秒级。
- 无 suite id 命中 → 回退**现有 case-name 全量过滤**（保 `--filter parseHypium`）。
- 抽 `selectSuites(filter, suites)` 纯函数便于单测。

**验收**：`--filter goal-progress`（suite id）只跑该 suite、秒级；`--filter parseHypium`（case 名）行为不变；无 filter 全量不变。

### P4 — 发布聚合 `release:all` + runbook

**顺序固定为 pack→verify**（review 修正 frontmatter/P4 原措辞把顺序写反）：
`check-plans → typecheck(一次) → typecheck:test → test:unit → test:fixtures → pack(到 temp/staging) → verify(--skip-typecheck --zip) → promote 到 dist/`。
- **失败不留"看似可发布"产物**（codex 加强建议）：先 pack 到临时/staging，verify 通过后再 promote（move）到 `dist/`；任一步失败即不 promote。
- runbook（README 或 MAINTAINER 文档）：发布用单条 `npm run release:all` 前台跑，**勿丢后台再 3 分钟轮询**。

**验收**：`release:all` 端到端一次跑通，产物 = `dist/framework-<v>.zip` + manifest，与现流程等价；中途失败时 dist/ 无残留新产物。

### P5 — （可选/降级）visual-fidelity PNG 子进程优化

与 ts-node transpile **无关**。`writeMinimalColorPng`（:98）每 fixture `spawnSync(node, ['-e', jimp...])`。可选：改 in-process 用 jimp 生成 / 缓存生成结果。收益 ~7s，但涉及 jimp 主进程 require 权衡与 OCR 路径，**风险另评，本轮可不做**。

### tests — 回归 + 计时基线

- 双 fail-fast：源码类型错 → typecheck 拦；测试文件类型错 → typecheck:test 拦。
- 结果不变：transpile 前后 test:unit/test:fixtures 的 PASS/FAIL 计数一致。
- filter 双语义单测：`selectSuites` 对 suite-id 命中/回退 case-name 两路径断言。
- verify --zip 等价：对同一 zip，`--zip` 路径与自包含路径断言集一致。
- （可选软门禁）test:unit 计时上限告警，防退化回全量 typecheck。

---

## 3. 落地方式抉择（供 review）

- **transpile-only：主进程 CLI flag + 子进程继承 env**（不改全局 tsconfig `ts-node.transpileOnly`）。理由：全局 config 会波及 harness-runner **生产运行时**（consumer 侧真实跑 check 的路径），移除其运行时类型兜底、改变默认行为，面过大。CLI flag + 顶部 env 精准锁定测试/发布路径。
- **子进程走"顶部 `process.env` 设一次"而非逐 spawn helper 注入**：一处覆盖所有 per-case 子进程（init-orchestrate/goal-progress/其余），改动最小、不易漏。

## 4. Rejected / 降级备选

- **per-case 子进程改 in-process**（消除剩余 10.9s/4.0s 启动开销）：子进程正为隔离 env/cwd/cache 而设，改 in-process 隔离风险大、收益 ~15s 不及风险。**不做**（transpile 已减半）。
- **预编译成 JS 跑**（压主进程加载）：引入 build 产物生命周期复杂度，与 ts-node 直跑生态冲突。**降级可选后续**。
- **worker/子进程分片并行 test:unit**：多 suite 共享 process.env/cwd/全局 cache，并行串台风险高。**不做**。
- **cross-env 单杠杆**：为省一处代码加运行时依赖，不划算。**不做**。
- **zip level 9→6**：pack 仅 1.8s，收益微小。**不改**。

## 5. 风险与回滚

- 风险：某测试靠 ts-node 运行时类型报错做断言。**对策**：动手前 grep 复核（初查未见，测试均为运行时行为断言）。
- 风险：`test` 顺序被后人打乱致 typecheck 不先跑。**对策**：注释锁定 + tests 双 fail-fast 回归。
- 回滚：全部为 package.json script / tsconfig / 测试顶部一行 env / 发布脚本参数，`git revert` 即回原状，无数据迁移。

## 6. 预期收益（诚实口径）

| 项 | 现状 | 预期 | 依据 |
|---|---:|---:|---|
| test:unit | 74s | ~53s | env 实测；init/goal 减半，visual 不变 |
| test:fixtures | 19s | ~16s | 实测 |
| release:verify | 20–30s | ~10s | transpile + 不重复 pack/typecheck |
| **发布端到端墙钟** | **十几分钟** | **≤ ~3min** | **主要靠 P4 前台单命令不轮询**（脚本本身只省 ~40s） |
| dev 单 suite 迭代 | 74s | 秒级 | filter suite 短路 |

## 7. review 核实记录（cursor + codex，逐条对 ground-truth）

| review 论断 | 核实 | 处置 |
|---|---|---|
| typecheck 排除 tests，"零损失"对测试文件不成立 | ✅ `tsconfig.typecheck.json:13` exclude `**/tests/**` | 采纳方案 A → **P1** 补 test-inclusive typecheck |
| visual-fidelity 是 `node -e` Jimp，不吃 TS_NODE，无 transpile 收益 | ✅ `visual-fidelity.unit.test.ts:98` + 受控复测 7.40→7.37s | 从 ts-node 归因**拆出** → **P5** 可选另治 |
| CLI flag 不传子进程；§0.2 的 53.5s 是 env 测的，措辞误导 | ✅ 复测确认；53.5s = env | 改 **P0 单杠杆**（主 flag + 子 env 继承），§0.1/§3 措辞修正 |
| init-orchestrate/goal-progress "<1.5s" 过度乐观 | ✅ 受控复测 21.5→10.9 / 8.6→4.1（减半非归零） | §0.1 用受控数据，标注剩余启动开销 |
| release:all 顺序应 pack→verify（frontmatter/P4 写反） | ✅ 原措辞矛盾 | **P4** 统一 pack→verify，加 promote 防残留 |
| verify --zip 需 sidecar manifest 路径 | ✅ `assertInZipManifest` 需 manifestPath | **P2** 补 `--manifest`/推导 |
| filter 现语义是 case-name（`--filter parseHypium`），非 suite id | ✅ `run-unit.ts:185` + README:173 | **P3** 双语义：suite-id 短路 + 回退 case-name |
| run-tests.ts 已短路，无同款 bug | ✅ `run-tests.ts:47-52` | **P3** 改为"仅核对不动"（原 plan 说"对齐"有误） |
| 初诊全量 per-item 计时不可信 | ✅ 受控 A/B 证伪 | 记入 [[verify-review-claims-maison]] 硬学习 |
| （2 轮）transpile env 行须早于 import load 期副作用 | ✅ ES import hoist；本仓 spawn 在函数体内现状安全 | **P0** 做成 `tests/utils/transpile-only-env.ts` 首个 import 引入（防御加固） |
| （2 轮）tsconfig.test include 须含 profile 单测 | ✅ run-unit 动态发现 profiles/*/harness/tests/unit；codex 实测该范围 tsc 能过 | **P1** include 写全 `../profiles/*/harness/tests/**/*.ts` |
| （3 轮）release-all `run()` 失败 process.exit 致 staging 残留 | ✅ 清理原只在成功路径 | **P4** 改 try/finally 包 pack→verify→promote，失败也清 staging |
| （3 轮）release-all `spawnSync(shell:true)` DEP0190 + 路径注入 | ✅ | **P4** 改 `process.execPath` 直调 ts-node/tsc JS 入口 + shell:false（绕开 npm/.cmd） |
| （3 轮）verify `--zip/--manifest` 缺值静默吞 | ✅ `--zip --manifest x` 会误当路径 | **P2** parseVerifyArgs 缺值/未知参数 fail-fast（exit 2）；3 种误用已验证 |
