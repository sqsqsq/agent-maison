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

### v2.3：DevEco Studio 工具链识别 + ohosTest 装机闭环

**触发原因**：v2.2 落地的 `coding_hvigor_build` / `ut_hvigor_build` / `ut_hvigor_test` 三条 BLOCKER 在现代 DevEco Studio (≥ 5.0) 环境下全部以「未找到 hvigor」FAIL —— DevEco 5.0 起不再在工程根生成 `hvigorw.bat` 包装脚本，统一从安装目录调用 hvigor。v2.2 的「先看根 wrapper、再看 PATH」查找链全断。

**升级要点（实例侧需要做的事）**：

1. **新增必填配置 `framework.config.json > toolchain.devEcoStudio.installPath`**
   - 形态见 [framework/harness/config.ts](harness/config.ts) `ToolchainConfig`；典型值如 `D:/Program Files/Huawei/DevEco Studio`。
   - 推荐：跑 `/framework-init` 进入 UPDATE 模式，Skill 00 Step 5.6 会自动调 `framework/harness/scripts/detect-deveco.ts` 探测候选并让用户确认。
   - 也可手工编辑 `framework.config.json` 后跑 `npx ts-node framework/harness/scripts/detect-deveco.ts --path "<your-path>" --json` 验证。

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
- 全套：`cd framework/harness && npm test`（16 unit + 9 fixture，约 25s）。
- 端到端：在 home-page 上跑全 6 阶段 `harness-runner.ts --feature home-page --phase X`，要求真机在线。

### v2.2：tsc 静态扫描 + 改源码门禁 + named_handler 放宽（历史）

未在本文记录细节，可在 git log 里搜 `feat(harness): v2.2`。
