# 无 Feature 专项 harness

本入口用于直接修改的 compile/架构能力，以及实际写/跑测试或经 checker 校验的 review/UT/testing 请求。先消费 [统一前门](project-entry.md) 的本请求与用户覆盖；只完成实际请求终点，不强造 Feature、CU、Goal 或 `_adhoc` 身份。只审查、解释或设计用例时直接用对应 Skill 共享方法，无需 request/facts/六章报告。已有在途 Feature/CU 仍走原范围，不能拆 request 绕开其义务。

纯编译可独立执行 `cd framework/harness` 后的 `npm run compile -- --project-root <宿主根> --json`。直接修改的本请求来源及内容核对并入同次能力调用：客户端可自动提供准确来源时省略 `--session-ref`，先设计/先 CLI 无需先触发编辑 hook；已有原 request/Goal 或跨入口交接则原样复用返回的 `session_ref`，不重新选择最新 user。JSONL 引用是绝对原件加真实 user ID（相应格式可用 `line:n`）；DSH 引用是绝对压缩原件加真实 `user/message.data.id`；OpenCode 引用是 `opencode:<原生SQLite绝对路径>?session=<SID>#<userID>`，当次 shell 的 call 引用由桥自动提供，不要求手拼。命令核原件 session/cwd/真实用户来源，从正常调研读取带来源事实，不能只给档位文本。缺原件/可靠基线仍可报告实际 compile/显式局部检查；没有可用原生原件时，自动 request 可仅用 `--target` / `--test-target` 实际执行显式局部能力，无需手写 JSON，仍消费同一 request schema/parser/provider。原 request 的 `origin_gap` 保留真实来源与完整对账缺口，工具实际执行结果独立显示，不签完整 review 或请求 PASS，也不能据此授予豁免或固定档位。facts 区分原生作者带来源的调研与原 parser 对当前字节的实际读取，不把机械读取说成语义已获证明。编译日志在宿主 `doc/reports/compile/`；编译绿只证明实际执行的检查，首个失败原因、后续恢复和仍未知项分别保留原件。

有架构配置时 compile 默认对相关实际文件执行原依赖方向/跨模块出口检查；`--architecture-only` 只执行同一架构判据，不构建，也不要求 Feature 专用蓝图/CU 文档。`--target <项目相对路径>` 可重复限定显式目标，不能据此隐藏本请求其它实际影响。

```powershell
cd framework/harness
npm run compile -- --project-root <host> --session-ref '<绝对transcript>#<原始user消息ID>' --json
npm run compile -- --project-root <host> --session-ref '<绝对transcript>#<原始user消息ID>' --architecture-only --target src/repository.ts --json
```

上述显式引用也可替换为原入口返回的 OpenCode 引用；可自动定位的普通 shell 直接省略该参数。OpenCode `--pure` 禁插件，PTY 原生缺 session/call 时保留来源缺口；DSH 首次沿准确原件最后真实 user 建锚，已有引用后固定复用，暂未 flush 不改选会话。当前实现/实测边界见 [adapter说明](../../agents/README.md#前门规则与真实客户端证据)。

## Agent / adapter 执行顺序

1. 首轮正常调研取得原请求、实际读取路径、Q1/Q2/Q3、独立结果依赖、跨部件、预期明确/做法唯一及起始调查；不要求用户表单或手写 JSON。首次能力命令从真实原生 payload/环境自动定位，已有引用则沿同一 `session_ref` 传递。边界解释、真实用户原文/定位、覆盖、精确 base/head、初始 dirty 归属及派生外框保存在同一 schema 的原 request；只复制本请求所需内容，不导出整段会话。
2. **无 `--request-file` 时自动准备**：现有 writer 在本次 `reportDir/request.json` 写执行派生件，使用同一 parser/provider/报告。显式 `--report-dir` 须位于项目内、framework/.git/features_dir 外；省略默认落 `doc/reports/request/<原生请求身份短哈希>/<phase>`，同请求恢复复用。按实际目标可传重复的 `--target`、`--test-target`、`--allow-test-write`，testing 用 `--cases`。这些参数是本次目标/许可，不是可执行命令字符串。
3. 首次 UT 写入前完成载体准备，自动路径并入首次能力调用；需要先查看 `gaps` 时带原 `--prepare-request`。直接使用返回的 request 路径、哈希、基线、bindings、reportDir/factsPath 与 allowed writes，不自算身份。模块/载体缺口在既有授权内继续补齐，未覆盖才指出具体缺失授权；不得先写到不可执行目录再探载体。自动 prepare 会落上述派生 request/上下文；**显式 request-file 的旧 prepare 仍只读**。
4. 阅读真实目标/具体 base 到 head 差异。按返回上下文建立本 phase 的 P1 facts（`schema_version: "1.1"`、subject 仅 request_sha256，不写 feature/run_id），review 写真实报告，UT/testing 在 allowed_test_writes 内准备并执行。必要输入改变重新准备，不沿旧绑定宣称当前输入通过。同一请求途中 commit/恢复不重置初始基线；重叠初始 dirty 无前像须披露 unknown，不能吞入用户旧修改。
5. 实际执行沿同一命令去掉 `--prepare-request`，读取 summary/checks 和真实证据；失败/缺口持续交回原作者，完成本请求全部适用义务才收口。自动/显式请求共用专业检查、隔离、载体和预期来源合同。特别简单以原始用户预期为来源，小型读取同一路径短蓝图的当前身份与具体验收；不建假 CU，不以旧 revision、路径存在或 characterization 冒充本次验收。

```powershell
cd framework/harness
npm run check -- --project-root <host> --phase review --session-ref '<绝对transcript>#<原始user消息ID>' --report-dir doc/reports/review-01 --prepare-request
npm run check -- --project-root <host> --phase review --session-ref '<绝对transcript>#<原始user消息ID>' --report-dir doc/reports/review-01
```

自动来源可用时，上述首次调用可省略 `--session-ref`；准备后沿返回的 request 路径继续，已有锚不因追加消息而漂移。

**断言预期来源不减免**：每条断言自带登记——用例名前加 `[CHAR-…]`（只记录现状）或 `[AC-…]` / `[BD-…]` / `[BRANCH-…]`（有来源标签），或紧邻该行上方加 `// characterization` / `// expectation: <项目内相对路径>`。特别简单可引用自动生成的原 request JSON 项目相对路径，它保存真实用户预期和原生出处；只有未核实 AC 标签不证明预期。旧行为测试随本次修改同步；已完成需求蓝图作为历史施工图，不为小修改重写；在途验收/契约修订仍回原入口。

写在 `describe(` 或文件头的总括注释不算登记，无作用域继承，`/* */` 也不算；每条断言单独一行，以 `it(`/`test(` 起行且名字为字符串字面量。`request_expectation_source` 按“已登记来源/现状记录/历史未登记”分栏，不按类别声称通过多少条。诚实 characterization 不判 FAIL，也不计需求验收；本次允许写入里既无来源又未标注才是 BLOCKER。当前按行扫描，不解析字符串/模板串，假用例文本可骗过扫描与数量对账；这个边界如实保留，写测试者仍负责来源真实。仅来源路径可解析不等于语义已经机器证明。

### 小型蓝图与同一请求的预期来源

小型先完成同协议短蓝图的四样业务内容，再沿原请求实现与调用本能力。第一次设计调用在已有 `check:component-blueprint` 中自动核原生来源（已有引用则原样传 `--session-ref`），并返回真实 `phase: component-design` 的 `request_file/source_refs`，默认只准备 request/稳定原文，不借本页 review/UT/testing 身份。只有获准补 canonical 机器来源时才加 `--prepare-source`；后续 `--request-file <返回路径>` 默认只读重验，不修改 canonical/request/source。已有权威项目内来源优先复用；纯 inline 必需项目内源时，原 writer 保存稳定原文输入底稿，出处绑定保留在同 request，不 hash 可变 request 整文件或建立第二需求真源。具体设计准备见 [蓝图设计输入](../concepts/blueprint-design-inputs.md#小型请求的首次准备与消费)。

后续能力复用原用户目标、覆盖、基线和同一蓝图当前身份及具体验收 ID，自动准备使用原 parser/typed 合并，不新建 CU、假 Feature 或并列设计文件。review 消费目标、短设计、最终 diff 和有效验证；UT 每条预期实际指向当前验收，不以路径存在、旧 revision、只有标签或 characterization 冒充已验。相关蓝图修订后仅重验受影响绑定/断言，其它有效结果复用；仅编译/仅 review 请求仍止于自身终点，小型请求完成不代 CU/Component completion。

设计检查返回的原 `phase: component-design` request 可直接交同一 check 入口续接，不能把原 JSON 手工改成 review/ut：

```powershell
npm run check -- --project-root <host> --phase review --request-file <原component-design的request_file> --prepare-request
npm run check -- --project-root <host> --phase ut --request-file <原component-design的request_file> --test-target <合法测试载体内的项目相对路径> --allow-test-write <同一测试文件> --prepare-request
```

writer 自动在原设计 request 目录的 `<phase>/request.json` 派生本阶段请求；可选 `--report-dir <独立目录>` 覆盖落点。去掉 `--prepare-request` 执行同一命令，review 先在返回目录写真实报告，UT 仍先完成载体及 allowed writes 准备。各阶段保留 `origin_request` 指向原设计 request，以及工具发布的 `blueprint: {ref, acceptance_ids}`；`ref` 为经 canonical/同一 intake 重验的当前 ComponentBlueprintRef，`acceptance_ids` 是真实验收 ID，作者不手填摘要或换身份。派生读取原 user、起始 base 和当前来源，复用原 parser/provider，不重置基线或新建任务。

小型 UT 的每条预期仍在紧邻用例上方登记 `// expectation: <canonical蓝图项目相对路径>#AC-1`；路径和 AC ID 都取本次真实绑定，不写虚构标签。原 `request_expectation_source` 会核当前蓝图 revision/身份、ID 是否存在及绑定验收是否被实际预期断言覆盖；旧 revision、不存在的 AC 或只有 characterization 不能满足绑定 AC。蓝图相关内容修订后回同一设计/请求链更新真实绑定，再核受影响断言，不靠改注释或删 FAIL 清账。

新依据需完整设计时沿同一蓝图原位扩充，完成适用质询/准入后才接受 CU；不重置起点、不推倒合法实现。用户固定外框只披露影响，不暗中加重；已有受管 run 的真实用户调整须沿原范围修订核原文及请求关联，保留历史成果/失败，不拆成新 request 清账。用户仅固定小型不排除 UT/testing，真实产品 FAIL 不因排除后续验证变 PASS。

### 已有 run 的真实用户调整

已有受管任务不改成独立 request。用户明确调整本请求后续流程/验证时，沿原 `goal-mode-entry` 领取/恢复或 `goal-runner --resume` 入口，附本次真实用户消息的同一个 `--session-ref` 定位；不把新控制转述替换 manifest.requirement，也不重置原起始 base。在宿主 `framework/harness` 目录，有人在场的原入口例如：

```powershell
npx ts-node scripts/goal-mode-entry.ts --project-root <host> --feature <当前feature> --run-id <原run-id> --adapter <原adapter> --run-mode attended --next --session-ref '<绝对原生transcript>#<本次真实user消息ID>'
```

runtime 从该原件和当前 manifest 的 feature/run_id 自动形成原提案中的 `revision_input.request.user_control: {session_ref, feature, run_id}`，由既有 resolver/writer 追加 `scope_revised`；用户不手填 JSON、不手写事件或免检凭证。新 `--session-ref` 仍实际核原生来源；首次核实的用户原文、哈希和解析指令由机器保留在同一修订输入，历史 reader/恢复沿仓内已接受记录回放，不再要求旧原生文件或旧项目绝对路径仍可用。外部提案自填这些字段不授信；后续普通修订继承本 run 已接受覆盖，普通“继续”没有有效新控制时不改范围。

该入口只把真实用户明确排除、尚未有效完成、且没有真实产品 FAIL 的后续 review/UT/testing 义务标为不适用，**不是验证 PASS**；已完成、有效证据、真实产品失败和历史 CU 均保留。仅指定“按小型”不会自动排除 UT/真机，也不会把既有 CU 改成无 CU 请求。真实目标/验收改变仍沿原设计修正责任，不借控制字段改写原目标、扩写权或清账。

### 兼容显式 request-file

已有手工 request-file 继续通过同一 parser/provider 执行，不因自动入口批量迁移。明确要求使用已有 request 时可沿原命令：

```powershell
npm run check -- --project-root <host> --phase review --request-file doc/requests/review.json --report-dir doc/reports/review-01 --prepare-request
npm run check -- --project-root <host> --phase review --request-file doc/requests/review.json --report-dir doc/reports/review-01
```

显式请求示例（自动调用无需编写）：

```json
{
  "schema_version": "1.0",
  "phase": "review",
  "requested_result": "审查 Repository 查询代码的正确性",
  "targets": {"files": ["src/rdb/Repository.ts"], "tests": []},
  "baseline": {"base": "HEAD", "head": "WORKTREE"},
  "inputs": {"review_report": "doc/reports/review-01/review-report.md"},
  "allowed_test_writes": []
}
```

无 Git 项目省略 base。Git refs 在每次准备时解析为 commit；WORKTREE 绑定实际文件字节。UT/testing 执行时工作树须与所选 head 对应。显式授权的测试文件属于输出，其编写不会改变请求边界，但本轮实际读取/执行内容仍有独立绑定，运行中变动不被重绑为 PASS。

inputs 使用当前 phase catalog 中可从文件读取的输入 ID；code/test_targets 等派生目标通过 targets 指定。testing 的 cases 文件使用既有 adhoc cases 输入格式。review_report 缺省为本目录 review-report.md，缺失不会被 checker 自动补成通过报告。

显式输入可引用已有设计工件；工件自带的真实来源身份只用于 P1 只读验源，不成为本次请求的 Feature 身份，也不执行其阶段或修改其凭证。

## 结果和隔离

prepare 不运行 checker；显式 request-file 路径不创建目录或控制文件，自动路径会在原 reportDir 保存 request/上下文派生件。正常执行复用 active workflow 指定的 checker、规则和 profile，忽略环境中的 Feature/Goal 身份；显式混用 Feature/Goal CLI 参数会失败。UT/testing 在调用 provider 前按实际 `ut.run` / `device_test.run` 声明补齐必要 personal setup；不附带无关 adapter 选择，setup 失败不执行测试。prepare 与 review 不触发这项补齐。request 暂不支持 `--report-reconcile-only`，该组合在 provider 调用前拒绝。

本目录保存 context/facts.md、专业报告、script-report.json、summary.json；summary 明确 subject=request、completion_target=request，并记录请求、基线、目标、输入绑定与真实 evidence 引用。它不是 Feature receipt、attestation 或 completion，不能据此推进 CU/Feature。

report-dir 已有其他请求/基线的机器输出时拒绝复用。目标或来源变化后，Agent 选择另一个明确目录重新准备；不静默覆盖旧结果。路径检查解析真实路径，禁止通过链接写入 Feature 或 framework。Feature 配置解析出的 receipt/report/run 目录即使尚未生成报告也受保护，共享报告根下的独立兄弟目录仍可使用。

## P4/P5 接线合同

hmos 原生 UT 已接入请求入口：targets.tests 指向配置模块中的 ohosTest 文件，按真实 Hypium 类筛选，复用 hvigor→安装→aa test，并核对实际数量与失败/跳过。它只证明所选断言，不自动证明完整 CU 验收。

**落点与载体缺口在准备期就报**：`--prepare-request` 的 `gaps` 除既有缺失路径外，还会给出 `capability:` 前缀的能力缺口——目标不在任何已配置模块的 `src/ohosTest/` 下、目标模块缺 `src/ohosTest/module.json5`（无测试载体）、该 phase 被 profile 关闭、对应 capability 声明为 SKIP。准备期探测只判**模块归属与载体在场**，源码与 describe/it 数量校验仍在执行期（授权写入的测试文件此刻可以还不存在）。新增测试载体或改模块构建配置先核对本次授权：已覆盖就继续，未覆盖才说明改动及原因并取得认可；缺口未解决不执行或宣称通过，不改投其它目录或用其它模块的通过代替。未适配该探测的 provider 不产生此类 gap，现状不变。

**编译与测试经框架执行器**：任何需要编译或跑测试的校验都走纯编译 CLI、专项 request CLI 或正式 `harness-runner --phase`，不裸调 hvigor 或宿主自带脚本——执行器会从 `framework.local.json` 的 DevEco 安装路径派生工具链环境（`DEVECO_SDK_HOME` / JBR），裸调不会执行框架的环境补齐逻辑。确认工具链本身用 `check-personal-setup.ts --json --ensure`。失败诊断按三层证据：① 同次 `hvigor-*.meta.json` 的 `envProbe`（`DEVECO_SDK_HOME` **是否设置**、`DEVECO_SDK_HOME_PATH` 本次实际取值、`JAVA_HOME`；布尔为 true 只说明变量非空——可能来自用户已设的值，不等于框架派生成功）与 `command`/`exitCode`；② 同次构建日志正文（日志头只有命令，不含环境快照）；③ 重新解析出来的值只作辅助且须标为「当前值」，安装目录扫描是第三顺位。**`DEVECO_SDK_HOME_PATH` 是本机绝对路径，仅用于本机诊断，报告对外共享前须脱敏。**

hmos 设备专项须额外提供 `inputs.test_plan`，内容采用既有 Hylyre 派生计划格式，TC 与 cases 一致，每条有明确预期和原生断言。每个用例先执行 steps-file，再用既有 `hylyre ai assert` 验证该行预期；两者的原生 v1 证据共同参与归约。元素出现不等于全部预期已验证，VLM 不可用、manual、skipped 或缺预期证据都不能签发成功。request 仍不支持 report-reconcile-only；零设备对账属于真实 Feature 冻结范围入口。

公共 checker 边界接受 `CheckContext<'feature' | 'request'>`；request 分支没有 feature/FeatureSpec，旧 Feature helper 保持 Feature 默认类型。

review 复用现有章节、问题、计数、引用、负面结论等检查。UT/testing 通过原 profile 的 ut.run / device_test.run capability 查找 `runRequestTests(ctx)`，不新增 provider registry。该导出须列入原 provider metadata.exports，接收明确目标、基线、P1 输入与 reportDir，返回实际 `{executed, total, failed, checks, evidence_paths}`；原生日志/coverage/trace 放本目录或宿主内独立 provider 目录，不能借 Feature 报告。

P6 交付入口与传参/报告闭环，P4/P5 接通专业消费和 hmos 原生 request provider。**未实现该导出的现有 provider 会明确 BLOCKED/FAIL，不能回落到假 Feature 或用未执行结果签发成功。**机械验收包含 Node 实际执行与 hmos provider 接线夹具；不代表 HarmonyOS/真机专项已通过，真实宿主验收仍由 P7 汇总。

## 异常与原生结果复用

checker/provider 意外程序异常按共同 check-execution 分类保留未执行缺口与结论未知；真实输入拒绝、断言失败和外部能力问题保持本来归属，不混称 framework_bug。普通未分类 SKIP 不自动升级。完整交付仍回其 run，不拆 request 绕开义务。

UT/testing 按本次实际目标、模块/用例、构建/测试包、设备/显示、步骤/预期、工具版本与 flags 消费既有 execution-key 和冻结原生证据；等价成功只重算派生报告，输入变化、较新失败、证据不全或 fresh 必须真跑。不能借其他用例/Feature 的成功；selected 断言全部成立才通过。request 只证明本请求，无真实 run/attempt 时不制造同轮身份，也不把独立重发当旧 FAIL 重放；完整交付同次调用的真实 FAIL 继续失败。

显式要求重新执行沿现有 `--force-device`，不增加另一 fresh 协议。UT 成功复用限本 request 的独立 reportDir 与实际新构建测试包、选定类、设备、工具一致且冻结原生证据完整。testing 只读核实际已装包摘要；拿不到摘要只禁复用、仍真实执行，不以缺摘要伪造通过。本批开发接线不证明该装机摘要探测已在真实设备验证。
