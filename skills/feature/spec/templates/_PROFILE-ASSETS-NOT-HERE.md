# ⚠️ Profile 资产不在此目录（面包屑提示，非模板）

本目录 `framework/skills/feature/spec/templates/` 属于**根 skill 树**，只存放**与 profile 无关的通用骨架**（如本目录的 `feature-card.md`）。

**spec 的 profile 专属模板/示例不在这里**，典型有：

- `spec-template.md`（清单键 `spec_template`）
- `example-spec.md`（清单键 `example_spec`）

它们的真身在 **active profile** 下：

```
framework/profiles/<project_profile.name>/skills/spec/templates/spec-template.md
framework/profiles/<project_profile.name>/skills/spec/examples/example-spec.md
```

根 `SKILL.md` 用占位符 `` `profile-skill-asset:spec/<键>` `` 引用，路径由 `framework/profiles/<profile>/skills/skill-assets.yaml` **唯一声明**，按 `framework/skills/README.md` 的 “Profile skill asset protocol” 解析。**不要**把本目录当作 profile 模板的所在地。
