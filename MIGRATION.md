# Framework 升级与迁移说明

本文描述**实例工程**在 framework 子模块或配置演进时的预期做法。详细操作以 Skill 正文为准。

---

## 首选路径：初始化 Skill 的 UPDATE 模式

当实例根已存在 `framework.config.json` 时，再次执行 [`00-framework-init`](skills/00-framework-init/SKILL.md)（`/framework-init` 或自然语言触发）应进入 **UPDATE** 模式：

1. 读取当前 JSON 与本次拟定变更，向用户展示 **diff**（键级或 `architecture` 段级）。
2. 仅在用户明确确认后写回 `framework.config.json` 及受影响的入口/文档骨架。
3. **切换 `agent_adapter`** 时：先列出将新增或可能与旧产物冲突的路径，得到同意后再写入；**不自动强删**历史文件，删除操作建议用户确认后手工或分步执行。

因此：**日常 framework 版本跟进、路径调整、架构 DSL 修订**，应通过 UPDATE 模式收敛到可审的交互流程，而不是手工散落改多份文件。

---

## 子模块（submodule）更新

仅更新 framework 代码而不改实例配置时：

```bash
git submodule update --remote framework
# 或进入 framework 目录按你们托管方式 pull / checkout 指定 tag
```

子模块更新后，若 `framework.config.json` 的 `schema_version` 或 harness 契约有破坏性变更，维护者应在 **framework 的 CHANGELOG / 发布说明**中注明；实例侧仍建议走一次 **`/framework-init` UPDATE**，让 Skill 根据新模板与校验规则对齐入口文件与路径说明。

---

## 新建实例 vs 老仓库迁入

- **新工程**：`git submodule add … framework` → `/framework-init`（CREATE）。
- **已有文档与代码**：同样先保证 `framework/` 存在，再 `/framework-init`；若已有 `doc/module-catalog.yaml` 等，在对话中与 Skill 对齐 **paths**，避免配置指向错误目录。

---

## 本文件与「实例侧迁移说明」的关系

**本 `MIGRATION.md` 留在 `framework/` 内**，供所有引入子模块的仓库只读参考。

若初始化 Skill 在实例根生成「迁移备忘」或「与当前 config 对齐的检查清单」，那是**针对该工程当前状态**的一次性产物，**不替代**本文的通用约定；二者冲突时以 **Skill 流程 + `framework.config.json` + harness 实际校验** 为准。
