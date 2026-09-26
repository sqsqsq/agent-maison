## 1. CU 指针原位升版（t2a）

- [x] 1.1 `reconcileChangeUnitBlueprintRefs` 挂在设计准备段，`deriveDesignPreparationReadiness` 派生前调用并返回 bumped / skipped；复用 carry-forward 判据、canonical 校验与落盘原语。
- [x] 1.2 `revises` 在 model 与 schema 标注读兼容、停止生成；全仓无写入点。
- [x] 1.3 change-unit-continuous-progression 规格与两份 SKILL 措辞同步。

## 2. 验收（t2a）

- [x] 2.1 正例：蓝图升版后全部 CU 三处指针指向新 revision、revision 加一、契约字段不变、幂等、精确解析通过。
- [x] 2.2 反例：契约变化不升版且同路径不得再接受；carry-forward 失败不升版、字节不变；任一候选校验失败整批不落盘。
- [x] 2.3 typecheck、目标套件、`npm run openspec:validate`、`node scripts/check-plan-version.mjs`。

## 3. successor 出口（t3）

- [x] 3.1 `resolveSuccessorExecutionScope` 在 supersede 上下文重解析出生范围（候选路径 + 既往证据复用 + 评估入口撤回 uncovered），转交记录追加式；correction-routing 规格与宿主指引改口。

## 3b. closure inputs 单路（t2b）

- [x] 3b.1 `component-closure-inputs.ts` 所有 CU 经精确解析；指针未升版的 CU 直接 `carry_forward: false` 并指引经设计交接升版，删除第二分支与 `evaluateCarryForward` 注入项；component-assembly-coverage-closure 规格与在途 change `composable-workflow-foundation` 的 delta 措辞对齐。

## 3c. 完成后演进的四个真缺口（t2c / t2d / t3c / Codex 一轮）

- [x] 3c.1 指针升版同批原子刷新旧机器投影（判据只核 `derive.blueprint-*` 来源戳指向升版前身份；无戳不刷新；部分带戳 skip）；tmp→rename 写出；同批维护升版前精确成立的 `supersedes` 引用，引用方不升版则被引用 CU 也不升版。
- [x] 3c.2 successor 候选按当前输入在内存重生成（与 `--prepare-scope` 同一生成点），覆盖与复用核验使用合并后的最终需求哈希，记录仍按历史 run 核验。
- [x] 3c.3 successor 的 coding `diff_within_scope` 沿 supersede 血缘回放 UT 产出（`loadLineageRunEvents`）。
- [x] 3c.4 读侧旧根推断多候选按重定位后存在依赖数择优，并列如实 stale。
- [x] 3c.5 上一版宿主快照（平铺 + CU 绑定两个已完成 feature）与 release-only 套件 `lifecycle-evolution`（★1 基线、★2 事故形状、补测试/改文案/改验收/证据损坏、未终局 run、在途 CU、`revises` 读兼容、伪造记录、rebaseline 立场断言）。

## 3d. 发布门文档与归档（t5）

- [x] 3d.1 发版清单写明 release-only 套件执行口径与 `lifecycle-evolution` L0 兼容基线的两种合法处置；快照 README 补重生成规则；MIGRATION 补消费者向兼容基线说明；本 change 归档。

## 4. 后续（plan b2d7f4e9 其它 todo）

评估入口 `assessFeature`、closure 单路、successor 出口、其余规格同步与快照回归由 t1 / t2 余项 / t3–t5 承担；本 change 随 t5 归档。
