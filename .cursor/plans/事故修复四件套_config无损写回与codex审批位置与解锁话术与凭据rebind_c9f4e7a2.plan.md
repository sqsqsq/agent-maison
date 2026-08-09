---
name: 事故修复四件套 — local config 无损写回 / codex 审批旗标位置 / 解锁话术 / 显式凭据 rebind
version: 3.0.0
# 版本说明：跟随当前版本窗口 3.0.0（用户指定）。纯事故闭环修复，不含平台级加固
#（模型钉与金丝雀硬失败分类见 plan d7f3a9c4）。
overview: >
  v9 按 codex 四轮 review 收敛（审批旗标改顶层位置、解锁话术补齐 8 处真实出口 +
  spec MUST 措辞约束、burn 语义不得过度断言、凭据状态映射纠错、grep 口径限定）。
  事故链（2026-08-08 宿主 codex goal run 20260808T070049Z-2a5136 + 锁屏截图会话）：
  ① framework.local.json 两处手写白名单 merge 在 adapter 写回时抹掉 device 段
  （goal --override-adapter 与非 goal record-adapter/--ensure 都命中）——宿主"登记了
  凭据却 device_policy_unset"的真实根因：凭据仍在 OS 库，框架丢了引用；违反
  openspec framework-local-config "round-trip 不丢字段"（spec.md L62/L73）。
  ② codexArgv 把 `--ask-for-approval` 放在 `codex exec` 之后，而它是**顶层旗标**——
  0.138.0 实测 `codex -a never exec --help` 成功、`codex exec -a never --help` 报
  unexpected argument。修法=把旗标移到 exec 之前，不绕 config override。
  ③ 运行期解锁话术与 credential 自动解锁能力矛盾，共 **8 处**出口（goal-runner 尾句
  + upstream-verdict-gate + check-testing ×2 + device-runtime-recovery
  + hdc-runner ×2 + device-test-install）；其中 upstream-verdict-gate 受
  harness-gates spec MUST 措辞约束，只改前提不删「请人解锁真机」。
  ④ 引用被抹后无恢复路径——补显式、无猜测的 device:rebind。
todos:
  - id: t1-lossless-local-config-writeback
    content: >
      【P0】framework.local.json 无损写回。新增
      updateLocalConfig(projectRoot, updater)：loadLocalConfig 读取完整合法配置
      （文件不存在时以 {schema_version: LOCAL_SCHEMA_VERSION} 为基线），updater 只
      修改目标字段，复用既有 validateLocalSchema + tmp/fsync/rename 原子写
      （writeLocalConfig L438-453 已具备，零新机制），写后 clearFrameworkConfigCache。
      不做通用深合并、不加字段白名单、不扩展并发锁机制。
      替换两处手写 merge：personal-setup-gate.ts mergeLocalPatch（L52-78，白名单丢
      device）与 init-task-executor.ts mergeLocal（L433-455，丢 vision+device）。
      白名单模式已两次漏字段（vision 于 plan b7e42d19 被抹是同类第一次，
      mergeLocalPatch 注释自证），故不再"往白名单加一个 device"。
      测试必须实际命中四条路径：goal `--override-adapter`（recordAdapterToLocal，
      goal-runner.ts L4202 调用）、非 goal `record-adapter`、非 goal `--ensure`/
      toolchain 写回、device:set；每条断言 device（含 unlock.credential_ref）、
      vision、toolchain 交叉保真（本次事故直接夹具：带 device.unlock 的配置切
      adapter 后 credential_ref 原样保留）。
    status: completed
  - id: t2-codex-approval-flag-position
    content: >
      修正 codex argv 旗标位置（codex review 二轮：不走 `-c`）。agent-invoke.ts
      codexArgv()（L309-321）把审批旗标移到 `exec` **之前**，输出完整顺序：
      ['codex', '--ask-for-approval', policy, 'exec', '--sandbox', mode]
      （policy = never | on-request，mode = workspace-write | danger-full-access）；
      prompt 走 stdin 铁律不动。
      理由（本机 0.138.0 实测）：`codex -a never exec --help` 成功、
      `codex exec -a never --help` → `unexpected argument '-a' found`——原生旗标在
      顶层位置可用，缺陷只是 argv 位置，不需要绕 config override，也不引入额外
      TOML 语义（`-c approval_policy=…` 虽亦可用，但属绕路，v6 方案作废）。
      同步：adapter.yaml L41 headless_invoke 声明字符串（保留 declarative-only
      注释）、goal-mode-runbook.md L141、goal-runner-policy 单测。单测断言**完整
      argv 顺序**（deepStrictEqual 整个数组），不只检查元素存在；覆盖 never 与
      on-request 两分支。不做版本探测、shim、通用 CLI 错误分类器。
    status: completed
  - id: t3-unlock-wording-fix
    content: >
      纠正解锁话术——统一语义 + **8 处**真实运行时出口（codex review 二轮：不能只
      清一个句子，也不建四态 formatter；三轮：不得把恢复失败一律写成 burned；
      四轮：出口清单补齐 + spec MUST 措辞约束）。
      统一语义（所有出口一致，**逐字按此**）：agent 不得读取/枚举/注入 PIN；
      框架仅使用处于 `ready` 状态的**已登记**凭据自动解锁；无可用凭据
      （absent/unsupported）、**已烧毁（burned）**、并发占用（in_flight）、mutex
      未取得或键盘布局未就绪时**一律零输入**；宣称"已烧毁"的条件收紧为二选一——
      **权威状态读到 `burned`**，或**本次确实尝试输入且执行/复验失败并 burn 成功**；
      上层只拿到 device_locked（无凭据状态）时**不得**宣称已 burn；人工解锁是
      fallback 不是唯一能力。
      （注意 `burned` 与其余零输入态的区别：它本身**已经是**烧毁既成事实，可如实
      陈述"该版本已烧毁，须重新登记"，但不得表述为"本次失败导致烧毁"。）
      （依据：device-unlock-helper 只在两处 burn——实际点击后执行出错
      `attempted:true`、点击后复验仍锁；absent/unsupported/in_flight 分支均
      `attempted:false` 零输入不烧毁。）
      **完整出口清单（8 处生产代码，codex 三轮实锤；v8 曾漏 4 处并自相矛盾——
      既说 device-runtime-recovery"保留不动"又要求全库 grep 清零）**：
      ① goal-runner.ts L5667 删除笼统尾句"设备就绪后重跑/--resume 继续；框架不会
      替你解锁设备。"——halt 输出已含 halt_reason + halt_guidance + notes，由就绪门
      按场景生成的 halt_guidance 承担该信息；
      ② upstream-verdict-gate.ts L106-107：**受 spec MUST 约束**——
      openspec/specs/harness-gates/spec.md L177 规定"环境层指引措辞 MUST 表述为
      「请人解锁真机」，MUST NOT 使用可被 agent 读作自我指令的「解锁真机」"。
      因此**必须保留「请人解锁真机」短语**与"不要尝试自行解锁设备"红线，只把前提
      改为不排他："无可用 ready 凭据或自动恢复未完成时，请人解锁真机并保持前台"。
      不得为了"正向化"删掉 spec 要求的措辞（删了会撞 spec 门禁与既有单测）；
      ③ check-testing.ts L1655："框架不会尝试任何口令"→"框架不会猜测或枚举未登记
      的口令"（已有的 enroll 出路保留）；
      ④ check-testing.ts L2510：**必须条件式**——该分支上层只有 device_locked
      （L2496 附近），无法证明是否 burn，既不能说"框架不会尝试任何口令"
      （credential 模式下框架恰恰尝试过），也不能断言"凭据已烧毁"。改为：
      "设备锁屏且自动恢复未完成——请查看随附错误，按提示稍后重试或重新登记；
      也可人工解锁后重跑。"；
      ⑤ device-runtime-recovery.ts L90（**v8 误判为"保留不动"，实为出口之一**）：
      该分支条件（`!credentialRef` 未登记）与登记出路都正确，**只换绝对话术**——
      "框架不会尝试任何口令"→"框架不会猜测或枚举未登记的口令"，其余保留；
      ⑥⑦ profiles/hmos-app/harness/hdc-runner.ts L1333 与 L1347：同 ③；
      ⑧ profiles/hmos-app/harness/providers/device-test-install.ts L366：同 ③。
      通用尾句统一：凡上层拿不到具体凭据状态的出口，尾句一律为"按前述具体原因
      稍后重试或重新登记，也可人工解锁"——不断言 burn、不断言"框架不会尝试"。
      **配套单测同步**（改文案必然打红既有断言，须一并更新，不得只改生产代码）：
      device-runtime-recovery.unit.test.ts L90、mutation-backtrack.unit.test.ts
      L420/L422、profiles ut-hvigor-test-failure.unit.test.ts L405、
      hvigor-args.unit.test.ts L527 夹具——其中断言「请人解锁真机」的用例**保留
      该断言**（spec MUST），只更新被改动的绝对话术部分。
      不改动的相邻出口（仅"请人解锁真机…环境问题"、无绝对断言，且受同一 spec
      措辞约束）：hdc-runner.ts L992、ut-hvigor-test-failure.ts L268。
      文档三处正向化：device-policy.ts guidance 选②行补"登记后设备阶段由框架自动
      解锁，PIN 全程不经对话与 agent"；device-policy-gate.md 运行期段（L83-87）把
      "不要尝试自行解锁"精确为"不得绕开框架徒手处置锁屏（枚举 PIN、hdc 注入
      口令）"，并注明 credential 模式下重跑本阶段由框架自动解锁；该文档既有的
      "**任何一次解锁失败即烧毁**"表述（L77）须同步精确为"**实际尝试输入后**
      执行/复验失败才烧毁；零输入分支（未登记/形态不支持/并发占用/布局未就绪）
      不烧毁"——否则与统一语义自相矛盾；goal-mode-operations.md 边界表（L148）
      补"允许（正道）"一行，其"任何一次失败即机器级 disabled"同样加"实际尝试
      输入后"限定。
      红线三条（不碰明文/不枚举/不进对话）逐字保留；凭据状态机/就绪门判定/烧毁
      机制代码零变化（只换话术产出）。不建 formatter——8 处逐个改，将来若出现更多
      重复出口再抽小 helper。
      单测：8 处出口各自的文案断言（新语义锚点在、旧绝对句不在）；
      skills-device-policy-gate / device-policy-cli 文档锚点断言；grep 清零口径
      **明确限定为发布/运行时路径**（harness/ + profiles/ + skills/ + docs/），
      **排除 .cursor/plans 与 openspec/changes/archive 中的历史引文**（那些是
      事故记录，改了反而丢失现场）。
    status: completed
  - id: t4-explicit-credential-rebind
    content: >
      显式、无猜测的凭据恢复。新增 `device:rebind --serial <s> --version <n>`
      （device-policy.ts 子命令 + package.json script）：构造
      CredentialIdentity{serial, version}（serial 走既有 SERIAL_PATTERN 校验、
      version 须正整数），provider.inspect 验证状态，**仅 `ready` 放行**，然后经
      t1 的 updateLocalConfig 原子写入 device.unlock={mode:'credential',
      credential_ref: credentialRefOf(id)} + target_serial。
      状态映射（codex review 二轮纠 `claimed` 不存在、三轮纠 `unsupported` 语义）：
      真实 CredentialState = `absent | ready | in_flight | unsupported | burned`
      （device-credential-store.ts L138），按 canAttemptUnlock L254-277 的既有语义
      逐态给指引：
      - `burned` → 该版本已因失败永久禁用，重新登记生成新版本；
      - `in_flight` → 正被另一进程使用或上次崩在临界区，**先稍后重试**（不得默认
        建议立即重登记）；
      - `absent` 且**无** error → 未登记（或此前失败后已被烧毁），须登记；
      - `absent` 且**有** error → 凭据库不可读，原样报告该 error（provider 不可用
        表现为此形态，**不是** unsupported）；
      - `unsupported` → 登记的凭据形态不受支持（仅支持 4–16 位数字 PIN）。
      不自动枚举版本、不选"最高版本"、不回退旧版本、不做 orphan 自动检测；
      缺 --version 即拒绝。rebind 全程不触碰口令本体。
      文档补一句 **version 的获取方式**（否则引用丢失后用户不知道填什么）：
      enroll 输出会回显版本号；亦可在 Windows 凭据管理器查看非秘密 target 名
      `MaisonDeviceUnlock:<serial>:v<N>`（含 `#burned` 后缀者为墓碑，不可用）。
      单测：ready 成功写回（经 updateLocalConfig，其余字段不丢）、
      burned/in_flight/unsupported/**absent 无 error**/**absent 带 error**
      **五个拒绝分支**（四种非 ready 状态，absent 按有无 error 拆两支）各一、
      serial 不合规拒绝、缺 --version 拒绝、version 非正整数拒绝。
      OpenSpec：device-policy 能力增 rebind 场景（显式版本、仅 ready 放行、
      不回退），随本 todo 提交。
    status: completed
isProject: false
---

# 事故修复四件套 (c9f4e7a2)

状态：**v9 — codex 四轮 review 修正（话术出口补齐至 8 处 + spec MUST 措辞约束 + grep 口径限定）后，待 review**

## 事故链与根因（全部本仓/本机实锤）

| # | 事故事实 | 根因锚点 |
|---|---|---|
| 1 | 宿主登记过设备凭据，切 adapter（cursor→codex）后 device-policy 报 `device_policy_unset` | [personal-setup-gate.ts:58-63](../../harness/scripts/utils/personal-setup-gate.ts) 白名单 merge 丢 `device`；goal `--override-adapter` 唯一写盘路径经 [goal-runner.ts:4202](../../harness/scripts/goal-runner.ts) 调用它；非 goal [init-task-executor.ts:439-443](../../harness/scripts/utils/init-task-executor.ts) 同款（还多丢 vision）。违反 [spec.md:62/73](../../openspec/specs/framework-local-config/spec.md)。凭据本体在 OS 库无损，丢的是引用 |
| 2 | codex goal run 首轮 CLI unknown-argument | codexArgv 把 `--ask-for-approval` 放 `codex exec` 后，而它是顶层旗标（实测顺序对错各一） |
| 3 | 宿主宣称"不能绕过系统锁屏"，把"禁碰口令"扩大成"不能解锁" | **8 处**运行时出口话术与 credential 自动解锁能力矛盾（见 t3 清单）+ 文档全负向表述无正向宣称 |
| 4 | 引用被抹后无恢复路径 | credential_ref 为确定性格式 `maison/device/<serial>/v<N>`（[device-credential-store.ts:84-96](../../harness/scripts/utils/device-credential-store.ts)），可显式 rebind 重建，不必重输 PIN |

## codex 二轮 review 处置表（2026-08-09，逐条核实）

| 意见 | 核实结论 | 处置 |
|---|---|---|
| t2 不要走 `-c`，改顶层旗标位置 | **实锤**：`codex -a never exec --help` 成功；`codex exec -a never --help` → `unexpected argument '-a' found` | 采纳，v6 的 `-c approval_policy` 方案作废；单测改 deepStrictEqual 完整顺序 |
| t3 不能只清一个句子，另有三处出口 | **全部实锤**：upstream-verdict-gate.ts:107 / check-testing.ts:1655 / check-testing.ts:2510 原文命中；device-runtime-recovery.ts:84-92 确带"未登记"条件与登记出路，语义正确 | 采纳，四处逐一修正 + 统一语义；device-runtime-recovery 保留不动；仍不建 formatter |
| t4 状态枚举 `claimed` 不存在 | **实锤**：真实 `CredentialState = absent \| ready \| in_flight \| unsupported \| burned`（device-credential-store.ts:138） | 采纳，四种非 ready 全覆盖 |
| 验收补 openspec:validate + check-plan-version | `openspec:validate` = `openspec validate --all --strict`（package.json L10）存在；t4 新增公开命令确须补 spec 场景 | 采纳 |
| plan 正文与文件名删"argv 走 config 覆盖" | 措辞确已过时 | 文件已重命名为"事故修复四件套_config无损写回与codex审批位置与解锁话术与凭据rebind_c9f4e7a2" |

## codex 三轮 review 处置表（2026-08-09）

| 意见 | 核实结论 | 处置 |
|---|---|---|
| t3 把解锁失败一律等同"凭据已烧毁"属过度断言 | **实锤**：device-unlock-helper 只在"实际点击后执行出错"（L277，attempted:true）与"点击后复验仍锁"（L298）两处 burn；absent/unsupported/in_flight 均 attempted:false 零输入不烧毁。上层 check-testing L2496 只有 device_locked，无法证明 burn | 采纳，统一语义逐字重写；L2510 出口改条件式（"自动恢复未完成，按随附错误稍后重试或重新登记"） |
| t4 `unsupported → provider 不可用` 写错 | **实锤**：canAttemptUnlock L274-275 `unsupported`="凭据形态不受支持（仅支持 4–16 位数字 PIN）"；provider 读取失败表现为 `absent` + error（L258-262） | 采纳，五态映射按既有语义逐条重写；单测补 `absent + error` 分支 |
| 用户不知道 `--version` 填什么 | 成立（引用丢失后无从得知） | 采纳，文档补获取方式（enroll 回显 / 凭据管理器非秘密 target 名 `MaisonDeviceUnlock:<serial>:v<N>`，`#burned` 为墓碑） |
| 移出表编号与家数不符 | 成立 | 采纳，移出表指向 d7 t4、家数改"五家回放 + chrys/generic fail-fast" |

## codex 四轮 review 处置表（2026-08-09）

| 意见 | 核实结论 | 处置 |
|---|---|---|
| t3 出口漏项，"全库清零"验收不可能通过 | **实锤**：`框架不会尝试任何口令` 生产代码共 **6** 处（check-testing ×2、device-runtime-recovery L90、hdc-runner L1333/L1347、device-test-install L366），加 goal-runner L5667 与 upstream-verdict-gate L107 共 **8** 处；v8 只列四处，且一边说 device-runtime-recovery"保留不动"一边要求全库清零，**自相矛盾** | 采纳，t3 改为完整 8 处清单；device-runtime-recovery 从"不动"改为"只换绝对话术、条件与出路保留" |
| grep 口径须排除历史引文 | 成立（.cursor/plans 与 archive 是事故记录） | 采纳，验收 grep 限定发布/运行时路径 |
| （本轮自查补充）改文案会打红既有单测 | **实锤**：device-runtime-recovery.unit.test L90、mutation-backtrack.unit.test L420/422、ut-hvigor-test-failure.unit.test L405、hvigor-args.unit.test L527 均断言相关文案 | 配套单测同步列入 t3，不得只改生产代码 |
| （本轮自查补充）**spec MUST 措辞约束** | **实锤**：openspec/specs/harness-gates/spec.md L177 规定环境层指引 MUST 用「请人解锁真机」、MUST NOT 用无主语「解锁真机」 | t3 写明：upstream-verdict-gate 必须保留该短语，只改前提为不排他；"正向化"不得删 spec 要求的措辞 |

## 关键探针证据（2026-08-08/09 本机）

- `codex -a never exec --help` → 成功输出 exec help；`codex exec -a never --help` →
  `error: unexpected argument '-a' found`——**顶层旗标位置实锤**。
- `codex exec --strict-config -c approval_policy=bogusvalue` → unknown variant
  （值域 untrusted/on-failure/on-request/granular/never）——config 路径亦可用，
  但按 review 不取（绕路）。
- writeLocalConfig 已是原子写（tmp+fsync+rename）且写前 validateLocalSchema
  （framework-local-config.ts L438-453）——t1 零新机制。
- `CredentialState = 'absent' | 'ready' | 'in_flight' | 'unsupported' | 'burned'`
  （device-credential-store.ts L138）；credentialRefOf=`maison/device/<serial>/v<N>`、
  OS target `MaisonDeviceUnlock:<serial>:v<N>`、墓碑 `#burned`（L84-106）。
  canAttemptUnlock L254-277 逐态语义：`unsupported`="凭据形态不受支持（仅支持
  4–16 位数字 PIN）"、`absent`+error="凭据状态不可读"、`in_flight`="正被另一进程
  使用或崩在临界区"——**provider 不可用属 absent+error，非 unsupported**。
- burn 触发点仅两处（device-unlock-helper）：L277 实际点击后执行出错
  （attempted:true）、L298 点击后复验仍锁；absent/unsupported/in_flight 分支
  attempted:false **零输入不烧毁**——故任何"失败即已烧毁"的无条件话术都是过度断言。
- goal-runner L5664-5668 halt 输出 = halt_reason + halt_guidance + notes + 硬编码
  尾句；upstream-verdict-gate L100-108、check-testing L1653-1657 / L2508-2515
  原文核实。

## 移出清单（本 plan 不做）

| 项 | 去向 |
|---|---|
| 模型钉（显式 `--adapter-model`；五家回放 codex/claude/codeagent/cursor/opencode，chrys/generic fail-fast） | **plan d7f3a9c4 t1** |
| 金丝雀 CLI 硬失败分类 BLOCKER | **plan d7f3a9c4 t4** |
| manifest 身份哈希扩展 / pin 生命周期 / successor 语义 | **plan d7f3a9c4 t2** |
| 模型自报 telemetry 比对告警 | **plan d7f3a9c4 t3**（复用既有 `adapter_model_observed`） |
| credential orphan 自动检测/版本推断 | **不做**（避免误判与旧 PIN 回退；恢复只走显式 rebind 或重登记） |

## 硬约束

1. **t1 先行**：无损写回是 t4 写盘的地基；实施顺序 t1 → t2 → t3 → t4。
2. **不新增机制**：updateLocalConfig 只组合既有 load/validate/atomic-write；
   rebind 不枚举不推断；话术不建 formatter 抽象。
3. **测试命中目标分支**：t1 四条写盘路径各自的交叉保真；t2 完整 argv 顺序
   deepStrictEqual；t3 **8 处**出口各自文案断言 + 发布运行时路径 grep 清零
   （排除 .cursor/plans 与 archive 历史引文）；t4 **五个拒绝分支**（四种非 ready
   状态，其中 absent 拆有/无 error 两支）
   状态全覆盖。
4. **红线逐字保留**：不碰口令明文/不枚举/口令不进对话三条在所有改动文本中逐字
   存续；"agent 不得自行解锁"红线（07-28 事故对策）保留，只纠正"必须请人"的
   过度外推；凭据状态机/就绪门/烧毁机制代码零变化。
5. **声明跟随现实**：adapter.yaml/runbook 与运行时 SSOT 同步，declarative-only
   注释不变。

## 验收（只看事故闭环）

- adapter 切换后 `device.unlock.credential_ref` 原样保留（goal 与非 goal 四条
  写盘路径回归均过，device/vision/toolchain 交叉保真）。
- codex argv 完整顺序断言通过；宿主 candidate:build 部署后 goal run 首轮不再报
  unknown argument。
- 显式 `device:rebind --serial <s> --version <n>` 能恢复当前宿主受损引用；
  burned/in_flight/unsupported/absent(无 error)/absent(带 error) 五分支各自拒绝
  并给对应指引，绝不回退旧版本。
- 运行时 **8 处**出口话术统一；在发布/运行时路径（harness/ + profiles/ + skills/
  + docs/，**排除 .cursor/plans 与 openspec/changes/archive 历史引文**）grep
  "框架不会替你解锁设备"、"框架不会尝试任何口令" 清零；**无条件 burn 断言清零**
  （"任何一次解锁失败即烧毁"类表述在文档与运行时出口均带"实际尝试输入后"限定）；
  **spec MUST 措辞「请人解锁真机」在 upstream-verdict-gate 仍在位**（
  openspec/specs/harness-gates/spec.md L177），相关单测断言保留；文档三处正向
  锚点存在、红线逐字保留。
- `cd harness && npm test` 全绿；`npm run openspec:validate` 通过；
  `node scripts/check-plan-version.mjs` 通过。
