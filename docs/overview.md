# Framework 全景介绍

> **文档角色**：面向**没接触过本 framework**的同事 / 跨部门协作者的**对外讲解**材料。
>
> **不是**：使用手册（使用手册见 [`../README.md`](../README.md) 与各 [`../skills/*/SKILL.md`](../skills/)）；
>
> **读完之后你会知道**：我们为什么要做这个 framework、它解决什么问题、怎么接入、常见坑怎么躲、未来还会往哪走。
>
> **维护规则**：本文是跨 Skill 的综述材料，不承担字段级 changelog（版本发布摘要见 [`../RELEASE-NOTES-v2.0.md`](../RELEASE-NOTES-v2.0.md)、字段级迁移见 [`../MIGRATION.md`](../MIGRATION.md)）。文档新鲜度由 [`DOC_INVENTORY.yaml`](DOC_INVENTORY.yaml) + harness `--phase docs` 跟踪。

---

## 目录

- [一、为什么做这个 framework](#一为什么做这个-framework)
- [二、framework 全貌与使用方式](#二framework-全貌与使用方式)
- [三、常见问题与解决方案](#三常见问题与解决方案)
- [四、未尽事宜与未来演进](#四未尽事宜与未来演进)
- [附录 · 关键文件索引](#附录--关键文件索引)

---

## 一、为什么做这个 framework

### 1.1 背景：要解决什么问题

在"**真实大型工程 + 弱模型 + 业务专有术语**"的约束下，AI 辅助开发面临的不是"能不能用"，而是"**用起来能不能不出事故**"。具体表现为三重挑战：

| #   | 挑战                          | 典型表现                                                                                                                                |
| --- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | **弱模型** + 超大代码仓        | 上下文 200K 量级；工程数十万 LOC；**单个一级模块都装不进上下文**                                                                         |
| C2  | **业务专有术语** 的字面相似陷阱 | 自然语言术语（如行业内"刷卡 / 卡管理 / 我的"）和模块名字面相似但归属不同；AI 没有业务先验，只能按字面相似度猜                              |
| C3  | **过程产物质量抖动**           | 同一份 Prompt + 同一份输入，不同模型产出质量差异大；弱模型还会**吞字反转语义**（"不要覆盖" 吞成 "要覆盖"），语法仍通顺、语义完全相反         |

这三项叠加的直接后果：

- 自然语言需求 → AI 选错模块 → spec / plan / coding 内部都对得上，但整条链路都在错的方向上往下走
- 写代码时因上下文缺失频繁跑偏，到 code review 阶段才发现
- UT 覆盖率看起来 80%+，线上一遇业务流程异常就炸（"声明覆盖"陷阱：`expect(list.length > 0)` 能过，业务流完全没跑）
- 凭直觉"加强校验"而不控制边界，架构文档被每个 feature 改动污染成变更日志

### 1.2 设计目标与核心约束

做 framework 时强行画了几条红线，这些红线**反过来决定了 framework 的形态**：

1. **必须在 200K 上下文内可用** —— 所有辅助资源（规约、画像、样例）总 token 预算 ≤ 30K，给需求本体留足空间；任何"把整仓丢给 AI"的思路一开始就否决
2. **必须可离线运行** —— 不依赖外部 API、不依赖向量检索服务
3. **必须显式可审** —— AI 的每一步决策过程都可以被人类快速复查，禁止"黑盒告诉你答案"
4. **模型无关 / 厂商无关 / IDE 无关** —— Spec 是 YAML、Prompt 是 Markdown、脚本是 TypeScript，不绑定任何 agent / 任何 IDE / 任何模型；同一套资产可在任意已接入的宿主中运行（接入方式见 [`agents/README.md`](../agents/README.md)）
5. **显式对抗字面相似 > 更强大的检索** —— 字面相似陷阱只能靠"显式枚举反例"对抗，不能靠相似度算掉（embedding 会把意思相反但字面相近的术语算得很近，反而助长误映射）

### 1.3 核心理念：三层分离

```mermaid
flowchart LR
    subgraph specLayer ["规约层 (Spec) · 独立设计产物"]
        PR["阶段级规约<br/>specs/phase-rules/*.yaml"]
        FR["功能级规约<br/>doc/features/<feature>/*.yaml"]
    end
    subgraph skillLayer ["生成层 (Skill) · 产出文档/代码"]
        S0["0. catalog+glossary"] --> S1["1. spec"]
        S1 --> S2["2. plan"]
        S2 --> S3["3. Coding"]
        S3 --> S4["4. Review"]
        S4 --> S5["5. 业务级 UT"]
        S5 --> S6["6. 真机测试"]
    end
    subgraph harnessLayer ["验证层 (Harness) · 自动化检验"]
        SH["脚本 Harness<br/>(确定性)"]
        AH["AI Harness<br/>(语义级)"]
    end
    S1 -.->|"产出 Spec"| FR
    S2 -.->|"产出 Spec"| FR
    PR -->|"约束"| SH
    FR -->|"契约"| SH
    PR -->|"约束"| AH
    FR -->|"契约"| AH
    SH -.->|"验证"| skillLayer
    AH -.->|"验证"| skillLayer
```

| 层                   | 定位                                                       | 物理位置                                                                                  |
| -------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **Skill（生成层）**  | 产出文档和代码；**生产者**                                 | [`../skills/`](../skills/)                                                                |
| **Spec（规约层）**   | 定义契约 / 验收标准 / 边界用例；**独立于生成和验证**        | [`../specs/phase-rules/`](../specs/phase-rules/)（阶段级） + `doc/features/<feature>/`（功能级） |
| **Harness（验证层）**| 消费 Spec，自动化检验产出是否合规；**消费者**              | [`../harness/`](../harness/)                                                              |

**为什么非要拆三层？**

- **Spec 独立**：让"验收标准"可以在没有 Harness 时就供人工审查；而 Spec 本身又是 spec/2 的**产物**（spec 产 `acceptance.yaml` / plan 产 `contracts.yaml`），同时是 coding/5/6 的**输入**和 Harness 的**消费源** —— 一份数据三个方向使用
- **生成与验证分离**：生成者和验证者**可以是不同模型**（甚至不同厂商），消除"考生自己批改试卷"的偏差
- **机制 > 文字**：文字里的"应该 / 禁止"靠不住，要落到 `check-*.ts` + `verify-*.md` 可执行的硬门禁

### 1.3.1 默认 workflow：Harness phase DAG（spec-driven）

以下与 **[`spec-driven.workflow.yaml`](../workflows/spec-driven.workflow.yaml)** 一致：**圆圈**表示全局 phase（不要求 `--feature`）；**方框**为功能 phase（必须 `--feature`）。边标注 `requires` 依赖。

```mermaid
flowchart LR
  subgraph glob [全局 phase]
    ext[extensions]
    ini[init]
    cat[catalog]
    glo[glossary]
    docp[docs]
  end

  subgraph feat [功能 phase]
    spec[spec]
    plan[plan]
    cod[coding]
    rev[review]
    utp[ut]
    tst[testing]
  end

  spec --> plan
  plan --> cod
  cod --> rev
  cod --> utp
  utp --> tst
  cat --> spec
  glo --> spec
```

兼容降级 **`compat.yaml`** 不是图上节点：仅在 **`spec`～`ut`**（不含 `testing`）的脚本汇总前按需生效；**全局 phase 不参与**。见 [`evolution/compat-protocol-v1.md`](evolution/compat-protocol-v1.md)。CLI 仍接受 legacy phase id `prd` / `design`（alias，WARN），见 [MIGRATION.md](../MIGRATION.md) §v2.3。

runner 与各 phase 的命令、报告路径见 **[`operations/harness-runbook.md`](operations/harness-runbook.md)**。

### 1.3.2 四层扩展：framework → profile → workflow → 实例 extensions

除「Spec / Skill / Harness」三层外，运行时还有 **四层叠加扩展模型**（争权顺序：**后者覆盖前者**）：

```
framework 默认 → project_profile → active_workflow YAML → doc/extensions（实例根）
```

| 层 | 物理位置 | 职责 |
|----|----------|------|
| **framework 核心** | `skills/`、`specs/`、`harness/` | 通用阶段流程与脚本门禁 |
| **profile** | `profiles/<name>/` | 宿主 toolchain（如 hmos-app 的 hvigor/hdc/Hylyre）、phase-rules overlay、Skill addendum |
| **workflow** | `workflows/*.yaml` | phase DAG 与 `requires` 依赖（默认 `spec-driven`） |
| **instance extension** | 实例根 `doc/extensions/` | 业务 Skill、knowledge、lifecycle hooks、manifest |

实现入口：`profile-loader.ts`、`extension-loader.ts`、`capability-registry.ts`。协议 SSOT 见 [`concepts/extensibility.md`](concepts/extensibility.md)。

### 1.4 演进里程碑

framework 经历了多波演进。本节只做「为什么这样走」的回溯（版本摘要见 [`../RELEASE-NOTES-v2.0.md`](../RELEASE-NOTES-v2.0.md)）：

| 波次                      | 核心主题            | 主要交付                                                                                                                                              |
| ------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **初建**                  | 三层骨架            | `skills/` + `specs/phase-rules/` + `harness/` 首版；6 个阶段 Skill 打通端到端                                                                          |
| **第一波**                | 弱模型友好          | **三阶段 Scope 守门**（spec 声明 / plan 继承 / coding diff 比对）；**宿主语言**易错手册（由 profile 提供；如 `hmos-app` 为 ArkTS）+ 逐文件 lint                                                   |
| **第二波**                | 术语守门            | `module-catalog.yaml` + `glossary.yaml` 双 SSOT；spec 新增术语映射表 Step 1.5；三道 BLOCKER 防线                                                       |
| **第二三波**              | catalog-bootstrap 自举        | `/catalog-bootstrap` / `/glossary-bootstrap` 建档流程；护栏 A–D；种子词技术词 allowlist                                                                |
| **通用化**                | framework 脱耦      | 从原宿主工程剥离出 `framework/` 作为独立资产；架构 DSL 化（分层可配置）；[`agent adapter`](../agents/README.md) 插件化；`framework-init` Skill |
| **架构文档收窄**          | 边界划清            | `architecture.md` 改为**架构级契约文档**（只记 `dsl_change`/`module_set_change`/`responsibility_rewrite` 三类事件），不再承担 feature 级变更日志       |
| **UT 分层 v2 → v2.1**     | 刻骨教训            | v2 强制抽 `UseCase` 类 + `Port` 接口 → 简单 feature 翻车；v2.1 回退为**规约驱动**（UseCase 降级为 YAML 规约，代码形态 coding 自选）                   |
| **v2.2 真实编译/真机（hmos-app）**    | 假 PASS 三道护栏    | `coding_hvigor_build` / `ut_hvigor_build` / `ut_hvigor_test` / `ut_no_src_mutation` 全部 BLOCKER（仅当 profile 注册对应 capability）；改业务源码必须 `gap-notes` 登记                     |
| **v2.3 工具链识别（hmos-app）**       | DevEco 适配         | DevEco Studio 路径配置化、`detect-deveco.ts` 自动检测；`ut_hvigor_test` 改用 `genOnDeviceTestHap` + `hdc install` + `hdc shell aa test`                |
| **v2.4 文档体系**         | 对外材料长期化      | `framework/docs/` 文档树 + `DOC_INVENTORY.yaml` + `--phase docs` 自动检查文档新鲜度（即本目录）                                                       |
| **弱模型三层闭环**        | 步骤跳过 / 规则幻觉 | Layer 1（实例根全局入口 §4.1 / §5.1 / §6）+ Layer 2（`phase-completion-receipt.md` + `check-receipt.ts`）+ Layer 3（Stop hook，Claude adapter 下发）；[`agents/README.md`](../agents/README.md) |
| **init 体检脚本化**       | 反 LLM 幻觉         | 11 项 `check-init.ts` 全脚本化；`--phase init --adapter <name>`；init-diff Hallucination Ban |
| **v2.5 可扩展**           | workflow + 实例扩展 | `workflows/spec-driven.workflow.yaml`；全局 `--phase extensions`；`doc/extensions/` manifest + lifecycle hooks；`render-agents-md` 桥接扩展 Skill |
| **Profile 宿主解耦（2.0）** | 根目录中性化        | `profiles/hmos-app` / `generic`；`capability-registry` 按 profile 调度 `coding.compile` / `device_test.*`；宿主模板迁入 profile addendum |
| **v2.6 compat**           | 升级撞墙过渡        | `doc/features/<feature>/compat.yaml` 可过期降级；`npm run backfill:context`；见 [`evolution/compat-protocol-v1.md`](evolution/compat-protocol-v1.md) |
| **v2.7 hvigor 加速 + product 自动探测（hmos-app）** | hvigor 命令拼装 BLOCKER 与编译性能 | `profiles/hmos-app/harness/hvigor-runner.ts` 装配 flag；`detectProduct`；详见 [`profiles/hmos-app-harness-toolchain.md`](profiles/hmos-app-harness-toolchain.md) |
| **v2.8 Stop hook 跨会话隔离** | CLI 重启 / 多任务切换 | `state_machine.{grace_period_minutes, ttl_hours}`；`evaluateSessionStaleness`；`--clear-state`；[`operations/harness-runbook.md §10`](operations/harness-runbook.md) |
| **v2.8.1 全局阶段豁免**     | init 中途被 hook 拦截 | `isGlobalPhase` skip；全局 phase 不参与 feature 闭环判据 |
| **v2.8.2 多问题决策结构化** | framework-init 多个 y/n 并排 | Step 0.3.4 结构化收集；`multi-question single-y Ban` |
| **v2.8.3 弱模型 tool-call 兜底** | init 渲染 entry-file 卡死 | `render-agents-md.mjs` 升为首选路径；`tool-call retry-loop Ban` |
| **reports 外置**            | feature 产物与 submodule 分离 | `paths.reports_dir_pattern` → 默认 `doc/features/<feature>/<phase>/reports/` |
| **v2.9 Karpathy 四原则**    | Agent 行为 + 探索量化 | [`agent-behavioral-principles.md`](../skills/reference/agent-behavioral-principles.md)；`context-exploration.md` schema **1.1.0**；verifier `behavior_*` 维度 |
| **v2.10 exploration_strategy** | 大仓深度探索      | plan/coding **default-on subagent**；spec/review/ut **复合评分**；`sequential` 等价路径 |
| **Hylyre 真机闭环（2.0）**  | device-testing 端到端      | `device_test.build` / `install` / `run`；vendor wheel + venv；标准 feature + 即席 `_adhoc`（`npm run adhoc-device-test`） |
| **v3.1 merge-framework-config** | UPDATE 补缺       | `merge-framework-config.mjs` 字段级「只补缺不覆盖」；含 `tools.hylyre.*` |
| **v3.2–v3.4 确认 UX**     | 全 Skill 统一确认   | [`user-confirmation-ux.md`](../skills/reference/user-confirmation-ux.md) + registry schema 2.0；adapter interaction-renderer；`check-skills-confirmation-ux.ts` |

更多「**形态 / 宿主**默认假设」的剥离方向见 [`modality-framework-roadmap.md`](modality-framework-roadmap.md)。

**最重要的两条经验**（演进到今天才明白的）：

1. **"做 framework 最大的风险不是做不出来，是做多了"** —— v2 把端口/适配器架构硬塞进简单 feature，简单场景被强抽出 UseCase + Port，framework 会**系统性地诱导后续 feature 重复犯错**。v2.1 删除多条硬规则，新增 3 条，才把路走正。
2. **"显式对抗字面相似" > "更强大的检索"** —— 在 L1（Domain Glossary）/ L2（Module Catalog）/ L3（Repo Map）/ L4（Embedding RAG）/ L5（Symbol Graph）五种方案里，真正解决术语误映射的是 L1+L2 而不是 L4+L5；embedding 会把字面相似词算得很近，反而助长错误。详见 [`concepts/terminology-guarding.md`](concepts/terminology-guarding.md)。

---

## 二、framework 全貌与使用方式

### 2.1 总览图

```
目标工程根
├── framework/                      ← framework 资产（vendor 拷贝或 git submodule）
│   ├── README.md                     入门 + 命令清单
│   ├── MIGRATION.md                  升级 / 迁移指引
│   ├── RELEASE-NOTES-v*.md           大版本发布说明
│   ├── docs/                         对外讲解 + 演进材料（本目录）
│   ├── skills/                       生成层：9 篇阶段 Skill 正文（★00‑init · 0‑catalog+glossary · 1～6）
│   ├── specs/phase-rules/            阶段级规约 YAML
│   ├── profiles/                     宿主 profile（hmos-app / generic）：toolchain provider + overlay
│   ├── workflows/                    workflow DAG（默认 spec-driven.workflow.yaml）
│   ├── harness/                      验证层：check-*.ts + verify-*.md + harness-runner.ts
│   ├── agents/                       可插拔 adapter（Claude / Cursor / generic）
│   └── templates/                    AGENTS.md.template 等实例化模板
│
├── 全局入口 Markdown（文件名因 adapter 而异）   ← 由 adapter 生成
├── framework.config.json           ← 架构 DSL + project_profile + 路径 + adapter + 工具链
├── doc/
│   ├── architecture.md             ← 架构级 SSOT（只记架构级变更）
│   ├── extensions/                 ← 可选：实例扩展（manifest / hooks / knowledge）
│   ├── module-catalog.yaml         ← 模块画像 SSOT
│   ├── glossary.yaml               ← 业务术语 SSOT
│   └── features/<feature>/         ← 一个需求一个目录（含各 phase 的 reports/）
├── adapter 产物目录（.claude/ · .cursor/ 等）  ← slash / 跳板 / rules / hooks
└── 业务代码                         ← 按 architecture.md 的层级组织
```

### 2.2 全生命周期 Skill

| 阶段 | Skill                                                                  | 职责                              | 关键产物                                              | 主要门禁（BLOCKER）                                                                                                            |
| ---- | ---------------------------------------------------------------------- | --------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| ★    | [`framework-init`](../skills/project/framework-init/SKILL.md)             | 接入 / 升级 framework             | `framework.config.json` + agent 入口 + `doc/` 骨架    | adapter 显式选定；存在性体检；宿主 `.gitignore` 补齐；DevEco 工具链路径配置；S3 `run-global-phases` 验收（catalog/glossary/docs）；**UPDATE** 时 `cleanup-deprecated` 备份删除遗留 skill 跳板（含 `3-coding` 及 `prd-design` / `requirement-design` 等语义旧名，保留 `spec` / `plan` / `coding`）；init 后可 `npm test`（= `check:global`） |
| 0    | [`catalog-bootstrap`](../skills/project/catalog-bootstrap/SKILL.md)         | 模块画像 + 术语表自举             | `module-catalog.yaml` / `glossary.yaml`               | `easily_confused_with` 对称、`key_exports_fresh_vs_index`、种子技术词拦截                                                       |
| 1    | [`spec`](../skills/feature/spec/SKILL.md)                       | spec 撰写                          | `spec.md` + `acceptance.yaml`                          | **术语映射表**（人工逐条确认）+ **Scope 声明** + 术语模块 ⊆ Scope                                                               |
| 2    | [`plan`](../skills/feature/plan/SKILL.md)       | 技术设计                          | `plan.md` + `contracts.yaml` + `use-cases.yaml`*    | Scope 继承一致性、`architecture_impact` 声明、`use-cases.yaml` schema                                                          |
| 3    | [`coding`](../skills/feature/coding/SKILL.md)                               | 业务代码（宿主语言由 profile 决定，默认 ArkTS） | 源代码 + `contracts.yaml` + `context-exploration.md` | `diff_within_scope`、逐文件 Lint、**`coding_hvigor_build`**（profile capability） |
| 4    | [`code-review`](../skills/feature/code-review/SKILL.md)                     | 代码审查                          | `review-report.md`                                    | Review 结论一致性、BLOCKER 数量                                                                                                |
| 5    | [`business-ut`](../skills/feature/business-ut/SKILL.md)                     | 业务级 UT                         | `dag.yaml` + `*.test.ets` + 可选 `ut/reports/ac-coverage.json`  | **`ut_tsc_compiles`**、**`ut_hvigor_build`**、**`ut_hvigor_test`**、**`ut_no_src_mutation`**、`acceptance_coverage`（profile 驱动） |
| 6    | [`device-testing`](../skills/feature/device-testing/SKILL.md)               | 真机 / UI 自动化                  | `test-plan.md` + `test-report.md` + Hylyre trace      | **`device_test.build`** → **`install`** → **`run`**；`device_focus`；即席 **`_adhoc`** |

\* `use-cases.yaml` 仅在 feature 满足复杂度阈值（多 UI / 多步云 / 含回滚 任一）时产出。

**Research Sub-Phase**：写 spec / plan / coding / review / UT 主产物前须落盘 `context-exploration.md`（schema **1.1.0**）。详见 §2.3.4。

**执行规则**：

- 任何阶段开始前**必须完整读完**对应 SKILL.md + [`agent-behavioral-principles.md`](../skills/reference/agent-behavioral-principles.md)
- 每阶段产物**必须通过**脚本 Harness + verifier 子 agent；默认 **11** 项 phase（5 全局 + 6 feature），见 [`operations/harness-runbook.md`](operations/harness-runbook.md)
- 产物归档：`doc/features/<feature>/`；Harness 报告默认 `doc/features/<feature>/<phase>/reports/`（`paths.reports_dir_pattern`）

### 2.3 三大支柱的细节

#### 2.3.1 Skill 层（生成）

- **双层目录**：实际内容放在 `framework/skills/<skill>/SKILL.md` + `templates/` + `reference/` + `examples/`；各 adapter 在实例根暴露的**轻量入口**（slash / 跳板 / 规则）**不复制**正文，避免双源不一致（路径见 [`agents/README.md`](../agents/README.md)）。
- **渐进增强确认**（[user-confirmation-ux.md](../skills/reference/user-confirmation-ux.md)）：widget + portable 编号菜单 + 决策复述。各 adapter 通过 **interaction-renderer** 注入渲染协议；选项文案 SSOT：[confirmation-registry.yaml](../skills/reference/confirmation-registry.yaml)；lint：`check-skills-confirmation-ux.ts`
- **staging + 确认后才落地**：大产物先 staging 展示 diff，用户 `1/2/3/4`（或 `y/e/s/q`）回复之后才落地，对弱模型尤其关键

#### 2.3.1.1 确认 UX 治理

| 资产 | 路径 | 作用 |
|------|------|------|
| SSOT | [user-confirmation-ux.md](../skills/reference/user-confirmation-ux.md) | gate / enum / matrix / artifact 渐进增强规则 |
| Registry | [confirmation-registry.yaml](../skills/reference/confirmation-registry.yaml) | 全库确认点 `id` 登记 |
| 静态 lint | [check-skills-confirmation-ux.ts](../harness/scripts/check-skills-confirmation-ux.ts) | docs phase + `npm test` BLOCKER |
| 贡献门禁 | [skills/README.md](../skills/README.md) | 改确认流程须先更新 registry 再跑 lint |

#### 2.3.2 Spec 层（规约）

**阶段级规约**（[`../specs/phase-rules/*.yaml`](../specs/phase-rules/)）：每个 phase 一份 YAML，三类约束：

- `structure_checks`：结构 / 语法 / 一致性（脚本可检）
- `semantic_checks`：业务逻辑 / 设计合理性（AI 检）
- `traceability_checks`：跨阶段追溯（脚本 + AI）

**功能级规约与阶段产物**（归档在实例工程的 `doc/features/<feature>/`）：跨阶段契约（`acceptance.yaml`、`contracts.yaml` 等）在 feature 根；阶段主产物在 `<phase>/` 子目录（`spec/spec.md`、`plan/plan.md`、`review/review-report.md`、`testing/test-plan.md` 等，与 `context-exploration.md` / `reports/` 同树）。读侧兼容旧扁平路径，见 `harness/config.ts` artifact resolver。

| 文件               | 生产者              | 内容                                                  |
| ------------------ | ------------------- | ----------------------------------------------------- |
| `acceptance.yaml`  | spec             | 验收标准（AC-X），含 `priority` / `ut_layer` / `device_focus` |
| `contracts.yaml`   | plan             | 接口签名、数据模型、文件清单（从 plan.md 提取）      |
| `boundaries.yaml`  | spec + 2         | 边界用例、极端输入、性能指标                          |
| `use-cases.yaml`   | plan（条件式）   | 业务流程规约（仅复杂 feature 产出）                   |

#### 2.3.3 Harness 层（验证）

**双 Harness 组合拳**：

| 类型                                       | 特征                                  | 承担的检查                                                  |
| ------------------------------------------ | ------------------------------------- | ----------------------------------------------------------- |
| **脚本 Harness**（`check-*.ts`）           | 确定性、零误判、秒级反馈              | Schema / 一致性 / 符号禁用 / 覆盖率 / 真编译 / 真机执行    |
| **AI Harness**（`verify-*.md`）            | 语义级、概率性、由独立 verifier 子 agent 执行 | 业务逻辑正确性 / 设计合理性 / 端到端驱动                |

**跑法**：操作细节见 [`operations/harness-runbook.md`](operations/harness-runbook.md)。

**AI Harness 为什么不直接调 API？**
因为 Spec / Prompt 是纯文本，把**"组装 prompt"和"调模型"解耦**，才能让用户在任意已接入的 agent 宿主中运行。脚本只生成 prompt，由 agent 层决定怎么调用 —— 这就是"模型无关"的实现路径。

#### 2.3.4 Agent 行为规约与 Context Exploration Gate

与三层 Spec/Skill/Harness 正交，还有 **行为层 + 探索层** 约束（[`agent-behavioral-principles.md`](../skills/reference/agent-behavioral-principles.md)）：

| 原则 | Framework 落地 |
|------|----------------|
| **Research First** | 主产物前 `context-exploration.md`；`source_code_paths` 须真实存在；代码与文档冲突以代码为准 |
| **Minimum Viable** | 不超出 spec/plan/contracts 范围；禁止投机性抽象 |
| **Surgical** | coding/review diff 落在 scope 与 contracts 内 |
| **Verify Before Proceed** | harness + verifier + receipt + trace 四件套；Coding 逐文件 lint |

**exploration_strategy**（phase-rules + `exploration-strategy.ts`）：plan/coding 默认 **subagent** 探索（L1 trivial 可豁免）；spec/review/ut 按 **复合评分**（模块 LOC、跨层、fan-out 等）决定是否必须 subagent；无 subagent 时走 **sequential** 等价路径（量化阈值 × multiplier）。

存量 feature 升级撞新 BLOCKER：优先 `npm run backfill:context`，或短期 `compat.yaml`（见 [`evolution/compat-protocol-v1.md`](evolution/compat-protocol-v1.md)）。

#### 2.3.5 device-testing · 真机测试（Hylyre 能力链）

hmos-app profile 下 testing harness 按 capability 串联（`capability-registry.ts` → `profiles/hmos-app/harness/`）：

```mermaid
flowchart LR
  TP[test-plan.md SSOT] --> DER[derive Hylyre plan / steps]
  DER --> BUILD[device_test.build hvigor]
  BUILD --> INST[device_test.install hdc]
  INST --> RUN[device_test.run Hylyre]
  RUN --> RPT[test-report + trace]
```

- **标准 feature**：`acceptance.yaml`（`ut_layer` + `device_focus`）→ 派生/更新 `test-plan.md` → lint → 执行；报告落 `doc/features/<feature>/testing/reports/<ts>/hylyre/`
- **即席 `_adhoc`**：外部 bundle / 临时验证；`npm run adhoc-device-test`（derive → agent 写 `test-steps.json` → lint → 执行）；默认冷启动，可选 `--continue-session`
- **配置 SSOT**：`framework.config.json > tools.hylyre.*`（CREATE/UPDATE 可由 `merge-framework-config.mjs` 补缺）

宿主 toolchain 细节见 profile addendum 与 [`profiles/hmos-app-harness-toolchain.md`](profiles/hmos-app-harness-toolchain.md)。

### 2.4 可插拔 Agent Adapter

不同宿主对「如何加载指令、如何触发命令」约定不同，但 Skill **正文唯一 SSOT** 仍在 `framework/skills/`。差异由 `framework/agents/<adapter>/` 封装——**对照表、路径与 Layer 3 行为**只维护在 [`agents/README.md`](../agents/README.md)。

**新增 adapter**：在 `framework/agents/<name>/` 下建目录、按 `adapter-schema.yaml` 写 `adapter.yaml`、放模板。Skill 本身无需改一行。

### 2.5 关键能力拆解

#### A. 架构 DSL 与 project_profile

`framework.config.json → architecture` 声明工程的分层（外层 + 内层）+ 依赖矩阵；`project_profile.name` 选择宿主 profile（默认 `hmos-app`）。`check-plan.ts` / `check-coding.ts` / `check-testing.ts` 等经 **profile-host-loader** 调度宿主 capability，根 harness 只做编排。

- 极简 3 层 App：改 `outer_layers` / `module_inner_layers` 即可，framework 核心一行不改
- 元规则不可配：依赖方向自上而下、层级图须为 DAG、跨模块只许通过 `cross_module_exports_file`
- 详见 [`../profiles/README.md`](../profiles/README.md) 与 [`concepts/extensibility.md`](concepts/extensibility.md)

#### B. 术语表 + 模块画像（自然语言 → 技术模块）

详见 [`concepts/terminology-guarding.md`](concepts/terminology-guarding.md)。

#### C. 三阶段 Scope 守门（防 scope creep）

```mermaid
graph LR
    p["spec 阶段<br/>声明<br/>in_scope / out_of_scope"] -->
    d["plan 阶段<br/>assert plan.modules ⊆ spec.scope<br/>越界必发 Scope 扩展提议"] -->
    c["Coding 阶段<br/>git diff 文件路径 ⊆ scope 模块<br/>BLOCKER"]
```

任何"顺手改一下"都必须回到 plan 阶段走**显式扩展提议**（`expansions_with_user_approval`），用户批准后才能写入。

#### D. 业务级 UT 分层分工

UT 是**既有代码的消费者**，不驱动架构。详见 [`skills/feature/business-ut.md`](skills/feature/business-ut.md)。

#### E. 跨阶段追溯链

Spec 是追溯链的枢纽，每一环都由脚本 Harness 自动验证：

```
spec.md ─→ acceptance.yaml (AC1, AC2, BD1, BD2...)
               │ spec_to_plan_coverage
               ▼
plan.md ─→ contracts.yaml (interfaces, data_models, files, linked: AC1→func1)
               │ plan_to_code_coverage
               ▼
source code (func1.ets, func2.ets...)
               │ code_to_ut_coverage
               ▼
UT (DAG + *.test.ets, it() 标签 [BRANCH-x][AC-Y])
               │ spec_acceptance_to_test
               ▼
Test Plan（由 acceptance `device_focus` 派生）
```

### 2.6 使用方式（接入工程的两种部署模式）

#### 模式 A · Vendor（推荐默认）

直接拷贝 `framework/` 目录到目标工程根，**1 步手动复制 + 后续全自动**：

```bash
# Linux / macOS
rsync -av --exclude=node_modules --exclude=dist --exclude='reports/*' \
      --exclude=trace path/to/framework-source/framework/ ./framework/

# Windows PowerShell
robocopy path\to\framework-source\framework .\framework /E ^
         /XD node_modules dist trace ^
         /XF reports
```

之后**所有**初始化工作（宿主 `.gitignore` 补齐 / `npm install` / S3 `run-global-phases` / harness 验证）由 `/framework-init` Skill 自动完成；DevEco 路径由 personal setup（阶段 `--ensure`）写入 `framework.local.json`。详见 [`../MIGRATION.md`](../MIGRATION.md)。

#### 模式 B · Submodule

```bash
git submodule add <framework-repo-url> framework
git submodule update --init --recursive
```

之后同样跑 `/framework-init` 完成所有自动化步骤。Submodule 升级走 `git submodule update --remote framework` + `/framework-init UPDATE`（UPDATE 会清理实例根遗留 skill 跳板，勿跳过 `cleanup-deprecated`）。

#### 选择建议

| 优先级                   | 模式               | 理由                                                |
| ------------------------ | ------------------ | --------------------------------------------------- |
| 工程内网 / 不能加 submodule | Vendor             | 一次拷贝即可，`/framework-init` 自动化所有后续步骤 |
| 多仓共享 framework        | Submodule          | 升级集中管理，diff 走 git submodule update         |
| 需要在 framework 仓直接改   | Submodule + 反推    | 在 submodule 工作树里改、commit、push 回 framework 仓 |

#### 日常需求（一条 feature 完整流程）

```bash
# Step 0: 涉及新模块/新术语，先走 catalog-bootstrap
/catalog-bootstrap <新模块名>      # 或自然语言：为 X 模块建档
/glossary-bootstrap                # 按需扩充术语表

# Step 1 ~ 6
/spec <feature 描述>
/plan
/coding
/code-review
/business-ut
/device-testing
```

每一步的脚本 Harness 结果 + AI Harness 语义审查都会落在 `doc/features/<feature>/<phase>/reports/`（未配置 `paths.reports_dir_pattern` 时仍为 `framework/harness/reports/<feature>/<phase>/`），PASS 之前不要进入下一阶段。

### 2.7 为什么这个 framework 是"工程级资产"

> 你可以把它看成一套**给 AI 的"企业规约"** —— 把对软件研发的经验、约定、红线、追溯要求，从"人脑隐性知识"转成了 **机器可读 + 机器可验 + 模型无关**的显式契约。新同事接手、新模型上线、新工程接入，都按同一套流程走，不会"每个 AI 一个风格"。

---

## 三、常见问题与解决方案

以下是实践中最频繁遇到的痛点 + 当前 framework 的解法。

### 3.1 Scope creep（AI 擅自扩大改动范围）

**症状**：AI 顺手改了无关模块；review 阶段才发现 git diff 范围远超预期。

**根因**：spec 没有声明"只能改哪些"，AI 只能按"相关性"猜测。

**解法（三阶段 Scope 守门）**：

- spec 必须声明 `in_scope_modules` / `out_of_scope_modules` / `rationale`
- plan.md 必须继承 spec scope；扩展走显式"Scope 扩展提议"流程
- coding 阶段 `diff_within_scope` BLOCKER：git diff 涉及的文件必须全部在 scope 内

落地：[`../harness/scripts/utils/scope-parser.ts`](../harness/scripts/utils/scope-parser.ts) + [`check-coding.ts`](../harness/scripts/check-coding.ts) 的 `checkDiffWithinScope`。

### 3.2 术语误映射（"字面相似但语义不同"）

详见 [`concepts/terminology-guarding.md`](concepts/terminology-guarding.md)。

### 3.3 UT 的"声明覆盖陷阱"

**症状**：UT 报告 80%+ 覆盖率，但线上一遇业务流异常就炸。打开看，UT 写成了 `expect(repo.getList().length > 0)` —— 业务流程完全没跑。

**根因**：UT 变成了"数据接口测试"，而不是"业务流端到端驱动"。

**解法**：详见 [`skills/feature/business-ut.md`](skills/feature/business-ut.md) 的"驱动 vs 声明"章节。

### 3.4 UI mock 泥潭

**症状**：为了让 UT 能跑 onClick → Navigation → Toast 这一连串 UI 副作用，造了一堆 `FakeNavPathStack` / `FakePromptAction`。SDK 一升级全红。

**根因**：ArkTS 的 `@Component struct` 是编译期语法糖，hypium 下无法实例化；试图在 UT 里验证 UI 交互是反人性的。

**解法（彻底禁 UI import）**：详见 [`skills/feature/business-ut.md`](skills/feature/business-ut.md) 的"UT 与 device 分工"。

### 3.5 UT "假 PASS"（v2.2 三道护栏）

**症状**：弱模型生成的 UT 大量 `tsc` 编译不过、或 hvigor 报错、或在没设备的 CI 上"无设备 → SKIP → PASS"，但 harness 全绿。

**根因**：v2.1 之前 harness 只做静态结构扫描，缺少"真编译 / 真运行"出口。

**解法（v2.2 + profile 解耦）**：

| 规则                  | 落点                                                                 | 严重度  | 触发逻辑                                                                                                |
| --------------------- | -------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------- |
| `ut_tsc_compiles`     | `check-ut.ts` + profile `ts-compile.ts`（hmos-app 经 shim 亦可从根 `scripts/utils/ts-compile.ts` 导入） | BLOCKER | TypeScript Compiler API 对 `*.test.ets` 做 `noEmit` 扫描；零 Error 才通过                               |
| `coding_hvigor_build` | `check-coding.ts` → **`capability-registry`** → `profiles/<name>/harness/hvigor-runner.ts` | BLOCKER | 对每个业务模块跑 `assembleHap`；解析 ArkTS:ERROR / TSxxxx 即 FAIL；工具链缺失也是 FAIL（不 SKIP）       |
| `ut_hvigor_build`     | `check-ut.ts` → profile `hvigor-runner.ts`                           | BLOCKER | 对 `<module>@ohosTest` 跑 `assembleHap`；兜底 tsc 漏过的跨文件类型违约                                  |
| `ut_hvigor_test`      | `check-ut.ts` → profile `hdc-runner.ts`                              | BLOCKER | `genOnDeviceTestHap` + `hdc install` + `hdc shell aa test`；解析 hypium `OHOS_REPORT_RESULT`            |
| `ut_no_src_mutation`  | `check-ut.ts` + `scripts/utils/git-diff.ts`                         | BLOCKER | git diff 检测业务源码改动；未在 `gap-notes.md > approved_src_mutations[]` 登记的一律 FAIL              |

**调度模型**：根 `check-coding` / `check-ut` / `check-testing` 只做编排；宿主 toolchain 由 **`project_profile`** 注册 capability（`coding.compile`、`ut.compile`、`ut.run`、`device_test.*`），经 **`capability-registry.ts`** 动态加载 `profiles/<name>/harness/providers/*`。generic profile 可声明 SKIP，脚本层返回 SKIP 而非假 PASS。

**配套**：

- coding SKILL.md 新增"真实编译闭环"步骤：agent 必须自己跑 hvigor、读日志、定位修复，不允许把编译失败标为"环境问题"
- business-ut SKILL.md 新增"UT 编译闭环 + 装机运行闭环"，并把"不修改业务源码"升级为 HARD STOP
- `verify-ut.md` prompt 顶部加 HARD STOP 等价条款，verifier 检测疑似为"为 UT 便利新增的工具函数"时强制标 BLOCKER

### 3.6 弱模型吞字反转语义

**症状**：同一份模板，弱模型落地后关键词"不 / 禁 / 严 / 仅"经常被吞掉，语法仍通顺，语义完全反转。

**示例**：

| 原文                      | 落地                  | 后果                  |
| ------------------------- | --------------------- | --------------------- |
| "本 Skill **不**会覆盖" | "本 Skill 会覆盖"   | 下次重跑毁资产        |
| "**严禁**未确认前覆盖"  | "未确认前覆盖"      | 绕过人工门禁          |
| "**禁止**逆向依赖"      | "允许逆向依赖"      | 架构契约失效          |

**根因**：中文"不"字单字吞掉后语法仍然通顺，无法被语法校验发现；让 LLM "重写整段模板长文本"就会给它吞字机会。

**解法（部分已落地，持续推进）**：

1. **Data-driven over LLM-driven**：adapter 拷贝、`render-agents-md.mjs` 占位符渲染、`merge-framework-config.mjs` 等已脚本化；`check-init.ts` 11 项体检 + init-diff Hallucination Ban 已 BLOCKER
2. **三分区纪律**：受管文档划分 `<!-- framework:skeleton/data/narrative -->` 三区（skeleton/data 区 sha256 / 重渲染比对 —— 推进中）
3. **正向 over 负向**：能用白名单 / "仅 X" 表达的不用"不要 X"
4. **negation-diff verifier**：独立 verifier 子 agent 逐句比对极性词翻转（规划中）

### 3.7 过度架构化（v2 UseCase 翻车）

详见 [`skills/feature/business-ut.md`](skills/feature/business-ut.md) 的"v2 → v2.1 教训"。

**教训（值得记到墓志铭上）**：

> 做 framework 时最怕的不是功能不够，是把某种架构风格强塞进所有场景。

### 3.8 架构文档被 feature 级变更污染

**症状**：`doc/architecture.md` 被每一个 feature 改动拿来追加一行变更记录，几个月后变成了 git blame 的彩色版 —— 每一行都跟当前架构没关系。

**解法**：

- plan.md 新增**"架构影响声明"**章节，必填 `architecture_impact ∈ {none, dsl_change, module_set_change, responsibility_rewrite}`
- 只有后三种才触发 architecture.md 更新；`impact: none` 是 90% 场景的缺省值
- `check-plan.ts` 的 `checkDesignToArchitecture` 按 `impact` 字段条件式 SKIP
- architecture.md 定位收窄为**架构级契约文档**；模块职责 / 公共能力 / 易混点移到 `module-catalog.yaml`

### 3.9 端到端"一键完成"的误区

**症状**：期望 `harness-runner` 能一键跑完 spec → plan → coding → review → UT → testing。

**正解**：Harness 是**每步归档后的质量门禁**，不是开发流水线。各阶段文档与代码仍需按 Skill 由 AI + 人工完成；Harness 的职责是**卡住错误不让往下传**。`AI Harness` 脚本只生成 `ai-prompt.md`，**不会自动调模型** —— 这是模型无关性的前提。

---

## 四、未尽事宜与未来演进

### 4.1 已知局限（当前版本）

| 类别                        | 局限                                                    | 影响                              | 缓解                                                            |
| --------------------------- | ------------------------------------------------------- | --------------------------------- | --------------------------------------------------------------- |
| **Glossary 覆盖**           | 默认沙盒只有 ~15 条术语，真实工程估计需要 50-200 条      | 首轮接入需集中扩充                | catalog-bootstrap `/glossary-bootstrap` 支持增量建档                      |
| **弱模型吞字防护**          | init 渲染 / adapter 拷贝已脚本化；三分区哨兵与 negation-diff 仍在推进 | UPDATE 模式 narrative 区仍有反转风险 | `render-agents-md.mjs` 首选路径 + `check-init.ts`；三分区 + negation-diff 待落地 |
| **plan 启发式误报**         | `file_structure_per_module` / `interface_signatures_complete` 用正则启发式 | 偶发误报需人工识别噪声            | 后续替换为 AST 精确分析                                         |
| **diff 基线**               | 未设 `HARNESS_DIFF_BASE_REF` 时默认为 **working**（工作区 vs `HEAD`） | CI 若要扫「区间内已提交」需显式传 `HARNESS_DIFF_BASE_REF`（如 merge-base） | 见 `coding-rules.yaml` / `git-diff.ts`                                                            |
| **acceptance→test-plan 分层** | SSOT 为 `acceptance.yaml` 的 `ut_layer` + `device_focus`；`device-testing-todo.md` 已废弃 | 存量 feature 若仍引用旧 todo 易误读 | 见 [acceptance-layering.md](concepts/acceptance-layering.md)；`device_ac_delegation` BLOCKER（`device_focus`） |
| **架构漂移检测**            | 大仓长期 drift 缺 `check-architecture` 类门             | 架构违规靠 code review 兜底       | 纳入后续议题                                                     |

### 4.2 短期（1–2 个月）

- **完成弱模型吞字防护剩余项**：三分区哨兵 sha256 门禁 + negation-diff verifier
- **验收分层存量迁移**：各存量 feature 补全 `device_focus`、清理遗留 `device-testing-todo.md`、按 acceptance 重派生 test-plan
- **第一次真实复杂 feature 实战**：在多步业务流程的真实场景做 v2.1 实战验证，按结果反哺 `use-cases.yaml` Schema
- **首次外部工程接入**：用完全不同架构的 HarmonyOS 工程验证架构 DSL 化是否真的解耦
- **trace.json + gap-notes 回传闭环打通**

### 4.3 中期（3–6 个月）

- **WP7 · 分层 Repo Map**（详见 [`concepts/terminology-guarding.md`](concepts/terminology-guarding.md) §5）：当"术语归属已基本无错，但 contracts 签名错误偏多"时启动
- **元服务差异化规则**：`project_type: atomic_service` 扩展位已预留
- **DAG 可视化工具**：Mermaid 自动渲染 + 覆盖率热图
- **`check-*.ts` 与 IDE 深度集成**：保存时跑门禁

### 4.4 长期（6+ 个月，视真实收益决定）

- **WP8 · 语义检索 / 符号图**（观望）：启动需同时满足多项硬条件，详见 [`concepts/terminology-guarding.md`](concepts/terminology-guarding.md) §6
- **明确的"不做"清单**：
  - 完整的 Kythe / Glean 系统（成本与收益严重不匹配）
  - 训练领域模型（数据不足）
  - 替换现有三层 framework（增量演进优先）
- **AI Harness 专用小模型微调**：降低对通用大模型的依赖

---

## 附录 · 关键文件索引

### 顶层入口

- [`../README.md`](../README.md) · framework 静态使用说明
- [`../skills/README.md`](../skills/README.md) · Skill 索引
- [`../MIGRATION.md`](../MIGRATION.md) · 升级与迁移说明
- [`../RELEASE-NOTES-v2.0.md`](../RELEASE-NOTES-v2.0.md) · 2.0 发布说明（[`v1.0`](../RELEASE-NOTES-v1.0.md)）

### 核心 SSOT（实例工程侧）

- `framework.config.json` · 架构 DSL + `project_profile` + 路径 + adapter + 工具链
- `doc/architecture.md` · 架构级契约文档
- `doc/module-catalog.yaml` · 模块画像 SSOT
- `doc/glossary.yaml` · 业务术语 SSOT
- `doc/extensions/` · 可选实例扩展（manifest / hooks / knowledge）

### Skill 正文

- [`../skills/project/framework-init/SKILL.md`](../skills/project/framework-init/SKILL.md)
- [`../skills/project/catalog-bootstrap/SKILL.md`](../skills/project/catalog-bootstrap/SKILL.md)
- [`../skills/feature/spec/SKILL.md`](../skills/feature/spec/SKILL.md)
- [`../skills/feature/plan/SKILL.md`](../skills/feature/plan/SKILL.md)
- [`../skills/feature/coding/SKILL.md`](../skills/feature/coding/SKILL.md)
- [`../skills/feature/code-review/SKILL.md`](../skills/feature/code-review/SKILL.md)
- [`../skills/feature/business-ut/SKILL.md`](../skills/feature/business-ut/SKILL.md)
- [`../skills/feature/device-testing/SKILL.md`](../skills/feature/device-testing/SKILL.md)

### 规约与门禁

- [`../specs/phase-rules/`](../specs/phase-rules/) · **11** 份阶段规约 YAML（含 extensions / init / docs 等全局 phase）
- [`../harness/scripts/`](../harness/scripts/) · 脚本 Harness
- [`../harness/prompts/`](../harness/prompts/) · AI Harness prompt
- [`../skills/reference/agent-behavioral-principles.md`](../skills/reference/agent-behavioral-principles.md) · Karpathy 四原则 SSOT
- [`../profiles/README.md`](../profiles/README.md) · profile 宿主解耦说明

### 同目录深读

- [`concepts/terminology-guarding.md`](concepts/terminology-guarding.md) · 术语守门：为什么 catalog + glossary 比 RAG 更直打问题
- [`concepts/extensibility.md`](concepts/extensibility.md) · 四层扩展模型（framework → profile → workflow → extensions）
- [`concepts/acceptance-layering.md`](concepts/acceptance-layering.md) · acceptance `ut_layer` / `device_focus` 与 UT / 真机分工
- [`evolution/compat-protocol-v1.md`](evolution/compat-protocol-v1.md) · 存量 feature 升级过渡协议
- [`skills/feature/business-ut.md`](skills/feature/business-ut.md) · 业务级 UT 的设计哲学 + v2 → v2.1 → v2.2 演进
- [`profiles/hmos-app-harness-toolchain.md`](profiles/hmos-app-harness-toolchain.md) · hmos-app hvigor / hdc / Hylyre 能力链
- [`operations/harness-runbook.md`](operations/harness-runbook.md) · Harness（默认 **11** 项 phase / spec-driven DAG）的命令、报告、排错速查

---

## 维护同步（2026-05-22 · 对齐 2.0）

- **Profile 解耦**：`project_profile` 下宿主实现包括 `harness/ut-host-impl.ts`、`harness/coding-host-rules.ts`、`hvigor-runner.ts`、`hdc-runner.ts` 等；根 `check-ut` / `check-coding` / `check-testing` 经 **`capability-registry.ts`** 调度，generic profile 可 SKIP。
- **Hylyre 真机**：device-testing `device_test.build` / `install` / `run`；标准 feature + 即席 `_adhoc`（`npm run adhoc-device-test`）；报告默认 `doc/features/<feature>/testing/reports/<ts>/hylyre/`。
- **Agent 行为 + 探索**：[`agent-behavioral-principles.md`](../skills/reference/agent-behavioral-principles.md)；`context-exploration.md` schema **1.1.0**；`exploration_strategy` 复合评分 / subagent 默认路径。
- **确认 UX**：[`user-confirmation-ux.md`](../skills/reference/user-confirmation-ux.md) + registry schema 2.0；adapter **interaction-renderer** 统一注入。
- **reports 外置**：`paths.reports_dir_pattern` 默认 `doc/features/<feature>/<phase>/reports/`。
- **升级工具**：`merge-framework-config.mjs` 字段级补缺；`compat.yaml` + `npm run backfill:context` 过渡存量 feature。
- **Framework-init**：`framework.config.json` 在 **S3 执行** 落盘，须早于 `render-agents-md`；`render-agents-md.mjs` 为弱模型首选渲染路径。
- **acceptance 分层 SSOT**：`acceptance.yaml` 的 `ut_layer` + `device_focus`；`device-testing-todo.md` 已废弃。

---

## 一句话总结

> **短期靠"显式枚举术语与模块的反例与混淆项 + 人工逐条确认"对抗字面相似陷阱；
> 中期靠"分层 Repo Map"让弱模型在不读完全仓的前提下看见真实接口；
> 长期看收益再决定是否引入语义级检索。
> 核心不变：任何时候模型的决策路径都必须是人类可审的显式对抗，而不是黑盒相似度。**

<!--
  last-synced: 2026-06-12 (2.3.0: spec/plan phase id、workflow DAG、skill-assets、MIGRATION §v2.3)
  Skill 与中台文档路径变更后同步维护同步段落（doc_freshness）。
-->
