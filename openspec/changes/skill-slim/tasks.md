# Tasks: Skill Slim

## 1. task1 — 硬约束台账（Phase 0，无行为变更）

- [x] 台账 schema + 扫描产出：10 个 SKILL.md + AGENTS.md.template 逐条四分类（`ledger/hard-constraints.yaml`，56 条：跨 skill 公共 10 + per-skill 41 + 入口模板 5，A35/B11/C8/D2——初版 README 汇总误写 38/A24，经 grep 机器复核更正；行数基线 wc 口径随附）
- [x] 每条含语义指纹 / enforced_by / disposition / 旧文→新落点映射
- [x] 主干预算分级提案（150 基准 / framework-init·business-ut·catalog-bootstrap ≤250）随台账提交（`ledger/README.md` §三，含不获批时的回退方案）
- [x] **停等用户 review 放行**（2026-07-08 拍板：① 预算 150/250 分档批准——framework-init/business-ut/catalog-bootstrap ≤250，其余 150；② C 类折中——事故叙事移 framework reference 不删除。台账放行；task2 动笔仍按 plan 时序等 Phase 0 gate）

## 2. task2 — 主干化改写（Phase 1，依赖台账放行 + C1 定稿）

- [ ] task2 开工前台账 refresh diff
- [ ] 10 个 SKILL.md 按主干模板重构（预算按拍板结果）；A 类缩句 + 报错文案增强
- [ ] "完整阅读 X（BLOCKER）"全部改条件加载；主干开头 track 路由
- [ ] confirmation-registry 同步 + check-skills-confirmation-ux 绿

## 3. task3 — 入口模板瘦身（Phase 1）

- [ ] AGENTS.md.template ≤120 行（路由表 + 三问 + 红线 + SSOT 链接）
- [ ] 细则移 framework reference；adapter 跳板核对"只跳转不扩写"

## 4. task4 — 防再膨胀 lint（Phase 1）

- [ ] check-docs：`skill_body_max_lines`（per-skill 覆写）+ `forced_full_read_blacklist`（allowlist 附理由）
- [ ] docs-rules.yaml 阈值声明 + lint 自身夹具

## 5. Verify

- [ ] 全 fixture 绿 + 台账映射逐条可追溯
- [ ] `npm run openspec:validate` + `npm run release:verify`
