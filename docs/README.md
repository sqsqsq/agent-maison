# Framework 文档（`framework/docs/`）

> **本目录是 framework 自身的对外材料**，不属于任何接入工程。
>
> - **使用 framework**？先看 [`framework/README.md`](../README.md)（入门 + 命令清单）和各 Skill 的 SKILL.md
> - **了解 framework 设计、向他人讲解、参考演进决策**？看本目录的文档
> - **接入 / 升级 framework**？看 [`framework/MIGRATION.md`](../MIGRATION.md)
>
> 文档新鲜度由 [`DOC_INVENTORY.yaml`](DOC_INVENTORY.yaml) 跟踪，
> 自动检查脚本 [`framework/harness/scripts/check-docs.ts`](../harness/scripts/check-docs.ts)
> 在每次 framework 内部代码改动时给出"哪些 doc 可能需要同步"的提醒。

## 目录结构

```
framework/docs/
├── README.md                  ← 本文件：文档地图 + 维护规则
├── DOC_INVENTORY.yaml         ← 文档清单 + 各文档的源依赖（喂给 check-docs.ts）
│
├── overview.md                ← 全景介绍：为什么做这个 framework、它解决什么问题、怎么接入
│
├── profiles/                  ← 按 profile 拆出的宿主工具链专文（与 operations 交叉引用）
│   └── hmos-app-harness-toolchain.md
│
├── skills/                    ← 各 Skill 阶段的对外讲解（设计哲学 + 实现 + 常见坑）
│   ├── README.md
│   ├── spec.md          (待写)
│   ├── plan.md  (待写)
│   ├── coding.md              (待写)
│   ├── code-review.md         (待写)
│   ├── business-ut.md         ★ 已写
│   ├── device-testing.md      (待写)
│   ├── phase6-keyword-allowlist.md   ← Phase 6 关键词验收：有意保留命中项（与脚本口径一致）
│   └── phase6-keyword-pattern.regex ← 单行字面供 `rg -f`；勿手改，除非你同步改 allowlist §4
│
├── concepts/                  ← 跨 Skill 的核心理念
│   ├── README.md
│   ├── terminology-guarding.md  ← 术语守门：catalog + glossary + 三道 BLOCKER + 演进路线图
│   └── extensibility.md         ← 扩展分层（workflow / profile / adapter / doc/extensions）SSOT
│
├── operations/                ← 工程化运行手册
│   ├── README.md
│   └── harness-runbook.md       ← Harness 全链路验证操作手册（怎么跑、报告路径、排错）
│
└── evolution/                 ← 大版本演进记录（与 MIGRATION 互补）
    ├── README.md
    ├── compat-protocol-v1.md          ← Feature 目录 compat.yaml：降级 / 过期 / 回填边界
    ├── extension-e2e-acceptance.md    ← 实例扩展与 hooks / render-agents-md 手验清单
    └── extension-protocol-v1.md       ← workflow / manifest / lifecycle-hooks 三套协议 v1 约定
```

### 各子目录定位

| 子目录          | 写什么                                                                                | 不写什么                                              |
| --------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `skills/`       | 每个阶段的设计哲学、关键产物、常见坑、与下一个阶段的契约                              | 操作步骤（在 SKILL.md 里）、命令行用法（在 README）   |
| `profiles/`     | 特定 `project_profile` 下的宿主工具链专文（hvigor / hdc / hypium 等），供 runbook 链接 | 通用 harness 概念（concepts）或全 phase 操作复述（operations） |
| `concepts/`     | 跨 Skill 的横向理念：术语守门、Scope 守门、双 Harness、模型无关性、可演进性分层       | 单 Skill 的细节                                       |
| `operations/`   | "实际怎么跑 framework"：harness 命令、报告路径、CI 集成、排错案例                     | 设计为什么这样（在 concepts 里）                      |
| `evolution/`    | 大版本演进的设计记录（v2.0 → v2.1 → v2.2 ...），偏故事性；见 `evolution/README` 已完成表 | 文件级 changelog（在 MIGRATION.md 里）                |

## 维护规则

### 文档新鲜度自动检查

每份文档在 [`DOC_INVENTORY.yaml`](DOC_INVENTORY.yaml) 中声明它"关心"哪些 framework 内部资产
（SKILL.md / 规约 YAML / harness 脚本等）。比对规则（git committer date）：

- doc 提交时间 ≥ 全部 source 提交时间 → fresh（PASS）
- 任一 source 在 doc 之后改动过 → stale（MAJOR）

跑法：

```bash
cd framework/harness && npx ts-node harness-runner.ts --phase docs
```

报告输出在 `framework/harness/reports/_global/docs/`。

### 收到 stale 提醒怎么办

| 情况                                                         | 操作                                                                  |
| ------------------------------------------------------------ | --------------------------------------------------------------------- |
| 源代码改动确实改了文档涉及的语义                             | 同步更新 doc，正常 commit；下次 check 自动过                          |
| 源代码只是无关重构（变量重命名 / 注释调整 / 测试增补）       | `touch` 文档文件并 commit `"docs: sync without content change"`，下次自动过 |
| 源代码已删除，inventory 还指向它                             | 修 `DOC_INVENTORY.yaml > docs[].sources`：去掉过期路径                |
| 这条 source 影响很小，没必要每次它一动都报警                 | 把它从 inventory 中该 doc 的 `sources` 里移出；不要随手降 severity     |

### 何时新增 / 删除一份文档

- **新增**：任何"对外讲解的语义模块"（一个 Skill / 一个核心概念 / 一份运行手册）。新增时同步登记到 `DOC_INVENTORY.yaml`。
- **删除**：先确认不被外部链接引用，然后从 inventory 删除对应条目并删掉文件。

### 与其它文档的边界

| 文档                                     | 定位                                                  |
| ---------------------------------------- | ----------------------------------------------------- |
| `framework/README.md`                    | 入门、命令、目录结构（"框架是干什么的，怎么用一下"）  |
| `framework/MIGRATION.md`                 | 升级 / 迁移指引 + 大版本字段级 changelog              |
| `framework/skills/*/SKILL.md`            | Skill 操作手册（"按这些步骤做"）                      |
| `framework/docs/**.md` (本目录)          | 设计讲解、对外材料（"为什么这样设计 / 怎么向人讲解"）  |

四者**互不替代**，写文档前先想清楚归属。
