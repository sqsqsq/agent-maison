---
name: framework-skills 通用化收口
overview: 将 framework/skills 下与 hmos-app profile 重叠的"模板/示例/参考/预设"全部迁出到 framework/profiles/hmos-app/skills/...，framework/skills 一侧统一改为 5 行跳板，与 3-coding 已落地的模式对齐；同时清理少量残留 HMOS 措辞，保证 framework/skills 仅承载通用产物。
todos:
  - id: batch-1-design
    content: Batch 1：迁 2-requirement-design 4 份（design-template / api-spec / data-model / example-design）到 hmos-app profile，framework/skills 一侧改 5 行跳板，单独 commit
    status: completed
  - id: batch-2-prd
    content: Batch 2：迁 1-prd-design 2 份（prd-template / example-prd）到 hmos-app profile，framework/skills 一侧改 5 行跳板，单独 commit
    status: completed
  - id: batch-3-review
    content: Batch 3：迁 4-code-review/templates/review-checklist.md 到 hmos-app profile，原位改 5 行跳板（review-report-template 保留通用），单独 commit
    status: completed
  - id: batch-4-device
    content: Batch 4：迁 6-device-testing 2 份（test-plan-template / test-report-template）到 hmos-app profile，framework/skills 一侧改 5 行跳板，单独 commit
    status: completed
  - id: batch-5-init-catalog
    content: Batch 5：迁 preset-5-layer + glossary-term-template 到 hmos-app profile，中性化 architecture-presets / scan-project / SKILL.md / intra-layer-deps-confirm 与 profile 内 infer-glossary-term 的反向引用，单独 commit
    status: completed
  - id: batch-6-inventory-harness
    content: Batch 6：更新 DOC_INVENTORY.yaml 中 sources 指向 profile，跑 --phase docs 校验 + 必要时刷新 terminology-guarding 注记，单独 commit
    status: completed
isProject: false
---

# framework/skills 通用化收口

## 总原则

1. **profile 化标准**：含具体宿主语言 / 工程类型语义（HAR/HAP、ArkTS/ArkUI、`@kit.ArkUI`、`oh-package.json5`、`Hypium`、HarmonyOS API 等）的产物，全部迁到 [framework/profiles/hmos-app/skills/...](framework/profiles/hmos-app/skills/)。
2. **framework/skills 一侧形态**：与 [framework/skills/3-coding/reference/arkts-pitfalls.md](framework/skills/3-coding/reference/arkts-pitfalls.md) 已落地的"5 行跳板"完全一致——`# 跳板：xxx` + `权威正文已迁至 framework/profiles/hmos-app/skills/...` + 一行禁止追加业务条款的提醒。
3. **跳板 + SKILL 相对链接保持兼容**：各 SKILL.md 中既有的 `[xxx](templates/xxx.md)` 等相对链接**不修改**，让其仍解析到 5 行跳板，再由跳板指向 profile 正文（同 3-coding 模式）。
4. **profile 路径不引入 wallet 字样**：[framework/profiles/hmos-app/skills/00-framework-init/templates/preset-5-layer.sample.json](framework/profiles/hmos-app/skills/00-framework-init/templates/preset-5-layer.sample.json)（去掉 `wallet`）。
5. **每批落盘后跑 harness `--phase docs` 与已存在的 fixture**；统一在末尾汇总，按需追加 [framework/docs/DOC_INVENTORY.yaml](framework/docs/DOC_INVENTORY.yaml) 的 sources。

---

## 公共验证套件（每个 Batch 都要跑）

> 所有命令以仓库根为 cwd，默认 PowerShell。

### V0. 静态：跳板形态自检（每批必跑）

- **跳板文件不超过 12 行**：保证形态与 [framework/skills/3-coding/reference/arkts-pitfalls.md](framework/skills/3-coding/reference/arkts-pitfalls.md) 一致；用 ripgrep 抽查刚写入的跳板：
  ```powershell
  rg -n "^# 跳板：|权威正文已迁至" framework/skills
  ```
- **跳板内的相对链接可解析**：`权威正文已迁至 framework/profiles/hmos-app/skills/...` 路径需在 profile 下真实存在。改完后用 Glob 列出 profile 下对应文件确认。
- **profile 正文 = 旧 framework/skills 文件 verbatim**（除 preset 重命名 / 注释中性化）：用 `git diff --no-index --stat <旧 fw 文件@HEAD~1> <新 profile 文件>` 验证，diff 应仅含"file rename"或者文件全增（profile 新增）+ 全删（fw 旧文件被改 stub）这两种结构变化，**正文行内 diff 量为 0**。

### V1. 引用面回归（每批必跑）

- **旧路径在仓内不再被任何"权威性引用"**（跳板自身的反向链接除外，因其只指向 profile）：
  ```powershell
  rg -n "framework/skills/<本批被迁文件相对路径>" --glob "!framework/skills/**" --glob "!**/.cursor/plans/**" --glob "!doc/features/**"
  ```
  - 命中行**应只来自**：当批要修改的 SKILL.md / fixture 输入 / DOC_INVENTORY.yaml / check-*.ts 中的 suggestion 文案；这些已在对应批次列出处理。
  - 不属于上述名单的命中 = 漏改，必须补改。
- **profile 内是否含反向耦合到 framework/skills**：
  ```powershell
  rg -n "framework/skills/" framework/profiles
  ```
  Batch 5 专门处理 `infer-glossary-term.md` 第 218 行；其它命中应**全部为零**，否则属于"profile 反向依赖 framework/skills"，需要逐条记入下一轮整改。

### V2. Harness 单元 + fixture 全套（每批必跑）

- **单元测试**（17 个，不依赖 git 工作目录状态）：
  ```powershell
  cd framework/harness; npm run test:unit
  ```
- **fixture 回归**（含 framework + hmos-app + generic 三棵 fixture 树）：
  ```powershell
  cd framework/harness; npm run test:fixtures
  ```
  - 上述涉及 `init` / `prd` / `coding` / `ut` 等 fixture，**输入文件多为内联 mini-PRD / mini-design**，不引用 framework/skills 模板，因此迁移不影响其期望；任何意外 FAIL 都视为本批引入的退化，必须先修后提交。
  - 时间预算：完整跑约 90~180 秒；如本批仅触及非编译路径，可用 `npm run test:fixtures -- --filter <prefix>` 缩小范围（但 commit 前必跑全量）。

### V3. 真实 feature 路径 smoke（每批必跑）

- 仓内实际 feature `home-page` 已含 PRD/design/contracts。每批后做 smoke：
  ```powershell
  cd framework/harness; npx ts-node harness-runner.ts --phase prd --feature home-page
  cd framework/harness; npx ts-node harness-runner.ts --phase design --feature home-page
  cd framework/harness; npx ts-node harness-runner.ts --phase docs
  ```
  - **基线**：迁移前先跑一次记录 verdict 与 FAIL 列表（在 Batch 1 开工前生成 baseline）。
  - **本批后**：除"path 文案在 suggestion 里被引用"这类**纯文本提示**差异外，verdict + check 项数量 + BLOCKER 集合都应**与基线完全一致**；任一不一致即视为退化。

### V4. 提交前总闸（每批必跑）

- `git status` 干净到只剩本批文件。
- `git diff --stat` 行数与 plan 描述吻合（迁移类文件应为大块全删 + 大块全增 + 短跳板新增）。
- 单笔 commit 信息复用既有风格：`refactor(framework): <一句话> [<batch-id>]`。

---

## Batch 1 — 2-requirement-design（HMOS 化最深）

迁移文件（整篇 verbatim 移到 profile，目录不存在则新建）：

- [framework/skills/2-requirement-design/templates/design-template.md](framework/skills/2-requirement-design/templates/design-template.md) → `framework/profiles/hmos-app/skills/2-requirement-design/templates/design-template.md`
- [framework/skills/2-requirement-design/templates/api-spec.md](framework/skills/2-requirement-design/templates/api-spec.md) → 同名 profile 路径
- [framework/skills/2-requirement-design/templates/data-model.md](framework/skills/2-requirement-design/templates/data-model.md) → 同名 profile 路径
- [framework/skills/2-requirement-design/examples/example-design.md](framework/skills/2-requirement-design/examples/example-design.md) → `framework/profiles/hmos-app/skills/2-requirement-design/examples/example-design.md`

framework/skills 一侧改 5 行跳板（4 份），不动 [framework/skills/2-requirement-design/SKILL.md](framework/skills/2-requirement-design/SKILL.md) 的相对链接。

### Batch 1 验证策略

- 跑 V0/V1/V2/V3/V4 公共套件。
- V1 旧路径 ripgrep 命中应**只**来自：
  - [framework/skills/2-requirement-design/SKILL.md](framework/skills/2-requirement-design/SKILL.md)（L285 / L491 / L632 / L655 / L656 / L673 / L674 / L675 / L676，相对链接保留指向跳板，不改）
  - 跳板文件自身（4 份）写入的"权威正文已迁至..."一行
  - [framework/docs/DOC_INVENTORY.yaml](framework/docs/DOC_INVENTORY.yaml)（保留到 Batch 6 一并处理）
- **额外断言**：`hmos-app/skills/2-requirement-design/profile-addendum.md` 已经存在但本批不动；`profile-addendum.md` 与新迁入的 templates/examples 没有反向 import、不需要联动改。
- **回退点**：单笔 commit；如 V3 home-page `--phase design` verdict 退化，立即 `git revert` 本批 commit。

## Batch 2 — 1-prd-design

- [framework/skills/1-prd-design/templates/prd-template.md](framework/skills/1-prd-design/templates/prd-template.md) → `framework/profiles/hmos-app/skills/1-prd-design/templates/prd-template.md`
- [framework/skills/1-prd-design/examples/example-prd.md](framework/skills/1-prd-design/examples/example-prd.md) → `framework/profiles/hmos-app/skills/1-prd-design/examples/example-prd.md`

framework/skills 一侧改 5 行跳板（2 份）。

保留通用：[framework/skills/1-prd-design/templates/feature-card.md](framework/skills/1-prd-design/templates/feature-card.md)、[framework/skills/1-prd-design/reference/visual-handoff.md](framework/skills/1-prd-design/reference/visual-handoff.md)（自查无 HMOS 残留即可）。

### Batch 2 验证策略

- 跑 V0/V1/V2/V3/V4。
- **重点 fixture**：`framework/profiles/hmos-app/harness/tests/fixtures/prd/visual_handoff_`* 三组；本批不改 visual-handoff 文档与 prd-rules，期望 verdict 与基线完全相同。
- **重点 V3**：`harness-runner.ts --phase prd --feature home-page`——仓内 [doc/features/home-page/PRD.md](doc/features/home-page/PRD.md) 是真实数据；prd-template 迁出后 PRD 校验**不应**因模板路径变化而失败（check-prd.ts 只用 suggestion 文案引用模板路径，不读模板文件）。
- 旧路径残留 ripgrep 命中应**只**来自：
  - [framework/skills/1-prd-design/SKILL.md](framework/skills/1-prd-design/SKILL.md) L149 / L385 / L387（相对链接保留）
  - 2 份跳板文件自身
  - [framework/harness/scripts/check-prd.ts](framework/harness/scripts/check-prd.ts) L357（suggestion 文案，留待后续 polish，**本批不改**）
  - [framework/docs/DOC_INVENTORY.yaml](framework/docs/DOC_INVENTORY.yaml)（Batch 6 处理）
- **回退点**：commit 单笔；prd visual-handoff fixture 任一退化 → `git revert`。

## Batch 3 — 4-code-review

- [framework/skills/4-code-review/templates/review-checklist.md](framework/skills/4-code-review/templates/review-checklist.md) → `framework/profiles/hmos-app/skills/4-code-review/templates/review-checklist.md`（HAR/HAP/`oh-package`/`route_map.json`/`@Component`/`$r`/AppStorage 等深度 hmos-app）
- [framework/skills/4-code-review/templates/review-report-template.md](framework/skills/4-code-review/templates/review-report-template.md)：**保留**为通用（结构纯通用：审查范围 / 问题清单 / 严重程度统计 / 结论），仅自查无残留 HMOS 措辞。

framework/skills 一侧 review-checklist 改 5 行跳板。

### Batch 3 验证策略

- 跑 V0/V1/V2/V3/V4。
- **review-report-template 保留通用的判定**：在改之前用 ripgrep 自查 hmos 残留：
  ```powershell
  rg -in "har|hap|arkts|arkui|harmonyos|deveco|ohpm|oh-package|ets|@kit\." framework/skills/4-code-review/templates/review-report-template.md
  ```
  期望命中数 = 0；任何命中按用例评估是否要去除（通常仅在示例字符串里）。
- **review fixture**：framework/harness/tests/fixtures（如有 review 类）+ profiles/hmos-app/harness/tests/fixtures（如有 review 类）应全部 PASS。`npm run test:fixtures` 全量已覆盖。
- 旧路径残留 ripgrep 命中**只**来自 [framework/skills/4-code-review/SKILL.md](framework/skills/4-code-review/SKILL.md) L111 / L153 / L330 / L331 + 跳板自身 + Batch 6 待改 inventory。
- **回退点**：单笔 commit；如发现 review-report-template 中确有 hmos 措辞需要剥离，**追加**到本批 commit 内一起改，不另开 batch。

## Batch 4 — 6-device-testing

- [framework/skills/6-device-testing/templates/test-plan-template.md](framework/skills/6-device-testing/templates/test-plan-template.md) → `framework/profiles/hmos-app/skills/6-device-testing/templates/test-plan-template.md`（"HarmonyOS / API / DevEco Studio 模拟器"等 hmos-app 测试环境表深度耦合）
- [framework/skills/6-device-testing/templates/test-report-template.md](framework/skills/6-device-testing/templates/test-report-template.md) → 同名 profile 路径（同样含 HarmonyOS 字样）

framework/skills 一侧改 5 行跳板（2 份）。

### Batch 4 验证策略

- 跑 V0/V1/V2/V3/V4。
- **testing fixture**：`npm run test:fixtures` 全量；本批不改 testing-rules / check-testing.ts，期望与基线完全一致。
- 旧路径残留 ripgrep 命中**只**来自 [framework/skills/6-device-testing/SKILL.md](framework/skills/6-device-testing/SKILL.md) L107 / L186 / L356 / L357 + 跳板自身 + Batch 6 待改 inventory。
- **回退点**：单笔 commit；如 testing fixture 任一意外 FAIL → `git revert`。

## Batch 5 — 00-framework-init + 0-catalog-bootstrap 收尾

- [framework/skills/00-framework-init/templates/preset-wallet-5-layer.sample.json](framework/skills/00-framework-init/templates/preset-wallet-5-layer.sample.json) → `framework/profiles/hmos-app/skills/00-framework-init/templates/preset-5-layer.sample.json`（重命名去 wallet；内容已是中性的 5 外层 + sublayer JSON，无需改）。framework/skills 原文件**直接删除**（`.json` 类预设没有 markdown 跳板的意义）。
- [framework/skills/0-catalog-bootstrap/templates/glossary-term-template.yaml](framework/skills/0-catalog-bootstrap/templates/glossary-term-template.yaml)（含 CardManager/WalletMain 钱包举例）→ `framework/profiles/hmos-app/skills/0-catalog-bootstrap/templates/glossary-term-template.yaml`。framework/skills 一侧改成 yaml 注释跳板（与现有 [framework/skills/0-catalog-bootstrap/templates/module-card-template.yaml](framework/skills/0-catalog-bootstrap/templates/module-card-template.yaml) 的"占位副本"模式一致——5-10 行 `# 权威正文已迁至 ...` 注释 + 一句"请勿在本文件追加业务条款"，**不**保留 80 行重复内容；与 module-card-template 的现有占位副本风格统一时再回头瘦身——见末尾"附加项"）。

文案中性化（不删除文件，仅小改）：

- [framework/skills/00-framework-init/prompts/architecture-presets.md](framework/skills/00-framework-init/prompts/architecture-presets.md)：
  - "选项 A：参考实例 — 五层外层 + 子层（钱包回归同款）" → "选项 A：参考实例 — 5 外层 + 子层"
  - 链接路径同步改成 `../../../profiles/hmos-app/skills/00-framework-init/templates/preset-5-layer.sample.json`
- [framework/skills/00-framework-init/prompts/scan-project.md](framework/skills/00-framework-init/prompts/scan-project.md)：表格中"五层钱包式"行改成"参考实例（5 外层 + sublayer）"，特征只列 `01-Product`～`05-SystemBase` 物理结构，去掉"wallet"字样。
- [framework/skills/00-framework-init/SKILL.md](framework/skills/00-framework-init/SKILL.md) Step 326 行：链接改为 `framework/profiles/hmos-app/skills/00-framework-init/templates/preset-5-layer.sample.json`，措辞同步去 wallet。
- [framework/skills/00-framework-init/templates/intra-layer-deps-confirm.template.md](framework/skills/00-framework-init/templates/intra-layer-deps-confirm.template.md)：删/改一句"钱包 preset 的 `01/02/04 = forbid、03 = dag、05 = sublayer` 是有意的设计选择"——改为"参考实例 preset 的同层策略组合是有意的设计选择，不是唯一正确答案"。
- [framework/profiles/hmos-app/skills/0-catalog-bootstrap/prompts/infer-glossary-term.md](framework/profiles/hmos-app/skills/0-catalog-bootstrap/prompts/infer-glossary-term.md) 第 218 行：`framework/skills/0-catalog-bootstrap/templates/glossary-term-template.yaml` → `framework/profiles/hmos-app/skills/0-catalog-bootstrap/templates/glossary-term-template.yaml`（profile 内引用应指向 profile 内正文，避免反向耦合）。

### Batch 5 验证策略

- 跑 V0/V1/V2/V3/V4。
- **init / catalog / glossary fixture 重点保**：
  ```powershell
  cd framework/harness; npx ts-node tests/run-tests.ts --filter init
  cd framework/harness; npx ts-node tests/run-tests.ts --filter catalog
  cd framework/harness; npx ts-node tests/run-tests.ts --filter glossary
  ```
  - `framework/profiles/hmos-app/harness/tests/fixtures/init/{create_empty_pass,update_diff_detected}` 是 **init phase 的核心 contract**；`update_diff_detected` 的 INPUT 含 [framework.config.json](framework/profiles/hmos-app/harness/tests/fixtures/init/update_diff_detected/INPUT/framework.config.json) 与 [CLAUDE.md](framework/profiles/hmos-app/harness/tests/fixtures/init/update_diff_detected/INPUT/CLAUDE.md)，本批没改 init schema 或模板渲染逻辑，期望与基线完全相同。
  - 若有 fixture 引用 `preset-wallet-5-layer.sample.json` 旧路径（用 `rg -n preset-wallet framework/profiles/hmos-app/harness/tests/fixtures` 验证），需要在本批同步改 fixture 引用。
- **额外引用面扫描**（preset 重命名 + 删除 fw 旧文件）：
  ```powershell
  rg -n "preset-wallet-5-layer" .
  rg -n "preset-5-layer\.sample\.json" .
  ```
  前者命中应**等于 0**（已全删/重命名）；后者命中应**只**来自：profile 新文件 / `architecture-presets.md` 重写后的链接 / `00-framework-init/SKILL.md` Step 3 链接。
- **glossary harness**：
  ```powershell
  cd framework/harness; npx ts-node harness-runner.ts --phase glossary
  cd framework/harness; npx ts-node harness-runner.ts --phase catalog
  ```
  本批触及 `glossary-term-template.yaml` 文件位置 + `infer-glossary-term.md` 内反向引用，但都不影响 schema 校验本身；期望 verdict 与基线一致（仓内已有 [doc/glossary.yaml](doc/glossary.yaml) / [doc/module-catalog.yaml](doc/module-catalog.yaml) 真实数据）。
- **架构问卷形态自检**：手动 Read 改后的 [framework/skills/00-framework-init/templates/intra-layer-deps-confirm.template.md](framework/skills/00-framework-init/templates/intra-layer-deps-confirm.template.md)，确认 `01/02/04` 类示例字串没有"钱包"字眼但保留"参考实例 preset"作为可读上下文。
- **回退点**：本批改动面最广，**强烈建议拆成 5a + 5b 两笔 commit**：
  - 5a：纯文件迁移（preset / glossary-term-template）
  - 5b：文案中性化 + profile 内反向引用修复
  - 任一笔 fixture 退化即 `git revert` 该笔，定位后再合上。

## Batch 6 — DOC_INVENTORY + harness 校验 + 提交

- 在 [framework/docs/DOC_INVENTORY.yaml](framework/docs/DOC_INVENTORY.yaml)：
  - 第 91 行 `framework/skills/1-prd-design/templates/prd-template.md` → 替换为 `framework/profiles/hmos-app/skills/1-prd-design/templates/prd-template.md`（terminology-guarding 的 sources 应跟随正文位置；跳板路径不入 inventory）。
  - 自查其它 sources 是否也指向被迁出的旧路径，统一改为 profile 路径。
- 跑：
  - `cd framework/harness && npx ts-node harness-runner.ts --phase docs`（doc_freshness 期望 PASS；若新提交导致 sources 时间戳晚于 doc，需要在 terminology-guarding.md 文末刷新一次"last-synced"注记后再 commit）。
  - 已存在的 hmos-app fixture 抽样运行（`init` / `prd` / `coding` 等），仅作 smoke——不展开。
- 单笔或分批 commit：每个 Batch 一个 commit，最后一笔单独提交 inventory + harness 校验产物（按 framework 既有 commit 风格 `docs(framework): ...` / `refactor(framework): ...`）。

### Batch 6 验证策略

- **inventory schema 不破坏**：
  ```powershell
  cd framework/harness; npm run test:unit
  ```
  其中 `tests/unit/doc-freshness.unit.test.ts` 直接覆盖 `parseInventory` 与 `compareTimestamps`，inventory 字段错配会立即 FAIL。

- **doc_freshness 复盘闭环**：
  ```powershell
  cd framework/harness; npx ts-node harness-runner.ts --phase docs
  ```
  期望 verdict = `PASS`，0 个 FAIL。若 [framework/docs/concepts/terminology-guarding.md](framework/docs/concepts/terminology-guarding.md) 仍因 sources 时间戳晚被标 MAJOR：在文末 `last-synced` 注记刷新一行（参考 commit `0d2c053` 的形态），重提一次 commit，再跑直至 PASS。**绝不**通过缩小 sources 列表来"消除"MAJOR——sources 是反向追溯链路，删了等于盲区。

- **inventory ↔ 实际位置交叉校验**：
  ```powershell
  rg -n "framework/skills/" framework/docs/DOC_INVENTORY.yaml
  ```
  命中行应**只剩**通用骨架文件（如 `framework/skills/00-framework-init/SKILL.md`、`framework/skills/0-catalog-bootstrap/SKILL.md` 等），**不含**已被迁出的 templates / examples / preset 路径。

- **整体回归**：
  ```powershell
  cd framework/harness; npm test
  ```
  即 `npm run test:unit && npm run test:fixtures` 全套；与 Batch 1 起步前记录的 baseline 逐项 diff，verdict 不退化。

- **真实 feature 闭环**：
  ```powershell
  cd framework/harness; npx ts-node harness-runner.ts --phase prd     --feature home-page
  cd framework/harness; npx ts-node harness-runner.ts --phase design  --feature home-page
  cd framework/harness; npx ts-node harness-runner.ts --phase docs
  cd framework/harness; npx ts-node harness-runner.ts --phase catalog
  cd framework/harness; npx ts-node harness-runner.ts --phase glossary
  ```
  全部 verdict = `PASS`（与 baseline 一致或更好）。

- **回退点**：本批是单文件 inventory + 极小注记改动，commit 单笔；任一回归退化即 `git revert` 本批 commit，立即定位是上游某 batch 漏改还是 inventory 路径笔误。

---

## 全局基线（Batch 1 开工前必须做一次）

> 本节解决"修改后到底跟谁比？"——所有 Batch 的"verdict 与基线一致"参照都来自这次基线。

```powershell
git status
git rev-parse HEAD                                                                       | Tee-Object framework/harness/.baseline-head.txt
cd framework/harness; npm test                                                           | Tee-Object .baseline-tests.txt
cd framework/harness; npx ts-node harness-runner.ts --phase docs                         | Tee-Object .baseline-docs.txt
cd framework/harness; npx ts-node harness-runner.ts --phase catalog                      | Tee-Object .baseline-catalog.txt
cd framework/harness; npx ts-node harness-runner.ts --phase glossary                     | Tee-Object .baseline-glossary.txt
cd framework/harness; npx ts-node harness-runner.ts --phase prd     --feature home-page  | Tee-Object .baseline-home-prd.txt
cd framework/harness; npx ts-node harness-runner.ts --phase design  --feature home-page  | Tee-Object .baseline-home-design.txt
```

- baseline 落到 `framework/harness/.baseline-*.txt`（**不**入库；commit 前 `git restore --staged` + `git clean` 清掉，或加入本地 `.git/info/exclude`）。
- 此后每个 Batch 末尾跑同样 6 条命令对比；diff 仅允许"路径文案变化"，不允许 verdict / BLOCKER / FAIL 项数量变化。
- **若基线本身已含 FAIL**（例如某 fixture 已退化）：先把基线修绿再开 Batch 1；不允许把退化态当作"参照"。

## 不在本轮范围（明确标注，避免越界）

- check-prd.ts L357 / check-glossary.ts L145 中 suggestion 文案对 framework/skills 旧路径的引用：因跳板仍在原位置，**不必**改 ts；如要进一步指向 profile 正文是后续 polish，留待后续。
- generic profile（[framework/profiles/generic/](framework/profiles/generic/)）下的 templates / examples 缺位补齐：本轮不主动补，仅承诺"未来其它 profile 接入时补 addendum"——这是 framework 设计本身的态度。
- [framework/skills/0-catalog-bootstrap/templates/module-card-template.yaml](framework/skills/0-catalog-bootstrap/templates/module-card-template.yaml) 现状是"指针 + 80 行占位副本"。是否进一步瘦身到 5 行跳板，按 Batch 5 末尾"附加项"在 glossary-term-template 一并完成时同步执行（一致性优先）。

## 风险与回退

- **跳板 + SKILL 链接不变**的兼容策略：风险点是 SKILL 中"参考某模板"的语义会通过跳板二跳指向 profile，弱模型可能停在跳板不再前进——已通过 SKILL Step 0「载入 profile addendum（强制）」保证 agent 先读 addendum；跳板本身的措辞也明示"权威正文已迁至..."。
- **harness `doc_freshness` 抖动**：迁移会让 prd-template/glossary-term-template 等 source 文件的 git mtime > terminology-guarding.md，可能再次出 MAJOR；Batch 6 中以"刷新文末 last-synced 注记 + commit"消解。
- **回退**：每 Batch 一笔 commit，回退即 `git revert <hash>`。

