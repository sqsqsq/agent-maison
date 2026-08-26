# Design — delegated vision provider

## 1. 一句话不变量

**provider 不能写工程；不能用旧的或坏的 provider 结果制造 PASS；合法启动后的 provider 运行时故障
只降级本轮视觉反馈，不阻断开发循环。**启动前缺 provider 与缺盲跑授权是独立的配置契约，按 §9 的
五分支矩阵处理；其余问题一律局部降级，不挡 primary 继续编码、构建、测试。

修复原则对齐既有「一个问题一个权威」：产物写者唯一归 primary；「能否推进」唯一归 gate；provider
是**有证据要求的视觉检查工具**，不是第二个 goal agent——无 owner、无 phase 状态机、无 closure；
调用失败不反向改写能力真值；没有可信 provider 的路径诚实落盲档。

## 2. 为什么删掉 provider canary

早期设计给 provider 也配一次金丝雀判卷。删除理由：

1. **真实调用即探测**——review/sidecar 调用本身就会暴露「CLI 缺失 / 模型拒图 / 信封坏」；再加一层
   事前判卷只是把同一次失败提前一次，却引入了「金丝雀过了但正式调用挂了」的双真值。
2. **避免 OCR 链污染**。现行 `resolveOcrAvailableForRun` = 本地工具链 ∨ canary `ocr_capable`。多一个
   provider canary 就多一个能写 `ocr_capable` 的源，会把「provider 能读文字」混进 primary 的 OCR
   能力判定。无 provider canary = 无污染源 = **OCR 链、tessdata、全部 OCR 门禁零改动**。
3. primary canary 机制**零改动**——本变更不碰 `canaries[]`、不做多槽化。

代价：delegated 的解锁条件只能是**静态资格**（配置在场 + 完整声明 + model 显式）。防假 PASS 因此
不靠事前探测，而靠三层既有兜底：同调用载荷校验 → 既有 `VISUAL_PENDING` 投影 → `pixel_1to1` 人签。

## 3. 为什么是 `reviewVision?` 而不是给 `hasVision` 改名

`hasVision` 的语义是「**primary** 能不能看图」，被 prompt 组装、closure read requirement、
tool-event provenance 分轴等多处消费。全局改名会把这些点一起卷进来，且每一处都要重新判断它想问的
到底是 primary 还是 reviewer。

改为在 `FidelityCapability` 上加**可选** `reviewVision?`，`clampFidelityByCapability` 内取
`capability.reviewVision ?? capability.hasVision`：

- 不传 `reviewVision` 的旧调用面**逐字不变**（零回归面）；
- 只有 delegated 判定点显式传 `true`；
- `blind` 钳制表逐字不变，`native` 行为不变，`delegated` 放行 `pixel_1to1`。

「钳制吃 review 轴」是本变更的核心语义：保真档位是**验收承诺**，取决于「检查者」能否看图，而不是
「书写者」能否看图。

## 4. 只读 invoke：为什么必须独立构造 plan、又必须复用既有 invoke

现行普通 headless argv **恒全权限**（bypass / danger-full-access / --force --trust）。直接复用给
provider 等于「名义只读、实际全权限」——这是首期唯一硬边界上的直接违反，因此 argv 必须独立构造。

但**生命周期不能重造**。e6 的既有分层是：`invokeAgentHeadless` 负责 child spawn / timeout /
tree-kill / terminal failure 优先仲裁 / stdout-stderr 汇集 / usage 回填；terminal scanner 只判终态；
正文投影是独立纯函数；usage 在 invoke 内回填进结果。provider 若自建 spawn/timer/kill/parser，就会
出现第二套超时语义与第二套失败仲裁——这正是历史事故的形状。

因此模块边界写死为：

```text
adapter.yaml.visual_provider          →  resolveVisualProviderInvokePlan()  →  只读 HeadlessInvokePlan
                                                                                     │
                                          既有 invokeAgentHeadless(plan, cwd, opts)  ←┘
                                                    │  （spawn/timeout/kill/terminal/usage 全在这里）
                                                    ▼
                                          AgentInvokeResult
                                                    │
                        stdout_envelope 选择既有投影函数 → 正文 → 统一载荷校验 → 采信 / 丢弃
```

`timeoutMs` 走既有 `AgentInvokeOptions`；usage 只读 `AgentInvokeResult.usage`，不再单独派生。

接线要点（细节以锁定版本 help + 真实 smoke 为准；下表已按 tasks 7.7 宿主实测回填）：

| adapter | 只读手段 | 图片入口 | 正文投影 |
|---------|----------|----------|----------|
| claude | 工具集合收敛到 Read（`--tools Read`，init 事件实证 `tools:["Read"]`）+ 显式拒 MCP 工具；`--safe-mode` 只压定制面 | prompt 明列真实路径，由 Read 读 | 既有 stream-json 终态 result 投影 |
| codex | `--sandbox read-only`（顶层 approval never + `exec` 顺序沿用 e6 已验证形态） | 原生 `--image <path>` | `turn.completed` 且无 `turn.failed` 才投影 agent message |
| opencode | `OPENCODE_PERMISSION` inline JSON 把非只读工具置 deny + `--pure` | 原生 `--file <path>` | NDJSON：取 `type==='text'` 行末条 message 的 `part.text`，锚 `step_finish`，见 `type==='error'` 判无终稿 |
| ~~cursor~~ | ~~`--mode ask`，禁 `--force`~~（第一期不入册：免费档不可指定模型，与 model 真实回放互斥；机制留词表待第二期） | ~~prompt 明列真实路径~~ | ~~JSON 的确定性 final result~~ |

**若锁定版本实测不支持声明的隔离，该声明不得入册**——不允许「退回工程默认配置启动」。

claude 一行的措辞经 tasks 7.7 订正，原写「`--safe-mode` 隔离 settings/hooks/…」**与锁定版实测不符**：
其 `--help` 原文即 "Auth, model selection, built-in tools, and permissions work normally."。天然 A/B
实证该档位**穿透** safe mode——同一份 argv，用户级 `~/.claude/settings.json` 的
`permissions.defaultMode` 从 `bypassPermissions` 改为 `auto`，子进程 init 的 `permissionMode` 随之
改变；safe mode 只压定制面（skills 23→17、slash 64→45）。

**物理只读因此由 `--tools Read` 单独承担，且该单点已在最坏组合下实证成立**：负例对照用显式
`--permission-mode bypassPermissions` + 中性措辞命令 provider 写文件，模型真实尝试后回报
"I only have the `Read` tool available in this session—there's no Write, Edit, or shell tool
provided"，目标文件未创建、`porcelain` 前后一致、事件流零写类工具调用。即**无写工具即无写路径，
与权限档位无关**。

**裁决（2026-08-26）：首期不补 `--permission-mode`。** 权限档位只决定「已有工具是否免确认」，
无法凭空增加写工具；物理只读由工具可见性（`--tools Read`）保证，纵深防御不是当前正确性所需，
按裁剪原则不加。**复检触发条件**：升级 claude CLI 锁定版本时重跑 tasks 7.7 smoke——若 `--tools`
语义或 init 事件的 `tools` 回报发生变化，本裁决须重审（见 tasks 7.7a 记录）。

## 5. fail-closed 结果 × fail-open 循环的接线为什么必须写死

「provider 坏了就复用既有投影」不会自动发生。事实：严格 dispatch 对 pending 屏在
`ui_change=new_or_changed` 下判 **BLOCKER FAIL**（P0 屏 pending / 全屏 pending 两条），照常执行会把
phase 挡死——与 fail-open 恰好相反。

因此接线写死为：provider `unavailable|invalid` 时**跳过严格 dispatch**，返回既有 `visual_diff`
CheckResult `{severity:'BLOCKER', status:'SKIP'}`。随后全部走既有链，零新增：

```text
非 MINOR 的 SKIP  →  visual-debt needs_human 债务  →  visual 轴投影 UNVERIFIED
                                                    →  countBlockingDebt >0 → release BLOCKED
SKIP ≠ FAIL       →  phase 照常推进
```

三态同时成立：**开发循环 PASS / visual UNVERIFIED / release VISUAL_PENDING**。

## 6. provider 缺陷为什么不进 `repair_adjudication_pending`

既有感知信号管线要求 producer 信号先经 testing agent 的 `defect-review` 复核，unreviewed 即停等求人。
provider **必然后于 primary 运行**，结构上永远 unreviewed——照搬会让每一个 delegated 轮次都停下来
求人，等于 delegated 白做。

同时「让盲的 primary 去复核 provider 的视觉缺陷」是**伪制衡**：复核者根本看不见图。

所以裁决契约收敛为两句：**合法载荷 = 可直接回修的 critic candidate（非绝对真值），直接物化驱动
primary 修复；无效载荷 = 丢弃 + 记事件 + 本轮按 blind 语义继续。**既有 T8 感知信号管线原样保留，
一个字不改。

## 7. 受理与披露分立

误伤风险：codex / opencode 做 provider 时没有结构化验读事件解析器，receipt 只能记
`unverified`。若把 `unverified` 当「无效」，这两个 provider 的合法评审会被整体丢弃。
tasks 7.7 已实证这不是假想风险：codex 与 opencode 两次真实调用都 `input_provenance=unverified`，
而它们的载荷同时通过了 schema + 身份回显 + 当前图片 hash 校验，且随机金丝雀四象限 4/4 命中——
**披露等级低 ≠ 结果不可信**，这正是受理与披露必须分立的实测依据。

分立规则：

- **采信判据**只有一个——同调用载荷校验（stdout 投影 + schema + 身份回显 + 当前图片 hash）；
- **无效**仅指载荷校验失败（缺失 / 坏 JSON / 漏屏重复屏 / 身份不符 / hash 不符 / 旧 attempt）；
- `input_provenance` 只是**证据等级披露**，不是门槛；receipt 任何情况不 halt、不停等。

## 8. 明确裁剪（不做什么）

- 无 provider canary / 多槽化；无 OCR 分轴改造；不全局重命名 `hasVision`。
- 无图片暂存复制——物理只读靠 argv，直接读工程原图，receipt 图片路径天然一致。
- 无稳定 finding 身份层、无输出载荷签名（降后续加固）。首期采信 = 同调用校验 + 原子覆盖 +
  调用前清旧 + 禁跨 attempt 复用。
- 无新 UNVERIFIED check 载体 / 新质量轴 / 新状态机 / 新 check id；t7 仅在既有启动期
  `phase_halt`/`run_end` 事件形态中登记专用 reason，不给 provider 运行时新增 halt。
- 首期单 provider：一次 run = 1 primary + 1 visual endpoint。机制 adapter 通用，但支持列表只由
  `adapter.yaml.visual_provider` 完整声明派生；非 provider 池、非自动 fallback、不自动推荐或替换。
- 不按 phase 切控制权；provider 无 owner / 状态机 / closure / 第二 gate。
- 人签判据零改动；provider 输出不构成人签；`pixel_1to1` 终签保留。
- 不自动 revert provider 弄脏的工作区（检测 + 丢弃 + 记录）。
- spec sidecar 不产 check。

## 9. 兼容性

provider 产物与运行时降级保持兼容；t7 只收紧 UI blind 的启动条件：

| 载体 | 旧数据 | 语义 |
|------|--------|------|
| `CapabilitySnapshot` | 无 `vision_mode` / `visual_provider` 键 | 现状语义不变 |
| `GoalManifest` | 无 `visual_provider_pin` 键 | provider pin 条件入身份哈希 ⇒ resume 不误判漂移 |
| `GoalManifest` | 无 `allow_blind_visual` 键 | 可加载；UI blind resume 若要新增授权须显式旗标 + `--override-manifest` |
| `FidelityCapability` | 不传 `reviewVision` | 钳制结果逐字不变 |
| `visual-diff.json` | `defect.source` 缺失或 `producer:'T8'` | 现状判定不变 |
| `framework.local.json` | 无 `vision.visual_provider` | 非 UI/native 不变；UI + primary blind 须 run 级明确授权 |

授权不写 `framework.local.json`，successor 不继承。合法 provider 选定并通过启动矩阵后，后续
provider 调用恒失败仍与既有盲档运行时降级等价，不重复要求授权。

## 10. 诚实边界

delegated 消除的是「人工逐轮看图」与「盲档一刀切降档」；它**不承诺 provider 评审等效人眼**。
已合法启动后 provider 恒失败的 run 与现状盲档运行时等价（经既有 `VISUAL_PENDING` 投影，零新
状态、零二次授权）。`pixel_1to1` 的最终真人确认不因 provider 而减免。
