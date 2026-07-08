# Tasks: Skill Slim

## 1. task1 — 硬约束台账（Phase 0，无行为变更）

- [x] 台账 schema + 扫描产出：10 个 SKILL.md + AGENTS.md.template 逐条四分类（`ledger/hard-constraints.yaml`，56 条：跨 skill 公共 10 + per-skill 41 + 入口模板 5，A35/B11/C8/D2——初版 README 汇总误写 38/A24，经 grep 机器复核更正；行数基线 wc 口径随附）
- [x] 每条含语义指纹 / enforced_by / disposition / 旧文→新落点映射
- [x] 主干预算分级提案（150 基准 / framework-init·business-ut·catalog-bootstrap ≤250）随台账提交（`ledger/README.md` §三，含不获批时的回退方案）
- [x] **停等用户 review 放行**（2026-07-08 拍板：① 预算 150/250 分档批准——framework-init/business-ut/catalog-bootstrap ≤250，其余 150；② C 类折中——事故叙事移 framework reference 不删除。台账放行；task2 动笔仍按 plan 时序等 Phase 0 gate）

## 2. task2 — 主干化改写（Phase 1，依赖台账放行 + C1 定稿）

- [x] task2 开工前台账 refresh diff（未发现台账登记后的漂移）
- [x] 10 个 SKILL.md 按主干模板重构（预算按拍板结果：150 基准 7 个 + ≤250 档 3 个，全部达标；深层细则抽到 `skills/reference/<name>-workflow-detail.md`）
- [x] "完整阅读 X（BLOCKER）"全部改条件加载（`当 <场景> 时读 <文件>` 句式）；主干开头保留触发条件/门禁清单表
- [x] confirmation-registry 同步 + check-skills-confirmation-ux 绿（`lintConfirmationUx` 零 FAIL）

## 3. task3 — 入口模板瘦身（Phase 1）

- [x] AGENTS.md.template 307→105 行（≤120 预算内；L0/L1/L2 路由表 + 修正三问 + 红线清单表 + SSOT 链接全部保留）
- [x] 细则移 `skills/reference/agents-entry-detail.md`（§3.1-3.8 五大守门/§4.1 反误读全文/§4.2 扩展生命周期/§5 闭环判定与会话边界/§六交互硬规则完整表述）；14 个 `{{PLACEHOLDER}}` 全部保留消费方，未新增未注册 token
- [x] **cursor+codex review 修复（文档漂移，2 处）**：①红线清单表 #6「Context Exploration Gate」仍写 `context-exploration.md`/per-phase 落盘（C4 exploration-scale 早已改为 `context/facts.md` + `phase_delta`），改为准确描述新契约；`agents-entry-detail.md` 的同名章节镜像修正。②「执行规则」原文「进入某阶段前必须完整读一遍对应 SKILL.md（**含引用的 template/reference/checklist**）」与 C3 的条件加载设计正面冲突——被引用材料本应仅在触发条件命中时读，这句话等于把它们又打成入口即读；改写为明确"仅在条件加载索引命中时读引用材料"。两处都是 C3/C4 各自改写时遗留的入口文档未同步，非新代码回归。

## 4. task4 — 防再膨胀 lint（Phase 1）

- [x] check-docs：`skill_body_max_lines`（`harness/scripts/utils/skill-body-budget.ts`，per-skill 覆写读 docs-rules.yaml overrides）+ `forced_full_read_blacklist`（`harness/scripts/utils/forced-full-read-scan.ts`，allowlist 附理由）+ `entry_template_budget`（`harness/scripts/utils/entry-template-budget.ts`，行数+骨架标记双检）三项新增
- [x] docs-rules.yaml 阈值声明（`structure_checks` 段，含 framework-init/business-ut/catalog-bootstrap 250 档理由）+ lint 自身夹具（`harness/tests/unit/docs-authoring-lint.unit.test.ts`，12 case：正例/反例/allowlist/本仓真实状态回归）
- [x] **codex review 补强**：`forced_full_read_blacklist` 原本只认「完整阅读 X（BLOCKER）」窄句式，抓不住「引用到的 reference/template/checklist 也是强制阅读」这类语义等价的回退表述（正是上面 task3 那处真实文档漂移的成因）。`forced-full-read-scan.ts` 新增第二条正则 `REFERENCE_MANDATORY_READ_RE` 覆盖该模式，`docs-authoring-lint.unit.test.ts` 补 2 case（命中回退句式 / 「仅触发时读」安全句式不误报）；`docs` phase harness 对本仓真实状态复测仍 verdict=PASS。

## 5. Verify

- [x] 全 fixture 绿（**1571 单测 + 40 fixtures**，含 codex review 修复批新增用例）+ 台账映射逐条可追溯（`ledger/hard-constraints.yaml` 语义指纹锚定未变）
- [x] `npm run openspec:validate`（31/31）；`docs` phase harness 实测 verdict=PASS（新三项 BLOCKER 均 PASS）；`release:verify` 待 3.0.0 窗口整体收口时统一跑
