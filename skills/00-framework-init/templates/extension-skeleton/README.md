# 实例扩展骨架（extension-skeleton）

本目录是 **Skill 00 · S3 执行** 在实例尚无可扩展目录时，向 `paths.extension_dir`（默认 `doc/extensions/`）补全内容的**模板来源**之一。

## 文件与子目录

| 路径（相对 extension-skeleton） | 落点（相对实例扩展根 `<extension_dir>`） | 说明 |
|------|-------------------|------|
| `manifest.yaml.template` | `manifest.yaml` | 拷贝后改名/去 `.template` 后缀；内容中的占位符替换为真实扩展包 id。 |
| `skills/.gitkeep` | `skills/.gitkeep` | Git 占位：空目录可被提交；初始化后可直接往 `skills/` 下放扩展 Skill。 |
| `knowledge/.gitkeep` | `knowledge/.gitkeep` | 同上，知识库占位。 |
| `hooks/.gitkeep` | `hooks/.gitkeep` | 同上，lifecycle hooks 占位。 |

建议 **整块拷贝** 本 skeleton 中与 `manifest.yaml.template` **并列** 的 `skills/`、`knowledge/`、`hooks/` 树（至少含各自的 `.gitkeep`），避免出现「建了空文件夹却进不了 Git」的问题。

## 约定

- **不要**把整个 `extension-skeleton` 目录当成业务产物提交——应只在实例 `<extension_dir>` 下保留拷贝结果（真实 `manifest.yaml` 与各子目录）。
- 完整协议见 [framework/specs/instance-extension-manifest.schema.yaml](../../../specs/instance-extension-manifest.schema.yaml) 与 [framework/docs/concepts/extensibility.md](../../../docs/concepts/extensibility.md)。
