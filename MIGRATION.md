# Framework 升级与迁移说明

本文描述**实例工程**在 framework 子模块或配置演进时的预期做法。详细操作以 Skill 正文为准。

---

## 首选路径：初始化 Skill 的 UPDATE 模式

当实例根已存在 `framework.config.json` 时，再次执行 [`00-framework-init`](skills/00-framework-init/SKILL.md)（`/framework-init` 或自然语言触发）应进入 **UPDATE** 模式：

1. 读取当前 JSON 与本次拟定变更，向用户展示 **diff**（键级或 `architecture` 段级）。
2. 仅在用户明确确认后写回 `framework.config.json` 及受影响的入口/文档骨架。
3. **切换 `agent_adapter`** 时：先列出将新增或可能与旧产物冲突的路径，得到同意后再写入；**不自动强删**历史文件，删除操作建议用户确认后手工或分步执行。

因此：**日常 framework 版本跟进、路径调整、架构 DSL 修订**，应通过 UPDATE 模式收敛到可审的交互流程，而不是手工散落改多份文件。

---

## 把 framework 部署到目标工程：两种模式

### 模式 A：Vendor（直接拷源码，无独立 git 仓库）

适用场景：framework 不作为独立 git 仓库管理，作为**目标工程仓库的一部分**跟随提交；典型如「壳子工程训练 framework，定期同步到一个或多个真实业务工程」。

> **设计原则**：用户/AI 唯一的**手工**动作 = "把 `framework/` 整目录搬到目标工程根"。同步完成后跑 `/framework-init`，**剩下所有事**（npm install、`npm test` 自检、配 `framework.config.json`、配 `toolchain.devEcoStudio.installPath`、harness 验收）**全部由 Skill 00 内部完成**。绝不要让用户在 vendor 之后再手工跑额外命令。

#### 首次部署 / 升级（同一组命令）

在**当前 framework 源仓库**（即维护 framework 的工程）根目录执行：

```bash
# Linux / macOS / WSL
rsync -a --delete \
  --exclude 'node_modules' \
  --exclude 'dist' \
  --exclude 'reports/*' \
  --exclude 'trace' \
  framework/ <target-repo>/framework/
```

```powershell
# Windows PowerShell
robocopy .\framework <target-repo>\framework /MIR /XD node_modules dist reports trace
```

排除项说明（这些都是运行产物，已被 `.gitignore`，不是 framework 本体）：
- `node_modules` / `dist` — npm 安装结果与 ts 编译产物，目标工程会自己重建
- `reports/*` — harness 跑出的报告（保留 `reports/.gitkeep`）
- `trace` — 调试 trace 目录

同步到目标工程后，重跑 `cd framework/harness && npx ts-node harness-runner.ts --phase init`（或 `/framework-init`）时，`check-init` 会在体检 **#11 之前** 自动执行 `ensureCanonicalGitignore`（SSOT：`framework/harness/scripts/utils/canonical-gitignore.ts`）：
- 若已存在等价规则（如 `**/node_modules` / `**/package-lock.json` / `framework/harness/reports/*`），不重复追加。
- 若缺少 canonical 规则，会幂等追加 **16 条** pattern（含 `doc/features/*/*/reports/*`、`**/.hylyre/`、`**/tmp_hypium/`、`/doc/app-snapshot-cache/`、`/doc/features/_adhoc/` 等；详见 SKILL 00 §5.4.5.1）。
- Skill 0 草稿：`doc/catalog-staging/`、`doc/glossary-staging/`；机制备份：`.framework-backup/`。
- **勿手抄** `/harness/reports/*`（缺 `framework/` 前缀无效）；旧错行可手删，脚本只追加、不自动删除。
- 该步骤只新增忽略规则，不重排或删除用户已有 `.gitignore` 内容。追加摘要见 `check-init.json` → `gitignore_sync`。

#### 同步完成后，在目标工程根跑 `/framework-init`

剩下所有动作**全部**由 Skill 00 闭环：

| Skill 00 子步 | 做的事 |
|---|---|
| Step 0.3 | 体检 10 项产物 + 决议 CREATE / UPDATE 模式 |
| Step 0.2.5 | 显式选定 `agent_adapter`（generic / claude / cursor） |
| Step 1~4 | 元数据 + 架构 DSL + adapter 入口文件 |
| Step 5.1~5.4 | 写 `framework.config.json` + `doc/architecture.md` 等骨架 |
| **Step 5.5** | `cd framework/harness && npm install`（装 harness 依赖） |
| **Step 5.5.4** | `npm test` 自检（v2.3 起加入）—— 验证 framework vendor 完整且行为正常，**任何失败都阻断后续步骤** |
| **Step 5.6** | 调 `detect-deveco.ts` 自动探测 + 用户确认，写入 `toolchain.devEcoStudio.installPath`（v2.3 起加入） |
| Step 6 | 跑 `harness-runner.ts --phase catalog` / `glossary` 校验骨架 |
| Step 7 | 收尾汇报跳过项与下一步指引 |

**严禁**：
- 在 vendor 之后让用户手工跑 `npm install` / `npm test` / `detect-deveco.ts` —— 这些都由 `/framework-init` 触发。
- 把 Step 5.5.4 自检失败解释为"环境问题"跳过 —— framework 自带套件不依赖外部工具链，失败一定是 vendor 漏文件或 framework 自身 bug。
- 在初始化途中绕过 Skill 直接编辑 `framework.config.json` 或拷贝 adapter 模板 —— 体检 + diff 流程的存在就是为了防止覆盖既有资产。

### 模式 B：Submodule（framework 独立 git 仓库）

适用场景：framework 已抽取为独立 repo，被 3+ 个工程通过 `git submodule` 共用；维护者希望"一处发布、多处升级"。

#### 首次部署

```bash
# 在目标工程根执行
git submodule add <framework-repo-url> framework
git submodule update --init --recursive
# 之后跑 /framework-init，与 Vendor 模式同步完成后的流程一致
```

#### 升级

```bash
git submodule update --remote framework
# 或进入 framework 目录按你们托管方式 pull / checkout 指定 tag
```

子模块更新后，若 `framework.config.json` 的 `schema_version` 或 harness 契约有破坏性变更，维护者应在 **framework 的 CHANGELOG / 发布说明**中注明；实例侧仍建议走一次 **`/framework-init` UPDATE**，让 Skill 根据新模板与校验规则对齐入口文件与路径说明，并触发 Step 5.5.4 自检确认 submodule 拉得完整。

---

## 模式选择建议

| 场景 | 推荐模式 |
|---|---|
| 单壳子工程训练 framework + 1~2 个真实业务工程 | **Vendor**（投入小，演化期适用） |
| framework 稳定，3+ 真实工程共用 | **Submodule**（一处升级，多处生效） |
| framework 还在剧烈演化（如 v2.x 这个阶段） | **Vendor**（每次同步前能 diff，便于回滚单次同步） |

---

## 本文件与「实例侧迁移说明」的关系

**本 `MIGRATION.md` 留在 `framework/` 内**，供所有引入子模块的仓库只读参考。

若初始化 Skill 在实例根生成「迁移备忘」或「与当前 config 对齐的检查清单」，那是**针对该工程当前状态**的一次性产物，**不替代**本文的通用约定；二者冲突时以 **Skill 流程 + `framework.config.json` + harness 实际校验** 为准。

---

## 版本变更记录

### Feature-phase harness 报告外置（`paths.reports_dir_pattern`）

**适用范围**：已将 instance 升级到支持 `paths.reports_dir_pattern` 的 harness；希望 feature 维度脚本报告、`trace.json`、合并报告等与 `doc/features/<feature>/` 同树的工程。

**行为摘要**：

- **`paths.reports_dir_pattern`**（占位符 `<feature>`、`<phase>`）：解析为实例根下目录；推荐默认 **`doc/features/<feature>/<phase>/reports`**。
- **未配置**：harness **回退**写入 **`framework/harness/reports/<feature>/<phase>/`**（与 `_global/` 并存）。
- **`_global` 哨兵**：`init` / `catalog` / `glossary` / `docs` / `extensions` 等全局阶段始终在 **`framework/harness/reports/_global/<phase>/`**，不参与本重写规则。

**实例 checklist**：

1. 跑 `/framework-init` UPDATE；`check-init` 第 1 项若 `confirm_keys` 含 `reports_dir_pattern`，在 Step 0.3.4 回答 **Q1.C**（默认推荐 **y**）；脚本写入：
   `merge-framework-config.mjs --apply --confirm-reports-dir-pattern=y`（**非手改 JSON**）。
2. 宿主 `.gitignore` 增加 **`doc/features/*/*/reports/*`**（或等价宽泛规则）；保留 `framework/harness/reports/*` 以对齐全局阶段与遗留布局。
3. 如有历史产物在 `framework/harness/reports/<feature>/`，可选执行下文「Legacy 报告手动迁移」专节（init **不自动搬文件**）。

#### Legacy 报告手动迁移（opt-in · init + Q1.C=y 之后）

> init 只 modernize config，**不搬磁盘文件**。不迁也不影响新 harness 产出路径。

**路径对照**：

| Legacy | 新路径 |
|--------|--------|
| `framework/harness/reports/<feature>/<phase>/*` | `doc/features/<feature>/<phase>/reports/*` |

**不要搬**：`framework/harness/reports/_global/**`、`.gitkeep`

**回执提醒**：若 `phase-completion-receipt.md` 的 `trace_json.path` 仍指 legacy，迁移后需改路径或重跑闭环。

**单 feature 示例（PowerShell，工程根）**：

```powershell
$feature = "hwp-channel"
$legacyRoot = "framework/harness/reports/$feature"
foreach ($phaseDir in Get-ChildItem -LiteralPath $legacyRoot -Directory -ErrorAction SilentlyContinue) {
  $phase = $phaseDir.Name
  $dest = "doc/features/$feature/$phase/reports"
  New-Item -ItemType Directory -Force -Path $dest | Out-Null
  Get-ChildItem -LiteralPath $phaseDir.FullName -Force | ForEach-Object {
    $target = Join-Path $dest $_.Name
    if (Test-Path $target) { Write-Host "skip: $target" }
    else { Move-Item $_.FullName $target }
  }
}
```

#### 一次性搬迁（Bash）

在**仓库根**执行。跳过目录 `_global`；同名目标文件已存在则打印 `skip` 不覆盖。

```bash
#!/usr/bin/env bash
set -euo pipefail
REPORTS_ROOT="${1:-framework/harness/reports}"
FEATURES_ROOT="${2:-doc/features}"

[[ -d "$REPORTS_ROOT" ]] || { echo "missing dir: $REPORTS_ROOT"; exit 1; }

shopt -s nullglob dotglob
for feature_dir in "$REPORTS_ROOT"/*; do
  [[ -d "$feature_dir" ]] || continue
  feature="$(basename "$feature_dir")"
  [[ "$feature" == "_global" ]] && continue

  for phase_dir in "$feature_dir"/*; do
    [[ -d "$phase_dir" ]] || continue
    phase="$(basename "$phase_dir")"
    dest="$FEATURES_ROOT/$feature/$phase/reports"
    mkdir -p "$dest"

    for path in "$phase_dir"/*; do
      [[ -e "$path" ]] || continue
      base="$(basename "$path")"
      if [[ -e "$dest/$base" ]]; then
        echo "skip (exists): $dest/$base"
        continue
      fi
      mv "$path" "$dest/"
    done
  done
done
shopt -u nullglob dotglob
```

#### 一次性搬迁（PowerShell）

```powershell
param(
  [string]$ReportsRoot = "framework/harness/reports",
  [string]$FeaturesRoot = "doc/features"
)
if (-not (Test-Path -LiteralPath $ReportsRoot)) { throw "missing $ReportsRoot" }

Get-ChildItem -LiteralPath $ReportsRoot -Directory | ForEach-Object {
  $feature = $_.Name
  if ($feature -eq "_global") { return }

  Get-ChildItem -LiteralPath $_.FullName -Directory | ForEach-Object {
    $phase = $_.Name
    $dest = Join-Path $FeaturesRoot $feature | Join-Path -ChildPath $phase | Join-Path -ChildPath "reports"
    New-Item -ItemType Directory -Force -Path $dest | Out-Null

    Get-ChildItem -LiteralPath $_.FullName -Force | ForEach-Object {
      $target = Join-Path $dest $_.Name
      if (Test-Path -LiteralPath $target) {
        Write-Host "skip (exists): $target"
      } else {
        Move-Item -LiteralPath $_.FullName -Destination $target
      }
    }
    if (-not (Get-ChildItem -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue)) {
      Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue
    }
  }
  $featurePath = Join-Path $ReportsRoot $feature
  if (-not (Get-ChildItem -LiteralPath $featurePath -Force -ErrorAction SilentlyContinue)) {
    Remove-Item -LiteralPath $featurePath -Force -ErrorAction SilentlyContinue
  }
}
```

**回归**：搬迁后任选 feature 跑一次 `cd framework/harness && npx ts-node harness-runner.ts --phase ut --feature <name> --summary`，确认新报告落在 `doc/features/<feature>/ut/reports/`（或与自定义 pattern 一致）。

### v2.4：framework 自带文档体系 + `--phase docs` 新鲜度门禁

**触发原因**：v2.3 之前，framework 的对外讲解材料散落在实例工程的 `doc/` 下（如 `HarmonyOS-AI研发框架全景介绍.md` / `业务级UT策划.md` 等），随 framework 演进很容易过期且与实例工程语境耦合。v2.4 把这些材料吸纳回 framework 自身，并新增"自动检查文档新鲜度"的 harness 阶段。

**新增 / 调整**：

1. **新增目录 `framework/docs/`**：framework 的对外文档统一归口于此（不是给实例工程看的 README，而是给"接入 framework 的开发者 + 跨部门同事 + 决策者"看的长期演进材料）。子目录约定：
   - `framework/docs/overview.md` — 全景介绍
   - `framework/docs/skills/<n>-<skill-name>.md` — 每个 Skill 的对外讲解（独立于 `framework/skills/<id>/SKILL.md` 的操作步骤）
   - `framework/docs/concepts/*.md` — 跨 Skill 的核心理念（如 `terminology-guarding.md`）
   - `framework/docs/operations/*.md` — 操作手册（如 `harness-runbook.md`）
   - `framework/docs/evolution/` — 占位，未来放跨大版本演进笔记

2. **新增 `framework/docs/DOC_INVENTORY.yaml`**：声明每份对外文档"关心"哪些 framework 内部资产（SKILL.md / phase-rules / harness 脚本 / agent_adapter 模板等）。

3. **新增 `--phase docs` 全局阶段**：
   - 实现：`framework/harness/scripts/check-docs.ts` + `framework/harness/scripts/utils/doc-freshness.ts`
   - 规则：`framework/specs/phase-rules/docs-rules.yaml`
   - 行为：对 inventory 中每份 doc 取 git committer date，对其 `sources[]` 也取 git committer date；任一 source 在 doc 之后改动过 → 报 MAJOR `doc_freshness`（doc 可能已过期）；source 路径在仓库内不存在 → 报 MAJOR `source_paths_resolvable`。
   - 入口：`cd framework/harness && npx ts-node harness-runner.ts --phase docs`（无 `--feature`，与 `catalog` / `glossary` 同为全局阶段）。
   - **不阻塞 CI**：docs phase 设计上不引入 BLOCKER，最高 MAJOR；目的是提醒维护者，而不是卡住业务功能开发。

4. **新增 unit 套件 `tests/unit/doc-freshness.unit.test.ts`**：覆盖 inventory schema 解析、空 sources / 缺失 git history / 多源 stale 等多条分支；接入 `tests/run-unit.ts > SUITES`，`npm test` 自动跑。

5. **`Phase` 类型扩展**：`framework/harness/scripts/utils/types.ts` 的 `Phase` 联合类型新增 `'docs'`；`isGlobalPhase` 同步认领。`harness-runner.ts > VALID_PHASES` 与 `--list` 帮助文本同步更新。

**实例侧迁移要点**：

- 若实例工程的 `doc/` 下仍存有 v2.3 之前从 framework 同步过来的总览类文档（典型文件名：`HarmonyOS-AI研发框架全景介绍.md` / `业务级UT策划.md` / `Harness全链路验证说明.md` / `自然语言到技术模块-演进路线图.md`），**应在升级到 v2.4 后删除**——它们已被 `framework/docs/` 内的对应版本取代。
- 实例工程**自有的**文档（如功能 PRD、design、test-plan、PPT 复盘材料等）**不受影响**，照常留在 `doc/` 下。
- vendor 模式同步 framework 时，确保 `framework/docs/`（包括 `DOC_INVENTORY.yaml`）一并随 framework 目录拷贝过去。
- 接入 v2.4 后跑一次 `npx ts-node harness-runner.ts --phase docs` 自检；若有 MAJOR，按 [`docs/operations/harness-runbook.md`](docs/operations/harness-runbook.md) §6.4 的对照表处理。

**回归方法**：
- `cd framework/harness && npm test` —— unit 套件应包含 `doc-freshness` 子项且全 PASS。
- `npx ts-node harness-runner.ts --phase docs` —— 主路烟雾，全 PASS 或仅显示已知 MAJOR（说明哪些 doc 该刷新）。
- **与 Skill 00 的关系**：`/framework-init`（`00-framework-init`）在 Step 5.5.4 **已自动跑** `npm test`；Step 6 **已包含** `--phase docs`（与 `catalog` / `glossary` 同为全局 phase）。用户**无需**在完整跑完初始化后再单独记两条命令自测；只有**未走 Skill 或只做了部分步骤**时，才需要手工补跑。

### v2.3：DevEco Studio 工具链识别 + ohosTest 装机闭环

**触发原因**：v2.2 落地的 `coding_hvigor_build` / `ut_hvigor_build` / `ut_hvigor_test` 三条 BLOCKER 在现代 DevEco Studio (≥ 5.0) 环境下全部以「未找到 hvigor」FAIL —— DevEco 5.0 起不再在工程根生成 `hvigorw.bat` 包装脚本，统一从安装目录调用 hvigor。v2.2 的「先看根 wrapper、再看 PATH」查找链全断。

**升级要点（实例侧需要做的事）**：

1. **新增必填配置 `framework.config.json > toolchain.devEcoStudio.installPath`**
   - 形态见 [framework/harness/config.ts](harness/config.ts) `ToolchainConfig`；典型值如 `D:/Program Files/Huawei/DevEco Studio`。
   - 推荐：跑 `/framework-init` 进入 UPDATE 模式，Skill 00 Step 5.6 会自动调 `framework/harness/scripts/detect-deveco.ts` 探测候选并让用户确认。
   - 也可手工编辑 `framework.config.json` 后跑 `cd <repo-root> && npx ts-node framework/harness/scripts/detect-deveco.ts --path "<your-path>" --json` 验证（cwd 见 [skills/reference/harness-cli-cwd.md](skills/reference/harness-cli-cwd.md)）。

2. **`coding_hvigor_build` 改为项目级 `assembleApp`**：v2.2 是按 `contracts.modules` 逐个 `assembleHap`，遇到 HAR/HSP 库模块（无 `assembleHap` task）会假阳性。v2.3 改为一次跑 `hvigor assembleApp`（项目级 hook task），覆盖所有产物。**对实例无破坏**，行为更严格而已。

3. **`ut_hvigor_build` 改用 `genOnDeviceTestHap`**：v2.2 调的 `OhosTestCompileArkTS` 是 hvigor 内部 task，CLI 直接拒收。v2.3 改为 `genOnDeviceTestHap`（对外的 hook task），同时跑 ArkTS 编译 + 装包 + 签名。**对实例无破坏**。

4. **`ut_hvigor_test` 改走 hdc + aa test**：v2.2 的 `hvigor test` 在 HAR 库模块上直接报 `TestAbility.ets does not exist`。v2.3 改为 `genOnDeviceTestHap` 出包 → `hdc install -r` → `hdc shell aa test` → 解析 hypium `OHOS_REPORT_RESULT`。**对实例的影响**：以前没跑通过 `ut_hvigor_test` 的工程，v2.3 起才真正能跑通；前提是接好真机/模拟器并配好 `installPath`。

5. **失败诊断细化**：`ut_hvigor_test` 报告 details 会标 `失败阶段：metadata / hap_not_found / install / run / no_pass`，按标签快速定位。

6. **环境变量自动注入**：`hvigor-runner.ts` 会从 `installPath` 派生并注入 `DEVECO_SDK_HOME`、`JAVA_HOME`、`<installPath>/jbr/bin` 入 PATH（已存在的用户值不覆盖）。无须实例侧再单独配。

7. **三个文档默认动作的同步**（v2.2 的 hvigor 命令样例已过时）：
   - Skill 3 Step 6.5：编码阶段编译闭环改为「跑 harness `--phase coding` 触发 `coding_hvigor_build`」，不再让 agent 手敲 `hvigorw ...`。
   - Skill 5 Step 7.5 / 7.6：UT 编译 / 装机闭环同样改为「跑 harness `--phase ut`」，避免 agent 拼错 `hvigor test` 命令。
   - Skill 00 Step 5.6：framework-init 增加 DevEco 路径配置子流程。

**回归方法**：
- 全套：`cd framework/harness && npm test`（条数以 `tests/run-unit.ts` + `tests/run-tests.ts` 为准）。
- 端到端：在 home-page 上跑全 6 阶段 `harness-runner.ts --feature home-page --phase X`，要求真机在线。

### v2.5：workflow、extensions 元阶段、lifecycle hooks、instance_skill_bridge（当前）

适用：已包含 `framework/workflows/`、`extension-loader`、`hooks-dispatcher`、`check-extensions` 与 adapter `instance_skill_bridge` 的 framework vendor。

**建议在实例 `framework.config.json`（UPDATE diff 确认）补齐：**

| 字段 | 说明 |
|------|------|
| `schema_version` | `"1.1"`（与 `framework/specs/framework.config.schema.json` 对齐） |
| `active_workflow` | 默认 `"spec-driven"` → `framework/workflows/spec-driven.workflow.yaml` |
| `lifecycle_hooks_enabled` | 默认 `true`；`false` 时 harness 跳过 lifecycle hook 派发 |
| `paths.extension_dir` | 默认 `"doc/extensions"` |

**升级后动作**：Skill 00 Step 5.4.6 补缺扩展目录骨架；在 **`<repo-root>`** 重新执行 `node framework/harness/scripts/render-agents-md.mjs ...` 刷新入口并按 adapter 生成扩展跳板 / slash（勿在 `framework/harness/` cwd 下写 `framework/harness/scripts/...` 前缀）；`cd framework/harness && npm test`。

> v3.1 起这些字段（含 `state_machine.*`、`paths.state_file` / `receipt_dir_pattern` / `docs_committed`、
> `toolchain.hvigor.*` 等）由 Skill 00 §5.1.A **机器化补缺合并**——见 §v3.1。

详见 [docs/concepts/extensibility.md](docs/concepts/extensibility.md) 与 [docs/evolution/extension-e2e-acceptance.md](docs/evolution/extension-e2e-acceptance.md)。

### v3.1：framework.config.json 字段级"只补缺、不覆盖"合并（merge-framework-config）

**触发原因**：v2.5 之前 Skill 00 §5.1 在 UPDATE 模式下只有「整文件替换 / 跳过」两档，
新版本 framework 引入新字段（如 `paths.extension_dir`、`paths.state_file`、`state_machine.*`、
`active_workflow`、`lifecycle_hooks_enabled`、`paths.docs_committed`、`toolchain.hvigor.*`）后，
老工程跑 `/framework-init` 无法机器化追平：选 Q1=y 会丢掉用户自定义的 `architecture` /
`project_name` 等字段；选 Q1=n 则新字段全漏。已观察到的真实事故：宿主工程 UPDATE 后仅补上
`project_profile` 单段，其它新字段全部缺失。

**升级后动作**（落在 framework 内，对实例**无破坏**）：

1. 新增 [scripts/utils/config-field-merger.ts](harness/scripts/utils/config-field-merger.ts)
   持有 `BACKFILL_FIELDS` 白名单（SSOT），定义"哪些字段允许在缺失时回填默认值"，
   默认值与 `harness/config.ts` 的 `DEFAULT_PATHS` / `DEFAULT_STATE_MACHINE` 单点对齐。
2. 新增 CLI 工具 [scripts/merge-framework-config.mjs](harness/scripts/merge-framework-config.mjs)：

   ```bash
   # 仅查看缺失字段与合并预览（不写盘）
   cd <repo-root> && node framework/harness/scripts/merge-framework-config.mjs --dry-run

   # 备份原文 → 字段级"只补缺、不覆盖"合并并写回
   cd <repo-root> && node framework/harness/scripts/merge-framework-config.mjs --apply
   ```

   `--apply` 会先把原 `framework.config.json` 备份到
   `<repo>/.framework-backup/<UTC>/framework.config.json`（与 adapter `auto_overwrite`
   机制同槽），再字段级合并写回。
3. `check-init.ts` 第 1 项（`inspect01`）在 POPULATED 时填充 `Inspection.missing_keys`，
   `stdout` 体检表的"诊断"列会追加一句「另有 N 个白名单字段缺失，建议跑
   `merge-framework-config.mjs --apply` 补齐」；`check-init.json` 携带完整字段路径列表。
4. Skill 00 §5.1.A 在 §0.3.4 表里追加 `Q1.A` 子问题：当 `missing_keys` 非空且用户已选 `Q1=n`
   时枚举（`Q1=y` 整文件替换涵盖该场景，自动跳过 `Q1.A`），用户 `y` 即调本 CLI `--apply`。

**Framework 维护者侧**——后续若再引入新字段，**只需**：

1. 在 [harness/config.ts](harness/config.ts) `DEFAULT_PATHS` / `DEFAULT_STATE_MACHINE`（或同级常量）
   给出真实默认值；
2. 在 [scripts/utils/config-field-merger.ts](harness/scripts/utils/config-field-merger.ts) 的
   `BACKFILL_FIELDS` 数组追加一条 `{ path, defaultValue, note }`；
3. 在 [templates/framework.config.template.json](templates/framework.config.template.json) skeleton
   一并写入（保持 CREATE 模式与白名单同源）。

老工程下一次 `/framework-init` UPDATE 就会自动机器化追平，**无需**维护者再去 MIGRATION 里
逐条 checklist。

**严禁纳入 BACKFILL**（须 Skill 交互或 confirm pass）：`project_name` / `agent_adapter` /
`architecture.*`（必填）、`toolchain.devEcoStudio.*`（由 Skill 5.6 detect-deveco 独立交互处理）、
`prd.*`（opt-in，需手工选 strict/warn/reachable/off 档位）、`atomic_service.*`（预留位）、
`paths.reports_dir_pattern`（行为级变更，经 Skill 00 **Q1.C** + `--confirm-reports-dir-pattern=y`
写入）。legacy 顶层 `project_type` 由 **MIGRATION_RULES**（Pass 2）在 `--apply` 时自动 modernize。

### v3.3.2：init config 三 pass 同步（BACKFILL + MIGRATION + CONFIRM）

**适用范围**：framework 升级到含 `MIGRATION_RULES` / `CONFIRM_FIELDS` 的 harness 后，老实例
`/framework-init` UPDATE 须机器化 modernize `framework.config.json`，**不要求维护者手改 JSON**。

**三 pass 摘要**（SSOT：[config-field-merger.ts](harness/scripts/utils/config-field-merger.ts)）：

| Pass | 机制 | 典型字段 | init 入口 |
|------|------|----------|-----------|
| 1 BACKFILL | 只补缺失 key | `paths.state_file`、`state_machine.*`、`toolchain.hvigor.*` | §5.1.B / Q1.A → `--apply` |
| 2 MIGRATION | modernize 已有 key | `project_type` → `project_profile.sub_variant` | 同上（含于 `--apply`） |
| 3 CONFIRM | 行为级变更 | `paths.reports_dir_pattern` | Q1.C → `--confirm-reports-dir-pattern=y\|n` |

**`reports_dir_pattern` 默认值 SSOT**：`config.ts` → `DEFAULT_REPORTS_DIR_PATTERN`（**故意不在** `DEFAULT_PATHS`，避免 `normalizeConfig` 在磁盘未配置时 runtime 偷偷切到新路径；Q1.C=n 须保持 legacy 回退）。

**发布说明**：[RELEASE-NOTES-v3.3.md](RELEASE-NOTES-v3.3.md)

1. 升级 `framework/` submodule 后跑 `/framework-init` UPDATE。
2. `check-init` 第 1 项查看 `missing_keys` / `migration_keys` / `confirm_keys`。
3. Step 5.1.B：`merge-framework-config.mjs --apply`（backfill + migration）。
4. Q1.C=y：`merge-framework-config.mjs --apply --confirm-reports-dir-pattern=y`。
5. （可选）按上文「Legacy 报告手动迁移」搬迁旧报告文件。

**回归**：`cd framework/harness && npm test`（`config-field-merger` + `init-update-policy` 套件）。

**已纳入白名单（v2.x+，`tools.hylyre.*`）**：hmos-app Skill 6 真机自动化配置。老实例缺
`tools` 段或缺任一子键时，`merge-framework-config.mjs --apply` 会按
`framework/harness/config.ts` 的 `DEFAULT_HYLYRE_TOOL_CONFIG` 补齐 7 个点分路径（与
`paths.state_file`、`toolchain.hvigor.*` 同级）。CREATE 模式还可由
`framework/profiles/hmos-app/config-defaults.json` 在 init 深度合并时带入整段 `tools.hylyre`。
已有 `hypium_page_name` 等定制值**不会被覆盖**。

**回归方法**：
- 单测：`cd framework/harness && npx ts-node tests/run-unit.ts`，包含
  `Suite [config-field-merger]` 10 用例 + `Suite [init-update-policy]` 的「inspect01 missing_keys」用例。
- 端到端：在缺字段的老工程上 `cd <repo-root> && node framework/harness/scripts/merge-framework-config.mjs --dry-run`
  查看缺失清单，再 `--apply` 验证写回内容（`git diff framework.config.json` 应仅新增白名单字段，
  不动 `architecture` / `project_name` 等敏感段）。

### adapter `update_policy` + `.framework-backup/`（实例侧 hooks/settings 等与 framework 对齐）

适用：已从本仓库 vendor / submodule **更新 framework** 后，老实例的 Claude Code **`hooks`、`settings.json`、verifier 子 agent** 等仍停在旧版本，导致 `npm test`（hook 行为）或其它 harness 契约回归。

**行为摘要**：

- [adapter-schema.yaml](agents/adapter-schema.yaml) 各段可选 `update_policy`：`prompt_if_changed`（**缺省**）或 `auto_overwrite`。Claude adapter 已对 `hooks` / `settings_file` / `commands.subagents` 声明 **`auto_overwrite`**。
- [check-init.ts](harness/scripts/check-init.ts)：体检 **#3 逐文件展开**， stdout / `check-init.json` 中带 `update_policy` 列；`auto_overwrite` 且 POPULATED **不进入** Skill 00 Step 0.3.4 的 `Q3.x`。
- **PASS** 时（除非 `CHECK_INIT_SKIP_MECHANISM_SYNC=1`）自动对该类目标 **`cp` → `.framework-backup/<UTC>/…` → 模板覆盖**。报告 `schema_version: "1.1"`，`mechanism_backup_rel_dir` / `mechanism_synced_files`。
- `.framework-backup/` 已计入体检 **#11** canonical `.gitignore`；Step 5.4.5 缺则补齐。

**实例 checklist**：

1. 更新 `framework/` 后在实例根重跑 **`/framework-init`**（UPDATE），保证 Step 0.3 跑出最新 `check-init`。
2. 若曾对机制文件做过**有意**本地补丁：PASS 前先阅体检表 drift，或改用 patch 挂载到不会被覆盖的路径；对齐后从 `.framework-backup/<timestamp>/` 取回对比。

### v2.6：框架升级兼容协议（compat）+ context-exploration 回填

适用：framework 升级后为**既有 feature** 增加新的脚本 BLOCKER（典型：Context Exploration Gate）时，需要在**不修改**实例 `framework.config.json` / 不升全局 schema 的前提下完成过渡。

**核心原则**：

- **framework.config.json 不承载任何具体 feature 名或豁免状态**；不出现「compat 段」或 legacy feature 列表。
- **过程态落在 feature 目录**：`doc/features/<feature>/compat.yaml`（约定文件名）。删除/归档 feature 即删除 compat。
- **决策延后到撞墙**：仅当用户对某 `--feature <name> --phase <phase>` 跑 harness 失败时，报告与 suggestion 给出双路径：**回填脚本（推荐）** vs **compat 临时降级**。
- **Skill 00**：零接触 compat（无 schema diff、无额外公告条目）。

**compat 行为概要**：

- harness 在写 `script-report.json` 前对 `CheckResult[]` 应用 `applyCompatDowngrade`；全局阶段（`init`/`catalog`/`glossary`/`docs`/`extensions`）与 `feature=_global` **短路**。
- 合法 compat 可将指定 `BLOCKER+FAIL` 降为 `MINOR+WARN`（并在报告增加 `compat_applied`）；`scheduled_backfill_by` 过期则注入 `compat_expired` BLOCKER。
- 字段 SSOT：`framework/specs/feature-compat.schema.yaml`；演进说明：`framework/docs/evolution/compat-protocol-v1.md`。

**回填脚本**：

```bash
cd framework/harness && npm run backfill:context -- --feature <name> --phases prd,design,coding,review,ut [--dry-run] [--overwrite]
```

成功后若曾使用 compat，请手动删除对应 `compat.yaml`。退出码：`0` 成功，`2` 参数/门禁错误，`3` 存在已存在文件且未 `--overwrite` 的跳过项。

**回归**：`cd framework/harness && npm test`；`npx tsc --noEmit -p tsconfig.json`。

### v2.9：Karpathy 四原则全生命周期 + context-exploration schema 1.1.0

适用：framework 升级后引入 **Agent 行为规约**、Context Exploration **量化 BLOCKER**、verifier **行为审查维度**，以及 profile 级 `exploration-snippets` 宿主路径注入。

**核心变更**：

| 层级 | 资产 | 说明 |
|------|------|------|
| Layer 1 | `framework/skills/reference/agent-behavioral-principles.md` | Research First / Minimum Viable / Surgical / Verify — 各 Skill Research Sub-Phase 强制前读 |
| Layer 2 | `context-exploration.md` schema **1.1.0** | 新增 `source_code_paths` / `exploration_mode` / `decisions_unlocked` + 正文 **Code Facts** 必填段 |
| Layer 2 | `phase-rules/*.yaml` → `exploration_thresholds` | 各阶段差异化阈值（min_source_code_paths、min_code_facts、require_subagent_when_* 等） |
| Layer 2 | `context-exploration.ts` | schema 1.1.0 启用 BLOCKER 量化校验；1.0.0 仍走旧 frontmatter 关键词逻辑 |
| Layer 2 | `profiles/<profile>/harness/exploration-snippets.yaml` | 宿主必查路径 overlay（hmos-app：`.ets`、`module.json5`、`build-profile.json5` 等） |
| Layer 3 | `verify-*.md` | 新增 `behavior_research_grounded` / `behavior_minimum_viable` / `behavior_scope_surgical` / `behavior_verify_loop`；`context_exploration_sufficiency` 升为 BLOCKER |
| 流程 | Skill 1–5 | Context Exploration Gate 升级为独立编号 **Research Sub-Phase** |
| 入口 | `AGENTS.md` / adapter rules | SSOT 表 + §3.7 Agent 行为规约 |

**向后兼容（迁移窗口）**：

- 既有 `context-exploration.md` 若 frontmatter 仍为 **`schema_version: "1.0.0"`**，harness 仅执行 v2.6 及以前的 frontmatter 关键词校验，**不强制**新字段。
- **新写入或主动升级**到 **`schema_version: "1.1.0"`** 的文件，须满足对应 phase 的 `exploration_thresholds`（yaml 未配置时 fallback 到脚本内宽松默认值）。
- 建议：新 feature 自 prd 起直接使用 1.1.0；既有 in-flight feature 可在下一 phase 升级，或继续 1.0.0 直至 feature 归档（不阻塞旧 harness PASS）。

**backfill 行为变更**：

```bash
cd framework/harness && npm run backfill:context -- --feature <name> --phases prd,design,coding,review,ut [--dry-run] [--overwrite]
```

- 回填模板现为 **schema 1.1.0**，且 **`ready_to_produce: false`**（不再自动设 `true` 放行主产物）。
- 回填成功仅生成**待补全骨架**；须 agent 完成真实探索、填 Code Facts / source_code_paths 后手动设 `ready_to_produce: true`，再跑 harness。
- 脚本对骨架预期未过门禁时 **warn 而非 exit 2**（便于批量生成占位文件）；真正 BLOCKER 在用户/agent 跑 `--phase <phase> --feature <name>` 时触发。

**实例维护者动作**（vendor / submodule 更新 framework 后）：

1. 阅读 [agent-behavioral-principles.md](skills/reference/agent-behavioral-principles.md)（agent 会话级约束已写入 `AGENTS.md` §3.7）。
2. 可选：对 in-flight feature 的 `context-exploration.md` 升级到 1.1.0 并补全 Code Facts（或依赖 v2.6 compat 临时降级至过期日）。
3. hmos-app 实例：确认 `framework/profiles/hmos-app/harness/exploration-snippets.yaml` 已 vendor；无需改 `framework.config.json`。
4. 重跑 `cd framework/harness && npm test`；对受影响 feature 重跑对应 `--phase` harness + verifier。

**零回归保证**：

- 未改 `framework.config.json` schema；compat 协议（v2.6）仍适用。
- verify 新增检查项不改变既有检查项语义；仅增加 fail 面。
- Skill 0 / init 无额外步骤；render `/framework-init` UPDATE 可刷新 `AGENTS.md` / `.cursor/rules/framework.mdc` 中的 §3.7 引用。

**验证**：`cd framework/harness && npm test`；`npx tsc --noEmit -p tsconfig.json`。

### v2.10：exploration_strategy — default-on + 复合评分 + sequential 等价

适用：大型代码库（单模块 10 万+ LOC）下，原 `require_subagent_when_*` 单一计数阈值不足以触发深度探索。

**核心变更**：

| 机制 | 说明 |
|------|------|
| `exploration_strategy` | phase-rules 新段；与 `exploration_thresholds` 并存 |
| design/coding **default-on** | 默认须 subagent；**L1 trivial**（rename/typo + loc<30 + 单层）可豁免 |
| prd/review/ut **scoring** | 复合评分（module_loc / scope / cross_layer / api_surface / fan_out），≥60 须 subagent |
| frontmatter 变更信号 | `change_intent` / `estimated_loc_delta` / `touches_layers` / `adds_new_exports` |
| sequential 等价 | 无 subagent 时用 `sequential`，量化阈值 × `sequential_multiplier`（默认 2.0） |
| `fan-out-scanner.ts` | 静态估算 in-scope 模块 import fan-out |

**向后兼容**：

- 无 `exploration_strategy` 段 → 回落 v2.9 `require_subagent_when_*` legacy 逻辑
- schema 1.1.0 不变；新 frontmatter 字段 optional（缺失时按非 trivial 处理）

**实例维护者**：

1. vendor framework 后确认 5 个 `phase-rules/*.yaml` 含 `exploration_strategy`
2. 新 feature 的 `context-exploration.md` 填写变更信号 frontmatter
3. design/coding 默认 `exploration_mode: subagent`；Chrys/generic 用 sequential + 更高量化阈值

**验证**：`cd framework/harness && npm test`

### v3.2：用户确认 UX SSOT + 静态 lint

新增 [framework/skills/reference/user-confirmation-ux.md](skills/reference/user-confirmation-ux.md) 与 [confirmation-registry.yaml](skills/reference/confirmation-registry.yaml)。

**维护者约定**：新增或修改 Skill 中的用户确认步骤时：

1. 先在 `confirmation-registry.yaml` 登记 `id` / `interaction_class`；
2. Skill 正文只链 SSOT（≤10 行），使用 gate/enum/portable 编号；
3. 跑 `cd framework/harness && npm test` —— `check-docs` 阶段会执行 `check-skills-confirmation-ux` BLOCKER。

adapter 可选字段 `user_confirmation`（见 [agents/adapter-schema.yaml](agents/adapter-schema.yaml)）声明 widget 能力；chrys/codemate 等内部 agent 使用 `generic` + `structured_widget: unsupported`。

### v3.3：Claude Code AskUserQuestion（Track B+ · agents 为主）

**动机**：v3.2 在 skills 层写 portable 编号，但 Claude adapter 仅声明模糊的 `native_options`，运行时 agent 常只画 Markdown 表而不调 widget。

**framework 侧变更**（约 7～8 源文件）：

1. [agents/claude/adapter.yaml](agents/claude/adapter.yaml)：`widget_tool_hint: AskUserQuestion`；启用 `rules` → `.claude/rules/`。
2. 新建 [agents/claude/templates/rules/confirmation-ux.md](agents/claude/templates/rules/confirmation-ux.md)（SHOULD 级会话规则）。
3. [agents/claude/templates/commands/framework-init.md](agents/claude/templates/commands/framework-init.md)：`prompts` choice 前置 adapter；正文跳过 Step 0.2.5.1 表格。
4. Skill 00 **仅 init**：§0.2.5.1 / Step 3.x / §0.3.4 **BLOCKER** 调 AskUserQuestion（Claude）或 AskQuestion（Cursor）。

**实例维护者**（真实工程移植后）：

```text
/framework-init   # UPDATE；Step 0.3 对 .claude/rules/confirmation-ux.md 与 framework-init.md 走 Q3 确认覆盖
```

**版本依赖**：slash `prompts` frontmatter 需较新 Claude Code CLI（约 2026-02+）；旧 CLI 忽略 frontmatter 时仍靠 `.claude/rules` + Skill 00 BLOCKER + portable 编号。

**明确未改**：Skill 1～6、confirmation-registry、user-confirmation-ux 扩写、AGENTS 模板、confirmation lint。

### v3.3.1：init.adapter Widget 固定文案

**动机**：Claude Code 调 `AskUserQuestion` 时 agent 自造 option description，曾出现 `.claude/commands/skills/`（不存在）与 `(Recommended)` 标签；slash 实例未同步时同样走 agent 自由扩写路径。

**framework 侧变更**（约 8 源文件）：

1. 新建 [skills/00-framework-init/templates/adapter-widget-options.md](skills/00-framework-init/templates/adapter-widget-options.md) — 4 条固定 label + UPDATE 1/4 等价脚注 + 反模式。
2. [skills/00-framework-init/SKILL.md](skills/00-framework-init/SKILL.md) §0.2.5.1 **BLOCKER** 逐字引用 SSOT，禁止自造路径。
3. [agents/claude/templates/commands/framework-init.md](agents/claude/templates/commands/framework-init.md) frontmatter label 与 SSOT 对齐。
4. [confirmation-registry.yaml](skills/reference/confirmation-registry.yaml) `init.adapter` 增 `widget_options_ref`；`widget_hint` 改为 `AskUserQuestion | AskQuestion`。
5. [user-confirmation-ux.md](skills/reference/user-confirmation-ux.md)、[agents/README.md](agents/README.md) 反模式 / 误写警示。

**实例维护者验收**（UPDATE init，Q3 覆盖后第二轮 `/framework-init`）：

1. `.claude/commands/framework-init.md` — slash label 与 SSOT 一致，无 `.claude/commands/skills/`。
2. `.claude/rules/confirmation-ux.md` — Track B+ 规则已下发。
3. 若走 agent `AskUserQuestion`：选项 1 含 `.claude/commands`，无 `(Recommended)`；菜单下方可见 1/4 等价脚注。

**验证**：`cd framework/harness && npm test`；`npx ts-node harness-runner.ts --phase docs`。

### v3.4：Claude AskUserQuestion 全覆盖（Track B+ · Skills 1–6 · agents-only）

**动机**：v3.3 仅 init 有 widget BLOCKER；Skills 1–6 的 20 个 registry 确认点仍只有 portable 文本菜单，Claude Code 下 agent 常跳过 `AskUserQuestion`。

**framework 侧变更**（仅 `framework/agents/claude/templates/` + harness lint + 文档；**不改** `framework/skills/**`、**不改**实例 `.claude/**`）：

1. [agents/claude/templates/rules/confirmation-ux.md](agents/claude/templates/rules/confirmation-ux.md) — SHOULD → **BLOCKER**；registry 20 点索引；SSOT 链接按部署后 `.claude/rules/` 路径（`../../framework/skills/...`）。
2. 新建 [agents/claude/templates/rules/widget-options/](agents/claude/templates/rules/widget-options/)（index + skill0–6 共 8 文件）— AskUserQuestion label SSOT。
3. 8 个 Skill slash（`prd-design` … `glossary-bootstrap`）注入 Widget BLOCKER 段；**不改** `framework-init.md`。
4. [harness/scripts/check-skills-confirmation-ux.ts](harness/scripts/check-skills-confirmation-ux.ts) — 增量 lint Claude templates。

**实例维护者**（vendor framework 后 **自行** UPDATE init；agent 不代写 `.claude/`）：

```text
/framework-init   # UPDATE；Step 0.3 对 rules/commands 走 Q3 确认覆盖
```

预期下发：`.claude/rules/confirmation-ux.md`、`.claude/rules/widget-options/*.md`、8 个 skill slash。

验收：confirmation-ux 含 BLOCKER；PRD Step 1.5 出现 AskUserQuestion + portable 脚注；init slash 行为不变。

**验证**：`cd framework/harness && npm test`。

### v2.2：tsc 静态扫描 + 改源码门禁 + named_handler 放宽（历史）

未在本文记录细节，可在 git log 里搜 `feat(harness): v2.2`。
