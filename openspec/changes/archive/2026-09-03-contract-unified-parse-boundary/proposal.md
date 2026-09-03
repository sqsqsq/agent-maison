# contract-unified-parse-boundary

## Why

宿主 SimulatedWalletForHmos `bc-openCard-1`（2026-08-28，framework 3.0.0 回灌）在 plan 相被 `contract_file_reference_closure` 拦下：contracts.yaml 的 `navigation.config_files` 与 `registration_points` 双双判 `unconsumed_file_field` BLOCKER。核实后两者性质相反——

- `navigation.config_files` **有真实消费者**：`profiles/hmos-app/harness/coding-host-rules.ts` 的 `page_registration` 自通用化改造起就在消费它（`-S` 命中链 c62b6484→e34fbf67→c8c03ad2；当前 blame 受 LF 归一化显示 6ca52b07）。它被门禁误伤。
- `registration_points` **全仓全历史零消费**（`git log -S` 实证），是宿主自由发挥，被正确拦截。

根因不是"消费者没登记"，而是**同一份 contracts 被两套代码各自解释**：resolver（`harness/scripts/utils/contract-reference-closure.ts`）持有一套手写 navigation 字段表；`page_registration` 绕过它、`as Record` 后裸读原始 YAML 的 `config_files`。两套解释各自演化、互不知情，只在宿主真实 contracts.yaml 上第一次相遇。

更尖锐的一层：那套手写字段表是从设计意图出发新造的（fbdf0ad5，schema +32 行），未普查消费面——**它 canonical 的 navigation 字段全部零真实消费者**（`main_pages_file` / `route_map_file` / `page_registration_file` / `route_registration_file` / `page_files` / `route_files` / `pages[]` / `routes[]` 只出现在 resolver、schema 元数据与其自身单测里），而唯一被真实消费的字段反被拒。发明了没人消费的字段，拒绝了唯一被消费的字段。

## What Changes

- **canonical 由真实消费者塑形**：navigation 收敛为唯一字段 `config_files: string[]`（导航注册/配置文件清单，如 main_pages.json / route_map.json）；上述八个零消费者的推测性同义字段一律裁撤，连同其嵌套形态按未知 file-like 字段 fail-closed。
- **嵌套逃逸封堵**：`rejectUnconsumedFileFields` 原先只查当前层字段名是否命中 file-like 正则——裁撤 `pages[]`/`routes[]` 的专用遍历后，`navigation.routes[].file` 会因外层 key `routes` 不命中而静默 fail-open。改为：未知字段名未命中 file-like 且值为 object/array 时，**向下遍历未知子项**，命中 file-like 子键 + file-like 值即报 `unconsumed_file_field`（source 带完整路径）。遍历**只做拒绝检测**，不产出 references、不授权任何路径——不是正向引用解析器。**不设深度上限**：任意固定层数预算本身就是 fail-open（把路径埋得更深即可静默过关），故用显式工作栈迭代 + 已访问容器防环，终止靠收敛而非截断。
- **裸读收编**：`page_registration` 删除 `as Record` 裸读，改经纯 selector `selectContractReferencePaths(closure, 'navigation.config_files')` 从既有 `references[]` 即时筛选。消费装载期已算好的 `featureSpec.referenceClosure`，缺失时按 `check-plan.ts` 同款 `??` 兜底现算——不新增状态、不在统一真源内造第二份路径投影、不重复计算。
- **阶段归属不变**：`config_files` 作为 canonical 引用获得与其它 kind 同等裁决——plan 相只管路径安全/规范化 + `contracts.files` 授权（允许声明 coding 将新建的文件）；**物理存在性归 coding `file_completeness`**（它逐条检查 `contracts.files` 存在性；授权强制 `config_files ⊆ contracts.files` 后自动覆盖，零新机制）。已授权未建 → plan PASS、coding FAIL。
- **不可读的判定不能只信 `existsSync`**：声明路径若实际是目录，`existsSync` 与 `file_completeness` 都会放行，而 `readFileSync` 抛 `EISDIR`——异常逃到 check-coding 的 `safeRun` 会被降级成 MINOR SKIP、不计入 `coding_run_status` 阻断，于是「不可读」反而能宣称完成。消费者内就地判普通文件并吞掉读取异常，统一归入 unreadable → BLOCKER FAIL。
- **`page_registration` 状态表钉死**（生产代码先查 `components[].nav_destination`，走到 config 分支的必然已有导航页面）：无 NavDestination → SKIP；有 NavDestination 而 `config_files` 为空 → **FAIL（缺注册配置声明）**；声明的文件不可读/不存在 → **FAIL，不得静默跳过**；可读 → 按注册内容 PASS/FAIL。原先的"配置文件读不到就 SKIP"是假绿。
- **裸读禁令 guard（窄护栏）**：新单测套扫 root `harness/scripts` 与各 profile 的 `harness` 目录，统一边界模块之外出现 `contracts.navigation` 原始字段读取形态（含 `as Record` 后取 `config_files` 类 token）即红；豁免表内联、每条带文件与理由；附「注入违规样本必红」自测。明确非目标：不推导字段类型、不解析解构/别名链、不覆盖 navigation 之外的 contracts 段。
- **跨消费者集成测试**：单次 SpecLoader 装载宿主形态 INPUT，同一个 FeatureSpec 分别驱动生产 plan 闭环与 profile coding host 结构检查，把"两套代码在真实文书上相遇"提前到 CI。不扩 fixture-runner 协议（其协议是单 CMD 单 phase）。
- **`registration_points` 维持拒绝**：零历史零消费，不是旧形态、不做别名归一；宿主删除（宿主动作）。
- 零新机制：不建消费者注册表（消费者声明字段 = 顺带扩大合法 contracts 方言，root 中央契约会变成 profile 可扩展契约，且手写字段表与注册表成两个真源——用新形式复刻本病）；不改 `contract_file_reference_closure` 的 fail-closed 语义与 `contracts.files` 授权裁决本体；明确拒绝"只把 `config_files` 加进 allowedFields"的消音式修复——它不入闭环授权管线，表面恢复、机制 fail-open。

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `harness-gates`: contracts 文件引用的字段合法性由 schema/统一解析器单独决定，canonical navigation 收敛为 `config_files`，未知 file-like 字段的拒绝扫描下探到嵌套子项；下游消费者只能经统一解析产出的纯 selector 消费，禁止裸读 `contracts.navigation` 原始字段。
- `feature-artifact-layout`: `contracts.yaml` 的 navigation 段 canonical 形态为 `config_files: string[]`，其成员同样受 `contracts.files` 唯一授权集约束。

## Impact

- `harness/scripts/utils/types.ts`（`ContractNavigationSpec` 收敛、reference kind union）、`harness/scripts/utils/contract-reference-closure.ts`（字段表 / navigation 分支 / 嵌套拒绝扫描 / 新增纯 selector）、`profiles/hmos-app/harness/coding-host-rules.ts`（`page_registration` 收编 + 状态表）、`specs/artifact-schemas/contracts.schema.yaml`（`x-file-reference-fields` 元数据）。
- `skills/feature/plan/contracts-template.yaml`、`skills/reference/plan-workflow-detail.md`、`skills/feature/plan/SKILL.md` 的 navigation 形态措辞。
- 新增单测套 `harness/tests/unit/contracts-parse-boundary-guard.unit.test.ts`（T3 禁令 + 自测）与 `harness/tests/unit/contracts-cross-consumer-closure.unit.test.ts`（T4 跨消费者），均显式注册进 `run-unit` CORE_SUITES；`harness/tests/unit/contract-reference-closure.unit.test.ts` 增裁撤形态与嵌套逃逸的表驱动负例，其 `bc-openCard/declared|undeclared` 语料同步为 canonical 形态。
- Phases affected: plan（引用闭环的字段域）、coding（hmos-app `page_registration` 的判定状态）；fail-closed 语义、`contracts.files` 授权本体与其它 contracts 段零变化。
- 与既有 change 的关系：原始机制的 change `plan-contract-reference-closure` 已于 **2026-08-27 归档**（`openspec/changes/archive/2026-08-27-plan-contract-reference-closure/`），本 change 在其定稿之上收编真源与消费权责。active `goal-runtime-enforcement-fixes-2` 的 3.3/3.4 正是 unconsumed file-like 机制的落地面，其 **5.4「无需 consumer migration」已被宿主 `config_files` 实锤证伪**——本 change 重开该结论并在其 tasks 中记录消费面漏查（见该 change 的 tasks.md）。
- `MIGRATION.md`: 只有两件事需要消费者动作——把 navigation 改写为 3.0 canonical 的 `config_files` 形态，以及删除无消费者的 `registration_points`。零消费者的同窗推测字段不构成消费者迁移项。
