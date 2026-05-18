# Harness 运行时前置（Tier_1）与宿主工具链指针（Tier_2）

本文是 **Skill 0～6** 及任意全局 harness phase 在调用 `harness-runner.ts` 之前的 **单一事实源（SSOT）**。

- **Tier_1**：与 `project_profile` 无关——只要跑 framework harness，就必须满足。
- **Tier_2**：与具体宿主（IDE / 编译 / 设备）有关——**不在本文展开**，只指向 profile addendum 与各阶段 Skill。

与 [`00-framework-init`](../00-framework-init/SKILL.md) **Step 5.5** 中 Tier_1 部分 **等价**；init 流程仍须在 Step 5.5 **执行** `npm install` 与 `npm test` 自检，本文是日常克隆与独立拉起某 Skill 时的交叉引用锚点。

---

## Tier_1：Framework harness 自身 npm（BLOCKER）

### 为何需要

`framework/harness/harness-runner.ts` 依赖 `ts-node`、`yaml` 等 npm 包。`framework/harness/node_modules/` 与 `package-lock.json` 通常被仓库 `.gitignore` 排除（registry 与 lock 分发策略见 [`framework/README.md`](../../README.md)），**新克隆或新机器上往往不存在 `node_modules`**。若未安装直接运行会出现 `Cannot find module 'ts-node'`、`Cannot find module 'yaml'` 等错误。

### 幂等检测（须用真实文件系统）

**禁止**仅用默认跳过 `.gitignore` 的 IDE 列举判断是否已安装。

权威探测（与 [`framework/harness/scripts/check-init.ts`](../../harness/scripts/check-init.ts) 第 9 项一致）：

- 若 `<repo-root>/framework/harness/node_modules/ts-node/package.json` **存在** → Tier_1 已满足（除非后续报错表明损坏，见故障分流）。
- 若 **不存在** → 必须在 `<repo-root>/framework/harness/` 执行一次 `npm install`。

### 安装命令

```bash
cd framework/harness && npm install
```

- 运行目录**必须**是 `framework/harness/`；勿将 harness 依赖装到仓库根或 `framework/` 根。
- **不要**擅自追加 `--registry` 或写入 `.npmrc` 绕过企业策略；尊重用户/CI 已有 npm 配置。

### `npm install` 失败时（三点排查）

细节与话术见 **Skill 00 · Step 5.5.3**。摘要：

1. `npm config get registry` 在当前网络是否可达。
2. 代理环境变量 `HTTP_PROXY` / `HTTPS_PROXY` 是否正确。
3. `node --version` 建议 **≥ 18**（与 Skill 00 / harness 维护约定一致）；`npm --version` 与 Node 匹配。

### 故障分流：`Cannot find module` 仍出现时

1. **先**确认 Tier_1：`node_modules/ts-node/package.json` 存在且已在 `framework/harness` 执行过 `npm install`。
2. 若模块名指向 **宿主工程**（非 `framework/harness` 树内依赖）→ 属于 **Tier_2 / profile / 宿主包管理器** 范畴，按当前阶段的 [`profile-addendum`](../../profiles/README.md) 与各 Skill（如 Skill 3 / 5）中的 **宿主依赖缺失** 分支处理，不要与 Tier_1 混为一谈。

---

## Tier_2：宿主工具链与工程依赖（指针）

以下内容 **因 `project_profile` 而异**，本文仅列出入口：

- **初始化期工具链路径**（如 IDE 安装路径）：[`00-framework-init`](../00-framework-init/SKILL.md) Step 5.6 与 `framework/profiles/<project_profile.name>/skills/00-framework-init/profile-addendum.md`。
- **编码 / UT / 真机**：对应 Skill 的 `profile-addendum.md`（Skill 3、5、6 等）及 `framework/profiles/<profile>/harness/` 下脚本。

---

## Runner 行为（`harness-runner.ts`）

在进入阶段逻辑之前，runner 会探测 **`framework/harness/node_modules/ts-node/package.json`**：

- **缺失且未设置** `HARNESS_AUTO_NPM_INSTALL=1`：stderr 打印简短指引（含本文路径）并以退出码 **1** 结束。
- **缺失且设置** `HARNESS_AUTO_NPM_INSTALL=1`：在 `framework/harness/` **自动执行** `npm install`（自担 registry / 网络 / 企业策略风险）；成功后继续；仍缺失或非零退出则失败退出。

若 Node 在解析入口文件时报 **`Cannot find module`**（例如缺 `yaml`），发生在上述探测之前——仍需先在 `framework/harness` 执行 **`npm install`**。

---

## 相关入口

- Harness 命令范式：[`framework/README.md`](../../README.md) · Harness 常用命令  
- Runbook：[`framework/docs/operations/harness-runbook.md`](../../docs/operations/harness-runbook.md)
