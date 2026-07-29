# Tasks — device-readiness-and-completion

对应 plan `a7f2e5d1` 的六个 Todo，按依赖顺序。

## t1 设备阻断分类接线（独立真 bug，无新能力依赖）

- [x] 1.0 `OnDeviceFailureEvidence.runDiagnosis` 结构化透传 aa test 诊断（此前只进 errors 散文，下游只能子串匹配）
- [x] 1.1 `ut-hvigor-test-failure.ts` `classifyFailure` 对锁屏产出 `blocking_class='externalBlocked'` + `failure_kind='device_blocked'`（新增与 `toolchain` 正交的 `deviceBlocked` 维度）
- [x] 1.2 精确原因只入 blocker `details_excerpt`/HDC diagnosis，不扩 `summary.schema.json`
- [x] 1.3 goal 侧归入既有 `external_block`，不进内容 retry（`isDeferrableExternalBlock` 自动命中，无需改 classifier）
- [x] 1.4 混合场景：模块级锁屏不掩盖同 phase 内的真实用例失败
- [x] 1.5 `upstream-verdict-gate` 措辞改「请人解锁真机」+ 显式禁止 agent 自解锁
- [x] 1.6 单测：不落 `code_regression`、混合场景不整体 defer、散文子串不误判、既有 toolchain 四码归类不变

## t2 模拟器框架托管

- [x] 2.1 `spawnManagedDevice`：detached 独立进程组 + **`stdio:'ignore'`**（继承管道正是事故里钉住 cursor-agent 的根因）+ unref
- [x] 2.2 `device-session.json`：四元组 + serial + `started_by_run` + 启动状态（读写往返 + 损坏/缺失不猜）
- [x] 2.3 `registerManagedDeviceCleanup`：正常退出与 SIGINT/SIGTERM 清理，只清一次、可反注册（boot 超时随 t3 接线）
- [x] 2.4 `reclaimManagedDevice`：崩溃残留由后续 run 依 session 对账**有界**回收
- [x] 2.5 `classifyTargetKind` 正面分类，禁反向推断（`physical` 属性组合取值随真机 spike 定）
- [x] 2.6 用户既有实例可作 target 但不回收；四元组（pid+启动时间+exe+profile）防 PID 重用
- [x] 2.7 `capsTestingConclusion`：testing + `emulator|unknown` 封顶（判定函数；runner 接线随 t3）
- [x] 2.8 单测 10 例（`device-session` 已注册 CORE_SUITES）；集成验收随 t3 接线后补

## t3 设备就绪门

- [x] 3.1 新增异步 `runDeviceReadinessGate`，排在 capability gate 之后、`agent_invoke_start` 之前（**不复用** capability gate 的同步函数与固定 FAIL 语义）
- [x] 3.2 执行范围由 `phaseRequiresDevice`（profile `device_capabilities` × `PHASE_CAPABILITY_MAP`）派生，不硬编码 phase
- [x] 3.3 共享 `ensureDeviceReady` 核心：wake → 探测 → （t6 注入凭据时）解锁一次 → 复验 → 按策略降级
- [x] 3.4 三态 READY / BLOCKED(`external_block`) / AMBIGUOUS(HALTED)；未 READY 无 `agent_invoke_start`（集成层已断言）
- [x] 3.5 `{serial,targetKind,sessionId}` 经 `extraEnv` 注入，不写全局 `process.env`
- [x] 3.6 attempt 内目标冻结（gate 每 attempt 前执行一次，结果只作用于本次 invoke）
- [x] 3.7 单测 13 例 + 集成 2 例（`device-readiness-gate` 已注册 CORE_SUITES；runner 加 `__testing_setDeviceReadinessGate` 注入缝）

## t4 invocation 内完成观测

- [x] 4.1 observer 进 agent 等待期，与 settle/hard timeout/silent race（`completionProbe` 注入面）
- [x] 4.2 抽纯只读 validator `phase-completion-probe.ts`（零写盘；不跑会改状态的 check-receipt CLI）
- [x] 4.3 本 attempt 新鲜度基线；基线已完整 → 记 `completion_evidence_pre_existing` 且探针恒 false
- [x] 4.4 分层：`agent-invoke` 只管 timer/race/kill，goal-runner 注入 `completionProbe` + 绝对 `deadlineMs`
- [x] 4.5 参数定值：poll 2s、grace `min(5s, deadline-now)`、半写入本轮未完成下轮重试且绝不转 completion
- [x] 4.6 收口：等 grace 自然退出 → tree-kill invocation → `completion_observed=true`，且 `agent_failed` 显式排除
- [x] 4.7 settle|timeout|abort 命中即 `clearInterval` 取消 observer；收口只杀 agent 进程树，不碰托管模拟器
- [x] 4.8 单测 9 例（`phase-completion-probe` 已注册 CORE_SUITES）

## t5 outer_layers 条件前移

- [x] 5.1 仅 chain 含 testing 时早检
- [x] 5.2 时点 = run/manifest 创建后、**整个 run 第一个 phase invocation 之前**
- [x] 5.3 失败写 `phase_halt(declared_product_layer_missing)` + `run_end=HALTED`；`--resume` 重检
- [x] 5.4 复用 `computeProductSourceSnapshotDetail`；testing pre-invoke 原校验保留作纵深
- [x] 5.5 集成单测：缺目录在首个 invoke 前 HALTED、零 `agent_invoke_start`、退出码 1

## t6 凭据授权与运行期解锁

- [x] 6.1 registry 入口 = `npm run device:policy`（`scripts/device-policy.ts --check --json`），主 agent 起 detached runner **前**执行
- [x] 6.2 未配置 → `device_policy_unset` + 四选一指引（含「绝不要让口令进对话」红线）；runner 侧只 fail-closed 复验、不交互
- [x] 6.3 已更新 `skills/project/goal-mode/SKILL.md`（首次启动前置）与 `skills/reference/goal-mode-operations.md`（新增设备策略与就绪门章节）
- [x] 6.4 `npm run device:enroll`：**真实 TTY 隐藏输入**（Read-Host -AsSecureString），非 TTY 拒绝；无 --pin/--secret argv 入口、不从 env 读
- [x] 6.5 Windows Credential Manager provider（CredRead/CredWrite P/Invoke）——**本机 spike 实测通过**（写入/读回一致/删除/删后读不到）；口令经 stdin 不进 argv
- [x] 6.6 凭据身份不可变：target 含 `credential_version`，轮换 version+1 新建、禁原地覆盖；helper 校验 serial 匹配（A 机凭据不用于 B 机）
- [x] 6.7 （随 t3 完成）`framework.local.json` device schema + ownership + loader + schema 文件 + round-trip/拒未知键单测
- [x] 6.8 机器级锁存 `ready|in_flight|disabled` + 跨进程文件互斥（有界等待/abandoned 接管）+ **durable commit**（fsync + 原子 rename）
- [x] 6.9 `disabled` 只能由新 `credential_version` 解除；源码级断言不得存在同版本 reset 接口
- [x] 6.10 运行期 `ensureDeviceReadyAtRuntime` / `withDeviceRecovery`：同 serial 恢复一次后重试原操作，禁热切模拟器；helper 永不返回凭据；**已接线至 `hdc-runner.runOnDeviceUt` 的 aa test 边界**（锁屏诊断命中才触发）
- [x] 6.11 输入机制：仅数字 PIN（手势/字母 unsupported）、坐标从锁屏 UI 快照解析（二轮改为单次 `snapshot`，见 S2）、0–9 不全即零输入、argv 只有坐标、输入后重新探测判定
- [x] 6.12 goal events 只落 `device_unlock_attempt` 审计投影，**不参与放行判定**（安全 SSOT 是机器级锁存）
- [x] 6.13 单测 35 例（credential-store 10 / unlock-helper 11 / policy-cli 6 / runtime-recovery 8）+ provider 真实凭据库 spike；**锁屏 UI 键位解析仍需目标 HarmonyOS 真机校准**

## ⚠ Review 未通过——上述勾选**不代表可合并**

2026-07-28 实现 review 发现 4 P0 + 11 P1 + 1 P2。**在下列缺陷修完前，本 change 不得视为完成。**
诚实说明：新增单测使用了同步返回 serial、人工构造完全相等的进程创建时间、"receipt 非空即完成"
等弱夹具，把下面几处生产路径缺口固化成了假绿——测试全绿不构成正确性证据。

### P0（重开事故风险，必修）

- [x] R1 **损坏锁存被当成首次使用** → **已修**：`readLatchFile` 三态（absent/ok/corrupt），`canAttemptUnlock` 对 corrupt 零输入 BLOCKED；空文件/身份不符/schema 不符均判 corrupt。回归 3 例。
- [x] R2 **分身份互斥保护不了共享锁存文件** → **已修**：改为每 identity 一个独立文件（`<store>.d/<serial>.v<N>.json`），tmp 名带 pid+随机后缀；不同 identity 物理上不共享写目标。回归 1 例。
- [x] R3 **abandoned 文件锁 ABA 竞争** → **已修**：锁内写唯一 token，接管与 release 均须 token 相等才删；接管后给一次抢锁机会（不按 deadline 立即超时），设接管次数上限防竞争风暴。回归 1 例。
- [x] R4 **`credential_version` 非机器级唯一** → **已修**：新增 `allocateCredentialVersion`，持分配锁扫机器级锁存目录取 max+1 并落占位；device-policy 不再从项目 local config 推导。回归 1 例。

### P1

- [x] R5 PIN 经 pipe → **已修**：新增 `provider.promptAndWrite`，`Read-Host -AsSecureString` 与 `CredWriteW` 在**同一 helper 进程内**完成，SecureString 直接交 CredWrite 并 `ZeroFreeBSTR`，Node 只收成/败；device-policy 的 `readSecretFromTty`（转明文回传）整删。回归含源码级反回归。
- [x] R6 完成探针未校验四条件 → **已修**：`receipt 结构标识 + summary 身份吻合 + receipt_status=passed + closure_status=closed` 四条件齐备才算完成，附 `missing[]` 诊断；反例用例覆盖"占位文本+裸 JSON""闭环未关""回执未过""身份不符"。
- [x] R7 基线完整仍启动 agent → **已修**：新增 `decideSkipAgentInvoke` 四条判据——基线齐全 **且** 非重试轮（`retries=0`）**且** 无回退交接待修 **且** 证据来自本 run。四条同时成立才跳过；任一不成立就真跑。这解开了此前"跳过会破坏 backtrack"的死结（根因是判据不足，不是跳过本身错）。回归 6 例。
- [x] R8 completion 与 hard-timeout 可同时成立 → **已修**：命中即 `clearTimeout` 取消 hard timeout，且 timeout 回调加 `completionObserved` 短路，双向互斥。
- [x] R9 模拟器 spawn 后立即取 serial 必空 → **已修**：新增 `awaitNewEmulatorSerial`，在有界预算内轮询"before 集合之外"的新目标；失败时**仍回传 identity** 以便回收。
- [x] R10 托管实例生命周期未真接线 → **已修**：`Date.now()` 与 CIM `CreationDate` 改**容差比对**（`PROCESS_START_TOLERANCE_MS`（二轮已收紧至 2s），此前严格相等导致正常终态也拒绝回收）；`registerManagedDeviceCleanup` 已在 gate 托管成功后注册、正常回收前反注册；新增**启动期对账回收**（上一 run 硬杀遗留）。
- [x] R11 真机 attest 占位 → **已改为正面证据判定**：`model + brand + hardware` 三者齐备且非模拟器标识才判 `physical`，任一缺失/不可读一律 `undefined`（→ unknown → testing 封顶）。属性键集合仍需目标机型回归校准，但**方向已是正面证据而非占位**。
- [x] R12 attempt 内凭据引用未冻结 → **已修**：gate 把 `credential_ref` 经 `extraEnv`（`MAISON_DEVICE_CREDENTIAL_REF`）冻结进子进程，运行期恢复优先用它，仅缺失时才回落读配置。
- [x] R13 运行期恢复只接 `aa test` → **已修**：`install` 与 `warmup` 两个边界同款接入（锁屏诊断命中才恢复一次，恢复失败如实失败、不重试不切目标）。
- [x] R14 四选一无落盘路径 → **已修**：新增 `npm run device:set`（`--manual-unlock` / `--emulator <档位>` / `--emulator-profile` / `--serial`），SKILL 更新为"写完重跑 device:policy 确认 code=ok"；回归断言 setPolicy 后 check 立即 ok、手工解锁清除残留 credential_ref。
- [x] R15 PowerShell target 注入面 → **已修**：新增 `SERIAL_PATTERN` 校验（登记入口与 ref 解析双向收敛），target 改经 `$env:MAISON_CRED_TARGET` 传递，不再拼进 -Command 源码。回归 1 例 + provider spike 复测通过。

### P2

- [x] R16 `Atomics.wait` 阻塞事件循环 → **已修**：`sleepSync` 整删，改 Promise + setTimeout；`ensureDeviceReady`/`resolveTarget`/`fallbackToEmulator`/`runDeviceReadinessGate`/`launchManagedEmulator`/`awaitEmulatorReady` 全链 async，runner 调用点 `await`。回归含源码级禁 `Atomics.wait`（只查可执行代码）+ 行为级"门等待期间其它 timer 照常触发"。

### 修复后必须补的集成测试（防再次假绿）

- [x] R17 并发/损坏集成测试 → **已补可做部分**（新套件 `device-concurrency`，用**真实子进程**而非同进程假并发）：跨进程 disabled 可见性、abandoned 锁接管、半写入锁存跨进程一致零输入、跨"项目"版本分配不撞号、identity 隔离。**仍未覆盖（须宿主真机回归）**：physical attestation 属性键校准、真实模拟器延迟 boot 与回收、锁屏 UI 键位解析——该清单已写进套件内一条显式用例，防"全绿"被误读成"全部验证过"。

### 本轮修复中新发现（未解决，必须在合并前定位）

- [x] R18 supersede 用例回归 → **已定位并修复**：**测试夹具缺陷**，`runs.sort().slice(-1)` 按字典序取"最新 run"，而 run id 是 `<秒级时间戳>-<随机后缀>`，同秒创建时字典序与创建序无关（约 50% 取错）。改按目录 mtime 取最新，连跑三次全绿。

## 实现 review 第二轮（2026-07-28）

### P0（已修，附回归）

- [x] S1 **文件互斥仍有 ABA**（token 校验与删除非原子，中间可被换锁 → 删掉新 owner 的锁 → 两进程并发输 PIN）→ 改用 **原子 `rename` 取走再校验**：rename 由文件系统保证唯一成功；内容不符则原样搬回。release 走同一路径。
- [x] S2 **PIN 输入未绑定同一份锁屏 UI**（`isLocked` 与 `readKeypad` 各 dump 一次，中间界面可能已切到应用；只要看见 0–9 就输入 → **PIN 可能被敲进应用**）→ 合并为单次 `snapshot(serial)`，键位**只从锁屏根组件子树**取，非锁屏时恒为空；冷却期标识同源产出（此前生产依赖根本没提供 `isInLockoutCooldown`）。
- [x] S3 **冻结设备只给了 agent，没给外层 harness**（gate harness 从 `process.env` 构造环境 → 多设备时退回 hdc 默认目标）→ `runHarnessPhase` 增 `deviceTargetEnv` 参数，与 agent 侧 `extraEnv` 同源注入。
- [x] S4 **托管模拟器 serial 关联不安全**（boot 窗口内任何新 target 都被认作本 run 的模拟器，含用户刚插的真机）→ 新目标须**同时**满足回环形态 + `attestPhysicalDevice` 明确判非真机。

### P1（已修）

- [x] S5 运行期 PIN 仍经 stdout pipe 回传 → provider 改 `inspect`（只回形态）+ `unlockWithStoredPin`（口令在 helper 内读出并直接驱动点击，hdc 只收坐标）；helper 侧不再调 `read()`。
- [x] S6 息屏时运行期恢复直接失败（先探测后唤醒）→ 调整为**先 wake 再取样**。
- [x] S7 identity 文件名碰撞（`A:B` 与 `A_B` 映射同一路径 → 共用锁存）→ 非纯字母数字的 serial 追加原文短哈希，保证单射。
- [x] S8 回收身份不足（10s 容差 + 未核对 profile）→ 容差收紧至 2s，并核对进程**命令行含本 session 的 profile**（同机多实例时 exe 相同不足以区分）。

### 第二轮遗留项处置（同日续做）

- [x] S9 正式 testing 链路接线 → **已修**：① `diagnoseHdcInstallFailure` **补 `device_locked` 分类**（此前从不产出该 kind，导致 install 侧恢复分支不可达、锁屏被归成泛化 `install_failed` 且指引指向"查签名"）；② `providers/device-test-install.ts` 装机边界接入恢复；③ `providers/device-test-run.ts` 的 `aa start` 预启动边界接入恢复。四个边界（UT aa test / UT install / testing install / testing run）+ warmup 全部同款语义。
- [x] S10 模拟器失败路径泄漏 → **已修**：① gate 在 boot/ready 失败时经 `orphanManaged` 交出 identity，runner 落 `status:'failed'` 的 session；② 新增 `collectForeignManagedSessions`，启动对账**扫 feature 下所有 run 目录**（此前只看当前 `report_dir`，上一个被硬杀的 run 的 session 在它自己目录里永远发现不了），回收后标记 `released` 防重复。
- [x] S11 可信 receipt validator → **已修**：回执按 **schema 2.0 必填字段**校验（`receipt_schema`/`feature`/`phase`/`claimed_completion_at`/`claimed_completion_commit_sha`），拒绝未填写的 `<...>` 模板占位，且回执与 summary 的 feature/phase **都必须显式吻合**（此前"字段缺失也算通过"）。
- [x] S12 配置切换非原子 → **已修**：`writeLocalConfig` 改 `临时文件 → fsync → 原子 rename`。
- [x] S13 `setup.device_policy` 进 registry → **已修**：`skills/reference/confirmation-registry.yaml` 新增该项（四选项 + portable menu + "PIN 绝不进对话"红线），`check-skills-confirmation-ux` 通过。

## 实现 review 第三轮（2026-07-29）

### P0（已修，附回归）

- [x] T1 **失败锁存可被删除后复位** → 根治：**删掉全部旁路状态文件**，让 OS 凭据库里那条凭据的 *形态* 直接编码状态（`absent` / `ready` = 裸 PIN / `in_flight` = `MAISON-CLAIM/<nonce>/<pin>` / `burned` = 墓碑）。失效方向由此翻转为 fail-safe：删 `~/.maison/*.json` 曾使锁存复位而口令仍在（**可再输同一个错 PIN**）；现在能删的只有凭据本身，删了就**结构上无法再试**。回归用位掩码遍历所有删除组合，断言没有任何一种能把 `canAttemptUnlock` 从 false 翻回 true。
- [x] T2 **rename 方案仍有 ABA** → 文件锁整删。互斥改由 `CredWrite` 的覆盖语义提供：读到裸 PIN → 覆盖写自己的 claim → **读回校验 nonce**，不是自己的就退出。claim 形态**永不自发退回 PIN 形态**（只有赢家 commit 时才写回），故不存在 ABA。回归用 `beforeReadback` 钩子构造真实交错（A 写完 claim、读回之前 B 整轮跑完），断言 `clickCount === 1`。
- [x] T3 **发布 runtime 仍有读回明文的接口** → `CredentialProvider.read()` 整删；测试用的内存 provider 移到 `tests/helpers/`（dev-only）。回归含源码级断言：接口无返回 `secret` 的签名、PowerShell 片段不把口令写 stdout、`scripts/` 下不得引用 fake provider。

### P1（已修，附回归）

- [x] T4 **凭据回落 + 只在失败后恢复** → ① 新增 `resolveAttemptCredentialRef`：gate 无条件注入 `MAISON_DEVICE_ATTEMPT_FROZEN=1`，冻结后**绝不回落读实时配置**（manual 模式起跑的 attempt 不会因运行中改配置而提权）；普通模式无此标记，仍按配置解析（两模式能力拉齐）。② 四处重复的恢复代码合并为 `device-recovery-bridge`，并在 warmup / testing install / testing run 的**操作前**接入 `ensureReadyBefore`。
- [x] T5 **testing run 恢复失败未落 external_block** → 新增 `RunFailureKind='device_locked'`；**并修好一个连带缺陷**：preflight 失败分支此前写了 trace 文件却 `return trace: null`，结论层永远读不到该 kind（写了等于没写）。`check-testing` 据此把 `blocking_class` 归 `externalBlocked` + `failure_kind='device_blocked'`，指引改为"人工解锁后重跑"。
- [x] T6 **托管模拟器跨 phase/resume 不复用** → gate 新增 `existingManaged` 输入；runner 传入本 run 的 `device-session`。需要降级时优先复用**此刻确实可用**（在 hdc 中 + 未锁屏）的既有实例，避免每个设备 phase 各起一个、后写的 session 覆盖前一个而让旧进程失去回收凭证。
- [x] T7 **新 emulator serial 未与本次进程关联** → 认领判据补第三条：端口的监听进程须在**本次 spawn 的进程树**内（`netstat -ano` 取 owner pid，沿 CIM 父链回溯）。判不出一律不认领——认领别人的模拟器意味着后续可能把它关掉。
- [x] T8 **回收身份三处 fail-open** → ① `spawnManagedDevice` 改 async，spawn 后立刻用**同一探针**读 OS 创建时间（含有界重试，覆盖 CIM 的百毫秒级延迟），回收侧因此可**严格等值**比对，容差常量整删；② 取不到命令行**也拒绝**（此前"能取到才校验"= 探针降级时校验被静默跳过）；③ 回收以**进程确实消失**为准（`probe.identify` 复验），不凭 `taskkill` 退出码。
- [x] T9 **完成探针判据太弱** → 补三条零成本形态校验（`receipt_schema === 2.0`、sha 为 7–40 位 hex、时间戳可解析）+ 与 `summary.source_commit_sha` 的**三方绑定**。**未**在探针内调用完整 `check-receipt`：它要 spawn git、读多份产物，放进秒级轮询会显著拖慢 run，且判错的代价是本轮重跑而非 fake-pass（真正的裁决仍在 gate）。此权衡已写进源码注释。
- [x] T10 **completion 与 silent 双重定性** → completion 命中时同时 `clearInterval(silentTimer)`，并在 silent 回调内加 `if (completionObserved) return;` 双保险（clear 与已排队的回调可能竞争）。
- [x] T11 **`Atomics.wait` 未整删** → 凭据侧的同步阻塞随文件锁一起删除；`spawnManagedDevice` 的重试等待用 `await sleep`。回归含源码级禁用断言。

### 本轮新发现并修复

- [x] T12 **中文经 env 传给 PowerShell 变乱码** → 由**真实 CM 集成用例**抓到：墓碑原因（中文）经 `$env:` 传入走系统 ANSI 代码页、回来的 stdout 也不是 UTF-8。修法：脚本头显式 `[Console]::OutputEncoding = UTF8`，原因文本以 base64(UTF-8) 传递并在脚本内解回。

### 验收状态

- 全量 unit 全绿；`device-*` 12 个套件 99/99，其中 `device-concurrency` 在**真实 Windows Credential Manager** 上验证了 `CredWrite`/`CredRead`/`CredEnumerate`/`CredDelete` 四个 P/Invoke 与跨进程 CAS（专属 target 前缀 + finally 清理，不碰用户已有凭据）。
- **仍需宿主真机回归**（无真机做不了，已写成套件内显式清单用例）：physical attestation 属性键校准、真实模拟器延迟 boot 与回收、锁屏 UI 键位解析、以及 `claim → 逐位点击 → commit` 的端到端链路（需真实 PIN，而发布代码刻意不提供写入明文的接口）。

## 实现 review 第四轮（2026-07-29）

上一轮 5 个封口项中 3 个未真正闭合。**均为我的实现缺陷，不是 review 苛求**。

### P0

- [x] U1 **`CredWrite` 覆盖 + nonce 回读不是互斥原语** → 上一轮的分析错了。合法时序：
  ① A 读到裸 PIN；② B 也读到裸 PIN；③ A 写 claim-A、回读 claim-A → 开始点击；
  ④ B 写 claim-B、回读 claim-B → **也**开始点击。`CredWriteW` 是 last-writer-wins，
  回读只能证明"此刻仍是我"，拦不住后来者。上一轮的测试只构造了"B 在 A 写完 claim 后
  才 read"（那自然读到 in_flight），**测的是我想证明的，不是我需要证明的**。
  修法：恢复 plan 原本要求的 OS 级 mutex（`System.Threading.Mutex`，跨进程），保护
  `read → 判形态 → write claim → 回读` 这段读改写；`reserveVersion` 同样保护，且锁
  **按 serial** 取（按 version 取等于各锁各的号）。
  临界区**刻意做短**——只覆盖读改写，不覆盖点击/复验/commit：claim 一旦落库就是
  **持久**排他标记，不需要 mutex 兜着。于是 mutex 只在单个 PowerShell 进程内持有
  几十毫秒，既不会跨进程调用丢锁，也不会因持有者崩溃把大家长期锁死。
  `AbandonedMutexException` 视为取得锁：前任只可能崩在"写 claim 前"（库里仍是裸 PIN）
  或"写 claim 后"（我们会读到它的 claim → BLOCKED），两种都安全。
  回归：新增 `insideCriticalSection` 钩子精确复现上述危险时序，断言闯入者
  `blocked_mutex` 且 `clickCount === 1`；另加源码级断言（须有 named mutex、须处理
  Abandoned、两处读改写都取锁、取锁有界、**点击不得在临界区内**）。

### P1

- [x] U2 **"操作前就绪检查"只是调用，不是硬前置** → 四处都只 `push(note)` 然后照跑；
  UT 侧压根没有前检；桥 catch 后还返回 `ready:true`，后置恢复会把它解释成
  `recovered:true` 并重试。修法：
  ① `RuntimeRecoveryResult` 增 `reason` 判别式，桥据此产出 **`blocked`** 字段——
  只有"确实锁着且没解开"（`unauthorized`/`unlock_failed`）才算外部阻断；
  **"判不出"不阻断**（一刀切会把 uitest 不可用之类的探测能力问题误报成设备阻断）。
  ② 四个边界在 `blocked` 时**一条设备命令都不发**，并产出与"装机时命中锁屏"同形的
  `device_locked` 诊断，让既有链路（`diagnoseInstallBlocking` → `externalBlocked`/
  `device_blocked`）照常生效；UT 侧补上前检。
  ③ `recoverAfterLockFailure` 不再把"没做检查"当成"恢复成功"。
  回归：不再只做正则匹配，而是**定位 blocked 分支并断言其中没有设备命令**
  （`installHap` / `runAaStartPreflight` / `runWarmupOnce` / `runAaTest`）。
- [x] U3 **旧托管实例不可用时仍会丢失回收凭证** → session 是单文件模型，新实例一写就
  覆盖旧记录；当前 run 又被 `collectForeignManagedSessions` 排除、退出清理只读最新
  session，旧实例的 pid 四元组就此永久丢失。源码里"旧实例仍由 session 对账回收"的
  注释与实际模型不符。修法：gate 增 `reclaimManaged` 能力，**新建前先回收旧实例，
  回收未确认（含"根本没有回收能力"）一律 BLOCKED 并把旧 identity 经 `orphanManaged`
  交出去**；runner 侧在覆盖 session 前再兜一道处置并留痕。
  回归：断言回收先于新建、回收失败时 `launches === 0` 且 `orphanManaged` 带旧 pid。

### 验收状态

- 全量 unit 全绿；`device-*` 14 个套件 117/117。
- 仍需宿主真机回归的项目不变（见第三轮记录）。

## 实现 review 第五轮（2026-07-29）

P0 已确认闭合（named mutex + 危险时序回归）。本轮 3 个 P1 边界，均属实。

- [x] V1 **install 前检可被卸载重装分支穿透** → 两条穿透路径：① 降级场景的
  `runUninstallOnce()` 排在前检**之前**，明确阻断前应用已经被卸了；② `blocked` 只
  构造失败对象却没短路，其后的公共重试 `if (!install.ok && uninstallBefore && ...)`
  在 `install.ok === false` 时照样 `bm uninstall` + `installHap`。
  修法：前检提到所有设备变更之前，整段设备操作收进 `else`（设备可用）分支；公共重试
  额外排除 `device_locked`（恢复失败后设备仍锁着，不得卸载重装）。
  **上一轮测试只扫 `if (blocked) {...} else {...}` 内部，没检查分支之后的公共代码**，
  所以没抓住穿透——本轮回归改为按**位置**断言：前检下标 < 降级卸载下标、公共重试
  必须落在"设备可用"分支之内。
- [x] V2 **install 的 `device_locked` 到不了 external_block** → `buildDeviceInstallFailResults`
  只重新调 `diagnoseInstallBlocking(projectRoot)`，而后者只探 HDC 在线性与版本，
  **手机连着但锁屏时通常返回 `clear`** —— provider 明明已判出 `device_locked`，结论层
  却当普通失败，`externalBlocked`/`device_blocked` 全丢。修法：把
  `res.install?.diagnosis?.kind` 传入，`device_locked` 优先于重新探测直接产出
  `externalBlocked` + `device_blocked`。回归含"优先级"断言（该分支下标 < 重新探测下标）。
- [x] V3 **回收漏 `serial:null` 与"进程已退出"两个可达状态** →
  ① 复用/回收判据从 `reusable.serial && reusable.identity` 改为 **`reusable.identity`**：
  启动失败的 session 允许 `serial:null` 而 `managed` 有值（gate 自己就写这种记录），
  上一版会整段跳过回收直接起第二个实例，旧的永久泄漏。
  ② `reclaimManaged` 返回值从 `boolean` 改为三态 **`reclaimed | already_absent | refused`**：
  `reclaimManagedDevice` 对"pid 已不存在"返回 `action:'none'`，那是**没有遗留**而非
  回收失败；上一版只认 `reclaimed`，于是这个最常见的情况导致永久 BLOCKED。
  现在前两态允许新建，只有 `refused` 阻断。
  ③ runner 覆盖 session 前的兜底不再"只记录"：`refused` 时 halt（`managed_device_session_conflict`，
  带 `externalBlocked`/`device_blocked` 契约），因为覆盖就等于永久丢失回收凭证。

### 验收状态

- 全量 unit 全绿；`device-*` 14 个套件 **121/121**。
- 仍需宿主真机回归的项目不变（见第三轮记录）。

## 宿主问答暴露的能力缺口（2026-07-29，已修）

- [x] W1 **设备策略前置只接了 goal 模式** → 用户问"非 goal 模式开发时难道不会主动问吗"，
  核实属实：`grep -rln device_policy skills/` 只命中 goal-mode 与 registry，
  `business-ut`（`ut.run` 需真机）与 `device-testing` 两个普通模式入口**一个都没接**。
  根因是 Todo 5 只按 plan 的字面（`outer_layers`，goal 的概念）实施，没往普通模式推，
  违反框架自己的"goal 与普通模式能力持续拉齐"原则。
  **后果是可用性不是安全**：就绪门照样挡住锁屏、不会去猜密码，但用户在普通模式下只会
  看到一句干巴巴的"设备锁屏"，没人告诉他还有"启用自动解锁"这个选项；且 testing 侧
  （`check-testing` 的 suggestion）有登记提示而 UT 侧没有，两条路径提示还不一致。
  修法：
  ① 新增 `skills/reference/device-policy-gate.md` 作**单一 SSOT**（同 `personal-setup-gate`
     惯例），goal-mode 由整段自述改为引用 + 就地保留 detached runner 的紧迫性与 PIN 红线；
     `business-ut` / `device-testing` 前置各加一行引用——避免同一段在三处抄三遍必然漂移。
  ② 统一 blocked 指引：`ensureDeviceReadyAtRuntime` 的 `unauthorized` note 补上"可由用户
     本人在自己终端 `device:enroll` 登记"，四个边界一并受益。
  ③ **元门禁** `skills-device-policy-gate.unit.test.ts`：由 profile 的 `device_capabilities`
     × `PHASE_CAPABILITY_MAP` **推导**哪些 phase 需设备，再断言其承载 skill 必须引用门文档；
     另有一条断言盯着 `PHASE_SKILL` 登记表必须覆盖 `PHASE_CAPABILITY_MAP` 全部 key
     （新增 phase 漏登记即红，不静默假绿）。已做**负向验证**：删掉 business-ut 的引用后
     该套件立刻变红，还原后恢复。

## 缺口补丁的 review（2026-07-29）

三条全部属实，且 P1-1 比 review 描述的更严重（实测 `exit=3` 而非 1）。

- [x] X1 **`device:policy` 不是文档承诺的"纯 JSON 接口"** → ① `npm run` 会往 stdout 插
  banner（`> harness@1.0.0 device:policy` 两行），JSON 无法直接 `JSON.parse`；
  ② 未配置时**退出码 3**——agent 极可能当成"命令失败"而不是读 `code` 去问用户，
  四选一的闭环就此断掉。修法：`--json` 模式改 `process.stdout.write` 纯输出 +
  **退出码恒 0**（`device_policy_unset` 是正常状态不是失败；人读模式保留非零，
  在 shell 里那才是"要你处理"的信号）；文档/三个 skill 的命令统一改为直接调脚本
  `npx ts-node scripts/device-policy.ts --check --json`（与 personal-setup-gate 同惯例）。
  另补 `--project-root`（同 `check-personal-setup` 惯例，多仓/发布包布局必需）。
  **回归是进程级的**：真实子进程断言 stdout 可直接 parse + 退出码契约；已做负向验证
  （把退出码改回 3 → 用例立刻红并指出 `实得 3`，还原后恢复）。
- [x] X2 **"允许模拟器降级"授权粒度不足** → 文档把 `existing`/`managed` 合成一个选项，
  落盘命令却直接写死 `--emulator managed`。「允许降级」**不等于**「同意框架主动拉起并
  托管模拟器」——后者会 spawn 进程、收尾时 kill 进程，是另一个量级的授权。修法：③ 之后
  **必须追问档位**（`existing` 只复用绝不启停 / `managed` 启动并回收），选 `managed`
  还须再确认具体 emulator profile（AVD 名），**禁默认托管**；registry notes 与三个 skill
  的引用同步写明。
- [x] X3 **registry 的 ④ 自相矛盾** → 原文"①③④ 由 agent 自跑 `npm run device:set`
  （④ 不持久化）"，但 ④ 不持久化就不该跑 `device:set`，CLI 也没有 stop 动作。
  改为明确分工：**①③ 落盘 / ② 用户在自己终端登记 / ④ 不执行任何命令，直接停止本次运行**。

## 文档契约收尾（2026-07-29，两条 P2）

- [x] Y1 **登记后的复检仍残留旧命令** → 门文档第 75 行还写 `npm run device:policy`，
  与前文"不要走 npm run"自相矛盾，照跑会重新引入 stdout banner。已统一为
  `npx ts-node scripts/device-policy.ts --check --json`；元门禁加断言**全文不得残留**
  该命令（已负向验证：写回旧命令即红）。
- [x] Y2 **"退出码恒 0"表述过于绝对** → `device_policy_unset` 与 `ok` 确实都回 0，但
  真实执行错误仍会非零（实测：`framework.local.json` 损坏 → **exit=1 且 stdout 0 字节**）。
  原文"不要据退出码判断成败"会让 agent 带着坏配置继续跑。改为**两段判定**：
  ① 退出码 0 **且** stdout 合法 JSON → 看 `code`（`device_policy_unset` 属正常结果）；
  ② 非零 **或** stdout 非合法 JSON → 执行失败，必须停止并把原因交回用户。
  三个 skill 的同款绝对化表述一并改。**加进程级回归给第 ② 段背书**：构造损坏配置，
  断言非零退出 + stdout 不可 parse + 原因进 stderr——防文档再次说一套代码一套。

- [x] Y3 **registry 的同款绝对化表述**（第三方 review 抓到）→ 上一条只改了门文档与三个
  skill，`confirmation-registry.yaml` 自己仍写"该模式退出码恒 0"。已同步为两段判定。
  **这是同类残留漏的第二次**（第一次是门文档第 75 行的旧命令），说明"只盯单个文件"的
  断言必然重蹈覆辙——元门禁改为**枚举全部承载该契约的文件**（门文档 + registry +
  goal-mode + 各 phase skill）逐一检查旧命令与绝对化表述，已负向验证：把绝对化表述写回
  registry，用例立刻红并**精确点名该文件**。
