---
name: Framework 拆分与演进
overview: |
  将 monorepo 中的 framework/ 拆为独立 GitHub 仓库 sqsqsq/agent-maison（品牌名 AgentMaison），
  保留全部分支与 commit 历史；发布件与实例 submodule 目录名保留 framework/（兼容性优先）；
  OpenSpec 和 Install CLI 留待后续。
todos:
  - id: create-github-repo
    content: 在 GitHub 创建空仓库 sqsqsq/agent-maison（不初始化 README/LICENSE）
    status: in_progress
  - id: filter-repo-split
    content: mirror 克隆 + git filter-repo 抽出 framework/ 历史（含 main、Br_release_1.0、Br_release_2.0 共 3 分支），推到新仓
    status: pending
  - id: new-repo-bootstrap
    content: 新仓补 .gitignore + AGENTS.md + .npmignore + 开发工具目录骨架 + 根 package.json；LICENSE 后续单独处理
    status: pending
  - id: app-submodule
    content: App 仓清理 ignored 残留 → git rm → submodule add 到本地路径 framework/
    status: pending
  - id: harness-verify
    content: 验收：npm test + harness-runner（--adapter claude）+ 干净 clone --recurse-submodules 验证
    status: pending
isProject: true
---

# AgentMaison 独立仓库拆分

## 决策记录


| 项目                        | 决定                                                     |
| ------------------------- | ------------------------------------------------------ |
| 品牌名                       | **AgentMaison**                                        |
| GitHub slug               | `sqsqsq/agent-maison`                                  |
| 本地 submodule 目录           | `**framework/`**（保留原名，兼容性优先）                           |
| 发布件名称                     | **framework**（对消费者透明）                                  |
| 实例扩展                      | 保留在 App 仓                                              |
| OpenSpec                  | 后续再议                                                   |
| Install CLI / Marketplace | 先用 submodule，后续再改                                      |
| 需带走的分支                    | main、Br_release_1.0、Br_release_2.0（共 3 条）              |
| 迁移前快照                     | main tip `fae8dd1`，1.0 tip `72616c6`，2.0 tip `fae8dd1` |
| framework commits         | 以 Step 0 实测为准                                          |
| active adapter            | **claude**（验收用 claude，不是 cursor）                       |
| 本次迁移范围                    | **仅 main 分支**；release 分支的 submodule 迁移视需求后续补           |


---

## 执行步骤

### Step 0: 迁移前验收快照（执行前先跑一遍确认基线）

```bash
cd d:\1.code\SimulatedWalletForHmos

# 确认远端同步
git fetch --all
git status  # 除 .cursor/plans/ 等 plan 文件外应为 clean

# 记录分支 tip
git rev-parse --short origin/main
git rev-parse --short origin/Br_release_1.0
git rev-parse --short origin/Br_release_2.0

# 记录 framework commit 数（三分支全覆盖，用 origin/* 保证口径一致）
git rev-list --count origin/main -- framework/
git rev-list --count origin/Br_release_1.0 -- framework/
git rev-list --count origin/Br_release_2.0 -- framework/

# 跑一次 harness 基线（确认当前就能 PASS）
cd framework/harness && npm test
npx ts-node harness-runner.ts --phase init --adapter claude
npx ts-node harness-runner.ts --phase catalog
npx ts-node harness-runner.ts --phase glossary
```

如果基线不 PASS，先修再拆。

### Step 1: GitHub 建空仓

在 GitHub 创建 `sqsqsq/agent-maison`：

- **不** 初始化 README / .gitignore / LICENSE（filter-repo 会带过来已有文件；缺失的在 Step 3 补）
- Description: `AgentMaison — spec-driven agentic workflow framework with harness gates`
- Visibility: 按需（private 或 public）

### Step 2: Mirror + filter-repo 抽出历史

```bash
cd D:\1.code
mkdir _temp-am-split
cd _temp-am-split

# 1. Mirror 克隆
git clone --mirror git@github.com:sqsqsq/SimulatedWalletForHmos.git am-mirror
cd am-mirror

# 2. filter-repo
git filter-repo --path framework/ --path-rename "framework/:"

# 3. 验证
git branch                                    # 应有 main, Br_release_1.0, Br_release_2.0
git log --oneline main | Select-Object -First 10
git log --oneline Br_release_1.0 | Select-Object -First 5
git log --oneline Br_release_2.0 | Select-Object -First 5
git rev-parse --short main                    # 新 SHA（重写后不同于原仓）

# 4. 推到新仓
git remote add origin git@github.com:sqsqsq/agent-maison.git
git push --force --all origin
git push --force --tags origin
```

**预期结果**：

- `main`：framework 相关 commit，路径已提升为根（`skills/`、`harness/` 等在根目录）
- `Br_release_1.0`：framework 早期快照
- `Br_release_2.0`：与 main 一致（同 tip）
- 纯 App commit 自动消失
- 具体 commit 数以 Step 0 记录为准

### Step 3: 新仓 Bootstrap（.gitignore + AGENTS.md + .npmignore + 打包边界）

filter-repo 后新仓**缺少**以下文件（原仓的根 `.gitignore` 不会被带过来，因为它不在 `framework/` 路径下）：

**3.1 新建 `.gitignore`**（防止误提交 node_modules / state / reports）：

```gitignore
# Dependencies
**/node_modules/

# Lock files (consumers pin via submodule SHA)
harness/package-lock.json

# Runtime artifacts
harness/state/*
!harness/state/.gitkeep
harness/reports/*
!harness/reports/.gitkeep
harness/dist/

# Trace runtime output (但保留 schema/template）
harness/trace/*
!harness/trace/trace.schema.json
!harness/trace/gap-notes.template.md

# Hylyre / Hypium runtime
**/.hylyre/
**/tmp_hypium/

# IDE dev tools (开发 maison 时产生的本地产物)
.cursor/mcp.json
```

**3.2 LICENSE**：

本次暂不创建 LICENSE；仓库转为 public 前必须补齐。记入后续事项。

**3.3 AGENTS.md（maison 自身开发指令）**：

独立编写，包含：

- 仓库定位与目录分层（发布内容 vs 开发工具）
- 打包边界规则（BLOCKER）
- 开发验收要求（`npm test` 必须 PASS）
- 不复用 Skill 0–6 流程管自己

**3.4 .npmignore**（为未来 CLI 发布预留）：

```npmignore
# 开发工具 — 不进发布件
.cursor/
.claude/
.codex/
openspec/

# 测试
harness/tests/
harness/reports/
```

> 注：`docs/` 属于发布内容（消费者需要阅读框架文档），不排除。
> `.npmignore` 仅在未来 `npm publish` 时才生效；submodule 模式下所有文件均对消费者可见。

**3.5 发布内容 vs 开发工具分层**：


| 类别   | 目录                                                                                    | 是否进发布件 |
| ---- | ------------------------------------------------------------------------------------- | ------ |
| 发布内容 | `skills/` `specs/` `harness/` `profiles/` `agents/` `workflows/` `templates/` `docs/` | Yes    |
| 开发工具 | `.cursor/` `.claude/` `.codex/` `openspec/`                                           | No     |
| 打包配置 | `package.json` `.npmignore` `.gitignore` `AGENTS.md` `README.md`            | 视情况    |


**3.6 在新仓工作副本中 commit + push**：

Step 2 的 mirror push 创建了新仓的初始历史。Step 3 新增的文件需要在新仓的**普通工作副本**中操作：

```bash
# clone 新仓（非 mirror，正常工作副本）
cd D:\1.code
git clone git@github.com:sqsqsq/agent-maison.git agent-maison-dev
cd agent-maison-dev

# 创建上述文件（.gitignore / .npmignore / AGENTS.md / 根 package.json）
# ... 按 3.1-3.5 的内容写入 ...

# commit + push
git add .gitignore .npmignore AGENTS.md package.json
git commit -m "chore: bootstrap AgentMaison repository (.gitignore, AGENTS.md, packaging)"
git push origin main
```

> 注：根 `package.json` 应从现有 `harness/package.json` 的依赖中提炼，或直接作为 workspace root
> 引用 `harness/`（具体结构执行时再定）。此步完成后，App 仓 Step 4 的 submodule add 才能拉到完整的新仓内容。

### Step 4: App 仓移除 vendor，改为 submodule

**关键：先清理 ignored 残留文件**。`git rm -r framework` 只删 tracked 文件，ignored 产物（node_modules、state、reports、package-lock.json、.hylyre）会残留在磁盘上，导致 `git submodule add` 失败（目录非空）。

```bash
cd d:\1.code\SimulatedWalletForHmos

# 1. 先 git rm tracked 文件
git rm -r framework
git commit -m "chore: remove vendored framework before submodule migration"

# 2. 物理清除残留的 ignored 文件（git rm 不会删它们）
# 检查残留
dir framework\  # 应该还看到 harness\node_modules\ 等
# 强制删除整个目录（加判断防目录不存在时报错）
if (Test-Path framework) { Remove-Item -Recurse -Force framework }

# 3. 确认目录已完全清空
Test-Path framework  # 应为 False

# 4. 添加 submodule
git submodule add git@github.com:sqsqsq/agent-maison.git framework
git commit -m "chore: add AgentMaison as git submodule (framework/)"

# 5. 验证
git submodule status
cat .gitmodules
# 应显示：[submodule "framework"] path = framework, url = ...agent-maison.git

# 6. 推到远端（Step 5.2 干净 clone 验收依赖此步）
git push origin main
```

**本次只迁 main 分支**。App 仓的 `Br_release_1.0` / `Br_release_2.0` 若需也改成 submodule，
后续逐分支执行：`git checkout Br_release_X` → 同样 `git rm` + 清残留 + `submodule add` + pin 到
AgentMaison 仓对应分支 tip。本轮不做，避免一次性改动过大。

### Step 5: 验收（全方位）

**5.1 基础验收（App 仓 submodule 模式）**：

```bash
cd d:\1.code\SimulatedWalletForHmos\framework\harness
npm install
npm test                                              # 单元测试全 PASS
npx ts-node harness-runner.ts --phase init --adapter claude   # 注意是 claude 不是 cursor
npx ts-node harness-runner.ts --phase catalog
npx ts-node harness-runner.ts --phase glossary
npx ts-node harness-runner.ts --phase docs
```

**5.2 干净 clone 验收（模拟新协作者）**：

```bash
cd D:\1.code\_temp-verify
git clone --recurse-submodules git@github.com:sqsqsq/SimulatedWalletForHmos.git wallet-clean
cd wallet-clean\framework\harness
npm install
npm test
npx ts-node harness-runner.ts --phase catalog
```

确认从零 clone 也能工作。

**5.3 独立仓开发验收（可选，后续增强）**：

当前 `harness-runner.ts` 第 195 行通过 `path.resolve(__dirname, '..', '..')` 推算 projectRoot。
在独立仓根直接跑 harness 时会找不到 `framework.config.json`（因为独立仓没有实例配置）。

**这是已知限制，本次不修**。AgentMaison 独立仓的开发验收走 `npm test`（单元测试不依赖 projectRoot），
不走 `harness-runner`（它本就设计为在实例工程内执行）。
未来如需独立仓内跑集成测试，可增加 `--project-root` 参数或 fixture consumer 工程。

---

## 迁移后目录结构

```
SimulatedWalletForHmos/                ← 消费者工程（App 仓）
├── framework/                         ← git submodule → sqsqsq/agent-maison
│   ├── skills/                        ┐
│   ├── specs/                         │
│   ├── harness/                       │ 发布内容
│   ├── profiles/                      │（消费者实际使用的部分）
│   ├── agents/                        │
│   ├── workflows/                     │
│   ├── templates/                     │
│   ├── docs/                          ┘
│   ├── .cursor/                       ┐
│   ├── .claude/                       │ 开发工具（开发 maison 自身用）
│   ├── openspec/                      │ 消费者无需关心
│   ├── .codex/                        ┘
│   ├── .gitignore                     ← 新仓自己的 ignore
│   ├── .npmignore                     ← 排除开发目录
│   ├── AGENTS.md                      ← maison 自身开发指令
│   ├── package.json                   ← harness 依赖 + 未来打包脚本
│   └── README.md
├── .cursor/
│   ├── skills/                        ← 跳板（init 下发，指向 framework/skills/）
│   └── rules/
│       └── framework.mdc             ← 总规则（不改名）
├── .codex/                            ← Codex 实例产物（留在 App 仓）
├── framework.config.json              ← 实例配置（路径不变）
├── AGENTS.md                          ← App 仓的 agent 入口（由 framework-init 生成）
├── doc/
│   ├── features/
│   ├── extensions/                    ← 实例扩展（留在 App 仓）
│   └── ...
└── entry/
```

**核心优势**：submodule 远端是 `agent-maison`，但本地路径是 `framework/`——
所有现有引用（config、AGENTS.md、skills 跳板、rules）**零改动**即可工作。
品牌归属通过 `.gitmodules` 里的 URL 体现，日常开发无感知。

**关键区分**：

- `framework/agents/cursor/templates/` = 给消费者工程生成跳板/rules 的**模板源**
- `framework/.cursor/`（submodule 内）= 开发 maison 自身时 Cursor 加载的 rules/skills
- 消费者工程的 `.cursor/skills/` = 由 `framework-init` 从 agents/ 模板生成的产物
- `framework/AGENTS.md`（submodule 内）= maison 开发者看的规则
- 实例根 `AGENTS.md` = 消费者工程 AI agent 看的规则

---

## 品牌生态定位

```
AgentMaison                    ← 总产品品牌（框架 + 门禁 + 工作流）
├── Hylyre                     ← 真机自动化子工具（已有，profiles/hmos-app/vendor/）
├── Harness                    ← 门禁系统（内部组件名）
└── Profiles                   ← 宿主平台适配层
```

---

## 后续事项（本次不做，记录备忘）

1. **OpenSpec 引入**：在 agent-maison 仓内 `openspec init`，用 OPSX 管理框架自身变更
2. **Install CLI**：`npx agent-maison install --adapter cursor --profile hmos-app`
3. **Cursor Marketplace**：上架为插件，实现一键安装
4. **App 仓瘦身**（可选）：`git filter-repo --invert-paths --path framework/` 清除 App 历史中的 framework 痕迹
5. **独立仓集成测试**：harness-runner 增加 `--project-root` 参数或 fixture consumer 工程
6. **Codex adapter 正式化**：将 `.codex/` 原型纳入 `framework/agents/codex/`
7. **LICENSE**：仓库转 public 前选定并补齐 license 文件

---

## 风险与注意


| 风险                              | 缓解                                                      |
| ------------------------------- | ------------------------------------------------------- |
| filter-repo 后 commit SHA 全变     | 新仓独立，不影响 App 仓现有 SHA                                    |
| Step 4 submodule add 失败（目录残留）   | 先 `Remove-Item -Recurse -Force framework` 清除 ignored 产物 |
| 验收 adapter 用错（cursor vs claude） | 当前 config 是 `claude`，验收必须用 `--adapter claude`           |
| Br_release_1.0 维护               | release 分支 submodule pin 到 agent-maison 仓同名分支 tip       |
| 协作者需 re-clone                   | submodule 需 `git clone --recurse-submodules`，文档里注明      |
| harness 内部相对路径                  | filter-repo 提升后 `specs/`、`skills/` 已在根，内部 `../` 不变      |
| 新仓缺 .gitignore                  | Step 3 首批补齐，防止误提交 node_modules/state/reports            |
| 独立仓不能直接跑 harness-runner         | 已知限制，npm test 覆盖；集成测试留后续                                |


