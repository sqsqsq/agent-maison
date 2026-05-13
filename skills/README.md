# Framework Skills 索引

所有 Skill 均为 Markdown 正文；各 **agent adapter** 决定如何在实例根暴露入口（slash、技能跳板、仅全局说明文件等）。执行某阶段前请**完整阅读**对应 `framework/skills/<n>/SKILL.md` 及其引用的 template / reference。

## Skill 跳板与「单点真相」

当某 adapter 在实例根生成了指向本目录的轻量入口文件时，该文件**只作跳转**：完整规则、BLOCKER、harness 命令与 verifier 要求**一律**以 `framework/skills/<n>/SKILL.md`（及同目录 `prompts/`、`templates/`、`reference/`）为准。

- **禁止**在实例根跳板内扩写业务条款或堆叠多级链接，以免与正文 **双源分叉**（agent 只读跳板、漏闸门）。
- **各 adapter 的路径约定、选型建议、跳板守门细则** → 单独写在 [framework/agents/README.md](../agents/README.md)，本索引不赘述。

---

## 硬性前置

**[`00-framework-init`](00-framework-init/SKILL.md)** 是所有其它 Skill 的前置：实例根须先有有效的 `framework.config.json` 以及初始化约定的目录与入口文件（路径以配置中 `paths` 为准）。未完成前请勿执行下表中的 Skill 0～6。

进入阶段 Skill 时还必须读取当前 `project_profile` 的 addendum：

```text
framework/profiles/<project_profile.name>/skills/<skill>/profile-addendum.md
```

通用 `SKILL.md` 只描述阶段流程、scope/trace/harness 闸门与中立产物契约；宿主语言、模块格式、编译/测试工具链、UI/设备细节由 profile addendum 与 profile capabilities 决定。

---

## Profile skill asset protocol

根目录 `framework/skills/**/SKILL.md`（及同树 `prompts/`）中可能出现占位引用：

```text
profile-skill-asset:<skill-id>/<asset_key>
```

含义：**不要**在根 SKILL 写死某个具体 `framework/profiles/<固定 profile 名>/...` 物理路径；按下列顺序解析为仓库内真实路径后再打开文件（`asset_key` 对应清单字段名，使用下划线命名，与当前 profile 的 `skills/skill-assets.yaml` 中 `assets` 表一致）：

1. 读取实例根 `framework.config.json > project_profile.name`（未声明时以 harness 加载时的兼容默认为准，见 [`framework/harness/config.ts`](../harness/config.ts)）。
2. 读取 `framework/profiles/<project_profile.name>/skills/skill-assets.yaml`。
3. 在 `assets.<skill-id>.<asset_key>` 取声明的路径：
   - 若以 `framework/` 开头 → 相对仓库根；
   - 否则 → 相对 `framework/profiles/<project_profile.name>/skills/<skill-id>/`。
4. 目标可以是文件或目录；打开前应用 `fs` / IDE 在该路径上解析。

脚本门禁：`framework/harness/scripts/check-docs.ts` 的 `profile_skill_assets_resolvable` 会校验 **清单存在**、**清单条目落盘**、**各 `profile-skill-asset:` 引用可在清单中解析且目标落盘**，以及 **各 `framework/skills/<skill>/SKILL.md` 与 `prompts/*.md` 内不存在指向 `framework/skills` 树内缺失目标的相对 Markdown 链接**（不扫描 `templates/`、`reference/` 等示意文件，规则说明见 [`docs-rules.yaml`](../specs/phase-rules/docs-rules.yaml)）。

---

## 阶段列表

| 顺序 | Skill | 路径 | 摘要 |
|------|--------|------|------|
| ★ | Framework 初始化 / 升级 | [00-framework-init/SKILL.md](00-framework-init/SKILL.md) | 接入 submodule、生成/更新 config、agent 产物与 `doc/` 骨架 |
| 0 | 模块画像 + 术语表自举 | [0-catalog-bootstrap/SKILL.md](0-catalog-bootstrap/SKILL.md) | `module-catalog.yaml` / `glossary.yaml` |
| 1 | PRD | [1-prd-design/SKILL.md](1-prd-design/SKILL.md) | PRD.md、术语映射与 Scope |
| 2 | 技术设计 | [2-requirement-design/SKILL.md](2-requirement-design/SKILL.md) | design.md、contracts |
| 3 | 编码 | [3-coding/SKILL.md](3-coding/SKILL.md) | profile 宿主代码落地 |
| 4 | 代码审查 | [4-code-review/SKILL.md](4-code-review/SKILL.md) | 审查报告 |
| 5 | 业务级 UT | [5-business-ut/SKILL.md](5-business-ut/SKILL.md) | DAG + profile UT |
| 6 | 真机测试 | [6-device-testing/SKILL.md](6-device-testing/SKILL.md) | 测试计划与报告 |

如需仅做可测性预检与 mock-plan（Skill 5 的 Step 1.5/1.6），仍在 **`/business-ut`（Claude Code）或 `5-business-ut` 跳板（Cursor）** 入口启动，并在用户消息中明确「仅做到 Step 1.5/1.6 后暂停」；SSOT 仍为 Skill 5 正文。

---

## Harness

门禁 runner 与脚本位于 [../harness/](../harness/)。具体命令与各 Skill 的「完成标准」一致。
