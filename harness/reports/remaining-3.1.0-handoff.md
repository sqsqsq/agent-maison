# 3.1.0 剩余开发交接

本文原始全量和P4影响验证对应截至`6e84edc1`的快照；检视后的三处返修与最新验证另列文末，不把旧快照结果冒称当前源码完整全量通过。

本轮在 main、单会话、单工作树完成授权范围内的源码开发和修红，没有派子代理或新建分支。各项源码均经 Claude Code CLI 只读复核；最终复核模型为 claude-opus-5-5，结论没有必修项。

原始官方全量为 **6016 通过 / 24 失败，1350 组，424 个正式扩展组全部执行，输入快照稳定**。24 条原红项均已处理，相关场景修后定向复验通过。原始报告保持 FAIL，没有重跑整轮全量，也没有把补测改写成官方全量通过。

最终日常影响验证：**原始 PASS，101 组实跑 357 通过 / 0 失败，826 组按影响复用；typecheck 通过，首尾输入快照相同。** 两组覆盖采集存在未知调用，按原报告披露；不据此推断未采到的执行覆盖。

## 提交与状态

| 项目 | 提交 | 结果与尚未闭合的条件 |
|---|---|---|
| 前序三份 plan 状态 | c67c3db1 | 只包含 6a2f8c91、58d7a3c2、86c4d5be，已独立复核提交 |
| e2a4145e | 688a9922；1ae7d7ee | 指定原件隔离接续与评审投影已验；原始全量未绿，verify-design-loop 保持 in_progress |
| 7b9c43d2 | 06a531a7；46893cda（历史升级） | 已回退并取消：恢复 jimp ^0.22.12，实际解析0.22.12；baseline保留completed，migrate/consumer均cancelled。audit由29 high回到仅file-type ASF链4 moderate，无zod；历史报告保留。 |
| 4e92a7c6 | 755d6c0e；371a15be | DSH 独立只读视觉与真实桌面调用已验；t3 保持 in_progress，t4 因 H4 未验仍 in_progress |
| P4 9b52d6f0 | fc3eadca | 本批实现与修红、同源/恢复反例已验；t2/t4 完成，t1 开发侧组合回放尚未接通、t3 官方完整绿证明未取得，保持 in_progress；t5/t6 pending |

8f2c6b91 在开工前已由原会话提交为 83038a6b，随后才开始本批实现。根版本一直为 3.1.0。未推送、打包、写入或接续真实宿主、操作手机，未读取/复制凭据。a47 goal、6fd6c8c1、c6ae8b4f 与 temp/ 的既有修改没有由本批改写或提交。

## 已验证

**e2a4145e。** 仅从宿主读取 run 20261104T050636Z-5eb635 原件，在系统临时隔离副本通过 runGoalModeSessionStep 正式接续。i16 后直接给作者全部 9 个 blocker；i172 真实末尾保留余额失败记录，恢复选最近有效 i170 的 12 个 blocker，直接交作者。未接续宿主原 run，4323 个源文件前后哈希相同。原件没有 answer 字段，question 内有具体依据；独立 verification_refs 数组未全部拼进指令，不冒称整个对象原样送达。评审投影实际渲染并覆盖仍未解决、作者改稿、关闭/撤回等情况。大于 64KiB 的真实 Node 进程交回、公共 execute-request 和 scope 收敛例修后均通过。

**Jimp。** 三处生产调用和六组既有造图代码迁到 1.6.1。固定输入的尺寸、采样色、裁剪像素、统计、直方图、分块、边缘、canary 字形布局与拼图像素一致；同版本输出确定。未把跨版本 PNG 字节一致作为契约。开发机及临时消费者为 Node 24.15.0；真实 canary 写出 2944 字节 PNG，worker 读取采到预期红色与 900 个点，非缺包 SKIP。临时消费者仅在 framework/harness 无锁安装；file-type 解析 21.3.4，ASF 告警链消失。

Jimp 审计仍有 29 条 high，来自 Zod [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)，没有宣称安全告警清零。未证明大外部数组到达这些小对象校验路径；没有越域升级 Zod 4、override 或降级 Jimp。未读取/操作真实宿主 Node；若低于 20，应升级运行环境，本批没有加兼容补丁。用户禁止打包，因此同 zip release:verify / consumer lifecycle smoke 未执行，源码副本消费者验收不冒称发布件验收。

**DSH。** 本机实际版本 0.2.2-rc.1。较早 overlay 指向另一模型，最后的视觉 overlay 决定真实请求；公共 pin 的 deepseek-official/deepseek-flash/high 与原生请求头一致。H1 两图 read_image 均 completed，随机图案与真实界面观察正确；同一份真实 stdout 经正式消费入口回放成功，未为消费者字段修复重复付费看图。视觉权限为 read-only/never，实际工具面限定为 glob/grep/read/read_image；开发 H3 仍为 danger-full-access/never，真实只 write，sentinel 未变。

通用 input_provenance 保持 unverified，没有新增通用验读登记或手填 verified。离线 visual-provider 88/88、DSH adapter 9/9。P4 另对准确旧 SID 做了一次真实短续接：未读文件而正确回忆原 nonce，只 write，保留原 SID 与项目 sentinel。Codex/Claude 的 P1 原生证据仅在相关实现/版本前提内复用，不声称当前全部配置组合重新实测。

**P4。** 自含 Node 工程通过公开入口，从空设计/独立质询到合法 CU、作者实现和测试、独立核验、真实 TSC/Node 断言及 CU/原请求正式完成。设计修订成功分支也推进到正式终点。局部 framework 入口抛真实 ENOENT 时，原作者仍修独立 review 缺口；恢复后由真实工具补验并正式完成。它证明开发机制，不代表原 HMOS 宿主或模型设计质量已验。

本批生产变更仅两处：

- goal-phase-runtime 进展调用补上已有 child runId。原路径会对合法已改源码重新做出生依据校验，恢复必停；现复用同一冻结 scope/原请求绑定，不松哈希、授权或完成校验。
- execution-scope 的排序与执行前置只采用既有声明控制/phase proof。真实材料互读仍参与证据失效传播，避免 review 读 UT 材料、UT 读 review 报告形成假控制环；显式控制环仍拒绝，没有新增状态、协议、登记字段、门禁或停机原因。

新增数据环回归修前红、修后绿；真实控制依赖反例通过。七种生产内存变异全部被原反例抓住，源文件未改。D1–D11、K1–K10、M01–M54 的结构去向见 [结构审计](remaining-3.1.0-p4-structure-audit.md)，不是只检查 46 行。architecture 已为开发现状且宿主 pending，overview 保留三层分离、能力拆解和 3.1–3.9 教训。

## 原始 24 条红项定性

每条原始名字、对应修后用例和结果文件见 [验证汇总](remaining-3.1.0-p4-validation.json)。以下编号对应原始 full-failures 数组顺序。全部保留原始 FAIL，未删业务失败反例或放宽生产阈值。

| # | 原始场景 | 定性与最小修复 | 定向复验 |
|---|---|---|---|
| 1 | 9f6c2e41 initial construction births spec and plan with unresolved definitions | 测试前提：scope出生替身只补主CU及直接consumer，漏已有兄弟CU映射；改为按原批准criterion补齐原始gap ID集合，仍走独核与正式发布 | [PASS](remaining-3.1.0-p4-fix-scope-birth-final.json) |
| 2 | 9f6c2e41 initial construction returns an empty executable chain to its scope owner | 测试前提：scope出生替身只补主CU及直接consumer，漏已有兄弟CU映射；改为按原批准criterion补齐原始gap ID集合，仍走独核与正式发布 | [PASS](remaining-3.1.0-p4-fix-scope-birth-final.json) |
| 3 | e2a4145e r4 repair questioning real process retains a final answer over 64KiB | 测试前提：真实进程回放缺模型绑定/原生argv；复用controlledModelBinding并使用受控Codex目录协议与受支持node shim，不改生产预检 | [PASS](remaining-3.1.0-p4-fix-repair-large-r2.json) |
| 4 | e2a4145e r4 initial questioning execute-request-large preserves real completed originals and author delivery | 测试前提：真实进程回放缺模型绑定/原生argv；复用controlledModelBinding并使用受控Codex目录协议与受支持node shim，不改生产预检 | [PASS](remaining-3.1.0-p4-fix-repair-large-r2.json) |
| 5 | e2a4145e r4 initial questioning large-process preserves real completed originals and author delivery | 测试前提：真实进程回放缺模型绑定/原生argv；复用controlledModelBinding并使用受控Codex目录协议与受支持node shim，不改生产预检 | [PASS](remaining-3.1.0-p4-fix-repair-large-r2.json) |
| 6 | e2a4145e initial questioning same-scopes uses real signed feedback author and independent recheck | 测试前提：旧例无实际改稿却强求新Q；作者真实补原scope业务说明再复核，同scope暂停与缩小scope进展断言保留 | [PASS](remaining-3.1.0-p4-fix-q-scope.json) |
| 7 | e2a4145e initial questioning smaller-scopes uses real signed feedback author and independent recheck | 测试前提：旧例无实际改稿却强求新Q；作者真实补原scope业务说明再复核，同scope暂停与缩小scope进展断言保留 | [PASS](remaining-3.1.0-p4-fix-q-smaller.json) |
| 8 | 395 阶段内 OOBE：真实检查归因和 summary 接回原门，等待解除先补 UT；超时不进 testing | 测试时间窗：1秒窗口在实测1.6秒调度成本后即超时；仅测试窗口改15秒，恢复/超时强反例保留 | [PASS](remaining-3.1.0-p4-fix-OOBE.json) |
| 9 | 8d4e6a21 连续回放：旧控制依赖 + 正式 provider override/rebase 保留原业务证据 → 新 provider review 完整恢复 | 测试前提：旧视觉pin仅模型值，缺provider与配置来源；补明确受控路由和公开配置，保留原证据/rebase/缺失反例 | [PASS](remaining-3.1.0-p4-fix-provider-rebase.json) |
| 10 | 8d4e6a21 连续回放：旧控制依赖 + 正式 provider override/rebase + genuine-source-change 实际责任恢复 → 新 provider review 完整恢复 | 测试前提：旧视觉pin仅模型值，缺provider与配置来源；补明确受控路由和公开配置，保留原证据/rebase/缺失反例 | [PASS](remaining-3.1.0-p4-fix-provider-rebase.json) |
| 11 | 8d4e6a21 连续回放：旧控制依赖 + 正式 provider override/rebase 保留原业务证据 → 新 provider review 缺原始证据恢复反例 | 测试前提：旧视觉pin仅模型值，缺provider与配置来源；补明确受控路由和公开配置，保留原证据/rebase/缺失反例 | [PASS](remaining-3.1.0-p4-fix-provider-rebase.json) |
| 12 | P1 R3 execute recovery preserves real settled failure and completion-cleanup facts instead of trusting raw terminal text | 测试前提：旧直接/公共执行夹具缺冻结模型或只读Codex exec参数；补真实受控进程前提，保留失败、完成清理、中断和授权强断言 | [PASS](remaining-3.1.0-p4-fix-handoff-r2.json) |
| 13 | P1 R2 real request CLI executes once and exposes the same running facts before owner-bound interruption | 测试前提：旧直接/公共执行夹具缺冻结模型或只读Codex exec参数；补真实受控进程前提，保留失败、完成清理、中断和授权强断言 | [PASS](remaining-3.1.0-p4-fix-handoff-r2.json) |
| 14 | 1804 a bound gate survives interruption and resumes without another accepted author invocation | 测试前提纠正：故障钩子在harness_end提交前，before.returned=false；改为未提交检查须补一次且作者不重放。已绑定原生gate阳性仍由全量session-slow-gate通过保留 | [PASS](remaining-3.1.0-p4-fix-bound-gate-final.json) |
| 15 | P3 native executor preserves the actual canary tool deadline without reviving a default author phase deadline | 测试前提：旧直接/公共执行夹具缺冻结模型或只读Codex exec参数；补真实受控进程前提，保留失败、完成清理、中断和授权强断言 | [PASS](remaining-3.1.0-p4-fix-canary-final.json) |
| 16 | P1 detached executor: old phase timeout is not an author deadline and invocation output stays truthful | 测试结构断言：executor补元数据会复制plan对象；改核argv/cwd/模型绑定实际转发，不要求对象引用恒等 | [PASS](remaining-3.1.0-p4-fix-phase-plan.json) |
| 17 | RC-4 verifier subject：时钟漂移不换代，业务内容变化必须换代 | 测试结构断言：合法同业务正文的核验/闭合代不等于业务换代；保留两个时钟整份material一致与真实业务单变量换代强断言 | [PASS](remaining-3.1.0-p4-fix-RC4.json) |
| 18 | RC-8c plan 增量小节缺失：原始 FAIL 仍在，plan 通过、进披露清单，链继续推进（A7） | 测试结构断言：raw FAIL还含已披露searches_min；要求目标原FAIL保留且所有原FAIL都有共同披露依据，不改阈值 | [PASS](remaining-3.1.0-p4-fix-RC8c.json) |
| 19 | RC-8d plan 增量小节为空：原始 FAIL 仍在，plan 通过、进披露清单，链继续推进（A7） | 测试结构断言：raw FAIL还含已披露searches_min；要求目标原FAIL保留且所有原FAIL都有共同披露依据，不改阈值 | [PASS](remaining-3.1.0-p4-fix-RC8d.json) |
| 20 | S6 排除内容已被实现 / 排除元素已写进产品 | 测试替身：旧冷阶段writer未按真实单元准入准备研究/保基线；复用authorHooks，实际读取新增目标；独核仅响应实际请求。S7有据拒修只写原决定账本，不重写已正确acceptance | [PASS](remaining-3.1.0-p4-fix-S6-final-r2.json) |
| 21 | S7 非关键描述冲突 / 冲突 A（屏 id 当元素 id） | 测试替身：旧冷阶段writer未按真实单元准入准备研究/保基线；复用authorHooks，实际读取新增目标；独核仅响应实际请求。S7有据拒修只写原决定账本，不重写已正确acceptance | [PASS](remaining-3.1.0-p4-fix-S7-final-r3.json) |
| 22 | S7 非关键描述冲突 / 冲突 B（F1 优先级，作者材料原有） | 测试替身：旧冷阶段writer未按真实单元准入准备研究/保基线；复用authorHooks，实际读取新增目标；独核仅响应实际请求。S7有据拒修只写原决定账本，不重写已正确acceptance | [PASS](remaining-3.1.0-p4-fix-S7-final-r3.json) |
| 23 | S11 真实产品回归 / 回退后修好 | 测试替身：旧冷阶段writer未按真实单元准入准备研究/保基线；复用authorHooks，实际读取新增目标；独核仅响应实际请求。S7有据拒修只写原决定账本，不重写已正确acceptance | [PASS](remaining-3.1.0-p4-fix-S11-final-r2.json) |
| 24 | design-authority-repair: S16-c3f 已完成质询对当前必需scope给合法blocker：保留完整材料，拒绝降低验收的草稿且不发布 | 测试结构断言：共同内核须把首轮完整否定交回原作者；A,Q,A,Q有限收敛，第二作者提示核原否定，canonical不降验收/不发布断言保留 | [PASS](remaining-3.1.0-p4-fix-S16-c3f.json) |

另外，生产依赖环来自 S6 失败保全的只读评估，已以原工作流 SHA 核对和最小回归复现后修复；修后引出的 repair-dependencies 旧排序断言由 Claude 一次指出，保留重开/历史失效强断言后整组 10/10。测试 helper 曾漏 import，已由 typecheck 拦截、补齐后通过；这些中间失败没有计为项目验证通过。

## f15ef449 留下的 27 条旧红

“本轮自然通过”只描述本轮同名正式场景，不反推旧运行的底层根因；suite-runtime 伴生项随对应原场景对照，没有冒充独立产品缺陷。F31 原测试实际无已提交 gate handback，已纠正为一次补检反例；真正的已绑定原生 gate 复用阳性由 F32/session-slow-gate 本轮通过保留。

| 旧编号 | 原记录分类 / 场景 | 本轮原始全量 | 结论 |
|---|---|---|---|
| F03 | scope-cycle / 179a73 CR-001 real runner repairs original fixture bytes, preserves facts and raw FAIL through independent refutation; real UT adopts unchanged assertions and rejects missing or stale adoption | PASS | 本轮自然通过，不反推旧根因 |
| F07 | initial-q-process / P2 review R1 process initial Q reuses only actual unchanged invocation originals across a new runtime | PASS | 本轮自然通过，不反推旧根因 |
| F29 | session-running-observation / P1 R2 real request CLI executes once and exposes the same running facts before owner-bound interruption | FAIL | 旧直接/公共执行夹具缺冻结模型或只读Codex exec参数；补真实受控进程前提，保留失败、完成清理、中断和授权强断言；[修后 PASS](remaining-3.1.0-p4-fix-handoff-r2.json) |
| F30 | session-pid-identity / 1804 real gate ignores a reused live PID without killing it and actually runs its next gate | PASS | 本轮自然通过，不反推旧根因 |
| F31 | session-bound-gate-reuse / 1804 a bound gate survives interruption and resumes without another accepted author invocation | FAIL | 故障钩子在harness_end提交前，before.returned=false；改为未提交检查须补一次且作者不重放。已绑定原生gate阳性仍由全量session-slow-gate通过保留；[修后 PASS](remaining-3.1.0-p4-fix-bound-gate-final.json) |
| F32 | session-slow-gate / 1804 original CLI slow gate survives external reporter kill without overlapping gates, author replay or duplicate final completion | PASS | 本轮自然通过，不反推旧根因 |
| F40 | scope-cycle / real-chain 正例：spec→testing 六阶段真实 harness 全链 PASS + closed | PASS | 本轮自然通过，不反推旧根因 |
| F41 | scope-cycle / RC-1 plan 起步：待创建预测不拖垮绑定，未实现的预测位置只披露 | PASS | 本轮自然通过，不反推旧根因 |
| F42 | scope-cycle / <suite-runtime> | PASS | 本轮自然通过，不反推旧根因 |
| F43 | scope-cycle / RC-3 UT 在链上真写测试：coding 不 stale；上游源码带施工归属且豁免只给 coding | PASS | 本轮自然通过，不反推旧根因 |
| F44 | subject-extra-generation / RC-4 verifier subject：时钟漂移不换代，业务内容变化必须换代 | FAIL | 合法同业务正文的核验/闭合代不等于业务换代；保留两个时钟整份material一致与真实业务单变量换代强断言；[修后 PASS](remaining-3.1.0-p4-fix-RC4.json) |
| F45 | scope-cycle / RC-8c plan 增量小节缺失：原始 FAIL 仍在，plan 通过、进披露清单，链继续推进（A7） | FAIL | raw FAIL还含已披露searches_min；要求目标原FAIL保留且所有原FAIL都有共同披露依据，不改阈值；[修后 PASS](remaining-3.1.0-p4-fix-RC8c.json) |
| F46 | scope-cycle / <suite-runtime> | FAIL | raw FAIL还含已披露searches_min；要求目标原FAIL保留且所有原FAIL都有共同披露依据，不改阈值；[修后 PASS](remaining-3.1.0-p4-fix-RC8c.json) |
| F47 | scope-cycle / RC-8d plan 增量小节为空：原始 FAIL 仍在，plan 通过、进披露清单，链继续推进（A7） | FAIL | raw FAIL还含已披露searches_min；要求目标原FAIL保留且所有原FAIL都有共同披露依据，不改阈值；[修后 PASS](remaining-3.1.0-p4-fix-RC8d.json) |
| F48 | scope-cycle / <suite-runtime> | FAIL | raw FAIL还含已披露searches_min；要求目标原FAIL保留且所有原FAIL都有共同披露依据，不改阈值；[修后 PASS](remaining-3.1.0-p4-fix-RC8d.json) |
| F49 | scope-cycle / RC-9 testing 回退 coding：review/ut 重验、再进 testing（coding 承接 ut 本 run 产出的测试文件） | PASS | 本轮自然通过，不反推旧根因 |
| F50 | scope-cycle / <suite-runtime> | PASS | 本轮自然通过，不反推旧根因 |
| F51 | scope-cycle / RC-9b ut 产品断言失败回退 coding：诊断 verifier 签发、coding 次轮 PASS、ut 重验 | PASS | 本轮自然通过，不反推旧根因 |
| F52 | scope-cycle / <suite-runtime> | PASS | 本轮自然通过，不反推旧根因 |
| F53 | scope-cycle / RC-13 UT audit上游缺口：实际产物读取、逐条核实、责任coding修复与原UT正式复验 | PASS | 本轮自然通过，不反推旧根因 |
| F54 | scope-cycle / <suite-runtime> | PASS | 本轮自然通过，不反推旧根因 |
| F55 | rc12-timeout / <suite-worker> | PASS | 本轮自然通过，不反推旧根因 |
| F63 | reliability-completion / S6 排除内容已被实现 / 排除元素已写进产品 | FAIL | 旧冷阶段writer未按真实单元准入准备研究/保基线；复用authorHooks，实际读取新增目标；独核仅响应实际请求。S7有据拒修只写原决定账本，不重写已正确acceptance；[修后 PASS](remaining-3.1.0-p4-fix-S6-final-r2.json) |
| F64 | reliability-completion / S7 非关键描述冲突 / 冲突 A（屏 id 当元素 id） | FAIL | 旧冷阶段writer未按真实单元准入准备研究/保基线；复用authorHooks，实际读取新增目标；独核仅响应实际请求。S7有据拒修只写原决定账本，不重写已正确acceptance；[修后 PASS](remaining-3.1.0-p4-fix-S7-final-r3.json) |
| F65 | reliability-completion / S7 非关键描述冲突 / 冲突 B（F1 优先级，作者材料原有） | FAIL | 旧冷阶段writer未按真实单元准入准备研究/保基线；复用authorHooks，实际读取新增目标；独核仅响应实际请求。S7有据拒修只写原决定账本，不重写已正确acceptance；[修后 PASS](remaining-3.1.0-p4-fix-S7-final-r3.json) |
| F66 | reliability-completion / S11 真实产品回归 / 回退后修好 | FAIL | 旧冷阶段writer未按真实单元准入准备研究/保基线；复用authorHooks，实际读取新增目标；独核仅响应实际请求。S7有据拒修只写原决定账本，不重写已正确acceptance；[修后 PASS](remaining-3.1.0-p4-fix-S11-final-r2.json) |
| F67 | design-q-repeat / design-authority-repair: S16-c3f 已完成质询对当前必需scope给合法blocker：保留完整材料，拒绝降低验收的草稿且不发布 | FAIL | 共同内核须把首轮完整否定交回原作者；A,Q,A,Q有限收敛，第二作者提示核原否定，canonical不降验收/不发布断言保留；[修后 PASS](remaining-3.1.0-p4-fix-S16-c3f.json) |

standalone-coding-review 本轮正式全量所有组自然通过，没有复现偶发红；未凭猜测改生产逻辑。最终日常验证也按当前影响计划包含相关组。

## 源码复核与仓库检查

实际调用均为 Claude Code CLI：--model opus --effort high --permission-mode plan --tools Read,Grep,Glob --allowedTools Read,Grep,Glob；禁用 hooks/MCP、无会话持久化。返回实际模型均为 claude-opus-5-5。首轮源码通过；全量修红后的窄复核指出一条旧断言必修；返修后只核既有意见/直接回归，最终通过、没有必修。

OpenSpec strict 65/65 与 Enforcement 已通过；plan 默认校验、diff 与本批文本 LF 检查：全部通过；最终源码与最后一次影响验证的哈希一致，三份受保护用户文件哈希未变。

正式全量原件保留在本机 harness/reports/remaining-3.1.0-p4-full.json（约 134 MB）和 full.log（约 56 MB），不把大过程日志放进提交。准确命令、起止 UTC、退出码、输入稳定性、正式组覆盖和原件 SHA-256 见验证汇总。

## 未验证与留给用户的事

1. 打候选包，并在同一 zip 上补 Jimp 的 release:verify / consumer lifecycle smoke、干净安装读写和实际宿主 Node 核对。本轮没有打包或晋升，未生成最终源码完整官方全量绿证明，正式晋升继续受现有门禁约束。
2. P4 t5：干净发布件宿主 bc-openCard-2，从原需求和四张参考图到所有适用 CU/原请求真实交付，执行实际 HMOS 构建、UT、设备与视觉。
3. P4 t6：按真实覆盖联合收口旧 plan/a47 等义务并比较同口径效率；不重开已完成 t8，总 goal 未关闭。
4. DSH H4 凭据前后哈希：本轮禁止读取，未验。需用户自行核对、另行授权或明确免验，t4 未闭合。图片数量/上下文上限与真实读图失败样本也未验证。
5. P4 t1 仍是开发侧工作：把已保全 a21473 的真实需求、蓝图、质询和工程输入，与 6fe679 的框架故障形状放到同一隔离工程，经公开入口接到施工和正式终点。当前分别证明 a21473 到分解、自含工程到完成，尚未把二者接起来；保留 in_progress。定稿 plan 不要求先取得 6fe679 完整原件链，无需用户补采宿主才能继续开发回放。

已记录的范围外边界：同版本热修同时影响多个 producer 时，首个检查和核验交接可能消耗显式继续机会，后续未知检查仍等待；本批只验证单个入口恢复，没有新增跨交接状态。最小演进方向是沿既有 producer/请求记录承接真实继续条件，避免另建门禁/状态机。DSH pin 缺 reasoning_effort 而原生默认 high 时会被既有身份观察器拒绝；需按原前台模型来源补齐真实设置，不放松身份比对。Jimp/Zod 残留跟随上游兼容修复处理。

另记录检视发现的既有Jimp并发问题：tile-min多个worker共用按格子坐标命名的临时PNG，可能出现`Could not find MIME for Buffer`并回退全局直方图，影响局部相似度评分。与依赖升级独立；后续最小修法是在每次调用内隔离临时文件或改内存解码，保留失败处理并加同图并行回归，本次不扩大迁移修复范围。

为遵守“全量通过后才改 completed”的当次要求，三项收口 todo 与 P4 t3 没有用补测拼成原始全量绿证明；相关状态据实保留。源码实现、24 条原红处理和本轮可执行的复核验证已经完成。

## 检视返修（2026-11-06）

三项意见均确认并返修：初始化复用既有视觉路由选择与冻结后保存完整ProviderRef；DSH末尾结构化JSON记录提前截断即不采信上一条final；初始设计每项否定将完整verification_refs交给原作者。未放宽模型身份校验、未新增协议/状态/门禁。

视觉整组修前87/2，修后89/0，包含init落盘→重读→无人值守调用预检、坏路由不写盘、提前截断及已成功读图后截断。e2定向14/14；两个既有副本的副本正式接续，9项/99条与12项/168条依据逐项数组完整、缺失0，仍只交作者i17/i173，无新质询，历史和复制来源字节不变，未重新读取宿主。

P4 t1等待理由已纠正：下一步为开发侧把a21473真实输入与6fe679故障形状接成同一隔离组合，当前未完成，不要求先找用户补采完整原件。单入口恢复的通过不覆盖双producer热修后UT仍等待的边界。t5/t6、H4、候选包同zip消费者及最终完整绿证明继续保留。

最新test:changed与Claude Code CLI只读复核：原始PASS，5082通过/0失败、876组实跑、51组复用，typecheck通过、首尾输入快照相同；Claude实际模型claude-opus-5-5，三条必须修复及P4口径纠正均通过，无新增必修。OpenSpec strict65/65与Enforcement、plan、diff/LF通过。CLI源码复核没有亲核89/14的测试数字，数字由原始JSON逐项核对；详见[本轮验证](remaining-3.1.0-review-validation.json)。未重复正式全量或打包。

返修实现提交：DSH初始化与终稿 8249ce54；e2否定依据送达 db1ff1c8。本次只读复核、定向与影响验证原件随交接更正单独入库。

本轮影响报告仍有覆盖采集未知组，已保留在验证汇总和原始JSON；这些是调用覆盖观测缺口，不是测试失败，不据此推断未观测调用已被覆盖。

## Jimp回退与取消（2026-11-07）

7b9c43d2已回退并取消：只撤06a531a7中10个代码/测试文件的Jimp升级差异，保留后续修复和全部历史报告。harness依赖恢复为^0.22.12，npm install实际解析0.22.12，依赖树无zod；audit从29 high（zod同一公告重复计数）回到仅file-type ASF链4 moderate，0 high。此前关于Jimp1.6.1及29 high的段落为历史结论，以本条现状为准，升级专属consumer义务已取消，不解除后续候选包的常规验证。

baseline保持completed，migrate/consumer改为cancelled；plan名称及正文不改。tile-min并发临时文件问题独立保留。本次不推送、不打包、不改版本，锁文件不提交。等上游 Jimp 改用 zod ≥4.6.6 后再议。

回退验证：test:changed原始PASS，927组实跑5380通过/0失败，typecheck通过、首尾输入快照一致，未额外跑test:daily或正式全量。13类指定目标均已选中，另补4个实际改造图的testing-integrity扩展用例，4/4通过。Claude Code CLI只读复核实际模型claude-opus-5-5，代码及记账无必须修复项；其当时等待测试完成的条件现已满足。plan、diff与本批文本LF检查通过。
