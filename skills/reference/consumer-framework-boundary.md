# 消费者工程 · framework 子模块边界（BLOCKER）

> 适用：通过 git submodule / vendor 引入 `framework/` 的**实例工程**（非 agent-maison 维护仓本身）。

## 禁止

除以下情形外，**不得**修改 `framework/` 下任何已跟踪文件（含 `profiles/`、`harness/`、`skills/`、`package.json`）：

- 用户明确要求升级 framework 版本（submodule bump / rsync / 发版 zip 覆盖）；
- agent-maison 维护者在 **framework 源仓库** 内开发并发版。

典型错误（须回滚）：

| 误改 | 正确做法 |
|------|----------|
| `framework/package.json` 增加 `dependencies.yaml` | `cd framework/harness && npm install`（Tier_1，见 [host-harness-readiness.md](./host-harness-readiness.md)） |
| `framework/profiles/hmos-app/harness/ts-compile.ts` 补 `MockKit`/`when` ambient | 升级含 Test Double Policy 的 framework 发版；实例 UT 按 [mock-plan-schema.md](../../profiles/hmos-app/skills/5-business-ut/templates/mock-plan-schema.md) 声明 `strategy: mockkit` |
| 在实例内「改门禁让 UT 变绿」 | 修 **宿主** `ohosTest` / `doc/features/<feature>/ut/` 产物 |

## `Cannot find module 'yaml'` / `ts-node`

1. 确认 `framework/harness/node_modules/ts-node/package.json` 存在。
2. 不存在 → **仅**在 `framework/harness` 执行 `npm install`。
3. **禁止**在 `framework/` 根或实例工程根安装 harness 运行时依赖。

## TS2614：`@ohos/hypium` 无 `MockKit` / `when`

- **禁止**在消费者 submodule 改 `ts-compile.ts`。
- 若 UT 使用 Hypium MockKit：mock-plan 须声明 `strategy: mockkit`（见 Skill 5 Step 1.6）；framework 版本须已支持该策略。
- 若尚未升级：临时用 Spy/`whenXxx` 过渡，或等待 framework 发版。

## 实例回滚命令（示例）

```bash
git -C framework checkout -- profiles/hmos-app/harness/ts-compile.ts package.json
# 或对齐 submodule 指针：
git submodule update --init framework
```
