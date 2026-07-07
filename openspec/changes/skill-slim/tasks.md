# Tasks: Skill Slim

## 1. task1 — 硬约束台账（Phase 0，无行为变更）

- [ ] 台账 schema + 扫描产出：10 个 SKILL.md + AGENTS.md.template 逐条四分类
- [ ] 每条含语义指纹 / enforced_by / disposition / 旧文→新落点映射
- [ ] 主干预算分级提案（150 基准 / 复杂 skill ≤250）随台账提交
- [ ] **停等用户 review 放行**

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
