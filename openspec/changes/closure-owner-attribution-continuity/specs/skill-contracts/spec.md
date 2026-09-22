# skill-contracts Spec Delta

## MODIFIED Requirements

### Requirement: Equivalent inputs retain content provenance and responsibility

输入 SHALL 复用 artifact/derive 与静态 provider；resolved MUST 含可消费内容和真实来源，只有 refs 不算满足。absent 可继续下一来源；invalid 或显式新事实冲突 MUST NOT 被 fallback 掩盖。代码只证明现状或 characterization，MUST NOT 自动成为用户预期或外部授权。确定性投影只能提取已明确内容，语义缺口 MUST 回责任 Skill。当前 required 义务的必要输入缺失 MUST blocked；optional 缺失诚实降级，unknown MUST NOT 视为 not_applicable。

首个实际 Skill 的 Research/上下文收集 MUST 建立或承接真实 facts，不固定要求 spec/change；后续只追加本次 delta。产出要求、SpecLoader、checker、verifier、evidence 与 hook 读取 MUST 使用同一有效输入，省阶段 MUST NOT 省掉 CU 必要机器映射或本阶段实际输出验证。

阶段读取目标 MUST 与写入义务分离：`derive.codebase` 消费本阶段实际需要读取的现存源码/Research 来源，`derive.test-targets` 仅消费 profile 识别的测试目标，写入许可仍只来自冻结 contracts/CU 与阶段产出边界。verification-only review/UT 即使没有 implementation 义务，也 MUST 从冻结设计解析被测源码。首阶段合法 facts 的 `source_code_paths` MUST 在校验 subject、项目边界、可读性和重复路径后进入本次绑定，并由 evidence 传给后继；不得全仓扫描补洞。

源码 evidence MUST 从有效 execution scope、phase contract 的 source producer、已绑定 contracts 写集及 profile 测试根共同派生责任，也不得另建手写路径表。责任派生的遍历集合 MUST 是「已绑定 contracts 写集 ∪ 本阶段读取目标」（与测试目标同形）——观察期跑在 contracts 产出之前，只看写集时集合为空，研究源码一条归属也盖不上。该集合的**两侧**都 MUST 先过同一条源码判据：合格 facts 允许声明的非源码研究来源（目录清单、配置、文档），以及 `contracts.files` 里同样可能出现的非源码路径（写集只被约束为路径字符串），MUST NOT 获得实现阶段归属，其字节漂移 MUST 继续使该阶段证据 stale。源码判据 MUST 复用已有的受信材料——profile 声明的源码后缀（大小写敏感，与实现检查同法），不另立路径表，也 MUST NOT 以「落在模块包路径内」兜底（模块根下同样常驻非源码文件）；后缀不认即按无归属处理。责任资格 MUST 由冻结范围自证：owner 就是本阶段、owner 在链中排在本阶段之后、本阶段产出 contracts，或者 **owner 阶段尚未进入链且范围里存在该 owner 的 required、未满足义务**；四者皆不成立时 MUST 无归属。「责任 producer 非空」本身 MUST NOT 作为资格——无实现义务时它回落契约 producer 恒非空，等于全放行。写入许可不因归属扩大而放宽：写集与基线拦截一字不改。当前 gate phase 可承接自己获授权路径的待产出字节；闭环后责任阶段的完整 manifest 与同路径当前 output MAY 推进上游 Research 观察，且该判定 MUST 在单阶段和整链重算中一致。已消费 owner 的 review 等阶段 MUST NOT 保留可豁免标记。无责任归属、责任证据缺失/损坏或当前 output 不匹配时 MUST 继续 stale。仅声明 `derive.test-targets` 的阶段可把测试目标作为当前输入，因此 UT 自有测试变化 MUST NOT 反向作废 coding/review，而产品源码变化 MUST 从 coding 责任证据开始失效。需求、contracts 与其它非源码输入不适用此承接规则。

`contracts.files` 可同时声明现存输入与后继阶段将创建的授权产出。负责创建该文件的 plan/coding/UT 阶段 MUST NOT 因文件尚不存在而将同组现存源码整体判 absent；生产者完成后，后继消费者遇到仍缺失的必读文件 MUST blocked。plan 产出非空写集后，既有范围修订 MUST 刷新 implementation 来源，并让后继阶段从同一 contracts 绑定重算读取目标。

无 run 的 spec MUST 以冻结候选的 `requirement_basis` 校验原始需求。文件型需求 MUST 绑定原文件路径与字节且不得复制正文；inline 或旧候选缺少可恢复来源时，阶段入口 MUST 要求调用者用 `--requirement` 或 `--requirement-file` 显式重给原文，并核对既有文本身份。Goal run 的冻结 manifest MUST 保持唯一需求权威，阶段 CLI MUST NOT 覆盖它。

spec owner 对 acceptance 的合法修订 MUST 通过既有 scope revision 路径同步 `acceptance-context` 及派生的 unit/device evidence basis；旧 acceptance generation MUST 被替换而非并存。真实内容校验 FAIL 或把验收减空的变更 MUST 保持 blocked，且不得追加修订。

#### Scenario: Runless file requirement is recovered without a snapshot
- **WHEN** a runless candidate was prepared from a requirement file and spec starts without repeating the CLI input
- **THEN** the harness SHALL read that bound file, reject byte drift, and resolve the requirement without storing a text copy

#### Scenario: Spec owner revises acceptance in place
- **WHEN** acceptance existed at first freeze and spec later produces a valid corrected acceptance
- **THEN** the existing revision path SHALL replace acceptance bases across acceptance-context and derived evidence duties; an invalid or empty correction SHALL remain blocked

#### Scenario: References alone do not satisfy acceptance
- **WHEN** 输入只有 verification_refs，无法解析预期行为和验收字段
- **THEN** 消费者 MUST 报缺口，不能用当前代码行为补成目标预期

#### Scenario: Invalid preferred source cannot fall back
- **WHEN** 优先来源存在但非法，后备 derive 可返回内容
- **THEN** 输入 MUST 保持 invalid/blocked，不能静默使用后备来源

#### Scenario: First coding invocation establishes facts
- **WHEN** coding 是首个合法阶段且没有有效 facts
- **THEN** coding 写源码前 MUST 通过自身 Research 建立真实基线，不伪造 established_by=spec

#### Scenario: Verification-only phase reads existing implementation
- **WHEN** a frozen request contains review or UT but no implementation duty
- **THEN** the phase SHALL resolve existing production sources from the frozen construction contract without gaining write authority

#### Scenario: Planned output is absent before its producer
- **WHEN** contracts declare both an existing source and a file owned by a later producer that does not exist yet
- **THEN** the current producer SHALL bind the existing source and retain the planned path as authorization; a downstream consumer SHALL fail if the path is still missing

#### Scenario: Observation-phase research gains the downstream implementation owner
- **WHEN** 出生链只有观察阶段（如 spec/plan）、contracts 尚未产出，而冻结范围里有一条 required、未满足、owner 为实现阶段的义务
- **THEN** 该阶段证据里的产品源码条目 SHALL 带上该实现阶段的责任归属，使实现阶段按有效写集改这些字节时上游证据不因账本归属而失效

#### Scenario: A non-source input never gains an implementation owner, from either side of the set
- **WHEN** 一条非源码路径出现在合格 facts 的 `source_code_paths`、或同时出现在它与 `contracts.files` 写集里（含落在模块包路径内的那种）
- **THEN** 只有源码条目 SHALL 带实现阶段归属；该非源码条目 SHALL 无归属，其字节变化 SHALL 继续使该阶段证据 stale，MUST NOT 被 owner 的施工豁免跳过

#### Scenario: A verification-only scope still gains no source owner
- **WHEN** 范围里没有实现义务、本阶段也不产出 contracts（如 review 起链的纯验证范围）
- **THEN** 产品源码条目 SHALL 无归属，其字节变化 SHALL 继续使该阶段证据 stale

#### Scenario: Goal closure produces the same attribution as the direct path
- **WHEN** goal 编排在阶段最终闭环时没有子进程那份解析上下文
- **THEN** 闭环 SHALL 按同一个入口、同一份冻结材料重建它并产出同一种归属，run 身份取自调用方透传或正在闭环的那份 summary 自带的 run 身份，且 MUST NOT 因此改变任何既有判据（含 requirement 血缘强制门）的触发条件；重建失败 SHALL 退回无归属的既有行为并披露，MUST NOT 新增失败面，且 MUST NOT 回填或重写已落盘的旧证据
