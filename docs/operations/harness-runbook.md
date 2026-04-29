# Harness 全链路验证操作手册

> **本文档定位**：framework Harness 实际怎么跑 / 报告在哪 / 出错怎么排查的**操作手册**。
>
> **不是**：单 Skill 的使用手册（在各 SKILL.md 里）；也不是设计讲解（在 [`../overview.md`](../overview.md) 里）。
>
> **读完后你会**：知道 9 个 phase 各自管什么、单条命令怎么写、报告路径在哪、常见错误的排查思路。

---

## 1. 本文档的边界

| 范围                                                                                                                                                     | 状态                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| 在已有产物（catalog、glossary、PRD、design、代码、review、UT、测试计划/报告等）的前提下，按阶段运行**脚本 Harness**：读 Spec 与文档/代码，执行 `check-*.ts`，生成报告 | ✅ 本文档覆盖                         |
| "一键完成"Skill 0 → PRD → 设计 → 编码 → Review → UT → 真机测试的开发流水线                                                                                | ❌ Harness 不是开发流水线，而是质量门禁 |
| AI Harness 自动调模型                                                                                                                                    | ❌ 脚本只生成 `ai-prompt.md`，不会自动调用任何大模型；语义审查需自行把 prompt 发给所选模型 |

---

## 2. Phase 总览（9 个阶段）

| Phase       | 对象                                          | `--feature` | 说明                                                                                                                |
| ----------- | --------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------- |
| `catalog`   | `doc/module-catalog.yaml`                     | **不需要**（全局） | Skill 0 · Phase A 产物；含模块画像结构、`easily_confused_with`、`key_exports_fresh_vs_index`、`feature_scope_integrity` 等 |
| `glossary`  | `doc/glossary.yaml`                           | **不需要**（全局） | Skill 0 · Phase B 产物；术语结构、`seed_no_technical_words` 等                                                         |
| `prd`       | `doc/features/<feature>/PRD.md`               | **必填**    | `terminology_mapping_table` / `scope_matches_catalog` / `terminology_modules_within_scope` / `glossary_terms_used_in_body` 等 |
| `design`    | `doc/features/<feature>/design.md`            | **必填**    | Scope 与 PRD 继承一致性 / `architecture_impact` 声明                                                                |
| `coding`    | 代码 + contracts                              | **必填**    | `diff_within_scope` / 分层 import / `named_business_handler` / **`coding_hvigor_build`**（v2.2: hvigor 真实编译）   |
| `review`    | `doc/features/<feature>/review-report.md`     | **必填**    | Review 结论一致性、BLOCKER 数量                                                                                     |
| `ut`        | UT 清单与入口                                 | **必填**    | 业务级 UT 的全部门禁；详见 [`../skills/5-business-ut.md`](../skills/5-business-ut.md)                                  |
| `testing`   | 真机测试计划 / 报告                            | **必填**    | P0/P1 通过率、device AC 追溯                                                                                        |
| `docs`      | `framework/docs/**.md`                        | **不需要**（全局） | v2.4 起：framework 自身对外文档新鲜度；详见 §6                                                                       |

全局阶段在 `harness-runner` 内使用哨兵 feature `_global`，报告目录形如：
`framework/harness/reports/_global/<phase>/`。

---

## 3. 一次性跑全链路（仅脚本检查）

在仓库根目录下，先全局、再按 feature。

### 3.1 PowerShell（Windows）

```powershell
Set-Location "framework/harness"

# Skill 0 全局产物（无 --feature）
npx ts-node harness-runner.ts --phase catalog
npx ts-node harness-runner.ts --phase glossary

# 功能需求六阶段（需 --feature；home-page 替换为你的 feature 名）
foreach ($p in @('prd','design','coding','review','ut','testing')) {
  npx ts-node harness-runner.ts --phase $p --feature home-page
}

# v2.4：framework 自身文档新鲜度
npx ts-node harness-runner.ts --phase docs
```

### 3.2 bash（Linux / macOS / WSL）

```bash
cd framework/harness

npx ts-node harness-runner.ts --phase catalog
npx ts-node harness-runner.ts --phase glossary

for p in prd design coding review ut testing; do
  npx ts-node harness-runner.ts --phase "$p" --feature home-page
done

npx ts-node harness-runner.ts --phase docs
```

### 3.3 单阶段示例

```bash
# 全局
npx ts-node harness-runner.ts --phase catalog
npx ts-node harness-runner.ts --phase docs

# 功能
npx ts-node harness-runner.ts --phase prd --feature home-page
npx ts-node harness-runner.ts --phase ut  --feature home-page
```

### 3.4 列出可用 Spec

```bash
npx ts-node harness-runner.ts --list
```

---

## 4. 报告输出路径

```
framework/harness/reports/
├── _global/
│   ├── catalog/
│   │   ├── script-report.json   ← 脚本检查结果（程序消费）
│   │   ├── ai-prompt.md         ← AI Harness prompt（人类审 / 喂给模型）
│   │   ├── merged-report.md     ← 合并后人类可读报告
│   │   └── trace.json           ← 起点 commit + 时间戳
│   ├── glossary/
│   └── docs/                    ← v2.4 起
└── <feature>/
    ├── prd/
    ├── design/
    ├── coding/
    ├── review/
    ├── ut/
    └── testing/
```

**关键文件**：

| 文件                    | 谁读                      | 何时看                                                  |
| ----------------------- | ------------------------- | ------------------------------------------------------- |
| `script-report.json`    | CI / 程序                 | 自动化脚本判 PASS/FAIL                                  |
| `merged-report.md`      | 人类                      | 排查"为什么 FAIL"                                       |
| `ai-prompt.md`          | verifier 子 agent / 你    | 把它发给 AI 模型做语义级复核                            |
| `trace.json`            | harness 内部 / 调试       | 记录本次进入 phase 时的 git HEAD（供 ut_no_src_mutation 用） |

---

## 5. 各阶段关键脚本门禁速查

> 完整规则定义见 `framework/specs/phase-rules/<phase>-rules.yaml`；
> 实现见 `framework/harness/scripts/check-<phase>.ts`。

### 5.1 catalog（`check-catalog.ts`）

- **结构**：schema、`modules[]` 必填字段、layer/format、唯一性等
- **追溯**：`easily_confused_with` 指向存在、无自引用 / 空 module（BLOCKER）、对称性（MAJOR，可 `unidirectional` 豁免）、`entry_file` 在磁盘、`layer_matches_path`
- **U2** `key_exports_fresh_vs_index`（MAJOR / WARN）：HAR 模块 `key_exports` 与 `Index.ets` 顶层 export 漂移时告警
- **C3** `feature_scope_integrity`（MAJOR / WARN）：反向扫描 `doc/features/*/PRD.md` 与 `design.md` 的 Scope YAML，列出引用 catalog 未建档模块的文档（提前暴露后续 `scope_matches_catalog` 会 BLOCKER 的漂移）

### 5.2 glossary（`check-glossary.ts`）

- **结构**：`terms[]`、字段完整性、term/alias 不重复
- **P0-2** `seed_no_technical_words`（BLOCKER）：`glossary-seed.txt` 中 CamelCase 或与模块名重名等；`doc/glossary-seed-allowlist.txt` 可豁免
- **追溯**：`canonical_module` 在 catalog 存在、`owner_layer` 与 catalog 一致等

### 5.3 prd（`check-prd.ts`）

- **结构**：必需章节、`## 0. 术语映射表` 表格列与用户确认 `[x]`、`Scope 声明` 内 YAML 等
- `terminology_mapping_table`：权威模块须在 catalog；与 `glossary.yaml` 无冲突
- `scope_matches_catalog`：`in_scope_modules` / `out_of_scope_modules` 每项须在 catalog 建档
- **C1a** `terminology_modules_within_scope`（BLOCKER）：术语映射表「权威模块」须出现在 in_scope 或 out_of_scope 之一
- **C1b** `glossary_terms_used_in_body`（MAJOR / WARN）：glossary 术语（含 aliases）在 PRD **正文**（去掉术语映射表段落后）出现但未进映射表时告警

### 5.4 design / coding / review / testing

行为与对应 `framework/specs/phase-rules/<phase>-rules.yaml` 及 `check-<phase>.ts` 一致；feature 级规约与文档同目录扁平归档在实例工程根的 `doc/features/<feature>/`，`framework.config.json` 仅保留单字段 `paths.features_dir`，默认 `doc/features`。

**v2.2 / v2.3 关键 BLOCKER**（详见 [`../skills/5-business-ut.md`](../skills/5-business-ut.md) §5）：

| Phase   | 规则                  | 说明                                                                                  |
| ------- | --------------------- | ------------------------------------------------------------------------------------- |
| coding  | `coding_hvigor_build` | 对每个业务模块跑 `assembleHap`；解析 ArkTS:ERROR / TSxxxx 即 FAIL                     |
| ut      | `ut_tsc_compiles`     | TypeScript Compiler API 对 `*.test.ets` 做 `noEmit` 扫描                              |
| ut      | `ut_hvigor_build`     | 对 `<module>@ohosTest` 跑 `assembleHap`；兜底 tsc 漏过的跨文件类型违约                 |
| ut      | `ut_hvigor_test`      | `genOnDeviceTestHap` + `hdc install` + `hdc shell aa test`；解析 hypium 报告           |
| ut      | `ut_no_src_mutation`  | git diff 检测业务源码改动；未在 `gap-notes.md > approved_src_mutations[]` 登记的 FAIL |

### 5.5 ut（`check-ut.ts`）

- 详见 [`../skills/5-business-ut.md`](../skills/5-business-ut.md)
- 简明清单：`ut_import_whitelist` / `it_drives_flow` / `branch_coverage_full` / `acceptance_coverage` / `ut_tsc_compiles` / `ut_hvigor_build` / `ut_hvigor_test` / `ut_no_src_mutation`

---

## 6. v2.4 新增：`docs` phase（framework 自身文档新鲜度）

### 6.1 用途

随 framework 内部代码 / Skill / 规约不断演进，对外文档（[`framework/docs/**.md`](../)）容易漂移。`docs` phase 用 git 提交时间戳自动比对：

- `framework/docs/DOC_INVENTORY.yaml` 声明每份文档"关心"哪些 framework 内部资产
- `check-docs.ts` 对每份 doc 取 git committer date，对其 `sources[]` 也取 git committer date
- 任一 source 在 doc 之后改动过 → MAJOR：doc 可能已过期

### 6.2 跑法

```bash
cd framework/harness
npx ts-node harness-runner.ts --phase docs
```

### 6.3 报告样例

```
framework/docs/skills/5-business-ut.md (doc_ts=2026-04-25T10:00:00+08:00):
    ↳ framework/skills/5-business-ut/SKILL.md 更新于 2026-04-26T15:00:00+08:00
    ↳ framework/specs/phase-rules/ut-rules.yaml 更新于 2026-04-26T16:00:00+08:00
```

### 6.4 收到 stale 提醒怎么办

| 情况                                     | 操作                                                                              |
| ---------------------------------------- | --------------------------------------------------------------------------------- |
| source 改动确实改了文档涉及的语义        | 更新 doc，正常 commit；下次 check 自动过                                          |
| source 只是无关重构（变量重命名 / 注释） | `touch` 文档文件并 commit `"docs: sync without content change"`，下次自动过        |
| source 已删除，inventory 还指向它        | 修 `DOC_INVENTORY.yaml > docs[].sources`：去掉过期路径                            |
| source 影响很小，不该每次它一动都报警    | 把它从 inventory 中该 doc 的 `sources` 里移出；不要随手改 severity                 |

### 6.5 退出码语义

- 全部 PASS / 仅 SKIP（如非 git 仓库） → 0
- MAJOR FAIL（doc 可能过期 / source 路径失效）→ 1
- 不会有 BLOCKER（docs phase 设计上不阻塞 CI）

---

## 7. 与 Slash / Skill 的对应关系

| Phase       | Slash                                          | Skill                                                                            |
| ----------- | ---------------------------------------------- | -------------------------------------------------------------------------------- |
| `catalog`   | `/catalog-bootstrap`                           | [`../../skills/0-catalog-bootstrap/SKILL.md`](../../skills/0-catalog-bootstrap/SKILL.md) |
| `glossary`  | `/glossary-bootstrap`                          | [`../../skills/0-catalog-bootstrap/SKILL.md`](../../skills/0-catalog-bootstrap/SKILL.md) |
| `prd`       | `/prd-design`                                  | [`../../skills/1-prd-design/SKILL.md`](../../skills/1-prd-design/SKILL.md)         |
| `design`    | `/requirement-design`                          | [`../../skills/2-requirement-design/SKILL.md`](../../skills/2-requirement-design/SKILL.md) |
| `coding`    | `/coding`                                      | [`../../skills/3-coding/SKILL.md`](../../skills/3-coding/SKILL.md)                |
| `review`    | `/code-review`                                 | [`../../skills/4-code-review/SKILL.md`](../../skills/4-code-review/SKILL.md)      |
| `ut`        | `/business-ut`                                 | [`../../skills/5-business-ut/SKILL.md`](../../skills/5-business-ut/SKILL.md)      |
| `testing`   | `/device-testing`                              | [`../../skills/6-device-testing/SKILL.md`](../../skills/6-device-testing/SKILL.md) |
| `docs`      | （无 slash，直接 `--phase docs`）               | —                                                                                |

---

## 8. CI 集成范式

最常见的两种 CI 接入：

### 8.1 PR 卡门（推荐）

每个 PR 必跑：

```bash
cd framework/harness
npm install --no-audit --no-fund

# 全局 phase（任何 PR 都跑）
npx ts-node harness-runner.ts --phase catalog
npx ts-node harness-runner.ts --phase glossary
npx ts-node harness-runner.ts --phase docs

# 受影响的 feature（按变更文件路径筛选）
for f in $(detect_affected_features); do
  for p in prd design coding review ut testing; do
    npx ts-node harness-runner.ts --phase "$p" --feature "$f" || exit 1
  done
done
```

`detect_affected_features` 是项目内自定义脚本，根据 PR 改动的路径反查 `doc/features/<feature>/contracts.yaml` 中 `package_path` 的归属。

### 8.2 Nightly 全量跑

主分支 / Nightly：

```bash
# 全部已知 feature 都跑一遍 6 个功能 phase
for f in $(ls doc/features); do
  for p in prd design coding review ut testing; do
    npx ts-node harness-runner.ts --phase "$p" --feature "$f"
  done
done
```

### 8.3 ut_hvigor_test 在 CI 上的特殊处理

`ut_hvigor_test` 需要真机或模拟器。两种选择：

- **CI 接入 device emulator**：在 GitHub Actions / GitLab Runner 启动 HarmonyOS Emulator，`hdc list targets` 能见到设备
- **暂时跳过 UT 阶段的真机执行**：feature 专属 `ut-rules.yaml` 用 `severity: MAJOR` 降级（**不推荐**，会埋"假 PASS"地雷）

v2.2 起，**任何形式的 SKIP/MAJOR 兜底都不应作为常态**；环境问题应该被当作环境问题修，不要当作规则问题降级。

---

## 9. 常见错误排查

### 9.1 `runner_*_failed`

报告里出现 `runner_load_phase_rule_failed` / `runner_load_feature_spec_failed` 等：

| 报错 ID                            | 排查                                                                                              |
| ---------------------------------- | ------------------------------------------------------------------------------------------------- |
| `runner_load_phase_rule_failed`    | 缺少对应的 `framework/specs/phase-rules/<phase>-rules.yaml` 或 YAML 解析失败                       |
| `runner_load_feature_spec_failed`  | `doc/features/<feature>/contracts.yaml` 或 `acceptance.yaml` YAML 解析失败                         |
| `runner_assemble_ai_prompt_failed` | 上下文文件读取异常（路径含特殊字符 / 编码问题），看 `script-report.json > details`                 |
| `runner_generate_merged_report_failed` | 输出目录权限问题 / 磁盘满                                                                      |

修复 runner_* 报告项后重新跑即可，runner_* 一律 BLOCKER。

### 9.2 hvigor / hdc 工具链相关

| 错误关键词                                 | 排查                                                                                                                            |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `hvigor not found` / `command not found`    | `framework.config.json > toolchain.devEcoStudio.installPath` 未配置；运行 `node framework/harness/scripts/detect-deveco.ts` 自检 |
| `hdc list targets` 输出空                   | 未连接设备 / 未启动模拟器 / 未授权 USB 调试；先在 DevEco Studio 里确认设备能见                                                  |
| `hap not found`                             | hvigor `genOnDeviceTestHap` 未生成或目录不对；检查 `<module>/build/default/outputs/ohosTest/` 是否有 `*-signed.hap`             |
| `OHOS_REPORT_RESULT total=0`                | hypium 启动了但没识别到任何 testsuite；检查 `<module>/src/ohosTest/ets/test/` 是否有合法的 `*.test.ets` + 入口 shim             |

### 9.3 false PASS 嫌疑

如果你怀疑 harness "看起来 PASS 但实际有问题"，按以下顺序检查：

1. `script-report.json > checks[].status` 中是否有 `SKIP` —— v2.2 起任何 SKIP 都应有明确合理原因
2. `merged-report.md` 末尾的 verdict 与 `summary` 对得上吗（`pass=N, fail=0, blockers=0` ≠ verdict=PASS 是异常态）
3. `trace.json > start_commit` 与当前 HEAD 一致吗 —— 如不一致，可能是上次跑剩的报告文件未刷新
4. 实际 hvigor 输出有 ArkTS:ERROR 但脚本未识别？—— 把 `framework.config.json > toolchain.devEcoStudio.aaTestTimeoutMs` 调大，重跑

### 9.4 v2.7 hvigor 加速 flag 调优（含实测反例）

v2.7 起 harness 给所有 hvigor 调用默认装上一组加速 flag，参数装配见 `framework/harness/scripts/utils/hvigor-runner.ts > buildAssembleAppArgs / buildModuleHapArgs`：

```
# coding 阶段 assembleApp（项目级）
hvigorw --mode project \
  -p product=<detectProduct()> \
  -p buildMode=debug \
  --no-daemon --parallel --incremental \
  assembleApp

# ut 阶段 assembleHap / genOnDeviceTestHap（模块级）
hvigorw \
  -p module=<name>@<target> \
  -p product=<detectProduct()> \
  --no-daemon --parallel --incremental \
  <task>
```

默认值保持历史行为；如真实工程存在自定义 `onlineSign` / `archivePackage` / 签名产物改名等逻辑，可通过 `framework.config.json > toolchain.hvigor` 做 A/B：

```json
{
  "toolchain": {
    "hvigor": {
      "daemon": false,
      "parallel": true,
      "incremental": true,
      "analyze": "off"
    }
  }
}
```

字段含义：

| 字段 | 默认值 | 效果 |
| ---- | ------ | ---- |
| `daemon` | `false` | `false` 传 `--no-daemon`；`true` 传 `--daemon` |
| `parallel` | `true` | 是否传 `--parallel` |
| `incremental` | `true` | 是否传 `--incremental` |
| `analyze` | `"off"` | `"off"` 不传；`"normal"` / `"advanced"` 分别传 `--analyze=normal` / `--analyze=advanced` |

`coding_hvigor_build` 报告现在会打印实际 hvigor 命令；若日志命中 `00308018` / `Failed to find the incremental input file`，会追加诊断提示，帮助区分 ArkTS 编译错误和签名/打包增量状态问题。

| Flag                  | 收益来源                                                                  | 风险点                                                                            |
| --------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `-p product=<detect>` | v2.6 之前硬写死 `default`，product 名为 `mirror` / `phone` 的工程直接报 `product not found` —— v2.7 修复 | 自动探测优先级：`framework.config.json > toolchain.preferredProduct` > `build-profile.json5 > app.products[0].name` > 兜底 `default`；多 product 工程若期望非首位需在 config 显式声明 |
| `-p buildMode=debug`（仅 assembleApp） | assembleApp 默认 `release`（含混淆 / 压缩 / 体积优化），coding 门禁不出交付包，固定 debug 在大型工程能砍 30%~50% | release 配置缺混淆/压缩规则的工程，debug ≈ release，本 flag 无收益                |
| `--parallel`          | 多模块工程开 hvigor task 并发，cold path 受益                              | **小工程（≤ 5 模块）反而是负收益**：worker spinup + 协调开销 > 并发节省；warm 路径下尤其明显 |
| `--incremental`       | 警暖缓存命中时 hvigor 跳过更激进，warm path 受益                           | cold path 缓存为空，开销基本中性；额外缓存扫描有微小负收益                        |
| `--analyze=advanced`  | 产出更详细构建诊断信息，适合定位任务图 / 缓存问题                            | 日常 harness 不建议默认开启；可能显著增加 I/O 与分析耗时                         |

#### 实测：本仓库（SimulatedWalletForHmos · 5 模块小工程） 4 轮对比

每轮先 `clean` 后跑同一参数 `assembleApp`，cold = clean 后第一次，warm = 紧接着第二次：

| 路径   | OLD（v2.6：仅 `-p product=default --no-daemon`） | NEW（v2.7 全套加速） | Delta（NEW vs OLD） |
| ------ | ------------------------------------------------ | -------------------- | ------------------- |
| Cold   | 21.9s                                            | 18.7s                | **-14.9%**（小幅加速） |
| Warm   | 4.5s                                             | 6.6s                 | **+47%（反向变慢）** |

**结论**：
- 本仓库太小（5 模块、release 无混淆）以至于 `--parallel` 的 worker 协调开销 > 节省，warm 路径反而被拖慢。
- 内网大型工程（多模块 + release 真跑混淆压缩）实测有效，是 v2.7 的真实目标场景。
- **小工程不应假设"v2.7 必快"**；若发现 coding 阶段 hvigor 比预期慢，先用下面"如何禁用单个 flag"绕过，再用同一参数跑两遍 cold + warm 对比。

#### 如何禁用某个 flag（小工程逃生阀）

`runHvigorAssembleApp` 的 `extraArgs` 透传位置在 task 之前的末端，hvigor 同名 `-p` 后传值覆盖前传值。要把 v2.7 的 `buildMode=debug` 改回 release 验证完整产物：

```ts
runHvigorAssembleApp({
  ...,
  extraArgs: ['-p', 'buildMode=release'],
});
```

但 `--parallel` / `--incremental` 没有同名覆盖语法。要彻底关掉这两个 flag，需要直接改 `hvigor-runner.ts > buildAssembleAppArgs / buildModuleHapArgs`，或在 framework 层加一个 `toolchain.hvigorParallel` 开关再绕回来（v2.7 起未默认提供，避免过度配置化）。

#### 升级 framework 后的自检步骤

升级 framework 到 v2.7+ 后，建议在自家工程做一次：

1. clean 后跑 OLD 参数（手敲）→ 记录 cold/warm 耗时；
2. clean 后跑 NEW 参数（直接 harness coding phase）→ 记录 cold/warm 耗时；
3. 对比，若 warm 路径反向变慢超过 30%，把 `--parallel` 从 `buildAssembleAppArgs` 装配里去掉再测一遍 —— 多数小工程的负收益来自 `--parallel`，不来自 `buildMode=debug` / `--incremental`。

---

## 10. 中断 / 切换会话 / 放弃阶段（v2.8 起）

### 10.1 背景

Stop hook 会读 `framework/harness/state/.current-phase.json` 判断当前 cli 会话能不能结束消息。
该状态文件是**全局单槽**：任何时刻最多一份，跨 cli 重启不自动清理。这种设计在以下场景容易"误伤"：

- Ctrl+C 中断 harness，状态停留在 `status='running'`；
- cli 崩溃 / 重启，没机会跑 receipt 校验；
- 切换 feature 而旧 feature 的阶段还没收尾；
- 跨天 / 跨周回来接着干，但记不清上次到哪一步。

v2.8 起 hook 引入"会话边界判定"避免上一会话遗留拦下一会话。详细矩阵见
[CLAUDE.md §5.1.1](../../../CLAUDE.md)；下面只列日常操作动作。

> **本节仅针对 feature 维度阶段**（PRD / design / coding / review / UT / device-testing）。
> 全局阶段 `init` / `catalog` / `glossary` / `docs` 没有完成回执模板：
> v2.8.1 起 `harness-runner.ts` 对全局阶段直接 skip 写 state，Stop hook 同时兜底
> 在看到 `state.phase` 是这四值之一时一律 allow。所以你跑 `--phase init` 之类
> 命令时不会留下 `.current-phase.json`，也不需要也无法填写"init 完成回执"。

### 10.2 配置：`framework.config.json > state_machine`

```jsonc
{
  "state_machine": {
    "grace_period_minutes": 5,   // runner 写 state → hook 第一次盖 session_id 的容忍窗口
    "ttl_hours": 12,              // payload 缺 session_id 时的兜底过期阈值
    "schema_version": "1.1"
  }
}
```

| 字段 | 范围 | 默认值 | 说明 |
|------|------|--------|------|
| `grace_period_minutes` | (0, 60] | `5` | runner 写完 state 到 hook 第一次"盖章"之间允许的间隔。窗口内 state.session_id=null 视为"刚跑完 harness 还没来得及盖章"，hook 会用本会话 sid 给它盖章；超出窗口再来一个未盖章 state 视为前一会话遗留。 |
| `ttl_hours`            | [1, 168] | `12` | 极端兜底：payload 没传 session_id 时，仅用 `state.updated_at` 与 ttl 比较。常规路径走 session_id 比对，ttl 是"防止历史 state 永久缠住"的保险栓。 |

非法值（缺字段 / 超范围 / 非数字）：
- runner 端（`framework/harness/config.ts > validateStateMachine`）→ 抛错；
- hook 端（`.claude/hooks/check-phase-completion.mjs > readStateMachineFromConfig`）→ 安静回退默认值，不 fail。

### 10.3 三类常见操作

#### A. 我想继续上次的阶段

不需要任何额外动作——只要本次仍是同一 cli 会话（同一 session_id），Stop hook 会照常按 §5.1
四条件判定。只要把缺的 trace / harness / verifier / receipt 补齐再 stop 即可。

跨 cli 会话怎么办？参考 §10.4。

#### B. 我想放弃这个阶段，换去做别的事

```bash
cd framework/harness && npx ts-node harness-runner.ts --clear-state
```

行为：
- 删除 `framework/harness/state/.current-phase.json`（无确认）；
- 历史 verdict / 报告 / 回执仍保留在 `framework/harness/reports/<feature>/<phase>/` 与
  `doc/features/<feature>/<phase>/` 下，用于审计；
- 下次 stop hook 找不到 state 文件 → 直接放行；
- 想接着这个 feature/phase 干，按对应 SKILL.md 重新进入即可（state 会被 `harness-runner.ts` 重新写起来）。

`--clear-state` 是"放弃已有进度"，不是"暂停"：
- 它**不会**回滚已写到磁盘的 PRD / design / 代码 / receipt 等内容；
- 它**只**删 state file 这个判定开关。

#### C. 我刚问个无关问题，hook 却跳出"未闭环"提示

如果提示文案是：

```
[Stop Hook 提示] 检测到一个旧的阶段状态文件，但与当前会话无关：
  ...
  原因 = state 由另一个会话（session_id=...）记录，本次会话 session_id=...
  ...
本次 stop 已放行；上面这条状态不会拦截你。
```

→ 这是 **advisory + exit 0**：hook 已经放行，agent **不应**接管旧任务，继续做用户当前问的事。

如果不想再看到这条提示，按 §10.3-B 跑一次 `--clear-state` 即可。

如果提示文案是：

```
[Stop Hook 提示] 当前会话存在未闭环阶段：
  ...
未满足的闭环条件（CLAUDE.md §5.1）：
  - ...
如果你打算【继续这个阶段】，按下面顺序补齐：
  ...
如果你想【放弃这个阶段，转去做别的事】，先执行：
       cd framework/harness && npx ts-node harness-runner.ts --clear-state
```

→ 这是 **block + exit 2**：当前会话内确有未闭环阶段，按提示二选一即可。

### 10.4 跨天 / 跨 cli 重启回来接着干

例：周一跑了一半 coding，周二重启 cli 回来想接着干同一个 feature。

- 直接进入对应 Skill / Slash，重新触发 harness-runner.ts；
- runner 会重写 state（保留 prev started_at），同会话内继续；
- 周一遗留的 `state.session_id="<old>"` 会在新 cli 的 Stop hook 中被识别为
  `stale-cross-session` → advisory + exit 0；
- 当 runner 重新跑过后，`writeCurrentPhaseState` 不会主动改 session_id，
  保留前会话的 sid——直到本次 cli 的第一次 Stop hook 触发，hook 会用新 sid 覆盖；
- 如不想看到 advisory，先 `--clear-state` 再重新进入对应 Skill。

### 10.5 如何看 state 当前是什么状态

```bash
cat framework/harness/state/.current-phase.json
```

关键字段：

| 字段 | 含义 |
|------|------|
| `phase` / `feature` | 当前阶段是哪个 feature 的哪一步 |
| `status`            | `running`（harness 跑到一半）/ `harness_finished` |
| `verdict`           | 最近一次 harness verdict |
| `blocker_count`     | 最近一次 BLOCKER 数 |
| `receipt`           | check-receipt.ts 输出 |
| `session_id`        | 第一次 Stop hook 命中时由 hook 回填，标记本 state 归属哪个 cli 会话 |
| `session_id_recorded_at` | session_id 被盖章的时刻 |
| `last_seen_session_id` / `last_seen_at` | 最近一次 Stop / SubagentStop 触发时的 sid 与时刻（用于审计） |
| `last_verifier_report.recorded_in_session` | verifier 子 agent 那次跑的 sid（验证 verifier 也属于同会话） |

---

## 11. 历史注记

以下条目来自早期为单 feature（home-page）打通端到端时遇到的工程要点，对 Windows / 沙盒样本仍有参考价值：

| # | 要点                                                                                                                                          |
| - | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 | **Markdown CRLF**：`framework/harness/scripts/utils/markdown-parser.ts` 对 `split(/\r?\n/)` 统一处理，避免 Windows 下标题解析失败             |
| 2 | **contracts 快照**：`doc/features/<feature>/contracts.yaml` 与当前工程对齐（实例路径，不进 `framework/`）                                    |
| 3 | **测试计划 AC 编号**：`check-testing.ts` 中关联 AC 的正则支持 `AC-G1` 等形式                                                                  |
| 4 | **Hypium 入口**：`check-ut.ts` 跳过仅导出 `testsuite()`、无 `describe` 的入口 shim                                                            |
| 5 | **真机测试文档**：`doc/features/<feature>/test-plan.md`、`test-report.md` 必须覆盖 acceptance 中 P0 / P1 的 AC 追溯                          |
| 6 | **Cursor 跳板**：`.cursor/skills/*/SKILL.md` 指向 `framework/skills/` 下正文，**不复制内容**                                                  |

---

## 一句话总结

> **Harness 的工作不是"自动化跑代码"，是"卡住错误不让往下传"。
> 看到 PASS 不要假定一切都好，要看 SKIP 数量、看 trace.json、看 merged-report.md 的 verdict 是否与 summary 自洽；
> 看到 FAIL 不要急着降 severity，先把环境/产物修对再回来 —— 任何一次降级都是埋一颗"假 PASS"地雷。**

<!--
  last-synced: 2026-04-27
  reviewed against framework "phase closure / Layer 3 physical interception" patch (commit f71020d)
  per DOC_INVENTORY.yaml update_triggers (新增/删除 phase / report 输出路径 / --phase --feature 语义 / 新增 BLOCKER 级 phase),
  this patch added writeCurrentPhaseState + tryValidateReceipt to harness-runner.ts (an internal subroutine
  for receipt validation, gated behind the existing per-phase flow); it did NOT add or remove any phase,
  did NOT change report output paths, did NOT change --phase / --feature semantics, and did NOT introduce
  a new BLOCKER-level phase, so no content change required for this runbook.

  v2.4 (2026-04-27) — Stop hook cross-session isolation:
    - 新增 §10「中断 / 切换会话 / 放弃阶段」章节：state_machine 配置、--clear-state 出口、
      跨会话 advisory 文案；
    - 新增 harness-runner.ts --clear-state 子命令；schema_version 1.0 → 1.1；
    - .current-phase.json 新增 session_id / session_id_recorded_at /
      last_seen_session_id / last_seen_at 字段（向后兼容：缺失即按"未盖章"处理）；
    - 与 [CLAUDE.md §5.1.1] 协同。
-->

