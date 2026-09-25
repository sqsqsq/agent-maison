## Why

宿主 bc-openCard-2 装 3.1.0 后把蓝图修到 rev3，已完成 CU v2 的三处蓝图指针全部失效，完成判定报 INVALID，框架只剩"新建 superseding CU 重走六阶段"一条路。根因是三套恢复规则对同一问题各给一个答案：CU 层规格规定"纠正已完成结果 MUST 新建 change_unit_id，只有尚未实施 CU 可原位升 revision"；完成判定把"输入过期"和"凭证伪造"压成一个 INVALID；`revises` 只有类型与 schema、全仓无消费者。

## What Changes

- CU 身份规则收成一条：契约字段不变即同一 CU。蓝图升 admitted revision 且 carry-forward 通过时，由唯一 consumer writer（设计准备段）在派生 readiness 前把三处蓝图指针原位升到当前蓝图、CU revision 加一；已完成与未完成 CU 同规则。carry-forward 失败不升版；三处指针身份不一致（契约变化）不升版；契约变化走新 `change_unit_id` + `supersedes`。
- `revises` 停止生成，schema/model 保留为读兼容，无消费者。
- 完成观察措辞从 `ABSENT|VALID|STALE|INVALID` 改为评估入口 `assessFeature` 的记录三态（absent / ok / broken）+ 逐义务 covered/uncovered：P2 投影为 `ABSENT|VALID|INCOMPLETE|INVALID`，输入过期只表现为 uncovered 义务，不判 INVALID。
- 完成后修正经 successor（t3）：`--supersede <完成 run>` 在 supersede 上下文按当前输入重解析出生范围、既往证据经同一核验复用、只跑 uncovered 责任阶段；feature 冻结记录转交改追加式 `transfers[]`；`--revalidate` 不签发 completion。
- 精确引用解析器不放宽。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `correction-routing`: 保留 `--revalidate` 为在途机械重验并声明其不签发 completion；新增「完成后修正经 successor、范围由评估入口计算」。
- `change-unit-continuous-progression`: 完成观察、ready set、薄推进循环改用评估入口措辞；调和规则改为"契约不变即同一 CU、指针原位升版"；设计准备段增加指针原位升版条目。
- `component-assembly-coverage-closure`: closure 输入收为单路——所有 CU 经精确解析；指针未升版的 CU 直接 `carry_forward: false` 并指引经设计交接升版，不再走"无 provenance 校验 + binding 精确核对"的第二分支；STALE 措辞改为 INCOMPLETE。

## Impact

`harness/scripts/utils/change-unit-design-preparation.ts`（`reconcileChangeUnitBlueprintRefs`，接在 `deriveDesignPreparationReadiness` 内）、`change-unit-provider-boundary.ts`（导出既有落盘原语）、`change-unit-model.ts` / `change-unit.schema.json`（`revises` 停产注释）、`skills/project/change-unit-progression/SKILL.md`、`skills/project/component-design/SKILL.md`。评估入口 `assessFeature`、successor 出口与其余规格（correction-routing、reconcile-assessment、verdict-lattice 等）由 plan b2d7f4e9 的其它 todo 承担。不新增文件类型、注册表或状态。
