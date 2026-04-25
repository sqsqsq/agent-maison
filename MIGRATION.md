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

## 子模块（submodule）更新

仅更新 framework 代码而不改实例配置时：

```bash
git submodule update --remote framework
# 或进入 framework 目录按你们托管方式 pull / checkout 指定 tag
```

子模块更新后，若 `framework.config.json` 的 `schema_version` 或 harness 契约有破坏性变更，维护者应在 **framework 的 CHANGELOG / 发布说明**中注明；实例侧仍建议走一次 **`/framework-init` UPDATE**，让 Skill 根据新模板与校验规则对齐入口文件与路径说明。

---

## 新建实例 vs 老仓库迁入

- **新工程**：`git submodule add … framework` → `/framework-init`（CREATE）。
- **已有文档与代码**：同样先保证 `framework/` 存在，再 `/framework-init`；若已有 `doc/module-catalog.yaml` 等，在对话中与 Skill 对齐 **paths**，避免配置指向错误目录。

---

## 本文件与「实例侧迁移说明」的关系

**本 `MIGRATION.md` 留在 `framework/` 内**，供所有引入子模块的仓库只读参考。

若初始化 Skill 在实例根生成「迁移备忘」或「与当前 config 对齐的检查清单」，那是**针对该工程当前状态**的一次性产物，**不替代**本文的通用约定；二者冲突时以 **Skill 流程 + `framework.config.json` + harness 实际校验** 为准。

---

## 版本变更记录

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
