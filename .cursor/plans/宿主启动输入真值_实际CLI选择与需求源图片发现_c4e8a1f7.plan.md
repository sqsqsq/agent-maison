---
name: 宿主运行边界真值 — 实际 CLI、需求源图片与视觉证据可达性
version: 3.0.0
todos:
  - id: t1-headless-runtime-truth
    content: "P0 · headless runtime 真值、硬失败短路与 CodeAgent Goal-mode 放行——只改现有 `resolveHeadlessBinary`：外层保持 adapter candidate-name 顺序（含 Cursor `cursor-agent`→`agent` fallback），每个 name 内按 `where.exe`/PATH 目录原顺序取首个 Maison 在 Windows 明确支持的执行形态；不得跨目录偏好 `.exe`，extensionless POSIX/ELF shim 不得仅凭存在就判为可 spawn。preflight 返回本 execution session 的 resolved binary，adapter version probe、vision canary 与正式 phase invoke 全部复用该绝对路径（resume 新进程重新解析），从结构上保证 probe/invoke 同一身份；既有 `adapter_probe` 增补 `resolved_binary` 与被遮蔽候选诊断，禁止另建 CLI registry/lockfile。把既有 canary hard-CLI 判定抽成共享纯函数并增加已恢复的 Codex 结构化 `status=400 + invalid_request_error + requires a newer version of Codex` 精确签名；同时在既有 agent-invoke 结果边界把 guardian 自有的 CreateProcess/Assign/Resume 确定性建立失败投影为同一 `spawn_error` 事实，判定须绑定 `[maison-guardian]` 与稳定 ASCII operation marker，禁止依赖可能乱码的本地化文本或仅凭 `exitCode=2`（真实 agent 也可能返回 2）。正式 phase invoke 命中上述 hard failure 后，在 harness 前直接 `phase_halt(adapter_cli_hard_failure)`，incident 登记为 external，零内容 retry、零伪 `spec_file_exists` 归因；普通 agent 内容失败（含无 guardian 诊断的 exit 2）保持既有 harness/retry。按用户产品裁决删除 `assertAdapterHeadlessFullPermission` 对 CodeAgent 的专门拒绝并同步 adapter 注释/测试；复用既有 `--dangerously-skip-permissions`、stdin、stream-json 与 Read parser，Chrys 继续拒绝，不增实验开关、授权状态或推测性 flag 签名。CodeAgent 放行作为 T1 内独立小提交，宿主真实 smoke 再验证旗标与全权限事实。"
    status: in_progress
  - id: t2-requirement-source-provenance
    content: "P1 · `--requirement-file` 来源保留与同目录参考图贯通——共享 resolver 在仍只解析一次的前提下返回 frozen text + 可选 `requirement_source_files[]`；fresh goal manifest 持久化项目根相对来源列表并纳入 identity hash，resume 只读冻结值，successor 继承并在显式 file 增量时去重追加。goal-mode-entry 与 fidelity-intent-init 使用同一结果；phase-driven fidelity-intent SSOT 以可选字段保留同一来源，不建第二份图片清单。单一 bounded discovery 的集合语义冻结为：需求文本中可解析的显式项目图片 UNION 项目内 requirement source 各直接父目录的一层受支持图片，canonical path 去重并确定性排序；仅当该并集为空时 fallback 到 feature `ux-reference/`。inline requirement 不触发 sibling 扫描；项目外 source 继续只读正文、不扫描外部 sibling。该同一发现结果必须同时作为 capability `derive.visual-reference` 依赖、spec OCR 预扫、phase prompt authoritative paths，以及既有 reference mapping gate / `vision/spec-refs-receipt.json` 生产与验证的期望分母；agent/spec 少声明任一发现图片必须失败，禁止再由 spec 自己缩小分母。复用现有 receipt/gate，不建 reference-image manifest，不复制图片、不全仓搜索或要求宿主改写需求。"
    status: in_progress
  - id: t3-adapter-visual-evidence-truth
    content: "P0 · adapter 视觉答卷真值与证据可达路由——inline canary 签发点删除 `isCanaryAnswerComplete + classifyCanaryResponse(raw mixed log)` 分叉，统一复用既有 `resolveCanaryCacheDecision/parseCanaryAnswer`：Claude/CodeAgent 继续以纯 `agent-events.jsonl` 的 structured final-result 语义判卷，非结构化 adapter 只消费本次 `invoke.stdout` 与 `exitCode/timed_out/silent_killed/skipped` 事实，不把 stderr、prompt echo 和人读混合日志当答卷；有效尾部答卷可签 capability receipt，独立 `CANNOT_SEE_IMAGE`/纯回显/调用失败不得签。能力与可审计性分轴：Codex 即使 canary=tool_read，`tool_event_provenance=none` 仍不得签逐图 refs receipt 或 `vl_multimodal`；prompt、closure-only 读图块、retry guidance 与 `skills/feature/spec` 自检须按 provenance 明示可达出口——none 时继续用图片完成工作但产物诚实写 `verified: unverified`，structured_events 才要求本 invoke 逐图 Read 并争取终签。复用现有 soft/hard gate：best-effort + warn/reachable 以 WARN 可继续，hard contract/严格档仍 FAIL；虚假 `verified + vl_multimodal` 继续拒绝。不新增解析器、receipt、状态或证据层，不从普通文本猜 Read，不在本 change 接入未经实采的 `codex exec --json`。"
    status: in_progress
  - id: t4-contract-regression-and-closure
    content: "契约、事故回归、宿主回灌与收口——建立一个 OpenSpec change，修改既有 goal-runner / harness-gates / agent-adapters 契约：①Windows runtime、probe/invoke 同身份、hard CLI/guardian 早停与 CodeAgent 放行；②file requirement source 与共享图片期望集；③canary 判卷 SSOT、视觉能力/工具事件证据分轴及诚实降级。回归覆盖：Windows 四项真实候选选中 npm `codex.cmd`、Cursor fallback；0.138 事故 400 冻结为 `formal_invoke_attempts=1`、`harness=0`、`content_retry=0`，guardian error 5 冻结为 `guardian_attempts=1`、`agent_process_started=0`、`harness=0`、`content_retry=0`，普通内容失败/无 guardian 诊断 exit 2 仍跑 harness；三张 source 图片贯通 capability/OCR/prompt/reference gate-receipt 且 spec 漏一张失败；prompt echo 含占位键和 `CANNOT_SEE_IMAGE` + 尾部正确答卷须签 capability receipt，纯 echo/独立盲声明/失败 invoke 不签，Claude/CodeAgent structured 路径不回归；Codex none-provenance + best-effort/reachable + unverified 为 WARN，hard contract 仍 FAIL。目标测试与 typecheck 后只在首次整批收口跑 `cd harness && npm test`、`npm run openspec:validate`、plan/version/diff 检查。打包回灌后先做 bounded 宿主验证：Codex 复放第三次事故路径；CodeAgent 先记录 `--help`/version，再跑最短 Goal-mode smoke，验证无审批启动、shell、项目写入、stream-json 与图片 Read 事件；若真实 flag 错误则停在 hard-CLI 证据并据实追加签名，不预猜。release 门禁仍留发布阶段。"
    status: in_progress
overview: >
  2026-08-23 三次宿主 run 连续暴露 runner 边界真值缺口，并形成一项 CodeAgent 支持裁决。其一，
  Windows binary resolver 会跨 PATH 目录全局偏好 `.exe`，从而跳过前面的 npm `codex.cmd`；
  version probe 观察到 codex-cli 0.138.0，正式 invoke 独立返回 gpt-5.6-luna “requires a newer
  version of Codex”；当时 probe/invoke binary 尚未绑定，旧产物不能证明两者是同一 executable。
  runner 仍继续跑 harness、误归因 spec_file_exists 并重复调用第二次。升级后的第二个 run
  20260823T160926Z-426f2a 又证明 guardian 内部 CreateProcess error 5 同样会漏过 hard-failure
  边界并跑 harness。
  其二，`--requirement-file` 的共享解析器明确“只读取内容”并丢弃文件路径，后续参考图发现
  只能检查正文显式路径和目标 feature/ux-reference；bc-openCard-1 的三张真实图片就在权威需求
  文件同目录，仍被误报为不存在。其三，run 20260823T161102Z-68480b 中 Codex 已答对 inline
  canary，但非结构化分支把含 prompt echo 的混合日志全文判卷，三次均拒签 capability receipt；
  同时 Codex 无结构化 Read 事件，却被指引反复追求不可达的 refs receipt/vl_multimodal 终签。
  此外，CodeAgent 的全权限 argv、stdin 与 structured Read 链已存在，当前仅因未宿主实测的
  人工拒绝分支无法进入 Goal-mode；用户已裁决放行并由宿主实测。本 plan 统一修正 runtime、
  requirement provenance 与视觉证据可达路由，不降低视觉信任门槛，也不增加新账本/解析器。
isProject: false
---

# 宿主运行边界真值：实际 CLI、需求源图片与视觉证据可达性（c4e8a1f7）

状态：**已终审（v3），未开工**

## 1. 三次事故与一项支持裁决的共同边界

三次宿主失败都不是“agent 没能力”，而是 runner 在输入、启动或证据边界丢失/混合了已经掌握的确定性事实；CodeAgent 则是已有能力链被一条临时产品拒绝挡住：

```text
PATH 中多个 codex
  → resolver 跨目录偏好任意 .exe，且把 extensionless shim 当可执行
  → probe 与正式 invoke 未绑定同一绝对 binary
  → 模型兼容 400 / guardian CreateProcess 失败被当普通内容失败
  → 跑无意义 harness + 重试

--requirement-file 原始路径
  → resolver 只留下正文
  → “本文件同级目录”失去锚点
  → 三张真实参考图被判不存在
  → spec readiness 假阻断

Codex inline canary
  → 本次 invoke 的 stdout 已有正确尾部答卷
  → runner 却读取含 prompt echo/stderr 的人读混合日志全文
  → prompt 内的 CANNOT_SEE_IMAGE 污染分类
  → capability receipt 三轮拒签 + 反复追求不可达的逐图 Read 终签

CodeAgent Goal-mode
  → full-permission argv、stdin、stream-json、Read parser 均已存在
  → preflight 仍以“未做宿主实测”为由固定拒绝
  → 用户已经决定放行，真实 CLI 风险应由统一 hard-failure 边界承接
```

共同修复原则：**事实在哪一层形成，就在该层保留其身份和边界，后续复用既有 SSOT；不要让 agent 猜、不要把人读混合投影当机器证据，也不要让宿主搬运数据。**

## 2. 已核实事实

| # | 事实 | 证据 |
|---|---|---|
| 1 | 事故 run 的 `adapter_probe` 记录 `codex-cli 0.138.0`，正式 invoke 独立返回所选模型需要更新 Codex；因两条调用当时未绑定同一 absolute binary，旧产物不能证明两者是同一 executable | 宿主 run `20260823T150444Z-61d8be/events.jsonl`；本 plan 事实 #5 |
| 2 | 同一硬失败被调用两次；每次之后仍跑 harness，最终以 `spec_file_exists` / `no_progress_guard` 停机 | 同 run `events.jsonl` |
| 3 | `pickBestCandidate` 会在 `where.exe` 全部结果中先找任意 `.exe`；`resolveViaPathWalk` 也会越过前面目录的 `.cmd` 继续寻找后置 `.exe` | `harness/scripts/utils/headless-binary-resolve.ts:19-66` |
| 4 | 当前机器 `where.exe codex` 的完整顺序为 npm `codex`/`codex.cmd`、WindowsApps `codex`/`codex.exe`；两个 extensionless 文件分别为 `#!/bin/sh` shim 与 ELF，均非 Windows 原生执行入口，现 resolver 却全局选择最后的 `.exe` 且直接执行 Access denied | 本轮本机复核文件头与执行结果 |
| 5 | `adapter_probe` 用 adapter 配置中的裸 token 跑 `--version`，不是 preflight 已解析的 absolute binary，因此 telemetry 与 invoke 身份没有结构性同一保证 | `goal-runner.ts:4802-4819` |
| 6 | 升级后的 run 中 Node 成功启动 PowerShell guardian，但 guardian 因 `CreateProcess(CREATE_SUSPENDED)` error 5 以 2 退出；runner 仍跑两次 harness 并伪归因 `spec_file_exists` | 宿主 run `20260823T160926Z-426f2a/events.jsonl:7-21`、`phases/spec/agent-output.log` |
| 7 | guardian 的 2 表示自身 containment 建立失败，但正常收尾会透传真实 agent exit code，因此消费侧不得仅凭数字 2 分类，必须绑定 guardian 自有精确诊断 | `agent-guardian.ps1:25-30,374-428` |
| 8 | 首次事故的 phase log 后被 resume 以 `flags:'w'` 覆盖；不过真实 400 信封已从当时的 Codex 会话命令输出恢复，可直接脱敏固化 fixture，无需重新安装旧 CLI | `agent-invoke.ts:1119-1131`；本轮恢复记录 |
| 9 | `resolveRequirementInput` 明文规定“只读取内容”，返回类型也是 `string`；manifest 没有来源字段 | `goal-manifest.ts:443-479`、事故 run `manifest.json` |
| 10 | 参考图发现当前只有正文显式路径与 `<feature>/ux-reference/` 两级输入 | `fidelity-shared.ts:1251-1277` |
| 11 | 权威 `原始需求.md` 写明图片归档在同级目录；同级三图与另一目录的需求原名副本逐个 SHA-256 完全一致 | `doc/features/原始需求/1-1-银行卡/` 本轮核验 |
| 12 | capability entry 已从当前 goal manifest 取得 normalized requirement，却没有 source 字段；`derive.visual-reference` 又退回扫描历史 intent 文本 | `capability-resolution-entry-input.ts`、`capability-resolution.ts:245-277` |
| 13 | prompt 只有无视觉时的 OCR JSON 列表；有视觉时没有确定性的原图路径下发 | `goal-runner.ts:1104-1207` |
| 14 | spec refs receipt 的生产和验证都重新从 agent 产出的 `spec.md` 提取 authoritative refs；agent 漏一张时回执分母也会缩小，无法证明 runner 输入阶段发现的全集均已建模/验读 | `goal-runner.ts:6521-6535`、`critic-receipt-producer.ts:321-343` |
| 15 | 第三次宿主 run 的 Codex 最终完整给出五项答题键值（四个颜色键 + `TEXT_TOKEN`），但三轮 `capability_receipt` 均为 `not_issued`，最终耗尽 content retry | 宿主 run `20260823T161102Z-68480b/phases/spec/agent-output.log:7750-7754`、`events.jsonl:52-87` |
| 16 | `AgentInvokeResult` 已按本次调用分别保留 `stdout`、`stderr` 与退出事实；当前 inline canary 的非结构化分支却弃用该边界，改读含 prompt echo/stderr 的整份 `agent-output.log`，而 prompt 自带 `CANNOT_SEE_IMAGE` | `agent-invoke.ts:882-901,1090-1144,1287`、`goal-runner.ts:6468-6485`、事故日志 `agent-output.log:121-136` |
| 17 | 既有 `parseCanaryAnswer` 按每个键的最后一个合法赋值解析，且只把独立盲声明当 `CANNOT_SEE_IMAGE`；`resolveCanaryCacheDecision` 已统一消费 invoke 成功/失败事实与该解析器，能正确处理“prompt echo + 尾部真答案” | `vision-canary.ts:347-435`、`goal-preflight.ts:408` |
| 18 | capability canary 与逐张参考图 Read 是两种证据：Codex adapter 的 `tool_event_provenance=none`，只能证明答卷能力，不能签 refs receipt；CodeAgent/Claude 的 structured event 路径已有 final-result/Read 解析 | `agents/codex/adapter.yaml`、`agents/codeagent/adapter.yaml:53-60`、`goal-runner.ts:6516-6535`、`critic-receipt-producer.ts` |
| 19 | 现有视觉 gate 已区分可达软档与硬合同：`unverified` 在 best-effort/reachable 口径可 WARN，hard pixel contract 仍 FAIL；伪造 `verified + vl_multimodal` 缺证据链也会 FAIL，无需新建降级状态 | `profiles/hmos-app/harness/spec-ui-spec-check.ts:295-415` |
| 20 | CodeAgent 已声明 `--dangerously-skip-permissions`、stdin、stream-json 和 structured Read 解析器；当前不可用的直接原因是 `assertAdapterHeadlessFullPermission` 的专门拒绝被 preflight 升为 BLOCKER。Chrys 是另一条仍需拒绝的 adapter | `agent-invoke.ts:418`、`goal-preflight.ts:198`、`agents/codeagent/adapter.yaml`、`headless-full-permission.unit.test.ts:116` |
| 21 | prompt/技能仍有与“诚实不可审计”冲突的无条件要求：closure block 要求每张图在本 invoke 产生 Read，spec skill 对 new/changed UI 禁止 `verified: unverified`，retry guidance 也只引导继续读图/转人工；若不一并按 provenance 收窄，Codex 仍会追逐结构性不可能的终签 | `goal-runner.ts:2923-2938`、`skills/feature/spec/SKILL.md:44`、`spec-ui-spec-check.ts:328-329` |

已恢复并冻结为回归输入的事故 400 信封（模型名保留用于事故 fixture；生产判据不维护 model→CLI 版本表）：

```json
{"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The 'gpt-5.6-luna' model requires a newer version of Codex. Please upgrade to the latest app or CLI and try again."}}
```

## 3. 已定裁决

1. **P0 先修 CLI 选择。** 删除“`.exe` 天然优先”的跨目录规则；先保持 adapter candidate-name 顺序，再按 PATH/`where.exe` 原顺序取首个明确受支持且可 spawn 的 Windows 候选。extensionless POSIX/ELF shim 不得因文件存在而入选；`.cmd` 继续走已有 `cross-spawn`/containment，不发明新执行器。解析结果只在当前 execution session 内冻结并供 probe/canary/phase invoke 共用；resume 新进程重新解析，允许升级后的 CLI 生效。
2. **版本兼容不建静态表。** CLI 与模型服务的兼容关系会变化；不维护 `gpt-* → codex >= x`。只对实际调用返回的精确结构化永久错误 fail-fast，普通非零退出仍走原行为。
3. **硬 CLI/guardian 建立失败早于 harness。** agent 根本没有执行任务时，缺产物只是症状；不得用 harness 的 `spec_file_exists` 覆盖真实原因，也不得消耗内容 retry。guardian 自有 CreateProcess/Assign/Resume 失败在 agent-invoke 边界按 `[maison-guardian]` + ASCII operation marker 投影为既有 `spawn_error`，复用共享 classifier；数字 exit 2 本身不构成判据。
4. **来源路径是 provenance，不是需求正文。** 不把“source file: ...”拼进 requirement 文本污染 prompt/hash；用 manifest/fidelity SSOT 的一个可选来源列表承载。
5. **参考图是一个共享集合。** 正文显式项目图片与项目内来源文件直接父目录图片取并集，canonical path 去重并确定性排序；仅并集为空才回退 `ux-reference/`。source 扫描仍只限直接父目录、图片扩展名、非递归；不扫描外部 source sibling、项目内 sibling 目录或 `doc/features` 全局同名文件。
6. **原图保持原位。** runner 下发真实路径并绑定为 capability dependency，不复制到 `ux-reference`，不制造两份权威图片。
7. **发现结果必须贯通既有闭环。** capability 判 resolved 但 prompt 不给路径，或 receipt/gate 再从 agent spec 自算较小分母，都是断桥；同一发现集合必须进入 capability、OCR、prompt、reference mapping gate 与现有 spec refs receipt 的生产/验证。
8. **canary 判卷只有一个 SSOT。** inline 签发复用 `resolveCanaryCacheDecision/parseCanaryAnswer`，不再保留 `isCanaryAnswerComplete + classifyCanaryResponse(raw)` 分叉；structured adapter 从纯事件终态取答卷，非结构化 adapter 从本次 invoke 的 stdout 与退出事实取答卷，stderr、prompt echo 和人读混合日志都不属于机器答卷。
9. **“能看图”与“能审计逐图 Read”分轴。** 正确 canary 可以签 capability receipt；只有 `structured_events` adapter 才能依据本 invoke 的 Read 事件签 refs receipt。不得因 Codex 能答 canary 就伪造 refs receipt，也不得因它缺结构化事件就谎称完全看不到图片。
10. **不可审计时走既有诚实出口，不降低门槛。** provenance 为 `none` 的 adapter 仍可利用图片完成工作，但 spec 必须写 `verified: unverified`；best-effort/reachable 继续 WARN，hard contract 继续 FAIL，虚假 `verified + vl_multimodal` 继续拒绝。prompt、closure block、retry guidance 与 spec skill 必须同步该同一口径。
11. **CodeAgent 进入 supported 集合，真实失败交给统一硬边界。** 删除其专门拒绝，复用现有全权限 argv、stdin、stream-json 与 Read parser；Chrys 继续拒绝。宿主若返回真实 unknown/unrecognized flag，按 T1 的 hard-CLI 路径一次停机并据 stderr 修正，不预猜新签名，也不增实验授权状态。

## 4. 明确裁剪

- 不自动安装、升级、卸载或修改 PATH；Maison 只确定实际选择并如实停机。
- 不因 `where.exe` 返回多个 CLI 就 BLOCKER；多版本共存合法，PATH 首选项决定执行身份，其余仅诊断展示。
- 不增加 live “模型兼容性试调用”；UI vision canary 可能跳过，且每个 run 额外调用只会增加成本。首次正式 invoke 的确定性硬错误即时停机即可。
- 不新建 adapter binary registry、版本 lockfile、reference-image manifest、复制缓存或场外状态。
- 不降低 fidelity/视觉验收信任门槛；本 change 只修 canary 事实采集与 adapter 已有证据能力的可达路由，resume 验证优先和普通内容失败 retry 保持不变。
- 不给 Codex 新造 structured Read parser、receipt 或“文本声称读过即算证据”的旁路；不顺带接入尚未实采的 `codex exec --json`。
- 不为 npm `.cmd` 或 shim 再造执行机制；现有 containment 已能把受支持的 `.cmd` 解包为 `node.exe + CLI script`，只需修 resolver 真值。
- 不预猜 CodeAgent 的未知 flag 错误文本，不新增实验开关；Chrys 的拒绝保持原样。
- 不借机清理 phase alias、MCP 警告、plugin 警告及 review/UT 耗时；它们不是三次事故与 CodeAgent 放行的因果链。

## 5. 实施与提交边界

```text
OpenSpec delta
  → T1a P0：PATH 顺序 + exact binary probe + hard failure before harness
  → T1b：CodeAgent Goal-mode 放行（T1 责任域内的独立小提交）
  → T2 P1：requirement source provenance + bounded image discovery + prompt 接线
  → T3 P0：canary 判卷 SSOT + 视觉能力/证据可达路由
  → T4：事故回归、宿主 bounded smoke、文档与 plan 状态收口
  → OpenSpec archive
```

T1 runtime、T1 CodeAgent 小改、T2、T3 按真实责任边界提交，避免把可独立回退的问题揉进巨型 hunk；T4 收口与归档分别提交。若同一文件的 hunk 确实交错，以“每个提交可编译、契约与测试同提交”为准，不为形式拆分制造半功能提交。实施阶段只允许更新本 plan 的 todo 状态与实施记录，不改写上述裁决。

## 6. v1 → v2 review 吸收

1. Windows resolver 回归从“前置 `.cmd` + 后置 `.exe`”补全为宿主四项真实候选，并冻结 extensionless shell/ELF shim 不得冒充 Windows runtime。
2. T1 收编第二次宿主 run 的 guardian `CreateProcess` 失败；同时补上 exit-code 2 与真实 agent 返回码冲突的负向边界。
3. 撤回“正式 invoke 已证明使用 0.138”表述；改为 probe 观察值与正式错误是两条独立事实。真实 400 信封已恢复，实施时直接固化脱敏 fixture。
4. bounded discovery 从“到 prompt 为止”贯通到既有 reference mapping/receipt gate，并冻结 spec 漏图不得缩小验收分母；未新增 manifest、账本或第二套 verifier。

## 7. v2 → v3 最新宿主事故与产品裁决吸收

1. 收编第三次宿主 run：Codex 已正确回答 canary，但混合日志中的 prompt echo 造成拒签；T3 改为复用既有 canary 决策 SSOT，并以本次 invoke 的 stdout/structured final-result 为输入边界。
2. 冻结“能力与可审计性分轴”：Codex 的正确 canary 不等于存在逐图 Read 事件；无 structured provenance 时只能诚实 `unverified`，软档 WARN、硬合同 FAIL，既有信任门槛不降。
3. 把 prompt、closure-only block、retry guidance 与 `skills/feature/spec` 的冲突口径一并纳入 T3，避免只修签发点后 agent 仍被要求追逐不可达终签。
4. 按用户产品裁决把 CodeAgent 放行收进 T1：删除专门 BLOCKER，保留既有全权限/stream-json/Read 链与 Chrys 拒绝；真实 flag 风险由统一 hard-CLI 一次停机承接。
5. 原 T3 收口顺延为 T4；正文从“两次事故/两项修复”扩为“三次宿主事故 + CodeAgent 支持裁决”，仍只用一个 OpenSpec change，不新增状态机、账本或平行 verifier。

---

## 实施记录（2026-08-24）

- OpenSpec change：`openspec/changes/host-runtime-truth/` 已创建并通过 `openspec validate --all --strict`（41/41）。
- **T1a**：`headless-binary-resolve.ts` 重写（where/PATH 原顺序首个受支持形态、MZ 头探测、shim/ELF 跳过、shadowed 诊断、PATH walk 不跨目录偏好 .exe）；`agent-invoke.ts` 支持 session binary 注入（`resolveSessionBinary`，`resolveHeadlessInvokePlan/defaultHeadlessInvokePlan` 新参数）、probe 对 .cmd 用 cross-spawn、guardian 失败投影（`maison_guardian_containment_failed`，绑定 `[maison-guardian]` + CreateProcess(/AssignProcessToJobObject/ResumeThread）+ exit 2）；`vision-canary.ts` 抽共享 `resolveInvokeHardCliFailure`（spawn_error / CLI·config 签名 / Codex 400 信封三源），`resolveCanaryHardCliFailure` 薄委托；`goal-preflight.ts runGoalPreflight` 返回 session binary；goal-runner 三处复用（probe/canary/formalinvoke）+ `adapter_probe` 增补 resolved_binary/shadowed；正式 invoke 硬失败在 harness 前 `phase_halt(adapter_cli_hard_failure)`（external，零 retry）；`adjudication.ts` 注册 incident。
- **T1b**：`assertAdapterHeadlessFullPermission` 删除 codeagent 专门拒绝（Chrys 保持拒绝）；codeagent adapter.yaml 注释同步。
- **T2**：`resolveRequirementInput` 返回 `{text, sources}`；manifest 新增可选 `requirement_source_files`（条件入身份哈希）；successor 去重追加；goal-mode-entry/fidelity-intent-init 透传；fidelity-intent SSOT 可选字段；`resolveRequirementReferenceImages` 共享发现集合（正文显式 ∪ source 直接父目录一层、空集回退 ux-reference、外源不扫）；OCR 预扫/prompt authoritative paths/refs receipt 生产改共享集合；`verifyVlSigningChain` 期望分母改为 manifest 重算共享集合；hmos-app 新增 `checkVisualReferenceDenominatorCoverage`（spec 漏声明 FAIL）。
- **T3**：inline canary 签发点统一 `resolveCanaryCacheDecision/parseCanaryAnswer`（structured 读 agent-events.jsonl、非结构化只消费 `invoke.stdout` + 退出事实）；buildCapabilityBlock/closure 块按 provenance 分轴（none → 诚实 unverified 出口）；SKILL.md 与 ui-spec.md 自检口径同步。
- **T4**：新增 `host-runtime-truth.unit.test.ts`（17 用例，含两条 runner 集成冻结回归：0.138 400 → formal_invoke_attempts=1/harness=0/content_retry=0；guardian error 5 → guardian_attempts=1/agent_process_started=0/harness=0）；更新 headless-full-permission/goal-preflight/goal-model-pin/goal-canary-hard-cli/adjudication/spec-requirement-provenance 既有测试；MIGRATION.md 增节。
- 验收：`cd harness && npm test` 全 PASS（typecheck + 3460 unit + 44 fixtures）；`npm run openspec:validate` 41/41；`node scripts/check-plan-version.mjs` 待跑；`git diff --check` 待跑。
- 未执行（按用户指令留发布阶段）：提交、打包发布、宿主回灌 smoke（Codex 复放 / CodeAgent --help+Goal-mode smoke）。

---

## 实施记录·返修轮（2026-08-24，评审意见后）

评审结论：暂不通过（1 P0 / 5 P1 / P2 边角），开发完成声明早于代码真值。返修内容：

- **P0 `--requirement-file` 正式无人值守入口断桥**：fresh manifest 构造字面量补传
  `requirement_source_files`（goal-runner.ts）；`applyManifestCliOverrides` 在
  --override-manifest 授权 requirement 替换时去重追加来源（goal-manifest-cli.ts）；
  `workflows/goal-manifest.schema.yaml` 补发布契约字段；新增 H2/H3 两条 goalMain
  集成回归（fresh 与 `--supersede`+显式增量来源 均需落盘来源列表）。P0 已闭环。
- **P1 phase-driven 来源只写不读 / inline goal 退回历史全集**：derive.visual-reference
  恒以当前 `options.requirement` 为优先输入；`options.requirementSourceFiles` 为空时
  从身份匹配的 fidelity-intent SSOT 读取来源（capability-resolution.ts）。
- **P1 分母检查平行门禁 + 多条 fail-open**：coverage 收进既有 checkVisualHandoff 的
  authoritative_refs 分支（不再独立 provider/dispatch，尊重 skip/off/applicability）；
  复用 `featureDir()`；goal 态 manifest 不可读 → BLOCKER FAIL（fail-closed）；
  verifyVlSigningChain 删除 spec.md 回退（不可读/缺 requirement → failures）；
  发现集合移除 .bmp（与声明面统一，避免永远无法合法声明的分母）。
- **P1 能看图×能审计分轴**：closure 读图块按 `hasVision ∧ structured_events` 判定
  可达（buildClosureVisualEvidenceBlock 调用处）；SKILL.md 自检口径同改；
  spec-ui-spec-check 失败建议补诚实 unverified 出口。
- **P1 formal invoke banner 压签名**：resolveInvokeHardCliFailure 新增 `formalInvoke`
  选项——正式调用无答卷概念，stdout banner 不压 unknown-argument 签名；
  goal-runner 正式调用传 formalInvoke:true；补 C 组回归。
- **P2 边角**：PATH fallback 非 Windows 不再套 PE/MZ 判定（ELF/shebang 合法可 spawn）；
  shadowed 现在含后置 lower-priority 候选，聚合全局 ≤10 条。
- **状态**：四条 todo 恢复 `in_progress`——宿主回灌 smoke 未执行；返修已本地验证
  （typecheck + host-runtime-truth 20/20 + 全量单测），待宿主复测与回灌后收口。

## 实施记录·返修轮 2（2026-08-24，评审意见 2 后）

评审结论：上一轮 1 P0 / 5 P1 中 1 P0 + 4 P1 已确认修复；本轮 2 P1 未闭环 + 2 个非阻断 P2。

- **P1 manifest override 旧来源污染**：`applyManifestCliOverrides`（goal-manifest-cli.ts）
  的 requirement 分支从「去重追加」改为「**来源随 requirement 替换**」——普通
  `--manifest + --requirement-file + --override-manifest` 下旧来源整体清空（inline
  无来源同样清空），杜绝旧来源目录图片重新进入 capability/prompt/receipt/Visual
  Handoff 分母；successor 显式增量的「继承源来源 + 追加增量」仍由
  `inheritSuccessorManifest` 独家负责（发生在 override 之前，语义不叠加）。
  新增 H4 集成回归：普通 manifest override 后落盘 manifest 只剩新来源。
- **P1 hasVision × structured_events 两轴接线**：抽取纯函数
  `resolveClosureReadRequirement(hasVision, provenance)` 单点判定——
  `hasVision=true ∧ structured_events` → 'structured_events'，其余象限（含判盲+
  structured）统一 'none'；`buildClosureVisualEvidenceBlock` 入参收紧为
  structured/none 二态（原 `readRequired ? 'structured_events' : provenance`
  三元把判盲 structured 透传成 Mandatory Read 的 bug 已消除，评审实锤复现）。
  新增 D2 四象限接线回归（真实调用组合 + 文案分派断言，非 helper 默认参数）。
  `spec-ui-spec-check.ts` unverified 失败分支 suggestion 补第三条可达处置
  （none-provenance/判盲 → 诚实 unverified，soft WARN 可继续、hard FAIL）。
- **P2 headlessBinarySpawnable**：`bare && inaccessible` 显式返回 false（原掉到
  return true）；**P2 same-dir PATHEXT shadowed**：裸名命中时同目录 PATHEXT
  候选也记入 lower-priority 诊断（与注释语义一致）。
- **验证**：typecheck ✓；全量单测 3465/3465 ✓（新增 H4/D2）；周边套件
  （goal-runner-phase / goal-headless-guard / visual-fidelity / goal-runner-hardening /
  headless-binary-resolve / blocker-suggestion-ratchet / goal-preflight）✓；
  openspec validate 41/41 ✓；check-plan-version ✓；git diff --check ✓。
- **状态**：四条 todo 保持 `in_progress`——宿主回灌 smoke 仍未执行（留发布阶段）；
  OpenSpec tasks 6/7 勾选（返修轮代码完成、宿主回灌与收口未勾）。

## 实施记录·返修轮 3（2026-08-24，评审意见 3 后）

评审结论：剩 1 P1 + 2 处非阻断文字；上轮两轴问题及两个 P2 已确认修复，无 P0。

- **P1 successor + manifest override 丢源 run 来源**：`--supersede + --manifest +
  --requirement-file + --override-manifest` 时，继承（源∪manifest 自带）→ override
  整体替换为仅显式增量来源，源 run 参考图丢失。修复：supersede 上下文捕获
  `supersedeSourceSourceFiles`，在 successor requirement 唯一合并点（applyManifestCliOverrides
  之后）把来源**重设**为「源 run 来源 ∪ 显式增量来源」（忽略 manifest 自带旧来源——
  属于被覆盖的旧需求文档）；inline 增量无新来源时同样重设，保留源 run 来源。
  语义分工：普通 manifest override = 仅新来源（applyManifestCliOverrides 不变）；
  successor = 源来源 + 显式增量来源（合并块重设）；两者不叠加。
- **回归**：入口③（goal-runner-testing-integrity）补来源断言（manifest 自带
  `manifest-native.txt` 被忽略、只剩增量来源）；新增 H5 集成回归精确复现评审序列
  （源 s.md + 增量 i.md + manifest 自带 m.md → 最终 `[s.md, i.md]`）。
- **文字**：goal-runner.ts closure unverified 块文案由「tool_event_provenance=none」
  改为「本 invocation 不同时具备可用视觉与结构化逐图审计」（覆盖判盲+structured
  象限，不增加枚举）；plan 实施记录 5/7 → 6/7（实际 OpenSpec 状态）。
- **验证**：typecheck ✓；全量单测 3466/3466 ✓（新增 H5）；成功相关套件
  （host-runtime-truth 23/23、goal-runner-testing-integrity 52/52、goal-runner-phase
  33/33、spec-requirement-provenance 16/16、e2e-spec-requirement-closure 3/3）✓；
  openspec validate 41/41 ✓；check-plan-version ✓；git diff --check ✓。
- **状态**：四条 todo 保持 `in_progress`——宿主回灌 smoke 仍未执行（留发布阶段）；
  OpenSpec tasks 6/7 勾选（返修轮代码完成、宿主回灌与收口未勾）。
