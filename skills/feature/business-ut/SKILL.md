# 业务级 UT Skill (`business-ut`)

为指定函数、现有测试或本地新增/修改代码设计、补充、修复和运行 UT；不要求需求号。

## 按请求终点进入

| 请求 | 入口 | 终点 |
|---|---|---|
| 只设计测试或判断可测性 | 读目标和预期，按下方共享方法设计 | 交付用例/缺口，不写测试、不探设备、不要求 facts/报告 |
| 补、修或运行指定测试 | [request CLI](../../../docs/operations/request-harness.md)：写前先 `--prepare-request` 确认目标与载体，再 Research、写入授权测试并实际执行 | 交付所选用例的真实结果及未覆盖项，不新建 Feature |
| 正式 Feature/CU UT | 先完整读 [正式阶段](../../reference/business-ut-workflow-detail.md#正式-featurecu-阶段) 再执行，消费绑定的 unit/both AC、契约、范围和 required 产物 | 原阶段闭环；不自行删验收、改产品或追加 testing |

已有正式任务不拆成独立 request。request 和正式调用按 [输入契约](../../../docs/concepts/skill-contracts.md#facts-11) 读取真实身份；方法调用不生成身份/facts。
正式阶段的**闭环停等**按 [用户确认 UX](../../reference/user-confirmation-ux.md) 的 `ut.ok_to_testing` / `phase.next_step` 与已有授权裁决；独立请求到本次测试终点结束。

## 共享测试方法

读取 [共享 UT 方法](../../reference/business-ut-workflow-detail.md#共享-ut-方法)：预期与入口 → L0–L3 可测性 → 必要替身 → 正常/边界/失败断言 → 真实执行。
只运行已有测试时确认目标、载体和既有断言后直接执行，不重新设计用例或替身；修改/新增测试才执行相应设计步骤。
纯函数直接测输入输出，不为简单请求制造 UseCase、DAG、testability-audit 或 mock-plan；复杂流程保留实际适用的状态序列、依赖调用与失败恢复检查。
实际依赖、入口签名和既有测试须先读；UT 是代码消费者，不为测试方便新增业务抽象。写测试授权不包含改产品源码、验收或架构。

### 预期依据（实际写测试时）

用户明确的预期原文也可作为依据：引用现有请求记录或在本次 report-dir 保存原话，使用既有 `// expectation: <项目内相对路径>` 登记；不改写成自造 AC 或 acceptance。
**预期来源四步（写测试前逐类断言做，机器只核登记有效、语义归你）**：① **读具体条目**——打开引用的文件与锚点读原文，不凭文件名或标题推断；② **区分现状描述与授权要求**——**catalog / 源码注释 / 既有测试 / 实现代码这类「记载当前是什么」的条目不构成来源依据**，用户明确预期原文，以及 acceptance / 验收条目 / 约束知识里规定「应当是什么」的条目才算，同一份文件里两类并存时按**被引的那一条**判、不按文件判；③ **逐类核对**——把每类断言的预期与该条目原文对照，把结论（命中 / 不命中 / 该条目没说）写进入口指定的 facts 的 `## phase_delta: ut` 节（request 使用 prepare 返回的 `factsPath`，正式调用使用其绑定 facts）；④ **逐条登记或标注**——对得上就登记来源，对不上或该条目只描述现状就标 characterization。**标注写在每条断言自己身上**：用例名前加 `[CHAR-…]`（现状）或 `[AC-…]` / `[BD-…]` / `[BRANCH-…]`（有来源标签），或在**紧邻该行上方**加 `// characterization` / `// expectation: <项目内相对路径>`；**写在 `describe(` 上或文件头的总括注释不算登记**（框架不做作用域继承，`/* */` 块注释也不算）。**每条断言单独成行、以 `it(` 或 `test(` 起行、名字用字符串字面量，不要用 `skip` / `each` 等变体绕开登记**。标注清楚的现状记录是合法交付、不判 FAIL，但结果呈现为「现状记录」而不是「正确性通过」；依据要求**应当失败的断言保留失败与原因**，「不改实现」不授权为跑绿调整期望。

### 落点、执行与恢复（实际写或跑测试时）

正式 UT 有上游缺口时在既有 audit 的 YAML 之外写同款问题表，按[上游问题与拒修返回](../../reference/coding-workflow-detail.md#可选上游问题与拒修返回)引用当前证据、经原 verifier 核实后交 owner；保留真实 FAIL，收到拒修理由后修自身测试或补真实新事实。
先读 `framework/profiles/<project_profile.name>/skills/business-ut/profile-addendum.md`。hmos 当前执行已配置模块 `src/ohosTest/` 下的 Hypium 用例；先 prepare 并直接消费返回的 `request_sha256`、`baseline`、`bindings`、`reportDir`、`factsPath`、`gaps`，不手算身份/哈希。
测试载体或 `build-profile.json5` 配置缺失时先判断原授权：已覆盖所需工程改动就继续；未覆盖才先向用户说明具体改动与原因，得到认可后再做。能力未提供或缺口尚未解决时如实停在该处，不改投其它目录、不用其它模块的通过代替。
载体处理后重新 prepare，再按返回落点写测试与套件注册；测试写入受 `allowed_test_writes` 限制。prepare 不执行测试，成功不能当作 UT PASS。
任何需要编译或跑测试的校验一律经框架执行器（纯编译用 `npm run compile`，测试用专项 request CLI 或正式 `harness-runner --phase`）；不裸调 hvigor，也不引导用户去运行宿主自带脚本。确认工具链本身跑 `check-personal-setup.ts --json --ensure`；失败诊断先读同次 `hvigor-*.meta.json` 的 `envProbe`（`DEVECO_SDK_HOME_PATH` 本次实际取值 / `JAVA_HOME` / 变量**是否设置**——布尔为 true 不等于框架派生成功）与 `command`、`exitCode`，再读构建日志正文，重新解析出来的值只作辅助且须标为「当前值」，安装目录扫描第三顺位。
需要真机执行时遵守 [device-policy-gate](../../reference/device-policy-gate.md)；设计用例不触发设备门。既有权限已经覆盖的动作不重复确认，PIN 不进入对话。
失败时按 [编译与运行恢复](../../reference/business-ut-workflow-detail.md#step-75-ut-编译闭环) 定位测试/环境责任；独立请求仍使用原 request 命令，正式阶段才用 Feature 命令。真实产品缺陷保留失败，交实现职责；不改断言洗绿、不擅改产品。
