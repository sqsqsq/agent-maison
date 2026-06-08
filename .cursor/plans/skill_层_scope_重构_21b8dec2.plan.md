---
name: skill 层 scope 重构
version: 2.3.0
overview: 按生命周期 scope 重构 framework skill 层:根 skills/ 物理分为 project/ 与 feature/ 两个命名空间、去掉所有数字前缀、将个人级 00b 降级为 reference gate,使项目级 skill(catalog-bootstrap、未来 code-graph)可无重排增长。
todos:
  - id: naming-contract
    content: 锁定 编号→扁平slug 命名映射与 scope 归属(8 skill),编写 skills/skills.index.yaml 草案(scope/order/description SSOT);确认 00b 内容并入 reference/personal-setup-gate.md 的差异项
    status: completed
  - id: root-skills-restructure
    content: 根 skills/ 重构:建 project/ feature/ 子目录并 git mv 去编号搬迁 8 个 skill;删除 00b-framework-setup/(内容并入 gate);改写 README.md 索引表为按 scope 分组;落地 skills.index.yaml
    status: completed
  - id: skill-path-resolver
    content: 新增统一解析器:skills.index.yaml 作唯一被消费的 id→scope→物理路径 SSOT + resolveSkillPath(id) 库函数;所有变量型解析点改调用它(instance-skill-bridge.ts L218、listFrameworkBuiltinSkillDirs、walkSkillDocMarkdownFiles、lintRegistrySkillPaths 等);加一致性单测校验 index↔磁盘目录↔workflow skill_doc↔BUILTIN_SKILL_BRIDGE_DESCRIPTIONS 四者一致
    status: completed
  - id: harness-enumerators
    content: 改 harness 枚举/遍历器(改用 resolveSkillPath):materialize-agent-bundle-skills.ts(listFrameworkBuiltinSkillDirs 感知 project/feature、扁平 id+源路径、跳过 reference)、agent-bundle-paths.ts(BUILTIN_SKILL_BRIDGE_DESCRIPTIONS)、profile-skill-assets.ts(walk 递归 2 层)、check-init.ts(硬编码 init 模板路径)
    status: completed
  - id: confirmation-ux-registry
    content: "加固 confirmation UX 链路:confirmation-registry.yaml 37 条 skill: 值去编号 + setup.* 两条迁到虚拟命名空间;check-skills-confirmation-ux.ts 的 VIRTUAL_REGISTRY_SKILLS、lintRegistrySkillPaths(改用 resolveSkillPath)、listInitSetupPromptTemplateFiles(L253-254)、lintInitSetupNoFreeText L324 正则、PHASE_CLOSURE_LINT/lintOneFile 的 N-skill 后缀 全部同步"
    status: completed
  - id: workflow-pointers
    content: 更新 workflows/*.workflow.yaml 的 skill_doc 指针为去编号嵌套路径(init/catalog/glossary/prd/design/coding/review/ut/testing)
    status: completed
  - id: profile-mirror
    content: profile 镜像重命名:profiles/{generic,hmos-app}/skills/<numbered>→扁平;skill-assets.yaml 顶层 key 去编号;全量改写 SKILL.md/prompts 内 profile-skill-asset:<numbered>/ 引用
    status: completed
  - id: adapter-layer
    content: adapter 层:skills-bridge/<numbered> 8 目录改扁平;claude slash *.md 内部 skills 路径引用;cursor adapter.yaml notes;agents/README.md 表格
    status: completed
  - id: hardcoded-path-migration
    content: 形态A/C 散点收口(彻底去编号,含文案):adapter-schema.yaml(L249/263 硬编码 init 路径 + L96 <n> 占位措辞)、framework.mdc(<n>→<scope>/<id> 措辞)、framework-agent-execution.mdc(L33 6-device-testing 路径 + Skill 4/5/6 文案)、claude/adapter.yaml notes(Skill 1~6/00 措辞 + ../../framework/skills/<n>/);templates/framework.config.template.json(L6/29/30/36 init/prd skill 路径,发布件);harness-runner.ts L302、check-catalog/glossary/prd.ts 提示文本、backfill-context-exploration.ts L102、adhoc-derive-payload.ts、profiles/hmos-app/harness/{ut-host-impl,prd-visual-handoff-check}.ts;面向用户/提示文案的「Skill N」人读编号一并改为语义名
    status: completed
  - id: docs-metadata
    content: docs/skills/*.md 文件名去编号重命名(5-business-ut.md→business-ut.md 等)+ 同步 DOC_INVENTORY.yaml 登记名(L73 等)与所有引用;docs/* 正文引用、templates/AGENTS.md.template、根 README.md/AGENTS.md、profile-schema.yaml 等文案去编号;MIGRATION.md 写完整 old→new 映射表 + 说明 /framework-init UPDATE 物化新跳板、旧跳板(.cursor/skills/3-coding 等)只警告不自动删
    status: completed
  - id: no-numbered-paths-gate
    content: 新增两道确定性回归门禁 check 脚本(入 check:global / docs phase,consumer 侧布局感知复用,BLOCKER):(1)no-numbered-skill-paths 扫数字前缀 skill 路径(00-/0-/N-)残留=0;(2)no-numbered-skill-prose 扫面向用户文案 Skill\s*[0-6] 残留=0。扫描范围=迁移边界(≠发布边界,见裁决7):仅借 release-excludes 的噪声排除(harness/tests/**、profiles/*/harness/tests/**、harness/reports|state|dist/**、node_modules 等)+历史豁免(openspec/changes/archive、.cursor/**、RELEASE-NOTES-v*、MAINTAINER-CHANGELOG;MIGRATION.md 例外);dev 源仓模式必须扫 root AGENTS.md、active openspec/specs+未归档 changes、harness/trace/gap-notes.template.md 等 includeOverrides、root scripts/ 运行时脚本及全部 SSOT;consumer 模式按实际 release 布局只扫存在的发布内容
    status: completed
  - id: tests-verify
    content: 更新受影响 harness 单测期望值;cd harness && npm test 全绿(含 registry 路径校验、index 一致性单测、no-numbered-skill-paths + no-numbered-skill-prose 两道门禁、profile_skill_assets_resolvable、check-skills-confirmation-ux);fixture 工程 /framework-init 物化冒烟(cursor+generic 跳板/inline 链接可达)
    status: completed
isProject: false
---

## 背景与目标

当前 `framework/skills/` 用单一数字序列(`00 / 00b / 0 / 1-6`)把**三种正交的生命周期 scope**压在一根轴上,名实不符:

- **项目级**(每仓一次/偶尔刷新、会增长):`00-framework-init`、`0-catalog-bootstrap`,未来 `0-code-graph`(已在 [`docs/concepts/code-graph.md`](docs/concepts/code-graph.md) §6.1 预留)。数字前缀已不够用。
- **个人级**(每开发者探测/落盘):`00b-framework-setup` —— 本质是各 phase 入口 `--ensure` 的内联行为,独立 SKILL.md 目录过重。
- **需求级**(每需求一轮、真管线、数量稳定):`1-prd-design … 6-device-testing`。

借鉴 superpowers(扁平命名 + 语义触发,顺序不进目录名)、OpenSpec(持久 vs 临时分区)、hermes(按 scope 分家)。

**关键事实**:harness runtime 已用语义 phase id(`init/catalog/prd/...`)驱动,目录仅通过 [`workflows/spec-driven.workflow.yaml`](workflows/spec-driven.workflow.yaml) 的 `skill_doc` 指针被引用。本次为**纯结构/命名重构,无运行时语义变更**。

## 已定方向(用户确认)

- 方案 A:根 `skills/` 物理分 `project/` + `feature/` 子命名空间,去掉所有数字前缀。
- `00b-framework-setup` 降级:取消独立 SKILL.md 目录,只保留 [`skills/reference/personal-setup-gate.md`](skills/reference/personal-setup-gate.md) 作为各 phase 入口 `--ensure` 的 SSOT。

## 设计裁决(受代码约束,纳入本 plan)

1. **逻辑 skill-id 保持扁平 slug**(`framework-init` / `catalog-bootstrap` / `prd-design` / `requirement-design` / `coding` / `code-review` / `business-ut` / `device-testing`)。原因:[`profile-skill-assets.ts`](harness/scripts/utils/profile-skill-assets.ts) 的 `PROFILE_SKILL_ASSET_RE = /profile-skill-asset:([0-9a-z-]+)\/.../` **不允许斜杠**;且跳板 / asset key / profile addendum 目录均以 skill-id 命名。
2. **scope 物理分组仅落在根 `skills/` 树** + `skill_doc` 指针 + README/index。**跳板、profile skills、asset key、claude slash 一律保持扁平**(避免 Cursor/Claude 跳板发现的嵌套风险,且 asset 正则限制)。
3. 顺序与触发交给:`workflows/*.workflow.yaml` 的 `requires` DAG + 各 SKILL frontmatter `description` + 新增 `skills/skills.index.yaml`,不再编码进目录名。
4. **`skills.index.yaml` 必须是被消费的真 SSOT(否则会漂移)**:它登记每个 skill 的 `id` / `scope` / 物理源路径 / `description` / `order`,并由新增库函数 `resolveSkillPath(id)` 作唯一解析入口。当前仓库存在**多个独立的「skillId → 物理 SKILL.md 路径」解析点**(workflow `skill_doc` 显式、`instance-skill-bridge.ts` L218、`lintRegistrySkillPaths`、`listFrameworkBuiltinSkillDirs`、`walkSkillDocMarkdownFiles`),目录分层后必须统一收口到 `resolveSkillPath`,并加一致性单测,避免散点硬编码再次分叉。未来加 `code-graph` 只改 index 一处。
5. **彻底去编号(含文案)**:目录、路径、registry、跳板,以及**面向用户/提示文案中的「Skill N」人读编号**(harness-runner / check-* 提示、README、docs 正文)一律改语义名,不保留数字标签,与目录命名一致。
6. **「无遗漏」用确定性门禁裁判,按引用形态分治**(覆盖 reviewer「所有脚本/跳板路径是否都在范围内」之问):
   - **形态A 数字字面路径**(`skills/00-framework-init/...`、`profiles/.../skills/3-coding/...`):带 `00-/0-/N-` 前缀无歧义 → **`no-numbered-skill-paths` check 脚本** repo 级断言残留=0。
   - **形态B 变量解析点**(`path.join(dir,'skills',bridgeId,'SKILL.md')`):grep 看不见 → 由 `resolveSkillPath` 收口 + plan 显式手列(裁决 4)。
   - **形态C `<n>` 占位措辞**(`framework.mdc`、`adapter-schema.yaml` L96、`claude/adapter.yaml` notes):门禁不误报 → plan 显式列做"路径形态更新"。
   - **形态D 人读「Skill N」纯文案**(docs 正文、`profile-schema.yaml`、root `AGENTS.md` L50 "Skill 0–6" 等):路径门禁不裁 → 新增 **`no-numbered-skill-prose` check 脚本**(扫 `Skill\s*[0-6]`,BLOCKER),让裁决 5 的彻底去编号可强制。
7. **门禁扫描范围 = 迁移边界,≠ 发布边界(关键裁决)**:两道门禁是 **dev 源仓 `check:global` 检查**,目标是"迁移完整性",故**不能直接等同 [`scripts/release-excludes.json`](scripts/release-excludes.json)**(release 边界会漏 dev-only 但需迁移的内容)。精确定义:
   - **仅借用 release-excludes 的"噪声"排除**:`harness/tests/**`、`profiles/*/harness/tests/**`(夹具/期望值,由 tests-verify 单独迁移并自校验)、`harness/reports|state|dist/**`、`node_modules`/`oh_modules`/`.hylyre`/`tmp_hypium`。
   - **历史豁免**:`openspec/changes/archive/**`、`.cursor/**`(含本 plan)、`RELEASE-NOTES-v*.md`、`MAINTAINER-CHANGELOG.md`;`MIGRATION.md` 例外(写新映射表)。
   - **必须扫(尽管 release-excludes 排除了它们)**:root `AGENTS.md`、active `openspec/specs/**` 与未归档 `openspec/changes/**`(轻量扫,替代纯人工 review)、`harness/trace/gap-notes.template.md` 等 **includeOverrides**(release include 内容,含 `skills/3-coding/` + "Skill 5",绝不可因 `harness/trace/**` 噪声规则被漏)、root `scripts/` 内运行时脚本,以及全部 SSOT(`skills/`、`profiles/*/skills`、`agents/`、`docs/`、`templates/`、`harness/scripts/`、`harness/harness-runner.ts`)。
   - **"脚本"口径澄清**:blast radius 所称"所有脚本"指**发布/运行时脚本**(`harness/scripts/`、profile harness、adapter templates);root dev-only `scripts/` 也在门禁扫描内(门禁是 dev 源仓宽扫,非 release 边界)。
   - **布局感知复用(dev vs consumer)**:门禁 consumer 侧可复用,但须**布局感知**——**dev 源仓模式**按完整迁移边界扫(含 root `AGENTS.md`、active openspec、root `scripts/`);**consumer 模式**按实际 release 布局只扫存在的发布内容(上述 dev-only 路径在 consumer 包内通常不存在,不得因缺失而误报/语义混乱)。
8. **docs/skills/*.md 文件名**(`5-business-ut.md` 等)按裁决 5 一并 rename 去编号,同步 `DOC_INVENTORY.yaml` 登记名与全部引用。

### 目标目录形态

```
skills/
  project/
    framework-init/        (was 00-framework-init)
    catalog-bootstrap/     (was 0-catalog-bootstrap)
    # 未来: code-graph/    ← drop-in,无需重排
  feature/
    prd-design/ requirement-design/ coding/ code-review/ business-ut/ device-testing/
  reference/               (不变;personal-setup-gate.md 在此)
  skills.index.yaml        (新增:scope + 顺序 + description SSOT)
  README.md                (索引表改为按 scope 分组)
  # 00b-framework-setup/   ← 删除,内容并入 reference/personal-setup-gate.md
```

逻辑 id → 物理源路径映射(harness 枚举器需感知):`prd-design → feature/prd-design`,`framework-init → project/framework-init`,等。

## Blast radius(精确清单)

- **根 skills/**:6+2 目录 `git mv` 去编号并入 `project/`/`feature/`;删除 `00b-framework-setup/`;新增 `skills.index.yaml`;改写 `README.md` 索引。
- **harness 代码(核心改动点)**:
  - [`materialize-agent-bundle-skills.ts`](harness/scripts/utils/materialize-agent-bundle-skills.ts) `listFrameworkBuiltinSkillDirs`(只遍历一层 → 改为感知 `project/`/`feature/`、跳过 `reference/`、返回扁平 id+源相对路径);`appendInlineSkillMaterializedTemplates` 的 `templateRel`;`renderBridgeSkillStubMarkdown` 的相对路径计算。
  - [`agent-bundle-paths.ts`](harness/scripts/utils/agent-bundle-paths.ts) `BUILTIN_SKILL_BRIDGE_DESCRIPTIONS`(8 个 key 去编号 + 描述内路径)。
  - [`profile-skill-assets.ts`](harness/scripts/utils/profile-skill-assets.ts) `walkSkillDocMarkdownFiles` / `scanAllRootSkillMarkdown` / `scanRootSkillsHardcodedProfilePaths`(改为递归 2 层)。
  - [`check-init.ts`](harness/scripts/check-init.ts) 硬编码 `skills/00-framework-init/templates/architecture.md.skeleton.md`(~L873/881)与 `glossary-seed.skeleton.txt`(~L1618)→ 改 `skills/project/framework-init/...`。
  - **[`check-skills-confirmation-ux.ts`](harness/scripts/check-skills-confirmation-ux.ts)(原 plan 整文件遗漏)**:`lintRegistrySkillPaths`(L36-54,`skills/<skill>/SKILL.md` 物理校验 → 改用 `resolveSkillPath`)、`VIRTUAL_REGISTRY_SKILLS`(L34,setup.* 迁入)、`listInitSetupPromptTemplateFiles`(L253-254,`skills/00-framework-init/prompts|templates`)、`lintInitSetupNoFreeText` L324 正则 `(00-framework-init|00b-framework-setup)`、`PHASE_CLOSURE_LINT`(L623-630)与 `lintOneFile`(L607)的 `N-skill/SKILL.md` 后缀。(`CLAUDE_SLASH_COMMANDS` L20-30 为语义文件名,无需改)
- **confirmation-registry**:[`confirmation-registry.yaml`](skills/reference/confirmation-registry.yaml) 37 条 `skill:` 值去编号(`00-framework-init`→`framework-init` 等);其中 L60/72 的 `setup.adapter` / `setup.deveco_path` 因 00b 目录删除,`skill:` 迁到虚拟命名空间(如 `_personal_setup`)并加入 `VIRTUAL_REGISTRY_SKILLS`。
- **workflow**:[`spec-driven.workflow.yaml`](workflows/spec-driven.workflow.yaml) 9 处 `skill_doc` 指针改为去编号嵌套路径(+ 其它 `workflows/*.yaml` 若有)。
- **adapter 层**:`agents/shared/agent-bundle/templates/skills-bridge/<numbered>/` 8 目录改扁平名;`agents/claude/templates/commands/*.md` 内部 `framework/skills/N-.../SKILL.md` 路径引用(文件名已是语义名,无需改名);[`agents/cursor/adapter.yaml`](agents/cursor/adapter.yaml) notes("含 00-/0- 数字前缀"措辞);[`agents/README.md`](agents/README.md) 多张表。
  - **adapter schema / rules(原 plan 漏)**:[`agents/adapter-schema.yaml`](agents/adapter-schema.yaml) L249/263 硬编码 `framework/skills/00-framework-init/`(必改)+ L96 `<n>` 占位措辞;[`framework.mdc`](agents/shared/agent-bundle/templates/rules/framework.mdc) L18-23 `framework/skills/<n>/` 措辞;[`framework-agent-execution.mdc`](agents/shared/agent-bundle/templates/rules/framework-agent-execution.mdc) L33 `framework/skills/6-device-testing/SKILL.md` + 多处 "Skill 4/5/6" 文案;[`agents/claude/adapter.yaml`](agents/claude/adapter.yaml) L64-66 notes("Skill 1~6/00" + `../../framework/skills/<n>/`)。
  - **发布件配置模板(原 plan 漏)**:[`templates/framework.config.template.json`](templates/framework.config.template.json) L6 `framework/skills/00-framework-init/SKILL.md` + L29/30/36 `framework/skills/{00-framework-init/prompts,1-prd-design/reference}/...` 与 "Skill 6";属发布内容且进消费者配置说明。
  - **bridge resolver(形态B)**:[`instance-skill-bridge.ts`](harness/scripts/utils/instance-skill-bridge.ts) L218 `path.join(frameworkDir,'skills',bridgeId,'SKILL.md')` 判断内置 skill,scope 分层后失效 → 改用 `resolveSkillPath`。
- **harness 脚本提示文本/硬编码路径(原 plan 笼统归类,现逐列)**:[`harness-runner.ts`](harness/harness-runner.ts) L302 用户提示;[`check-catalog.ts`](harness/scripts/check-catalog.ts) L162 / [`check-glossary.ts`](harness/scripts/check-glossary.ts) L146 / [`check-prd.ts`](harness/scripts/check-prd.ts) L356 提示文本;[`backfill-context-exploration.ts`](harness/scripts/backfill-context-exploration.ts) L102 写死 `profiles/<profile>/skills/3-coding/`;[`adhoc-derive-payload.ts`](harness/scripts/utils/adhoc-derive-payload.ts) L29;[`ut-host-impl.ts`](profiles/hmos-app/harness/ut-host-impl.ts) L122;[`prd-visual-handoff-check.ts`](profiles/hmos-app/harness/prd-visual-handoff-check.ts) L357 `framework/skills/1-prd-design/reference/...`。
- **profile 镜像**(generic + hmos-app):`profiles/*/skills/<numbered>/` 目录改扁平名;`skill-assets.yaml` 顶层 key 去编号;各 SKILL.md/prompts 内 `profile-skill-asset:<numbered>/...` 引用去编号;profile phase-rules-overlays(`ut-rules.overlay.yaml` / `design-rules.overlay.yaml` 等)若引用编号路径同步。
- **docs / 元数据**:`docs/skills/*`、`docs/*` 多处引用、`docs/DOC_INVENTORY.yaml`、`templates/AGENTS.md.template`、根 `README.md`、根 `AGENTS.md`(L50 "Skill 0–6");面向用户的「Skill N」人读编号一并去编号(裁决 5)。
- **release includeOverride(原 plan 漏)**:[`harness/trace/gap-notes.template.md`](harness/trace/gap-notes.template.md)(L59/72 `skills/3-coding/` 路径 + L87/89/104 "Skill 5" 文案)—— 属 release include 内容,虽在 `harness/trace/**` 但**不可豁免**。
- **测试**:`harness/tests/unit/{adapter-bridge,generic-bundle,profile-skill-assets,init-task-executor,doc-freshness,init-eol}.unit.test.ts` 等期望值随重命名更新(其中 [`adapter-bridge.unit.test.ts`](harness/tests/unit/adapter-bridge.unit.test.ts) L56 用扩展 skill id `3-coding` 验内置冲突 → 改 `coding`,否则测试表达与新 id 不一致);新增 `no-numbered-skill-paths` 与 index 一致性单测。

**不动**:`openspec/changes/archive/**`、历史 `.cursor/plans/*.plan.md`(历史记录,非 SSOT);活跃 `openspec/specs/*` 与未归档 changes 若含路径引用则同步。

## 风险与缓解

- 跨工程已物化的旧跳板目录(`.cursor/skills/3-coding/`、`.agents/skills/00-framework-init/` 等)在消费者侧残留:由 `/framework-init` UPDATE 物化新名,旧目录列给用户手工清理(沿用既有 adapter-update 策略,不自动 `rm`)。`MIGRATION.md` 须给**完整 old→new 映射表**(8 个 skill 目录 + 跳板路径 + registry skill 值)并明确说明 UPDATE 行为与残留清理,避免用户同时看到两套入口。
- harness 遍历器改动是回归高风险区:以 `cd harness && npm test` 全绿为硬门禁,重点盯 adapter-bridge / generic-bundle / profile-skill-assets 三组用例。

## 验收

- `cd harness && npm test` 全 PASS(含 `check-docs` 的 `profile_skill_assets_resolvable`、`check-skills-confirmation-ux` 的 `registry_skill_path`、新增 index 一致性单测,以及 **`no-numbered-skill-paths` + `no-numbered-skill-prose` 两道门禁**)。
- **两道门禁绿**(扫描范围按裁决 7 的迁移边界 + 噪声排除集执行,**非**纯 release boundary):repo 级无 `00-/0-/N-` 前缀 skill 路径残留、无 `Skill N` 人读编号文案残留 —— 这是"所有跳板/脚本/文案引用是否都改全"的确定性裁判。
- `docs/skills/*.md` 文件名已去编号且 `DOC_INVENTORY.yaml` 登记名与引用同步。
- 根 `skills/` 无数字前缀目录、无 `00b-framework-setup/`;`skills.index.yaml` 覆盖全部 8 个 skill 且标注 scope,并被 `resolveSkillPath` 消费(新增一致性单测校验 index↔磁盘↔workflow↔BUILTIN 描述四者一致)。
- `confirmation-registry.yaml` 无残留数字前缀 `skill:` 值;`setup.*` 两条 `skill:` 已迁虚拟命名空间且通过 `lintRegistrySkillPaths`。
- 临时 init 冒烟:对一个 fixture 工程跑 `/framework-init` 物化 cursor + generic,跳板/inline 均生成扁平名且链接可达。
- 版本绑定:plan frontmatter `version: 2.3.0`(当前在研窗口)。