# ⚠️ Profile 资产不在此目录（面包屑提示，非模板）

本目录 `framework/skills/project/framework-init/templates/` 属于**根 skill 树**，只存放**与 profile 无关的通用骨架**（如本目录的 `preset-minimal-3-layer.sample.json`、各 `*.skeleton.*`）。

**framework-init 的 profile 专属模板/示例不在这里**，典型有：

- `preset-5-layer.sample.json`（清单键 `preset_5_layer_sample`）——注意它与本目录的 `preset-minimal-3-layer.sample.json` **名字相近但不是同一个文件**，极易混淆。

它的真身在 **active profile** 下：

```
framework/profiles/<project_profile.name>/skills/framework-init/templates/preset-5-layer.sample.json
```

根 `SKILL.md` 用占位符 `` `profile-skill-asset:framework-init/<键>` `` 引用，路径由 `framework/profiles/<profile>/skills/skill-assets.yaml` **唯一声明**，按 `framework/skills/README.md` 的 “Profile skill asset protocol” 解析。**不要**把本目录当作 profile 模板的所在地。
