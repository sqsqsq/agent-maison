# 实例扩展骨架（extension-skeleton）

本目录是 **Skill 00 · Step 5.4.6** 在实例尚无可扩展目录时，向 `paths.extension_dir`（默认 `doc/extensions/`）补全内容的**模板来源**之一。

## 文件

| 文件 | 落点（相对扩展根） | 说明 |
|------|-------------------|------|
| `manifest.yaml.template` | `manifest.yaml` | 拷贝后改名/去 `.template` 后缀；内容中的占位符替换为真实扩展包 id。 |

## 约定

- **不要**直接把本目录提交为业务内容——应在实例 `doc/extensions/` 下维护真实 `manifest.yaml` 与子目录（`skills/`、`knowledge/`、`hooks/`）。
- 完整协议见 [framework/specs/instance-extension-manifest.schema.yaml](../../../specs/instance-extension-manifest.schema.yaml) 与 [framework/docs/concepts/extensibility.md](../../../docs/concepts/extensibility.md)。
