# P4 t5 首跑诊断与框架返修

宿主仅只读核查：`D:/1.code/SimulatedWalletForHmos`。父 run 为 `bc-openCard-2/20261108T101421Z-d5a320`，子 run 为 `cu-card-storage/20261108T115921Z-2f8034`。框架起点 `2e72e6d2`；包内生产源码对应 `e54bffd0`。本记录不代表宿主 t5 验收完成。

## 根因与原件

| 问题 | 定性及依据 | 本批处理 |
| --- | --- | --- |
| 存储 CU 被要求实现兄弟 UI | 框架把设计依赖闭包补进 `design_refs`，投影又把这些引用的 acceptance/contracts/use_cases 整体继承。共享契约、反向场景及消费者关系使存储 CU 获得整个开卡流程的义务。这是闭包上下文与交付选择的职责混用。 | 全部依赖仍校验；自动补全不选择携带交付内容的依赖目标。作者显式选择的目标仍完整继承，不按 touches/predicate/验收编号删条目，不静默改旧 CU。 |
| 为什么三轮作者没有修好 | 三轮受管作者都指出兄弟 CU 越界并拒绝代做，在最终回复保留具体依据。主循环只派持续实现作者和检查工具；`review_report_exists` 缺口没有接到独立报告 writer，作者正确拒绝自审后仍收到同类反馈。原请求提示也未直接呈现子 CU 冻结目标。 | 在原 `GoalPhaseRuntime` 内调用现有 verifier 角色，仅授予审查报告写权；先核当前报告是否仍需修复，交回后只重跑受影响检查。给作者/独核呈现冻结目标，独核读取原作者输出或 session handback，并沿现有问题核验及设计 owner 路径处理归属冲突。 |
| UT 缺 run 身份 / schema mismatch | 最新 UT 报告生成于 `14:28:31.708Z`，没有 run_id；父/子事件均无相应受管调用。最后受管 UT 在 `14:03:41.150Z` 返回 facts stale。不能定性为 runtime 丢身份。无身份入口拒绝本身正确，但拒绝后仍写正式报告，覆盖了旧 run 的证据，是确定性框架缺陷。 | 权威选择拒绝后直接输出原诊断退出，不进入 capability 解析或写 Feature 正式报告；避免覆盖以及派生第二条 schema mismatch。 |
| coding FAIL 后 UT/testing、恢复反复检查 | 首轮 coding 的编译为 PASS，红项是被误继承的 UI/协调器及待独核测试依据；同轮存储 UT 后来有真实 22/22 证据。不能把任意 coding FAIL 重新变成固定阶段总闸。38 次正式检查中既有源码/输入真实变化，也有 scope revision 后输入字节未变的重验。 | 保留按现有义务、输入和证明决定检查；修正“同条件不重跑”被记成 `halted/executor_waiting` 的错误分类。跳过结果不再抢在其它可执行返修前停机；真实超时、能力等待、无正式原件仍保持等待。只有原完成评估能评价的事实才判无进展，缺可比原件不能冒称已证明无进展。 |

时间归属须保真：三个受管作者的 `phase_write_observed` 没有那 7 个 UI/协调器文件。首次停机后、13:40 恢复前出现 27 项输入变化；14:32 恢复前又有 `List.test.ets`、`CardCatalogRepository.ets`、`card_open_flow_ut.test.ets` 等变化。不能把这些字节归给 i2/i3，也不能把恢复后的所有重验都称为无效重跑。最新 facts stale 对应未在这些受管作者前后像中交付的变化，本批不放宽 facts 校验。

只读 Claude 诊断第一轮确认范围混用及伪外部等待，实际模型 `claude-opus-5-5`，只开放 Read/Grep/Glob，permission_denials 为 []。其“i2/i3 写了 UI”和“List.test.ets 此后未变”的判断被事件及输入快照反证，已撤回；其按 touches 裁闭包遍历的方案未采用，因为 touches 是预测切片，完整共享依赖与独立交付选择不能再混用。最终实现保留依赖检查和显式整体继承。

## 隔离回放与接续判断

`remaining-3.1.0-p4-t5-replay.cjs` 只读取 11 份宿主业务原件，在无个人配置的独立目录调用生产闭包/投影函数，对照提交 `2e72e6d2` 的原实现。保全的拆分作者脚本明确以 touches 节点与 `contract:card-open-persist` 为根；同一根输入，旧版自动补到 41 个引用，新版为 26 个，7 个兄弟 UI/协调器文件不再被自动选择。原 canonical CU 显式 41 项原样保留；缺少的本 CU 验收不伪造。该回放是生产投影反例，不冒充完整宿主执行、模型判断或设备验收。

父 run 的设计修复 rev2 正式发布与独立质询 pass 原件仍在，当前 CU 所绑蓝图 SHA 与 canonical 原件相同。**应优先接原父 run，保留约 1 小时 45 分钟的设计成果；不应从初始设计重跑。** 但不能承诺装上修复包后对原子 run 原样 `--resume` 即可完成：旧 CU 已经显式承接污染后的引用，本次修复不会偷偷删除它们，`dev-phone-nav` 等共享承载自身也仍需设计 owner 按原冻结目标核对。

新发布件集成后，沿现有独立核验 → 原设计 owner → CU 内容修订/指针调和 → 受影响施工恢复路径，正式纠正存储与兄弟单元的内容归属。若修订使旧子 run 冻结身份或 required 义务不再合法，使用现有后继机制承接该 CU；父 run 和有效设计成果保留。已有 UI 字节的实际写入者、授权和归属须据原件由设计/施工责任方核实，不能按本报告自动删除或回滚。

对照投影实际少了 14 个文件，7 项只是本次重点反例；其中还包括冻结目标明确需要的 `WalletMain/src/main/ets/index.ets` 初始化桥。设计 owner 必须显式选择或拆分该桥的承载目标，不能把“未被自动选择”当成“不用交付”。完整前后名单在 evidence JSON 的 `beforeFiles/afterFiles`。

## 只读复核边界

代码复核第二轮 PASS，实际模型 `claude-opus-5-5`，Read/Grep/Glob，permission_denials=[]；其关于初始化桥的交接说明与作者提示的职责标注已补充。双运输测试证明真实独立角色与单报告写权，不把请求 SID 断言夸大为真实模型会话测试。

定向真实 session 入口随后检出共同观察的漏点：checker 的恢复比较未含其验收的阶段产物，报告补好仍可能再派 writer。现从原 phase manifest 同时消费业务输入与产物，仍排除原运行时文件；不另建清单。另将报告自身从 writer 的输入比较中分离，复用原调用的写入事实识别已经交回的业务字节。跨调用只排除原 writer 的精确 summary/script-report/evidence-manifest/receipt 发布路径；图像、trace、嵌套同名报告与其它实际依据仍保留。调用期间的完整前后像和写保护不变。反例证明：仅改无效报告字节不重派，同一报告引用的真实新依据出现后仍能唤起；没有新增配额、状态或门禁。

R4 legacy/typed 反例还纠正了第一轮关于停机原因的建议：不能把无法评价的旧原件缺口统称 `no_progress_guard`。该建议已撤回，继续由原完成评估区分等待与可证明的无进展。第三轮只读复核针对上述窄返修及直接回归，回执见 validation JSON。

第三轮指出真实工具还会重写带时间戳的 merged-report/ai-prompt；已直接消费正式 summary 的原发布指针，限定同一 reports 根目录的精确路径，不另维护遗漏清单。反例改为每轮调用生产 `generateMergedReport`，无新依据仍 2 次 writer、有真实嵌套新依据 3 次后自然停放。最终整组 48/0，第四轮只读复核 PASS，无必修项，实际模型仍为 `claude-opus-5-5`。

## 验证记录

一次 `npm run test:changed -- --workers 4`：**5092/3**，891 组选中项全部执行、50 组按影响复用、425 个正式扩展组未执行，输入首尾稳定，80.01 分钟。原始 FAIL JSON/log/plan 保留，补红没有被拼成一次官方全绿。覆盖观测有 39 组未知，作为观测缺口披露。保全 a21473 的组合恢复组 **4/0**，含原正式终点，用时 79.33 分钟。

| 红项/补充反例 | 定性与最小修复 | 修后验证 |
| --- | --- | --- |
| daily-design-journey：框架入口故障与业务修复并存 | 旧夹具仅接受作者补审查；改为独立 writer，仍验证 actor 不改 framework、工具恢复后同 CU 完成。实入口继而揭示的阶段产物观察漏点已修复。 | 同名定向 1/0，真实入口约 8 分钟 |
| verification-gap：mixed execution gap | 用 review 报告冒充产品的测试假设不成立；改为实际产品文件，先经真实范围准备取得源码授权，源码变化只补一次受影响 UT。原框架缺口仍等待。 | 同名定向 1/0，全组 19/0 |
| execution-scope：D1 coding-only runless | 旧断言要求拒绝落正式报告；改为退出 1、原指导完整、无报告污染，并验证补回候选可在同 root 冻结。 | 同名定向 1/0 |
| 补充 R4 legacy/typed 证据分类 | 正式 legacy 反例检出错误的无进展分类；撤回该分类改动，原完成评估仍为唯一真源。 | 原组 45/1，受影响 legacy 与 typed 定向 2/0 |
| 独立 writer 的重复改写与新依据 | 原机器汇总被算作新产品变化；按原写入记录与精确发布路径区分，不削弱写保护。 | 两种运输的报告补齐通过；无新依据/真实新依据两个收敛分支通过 |

其余定向：CU progression 98/0、component-assets 49/0、blueprint projection 41/0、原 P2 恢复 6/0、goal-phase-runtime 全组 48/0。最终源码的窄返修、命令和哈希详见 `remaining-3.1.0-p4-t5-validation.json`。未重复整轮 changed、daily 或官方全量；最终正式发版全量仍由 `release:all` 产出。

完整宿主接续与设备行为留在 t5，t5/t6 保持 pending。未打包、推送、改版本、写宿主或操作手机；a47/6fd6c8c1/c6ae8b4f 和 `temp/` 保持不动。
