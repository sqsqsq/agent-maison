---
name: framework-generalization-plan
overview: 把 skills/specs/harness 从钱包实例里解耦出来，在本仓库建立「framework/（通用 SSOT）+ 钱包实例」双层结构。framework 走最薄核心路线——不假设具体层级架构，只守元规则；所有配置由一个 AI 驱动的「Framework 初始化 Skill」在目标工程里交互式生成。Agent 绑定（Claude / Cursor / 通用）通过可插拔 adapter 支持，第一版覆盖 claude + cursor。元服务差异留作第二阶段增量。
todos:
  - id: phase1-split
    content: 阶段 1：物理拆分——`git mv` skills / specs/phase-rules / harness 进 framework/；仓库根 specs/phase-rules 直接删除（非保留指针）；更新全局路径引用；钱包 home-page 全链路回归 PASS
    status: completed
  - id: phase2-arch-meta
    content: 阶段 2：架构元模型化——把 phase-rules 和 check-*.ts 里写死的「五层 + 模块内四层」改为读取实例工程声明的层级 DSL；framework 只守「依赖方向自上而下、禁止循环、仅 Index.ets 跨模块导出」等元规则
    status: completed
  - id: phase3-harness-config
    content: 阶段 3：新建 `framework/harness/config.ts` 集中管理可覆盖路径，改造 harness-runner.ts + 所有 check-*.ts 消除硬编码；支持读取实例工程根的 `framework.config.json`
    status: completed
  - id: phase4-dewallet-text
    content: 阶段 4：去钱包化 skills / harness / prompts 内的文案（例子标注为参考示例；核心规则表述通用化）；`.claude/commands/` 暂保留原貌，等阶段 5 由 adapter 层重建
    status: completed
  - id: phase5-agent-adapters
    content: 阶段 5：`framework/agents/` 插件化 adapter 层——定义 adapter.yaml 协议，第一版实现 `generic`（AGENTS.md）、`claude`（CLAUDE.md + .claude/commands/）、`cursor`（.cursor/skills/ 跳板 + .cursor/rules/）三个 adapter
    status: completed
  - id: phase6-init-skill
    content: 阶段 6：新建 `framework/skills/00-framework-init/` 初始化 Skill，AI 驱动完成：扫描工程目录 → 询问项目类型/名称/架构 DSL/agent 偏好 → 生成 framework.config.json + AGENTS.md（或 CLAUDE.md）+ architecture.md 骨架 + catalog/glossary 骨架 + 所选 agent adapter 产物
    status: completed
  - id: phase7-atomic-slot
    content: "阶段 7：元服务扩展位预留（catalog format 枚举加 AtomicService、framework.config.json 支持 project_type: atomic_service；不写差异化规则，留 roadmap 文档）"
    status: cancelled
  - id: phase8-docs-binding
    content: 阶段 8：framework/README.md（静态使用说明）+ framework/MIGRATION.md（模板由初始化 Skill 按当前状态生成到实例工程）；归档旧自检报告；改写仓库根 README 明确双重身份；Skill 0 / Skill 1~6 的 SKILL.md 描述文件增加「依赖初始化 Skill 产物」的前置声明
    status: completed
isProject: false
---

## 目标与约束

- **复用形态**：本仓库 = `framework/`（通用 SSOT）+ 仓库根的钱包实例。其他 HarmonyOS 工程通过 `git submodule add` 引入 `framework/`，再跑 **Framework 初始化 Skill** 生成自己的实例文件。
- **Framework 的定位就是「最薄核心 + 可插拔」**：
  - 不预设任何具体架构（层数、层名、依赖矩阵）——全部由实例工程在 `framework.config.json` 里声明，phase-rules / check-* 从声明里读
  - 不预设任何 agent 绑定——Claude / Cursor / 其他 agent 通过 `framework/agents/<name>/` adapter 插件承载，初始化时选哪个就激活哪个
- **初始化的入口是 Skill，不是脚本**：所有"读现有工程 → 问用户 → 生成文件"的动作都通过 AI 驱动的 `00-framework-init` Skill 完成，能力等同于其他 skill（可补问、可改、可回看），而非一次性 CLI 交互
- **元服务**：本阶段**不做**差异化规则，仅在 catalog `format` 枚举和 `framework.config.json` 的 `project_type` 字段里预留扩展位
- **向后兼容**：钱包 home-page 示例在重构期间必须能继续跑通 `harness-runner.ts` 全链路，作为回归基线

---

## 仓库目标形态

```
SimulatedWalletForHmos/                        ← 根仓库（双重身份：framework 宿主 + 钱包实例）
├── framework/                                 ← 通用可复用资产；可作 git submodule 被其他 HarmonyOS 工程引入
│   ├── README.md                              ← framework 静态使用说明（如何引入、怎么跑初始化 skill）
│   ├── skills/
│   │   ├── 00-framework-init/                 ← ★ 新增：AI 驱动的初始化 Skill（framework 对外入口）
│   │   │   ├── SKILL.md
│   │   │   ├── prompts/                       ← 扫描工程 / 询问架构 DSL / 选 agent 的推断 prompt
│   │   │   └── templates/                     ← 初始化过程中的小型模板片段（architecture DSL 问卷等）
│   │   ├── 0-catalog-bootstrap/ ... 6-device-testing/  ← 原有 7 个 skill 搬过来
│   │   └── README.md                          ← 所有 skill 的入口索引
│   ├── specs/
│   │   └── phase-rules/                       ← 8 份 yaml（prd/design/coding/review/ut/testing/catalog/glossary）
│   ├── harness/
│   │   ├── harness-runner.ts
│   │   ├── config.ts                          ← ★ 新增：集中管理路径与架构 DSL 读取
│   │   ├── scripts/ prompts/ trace/ package.json tsconfig.json
│   │   └── ...
│   ├── templates/                             ← 被初始化 Skill 消费的实例骨架
│   │   ├── AGENTS.md.template                 ← 通用 agent 入口文件模板
│   │   ├── architecture.md.template           ← 架构说明文档的空骨架（含 DSL 示例片段）
│   │   ├── framework.config.template.json     ← 配置文件模板（含架构 DSL 字段示例）
│   │   ├── module-catalog.yaml                ← Skill 0 空骨架
│   │   ├── glossary.yaml                      ← Skill 0 空骨架
│   │   └── glossary-seed.txt                  ← 种子注释模板
│   ├── agents/                                ← ★ 新增：可插拔 agent adapter
│   │   ├── adapter-schema.yaml                ← adapter 协议定义（每个 adapter 必须声明什么）
│   │   ├── generic/
│   │   │   ├── adapter.yaml                   ← agent_file: AGENTS.md；commands_dir: 无
│   │   │   └── templates/                     ← 通用模式不产生 agent 专属文件
│   │   ├── claude/
│   │   │   ├── adapter.yaml                   ← agent_file: CLAUDE.md；commands_dir: .claude/commands/
│   │   │   └── templates/                     ← .claude/commands/*.md 各 slash command 模板
│   │   └── cursor/
│   │       ├── adapter.yaml                   ← skill_dir: .cursor/skills/；rules_dir: .cursor/rules/
│   │       └── templates/                     ← .cursor/skills/*/SKILL.md 跳板、.cursor/rules/*.mdc
│   └── docs/
│       └── atomic-service-roadmap.md          ← 元服务扩展路线图占位
│
├── AGENTS.md                                  ← ← 钱包实例（若钱包改成 generic adapter）
│   或 CLAUDE.md（若钱包本身选 claude adapter 则命名为这个）
├── framework.config.json                      ← ← 钱包实例的 framework 配置（架构 DSL、路径、agent 选择等）
├── .claude/ / .cursor/                        ← 由钱包选的 adapter 产物
├── doc/                                       ← 钱包实例的业务文档
│   ├── architecture.md                        ← 钱包的五层+四层实例（顶部注明：基于 framework/templates 实例化）
│   ├── module-catalog.yaml
│   ├── glossary.yaml
│   ├── glossary-seed.txt
│   └── features/home-page/...
├── specs/
│   └── features/home-page/                    ← 钱包实例的 feature contracts
│   （仓库根不再保留 specs/phase-rules/，直接引用 framework/specs/phase-rules/）
├── 01-Product/ 02-Feature/ 04-BusinessBase/ 05-SystemBase/ ← 钱包代码
└── ...
```

**关键设计**：
- **没有 specs/phase-rules/ 指针**：harness 默认从 `framework/specs/phase-rules/` 读（在 config.ts 里定义）
- **实例专属内容**：`AGENTS.md` / `CLAUDE.md` / `framework.config.json` / `doc/*` / `specs/features/*` / 代码模块目录 → 全部由初始化 Skill 生成或用户维护，不进 framework
- **agent 产物**（`.claude/`、`.cursor/`）也是由 adapter 在初始化阶段产出的实例文件

---

## 核心新概念：架构 DSL 与 framework.config.json

framework 不预设任何具体架构，而是读取每个实例工程在 `framework.config.json` 里的声明。示例（钱包工程初始化完成后）：

```json
{
  "schema_version": "1.0",
  "project_name": "SimulatedWalletForHmos",
  "project_type": "app",
  "agent_adapter": "claude",
  "architecture": {
    "outer_layers": [
      { "id": "01-Product", "can_depend_on": ["02-Feature", "03-CommonBusiness", "04-BusinessBase", "05-SystemBase"], "intra_layer_deps": "forbid" },
      { "id": "02-Feature", "can_depend_on": ["03-CommonBusiness", "04-BusinessBase", "05-SystemBase"], "intra_layer_deps": "sublayer",
        "sublayers": [
          { "id": "top",    "members_pattern_or_list": ["WalletMain"],              "can_depend_on_sublayers": ["middle", "bottom"] },
          { "id": "middle", "members_pattern_or_list": ["SwipeCard"],               "can_depend_on_sublayers": ["bottom"] },
          { "id": "bottom", "members_pattern_or_list": ["BankCard","TransportCard"], "can_depend_on_sublayers": [] }
        ]
      },
      { "id": "03-CommonBusiness", "can_depend_on": ["04-BusinessBase", "05-SystemBase"], "intra_layer_deps": "dag" },
      { "id": "04-BusinessBase",    "can_depend_on": ["05-SystemBase"],              "intra_layer_deps": "forbid" },
      { "id": "05-SystemBase",      "can_depend_on": [],                             "intra_layer_deps": "dag" }
    ],
    "module_inner_layers": ["shared", "data", "domain", "presentation"],
    "inner_dependency_direction": "upward",
    "cross_module_exports_file": "Index.ets"
  },
  "paths": {
    "feature_docs_dir": "doc/features",
    "feature_specs_dir": "specs/features",
    "module_catalog": "doc/module-catalog.yaml",
    "glossary": "doc/glossary.yaml",
    "glossary_seed": "doc/glossary-seed.txt",
    "architecture_md": "doc/architecture.md"
  }
}
```

普通 3 层 App 的实例，只需把 `outer_layers` 改短、`module_inner_layers` 改为 `["data","domain","ui"]`；framework 的 phase-rules / check-* 完全不需改代码。

---

## 分阶段实施计划

### 阶段 1 · 物理拆分（纯搬迁，不改语义）

#### 1.1 文件搬迁

- 新建 `framework/` 目录
- `git mv`：
  - `skills/` → `framework/skills/`
  - `specs/phase-rules/` → `framework/specs/phase-rules/`
  - `harness/` → `framework/harness/`（`reports/` / `node_modules/` 保留在内但进 .gitignore）
- **仓库根 `specs/phase-rules/` 直接删除**（不保留指针目录）；`specs/features/` 保留（钱包实例 feature）

#### 1.2 硬编码路径更新（搬迁即失效，必须一并改）

扫描发现以下文件都有 `skills/<n>-*`、`harness/...`、`specs/phase-rules/...` 等**相对硬编码路径**。搬迁后必须同步更新（或在阶段 3 前临时以 string replace 的方式指向 `framework/...`，让钱包全链路仍可跑）：

**A. Agent 入口文件**（钱包示例当前就在用的 slash / bridge 跳板，搬完必须立刻能用）
- [CLAUDE.md](CLAUDE.md) — 全局约束表大量引用 `skills/`、`specs/phase-rules/`、`harness/scripts/` 等路径
- `.claude/commands/*.md`（8 个：`catalog-bootstrap` / `glossary-bootstrap` / `prd-design` / `requirement-design` / `coding` / `code-review` / `business-ut` / `device-testing`）— 每个文件第一行就跳 `skills/<n>/SKILL.md`
- `.claude/agents/verifier.md` — 内部引用 `harness/prompts/verify-<phase>.md`、`specs/phase-rules/<phase>-rules.yaml`、`harness/reports/...`
- `.cursor/skills/*/SKILL.md`（7 个跳板文件，指向 `../../skills/<n>/SKILL.md`）

**B. Framework 内部自引用**（搬到 `framework/` 后，内部对 `harness/` / `specs/` 的相对路径要重新校准）
- `framework/skills/*/SKILL.md`（7 个）— 内部有大量 `harness/scripts/check-*.ts`、`specs/phase-rules/*.yaml`、`doc/module-catalog.yaml` 等路径
- `framework/skills/*/prompts/*.md`、`templates/*.md`、`reference/*.md` — 同上（如 `skills/0-catalog-bootstrap/prompts/infer-glossary-term.md`、`skills/1-prd-design/templates/prd-template.md`、`skills/3-coding/reference/arkts-pitfalls.md` 等命中）
- `framework/harness/harness-runner.ts` — 注释里的示例命令 + 代码里硬编码的 `specs/phase-rules/`、`specs/features/`、`doc/` 等前缀
- `framework/harness/scripts/check-*.ts`（8 个）+ `utils/*.ts` — 硬编码 `specs/phase-rules/<phase>-rules.yaml`、`doc/module-catalog.yaml` 等前缀
- `framework/harness/prompts/verify-*.md`（6 个）— 提示语中的路径引用
- `framework/harness/trace/gap-notes.template.md` — 引用 harness/ 内部相对路径

**C. 仓库根参考文档**（钱包实例的当下描述文件）
- [README.md](README.md)（仓库根）
- [doc/architecture.md](doc/architecture.md) 尾部变更记录里的路径
- [doc/Harness全链路验证说明.md](doc/Harness全链路验证说明.md)

**D. 不动（历史归档性质）**
- `doc/*自检报告*.md`、`doc/自然语言到技术模块-演进路线图.md`、`.cursor/plans/*.md`、`doc/features/home-page/review-report.md` 等——它们是时刻快照，属于阶段 8 的归档范畴，阶段 1 不修改

#### 1.3 更新策略

- **B 部分（framework 内部）**：先用最小改动——把所有 `skills/` → `framework/skills/`、`harness/` → `framework/harness/`、`specs/phase-rules/` → `framework/specs/phase-rules/` 做机械 string replace。阶段 3 的 `config.ts` 落地后再把硬编码完全抽走，这里只求让钱包现在能跑。
- **A 部分（agent 入口）**：逐文件过一遍，把跳板的相对路径改到 `framework/skills/<n>/SKILL.md`（相对于仓库根的新位置），让钱包仓库自己的 Claude Code / Cursor 用户立刻可用。
- **C 部分**：普通文本替换即可。
- `.claude/commands/` 与 `.cursor/skills/` 的重新结构化（以 adapter 形式托管）在阶段 5 完成；阶段 1 只保证它们"改对了路径能跑"。

#### 1.4 验证标准

阶段 1 结束 run 一遍钱包全链路（prd / design / coding / review / ut / testing + catalog / glossary）全部 PASS，并且钱包仓库自身的 `.claude/commands/*` slash 与 `.cursor/skills/*` 跳板能正常跳到 framework/skills/ 新路径，才进入下一阶段。

#### 1.5 回滚

纯 `git mv` + string replace，任何时刻 `git revert` 可复位。

### 阶段 2 · 架构元模型化（把钱包专属架构从 framework 里剥出）

当前 phase-rules / check-*.ts 里直接假设"01-Product / 02-Feature / ..." 五层以及模块内 "shared/data/domain/presentation" 四层。需要把这层硬编码剥到实例侧。

- **盘点硬编码位置**：
  - `framework/specs/phase-rules/coding-rules.yaml`（里面有"模块名 PascalCase（如 WalletMain、CommFunc）"以及层级枚举）
  - `framework/specs/phase-rules/design-rules.yaml` / `review-rules.yaml`（依赖方向检查规则）
  - `framework/specs/phase-rules/catalog-rules.yaml`（layer 值的合法性枚举）
  - `framework/harness/scripts/check-coding.ts` / `check-design.ts` / `check-catalog.ts` 里 layer 枚举、sublayer 依赖判定
  - `framework/skills/*/SKILL.md` 里描述架构的段落
- **改造思路**：
  1. 在 `framework/harness/config.ts` 新增 `loadArchitectureDsl()` 方法，从 `framework.config.json` 读 `architecture` 段
  2. 所有 check-*.ts 需要层级白名单 / 依赖矩阵的地方，全部改为调 `loadArchitectureDsl()` 拿结果，不再写死字符串
  3. phase-rules yaml 里的 `expected_layers`、`dependency_matrix` 之类字段改为"由 config 注入"——保留占位但值从 config 来
  4. 元规则仍由 framework 守（不可配置）：
     - 依赖方向必须自上而下（不允许逆向）
     - 层级图必须是 DAG（禁止环路）
     - 跨模块访问必须通过声明的 `cross_module_exports_file`（默认 `Index.ets`）
     - 模块内层依赖单向
  5. Skill 0 / Skill 1 / Skill 2 的 SKILL.md 里描述架构的段落改为"参照你工程的 framework.config.json 的 architecture 段"，并保留钱包示例作为「如果你选了 wallet-5-4 preset 时看起来是这样」的举例
- **验证标准**：
  - 钱包工程跑完全链路仍 PASS
  - 手工造一份 3-层 3-内层的 dummy config，让 harness 能跑通（只做结构正确，不真写 dummy 工程代码）

### 阶段 3 · Harness 路径参数化（消除硬编码）

- 新建 `framework/harness/config.ts`：

  ```typescript
  export interface FrameworkPaths {
    workspaceRoot: string;
    phaseRulesDir: string;              // framework/specs/phase-rules
    featureSpecsDir: string;            // 实例工程根，默认 "specs/features"
    featureDocsDir: string;             // 默认 "doc/features"
    architectureMd: string;             // 默认 "doc/architecture.md"
    moduleCatalogYaml: string;          // 默认 "doc/module-catalog.yaml"
    glossaryYaml: string;
    glossarySeedTxt: string;
    reportsDir: string;
  }
  export function loadFrameworkConfig(cwd: string): FrameworkConfig { ... }
  export function loadArchitectureDsl(cwd: string): ArchitectureDsl { ... }
  ```

- 读取顺序：`./framework.config.json` → 回退到 framework 内置 defaults
- `harness-runner.ts` + 所有 `check-*.ts` 改为从 config.ts 统一拿路径和架构 DSL
- **注意**：`framework.config.json` 的生成不是这一阶段的责任——这一阶段只实现"读取 + 合理 defaults"；真正的生成能力在阶段 6 的初始化 Skill 里
- **验证标准**：钱包现有 `doc/...` 目录不变的前提下，默认 defaults 能跑通

### 阶段 4 · 去钱包化文案（只改文本，不动逻辑）

- `framework/skills/*/SKILL.md`：
  - "钱包项目架构分析师" → "HarmonyOS 工程架构分析师"
  - 举例段落加"（以钱包工程为例）"标注，不删
  - 总览 / 核心设计原则里的"钱包"字样做通用化
- `framework/skills/*/templates/*` / `examples/*`：保留钱包示例内容，但标题行补一句"本模板以钱包工程为示例演示字段填法"
- `framework/harness/scripts/check-catalog.ts` / `check-coding.ts`：错误提示里钱包字样改通用
- `framework/harness/trace/trace.schema.json`：描述字段里的钱包字样改通用
- **注意**：`.claude/commands/*.md` 仓库根目录里的 slash command 文件暂不动——它们在阶段 5 由 claude adapter 重新组织

### 阶段 5 · Agent Adapter 层（可插拔 agent 支持）

- 新建 `framework/agents/` 目录结构和 `adapter-schema.yaml`：

  ```yaml
  # adapter-schema.yaml — 每个 adapter 必须实现的协议
  adapter_name: string              # "generic" | "claude" | "cursor"
  agent_entry_file:
    template: string                # 例 "AGENTS.md" / "CLAUDE.md"
    # AGENTS.md.template 的变体；若和通用一致可留 null 由初始化 skill 拷贝 generic 模板
  commands:
    dir: string | null              # 例 ".claude/commands/" / null
    per_skill_template: string | null
  rules:
    dir: string | null              # 例 ".cursor/rules/"
    per_rule_template: string | null
  skill_bridge:
    dir: string | null              # 例 ".cursor/skills/" 的 skill 跳板
  post_install_hooks: []            # 可选：adapter 安装后要调用的脚本（初期为空）
  ```

- 第一版实现三个 adapter：
  - `generic`：只产 AGENTS.md，其它什么也不做
  - `claude`：
    - agent_entry_file 为 `CLAUDE.md`（和 `AGENTS.md.template` 同源，只是文件名不同）
    - 为 Skill 0~6 和 `framework-init` 各生成 `.claude/commands/<slash>.md` 路由文件（复用现有 `.claude/commands/` 内容作为起点）
  - `cursor`：
    - agent_entry_file 保持 `AGENTS.md`（Cursor 读 AGENTS.md 就行）
    - 为每个 skill 生成 `.cursor/skills/<skill>/SKILL.md` 跳板（复用当前 `.cursor/skills/` 内容作为起点）
    - （可选）生成 `.cursor/rules/framework.mdc` 规则文件
- **关键设计**：adapter 不承担任何 skill 逻辑——skill 本身是纯 Markdown，adapter 只负责"按该 agent 的约定把 skill 入口暴露出来"
- **验证标准**：
  - 钱包仓库本身切到 `claude` adapter 后，现有 `.claude/commands/` 内容与 adapter 生成的一致
  - 额外手工切一次到 `cursor` adapter，能生成对齐的 `.cursor/skills/` 跳板

### 阶段 6 · Framework 初始化 Skill（核心！）

新建 `framework/skills/00-framework-init/SKILL.md`，AI 驱动完成：

- **触发条件**：
  - Slash：`/framework-init`（在支持 slash 的 agent 里）
  - 自然语言：「在这个工程里初始化 framework / 把 framework 接入本工程」
- **Skill 流程（概要，细节在 SKILL.md 里）**：
  1. **环境探测**（只读）：
     - 检测 `framework/` 是否作为 submodule 存在（没有就提示 `git submodule add`）
     - 检测工程根是否已有 `framework.config.json`（有就进入 UPDATE 模式）
     - 扫描仓库根第一层目录，识别已有的架构层（如有 `01-Product/`、`02-Feature/` 等命名约定的目录就猜测层级；有 `entry/`、`features/`、`shared/` 等也识别常见模式）
     - 扫描 `.git/`、`.claude/`、`.cursor/`、`oh-package.json5` 等特征文件，辅助识别环境
  2. **交互问询**（逐项展示推断结果让用户确认）：
     - 项目名（默认从 `oh-package.json5` 的 `name` 推）
     - 项目类型：`app` / `atomic_service`（第一版仅记录占位）
     - 架构 DSL：
       - 如果扫描识别出明显的 5 层模式 → 提议使用钱包同款 DSL 模板让用户确认
       - 如果识别到其它已知模式 → 提议对应模板
       - 否则：进入"自定义架构问卷"（逐层问 id / can_depend_on / intra_layer_deps / sublayers / module_inner_layers）
     - Agent 偏好：从 `framework/agents/` 下自动列出可选 adapter（generic / claude / cursor），让用户选
  3. **产物生成**（拿到用户确认后一次性写出）：
     - `framework.config.json`（聚合上面所有决策）
     - `AGENTS.md` 或 `CLAUDE.md`（按所选 adapter 的 `agent_entry_file.template` 实例化 + 注入项目名等占位符）
     - `doc/architecture.md`（基于架构 DSL 渲染骨架，含 Mermaid 图、依赖矩阵、层级职责表；**空白的**业务模块清单供 Skill 0 后续填）
     - `doc/module-catalog.yaml` / `doc/glossary.yaml` / `doc/glossary-seed.txt`（空骨架，用现有 Skill 0 的模板）
     - 按 adapter 生成 `.claude/commands/*` 或 `.cursor/skills/*` 等产物
     - `doc/features/`、`specs/features/` 空目录
     - 顶部打印"下一步"指引：先 `/catalog-bootstrap <M>` 为已有模块逐个建档，再 `/glossary-bootstrap` 建术语表，然后才能进入 `/prd-design`
  4. **UPDATE 模式**（已有 framework.config.json 时）：
     - 对比新旧 config 展示 diff（同 Skill 0 Phase A 的 UPDATE 视图），让用户确认是否更新
     - 切换 adapter 时要安全清理旧 adapter 的产物（给出清理建议而非强删，用户确认后再执行）
- **SKILL.md 本身要遵守现有 Skill 风格**：弱模型友好、对话式确认、staging + 确认后才落地
- **产物路径约束**：产物全部写到**目标工程根**，不是 framework 目录下
- **Harness 校验**：初始化完成后自动调 `harness-runner.ts --phase catalog` 和 `--phase glossary`，提示当前空骨架合法，引导用户下一步

### 阶段 7 · 元服务扩展位预留

- `framework/specs/phase-rules/catalog-rules.yaml`：`format` 枚举追加 `AtomicService`（值合法但不触发额外检查）
- `framework/templates/framework.config.template.json`：`project_type` 字段枚举注释 `"app" | "atomic_service"`
- `framework/templates/AGENTS.md.template`：标题行支持依据 `project_type` 切换文案
- `framework/docs/atomic-service-roadmap.md`：占位文档，列未来要做的差异化规则（首包大小校验、分包策略、免安装入口限制等）
- 真正的差异化规则作为后续独立议题

### 阶段 8 · 文档与 Skill 绑定收口

- `framework/README.md`（**静态**，由 framework 维护者写）：
  - framework 是什么、能做什么
  - 如何通过 submodule 引入
  - 如何跑 `/framework-init`（或自然语言触发）
  - 列出 `framework/agents/` 已支持的 adapter
  - 贡献指南
- `framework/MIGRATION.md`：第一版只给到"初始化 Skill 的 UPDATE 模式会处理升级"这种引导；后续版本 bump 时由维护者 append
- `framework/skills/README.md`：所有 skill 的索引，明确声明"`00-framework-init` 是所有其他 skill 的前置——没跑它就别跑别的"
- `framework/skills/0-catalog-bootstrap/SKILL.md` / `1-prd-design/SKILL.md` / … 头部都要加一句：
  > 前置：本工程已完成 `/framework-init`；本 skill 读取 `framework.config.json` 中的架构 DSL。
- 钱包实例侧：
  - `doc/` 下的自检报告等历史产物归档到 `doc/archives/wave-1-2-framework-refactor/`
  - 仓库根 `README.md` 重写：说明本仓库既是钱包示例、也是 framework 宿主
- **所有与初始化 Skill 重复的静态引导段落一律删掉**——避免两份文档飘忽不一致，以 Skill 动态产物为准

---

## 依赖顺序

```mermaid
graph LR
    S1[阶段1 物理拆分] --> S2[阶段2 架构元模型]
    S1 --> S3[阶段3 harness config]
    S2 --> S3
    S3 --> S4[阶段4 去钱包化文案]
    S3 --> S5[阶段5 agent adapter]
    S4 --> S6[阶段6 初始化 Skill]
    S5 --> S6
    S6 --> S7[阶段7 元服务占位]
    S6 --> S8[阶段8 文档收口]
```

- 阶段 1 是唯一的硬前置
- 阶段 2 和阶段 3 有依赖（config.ts 需要承担架构 DSL 加载能力）
- 阶段 4 / 5 并行
- **阶段 6 是整个方案的核心产出**——阶段 2~5 都是为它做基础设施
- 阶段 7 / 8 最后收尾，可并行

## 风险与回滚

- **最大风险**：阶段 2 的架构元模型化改造面广（8 份 phase-rules + 8 份 check-*.ts），若某处漏改会导致钱包回归挂掉
  - **缓解**：阶段 2 每改一份 rules + 对应 check-*.ts 就跑一次钱包对应 phase 的 harness，PASS 再动下一个；**严禁批量改完后统一测**
- **次风险**：阶段 6 初始化 Skill 的交互流程复杂，易落入"问题过多/过少"的两头
  - **缓解**：第一版先做"钱包 preset + 3 层 App preset + 完全自定义"三条路径的固定脚本流；等真实外部工程接入后再迭代
- **回滚粒度**：每阶段独立 commit，任一阶段失败可单独 revert

---

## 一个典型新工程接入 framework 的流程（完成后）

```bash
# 在一个已有 HarmonyOS 工程根
git submodule add https://github.com/<org>/harmonyos-framework.git framework

# 然后在 agent 里（Claude Code / Cursor / …）触发
/framework-init
# 或自然语言："帮我把 framework 接入这个工程"
```

初始化 Skill 会：
1. 扫描工程目录 → 识别架构特征
2. 逐项问用户确认（项目名、类型、架构 DSL、agent 偏好）
3. 生成 `framework.config.json` + `AGENTS.md`/`CLAUDE.md` + `doc/` 骨架 + adapter 产物
4. 提示下一步：`/catalog-bootstrap <M>` 为每个模块建档

然后进入原有全生命周期：catalog → glossary → PRD → design → coding → review → UT → testing。
