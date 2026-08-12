# Design: harness 宿主产物污染检测

## 路径 SSOT

- 扫描根：`ctx.harnessRoot`（消费者 = `host/framework/harness`，standalone = 仓库 `harness/`）
- 禁止硬编码 `path.join(projectRoot, 'framework', 'harness')`（`path-guard.unit.test.ts` 约束）

## 检测分层

```typescript
violations = [
  ...collectContractPackagePathPollution(ctx),  // 根 core
  ...(utHost.collectHarnessPollutionExtras?.(ctx) ?? []),  // profile 可选
];
// 去重后任一非空 → BLOCKER
```

### 根 core

对每个 `contracts.modules[].package_path`，若 `fs.existsSync(path.join(ctx.harnessRoot, package_path))` 则违规。

### Profile extras（hmos-app）

在 `ctx.harnessRoot` 下递归匹配 `*.test.ets`、`ohosTest/`、`test/dag/`，排除合法 harness 子树（reports、state、tests、scripts 等）。

## 展示路径

`formatPollutionDisplayPath(ctx, absPath)`：

1. 在 `projectRoot` 内 → repo 相对路径（consumer 常见 `framework/harness/02-Feature/...`）
2. 在 `harnessRoot` 内 → `[harness]/...`
3. 否则 → 绝对路径（POSIX 斜杠）

## 测试

- 主测 `harness-path-guard.unit.test.ts`（synthetic `harnessRoot`，非 fixture-runner）
- 不依赖 fixture（`fixture-runner` 的 `harnessRoot` 指向真实仓库，会假绿）
