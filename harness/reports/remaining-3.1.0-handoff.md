# 3.1.0 剩余开发交接

当前状态（2026-11-08，本轮e54bffd0完整全量）：官方一次实跑1365组、全部425个正式扩展组，6060通过/1失败，输入稳定。唯一session-slow-gate测试时限问题已局部修复、同名组定向1/0；typecheck及OpenSpec strict通过。原始FAIL保留，不自动开第二轮全量；P4 t3、e2 verify、DSH t3继续in_progress，t5/t6 pending。详见文末本轮记录。

本文原始全量和P4影响验证对应截至`6e84edc1`的快照；检视后的三处返修与最新验证另列文末，不把旧快照结果冒称当前源码完整全量通过。

本轮在 main、单会话、单工作树完成授权范围内的源码开发和修红，没有派子代理或新建分支。各项源码均经 Claude Code CLI 只读复核；最终复核模型为 claude-opus-5-5，结论没有必修项。

原始官方全量为 **6016 通过 / 24 失败，1350 组，424 个正式扩展组全部执行，输入快照稳定**。24 条原红项均已处理，相关场景修后定向复验通过。原始报告保持 FAIL，没有重跑整轮全量，也没有把补测改写成官方全量通过。

最终日常影响验证：**原始 PASS，101 组实跑 357 通过 / 0 失败，826 组按影响复用；typecheck 通过，首尾输入快照相同。** 两组覆盖采集存在未知调用，按原报告披露；不据此推断未采到的执行覆盖。

## 提交与状态

| 项目 | 提交 | 结果与尚未闭合的条件 |
|---|---|---|
| 前序三份 plan 状态 | c67c3db1 | 只包含 6a2f8c91、58d7a3c2、86c4d5be，已独立复核提交 |
| e2a4145e | 688a9922；1ae7d7ee；db1ff1c8（依据送达返修） | 指定原件隔离接续与评审投影已验；原始全量未绿，verify-design-loop 保持 in_progress |
| 7b9c43d2 | 06a531a7；46893cda（历史升级）；e26b5c2a（回退） | 已回退并取消：恢复 jimp ^0.22.12，实际解析0.22.12；baseline保留completed，migrate/consumer均cancelled。audit由29 high回到仅file-type ASF链4 moderate，无zod；历史报告保留。 |
| 4e92a7c6 | 755d6c0e；371a15be；8249ce54（初始化/终稿返修） | DSH 独立只读视觉与真实桌面调用已验；t3 保持 in_progress，t4 因 H4 未验仍 in_progress |
| P4 9b52d6f0 | fc3eadca；265540f6（t1）；本轮t3返修与记录同提交 | t1 已完成同一隔离工程的真实输入组合与正式终点；t2/t4 完成。t3 官方最终源码全量绿证明尚未取得，保持 in_progress；t5/t6 pending。详见文末本轮记录。 |

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

1. 打候选包，并在同一 zip 上执行常规 release:verify / consumer lifecycle smoke、干净安装读写和实际宿主 Node 核对。Jimp 升级专属 consumer 义务已随回退取消。本轮没有打包或晋升，未生成最终源码完整官方全量绿证明，正式晋升继续受现有门禁约束。
2. P4 t5：干净发布件宿主 bc-openCard-2，从原需求和四张参考图到所有适用 CU/原请求真实交付，执行实际 HMOS 构建、UT、设备与视觉。
3. P4 t6：按真实覆盖联合收口旧 plan/a47 等义务并比较同口径效率；不重开已完成 t8，总 goal 未关闭。
4. DSH H4 凭据前后哈希：本轮禁止读取，未验。需用户自行核对、另行授权或明确免验，t4 未闭合。图片数量/上下文上限与真实读图失败样本也未验证。

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

## P4 t1 组合收口（2026-11-07）

t1已完成开发侧组合，不再等待用户补采。已保全a21473真实需求、四图、原蓝图和质询在同一隔离工程经公开入口接通设计、施工及正式终点；采用6fe679的framework入口故障形状，不声称拥有或复演其完整现场。原run `20261029T005400Z-a21473` 正式COMPLETED，单一CU的实际TSC与11项Node/SQLite测试0失败0跳过，六方法均有真实harness_end及PASS。原7项AC全部字段、19项质询、需求字节及原历史前缀不变。

知识缺口已在生产中派给对应decision.owner，沿既有designRepair执行“原资产writer→P1 knowledge_refs→独立Q/发布→design preparation重绑CU→重跑closure”。没有预埋术语、没有在未收到知识缺口时主动补引用；原catalog/glossary保全到真正派发才改。后台写界、只读Q、资产差额和正面结论复用已接通；失败事务结束判定按用户要求与runtime activeAttempt一致，新知识事务重新归档真实原件。coverage_rows[110/111]中文标识的编码在生产构造器完成，原中文触发和映射、schema均未放宽。

framework等待期间，真实UT错误仍交作者修复；入口恢复后同child补验并终结，业务作者始终两次。其后知识发布改变绑定，生产按原有successor_of创建一个同CU、同需求、同delivery_origin的后继；后继一次作者只刷新当前施工、研究和计划输入，产品/测试字节从接续到最终终点保持相同。最终scope保留原必需种类及device/unit、AC-1至AC-7和BD-1/BD-2，unknown/unresolved为0；不把“出生队列”“完成义务链”“实际六方法”混算。

验收摘要见[组合证据](remaining-3.1.0-p4-a21473-acceptance.json)、[验证汇总](remaining-3.1.0-p4-a21473-validation.json)及[实际只读复核](remaining-3.1.0-p4-a21473-reviews.json)；大原件留本机，摘要记录路径和SHA-256。单组合原始PASS 1/0；之后的一次test:changed实跑937组、5394/1、输入首尾稳定、typecheck通过。唯一红是评审夹具只记蓝图前像而未记知识资产；只补实际文件哈希后，整个受影响套件62/0，同名用例通过。原始5394/1仍为FAIL，没有用补测改写原报告；修后输入差异仅该夹具，15个生产入口无漂移。完整组合在该轮四个用例全通过。覆盖读取有39组未知，作为观测缺口披露，不据此推断未观测调用已被覆盖。

本轮新增红项与返修定性如下；旧官方全量24条的逐项表及原FAIL继续保留。

| 触发 | 定性 | 最小修复与验证 |
|---|---|---|
| run内延后义务修改源码后仍拿出生输入校验；无run研究又被误放宽 | 生产缺陷/返修直接回归 | 已校验run身份的required执行来源取当前源码；无run仍冻结，原4f反例保持 |
| 纯P0计划报告缺P1行 | 生产缺陷 | 非空报告完整统计，无该优先级为NA；空报告仍FAIL，21条定向 |
| testing返回后才提交设备原件，预绑定哈希缺失 | 生产缺陷 | 按真实proposal精确JSON字节预绑定；缺失/篡改仍FAIL，32条定向及组合 |
| 自然语言验收步骤被当作文件证据 | 生产缺陷 | 保留原文，仅明确file#check作直接证据；typed CU映射不降级，正反例及组合 |
| 中文生命周期触发派生ID不符schema | 生产缺陷 | 仅生产生成ID编码，中文语义/映射不变；生产回归与正式closure |
| 知识缺口owner为unassigned且终点直接外部等待 | 生产缺陷 | 对应decision.owner，接回既有修复派发；实际handback恰好一次 |
| 后台writer误判越界；Q看不到资产差额或复用旧正面结果 | 生产缺陷/检视返修 | 精确modified写界、原字节归档、Q差额/哈希、Q只读；16条定向含正反例 |
| 失败非知识事务占着新知识事务原件 | 生产缺陷/用户指定并入 | 同signature结束语义与runtime一致，保留原no_progress/reconcile例外；同run新原件反例 |
| 自动生成index使业务Q失效 | 返修直接回归 | 正面Q与五类业务writer共源；index仍呈现依赖差额，index-only/glossary-only反例 |
| 合法后继被全局作者次数断言挡住 | 测试假设过严 | 原run框架恢复上限不变；仅一个有据后继，输入刷新、义务保全及产品字节守卫 |
| 后继沿用旧研究run、施工引用和派生计划时间 | 测试替身职责遗漏 | 按当前canonical真实重投影并重派计划输入；不手写报告/trace/PASS，不改freshness门禁 |
| 完成义务链被当作所有已执行方法 | 测试错误指标 | 生产完成链原样消费，六方法用同run真实收据+PASS独立证明；缺方法/收据反例 |
| 本轮test:changed唯一红：质询关闭缺资产前像 | 测试夹具问题 | 真实资产字节哈希入快照，脏/缺项/legacy反例不变；受影响整套62/0 |

前述多次探测和r3–r7红项均保留失败定性，未作为通过证据；最后单组合与影响验证里的完整组合实际通过。所有必修返修均经Claude Code CLI只读复核，实际模型claude-opus-5-5；没有未解决必修。

本轮只关闭t1。t3仍in_progress，最终源码官方完整全量绿证明尚无；t5干净发布件宿主交付、t6联合收口保持pending。原生.ets编译、真机、布局/像素、真实模型质量、同入口同时坏掉coding/UT的恢复边界、DSH H4及同zip消费者验证未因此变成通过。Jimp tile-min并发临时文件问题仍独立保留。本轮不推送、不打包、不改版本、不操作宿主或手机、不读取凭据，也不改写或提交三份用户既有修改与temp/。

## 2026-11-08：P4 t3 官方全量、9条红项与最终影响验证

本轮全程单会话、单工作树、main。仅一次官方全量：1361组实跑、原424个正式扩展组全部执行、0组复用，6045通过/9失败、退出1，输入首尾稳定，用时197.23分钟。保留原始FAIL及原件SHA-256。修后仅补受影响组，并跑本轮test:changed；没有把分散补测拼成最终源码官方全量绿证明。

最终test:changed原始PASS：599组实跑2360/0，341组按影响复用，typecheck通过、输入首尾相同，用时91.70分钟。完整组合所在组4/0，长组合90.03分钟；根请求实际COMPLETED，原施工child和知识修订后的合法后继也到各自正式施工终点。仍仅证明隔离机制与真实TSC/Node等已覆盖工具，不扩称HMOS原生.ets、真机或真实模型交付质量已验。

| 原始红项 | 定性与根因 | 本轮最小修复、实际验证 |
|---|---|---|
| a21473组合 `<suite-worker>` | 测试预算：90分钟到期时仍有真实阶段进展 | 仅此单例复用既有120分钟suite预算；最终同组4/0，长例90.03分钟 |
| M2公开暂停/强制继续 | 生产回归：失败事务新建时重置未发布候选，冻结材料漏实际否定 | 保同canonical基线且经原Q审过的候选、完整反馈入冻结材料；M2/M3定向2/0 |
| M3未发布架构层 | 同一生产回归，并丢CU/架构候选与Q比较基线 | 从既有原件重建历史，不新增持久状态；M2/M3定向2/0 |
| bounded session replay | 同一生产回归；修后另有旧“一个attempted”断言 | 按失败结束语义断言两个独立原件事务，保部分成果/不重用A1/Q1；同名1/0 |
| P1 R2 CLI一次执行/中断 | 测试时序：native在三个冷CLI动作前后30秒自行退出 | 受控native活到实际中断；等真实绑定，保原有看门狗；整组29/0 |
| session-slow-gate原生中断 | 测试时序：固定30秒早于真实gate进入 | 等实际gate enter与harness绑定，原看门狗兜底；同名1/0 |
| lifecycle current completion | 测试客户端：同步selfcheck阻断续租，原60秒租约到期 | 异步execFile并按生产20秒续原60秒租约；不放宽生产校验，同名1/0 |
| S16-c3f合法否定/不降验收 | 同一生产回归：首轮否定后没有有效第二作者/Q | 共同设计修复接回原件与实际反馈；c3f/c8定向2/0，仍保A,Q,A,Q和canonical不发布 |
| S16-c8外部canonical改动 | 测试夹具：每轮Q都再次注入外部写入，持续制造新条件 | 单次写入后替身作者明确waiting，核原事务拒绝发布/外部字节不被覆盖；c3f/c8 2/0；不作为实际作者完成证明 |

27条旧红的当前官方结果：24通过、F29/F32/F67三条复红（已在上表处理），0条未匹配；前次24条原红按定稿映射22通过/2复红。旧报告继续保留历史结论，以本次逐条映射和定向结果更新现状，不反推未复现的历史根因。

复核另修本批候选保留的P1授权回归：Q返回后像不能充当调用前原件。复用既有pre_snapshot/post_snapshot明确包含蓝图/CU/架构/批候选/知识资产；重入先消费原写归因，辅助候选与签名前像逐项匹配，原B1范围校验保留。真实签名session反例1/0：拒绝Q改CU，原Q无效，后续授权事务回canonical、只发一个新作者，不发布污染内容。日常边界19/0，含3条新的越权反例及失败非知识→知识新原件反例；省掉Q快照绑定或原B1范围的两个内存变异均使对应反例变红，源码未被变异改写。

实际Claude Code CLI用`--model opus --effort high --permission-mode plan --tools Read,Grep,Glob --allowedTools Read,Grep,Glob`及禁hooks/空MCP设置只读复核3轮，实际模型均claude-opus-5-5，权限拒绝记录均为空；r1/r2必修已修，r3 PASS的签名会话及M2/M3前提也已实测满足。完整调用、结论和原件哈希见[复核记录](remaining-3.1.0-p4-t3-reviews.json)，原始/定向/影响数字、原件与逐条映射见[本轮验证汇总](remaining-3.1.0-p4-t3-validation.json)。

本批新增3个日常组和1个正式组，当前清单940日常/425正式；对照原937/424，没有删除组或日常/正式串scope。新增正式组已定向通过，但本轮官方原始回执仍是初始424组的FAIL。OpenSpec strict 65/0，plan/diff/LF通过；D1–D11、K1–K10、M01–M54去向表按现状复核，utils重导出桥保留而顶层旧CLI已删，未恢复第二条执行路径。原官方覆盖观测55组、最终影响40组未知，均是观测缺口，不据此宣称完整调用覆盖。

**仍未完成：** 最终源码官方完整绿证明（本轮遵守“只重跑受影响组”，未再整轮全测，t3保持in_progress）；e2/DSH依赖该绿证明的收口todo；DSH H4、候选包同zip消费者验收、原生.ets/真机/真实模型质量、同入口同时影响coding/UT的恢复边界。t5/t6仍pending。后续由用户安排候选包、P4 t5干净宿主及t6联合收口；不再把t1列为等待补采。Jimp已回退取消，tile-min独立并发问题未动。

未推送、打包、改版本或操作真实宿主/手机，未读取/复制凭据；三份用户既有修改及temp/未改写、未提交。仅验收摘要加入提交；本机临时探测文件的批量删除被自动审批拒绝（工具仅返回blocked by policy），本轮跳过清理，忽略目录内的过程文件保留且不提交。

## 2026-11-08：e54bffd0 官方全量与唯一红项

本轮受测main为e54bffd0，测试期间没有源码修改。只执行一次官方`npm test -- --workers 4`，1365/1365组实跑、全部425个正式扩展组执行、0组复用：**6060通过/1失败，原始FAIL、退出1，输入首尾稳定，用时375.18分钟**。原JSON/log/plan与精确版本、时间及SHA-256留在本机；汇总见[验证记录](remaining-3.1.0-p4-t3-validation.json)的latestOfficialFull。本次不是最终源码官方全量绿证明，前轮6016/24、6045/9及各次补测仍为历史记录，不互相改写。

| 原始红项 | 定性、后果与最小修法 | 修后验证 |
|---|---|---|
| session-slow-gate / 1804 original CLI slow gate survives external reporter kill without overlapping gates, author replay or duplicate final completion | 测试夹具90秒CLI时限不足：恢复--next会连续跑coding/review/UT真实检查；原件三族已返回、租约有效，CLI随后被ETIMEDOUT/SIGTERM截断。仅把私有run()的spawnSync时限复用现有TEST_RUN_TIMEOUT_MS（与外层单次调用看门狗同源），生产代码/时限/协议/授权均不改，原业务强断言不变。 | 原同名正式集成组1/0；真实编译/Node测试、无原生gate重叠、作者调用及接受报告均一次、完成原件恰一次等断言全部保留并通过。 |

本轮唯一代码差异是测试文件两行（导入现有常量、替换90秒字面量）；私有helper只有该正式组使用，没有改变注册、分类或测试选择范围。按当次“修后只补受影响组”定向执行，不再次运行全量或日常全集。原全量原件保持FAIL，补测不被写成全量通过。typecheck、OpenSpec strict 65/0及plan/diff/LF按本轮材料核验；实际Claude Code CLI只读复核另见[复核记录](remaining-3.1.0-p4-t3-reviews.json)的本轮追加。

P4 t3、e2 verify-design-loop、DSH t3均仍in_progress；DSH t4/H4未因此完成，P4 t5/t6保持pending，t1仍completed且不等待用户补采。后续正式全量绿证明、候选包同zip消费者、干净宿主t5和联合t6仍未完成；原生.ets/真机/真实模型交付质量、同入口影响coding/UT的恢复边界与独立Jimp tile-min问题仍按既有披露保留。官方覆盖观测53组未知，属于观测缺口，不据此推断未观测调用已覆盖。

三份用户既有修改和temp/未改写、未提交；未打包、推送、改版本、操作真实宿主或手机，未读取/复制凭据。本轮只保留全量及唯一受影响组、必要校验/复核原件和简要汇总，没有重试上轮被自动审批拒绝的批量清理。

本批最终只读复核PASS（Claude Code CLI，实际claude-opus-5-5，无必修）；原完整恢复语义断言全部保留。plan、diff/LF及保护文件哈希核对通过。代价仅为测试真的卡死时按既有45分钟单次调用看门狗失败，生产时限未变。


## 2026-11-08：P4 t5 首跑诊断与框架返修

当前状态以plan frontmatter为准：2e72e6d2已按用户裁决将P4 t3、e2 verify-design-loop、DSH t3记为completed，前述in_progress记载是历史状态；原全量FAIL不改写。DSH H4及P4 t5/t6未因此完成。

本批只读核查父run d5a320与存储子run 2f8034，修复了CU依赖闭包与交付选择混用、被拒的无身份调用覆盖正式报告、缺少独立review报告writer、同条件检查误成外部等待，以及报告恢复/机器发布被错误比较成新工作的问题。全程仍由同一GoalPhaseRuntime调度，未新增状态、协议或门禁。三次受管作者实际拒绝越界；UI新增不归因于这三次调用。14:28无身份UT报告与受管14:03调用分开定性。

一次test:changed原始结果5092/3，891组全部执行、50组复用、输入稳定；425正式组未在该轮执行。三条原红各定向修复通过；补充旧原件分类反例恢复2/0。最终运行时整组48/0（含真实时间戳机器报告、无进展与新证据两分支）、混合验证缺口组19/0。保全a21473组合4/0到正式终点；typecheck、OpenSpec strict65/0、plan/diff/LF通过，Claude Code CLI最终只读PASS（实际claude-opus-5-5）。原FAIL保留，不拼成整轮全绿；未重复changed/daily/官方全量。覆盖观测39组未知，如实披露。

优先复用原父run与rev2设计成果；新包集成后由原设计owner经正式CU修订纠正范围，特别补齐初始化桥的显式承载，再沿原恢复/必要的子run后继继续。已有来源未明的UI字节不擅自删除或回滚。宿主实际接续与效果仍由用户在t5验收，t6随后联合收口；本批未打包、推送、改版本、写宿主或操作手机。

详情：[首跑诊断](remaining-3.1.0-p4-t5-diagnosis.md) · [验证与复核记录](remaining-3.1.0-p4-t5-validation.json) · [保全原件投影证据](remaining-3.1.0-p4-t5-evidence.json)。

## 2026-11-09：对齐72b6f0d9的后续返修

独立审查写手使用既有共同进展比较，往复失败可续暂停；负责人从实际产物和既有角色读取。design_refs改为纯作者交付选择，全部依赖仍检查，接受/修订/修复发布不再补写依赖。原选择与归属污染需经原设计/CU修订，不静默改存量数据。

官方默认12并发全量原始结果6046/21（1366组，全部425正式扩展组，输入稳定），FAIL原件保留。21条失败逐条定性为旧测试语义并定向修正通过，未重跑全量、未拼造全量绿；生产代码在全量后未变。最终test:changed完整执行941组，5399/0、输入稳定，含隔离组合回放正式终点。全量/changed覆盖观测未知分别53/39组。Claude Code CLI生产和测试只读复核PASS，实际claude-opus-5-5。

非knowledge组装自动派回本批仅评估，未交付；原knowledge分支仍需补跨发布事务的共同进展判断，不能据此宣称A10全部完成。宿主未操作，原父run及有效设计成果优先保留；新发布件集成后的正式CU修订与实际接续仍待用户t5验收，t6随后联合收口。本次未打包、推送或改版本，t5/t6保持pending。

逐项红项定性、真实复核调用和验证原件见 [本批报告](remaining-3.1.0-goal-alignment.md) 与 [验证记录](remaining-3.1.0-goal-alignment-validation.json)。

## 2026-11-09：7080620a 的 CU 显式认领返修

采用整批显式认领方案。设计接受、内容修订、readiness、原设计修复与 P3 共用蓝图/source 义务生成，缺少关系/决定/契约等 owner 时在设计期交回作者；不自动补 design_refs，不让依赖将来新增交付内容后被继承。每个 owner 的 Feature design mapping/coverage 仍须真实成立。前轮 R01 接受删除最后关系 owner 的断言不正确，本批恢复必要反例并修复生产缺口，历史测试结论不改写。零 CU 需求修复保留先发布再拆分的路径；未发布候选同时使用本事务蓝图与 DSL，正式施工仍用已发布事实。

本轮 test:changed 默认12并发，1011/1011组实跑（含118正式组）、5213通过/2失败、输入稳定；50组复用、309其它正式组未执行，观测未知44组。a21473真实输入+6fe679故障形状组合4/0到正式终点。两条原红均为测试侧：RC-10替身遗漏已有决定认领及其施工映射，N1恢复CLI的90秒测试时限不足；修后同名定向各1/0。RC-10首次补测在明确发现映射缺口后中止，日志保留，最终完整补测另有回执。未重复全量或日常全集，不把补测拼成整轮全绿；生产与发布指引在整轮之后未变。

typecheck、OpenSpec strict65/0、plan、diff/LF通过。Claude Code CLI只读复核，实际claude-opus-5-5，生产r3与测试r4/r5均PASS；无必修遗留。P4 t5/t6保持pending，宿主和手机未操作，未打包、推送或改版本；三份用户修改与temp/保留。

详情：[本批说明及红项表](remaining-3.1.0-cu-ownership.md) · [验证与真实复核记录](remaining-3.1.0-cu-ownership-validation.json)。
