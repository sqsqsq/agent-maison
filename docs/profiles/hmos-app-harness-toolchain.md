# hmos-app：宿主编译链与 UT 工具链（hvigor / hdc / hypium）

> **定位**：补充 [`../operations/harness-runbook.md`](../operations/harness-runbook.md) 中 **仅适用于 `project_profile.name = hmos-app`** 的操作细节。通用 phase 怎么跑、报告路径仍以 runbook 为准。
>
> **实现源码**：[`../../profiles/hmos-app/harness/`](../../profiles/hmos-app/harness/)（如 `hvigor-runner.ts`、`hdc-runner.ts`、`detect-deveco.ts` 等）；`framework/harness/scripts/utils/*` 下多为 **re-export shim**，详见该目录 README。

---

## 1. coding / ut 阶段关键 BLOCKER（规则名与行为）

以下检查项仅在 **active profile 注册对应 capability** 时执行；Neutral 基线规约见 `framework/specs/phase-rules/*.yaml`，细则由 `framework/profiles/hmos-app/phase-rules-overlays/*.yaml` 合并。

| Phase   | 规则                  | 说明                                                                                  |
| ------- | --------------------- | ------------------------------------------------------------------------------------- |
| coding  | `coding_hvigor_build` | 默认 `node hvigorw.js --mode module assembleHap`（与 DevEco 手工一致，可配置为 `assembleApp`）；超时 / 成功哨兵 / 完整落盘日志见 `hvigor-build.meta.json` |
| ut      | `ut_tsc_compiles`     | TypeScript Compiler API 对 `*.test.ets` 做 `noEmit` 扫描                              |
| ut      | `ut_hvigor_build`     | `buildUtHvigorArgs` → 与 DevEco「Run ohosTest」对齐：`node hvigorw.js --mode module`、`-p isOhosTest=true`、`-p buildMode=test`、`genOnDeviceTestHap` + task 后 `analyze=normal`（及 parallel/incremental/daemon）；详见 profile 内 `hvigor-runner.ts` |
| ut      | `ut_hvigor_test`      | 同上出包 → `hdc install` → `hdc shell aa test`；解析 hypium 报告；HAP 在 `build/<product>/outputs/ohosTest/`           |
| ut      | `ut_no_src_mutation`  | git diff 检测业务源码改动；未在 `gap-notes.md > approved_src_mutations[]` 登记的 FAIL |

---

## 2. CI：`ut_hvigor_test` 的特殊处理

`ut_hvigor_test` 需要真机或模拟器。两种选择：

- **CI 接入 device emulator**：在 GitHub Actions / GitLab Runner 等环境启动 **HarmonyOS** 模拟器，保证 `hdc list targets` 能见到设备。
- **暂时跳过 UT 阶段的真机执行**：在 feature 专属 `ut-rules.yaml` 用 `severity: MAJOR` 降级（**不推荐**，会埋「假 PASS」风险）。

v2.2 起，**任何形式的 SKIP/MAJOR 兜底都不应作为常态**；环境问题应修环境，不要当作规则问题长期降级。

---

## 3. 常见错误：hvigor / hdc

| 错误关键词                                 | 排查                                                                                                                            |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `hvigor not found` / `command not found`    | `framework.config.json > toolchain.devEcoStudio.installPath` 未配置；运行 `node framework/harness/scripts/detect-deveco.ts` 自检 |
| `hdc list targets` 输出空                   | 未连接设备 / 未启动模拟器 / 未授权 USB 调试；先在 DevEco Studio 里确认设备能见                                                  |
| `hap not found`                             | `genOnDeviceTestHap` 未生成或 **product 段不一致**：检查 `<module>/build/<product>/outputs/ohosTest/`（`product` 与 `detectProduct()` / `-p product=` 一致）；旧版仅查 `build/default/…` 会漏掉 `build/product/…` |
| `OHOS_REPORT_RESULT total=0`                | hypium 启动了但没识别到任何 testsuite；检查 `<module>/src/ohosTest/ets/test/` 是否有合法的 `*.test.ets` + 入口 shim             |

---

## 4. v2.7+ hvigor 加速 flag 与 v2.9 coding 命令默认值

**coding 阶段（默认）**：`buildCodingHvigorArgs` → `node …/hvigorw.js --mode module -p product=… -p buildMode=debug … assembleHap`，或由 `toolchain.hvigor.coding.driver=assemble_app_project` 切换为项目级 `assembleApp`（参数仍由 `buildAssembleAppArgs` 装配）。完整日志写入 `hvigor-build.log`（不截断）；`hvigor-build.meta.json` 记录 `timedOut` / `successMarkerFound` / `logBytes` 等。默认 **coding 超时 45min**，`ut` 相关默认 15min，均可由 `toolchain.hvigor.timeoutMs` 覆盖。

参数装配源码见 **profile** 内 `hvigor-runner.ts`（经 shim 亦可从 `framework/harness/scripts/utils/hvigor-runner.ts` 导入）：`buildCodingHvigorArgs` / `buildAssembleAppArgs` / `buildModuleHapArgs`（default 目标）/ **`buildUtHvigorArgs`（ohosTest，DevEco 对齐）**。

**UT 阶段（`ut_hvigor_build` / `ut_hvigor_test`）**：默认由 `buildUtHvigorArgs` + `resolveUtHvigorSpawnPlan` 装配（与 coding 共用 node+`hvigorw.js` 优先逻辑）。**不**在通用 `framework.config.template.json` 增加 hvigor UT 专用段。若 `check-ut` 报 `ut_hvigor_command_mismatch`，先修命令对齐再谈依赖。

```
# Coding 默认（DevEco 对齐，示意）
node <DevEco>/tools/node/node.exe <DevEco>/tools/hvigor/bin/hvigorw.js \
  --mode module \
  -p product=<detectProduct()> \
  -p buildMode=debug \
  --daemon --parallel --incremental --analyze=advanced \
  assembleHap

# coding 可选：项目级 assembleApp（toolchain.hvigor.coding.driver = assemble_app_project）
hvigorw --mode project \
  -p product=<detectProduct()> \
  -p buildMode=debug \
  --daemon --parallel --incremental --analyze=advanced \
  assembleApp

# UT：genOnDeviceTestHap（与 DevEco Run ohosTest 对齐；task 在后，analyze=normal）
node <DevEco>/tools/node/node.exe <DevEco>/tools/hvigor/bin/hvigorw.js \
  --mode module \
  -p module=<name>@ohosTest \
  -p isOhosTest=true \
  -p product=<detectProduct()> \
  -p buildMode=test \
  genOnDeviceTestHap \
  --daemon --parallel --incremental --analyze=normal
```

默认值对齐常见工程命令；若存在自定义 `onlineSign` / `archivePackage` / 签名产物改名等逻辑，可通过 `framework.config.json > toolchain.hvigor` 做 A/B：

```json
{
  "toolchain": {
    "hvigor": {
      "daemon": true,
      "parallel": true,
      "incremental": true,
      "analyze": "advanced"
    }
  }
}
```

字段含义：

| 字段 | 默认值 | 效果 |
| ---- | ------ | ---- |
| `daemon` | `true` | `false` 传 `--no-daemon`；`true` 传 `--daemon` |
| `parallel` | `true` | 是否传 `--parallel` |
| `incremental` | `true` | 是否传 `--incremental` |
| `analyze` | `"advanced"` | `"off"` 不传；`"normal"` / `"advanced"` 分别传 `--analyze=normal` / `--analyze=advanced` |

`coding_hvigor_build` 报告现在会打印实际 hvigor 命令；若日志命中 `00308018` / `Failed to find the incremental input file`，会追加诊断提示，帮助区分 ArkTS 编译错误和签名/打包增量状态问题。

| Flag                  | 收益来源                                                                  | 风险点                                                                            |
| --------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `-p product=<detect>` | 工程 product 名非 `default` 时需正确注入 | 自动探测：`toolchain.preferredProduct` > `build-profile.json5` 中优先命中名为 `product`/`default` 的项 > 首位 > 兜底 `default` |
| `-p buildMode=debug`（coding 默认任务均会传） | 项目级 `assembleApp` 默认偏 `release`；固定 debug 缩短门禁耗时 | 模块级 ut 任务默认即 debug，装配时不重复写 `buildMode` |
| `--parallel`          | 多模块工程开 hvigor task 并发，cold path 受益                              | **小工程（≤ 5 模块）反而是负收益**：worker spinup + 协调开销 > 并发节省；warm 路径下尤其明显 |
| `--incremental`       | 缓存命中时 hvigor 跳过更激进，warm path 受益                           | cold path 缓存为空，开销基本中性；额外缓存扫描有微小负收益                        |
| `--analyze=advanced`  | 产出更详细构建诊断信息，适合定位任务图 / 缓存问题                            | 日常 harness 不建议默认开启；可能显著增加 I/O 与分析耗时                         |

### 小工程 benchmark（仅供参考）

以下数据来自**本仓库早期**一次小模块规模、`assembleApp` 对比，**不**映射具体产品名：

每轮先 `clean` 后跑同一参数 `assembleApp`，cold = clean 后第一次，warm = 紧接着第二次：

| 路径   | OLD（v2.6：仅 `-p product=default --no-daemon`） | NEW（v2.7 全套加速） | Delta（NEW vs OLD） |
| ------ | ------------------------------------------------ | -------------------- | ------------------- |
| Cold   | 21.9s                                            | 18.7s                | **-14.9%**（小幅加速） |
| Warm   | 4.5s                                             | 6.6s                 | **+47%（反向变慢）** |

**结论**：

- 太小（少量模块、release 无混淆）时 `--parallel` 的协调开销可能 > 节省，warm 路径反而变慢。
- 大型多模块工程实测往往受益，是 v2.7 的主要目标场景。
- **小工程不应假设「v2.7 必快」**；若 coding 阶段 hvigor 比预期慢，先用「如何禁用单个 flag」绕过，再对 cold + warm 各跑两遍对比。

### 如何禁用某个 flag（小工程逃生阀）

`runHvigorAssembleApp` 的 `extraArgs` 透传位置在 task 之前的末端，hvigor 同名 `-p` 后传值覆盖前传值。要把 v2.7 的 `buildMode=debug` 改回 release 验证完整产物：

```ts
runHvigorAssembleApp({
  ...,
  extraArgs: ['-p', 'buildMode=release'],
});
```

但 `--parallel` / `--incremental` 没有同名覆盖语法。要彻底关掉这两个 flag，需要直接改 profile 内 `hvigor-runner.ts > buildAssembleAppArgs / buildModuleHapArgs`，或在 framework 层增加配置开关再绕回来（v2.7 起未默认提供，避免过度配置化）。

### 升级 framework 后的自检步骤

升级到 v2.7+ 后，建议在目标工程做一次：

1. clean 后跑 OLD 参数（手敲）→ 记录 cold/warm 耗时；
2. clean 后跑 NEW 参数（直接 harness coding phase）→ 记录 cold/warm 耗时；
3. 对比，若 warm 路径反向变慢超过 30%，把 `--parallel` 从 `buildAssembleAppArgs` 装配里去掉再测一遍 —— 多数小工程的负收益来自 `--parallel`，不来自 `buildMode=debug` / `--incremental`。

---

## 维护同步（2026-05）

- **实现位置**：`hvigor-runner.ts` / `hdc-runner.ts` 正文在 `framework/profiles/hmos-app/harness/`；根 `check-coding` / `check-ut` 的宿主逻辑由 **`coding-host-rules`**、**`ut-host-impl`** 承担（`profile-host-loader` 动态加载）。  
- **失败归类**：coding 编译失败 kind 使用 `compile_timeout` / `compile_incomplete_output`（历史 `hvigor_*` 字面已弃用）。  
- **导出入口文件名**：与 `architecture.cross_module_exports_file` 一致的入口文件（常见 `index.ets`）**不要求** PascalCase，与 harness `naming_conventions` 一致。
- **2026-05-18**：对照 [`DOC_INVENTORY.yaml`](../DOC_INVENTORY.yaml) 所列 harness 源文件复核 ——命令行 argv、产物路径与诊断档位未改；§4 性能对比样本仍为早期仓库快照，不作为通用 SLA。

---

## 5. false PASS：宿主编译输出未被识别

若怀疑 harness 已 PASS 但 **hvigor 日志里仍有 ArkTS 错误** 未被脚本归类：可把 `framework.config.json > toolchain.devEcoStudio.aaTestTimeoutMs` 调大后重跑，并核对 `hvigor-build.log` 与 `script-report.json`。
