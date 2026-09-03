# Framework 3.0.0 发布说明

**发布日期**：2026-09-03  
**对比基线**：Framework 2.4.0（`framework-2.4.0.zip`）  
**发布件**：`dist/framework-3.0.0.zip`（SHA256 以同批产出的 `dist/framework-3.0.0.manifest.json` 为准——本文写在 `release:all` 之前，故不内联可能变化的哈希）  
**适用读者**：接入本 Framework 的工程负责人、AI Agent 使用者、Framework 维护者

> 本文档位于 **AgentMaison 开发仓**（dev-only，不进 zip）。更早版本见 [`RELEASE-NOTES-v2.4.0.md`](RELEASE-NOTES-v2.4.0.md)、[`RELEASE-NOTES-v2.3.0.md`](RELEASE-NOTES-v2.3.0.md)。

---

## 这份文档是写给谁的？

**Framework 3.0.0** 是自 2.4.0 以来的一次 **major 演进**，窗口累计 **72 个 plan**，主题只有一句话：

> **把「谁说通过」换成「机器事实证明通过」，并让无人值守链路在没有人签字的情况下自己走完。**

2.4 让自动化*可信*（视觉保真飞轮、防伪收权）；3.0 把这条路走到底——**删掉所有能让人或 agent 签字放行的通道**，同时补上删掉之后系统必须自己具备的恢复能力：

- **人签质量通行证整体退役**：`confirmed_by` / `human_confirmed` / `visual-confirm` 等不再影响 verdict、phase 推进或完成判定；停等点改由机器事实重投影为「回哪个阶段修」；
- **Goal 运行时归一**：interactive 与 detached 收敛为同一个 `GoalPhaseRuntime`，run 出生契约、基线冻结、所有权 fencing 三件事统一；
- **Skill 契约化 + assess 调和循环**：phase 合格性变成 `contract.yaml` 声明的机器契约，`next.json` 是从证据重算的投影而非可编辑状态；
- **反假 PASS 证据体系**：负面产品裁决阻断闭环、上游裁决门、closure attestation、verifier 证据身份绑定——绿灯不再能被下游继承或被重跑洗白；
- **视觉保真三期**：盲档视觉委托（只读 provider 协作）、运行时布局树几何 oracle，以及一次**减法**——强制 UI kit 整体撤销，框架不再规定宿主源码形态；
- **framework 运行时与宿主 Git/hash 解耦**：per-file integrity 家族退场，写权限改由执行环境授予。

下文按主题归并；逐 plan 明细见 [`MAINTAINER-CHANGELOG.md`](MAINTAINER-CHANGELOG.md)。

---

## 2.4.0 → 3.0.0：一句话变化

| | Framework 2.4.0 | Framework 3.0.0 |
|---|-----------------|-------------------|
| **质量放行** | 真人/agent 签 `confirmed_by` 可放行 | **签名通道整体删除**；只认机器证据，停等点重投影为责任阶段回修 |
| **无人值守停摆** | 缺人签即 halt，过夜任务死等 | **全阶段自动恢复**：按当前事实回退重修、capability defer 或据实诊断 |
| **Goal 执行路径** | attended 与 detached 两套生命周期 | **单一 `GoalPhaseRuntime`**，仅 executor transport 不同；run-control epoch + 所有权 fencing |
| **run 基线** | 依赖 `HARNESS_DIFF_BASE_REF` 环境变量 | 出生冻结 `manifest.run_base_sha`（write-once），换基线须运行时外显式 `--supersede --rebaseline-to` |
| **phase 合格性** | 散在脚本与 prompt 约定 | `skills/feature/<skill>/contract.yaml` 声明的结构化 inputs/capabilities/produces/checks |
| **深度/档位** | `summary.depth`、`quality_depth`、`minimum_depth_by_phase` | **`assurance` + `capability_resolutions`**（summary 1.3），能力裁剪取代深度裁剪 |
| **verifier** | 每阶段必跑的仪式，投递 `ai-prompt.md` 全文 | **按能力启用三态**（disabled/enabled/blocked）+ **短 request JSON** 投递 |
| **上游绿灯** | 下游不校验上游裁决 | **`upstream_verdict_gate`**：上游非 PASS / blocker 未清 / 证据 stale → 下游 BLOCKER |
| **testing 证据** | 信 trace 的「通过」字符串 | **Hylyre StepResult v1 三轴**（execution / verification / evidence）逐步对账 |
| **测试执行责任** | 派生器可自行 skip 用例 | 顶层 TC 必须声明 **`execution_channel`**；派生器无 skip 决策权；`manual` 永久 fail-closed |
| **视觉 UI 形态** | 框架下发强制 Maison UI kit | **整体撤销**——产品组件归属唯一归宿主；盲档地板改由组件所有权链承接 |
| **framework 完整性** | per-file sha256 漂移判 BLOCKER + 宿主 Git 身份裁决 | **integrity 家族退场**；写权限由执行环境授予，宿主是不是 Git 仓完全无关 |
| **adapter** | claude / cursor / codex / chrys / opencode | 增 **codeagent**（headless 全权限支持集）；Windows CLI 选择改为按 PATH 真值解析 |

---

## 大项改动

### 1. 人签质量通行证退役与全阶段自动恢复（3.0.0 最大主线）

**以前的问题**  
2.4 的防伪堵住了伪造签名，但没有堵住**签名这个机制本身**：`confirmed_by`、`human_confirmed`、`p0_skip_waiver`、`visual-confirm` 等十余种 confirmation receipt 仍然能把 FAIL 变成放行。无人值守链路一旦撞上这些点就只能 halt 等人——宿主实测出现过整夜停在「等待人工确认」而机器事实早已足够判断的情况。

**3.0.0 的做法**  
把整套终审链删掉，并补上删掉之后必须具备的能力：

- 旧 confirmation receipt **只读可审计，不再影响任何裁决**；新 writer 不再生成，不要求宿主回改历史产物；
- 旧 `AWAITING_HUMAN_REVIEW` run 恢复时**按当前机器事实重投影**——责任阶段 repair、`DEFERRED_CAPABILITY_MISSING`、optional advisory 或明确诊断；**不能通过补签或 resume 把 FAIL 改成 PASS**；
- `confirmed_by_user` 一类普通选择字段改名中性 `selection_status` / `selection_source`：菜单仍是合法的 attended UX，但不是质量凭证；
- P0 device flow 的 runtime fidelity 改由 hash-bound 的逐 step 运行时观测证明；crop/bbox 改由 source/bbox/tool/hash 确定性复算。

配套的生存能力：liveness beacon、supervisor auto-resume、声明式 launch-liveness-wakeup、Job 团灭与孤儿治理、resume 真源收编——过夜任务的失败模式从「静默等人」变成「据实回退重修或诚实终止」。

### 2. Goal 运行时归一（出生契约 · 单一调和循环 · 契约引用闭包）

三条根因各对应一个里程碑，由总纲 plan 统一验收：

**结构事实被实现成行为义务** → **run 出生契约**：新 run 必须同时具备 `manifest.json` 与唯一 `run_created`；manifest-only / 重复 / 损坏出生事件判 `CREATION_INCOMPLETE`，不可 resume/attach/接管，也不占用同 feature 的 successor 位置。含 `coding`/`ut` 的链在出生时冻结 `manifest.run_base_sha`（write-once，同 run 不可 override/rebase），goal 门禁不再活读 `HARNESS_DIFF_BASE_REF`。

**执行路径与安全语义分叉** → **阶段运行时统一**：attended 的 in-session driver 与 detached 的 runner 循环合并为唯一 `GoalPhaseRuntime`，它独占 `assess → authorize → one phase → gate` 的转换写入。新增 `run-control.json`（单调 epoch + process/session owner）与原子 handoff mailbox：所有权变化后旧 owner 的一切写入被 fencing 拒绝；**不要删除或重置 `run-control.json` 来「解锁」**。

**契约引用无闭包** → **plan closure 引用闭包**：contracts 中 schema 声明的文件字段全部必须属于规范化后的顶层 `contracts.files`——它是唯一授权集合，文件已存在、与 spec asset 字节相同或由生成器产出都不自动获得授权。同批把 navigation 收敛为唯一 `config_files`，删除零消费者的 `registration_points`。

### 3. Skill 契约化、assess 调和循环与能力裁剪

- **Skill contract 成为运行时输入**：结构化 inputs / capabilities / produces / checks 由 `skills/feature/<skill>/contract.yaml` 声明；
- **`next.json` 是投影**：`assess@1` 从 summary / closure / evidence / goal 指纹重算 gap 与唯一 recommendation，**不要写脚本直接编辑**；
- **能力裁剪取代深度裁剪（Breaking）**：`summary.depth`、`quality_depth`、`missing_optional_inputs`、`minimum_depth_by_phase` 删除，改为 `assurance` + `capability_resolutions` + contract fingerprint。`minimum_assurance` 只影响 `assess@1` 的 `insufficient_assurance`，**不能放宽 quality axes、phase closure 或 release**；
- **verifier 能力化（Breaking）**：三态 disabled / enabled / blocked。`disabled` 是**缺席即为零**——不生成 prompt/request，闭环也不要求 verifier 证据，磁盘上的旧文件永远不会重新激活已关闭的能力。投递协议改为**短 request JSON**（旧规则投递 177KB 级 `ai-prompt.md` 全文，往返有损且机器块之外零校验）。subject 按实际审查材料寻址，关环走 `--sync-closure`；
- **framework 轻量化重构**：lite / balanced / full 三档工作流与验证收敛，档位决定哪些 phase 保留 verifier 与哪些检查生效。

### 4. 反假 PASS 证据体系

来自 bc-openCard 两轮宿主事故（无头链绿灯放行严重残次品、盲宿主线框级 UI 全绿交付「达标可发布」）的根治：

- **负面产品裁决阻断闭环**：review 结论「不通过」/ testing 结论「不达标」→ 该 phase BLOCKER FAIL；
- **上游裁决门**：下游 phase 启动即消费上游 summary 机器裁决，verdict 非 PASS / blocker 未清 / 证据 stale → BLOCKER；
- **review closure attestation**：review 之后任何产品源码变更（含 contracts 未登记的新文件）→ testing FAIL，回跑 review 重审；
- **summary schema 演进**：`report_validity`（报告合法性，独立于产品裁决）+ `quality_axes`（functional / visual / asset / evidence 四轴，harness 派生而非 agent 自报）+ `release_readiness` / `completion_status` 投影；
- **verifier 证据身份绑定**：subject 指纹与 JSON 真源收编，跨 attempt / 跨 run 的互洽回执不能为本次终签；
- **完成语义收口**：成功侧不再产出裸 `COMPLETED`，改为 `CHAIN_SLICE_COMPLETED`（仅链切片语义）与 `DEFERRED_CAPABILITY_MISSING`；feature 级完成只认 `verify-feature-completion`；
- **修复环裁决化**：候选真伪裁决、收敛不变式与增量修复环——同指纹候选重复出现走既有 no-progress / backtrack 预算熔断，不再无限空转。

### 5. 视觉保真三期：委托、几何与一次减法

**盲档视觉委托**：盲模型宿主不再靠自报，而是与**只读视觉 provider** 协作——provider 只出证据不写状态，ledger 保持单写者（agent 自跑 harness 写 journal proposal，runner 顺序重放后收编）。

**运行时布局树几何 oracle**：把「自报度量」换成从运行时布局树算出的确定性几何事实，配合 VL critic 闭环（结构化发现 + 熔断账本 + 回执生产 + 静稳采样 + 校准回灌）。

**视觉机制减法**：剪除证明账本、策略降级与自锁判死三套机制——`vision/artifact-attestations.jsonl`、`policy-downgrades.jsonl` 及其 hash-chain / supersede / HWM 全部退出运行时，**升级宿主无需迁移或清理**。

**强制 UI kit 整体撤销（Breaking）**：宿主实测证明 framework 把一套具体 ArkUI 组件实现升级成了强制产品契约，对守规 agent 结构性不可满足（不 scaffold 判「未物化」、scaffold 判「越界」，双输烧尽重试预算）。**产品组件归属唯一归宿主**：删除 `profiles/hmos-app/ui-kit/**`、kit 目标目录配置、ui-spec 的 `block` 字段与全部 `ui_kit_*` check；selector 契约回归裸 ui-spec 节点 id；盲档结构地板改由「ui-spec P0 节点 → `visual-parity.yaml` → `contracts.components` → `contracts.files`」这条**产品组件所有权链**承接，且不受 `visual_parity_enforcement` 降级。

### 6. testing 证据消费收编（Hylyre StepResult 唯一真源）

- **Hylyre 改为源码树 vendor**：`.whl` 退役，schema 2 双兼容，发布件按 LF 字节逐文件 sha256 冻结；
- **StepResult v1 三轴**：`execution` / `verification` / `evidence` 分立，P0 语义门从「计划形态 × case 状态字符串」改为**计划要求 × StepResult 逐步对账**（required / forbidden element 均需映射到 `role=assertion` 且 `status=passed` 的步骤）；
- **`execution_channel`（Breaking）**：顶层 `test-plan.md` 每条 TC 必须声明唯一执行通道（`hylyre` | `visual` | `manual` | `provider:<capability-id>`）。派生器不再有 skip 决策权，编译失败即 FAIL；**`manual` 表示「该测试义务当前没有机器证据载体」，会持续留在分母，任一 manual TC 都让本 feature testing 无法 PASS**（冻结设计）；
- **selector 恢复开放世界语义**：feature ui-spec 只建模新增页面，既有入口天然缺席，故 ui-spec miss 只给 provenance WARN，最终合法性由本轮真机 StepResult 的 candidate_count 裁决；静态 BLOCKER 收窄为可确定错误；
- **失败归因两级路由**：已执行 case 的 failed 消费机器 `failure.domain` / `failure.code`；**未执行且无机器原因的 explicit skip 保持 testing FAIL、零自动 coding 归因**（不再从 TC 名称或报告散文推断责任）。

### 7. framework 运行时与宿主 Git / hash 解耦

原先发布件随包下发 `RELEASE-MANIFEST.json`，harness 启动时逐文件 sha256 比对、漂移判 BLOCKER，随后又为保护这个检查本身长出 sidecar 自校验与 Git 身份裁决。**它不是安全边界**——manifest 与被校验文件同处一个可写目录，同一主体能一并修改；范围还被推到最大：一份不参与运行的 vendor 交接文档就能让整机 BLOCKER。

3.0.0 改为**把写权限从宿主身份拿走**：

- host consumer task 对 framework 控制面**物理只读**，只有用户或 CI 显式启动的 updater 在升级窗口内临时可写；
- 无法强隔离时只保留**合作式编辑工具守卫**（覆盖 Write/Edit/MultiEdit/NotebookEdit，判定异常 fail-open），并如实声明 shell、`node -e` 与场外进程不在射程；
- **宿主 Git 完全无关**：是否为 Git 仓、tracked/committed/clean、HEAD 是否仍是旧发布件，均不影响 init / phase verdict 或 framework identity；
- 包 hash 仍在可信边界：`release:pack` / `release:verify` 与显式 updater 操作保留校验，普通 phase 不再重算 per-file manifest；
- `docs/vendor/**` 不再进发布件。

### 8. UT 改码门禁 direct 基线归一（attestation-first 免提交）

UT 改码门禁不再要求宿主先提交才能取基线：direct attestation 优先，`HARNESS_DIFF_BASE_REF` 降为 fallback 域。同批收口 UT 存量共存（门禁身份模型与 hypium 真实语法对齐）、UT 诊断真实性（AC 与 BD 同数字后缀不再互相冒充覆盖、coverage-evidence 声明须匹配真实 DAG 来源）、以及签名/环境缺口被误归 `code_regression` 的分类修正。

### 9. 宿主运行边界真值与 adapter

- **Windows 无头 CLI 选择**：不再跨 PATH 目录全局偏好 `.exe`，按 `where.exe` / PATH 目录原顺序取首个明确受支持且可 spawn 的形态；adapter version probe、视觉金丝雀与正式 phase invoke **复用同一 session 解析出的绝对路径**；
- **正式 invoke 硬失败早停**：spawn race、guardian containment 建立失败、真实 CLI unknown flag 一次停机，零内容重试；
- **`--requirement-file` 来源保留**：fresh manifest 新增可选 `requirement_source_files`，是参考图发现的锚点（来源文件直接父目录一层），**不要手工删除**；
- **codeagent 接入**：加入 headless 全权限支持集（`.cac` 物化、`codeagentcli`），Chrys 保持拒绝；
- **模型钉**：goal 支持显式 `--adapter-model`，金丝雀 CLI 硬失败前置分类。

---

## 中等项改动

- **plan 待办 SSOT**：frontmatter `todos` 是唯一机器待办真源，plan 正文出现未勾 `- [ ]` 即在默认校验中失败（正文 checklist 曾是发布门禁的注册制盲区）。
- **framework-init 正向意图收口**：删除 Git 专用路由与 init 的宿主 SCM 耦合，按正向意图判断而非猜测宿主版本管理形态。
- **编译诊断保真**：`00308018` 归因分层与主错定位、失败任务可见、analyze 默认口径对齐 DevEco。
- **设备就绪与锁屏真值**：解锁授权与模拟器托管、`--check` 假阳性根治、普通模式入口级设备前置与全链 target 接线；锁屏 reveal 的 velocity/timeout 相容与 `reveal_failed` 归因。
- **signed-hap 发现去硬编码**：宿主 ut/testing「签名失败」误报根治，未签名给精确诊断。
- **文本读入口 EOL 归一**：手写解析的 CRLF 脆弱面普查与收口。
- **事故修复四件套**：local config 无损写回、codex 审批旗标位置、解锁话术、显式凭据 rebind。
- **contracts 统一解析边界**：引用闭环真源收编与裸读禁令（禁止绕过统一解析入口直接读 contracts）。
- **收官真值与强制 kit 撤销**：完成 ≠ 通过，FAIL 收口单源，删除「错误约束」类机制。

---

## 2.4.0 已有、3.0.0 延续的能力

- **视觉保真飞轮**（2.4 主线）：`chi_sim` OCR 文本信号、烤字 / 原子图标 / 素材物化门禁、pixel_1to1 档位
- **Goal 模式**确定性外层编排（2.3 首创，2.4 硬化生存性，3.0 归一运行时）
- Skill `project/` + `feature/` 分域与扁平 slug（2.3）
- config builder、template-renderer、Code Graph 机制（2.2）

---

## 升级指引（2.4.x → 3.0.0）

1. 备份当前 `framework/` 版本。
2. 部署 **`framework-3.0.0.zip`**（哈希见同批 manifest）或 submodule 更新到对应提交。
3. 工程根 **`/framework-init` UPDATE**（S1→S4）；确认 adapter 物化。
4. 每位开发者跑 **`check-personal-setup --json --ensure`**。
5. 验证：`cd framework/harness && npm test`。
6. **存量 feature 首次跑新版 testing 前，先补跑一次 review 闭环**（生成 `review/reports/review-closure-attestation.json`），否则 `review_closure_attestation` BLOCKER。
7. **顶层 `test-plan.md` 用例表加「执行通道」列**并逐条填写，进入 plan review；改动任一 TC 的通道会改变计划 identity，不得在派生或回灌时静默重写。
8. **`contracts.yaml` 补引用闭包**：`contract_file_reference_closure` 失败时，把诊断中确需交付的路径逐项加入顶层 `contracts.files`；navigation 只保留 `config_files`，删除 `registration_points`。
9. **带 `maison:` 前缀 selector 的测试计划须按 ui-spec 节点 id 重新生成**（UI kit 撤销的直接影响）；`framework.config.json` 里的 kit 目标目录键已不被读取，建议删除。
10. **默认 `warn` 档的宿主**：若此前只写了 P0 节点而没做组件映射，plan 阶段会开始 BLOCKER——补齐 visual-parity / contracts 映射即可，framework 不规定组件如何实现。
11. **verifier 存量产物**：已 closed 且 evidence 仍 fresh 的阶段零动作；3.0.0 生成但未闭环的 subject 只需**重跑当前 phase 的 harness**拿新 request，再按五步走完——不回退业务代码、不重写上游产物、不从 spec 重走。
12. **不要**为了「解锁」去删除或重置 `run-control.json`；旧 run 也无需回填 `run_created` / `run_base_sha`，若 legacy anchor 已损坏，走显式 `--supersede --rebaseline-to` successor，不要编辑旧 manifest 洗白。
13. 自 **2.3.x 或更早直跳** 者，须叠加阅读 [`RELEASE-NOTES-v2.4.0.md`](RELEASE-NOTES-v2.4.0.md) 与 [`MIGRATION.md`](MIGRATION.md)。

---

## 已知边界

- **`manual` 执行通道永久 fail-closed**：这是冻结设计——没有机器证据载体的测试义务不会因为「人看过了」而通过。需要它 PASS，就得给出机器证据通道。
- **provider 通道 per-TC 证据绑定尚未实现**：`provider:<capability-id>` 声明的 TC 目前一律 unbound，保持 FAIL/UNVERIFIED。当前 capability 注册表里只有 hylyre 与 hylyre_visual_diff 两个 testing provider，二者各有自己的绑定；等出现真实 provider producer 后再做（plan `e7cecd22` 已顺延 3.2.0）。
- **编辑工具守卫堵不住场外进程**：无强隔离环境下，shell、脚本与 `node -e` 不在射程；这是如实声明的能力边界，真正的写保护要靠执行环境（task sandbox / 只读挂载 / 受限 token + ACL）。
- **视觉裁判**仍只保证文本存在性与运行时几何为鲁棒判据；非文本观感靠 review 人审与用户终验。
- **`probe_failed` 不作内容正证据**：建议给每个 P0 / golden 目标屏都配至少一个 id 锚点，否则错页只能判证据不足。
- **adapter 能力不对等**：external_runner 类 adapter 不承诺与 claude 同级质量；未登记 `verifier_capability` 的 adapter 在 `full × interactive` 下判 `blocked`——这是如实结论，不是回归。
- **宿主真机回归不在本窗口执行**：3.0.0 收口按裁决以仓内全量校验为准（单测 3795 + fixtures 46 + OpenSpec strict + release 门禁全绿），宿主侧真机复验由宿主自行安排。

---

## 相关文档

| 文档 | 用途 |
|------|------|
| [`RELEASE-NOTES-v2.4.0.md`](RELEASE-NOTES-v2.4.0.md) | 上一版（2.4，视觉保真飞轮）增量说明 |
| [`MIGRATION.md`](MIGRATION.md) | 升级步骤与全部破坏性变更逐条 |
| [`MAINTAINER-CHANGELOG.md`](MAINTAINER-CHANGELOG.md) | 3.0.0 窗口全部 72 个 plan 逐条（开发者向） |
| [`docs/overview.md`](docs/overview.md) | 框架全景介绍（§1.4 演进里程碑已含 3.0.0 主线） |
| [`docs/operations/goal-mode-runbook.md`](docs/operations/goal-mode-runbook.md) | Goal 模式运行手册（含停摆处置与 rebaseline 口径） |

---

**Framework 3.0.0** — 把「谁说通过」换成「机器事实证明通过」：人签质量通行证整体退役、Goal 运行时归一为单一调和循环、反假 PASS 证据体系成链、视觉保真做了一次必要的减法，framework 运行时与宿主 Git/hash 彻底解耦。
