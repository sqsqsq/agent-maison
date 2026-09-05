# Framework 3.0.0 发布说明

**发布日期**：2026-09-03
**对比基线**：Framework 2.3.0（`framework-2.3.0.zip`）
**发布件**：`dist/framework-3.0.0.zip`（SHA256 见同批产出的 `dist/framework-3.0.0.manifest.json`；包内 `RELEASE-MANIFEST.json` 记录对应 `source_commit`）
**适用读者**：接入本 Framework 的工程负责人、AI Agent 使用者、Framework 维护者

> 本文档位于 **AgentMaison 开发仓**（dev-only，不进 zip）。更早版本见 [`RELEASE-NOTES-v2.3.0.md`](RELEASE-NOTES-v2.3.0.md)、[`RELEASE-NOTES-v2.2.0.md`](RELEASE-NOTES-v2.2.0.md)。

> **关于 2.4.0**：该版本**从未发布**，其开发窗口的成果并入本版一次性交付。因此本文以 **2.3.0** 为基线，且按 **2.3.0 → 3.0.0 的净差**组织——2.4.0 窗口做过、但随后在 3.0.0 窗口内被删除或取代的机制，**不作为现有能力介绍**（逐条见下方「§ 中途出现又被删除的机制」）。开发侧的逐窗口流水见 [`MAINTAINER-CHANGELOG.md`](MAINTAINER-CHANGELOG.md)。

---

## 这份文档是写给谁的？

**Framework 3.0.0** 是 2.3.0 之后**两个开发窗口**（2.4.0 窗口 33 个 plan + 3.0.0 窗口 72 个 plan，合计 **105 个 plan**）的一次性交付，也是一次 **major** 演进。主题一句话：

> **把「谁说通过」换成「机器事实证明通过」，并让无人值守链路在没有人签字的情况下自己走完。**

2.3 首创 Goal 模式，让一条需求能全自动跑通 spec→testing。之后这两个窗口做的是同一件事的两半：

- **前半**（2.4.0 窗口）——让自动化**可信**：以 OCR 文本信号承重的视觉保真飞轮、无人值守生存性根治、路径全链路治理；
- **后半**（3.0.0 窗口）——把路走到底：**删掉所有能让人或 agent 签字放行的通道**，同时补上删掉之后系统必须自己具备的恢复能力。

净结果是六条主线：

- **人签质量通行证整体退役**：`confirmed_by` / `human_confirmed` / `visual-confirm` 等全部不再影响 verdict、phase 推进或完成判定；停等点改由机器事实重投影为「回哪个阶段修」；
- **Goal 运行时归一**：interactive 与 detached 收敛为同一个 `GoalPhaseRuntime`，配合 run 出生契约、基线冻结与所有权 fencing；无人值守从「能跑」变成「能自己活下来并如实收场」；
- **视觉保真成链**：OCR 文本信号 → 运行时布局树几何 oracle → 盲档视觉委托与 critic 闭环；同时做了一次**减法**，撤销强制 UI kit；
- **Skill 契约化 + assess 调和循环**：phase 合格性变成 `contract.yaml` 声明的机器契约，`next.json` 是从证据重算的投影而非可编辑状态；
- **反假 PASS 证据体系**：负面裁决阻断闭环、上游裁决门、closure attestation、verifier 证据身份绑定——绿灯不再能被下游继承或被重跑洗白；
- **framework 运行时与宿主 Git/hash 解耦**：per-file integrity 家族整体退场，写权限改由执行环境授予。

---

## 2.3.0 → 3.0.0：一句话变化

| | Framework 2.3.0 | Framework 3.0.0 |
|---|-----------------|-------------------|
| **质量放行** | 门禁部分放行依赖 agent 自填字段 | **签名通道整体删除**；只认机器证据，停等点重投影为责任阶段回修 |
| **无人值守停摆** | 过夜任务可静默死亡却显示「运行中」 | **存活自校验 + 逃生阀 + 全阶段自动恢复**，据实回退重修或诚实终止 |
| **Goal 执行路径** | 单一 headless 编排，attended 与 detached 逐步分叉 | **单一 `GoalPhaseRuntime`**，仅 executor transport 不同；run-control epoch + 所有权 fencing |
| **run 基线** | 依赖 `HARNESS_DIFF_BASE_REF` 环境变量 | 出生冻结 `manifest.run_base_sha`（write-once），换基线须运行时外显式 `--supersede --rebaseline-to` |
| **UI 还原度** | agent 自报「视觉已对齐」，无确定性抓手 | **OCR 文本信号 + 运行时布局树几何 oracle** 的确定性门禁与回修闭环 |
| **视觉判定新鲜度** | 判定可跨构建复用，旧结论蒙混 | 判定绑定**截图 hash + 安装包指纹**，构建变更即失效重验 |
| **phase 合格性** | 散在脚本与 prompt 约定 | `skills/feature/<skill>/contract.yaml` 声明的结构化 inputs/capabilities/produces/checks |
| **深度/档位** | 深度裁剪（`depth` 家族） | **`assurance` + `capability_resolutions`**（summary 1.3），能力裁剪取代深度裁剪 |
| **verifier** | 每阶段必跑的仪式，投递 `ai-prompt.md` 全文；结论由 SubagentStop hook 发布 | **按能力启用二态**（disabled/enabled）+ **短 request JSON** 投递；报告由**调用方**写出，hook 整体删除 |
| **上游绿灯** | 下游不校验上游裁决 | **`upstream_verdict_gate`**：上游非 PASS / blocker 未清 / 证据 stale → 下游 BLOCKER |
| **testing 证据** | 信 trace 的「通过」字符串 | **Hylyre StepResult v1 三轴**（execution/verification/evidence）逐步对账 |
| **测试执行责任** | 派生器可自行 skip 用例 | 顶层 TC 必须声明 **`execution_channel`**；派生器无 skip 决策权；`manual` 永久 fail-closed |
| **产品组件形态** | 框架不介入 | 中途曾下发强制 UI kit，**已整体撤销**——产品组件归属唯一归宿主 |
| **framework 完整性** | per-file sha256 漂移判 BLOCKER + 宿主 Git 身份裁决 | **integrity 家族退场**；写权限由执行环境授予，宿主是不是 Git 仓完全无关 |
| **自定义 `features_dir`** | harness 读、agent 写多处硬编码 `doc/features` | **读写路径 + prompt + gitignore 全链路**随配置 |
| **adapter** | claude / cursor / codex / generic | 增 **chrys**、**opencode**、**codeagent**；Windows CLI 选择改为按 PATH 真值解析 |

---

## 大项改动

### 1. 人签质量通行证退役与全阶段自动恢复（3.0.0 最大主线）

**以前的问题**
2.3 之后曾沿着「防伪」方向加固过一轮：把验真签名拆位、要求 drift 放行必须真人签字。但那条路堵的是**伪造签名**，没有堵住**签名这个机制本身**——`confirmed_by`、`human_confirmed`、`p0_skip_waiver`、`visual-confirm` 等十余种 confirmation receipt 仍然能把 FAIL 变成放行。无人值守链路一旦撞上这些点就只能 halt 等人；宿主实测出现过整夜停在「等待人工确认」，而机器事实早已足够判断。

**3.0.0 的做法**
把整套终审链删掉，并补上删掉之后必须具备的能力：

- 旧 confirmation receipt **只读可审计，不再影响任何裁决**；新 writer 不再生成，不要求宿主回改历史产物；
- 旧 `AWAITING_HUMAN_REVIEW` run 恢复时**按当前机器事实重投影**——责任阶段 repair、`DEFERRED_CAPABILITY_MISSING`、optional advisory 或明确诊断；**不能通过补签或 resume 把 FAIL 改成 PASS**；
- `confirmed_by_user` 一类普通选择字段改名中性 `selection_status` / `selection_source`：菜单仍是合法的 attended UX，但不是质量凭证；
- P0 device flow 的 runtime fidelity 改由 hash-bound 的逐 step 运行时观测证明；crop/bbox 改由 source/bbox/tool/hash 确定性复算。

配套的生存能力（其中一半来自 2.4.0 窗口、在本窗口被继续加固）：宿主无关的存活语义与启动后自校验、liveness beacon、supervisor auto-resume、声明式 launch-liveness-wakeup、Job 团灭与孤儿治理、resume 真源收编、Stop hook 逃生阀、超时与 API 断流的正确分类（`transient_api_error` 不再误判 no_progress）。过夜任务的失败模式从「静默死亡显示运行中」「静默等人」变成「据实回退重修或诚实终止」。

### 1b. 写边界从归属门禁改为归因诊断（plan 1741b6f2）

**以前的问题**
3.0.0 新增的 phase 写边界把三件事绑成一步：发现文件变了、判断谁改的、决定 run 能否继续。后两步不可靠。`inventory.yaml` 按定义只描述 skill 叙事产物（明确排除 harness 派生报告），却被拿来审判整个 feature 目录——于是 harness 自己写的 `visual-debt.json` / `visual-debt.md`、`revalidation.json` 与各阶段 `notes.md` 全部解析不到 owner，被判 `phase_write_owner_unresolved` 并终结 run。宿主 2026-09-04 的 spec 阶段就是这样在 verdict=PASS、blockers 空、20 个 logo 裁剪坐标全部冻结完成的情况下停掉的。补文件名排除名单堵不住：阶段 SKILL 要求 agent 在自己进程内跑 `harness-runner.ts`，harness 的写入必然落在归因窗口内。

**3.0.0 的做法**
写边界降为它本来就做得到的事——归因，不是裁决：

- 归属信息不足（未登记 / 多归属 / 边界解析失败 / 前后快照失败）一律降为诊断事件，run 继续，事实完整留痕；
- 跨阶段写入按既有路径角色分流：命中 inventory 登记的 **artifact 域**（需求 / 验收 / 契约）时，作废本轮证据并自动回 owner 重验的行为**完全不变**；只匹配到产品源码或阶段工作区的，交给本就在判它的 checker；
- 删除源码漂移的第二、第三次裁决——写归因跑在 gate 之前，它和 goal 外层重判合起来让 §「漂移分级」的 WARN 永远走不到；completion 侧的 clean-pass 收集器同样不再把已分级的漂移记成阻断项（否则各阶段全过仍收在 PARTIAL、无完成凭证）。基线缺失仍是阻断项：那是没有证据；
- testing 作为链上最后一个阶段时，「未复核」经本轮 summary 的 readiness signal `post_review_source_drift_unreviewed` 如实披露。

**放弃了什么**：未登记路径与产品源码域的跨阶段写入不再即时阻断，改为留痕加由 checker 稍后裁决，失去一部分早期发现能力。真实编译、测试、验收失败与范围越界的处理一律不变。

### 2. Goal 运行时归一（出生契约 · 单一调和循环 · 契约引用闭包）

三条根因各对应一个里程碑，由总纲 plan 统一验收：

**结构事实被实现成行为义务** → **run 出生契约**：新 run 必须同时具备 `manifest.json` 与唯一 `run_created`；manifest-only / 重复 / 损坏出生事件判 `CREATION_INCOMPLETE`，不可 resume/attach/接管，也不占用同 feature 的 successor 位置。含 `coding`/`ut` 的链在出生时冻结 `manifest.run_base_sha`（write-once，同 run 不可 override/rebase），goal 门禁不再活读 `HARNESS_DIFF_BASE_REF`。

**执行路径与安全语义分叉** → **阶段运行时统一**：attended 的 in-session driver 与 detached 的 runner 循环合并为唯一 `GoalPhaseRuntime`，它独占 `assess → authorize → one phase → gate` 的转换写入。新增 `run-control.json`（单调 epoch + process/session owner）与原子 handoff mailbox：所有权变化后旧 owner 的一切写入被 fencing 拒绝；**不要删除或重置 `run-control.json` 来「解锁」**。

**契约引用无闭包** → **plan closure 引用闭包**：contracts 中 schema 声明的文件字段全部必须属于规范化后的顶层 `contracts.files`——它是唯一授权集合，文件已存在、与 spec asset 字节相同或由生成器产出都不自动获得授权。同批把 navigation 收敛为唯一 `config_files`，删除零消费者的 `registration_points`。

### 3. 视觉保真：从 OCR 飞轮到几何 oracle 与盲档委托

**破局点（2.4.0 窗口奠定）**：像素统计度量在真机上分不开「忠实还原 vs 崩坏」，唯一能确定性分离二者的信号是**文本**——关键文案在不在、在哪。于是引入 `chi_sim.traineddata`（Tesseract 简体中文模型），把「视觉是否还原」从分不开的像素度量转成可判定的文本信号，并建成一条闭环：

```
  ① coding 产出 UI + 素材物化      →  烤字门禁（OCR 读素材图）先拦一层
  ② device-testing 装真机 · 截图   →  OCR 读中文文案，与 ui-spec 声明对照
  ③ 确定性发现问题                 →  锚点缺失 / 文本越界 / bbox 错位 / 素材未真渲染 → 落 must_fix
  ④ 回到 coding 按 must_fix 修码
  ⑤ 重装真机（新安装包指纹）重测    →  判定绑定截图 hash + 安装包指纹，旧判定失效 → 回到 ②
```

判定新鲜度绑定构建这一条是让「重测」真的重验：改了代码不重装、或重装了吃旧判定，都会被安装包指纹戳穿。OCR 不可用（tesseract.js 未装 / chi_sim 未物化 / 图损坏）一律优雅降级，不假装有信号。

**3.0.0 窗口在此之上加了三层**：

- **运行时布局树几何 oracle**：把「自报度量」换成从运行时布局树算出的确定性几何事实，配合 VL critic 闭环（结构化发现 + 熔断账本 + 回执生产 + 静稳采样 + 校准回灌）；
- **盲档视觉委托**：盲模型宿主不再靠自报，而是与**只读视觉 provider** 协作——provider 只出证据不写状态，ledger 保持单写者（agent 自跑 harness 写 journal proposal，runner 重放收编）；
- **视觉机制减法**：剪除证明账本、策略降级与自锁判死三套机制——`vision/artifact-attestations.jsonl`、`policy-downgrades.jsonl` 及其 hash-chain / supersede / HWM 全部退出运行时，**升级宿主无需迁移或清理**。

**强制 UI kit 整体撤销（Breaking）**：宿主实测证明 framework 把一套具体 ArkUI 组件实现升级成了强制产品契约，对守规 agent 结构性不可满足（不 scaffold 判「未物化」、scaffold 判「越界」）。**产品组件归属唯一归宿主**：删除 `profiles/hmos-app/ui-kit/**`、kit 目标目录配置、ui-spec 的 `block` 字段与全部 `ui_kit_*` check；selector 契约回归裸 ui-spec 节点 id；盲档结构地板改由「ui-spec P0 节点 → visual-parity → contracts.components → contracts.files」这条**产品组件所有权链**承接，且不受 `visual_parity_enforcement` 降级。

### 4. Skill 契约化、assess 调和循环与能力裁剪

- **Skill contract 成为运行时输入**：结构化 inputs / capabilities / produces / checks 由 `skills/feature/<skill>/contract.yaml` 声明；
- **`next.json` 是投影**：`assess@1` 从 summary / closure / evidence / goal 指纹重算 gap 与唯一 recommendation，**不要写脚本直接编辑**；
- **能力裁剪取代深度裁剪（Breaking）**：`summary.depth`、`quality_depth`、`missing_optional_inputs`、`minimum_depth_by_phase` 删除，改为 `assurance` + `capability_resolutions` + contract fingerprint。`minimum_assurance` 只影响 `assess@1` 的 `insufficient_assurance`，**不能放宽 quality axes、phase closure 或 release**；
- **verifier 能力化（Breaking）**：二态 disabled / enabled。`disabled` 是**缺席即为零**——不生成 prompt/request，闭环也不要求 verifier 证据，磁盘上的旧文件永远不会重新激活已关闭的能力。投递协议改为**短 request JSON**（旧规则投递 177KB 级 `ai-prompt.md` 全文，往返有损且零校验）。subject 按实际审查材料寻址，关环走 `--sync-closure`；
- **verifier 报告即真源（Breaking，plan d2f7a9c4）**：机器真源改为 `verifier.report.<subject>.md`，由**派发 verifier 的 agent** 把回复原样写入 `summary.verifier_report`。SubagentStop hook、canonical JSON、结论指纹、conflict 状态机、bedside 旁路、adapter 的 `verifier_capability` 矩阵与 `blocked` 态整体删除；报告不再进 evidence manifest 与 closure attestation 哈希。三种运行模式判定一致——此前 hook 在 goal/headless 一律不发布，让无人值守 run 永远闭不了环；
- **framework 轻量化重构**：lite / balanced / full 三档工作流与验证收敛，档位决定哪些 phase 保留 verifier 与哪些检查生效。

### 5. 反假 PASS 证据体系

来自 bc-openCard 两轮宿主事故（无头链绿灯放行严重残次品、盲宿主线框级 UI 全绿交付「达标可发布」）的根治：

- **负面产品裁决阻断闭环**：review 结论「不通过」/ testing 结论「不达标」→ 该 phase BLOCKER FAIL；
- **上游裁决门**：下游 phase 启动即消费上游 summary 机器裁决，verdict 非 PASS / blocker 未清 / 证据 stale → BLOCKER；
- **review closure attestation**：review 之后任何产品源码变更（含 contracts 未登记的新文件）→ testing FAIL，回跑 review 重审；
- **summary schema 演进**：`report_validity`（报告合法性，独立于产品裁决）+ `quality_axes`（functional/visual/asset/evidence 四轴，harness 派生而非 agent 自报）+ `release_readiness` / `completion_status` 投影；
- **verifier 证据身份绑定**：subject 指纹与 JSON 真源收编，跨 attempt / 跨 run 的互洽回执不能为本次终签；
- **完成语义收口**：成功侧不再产出裸 `COMPLETED`，改为 `CHAIN_SLICE_COMPLETED`（仅链切片语义）与 `DEFERRED_CAPABILITY_MISSING`；feature 级完成只认 `verify-feature-completion`；
- **修复环裁决化**：候选真伪裁决、收敛不变式与增量修复环——同指纹候选重复出现走既有 no-progress / backtrack 预算熔断，不再无限空转。

### 6. testing 证据消费收编（Hylyre StepResult 唯一真源）

- **Hylyre 改为源码树 vendor**：`.whl` 退役，schema 2 双兼容，发布件按 LF 字节逐文件 sha256 冻结；
- **StepResult v1 三轴**：`execution` / `verification` / `evidence` 分立，P0 语义门从「计划形态 × case 状态字符串」改为**计划要求 × StepResult 逐步对账**（required/forbidden element 均需映射到 role=assertion 且 status=passed 的步骤）；
- **`execution_channel`（Breaking）**：顶层 `test-plan.md` 每条 TC 必须声明唯一执行通道（`hylyre` | `visual` | `manual` | `provider:<capability-id>`）。派生器不再有 skip 决策权，编译失败即 FAIL；**`manual` 表示「该测试义务当前没有机器证据载体」，会持续留在分母，任一 manual TC 都让本 feature testing 无法 PASS**（冻结设计）；
- **selector 恢复开放世界语义**：feature ui-spec 只建模新增页面，既有入口天然缺席，故 ui-spec miss 只给 provenance WARN，最终合法性由本轮真机 StepResult 的 candidate_count 裁决；静态 BLOCKER 收窄为可确定错误；
- **失败归因两级路由**：已执行 case 的 failed 消费机器 `failure.domain`/`failure.code`；**未执行且无机器原因的 explicit skip 保持 testing FAIL、零自动 coding 归因**（不再从 TC 名称或报告散文推断责任）。

### 7. framework 运行时与宿主 Git / hash 解耦

原先发布件随包下发 `RELEASE-MANIFEST.json`，harness 启动时逐文件 sha256 比对、漂移判 BLOCKER，随后又为保护这个检查本身长出 sidecar 自校验与 Git 身份裁决。**它不是安全边界**——manifest 与被校验文件同处一个可写目录，同一主体能一并修改；范围还被推到最大（一份不参与运行的 vendor 交接文档就能让整机 BLOCKER）。

3.0.0 改为**把写权限从宿主身份拿走**：

- host consumer task 对 framework 控制面**物理只读**，只有用户或 CI 显式启动的 updater 在升级窗口内临时可写；
- 无法强隔离时只保留**合作式编辑工具守卫**（覆盖 Write/Edit/MultiEdit/NotebookEdit，异常 fail-open），并如实声明 shell、`node -e` 与场外进程不在射程；
- **宿主 Git 完全无关**：是否为 Git 仓、tracked/committed/clean、HEAD 是否仍是旧发布件，均不影响 init / phase verdict 或 framework identity；
- 包 hash 仍在可信边界：`release:pack` / `release:verify` 与显式 updater 操作保留校验，普通 phase 不再重算 per-file manifest；
- `docs/vendor/**` 不再进发布件。

### 8. UT 门禁 direct 基线归一（attestation-first 免提交）

UT 改码门禁不再要求宿主先提交才能取基线：direct attestation 优先，`HARNESS_DIFF_BASE_REF` 降为 fallback 域。同批收口 UT 存量共存（门禁身份模型与 hypium 真实语法对齐）、UT 诊断真实性（AC 与 BD 同数字后缀不再互相冒充覆盖、coverage-evidence 声明须匹配真实 DAG 来源）、以及签名/环境缺口误归 `code_regression` 的分类修正。

### 9. 路径全链路治理、宿主运行边界真值与 adapter

**自定义 `features_dir` 端到端贯通**（2.4.0 窗口）：共享 helper 与 framework/profile 散点全改走 `featureFilePath`/`relFeatureFile`；verify prompt 运行时替换 `{features_dir}`、skills/mdc/profile 文案占位符化、`canonical-gitignore` 函数化随配置生成、Stop hook 回执路径尊重 `receipt_dir_pattern`。默认布局（`doc/features`）宿主零行为变化。诚实豁免：`specs/phase-rules/*.yaml` 路径文案与 `_adhoc` 固定落点显式不动。

**宿主运行边界真值**（3.0.0 窗口）：

- **Windows 无头 CLI 选择**：不再跨 PATH 目录全局偏好 `.exe`，按 `where.exe` / PATH 目录原顺序取首个明确受支持且可 spawn 的形态；adapter version probe、视觉金丝雀与正式 phase invoke **复用同一 session 解析出的绝对路径**；
- **正式 invoke 硬失败早停**：spawn race、guardian containment 建立失败、真实 CLI unknown flag 一次停机，零内容重试；
- **`--requirement-file` 来源保留**：fresh manifest 新增可选 `requirement_source_files`，是参考图发现的锚点（来源文件直接父目录一层），**不要手工删除**。

**adapter**：新增 **chrys**、**opencode**（external_runner，共享根 `AGENTS.md`，接入 goal headless 链路）与 **codeagent**（`.cac` 物化、`codeagentcli`，加入 headless 全权限支持集；Chrys 在该支持集内保持拒绝）。goal 支持显式 `--adapter-model`，金丝雀 CLI 硬失败前置分类。

---

## 中途出现又被删除的机制（2.4.0 窗口交付，3.0.0 窗口取消）

2.4.0 从未发布，因此下列机制**你不会在 3.0.0 里见到**。列出来是为了避免读到旧材料时误以为它们仍然存在：

| 机制（2.4.0 窗口） | 3.0.0 现状 | 取消原因 |
|---|---|---|
| pixel_1to1 关键屏**真人确认** + `visual-confirm` CLI | **已删除**，CLI 不复存在 | 人签质量通行证整体退役；停等点改由机器事实重投影为责任阶段回修 |
| **验真签名拆位**（`isHumanVerified` = 已确认且署名≠授权哨兵） | **已删除**，`confirmed_by` 家族只读不 gate | 同上——堵伪造签名不如删掉签名通道本身 |
| **drift 放行收权**（`drift_allowlist` / `allow_local_drift` 须结构化真人签名） | **配置键读取即忽略**，不能解锁守卫、不影响 verdict | per-file integrity 家族整体退场，写权限改由执行环境授予（见 § 7） |
| 强制 **Maison UI kit**（九个 ArkUI 组件模板 + scaffolder） | **整体撤销**，相关配置与 check 全删 | 框架不得规定宿主源码形态；对守规 agent 结构性不可满足（见 § 3） |

**进程注入自净**（spawn 子进程剥离 `NODE_OPTIONS` 的 `--require`/`--import`/`--loader`）**保留**，未随上述条目一并退役。

---

## 2.3.0 已有、3.0.0 延续的能力

- **Goal 模式**确定性外层编排（2.3 首创，本版归一为单一运行时）
- Skill `project/` + `feature/` 分域与扁平 slug（2.3）
- 阶段 `spec`/`plan` 命名与 dual-read compat（2.3）
- config builder、template-renderer、Code Graph 机制（2.2）

---

## 升级指引（2.3.x → 3.0.0）

1. 备份当前 `framework/` 版本。
2. 部署 **`framework-3.0.0.zip`**（哈希见同批 manifest）或 submodule 更新到对应提交。
3. 工程根 **`/framework-init` UPDATE**（S1→S4）；确认 adapter 物化。
4. 每位开发者跑 **`check-personal-setup --json --ensure`**。
5. 验证：`cd framework/harness && npm test`。
6. **存量 feature 首次跑新版 testing 前，先补跑一次 review 闭环**（生成 `review/reports/review-closure-attestation.json`），否则 `review_closure_attestation` BLOCKER。
7. **顶层 `test-plan.md` 用例表加「执行通道」列**并逐条填写，进入 plan review；改动任一 TC 的通道会改变计划 identity，不得在派生或回灌时静默重写。
8. **`contracts.yaml` 补引用闭包**：`contract_file_reference_closure` 失败时，把诊断中确需交付的路径逐项加入顶层 `contracts.files`；navigation 只保留 `config_files`，删除 `registration_points`。
9. **UI 需求首次跑 coding/testing** 会遇到视觉确定性门禁（烤字 / 原子图标 / 素材物化 / 结构声明台账）；`chi_sim` OCR 模型随发布件下发，无需另装。
10. **默认 `warn` 档的宿主**：若只写了 P0 节点而没做组件映射，plan 阶段会开始 BLOCKER——补齐 visual-parity / contracts 映射即可，framework 不规定组件如何实现。
11. **verifier 存量产物**：已 closed 且 evidence 仍 fresh 的阶段零动作；新窗口生成但未闭环的 subject 只需**重跑当前 phase 的 harness**拿新 request，再按五步走完——不回退业务代码、不重写上游产物、不从 spec 重走。
12. **不要**为了「解锁」去删除或重置 `run-control.json`；旧 run 也无需回填 `run_created` / `run_base_sha`，若 legacy anchor 已损坏，走显式 `--supersede --rebaseline-to` successor，不要编辑旧 manifest 洗白。
13. **自定义 `features_dir`** 宿主：升级后读写、prompt、gitignore 自动随配置，无需手工改。
14. 自 **2.2.x 或更早直跳** 者，须叠加阅读 [`RELEASE-NOTES-v2.3.0.md`](RELEASE-NOTES-v2.3.0.md) 与 [`MIGRATION.md`](MIGRATION.md)。

---

## 已知边界

- **`manual` 执行通道永久 fail-closed**：这是冻结设计——没有机器证据载体的测试义务不会因为「人看过了」而通过。需要它 PASS，就得给出机器证据通道。
- **provider 通道 per-TC 证据绑定尚未实现**：`provider:<capability-id>` 声明的 TC 目前一律 unbound，保持 FAIL/UNVERIFIED。当前 capability 注册表里只有 hylyre 与 hylyre_visual_diff 两个 testing provider，二者各有自己的绑定；等出现真实 provider producer 后再做（plan `e7cecd22` 已顺延 3.2.0）。
- **编辑工具守卫堵不住场外进程**：无强隔离环境下，shell、脚本与 `node -e` 不在射程；这是如实声明的能力边界，真正的写保护要靠执行环境（task sandbox / 只读挂载 / 受限 token + ACL）。
- **视觉裁判**只保证文本存在性与运行时几何为鲁棒判据；非文本观感（胶囊/容器形态）靠 review 人审与用户终验，框架不造像素位置类门禁（实测恒误报）。
- **`probe_failed` 不作内容正证据**：建议给每个 P0/golden 目标屏配至少一个 id 锚点，否则错页只能判证据不足。
- **adapter 能力不对等**：external_runner 类 adapter 不承诺与 claude 同级质量；未登记 `verifier_subagent` 的 adapter（cursor / opencode / chrys / generic）判 `disabled / adapter_has_no_reviewer`——闭环照常进行，verifier 轴如实记 `not_reviewed`，这是诚实标注，不是阻断。
- **宿主真机回归不在本窗口执行**：3.0.0 的收口按裁决以仓内全量校验为准（单测 + fixtures + OpenSpec strict + release 门禁全绿），宿主侧真机复验留给宿主自行安排。

---

## 相关文档

| 文档 | 用途 |
|------|------|
| [`RELEASE-NOTES-v2.3.0.md`](RELEASE-NOTES-v2.3.0.md) | 上一个**已发布**版本（2.3，首创 Goal 模式）增量说明 |
| [`MIGRATION.md`](MIGRATION.md) | 升级步骤与全部破坏性变更逐条 |
| [`MAINTAINER-CHANGELOG.md`](MAINTAINER-CHANGELOG.md) | 逐 plan 流水（开发者向；2.4.0 与 3.0.0 两个窗口共 105 条） |
| [`docs/operations/goal-mode-runbook.md`](docs/operations/goal-mode-runbook.md) | Goal 模式运行手册（含停摆处置与 rebaseline 口径） |
| [`docs/concepts/skill-contracts.md`](docs/concepts/skill-contracts.md) | Skill 契约 |
| [`docs/concepts/reconcile-loop.md`](docs/concepts/reconcile-loop.md) | assess 调和循环 |

---

**Framework 3.0.0** — 把「谁说通过」换成「机器事实证明通过」：人签质量通行证整体退役、Goal 运行时归一为单一调和循环、视觉保真从 OCR 文本信号长成几何 oracle 与盲档委托、反假 PASS 证据体系成链，framework 运行时与宿主 Git/hash 彻底解耦。
