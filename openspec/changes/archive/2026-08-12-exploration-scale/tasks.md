# Tasks: Exploration Scale

## 1. facts.md 契约

- [x] facts 模板 + frontmatter schema（established_by / key_inputs_read / phase_delta 节）——`harness/scripts/utils/context-facts.ts`，established_by 只认 `spec`/`change`（FACTS_ESTABLISHING_PHASES）
- [x] 七个 feature phase 的 exploration 规则改"facts 存在 + 本阶段 delta 节"（spec/plan/coding/review/ut/testing/change 建立态，plan/coding/review/ut/testing/exit delta 态；testing/change/exit 此前从未有探索门禁，本次新增）
- [x] exploration_strategy 首建全额 / 后续降额——只有建立阶段（spec/change）复用既有 `runQuantitativeChecks` 量化阈值+subagent 强制；其余全部降为轻量 `## phase_delta: <phase>` 节存在性检查（无条件降额，比"按 track 分支降额"更简单，详见 C4 批次 1 实现记录）
- [x] check-receipt 凭证指向 facts.md#phase_delta（经 C2 policy 分派）——实测 check-receipt.ts 的 `context_exploration.summary_path` 机制本就是路径无关的通用文件存在性校验，指向 facts.md 无需改代码，只需 agent 侧（SKILL.md）填对路径

## 2. 兼容与 backfill

- [x] 旧 per-phase context-exploration.md 读取兼容（WARN 提示 backfill）——`checkFactsArtifact` 的 legacy fallback 分支；检查项 id 统一用 `context_exploration_facts_*` 前缀以兼容既有 `compat.yaml` 的 `context_exploration_*` 通配豁免声明（实测 3 个 fixture 验证过这个兼容面）
- [x] backfill-context-exploration.ts `--to-facts` 归并（幂等）——按 spec→plan→coding→review→ut→testing 序取最早存量文件做 established_by 全量来源，其余转 phase_delta；手工 smoke 测试验证归并产物通过 checkFactsArtifact
- [x] 新旧布局双夹具——`lite/change_pass`/`lite/exit_pass` 补 facts.md；3 个 spec compat/alias fixture 的 EXPECTED.json 同步新 check id

## 3. project_scale

- [x] config template + schema：project_scale / config.phases_disabled——schema 新增两字段；template 刻意不预置（遵循 evidence_profile 先例，opt-in 不给默认值）
- [x] profile-loader：config ∪ profile 并集——`loadResolvedProfile` 里 `yaml.phases_disabled ∪ cfg.phases_disabled` 合并后再 normalize；C0 `resolvePhaseChain` 本就消费 `isPhaseDisabledByProfile` 的既有产出，零改动自动生效
- [x] framework-init：scale 建议（catalog ≤3）+ 用户确认写入 + 确认点登记——S2.1 表新增一行 + `confirmation-registry.yaml` 新增 `init.project_scale` gate（受限于该 skill 250 行硬预算上限，表述已压到最简）
- [x] spec Step 1.5 small 档降级分支——`check-spec.ts` 的 `terminology_mapping_table` 新增分支：small 档下节末一行整体确认可替代逐行 `[x]`（真实门禁行为改动，非纯文档）
- [x] catalog 卡片可选字段（`NOT_responsible_for`/`easily_confused_with` 降为可选）——`easily_confused_with` 原本就是可选字段（结构上无需改动）；`NOT_responsible_for` 的最小条数校验由 `check-catalog.ts` 的 `checkNotResponsibleForMinCount` 承载，新增 `isSmallProjectScale(projectRoot)` 判定，small 档下该规则直接 PASS 并给出 `project_scale=small` 说明（跳过最小条数门槛，字段本身仍可填但不再强制）。新增 fixture `profiles/generic/harness/tests/fixtures/catalog/small_scale_not_responsible_for_optional_pass/`。
- [x] small 档红线夹具——`diff_within_scope`/Scope 声明检查代码路径未被 small 档分支触及（regex 精确匹配一次性确认行，不影响 scope_matches_catalog 等其它检查）。原记为"未新增独立 fixture 覆盖 small 档端到端场景"的已知缺口现已补：新增 `profiles/generic/harness/tests/fixtures/spec/small_scale_scope_and_terminology_pass/`（真实 spec phase 端到端跑，非直接调用函数）——术语映射表逐行未确认（`[ ]`）+ 节末一次性确认行 + Scope 声明 `in_scope_modules` 与 module-catalog 匹配，断言 `terminology_mapping_table` 与 `scope_matches_catalog` 两条 BLOCKER 在同一次真实 phase 跑中均 PASS，证明二者互不干扰而非仅代码走查结论。补负控：临时去掉 `project_scale: small` 复跑 → `terminology_mapping_table` 如预期 FAIL（逐行未确认），确认 fixture 确实在验证该分支而非巧合通过。

## 4. Verify

- [x] **codex review 补强（第一轮）**：`checkFactsArtifact`（本 change 的核心入口）此前只靠集成路径（7 个 check-<phase>.ts 接线 + fixture）间接验证，缺一份直接锁定其分支语义的单测——集成测试证明"没炸"，锁不住"语义没被悄悄改错"。新增 `tests/unit/context-facts.unit.test.ts`（14 case）：建立阶段量化 PASS/FAIL、delta 节缺失/空/存在三态、legacy 回落 WARN、testing 阶段无回落直接 FAIL、5 项 frontmatter 校验（schema_version/feature/established_by/ready_to_produce/blocker_risk）、lite 建立阶段（change）阈值放行。
- [x] **codex review 修复（第二轮，2 处真实 bug，均由 codex 复核代码发现，非单测跑出来的）**：
  1. `source_code_paths` 阈值可被同一路径重复凑数绕过——`runQuantitativeChecks`（`context-exploration.ts`）原先直接用 `normalizeStringArray(...).length` 判阈值，同一文件写 5 遍也能过 `>=5`；codex 直接点出我自己刚写的 legacy-fallback 测试 fixture 里就恰好用了这个反模式（`framework.config.json` 连写 5 次）——测试当时是绿的，但绿得没有意义（掩盖了漏洞而非验证了正确性），侧面坐实这个口子有多容易无意踩上。修复：新增 `dedupeNormalizedPaths`（路径分隔符归一后按值去重），阈值改用去重后的数量；改正自己那条测试 fixture 为 5 个真实不同文件；新增一条「同路径写 5 遍去重后仍 FAIL」的专项回归。
  2. `established_by` 只校验取值 ∈ {spec,change}，未与 feature 实际 track 交叉核对——一个从 lite 升档到 full 的 feature，若沿用了升档前 change 阶段建立的 facts.md（`established_by: change`），delta 阶段（plan/coding/...）只查 `phase_delta` 节是否存在，不会发现"这份事实基线其实是按 lite 更轻的门槛建立的"这个实质问题。修复：`checkFactsFile` 新增按 `feature.yaml` 声明 track（缺省 full，复用既有 `resolveFeatureTrack` 语义）推导期望 `established_by`（full→spec，lite→change），不一致即新增 BLOCKER `context_exploration_facts_established_by_track_mismatch`；补 2 条回归（full 沿用 lite 基线→FAIL；未声明 track 缺省 full+establishedBy=spec→不误报）。
- [x] **codex review 补强（第三轮，可选加固，已采纳）**：`dedupeNormalizedPaths` 原本只做反斜杠归一 + 去空白，codex 指出 `a/../a/b.ts`、`a//b.ts`、`./a/b.ts` 这类路径变体仍能绕过字符串级去重；改用 `path.posix.normalize` 折叠后再去重，补 1 条「三种路径变体归一后仍 FAIL」回归。codex 原话标注"不影响本轮验收"，属顺手加固非必须，但改动本身低风险且就在同一函数里，一并做掉。
- [x] `cd harness && npm test` 全绿（缺省 standard + 旧布局零回归）——**1575 单测 + 40 fixtures**（较收口时 1541 净增 34）；后续补 catalog small 档放行 fixture + check-spec small 档直接单测后达 1587 单测 + 41 fixtures；再补 small 档 spec phase 端到端 fixture（terminology+scope 互不干扰）后达 **1587 单测 + 42 fixtures**（详见本节上方两项）
- [x] `npm run openspec:validate`（31/31）；`npm run release:verify` 待 3.0.0 窗口整体收口时统一跑
