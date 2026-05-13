# Framework 可演进性与扩展分层

本文描述 framework **三层叠加扩展模型**：在不引入物理 `framework/core/` 目录的前提下，如何用声明式 workflow、宿主 profile、IDE adapter 与实例侧 extension 接入业务知识与门禁。

---

## 合并顺序（overlay precedence）

```
framework default → profile overlay → workflow schema → instance extensions
```

后者覆盖前者：**实例扩展 > workflow > profile > framework 默认**（同一字段合并策略见各 loader 实现）。

---

## 架构图（逻辑分层）

```mermaid
flowchart TB
  subgraph FW[framework/ 核心]
    coreSkills["skills/00..6 默认 SKILL.md"]
    coreRules["specs/phase-rules/*.yaml"]
    coreHarness["harness/check-*.ts"]
  end

  subgraph Profile["profiles/host 宿主平台"]
    profCaps["profile.yaml capabilities"]
    profProv["harness/providers/*.ts"]
    profOver["phase-rules-overlays/"]
    profAdd["skills/*/profile-addendum.md"]
  end

  subgraph Workflow["workflows/ 工作流 DAG"]
    wfDefault["spec-driven.workflow.yaml"]
    wfFork["用户 fork 的 *.workflow.yaml"]
  end

  subgraph Ext["doc/extensions/ 实例业务扩展"]
    extSkills["skills/custom/SKILL.md"]
    extKnow["knowledge/*.md"]
    extHooks["hooks/*/*.mjs|.md"]
    extOver["phase-rules-overlays/"]
    extCaps["capabilities/*.provider.ts"]
    extMani["manifest.yaml"]
  end

  subgraph Agent["agents/adapter IDE 入口"]
    agCmd["commands / skill_bridge / rules"]
    agHook["hooks 物理拦截"]
  end

  Profile -. overlay .-> FW
  Workflow -. drives .-> FW
  Ext -. overrides .-> Workflow
  Ext -. overrides .-> Profile
  Agent -. exposes .-> FW
  Agent -. exposes .-> Ext
```

---

## 每层职责与边界（不该做什么）

| 层 | 职责 | **不做** |
|---|------|---------|
| **framework 默认**（skills / specs / harness / templates / docs） | 通用阶段流程、YAML 规则、`check-*.ts`、共享模板 | 不写具体宿主编译命令细节（交给 profile）；不写业务名词规则（交给实例 catalog/glossary/extension） |
| **profile**（`profiles/<name>/`） | 宿主 toolchain、capability provider、phase-rules overlay、Skill profile-addendum | 不写 IDE slash/跳板（交给 adapter）；不承担业务扩展包语义 |
| **workflow**（`workflows/*.workflow.yaml`） | phase DAG、`requires`、可选裁剪/重排合法 phase | 不包含业务 Markdown SOP（交给 extension）；不替换 `check-*.ts` 实现 |
| **instance extension**（`doc/extensions/`） | manifest、业务 SKILL、knowledge、hooks、可选 capability overlay | **不**修改 `framework/` 子模块源码；协议错误应在 `--phase extensions` 暴露 |
| **adapter**（`agents/<adapter>/`） | 把 Skill/extension 暴露给 Claude/Cursor 等客户端 | 不承担 harness 规则；不写 phase 校验逻辑 |

---

## 逻辑分层表（顶层目录速查）

| 路径 | 角色 | 可被宿主 fork / 扩展 |
|------|------|---------------------|
| `framework/skills/` | core：阶段 SKILL 正文 | 否（改 upstream framework）；实例通过 extension 增补 SKILL |
| `framework/specs/` | core：phase-rules、JSON/YAML schema | 否；实例通过 extension overlay / workflow |
| `framework/harness/` | core：runner、`check-*.ts` | 否 |
| `framework/templates/` | core：初始化模板 | 否 |
| `framework/docs/` | core：对外设计与概念文档 | 否 |
| `framework/workflows/` | plug-in：默认 workflow + 宿主可增加 yaml | **是**（仓库内 fork 新 workflow） |
| `framework/profiles/` | plug-in：宿主平台 profile | **是**（新 profile 目录） |
| `framework/agents/` | plug-in：IDE adapter | **是**（新 adapter 目录） |
| `doc/extensions/`（实例根） | instance-extension：业务知识/hooks | **是** |

---

## 协议 SSOT（机器可读）

扩展与工作流的契约定义于：

- [`framework/specs/workflow-schema.json`](../../specs/workflow-schema.json) — workflow YAML 校验
- [`framework/specs/instance-extension-manifest.schema.yaml`](../../specs/instance-extension-manifest.schema.yaml) — `doc/extensions/manifest.yaml`
- [`framework/specs/lifecycle-hooks-schema.yaml`](../../specs/lifecycle-hooks-schema.yaml) — lifecycle hook 事件与上下文

演进与 breaking 约定见：[extension-protocol-v1.md](../evolution/extension-protocol-v1.md)。
