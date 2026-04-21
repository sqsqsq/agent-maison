# Framework Skills 索引

所有 Skill 均为 Markdown 正文，由 agent adapter 以 slash、跳板或直链方式暴露。执行某阶段前请**完整阅读**对应 `SKILL.md` 及其引用的 template / reference。

---

## 硬性前置

**[`00-framework-init`](00-framework-init/SKILL.md)** 是所有其它 Skill 的前置：实例根须先有有效的 `framework.config.json` 以及初始化约定的目录与入口文件（路径以配置中 `paths` 为准）。未完成前请勿执行下表中的 Skill 0～6。

---

## 阶段列表

| 顺序 | Skill | 路径 | 摘要 |
|------|--------|------|------|
| ★ | Framework 初始化 / 升级 | [00-framework-init/SKILL.md](00-framework-init/SKILL.md) | 接入 submodule、生成/更新 config、agent 产物与 `doc/` 骨架 |
| 0 | 模块画像 + 术语表自举 | [0-catalog-bootstrap/SKILL.md](0-catalog-bootstrap/SKILL.md) | `module-catalog.yaml` / `glossary.yaml` |
| 1 | PRD | [1-prd-design/SKILL.md](1-prd-design/SKILL.md) | PRD.md、术语映射与 Scope |
| 2 | 技术设计 | [2-requirement-design/SKILL.md](2-requirement-design/SKILL.md) | design.md、contracts |
| 3 | 编码 | [3-coding/SKILL.md](3-coding/SKILL.md) | ArkTS 落地 |
| 4 | 代码审查 | [4-code-review/SKILL.md](4-code-review/SKILL.md) | 审查报告 |
| 5 | 业务级 UT | [5-business-ut/SKILL.md](5-business-ut/SKILL.md) | DAG + Hypium |
| 6 | 真机测试 | [6-device-testing/SKILL.md](6-device-testing/SKILL.md) | 测试计划与报告 |

---

## Harness

门禁 runner 与脚本位于 [../harness/](../harness/)。具体命令与各 Skill 的「完成标准」一致。
