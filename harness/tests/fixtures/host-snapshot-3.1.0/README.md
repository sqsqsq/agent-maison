# host-snapshot-3.1.0：上一版宿主快照（plan b2d7f4e9 §6 / t4）

`project/` 是**上一版代码原样产出**的合成宿主：一个宿主里有两个已经完成的 Feature。快照只证明机械行为，不替代宿主语义验收。

## 钉住的产出

- **产出代码**：main `91aab353`，生产代码未改；只加了测试侧的 CU 绑定链驱动。生成时间 2026-09-25。
- **生成根**（写进产物里的绝对路径前缀）：`C:\Users\shengqsq\AppData\Local\Temp\real-chain-IojIur`。

| Feature | 类型 | 链 | completion run | 身份 |
|---|---|---|---|---|
| `demo-card` | 平铺 | spec→plan→coding→review→ut→testing | `20260925T043142Z-233c9c` | — |
| `cu-bGVkZ2VyLWFwcC1ibHVlcHJpbnQAbGVkZ2VyLXJlZnJlc2g` | CU 绑定 | coding→review→ut | `20260925T043336Z-8e78e2` | blueprint `ledger-app-blueprint` rev 2；CU `ledger-refresh` rev 1（component `ledger`） |

- **CU 目录**：`doc/features/ledger-app-blueprint/ledger-refresh/`。
- **CU 施工落点**：`src/ledger/LedgerFeature.ets`；测试落点：`src/ledger/src/ohosTest/ets/test/LedgerFeature.test.ets`。
- **为什么放在产品源码根之外**：平铺 Feature 的完成凭证绑定全量产品源码 inventory，两个 Feature 的改动若都落在模块根里，两份凭证会互相作废。
- **规模**：265 个文件，约 2.2 MB（实际字节）。文本文件全部 LF，node 扫描 crlf=0；PNG 两张。

## 命令（在 harness/ 下运行）

```bash
npx ts-node --transpile-only tests/fixtures/host-snapshot-3.1.0/generate.ts --verify   # 旧 gate 失效 → 正式迁移 → goal-status
npx ts-node --transpile-only tests/fixtures/host-snapshot-3.1.0/generate.ts            # 重生成（只能在钉住提交上跑）
```

- **生成器**：复用 `real-chain.unit.test.ts` 的 `seedCuBoundHost`、`runDemoCardChain`、`runCuBoundChain`、`goalStatusFeatureLine`，两条链都经 `runGoalRuntimeChain(realHarness)` 真跑。
- **生成根原址自检**：两个 Feature 都判 `verify=VALID` 后才捕获快照。
- **`--verify`**：把快照复制到仓外 tmp 根，provision **当前**框架，先准确识别旧 review 指纹失效，再按 [MIGRATION.md 的 c6a3d918 步骤](../../../../MIGRATION.md#310review-规则变化后的证据重验c6a3d918) 对两个 Feature 走既有正式 successor/真实 harness/完成核验，最后经 `goal-status` 判当前完成。旧 `project/` 与 completion 原件保持，不重生成。

## c6a3d918：显式迁移前提

`loadHostSnapshot()` 仍只装入原快照；当前规则下历史记录可为 `record=ok`，review 义务却是 uncovered，不能继续假定无重验即 VALID。独立用例同时检查这两个事实和旧原件字节不变。

恢复/预算/评估用例需要当前完成时，显式调用 `migrate.ts::loadMigratedHostSnapshot(features)`。它仅在测试副本用原 requirement 与可信完成 run 起 successor，真跑当前 review gate/闭环并生成新 completion；fresh 阶段照核复用，未手写 PASS 或修补哈希。每个 worker/所需 Feature 集合只准备一次，再给各用例隔离副本；这不是生产缓存，也不改变原加载器。

快照排除了 `.git`，无法提供原 Git 对象：测试副本建立实际 Git 基线，使用既有、带新 run 审计的 `--rebaseline-to <exact HEAD>`，不编辑旧 manifest。准备生成的 Git 随测试副本复制，以保持新基线可达；真实宿主历史可达时不需要 rebaseline。agent/verifier 传输与设备仍是既有测试替身；当前 gate/closure 与 completion 是生产路径产物，prior PASS 复用时照实保留语义未重验披露。

## 重生成规则

快照是发布门的兼容基线（`lifecycle-evolution` L0，见 [发版清单](../../../../docs/operations/release-checklist.md)）。

- **何时重生成**：只在有意的破坏性变更之后，且 `MIGRATION.md` 已登记宿主可执行的迁移步骤、在旧快照上按该步骤迁移后 L0 已重新为 true。
- **不得**在没有迁移路径时为了让 L0 变绿而重生成——那是掩盖回归。L0 转红的默认处置是修回归。
- **怎么做**：
  1. 在**目标提交**（新基线对应的框架版本）的干净工作树上，于 `harness/` 下运行 `npx ts-node --transpile-only tests/fixtures/host-snapshot-3.1.0/generate.ts`；生成器在原址判两个 Feature 都 VALID 才捕获。
  2. 更新本 README「钉住的产出」：产出提交号、生成时间、生成根、两个 Feature 的 completion run 与身份、规模。
  3. 复核 ★1：`npx ts-node --transpile-only tests/fixtures/host-snapshot-3.1.0/generate.ts --verify` 输出两个 Feature 均 `FEATURE_COMPLETED` 且 `BASELINE_STAR1=PASS`；再跑 `npm run test:unit -- --filter lifecycle-evolution` 全绿。

## 排除项（宿主根下）

| 项 | 理由 |
|---|---|
| `framework/` | 被替换的发布件本身，含指向源仓的 junction；加载时 provision 当前代码 |
| `.git` | 不能嵌进本仓 |
| `build/` | device_test.build 替身落的 `.hap`，只在诊断文本里出现，无绑定 |
| `fake-deveco/` | 父进程 preflight 的假工具链（空文件）；`framework.local.json` 的 installPath 已改为 `./fake-deveco`（本地配置，不进任何绑定） |

**核对**：六阶段证据 manifest 的 inputs/outputs、执行范围的 `dependencies[].path` 都只落在 `02-Feature/**`、`src/ledger/**`、`test/ledger/**`、`contracts/**`、`mappings/**`、`requirements/**`、`doc/**` 下。移走 `.git`/`build/`/`fake-deveco/` 后，在原址判定仍为 VALID。

## 可移植性：读侧重定位，产物原样

- **旧格式如何记路径**：
  - 执行范围的 `dependencies[].path` 是写入时工程根下的绝对路径，由 `capability-resolution.ts` 的 `dependency()` 写入，并进入范围指纹与修订链；
  - `testing/reports/device-test-evidence.json` 的 `trace_path` 同样是绝对路径。
- **快照不改写这些路径**。改写会破坏证据哈希，等于重签。
- **读侧怎么处理**：`project-relative-path.ts` 的 `inferLegacyProjectRoot` 从同一份记录里推出旧根，`resolveDependencyPath` 按这个前缀重定位（`\` 与 `/` 都认，盘符路径大小写不敏感）。
- **越界判定不变**：重定位后仍在工程外，照旧判 stale。
- **其余约 800 处绝对路径是诊断文本**（summary、script-report、ai-prompt、trace 等），被证据哈希绑定，不参与判定。

**★1 在 2026-09-25 的实测**（生成根已删除后运行）：

```text
demo-card: feature_status=FEATURE_COMPLETED (verify=VALID, chain=spec→plan→coding→review→ut→testing)
cu-bGVkZ2VyLWFwcC1ibHVlcHJpbnQAbGVkZ2VyLXJlZnJlc2g: feature_status=FEATURE_COMPLETED (verify=VALID, chain=coding→review→ut)
BASELINE_STAR1=PASS
```

## e9d49418：spec 规则变化后的同任务重验

新规则可能使 spec 也需要重验。迁移替身仅在正式 spec 回调中补 ui_change 与当前 facts，已声明 checkpoint 继续核验；spec 产出使原先复用的阶段失效时，通过原 scope_revised 机制接回同一个 run，不换任务或清零预算。原 project/ 和旧完成原件不改。

可移植 Git 基线须保留本 fixture 的 UT 归属：AllBanksPage.test.ets 与 LedgerFeature.test.ets 由其原 UT 阶段新增，seed 阶段不存在。临时 Git 初始化时这两个文件不进入基线提交，工作区仍保留捕获字节；其余捕获文件照常入树，再用既有 --rebaseline-to 显式记录新基线。不能把整份完成快照一律作为“动手前”基线，否则本任务 UT 全被误作存量而退出覆盖。该提交是测试重建的可移植基线，不冒充原 Git 对象；真实宿主优先使用仍可达的原任务基线，不以这份测试重建证明任意丢失历史都可自动迁移。
