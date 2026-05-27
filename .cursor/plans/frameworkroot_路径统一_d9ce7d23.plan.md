---
name: frameworkRoot 路径统一
overview: 在已有 `repo-layout.ts` 基础上，将 `frameworkRoot` / `frameworkRel` / `harnessRoot` 提升为运行时一等公民，贯通 CheckContext 与 config 路径解析，区分物理/逻辑路径，补齐真实 phase 烟测（含 release staging consumer fixture）与依赖隔离断言，消除 standalone 与 consumer 双布局下的路径漂移。
todos:
  - id: config-infer-default
    content: config.ts：resolvePaths / featurePhaseReportsDir 缺省 inferRepoLayout；仅 init CREATE 走 allowMissingFramework 专用 helper，通用路径不静默 fallback
    status: completed
  - id: physical-logical-paths
    content: repo-layout 新增 frameworkPhysicalRelPath / frameworkLogicalRelPath；inventory、提示、check-init 展示路径用 logical
    status: completed
  - id: check-context-layout
    content: 扩展 CheckContext 并在 harness-runner 注入 frameworkRoot/frameworkRel/harnessRoot
    status: completed
  - id: migrate-check-scripts
    content: 迁移 check-docs、confirmation-ux、profile-skill-assets、check-init 展示路径、hvigor-runner、adhoc-canonical-paths
    status: completed
  - id: fixture-external-framework
    content: fixture-runner 及类似测试保留外部 frameworkRoot 时必须显式传参；审计所有 resolvePaths(projectRoot) 单参调用
    status: completed
  - id: repo-layout-tests
    content: 新增 repo-layout.unit.test.ts + 报告路径回归 + physical/logical 路径断言
    status: completed
  - id: runner-smoke-tests
    content: standalone --phase docs（含误路径负断言）+ consumer 从 release:pack staging 拷贝到 tmpdir 跑 --phase docs（npm install 仅 tmp/framework/harness，finally 清理）
    status: completed
  - id: pack-stage-only
    content: （可选）pack-release.mjs 新增 --stage-only，烟测/CI 无需打 zip 即可产出 dist/release-staging/framework
    status: completed
  - id: path-guard-test
    content: guard 扫描 harness/** + profiles/*/harness/**；path.join/resolve 单双引号均覆盖
    status: completed
  - id: dependency-acceptance
    content: consumer 断言 host/node_modules 不存在；harness deps 仅在 frameworkRoot/harness/node_modules；文档写清 install 命令契约
    status: completed
  - id: cleanup-docs
    content: 清理误生成 framework/harness/reports/；AGENTS.md + release-checklist 依赖策略与 install 契约
    status: completed
isProject: false
---

# frameworkRoot 工作目录统一优化

## 问题诊断

当前代码**已部分落地**图中所述方案：

- [`harness/repo-layout.ts`](harness/repo-layout.ts) 已定义 `RepoLayout`（`projectRoot` / `frameworkRoot` / `frameworkRel` / `kind`）及 `detectRepoLayout`、`inferRepoLayout`、`frameworkAbs`、`frameworkRelPath`
- [`harness/harness-runner.ts`](harness/harness-runner.ts) 入口已调用 `detectRepoLayout(harnessRoot)` 并将 `frameworkRoot` 传给 `resolvePaths` 与 `resolveWorkflowSpec`

但仍有**路径漂移风险**；standalone 下 `--phase docs` 已可写到 `harness/reports/_global/docs/`，工作区仍残留旧误生成 `framework/harness/reports/...`，需清理 + 防回退。

**路径语义（SSOT）**：

| 根 | standalone（AgentMaison 开发） | consumer（宿主工程） |
|---|---|---|
| `projectRoot` | 仓根 | 宿主工程根 |
| `frameworkRoot` | = `projectRoot` | = `projectRoot/framework` |
| `harnessRoot` | `projectRoot/harness` | `projectRoot/framework/harness` |
| `frameworkRel` | `''` | `'framework'` |

相对 `frameworkRoot`：skills、profiles、harness、workflows、specs、reports  
相对 `projectRoot`：doc/、业务源码、framework.config.json

### 物理路径 vs 逻辑路径

| 概念 | 函数（拟新增） | standalone 示例 | consumer 示例 | 用途 |
|---|---|---|---|---|
| **物理路径** | `frameworkPhysicalRelPath(layout, ...)` | `docs/DOC_INVENTORY.yaml` | `framework/docs/DOC_INVENTORY.yaml` | git、`path.join(projectRoot, rel)`、报告落盘 |
| **逻辑路径** | `frameworkLogicalRelPath(...)` | 恒为 `framework/docs/...` | `framework/docs/...` | inventory、用户提示、affected_files、Skill 文案 |

规则：读写磁盘用 physical；面向用户/发布语义用 logical（恒带 `framework/` 前缀）。

---

## 优化方案（分 5 步）

### Step 1 — 强化 repo-layout SSOT

**1.1 完善 [`detectRepoLayout`](harness/repo-layout.ts)**

- 保留 grandparent 启发式；补充 JSDoc
- 新增 `harnessRootFromLayout(layout)`
- 新增 `frameworkPhysicalRelPath` / `frameworkLogicalRelPath`

**1.2 [`config.ts`](harness/config.ts) 缺省值走 layout 推断（fallback 收窄）**

通用函数：

```typescript
frameworkRoot ?? inferRepoLayout(projectRoot).frameworkRoot
```

**禁止**通用路径静默 fallback 到 `path.join(projectRoot, 'framework')`。

init CREATE 单独提供 `resolvePathsForInit(projectRoot, { allowMissingFramework?: true })`，仅 init / check-init 早期调用。

`ResolvedPaths` 增加 `frameworkRel: string`。

---

### Step 2 — CheckContext 贯通 layout 字段

**2.1 扩展 [`CheckContext`](harness/scripts/utils/types.ts)**：`frameworkRoot`、`frameworkRel`、`harnessRoot`、`layoutKind?`

**2.2 [`harness-runner.ts`](harness/harness-runner.ts)**：注入 layout；报告/trace 路径统一传 `frameworkRoot`。

**2.3 迁移清单**

| 文件 | 改法 |
|---|---|
| [`check-docs.ts`](harness/scripts/check-docs.ts) | ctx + physical/logical 分流 |
| [`check-skills-confirmation-ux.ts`](harness/scripts/check-skills-confirmation-ux.ts) | 从 ctx/layout 取路径 |
| [`profile-skill-assets.ts`](harness/scripts/utils/profile-skill-assets.ts) | 可选 `layout?: RepoLayout` |
| [`check-init.ts`](harness/scripts/check-init.ts) | 展示用 logical；物理检测仍 `__dirname` 反推 |
| [`hvigor-runner.ts`](profiles/hmos-app/harness/hvigor-runner.ts) L294 | layout-aware |
| [`adhoc-canonical-paths.ts`](harness/scripts/utils/adhoc-canonical-paths.ts) L45 | `frameworkAbs(layout, 'harness')` |
| [`adhoc-derive-helpers.ts`](harness/scripts/utils/adhoc-derive-helpers.ts) L131 | layout-aware forbidden 前缀 |

---

### Step 3 — 测试与烟测

**3.1 [`repo-layout.unit.test.ts`](harness/tests/unit/repo-layout.unit.test.ts)**

- standalone / consumer 树 + grandparent 启发式
- physical vs logical rel path
- standalone 下 `featurePhaseReportsDir` → `harness/reports/...`

**3.2 [`runner-layout-smoke.unit.test.ts`](harness/tests/unit/runner-layout-smoke.unit.test.ts)**

[`harness-runner.ts`](harness/harness-runner.ts) `--list` 在 workflow 解析前 exit，**不能替代** phase 烟测。

#### 3.2.1 standalone 烟测

- cwd = 当前 checkout `harness/`
- 跑前：若存在则删除 `../framework/harness/reports/`（清理旧误产物，避免干扰负断言）
- `npx ts-node harness-runner.ts --phase docs`
- **正断言**：exit 0；`../harness/reports/_global/docs/script-report.json` 等存在
- **负断言（第二轮审查采纳）**：跑完后 `../framework/harness/reports/` **不存在**——即使 `.gitignore` 忽略误路径，也不能把回归藏起来

#### 3.2.2 consumer 烟测 — fixture 必须完整（第二轮审查采纳）

`--phase docs` 会触及：`docs/DOC_INVENTORY.yaml`、profile skill assets、confirmation UX registry、agents templates 等。**禁止**只建 `{harness,skills,workflows,specs}` 骨架，否则易假绿/假红。

**推荐 SSOT fixture 来源**（二选一，优先 A）：

**A. release staging 树（首选）**

[`pack-release.mjs`](scripts/pack-release.mjs) 在 `--dry-run` 时 L107 提前 return，**不会**写出 `dist/release-staging/framework/`。staging 来源二选一：

```bash
# 方案 A1：完整 pack（会写 staging + zip）
npm run release:pack

# 方案 A2（实施时可加）：pack-release 新增 --stage-only，只 writeStaging 不打 zip，供 CI/烟测复用
npm run release:pack -- --stage-only
```

烟测步骤：

1. 确保 `dist/release-staging/framework/` 存在（跑 **非 dry-run** 的 `release:pack`，或 `--stage-only`；**勿用** `--dry-run`）
2. **拷贝** staging 到隔离 tmpdir：`<tmpdir>/framework/`（不要直接在 `dist/release-staging` 下跑 harness，避免污染发版产物）
3. 在 `<tmpdir>/` 写入最小 `framework.config.json`（或拷贝模板）
4. cwd = `<tmpdir>/framework/harness`；**仅在此目录** `npm install`
5. `npx ts-node harness-runner.ts --phase docs`
6. 断言：exit 0；报告在 `<tmpdir>/framework/harness/reports/_global/docs/`；`<tmpdir>/node_modules` 不存在
7. **finally 清理 `<tmpdir>`**（含 `framework/harness/node_modules`），不得污染仓库根或 `dist/release-staging`

**B. 最小完整拷贝（无 release 时的 fallback）**

从当前 checkout 拷贝至 `<host>/framework/`，**必须包含**：

`docs/`、`profiles/`、`agents/`、`skills/`、`specs/`、`workflows/`、`harness/`、`templates/`（若 docs/init 引用）、根 `package.json`（sanitize 后形态）

#### 3.2.3 外部 frameworkRoot / fixture-runner 契约（第二轮审查采纳）

[`fixture-runner.ts`](harness/tests/utils/fixture-runner.ts) 当前模式：`tmpdir` = projectRoot，**显式**传 `FIXTURE_FRAMEWORK_ROOT` 给 `resolveWorkflowSpec` / `resolvePaths`（L200–210）。config 改为 infer 失败即抛错后，此模式**必须保留且不可退化**。

**实施要求**（不只注释）：

| 场景 | 要求 |
|---|---|
| tmp projectRoot **无** `framework/` 子树 | 调用 `resolvePaths` / `featurePhaseReportsDir` / `resolveWorkflowSpec` 时**必须显式传 `frameworkRoot`** |
| 希望走 infer 默认 | 在 tmp projectRoot 下建立 `framework/` symlink 或 copy 完整 framework 树 |
| fixture-runner | 继续 `resolvePaths(tmpdir, FIXTURE_FRAMEWORK_ROOT)`；扩展 CheckContext 时同步注入 layout 字段 |
| 实施时审计 | grep 所有 `resolvePaths(projectRoot)` / `featurePhaseReportsDir(projectRoot,` 单参调用，逐一确认 infer 在 tmp 根可成功或已显式传参 |

可选 `--list` 作快速 sanity，不替代 phase 烟测。

---

### Step 4 — 约束、依赖隔离与文档

**4.1 Guard 扫描**

范围：`harness/**/*.ts`、`profiles/*/harness/**/*.ts`

排除：`repo-layout.ts`、`config.ts`、`**/*.unit.test.ts`、`**/tests/**`、纯文案模板常量

禁止模式（**单引号 + 双引号均匹配**，第二轮小建议）：

```typescript
path.join(projectRoot, 'framework', ...)
path.join(projectRoot, "framework", ...)
path.join(ctx.projectRoot, 'framework', ...)
path.resolve(projectRoot, 'framework', ...)
path.resolve(projectRoot, "framework", ...)
```

**4.2 依赖策略：验收 + 命令契约**

| 断言 | 方式 |
|---|---|
| consumer 无 `<host>/node_modules` | consumer 烟测后 `fs.existsSync` |
| harness runtime deps 只在 `<frameworkRoot>/harness/node_modules` | layout + `ts-node` marker |
| release deps 不进 zip `package.json` | 扩展 [`verify-release-pack.mjs`](scripts/verify-release-pack.mjs) |

**命令契约**（写入 [`AGENTS.md`](AGENTS.md) / [`release-checklist.md`](docs/operations/release-checklist.md)）：

| 布局 | 正确 | 禁止 |
|---|---|---|
| **standalone**（AgentMaison 开发） | 仓根 `npm run harness:install` 或 `cd harness && npm install` | 在错误层级装依赖 |
| **consumer**（宿主工程） | `cd framework/harness && npm install` | **禁止**在宿主 `<projectRoot>` 根 `npm install` 试图安装 framework runtime |

consumer 解压后 framework 工作目录即 `<host>/framework/`；harness 依赖只进 `framework/harness/node_modules`。

**4.3 清理**

删除误生成 `framework/harness/reports/`；`.gitignore` 覆盖该模式（负断言仍保留，不依赖 ignore 掩盖回归）。

---

## 关键设计决策

1. **`detectRepoLayout` grandparent 启发式保留在 SSOT 内**
2. **config 通用 infer 失败即抛错**；init CREATE 专用 helper
3. **physical / logical 路径分离**
4. **烟测跑真实 `--phase docs`**；consumer fixture 用 **release staging 完整树**
5. **外部 frameworkRoot 测试必须显式传参或 tmp 下建 framework 树**
6. **standalone 烟测含误路径负断言**
7. **guard 覆盖单双引号**

## 验收标准

- `cd harness && npm test` 全 PASS
- standalone `--phase docs` → `harness/reports/_global/docs/`；且 **`framework/harness/reports/` 不存在**
- consumer（release-staging fixture）`--phase docs` → `framework/harness/reports/_global/docs/`；`<host>/node_modules` 不存在
- fixture-runner 等外部 frameworkRoot 用例仍 PASS（显式传参未回归）
- `npm run release:verify` 断言 zip 内 package.json 无 release/dev 依赖
- guard 零误报；误生成目录已清理

## 审查结论

- **第一轮 6 点**：已全部接纳
- **第二轮 3 点收口 + 2 小建议**：已全部接纳
- **状态**：可实施；补完上述项后达「完美闭环」目标
