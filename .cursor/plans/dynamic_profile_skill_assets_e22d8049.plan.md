---
name: dynamic profile skill assets
overview: 将根 `framework/skills/**/SKILL.md` 中已失效的 `templates/` / `examples/` 相对链接改为 profile 动态资产引用；通过 profile manifest 和 docs harness 校验保证引用会按 `framework.config.json > project_profile.name` 解析到当前 profile 的真实文件。
todos:
  - id: define-manifest
    content: 新增 profile skill asset manifest，并为 hmos-app 填入当前已迁移的模板/示例资产
    status: completed
  - id: rewrite-root-skills
    content: 把根 SKILL 中无效的 profile-specific 相对链接替换为 `profile-skill-asset:<skill>/<asset>` 引用
    status: completed
  - id: sync-addendums
    content: 在 hmos-app 各阶段 profile-addendum 中补充人类可读的权威资产清单
    status: completed
  - id: add-resolver-check
    content: 新增 profile skill asset 解析工具，并接入 docs harness 规则
    status: completed
  - id: add-tests
    content: 新增单元测试并登记到 `run-unit.ts`，覆盖解析成功与坏链接失败场景
    status: completed
  - id: verify
    content: 运行 unit、docs harness 和静态扫描，确认动态引用闭环
    status: completed
isProject: false
---

# Dynamic Profile Skill Assets Plan

## 目标与原则

- 根 Skill 保持 profile-neutral：不写死 `hmos-app`，也不保留已删除的 `templates/` / `examples/` 相对链接。
- 动态解析来源固定为实例根 [`framework.config.json`](framework.config.json) 的 `project_profile.name`。
- profile 侧提供机器可读 manifest；根 Skill 只引用稳定资产 ID，例如 `profile-skill-asset:2-requirement-design/design_template`。
- 自动校验纳入 docs harness：以后有人重新加入无效相对链接，或 manifest 指向不存在文件，应在 `--phase docs` / unit test 中暴露。

## 设计方案

1. 新增 profile Skill 资产 manifest。

   在 [`framework/profiles/hmos-app/skills/skill-assets.yaml`](framework/profiles/hmos-app/skills/skill-assets.yaml) 声明当前 profile 的权威模板/示例文件。建议结构：

   ```yaml
   schema_version: "1.0"
   profile: hmos-app
   assets:
     1-prd-design:
       prd_template: templates/prd-template.md
       example_prd: examples/example-prd.md
     2-requirement-design:
       design_template: templates/design-template.md
       api_spec_template: templates/api-spec.md
       data_model_template: templates/data-model.md
       example_design: examples/example-design.md
   ```

   路径相对 `framework/profiles/<profile>/skills/<skill>/`，因此 manifest 本身可迁移到其它 profile，不需要根 Skill 知道具体目录布局。

2. 在根 Skill 中建立统一解析协议。

   在受影响的根 Skill 的 Step 0 或“关联文件”附近加入短说明：

   ```md
   `profile-skill-asset:<skill>/<asset>` 需按以下顺序解析：
   1. 读取实例根 `framework.config.json > project_profile.name`；
   2. 读取 `framework/profiles/<project_profile.name>/skills/skill-assets.yaml`；
   3. 在 `assets.<skill>.<asset>` 中取相对路径；
   4. 拼成 `framework/profiles/<project_profile.name>/skills/<skill>/<relative_path>` 后读取。
   ```

   这样根文档不写死 `hmos-app`，但 agent 和 harness 都有确定的动态解析规则。

3. 替换当前已失效链接。

   重点修正这些文件中的坏链接：

   - [`framework/skills/1-prd-design/SKILL.md`](framework/skills/1-prd-design/SKILL.md)：把 `templates/prd-template.md`、`examples/example-prd.md` 改为 `profile-skill-asset:1-prd-design/prd_template`、`profile-skill-asset:1-prd-design/example_prd`；保留仍真实存在且通用的 `templates/feature-card.md`。
   - [`framework/skills/2-requirement-design/SKILL.md`](framework/skills/2-requirement-design/SKILL.md)：把 `templates/design-template.md`、`templates/api-spec.md`、`templates/data-model.md`、`examples/example-design.md` 全部改为资产 ID；删除同一文件里“已是 profile 占位路径”和“旧相对链接”混用的问题。
   - [`framework/skills/4-code-review/SKILL.md`](framework/skills/4-code-review/SKILL.md)：`review-checklist.md` 改为 profile asset；`review-report-template.md` 若继续保留在根目录且文件存在，则保留普通相对链接。
   - [`framework/skills/6-device-testing/SKILL.md`](framework/skills/6-device-testing/SKILL.md)：`test-plan-template.md`、`test-report-template.md` 改为 profile asset。
   - [`framework/skills/00-framework-init/SKILL.md`](framework/skills/00-framework-init/SKILL.md)：只处理已不存在的 profile-specific preset/骨架链接；仍存在且通用的根模板链接不改。

4. 补齐 profile addendum 的人类可读清单。

   在相关 profile addendum 中增加“权威资产清单”小节，让人类读者也能快速定位：

   - [`framework/profiles/hmos-app/skills/1-prd-design/profile-addendum.md`](framework/profiles/hmos-app/skills/1-prd-design/profile-addendum.md)
   - [`framework/profiles/hmos-app/skills/2-requirement-design/profile-addendum.md`](framework/profiles/hmos-app/skills/2-requirement-design/profile-addendum.md)
   - [`framework/profiles/hmos-app/skills/4-code-review/profile-addendum.md`](framework/profiles/hmos-app/skills/4-code-review/profile-addendum.md)
   - [`framework/profiles/hmos-app/skills/6-device-testing/profile-addendum.md`](framework/profiles/hmos-app/skills/6-device-testing/profile-addendum.md)
   - 如 init 也需要 profile asset，则同步更新 [`framework/profiles/hmos-app/skills/00-framework-init/profile-addendum.md`](framework/profiles/hmos-app/skills/00-framework-init/profile-addendum.md)

   addendum 里可以写具体 `hmos-app` 路径，因为它属于 profile 私有文档，不污染根 Skill。

## 自动校验

1. 新增解析工具。

   新增 [`framework/harness/scripts/utils/profile-skill-assets.ts`](framework/harness/scripts/utils/profile-skill-assets.ts)，职责包括：

   - 从 `framework.config.json` 读取 active profile；
   - 加载 `framework/profiles/<profile>/skills/skill-assets.yaml`；
   - 解析根 Skill 中的 `profile-skill-asset:<skill>/<asset>`；
   - 检查 manifest 中声明的目标文件是否存在；
   - 扫描根 `framework/skills/**/*.md`，报告不存在的 `](templates/...)`、`](examples/...)`、`](reference/...)` 相对链接。

2. 接入 docs harness。

   在 [`framework/harness/scripts/check-docs.ts`](framework/harness/scripts/check-docs.ts) 中新增检查项，例如 `profile_skill_assets_resolvable`：

   - `PASS`：所有资产 ID 都可通过 active profile 解析，且根 Skill 没有坏相对链接；
   - `FAIL`：manifest 缺失、asset 缺失、目标文件不存在、根相对链接指向不存在文件。

   同步在 [`framework/specs/phase-rules/docs-rules.yaml`](framework/specs/phase-rules/docs-rules.yaml) 增加该规则说明，建议 severity 为 `MAJOR` 或 `BLOCKER`。我建议用 `MAJOR`，与 docs phase 现有风格一致；如果你希望这类回退绝对不可放过，可改为 `BLOCKER`。

3. 增加单元测试。

   新增 [`framework/harness/tests/unit/profile-skill-assets.unit.test.ts`](framework/harness/tests/unit/profile-skill-assets.unit.test.ts)，覆盖：

   - 正常解析 hmos-app manifest；
   - 根 Skill 中 asset ID 缺失时报错；
   - manifest 指向不存在文件时报错；
   - 仍存在的通用根相对链接不报错；
   - 已删除的 `templates/` / `examples/` 相对链接会被识别为错误。

   在 [`framework/harness/tests/run-unit.ts`](framework/harness/tests/run-unit.ts) 的 `CORE_SUITES` 中登记该 suite。

## 验证计划

- 静态扫描：确认 `framework/skills` 下不再有指向不存在文件的 `](templates/...)` / `](examples/...)` / `](reference/...)` 链接。
- 单元测试：在 `framework/harness` 下运行 `npm run test:unit`。
- Docs harness：运行 `npx ts-node harness-runner.ts --phase docs`，确认新增规则 PASS。
- 如 docs freshness 因新增/修改源文件触发 MAJOR，再按现有流程同步 `framework/docs/DOC_INVENTORY.yaml` 或刷新相关 docs 注记，不通过删除 source 来规避。

## 边界

- 本轮不恢复旧的根跳板文件。
- 本轮不生成 `.cursor/skills/**` 的可点击 profile 链接文档。
- 本轮不把根 Skill 写死到 `framework/profiles/hmos-app/...`。
- 本轮只修“根 Skill 到 profile-specific 模板/示例/参考”的动态定位；已经存在且仍通用的根模板链接可以保留。