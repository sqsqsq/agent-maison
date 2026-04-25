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

---

## 10. 历史注记

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
