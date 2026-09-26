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
npx ts-node --transpile-only tests/fixtures/host-snapshot-3.1.0/generate.ts --verify   # ★1：换根加载 + goal-status
npx ts-node --transpile-only tests/fixtures/host-snapshot-3.1.0/generate.ts            # 重生成（只能在钉住提交上跑）
```

- **生成器**：复用 `real-chain.unit.test.ts` 的 `seedCuBoundHost`、`runDemoCardChain`、`runCuBoundChain`、`goalStatusFeatureLine`，两条链都经 `runGoalRuntimeChain(realHarness)` 真跑。
- **生成根原址自检**：两个 Feature 都判 `verify=VALID` 后才捕获快照。
- **`--verify`**：把快照复制到仓外 tmp 根，provision **当前**框架，再经公开入口 `goal-status`（生产 `assessFeature`）判两个 Feature。

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
