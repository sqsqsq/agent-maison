# Phase 9 — 合并 specs/features 到 doc/features

## Overview

把根 `specs/features/*` 全部搬进 `doc/features/*`（扁平同级），根 `specs/` 目录删除；`framework.config.json` 的 `feature_docs_dir` + `feature_specs_dir` 合并为单字段 `features_dir`（默认 `doc/features`），`config.ts` 相关 API 收敛为 `featuresDir` / `featuresDirPath()`。一个需求一个目录，完整归档。

---

## 背景与决策

**现状**：

- `doc/features/<name>/` 放 MD（PRD / design / review-report / test-plan / test-report）
- `specs/features/<name>/` 放 YAML（contracts / contracts.planned / acceptance / boundaries）

两处并列冗余，且都叫 `features/`，语义混淆。

**用户决策**：

1. **字段形状**：合并为一个 `features_dir`（干掉 `feature_specs_dir`），不做 deprecation alias。
2. **目录布局**：扁平——YAML 与 MD 同级放在 `doc/features/<name>/` 根下。

**兼容策略**：本仓是目前唯一实例工程，硬切到新字段；老字段在 `framework.config.json` 里读到直接报错（由 `validateConfig` 负责）。

---

## 目标结构

### 每个需求一个目录即完整归档

```
doc/features/home-page/
  PRD.md
  design.md
  contracts.yaml
  contracts.planned.yaml
  acceptance.yaml
  boundaries.yaml
  review-report.md
  test-plan.md
  test-report.md
```

### framework.config.json

```json
"paths": {
  "features_dir": "doc/features",
  "module_catalog": "doc/module-catalog.yaml",
  "glossary": "doc/glossary.yaml",
  "glossary_seed": "doc/glossary-seed.txt",
  "architecture_md": "doc/architecture.md"
}
```

---

## 影响面清单（机械替换 + 函数改名）

### A. config.ts 收敛

文件：[framework/harness/config.ts](../../framework/harness/config.ts)

- 第 78 / 80 行 schema：`feature_docs_dir` + `feature_specs_dir` → `features_dir: string`
- 第 156 / 157 行 `DEFAULT_PATHS`：合并为 `features_dir: 'doc/features'`
- 第 538 / 540 行 `ResolvedPaths`：`featureDocsDir` + `featureSpecsDir` → `featuresDir: string`
- 第 566 / 567 行 `resolvePaths()`：合并计算
- 第 593 / 597 行 `featureDocsDirPath()` + `featureSpecsDirPath()` → 删除，新增 `featuresDirPath(projectRoot)`
- 第 602 / 606 行 `featureDocPath()` / `featureSpecsDir()` 调用链同改
- 第 636 / 640 行 relative 返回函数合并为 `featuresDirRelative()`
- `validateConfig()` 新增：若检测到 `paths.feature_docs_dir` 或 `paths.feature_specs_dir` → 抛错提示「请合并为 features_dir」
- 顶部文件注释同步

### B. 配置实例与模板

- [framework.config.json](../../framework.config.json) 第 42–49 行：收敛到 `features_dir: "doc/features"`
- [framework/templates/framework.config.template.json](../../framework/templates/framework.config.template.json) 第 49–50 行：同上

### C. Harness 运行时

- [framework/harness/harness-runner.ts](../../framework/harness/harness-runner.ts) 第 117 行：`paths.featureSpecsDir` → `paths.featuresDir`
- [framework/harness/scripts/utils/spec-loader.ts](../../framework/harness/scripts/utils/spec-loader.ts)
  - 第 7 行注释
  - 第 44 行 `resolved.featureSpecsDir` → `resolved.featuresDir`
- [framework/harness/scripts/check-catalog.ts](../../framework/harness/scripts/check-catalog.ts)
  - 第 37 行 import：`featureDocsDirPath` → `featuresDirPath`
  - 第 693 行调用同改
- [framework/harness/scripts/check-coding.ts](../../framework/harness/scripts/check-coding.ts)
- [framework/harness/scripts/check-ut.ts](../../framework/harness/scripts/check-ut.ts)
- [framework/harness/scripts/check-testing.ts](../../framework/harness/scripts/check-testing.ts)

  三个 check-*.ts：字面量 `specs/features/` → `doc/features/`、函数调用 `featureSpecsDirPath()` → `featuresDirPath()`

### D. 阶段规则 YAML

- [framework/specs/phase-rules/ut-rules.yaml](../../framework/specs/phase-rules/ut-rules.yaml)
- [framework/specs/phase-rules/testing-rules.yaml](../../framework/specs/phase-rules/testing-rules.yaml)

内文 `specs/features/<feature>/` 字面量 → `doc/features/<feature>/`（预计 ≤10 处）。

### E. Skill 文档（7 份 SKILL.md）

全量文本替换 `specs/features/<feature>/` → `doc/features/<feature>/`：

- [framework/skills/1-prd-design/SKILL.md](../../framework/skills/1-prd-design/SKILL.md)
- [framework/skills/2-requirement-design/SKILL.md](../../framework/skills/2-requirement-design/SKILL.md)
- [framework/skills/3-coding/SKILL.md](../../framework/skills/3-coding/SKILL.md)
- [framework/skills/4-code-review/SKILL.md](../../framework/skills/4-code-review/SKILL.md)
- [framework/skills/5-business-ut/SKILL.md](../../framework/skills/5-business-ut/SKILL.md)
- [framework/skills/6-device-testing/SKILL.md](../../framework/skills/6-device-testing/SKILL.md)
- [framework/skills/00-framework-init/SKILL.md](../../framework/skills/00-framework-init/SKILL.md)
  - 第 129–130 行占位符表
  - 第 182 行骨架说明

### F. Adapter 契约

- [framework/agents/adapter-schema.yaml](../../framework/agents/adapter-schema.yaml) 第 140–142 行：
  - 删除 `feature_specs_dir` 占位符
  - `{{FEATURE_DOCS_DIR}}` 改名为 `{{FEATURES_DIR}}`

### G. Agent 模板中的占位符

- `framework/agents/claude/templates/**`
- `framework/agents/cursor/templates/**`
- [framework/templates/AGENTS.md.template](../../framework/templates/AGENTS.md.template)

凡引用 `{{FEATURE_DOCS_DIR}}` / `{{FEATURE_SPECS_DIR}}` 统一改 `{{FEATURES_DIR}}`。

### H. 根与项目文档

- [README.md](../../README.md) 中涉及 `specs/features/` 的描述
- [doc/Harness全链路验证说明.md](../../doc/Harness全链路验证说明.md) 命令示例与路径说明

### I. 文件物理搬迁

```bash
git mv specs/features/home-page/acceptance.yaml        doc/features/home-page/acceptance.yaml
git mv specs/features/home-page/boundaries.yaml        doc/features/home-page/boundaries.yaml
git mv specs/features/home-page/contracts.yaml         doc/features/home-page/contracts.yaml
git mv specs/features/home-page/contracts.planned.yaml doc/features/home-page/contracts.planned.yaml
```

搬完后根 `specs/` 为空：直接 `Remove-Item -Recurse specs`（git 会感知删除）。

同步检查这四个 YAML 文件**自身头注释**是否有「本文件位置：specs/features/...」之类自引用，改过来。

---

## 不在本次范围（保留原样）

- `framework/harness/reports/**/ai-prompt.md`（历史产物，重跑会覆盖）
- `.cursor/plans/**`（档案）
- `doc/archives/**`（归档自检报告）

---

## 验证

### 1. 残留扫描

```bash
rg "feature_docs_dir|feature_specs_dir|featureDocsDir|featureSpecsDir|specs/features" \
  -g "!.cursor/plans/**" -g "!doc/archives/**" -g "!framework/harness/reports/**"
```

预期：只剩 `validateConfig` 里「此字段已弃用」错误文案，无真实引用。

### 2. 类型检查

```bash
cd framework/harness && npx tsc --noEmit
```

### 3. 全链路 harness 回归（home-page feature）

```bash
cd framework/harness
npx ts-node harness-runner.ts --phase catalog
npx ts-node harness-runner.ts --phase glossary
# 每个 feature 级 phase：
npx ts-node harness-runner.ts --phase prd      --feature home-page
npx ts-node harness-runner.ts --phase design   --feature home-page
npx ts-node harness-runner.ts --phase coding   --feature home-page
npx ts-node harness-runner.ts --phase review   --feature home-page
npx ts-node harness-runner.ts --phase ut       --feature home-page
npx ts-node harness-runner.ts --phase testing  --feature home-page
```

预期：8 phase 全 PASS，0 BLOCKER / 0 FAIL（与 Phase 1 基线一致）。

### 4. validateConfig 反向测试

临时在 `framework.config.json` 添加 `"feature_specs_dir": "xxx"`，手工跑一次 harness 确认抛出预期错误，验证后回滚。

---

## Commit 策略

1. commit 前打 tag：`git tag phase9-baseline 48826d7`（当前 HEAD），便于回滚。
2. 一个 commit 收尾，message：

   ```
   refactor(framework): 合并 specs/features 到 doc/features，features_dir 字段收敛
   ```

---

## 顺带红利（影响 E2E 验证）

下一步"重置走 Skill 00"的端到端验证，清空实例产物的清单从两处合为一处：

- 原：删 `doc/features/` 和 `specs/features/`
- 新：只删 `doc/features/`

Skill 00 初始化时也不再需要创建 `specs/features/` 空占位。

---

## Todos

- [ ] `phase9-config`：config.ts + framework.config.json + framework.config.template.json 字段收敛为 features_dir（含 validateConfig 对老字段报错）
- [ ] `phase9-harness`：harness-runner.ts / spec-loader.ts / check-catalog|coding|ut|testing.ts 同步改 API 与路径字面量
- [ ] `phase9-specs-yaml`：framework/specs/phase-rules/{ut,testing}-rules.yaml 的 specs/features/ 字面量替换
- [ ] `phase9-skills-docs`：7 份 SKILL.md + adapter-schema.yaml + AGENTS.md.template + agents/*/templates 的占位符与路径引用统一
- [ ] `phase9-root-docs`：根 README.md 与 doc/Harness全链路验证说明.md 的路径描述更新
- [ ] `phase9-mv`：git mv 四个 YAML 到 doc/features/home-page/，删除空的根 specs/ 目录，清理 YAML 文件头自引用注释
- [ ] `phase9-verify`：rg 残留扫描 + tsc --noEmit + 全链路 8 phase harness 回归 + validateConfig 反向测试
- [ ] `phase9-commit`：打 tag phase9-baseline 后一次性 commit（含 rename + modify）
