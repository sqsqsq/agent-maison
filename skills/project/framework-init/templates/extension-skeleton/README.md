# 实例扩展骨架（extension-skeleton）

framework-init 不创建或修复实例扩展骨架。请调用 [`/extension init`](../../../extension/SKILL.md)；模板与写入职责由 `skills/project/extension/` 唯一承载。

## 文件与子目录

本目录只保留迁移指路，不再存放 skeleton 副本，避免与 `/extension` 形成平行真源。

## 约定

- `/extension init` 只补缺失文件，不覆盖实例已有内容。
- 完整协议见 [framework/specs/instance-extension-manifest.schema.yaml](../../../../../specs/instance-extension-manifest.schema.yaml) 与 [framework/docs/concepts/extensibility.md](../../../../../docs/concepts/extensibility.md)。
