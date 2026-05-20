# Harness CLI 工作目录契约（Shell cwd）

本文是 **在 shell 中调用** `framework/harness/scripts/` 下脚本时的 **单一事实源（SSOT）**。与 [host-harness-readiness.md](./host-harness-readiness.md)（Tier_1 npm）并列：Tier_1 管 **依赖是否安装**；本文管 **命令相对哪条 cwd 解析**。

---

## 1. 两类命令

| 类型 | 典型写法 | 要求 shell cwd |
|------|----------|----------------|
| **A — 根相对脚本入口** | `node framework/harness/scripts/<name>.mjs` | **实例工程根**（`<repo-root>`，含 `framework.config.json` 的目录） |
| **A′ — 根相对 ts-node** | `npx ts-node framework/harness/scripts/<name>.ts` | **实例工程根** |
| **B — harness 内聚入口** | `cd framework/harness && npx ts-node harness-runner.ts …` | 命令自带 `cd`，已安全 |
| **B′ — harness npm 脚本** | `cd framework/harness && npm run …` / `npm test` | 命令自带 `cd`，已安全 |

**脚本加载成功后**：多数 `.ts` 主体用 `__dirname` 推算 `<repo-root>`，与 cwd 无关。事故几乎都发生在 **Node 找不到入口文件**（在错误 cwd 下拼接了 `framework/harness/framework/harness/...`）。

---

## 2. BLOCKER — cwd 泄漏（高危序列）

若上一条命令是 **类型 B**（例如 Step 0.3.0）：

```bash
cd framework/harness && npx ts-node harness-runner.ts --phase init --adapter <adapter>
```

则 **同一 shell** 的 cwd 仍为 `framework/harness/`。此时 **禁止** 直接执行：

```bash
node framework/harness/scripts/render-agents-md.mjs ...
npx ts-node framework/harness/scripts/check-receipt.ts ...
```

否则会解析为 `framework/harness/framework/harness/scripts/...` → `MODULE_NOT_FOUND`。

### 合法接续（二选一）

**从实例根（类型 A，与文档历史写法一致）：**

```bash
cd <repo-root>
node framework/harness/scripts/render-agents-md.mjs ...
```

**留在 harness 目录（短路径，推荐与 harness-runner 同 shell 接续）：**

```bash
cd framework/harness
node scripts/render-agents-md.mjs ...
npx ts-node scripts/check-receipt.ts --feature <feature> --phase <phase>
```

> `<repo-root>`：含 `framework/` 子目录与（init 后）`framework.config.json` 的实例工程根。PowerShell 可用仓库绝对路径；bash 可用 `cd "$(git rev-parse --show-toplevel)"`。

---

## 3. 常见类型 A 脚本

| 脚本 | 典型 Skill 步骤 |
|------|-----------------|
| `render-agents-md.mjs` | Skill 00 §4.1.1 |
| `merge-framework-config.mjs` | Skill 00 §5.1 / MIGRATION |
| `show-last-committed-framework-config.mjs` | Skill 00 Step 1（Git 快照） |
| `check-receipt.ts` | Skill 1～6 阶段闭环 |
| `detect-deveco.ts`（shim） | Skill 00 Step 5.6 / hmos profile-addendum |

**不经 shell 拼路径、无 cwd 问题**：`harness-runner.ts` 进程内调用各 `check-*.ts`；`hook-runner.mjs`（参数为绝对路径）。

---

## 4. 相关入口

- Tier_1 npm：[host-harness-readiness.md](./host-harness-readiness.md)
- Init 全流程：[../00-framework-init/SKILL.md](../00-framework-init/SKILL.md)
- Harness runbook：[../../docs/operations/harness-runbook.md](../../docs/operations/harness-runbook.md)
