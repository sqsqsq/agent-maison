## 1. 设计职责与输入

- [x] 1.1 修订 spec/plan contract、Skill 与规则，明确蓝图、spec、plan 的责任和独立设计终点。
- [x] 1.2 实现 derive.blueprint-acceptance，复用来源寻址及验收语义检查。
- [x] 1.3 实现 derive.blueprint-contracts 与唯一物化入口，保留写集、CU sidecar、runtime 和用例检查。

## 2. 消费与验收

- [x] 2.1 接通 checker、共享上下文、输出与 verifier，覆盖 P2 重入和职责缺口。
- [x] 2.2 完成 P3 正反例与交接夹具，运行 typecheck、harness 全量、OpenSpec、plan 与 diff/LF 校验。

正式发布前 mandatory `npm run release:verify`（或 release:all）。本 change 不切默认 workflow、不发布；MIGRATION.md 随 P7 的公开迁移统一更新。未调用 openspec update。

## 实施与验收记录（2026-09-11）

- P2 已先独立提交为 `5a4d8fe1`；P3 与 P2 分开提交。
- `blueprint-skill-projection.ts` 注册两种 typed 投影，复用 canonical CU/蓝图、验收内容、用例、runtime 与写集检查；`prepare-blueprint-design.ts` 是唯一物化入口，先验证再写，冲突不覆盖。
- spec/plan contract、checker、共享 verifier 上下文及提示按真实输入与 required_outputs 消费。设计新事实通过现有 P2 报告提议重签；专项设计止步、冻结 required 义务不被静默删除。默认 workflow 不切换。
- `harness/tests/fixtures/blueprint-design-inputs/` 提供验收、施工、runtime、用例的精确内容夹具；planned refs 仅表示待实现落点，不代表实际代码/测试已通过。
- P3 定向 18/18，覆盖真实 CLI、P1 resolver、spec/plan checker、来源等价、陈旧/冲突、映射、写集、用例、pixel 缺参考及 P2 重签提议。P2 执行范围回归 23/23。
- 首次全量发现 contract 1.1 产物归属仍被旧 tracks 过滤。已在共享 phase-write-boundary 修复，同时修正 Skill 正文预算、旧测试输入引用和缺失 suggestion；相关定向 37/37，既有运行回退回归在最终全量通过。
- 最终 `cd harness && npm test`：typecheck、4437 单测、46 fixtures 全通过；`npm run openspec:validate` 41/41，Enforcement 路径检查通过；plan、diff/LF 检查通过。
- P3 plan 5/5、change 5/5；计划正文未改写。未进入 P4–P7 生产实现，未进行真实业务宿主验收；下一步按总纲进入 P6 专项 CLI/上下文段，再交 P4/P5，P7 汇总宿主验收。

## P3 三项返修验收（2026-09-12）

- 范围验收读取支持 derive.blueprint-acceptance，并将两类来源统一交给 P1 的已有 artifact/provider 解析与绑定核对。出生与运行后继入口均传入实际 Feature/framework 上下文；不物化文件，也不再按依赖数组猜测验收文件。
- spec/plan 的叙述检查路径也调用既有 designScopeRevisionChecks；失败不提交、设计专项不施工的约束保留。
- checkAcceptanceContent 按 criteria/boundaries 所属集合应用 AC/BD 规则，AC 缺步骤、testable 或精确预期不能用 BD 字段替代。
- P3 定向 20/20：通过实际 P3→P2 读取验证派生/物化来源的相同义务及无新增 unknown，验证原绑定变动被拒绝；观察真实 checker 两条路径的共同收尾，并覆盖 spec/plan 成功提议、失败与设计专项守卫；覆盖合法 AC/BD 和字段伪装反例。P2 运行回归 23/23。
- 冻结后 `cd harness && npm test`：typecheck、4439 单测、46 fixtures 全通过；OpenSpec 41/41、plan、diff/LF 检查通过。返修限于本轮三项和直接回归，未修改计划正文、当时未提交代码、未进行真实业务宿主验收。

## 提交收口

用户已确认 P3 无其他意见。本次整理验收记录并提交 P3，生产代码未再变化，复用上述有效验收结果。下一块按总纲为 P6 §3.1–3.2 专项 CLI/上下文段；P6 其余内容留在 P4/P5 之后。
