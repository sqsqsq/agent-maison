---
name: contracts 统一解析边界 — 引用闭环真源收编与裸读禁令
version: 3.0.0
# 窗口说明：Br_release_3.0.0 在途 plan（分支策略：全部调整与测试在本分支做完再统一 cp 主干）。
# 用户裁定：不做独立 hotfix——宿主 SimulatedWalletForHmos 是 maison 新版的模拟试验场，
# 不存在解锁时限；本 plan 的解析边界收编本身就是 config_files 误伤的修复。
# v1（2026-08-28）：宿主 bc-openCard-1 回灌实锤立项，原方案=消费者注册表（profile 声明式
#   登记，允许集=canonical∪注册集）+ 同正则扫描 guard + 注册表驱动语料 fixture。
# v2（2026-08-28，吸收 codex 一轮裁决，逐条 ground-truth 核实后重构方案；plan 更名）：
# [裁决1 采纳·撤回注册表] 消费者注册表权责倒置——消费者声明字段=顺带扩大合法 contracts
#   方言，root 中央契约变 profile 可扩展契约，且手写字段表与注册表成两个真源（用新形式
#   复刻本 plan 要治的病）；capability-registry 类比不成立（那是运行时执行器多态，这里是
#   文档语义）。正确权责：schema/统一解析器决定字段合法性，消费者只能消费统一解析结果。
#   「扩展注册协议」仅当未来真出现第三方 profile 自主扩展 schema 的需求时另行立项。
# [裁决2 采纳·扫描器收窄] 不用正则推导全部 contracts.* 字段语义（解构/别名/helper/动态
#   key 会把它养成脆弱的影子解析器）——收窄为单条架构禁令：contracts 文件引用只能经统一
#   解析器，统一边界之外禁止裸读 contracts.navigation / as-Record 后读原始字段；附 guard
#   自测证明违规确实红。
# [裁决3 采纳·fixture 跨消费者化] v1 语料由注册表生成、经 resolver 断言=同一实现自证。
#   改为：同一份真实形态 contracts.yaml 同时送 plan 引用闭环与 HMOS page_registration
#   真实生产消费者，断言双端 PASS、page_registration 不得以 SKIP 冒充、未授权引用闭环必
#   FAIL、宿主旧形态覆盖。
# [codex 前提证伪一处] 「registration_points[].file 等旧形态在加载边界归一化」——git log -S
#   全仓全历史零出现（本轮实证），它不是旧形态而是宿主自由发挥；不归一化、维持拒绝，
#   宿主删除（宿主动作）。
# [本轮新实锤·支持裁决1] fbdf0ad5 自造的 canonical navigation 字段（main_pages_file/
#   route_map_file/page_registration_file/route_registration_file/page_files/route_files/
#   pages[]/routes[]）全部零真实消费者——只在 resolver/schema/自身单测出现；而唯一有真实
#   消费者的 config_files（page_registration，自通用化改造 c62b6484 起）反被拒。坐实
#   「canonical 应由真实消费者塑形」：config_files 正式化为 3.0 canonical，推测性同义
#   字段裁撤。
# v3（2026-08-28，吸收 codex 二轮 2P1+3P2+P3，逐条 ground-truth 核实后修订）：
# [P1-1 采纳] 存在性阶段归属错——plan 闭环只管路径规范化 + contracts.files 授权
#   （check-plan.ts:997 现状如此，canonical spec 亦只规定授权子集关系）；物理存在性归
#   coding file_completeness（check-coding.ts:70，本轮实证：它逐条检查 contracts.files
#   存在性——授权强制 config_files ⊆ contracts.files 后存在性已被覆盖，零新机制）。
#   plan 阶段允许声明 coding 将新建的文件：已授权未建 → plan PASS、coding FAIL。
#   删除 v2 全部「闭环存在性 FAIL」措辞。
# [P1-2 采纳] config_files=[] → SKIP 是假绿——生产代码先查 components[].nav_destination
#   （coding-host-rules.ts:484，本轮复核）：无导航页早已 SKIP，走到 config 分支的必然
#   「有 NavDestination 却没声明注册文件」，必须 FAIL。状态表四行钉死（见 T2）。
# [P2-1 采纳] 不在 referenceClosure 内再存 navigation 路径副本（统一真源内造重复投影）
#   ——改纯 selector selectContractReferencePaths(closure, 'navigation.config_files')
#   从既有 references[] 即时筛选，零新状态。
# [P2-2 采纳] openspec 关系两处纠错（本轮实证）：plan-contract-reference-closure 已于
#   2026-08-27 归档，非 active；goal-runtime-enforcement-fixes-2 与本 plan 明确重叠
#   ——其 3.3/3.4 正是 unconsumed file-like 机制，5.4「无需 consumer migration」已被
#   宿主证伪，须重开/修正。删除「与 goal-* 无重叠」表述。
# [P2-3 采纳] fixture-runner 协议单 CMD 单 phase（fixture-runner.ts 本轮复核），不为
#   本 plan 扩协议——T4 改为跨消费者集成单测：单 SpecLoader 装载，同一 FeatureSpec
#   分别驱动生产 plan 闭环与 profile coding host 结构检查，正反例复用同一 helper。
# [P3 采纳] 三处清理：①contracts.schema.yaml 无真正 navigation schema 段、只有
#   x-file-reference-fields 元数据——T1 修改对象钉死为 TS 类型/kind union/resolver
#   字段表/x-file-reference-fields/模板，不引入新 schema 执行机制；②config_files 证据
#   引用修正（-S 命中链 c62b6484→e34fbf67→c8c03ad2，引入 root 时代、e34fbf67 下沉
#   profile，当前 blame 受 LF 归一化显示 6ca52b07）；③MIGRATION 只说明 3.0 canonical
#   config_files 与 registration_points 处理，零消费者推测字段不写成消费者迁移项。
# v4（2026-08-28，吸收 codex 三轮 2P1+1P2，逐条核实后修订）：
# [P1-① 采纳] 裁撤 pages[]/routes[] 后嵌套逃逸——rejectUnconsumedFileFields 拒绝条件
#   要求**字段名本身**命中 file-like 正则（contract-reference-closure.ts:85，本轮对源码
#   复核确认）：`routes`/`pages` 名不命中、裁撤专用遍历后内层 file 无人扫 → 静默
#   fail-open。最小修法入 T1：未知字段名未命中 file-like 且值为 object/array 时向下
#   递归扫未知子项（仅拒绝检测，不做正向引用解析）；被裁撤全部嵌套形态表驱动负例
#   （pages[].file/page_file/route_file/registration_file、routes[].同族）断言
#   unconsumed_file_field。机制闭环必需，非可选加固。
# [P1-② 采纳] frontmatter t5 todo 仍写「修订 active plan-contract-reference-closure」
#   ——正文 T5 已改、待办 SSOT 漏改（发版解析器只读 frontmatter todos），同步为
#   「修改 canonical specs + 修正 goal-runtime-enforcement-fixes-2 消费面漏查及 5.4」。
# [P2 采纳] T4 接线出不了 file_completeness——它属 root check-coding.ts，不在 profile
#   runStructureChecks 内。T4 负例②删除 file_completeness 断言，只断 plan PASS +
#   page_registration FAIL；阶段归属由既有生产代码与授权子集关系保证（file_completeness
#   自有既有覆盖），不为此把集成测试扩成完整 coding harness。
todos:
  - id: t1-canonical-by-real-consumers
    content: T1 canonical 由真实消费者塑形：navigation.config_files 正式化（TS 类型/kind union/resolver 字段表/x-file-reference-fields/模板）；推测性同义字段裁撤 + rejectUnconsumedFileFields 增未知子项递归拒绝扫描（防嵌套逃逸）+ 被裁撤嵌套形态表驱动负例；registration_points 维持拒绝。
    status: completed
  - id: t2-unified-boundary-consumption
    content: T2 裸读收编：checkPageRegistration 经纯 selector 消费统一解析产出，删除原始 YAML 裸读；config_files 进闭环授权管线（plan 管授权、coding file_completeness 管存在性）；page_registration 状态表钉死（有 NavDestination 而无注册声明=FAIL）。
    status: completed
  - id: t3-bare-read-guard
    content: T3 裸读禁令 guard 单测：统一边界之外禁读 contracts.navigation 原始字段，附「注入违规样本必红」自测。
    status: completed
  - id: t4-cross-consumer-integration-test
    content: T4 跨消费者集成单测：单 SpecLoader 装载宿主形态 INPUT，同一 FeatureSpec 驱动生产 plan 闭环 + profile coding host 的 page_registration，正反例共 helper；不扩 fixture 协议。
    status: completed
  - id: t5-openspec-and-docs
    content: T5 openspec change contract-unified-parse-boundary：修改已合入的 canonical specs（plan-contract-reference-closure 已归档，按归档路径引用）+ 明确修正 active goal-runtime-enforcement-fixes-2 的消费面漏查并重开其 5.4 已证伪结论 + 模板/文档/MIGRATION 同步。
    status: completed
overview: >
  宿主回灌实锤：引用闭环门禁把 hmos-app 真实消费中的 navigation.config_files 判成
  unconsumed_file_field BLOCKER。根因不是"消费者没登记"，而是同一份 contracts 被两套代码
  各自解释——resolver 有一套手写字段表，page_registration 又裸读原始 YAML。根治（codex
  裁决版）：把现有 resolver 收编为唯一真源——canonical 字段由真实消费者塑形（config_files
  正式化、零消费者的推测性同义字段裁撤），下游消费者只准经 selector 消费统一解析产出
  （裸读禁令 guard 钉死），跨消费者集成测试把"两套代码在真实文书上相遇"提前到 CI。
  不建注册表、不做 hotfix、plan 相不引入存在性裁决。
---

# contracts 统一解析边界：引用闭环真源收编与裸读禁令（c7e2a9d4）

状态：**v4 已终审通过，T1–T5 全部实施完毕并吸收一轮 review（2P1+2P2）修订（2026-08-28，Br_release_3.0.0 工作区，未提交，待人工 review）**。review 修订（两轮）：①嵌套拒绝扫描删除深度上限（固定层数预算=fail-open，改工作栈迭代+防环）；①b 值侧 containsFileLikeValue 同样改迭代+防环（外层改栈后它是剩下的无防护递归，自引用 YAML 锚点会在装载期爆 RangeError 打断整个 SpecLoader，连结构化 issue 都产不出）；②page_registration 的不可读判定改为就地判普通文件并吞读取异常（原 existsSync 对目录放行，异常逃到 safeRun 会降级 MINOR SKIP 而不阻断）；③openspec 权责改为单向（消费者读取不赋予字段合法性）；④T4 registration_points 负例改为宿主真实层级 navigation.registration_points。验证：`npm test` 3661 unit + 46 fixtures 全绿；`npm run openspec:validate` 42/42；`check-plan-version` PASS。
触发：宿主 SimulatedWalletForHmos bc-openCard-1（2026-08-28，framework 3.0.0 回灌）UT 责任域全绿后，plan 相 `contract_file_reference_closure` 把 contracts.yaml 的 `navigation.config_files` / `registration_points` 判 `unconsumed_file_field` BLOCKER。核实：`config_files` 有真实消费者（[coding-host-rules.ts:473](../../profiles/hmos-app/harness/coding-host-rules.ts)，消费历史贯穿通用化前后：-S 命中链 c62b6484→e34fbf67→c8c03ad2，当前 blame 受 LF 归一化显示 6ca52b07）被误伤；`registration_points` 全仓全历史零消费（git log -S 实证）被正确拦截。

---

## 一、问题陈述与定性

`contract_file_reference_closure` 的 fail-closed 设计正确且保留。病根是**同一份 contracts 被两套代码各自解释**：

- resolver（[contract-reference-closure.ts:72](../../harness/scripts/utils/contract-reference-closure.ts)）持有一套手写 navigation 字段表；
- hmos-app `page_registration`（[coding-host-rules.ts:470](../../profiles/hmos-app/harness/coding-host-rules.ts)）绕过它，`as Record` 后裸读原始 YAML 的 `config_files`。

两套解释各自演化、互不知情，只在宿主真实 contracts.yaml 上第一次相遇。要消灭的不是"未登记的字段"，而是**绕过统一解析器的裸读**。这是本仓第三次踩"一个事实、两处维护"（goal 谓词、UT 改码基线、本次），本 plan 拆掉该族在 contracts 上的发生机制。

## 二、"为什么没发现"证据链（全部已核实）

| 环节 | 事实 |
|---|---|
| 隐性契约 | `config_files` 在 schema/docs/模板/fixture 全仓零记录，唯一存在形式=profile 代码裸读；消费历史贯穿通用化前后（-S 命中链 c62b6484→e34fbf67→c8c03ad2；blame 受 LF 归一化显示 6ca52b07） |
| 白名单出处倒置 | fbdf0ad5 的 navigation 字段表从设计意图出发新造（schema +32 行），未普查消费面；**其 canonical 字段本身全部零真实消费者**（只在 resolver/schema/自身单测出现）——发明了没人消费的字段，拒绝了唯一被消费的字段 |
| 语料净化 | fbdf0ad5 自带 `bc-openCard/declared\undeclared/contracts.yaml` fixture，却不含 `config_files`/`registration_points`（grep 零命中）——碰撞用例取样时被洗掉 |
| 切片测试体系 | 门禁在 plan 相（[check-plan.ts:997](../../harness/scripts/check-plan.ts)），裸读消费者在 coding 相 profile 层；单测/fixture 按相按层切片，resolver 的断言由 resolver 自己出（自证），两套解释只在宿主相遇 |

机制现状：`resolveContractFileReferences` 单一实现、两个调用点（check-plan.ts:997 门禁 + spec-loader.ts:223 装载期，产出挂 `featureSpec.referenceClosure`）；`FILE_LIKE_FIELD_NAME` 正则（:62）定义裁决域；`page_registration` 消费形态=把 `config_files` 各文件内容拼接后做 NavDestination 子串检查（[coding-host-rules.ts:497-516](../../profiles/hmos-app/harness/coding-host-rules.ts)），统一视图只需交付**归一化的导航配置文件路径列表**，文件内容仍由消费者自读（读文件内容不是读 contracts 字段，不在禁令内）。

## 三、根因与权责模型

**根因**：允许集手写清单是"第二真相源"，而真相只在消费者代码里；验证体系又没有让两者相遇的交汇面。

**正确权责**（codex 裁决，本 plan 采纳为定稿）：

```
schema/统一解析器 决定什么字段合法（唯一认识字段名的地方）
消费者          只能消费统一解析结果（可带诊断元数据，不得授权字段合法性）
```

v1 的消费者注册表已撤回：消费者声明字段=顺带扩大合法方言、root 契约变 profile 可扩展契约、手写字段表与注册表成两个真源——用新形式复刻本病。「扩展注册协议」仅当未来真出现第三方 profile 自主扩展 schema 的需求时另行立项，不夹带在本次修复里。

## 四、目标模型（单条数据链）

```
原始 contracts.yaml
        │
        ▼
统一解析/归一化边界（contract-reference-closure.ts——唯一认识字段名的地方）
        │
        ▼
规范化的文件引用视图（featureSpec.referenceClosure.references[]，唯一一份）
        ├── plan 引用闭环：路径规范化 + contracts.files 授权裁决（存在性归 coding file_completeness）
        └── hmos-app page_registration：经纯 selector 即时筛选 kind=navigation.config_files 的路径
```

**定稿要点**：

1. **canonical 由真实消费者塑形**：`navigation.config_files: string[]` 正式化为 3.0 canonical 字段（schema + resolver reference kind `navigation.config_files`）；fbdf0ad5 零消费者的推测性同义字段（`main_pages_file`/`route_map_file`/`page_registration_file`/`route_registration_file`/`page_files`/`route_files`/`pages[]`/`routes[]`）**裁撤**——同窗新造、零宿主采用、裁撤零兼容成本，且"多个近义字段各自发展"正是要消灭的形态。若 review 认定某字段有已规划的真实消费者，保留者须当场指认消费者，否则一律裁。
2. **config_files 进闭环管线，裁决按阶段归属**：作为 canonical 引用获得与其它 kind 同等裁决——**plan 相=路径安全/规范化 + `contracts.files` 授权**（现闭环语义，[check-plan.ts:997](../../harness/scripts/check-plan.ts) / canonical spec 均如此）；**物理存在性归 coding 相 `file_completeness`**（[check-coding.ts:70](../../harness/scripts/check-coding.ts) 逐条检查 contracts.files 存在性——授权强制 `config_files ⊆ contracts.files` 后，存在性零新机制自动覆盖）。plan 阶段允许声明 coding 将要新建的文件：已授权但未建 → plan PASS、coding `file_completeness` FAIL。**明确拒绝"只把 config_files 加进 allowedFields"式修复**：那只消音、不入闭环，表面恢复、机制 fail-open。
3. **裸读收编**：`checkPageRegistration` 改为经纯 selector `selectContractReferencePaths(closure, 'navigation.config_files')` 消费统一解析产出——从既有 `references[]`（{path,kind,source}，[types.ts:385](../../harness/scripts/utils/types.ts)）即时筛选，**不新增状态、不在统一真源内造第二份路径投影**；删除 `as Record` 裸读。SKIP 分支按状态表钉死（见 T2）。
4. **registration_points 不归一化**：零历史零消费（git log -S 实证），不是旧形态；维持 `unconsumed_file_field` 拒绝，宿主删除（宿主动作）。
5. **裸读禁令 guard（窄护栏）**：只负责一条架构禁令——统一边界模块之外，禁止读取 `contracts.navigation` 原始字段（含 `as Record` 后取 `config_files` 类 token）；不做全字段语义推导。附自测：注入违规样本断言必红。
6. **跨消费者集成测试（消灭自证，不扩 fixture 协议）**：fixture-runner 协议是单 CMD 单 phase，不为本 plan 扩协议——改为集成单测：单次 SpecLoader 装载宿主形态 INPUT，对同一个 FeatureSpec 分别调用生产 plan 闭环与 profile coding host 的结构检查（取 `page_registration` 结果断言），断言四条：①引用在 `contracts.files` 时双端 PASS；②page_registration 走真实校验路径，**不得以 SKIP 冒充成功**；③引用不在 `contracts.files` 时闭环必 FAIL；④未知 file-like 字段（registration_points 形态）必拒。正反例复用同一 helper。

## 五、实施批次（待 review 后动手）

### T1 canonical 塑形（类型 + resolver + 元数据）
- 修改对象钉死（contracts.schema.yaml 无真正 navigation schema 段，只有 `x-file-reference-fields` 元数据，**不引入新 schema 执行机制**）：①TS 类型（ContractsSpec 的 navigation 形态）；②reference kind union；③resolver 的 navigation 字段表与 `rejectUnconsumedFileFields` 允许集；④`x-file-reference-fields` 元数据；⑤plan 模板/contracts-template。
- canonical navigation 收敛为 `config_files: string[]`（语义：导航注册/配置文件清单，如 main_pages.json、route_map.json）；裁撤的推测性同义字段按未知 file-like 处理（fail-closed，不留静默兼容）。
- **嵌套逃逸封堵（codex 三轮 P1，机制闭环必需）**：现 `rejectUnconsumedFileFields` 只查当前层字段名——裁撤 `pages[]/routes[]` 专用遍历后，`navigation.routes[].file` 会因外层 key `routes` 不命中 file-like 正则而被静默放过。修法：未知字段名未命中 file-like 且值为 object/array 时，**向下递归扫描未知子项**（仍只做拒绝检测，命中 file-like 子键+file-like 值即报 `unconsumed_file_field`，source 带完整路径；**不**把递归变成正向引用解析器）。
- 被裁撤的全部嵌套形态**表驱动负例**：`pages[].file/page_file/route_file/registration_file`、`routes[].` 同族、以及顶层 `main_pages_file` 等平铺字段，逐条断言产生 `unconsumed_file_field`（入 contract-reference-closure 单测）。
- fbdf0ad5 的 `bc-openCard/declared|undeclared` 单测语料同步为 canonical 形态（该语料是 fbdf0ad5 自造的，不存在存量宿主兼容义务）。

### T2 裸读收编（page_registration → selector）
- 新增纯 selector `selectContractReferencePaths(closure, kind)`：从既有 `references[]` 即时筛选指定 kind 的路径，零新状态。
- `checkPageRegistration` 消费 `ctx.featureSpec.referenceClosure`（缺失时按 spec-loader 兜底路径现算，与 check-plan.ts:997 同款 `??` 形态）经 selector 取 config_files 路径，删除 `nav?.config_files` 裸读；不重复计算（装载期单算、双相共享）。
- **状态表钉死**（生产代码先查 `components[].nav_destination`，[coding-host-rules.ts:484](../../profiles/hmos-app/harness/coding-host-rules.ts)——走到 config 分支的必然已有导航页面）：

  | NavDestination | config_files 引用 | 结果 |
  |---|---|---|
  | 无 | 任意 | SKIP（无适用对象，现状保留） |
  | 有 | 空 | **FAIL：缺注册配置声明**（v2 的"维持 SKIP"是假绿，撤销） |
  | 有 | 文件不可读/不存在 | **FAIL，不得静默跳过**（存在性正式裁决在 coding `file_completeness`，本门禁同轮如实报 FAIL 而非 SKIP） |
  | 有 | 可读 | 按注册内容 PASS/FAIL（现状） |

### T3 裸读禁令 guard 单测
- 新单测套（run-unit CORE_SUITES 注册）：扫 root `harness/scripts` + `profiles/*/harness` TS 源，统一边界模块（contract-reference-closure.ts）之外出现 `contracts.navigation` 原始字段访问 / `config_files` token 的裸读形态 → 红；豁免表内联、每条带 file:line + 理由。
- guard 自测：以内存样本注入一处违规读取，断言扫描器抓到（参照 [adjudication.unit.test.ts:631](../../harness/tests/unit/adjudication.unit.test.ts) 扫描器先例）。
- 明确非目标：不推导字段类型、不解析解构/别名链——那是影子解析器，禁令只认"边界外出现该 token 的读取形态"。

### T4 跨消费者集成单测（不扩 fixture 协议）
- 新单测套（run-unit CORE_SUITES 注册）：helper 铺一份宿主形态 INPUT（contracts.yaml：`navigation.config_files` 指向真实 main_pages.json/route_map.json + 带 `nav_destination` 的 component + `contracts.files` 授权集 + 背书文件树），**单次 SpecLoader 装载**。
- 对同一个 FeatureSpec：①调用生产 plan 闭环检查，断言 `contract_file_reference_closure` PASS；②调用 profile coding host 的结构检查入口，取 `page_registration` 断言 PASS（非 SKIP，details 含注册数）。
- 负例四连（复用同一 helper）：①config_files 路径不在 `contracts.files` → plan 闭环 FAIL；②config_files 指向不存在文件 → plan 闭环仍 PASS（合法的"计划新建"不受堵）且 `page_registration` FAIL 非 SKIP——**本测试不断言 `file_completeness`**（它属 root check-coding.ts、不在 profile runStructureChecks 接线内，其行为由既有生产覆盖保证，不为此扩成完整 coding harness）；③有 NavDestination 但 config_files 为空 → `page_registration` FAIL；④contracts.yaml 含 `registration_points` → `unconsumed_file_field` BLOCKER。

### T5 openspec + 文档
- 新 change `contract-unified-parse-boundary`：**修改已合入的 canonical specs**（openspec/specs/harness-gates 等）——navigation 字段集收敛与消费权责（schema/解析器=合法性唯一来源、下游禁裸读），不改 fail-closed 与 `contracts.files` 授权裁决本体。原始机制的 change `plan-contract-reference-closure` 已于 **2026-08-27 归档**，引用按归档路径。
- **明确修正 active `goal-runtime-enforcement-fixes-2` 的消费面漏查**：其 3.3/3.4 正是 unconsumed file-like 机制的落地面，5.4「无需 consumer migration」已被宿主 config_files 实锤证伪——重开/修正该 task 的完成结论，不保留已证伪的勾。不写「与 goal-* 无重叠」。
- plan 模板/SKILL 文档同步 canonical navigation 形态；MIGRATION 只说明两件事：3.0 最终 canonical `navigation.config_files` 的形态，与 `registration_points`（无消费者字段应删除）的处理——零消费者的同窗推测字段不构成消费者迁移项。

## 六、验收场景（完成判据）

1. **宿主形态回归**：contracts.yaml 用 `navigation.config_files` + `contracts.files` 授权 → plan 闭环 PASS（路径规范化 + 授权裁决）且 coding `page_registration` 真实校验 PASS（非 SKIP）——双端同料，零产品代码改动、零提交。
2. 含 `registration_points` → BLOCKER，指引"无消费者字段应从 contracts.yaml 删除"。
3. 在边界外新增一处 `contracts.navigation` 裸读 → guard 单测红；改为经 selector 消费 → 绿。
4. **阶段归属**：config_files 已授权但文件未建 → plan 闭环 PASS（合法的"计划新建"不受堵）、`page_registration` FAIL 非 SKIP（T4 断言）；coding `file_completeness` 对缺失文件 FAIL 属既有生产语义（自有覆盖，不入 T4 接线）。
4b. **嵌套逃逸负例**：`navigation.routes: [{file: …}]` 等被裁撤嵌套形态 → `unconsumed_file_field` BLOCKER（表驱动，T1 单测）。
5. **状态表**：有 NavDestination 但 config_files 为空 → `page_registration` FAIL（v2 假绿态消灭）；无 NavDestination → SKIP 保留。
6. 两调用点等值：check-plan 与 spec-loader 对同一 contracts 产出相同结论；coding 经 selector 消费不重复计算。
7. `npm test` / `npm run openspec:validate` / `check-plan-version` 全绿；既有 fixture 中受 canonical 裁撤影响的仅 fbdf0ad5 自造语料（同步为 canonical 形态），其余零变化。
8. 宿主回灌（用户驱动）：同步框架后宿主删 `registration_points` → 重跑 plan→coding→review→ut 收口。

## 七、边界与悬置（防膨胀）

- **不建**消费者注册表（v1 已撤回）；「扩展注册协议」仅当第三方 profile 自主扩展 schema 的真实需求出现时另行立项。
- **不改** `contract_file_reference_closure` 的 fail-closed 语义与 `contracts.files` 授权裁决本体——只收编真源与消费权责。
- **不做** hotfix / 只补 allowedFields 的消音式修复（明确列为反模式）。
- **不扩** fixture-runner 协议（单 CMD 单 phase 维持现状）——跨消费者交汇面由集成单测承担。
- **不在** plan 相引入文件存在性裁决——存在性归 coding `file_completeness`，阶段归属维持 canonical spec 现状。
- guard 只管 navigation 裸读禁令；其他 contracts 段（modules/data_models/…）的消费本就经 resolver，若未来发现新裸读面按同款禁令扩展，另行小改不预支。
- 其他工件（acceptance/use-cases 等）的消费一致性问题如有实锤另行立项。
- 宿主 `registration_points` 删除与四件套重跑属宿主动作，用户驱动，不入本 plan 交付物。
- goal 侧、UT 基线（f3a9d2c7 已交付）、回执模型一概不动。
